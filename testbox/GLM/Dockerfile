# Build stage
FROM rust:1.75-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    libclang-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy Cargo files
COPY Cargo.toml Cargo.lock ./
COPY task-queue-core ./task-queue-core
COPY task-queue-persistence ./task-queue-persistence
COPY task-queue-broker ./task-queue-broker
COPY task-queue-worker ./task-queue-worker
COPY task-queue-client ./task-queue-client
COPY task-queue-admin ./task-queue-admin
COPY task-queue-api ./task-queue-api
COPY task-queue-raft ./task-queue-raft

# Build release
RUN cargo build --release --bins

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binaries from builder
COPY --from=builder /app/target/release/tq-broker /app/
COPY --from=builder /app/target/release/tq-worker /app/
COPY --from=builder /app/target/release/tq-admin /app/

# Copy default config
COPY config.yaml /app/config.yaml

# Create data directory
RUN mkdir -p /data

# Set default broker command
CMD ["/app/tq-broker", "--config", "/app/config.yaml"]
