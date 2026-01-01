//! Broker configuration

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerConfig {
    pub broker: BrokerSection,
    pub persistence: PersistenceSection,
    pub raft: RaftSection,
    pub api: ApiSection,
    pub auth: AuthSection,
    pub monitoring: MonitoringSection,
    pub worker: WorkerSection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerSection {
    pub host: String,
    pub port: u16,
    pub max_connections: usize,
    pub queue_depth_threshold: usize,
}

impl Default for BrokerSection {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: 6379,
            max_connections: 1000,
            queue_depth_threshold: 100000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceSection {
    pub data_dir: PathBuf,
    pub wal_sync_interval_ms: u64,
    pub completed_task_retention_days: u64,
}

impl Default for PersistenceSection {
    fn default() -> Self {
        Self {
            data_dir: PathBuf::from("./data"),
            wal_sync_interval_ms: 100,
            completed_task_retention_days: 7,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RaftSection {
    pub enabled: bool,
    pub node_id: String,
    pub peers: Vec<String>,
    pub election_timeout_ms: u64,
    pub heartbeat_interval_ms: u64,
    pub snapshot_interval: u64,
}

impl Default for RaftSection {
    fn default() -> Self {
        Self {
            enabled: false,
            node_id: "node1".to_string(),
            peers: Vec::new(),
            election_timeout_ms: 1000,
            heartbeat_interval_ms: 300,
            snapshot_interval: 10000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiSection {
    pub rest_port: u16,
    pub grpc_port: u16,
    pub enable_tls: bool,
    pub tls_cert_path: Option<String>,
    pub tls_key_path: Option<String>,
}

impl Default for ApiSection {
    fn default() -> Self {
        Self {
            rest_port: 8080,
            grpc_port: 9090,
            enable_tls: false,
            tls_cert_path: None,
            tls_key_path: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSection {
    pub enabled: bool,
    pub api_keys: Vec<ApiKey>,
}

impl Default for AuthSection {
    fn default() -> Self {
        Self {
            enabled: false,
            api_keys: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub key_hash: String,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringSection {
    pub prometheus_port: u16,
    pub log_level: String,
}

impl Default for MonitoringSection {
    fn default() -> Self {
        Self {
            prometheus_port: 9091,
            log_level: "info".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerSection {
    pub concurrency: usize,
    pub heartbeat_interval_secs: u64,
    pub lease_timeout_secs: u64,
    pub graceful_shutdown_timeout_secs: u64,
}

impl Default for WorkerSection {
    fn default() -> Self {
        Self {
            concurrency: 4,
            heartbeat_interval_secs: 15,
            lease_timeout_secs: 30,
            graceful_shutdown_timeout_secs: 60,
        }
    }
}

impl Default for BrokerConfig {
    fn default() -> Self {
        Self {
            broker: BrokerSection::default(),
            persistence: PersistenceSection::default(),
            raft: RaftSection::default(),
            api: ApiSection::default(),
            auth: AuthSection::default(),
            monitoring: MonitoringSection::default(),
            worker: WorkerSection::default(),
        }
    }
}

impl BrokerConfig {
    /// Load config from file
    pub fn from_file(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let content = std::fs::read_to_string(path)?;
        let config: BrokerConfig = serde_yaml::from_str(&content)?;
        Ok(config)
    }

    /// Save config to file
    pub fn to_file(&self, path: &str) -> Result<(), Box<dyn std::error::Error>> {
        let content = serde_yaml::to_string(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    /// Load from environment variables
    pub fn from_env() -> Self {
        let mut config = Self::default();

        if let Ok(host) = std::env::var("TQ_BROKER_HOST") {
            config.broker.host = host;
        }
        if let Ok(port) = std::env::var("TQ_BROKER_PORT") {
            config.broker.port = port.parse().unwrap_or(config.broker.port);
        }
        if let Ok(port) = std::env::var("TQ_REST_PORT") {
            config.api.rest_port = port.parse().unwrap_or(config.api.rest_port);
        }
        if let Ok(port) = std::env::var("TQ_GRPC_PORT") {
            config.api.grpc_port = port.parse().unwrap_or(config.api.grpc_port);
        }
        if let Ok(level) = std::env::var("TQ_LOG_LEVEL") {
            config.monitoring.log_level = level;
        }

        config
    }
}
