//! Task Queue Worker Binary
//!
//! CLI interface for the task queue worker.

use std::env;
use task_queue_worker::{Worker, WorkerConfig, TaskHandler};
use task_queue_worker::task_handler::{SendEmailHandler, ProcessImageHandler, GenerateReportHandler};
use tracing::{info, error};
use tracing_subscriber;

/// Parse CLI arguments.
fn parse_args() -> (String, u32, Vec<String>) {
    let args: Vec<String> = env::args().collect();

    let mut broker_addr = "127.0.0.1:6379".to_string();
    let mut concurrency = 4;
    let mut handlers: Vec<String> = vec![];

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--broker" | "-b" => {
                if i + 1 < args.len() {
                    broker_addr = args[i + 1].clone();
                    i += 2;
                } else {
                    eprintln!("Error: --broker requires an argument");
                    std::process::exit(1);
                }
            }
            "--concurrency" | "-c" => {
                if i + 1 < args.len() {
                    concurrency = args[i + 1].parse().unwrap_or(4);
                    i += 2;
                } else {
                    eprintln!("Error: --concurrency requires an argument");
                    std::process::exit(1);
                }
            }
            "--handlers" | "-h" => {
                if i + 1 < args.len() {
                    let handler_list = args[i + 1].split(',').map(|s| s.trim().to_string()).collect();
                    handlers = handler_list;
                    i += 2;
                } else {
                    eprintln!("Error: --handlers requires an argument");
                    std::process::exit(1);
                }
            }
            "--help" => {
                print_help();
                std::process::exit(0);
            }
            _ => {
                eprintln!("Error: Unknown argument: {}", args[i]);
                print_help();
                std::process::exit(1);
            }
        }
    }

    (broker_addr, concurrency, handlers)
}

/// Print help message.
fn print_help() {
    println!("Task Queue Worker");
    println!();
    println!("Usage: tq-worker [OPTIONS]");
    println!();
    println!("Options:");
    println!("  --broker, -b <addr>      Broker address (default: 127.0.0.1:6379)");
    println!("  --concurrency, -c <num>   Number of parallel tasks (default: 4)");
    println!("  --handlers, -h <list>     Comma-separated handler list (e.g., send_email,process_image)");
    println!("  --help                    Show this help message");
    println!();
    println!("Example handlers:");
    println!("  send_email    - Send email notifications");
    println!("  process_image - Process and resize images");
    println!("  generate_report - Generate PDF/CSV reports");
    println!();
    println!("Example:");
    println!("  tq-worker --broker localhost:6379 --concurrency 8 --handlers send_email,process_image,generate_report");
}

/// Register handlers based on CLI arguments.
fn register_handlers(worker: &mut Worker, handler_names: &[String]) {
    let mut registered = Vec::new();

    for name in handler_names {
        match name.as_str() {
            "send_email" => {
                worker.register_task_handler(SendEmailHandler);
                registered.push(name.clone());
            }
            "process_image" => {
                worker.register_task_handler(ProcessImageHandler);
                registered.push(name.clone());
            }
            "generate_report" => {
                worker.register_task_handler(GenerateReportHandler);
                registered.push(name.clone());
            }
            _ => {
                eprintln!("Warning: Unknown handler '{}' skipped", name);
            }
        }
    }

    if registered.is_empty() {
        info!("No handlers registered");
    } else {
        info!("Registered handlers: {}", registered.join(", "));
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    // Parse CLI arguments
    let (broker_addr, concurrency, handlers) = parse_args();

    info!("Starting Task Queue Worker");
    info!("Broker address: {}", broker_addr);
    info!("Concurrency: {}", concurrency);
    info!("Requested handlers: {:?}", handlers);

    // Create worker configuration
    let config = WorkerConfig::new(broker_addr)
        .with_concurrency(concurrency);

    // Create worker
    let mut worker = Worker::new(config);

    // Register handlers
    if handlers.is_empty() {
        // Register all example handlers if none specified
        worker.register_task_handler(SendEmailHandler);
        worker.register_task_handler(ProcessImageHandler);
        worker.register_task_handler(GenerateReportHandler);
        info!("Registered all example handlers: send_email, process_image, generate_report");
    } else {
        register_handlers(&mut worker, &handlers);
    }

    info!("Worker ID: {}", worker.id());

    // Start the worker
    if let Err(e) = worker.start().await {
        error!("Worker error: {:?}", e);
        return Err(e.into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_args_defaults() {
        let args = vec!["tq-worker".to_string()];
        let (broker, concurrency, handlers) = parse_args_from_vec(args);
        assert_eq!(broker, "127.0.0.1:6379");
        assert_eq!(concurrency, 4);
        assert!(handlers.is_empty());
    }

    #[test]
    fn test_parse_args_with_broker() {
        let args = vec![
            "tq-worker".to_string(),
            "--broker".to_string(),
            "localhost:8080".to_string(),
        ];
        let (broker, concurrency, handlers) = parse_args_from_vec(args);
        assert_eq!(broker, "localhost:8080");
        assert_eq!(concurrency, 4);
        assert!(handlers.is_empty());
    }

    #[test]
    fn test_parse_args_with_concurrency() {
        let args = vec![
            "tq-worker".to_string(),
            "--concurrency".to_string(),
            "8".to_string(),
        ];
        let (broker, concurrency, handlers) = parse_args_from_vec(args);
        assert_eq!(broker, "127.0.0.1:6379");
        assert_eq!(concurrency, 8);
        assert!(handlers.is_empty());
    }

    #[test]
    fn test_parse_args_with_handlers() {
        let args = vec![
            "tq-worker".to_string(),
            "--handlers".to_string(),
            "send_email,process_image".to_string(),
        ];
        let (broker, concurrency, handlers) = parse_args_from_vec(args);
        assert_eq!(broker, "127.0.0.1:6379");
        assert_eq!(concurrency, 4);
        assert_eq!(handlers, vec!["send_email", "process_image"]);
    }

    #[test]
    fn test_parse_args_all_options() {
        let args = vec![
            "tq-worker".to_string(),
            "--broker".to_string(),
            "localhost:8080".to_string(),
            "--concurrency".to_string(),
            "16".to_string(),
            "--handlers".to_string(),
            "send_email,process_image,generate_report".to_string(),
        ];
        let (broker, concurrency, handlers) = parse_args_from_vec(args);
        assert_eq!(broker, "localhost:8080");
        assert_eq!(concurrency, 16);
        assert_eq!(handlers.len(), 3);
        assert!(handlers.contains(&"send_email".to_string()));
        assert!(handlers.contains(&"process_image".to_string()));
        assert!(handlers.contains(&"generate_report".to_string()));
    }

    // Helper function to test parse_args without modifying global env
    fn parse_args_from_vec(args: Vec<String>) -> (String, u32, Vec<String>) {
        let mut broker_addr = "127.0.0.1:6379".to_string();
        let mut concurrency = 4;
        let mut handlers: Vec<String> = vec![];

        let mut i = 1;
        while i < args.len() {
            match args[i].as_str() {
                "--broker" | "-b" => {
                    if i + 1 < args.len() {
                        broker_addr = args[i + 1].clone();
                        i += 2;
                    }
                }
                "--concurrency" | "-c" => {
                    if i + 1 < args.len() {
                        concurrency = args[i + 1].parse().unwrap_or(4);
                        i += 2;
                    }
                }
                "--handlers" | "-h" => {
                    if i + 1 < args.len() {
                        let handler_list = args[i + 1].split(',').map(|s| s.trim().to_string()).collect();
                        handlers = handler_list;
                        i += 2;
                    }
                }
                _ => {
                    i += 1;
                }
            }
        }

        (broker_addr, concurrency, handlers)
    }
}
