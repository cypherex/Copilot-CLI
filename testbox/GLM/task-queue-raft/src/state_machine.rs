//! Raft State Machine
//!
//! This module defines the state machine interface and provides an
//! in-memory implementation for testing.

use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Command types that can be applied to the state machine
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StateMachineCommand {
    /// Set a key-value pair
    Set { key: String, value: Vec<u8> },
    /// Delete a key
    Delete { key: String },
    /// Custom command with raw bytes
    Custom(Vec<u8>),
}

/// Trait for a Raft state machine
///
/// The state machine applies commands from the Raft log in order.
/// Implementations must ensure that applying the same sequence of
/// commands always produces the same result.
pub trait StateMachine: Send + Sync {
    /// Apply a command to the state machine
    fn apply(&mut self, command: Vec<u8>) -> Result<(), String>;
    
    /// Create a snapshot of the current state
    fn snapshot(&self) -> Result<Vec<u8>, String>;
    
    /// Restore from a snapshot
    fn restore(&mut self, snapshot: &[u8]) -> Result<(), String>;
    
    /// Get the current size of the state machine
    fn size(&self) -> usize;
}

/// In-memory state machine implementation for testing
///
/// This stores key-value pairs in memory and is not persistent.
pub struct MemoryStateMachine {
    data: HashMap<String, Vec<u8>>,
}

impl MemoryStateMachine {
    /// Create a new in-memory state machine
    pub fn new() -> Self {
        Self {
            data: HashMap::new(),
        }
    }
    
    /// Get a value by key
    pub fn get(&self, key: &str) -> Option<&[u8]> {
        self.data.get(key).map(|v| v.as_slice())
    }
    
    /// Set a key-value pair (directly, not through Raft)
    pub fn set_direct(&mut self, key: String, value: Vec<u8>) {
        self.data.insert(key, value);
    }
    
    /// Delete a key (directly, not through Raft)
    pub fn delete_direct(&mut self, key: &str) {
        self.data.remove(key);
    }
    
    /// Get all keys
    pub fn keys(&self) -> Vec<String> {
        self.data.keys().cloned().collect()
    }
    
    /// Get the number of entries
    pub fn len(&self) -> usize {
        self.data.len()
    }
    
    /// Check if empty
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }
}

impl Default for MemoryStateMachine {
    fn default() -> Self {
        Self::new()
    }
}

impl StateMachine for MemoryStateMachine {
    fn apply(&mut self, command: Vec<u8>) -> Result<(), String> {
        // Try to deserialize as StateMachineCommand
        if let Ok(cmd) = bincode::deserialize::<StateMachineCommand>(&command) {
            match cmd {
                StateMachineCommand::Set { key, value } => {
                    self.data.insert(key, value);
                    Ok(())
                }
                StateMachineCommand::Delete { key } => {
                    self.data.remove(&key);
                    Ok(())
                }
                StateMachineCommand::Custom(data) => {
                    // Store custom commands with a generated key
                    let key = format!("custom_{}", self.data.len());
                    self.data.insert(key, data);
                    Ok(())
                }
            }
        } else {
            // If deserialization fails, just store the raw command
            // This allows for arbitrary command formats
            let key = format!("cmd_{}", self.data.len());
            self.data.insert(key, command);
            Ok(())
        }
    }
    
    fn snapshot(&self) -> Result<Vec<u8>, String> {
        bincode::serialize(&self.data)
            .map_err(|e| format!("Failed to serialize snapshot: {}", e))
    }
    
    fn restore(&mut self, snapshot: &[u8]) -> Result<(), String> {
        let data: HashMap<String, Vec<u8>> = bincode::deserialize(snapshot)
            .map_err(|e| format!("Failed to deserialize snapshot: {}", e))?;
        self.data = data;
        Ok(())
    }
    
    fn size(&self) -> usize {
        // Estimate memory usage
        self.data.iter()
            .map(|(k, v)| k.len() + v.len())
            .sum()
    }
}


/// Helper to create a Set command
pub fn create_set_command(key: String, value: Vec<u8>) -> Vec<u8> {
    let cmd = StateMachineCommand::Set { key, value };
    bincode::serialize(&cmd).expect("Failed to serialize set command")
}

/// Helper to create a Delete command
pub fn create_delete_command(key: String) -> Vec<u8> {
    let cmd = StateMachineCommand::Delete { key };
    bincode::serialize(&cmd).expect("Failed to serialize delete command")
}

/// Helper to create a Custom command
pub fn create_custom_command(data: Vec<u8>) -> Vec<u8> {
    let cmd = StateMachineCommand::Custom(data);
    bincode::serialize(&cmd).expect("Failed to serialize custom command")
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_memory_state_machine_set() {
        let mut sm = MemoryStateMachine::new();
        let cmd = create_set_command("key1".to_string(), vec![1, 2, 3]);
        sm.apply(cmd).unwrap();
        
        assert_eq!(sm.get("key1"), Some(&[1, 2, 3][..]));
        assert_eq!(sm.len(), 1);
    }
    
    #[test]
    fn test_memory_state_machine_delete() {
        let mut sm = MemoryStateMachine::new();
        let set_cmd = create_set_command("key1".to_string(), vec![1, 2, 3]);
        sm.apply(set_cmd).unwrap();
        
        let del_cmd = create_delete_command("key1".to_string());
        sm.apply(del_cmd).unwrap();
        
        assert!(sm.get("key1").is_none());
        assert_eq!(sm.len(), 0);
    }
    
    #[test]
    fn test_memory_state_machine_snapshot() {
        let mut sm = MemoryStateMachine::new();
        sm.apply(create_set_command("key1".to_string(), vec![1, 2, 3])).unwrap();
        sm.apply(create_set_command("key2".to_string(), vec![4, 5, 6])).unwrap();
        
        let snapshot = sm.snapshot().unwrap();
        
        let mut sm2 = MemoryStateMachine::new();
        sm2.restore(&snapshot).unwrap();
        
        assert_eq!(sm2.get("key1"), Some(&[1, 2, 3][..]));
        assert_eq!(sm2.get("key2"), Some(&[4, 5, 6][..]));
        assert_eq!(sm2.len(), 2);
    }
    
    #[test]
    fn test_memory_state_machine_custom_command() {
        let mut sm = MemoryStateMachine::new();
        let cmd = create_custom_command(vec![10, 20, 30]);
        sm.apply(cmd).unwrap();
        
        assert_eq!(sm.len(), 1);
    }
    
    #[test]
    fn test_memory_state_machine_raw_command() {
        let mut sm = MemoryStateMachine::new();
        let raw_cmd = vec![1, 2, 3, 4, 5]; // Not a valid StateMachineCommand
        
        sm.apply(raw_cmd).unwrap();
        
        assert_eq!(sm.len(), 1);
        assert!(sm.keys().first().unwrap().starts_with("cmd_"));
    }
    
    #[test]
    fn test_memory_state_machine_size() {
        let mut sm = MemoryStateMachine::new();
        sm.apply(create_set_command("key1".to_string(), vec![1, 2, 3])).unwrap();
        sm.apply(create_set_command("key2".to_string(), vec![4, 5, 6])).unwrap();
        
        let size = sm.size();
        assert!(size > 0);
    }
}