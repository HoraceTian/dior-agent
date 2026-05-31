use crate::{
    config::CollectorConfig,
    protocol::{ToolDescriptor, ToolInvocationRequest, ToolInvocationResponse},
};
use serde_json::{json, Value};

pub fn descriptor(config: &CollectorConfig) -> ToolDescriptor {
    ToolDescriptor {
        name: "system.info".to_string(),
        description: "Return read-only runtime and host context for this collector.".to_string(),
        input_schema: json!({
            "type": "object",
            "additionalProperties": false
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "collectorId": { "type": "string" },
                "os": { "type": "string" },
                "arch": { "type": "string" },
                "pid": { "type": "number" }
            },
            "required": ["collectorId", "os", "arch", "pid"]
        }),
        scopes: vec!["system:read".to_string()],
        side_effects: "read-only".to_string(),
        timeout_ms: config.collector.default_timeout_ms.unwrap_or(10_000),
        max_result_bytes: config.collector.max_result_bytes.unwrap_or(65_536),
    }
}

pub async fn invoke(
    request: ToolInvocationRequest,
    config: &CollectorConfig,
) -> ToolInvocationResponse {
    let current_dir = std::env::current_dir()
        .ok()
        .map(|path| path.display().to_string());
    let executable = std::env::current_exe()
        .ok()
        .map(|path| path.display().to_string());
    let hostname = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .ok();

    let structured = json!({
        "collectorId": config.collector.id,
        "collectorName": config.collector.name,
        "collectorDescription": config.collector.description.as_deref().unwrap_or(""),
        "sessionId": request.session_id,
        "turnId": request.turn_id,
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
        "pid": std::process::id(),
        "hostname": hostname,
        "currentDir": current_dir,
        "executable": executable,
        "deadlineMs": request.deadline_ms,
        "input": sanitize_input(request.input),
    });

    let content = format!(
        "collector={} name={} os={} arch={} pid={}",
        config.collector.id,
        config.collector.name,
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::process::id()
    );

    ToolInvocationResponse::ok(request.invocation_id, content, structured)
}

fn sanitize_input(value: Value) -> Value {
    if value.is_object() {
        return value;
    }

    json!({})
}
