mod system;

use crate::{
    config::CollectorConfig,
    protocol::{ToolDescriptor, ToolInvocationRequest, ToolInvocationResponse},
};

pub fn all_descriptors(config: &CollectorConfig) -> Vec<ToolDescriptor> {
    vec![system::descriptor(config)]
}

pub async fn invoke(
    tool_name: &str,
    request: ToolInvocationRequest,
    config: &CollectorConfig,
) -> ToolInvocationResponse {
    match tool_name {
        "system.info" => system::invoke(request, config).await,
        _ => ToolInvocationResponse::error(
            request.invocation_id,
            format!("unknown tool: {tool_name}"),
        ),
    }
}
