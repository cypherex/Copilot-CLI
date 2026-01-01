use task_queue_worker::{Worker, WorkerConfig, TaskHandlerRegistry};
use task_queue_worker::handler::{EchoHandler, SleepHandler, JsonProcessorHandler};
use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Parser, Debug)]
#[command(name = "tq-worker")]
#[command(about = "Distributed Task Queue Worker", long_about = None)]
struct Args {
    /// Broker address
    #[arg(short, long, default_value = "127.0.0.1:6379")]
    broker: String,

    /// Worker ID (auto-generated if not provided)
    #[arg(long)]
    worker_id: Option<String>,

    /// Number of concurrent tasks
    #[arg(short, long, default_value = "4")]
    concurrency: usize,

    /// Path to configuration file
    #[arg(long)]
    config: Option<String>,
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
    let mut config = if let Some(config_path) = &args.config {
        WorkerConfig::from_file(config_path)?
    } else {
        WorkerConfig::default()
    };

    // Override with CLI args
    config.broker_address = args.broker;
    config.concurrency = args.concurrency;
    if let Some(worker_id) = args.worker_id {
        config.worker_id = Some(worker_id);
    }

    // Create task handler registry
    let registry = TaskHandlerRegistry::new();

    // Register example handlers
    registry.register("echo".to_string(), EchoHandler);
    registry.register("sleep".to_string(), SleepHandler::new(1000));
    registry.register("json_processor".to_string(), JsonProcessorHandler);

    tracing::info!("Registered task types: {:?}", registry.task_types());

    // Create and run worker
    let worker = Worker::new(config, registry);

    // Handle shutdown signals
    let worker_clone = worker.clone_for_task();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.ok();
        tracing::info!("Received shutdown signal");
        worker_clone.shutdown();
    });

    worker.run().await?;

    Ok(())
}
