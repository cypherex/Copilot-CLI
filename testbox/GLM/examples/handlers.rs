//! Example task handlers for the task queue system

use task_queue_core::Result;
use task_queue_worker::handler::TaskHandler;

/// Example 1: Email Handler
/// Demonstrates how to send emails asynchronously

pub struct EmailHandler {
    smtp_server: String,
    smtp_username: String,
    smtp_password: String,
}

impl EmailHandler {
    pub fn new(smtp_server: String, smtp_username: String, smtp_password: String) -> Self {
        Self {
            smtp_server,
            smtp_username,
            smtp_password,
        }
    }
}

#[async_trait::async_trait]
impl TaskHandler for EmailHandler {
    fn task_type(&self) -> &str {
        "send_email"
    }

    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>> {
        use serde::Deserialize;

        #[derive(Deserialize)]
        struct EmailRequest {
            to: String,
            subject: String,
            body: String,
            html: Option<bool>,
        }

        let request: EmailRequest = serde_json::from_slice(&payload)
            .map_err(|e| task_queue_core::CoreError::Other(format!("Invalid email request: {}", e)))?;

        // In a real implementation, you would use an SMTP library here
        // For example: lettre crate
        println!("Sending email to: {}", request.to);
        println!("Subject: {}", request.subject);
        println!("Body: {}", request.body.chars().take(100).collect::<String>() + "...");

        // Simulate sending email
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        Ok(serde_json::json!({
            "status": "sent",
            "to": request.to
        }).to_vec())
    }
}

/// Example 2: Image Processing Handler
/// Demonstrates how to process images (resize, crop, etc.)

pub struct ImageProcessingHandler {
    output_dir: String,
}

impl ImageProcessingHandler {
    pub fn new(output_dir: String) -> Self {
        Self { output_dir }
    }
}

#[async_trait::async_trait]
impl TaskHandler for ImageProcessingHandler {
    fn task_type(&self) -> &str {
        "process_image"
    }

    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>> {
        use serde::Deserialize;

        #[derive(Deserialize)]
        struct ImageRequest {
            image_data: String,  // Base64 encoded
            operation: String,    // resize, crop, thumbnail
            width: Option<u32>,
            height: Option<u32>,
            quality: Option<u8>,
        }

        let request: ImageRequest = serde_json::from_slice(&payload)
            .map_err(|e| task_queue_core::CoreError::Other(format!("Invalid image request: {}", e)))?;

        // In a real implementation, you would use image crate
        println!("Processing image with operation: {}", request.operation);

        // Simulate image processing
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        Ok(serde_json::json!({
            "status": "processed",
            "operation": request.operation,
            "original_size": "1920x1080",
            "processed_size": format!("{}x{}", 
                request.width.unwrap_or(1920), 
                request.height.unwrap_or(1080))
        }).to_vec())
    }
}

/// Example 3: Data Export Handler
/// Demonstrates how to export data to various formats (CSV, JSON, etc.)

pub struct DataExportHandler {
    export_dir: String,
}

impl DataExportHandler {
    pub fn new(export_dir: String) -> Self {
        Self { export_dir }
    }
}

#[async_trait::async_trait]
impl TaskHandler for DataExportHandler {
    fn task_type(&self) -> &str {
        "export_data"
    }

    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>> {
        use serde::Deserialize;

        #[derive(Deserialize)]
        struct ExportRequest {
            query: String,
            format: String,  // csv, json, xlsx
            filters: Option<serde_json::Value>,
        }

        let request: ExportRequest = serde_json::from_slice(&payload)
            .map_err(|e| task_queue_core::CoreError::Other(format!("Invalid export request: {}", e)))?;

        println!("Executing export query: {}", request.query);
        println!("Format: {}", request.format);

        // Simulate data export
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        Ok(serde_json::json!({
            "status": "completed",
            "format": request.format,
            "row_count": 12345,
            "file_path": format!("{}/export_{}.{}", 
                self.export_dir, 
                chrono::Utc::now().timestamp(),
                request.format)
        }).to_vec())
    }
}

/// Example 4: Report Generation Handler
/// Demonstrates how to generate PDF reports

pub struct ReportGenerationHandler {
    templates_dir: String,
    output_dir: String,
}

impl ReportGenerationHandler {
    pub fn new(templates_dir: String, output_dir: String) -> Self {
        Self {
            templates_dir,
            output_dir,
        }
    }
}

#[async_trait::async_trait]
impl TaskHandler for ReportGenerationHandler {
    fn task_type(&self) -> &str {
        "generate_report"
    }

    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>> {
        use serde::Deserialize;

        #[derive(Deserialize)]
        struct ReportRequest {
            template: String,
            data: serde_json::Value,
            format: Option<String>,  // pdf, html
        }

        let request: ReportRequest = serde_json::from_slice(&payload)
            .map_err(|e| task_queue_core::CoreError::Other(format!("Invalid report request: {}", e)))?;

        println!("Generating report from template: {}", request.template);

        // Simulate report generation
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;

        Ok(serde_json::json!({
            "status": "generated",
            "format": request.format.unwrap_or("pdf".to_string()),
            "page_count": 12,
            "file_path": format!("{}/report_{}.pdf",
                self.output_dir,
                chrono::Utc::now().timestamp())
        }).to_vec())
    }
}

/// Example 5: Webhook Handler
/// Demonstrates how to call external webhooks

pub struct WebhookHandler {
    timeout_secs: u64,
}

impl WebhookHandler {
    pub fn new(timeout_secs: u64) -> Self {
        Self { timeout_secs }
    }
}

#[async_trait::async_trait]
impl TaskHandler for WebhookHandler {
    fn task_type(&self) -> &str {
        "webhook"
    }

    fn timeout_secs(&self) -> u64 {
        self.timeout_secs
    }

    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>> {
        use serde::Deserialize;

        #[derive(Deserialize)]
        struct WebhookRequest {
            url: String,
            method: Option<String>,
            headers: Option<serde_json::Value>,
            body: Option<serde_json::Value>,
            retries: Option<u32>,
        }

        let request: WebhookRequest = serde_json::from_slice(&payload)
            .map_err(|e| task_queue_core::CoreError::Other(format!("Invalid webhook request: {}", e)))?;

        println!("Calling webhook: {}", request.url);
        println!("Method: {}", request.method.unwrap_or("POST".to_string()));

        // Simulate HTTP request
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        // In a real implementation, you would use reqwest crate
        // let client = reqwest::Client::new();
        // let response = client.post(&request.url)
        //     .timeout(Duration::from_secs(self.timeout_secs))
        //     .json(&request.body.unwrap_or(serde_json::Value::Null))
        //     .send()
        //     .await?;

        Ok(serde_json::json!({
            "status": "success",
            "status_code": 200,
            "response_time_ms": 150
        }).to_vec())
    }
}

/// Example 6: Data Aggregation Handler
/// Demonstrates how to aggregate data from multiple sources

pub struct DataAggregationHandler {
    max_sources: usize,
}

impl DataAggregationHandler {
    pub fn new(max_sources: usize) -> Self {
        Self { max_sources }
    }
}

#[async_trait::async_trait]
impl TaskHandler for DataAggregationHandler {
    fn task_type(&self) -> &str {
        "aggregate_data"
    }

    async fn handle(&self, payload: Vec<u8>) -> Result<Vec<u8>> {
        use serde::Deserialize;

        #[derive(Deserialize)]
        struct AggregationRequest {
            sources: Vec<String>,
            operation: String,  // sum, avg, count, min, max
            group_by: Option<Vec<String>>,
        }

        let request: AggregationRequest = serde_json::from_slice(&payload)
            .map_err(|e| task_queue_core::CoreError::Other(format!("Invalid aggregation request: {}", e)))?;

        if request.sources.len() > self.max_sources {
            return Err(task_queue_core::CoreError::Other(
                format!("Too many sources: {} (max: {})", request.sources.len(), self.max_sources)
            ));
        }

        println!("Aggregating data from {} sources", request.sources.len());
        println!("Operation: {}", request.operation);

        // Simulate data aggregation
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        Ok(serde_json::json!({
            "status": "completed",
            "sources_processed": request.sources.len(),
            "result": {
                "value": 1234.56,
                "count": 5678
            }
        }).to_vec())
    }
}

fn main() {
    println!("Example task handlers for Task Queue System");
    println!();
    println!("Available handlers:");
    println!("  - send_email");
    println!("  - process_image");
    println!("  - export_data");
    println!("  - generate_report");
    println!("  - webhook");
    println!("  - aggregate_data");
}
