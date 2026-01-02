//! Worker configuration

use config::{Config, ConfigError, Environment, File};
use serde::{Deserialize, Serialize};

/// Worker configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerConfig {
    /// Broker address
    pub broker: BrokerSettings,
    /// Worker settings
    pub worker: WorkerSettings,
    /// Monitoring settings
    pub monitoring: MonitoringSettings,
}

/// Broker connection settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrokerSettings {
    /// Broker address
    pub host: String,
    /// Broker port
    pub port: u16,
    /// Maximum connection retries
    pub max_retries: u32,
    /// Base backoff delay in milliseconds
    pub base_backoff_ms: u64,
    /// Maximum backoff delay in milliseconds
    pub max_backoff_ms: u64,
}

/// Worker execution settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerSettings {
    /// Concurrency level (number of parallel tasks)
    pub concurrency: usize,
    /// Heartbeat interval in seconds
    pub heartbeat_interval_secs: u64,
    /// Graceful shutdown timeout in seconds
    pub graceful_shutdown_timeout_secs: u64,
    /// Task lease duration in seconds
    pub lease_duration_secs: u64,
}

/// Monitoring settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringSettings {
    /// Log level
    pub log_level: String,
}

impl Default for WorkerConfig {
    fn default() -> Self {
        Self {
            broker: BrokerSettings::default(),
            worker: WorkerSettings::default(),
            monitoring: MonitoringSettings::default(),
        }
    }
}

impl Default for BrokerSettings {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 6379,
            max_retries: 10,
            base_backoff_ms: 1000,
            max_backoff_ms: 60000,
        }
    }
}

impl Default for WorkerSettings {
    fn default() -> Self {
        Self {
            concurrency: 4,
            heartbeat_interval_secs: 15,
            graceful_shutdown_timeout_secs: 60,
            lease_duration_secs: 30,
        }
    }
}

impl Default for MonitoringSettings {
    fn default() -> Self {
        Self {
            log_level: "info".to_string(),
        }
    }
}

impl WorkerConfig {
    /// Load configuration from file and environment
    pub fn load(path: &str) -> Result<Self, ConfigError> {
        let config = Config::builder()
            .add_source(File::with_name(path).required(false))
            .add_source(Environment::with_prefix("TQ").separator("_"))
            .build()?;

        config.try_deserialize()
    }

    /// Get broker address as a string
    pub fn broker_address(&self) -> String {
        format!("{}:{}", self.broker.host, self.broker.port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = WorkerConfig::default();
        assert_eq!(config.worker.concurrency, 4);
        assert_eq!(config.broker_address(), "127.0.0.1:6379");
    }
}