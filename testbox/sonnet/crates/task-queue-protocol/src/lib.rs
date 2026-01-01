mod message;
mod codec;

pub use message::{Message, MessageType, SubmitTaskRequest, ClaimTaskRequest, TaskResultRequest, HeartbeatRequest, QueryStatusRequest};
pub use codec::MessageCodec;

use thiserror::Error;

#[derive(Error, Debug)]
pub enum ProtocolError {
    #[error("Invalid message type: {0}")]
    InvalidMessageType(u8),

    #[error("Message too large: {0} bytes")]
    MessageTooLarge(usize),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] bincode::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Protocol error: {0}")]
    Protocol(String),
}

pub type Result<T> = std::result::Result<T, ProtocolError>;

/// Maximum message size: 11MB (to accommodate 10MB task payload + overhead)
pub const MAX_MESSAGE_SIZE: usize = 11 * 1024 * 1024;
