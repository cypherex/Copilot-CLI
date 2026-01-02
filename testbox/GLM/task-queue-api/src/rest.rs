//! REST API implementation using axum

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post, delete},
    Router,
};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::models::*;

/// API state
#[derive(Clone)]
pub struct ApiState {
    // TODO: Add actual broker reference
    pub broker: Arc<RwLock<HashMap<String, String>>>,
}

/// Create REST API router
pub fn create_rest_router() -> Router {
    let state = ApiState {
        broker: Arc::new(RwLock::new(HashMap::new())),
    };

    Router::new()
        .route("/api/v1/tasks", post(submit_task).get(list_tasks))
        .route("/api/v1/tasks/:task_id", get(get_task_status).delete(cancel_task))
        .route("/api/v1/stats", get(get_stats))
        .route("/health", get(health_check))
        .with_state(state)
}

/// Submit task endpoint
async fn submit_task(
    State(_state): State<ApiState>,
    Json(_req): Json<SubmitTaskRequest>,
) -> Result<Json<SubmitTaskResponse>, StatusCode> {
    // TODO: Implement actual task submission
    Ok(Json(SubmitTaskResponse {
        task_id: uuid::Uuid::new_v4().to_string(),
        status: "pending".to_string(),
    }))
}

/// Get task status endpoint
async fn get_task_status(
    State(_state): State<ApiState>,
    Path(_task_id): Path<String>,
) -> Result<Json<TaskStatusResponse>, StatusCode> {
    // TODO: Implement actual task status retrieval
    Ok(Json(TaskStatusResponse {
        task_id: "todo".to_string(),
        status: "pending".to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        result: None,
        error: None,
        retry_count: 0,
        worker_id: None,
    }))
}

/// Cancel task endpoint
async fn cancel_task(
    State(_state): State<ApiState>,
    Path(_task_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    // TODO: Implement actual task cancellation
    Ok(StatusCode::NO_CONTENT)
}

/// List tasks endpoint
#[derive(Deserialize)]
struct ListTasksQuery {
    status: Option<String>,
    task_type: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
}

async fn list_tasks(
    State(_state): State<ApiState>,
    Query(_query): Query<ListTasksQuery>,
) -> Result<Json<ListTasksResponse>, StatusCode> {
    // TODO: Implement actual task listing
    Ok(Json(ListTasksResponse {
        tasks: vec![],
        total: 0,
    }))
}

/// Get stats endpoint
async fn get_stats(State(_state): State<ApiState>) -> Result<Json<StatsResponse>, StatusCode> {
    // TODO: Implement actual stats retrieval
    Ok(Json(StatsResponse {
        pending_count: 0,
        in_progress_count: 0,
        completed_last_hour: 0,
        failed_last_hour: 0,
        worker_count: 0,
        avg_processing_time_ms: 0.0,
        queue_depth_by_priority: QueueDepthByPriority {
            high: 0,
            normal: 0,
            low: 0,
        },
    }))
}

/// Health check endpoint
async fn health_check(State(_state): State<ApiState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        is_leader: true,
        connected_workers: 0,
        pending_tasks: 0,
    })
}
