# Task Queue API Reference

This document provides a complete reference for the Task Queue REST and gRPC APIs.

## Table of Contents

- [REST API](#rest-api)
  - [Authentication](#authentication)
  - [Endpoints](#endpoints)
- [gRPC API](#grpc-api)
- [TCP Protocol](#tcp-protocol)
- [Error Codes](#error-codes)
- [Examples](#examples)

---

## REST API

### Base URL

```
http://localhost:8080/api/v1
```

### Authentication

#### API Key (Bearer Token)

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:8080/api/v1/tasks
```

#### Rate Limiting

- Default: 100 requests/second per API key
- Returns `429 Too Many Requests` with `Retry-After` header

### Endpoints

#### 1. Submit Task

Submit a new task to the queue.

**Request:**
```http
POST /api/v1/tasks
Content-Type: application/json
Authorization: Bearer <api_key>

{
  "task_type": "string",
  "payload": "base64-encoded-bytes",
  "priority": 0-255,
  "schedule_at": "ISO8601-timestamp",
  "timeout_seconds": 30,
  "max_retries": 3,
  "dependencies": ["uuid", "uuid"]
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task_type` | string | Yes | Type of task (handler name) |
| `payload` | string | Yes | Base64-encoded payload bytes |
| `priority` | integer | No | 0-255 (default: 150) |
| `schedule_at` | string | No | ISO8601 timestamp (default: now) |
| `timeout_seconds` | integer | No | Task timeout (default: 300) |
| `max_retries` | integer | No | Max retry attempts (default: 3) |
| `dependencies` | array | No | List of task IDs to wait for |

**Response (201 Created):**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending"
}
```

**Error Responses:**

- `400 Bad Request` - Invalid request body
- `429 Too Many Requests` - Rate limit exceeded
- `503 Service Unavailable` - Queue depth threshold exceeded

**Example:**
```bash
curl -X POST http://localhost:8080/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "echo",
    "payload": "SGVsbG8sIFdvcmxkIQ==",
    "priority": 150,
    "timeout_seconds": 30
  }'
```

---

#### 2. Get Task Status

Get the current status of a task.

**Request:**
```http
GET /api/v1/tasks/{task_id}
Authorization: Bearer <api_key>
```

**Response (200 OK):**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:02Z",
  "result": "SGVsbG8sIFdvcmxkIQ==",
  "error": null,
  "retry_count": 0,
  "worker_id": "worker-hostname-1234-abcd"
}
```

**Status Values:**
- `pending` - Task waiting to be claimed
- `in_progress` - Task being executed
- `completed` - Task completed successfully
- `failed` - Task failed (may be retried)
- `dead_letter` - Task exhausted all retries

**Error Responses:**

- `404 Not Found` - Task doesn't exist

**Example:**
```bash
curl http://localhost:8080/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000
```

---

#### 3. Cancel Task

Cancel a pending task (only works if status is "pending").

**Request:**
```http
DELETE /api/v1/tasks/{task_id}
Authorization: Bearer <api_key>
```

**Response (204 No Content):**

Task successfully cancelled.

**Error Responses:**

- `404 Not Found` - Task doesn't exist
- `409 Conflict` - Task already in progress or completed

**Example:**
```bash
curl -X DELETE http://localhost:8080/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000
```

---

#### 4. List Tasks

List tasks with optional filtering and pagination.

**Request:**
```http
GET /api/v1/tasks?status=pending&task_type=echo&limit=100&offset=0
Authorization: Bearer <api_key>
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | No | Filter by status |
| `task_type` | string | No | Filter by task type |
| `limit` | integer | No | Max results (default: 100, max: 1000) |
| `offset` | integer | No | Pagination offset (default: 0) |

**Response (200 OK):**
```json
{
  "tasks": [
    {
      "task_id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "completed",
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:02Z",
      "result": "...",
      "error": null,
      "retry_count": 0,
      "worker_id": "worker-1"
    }
  ],
  "total": 1500
}
```

**Examples:**
```bash
# List pending tasks
curl http://localhost:8080/api/v1/tasks?status=pending

# List failed tasks of type 'email'
curl "http://localhost:8080/api/v1/tasks?status=failed&task_type=email"

# List with pagination
curl "http://localhost:8080/api/v1/tasks?limit=50&offset=100"
```

---

#### 5. Get Statistics

Get system statistics.

**Request:**
```http
GET /api/v1/stats
Authorization: Bearer <api_key>
```

**Response (200 OK):**
```json
{
  "pending_count": 1234,
  "in_progress_count": 56,
  "completed_last_hour": 12345,
  "failed_last_hour": 123,
  "worker_count": 10,
  "avg_processing_time_ms": 150.5,
  "queue_depth_by_priority": {
    "high": 100,
    "normal": 800,
    "low": 334
  }
}
```

**Example:**
```bash
curl http://localhost:8080/api/v1/stats
```

---

#### 6. List Workers

Get information about connected workers.

**Request:**
```http
GET /api/v1/workers
Authorization: Bearer <api_key>
```

**Response (200 OK):**
```json
[
  {
    "worker_id": "worker-hostname-1234-abcd",
    "hostname": "worker1.example.com",
    "pid": 12345,
    "current_tasks": 2,
    "cpu_usage_percent": 45.5,
    "memory_usage_mb": 512,
    "last_heartbeat": "2024-01-15T10:30:00Z",
    "status": "active"
  }
]
```

**Worker Status:**
- `active` - Processing tasks
- `idle` - Available but no tasks
- `dead` - Missed heartbeats

**Example:**
```bash
curl http://localhost:8080/api/v1/workers
```

---

#### 7. Health Check

Check if the broker is healthy.

**Request:**
```http
GET /health
```

**Response (200 OK):**
```json
{
  "status": "healthy",
  "is_leader": true,
  "connected_workers": 10,
  "pending_tasks": 1234
}
```

**Degraded Response (503 Service Unavailable):**
```json
{
  "status": "degraded",
  "is_leader": false,
  "connected_workers": 8,
  "pending_tasks": 1234
}
```

**Example:**
```bash
curl http://localhost:8080/health
```

---

#### 8. Prometheus Metrics

Get Prometheus metrics.

**Request:**
```http
GET /metrics
```

**Response:**
```
# HELP tq_tasks_total Total number of tasks processed
# TYPE tq_tasks_total counter
tq_tasks_total{status="completed",task_type="echo"} 12345
tq_tasks_total{status="failed",task_type="echo"} 123

# HELP tq_tasks_pending Number of pending tasks
# TYPE tq_tasks_pending gauge
tq_tasks_pending 1234

# HELP tq_task_processing_duration_seconds Task processing duration in seconds
# TYPE tq_task_processing_duration_seconds histogram
tq_task_processing_duration_seconds_bucket{task_type="echo",le="0.001"} 100
tq_task_processing_duration_seconds_bucket{task_type="echo",le="0.01"} 500
...
```

**Example:**
```bash
curl http://localhost:8091/metrics
```

---

## gRPC API

### Connection

```protobuf
service TaskQueue {
  // Methods...
}
```

**Server:** `localhost:9090`

**Proto File:** `proto/task_queue.proto`

---

#### SubmitTask

Submit a new task.

**Request:**
```protobuf
message SubmitTaskRequest {
  string task_type = 1;
  bytes payload = 2;
  uint32 priority = 3;
  string schedule_at = 4;  // ISO8601
  uint64 timeout_seconds = 5;
  uint32 max_retries = 6;
  repeated string dependencies = 7;
}
```

**Response:**
```protobuf
message SubmitTaskResponse {
  string task_id = 1;
  string status = 2;
}
```

**Example (grpcurl):**
```bash
grpcurl -plaintext \
  -d '{
    "task_type": "echo",
    "payload": "SGVsbG8=",
    "priority": 150
  }' \
  localhost:9090 \
  taskqueue.v1.TaskQueue/SubmitTask
```

---

#### GetTaskStatus

Get task status.

**Request:**
```protobuf
message GetTaskStatusRequest {
  string task_id = 1;
}
```

**Response:**
```protobuf
message GetTaskStatusResponse {
  Task task = 1;
}
```

**Example:**
```bash
grpcurl -plaintext \
  -d '{"task_id": "550e8400-e29b-41d4-a716-446655440000"}' \
  localhost:9090 \
  taskqueue.v1.TaskQueue/GetTaskStatus
```

---

#### CancelTask

Cancel a task.

**Request:**
```protobuf
message CancelTaskRequest {
  string task_id = 1;
}
```

**Response:**
```protobuf
message CancelTaskResponse {
  bool success = 1;
}
```

---

#### ListTasks

List tasks with filtering.

**Request:**
```protobuf
message ListTasksRequest {
  string status = 1;
  string task_type = 2;
  uint32 limit = 3;
  uint32 offset = 4;
}
```

**Response:**
```protobuf
message ListTasksResponse {
  repeated Task tasks = 1;
  uint64 total = 2;
}
```

---

#### StreamTaskUpdates

Stream task updates (server-streaming).

**Request:**
```protobuf
message StreamTaskUpdatesRequest {
  string task_id = 1;
}
```

**Response (stream):**
```protobuf
message TaskUpdate {
  string task_id = 1;
  string status = 2;
  TaskResult result = 3;
}
```

**Example:**
```bash
grpcurl -plaintext \
  -d '{"task_id": "..."}' \
  localhost:9090 \
  taskqueue.v1.TaskQueue/StreamTaskUpdates
```

---

#### GetStats

Get system statistics.

**Request:**
```protobuf
message GetStatsRequest {}
```

**Response:**
```protobuf
message GetStatsResponse {
  uint64 pending_count = 1;
  uint64 in_progress_count = 2;
  uint64 completed_last_hour = 3;
  uint64 failed_last_hour = 4;
  uint64 worker_count = 5;
  double avg_processing_time_ms = 6;
  QueueDepthByPriority queue_depth_by_priority = 7;
}
```

---

## TCP Protocol

The task queue uses a custom TCP protocol for worker and client communication.

### Frame Format

```
┌─────────────┬──────────┬─────────────┐
│ Length (4B) │ Type (1B) │  Payload    │
│  big-endian │           │  (N bytes)  │
└─────────────┴──────────┴─────────────┘
```

- **Length:** Total frame size (excluding length prefix), big-endian
- **Type:** Message type (see below)
- **Payload:** Serialized message (bincode)

### Message Types

| Type | Value | Direction |
|------|-------|-----------|
| SUBMIT_TASK | 0 | Client → Broker |
| CLAIM_TASK | 1 | Worker → Broker |
| TASK_RESULT | 2 | Worker → Broker |
| HEARTBEAT | 3 | Worker → Broker |
| QUERY_STATUS | 4 | Client → Broker |
| ACK | 5 | Broker → Client/Worker |
| NACK | 6 | Broker → Client/Worker |
| CANCEL_TASK | 7 | Client → Broker |
| LIST_TASKS | 8 | Client → Broker |
| GET_STATS | 9 | Client → Broker |
| TASK_ASSIGNED | 10 | Broker → Worker |
| TASK_UPDATE | 11 | Broker → Client |
| WORKER_REGISTRATION | 12 | Worker → Broker |
| WORKER_DEREGISTRATION | 13 | Worker → Broker |
| ERROR | 14 | Broker → Client/Worker |
| PING | 15 | Client → Broker |
| PONG | 16 | Broker → Client |

### Message Formats

**SubmitTask:**
```rust
Message::SubmitTask {
    task: Task {
        id: Uuid,
        task_type: String,
        payload: Vec<u8>,
        priority: u8,
        // ...
    }
}
```

**ClaimTask:**
```rust
Message::ClaimTask {
    worker_id: String,
    max_priority: Option<u8>,
}
```

**TaskResult:**
```rust
Message::TaskResult {
    result: TaskResult {
        task_id: Uuid,
        success: bool,
        result_data: Option<Vec<u8>>,
        error_message: Option<String>,
        worker_id: String,
        completed_at: DateTime<Utc>,
        processing_duration_ms: u64,
    }
}
```

**Heartbeat:**
```rust
Message::Heartbeat {
    data: HeartbeatData {
        worker_id: String,
        current_task_count: u32,
        cpu_usage_percent: f32,
        memory_usage_mb: u32,
    }
}
```

---

## Error Codes

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 204 | No Content |
| 400 | Bad Request |
| 401 | Unauthorized |
| 404 | Not Found |
| 409 | Conflict |
| 429 | Too Many Requests |
| 500 | Internal Server Error |
| 503 | Service Unavailable |

### Error Response Format

```json
{
  "error": "Error message",
  "code": 400
}
```

### TCP Error Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request |
| 401 | Unauthorized |
| 404 | Not Found |
| 409 | Conflict |
| 500 | Internal Server Error |

---

## Examples

### Python

```python
import requests
import base64
import json

# Submit task
payload = base64.b64encode(b"Hello, World!").decode()
response = requests.post(
    "http://localhost:8080/api/v1/tasks",
    json={
        "task_type": "echo",
        "payload": payload,
        "priority": 150
    }
)
task_id = response.json()["task_id"]

# Get status
response = requests.get(f"http://localhost:8080/api/v1/tasks/{task_id}")
print(response.json())
```

### JavaScript/Node.js

```javascript
const axios = require('axios');

// Submit task
const payload = Buffer.from('Hello, World!').toString('base64');
const response = await axios.post('http://localhost:8080/api/v1/tasks', {
  task_type: 'echo',
  payload: payload,
  priority: 150
});
const taskId = response.data.task_id;

// Get status
const task = await axios.get(`http://localhost:8080/api/v1/tasks/${taskId}`);
console.log(task.data);
```

### Go

```go
package main

import (
    "encoding/base64"
    "fmt"
    "net/http"
    "bytes"
    "encoding/json"
)

func main() {
    // Submit task
    payload := base64.StdEncoding.EncodeToString([]byte("Hello, World!"))
    data := map[string]interface{}{
        "task_type": "echo",
        "payload":   payload,
        "priority": 150,
    }
    jsonData, _ := json.Marshal(data)

    resp, _ := http.Post(
        "http://localhost:8080/api/v1/tasks",
        "application/json",
        bytes.NewBuffer(jsonData),
    )

    var result map[string]interface{}
    json.NewDecoder(resp.Body).Decode(&result)
    fmt.Println(result["task_id"])
}
```

### Java

```java
import java.net.http.*;
import java.net.URI;
import java.util.Base64;
import org.json.JSONObject;

public class TaskQueueClient {
    public static void main(String[] args) throws Exception {
        // Submit task
        HttpClient client = HttpClient.newHttpClient();
        String payload = Base64.getEncoder().encodeToString("Hello, World!".getBytes());
        
        JSONObject data = new JSONObject();
        data.put("task_type", "echo");
        data.put("payload", payload);
        data.put("priority", 150);
        
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:8080/api/v1/tasks"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(data.toString()))
            .build();
        
        HttpResponse<String> response = client.send(request, 
            HttpResponse.BodyHandlers.ofString());
        
        System.out.println(response.body());
    }
}
```

### cURL

```bash
# Submit task
curl -X POST http://localhost:8080/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "echo",
    "payload": "SGVsbG8=",
    "priority": 150
  }'

# Get task status
curl http://localhost:8080/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000

# List tasks
curl "http://localhost:8080/api/v1/tasks?status=pending&limit=10"

# Get stats
curl http://localhost:8080/api/v1/stats

# Cancel task
curl -X DELETE http://localhost:8080/api/v1/tasks/550e8400-e29b-41d4-a716-446655440000
```

### Ruby

```ruby
require 'net/http'
require 'json'
require 'base64'

# Submit task
uri = URI('http://localhost:8080/api/v1/tasks')
payload = Base64.strict_encode64('Hello, World!')

response = Net::HTTP.post(uri, {
  task_type: 'echo',
  payload: payload,
  priority: 150
}.to_json, 'Content-Type' => 'application/json')

task_id = JSON.parse(response.body)['task_id']

# Get status
uri = URI("http://localhost:8080/api/v1/tasks/#{task_id}")
response = Net::HTTP.get(uri)
puts JSON.parse(response.body)
```

### PHP

```php
<?php
// Submit task
$payload = base64_encode('Hello, World!');
$data = [
    'task_type' => 'echo',
    'payload' => $payload,
    'priority' => 150
];

$ch = curl_init('http://localhost:8080/api/v1/tasks');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($ch));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);

$response = curl_exec($ch);
$result = json_decode($response, true);
$taskId = $result['task_id'];

// Get status
$ch = curl_init("http://localhost:8080/api/v1/tasks/{$taskId}");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
echo $response;
?>
```

---

## WebSocket Support (Planned)

WebSocket support is planned for real-time task updates:

```javascript
const ws = new WebSocket('ws://localhost:8080/ws/updates');

ws.onmessage = (event) => {
    const update = JSON.parse(event.data);
    console.log('Task update:', update);
};

// Subscribe to task
ws.send(JSON.stringify({
    action: 'subscribe',
    task_id: '550e8400-e29b-41d4-a716-446655440000'
}));
```

---

## Rate Limiting Details

### Token Bucket Algorithm

- **Capacity:** 2x sustained rate (burst allowance)
- **Refill Rate:** 100 tokens/second (default)
- **Per-request Cost:** 1 token

### Response Headers

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 5
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1705344000
```

### Exceeded Limit

When rate limit is exceeded, the client should:

1. Read `Retry-After` header (seconds)
2. Wait for the specified duration
3. Retry the request

---

## Best Practices

### 1. Use Appropriate Priorities

- **High (200-255):** Urgent tasks, alerts, time-critical operations
- **Normal (100-199):** Regular tasks, typical operations
- **Low (0-99):** Batch jobs, reports, non-urgent work

### 2. Set Reasonable Timeouts

```json
{
  "timeout_seconds": 300
}
```

- Short tasks: 30-60 seconds
- Medium tasks: 5-10 minutes
- Long tasks: 30-60 minutes

### 3. Handle Task Failures

```python
try:
    result = wait_for_result(task_id, timeout=60)
except TaskFailed as e:
    # Check error message
    print(f"Task failed: {e.error}")
```

### 4. Use Polling for Long-Running Tasks

```python
while True:
    task = get_task_status(task_id)
    if task['status'] in ['completed', 'failed', 'dead_letter']:
        break
    time.sleep(1)
```

### 5. Batch Task Submission

```python
# Submit multiple tasks efficiently
tasks = [
    ('echo', payload1, Priority.Normal),
    ('echo', payload2, Priority.Normal),
    ('echo', payload3, Priority.Normal),
]
task_ids = client.submit_tasks_batch(tasks)
```

### 6. Monitor Queue Depth

```python
stats = client.get_stats()
if stats['queue_depth_by_priority']['high'] > 10000:
    # Scale up workers
    print("Warning: High priority queue is large")
```

---

## Troubleshooting

### Common Issues

#### 1. Task Stuck in "pending"

**Possible causes:**
- No workers available
- Workers at capacity
- Network issues

**Solutions:**
- Check worker count: `GET /api/v1/workers`
- Scale up workers
- Check broker logs

#### 2. Task Timeout

**Possible causes:**
- Task too slow
- Timeout too short
- Handler hanging

**Solutions:**
- Increase `timeout_seconds`
- Optimize handler code
- Check worker logs for panics

#### 3. High Failure Rate

**Possible causes:**
- Handler bugs
- External service issues
- Resource exhaustion

**Solutions:**
- Check error messages
- Review handler logs
- Increase `max_retries`

#### 4. Rate Limit Exceeded

**Possible causes:**
- Too many requests
- Client sending too fast

**Solutions:**
- Implement client-side throttling
- Use batch operations
- Respect `Retry-After` header

---

## Version History

### v1.0.0 (Current)
- Initial stable release
- REST API
- gRPC API
- TCP protocol
- Authentication
- Rate limiting

### Future v1.1.0 (Planned)
- WebSocket support
- Task streaming
- Bulk operations
- Webhook notifications
- Task templates

### Future v2.0.0 (Planned)
- Workflows/DAG support
- Cron scheduling
- Task groups
- Advanced retry policies
- SLA monitoring

---

## Support

For questions, issues, or contributions:

- **GitHub Issues:** https://github.com/example/task-queue/issues
- **Documentation:** https://task-queue.readthedocs.io
- **Discord:** https://discord.gg/task-queue
- **Email:** support@task-queue.io

---

**Document Version:** 1.0.0  
**Last Updated:** 2024-01-15
