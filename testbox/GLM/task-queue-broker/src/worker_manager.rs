//! Worker management

use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use task_queue_core::protocol::HeartbeatData;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

/// Worker information
#[derive(Debug, Clone)]
pub struct Worker {
    pub worker_id: String,
    pub hostname: String,
    pub pid: u32,
    pub concurrency: u32,
    pub current_task_count: u32,
    pub cpu_usage_percent: f32,
    pub memory_usage_mb: u32,
    pub last_heartbeat: DateTime<Utc>,
    pub status: WorkerStatus,
    pub claimed_tasks: Vec<uuid::Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerStatus {
    Active,
    Idle,
    Dead,
}

impl Worker {
    pub fn new(
        worker_id: String,
        hostname: String,
        pid: u32,
        concurrency: u32,
    ) -> Self {
        Self {
            worker_id,
            hostname,
            pid,
            concurrency,
            current_task_count: 0,
            cpu_usage_percent: 0.0,
            memory_usage_mb: 0,
            last_heartbeat: Utc::now(),
            status: WorkerStatus::Active,
            claimed_tasks: Vec::new(),
        }
    }

    pub fn update_heartbeat(&mut self, data: HeartbeatData) {
        self.current_task_count = data.current_task_count;
        self.cpu_usage_percent = data.cpu_usage_percent;
        self.memory_usage_mb = data.memory_usage_mb;
        self.last_heartbeat = Utc::now();

        if self.current_task_count == 0 {
            self.status = WorkerStatus::Idle;
        } else {
            self.status = WorkerStatus::Active;
        }
    }

    pub fn is_alive(&self, timeout_secs: i64) -> bool {
        let elapsed = (Utc::now() - self.last_heartbeat).num_seconds();
        elapsed < timeout_secs
    }

    pub fn can_accept_task(&self) -> bool {
        self.current_task_count < self.concurrency
    }

    pub fn claim_task(&mut self, task_id: uuid::Uuid) {
        self.claimed_tasks.push(task_id);
        self.current_task_count += 1;
        self.status = WorkerStatus::Active;
    }

    pub fn release_task(&mut self, task_id: uuid::Uuid) {
        self.claimed_tasks.retain(|id| *id != task_id);
        if self.current_task_count > 0 {
            self.current_task_count -= 1;
        }
        if self.current_task_count == 0 {
            self.status = WorkerStatus::Idle;
        }
    }

    pub fn release_all_tasks(&mut self) {
        self.claimed_tasks.clear();
        self.current_task_count = 0;
        self.status = WorkerStatus::Idle;
    }
}

/// Worker manager
pub struct WorkerManager {
    workers: Arc<RwLock<HashMap<String, Worker>>>,
    lease_timeout_secs: i64,
}

impl WorkerManager {
    pub fn new(lease_timeout_secs: u64) -> Self {
        Self {
            workers: Arc::new(RwLock::new(HashMap::new())),
            lease_timeout_secs: lease_timeout_secs as i64,
        }
    }

    /// Register a new worker
    pub async fn register_worker(
        &self,
        worker_id: String,
        hostname: String,
        pid: u32,
        concurrency: u32,
    ) {
        let mut workers = self.workers.write().await;
        let worker = Worker::new(worker_id.clone(), hostname, pid, concurrency);
        workers.insert(worker_id.clone(), worker);
        info!("Registered worker: {}", worker_id);
    }

    /// Deregister a worker
    pub async fn deregister_worker(&self, worker_id: &str) -> Vec<uuid::Uuid> {
        let mut workers = self.workers.write().await;
        let claimed_tasks = if let Some(worker) = workers.remove(worker_id) {
            info!("Deregistered worker: {}", worker_id);
            worker.claimed_tasks
        } else {
            Vec::new()
        };
        claimed_tasks
    }

    /// Update worker heartbeat
    pub async fn update_heartbeat(&self, data: HeartbeatData) -> bool {
        let mut workers = self.workers.write().await;
        if let Some(worker) = workers.get_mut(&data.worker_id) {
            worker.update_heartbeat(data);
            debug!("Updated heartbeat for worker: {}", data.worker_id);
            true
        } else {
            warn!("Heartbeat from unknown worker: {}", data.worker_id);
            false
        }
    }

    /// Get worker by ID
    pub async fn get_worker(&self, worker_id: &str) -> Option<Worker> {
        let workers = self.workers.read().await;
        workers.get(worker_id).cloned()
    }

    /// Get all workers
    pub async fn get_all_workers(&self) -> Vec<Worker> {
        let workers = self.workers.read().await;
        workers.values().cloned().collect()
    }

    /// Get alive workers
    pub async fn get_alive_workers(&self) -> Vec<Worker> {
        let workers = self.workers.read().await;
        workers
            .values()
            .filter(|w| w.is_alive(self.lease_timeout_secs))
            .cloned()
            .collect()
    }

    /// Get worker count
    pub async fn worker_count(&self) -> usize {
        let workers = self.workers.read().await;
        workers.len()
    }

    /// Claim a task for a worker
    pub async fn claim_task(&self, worker_id: &str, task_id: uuid::Uuid) -> bool {
        let mut workers = self.workers.write().await;
        if let Some(worker) = workers.get_mut(worker_id) {
            if worker.can_accept_task() {
                worker.claim_task(task_id);
                return true;
            }
        }
        false
    }

    /// Release a task from a worker
    pub async fn release_task(&self, worker_id: &str, task_id: uuid::Uuid) {
        let mut workers = self.workers.write().await;
        if let Some(worker) = workers.get_mut(worker_id) {
            worker.release_task(task_id);
        }
    }

    /// Check for dead workers and return their claimed tasks
    pub async fn check_dead_workers(&self) -> Vec<(String, Vec<uuid::Uuid>)> {
        let mut workers = self.workers.write().await;
        let mut dead_workers = Vec::new();

        let dead_worker_ids: Vec<String> = workers
            .iter()
            .filter(|(_, w)| !w.is_alive(self.lease_timeout_secs))
            .map(|(id, _)| id.clone())
            .collect();

        for worker_id in &dead_worker_ids {
            if let Some(worker) workers.remove(worker_id) {
                warn!(
                    "Worker {} marked as dead (last heartbeat: {})",
                    worker_id,
                    worker.last_heartbeat
                );
                dead_workers.push((worker_id.clone(), worker.claimed_tasks));
            }
        }

        dead_workers
    }

    /// Get worker statistics
    pub async fn get_stats(&self) -> WorkerStats {
        let workers = self.workers.read().await;
        let total = workers.len();
        let alive = workers.values().filter(|w| w.is_alive(self.lease_timeout_secs)).count();
        let active = workers.values().filter(|w| w.status == WorkerStatus::Active).count();
        let total_tasks: u32 = workers.values().map(|w| w.current_task_count).sum();
        let avg_cpu = if total > 0 {
            let sum: f32 = workers.values().map(|w| w.cpu_usage_percent).sum();
            sum / total as f32
        } else {
            0.0
        };
        let total_memory: u32 = workers.values().map(|w| w.memory_usage_mb).sum();

        WorkerStats {
            total_workers: total as u64,
            alive_workers: alive as u64,
            active_workers: active as u64,
            total_tasks,
            avg_cpu_usage_percent: avg_cpu,
            total_memory_mb: total_memory,
        }
    }
}

#[derive(Debug, Clone)]
pub struct WorkerStats {
    pub total_workers: u64,
    pub alive_workers: u64,
    pub active_workers: u64,
    pub total_tasks: u32,
    pub avg_cpu_usage_percent: f32,
    pub total_memory_mb: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_worker_registration() {
        let manager = WorkerManager::new(30);
        manager
            .register_worker("worker-1".to_string(), "host1".to_string(), 12345, 4)
            .await;

        let worker = manager.get_worker("worker-1").await;
        assert!(worker.is_some());
        assert_eq!(worker.unwrap().hostname, "host1");
    }

    #[tokio::test]
    async fn test_worker_lifecycle() {
        let manager = WorkerManager::new(30);
        manager
            .register_worker("worker-1".to_string(), "host1".to_string(), 12345, 4)
            .await;

        // Claim a task
        manager.claim_task("worker-1", uuid::Uuid::new_v4()).await;
        let worker = manager.get_worker("worker-1").await.unwrap();
        assert_eq!(worker.current_task_count, 1);
        assert_eq!(worker.status, WorkerStatus::Active);

        // Release the task
        manager.release_task("worker-1", worker.claimed_tasks[0]).await;
        let worker = manager.get_worker("worker-1").await.unwrap();
        assert_eq!(worker.current_task_count, 0);
        assert_eq!(worker.status, WorkerStatus::Idle);
    }

    #[tokio::test]
    async fn test_worker_heartbeat() {
        let manager = WorkerManager::new(30);
        manager
            .register_worker("worker-1".to_string(), "host1".to_string(), 12345, 4)
            .await;

        let data = HeartbeatData {
            worker_id: "worker-1".to_string(),
            current_task_count: 2,
            cpu_usage_percent: 45.5,
            memory_usage_mb: 512,
        };

        manager.update_heartbeat(data).await;
        let worker = manager.get_worker("worker-1").await.unwrap();
        assert_eq!(worker.current_task_count, 2);
        assert_eq!(worker.cpu_usage_percent, 45.5);
    }
}
