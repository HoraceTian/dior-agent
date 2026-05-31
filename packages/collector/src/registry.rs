use crate::{
    config::CollectorConfig,
    protocol::{
        CollectorManifest, ToolDescriptor, ToolInvocationRequest, ToolInvocationResponse,
        PROTOCOL_VERSION,
    },
    tools,
};

#[derive(Debug, Clone)]
pub struct ToolRegistry {
    descriptors: Vec<ToolDescriptor>,
}

impl ToolRegistry {
    pub fn new(config: &CollectorConfig) -> Self {
        let enabled = &config.tools.enabled;
        let descriptors = tools::all_descriptors(config)
            .into_iter()
            .filter(|descriptor| enabled.is_empty() || enabled.contains(&descriptor.name))
            .collect();

        Self { descriptors }
    }

    pub fn manifest(&self, config: &CollectorConfig) -> CollectorManifest {
        CollectorManifest {
            collector_id: config.collector.id.clone(),
            display_name: config.collector.name.clone(),
            description: collector_description(config),
            protocol_version: PROTOCOL_VERSION.to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            public_url: config.collector.public_url.clone(),
            tools: self.descriptors.clone(),
        }
    }

    pub async fn invoke(
        &self,
        tool_name: &str,
        request: ToolInvocationRequest,
        config: &CollectorConfig,
    ) -> Option<ToolInvocationResponse> {
        if !self.descriptors.iter().any(|tool| tool.name == tool_name) {
            return None;
        }

        Some(tools::invoke(tool_name, request, config).await)
    }
}

fn collector_description(config: &CollectorConfig) -> String {
    config
        .collector
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("No collector description configured.")
        .to_string()
}
