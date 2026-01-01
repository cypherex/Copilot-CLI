//! Custom serialization utilities

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::time::Duration;

/// Serialize Duration as seconds (as u64)
pub fn serialize_duration<S>(duration: &Duration, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    duration.as_secs().serialize(serializer)
}

/// Deserialize Duration from seconds
pub fn deserialize_duration<'de, D>(deserializer: D) -> Result<Duration, D::Error>
where
    D: Deserializer<'de>,
{
    let secs = u64::deserialize(deserializer)?;
    Ok(Duration::from_secs(secs))
}

/// Serialize Option<Duration> as Option<u64> seconds
pub fn serialize_option_duration<S>(
    duration: &Option<Duration>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    duration.map(|d| d.as_secs()).serialize(serializer)
}

/// Deserialize Option<Duration> from Option<u64> seconds
pub fn deserialize_option_duration<'de, D>(
    deserializer: D,
) -> Result<Option<Duration>, D::Error>
where
    D: Deserializer<'de>,
{
    let secs_opt = Option::<u64>::deserialize(deserializer)?;
    Ok(secs_opt.map(Duration::from_secs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_duration_serde() {
        let duration = Duration::from_secs(3600);
        let serialized = bincode::serialize(&duration).unwrap();
        let deserialized: Duration = bincode::deserialize(&serialized).unwrap();
        assert_eq!(duration, deserialized);
    }

    #[test]
    fn test_option_duration_serde() {
        let duration = Some(Duration::from_secs(3600));
        let serialized = bincode::serialize(&duration).unwrap();
        let deserialized: Option<Duration> = bincode::deserialize(&serialized).unwrap();
        assert_eq!(duration, deserialized);

        let none: Option<Duration> = None;
        let serialized = bincode::serialize(&none).unwrap();
        let deserialized: Option<Duration> = bincode::deserialize(&serialized).unwrap();
        assert_eq!(none, deserialized);
    }
}
