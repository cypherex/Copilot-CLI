//! Task Queue Broker - Main entry point

use clap::Parser;
use std::path::PathBuf;
use task_queue_broker::{api, broker::Broker, config::BrokerConfig, metrics::Metrics};
use task_queue_core::tracing_subscriber;
use tokio::sync::RwLock;

/// Task Queue Broker
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Configuration file path
    #[arg(short, long, default_value = "config.yaml")]
    config: String,

    /// Data directory (overrides config)
    #[arg(short, long)]
    data_dir: Option<PathBuf>,

    /// Broker host (overrides config)
    #[arg(short = 'H', long)]
    host: Option<String>,

    /// Broker port (overrides config)
    #[arg(short = 'P', long)]
    port: Option<u16>,

    /// API server port (overrides config)
    #[arg(long)]
    api_port: Option<u16>,

    /// Log level (overrides config)
    #[arg(long)]
    log_level: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    // Load configuration
    let mut config = if std::path::Path::new(&args.config).exists() {
        BrokerConfig::from_file(&args.config)?
    } else {
        eprintln!("Config file not found, using defaults and environment variables");
        BrokerConfig::from_env()
    };

    // Apply CLI overrides
    if let Some(data_dir) = args.data_dir {
        config.persistence.data_dir = data_dir;
    }
    if let Some(host) = args.host {
        config.broker.host = host;
    }
    if let Some(port) = args.port {
        config.broker.port = port;
    }
    if let Some(api_port) = args.api_port {
        config.api.rest_port = api_port;
    }
    if let Some(log_level) = args.log_level {
        config.monitoring.log_level = log_level;
    }

    // Initialize logging
    let log_level = config.monitoring.log_level.clone();
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(log_level));

    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .json()
        .init();

    println!();
    println!("╔════════════════════════════════════════════════════════════╗");
    println!("║         Task Queue Broker - Distributed System           ║");
    println!("╚════════════════════════════════════════════════════════════╝");
    println!();
    println!("Configuration:");
    println!("  Broker:        {}:{}", config.broker.host, config.broker.port);
    println!("  API Server:    http://0.0.0.0:{}", config.api.rest_port);
    println!("  gRPC:          0.0.0.0:{}", config.api.grpc_port);
    println!("  Metrics:       http://0.0.0.0:{}", config.monitoring.prometheus_port);
    println!("  Data Dir:      {:?}", config.persistence.data_dir);
    println!("  Raft Enabled:  {}", config.raft.enabled);
    println!("  TLS Enabled:   {}", config.api.enable_tls);
    println!();

    // Create metrics collector
    let metrics = Arc::new(Metrics::new());

    // Start metrics endpoint
    let metrics_addr = format!("0.0.0.0:{}", config.monitoring.prometheus_port);
    let metrics_server = {
        let metrics = metrics.clone();
        tokio::spawn(async move {
            use axum::{
                routing::get,
                Router,
            };
            use std::sync::Arc;

            let router = Router::new()
                .route("/metrics", get(move || async move {
                    match metrics.export() {
                        Ok(s) => s,
                        Err(e) => format!("Error: {}", e),
                    }
                }));

            if let Ok(listener) = tokio::net::TcpListener::bind(&metrics_addr).await {
                if let Err(e) = axum::serve(listener, router).await {
                    eprintln!("Metrics server error: {}", e);
                }
            }
        })
    };

    // Create and start broker
    let broker = Broker::new(config.clone()).await?;
    let broker = Arc::new(RwLock::new(broker));

    // Start API server
    let api_state = api::ApiState {
        broker: broker.clone(),
        config: config.clone(),
    };
    let api_server = tokio::spawn(async move {
        if let Err(e) = api::start_api_server(api_state).await {
            eprintln!("API server error: {}", e);
        }
    });

    // Run broker
    let broker_handle = {
        let broker = broker.clone();
        tokio::spawn(async move {
            if let Err(e) = broker.read().await.run().await {
                eprintln!("Broker error: {}", e);
            }
        })
    };

    println!("Broker started successfully!");
    println!("Press Ctrl+C to stop");
    println!();

    // Wait for shutdown signal
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            println!();
            println!("Shutting down...");
        }
        _ = broker_handle => {
            println!("Broker stopped");
        }
    }

    // Cancel background tasks
    metrics_server.abort();
    api_server.abort();

    println!("Shutdown complete");
    Ok(())
}
