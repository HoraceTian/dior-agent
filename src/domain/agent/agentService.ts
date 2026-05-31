import type { AgentRuntime, AgentTurnRequest, AgentTurnStream } from './agentRuntime.js'

export class AgentService {
    constructor(private readonly runtime: AgentRuntime) {}

    runTurn(request: AgentTurnRequest): AgentTurnStream {
        return this.runtime.runTurn(request)
    }
}
