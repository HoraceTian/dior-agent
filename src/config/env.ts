import type { AuthPolicy } from 'src/domain/auth/authenticator.js'
import { z } from 'zod'

const DEFAULT_PORT = 8787
const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_WORKSPACE_ROOT = '.data'
const DEFAULT_MODEL_CONFIG_PATH = '.config/models.toml'
const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024
const DEFAULT_IDLE_TIMEOUT_MS = 120_000

const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])
const OriginSchema = z
    .string()
    .url()
    .transform(value => new URL(value).origin)

export type LogLevel = z.infer<typeof LogLevelSchema>

export type AppAuthConfig = AuthPolicy & {
    allowedOrigins: string[]
}

export type AppConfig = {
    serviceName: string
    host: string
    port: number
    workspaceRoot: string
    modelConfigPath: string
    modelConfigWatch: boolean
    auth: AppAuthConfig
    maxMessageBytes: number
    idleTimeoutMs: number
    logLevel: LogLevel
}

export const AppConfigSchema = z
    .object({
        serviceName: z.string().min(1),
        host: z.string().min(1),
        port: z.number().int().min(0).max(65_535),
        workspaceRoot: z.string().min(1),
        modelConfigPath: z.string().min(1),
        modelConfigWatch: z.boolean(),
        auth: z.object({
            staticToken: z.string().min(1).optional(),
            allowInsecureDev: z.boolean(),
            allowQueryToken: z.boolean(),
            allowedOrigins: z.array(OriginSchema).transform(origins => [...new Set(origins)]),
        }),
        maxMessageBytes: z
            .number()
            .int()
            .min(1024)
            .max(10 * 1024 * 1024),
        idleTimeoutMs: z
            .number()
            .int()
            .min(5_000)
            .max(30 * 60_000),
        logLevel: LogLevelSchema,
    })
    .superRefine((config, context) => {
        if (!config.auth.staticToken && !config.auth.allowInsecureDev) {
            context.addIssue({
                code: 'custom',
                path: ['auth', 'staticToken'],
                message:
                    'AGENT_API_TOKEN is required. Set AGENT_ALLOW_INSECURE_DEV=1 only for local throwaway development.',
            })
        }

        if (
            !config.auth.staticToken &&
            config.auth.allowInsecureDev &&
            !isLoopbackHost(config.host)
        ) {
            context.addIssue({
                code: 'custom',
                path: ['host'],
                message:
                    'AGENT_ALLOW_INSECURE_DEV without AGENT_API_TOKEN may only bind to loopback hosts.',
            })
        }
    })

type Env = Record<string, string | undefined>

export function loadConfig(env: Env = process.env): AppConfig {
    const parsed = AppConfigSchema.safeParse({
        serviceName: nonEmpty(env.AGENT_SERVICE_NAME) ?? 'dior-agent',
        host: nonEmpty(env.AGENT_HOST) ?? DEFAULT_HOST,
        port: parseInteger(env.AGENT_PORT, DEFAULT_PORT),
        workspaceRoot: nonEmpty(env.AGENT_WORKSPACE_ROOT) ?? DEFAULT_WORKSPACE_ROOT,
        modelConfigPath: nonEmpty(env.AGENT_MODEL_CONFIG_PATH) ?? DEFAULT_MODEL_CONFIG_PATH,
        modelConfigWatch: parseBooleanWithDefault(env.AGENT_MODEL_CONFIG_WATCH, true),
        auth: {
            staticToken: nonEmpty(env.AGENT_API_TOKEN),
            allowInsecureDev: parseBoolean(env.AGENT_ALLOW_INSECURE_DEV),
            allowQueryToken: parseBoolean(env.AGENT_ALLOW_QUERY_TOKEN),
            allowedOrigins: parseList(env.AGENT_ALLOWED_ORIGINS),
        },
        maxMessageBytes: parseInteger(env.AGENT_MAX_MESSAGE_BYTES, DEFAULT_MAX_MESSAGE_BYTES, {
            min: 1024,
            max: 10 * 1024 * 1024,
        }),
        idleTimeoutMs: parseInteger(env.AGENT_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS, {
            min: 5_000,
            max: 30 * 60_000,
        }),
        logLevel: parseLogLevel(env.AGENT_LOG_LEVEL),
    })

    if (!parsed.success) {
        throw new Error(z.prettifyError(parsed.error))
    }

    return parsed.data
}

function nonEmpty(value: string | undefined): string | undefined {
    const trimmed = value?.trim()
    return trimmed ? trimmed : undefined
}

function parseBoolean(value: string | undefined): boolean {
    if (!value) return false
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function parseBooleanWithDefault(value: string | undefined, fallback: boolean): boolean {
    if (!value) return fallback
    if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true
    if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false
    return fallback
}

function parseList(value: string | undefined): string[] {
    if (!value) return []
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
}

function isLoopbackHost(host: string): boolean {
    return host === 'localhost' || host === '::1' || host.startsWith('127.')
}

function parseInteger(
    value: string | undefined,
    fallback: number,
    bounds: { min: number; max: number } = { min: 0, max: 65_535 },
): number {
    if (!value) return fallback

    const parsed = Number.parseInt(value, 10)
    if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
        throw new Error(`Invalid integer value: ${value}`)
    }
    return parsed
}

function parseLogLevel(value: string | undefined): LogLevel {
    if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
        return value
    }
    return 'info'
}
