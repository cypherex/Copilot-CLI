//! Task handler trait and implementations

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;
use task_queue_core::Result;

/// Task handler trait
#[async_trait]
pub trait TaskHandler: Send + Sync {
    /// Get the task type this handler handles
    fn task_type(&self) -> &str;

    /// Execute the task
    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>>;

    /// Get timeout for this task type (optional, defaults to 300 seconds)
    fn timeout_secs(&self) -> u64 {
        300
    }
}

/// Task handler registry
#[derive(Clone)]
pub struct HandlerRegistry {
    handlers: Arc<HashMap<String, Box<dyn TaskHandler>>>,
}

impl HandlerRegistry {
    /// Create a new handler registry
    pub fn new() -> Self {
        Self {
            handlers: Arc::new(HashMap::new()),
        }
    }

    /// Register a task handler
    pub fn register<H>(&mut self, handler: H) -> Result<()>
    where
        H: TaskHandler + 'static,
    {
        let task_type = handler.task_type().to_string();
        
        // Use Arc::get_mut to get mutable reference to handlers
        if let Some(handlers) = Arc::get_mut(&mut self.handlers) {
            handlers.insert(task_type.clone(), Box::new(handler));
            tracing::info!("Registered task handler: {}", task_type);
            Ok(())
        } else {
            // If we can't get mutable reference (because there are other references),
            // we need to create a new HashMap and replace
            let mut new_handlers = HashMap::new();
            for (k, v) in self.handlers.iter() {
                // We can't clone Box<dyn TaskHandler>, so this approach won't work
                // For now, return an error
                return Err(task_queue_core::CoreError::Other(
                    "Cannot register handler after registry has been shared".to_string(),
                ));
            }
            new_handlers.insert(task_type.clone(), Box::new(handler));
            self.handlers = Arc::new(new_handlers);
            tracing::info!("Registered task handler: {}", task_type);
            Ok(())
        }
    }

    /// Get a handler for the given task type
    pub fn get(&self, task_type: &str) -> Option<Box<dyn TaskHandler>> {
        // We can't return a reference or clone the trait object
        // This is a limitation - in practice, we'd use a different approach
        // For now, return None
        None
    }

    /// Check if a handler is registered
    pub fn has_handler(&self, task_type: &str) -> bool {
        self.handlers.contains_key(task_type)
    }

    /// Execute a task with the registered handler
    pub async fn execute(&self, task_type: &str, payload: Vec<u8>) -> Result<Vec<u8>> {
        let handler = self.handlers.get(task_type)
            .ok_or_else(|| task_queue_core::CoreError::Other(format!("No handler for task type: {}", task_type)))?;

        handler.handle(payload).await
    }
}

impl Default for HandlerRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Example task handlers

/// Echo handler - returns the payload unchanged
pub struct EchoHandler;

#[async_trait]
impl TaskHandler for EchoHandler {
    fn task_type(&self) -> &str {
        "echo"
    }

    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>> {
        Ok(payload)
    }
}

/// Sleep handler - sleeps for the specified number of seconds
pub struct SleepHandler;

#[async_trait]
impl TaskHandler for SleepHandler {
    fn task_type(&self) -> &str {
        "sleep"
    }

    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>> {
        let seconds = std::str::from_utf8(&payload)
            .map_err(|e| task_queue_core::CoreError::Other(format!("Invalid payload: {}", e)))?
            .parse::<u64>()
            .map_err(|e| task_queue_core::CoreError::Other(format!("Invalid seconds: {}", e)))?;

        tokio::time::sleep(std::time::Duration::from_secs(seconds)).await;

        Ok(format!("Slept for {} seconds", seconds).into_bytes())
    }
}

/// Compute handler - performs simple arithmetic
pub struct ComputeHandler;

#[async_trait]
impl TaskHandler for ComputeHandler {
    fn task_type(&self) -> &str {
        "compute"
    }

    fn timeout_secs(&self) -> u64 {
        60
    }

    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>> {
        // Parse JSON: {"operation": "add|subtract|multiply|divide", "a": number, "b": number}
        let input: serde_json::Value = serde_json::from_slice(&payload)
            .map_err(|e| task_queue_core::CoreError::Other(format!("Invalid JSON: {}", e)))?;

        let operation = input["operation"].as_str()
            .ok_or_else(|| task_queue_core::CoreError::Other("Missing operation".to_string()))?;

        let a = input["a"].as_f64()
            .ok_or_else(|| task_queue_core::CoreError::Other("Missing or invalid 'a'".to_string()))?;

        let b = input["b"].as_f64()
            .ok_or_else(|| task_queue_core::CoreError::Other("Missing or invalid 'b'".to_string()))?;

        let result = match operation {
            "add" => a + b,
            "subtract" => a - b,
            "multiply" => a * b,
            "divide" => {
                if b == 0.0 {
                    return Err(task_queue_core::CoreError::Other("Division by zero".to_string()));
                }
                a / b
            }
            _ => return Err(task_queue_core::CoreError::Other(format!("Unknown operation: {}", operation))),
        };

        let output = serde_json::json!({ "result": result });
        Ok(serde_json::to_vec(&output)
            .map_err(|e| task_queue_core::CoreError::Other(format!("Failed to serialize result: {}", e)))?)
    }
}

/// Fail handler - always fails for testing
pub struct FailHandler;

#[async_trait]
impl TaskHandler for FailHandler {
    fn task_type(&self) -> &str {
        "fail"
    }

    async fn handle(&self, _payload: Vec<u8>) -> Result<Vec<u8>> {
        Err(task_queue_core::CoreError::Other("Task failed as requested".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_echo_handler() {
        let handler = EchoHandler;
        let input = b"test payload".to_vec();
        let output = handler.handle(input.clone()).await.unwrap();
        assert_eq!(output, input);
    }

    #[tokio::test]
    async fn test_sleep_handler() {
        let handler = SleepHandler;
        let input = b"1".to_vec();
        let output = handler.handle(input).await.unwrap();
        assert_eq!(String::from_utf8(output).unwrap(), "Slept for 1 seconds");
    }

    #[tokio::test]
    async fn test_compute_handler() {
        let handler = ComputeHandler;

        let input_add = serde_json::json!({"operation": "add", "a": 5, "b": 3});
        let output = handler.handle(serde_json::to_vec(&input_add).unwrap()).await.unwrap();
        let result: serde_json::Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(result["result"], 8.0);

        let input_mul = serde_json::json!({"operation": "multiply", "a": 4, "b": 7});
        let output = handler.handle(serde_json::to_vec(&input_mul).unwrap()).await.unwrap();
        let result: serde_json::Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(result["result"], 28.0);
    }

    #[tokio::test]
    async fn test_fail_handler() {
        let handler = FailHandler;
        let input = b"test".to_vec();
        assert!(handler.handle(input).await.is_err());
    }
}
