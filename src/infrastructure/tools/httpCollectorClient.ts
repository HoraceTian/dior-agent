import type { CollectorEndpointConfig } from 'src/domain/tools/collectorConfig.js'
import {
    type CollectorManifest,
    CollectorManifestSchema,
    type ToolInvocationRequest,
    type ToolInvocationResponse,
    ToolInvocationResponseSchema,
} from 'src/domain/tools/collectorProtocol.js'
import type { CollectorClient } from 'src/domain/tools/collectorRegistry.js'

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type Env = Record<string, string | undefined>

export type HttpCollectorClientOptions = {
    fetch?: FetchLike
    env?: Env
}

export class HttpCollectorClient implements CollectorClient {
    private readonly fetchImpl: FetchLike
    private readonly env: Env

    constructor(options: HttpCollectorClientOptions = {}) {
        this.fetchImpl = options.fetch ?? fetch
        this.env = options.env ?? process.env
    }

    async readManifest(endpoint: CollectorEndpointConfig): Promise<CollectorManifest> {
        const response = await this.fetchImpl(appendPath(endpoint.url, 'v1/manifest'), {
            method: 'GET',
            headers: this.createHeaders(endpoint),
        })
        if (!response.ok) {
            throw new Error(await createRequestErrorMessage(response, 'collector manifest'))
        }

        return CollectorManifestSchema.parse((await response.json()) as unknown)
    }

    async invokeTool(
        endpoint: CollectorEndpointConfig,
        toolName: string,
        request: ToolInvocationRequest,
    ): Promise<ToolInvocationResponse> {
        const response = await this.fetchImpl(
            appendPath(endpoint.url, `v1/tools/${encodeURIComponent(toolName)}/invoke`),
            {
                method: 'POST',
                headers: this.createHeaders(endpoint),
                body: JSON.stringify(request),
            },
        )
        if (!response.ok) {
            throw new Error(await createRequestErrorMessage(response, 'collector tool invocation'))
        }

        return ToolInvocationResponseSchema.parse((await response.json()) as unknown)
    }

    private createHeaders(endpoint: CollectorEndpointConfig): Headers {
        const headers = new Headers({
            accept: 'application/json',
            'content-type': 'application/json',
        })
        const token = resolveToken(endpoint, this.env)
        if (token) {
            headers.set('authorization', `Bearer ${token}`)
        }
        return headers
    }
}

function resolveToken(endpoint: CollectorEndpointConfig, env: Env): string | undefined {
    const staticToken = endpoint.token?.trim()
    if (staticToken) return staticToken

    const tokenEnv = endpoint.token_env?.trim()
    if (!tokenEnv) return undefined

    return env[tokenEnv]?.trim() || undefined
}

function appendPath(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function createRequestErrorMessage(response: Response, operation: string): Promise<string> {
    const body = await response.text().catch(() => '')
    const detail = body.trim()
    const prefix = `${operation} failed with HTTP ${response.status} ${response.statusText}`.trim()
    return detail ? `${prefix}: ${detail}` : prefix
}
