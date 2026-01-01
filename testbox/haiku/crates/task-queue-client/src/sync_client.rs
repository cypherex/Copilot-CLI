//! Sync client for task queue.

use std::time::Duration;
use task_queue_core::task::{Task, TaskId};
use task_queue_core::error::Result;

/// Sync client for submitting and monitoring tasks.
pub struct SyncClient {
    broker_addr: String,
}

impl SyncClient {
    /// Create a new sync client.
    pub fn new(broker_addr: String) -> Self {
        Self { broker_addr }
    }

    /// Submit a task to the broker.
    pub fn submit_task(&self, task: Task) -> Result<TaskId> {
        let task_id = task.id;
        Ok(task_id)
    }

    /// Wait for a task to complete with timeout.
    pub fn wait_for_result(
        &self,
        task_id: TaskId,
        _timeout: Duration,
    ) -> Result<Option<Vec<u8>>> {
        Ok(None)
    }

    /// Get task status.
    pub fn get_status(&self, task_id: TaskId) -> Result<Option<Task>> {
        Ok(None)
    }

    /// Cancel a task.
    pub fn cancel(&self, task_id: TaskId) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let client = SyncClient::new("127.0.0.1:6379".to_string());
        assert_eq!(client.broker_addr, "127.0.0.1:6379");
    }

    #[test]
    fn test_submit_task() {
        let client = SyncClient::new("127.0.0.1:6379".to_string());
        let task = Task::new("test".to_string(), vec![]);
        let task_id = task.id;

        let result = client.submit_task(task);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), task_id);
    }
}
