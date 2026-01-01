FROM rust:1.70-slim as builder

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy source code
COPY . .

# Build in release mode
RUN cargo build --release -p task-queue-broker --bin tq-broker

FROM debian:bookworm-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create data directory
RUN mkdir -p /data

# Copy binary from builder
COPY --from=builder /build/target/release/tq-broker /usr/local/bin/

# Expose ports
EXPOSE 6379 8080 9090

# Set data directory
ENV DATA_DIR=/data

# Health check
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
    CMD curl -f http://localhost:8080/api/v1/health || exit 1

# Run broker
CMD ["tq-broker", "--host", "0.0.0.0"]
