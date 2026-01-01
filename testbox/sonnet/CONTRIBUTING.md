# Contributing to Distributed Task Queue

Thank you for your interest in contributing! This document provides guidelines and information for contributors.

## Getting Started

### Prerequisites

1. **Rust**: Install from https://rustup.rs/
2. **LLVM/Clang** (for RocksDB):
   - Linux: `sudo apt-get install clang libclang-dev`
   - macOS: `brew install llvm`
   - Windows: Download from https://releases.llvm.org/

3. **Git**: For version control

### Setting Up Development Environment

```bash
# Clone repository
git clone https://github.com/your-org/task-queue.git
cd task-queue

# Build project
cargo build

# Run tests
cargo test

# Run clippy
cargo clippy --all-targets --all-features

# Format code
cargo fmt --all
```

## Development Workflow

### 1. Pick an Issue

- Look for issues labeled `good-first-issue` or `help-wanted`
- Comment on the issue to let others know you're working on it
- Ask questions if anything is unclear

### 2. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/issue-123
```

### 3. Make Changes

- Write clean, idiomatic Rust code
- Follow the existing code style
- Add tests for new functionality
- Update documentation as needed

### 4. Test Your Changes

```bash
# Run all tests
cargo test --all

# Run specific crate tests
cargo test -p task-queue-core

# Run integration tests
cargo test --test integration

# Check formatting
cargo fmt --all -- --check

# Run clippy
cargo clippy --all-targets --all-features -- -D warnings
```

### 5. Commit Your Changes

Write clear, descriptive commit messages:

```bash
git add .
git commit -m "Add feature: brief description

Detailed explanation of what changed and why.

Fixes #123"
```

Commit message format:
- First line: Brief summary (50 chars or less)
- Blank line
- Detailed description
- Reference issues/PRs

### 6. Push and Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## Code Style Guidelines

### Rust Code Style

1. **Follow rustfmt**: Always run `cargo fmt` before committing
2. **Use clippy**: Address all clippy warnings
3. **Error Handling**: Use `Result` and `?`, avoid `unwrap()/expect()` in production code
4. **Async Code**: Use `async/await` consistently with tokio
5. **Comments**: Write doc comments for public APIs

### Example

```rust
/// Submits a task to the queue.
///
/// # Arguments
/// * `task` - The task to submit
///
/// # Returns
/// Returns the task ID on success
///
/// # Errors
/// Returns error if submission fails or queue is full
///
/// # Example
/// ```
/// let task = Task::new("echo", b"data", Priority::normal())?;
/// let task_id = broker.submit_task(task)?;
/// ```
pub fn submit_task(&self, task: Task) -> Result<TaskId> {
    // Implementation
}
```

### Naming Conventions

- **Types**: PascalCase (`TaskQueue`, `WorkerInfo`)
- **Functions**: snake_case (`submit_task`, `get_status`)
- **Constants**: SCREAMING_SNAKE_CASE (`MAX_PAYLOAD_SIZE`)
- **Modules**: snake_case (`task_queue_core`)

## Testing Guidelines

### Unit Tests

Place unit tests in the same file as the code:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_creation() {
        let task = Task::new("test", b"data", Priority::normal()).unwrap();
        assert_eq!(task.task_type, "test");
    }

    #[tokio::test]
    async fn test_async_function() {
        let result = async_function().await;
        assert!(result.is_ok());
    }
}
```

### Integration Tests

Place in `tests/` directory:

```rust
// tests/integration_test.rs
use task_queue_broker::Broker;

#[tokio::test]
async fn test_full_workflow() {
    // Test setup
    let broker = Broker::new(config)?;

    // Test execution
    // ...

    // Assertions
}
```

### Test Coverage

- Aim for >80% code coverage
- Test happy paths and error cases
- Test edge cases (empty input, max values, etc.)
- Mock external dependencies

## Documentation

### Doc Comments

All public APIs must have documentation:

```rust
/// A task queue broker that manages task distribution.
///
/// The broker maintains an in-memory priority queue and persists
/// all state to RocksDB for durability.
pub struct Broker {
    // fields
}

impl Broker {
    /// Creates a new broker with the given configuration.
    ///
    /// # Arguments
    /// * `config` - Broker configuration
    ///
    /// # Errors
    /// Returns error if unable to initialize persistence
    pub fn new(config: BrokerConfig) -> Result<Self> {
        // ...
    }
}
```

### README Updates

Update README.md when adding:
- New features
- New configuration options
- Breaking changes

### Examples

Add examples for new features:

```rust
// examples/new_feature.rs
use task_queue_client::TaskQueueClient;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Demonstrate new feature
    Ok(())
}
```

## Pull Request Guidelines

### PR Checklist

Before submitting:

- [ ] Code compiles without warnings
- [ ] All tests pass
- [ ] New tests added for new functionality
- [ ] Documentation updated
- [ ] Changelog updated (if applicable)
- [ ] Commit messages are clear
- [ ] Code follows style guidelines

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How was this tested?

## Checklist
- [ ] Tests pass
- [ ] Documentation updated
- [ ] Changelog updated
```

## Project Areas Needing Help

### High Priority

1. **Raft Clustering** ⭐⭐⭐
   - Implement leader election
   - Log replication
   - Snapshot mechanism
   - See: `crates/task-queue-raft/`

2. **Security** ⭐⭐⭐
   - TLS implementation
   - API key authentication
   - Rate limiting
   - See: Issues #XXX

3. **Testing** ⭐⭐⭐
   - Integration tests
   - Property-based tests
   - Load tests
   - See: `tests/` directory

### Medium Priority

4. **gRPC API** ⭐⭐
   - Protocol buffers definition
   - Server implementation
   - Client library
   - See: Issue #XXX

5. **Web UI** ⭐⭐
   - React/Vue frontend
   - WebSocket integration
   - Dashboard
   - See: Issue #XXX

6. **Performance** ⭐⭐
   - Benchmarking
   - Optimization
   - Memory profiling
   - See: Issue #XXX

### Nice to Have

7. **Advanced Features** ⭐
   - Task dependencies
   - Scheduled tasks
   - Task chains
   - See: Issue #XXX

8. **Documentation**
   - Architecture diagrams
   - Tutorial videos
   - Blog posts
   - See: `docs/` directory

## Code Review Process

### What We Look For

1. **Correctness**: Does it work as intended?
2. **Tests**: Are there adequate tests?
3. **Documentation**: Is it well documented?
4. **Code Quality**: Is it clean and maintainable?
5. **Performance**: Are there any obvious inefficiencies?
6. **Security**: Are there any security concerns?

### Response Time

- Initial review: Within 2-3 days
- Follow-up reviews: Within 1-2 days
- We appreciate your patience!

## Communication

### Channels

- **GitHub Issues**: Bug reports, feature requests
- **GitHub Discussions**: Questions, ideas
- **Discord**: Real-time chat (link in README)
- **Email**: For sensitive issues

### Getting Help

- Check existing issues first
- Search documentation
- Ask in GitHub Discussions
- Ping maintainers if urgent

## Building the Project

### Standard Build

```bash
cargo build --release
```

### Debug Build (faster, with debug info)

```bash
cargo build
```

### Build Specific Crate

```bash
cargo build -p task-queue-broker
```

### Clean Build

```bash
cargo clean
cargo build --release
```

## Running the Project

### Start Broker

```bash
cargo run --release --bin tq-broker -- --config config.example.yaml
```

### Start Worker

```bash
cargo run --release --bin tq-worker -- --broker 127.0.0.1:6379
```

### Run Admin CLI

```bash
cargo run --release --bin tq-admin -- stats
```

## Common Issues

### RocksDB Build Fails (Windows)

Install LLVM and set environment variable:
```bash
setx LIBCLANG_PATH "C:\Program Files\LLVM\bin"
```

### Tests Fail

Make sure broker is not running:
```bash
# Kill any running broker
pkill tq-broker
# Run tests
cargo test
```

### Clippy Warnings

Fix clippy warnings before submitting:
```bash
cargo clippy --all-targets --all-features --fix
```

## Release Process

(For maintainers)

1. Update version in all `Cargo.toml` files
2. Update `CHANGELOG.md`
3. Run full test suite
4. Create git tag: `git tag -a v0.2.0 -m "Release v0.2.0"`
5. Push tag: `git push origin v0.2.0`
6. Create GitHub release
7. Publish to crates.io (if applicable)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be:
- Listed in `CONTRIBUTORS.md`
- Mentioned in release notes
- Given credit in documentation

Thank you for contributing!
