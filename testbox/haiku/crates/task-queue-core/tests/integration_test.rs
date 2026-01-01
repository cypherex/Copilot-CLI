// Integration tests for the core crate and persistence layer

use task_queue_core::{
    serialization::{
        serialize_task, deserialize_task,
        serialize_task_bincode, deserialize_task_bincode,
        serialize_tasks_bincode, deserialize_tasks_bincode
    },
    task::{Task, TaskStatus, TaskId},
    message::{Message, MessageType},
    priority::{Priority, PriorityTier},
    error::{TaskQueueError, Result},
};

#[test]
fn test_task_all_fields() {
    use std::collections::HashSet;
    use uuid::Uuid;
    use chrono::{Utc, Duration};

    let now = Utc::now();
    let task = Task {
        id: Uuid::new_v4(),
        task_type: "send_email".to_string(),
        payload: vec![1, 2, 3, 4, 5],
        priority: 200,
        created_at: now,
        scheduled_at: now + Duration::seconds(60),
        status: TaskStatus::Pending,
        max_retries: 5,
        retry_count: 0,
        timeout_seconds: 600,
        worker_id: None,
        lease_expires_at: None,
        result: None,
        error: None,
        dependencies: HashSet::new(),
        updated_at: now,
    };

    assert_eq!(task.task_type, "send_email");
    assert_eq!(task.priority, 200);
    assert_eq!(task.status, TaskStatus::Pending);
    assert_eq!(task.max_retries, 5);
    assert_eq!(task.timeout_seconds, 600);
    assert!(task.dependencies.is_empty());
}

#[test]
fn test_task_status_transitions() {
    let task = Task::new("test".to_string(), vec![]);

    assert_eq!(task.status, TaskStatus::Pending);
    assert!(!task.status.is_terminal());
    // Pending tasks haven't been tried yet, so they're not "retryable"
    assert!(!task.status.can_retry());

    let claimed = task.claim("worker-1".to_string(), 30);
    assert_eq!(claimed.status, TaskStatus::InProgress);
    assert!(!claimed.status.is_terminal());
    assert!(claimed.status.can_retry());

    let completed = claimed.complete(vec![1, 2, 3]);
    assert_eq!(completed.status, TaskStatus::Completed);
    assert!(completed.status.is_terminal());
    assert!(!completed.status.can_retry());

    let failed = Task::new("test2".to_string(), vec![]);
    let failed = failed.fail("Error".to_string());
    assert_eq!(failed.status, TaskStatus::Failed);
    assert!(!failed.status.is_terminal());
    assert!(failed.status.can_retry());
}

#[test]
fn test_message_types() {
    let types = vec![
        MessageType::SubmitTask,
        MessageType::ClaimTask,
        MessageType::TaskResult,
        MessageType::Heartbeat,
        MessageType::Ack,
        MessageType::Nack,
        MessageType::QueryStatus,
    ];

    for msg_type in types {
        let byte = msg_type.as_byte();
        let decoded = MessageType::from_byte(byte);
        assert_eq!(Some(msg_type), decoded);
    }
}

#[test]
fn test_priority_tiers() {
    let low = PriorityTier::from_value(50);
    let normal = PriorityTier::from_value(150);
    let high = PriorityTier::from_value(220);

    assert_eq!(low, PriorityTier::Low);
    assert_eq!(normal, PriorityTier::Normal);
    assert_eq!(high, PriorityTier::High);

    assert_eq!(high.compare(&normal), std::cmp::Ordering::Greater);
    assert_eq!(normal.compare(&low), std::cmp::Ordering::Greater);
    assert_eq!(low.compare(&high), std::cmp::Ordering::Less);
}

#[test]
fn test_json_serialization() {
    let task = Task::new("test".to_string(), vec![1, 2, 3])
        .with_priority(150)
        .with_max_retries(5)
        .with_timeout(300);

    let json_bytes = serialize_task(&task).unwrap();
    let deserialized = deserialize_task(&json_bytes).unwrap();

    assert_eq!(task.id, deserialized.id);
    assert_eq!(task.task_type, deserialized.task_type);
    assert_eq!(task.priority, deserialized.priority);
    assert_eq!(task.max_retries, deserialized.max_retries);
    assert_eq!(task.timeout_seconds, deserialized.timeout_seconds);
}

#[test]
fn test_bincode_serialization() {
    let task = Task::new("test".to_string(), vec![1, 2, 3])
        .with_priority(150)
        .with_max_retries(5)
        .with_timeout(300);

    let bincode_bytes = serialize_task_bincode(&task).unwrap();
    let deserialized = deserialize_task_bincode(&bincode_bytes).unwrap();

    assert_eq!(task.id, deserialized.id);
    assert_eq!(task.task_type, deserialized.task_type);
    assert_eq!(task.priority, deserialized.priority);
    assert_eq!(task.max_retries, deserialized.max_retries);
    assert_eq!(task.timeout_seconds, deserialized.timeout_seconds);
    assert_eq!(task.payload, deserialized.payload);
}

#[test]
fn test_bincode_more_compact_than_json() {
    let task = Task::new("test".to_string(), vec![1, 2, 3, 4, 5, 6, 7, 8])
        .with_priority(150);

    let json_bytes = serialize_task(&task).unwrap();
    let bincode_bytes = serialize_task_bincode(&task).unwrap();

    // Bincode should be significantly more compact
    assert!(bincode_bytes.len() < json_bytes.len());

    // Bincode should be less than half the size of JSON typically
    let ratio = bincode_bytes.len() as f64 / json_bytes.len() as f64;
    println!("Bincode size: {}, JSON size: {}, ratio: {:.2}",
        bincode_bytes.len(), json_bytes.len(), ratio);
    assert!(ratio < 0.6, "Bincode should be more compact (ratio: {:.2})", ratio);
}

#[test]
fn test_multiple_tasks_bincode() {
    let tasks = vec![
        Task::new("task1".to_string(), vec![1, 2, 3]).with_priority(100),
        Task::new("task2".to_string(), vec![4, 5, 6]).with_priority(200),
        Task::new("task3".to_string(), vec![7, 8, 9]).with_priority(150),
    ];

    let bincode_bytes = serialize_tasks_bincode(&tasks).unwrap();
    let deserialized = deserialize_tasks_bincode(&bincode_bytes).unwrap();

    assert_eq!(tasks.len(), deserialized.len());
    for (original, deserialized) in tasks.iter().zip(deserialized.iter()) {
        assert_eq!(original.id, deserialized.id);
        assert_eq!(original.task_type, deserialized.task_type);
        assert_eq!(original.priority, deserialized.priority);
        assert_eq!(original.payload, deserialized.payload);
    }
}

#[test]
fn test_task_ordering_by_priority() {
    let task1 = Task::new("a".to_string(), vec![]).with_priority(100);
    let task2 = Task::new("b".to_string(), vec![]).with_priority(200);
    let task3 = Task::new("c".to_string(), vec![]).with_priority(150);

    let mut tasks = vec![&task1, &task2, &task3];
    tasks.sort(); // Sort using Ord implementation

    // Higher priority first
    assert_eq!(tasks[0].priority, 200);
    assert_eq!(tasks[1].priority, 150);
    assert_eq!(tasks[2].priority, 100);
}

#[test]
fn test_message_serialization() {
    let payload = b"test_payload".to_vec();
    let msg = Message::new(MessageType::Heartbeat, payload.clone());

    let bytes = msg.to_bytes().unwrap();
    let (deserialized, len) = Message::from_bytes(&bytes).unwrap();

    assert_eq!(deserialized.msg_type, MessageType::Heartbeat);
    assert_eq!(deserialized.payload, payload);
    assert_eq!(len, bytes.len());
}

#[test]
fn test_large_payload_serialization() {
    let large_payload: Vec<u8> = (0..100_000).map(|i| (i % 256) as u8).collect();
    let task = Task::new("large_task".to_string(), large_payload.clone());

    let bincode_bytes = serialize_task_bincode(&task).unwrap();
    let deserialized = deserialize_task_bincode(&bincode_bytes).unwrap();

    assert_eq!(task.payload.len(), deserialized.payload.len());
    assert_eq!(task.payload, deserialized.payload);
    // Size should be close to payload size (within 1KB tolerance for metadata)
    assert!(bincode_bytes.len() > large_payload.len());
    assert!(bincode_bytes.len() < large_payload.len() + 2000);
}

#[test]
fn test_task_dependencies() {
    let dep1 = TaskId::new_v4();
    let dep2 = TaskId::new_v4();

    let task = Task::new("dependent_task".to_string(), vec![])
        .add_dependency(dep1)
        .add_dependency(dep2);

    assert_eq!(task.dependencies.len(), 2);
    assert!(task.dependencies.contains(&dep1));
    assert!(task.dependencies.contains(&dep2));
}

#[test]
fn test_lease_expiry() {
    // Create a task with an expired lease
    let task = Task::new("test".to_string(), vec![]);
    let task = task.claim("worker-1".to_string(), 0); // 0 seconds = already expired

    assert!(task.lease_expired());
}

#[test]
fn test_size_estimation() {
    let task = Task::new("test".to_string(), vec![1, 2, 3, 4, 5]);
    let size = task.size_bytes();

    // Size should be reasonable
    assert!(size > 100);
    assert!(size < 10000);
}
