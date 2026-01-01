//! Metrics collection and Prometheus export

use prometheus::{
    Counter, Gauge, Histogram, IntGauge, Registry, TextEncoder, Encoder,
};
use std::sync::Arc;
use task_queue_core::task::TaskStatus;

/// Metrics collector
#[derive(Clone)]
pub struct Metrics {
    registry: Registry,
    tasks_total: Counter,
    tasks_pending: IntGauge,
    tasks_in_progress: IntGauge,
    task_processing_duration: Histogram,
    workers_connected: IntGauge,
    broker_queue_depth: IntGauge,
    raft_term: IntGauge,
    raft_leader: IntGauge,
}

impl Metrics {
    /// Create a new metrics collector
    pub fn new() -> Self {
        let registry = Registry::new();

        let tasks_total = Counter::new(
            "tq_tasks_total",
            "Total number of tasks processed"
        ).unwrap();

        let tasks_pending = IntGauge::new(
            "tq_tasks_pending",
            "Number of pending tasks"
        ).unwrap();

        let tasks_in_progress = IntGauge::new(
            "tq_tasks_in_progress",
            "Number of in-progress tasks"
        ).unwrap();

        let task_processing_duration = Histogram::with_opts(
            prometheus::HistogramOpts::new(
                "tq_task_processing_duration_seconds",
                "Task processing duration in seconds"
            )
            .buckets(vec![0.001, 0.01, 0.1, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0])
        ).unwrap();

        let workers_connected = IntGauge::new(
            "tq_workers_connected",
            "Number of connected workers"
        ).unwrap();

        let broker_queue_depth = IntGauge::new(
            "tq_broker_queue_depth",
            "Queue depth by priority"
        ).unwrap();

        let raft_term = IntGauge::new(
            "tq_raft_term",
            "Current Raft term"
        ).unwrap();

        let raft_leader = IntGauge::new(
            "tq_raft_leader",
            "1 if this node is Raft leader, 0 otherwise"
        ).unwrap();

        registry.register(Box::new(tasks_total.clone())).unwrap();
        registry.register(Box::new(tasks_pending.clone())).unwrap();
        registry.register(Box::new(tasks_in_progress.clone())).unwrap();
        registry.register(Box::new(task_processing_duration.clone())).unwrap();
        registry.register(Box::new(workers_connected.clone())).unwrap();
        registry.register(Box::new(broker_queue_depth.clone())).unwrap();
        registry.register(Box::new(raft_term.clone())).unwrap();
        registry.register(Box::new(raft_leader.clone())).unwrap();

        Self {
            registry,
            tasks_total,
            tasks_pending,
            tasks_in_progress,
            task_processing_duration,
            workers_connected,
            broker_queue_depth,
            raft_term,
            raft_leader,
        }
    }

    /// Record task submission
    pub fn record_task_submission(&self, task_type: &str) {
        self.tasks_total
            .get_metric_with_label_values(&["submitted", task_type])
            .unwrap()
            .inc();
    }

    /// Record task completion
    pub fn record_task_completion(&self, status: TaskStatus, task_type: &str, duration_secs: f64) {
        let status_label = match status {
            TaskStatus::Completed => "completed",
            TaskStatus::Failed => "failed",
            TaskStatus::DeadLetter => "dead_letter",
            _ => return,
        };

        self.tasks_total
            .get_metric_with_label_values(&[status_label, task_type])
            .unwrap()
            .inc();

        self.task_processing_duration
            .get_metric_with_label_values(&[task_type])
            .unwrap()
            .observe(duration_secs);
    }

    /// Update pending task count
    pub fn set_pending_tasks(&self, count: i64) {
        self.tasks_pending.set(count);
    }

    /// Update in-progress task count
    pub fn set_in_progress_tasks(&self, count: i64) {
        self.tasks_in_progress.set(count);
    }

    /// Update worker count
    pub fn set_workers_connected(&self, count: i64) {
        self.workers_connected.set(count);
    }

    /// Update queue depth by priority
    pub fn set_queue_depth(&self, priority: &str, count: i64) {
        self.broker_queue_depth
            .get_metric_with_label_values(&[priority])
            .unwrap()
            .set(count);
    }

    /// Update Raft term
    pub fn set_raft_term(&self, term: i64) {
        self.raft_term.set(term);
    }

    /// Update Raft leader status
    pub fn set_raft_leader(&self, is_leader: bool) {
        self.raft_leader.set(if is_leader { 1 } else { 0 });
    }

    /// Export metrics in Prometheus format
    pub fn export(&self) -> Result<String, Box<dyn std::error::Error>> {
        let encoder = TextEncoder::new();
        let metric_families = self.registry.gather();
        let mut buffer = Vec::new();
        encoder.encode(&metric_families, &mut buffer)?;
        Ok(String::from_utf8(buffer)?)
    }

    /// Get the registry for external use
    pub fn registry(&self) -> &Registry {
        &self.registry
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}

/// HTTP handler for metrics endpoint
pub async fn metrics_handler(metrics: Arc<Metrics>) -> Result<String, Box<dyn std::error::Error>> {
    metrics.export()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_creation() {
        let metrics = Metrics::new();
        metrics.record_task_submission("test_task");
        metrics.set_pending_tasks(10);
        metrics.set_workers_connected(5);

        let export = metrics.export().unwrap();
        assert!(export.contains("tq_tasks_total"));
        assert!(export.contains("tq_tasks_pending"));
        assert!(export.contains("tq_workers_connected"));
    }
}
