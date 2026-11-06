import { build } from 'esbuild'
import { copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

await build({
    entryPoints: [require.resolve('satori')],
    outfile: 'dist/satori.cjs',
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    minify: true,
    external: ['fflate', 'parse-css-color'],
})
await copyFile(require.resolve('satori/layout.wasm'), 'dist/scene-layout.wasm')
