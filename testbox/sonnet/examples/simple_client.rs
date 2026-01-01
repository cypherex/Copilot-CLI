use task_queue_client::TaskQueueClient;
use task_queue_core::Priority;
use std::time::Duration;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Connecting to task queue...");
    let client = TaskQueueClient::connect("127.0.0.1:6379")?;

    // Submit a simple echo task
    println!("Submitting echo task...");
    let task_id = client.submit_task(
        "echo",
        b"Hello from Rust!".to_vec(),
        Priority::normal(),
    )?;
    println!("Task submitted with ID: {}", task_id);

    // Wait for result
    println!("Waiting for result...");
    match client.wait_for_result(task_id, Duration::from_secs(30)) {
        Ok(result) => {
            let result_str = String::from_utf8_lossy(&result);
            println!("Task completed successfully!");
            println!("Result: {}", result_str);
        }
        Err(e) => {
            eprintln!("Task failed: {}", e);
        }
    }

    Ok(())
}
