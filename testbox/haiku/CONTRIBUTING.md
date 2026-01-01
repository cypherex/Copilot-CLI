# Contributing to Task Queue System

Thank you for your interest in contributing to the Task Queue System! This document outlines how to contribute effectively.

## Code Standards

### Formatting

All code must be formatted with `cargo fmt`:

```bash
cargo fmt --all
```

Pre-commit hook (optional):
```bash
git config core.hooksPath .githooks
```

### Linting

All code must pass `cargo clippy` without warnings:

```bash
cargo clippy --all -- -D warnings
```

### Testing

- All public APIs must have unit tests
- Target >80% code coverage
- Run tests before committing:

```bash
cargo test --all
```

### Documentation

- All public items must have doc comments
- Include usage examples in doc comments
- Generate and review documentation:

```bash
cargo doc --all --no-deps --open
```

## Development Setup

### Prerequisites

- Rust 1.70+ (stable channel)
- Git
- Docker (for integration tests)

### Initial Setup

```bash
git clone https://github.com/your-fork/task-queue.git
cd task-queue
make dev-setup
cargo build
cargo test
```

### Running Locally

Start broker:
```bash
make run-broker
```

In another terminal, start worker:
```bash
make run-worker
```

In another terminal, submit a task:
```bash
make run-admin
```

## Project Structure

```
task-queue/
├── crates/
│   ├── task-queue-core/       # Core types and serialization
│   ├── task-queue-broker/     # Broker implementation
│   ├── task-queue-worker/     # Worker implementation
│   ├── task-queue-client/     # Client libraries
│   └── task-queue-cli/        # CLI tool
├── docs/                       # Documentation
├── monitoring/                 # Monitoring configs
├── Makefile                   # Development commands
├── Cargo.toml                 # Workspace config
└── README.md                  # Project overview
```

## Making Changes

### 1. Create a branch

```bash
git checkout -b feature/your-feature-name
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring

### 2. Make your changes

- Keep commits small and focused
- Write clear commit messages
- Test frequently with `cargo test`

### 3. Format and lint

```bash
make check
cargo test --all
```

### 4. Commit

```bash
git commit -m "Brief description of changes"
```

Commit message guidelines:
- First line: concise summary (50 chars max)
- Blank line
- Detailed explanation (if needed)
- Reference issues: "Fixes #123"

### 5. Push and create PR

```bash
git push origin feature/your-feature-name
```

## Pull Request Process

1. **Ensure tests pass**: `cargo test --all`
2. **Check formatting**: `make check`
3. **Update documentation** if adding public APIs
4. **Fill out PR template**:
   - Describe the changes
   - Reference related issues
   - Include testing notes

5. **Respond to code review**: Address feedback and push updates

## Testing Guidelines

### Unit Tests

Place in the same file, in a `tests` module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_functionality() {
        // Arrange
        let input = ...;

        // Act
        let result = function_under_test(input);

        // Assert
        assert_eq!(result, expected);
    }
}
```

### Integration Tests

Place in `tests/` directory at crate root:

```rust
// tests/integration_test.rs
#[tokio::test]
async fn test_end_to_end_workflow() {
    // Start broker
    // Start worker
    // Submit task
    // Wait for completion
}
```

### Property-Based Tests

Use `proptest` for properties:

```rust
#[cfg(test)]
mod tests {
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn test_serialization_roundtrip(task in task_strategy()) {
            let serialized = serialize_task(&task).unwrap();
            let deserialized = deserialize_task(&serialized).unwrap();
            prop_assert_eq!(task.id, deserialized.id);
        }
    }
}
```

## Common Tasks

### Adding a New Feature

1. Create module in appropriate crate
2. Implement functionality
3. Add unit tests
4. Add integration test if cross-crate
5. Update documentation
6. Submit PR

### Fixing a Bug

1. Write failing test that reproduces bug
2. Fix the bug
3. Verify test passes
4. Submit PR with test included

### Improving Performance

1. Add benchmark if relevant
2. Profile and identify bottleneck
3. Implement optimization
4. Verify performance improvement
5. Ensure no functionality changes
6. Document the change

### Updating Dependencies

1. Update Cargo.toml
2. Run `cargo update`
3. Test thoroughly
4. Document any breaking changes

## Documentation

### README Updates

Update `README.md` for:
- API changes
- New features
- Installation changes
- Configuration changes

### API Documentation

Update `docs/api.md` for:
- New endpoints
- Changed response formats
- New message types

### Architecture Documentation

Update `docs/architecture.md` for:
- New components
- Changed data flow
- Performance characteristics

### Deployment Updates

Update `docs/deployment.md` for:
- New deployment options
- Configuration changes
- Monitoring setup changes

## Performance Considerations

When submitting code:

1. **Consider algorithmic complexity**
   - O(log n) preferred over O(n)
   - Avoid nested loops when possible

2. **Minimize allocations**
   - Reuse buffers where possible
   - Use stack over heap when appropriate

3. **Use async/await properly**
   - Don't block async code
   - Use tokio tasks for parallelism

4. **Profile before optimizing**
   - Use flamegraph or perf
   - Measure before and after

## Security Considerations

When submitting code involving:

1. **Network communication**
   - Validate all inputs
   - Use TLS by default
   - Consider timeout handling

2. **Cryptography**
   - Use well-established libraries
   - Never implement your own crypto

3. **Authentication/Authorization**
   - Use secure comparisons
   - Hash passwords with bcrypt
   - Validate API keys

## Reporting Bugs

Use GitHub Issues with template:

**Title**: Brief description

**Description**:
1. Steps to reproduce
2. Expected behavior
3. Actual behavior
4. Logs/error messages
5. Environment (OS, Rust version)

## Suggesting Enhancements

Use GitHub Discussions with:
- Detailed use case
- Proposed solution
- Alternative approaches
- Potential impact

## Getting Help

- **Questions**: GitHub Discussions
- **Bugs**: GitHub Issues
- **Chat**: (add Discord/Slack link if available)
- **Code review**: Ask in PR comments

## Code Review Guidelines

When reviewing code:

1. **Check functionality**
   - Does it solve the stated problem?
   - Are there edge cases?

2. **Check quality**
   - Follows code standards?
   - Adequate test coverage?
   - Clear and maintainable?

3. **Check documentation**
   - Updated READMEs?
   - Doc comments added?
   - Examples provided?

4. **Be respectful**
   - Provide constructive feedback
   - Suggest improvements, don't demand
   - Acknowledge effort

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (MIT).

## Recognition

Contributors will be recognized in:
- README.md contributors section
- Release notes for significant contributions
- CONTRIBUTORS file
