import type { AgentRuntime, AgentTurnRequest, AgentTurnResult } from './agentRuntime.js'

export class AgentService {
    constructor(private readonly runtime: AgentRuntime) {}

    async handleTurn(request: AgentTurnRequest): Promise<AgentTurnResult> {
        return this.runtime.handleTurn(request)
    }
}
