import type {
    ModelClient,
    ModelStreamEvent,
    ModelStreamRequest,
} from 'src/domain/agent/modelClient.js'
import type { ResolvedModelProviderConfig } from 'src/domain/models/modelConfig.js'
import {
    type ModelProviderEnv,
    type ModelProviderStrategy,
    createDefaultModelProviderStrategies,
} from './modelProviderStrategy.js'

type FetchLike = typeof fetch

export type OpenAICompatibleChatClientOptions = {
    fetch?: FetchLike
    env?: ModelProviderEnv
    strategies?: ModelProviderStrategy[]
}

export class OpenAICompatibleChatClient implements ModelClient {
    private readonly fetchImpl: FetchLike
    private readonly env: ModelProviderEnv
    private readonly strategies: ModelProviderStrategy[]

    constructor(options: OpenAICompatibleChatClientOptions = {}) {
        this.fetchImpl = options.fetch ?? fetch
        this.env = options.env ?? process.env
        this.strategies = options.strategies ?? createDefaultModelProviderStrategies()
    }

    async *stream(request: ModelStreamRequest): AsyncGenerator<ModelStreamEvent, void> {
        const provider = request.model.resolved
        const providerRequest = this.createProviderRequest(request)
        const response = await this.fetchImpl(providerRequest.url, {
            method: 'POST',
            headers: providerRequest.headers,
            body: JSON.stringify(providerRequest.body),
            signal: request.signal,
        })

        if (!response.ok) {
            throw new Error(await createRequestErrorMessage(response))
        }

        if (!response.body) {
            throw new Error('Model response did not include a readable body')
        }

        if (!isEventStream(response)) {
            const body = (await response.json()) as unknown
            const text = extractNonStreamingContent(body)
            if (text) {
                yield {
                    type: 'content.delta',
                    text,
                }
            }
            return
        }

        for await (const text of readServerSentEventData(response.body)) {
            if (text === '[DONE]') return

            const delta = extractStreamingDelta(text)
            if (!delta) continue
            yield {
                type: 'content.delta',
                text: delta,
            }
        }
    }

    private createProviderRequest(request: ModelStreamRequest) {
        const provider = request.model.resolved
        const strategy = this.resolveStrategy(provider)

        return strategy.createRequest({
            provider,
            messages: request.messages,
            env: this.env,
        })
    }

    private resolveStrategy(provider: ResolvedModelProviderConfig): ModelProviderStrategy {
        const strategy = this.strategies.find(candidate => candidate.supports(provider))
        if (strategy) return strategy

        throw new Error(`No model provider strategy registered for provider: ${provider.provider}`)
    }
}

async function createRequestErrorMessage(response: Response): Promise<string> {
    const body = await response.text().catch(() => '')
    const detail = body.trim()
    if (!detail) {
        return `Model request failed with HTTP ${response.status} ${response.statusText}`.trim()
    }

    return `Model request failed with HTTP ${response.status} ${response.statusText}: ${detail}`.trim()
}

function isEventStream(response: Response): boolean {
    return response.headers.get('content-type')?.includes('text/event-stream') ?? false
}

async function* readServerSentEventData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const blocks = buffer.split(/\r?\n\r?\n/)
            buffer = blocks.pop() ?? ''

            for (const block of blocks) {
                const data = parseServerSentEventData(block)
                if (data) yield data
            }
        }

        buffer += decoder.decode()
        const data = parseServerSentEventData(buffer)
        if (data) yield data
    } finally {
        reader.releaseLock()
    }
}

function parseServerSentEventData(block: string): string | undefined {
    const lines = block
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(line => line.startsWith('data:'))

    if (lines.length === 0) return undefined

    return lines
        .map(line => line.slice('data:'.length).trimStart())
        .join('\n')
        .trim()
}

function extractStreamingDelta(text: string): string | undefined {
    const parsed = safeParseJson(text)
    if (!isJsonObject(parsed)) return undefined

    const choice = getFirstChoice(parsed)
    if (!isJsonObject(choice)) return undefined

    const delta = choice.delta
    if (!isJsonObject(delta)) return undefined

    return typeof delta.content === 'string' ? delta.content : undefined
}

function extractNonStreamingContent(body: unknown): string | undefined {
    if (!isJsonObject(body)) return undefined

    const choice = getFirstChoice(body)
    if (!isJsonObject(choice)) return undefined

    const message = choice.message
    if (!isJsonObject(message)) return undefined

    return typeof message.content === 'string' ? message.content : undefined
}

function getFirstChoice(body: Record<string, unknown>): unknown {
    const choices = body.choices
    return Array.isArray(choices) ? choices[0] : undefined
}

function safeParseJson(text: string): unknown {
    try {
        return JSON.parse(text) as unknown
    } catch {
        return undefined
    }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
