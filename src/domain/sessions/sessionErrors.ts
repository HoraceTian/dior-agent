export class SessionNotFoundError extends Error {
    constructor(sessionId: string) {
        super(`Session not found: ${sessionId}`)
        this.name = 'SessionNotFoundError'
    }
}

export class SessionOwnershipError extends Error {
    constructor(sessionId: string) {
        super(`Session owner mismatch: ${sessionId}`)
        this.name = 'SessionOwnershipError'
    }
}

export class SessionLeaseConflictError extends Error {
    constructor(sessionId: string) {
        super(`Session lease is held by another runtime: ${sessionId}`)
        this.name = 'SessionLeaseConflictError'
    }
}

export class SessionTurnInProgressError extends Error {
    constructor(sessionId: string) {
        super(`Session already has a running turn: ${sessionId}`)
        this.name = 'SessionTurnInProgressError'
    }
}

export class SessionTurnNotFoundError extends Error {
    constructor(turnId: string) {
        super(`Session turn not found: ${turnId}`)
        this.name = 'SessionTurnNotFoundError'
    }
}
