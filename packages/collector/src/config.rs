use anyhow::{bail, Context};
use serde::Deserialize;
use std::{fs, path::Path};

#[derive(Debug, Clone, Deserialize)]
pub struct CollectorConfig {
    pub collector: CollectorSection,
    pub auth: AuthSection,
    #[serde(default)]
    pub tools: ToolsSection,
    #[serde(default)]
    pub log_roots: Vec<NamedRoot>,
    #[serde(default)]
    pub file_roots: Vec<FileRoot>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CollectorSection {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub bind: String,
    pub public_url: String,
    #[allow(dead_code)]
    pub data_dir: Option<String>,
    pub default_timeout_ms: Option<u64>,
    pub max_result_bytes: Option<u64>,
    #[allow(dead_code)]
    pub max_concurrent_invocations: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthSection {
    #[serde(default = "default_auth_mode")]
    pub mode: String,
    pub token_env: Option<String>,
    pub token: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ToolsSection {
    #[serde(default)]
    pub enabled: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NamedRoot {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileRoot {
    pub name: String,
    pub path: String,
    #[serde(default = "default_true")]
    #[allow(dead_code)]
    pub read_only: bool,
}

pub fn load_config(path: impl AsRef<Path>) -> anyhow::Result<CollectorConfig> {
    let text = fs::read_to_string(path.as_ref())
        .with_context(|| format!("unable to read {}", path.as_ref().display()))?;
    let config: CollectorConfig = toml::from_str(&text)
        .with_context(|| format!("invalid TOML in {}", path.as_ref().display()))?;
    validate_config(&config)?;
    Ok(config)
}

impl CollectorConfig {
    pub fn resolve_auth_token(&self) -> anyhow::Result<String> {
        if self.auth.mode != "static-token" {
            bail!("unsupported auth mode: {}", self.auth.mode);
        }

        if let Some(token) = self
            .auth
            .token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return Ok(token.to_string());
        }

        let token_env = self
            .auth
            .token_env
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("DIOR_COLLECTOR_TOKEN");

        let token = std::env::var(token_env)
            .with_context(|| format!("missing collector token env: {token_env}"))?;
        let trimmed = token.trim();
        if trimmed.is_empty() {
            bail!("collector token env is empty: {token_env}");
        }
        Ok(trimmed.to_string())
    }
}

fn validate_config(config: &CollectorConfig) -> anyhow::Result<()> {
    validate_non_empty("collector.id", &config.collector.id)?;
    validate_non_empty("collector.name", &config.collector.name)?;
    validate_non_empty("collector.bind", &config.collector.bind)?;
    validate_non_empty("collector.public_url", &config.collector.public_url)?;

    for root in &config.log_roots {
        validate_non_empty("log_roots.name", &root.name)?;
        validate_non_empty("log_roots.path", &root.path)?;
    }

    for root in &config.file_roots {
        validate_non_empty("file_roots.name", &root.name)?;
        validate_non_empty("file_roots.path", &root.path)?;
    }

    Ok(())
}

fn validate_non_empty(name: &str, value: &str) -> anyhow::Result<()> {
    if value.trim().is_empty() {
        bail!("{name} must not be empty");
    }
    Ok(())
}

fn default_auth_mode() -> String {
    "static-token".to_string()
}

fn default_true() -> bool {
    true
}
