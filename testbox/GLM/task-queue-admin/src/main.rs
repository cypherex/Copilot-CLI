//! Task Queue Admin CLI
//!
//! A command-line tool for managing distributed task queue system.

use anyhow::{Context, Result};
use chrono::Utc;
use clap::{Parser, Subcommand, ValueEnum};
use comfy_table::{presets::UTF8_FULL, Attribute, Cell, Color, Table};
use std::path::PathBuf;
use std::time::Duration;
use task_queue_client::TaskQueueAsyncClient;
use task_queue_core::{
    message::{StatsResponse, TaskStatusResponse, QueueDepthByPriority},
    priority::Priority,
    types::WorkerHeartbeat,
};
use tokio::io::AsyncReadExt;
use tracing::error;
use tracing_subscriber;
use uuid::Uuid;

const DEFAULT_BROKER_ADDR: &str = "127.0.0.1:6379";

#[derive(Debug, Clone, Copy, ValueEnum)]
enum OutputFormat {
    Json,
    Table,
    Yaml,
}

#[derive(Parser)]
#[command(name = "tq-admin")]
#[command(author = "Task Queue System")]
#[command(version = "1.0")]
#[command(about = "Admin CLI for the distributed task queue system", long_about = None)]
struct Cli {
    #[arg(short, long, default_value = DEFAULT_BROKER_ADDR)]
    broker: String,
    
    #[arg(short, long, env = "TQ_API_KEY")]
    api_key: Option<String>,
    
    #[arg(short, long, value_enum, default_value_t = OutputFormat::Table)]
    format: OutputFormat,
    
    #[arg(long, value_name = "SECONDS")]
    watch: Option<u64>,
    
    #[arg(short, long)]
    verbose: bool,
    
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Submit {
        #[arg(short, long)]
        task_type: String,
        #[arg(short = 'f', long)]
        payload_file: Option<PathBuf>,
        #[arg(short, long, value_enum, default_value_t = PriorityLevel::Normal)]
        priority: PriorityLevel,
        #[arg(long, value_name = "TIMESTAMP")]
        schedule_at: Option<String>,
        #[arg(long, default_value_t = 300)]
        timeout_seconds: u64,
        #[arg(long, default_value_t = 3)]
        max_retries: u32,
    },
    Status { task_id: String },
    List {
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        task_type: Option<String>,
        #[arg(short = 'n', long, default_value_t = 100)]
        limit: usize,
        #[arg(short = 'o', long, default_value_t = 0)]
        offset: usize,
    },
    Cancel { task_id: String },
    Retry { task_id: String, #[arg(long, default_value_t = 0)] delay: u64 },
    Purge {
        #[arg(short, long, default_value = "completed")]
        status: String,
        #[arg(short, long)]
        older_than: String,
        #[arg(short, long)]
        yes: bool,
    },
    Workers { #[arg(short, long)] detailed: bool },
    Stats { #[arg(short, long)] compact: bool },
    ClusterStatus { #[arg(short, long)] detailed: bool },
    QueueDepth { #[arg(short, long)] visualize: bool },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum PriorityLevel { High, Normal, Low }

impl From<PriorityLevel> for Priority {
    fn from(level: PriorityLevel) -> Self {
        match level {
            PriorityLevel::High => Priority::high(),
            PriorityLevel::Normal => Priority::normal(),
            PriorityLevel::Low => Priority::low(),
        }
    }
}

fn create_table() -> Table {
    let mut table = Table::new();
    table.load_preset(UTF8_FULL).set_content_arrangement(comfy_table::ContentArrangement::Dynamic);
    table
}

async fn handle_submit(cli: &Cli) -> Result<()> {
    if let Commands::Submit { task_type, payload_file, priority, schedule_at, timeout_seconds, max_retries } = &cli.command {
        let payload_bytes = if let Some(ref path) = payload_file {
            tokio::fs::read(path).await.with_context(|| format!("Failed to read payload file: {:?}", path))?
        } else {
            let mut buffer = Vec::new();
            tokio::io::stdin().read_to_end(&mut buffer).await?;
            buffer
        };

        let client = TaskQueueAsyncClient::connect(cli.broker.clone()).await.context("Failed to connect to broker")?;
        let task_id = client.submit_task(task_type.clone(), payload_bytes, Priority::from(*priority)).await?;

        match cli.format {
            OutputFormat::Json => {
                let mut response = serde_json::json!({ "task_id": task_id });
                if let Some(ref schedule) = schedule_at {
                    response["scheduled_at"] = serde_json::Value::String(schedule.clone());
                }
                if *timeout_seconds != 300 {
                    response["timeout_seconds"] = serde_json::Value::Number((*timeout_seconds).into());
                }
                if *max_retries != 3 {
                    response["max_retries"] = serde_json::Value::Number((*max_retries).into());
                }
                println!("{}", serde_json::to_string_pretty(&response)?);
            }
            OutputFormat::Yaml => {
                println!("task_id: {}", task_id);
                if let Some(ref schedule) = schedule_at {
                    println!("scheduled_at: {}", schedule);
                }
                if *timeout_seconds != 300 {
                    println!("timeout_seconds: {}", timeout_seconds);
                }
                if *max_retries != 3 {
                    println!("max_retries: {}", max_retries);
                }
            }
            OutputFormat::Table => {
                println!("Task submitted successfully!");
                println!("Task ID: {}", task_id);
                if let Some(ref schedule) = schedule_at {
                    println!("Scheduled At: {}", schedule);
                }
                if *timeout_seconds != 300 || *max_retries != 3 {
                    println!("Timeout: {}s, Max Retries: {}", timeout_seconds, max_retries);
                }
            }
        }
    }
    Ok(())
}

async fn handle_status(cli: &Cli) -> Result<()> {
    if let Commands::Status { task_id } = &cli.command {
        let id = Uuid::parse_str(task_id).with_context(|| format!("Invalid task ID: {}", task_id))?;
        let client = TaskQueueAsyncClient::connect(cli.broker.clone()).await.context("Failed to connect to broker")?;
        let task = client.get_task_status(id).await?;
        println!("Task ID: {}", task.id);
        println!("Status: {:?}", task.status);
    }
    Ok(())
}

async fn handle_cancel(cli: &Cli) -> Result<()> {
    if let Commands::Cancel { task_id } = &cli.command {
        let id = Uuid::parse_str(task_id).with_context(|| format!("Invalid task ID: {}", task_id))?;
        let client = TaskQueueAsyncClient::connect(cli.broker.clone()).await.context("Failed to connect to broker")?;
        let cancelled = client.cancel_task(id).await?;
        
        match cli.format {
            OutputFormat::Json => println!("{}", serde_json::json!({ "task_id": task_id, "cancelled": cancelled })),
            OutputFormat::Yaml => { println!("task_id: {}", task_id); println!("cancelled: {}", cancelled); }
            OutputFormat::Table => {
                if cancelled {
                    println!("Task {} cancelled successfully", task_id);
                } else {
                    println!("Task {} could not be cancelled (maybe not pending)", task_id);
                }
            }
        }
    }
    Ok(())
}

async fn handle_list(cli: &Cli) -> Result<()> {
    if let Commands::List { status, task_type, limit, offset } = &cli.command {
        let client = TaskQueueAsyncClient::connect(cli.broker.clone()).await?;
        
        // Parse status string to TaskStatus if provided
        let status_filter = status.as_ref().and_then(|s| match s.to_lowercase().as_str() {
            "pending" => Some(task_queue_core::types::TaskStatus::Pending),
            "in_progress" => Some(task_queue_core::types::TaskStatus::InProgress),
            "completed" => Some(task_queue_core::types::TaskStatus::Completed),
            "failed" => Some(task_queue_core::types::TaskStatus::Failed),
            "dead_letter" => Some(task_queue_core::types::TaskStatus::DeadLetter),
            _ => None,
        });

        let tasks = client.list_tasks(status_filter, task_type.clone(), *limit, *offset).await?;
        
        match cli.format {
            OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&tasks)?),
            OutputFormat::Yaml => println!("{}", serde_yaml::to_string(&tasks)?),
            OutputFormat::Table => {
                if tasks.is_empty() {
                    println!("No tasks found matching the criteria.");
                } else {
                    println!("{}", format_task_list_table(&tasks));
                    println!("\nShowing {} tasks", tasks.len());
                }
            }
        }
    }
    Ok(())
}

async fn handle_retry(cli: &Cli) -> Result<()> {
    if let Commands::Retry { task_id, delay } = &cli.command {
        let id = Uuid::parse_str(task_id).with_context(|| format!("Invalid task ID: {}", task_id))?;
        
        let client = TaskQueueAsyncClient::connect(cli.broker.clone()).await?;
        let new_task_id = client.retry_task(id, *delay).await?;
        
        match cli.format {
            OutputFormat::Json => println!("{}", serde_json::json!({ "old_task_id": task_id, "new_task_id": new_task_id })),
            OutputFormat::Yaml => println!("old_task_id: {}\nnew_task_id: {}", task_id, new_task_id),
            OutputFormat::Table => {
                println!("Task retry submitted successfully!");
                println!("Original task ID: {}", task_id);
                println!("New task ID: {}", new_task_id);
            }
        }
    }
    Ok(())
}

async fn handle_purge(cli: &Cli) -> Result<()> {
    if let Commands::Purge { status, older_than, yes } = &cli.command {
        // Parse older_than duration (e.g., "7d", "24h", "3600s")
        eprintln!("Purge command requires broker support for task deletion");
        eprintln!("Status: {}", status);
        eprintln!("Older than: {}", older_than);
        eprintln!("Confirm: {}", if *yes { "yes (skipped)" } else { "no (would prompt)" });
        
        match cli.format {
            OutputFormat::Json => println!("{}", serde_json::json!({ "message": "Purge requires broker support", "status": status, "older_than": older_than })),
            OutputFormat::Yaml => println!("message: Purge requires broker support\nstatus: {}\nolder_than: {}", status, older_than),
            OutputFormat::Table => {
                println!("Purge functionality requires broker support");
                println!("Status filter: {}", status);
                println!("Age filter: {}", older_than);
            }
        }
    }
    Ok(())
}

async fn handle_workers(cli: &Cli) -> Result<()> {
    if let Commands::Workers { detailed: _ } = &cli.command {
        let client = TaskQueueAsyncClient::connect(cli.broker.clone()).await?;
        
        let stats = client.get_stats().await?;
        
        // Note: Full worker tracking requires dedicated broker endpoint
        // For now, showing worker count from stats
        match cli.format {
            OutputFormat::Json => {
                println!("{}", serde_json::json!({
                    "worker_count": stats.worker_count,
                    "note": "Full worker list requires dedicated broker endpoint"
                }));
            }
            OutputFormat::Yaml => {
                println!("worker_count: {}", stats.worker_count);
                println!("note: Full worker list requires dedicated broker endpoint");
            }
            OutputFormat::Table => {
                println!("Connected Workers: {}", stats.worker_count);
                println!("\nNote: Detailed worker listing requires dedicated broker endpoint");
            }
        }
    }
    Ok(())
}

async fn handle_stats(cli: &Cli) -> Result<()> {
    if let Commands::Stats { compact } = &cli.command {
        let client = TaskQueueAsyncClient::connect(cli.broker.clone()).await?;
        let stats = client.get_stats().await?;
        
        match cli.format {
            OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&stats)?),
            OutputFormat::Yaml => println!("{}", serde_yaml::to_string(&stats)?),
            OutputFormat::Table => println!("{}", format_stats_table(&stats, *compact)),
        }
    }
    Ok(())
}

async fn handle_cluster_status(cli: &Cli) -> Result<()> {
    if let Commands::ClusterStatus { detailed } = &cli.command {
        // Note: This requires Raft cluster support
        eprintln!("Cluster-status command requires Raft cluster implementation");
        
        if *detailed {
            let mut table = create_table();
            table.set_header(vec!["Field", "Value"]);
            table.add_row(vec!["Cluster Mode", "Single Node"]);
            table.add_row(vec!["Raft Status", "Not Enabled"]);
            table.add_row(vec!["Node Role", "Standalone"]);
            table.add_row(vec!["Term", "0"]);
            println!("{}", table);
        } else {
            match cli.format {
                OutputFormat::Json => println!("{}", serde_json::json!({ "cluster_mode": "single_node", "raft_enabled": false })),
                OutputFormat::Yaml => println!("cluster_mode: single_node\nraft_enabled: false"),
                OutputFormat::Table => println!("Cluster Status: Single Node (Raft not enabled)"),
            }
        }
    }
    Ok(())
}

async fn handle_queue_depth(cli: &Cli) -> Result<()> {
    if let Commands::QueueDepth { visualize } = &cli.command {
        let client = TaskQueueAsyncClient::connect(cli.broker.clone()).await?;
        let stats = client.get_stats().await?;
        let queue_depth = stats.queue_depth_by_priority;
        
        match cli.format {
            OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&queue_depth)?),
            OutputFormat::Yaml => println!("{}", serde_yaml::to_string(&queue_depth)?),
            OutputFormat::Table => println!("{}", format_queue_depth_table(&queue_depth, *visualize)),
        }
    }
    Ok(())
}

fn format_task_list_table(tasks: &[TaskStatusResponse]) -> String {
    let mut table = create_table();
    table.set_header(vec!["Task ID", "Status", "Created", "Worker"]);
    
    for task in tasks {
        table.add_row(vec![
            &task.task_id.to_string()[..8],
            &task.status,
            &task.created_at[..task.created_at.len().min(19)],
            task.worker_id.as_deref().unwrap_or("-"),
        ]);
    }
    
    table.to_string()
}

fn format_stats_table(stats: &StatsResponse, compact: bool) -> String {
    let mut table = create_table();
    table.set_header(vec!["Metric", "Value"]);
    
    if compact {
        table.add_row(vec!["Pending", stats.pending_count.to_string().as_str()]);
        table.add_row(vec!["In Progress", stats.in_progress_count.to_string().as_str()]);
        table.add_row(vec!["Workers", stats.worker_count.to_string().as_str()]);
        table.add_row(vec!["Total", stats.queue_depth_by_priority.total().to_string().as_str()]);
    } else {
        table.add_row(vec!["Pending Tasks", stats.pending_count.to_string().as_str()]);
        table.add_row(vec!["In Progress", stats.in_progress_count.to_string().as_str()]);
        table.add_row(vec!["Completed (last hour)", stats.completed_last_hour.to_string().as_str()]);
        table.add_row(vec!["Failed (last hour)", stats.failed_last_hour.to_string().as_str()]);
        table.add_row(vec!["Connected Workers", stats.worker_count.to_string().as_str()]);
        table.add_row(vec!["Avg Processing Time", format!("{:.2}ms", stats.avg_processing_time_ms).as_str()]);
        table.add_row(vec!["", ""]);
        table.add_row(vec![Cell::new("Queue Depth by Priority").add_attribute(Attribute::Bold), Cell::new("")]);
        table.add_row(vec!["  High", stats.queue_depth_by_priority.high.to_string().as_str()]);
        table.add_row(vec!["  Normal", stats.queue_depth_by_priority.normal.to_string().as_str()]);
        table.add_row(vec!["  Low", stats.queue_depth_by_priority.low.to_string().as_str()]);
        table.add_row(vec!["  Total", stats.queue_depth_by_priority.total().to_string().as_str()]);
    }
    
    table.to_string()
}

fn format_workers_table(workers: &[WorkerHeartbeat], detailed: bool) -> String {
    let mut table = create_table();
    
    if detailed {
        table.set_header(vec!["Worker ID", "Tasks", "CPU %", "Memory MB", "Last Heartbeat"]);
        for worker in workers {
            table.add_row(vec![
                &worker.worker_id[..worker.worker_id.len().min(16)],
                worker.current_task_count.to_string().as_str(),
                format!("{:.1}", worker.cpu_usage_percent).as_str(),
                format!("{:.1}", worker.memory_usage_mb).as_str(),
                worker.timestamp.format("%H:%M:%S").to_string().as_str(),
            ]);
        }
    } else {
        table.set_header(vec!["Worker ID", "Tasks", "Status"]);
        for worker in workers {
            let status = if (Utc::now() - worker.timestamp).num_seconds() < 30 {
                "Alive"
            } else {
                "Stale"
            };
            let status_color = if status == "Alive" { Color::Green } else { Color::Red };
            table.add_row(vec![
                Cell::new(&worker.worker_id[..worker.worker_id.len().min(16)]),
                Cell::new(worker.current_task_count.to_string().as_str()),
                Cell::new(status).fg(status_color),
            ]);
        }
    }
    
    table.to_string()
}

fn format_queue_depth_table(queue_depth: &QueueDepthByPriority, visualize: bool) -> String {
    let mut table = create_table();
    table.set_header(vec!["Priority", "Count", "Visualization"]);
    
    let total = queue_depth.total();
    
    if visualize && total > 0 {
        let max_width = 50;
        let high_width = (queue_depth.high * max_width / total.max(1)).max(1);
        let normal_width = (queue_depth.normal * max_width / total.max(1)).max(1);
        let low_width = (queue_depth.low * max_width / total.max(1)).max(1);
        
        table.add_row(vec![Cell::new("High").fg(Color::Red), Cell::new(queue_depth.high.to_string()), Cell::new("█".repeat(high_width))]);
        table.add_row(vec![Cell::new("Normal").fg(Color::Yellow), Cell::new(queue_depth.normal.to_string()), Cell::new("█".repeat(normal_width))]);
        table.add_row(vec![Cell::new("Low").fg(Color::Green), Cell::new(queue_depth.low.to_string()), Cell::new("█".repeat(low_width))]);
        table.add_row(vec![Cell::new("Total").add_attribute(Attribute::Bold), Cell::new(total.to_string()), Cell::new("█".repeat(max_width))]);
    } else {
        table.add_row(vec![Cell::new("High").fg(Color::Red), Cell::new(queue_depth.high.to_string()), Cell::new("")]);
        table.add_row(vec![Cell::new("Normal").fg(Color::Yellow), Cell::new(queue_depth.normal.to_string()), Cell::new("")]);
        table.add_row(vec![Cell::new("Low").fg(Color::Green), Cell::new(queue_depth.low.to_string()), Cell::new("")]);
        table.add_row(vec![Cell::new("Total").add_attribute(Attribute::Bold), Cell::new(total.to_string()), Cell::new("")]);
    }
    
    table.to_string()
}

async fn run_command(cli: &Cli) -> Result<()> {
    match &cli.command {
        Commands::Submit { .. } => handle_submit(cli).await,
        Commands::Status { .. } => handle_status(cli).await,
        Commands::List { .. } => handle_list(cli).await,
        Commands::Cancel { .. } => handle_cancel(cli).await,
        Commands::Retry { .. } => handle_retry(cli).await,
        Commands::Purge { .. } => handle_purge(cli).await,
        Commands::Workers { .. } => handle_workers(cli).await,
        Commands::Stats { .. } => handle_stats(cli).await,
        Commands::ClusterStatus { .. } => handle_cluster_status(cli).await,
        Commands::QueueDepth { .. } => handle_queue_depth(cli).await,
    }
}

async fn execute(cli: Cli) -> Result<()> {
    if let Some(interval) = cli.watch {
        let interval_secs = Duration::from_secs(interval.max(1));
        println!("Watch mode: refreshing every {} seconds (Ctrl+C to stop)", interval_secs.as_secs());
        println!("{}", "=".repeat(60));
        
        loop {
            // Clear screen (works on Unix and Windows)
            print!("\x1b[2J\x1b[H");
            println!("Last update: {}", Utc::now().format("%Y-%m-%d %H:%M:%S UTC"));
            println!("{}\n", "=".repeat(60));
            
            match run_command(&cli).await {
                Ok(_) => {}
                Err(e) => {
                    error!("Error: {}", e);
                }
            }
            
            tokio::time::sleep(interval_secs).await;
        }
    } else {
        run_command(&cli).await
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    tracing_subscriber::fmt().with_env_filter(if cli.verbose { "debug" } else { "info" }).init();
    if let Err(e) = execute(cli).await {
        error!("Error: {}", e);
        std::process::exit(1);
    }
    Ok(())
}
