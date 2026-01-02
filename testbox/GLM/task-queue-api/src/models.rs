//! API models for REST and gRPC

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Submit task request
#[derive(Debug, Deserialize)]
pub struct SubmitTaskRequest {
    pub task_type: String,
    pub payload: String, // base64-encoded
    pub priority: i32,
    pub schedule_at: Option<String>,
    pub timeout_seconds: u64,
    pub max_retries: u32,
    pub dependencies: Option<Vec<String>>,
}

/// Submit task response
#[derive(Debug, Serialize)]
pub struct SubmitTaskResponse {
    pub task_id: String,
    pub status: String,
}

/// Task status response
#[derive(Debug, Serialize)]
pub struct TaskStatusResponse {
    pub task_id: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub result: Option<String>,
    pub error: Option<String>,
    pub retry_count: u32,
    pub worker_id: Option<String>,
}

/// List tasks response
#[derive(Debug, Serialize)]
pub struct ListTasksResponse {
    pub tasks: Vec<TaskInfo>,
    pub total: usize,
}

/// Task info
#[derive(Debug, Serialize)]
pub struct TaskInfo {
    pub task_id: String,
    pub task_type: String,
    pub status: String,
    pub priority: i32,
    pub created_at: String,
    pub updated_at: String,
    pub worker_id: Option<String>,
}

/// Stats response
#[derive(Debug, Serialize)]
pub struct StatsResponse {
    pub pending_count: usize,
    pub in_progress_count: usize,
    pub completed_last_hour: u64,
    pub failed_last_hour: u64,
    pub worker_count: usize,
    pub avg_processing_time_ms: f64,
    pub queue_depth_by_priority: QueueDepthByPriority,
}

/// Queue depth by priority
#[derive(Debug, Serialize)]
pub struct QueueDepthByPriority {
    pub high: usize,
    pub normal: usize,
    pub low: usize,
}

/// Health check response
#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub is_leader: bool,
    pub connected_workers: usize,
    pub pending_tasks: usize,
}
