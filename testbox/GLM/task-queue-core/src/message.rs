//! Message types for broker-worker communication

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Message type identifiers
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MessageType {
    /// Submit a new task to the broker
    SubmitTask = 1,
    /// Claim an available task from the broker
    ClaimTask = 2,
    /// Send task result (success or failure) to broker
    TaskResult = 3,
    /// Worker heartbeat
    Heartbeat = 4,
    /// Acknowledgment
    Ack = 5,
    /// Negative acknowledgment
    Nack = 6,
    /// Query task status
    QueryStatus = 7,
    /// Cancel a task
    CancelTask = 8,
    /// Get statistics
    GetStats = 9,
    /// Register worker
    RegisterWorker = 10,
    /// Deregister worker
    DeregisterWorker = 11,
}

impl MessageType {
    /// Convert to byte
    pub fn as_u8(self) -> u8 {
        self as u8
    }

    /// Convert from byte
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            1 => Some(MessageType::SubmitTask),
            2 => Some(MessageType::ClaimTask),
            3 => Some(MessageType::TaskResult),
            4 => Some(MessageType::Heartbeat),
            5 => Some(MessageType::Ack),
            6 => Some(MessageType::Nack),
            7 => Some(MessageType::QueryStatus),
            8 => Some(MessageType::CancelTask),
            9 => Some(MessageType::GetStats),
            10 => Some(MessageType::RegisterWorker),
            11 => Some(MessageType::DeregisterWorker),
            _ => None,
        }
    }
}

/// Task submission payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitTaskPayload {
    /// Task type name
    pub task_type: String,
    /// Task payload (base64-encoded)
    pub payload: String,
    /// Task priority
    pub priority: u8,
    /// Optional scheduled execution time (ISO8601)
    pub scheduled_at: Option<String>,
    /// Timeout in seconds
    pub timeout_seconds: u64,
    /// Maximum retry count
    pub max_retries: u32,
    /// Optional task dependencies
    pub dependencies: Option<Vec<Uuid>>,
}

/// Task claim response payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimTaskResponse {
    /// Task ID
    pub task_id: Uuid,
    /// Task type name
    pub task_type: String,
    /// Task payload (base64-encoded)
    pub payload: String,
    /// Task priority
    pub priority: u8,
    /// Timeout in seconds
    pub timeout_seconds: u64,
    /// Retry count
    pub retry_count: u32,
}

/// Task result payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResultPayload {
    /// Task ID
    pub task_id: Uuid,
    /// Result data (base64-encoded, present if success)
    pub result: Option<String>,
    /// Error message (present if failure)
    pub error: Option<String>,
    /// Processing duration in milliseconds
    pub duration_ms: u64,
}

/// Task status query response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskStatusResponse {
    /// Task ID
    pub task_id: Uuid,
    /// Task status
    pub status: String,
    /// Created at (ISO8601)
    pub created_at: String,
    /// Updated at (ISO8601)
    pub updated_at: String,
    /// Result data (base64-encoded, if completed)
    pub result: Option<String>,
    /// Error message (if failed)
    pub error: Option<String>,
    /// Retry count
    pub retry_count: u32,
    /// Worker ID (if in progress)
    pub worker_id: Option<String>,
}

/// Statistics response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatsResponse {
    /// Pending task count
    pub pending_count: usize,
    /// In-progress task count
    pub in_progress_count: usize,
    /// Completed tasks in last hour
    pub completed_last_hour: u64,
    /// Failed tasks in last hour
    pub failed_last_hour: u64,
    /// Connected worker count
    pub worker_count: usize,
    /// Average processing time in milliseconds
    pub avg_processing_time_ms: f64,
    /// Queue depth by priority
    pub queue_depth_by_priority: QueueDepthByPriority,
}

/// Queue depth by priority
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueDepthByPriority {
    /// High priority count
    pub high: usize,
    /// Normal priority count
    pub normal: usize,
    /// Low priority count
    pub low: usize,
}

impl QueueDepthByPriority {
    /// Create new empty queue depth
    pub fn new() -> Self {
        Self {
            high: 0,
            normal: 0,
            low: 0,
        }
    }

    /// Get total count
    pub fn total(&self) -> usize {
        self.high + self.normal + self.low
    }
}

impl Default for QueueDepthByPriority {
    fn default() -> Self {
        Self::new()
    }
}

/// Broker message wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerMessage {
    /// Message type
    pub message_type: u8,
    /// Payload (JSON serialized)
    pub payload: String,
    /// Request ID (for matching responses)
    pub request_id: Option<String>,
    /// Timestamp
    pub timestamp: i64,
}

impl BrokerMessage {
    /// Create a new broker message
    pub fn new(message_type: MessageType, payload: String) -> Self {
        Self {
            message_type: message_type.as_u8(),
            payload,
            request_id: None,
            timestamp: chrono::Utc::now().timestamp_millis(),
        }
    }

    /// Create a new broker message with request ID
    pub fn with_request_id(message_type: MessageType, payload: String, request_id: String) -> Self {
        Self {
            message_type: message_type.as_u8(),
            payload,
            request_id: Some(request_id),
            timestamp: chrono::Utc::now().timestamp_millis(),
        }
    }

    /// Get message type
    pub fn get_message_type(&self) -> Option<MessageType> {
        MessageType::from_u8(self.message_type)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_type_conversion() {
        assert_eq!(MessageType::SubmitTask.as_u8(), 1);
        assert_eq!(MessageType::from_u8(1), Some(MessageType::SubmitTask));
        assert_eq!(MessageType::from_u8(99), None);
    }

    #[test]
    fn test_broker_message() {
        let msg = BrokerMessage::new(MessageType::Heartbeat, "{}".to_string());
        assert_eq!(msg.get_message_type(), Some(MessageType::Heartbeat));
    }
}