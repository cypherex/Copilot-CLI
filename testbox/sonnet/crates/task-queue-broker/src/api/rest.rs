use crate::Broker;
use task_queue_core::{Task, TaskStatus, Priority};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post, delete},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;
use chrono::{DateTime, Utc};

/// REST API routes
pub fn create_rest_api(broker: Arc<Broker>) -> Router {
    Router::new()
        .route("/api/v1/tasks", post(submit_task))
        .route("/api/v1/tasks", get(list_tasks))
        .route("/api/v1/tasks/:task_id", get(get_task))
        .route("/api/v1/tasks/:task_id", delete(cancel_task))
        .route("/api/v1/stats", get(get_stats))
        .route("/api/v1/workers", get(list_workers))
        .route("/health", get(health_check))
        .with_state(broker)
}

#[derive(Debug, Deserialize)]
struct SubmitTaskRequest {
    task_type: String,
    #[serde(with = "base64_bytes")]
    payload: Vec<u8>,
    priority: Option<u8>,
    schedule_at: Option<DateTime<Utc>>,
    timeout_seconds: Option<u32>,
    max_retries: Option<u32>,
}

mod base64_bytes {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        use base64::Engine;
        let s = String::deserialize(deserializer)?;
        base64::engine::general_purpose::STANDARD
            .decode(&s)
            .map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Serialize)]
struct SubmitTaskResponse {
    task_id: Uuid,
    status: String,
}

#[derive(Debug, Serialize)]
struct TaskResponse {
    task_id: Uuid,
    task_type: String,
    status: String,
    priority: u8,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(with = "option_base64_bytes")]
    result: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    retry_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    worker_id: Option<String>,
}

mod option_base64_bytes {
    use serde::{Serializer};

    pub fn serialize<S>(bytes: &Option<Vec<u8>>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use base64::Engine;
        match bytes {
            Some(b) => serializer.serialize_some(&base64::engine::general_purpose::STANDARD.encode(b)),
            None => serializer.serialize_none(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct ListTasksQuery {
    status: Option<String>,
    task_type: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
}

#[derive(Debug, Serialize)]
struct StatsResponse {
    pending_count: usize,
    in_progress_count: usize,
    completed_last_hour: usize,
    failed_last_hour: usize,
    worker_count: usize,
    avg_processing_time_ms: f64,
    queue_depth_by_priority: QueueDepth,
}

#[derive(Debug, Serialize)]
struct QueueDepth {
    high: usize,
    normal: usize,
    low: usize,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: String,
    is_leader: bool,
    connected_workers: usize,
    pending_tasks: usize,
}

/// Submit a new task
async fn submit_task(
    State(broker): State<Arc<Broker>>,
    Json(req): Json<SubmitTaskRequest>,
) -> Result<(StatusCode, Json<SubmitTaskResponse>), ApiError> {
    let mut builder = Task::builder(req.task_type, req.payload);

    if let Some(priority) = req.priority {
        builder = builder.priority(Priority::new(priority));
    }

    if let Some(schedule_at) = req.schedule_at {
        builder = builder.scheduled_at(schedule_at);
    }

    if let Some(timeout) = req.timeout_seconds {
        builder = builder.timeout_seconds(timeout);
    }

    if let Some(max_retries) = req.max_retries {
        builder = builder.max_retries(max_retries);
    }

    let task = builder.build().map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let task_id = task.id;

    broker.store().submit_task(task)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok((
        StatusCode::CREATED,
        Json(SubmitTaskResponse {
            task_id,
            status: "pending".to_string(),
        }),
    ))
}

/// Get task by ID
async fn get_task(
    State(broker): State<Arc<Broker>>,
    Path(task_id): Path<Uuid>,
) -> Result<Json<TaskResponse>, ApiError> {
    let task = broker
        .store()
        .get_task(&task_id)
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound)?;

    Ok(Json(TaskResponse {
        task_id: task.id,
        task_type: task.task_type,
        status: task.status.as_str().to_string(),
        priority: task.priority.value(),
        created_at: task.created_at,
        updated_at: task.updated_at,
        result: task.result,
        error: task.error,
        retry_count: task.retry_count,
        worker_id: task.worker_id,
    }))
}

/// Cancel a pending task
async fn cancel_task(
    State(broker): State<Arc<Broker>>,
    Path(task_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let task = broker
        .store()
        .get_task(&task_id)
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .ok_or_else(|| ApiError::NotFound)?;

    if task.status != TaskStatus::Pending {
        return Err(ApiError::Conflict("Task is not pending".to_string()));
    }

    // Remove from queue
    broker.queue().remove(&task_id);

    // TODO: Delete from store

    Ok(StatusCode::NO_CONTENT)
}

/// List tasks with filtering
async fn list_tasks(
    State(broker): State<Arc<Broker>>,
    Query(query): Query<ListTasksQuery>,
) -> Result<Json<Vec<TaskResponse>>, ApiError> {
    let status = query.status
        .and_then(|s| TaskStatus::from_str(&s));

    let tasks = if let Some(status) = status {
        broker.store().get_tasks_by_status(status)
            .map_err(|e| ApiError::Internal(e.to_string()))?
    } else {
        // Get all tasks (this is inefficient, but works for now)
        let mut all_tasks = Vec::new();
        for status in &[TaskStatus::Pending, TaskStatus::InProgress, TaskStatus::Completed, TaskStatus::Failed, TaskStatus::DeadLetter] {
            let tasks = broker.store().get_tasks_by_status(*status)
                .map_err(|e| ApiError::Internal(e.to_string()))?;
            all_tasks.extend(tasks);
        }
        all_tasks
    };

    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(100).min(1000);

    let response: Vec<TaskResponse> = tasks
        .into_iter()
        .skip(offset)
        .take(limit)
        .map(|task| TaskResponse {
            task_id: task.id,
            task_type: task.task_type,
            status: task.status.as_str().to_string(),
            priority: task.priority.value(),
            created_at: task.created_at,
            updated_at: task.updated_at,
            result: task.result,
            error: task.error,
            retry_count: task.retry_count,
            worker_id: task.worker_id,
        })
        .collect();

    Ok(Json(response))
}

/// Get system statistics
async fn get_stats(
    State(broker): State<Arc<Broker>>,
) -> Result<Json<StatsResponse>, ApiError> {
    let pending = broker.store().count_by_status(TaskStatus::Pending)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let in_progress = broker.store().count_by_status(TaskStatus::InProgress)
        .map_err(|e| ApiError::Internal(e.to_string()))?;

    let (high, normal, low) = broker.queue().count_by_priority();

    Ok(Json(StatsResponse {
        pending_count: pending,
        in_progress_count: in_progress,
        completed_last_hour: 0, // TODO: implement time-based queries
        failed_last_hour: 0,
        worker_count: broker.workers().count_alive(),
        avg_processing_time_ms: 0.0, // TODO: calculate from metrics
        queue_depth_by_priority: QueueDepth { high, normal, low },
    }))
}

/// List connected workers
async fn list_workers(
    State(broker): State<Arc<Broker>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let workers = broker.workers().alive_workers();

    let response: Vec<serde_json::Value> = workers
        .into_iter()
        .map(|w| serde_json::json!({
            "worker_id": w.worker_id,
            "registered_at": w.registered_at,
            "last_heartbeat": w.last_heartbeat,
            "current_tasks": w.current_tasks.len(),
            "cpu_usage_percent": w.cpu_usage_percent,
            "memory_usage_mb": w.memory_usage_mb,
        }))
        .collect();

    Ok(Json(serde_json::json!(response)))
}

/// Health check endpoint
async fn health_check(
    State(broker): State<Arc<Broker>>,
) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        is_leader: true, // TODO: check Raft status
        connected_workers: broker.workers().count_alive(),
        pending_tasks: broker.queue().len(),
    })
}

/// API error types
#[derive(Debug)]
enum ApiError {
    NotFound,
    BadRequest(String),
    Conflict(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::NotFound => (StatusCode::NOT_FOUND, "Not found".to_string()),
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg),
            ApiError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
        };

        let body = Json(serde_json::json!({
            "error": message,
        }));

        (status, body).into_response()
    }
}
