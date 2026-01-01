use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use chrono::{DateTime, Utc, Duration};
use task_queue_core::TaskId;

/// Information about a registered worker
#[derive(Debug, Clone)]
pub struct WorkerInfo {
    pub worker_id: String,
    pub registered_at: DateTime<Utc>,
    pub last_heartbeat: DateTime<Utc>,
    pub current_tasks: Vec<TaskId>,
    pub cpu_usage_percent: f32,
    pub memory_usage_mb: u64,
}

impl WorkerInfo {
    pub fn new(worker_id: String) -> Self {
        let now = Utc::now();
        WorkerInfo {
            worker_id,
            registered_at: now,
            last_heartbeat: now,
            current_tasks: Vec::new(),
            cpu_usage_percent: 0.0,
            memory_usage_mb: 0,
        }
    }

    /// Check if worker is considered alive (heartbeat within timeout)
    pub fn is_alive(&self, timeout_secs: i64) -> bool {
        let elapsed = Utc::now() - self.last_heartbeat;
        elapsed < Duration::seconds(timeout_secs)
    }

    /// Update heartbeat
    pub fn heartbeat(&mut self, cpu: f32, memory: u64) {
        self.last_heartbeat = Utc::now();
        self.cpu_usage_percent = cpu;
        self.memory_usage_mb = memory;
    }

    /// Assign a task to this worker
    pub fn assign_task(&mut self, task_id: TaskId) {
        if !self.current_tasks.contains(&task_id) {
            self.current_tasks.push(task_id);
        }
    }

    /// Remove a task from this worker
    pub fn remove_task(&mut self, task_id: &TaskId) {
        self.current_tasks.retain(|id| id != task_id);
    }
}

/// Registry of all connected workers
pub struct WorkerRegistry {
    workers: Arc<RwLock<HashMap<String, WorkerInfo>>>,
    heartbeat_timeout_secs: i64,
}

impl WorkerRegistry {
    pub fn new(heartbeat_timeout_secs: i64) -> Self {
        WorkerRegistry {
            workers: Arc::new(RwLock::new(HashMap::new())),
            heartbeat_timeout_secs,
        }
    }

    /// Register a new worker
    pub fn register(&self, worker_id: String) -> WorkerInfo {
        let mut workers = self.workers.write();
        let info = WorkerInfo::new(worker_id.clone());
        workers.insert(worker_id, info.clone());
        info
    }

    /// Deregister a worker
    pub fn deregister(&self, worker_id: &str) -> Option<WorkerInfo> {
        let mut workers = self.workers.write();
        workers.remove(worker_id)
    }

    /// Update worker heartbeat
    pub fn update_heartbeat(&self, worker_id: &str, cpu: f32, memory: u64) -> bool {
        let mut workers = self.workers.write();
        if let Some(worker) = workers.get_mut(worker_id) {
            worker.heartbeat(cpu, memory);
            true
        } else {
            false
        }
    }

    /// Get worker info
    pub fn get(&self, worker_id: &str) -> Option<WorkerInfo> {
        let workers = self.workers.read();
        workers.get(worker_id).cloned()
    }

    /// Get all workers
    pub fn all_workers(&self) -> Vec<WorkerInfo> {
        let workers = self.workers.read();
        workers.values().cloned().collect()
    }

    /// Get alive workers
    pub fn alive_workers(&self) -> Vec<WorkerInfo> {
        let workers = self.workers.read();
        workers
            .values()
            .filter(|w| w.is_alive(self.heartbeat_timeout_secs))
            .cloned()
            .collect()
    }

    /// Get dead workers
    pub fn dead_workers(&self) -> Vec<WorkerInfo> {
        let workers = self.workers.read();
        workers
            .values()
            .filter(|w| !w.is_alive(self.heartbeat_timeout_secs))
            .cloned()
            .collect()
    }

    /// Assign a task to a worker
    pub fn assign_task(&self, worker_id: &str, task_id: TaskId) {
        let mut workers = self.workers.write();
        if let Some(worker) = workers.get_mut(worker_id) {
            worker.assign_task(task_id);
        }
    }

    /// Remove a task from a worker
    pub fn remove_task(&self, worker_id: &str, task_id: &TaskId) {
        let mut workers = self.workers.write();
        if let Some(worker) = workers.get_mut(worker_id) {
            worker.remove_task(task_id);
        }
    }

    /// Get all tasks from dead workers
    pub fn get_tasks_from_dead_workers(&self) -> Vec<TaskId> {
        let dead = self.dead_workers();
        let mut tasks = Vec::new();

        for worker in dead {
            tasks.extend(worker.current_tasks);
        }

        tasks
    }

    /// Cleanup dead workers
    pub fn cleanup_dead_workers(&self) -> Vec<WorkerInfo> {
        let mut workers = self.workers.write();
        let dead_worker_ids: Vec<String> = workers
            .values()
            .filter(|w| !w.is_alive(self.heartbeat_timeout_secs))
            .map(|w| w.worker_id.clone())
            .collect();

        let mut removed = Vec::new();
        for worker_id in dead_worker_ids {
            if let Some(worker) = workers.remove(&worker_id) {
                removed.push(worker);
            }
        }

        removed
    }

    /// Count alive workers
    pub fn count_alive(&self) -> usize {
        self.alive_workers().len()
    }

    /// Count total workers
    pub fn count_total(&self) -> usize {
        let workers = self.workers.read();
        workers.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration as StdDuration;
    use uuid::Uuid;

    #[test]
    fn test_register_and_get_worker() {
        let registry = WorkerRegistry::new(30);

        let worker_id = "worker-1".to_string();
        registry.register(worker_id.clone());

        let info = registry.get(&worker_id).unwrap();
        assert_eq!(info.worker_id, worker_id);
        assert!(info.is_alive(30));
    }

    #[test]
    fn test_heartbeat_keeps_worker_alive() {
        let registry = WorkerRegistry::new(1); // 1 second timeout

        let worker_id = "worker-1".to_string();
        registry.register(worker_id.clone());

        thread::sleep(StdDuration::from_millis(500));
        registry.update_heartbeat(&worker_id, 50.0, 1024);

        // Should still be alive due to heartbeat
        let alive = registry.alive_workers();
        assert_eq!(alive.len(), 1);
    }

    #[test]
    fn test_worker_death_detection() {
        let registry = WorkerRegistry::new(1); // 1 second timeout

        let worker_id = "worker-1".to_string();
        registry.register(worker_id.clone());

        // Wait for timeout
        thread::sleep(StdDuration::from_millis(1100));

        let dead = registry.dead_workers();
        assert_eq!(dead.len(), 1);
        assert_eq!(dead[0].worker_id, worker_id);
    }

    #[test]
    fn test_task_assignment() {
        let registry = WorkerRegistry::new(30);

        let worker_id = "worker-1".to_string();
        registry.register(worker_id.clone());

        let task_id = Uuid::new_v4();
        registry.assign_task(&worker_id, task_id);

        let info = registry.get(&worker_id).unwrap();
        assert_eq!(info.current_tasks.len(), 1);
        assert_eq!(info.current_tasks[0], task_id);

        registry.remove_task(&worker_id, &task_id);
        let info = registry.get(&worker_id).unwrap();
        assert_eq!(info.current_tasks.len(), 0);
    }
}
