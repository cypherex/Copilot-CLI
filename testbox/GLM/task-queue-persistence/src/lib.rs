//! Persistence layer for the task queue using RocksDB

use task_queue_core::{
    error::{Result, TaskQueueError},
    Task, TaskStatus,
};
use rocksdb::{
    ColumnFamily, ColumnFamilyDescriptor, DB as RocksDB, Options, WriteBatch, DB,
};
use std::{
    collections::HashMap,
    path::Path,
    sync::Arc,
};
use tracing::{debug, info, warn};

/// Column family names
const CF_PENDING: &str = "pending";
const CF_IN_PROGRESS: &str = "in_progress";
const CF_COMPLETED: &str = "completed";
const CF_FAILED: &str = "failed";
const CF_DEAD_LETTER: &str = "dead_letter";
const CF_METADATA: &str = "metadata";

/// Write-ahead log entry
#[derive(Debug, Clone)]
pub enum WalEntry {
    TaskCreated { task_id: uuid::Uuid, task: Task },
    TaskStatusChanged {
        task_id: uuid::Uuid,
        old_status: TaskStatus,
        new_status: TaskStatus,
    },
    TaskDeleted { task_id: uuid::Uuid },
    WorkerRegistered { worker_id: String },
    WorkerDeregistered { worker_id: String },
}

/// Persistence manager for RocksDB storage
pub struct PersistenceManager {
    db: Arc<DB>,
    data_dir: String,
}

impl PersistenceManager {
    /// Open or create a new persistence manager
    pub fn open<P: AsRef<Path>>(data_dir: P) -> Result<Self> {
        let data_dir = data_dir.as_ref().to_str().unwrap().to_string();
        info!("Opening persistence manager at {}", data_dir);

        std::fs::create_dir_all(&data_dir).map_err(|e| {
            TaskQueueError::Persistence(format!("Failed to create data directory: {}", e))
        })?;

        let mut db_opts = Options::default();
        db_opts.create_if_missing(true);
        db_opts.create_missing_column_families(true);

        let cf_opts = Options::default();

        let cfs: Vec<ColumnFamilyDescriptor> = vec![
            ColumnFamilyDescriptor::new(CF_PENDING, cf_opts.clone()),
            ColumnFamilyDescriptor::new(CF_IN_PROGRESS, cf_opts.clone()),
            ColumnFamilyDescriptor::new(CF_COMPLETED, cf_opts.clone()),
            ColumnFamilyDescriptor::new(CF_FAILED, cf_opts.clone()),
            ColumnFamilyDescriptor::new(CF_DEAD_LETTER, cf_opts.clone()),
            ColumnFamilyDescriptor::new(CF_METADATA, cf_opts),
        ];

        let db = DB::open_cf_descriptors(&db_opts, &data_dir, cfs).map_err(|e| {
            TaskQueueError::Persistence(format!("Failed to open RocksDB: {}", e))
        })?;

        Ok(Self {
            db: Arc::new(db),
            data_dir,
        })
    }

    /// Get column family handle by status
    fn cf_handle(&self, status: TaskStatus) -> &ColumnFamily {
        let cf_name = match status {
            TaskStatus::Pending => CF_PENDING,
            TaskStatus::InProgress => CF_IN_PROGRESS,
            TaskStatus::Completed => CF_COMPLETED,
            TaskStatus::Failed => CF_FAILED,
            TaskStatus::DeadLetter => CF_DEAD_LETTER,
        };
        self.db.cf_handle(cf_name).unwrap()
    }

    /// Store a task in the appropriate column family
    pub fn store_task(&self, task: &Task) -> Result<()> {
        let key = task.id.as_bytes();
        let value = bincode::serialize(task).map_err(|e| {
            TaskQueueError::Persistence(format!("Failed to serialize task: {}", e))
        })?;

        let cf = self.cf_handle(task.status);
        self.db
            .put_cf(cf, key, value)
            .map_err(|e| TaskQueueError::Persistence(format!("Failed to store task: {}", e)))?;

        debug!("Stored task {} with status {:?}", task.id, task.status);
        Ok(())
    }

    /// Get a task by ID
    pub fn get_task(&self, task_id: uuid::Uuid) -> Result<Option<Task>> {
        let key = task_id.as_bytes();

        // Try all column families
        for status in [
            TaskStatus::Pending,
            TaskStatus::InProgress,
            TaskStatus::Completed,
            TaskStatus::Failed,
            TaskStatus::DeadLetter,
        ] {
            if let Some(cf) = self.db.cf_handle(Self::cf_name(status)) {
                if let Ok(Some(value)) = self.db.get_cf(cf, key) {
                    let task: Task = bincode::deserialize(&value).map_err(|e| {
                        TaskQueueError::Persistence(format!(
                            "Failed to deserialize task: {}",
                            e
                        ))
                    })?;
                    return Ok(Some(task));
                }
            }
        }

        Ok(None)
    }

    /// Delete a task
    pub fn delete_task(&self, task_id: uuid::Uuid) -> Result<()> {
        // Try to find and delete from all CFs
        let key = task_id.as_bytes();
        let mut deleted = false;

        for status in [
            TaskStatus::Pending,
            TaskStatus::InProgress,
            TaskStatus::Completed,
            TaskStatus::Failed,
            TaskStatus::DeadLetter,
        ] {
            if let Some(cf) = self.db.cf_handle(Self::cf_name(status)) {
                if self.db.get_cf(cf, key).unwrap().is_some() {
                    self.db
                        .delete_cf(cf, key)
                        .map_err(|e| {
                            TaskQueueError::Persistence(format!(
                                "Failed to delete task: {}",
                                e
                            ))
                        })?;
                    deleted = true;
                    break;
                }
            }
        }

        if !deleted {
            warn!("Task {} not found for deletion", task_id);
        }

        Ok(())
    }

    /// Get all pending tasks
    pub fn get_pending_tasks(&self) -> Result<Vec<Task>> {
        self.get_tasks_by_status(TaskStatus::Pending)
    }

    /// Get all in-progress tasks
    pub fn get_in_progress_tasks(&self) -> Result<Vec<Task>> {
        self.get_tasks_by_status(TaskStatus::InProgress)
    }

    /// Get tasks by status
    pub fn get_tasks_by_status(&self, status: TaskStatus) -> Result<Vec<Task>> {
        let cf = self.cf_handle(status);
        let mut tasks = Vec::new();

        let iter = self.db.iterator_cf(cf, rocksdb::IteratorMode::Start);
        for item in iter {
            let (_, value) = item.map_err(|e| {
                TaskQueueError::Persistence(format!("Failed to iterate tasks: {}", e))
            })?;
            let task: Task = bincode::deserialize(&value).map_err(|e| {
                TaskQueueError::Persistence(format!("Failed to deserialize task: {}", e))
            })?;
            tasks.push(task);
        }

        Ok(tasks)
    }

    /// Store metadata key-value pair
    pub fn put_metadata(&self, key: &str, value: &str) -> Result<()> {
        let cf = self.db.cf_handle(CF_METADATA).unwrap();
        self.db
            .put_cf(cf, key.as_bytes(), value.as_bytes())
            .map_err(|e| TaskQueueError::Persistence(format!("Failed to put metadata: {}", e)))?;
        Ok(())
    }

    /// Get metadata by key
    pub fn get_metadata(&self, key: &str) -> Result<Option<String>> {
        let cf = self.db.cf_handle(CF_METADATA).unwrap();
        self.db
            .get_cf(cf, key.as_bytes())
            .map_err(|e| TaskQueueError::Persistence(format!("Failed to get metadata: {}", e)))?
            .map(|v| String::from_utf8(v).ok())
    }

    /// Write a WAL entry
    pub fn write_wal_entry(&self, _entry: WalEntry) -> Result<()> {
        // TODO: Implement proper WAL with append-only log file
        // For now, we rely on RocksDB's built-in WAL
        Ok(())
    }

    /// Compact the database to reclaim space
    pub fn compact(&self) -> Result<()> {
        info!("Starting database compaction");
        self.db
            .compact_range(None::<&[u8]>, None::<&[u8]>);
        info!("Database compaction completed");
        Ok(())
    }

    /// Get the underlying RocksDB handle
    pub fn db(&self) -> &Arc<DB> {
        &self.db
    }

    /// Get column family name from status
    fn cf_name(status: TaskStatus) -> &'static str {
        match status {
            TaskStatus::Pending => CF_PENDING,
            TaskStatus::InProgress => CF_IN_PROGRESS,
            TaskStatus::Completed => CF_COMPLETED,
            TaskStatus::Failed => CF_FAILED,
            TaskStatus::DeadLetter => CF_DEAD_LETTER,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_persistence_manager_creation() {
        let temp_dir = TempDir::new().unwrap();
        let pm = PersistenceManager::open(temp_dir.path()).unwrap();
        assert_eq!(pm.data_dir, temp_dir.path().to_str().unwrap());
    }

    #[test]
    fn test_store_and_retrieve_task() {
        let temp_dir = TempDir::new().unwrap();
        let pm = PersistenceManager::open(temp_dir.path()).unwrap();

        let task = Task::new("test".to_string(), b"payload".to_vec(), Priority::normal()).unwrap();
        pm.store_task(&task).unwrap();

        let retrieved = pm.get_task(task.id).unwrap().unwrap();
        assert_eq!(retrieved.id, task.id);
        assert_eq!(retrieved.task_type, task.task_type);
    }
}
