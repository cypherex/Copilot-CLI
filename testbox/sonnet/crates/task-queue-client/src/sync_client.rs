use crate::{ClientError, Result};
use task_queue_core::{Task, TaskId, Priority};
use std::time::Duration;

/// Synchronous client for task queue (wraps async client)
pub struct TaskQueueClient {
    runtime: tokio::runtime::Runtime,
    broker_address: String,
}

impl TaskQueueClient {
    /// Connect to broker
    pub fn connect(broker_address: impl Into<String>) -> Result<Self> {
        let broker_address = broker_address.into();
        let runtime = tokio::runtime::Runtime::new()
            .map_err(|e| ClientError::ConnectionError(e.to_string()))?;

        Ok(TaskQueueClient {
            runtime,
            broker_address,
        })
    }

    /// Submit a task
    pub fn submit_task(
        &self,
        task_type: impl Into<String>,
        payload: Vec<u8>,
        priority: Priority,
    ) -> Result<TaskId> {
        use crate::async_client::TaskQueueAsyncClient;

        self.runtime.block_on(async {
            let client = TaskQueueAsyncClient::connect(&self.broker_address).await?;
            client.submit_task(task_type, payload, priority).await
        })
    }

    /// Submit a task with options
    pub fn submit_task_with_options(&self, task: Task) -> Result<TaskId> {
        use crate::async_client::TaskQueueAsyncClient;

        self.runtime.block_on(async {
            let client = TaskQueueAsyncClient::connect(&self.broker_address).await?;
            client.submit_task_with_options(task).await
        })
    }

    /// Get task status
    pub fn get_task_status(&self, task_id: TaskId) -> Result<Option<Task>> {
        use crate::async_client::TaskQueueAsyncClient;

        self.runtime.block_on(async {
            let client = TaskQueueAsyncClient::connect(&self.broker_address).await?;
            client.get_task_status(task_id).await
        })
    }

    /// Wait for task result
    pub fn wait_for_result(&self, task_id: TaskId, timeout: Duration) -> Result<Vec<u8>> {
        use crate::async_client::TaskQueueAsyncClient;

        self.runtime.block_on(async {
            let client = TaskQueueAsyncClient::connect(&self.broker_address).await?;
            client.wait_for_result(task_id, timeout).await
        })
    }

    /// Submit multiple tasks in batch
    pub fn submit_batch(&self, tasks: Vec<Task>) -> Result<Vec<TaskId>> {
        use crate::async_client::TaskQueueAsyncClient;

        self.runtime.block_on(async {
            let client = TaskQueueAsyncClient::connect(&self.broker_address).await?;
            client.submit_batch(tasks).await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn test_sync_client() {
        let client = TaskQueueClient::connect("127.0.0.1:6379").unwrap();

        let task_id = client
            .submit_task("echo", b"test".to_vec(), Priority::normal())
            .unwrap();

        assert!(!task_id.is_nil());
    }
}
