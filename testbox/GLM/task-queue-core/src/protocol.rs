//! Network protocol for task queue communication

use crate::error::{CoreError, Result};
use crate::task::{Task, TaskId, TaskPriority, TaskResult};
use bytes::{Buf, BufMut, BytesMut};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, Cursor, Read, Write};
use uuid::Uuid;

/// Message types in the protocol
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum MessageType {
    // Client -> Broker
    SubmitTask = 0,
    ClaimTask = 1,
    TaskResult = 2,
    Heartbeat = 3,
    QueryStatus = 4,
    Ack = 5,
    Nack = 6,
    CancelTask = 7,
    ListTasks = 8,
    GetStats = 9,

    // Broker -> Client/Worker
    TaskAssigned = 10,
    TaskUpdate = 11,
    WorkerRegistration = 12,
    WorkerDeregistration = 13,
    Error = 14,
    Ping = 15,
    Pong = 16,
}

impl MessageType {
    /// Convert from byte
    pub fn from_byte(b: u8) -> Result<Self> {
        match b {
            0 => Ok(MessageType::SubmitTask),
            1 => Ok(MessageType::ClaimTask),
            2 => Ok(MessageType::TaskResult),
            3 => Ok(MessageType::Heartbeat),
            4 => Ok(MessageType::QueryStatus),
            5 => Ok(MessageType::Ack),
            6 => Ok(MessageType::Nack),
            7 => Ok(MessageType::CancelTask),
            8 => Ok(MessageType::ListTasks),
            9 => Ok(MessageType::GetStats),
            10 => Ok(MessageType::TaskAssigned),
            11 => Ok(MessageType::TaskUpdate),
            12 => Ok(MessageType::WorkerRegistration),
            13 => Ok(MessageType::WorkerDeregistration),
            14 => Ok(MessageType::Error),
            15 => Ok(MessageType::Ping),
            16 => Ok(MessageType::Pong),
            _ => Err(CoreError::InvalidMessageType(b)),
        }
    }
}

/// Heartbeat data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatData {
    pub worker_id: String,
    pub current_task_count: u32,
    pub cpu_usage_percent: f32,
    pub memory_usage_mb: u32,
}

/// Statistics response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stats {
    pub pending_count: u64,
    pub in_progress_count: u64,
    pub completed_last_hour: u64,
    pub failed_last_hour: u64,
    pub worker_count: u64,
    pub avg_processing_time_ms: f64,
    pub queue_depth_by_priority: QueueDepthByPriority,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueDepthByPriority {
    pub high: u64,
    pub normal: u64,
    pub low: u64,
}

/// Task list query parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskListQuery {
    pub status: Option<String>,
    pub task_type: Option<String>,
    pub limit: u32,
    pub offset: u32,
}

/// Task list response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskListResponse {
    pub tasks: Vec<Task>,
    pub total: u64,
}

/// Worker information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerInfo {
    pub worker_id: String,
    pub hostname: String,
    pub pid: u32,
    pub current_tasks: u32,
    pub cpu_usage_percent: f32,
    pub memory_usage_mb: u32,
    pub last_heartbeat: chrono::DateTime<chrono::Utc>,
    pub status: WorkerStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkerStatus {
    Active,
    Idle,
    Dead,
}

/// Protocol message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Message {
    SubmitTask {
        task: Task,
    },
    ClaimTask {
        worker_id: String,
        max_priority: Option<TaskPriority>,
    },
    TaskResult {
        result: TaskResult,
    },
    Heartbeat {
        data: HeartbeatData,
    },
    QueryStatus {
        task_id: TaskId,
    },
    Ack {
        message_id: String,
    },
    Nack {
        message_id: String,
        reason: String,
    },
    CancelTask {
        task_id: TaskId,
    },
    ListTasks {
        query: TaskListQuery,
    },
    GetStats,
    TaskAssigned {
        task: Task,
    },
    TaskUpdate {
        task_id: TaskId,
        status: crate::task::TaskStatus,
        result: Option<TaskResult>,
    },
    WorkerRegistration {
        worker_id: String,
        hostname: String,
        pid: u32,
        concurrency: u32,
    },
    WorkerDeregistration {
        worker_id: String,
    },
    Error {
        code: u32,
        message: String,
    },
    Ping,
    Pong,
    StatusResponse {
        task: Option<Task>,
    },
    StatsResponse {
        stats: Stats,
    },
    TaskListResponse {
        response: TaskListResponse,
    },
}

impl Message {
    /// Get the message type for this message
    pub fn message_type(&self) -> MessageType {
        match self {
            Message::SubmitTask { .. } => MessageType::SubmitTask,
            Message::ClaimTask { .. } => MessageType::ClaimTask,
            Message::TaskResult { .. } => MessageType::TaskResult,
            Message::Heartbeat { .. } => MessageType::Heartbeat,
            Message::QueryStatus { .. } => MessageType::QueryStatus,
            Message::Ack { .. } => MessageType::Ack,
            Message::Nack { .. } => MessageType::Nack,
            Message::CancelTask { .. } => MessageType::CancelTask,
            Message::ListTasks { .. } => MessageType::ListTasks,
            Message::GetStats => MessageType::GetStats,
            Message::TaskAssigned { .. } => MessageType::TaskAssigned,
            Message::TaskUpdate { .. } => MessageType::TaskUpdate,
            Message::WorkerRegistration { .. } => MessageType::WorkerRegistration,
            Message::WorkerDeregistration { .. } => MessageType::WorkerDeregistration,
            Message::Error { .. } => MessageType::Error,
            Message::Ping => MessageType::Ping,
            Message::Pong => MessageType::Pong,
            Message::StatusResponse { .. } => MessageType::QueryStatus,
            Message::StatsResponse { .. } => MessageType::GetStats,
            Message::TaskListResponse { .. } => MessageType::ListTasks,
        }
    }
}

/// Protocol frame
#[derive(Debug, Clone)]
pub struct Frame {
    pub message_type: MessageType,
    pub payload: Vec<u8>,
}

impl Frame {
    const LENGTH_PREFIX_SIZE: usize = 4;
    const MESSAGE_TYPE_SIZE: usize = 1;
    const HEADER_SIZE: usize = Self::LENGTH_PREFIX_SIZE + Self::MESSAGE_TYPE_SIZE;
    const MAX_FRAME_SIZE: usize = 16 * 1024 * 1024; // 16MB

    /// Create a new frame from a message
    pub fn from_message(message: &Message) -> Result<Self> {
        let payload = bincode::serialize(message)
            .map_err(|e| CoreError::SerializationError(e.to_string()))?;

        if payload.len() > Self::MAX_FRAME_SIZE {
            return Err(CoreError::FrameTooLarge(payload.len()));
        }

        Ok(Frame {
            message_type: message.message_type(),
            payload,
        })
    }

    /// Encode frame to bytes
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(Self::HEADER_SIZE + self.payload.len());

        // Write length prefix (big-endian, includes message type + payload)
        let length = (Self::MESSAGE_TYPE_SIZE + self.payload.len()) as u32;
        buf.extend_from_slice(&length.to_be_bytes());

        // Write message type
        buf.push(self.message_type as u8);

        // Write payload
        buf.extend_from_slice(&self.payload);

        buf
    }

    /// Decode frame from bytes
    pub fn decode(bytes: &[u8]) -> Result<Self> {
        if bytes.len() < Self::HEADER_SIZE {
            return Err(CoreError::InvalidFrame(
                "Frame too short for header".to_string(),
            ));
        }

        let mut cursor = Cursor::new(bytes);

        // Read length prefix
        let mut length_bytes = [0u8; 4];
        cursor.read_exact(&mut length_bytes).map_err(|_| {
            CoreError::InvalidFrame("Failed to read length prefix".to_string())
        })?;
        let length = u32::from_be_bytes(length_bytes) as usize;

        if length > Self::MAX_FRAME_SIZE {
            return Err(CoreError::FrameTooLarge(length));
        }

        if bytes.len() < Self::HEADER_SIZE + length - 1 {
            return Err(CoreError::InvalidFrame(
                "Frame truncated".to_string(),
            ));
        }

        // Read message type
        let message_type_byte = bytes[4];
        let message_type = MessageType::from_byte(message_type_byte)?;

        // Read payload
        let payload = bytes[5..5 + length - 1].to_vec();

        Ok(Frame {
            message_type,
            payload,
        })
    }

    /// Parse frame into message
    pub fn into_message(self) -> Result<Message> {
        bincode::deserialize(&self.payload)
            .map_err(|e| CoreError::SerializationError(e.to_string()))
    }
}

/// Frame decoder for use with tokio
#[derive(Debug)]
pub struct FrameDecoder {
    buffer: BytesMut,
}

impl FrameDecoder {
    pub fn new() -> Self {
        Self {
            buffer: BytesMut::with_capacity(8192),
        }
    }

    /// Add data to the buffer
    pub fn add_data(&mut self, data: &[u8]) {
        self.buffer.extend_from_slice(data);
    }

    /// Try to decode a complete frame
    pub fn try_decode_frame(&mut self) -> Result<Option<Frame>> {
        // Need at least header to read length
        if self.buffer.len() < Frame::HEADER_SIZE {
            return Ok(None);
        }

        // Peek at length prefix
        let length = u32::from_be_bytes([
            self.buffer[0],
            self.buffer[1],
            self.buffer[2],
            self.buffer[3],
        ]) as usize;

        if length > Frame::MAX_FRAME_SIZE {
            self.buffer.clear();
            return Err(CoreError::FrameTooLarge(length));
        }

        // Check if we have the full frame
        if self.buffer.len() < Frame::HEADER_SIZE + length {
            return Ok(None);
        }

        // Extract the frame
        let frame_bytes = self.buffer[..Frame::HEADER_SIZE + length].to_vec();
        self.buffer.advance(Frame::HEADER_SIZE + length);

        Frame::decode(&frame_bytes).map(Some)
    }

    /// Clear buffer (for error recovery)
    pub fn clear(&mut self) {
        self.buffer.clear();
    }
}

impl Default for FrameDecoder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_type_roundtrip() {
        for i in 0..=16 {
            let mt = MessageType::from_byte(i).unwrap();
            assert_eq!(mt as u8, i);
        }

        assert!(MessageType::from_byte(99).is_err());
    }

    #[test]
    fn test_frame_encode_decode() {
        let task = Task::new(
            "test_task".to_string(),
            b"test payload".to_vec(),
            TaskPriority::normal(),
            None,
            30,
            3,
        )
        .unwrap();

        let message = Message::SubmitTask { task };
        let frame = Frame::from_message(&message).unwrap();
        let encoded = frame.encode();
        let decoded_frame = Frame::decode(&encoded).unwrap();
        let decoded_message = decoded_frame.into_message().unwrap();

        match decoded_message {
            Message::SubmitTask { task } => {
                assert_eq!(task.task_type, "test_task");
            }
            _ => panic!("Wrong message type"),
        }
    }

    #[test]
    fn test_frame_decoder() {
        let mut decoder = FrameDecoder::new();

        let message = Message::Ping;
        let frame = Frame::from_message(&message).unwrap();
        let encoded = frame.encode();

        // Add partial data
        decoder.add_data(&encoded[..encoded.len() / 2]);
        assert!(decoder.try_decode_frame().unwrap().is_none());

        // Add rest of data
        decoder.add_data(&encoded[encoded.len() / 2..]);
        let decoded_frame = decoder.try_decode_frame().unwrap().unwrap();
        let decoded_message = decoded_frame.into_message().unwrap();

        assert!(matches!(decoded_message, Message::Ping));
    }

    #[test]
    fn test_heartbeat_data() {
        let data = HeartbeatData {
            worker_id: "worker-1".to_string(),
            current_task_count: 2,
            cpu_usage_percent: 45.5,
            memory_usage_mb: 512,
        };

        let message = Message::Heartbeat { data: data.clone() };
        let frame = Frame::from_message(&message).unwrap();
        let encoded = frame.encode();
        let decoded_frame = Frame::decode(&encoded).unwrap();

        match decoded_frame.into_message().unwrap() {
            Message::Heartbeat { data: decoded } => {
                assert_eq!(decoded.worker_id, data.worker_id);
                assert_eq!(decoded.current_task_count, data.current_task_count);
            }
            _ => panic!("Wrong message type"),
        }
    }
}
