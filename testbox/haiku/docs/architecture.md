# Architecture

## System Overview

The distributed task queue consists of the following components:

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Applications                       │
│  (HTTP/gRPC/Sync Client Library/Async Client Library)       │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                  REST API Server (Axum)                      │
│  /api/v1/tasks, /api/v1/stats, /metrics, /health           │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                  GRPC Server (Tonic)                         │
│  SubmitTask, GetStatus, ListTasks, StreamUpdates           │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼──────────────┬──────────────────────────┐
│      Broker (Primary Component)   │  Worker Pool             │
│  ┌──────────────────────────────┐ │  ┌────────────────────┐  │
│  │ Priority Queue               │ │  │ Task Executors     │  │
│  │ - High Priority (200-255)    │ │  │ - Concurrent tasks │  │
│  │ - Normal Priority (100-199)  │ │  │ - Handler registry │  │
│  │ - Low Priority (0-99)        │ │  │ - Timeout handling │  │
│  └──────────────────────────────┘ │  └────────────────────┘  │
│  ┌──────────────────────────────┐ │                          │
│  │ Worker Registry              │ │                          │
│  │ - Worker ID tracking         │ │                          │
│  │ - Health monitoring          │ │                          │
│  │ - Heartbeat validation       │ │                          │
│  └──────────────────────────────┘ │                          │
│  ┌──────────────────────────────┐ │                          │
│  │ Task State Management        │ │                          │
│  │ - Claim tracking             │ │                          │
│  │ - Lease management           │ │                          │
│  │ - Dead worker recovery       │ │                          │
│  └──────────────────────────────┘ │                          │
└────────────────────┬──────────────┴──────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
┌────────▼────────────────────┐  │
│  Persistence Layer          │  │
│  ┌──────────────────────┐   │  │
│  │ RocksDB Storage      │   │  │
│  │ - Pending tasks      │   │  │
│  │ - In-progress tasks  │   │  │
│  │ - Completed tasks    │   │  │
│  │ - Failed tasks       │   │  │
│  │ - Dead letter queue  │   │  │
│  └──────────────────────┘   │  │
│  ┌──────────────────────┐   │  │
│  │ Write-Ahead Log      │   │  │
│  │ - Durability         │   │  │
│  │ - Recovery           │   │  │
│  └──────────────────────┘   │  │
└─────────────────────────────┘  │
                                 │
                    ┌────────────▼────────────┐
                    │  Raft Cluster          │
                    │  - Leader election     │
                    │  - State replication   │
                    │  - Log consistency    │
                    └────────────────────────┘
```

## Component Descriptions

### Broker

The central coordinator managing the task queue lifecycle.

**Responsibilities:**
- Accept task submissions from clients
- Maintain priority queue of pending tasks
- Assign tasks to available workers
- Track in-progress tasks with lease mechanism
- Handle task completion and failure scenarios
- Manage worker health and dead worker recovery
- Persist task state to storage
- Expose metrics and statistics

**Key Classes:**
- `Broker`: Main broker implementation
- `BrokerConfig`: Configuration parameters
- `BrokerStats`: Statistics snapshot

### Priority Queue

In-memory priority queue for managing pending tasks.

**Properties:**
- Uses binary heap for O(log n) operations
- Maintains O(1) lookup via HashMap index
- Supports arbitrary priority values (0-255)
- Removed tasks are lazily deleted from heap

**Operations:**
- `push(task)`: O(log n)
- `pop()`: O(log n) amortized
- `get(id)`: O(1)
- `remove(id)`: O(1) mark, O(log n) lazy deletion

### Worker Registry

Tracks connected workers and their health status.

**Tracks:**
- Worker unique identifiers
- Last heartbeat timestamp
- Current task count
- CPU and memory usage
- Derived: Health status (alive/dead based on timeout)

**Detection:**
- Worker considered dead if no heartbeat for `heartbeat_timeout_secs` (default: 30s)
- Automatic dead worker detection triggers task reclamation

### Persistence Layer

Durable storage using RocksDB with write-ahead logging.

**Column Families:**
- `pending`: Tasks awaiting execution
- `in_progress`: Tasks currently being processed
- `completed`: Successfully completed tasks (7-day retention)
- `failed`: Tasks that failed but are eligible for retry
- `dead_letter`: Tasks that exhausted retries

**Recovery:**
- On startup, load all pending and in_progress tasks
- Rebuild in-memory priority queue
- Recover from crashes: replay WAL
- Reclaim any in_progress tasks (workers assumed dead)

### Task State Machine

```
┌─────────┐
│ Created │
└────┬────┘
     │
     ▼
┌─────────────┐
│   Pending   │ ◄──── Retry scheduled with delay
└────┬────────┘
     │
     ▼
┌─────────────────┐
│   InProgress    │──────► Heartbeat timeout ──► Pending (reclaim)
└────┬────────────┘
     │
     ├─► Success ──────────────────────┐
     │                                  │
     ├─► Failure (within max_retries)──► Pending (delayed)
     │                                  │
     └─► Failure (exhausted retries)───► DeadLetter

                                       Or

                                    ▼
                              ┌──────────────┐
                              │  Completed   │
                              └──────────────┘
```

### Retry Logic

Exponential backoff with jitter:
```
delay = base_delay * 2^attempt
max_delay = 1 hour
```

Example retry timeline:
- Attempt 0 (immediate)
- Attempt 1 (5 seconds after first failure)
- Attempt 2 (10 seconds)
- Attempt 3 (20 seconds)
- ... up to 3600 seconds (1 hour)

## Data Model

### Task Structure

```rust
struct Task {
    id: UUID,                          // Unique identifier
    task_type: String,                 // "send_email", "process_image", etc.
    payload: Vec<u8>,                  // Arbitrary binary data (up to 10MB)
    priority: u8,                      // 0-255, higher = more urgent
    status: TaskStatus,                // Pending/InProgress/Completed/Failed/DeadLetter
    created_at: DateTime,              // Creation timestamp
    scheduled_at: DateTime,            // When to execute (for delayed tasks)
    worker_id: Option<String>,         // Which worker claimed it
    lease_expires_at: Option<DateTime>,// When worker lease expires
    result: Option<Vec<u8>>,           // Result data (if completed)
    error: Option<String>,             // Error message (if failed)
    timeout_seconds: u64,              // Execution timeout
    max_retries: u32,                  // Max retry attempts
    retry_count: u32,                  // Current retry count
    dependencies: HashSet<TaskId>,     // Task IDs this depends on
    updated_at: DateTime,              // Last update time
}
```

## Message Protocol

TCP-based custom protocol with frame format:

```
┌──────────────────────────────────────────┐
│ 4-byte length (big-endian)              │
├──────────────────────────────────────────┤
│ 1-byte message type                     │
├──────────────────────────────────────────┤
│ Variable-length JSON payload            │
└──────────────────────────────────────────┘
```

### Message Types

- `SUBMIT_TASK` (1): Client submits new task
- `CLAIM_TASK` (2): Worker requests task
- `TASK_RESULT` (3): Worker returns task result/error
- `HEARTBEAT` (4): Worker health check
- `ACK` (5): Positive acknowledgment
- `NACK` (6): Negative acknowledgment
- `QUERY_STATUS` (7): Query task status
- `LIST_TASKS` (9): List tasks with filters

## Raft Clustering

For high availability, multiple brokers form a Raft cluster:

**Leader:**
- Accepts all write operations (task submissions)
- Replicates to followers
- Waits for majority acknowledgment

**Followers:**
- Accept read operations
- Redirect writes to leader
- Apply leader's log entries
- Participate in leader election

**Election:**
- Triggered when leader becomes unavailable
- Elected based on highest term number
- Majority quorum required
- Typical election time: 1-2 seconds

**Log Replication:**
- Each state change is a log entry
- Followers apply entries in order
- Snapshots for new nodes joining

## API Layer

### REST API (Axum)

- HTTP/JSON interface
- Async request handling
- Connection pooling
- CORS support
- OpenAPI documentation

### gRPC API (Tonic)

- High-performance RPC
- Binary protocol
- Streaming support
- Load balancing friendly

### Web UI

- Real-time dashboard
- WebSocket for live updates
- React/Vue frontend
- Metrics visualization

## Monitoring

### Metrics (Prometheus)

- Task counters (total, by status)
- Task gauges (pending, in-progress)
- Processing duration histograms
- Worker availability gauges
- Raft consensus metrics

### Structured Logging

- JSON output format
- Levels: TRACE, DEBUG, INFO, WARN, ERROR
- Context: task_id, worker_id, component
- Timestamps in ISO 8601

### Health Checks

- `/api/v1/health`: Broker health
- Indicators: leader status, quorum
- Worker connectivity status

## Scaling Characteristics

### Horizontal Scaling

- Add more workers for throughput
- Add more brokers for HA (with Raft)
- Load balancer in front of brokers

### Vertical Scaling

- Increase worker concurrency
- Adjust queue depth thresholds
- Tune RocksDB cache sizes

### Performance Targets

- **Single Broker**: 10,000 tasks/sec submission
- **Single Broker + 10 Workers**: 5,000 tasks/sec processing
- **3-Node Cluster**: 7,000 tasks/sec submission (due to replication)
- **Latency**: <10ms p99 submit, <100ms p99 assign, <500ms p99 e2e
