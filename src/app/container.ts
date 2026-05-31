import type { AppConfig } from 'src/config/env.js'
import { type AgentRuntime, createAgentRuntime } from 'src/domain/agent/agentRuntime.js'
import { AgentService } from 'src/domain/agent/agentService.js'
import type { ModelConfigManager } from 'src/domain/models/modelConfig.js'
import type { SessionStore } from 'src/domain/sessions/sessionStore.js'
import { SessionSupervisor } from 'src/domain/sessions/sessionSupervisor.js'
import { FileModelConfigManager } from 'src/infrastructure/models/fileModelConfigManager.js'
import { FileSessionStore } from 'src/infrastructure/sessions/fileSessionStore.js'
import { type Logger, createLogger } from 'src/observability/logger.js'

export type AppContext = {
    config: AppConfig
    logger: Logger
    agent: AgentService
    modelConfigs: ModelConfigManager
    sessions: SessionSupervisor
}

export type AppContextOptions = {
    config: AppConfig
    logger?: Logger
    runtime?: AgentRuntime
    sessionStore?: SessionStore
    modelConfigs?: ModelConfigManager
}

export function createAppContext(options: AppContextOptions): AppContext {
    const logger = options.logger ?? createLogger({ level: options.config.logLevel })
    const runtime = options.runtime ?? createAgentRuntime()
    const agent = new AgentService(runtime)
    const sessionStore =
        options.sessionStore ??
        new FileSessionStore({
            dataDir: options.config.dataDir,
            workspaceRoot: options.config.workspaceRoot,
        })
    const modelConfigs =
        options.modelConfigs ??
        new FileModelConfigManager({
            path: options.config.modelConfigPath,
            logger,
            watch: options.config.modelConfigWatch,
        })
    const sessions = new SessionSupervisor({
        holderId: createHolderId(options.config.serviceName),
        store: sessionStore,
        agent,
        modelConfigs,
        logger,
    })

    return {
        config: options.config,
        logger,
        agent,
        modelConfigs,
        sessions,
    }
}

function createHolderId(serviceName: string): string {
    return `${serviceName}:${process.pid}:${crypto.randomUUID()}`
}
