use task_queue_web_ui::WebUiServer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let server = WebUiServer::new("0.0.0.0:3000".parse()?);
    server.run().await
}
