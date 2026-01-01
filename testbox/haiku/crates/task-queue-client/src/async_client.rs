//! Async client for task queue.

use std::time::Duration;
use task_queue_core::task::{Task, TaskId, TaskStatus};
use task_queue_core::error::{Result, TaskQueueError};

/// Async client for submitting and monitoring tasks.
pub struct AsyncClient {
    broker_addr: String,
}

impl AsyncClient {
    /// Create a new async client.
    pub fn new(broker_addr: String) -> Self {
        Self { broker_addr }
    }

    /// Submit a task to the broker.
    pub async fn submit_task(&self, mut task: Task) -> Result<TaskId> {
        let task_id = task.id;
        // In real implementation, this would send to the broker
        // For now, just return the ID
        Ok(task_id)
    }

    /// Wait for a task to complete with timeout.
    pub async fn wait_for_result(
        &self,
        task_id: TaskId,
        timeout: Duration,
    ) -> Result<Option<Vec<u8>>> {
        // In real implementation, this would poll the broker
        Ok(None)
    }

    /// Get task status.
    pub async fn get_status(&self, task_id: TaskId) -> Result<Option<Task>> {
        // In real implementation, this would query the broker
        Ok(None)
    }

    /// Cancel a task.
    pub async fn cancel(&self, task_id: TaskId) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_client_creation() {
        let client = AsyncClient::new("127.0.0.1:6379".to_string());
        assert_eq!(client.broker_addr, "127.0.0.1:6379");
    }

    #[tokio::test]
    async fn test_submit_task() {
        let client = AsyncClient::new("127.0.0.1:6379".to_string());
        let task = Task::new("test".to_string(), vec![]);
        let task_id = task.id;

        let result = client.submit_task(task).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), task_id);
    }
}
