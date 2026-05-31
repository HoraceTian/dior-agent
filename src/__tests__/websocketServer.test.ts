import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppContext } from 'src/app/container.js'
import type { AppConfig } from 'src/config/env.js'
import { createLogger } from 'src/observability/logger.js'
import { type RunningAgentServer, startAgentServer } from 'src/runtime/server.js'
import { type RawData, WebSocket } from 'ws'

const servers: RunningAgentServer[] = []
const tempDataDirs: string[] = []

afterEach(async () => {
    while (servers.length > 0) {
        await servers.pop()?.stop()
    }
    while (tempDataDirs.length > 0) {
        await rm(tempDataDirs.pop() ?? '', { recursive: true, force: true })
    }
})

describe('websocket agent server', () => {
    test('accepts authenticated session turns and persists session events', async () => {
        const dataDir = await createTempDataDir()
        const workspaceRoot = join(dataDir, 'workspaces')
        const context = createAppContext({
            config: testConfig(dataDir, workspaceRoot),
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

        ws.send(JSON.stringify({ type: 'session.create', id: 'create-1' }))

        const sessionReady = await waitForMessage(ws, message => message.type === 'session.ready')
        expect(sessionReady.type).toBe('session.ready')
        expect(sessionReady.id).toBe('create-1')
        const sessionId = String(sessionReady.sessionId)

        ws.send(JSON.stringify({ type: 'turn.start', id: 'turn-1', sessionId, input: 'hello' }))

        const accepted = await waitForMessage(ws, message => message.type === 'turn.accepted')
        expect(accepted).toEqual({
            type: 'turn.accepted',
            id: 'turn-1',
            sessionId,
            turnId: 'turn-1',
        })

        const completed = await waitForMessage(ws, message =>
            hasSessionEventType(message, 'turn.completed'),
        )
        const completedEvent = completed.event as Record<string, unknown>
        expect(completedEvent.output).toBe('Agent received: hello')

        const eventsText = await readFile(
            join(dataDir, 'sessions', sessionId, 'events.jsonl'),
            'utf8',
        )
        const persistedEventTypes = eventsText
            .split('\n')
            .filter(Boolean)
            .map(line => (JSON.parse(line) as Record<string, unknown>).type)
        expect(persistedEventTypes).toEqual([
            'session.created',
            'turn.started',
            'assistant.delta',
            'assistant.message',
            'turn.completed',
        ])

        const runtimeLogText = await readFile(
            join(dataDir, 'sessions', sessionId, 'logs', 'runtime.log'),
            'utf8',
        )
        const runtimeLogMessages = runtimeLogText
            .split('\n')
            .filter(Boolean)
            .map(line => (JSON.parse(line) as Record<string, unknown>).message)
        expect(runtimeLogMessages).toEqual(['turn.started', 'turn.completed'])

        const manifestText = await readFile(
            join(dataDir, 'sessions', sessionId, 'manifest.json'),
            'utf8',
        )
        const manifest = JSON.parse(manifestText) as Record<string, unknown>
        expect(manifest.workspacePath).toBe(join(workspaceRoot, sessionId))
        expect((await stat(join(workspaceRoot, sessionId))).isDirectory()).toBe(true)

        const turnText = await readFile(
            join(dataDir, 'sessions', sessionId, 'turns', 'turn-1.json'),
            'utf8',
        )
        const turn = JSON.parse(turnText) as {
            model: Record<string, unknown>
        }
        expect(turn.model).toMatchObject({
            provider: 'ollama',
            modelName: 'deepseek-r1:70b',
            configVersion: 0,
        })

        ws.close()
    })

    test('accepts browser-compatible cookie auth', async () => {
        const dataDir = await createTempDataDir()
        const context = createAppContext({
            config: testConfig(dataDir, join(dataDir, 'workspaces')),
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

        ws.send(JSON.stringify({ type: 'session.create', id: 'create-1' }))
        const sessionReady = await waitForMessage(ws, message => message.type === 'session.ready')
        expect(sessionReady.type).toBe('session.ready')

        ws.close()
    })

    test('replays directory-backed session events after reconnect', async () => {
        const dataDir = await createTempDataDir()
        const context = createAppContext({
            config: testConfig(dataDir, join(dataDir, 'workspaces')),
            logger: createLogger({ level: 'error' }),
        })
        const server = await startAgentServer(context)
        servers.push(server)

        const first = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
            headers: {
                authorization: 'Bearer test-token',
            },
        })
        await waitForOpen(first)
        await waitForMessage(first, message => message.type === 'connection.ready')

        first.send(JSON.stringify({ type: 'session.create', id: 'create-1' }))
        const sessionReady = await waitForMessage(
            first,
            message => message.type === 'session.ready',
        )
        const sessionId = String(sessionReady.sessionId)
        first.send(JSON.stringify({ type: 'turn.start', id: 'turn-1', sessionId, input: 'hello' }))
        await waitForMessage(first, message => hasSessionEventType(message, 'turn.completed'))
        first.close()

        const second = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, {
            headers: {
                authorization: 'Bearer test-token',
            },
        })
        await waitForOpen(second)
        await waitForMessage(second, message => message.type === 'connection.ready')

        second.send(
            JSON.stringify({
                type: 'session.attach',
                id: 'attach-1',
                sessionId,
                lastSeq: 0,
            }),
        )

        const attached = await waitForMessage(second, message => message.type === 'session.ready')
        expect(attached.id).toBe('attach-1')
        expect(attached.sessionId).toBe(sessionId)
        expect(attached.replayedEvents).toBe(5)

        const replayed = await waitForMessage(second, message =>
            hasSessionEventType(message, 'session.created'),
        )
        expect((replayed.event as Record<string, unknown>).sessionId).toBe(sessionId)

        second.close()
    })

    test('serves Hono health routes beside websocket transport', async () => {
        const dataDir = await createTempDataDir()
        const context = createAppContext({
            config: testConfig(dataDir, join(dataDir, 'workspaces')),
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

async function createTempDataDir(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'dior-agent-test-'))
    tempDataDirs.push(directory)
    return directory
}

function testConfig(dataDir: string, workspaceRoot: string): AppConfig {
    return {
        serviceName: 'dior-agent-test',
        host: '127.0.0.1',
        port: 0,
        dataDir,
        workspaceRoot,
        modelConfigPath: join(dataDir, 'models.toml'),
        modelConfigWatch: false,
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

function hasSessionEventType(message: Record<string, unknown>, type: string): boolean {
    if (message.type !== 'session.event') return false
    const event = message.event as Record<string, unknown> | undefined
    return event?.type === type
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
