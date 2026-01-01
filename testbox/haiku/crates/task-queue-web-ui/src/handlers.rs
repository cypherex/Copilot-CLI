//! HTTP request handlers for the Web UI.

use axum::{
    extract::Path,
    response::{Html, IntoResponse},
    Json,
};
use serde_json::json;

pub async fn index() -> impl IntoResponse {
    Html(include_str!("../templates/index.html"))
}

pub async fn list_tasks() -> impl IntoResponse {
    Json(json!({
        "tasks": [],
        "total": 0
    }))
}

pub async fn submit_task(
    Json(_payload): Json<serde_json::Value>,
) -> impl IntoResponse {
    Json(json!({
        "status": "success",
        "task_id": "placeholder"
    }))
}

pub async fn get_task(Path(id): Path<String>) -> impl IntoResponse {
    Json(json!({
        "id": id,
        "status": "pending"
    }))
}

pub async fn get_stats() -> impl IntoResponse {
    Json(json!({
        "pending": 0,
        "in_progress": 0,
        "completed": 0,
        "failed": 0
    }))
}
