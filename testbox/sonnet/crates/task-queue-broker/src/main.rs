use task_queue_broker::{Broker, BrokerConfig};
use clap::Parser;
use std::sync::Arc;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use axum::Router;
use prometheus::{Encoder, TextEncoder};

#[derive(Parser, Debug)]
#[command(name = "tq-broker")]
#[command(about = "Distributed Task Queue Broker", long_about = None)]
struct Args {
    /// Path to configuration file
    #[arg(short, long, default_value = "config.yaml")]
    config: String,

    /// Broker host
    #[arg(long)]
    host: Option<String>,

    /// Broker port
    #[arg(long)]
    port: Option<u16>,

    /// REST API port
    #[arg(long)]
    rest_port: Option<u16>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_target(false))
        .init();

    // Load configuration
    let mut config = if std::path::Path::new(&args.config).exists() {
        BrokerConfig::from_file(&args.config)?
    } else {
        tracing::warn!("Config file not found, using defaults");
        BrokerConfig::default()
    };

    // Override with CLI args
    if let Some(host) = args.host {
        config.broker.host = host;
    }
    if let Some(port) = args.port {
        config.broker.port = port;
    }
    if let Some(rest_port) = args.rest_port {
        config.api.rest_port = rest_port;
    }

    tracing::info!("Starting broker with config: {:?}", config);

    // Create broker
    let broker = Arc::new(Broker::new(config.clone())?);

    // Start REST API
    let api_broker = broker.clone();
    let rest_port = config.api.rest_port;
    tokio::spawn(async move {
        if let Err(e) = start_rest_api(api_broker, rest_port).await {
            tracing::error!("REST API error: {}", e);
        }
    });

    // Start metrics server
    let metrics_broker = broker.clone();
    let metrics_port = config.monitoring.prometheus_port;
    tokio::spawn(async move {
        if let Err(e) = start_metrics_server(metrics_broker, metrics_port).await {
            tracing::error!("Metrics server error: {}", e);
        }
    });

    // Run broker
    broker.run().await?;

    Ok(())
}

async fn start_rest_api(broker: Arc<Broker>, port: u16) -> anyhow::Result<()> {
    use task_queue_broker::api::create_rest_api;

    let app = create_rest_api(broker);
    let addr = format!("0.0.0.0:{}", port);

    tracing::info!("REST API listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn start_metrics_server(broker: Arc<Broker>, port: u16) -> anyhow::Result<()> {
    use axum::{routing::get, extract::State};

    async fn metrics_handler(State(broker): State<Arc<Broker>>) -> String {
        let metrics = broker.metrics();
        let encoder = TextEncoder::new();
        let metric_families = metrics.registry.gather();
        let mut buffer = Vec::new();
        encoder.encode(&metric_families, &mut buffer).unwrap();
        String::from_utf8(buffer).unwrap()
    }

    let app = Router::new()
        .route("/metrics", get(metrics_handler))
        .with_state(broker);

    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("Metrics server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
