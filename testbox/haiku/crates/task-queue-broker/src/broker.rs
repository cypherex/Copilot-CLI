//! Core broker implementation for task queue system.

use crate::priority_queue::PriorityQueue;
use crate::worker_registry::WorkerRegistry;
use crate::persistence::PersistenceLayer;
use parking_lot::RwLock;
use std::sync::Arc;
use task_queue_core::task::{Task, TaskStatus};
use task_queue_core::error::Result;
use chrono::Utc;

/// Configuration for the broker.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BrokerConfig {
    pub host: String,
    pub port: u16,
    pub max_connections: usize,
    pub queue_depth_threshold: usize,
    pub heartbeat_timeout_secs: u64,
    pub lease_duration_secs: u64,
}

impl Default for BrokerConfig {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: 6379,
            max_connections: 1000,
            queue_depth_threshold: 100_000,
            heartbeat_timeout_secs: 30,
            lease_duration_secs: 30,
        }
    }
}

/// Main broker for managing tasks and workers.
pub struct Broker {
    pub config: BrokerConfig,
    pending_queue: Arc<PriorityQueue>,
    worker_registry: Arc<WorkerRegistry>,
    persistence: Arc<PersistenceLayer>,
    in_progress_tasks: Arc<RwLock<std::collections::HashMap<uuid::Uuid, String>>>,
}

impl Broker {
    /// Create a new broker with default configuration.
    pub fn new(config: BrokerConfig) -> Self {
        Self {
            config,
            pending_queue: Arc::new(PriorityQueue::new()),
            worker_registry: Arc::new(WorkerRegistry::new()),
            persistence: Arc::new(PersistenceLayer::new()),
            in_progress_tasks: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// Submit a new task to the broker.
    pub fn submit_task(&self, mut task: Task) -> Result<uuid::Uuid> {
        let task_id = task.id;

        if self.pending_queue.len() >= self.config.queue_depth_threshold {
            return Err(task_queue_core::error::TaskQueueError::QueueDepthExceeded);
        }

        task.status = TaskStatus::Pending;
        self.persistence.store_task(&task)?;
        self.pending_queue.push(task);

        Ok(task_id)
    }

    /// Claim a task for a worker.
    pub fn claim_task(&self, worker_id: String) -> Result<Option<Task>> {
        if let Some(mut task) = self.pending_queue.pop() {
            task = task.claim(worker_id.clone(), self.config.lease_duration_secs);
            task.status = TaskStatus::InProgress;
            self.in_progress_tasks.write().insert(task.id, worker_id);
            self.persistence.store_task(&task)?;
            Ok(Some(task))
        } else {
            Ok(None)
        }
    }

    /// Complete a task.
    pub fn complete_task(&self, task_id: uuid::Uuid, result: Vec<u8>) -> Result<()> {
        if let Some(mut task) = self.persistence.get_task(task_id)? {
            task = task.complete(result);
            self.in_progress_tasks.write().remove(&task_id);
            self.persistence.store_task(&task)?;
            Ok(())
        } else {
            Err(task_queue_core::error::TaskQueueError::TaskNotFound(task_id.to_string()))
        }
    }

    /// Fail a task.
    pub fn fail_task(&self, task_id: uuid::Uuid, error: String, should_retry: bool) -> Result<()> {
        if let Some(mut task) = self.persistence.get_task(task_id)? {
            task.retry_count += 1;

            if should_retry && task.retry_count < task.max_retries {
                task.status = TaskStatus::Pending;
                task.worker_id = None;
                task.lease_expires_at = None;
                let delay = self.exponential_backoff(task.retry_count);
                task.scheduled_at = Utc::now() + chrono::Duration::seconds(delay as i64);
                self.pending_queue.push(task.clone());
            } else if task.retry_count >= task.max_retries {
                task = task.to_dead_letter();
            } else {
                task = task.fail(error);
            }

            self.in_progress_tasks.write().remove(&task_id);
            self.persistence.store_task(&task)?;
            Ok(())
        } else {
            Err(task_queue_core::error::TaskQueueError::TaskNotFound(task_id.to_string()))
        }
    }

    /// Cancel a pending task.
    pub fn cancel_task(&self, task_id: uuid::Uuid) -> Result<()> {
        if let Some(_) = self.pending_queue.remove(task_id) {
            self.persistence.move_task(task_id, TaskStatus::Pending, TaskStatus::DeadLetter)?;
            Ok(())
        } else if let Some(mut task) = self.persistence.get_task(task_id)? {
            if task.status == TaskStatus::Pending {
                task.status = TaskStatus::DeadLetter;
                self.persistence.store_task(&task)?;
                Ok(())
            } else {
                Err(task_queue_core::error::TaskQueueError::InvalidStatus(
                    "Cannot cancel non-pending task".to_string(),
                ))
            }
        } else {
            Err(task_queue_core::error::TaskQueueError::TaskNotFound(task_id.to_string()))
        }
    }

    /// Get task status.
    pub fn get_task_status(&self, task_id: uuid::Uuid) -> Result<Option<Task>> {
        self.persistence.get_task(task_id)
    }

    /// Get broker statistics.
    pub fn get_stats(&self) -> BrokerStats {
        let (pending, in_progress, completed, failed, dead_letter) = self.persistence.count_by_status();
        let (high, normal, low) = self.pending_queue.depth_by_priority();
        let workers = self.worker_registry.healthy_count(self.config.heartbeat_timeout_secs);

        BrokerStats {
            pending_count: pending as u64,
            in_progress_count: in_progress as u64,
            completed_count: completed as u64,
            failed_count: failed as u64,
            dead_letter_count: dead_letter as u64,
            worker_count: workers as u64,
            high_priority_pending: high as u64,
            normal_priority_pending: normal as u64,
            low_priority_pending: low as u64,
        }
    }

    /// Calculate exponential backoff delay in seconds.
    fn exponential_backoff(&self, attempt: u32) -> u64 {
        let base_delay = 5;
        let delay = base_delay * 2_u64.pow(attempt);
        std::cmp::min(delay, 3600)
    }

    /// Handle dead workers and reclaim their tasks.
    pub fn handle_dead_workers(&self) -> Result<()> {
        let dead_workers = self.worker_registry.get_dead_workers(self.config.heartbeat_timeout_secs);

        for dead_id in dead_workers {
            let in_progress = self.in_progress_tasks.read();
            let tasks_to_reclaim: Vec<_> = in_progress
                .iter()
                .filter(|(_, w)| w.as_str() == dead_id.as_str())
                .map(|(t, _)| *t)
                .collect();
            drop(in_progress);

            for task_id in tasks_to_reclaim {
                let _ = self.fail_task(task_id, "Worker died".to_string(), true);
            }

            self.worker_registry.remove(&dead_id);
        }

        Ok(())
    }
}

/// Broker statistics.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BrokerStats {
    pub pending_count: u64,
    pub in_progress_count: u64,
    pub completed_count: u64,
    pub failed_count: u64,
    pub dead_letter_count: u64,
    pub worker_count: u64,
    pub high_priority_pending: u64,
    pub normal_priority_pending: u64,
    pub low_priority_pending: u64,
}
