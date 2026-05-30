import type { IncomingMessage } from 'node:http'
import type { AuthCredential } from 'src/domain/auth/authenticator.js'

const AUTH_COOKIE_NAME = 'agent_token'

export function extractUpgradeCredential(
    request: IncomingMessage,
    url: URL,
): AuthCredential | undefined {
    return (
        getAuthorizationCredential(request) ??
        getCookieCredential(request) ??
        getQueryCredential(url)
    )
}

function getAuthorizationCredential(request: IncomingMessage): AuthCredential | undefined {
    const header = request.headers.authorization
    if (!header) return undefined

    const [scheme, token] = header.split(/\s+/, 2)
    if (scheme?.toLowerCase() !== 'bearer') return undefined
    if (!token?.trim()) return undefined

    return {
        scheme: 'bearer',
        source: 'authorization',
        token: token.trim(),
    }
}

function getQueryCredential(url: URL): AuthCredential | undefined {
    const token = url.searchParams.get('token')?.trim()
    if (!token) return undefined

    return {
        scheme: 'bearer',
        source: 'query',
        token,
    }
}

function getCookieCredential(request: IncomingMessage): AuthCredential | undefined {
    const token = parseCookieHeader(request.headers.cookie)[AUTH_COOKIE_NAME]?.trim()
    if (!token) return undefined

    return {
        scheme: 'bearer',
        source: 'cookie',
        token,
    }
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
    if (!header) return {}

    return Object.fromEntries(
        header
            .split(';')
            .map(part => part.trim())
            .filter(Boolean)
            .map(part => {
                const index = part.indexOf('=')
                if (index === -1) return [part, '']
                return [part.slice(0, index), decodeCookieValue(part.slice(index + 1))]
            }),
    )
}

function decodeCookieValue(value: string): string {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}
