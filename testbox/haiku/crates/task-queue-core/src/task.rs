//! Task definitions and status tracking.

use crate::priority::{Priority, PriorityTier};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashSet;
use uuid::Uuid;

/// Unique identifier for a task.
pub type TaskId = Uuid;

/// Task status enumeration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TaskStatus {
    /// Task is pending execution
    Pending,
    /// Task is currently being processed by a worker
    InProgress,
    /// Task completed successfully
    Completed,
    /// Task failed and may be retried
    Failed,
    /// Task exhausted all retries and is in dead letter queue
    DeadLetter,
}

impl TaskStatus {
    /// Check if this is a terminal state.
    pub fn is_terminal(&self) -> bool {
        matches!(self, TaskStatus::Completed | TaskStatus::DeadLetter)
    }

    /// Check if task can be retried.
    pub fn can_retry(&self) -> bool {
        matches!(self, TaskStatus::Failed | TaskStatus::InProgress)
    }
}

/// A distributed task that can be executed by workers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// Unique task identifier
    pub id: TaskId,
    /// Task type name (e.g., "send_email")
    pub task_type: String,
    /// Serialized task payload (arbitrary bytes, up to 10MB)
    pub payload: Vec<u8>,
    /// Priority level (0-255, higher = more urgent)
    pub priority: Priority,
    /// Timestamp when task was created
    pub created_at: DateTime<Utc>,
    /// Timestamp when task should be executed (for delayed tasks)
    pub scheduled_at: DateTime<Utc>,
    /// Current status of the task
    pub status: TaskStatus,
    /// Maximum number of retry attempts
    pub max_retries: u32,
    /// Current retry attempt number
    pub retry_count: u32,
    /// Timeout duration in seconds
    pub timeout_seconds: u64,
    /// ID of worker currently processing this task
    pub worker_id: Option<String>,
    /// Lease expiration for current worker (worker must heartbeat)
    pub lease_expires_at: Option<DateTime<Utc>>,
    /// Result data (base64 encoded)
    pub result: Option<Vec<u8>>,
    /// Error message if task failed
    pub error: Option<String>,
    /// Task IDs this task depends on (must complete before this task runs)
    pub dependencies: HashSet<TaskId>,
    /// Last update timestamp
    pub updated_at: DateTime<Utc>,
}

impl Task {
    /// Create a new task with minimum required fields.
    pub fn new(task_type: String, payload: Vec<u8>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            task_type,
            payload,
            priority: 100, // Normal priority by default
            created_at: now,
            scheduled_at: now,
            status: TaskStatus::Pending,
            max_retries: 3,
            retry_count: 0,
            timeout_seconds: 300, // 5 minutes default
            worker_id: None,
            lease_expires_at: None,
            result: None,
            error: None,
            dependencies: HashSet::new(),
            updated_at: now,
        }
    }

    /// Set the priority for this task.
    pub fn with_priority(mut self, priority: Priority) -> Self {
        self.priority = priority;
        self
    }

    /// Set scheduled execution time.
    pub fn with_scheduled_at(mut self, scheduled_at: DateTime<Utc>) -> Self {
        self.scheduled_at = scheduled_at;
        self
    }

    /// Set maximum retry count.
    pub fn with_max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    /// Set timeout duration.
    pub fn with_timeout(mut self, timeout_seconds: u64) -> Self {
        self.timeout_seconds = timeout_seconds;
        self
    }

    /// Add a dependency on another task.
    pub fn add_dependency(mut self, task_id: TaskId) -> Self {
        self.dependencies.insert(task_id);
        self
    }

    /// Check if all dependencies are met.
    pub fn dependencies_met(&self, _completed_tasks: &HashSet<TaskId>) -> bool {
        // In a full implementation, check if all dependency IDs are in completed_tasks
        self.dependencies.is_empty()
    }

    /// Get the priority tier for this task.
    pub fn priority_tier(&self) -> PriorityTier {
        PriorityTier::from_value(self.priority)
    }

    /// Check if task can be scheduled for execution.
    pub fn can_execute(&self) -> bool {
        self.status == TaskStatus::Pending && self.scheduled_at <= Utc::now()
    }

    /// Claim task for a worker with lease duration.
    pub fn claim(mut self, worker_id: String, lease_duration_secs: u64) -> Self {
        self.status = TaskStatus::InProgress;
        self.worker_id = Some(worker_id);
        self.lease_expires_at = Some(Utc::now() + chrono::Duration::seconds(lease_duration_secs as i64));
        self.updated_at = Utc::now();
        self
    }

    /// Mark task as completed with result.
    pub fn complete(mut self, result: Vec<u8>) -> Self {
        self.status = TaskStatus::Completed;
        self.result = Some(result);
        self.worker_id = None;
        self.lease_expires_at = None;
        self.updated_at = Utc::now();
        self
    }

    /// Mark task as failed.
    pub fn fail(mut self, error: String) -> Self {
        self.status = TaskStatus::Failed;
        self.error = Some(error);
        self.worker_id = None;
        self.lease_expires_at = None;
        self.updated_at = Utc::now();
        self
    }

    /// Move to dead letter queue.
    pub fn to_dead_letter(mut self) -> Self {
        self.status = TaskStatus::DeadLetter;
        self.worker_id = None;
        self.lease_expires_at = None;
        self.updated_at = Utc::now();
        self
    }

    /// Check if lease has expired.
    pub fn lease_expired(&self) -> bool {
        if let Some(expiry) = self.lease_expires_at {
            expiry <= Utc::now()
        } else {
            false
        }
    }

    /// Get size in bytes for this task (approximate).
    pub fn size_bytes(&self) -> usize {
        std::mem::size_of::<Self>() + self.payload.len() + self.task_type.len()
    }
}

impl PartialEq for Task {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for Task {}

impl PartialOrd for Task {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Task {
    fn cmp(&self, other: &Self) -> Ordering {
        // Higher priority first (reverse ordering)
        match other.priority.cmp(&self.priority) {
            Ordering::Equal => {
                // Within same priority, earlier scheduled time first
                self.scheduled_at.cmp(&other.scheduled_at)
            }
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_creation() {
        let task = Task::new("test".to_string(), vec![1, 2, 3]);
        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.priority, 100);
        assert_eq!(task.retry_count, 0);
        assert!(task.worker_id.is_none());
    }

    #[test]
    fn test_task_builder_pattern() {
        let task = Task::new("email".to_string(), vec![])
            .with_priority(200)
            .with_max_retries(5)
            .with_timeout(600);

        assert_eq!(task.priority, 200);
        assert_eq!(task.max_retries, 5);
        assert_eq!(task.timeout_seconds, 600);
    }

    #[test]
    fn test_task_ordering() {
        let task1 = Task::new("a".to_string(), vec![]).with_priority(100);
        let task2 = Task::new("b".to_string(), vec![]).with_priority(200);

        // task2 has higher priority, should come first
        assert!(task2 < task1);
    }

    #[test]
    fn test_task_priority_tier() {
        let low_task = Task::new("a".to_string(), vec![]).with_priority(50);
        let normal_task = Task::new("b".to_string(), vec![]).with_priority(150);
        let high_task = Task::new("c".to_string(), vec![]).with_priority(220);

        assert_eq!(low_task.priority_tier(), PriorityTier::Low);
        assert_eq!(normal_task.priority_tier(), PriorityTier::Normal);
        assert_eq!(high_task.priority_tier(), PriorityTier::High);
    }

    #[test]
    fn test_task_claim() {
        let mut task = Task::new("test".to_string(), vec![]);
        task = task.claim("worker-1".to_string(), 30);

        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.worker_id, Some("worker-1".to_string()));
        assert!(task.lease_expires_at.is_some());
    }

    #[test]
    fn test_task_complete() {
        let task = Task::new("test".to_string(), vec![])
            .claim("worker-1".to_string(), 30);
        let completed = task.complete(vec![1, 2, 3]);

        assert_eq!(completed.status, TaskStatus::Completed);
        assert_eq!(completed.result, Some(vec![1, 2, 3]));
        assert!(completed.worker_id.is_none());
    }
}
