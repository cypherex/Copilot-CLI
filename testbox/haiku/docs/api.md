# API Reference

## REST API

### Base URL

```
http://localhost:8080
```

### Authentication

All endpoints support optional API key authentication via Bearer token:

```bash
Authorization: Bearer <api_key>
```

### Content Type

All endpoints accept and return `application/json`.

## Endpoints

### Submit Task

**Endpoint:** `POST /api/v1/tasks`

**Request Body:**
```json
{
  "task_type": "send_email",
  "payload": "base64-encoded-binary-data",
  "priority": 150,
  "schedule_at": "2024-01-01T12:00:00Z",
  "timeout_seconds": 300,
  "max_retries": 3
}
```

**Field Descriptions:**
- `task_type` (required): String identifier for task handler
- `payload` (required): Base64-encoded binary data (max 10MB)
- `priority` (optional): 0-255, default 100 (normal)
- `schedule_at` (optional): ISO 8601 timestamp for delayed execution
- `timeout_seconds` (optional): Default 300 (5 minutes)
- `max_retries` (optional): Default 3

**Response (201 Created):**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "created_at": "2024-01-01T12:00:00Z"
}
```

**Errors:**
- `400 Bad Request`: Invalid payload or missing required fields
- `429 Too Many Requests`: Rate limit exceeded
- `503 Service Unavailable`: Broker unavailable or queue depth exceeded

**Example:**
```bash
curl -X POST http://localhost:8080/api/v1/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my_api_key" \
  -d '{
    "task_type": "send_email",
    "payload": "eyJlbWFpbCI6ICJ1c2VyQGV4YW1wbGUuY29tIn0=",
    "priority": 200,
    "timeout_seconds": 600,
    "max_retries": 5
  }'
```

---

### Get Task Status

**Endpoint:** `GET /api/v1/tasks/{task_id}`

**Response (200 OK):**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "in_progress",
  "created_at": "2024-01-01T12:00:00Z",
  "updated_at": "2024-01-01T12:00:05Z",
  "task_type": "send_email",
  "priority": 150,
  "worker_id": "worker-1-12345",
  "result": null,
  "error": null,
  "retry_count": 0,
  "timeout_seconds": 300
}
```

**Status Values:**
- `pending`: Awaiting execution
- `in_progress`: Currently executing
- `completed`: Successfully finished
- `failed`: Execution failed, eligible for retry
- `dead_letter`: Exhausted retries

**Errors:**
- `404 Not Found`: Task does not exist
- `401 Unauthorized`: Invalid API key

**Example:**
```bash
curl http://localhost:8080/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000
```

---

### List Tasks

**Endpoint:** `GET /api/v1/tasks`

**Query Parameters:**
- `status`: Filter by status (pending, in_progress, completed, failed, dead_letter)
- `task_type`: Filter by task type
- `limit`: Number of results (default 100, max 1000)
- `offset`: Pagination offset (default 0)

**Response (200 OK):**
```json
{
  "tasks": [
    {
      "task_id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "completed",
      "task_type": "send_email",
      "priority": 150,
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T12:00:05Z"
    }
  ],
  "total": 1,
  "limit": 100,
  "offset": 0
}
```

**Example:**
```bash
curl 'http://localhost:8080/api/v1/tasks?status=completed&limit=50'
```

---

### Cancel Task

**Endpoint:** `DELETE /api/v1/tasks/{task_id}`

**Response (204 No Content):** Task cancelled successfully

**Errors:**
- `404 Not Found`: Task does not exist
- `409 Conflict`: Task cannot be cancelled (already in progress/completed)
- `403 Forbidden`: Insufficient permissions

**Example:**
```bash
curl -X DELETE http://localhost:8080/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000
```

---

### Get Statistics

**Endpoint:** `GET /api/v1/stats`

**Response (200 OK):**
```json
{
  "pending_count": 42,
  "in_progress_count": 8,
  "completed_last_hour": 1250,
  "failed_last_hour": 5,
  "worker_count": 5,
  "avg_processing_time_ms": 234.5,
  "queue_depth_by_priority": {
    "high": 10,
    "normal": 25,
    "low": 7
  }
}
```

**Example:**
```bash
curl http://localhost:8080/api/v1/stats
```

---

### Health Check

**Endpoint:** `GET /api/v1/health`

**Response (200 OK):**
```json
{
  "status": "healthy",
  "is_leader": true,
  "connected_workers": 5,
  "pending_tasks": 42,
  "cluster_healthy": true
}
```

**Status Values:**
- `healthy`: Broker operational and has quorum
- `degraded`: Broker operational but missing quorum

---

### Prometheus Metrics

**Endpoint:** `GET /metrics`

**Format:** Prometheus text format

**Example Metrics:**
```
# HELP tq_tasks_total Total tasks submitted
# TYPE tq_tasks_total counter
tq_tasks_total{status="completed",task_type="send_email"} 1250

# HELP tq_tasks_pending Current pending tasks
# TYPE tq_tasks_pending gauge
tq_tasks_pending 42

# HELP tq_task_processing_duration_seconds Task execution duration
# TYPE tq_task_processing_duration_seconds histogram
tq_task_processing_duration_seconds_bucket{le="0.1",task_type="send_email"} 100
```

---

## gRPC API

### Service: TaskQueue

```protobuf
service TaskQueue {
  rpc SubmitTask(SubmitTaskRequest) returns (SubmitTaskResponse);
  rpc GetTaskStatus(GetTaskStatusRequest) returns (GetTaskStatusResponse);
  rpc CancelTask(CancelTaskRequest) returns (CancelTaskResponse);
  rpc ListTasks(ListTasksRequest) returns (ListTasksResponse);
  rpc StreamTaskUpdates(StreamTaskUpdatesRequest) returns (stream TaskUpdate);
  rpc GetStats(GetStatsRequest) returns (GetStatsResponse);
}
```

### Messages

**SubmitTaskRequest:**
```protobuf
message SubmitTaskRequest {
  string task_type = 1;
  bytes payload = 2;
  uint32 priority = 3;
  google.protobuf.Timestamp schedule_at = 4;
  uint64 timeout_seconds = 5;
  uint32 max_retries = 6;
}
```

**SubmitTaskResponse:**
```protobuf
message SubmitTaskResponse {
  string task_id = 1;
  string status = 2;
  google.protobuf.Timestamp created_at = 3;
}
```

**GetTaskStatusRequest:**
```protobuf
message GetTaskStatusRequest {
  string task_id = 1;
}
```

**GetTaskStatusResponse:**
```protobuf
message GetTaskStatusResponse {
  string task_id = 1;
  string status = 2;
  bytes result = 3;
  string error = 4;
  uint32 retry_count = 5;
  string worker_id = 6;
}
```

### Examples (using grpcurl)

**Submit Task:**
```bash
grpcurl -plaintext \
  -d '{"task_type": "send_email", "payload": "dGVzdA==", "priority": 150}' \
  localhost:9090 taskqueue.TaskQueue/SubmitTask
```

**Stream Task Updates:**
```bash
grpcurl -plaintext \
  -d '{"task_id": "550e8400-e29b-41d4-a716-446655440000"}' \
  localhost:9090 taskqueue.TaskQueue/StreamTaskUpdates
```

---

## Client Libraries

### Rust Sync Client

```rust
use task_queue_client::SyncClient;
use task_queue_core::task::Task;

let client = SyncClient::new("127.0.0.1:6379".to_string())?;

let task = Task::new("send_email".to_string(), payload)
    .with_priority(150)
    .with_timeout(600);

let task_id = client.submit_task(task)?;
let status = client.get_status(task_id)?;
let result = client.wait_for_result(task_id, Duration::from_secs(60))?;
```

### Rust Async Client

```rust
use task_queue_client::AsyncClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = AsyncClient::new("127.0.0.1:6379".to_string());

    let task = Task::new("send_email".to_string(), payload);
    let task_id = client.submit_task(task).await?;
    let result = client.wait_for_result(task_id, Duration::from_secs(60)).await?;

    Ok(())
}
```

---

## Error Handling

All error responses follow this format:

```json
{
  "error": "Task not found",
  "code": "TASK_NOT_FOUND",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### Common Error Codes

- `TASK_NOT_FOUND`: Task does not exist
- `INVALID_STATUS`: Task cannot perform requested action in current state
- `QUEUE_DEPTH_EXCEEDED`: Broker queue is full
- `RATE_LIMIT_EXCEEDED`: Too many requests
- `AUTHENTICATION_FAILED`: Invalid API key
- `BROKER_UNAVAILABLE`: Broker not responding
- `INTERNAL_ERROR`: Unexpected server error

---

## Rate Limiting

- **Limit**: 100 requests per second per API key
- **Headers**:
  - `X-RateLimit-Limit`: 100
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Unix timestamp when limit resets
- **Exceeding limit**: Returns 429 with `Retry-After` header

---

## Versioning

Current API version: `v1`

- Breaking changes will increment major version
- Non-breaking additions will increment minor version
- Deprecated endpoints will issue warnings in response headers
