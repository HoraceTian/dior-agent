import { describe, expect, test } from 'bun:test'
import type { IncomingMessage } from 'node:http'
import type { AppConfig } from 'src/config/env.js'
import { type AuthPolicy, Authenticator } from 'src/domain/auth/authenticator.js'
import { extractUpgradeCredential } from 'src/transports/auth/credentials.js'
import { authenticateUpgradeRequest } from 'src/transports/auth/tokenAuth.js'

describe('Authenticator', () => {
    test('accepts a valid bearer token with constant-time comparison', () => {
        const authenticator = new Authenticator(testAuthPolicy())

        const result = authenticator.authenticate({
            scheme: 'bearer',
            source: 'authorization',
            token: 'test-token',
        })

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.principal.id).toBe('private-client')
            expect(result.principal.credentialSource).toBe('authorization')
        }
    })

    test('rejects invalid credentials', () => {
        const authenticator = new Authenticator(testAuthPolicy())

        const result = authenticator.authenticate({
            scheme: 'bearer',
            source: 'authorization',
            token: 'wrong-token',
        })

        expect(result).toEqual({
            ok: false,
            reason: 'invalid_credentials',
        })
    })

    test('rejects query tokens unless explicitly enabled', () => {
        const authenticator = new Authenticator(testAuthPolicy())

        const result = authenticator.authenticate({
            scheme: 'bearer',
            source: 'query',
            token: 'test-token',
        })

        expect(result).toEqual({
            ok: false,
            reason: 'query_token_disabled',
        })
    })

    test('accepts query tokens when enabled for constrained clients', () => {
        const authenticator = new Authenticator(testAuthPolicy({ allowQueryToken: true }))

        const result = authenticator.authenticate({
            scheme: 'bearer',
            source: 'query',
            token: 'test-token',
        })

        expect(result.ok).toBe(true)
    })
})

describe('extractUpgradeCredential', () => {
    test('extracts bearer token from Authorization first', () => {
        const credential = extractUpgradeCredential(
            mockRequest({
                authorization: 'Bearer header-token',
            }),
            new URL('http://localhost/ws?token=query-token'),
        )

        expect(credential).toEqual({
            scheme: 'bearer',
            source: 'authorization',
            token: 'header-token',
        })
    })

    test('extracts bearer token from browser-compatible auth cookie', () => {
        const credential = extractUpgradeCredential(
            mockRequest({
                cookie: 'theme=dark; agent_token=cookie-token',
            }),
            new URL('http://localhost/ws?token=query-token'),
        )

        expect(credential).toEqual({
            scheme: 'bearer',
            source: 'cookie',
            token: 'cookie-token',
        })
    })

    test('keeps malformed cookie values from crashing upgrade auth', () => {
        const credential = extractUpgradeCredential(
            mockRequest({
                cookie: 'agent_token=token%zz',
            }),
            new URL('http://localhost/ws'),
        )

        expect(credential).toEqual({
            scheme: 'bearer',
            source: 'cookie',
            token: 'token%zz',
        })
    })
})

describe('authenticateUpgradeRequest', () => {
    test('rejects websocket upgrades from origins outside the allowlist', () => {
        const result = authenticateUpgradeRequest(
            mockRequest({
                authorization: 'Bearer test-token',
                origin: 'https://untrusted.example',
            }),
            new URL('http://localhost/ws'),
            testConfig({
                allowedOrigins: ['https://private.example'],
            }),
        )

        expect(result).toEqual({
            ok: false,
            reason: 'origin_not_allowed',
        })
    })

    test('accepts websocket upgrades from an allowed origin', () => {
        const result = authenticateUpgradeRequest(
            mockRequest({
                authorization: 'Bearer test-token',
                origin: 'https://private.example',
            }),
            new URL('http://localhost/ws'),
            testConfig({
                allowedOrigins: ['https://private.example'],
            }),
        )

        expect(result.ok).toBe(true)
    })
})

function testAuthPolicy(overrides: Partial<AuthPolicy> = {}): AuthPolicy {
    return {
        staticToken: 'test-token',
        allowInsecureDev: false,
        allowQueryToken: false,
        ...overrides,
    }
}

function testConfig(authOverrides: Partial<AppConfig['auth']> = {}): AppConfig {
    return {
        serviceName: 'dior-agent-test',
        host: '127.0.0.1',
        port: 0,
        workspaceRoot: '.data-test',
        modelConfigPath: '.models-test.toml',
        modelConfigWatch: false,
        auth: {
            staticToken: 'test-token',
            allowInsecureDev: false,
            allowQueryToken: false,
            allowedOrigins: [],
            ...authOverrides,
        },
        maxMessageBytes: 65_536,
        idleTimeoutMs: 30_000,
        logLevel: 'error',
    }
}

function mockRequest(headers: IncomingMessage['headers']): IncomingMessage {
    return { headers } as IncomingMessage
}
