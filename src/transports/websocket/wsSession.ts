import type { AppContext } from 'src/app/container.js'
import {
    type ClientMessage,
    type ProtocolErrorCode,
    type ServerMessage,
    parseSocketMessage,
    serializeServerMessage,
    socketMessageByteLength,
} from 'src/contracts/websocket/index.js'
import type { AuthPrincipal } from 'src/domain/auth/authenticator.js'
import {
    SessionLeaseConflictError,
    SessionNotFoundError,
    SessionOwnershipError,
    SessionTurnInProgressError,
    SessionTurnNotFoundError,
} from 'src/domain/sessions/sessionErrors.js'
import type { RawData } from 'ws'
import { WebSocket } from 'ws'

export type AgentWebSocketSessionOptions = {
    context: AppContext
    connectionId: string
    principal: AuthPrincipal
    ws: WebSocket
}

export class AgentWebSocketSession {
    private readonly connectedAt = Date.now()
    private readonly attachedSessionIds = new Set<string>()
    private lastSeenAt = Date.now()

    constructor(private readonly options: AgentWebSocketSessionOptions) {}

    start(): void {
        this.options.context.logger.info('WebSocket connected', {
            connectionId: this.options.connectionId,
            principalId: this.options.principal.id,
            credentialSource: this.options.principal.credentialSource,
        })

        this.send({
            type: 'connection.ready',
            connectionId: this.options.connectionId,
            serverTime: new Date().toISOString(),
            maxMessageBytes: this.options.context.config.maxMessageBytes,
        })

        this.options.ws.on('message', raw => {
            void this.handleMessage(raw)
        })
        this.options.ws.on('close', () => {
            this.options.context.logger.info('WebSocket disconnected', {
                connectionId: this.options.connectionId,
                lifetimeMs: Date.now() - this.connectedAt,
                idleMs: Date.now() - this.lastSeenAt,
            })
        })
        this.options.ws.on('error', error => {
            this.options.context.logger.warn('WebSocket error', {
                connectionId: this.options.connectionId,
                error: error instanceof Error ? error.message : String(error),
            })
        })
    }

    private async handleMessage(raw: RawData): Promise<void> {
        this.lastSeenAt = Date.now()

        if (socketMessageByteLength(raw) > this.options.context.config.maxMessageBytes) {
            this.sendError('message_too_large', 'Message exceeds maxMessageBytes.')
            this.options.ws.close(1009, 'message too large')
            return
        }

        const parsed = parseSocketMessage(raw)
        if (!parsed.ok) {
            this.sendError(parsed.error.code, parsed.error.message)
            return
        }

        await this.handleClientMessage(parsed.message)
    }

    private async handleClientMessage(message: ClientMessage): Promise<void> {
        if (message.type === 'ping') {
            this.handlePing(message)
            return
        }

        if (message.type === 'session.create') {
            await this.handleSessionCreate(message)
            return
        }

        if (message.type === 'session.attach') {
            await this.handleSessionAttach(message)
            return
        }

        if (message.type === 'turn.start') {
            await this.handleTurnStart(message)
            return
        }

        await this.handleTurnCancel(message)
    }

    private handlePing(message: Extract<ClientMessage, { type: 'ping' }>): void {
        this.send({
            type: 'pong',
            ...(message.id ? { id: message.id } : {}),
            serverTime: new Date().toISOString(),
        })
    }

    private async handleSessionCreate(
        message: Extract<ClientMessage, { type: 'session.create' }>,
    ): Promise<void> {
        try {
            const ready = await this.options.context.sessions.createSession(
                this.options.principal.id,
            )
            this.attachedSessionIds.add(ready.sessionId)
            this.send({
                type: 'session.ready',
                ...(message.id ? { id: message.id } : {}),
                sessionId: ready.sessionId,
                lastSeq: ready.lastSeq,
                replayedEvents: ready.events.length,
            })
            for (const event of ready.events) {
                this.send({
                    type: 'session.event',
                    event,
                })
            }
        } catch (error) {
            this.handleError(error, message.id)
        }
    }

    private async handleSessionAttach(
        message: Extract<ClientMessage, { type: 'session.attach' }>,
    ): Promise<void> {
        try {
            const ready = await this.options.context.sessions.attachSession({
                sessionId: message.sessionId,
                ownerId: this.options.principal.id,
                lastSeq: message.lastSeq,
            })
            this.attachedSessionIds.add(ready.sessionId)
            this.send({
                type: 'session.ready',
                ...(message.id ? { id: message.id } : {}),
                sessionId: ready.sessionId,
                lastSeq: ready.lastSeq,
                replayedEvents: ready.events.length,
            })
            for (const event of ready.events) {
                this.send({
                    type: 'session.event',
                    event,
                })
            }
        } catch (error) {
            this.handleError(error, message.id)
        }
    }

    private async handleTurnStart(
        message: Extract<ClientMessage, { type: 'turn.start' }>,
    ): Promise<void> {
        if (!this.attachedSessionIds.has(message.sessionId)) {
            this.sendError(
                'session_not_attached',
                'Attach the session before starting a turn.',
                message.id,
            )
            return
        }

        try {
            let accepted = false
            for await (const event of this.options.context.sessions.runTurn({
                sessionId: message.sessionId,
                ownerId: this.options.principal.id,
                turnId: message.id,
                connectionId: this.options.connectionId,
                input: message.input,
                metadata: message.metadata,
            })) {
                if (!accepted) {
                    this.send({
                        type: 'turn.accepted',
                        id: message.id,
                        sessionId: message.sessionId,
                        turnId: message.id,
                    })
                    accepted = true
                }
                this.send({
                    type: 'session.event',
                    event,
                })
            }
        } catch (error) {
            this.handleError(error, message.id)
        }
    }

    private async handleTurnCancel(
        message: Extract<ClientMessage, { type: 'turn.cancel' }>,
    ): Promise<void> {
        if (!this.attachedSessionIds.has(message.sessionId)) {
            this.sendError(
                'session_not_attached',
                'Attach the session before cancelling a turn.',
                message.id,
            )
            return
        }

        try {
            const event = await this.options.context.sessions.cancelTurn({
                sessionId: message.sessionId,
                ownerId: this.options.principal.id,
                turnId: message.turnId,
                reason: message.reason,
            })
            this.send({
                type: 'session.event',
                event,
            })
        } catch (error) {
            this.handleError(error, message.id)
        }
    }

    private handleError(error: unknown, id?: string): void {
        const mapped = mapSessionError(error)
        this.options.context.logger.warn('WebSocket message failed', {
            connectionId: this.options.connectionId,
            error: error instanceof Error ? error.message : String(error),
            code: mapped.code,
        })
        this.sendError(mapped.code, mapped.message, id)
    }

    private sendError(code: ProtocolErrorCode, message: string, id?: string): void {
        this.send({
            type: 'error',
            ...(id ? { id } : {}),
            code,
            message,
        })
    }

    private send(message: ServerMessage): void {
        if (this.options.ws.readyState !== WebSocket.OPEN) return
        this.options.ws.send(serializeServerMessage(message))
    }
}

function mapSessionError(error: unknown): {
    code: ProtocolErrorCode
    message: string
} {
    if (error instanceof SessionNotFoundError) {
        return {
            code: 'session_not_found',
            message: 'Session not found.',
        }
    }

    if (error instanceof SessionOwnershipError) {
        return {
            code: 'forbidden',
            message: 'Session belongs to another principal.',
        }
    }

    if (error instanceof SessionLeaseConflictError) {
        return {
            code: 'lease_conflict',
            message: 'Session is currently owned by another runtime.',
        }
    }

    if (error instanceof SessionTurnInProgressError) {
        return {
            code: 'turn_in_progress',
            message: 'Session already has a running turn.',
        }
    }

    if (error instanceof SessionTurnNotFoundError) {
        return {
            code: 'turn_not_found',
            message: 'Turn not found.',
        }
    }

    return {
        code: 'agent_error',
        message: 'Agent turn failed.',
    }
}
