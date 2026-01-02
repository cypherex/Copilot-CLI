//! Task Queue Client Library
//!
//! Blocking and async clients for the task queue.

pub mod blocking;
pub mod async_client;
pub mod connection;

pub use blocking::TaskQueueClient;
pub use async_client::TaskQueueAsyncClient;