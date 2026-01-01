use task_queue_worker::{Worker, WorkerConfig, TaskHandlerRegistry, handler::{TaskHandler, TaskResult}};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Custom task handler for processing images
struct ImageProcessorHandler;

#[async_trait]
impl TaskHandler for ImageProcessorHandler {
    async fn execute(&self, payload: Vec<u8>) -> TaskResult {
        #[derive(Deserialize)]
        struct ImageTask {
            url: String,
            operations: Vec<String>,
        }

        let task: ImageTask = serde_json::from_slice(&payload)
            .map_err(|e| format!("Invalid task payload: {}", e))?;

        println!("Processing image: {}", task.url);
        println!("Operations: {:?}", task.operations);

        // Simulate image processing
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        #[derive(Serialize)]
        struct ImageResult {
            processed_url: String,
            size_kb: u64,
        }

        let result = ImageResult {
            processed_url: format!("{}/processed", task.url),
            size_kb: 256,
        };

        serde_json::to_vec(&result)
            .map_err(|e| format!("Failed to serialize result: {}", e))
    }
}

/// Custom task handler for sending notifications
struct NotificationHandler;

#[async_trait]
impl TaskHandler for NotificationHandler {
    async fn execute(&self, payload: Vec<u8>) -> TaskResult {
        #[derive(Deserialize)]
        struct Notification {
            user_id: String,
            message: String,
            channel: String,
        }

        let notif: Notification = serde_json::from_slice(&payload)
            .map_err(|e| format!("Invalid notification: {}", e))?;

        println!("Sending {} notification to user {}: {}",
                 notif.channel, notif.user_id, notif.message);

        // Simulate notification sending
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        Ok(b"Notification sent".to_vec())
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let config = WorkerConfig {
        broker_address: "127.0.0.1:6379".to_string(),
        concurrency: 8,
        ..Default::default()
    };

    // Create registry and register custom handlers
    let registry = TaskHandlerRegistry::new();
    registry.register("process_image".to_string(), ImageProcessorHandler);
    registry.register("send_notification".to_string(), NotificationHandler);

    println!("Starting custom worker with handlers:");
    for task_type in registry.task_types() {
        println!("  - {}", task_type);
    }

    let worker = Worker::new(config, registry);
    worker.run().await?;

    Ok(())
}
