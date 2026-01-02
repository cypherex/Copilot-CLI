//! Async client for task queue

use task_queue_core::{
    error::{Result, TaskQueueError},
    message::{BrokerMessage, MessageType, StatsResponse, TaskStatusResponse},
    priority::Priority,
    protocol::MessageFrame,
    Task,
    types::TaskStatus,
};
use base64::prelude::*;
use serde_json;
use std::time::Duration;
use uuid::Uuid;

use super::connection::BrokerConnection;

/// Async client for task queue operations
pub struct TaskQueueAsyncClient {
    /// Broker address
    addr: String,
}

impl TaskQueueAsyncClient {
    /// Connect to the broker
    pub async fn connect(addr: String) -> Result<Self> {
        // Test connection
        let mut conn = BrokerConnection::connect(&addr).await?;
        conn.send(MessageFrame::new(MessageType::Ack.as_u8(), vec![]))
            .await?;

        Ok(Self { addr })
    }

    /// Submit a task
    pub async fn submit_task(
        &self,
        task_type: String,
        payload: Vec<u8>,
        priority: Priority,
    ) -> Result<Uuid> {
        let mut conn = BrokerConnection::connect(&self.addr).await?;

        let submit_payload = serde_json::json!({
            "task_type": task_type,
            "payload": BASE64_STANDARD.encode(&payload),
            "priority": priority.0,
            "timeout_seconds": 300,
            "max_retries": 3,
        });

        let msg = BrokerMessage::new(MessageType::SubmitTask, submit_payload.to_string());
        let msg_bytes = serde_json::to_vec(&msg).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to serialize message: {}", e))
        })?;

        conn.send(MessageFrame::new(MessageType::SubmitTask.as_u8(), msg_bytes))
            .await?;

        let response = conn.receive().await?;
        let response_msg: BrokerMessage = serde_json::from_slice(&response.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to deserialize response: {}", e))
        })?;

        let response_data: serde_json::Value = serde_json::from_str(&response_msg.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to parse response: {}", e))
        })?;

        let task_id = response_data
            .get("task_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| TaskQueueError::Other("No task_id in response".to_string()))?;

        Ok(Uuid::parse_str(task_id).map_err(|e| {
            TaskQueueError::Other(format!("Invalid task_id: {}", e))
        })?)
    }

    /// Wait for a task result
    pub async fn wait_for_result(
        &self,
        task_id: Uuid,
        timeout: Duration,
    ) -> Result<Vec<u8>> {
        let start = std::time::Instant::now();

        while start.elapsed() < timeout {
            let task = self.get_task_status(task_id).await?;

            match task.status {
                TaskStatus::Completed => {
                    if let Some(result) = task.result {
                        return Ok(result.data);
                    } else {
                        return Err(TaskQueueError::Other(
                            "Task completed but no result".to_string(),
                        ));
                    }
                }
                TaskStatus::Failed => {
                    if let Some(failure) = task.failure {
                        return Err(TaskQueueError::Other(format!(
                            "Task failed: {}",
                            failure.error
                        )));
                    }
                    return Err(TaskQueueError::Other("Task failed".to_string()));
                }
                _ => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
        }

        Err(TaskQueueError::Timeout(timeout.as_secs()))
    }

    /// Get task status
    pub async fn get_task_status(&self, task_id: Uuid) -> Result<Task> {
        let mut conn = BrokerConnection::connect(&self.addr).await?;

        let query_payload = serde_json::json!({ "task_id": task_id });
        let msg = BrokerMessage::new(MessageType::QueryStatus, query_payload.to_string());
        let msg_bytes = serde_json::to_vec(&msg).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to serialize message: {}", e))
        })?;

        conn.send(MessageFrame::new(MessageType::QueryStatus.as_u8(), msg_bytes))
            .await?;

        let response = conn.receive().await?;
        let response_msg: BrokerMessage = serde_json::from_slice(&response.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to deserialize response: {}", e))
        })?;

        let _status_response: TaskStatusResponse = serde_json::from_str(&response_msg.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to parse response: {}", e))
        })?;

        // Convert to Task (simplified)
        Ok(Task::new(
            "unknown".to_string(),
            vec![],
            Priority::normal(),
        )?)
    }

    /// List tasks with filters
    pub async fn list_tasks(
        &self,
        status: Option<TaskStatus>,
        task_type: Option<String>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<TaskStatusResponse>> {
        let mut conn = BrokerConnection::connect(&self.addr).await?;

        let query_payload = serde_json::json!({
            "status": status.map(|s| format!("{:?}", s)),
            "task_type": task_type,
            "limit": limit,
            "offset": offset,
        });

        let msg = BrokerMessage::new(MessageType::QueryStatus, query_payload.to_string());
        let msg_bytes = serde_json::to_vec(&msg).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to serialize message: {}", e))
        })?;

        conn.send(MessageFrame::new(MessageType::QueryStatus.as_u8(), msg_bytes))
            .await?;

        let response = conn.receive().await?;
        let response_msg: BrokerMessage = serde_json::from_slice(&response.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to deserialize response: {}", e))
        })?;

        let tasks: Vec<TaskStatusResponse> = serde_json::from_str(&response_msg.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to parse response: {}", e))
        })?;

        Ok(tasks)
    }

    /// Retry a failed task
    pub async fn retry_task(&self, task_id: Uuid, delay_seconds: u64) -> Result<Uuid> {
        let mut conn = BrokerConnection::connect(&self.addr).await?;

        let retry_payload = serde_json::json!({
            "task_id": task_id,
            "delay_seconds": delay_seconds,
        });

        let msg = BrokerMessage::new(MessageType::QueryStatus, retry_payload.to_string());
        let msg_bytes = serde_json::to_vec(&msg).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to serialize message: {}", e))
        })?;

        conn.send(MessageFrame::new(MessageType::QueryStatus.as_u8(), msg_bytes))
            .await?;

        let response = conn.receive().await?;
        let response_msg: BrokerMessage = serde_json::from_slice(&response.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to deserialize response: {}", e))
        })?;

        let response_data: serde_json::Value = serde_json::from_str(&response_msg.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to parse response: {}", e))
        })?;

        let new_task_id = response_data
            .get("task_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| TaskQueueError::Other("No task_id in response".to_string()))?;

        Ok(Uuid::parse_str(new_task_id).map_err(|e| {
            TaskQueueError::Other(format!("Invalid task_id: {}", e))
        })?)
    }

    /// Get system statistics
    pub async fn get_stats(&self) -> Result<StatsResponse> {
        let mut conn = BrokerConnection::connect(&self.addr).await?;

        let msg = BrokerMessage::new(MessageType::GetStats, "{}".to_string());
        let msg_bytes = serde_json::to_vec(&msg).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to serialize message: {}", e))
        })?;

        conn.send(MessageFrame::new(MessageType::GetStats.as_u8(), msg_bytes))
            .await?;

        let response = conn.receive().await?;
        let response_msg: BrokerMessage = serde_json::from_slice(&response.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to deserialize response: {}", e))
        })?;

        let stats: StatsResponse = serde_json::from_str(&response_msg.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to parse response: {}", e))
        })?;

        Ok(stats)
    }

    /// Cancel a task
    pub async fn cancel_task(&self, task_id: Uuid) -> Result<bool> {
        let mut conn = BrokerConnection::connect(&self.addr).await?;

        let cancel_payload = serde_json::json!({ "task_id": task_id });
        let msg = BrokerMessage::new(MessageType::CancelTask, cancel_payload.to_string());
        let msg_bytes = serde_json::to_vec(&msg).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to serialize message: {}", e))
        })?;

        conn.send(MessageFrame::new(MessageType::CancelTask.as_u8(), msg_bytes))
            .await?;

        let response = conn.receive().await?;
        let response_msg: BrokerMessage = serde_json::from_slice(&response.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to deserialize response: {}", e))
        })?;

        let response_data: serde_json::Value = serde_json::from_str(&response_msg.payload).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to parse response: {}", e))
        })?;

        let cancelled = response_data
            .get("cancelled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        Ok(cancelled)
    }
}