//! Task execution with timeout enforcement and panic capture.

use std::time::Duration;
use tokio::time::timeout;
use tokio::task::JoinHandle;
use task_queue_core::task::Task;
use crate::task_handler::HandlerRegistry;

/// Result of task execution.
#[derive(Debug, Clone)]
pub enum ExecutionResult {
    /// Task completed successfully
    Success { output: Vec<u8> },
    /// Task execution timed out
    Timeout,
    /// Task panicked
    Panic { message: String },
    /// Task returned an error
    Error { message: String },
}

impl ExecutionResult {
    /// Check if execution was successful.
    pub fn is_success(&self) -> bool {
        matches!(self, ExecutionResult::Success { .. })
    }

    /// Check if execution failed and should be retried.
    pub fn should_retry(&self) -> bool {
        matches!(self, ExecutionResult::Timeout | ExecutionResult::Panic { .. })
    }

    /// Get error message if execution failed.
    pub fn error_message(&self) -> Option<String> {
        match self {
            ExecutionResult::Timeout => Some("Task execution timed out".to_string()),
            ExecutionResult::Panic { message } => Some(format!("Task panicked: {}", message)),
            ExecutionResult::Error { message } => Some(message.clone()),
            ExecutionResult::Success { .. } => None,
        }
    }
}

/// Task executor with timeout enforcement and panic capture.
pub struct TaskExecutor {
    handlers: HandlerRegistry,
}

impl TaskExecutor {
    /// Create a new task executor.
    pub fn new(handlers: HandlerRegistry) -> Self {
        Self { handlers }
    }

    /// Get the handler registry (for testing).
    #[cfg(test)]
    pub fn get_handler_registry(&self) -> &HandlerRegistry {
        &self.handlers
    }

    /// Execute a task with timeout enforcement.
    ///
    /// This method:
    /// - Runs the handler in a separate task for panic isolation
    /// - Enforces timeout with tokio::timeout
    /// - Captures panics and converts them to errors
    /// - Returns ExecutionResult with appropriate status
    pub async fn execute(&self, task: &Task) -> ExecutionResult {
        // Get the handler for this task type
        let handler = match self.handlers.get(&task.task_type) {
            Some(h) => h.clone(),
            None => {
                return ExecutionResult::Error {
                    message: format!("No handler registered for task type: {}", task.task_type),
                };
            }
        };

        // Execute with timeout
        let timeout_duration = Duration::from_secs(task.timeout_seconds);
        let handler_future = self.execute_handler(handler, task.payload.clone());

        match timeout(timeout_duration, handler_future).await {
            Ok(result) => result,
            Err(_) => {
                // Timeout occurred, try to abort the task if it's still running
                ExecutionResult::Timeout
            }
        }
    }

    /// Execute a handler in a separate task for panic isolation.
    async fn execute_handler(
        &self,
        handler: crate::task_handler::TaskHandlerFn,
        payload: Vec<u8>,
    ) -> ExecutionResult {
        // Spawn task in background for panic isolation
        let handle: JoinHandle<Result<Vec<u8>, String>> =
            tokio::spawn(async move { handler(payload).await });

        // Wait for completion and catch panics
        match handle.await {
            Ok(result) => match result {
                Ok(output) => ExecutionResult::Success { output },
                Err(message) => ExecutionResult::Error { message },
            },
            Err(join_error) => {
                // Task panicked
                let panic_msg = join_error
                    .into_panic()
                    .downcast::<String>()
                    .map(|s| *s)
                    .unwrap_or_else(|_| "Unknown panic".to_string());
                ExecutionResult::Panic { message: panic_msg }
            }
        }
    }

    /// Execute a task with a custom timeout (for testing).
    #[cfg(test)]
    pub async fn execute_with_timeout(
        &self,
        task: &Task,
        custom_timeout: Duration,
    ) -> ExecutionResult {
        let handler = match self.handlers.get(&task.task_type) {
            Some(h) => h.clone(),
            None => {
                return ExecutionResult::Error {
                    message: format!("No handler registered for task type: {}", task.task_type),
                };
            }
        };

        let handler_future = self.execute_handler(handler, task.payload.clone());

        match timeout(custom_timeout, handler_future).await {
            Ok(result) => result,
            Err(_) => ExecutionResult::Timeout,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_handler::HandlerRegistry;
    use std::sync::Arc;

    #[tokio::test]
    async fn test_execute_success() {
        let mut registry = HandlerRegistry::new();
        registry.register(
            "test".to_string(),
            Arc::new(|payload| {
                Box::pin(async move {
                    Ok(payload)
                })
            }),
        );

        let executor = TaskExecutor::new(registry);
        let task = Task::new("test".to_string(), vec![1, 2, 3]);

        let result = executor.execute(&task).await;
        assert!(result.is_success());
        assert!(matches!(result, ExecutionResult::Success { output } if output == vec![1, 2, 3]));
    }

    #[tokio::test]
    async fn test_execute_error() {
        let mut registry = HandlerRegistry::new();
        registry.register(
            "test".to_string(),
            Arc::new(|_payload| {
                Box::pin(async move {
                    Err("Handler error".to_string())
                })
            }),
        );

        let executor = TaskExecutor::new(registry);
        let task = Task::new("test".to_string(), vec![]);

        let result = executor.execute(&task).await;
        assert!(!result.is_success());
        assert!(matches!(result, ExecutionResult::Error { .. }));
        assert_eq!(result.error_message(), Some("Handler error".to_string()));
    }

    #[tokio::test]
    async fn test_execute_timeout() {
        let mut registry = HandlerRegistry::new();
        registry.register(
            "slow".to_string(),
            Arc::new(|_payload| {
                Box::pin(async move {
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    Ok(vec![])
                })
            }),
        );

        let executor = TaskExecutor::new(registry);
        let mut task = Task::new("slow".to_string(), vec![]);
        task.timeout_seconds = 1; // 1 second timeout

        let result = executor.execute(&task).await;
        assert!(!result.is_success());
        assert!(matches!(result, ExecutionResult::Timeout));
        assert!(result.should_retry());
    }

    #[tokio::test]
    async fn test_execute_panic() {
        let mut registry = HandlerRegistry::new();
        registry.register(
            "panic".to_string(),
            Arc::new(|_payload| {
                Box::pin(async move {
                    panic!("Intentional panic for testing");
                })
            }),
        );

        let executor = TaskExecutor::new(registry);
        let task = Task::new("panic".to_string(), vec![]);

        let result = executor.execute(&task).await;
        assert!(!result.is_success());
        assert!(matches!(result, ExecutionResult::Panic { .. }));
        assert!(result.should_retry());
        let error_msg = result.error_message().unwrap();
        assert!(error_msg.contains("panic") || error_msg.contains("Panic"));
    }

    #[tokio::test]
    async fn test_execute_no_handler() {
        let registry = HandlerRegistry::new();
        let executor = TaskExecutor::new(registry);
        let task = Task::new("unknown".to_string(), vec![]);

        let result = executor.execute(&task).await;
        assert!(!result.is_success());
        assert!(matches!(result, ExecutionResult::Error { .. }));
        assert!(!result.should_retry()); // Missing handler should not retry
    }
}
