//! Task Queue Worker Binary

use anyhow::Result;
use clap::{Parser, Subcommand};
use config::Config;
use std::path::PathBuf;
use task_queue_worker::{config::WorkerConfig, handler::TaskHandlerRegistry, worker::Worker};
use tracing::{info, Level};
use tracing_subscriber::{fmt, EnvFilter};

/// Task Queue Worker - Executes tasks submitted to the distributed task queue
#[derive(Parser, Debug)]
#[command(name = "tq-worker")]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Configuration file path
    #[arg(short, long, value_name = "FILE")]
    config: Option<PathBuf>,

    /// Broker address (overrides config file)
    #[arg(short, long, value_name = "ADDRESS")]
    broker: Option<String>,

    /// Worker ID (overrides config file)
    #[arg(short = 'i', long, value_name = "ID")]
    worker_id: Option<String>,

    /// Number of concurrent tasks
    #[arg(short = 'c', long, value_name = "N")]
    concurrency: Option<usize>,

    /// Heartbeat interval in seconds
    #[arg(short = 'h', long, value_name = "SECONDS")]
    heartbeat_interval: Option<u64>,

    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, value_name = "LEVEL")]
    log_level: Option<String>,

    /// Subcommands
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Run the worker
    Run,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Load configuration
    let config = if let Some(config_path) = &args.config {
        WorkerConfig::load(config_path.to_str().unwrap())?
    } else {
        // Try to load from default locations, otherwise use defaults
        let default_paths = [
            "./worker.yaml",
            "./worker.yml",
            "./config/worker.yaml",
            "./config/worker.yml",
        ];

        let mut config = WorkerConfig::default();
        for path in &default_paths {
            if PathBuf::from(path).exists() {
                config = WorkerConfig::load(path)?;
                info!("Loaded configuration from {}", path);
                break;
            }
        }
        config
    };

    // Override config with CLI arguments
    let mut builder = Config::builder();
    builder = builder
        .set_default("worker.concurrency", config.worker.concurrency as i64)?
        .set_default("worker.heartbeat_interval_secs", config.worker.heartbeat_interval_secs as i64)?
        .set_default("worker.graceful_shutdown_timeout_secs", config.worker.graceful_shutdown_timeout_secs as i64)?
        .set_default("worker.lease_duration_secs", config.worker.lease_duration_secs as i64)?
        .set_default("broker.host", config.broker.host)?
        .set_default("broker.port", config.broker.port as i64)?
        .set_default("broker.max_retries", config.broker.max_retries as i64)?
        .set_default("broker.base_backoff_ms", config.broker.base_backoff_ms as i64)?
        .set_default("broker.max_backoff_ms", config.broker.max_backoff_ms as i64)?;

    if let Some(broker) = args.broker {
        // Parse broker address (host:port)
        if let Some((host, port)) = broker.split_once(':') {
            builder = builder.set_default("broker.host", host)?;
            if let Ok(port_num) = port.parse::<u16>() {
                builder = builder.set_default("broker.port", port_num as i64)?;
            }
        } else {
            builder = builder.set_default("broker.host", broker)?;
        }
    }

    if let Some(concurrency) = args.concurrency {
        builder = builder.set_default("worker.concurrency", concurrency as i64)?;
    }

    if let Some(heartbeat_interval) = args.heartbeat_interval {
        builder = builder.set_default("worker.heartbeat_interval_secs", heartbeat_interval as i64)?;
    }

    let final_config = builder.build()?.try_deserialize::<WorkerConfig>()?;

    // Initialize logging
    let log_level = args.log_level.as_deref().unwrap_or(&final_config.monitoring.log_level);
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(match log_level {
            "trace" => Level::TRACE,
            "debug" => Level::DEBUG,
            "info" => Level::INFO,
            "warn" => Level::WARN,
            "error" => Level::ERROR,
            _ => Level::INFO,
        }.to_string()));

    fmt()
        .with_env_filter(filter)
        .with_target(false)
        .with_thread_ids(true)
        .init();

    info!("Task Queue Worker starting...");
    info!("Broker: {}", final_config.broker_address());
    info!("Concurrency: {}", final_config.worker.concurrency);
    info!("Heartbeat interval: {}s", final_config.worker.heartbeat_interval_secs);

    // Create handler registry
    let handler_registry = TaskHandlerRegistry::new();

    // TODO: Register default task handlers here
    // Example:
    // registry.register_handler(SendEmailHandler).await;
    // registry.register_handler(ProcessImageHandler).await;

    // Create worker
    let mut worker = Worker::with_config(final_config, handler_registry);

    // Run worker (or execute subcommand)
    match args.command {
        Some(Commands::Run) | None => {
            info!("Starting worker execution loop");
            if let Err(e) = worker.run().await {
                tracing::error!("Worker error: {}", e);
                return Err(e.into());
            }
            info!("Worker shutdown complete");
        }
    }

    Ok(())
}
