//! Message protocol definitions.

use crate::task::TaskId;
use serde::{Deserialize, Serialize};

/// Message types in the protocol.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MessageType {
    /// Client submits a task
    SubmitTask = 1,
    /// Worker claims a task
    ClaimTask = 2,
    /// Worker returns task result
    TaskResult = 3,
    /// Worker/client heartbeat
    Heartbeat = 4,
    /// Acknowledge receipt
    Ack = 5,
    /// Negative acknowledge (error)
    Nack = 6,
    /// Query task status
    QueryStatus = 7,
    /// Cancel a task
    CancelTask = 8,
    /// List tasks
    ListTasks = 9,
    /// Get statistics
    GetStats = 10,
}

impl MessageType {
    /// Convert u8 to MessageType.
    pub fn from_byte(b: u8) -> Option<Self> {
        match b {
            1 => Some(MessageType::SubmitTask),
            2 => Some(MessageType::ClaimTask),
            3 => Some(MessageType::TaskResult),
            4 => Some(MessageType::Heartbeat),
            5 => Some(MessageType::Ack),
            6 => Some(MessageType::Nack),
            7 => Some(MessageType::QueryStatus),
            8 => Some(MessageType::CancelTask),
            9 => Some(MessageType::ListTasks),
            10 => Some(MessageType::GetStats),
            _ => None,
        }
    }

    /// Convert MessageType to u8.
    pub fn as_byte(&self) -> u8 {
        *self as u8
    }
}

/// Protocol message wrapper.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    /// Message type
    pub msg_type: MessageType,
    /// Message payload (JSON)
    pub payload: Vec<u8>,
}

impl Message {
    /// Create a new message.
    pub fn new(msg_type: MessageType, payload: Vec<u8>) -> Self {
        Self { msg_type, payload }
    }

    /// Serialize message to bytes with length prefix.
    /// Format: 4-byte big-endian length | 1-byte message type | payload
    pub fn to_bytes(&self) -> Result<Vec<u8>, std::io::Error> {
        let mut result = Vec::new();

        // Length will be msg_type (1 byte) + payload
        let content_len = 1 + self.payload.len();
        let len_bytes = (content_len as u32).to_be_bytes();

        result.extend_from_slice(&len_bytes);
        result.push(self.msg_type.as_byte());
        result.extend_from_slice(&self.payload);

        Ok(result)
    }

    /// Deserialize message from bytes.
    pub fn from_bytes(bytes: &[u8]) -> Result<(Self, usize), std::io::Error> {
        if bytes.len() < 5 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Message too short",
            ));
        }

        // Read 4-byte length
        let len_bytes = [bytes[0], bytes[1], bytes[2], bytes[3]];
        let content_len = u32::from_be_bytes(len_bytes) as usize;

        // content_len includes the 1-byte message type, so total size is 4 + content_len
        if bytes.len() < 4 + content_len {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Incomplete message",
            ));
        }

        // Read message type
        let msg_type_byte = bytes[4];
        let msg_type = MessageType::from_byte(msg_type_byte).ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Unknown message type: {}", msg_type_byte),
            )
        })?;

        // Read payload (content_len - 1 because it includes the type byte)
        let payload_len = content_len - 1;
        let payload = bytes[5..5 + payload_len].to_vec();

        Ok((Self::new(msg_type, payload), 4 + content_len))
    }
}

/// Submit task request payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitTaskPayload {
    pub task_type: String,
    pub payload: Vec<u8>,
    pub priority: u8,
    pub timeout_seconds: u64,
    pub max_retries: u32,
}

/// Task result payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResultPayload {
    pub task_id: TaskId,
    pub success: bool,
    pub result: Option<Vec<u8>>,
    pub error: Option<String>,
}

/// Query status request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryStatusPayload {
    pub task_id: TaskId,
}

/// Heartbeat payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatPayload {
    pub worker_id: String,
    pub task_count: u32,
    pub cpu_usage_percent: f32,
    pub memory_usage_mb: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_type_conversion() {
        assert_eq!(MessageType::from_byte(1), Some(MessageType::SubmitTask));
        assert_eq!(MessageType::from_byte(5), Some(MessageType::Ack));
        assert_eq!(MessageType::from_byte(255), None);
    }

    #[test]
    fn test_message_serialization() {
        let msg = Message::new(MessageType::Heartbeat, b"test".to_vec());
        let bytes = msg.to_bytes().unwrap();

        assert_eq!(bytes.len(), 4 + 1 + 4); // length + type + payload
        assert_eq!(bytes[4], MessageType::Heartbeat.as_byte());
        assert_eq!(&bytes[5..], b"test");
    }

    #[test]
    fn test_message_deserialization() {
        let msg = Message::new(MessageType::Ack, b"ack".to_vec());
        let bytes = msg.to_bytes().unwrap();

        let (deserialized, len) = Message::from_bytes(&bytes).unwrap();
        assert_eq!(deserialized.msg_type, MessageType::Ack);
        assert_eq!(deserialized.payload, b"ack");
        assert_eq!(len, bytes.len());
    }
}
