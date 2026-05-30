import { createAppContext } from 'src/app/container.js'
import { loadConfig } from 'src/config/env.js'
import { startAgentServer } from 'src/runtime/server.js'

export async function main(): Promise<void> {
    const config = loadConfig()
    const context = createAppContext({ config })
    const server = await startAgentServer(context)

    context.logger.info('Dior agent server started', {
        url: `ws://${server.host}:${server.port}/ws`,
        health: `http://${server.host}:${server.port}/health`,
    })

    const shutdown = async () => {
        context.logger.info('Dior agent server stopping')
        await server.stop()
        process.exit(0)
    }

    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
}

if (import.meta.main) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
    })
}
