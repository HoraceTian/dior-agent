import type { JsonObject, SessionEvent, SessionEventDraft } from './sessionEvents.js'

export type SessionStatus = 'active' | 'archived'
export type TurnStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type SessionLogLevel = 'debug' | 'info' | 'warn' | 'error'

export type SessionManifest = {
    sessionId: string
    ownerId: string
    workspacePath: string
    status: SessionStatus
    createdAt: string
    updatedAt: string
}

export type SessionState = {
    sessionId: string
    ownerId: string
    status: SessionStatus
    latestSeq: number
    activeTurnId?: string
    updatedAt: string
}

export type SessionLease = {
    sessionId: string
    holderId: string
    acquiredAt: string
    heartbeatAt: string
    ttlMs: number
}

export type TurnModelRecord = {
    configVersion: number
    provider: 'ollama' | 'openai'
    baseUrl: string
    modelName: string
    apiKeyEnv?: string
}

export type TurnRecord = {
    sessionId: string
    turnId: string
    status: TurnStatus
    input: string
    metadata?: JsonObject
    model: TurnModelRecord
    startedAt: string
    completedAt?: string
    error?: string
}

export type SessionLogRecord = {
    sessionId: string
    time: string
    level: SessionLogLevel
    message: string
    fields?: JsonObject
}

export type StoredSession = {
    manifest: SessionManifest
    state: SessionState
}

export type CreateSessionInput = {
    sessionId: string
    ownerId: string
    now: string
}

export type AcquireLeaseInput = {
    sessionId: string
    holderId: string
    ttlMs: number
    now: string
}

export type SessionStore = {
    createSession: (input: CreateSessionInput) => Promise<StoredSession>
    loadSession: (sessionId: string) => Promise<StoredSession>
    acquireLease: (input: AcquireLeaseInput) => Promise<SessionLease>
    touchLease: (input: AcquireLeaseInput) => Promise<SessionLease>
    appendEvent: (event: SessionEventDraft) => Promise<SessionEvent>
    readEventsAfter: (sessionId: string, lastSeq: number) => Promise<SessionEvent[]>
    writeTurn: (record: TurnRecord) => Promise<void>
    appendLog: (record: SessionLogRecord) => Promise<void>
    getSessionDirectory?: (sessionId: string) => string
    getSessionWorkspaceDirectory?: (sessionId: string) => string
}
