//! Persistence layer for task durability.

use task_queue_core::task::{Task, TaskStatus};
use task_queue_core::error::Result;
use chrono::Utc;
use std::sync::Arc;
use parking_lot::RwLock;
use std::collections::HashMap;

/// In-memory persistence layer (for now, will be replaced with RocksDB).
pub struct PersistenceLayer {
    pending: Arc<RwLock<HashMap<uuid::Uuid, Task>>>,
    in_progress: Arc<RwLock<HashMap<uuid::Uuid, Task>>>,
    completed: Arc<RwLock<HashMap<uuid::Uuid, Task>>>,
    failed: Arc<RwLock<HashMap<uuid::Uuid, Task>>>,
    dead_letter: Arc<RwLock<HashMap<uuid::Uuid, Task>>>,
}

impl PersistenceLayer {
    /// Create a new persistence layer.
    pub fn new() -> Self {
        Self {
            pending: Arc::new(RwLock::new(HashMap::new())),
            in_progress: Arc::new(RwLock::new(HashMap::new())),
            completed: Arc::new(RwLock::new(HashMap::new())),
            failed: Arc::new(RwLock::new(HashMap::new())),
            dead_letter: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Store a new task.
    pub fn store_task(&self, task: &Task) -> Result<()> {
        match task.status {
            TaskStatus::Pending => {
                self.pending.write().insert(task.id, task.clone());
            }
            TaskStatus::InProgress => {
                self.in_progress.write().insert(task.id, task.clone());
            }
            TaskStatus::Completed => {
                self.completed.write().insert(task.id, task.clone());
            }
            TaskStatus::Failed => {
                self.failed.write().insert(task.id, task.clone());
            }
            TaskStatus::DeadLetter => {
                self.dead_letter.write().insert(task.id, task.clone());
            }
        }
        Ok(())
    }

    /// Retrieve a task by ID.
    pub fn get_task(&self, task_id: uuid::Uuid) -> Result<Option<Task>> {
        if let Some(task) = self.pending.read().get(&task_id) {
            return Ok(Some(task.clone()));
        }
        if let Some(task) = self.in_progress.read().get(&task_id) {
            return Ok(Some(task.clone()));
        }
        if let Some(task) = self.completed.read().get(&task_id) {
            return Ok(Some(task.clone()));
        }
        if let Some(task) = self.failed.read().get(&task_id) {
            return Ok(Some(task.clone()));
        }
        if let Some(task) = self.dead_letter.read().get(&task_id) {
            return Ok(Some(task.clone()));
        }
        Ok(None)
    }

    /// Move task from one status to another.
    pub fn move_task(&self, task_id: uuid::Uuid, from_status: TaskStatus, to_status: TaskStatus) -> Result<()> {
        let task = match from_status {
            TaskStatus::Pending => self.pending.write().remove(&task_id),
            TaskStatus::InProgress => self.in_progress.write().remove(&task_id),
            TaskStatus::Completed => self.completed.write().remove(&task_id),
            TaskStatus::Failed => self.failed.write().remove(&task_id),
            TaskStatus::DeadLetter => self.dead_letter.write().remove(&task_id),
        };

        if let Some(mut task) = task {
            task.status = to_status;
            task.updated_at = Utc::now();
            self.store_task(&task)?;
        }

        Ok(())
    }

    /// Get count of tasks by status.
    pub fn count_by_status(&self) -> (usize, usize, usize, usize, usize) {
        let pending = self.pending.read().len();
        let in_progress = self.in_progress.read().len();
        let completed = self.completed.read().len();
        let failed = self.failed.read().len();
        let dead_letter = self.dead_letter.read().len();

        (pending, in_progress, completed, failed, dead_letter)
    }
}

impl Default for PersistenceLayer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_and_retrieve() {
        let persist = PersistenceLayer::new();
        let task = Task::new("test".to_string(), vec![]);
        let task_id = task.id;

        persist.store_task(&task).unwrap();
        let retrieved = persist.get_task(task_id).unwrap();
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().id, task_id);
    }
}
