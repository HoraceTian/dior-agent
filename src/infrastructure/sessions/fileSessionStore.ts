import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    SessionLeaseConflictError,
    SessionNotFoundError,
    SessionTurnNotFoundError,
} from 'src/domain/sessions/sessionErrors.js'
import { type SessionEventDraft, SessionEventSchema } from 'src/domain/sessions/sessionEvents.js'
import type {
    AcquireLeaseInput,
    CreateSessionInput,
    SessionLease,
    SessionLogRecord,
    SessionManifest,
    SessionState,
    SessionStore,
    StoredSession,
    TurnRecord,
} from 'src/domain/sessions/sessionStore.js'

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

export type FileSessionStoreOptions = {
    dataDir: string
    workspaceRoot: string
}

export class FileSessionStore implements SessionStore {
    constructor(private readonly options: FileSessionStoreOptions) {}

    async createSession(input: CreateSessionInput): Promise<StoredSession> {
        assertSafeSessionId(input.sessionId)

        const directory = this.getSessionDirectory(input.sessionId)
        const workspacePath = this.getSessionWorkspaceDirectory(input.sessionId)
        await mkdir(directory, { recursive: true })
        await Promise.all([
            mkdir(join(directory, 'snapshots'), { recursive: true }),
            mkdir(join(directory, 'turns'), { recursive: true }),
            mkdir(join(directory, 'objects', 'attachments'), { recursive: true }),
            mkdir(join(directory, 'objects', 'tool-results'), { recursive: true }),
            mkdir(join(directory, 'logs'), { recursive: true }),
            mkdir(workspacePath, { recursive: true }),
        ])

        const manifest: SessionManifest = {
            sessionId: input.sessionId,
            ownerId: input.ownerId,
            workspacePath,
            status: 'active',
            createdAt: input.now,
            updatedAt: input.now,
        }
        const state: SessionState = {
            sessionId: input.sessionId,
            ownerId: input.ownerId,
            status: 'active',
            latestSeq: 0,
            updatedAt: input.now,
        }

        await Promise.all([
            writeJsonAtomic(this.manifestPath(input.sessionId), manifest),
            writeJsonAtomic(this.statePath(input.sessionId), state),
            writeFile(this.eventsPath(input.sessionId), '', { flag: 'a' }),
        ])

        return { manifest, state }
    }

    async loadSession(sessionId: string): Promise<StoredSession> {
        assertSafeSessionId(sessionId)

        try {
            const [manifest, state] = await Promise.all([
                readJson<SessionManifest>(this.manifestPath(sessionId)),
                readJson<SessionState>(this.statePath(sessionId)),
            ])

            return { manifest, state }
        } catch (error) {
            if (isNotFound(error)) {
                throw new SessionNotFoundError(sessionId)
            }
            throw error
        }
    }

    async acquireLease(input: AcquireLeaseInput): Promise<SessionLease> {
        assertSafeSessionId(input.sessionId)
        await this.loadSession(input.sessionId)

        const existing = await readOptionalJson<SessionLease>(this.leasePath(input.sessionId))
        if (
            existing &&
            existing.holderId !== input.holderId &&
            !isLeaseExpired(existing, input.now)
        ) {
            throw new SessionLeaseConflictError(input.sessionId)
        }

        const lease: SessionLease = {
            sessionId: input.sessionId,
            holderId: input.holderId,
            ttlMs: input.ttlMs,
            acquiredAt: existing?.holderId === input.holderId ? existing.acquiredAt : input.now,
            heartbeatAt: input.now,
        }

        await writeJsonAtomic(this.leasePath(input.sessionId), lease)
        return lease
    }

    async touchLease(input: AcquireLeaseInput): Promise<SessionLease> {
        return this.acquireLease(input)
    }

    async appendEvent(event: SessionEventDraft) {
        assertSafeSessionId(event.sessionId)

        const stored = await this.loadSession(event.sessionId)
        const createdAt = new Date().toISOString()
        const fullEvent = SessionEventSchema.parse({
            ...event,
            seq: stored.state.latestSeq + 1,
            createdAt,
        })

        const handle = await open(this.eventsPath(event.sessionId), 'a')
        try {
            await handle.write(`${JSON.stringify(fullEvent)}\n`)
            await handle.sync()
        } finally {
            await handle.close()
        }

        const nextState = applyEventToState(stored.state, fullEvent, createdAt)
        const nextManifest: SessionManifest = {
            ...stored.manifest,
            updatedAt: createdAt,
        }
        await Promise.all([
            writeJsonAtomic(this.statePath(event.sessionId), nextState),
            writeJsonAtomic(this.manifestPath(event.sessionId), nextManifest),
        ])

        return fullEvent
    }

    async readEventsAfter(sessionId: string, lastSeq: number) {
        assertSafeSessionId(sessionId)
        await this.loadSession(sessionId)

        const text = await readFile(this.eventsPath(sessionId), 'utf8').catch(error => {
            if (isNotFound(error)) return ''
            throw error
        })

        return text
            .split('\n')
            .filter(Boolean)
            .map(line => SessionEventSchema.parse(JSON.parse(line)))
            .filter(event => event.seq > lastSeq)
    }

    async writeTurn(record: TurnRecord): Promise<void> {
        assertSafeSessionId(record.sessionId)
        assertSafeTurnId(record.turnId)
        await this.loadSession(record.sessionId)
        await writeJsonAtomic(this.turnPath(record.sessionId, record.turnId), record)
    }

    async appendLog(record: SessionLogRecord): Promise<void> {
        assertSafeSessionId(record.sessionId)
        await this.loadSession(record.sessionId)

        const handle = await open(this.runtimeLogPath(record.sessionId), 'a')
        try {
            await handle.write(`${JSON.stringify(record)}\n`)
            await handle.sync()
        } finally {
            await handle.close()
        }
    }

    getSessionDirectory(sessionId: string): string {
        assertSafeSessionId(sessionId)
        return join(this.options.dataDir, 'sessions', sessionId)
    }

    getSessionWorkspaceDirectory(sessionId: string): string {
        assertSafeSessionId(sessionId)
        return join(this.options.workspaceRoot, sessionId)
    }

    private manifestPath(sessionId: string): string {
        return join(this.getSessionDirectory(sessionId), 'manifest.json')
    }

    private statePath(sessionId: string): string {
        return join(this.getSessionDirectory(sessionId), 'state.json')
    }

    private leasePath(sessionId: string): string {
        return join(this.getSessionDirectory(sessionId), 'lease.json')
    }

    private eventsPath(sessionId: string): string {
        return join(this.getSessionDirectory(sessionId), 'events.jsonl')
    }

    private turnPath(sessionId: string, turnId: string): string {
        assertSafeTurnId(turnId)
        return join(this.getSessionDirectory(sessionId), 'turns', `${turnId}.json`)
    }

    private runtimeLogPath(sessionId: string): string {
        return join(this.getSessionDirectory(sessionId), 'logs', 'runtime.log')
    }
}

function applyEventToState(
    state: SessionState,
    event: ReturnType<typeof SessionEventSchema.parse>,
    updatedAt: string,
): SessionState {
    const next: SessionState = {
        ...state,
        latestSeq: event.seq,
        updatedAt,
    }

    if (event.type === 'turn.started') {
        return {
            ...next,
            activeTurnId: event.turnId,
        }
    }

    if (
        (event.type === 'turn.completed' ||
            event.type === 'turn.failed' ||
            event.type === 'turn.cancelled') &&
        next.activeTurnId === event.turnId
    ) {
        const { activeTurnId: _activeTurnId, ...withoutActiveTurn } = next
        return withoutActiveTurn
    }

    return next
}

function isLeaseExpired(lease: SessionLease, now: string): boolean {
    return Date.parse(lease.heartbeatAt) + lease.ttlMs <= Date.parse(now)
}

async function readJson<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, 'utf8')) as T
}

async function readOptionalJson<T>(path: string): Promise<T | undefined> {
    try {
        return await readJson<T>(path)
    } catch (error) {
        if (isNotFound(error)) return undefined
        throw error
    }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
    const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 4)}\n`)
    await rename(temporaryPath, path)
}

function assertSafeSessionId(sessionId: string): void {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
        throw new SessionNotFoundError(sessionId)
    }
}

function assertSafeTurnId(turnId: string): void {
    if (!SESSION_ID_PATTERN.test(turnId)) {
        throw new SessionTurnNotFoundError(turnId)
    }
}

function isNotFound(error: unknown): boolean {
    return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
