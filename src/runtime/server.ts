import { type Server as NodeHttpServer, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getRequestListener } from '@hono/node-server'
import type { AppContext } from 'src/app/container.js'
import { createHonoHttpApp } from 'src/transports/http/honoApp.js'
import { attachWebSocketGateway } from 'src/transports/websocket/wsGateway.js'

export type RunningAgentServer = {
    host: string
    port: number
    stop: () => Promise<void>
}

export async function startAgentServer(context: AppContext): Promise<RunningAgentServer> {
    const httpApp = createHonoHttpApp(context)
    const server = createServer(getRequestListener(httpApp.fetch))
    const websocket = attachWebSocketGateway({ context, server })

    await listen(server, context.config.port, context.config.host)

    const address = getAddressInfo(server)

    return {
        host: context.config.host,
        port: address?.port ?? context.config.port,
        async stop() {
            await websocket.close()
            await close(server)
        },
    }
}

function listen(server: NodeHttpServer, port: number, host: string): Promise<void> {
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
            server.off('error', reject)
            resolve()
        })
    })
}

function close(server: NodeHttpServer): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(error => {
            if (error) {
                reject(error)
                return
            }
            resolve()
        })
    })
}

export function getAddressInfo(server: NodeHttpServer): AddressInfo | undefined {
    const address = server.address()
    return typeof address === 'object' && address ? address : undefined
}
