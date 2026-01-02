//! Integration test demonstrating Raft functionality

#[cfg(test)]
mod integration_tests {
    use std::time::Duration;
    use task_queue_raft::{
        Raft, RaftConfig, MemoryStateMachine, StateMachine,
        RaftResult, create_set_command, create_delete_command, create_raft,
    };

    #[tokio::test]
    async fn test_raft_complete_workflow() {
        // Create 3-node cluster configuration
        let config = RaftConfig {
            node_id: "node1".to_string(),
            peers: vec!["node2".to_string(), "node3".to_string()],
            election_timeout_min: Duration::from_millis(500),
            election_timeout_max: Duration::from_millis(1000),
            heartbeat_interval: Duration::from_millis(200),
            max_log_entries: 1000,
            snapshot_threshold: 500,
        };

        let state_machine = MemoryStateMachine::new();
        let raft = Raft::new(config, state_machine);

        // Verify initial state
        assert_eq!(raft.get_term().await, 0);
        assert!(!raft.is_leader().await);

        // Submit command as follower should fail
        let result = raft.submit_command(b"test_command".to_vec()).await;
        assert!(matches!(result, RaftResult::NotLeader { .. }));
    }

    #[tokio::test]
    async fn test_state_machine_operations() {
        let mut sm = MemoryStateMachine::new();

        // Test set command
        let set_cmd = create_set_command("key1".to_string(), vec![1, 2, 3]);
        sm.apply(set_cmd).unwrap();
        assert_eq!(sm.get("key1"), Some(&[1, 2, 3][..]));
        assert_eq!(sm.len(), 1);

        // Test delete command
        let del_cmd = create_delete_command("key1".to_string());
        sm.apply(del_cmd).unwrap();
        assert!(sm.get("key1").is_none());
        assert_eq!(sm.len(), 0);

        // Test snapshot/restore
        sm.apply(create_set_command("key2".to_string(), vec![4, 5, 6])).unwrap();
        let snapshot = sm.snapshot().unwrap();

        let mut sm2 = MemoryStateMachine::new();
        sm2.restore(&snapshot).unwrap();
        assert_eq!(sm2.get("key2"), Some(&[4, 5, 6][..]));
    }

    #[tokio::test]
    async fn test_raft_helper_function() {
        let state_machine = MemoryStateMachine::new();
        let raft = create_raft(
            "node1".to_string(),
            vec!["node2".to_string()],
            state_machine,
        );

        assert_eq!(raft.get_term().await, 0);
        assert!(!raft.is_leader().await);
    }
}
