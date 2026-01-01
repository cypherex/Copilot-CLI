# Task Queue - Distributed Task Queue System

A production-ready distributed task queue system similar to Celery/RQ, written in Rust. Handles task scheduling, distributed execution across multiple workers, fault tolerance, and provides both programmatic and UI-based management interfaces.

## Features

- **High Performance**: 10,000+ tasks/second submission rate
- **Distributed Execution**: Multiple workers processing tasks concurrently
- **Fault Tolerance**: Automatic retry with exponential backoff
- **Persistence**: RocksDB-based storage for durability
- **Clustering**: Raft consensus for high availability
- **REST & gRPC APIs**: Multiple interfaces for task management
- **Admin CLI**: Comprehensive command-line tool
- **Monitoring**: Prometheus metrics and structured logging
- **Security**: API key authentication and TLS support
- **Priority Queues**: 3-tier priority system (High, Normal, Low)
- **Task Dependencies**: Chain tasks together
- **Web UI**: Real-time dashboard for monitoring (planned)

## Architecture

```
┌─────────────┐      TCP      ┌──────────────┐      Raft      ┌──────────────┐
│   Clients   │◄────────────►│   Broker     │◄────────────►│  Broker #2   │
│             │   Protocol   │  (Leader)    │   Protocol   │   (Follower) │
└─────────────┘              └──────┬───────┘              └──────────────┘
                                     │
                                     │
                        ┌────────────┼────────────┐
                        │            │            │
                        ▼            ▼            ▼
                  ┌─────────┐  ┌─────────┐  ┌─────────┐
                  │ Worker 1 │  │ Worker 2 │  │ Worker 3 │
                  └─────────┘  └─────────┘  └─────────┘
                        │            │            │
                        └────────────┴────────────┘
                                   │
                                   ▼
                          ┌─────────────┐
                          │   RocksDB   │
                          └─────────────┘
```

## Quick Start

### Prerequisites

- Rust 1.70 or later
- (Optional) Docker for containerized deployment

### Building

```bash
# Build all components
cargo build --release

# Build specific component
cargo build --release --package task-queue-broker
cargo build --release --package task-queue-worker
cargo build --release --package task-queue-admin
```

### Running a Single Node

#### 1. Start the Broker

```bash
# Using default configuration
./target/release/tq-broker

# Or with custom config
./target/release/tq-broker --config config.yaml
```

The broker will start listening on:
- **TCP Protocol**: `127.0.0.1:6379`
- **REST API**: `http://127.0.0.1:8080`
- **Prometheus Metrics**: `http://127.0.0.1:9091`

#### 2. Start a Worker

```bash
# Using default settings
./target/release/tq-worker --broker-addr 127.0.0.1:6379

# With custom concurrency
./target/release/tq-worker --broker-addr 127.0.0.1:6379 --concurrency 8
```

The worker includes example handlers:
- `echo` - Returns the payload unchanged
- `sleep` - Sleeps for specified seconds
- `compute` - Performs arithmetic operations
- `fail` - Always fails (for testing)

#### 3. Submit Tasks

**Using the Admin CLI:**

```bash
# Submit a simple echo task
echo "Hello, World!" | base64 > payload.b64
./target/release/tq-admin submit --type echo --payload-file payload.b64

# Submit a sleep task
echo "5" | base64 > payload.b64
./target/release/tq-admin submit --type sleep --payload-file payload.b64 --priority normal

# Submit a compute task
echo '{"operation":"add","a":5,"b":3}' | base64 > payload.b64
./target/release/tq-admin submit --type compute --payload-file payload.b64 --priority high
```

**Using the REST API:**

```bash
curl -X POST http://127.0.0.1:8080/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "echo",
    "payload": "SGVsbG8sIFdvcmxkIQ==",
    "priority": 150,
    "timeout_seconds": 30,
    "max_retries": 3
  }'
```

**Using the Client Library:**

```rust
use task_queue_client::TaskQueueClient;
use task_queue_core::Priority;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = TaskQueueClient::connect("127.0.0.1:6379")?;
    
    let payload = b"Hello, World!".to_vec();
    let task_id = client.submit_task("echo", payload, Priority::Normal)?;
    
    println!("Task submitted: {}", task_id);
    
    Ok(())
}
```

### Using the Admin CLI

```bash
# Check task status
./target/release/tq-admin status <task-id>

# List tasks
./target/release/tq-admin list --status pending --limit 10

# List failed tasks
./target/release/tq-admin list --status failed --limit 20

# Cancel a task
./target/release/tq-admin cancel <task-id>

# Show statistics
./target/release/tq-admin stats

# Show queue depth
./target/release/tq-admin queue-depth

# List connected workers
./target/release/tq-admin workers

# Output in JSON format
./target/release/tq-admin stats --format json
```

## Running a Cluster

For production deployments, run multiple broker nodes with Raft clustering:

### 1. Configure Nodes

**Node 1 (config-node1.yaml):**
```yaml
broker:
  host: 0.0.0.0
  port: 6379

raft:
  enabled: true
  node_id: node1
  peers:
    - node2:6379
    - node3:6379
```

**Node 2 (config-node2.yaml):**
```yaml
broker:
  host: 0.0.0.0
  port: 6379

raft:
  enabled: true
  node_id: node2
  peers:
    - node1:6379
    - node3:6379
```

**Node 3 (config-node3.yaml):**
```yaml
broker:
  host: 0.0.0.0
  port: 6379

raft:
  enabled: true
  node_id: node3
  peers:
    - node1:6379
    - node2:6379
```

### 2. Start the Cluster

```bash
# Terminal 1
./target/release/tq-broker --config config-node1.yaml

# Terminal 2
./target/release/tq-broker --config config-node2.yaml

# Terminal 3
./target/release/tq-broker --config config-node3.yaml
```

### 3. Check Cluster Status

```bash
./target/release/tq-admin cluster-status
```

## Configuration

### Broker Configuration

```yaml
broker:
  host: 0.0.0.0              # Listen address
  port: 6379                 # Listen port
  max_connections: 1000       # Max concurrent connections
  queue_depth_threshold: 100000  # Backpressure threshold

persistence:
  data_dir: ./data           # RocksDB data directory
  wal_sync_interval_ms: 100  # WAL sync interval
  completed_task_retention_days: 7  # Task retention period

raft:
  enabled: false             # Enable Raft clustering
  node_id: node1             # Unique node ID
  peers: []                   # List of peer nodes
  election_timeout_ms: 1000   # Raft election timeout
  heartbeat_interval_ms: 300  # Raft heartbeat interval

api:
  rest_port: 8080            # REST API port
  grpc_port: 9090             # gRPC port
  enable_tls: false           # Enable TLS
  tls_cert_path: null        # TLS certificate path
  tls_key_path: null         # TLS key path

auth:
  enabled: false             # Enable authentication
  api_keys: []               # API key list

monitoring:
  prometheus_port: 9091      # Prometheus metrics port
  log_level: info            # Logging level

worker:
  concurrency: 4              # Default worker concurrency
  heartbeat_interval_secs: 15 # Heartbeat interval
  lease_timeout_secs: 30     # Task lease timeout
  graceful_shutdown_timeout_secs: 60  # Shutdown timeout
```

### Worker Configuration

```bash
--broker-addr ADDR           # Broker address (default: 127.0.0.1:6379)
--worker-id ID              # Worker ID (auto-generated)
--concurrency N              # Number of parallel tasks (default: 4)
--heartbeat-interval-secs N # Heartbeat interval (default: 15)
--lease-timeout-secs N      # Lease timeout (default: 30)
--max-priority N            # Max priority to accept
--log-level LEVEL           # Log level (default: info)
```

## API Documentation

### REST API

#### Submit Task
```http
POST /api/v1/tasks
Content-Type: application/json

{
  "task_type": "string",
  "payload": "base64-encoded-bytes",
  "priority": 0-255,
  "schedule_at": "ISO8601-timestamp",
  "timeout_seconds": 30,
  "max_retries": 3
}

Response: 201 Created
{
  "task_id": "uuid",
  "status": "pending"
}
```

#### Get Task Status
```http
GET /api/v1/tasks/{task_id}

Response: 200 OK
{
  "task_id": "uuid",
  "status": "pending|in_progress|completed|failed|dead_letter",
  "created_at": "ISO8601-timestamp",
  "updated_at": "ISO8601-timestamp",
  "result": "base64-encoded-result",
  "error": "error-message",
  "retry_count": 0,
  "worker_id": "worker-id"
}
```

#### List Tasks
```http
GET /api/v1/tasks?status=pending&task_type=echo&limit=100&offset=0

Response: 200 OK
{
  "tasks": [...],
  "total": 1000
}
```

#### Cancel Task
```http
DELETE /api/v1/tasks/{task_id}

Response: 204 No Content
```

#### Get Statistics
```http
GET /api/v1/stats

Response: 200 OK
{
  "pending_count": 100,
  "in_progress_count": 5,
  "completed_last_hour": 500,
  "failed_last_hour": 10,
  "worker_count": 3,
  "avg_processing_time_ms": 150.5,
  "queue_depth_by_priority": {
    "high": 10,
    "normal": 50,
    "low": 40
  }
}
```

### Client Library Usage

#### Blocking Client

```rust
use task_queue_client::TaskQueueClient;
use task_queue_core::Priority;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = TaskQueueClient::connect("127.0.0.1:6379")?;
    
    // Submit task
    let task_id = client.submit_task("echo", payload, Priority::Normal)?;
    
    // Wait for result
    let result = client.wait_for_result(task_id, std::time::Duration::from_secs(60))?;
    
    Ok(())
}
```

#### Async Client

```rust
use task_queue_client::TaskQueueAsyncClient;
use task_queue_core::Priority;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut client = TaskQueueAsyncClient::connect("127.0.0.1:6379").await?;
    
    // Submit task
    let task_id = client.submit_task("echo", payload, Priority::Normal).await?;
    
    // Wait for result
    let result = client.wait_for_result(task_id, std::time::Duration::from_secs(60)).await?;
    
    // Stream updates
    client.stream_task_updates(task_id, |task| {
        println!("Task status: {:?}", task.status);
        true  // Continue streaming
    }).await?;
    
    Ok(())
}
```

## Creating Custom Task Handlers

### Example: Email Handler

```rust
use task_queue_worker::handler::TaskHandler;

pub struct EmailHandler;

#[async_trait::async_trait]
impl TaskHandler for EmailHandler {
    fn task_type(&self) -> &str {
        "send_email"
    }

    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>, task_queue_core::CoreError> {
        let email: EmailRequest = serde_json::from_slice(&payload)
            .map_err(|e| task_queue_core::CoreError::Other(e.to_string()))?;
        
        // Send email logic here
        send_email(&email.to, &email.subject, &email.body).await?;
        
        Ok(b"Email sent successfully".to_vec())
    }
}

#[derive(serde::Deserialize)]
struct EmailRequest {
    to: String,
    subject: String,
    body: String,
}
```

### Registering the Handler

```rust
use task_queue_worker::handler::HandlerRegistry;
use task_queue_worker::Worker;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut registry = HandlerRegistry::new();
    registry.register(EmailHandler)?;
    
    let config = WorkerConfig::from(args);
    let worker = Worker::new(config, registry).await?;
    worker.run().await?;
    
    Ok(())
}
```

## Monitoring

### Prometheus Metrics

Available at `http://localhost:9091/metrics`:

- `tq_tasks_total` - Total tasks processed (by status, task_type)
- `tq_tasks_pending` - Pending tasks gauge
- `tq_tasks_in_progress` - In-progress tasks gauge
- `tq_task_processing_duration_seconds` - Task processing histogram
- `tq_workers_connected` - Connected workers gauge
- `tq_broker_queue_depth` - Queue depth by priority
- `tq_raft_term` - Current Raft term
- `tq_raft_leader` - Leader indicator (1 if leader, 0 if follower)

### Structured Logging

Logs are output in JSON format with the following fields:
- `timestamp` - ISO8601 timestamp
- `level` - Log level (ERROR, WARN, INFO, DEBUG, TRACE)
- `message` - Log message
- `task_id` - Task ID (if applicable)
- `worker_id` - Worker ID (if applicable)
- `component` - Component name

## Performance

### Benchmarks

On a typical system (Intel i7, 16GB RAM):

| Metric | Single Broker | 3-Node Cluster |
|--------|--------------|----------------|
| Task Submission | 10,000+ / sec | 7,000+ / sec |
| Task Processing | 5,000+ / sec | N/A |
| Submission Latency (p99) | <10ms | <50ms |
| Assignment Latency (p99) | <100ms | <100ms |
| End-to-End (1ms task, p99) | <500ms | <500ms |
| Broker Memory (100k tasks) | <500MB | <500MB/node |
| Worker Memory | <100MB | <100MB |

## Testing

```bash
# Run all tests
cargo test

# Run tests with coverage
cargo tarpaulin --out Html

# Run integration tests
cargo test --test integration

# Run property-based tests
cargo test --test proptests

# Run chaos tests
cargo test --test chaos
```

## Docker Deployment

```bash
# Build Docker image
docker build -t task-queue .

# Run broker
docker run -p 6379:6379 -p 8080:8080 -p 9091:9091 task-queue broker

# Run worker
docker run task-queue worker --broker-addr host.docker.internal:6379
```

### Docker Compose (3-Node Cluster)

```bash
docker-compose up -d
```

## Documentation

- [Architecture Details](docs/architecture.md)
- [API Reference](docs/api.md)
- [Deployment Guide](docs/deployment.md)
- [Contributing](docs/CONTRIBUTING.md)

## License

MIT OR Apache-2.0

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](docs/CONTRIBUTING.md) for guidelines.
