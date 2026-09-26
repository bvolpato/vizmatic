import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { build, type Plugin } from 'esbuild'
import ts from 'typescript'
import { fileURLToPath } from 'url'
import { resolve } from 'path'

const outPath = 'docs/playground.js'
const redirectOutPath = 'docs/playground-redirect.js'
const workerOutPath = 'docs/playground-worker.js'
const browserRenderContext = resolve('src/playground-render-context.ts')
const browserHarfbuzz = resolve('src/playground-harfbuzz.ts')

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

const browserHarfbuzzLoader: Plugin = {
    name: 'browser-harfbuzz-loader',
    setup(buildContext) {
        buildContext.onResolve({ filter: /^harfbuzzjs$/ }, () => ({ path: browserHarfbuzz }))
        buildContext.onLoad({ filter: /[/\\]harfbuzzjs[/\\]hb\.js$/ }, async ({ path }) => {
            const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
            let nodeBranches = 0
            // Emscripten includes a Node fs loader even in its browser-capable build.
            const browserOnly: ts.TransformerFactory<ts.SourceFile> = (context) => {
                const visit: ts.Visitor = (node) => {
                    if (ts.isIfStatement(node) && ts.isIdentifier(node.expression) && node.expression.text === 'ENVIRONMENT_IS_NODE') {
                        nodeBranches += 1
                        return context.factory.updateIfStatement(node, context.factory.createFalse(), node.thenStatement, node.elseStatement)
                    }
                    return ts.visitEachChild(node, visit, context)
                }
                return (file) => ts.visitEachChild(file, visit, context)
            }
            const transformed = ts.transform(source, [browserOnly])
            try {
                if (nodeBranches !== 1) throw new Error('HarfBuzz browser loader changed; review its environment branches.')
                return { contents: ts.createPrinter().printFile(transformed.transformed[0]), loader: 'js' }
            } finally {
                transformed.dispose()
            }
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
        plugins: [browserRenderContextShim, browserHarfbuzzLoader],
        loader: {
            '.ttf': 'file',
            '.wasm': 'file',
        },
        assetNames: 'assets/playground/[name]-[hash]',
    })

    await build({
        entryPoints: {
            playground: 'src/playground.ts',
            'playground-redirect': 'src/playground-redirect.ts',
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
        normalizeGeneratedIndentation(redirectOutPath),
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
