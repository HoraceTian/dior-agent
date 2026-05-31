use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: &str = "2026-05-collector-v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectorManifest {
    pub collector_id: String,
    pub display_name: String,
    pub description: String,
    pub protocol_version: String,
    pub version: String,
    pub public_url: String,
    pub tools: Vec<ToolDescriptor>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDescriptor {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub output_schema: Value,
    pub scopes: Vec<String>,
    pub side_effects: String,
    pub timeout_ms: u64,
    pub max_result_bytes: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvocationRequest {
    pub invocation_id: String,
    pub session_id: String,
    pub turn_id: String,
    #[serde(default)]
    pub input: Value,
    pub deadline_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInvocationResponse {
    pub invocation_id: String,
    pub status: ToolInvocationStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_ref: Option<String>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolInvocationStatus {
    Ok,
    Error,
}

impl ToolInvocationResponse {
    pub fn ok(invocation_id: String, content: String, structured: Value) -> Self {
        Self {
            invocation_id,
            status: ToolInvocationStatus::Ok,
            content: Some(content),
            structured: Some(structured),
            result_ref: None,
            is_error: false,
        }
    }

    pub fn error(invocation_id: String, message: String) -> Self {
        Self {
            invocation_id,
            status: ToolInvocationStatus::Error,
            content: Some(message),
            structured: None,
            result_ref: None,
            is_error: true,
        }
    }
}
