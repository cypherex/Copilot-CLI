# Deployment Guide

## Prerequisites

### System Requirements

**Minimum:**
- CPU: 2 cores
- RAM: 2 GB
- Disk: 10 GB SSD
- OS: Linux, macOS, or Windows

**Recommended (Production):**
- CPU: 4+ cores
- RAM: 8+ GB
- Disk: 50+ GB SSD with good IOPS
- OS: Linux (Ubuntu 22.04 or RHEL 9)

### Build Dependencies

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  clang \
  libclang-dev \
  pkg-config \
  libssl-dev
```

**macOS:**
```bash
brew install llvm
```

**Windows:**
```bash
# Download and install LLVM from:
# https://releases.llvm.org/

# Set environment variable:
setx LIBCLANG_PATH "C:\Program Files\LLVM\bin"
```

## Building from Source

```bash
# Clone repository
git clone https://github.com/your-org/task-queue.git
cd task-queue

# Build release binaries
cargo build --release

# Binaries will be in:
# target/release/tq-broker
# target/release/tq-worker
# target/release/tq-admin
```

## Installation

### Option 1: Install from Source

```bash
cargo install --path crates/task-queue-broker
cargo install --path crates/task-queue-worker
cargo install --path crates/task-queue-admin
```

Binaries will be installed to `~/.cargo/bin/`

### Option 2: Copy Binaries

```bash
sudo cp target/release/tq-broker /usr/local/bin/
sudo cp target/release/tq-worker /usr/local/bin/
sudo cp target/release/tq-admin /usr/local/bin/
```

## Configuration

### Create Configuration File

```bash
sudo mkdir -p /etc/taskqueue
sudo cp config.example.yaml /etc/taskqueue/config.yaml
sudo nano /etc/taskqueue/config.yaml
```

### Production Configuration

```yaml
broker:
  host: 0.0.0.0
  port: 6379
  max_connections: 5000
  queue_depth_threshold: 100000

persistence:
  data_dir: /var/lib/taskqueue
  wal_sync_interval_ms: 100
  completed_task_retention_days: 7

api:
  rest_port: 8080
  grpc_port: 9090
  enable_tls: true
  tls_cert_path: /etc/taskqueue/certs/server.crt
  tls_key_path: /etc/taskqueue/certs/server.key

auth:
  enabled: true
  api_keys:
    - key_hash: $2b$12$... # Generate with: echo -n "secret" | bcrypt
      permissions: [admin]

monitoring:
  prometheus_port: 9091
  log_level: info
```

## Single Node Deployment

### 1. Create Data Directory

```bash
sudo mkdir -p /var/lib/taskqueue
sudo chown -R taskqueue:taskqueue /var/lib/taskqueue
```

### 2. Create Systemd Service (Linux)

**Broker Service:**

```bash
sudo nano /etc/systemd/system/tq-broker.service
```

```ini
[Unit]
Description=Task Queue Broker
After=network.target

[Service]
Type=simple
User=taskqueue
Group=taskqueue
ExecStart=/usr/local/bin/tq-broker --config /etc/taskqueue/config.yaml
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/taskqueue

[Install]
WantedBy=multi-user.target
```

**Worker Service:**

```bash
sudo nano /etc/systemd/system/tq-worker@.service
```

```ini
[Unit]
Description=Task Queue Worker %i
After=network.target tq-broker.service
Requires=tq-broker.service

[Service]
Type=simple
User=taskqueue
Group=taskqueue
ExecStart=/usr/local/bin/tq-worker --broker 127.0.0.1:6379 --concurrency 4
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### 3. Start Services

```bash
sudo systemctl daemon-reload
sudo systemctl enable tq-broker
sudo systemctl start tq-broker

# Start multiple workers
sudo systemctl enable tq-worker@1
sudo systemctl enable tq-worker@2
sudo systemctl start tq-worker@1
sudo systemctl start tq-worker@2
```

### 4. Verify Deployment

```bash
# Check broker status
sudo systemctl status tq-broker

# Check worker status
sudo systemctl status tq-worker@1

# View logs
sudo journalctl -u tq-broker -f

# Test API
curl http://localhost:8080/health

# Submit test task
echo "test" > /tmp/test.txt
tq-admin submit --type echo --payload-file /tmp/test.txt
```

## Clustered Deployment (3 Nodes)

### Architecture

```
┌─────────────────────────────────────────┐
│           Load Balancer                  │
│       (HAProxy / Nginx)                  │
└───────┬─────────────┬─────────────┬─────┘
        │             │             │
   ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
   │ Broker 1│   │ Broker 2│   │ Broker 3│
   │ (Leader)│   │(Follower│   │(Follower│
   └─────────┘   └─────────┘   └─────────┘
```

### Node 1 Configuration

```yaml
broker:
  host: 0.0.0.0
  port: 6379

raft:
  enabled: true
  node_id: node1
  peers:
    - node2.example.com:6379
    - node3.example.com:6379
  election_timeout_ms: 1000
  heartbeat_interval_ms: 300

# ... rest of config
```

### Node 2 Configuration

```yaml
broker:
  host: 0.0.0.0
  port: 6379

raft:
  enabled: true
  node_id: node2
  peers:
    - node1.example.com:6379
    - node3.example.com:6379
  election_timeout_ms: 1000
  heartbeat_interval_ms: 300

# ... rest of config
```

### Node 3 Configuration

Similar to Node 2, but with `node_id: node3`

### Load Balancer Configuration (HAProxy)

```
frontend task_queue
    bind *:6379
    mode tcp
    default_backend brokers

backend brokers
    mode tcp
    balance leastconn
    option tcp-check
    server broker1 node1.example.com:6379 check
    server broker2 node2.example.com:6379 check
    server broker3 node3.example.com:6379 check

frontend rest_api
    bind *:8080
    mode http
    default_backend rest_servers

backend rest_servers
    mode http
    balance roundrobin
    option httpchk GET /health
    server api1 node1.example.com:8080 check
    server api2 node2.example.com:8080 check
    server api3 node3.example.com:8080 check
```

## Docker Deployment

### Single Container

```bash
docker build -t task-queue:latest .

# Run broker
docker run -d \
  --name tq-broker \
  -p 6379:6379 \
  -p 8080:8080 \
  -p 9091:9091 \
  -v $(pwd)/data:/data \
  -v $(pwd)/config.yaml:/config/config.yaml \
  task-queue:latest \
  /usr/local/bin/tq-broker --config /config/config.yaml

# Run worker
docker run -d \
  --name tq-worker-1 \
  --link tq-broker \
  task-queue:latest \
  /usr/local/bin/tq-worker --broker tq-broker:6379
```

### Docker Compose (3-node cluster)

```bash
# Start cluster
docker-compose up -d

# View logs
docker-compose logs -f

# Scale workers
docker-compose up -d --scale worker=5

# Stop cluster
docker-compose down
```

## Kubernetes Deployment

### Broker Deployment

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: tq-broker
spec:
  serviceName: tq-broker
  replicas: 3
  selector:
    matchLabels:
      app: tq-broker
  template:
    metadata:
      labels:
        app: tq-broker
    spec:
      containers:
      - name: broker
        image: task-queue:latest
        command: ["/usr/local/bin/tq-broker"]
        args: ["--config", "/config/config.yaml"]
        ports:
        - containerPort: 6379
          name: broker
        - containerPort: 8080
          name: rest
        - containerPort: 9091
          name: metrics
        volumeMounts:
        - name: data
          mountPath: /data
        - name: config
          mountPath: /config
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 50Gi
```

### Worker Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tq-worker
spec:
  replicas: 10
  selector:
    matchLabels:
      app: tq-worker
  template:
    metadata:
      labels:
        app: tq-worker
    spec:
      containers:
      - name: worker
        image: task-queue:latest
        command: ["/usr/local/bin/tq-worker"]
        args:
        - "--broker"
        - "tq-broker-0.tq-broker:6379"
        - "--concurrency"
        - "4"
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: tq-broker
spec:
  clusterIP: None
  ports:
  - port: 6379
    name: broker
  - port: 8080
    name: rest
  - port: 9091
    name: metrics
  selector:
    app: tq-broker
```

## Monitoring Setup

### Prometheus

**prometheus.yml:**
```yaml
scrape_configs:
  - job_name: 'task-queue-broker'
    static_configs:
      - targets: ['localhost:9091']
    metric_relabel_configs:
      - source_labels: [__name__]
        regex: 'tq_.*'
        action: keep
```

### Grafana Dashboard

Import dashboard JSON with panels for:
- Task throughput (tasks/sec)
- Queue depth by priority
- Worker count
- Task processing duration (p50, p95, p99)
- Error rate
- System resource usage

### Alerting Rules

**alerts.yml:**
```yaml
groups:
  - name: task_queue
    rules:
      - alert: HighQueueDepth
        expr: tq_tasks_pending > 10000
        for: 5m
        annotations:
          summary: "High queue depth"

      - alert: NoWorkers
        expr: tq_workers_connected == 0
        for: 1m
        annotations:
          summary: "No workers connected"

      - alert: HighFailureRate
        expr: rate(tq_tasks_total{status="failed"}[5m]) > 0.1
        for: 5m
        annotations:
          summary: "High task failure rate"
```

## Backup and Recovery

### Backup

```bash
# Stop broker
sudo systemctl stop tq-broker

# Backup data directory
sudo tar -czf taskqueue-backup-$(date +%Y%m%d).tar.gz \
  /var/lib/taskqueue

# Restart broker
sudo systemctl start tq-broker

# Optional: Upload to S3
aws s3 cp taskqueue-backup-*.tar.gz s3://backups/taskqueue/
```

### Recovery

```bash
# Stop broker
sudo systemctl stop tq-broker

# Restore data
sudo tar -xzf taskqueue-backup-20240101.tar.gz -C /

# Start broker
sudo systemctl start tq-broker
```

### Continuous Backup (Recommended)

```bash
# Add to cron
0 2 * * * /usr/local/bin/backup-taskqueue.sh
```

## Performance Tuning

### Linux Kernel Tuning

```bash
# Increase file descriptors
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# TCP tuning
sysctl -w net.core.somaxconn=4096
sysctl -w net.ipv4.tcp_max_syn_backlog=8192
sysctl -w net.core.netdev_max_backlog=5000
```

### RocksDB Tuning

```yaml
persistence:
  # Increase write buffer for better performance
  write_buffer_size_mb: 128
  # More memtables for concurrent writes
  max_write_buffer_number: 6
  # Larger block cache
  block_cache_size_mb: 1024
```

### Broker Tuning

```yaml
broker:
  # Increase for high-throughput scenarios
  max_connections: 10000
  # Tune based on task size
  queue_depth_threshold: 500000
```

## Security Best Practices

1. **Use TLS for all connections**
2. **Enable authentication**
3. **Rotate API keys regularly**
4. **Run as non-root user**
5. **Use firewall to restrict access**
6. **Keep software updated**
7. **Monitor for suspicious activity**
8. **Regular security audits**

## Troubleshooting

### Broker won't start

```bash
# Check logs
sudo journalctl -u tq-broker -n 100

# Verify config
tq-broker --config /etc/taskqueue/config.yaml --validate

# Check ports
sudo netstat -tulpn | grep 6379
```

### Workers not connecting

```bash
# Check connectivity
telnet broker-host 6379

# Check firewall
sudo iptables -L

# Verify worker logs
sudo journalctl -u tq-worker@1 -n 100
```

### High memory usage

```bash
# Check RocksDB stats
tq-admin stats

# Reduce retention period
# Edit config: completed_task_retention_days: 1

# Manual cleanup
tq-admin purge --status completed --older-than 1d
```

### Slow task processing

```bash
# Check worker count
tq-admin workers

# Check queue depth
tq-admin queue-depth

# Add more workers
sudo systemctl start tq-worker@3
sudo systemctl start tq-worker@4
```

## Maintenance

### Log Rotation

```bash
# /etc/logrotate.d/taskqueue
/var/log/taskqueue/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 taskqueue taskqueue
    sharedscripts
    postrotate
        systemctl reload tq-broker
    endscript
}
```

### Upgrade Procedure

```bash
# 1. Backup data
sudo systemctl stop tq-broker tq-worker@*
sudo tar -czf backup-pre-upgrade.tar.gz /var/lib/taskqueue

# 2. Install new version
sudo cp target/release/tq-* /usr/local/bin/

# 3. Test config compatibility
tq-broker --config /etc/taskqueue/config.yaml --validate

# 4. Start services
sudo systemctl start tq-broker
sudo systemctl start tq-worker@*

# 5. Verify
tq-admin stats
```
