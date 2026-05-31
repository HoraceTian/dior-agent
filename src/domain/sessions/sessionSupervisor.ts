import type { AgentService } from 'src/domain/agent/agentService.js'
import type { ModelConfigProvider } from 'src/domain/models/modelConfig.js'
import type { Logger } from 'src/observability/logger.js'
import { createSessionId } from 'src/shared/id.js'
import { SessionOwnershipError } from './sessionErrors.js'
import type { JsonObject, SessionEvent } from './sessionEvents.js'
import { SessionRuntime } from './sessionRuntime.js'
import type { SessionStore, StoredSession } from './sessionStore.js'

const DEFAULT_LEASE_TTL_MS = 30_000

export type SessionSupervisorOptions = {
    holderId: string
    store: SessionStore
    agent: AgentService
    modelConfigs: ModelConfigProvider
    logger: Logger
    leaseTtlMs?: number
}

export type SessionReady = {
    sessionId: string
    lastSeq: number
    events: SessionEvent[]
}

export type RunTurnInput = {
    sessionId: string
    ownerId: string
    turnId: string
    connectionId: string
    input: string
    metadata?: JsonObject
}

export class SessionSupervisor {
    private readonly runtimes = new Map<string, SessionRuntime>()
    private readonly leaseTtlMs: number

    constructor(private readonly options: SessionSupervisorOptions) {
        this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS
    }

    async createSession(ownerId: string): Promise<SessionReady> {
        const sessionId = createSessionId()
        const now = new Date().toISOString()
        const stored = await this.options.store.createSession({
            sessionId,
            ownerId,
            now,
        })
        await this.acquireLease(sessionId)
        this.runtimes.set(sessionId, this.createRuntime(stored))

        const event = await this.options.store.appendEvent({
            type: 'session.created',
            sessionId,
            ownerId,
        })

        return {
            sessionId,
            lastSeq: event.seq,
            events: [event],
        }
    }

    async attachSession(input: {
        sessionId: string
        ownerId: string
        lastSeq: number
    }): Promise<SessionReady> {
        await this.getOrLoadRuntime(input.sessionId, input.ownerId)
        const stored = await this.options.store.loadSession(input.sessionId)
        const events = await this.options.store.readEventsAfter(input.sessionId, input.lastSeq)
        const lastSeq = events.at(-1)?.seq ?? stored.state.latestSeq

        return {
            sessionId: input.sessionId,
            lastSeq,
            events,
        }
    }

    async *runTurn(input: RunTurnInput): AsyncGenerator<SessionEvent> {
        const runtime = await this.getOrLoadRuntime(input.sessionId, input.ownerId)
        await this.acquireLease(input.sessionId)

        yield* runtime.runTurn({
            turnId: input.turnId,
            connectionId: input.connectionId,
            input: input.input,
            metadata: input.metadata,
        })
    }

    async cancelTurn(input: {
        sessionId: string
        ownerId: string
        turnId: string
        reason?: string
    }): Promise<SessionEvent> {
        const runtime = await this.getOrLoadRuntime(input.sessionId, input.ownerId)
        await this.acquireLease(input.sessionId)
        return runtime.cancelTurn(input.turnId, input.reason)
    }

    private async getOrLoadRuntime(sessionId: string, ownerId: string): Promise<SessionRuntime> {
        const existing = this.runtimes.get(sessionId)
        if (existing) {
            await this.assertOwner(sessionId, ownerId)
            return existing
        }

        const stored = await this.options.store.loadSession(sessionId)
        assertStoredOwner(stored, ownerId)
        await this.acquireLease(sessionId)

        const runtime = this.createRuntime(stored)
        this.runtimes.set(sessionId, runtime)
        this.options.logger.info('Session runtime loaded', {
            sessionId,
            ownerId,
        })
        return runtime
    }

    private createRuntime(stored: StoredSession): SessionRuntime {
        return new SessionRuntime({
            sessionId: stored.manifest.sessionId,
            ownerId: stored.manifest.ownerId,
            store: this.options.store,
            agent: this.options.agent,
            modelConfigs: this.options.modelConfigs,
        })
    }

    private async assertOwner(sessionId: string, ownerId: string): Promise<void> {
        const stored = await this.options.store.loadSession(sessionId)
        assertStoredOwner(stored, ownerId)
    }

    private acquireLease(sessionId: string) {
        return this.options.store.acquireLease({
            sessionId,
            holderId: this.options.holderId,
            ttlMs: this.leaseTtlMs,
            now: new Date().toISOString(),
        })
    }
}

function assertStoredOwner(stored: StoredSession, ownerId: string): void {
    if (stored.manifest.ownerId !== ownerId) {
        throw new SessionOwnershipError(stored.manifest.sessionId)
    }
}
