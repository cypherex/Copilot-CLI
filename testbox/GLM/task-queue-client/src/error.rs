//! Client error types

use thiserror::Error;

/// Client error type
#[derive(Debug, Error)]
pub enum ClientError {
    #[error("Connection error: {0}")]
    ConnectionError(String),

    #[error("Timeout")]
    Timeout,

    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("Invalid response: {0}")]
    InvalidResponse(String),

    #[error("Task failed: {0}")]
    TaskFailed(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Rate limited: retry after {0} seconds")]
    RateLimited(u64),

    #[error("Other error: {0}")]
    Other(String),
}

/// Result type alias
pub type Result<T> = std::result::Result<T, ClientError>;

impl From<task_queue_core::CoreError> for ClientError {
    fn from(err: task_queue_core::CoreError) -> Self {
        match err {
            task_queue_core::CoreError::ConnectionError(s) => ClientError::ConnectionError(s),
            task_queue_core::CoreError::Timeout => ClientError::Timeout,
            task_queue_core::CoreError::TaskNotFound(s) => ClientError::TaskNotFound(s),
            task_queue_core::CoreError::SerializationError(s) => ClientError::SerializationError(s),
            task_queue_core::CoreError::Unauthorized => ClientError::Unauthorized,
            task_queue_core::CoreError::RateLimited(n) => ClientError::RateLimited(n),
            _ => ClientError::Other(err.to_string()),
        }
    }
}

impl From<std::io::Error> for ClientError {
    fn from(err: std::io::Error) -> Self {
        ClientError::ConnectionError(err.to_string())
    }
}

impl From<tokio::time::error::Elapsed> for ClientError {
    fn from(_: tokio::time::error::Elapsed) -> Self {
        ClientError::Timeout
    }
}
