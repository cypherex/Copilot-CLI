//! Blocking client for task queue

use task_queue_core::{
    error::{Result, TaskQueueError},
    Priority,
    Task,
};
use std::time::Duration;
use uuid::Uuid;
use tokio::runtime::Runtime;

use super::async_client::TaskQueueAsyncClient;

/// Blocking client for task queue operations
pub struct TaskQueueClient {
    /// Async client (wrapped with runtime)
    async_client: TaskQueueAsyncClient,
    /// Tokio runtime
    runtime: Runtime,
}

impl TaskQueueClient {
    /// Connect to the broker
    ///
    /// # Arguments
    /// * `addr` - Broker address (e.g., "127.0.0.1:6379")
    ///
    /// # Example
    /// ```
    /// let client = TaskQueueClient::connect("127.0.0.1:6379")?;
    /// ```
    pub fn connect(addr: &str) -> Result<Self> {
        let runtime = Runtime::new().map_err(|e| {
            TaskQueueError::Other(format!("Failed to create runtime: {}", e))
        })?;

        let async_client = runtime
            .block_on(TaskQueueAsyncClient::connect(addr.to_string()))?;

        Ok(Self {
            async_client,
            runtime,
        })
    }

    /// Submit a task
    ///
    /// # Arguments
    /// * `task_type` - Type name of the task
    /// * `payload` - Task payload bytes
    /// * `priority` - Task priority
    ///
    /// # Example
    /// ```
    /// let client = TaskQueueClient::connect("127.0.0.1:6379")?;
    /// let task_id = client.submit_task("send_email", payload, Priority::Normal)?;
    /// ```
    pub fn submit_task(
        &mut self,
        task_type: &str,
        payload: Vec<u8>,
        priority: Priority,
    ) -> Result<Uuid> {
        self.runtime.block_on(self.async_client.submit_task(
            task_type.to_string(),
            payload,
            priority,
        ))
    }

    /// Wait for a task result
    ///
    /// # Arguments
    /// * `task_id` - Task ID to wait for
    /// * `timeout` - Maximum time to wait
    ///
    /// # Example
    /// ```
    /// let client = TaskQueueClient::connect("127.0.0.1:6379")?;
    /// let task_id = client.submit_task("process", data, Priority::Normal)?;
    /// let result = client.wait_for_result(task_id, Duration::from_secs(60))?;
    /// ```
    pub fn wait_for_result(&mut self, task_id: Uuid, timeout: Duration) -> Result<Vec<u8>> {
        self.runtime
            .block_on(self.async_client.wait_for_result(task_id, timeout))
    }

    /// Get task status
    pub fn get_task_status(&mut self, task_id: Uuid) -> Result<Task> {
        self.runtime
            .block_on(self.async_client.get_task_status(task_id))
    }

    /// Cancel a task
    pub fn cancel_task(&mut self, task_id: Uuid) -> Result<bool> {
        self.runtime.block_on(self.async_client.cancel_task(task_id))
    }
}