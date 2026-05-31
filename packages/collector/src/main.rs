mod auth;
mod config;
mod protocol;
mod registry;
mod server;
mod tools;

use anyhow::Context;
use config::load_config;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config_path =
        std::env::var("COLLECTOR_CONFIG").unwrap_or_else(|_| "collector.toml".to_string());
    let config = load_config(&config_path)
        .with_context(|| format!("failed to load collector config at {config_path}"))?;

    server::serve(config).await
}
