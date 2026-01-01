FROM rust:1.83-slim as builder

WORKDIR /app

# Install dependencies
RUN apt-get update && apt-get install -y \
    libclang-dev \
    clang \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace files
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

# Build release binaries
RUN cargo build --release

# Runtime image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy binaries from builder
COPY --from=builder /app/target/release/tq-broker /usr/local/bin/
COPY --from=builder /app/target/release/tq-worker /usr/local/bin/
COPY --from=builder /app/target/release/tq-admin /usr/local/bin/

# Create data directory
RUN mkdir -p /data

WORKDIR /

CMD ["/usr/local/bin/tq-broker"]
