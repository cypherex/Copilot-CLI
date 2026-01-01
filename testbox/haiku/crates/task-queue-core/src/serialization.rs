//! Serialization utilities for tasks and messages.

use crate::task::{Task, TaskId};
use serde_json;
use std::collections::HashSet;

/// Serialize a task to JSON bytes.
pub fn serialize_task(task: &Task) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(task)
}

/// Deserialize a task from JSON bytes.
pub fn deserialize_task(bytes: &[u8]) -> Result<Task, serde_json::Error> {
    serde_json::from_slice(bytes)
}

/// Serialize a task to compact binary format using bincode.
/// This is more efficient than JSON for storage and network transmission.
pub fn serialize_task_bincode(task: &Task) -> Result<Vec<u8>, Box<bincode::ErrorKind>> {
    bincode::serialize(task)
}

/// Deserialize a task from compact binary format.
pub fn deserialize_task_bincode(bytes: &[u8]) -> Result<Task, Box<bincode::ErrorKind>> {
    bincode::deserialize(bytes)
}

/// Serialize multiple tasks using bincode.
pub fn serialize_tasks_bincode(tasks: &[Task]) -> Result<Vec<u8>, Box<bincode::ErrorKind>> {
    bincode::serialize(tasks)
}

/// Deserialize multiple tasks using bincode.
pub fn deserialize_tasks_bincode(bytes: &[u8]) -> Result<Vec<Task>, Box<bincode::ErrorKind>> {
    bincode::deserialize(bytes)
}

/// Serialize multiple tasks.
pub fn serialize_tasks(tasks: &[Task]) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(tasks)
}

/// Deserialize multiple tasks.
pub fn deserialize_tasks(bytes: &[u8]) -> Result<Vec<Task>, serde_json::Error> {
    serde_json::from_slice(bytes)
}

/// Serialize task IDs.
pub fn serialize_task_ids(ids: &HashSet<TaskId>) -> Result<Vec<u8>, serde_json::Error> {
    serde_json::to_vec(ids)
}

/// Deserialize task IDs.
pub fn deserialize_task_ids(bytes: &[u8]) -> Result<HashSet<TaskId>, serde_json::Error> {
    serde_json::from_slice(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_serialization_roundtrip() {
        let task = Task::new("test".to_string(), vec![1, 2, 3])
            .with_priority(150)
            .with_max_retries(5);

        let serialized = serialize_task(&task).unwrap();
        let deserialized = deserialize_task(&serialized).unwrap();

        assert_eq!(task.id, deserialized.id);
        assert_eq!(task.task_type, deserialized.task_type);
        assert_eq!(task.priority, deserialized.priority);
        assert_eq!(task.max_retries, deserialized.max_retries);
    }

    #[test]
    fn test_task_bincode_serialization_roundtrip() {
        let task = Task::new("test".to_string(), vec![1, 2, 3])
            .with_priority(150)
            .with_max_retries(5);

        let serialized = serialize_task_bincode(&task).unwrap();
        let deserialized = deserialize_task_bincode(&serialized).unwrap();

        assert_eq!(task.id, deserialized.id);
        assert_eq!(task.task_type, deserialized.task_type);
        assert_eq!(task.priority, deserialized.priority);
        assert_eq!(task.max_retries, deserialized.max_retries);
        assert_eq!(task.payload, deserialized.payload);
    }

    #[test]
    fn test_bincode_vs_json_size() {
        let task = Task::new("test".to_string(), vec![1, 2, 3, 4, 5, 6, 7, 8])
            .with_priority(150);

        let json_bytes = serialize_task(&task).unwrap();
        let bincode_bytes = serialize_task_bincode(&task).unwrap();

        // Bincode should be more compact than JSON
        println!("JSON size: {} bytes", json_bytes.len());
        println!("Bincode size: {} bytes", bincode_bytes.len());
        assert!(bincode_bytes.len() < json_bytes.len());
    }

    #[test]
    fn test_tasks_serialization() {
        let tasks = vec![
            Task::new("task1".to_string(), vec![1]).with_priority(100),
            Task::new("task2".to_string(), vec![2]).with_priority(200),
        ];

        let serialized = serialize_tasks(&tasks).unwrap();
        let deserialized = deserialize_tasks(&serialized).unwrap();

        assert_eq!(tasks.len(), deserialized.len());
        assert_eq!(tasks[0].task_type, deserialized[0].task_type);
        assert_eq!(tasks[1].priority, deserialized[1].priority);
    }

    #[test]
    fn test_tasks_bincode_serialization() {
        let tasks = vec![
            Task::new("task1".to_string(), vec![1, 2, 3]).with_priority(100),
            Task::new("task2".to_string(), vec![4, 5, 6]).with_priority(200),
            Task::new("task3".to_string(), vec![7, 8, 9]).with_priority(150),
        ];

        let serialized = serialize_tasks_bincode(&tasks).unwrap();
        let deserialized = deserialize_tasks_bincode(&serialized).unwrap();

        assert_eq!(tasks.len(), deserialized.len());
        for (original, deserialized) in tasks.iter().zip(deserialized.iter()) {
            assert_eq!(original.id, deserialized.id);
            assert_eq!(original.task_type, deserialized.task_type);
            assert_eq!(original.priority, deserialized.priority);
            assert_eq!(original.payload, deserialized.payload);
        }
    }

    #[test]
    fn test_bincode_with_large_payload() {
        let large_payload: Vec<u8> = (0..10000).map(|i| (i % 256) as u8).collect();
        let task = Task::new("large_task".to_string(), large_payload);

        let serialized = serialize_task_bincode(&task).unwrap();
        let deserialized = deserialize_task_bincode(&serialized).unwrap();

        assert_eq!(task.payload.len(), deserialized.payload.len());
        assert_eq!(task.payload, deserialized.payload);
    }
}
