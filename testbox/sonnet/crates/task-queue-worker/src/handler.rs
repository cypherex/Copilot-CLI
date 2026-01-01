use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;

/// Result type for task handlers
pub type TaskResult = Result<Vec<u8>, String>;

/// Trait for task handlers
#[async_trait]
pub trait TaskHandler: Send + Sync {
    /// Execute the task with the given payload
    async fn execute(&self, payload: Vec<u8>) -> TaskResult;
}

/// Registry of task handlers by task type
pub struct TaskHandlerRegistry {
    handlers: Arc<RwLock<HashMap<String, Arc<dyn TaskHandler>>>>,
}

impl TaskHandlerRegistry {
    pub fn new() -> Self {
        TaskHandlerRegistry {
            handlers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a task handler for a specific task type
    pub fn register<H: TaskHandler + 'static>(&self, task_type: String, handler: H) {
        let mut handlers = self.handlers.write();
        handlers.insert(task_type, Arc::new(handler));
    }

    /// Get a handler for a task type
    pub fn get(&self, task_type: &str) -> Option<Arc<dyn TaskHandler>> {
        let handlers = self.handlers.read();
        handlers.get(task_type).cloned()
    }

    /// Check if a handler is registered for a task type
    pub fn has_handler(&self, task_type: &str) -> bool {
        let handlers = self.handlers.read();
        handlers.contains_key(task_type)
    }

    /// Get all registered task types
    pub fn task_types(&self) -> Vec<String> {
        let handlers = self.handlers.read();
        handlers.keys().cloned().collect()
    }
}

impl Default for TaskHandlerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Example task handler that just echoes the payload
pub struct EchoHandler;

#[async_trait]
impl TaskHandler for EchoHandler {
    async fn execute(&self, payload: Vec<u8>) -> TaskResult {
        Ok(payload)
    }
}

/// Example task handler that simulates work
pub struct SleepHandler {
    duration_ms: u64,
}

impl SleepHandler {
    pub fn new(duration_ms: u64) -> Self {
        SleepHandler { duration_ms }
    }
}

#[async_trait]
impl TaskHandler for SleepHandler {
    async fn execute(&self, payload: Vec<u8>) -> TaskResult {
        tokio::time::sleep(tokio::time::Duration::from_millis(self.duration_ms)).await;
        Ok(payload)
    }
}

/// Example task handler that processes JSON
pub struct JsonProcessorHandler;

#[async_trait]
impl TaskHandler for JsonProcessorHandler {
    async fn execute(&self, payload: Vec<u8>) -> TaskResult {
        // Parse JSON, do some processing, return result
        let json: serde_json::Value = serde_json::from_slice(&payload)
            .map_err(|e| format!("Invalid JSON: {}", e))?;

        // Example: count keys if object
        let result = if let Some(obj) = json.as_object() {
            serde_json::json!({
                "key_count": obj.len(),
                "original": json,
            })
        } else {
            serde_json::json!({
                "original": json,
            })
        };

        serde_json::to_vec(&result)
            .map_err(|e| format!("Failed to serialize result: {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_echo_handler() {
        let handler = EchoHandler;
        let payload = b"test data".to_vec();
        let result = handler.execute(payload.clone()).await.unwrap();
        assert_eq!(result, payload);
    }

    #[tokio::test]
    async fn test_registry() {
        let registry = TaskHandlerRegistry::new();
        registry.register("echo".to_string(), EchoHandler);

        assert!(registry.has_handler("echo"));
        assert!(!registry.has_handler("unknown"));

        let handler = registry.get("echo").unwrap();
        let result = handler.execute(b"test".to_vec()).await.unwrap();
        assert_eq!(result, b"test");
    }
}
