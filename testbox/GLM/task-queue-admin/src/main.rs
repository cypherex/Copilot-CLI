//! Task Queue Admin CLI

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Utc};
use clap::{Parser, Subcommand};
use comfy_table::{presets::UTF8_FULL, Table, *};
use comfy_table::{Attribute, Cell, Color};
use task_queue_client::{TaskQueueClient, TaskQueueAsyncClient};
use task_queue_core::{
    task::{Task, TaskPriority, TaskStatus},
    Priority,
};
use uuid::Uuid;

/// Task Queue Admin CLI
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Cli {
    /// Broker address
    #[arg(short, long, default_value = "127.0.0.1:6379")]
    broker: String,

    /// API key (for authentication)
    #[arg(short = 'k', long, env = "TQ_API_KEY")]
    api_key: Option<String>,

    /// Output format (table, json, yaml)
    #[arg(short = 'f', long, default_value = "table")]
    format: String,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Submit a new task
    Submit {
        /// Task type
        #[arg(short, long)]
        task_type: String,

        /// Payload (base64 encoded)
        #[arg(short, long)]
        payload: String,

        /// Priority (low, normal, high)
        #[arg(short = 'p', long, default_value = "normal")]
        priority: String,

        /// Schedule at (ISO8601 timestamp)
        #[arg(short = 's', long)]
        schedule_at: Option<String>,

        /// Timeout in seconds
        #[arg(short = 't', long)]
        timeout: Option<u64>,

        /// Max retries
        #[arg(short = 'r', long)]
        max_retries: Option<u32>,

        /// Dependencies (comma-separated task IDs)
        #[arg(short = 'd', long)]
        dependencies: Option<String>,
    },

    /// Show task status
    Status {
        /// Task ID
        task_id: String,
    },

    /// List tasks
    List {
        /// Filter by status
        #[arg(short, long)]
        status: Option<String>,

        /// Filter by task type
        #[arg(short = 't', long)]
        task_type: Option<String>,

        /// Limit number of results
        #[arg(short, long, default_value_t = 100)]
        limit: usize,

        /// Offset for pagination
        #[arg(short = 'o', long, default_value_t = 0)]
        offset: usize,
    },

    /// Cancel a pending task
    Cancel {
        /// Task ID
        task_id: String,
    },

    /// Retry a failed task
    Retry {
        /// Task ID
        task_id: String,
    },

    /// Purge old tasks
    Purge {
        /// Status to purge (completed, failed, dead_letter)
        #[arg(short, long)]
        status: String,

        /// Age of tasks to delete (e.g., 7d, 24h)
        #[arg(short, long)]
        older_than: String,
    },

    /// List workers
    Workers,

    /// Show system statistics
    Stats,

    /// Show cluster status
    ClusterStatus,

    /// Show queue depth
    QueueDepth,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Submit {
            task_type,
            payload,
            priority,
            schedule_at,
            timeout,
            max_retries,
            dependencies,
        } => {
            let mut client = TaskQueueAsyncClient::connect(&cli.broker).await?;
            
            let decoded_payload = BASE64
                .decode(&payload)
                .context("Failed to decode base64 payload")?;

            let priority = match priority.as_str() {
                "high" => Priority::High,
                "normal" => Priority::Normal,
                "low" => Priority::Low,
                _ => return Err(anyhow::anyhow!("Invalid priority: {}", priority)),
            };

            let deps = if let Some(deps_str) = dependencies {
                deps_str
                    .split(',')
                    .map(|s| Uuid::parse_str(s.trim()))
                    .collect::<Result<Vec<_>, _>>()
                    .context("Failed to parse dependencies")?
            } else {
                Vec::new()
            };

            let task_id = client
                .submit_task_with_options(
                    &task_type,
                    decoded_payload,
                    priority,
                    timeout.unwrap_or(300),
                    max_retries.unwrap_or(3),
                    deps,
                )
                .await?;

            match cli.format.as_str() {
                "json" => println!(r#"{{"task_id": "{}", "status": "pending"}}"#, task_id),
                "yaml" => println!("task_id: {}\nstatus: pending", task_id),
                _ => {
                    println!("✓ Task submitted");
                    println!("  Task ID: {}", task_id);
                    println!("  Status: pending");
                }
            }
        }

        Commands::Status { task_id } => {
            let uuid = Uuid::parse_str(&task_id)
                .context("Invalid task ID")?;

            let mut client = TaskQueueAsyncClient::connect(&cli.broker).await?;
            let task = client.get_task_status(uuid).await?;

            match task {
                Some(task) => print_task(&task, &cli.format)?,
                None => println!("Task not found: {}", task_id),
            }
        }

        Commands::List {
            status,
            task_type,
            limit,
            offset,
        } => {
            let mut client = TaskQueueAsyncClient::connect(&cli.broker).await?;
            let tasks = client.list_tasks(status, task_type, limit).await?;

            match cli.format.as_str() {
                "json" => {
                    println!("{}", serde_json::to_string_pretty(&tasks)?);
                }
                "yaml" => {
                    println!("{}", serde_yaml::to_string(&tasks)?);
                }
                _ => {
                    print_task_list(tasks)?;
                }
            }
        }

        Commands::Cancel { task_id } => {
            let uuid = Uuid::parse_str(&task_id)
                .context("Invalid task ID")?;

            let mut client = TaskQueueAsyncClient::connect(&cli.broker).await?;
            let cancelled = client.cancel_task(uuid).await?;

            if cancelled {
                println!("✓ Task cancelled: {}", task_id);
            } else {
                println!("✗ Task cannot be cancelled (not found or already in progress)");
            }
        }

        Commands::Retry { task_id } => {
            // This is a placeholder - actual retry implementation would need
            // to be done via the broker API or by resubmitting the task
            println!("Retry functionality - to be implemented");
            println!("Task ID: {}", task_id);
        }

        Commands::Purge {
            status,
            older_than,
        } => {
            println!("Purge functionality - to be implemented");
            println!("Status: {}", status);
            println!("Older than: {}", older_than);
        }

        Commands::Workers => {
            let mut client = TaskQueueAsyncClient::connect(&cli.broker).await?;
            let stats = client.get_stats().await?;

            print_worker_stats(stats, &cli.format)?;
        }

        Commands::Stats => {
            let mut client = TaskQueueAsyncClient::connect(&cli.broker).await?;
            let stats = client.get_stats().await?;

            print_stats(stats, &cli.format)?;
        }

        Commands::ClusterStatus => {
            println!("Cluster status - to be implemented via REST API");
        }

        Commands::QueueDepth => {
            let mut client = TaskQueueAsyncClient::connect(&cli.broker).await?;
            let stats = client.get_stats().await?;

            print_queue_depth(stats, &cli.format)?;
        }
    }

    Ok(())
}

fn print_task(task: &Task, format: &str) -> Result<()> {
    match format {
        "json" => {
            println!("{}", serde_json::to_string_pretty(task)?);
        }
        "yaml" => {
            println!("{}", serde_yaml::to_string(task)?);
        }
        _ => {
            let mut table = Table::new();
            table
                .load_preset(UTF8_FULL)
                .set_header(vec!["Property", "Value"]);

            table.add_row(vec!["Task ID", &task.id.to_string()]);
            table.add_row(vec!["Type", &task.task_type]);
            table.add_row(vec!["Status", task.status.as_str()]);
            table.add_row(vec!["Priority", &task.priority.value().to_string()]);
            table.add_row(vec!["Created", &task.created_at.to_rfc3339()]);
            table.add_row(vec!["Updated", &task.updated_at.to_rfc3339()]);
            table.add_row(vec!["Retries", &format!("{}/{}", task.retry_count, task.max_retries)]);
            table.add_row(vec!["Timeout", &format!("{}s", task.timeout_seconds)]);

            if let Some(worker_id) = &task.worker_id {
                table.add_row(vec!["Worker", worker_id]);
            }

            if !task.dependencies.is_empty() {
                let deps: Vec<String> = task.dependencies.iter().map(|d| d.to_string()).collect();
                table.add_row(vec!["Dependencies", &deps.join(", ")]);
            }

            if let Some(result) = &task.result {
                if result.success {
                    let result_str = if let Some(data) = &result.result_data {
                        if let Ok(s) = String::from_utf8(data.clone()) {
                            s.chars().take(100).collect::<String>() + if data.len() > 100 { "..." } else { "" }
                        } else {
                            format!("[{} bytes]", data.len())
                        }
                    } else {
                        "N/A".to_string()
                    };
                    table.add_row(vec![Cell::new("Result").fg(Color::Green), &result_str]);
                } else {
                    let error = result.error_message.as_deref().unwrap_or("Unknown error");
                    table.add_row(vec![Cell::new("Error").fg(Color::Red), error]);
                }
                table.add_row(vec!["Duration", &format!("{}ms", result.processing_duration_ms)]);
            }

            if !task.error_history.is_empty() {
                table.add_row(vec!["Errors", &task.error_history.last().unwrap()]);
            }

            println!("{}", table);
        }
    }
    Ok(())
}

fn print_task_list(tasks: Vec<Task>) -> Result<()> {
    if tasks.is_empty() {
        println!("No tasks found");
        return Ok(());
    }

    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .set_header(vec!["Task ID", "Type", "Status", "Priority", "Created", "Worker"]);

    for task in tasks.iter().take(50) {
        let worker = task.worker_id.as_deref().unwrap_or("-");
        let created = task.created_at.format("%Y-%m-%d %H:%M:%S").to_string();
        let status_cell = match task.status {
            TaskStatus::Pending => Cell::new("pending").fg(Color::Yellow),
            TaskStatus::InProgress => Cell::new("in_progress").fg(Color::Blue),
            TaskStatus::Completed => Cell::new("completed").fg(Color::Green),
            TaskStatus::Failed => Cell::new("failed").fg(Color::Red),
            TaskStatus::DeadLetter => Cell::new("dead_letter").fg(Color::DarkRed),
        };

        table.add_row(vec![
            &task.id.to_string()[..8],
            &task.task_type,
            status_cell,
            &task.priority.value().to_string(),
            &created,
            worker,
        ]);
    }

    println!("{}", table);
    
    if tasks.len() > 50 {
        println!("... and {} more tasks", tasks.len() - 50);
    }

    println!("\nTotal: {} tasks", tasks.len());
    Ok(())
}

fn print_stats(stats: task_queue_core::protocol::Stats, format: &str) -> Result<()> {
    match format {
        "json" => {
            println!("{}", serde_json::to_string_pretty(&stats)?);
        }
        "yaml" => {
            println!("{}", serde_yaml::to_string(&stats)?);
        }
        _ => {
            let mut table = Table::new();
            table
                .load_preset(UTF8_FULL)
                .set_header(vec!["Metric", "Value"]);

            table.add_row(vec!["Pending Tasks", &stats.pending_count.to_string()]);
            table.add_row(vec!["In Progress", &stats.in_progress_count.to_string()]);
            table.add_row(vec!["Completed (last hour)", &stats.completed_last_hour.to_string()]);
            table.add_row(vec!["Failed (last hour)", &stats.failed_last_hour.to_string()]);
            table.add_row(vec!["Connected Workers", &stats.worker_count.to_string()]);
            table.add_row(vec![
                "Avg Processing Time",
                &format!("{:.2}ms", stats.avg_processing_time_ms),
            ]);

            println!("\n{}", table);

            println!("\nQueue Depth by Priority:");
            let mut queue_table = Table::new();
            queue_table.load_preset(UTF8_FULL).set_header(vec!["Priority", "Count"]);
            queue_table.add_row(vec!["High", &stats.queue_depth_by_priority.high.to_string()]);
            queue_table.add_row(vec!["Normal", &stats.queue_depth_by_priority.normal.to_string()]);
            queue_table.add_row(vec!["Low", &stats.queue_depth_by_priority.low.to_string()]);
            println!("{}", queue_table);
        }
    }
    Ok(())
}

fn print_worker_stats(stats: task_queue_core::protocol::Stats, format: &str) -> Result<()> {
    match format {
        "json" => {
            println!("{}", serde_json::to_string_pretty(&stats)?);
        }
        "yaml" => {
            println!("{}", serde_yaml::to_string(&stats)?);
        }
        _ => {
            let mut table = Table::new();
            table
                .load_preset(UTF8_FULL)
                .set_header(vec!["Metric", "Value"]);

            table.add_row(vec!["Connected Workers", &stats.worker_count.to_string()]);
            table.add_row(vec!["Active Workers", &stats.active_workers.to_string()]);

            println!("{}", table);
            println!("\nDetailed worker info not available via TCP protocol");
        }
    }
    Ok(())
}

fn print_queue_depth(stats: task_queue_core::protocol::Stats, format: &str) -> Result<()> {
    match format {
        "json" => {
            println!("{}", serde_json::to_string_pretty(&stats.queue_depth_by_priority)?);
        }
        "yaml" => {
            println!("{}", serde_yaml::to_string(&stats.queue_depth_by_priority)?);
        }
        _ => {
            let max = stats.queue_depth_by_priority.high
                .max(stats.queue_depth_by_priority.normal)
                .max(stats.queue_depth_by_priority.low);

            let max = max.max(1) as usize;

            println!("Queue Depth by Priority:\n");

            let priorities = vec![
                ("High", stats.queue_depth_by_priority.high),
                ("Normal", stats.queue_depth_by_priority.normal),
                ("Low", stats.queue_depth_by_priority.low),
            ];

            for (name, count) in &priorities {
                let bar_len = (count as f64 / max as f64 * 40.0).ceil() as usize;
                let bar = "█".repeat(bar_len);
                
                let color = match *name {
                    "High" => Color::Red,
                    "Normal" => Color::Yellow,
                    "Low" => Color::Green,
                    _ => Color::White,
                };

                println!("  {:6} │ {}", Cell::new(name).fg(color), Cell::new(&bar).fg(color));
                println!("        │ {:>6} tasks", count);
            }

            println!("\n  Total: {} tasks", 
                stats.queue_depth_by_priority.high + 
                stats.queue_depth_by_priority.normal + 
                stats.queue_depth_by_priority.low
            );
        }
    }
    Ok(())
}
