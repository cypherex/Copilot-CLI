//! Task Queue Core Library
//!
//! Provides core data structures and types for the distributed task queue system.

pub mod task;
pub mod message;
pub mod error;
pub mod serialization;
pub mod priority;

pub use task::{Task, TaskStatus, TaskId};
pub use message::{Message, MessageType};
pub use error::{TaskQueueError, Result};
pub use priority::{Priority, PriorityTier};
