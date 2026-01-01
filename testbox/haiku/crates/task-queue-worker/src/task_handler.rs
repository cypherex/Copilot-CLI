//! Task handler traits and utilities.

use async_trait::async_trait;

/// Trait for task handlers.
#[async_trait]
pub trait TaskHandler: Send + Sync {
    /// Execute the task with given payload.
    async fn execute(&self, payload: Vec<u8>) -> Result<Vec<u8>, String>;
}

/// Simple handler that returns input as output.
pub struct EchoHandler;

#[async_trait]
impl TaskHandler for EchoHandler {
    async fn execute(&self, payload: Vec<u8>) -> Result<Vec<u8>, String> {
        Ok(payload)
    }
}
