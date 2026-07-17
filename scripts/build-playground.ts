import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { build, type Plugin } from 'esbuild'
import { fileURLToPath } from 'url'
import { resolve } from 'path'

const outPath = 'docs/playground.js'
const workerOutPath = 'docs/playground-worker.js'
const browserRenderContext = resolve('src/playground-render-context.ts')

async function normalizeGeneratedIndentation(path: string): Promise<void> {
    const source = await readFile(path, 'utf8')
    const normalized = source.replace(/^[\t ]+/gm, (indent) => indent.replace(/\t/g, '    '))
    if (normalized !== source) await writeFile(path, normalized)
}

const browserRenderContextShim: Plugin = {
    name: 'browser-render-context-shim',
    setup(buildContext) {
        buildContext.onResolve({ filter: /^\.\.\/renderContext$/ }, (args) => {
            if (!args.importer.endsWith('/src/primitives/layout.ts')) return undefined
            return { path: browserRenderContext }
        })
    },
}

export async function buildPlayground(): Promise<void> {
    await mkdir('docs', { recursive: true })
    await rm('docs/assets/playground', { recursive: true, force: true })

    const worker = await build({
        entryPoints: {
            'playground-worker': 'src/playground-worker.ts',
        },
        bundle: true,
        format: 'iife',
        target: 'es2022',
        platform: 'browser',
        minify: true,
        outdir: 'docs',
        sourcemap: false,
        metafile: true,
        plugins: [browserRenderContextShim],
        loader: {
            '.ttf': 'file',
            '.wasm': 'file',
        },
        assetNames: 'assets/playground/[name]-[hash]',
    })

    await build({
        entryPoints: {
            playground: 'src/playground.ts',
        },
        bundle: true,
        format: 'iife',
        target: 'es2022',
        platform: 'browser',
        minify: true,
        sourcemap: false,
        outdir: 'docs',
    })

    await Promise.all([
        normalizeGeneratedIndentation(outPath),
        normalizeGeneratedIndentation(workerOutPath),
    ])

    const outputSizes = await Promise.all([
        stat(outPath),
        stat(workerOutPath),
        ...Object.keys(worker.metafile?.outputs ?? {})
            .filter((path) => path.startsWith('docs/assets/playground/'))
            .map((path) => stat(path)),
    ])
    const [main, workerFile, ...assets] = outputSizes
    const assetSize = assets.reduce((total, file) => total + file.size, 0)
    console.log(`built ${outPath} (${Math.ceil(main.size / 1024)} KiB), ${workerOutPath} (${Math.ceil(workerFile.size / 1024)} KiB), assets (${Math.ceil(assetSize / 1024)} KiB)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await buildPlayground()
}
