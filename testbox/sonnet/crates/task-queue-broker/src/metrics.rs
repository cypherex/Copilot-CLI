use prometheus::{
    Counter, CounterVec, Gauge, GaugeVec, Histogram, HistogramOpts, HistogramVec, IntGauge,
    IntGaugeVec, Opts, Registry,
};
use std::sync::Arc;

/// Prometheus metrics for the broker
pub struct BrokerMetrics {
    pub registry: Registry,

    // Task counters
    pub tasks_total: CounterVec,

    // Task gauges
    pub tasks_pending: IntGauge,
    pub tasks_in_progress: IntGauge,

    // Processing duration
    pub task_processing_duration: HistogramVec,

    // Worker metrics
    pub workers_connected: IntGauge,

    // Queue depth
    pub broker_queue_depth: IntGaugeVec,

    // Raft metrics
    pub raft_term: IntGauge,
    pub raft_leader: IntGauge,
}

impl BrokerMetrics {
    pub fn new() -> anyhow::Result<Self> {
        let registry = Registry::new();

        // Task counters
        let tasks_total = CounterVec::new(
            Opts::new("tq_tasks_total", "Total number of tasks by status and type"),
            &["status", "task_type"],
        )?;
        registry.register(Box::new(tasks_total.clone()))?;

        // Task gauges
        let tasks_pending = IntGauge::new("tq_tasks_pending", "Number of pending tasks")?;
        registry.register(Box::new(tasks_pending.clone()))?;

        let tasks_in_progress = IntGauge::new("tq_tasks_in_progress", "Number of in-progress tasks")?;
        registry.register(Box::new(tasks_in_progress.clone()))?;

        // Processing duration histogram
        let task_processing_duration = HistogramVec::new(
            HistogramOpts::new(
                "tq_task_processing_duration_seconds",
                "Task processing duration in seconds",
            ),
            &["task_type"],
        )?;
        registry.register(Box::new(task_processing_duration.clone()))?;

        // Worker metrics
        let workers_connected = IntGauge::new("tq_workers_connected", "Number of connected workers")?;
        registry.register(Box::new(workers_connected.clone()))?;

        // Queue depth by priority
        let broker_queue_depth = IntGaugeVec::new(
            Opts::new("tq_broker_queue_depth", "Queue depth by priority tier"),
            &["priority"],
        )?;
        registry.register(Box::new(broker_queue_depth.clone()))?;

        // Raft metrics
        let raft_term = IntGauge::new("tq_raft_term", "Current Raft term number")?;
        registry.register(Box::new(raft_term.clone()))?;

        let raft_leader = IntGauge::new("tq_raft_leader", "1 if this node is leader, 0 otherwise")?;
        registry.register(Box::new(raft_leader.clone()))?;

        Ok(BrokerMetrics {
            registry,
            tasks_total,
            tasks_pending,
            tasks_in_progress,
            task_processing_duration,
            workers_connected,
            broker_queue_depth,
            raft_term,
            raft_leader,
        })
    }

    /// Update queue depth metrics
    pub fn update_queue_depth(&self, high: i64, normal: i64, low: i64) {
        self.broker_queue_depth
            .with_label_values(&["high"])
            .set(high);
        self.broker_queue_depth
            .with_label_values(&["normal"])
            .set(normal);
        self.broker_queue_depth
            .with_label_values(&["low"])
            .set(low);
    }

    /// Increment task counter
    pub fn inc_tasks_total(&self, status: &str, task_type: &str) {
        self.tasks_total
            .with_label_values(&[status, task_type])
            .inc();
    }

    /// Record task processing duration
    pub fn observe_processing_duration(&self, task_type: &str, duration_secs: f64) {
        self.task_processing_duration
            .with_label_values(&[task_type])
            .observe(duration_secs);
    }
}

impl Default for BrokerMetrics {
    fn default() -> Self {
        Self::new().expect("Failed to create metrics")
    }
}
