# Distributed Task Queue System - Complete Specification

## Overview
Build a production-ready distributed task queue system similar to Celery/RQ but written in Rust. The system must handle task scheduling, distributed execution across multiple workers, fault tolerance, and provide both programmatic and UI-based management interfaces.

## Core Components

### 1. Task Definition & Serialization

**Task Structure Requirements:**
- Each task must have: unique ID (UUID v4), task type name, payload (arbitrary bytes), priority (integer 0-255, higher = more urgent), created timestamp, scheduled execution time (can be immediate or future), maximum retry count, current retry attempt, timeout duration in seconds
- Tasks must be serializable to a compact binary format for network transmission and storage
- Support task payload sizes up to 10MB
- Task types are registered string identifiers (e.g., "send_email", "process_image")

**Priority System:**
- Implement 3 priority tiers: High (200-255), Normal (100-199), Low (0-99)
- Workers must always process higher priority tasks first
- Within same priority, use FIFO ordering
- Tasks can optionally have dependencies on other task IDs (must wait for dependencies to complete)

### 2. Message Broker

**Network Protocol:**
- Implement a custom TCP-based protocol using tokio
- Each message frame format: 4-byte length prefix (big-endian) | 1-byte message type | payload
- Message types: SUBMIT_TASK, CLAIM_TASK, TASK_RESULT, HEARTBEAT, ACK, NACK, QUERY_STATUS
- Support connection pooling with configurable max connections per client
- Implement backpressure when queue depth exceeds configurable threshold (default 100,000 tasks)

**Broker Responsibilities:**
- Listen on configurable TCP port (default 6379)
- Maintain in-memory priority queue of pending tasks
- Track which tasks are claimed by which workers
- Handle worker registration and deregistration
- Implement task claiming with lease mechanism (workers must heartbeat every 30 seconds or task is reclaimed)
- Support multiple concurrent client connections (target: 1000+ simultaneous connections)

**Communication Patterns:**
- Clients submit tasks to broker
- Workers poll broker for available tasks (long-polling with 30 second timeout)
- Workers send heartbeats every 15 seconds while processing tasks
- Workers return results or errors to broker
- Broker forwards results back to original submitting client if still connected

### 3. Persistence Layer

**Storage Requirements:**
- Use RocksDB as the embedded database
- Store all tasks to disk before acknowledging submission
- Write-ahead log (WAL) for durability - all state changes must be logged before applied
- Database schema must track:
  - Pending tasks (not yet claimed)
  - In-progress tasks (claimed by worker, with worker ID and lease expiration)
  - Completed tasks (with result data and completion timestamp, retain for 7 days)
  - Failed tasks (with error information and retry history)
  - Dead letter queue (tasks that exhausted retries)

**Data Organization:**
- Use RocksDB column families: "pending", "in_progress", "completed", "failed", "dead_letter"
- Index tasks by: task ID, task type, priority, scheduled time
- Implement efficient range scans for scheduled task execution
- Periodic compaction to reclaim space from deleted completed tasks

**Recovery Behavior:**
- On broker startup, load all "in_progress" tasks back to "pending" queue (previous workers assumed dead)
- Rebuild in-memory priority queue from persistent storage
- Validate WAL and replay any uncommitted operations

### 4. Worker Pool

**Worker Process:**
- Each worker is a separate process that connects to the broker
- Workers register with unique worker ID (hostname + PID + random suffix)
- Configurable concurrency per worker (default 4 parallel tasks using tokio tasks)
- Workers implement graceful shutdown: stop claiming new tasks, finish in-progress tasks (with 60 second deadline), then exit

**Task Execution:**
- Workers must support pluggable task handlers registered by task type name
- Task handlers are async functions with signature: `async fn(payload: Vec<u8>) -> Result<Vec<u8>, String>`
- Execute tasks with timeout enforcement (kill task if exceeds specified timeout)
- Capture and report panics/errors as task failures
- Return results (success or failure) to broker

**Retry Logic:**
- Workers report failures back to broker with error message
- Broker implements exponential backoff: retry_delay = base_delay * 2^(attempt_number) where base_delay = 5 seconds
- Maximum retry delay capped at 1 hour
- Tasks are rescheduled with delay into priority queue
- After max retries exhausted, move to dead letter queue

**Health Monitoring:**
- Workers send heartbeat every 15 seconds containing: worker ID, current task count, CPU usage %, memory usage MB
- If worker misses 2 consecutive heartbeats (30 seconds), broker marks worker as dead
- Broker reclaims all tasks from dead workers and requeues them

### 5. Clustering & High Availability

**Raft Consensus:**
- Implement Raft consensus algorithm for broker cluster (3 or 5 nodes recommended)
- One broker is elected leader, others are followers
- Only leader accepts task submissions and assigns tasks to workers
- All state changes must be replicated to majority of nodes before acknowledging
- Followers redirect client requests to leader
- On leader failure, followers elect new leader (typically within 1-2 seconds)

**Data Replication:**
- Leader replicates all WAL entries to followers
- Followers apply WAL entries to their local RocksDB
- Clients must wait for majority acknowledgment before submission returns success
- Use snapshot mechanism for new nodes joining cluster (transfer full RocksDB snapshot then stream WAL)

**Split-Brain Prevention:**
- Use Raft's term numbers to prevent split-brain
- Nodes in minority partition reject writes
- Implement fencing tokens for task claims

### 6. API Server

**REST API (using axum):**

All endpoints return JSON. Implement the following:

**POST /api/v1/tasks**
- Submit new task
- Request body: `{"task_type": string, "payload": base64-encoded bytes, "priority": int, "schedule_at": ISO8601 timestamp (optional), "timeout_seconds": int, "max_retries": int}`
- Response: `{"task_id": UUID, "status": "pending"}`
- Status codes: 201 Created, 400 Bad Request, 503 Service Unavailable

**GET /api/v1/tasks/{task_id}**
- Query task status
- Response: `{"task_id": UUID, "status": "pending"|"in_progress"|"completed"|"failed"|"dead_letter", "created_at": ISO8601, "updated_at": ISO8601, "result": base64 (if completed), "error": string (if failed), "retry_count": int, "worker_id": string (if in progress)}`

**DELETE /api/v1/tasks/{task_id}**
- Cancel pending task (only works if status is "pending")
- Returns 204 No Content or 409 Conflict if already in progress

**GET /api/v1/tasks**
- List tasks with filtering
- Query params: `status`, `task_type`, `limit` (default 100, max 1000), `offset`
- Returns paginated list

**GET /api/v1/stats**
- System statistics
- Response: `{"pending_count": int, "in_progress_count": int, "completed_last_hour": int, "failed_last_hour": int, "worker_count": int, "avg_processing_time_ms": float, "queue_depth_by_priority": {"high": int, "normal": int, "low": int}}`

**gRPC API (using tonic):**

Define `.proto` schema with equivalent operations:
- SubmitTask
- GetTaskStatus  
- CancelTask
- ListTasks
- StreamTaskUpdates (server-streaming RPC that pushes status changes for a specific task)
- GetStats

Both APIs must support the same authentication mechanisms.

### 7. Client Libraries

**Blocking Client (sync API):**
```rust
// Example usage - must support this API
let client = TaskQueueClient::connect("127.0.0.1:6379")?;
let task_id = client.submit_task("send_email", payload, Priority::Normal)?;
let result = client.wait_for_result(task_id, Duration::from_secs(60))?;
```

**Async Client (tokio):**
```rust  
// Example usage - must support this API
let client = TaskQueueAsyncClient::connect("127.0.0.1:6379").await?;
let task_id = client.submit_task("send_email", payload, Priority::Normal).await?;
let result = client.wait_for_result(task_id, Duration::from_secs(60)).await?;
```

**Client Features:**
- Connection pooling with configurable pool size
- Automatic reconnection with exponential backoff
- Request timeout configuration
- Result polling vs. blocking wait
- Batch task submission (submit multiple tasks in one request)

### 8. Admin CLI

**Command Structure:**

`tq-admin [OPTIONS] <COMMAND>`

**Required Commands:**

`tq-admin submit --type <TASK_TYPE> --payload-file <FILE> --priority <PRIORITY>`
- Submit task from CLI

`tq-admin status <TASK_ID>`
- Show detailed task status

`tq-admin list --status <STATUS> --limit <N>`
- List tasks with filters

`tq-admin cancel <TASK_ID>`
- Cancel pending task

`tq-admin retry <TASK_ID>`
- Manually retry a failed task

`tq-admin purge --status completed --older-than <DURATION>`
- Delete old completed tasks

`tq-admin workers`
- List all connected workers with health status

`tq-admin stats`
- Show system statistics (pretty-printed table)

`tq-admin cluster-status`
- Show Raft cluster state (leader, followers, term number)

`tq-admin queue-depth`
- Show queue depth by priority with visualization

**Output Formats:**
- Support `--format json|table|yaml` for all commands
- Default to human-readable table format
- Include `--watch` flag for live-updating views on stats/workers

### 9. Web UI

**Technology Stack:**
- Backend: Serve static files and WebSocket endpoint from the API server
- Frontend: Single-page application (can use any framework or vanilla JS, your choice)

**Required Pages:**

**Dashboard (/):**
- Real-time statistics: pending/in-progress/completed/failed counts
- Queue depth chart by priority (updating every 5 seconds)
- Processing rate graph (tasks/minute over last hour)
- Active workers list with health indicators
- Recent failed tasks (last 50)

**Tasks (/tasks):**
- Searchable, filterable, sortable table of all tasks
- Columns: ID, Type, Status, Priority, Created, Updated, Worker, Actions
- Click task ID to see detail modal with full payload/result/error
- Bulk actions: cancel selected, retry selected

**Workers (/workers):**
- Table of all workers: ID, Status (alive/dead), Current Tasks, CPU, Memory, Last Heartbeat
- Click worker to see all tasks currently assigned to it
- Action button to gracefully shutdown worker

**Dead Letter Queue (/dlq):**
- List of all tasks that exhausted retries
- Show error history for each task
- Actions: retry with increased max_retries, delete

**Cluster (/cluster):**
- Raft cluster visualization showing leader and followers
- Current term number
- Log replication status (follower lag)
- Action to trigger leader re-election (for testing)

**WebSocket Real-time Updates:**
- Connect WebSocket on page load
- Server pushes updates when task status changes, workers join/leave, stats change
- UI updates without page refresh

### 10. Security

**Authentication:**
- Support API key authentication via `Authorization: Bearer <token>` header
- API keys stored in config file with bcrypt hashing
- Each API key can have associated permissions: submit_tasks, read_tasks, cancel_tasks, admin
- Admin CLI must support `--api-key` flag or `TQ_API_KEY` environment variable

**TLS:**
- Broker must support TLS for all TCP connections
- Configurable with `--tls-cert` and `--tls-key` flags
- Client libraries must support TLS with optional certificate verification

**Rate Limiting:**
- Per-client rate limiting: max 100 requests per second per API key
- Return 429 Too Many Requests with `Retry-After` header
- Use token bucket algorithm

### 11. Monitoring & Observability

**Prometheus Metrics:**

Expose metrics endpoint at `/metrics`:
- `tq_tasks_total` (counter) - labels: status, task_type
- `tq_tasks_pending` (gauge)
- `tq_tasks_in_progress` (gauge)
- `tq_task_processing_duration_seconds` (histogram) - labels: task_type
- `tq_workers_connected` (gauge)
- `tq_broker_queue_depth` (gauge) - labels: priority
- `tq_raft_term` (gauge)
- `tq_raft_leader` (gauge) - 1 if leader, 0 if follower

**Structured Logging:**

Use `tracing` crate with these levels:
- ERROR: Task failures, worker deaths, Raft election failures
- WARN: Retry attempts, slow tasks (>10s), high queue depth (>10k)
- INFO: Task lifecycle events (submitted, started, completed), worker registration, Raft leadership changes
- DEBUG: Heartbeats, internal state transitions
- TRACE: All network messages

Log format: JSON with fields `timestamp`, `level`, `message`, `task_id`, `worker_id`, `component`

**Health Check Endpoint:**

`GET /health` returns:
- 200 OK if broker is operational and has quorum (if clustered)
- 503 Service Unavailable if degraded (e.g., lost quorum)
- Response body: `{"status": "healthy"|"degraded", "is_leader": bool, "connected_workers": int, "pending_tasks": int}`

### 12. Configuration

**Config File Format (YAML):**

```yaml
broker:
  host: 0.0.0.0
  port: 6379
  max_connections: 1000
  queue_depth_threshold: 100000
  
persistence:
  data_dir: ./data
  wal_sync_interval_ms: 100
  completed_task_retention_days: 7
  
raft:
  enabled: true
  node_id: node1
  peers:
    - node2:6379
    - node3:6379
  election_timeout_ms: 1000
  heartbeat_interval_ms: 300
  
api:
  rest_port: 8080
  grpc_port: 9090
  enable_tls: false
  tls_cert_path: null
  tls_key_path: null
  
auth:
  enabled: true
  api_keys:
    - key_hash: $2b$12$...
      permissions: [admin]
  
monitoring:
  prometheus_port: 9091
  log_level: info
  
worker:
  concurrency: 4
  heartbeat_interval_secs: 15
  graceful_shutdown_timeout_secs: 60
```

Support `--config` CLI flag to specify config file path.

### 13. Performance Requirements

**Throughput:**
- Single broker: minimum 10,000 tasks/second submission rate
- Single broker: minimum 5,000 tasks/second processing rate (with 10 workers)
- Clustered (3 nodes): minimum 7,000 tasks/second submission rate

**Latency:**
- Task submission to acknowledgment: p99 < 10ms (unclustered), p99 < 50ms (clustered)
- Task assignment to worker after submission: p99 < 100ms
- End-to-end task completion for trivial task (1ms processing): p99 < 500ms

**Resource Usage:**
- Broker memory: < 500MB with 100k pending tasks
- Worker memory: < 100MB per worker process
- Broker CPU: < 50% of one core at 5k tasks/sec

### 14. Testing Requirements

**Unit Tests:**
- All public APIs must have unit tests
- Test task serialization/deserialization
- Test priority queue ordering
- Test retry logic with mocked time
- Target >80% code coverage

**Integration Tests:**
- Test full workflow: submit task → worker claims → processes → returns result → client retrieves
- Test worker failure scenarios (worker crashes mid-task)
- Test broker restart with persistence recovery
- Test task cancellation
- Test dead letter queue behavior
- Test graceful worker shutdown

**Property-Based Tests:**
- Use `proptest` or `quickcheck` for:
  - Task serialization is lossless
  - Priority queue maintains ordering under all operations
  - Raft log replication preserves order

**Chaos Engineering Tests:**
- Randomly kill workers during processing
- Simulate network partitions in Raft cluster
- Corrupt RocksDB files and test recovery
- Introduce random delays to test timeout behavior

### 15. Documentation Requirements

**README.md:**
- Project overview
- Architecture diagram
- Quick start guide (single broker, single worker)
- Building from source
- Running tests

**docs/architecture.md:**
- Detailed component descriptions
- Data flow diagrams
- Raft implementation details
- Performance characteristics

**docs/api.md:**
- Complete REST API reference with curl examples
- gRPC API reference with grpcurl examples
- WebSocket protocol specification

**docs/deployment.md:**
- Production deployment guide
- Clustering setup
- Monitoring setup (Prometheus + Grafana)
- Backup and disaster recovery procedures

**Code Documentation:**
- All public functions, structs, and modules must have doc comments
- Include usage examples in doc comments
- Generate rustdoc and ensure it builds without warnings

### 16. Deliverables Checklist

A complete implementation must include:

- [ ] Broker binary (`tq-broker`)
- [ ] Worker binary (`tq-worker`)
- [ ] Admin CLI binary (`tq-admin`)
- [ ] Client library crate (`task-queue-client`)
- [ ] Complete web UI (bundled with broker)
- [ ] Configuration file schema and examples
- [ ] Docker Compose file for local 3-node cluster
- [ ] All tests passing with >80% coverage
- [ ] Complete documentation in docs/
- [ ] Performance benchmark results documented
- [ ] Example task handler implementations (at least 3 different types)

### 17. Constraints & Requirements

**Language & Dependencies:**
- Must be written in Rust (stable channel)
- Use tokio for async runtime
- Use RocksDB via `rust-rocksdb` crate
- Cannot use existing queue systems (no Celery, RQ, Sidekiq, etc.)
- Implement Raft from scratch or use `raft-rs` crate
- Minimize dependencies where possible (prefer standard library)

**Code Quality:**
- Pass `cargo clippy` with no warnings
- Format with `cargo fmt`
- No `unsafe` code except where absolutely necessary (must document why)
- Handle all errors explicitly (no unwrap/expect in production code paths)

**Portability:**
- Must run on Linux, macOS, Windows
- All file paths must use cross-platform path handling
- Network byte order must be explicit (big-endian)

This specification should be detailed enough to produce a complete, production-quality implementation without ambiguity.