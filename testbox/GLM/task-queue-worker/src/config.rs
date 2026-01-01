//! Worker configuration

use clap::Parser;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Parser)]
pub struct WorkerArgs {
    /// Broker address
    #[arg(short, long, default_value = "127.0.0.1:6379")]
    pub broker_addr: String,

    /// Worker ID (auto-generated if not specified)
    #[arg(short = 'i', long)]
    pub worker_id: Option<String>,

    /// Concurrency level (number of parallel tasks)
    #[arg(short = 'c', long, default_value_t = 4)]
    pub concurrency: usize,

    /// Heartbeat interval in seconds
    #[arg(long, default_value_t = 15)]
    pub heartbeat_interval_secs: u64,

    /// Lease timeout in seconds
    #[arg(long, default_value_t = 30)]
    pub lease_timeout_secs: u64,

    /// Graceful shutdown timeout in seconds
    #[arg(long, default_value_t = 60)]
    pub graceful_shutdown_timeout_secs: u64,

    /// Maximum task priority to accept (default: accept all)
    #[arg(long)]
    pub max_priority: Option<u8>,

    /// Log level
    #[arg(long, default_value = "info")]
    pub log_level: String,

    /// Configuration file
    #[arg(short, long)]
    pub config: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerConfig {
    pub broker_addr: String,
    pub worker_id: String,
    pub concurrency: usize,
    pub heartbeat_interval_secs: u64,
    pub lease_timeout_secs: u64,
    pub graceful_shutdown_timeout_secs: u64,
    pub max_priority: Option<u8>,
    pub log_level: String,
}

impl From<WorkerArgs> for WorkerConfig {
    fn from(args: WorkerArgs) -> Self {
        let worker_id = args.worker_id.unwrap_or_else(|| {
            format!(
                "{}-{}-{}",
                gethostname::gethostname().to_string_lossy(),
                std::process::id(),
                generate_random_suffix()
            )
        });

        Self {
            broker_addr: args.broker_addr,
            worker_id,
            concurrency: args.concurrency,
            heartbeat_interval_secs: args.heartbeat_interval_secs,
            lease_timeout_secs: args.lease_timeout_secs,
            graceful_shutdown_timeout_secs: args.graceful_shutdown_timeout_secs,
            max_priority: args.max_priority,
            log_level: args.log_level,
        }
    }
}

fn generate_random_suffix() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    format!("{:04x}", rng.gen::<u16>())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_random_suffix() {
        let suffix1 = generate_random_suffix();
        let suffix2 = generate_random_suffix();
        assert_eq!(suffix1.len(), 4);
        assert_eq!(suffix2.len(), 4);
        assert_ne!(suffix1, suffix2);
    }
}
