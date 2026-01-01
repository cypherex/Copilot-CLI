mod task;
mod priority;
mod error;

pub use task::{Task, TaskId, TaskType, TaskPayload, TaskStatus};
pub use priority::Priority;
pub use error::{TaskError, Result};

pub const MAX_PAYLOAD_SIZE: usize = 10 * 1024 * 1024; // 10MB
