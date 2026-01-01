# Deployment Guide

## Single Broker Deployment

### Local Development

1. **Build the project:**
```bash
cargo build --release
```

2. **Run broker:**
```bash
./target/release/tq-broker --host 127.0.0.1 --port 6379
```

3. **Run worker:**
```bash
./target/release/tq-worker --broker-addr 127.0.0.1:6379
```

4. **Submit tasks:**
```bash
./target/release/tq-admin submit --type test --payload-file data.json
```

### Docker Deployment

**Dockerfile:**
```dockerfile
FROM rust:1.70 as builder
WORKDIR /build
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y libssl3
COPY --from=builder /build/target/release/tq-broker /usr/local/bin/
EXPOSE 6379 8080 9090
CMD ["tq-broker", "--host", "0.0.0.0"]
```

**Docker Compose for single broker:**
```yaml
version: '3.8'
services:
  broker:
    build: .
    ports:
      - "6379:6379"
      - "8080:8080"
      - "9090:9090"
    volumes:
      - broker_data:/data
    environment:
      - RUST_LOG=info

  worker:
    build: .
    command: tq-worker --broker-addr broker:6379
    depends_on:
      - broker
    environment:
      - RUST_LOG=info
    deploy:
      replicas: 3

  prometheus:
    image: prom/prometheus
    ports:
      - "9091:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'

volumes:
  broker_data:
```

## High-Availability Cluster Deployment

### 3-Node Raft Cluster

**Configuration for Node 1:**
```yaml
broker:
  host: 0.0.0.0
  port: 6379
  max_connections: 1000

raft:
  enabled: true
  node_id: node1
  peers:
    - node2:6379
    - node3:6379
  election_timeout_ms: 1000
  heartbeat_interval_ms: 300

persistence:
  data_dir: /data/node1
```

**Docker Compose for 3-node cluster:**
```yaml
version: '3.8'
services:
  broker-1:
    build: .
    ports:
      - "6379:6379"
      - "8080:8080"
    volumes:
      - ./config-node1.yml:/config.yml
      - broker1_data:/data
    environment:
      - RUST_LOG=info
    command: tq-broker --config /config.yml

  broker-2:
    build: .
    ports:
      - "6380:6379"
      - "8081:8080"
    volumes:
      - ./config-node2.yml:/config.yml
      - broker2_data:/data
    environment:
      - RUST_LOG=info
    command: tq-broker --config /config.yml
    depends_on:
      - broker-1

  broker-3:
    build: .
    ports:
      - "6381:6379"
      - "8082:8080"
    volumes:
      - ./config-node3.yml:/config.yml
      - broker3_data:/data
    environment:
      - RUST_LOG=info
    command: tq-broker --config /config.yml
    depends_on:
      - broker-1

  load-balancer:
    image: haproxy:2.8
    ports:
      - "6379:6379"
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    depends_on:
      - broker-1
      - broker-2
      - broker-3

volumes:
  broker1_data:
  broker2_data:
  broker3_data:
```

**HAProxy Configuration (haproxy.cfg):**
```
global
    log stdout local0
    log stdout local1 notice

defaults
    log     global
    mode    tcp
    timeout connect 5000
    timeout client  50000
    timeout server  50000

listen broker-cluster
    bind *:6379
    mode tcp
    balance roundrobin
    server broker1 broker-1:6379 check
    server broker2 broker-2:6379 check
    server broker3 broker-3:6379 check
```

### Starting the Cluster

```bash
docker-compose up -d
docker-compose logs -f broker-1
```

### Scaling Workers

Add more workers:
```yaml
worker-4:
  build: .
  command: tq-worker --broker-addr load-balancer:6379
  depends_on:
    - load-balancer
  environment:
    - RUST_LOG=info
```

## Kubernetes Deployment

### StatefulSet Configuration

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: task-queue-broker
spec:
  serviceName: task-queue-broker
  replicas: 3
  selector:
    matchLabels:
      app: task-queue-broker
  template:
    metadata:
      labels:
        app: task-queue-broker
    spec:
      containers:
      - name: broker
        image: myregistry/task-queue-broker:latest
        ports:
        - containerPort: 6379
          name: broker
        - containerPort: 8080
          name: rest-api
        - containerPort: 9090
          name: grpc
        env:
        - name: RUST_LOG
          value: "info"
        volumeMounts:
        - name: data
          mountPath: /data
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 2Gi
        livenessProbe:
          httpGet:
            path: /api/v1/health
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /api/v1/health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 50Gi
---
apiVersion: v1
kind: Service
metadata:
  name: task-queue-broker
spec:
  clusterIP: None
  selector:
    app: task-queue-broker
  ports:
  - port: 6379
    name: broker
  - port: 8080
    name: rest-api
  - port: 9090
    name: grpc
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-queue-worker
spec:
  replicas: 10
  selector:
    matchLabels:
      app: task-queue-worker
  template:
    metadata:
      labels:
        app: task-queue-worker
    spec:
      containers:
      - name: worker
        image: myregistry/task-queue-worker:latest
        env:
        - name: BROKER_ADDR
          value: "task-queue-broker:6379"
        - name: RUST_LOG
          value: "info"
        resources:
          requests:
            cpu: 250m
            memory: 256Mi
          limits:
            cpu: 1000m
            memory: 1Gi
```

## Monitoring Setup

### Prometheus Configuration

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'task-queue'
    static_configs:
      - targets: ['localhost:8080']
    metrics_path: '/metrics'
```

### Grafana Dashboard

Import dashboard ID: `12345` from Grafana Marketplace, or create custom:

```json
{
  "dashboard": {
    "title": "Task Queue Monitoring",
    "panels": [
      {
        "title": "Pending Tasks",
        "targets": [
          {
            "expr": "tq_tasks_pending"
          }
        ]
      },
      {
        "title": "Processing Rate",
        "targets": [
          {
            "expr": "rate(tq_tasks_total[5m])"
          }
        ]
      },
      {
        "title": "Worker Health",
        "targets": [
          {
            "expr": "tq_workers_connected"
          }
        ]
      }
    ]
  }
}
```

## Backup and Recovery

### Backup Strategy

1. **RocksDB Backups:**
```bash
# Backup data directory
tar czf backup-$(date +%Y%m%d).tar.gz /data

# Upload to S3
aws s3 cp backup-*.tar.gz s3://my-backup-bucket/
```

2. **Automated Backup:**
```bash
# cron job for daily backups
0 2 * * * /scripts/backup.sh
```

### Recovery Procedure

1. **Stop broker:**
```bash
docker-compose stop broker
```

2. **Restore backup:**
```bash
tar xzf backup-latest.tar.gz -C /
```

3. **Restart broker:**
```bash
docker-compose start broker
```

4. **Verify:**
```bash
curl http://localhost:8080/api/v1/health
```

## Performance Tuning

### RocksDB Optimization

```yaml
persistence:
  block_cache_size_mb: 256
  write_buffer_size_mb: 64
  max_write_buffer_number: 2
  compression: lz4
  level_compaction_dynamic_level_bytes: true
```

### Broker Configuration

```yaml
broker:
  # Increase for high-throughput scenarios
  max_connections: 2000

  # Adjust based on available memory
  queue_depth_threshold: 500000

  # Balance between responsiveness and overhead
  worker_poll_timeout_ms: 500

  # For faster leader election
  election_timeout_ms: 1000
  heartbeat_interval_ms: 300
```

### Worker Configuration

```yaml
worker:
  # Increase for more parallelism
  concurrency: 8

  # More frequent heartbeats for faster failure detection
  heartbeat_interval_secs: 10

  # Allow more time for graceful shutdown
  graceful_shutdown_timeout_secs: 120
```

## Security Configuration

### TLS Setup

```yaml
api:
  enable_tls: true
  tls_cert_path: /etc/certs/server.crt
  tls_key_path: /etc/certs/server.key

broker:
  enable_tls: true
  tls_cert_path: /etc/certs/server.crt
  tls_key_path: /etc/certs/server.key
```

### API Key Authentication

```yaml
auth:
  enabled: true
  api_keys:
    - key_hash: $2b$12$...  # bcrypt hash
      permissions: [submit_tasks, read_tasks]
    - key_hash: $2b$12$...  # bcrypt hash
      permissions: [admin]
```

## Troubleshooting

### Broker Won't Start

**Check logs:**
```bash
docker-compose logs broker
```

**Common issues:**
- Port already in use: `lsof -i :6379`
- Data directory permissions: `chmod 755 /data`

### Workers Not Claiming Tasks

**Verify connectivity:**
```bash
curl http://broker:8080/api/v1/health
```

**Check worker logs:**
```bash
docker-compose logs worker
```

### High Memory Usage

**Monitor memory:**
```bash
docker stats
```

**Reduce queue depth threshold or increase worker concurrency**

### Performance Degradation

**Monitor metrics:**
```bash
curl http://localhost:8080/metrics | grep tq_
```

**Investigate:**
- Broker CPU: May need horizontal scaling
- Queue depth: Increase workers
- Task duration: Check application logs
