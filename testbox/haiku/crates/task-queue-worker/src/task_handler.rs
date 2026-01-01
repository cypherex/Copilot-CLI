//! Task handler traits and registry.

use std::collections::HashMap;
use std::sync::Arc;

/// Type for async task handler functions.
pub type TaskHandlerFn = Arc<
    dyn Fn(Vec<u8>) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<Vec<u8>, String>> + Send>,
        > + Send
        + Sync,
>;

/// Registry for task handlers keyed by task type name.
#[derive(Clone, Default)]
pub struct HandlerRegistry {
    handlers: HashMap<String, TaskHandlerFn>,
}

impl HandlerRegistry {
    /// Create a new empty handler registry.
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    /// Register a handler for a specific task type.
    pub fn register(&mut self, task_type: String, handler: TaskHandlerFn) {
        self.handlers.insert(task_type, handler);
    }

    /// Get a handler for a specific task type.
    pub fn get(&self, task_type: &str) -> Option<TaskHandlerFn> {
        self.handlers.get(task_type).cloned()
    }

    /// Check if a handler is registered for a task type.
    pub fn has(&self, task_type: &str) -> bool {
        self.handlers.contains_key(task_type)
    }

    /// Get all registered task types.
    pub fn task_types(&self) -> Vec<String> {
        self.handlers.keys().cloned().collect()
    }

    /// Remove a handler for a task type.
    pub fn unregister(&mut self, task_type: &str) {
        self.handlers.remove(task_type);
    }
}

/// Trait for task handlers.
pub trait TaskHandler: Send + Sync {
    /// Execute the task with given payload.
    async fn execute(&self, payload: Vec<u8>) -> Result<Vec<u8>, String>;

    /// Get the task type name.
    fn task_type(&self) -> &str;
}

/// Simple handler that returns input as output.
#[derive(Clone)]
pub struct EchoHandler;

impl TaskHandler for EchoHandler {
    async fn execute(&self, payload: Vec<u8>) -> Result<Vec<u8>, String> {
        Ok(payload)
    }

    fn task_type(&self) -> &str {
        "echo"
    }
}

/// Example handler for sending emails.
#[derive(Clone)]
pub struct SendEmailHandler;

impl TaskHandler for SendEmailHandler {
    async fn execute(&self, payload: Vec<u8>) -> Result<Vec<u8>, String> {
        // Parse email from payload (simplified)
        let email_str = String::from_utf8(payload)
            .map_err(|e| format!("Invalid UTF-8 in payload: {}", e))?;

        // Simulate email sending
        // In production, this would actually send the email via SMTP
        tracing::info!("Sending email: {}", email_str);

        // Return success response
        Ok(format!("Email sent: {}", email_str).into_bytes())
    }

    fn task_type(&self) -> &str {
        "send_email"
    }
}

/// Example handler for image processing.
#[derive(Clone)]
pub struct ProcessImageHandler;

impl TaskHandler for ProcessImageHandler {
    async fn execute(&self, payload: Vec<u8>) -> Result<Vec<u8>, String> {
        // Simulate image processing
        tracing::info!("Processing image ({} bytes)", payload.len());

        // Simulate processing time
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Return processed result (simplified - would return actual processed image)
        Ok(format!("Image processed: {} bytes", payload.len()).into_bytes())
    }

    fn task_type(&self) -> &str {
        "process_image"
    }
}

/// Example handler for report generation.
pub struct GenerateReportHandler;

impl TaskHandler for GenerateReportHandler {
    async fn execute(&self, payload: Vec<u8>) -> Result<Vec<u8>, String> {
        // Parse report request from payload
        let report_type = String::from_utf8(payload)
            .map_err(|e| format!("Invalid UTF-8 in payload: {}", e))?;

        // Simulate report generation
        tracing::info!("Generating report: {}", report_type);

        // Simulate generation time
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        // Return generated report (simplified)
        let report = format!("Report generated for: {}", report_type);
        Ok(report.into_bytes())
    }

    fn task_type(&self) -> &str {
        "generate_report"
    }
}

/// Helper function to create a handler from a TaskHandler trait object.
pub fn make_handler<H>(handler: H) -> TaskHandlerFn
where
    H: TaskHandler + Clone + 'static,
{
    Arc::new(move |payload: Vec<u8>| {
        let handler = handler.clone();
        Box::pin(async move { handler.execute(payload).await })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_creation() {
        let registry = HandlerRegistry::new();
        assert_eq!(registry.task_types().len(), 0);
    }

    #[test]
    fn test_registry_register() {
        let mut registry = HandlerRegistry::new();
        registry.register(
            "test".to_string(),
            Arc::new(|payload| {
                Box::pin(async move { Ok(payload) })
            }),
        );
        assert!(registry.has("test"));
        assert!(!registry.has("nonexistent"));
    }

    #[test]
    fn test_registry_get() {
        let mut registry = HandlerRegistry::new();
        let handler = Arc::new(|payload| {
            Box::pin(async move { Ok(payload) })
        });
        registry.register("test".to_string(), handler.clone());

        let retrieved = registry.get("test");
        assert!(retrieved.is_some());

        let none = registry.get("nonexistent");
        assert!(none.is_none());
    }

    #[test]
    fn test_registry_unregister() {
        let mut registry = HandlerRegistry::new();
        registry.register(
            "test".to_string(),
            Arc::new(|payload| {
                Box::pin(async move { Ok(payload) })
            }),
        );
        assert!(registry.has("test"));

        registry.unregister("test");
        assert!(!registry.has("test"));
    }

    #[tokio::test]
    async fn test_echo_handler() {
        let handler = EchoHandler;
        let input = vec![1, 2, 3, 4, 5];
        let result = handler.execute(input.clone()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), input);
    }

    #[tokio::test]
    async fn test_send_email_handler() {
        let handler = SendEmailHandler;
        let payload = b"test@example.com:Hello World".to_vec();
        let result = handler.execute(payload).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        let output_str = String::from_utf8(output).unwrap();
        assert!(output_str.contains("Email sent"));
    }

    #[tokio::test]
    async fn test_process_image_handler() {
        let handler = ProcessImageHandler;
        let payload = vec![0u8; 1024]; // 1KB dummy image data
        let result = handler.execute(payload).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        let output_str = String::from_utf8(output).unwrap();
        assert!(output_str.contains("1024 bytes"));
    }

    #[tokio::test]
    async fn test_generate_report_handler() {
        let handler = GenerateReportHandler;
        let payload = b"monthly_sales".to_vec();
        let result = handler.execute(payload).await;
        assert!(result.is_ok());
        let output = result.unwrap();
        let output_str = String::from_utf8(output).unwrap();
        assert!(output_str.contains("monthly_sales"));
    }

    #[tokio::test]
    async fn test_make_handler() {
        let handler_fn = make_handler(EchoHandler);
        let input = vec![1, 2, 3];
        let result = handler_fn(input.clone()).await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), input);
    }
}
