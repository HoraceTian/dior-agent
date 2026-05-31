import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntime, AgentTurnRequest } from 'src/domain/agent/agentRuntime.js'
import { AgentService } from 'src/domain/agent/agentService.js'
import {
    type ModelConfigProvider,
    createDefaultModelConfigSnapshot,
} from 'src/domain/models/modelConfig.js'
import type { SessionEvent } from 'src/domain/sessions/sessionEvents.js'
import { SessionRuntime } from 'src/domain/sessions/sessionRuntime.js'
import { FileSessionStore } from 'src/infrastructure/sessions/fileSessionStore.js'

const tempDataDirs: string[] = []

afterEach(async () => {
    while (tempDataDirs.length > 0) {
        await rm(tempDataDirs.pop() ?? '', { recursive: true, force: true })
    }
})

describe('SessionRuntime', () => {
    test('rebuilds conversation history from persisted session events', async () => {
        const dataDir = await createTempDataDir()
        const store = new FileSessionStore({
            dataDir,
            workspaceRoot: join(dataDir, 'workspaces'),
        })
        const sessionId = 'session_1'
        const ownerId = 'owner_1'

        await store.createSession({
            sessionId,
            ownerId,
            now: new Date(0).toISOString(),
        })
        await store.appendEvent({
            type: 'session.created',
            sessionId,
            ownerId,
        })

        const firstRuntime = createSessionRuntime({
            sessionId,
            ownerId,
            store,
            runtime: createTestRuntime(),
        })
        await collectEvents(
            firstRuntime.runTurn({
                turnId: 'turn_1',
                connectionId: 'connection_1',
                input: 'hello',
            }),
        )

        const capturedRequests: CapturedAgentTurn[] = []
        const secondRuntime = createSessionRuntime({
            sessionId,
            ownerId,
            store,
            runtime: createTestRuntime(capturedRequests),
        })
        await collectEvents(
            secondRuntime.runTurn({
                turnId: 'turn_2',
                connectionId: 'connection_1',
                input: 'again',
            }),
        )

        expect(capturedRequests[0]?.history).toEqual([
            {
                role: 'user',
                content: 'hello',
            },
            {
                role: 'assistant',
                content: 'Agent received: hello',
            },
        ])
    })
})

type CapturedAgentTurn = Pick<AgentTurnRequest, 'history' | 'input' | 'sessionId' | 'turnId'>

function createSessionRuntime(input: {
    sessionId: string
    ownerId: string
    store: FileSessionStore
    runtime: AgentRuntime
}): SessionRuntime {
    return new SessionRuntime({
        sessionId: input.sessionId,
        ownerId: input.ownerId,
        store: input.store,
        agent: new AgentService(input.runtime),
        modelConfigs: createStaticModelConfigProvider(),
    })
}

function createStaticModelConfigProvider(): ModelConfigProvider {
    const snapshot = createDefaultModelConfigSnapshot('.config/models.toml')
    return {
        getSnapshot: () => snapshot,
    }
}

function createTestRuntime(capturedRequests: CapturedAgentTurn[] = []): AgentRuntime {
    return {
        async *runTurn(request) {
            capturedRequests.push({
                sessionId: request.sessionId,
                turnId: request.turnId,
                input: request.input,
                history: request.history?.map(message => ({ ...message })),
            })

            const output = `Agent received: ${request.input}`
            yield {
                type: 'assistant.delta',
                text: output,
            }

            return {
                output,
            }
        },
    }
}

async function collectEvents(stream: AsyncGenerator<SessionEvent>): Promise<SessionEvent[]> {
    const events: SessionEvent[] = []
    for await (const event of stream) {
        events.push(event)
    }
    return events
}

async function createTempDataDir(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'dior-agent-session-runtime-'))
    tempDataDirs.push(directory)
    return directory
}
