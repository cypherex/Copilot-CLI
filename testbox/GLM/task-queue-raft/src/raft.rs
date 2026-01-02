//! Raft Consensus Algorithm Implementation
//!
//! This module implements the core Raft consensus algorithm including:
//! - Leader election
//! - Log replication
//! - State machine commands
//! - RPC communication

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot, Mutex, RwLock};
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn, error};

use crate::node::RaftNode;
use crate::log::{RaftLog, LogEntry};
use crate::state_machine::StateMachine;

/// Raft node state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NodeState {
    Follower,
    Candidate,
    Leader,
}

/// Raft RPC request types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RaftRequest {
    AppendEntries(AppendEntriesRequest),
    RequestVote(RequestVoteRequest),
    InstallSnapshot(InstallSnapshotRequest),
}

/// Raft RPC response types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RaftResponse {
    AppendEntries(AppendEntriesResponse),
    RequestVote(RequestVoteResponse),
    InstallSnapshot(InstallSnapshotResponse),
    Error(String),
}

/// AppendEntries RPC request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppendEntriesRequest {
    pub term: u64,
    pub leader_id: String,
    pub prev_log_index: u64,
    pub prev_log_term: u64,
    pub entries: Vec<LogEntry>,
    pub leader_commit: u64,
}

/// AppendEntries RPC response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppendEntriesResponse {
    pub term: u64,
    pub success: bool,
    pub mismatch_index: Option<u64>,
}

/// RequestVote RPC request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestVoteRequest {
    pub term: u64,
    pub candidate_id: String,
    pub last_log_index: u64,
    pub last_log_term: u64,
}

/// RequestVote RPC response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestVoteResponse {
    pub term: u64,
    pub vote_granted: bool,
}

/// InstallSnapshot RPC request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallSnapshotRequest {
    pub term: u64,
    pub leader_id: String,
    pub last_included_index: u64,
    pub last_included_term: u64,
    pub data: Vec<u8>,
    pub done: bool,
}

/// InstallSnapshot RPC response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallSnapshotResponse {
    pub term: u64,
}

/// Configuration for Raft
#[derive(Debug, Clone)]
pub struct RaftConfig {
    /// Unique ID for this node
    pub node_id: String,
    /// IDs of all peers in the cluster
    pub peers: Vec<String>,
    /// Election timeout range (randomized between min and max)
    pub election_timeout_min: Duration,
    pub election_timeout_max: Duration,
    /// Heartbeat interval
    pub heartbeat_interval: Duration,
    /// Maximum number of log entries before snapshot
    pub max_log_entries: usize,
    /// Snapshot threshold
    pub snapshot_threshold: usize,
}

impl Default for RaftConfig {
    fn default() -> Self {
        Self {
            node_id: "node1".to_string(),
            peers: vec![],
            election_timeout_min: Duration::from_millis(1000),
            election_timeout_max: Duration::from_millis(2000),
            heartbeat_interval: Duration::from_millis(300),
            max_log_entries: 10000,
            snapshot_threshold: 5000,
        }
    }
}

/// Internal state of a Raft node
struct RaftState {
    current_term: u64,
    voted_for: Option<String>,
    state: NodeState,
    commit_index: u64,
    last_applied: u64,
    // Leader state
    next_index: HashMap<String, u64>,
    match_index: HashMap<String, u64>,
    // Timing
    last_heartbeat: Instant,
    election_timeout: Duration,
}

/// Result of a Raft operation
pub enum RaftResult<T> {
    Success(T),
    NotLeader { leader_id: Option<String> },
    Error(String),
}

/// Main Raft consensus implementation
pub struct Raft<SM: StateMachine + Send + Sync + 'static> {
    config: RaftConfig,
    state: Arc<RwLock<RaftState>>,
    log: Arc<Mutex<RaftLog>>,
    state_machine: Arc<Mutex<SM>>,
    nodes: Arc<Mutex<HashMap<String, RaftNode>>>,
    
    // Channels for RPC communication
    request_tx: mpsc::UnboundedSender<(RaftRequest, oneshot::Sender<RaftResponse>)>,
    request_rx: Arc<Mutex<mpsc::UnboundedReceiver<(RaftRequest, oneshot::Sender<RaftResponse>)>>>,
    
    // Background task handles
    election_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    heartbeat_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    apply_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

impl<SM: StateMachine + Send + Sync + 'static> Raft<SM> {
    /// Create a new Raft instance
    pub fn new(config: RaftConfig, state_machine: SM) -> Self {
        let (request_tx, request_rx) = mpsc::unbounded_channel();
        
        let election_timeout = Self::random_election_timeout(&config);
        
        let state = RaftState {
            current_term: 0,
            voted_for: None,
            state: NodeState::Follower,
            commit_index: 0,
            last_applied: 0,
            next_index: HashMap::new(),
            match_index: HashMap::new(),
            last_heartbeat: Instant::now(),
            election_timeout,
        };
        
        let mut next_index = HashMap::new();
        let mut match_index = HashMap::new();
        for peer in &config.peers {
            next_index.insert(peer.clone(), 1);
            match_index.insert(peer.clone(), 0);
        }
        
        Self {
            config,
            state: Arc::new(RwLock::new(state)),
            log: Arc::new(Mutex::new(RaftLog::new())),
            state_machine: Arc::new(Mutex::new(state_machine)),
            nodes: Arc::new(Mutex::new(HashMap::new())),
            request_tx,
            request_rx: Arc::new(Mutex::new(request_rx)),
            election_task: Arc::new(Mutex::new(None)),
            heartbeat_task: Arc::new(Mutex::new(None)),
            apply_task: Arc::new(Mutex::new(None)),
        }
    }
    
    /// Generate a random election timeout
    fn random_election_timeout(config: &RaftConfig) -> Duration {
        let range = config.election_timeout_max - config.election_timeout_min;
        let random_ms = fastrand::u64(0..range.as_millis() as u64);
        config.election_timeout_min + Duration::from_millis(random_ms)
    }
    
    /// Start the Raft node
    pub async fn start(&self) -> Result<(), Box<dyn std::error::Error>> {
        info!("Starting Raft node {}", self.config.node_id);
        
        // Start background tasks
        self.start_election_task().await;
        self.start_heartbeat_task().await;
        self.start_apply_task().await;
        
        info!("Raft node {} started", self.config.node_id);
        Ok(())
    }
    
    /// Stop the Raft node
    pub async fn stop(&self) {
        info!("Stopping Raft node {}", self.config.node_id);
        
        // Abort background tasks
        if let Some(task) = self.election_task.lock().await.take() {
            task.abort();
        }
        if let Some(task) = self.heartbeat_task.lock().await.take() {
            task.abort();
        }
        if let Some(task) = self.apply_task.lock().await.take() {
            task.abort();
        }
    }
    
    /// Submit a command to the Raft cluster
    pub async fn submit_command(&self, command: Vec<u8>) -> RaftResult<u64> {
        let state = self.state.read().await;
        if state.state != NodeState::Leader {
            return RaftResult::NotLeader { leader_id: None };
        }
        drop(state);
        
        let mut log = self.log.lock().await;
        let entry = LogEntry {
            term: self.state.read().await.current_term,
            index: log.last_index() + 1,
            command,
        };
        log.append(vec![entry.clone()]);
        drop(log);
        
        info!("Command submitted at index {}", entry.index);
        RaftResult::Success(entry.index)
    }
    
    /// Get the current leader ID
    pub async fn get_leader(&self) -> Option<String> {
        let state = self.state.read().await;
        match state.state {
            NodeState::Leader => Some(self.config.node_id.clone()),
            _ => None,
        }
    }
    
    /// Get the current term
    pub async fn get_term(&self) -> u64 {
        self.state.read().await.current_term
    }
    
    /// Check if this node is the leader
    pub async fn is_leader(&self) -> bool {
        self.state.read().await.state == NodeState::Leader
    }
    
    /// Handle an AppendEntries RPC request
    pub async fn handle_append_entries(&self, req: AppendEntriesRequest) -> AppendEntriesResponse {
        let mut state = self.state.write().await;
        
        // Reply false if term < currentTerm
        if req.term < state.current_term {
            return AppendEntriesResponse {
                term: state.current_term,
                success: false,
                mismatch_index: None,
            };
        }
        
        // If term > currentTerm, become follower
        if req.term > state.current_term {
            state.current_term = req.term;
            state.state = NodeState::Follower;
            state.voted_for = None;
            state.election_timeout = Self::random_election_timeout(&self.config);
        }
        
        state.last_heartbeat = Instant::now();
        drop(state);
        
        let mut log = self.log.lock().await;
        
        // Reply false if log doesn't contain an entry at prev_log_index whose term matches prev_log_term
        if let Some(entry) = log.get_entry(req.prev_log_index) {
            if entry.term != req.prev_log_term {
                // Find the first index where terms mismatch
                let mismatch_index = self.find_mismatch_index(&log, req.prev_log_index, req.prev_log_term);
                return AppendEntriesResponse {
                    term: self.state.read().await.current_term,
                    success: false,
                    mismatch_index: Some(mismatch_index),
                };
            }
        } else if req.prev_log_index > 0 {
            // prev_log_index doesn't exist
            let mismatch_index = log.last_index().saturating_add(1);
            return AppendEntriesResponse {
                term: self.state.read().await.current_term,
                success: false,
                mismatch_index: Some(mismatch_index),
            };
        }
        
        // If existing entries conflict with new entries, delete them
        log.truncate_from(req.prev_log_index + 1);
        
        // Append new entries
        log.append(req.entries);
        drop(log);
        
        // Update commit index
        let mut state = self.state.write().await;
        if req.leader_commit > state.commit_index {
            let log = self.log.lock().await;
            state.commit_index = std::cmp::min(req.leader_commit, log.last_index());
            drop(log);
        }
        
        AppendEntriesResponse {
            term: state.current_term,
            success: true,
            mismatch_index: None,
        }
    }
    
    /// Find the first index where terms mismatch
    fn find_mismatch_index(&self, log: &RaftLog, prev_index: u64, prev_term: u64) -> u64 {
        for i in (1..=prev_index).rev() {
            if let Some(entry) = log.get_entry(i) {
                if entry.term == prev_term {
                    return i + 1;
                }
            }
        }
        1
    }
    
    /// Handle a RequestVote RPC request
    pub async fn handle_request_vote(&self, req: RequestVoteRequest) -> RequestVoteResponse {
        let mut state = self.state.write().await;
        
        // Reply false if term < currentTerm
        if req.term < state.current_term {
            return RequestVoteResponse {
                term: state.current_term,
                vote_granted: false,
            };
        }
        
        // If term > currentTerm, become follower and reset voted_for
        if req.term > state.current_term {
            state.current_term = req.term;
            state.state = NodeState::Follower;
            state.voted_for = None;
            state.election_timeout = Self::random_election_timeout(&self.config);
        }
        
        // Check if we can grant vote
        let log = self.log.lock().await;
        let last_log_term = log.get_entry(log.last_index())
            .map(|e| e.term)
            .unwrap_or(0);
        let last_log_index = log.last_index();
        drop(log);
        
        let vote_granted = if state.voted_for.is_none() || state.voted_for.as_ref() == Some(&req.candidate_id) {
            (req.last_log_term > last_log_term) ||
            (req.last_log_term == last_log_term && req.last_log_index >= last_log_index)
        } else {
            false
        };
        
        if vote_granted {
            state.voted_for = Some(req.candidate_id.clone());
            state.election_timeout = Self::random_election_timeout(&self.config);
            info!("Granted vote to candidate {} for term {}", req.candidate_id, req.term);
        }
        
        RequestVoteResponse {
            term: state.current_term,
            vote_granted,
        }
    }
    
    /// Become a candidate and start an election
    async fn start_election(&self) {
        let mut state = self.state.write().await;
        
        // Only start election if we're a follower and haven't received a heartbeat recently
        if state.state != NodeState::Follower {
            return;
        }
        
        if state.last_heartbeat.elapsed() < state.election_timeout {
            return;
        }
        
        info!("Starting election for node {}", self.config.node_id);
        
        // Transition to candidate
        state.current_term += 1;
        state.state = NodeState::Candidate;
        state.voted_for = Some(self.config.node_id.clone());
        state.election_timeout = Self::random_election_timeout(&self.config);
        let current_term = state.current_term;
        let last_log_index = self.log.lock().await.last_index();
        let last_log_term = self.log.lock().await.get_entry(last_log_index)
            .map(|e| e.term)
            .unwrap_or(0);
        drop(state);
        
        // Send RequestVote to all peers
        let request = RequestVoteRequest {
            term: current_term,
            candidate_id: self.config.node_id.clone(),
            last_log_index,
            last_log_term,
        };
        
        let nodes = self.nodes.lock().await;
        let peers: Vec<_> = self.config.peers.iter()
            .filter(|peer| nodes.contains_key(*peer))
            .cloned()
            .collect();
        drop(nodes);
        
        let mut votes_received = 1; // Vote for self
        let votes_needed = (self.config.peers.len() / 2) + 2; // Majority including self
        
        for peer in peers {
            let node = {
                let nodes = self.nodes.lock().await;
                nodes.get(&peer).cloned()
            };
            
            if let Some(node) = node {
                match node.send_request_vote(request.clone()).await {
                    Ok(response) => {
                        if response.vote_granted {
                            votes_received += 1;
                            info!("Received vote from {} for term {}", peer, current_term);
                        } else if response.term > current_term {
                            // A higher term exists, revert to follower
                            let mut state = self.state.write().await;
                            state.current_term = response.term;
                            state.state = NodeState::Follower;
                            state.voted_for = None;
                            return;
                        }
                    }
                    Err(e) => {
                        warn!("Failed to send RequestVote to {}: {}", peer, e);
                    }
                }
            }
        }
        
        // Check if we won the election
        if votes_received >= votes_needed {
            let mut state = self.state.write().await;
            if state.current_term == current_term && state.state == NodeState::Candidate {
                state.state = NodeState::Leader;
                let last_index = self.log.lock().await.last_index();
                state.next_index.clear();
                state.match_index.clear();
                for peer in &self.config.peers {
                    state.next_index.insert(peer.clone(), last_index + 1);
                    state.match_index.insert(peer.clone(), 0);
                }
                info!("Node {} became leader for term {}", self.config.node_id, current_term);
            }
        } else {
            info!("Election lost for term {} (received {}/{} votes)", 
                  current_term, votes_received, votes_needed);
        }
    }
    
    /// Send heartbeats to all followers (leader only)
    async fn send_heartbeats(&self) {
        let state = self.state.read().await;
        if state.state != NodeState::Leader {
            return;
        }
        let commit_index = state.commit_index;
        let current_term = state.current_term;
        let leader_id = self.config.node_id.clone();
        drop(state);
        
        let nodes = self.nodes.lock().await;
        let peers: Vec<_> = self.config.peers.iter()
            .filter(|peer| nodes.contains_key(*peer))
            .cloned()
            .collect();
        drop(nodes);
        
        for peer in peers {
            let (prev_log_index, prev_log_term, entries) = {
                let state = self.state.read().await;
                let next_index = *state.next_index.get(&peer).unwrap_or(&1);
                let log = self.log.lock().await;
                let prev_log_term = log.get_entry(next_index.saturating_sub(1))
                    .map(|e| e.term)
                    .unwrap_or(0);
                let entries: Vec<LogEntry> = log.entries_from(next_index).collect();
                drop(log);
                (next_index, prev_log_term, entries)
            };
            
            let request = AppendEntriesRequest {
                term: current_term,
                leader_id: leader_id.clone(),
                prev_log_index,
                prev_log_term,
                entries,
                leader_commit: commit_index,
            };
            
            let node = {
                let nodes = self.nodes.lock().await;
                nodes.get(&peer).cloned()
            };
            
            if let Some(node) = node {
                let peer_id = peer.clone();
                let state_clone = Arc::clone(&self.state);
                let log_clone = Arc::clone(&self.log);
                let my_term = current_term;
                let peers_len = self.config.peers.len();
                
                tokio::spawn(async move {
                    match node.send_append_entries(request).await {
                        Ok(response) => {
                            if response.success {
                                // Update match_index and next_index
                                let mut state = state_clone.write().await;
                                let last_index = log_clone.lock().await.last_index();
                                state.match_index.insert(peer_id.clone(), last_index);
                                state.next_index.insert(peer_id.clone(), last_index + 1);
                                
                                // Check if we can commit more entries
                                let mut match_indices: Vec<u64> = state.match_index.values().cloned().collect();
                                match_indices.push(state.commit_index);
                                match_indices.sort_by(|a, b| b.cmp(a));
                                let majority_index = match_indices[peers_len / 2];
                                
                                if majority_index > state.commit_index {
                                    let log = log_clone.lock().await;
                                    if let Some(entry) = log.get_entry(majority_index) {
                                        if entry.term == state.current_term {
                                            state.commit_index = majority_index;
                                            debug!("Commit index advanced to {}", majority_index);
                                        }
                                    }
                                }
                            } else if let Some(mismatch_index) = response.mismatch_index {
                                // Backtrack next_index
                                let mut state = state_clone.write().await;
                                state.next_index.insert(peer_id.clone(), mismatch_index);
                            } else if response.term > my_term {
                                // Step down as leader
                                let mut state = state_clone.write().await;
                                state.current_term = response.term;
                                state.state = NodeState::Follower;
                            }
                        }
                        Err(e) => {
                            debug!("Failed to send heartbeat to {}: {}", peer, e);
                        }
                    }
                });
            }
        }
    }
    
    /// Start the election timeout task
    async fn start_election_task(&self) {
        let state = Arc::clone(&self.state);
        let task = tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(100)).await;
                let s = state.read().await;
                if s.state == NodeState::Follower && s.last_heartbeat.elapsed() >= s.election_timeout {
                    drop(s);
                    // Trigger election (will be handled by main loop)
                }
            }
        });
        *self.election_task.lock().await = Some(task);
    }
    
    /// Start the heartbeat task
    async fn start_heartbeat_task(&self) {
        let heartbeat_interval = self.config.heartbeat_interval;
        let state = Arc::clone(&self.state);
        
        let task = tokio::spawn(async move {
            loop {
                tokio::time::sleep(heartbeat_interval).await;
                let s = state.read().await;
                if s.state == NodeState::Leader {
                    // Send heartbeats (will be handled by main loop)
                }
            }
        });
        *self.heartbeat_task.lock().await = Some(task);
    }
    
    /// Start the log application task
    async fn start_apply_task(&self) {
        let state = Arc::clone(&self.state);
        let log = Arc::clone(&self.log);
        let state_machine = Arc::clone(&self.state_machine);
        
        let task = tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(50)).await;
                
                let mut s = state.write().await;
                while s.last_applied < s.commit_index {
                    s.last_applied += 1;
                    let index = s.last_applied;
                    drop(s);
                    
                    let entry = {
                        let l = log.lock().await;
                        l.get_entry(index).cloned()
                    };
                    
                    if let Some(entry) = entry {
                        let mut sm = state_machine.lock().await;
                        if let Err(e) = sm.apply(entry.command) {
                            error!("Failed to apply entry {}: {}", index, e);
                        }
                    }
                    
                    s = state.write().await;
                }
            }
        });
        *self.apply_task.lock().await = Some(task);
    }
    
    /// Add a peer node
    pub async fn add_peer(&self, node_id: String, node: RaftNode) {
        let mut nodes = self.nodes.lock().await;
        nodes.insert(node_id.clone(), node);
        info!("Added peer node: {}", node_id);
    }
    
    /// Remove a peer node
    pub async fn remove_peer(&self, node_id: &str) {
        let mut nodes = self.nodes.lock().await;
        nodes.remove(node_id);
        info!("Removed peer node: {}", node_id);
    }
}

/// Helper function to create a new Raft instance with default configuration
pub fn create_raft<SM: StateMachine + Send + Sync + 'static>(
    node_id: String,
    peers: Vec<String>,
    state_machine: SM,
) -> Raft<SM> {
    let config = RaftConfig {
        node_id,
        peers,
        ..Default::default()
    };
    Raft::new(config, state_machine)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state_machine::MemoryStateMachine;
    
    #[tokio::test]
    async fn test_raft_creation() {
        let state_machine = MemoryStateMachine::new();
        let raft = create_raft("node1".to_string(), vec!["node2".to_string()], state_machine);
        assert!(!raft.is_leader().await);
        assert_eq!(raft.get_term().await, 0);
    }
    
    #[tokio::test]
    async fn test_submit_command_as_follower() {
        let state_machine = MemoryStateMachine::new();
        let raft = create_raft("node1".to_string(), vec!["node2".to_string()], state_machine);
        let result = raft.submit_command(vec![1, 2, 3]).await;
        matches!(result, RaftResult::NotLeader { .. });
    }
}