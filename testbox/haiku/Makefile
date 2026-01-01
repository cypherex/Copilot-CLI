.PHONY: build test run clean format lint docs help

help:
	@echo "Task Queue System - Development Commands"
	@echo ""
	@echo "Usage: make [command]"
	@echo ""
	@echo "Commands:"
	@echo "  build        - Build all crates"
	@echo "  release      - Build in release mode"
	@echo "  test         - Run all tests"
	@echo "  test-coverage - Run tests with coverage"
	@echo "  run-broker   - Run broker locally"
	@echo "  run-worker   - Run worker locally"
	@echo "  run-admin    - Run admin CLI"
	@echo "  clean        - Clean build artifacts"
	@echo "  format       - Format code with cargo fmt"
	@echo "  lint         - Run clippy linter"
	@echo "  check        - Run clippy + format check"
	@echo "  docs         - Generate rustdoc documentation"
	@echo "  docker-build - Build Docker images"
	@echo "  docker-up    - Start Docker Compose services"
	@echo "  docker-down  - Stop Docker Compose services"

build:
	cargo build --all

release:
	cargo build --all --release

test:
	cargo test --all

test-coverage:
	cargo tarpaulin --out Html --output-dir coverage

run-broker:
	cargo run -p task-queue-broker --bin tq-broker -- --host 127.0.0.1 --port 6379

run-worker:
	cargo run -p task-queue-worker --bin tq-worker -- --broker-addr 127.0.0.1:6379

run-admin:
	cargo run -p task-queue-cli --bin tq-admin -- stats

clean:
	cargo clean
	rm -rf coverage
	rm -rf target

format:
	cargo fmt --all

lint:
	cargo clippy --all -- -D warnings

check: lint
	cargo fmt --all -- --check

docs:
	cargo doc --all --no-deps --open

docker-build:
	docker build -t task-queue-broker:latest -f Dockerfile .
	docker build -t task-queue-worker:latest -f Dockerfile.worker .

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

docker-logs:
	docker-compose logs -f

# Development targets
dev-setup:
	rustup update
	cargo install cargo-tarpaulin
	cargo install cargo-watch

watch-test:
	cargo watch -x test

watch-build:
	cargo watch -x build

quick-test:
	cargo test --lib
