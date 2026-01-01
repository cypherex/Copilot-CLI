use crate::{ClientError, Result};
use task_queue_core::{Task, TaskId, Priority};
use task_queue_protocol::{
    Message, MessageCodec, SubmitTaskRequest, QueryStatusRequest,
};

use tokio::net::TcpStream;
use tokio_util::codec::Framed;
use futures::{SinkExt, StreamExt};
use std::time::Duration;

/// Async client for task queue
pub struct TaskQueueAsyncClient {
    broker_address: String,
}

impl TaskQueueAsyncClient {
    /// Connect to broker
    pub async fn connect(broker_address: impl Into<String>) -> Result<Self> {
        let broker_address = broker_address.into();

        // Test connection
        let _ = TcpStream::connect(&broker_address)
            .await
            .map_err(|e| ClientError::ConnectionError(e.to_string()))?;

        Ok(TaskQueueAsyncClient { broker_address })
    }

    /// Submit a task
    pub async fn submit_task(
        &self,
        task_type: impl Into<String>,
        payload: Vec<u8>,
        priority: Priority,
    ) -> Result<TaskId> {
        let task = Task::new(task_type.into(), payload, priority)
            .map_err(|e| ClientError::ProtocolError(e.to_string()))?;

        let task_id = task.id;

        let stream = TcpStream::connect(&self.broker_address)
            .await
            .map_err(|e| ClientError::ConnectionError(e.to_string()))?;

        let mut framed = Framed::new(stream, MessageCodec);

        let message = Message::SubmitTask(SubmitTaskRequest { task });
        framed
            .send(message)
            .await
            .map_err(|e| ClientError::ProtocolError(e.to_string()))?;

        // Wait for acknowledgment
        match framed.next().await {
            Some(Ok(Message::Ack(_))) => Ok(task_id),
            Some(Ok(Message::Nack(nack))) => {
                Err(ClientError::ServerError(nack.error))
            }
            Some(Err(e)) => Err(ClientError::ProtocolError(e.to_string())),
            None => Err(ClientError::ConnectionError("Connection closed".to_string())),
            _ => Err(ClientError::ProtocolError("Unexpected response".to_string())),
        }
    }

    /// Submit a task with builder
    pub async fn submit_task_with_options(&self, task: Task) -> Result<TaskId> {
        let task_id = task.id;

        let stream = TcpStream::connect(&self.broker_address)
            .await
            .map_err(|e| ClientError::ConnectionError(e.to_string()))?;

        let mut framed = Framed::new(stream, MessageCodec);

        let message = Message::SubmitTask(SubmitTaskRequest { task });
        framed
            .send(message)
            .await
            .map_err(|e| ClientError::ProtocolError(e.to_string()))?;

        match framed.next().await {
            Some(Ok(Message::Ack(_))) => Ok(task_id),
            Some(Ok(Message::Nack(nack))) => {
                Err(ClientError::ServerError(nack.error))
            }
            Some(Err(e)) => Err(ClientError::ProtocolError(e.to_string())),
            None => Err(ClientError::ConnectionError("Connection closed".to_string())),
            _ => Err(ClientError::ProtocolError("Unexpected response".to_string())),
        }
    }

    /// Get task status
    pub async fn get_task_status(&self, task_id: TaskId) -> Result<Option<Task>> {
        let stream = TcpStream::connect(&self.broker_address)
            .await
            .map_err(|e| ClientError::ConnectionError(e.to_string()))?;

        let mut framed = Framed::new(stream, MessageCodec);

        let message = Message::QueryStatus(QueryStatusRequest { task_id });
        framed
            .send(message)
            .await
            .map_err(|e| ClientError::ProtocolError(e.to_string()))?;

        match framed.next().await {
            Some(Ok(Message::Ack(ack))) => Ok(ack.task),
            Some(Ok(Message::Nack(_))) => Ok(None),
            Some(Err(e)) => Err(ClientError::ProtocolError(e.to_string())),
            None => Err(ClientError::ConnectionError("Connection closed".to_string())),
            _ => Err(ClientError::ProtocolError("Unexpected response".to_string())),
        }
    }

    /// Wait for task result with timeout
    pub async fn wait_for_result(
        &self,
        task_id: TaskId,
        timeout: Duration,
    ) -> Result<Vec<u8>> {
        let deadline = tokio::time::Instant::now() + timeout;

        loop {
            if tokio::time::Instant::now() > deadline {
                return Err(ClientError::Timeout);
            }

            let task = self.get_task_status(task_id).await?;

            if let Some(task) = task {
                match task.status {
                    task_queue_core::TaskStatus::Completed => {
                        return task
                            .result
                            .ok_or_else(|| ClientError::ProtocolError("No result".to_string()));
                    }
                    task_queue_core::TaskStatus::Failed | task_queue_core::TaskStatus::DeadLetter => {
                        return Err(ClientError::ServerError(
                            task.error.unwrap_or_else(|| "Task failed".to_string()),
                        ));
                    }
                    _ => {
                        // Still pending or in progress, wait and retry
                        tokio::time::sleep(Duration::from_millis(500)).await;
                    }
                }
            } else {
                return Err(ClientError::TaskNotFound);
            }
        }
    }

    /// Submit multiple tasks in batch
    pub async fn submit_batch(&self, tasks: Vec<Task>) -> Result<Vec<TaskId>> {
        let mut task_ids = Vec::new();

        for task in tasks {
            let task_id = self.submit_task_with_options(task).await?;
            task_ids.push(task_id);
        }

        Ok(task_ids)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: These tests require a running broker
    // They are integration tests and should be run separately

    #[tokio::test]
    #[ignore]
    async fn test_submit_task() {
        let client = TaskQueueAsyncClient::connect("127.0.0.1:6379")
            .await
            .unwrap();

        let task_id = client
            .submit_task("echo", b"test".to_vec(), Priority::normal())
            .await
            .unwrap();

        assert!(!task_id.is_nil());
    }
}
