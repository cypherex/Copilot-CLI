mod store;
mod wal;

pub use store::{TaskStore, TaskStoreConfig};
pub use wal::WriteAheadLog;

use thiserror::Error;

#[derive(Error, Debug)]
pub enum PersistenceError {
    #[error("RocksDB error: {0}")]
    RocksDbError(#[from] rocksdb::Error),

    #[error("Task error: {0}")]
    TaskError(#[from] task_queue_core::TaskError),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] bincode::Error),

    #[error("Task not found: {0}")]
    TaskNotFound(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("WAL error: {0}")]
    WalError(String),

    #[error("Other error: {0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, PersistenceError>;
