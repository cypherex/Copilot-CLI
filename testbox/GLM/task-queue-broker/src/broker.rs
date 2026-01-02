//! Task queue broker implementation
//!
//! The broker manages task queues, worker connections, and task distribution.

use crate::config::BrokerConfig;
use task_queue_core::{
    error::{Result, TaskQueueError},
    message::{
        BrokerMessage, ClaimTaskResponse, MessageType, QueueDepthByPriority, StatsResponse,
        SubmitTaskPayload, TaskResultPayload, TaskStatusResponse, WorkerHeartbeat,
    },
    priority::Priority,
    protocol::{MessageCodec, MessageFrame},
    task::Task,
    types::{QueueStats, TaskFailure, TaskResult, TaskStatus, WorkerStatus},
};
use task_queue_persistence::PersistenceManager;
use bytes::BytesMut;
use chrono::{DateTime, Duration, Utc};
use lru::LruCache;
use prometheus::{
    opts, register_counter, register_gauge, register_histogram, Counter, Gauge, Histogram,
};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::Arc,
    time::Instant,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{Mutex, RwLock, Semaphore},
    time::{sleep, timeout, Duration as TokioDuration},
};
use tokio_util::codec::Framed;
use tracing::{debug, error, info, instrument, warn};

/// Prometheus metrics
struct BrokerMetrics {
    tasks_total: Counter,
    tasks_pending: Gauge,
    tasks_in_progress: Gauge,
    task_processing_duration: Histogram,
    workers_connected: Gauge,
    broker_queue_depth: Gauge,
}

impl BrokerMetrics {
    fn new() -> Self {
        Self {
            tasks_total: register_counter!(
                "tq_tasks_total",
                "Total number of tasks processed"
            )
            .unwrap(),
            tasks_pending: register_gauge!(
                "tq_tasks_pending",
                "Number of pending tasks"
            )
            .unwrap(),
            tasks_in_progress: register_gauge!(
                "tq_tasks_in_progress",
                "Number of in-progress tasks"
            )
            .unwrap(),
            task_processing_duration: register_histogram!(
                "tq_task_processing_duration_seconds",
                "Task processing duration in seconds",
                prometheus::exponential_buckets(0.001, 2.0, 20).unwrap()
            )
            .unwrap(),
            workers_connected: register_gauge!(
                "tq_workers_connected",
                "Number of connected workers"
            )
            .unwrap(),
            broker_queue_depth: register_gauge!(
                "tq_broker_queue_depth",
                "Current queue depth by priority"
            )
            .unwrap(),
        }
    }
}

/// Worker information
#[derive(Debug, Clone)]
struct WorkerInfo {
    worker_id: String,
    addr: SocketAddr,
    status: WorkerStatus,
    current_tasks: Vec<uuid::Uuid>,
    last_heartbeat: DateTime<Utc>,
    cpu_usage_percent: f64,
    memory_usage_mb: f64,
}

/// Task queue entry with priority ordering
#[derive(Debug, Clone)]
struct TaskQueueEntry {
    task_id: uuid::Uuid,
    priority: Priority,
    scheduled_at: DateTime<Utc>,
}

impl PartialEq for TaskQueueEntry {
    fn eq(&self, other: &Self) -> bool {
        self.task_id == other.task_id
    }
}

impl Eq for TaskQueueEntry {}

impl PartialOrd for TaskQueueEntry {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for TaskQueueEntry {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Higher priority first
        match other.priority.cmp(&self.priority) {
            std::cmp::Ordering::Equal => {
                // Then by scheduled time (earlier first)
                self.scheduled_at.cmp(&other.scheduled_at)
            }
            other => other,
        }
    }
}

/// The main broker structure
pub struct Broker {
    config: Arc<BrokerConfig>,
    persistence: Arc<PersistenceManager>,
    pending_queue: Arc<Mutex<std::collections::BinaryHeap<TaskQueueEntry>>>,
    in_progress_tasks: Arc<RwLock<HashMap<uuid::Uuid, Task>>>,
    workers: Arc<RwLock<HashMap<String, WorkerInfo>>>,
    task_result_cache: Arc<Mutex<LruCache<uuid::Uuid, Task>>>,
    connection_semaphore: Arc<Semaphore>,
    metrics: BrokerMetrics,
}

impl Broker {
    /// Create a new broker instance
    pub async fn new(config: BrokerConfig) -> Result<Self> {
        info!("Creating broker with config: {:?}", config.broker);

        let persistence = Arc::new(PersistenceManager::open(&config.persistence.data_dir)?);

        // Load in-progress tasks on startup and reset them to pending
        let in_progress = persistence.get_in_progress_tasks()?;
        if !in_progress.is_empty() {
            info!(
                "Recovering {} in-progress tasks from previous run",
                in_progress.len()
            );
            for mut task in in_progress {
                task.status = TaskStatus::Pending;
                task.worker_id = None;
                task.lease_expires_at = None;
                persistence.store_task(&task)?;
            }
        }

        // Load pending tasks from persistence
        let pending = persistence.get_pending_tasks()?;
        let mut pending_queue = std::collections::BinaryHeap::new();
        for task in &pending {
            pending_queue.push(TaskQueueEntry {
                task_id: task.id,
                priority: task.priority,
                scheduled_at: task.scheduled_at,
            });
        }

        info!(
            "Loaded {} pending tasks from persistence",
            pending.len()
        );

        let task_result_cache = LruCache::new(std::num::NonZeroUsize::new(10000).unwrap());
        let connection_semaphore = Arc::new(Semaphore::new(config.broker.max_connections));

        Ok(Self {
            config: Arc::new(config),
            persistence,
            pending_queue: Arc::new(Mutex::new(pending_queue)),
            in_progress_tasks: Arc::new(RwLock::new(HashMap::new())),
            workers: Arc::new(RwLock::new(HashMap::new())),
            task_result_cache: Arc::new(Mutex::new(task_result_cache)),
            connection_semaphore,
            metrics: BrokerMetrics::new(),
        })
    }

    /// Start the broker server
    #[instrument(skip(self))]
    pub async fn run(self: Arc<Self>) -> Result<()> {
        let addr = format!("{}:{}", self.config.broker.host, self.config.broker.port);
        let listener = TcpListener::bind(&addr).await.map_err(|e| {
            TaskQueueError::Broker(format!("Failed to bind to {}: {}", addr, e))
        })?;

        info!("Broker listening on {}", addr);

        // Spawn background tasks
        let broker = self.clone();
        tokio::spawn(async move {
            broker.maintenance_task().await;
        });

        let broker = self.clone();
        tokio::spawn(async move {
            broker.lease_monitor_task().await;
        });

        let broker = self.clone();
        tokio::spawn(async move {
            broker.compaction_task().await;
        });

        // Accept connections
        loop {
            // Check semaphore for connection limit
            let permit = self
                .connection_semaphore
                .clone()
                .acquire_owned()
                .await
                .map_err(|e| TaskQueueError::Broker(format!("Semaphore error: {}", e)))?;

            match listener.accept().await {
                Ok((socket, addr)) => {
                    info!("New connection from {}", addr);
                    let broker = self.clone();
                    tokio::spawn(async move {
                        if let Err(e) = broker.handle_connection(socket, addr).await {
                            error!("Connection error from {}: {}", addr, e);
                        }
                        drop(permit);
                    });
                }
                Err(e) => {
                    error!("Failed to accept connection: {}", e);
                }
            }
        }
    }

    /// Handle a client connection
    async fn handle_connection(&self, mut socket: TcpStream, addr: SocketAddr) -> Result<()> {
        let framed = Framed::new(socket, MessageCodec);
        let (mut writer, mut reader) = framed.into_split();

        info!("Handling connection from {}", addr);

        loop {
            match timeout(TokioDuration::from_secs(30), reader.next()).await {
                Ok(Some(Ok(frame))) => {
                    let response = self.handle_message(frame, addr).await?;

                    // Send response if present
                    if let Some(resp_frame) = response {
                        writer.send(resp_frame).await.map_err(|e| {
                            TaskQueueError::Network(format!("Failed to send response: {}", e))
                        })?;
                    }
                }
                Ok(Some(Err(e))) => {
                    warn!("Protocol error from {}: {}", addr, e);
                    return Err(e);
                }
                Ok(None) => {
                    info!("Client {} disconnected", addr);
                    break;
                }
                Err(_) => {
                    debug!("Connection {} timed out", addr);
                    break;
                }
            }
        }

        Ok(())
    }

    /// Handle an incoming message
    #[instrument(skip(self, frame))]
    async fn handle_message(
        &self,
        frame: MessageFrame,
        addr: SocketAddr,
    ) -> Result<Option<MessageFrame>> {
        let message_type =
            MessageType::from_u8(frame.message_type).ok_or_else(|| {
                TaskQueueError::Broker(format!("Unknown message type: {}", frame.message_type))
            })?;

        debug!("Received {:?} message from {}", message_type, addr);

        match message_type {
            MessageType::SubmitTask => {
                let payload: SubmitTaskPayload = serde_json::from_slice(&frame.payload)?;
                let response = self.handle_submit_task(payload).await?;
                Ok(Some(self.encode_message(MessageType::Ack, response)?))
            }
            MessageType::ClaimTask => {
                let response = self.handle_claim_task().await?;
                Ok(Some(self.encode_message(MessageType::ClaimTask, response)?))
            }
            MessageType::TaskResult => {
                let payload: TaskResultPayload = serde_json::from_slice(&frame.payload)?;
                self.handle_task_result(payload).await?;
                Ok(Some(self.encode_message(MessageType::Ack, "{}".to_string())?))
            }
            MessageType::Heartbeat => {
                let heartbeat: WorkerHeartbeat = serde_json::from_slice(&frame.payload)?;
                self.handle_heartbeat(heartbeat, addr).await?;
                Ok(Some(self.encode_message(MessageType::Ack, "{}".to_string())?))
            }
            MessageType::QueryStatus => {
                let task_id: uuid::Uuid = serde_json::from_slice(&frame.payload)?;
                let response = self.handle_query_status(task_id).await?;
                Ok(Some(self.encode_message(MessageType::QueryStatus, response)?))
            }
            MessageType::CancelTask => {
                let task_id: uuid::Uuid = serde_json::from_slice(&frame.payload)?;
                self.handle_cancel_task(task_id).await?;
                Ok(Some(self.encode_message(MessageType::Ack, "{}".to_string())?))
            }
            MessageType::GetStats => {
                let response = self.handle_get_stats().await?;
                Ok(Some(self.encode_message(MessageType::GetStats, response)?))
            }
            MessageType::RegisterWorker => {
                let worker_id: String = serde_json::from_slice(&frame.payload)?;
                self.handle_register_worker(worker_id, addr).await?;
                Ok(Some(self.encode_message(MessageType::Ack, "{}".to_string())?))
            }
            MessageType::DeregisterWorker => {
                let worker_id: String = serde_json::from_slice(&frame.payload)?;
                self.handle_deregister_worker(worker_id).await?;
                Ok(Some(self.encode_message(MessageType::Ack, "{}".to_string())?))
            }
            _ => Ok(None),
        }
    }

    /// Encode a message
    fn encode_message(&self, msg_type: MessageType, payload: String) -> Result<MessageFrame> {
        Ok(MessageFrame::new(
            msg_type.as_u8(),
            payload.into_bytes(),
        ))
    }

    /// Handle task submission
    async fn handle_submit_task(&self, payload: SubmitTaskPayload) -> Result<String> {
        // Check queue depth for backpressure
        let pending_count = self.pending_queue.lock().await.len();
        if pending_count >= self.config.broker.queue_depth_threshold {
            return Err(TaskQueueError::QueueFull(pending_count));
        }

        // Decode payload from base64
        let payload_bytes =
            base64::decode(&payload.payload).map_err(|e| {
                TaskQueueError::Serialization(format!("Failed to decode payload: {}", e))
            })?;

        // Parse scheduled_at if provided
        let scheduled_at = if let Some(ref ts) = payload.scheduled_at {
            ts.parse::<DateTime<Utc>>().map_err(|e| {
                TaskQueueError::Serialization(format!("Invalid scheduled_at: {}", e))
            })?
        } else {
            Utc::now()
        };

        // Parse priority
        let priority = Priority::normal_custom(payload.priority);

        // Create task
        let mut task = Task::new(payload.task_type, payload_bytes, priority)?;
        task.scheduled_at = scheduled_at;
        task.timeout_seconds = payload.timeout_seconds;
        task.max_retries = payload.max_retries;

        // Add dependencies if provided
        if let Some(deps) = payload.dependencies {
            for dep_id in deps {
                task = task.with_dependency(dep_id);
            }
        }

        // Store in persistence
        self.persistence.store_task(&task)?;

        // Add to pending queue
        let task_id = task.id;
        let queue_entry = TaskQueueEntry {
            task_id,
            priority: task.priority,
            scheduled_at: task.scheduled_at,
        };
        self.pending_queue.lock().await.push(queue_entry);

        // Update metrics
        self.metrics.tasks_total.inc();

        info!("Submitted task {} (type: {}, priority: {})", task_id, task.task_type, task.priority);

        Ok(serde_json::json!({
            "task_id": task_id,
            "status": "pending"
        }).to_string())
    }

    /// Handle task claim request
    async fn handle_claim_task(&self) -> Result<String> {
        let mut queue = self.pending_queue.lock().await;

        // Find next ready task
        loop {
            match queue.pop() {
                Some(entry) => {
                    // Check if task is ready
                    if let Some(task) = self.persistence.get_task(entry.task_id)? {
                        if task.is_ready() {
                            // Load full task
                            drop(queue);

                            // Create lease expiration
                            let lease_duration = self.config.broker.worker_lease_timeout_secs;
                            let lease_expires_at = Utc::now() + Duration::seconds(lease_duration as i64);

                            // Update task to in-progress
                            let mut task = task;
                            task.status = TaskStatus::Pending; // Will be set to InProgress when claimed
                            self.persistence.store_task(&task)?;

                            // Move to in_progress map (without worker yet)
                            self.in_progress_tasks.write().await.insert(task.id, task.clone());

                            // Create response
                            let response = ClaimTaskResponse {
                                task_id: task.id,
                                task_type: task.task_type,
                                payload: base64::encode(&task.payload),
                                priority: task.priority.0,
                                timeout_seconds: task.timeout_seconds,
                                retry_count: task.retry_count,
                            };

                            info!("Claiming task {} for worker", task.id);

                            return Ok(serde_json::to_string(&response).unwrap());
                        } else {
                            // Not ready yet, push back
                            queue.push(entry);
                        }
                    }
                    // Task not found or deleted, continue searching
                }
                None => {
                    // No tasks available
                    return Ok("null".to_string());
                }
            }
        }
    }

    /// Handle task result submission
    async fn handle_task_result(&self, payload: TaskResultPayload) -> Result<()> {
        // Get task from in_progress
        let mut tasks = self.in_progress_tasks.write().await;
        let task = tasks.get(&payload.task_id).ok_or_else(|| {
            TaskQueueError::TaskNotFound(payload.task_id)
        })?;

        let mut task = task.clone();

        if let Some(error) = payload.error {
            // Task failed
            task.retry_count += 1;

            if task.retry_count >= task.max_retries {
                // Move to dead letter queue
                task.dead_letter();
                error!(
                    "Task {} exhausted retries, moving to dead letter queue",
                    payload.task_id
                );
            } else {
                // Calculate retry delay with exponential backoff
                let base_delay_secs = 5;
                let delay_secs = (base_delay_secs * 2u64.pow(task.retry_count - 1))
                    .min(3600); // Cap at 1 hour
                let scheduled_at = Utc::now() + Duration::seconds(delay_secs as i64);

                task.fail(TaskFailure {
                    error: error.clone(),
                    failed_at: Utc::now(),
                    retry_attempt: task.retry_count,
                });

                task.retry(scheduled_at);

                info!(
                    "Task {} failed (attempt {}/{}), retrying in {}s: {}",
                    payload.task_id,
                    task.retry_count,
                    task.max_retries,
                    delay_secs,
                    error
                );

                // Store and requeue
                self.persistence.store_task(&task)?;

                // Add back to pending queue
                let queue_entry = TaskQueueEntry {
                    task_id: task.id,
                    priority: task.priority,
                    scheduled_at: task.scheduled_at,
                };
                self.pending_queue.lock().await.push(queue_entry);

                tasks.remove(&payload.task_id);
                return Ok(());
            }
        } else {
            // Task succeeded
            let result_data = payload
                .result
                .map(|r| base64::decode(&r).unwrap_or_default())
                .unwrap_or_default();

            task.complete(TaskResult {
                data: result_data,
                duration_ms: payload.duration_ms,
            });

            info!("Task {} completed successfully", payload.task_id);
        }

        // Store updated task
        self.persistence.store_task(&task)?;

        // Update metrics
        if task.status == TaskStatus::Completed {
            self.metrics
                .task_processing_duration
                .observe(payload.duration_ms as f64 / 1000.0);
        }

        // Cache result
        self.task_result_cache.lock().await.put(task.id, task.clone());

        // Remove from in_progress
        tasks.remove(&payload.task_id);

        Ok(())
    }

    /// Handle worker heartbeat
    async fn handle_heartbeat(&self, heartbeat: WorkerHeartbeat, addr: SocketAddr) -> Result<()> {
        let mut workers = self.workers.write().await;

        if let Some(worker) = workers.get_mut(&heartbeat.worker_id) {
            worker.last_heartbeat = Utc::now();
            worker.cpu_usage_percent = heartbeat.cpu_usage_percent;
            worker.memory_usage_mb = heartbeat.memory_usage_mb;
            worker.current_task_count = heartbeat.current_task_count;
            debug!("Heartbeat from worker {}", heartbeat.worker_id);
        } else {
            // Auto-register worker if not exists
            workers.insert(
                heartbeat.worker_id.clone(),
                WorkerInfo {
                    worker_id: heartbeat.worker_id.clone(),
                    addr,
                    status: WorkerStatus::Alive,
                    current_tasks: Vec::new(),
                    last_heartbeat: Utc::now(),
                    cpu_usage_percent: heartbeat.cpu_usage_percent,
                    memory_usage_mb: heartbeat.memory_usage_mb,
                },
            );
            info!("Auto-registered worker {} from {}", heartbeat.worker_id, addr);

            // Update metrics
            self.metrics.workers_connected.set(workers.len() as f64);
        }

        Ok(())
    }

    /// Handle task status query
    async fn handle_query_status(&self, task_id: uuid::Uuid) -> Result<String> {
        // Check cache first
        if let Some(task) = self.task_result_cache.lock().await.get(&task_id) {
            return Ok(self.task_status_to_json(&task));
        }

        // Check in_progress
        let in_progress = self.in_progress_tasks.read().await;
        if let Some(task) = in_progress.get(&task_id) {
            return Ok(self.task_status_to_json(task));
        }
        drop(in_progress);

        // Check persistence
        if let Some(task) = self.persistence.get_task(task_id)? {
            return Ok(self.task_status_to_json(&task));
        }

        Err(TaskQueueError::TaskNotFound(task_id))
    }

    /// Convert task to JSON status response
    fn task_status_to_json(&self, task: &Task) -> String {
        let response = TaskStatusResponse {
            task_id: task.id,
            status: format!("{:?}", task.status),
            created_at: task.created_at.to_rfc3339(),
            updated_at: task.updated_at.to_rfc3339(),
            result: task.result.as_ref().map(|r| base64::encode(&r.data)),
            error: task.failure.as_ref().map(|f| f.error.clone()),
            retry_count: task.retry_count,
            worker_id: task.worker_id.clone(),
        };
        serde_json::to_string(&response).unwrap()
    }

    /// Handle task cancellation
    async fn handle_cancel_task(&self, task_id: uuid::Uuid) -> Result<()> {
        // Check if task is in pending queue
        let mut queue = self.pending_queue.lock().await;
        let mut found = false;

        // Collect all entries to process
        let mut entries: Vec<_> = queue.drain().collect();
        for entry in &entries {
            if entry.task_id == task_id {
                found = true;
                break;
            }
        }

        // Put back non-cancelled entries
        for entry in entries {
            if entry.task_id != task_id {
                queue.push(entry);
            }
        }

        if found {
            // Delete from persistence
            self.persistence.delete_task(task_id)?;
            info!("Cancelled task {}", task_id);
            return Ok(());
        }

        // Check if task is in progress
        let in_progress = self.in_progress_tasks.read().await;
        if in_progress.contains_key(&task_id) {
            return Err(TaskQueueError::Broker(format!(
                "Cannot cancel task {}: already in progress",
                task_id
            )));
        }

        Err(TaskQueueError::TaskNotFound(task_id))
    }

    /// Handle statistics request
    async fn handle_get_stats(&self) -> Result<String> {
        let pending_count = self.pending_queue.lock().await.len();
        let in_progress_count = self.in_progress_tasks.read().await.len();
        let workers_count = self.workers.read().await.len();

        // Get task counts from persistence by priority
        let pending_tasks = self.persistence.get_pending_tasks()?;
        let mut depth = QueueDepthByPriority::new();
        for task in &pending_tasks {
            if task.priority.is_high() {
                depth.high += 1;
            } else if task.priority.is_normal() {
                depth.normal += 1;
            } else {
                depth.low += 1;
            }
        }

        // Get completed and failed tasks from last hour
        let one_hour_ago = Utc::now() - Duration::hours(1);
        let completed = self.persistence.get_tasks_by_status(TaskStatus::Completed)?;
        let completed_last_hour = completed
            .iter()
            .filter(|t| t.updated_at >= one_hour_ago)
            .count() as u64;

        let failed = self.persistence.get_tasks_by_status(TaskStatus::Failed)?;
        let failed_last_hour = failed
            .iter()
            .filter(|t| t.updated_at >= one_hour_ago)
            .count() as u64;

        // Calculate average processing time (simplified)
        let avg_processing_time = if completed_last_hour > 0 {
            completed
                .iter()
                .filter(|t| t.updated_at >= one_hour_ago)
                .filter_map(|t| t.result.as_ref())
                .map(|r| r.duration_ms)
                .sum::<u64>() as f64 / completed_last_hour as f64
        } else {
            0.0
        };

        let response = StatsResponse {
            pending_count,
            in_progress_count,
            completed_last_hour,
            failed_last_hour,
            worker_count: workers_count,
            avg_processing_time_ms: avg_processing_time,
            queue_depth_by_priority: QueueDepthByPriority {
                high: depth.high,
                normal: depth.normal,
                low: depth.low,
            },
        };

        Ok(serde_json::to_string(&response).unwrap())
    }

    /// Handle worker registration
    async fn handle_register_worker(&self, worker_id: String, addr: SocketAddr) -> Result<()> {
        let mut workers = self.workers.write().await;

        if workers.contains_key(&worker_id) {
            return Err(TaskQueueError::Worker(format!(
                "Worker {} already registered",
                worker_id
            )));
        }

        workers.insert(
            worker_id.clone(),
            WorkerInfo {
                worker_id: worker_id.clone(),
                addr,
                status: WorkerStatus::Alive,
                current_tasks: Vec::new(),
                last_heartbeat: Utc::now(),
                cpu_usage_percent: 0.0,
                memory_usage_mb: 0.0,
            },
        );

        info!("Registered worker {} from {}", worker_id, addr);

        // Update metrics
        self.metrics.workers_connected.set(workers.len() as f64);

        Ok(())
    }

    /// Handle worker deregistration
    async fn handle_deregister_worker(&self, worker_id: String) -> Result<()> {
        let mut workers = self.workers.write().await;

        if workers.remove(&worker_id).is_some() {
            info!("Deregistered worker {}", worker_id);

            // Reclaim any tasks from this worker
            let mut in_progress = self.in_progress_tasks.write().await;
            let mut tasks_to_reclaim: Vec<Task> = Vec::new();

            in_progress.retain(|_, task| {
                if task.worker_id.as_ref() == Some(&worker_id) {
                    tasks_to_reclaim.push(task.clone());
                    false
                } else {
                    true
                }
            });

            // Requeue tasks
            for mut task in tasks_to_reclaim {
                warn!(
                    "Reclaiming task {} from deregistered worker {}",
                    task.id, worker_id
                );
                task.status = TaskStatus::Pending;
                task.worker_id = None;
                task.lease_expires_at = None;

                self.persistence.store_task(&task)?;

                let queue_entry = TaskQueueEntry {
                    task_id: task.id,
                    priority: task.priority,
                    scheduled_at: task.scheduled_at,
                };
                self.pending_queue.lock().await.push(queue_entry);
            }

            // Update metrics
            self.metrics.workers_connected.set(workers.len() as f64);

            Ok(())
        } else {
            Err(TaskQueueError::Worker(format!(
                "Worker {} not found",
                worker_id
            )))
        }
    }

    /// Background maintenance task
    async fn maintenance_task(self: Arc<Self>) {
        let interval_secs = self.config.worker.heartbeat_interval_secs as u64;
        let max_inactivity = Duration::seconds(
            self.config.worker.max_inactivity_secs as i64 * 2, // 2x heartbeat interval
        );

        info!("Starting maintenance task (interval: {}s)", interval_secs);

        loop {
            sleep(TokioDuration::from_secs(interval_secs)).await;

            let now = Utc::now();
            let mut workers_to_reclaim: Vec<String> = Vec::new();

            // Check for dead workers
            {
                let workers = self.workers.read().await;
                for (worker_id, worker) in workers.iter() {
                    if worker.status == WorkerStatus::Alive {
                        let inactive_duration = now.signed_duration_since(worker.last_heartbeat);
                        if inactive_duration > max_inactivity {
                            warn!(
                                "Worker {} is dead (inactive for {:.0}s)",
                                worker_id,
                                inactive_duration.num_seconds()
                            );
                            workers_to_reclaim.push(worker_id.clone());
                        }
                    }
                }
            }

            // Reclaim tasks from dead workers
            for worker_id in workers_to_reclaim {
                if let Err(e) = self.handle_deregister_worker(worker_id).await {
                    error!("Failed to reclaim tasks from worker: {}", e);
                }
            }

            // Update pending task gauge
            let pending_count = self.pending_queue.lock().await.len();
            self.metrics.tasks_pending.set(pending_count as f64);

            // Update in-progress task gauge
            let in_progress_count = self.in_progress_tasks.read().await.len();
            self.metrics.tasks_in_progress.set(in_progress_count as f64);
        }
    }

    /// Background lease monitor task
    async fn lease_monitor_task(self: Arc<Self>) {
        let check_interval = TokioDuration::from_secs(10);

        info!("Starting lease monitor task");

        loop {
            sleep(check_interval).await;

            let now = Utc::now();
            let mut expired_tasks: Vec<uuid::Uuid> = Vec::new();

            // Check for expired leases
            {
                let in_progress = self.in_progress_tasks.read().await;
                for (task_id, task) in in_progress.iter() {
                    if task.lease_expired() {
                        warn!(
                            "Task {} lease expired (worker: {})",
                            task_id,
                            task.worker_id.as_deref().unwrap_or("unknown")
                        );
                        expired_tasks.push(*task_id);
                    }
                }
            }

            // Reclaim expired tasks
            for task_id in expired_tasks {
                let mut in_progress = self.in_progress_tasks.write().await;
                if let Some(mut task) = in_progress.remove(&task_id) {
                    warn!("Reclaiming expired task {}", task_id);

                    // Reset task to pending
                    task.status = TaskStatus::Pending;
                    task.worker_id = None;
                    task.lease_expires_at = None;

                    self.persistence.store_task(&task)?;

                    // Requeue task
                    let queue_entry = TaskQueueEntry {
                        task_id: task.id,
                        priority: task.priority,
                        scheduled_at: task.scheduled_at,
                    };
                    self.pending_queue.lock().await.push(queue_entry);
                }
            }
        }
    }

    /// Background compaction task
    async fn compaction_task(self: Arc<Self>) {
        if !self.config.persistence.auto_compact {
            return;
        }

        let interval = TokioDuration::from_secs(self.config.persistence.compact_interval_secs);

        info!("Starting compaction task (interval: {}s)", interval.as_secs());

        loop {
            sleep(interval).await;

            let one_week_ago = Utc::now() - Duration::weeks(
                self.config.persistence.completed_task_retention_days as i64 / 7,
            );

            // Clean up old completed tasks
            let completed = match self.persistence.get_tasks_by_status(TaskStatus::Completed) {
                Ok(tasks) => tasks,
                Err(e) => {
                    error!("Failed to get completed tasks: {}", e);
                    continue;
                }
            };

            let mut deleted_count = 0;
            for task in completed {
                if task.updated_at < one_week_ago {
                    if let Err(e) = self.persistence.delete_task(task.id) {
                        error!("Failed to delete old completed task {}: {}", task.id, e);
                    } else {
                        deleted_count += 1;
                    }
                }
            }

            if deleted_count > 0 {
                info!("Deleted {} old completed tasks", deleted_count);

                // Compact database
                if let Err(e) = self.persistence.compact() {
                    error!("Database compaction failed: {}", e);
                }
            }
        }
    }

    /// Get queue statistics
    pub async fn get_queue_stats(&self) -> Result<QueueStats> {
        let pending_count = self.pending_queue.lock().await.len();
        let in_progress_count = self.in_progress_tasks.read().await.len();
        let workers_count = self.workers.read().await.len();

        let pending_tasks = self.persistence.get_pending_tasks()?;
        let mut depth = QueueDepthByPriority::new();
        for task in &pending_tasks {
            if task.priority.is_high() {
                depth.high += 1;
            } else if task.priority.is_normal() {
                depth.normal += 1;
            } else {
                depth.low += 1;
            }
        }

        let one_hour_ago = Utc::now() - Duration::hours(1);
        let completed = self.persistence.get_tasks_by_status(TaskStatus::Completed)?;
        let completed_last_hour = completed
            .iter()
            .filter(|t| t.updated_at >= one_hour_ago)
            .count() as u64;

        let failed = self.persistence.get_tasks_by_status(TaskStatus::Failed)?;
        let failed_last_hour = failed
            .iter()
            .filter(|t| t.updated_at >= one_hour_ago)
            .count() as u64;

        let avg_processing_time = if completed_last_hour > 0 {
            completed
                .iter()
                .filter(|t| t.updated_at >= one_hour_ago)
                .filter_map(|t| t.result.as_ref())
                .map(|r| r.duration_ms)
                .sum::<u64>() as f64 / completed_last_hour as f64
        } else {
            0.0
        };

        Ok(QueueStats {
            pending_count,
            in_progress_count,
            completed_last_hour,
            failed_last_hour,
            worker_count: workers_count,
            avg_processing_time_ms: avg_processing_time,
            queue_depth_by_priority: task_queue_core::types::QueueDepthByPriority {
                high: depth.high,
                normal: depth.normal,
                low: depth.low,
            },
        })
    }

    /// Get connected workers
    pub async fn get_workers(&self) -> Vec<WorkerInfo> {
        self.workers.read().await.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_broker_creation() {
        let temp_dir = TempDir::new().unwrap();
        let mut config = BrokerConfig::default();
        config.persistence.data_dir = temp_dir.path().to_str().unwrap().to_string();

        let broker = Broker::new(config).await.unwrap();
        assert_eq!(broker.config.broker.port, 6379);
    }

    #[tokio::test]
    async fn test_submit_task() {
        let temp_dir = TempDir::new().unwrap();
        let mut config = BrokerConfig::default();
        config.persistence.data_dir = temp_dir.path().to_str().unwrap().to_string();

        let broker = Broker::new(config).await.unwrap();

        let payload = SubmitTaskPayload {
            task_type: "test_task".to_string(),
            payload: base64::encode(b"test payload"),
            priority: Priority::normal().0,
            scheduled_at: None,
            timeout_seconds: 300,
            max_retries: 3,
            dependencies: None,
        };

        let result = broker.handle_submit_task(payload).await.unwrap();
        assert!(result.contains("task_id"));
    }

    #[tokio::test]
    async fn test_backpressure() {
        let temp_dir = TempDir::new().unwrap();
        let mut config = BrokerConfig::default();
        config.persistence.data_dir = temp_dir.path().to_str().unwrap().to_string();
        config.broker.queue_depth_threshold = 10;

        let broker = Broker::new(config).await.unwrap();

        // Submit 10 tasks (at threshold)
        for i in 0..10 {
            let payload = SubmitTaskPayload {
                task_type: format!("task_{}", i),
                payload: base64::encode(b"test payload"),
                priority: Priority::normal().0,
                scheduled_at: None,
                timeout_seconds: 300,
                max_retries: 3,
                dependencies: None,
            };
            broker.handle_submit_task(payload).await.unwrap();
        }

        // 11th task should fail with QueueFull
        let payload = SubmitTaskPayload {
            task_type: "task_11".to_string(),
            payload: base64::encode(b"test payload"),
            priority: Priority::normal().0,
            scheduled_at: None,
            timeout_seconds: 300,
            max_retries: 3,
            dependencies: None,
        };
        let result = broker.handle_submit_task(payload).await;
        assert!(matches!(result, Err(TaskQueueError::QueueFull(_))));
    }
}
