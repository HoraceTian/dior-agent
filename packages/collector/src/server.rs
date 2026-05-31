use crate::{
    auth::is_authorized,
    config::CollectorConfig,
    protocol::{CollectorManifest, ToolInvocationRequest, ToolInvocationResponse},
    registry::ToolRegistry,
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::json;
use std::{net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;

#[derive(Clone)]
struct AppState {
    config: Arc<CollectorConfig>,
    auth_token: Arc<String>,
    manifest: Arc<CollectorManifest>,
    registry: Arc<ToolRegistry>,
}

pub async fn serve(config: CollectorConfig) -> anyhow::Result<()> {
    let bind = config.collector.bind.clone();
    let auth_token = config.resolve_auth_token()?;
    let registry = ToolRegistry::new(&config);
    let collector_manifest = registry.manifest(&config);
    let state = AppState {
        config: Arc::new(config),
        auth_token: Arc::new(auth_token),
        manifest: Arc::new(collector_manifest),
        registry: Arc::new(registry),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/manifest", get(manifest))
        .route("/v1/tools/{tool_name}/invoke", post(invoke_tool))
        .with_state(state);

    let listener = TcpListener::bind(&bind).await?;
    let address = listener.local_addr()?;
    println!(
        "{}",
        json!({
            "level": "info",
            "message": "Dior collector started",
            "bind": address.to_string()
        })
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "status": "ok",
        "collectorId": state.config.collector.id,
        "protocolVersion": crate::protocol::PROTOCOL_VERSION
    }))
}

async fn manifest(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<CollectorManifest>, AppError> {
    ensure_authorized(&state, &headers)?;
    Ok(Json((*state.manifest).clone()))
}

async fn invoke_tool(
    State(state): State<AppState>,
    Path(tool_name): Path<String>,
    headers: HeaderMap,
    Json(request): Json<ToolInvocationRequest>,
) -> Result<Json<ToolInvocationResponse>, AppError> {
    ensure_authorized(&state, &headers)?;
    let response = state
        .registry
        .invoke(&tool_name, request, &state.config)
        .await
        .ok_or_else(|| AppError::not_found(format!("tool not found: {tool_name}")))?;
    Ok(Json(response))
}

fn ensure_authorized(state: &AppState, headers: &HeaderMap) -> Result<(), AppError> {
    if is_authorized(headers, &state.auth_token) {
        return Ok(());
    }

    Err(AppError::unauthorized(
        "collector token is missing or invalid",
    ))
}

#[derive(Debug)]
struct AppError {
    status: StatusCode,
    message: String,
}

impl AppError {
    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            message: message.into(),
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.into(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let body = Json(json!({
            "error": self.status.as_u16(),
            "message": self.message
        }));
        (self.status, body).into_response()
    }
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        eprintln!("failed to listen for shutdown signal: {error}");
    }
}

#[allow(dead_code)]
fn _assert_socket_addr(address: SocketAddr) -> SocketAddr {
    address
}
