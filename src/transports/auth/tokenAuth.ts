import type { IncomingMessage } from 'node:http'
import type { AppConfig } from 'src/config/env.js'
import { type AuthPolicy, type AuthResult, Authenticator } from 'src/domain/auth/authenticator.js'
import { extractUpgradeCredential } from './credentials.js'

export function authenticateUpgradeRequest(
    request: IncomingMessage,
    url: URL,
    config: AppConfig,
): AuthResult {
    if (!isOriginAllowed(request.headers.origin, config.auth.allowedOrigins)) {
        return { ok: false, reason: 'origin_not_allowed' }
    }

    const credential = extractUpgradeCredential(request, url)
    return new Authenticator(createAuthPolicy(config.auth)).authenticate(credential)
}

function createAuthPolicy(auth: AppConfig['auth']): AuthPolicy {
    return {
        staticToken: auth.staticToken,
        allowInsecureDev: auth.allowInsecureDev,
        allowQueryToken: auth.allowQueryToken,
    }
}

function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
    if (allowedOrigins.length === 0) return true

    const normalizedOrigin = normalizeOrigin(origin)
    return Boolean(normalizedOrigin && allowedOrigins.includes(normalizedOrigin))
}

function normalizeOrigin(origin: string | undefined): string | undefined {
    if (!origin) return undefined

    try {
        return new URL(origin).origin
    } catch {
        return undefined
    }
}
