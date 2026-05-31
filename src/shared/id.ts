export function createConnectionId(): string {
    return `conn_${crypto.randomUUID()}`
}

export function createSessionId(): string {
    return `sess_${crypto.randomUUID()}`
}

export function createTurnId(): string {
    return `turn_${crypto.randomUUID()}`
}
