//! Worker heartbeat with CPU and memory statistics.

use std::time::Duration;
use tokio::time::interval;
use serde::{Deserialize, Serialize};

/// Worker statistics for heartbeats.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerStats {
    /// CPU usage percentage (0.0 - 100.0)
    pub cpu_usage_percent: f64,
    /// Memory usage in bytes
    pub memory_used_bytes: u64,
    /// Total memory available in bytes
    pub memory_total_bytes: u64,
    /// Number of tasks currently being processed
    pub active_tasks: u32,
    /// Total tasks processed since worker start
    pub total_tasks_processed: u64,
    /// Total tasks failed since worker start
    pub total_tasks_failed: u64,
    /// Worker uptime in seconds
    pub uptime_seconds: u64,
}

impl Default for WorkerStats {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkerStats {
    /// Create new worker statistics.
    pub fn new() -> Self {
        Self {
            cpu_usage_percent: 0.0,
            memory_used_bytes: 0,
            memory_total_bytes: 0,
            active_tasks: 0,
            total_tasks_processed: 0,
            total_tasks_failed: 0,
            uptime_seconds: 0,
        }
    }

    /// Get memory usage as a percentage.
    pub fn memory_usage_percent(&self) -> f64 {
        if self.memory_total_bytes == 0 {
            return 0.0;
        }
        (self.memory_used_bytes as f64 / self.memory_total_bytes as f64) * 100.0
    }

    /// Update statistics with current system information.
    #[cfg(unix)]
    pub fn update_system_info(&mut self) {
        // Try to get actual system stats on Unix systems
        if let Ok(cpu) = self::get_cpu_usage() {
            self.cpu_usage_percent = cpu;
        }
        if let Ok((used, total)) = self::get_memory_usage() {
            self.memory_used_bytes = used;
            self.memory_total_bytes = total;
        }
    }

    #[cfg(windows)]
    pub fn update_system_info(&mut self) {
        // On Windows, try to get actual system stats
        if let Ok(cpu) = self::get_cpu_usage() {
            self.cpu_usage_percent = cpu;
        }
        if let Ok((used, total)) = self::get_memory_usage() {
            self.memory_used_bytes = used;
            self.memory_total_bytes = total;
        }
    }

    /// Increment active task count.
    pub fn increment_active(&mut self) {
        self.active_tasks += 1;
    }

    /// Decrement active task count.
    pub fn decrement_active(&mut self) {
        if self.active_tasks > 0 {
            self.active_tasks -= 1;
        }
    }

    /// Record a successful task completion.
    pub fn record_success(&mut self) {
        self.total_tasks_processed += 1;
        self.decrement_active();
    }

    /// Record a failed task.
    pub fn record_failure(&mut self) {
        self.total_tasks_failed += 1;
        self.total_tasks_processed += 1;
        self.decrement_active();
    }

    /// Update uptime.
    pub fn update_uptime(&mut self, uptime: Duration) {
        self.uptime_seconds = uptime.as_secs();
    }
}

#[cfg(unix)]
fn get_cpu_usage() -> Result<f64, Box<dyn std::error::Error>> {
    use std::fs;

    // Read /proc/stat for CPU times
    let stat_content = fs::read_to_string("/proc/stat")?;
    let first_line = stat_content.lines().next().ok_or("No content in /proc/stat")?;

    // Parse CPU times: user, nice, system, idle, iowait, irq, softirq
    let parts: Vec<u64> = first_line
        .split_whitespace()
        .skip(1)
        .take(7)
        .map(|s| s.parse().unwrap_or(0))
        .collect();

    if parts.len() >= 4 {
        let idle = parts[3];
        let total: u64 = parts.iter().sum();
        let usage = if total > 0 {
            ((total - idle) as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        Ok(usage)
    } else {
        Ok(0.0)
    }
}

#[cfg(unix)]
fn get_memory_usage() -> Result<(u64, u64), Box<dyn std::error::Error>> {
    use std::fs;

    // Read /proc/meminfo for memory info
    let meminfo_content = fs::read_to_string("/proc/meminfo")?;

    let mut total: u64 = 0;
    let mut free: u64 = 0;
    let mut buffers: u64 = 0;
    let mut cached: u64 = 0;

    for line in meminfo_content.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let key = parts[0].trim_end_matches(':');
            let value = parts[1].parse().unwrap_or(0u64) * 1024; // Convert kB to bytes

            match key {
                "MemTotal" => total = value,
                "MemFree" => free = value,
                "Buffers" => buffers = value,
                "Cached" | "SReclaimable" => cached += value,
                _ => {}
            }
        }
    }

    let used = total.saturating_sub(free).saturating_sub(buffers).saturating_sub(cached);
    Ok((used, total))
}

#[cfg(windows)]
fn get_cpu_usage() -> Result<f64, Box<dyn std::error::Error>> {
    // Windows CPU usage would require winapi or similar
    // For now, return a dummy value
    Ok(0.0)
}

#[cfg(windows)]
fn get_memory_usage() -> Result<(u64, u64), Box<dyn std::error::Error>> {
    use std::mem;
    // Return estimated memory stats
    // In production, you'd use windows-rs or winapi
    Ok((100 * 1024 * 1024, 8 * 1024 * 1024 * 1024)) // 100MB used, 8GB total
}

/// Heartbeat sender for worker status updates.
pub struct Heartbeat {
    worker_id: String,
    broker_client: Option<HeartbeatClient>,
    stats: WorkerStats,
    start_time: std::time::Instant,
}

/// Client for sending heartbeats to the broker.
pub struct HeartbeatClient;

impl Heartbeat {
    /// Create a new heartbeat sender.
    pub fn new(worker_id: String) -> Self {
        Self {
            worker_id,
            broker_client: None, // Would be initialized with actual broker client
            stats: WorkerStats::new(),
            start_time: std::time::Instant::now(),
        }
    }

    /// Start the heartbeat loop with specified interval.
    pub async fn start(&mut self, interval_secs: u64) {
        let mut interval = interval(Duration::from_secs(interval_secs));
        interval.tick().await; // Skip first tick

        loop {
            interval.tick().await;

            // Update stats
            self.stats.update_system_info();
            self.stats.update_uptime(self.start_time.elapsed());

            // Send heartbeat to broker
            if let Some(ref client) = self.broker_client {
                client.send_heartbeat(&self.worker_id, &self.stats).await;
            }

            // Log heartbeat (would use tracing in production)
            tracing::info!(
                worker_id = %self.worker_id,
                cpu_percent = self.stats.cpu_usage_percent,
                memory_mb = self.stats.memory_used_bytes / 1024 / 1024,
                active_tasks = self.stats.active_tasks,
                "Heartbeat sent"
            );
        }
    }

    /// Get current stats.
    pub fn stats(&self) -> &WorkerStats {
        &self.stats
    }

    /// Get mutable stats for updating.
    pub fn stats_mut(&mut self) -> &mut WorkerStats {
        &mut self.stats
    }
}

impl HeartbeatClient {
    /// Send a heartbeat to the broker.
    pub async fn send_heartbeat(&self, _worker_id: &str, _stats: &WorkerStats) {
        // In production, this would send to the broker via gRPC/Redis/etc.
        // For now, it's a no-op that will be filled in when broker client is available
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_worker_stats_default() {
        let stats = WorkerStats::default();
        assert_eq!(stats.cpu_usage_percent, 0.0);
        assert_eq!(stats.active_tasks, 0);
        assert_eq!(stats.total_tasks_processed, 0);
    }

    #[test]
    fn test_worker_stats_increment_active() {
        let mut stats = WorkerStats::new();
        stats.increment_active();
        assert_eq!(stats.active_tasks, 1);
        stats.increment_active();
        assert_eq!(stats.active_tasks, 2);
    }

    #[test]
    fn test_worker_stats_decrement_active() {
        let mut stats = WorkerStats::new();
        stats.active_tasks = 2;
        stats.decrement_active();
        assert_eq!(stats.active_tasks, 1);
        stats.decrement_active();
        assert_eq!(stats.active_tasks, 0);
        stats.decrement_active(); // Should not go negative
        assert_eq!(stats.active_tasks, 0);
    }

    #[test]
    fn test_worker_stats_record_success() {
        let mut stats = WorkerStats::new();
        stats.active_tasks = 1;
        stats.record_success();
        assert_eq!(stats.active_tasks, 0);
        assert_eq!(stats.total_tasks_processed, 1);
        assert_eq!(stats.total_tasks_failed, 0);
    }

    #[test]
    fn test_worker_stats_record_failure() {
        let mut stats = WorkerStats::new();
        stats.active_tasks = 1;
        stats.record_failure();
        assert_eq!(stats.active_tasks, 0);
        assert_eq!(stats.total_tasks_processed, 1);
        assert_eq!(stats.total_tasks_failed, 1);
    }

    #[test]
    fn test_worker_stats_memory_percent() {
        let mut stats = WorkerStats::new();
        stats.memory_used_bytes = 500 * 1024 * 1024; // 500MB
        stats.memory_total_bytes = 1000 * 1024 * 1024; // 1000MB
        assert_eq!(stats.memory_usage_percent(), 50.0);
    }

    #[test]
    fn test_worker_stats_memory_percent_zero_total() {
        let mut stats = WorkerStats::new();
        stats.memory_used_bytes = 100;
        stats.memory_total_bytes = 0;
        assert_eq!(stats.memory_usage_percent(), 0.0);
    }

    #[test]
    fn test_heartbeat_creation() {
        let heartbeat = Heartbeat::new("worker-123".to_string());
        assert_eq!(heartbeat.stats().active_tasks, 0);
    }

    #[test]
    fn test_heartbeat_stats_mut() {
        let mut heartbeat = Heartbeat::new("worker-123".to_string());
        heartbeat.stats_mut().increment_active();
        assert_eq!(heartbeat.stats().active_tasks, 1);
    }
}
