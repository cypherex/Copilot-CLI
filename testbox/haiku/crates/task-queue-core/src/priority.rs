//! Priority system for tasks.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

/// Priority value for a task (0-255).
pub type Priority = u8;

/// Priority tier classifications.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PriorityTier {
    /// Low priority (0-99)
    Low,
    /// Normal priority (100-199)
    Normal,
    /// High priority (200-255)
    High,
}

impl PriorityTier {
    /// Get priority tier from numeric value.
    pub fn from_value(priority: Priority) -> Self {
        match priority {
            0..=99 => PriorityTier::Low,
            100..=199 => PriorityTier::Normal,
            200..=255 => PriorityTier::High,
        }
    }

    /// Get the numeric range for this priority tier.
    pub fn range(&self) -> (Priority, Priority) {
        match self {
            PriorityTier::Low => (0, 99),
            PriorityTier::Normal => (100, 199),
            PriorityTier::High => (200, 255),
        }
    }

    /// Compare priority tiers (higher is more urgent).
    pub fn compare(&self, other: &PriorityTier) -> Ordering {
        match (self, other) {
            (PriorityTier::High, PriorityTier::High) => Ordering::Equal,
            (PriorityTier::High, _) => Ordering::Greater,
            (_, PriorityTier::High) => Ordering::Less,
            (PriorityTier::Normal, PriorityTier::Normal) => Ordering::Equal,
            (PriorityTier::Normal, PriorityTier::Low) => Ordering::Greater,
            (PriorityTier::Low, PriorityTier::Normal) => Ordering::Less,
            (PriorityTier::Low, PriorityTier::Low) => Ordering::Equal,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_tier_from_value() {
        assert_eq!(PriorityTier::from_value(50), PriorityTier::Low);
        assert_eq!(PriorityTier::from_value(99), PriorityTier::Low);
        assert_eq!(PriorityTier::from_value(100), PriorityTier::Normal);
        assert_eq!(PriorityTier::from_value(199), PriorityTier::Normal);
        assert_eq!(PriorityTier::from_value(200), PriorityTier::High);
        assert_eq!(PriorityTier::from_value(255), PriorityTier::High);
    }

    #[test]
    fn test_priority_tier_compare() {
        assert_eq!(
            PriorityTier::High.compare(&PriorityTier::Low),
            Ordering::Greater
        );
        assert_eq!(
            PriorityTier::Low.compare(&PriorityTier::High),
            Ordering::Less
        );
        assert_eq!(
            PriorityTier::High.compare(&PriorityTier::High),
            Ordering::Equal
        );
    }
}
