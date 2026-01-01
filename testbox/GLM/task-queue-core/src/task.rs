//! Task definitions and related types

use crate::error::{CoreError, Result};
use crate::priority::Priority;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use uuid::Uuid;

/// Unique task identifier (UUID v4)
pub type TaskId = Uuid;

/// Task type identifier (e.g., "send_email", "process_image")
pub type TaskType = String;

/// Maximum payload size: 10MB
pub const MAX_PAYLOAD_SIZE: usize = 10 * 1024 * 1024;

/// Task priority levels mapped to integers
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct TaskPriority(u8);

impl TaskPriority {
    /// High priority (200-255)
    pub const HIGH_MIN: u8 = 200;
    pub const HIGH_MAX: u8 = 255;
    
    /// Normal priority (100-199)
    pub const NORMAL_MIN: u8 = 100;
    pub const NORMAL_MAX: u8 = 199;
    
    /// Low priority (0-99)
    pub const LOW_MIN: u8 = 0;
    pub const LOW_MAX: u8 = 99;

    /// Create a new task priority, validating the range
    pub fn new(value: u8) -> Result<Self> {
        if value <= Self::HIGH_MAX {
            Ok(TaskPriority(value))
        } else {
            Err(CoreError::InvalidPriority(value))
        }
    }

    /// High priority (default: 220)
    pub fn high() -> Self {
        TaskPriority(220)
    }

    /// Normal priority (default: 150)
    pub fn normal() -> Self {
        TaskPriority(150)
    }

    /// Low priority (default: 50)
    pub fn low() -> Self {
        TaskPriority(50)
    }

    /// Get the underlying integer value
    pub fn value(&self) -> u8 {
        self.0
    }

    /// Check if this is high priority
    pub fn is_high(&self) -> bool {
        self.0 >= Self::HIGH_MIN
    }

    /// Check if this is normal priority
    pub fn is_normal(&self) -> bool {
        self.0 >= Self::NORMAL_MIN && self.0 < Self::HIGH_MIN
    }

    /// Check if this is low priority
    pub fn is_low(&self) -> bool {
        self.0 < Self::NORMAL_MIN
    }
}

impl From<Priority> for TaskPriority {
    fn from(p: Priority) -> Self {
        match p {
            Priority::High => Self::high(),
            Priority::Normal => Self::normal(),
            Priority::Low => Self::low(),
        }
    }
}

/// Task status throughout its lifecycle
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    /// Task is pending execution
    Pending,
    /// Task is currently being processed by a worker
    InProgress,
    /// Task completed successfully
    Completed,
    /// Task failed (may be retried)
    Failed,
    /// Task exhausted all retry attempts
    DeadLetter,
}

impl TaskStatus {
    /// Parse task status from string
    pub fn from_str(s: &str) -> Result<Self> {
        match s.to_lowercase().as_str() {
            "pending" => Ok(TaskStatus::Pending),
            "in_progress" | "in-progress" => Ok(TaskStatus::InProgress),
            "completed" => Ok(TaskStatus::Completed),
            "failed" => Ok(TaskStatus::Failed),
            "dead_letter" | "dead-letter" | "deadletter" => Ok(TaskStatus::DeadLetter),
            _ => Err(CoreError::InvalidStatus(s.to_string())),
        }
    }

    /// Convert to string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Completed => "completed",
            TaskStatus::Failed => "failed",
            TaskStatus::DeadLetter => "dead_letter",
        }
    }
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Result of task execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    /// Task ID
    pub task_id: TaskId,
    /// Success or failure
    pub success: bool,
    /// Result data (if successful)
    pub result_data: Option<Vec<u8>>,
    /// Error message (if failed)
    pub error_message: Option<String>,
    /// Worker that processed the task
    pub worker_id: String,
    /// Timestamp of completion
    pub completed_at: DateTime<Utc>,
    /// Processing duration in milliseconds
    pub processing_duration_ms: u64,
}

impl TaskResult {
    /// Create a successful task result
    pub fn success(
        task_id: TaskId,
        result_data: Vec<u8>,
        worker_id: String,
        processing_duration_ms: u64,
    ) -> Self {
        Self {
            task_id,
            success: true,
            result_data: Some(result_data),
            error_message: None,
            worker_id,
            completed_at: Utc::now(),
            processing_duration_ms,
        }
    }

    /// Create a failed task result
    pub fn failure(
        task_id: TaskId,
        error_message: String,
        worker_id: String,
        processing_duration_ms: u64,
    ) -> Self {
        Self {
            task_id,
            success: false,
            result_data: None,
            error_message: Some(error_message),
            worker_id,
            completed_at: Utc::now(),
            processing_duration_ms,
        }
    }
}

/// Task definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    /// Unique task identifier
    pub id: TaskId,
    /// Task type name (registered handler)
    pub task_type: TaskType,
    /// Task payload (arbitrary bytes, up to 10MB)
    pub payload: Vec<u8>,
    /// Task priority (0-255, higher = more urgent)
    pub priority: TaskPriority,
    /// When the task was created
    pub created_at: DateTime<Utc>,
    /// When the task should be executed (can be immediate or future)
    pub scheduled_at: DateTime<Utc>,
    /// Maximum number of retry attempts
    pub max_retries: u32,
    /// Current retry attempt
    pub retry_count: u32,
    /// Task timeout in seconds
    pub timeout_seconds: u64,
    /// Current task status
    pub status: TaskStatus,
    /// Worker ID that claimed this task (if in progress)
    pub worker_id: Option<String>,
    /// Lease expiration time (if claimed)
    pub lease_expires_at: Option<DateTime<Utc>>,
    /// Task IDs that must complete before this task can run
    pub dependencies: Vec<TaskId>,
    /// Task completion result (if completed)
    pub result: Option<TaskResult>,
    /// Error history for failed tasks
    pub error_history: Vec<String>,
    /// Last updated timestamp
    pub updated_at: DateTime<Utc>,
}

impl Task {
    /// Create a new task
    pub fn new(
        task_type: TaskType,
        payload: Vec<u8>,
        priority: TaskPriority,
        scheduled_at: Option<DateTime<Utc>>,
        timeout_seconds: u64,
        max_retries: u32,
    ) -> Result<Self> {
        // Validate payload size
        if payload.len() > MAX_PAYLOAD_SIZE {
            return Err(CoreError::PayloadTooLarge(payload.len()));
        }

        let now = Utc::now();
        Ok(Self {
            id: Uuid::new_v4(),
            task_type,
            payload,
            priority,
            created_at: now,
            scheduled_at: scheduled_at.unwrap_or(now),
            max_retries,
            retry_count: 0,
            timeout_seconds,
            status: TaskStatus::Pending,
            worker_id: None,
            lease_expires_at: None,
            dependencies: Vec::new(),
            result: None,
            error_history: Vec::new(),
            updated_at: now,
        })
    }

    /// Create a new task with dependencies
    pub fn with_dependencies(mut self, dependencies: Vec<TaskId>) -> Self {
        self.dependencies = dependencies;
        self
    }

    /// Check if all dependencies are satisfied
    pub fn dependencies_satisfied(&self, completed_tasks: &HashSet<TaskId>) -> bool {
        self.dependencies.iter().all(|dep_id| completed_tasks.contains(dep_id))
    }

    /// Check if task is ready to be claimed
    pub fn is_ready(&self, completed_tasks: &HashSet<TaskId>) -> bool {
        self.status == TaskStatus::Pending
            && self.scheduled_at <= Utc::now()
            && self.dependencies_satisfied(completed_tasks)
    }

    /// Claim the task for a worker
    pub fn claim(&mut self, worker_id: String, lease_duration: Duration) {
        self.status = TaskStatus::InProgress;
        self.worker_id = Some(worker_id.clone());
        self.lease_expires_at = Some(Utc::now() + chrono::Duration::from_std(lease_duration).unwrap());
        self.updated_at = Utc::now();
    }

    /// Check if the task lease has expired
    pub fn lease_expired(&self) -> bool {
        match self.lease_expires_at {
            Some(expires_at) => Utc::now() > expires_at,
            None => false,
        }
    }

    /// Complete the task with a result
    pub fn complete(&mut self, result: TaskResult) {
        self.status = TaskStatus::Completed;
        self.result = Some(result);
        self.worker_id = None;
        self.lease_expires_at = None;
        self.updated_at = Utc::now();
    }

    /// Mark the task as failed
    pub fn fail(&mut self, error_message: String) {
        self.status = TaskStatus::Failed;
        self.error_history.push(error_message);
        self.retry_count += 1;
        self.worker_id = None;
        self.lease_expires_at = None;
        self.updated_at = Utc::now();
    }

    /// Move task to dead letter queue
    pub fn to_dead_letter(&mut self) {
        self.status = TaskStatus::DeadLetter;
        self.worker_id = None;
        self.lease_expires_at = None;
        self.updated_at = Utc::now();
    }

    /// Reset task to pending (for retry)
    pub fn reset_for_retry(&mut self, scheduled_at: DateTime<Utc>) {
        self.status = TaskStatus::Pending;
        self.worker_id = None;
        self.lease_expires_at = None;
        self.scheduled_at = scheduled_at;
        self.updated_at = Utc::now();
    }

    /// Check if task can be retried
    pub fn can_retry(&self) -> bool {
        self.retry_count < self.max_retries
    }

    /// Calculate next retry delay with exponential backoff
    pub fn retry_delay(&self) -> Duration {
        let base_delay_secs = 5u64;
        let backoff_factor = 2u64.pow(self.retry_count.min(10)); // Cap at 2^10 = 1024x
        let delay_secs = base_delay_secs * backoff_factor;
        
        // Cap at 1 hour
        Duration::from_secs(delay_secs.min(3600))
    }

    /// Get task age in seconds
    pub fn age(&self) -> i64 {
        (Utc::now() - self.created_at).num_seconds()
    }

    /// Get time until scheduled execution
    pub fn time_until_scheduled(&self) -> Option<i64> {
        if self.scheduled_at > Utc::now() {
            Some((self.scheduled_at - Utc::now()).num_seconds())
        } else {
            None
        }
    }
}

impl std::fmt::Display for Task {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Task[{}, type={}, status={}, priority={}, retries={}/{}]",
            self.id, self.task_type, self.status, self.priority.value(), self.retry_count, self.max_retries
        )
    }
}

use std::collections::HashSet;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_priority() {
        let high = TaskPriority::high();
        assert!(high.is_high());
        assert_eq!(high.value(), 220);

        let normal = TaskPriority::normal();
        assert!(normal.is_normal());
        assert_eq!(normal.value(), 150);

        let low = TaskPriority::low();
        assert!(low.is_low());
        assert_eq!(low.value(), 50);

        assert!(high > normal);
        assert!(normal > low);
    }

    #[test]
    fn test_task_creation() {
        let task = Task::new(
            "send_email".to_string(),
            b"test payload".to_vec(),
            TaskPriority::normal(),
            None,
            30,
            3,
        )
        .unwrap();

        assert_eq!(task.task_type, "send_email");
        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.retry_count, 0);
        assert_eq!(task.max_retries, 3);
    }

    #[test]
    fn test_task_payload_too_large() {
        let large_payload = vec![0u8; MAX_PAYLOAD_SIZE + 1];
        let result = Task::new(
            "test".to_string(),
            large_payload,
            TaskPriority::normal(),
            None,
            30,
            3,
        );
        assert!(matches!(result, Err(CoreError::PayloadTooLarge(_))));
    }

    #[test]
    fn test_task_lifecycle() {
        let mut task = Task::new(
            "test".to_string(),
            b"payload".to_vec(),
            TaskPriority::normal(),
            None,
            30,
            3,
        )
        .unwrap();

        // Claim task
        task.claim("worker-1".to_string(), Duration::from_secs(30));
        assert_eq!(task.status, TaskStatus::InProgress);
        assert_eq!(task.worker_id, Some("worker-1".to_string()));

        // Complete task
        let result = TaskResult::success(task.id, b"result".to_vec(), "worker-1".to_string(), 100);
        task.complete(result);
        assert_eq!(task.status, TaskStatus::Completed);
    }

    #[test]
    fn test_retry_delay() {
        let mut task = Task::new(
            "test".to_string(),
            b"payload".to_vec(),
            TaskPriority::normal(),
            None,
            30,
            3,
        )
        .unwrap();

        // First retry: 5 seconds
        assert_eq!(task.retry_delay(), Duration::from_secs(5));

        task.retry_count = 1;
        // Second retry: 10 seconds
        assert_eq!(task.retry_delay(), Duration::from_secs(10));

        task.retry_count = 10;
        // Eleventh retry: capped at 1 hour
        assert_eq!(task.retry_delay(), Duration::from_secs(3600));
    }

    #[test]
    fn test_dependencies() {
        let mut task = Task::new(
            "test".to_string(),
            b"payload".to_vec(),
            TaskPriority::normal(),
            None,
            30,
            3,
        )
        .unwrap();

        let dep1 = Uuid::new_v4();
        let dep2 = Uuid::new_v4();
        task = task.with_dependencies(vec![dep1, dep2]);

        let completed = HashSet::from([dep1]);
        assert!(!task.is_ready(&completed));

        let completed = HashSet::from([dep1, dep2]);
        assert!(task.is_ready(&completed));
    }
}
