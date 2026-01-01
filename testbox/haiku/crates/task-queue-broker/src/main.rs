mod broker;
mod message_handler;
mod persistence;
mod priority_queue;
mod worker_registry;

use broker::{Broker, BrokerConfig};
use clap::Parser;
use tracing_subscriber;

#[derive(Parser, Debug)]
#[command(name = "tq-broker")]
#[command(about = "Distributed Task Queue Broker", long_about = None)]
struct Args {
    #[arg(long, default_value = "0.0.0.0")]
    host: String,

    #[arg(long, default_value = "6379")]
    port: u16,

    #[arg(long, default_value = "1000")]
    max_connections: usize,

    #[arg(long, default_value = "100000")]
    queue_depth_threshold: usize,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    let args = Args::parse();

    let config = BrokerConfig {
        host: args.host,
        port: args.port,
        max_connections: args.max_connections,
        queue_depth_threshold: args.queue_depth_threshold,
        heartbeat_timeout_secs: 30,
        lease_duration_secs: 30,
    };

    let broker = Broker::new(config);

    println!("Task Queue Broker starting on {}:{}", broker.config.host, broker.config.port);

    // For now, just run indefinitely
    tokio::signal::ctrl_c().await?;
    println!("Shutting down broker");

    Ok(())
}
