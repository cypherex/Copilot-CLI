//! Raft Node - Represents a peer in the Raft cluster
//!
//! This module handles RPC communication with other Raft nodes.

use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};


use crate::raft::{RaftRequest, RaftResponse, AppendEntriesRequest, AppendEntriesResponse,
                  RequestVoteRequest, RequestVoteResponse, InstallSnapshotRequest, InstallSnapshotResponse};

/// Represents a peer node in the Raft cluster
#[derive(Clone)]
pub struct RaftNode {
    /// Unique identifier for this node
    pub node_id: String,
    /// Network address (host:port)
    pub address: String,
    /// Request timeout
    timeout: Duration,
}

impl RaftNode {
    /// Create a new Raft node
    pub fn new(node_id: String, address: String) -> Self {
        Self {
            node_id,
            address,
            timeout: Duration::from_secs(5),
        }
    }
    
    /// Set the request timeout
    pub fn with_timeout(mut self, timeout: Duration) -> Self {
        self.timeout = timeout;
        self
    }
    
    /// Connect to the node via TCP
    async fn connect(&self) -> Result<TcpStream, std::io::Error> {
        TcpStream::connect(&self.address).await
    }
    
    /// Send an RPC request and wait for response
    async fn send_rpc(&self, request: &RaftRequest) -> Result<RaftResponse, String> {
        // Serialize the request
        let serialized = bincode::serialize(request)
            .map_err(|e| format!("Failed to serialize request: {}", e))?;
        
        // Connect to peer
        let mut stream = self.connect().await
            .map_err(|e| format!("Failed to connect to {}: {}", self.address, e))?;
        
        // Send length prefix (4 bytes big-endian)
        let length = serialized.len() as u32;
        stream.write_all(&length.to_be_bytes()).await
            .map_err(|e| format!("Failed to write length: {}", e))?;
        
        // Send request body
        stream.write_all(&serialized).await
            .map_err(|e| format!("Failed to write request: {}", e))?;
        stream.flush().await
            .map_err(|e| format!("Failed to flush: {}", e))?;
        
        // Read response length
        let mut len_buf = [0u8; 4];
        stream.read_exact(&mut len_buf).await
            .map_err(|e| format!("Failed to read response length: {}", e))?;
        let response_length = u32::from_be_bytes(len_buf) as usize;
        
        // Read response body
        let mut response_buf = vec![0u8; response_length];
        stream.read_exact(&mut response_buf).await
            .map_err(|e| format!("Failed to read response: {}", e))?;
        
        // Deserialize response
        let response: RaftResponse = bincode::deserialize(&response_buf)
            .map_err(|e| format!("Failed to deserialize response: {}", e))?;
        
        Ok(response)
    }
    
    /// Send AppendEntries RPC
    pub async fn send_append_entries(&self, request: AppendEntriesRequest) -> Result<AppendEntriesResponse, String> {
        let raft_request = RaftRequest::AppendEntries(request);
        let raft_response = tokio::time::timeout(self.timeout, self.send_rpc(&raft_request)).await
            .map_err(|_| "Request timed out".to_string())??;
        
        match raft_response {
            RaftResponse::AppendEntries(response) => Ok(response),
            RaftResponse::Error(msg) => Err(msg),
            _ => Err("Unexpected response type".to_string()),
        }
    }
    
    /// Send RequestVote RPC
    pub async fn send_request_vote(&self, request: RequestVoteRequest) -> Result<RequestVoteResponse, String> {
        let raft_request = RaftRequest::RequestVote(request);
        let raft_response = tokio::time::timeout(self.timeout, self.send_rpc(&raft_request)).await
            .map_err(|_| "Request timed out".to_string())??;
        
        match raft_response {
            RaftResponse::RequestVote(response) => Ok(response),
            RaftResponse::Error(msg) => Err(msg),
            _ => Err("Unexpected response type".to_string()),
        }
    }
    
    /// Send InstallSnapshot RPC
    pub async fn send_install_snapshot(&self, request: InstallSnapshotRequest) -> Result<InstallSnapshotResponse, String> {
        let raft_request = RaftRequest::InstallSnapshot(request);
        let raft_response = tokio::time::timeout(Duration::from_secs(30), self.send_rpc(&raft_request)).await
            .map_err(|_| "Request timed out".to_string())??;
        
        match raft_response {
            RaftResponse::InstallSnapshot(response) => Ok(response),
            RaftResponse::Error(msg) => Err(msg),
            _ => Err("Unexpected response type".to_string()),
        }
    }
}

/// Raft RPC server - handles incoming RPC requests from peers
pub struct RaftRpcServer {
    address: String,
    raft_handle: RaftServerHandle,
}

impl RaftRpcServer {
    /// Create a new RPC server
    pub fn new(address: String, raft_handle: RaftServerHandle) -> Self {
        Self {
            address,
            raft_handle,
        }
    }
    
    /// Start the RPC server
    pub async fn serve(self) -> Result<(), Box<dyn std::error::Error>> {
        use tokio::net::TcpListener;
        
        let listener = TcpListener::bind(&self.address).await?;
        tracing::info!("Raft RPC server listening on {}", self.address);
        
        loop {
            match listener.accept().await {
                Ok((stream, addr)) => {
                    let handle = self.raft_handle.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_connection(stream, handle).await {
                            tracing::warn!("Error handling connection from {}: {}", addr, e);
                        }
                    });
                }
                Err(e) => {
                    tracing::error!("Failed to accept connection: {}", e);
                }
            }
        }
    }
}

/// Handle a single client connection
async fn handle_connection(
    mut stream: TcpStream,
    handle: RaftServerHandle,
) -> Result<(), String> {
    // Read request length
    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).await
        .map_err(|e| format!("Failed to read request length: {}", e))?;
    let request_length = u32::from_be_bytes(len_buf) as usize;
    
    // Read request body
    let mut request_buf = vec![0u8; request_length];
    stream.read_exact(&mut request_buf).await
        .map_err(|e| format!("Failed to read request: {}", e))?;
    
    // Deserialize request
    let request: RaftRequest = bincode::deserialize(&request_buf)
        .map_err(|e| format!("Failed to deserialize request: {}", e))?;
    
    // Process request and get response
    let response = handle.process_request(request).await;
    
    // Serialize response
    let serialized = bincode::serialize(&response)
        .map_err(|e| format!("Failed to serialize response: {}", e))?;
    
    // Send response length
    let length = serialized.len() as u32;
    stream.write_all(&length.to_be_bytes()).await
        .map_err(|e| format!("Failed to write length: {}", e))?;
    
    // Send response body
    stream.write_all(&serialized).await
        .map_err(|e| format!("Failed to write response: {}", e))?;
    stream.flush().await
        .map_err(|e| format!("Failed to flush: {}", e))?;
    
    Ok(())
}

/// Handle for processing Raft RPC requests
#[derive(Clone)]
pub struct RaftServerHandle {
    handle_append_entries: Arc<dyn Fn(AppendEntriesRequest) -> AppendEntriesResponse + Send + Sync>,
    handle_request_vote: Arc<dyn Fn(RequestVoteRequest) -> RequestVoteResponse + Send + Sync>,
    handle_install_snapshot: Arc<dyn Fn(InstallSnapshotRequest) -> InstallSnapshotResponse + Send + Sync>,
}

impl RaftServerHandle {
    /// Create a new Raft server handle
    pub fn new<F1, F2, F3>(
        handle_append_entries: F1,
        handle_request_vote: F2,
        handle_install_snapshot: F3,
    ) -> Self
    where
        F1: Fn(AppendEntriesRequest) -> AppendEntriesResponse + Send + Sync + 'static,
        F2: Fn(RequestVoteRequest) -> RequestVoteResponse + Send + Sync + 'static,
        F3: Fn(InstallSnapshotRequest) -> InstallSnapshotResponse + Send + Sync + 'static,
    {
        Self {
            handle_append_entries: Arc::new(handle_append_entries),
            handle_request_vote: Arc::new(handle_request_vote),
            handle_install_snapshot: Arc::new(handle_install_snapshot),
        }
    }
    
    /// Process a Raft RPC request
    pub async fn process_request(&self, request: RaftRequest) -> RaftResponse {
        match request {
            RaftRequest::AppendEntries(req) => {
                RaftResponse::AppendEntries((self.handle_append_entries)(req))
            }
            RaftRequest::RequestVote(req) => {
                RaftResponse::RequestVote((self.handle_request_vote)(req))
            }
            RaftRequest::InstallSnapshot(req) => {
                RaftResponse::InstallSnapshot((self.handle_install_snapshot)(req))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_node_creation() {
        let node = RaftNode::new("node1".to_string(), "127.0.0.1:8080".to_string());
        assert_eq!(node.node_id, "node1");
        assert_eq!(node.address, "127.0.0.1:8080");
    }
    
    #[test]
    fn test_node_with_timeout() {
        let node = RaftNode::new("node1".to_string(), "127.0.0.1:8080".to_string())
            .with_timeout(Duration::from_secs(10));
        assert_eq!(node.timeout, Duration::from_secs(10));
    }
}