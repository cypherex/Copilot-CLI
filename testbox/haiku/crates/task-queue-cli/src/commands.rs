//! CLI commands for task queue administration.

use clap::{Parser, Subcommand};
use task_queue_core::task::TaskId;

#[derive(Parser)]
#[command(name = "tq-admin")]
#[command(about = "Task Queue Admin CLI", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Submit a task
    Submit {
        #[arg(long)]
        task_type: String,
        #[arg(long)]
        payload_file: String,
        #[arg(long)]
        priority: Option<u8>,
    },
    /// Show task status
    Status {
        task_id: String,
    },
    /// List tasks
    List {
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        limit: Option<usize>,
    },
    /// Cancel a task
    Cancel {
        task_id: String,
    },
    /// Retry a failed task
    Retry {
        task_id: String,
    },
    /// List active workers
    Workers,
    /// Show system statistics
    Stats,
    /// Show cluster status
    ClusterStatus,
}

impl Cli {
    pub fn parse_args() -> Self {
        Parser::parse()
    }
}
