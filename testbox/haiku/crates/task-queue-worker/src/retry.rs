//! Retry logic with exponential backoff.

use std::time::Duration;

/// Retry policy configuration.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// Base delay for exponential backoff (in seconds)
    pub base_delay_secs: u64,
    /// Maximum delay cap (in seconds)
    pub max_delay_secs: u64,
    /// Maximum number of retry attempts
    pub max_retries: u32,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            base_delay_secs: 5,   // 5 seconds base delay
            max_delay_secs: 3600, // 1 hour max delay
            max_retries: 3,
        }
    }
}

impl RetryPolicy {
    /// Create a new retry policy.
    pub fn new(base_delay_secs: u64, max_delay_secs: u64, max_retries: u32) -> Self {
        Self {
            base_delay_secs,
            max_delay_secs,
            max_retries,
        }
    }

    /// Calculate the delay before the next retry attempt.
    ///
    /// Uses exponential backoff: base_delay * 2^(attempt_number)
    /// The delay is capped at max_delay_secs.
    pub fn calculate_delay(&self, attempt_number: u32) -> Duration {
        let base_delay = Duration::from_secs(self.base_delay_secs);

        // Calculate exponential backoff: base_delay * 2^attempt_number
        let backoff_multiplier = 2u64.pow(attempt_number.min(20)); // Prevent overflow
        let delay = base_delay * backoff_multiplier;

        // Cap at max delay
        let max_delay = Duration::from_secs(self.max_delay_secs);
        delay.min(max_delay)
    }

    /// Check if a task should be retried based on retry count.
    pub fn should_retry(&self, retry_count: u32) -> bool {
        retry_count < self.max_retries
    }

    /// Check if a task should be moved to dead letter queue.
    pub fn should_dead_letter(&self, retry_count: u32) -> bool {
        retry_count >= self.max_retries
    }
}

/// Calculate backoff delay using default policy.
///
/// Formula: base_delay * 2^(attempt_number), capped at 1 hour
///
/// # Arguments
/// * `attempt_number` - The current attempt number (0-indexed)
///
/// # Returns
/// Duration to wait before next retry
pub fn calculate_backoff(attempt_number: u32) -> Duration {
    let policy = RetryPolicy::default();
    policy.calculate_delay(attempt_number)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_policy() {
        let policy = RetryPolicy::default();
        assert_eq!(policy.base_delay_secs, 5);
        assert_eq!(policy.max_delay_secs, 3600);
        assert_eq!(policy.max_retries, 3);
    }

    #[test]
    fn test_calculate_delay_attempt_0() {
        let policy = RetryPolicy::default();
        let delay = policy.calculate_delay(0);
        // base_delay * 2^0 = 5 * 1 = 5 seconds
        assert_eq!(delay, Duration::from_secs(5));
    }

    #[test]
    fn test_calculate_delay_attempt_1() {
        let policy = RetryPolicy::default();
        let delay = policy.calculate_delay(1);
        // base_delay * 2^1 = 5 * 2 = 10 seconds
        assert_eq!(delay, Duration::from_secs(10));
    }

    #[test]
    fn test_calculate_delay_attempt_2() {
        let policy = RetryPolicy::default();
        let delay = policy.calculate_delay(2);
        // base_delay * 2^2 = 5 * 4 = 20 seconds
        assert_eq!(delay, Duration::from_secs(20));
    }

    #[test]
    fn test_calculate_delay_attempt_3() {
        let policy = RetryPolicy::default();
        let delay = policy.calculate_delay(3);
        // base_delay * 2^3 = 5 * 8 = 40 seconds
        assert_eq!(delay, Duration::from_secs(40));
    }

    #[test]
    fn test_calculate_delay_cap_at_max() {
        let policy = RetryPolicy::default();
        let delay = policy.calculate_delay(10);
        // 5 * 2^10 = 5120 seconds, should be capped at 3600 seconds (1 hour)
        assert_eq!(delay, Duration::from_secs(3600));
    }

    #[test]
    fn test_calculate_backoff_function() {
        let delay = calculate_backoff(0);
        assert_eq!(delay, Duration::from_secs(5));

        let delay = calculate_backoff(2);
        assert_eq!(delay, Duration::from_secs(20));
    }

    #[test]
    fn test_should_retry() {
        let policy = RetryPolicy::default();

        // Should retry attempts 0, 1, 2 (less than max_retries=3)
        assert!(policy.should_retry(0));
        assert!(policy.should_retry(1));
        assert!(policy.should_retry(2));

        // Should not retry attempt 3 (equal to max_retries)
        assert!(!policy.should_retry(3));
        assert!(!policy.should_retry(4));
    }

    #[test]
    fn test_should_dead_letter() {
        let policy = RetryPolicy::default();

        // Should not dead letter attempts 0, 1, 2 (less than max_retries=3)
        assert!(!policy.should_dead_letter(0));
        assert!(!policy.should_dead_letter(1));
        assert!(!policy.should_dead_letter(2));

        // Should dead letter attempt 3 (equal to max_retries)
        assert!(policy.should_dead_letter(3));
        assert!(policy.should_dead_letter(4));
    }

    #[test]
    fn test_custom_policy() {
        let policy = RetryPolicy::new(10, 1800, 5); // 10s base, 30min max, 5 retries

        assert_eq!(policy.base_delay_secs, 10);
        assert_eq!(policy.max_delay_secs, 1800);
        assert_eq!(policy.max_retries, 5);

        let delay = policy.calculate_delay(0);
        assert_eq!(delay, Duration::from_secs(10));

        let delay = policy.calculate_delay(1);
        assert_eq!(delay, Duration::from_secs(20));

        let delay = policy.calculate_delay(4);
        assert_eq!(delay, Duration::from_secs(160));
    }

    #[test]
    fn test_exponential_growth() {
        let policy = RetryPolicy::default();

        let delays: Vec<u64> = (0..5)
            .map(|i| policy.calculate_delay(i).as_secs())
            .collect();

        // Should grow exponentially: 5, 10, 20, 40, 80
        assert_eq!(delays, vec![5, 10, 20, 40, 80]);
    }

    #[test]
    fn test_large_attempt_number() {
        let policy = RetryPolicy::default();

        // Very large attempt numbers should be capped
        let delay = policy.calculate_delay(100);
        assert_eq!(delay, Duration::from_secs(3600));
    }
}
