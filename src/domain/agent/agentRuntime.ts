import type { ModelConfigSnapshot } from 'src/domain/models/modelConfig.js'
import type { JsonObject } from 'src/domain/sessions/sessionEvents.js'
import { type AgentMessage, createDefaultSystemPrompt } from './agentMessages.js'
import type { ModelClient } from './modelClient.js'

export type AgentTurnRequest = {
    sessionId: string
    turnId: string
    connectionId: string
    input: string
    history?: AgentMessage[]
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

export type AgentRuntimeOptions = {
    modelClient: ModelClient
    systemPrompt?: string
    maxHistoryMessages?: number
}

const DEFAULT_MAX_HISTORY_MESSAGES = 40

export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntime {
    const conversations = new Map<string, AgentMessage[]>()
    const systemPrompt = options.systemPrompt ?? createDefaultSystemPrompt()
    const maxHistoryMessages = Math.max(
        3,
        options.maxHistoryMessages ?? DEFAULT_MAX_HISTORY_MESSAGES,
    )

    return {
        async *runTurn(request) {
            const conversation = prepareConversationMessages(
                request.history ?? getConversationMessages(conversations, request.sessionId),
                systemPrompt,
            )
            const messages = trimConversationMessages(
                [
                    ...trimConversationMessages(conversation, maxHistoryMessages - 1),
                    {
                        role: 'user',
                        content: request.input,
                    } satisfies AgentMessage,
                ],
                maxHistoryMessages,
            )
            conversations.set(request.sessionId, messages)

            let output = ''
            for await (const event of options.modelClient.stream({
                model: request.model,
                messages,
                signal: request.signal,
            })) {
                if (event.type !== 'content.delta') continue
                output += event.text
                yield {
                    type: 'assistant.delta',
                    text: event.text,
                }
            }

            const completedMessages = trimConversationMessages(
                [
                    ...messages,
                    {
                        role: 'assistant',
                        content: output,
                    },
                ],
                maxHistoryMessages,
            )
            conversations.set(request.sessionId, completedMessages)

            return {
                output,
                metadata: {
                    runtime: 'llm',
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

function getConversationMessages(
    conversations: Map<string, AgentMessage[]>,
    sessionId: string,
): AgentMessage[] {
    const existing = conversations.get(sessionId)
    return existing ?? []
}

function prepareConversationMessages(
    messages: AgentMessage[],
    systemPrompt: string,
): AgentMessage[] {
    if (messages[0]?.role === 'system') return messages

    return [
        {
            role: 'system',
            content: systemPrompt,
        },
        ...messages,
    ]
}

function trimConversationMessages(
    messages: AgentMessage[],
    maxHistoryMessages: number,
): AgentMessage[] {
    if (messages.length <= maxHistoryMessages) return messages

    const systemMessage = messages[0]?.role === 'system' ? messages[0] : undefined
    const historyLimit = systemMessage ? maxHistoryMessages - 1 : maxHistoryMessages
    const tail = messages.slice(systemMessage ? 1 : 0).slice(-historyLimit)

    return systemMessage ? [systemMessage, ...tail] : tail
}
