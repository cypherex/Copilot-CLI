use crate::{PersistenceError, Result};
use serde::{Deserialize, Serialize};
use task_queue_core::{TaskId, Task};
use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::Mutex;
use chrono::{DateTime, Utc};

/// Write-Ahead Log entry types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WalEntry {
    /// Task submitted to queue
    TaskSubmitted { task: Task, timestamp: DateTime<Utc> },

    /// Task claimed by worker
    TaskClaimed { task_id: TaskId, worker_id: String, timestamp: DateTime<Utc> },

    /// Task completed
    TaskCompleted { task_id: TaskId, result: Vec<u8>, timestamp: DateTime<Utc> },

    /// Task failed
    TaskFailed { task_id: TaskId, error: String, timestamp: DateTime<Utc> },

    /// Task moved to dead letter queue
    TaskMovedToDlq { task_id: TaskId, timestamp: DateTime<Utc> },

    /// Task released (worker died)
    TaskReleased { task_id: TaskId, timestamp: DateTime<Utc> },
}

/// Write-Ahead Log for durability
pub struct WriteAheadLog {
    db: Arc<rocksdb::DB>,
    sequence_number: Arc<Mutex<u64>>,
}

impl WriteAheadLog {
    /// Create or open WAL
    pub fn open(path: PathBuf) -> Result<Self> {
        let mut opts = rocksdb::Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);

        let db = rocksdb::DB::open(&opts, path)?;

        // Get the last sequence number
        let mut iter = db.raw_iterator();
        iter.seek_to_last();

        let sequence_number = if iter.valid() {
            if let Some(key) = iter.key() {
                u64::from_be_bytes(key.try_into().unwrap_or([0u8; 8])) + 1
            } else {
                0
            }
        } else {
            0
        };

        Ok(WriteAheadLog {
            db: Arc::new(db),
            sequence_number: Arc::new(Mutex::new(sequence_number)),
        })
    }

    /// Append entry to WAL
    pub fn append(&self, entry: WalEntry) -> Result<u64> {
        let mut seq = self.sequence_number.lock();
        let seq_num = *seq;

        let key = seq_num.to_be_bytes();
        let value = bincode::serialize(&entry)?;

        self.db.put(&key, &value)?;

        *seq += 1;
        Ok(seq_num)
    }

    /// Read entry at sequence number
    pub fn get(&self, seq_num: u64) -> Result<Option<WalEntry>> {
        let key = seq_num.to_be_bytes();

        if let Some(value) = self.db.get(&key)? {
            let entry = bincode::deserialize(&value)?;
            Ok(Some(entry))
        } else {
            Ok(None)
        }
    }

    /// Replay all entries from a sequence number
    pub fn replay_from(&self, start_seq: u64) -> Result<Vec<(u64, WalEntry)>> {
        let mut entries = Vec::new();
        let mut iter = self.db.raw_iterator();

        iter.seek(&start_seq.to_be_bytes());

        while iter.valid() {
            if let (Some(key), Some(value)) = (iter.key(), iter.value()) {
                let seq = u64::from_be_bytes(
                    key.try_into()
                        .map_err(|_| PersistenceError::WalError("Invalid key format".to_string()))?
                );
                let entry: WalEntry = bincode::deserialize(value)?;
                entries.push((seq, entry));
            }
            iter.next();
        }

        Ok(entries)
    }

    /// Get all entries
    pub fn all_entries(&self) -> Result<Vec<(u64, WalEntry)>> {
        self.replay_from(0)
    }

    /// Truncate WAL up to sequence number (inclusive)
    pub fn truncate(&self, up_to_seq: u64) -> Result<()> {
        for seq in 0..=up_to_seq {
            let key = seq.to_be_bytes();
            self.db.delete(&key)?;
        }
        Ok(())
    }

    /// Compact WAL (remove old entries, keep recent ones)
    pub fn compact(&self, keep_last_n: u64) -> Result<()> {
        let current_seq = *self.sequence_number.lock();

        if current_seq > keep_last_n {
            let truncate_to = current_seq - keep_last_n - 1;
            self.truncate(truncate_to)?;
        }

        Ok(())
    }

    /// Sync WAL to disk
    pub fn sync(&self) -> Result<()> {
        self.db.flush()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use task_queue_core::Priority;
    use tempfile::TempDir;

    #[test]
    fn test_wal_append_and_replay() {
        let temp_dir = TempDir::new().unwrap();
        let wal_path = temp_dir.path().join("wal");

        let wal = WriteAheadLog::open(wal_path.clone()).unwrap();

        let task = Task::new(
            "test".to_string(),
            b"data".to_vec(),
            Priority::normal(),
        ).unwrap();

        let entry = WalEntry::TaskSubmitted {
            task: task.clone(),
            timestamp: Utc::now(),
        };

        let seq1 = wal.append(entry.clone()).unwrap();
        assert_eq!(seq1, 0);

        let seq2 = wal.append(entry.clone()).unwrap();
        assert_eq!(seq2, 1);

        // Replay all
        let entries = wal.all_entries().unwrap();
        assert_eq!(entries.len(), 2);

        // Replay from sequence 1
        let entries = wal.replay_from(1).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, 1);
    }

    #[test]
    fn test_wal_persistence() {
        let temp_dir = TempDir::new().unwrap();
        let wal_path = temp_dir.path().join("wal");

        {
            let wal = WriteAheadLog::open(wal_path.clone()).unwrap();
            let task = Task::new("test".to_string(), b"data".to_vec(), Priority::normal()).unwrap();
            let entry = WalEntry::TaskSubmitted { task, timestamp: Utc::now() };
            wal.append(entry).unwrap();
        }

        // Reopen and verify
        {
            let wal = WriteAheadLog::open(wal_path).unwrap();
            let entries = wal.all_entries().unwrap();
            assert_eq!(entries.len(), 1);
        }
    }
}
