use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use task_queue_persistence::TaskStoreConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerConfig {
    pub broker: NetworkConfig,
    pub persistence: PersistenceConfig,
    pub raft: Option<RaftConfig>,
    pub api: ApiConfig,
    pub auth: AuthConfig,
    pub monitoring: MonitoringConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    pub host: String,
    pub port: u16,
    pub max_connections: usize,
    pub queue_depth_threshold: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceConfig {
    pub data_dir: PathBuf,
    pub wal_sync_interval_ms: u64,
    pub completed_task_retention_days: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RaftConfig {
    pub enabled: bool,
    pub node_id: String,
    pub peers: Vec<String>,
    pub election_timeout_ms: u64,
    pub heartbeat_interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiConfig {
    pub rest_port: u16,
    pub grpc_port: u16,
    pub enable_tls: bool,
    pub tls_cert_path: Option<PathBuf>,
    pub tls_key_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    pub enabled: bool,
    pub api_keys: Vec<ApiKeyConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyConfig {
    pub key_hash: String,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringConfig {
    pub prometheus_port: u16,
    pub log_level: String,
}

impl Default for BrokerConfig {
    fn default() -> Self {
        BrokerConfig {
            broker: NetworkConfig {
                host: "0.0.0.0".to_string(),
                port: 6379,
                max_connections: 1000,
                queue_depth_threshold: 100000,
            },
            persistence: PersistenceConfig {
                data_dir: PathBuf::from("./data"),
                wal_sync_interval_ms: 100,
                completed_task_retention_days: 7,
            },
            raft: None,
            api: ApiConfig {
                rest_port: 8080,
                grpc_port: 9090,
                enable_tls: false,
                tls_cert_path: None,
                tls_key_path: None,
            },
            auth: AuthConfig {
                enabled: false,
                api_keys: vec![],
            },
            monitoring: MonitoringConfig {
                prometheus_port: 9091,
                log_level: "info".to_string(),
            },
        }
    }
}

impl BrokerConfig {
    pub fn from_file(path: &str) -> anyhow::Result<Self> {
        let contents = std::fs::read_to_string(path)?;
        let config: BrokerConfig = serde_yaml::from_str(&contents)?;
        Ok(config)
    }

    pub fn to_task_store_config(&self) -> TaskStoreConfig {
        TaskStoreConfig {
            data_dir: self.persistence.data_dir.clone(),
            wal_sync_interval_ms: self.persistence.wal_sync_interval_ms,
            completed_task_retention_days: self.persistence.completed_task_retention_days,
        }
    }
}
