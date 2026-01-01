//! Authentication and authorization

use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use task_queue_core::CoreError;
use tokio::sync::RwLock;
use tracing::{debug, warn};

/// API key configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub key_hash: String,
    pub permissions: Vec<String>,
}

/// JWT claims
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // Subject (API key identifier)
    pub permissions: Vec<String>,
    pub exp: usize, // Expiration time
}

/// Authentication manager
pub struct AuthManager {
    api_keys: Arc<RwLock<HashMap<String, ApiKey>>>,
    jwt_secret: String,
    jwt_enabled: bool,
}

impl AuthManager {
    /// Create a new authentication manager
    pub fn new(jwt_secret: String, jwt_enabled: bool) -> Self {
        Self {
            api_keys: Arc::new(RwLock::new(HashMap::new())),
            jwt_secret,
            jwt_enabled,
        }
    }

    /// Add an API key
    pub async fn add_api_key(&self, key_id: String, key: String, permissions: Vec<String>) -> Result<(), CoreError> {
        let key_hash = hash(&key, DEFAULT_COST)
            .map_err(|e| CoreError::Other(format!("Failed to hash API key: {}", e)))?;

        let mut api_keys = self.api_keys.write().await;
        api_keys.insert(key_id.clone(), ApiKey { key_hash, permissions });
        debug!("Added API key: {}", key_id);
        Ok(())
    }

    /// Remove an API key
    pub async fn remove_api_key(&self, key_id: &str) -> bool {
        let mut api_keys = self.api_keys.write().await;
        api_keys.remove(key_id).is_some()
    }

    /// Verify API key
    pub async fn verify_api_key(&self, key_id: &str, key: &str) -> Result<Vec<String>, CoreError> {
        let api_keys = self.api_keys.read().await;
        let api_key = api_keys.get(key_id)
            .ok_or_else(|| CoreError::Unauthorized)?;

        let is_valid = verify(key, &api_key.key_hash)
            .map_err(|e| CoreError::Other(format!("Failed to verify API key: {}", e)))?;

        if is_valid {
            Ok(api_key.permissions.clone())
        } else {
            Err(CoreError::Unauthorized)
        }
    }

    /// Generate JWT token
    pub fn generate_jwt_token(&self, key_id: &str, permissions: Vec<String>) -> Result<String, CoreError> {
        if !self.jwt_enabled {
            return Err(CoreError::Other("JWT not enabled".to_string()));
        }

        let expiration = chrono::Utc::now()
            .checked_add_signed(chrono::Duration::hours(24))
            .expect("Valid timestamp")
            .timestamp() as usize;

        let claims = Claims {
            sub: key_id.to_string(),
            permissions,
            exp: expiration,
        };

        encode(
            &Header::default(),
            &claims,
            &EncodingKey::from_secret(self.jwt_secret.as_bytes()),
        )
        .map_err(|e| CoreError::Other(format!("Failed to generate token: {}", e)))
    }

    /// Verify JWT token
    pub fn verify_jwt_token(&self, token: &str) -> Result<Claims, CoreError> {
        if !self.jwt_enabled {
            return Err(CoreError::Other("JWT not enabled".to_string()));
        }

        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(self.jwt_secret.as_bytes()),
            &Validation::new(Algorithm::HS256),
        )
        .map_err(|e| CoreError::Unauthorized)?;

        Ok(token_data.claims)
    }

    /// Check if user has permission
    pub fn check_permission(&self, user_permissions: &[String], required: &str) -> bool {
        user_permissions.iter().any(|p| p == "admin" || p == required)
    }
}

/// Extract bearer token from Authorization header
pub fn extract_bearer_token(auth_header: Option<&str>) -> Option<String> {
    auth_header.and_then(|header| {
        if header.starts_with("Bearer ") {
            Some(header["Bearer ".len()..].to_string())
        } else {
            None
        }
    })
}

/// Rate limiter using token bucket algorithm
#[derive(Clone)]
pub struct RateLimiter {
    buckets: Arc<RwLock<HashMap<String, TokenBucket>>>,
    max_requests_per_second: u64,
    bucket_capacity: u64,
}

#[derive(Debug, Clone)]
struct TokenBucket {
    tokens: f64,
    last_update: std::time::Instant,
}

impl RateLimiter {
    /// Create a new rate limiter
    pub fn new(max_requests_per_second: u64) -> Self {
        Self {
            buckets: Arc::new(RwLock::new(HashMap::new())),
            max_requests_per_second,
            bucket_capacity: max_requests_per_second * 2, // Allow some burst
        }
    }

    /// Check if request is allowed
    pub async fn check_rate_limit(&self, client_id: &str) -> Result<(), CoreError> {
        let now = std::time::Instant::now();
        let mut buckets = self.buckets.write().await;

        let bucket = buckets.entry(client_id.to_string()).or_insert(TokenBucket {
            tokens: self.bucket_capacity as f64,
            last_update: now,
        });

        // Refill tokens
        let elapsed = now.duration_since(bucket.last_update).as_secs_f64();
        bucket.tokens += elapsed * self.max_requests_per_second as f64;
        bucket.tokens = bucket.tokens.min(self.bucket_capacity as f64);
        bucket.last_update = now;

        // Check if we have enough tokens
        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            Ok(())
        } else {
            // Calculate retry-after
            let retry_after = ((1.0 - bucket.tokens) / self.max_requests_per_second as f64).ceil() as u64;
            Err(CoreError::RateLimited(retry_after))
        }
    }

    /// Remove a client's bucket
    pub async fn remove_client(&self, client_id: &str) {
        let mut buckets = self.buckets.write().await;
        buckets.remove(client_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_api_key_verification() {
        let auth = AuthManager::new("secret".to_string(), true);
        auth.add_api_key("test_key".to_string(), "password123".to_string(), vec!["submit_tasks".to_string()])
            .await
            .unwrap();

        let permissions = auth.verify_api_key("test_key", "password123").await.unwrap();
        assert!(permissions.contains(&"submit_tasks".to_string()));

        // Wrong password should fail
        assert!(auth.verify_api_key("test_key", "wrong").await.is_err());

        // Non-existent key should fail
        assert!(auth.verify_api_key("nonexistent", "password123").await.is_err());
    }

    #[tokio::test]
    async fn test_rate_limiting() {
        let limiter = RateLimiter::new(10); // 10 requests per second

        // First 10 requests should pass
        for _ in 0..10 {
            assert!(limiter.check_rate_limit("client1").await.is_ok());
        }

        // 11th request should be rate limited
        assert!(matches!(
            limiter.check_rate_limit("client1").await,
            Err(CoreError::RateLimited(_))
        ));

        // Different client should still pass
        assert!(limiter.check_rate_limit("client2").await.is_ok());
    }

    #[test]
    fn test_extract_bearer_token() {
        assert_eq!(
            extract_bearer_token(Some("Bearer mytoken")),
            Some("mytoken".to_string())
        );

        assert_eq!(
            extract_bearer_token(Some("Basic mytoken")),
            None
        );

        assert_eq!(
            extract_bearer_token(None),
            None
        );
    }
}
