import { chmod, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const outdir = 'dist'

await rm(outdir, { recursive: true, force: true })

const result = await Bun.build({
    entrypoints: ['src/entrypoints/server.ts'],
    outdir,
    target: 'bun',
    format: 'esm',
    splitting: true,
    sourcemap: 'linked',
    minify: false,
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
})

if (!result.success) {
    console.error('Build failed:')
    for (const log of result.logs) {
        console.error(log)
    }
    process.exit(1)
}

const launcher = join(outdir, 'server-bun.js')
await writeFile(launcher, '#!/usr/bin/env bun\nimport "./server.js"\n')
await chmod(launcher, 0o755)

console.log(`Bundled ${result.outputs.length} files to ${outdir}/`)
console.log(`Generated ${launcher}`)
