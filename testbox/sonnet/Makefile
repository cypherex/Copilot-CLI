.PHONY: build test clean run-broker run-worker run-admin fmt clippy doc

# Build all binaries
build:
	cargo build --release

# Run tests
test:
	cargo test --all

# Run tests with output
test-verbose:
	cargo test --all -- --nocapture

# Clean build artifacts
clean:
	cargo clean
	rm -rf data/

# Format code
fmt:
	cargo fmt --all

# Run clippy
clippy:
	cargo clippy --all-targets --all-features -- -D warnings

# Generate documentation
doc:
	cargo doc --no-deps --all --open

# Run broker
run-broker:
	cargo run --release --bin tq-broker -- --config config.example.yaml

# Run worker
run-worker:
	cargo run --release --bin tq-worker -- --broker 127.0.0.1:6379

# Run admin CLI help
run-admin:
	cargo run --release --bin tq-admin -- --help

# Build Docker images
docker-build:
	docker build -t task-queue:latest .

# Start cluster with Docker Compose
docker-up:
	docker-compose up -d

# Stop cluster
docker-down:
	docker-compose down

# View logs
docker-logs:
	docker-compose logs -f

# Run all checks before committing
check: fmt clippy test
	@echo "All checks passed!"

# Install binaries to system
install:
	cargo install --path crates/task-queue-broker
	cargo install --path crates/task-queue-worker
	cargo install --path crates/task-queue-admin
