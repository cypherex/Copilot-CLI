//! Task Queue Worker
//!
//! Worker process that executes tasks from the distributed task queue.
//!
//! # Features
//! - Unique worker identification (hostname + PID + random suffix)
//! - Configurable concurrency with parallel tokio tasks
//! - Graceful shutdown with 60 second timeout
//! - Pluggable task handlers registered by type name
//! - Async task execution with timeout enforcement
//! - Panic capture and error reporting
//! - Heartbeat every 15 seconds with CPU/memory stats
//! - Exponential backoff retry logic
//! - Dead letter queue for failed tasks

pub mod worker;
pub mod task_handler;
pub mod retry;
pub mod heartbeat;
pub mod executor;

pub use worker::{Worker, WorkerConfig};
pub use task_handler::{TaskHandler, HandlerRegistry};
pub use retry::{RetryPolicy, calculate_backoff};
pub use heartbeat::{Heartbeat, WorkerStats};
pub use executor::{TaskExecutor, ExecutionResult};
