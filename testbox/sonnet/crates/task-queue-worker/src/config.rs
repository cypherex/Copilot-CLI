use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerConfig {
    pub broker_address: String,
    pub worker_id: Option<String>,
    pub concurrency: usize,
    pub heartbeat_interval_secs: u64,
    pub graceful_shutdown_timeout_secs: u64,
}

impl Default for WorkerConfig {
    fn default() -> Self {
        WorkerConfig {
            broker_address: "127.0.0.1:6379".to_string(),
            worker_id: None,
            concurrency: 4,
            heartbeat_interval_secs: 15,
            graceful_shutdown_timeout_secs: 60,
        }
    }
}

impl WorkerConfig {
    pub fn from_file(path: &str) -> anyhow::Result<Self> {
        let contents = std::fs::read_to_string(path)?;
        let config: WorkerConfig = serde_yaml::from_str(&contents)?;
        Ok(config)
    }

    pub fn generate_worker_id(&self) -> String {
        use std::process;
        use uuid::Uuid;

        if let Some(id) = &self.worker_id {
            return id.clone();
        }

        let hostname = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "unknown".to_string());

        let pid = process::id();
        let random = Uuid::new_v4().to_string().split('-').next().unwrap().to_string();

        format!("{}-{}-{}", hostname, pid, random)
    }
}
