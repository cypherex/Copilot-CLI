//! Task handler registry for async task execution

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, instrument};

/// Type for async task handlers
///
/// Task handlers take a payload (Vec<u8>) and return a result (Vec<u8>) or an error (String).
pub type TaskHandlerFn = Arc<dyn Fn(Vec<u8>) -> HandlerReturn + Send + Sync>;

/// Helper type for async handler return
pub type HandlerReturn = std::pin::Pin<
    Box<dyn std::future::Future<Output = Result<Vec<u8>, String>> + Send + Sync + 'static>,
>;

/// Trait for task handlers
///
/// Implement this trait to define custom task handlers that can be registered
/// with the worker.
#[async_trait]
pub trait TaskHandler: Send + Sync {
    /// Execute the task with the given payload
    ///
    /// # Arguments
    /// * `payload` - The task payload as raw bytes
    ///
    /// # Returns
    /// * `Ok(Vec<u8>)` - The result of the task execution as bytes
    /// * `Err(String)` - An error message if the task fails
    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>, String>;

    /// Get the task type name this handler handles
    fn task_type(&self) -> &str;
}

/// Simple task handler function wrapper
pub struct FnTaskHandler {
    task_type: String,
    handler: TaskHandlerFn,
}

impl FnTaskHandler {
    /// Create a new task handler from an async function
    pub fn new<F>(task_type: String, handler: F) -> Self
    where
        F: Fn(Vec<u8>) -> HandlerReturn + Send + Sync + 'static,
    {
        Self {
            task_type,
            handler: Arc::new(handler),
        }
    }
}

#[async_trait]
impl TaskHandler for FnTaskHandler {
    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>, String> {
        (self.handler)(payload).await
    }

    fn task_type(&self) -> &str {
        &self.task_type
    }
}

/// Registry for task handlers
///
/// The handler registry maintains a mapping from task type names to their
/// corresponding handler implementations.
#[derive(Clone, Default)]
pub struct TaskHandlerRegistry {
    handlers: Arc<RwLock<HashMap<String, Box<dyn TaskHandler>>>>,
}

impl TaskHandlerRegistry {
    /// Create a new empty task handler registry
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a task handler
    ///
    /// # Arguments
    /// * `handler` - The task handler to register
    ///
    /// # Example
    /// ```ignore
    /// registry.register_handler(MyHandler);
    /// ```
    pub async fn register_handler<H>(&self, handler: H)
    where
        H: TaskHandler + 'static,
    {
        let task_type = handler.task_type().to_string();
        let mut handlers = self.handlers.write().await;
        handlers.insert(task_type.clone(), Box::new(handler));
        info!("Registered handler for task type: {}", task_type);
    }

    /// Register a task handler from an async function
    ///
    /// # Arguments
    /// * `task_type` - The task type name
    /// * `handler` - The async function that handles the task
    ///
    /// # Example
    /// ```ignore
    /// registry.register_fn("send_email", |payload| async {
    ///     // Handle email sending
    ///     Ok(b"Email sent".to_vec())
    /// });
    /// ```
    pub fn register_fn<F>(&self, task_type: String, handler: F)
    where
        F: Fn(Vec<u8>) -> HandlerReturn + Send + Sync + 'static,
    {
        let handler = FnTaskHandler::new(task_type.clone(), handler);
        let task_type_clone = task_type.clone();
        let handlers = Arc::clone(&self.handlers);
        tokio::spawn(async move {
            let mut handlers_guard = handlers.write().await;
            let task_type_for_log = task_type_clone.clone();
            handlers_guard.insert(task_type_clone, Box::new(handler));
            info!("Registered function handler for task type: {}", task_type_for_log);
        });
    }

    /// Get a handler for a specific task type
    ///
    /// # Arguments
    /// * `task_type` - The task type name
    ///
    /// # Returns
    /// * `Some(Box<dyn TaskHandler>)` - The handler if found
    /// * `None` - No handler registered for this task type
    pub async fn get_handler(&self, _task_type: &str) -> Option<Box<dyn TaskHandler>> {
        let _handlers = self.handlers.read().await;
        // Note: We can't directly clone the trait object
        // This method is deprecated in favor of execute_task which handles this internally
        None
    }

    /// Execute a task using the registered handler
    ///
    /// # Arguments
    /// * `task_type` - The task type name
    /// * `payload` - The task payload
    ///
    /// # Returns
    /// * `Ok(Vec<u8>)` - The result of the task execution
    /// * `Err(String)` - An error message if handler not found or task fails
    #[instrument(skip(self, payload))]
    pub async fn execute_task(
        &self,
        task_type: &str,
        payload: Vec<u8>,
    ) -> Result<Vec<u8>, String> {
        // We need to clone the handler properly - using a different approach
        let handlers = self.handlers.read().await;
        
        // Check if handler exists
        if !handlers.contains_key(task_type) {
            let err = format!("No handler registered for task type: {}", task_type);
            error!("{}", err);
            return Err(err);
        }

        // Get the handler's task type and execute directly
        // Since we can't clone the trait object, we need to use a different approach
        // For now, let's return an error about the limitation
        drop(handlers);
        
        // Re-acquire with a different strategy - execute within the read lock scope
        let handlers = self.handlers.read().await;
        if let Some(handler) = handlers.get(task_type) {
            debug!("Executing task of type: {}", task_type);
            handler.handle(payload).await
        } else {
            let err = format!("Handler disappeared for task type: {}", task_type);
            error!("{}", err);
            Err(err)
        }
    }

    /// Check if a handler is registered for a task type
    ///
    /// # Arguments
    /// * `task_type` - The task type name
    ///
    /// # Returns
    /// * `true` - Handler is registered
    /// * `false` - No handler registered
    pub async fn has_handler(&self, task_type: &str) -> bool {
        let handlers = self.handlers.read().await;
        handlers.contains_key(task_type)
    }

    /// Get the list of registered task types
    ///
    /// # Returns
    /// A vector of task type names that have registered handlers
    pub async fn registered_task_types(&self) -> Vec<String> {
        let handlers = self.handlers.read().await;
        handlers.keys().cloned().collect()
    }

    /// Get the count of registered handlers
    ///
    /// # Returns
    /// The number of registered task handlers
    pub async fn handler_count(&self) -> usize {
        let handlers = self.handlers.read().await;
        handlers.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestHandler;
    struct AlwaysFailHandler;

    #[async_trait]
    impl TaskHandler for TestHandler {
        async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>, String> {
            Ok(format!("processed: {:?}", payload).into_bytes())
        }

        fn task_type(&self) -> &str {
            "test_task"
        }
    }

    #[async_trait]
    impl TaskHandler for AlwaysFailHandler {
        async fn handle(&self, _payload: Vec<u8>) -> Result<Vec<u8>, String> {
            Err("test failure".to_string())
        }

        fn task_type(&self) -> &str {
            "fail_task"
        }
    }

    #[tokio::test]
    async fn test_registry_registration() {
        let registry = TaskHandlerRegistry::new();
        registry.register_handler(TestHandler).await;

        assert!(registry.has_handler("test_task").await);
        assert_eq!(registry.handler_count().await, 1);
    }

    #[tokio::test]
    async fn test_execute_task() {
        let registry = TaskHandlerRegistry::new();
        registry.register_handler(TestHandler).await;

        let result = registry
            .execute_task("test_task", b"test payload".to_vec())
            .await;

        assert!(result.is_ok());
        assert!(result.unwrap().starts_with(b"processed:"));
    }

    #[tokio::test]
    async fn test_execute_failing_task() {
        let registry = TaskHandlerRegistry::new();
        registry.register_handler(AlwaysFailHandler).await;

        let result = registry
            .execute_task("fail_task", b"test payload".to_vec())
            .await;

        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "test failure");
    }

    #[tokio::test]
    async fn test_no_handler() {
        let registry = TaskHandlerRegistry::new();

        let result = registry
            .execute_task("unknown_task", b"test payload".to_vec())
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No handler registered"));
    }

    #[tokio::test]
    async fn test_registered_task_types() {
        let registry = TaskHandlerRegistry::new();
        registry.register_handler(TestHandler).await;
        registry.register_handler(AlwaysFailHandler).await;

        let types = registry.registered_task_types().await;
        assert_eq!(types.len(), 2);
        assert!(types.contains(&"test_task".to_string()));
        assert!(types.contains(&"fail_task".to_string()));
    }

    #[tokio::test]
    async fn test_function_handler() {
        let registry = TaskHandlerRegistry::new();

        registry.register_fn("echo_task".to_string(), |payload| Box::pin(async move {
            Ok(payload.clone())
        }));

        // Give the async registration time to complete
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        let result = registry
            .execute_task("echo_task", b"test payload".to_vec())
            .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"test payload".to_vec());
    }
}