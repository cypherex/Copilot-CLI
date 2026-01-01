//! API server (REST and gRPC)

use crate::broker::{Broker, BrokerStats};
use crate::config::BrokerConfig;
use crate::worker_manager::WorkerInfo;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{delete, get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use task_queue_core::task::{Task, TaskId, TaskPriority, TaskStatus};
use task_queue_core::{CoreError, Result};
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tracing::info;

/// API request/response types

#[derive(Debug, Deserialize)]
pub struct SubmitTaskRequest {
    pub task_type: String,
    pub payload: String, // Base64 encoded
    pub priority: Option<u8>,
    #[serde(default)]
    pub schedule_at: Option<String>,
    pub timeout_seconds: Option<u64>,
    pub max_retries: Option<u32>,
    pub dependencies: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct SubmitTaskResponse {
    pub task_id: String,
    pub status: String,
}

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

#[derive(Debug, Deserialize)]
pub struct ListTasksQuery {
    pub status: Option<String>,
    pub task_type: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default)]
    pub offset: usize,
}

fn default_limit() -> usize {
    100
}

#[derive(Debug, Serialize)]
pub struct TaskListResponse {
    pub tasks: Vec<TaskStatusResponse>,
    pub total: usize,
}

#[derive(Debug, Serialize)]
pub struct StatsResponse {
    pub pending_count: u64,
    pub in_progress_count: u64,
    pub completed_last_hour: u64,
    pub failed_last_hour: u64,
    pub worker_count: u64,
    pub avg_processing_time_ms: f64,
    pub queue_depth_by_priority: QueueDepthResponse,
}

#[derive(Debug, Serialize)]
pub struct QueueDepthResponse {
    pub high: u64,
    pub normal: u64,
    pub low: u64,
}

#[derive(Debug, Serialize)]
pub struct ErrorResponse {
    pub error: String,
    pub code: u32,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: String,
    pub is_leader: bool,
    pub connected_workers: u64,
    pub pending_tasks: u64,
}

/// API state
#[derive(Clone)]
pub struct ApiState {
    pub broker: Arc<RwLock<Broker>>,
    pub config: BrokerConfig,
}

/// Create API router
pub fn create_router(state: ApiState) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/api/v1/tasks", post(submit_task_handler).get(list_tasks_handler))
        .route("/api/v1/tasks/:task_id", get(get_task_handler).delete(cancel_task_handler))
        .route("/api/v1/stats", get(stats_handler))
        .route("/api/v1/workers", get(list_workers_handler))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

/// Health check handler
async fn health_handler(State(state): State<ApiState>) -> Json<HealthResponse> {
    let broker = state.broker.read().await;
    let stats = broker.get_stats().await.unwrap_or_else(|_| BrokerStats {
        pending_count: 0,
        in_progress_count: 0,
        completed_count: 0,
        failed_count: 0,
        dead_letter_count: 0,
        completed_last_hour: 0,
        failed_last_hour: 0,
        worker_count: 0,
        alive_workers: 0,
        active_workers: 0,
        avg_processing_time_ms: 0.0,
        queue_depth_by_priority: crate::broker::QueueDepthByPriority {
            high: 0,
            normal: 0,
            low: 0,
        },
    });

    Json(HealthResponse {
        status: "healthy".to_string(),
        is_leader: true, // TODO: Check Raft state
        connected_workers: stats.alive_workers,
        pending_tasks: stats.pending_count,
    })
}

/// Submit task handler
async fn submit_task_handler(
    State(state): State<ApiState>,
    Json(req): Json<SubmitTaskRequest>,
) -> Result<Json<SubmitTaskResponse>, (StatusCode, Json<ErrorResponse>)> {
    // Decode payload from base64
    let payload = base64::decode(&req.payload)
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, 400, format!("Invalid base64 payload: {}", e)))?;

    // Parse priority
    let priority = req.priority
        .map(|p| TaskPriority::new(p))
        .transpose()
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, 400, format!("Invalid priority: {}", e)))?
        .unwrap_or_else(TaskPriority::normal);

    // Parse schedule time
    let scheduled_at = if let Some(schedule_at) = req.schedule_at {
        Some(chrono::DateTime::parse_from_rfc3339(&schedule_at)
            .map_err(|e| error_response(StatusCode::BAD_REQUEST, 400, format!("Invalid schedule_at: {}", e)))?
            .with_timezone(&chrono::Utc))
    } else {
        None
    };

    // Parse dependencies
    let dependencies = if let Some(deps) = req.dependencies {
        deps.iter()
            .map(|s| uuid::Uuid::parse_str(s))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| error_response(StatusCode::BAD_REQUEST, 400, format!("Invalid dependency UUID: {}", e)))?
    } else {
        Vec::new()
    };

    // Create task
    let task = Task::new(
        req.task_type,
        payload,
        priority,
        scheduled_at,
        req.timeout_seconds.unwrap_or(300),
        req.max_retries.unwrap_or(3),
    )
    .map_err(|e| error_response(StatusCode::BAD_REQUEST, 400, format!("Invalid task: {}", e)))?;

    // Submit to broker
    let broker = state.broker.read().await;
    let task_id = broker.submit_task(task).await
        .map_err(|e| error_response(StatusCode::SERVICE_UNAVAILABLE, 503, format!("Failed to submit task: {}", e)))?;

    Ok(Json(SubmitTaskResponse {
        task_id: task_id.to_string(),
        status: "pending".to_string(),
    }))
}

/// Get task handler
async fn get_task_handler(
    State(state): State<ApiState>,
    Path(task_id): Path<String>,
) -> Result<Json<TaskStatusResponse>, (StatusCode, Json<ErrorResponse>)> {
    let task_id = uuid::Uuid::parse_str(&task_id)
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, 400, format!("Invalid task ID: {}", e)))?;

    let broker = state.broker.read().await;
    let task = broker.get_task_status(task_id).await
        .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, 500, format!("Failed to get task: {}", e)))?;

    match task {
        Some(task) => {
            let result = task.result.as_ref().and_then(|r| {
                if r.success {
                    Some(base64::encode(&r.result_data.as_ref().map(|d| d.clone()).unwrap_or_default()))
                } else {
                    None
                }
            });

            let error = task.result.as_ref().and_then(|r| r.error_message.clone());

            Ok(Json(TaskStatusResponse {
                task_id: task.id.to_string(),
                status: task.status.as_str().to_string(),
                created_at: task.created_at.to_rfc3339(),
                updated_at: task.updated_at.to_rfc3339(),
                result,
                error,
                retry_count: task.retry_count,
                worker_id: task.worker_id,
            }))
        }
        None => Err(error_response(StatusCode::NOT_FOUND, 404, "Task not found".to_string())),
    }
}

/// Cancel task handler
async fn cancel_task_handler(
    State(state): State<ApiState>,
    Path(task_id): Path<String>,
) -> Result<StatusCode, (StatusCode, Json<ErrorResponse>)> {
    let task_id = uuid::Uuid::parse_str(&task_id)
        .map_err(|e| error_response(StatusCode::BAD_REQUEST, 400, format!("Invalid task ID: {}", e)))?;

    let broker = state.broker.read().await;
    match broker.cancel_task(task_id).await {
        Ok(true) => Ok(StatusCode::NO_CONTENT),
        Ok(false) => Err(error_response(StatusCode::CONFLICT, 409, "Task already in progress".to_string())),
        Err(CoreError::TaskNotFound(_)) => Err(error_response(StatusCode::NOT_FOUND, 404, "Task not found".to_string())),
        Err(e) => Err(error_response(StatusCode::INTERNAL_SERVER_ERROR, 500, format!("Failed to cancel task: {}", e))),
    }
}

/// List tasks handler
async fn list_tasks_handler(
    State(state): State<ApiState>,
    Query(query): Query<ListTasksQuery>,
) -> Result<Json<TaskListResponse>, (StatusCode, Json<ErrorResponse>)> {
    let status = query.status.as_ref().and_then(|s| TaskStatus::from_str(s).ok());
    let broker = state.broker.read().await;

    let tasks = broker.list_tasks(status, query.task_type, query.limit, query.offset).await
        .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, 500, format!("Failed to list tasks: {}", e)))?;

    let total = tasks.len(); // TODO: Get actual total count

    let task_responses: Vec<TaskStatusResponse> = tasks
        .iter()
        .map(|task| {
            let result = task.result.as_ref().and_then(|r| {
                if r.success {
                    Some(base64::encode(&r.result_data.as_ref().map(|d| d.clone()).unwrap_or_default()))
                } else {
                    None
                }
            });

            let error = task.result.as_ref().and_then(|r| r.error_message.clone());

            TaskStatusResponse {
                task_id: task.id.to_string(),
                status: task.status.as_str().to_string(),
                created_at: task.created_at.to_rfc3339(),
                updated_at: task.updated_at.to_rfc3339(),
                result,
                error,
                retry_count: task.retry_count,
                worker_id: task.worker_id.clone(),
            }
        })
        .collect();

    Ok(Json(TaskListResponse {
        tasks: task_responses,
        total,
    }))
}

/// Stats handler
async fn stats_handler(State(state): State<ApiState>) -> Result<Json<StatsResponse>, (StatusCode, Json<ErrorResponse>)> {
    let broker = state.broker.read().await;
    let stats = broker.get_stats().await
        .map_err(|e| error_response(StatusCode::INTERNAL_SERVER_ERROR, 500, format!("Failed to get stats: {}", e)))?;

    Ok(Json(StatsResponse {
        pending_count: stats.pending_count,
        in_progress_count: stats.in_progress_count,
        completed_last_hour: stats.completed_last_hour,
        failed_last_hour: stats.failed_last_hour,
        worker_count: stats.alive_workers,
        avg_processing_time_ms: stats.avg_processing_time_ms,
        queue_depth_by_priority: QueueDepthResponse {
            high: stats.queue_depth_by_priority.high,
            normal: stats.queue_depth_by_priority.normal,
            low: stats.queue_depth_by_priority.low,
        },
    }))
}

/// List workers handler
async fn list_workers_handler(State(state): State<ApiState>) -> Json<Vec<WorkerInfo>> {
    let broker = state.broker.read().await;
    // TODO: Implement worker info retrieval
    Json(vec![])
}

/// Error response helper
fn error_response(status: StatusCode, code: u32, message: String) -> (StatusCode, Json<ErrorResponse>) {
    (status, Json(ErrorResponse { error: message, code }))
}

/// Start API server
pub async fn start_api_server(state: ApiState) -> Result<(), Box<dyn std::error::Error>> {
    let router = create_router(state);
    let addr = SocketAddr::from(([0, 0, 0, 0], 8080)); // TODO: Use config

    info!("API server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, router).await?;

    Ok(())
}
