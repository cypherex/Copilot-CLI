//! Worker implementation for executing tasks.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Semaphore;
use task_queue_core::task::{Task, TaskStatus};
use task_queue_core::error::{Result, TaskQueueError};

use crate::task_handler::{HandlerRegistry, TaskHandler, make_handler};
use crate::executor::{TaskExecutor, ExecutionResult};
use crate::retry::RetryPolicy;
use crate::heartbeat::{Heartbeat, WorkerStats};

/// Worker configuration.
#[derive(Debug, Clone)]
pub struct WorkerConfig {
    /// Unique worker identifier
    pub worker_id: String,
    /// Broker address
    pub broker_addr: String,
    /// Number of parallel tasks to execute
    pub concurrency: u32,
    /// Heartbeat interval in seconds
    pub heartbeat_interval_secs: u64,
    /// Graceful shutdown timeout in seconds
    pub graceful_shutdown_timeout_secs: u64,
    /// Retry policy
    pub retry_policy: RetryPolicy,
}

impl WorkerConfig {
    /// Generate a unique worker ID.
    pub fn generate_worker_id() -> String {
        let hostname = gethostname::gethostname()
            .to_str()
            .unwrap_or("unknown")
            .to_string();
        let pid = std::process::id();
        let suffix: u32 = rand::random();
        format!("{}-{}-{}", hostname, pid, suffix)
    }

    /// Create a new worker config with defaults.
    pub fn new(broker_addr: String) -> Self {
        Self {
            worker_id: Self::generate_worker_id(),
            broker_addr,
            concurrency: 4,
            heartbeat_interval_secs: 15,
            graceful_shutdown_timeout_secs: 60,
            retry_policy: RetryPolicy::default(),
        }
    }

    /// Set the worker ID.
    pub fn with_worker_id(mut self, worker_id: String) -> Self {
        self.worker_id = worker_id;
        self
    }

    /// Set the concurrency level.
    pub fn with_concurrency(mut self, concurrency: u32) -> Self {
        self.concurrency = concurrency;
        self
    }

    /// Set the heartbeat interval.
    pub fn with_heartbeat_interval(mut self, interval_secs: u64) -> Self {
        self.heartbeat_interval_secs = interval_secs;
        self
    }

    /// Set the graceful shutdown timeout.
    pub fn with_shutdown_timeout(mut self, timeout_secs: u64) -> Self {
        self.graceful_shutdown_timeout_secs = timeout_secs;
        self
    }

    /// Set the retry policy.
    pub fn with_retry_policy(mut self, policy: RetryPolicy) -> Self {
        self.retry_policy = policy;
        self
    }
}

impl Default for WorkerConfig {
    fn default() -> Self {
        Self::new("127.0.0.1:6379".to_string())
    }
}

/// Main worker for executing tasks.
pub struct Worker {
    config: WorkerConfig,
    registry: HandlerRegistry,
    executor: TaskExecutor,
    heartbeat: Heartbeat,
    shutdown: tokio::sync::broadcast::Sender<()>,
    _shutdown_rx: tokio::sync::broadcast::Receiver<()>,
    is_running: Arc<AtomicBool>,
}

impl Worker {
    /// Create a new worker with default configuration.
    pub fn new(config: WorkerConfig) -> Self {
        let registry = HandlerRegistry::new();
        let executor = TaskExecutor::new(registry.clone());
        let heartbeat = Heartbeat::new(config.worker_id.clone());

        let (shutdown, _shutdown_rx) = tokio::sync::broadcast::channel(1);

        Self {
            config,
            registry,
            executor,
            heartbeat,
            shutdown,
            _shutdown_rx,
            is_running: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Register a handler function for a task type.
    pub fn register_handler<F>(&mut self, task_type: String, handler: F)
    where
        F: Fn(Vec<u8>) -> std::pin::Pin<Box<dyn std::future::Future<Output = std::result::Result<Vec<u8>, String>> + Send>>
            + Send
            + Sync
            + 'static,
    {
        self.registry.register(task_type, Arc::new(handler));
        // Re-create executor with updated registry
        self.executor = TaskExecutor::new(self.registry.clone());
    }

    /// Register a TaskHandler trait object.
    pub fn register_task_handler<H>(&mut self, handler: H)
    where
        H: TaskHandler + Clone + 'static,
    {
        let handler_fn = make_handler(handler.clone());
        self.register_handler(handler.task_type().to_string(), handler_fn);
    }

    /// Get worker ID.
    pub fn id(&self) -> &str {
        &self.config.worker_id
    }

    /// Get current worker statistics.
    pub fn stats(&self) -> &WorkerStats {
        self.heartbeat.stats()
    }

    /// Execute a single task.
    pub async fn execute_task(&self, task: &Task) -> Result<Vec<u8>> {
        let result = self.executor.execute(task).await;

        // Update stats
        match &result {
            ExecutionResult::Success { .. } => {
                self.heartbeat.stats_mut().record_success();
            }
            ExecutionResult::Timeout | ExecutionResult::Panic { .. } | ExecutionResult::Error { .. } => {
                self.heartbeat.stats_mut().record_failure();
            }
        }

        match result {
            ExecutionResult::Success { output } => Ok(output),
            ExecutionResult::Timeout => Err(TaskQueueError::TaskTimeout),
            ExecutionResult::Panic { message } => Err(TaskQueueError::ExecutionFailed(format!("Task panicked: {}", message))),
            ExecutionResult::Error { message } => Err(TaskQueueError::ExecutionFailed(message)),
        }
    }

    /// Execute a task with retry logic.
    ///
    /// Returns the final result after all retry attempts.
    pub async fn execute_task_with_retry(
        &self,
        mut task: Task,
    ) -> Result<(Task, Option<ExecutionResult>)> {
        loop {
            // Increment active task count
            self.heartbeat.stats_mut().increment_active();

            // Execute the task
            let result = self.executor.execute(&task).await;

            // Update stats based on result
            match &result {
                ExecutionResult::Success { .. } => {
                    self.heartbeat.stats_mut().record_success();
                    // Mark task as completed
                    let output = if let ExecutionResult::Success { output } = result {
                        output
                    } else {
                        unreachable!()
                    };
                    return Ok((task.complete(output), Some(result)));
                }
                ExecutionResult::Timeout | ExecutionResult::Panic { .. } => {
                    self.heartbeat.stats_mut().record_failure();

                    // Check if we should retry
                    if self.config.retry_policy.should_retry(task.retry_count) {
                        // Calculate backoff delay
                        let delay = self.config.retry_policy.calculate_delay(task.retry_count);
                        task.retry_count += 1;

                        // Reschedule task with delay
                        task.status = TaskStatus::Pending;
                        task.scheduled_at = chrono::Utc::now() + chrono::Duration::seconds(delay.as_secs() as i64);

                        // Wait for delay (in production, would return task to broker for delayed execution)
                        tokio::time::sleep(delay).await;

                        continue; // Retry the task
                    } else {
                        // Move to dead letter queue
                        let dlq_task = task.to_dead_letter();
                        return Ok((dlq_task, Some(result)));
                    }
                }
                ExecutionResult::Error { message } => {
                    self.heartbeat.stats_mut().record_failure();

                    // Errors are not retried by default
                    let failed_task = task.fail(message.to_string());
                    return Ok((failed_task, Some(result)));
                }
            }
        }
    }

    /// Start the worker with graceful shutdown handling.
    pub async fn start(&self) -> Result<()> {
        tracing::info!("Worker starting: {}", self.id());
        tracing::info!("Concurrency: {}", self.config.concurrency);
        tracing::info!("Handlers: {:?}", self.registry.task_types());

        // Set running flag
        self.is_running.store(true, Ordering::SeqCst);

        // Create semaphore for concurrency control
        let semaphore = Arc::new(Semaphore::new(self.config.concurrency as usize));

        // Spawn heartbeat task
        let mut heartbeat = Heartbeat::new(self.config.worker_id.clone());
        let heartbeat_interval = self.config.heartbeat_interval_secs;
        let is_running = self.is_running.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(heartbeat_interval));
            while is_running.load(std::sync::atomic::Ordering::SeqCst) {
                interval.tick().await;
                heartbeat.stats_mut().update_system_info();
                tracing::debug!("Heartbeat: {:?}", heartbeat.stats());
            }
        });

        // Set up signal handling for graceful shutdown
        #[cfg(unix)]
        {
            use tokio::signal::unix;
            let _ = unix::signal(unix::SignalKind::terminate())?;
            let _ = unix::signal(unix::SignalKind::interrupt())?;
        }
        #[cfg(windows)]
        {
            // Windows signal handling is different
            let _ = tokio::signal::ctrl_c();
        }

        // Main worker loop
        loop {
            // Listen for internal shutdown signal
            let mut shutdown_rx = self.shutdown.subscribe();
            tokio::select! {
                _ = shutdown_rx.recv() => {
                    tracing::info!("Received shutdown signal");
                    break;
                }
                // Task execution would happen here (in production, would poll broker)
                _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                    // In production, this would poll the broker for new tasks
                    // For now, just keep the loop running
                    tracing::debug!("Worker {} waiting for tasks", self.id());
                }
            }
        }

        // Graceful shutdown
        self.graceful_shutdown().await?;

        tracing::info!("Worker stopped: {}", self.id());
        Ok(())
    }

    /// Perform graceful shutdown.
    async fn graceful_shutdown(&self) -> Result<()> {
        tracing::info!("Starting graceful shutdown (timeout: {}s)", self.config.graceful_shutdown_timeout_secs);

        // Set running flag to false
        self.is_running.store(false, std::sync::atomic::Ordering::SeqCst);

        // Wait for active tasks to complete
        let timeout = std::time::Duration::from_secs(self.config.graceful_shutdown_timeout_secs);
        let start = std::time::Instant::now();

        while self.heartbeat.stats().active_tasks > 0 {
            if start.elapsed() >= timeout {
                tracing::warn!("Graceful shutdown timeout, {} tasks still active", self.heartbeat.stats().active_tasks);
                break;
            }
            tracing::info!("Waiting for {} active tasks to complete...", self.heartbeat.stats().active_tasks);
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }

        // Print final statistics
        tracing::info!("Final stats: {:?}", self.heartbeat.stats());
        tracing::info!("Graceful shutdown complete");

        Ok(())
    }

    /// Trigger shutdown.
    pub fn shutdown(&self) {
        let _ = self.shutdown.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn test_worker_config_default() {
        let config = WorkerConfig::default();
        assert_eq!(config.concurrency, 4);
        assert_eq!(config.heartbeat_interval_secs, 15);
        assert_eq!(config.graceful_shutdown_timeout_secs, 60);
    }

    #[test]
    fn test_worker_config_builder() {
        let config = WorkerConfig::new("localhost:6379".to_string())
            .with_worker_id("custom-worker".to_string())
            .with_concurrency(8)
            .with_heartbeat_interval(30)
            .with_shutdown_timeout(120);

        assert_eq!(config.worker_id, "custom-worker");
        assert_eq!(config.concurrency, 8);
        assert_eq!(config.heartbeat_interval_secs, 30);
        assert_eq!(config.graceful_shutdown_timeout_secs, 120);
    }

    #[test]
    fn test_worker_creation() {
        let config = WorkerConfig::default();
        let worker = Worker::new(config.clone());
        assert_eq!(worker.id(), config.worker_id);
    }

    #[test]
    fn test_worker_register_handler() {
        let config = WorkerConfig::default();
        let mut worker = Worker::new(config);
        let handler = Arc::new(|payload| {
            Box::pin(async move { Ok(payload) })
        });
        worker.register_handler("test".to_string(), handler);
        assert!(worker.executor.get_handler_registry().has("test"));
    }

    #[tokio::test]
    async fn test_execute_task_success() {
        let config = WorkerConfig::default();
        let mut worker = Worker::new(config);
        let handler = Arc::new(|payload| {
            Box::pin(async move { Ok(payload) })
        });
        worker.register_handler("test".to_string(), handler);

        let task = Task::new("test".to_string(), vec![1, 2, 3]);
        let result = worker.execute_task(&task).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), vec![1, 2, 3]);
        assert_eq!(worker.stats().total_tasks_processed, 1);
        assert_eq!(worker.stats().total_tasks_failed, 0);
    }

    #[tokio::test]
    async fn test_execute_task_error() {
        let config = WorkerConfig::default();
        let mut worker = Worker::new(config);
        let handler = Arc::new(|_payload| {
            Box::pin(async move { Err("Handler error".to_string()) })
        });
        worker.register_handler("test".to_string(), handler);

        let task = Task::new("test".to_string(), vec![]);
        let result = worker.execute_task(&task).await;
        assert!(result.is_err());
        assert_eq!(worker.stats().total_tasks_processed, 1);
        assert_eq!(worker.stats().total_tasks_failed, 1);
    }

    #[tokio::test]
    async fn test_execute_task_timeout() {
        let config = WorkerConfig::default();
        let mut worker = Worker::new(config);
        let handler = Arc::new(|_payload| {
            Box::pin(async move {
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                Ok(vec![])
            })
        });
        worker.register_handler("slow".to_string(), handler);

        let mut task = Task::new("slow".to_string(), vec![]);
        task.timeout_seconds = 1;

        let result = worker.execute_task(&task).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), TaskQueueError::ExecutionError { .. }));
        assert_eq!(worker.stats().total_tasks_failed, 1);
    }

    #[tokio::test]
    async fn test_execute_task_with_retry_success() {
        let config = WorkerConfig::default();
        let mut worker = Worker::new(config);
        let attempts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let attempts_clone = attempts.clone();

        let handler = Arc::new(move |_payload| {
            let attempts = attempts_clone.clone();
            Box::pin(async move {
                let count = attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                if count < 2 {
                    Err(format!("Attempt {} failed", count + 1))
                } else {
                    Ok(vec![1, 2, 3])
                }
            })
        });

        // Use a custom retry policy with more retries
        let config = WorkerConfig::default()
            .with_retry_policy(RetryPolicy::new(0, 10, 5));
        worker = Worker::new(config);
        worker.register_handler("test".to_string(), handler);

        let task = Task::new("test".to_string(), vec![]);
        let (result_task, _) = worker.execute_task_with_retry(task).await;

        assert_eq!(result_task.status, TaskStatus::Completed);
        assert_eq!(result_task.retry_count, 3); // Failed 3 times then succeeded
    }

    #[tokio::test]
    async fn test_execute_task_with_retry_dead_letter() {
        let config = WorkerConfig::default();
        let mut worker = Worker::new(config);
        let handler = Arc::new(|_payload| {
            Box::pin(async move {
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                Ok(vec![])
            })
        });

        worker.register_handler("slow".to_string(), handler);

        let mut task = Task::new("slow".to_string(), vec![]);
        task.timeout_seconds = 1; // Will timeout
        task.max_retries = 2;

        let (result_task, _) = worker.execute_task_with_retry(task).await;

        assert_eq!(result_task.status, TaskStatus::DeadLetter);
    }
}
