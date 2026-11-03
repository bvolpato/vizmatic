import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'

const out = 'dist/stage-browser'

/** Build the browser engine into the package: one entry, with math split into a lazy chunk. */
await mkdir(out, { recursive: true })
await build({
    entryPoints: { stage: 'src/stage/browser.ts' },
    bundle: true,
    splitting: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    outdir: out,
    minify: true,
    chunkNames: '[name]-[hash]',
    // Bundled fonts are at the package root, two folders above this output.
    define: { __VIZMATIC_ASSET_PATH__: JSON.stringify('../../assets/') },
    logLevel: 'warning',
})
console.log(`Built the browser engine into ${out}`)
