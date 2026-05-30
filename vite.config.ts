import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Plugin, defineConfig } from 'vite'

const projectRoot = dirname(fileURLToPath(import.meta.url))

function bunStyleTsResolver(): Plugin {
    return {
        name: 'bun-style-ts-resolver',
        resolveId(id, importer) {
            if (!id.endsWith('.js') || (!id.startsWith('.') && !id.startsWith('src/'))) {
                return null
            }

            const withoutJs = id.slice(0, -3)
            const baseDir = id.startsWith('src/')
                ? projectRoot
                : importer
                  ? dirname(importer)
                  : projectRoot
            const candidates = [
                `${resolve(baseDir, withoutJs)}.ts`,
                `${resolve(baseDir, withoutJs)}.tsx`,
            ]

            for (const candidate of candidates) {
                if (existsSync(candidate)) return candidate
            }

            return null
        },
    }
}

export default defineConfig({
    appType: 'custom',
    plugins: [bunStyleTsResolver()],
    ssr: {
        target: 'node',
        external: ['@hono/node-server', 'express', 'hono', 'ws', 'zod'],
    },
    build: {
        emptyOutDir: true,
        outDir: 'dist-vite',
        target: 'es2020',
        copyPublicDir: false,
        sourcemap: true,
        minify: false,
        ssr: resolve(projectRoot, 'src/entrypoints/server.ts'),
        rollupOptions: {
            output: {
                format: 'es',
                entryFileNames: 'server-vite.js',
            },
        },
    },
    resolve: {
        alias: {
            'src/': resolve(projectRoot, 'src/'),
        },
    },
})
