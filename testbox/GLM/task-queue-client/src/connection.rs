//! Connection pool and management

use task_queue_core::error::{Result, TaskQueueError};
use tokio::net::TcpStream;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use task_queue_core::protocol::MessageFrame;

/// Connection pool configuration
#[derive(Debug, Clone)]
pub struct PoolConfig {
    /// Maximum number of connections in the pool
    pub max_size: usize,
    /// Connection timeout in seconds
    pub timeout_secs: u64,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            max_size: 10,
            timeout_secs: 30,
        }
    }
}

/// A managed connection to the broker
pub struct BrokerConnection {
    /// TCP stream
    stream: TcpStream,
}

impl BrokerConnection {
    /// Create a new connection
    pub async fn connect(addr: &str) -> Result<Self> {
        let stream = TcpStream::connect(addr)
            .await
            .map_err(|e| TaskQueueError::Network(format!("Failed to connect: {}", e)))?;

        Ok(Self { stream })
    }

    /// Send a message frame
    pub async fn send(&mut self, frame: MessageFrame) -> Result<()> {
        // Create frame: 4-byte length prefix (big-endian) | message_type | payload
        let length = (frame.payload.len() as u32).to_be_bytes();
        let mut buffer = Vec::with_capacity(4 + 1 + frame.payload.len());
        buffer.extend_from_slice(&length);
        buffer.push(frame.message_type);
        buffer.extend_from_slice(&frame.payload);

        self.stream
            .write_all(&buffer)
            .await
            .map_err(|e| TaskQueueError::Network(format!("Failed to send: {}", e)))?;
        Ok(())
    }

    /// Receive a message frame
    pub async fn receive(&mut self) -> Result<MessageFrame> {
        // Read length prefix
        let mut length_buf = [0u8; 4];
        self.stream
            .read_exact(&mut length_buf)
            .await
            .map_err(|e| TaskQueueError::Network(format!("Failed to read length: {}", e)))?;
        
        let length = u32::from_be_bytes(length_buf) as usize;

        // Read message type
        let mut type_buf = [0u8; 1];
        self.stream
            .read_exact(&mut type_buf)
            .await
            .map_err(|e| TaskQueueError::Network(format!("Failed to read message type: {}", e)))?;
        
        // Read payload
        let mut payload = vec![0u8; length];
        self.stream
            .read_exact(&mut payload)
            .await
            .map_err(|e| TaskQueueError::Network(format!("Failed to read payload: {}", e)))?;

        Ok(MessageFrame {
            message_type: type_buf[0],
            payload,
        })
    }

    /// Get the underlying stream
    pub fn stream(&self) -> &TcpStream {
        &self.stream
    }

    /// Get the underlying stream mutably
    pub fn stream_mut(&mut self) -> &mut TcpStream {
        &mut self.stream
    }
}

/// Connection pool for broker connections
#[derive(Clone)]
pub struct ConnectionPool {
    /// Broker address
    addr: String,
    /// Pool configuration
    config: PoolConfig,
    /// Semaphore for limiting connections
    semaphore: Arc<Semaphore>,
}

impl ConnectionPool {
    /// Create a new connection pool
    pub fn new(addr: String, config: PoolConfig) -> Self {
        Self {
            addr,
            config: config.clone(),
            semaphore: Arc::new(Semaphore::new(config.max_size)),
        }
    }

    /// Acquire a connection from the pool
    pub async fn acquire(&self) -> Result<BrokerConnection> {
        let _permit = self.semaphore.acquire().await.map_err(|e| {
            TaskQueueError::Network(format!("Failed to acquire permit: {}", e))
        })?;

        BrokerConnection::connect(&self.addr).await
    }
}