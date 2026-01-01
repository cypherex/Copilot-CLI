//! Task Queue Worker - Main entry point

use clap::Parser;
use task_queue_worker::config::WorkerArgs;
use task_queue_worker::handler::{ComputeHandler, EchoHandler, FailHandler, HandlerRegistry, SleepHandler};
use task_queue_worker::Worker;
use tracing_subscriber::{EnvFilter, fmt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = WorkerArgs::parse();

    // Initialize logging
    let log_level = args.log_level.clone();
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(log_level));

    fmt()
        .with_env_filter(env_filter)
        .json()
        .init();

    println!();
    println!("╔════════════════════════════════════════════════════════════╗");
    println!("║              Task Queue Worker                           ║");
    println!("╚════════════════════════════════════════════════════════════╝");
    println!();
    println!("Configuration:");
    println!("  Broker:     {}", args.broker_addr);
    println!("  Concurrency: {}", args.concurrency);
    println!("  Worker ID:  {}", args.worker_id.as_deref().unwrap_or("(auto)"));
    println!();

    // Create handler registry with example handlers
    let mut registry = HandlerRegistry::new();
    registry.register(EchoHandler)?;
    registry.register(SleepHandler)?;
    registry.register(ComputeHandler)?;
    registry.register(FailHandler)?;

    // Create config
    let config = WorkerConfig::from(args);

    // Create and run worker
    let worker = Worker::new(config, registry).await?;
    worker.run().await?;

    Ok(())
}
