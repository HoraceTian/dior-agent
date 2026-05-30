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
import type { RawData, WebSocket } from 'ws'

export type AgentWebSocketSessionOptions = {
    context: AppContext
    connectionId: string
    principal: AuthPrincipal
    ws: WebSocket
}

export class AgentWebSocketSession {
    private readonly connectedAt = Date.now()
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

        await this.handleAgentMessage(message)
    }

    private handlePing(message: Extract<ClientMessage, { type: 'ping' }>): void {
        this.send({
            type: 'pong',
            ...(message.id ? { id: message.id } : {}),
            serverTime: new Date().toISOString(),
        })
    }

    private async handleAgentMessage(
        message: Extract<ClientMessage, { type: 'agent.message' }>,
    ): Promise<void> {
        this.send({
            type: 'agent.message.received',
            id: message.id,
        })

        try {
            const result = await this.options.context.agent.handleTurn({
                id: message.id,
                connectionId: this.options.connectionId,
                input: message.input,
                metadata: message.metadata,
            })
            this.send({
                type: 'agent.message.result',
                id: message.id,
                output: result.output,
                ...(result.metadata ? { metadata: result.metadata } : {}),
            })
        } catch (error) {
            this.options.context.logger.error('Agent turn failed', {
                connectionId: this.options.connectionId,
                error: error instanceof Error ? error.message : String(error),
            })
            this.send({
                type: 'error',
                id: message.id,
                code: 'agent_error',
                message: 'Agent turn failed.',
            })
        }
    }

    private sendError(code: ProtocolErrorCode, message: string): void {
        this.send({
            type: 'error',
            code,
            message,
        })
    }

    private send(message: ServerMessage): void {
        this.options.ws.send(serializeServerMessage(message))
    }
}
