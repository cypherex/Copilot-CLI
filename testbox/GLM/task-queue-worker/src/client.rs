//! Broker client for worker communication

use bytes::BytesMut;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use task_queue_core::protocol::{Frame, FrameDecoder, Message, MessageType};
use task_queue_core::task::{Task, TaskPriority};
use task_queue_core::{CoreError, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::sleep;
use tracing::{debug, error, info, warn};

/// Broker client
pub struct BrokerClient {
    addr: String,
    stream: Option<TcpStream>,
    decoder: FrameDecoder,
}

impl BrokerClient {
    /// Connect to broker
    pub async fn connect(addr: &str) -> Result<Self> {
        info!("Connecting to broker at {}", addr);
        let stream = TcpStream::connect(addr).await
            .map_err(|e| CoreError::ConnectionError(format!("Failed to connect to broker: {}", e)))?;

        info!("Connected to broker at {}", addr);

        Ok(Self {
            addr: addr.to_string(),
            stream: Some(stream),
            decoder: FrameDecoder::new(),
        })
    }

    /// Reconnect to broker
    pub async fn reconnect(&mut self) -> Result<()> {
        warn!("Reconnecting to broker at {}", self.addr);
        
        if let Some(mut stream) = self.stream.take() {
            let _ = stream.shutdown().await;
        }

        let stream = TcpStream::connect(&self.addr).await
            .map_err(|e| CoreError::ConnectionError(format!("Failed to reconnect to broker: {}", e)))?;

        self.stream = Some(stream);
        self.decoder.clear();

        info!("Reconnected to broker");
        Ok(())
    }

    /// Send message and wait for response
    pub async fn send_message(&mut self, message: Message) -> Result<Message> {
        if self.stream.is_none() {
            self.reconnect().await?;
        }

        let frame = Frame::from_message(&message)?;
        let encoded = frame.encode();

        // Send message
        if let Some(stream) = &mut self.stream {
            stream.write_all(&encoded).await
                .map_err(|e| CoreError::ConnectionError(format!("Failed to send message: {}", e)))?;

            // Read response
            let mut response_bytes = Vec::new();
            let mut temp_buf = vec![0u8; 8192];

            loop {
                let n = stream.read(&mut temp_buf).await
                    .map_err(|e| CoreError::ConnectionError(format!("Failed to read response: {}", e)))?;

                if n == 0 {
                    return Err(CoreError::ConnectionError("Connection closed".to_string()));
                }

                response_bytes.extend_from_slice(&temp_buf[..n]);

                // Try to decode a frame
                self.decoder.add_data(&response_bytes);
                if let Some(response_frame) = self.decoder.try_decode_frame()? {
                    self.decoder.clear();
                    return response_frame.into_message();
                }
            }
        } else {
            Err(CoreError::ConnectionError("Not connected".to_string()))
        }
    }

    /// Register worker
    pub async fn register_worker(&mut self, worker_id: String, hostname: String, pid: u32, concurrency: u32) -> Result<()> {
        let message = Message::WorkerRegistration {
            worker_id,
            hostname,
            pid,
            concurrency,
        };

        match self.send_message(message).await? {
            Message::Ack { .. } => Ok(()),
            Message::Error { code, message } => Err(CoreError::Other(format!("Error {}: {}", code, message))),
            _ => Err(CoreError::Other("Unexpected response".to_string())),
        }
    }

    /// Deregister worker
    pub async fn deregister_worker(&mut self, worker_id: String) -> Result<()> {
        let message = Message::WorkerDeregistration { worker_id };

        match self.send_message(message).await? {
            Message::Ack { .. } => Ok(()),
            Message::Error { code, message } => Err(CoreError::Other(format!("Error {}: {}", code, message))),
            _ => Err(CoreError::Other("Unexpected response".to_string())),
        }
    }

    /// Claim a task
    pub async fn claim_task(&mut self, worker_id: String, max_priority: Option<TaskPriority>) -> Result<Option<Task>> {
        let message = Message::ClaimTask { worker_id, max_priority };

        match self.send_message(message).await? {
            Message::TaskAssigned { task } => Ok(Some(task)),
            Message::Error { code, message } if code == 404 => Ok(None), // No tasks available
            Message::Error { code, message } => Err(CoreError::Other(format!("Error {}: {}", code, message))),
            _ => Err(CoreError::Other("Unexpected response".to_string())),
        }
    }

    /// Send task result
    pub async fn send_result(&mut self, result: task_queue_core::task::TaskResult) -> Result<()> {
        let message = Message::TaskResult { result };

        match self.send_message(message).await? {
            Message::Ack { .. } => Ok(()),
            Message::Error { code, message } => Err(CoreError::Other(format!("Error {}: {}", code, message))),
            _ => Err(CoreError::Other("Unexpected response".to_string())),
        }
    }

    /// Send heartbeat
    pub async fn send_heartbeat(&mut self, data: task_queue_core::protocol::HeartbeatData) -> Result<()> {
        let message = Message::Heartbeat { data };

        match self.send_message(message).await? {
            Message::Pong => Ok(()),
            Message::Error { code, message } => Err(CoreError::Other(format!("Error {}: {}", code, message))),
            _ => Err(CoreError::Other("Unexpected response".to_string())),
        }
    }

    /// Long poll for a task with timeout
    pub async fn claim_task_with_timeout(
        &mut self,
        worker_id: String,
        max_priority: Option<TaskPriority>,
        timeout: Duration,
    ) -> Result<Option<Task>> {
        let start = std::time::Instant::now();

        while start.elapsed() < timeout {
            match self.claim_task(worker_id.clone(), max_priority).await {
                Ok(Some(task)) => return Ok(Some(task)),
                Ok(None) => {
                    // No task available, wait a bit and retry
                    sleep(Duration::from_secs(1)).await;
                }
                Err(e) => {
                    error!("Error claiming task: {}", e);
                    // Try to reconnect
                    sleep(Duration::from_secs(1)).await;
                    self.reconnect().await?;
                }
            }
        }

        Ok(None)
    }

    /// Close connection
    pub async fn close(mut self) {
        if let Some(mut stream) = self.stream.take() {
            let _ = stream.shutdown().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_frame_codec() {
        let message = Message::Ping;
        let frame = Frame::from_message(&message).unwrap();
        let encoded = frame.encode();

        let mut decoder = FrameDecoder::new();
        decoder.add_data(&encoded);
        let decoded_frame = decoder.try_decode_frame().unwrap().unwrap();
        let decoded_message = decoded_frame.into_message().unwrap();

        assert!(matches!(decoded_message, Message::Ping));
    }
}
