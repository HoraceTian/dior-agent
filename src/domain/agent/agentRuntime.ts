import type { JsonObject } from 'src/contracts/websocket/index.js'

export type AgentTurnRequest = {
    id: string
    connectionId: string
    input: string
    metadata?: JsonObject
}

export type AgentTurnResult = {
    output: string
    metadata?: JsonObject
}

export type AgentRuntime = {
    handleTurn: (request: AgentTurnRequest) => Promise<AgentTurnResult>
}

export function createAgentRuntime(): AgentRuntime {
    return {
        async handleTurn(request) {
            return {
                output: `Agent received: ${request.input}`,
                metadata: {
                    runtime: 'stub',
                    connectionId: request.connectionId,
                },
            }
        },
    }
}
