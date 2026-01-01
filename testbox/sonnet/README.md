# Distributed Task Queue System

A production-ready distributed task queue system written in Rust, similar to Celery/RQ but with better performance and reliability.

## Features

- **High Performance**: 10,000+ tasks/second on a single broker
- **Distributed**: Multiple workers can process tasks in parallel
- **Persistent**: RocksDB-backed storage with WAL for durability
- **Priority Queues**: Three-tier priority system (High, Normal, Low)
- **Fault Tolerant**: Automatic task retry with exponential backoff
- **Dead Letter Queue**: Failed tasks moved to DLQ after max retries
- **Worker Health Monitoring**: Automatic detection and handling of dead workers
- **REST & gRPC APIs**: Multiple interfaces for task management
- **Real-time Monitoring**: Prometheus metrics and WebSocket updates
- **High Availability**: Raft consensus for broker clustering (optional)

## Quick Start

### Building from Source

```bash
cargo build --release
```

### Running a Single Broker

```bash
# Start the broker
./target/release/tq-broker --config config.example.yaml

# In another terminal, start a worker
./target/release/tq-worker --broker 127.0.0.1:6379 --concurrency 4

# Submit a task using the admin CLI
echo "hello world" > /tmp/test.txt
./target/release/tq-admin submit --type echo --payload-file /tmp/test.txt --priority 150
```

### Using the Client Library

```rust
use task_queue_client::TaskQueueClient;
use task_queue_core::Priority;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = TaskQueueClient::connect("127.0.0.1:6379")?;

    let task_id = client.submit_task(
        "send_email",
        b"user@example.com".to_vec(),
        Priority::normal(),
    )?;

    println!("Task submitted: {}", task_id);

    // Wait for result
    let result = client.wait_for_result(task_id, std::time::Duration::from_secs(60))?;
    println!("Result: {:?}", result);

    Ok(())
}
```

## Architecture

### Components

1. **Broker** (`tq-broker`): Central coordinator that manages the task queue
2. **Worker** (`tq-worker`): Executes tasks claimed from the broker
3. **Client Library**: Submit tasks and query status
4. **Admin CLI** (`tq-admin`): Manage tasks and monitor the system

### Data Flow

```
Client → Submit Task → Broker → Queue (Priority-based)
                         ↓
Worker ← Claim Task ← Broker
   ↓
Execute Task
   ↓
Report Result → Broker → Store in RocksDB
```

### Persistence

Tasks are persisted to RocksDB with the following column families:
- `pending`: Tasks waiting to be processed
- `in_progress`: Tasks currently being executed
- `completed`: Successfully completed tasks (retained for 7 days)
- `failed`: Failed tasks (for retry tracking)
- `dead_letter`: Tasks that exhausted all retries

## Configuration

See `config.example.yaml` for a complete configuration example.

Key configuration options:

- **Broker Port**: Default 6379 (TCP protocol)
- **REST API Port**: Default 8080
- **Metrics Port**: Default 9091
- **Queue Depth Threshold**: Maximum pending tasks (default 100,000)
- **Heartbeat Interval**: Worker heartbeat frequency (default 15 seconds)
- **Task Retention**: How long to keep completed tasks (default 7 days)

## API Reference

### REST API

**POST /api/v1/tasks** - Submit a new task
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

**GET /api/v1/tasks/{task_id}** - Get task status
```bash
curl http://localhost:8080/api/v1/tasks/{task_id}
```

**GET /api/v1/stats** - Get system statistics
```bash
curl http://localhost:8080/api/v1/stats
```

**GET /api/v1/workers** - List active workers
```bash
curl http://localhost:8080/api/v1/workers
```

**GET /health** - Health check endpoint
```bash
curl http://localhost:8080/health
```

### Admin CLI

```bash
# Submit a task
tq-admin submit --type echo --payload-file data.txt --priority 200

# Check task status
tq-admin status <task-id>

# List tasks
tq-admin list --status pending --limit 50

# View system statistics
tq-admin stats

# List workers
tq-admin workers

# View queue depth
tq-admin queue-depth
```

## Monitoring

Prometheus metrics are exposed at `http://localhost:9091/metrics`:

- `tq_tasks_total` - Total tasks by status and type
- `tq_tasks_pending` - Current pending task count
- `tq_tasks_in_progress` - Current in-progress task count
- `tq_task_processing_duration_seconds` - Task processing time histogram
- `tq_workers_connected` - Number of connected workers
- `tq_broker_queue_depth` - Queue depth by priority

## Task Handlers

Workers execute tasks using registered handlers. Example handler:

```rust
use task_queue_worker::handler::{TaskHandler, TaskResult};
use async_trait::async_trait;

struct EmailHandler;

#[async_trait]
impl TaskHandler for EmailHandler {
    async fn execute(&self, payload: Vec<u8>) -> TaskResult {
        let email = String::from_utf8(payload)
            .map_err(|e| format!("Invalid email: {}", e))?;

        // Send email...
        send_email(&email).await?;

        Ok(b"Email sent".to_vec())
    }
}

// Register handler
registry.register("send_email".to_string(), EmailHandler);
```

## Performance

Single broker performance (tested on modern hardware):

- **Submission Rate**: 10,000+ tasks/second
- **Processing Rate**: 5,000+ tasks/second (10 workers)
- **Latency**: p99 < 10ms (task submission to acknowledgment)
- **Memory**: < 500MB with 100k pending tasks

## High Availability

Enable Raft clustering for high availability:

```yaml
raft:
  enabled: true
  node_id: node1
  peers:
    - node2:6379
    - node3:6379
  election_timeout_ms: 1000
  heartbeat_interval_ms: 300
```

Run multiple brokers (3 or 5 recommended) for automatic failover.

## Development

### Running Tests

```bash
# Unit tests
cargo test

# Integration tests (requires running broker)
cargo test --test integration -- --ignored

# All tests
cargo test --all
```

### Code Quality

```bash
# Format code
cargo fmt

# Run linter
cargo clippy

# Generate documentation
cargo doc --no-deps --open
```

## License

MIT

## Contributing

Contributions welcome! Please read CONTRIBUTING.md for guidelines.
