//! Error types for the task queue system.

use thiserror::Error;

/// Result type for task queue operations.
pub type Result<T> = std::result::Result<T, TaskQueueError>;

/// Error types for the task queue system.
#[derive(Error, Debug)]
pub enum TaskQueueError {
    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("Invalid task status: {0}")]
    InvalidStatus(String),

    #[error("Task already claimed by worker: {0}")]
    TaskAlreadyClaimed(String),

    #[error("Task execution failed: {0}")]
    ExecutionFailed(String),

    #[error("Task timeout exceeded")]
    TaskTimeout,

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Connection error: {0}")]
    ConnectionError(String),

    #[error("Database error: {0}")]
    DatabaseError(String),

    #[error("Invalid configuration: {0}")]
    ConfigError(String),

    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Authentication failed")]
    AuthenticationFailed,

    #[error("Insufficient permissions")]
    PermissionDenied,

    #[error("Queue depth exceeded")]
    QueueDepthExceeded,

    #[error("Broker not available")]
    BrokerUnavailable,

    #[error("Invalid message format")]
    InvalidMessageFormat,

    #[error("Worker not found: {0}")]
    WorkerNotFound(String),

    #[error("Cluster error: {0}")]
    ClusterError(String),

    #[error("Raft error: {0}")]
    RaftError(String),

    #[error("Internal error: {0}")]
    Internal(String),
}
