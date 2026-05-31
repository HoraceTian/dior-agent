import type { AgentMessage } from 'src/domain/agent/agentMessages.js'
import type { ResolvedModelProviderConfig } from 'src/domain/models/modelConfig.js'

export type ModelProviderEnv = Record<string, string | undefined>

export type ModelProviderRequest = {
    url: string
    headers: Headers
    body: unknown
}

export type ModelProviderStrategyInput = {
    provider: ResolvedModelProviderConfig
    messages: AgentMessage[]
    env: ModelProviderEnv
}

export type ModelProviderStrategy = {
    name: string
    supports: (provider: ResolvedModelProviderConfig) => boolean
    createRequest: (input: ModelProviderStrategyInput) => ModelProviderRequest
}

export function createDefaultModelProviderStrategies(): ModelProviderStrategy[] {
    return [new OllamaOpenAICompatibleStrategy(), new OpenAIChatCompletionsStrategy()]
}

export class OllamaOpenAICompatibleStrategy implements ModelProviderStrategy {
    readonly name = 'ollama-openai-compatible'

    supports(provider: ResolvedModelProviderConfig): boolean {
        return provider.provider === 'ollama'
    }

    createRequest(input: ModelProviderStrategyInput): ModelProviderRequest {
        const provider = assertProvider(input.provider, 'ollama')
        const baseUrl = provider.baseUrl.replace(/\/+$/, '')
        const url = baseUrl.endsWith('/v1')
            ? appendPath(baseUrl, 'chat/completions')
            : appendPath(baseUrl, 'v1/chat/completions')

        return {
            url,
            headers: createJsonHeaders(),
            body: createChatCompletionsBody(provider.modelName, input.messages),
        }
    }
}

export class OpenAIChatCompletionsStrategy implements ModelProviderStrategy {
    readonly name = 'openai-chat-completions'

    supports(provider: ResolvedModelProviderConfig): boolean {
        return provider.provider === 'openai'
    }

    createRequest(input: ModelProviderStrategyInput): ModelProviderRequest {
        const provider = assertProvider(input.provider, 'openai')
        const headers = createJsonHeaders()
        const apiKey = input.env[provider.apiKeyEnv]?.trim()
        if (!apiKey) {
            throw new Error(`Missing OpenAI API key env: ${provider.apiKeyEnv}`)
        }

        headers.set('authorization', `Bearer ${apiKey}`)

        return {
            url: appendPath(provider.baseUrl, 'chat/completions'),
            headers,
            body: createChatCompletionsBody(provider.modelName, input.messages),
        }
    }
}

function assertProvider<Provider extends ResolvedModelProviderConfig['provider']>(
    provider: ResolvedModelProviderConfig,
    expected: Provider,
): Extract<ResolvedModelProviderConfig, { provider: Provider }> {
    if (provider.provider !== expected) {
        throw new Error(`Strategy expected ${expected} provider but received ${provider.provider}`)
    }

    return provider as Extract<ResolvedModelProviderConfig, { provider: Provider }>
}

function createJsonHeaders(): Headers {
    return new Headers({
        'content-type': 'application/json',
    })
}

function createChatCompletionsBody(model: string, messages: AgentMessage[]): unknown {
    return {
        model,
        messages,
        stream: true,
    }
}

function appendPath(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
