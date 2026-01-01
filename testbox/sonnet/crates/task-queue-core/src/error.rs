use thiserror::Error;

#[derive(Error, Debug)]
pub enum TaskError {
    #[error("Payload size exceeds maximum allowed size of {max} bytes (got {actual})")]
    PayloadTooLarge { max: usize, actual: usize },

    #[error("Invalid priority value: {0}")]
    InvalidPriority(u8),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] bincode::Error),

    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("Task already exists: {0}")]
    TaskAlreadyExists(String),

    #[error("Task in invalid state: expected {expected}, got {actual}")]
    InvalidState { expected: String, actual: String },

    #[error("Timeout exceeded")]
    Timeout,

    #[error("Maximum retries exceeded")]
    MaxRetriesExceeded,

    #[error("Dependency task failed: {0}")]
    DependencyFailed(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Other error: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, TaskError>;
