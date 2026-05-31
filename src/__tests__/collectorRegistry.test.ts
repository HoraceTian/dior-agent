import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CollectorClient } from 'src/domain/tools/collectorRegistry.js'
import { FileCollectorRegistryManager } from 'src/infrastructure/tools/fileCollectorRegistryManager.js'
import { HttpCollectorClient } from 'src/infrastructure/tools/httpCollectorClient.js'
import { createLogger } from 'src/observability/logger.js'

const tempDirs: string[] = []

afterEach(async () => {
    while (tempDirs.length > 0) {
        await rm(tempDirs.pop() ?? '', { recursive: true, force: true })
    }
})

describe('FileCollectorRegistryManager', () => {
    test('discovers enabled collectors from TOML config', async () => {
        const discoveredEndpoints: string[] = []
        const client: CollectorClient = {
            async readManifest(endpoint) {
                discoveredEndpoints.push(endpoint.id)
                return {
                    collectorId: 'local-test',
                    displayName: 'Local Test Collector',
                    description: 'Collector running on the local test machine.',
                    protocolVersion: '2026-05-collector-v1',
                    version: '0.1.0',
                    publicUrl: endpoint.url,
                    tools: [
                        {
                            name: 'system.info',
                            description: 'System context',
                            inputSchema: {},
                            outputSchema: {},
                            scopes: ['system:read'],
                            sideEffects: 'read-only',
                            timeoutMs: 10000,
                            maxResultBytes: 65536,
                        },
                    ],
                }
            },
            async invokeTool() {
                throw new Error('not used')
            },
        }

        const configPath = await createCollectorsConfig(`
[[collectors]]
id = "local-test"
url = "http://127.0.0.1:9701"
token_env = "TEST_COLLECTOR_TOKEN"
enabled = true
trust = "private"

[[collectors]]
id = "disabled-test"
url = "http://127.0.0.1:1"
enabled = false
`)
        const manager = new FileCollectorRegistryManager({
            path: configPath,
            logger: createLogger({ level: 'error' }),
            client,
        })

        await manager.start()
        const snapshot = manager.getSnapshot()
        await manager.stop()

        expect(snapshot.version).toBe(1)
        expect(snapshot.collectors).toHaveLength(1)
        expect(snapshot.collectors[0]?.id).toBe('local-test')
        expect(snapshot.collectors[0]?.manifest.description).toBe(
            'Collector running on the local test machine.',
        )
        expect(snapshot.collectors[0]?.manifest.tools[0]?.name).toBe('system.info')
        expect(discoveredEndpoints).toEqual(['local-test'])
    })

    test('keeps an empty snapshot when config file is missing', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'dior-agent-collectors-'))
        tempDirs.push(directory)
        const manager = new FileCollectorRegistryManager({
            path: join(directory, 'missing.toml'),
            logger: createLogger({ level: 'error' }),
        })

        await manager.start()
        const snapshot = manager.getSnapshot()
        await manager.stop()

        expect(snapshot.version).toBe(0)
        expect(snapshot.collectors).toEqual([])
    })
})

describe('HttpCollectorClient', () => {
    test('sends bearer auth and parses collector manifests', async () => {
        const requests: Array<{ url: string; authorization: string }> = []
        const client = new HttpCollectorClient({
            env: {
                TEST_COLLECTOR_TOKEN: 'secret-token',
            },
            fetch: async (url, init) => {
                const headers = new Headers(init?.headers)
                requests.push({
                    url: String(url),
                    authorization: headers.get('authorization') ?? '',
                })

                return Response.json({
                    collectorId: 'local-test',
                    displayName: 'Local Test Collector',
                    description: 'Collector running on the local test machine.',
                    protocolVersion: '2026-05-collector-v1',
                    version: '0.1.0',
                    publicUrl: 'http://127.0.0.1:9701',
                    tools: [],
                })
            },
        })

        const manifest = await client.readManifest({
            id: 'local-test',
            url: 'http://127.0.0.1:9701',
            token_env: 'TEST_COLLECTOR_TOKEN',
            enabled: true,
            trust: 'private',
        })

        expect(manifest.collectorId).toBe('local-test')
        expect(manifest.description).toBe('Collector running on the local test machine.')
        expect(requests).toEqual([
            {
                url: 'http://127.0.0.1:9701/v1/manifest',
                authorization: 'Bearer secret-token',
            },
        ])
    })
})

async function createCollectorsConfig(text: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'dior-agent-collectors-'))
    tempDirs.push(directory)
    const configPath = join(directory, 'collectors.toml')
    await writeFile(configPath, text)
    return configPath
}
