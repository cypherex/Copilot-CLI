# Architecture

## System Overview

The Distributed Task Queue System consists of several interconnected components:

```
┌─────────────────────────────────────────────────────────────┐
│                         Clients                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ REST API │  │  gRPC    │  │  Client  │  │  Admin   │   │
│  │          │  │          │  │  Library │  │   CLI    │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
└───────┼─────────────┼─────────────┼─────────────┼──────────┘
        │             │             │             │
        └─────────────┴─────────────┴─────────────┘
                         │
        ┌────────────────┴────────────────┐
        │         Broker Cluster          │
        │  ┌──────────────────────────┐   │
        │  │   Raft Consensus         │   │
        │  │   (Leader Election)      │   │
        │  └──────────────────────────┘   │
        │  ┌──────────┐  ┌──────────┐    │
        │  │ Broker 1 │  │ Broker 2 │    │
        │  │ (Leader) │  │(Follower)│    │
        │  └────┬─────┘  └────┬─────┘    │
        │       │             │           │
        │  ┌────┴─────────────┴─────┐    │
        │  │   Priority Queue        │    │
        │  │   RocksDB + WAL        │    │
        │  └────────────────────────┘    │
        └───────────┬────────────────────┘
                    │
        ┌───────────┴────────────┐
        │    Worker Pool         │
        │  ┌────────┐ ┌────────┐│
        │  │Worker 1│ │Worker 2││
        │  │  (4x)  │ │  (4x)  ││
        │  └────────┘ └────────┘│
        └────────────────────────┘
```

## Component Details

### 1. Broker (task-queue-broker)

**Responsibilities:**
- Accept task submissions from clients
- Maintain in-memory priority queue
- Assign tasks to workers
- Track worker health
- Persist all state changes
- Serve REST/gRPC APIs
- Expose metrics

**Key Modules:**
- `broker.rs` - Main broker logic
- `queue.rs` - Priority queue implementation
- `worker_registry.rs` - Worker health tracking
- `api/rest.rs` - REST API endpoints
- `metrics.rs` - Prometheus metrics

**Threading Model:**
- Main thread: TCP server (tokio)
- Background threads: Dead worker detection, cleanup, metrics
- Per-connection threads: Handle client requests

### 2. Persistence Layer (task-queue-persistence)

**RocksDB Schema:**

```
Column Family: pending
├── Key: task_id (16 bytes UUID)
└── Value: serialized Task struct

Column Family: in_progress
├── Key: task_id
└── Value: Task with worker_id and lease_expires_at

Column Family: completed
├── Key: task_id
└── Value: Task with result and completed_at

Column Family: failed
├── Key: task_id
└── Value: Task with error and retry_count

Column Family: dead_letter
├── Key: task_id
└── Value: Task that exhausted retries
```

**Write-Ahead Log:**
```
WAL Entry Format:
├── Sequence Number (8 bytes)
└── Entry Type (TaskSubmitted, TaskClaimed, etc.)
    └── Serialized event data
```

**Recovery Process:**
1. Open RocksDB and WAL
2. Replay uncommitted WAL entries
3. Move all in_progress tasks back to pending
4. Rebuild in-memory priority queue
5. Resume normal operation

### 3. Protocol Layer (task-queue-protocol)

**TCP Message Format:**
```
┌──────────────────────────────────────┐
│ Length (4 bytes, big-endian)        │
├──────────────────────────────────────┤
│ Message Type (1 byte)                │
├──────────────────────────────────────┤
│ Payload (bincode-encoded)            │
│ (variable length)                    │
└──────────────────────────────────────┘
```

**Message Types:**
```
1 = SUBMIT_TASK
2 = CLAIM_TASK
3 = TASK_RESULT
4 = HEARTBEAT
5 = ACK
6 = NACK
7 = QUERY_STATUS
```

### 4. Worker (task-queue-worker)

**Worker Lifecycle:**
```
Start
  ↓
Connect to Broker
  ↓
Register with unique ID
  ↓
┌─────────────────┐
│ Main Loop:      │
│ 1. Claim task   │←─────┐
│ 2. Execute      │      │
│ 3. Report result│      │
│ 4. Send heartbeat│     │
└─────────────────┘      │
         │               │
         └───────────────┘
         │
   Graceful Shutdown
         ↓
   Wait for active tasks
         ↓
        Exit
```

**Task Execution:**
```rust
async fn execute_task(task: Task) -> Result<Vec<u8>, String> {
    1. Get handler for task.task_type
    2. Set timeout = task.timeout_seconds
    3. Execute handler.execute(task.payload) with timeout
    4. Return result or error
}
```

### 5. Priority Queue

**Implementation:**
```
In-Memory (fast):
└── BinaryHeap<PrioritizedTask>
    ├── Ordering: priority DESC, created_at ASC
    └── HashMap<TaskId, Task> for O(1) lookup

Persistent (durable):
└── RocksDB "pending" column family
    └── Loaded on startup
```

**Priority Calculation:**
```
Task Priority (0-255):
├── High: 200-255
├── Normal: 100-199
└── Low: 0-99

Ordering:
1. Priority (higher first)
2. Created timestamp (earlier first) - FIFO within priority
```

## Data Flow

### Task Submission Flow
```
1. Client creates task
2. Client → TCP → Broker
3. Broker validates task
4. Broker → WAL (append TaskSubmitted)
5. Broker → RocksDB (write to "pending")
6. Broker → Priority Queue (push)
7. Broker → Client (ACK with task_id)
```

### Task Execution Flow
```
1. Worker → Broker (CLAIM_TASK)
2. Broker pops from Priority Queue
3. Broker → WAL (append TaskClaimed)
4. Broker moves task: pending → in_progress
5. Broker → Worker (ACK with task)
6. Worker executes task
7. Worker → Broker (TASK_RESULT)
8. Broker → WAL (append TaskCompleted/Failed)
9. Broker moves task: in_progress → completed/failed
10. Broker → Worker (ACK)
```

### Worker Heartbeat Flow
```
Every 15 seconds:
1. Worker collects system stats (CPU, memory)
2. Worker → Broker (HEARTBEAT)
3. Broker updates worker registry
4. Broker → Worker (ACK)

Background check (every 10 seconds):
1. Broker checks for workers with no heartbeat > 30s
2. Broker marks workers as dead
3. Broker gets all tasks from dead workers
4. Broker moves tasks: in_progress → pending
5. Broker removes dead workers from registry
```

## Concurrency & Thread Safety

### Broker Concurrency
- **TCP Server**: Tokio runtime handles connections
- **Priority Queue**: RwLock for concurrent access
- **Worker Registry**: RwLock for concurrent access
- **RocksDB**: Built-in concurrency control

### Worker Concurrency
- **Main loop**: Single task (claim, heartbeat)
- **Task execution**: Tokio tasks (configurable concurrency)
- **System stats**: Shared atomic counters

### Synchronization Points
- WAL writes are serialized (RocksDB ensures this)
- Queue operations use RwLock (multiple readers, single writer)
- Worker registry uses RwLock

## Failure Scenarios

### Worker Failure
```
Worker crashes mid-task
    ↓
Heartbeat timeout (30s)
    ↓
Broker detects dead worker
    ↓
Broker reclaims task
    ↓
Task moved to pending
    ↓
Retry count NOT incremented (worker failure, not task failure)
```

### Broker Failure (No Raft)
```
Broker crashes
    ↓
All data in RocksDB
    ↓
Restart broker
    ↓
Load from RocksDB
    ↓
Replay WAL
    ↓
Move in_progress → pending
    ↓
Resume operation
```

### Broker Failure (With Raft)
```
Leader crashes
    ↓
Followers detect (election timeout)
    ↓
New leader elected
    ↓
Clients redirect to new leader
    ↓
Operations continue
```

### Task Failure
```
Task execution fails
    ↓
Worker reports error
    ↓
Broker increments retry_count
    ↓
if retry_count < max_retries:
    Schedule retry (exponential backoff)
    Move to pending with future scheduled_at
else:
    Move to dead_letter
```

## Performance Considerations

### Bottlenecks
1. **RocksDB writes**: Mitigated by WAL batching
2. **Priority queue pop**: O(log n), optimized with heap
3. **Network I/O**: Async I/O with tokio
4. **Serialization**: bincode is fast

### Optimizations
1. **Batch WAL writes**: Sync every 100ms
2. **Connection pooling**: Reuse TCP connections
3. **Zero-copy**: Minimize allocations in hot paths
4. **Lock-free reads**: Use RwLock for concurrent reads

### Scalability
- **Vertical**: Add more workers to single broker
- **Horizontal**: Add more broker nodes (requires Raft)
- **Partitioning**: Shard by task_type (future)

## Monitoring

### Metrics Collected
```
tq_tasks_total{status, task_type} - Counter
tq_tasks_pending - Gauge
tq_tasks_in_progress - Gauge
tq_task_processing_duration_seconds{task_type} - Histogram
tq_workers_connected - Gauge
tq_broker_queue_depth{priority} - Gauge
tq_raft_term - Gauge
tq_raft_leader - Gauge
```

### Logging Levels
```
ERROR: System failures, data loss
WARN: Retries, slow tasks, high queue depth
INFO: Task lifecycle, worker events, Raft changes
DEBUG: Heartbeats, state transitions
TRACE: All messages
```

## Security Model (Future)

### Authentication
```
Client → API Key → Broker
    ↓
Broker validates key (bcrypt)
    ↓
Check permissions
    ↓
Allow/Deny
```

### TLS
```
Client → TLS Handshake → Broker
    ↓
Encrypted channel
    ↓
All messages encrypted
```

### Rate Limiting
```
Token bucket per API key:
├── Rate: 100 req/sec
├── Burst: 200
└── Reject with 429 if exceeded
```

## Configuration

### Broker Configuration
```yaml
broker:
  port: 6379
  max_connections: 1000
  queue_depth_threshold: 100000

persistence:
  data_dir: ./data
  wal_sync_interval_ms: 100
  retention_days: 7

raft:
  enabled: true
  node_id: node1
  peers: [node2:6379, node3:6379]
```

### Worker Configuration
```yaml
broker_address: 127.0.0.1:6379
concurrency: 4
heartbeat_interval_secs: 15
graceful_shutdown_timeout_secs: 60
```

## Future Enhancements

1. **Task Dependencies**: Wait for other tasks to complete
2. **Scheduled Tasks**: Cron-like recurring tasks
3. **Task Chains**: Automatically submit follow-up tasks
4. **Priority Escalation**: Increase priority over time
5. **Result Callbacks**: HTTP callbacks on completion
6. **Multi-tenancy**: Isolate tasks by tenant
7. **Geographic Distribution**: Cross-region replication
