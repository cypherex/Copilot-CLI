# Raft Consensus Implementation

This module provides a complete implementation of the Raft consensus algorithm for the distributed task queue system.

## Features

- **Leader Election**: Automatic leader election with randomized timeouts
- **Log Replication**: Consistent log replication across the cluster
- **Majority-based Commit**: Commands are committed only after majority acknowledgment
- **Fault Tolerance**: Continues operating with N/2 + 1 nodes available
- **Snapshot Support**: Efficient log compaction via snapshots
- **Flexible State Machine**: Pluggable state machine interface

## Architecture

### Components

1. **Raft Core (`raft.rs`)**
   - Main Raft consensus implementation
   - Handles leader election, log replication, and commit logic
   - Manages node state transitions (Follower → Candidate → Leader)

2. **Node (`node.rs`)**
   - Represents a peer in the Raft cluster
   - Handles RPC communication with other nodes
   - Implements TCP-based networking with custom protocol

3. **Log (`log.rs`)**
   - Persistent log of commands
   - Supports snapshots for log compaction
   - Efficient entry retrieval and truncation

4. **State Machine (`state_machine.rs`)**
   - Interface for applying replicated commands
   - Includes in-memory implementation for testing
   - Supports snapshot and restore operations

## Usage Example

```rust
use task_queue_raft::{Raft, MemoryStateMachine, create_raft};

// Create a 3-node cluster
let node_id = "node1".to_string();
let peers = vec!["node2".to_string(), "node3".to_string()];
let state_machine = MemoryStateMachine::new();

// Create and start Raft instance
let raft = create_raft(node_id, peers, state_machine);
raft.start().await?;

// Submit a command (only works on leader)
let result = raft.submit_command(b"my_command").await;
match result {
    RaftResult::Success(index) => println!("Command committed at index {}", index),
    RaftResult::NotLeader { leader_id } => println!("Redirect to leader: {:?}", leader_id),
    RaftResult::Error(e) => eprintln!("Error: {}", e),
}

// Check if this node is leader
if raft.is_leader().await {
    println!("This node is the leader");
}

// Get current term
let term = raft.get_term().await;
println!("Current term: {}", term);
```

## Configuration

```rust
use std::time::Duration;
use task_queue_raft::{Raft, RaftConfig, MemoryStateMachine};

let config = RaftConfig {
    node_id: "node1".to_string(),
    peers: vec!["node2".to_string(), "node3".to_string()],
    election_timeout_min: Duration::from_millis(1000),
    election_timeout_max: Duration::from_millis(2000),
    heartbeat_interval: Duration::from_millis(300),
    max_log_entries: 10000,
    snapshot_threshold: 5000,
};

let raft = Raft::new(config, MemoryStateMachine::new());
```

## RPC Protocol

The Raft implementation uses a custom TCP-based protocol:

1. **Message Format**:
   - 4-byte length prefix (big-endian)
   - Serialized `RaftRequest` message

2. **Request Types**:
   - `AppendEntries`: Heartbeats and log replication
   - `RequestVote`: Leader election voting
   - `InstallSnapshot`: Snapshot transfer

3. **Response Types**:
   - `AppendEntriesResponse`: Success/failure with mismatch info
   - `RequestVoteResponse`: Vote granted/denied
   - `InstallSnapshotResponse`: Snapshot acknowledgment

## Leader Election

1. Follower waits for `election_timeout` without receiving AppendEntries
2. Follower transitions to Candidate and increments current_term
3. Candidate votes for itself and sends RequestVote to all peers
4. If candidate receives majority of votes, becomes leader
5. Leader sends periodic heartbeats to maintain authority

## Log Replication

1. Client sends command to leader
2. Leader appends command to its log
3. Leader sends AppendEntries to all followers
4. Followers append entries to their logs and respond
5. Once entry is replicated to majority, leader commits it
6. Leader notifies followers via AppendEntries (leader_commit field)
7. Followers apply committed entries to state machine

## Safety Properties

- **Election Safety**: At most one leader per term
- **Leader Append-Only**: Leader never overwrites entries in its log
- **Log Matching**: If two logs contain an entry at same index, entries are identical
- **Leader Completeness**: If a log entry is committed, it's present in all future leaders' logs
- **State Machine Safety**: Applied entries are identical and in same order

## Testing

Run the test suite:

```bash
cargo test --package task_queue_raft
```

Tests cover:
- Log operations (append, truncate, snapshot)
- State machine apply/snapshot/restore
- Raft node creation and state management
- Command submission from leader/follower

## Performance Considerations

- **Network**: All RPC operations are asynchronous using tokio
- **Batching**: Leader can batch multiple log entries in single AppendEntries
- **Snapshotting**: Regular snapshots prevent unbounded log growth
- **Memory**: In-memory log with optional persistent state machine

## Cluster Size Recommendations

- **3 nodes**: Tolerate 1 failure (minimum for production)
- **5 nodes**: Tolerate 2 failures (recommended for higher fault tolerance)
- **7 nodes**: Tolerate 3 failures (for very large clusters)

Odd numbers are preferred to avoid split votes during elections.
