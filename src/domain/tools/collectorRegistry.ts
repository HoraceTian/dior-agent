import type { CollectorEndpointConfig } from './collectorConfig.js'
import type {
    CollectorManifest,
    ToolInvocationRequest,
    ToolInvocationResponse,
} from './collectorProtocol.js'

export type CollectorRegistration = {
    id: string
    endpoint: CollectorEndpointConfig
    manifest: CollectorManifest
    discoveredAt: string
}

export type CollectorRegistrySnapshot = {
    version: number
    loadedAt: string
    sourcePath: string
    collectors: CollectorRegistration[]
}

export type CollectorClient = {
    readManifest: (endpoint: CollectorEndpointConfig) => Promise<CollectorManifest>
    invokeTool: (
        endpoint: CollectorEndpointConfig,
        toolName: string,
        request: ToolInvocationRequest,
    ) => Promise<ToolInvocationResponse>
}

export type CollectorRegistryProvider = {
    getSnapshot: () => CollectorRegistrySnapshot
}

export type CollectorRegistryManager = CollectorRegistryProvider & {
    start: () => Promise<void>
    stop: () => Promise<void>
}

export function createEmptyCollectorRegistrySnapshot(
    sourcePath: string,
): CollectorRegistrySnapshot {
    return {
        version: 0,
        loadedAt: new Date(0).toISOString(),
        sourcePath,
        collectors: [],
    }
}
