//! Persistence layer using RocksDB

use crate::config::PersistenceSection;
use rocksdb::{
    ColumnFamily, ColumnFamilyDescriptor, Options, WriteBatch, WriteOptions, DB,
};
use task_queue_core::{task::Task, CoreError, Result as CoreResult};
use tracing::{debug, error, info, warn};

/// Column family names
pub const CF_PENDING: &str = "pending";
pub const CF_IN_PROGRESS: &str = "in_progress";
pub const CF_COMPLETED: &str = "completed";
pub const CF_FAILED: &str = "failed";
pub const CF_DEAD_LETTER: &str = "dead_letter";
pub const CF_METADATA: &str = "metadata";

/// Storage trait
#[async_trait::async_trait]
pub trait Storage: Send + Sync {
    /// Store a task
    async fn store_task(&self, task: &Task) -> CoreResult<()>;

    /// Get a task by ID
    async fn get_task(&self, task_id: uuid::Uuid) -> CoreResult<Option<Task>>;

    /// Update task status
    async fn update_task(&self, task: &Task) -> CoreResult<()>;

    /// Delete a task
    async fn delete_task(&self, task_id: uuid::Uuid) -> CoreResult<()>;

    /// Get all pending tasks
    async fn get_pending_tasks(&self, limit: usize) -> CoreResult<Vec<Task>>;

    /// Get all in-progress tasks
    async fn get_in_progress_tasks(&self) -> CoreResult<Vec<Task>>;

    /// Get completed tasks
    async fn get_completed_tasks(&self, limit: usize) -> CoreResult<Vec<Task>>;

    /// Get failed tasks
    async fn get_failed_tasks(&self, limit: usize) -> CoreResult<Vec<Task>>;

    /// Get dead letter tasks
    async fn get_dead_letter_tasks(&self, limit: usize) -> CoreResult<Vec<Task>>;

    /// Get tasks by type
    async fn get_tasks_by_type(&self, task_type: &str, limit: usize) -> CoreResult<Vec<Task>>;

    /// Move task between queues
    async fn move_task(
        &self,
        task_id: uuid::Uuid,
        from_cf: &str,
        to_cf: &str,
    ) -> CoreResult<()>;

    /// Count tasks in a column family
    async fn count_tasks(&self, cf_name: &str) -> CoreResult<u64>;

    /// Compact storage
    async fn compact(&self) -> CoreResult<()>;

    /// Create snapshot
    async fn create_snapshot(&self, path: &str) -> CoreResult<()>;

    /// Restore from snapshot
    async fn restore_snapshot(&self, path: &str) -> CoreResult<()>;
}

/// RocksDB implementation of Storage
pub struct RocksDBStorage {
    db: DB,
    write_options: WriteOptions,
}

impl RocksDBStorage {
    /// Open a new RocksDB storage instance
    pub fn open(config: &PersistenceSection) -> Result<Self, rocksdb::Error> {
        let data_dir = &config.data_dir;
        std::fs::create_dir_all(data_dir)?;

        // Configure column families
        let mut cf_opts = Options::default();
        cf_opts.set_max_write_buffer_number(3);
        cf_opts.set_write_buffer_size(64 * 1024 * 1024); // 64MB

        let cf_descriptors = vec![
            ColumnFamilyDescriptor::new(CF_PENDING, cf_opts.clone()),
            ColumnFamilyDescriptor::new(CF_IN_PROGRESS, cf_opts.clone()),
            ColumnFamilyDescriptor::new(CF_COMPLETED, cf_opts.clone()),
            ColumnFamilyDescriptor::new(CF_FAILED, cf_opts.clone()),
            ColumnFamilyDescriptor::new(CF_DEAD_LETTER, cf_opts.clone()),
            ColumnFamilyDescriptor::new(CF_METADATA, cf_opts.clone()),
        ];

        // Configure database options
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);
        opts.set_max_open_files(-1); // Use OS default
        opts.set_bytes_per_sync(1024 * 1024); // 1MB sync
        opts.set_use_fsync(false);
        opts.set_enable_statistics(true);

        info!("Opening RocksDB at: {:?}", data_dir);

        let db = DB::open_cf_descriptors(&opts, data_dir, cf_descriptors)?;

        // Configure write options
        let mut write_options = WriteOptions::default();
        write_options.set_sync(false); // WAL provides durability
        write_options.disable_wal(false);

        Ok(Self { db, write_options })
    }

    /// Get column family handle
    fn cf(&self, name: &str) -> CoreResult<&ColumnFamily> {
        self.db
            .cf_handle(name)
            .ok_or_else(|| CoreError::Other(format!("Column family not found: {}", name)))
    }

    /// Serialize task to bytes
    fn serialize_task(task: &Task) -> CoreResult<Vec<u8>> {
        bincode::serialize(task).map_err(|e| CoreError::SerializationError(e.to_string()))
    }

    /// Deserialize task from bytes
    fn deserialize_task(bytes: &[u8]) -> CoreResult<Task> {
        bincode::deserialize(bytes).map_err(|e| CoreError::DeserializationError(e.to_string()))
    }

    /// Task ID to key bytes
    fn task_key(task_id: uuid::Uuid) -> Vec<u8> {
        task_id.as_bytes().to_vec()
    }

    /// Store task in specific column family
    fn store_task_cf(&self, cf_name: &str, task: &Task) -> CoreResult<()> {
        let cf = self.cf(cf_name)?;
        let key = Self::task_key(task.id);
        let value = Self::serialize_task(task)?;
        self.db.put_cf(cf, key, value)?;
        debug!("Stored task {} in {}", task.id, cf_name);
        Ok(())
    }
}

#[async_trait::async_trait]
impl Storage for RocksDBStorage {
    async fn store_task(&self, task: &Task) -> CoreResult<()> {
        let cf_name = match task.status {
            task_queue_core::task::TaskStatus::Pending => CF_PENDING,
            task_queue_core::task::TaskStatus::InProgress => CF_IN_PROGRESS,
            task_queue_core::task::TaskStatus::Completed => CF_COMPLETED,
            task_queue_core::task::TaskStatus::Failed => CF_FAILED,
            task_queue_core::task::TaskStatus::DeadLetter => CF_DEAD_LETTER,
        };
        self.store_task_cf(cf_name, task)
    }

    async fn get_task(&self, task_id: uuid::Uuid) -> CoreResult<Option<Task>> {
        let key = Self::task_key(task_id);

        // Search in all column families
        for cf_name in &[
            CF_PENDING,
            CF_IN_PROGRESS,
            CF_COMPLETED,
            CF_FAILED,
            CF_DEAD_LETTER,
        ] {
            if let Ok(cf) = self.cf(cf_name) {
                if let Some(value) = self.db.get_cf(cf, &key)? {
                    let task = Self::deserialize_task(&value)?;
                    return Ok(Some(task));
                }
            }
        }

        Ok(None)
    }

    async fn update_task(&self, task: &Task) -> CoreResult<()> {
        // Delete from old location and store in new
        self.delete_task(task.id).await?;
        self.store_task(task).await
    }

    async fn delete_task(&self, task_id: uuid::Uuid) -> CoreResult<()> {
        let key = Self::task_key(task_id);

        // Try to delete from all column families
        for cf_name in &[
            CF_PENDING,
            CF_IN_PROGRESS,
            CF_COMPLETED,
            CF_FAILED,
            CF_DEAD_LETTER,
        ] {
            if let Ok(cf) = self.cf(cf_name) {
                self.db.delete_cf(cf, &key)?;
            }
        }

        debug!("Deleted task {}", task_id);
        Ok(())
    }

    async fn get_pending_tasks(&self, limit: usize) -> CoreResult<Vec<Task>> {
        let cf = self.cf(CF_PENDING)?;
        let iter = self.db.iterator_cf(cf, rocksdb::IteratorMode::Start);
        let mut tasks = Vec::new();

        for (key, value) in iter.take(limit) {
            if let Ok(task) = Self::deserialize_task(&value) {
                tasks.push(task);
            }
        }

        // Sort by priority and creation time
        tasks.sort_by(|a, b| {
            b.priority
                .cmp(&a.priority)
                .then_with(|| a.scheduled_at.cmp(&b.scheduled_at))
                .then_with(|| a.created_at.cmp(&b.created_at))
        });

        Ok(tasks)
    }

    async fn get_in_progress_tasks(&self) -> CoreResult<Vec<Task>> {
        let cf = self.cf(CF_IN_PROGRESS)?;
        let iter = self.db.iterator_cf(cf, rocksdb::IteratorMode::Start);
        let mut tasks = Vec::new();

        for (_key, value) in iter {
            if let Ok(task) = Self::deserialize_task(&value) {
                tasks.push(task);
            }
        }

        Ok(tasks)
    }

    async fn get_completed_tasks(&self, limit: usize) -> CoreResult<Vec<Task>> {
        let cf = self.cf(CF_COMPLETED)?;
        let iter = self.db.iterator_cf(cf, rocksdb::IteratorMode::End); // Reverse for newest first
        let mut tasks = Vec::new();

        for (_key, value) in iter.take(limit) {
            if let Ok(task) = Self::deserialize_task(&value) {
                tasks.push(task);
            }
        }

        Ok(tasks)
    }

    async fn get_failed_tasks(&self, limit: usize) -> CoreResult<Vec<Task>> {
        let cf = self.cf(CF_FAILED)?;
        let iter = self.db.iterator_cf(cf, rocksdb::IteratorMode::End);
        let mut tasks = Vec::new();

        for (_key, value) in iter.take(limit) {
            if let Ok(task) = Self::deserialize_task(&value) {
                tasks.push(task);
            }
        }

        Ok(tasks)
    }

    async fn get_dead_letter_tasks(&self, limit: usize) -> CoreResult<Vec<Task>> {
        let cf = self.cf(CF_DEAD_LETTER)?;
        let iter = self.db.iterator_cf(cf, rocksdb::IteratorMode::End);
        let mut tasks = Vec::new();

        for (_key, value) in iter.take(limit) {
            if let Ok(task) = Self::deserialize_task(&value) {
                tasks.push(task);
            }
        }

        Ok(tasks)
    }

    async fn get_tasks_by_type(&self, task_type: &str, limit: usize) -> CoreResult<Vec<Task>> {
        let mut tasks = Vec::new();

        // Search all column families
        for cf_name in &[
            CF_PENDING,
            CF_IN_PROGRESS,
            CF_COMPLETED,
            CF_FAILED,
            CF_DEAD_LETTER,
        ] {
            if let Ok(cf) = self.cf(cf_name) {
                let iter = self.db.iterator_cf(cf, rocksdb::IteratorMode::Start);
                for (_key, value) in iter {
                    if let Ok(task) = Self::deserialize_task(&value) {
                        if task.task_type == task_type && tasks.len() < limit {
                            tasks.push(task);
                        }
                    }
                }
            }
        }

        Ok(tasks)
    }

    async fn move_task(
        &self,
        task_id: uuid::Uuid,
        from_cf: &str,
        to_cf: &str,
    ) -> CoreResult<()> {
        let key = Self::task_key(task_id);
        let from = self.cf(from_cf)?;
        let to = self.cf(to_cf)?;

        if let Some(value) = self.db.get_cf(from, &key)? {
            self.db.put_cf(to, &key, &value)?;
            self.db.delete_cf(from, &key)?;
            debug!("Moved task {} from {} to {}", task_id, from_cf, to_cf);
        }

        Ok(())
    }

    async fn count_tasks(&self, cf_name: &str) -> CoreResult<u64> {
        let cf = self.cf(cf_name)?;
        let iter = self.db.iterator_cf(cf, rocksdb::IteratorMode::Start);
        Ok(iter.count() as u64)
    }

    async fn compact(&self) -> CoreResult<()> {
        info!("Starting database compaction");
        for cf_name in &[
            CF_PENDING,
            CF_IN_PROGRESS,
            CF_COMPLETED,
            CF_FAILED,
            CF_DEAD_LETTER,
            CF_METADATA,
        ] {
            if let Ok(cf) = self.cf(cf_name) {
                self.db.compact_range_cf(cf, None::<&[u8]>, None::<&[u8]>);
            }
        }
        info!("Database compaction complete");
        Ok(())
    }

    async fn create_snapshot(&self, path: &str) -> CoreResult<()> {
        info!("Creating snapshot at: {}", path);
        let snapshot_path = std::path::Path::new(path);
        std::fs::create_dir_all(snapshot_path)?;

        // RocksDB checkpoints are the way to create snapshots
        let checkpoint = self.db.checkpoint(snapshot_path)?;
        info!("Snapshot created at: {}", path);
        Ok(())
    }

    async fn restore_snapshot(&self, path: &str) -> CoreResult<()> {
        info!("Restoring snapshot from: {}", path);
        // This would require closing and reopening the DB
        // For now, return an error indicating this requires restart
        Err(CoreError::Other(
            "Restore requires broker restart".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_store_and_retrieve_task() {
        let temp_dir = TempDir::new().unwrap();
        let mut config = PersistenceSection::default();
        config.data_dir = temp_dir.path().to_path_buf();

        let storage = RocksDBStorage::open(&config).unwrap();

        let task = Task::new(
            "test_task".to_string(),
            b"test payload".to_vec(),
            task_queue_core::task::TaskPriority::normal(),
            None,
            30,
            3,
        )
        .unwrap();

        storage.store_task(&task).await.unwrap();

        let retrieved = storage.get_task(task.id).await.unwrap();
        assert!(retrieved.is_some());
        let retrieved_task = retrieved.unwrap();
        assert_eq!(retrieved_task.id, task.id);
        assert_eq!(retrieved_task.task_type, task.task_type);
    }

    #[tokio::test]
    async fn test_task_count() {
        let temp_dir = TempDir::new().unwrap();
        let mut config = PersistenceSection::default();
        config.data_dir = temp_dir.path().to_path_buf();

        let storage = RocksDBStorage::open(&config).unwrap();

        let count = storage.count_tasks(CF_PENDING).await.unwrap();
        assert_eq!(count, 0);

        let task = Task::new(
            "test_task".to_string(),
            b"test payload".to_vec(),
            task_queue_core::task::TaskPriority::normal(),
            None,
            30,
            3,
        )
        .unwrap();

        storage.store_task(&task).await.unwrap();

        let count = storage.count_tasks(CF_PENDING).await.unwrap();
        assert_eq!(count, 1);
    }
}
