//! Core error types

use std::io;

/// Core error type
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("Invalid priority value: {0}")]
    InvalidPriority(u8),

    #[error("Invalid status: {0}")]
    InvalidStatus(String),

    #[error("Payload too large: {0} bytes (max: {} bytes)", crate::task::MAX_PAYLOAD_SIZE)]
    PayloadTooLarge(usize),

    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("Worker not found: {0}")]
    WorkerNotFound(String),

    #[error("Invalid task ID: {0}")]
    InvalidTaskId(String),

    #[error("Invalid message type: {0}")]
    InvalidMessageType(u8),

    #[error("Invalid frame: {0}")]
    InvalidFrame(String),

    #[error("Frame too large: {0} bytes (max: {} bytes)", crate::protocol::Frame::MAX_FRAME_SIZE)]
    FrameTooLarge(usize),

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Deserialization error: {0}")]
    DeserializationError(String),

    #[error("Connection error: {0}")]
    ConnectionError(String),

    #[error("Timeout")]
    Timeout,

    #[error("Task cancelled")]
    TaskCancelled,

    #[error("Task already in progress")]
    TaskInProgress,

    #[error("Max retries exceeded")]
    MaxRetriesExceeded,

    #[error("Dependencies not satisfied")]
    DependenciesNotSatisfied,

    #[error("Lease expired")]
    LeaseExpired,

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Rate limited: retry after {0} seconds")]
    RateLimited(u64),

    #[error("IO error: {0}")]
    IoError(#[from] io::Error),

    #[error("Other error: {0}")]
    Other(String),
}

/// Result type alias
pub type Result<T> = std::result::Result<T, CoreError>;
