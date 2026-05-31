import type { ModelConfigSnapshot } from 'src/domain/models/modelConfig.js'
import type { AgentMessage } from './agentMessages.js'

export type ModelStreamRequest = {
    model: ModelConfigSnapshot
    messages: AgentMessage[]
    signal: AbortSignal
}

export type ModelStreamEvent = {
    type: 'content.delta'
    text: string
}

export type ModelClient = {
    stream: (request: ModelStreamRequest) => AsyncGenerator<ModelStreamEvent, void>
}
