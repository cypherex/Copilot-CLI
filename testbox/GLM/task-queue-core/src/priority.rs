//! Priority definitions and queue ordering

use std::cmp::Ordering;

/// Task priority levels
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Priority {
    High = 200,
    Normal = 150,
    Low = 50,
}

impl Priority {
    /// Get the numeric priority value
    pub fn value(&self) -> u8 {
        match self {
            Priority::High => 200,
            Priority::Normal => 150,
            Priority::Low => 50,
        }
    }

    /// Parse from integer value
    pub fn from_value(value: u8) -> Option<Self> {
        if value >= 200 {
            Some(Priority::High)
        } else if value >= 100 {
            Some(Priority::Normal)
        } else {
            Some(Priority::Low)
        }
    }

    /// Parse from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "high" => Some(Priority::High),
            "normal" => Some(Priority::Normal),
            "low" => Some(Priority::Low),
            _ => None,
        }
    }
}

impl PartialOrd for Priority {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Priority {
    fn cmp(&self, other: &Self) -> Ordering {
        // Higher priority = higher value
        self.value().cmp(&other.value())
    }
}

impl std::fmt::Display for Priority {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Priority::High => write!(f, "high"),
            Priority::Normal => write!(f, "normal"),
            Priority::Low => write!(f, "low"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_priority_ordering() {
        assert!(Priority::High > Priority::Normal);
        assert!(Priority::Normal > Priority::Low);
        assert!(Priority::High > Priority::Low);
    }

    #[test]
    fn test_priority_from_str() {
        assert_eq!(Priority::from_str("high"), Some(Priority::High));
        assert_eq!(Priority::from_str("HIGH"), Some(Priority::High));
        assert_eq!(Priority::from_str("normal"), Some(Priority::Normal));
        assert_eq!(Priority::from_str("low"), Some(Priority::Low));
        assert_eq!(Priority::from_str("invalid"), None);
    }

    #[test]
    fn test_priority_from_value() {
        assert_eq!(Priority::from_value(255), Some(Priority::High));
        assert_eq!(Priority::from_value(200), Some(Priority::High));
        assert_eq!(Priority::from_value(150), Some(Priority::Normal));
        assert_eq!(Priority::from_value(100), Some(Priority::Normal));
        assert_eq!(Priority::from_value(50), Some(Priority::Low));
        assert_eq!(Priority::from_value(0), Some(Priority::Low));
    }
}
