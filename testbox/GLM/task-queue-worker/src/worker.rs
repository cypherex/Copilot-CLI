//! Main worker implementation

use crate::client::BrokerClient;
use crate::config::WorkerConfig;
use crate::handler::{HandlerRegistry, TaskHandler};
use std::sync::Arc;
use std::time::{Duration, Instant};
use sysinfo::{System, SystemExt};
use task_queue_core::protocol::HeartbeatData;
use task_queue_core::task::{Task, TaskId, TaskPriority, TaskResult};
use task_queue_core::Result;
use tokio::sync::{mpsc, RwLock, Semaphore};
use tokio::time::sleep;
use tracing::{debug, error, info, warn};

/// Task execution context
#[derive(Debug, Clone)]
pub struct TaskContext {
    pub task_id: TaskId,
    pub task_type: String,
    pub attempt: u32,
    pub worker_id: String,
}

/// Worker state
#[derive(Debug, Clone)]
struct WorkerState {
    active_tasks: u32,
    total_completed: u64,
    total_failed: u64,
}

/// Main worker
pub struct Worker {
    config: WorkerConfig,
    client: Arc<RwLock<BrokerClient>>,
    registry: HandlerRegistry,
    state: Arc<RwLock<WorkerState>>,
    semaphore: Arc<Semaphore>,
    shutdown_tx: mpsc::Sender<()>,
    _shutdown_rx: mpsc::Receiver<()>,
    system: Arc<RwLock<System>>,
}

impl Worker {
    /// Create a new worker
    pub async fn new(config: WorkerConfig, registry: HandlerRegistry) -> Result<Self> {
        let client = BrokerClient::connect(&config.broker_addr).await?;

        let state = WorkerState {
            active_tasks: 0,
            total_completed: 0,
            total_failed: 0,
        };

        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);
        let semaphore = Arc::new(Semaphore::new(config.concurrency));

        let mut system = System::new();
        system.refresh_all();

        Ok(Self {
            config,
            client: Arc::new(RwLock::new(client)),
            registry,
            state: Arc::new(RwLock::new(state)),
            semaphore,
            shutdown_tx,
            _shutdown_rx: shutdown_rx,
            system: Arc::new(RwLock::new(system)),
        })
    }

    /// Start the worker
    pub async fn run(&self) -> Result<()> {
        info!("Starting worker: {}", self.config.worker_id);

        // Register with broker
        self.register().await?;

        // Spawn heartbeat task
        let heartbeat_handle = self.spawn_heartbeat_task();

        // Spawn task processing tasks
        let mut task_handles = Vec::new();
        for i in 0..self.config.concurrency {
            let worker = self.clone_for_task_processor();
            let handle = tokio::spawn(async move {
                if let Err(e) = worker.process_tasks_loop().await {
                    error!("Task processor {} error: {}", i, e);
                }
            });
            task_handles.push(handle);
        }

        info!("Worker running with {} concurrent task processors", self.config.concurrency);

        // Wait for shutdown signal
        tokio::select! {
            _ = self._shutdown_rx.recv() => {
                info!("Shutdown signal received");
            }
            _ = tokio::signal::ctrl_c() => {
                info!("Ctrl+C received, shutting down");
            }
        }

        // Graceful shutdown
        self.graceful_shutdown().await;

        // Wait for task processors to finish
        for handle in task_handles {
            let _ = handle.await;
        }

        heartbeat_handle.abort();

        // Deregister from broker
        self.deregister().await;

        info!("Worker shutdown complete");
        Ok(())
    }

    /// Clone worker for task processor
    fn clone_for_task_processor(&self) -> WorkerProcessor {
        WorkerProcessor {
            config: self.config.clone(),
            client: self.client.clone(),
            registry: self.registry.clone(),
            state: self.state.clone(),
            semaphore: self.semaphore.clone(),
            system: self.system.clone(),
        }
    }

    /// Register worker with broker
    async fn register(&self) -> Result<()> {
        let hostname = gethostname::gethostname().to_string_lossy().to_string();
        let pid = std::process::id();

        let mut client = self.client.write().await;
        client
            .register_worker(
                self.config.worker_id.clone(),
                hostname,
                pid,
                self.config.concurrency as u32,
            )
            .await?;

        info!("Worker registered: {}", self.config.worker_id);
        Ok(())
    }

    /// Deregister worker from broker
    async fn deregister(&self) {
        let mut client = self.client.write().await;
        if let Err(e) = client.deregister_worker(self.config.worker_id.clone()).await {
            warn!("Failed to deregister worker: {}", e);
        }
    }

    /// Spawn heartbeat task
    fn spawn_heartbeat_task(&self) -> tokio::task::JoinHandle<()> {
        let worker_id = self.config.worker_id.clone();
        let client = self.client.clone();
        let state = self.state.clone();
        let system = self.system.clone();
        let interval_secs = self.config.heartbeat_interval_secs;

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));

            loop {
                interval.tick().await;

                // Update system stats
                {
                    let mut sys = system.write().await;
                    sys.refresh_cpu();
                    sys.refresh_memory();
                }

                // Get current state
                let (active_tasks, cpu_usage, memory_usage) = {
                    let sys = system.read().await;
                    let state = state.read().await;
                    let cpu_usage = sys.global_cpu_info().cpu_usage();
                    let memory_usage = sys.used_memory() / (1024 * 1024); // Convert to MB

                    (state.active_tasks, cpu_usage, memory_usage as u32)
                };

                // Send heartbeat
                let data = HeartbeatData {
                    worker_id: worker_id.clone(),
                    current_task_count: active_tasks,
                    cpu_usage_percent: cpu_usage,
                    memory_usage_mb: memory_usage,
                };

                let mut client = client.write().await;
                if let Err(e) = client.send_heartbeat(data).await {
                    error!("Failed to send heartbeat: {}", e);
                    if let Err(e) = client.reconnect().await {
                        error!("Failed to reconnect: {}", e);
                    }
                }
            }
        })
    }

    /// Graceful shutdown
    async fn graceful_shutdown(&self) {
        info!("Initiating graceful shutdown");

        let timeout = Duration::from_secs(self.config.graceful_shutdown_timeout_secs);
        let start = Instant::now();

        // Wait for semaphore permits to be released (all tasks to finish)
        while start.elapsed() < timeout {
            let available = self.semaphore.available_permits();
            if available == self.config.concurrency {
                break;
            }

            info!("Waiting for {} tasks to finish...", self.config.concurrency - available);
            sleep(Duration::from_secs(1)).await;
        }

        let remaining = self.config.concurrency - self.semaphore.available_permits();
        if remaining > 0 {
            warn!("Shutdown timeout reached, {} tasks still in progress", remaining);
        }
    }
}

/// Task processor (one per worker)
struct WorkerProcessor {
    config: WorkerConfig,
    client: Arc<RwLock<BrokerClient>>,
    registry: HandlerRegistry,
    state: Arc<RwLock<WorkerState>>,
    semaphore: Arc<Semaphore>,
    system: Arc<RwLock<System>>,
}

impl WorkerProcessor {
    /// Task processing loop
    async fn process_tasks_loop(&self) -> Result<()> {
        loop {
            // Wait for available permit
            let permit = self.semaphore.acquire().await
                .map_err(|e| task_queue_core::CoreError::Other(format!("Failed to acquire permit: {}", e)))?;

            // Try to claim a task
            let task = {
                let mut client = self.client.write().await;
                let max_priority = self.config.max_priority.map(TaskPriority::new).transpose().ok().flatten();

                client
                    .claim_task_with_timeout(
                        self.config.worker_id.clone(),
                        max_priority,
                        Duration::from_secs(30),
                    )
                    .await?
            };

            match task {
                Some(task) => {
                    // Process task
                    let processor = self.clone();
                    tokio::spawn(async move {
                        let _permit = permit; // Hold permit until task completes
                        if let Err(e) = processor.process_task(task).await {
                            error!("Task processing error: {}", e);
                        }
                    });
                }
                None => {
                    // No task available, continue loop
                }
            }
        }
    }

    /// Process a single task
    async fn process_task(&self, mut task: Task) -> Result<()> {
        let start = Instant::now();
        let worker_id = self.config.worker_id.clone();

        // Update state
        {
            let mut state = self.state.write().await;
            state.active_tasks += 1;
        }

        info!("Processing task: {} (type={})", task.id, task.task_type);

        let result = match self.execute_task(&task).await {
            Ok(result_data) => {
                let duration = start.elapsed();
                info!("Task completed: {} (took {}ms)", task.id, duration.as_millis());
                TaskResult::success(task.id, result_data, worker_id, duration.as_millis() as u64)
            }
            Err(e) => {
                let duration = start.elapsed();
                error!("Task failed: {} - {}", task.id, e);
                TaskResult::failure(task.id, e.to_string(), worker_id, duration.as_millis() as u64)
            }
        };

        // Send result to broker
        {
            let mut client = self.client.write().await;
            if let Err(e) = client.send_result(result.clone()).await {
                error!("Failed to send result: {}", e);
            }
        }

        // Update state
        {
            let mut state = self.state.write().await;
            state.active_tasks -= 1;
            if result.success {
                state.total_completed += 1;
            } else {
                state.total_failed += 1;
            }
        }

        Ok(())
    }

    /// Execute task with timeout
    async fn execute_task(&self, task: &Task) -> Result<Vec<u8>> {
        let timeout = Duration::from_secs(task.timeout_seconds);

        tokio::time::timeout(timeout, self.execute_task_impl(task))
            .await
            .map_err(|_| task_queue_core::CoreError::Other("Task timeout".to_string()))?
    }

    /// Execute task implementation
    async fn execute_task_impl(&self, task: &Task) -> Result<Vec<u8>> {
        // Check if handler is registered
        if !self.registry.has_handler(&task.task_type) {
            return Err(task_queue_core::CoreError::Other(format!(
                "No handler for task type: {}",
                task.task_type
            )));
        }

        // Execute with panic handling
        let task_type = task.task_type.clone();
        let payload = task.payload.clone();
        let registry = self.registry.clone();

        tokio::task::spawn_blocking(move || {
            tokio::runtime::Handle::current().block_on(async move {
                registry.execute(&task_type, payload).await
            })
        })
        .await
        .map_err(|e| task_queue_core::CoreError::Other(format!("Task panicked: {}", e)))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::WorkerArgs;

    #[tokio::test]
    async fn test_worker_creation() {
        let args = WorkerArgs {
            broker_addr: "127.0.0.1:9999".to_string(), // Non-existent broker
            worker_id: Some("test-worker".to_string()),
            concurrency: 2,
            ..Default::default()
        };

        let config = WorkerConfig::from(args);
        let registry = HandlerRegistry::new();

        // This will fail to connect, which is expected
        let result = Worker::new(config, registry).await;
        assert!(result.is_err());
    }
}

impl Default for WorkerArgs {
    fn default() -> Self {
        Self {
            broker_addr: "127.0.0.1:6379".to_string(),
            worker_id: None,
            concurrency: 4,
            heartbeat_interval_secs: 15,
            lease_timeout_secs: 30,
            graceful_shutdown_timeout_secs: 60,
            max_priority: None,
            log_level: "info".to_string(),
            config: None,
        }
    }
}
