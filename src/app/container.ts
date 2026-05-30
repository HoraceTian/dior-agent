import type { AppConfig } from 'src/config/env.js'
import { type AgentRuntime, createAgentRuntime } from 'src/domain/agent/agentRuntime.js'
import { AgentService } from 'src/domain/agent/agentService.js'
import { type Logger, createLogger } from 'src/observability/logger.js'

export type AppContext = {
    config: AppConfig
    logger: Logger
    agent: AgentService
}

export type AppContextOptions = {
    config: AppConfig
    logger?: Logger
    runtime?: AgentRuntime
}

export function createAppContext(options: AppContextOptions): AppContext {
    const logger = options.logger ?? createLogger({ level: options.config.logLevel })
    const runtime = options.runtime ?? createAgentRuntime()

    return {
        config: options.config,
        logger,
        agent: new AgentService(runtime),
    }
}
