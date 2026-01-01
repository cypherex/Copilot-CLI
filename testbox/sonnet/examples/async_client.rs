use task_queue_client::TaskQueueAsyncClient;
use task_queue_core::{Task, Priority};
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Connecting to task queue (async)...");
    let client = TaskQueueAsyncClient::connect("127.0.0.1:6379").await?;

    // Submit multiple tasks in parallel
    println!("Submitting batch of tasks...");

    let tasks = vec![
        Task::new("echo".to_string(), b"Task 1".to_vec(), Priority::high())?,
        Task::new("echo".to_string(), b"Task 2".to_vec(), Priority::normal())?,
        Task::new("echo".to_string(), b"Task 3".to_vec(), Priority::low())?,
    ];

    let task_ids = client.submit_batch(tasks).await?;
    println!("Submitted {} tasks", task_ids.len());

    // Wait for all results
    for task_id in task_ids {
        println!("\nWaiting for task {}...", task_id);
        match client.wait_for_result(task_id, Duration::from_secs(30)).await {
            Ok(result) => {
                let result_str = String::from_utf8_lossy(&result);
                println!("  Result: {}", result_str);
            }
            Err(e) => {
                eprintln!("  Failed: {}", e);
            }
        }
    }

    Ok(())
}
