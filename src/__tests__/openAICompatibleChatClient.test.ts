import { describe, expect, test } from 'bun:test'
import type { AgentMessage } from 'src/domain/agent/agentMessages.js'
import type { ModelConfigSnapshot } from 'src/domain/models/modelConfig.js'
import type { ModelProviderStrategy } from 'src/infrastructure/llm/modelProviderStrategy.js'
import { OpenAICompatibleChatClient } from 'src/infrastructure/llm/openAICompatibleChatClient.js'

describe('OpenAICompatibleChatClient', () => {
    test('streams Ollama chat completions through the OpenAI-compatible endpoint', async () => {
        const fetchCalls: CapturedFetchCall[] = []
        const client = new OpenAICompatibleChatClient({
            fetch: createFakeFetch(fetchCalls, [
                createSseResponse([
                    'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
                    'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
                    'data: [DONE]\n\n',
                ]),
            ]),
        })

        const chunks = await collectModelChunks(
            client.stream({
                model: createOllamaSnapshot(),
                messages: [{ role: 'user', content: 'hello' }],
                signal: new AbortController().signal,
            }),
        )

        expect(chunks).toEqual(['hello', ' world'])
        expect(fetchCalls[0]?.url).toBe('http://localhost:11434/v1/chat/completions')
        expect(fetchCalls[0]?.headers.get('authorization')).toBeNull()
        expect(JSON.parse(fetchCalls[0]?.body ?? '{}')).toEqual({
            model: 'deepseek-r1:70b',
            messages: [{ role: 'user', content: 'hello' }],
            stream: true,
        })
    })

    test('adds OpenAI authorization from the configured env name', async () => {
        const fetchCalls: CapturedFetchCall[] = []
        const client = new OpenAICompatibleChatClient({
            env: {
                TEST_OPENAI_API_KEY: 'test-key',
            },
            fetch: createFakeFetch(fetchCalls, [
                createJsonResponse({
                    choices: [
                        {
                            message: {
                                content: 'non-streaming response',
                            },
                        },
                    ],
                }),
            ]),
        })

        const chunks = await collectModelChunks(
            client.stream({
                model: createOpenAISnapshot(),
                messages: [{ role: 'user', content: 'hello' }],
                signal: new AbortController().signal,
            }),
        )

        expect(chunks).toEqual(['non-streaming response'])
        expect(fetchCalls[0]?.url).toBe('https://api.openai.com/v1/chat/completions')
        expect(fetchCalls[0]?.headers.get('authorization')).toBe('Bearer test-key')
    })

    test('delegates provider-specific request construction to injected strategies', async () => {
        const fetchCalls: CapturedFetchCall[] = []
        const strategy: ModelProviderStrategy = {
            name: 'test-ollama-strategy',
            supports: provider => provider.provider === 'ollama',
            createRequest: input => ({
                url: 'http://strategy.test/chat',
                headers: new Headers({
                    'content-type': 'application/json',
                    'x-provider-strategy': input.provider.provider,
                }),
                body: {
                    model: input.provider.modelName,
                    messages: input.messages,
                    stream: true,
                    strategy: 'custom',
                },
            }),
        }
        const client = new OpenAICompatibleChatClient({
            strategies: [strategy],
            fetch: createFakeFetch(fetchCalls, [
                createJsonResponse({
                    choices: [
                        {
                            message: {
                                content: 'strategy response',
                            },
                        },
                    ],
                }),
            ]),
        })

        const chunks = await collectModelChunks(
            client.stream({
                model: createOllamaSnapshot(),
                messages: [{ role: 'user', content: 'hello' }],
                signal: new AbortController().signal,
            }),
        )

        expect(chunks).toEqual(['strategy response'])
        expect(fetchCalls[0]?.url).toBe('http://strategy.test/chat')
        expect(fetchCalls[0]?.headers.get('x-provider-strategy')).toBe('ollama')
        expect(JSON.parse(fetchCalls[0]?.body ?? '{}')).toMatchObject({
            model: 'deepseek-r1:70b',
            strategy: 'custom',
        })
    })

    test('throws when no strategy supports the configured provider', async () => {
        const client = new OpenAICompatibleChatClient({
            strategies: [],
            fetch: createFakeFetch([], []),
        })

        await expect(
            collectModelChunks(
                client.stream({
                    model: createOllamaSnapshot(),
                    messages: [{ role: 'user', content: 'hello' }],
                    signal: new AbortController().signal,
                }),
            ),
        ).rejects.toThrow('No model provider strategy registered for provider: ollama')
    })

    test('throws when the model endpoint returns an error', async () => {
        const client = new OpenAICompatibleChatClient({
            fetch: createFakeFetch(
                [],
                [
                    new Response('bad request', {
                        status: 400,
                        statusText: 'Bad Request',
                    }),
                ],
            ),
        })

        await expect(
            collectModelChunks(
                client.stream({
                    model: createOllamaSnapshot(),
                    messages: [{ role: 'user', content: 'hello' }],
                    signal: new AbortController().signal,
                }),
            ),
        ).rejects.toThrow('Model request failed with HTTP 400 Bad Request: bad request')
    })
})

type CapturedFetchCall = {
    url: string
    headers: Headers
    body?: string
}

function createFakeFetch(fetchCalls: CapturedFetchCall[], responses: Response[]): typeof fetch {
    let callIndex = 0

    return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        fetchCalls.push({
            url: String(input),
            headers: new Headers(init?.headers),
            body: typeof init?.body === 'string' ? init.body : undefined,
        })

        const response = responses[callIndex]
        callIndex += 1
        if (!response) throw new Error('Unexpected fetch call')

        return response
    }) as typeof fetch
}

function createSseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder()
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk))
                }
                controller.close()
            },
        }),
        {
            headers: {
                'content-type': 'text/event-stream',
            },
        },
    )
}

function createJsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        headers: {
            'content-type': 'application/json',
        },
    })
}

async function collectModelChunks(stream: AsyncGenerator<{ text: string }>): Promise<string[]> {
    const chunks: string[] = []
    for await (const event of stream) {
        chunks.push(event.text)
    }
    return chunks
}

function createOllamaSnapshot(): ModelConfigSnapshot {
    return {
        version: 1,
        loadedAt: new Date(0).toISOString(),
        sourcePath: '.config/models.toml',
        provider: 'ollama',
        resolved: {
            provider: 'ollama',
            baseUrl: 'http://localhost:11434',
            modelName: 'deepseek-r1:70b',
        },
    }
}

function createOpenAISnapshot(): ModelConfigSnapshot {
    return {
        version: 1,
        loadedAt: new Date(0).toISOString(),
        sourcePath: '.config/models.toml',
        provider: 'openai',
        resolved: {
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            modelName: 'gpt-4.1-mini',
            apiKeyEnv: 'TEST_OPENAI_API_KEY',
        },
    }
}
