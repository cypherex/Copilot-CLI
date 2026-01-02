//! Priority system for tasks

use serde::{Deserialize, Serialize};

/// Task priority level (0-255)
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct Priority(pub u8);

impl Priority {
    /// High priority (200-255)
    pub const HIGH_MIN: u8 = 200;
    /// Normal priority (100-199)
    pub const NORMAL_MIN: u8 = 100;
    /// Normal priority maximum (199)
    pub const NORMAL_MAX: u8 = 199;
    /// Low priority (0-99)
    pub const LOW_MAX: u8 = 99;

    /// Create a new high priority (default: 255)
    pub fn high() -> Self {
        Priority(255)
    }

    /// Create a new high priority with custom value (200-255)
    pub fn high_custom(value: u8) -> Self {
        assert!(value >= Self::HIGH_MIN);
        Priority(value)
    }

    /// Create a new normal priority (default: 150)
    pub fn normal() -> Self {
        Priority(150)
    }

    /// Create a new normal priority with custom value (100-199)
    pub fn normal_custom(value: u8) -> Self {
        assert!(value >= Self::NORMAL_MIN && value <= Self::NORMAL_MAX);
        Priority(value)
    }

    /// Create a new low priority (default: 50)
    pub fn low() -> Self {
        Priority(50)
    }

    /// Create a new low priority with custom value (0-99)
    pub fn low_custom(value: u8) -> Self {
        assert!(value <= Self::LOW_MAX);
        Priority(value)
    }

    /// Get the priority tier
    pub fn tier(&self) -> PriorityTier {
        if self.0 >= Self::HIGH_MIN {
            PriorityTier::High
        } else if self.0 >= Self::NORMAL_MIN {
            PriorityTier::Normal
        } else {
            PriorityTier::Low
        }
    }

    /// Check if this is high priority
    pub fn is_high(&self) -> bool {
        self.0 >= Self::HIGH_MIN
    }

    /// Check if this is normal priority
    pub fn is_normal(&self) -> bool {
        self.0 >= Self::NORMAL_MIN && self.0 <= Self::NORMAL_MAX
    }

    /// Check if this is low priority
    pub fn is_low(&self) -> bool {
        self.0 <= Self::LOW_MAX
    }
}

impl Default for Priority {
    fn default() -> Self {
        Priority::normal()
    }
}

/// Priority tier (High, Normal, Low)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PriorityTier {
    High,
    Normal,
    Low,
}

impl PriorityTier {
    /// Get all tiers in descending order of importance
    pub fn all() -> &'static [PriorityTier] {
        &[PriorityTier::High, PriorityTier::Normal, PriorityTier::Low]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_creation() {
        assert!(Priority::high().is_high());
        assert!(Priority::normal().is_normal());
        assert!(Priority::low().is_low());
    }

    #[test]
    fn test_priority_ordering() {
        assert!(Priority::high() > Priority::normal());
        assert!(Priority::normal() > Priority::low());
    }

    #[test]
    fn test_priority_tiers() {
        assert_eq!(Priority::high().tier(), PriorityTier::High);
        assert_eq!(Priority::normal().tier(), PriorityTier::Normal);
        assert_eq!(Priority::low().tier(), PriorityTier::Low);
    }
}
