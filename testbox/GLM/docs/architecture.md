# Task Queue Architecture

## System Overview

The Task Queue system is designed as a distributed, fault-tolerant task execution platform inspired by Celery and RQ. It consists of several components working together:

1. **Core Library** - Shared data structures and protocols
2. **Broker** - Central coordinator that manages task queues and worker coordination
3. **Worker** - Process that executes tasks
4. **Client Library** - APIs for submitting and monitoring tasks
5. **Admin CLI** - Command-line interface for administration
6. **API Server** - REST and gRPC interfaces
7. **Raft Cluster** - High availability through consensus

## Component Details

### 1. Core Library (`task-queue-core`)

The core library provides the foundational types and protocols used throughout the system.

#### Key Components:

**Task Definition:**
```rust
pub struct Task {
    pub id: TaskId,                    // UUID v4
    pub task_type: TaskType,           // Handler identifier
    pub payload: Vec<u8>,              // Up to 10MB
    pub priority: TaskPriority,         // 0-255
    pub status: TaskStatus,            // Current lifecycle state
    // ... additional fields
}
```

**Priority System:**
- High: 200-255 (highest priority)
- Normal: 100-199
- Low: 0-99

**Protocol:**
- Custom TCP-based protocol with length-prefixed frames
- Frame format: `[4-byte length][1-byte type][payload]`
- Message types for all operations

**Task Lifecycle:**
```
Pending → In Progress → Completed
   ↓                           ↑
   └→ Failed → Dead Letter ←─┘
```

### 2. Broker (`task-queue-broker`)

The broker is the central component that coordinates task distribution and execution.

#### Responsibilities:

1. **Task Queue Management:**
   - Maintains in-memory priority queue
   - Stores all tasks in RocksDB
   - Implements write-ahead logging (WAL)

2. **Worker Coordination:**
   - Tracks worker registration/deregistration
   - Manages task claiming with lease mechanism
   - Monitors worker health via heartbeats

3. **State Persistence:**
   - Column families: pending, in_progress, completed, failed, dead_letter
   - Indexes: task_id, task_type, priority, scheduled_time
   - Automatic compaction of old completed tasks

4. **API Server:**
   - REST API on port 8080
   - gRPC API on port 9090
   - Prometheus metrics on port 9091

5. **Raft Clustering:**
   - Leader election for high availability
   - Log replication to followers
   - Automatic failover

#### Data Flow:

**Task Submission:**
```
Client → Broker → Store in RocksDB → Acknowledge
```

**Task Claiming:**
```
Worker → Broker → Priority Queue → Assign Task → Update State
```

**Task Completion:**
```
Worker → Broker → Update Task Status → Store Result → Notify Client
```

### 3. Worker (`task-queue-worker`)

Workers execute tasks using registered handlers.

#### Architecture:

```
┌─────────────────────────────────────┐
│          Worker Process             │
│                                     │
│  ┌───────────────────────────────┐  │
│  │   Connection Manager          │  │
│  │   (Broker Client)            │  │
│  └───────────────┬───────────────┘  │
│                  │                   │
│  ┌───────────────▼───────────────┐  │
│  │   Task Processors (N)        │  │
│  │   - Claim Task               │  │
│  │   - Execute Handler          │  │
│  │   - Send Result              │  │
│  └───────────────┬───────────────┘  │
│                  │                   │
│  ┌───────────────▼───────────────┐  │
│  │   Handler Registry            │  │
│  │   - echo                     │  │
│  │   - sleep                    │  │
│  │   - compute                  │  │
│  │   - fail (test)              │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │   Heartbeat Task             │  │
│  │   - Every 15 seconds        │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

#### Worker Behavior:

1. **Registration:**
   - Unique ID: hostname-PID-random
   - Registers with broker on startup
   - Deregisters on graceful shutdown

2. **Task Execution:**
   - Claims tasks from broker
   - Executes with timeout enforcement
   - Captures panics as failures
   - Returns results/errors to broker

3. **Health Monitoring:**
   - Sends heartbeat every 15 seconds
   - Reports CPU usage, memory usage, task count
   - Broker reclaims tasks if 2 heartbeats missed

4. **Graceful Shutdown:**
   - Stops claiming new tasks
   - Waits up to 60s for in-progress tasks
   - Deregisters from broker

### 4. Client Library (`task-queue-client`)

Provides both blocking and async APIs for interacting with the task queue.

#### Blocking Client:
```rust
let client = TaskQueueClient::connect("127.0.0.1:6379")?;
let task_id = client.submit_task("email", payload, Priority::Normal)?;
let result = client.wait_for_result(task_id, Duration::from_secs(60))?;
```

#### Async Client:
```rust
let mut client = TaskQueueAsyncClient::connect("127.0.0.1:6379").await?;
let task_id = client.submit_task("email", payload, Priority::Normal).await?;

// Stream updates
client.stream_task_updates(task_id, |task| {
    println!("Status: {:?}", task.status);
    true  // Continue streaming
}).await?;
```

### 5. Raft Clustering

#### Raft Implementation Details:

**Node States:**
- **Leader:** Accepts all writes, replicates to followers
- **Follower:** Receives replicated logs, serves reads
- **Candidate:** Contender in leader election

**Key Parameters:**
- Election timeout: 1000ms
- Heartbeat interval: 300ms
- Snapshot interval: 10000ms

**Data Replication:**
1. Client sends write to leader
2. Leader appends to local log
3. Leader replicates to followers
4. Waits for majority acknowledgment
5. Commits entry and responds to client

**Failover:**
1. Followers detect leader failure (timeout)
2. Start election: request votes from others
3. Candidate with majority votes becomes leader
4. New leader commits any uncommitted entries

### 6. Storage Layer

#### RocksDB Schema:

**Column Families:**

| CF Name | Purpose | Key | Value |
|---------|---------|-----|-------|
| `pending` | Pending tasks | task_id (UUID) | Task (binary) |
| `in_progress` | Tasks being executed | task_id (UUID) | Task (binary) |
| `completed` | Successfully completed | task_id (UUID) | Task (binary) |
| `failed` | Failed tasks (retriable) | task_id (UUID) | Task (binary) |
| `dead_letter` | Exhausted retries | task_id (UUID) | Task (binary) |
| `metadata` | System metadata | metadata_key | metadata_value |

**Write-Ahead Logging:**
- All state changes logged before application
- Provides durability across restarts
- Used for Raft log replication

**Compaction:**
- Completed tasks older than retention period deleted
- Reduces storage overhead
- Runs automatically every hour

### 7. Monitoring & Observability

#### Prometheus Metrics:

**Counters:**
- `tq_tasks_total{status,task_type}` - Total tasks processed
- `tq_task_retry_count{task_type}` - Retry attempts

**Gauges:**
- `tq_tasks_pending` - Pending task count
- `tq_tasks_in_progress` - In-progress count
- `tq_workers_connected` - Active workers
- `tq_broker_queue_depth{priority}` - Queue depth

**Histograms:**
- `tq_task_processing_duration_seconds{task_type}` - Processing time

**Raft Metrics:**
- `tq_raft_term` - Current Raft term
- `tq_raft_leader` - Leadership status (1 or 0)

#### Structured Logging:

Log format (JSON):
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "level": "INFO",
  "message": "Task submitted",
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "task_type": "send_email",
  "component": "broker"
}
```

**Log Levels:**
- ERROR: Failures, worker deaths, election failures
- WARN: Retries, slow tasks, high queue depth
- INFO: Task lifecycle events, registration
- DEBUG: Heartbeats, state transitions
- TRACE: Network messages

### 8. Security

#### Authentication:

**API Keys:**
- Bcrypt hashed in config
- Permissions per key: submit_tasks, read_tasks, cancel_tasks, admin
- Passed via `Authorization: Bearer <key>` header

#### TLS:

**Configuration:**
```yaml
api:
  enable_tls: true
  tls_cert_path: /path/to/cert.pem
  tls_key_path: /path/to/key.pem
```

- All TCP connections encrypted
- Certificate verification configurable

#### Rate Limiting:

**Token Bucket Algorithm:**
- 100 requests/second per API key default
- Returns 429 with `Retry-After` header
- Burst capacity: 2x sustained rate

## Data Flow Diagrams

### Complete Task Lifecycle:

```
┌──────────┐     Submit      ┌──────────┐
│  Client  │ ─────────────► │  Broker  │
└──────────┘                 └────┬─────┘
                                 │ Store
                                 ▼
                           ┌───────────┐
                           │  RocksDB  │
                           └───────────┘
                                 │
                     ┌───────────┴───────────┐
                     │                       │
                     ▼                       ▼
              ┌──────────┐            ┌──────────┐
              │ Worker 1 │            │ Worker 2 │
              └────┬─────┘            └────┬─────┘
                   │                       │
                   Claim                  Claim
                   │                       │
                   ▼                       ▼
              Execute                Execute
                   │                       │
                   ▼                       ▼
              Result                 Result
                   │                       │
                   └───────────┬───────────┘
                               ▼
                        ┌──────────┐
                        │  Broker  │
                        └────┬─────┘
                             │ Update
                             ▼
                       ┌───────────┐
                       │  RocksDB  │
                       └───────────┘
                             │
                             │ Notify
                             ▼
                        ┌──────────┐
                        │  Client  │
                        └──────────┘
```

### Clustered Setup:

```
                         Client
                           │
                           ├──────────────────────────┐
                           │                          │
                    Write Only                   Read Only
                           │                          │
                    ┌──────▼──────┐         ┌──────▼──────┐
                    │  Leader    │◄────────┤  Follower  │
                    │   Node 1   │         │   Node 2   │
                    └──────┬──────┘         └─────────────┘
                    Raft Log                Raft Log
                    Replication              (Read-only)
                           │
                    ┌──────▼──────┐
                    │  Follower   │
                    │   Node 3   │
                    └─────────────┘
```

## Performance Considerations

### Broker Optimizations:

1. **In-Memory Priority Queue:**
   - Fast task assignment
   - Sorted by priority + creation time
   - Backed by RocksDB for persistence

2. **Connection Pooling:**
   - Reuse connections
   - Reduces overhead
   - Configurable pool size

3. **Batch Writes:**
   - Aggregate multiple operations
   - Reduce RocksDB write amplification
   - WAL sync interval: 100ms

4. **Async Processing:**
   - Non-blocking I/O with tokio
   - Concurrent connection handling
   - Background task processing

### Worker Optimizations:

1. **Concurrency:**
   - Multiple task processors per worker
   - Configurable (default: 4)
   - Semaphore-controlled

2. **Task Timeout:**
   - Per-task timeout enforcement
   - Prevents runaway tasks
   - Kills hung tasks

3. **Efficient Serialization:**
   - Bincode for compact encoding
   - Minimal allocation
   - Fast (de)serialization

### Storage Optimizations:

1. **Column Families:**
   - Separate hot/cold data
   - Targeted compaction
   - Efficient range scans

2. **Write-Ahead Log:**
   - Durable before acknowledgment
   - Fast recovery
   - Minimal overhead

3. **Indexing:**
   - task_id: Primary lookup
   - task_type: Type-based queries
   - priority: Priority queue ordering
   - scheduled_time: Time-based queries

## Failure Scenarios

### Worker Failure:

1. **Worker Crash:**
   - Heartbeats stop
   - Broker detects after 30s
   - Tasks reclaimed and requeued
   - No data loss

2. **Task Timeout:**
   - Worker kills hung task
   - Returns error to broker
   - Task retried with backoff
   - Eventually to dead letter

### Broker Failure:

1. **Leader Crash (Clustered):**
   - Followers detect timeout
   - New leader elected (1-2s)
   - Uncommitted logs from old leader
   - New leader replicates committed

2. **Broker Restart (Single):**
   - Loads tasks from RocksDB
   - Reclaims in-progress tasks
   - Workers reconnect
   - Minimal downtime

### Network Partition:

1. **Minority Partition:**
   - Nodes become followers
   - Reject writes
   - Continue serving reads
   - Rejoin on network recovery

2. **Majority Partition:**
   - Continues as cluster
   - Elects new leader if needed
   - Handles client requests
   - Reintegrates on recovery

## Scaling Considerations

### Horizontal Scaling:

**Workers:**
- Add more workers for more throughput
- Each worker processes N concurrent tasks
- Workers are stateless

**Brokers:**
- Cluster for high availability
- Read scalability with followers
- Write limited by leader

### Vertical Scaling:

**Broker:**
- More memory for larger queues
- Faster CPU for more connections
- SSD for RocksDB storage

**Worker:**
- More concurrency per worker
- Faster task execution
- More memory per task

### Bottlenecks:

1. **Broker CPU:**
   - Too many connections
   - Solution: Connection pooling, more brokers

2. **RocksDB I/O:**
   - High write throughput
   - Solution: Faster storage, WAL tuning

3. **Network:**
   - High latency between components
   - Solution: Co-locate, faster network

## Future Enhancements

1. **Distributed Tracing:**
   - OpenTelemetry integration
   - End-to-end trace correlation
   - Performance profiling

2. **Task Dependencies:**
   - DAG-based workflows
   - Conditional execution
   - Parallel execution of independent tasks

3. **Scheduled Tasks:**
   - Cron-like scheduling
   - Recurring tasks
   - Time zones support

4. **Web UI:**
   - Real-time dashboard
   - Task visualization
   - Worker monitoring

5. **Plugin System:**
   - Dynamic handler loading
   - WASM-based handlers
   - Language-agnostic plugins
