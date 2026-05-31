import { unwatchFile, watchFile } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
    type ModelConfigManager,
    type ModelConfigSnapshot,
    RawModelConfigSchema,
    createDefaultModelConfigSnapshot,
    resolveModelConfig,
} from 'src/domain/models/modelConfig.js'
import type { Logger } from 'src/observability/logger.js'

export type FileModelConfigManagerOptions = {
    path: string
    logger: Logger
    watch: boolean
    reloadDebounceMs?: number
    watchIntervalMs?: number
}

export class FileModelConfigManager implements ModelConfigManager {
    private snapshot: ModelConfigSnapshot
    private reloadTimer?: ReturnType<typeof setTimeout>
    private nextVersion = 1
    private started = false
    private readonly watchListener = () => {
        this.scheduleReload()
    }

    constructor(private readonly options: FileModelConfigManagerOptions) {
        this.snapshot = createDefaultModelConfigSnapshot(options.path)
    }

    getSnapshot(): ModelConfigSnapshot {
        return this.snapshot
    }

    async start(): Promise<void> {
        if (this.started) return
        this.started = true

        await this.reload('initial')
        if (!this.options.watch) return

        await mkdir(dirname(this.options.path), { recursive: true })
        watchFile(
            this.options.path,
            { interval: this.options.watchIntervalMs ?? 1000 },
            this.watchListener,
        )
    }

    async stop(): Promise<void> {
        this.started = false
        if (this.reloadTimer) {
            clearTimeout(this.reloadTimer)
            this.reloadTimer = undefined
        }
        unwatchFile(this.options.path, this.watchListener)
    }

    private scheduleReload(): void {
        if (this.reloadTimer) {
            clearTimeout(this.reloadTimer)
        }

        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = undefined
            void this.reload('watch')
        }, this.options.reloadDebounceMs ?? 100)
    }

    private async reload(reason: 'initial' | 'watch'): Promise<void> {
        try {
            const text = await readFile(this.options.path, 'utf8')
            const parsedToml = parseToml(text)
            const raw = RawModelConfigSchema.parse(parsedToml)
            const snapshot = resolveModelConfig(raw, {
                version: this.nextVersion,
                loadedAt: new Date().toISOString(),
                sourcePath: this.options.path,
            })
            this.nextVersion += 1
            this.snapshot = snapshot
            this.options.logger.info('Model config loaded', {
                reason,
                path: this.options.path,
                version: snapshot.version,
                provider: snapshot.provider,
                modelName: snapshot.resolved.modelName,
            })
        } catch (error) {
            this.options.logger.warn('Model config reload failed; keeping previous snapshot', {
                reason,
                path: this.options.path,
                version: this.snapshot.version,
                error: error instanceof Error ? error.message : String(error),
            })
        }
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

    if (runtime.Bun?.TOML?.parse) {
        return runtime.Bun.TOML.parse(text)
    }

    return parseFlatToml(text)
}

function parseFlatToml(text: string): Record<string, unknown> {
    const parsed: Record<string, unknown> = {}

    for (const line of text.split('\n')) {
        const trimmed = stripComment(line).trim()
        if (!trimmed) continue
        if (trimmed.startsWith('[')) {
            throw new Error('Only flat TOML model config is supported.')
        }

        const delimiterIndex = trimmed.indexOf('=')
        if (delimiterIndex < 1) {
            throw new Error(`Invalid TOML assignment: ${line}`)
        }

        const key = trimmed.slice(0, delimiterIndex).trim()
        const value = trimmed.slice(delimiterIndex + 1).trim()
        parsed[key] = parseFlatTomlValue(value)
    }

    return parsed
}

function stripComment(line: string): string {
    let quoted = false
    let quote = ''

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]
        if ((char === '"' || char === "'") && line[index - 1] !== '\\') {
            if (!quoted) {
                quoted = true
                quote = char
            } else if (quote === char) {
                quoted = false
                quote = ''
            }
        }

        if (char === '#' && !quoted) {
            return line.slice(0, index)
        }
    }

    return line
}

function parseFlatTomlValue(value: string): string | number | boolean {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1)
    }

    if (value === 'true') return true
    if (value === 'false') return false

    const numberValue = Number(value)
    if (Number.isFinite(numberValue)) {
        return numberValue
    }

    return value
}
