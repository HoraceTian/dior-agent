import type { ModelConfigSnapshot } from 'src/domain/models/modelConfig.js'
import type { JsonObject } from 'src/domain/sessions/sessionEvents.js'

export type AgentTurnRequest = {
    sessionId: string
    turnId: string
    connectionId: string
    input: string
    metadata?: JsonObject
    model: ModelConfigSnapshot
    signal: AbortSignal
}

export type AgentRuntimeEvent =
    | {
          type: 'assistant.delta'
          text: string
      }
    | {
          type: 'tool.use'
          toolUseId: string
          name: string
          input?: JsonObject
      }
    | {
          type: 'tool.result'
          toolUseId: string
          content?: string
          resultRef?: string
          isError?: boolean
      }

export type AgentTurnStream = AsyncGenerator<AgentRuntimeEvent, AgentTurnResult>

export type AgentRuntime = {
    runTurn: (request: AgentTurnRequest) => AgentTurnStream
}

export type AgentTurnResult = {
    output: string
    metadata?: JsonObject
}

export function createAgentRuntime(): AgentRuntime {
    return {
        async *runTurn(request) {
            const output = `Agent received: ${request.input}`
            yield {
                type: 'assistant.delta',
                text: output,
            }

            return {
                output,
                metadata: {
                    runtime: 'stub',
                    connectionId: request.connectionId,
                    sessionId: request.sessionId,
                    turnId: request.turnId,
                    modelProvider: request.model.provider,
                    modelName: request.model.resolved.modelName,
                    modelConfigVersion: request.model.version,
                },
            }
        },
    }
}
