//! Task worker implementation

use crate::config::WorkerConfig;
use crate::handler::TaskHandlerRegistry;
use std::sync::Arc;
use std::time::Duration;
use task_queue_core::{
    error::{Result, TaskQueueError},
    message::{BrokerMessage, ClaimTaskResponse, MessageType, TaskResultPayload},
    protocol::{MessageCodec, MessageFrame},
    WorkerHeartbeat,
};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, RwLock, Semaphore};
use futures::{SinkExt, StreamExt};
use tokio::time::{timeout, Instant};
use tokio_util::codec::Framed;
use tracing::{debug, error, info, instrument, warn};

/// Worker ID generator
fn generate_worker_id() -> String {
    use std::process;
    use uuid::Uuid;
    
    let hostname = gethostname::gethostname()
        .into_string()
        .unwrap_or_else(|_| "unknown".to_string());
    let pid = process::id();
    let random = Uuid::new_v4().to_string()[..8].to_string();
    
    format!("{}-{}-{}", hostname, pid, random)
}

/// Worker connection to broker
struct WorkerConnection {
    stream: Framed<TcpStream, MessageCodec>,
    broker_address: String,
}

impl WorkerConnection {
    /// Connect to the broker with retry logic
    async fn connect_with_retry(
        broker_address: &str,
        max_retries: u32,
        base_backoff_ms: u64,
        max_backoff_ms: u64,
    ) -> Result<Self> {
        let mut retry_count = 0;
        
        loop {
            match TcpStream::connect(broker_address).await {
                Ok(stream) => {
                    info!("Connected to broker at {}", broker_address);
                    return Ok(Self {
                        stream: Framed::new(stream, MessageCodec),
                        broker_address: broker_address.to_string(),
                    });
                }
                Err(e) => {
                    retry_count += 1;
                    if retry_count >= max_retries {
                        error!(
                            "Failed to connect to broker after {} attempts: {}",
                            retry_count, e
                        );
                        return Err(TaskQueueError::Network(format!(
                            "Connection failed after {} retries: {}",
                            retry_count, e
                        )));
                    }
                    
                    // Calculate backoff delay
                    let delay_ms = (base_backoff_ms as u64)
                        .saturating_pow(retry_count - 1)
                        .min(max_backoff_ms);
                    let delay = Duration::from_millis(delay_ms);
                    
                    warn!(
                        "Connection attempt {} failed: {}. Retrying in {:.2}s",
                        retry_count, e, delay.as_secs_f64()
                    );
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }

    /// Send a message to the broker
    async fn send_message(&mut self, frame: MessageFrame) -> Result<()> {
        self.stream.send(frame).await.map_err(|e| {
            TaskQueueError::Network(format!("Failed to send message: {}", e))
        })
    }

    /// Receive a message from the broker
    async fn receive_message(&mut self) -> Result<MessageFrame> {
        self.stream.next().await.ok_or(TaskQueueError::Network(
            "Connection closed by broker".to_string(),
        ))?
    }

    /// Send a heartbeat message
    async fn send_heartbeat(&mut self, heartbeat: WorkerHeartbeat) -> Result<()> {
        let payload = serde_json::to_string(&heartbeat).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to serialize heartbeat: {}", e))
        })?;
        
        let msg = BrokerMessage::new(MessageType::Heartbeat, payload);
        let frame = MessageFrame::new(MessageType::Heartbeat.as_u8(), msg.payload.into_bytes());
        
        self.send_message(frame).await
    }

    /// Send task result to broker
    async fn send_task_result(&mut self, result: TaskResultPayload) -> Result<()> {
        let payload = serde_json::to_string(&result).map_err(|e| {
            TaskQueueError::Serialization(format!("Failed to serialize task result: {}", e))
        })?;
        
        let msg = BrokerMessage::new(MessageType::TaskResult, payload);
        let frame = MessageFrame::new(MessageType::TaskResult.as_u8(), msg.payload.into_bytes());
        
        self.send_message(frame).await
    }

    /// Request a task from the broker
    async fn claim_task(&mut self, worker_id: &str) -> Result<Option<ClaimTaskResponse>> {
        let payload = serde_json::json!({ "worker_id": worker_id }).to_string();
        let msg = BrokerMessage::new(MessageType::ClaimTask, payload);
        let frame = MessageFrame::new(MessageType::ClaimTask.as_u8(), msg.payload.into_bytes());
        
        self.send_message(frame).await?;
        
        match self.receive_message().await {
            Ok(response_frame) => {
                if response_frame.message_type == MessageType::Ack.as_u8() {
                    // No task available
                    return Ok(None);
                }
                
                if response_frame.message_type == MessageType::ClaimTask.as_u8() {
                    let response: ClaimTaskResponse = serde_json::from_slice(&response_frame.payload)
                        .map_err(|e| {
                            TaskQueueError::Serialization(format!(
                                "Failed to deserialize claim response: {}",
                                e
                            ))
                        })?;
                    return Ok(Some(response));
                }
                
                Err(TaskQueueError::Network(format!(
                    "Unexpected message type: {}",
                    response_frame.message_type
                )))
            }
            Err(e) => Err(e),
        }
    }
}

/// Task queue worker
pub struct Worker {
    config: WorkerConfig,
    handler_registry: Arc<TaskHandlerRegistry>,
    worker_id: String,
    shutdown_tx: Option<mpsc::Sender<()>>,
}

impl Worker {
    /// Create a new worker with default configuration
    pub fn new(handler_registry: TaskHandlerRegistry) -> Self {
        let config = WorkerConfig::default();
        let worker_id = generate_worker_id();
        
        Self {
            config,
            handler_registry: Arc::new(handler_registry),
            worker_id,
            shutdown_tx: None,
        }
    }

    /// Create a new worker with custom configuration
    pub fn with_config(config: WorkerConfig, handler_registry: TaskHandlerRegistry) -> Self {
        let worker_id = generate_worker_id();
        
        Self {
            config,
            handler_registry: Arc::new(handler_registry),
            worker_id,
            shutdown_tx: None,
        }
    }

    /// Get the worker ID
    pub fn worker_id(&self) -> &str {
        &self.worker_id
    }

    /// Start the worker and begin processing tasks
    ///
    /// This method runs until shutdown is triggered or an unrecoverable error occurs.
    #[instrument(skip(self))]
    pub async fn run(&mut self) -> Result<()> {
        info!("Starting worker {}", self.worker_id);
        
        // Create shutdown channel
        let (shutdown_tx, mut shutdown_rx) = mpsc::channel::<()>(1);
        self.shutdown_tx = Some(shutdown_tx.clone());
        
        // Create connection
        let mut connection = WorkerConnection::connect_with_retry(
            &self.config.broker_address(),
            self.config.broker.max_retries,
            self.config.broker.base_backoff_ms,
            self.config.broker.max_backoff_ms,
        ).await?;
        
        // Create semaphore for concurrency control
        let semaphore = Arc::new(Semaphore::new(self.config.worker.concurrency));
        let active_tasks = Arc::new(RwLock::new(0usize));
        
        // Start heartbeat task
        let heartbeat_tx = self.start_heartbeat_task(
            self.worker_id.clone(),
            active_tasks.clone(),
            shutdown_tx.clone(),
        );
        
        info!("Worker {} ready to process tasks", self.worker_id);
        
        // Main task processing loop
        loop {
            tokio::select! {
                // Check for shutdown signal
                _ = shutdown_rx.recv() => {
                    info!("Shutdown signal received");
                    break;
                }
                
                // Poll for tasks
                result = connection.claim_task(&self.worker_id) => {
                    match result {
                        Ok(Some(task)) => {
                            // Check if we have capacity
                            let permit = match Arc::clone(&semaphore).try_acquire_owned() {
                                Ok(p) => p,
                                Err(_) => {
                                    warn!("Worker at capacity ({} tasks), skipping task claim", self.config.worker.concurrency);
                                    // Try to return the task to broker or wait for capacity
                                    tokio::time::sleep(Duration::from_millis(100)).await;
                                    continue;
                                }
                            };
                            
                            let task_id = task.task_id;
                            let handler_registry = Arc::clone(&self.handler_registry);
                            let active_tasks = Arc::clone(&active_tasks);
                            let connection_addr = self.config.broker_address();
                            let lease_duration = Duration::from_secs(self.config.worker.lease_duration_secs);
                            
                            // Spawn task execution
                            tokio::spawn(async move {
                                // Increment active task count
                                *active_tasks.write().await += 1;
                                
                                let start_time = Instant::now();
                                let task_type = task.task_type.clone();
                                
                                debug!("Starting task {} of type {}", task_id, task_type);
                                
                                let result = Self::execute_task_with_timeout(
                                    &task,
                                    handler_registry.as_ref(),
                                    lease_duration,
                                ).await;
                                
                                let duration = start_time.elapsed();
                                
                                // Send result to broker
                                if let Err(e) = Self::send_task_result_to_broker(
                                    &connection_addr,
                                    &task_id,
                                    result,
                                    duration,
                                ).await {
                                    error!("Failed to send task result for {}: {}", task_id, e);
                                }
                                
                                // Decrement active task count
                                *active_tasks.write().await -= 1;
                                
                                drop(permit);
                            });
                        }
                        Ok(None) => {
                            // No tasks available, wait a bit before polling again
                            debug!("No tasks available, waiting...");
                            tokio::time::sleep(Duration::from_millis(500)).await;
                        }
                        Err(e) => {
                            error!("Failed to claim task: {}", e);
                            // Wait before retrying
                            tokio::time::sleep(Duration::from_secs(1)).await;
                        }
                    }
                }
            }
        }
        
        // Graceful shutdown
        info!("Worker {} initiating graceful shutdown", self.worker_id);
        
        // Cancel heartbeat task
        let _ = heartbeat_tx.send(()).await;
        
        // Wait for active tasks to complete
        info!("Waiting for active tasks to complete...");
        let timeout = Duration::from_secs(self.config.worker.graceful_shutdown_timeout_secs);
        
        let start = Instant::now();
        while *active_tasks.read().await > 0 && start.elapsed() < timeout {
            info!("{} active tasks remaining", *active_tasks.read().await);
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        
        let remaining = *active_tasks.read().await;
        if remaining > 0 {
            warn!(
                "Graceful shutdown timeout reached with {} tasks still in progress",
                remaining
            );
        } else {
            info!("All tasks completed. Worker {} shutting down.", self.worker_id);
        }
        
        Ok(())
    }

    /// Execute a task with timeout enforcement
    async fn execute_task_with_timeout(
        task: &ClaimTaskResponse,
        handler_registry: &TaskHandlerRegistry,
        lease_duration: Duration,
    ) -> std::result::Result<Vec<u8>, String> {
        let timeout_duration = Duration::from_secs(task.timeout_seconds);
        
        // Use the minimum of lease duration and task timeout
        let effective_timeout = timeout_duration.min(lease_duration);
        
        let result = timeout(
            effective_timeout,
            async {
                // Decode base64 payload
                use base64::Engine;
                let payload_bytes = base64::engine::general_purpose::STANDARD
                    .decode(&task.payload)
                    .map_err(|e| format!("Failed to decode payload: {}", e))?;
                
                handler_registry.execute_task(&task.task_type, payload_bytes).await
            },
        )
        .await;
        
        match result {
            Ok(inner_result) => inner_result,
            Err(_) => Err(format!(
                "Task timeout after {:.2}s",
                effective_timeout.as_secs_f64()
            )),
        }
    }

    /// Send task result to broker (reconnect if needed)
    async fn send_task_result_to_broker(
        broker_address: &str,
        task_id: &uuid::Uuid,
        result: std::result::Result<Vec<u8>, String>,
        duration: Duration,
    ) -> std::result::Result<(), TaskQueueError> {
        let payload = TaskResultPayload {
            task_id: *task_id,
            result: result.as_ref().ok().map(|data| {
                use base64::Engine;
                base64::engine::general_purpose::STANDARD.encode(data)
            }),
            error: result.as_ref().err().map(|e| e.clone()),
            duration_ms: duration.as_millis() as u64,
        };
        
        // Try to connect and send result with retry
        let mut connection = WorkerConnection::connect_with_retry(
            broker_address,
            3, // fewer retries for results
            1000,
            5000,
        )
        .await?;
        
        connection.send_task_result(payload).await?;
        
        Ok(())
    }

    /// Start the heartbeat task
    fn start_heartbeat_task(
        &self,
        worker_id: String,
        active_tasks: Arc<RwLock<usize>>,
        _shutdown_tx: mpsc::Sender<()>,
    ) -> mpsc::Sender<()> {
        let (cancel_tx, mut cancel_rx) = mpsc::channel::<()>(1);
        let broker_address = self.config.broker_address();
        let interval = Duration::from_secs(self.config.worker.heartbeat_interval_secs);
        
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            ticker.tick().await; // Skip first tick
            
            loop {
                tokio::select! {
                    _ = cancel_rx.recv() => {
                        info!("Heartbeat task stopping");
                        return;
                    }
                    _ = ticker.tick() => {
                        let task_count = *active_tasks.read().await;
                        let heartbeat = WorkerHeartbeat {
                            worker_id: worker_id.clone(),
                            current_task_count: task_count,
                            cpu_usage_percent: 0.0, // TODO: Implement actual CPU monitoring
                            memory_usage_mb: 0.0, // TODO: Implement actual memory monitoring
                            timestamp: chrono::Utc::now(),
                        };
                        
                        if let Err(e) = Self::send_heartbeat_to_broker(&broker_address, heartbeat).await {
                            warn!("Failed to send heartbeat: {}", e);
                        } else {
                            debug!("Heartbeat sent");
                        }
                    }
                }
            }
        });
        
        cancel_tx
    }

    /// Send heartbeat to broker
    async fn send_heartbeat_to_broker(
        broker_address: &str,
        heartbeat: WorkerHeartbeat,
    ) -> std::result::Result<(), TaskQueueError> {
        let mut connection = WorkerConnection::connect_with_retry(
            broker_address,
            1, // only one retry for heartbeat
            500,
            2000,
        )
        .await?;
        
        connection.send_heartbeat(heartbeat).await?;
        
        Ok(())
    }

    /// Trigger graceful shutdown
    pub async fn shutdown(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(()).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_worker_id() {
        let id1 = generate_worker_id();
        let id2 = generate_worker_id();
        
        assert!(id1.contains('-'));
        assert!(id1 != id2);
    }

    #[test]
    fn test_worker_creation() {
        let registry = TaskHandlerRegistry::new();
        let worker = Worker::new(registry);
        
        assert_eq!(worker.worker_id(), &worker.worker_id);
    }
}
