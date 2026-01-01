# Deployment Guide

This guide covers deploying the Task Queue system in production environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [System Requirements](#system-requirements)
- [Single Node Deployment](#single-node-deployment)
- [Clustered Deployment](#clustered-deployment)
- [Monitoring Setup](#monitoring-setup)
- [High Availability](#high-availability)
- [Security](#security)
- [Backup and Recovery](#backup-and-recovery)
- [Scaling](#scaling)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Software Requirements

- **Rust:** 1.70 or later
- **Operating System:** Linux, macOS, or Windows
- **Database:** RocksDB (embedded)
- **Optional:** Docker, Docker Compose

### Hardware Requirements

#### Minimum (Development)

| Component | CPU | RAM | Disk |
|-----------|-----|------|------|
| Broker | 2 cores | 2GB | 10GB |
| Worker | 1 core | 1GB | 5GB |

#### Recommended (Production)

| Component | CPU | RAM | Disk |
|-----------|-----|------|------|
| Broker | 4-8 cores | 8-16GB | 100GB SSD |
| Worker | 2-4 cores | 4-8GB | 20GB |

#### Large Scale (High Volume)

| Component | CPU | RAM | Disk |
|-----------|-----|------|------|
| Broker | 16+ cores | 32GB+ | 500GB+ SSD |
| Worker | 8+ cores | 16GB+ | 100GB+ SSD |

---

## System Requirements

### Operating System

**Supported:**
- Linux (Ubuntu 20.04+, Debian 11+, RHEL 8+, Amazon Linux 2)
- macOS (12+ Monterey)
- Windows (10/11 with WSL2)

**Recommended:** Ubuntu LTS for production

### Network

**Ports:**
- `6379` - Broker TCP protocol
- `8080` - REST API
- `9090` - gRPC API
- `9091` - Prometheus metrics

**Firewall:**
```bash
# Allow broker ports
sudo ufw allow 6379/tcp  # Broker
sudo ufw allow 8080/tcp  # REST API
sudo ufw allow 9090/tcp  # gRPC
sudo ufw allow 9091/tcp  # Metrics
```

### Storage

**Requirements:**
- SSD recommended for RocksDB
- Minimum IOPS: 1000
- Recommended IOPS: 3000+
- Latency: <10ms (p95)

**Filesystem:**
- ext4 (Linux)
- APFS (macOS)
- NTFS (Windows)

---

## Single Node Deployment

### Installation

#### From Source

```bash
# Clone repository
git clone https://github.com/example/task-queue.git
cd task-queue

# Build binaries
cargo build --release

# Binaries are now in target/release/
```

#### Using Cargo

```bash
cargo install task-queue-broker
cargo install task-queue-worker
cargo install task-queue-admin
```

### Configuration

Create `config.yaml`:

```yaml
broker:
  host: 0.0.0.0
  port: 6379
  max_connections: 1000
  queue_depth_threshold: 100000

persistence:
  data_dir: /var/lib/task-queue
  wal_sync_interval_ms: 100
  completed_task_retention_days: 7

raft:
  enabled: false  # Single node

api:
  rest_port: 8080
  grpc_port: 9090
  enable_tls: false

auth:
  enabled: false  # Enable for production

monitoring:
  prometheus_port: 9091
  log_level: info

worker:
  concurrency: 4
  heartbeat_interval_secs: 15
  lease_timeout_secs: 30
```

### Systemd Service

**Broker Service** (`/etc/systemd/system/task-queue-broker.service`):

```ini
[Unit]
Description=Task Queue Broker
After=network.target

[Service]
Type=simple
User=taskqueue
Group=taskqueue
WorkingDirectory=/opt/task-queue
ExecStart=/usr/local/bin/tq-broker --config /etc/task-queue/config.yaml
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

**Worker Service** (`/etc/systemd/system/task-queue-worker.service`):

```ini
[Unit]
Description=Task Queue Worker
After=task-queue-broker.service

[Service]
Type=simple
User=taskqueue
Group=taskqueue
WorkingDirectory=/opt/task-queue
ExecStart=/usr/local/bin/tq-worker \
  --broker-addr 127.0.0.1:6379 \
  --concurrency 4
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Enable Services:**

```bash
# Create user
sudo useradd -r -s /bin/false taskqueue

# Create directories
sudo mkdir -p /opt/task-queue
sudo mkdir -p /etc/task-queue
sudo mkdir -p /var/lib/task-queue

# Set permissions
sudo chown -R taskqueue:taskqueue /opt/task-queue
sudo chown -R taskqueue:taskqueue /etc/task-queue
sudo chown -R taskqueue:taskqueue /var/lib/task-queue

# Copy binaries
sudo cp target/release/tq-broker /usr/local/bin/
sudo cp target/release/tq-worker /usr/local/bin/
sudo cp target/release/tq-admin /usr/local/bin/

# Copy config
sudo cp config.yaml /etc/task-queue/

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable task-queue-broker
sudo systemctl start task-queue-broker

# Verify
sudo systemctl status task-queue-broker
```

### Docker Deployment

**Dockerfile:**

```dockerfile
FROM rust:1.75 as builder

WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/tq-broker ./tq-broker
COPY --from=builder /app/target/release/tq-worker ./tq-worker
COPY --from=builder /app/target/release/tq-admin ./tq-admin
COPY config.yaml ./config.yaml

EXPOSE 6379 8080 9091
CMD ["./tq-broker", "--config", "config.yaml"]
```

**Docker Compose:**

```yaml
version: '3.8'

services:
  broker:
    build: .
    ports:
      - "6379:6379"
      - "8080:8080"
      - "9091:9091"
    volumes:
      - ./config.yaml:/app/config.yaml
      - ./data:/var/lib/task-queue
    restart: unless-stopped

  worker:
    build: .
    command: ["./tq-worker", "--broker-addr", "broker:6379"]
    depends_on:
      - broker
    restart: unless-stopped
```

**Run:**

```bash
docker-compose up -d
```

---

## Clustered Deployment

### Architecture

```
                        Load Balancer
                            │
              ┌─────────────┼─────────────┐
              │                         │
         ┌────▼────┐              ┌────▼────┐
         │ Node 1  │              │ Node 2  │
         │ Leader  │              │Follower │
         └────┬────┘              └──────────┘
              │                         │
         ┌────▼───────────────────────▼────┐
         │        Raft Consensus           │
         └────┬───────────────────────┬────┘
              │                       │
         ┌────▼────┐              ┌────▼────┐
         │ Node 3  │              │ Workers  │
         │Follower │              │  (N)     │
         └──────────┘              └──────────┘
```

### Configuration

**Node 1 (Leader):** `/etc/task-queue/node1.yaml`

```yaml
broker:
  host: 10.0.1.10
  port: 6379

persistence:
  data_dir: /var/lib/task-queue/node1

raft:
  enabled: true
  node_id: node1
  peers:
    - 10.0.1.11:6379
    - 10.0.1.12:6379
```

**Node 2:** `/etc/task-queue/node2.yaml`

```yaml
broker:
  host: 10.0.1.11
  port: 6379

persistence:
  data_dir: /var/lib/task-queue/node2

raft:
  enabled: true
  node_id: node2
  peers:
    - 10.0.1.10:6379
    - 10.0.1.12:6379
```

**Node 3:** `/etc/task-queue/node3.yaml`

```yaml
broker:
  host: 10.0.1.12
  port: 6379

persistence:
  data_dir: /var/lib/task-queue/node3

raft:
  enabled: true
  node_id: node3
  peers:
    - 10.0.1.10:6379
    - 10.0.1.11:6379
```

### Load Balancer

**HAProxy Configuration:** `/etc/haproxy/haproxy.cfg`

```
defaults
    timeout connect 5000ms
    timeout client  50000ms
    timeout server  50000ms

frontend task_queue_frontend
    bind *:6379
    default_backend task_queue_backend

backend task_queue_backend
    balance roundrobin
    server node1 10.0.1.10:6379 check
    server node2 10.0.1.11:6379 backup
    server node3 10.0.1.12:6379 backup

frontend rest_api_frontend
    bind *:8080
    default_backend rest_api_backend

backend rest_api_backend
    balance roundrobin
    server node1 10.0.1.10:8080 check
    server node2 10.0.1.11:8080 backup
    server node3 10.0.1.12:8080 backup
```

### Starting the Cluster

```bash
# On Node 1
sudo systemctl start task-queue-broker@node1

# On Node 2
sudo systemctl start task-queue-broker@node2

# On Node 3
sudo systemctl start task-queue-broker@node3

# Check cluster status
tq-admin --broker-addr 10.0.1.10:6379 cluster-status
```

---

## Monitoring Setup

### Prometheus

**prometheus.yml:**

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'task-queue'
    static_configs:
      - targets:
        - '10.0.1.10:9091'
        - '10.0.1.11:9091'
        - '10.0.1.12:9091'
```

**Run Prometheus:**

```bash
docker run -d \
  -p 9090:9090 \
  -v $(pwd)/prometheus.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus
```

### Grafana

**Docker Compose:**

```yaml
grafana:
  image: grafana/grafana:latest
  ports:
    - "3000:3000"
  environment:
    - GF_SECURITY_ADMIN_PASSWORD=admin
  volumes:
    - ./grafana/dashboards:/var/lib/grafana/dashboards
    - ./grafana/datasources:/etc/grafana/datasources
```

**Dashboard:** Import `task-queue-dashboard.json`

### Alerts

**Alert Rules:** `alerts.yml`

```yaml
groups:
  - name: task_queue
    interval: 30s
    rules:
      - alert: HighPendingTasks
        expr: tq_tasks_pending > 10000
        for: 5m
        annotations:
          summary: "High number of pending tasks"
      
      - alert: WorkerDown
        expr: tq_workers_connected < 2
        for: 2m
        annotations:
          summary: "Few workers connected"
      
      - alert: HighFailureRate
        expr: rate(tq_tasks_total{status="failed"}[5m]) > 10
        for: 5m
        annotations:
          summary: "High task failure rate"
```

---

## High Availability

### Raft Clustering

**Best Practices:**

1. **Odd number of nodes** (3 or 5) for majority voting
2. **Spread across availability zones** (AWS AZs, GCP zones)
3. **Network redundancy** between nodes
4. **Separate storage** for each node

### Backup Strategy

**Daily Backups:**

```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d)
BACKUP_DIR=/backups/task-queue
DATA_DIR=/var/lib/task-queue

mkdir -p $BACKUP_DIR

# Create RocksDB checkpoint
tq-admin --broker-addr localhost:6379 create-snapshot $BACKUP_DIR/snapshot-$DATE

# Compress
tar -czf $BACKUP_DIR/backup-$DATE.tar.gz -C $DATA_DIR .

# Keep last 7 days
find $BACKUP_DIR -name "backup-*.tar.gz" -mtime +7 -delete
```

**Restore:**

```bash
# Stop service
sudo systemctl stop task-queue-broker

# Restore data
tar -xzf backup-20240115.tar.gz -C /var/lib/task-queue

# Start service
sudo systemctl start task-queue-broker
```

### Disaster Recovery

**Scenario: Complete Cluster Failure**

1. **Spin up new nodes** in healthy region
2. **Restore from latest backup**
3. **Start cluster** with same configuration
4. **Update DNS/load balancer**
5. **Verify operations**

**Scenario: Single Node Failure**

1. **Raft elects new leader** (automatic)
2. **Failed node rejoins** (automatic)
3. **Catches up** via log replication (automatic)

---

## Security

### TLS Configuration

**Generate Certificates:**

```bash
# CA certificate
openssl req -x509 -newkey rsa:4096 -keyout ca.key -out ca.crt -days 365 -nodes

# Server certificate
openssl req -newkey rsa:4096 -keyout server.key -out server.csr -nodes -subj "/CN=task-queue"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365

# Client certificate
openssl req -newkey rsa:4096 -keyout client.key -out client.csr -nodes -subj "/CN=client"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 365
```

**Broker Config:**

```yaml
api:
  enable_tls: true
  tls_cert_path: /etc/task-queue/tls/server.crt
  tls_key_path: /etc/task-queue/tls/server.key
```

### Authentication

**Generate API Key:**

```bash
# Generate random key
openssl rand -base64 32 > api_key.txt

# Hash for config
echo -n "my_api_key" | htpasswd -nBC 10 "" | tr -d ':\n'
```

**Broker Config:**

```yaml
auth:
  enabled: true
  api_keys:
    - key_hash: "$2a$10$..."  # bcrypt hash
      permissions:
        - submit_tasks
        - read_tasks
        - cancel_tasks
        - admin
```

### Network Security

**Firewall:**

```bash
# Only allow from application servers
sudo ufw allow from 10.0.2.0/24 to any port 6379
sudo ufw allow from 10.0.3.0/24 to any port 8080
```

**VPN:**
- Use VPN for inter-cluster communication
- Encrypt all traffic between nodes

### Access Control

**API Key Permissions:**

- `submit_tasks` - Submit tasks
- `read_tasks` - Query task status
- `cancel_tasks` - Cancel tasks
- `admin` - Full access

**Environment Variables:**

```bash
export TQ_API_KEY="your-api-key"
```

---

## Scaling

### Horizontal Scaling

**Workers:**

```bash
# Add more workers
for i in {1..10}; do
  docker run -d task-queue-worker \
    --broker-addr broker:6379
done
```

**Brokers (Read Scaling):**

- Followers can serve reads
- Use followers for status queries
- Leader handles all writes

### Vertical Scaling

**Broker:**

```bash
# Increase memory
RUST_BACKTRACE=1 ./tq-broker \
  --broker-addr 0.0.0.0:6379
```

**Worker:**

```bash
# Increase concurrency
./tq-worker \
  --broker-addr 127.0.0.1:6379 \
  --concurrency 8
```

### Auto-scaling

**AWS Auto Scaling Group:**

```yaml
AutoScalingGroupName: task-queue-workers
MinSize: 2
MaxSize: 20
TargetTrackingPolicy:
  TargetValue: 75.0
  PredefinedMetricSpecification:
    PredefinedMetricType: ASGAverageCPUUtilization
```

---

## Troubleshooting

### Common Issues

#### 1. Broker won't start

**Symptoms:**
- Service fails to start
- Logs show port in use

**Solutions:**
```bash
# Check if port is in use
sudo netstat -tulpn | grep 6379

# Kill process using port
sudo kill -9 <PID>

# Check logs
sudo journalctl -u task-queue-broker -f
```

#### 2. Workers not claiming tasks

**Symptoms:**
- Tasks stay in pending state
- Workers show as idle

**Solutions:**
```bash
# Check worker registration
tq-admin workers

# Check queue depth
tq-admin queue-depth

# Check worker logs
sudo journalctl -u task-queue-worker -f
```

#### 3. High memory usage

**Symptoms:**
- Broker OOM killed
- Workers consuming too much RAM

**Solutions:**
- Increase worker timeout (tasks hung)
- Reduce concurrency per worker
- Implement task payload limits
- Add more workers instead of increasing concurrency

#### 4. Slow performance

**Symptoms:**
- High latency
- Low throughput

**Solutions:**
```bash
# Check CPU usage
top -p $(pidof tq-broker)

# Check I/O
iostat -x 1

# Check RocksDB stats
tq-admin stats
```

### Debugging

**Enable Debug Logging:**

```yaml
monitoring:
  log_level: debug
```

**Enable Tracing:**

```bash
RUST_LOG=trace ./tq-broker
```

**Profile Performance:**

```bash
perf record -F 99 -p $(pidof tq-broker) -g -- sleep 30
perf report
```

---

## Performance Tuning

### RocksDB Tuning

**config.yaml:**

```yaml
persistence:
  # Increase write buffer for higher throughput
  write_buffer_size: 128MB
  
  # More write buffers
  max_write_buffer_number: 4
  
  # Sync WAL less frequently (lower durability)
  wal_sync_interval_ms: 1000
```

### Worker Tuning

**Concurrency:**
```bash
./tq-worker --concurrency 8
```

**Heartbeats:**
```bash
./tq-worker --heartbeat-interval-secs 30
```

### Network Tuning

**TCP Settings:** `/etc/sysctl.conf`

```
# Increase TCP buffer sizes
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 65536 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216

# Enable TCP Fast Open
net.ipv4.tcp_fastopen = 3

# Increase TCP backlog
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 8192
```

---

## Maintenance

### Regular Tasks

**Daily:**
- Monitor queue depth
- Check error rates
- Review worker health

**Weekly:**
- Review logs for errors
- Check disk usage
- Backup data

**Monthly:**
- Compaction audit
- Performance review
- Security updates

### Upgrades

**Zero-Downtime Upgrade:**

```bash
# For cluster
# 1. Upgrade followers first
ssh node2 "systemctl restart task-queue-broker"
ssh node3 "systemctl restart task-queue-broker"

# 2. Upgrade leader last
ssh node1 "systemctl restart task-queue-broker"
```

**Rollback:**

```bash
# Restore previous version
sudo systemctl stop task-queue-broker
cp /usr/local/bin/tq-broker /usr/local/bin/tq-broker.new
cp /usr/local/bin/tq-broker.old /usr/local/bin/tq-broker
sudo systemctl start task-queue-broker
```

---

## Migration

### From Version X to Y

1. **Backup data**
2. **Stop old version**
3. **Install new version**
4. **Start new version**
5. **Verify operation**
6. **Remove old version**

### Data Migration

```bash
# Export tasks
tq-admin list --status completed --limit 100000 > tasks.json

# Import to new cluster
jq -r '.[] | @json' tasks.json | \
  xargs -I {} curl -X POST http://new-broker:8080/api/v1/tasks \
    -H "Content-Type: application/json" -d '{}'
```

---

## Best Practices

### 1. Monitoring

- Set up Prometheus + Grafana
- Configure alerting
- Review metrics weekly

### 2. Security

- Enable TLS in production
- Use API keys with least privilege
- Rotate credentials regularly
- Audit access logs

### 3. Backup

- Daily automated backups
- Store backups off-site
- Test restoration regularly
- Document recovery procedures

### 4. Scaling

- Start with minimal resources
- Monitor performance
- Scale incrementally
- Use auto-scaling for workers

### 5. Documentation

- Document custom handlers
- Maintain runbooks
- Track incidents
- Share knowledge

---

## Appendices

### A. Systemd Templates

**Multi-instance Broker:** `/etc/systemd/system/task-queue-broker@.service`

```ini
[Unit]
Description=Task Queue Broker (%i)
After=network.target

[Service]
Type=simple
User=taskqueue
Group=taskqueue
ExecStart=/usr/local/bin/tq-broker --config /etc/task-queue/%i.yaml
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Usage:**
```bash
sudo systemctl start task-queue-broker@node1
sudo systemctl start task-queue-broker@node2
```

### B. Log Rotation

`/etc/logrotate.d/task-queue`

```
/var/log/task-queue/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 taskqueue taskqueue
    sharedscripts
    postrotate
        systemctl reload task-queue-broker > /dev/null 2>&1 || true
    endscript
}
```

### C. Firewall Rules

**AWS Security Groups:**

```json
{
  "InboundRules": [
    {
      "FromPort": 6379,
      "ToPort": 6379,
      "IpProtocol": "tcp",
      "IpRanges": ["10.0.0.0/8"]
    },
    {
      "FromPort": 8080,
      "ToPort": 8080,
      "IpProtocol": "tcp",
      "IpRanges": ["0.0.0.0/0"]
    }
  ]
}
```

### D. Health Checks

**For Load Balancers:**

```bash
#!/bin/bash
# health-check.sh

STATUS=$(curl -s http://localhost:8080/health | jq -r '.status')

if [ "$STATUS" == "healthy" ]; then
    exit 0
else
    exit 1
fi
```

---

**Document Version:** 1.0.0  
**Last Updated:** 2024-01-15
