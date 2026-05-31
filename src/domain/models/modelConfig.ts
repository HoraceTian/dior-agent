import type { TurnModelRecord } from 'src/domain/sessions/sessionStore.js'
import { z } from 'zod'

export const LlmProviderSchema = z.enum(['ollama', 'openai'])

export const RawModelConfigSchema = z.object({
    llm_provider: LlmProviderSchema.default('ollama'),
    ollama_base_url: z.string().url().default('http://localhost:11434'),
    ollama_model_name: z.string().min(1).default('deepseek-r1:70b'),
    openai_api_key_env: z.string().min(1).default('OPENAI_API_KEY'),
    openai_base_url: z.string().url().default('https://api.openai.com/v1'),
    openai_model_name: z.string().min(1).default('gpt-4.1-mini'),
})

export type LlmProvider = z.infer<typeof LlmProviderSchema>
export type RawModelConfig = z.infer<typeof RawModelConfigSchema>

export type ResolvedModelProviderConfig =
    | {
          provider: 'ollama'
          baseUrl: string
          modelName: string
      }
    | {
          provider: 'openai'
          baseUrl: string
          modelName: string
          apiKeyEnv: string
      }

export type ModelConfigSnapshot = {
    version: number
    loadedAt: string
    sourcePath: string
    provider: LlmProvider
    resolved: ResolvedModelProviderConfig
}

export type ModelConfigProvider = {
    getSnapshot: () => ModelConfigSnapshot
}

export type ModelConfigManager = ModelConfigProvider & {
    start: () => Promise<void>
    stop: () => Promise<void>
}

export function resolveModelConfig(
    raw: RawModelConfig,
    input: {
        version: number
        loadedAt: string
        sourcePath: string
    },
): ModelConfigSnapshot {
    return {
        version: input.version,
        loadedAt: input.loadedAt,
        sourcePath: input.sourcePath,
        provider: raw.llm_provider,
        resolved: resolveProvider(raw),
    }
}

export function createDefaultModelConfigSnapshot(sourcePath: string): ModelConfigSnapshot {
    const raw = RawModelConfigSchema.parse({})
    return resolveModelConfig(raw, {
        version: 0,
        loadedAt: new Date(0).toISOString(),
        sourcePath,
    })
}

export function createTurnModelRecord(snapshot: ModelConfigSnapshot): TurnModelRecord {
    return {
        configVersion: snapshot.version,
        provider: snapshot.provider,
        baseUrl: snapshot.resolved.baseUrl,
        modelName: snapshot.resolved.modelName,
        ...(snapshot.resolved.provider === 'openai'
            ? { apiKeyEnv: snapshot.resolved.apiKeyEnv }
            : {}),
    }
}

function resolveProvider(raw: RawModelConfig): ResolvedModelProviderConfig {
    if (raw.llm_provider === 'openai') {
        return {
            provider: 'openai',
            baseUrl: raw.openai_base_url,
            modelName: raw.openai_model_name,
            apiKeyEnv: raw.openai_api_key_env,
        }
    }

    return {
        provider: 'ollama',
        baseUrl: raw.ollama_base_url,
        modelName: raw.ollama_model_name,
    }
}
