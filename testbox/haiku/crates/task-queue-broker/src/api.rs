//! REST API endpoints for the broker.

use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use task_queue_core::task::TaskId;

use crate::broker::Broker;

#[derive(Deserialize)]
pub struct SubmitTaskRequest {
    pub task_type: String,
    pub payload: Vec<u8>,
    pub priority: Option<u8>,
    pub timeout_seconds: Option<u64>,
    pub max_retries: Option<u32>,
}

#[derive(Serialize)]
pub struct SubmitTaskResponse {
    pub task_id: TaskId,
    pub status: String,
}

#[derive(Serialize)]
pub struct TaskStatusResponse {
    pub task_id: TaskId,
    pub status: String,
    pub result: Option<String>,
    pub error: Option<String>,
}

/// Create the REST API router.
pub fn create_router(broker: Arc<Broker>) -> Router {
    Router::new()
        .route("/api/v1/health", get(health_check))
        .route("/api/v1/tasks", post(submit_task))
        .route("/api/v1/tasks/:id", get(get_task_status))
        .route("/api/v1/stats", get(get_stats))
        .with_state(broker)
}

async fn health_check() -> impl IntoResponse {
    (StatusCode::OK, "OK")
}

async fn submit_task(
    State(_broker): State<Arc<Broker>>,
    Json(_payload): Json<SubmitTaskRequest>,
) -> impl IntoResponse {
    (StatusCode::CREATED, Json(serde_json::json!({"status": "created"})))
}

async fn get_task_status(
    State(_broker): State<Arc<Broker>>,
    Path(_id): Path<String>,
) -> impl IntoResponse {
    (StatusCode::OK, Json(serde_json::json!({"status": "pending"})))
}

async fn get_stats(
    State(broker): State<Arc<Broker>>,
) -> impl IntoResponse {
    let stats = broker.get_stats();
    (StatusCode::OK, Json(stats))
}
