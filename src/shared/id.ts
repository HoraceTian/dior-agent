export function createConnectionId(): string {
    return `conn_${crypto.randomUUID()}`
}
