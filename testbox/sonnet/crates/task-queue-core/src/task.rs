use crate::{Priority, TaskError, Result, MAX_PAYLOAD_SIZE};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

/// Unique identifier for a task
pub type TaskId = Uuid;

/// Task type identifier
pub type TaskType = String;

/// Task payload (arbitrary bytes)
pub type TaskPayload = Vec<u8>;

/// Task status in the queue system
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TaskStatus {
    /// Task is waiting to be claimed by a worker
    Pending,
    /// Task is currently being processed by a worker
    InProgress,
    /// Task completed successfully
    Completed,
    /// Task failed (may be retried)
    Failed,
    /// Task exhausted all retries and moved to dead letter queue
    DeadLetter,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Completed => "completed",
            TaskStatus::Failed => "failed",
            TaskStatus::DeadLetter => "dead_letter",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(TaskStatus::Pending),
            "in_progress" => Some(TaskStatus::InProgress),
            "completed" => Some(TaskStatus::Completed),
            "failed" => Some(TaskStatus::Failed),
            "dead_letter" => Some(TaskStatus::DeadLetter),
            _ => None,
        }
    }
}

/// Complete task definition with all metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// Unique task identifier
    pub id: TaskId,

    /// Task type name (e.g., "send_email", "process_image")
    pub task_type: TaskType,

    /// Task payload (arbitrary bytes, max 10MB)
    pub payload: TaskPayload,

    /// Priority (0-255, higher = more urgent)
    pub priority: Priority,

    /// When the task was created
    pub created_at: DateTime<Utc>,

    /// When the task should be executed (can be in the future)
    pub scheduled_at: DateTime<Utc>,

    /// Last update timestamp
    pub updated_at: DateTime<Utc>,

    /// Maximum number of retry attempts
    pub max_retries: u32,

    /// Current retry attempt number
    pub retry_count: u32,

    /// Timeout in seconds (0 = no timeout)
    pub timeout_seconds: u32,

    /// Current status
    pub status: TaskStatus,

    /// Worker ID currently processing this task (if in progress)
    pub worker_id: Option<String>,

    /// Task result (if completed)
    pub result: Option<TaskPayload>,

    /// Error message (if failed)
    pub error: Option<String>,

    /// Task IDs that must complete before this task can run
    pub dependencies: HashSet<TaskId>,

    /// When the task was completed (success or failure)
    pub completed_at: Option<DateTime<Utc>>,

    /// Lease expiration for in-progress tasks
    pub lease_expires_at: Option<DateTime<Utc>>,
}

impl Task {
    /// Create a new task
    pub fn new(
        task_type: TaskType,
        payload: TaskPayload,
        priority: Priority,
    ) -> Result<Self> {
        if payload.len() > MAX_PAYLOAD_SIZE {
            return Err(TaskError::PayloadTooLarge {
                max: MAX_PAYLOAD_SIZE,
                actual: payload.len(),
            });
        }

        let now = Utc::now();
        Ok(Task {
            id: Uuid::new_v4(),
            task_type,
            payload,
            priority,
            created_at: now,
            scheduled_at: now,
            updated_at: now,
            max_retries: 3,
            retry_count: 0,
            timeout_seconds: 300, // 5 minutes default
            status: TaskStatus::Pending,
            worker_id: None,
            result: None,
            error: None,
            dependencies: HashSet::new(),
            completed_at: None,
            lease_expires_at: None,
        })
    }

    /// Create a new task builder
    pub fn builder(task_type: TaskType, payload: TaskPayload) -> TaskBuilder {
        TaskBuilder::new(task_type, payload)
    }

    /// Serialize task to bytes
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        bincode::serialize(self).map_err(TaskError::from)
    }

    /// Deserialize task from bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        bincode::deserialize(bytes).map_err(TaskError::from)
    }

    /// Check if task is ready to be executed (scheduled time has passed and dependencies met)
    pub fn is_ready(&self) -> bool {
        self.scheduled_at <= Utc::now()
    }

    /// Check if task can be retried
    pub fn can_retry(&self) -> bool {
        self.retry_count < self.max_retries
    }

    /// Calculate retry delay using exponential backoff
    pub fn retry_delay_seconds(&self) -> u64 {
        const BASE_DELAY: u64 = 5; // 5 seconds
        const MAX_DELAY: u64 = 3600; // 1 hour

        let delay = BASE_DELAY * 2u64.pow(self.retry_count);
        delay.min(MAX_DELAY)
    }

    /// Mark task as claimed by a worker
    pub fn claim(&mut self, worker_id: String, lease_duration_secs: u64) {
        self.status = TaskStatus::InProgress;
        self.worker_id = Some(worker_id);
        self.updated_at = Utc::now();
        self.lease_expires_at = Some(
            Utc::now() + chrono::Duration::seconds(lease_duration_secs as i64)
        );
    }

    /// Mark task as completed successfully
    pub fn complete(&mut self, result: TaskPayload) -> Result<()> {
        if result.len() > MAX_PAYLOAD_SIZE {
            return Err(TaskError::PayloadTooLarge {
                max: MAX_PAYLOAD_SIZE,
                actual: result.len(),
            });
        }

        self.status = TaskStatus::Completed;
        self.result = Some(result);
        self.completed_at = Some(Utc::now());
        self.updated_at = Utc::now();
        self.worker_id = None;
        self.lease_expires_at = None;
        Ok(())
    }

    /// Mark task as failed
    pub fn fail(&mut self, error: String) {
        self.status = TaskStatus::Failed;
        self.error = Some(error);
        self.completed_at = Some(Utc::now());
        self.updated_at = Utc::now();
        self.worker_id = None;
        self.lease_expires_at = None;
    }

    /// Move task to dead letter queue
    pub fn move_to_dlq(&mut self) {
        self.status = TaskStatus::DeadLetter;
        self.updated_at = Utc::now();
        self.worker_id = None;
        self.lease_expires_at = None;
    }

    /// Release task back to pending (e.g., after worker died)
    pub fn release(&mut self) {
        self.status = TaskStatus::Pending;
        self.worker_id = None;
        self.lease_expires_at = None;
        self.updated_at = Utc::now();
    }

    /// Increment retry count and reschedule
    pub fn retry(&mut self) {
        self.retry_count += 1;
        let delay = self.retry_delay_seconds();
        self.scheduled_at = Utc::now() + chrono::Duration::seconds(delay as i64);
        self.status = TaskStatus::Pending;
        self.worker_id = None;
        self.lease_expires_at = None;
        self.updated_at = Utc::now();
    }

    /// Check if lease has expired
    pub fn is_lease_expired(&self) -> bool {
        if let Some(expires) = self.lease_expires_at {
            expires <= Utc::now()
        } else {
            false
        }
    }
}

/// Builder for creating tasks with custom configuration
pub struct TaskBuilder {
    task_type: TaskType,
    payload: TaskPayload,
    priority: Priority,
    scheduled_at: Option<DateTime<Utc>>,
    max_retries: u32,
    timeout_seconds: u32,
    dependencies: HashSet<TaskId>,
}

impl TaskBuilder {
    pub fn new(task_type: TaskType, payload: TaskPayload) -> Self {
        TaskBuilder {
            task_type,
            payload,
            priority: Priority::default(),
            scheduled_at: None,
            max_retries: 3,
            timeout_seconds: 300,
            dependencies: HashSet::new(),
        }
    }

    pub fn priority(mut self, priority: Priority) -> Self {
        self.priority = priority;
        self
    }

    pub fn scheduled_at(mut self, scheduled_at: DateTime<Utc>) -> Self {
        self.scheduled_at = Some(scheduled_at);
        self
    }

    pub fn max_retries(mut self, max_retries: u32) -> Self {
        self.max_retries = max_retries;
        self
    }

    pub fn timeout_seconds(mut self, timeout_seconds: u32) -> Self {
        self.timeout_seconds = timeout_seconds;
        self
    }

    pub fn add_dependency(mut self, task_id: TaskId) -> Self {
        self.dependencies.insert(task_id);
        self
    }

    pub fn dependencies(mut self, dependencies: HashSet<TaskId>) -> Self {
        self.dependencies = dependencies;
        self
    }

    pub fn build(self) -> Result<Task> {
        if self.payload.len() > MAX_PAYLOAD_SIZE {
            return Err(TaskError::PayloadTooLarge {
                max: MAX_PAYLOAD_SIZE,
                actual: self.payload.len(),
            });
        }

        let now = Utc::now();
        Ok(Task {
            id: Uuid::new_v4(),
            task_type: self.task_type,
            payload: self.payload,
            priority: self.priority,
            created_at: now,
            scheduled_at: self.scheduled_at.unwrap_or(now),
            updated_at: now,
            max_retries: self.max_retries,
            retry_count: 0,
            timeout_seconds: self.timeout_seconds,
            status: TaskStatus::Pending,
            worker_id: None,
            result: None,
            error: None,
            dependencies: self.dependencies,
            completed_at: None,
            lease_expires_at: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_creation() {
        let task = Task::new(
            "test_task".to_string(),
            b"test payload".to_vec(),
            Priority::normal(),
        ).unwrap();

        assert_eq!(task.task_type, "test_task");
        assert_eq!(task.payload, b"test payload");
        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.retry_count, 0);
    }

    #[test]
    fn test_task_serialization() {
        let task = Task::new(
            "test".to_string(),
            b"data".to_vec(),
            Priority::high(),
        ).unwrap();

        let bytes = task.to_bytes().unwrap();
        let deserialized = Task::from_bytes(&bytes).unwrap();

        assert_eq!(task.id, deserialized.id);
        assert_eq!(task.task_type, deserialized.task_type);
        assert_eq!(task.payload, deserialized.payload);
    }

    #[test]
    fn test_task_builder() {
        let scheduled = Utc::now() + chrono::Duration::hours(1);
        let task = Task::builder("test".to_string(), b"data".to_vec())
            .priority(Priority::high())
            .scheduled_at(scheduled)
            .max_retries(5)
            .timeout_seconds(600)
            .build()
            .unwrap();

        assert_eq!(task.priority, Priority::high());
        assert_eq!(task.max_retries, 5);
        assert_eq!(task.timeout_seconds, 600);
    }

    #[test]
    fn test_retry_delay() {
        let mut task = Task::new(
            "test".to_string(),
            b"data".to_vec(),
            Priority::normal(),
        ).unwrap();

        assert_eq!(task.retry_delay_seconds(), 5); // 5 * 2^0
        task.retry_count = 1;
        assert_eq!(task.retry_delay_seconds(), 10); // 5 * 2^1
        task.retry_count = 2;
        assert_eq!(task.retry_delay_seconds(), 20); // 5 * 2^2
        task.retry_count = 10;
        assert_eq!(task.retry_delay_seconds(), 3600); // capped at 1 hour
    }

    #[test]
    fn test_payload_size_limit() {
        let large_payload = vec![0u8; MAX_PAYLOAD_SIZE + 1];
        let result = Task::new(
            "test".to_string(),
            large_payload,
            Priority::normal(),
        );

        assert!(result.is_err());
        match result {
            Err(TaskError::PayloadTooLarge { .. }) => {},
            _ => panic!("Expected PayloadTooLarge error"),
        }
    }
}
