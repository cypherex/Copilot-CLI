//! Async client for task queue

use crate::error::{ClientError, Result};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use task_queue_core::{
    protocol::{Frame, FrameDecoder, Message},
    task::{Task, TaskId, TaskPriority},
    Priority,
};

/// Async task queue client
pub struct TaskQueueAsyncClient {
    addr: String,
    stream: Option<tokio::net::TcpStream>,
    decoder: FrameDecoder,
    timeout: Duration,
}

impl TaskQueueAsyncClient {
    /// Connect to the task queue broker
    pub async fn connect(addr: &str) -> Result<Self> {
        let stream = tokio::net::TcpStream::connect(addr)
            .await
            .map_err(|e| ClientError::ConnectionError(e.to_string()))?;

        Ok(Self {
            addr: addr.to_string(),
            stream: Some(stream),
            decoder: FrameDecoder::new(),
            timeout: Duration::from_secs(30),
        })
    }

    /// Set request timeout
    pub fn set_timeout(&mut self, timeout: Duration) {
        self.timeout = timeout;
    }

    /// Submit a task
    pub async fn submit_task(
        &mut self,
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

        self.submit_task_impl(task).await
    }

    /// Submit a task with custom options
    pub async fn submit_task_with_options(
        &mut self,
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

        self.submit_task_impl(task).await
    }

    /// Submit multiple tasks (batch)
    pub async fn submit_tasks_batch(
        &mut self,
        tasks: Vec<(&str, Vec<u8>, Priority)>,
    ) -> Result<Vec<TaskId>> {
        let mut task_ids = Vec::new();

        for (task_type, payload, priority) in tasks {
            let task_id = self.submit_task(task_type, payload, priority).await?;
            task_ids.push(task_id);
        }

        Ok(task_ids)
    }

    /// Internal submit implementation
    async fn submit_task_impl(&mut self, task: Task) -> Result<TaskId> {
        let message = Message::SubmitTask { task };

        match self.send_message_with_timeout(message).await? {
            Message::Ack { message_id } => {
                uuid::Uuid::parse_str(&message_id).map_err(|e| ClientError::InvalidResponse(e.to_string()))
            }
            _ => Err(ClientError::InvalidResponse("Unexpected response".to_string())),
        }
    }

    /// Get task status
    pub async fn get_task_status(&mut self, task_id: TaskId) -> Result<Option<Task>> {
        let message = Message::QueryStatus { task_id };

        match self.send_message_with_timeout(message).await? {
            Message::StatusResponse { task } => Ok(task),
            _ => Err(ClientError::InvalidResponse("Unexpected response".to_string())),
        }
    }

    /// Wait for task result (async)
    pub async fn wait_for_result(
        &mut self,
        task_id: TaskId,
        timeout: Duration,
    ) -> Result<Vec<u8>> {
        let start = std::time::Instant::now();

        while start.elapsed() < timeout {
            if let Some(task) = self.get_task_status(task_id).await? {
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

            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        Err(ClientError::Timeout)
    }

    /// Stream task updates (async)
    pub async fn stream_task_updates(
        &mut self,
        task_id: TaskId,
        mut callback: impl FnMut(Task) -> bool + Send,
    ) -> Result<()> {
        loop {
            tokio::time::sleep(Duration::from_millis(100)).await;

            if let Some(task) = self.get_task_status(task_id).await? {
                let should_continue = callback(task);

                if !should_continue || matches!(task.status, task_queue_core::task::TaskStatus::Completed | task_queue_core::task::TaskStatus::DeadLetter) {
                    break;
                }
            }
        }

        Ok(())
    }

    /// Cancel a task
    pub async fn cancel_task(&mut self, task_id: TaskId) -> Result<bool> {
        let message = Message::CancelTask { task_id };

        match self.send_message_with_timeout(message).await? {
            Message::Ack { .. } => Ok(true),
            Message::Error { code, .. } if code == 404 => Ok(false),
            Message::Error { code, message } => Err(ClientError::Other(format!(
                "Error {}: {}",
                code, message
            ))),
            _ => Err(ClientError::InvalidResponse("Unexpected response".to_string())),
        }
    }

    /// List tasks
    pub async fn list_tasks(
        &mut self,
        status: Option<String>,
        task_type: Option<String>,
        limit: usize,
    ) -> Result<Vec<Task>> {
        let message = Message::ListTasks {
            query: task_queue_core::protocol::TaskListQuery {
                status,
                task_type,
                limit: limit as u32,
                offset: 0,
            },
        };

        match self.send_message_with_timeout(message).await? {
            Message::TaskListResponse { response } => Ok(response.tasks),
            _ => Err(ClientError::InvalidResponse("Unexpected response".to_string())),
        }
    }

    /// Get statistics
    pub async fn get_stats(&mut self) -> Result<task_queue_core::protocol::Stats> {
        let message = Message::GetStats;

        match self.send_message_with_timeout(message).await? {
            Message::StatsResponse { stats } => Ok(stats),
            _ => Err(ClientError::InvalidResponse("Unexpected response".to_string())),
        }
    }

    /// Send message with timeout
    async fn send_message_with_timeout(&mut self, message: Message) -> Result<Message> {
        tokio::time::timeout(self.timeout, self.send_message(message))
            .await
            .map_err(|_| ClientError::Timeout)?
    }

    /// Send message and wait for response
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

    /// Reconnect to broker
    pub async fn reconnect(&mut self) -> Result<()> {
        if let Some(mut stream) = self.stream.take() {
            let _ = stream.shutdown().await;
        }

        let stream = tokio::net::TcpStream::connect(&self.addr)
            .await
            .map_err(|e| ClientError::ConnectionError(e.to_string()))?;

        self.stream = Some(stream);
        self.decoder.clear();

        Ok(())
    }

    /// Close connection
    pub async fn close(mut self) {
        if let Some(mut stream) = self.stream.take() {
            let _ = stream.shutdown().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_client_creation() {
        // This will fail to connect, but we can still test creation
        let result = TaskQueueAsyncClient::connect("127.0.0.1:9999").await;
        assert!(result.is_err());
    }
}
