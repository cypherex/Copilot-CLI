//! Task Queue Client Library
//!
//! This library provides both blocking and async clients for the task queue system.

pub mod blocking;
pub mod r#async;
pub mod error;

pub use blocking::TaskQueueClient;
pub use r#async::TaskQueueAsyncClient;
pub use error::{ClientError, Result};

pub use task_queue_core::{
    task::{Task, TaskId, TaskPriority, TaskResult, TaskStatus},
    Priority,
};
