//! Task Queue Core Library
//!
//! This library provides the core data structures and protocols for the distributed task queue system.

pub mod task;
pub mod protocol;
pub mod priority;
pub mod error;
pub mod serde;

pub use task::{Task, TaskId, TaskStatus, TaskResult, TaskType, TaskPriority};
pub use protocol::{Message, MessageType, Frame};
pub use priority::Priority;
pub use error::{CoreError, Result};
