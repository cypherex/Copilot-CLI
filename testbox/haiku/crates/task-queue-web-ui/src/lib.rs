//! Task Queue Web UI
//!
//! Provides a web interface for monitoring and managing the distributed task queue.

pub mod server;
pub mod handlers;
pub mod templates;

pub use server::WebUiServer;
