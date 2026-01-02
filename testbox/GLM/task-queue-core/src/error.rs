//! Error types for the task queue system

use crate::types::TaskStatus;
use thiserror::Error;

/// Core error type for the task queue system
#[derive(Error, Debug)]
pub enum TaskQueueError {
    /// Serialization or deserialization error
    #[error("Serialization error: {0}")]
    Serialization(String),

    /// Network error
    #[error("Network error: {0}")]
    Network(String),

    /// Task not found
    #[error("Task not found: {0}")]
    TaskNotFound(uuid::Uuid),

    /// Invalid task state transition
    #[error("Invalid task state transition from {from:?} to {to:?}")]
    InvalidStateTransition { from: TaskStatus, to: TaskStatus },

    /// Task timeout exceeded
    #[error("Task timeout exceeded: {0}s")]
    Timeout(u64),

    /// Max retries exhausted
    #[error("Max retries exhausted: {0}")]
    MaxRetriesExceeded(u32),

    /// Queue full
    #[error("Queue full: {0} tasks pending")]
    QueueFull(usize),

    /// Worker error
    #[error("Worker error: {0}")]
    Worker(String),

    /// Broker error
    #[error("Broker error: {0}")]
    Broker(String),

    /// Persistence error
    #[error("Persistence error: {0}")]
    Persistence(String),

    /// Configuration error
    #[error("Configuration error: {0}")]
    Configuration(String),

    /// Authentication error
    #[error("Authentication error: {0}")]
    Authentication(String),

    /// Authorization error
    #[error("Authorization error: {0}")]
    Authorization(String),

    /// Rate limit exceeded
    #[error("Rate limit exceeded: retry after {0}s")]
    RateLimitExceeded(u64),

    /// IO error
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// Generic error
    #[error("{0}")]
    Other(String),
}

/// Result type alias for task queue operations
pub type Result<T> = std::result::Result<T, TaskQueueError>;
