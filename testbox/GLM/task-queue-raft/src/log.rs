//! Raft Log Implementation
//!
//! This module implements the Raft log, which stores commands to be replicated
//! and applied to the state machine.

use std::collections::VecDeque;
use serde::{Deserialize, Serialize};
use tracing::debug;

/// A single entry in the Raft log
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    /// The term when the entry was received by leader
    pub term: u64,
    /// The index of this entry in the log
    pub index: u64,
    /// The command to apply to the state machine
    pub command: Vec<u8>,
}

/// The Raft log structure
pub struct RaftLog {
    /// The log entries (0 is unused, indexes start at 1)
    entries: VecDeque<LogEntry>,
    /// The current snapshot (if any)
    snapshot: Option<Snapshot>,
}

/// Snapshot of the state machine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    /// The last log index included in the snapshot
    pub last_included_index: u64,
    /// The last log term included in the snapshot
    pub last_included_term: u64,
    /// The snapshot data
    pub data: Vec<u8>,
}

impl RaftLog {
    /// Create a new empty log
    pub fn new() -> Self {
        Self {
            entries: VecDeque::new(),
            snapshot: None,
        }
    }
    
    /// Get the last log index
    pub fn last_index(&self) -> u64 {
        if let Some(snapshot) = &self.snapshot {
            snapshot.last_included_index + self.entries.len() as u64
        } else {
            self.entries.len() as u64
        }
    }
    
    /// Get the term of the last log entry
    pub fn last_term(&self) -> u64 {
        if self.entries.is_empty() {
            self.snapshot.as_ref().map(|s| s.last_included_term).unwrap_or(0)
        } else {
            self.entries.back().map(|e| e.term).unwrap_or(0)
        }
    }
    
    /// Get a log entry by index
    pub fn get_entry(&self, index: u64) -> Option<&LogEntry> {
        if let Some(snapshot) = &self.snapshot {
            if index <= snapshot.last_included_index {
                // Entry is in snapshot (not directly accessible)
                return None;
            }
            let relative_index = (index - snapshot.last_included_index - 1) as usize;
            self.entries.get(relative_index)
        } else {
            // No snapshot, entries start at index 1
            if index == 0 {
                return None;
            }
            self.entries.get((index - 1) as usize)
        }
    }
    
    /// Append entries to the log
    pub fn append(&mut self, mut entries: Vec<LogEntry>) {
        if entries.is_empty() {
            return;
        }
        
        // Update indices based on current log state
        let base_index = if let Some(snapshot) = &self.snapshot {
            snapshot.last_included_index + 1
        } else {
            1
        };
        
        let current_len = self.entries.len() as u64;
        
        for (i, entry) in entries.iter_mut().enumerate() {
            // Ensure index is correct
            let expected_index = base_index + current_len + i as u64;
            if entry.index == 0 || entry.index < expected_index {
                entry.index = expected_index;
            }
        }
        
        debug!("Appending {} entries at index {}", entries.len(), base_index + current_len);
        self.entries.extend(entries);
    }
    
    /// Truncate the log from the given index (inclusive)
    pub fn truncate_from(&mut self, index: u64) {
        if let Some(snapshot) = &self.snapshot {
            if index <= snapshot.last_included_index {
                // Cannot truncate into snapshot
                return;
            }
            let relative_index = (index - snapshot.last_included_index - 1) as usize;
            if relative_index < self.entries.len() {
                self.entries.truncate(relative_index);
                debug!("Truncated log from index {}", index);
            }
        } else {
            if index == 0 {
                self.entries.clear();
                debug!("Cleared entire log");
            } else {
                let relative_index = (index - 1) as usize;
                if relative_index < self.entries.len() {
                    self.entries.truncate(relative_index);
                    debug!("Truncated log from index {}", index);
                }
            }
        }
    }
    
    /// Get entries from a given index
    pub fn entries_from(&self, index: u64) -> impl Iterator<Item = LogEntry> + '_ {
        let base_index = if let Some(snapshot) = &self.snapshot {
            snapshot.last_included_index + 1
        } else {
            1
        };
        
        let start = if index <= base_index {
            0
        } else {
            (index - base_index) as usize
        };
        
        self.entries.range(start..).cloned()
    }
    
    /// Create a snapshot at the given index
    pub fn create_snapshot(&mut self, last_included_index: u64, last_included_term: u64, data: Vec<u8>) {
        if last_included_index > self.last_index() {
            return;
        }
        
        let snapshot = Snapshot {
            last_included_index,
            last_included_term,
            data,
        };
        
        // Remove entries that are included in the snapshot
        let new_entries: VecDeque<LogEntry> = if last_included_index > 0 {
            let _base_index = self.snapshot.as_ref()
                .map(|s| s.last_included_index + 1)
                .unwrap_or(1);
            
            if let Some(snapshot) = &self.snapshot {
                let remove_count = (last_included_index - snapshot.last_included_index) as usize;
                self.entries.drain(..remove_count.min(self.entries.len()));
            } else {
                let remove_count = last_included_index as usize;
                self.entries.drain(..remove_count.min(self.entries.len()));
            }
            
            self.entries.clone()
        } else {
            self.entries.clone()
        };
        
        self.snapshot = Some(snapshot);
        self.entries = new_entries;
        
        debug!("Created snapshot at index {}", last_included_index);
    }
    
    /// Restore from a snapshot
    pub fn restore_snapshot(&mut self, snapshot: Snapshot) -> Result<(), String> {
        if let Some(current_snapshot) = &self.snapshot {
            if snapshot.last_included_index <= current_snapshot.last_included_index {
                return Err("New snapshot is not more recent".to_string());
            }
        }
        
        debug!("Restored from snapshot at index {}", snapshot.last_included_index);
        
        self.snapshot = Some(snapshot);
        self.entries.clear();
        
        Ok(())
    }
    
    /// Get the current snapshot
    pub fn get_snapshot(&self) -> Option<&Snapshot> {
        self.snapshot.as_ref()
    }
    
    /// Get the number of entries in the log
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    
    /// Check if the log is empty
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl Default for RaftLog {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_empty_log() {
        let log = RaftLog::new();
        assert_eq!(log.last_index(), 0);
        assert_eq!(log.last_term(), 0);
        assert!(log.is_empty());
    }
    
    #[test]
    fn test_append_entries() {
        let mut log = RaftLog::new();
        
        let entries = vec![
            LogEntry {
                term: 1,
                index: 0, // Will be auto-assigned
                command: vec![1, 2, 3],
            },
            LogEntry {
                term: 1,
                index: 0,
                command: vec![4, 5, 6],
            },
        ];
        
        log.append(entries);
        
        assert_eq!(log.last_index(), 2);
        assert_eq!(log.last_term(), 1);
        assert_eq!(log.len(), 2);
    }
    
    #[test]
    fn test_get_entry() {
        let mut log = RaftLog::new();
        
        log.append(vec![LogEntry {
            term: 1,
            index: 0,
            command: vec![1, 2, 3],
        }]);
        
        let entry = log.get_entry(1);
        assert!(entry.is_some());
        assert_eq!(entry.unwrap().index, 1);
        
        let entry = log.get_entry(0);
        assert!(entry.is_none());
    }
    
    #[test]
    fn test_truncate() {
        let mut log = RaftLog::new();
        
        log.append(vec![
            LogEntry { term: 1, index: 0, command: vec![1] },
            LogEntry { term: 1, index: 0, command: vec![2] },
            LogEntry { term: 1, index: 0, command: vec![3] },
        ]);
        
        log.truncate_from(2);
        
        assert_eq!(log.last_index(), 1);
        assert_eq!(log.len(), 1);
        assert!(log.get_entry(2).is_none());
        assert!(log.get_entry(1).is_some());
    }
    
    #[test]
    fn test_snapshot() {
        let mut log = RaftLog::new();
        
        log.append(vec![
            LogEntry { term: 1, index: 0, command: vec![1] },
            LogEntry { term: 1, index: 0, command: vec![2] },
            LogEntry { term: 1, index: 0, command: vec![3] },
        ]);
        
        // Snapshot first 2 entries (indices 1 and 2)
        log.create_snapshot(2, 1, vec![10, 20, 30]);
        
        // After snapshot, entries 1 and 2 are in snapshot, entry 3 remains in log
        assert_eq!(log.last_index(), 3);
        assert_eq!(log.len(), 1);
        assert!(log.get_snapshot().is_some());
        
        let snapshot = log.get_snapshot().unwrap();
        assert_eq!(snapshot.last_included_index, 2);
        assert_eq!(snapshot.last_included_term, 1);
        
        // Entry 3 should still be accessible
        assert!(log.get_entry(3).is_some());
        // Entries 1 and 2 are in snapshot, not directly accessible via get_entry
        assert!(log.get_entry(1).is_none());
        assert!(log.get_entry(2).is_none());
    }
    
    #[test]
    fn test_entries_from() {
        let mut log = RaftLog::new();
        
        log.append(vec![
            LogEntry { term: 1, index: 0, command: vec![1] },
            LogEntry { term: 1, index: 0, command: vec![2] },
            LogEntry { term: 1, index: 0, command: vec![3] },
        ]);
        
        let entries: Vec<_> = log.entries_from(2).collect();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].index, 2);
        assert_eq!(entries[1].index, 3);
    }
}