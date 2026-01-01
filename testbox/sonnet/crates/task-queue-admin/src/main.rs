use clap::{Parser, Subcommand};
use comfy_table::{Table, presets::UTF8_FULL};
use task_queue_core::Priority;
use task_queue_client::TaskQueueClient;
use uuid::Uuid;
use std::time::Duration;

#[derive(Parser, Debug)]
#[command(name = "tq-admin")]
#[command(about = "Task Queue Admin CLI", long_about = None)]
struct Args {
    /// Broker address
    #[arg(short, long, default_value = "127.0.0.1:6379")]
    broker: String,

    /// REST API address
    #[arg(long, default_value = "http://127.0.0.1:8080")]
    api: String,

    /// API key for authentication
    #[arg(long, env = "TQ_API_KEY")]
    api_key: Option<String>,

    /// Output format (json, table, yaml)
    #[arg(short, long, default_value = "table")]
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

        /// Payload file
        #[arg(short, long)]
        payload_file: String,

        /// Priority (0-255)
        #[arg(short = 'P', long, default_value = "150")]
        priority: u8,
    },

    /// Get task status
    Status {
        /// Task ID
        task_id: String,
    },

    /// List tasks
    List {
        /// Filter by status
        #[arg(short, long)]
        status: Option<String>,

        /// Limit number of results
        #[arg(short, long, default_value = "100")]
        limit: usize,
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
        /// Status to purge
        #[arg(short, long)]
        status: String,

        /// Older than duration (e.g., "7d", "24h")
        #[arg(short, long)]
        older_than: String,
    },

    /// List workers
    Workers,

    /// Get system statistics
    Stats,

    /// Show cluster status
    ClusterStatus,

    /// Show queue depth
    QueueDepth,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    match args.command {
        Commands::Submit { task_type, payload_file, priority } => {
            let payload = std::fs::read(&payload_file)?;
            let client = TaskQueueClient::connect(&args.broker)?;

            let task_id = client.submit_task(task_type, payload, Priority::new(priority))?;

            match args.format.as_str() {
                "json" => println!("{}", serde_json::json!({ "task_id": task_id })),
                "yaml" => println!("task_id: {}", task_id),
                _ => println!("Task submitted: {}", task_id),
            }
        }

        Commands::Status { task_id } => {
            let task_id = Uuid::parse_str(&task_id)?;
            let client = TaskQueueClient::connect(&args.broker)?;

            if let Some(task) = client.get_task_status(task_id)? {
                match args.format.as_str() {
                    "json" => println!("{}", serde_json::to_string_pretty(&task)?),
                    "yaml" => println!("{}", serde_yaml::to_string(&task)?),
                    _ => {
                        let mut table = Table::new();
                        table.load_preset(UTF8_FULL);
                        table.set_header(vec!["Field", "Value"]);
                        table.add_row(vec!["ID", &task.id.to_string()]);
                        table.add_row(vec!["Type", &task.task_type]);
                        table.add_row(vec!["Status", task.status.as_str()]);
                        table.add_row(vec!["Priority", &task.priority.value().to_string()]);
                        table.add_row(vec!["Created", &task.created_at.to_rfc3339()]);
                        table.add_row(vec!["Retry Count", &task.retry_count.to_string()]);
                        if let Some(worker) = &task.worker_id {
                            table.add_row(vec!["Worker", worker]);
                        }
                        if let Some(error) = &task.error {
                            table.add_row(vec!["Error", error]);
                        }
                        println!("{table}");
                    }
                }
            } else {
                eprintln!("Task not found");
            }
        }

        Commands::List { status, limit } => {
            let client = reqwest::Client::new();
            let mut url = format!("{}/api/v1/tasks?limit={}", args.api, limit);
            if let Some(status) = status {
                url = format!("{}&status={}", url, status);
            }

            let response: Vec<serde_json::Value> = client.get(&url).send().await?.json().await?;

            match args.format.as_str() {
                "json" => println!("{}", serde_json::to_string_pretty(&response)?),
                "yaml" => println!("{}", serde_yaml::to_string(&response)?),
                _ => {
                    let mut table = Table::new();
                    table.load_preset(UTF8_FULL);
                    table.set_header(vec!["ID", "Type", "Status", "Priority", "Created"]);
                    for task in response {
                        table.add_row(vec![
                            task["task_id"].as_str().unwrap_or(""),
                            task["task_type"].as_str().unwrap_or(""),
                            task["status"].as_str().unwrap_or(""),
                            &task["priority"].as_u64().unwrap_or(0).to_string(),
                            task["created_at"].as_str().unwrap_or(""),
                        ]);
                    }
                    println!("{table}");
                }
            }
        }

        Commands::Cancel { task_id } => {
            let client = reqwest::Client::new();
            let url = format!("{}/api/v1/tasks/{}", args.api, task_id);

            client.delete(&url).send().await?;
            println!("Task cancelled");
        }

        Commands::Retry { task_id } => {
            println!("Retry functionality not yet implemented");
        }

        Commands::Purge { status, older_than } => {
            println!("Purge functionality not yet implemented");
        }

        Commands::Workers => {
            let client = reqwest::Client::new();
            let url = format!("{}/api/v1/workers", args.api);

            let response: Vec<serde_json::Value> = client.get(&url).send().await?.json().await?;

            match args.format.as_str() {
                "json" => println!("{}", serde_json::to_string_pretty(&response)?),
                "yaml" => println!("{}", serde_yaml::to_string(&response)?),
                _ => {
                    let mut table = Table::new();
                    table.load_preset(UTF8_FULL);
                    table.set_header(vec!["Worker ID", "Tasks", "CPU %", "Memory MB", "Last Heartbeat"]);
                    for worker in response {
                        table.add_row(vec![
                            worker["worker_id"].as_str().unwrap_or(""),
                            &worker["current_tasks"].as_u64().unwrap_or(0).to_string(),
                            &format!("{:.1}", worker["cpu_usage_percent"].as_f64().unwrap_or(0.0)),
                            &worker["memory_usage_mb"].as_u64().unwrap_or(0).to_string(),
                            worker["last_heartbeat"].as_str().unwrap_or(""),
                        ]);
                    }
                    println!("{table}");
                }
            }
        }

        Commands::Stats => {
            let client = reqwest::Client::new();
            let url = format!("{}/api/v1/stats", args.api);

            let response: serde_json::Value = client.get(&url).send().await?.json().await?;

            match args.format.as_str() {
                "json" => println!("{}", serde_json::to_string_pretty(&response)?),
                "yaml" => println!("{}", serde_yaml::to_string(&response)?),
                _ => {
                    let mut table = Table::new();
                    table.load_preset(UTF8_FULL);
                    table.set_header(vec!["Metric", "Value"]);
                    table.add_row(vec!["Pending Tasks", &response["pending_count"].to_string()]);
                    table.add_row(vec!["In Progress", &response["in_progress_count"].to_string()]);
                    table.add_row(vec!["Workers", &response["worker_count"].to_string()]);

                    if let Some(queue_depth) = response.get("queue_depth_by_priority") {
                        table.add_row(vec!["Queue (High)", &queue_depth["high"].to_string()]);
                        table.add_row(vec!["Queue (Normal)", &queue_depth["normal"].to_string()]);
                        table.add_row(vec!["Queue (Low)", &queue_depth["low"].to_string()]);
                    }

                    println!("{table}");
                }
            }
        }

        Commands::ClusterStatus => {
            let client = reqwest::Client::new();
            let url = format!("{}/health", args.api);

            let response: serde_json::Value = client.get(&url).send().await?.json().await?;

            match args.format.as_str() {
                "json" => println!("{}", serde_json::to_string_pretty(&response)?),
                "yaml" => println!("{}", serde_yaml::to_string(&response)?),
                _ => {
                    let mut table = Table::new();
                    table.load_preset(UTF8_FULL);
                    table.set_header(vec!["Property", "Value"]);
                    table.add_row(vec!["Status", response["status"].as_str().unwrap_or("unknown")]);
                    table.add_row(vec!["Is Leader", &response["is_leader"].to_string()]);
                    table.add_row(vec!["Connected Workers", &response["connected_workers"].to_string()]);
                    table.add_row(vec!["Pending Tasks", &response["pending_tasks"].to_string()]);
                    println!("{table}");
                }
            }
        }

        Commands::QueueDepth => {
            let client = reqwest::Client::new();
            let url = format!("{}/api/v1/stats", args.api);

            let response: serde_json::Value = client.get(&url).send().await?.json().await?;

            if let Some(queue_depth) = response.get("queue_depth_by_priority") {
                let high = queue_depth["high"].as_u64().unwrap_or(0);
                let normal = queue_depth["normal"].as_u64().unwrap_or(0);
                let low = queue_depth["low"].as_u64().unwrap_or(0);

                println!("Queue Depth by Priority:");
                println!("  High:   {} {}", high, "█".repeat((high as usize).min(50)));
                println!("  Normal: {} {}", normal, "█".repeat((normal as usize).min(50)));
                println!("  Low:    {} {}", low, "█".repeat((low as usize).min(50)));
            }
        }
    }

    Ok(())
}
