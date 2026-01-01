# Distributed Task Queue System

A production-ready distributed task queue system similar to Celery/RQ, written in Rust.

## Features

- **Distributed Task Execution**: Submit tasks from multiple clients, execute across a pool of workers
- **Priority System**: Three-tier priority system (High/Normal/Low) for task execution
- **Fault Tolerance**: Automatic retry with exponential backoff, dead letter queue for failed tasks
- **Persistence**: RocksDB-backed storage for durability
- **High Availability**: Raft consensus clustering for multi-node deployments
- **REST & gRPC APIs**: Both REST and gRPC interfaces for task submission and monitoring
- **Worker Health Monitoring**: Real-time worker health tracking and automatic failover
- **Web UI**: Real-time dashboard for monitoring and management
- **Observability**: Prometheus metrics and structured logging with tracing

## Quick Start

### Prerequisites

- Rust 1.70+ (stable channel)
- Tokio async runtime

### Building from Source

```bash
cargo build --release
```

### Running Single Broker

```bash
./target/release/tq-broker --host 0.0.0.0 --port 6379
```

### Running Worker

```bash
./target/release/tq-worker --broker-addr localhost:6379
```

### Using Admin CLI

```bash
./target/release/tq-admin submit --type send_email --payload-file email.json
./target/release/tq-admin status <task-id>
./target/release/tq-admin stats
```

## Architecture

### Core Components

1. **Broker** (`tq-broker`): Central coordinator managing task queue, worker registration, and task assignment
2. **Worker** (`tq-worker`): Task execution engine with pluggable handlers
3. **Client Library** (`task-queue-client`): Async/sync clients for programmatic task submission
4. **Admin CLI** (`tq-admin`): Command-line management interface
5. **REST API**: HTTP endpoint for task management
6. **gRPC API**: High-performance RPC interface
7. **Web UI**: Real-time dashboard

### Data Flow

```
Client → Broker → Worker Pool → Result → Client
         ↓
      Persistence (RocksDB)
```

### Task States

- **Pending**: Waiting to be claimed by a worker
- **InProgress**: Currently being processed
- **Completed**: Successfully finished
- **Failed**: Execution failed, eligible for retry
- **DeadLetter**: Exhausted retries

## API Reference

### REST API

#### Submit Task
```bash
POST /api/v1/tasks
Content-Type: application/json

{
  "task_type": "send_email",
  "payload": "base64-encoded-data",
  "priority": 150,
  "timeout_seconds": 300,
  "max_retries": 3
}
```

#### Get Task Status
```bash
GET /api/v1/tasks/{task_id}
```

#### Get Statistics
```bash
GET /api/v1/stats
```

#### Health Check
```bash
GET /api/v1/health
```

### Async Client Example

```rust
use task_queue_client::AsyncClient;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = AsyncClient::new("127.0.0.1:6379".to_string());

    let task = Task::new("send_email".to_string(), email_data);
    let task_id = client.submit_task(task).await?;

    let result = client.wait_for_result(task_id, Duration::from_secs(60)).await?;
    Ok(())
}
```

## Configuration

Configuration via YAML file or command-line flags:

```yaml
broker:
  host: 0.0.0.0
  port: 6379
  max_connections: 1000
  queue_depth_threshold: 100000

persistence:
  data_dir: ./data
  wal_sync_interval_ms: 100

worker:
  concurrency: 4
  heartbeat_interval_secs: 15
  graceful_shutdown_timeout_secs: 60

api:
  rest_port: 8080
  grpc_port: 9090
```

## Monitoring

### Prometheus Metrics

Available at `/metrics`:
- `tq_tasks_total`: Total tasks submitted
- `tq_tasks_pending`: Current pending tasks
- `tq_tasks_in_progress`: Current in-progress tasks
- `tq_task_processing_duration_seconds`: Task execution duration
- `tq_workers_connected`: Number of healthy workers

### Structured Logging

All events logged with tracing crate in JSON format:
```json
{
  "timestamp": "2024-01-01T12:00:00Z",
  "level": "INFO",
  "message": "Task completed",
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "duration_ms": 150
}
```

## Testing

### Run All Tests
```bash
cargo test --all
```

### Run with Coverage
```bash
cargo tarpaulin --out Html
```

### Property-Based Tests
```bash
cargo test --all --features property-test
```

## Performance Characteristics

- **Throughput**: 10,000+ tasks/sec (single broker)
- **Latency**: <10ms p99 submission, <100ms p99 assignment
- **Memory**: <500MB for 100k pending tasks
- **CPU**: <50% single core at 5k tasks/sec

## Contributing

All code must pass:
- `cargo clippy` - linting
- `cargo fmt` - formatting
- `cargo test` - testing (>80% coverage)

## License

MIT

## Support

- Documentation: See `docs/` directory
- Issues: GitHub issues
- Community: Discussions forum
