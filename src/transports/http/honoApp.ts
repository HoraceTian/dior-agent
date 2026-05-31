import { Hono } from 'hono'
import type { AppContext } from 'src/app/container.js'

export function createHonoHttpApp(context: AppContext): Hono {
    const app = new Hono()

    app.get('/', c =>
        c.json({
            service: context.config.serviceName,
            transport: {
                websocket: '/ws',
                health: '/health',
                ready: '/ready',
            },
        }),
    )

    app.get('/health', c =>
        c.json({
            status: 'ok',
            service: context.config.serviceName,
            time: new Date().toISOString(),
        }),
    )

    app.get('/ready', c =>
        c.json({
            status: 'ready',
            service: context.config.serviceName,
            websocket: '/ws',
            collectors: context.collectors.getSnapshot().collectors.length,
        }),
    )

    app.get('/ws', c =>
        c.json(
            {
                error: 'upgrade_required',
                message: 'Connect to this endpoint with WebSocket upgrade.',
            },
            426,
        ),
    )

    return app
}
