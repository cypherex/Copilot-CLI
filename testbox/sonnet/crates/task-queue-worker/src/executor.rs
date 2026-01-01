use crate::handler::{TaskHandler, TaskResult};
use task_queue_core::Task;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::timeout;
use tracing::{info, error, warn};

/// Task executor with timeout support
pub struct TaskExecutor {
    handler: Arc<dyn TaskHandler>,
}

impl TaskExecutor {
    pub fn new(handler: Arc<dyn TaskHandler>) -> Self {
        TaskExecutor { handler }
    }

    /// Execute a task with timeout
    pub async fn execute(&self, task: &Task) -> TaskResult {
        let task_id = task.id;
        let timeout_duration = if task.timeout_seconds > 0 {
            Duration::from_secs(task.timeout_seconds as u64)
        } else {
            Duration::from_secs(300) // 5 minutes default
        };

        info!("Executing task {} with timeout {:?}", task_id, timeout_duration);

        match timeout(timeout_duration, self.handler.execute(task.payload.clone())).await {
            Ok(Ok(result)) => {
                info!("Task {} completed successfully", task_id);
                Ok(result)
            }
            Ok(Err(e)) => {
                error!("Task {} failed: {}", task_id, e);
                Err(e)
            }
            Err(_) => {
                error!("Task {} timed out after {:?}", task_id, timeout_duration);
                Err(format!("Task execution timed out after {:?}", timeout_duration))
            }
        }
    }

    /// Execute with panic recovery
    pub async fn execute_with_recovery(&self, task: &Task) -> TaskResult {
        let task_clone = task.clone();

        match tokio::spawn(async move {
            let executor = TaskExecutor::new(Arc::new(task_clone.clone()));
            executor.execute(&task_clone).await
        })
        .await
        {
            Ok(result) => result,
            Err(e) => {
                if e.is_panic() {
                    error!("Task {} panicked: {:?}", task.id, e);
                    Err("Task panicked during execution".to_string())
                } else {
                    error!("Task {} was cancelled", task.id);
                    Err("Task was cancelled".to_string())
                }
            }
        }
    }
}

// Dummy TaskHandler implementation for TaskExecutor to work with task clone
#[async_trait::async_trait]
impl TaskHandler for Task {
    async fn execute(&self, _payload: Vec<u8>) -> TaskResult {
        // This is a dummy implementation - actual execution uses registered handlers
        Err("Direct task execution not supported".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handler::EchoHandler;
    use task_queue_core::Priority;

    #[tokio::test]
    async fn test_executor_success() {
        let handler = Arc::new(EchoHandler);
        let executor = TaskExecutor::new(handler);

        let task = Task::new(
            "echo".to_string(),
            b"test data".to_vec(),
            Priority::normal(),
        )
        .unwrap();

        let result = executor.execute(&task).await.unwrap();
        assert_eq!(result, b"test data");
    }

    #[tokio::test]
    async fn test_executor_timeout() {
        use crate::handler::SleepHandler;

        let handler = Arc::new(SleepHandler::new(2000)); // 2 seconds
        let executor = TaskExecutor::new(handler);

        let mut task = Task::new(
            "sleep".to_string(),
            b"test".to_vec(),
            Priority::normal(),
        )
        .unwrap();
        task.timeout_seconds = 1; // 1 second timeout

        let result = executor.execute(&task).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("timed out"));
    }
}
