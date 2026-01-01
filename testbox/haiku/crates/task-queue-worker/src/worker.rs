//! Worker implementation for executing tasks.

use task_queue_core::task::Task;
use std::collections::HashMap;
use std::sync::Arc;
use async_trait::async_trait;

/// Task handler function type.
pub type TaskHandler = Arc<dyn Fn(Vec<u8>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u8>, String>> + Send>> + Send + Sync>;

/// Worker configuration.
#[derive(Debug, Clone)]
pub struct WorkerConfig {
    pub worker_id: String,
    pub broker_addr: String,
    pub concurrency: u32,
    pub heartbeat_interval_secs: u64,
    pub graceful_shutdown_timeout_secs: u64,
}

impl Default for WorkerConfig {
    fn default() -> Self {
        Self {
            worker_id: format!("worker-{}", uuid::Uuid::new_v4()),
            broker_addr: "127.0.0.1:6379".to_string(),
            concurrency: 4,
            heartbeat_interval_secs: 15,
            graceful_shutdown_timeout_secs: 60,
        }
    }
}

/// Main worker for executing tasks.
pub struct Worker {
    config: WorkerConfig,
    handlers: HashMap<String, Box<dyn Fn(Vec<u8>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u8>, String>> + Send>> + Send + Sync>>,
}

impl Worker {
    /// Create a new worker with default configuration.
    pub fn new(config: WorkerConfig) -> Self {
        Self {
            config,
            handlers: HashMap::new(),
        }
    }

    /// Register a task handler.
    pub fn register_handler<F>(&mut self, task_type: String, handler: F)
    where
        F: Fn(Vec<u8>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u8>, String>> + Send>> + Send + Sync + 'static,
    {
        self.handlers.insert(task_type, Box::new(handler));
    }

    /// Get worker ID.
    pub fn id(&self) -> &str {
        &self.config.worker_id
    }

    /// Execute a task.
    pub async fn execute_task(&self, task: Task) -> Result<Vec<u8>, String> {
        // In a real implementation, would call registered handler
        Ok(vec![])
    }

    /// Start the worker.
    pub async fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
        // In a real implementation, would connect to broker and start polling
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_worker_creation() {
        let config = WorkerConfig::default();
        let worker = Worker::new(config.clone());
        assert_eq!(worker.id(), config.worker_id);
    }

    #[tokio::test]
    async fn test_execute_task() {
        let config = WorkerConfig::default();
        let worker = Worker::new(config);
        let task = Task::new("test".to_string(), vec![1, 2, 3]);

        let result = worker.execute_task(task).await;
        assert!(result.is_ok());
    }
}
