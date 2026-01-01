use serde::{Deserialize, Serialize};
use task_queue_core::{Task, TaskId, Priority};

/// Message types for the TCP protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MessageType {
    SubmitTask = 1,
    ClaimTask = 2,
    TaskResult = 3,
    Heartbeat = 4,
    Ack = 5,
    Nack = 6,
    QueryStatus = 7,
}

impl MessageType {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            1 => Some(MessageType::SubmitTask),
            2 => Some(MessageType::ClaimTask),
            3 => Some(MessageType::TaskResult),
            4 => Some(MessageType::Heartbeat),
            5 => Some(MessageType::Ack),
            6 => Some(MessageType::Nack),
            7 => Some(MessageType::QueryStatus),
            _ => None,
        }
    }

    pub fn as_u8(&self) -> u8 {
        *self as u8
    }
}

/// Protocol messages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Message {
    /// Submit a new task
    SubmitTask(SubmitTaskRequest),

    /// Worker claims a task
    ClaimTask(ClaimTaskRequest),

    /// Worker reports task result
    TaskResult(TaskResultRequest),

    /// Worker heartbeat
    Heartbeat(HeartbeatRequest),

    /// Positive acknowledgment
    Ack(AckResponse),

    /// Negative acknowledgment
    Nack(NackResponse),

    /// Query task status
    QueryStatus(QueryStatusRequest),
}

impl Message {
    pub fn message_type(&self) -> MessageType {
        match self {
            Message::SubmitTask(_) => MessageType::SubmitTask,
            Message::ClaimTask(_) => MessageType::ClaimTask,
            Message::TaskResult(_) => MessageType::TaskResult,
            Message::Heartbeat(_) => MessageType::Heartbeat,
            Message::Ack(_) => MessageType::Ack,
            Message::Nack(_) => MessageType::Nack,
            Message::QueryStatus(_) => MessageType::QueryStatus,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitTaskRequest {
    pub task: Task,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimTaskRequest {
    pub worker_id: String,
    /// Optional: preferred priority tiers
    pub priority_filter: Option<Vec<Priority>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResultRequest {
    pub task_id: TaskId,
    pub worker_id: String,
    pub success: bool,
    pub result: Option<Vec<u8>>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatRequest {
    pub worker_id: String,
    pub current_task_count: usize,
    pub cpu_usage_percent: f32,
    pub memory_usage_mb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryStatusRequest {
    pub task_id: TaskId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AckResponse {
    /// Optional task returned (e.g., for ClaimTask)
    pub task: Option<Task>,
    /// Optional message
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NackResponse {
    pub error: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_type_conversion() {
        assert_eq!(MessageType::from_u8(1), Some(MessageType::SubmitTask));
        assert_eq!(MessageType::from_u8(7), Some(MessageType::QueryStatus));
        assert_eq!(MessageType::from_u8(99), None);

        assert_eq!(MessageType::SubmitTask.as_u8(), 1);
        assert_eq!(MessageType::QueryStatus.as_u8(), 7);
    }
}
