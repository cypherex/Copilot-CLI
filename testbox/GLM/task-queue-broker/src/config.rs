//! Configuration management for the task queue broker

use crate::error::{Result, TaskQueueError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Broker configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerConfig {
    /// Broker-specific settings
    #[serde(default)]
    pub broker: BrokerSettings,
    /// Persistence settings
    #[serde(default)]
    pub persistence: PersistenceSettings,
    /// Raft clustering settings
    #[serde(default)]
    pub raft: RaftSettings,
    /// API server settings
    #[serde(default)]
    pub api: ApiSettings,
    /// Authentication settings
    #[serde(default)]
    pub auth: AuthSettings,
    /// Monitoring settings
    #[serde(default)]
    pub monitoring: MonitoringSettings,
    /// Worker settings
    #[serde(default)]
    pub worker: WorkerSettings,
}

impl Default for BrokerConfig {
    fn default() -> Self {
        Self {
            broker: BrokerSettings::default(),
            persistence: PersistenceSettings::default(),
            raft: RaftSettings::default(),
            api: ApiSettings::default(),
            auth: AuthSettings::default(),
            monitoring: MonitoringSettings::default(),
            worker: WorkerSettings::default(),
        }
    }
}

impl BrokerConfig {
    /// Load configuration from a YAML file
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let content = fs::read_to_string(path.as_ref()).map_err(|e| {
            TaskQueueError::Configuration(format!("Failed to read config file: {}", e))
        })?;

        let config: BrokerConfig = serde_yaml::from_str(&content).map_err(|e| {
            TaskQueueError::Configuration(format!("Failed to parse config YAML: {}", e))
        })?;

        config.validate()?;
        Ok(config)
    }

    /// Validate the configuration
    pub fn validate(&self) -> Result<()> {
        // Validate broker settings
        if self.broker.port == 0 {
            return Err(TaskQueueError::Configuration(
                "Broker port cannot be 0".to_string(),
            ));
        }

        // Validate API settings
        if self.api.rest_port == 0 {
            return Err(TaskQueueError::Configuration(
                "API REST port cannot be 0".to_string(),
            ));
        }

        // Validate persistence settings
        if self.persistence.completed_task_retention_days == 0 {
            return Err(TaskQueueError::Configuration(
                "Completed task retention days cannot be 0".to_string(),
            ));
        }

        // Validate worker settings
        if self.worker.heartbeat_interval_secs == 0 {
            return Err(TaskQueueError::Configuration(
                "Worker heartbeat interval cannot be 0".to_string(),
            ));
        }

        Ok(())
    }

    /// Load configuration from file or use defaults
    pub fn load_or_default<P: AsRef<Path>>(path: Option<P>) -> Result<Self> {
        match path {
            Some(p) if p.as_ref().exists() => Self::from_file(p),
            _ => {
                tracing::info!("Using default configuration");
                Ok(BrokerConfig::default())
            }
        }
    }
}

/// Broker-specific settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerSettings {
    /// Host address to bind to
    #[serde(default = "default_host")]
    pub host: String,
    /// TCP port to listen on
    #[serde(default = "default_port")]
    pub port: u16,
    /// Maximum number of concurrent connections
    #[serde(default = "default_max_connections")]
    pub max_connections: usize,
    /// Queue depth threshold for backpressure
    #[serde(default = "default_queue_depth_threshold")]
    pub queue_depth_threshold: usize,
    /// Worker lease timeout in seconds
    #[serde(default = "default_worker_lease_timeout")]
    pub worker_lease_timeout_secs: u64,
    /// Maximum number of tasks per batch claim
    #[serde(default = "default_max_batch_claim")]
    pub max_batch_claim: usize,
}

impl Default for BrokerSettings {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            max_connections: default_max_connections(),
            queue_depth_threshold: default_queue_depth_threshold(),
            worker_lease_timeout_secs: default_worker_lease_timeout(),
            max_batch_claim: default_max_batch_claim(),
        }
    }
}

fn default_host() -> String {
    "0.0.0.0".to_string()
}

fn default_port() -> u16 {
    6379
}

fn default_max_connections() -> usize {
    1000
}

fn default_queue_depth_threshold() -> usize {
    100_000
}

fn default_worker_lease_timeout() -> u64 {
    30
}

fn default_max_batch_claim() -> usize {
    10
}

/// Persistence settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceSettings {
    /// Directory for data storage
    #[serde(default = "default_data_dir")]
    pub data_dir: String,
    /// WAL sync interval in milliseconds
    #[serde(default = "default_wal_sync_interval")]
    pub wal_sync_interval_ms: u64,
    /// Retention period for completed tasks in days
    #[serde(default = "default_completed_retention")]
    pub completed_task_retention_days: u32,
    /// Enable automatic compaction
    #[serde(default = "default_auto_compact")]
    pub auto_compact: bool,
    /// Compaction interval in seconds
    #[serde(default = "default_compact_interval")]
    pub compact_interval_secs: u64,
}

impl Default for PersistenceSettings {
    fn default() -> Self {
        Self {
            data_dir: default_data_dir(),
            wal_sync_interval_ms: default_wal_sync_interval(),
            completed_task_retention_days: default_completed_retention(),
            auto_compact: default_auto_compact(),
            compact_interval_secs: default_compact_interval(),
        }
    }
}

fn default_data_dir() -> String {
    "./data".to_string()
}

fn default_wal_sync_interval() -> u64 {
    100
}

fn default_completed_retention() -> u32 {
    7
}

fn default_auto_compact() -> bool {
    true
}

fn default_compact_interval() -> u64 {
    3600
}

/// Raft clustering settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RaftSettings {
    /// Enable Raft clustering
    #[serde(default)]
    pub enabled: bool,
    /// Unique node ID
    #[serde(default = "default_node_id")]
    pub node_id: String,
    /// Peer nodes in the cluster
    #[serde(default)]
    pub peers: Vec<String>,
    /// Election timeout in milliseconds
    #[serde(default = "default_election_timeout")]
    pub election_timeout_ms: u64,
    /// Heartbeat interval in milliseconds
    #[serde(default = "default_heartbeat_interval")]
    pub heartbeat_interval_ms: u64,
    /// Snapshot interval in seconds
    #[serde(default = "default_snapshot_interval")]
    pub snapshot_interval_secs: u64,
}

impl Default for RaftSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            node_id: default_node_id(),
            peers: Vec::new(),
            election_timeout_ms: default_election_timeout(),
            heartbeat_interval_ms: default_heartbeat_interval(),
            snapshot_interval_secs: default_snapshot_interval(),
        }
    }
}

fn default_node_id() -> String {
    "node1".to_string()
}

fn default_election_timeout() -> u64 {
    1000
}

fn default_heartbeat_interval() -> u64 {
    300
}

fn default_snapshot_interval() -> u64 {
    300
}

/// API server settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiSettings {
    /// REST API port
    #[serde(default = "default_rest_port")]
    pub rest_port: u16,
    /// gRPC port
    #[serde(default = "default_grpc_port")]
    pub grpc_port: u16,
    /// Enable TLS
    #[serde(default)]
    pub enable_tls: bool,
    /// TLS certificate path
    #[serde(default)]
    pub tls_cert_path: Option<String>,
    /// TLS key path
    #[serde(default)]
    pub tls_key_path: Option<String>,
}

impl Default for ApiSettings {
    fn default() -> Self {
        Self {
            rest_port: default_rest_port(),
            grpc_port: default_grpc_port(),
            enable_tls: false,
            tls_cert_path: None,
            tls_key_path: None,
        }
    }
}

fn default_rest_port() -> u16 {
    8080
}

fn default_grpc_port() -> u16 {
    9090
}

/// Authentication settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSettings {
    /// Enable authentication
    #[serde(default)]
    pub enabled: bool,
    /// API keys with permissions
    #[serde(default)]
    pub api_keys: Vec<ApiKey>,
}

impl Default for AuthSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            api_keys: Vec::new(),
        }
    }
}

/// API key configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    /// Bcrypt hash of the API key
    pub key_hash: String,
    /// Permissions granted to this key
    pub permissions: Vec<String>,
}

/// Monitoring settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringSettings {
    /// Prometheus metrics port
    #[serde(default = "default_prometheus_port")]
    pub prometheus_port: u16,
    /// Log level
    #[serde(default = "default_log_level")]
    pub log_level: String,
    /// Enable structured JSON logging
    #[serde(default = "default_json_logging")]
    pub json_logging: bool,
}

impl Default for MonitoringSettings {
    fn default() -> Self {
        Self {
            prometheus_port: default_prometheus_port(),
            log_level: default_log_level(),
            json_logging: default_json_logging(),
        }
    }
}

fn default_prometheus_port() -> u16 {
    9091
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_json_logging() -> bool {
    true
}

/// Worker settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerSettings {
    /// Default concurrency per worker
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    /// Heartbeat interval in seconds
    #[serde(default = "default_worker_heartbeat_interval")]
    pub heartbeat_interval_secs: u64,
    /// Graceful shutdown timeout in seconds
    #[serde(default = "default_shutdown_timeout")]
    pub graceful_shutdown_timeout_secs: u64,
    /// Maximum worker inactivity before disconnection
    #[serde(default = "default_max_inactivity")]
    pub max_inactivity_secs: u64,
}

impl Default for WorkerSettings {
    fn default() -> Self {
        Self {
            concurrency: default_concurrency(),
            heartbeat_interval_secs: default_worker_heartbeat_interval(),
            graceful_shutdown_timeout_secs: default_shutdown_timeout(),
            max_inactivity_secs: default_max_inactivity(),
        }
    }
}

fn default_concurrency() -> usize {
    4
}

fn default_worker_heartbeat_interval() -> u64 {
    15
}

fn default_shutdown_timeout() -> u64 {
    60
}

fn default_max_inactivity() -> u64 {
    60
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    #[test]
    fn test_default_config() {
        let config = BrokerConfig::default();
        assert_eq!(config.broker.host, "0.0.0.0");
        assert_eq!(config.broker.port, 6379);
        assert_eq!(config.api.rest_port, 8080);
    }

    #[test]
    fn test_config_validation() {
        let mut config = BrokerConfig::default();
        assert!(config.validate().is_ok());

        config.broker.port = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_load_from_file() {
        let yaml = r#"
broker:
  host: 127.0.0.1
  port: 7000
  max_connections: 500

persistence:
  data_dir: /tmp/data
  completed_task_retention_days: 14

api:
  rest_port: 9000
  grpc_port: 10000
"#;

        let mut temp_file = NamedTempFile::new().unwrap();
        fs::write(temp_file.path(), yaml).unwrap();

        let config = BrokerConfig::from_file(temp_file.path()).unwrap();
        assert_eq!(config.broker.host, "127.0.0.1");
        assert_eq!(config.broker.port, 7000);
        assert_eq!(config.broker.max_connections, 500);
        assert_eq!(config.persistence.data_dir, "/tmp/data");
        assert_eq!(config.persistence.completed_task_retention_days, 14);
        assert_eq!(config.api.rest_port, 9000);
        assert_eq!(config.api.grpc_port, 10000);
    }

    #[test]
    fn test_load_or_default() {
        // Non-existent file should return default
        let config = BrokerConfig::load_or_default(Some::<&str>("/nonexistent/config.yaml")).unwrap();
        assert_eq!(config.broker.port, 6379);
    }
}
