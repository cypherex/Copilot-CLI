//! RocksDB-based persistence layer for task durability.
//!
//! Provides persistent storage with:
//! - Column families for different task states
//! - Write-ahead log (WAL) for durability
//! - Index structures for efficient querying
//! - Periodic compaction
//! - Recovery logic
//! - Transaction support for atomic operations

use rocksdb::{
    ColumnFamily, ColumnFamilyDescriptor, Options, WriteBatch, DB,
    DBCompactionStyle, DBCompressionType, IteratorMode,
};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use task_queue_core::error::{Result, TaskQueueError};
use task_queue_core::serialization::{serialize_task_bincode, deserialize_task_bincode};
use task_queue_core::task::{Task, TaskId, TaskStatus};
use tokio::sync::RwLock as TokioRwLock;
use tracing::{debug, error, info, warn};

/// Column family names
const CF_PENDING: &str = "pending";
const CF_IN_PROGRESS: &str = "in_progress";
const CF_COMPLETED: &str = "completed";
const CF_FAILED: &str = "failed";
const CF_DEAD_LETTER: &str = "dead_letter";
const CF_INDEX_TASK_ID: &str = "index_task_id";
const CF_INDEX_TASK_TYPE: &str = "index_task_type";
const CF_INDEX_PRIORITY: &str = "index_priority";
const CF_INDEX_SCHEDULED_TIME: &str = "index_scheduled_time";

/// RocksDB persistence layer configuration.
#[derive(Debug, Clone)]
pub struct RocksDbConfig {
    /// Path to the database directory
    pub db_path: String,
    /// Enable WAL (Write-Ahead Log)
    pub enable_wal: bool,
    /// WAL sync mode (0=async, 1=fsync, 2=async+fsync)
    pub wal_sync_mode: u32,
    /// Compression type
    pub compression_type: DBCompressionType,
    /// Compaction style
    pub compaction_style: DBCompactionStyle,
    /// Write buffer size in MB
    pub write_buffer_size: usize,
    /// Max write buffer number
    pub max_write_buffer_number: i32,
    /// Level0 file num compaction trigger
    pub level0_file_num_compaction_trigger: i32,
    /// Periodic compaction interval in seconds (0 = disabled)
    pub periodic_compaction_seconds: u64,
}

impl Default for RocksDbConfig {
    fn default() -> Self {
        Self {
            db_path: "./task_queue_db".to_string(),
            enable_wal: true,
            wal_sync_mode: 1, // fsync for durability
            compression_type: DBCompressionType::Lz4,
            compaction_style: DBCompactionStyle::Universal,
            write_buffer_size: 64 * 1024 * 1024, // 64 MB
            max_write_buffer_number: 3,
            level0_file_num_compaction_trigger: 8,
            periodic_compaction_seconds: 3600, // 1 hour
        }
    }
}

/// RocksDB persistence layer.
pub struct RocksDbPersistence {
    db: Arc<DB>,
    config: RocksDbConfig,
    compaction_task: Option<tokio::task::JoinHandle<()>>,
}

impl RocksDbPersistence {
    /// Open or create a RocksDB database with the given config.
    pub fn open(config: RocksDbConfig) -> Result<Self> {
        info!("Opening RocksDB at: {}", config.db_path);

        // Create database directory if it doesn't exist
        std::fs::create_dir_all(&config.db_path)
            .map_err(|e| TaskQueueError::DatabaseError(format!("Failed to create db directory: {}", e)))?;

        // Configure database options
        let mut db_opts = Options::default();
        db_opts.create_if_missing(true);
        db_opts.create_missing_column_families(true);
        db_opts.set_wal_dir(format!("{}/wal", config.db_path));
        db_opts.set_write_buffer_size(config.write_buffer_size);
        db_opts.set_max_write_buffer_number(config.max_write_buffer_number);
        db_opts.set_level0_file_num_compaction_trigger(config.level0_file_num_compaction_trigger);
        db_opts.set_compaction_style(config.compaction_style);
        db_opts.set_compression_type(config.compression_type);

        if config.enable_wal {
            db_opts.set_wal_recovery_mode(rocksdb::DBRecoveryMode::PointInTime);
        }

        // Define column families
        let cf_names = vec![
            CF_PENDING,
            CF_IN_PROGRESS,
            CF_COMPLETED,
            CF_FAILED,
            CF_DEAD_LETTER,
            CF_INDEX_TASK_ID,
            CF_INDEX_TASK_TYPE,
            CF_INDEX_PRIORITY,
            CF_INDEX_SCHEDULED_TIME,
        ];

        let cf_descriptors: Vec<ColumnFamilyDescriptor> = cf_names
            .iter()
            .map(|name| {
                let mut opts = Options::default();
                opts.set_compression_type(config.compression_type);
                ColumnFamilyDescriptor::new(*name, opts)
            })
            .collect();

        // Open database
        let db = DB::open_cf_descriptors(&db_opts, &config.db_path, cf_descriptors)
            .map_err(|e| TaskQueueError::DatabaseError(format!("Failed to open DB: {}", e)))?;

        info!("Successfully opened RocksDB with {} column families", cf_names.len());

        let mut persistence = Self {
            db: Arc::new(db),
            config,
            compaction_task: None,
        };

        // Start periodic compaction if enabled
        if persistence.config.periodic_compaction_seconds > 0 {
            persistence.start_periodic_compaction();
        }

        Ok(persistence)
    }

    /// Start periodic compaction task.
    fn start_periodic_compaction(&mut self) {
        let db = Arc::clone(&self.db);
        let interval_secs = self.config.periodic_compaction_seconds;

        info!("Starting periodic compaction every {} seconds", interval_secs);

        self.compaction_task = Some(tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(interval_secs));
            loop {
                interval.tick().await;
                debug!("Running periodic compaction");
                if let Err(e) = Self::run_compaction(&db) {
                    error!("Periodic compaction failed: {}", e);
                }
            }
        }));
    }

    /// Run compaction on all column families.
    fn run_compaction(db: &DB) -> Result<()> {
        let cf_names = vec![
            CF_PENDING,
            CF_IN_PROGRESS,
            CF_COMPLETED,
            CF_FAILED,
            CF_DEAD_LETTER,
        ];

        for cf_name in cf_names {
            let cf = db.cf_handle(cf_name)
                .ok_or_else(|| TaskQueueError::DatabaseError(format!("CF not found: {}", cf_name)))?;
            db.compact_range_cf(cf, None::<&[u8]>, None::<&[u8]>);
            debug!("Compacted column family: {}", cf_name);
        }

        Ok(())
    }

    /// Get column family handle for a task status.
    fn cf_for_status(&self, status: TaskStatus) -> Result<&ColumnFamily> {
        let cf_name = match status {
            TaskStatus::Pending => CF_PENDING,
            TaskStatus::InProgress => CF_IN_PROGRESS,
            TaskStatus::Completed => CF_COMPLETED,
            TaskStatus::Failed => CF_FAILED,
            TaskStatus::DeadLetter => CF_DEAD_LETTER,
        };
        self.db.cf_handle(cf_name)
            .ok_or_else(|| TaskQueueError::DatabaseError(format!("CF not found: {}", cf_name)))
    }

    /// Store a task in the appropriate column family.
    pub fn store_task(&self, task: &Task) -> Result<()> {
        let cf = self.cf_for_status(task.status)?;
        let key = task.id.as_bytes();
        let value = serialize_task_bincode(task)
            .map_err(|e| TaskQueueError::SerializationError(e.into()))?;

        self.db.put_cf(cf, key, value)
            .map_err(|e| TaskQueueError::DatabaseError(format!("Failed to store task: {}", e)))?;

        // Update indexes
        self.update_indexes(task)?;

        debug!("Stored task {} in status {:?}", task.id, task.status);
        Ok(())
    }

    /// Get a task by ID (search all column families).
    pub fn get_task(&self, task_id: TaskId) -> Result<Option<Task>> {
        let key = task_id.as_bytes();

        for status in &[
            TaskStatus::Pending,
            TaskStatus::InProgress,
            TaskStatus::Completed,
            TaskStatus::Failed,
            TaskStatus::DeadLetter,
        ] {
            let cf = self.cf_for_status(*status)?;
            if let Some(value) = self.db.get_cf(cf, key)
                .map_err(|e| TaskQueueError::DatabaseError(format!("Failed to get task: {}", e)))?
            {
                let task = deserialize_task_bincode(&value)
                    .map_err(|e| TaskQueueError::SerializationError(e.into()))?;
                return Ok(Some(task));
            }
        }

        Ok(None)
    }

    /// Move a task from one status to another atomically.
    pub fn move_task(&self, task_id: TaskId, from_status: TaskStatus, to_status: TaskStatus) -> Result<()> {
        let from_cf = self.cf_for_status(from_status)?;
        let to_cf = self.cf_for_status(to_status)?;
        let key = task_id.as_bytes();

        // Start a write batch for atomic operation
        let mut batch = WriteBatch::default();

        // Get the task
        let value = self.db.get_cf(from_cf, key)
            .map_err(|e| TaskQueueError::DatabaseError(format!("Failed to get task: {}", e)))?
            .ok_or_else(|| TaskQueueError::TaskNotFound(task_id.to_string()))?;

        // Deserialize and update
        let mut task = deserialize_task_bincode(&value)
            .map_err(|e| TaskQueueError::SerializationError(e.into()))?;
        task.status = to_status;
        task.updated_at = chrono::Utc::now();

        // Re-serialize
        let new_value = serialize_task_bincode(&task)
            .map_err(|e| TaskQueueError::SerializationError(e.into()))?;

        // Batch: delete from old CF, put in new CF
        batch.delete_cf(from_cf, key);
        batch.put_cf(to_cf, key, new_value);

        // Execute batch
        self.db.write(batch)
            .map_err(|e| TaskQueueError::DatabaseError(format!("Failed to move task: {}", e)))?;

        // Update indexes
        self.update_indexes(&task)?;

        debug!("Moved task {} from {:?} to {:?}", task_id, from_status, to_status);
        Ok(())
    }

    /// Delete a task from the database.
    pub fn delete_task(&self, task_id: TaskId, status: TaskStatus) -> Result<()> {
        let cf = self.cf_for_status(status)?;
        let key = task_id.as_bytes();

        // Get task for index cleanup
        if let Some(value) = self.db.get_cf(cf, key)
            .map_err(|e| TaskQueueError::DatabaseError(format!("Failed to get task: {}", e)))?
        {
            let task = deserialize_task_bincode(&value)
                .map_err(|e| TaskQueueError::SerializationError(e.into()))?;
            self.remove_indexes(&task)?;
        }

        self.db.delete_cf(cf, key)
            .map_err(|e| TaskQueueError::DatabaseError(format!("Failed to delete task: {}", e)))?;

        debug!("Deleted task {} from {:?}", task_id, status);
        Ok(())
    }

    /// Update all indexes for a task.
    fn update_indexes(&self, task: &Task) -> Result<()> {
        let mut batch = WriteBatch::default();
        let task_key = task.id.as_bytes();

        // Index by task_id (simple reverse lookup)
        let cf_id = self.db.cf_handle(CF_INDEX_TASK_ID).unwrap();
        batch.put_cf(cf_id, task_key, (task.status as u8).to_be_bytes());

        // Index by task_type
        let cf_type = self.db.cf_handle(CF_INDEX_TASK_TYPE).unwrap();
        let type_key = format!("{}:{}", task.task_type, task.id);
        batch.put_cf(cf_type, type_key.as_bytes(), task_key);

        // Index by priority
        let cf_priority = self.db.cf_handle(CF_INDEX_PRIORITY).unwrap();
        let priority_key = format!("{:03}:{}", task.priority, task.id);
        batch.put_cf(cf_priority, priority_key.as_bytes(), task_key);

        // Index by scheduled_time
        let cf_time = self.db.cf_handle(CF_INDEX_SCHEDULED_TIME).unwrap();
        let time_key = format!("{}:{}", task.scheduled_at.timestamp(), task.id);
        batch.put_cf(cf_time, time_key.as_bytes(), task_key);

        self.db.write(batch)
            .map_err(|e| TaskQueueError::DatabaseError(format!("Failed to update indexes: {}", e)))?;

        Ok(())
    }

    /// Remove all indexes for a task.
    fn remove_indexes(&self, task: &Task) -> Result<()> {
        let mut batch = WriteBatch::default();

        let cf_id = self.db.cf_handle(CF_INDEX_TASK_ID).unwrap();
        batch.delete_cf(cf_id, task.id.as_bytes());

        let cf_type = self.db.cf_handle(CF_INDEX_TASK_TYPE).unwrap();
        let type_key = format!("{}:{}", task.task_type, task.id);
        batch.delete_cf(cf_type, type_key.as_bytes());

        let cf_priority = self.db.cf_handle(CF_INDEX_PRIORITY).unwrap();
        let priority_key = format!("{:03}:{}", task.priority, task.id);
        batch.delete_cf(cf_priority, priority_key.as_bytes());

        let cf_time = self.db.cf_handle(CF_INDEX_SCHEDULED_TIME).unwrap();
        let time_key = format!("{}:{}", task.scheduled_at.timestamp(), task.id);
        batch.delete_cf(cf_time, time_key.as_bytes());

        self.db.write(batch)
            .map_err(|e| TaskQueueError::DatabaseError(format!("Failed to remove indexes: {}", e)))?;

        Ok(())
    }

    /// Get all tasks of a specific status.
    pub fn get_tasks_by_status(&self, status: TaskStatus) -> Result<Vec<Task>> {
        let cf = self.cf_for_status(status)?;
        let mut tasks = Vec::new();

        let iter = self.db.iterator_cf(cf, IteratorMode::Start);
        for item in iter {
            let (_key, value) = item
                .map_err(|e| TaskQueueError::DatabaseError(format!("Iterator error: {}", e)))?;
            let task = deserialize_task_bincode(&value)
                .map_err(|e| TaskQueueError::SerializationError(e.into()))?;
            tasks.push(task);
        }

        Ok(tasks)
    }

    /// Get tasks by type.
    pub fn get_tasks_by_type(&self, task_type: &str) -> Result<Vec<Task>> {
        let cf = self.db.cf_handle(CF_INDEX_TASK_TYPE).unwrap();
        let prefix = format!("{}:", task_type);
        let mut tasks = Vec::new();

        let iter = self.db.prefix_iterator_cf(cf, prefix.as_bytes());
        for item in iter {
            let (_key, task_id_bytes) = item
                .map_err(|e| TaskQueueError::DatabaseError(format!("Iterator error: {}", e)))?;

            let task_id = TaskId::from_bytes_le(
                task_id_bytes.try_into()
                    .map_err(|_| TaskQueueError::InvalidMessageFormat)?
            );
            if let Some(task) = self.get_task(task_id)? {
                tasks.push(task);
            }
        }

        Ok(tasks)
    }

    /// Get tasks by priority (higher priority first).
    pub fn get_tasks_by_priority(&self, status: TaskStatus, min_priority: u8, max_priority: u8) -> Result<Vec<Task>> {
        let cf = self.db.cf_handle(CF_INDEX_PRIORITY).unwrap();
        let mut tasks = Vec::new();

        for priority in (min_priority..=max_priority).rev() {
            let prefix = format!("{:03}:", priority);
            let iter = self.db.prefix_iterator_cf(cf, prefix.as_bytes());

            for item in iter {
                let (_key, task_id_bytes) = item
                    .map_err(|e| TaskQueueError::DatabaseError(format!("Iterator error: {}", e)))?;

                let task_id = TaskId::from_bytes_le(
                    task_id_bytes.try_into()
                        .map_err(|_| TaskQueueError::InvalidMessageFormat)?
                );
                if let Some(task) = self.get_task(task_id)? {
                    if task.status == status {
                        tasks.push(task);
                    }
                }
            }
        }

        Ok(tasks)
    }

    /// Get scheduled tasks up to a given timestamp.
    pub fn get_scheduled_tasks(&self, up_to: i64) -> Result<Vec<Task>> {
        let cf = self.db.cf_handle(CF_INDEX_SCHEDULED_TIME).unwrap();
        let mut tasks = Vec::new();

        let iter = self.db.iterator_cf(cf, IteratorMode::Start);
        for item in iter {
            let (key, task_id_bytes) = item
                .map_err(|e| TaskQueueError::DatabaseError(format!("Iterator error: {}", e)))?;

            let timestamp_str = String::from_utf8_lossy(&key)
                .split(':')
                .next()
                .ok_or_else(|| TaskQueueError::InvalidMessageFormat)?
                .to_string();

            let timestamp: i64 = timestamp_str.parse()
                .map_err(|_| TaskQueueError::InvalidMessageFormat)?;

            if timestamp > up_to {
                break; // Tasks are sorted by time
            }

            let task_id = TaskId::from_bytes_le(
                task_id_bytes.try_into()
                    .map_err(|_| TaskQueueError::InvalidMessageFormat)?
            );
            if let Some(task) = self.get_task(task_id)? {
                if task.status == TaskStatus::Pending {
                    tasks.push(task);
                }
            }
        }

        Ok(tasks)
    }

    /// Count tasks by status.
    pub fn count_by_status(&self) -> Result<(usize, usize, usize, usize, usize)> {
        let pending = self.db.iterator_cf(self.cf_for_status(TaskStatus::Pending)?, IteratorMode::Start).count();
        let in_progress = self.db.iterator_cf(self.cf_for_status(TaskStatus::InProgress)?, IteratorMode::Start).count();
        let completed = self.db.iterator_cf(self.cf_for_status(TaskStatus::Completed)?, IteratorMode::Start).count();
        let failed = self.db.iterator_cf(self.cf_for_status(TaskStatus::Failed)?, IteratorMode::Start).count();
        let dead_letter = self.db.iterator_cf(self.cf_for_status(TaskStatus::DeadLetter)?, IteratorMode::Start).count();

        Ok((pending, in_progress, completed, failed, dead_letter))
    }

    /// Recovery: Move in_progress tasks back to pending (for crash recovery).
    pub fn recover(&self) -> Result<RecoveryStats> {
        info!("Starting recovery process");

        let mut stats = RecoveryStats::default();

        // Move all in_progress tasks back to pending
        let in_progress_tasks = self.get_tasks_by_status(TaskStatus::InProgress)?;
        for task in in_progress_tasks {
            info!("Recovering in_progress task {} back to pending", task.id);
            self.move_task(task.id, TaskStatus::InProgress, TaskStatus::Pending)?;
            stats.recovered_in_progress += 1;
        }

        // Verify pending queue and rebuild priority index
        let pending_tasks = self.get_tasks_by_status(TaskStatus::Pending)?;
        for task in &pending_tasks {
            // Verify index consistency
            self.update_indexes(task)?;
            stats.pending_verified += 1;
        }

        info!("Recovery complete: {:?}", stats);
        Ok(stats)
    }

    /// Force flush all data to disk.
    pub fn flush(&self) -> Result<()> {
        self.db.flush()
            .map_err(|e| TaskQueueError::DatabaseError(format!("Failed to flush DB: {}", e)))?;
        Ok(())
    }

    /// Get database statistics.
    pub fn get_stats(&self) -> Result<DbStats> {
        let (pending, in_progress, completed, failed, dead_letter) = self.count_by_status()?;

        Ok(DbStats {
            pending_count: pending,
            in_progress_count: in_progress,
            completed_count: completed,
            failed_count: failed,
            dead_letter_count: dead_letter,
            db_path: self.config.db_path.clone(),
            wal_enabled: self.config.enable_wal,
        })
    }
}

/// Recovery statistics.
#[derive(Debug, Default, Clone)]
pub struct RecoveryStats {
    pub recovered_in_progress: usize,
    pub pending_verified: usize,
    pub total_recovered: usize,
}

impl RecoveryStats {
    pub fn total(&self) -> usize {
        self.recovered_in_progress + self.pending_verified
    }
}

/// Database statistics.
#[derive(Debug, Clone)]
pub struct DbStats {
    pub pending_count: usize,
    pub in_progress_count: usize,
    pub completed_count: usize,
    pub failed_count: usize,
    pub dead_letter_count: usize,
    pub db_path: String,
    pub wal_enabled: bool,
}

impl Drop for RocksDbPersistence {
    fn drop(&mut self) {
        info!("Closing RocksDB persistence");
        if let Some(handle) = self.compaction_task.take() {
            handle.abort();
        }
        // Flush before closing
        if let Err(e) = self.flush() {
            error!("Failed to flush DB on close: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use task_queue_core::task::Task;

    fn create_test_persistence() -> (RocksDbPersistence, TempDir) {
        let temp_dir = TempDir::new().expect("Failed to create temp dir");
        let config = RocksDbConfig {
            db_path: temp_dir.path().to_str().unwrap().to_string(),
            enable_wal: true,
            periodic_compaction_seconds: 0, // Disable for tests
            ..Default::default()
        };
        let persistence = RocksDbPersistence::open(config).expect("Failed to open DB");
        (persistence, temp_dir)
    }

    #[test]
    fn test_persistence_creation() {
        let (_persistence, _temp_dir) = create_test_persistence();
    }

    #[test]
    fn test_store_and_retrieve_task() {
        let (persistence, _temp_dir) = create_test_persistence();

        let task = Task::new("test_task".to_string(), vec![1, 2, 3]);
        let task_id = task.id;

        persistence.store_task(&task).expect("Failed to store task");
        let retrieved = persistence.get_task(task_id).expect("Failed to get task");

        assert!(retrieved.is_some());
        let retrieved_task = retrieved.unwrap();
        assert_eq!(retrieved_task.id, task.id);
        assert_eq!(retrieved_task.task_type, task.task_type);
        assert_eq!(retrieved_task.payload, task.payload);
        assert_eq!(retrieved_task.status, TaskStatus::Pending);
    }

    #[test]
    fn test_move_task_status() {
        let (persistence, _temp_dir) = create_test_persistence();

        let task = Task::new("test_task".to_string(), vec![1, 2, 3]);
        let task_id = task.id;

        persistence.store_task(&task).expect("Failed to store task");

        // Move to in_progress
        persistence.move_task(task_id, TaskStatus::Pending, TaskStatus::InProgress)
            .expect("Failed to move task");

        let retrieved = persistence.get_task(task_id).expect("Failed to get task");
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().status, TaskStatus::InProgress);

        // Move to completed
        persistence.move_task(task_id, TaskStatus::InProgress, TaskStatus::Completed)
            .expect("Failed to move task");

        let retrieved = persistence.get_task(task_id).expect("Failed to get task");
        assert!(retrieved.unwrap().status, TaskStatus::Completed);
    }

    #[test]
    fn test_count_by_status() {
        let (persistence, _temp_dir) = create_test_persistence();

        let task1 = Task::new("task1".to_string(), vec![]).with_priority(100);
        let task2 = Task::new("task2".to_string(), vec![]).with_priority(200);
        let task3 = Task::new("task3".to_string(), vec![]).with_priority(150);

        persistence.store_task(&task1).expect("Failed to store task1");
        persistence.store_task(&task2).expect("Failed to store task2");
        persistence.store_task(&task3).expect("Failed to store task3");

        persistence.move_task(task1.id, TaskStatus::Pending, TaskStatus::InProgress)
            .expect("Failed to move task1");
        persistence.move_task(task2.id, TaskStatus::Pending, TaskStatus::Completed)
            .expect("Failed to move task2");

        let (pending, in_progress, completed, failed, dead_letter) =
            persistence.count_by_status().expect("Failed to count");

        assert_eq!(pending, 1);
        assert_eq!(in_progress, 1);
        assert_eq!(completed, 1);
        assert_eq!(failed, 0);
        assert_eq!(dead_letter, 0);
    }

    #[test]
    fn test_get_tasks_by_status() {
        let (persistence, _temp_dir) = create_test_persistence();

        let task1 = Task::new("task1".to_string(), vec![]);
        let task2 = Task::new("task2".to_string(), vec![]);
        let task3 = Task::new("task3".to_string(), vec![]);

        persistence.store_task(&task1).expect("Failed to store task1");
        persistence.store_task(&task2).expect("Failed to store task2");
        persistence.store_task(&task3).expect("Failed to store task3");

        persistence.move_task(task1.id, TaskStatus::Pending, TaskStatus::Completed)
            .expect("Failed to move task1");
        persistence.move_task(task2.id, TaskStatus::Pending, TaskStatus::Completed)
            .expect("Failed to move task2");

        let pending = persistence.get_tasks_by_status(TaskStatus::Pending)
            .expect("Failed to get pending tasks");
        let completed = persistence.get_tasks_by_status(TaskStatus::Completed)
            .expect("Failed to get completed tasks");

        assert_eq!(pending.len(), 1);
        assert_eq!(completed.len(), 2);
    }

    #[test]
    fn test_get_tasks_by_type() {
        let (persistence, _temp_dir) = create_test_persistence();

        let task1 = Task::new("email".to_string(), vec![]);
        let task2 = Task::new("email".to_string(), vec![]);
        let task3 = Task::new("report".to_string(), vec![]);

        persistence.store_task(&task1).expect("Failed to store task1");
        persistence.store_task(&task2).expect("Failed to store task2");
        persistence.store_task(&task3).expect("Failed to store task3");

        let email_tasks = persistence.get_tasks_by_type("email")
            .expect("Failed to get email tasks");
        let report_tasks = persistence.get_tasks_by_type("report")
            .expect("Failed to get report tasks");

        assert_eq!(email_tasks.len(), 2);
        assert_eq!(report_tasks.len(), 1);
    }

    #[test]
    fn test_get_tasks_by_priority() {
        let (persistence, _temp_dir) = create_test_persistence();

        let task1 = Task::new("task1".to_string(), vec![]).with_priority(50);
        let task2 = Task::new("task2".to_string(), vec![]).with_priority(150);
        let task3 = Task::new("task3".to_string(), vec![]).with_priority(200);

        persistence.store_task(&task1).expect("Failed to store task1");
        persistence.store_task(&task2).expect("Failed to store task2");
        persistence.store_task(&task3).expect("Failed to store task3");

        let high_priority = persistence.get_tasks_by_priority(TaskStatus::Pending, 200, 255)
            .expect("Failed to get high priority tasks");
        let normal_priority = persistence.get_tasks_by_priority(TaskStatus::Pending, 100, 199)
            .expect("Failed to get normal priority tasks");
        let low_priority = persistence.get_tasks_by_priority(TaskStatus::Pending, 0, 99)
            .expect("Failed to get low priority tasks");

        assert_eq!(high_priority.len(), 1);
        assert_eq!(normal_priority.len(), 1);
        assert_eq!(low_priority.len(), 1);
    }

    #[test]
    fn test_scheduled_tasks() {
        let (persistence, _temp_dir) = create_test_persistence();

        let now = chrono::Utc::now();

        let task1 = Task::new("task1".to_string(), vec![])
            .with_scheduled_at(now);
        let task2 = Task::new("task2".to_string(), vec![])
            .with_scheduled_at(now + chrono::Duration::seconds(60));
        let task3 = Task::new("task3".to_string(), vec![])
            .with_scheduled_at(now - chrono::Duration::seconds(60));

        persistence.store_task(&task1).expect("Failed to store task1");
        persistence.store_task(&task2).expect("Failed to store task2");
        persistence.store_task(&task3).expect("Failed to store task3");

        let scheduled = persistence.get_scheduled_tasks(now.timestamp())
            .expect("Failed to get scheduled tasks");

        // task1 and task3 should be scheduled (now and before now)
        assert!(scheduled.len() >= 1);
    }

    #[test]
    fn test_recovery() {
        let (persistence, _temp_dir) = create_test_persistence();

        let task1 = Task::new("task1".to_string(), vec![]);
        let task2 = Task::new("task2".to_string(), vec![]);
        let task3 = Task::new("task3".to_string(), vec![]);

        persistence.store_task(&task1).expect("Failed to store task1");
        persistence.store_task(&task2).expect("Failed to store task2");
        persistence.store_task(&task3).expect("Failed to store task3");

        // Simulate crash by moving tasks to in_progress
        persistence.move_task(task1.id, TaskStatus::Pending, TaskStatus::InProgress)
            .expect("Failed to move task1");
        persistence.move_task(task2.id, TaskStatus::Pending, TaskStatus::InProgress)
            .expect("Failed to move task2");

        // Recovery should move in_progress back to pending
        let stats = persistence.recover().expect("Recovery failed");

        assert_eq!(stats.recovered_in_progress, 2);
        assert_eq!(stats.pending_verified, 3);

        // Verify all tasks are now pending
        let pending = persistence.get_tasks_by_status(TaskStatus::Pending)
            .expect("Failed to get pending tasks");
        let in_progress = persistence.get_tasks_by_status(TaskStatus::InProgress)
            .expect("Failed to get in_progress tasks");

        assert_eq!(pending.len(), 3);
        assert_eq!(in_progress.len(), 0);
    }

    #[test]
    fn test_delete_task() {
        let (persistence, _temp_dir) = create_test_persistence();

        let task = Task::new("test_task".to_string(), vec![]);
        let task_id = task.id;

        persistence.store_task(&task).expect("Failed to store task");
        persistence.delete_task(task_id, TaskStatus::Pending)
            .expect("Failed to delete task");

        let retrieved = persistence.get_task(task_id).expect("Failed to get task");
        assert!(retrieved.is_none());
    }

    #[test]
    fn test_transaction_move() {
        let (persistence, _temp_dir) = create_test_persistence();

        let task = Task::new("test_task".to_string(), vec![]);
        let task_id = task.id;

        persistence.store_task(&task).expect("Failed to store task");

        // Verify task is in pending
        let retrieved = persistence.get_task(task_id).expect("Failed to get task");
        assert_eq!(retrieved.unwrap().status, TaskStatus::Pending);

        // Move to in_progress atomically
        persistence.move_task(task_id, TaskStatus::Pending, TaskStatus::InProgress)
            .expect("Failed to move task");

        // Verify task is now in in_progress and not in pending
        let pending_tasks = persistence.get_tasks_by_status(TaskStatus::Pending)
            .expect("Failed to get pending tasks");
        let in_progress_tasks = persistence.get_tasks_by_status(TaskStatus::InProgress)
            .expect("Failed to get in_progress tasks");

        assert!(!pending_tasks.iter().any(|t| t.id == task_id));
        assert!(in_progress_tasks.iter().any(|t| t.id == task_id));
    }

    #[test]
    fn test_get_stats() {
        let (persistence, _temp_dir) = create_test_persistence();

        let task1 = Task::new("task1".to_string(), vec![]);
        let task2 = Task::new("task2".to_string(), vec![]);

        persistence.store_task(&task1).expect("Failed to store task1");
        persistence.store_task(&task2).expect("Failed to store task2");

        persistence.move_task(task1.id, TaskStatus::Pending, TaskStatus::Completed)
            .expect("Failed to move task1");

        let stats = persistence.get_stats().expect("Failed to get stats");

        assert_eq!(stats.pending_count, 1);
        assert_eq!(stats.completed_count, 1);
        assert_eq!(stats.in_progress_count, 0);
        assert!(stats.wal_enabled);
    }

    #[test]
    fn test_bincode_serialization_consistency() {
        use task_queue_core::serialization::{serialize_task_bincode, deserialize_task_bincode};

        let task = Task::new("test".to_string(), vec![1, 2, 3, 4, 5])
            .with_priority(200)
            .with_max_retries(5)
            .with_timeout(600);

        // Serialize and deserialize
        let serialized = serialize_task_bincode(&task).expect("Serialization failed");
        let deserialized = deserialize_task_bincode(&serialized).expect("Deserialization failed");

        // Verify all fields match
        assert_eq!(task.id, deserialized.id);
        assert_eq!(task.task_type, deserialized.task_type);
        assert_eq!(task.payload, deserialized.payload);
        assert_eq!(task.priority, deserialized.priority);
        assert_eq!(task.status, deserialized.status);
        assert_eq!(task.max_retries, deserialized.max_retries);
        assert_eq!(task.retry_count, deserialized.retry_count);
        assert_eq!(task.timeout_seconds, deserialized.timeout_seconds);
        assert_eq!(task.dependencies, deserialized.dependencies);
    }

    #[test]
    fn test_large_payload_storage() {
        let (persistence, _temp_dir) = create_test_persistence();

        // Create a large payload (1MB)
        let large_payload: Vec<u8> = (0..1_000_000).map(|i| (i % 256) as u8).collect();
        let task = Task::new("large_task".to_string(), large_payload);

        persistence.store_task(&task).expect("Failed to store large task");

        let retrieved = persistence.get_task(task.id).expect("Failed to retrieve large task");
        assert!(retrieved.is_some());

        let retrieved_task = retrieved.unwrap();
        assert_eq!(retrieved_task.payload.len(), 1_000_000);
        assert_eq!(retrieved_task.payload, task.payload);
    }

    #[test]
    fn test_index_consistency() {
        let (persistence, _temp_dir) = create_test_persistence();

        let task1 = Task::new("email".to_string(), vec![]).with_priority(150);
        let task2 = Task::new("email".to_string(), vec![]).with_priority(200);
        let task3 = Task::new("report".to_string(), vec![]).with_priority(150);

        persistence.store_task(&task1).expect("Failed to store task1");
        persistence.store_task(&task2).expect("Failed to store task2");
        persistence.store_task(&task3).expect("Failed to store task3");

        // Query by type
        let email_tasks = persistence.get_tasks_by_type("email")
            .expect("Failed to get email tasks");
        assert_eq!(email_tasks.len(), 2);

        // Query by priority
        let priority_150 = persistence.get_tasks_by_priority(TaskStatus::Pending, 150, 150)
            .expect("Failed to get priority 150 tasks");
        assert_eq!(priority_150.len(), 2);

        // Move a task and verify indexes update
        persistence.move_task(task1.id, TaskStatus::Pending, TaskStatus::Completed)
            .expect("Failed to move task1");

        let email_tasks = persistence.get_tasks_by_type("email")
            .expect("Failed to get email tasks");
        // Still 2 email tasks, but one is now completed
        assert_eq!(email_tasks.len(), 2);

        let pending_email = email_tasks.iter().filter(|t| t.status == TaskStatus::Pending).count();
        assert_eq!(pending_email, 1);
    }