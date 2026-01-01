use crate::{queue::TaskQueue, worker_registry::WorkerRegistry, config::BrokerConfig, metrics::BrokerMetrics};
use task_queue_core::{Task, TaskId, TaskStatus};
use task_queue_persistence::TaskStore;
use task_queue_protocol::{
    Message, MessageCodec, SubmitTaskRequest, ClaimTaskRequest, TaskResultRequest,
    HeartbeatRequest, QueryStatusRequest, AckResponse, NackResponse,
};

use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, RwLock as TokioRwLock, Notify};
use tokio_util::codec::{Framed, FramedRead, FramedWrite};
use futures::{SinkExt, StreamExt};

use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn, error, debug};
use chrono::Utc;

const LEASE_DURATION_SECS: u64 = 30;
const HEARTBEAT_TIMEOUT_SECS: i64 = 30;

/// Main broker server
pub struct Broker {
    config: Arc<BrokerConfig>,
    queue: Arc<TaskQueue>,
    store: Arc<TaskStore>,
    workers: Arc<WorkerRegistry>,
    metrics: Arc<BrokerMetrics>,
    shutdown: Arc<Notify>,
}

impl Broker {
    pub fn new(config: BrokerConfig) -> anyhow::Result<Self> {
        let store_config = config.to_task_store_config();
        let store = TaskStore::open(store_config)?;

        // Recover from WAL
        store.recover_from_wal()?;

        // Load pending tasks into queue
        let queue = TaskQueue::new();
        let pending_tasks = store.get_pending_tasks()?;
        info!("Loading {} pending tasks into queue", pending_tasks.len());
        for task in pending_tasks {
            queue.push(task);
        }

        let workers = WorkerRegistry::new(HEARTBEAT_TIMEOUT_SECS);
        let metrics = BrokerMetrics::new()?;

        Ok(Broker {
            config: Arc::new(config),
            queue: Arc::new(queue),
            store: Arc::new(store),
            workers: Arc::new(workers),
            metrics: Arc::new(metrics),
            shutdown: Arc::new(Notify::new()),
        })
    }

    /// Start the broker server
    pub async fn run(self: Arc<Self>) -> anyhow::Result<()> {
        let addr = format!("{}:{}", self.config.broker.host, self.config.broker.port);
        let listener = TcpListener::bind(&addr).await?;

        info!("Broker listening on {}", addr);

        // Start background tasks
        let broker = self.clone();
        tokio::spawn(async move {
            broker.background_tasks().await;
        });

        // Accept connections
        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            debug!("New connection from {}", addr);
                            let broker = self.clone();
                            tokio::spawn(async move {
                                if let Err(e) = broker.handle_connection(stream).await {
                                    error!("Connection error: {}", e);
                                }
                            });
                        }
                        Err(e) => {
                            error!("Accept error: {}", e);
                        }
                    }
                }
                _ = self.shutdown.notified() => {
                    info!("Shutting down broker");
                    break;
                }
            }
        }

        Ok(())
    }

    /// Handle a client connection
    async fn handle_connection(&self, stream: TcpStream) -> anyhow::Result<()> {
        let mut framed = Framed::new(stream, MessageCodec);

        while let Some(result) = framed.next().await {
            match result {
                Ok(message) => {
                    let response = self.handle_message(message).await;
                    framed.send(response).await?;
                }
                Err(e) => {
                    error!("Protocol error: {}", e);
                    break;
                }
            }
        }

        Ok(())
    }

    /// Handle a protocol message
    async fn handle_message(&self, message: Message) -> Message {
        match message {
            Message::SubmitTask(req) => self.handle_submit_task(req).await,
            Message::ClaimTask(req) => self.handle_claim_task(req).await,
            Message::TaskResult(req) => self.handle_task_result(req).await,
            Message::Heartbeat(req) => self.handle_heartbeat(req).await,
            Message::QueryStatus(req) => self.handle_query_status(req).await,
            _ => Message::Nack(NackResponse {
                error: "Unsupported message type".to_string(),
            }),
        }
    }

    /// Handle task submission
    async fn handle_submit_task(&self, req: SubmitTaskRequest) -> Message {
        let task = req.task;
        let task_id = task.id;
        let task_type = task.task_type.clone();

        // Check queue depth threshold
        if self.queue.len() >= self.config.broker.queue_depth_threshold {
            warn!("Queue depth threshold exceeded, rejecting task");
            return Message::Nack(NackResponse {
                error: "Queue depth threshold exceeded".to_string(),
            });
        }

        // Store to persistence first
        match self.store.submit_task(task.clone()) {
            Ok(_) => {
                // Add to in-memory queue
                self.queue.push(task);

                // Update metrics
                self.metrics.inc_tasks_total("pending", &task_type);
                self.metrics.tasks_pending.inc();
                self.update_queue_metrics();

                info!("Submitted task {}", task_id);

                Message::Ack(AckResponse {
                    task: None,
                    message: Some(format!("Task {} submitted", task_id)),
                })
            }
            Err(e) => {
                error!("Failed to submit task: {}", e);
                Message::Nack(NackResponse {
                    error: format!("Failed to submit task: {}", e),
                })
            }
        }
    }

    /// Handle task claim request from worker
    async fn handle_claim_task(&self, req: ClaimTaskRequest) -> Message {
        let worker_id = req.worker_id;

        // Register worker if not already registered
        if self.workers.get(&worker_id).is_none() {
            self.workers.register(worker_id.clone());
            self.metrics.workers_connected.inc();
            info!("Registered new worker: {}", worker_id);
        }

        // Try to get a task from the queue
        if let Some(task) = self.queue.pop() {
            let task_id = task.id;

            // Claim the task in persistence
            match self.store.claim_task(&task_id, worker_id.clone(), LEASE_DURATION_SECS) {
                Ok(claimed_task) => {
                    // Update worker registry
                    self.workers.assign_task(&worker_id, task_id);

                    // Update metrics
                    self.metrics.tasks_pending.dec();
                    self.metrics.tasks_in_progress.inc();
                    self.update_queue_metrics();

                    debug!("Worker {} claimed task {}", worker_id, task_id);

                    Message::Ack(AckResponse {
                        task: Some(claimed_task),
                        message: None,
                    })
                }
                Err(e) => {
                    error!("Failed to claim task: {}", e);
                    // Put task back in queue
                    self.queue.push(task);
                    Message::Nack(NackResponse {
                        error: format!("Failed to claim task: {}", e),
                    })
                }
            }
        } else {
            // No tasks available
            Message::Ack(AckResponse {
                task: None,
                message: Some("No tasks available".to_string()),
            })
        }
    }

    /// Handle task result from worker
    async fn handle_task_result(&self, req: TaskResultRequest) -> Message {
        let task_id = req.task_id;
        let worker_id = req.worker_id;

        // Remove task from worker
        self.workers.remove_task(&worker_id, &task_id);

        if req.success {
            // Task completed successfully
            let result = req.result.unwrap_or_default();
            match self.store.complete_task(&task_id, result) {
                Ok(_) => {
                    // Get task to retrieve metadata
                    if let Ok(Some(task)) = self.store.get_task(&task_id) {
                        let duration = (Utc::now() - task.created_at).num_milliseconds() as f64 / 1000.0;
                        self.metrics.observe_processing_duration(&task.task_type, duration);
                        self.metrics.inc_tasks_total("completed", &task.task_type);
                    }

                    self.metrics.tasks_in_progress.dec();

                    info!("Task {} completed successfully", task_id);

                    Message::Ack(AckResponse {
                        task: None,
                        message: Some("Task completed".to_string()),
                    })
                }
                Err(e) => {
                    error!("Failed to complete task: {}", e);
                    Message::Nack(NackResponse {
                        error: format!("Failed to complete task: {}", e),
                    })
                }
            }
        } else {
            // Task failed
            let error = req.error.unwrap_or_else(|| "Unknown error".to_string());
            match self.store.fail_task(&task_id, error.clone()) {
                Ok(_) => {
                    // Check if task was retried or moved to DLQ
                    if let Ok(Some(task)) = self.store.get_task(&task_id) {
                        self.metrics.inc_tasks_total("failed", &task.task_type);

                        if task.status == TaskStatus::Pending {
                            // Task was retried, add back to queue
                            self.queue.push(task);
                            info!("Task {} failed, scheduled for retry", task_id);
                        } else if task.status == TaskStatus::DeadLetter {
                            info!("Task {} moved to dead letter queue", task_id);
                        }
                    }

                    self.metrics.tasks_in_progress.dec();

                    Message::Ack(AckResponse {
                        task: None,
                        message: Some("Task failure recorded".to_string()),
                    })
                }
                Err(e) => {
                    error!("Failed to record task failure: {}", e);
                    Message::Nack(NackResponse {
                        error: format!("Failed to record failure: {}", e),
                    })
                }
            }
        }
    }

    /// Handle worker heartbeat
    async fn handle_heartbeat(&self, req: HeartbeatRequest) -> Message {
        let worker_id = req.worker_id;

        if self.workers.update_heartbeat(&worker_id, req.cpu_usage_percent, req.memory_usage_mb) {
            debug!("Heartbeat from worker {}", worker_id);
            Message::Ack(AckResponse {
                task: None,
                message: None,
            })
        } else {
            warn!("Heartbeat from unknown worker: {}", worker_id);
            Message::Nack(NackResponse {
                error: "Worker not registered".to_string(),
            })
        }
    }

    /// Handle task status query
    async fn handle_query_status(&self, req: QueryStatusRequest) -> Message {
        match self.store.get_task(&req.task_id) {
            Ok(Some(task)) => Message::Ack(AckResponse {
                task: Some(task),
                message: None,
            }),
            Ok(None) => Message::Nack(NackResponse {
                error: "Task not found".to_string(),
            }),
            Err(e) => Message::Nack(NackResponse {
                error: format!("Error querying task: {}", e),
            }),
        }
    }

    /// Background tasks (dead worker detection, cleanup, etc.)
    async fn background_tasks(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(10));

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    self.check_dead_workers().await;
                    self.cleanup_old_tasks().await;
                    self.update_metrics().await;
                }
                _ = self.shutdown.notified() => {
                    break;
                }
            }
        }
    }

    /// Check for dead workers and reclaim their tasks
    async fn check_dead_workers(&self) {
        let dead_tasks = self.workers.get_tasks_from_dead_workers();

        if !dead_tasks.is_empty() {
            warn!("Detected {} tasks from dead workers", dead_tasks.len());

            for task_id in dead_tasks {
                if let Err(e) = self.store.release_task(&task_id) {
                    error!("Failed to release task {}: {}", task_id, e);
                } else {
                    // Get task and add back to queue
                    if let Ok(Some(task)) = self.store.get_task(&task_id) {
                        self.queue.push(task);
                        self.metrics.tasks_in_progress.dec();
                        self.metrics.tasks_pending.inc();
                    }
                }
            }

            // Cleanup dead workers
            let removed = self.workers.cleanup_dead_workers();
            for worker in removed {
                info!("Removed dead worker: {}", worker.worker_id);
                self.metrics.workers_connected.dec();
            }
        }
    }

    /// Cleanup old completed tasks
    async fn cleanup_old_tasks(&self) {
        if let Err(e) = self.store.cleanup_old_completed_tasks() {
            error!("Failed to cleanup old tasks: {}", e);
        }
    }

    /// Update metrics
    async fn update_metrics(&self) {
        self.update_queue_metrics();
        self.metrics
            .workers_connected
            .set(self.workers.count_alive() as i64);
    }

    /// Update queue depth metrics
    fn update_queue_metrics(&self) {
        let (high, normal, low) = self.queue.count_by_priority();
        self.metrics.update_queue_depth(high as i64, normal as i64, low as i64);
    }

    /// Get metrics registry
    pub fn metrics(&self) -> Arc<BrokerMetrics> {
        self.metrics.clone()
    }

    /// Get task store
    pub fn store(&self) -> Arc<TaskStore> {
        self.store.clone()
    }

    /// Get worker registry
    pub fn workers(&self) -> Arc<WorkerRegistry> {
        self.workers.clone()
    }

    /// Get task queue
    pub fn queue(&self) -> Arc<TaskQueue> {
        self.queue.clone()
    }

    /// Shutdown the broker
    pub fn shutdown(&self) {
        self.shutdown.notify_waiters();
    }
}
