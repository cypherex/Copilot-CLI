//! Worker registry and health tracking.

use dashmap::DashMap;
use chrono::{DateTime, Utc};
use std::sync::Arc;

/// Information about a connected worker.
#[derive(Debug, Clone)]
pub struct WorkerInfo {
    pub worker_id: String,
    pub last_heartbeat: DateTime<Utc>,
    pub task_count: u32,
    pub cpu_usage_percent: f32,
    pub memory_usage_mb: u32,
}

/// Registry for tracking connected workers.
pub struct WorkerRegistry {
    workers: Arc<DashMap<String, WorkerInfo>>,
}

impl WorkerRegistry {
    /// Create a new worker registry.
    pub fn new() -> Self {
        Self {
            workers: Arc::new(DashMap::new()),
        }
    }

    /// Register or update a worker.
    pub fn register(&self, info: WorkerInfo) {
        self.workers.insert(info.worker_id.clone(), info);
    }

    /// Get worker info.
    pub fn get(&self, worker_id: &str) -> Option<WorkerInfo> {
        self.workers.get(worker_id).map(|r| r.clone())
    }

    /// Remove a worker.
    pub fn remove(&self, worker_id: &str) -> Option<WorkerInfo> {
        self.workers.remove(worker_id).map(|(_, v)| v)
    }

    /// Get all workers.
    pub fn list_all(&self) -> Vec<WorkerInfo> {
        self.workers.iter().map(|entry| entry.value().clone()).collect()
    }

    /// Get count of healthy workers (within heartbeat timeout).
    pub fn healthy_count(&self, heartbeat_timeout_secs: u64) -> usize {
        let now = Utc::now();
        self.workers
            .iter()
            .filter(|entry| {
                let elapsed = (now - entry.value().last_heartbeat).num_seconds() as u64;
                elapsed < heartbeat_timeout_secs
            })
            .count()
    }

    /// Get workers that have timed out.
    pub fn get_dead_workers(&self, heartbeat_timeout_secs: u64) -> Vec<String> {
        let now = Utc::now();
        self.workers
            .iter()
            .filter(|entry| {
                let elapsed = (now - entry.value().last_heartbeat).num_seconds() as u64;
                elapsed >= heartbeat_timeout_secs
            })
            .map(|entry| entry.key().clone())
            .collect()
    }
}

impl Default for WorkerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_worker_registry_register() {
        let registry = WorkerRegistry::new();
        let info = WorkerInfo {
            worker_id: "worker-1".to_string(),
            last_heartbeat: Utc::now(),
            task_count: 2,
            cpu_usage_percent: 45.0,
            memory_usage_mb: 256,
        };

        registry.register(info.clone());
        assert_eq!(registry.get("worker-1").unwrap().worker_id, "worker-1");
    }

    #[test]
    fn test_worker_registry_remove() {
        let registry = WorkerRegistry::new();
        let info = WorkerInfo {
            worker_id: "worker-1".to_string(),
            last_heartbeat: Utc::now(),
            task_count: 0,
            cpu_usage_percent: 0.0,
            memory_usage_mb: 100,
        };

        registry.register(info);
        assert!(registry.get("worker-1").is_some());
        assert!(registry.remove("worker-1").is_some());
        assert!(registry.get("worker-1").is_none());
    }
}
