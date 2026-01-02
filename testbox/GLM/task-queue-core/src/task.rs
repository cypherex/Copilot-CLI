//! Task data structures and serialization

use crate::{
    error::{Result, TaskQueueError},
    priority::Priority,
    types::{TaskFailure, TaskResult, TaskStatus},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

/// Represents a task in the queue
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// Unique task identifier (UUID v4)
    pub id: Uuid,
    /// Task type name (e.g., "send_email", "process_image")
    pub task_type: String,
    /// Task payload (arbitrary bytes, up to 10MB)
    pub payload: Vec<u8>,
    /// Task priority (0-255, higher = more urgent)
    pub priority: Priority,
    /// When the task was created
    pub created_at: DateTime<Utc>,
    /// When the task is scheduled for execution
    pub scheduled_at: DateTime<Utc>,
    /// Maximum number of retry attempts
    pub max_retries: u32,
    /// Current retry attempt count
    pub retry_count: u32,
    /// Timeout duration in seconds
    pub timeout_seconds: u64,
    /// Current task status
    pub status: TaskStatus,
    /// Worker ID if task is in progress
    pub worker_id: Option<String>,
    /// Task result if completed
    pub result: Option<TaskResult>,
    /// Task failure information if failed
    pub failure: Option<TaskFailure>,
    /// Task IDs this task depends on
    pub dependencies: HashSet<Uuid>,
    /// When the task was last updated
    pub updated_at: DateTime<Utc>,
    /// Lease expiration time for in-progress tasks
    pub lease_expires_at: Option<DateTime<Utc>>,
}

impl Task {
    /// Maximum payload size (10MB)
    pub const MAX_PAYLOAD_SIZE: usize = 10 * 1024 * 1024;

    /// Create a new task
    ///
    /// # Arguments
    /// * `task_type` - Type name of the task
    /// * `payload` - Task payload bytes (max 10MB)
    /// * `priority` - Task priority
    ///
    /// # Example
    /// ```
    /// use task_queue_core::Task;
    ///
    /// let task = Task::new(
    ///     "send_email".to_string(),
    ///     b"{\"to\": \"user@example.com\"}".to_vec(),
    ///     Priority::normal(),
    /// )?;
    /// ```
    pub fn new(task_type: String, payload: Vec<u8>, priority: Priority) -> Result<Self> {
        if payload.len() > Self::MAX_PAYLOAD_SIZE {
            return Err(TaskQueueError::Other(format!(
                "Payload too large: {} bytes (max: {} bytes)",
                payload.len(),
                Self::MAX_PAYLOAD_SIZE
            )));
        }

        let now = Utc::now();
        Ok(Self {
            id: Uuid::new_v4(),
            task_type,
            payload,
            priority,
            created_at: now,
            scheduled_at: now,
            max_retries: 3,
            retry_count: 0,
            timeout_seconds: 300, // Default 5 minutes
            status: TaskStatus::Pending,
            worker_id: None,
            result: None,
            failure: None,
            dependencies: HashSet::new(),
            updated_at: now,
            lease_expires_at: None,
        })
    }

    /// Set the scheduled execution time
    pub fn with_scheduled_at(mut self, scheduled_at: DateTime<Utc>) -> Self {
        self.scheduled_at = scheduled_at;
        self.updated_at = Utc::now();
        self
    }

    /// Set the maximum retry count
    pub fn with_max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self.updated_at = Utc::now();
        self
    }

    /// Set the timeout duration
    pub fn with_timeout(mut self, timeout_seconds: u64) -> Self {
        self.timeout_seconds = timeout_seconds;
        self.updated_at = Utc::now();
        self
    }

    /// Add a task dependency
    pub fn with_dependency(mut self, dependency_id: Uuid) -> Self {
        self.dependencies.insert(dependency_id);
        self.updated_at = Utc::now();
        self
    }

    /// Check if the task is ready to be executed
    pub fn is_ready(&self) -> bool {
        self.status == TaskStatus::Pending
            && self.dependencies.is_empty()
            && self.scheduled_at <= Utc::now()
    }

    /// Claim the task for a worker
    pub fn claim(&mut self, worker_id: String, lease_duration_secs: u64) {
        self.status = TaskStatus::InProgress;
        self.worker_id = Some(worker_id);
        self.lease_expires_at = Some(Utc::now() + chrono::Duration::seconds(lease_duration_secs as i64));
        self.updated_at = Utc::now();
    }

    /// Mark the task as completed
    pub fn complete(&mut self, result: TaskResult) {
        self.status = TaskStatus::Completed;
        self.result = Some(result);
        self.worker_id = None;
        self.lease_expires_at = None;
        self.updated_at = Utc::now();
    }

    /// Mark the task as failed
    pub fn fail(&mut self, failure: TaskFailure) {
        self.status = TaskStatus::Failed;
        self.failure = Some(failure);
        self.worker_id = None;
        self.lease_expires_at = None;
        self.updated_at = Utc::now();
    }

    /// Move task to dead letter queue
    pub fn dead_letter(&mut self) {
        self.status = TaskStatus::DeadLetter;
        self.worker_id = None;
        self.lease_expires_at = None;
        self.updated_at = Utc::now();
    }

    /// Retry the task
    pub fn retry(&mut self, scheduled_at: DateTime<Utc>) {
        self.status = TaskStatus::Pending;
        self.worker_id = None;
        self.lease_expires_at = None;
        self.scheduled_at = scheduled_at;
        self.updated_at = Utc::now();
    }

    /// Check if the task lease has expired
    pub fn lease_expired(&self) -> bool {
        if let Some(expires_at) = self.lease_expires_at {
            Utc::now() > expires_at
        } else {
            false
        }
    }

    /// Check if the task can be retried
    pub fn can_retry(&self) -> bool {
        self.status == TaskStatus::Failed && self.retry_count < self.max_retries
    }

    /// Increment retry count and return if should be retried
    pub fn increment_retry(&mut self) -> bool {
        self.retry_count += 1;
        self.can_retry()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_creation() {
        let task = Task::new(
            "test_task".to_string(),
            b"test_payload".to_vec(),
            Priority::normal(),
        ).unwrap();

        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.task_type, "test_task");
        assert!(task.is_ready());
    }

    #[test]
    fn test_task_payload_too_large() {
        let large_payload = vec![0u8; Task::MAX_PAYLOAD_SIZE + 1];
        let result = Task::new("test".to_string(), large_payload, Priority::normal());
        assert!(result.is_err());
    }

    #[test]
    fn test_task_claim() {
        let mut task = Task::new("test".to_string(), b"test".to_vec(), Priority::normal()).unwrap();
        task.claim("worker1".to_string(), 30);

        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.worker_id, Some("worker1".to_string()));
        assert!(task.lease_expires_at.is_some());
    }

    #[test]
    fn test_task_complete() {
        let mut task = Task::new("test".to_string(), b"test".to_vec(), Priority::normal()).unwrap();
        task.claim("worker1".to_string(), 30);

        let result = TaskResult {
            data: b"result".to_vec(),
            duration_ms: 100,
        };
        task.complete(result);

        assert_eq!(task.status, TaskStatus::Completed);
        assert!(task.worker_id.is_none());
        assert!(task.result.is_some());
    }

    #[test]
    fn test_task_retry() {
        let mut task = Task::new("test".to_string(), b"test".to_vec(), Priority::normal()).unwrap();
        task.fail(TaskFailure {
            error: "test error".to_string(),
            failed_at: Utc::now(),
            retry_attempt: 0,
        });

        assert!(task.can_retry());
        task.increment_retry();
        task.retry(Utc::now() + chrono::Duration::seconds(5));

        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.retry_count, 1);
    }
}