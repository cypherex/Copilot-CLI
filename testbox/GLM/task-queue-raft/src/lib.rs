//! Raft Consensus Implementation
//!
//! This module provides Raft consensus for broker clustering.

pub mod raft;
pub mod node;
pub mod log;
pub mod state_machine;

pub use raft::{Raft, RaftConfig, RaftResult, create_raft, NodeState};
pub use node::RaftNode;
pub use log::RaftLog;
pub use state_machine::{StateMachine, MemoryStateMachine, create_set_command, create_delete_command};
