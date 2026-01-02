# Issue: Cargo.toml References Non-Existent Binary

## Problem
The `Cargo.toml` file defines a binary:
```toml
[[bin]]
name = "tq-broker"
path = "src/main.rs"
```

But `src/main.rs` does not exist. This causes `cargo check` to fail.

## Solution Options

### Option 1: Comment out the binary (RECOMMENDED)
Since the current task is to implement the **library** (broker.rs and config.rs), not the binary, we should comment out or remove the binary section from Cargo.toml.

### Option 2: Create a minimal main.rs (OUT OF SCOPE)
Creating a binary is future work, not part of the current task.

## Recommended Fix
Remove or comment out the `[[bin]]` section from Cargo.toml since main.rs implementation is explicitly marked as "Future Work".
