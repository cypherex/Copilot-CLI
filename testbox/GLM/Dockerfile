FROM rust:1.75 as builder

WORKDIR /app

# Copy source code
COPY . .

# Build release binaries
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binaries from builder
COPY --from=builder /app/target/release/tq-broker ./tq-broker
COPY --from=builder /app/target/release/tq-worker ./tq-worker
COPY --from=builder /app/target/release/tq-admin ./tq-admin

# Set default command
CMD ["./tq-broker"]
