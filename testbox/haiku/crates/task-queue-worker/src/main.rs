mod worker;
mod task_handler;

use worker::{Worker, WorkerConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = WorkerConfig::default();
    let worker = Worker::new(config);

    println!("Task Queue Worker starting: {}", worker.id());
    worker.start().await?;

    Ok(())
}
