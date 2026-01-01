# API Reference

## REST API

Base URL: `http://localhost:8080`

### Submit Task

**POST /api/v1/tasks**

Submit a new task to the queue.

**Request Body:**
```json
{
  "task_type": "string",
  "payload": "base64-encoded-bytes",
  "priority": 150,
  "schedule_at": "2024-01-01T12:00:00Z",
  "timeout_seconds": 300,
  "max_retries": 3
}
```

**Response:** `201 Created`
```json
{
  "task_id": "uuid",
  "status": "pending"
}
```

**Example:**
```bash
curl -X POST http://localhost:8080/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "send_email",
    "payload": "dXNlckBleGFtcGxlLmNvbQ==",
    "priority": 150,
    "timeout_seconds": 300,
    "max_retries": 3
  }'
```

### Get Task Status

**GET /api/v1/tasks/{task_id}**

Retrieve the status and details of a specific task.

**Response:** `200 OK`
```json
{
  "task_id": "uuid",
  "task_type": "string",
  "status": "pending|in_progress|completed|failed|dead_letter",
  "priority": 150,
  "created_at": "2024-01-01T12:00:00Z",
  "updated_at": "2024-01-01T12:01:00Z",
  "result": "base64-encoded-bytes",
  "error": "error message if failed",
  "retry_count": 0,
  "worker_id": "worker-hostname-pid-random"
}
```

**Example:**
```bash
curl http://localhost:8080/api/v1/tasks/123e4567-e89b-12d3-a456-426614174000
```

### List Tasks

**GET /api/v1/tasks**

List tasks with optional filtering.

**Query Parameters:**
- `status` - Filter by status (pending, in_progress, completed, failed, dead_letter)
- `task_type` - Filter by task type
- `limit` - Max results (default: 100, max: 1000)
- `offset` - Pagination offset

**Response:** `200 OK`
```json
[
  {
    "task_id": "uuid",
    "task_type": "string",
    "status": "pending",
    "priority": 150,
    "created_at": "2024-01-01T12:00:00Z",
    "updated_at": "2024-01-01T12:01:00Z"
  }
]
```

**Example:**
```bash
# Get all pending tasks
curl "http://localhost:8080/api/v1/tasks?status=pending&limit=50"

# Get all email tasks
curl "http://localhost:8080/api/v1/tasks?task_type=send_email"
```

### Cancel Task

**DELETE /api/v1/tasks/{task_id}**

Cancel a pending task. Only works if task is in pending state.

**Response:**
- `204 No Content` - Task cancelled
- `409 Conflict` - Task already in progress or completed

**Example:**
```bash
curl -X DELETE http://localhost:8080/api/v1/tasks/123e4567-e89b-12d3-a456-426614174000
```

### Get Statistics

**GET /api/v1/stats**

Get system-wide statistics.

**Response:** `200 OK`
```json
{
  "pending_count": 1234,
  "in_progress_count": 56,
  "completed_last_hour": 5000,
  "failed_last_hour": 12,
  "worker_count": 10,
  "avg_processing_time_ms": 125.5,
  "queue_depth_by_priority": {
    "high": 100,
    "normal": 1000,
    "low": 134
  }
}
```

**Example:**
```bash
curl http://localhost:8080/api/v1/stats
```

### List Workers

**GET /api/v1/workers**

Get information about all connected workers.

**Response:** `200 OK`
```json
[
  {
    "worker_id": "worker-hostname-12345-abc123",
    "registered_at": "2024-01-01T10:00:00Z",
    "last_heartbeat": "2024-01-01T12:00:00Z",
    "current_tasks": 3,
    "cpu_usage_percent": 45.2,
    "memory_usage_mb": 256
  }
]
```

**Example:**
```bash
curl http://localhost:8080/api/v1/workers
```

### Health Check

**GET /health**

Check broker health and status.

**Response:** `200 OK` (healthy) or `503 Service Unavailable` (degraded)
```json
{
  "status": "healthy|degraded",
  "is_leader": true,
  "connected_workers": 10,
  "pending_tasks": 1234
}
```

**Example:**
```bash
curl http://localhost:8080/health
```

## gRPC API (Future)

### Service Definition

```protobuf
syntax = "proto3";

package taskqueue.v1;

service TaskQueue {
  rpc SubmitTask(SubmitTaskRequest) returns (SubmitTaskResponse);
  rpc GetTaskStatus(GetTaskStatusRequest) returns (Task);
  rpc CancelTask(CancelTaskRequest) returns (CancelTaskResponse);
  rpc ListTasks(ListTasksRequest) returns (ListTasksResponse);
  rpc StreamTaskUpdates(StreamTaskUpdatesRequest) returns (stream TaskUpdate);
  rpc GetStats(GetStatsRequest) returns (Stats);
}

message SubmitTaskRequest {
  string task_type = 1;
  bytes payload = 2;
  uint32 priority = 3;
  google.protobuf.Timestamp schedule_at = 4;
  uint32 timeout_seconds = 5;
  uint32 max_retries = 6;
}

message SubmitTaskResponse {
  string task_id = 1;
  string status = 2;
}

message Task {
  string task_id = 1;
  string task_type = 2;
  string status = 3;
  uint32 priority = 4;
  google.protobuf.Timestamp created_at = 5;
  google.protobuf.Timestamp updated_at = 6;
  bytes result = 7;
  string error = 8;
  uint32 retry_count = 9;
  string worker_id = 10;
}

// ... other messages
```

### Example Usage (grpcurl)

```bash
# Submit task
grpcurl -plaintext -d '{
  "task_type": "send_email",
  "payload": "dXNlckBleGFtcGxlLmNvbQ==",
  "priority": 150
}' localhost:9090 taskqueue.v1.TaskQueue/SubmitTask

# Get task status
grpcurl -plaintext -d '{
  "task_id": "123e4567-e89b-12d3-a456-426614174000"
}' localhost:9090 taskqueue.v1.TaskQueue/GetTaskStatus

# Stream task updates
grpcurl -plaintext -d '{
  "task_id": "123e4567-e89b-12d3-a456-426614174000"
}' localhost:9090 taskqueue.v1.TaskQueue/StreamTaskUpdates
```

## WebSocket Protocol (Future)

### Connection

**WS /ws**

Connect to WebSocket for real-time updates.

### Message Format

**Client → Server:**
```json
{
  "type": "subscribe",
  "filters": {
    "task_types": ["send_email"],
    "statuses": ["completed", "failed"]
  }
}
```

**Server → Client:**
```json
{
  "type": "task_update",
  "task": {
    "task_id": "uuid",
    "status": "completed",
    "updated_at": "2024-01-01T12:00:00Z"
  }
}
```

### Example (JavaScript)

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    filters: { statuses: ['completed'] }
  }));
};

ws.onmessage = (event) => {
  const update = JSON.parse(event.data);
  console.log('Task update:', update);
};
```

## Admin CLI

### Submit Task

```bash
tq-admin submit \
  --type send_email \
  --payload-file email.txt \
  --priority 200

# Output:
# Task submitted: 123e4567-e89b-12d3-a456-426614174000
```

### Check Status

```bash
tq-admin status 123e4567-e89b-12d3-a456-426614174000

# Output (table):
# ┌───────────┬────────────────────────────────────────┐
# │ Field     │ Value                                  │
# ├───────────┼────────────────────────────────────────┤
# │ ID        │ 123e4567-e89b-12d3-a456-426614174000  │
# │ Type      │ send_email                             │
# │ Status    │ completed                              │
# │ Priority  │ 200                                    │
# │ Created   │ 2024-01-01T12:00:00Z                  │
# └───────────┴────────────────────────────────────────┘
```

### List Tasks

```bash
tq-admin list --status pending --limit 10

# JSON output
tq-admin list --status pending --format json

# YAML output
tq-admin list --status pending --format yaml
```

### View Statistics

```bash
tq-admin stats

# Output (table):
# ┌─────────────────┬───────┐
# │ Metric          │ Value │
# ├─────────────────┼───────┤
# │ Pending Tasks   │ 1234  │
# │ In Progress     │ 56    │
# │ Workers         │ 10    │
# │ Queue (High)    │ 100   │
# │ Queue (Normal)  │ 1000  │
# │ Queue (Low)     │ 134   │
# └─────────────────┴───────┘
```

### List Workers

```bash
tq-admin workers

# Output (table):
# ┌────────────────────────┬───────┬────────┬────────────┐
# │ Worker ID              │ Tasks │ CPU %  │ Memory MB  │
# ├────────────────────────┼───────┼────────┼────────────┤
# │ worker-host-12345-abc  │ 3     │ 45.2   │ 256        │
# │ worker-host-12346-def  │ 2     │ 32.1   │ 198        │
# └────────────────────────┴───────┴────────┴────────────┘
```

### Queue Depth Visualization

```bash
tq-admin queue-depth

# Output:
# Queue Depth by Priority:
#   High:   100 ████████████████████████████
#   Normal: 1000 ██████████████████████████████████████████████████
#   Low:    134 ████████████████
```

### Cluster Status

```bash
tq-admin cluster-status

# Output (table):
# ┌───────────────────┬─────────┐
# │ Property          │ Value   │
# ├───────────────────┼─────────┤
# │ Status            │ healthy │
# │ Is Leader         │ true    │
# │ Connected Workers │ 10      │
# │ Pending Tasks     │ 1234    │
# └───────────────────┴─────────┘
```

## Error Codes

### HTTP Status Codes

- `200 OK` - Request successful
- `201 Created` - Task created
- `204 No Content` - Task cancelled
- `400 Bad Request` - Invalid request
- `404 Not Found` - Task not found
- `409 Conflict` - Operation not allowed in current state
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - Broker unavailable or degraded

### Error Response Format

```json
{
  "error": "Human-readable error message"
}
```

## Rate Limiting

### Per-API-Key Limits

- **Default**: 100 requests/second
- **Burst**: 200 requests
- **Response**: 429 Too Many Requests
- **Retry-After Header**: Seconds until retry allowed

### Example

```bash
curl -H "Authorization: Bearer api-key" \
  http://localhost:8080/api/v1/tasks

# Response (if rate limited):
# HTTP/1.1 429 Too Many Requests
# Retry-After: 5
# {"error": "Rate limit exceeded"}
```

## Authentication

### API Key Authentication

**Header:**
```
Authorization: Bearer <api-key>
```

**Example:**
```bash
curl -H "Authorization: Bearer my-secret-key" \
  http://localhost:8080/api/v1/tasks
```

### Permissions

API keys can have the following permissions:
- `submit_tasks` - Submit new tasks
- `read_tasks` - Query task status
- `cancel_tasks` - Cancel pending tasks
- `admin` - Full access to all operations

## Metrics Endpoint

**GET /metrics**

Prometheus-compatible metrics endpoint.

**Response:** `200 OK` (text/plain)
```
# HELP tq_tasks_total Total number of tasks
# TYPE tq_tasks_total counter
tq_tasks_total{status="pending",task_type="send_email"} 1234

# HELP tq_tasks_pending Number of pending tasks
# TYPE tq_tasks_pending gauge
tq_tasks_pending 1234

# HELP tq_workers_connected Number of connected workers
# TYPE tq_workers_connected gauge
tq_workers_connected 10

# ... more metrics
```

**Example:**
```bash
curl http://localhost:9091/metrics
```
