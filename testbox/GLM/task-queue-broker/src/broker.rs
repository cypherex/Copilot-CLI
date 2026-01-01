//! Main broker implementation

use crate::config::BrokerConfig;
use crate::storage::{Storage, RocksDBStorage};
use crate::worker_manager::{WorkerManager, WorkerStats};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use task_queue_core::protocol::{Frame, Message, MessageType};
use task_queue_core::task::{Task, TaskId, TaskPriority, TaskStatus};
use task_queue_core::{CoreError, Result};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, RwLock};
use tokio::time::{interval, Instant};
use tracing::{debug, error, info, warn};

/// Main broker
pub struct Broker {
    config: BrokerConfig,
    storage: Arc<RocksDBStorage>,
    worker_manager: Arc<WorkerManager>,
    task_broadcast_tx: mpsc::UnboundedSender<TaskUpdate>,
    _shutdown_rx: mpsc::Receiver<()>,
}

#[derive(Debug, Clone)]
pub struct TaskUpdate {
    pub task_id: TaskId,
    pub status: TaskStatus,
    pub result: Option<task_queue_core::task::TaskResult>,
}

impl Broker {
    /// Create a new broker
    pub async fn new(config: BrokerConfig) -> Result<Self> {
        // Initialize storage
        let storage = Arc::new(RocksDBStorage::open(&config.persistence)?);

        // Initialize worker manager
        let worker_manager = Arc::new(WorkerManager::new(
            config.worker.lease_timeout_secs,
        ));

        // Task broadcast channel
        let (task_broadcast_tx, _) = mpsc::unbounded_channel();

        // Shutdown channel
        let (_, shutdown_rx) = mpsc::channel(1);

        info!("Broker initialized");

        Ok(Self {
            config,
            storage,
            worker_manager,
            task_broadcast_tx,
            _shutdown_rx: shutdown_rx,
        })
    }

    /// Start the broker
    pub async fn run(&self) -> Result<()> {
        info!("Starting broker on {}:{}", self.config.broker.host, self.config.broker.port);

        let addr = format!("{}:{}", self.config.broker.host, self.config.broker.port);
        let listener = TcpListener::bind(&addr).await?;

        info!("Broker listening on {}", addr);

        // Spawn background tasks
        self.spawn_heartbeat_checker().await;
        self.spawn_task_retry_scheduler().await;
        self.spawn_dead_letter_processor().await;

        // Accept connections
        loop {
            match listener.accept().await {
                Ok((socket, addr)) => {
                    debug!("New connection from: {}", addr);
                    let handler = ConnectionHandler::new(
                        socket,
                        self.storage.clone(),
                        self.worker_manager.clone(),
                        self.task_broadcast_tx.clone(),
                        self.config.clone(),
                    );
                    tokio::spawn(async move {
                        if let Err(e) = handler.handle().await {
                            warn!("Connection error: {}", e);
                        }
                    });
                }
                Err(e) => {
                    error!("Accept error: {}", e);
                }
            }
        }
    }

    /// Spawn heartbeat checker task
    async fn spawn_heartbeat_checker(&self) {
        let worker_manager = self.worker_manager.clone();
        let storage = self.storage.clone();

        tokio::spawn(async move {
            let mut interval = interval(Duration::from_secs(10));
            loop {
                interval.tick().await;

                // Check for dead workers
                let dead_workers = worker_manager.check_dead_workers().await;

                for (worker_id, task_ids) in dead_workers {
                    warn!("Worker {} died, reclaiming {} tasks", worker_id, task_ids.len());

                    // Reclaim tasks
                    for task_id in task_ids {
                        if let Ok(Some(mut task)) = storage.get_task(task_id).await {
                            if task.status == TaskStatus::InProgress {
                                info!("Reclaiming task {} from dead worker", task_id);
                                task.status = TaskStatus::Pending;
                                task.worker_id = None;
                                task.lease_expires_at = None;
                                task.updated_at = chrono::Utc::now();

                                // Move back to pending queue
                                if let Err(e) = storage.update_task(&task).await {
                                    error!("Failed to reclaim task {}: {}", task_id, e);
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    /// Spawn task retry scheduler
    async fn spawn_task_retry_scheduler(&self) {
        let storage = self.storage.clone();

        tokio::spawn(async move {
            let mut interval = interval(Duration::from_secs(5));
            loop {
                interval.tick().await;

                // Check for failed tasks that can be retried
                if let Ok(failed_tasks) = storage.get_failed_tasks(100).await {
                    for mut task in failed_tasks {
                        if task.can_retry() {
                            let scheduled_at = chrono::Utc::now() + chrono::Duration::seconds(task.retry_delay().as_secs() as i64);
                            task.reset_for_retry(scheduled_at);

                            if let Err(e) = storage.update_task(&task).await {
                                error!("Failed to reschedule task {}: {}", task.id, e);
                            } else {
                                info!("Rescheduled task {} for retry (attempt {}/{})", 
                                    task.id, task.retry_count, task.max_retries);
                            }
                        } else {
                            // Move to dead letter queue
                            task.to_dead_letter();
                            if let Err(e) = storage.update_task(&task).await {
                                error!("Failed to move task {} to dead letter: {}", task.id, e);
                            } else {
                                warn!("Task {} moved to dead letter queue (max retries exceeded)", task.id);
                            }
                        }
                    }
                }
            }
        });
    }

    /// Spawn dead letter processor
    async fn spawn_dead_letter_processor(&self) {
        let storage = self.storage.clone();
        let retention_days = self.config.persistence.completed_task_retention_days;

        tokio::spawn(async move {
            let mut interval = interval(Duration::from_secs(3600)); // Run every hour

            loop {
                interval.tick().await;

                // Clean up old completed tasks
                let cutoff = chrono::Utc::now() - chrono::Duration::days(retention_days as i64);

                if let Ok(completed_tasks) = storage.get_completed_tasks(1000).await {
                    for task in completed_tasks {
                        if let Some(result) = &task.result {
                            if result.completed_at < cutoff {
                                if let Err(e) = storage.delete_task(task.id).await {
                                    error!("Failed to delete old task {}: {}", task.id, e);
                                } else {
                                    debug!("Deleted old completed task {}", task.id);
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    /// Submit a task
    pub async fn submit_task(&self, mut task: Task) -> Result<TaskId> {
        // Check dependencies
        if !task.dependencies.is_empty() {
            // Would need to check if dependencies exist and are completed
            // For now, just submit
        }

        self.storage.store_task(&task).await?;

        info!("Task submitted: {} (type={}, priority={})", 
            task.id, task.task_type, task.priority.value());

        Ok(task.id)
    }

    /// Get task status
    pub async fn get_task_status(&self, task_id: TaskId) -> Result<Option<Task>> {
        self.storage.get_task(task_id).await
    }

    /// Cancel a task
    pub async fn cancel_task(&self, task_id: TaskId) -> Result<bool> {
        if let Some(mut task) = self.storage.get_task(task_id).await? {
            if task.status == TaskStatus::Pending {
                self.storage.delete_task(task_id).await?;
                info!("Task cancelled: {}", task_id);
                return Ok(true);
            }
            return Err(CoreError::TaskInProgress);
        }
        Err(CoreError::TaskNotFound(task_id.to_string()))
    }

    /// List tasks
    pub async fn list_tasks(
        &self,
        status: Option<TaskStatus>,
        task_type: Option<String>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<Task>> {
        // Get tasks based on status
        let tasks = match status {
            Some(TaskStatus::Pending) => self.storage.get_pending_tasks(limit + offset).await?,
            Some(TaskStatus::InProgress) => self.storage.get_in_progress_tasks().await?,
            Some(TaskStatus::Completed) => self.storage.get_completed_tasks(limit + offset).await?,
            Some(TaskStatus::Failed) => self.storage.get_failed_tasks(limit + offset).await?,
            Some(TaskStatus::DeadLetter) => {
                self.storage.get_dead_letter_tasks(limit + offset).await?
            }
            None => {
                // Get from all queues
                let mut all_tasks = Vec::new();
                all_tasks.extend(self.storage.get_pending_tasks(limit).await?);
                all_tasks.extend(self.storage.get_in_progress_tasks().await?);
                all_tasks
            }
        };

        // Filter by task type if specified
        let filtered: Vec<Task> = if let Some(task_type) = task_type {
            tasks.into_iter()
                .filter(|t| t.task_type == task_type)
                .collect()
        } else {
            tasks
        };

        // Apply offset and limit
        let start = offset.min(filtered.len());
        let end = (offset + limit).min(filtered.len());
        Ok(filtered[start..end].to_vec())
    }

    /// Get statistics
    pub async fn get_stats(&self) -> Result<BrokerStats> {
        let pending_count = self.storage.count_tasks("pending").await?;
        let in_progress_count = self.storage.count_tasks("in_progress").await?;
        let completed_count = self.storage.count_tasks("completed").await?;
        let failed_count = self.storage.count_tasks("failed").await?;
        let dead_letter_count = self.storage.count_tasks("dead_letter").await?;

        let worker_stats = self.worker_manager.get_stats().await;

        // Calculate completed in last hour
        let completed_last_hour = {
            let tasks = self.storage.get_completed_tasks(1000).await?;
            let cutoff = chrono::Utc::now() - chrono::Duration::hours(1);
            tasks.iter()
                .filter(|t| {
                    t.result.as_ref()
                        .map(|r| r.completed_at > cutoff)
                        .unwrap_or(false)
                })
                .count() as u64
        };

        // Calculate failed in last hour
        let failed_last_hour = {
            let tasks = self.storage.get_failed_tasks(1000).await?;
            let cutoff = chrono::Utc::now() - chrono::Duration::hours(1);
            tasks.iter()
                .filter(|t| t.updated_at > cutoff)
                .count() as u64
        };

        // Calculate average processing time (simplified)
        let avg_processing_time_ms = {
            let tasks = self.storage.get_completed_tasks(100).await?;
            if tasks.is_empty() {
                0.0
            } else {
                let total: u64 = tasks.iter()
                    .filter_map(|t| t.result.as_ref().map(|r| r.processing_duration_ms))
                    .sum();
                total as f64 / tasks.len() as f64
            }
        };

        // Get queue depth by priority
        let pending_tasks = self.storage.get_pending_tasks(100000).await?;
        let queue_depth = QueueDepthByPriority {
            high: pending_tasks.iter().filter(|t| t.priority.is_high()).count() as u64,
            normal: pending_tasks.iter().filter(|t| t.priority.is_normal()).count() as u64,
            low: pending_tasks.iter().filter(|t| t.priority.is_low()).count() as u64,
        };

        Ok(BrokerStats {
            pending_count,
            in_progress_count,
            completed_count,
            failed_count,
            dead_letter_count,
            completed_last_hour,
            failed_last_hour,
            worker_count: worker_stats.total_workers,
            alive_workers: worker_stats.alive_workers,
            active_workers: worker_stats.active_workers,
            avg_processing_time_ms,
            queue_depth_by_priority: queue_depth,
        })
    }
}

#[derive(Debug, Clone)]
pub struct BrokerStats {
    pub pending_count: u64,
    pub in_progress_count: u64,
    pub completed_count: u64,
    pub failed_count: u64,
    pub dead_letter_count: u64,
    pub completed_last_hour: u64,
    pub failed_last_hour: u64,
    pub worker_count: u64,
    pub alive_workers: u64,
    pub active_workers: u64,
    pub avg_processing_time_ms: f64,
    pub queue_depth_by_priority: QueueDepthByPriority,
}

#[derive(Debug, Clone)]
pub struct QueueDepthByPriority {
    pub high: u64,
    pub normal: u64,
    pub low: u64,
}

/// Connection handler for individual TCP connections
struct ConnectionHandler {
    socket: tokio::net::TcpStream,
    storage: Arc<RocksDBStorage>,
    worker_manager: Arc<WorkerManager>,
    task_broadcast_tx: mpsc::UnboundedSender<TaskUpdate>,
    config: BrokerConfig,
    worker_id: Option<String>,
}

impl ConnectionHandler {
    fn new(
        socket: tokio::net::TcpStream,
        storage: Arc<RocksDBStorage>,
        worker_manager: Arc<WorkerManager>,
        task_broadcast_tx: mpsc::UnboundedSender<TaskUpdate>,
        config: BrokerConfig,
    ) -> Self {
        Self {
            socket,
            storage,
            worker_manager,
            task_broadcast_tx,
            config,
            worker_id: None,
        }
    }

    async fn handle(&mut self) -> Result<()> {
        let (reader, mut writer) = self.socket.split();
        let mut decoder = task_queue_core::protocol::FrameDecoder::new();
        let mut buffer = vec![0u8; 8192];

        loop {
            match reader.read(&mut buffer).await {
                Ok(0) => {
                    debug!("Connection closed");
                    break;
                }
                Ok(n) => {
                    decoder.add_data(&buffer[..n]);

                    while let Some(frame) = decoder.try_decode_frame()? {
                        let response = self.handle_message(frame.into_message()?).await?;
                        let response_frame = Frame::from_message(&response)?;
                        writer.write_all(&response_frame.encode()).await?;
                    }
                }
                Err(e) => {
                    error!("Read error: {}", e);
                    break;
                }
            }
        }

        // Deregister worker if registered
        if let Some(worker_id) = &self.worker_id {
            let task_ids = self.worker_manager.deregister_worker(worker_id).await;
            info!("Worker {} disconnected", worker_id);

            // Reclaim tasks
            for task_id in task_ids {
                if let Ok(Some(mut task)) = self.storage.get_task(task_id).await {
                    if task.status == TaskStatus::InProgress {
                        task.status = TaskStatus::Pending;
                        task.worker_id = None;
                        task.lease_expires_at = None;
                        let _ = self.storage.update_task(&task).await;
                    }
                }
            }
        }

        Ok(())
    }

    async fn handle_message(&mut self, message: Message) -> Result<Message> {
        match message {
            Message::SubmitTask { task } => {
                let task_id = self.submit_task_internal(task).await?;
                Ok(Message::Ack {
                    message_id: task_id.to_string(),
                })
            }
            Message::ClaimTask { worker_id, max_priority } => {
                self.handle_claim_task(worker_id, max_priority).await
            }
            Message::TaskResult { result } => {
                self.handle_task_result(result).await?;
                Ok(Message::Ack {
                    message_id: result.task_id.to_string(),
                })
            }
            Message::Heartbeat { data } => {
                self.handle_heartbeat(data).await;
                Ok(Message::Pong)
            }
            Message::QueryStatus { task_id } => {
                self.handle_query_status(task_id).await
            }
            Message::WorkerRegistration { worker_id, hostname, pid, concurrency } => {
                self.handle_worker_registration(worker_id, hostname, pid, concurrency).await;
                Ok(Message::Ack {
                    message_id: format!("registered_{}", worker_id),
                })
            }
            Message::WorkerDeregistration { worker_id } => {
                self.handle_worker_deregistration(worker_id).await;
                Ok(Message::Ack {
                    message_id: format!("deregistered_{}", worker_id),
                })
            }
            Message::Ping => Ok(Message::Pong),
            _ => Ok(Message::Error {
                code: 400,
                message: "Unsupported message type".to_string(),
            }),
        }
    }

    async fn submit_task_internal(&self, task: Task) -> Result<TaskId> {
        self.storage.store_task(&task).await?;
        Ok(task.id)
    }

    async fn handle_claim_task(
        &mut self,
        worker_id: String,
        _max_priority: Option<TaskPriority>,
    ) -> Result<Message> {
        // Register worker ID if first claim
        if self.worker_id.is_none() {
            self.worker_id = Some(worker_id.clone());
        }

        // Get next available task
        let tasks = self.storage.get_pending_tasks(1).await?;
        
        if let Some(task) = tasks.first() {
            // Check if dependencies are satisfied (simplified)
            if !task.dependencies.is_empty() {
                return Ok(Message::Error {
                    code: 409,
                    message: "Task has unsatisfied dependencies".to_string(),
                });
            }

            // Claim the task
            let mut task = task.clone();
            let lease_duration = Duration::from_secs(self.config.worker.lease_timeout_secs);
            task.claim(worker_id.clone(), lease_duration);

            // Update storage
            self.storage.update_task(&task).await?;

            // Update worker manager
            self.worker_manager.claim_task(&worker_id, task.id).await;

            info!("Task {} claimed by worker {}", task.id, worker_id);

            return Ok(Message::TaskAssigned { task });
        }

        // No tasks available
        Ok(Message::Error {
            code: 404,
            message: "No tasks available".to_string(),
        })
    }

    async fn handle_task_result(&self, result: task_queue_core::task::TaskResult) -> Result<()> {
        let mut task = self.storage.get_task(result.task_id).await?
            .ok_or_else(|| CoreError::TaskNotFound(result.task_id.to_string()))?;

        if result.success {
            task.complete(result);
            info!("Task {} completed successfully by {}", result.task_id, result.worker_id);
        } else {
            task.fail(result.error_message.unwrap_or_else(|| "Unknown error".to_string()));
            warn!("Task {} failed: {:?}", result.task_id, result.error_message);
        }

        self.storage.update_task(&task).await?;

        // Release from worker
        self.worker_manager.release_task(&result.worker_id, result.task_id).await;

        // Broadcast update
        let _ = self.task_broadcast_tx.send(TaskUpdate {
            task_id: result.task_id,
            status: task.status.clone(),
            result: task.result.clone(),
        });

        Ok(())
    }

    async fn handle_heartbeat(&self, data: task_queue_core::protocol::HeartbeatData) {
        self.worker_manager.update_heartbeat(data).await;
    }

    async fn handle_query_status(&self, task_id: TaskId) -> Result<Message> {
        match self.storage.get_task(task_id).await? {
            Some(task) => Ok(Message::StatusResponse { task: Some(task) }),
            None => Ok(Message::Error {
                code: 404,
                message: "Task not found".to_string(),
            }),
        }
    }

    async fn handle_worker_registration(
        &mut self,
        worker_id: String,
        hostname: String,
        pid: u32,
        concurrency: u32,
    ) {
        self.worker_id = Some(worker_id.clone());
        self.worker_manager.register_worker(worker_id, hostname, pid, concurrency).await;
    }

    async fn handle_worker_deregistration(&mut self, worker_id: String) {
        let task_ids = self.worker_manager.deregister_worker(&worker_id).await;

        // Reclaim tasks
        for task_id in task_ids {
            if let Ok(Some(mut task)) = self.storage.get_task(task_id).await {
                if task.status == TaskStatus::InProgress {
                    task.status = TaskStatus::Pending;
                    task.worker_id = None;
                    task.lease_expires_at = None;
                    let _ = self.storage.update_task(&task).await;
                }
            }
        }
    }
}