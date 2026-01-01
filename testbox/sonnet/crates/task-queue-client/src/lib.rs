mod async_client;
mod sync_client;

pub use async_client::TaskQueueAsyncClient;
pub use sync_client::TaskQueueClient;

use thiserror::Error;

#[derive(Error, Debug)]
pub enum ClientError {
    #[error("Connection error: {0}")]
    ConnectionError(String),

    #[error("Protocol error: {0}")]
    ProtocolError(String),

    #[error("Task not found")]
    TaskNotFound,

    #[error("Timeout")]
    Timeout,

    #[error("Server error: {0}")]
    ServerError(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, ClientError>;
