import type { Server as NodeHttpServer } from 'node:http'
import type { Duplex } from 'node:stream'
import type { AppContext } from 'src/app/container.js'
import type { AuthFailureReason } from 'src/domain/auth/authenticator.js'
import { createConnectionId } from 'src/shared/id.js'
import { authenticateUpgradeRequest } from 'src/transports/auth/tokenAuth.js'
import { WebSocketServer } from 'ws'
import { AgentWebSocketSession } from './wsSession.js'

export type WebSocketGateway = {
    close: () => Promise<void>
}

export function attachWebSocketGateway(options: {
    context: AppContext
    server: NodeHttpServer
}): WebSocketGateway {
    const wss = new WebSocketServer({
        noServer: true,
        maxPayload: options.context.config.maxMessageBytes,
    })

    options.server.on('upgrade', (request, socket, head) => {
        const url = createUpgradeUrl(request.url, request.headers.host)

        if (url.pathname !== '/ws') {
            rejectUpgrade(socket, 404, 'Not Found')
            return
        }

        const auth = authenticateUpgradeRequest(request, url, options.context.config)
        if (!auth.ok) {
            options.context.logger.warn('Rejected unauthorized websocket upgrade', {
                reason: auth.reason,
            })
            const rejection = getAuthRejection(auth.reason)
            rejectUpgrade(socket, rejection.statusCode, rejection.reason, rejection.headers)
            return
        }

        const connectionId = createConnectionId()
        wss.handleUpgrade(request, socket, head, ws => {
            new AgentWebSocketSession({
                context: options.context,
                connectionId,
                principal: auth.principal,
                ws,
            }).start()
        })
    })

    return {
        close: () =>
            new Promise((resolve, reject) => {
                wss.close(error => {
                    if (error) {
                        reject(error)
                        return
                    }
                    resolve()
                })
            }),
    }
}

function createUpgradeUrl(path = '/', host = 'localhost'): URL {
    return new URL(path, `http://${host}`)
}

function getAuthRejection(reason: AuthFailureReason): {
    statusCode: number
    reason: string
    headers?: Record<string, string>
} {
    if (reason === 'origin_not_allowed') {
        return { statusCode: 403, reason: 'Forbidden' }
    }

    return {
        statusCode: 401,
        reason: 'Unauthorized',
        headers: {
            'WWW-Authenticate': 'Bearer realm="dior-agent"',
        },
    }
}

function rejectUpgrade(
    socket: Duplex,
    statusCode: number,
    reason: string,
    headers: Record<string, string> = {},
): void {
    const response = [
        `HTTP/1.1 ${statusCode} ${reason}`,
        'Connection: close',
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        '',
        '',
    ].join('\r\n')

    socket.write(response)
    socket.destroy()
}
