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
}
