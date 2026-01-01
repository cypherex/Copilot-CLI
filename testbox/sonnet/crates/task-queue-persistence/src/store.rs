use crate::{PersistenceError, Result, WriteAheadLog, wal::WalEntry};
use task_queue_core::{Task, TaskId, TaskStatus};
use rocksdb::{DB, Options, ColumnFamilyDescriptor, WriteBatch};
use std::path::PathBuf;
use std::sync::Arc;
use chrono::{DateTime, Utc, Duration};
use tracing::{info, warn, debug};

/// Configuration for task store
#[derive(Debug, Clone)]
pub struct TaskStoreConfig {
    pub data_dir: PathBuf,
    pub wal_sync_interval_ms: u64,
    pub completed_task_retention_days: i64,
}

impl Default for TaskStoreConfig {
    fn default() -> Self {
        TaskStoreConfig {
            data_dir: PathBuf::from("./data"),
            wal_sync_interval_ms: 100,
            completed_task_retention_days: 7,
        }
    }
}

/// Column family names
const CF_PENDING: &str = "pending";
const CF_IN_PROGRESS: &str = "in_progress";
const CF_COMPLETED: &str = "completed";
const CF_FAILED: &str = "failed";
const CF_DEAD_LETTER: &str = "dead_letter";

/// Persistent task store using RocksDB
pub struct TaskStore {
    db: Arc<DB>,
    wal: Arc<WriteAheadLog>,
    config: TaskStoreConfig,
}

impl TaskStore {
    /// Open or create task store
    pub fn open(config: TaskStoreConfig) -> Result<Self> {
        // Create data directory if it doesn't exist
        std::fs::create_dir_all(&config.data_dir)?;

        let db_path = config.data_dir.join("tasks");
        let wal_path = config.data_dir.join("wal");

        // Configure RocksDB
        let mut db_opts = Options::default();
        db_opts.create_if_missing(true);
        db_opts.create_missing_column_families(true);

        // Define column families
        let cf_descriptors = vec![
            ColumnFamilyDescriptor::new(CF_PENDING, Options::default()),
            ColumnFamilyDescriptor::new(CF_IN_PROGRESS, Options::default()),
            ColumnFamilyDescriptor::new(CF_COMPLETED, Options::default()),
            ColumnFamilyDescriptor::new(CF_FAILED, Options::default()),
            ColumnFamilyDescriptor::new(CF_DEAD_LETTER, Options::default()),
        ];

        // Open database
        let db = DB::open_cf_descriptors(&db_opts, db_path, cf_descriptors)?;

        // Open WAL
        let wal = WriteAheadLog::open(wal_path)?;

        info!("Opened task store at {:?}", config.data_dir);

        Ok(TaskStore {
            db: Arc::new(db),
            wal: Arc::new(wal),
            config,
        })
    }

    /// Store a new task
    pub fn submit_task(&self, mut task: Task) -> Result<()> {
        // Log to WAL first
        self.wal.append(WalEntry::TaskSubmitted {
            task: task.clone(),
            timestamp: Utc::now(),
        })?;

        // Store in pending column family
        task.status = TaskStatus::Pending;
        let key = task.id.as_bytes();
        let value = task.to_bytes()?;

        let cf = self.db.cf_handle(CF_PENDING)
            .ok_or_else(|| PersistenceError::Other("Pending CF not found".to_string()))?;

        self.db.put_cf(cf, key, value)?;

        debug!("Submitted task {} to store", task.id);
        Ok(())
    }

    /// Get a task by ID (searches all column families)
    pub fn get_task(&self, task_id: &TaskId) -> Result<Option<Task>> {
        let key = task_id.as_bytes();

        // Try each column family
        for cf_name in &[CF_PENDING, CF_IN_PROGRESS, CF_COMPLETED, CF_FAILED, CF_DEAD_LETTER] {
            if let Some(cf) = self.db.cf_handle(cf_name) {
                if let Some(value) = self.db.get_cf(cf, key)? {
                    let task = Task::from_bytes(&value)?;
                    return Ok(Some(task));
                }
            }
        }

        Ok(None)
    }

    /// Claim a task for a worker
    pub fn claim_task(&self, task_id: &TaskId, worker_id: String, lease_duration_secs: u64) -> Result<Task> {
        let key = task_id.as_bytes();

        // Get task from pending
        let pending_cf = self.db.cf_handle(CF_PENDING)
            .ok_or_else(|| PersistenceError::Other("Pending CF not found".to_string()))?;

        let value = self.db.get_cf(pending_cf, key)?
            .ok_or_else(|| PersistenceError::TaskNotFound(task_id.to_string()))?;

        let mut task = Task::from_bytes(&value)?;

        // Log to WAL
        self.wal.append(WalEntry::TaskClaimed {
            task_id: *task_id,
            worker_id: worker_id.clone(),
            timestamp: Utc::now(),
        })?;

        // Update task
        task.claim(worker_id, lease_duration_secs);

        // Move from pending to in_progress
        let in_progress_cf = self.db.cf_handle(CF_IN_PROGRESS)
            .ok_or_else(|| PersistenceError::Other("InProgress CF not found".to_string()))?;

        let mut batch = WriteBatch::default();
        batch.delete_cf(pending_cf, key);
        batch.put_cf(in_progress_cf, key, task.to_bytes()?);
        self.db.write(batch)?;

        debug!("Claimed task {} for worker {}", task_id, task.worker_id.as_ref().unwrap());
        Ok(task)
    }

    /// Complete a task successfully
    pub fn complete_task(&self, task_id: &TaskId, result: Vec<u8>) -> Result<()> {
        let key = task_id.as_bytes();

        // Get task from in_progress
        let in_progress_cf = self.db.cf_handle(CF_IN_PROGRESS)
            .ok_or_else(|| PersistenceError::Other("InProgress CF not found".to_string()))?;

        let value = self.db.get_cf(in_progress_cf, key)?
            .ok_or_else(|| PersistenceError::TaskNotFound(task_id.to_string()))?;

        let mut task = Task::from_bytes(&value)?;

        // Log to WAL
        self.wal.append(WalEntry::TaskCompleted {
            task_id: *task_id,
            result: result.clone(),
            timestamp: Utc::now(),
        })?;

        // Update task
        task.complete(result)?;

        // Move to completed
        let completed_cf = self.db.cf_handle(CF_COMPLETED)
            .ok_or_else(|| PersistenceError::Other("Completed CF not found".to_string()))?;

        let mut batch = WriteBatch::default();
        batch.delete_cf(in_progress_cf, key);
        batch.put_cf(completed_cf, key, task.to_bytes()?);
        self.db.write(batch)?;

        debug!("Completed task {}", task_id);
        Ok(())
    }

    /// Fail a task
    pub fn fail_task(&self, task_id: &TaskId, error: String) -> Result<()> {
        let key = task_id.as_bytes();

        // Get task from in_progress
        let in_progress_cf = self.db.cf_handle(CF_IN_PROGRESS)
            .ok_or_else(|| PersistenceError::Other("InProgress CF not found".to_string()))?;

        let value = self.db.get_cf(in_progress_cf, key)?
            .ok_or_else(|| PersistenceError::TaskNotFound(task_id.to_string()))?;

        let mut task = Task::from_bytes(&value)?;

        // Log to WAL
        self.wal.append(WalEntry::TaskFailed {
            task_id: *task_id,
            error: error.clone(),
            timestamp: Utc::now(),
        })?;

        // Update task
        task.fail(error);

        // Check if we should retry or move to DLQ
        let destination_cf = if task.can_retry() {
            // Move back to pending for retry
            task.retry();
            self.db.cf_handle(CF_PENDING)
                .ok_or_else(|| PersistenceError::Other("Pending CF not found".to_string()))?
        } else {
            // Move to dead letter queue
            task.move_to_dlq();
            self.wal.append(WalEntry::TaskMovedToDlq {
                task_id: *task_id,
                timestamp: Utc::now(),
            })?;
            self.db.cf_handle(CF_DEAD_LETTER)
                .ok_or_else(|| PersistenceError::Other("DeadLetter CF not found".to_string()))?
        };

        let mut batch = WriteBatch::default();
        batch.delete_cf(in_progress_cf, key);
        batch.put_cf(destination_cf, key, task.to_bytes()?);
        self.db.write(batch)?;

        debug!("Failed task {} (retry_count: {})", task_id, task.retry_count);
        Ok(())
    }

    /// Release a task back to pending (e.g., worker died)
    pub fn release_task(&self, task_id: &TaskId) -> Result<()> {
        let key = task_id.as_bytes();

        // Get task from in_progress
        let in_progress_cf = self.db.cf_handle(CF_IN_PROGRESS)
            .ok_or_else(|| PersistenceError::Other("InProgress CF not found".to_string()))?;

        let value = self.db.get_cf(in_progress_cf, key)?
            .ok_or_else(|| PersistenceError::TaskNotFound(task_id.to_string()))?;

        let mut task = Task::from_bytes(&value)?;

        // Log to WAL
        self.wal.append(WalEntry::TaskReleased {
            task_id: *task_id,
            timestamp: Utc::now(),
        })?;

        // Update task
        task.release();

        // Move back to pending
        let pending_cf = self.db.cf_handle(CF_PENDING)
            .ok_or_else(|| PersistenceError::Other("Pending CF not found".to_string()))?;

        let mut batch = WriteBatch::default();
        batch.delete_cf(in_progress_cf, key);
        batch.put_cf(pending_cf, key, task.to_bytes()?);
        self.db.write(batch)?;

        debug!("Released task {}", task_id);
        Ok(())
    }

    /// Get all pending tasks
    pub fn get_pending_tasks(&self) -> Result<Vec<Task>> {
        self.get_tasks_in_cf(CF_PENDING)
    }

    /// Get all in-progress tasks
    pub fn get_in_progress_tasks(&self) -> Result<Vec<Task>> {
        self.get_tasks_in_cf(CF_IN_PROGRESS)
    }

    /// Get tasks by status
    pub fn get_tasks_by_status(&self, status: TaskStatus) -> Result<Vec<Task>> {
        let cf_name = match status {
            TaskStatus::Pending => CF_PENDING,
            TaskStatus::InProgress => CF_IN_PROGRESS,
            TaskStatus::Completed => CF_COMPLETED,
            TaskStatus::Failed => CF_FAILED,
            TaskStatus::DeadLetter => CF_DEAD_LETTER,
        };

        self.get_tasks_in_cf(cf_name)
    }

    /// Helper to get all tasks in a column family
    fn get_tasks_in_cf(&self, cf_name: &str) -> Result<Vec<Task>> {
        let cf = self.db.cf_handle(cf_name)
            .ok_or_else(|| PersistenceError::Other(format!("CF {} not found", cf_name)))?;

        let mut tasks = Vec::new();
        let iter = self.db.iterator_cf(cf, rocksdb::IteratorMode::Start);

        for item in iter {
            let (_key, value) = item?;
            let task = Task::from_bytes(&value)?;
            tasks.push(task);
        }

        Ok(tasks)
    }

    /// Clean up old completed tasks
    pub fn cleanup_old_completed_tasks(&self) -> Result<usize> {
        let cutoff = Utc::now() - Duration::days(self.config.completed_task_retention_days);

        let completed_cf = self.db.cf_handle(CF_COMPLETED)
            .ok_or_else(|| PersistenceError::Other("Completed CF not found".to_string()))?;

        let mut batch = WriteBatch::default();
        let mut count = 0;

        let iter = self.db.iterator_cf(completed_cf, rocksdb::IteratorMode::Start);
        for item in iter {
            let (key, value) = item?;
            let task = Task::from_bytes(&value)?;

            if let Some(completed_at) = task.completed_at {
                if completed_at < cutoff {
                    batch.delete_cf(completed_cf, &key);
                    count += 1;
                }
            }
        }

        if count > 0 {
            self.db.write(batch)?;
            info!("Cleaned up {} old completed tasks", count);
        }

        Ok(count)
    }

    /// Recover from WAL on startup
    pub fn recover_from_wal(&self) -> Result<()> {
        info!("Recovering from WAL...");

        // Move all in-progress tasks back to pending
        let in_progress_tasks = self.get_in_progress_tasks()?;
        for task in in_progress_tasks {
            warn!("Recovering in-progress task {} (worker was likely dead)", task.id);
            self.release_task(&task.id)?;
        }

        info!("WAL recovery complete");
        Ok(())
    }

    /// Sync WAL to disk
    pub fn sync_wal(&self) -> Result<()> {
        self.wal.sync()
    }

    /// Count tasks by status
    pub fn count_by_status(&self, status: TaskStatus) -> Result<usize> {
        let tasks = self.get_tasks_by_status(status)?;
        Ok(tasks.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use task_queue_core::Priority;
    use tempfile::TempDir;

    #[test]
    fn test_submit_and_get_task() {
        let temp_dir = TempDir::new().unwrap();
        let config = TaskStoreConfig {
            data_dir: temp_dir.path().to_path_buf(),
            ..Default::default()
        };

        let store = TaskStore::open(config).unwrap();

        let task = Task::new(
            "test".to_string(),
            b"test data".to_vec(),
            Priority::normal(),
        ).unwrap();

        let task_id = task.id;
        store.submit_task(task).unwrap();

        let retrieved = store.get_task(&task_id).unwrap().unwrap();
        assert_eq!(retrieved.id, task_id);
        assert_eq!(retrieved.status, TaskStatus::Pending);
    }

    #[test]
    fn test_claim_and_complete_task() {
        let temp_dir = TempDir::new().unwrap();
        let config = TaskStoreConfig {
            data_dir: temp_dir.path().to_path_buf(),
            ..Default::default()
        };

        let store = TaskStore::open(config).unwrap();

        let task = Task::new("test".to_string(), b"data".to_vec(), Priority::high()).unwrap();
        let task_id = task.id;

        store.submit_task(task).unwrap();
        let claimed = store.claim_task(&task_id, "worker-1".to_string(), 30).unwrap();

        assert_eq!(claimed.status, TaskStatus::InProgress);
        assert_eq!(claimed.worker_id, Some("worker-1".to_string()));

        store.complete_task(&task_id, b"result".to_vec()).unwrap();

        let completed = store.get_task(&task_id).unwrap().unwrap();
        assert_eq!(completed.status, TaskStatus::Completed);
        assert_eq!(completed.result, Some(b"result".to_vec()));
    }

    #[test]
    fn test_fail_and_retry_task() {
        let temp_dir = TempDir::new().unwrap();
        let config = TaskStoreConfig {
            data_dir: temp_dir.path().to_path_buf(),
            ..Default::default()
        };

        let store = TaskStore::open(config).unwrap();

        let task = Task::builder("test".to_string(), b"data".to_vec())
            .max_retries(2)
            .build()
            .unwrap();

        let task_id = task.id;

        store.submit_task(task).unwrap();
        store.claim_task(&task_id, "worker-1".to_string(), 30).unwrap();
        store.fail_task(&task_id, "error".to_string()).unwrap();

        // Should be back in pending for retry
        let retried = store.get_task(&task_id).unwrap().unwrap();
        assert_eq!(retried.status, TaskStatus::Pending);
        assert_eq!(retried.retry_count, 1);
    }

    #[test]
    fn test_task_moves_to_dlq_after_max_retries() {
        let temp_dir = TempDir::new().unwrap();
        let config = TaskStoreConfig {
            data_dir: temp_dir.path().to_path_buf(),
            ..Default::default()
        };

        let store = TaskStore::open(config).unwrap();

        let task = Task::builder("test".to_string(), b"data".to_vec())
            .max_retries(1)
            .build()
            .unwrap();

        let task_id = task.id;

        store.submit_task(task).unwrap();

        // First attempt
        store.claim_task(&task_id, "worker-1".to_string(), 30).unwrap();
        store.fail_task(&task_id, "error 1".to_string()).unwrap();

        // Second attempt (last retry)
        store.claim_task(&task_id, "worker-1".to_string(), 30).unwrap();
        store.fail_task(&task_id, "error 2".to_string()).unwrap();

        // Should be in DLQ now
        let dlq_task = store.get_task(&task_id).unwrap().unwrap();
        assert_eq!(dlq_task.status, TaskStatus::DeadLetter);
    }
}
