import { afterEach, describe, expect, test } from 'bun:test'
import { createAppContext } from 'src/app/container.js'
import type { AppConfig } from 'src/config/env.js'
import { createLogger } from 'src/observability/logger.js'
import { type RunningAgentServer, startAgentServer } from 'src/runtime/server.js'
import { type RawData, WebSocket } from 'ws'

const servers: RunningAgentServer[] = []

afterEach(async () => {
    while (servers.length > 0) {
        await servers.pop()?.stop()
    }
})

describe('websocket agent server', () => {
    test('accepts authenticated websocket messages', async () => {
        const context = createAppContext({
            config: testConfig(),
            logger: createLogger({ level: 'error' }),
        })
        const server = await startAgentServer(context)
        servers.push(server)

        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
            headers: {
                authorization: 'Bearer test-token',
            },
        })
        await waitForOpen(ws)

        const ready = await waitForMessage(ws, message => message.type === 'connection.ready')
        expect(ready.type).toBe('connection.ready')

        ws.send(JSON.stringify({ type: 'agent.message', id: 'turn-1', input: 'hello' }))

        const received = await waitForMessage(
            ws,
            message => message.type === 'agent.message.received',
        )
        expect(received).toEqual({ type: 'agent.message.received', id: 'turn-1' })

        const result = await waitForMessage(ws, message => message.type === 'agent.message.result')
        expect(result.type).toBe('agent.message.result')
        expect(result.id).toBe('turn-1')
        expect(result.output).toBe('Agent received: hello')

        ws.close()
    })

    test('accepts browser-compatible cookie auth', async () => {
        const context = createAppContext({
            config: testConfig(),
            logger: createLogger({ level: 'error' }),
        })
        const server = await startAgentServer(context)
        servers.push(server)

        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
            headers: {
                cookie: 'agent_token=test-token',
            },
        })
        await waitForOpen(ws)

        const ready = await waitForMessage(ws, message => message.type === 'connection.ready')
        expect(ready.type).toBe('connection.ready')

        ws.close()
    })

    test('serves Hono health routes beside websocket transport', async () => {
        const context = createAppContext({
            config: testConfig(),
            logger: createLogger({ level: 'error' }),
        })
        const server = await startAgentServer(context)
        servers.push(server)

        const response = await fetch(`http://127.0.0.1:${server.port}/health`)
        const body = (await response.json()) as Record<string, unknown>

        expect(response.status).toBe(200)
        expect(body.status).toBe('ok')
        expect(body.service).toBe('dior-agent-test')
    })
})

function testConfig(): AppConfig {
    return {
        serviceName: 'dior-agent-test',
        host: '127.0.0.1',
        port: 0,
        auth: {
            staticToken: 'test-token',
            allowInsecureDev: false,
            allowQueryToken: false,
            allowedOrigins: [],
        },
        maxMessageBytes: 65_536,
        idleTimeoutMs: 30_000,
        logLevel: 'error',
    }
}

function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error('Timed out waiting for websocket open')),
            1000,
        )
        ws.once('open', () => {
            clearTimeout(timeout)
            resolve()
        })
        ws.once('error', () => {
            clearTimeout(timeout)
            reject(new Error('WebSocket connection failed'))
        })
    })
}

function waitForMessage(
    ws: WebSocket,
    predicate: (message: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error('Timed out waiting for websocket message')),
            1000,
        )
        const listener = (data: RawData) => {
            const message = JSON.parse(data.toString()) as Record<string, unknown>
            if (!predicate(message)) return
            clearTimeout(timeout)
            ws.off('message', listener)
            resolve(message)
        }
        ws.on('message', listener)
    })
}
