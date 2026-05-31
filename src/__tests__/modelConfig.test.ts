import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileModelConfigManager } from 'src/infrastructure/models/fileModelConfigManager.js'
import { createLogger } from 'src/observability/logger.js'

const tempDirs: string[] = []

afterEach(async () => {
    while (tempDirs.length > 0) {
        await rm(tempDirs.pop() ?? '', { recursive: true, force: true })
    }
})

describe('FileModelConfigManager', () => {
    test('loads ollama config from TOML', async () => {
        const configPath = await createModelConfig(`
llm_provider = "ollama"
ollama_base_url = "http://localhost:11434"
ollama_model_name = "deepseek-r1:70b"
`)
        const manager = new FileModelConfigManager({
            path: configPath,
            logger: createLogger({ level: 'error' }),
            watch: false,
        })

        await manager.start()
        const snapshot = manager.getSnapshot()
        await manager.stop()

        expect(snapshot.version).toBe(1)
        expect(snapshot.provider).toBe('ollama')
        expect(snapshot.resolved).toMatchObject({
            provider: 'ollama',
            baseUrl: 'http://localhost:11434',
            modelName: 'deepseek-r1:70b',
        })
    })

    test('keeps old snapshot when reload is invalid', async () => {
        const configPath = await createModelConfig(`
llm_provider = "openai"
openai_api_key_env = "OPENAI_API_KEY"
openai_base_url = "https://api.openai.com/v1"
openai_model_name = "gpt-4.1-mini"
`)
        const manager = new FileModelConfigManager({
            path: configPath,
            logger: createLogger({ level: 'error' }),
            watch: false,
        })

        await manager.start()
        const initial = manager.getSnapshot()
        await writeFile(configPath, 'llm_provider = "not-supported"\n')
        await manager.stop()
        await manager.start()
        const afterInvalidReload = manager.getSnapshot()
        await manager.stop()

        expect(afterInvalidReload).toEqual(initial)
    })

    test('reloads asynchronously when watched file changes', async () => {
        const configPath = await createModelConfig(`
llm_provider = "openai"
openai_api_key_env = "OPENAI_API_KEY"
openai_base_url = "https://api.openai.com/v1"
openai_model_name = "gpt-4.1-mini"
`)
        const manager = new FileModelConfigManager({
            path: configPath,
            logger: createLogger({ level: 'error' }),
            watch: true,
            reloadDebounceMs: 10,
            watchIntervalMs: 10,
        })

        await manager.start()
        const initial = manager.getSnapshot()
        await writeFile(
            configPath,
            `
llm_provider = "ollama"
ollama_base_url = "http://localhost:11434"
ollama_model_name = "deepseek-r1:70b"
`,
        )

        await waitFor(() => manager.getSnapshot().version > initial.version)
        const reloaded = manager.getSnapshot()
        await manager.stop()

        expect(reloaded.provider).toBe('ollama')
        expect(reloaded.resolved.modelName).toBe('deepseek-r1:70b')
    })
})

async function createModelConfig(text: string): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'dior-agent-models-'))
    tempDirs.push(directory)
    const configPath = join(directory, 'models.toml')
    await writeFile(configPath, text)
    return configPath
}

async function waitFor(predicate: () => boolean): Promise<void> {
    const timeoutAt = Date.now() + 1000
    while (Date.now() < timeoutAt) {
        if (predicate()) return
        await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error('Timed out waiting for model config reload')
}
