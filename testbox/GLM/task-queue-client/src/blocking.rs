//! Blocking client for task queue

use crate::error::{ClientError, Result};
use std::sync::Arc;
use std::time::Duration;
use task_queue_core::{
    protocol::{Frame, FrameDecoder, Message},
    task::{Task, TaskId, TaskPriority},
    Priority,
};

/// Blocking task queue client
pub struct TaskQueueClient {
    addr: String,
    timeout: Duration,
}

impl TaskQueueClient {
    /// Connect to the task queue broker
    pub fn connect(addr: &str) -> Result<Self> {
        Ok(Self {
            addr: addr.to_string(),
            timeout: Duration::from_secs(30),
        })
    }

    /// Set request timeout
    pub fn set_timeout(&mut self, timeout: Duration) {
        self.timeout = timeout;
    }

    /// Submit a task
    pub fn submit_task(
        &self,
        task_type: &str,
        payload: Vec<u8>,
        priority: Priority,
    ) -> Result<TaskId> {
        let task = Task::new(
            task_type.to_string(),
            payload,
            TaskPriority::from(priority),
            None,
            300,
            3,
        )?;

        let rt = tokio::runtime::Runtime::new()?;
        let task_id = rt.block_on(async {
            let mut client = AsyncClientWrapper::connect(&self.addr).await?;
            client.submit_task(task).await
        })?;

        Ok(task_id)
    }

    /// Submit a task with custom options
    pub fn submit_task_with_options(
        &self,
        task_type: &str,
        payload: Vec<u8>,
        priority: Priority,
        timeout_seconds: u64,
        max_retries: u32,
        dependencies: Vec<TaskId>,
    ) -> Result<TaskId> {
        let task = Task::new(
            task_type.to_string(),
            payload,
            TaskPriority::from(priority),
            None,
            timeout_seconds,
            max_retries,
        )?;

        let mut task = task;
        task.dependencies = dependencies;

        let rt = tokio::runtime::Runtime::new()?;
        let task_id = rt.block_on(async {
            let mut client = AsyncClientWrapper::connect(&self.addr).await?;
            client.submit_task(task).await
        })?;

        Ok(task_id)
    }

    /// Get task status
    pub fn get_task_status(&self, task_id: TaskId) -> Result<Option<Task>> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(async {
            let mut client = AsyncClientWrapper::connect(&self.addr).await?;
            client.get_task_status(task_id).await
        })
    }

    /// Wait for task result (blocking)
    pub fn wait_for_result(&self, task_id: TaskId, timeout: Duration) -> Result<Vec<u8>> {
        let start = std::time::Instant::now();

        while start.elapsed() < timeout {
            if let Some(task) = self.get_task_status(task_id)? {
                if let Some(result) = task.result {
                    if result.success {
                        return Ok(result.result_data.unwrap_or_default());
                    } else {
                        return Err(ClientError::TaskFailed(
                            result.error_message.unwrap_or_else(|| "Unknown error".to_string()),
                        ));
                    }
                }
            }

            std::thread::sleep(Duration::from_millis(100));
        }

        Err(ClientError::Timeout)
    }

    /// Cancel a task
    pub fn cancel_task(&self, task_id: TaskId) -> Result<bool> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(async {
            let mut client = AsyncClientWrapper::connect(&self.addr).await?;
            client.cancel_task(task_id).await
        })
    }

    /// List tasks
    pub fn list_tasks(
        &self,
        status: Option<String>,
        task_type: Option<String>,
        limit: usize,
    ) -> Result<Vec<Task>> {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(async {
            let mut client = AsyncClientWrapper::connect(&self.addr).await?;
            client.list_tasks(status, task_type, limit).await
        })
    }
}

/// Async client wrapper (used internally by blocking client)
struct AsyncClientWrapper {
    stream: Option<tokio::net::TcpStream>,
    decoder: FrameDecoder,
}

impl AsyncClientWrapper {
    async fn connect(addr: &str) -> Result<Self> {
        let stream = tokio::net::TcpStream::connect(addr)
            .await
            .map_err(|e| ClientError::ConnectionError(e.to_string()))?;

        Ok(Self {
            stream: Some(stream),
            decoder: FrameDecoder::new(),
        })
    }

    async fn send_message(&mut self, message: Message) -> Result<Message> {
        let frame = Frame::from_message(&message)?;
        let encoded = frame.encode();

        let stream = self
            .stream
            .as_mut()
            .ok_or_else(|| ClientError::ConnectionError("Not connected".to_string()))?;

        stream
            .write_all(&encoded)
            .await
            .map_err(|e| ClientError::ConnectionError(e.to_string()))?;

        let mut response_bytes = Vec::new();
        let mut temp_buf = vec![0u8; 8192];

        loop {
            let n = stream
                .read(&mut temp_buf)
                .await
                .map_err(|e| ClientError::ConnectionError(e.to_string()))?;

            if n == 0 {
                return Err(ClientError::ConnectionError("Connection closed".to_string()));
            }

            response_bytes.extend_from_slice(&temp_buf[..n]);

            self.decoder.add_data(&response_bytes);
            if let Some(response_frame) = self.decoder.try_decode_frame()? {
                self.decoder.clear();
                return response_frame.into_message();
            }
        }
    }

    async fn submit_task(&mut self, task: Task) -> Result<TaskId> {
        let message = Message::SubmitTask { task };

        match self.send_message(message).await? {
            Message::Ack { message_id } => {
                uuid::Uuid::parse_str(&message_id).map_err(|e| ClientError::InvalidResponse(e.to_string()))
            }
            _ => Err(ClientError::InvalidResponse("Unexpected response".to_string())),
        }
    }

    async fn get_task_status(&mut self, task_id: TaskId) -> Result<Option<Task>> {
        let message = Message::QueryStatus { task_id };

        match self.send_message(message).await? {
            Message::StatusResponse { task } => Ok(task),
            _ => Err(ClientError::InvalidResponse("Unexpected response".to_string())),
        }
    }

    async fn cancel_task(&mut self, task_id: TaskId) -> Result<bool> {
        let message = Message::CancelTask { task_id };

        match self.send_message(message).await? {
            Message::Ack { .. } => Ok(true),
            Message::Error { code, .. } if code == 404 => Ok(false),
            Message::Error { code, message } => Err(ClientError::Other(format!(
                "Error {}: {}",
                code, message
            ))),
            _ => Err(ClientError::InvalidResponse("Unexpected response".to_string())),
        }
    }

    async fn list_tasks(
        &mut self,
        status: Option<String>,
        task_type: Option<String>,
        limit: usize,
    ) -> Result<Vec<Task>> {
        // Use a simplified approach - just query all and filter
        let task_status = status
            .as_ref()
            .and_then(|s| task_queue_core::task::TaskStatus::from_str(s).ok());

        let message = Message::ListTasks {
            query: task_queue_core::protocol::TaskListQuery {
                status,
                task_type,
                limit: limit as u32,
                offset: 0,
            },
        };

        match self.send_message(message).await? {
            Message::TaskListResponse { response } => Ok(response.tasks),
            _ => Err(ClientError::InvalidResponse("Unexpected response".to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_creation() {
        let client = TaskQueueClient::connect("127.0.0.1:6379");
        assert!(client.is_ok());
        let client = client.unwrap();
        assert_eq!(client.addr, "127.0.0.1:6379");
    }
}
