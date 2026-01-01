use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

/// Priority levels for task execution.
/// Higher numerical values indicate higher priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Priority(u8);

impl Priority {
    /// High priority: 200-255
    pub const HIGH_MIN: u8 = 200;
    pub const HIGH_MAX: u8 = 255;

    /// Normal priority: 100-199
    pub const NORMAL_MIN: u8 = 100;
    pub const NORMAL_MAX: u8 = 199;

    /// Low priority: 0-99
    pub const LOW_MIN: u8 = 0;
    pub const LOW_MAX: u8 = 99;

    /// Create a new priority value
    pub fn new(value: u8) -> Self {
        Priority(value)
    }

    /// High priority (default: 200)
    pub fn high() -> Self {
        Priority(200)
    }

    /// Normal priority (default: 150)
    pub fn normal() -> Self {
        Priority(150)
    }

    /// Low priority (default: 50)
    pub fn low() -> Self {
        Priority(50)
    }

    /// Get the raw priority value
    pub fn value(&self) -> u8 {
        self.0
    }

    /// Get the tier name
    pub fn tier(&self) -> &'static str {
        match self.0 {
            Self::HIGH_MIN..=Self::HIGH_MAX => "high",
            Self::NORMAL_MIN..=Self::NORMAL_MAX => "normal",
            Self::LOW_MIN..=Self::LOW_MAX => "low",
        }
    }

    /// Check if this is a high priority task
    pub fn is_high(&self) -> bool {
        self.0 >= Self::HIGH_MIN
    }

    /// Check if this is a normal priority task
    pub fn is_normal(&self) -> bool {
        self.0 >= Self::NORMAL_MIN && self.0 <= Self::NORMAL_MAX
    }

    /// Check if this is a low priority task
    pub fn is_low(&self) -> bool {
        self.0 <= Self::LOW_MAX
    }
}

impl PartialOrd for Priority {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Priority {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.cmp(&other.0)
    }
}

impl Default for Priority {
    fn default() -> Self {
        Self::normal()
    }
}

impl From<u8> for Priority {
    fn from(value: u8) -> Self {
        Priority(value)
    }
}

impl From<Priority> for u8 {
    fn from(priority: Priority) -> Self {
        priority.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_tiers() {
        assert_eq!(Priority::high().tier(), "high");
        assert_eq!(Priority::normal().tier(), "normal");
        assert_eq!(Priority::low().tier(), "low");

        assert!(Priority::high().is_high());
        assert!(Priority::normal().is_normal());
        assert!(Priority::low().is_low());
    }

    #[test]
    fn test_priority_ordering() {
        assert!(Priority::high() > Priority::normal());
        assert!(Priority::normal() > Priority::low());
        assert!(Priority::new(255) > Priority::new(0));
    }
}
