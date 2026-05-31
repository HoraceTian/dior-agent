import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
    type CollectorEndpointConfig,
    RawCollectorsConfigSchema,
} from 'src/domain/tools/collectorConfig.js'
import {
    type CollectorClient,
    type CollectorRegistryManager,
    type CollectorRegistrySnapshot,
    createEmptyCollectorRegistrySnapshot,
} from 'src/domain/tools/collectorRegistry.js'
import type { Logger } from 'src/observability/logger.js'
import { HttpCollectorClient } from './httpCollectorClient.js'

export type FileCollectorRegistryManagerOptions = {
    path: string
    logger: Logger
    client?: CollectorClient
}

export class FileCollectorRegistryManager implements CollectorRegistryManager {
    private snapshot: CollectorRegistrySnapshot
    private readonly client: CollectorClient
    private nextVersion = 1
    private started = false

    constructor(private readonly options: FileCollectorRegistryManagerOptions) {
        this.snapshot = createEmptyCollectorRegistrySnapshot(options.path)
        this.client = options.client ?? new HttpCollectorClient()
    }

    getSnapshot(): CollectorRegistrySnapshot {
        return this.snapshot
    }

    async start(): Promise<void> {
        if (this.started) return
        this.started = true
        await this.reload('initial')
    }

    async stop(): Promise<void> {
        this.started = false
    }

    private async reload(reason: 'initial'): Promise<void> {
        try {
            await mkdir(dirname(this.options.path), { recursive: true })
            const text = await readFile(this.options.path, 'utf8')
            const raw = RawCollectorsConfigSchema.parse(parseToml(text))
            const collectors = await this.discoverCollectors(raw.collectors)
            const snapshot: CollectorRegistrySnapshot = {
                version: this.nextVersion,
                loadedAt: new Date().toISOString(),
                sourcePath: this.options.path,
                collectors,
            }
            this.nextVersion += 1
            this.snapshot = snapshot
            this.options.logger.info('Collector registry loaded', {
                reason,
                path: this.options.path,
                version: snapshot.version,
                collectors: snapshot.collectors.length,
            })
        } catch (error) {
            if (isMissingFileError(error)) {
                this.options.logger.info(
                    'Collector registry config not found; no collectors loaded',
                    {
                        reason,
                        path: this.options.path,
                    },
                )
                return
            }

            this.options.logger.warn(
                'Collector registry reload failed; keeping previous snapshot',
                {
                    reason,
                    path: this.options.path,
                    version: this.snapshot.version,
                    error: error instanceof Error ? error.message : String(error),
                },
            )
        }
    }

    private async discoverCollectors(endpoints: CollectorEndpointConfig[]) {
        const discovered = []
        for (const endpoint of endpoints) {
            if (!endpoint.enabled) continue

            try {
                const manifest = await this.client.readManifest(endpoint)
                discovered.push({
                    id: endpoint.id,
                    endpoint,
                    manifest,
                    discoveredAt: new Date().toISOString(),
                })
                this.options.logger.info('Collector discovered', {
                    id: endpoint.id,
                    url: endpoint.url,
                    tools: manifest.tools.length,
                })
            } catch (error) {
                this.options.logger.warn('Collector discovery failed', {
                    id: endpoint.id,
                    url: endpoint.url,
                    error: error instanceof Error ? error.message : String(error),
                })
            }
        }
        return discovered
    }
}

function parseToml(text: string): unknown {
    const runtime = globalThis as typeof globalThis & {
        Bun?: {
            TOML?: {
                parse: (input: string) => unknown
            }
        }
    }

    if (!runtime.Bun?.TOML?.parse) {
        throw new Error('Bun.TOML.parse is required for collector registry config.')
    }

    return runtime.Bun.TOML.parse(text)
}

function isMissingFileError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'ENOENT'
    )
}
