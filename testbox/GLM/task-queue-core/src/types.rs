//! Common types used throughout the task queue system

use serde::{Deserialize, Serialize};

/// Task status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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
    /// Check if task is terminal (will not change)
    pub fn is_terminal(&self) -> bool {
        matches!(self, Self::Completed | Self::DeadLetter)
    }

    /// Check if task is still pending (can be claimed)
    pub fn is_pending(&self) -> bool {
        matches!(self, Self::Pending)
    }

    /// Check if task is active (in progress)
    pub fn is_active(&self) -> bool {
        matches!(self, Self::InProgress)
    }
}

/// Worker status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum WorkerStatus {
    /// Worker is connected and healthy
    Alive,
    /// Worker has stopped sending heartbeats
    Dead,
    /// Worker is gracefully shutting down
    ShuttingDown,
}

/// Node role in Raft cluster
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum NodeRole {
    /// Leader accepts writes and coordinates cluster
    Leader,
    /// Follower accepts reads and replicates logs
    Follower,
    /// Candidate is requesting votes to become leader
    Candidate,
}

/// Task result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    /// Result data (arbitrary bytes)
    pub data: Vec<u8>,
    /// Processing duration in milliseconds
    pub duration_ms: u64,
}

/// Task failure information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskFailure {
    /// Error message
    pub error: String,
    /// Failure timestamp
    pub failed_at: chrono::DateTime<chrono::Utc>,
    /// Retry attempt number when this failure occurred
    pub retry_attempt: u32,
}

/// Worker heartbeat information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerHeartbeat {
    /// Worker ID
    pub worker_id: String,
    /// Number of tasks currently being processed
    pub current_task_count: usize,
    /// CPU usage percentage
    pub cpu_usage_percent: f64,
    /// Memory usage in MB
    pub memory_usage_mb: f64,
    /// Timestamp of this heartbeat
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// Queue statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStats {
    /// Number of pending tasks
    pub pending_count: usize,
    /// Number of in-progress tasks
    pub in_progress_count: usize,
    /// Number of completed tasks in the last hour
    pub completed_last_hour: u64,
    /// Number of failed tasks in the last hour
    pub failed_last_hour: u64,
    /// Number of connected workers
    pub worker_count: usize,
    /// Average processing time in milliseconds
    pub avg_processing_time_ms: f64,
    /// Queue depth by priority tier
    pub queue_depth_by_priority: QueueDepthByPriority,
}

/// Queue depth broken down by priority
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueDepthByPriority {
    /// High priority queue depth
    pub high: usize,
    /// Normal priority queue depth
    pub normal: usize,
    /// Low priority queue depth
    pub low: usize,
}

impl QueueDepthByPriority {
    /// Create a new empty queue depth
    pub fn new() -> Self {
        Self {
            high: 0,
            normal: 0,
            low: 0,
        }
    }

    /// Get total queue depth
    pub fn total(&self) -> usize {
        self.high + self.normal + self.low
    }
}

impl Default for QueueDepthByPriority {
    fn default() -> Self {
        Self::new()
    }
}
