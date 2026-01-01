use crate::{config::WorkerConfig, handler::TaskHandlerRegistry, executor::TaskExecutor};
use task_queue_core::Task;
use task_queue_protocol::{
    Message, MessageCodec, ClaimTaskRequest, TaskResultRequest, HeartbeatRequest,
};

use tokio::net::TcpStream;
use tokio::sync::{mpsc, Notify};
use tokio_util::codec::Framed;
use futures::{SinkExt, StreamExt};

use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn, error, debug};
use parking_lot::RwLock;

/// Worker process that executes tasks
pub struct Worker {
    config: WorkerConfig,
    worker_id: String,
    registry: Arc<TaskHandlerRegistry>,
    active_tasks: Arc<RwLock<usize>>,
    shutdown: Arc<Notify>,
}

impl Worker {
    pub fn new(config: WorkerConfig, registry: TaskHandlerRegistry) -> Self {
        let worker_id = config.generate_worker_id();

        Worker {
            config,
            worker_id,
            registry: Arc::new(registry),
            active_tasks: Arc::new(RwLock::new(0)),
            shutdown: Arc::new(Notify::new()),
        }
    }

    /// Run the worker
    pub async fn run(&self) -> anyhow::Result<()> {
        info!("Starting worker {} (concurrency: {})", self.worker_id, self.config.concurrency);

        // Connect to broker
        let stream = TcpStream::connect(&self.config.broker_address).await?;
        info!("Connected to broker at {}", self.config.broker_address);

        let mut framed = Framed::new(stream, MessageCodec);

        // Start heartbeat task
        let heartbeat_worker_id = self.worker_id.clone();
        let heartbeat_interval = self.config.heartbeat_interval_secs;
        let active_tasks = self.active_tasks.clone();
        let shutdown = self.shutdown.clone();

        let (heartbeat_tx, mut heartbeat_rx) = mpsc::channel::<Message>(10);

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(heartbeat_interval));

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        let (cpu, memory) = get_system_stats();
                        let task_count = *active_tasks.read();

                        let heartbeat = Message::Heartbeat(HeartbeatRequest {
                            worker_id: heartbeat_worker_id.clone(),
                            current_task_count: task_count,
                            cpu_usage_percent: cpu,
                            memory_usage_mb: memory,
                        });

                        if heartbeat_tx.send(heartbeat).await.is_err() {
                            break;
                        }
                    }
                    _ = shutdown.notified() => {
                        break;
                    }
                }
            }
        });

        // Main worker loop
        loop {
            tokio::select! {
                // Send heartbeat
                Some(heartbeat) = heartbeat_rx.recv() => {
                    if let Err(e) = framed.send(heartbeat).await {
                        error!("Failed to send heartbeat: {}", e);
                        break;
                    }
                }

                // Check for shutdown
                _ = self.shutdown.notified() => {
                    info!("Worker shutting down gracefully");
                    self.graceful_shutdown().await;
                    break;
                }

                // Claim tasks if we have capacity
                _ = tokio::time::sleep(Duration::from_millis(100)) => {
                    let active = *self.active_tasks.read();

                    if active < self.config.concurrency {
                        // Request a task
                        let claim = Message::ClaimTask(ClaimTaskRequest {
                            worker_id: self.worker_id.clone(),
                            priority_filter: None,
                        });

                        if let Err(e) = framed.send(claim).await {
                            error!("Failed to send claim request: {}", e);
                            break;
                        }

                        // Wait for response
                        match framed.next().await {
                            Some(Ok(Message::Ack(ack))) => {
                                if let Some(task) = ack.task {
                                    // Spawn task execution
                                    let worker = self.clone_for_task();
                                    tokio::spawn(async move {
                                        worker.execute_task(task).await;
                                    });
                                }
                            }
                            Some(Ok(Message::Nack(nack))) => {
                                debug!("Claim rejected: {}", nack.error);
                            }
                            Some(Err(e)) => {
                                error!("Protocol error: {}", e);
                                break;
                            }
                            None => {
                                warn!("Connection closed by broker");
                                break;
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Execute a task
    async fn execute_task(&self, task: Task) {
        let task_id = task.id;
        let task_type = task.task_type.clone();

        // Increment active task count
        {
            let mut active = self.active_tasks.write();
            *active += 1;
        }

        info!("Executing task {} (type: {})", task_id, task_type);

        // Get handler
        let handler = match self.registry.get(&task_type) {
            Some(h) => h,
            None => {
                error!("No handler registered for task type: {}", task_type);
                self.report_failure(task_id, format!("No handler for task type: {}", task_type))
                    .await;
                self.decrement_active();
                return;
            }
        };

        // Execute task
        let executor = TaskExecutor::new(handler);
        let result = executor.execute(&task).await;

        // Report result
        match result {
            Ok(data) => {
                self.report_success(task_id, data).await;
            }
            Err(error) => {
                self.report_failure(task_id, error).await;
            }
        }

        self.decrement_active();
    }

    /// Report task success
    async fn report_success(&self, task_id: uuid::Uuid, result: Vec<u8>) {
        if let Err(e) = self.send_result(task_id, true, Some(result), None).await {
            error!("Failed to report task success: {}", e);
        }
    }

    /// Report task failure
    async fn report_failure(&self, task_id: uuid::Uuid, error: String) {
        if let Err(e) = self.send_result(task_id, false, None, Some(error)).await {
            error!("Failed to report task failure: {}", e);
        }
    }

    /// Send task result to broker
    async fn send_result(
        &self,
        task_id: uuid::Uuid,
        success: bool,
        result: Option<Vec<u8>>,
        error: Option<String>,
    ) -> anyhow::Result<()> {
        let stream = TcpStream::connect(&self.config.broker_address).await?;
        let mut framed = Framed::new(stream, MessageCodec);

        let message = Message::TaskResult(TaskResultRequest {
            task_id,
            worker_id: self.worker_id.clone(),
            success,
            result,
            error,
        });

        framed.send(message).await?;

        // Wait for acknowledgment
        if let Some(Ok(_)) = framed.next().await {
            debug!("Task result acknowledged");
        }

        Ok(())
    }

    /// Decrement active task count
    fn decrement_active(&self) {
        let mut active = self.active_tasks.write();
        *active = active.saturating_sub(1);
    }

    /// Clone worker for task execution
    fn clone_for_task(&self) -> Self {
        Worker {
            config: self.config.clone(),
            worker_id: self.worker_id.clone(),
            registry: self.registry.clone(),
            active_tasks: self.active_tasks.clone(),
            shutdown: self.shutdown.clone(),
        }
    }

    /// Graceful shutdown - wait for active tasks to complete
    async fn graceful_shutdown(&self) {
        info!("Waiting for active tasks to complete...");

        let deadline = tokio::time::Instant::now()
            + Duration::from_secs(self.config.graceful_shutdown_timeout_secs);

        loop {
            let active = *self.active_tasks.read();

            if active == 0 {
                info!("All tasks completed, shutting down");
                break;
            }

            if tokio::time::Instant::now() > deadline {
                warn!("Shutdown deadline exceeded, {} tasks still active", active);
                break;
            }

            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }

    /// Trigger shutdown
    pub fn shutdown(&self) {
        self.shutdown.notify_waiters();
    }
}

/// Get system statistics (CPU and memory usage)
fn get_system_stats() -> (f32, u64) {
    use sysinfo::{System, SystemExt, ProcessExt, PidExt};

    let mut sys = System::new_all();
    sys.refresh_all();

    let pid = sysinfo::Pid::from_u32(std::process::id());

    if let Some(process) = sys.process(pid) {
        let cpu = process.cpu_usage();
        let memory = process.memory() / 1024 / 1024; // Convert to MB
        (cpu, memory)
    } else {
        (0.0, 0)
    }
}
