//! Web UI server implementation.

use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tracing::info;

pub struct WebUiServer {
    addr: SocketAddr,
}

impl WebUiServer {
    pub fn new(addr: SocketAddr) -> Self {
        Self { addr }
    }

    pub async fn run(self) -> anyhow::Result<()> {
        let app = Router::new()
            .route("/", get(crate::handlers::index))
            .route("/api/tasks", get(crate::handlers::list_tasks))
            .route("/api/tasks/submit", post(crate::handlers::submit_task))
            .route("/api/tasks/:id", get(crate::handlers::get_task))
            .route("/api/stats", get(crate::handlers::get_stats))
            .layer(CorsLayer::permissive());

        info!("Web UI listening on {}", self.addr);

        let listener = tokio::net::TcpListener::bind(self.addr).await?;
        axum::serve(listener, app).await?;

        Ok(())
    }
}
