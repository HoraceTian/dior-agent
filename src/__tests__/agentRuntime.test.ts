import { describe, expect, test } from 'bun:test'
import type { AgentMessage } from 'src/domain/agent/agentMessages.js'
import {
    type AgentRuntimeEvent,
    type AgentTurnResult,
    type AgentTurnStream,
    createAgentRuntime,
} from 'src/domain/agent/agentRuntime.js'
import type { ModelClient, ModelStreamRequest } from 'src/domain/agent/modelClient.js'
import { createDefaultModelConfigSnapshot } from 'src/domain/models/modelConfig.js'

describe('AgentRuntime', () => {
    test('streams model deltas and returns the completed assistant output', async () => {
        const capturedRequests: CapturedModelRequest[] = []
        const runtime = createAgentRuntime({
            modelClient: createFakeModelClient(capturedRequests, [['hello', ' world']]),
            systemPrompt: 'system prompt',
        })

        const { events, result } = await collectTurn(
            runtime.runTurn({
                sessionId: 'session-1',
                turnId: 'turn-1',
                connectionId: 'connection-1',
                input: 'say hello',
                model: createDefaultModelConfigSnapshot('.config/models.toml'),
                signal: new AbortController().signal,
            }),
        )

        expect(events).toEqual([
            {
                type: 'assistant.delta',
                text: 'hello',
            },
            {
                type: 'assistant.delta',
                text: ' world',
            },
        ])
        expect(result.output).toBe('hello world')
        expect(result.metadata).toMatchObject({
            runtime: 'llm',
            sessionId: 'session-1',
            turnId: 'turn-1',
            connectionId: 'connection-1',
            modelProvider: 'ollama',
            modelName: 'deepseek-r1:70b',
        })
        expect(capturedRequests[0]?.messages).toEqual([
            {
                role: 'system',
                content: 'system prompt',
            },
            {
                role: 'user',
                content: 'say hello',
            },
        ])
    })

    test('keeps per-session conversation history across turns', async () => {
        const capturedRequests: CapturedModelRequest[] = []
        const runtime = createAgentRuntime({
            modelClient: createFakeModelClient(capturedRequests, [
                ['first response'],
                ['second response'],
            ]),
            systemPrompt: 'system prompt',
        })

        await collectTurn(
            runtime.runTurn({
                sessionId: 'session-1',
                turnId: 'turn-1',
                connectionId: 'connection-1',
                input: 'first question',
                model: createDefaultModelConfigSnapshot('.config/models.toml'),
                signal: new AbortController().signal,
            }),
        )
        await collectTurn(
            runtime.runTurn({
                sessionId: 'session-1',
                turnId: 'turn-2',
                connectionId: 'connection-1',
                input: 'second question',
                model: createDefaultModelConfigSnapshot('.config/models.toml'),
                signal: new AbortController().signal,
            }),
        )

        expect(capturedRequests[1]?.messages).toEqual([
            {
                role: 'system',
                content: 'system prompt',
            },
            {
                role: 'user',
                content: 'first question',
            },
            {
                role: 'assistant',
                content: 'first response',
            },
            {
                role: 'user',
                content: 'second question',
            },
        ])
    })

    test('uses supplied session history before falling back to in-memory history', async () => {
        const capturedRequests: CapturedModelRequest[] = []
        const runtime = createAgentRuntime({
            modelClient: createFakeModelClient(capturedRequests, [['new response']]),
            systemPrompt: 'system prompt',
        })

        await collectTurn(
            runtime.runTurn({
                sessionId: 'session-1',
                turnId: 'turn-2',
                connectionId: 'connection-1',
                input: 'new question',
                history: [
                    {
                        role: 'user',
                        content: 'old question',
                    },
                    {
                        role: 'assistant',
                        content: 'old response',
                    },
                ],
                model: createDefaultModelConfigSnapshot('.config/models.toml'),
                signal: new AbortController().signal,
            }),
        )

        expect(capturedRequests[0]?.messages).toEqual([
            {
                role: 'system',
                content: 'system prompt',
            },
            {
                role: 'user',
                content: 'old question',
            },
            {
                role: 'assistant',
                content: 'old response',
            },
            {
                role: 'user',
                content: 'new question',
            },
        ])
    })
})

type CapturedModelRequest = {
    messages: AgentMessage[]
}

function createFakeModelClient(
    capturedRequests: CapturedModelRequest[],
    outputs: string[][],
): ModelClient {
    let callIndex = 0

    return {
        async *stream(request: ModelStreamRequest) {
            capturedRequests.push({
                messages: request.messages.map(message => ({ ...message })),
            })

            const output = outputs[callIndex] ?? []
            callIndex += 1

            for (const text of output) {
                yield {
                    type: 'content.delta',
                    text,
                }
            }
        },
    }
}

async function collectTurn(stream: AgentTurnStream): Promise<{
    events: AgentRuntimeEvent[]
    result: AgentTurnResult
}> {
    const events: AgentRuntimeEvent[] = []

    while (true) {
        const next = await stream.next()
        if (next.done) {
            return {
                events,
                result: next.value,
            }
        }
        events.push(next.value)
    }
}
