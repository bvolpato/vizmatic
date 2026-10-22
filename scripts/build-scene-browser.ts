import { build, type Plugin } from 'esbuild'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)

const sceneBrowserAdapters: Plugin = {
    name: 'scene-browser-adapters',
    setup(context) {
        context.onResolve({ filter: /^quickjs-emscripten$/ }, ({ importer }) => {
            if (importer.endsWith('/src/scene-runtime.ts')) return { path: resolve('src/scene-browser-quickjs.ts') }
            if (importer.endsWith('/src/scene-browser-quickjs.ts')) return { path: 'release-sync', namespace: 'scene-quickjs' }
            return undefined
        })
        context.onLoad({ filter: /.*/, namespace: 'scene-quickjs' }, () => ({
            // The general entry imports debug and async variants as well. Only the
            // release synchronous variant belongs in this bounded browser runtime.
            contents: "export {newQuickJSWASMModuleFromVariant as newQuickJSWASMModule,newVariant} from 'quickjs-emscripten-core'; export {default as RELEASE_SYNC} from '@jitl/quickjs-wasmfile-release-sync';",
            resolveDir: dirname(require.resolve('quickjs-emscripten')),
            loader: 'js',
        }))
        context.onResolve({ filter: /^\.\.\/renderContext$/ }, ({ importer }) => {
            if (importer.endsWith('/src/primitives/layout.ts')) return { path: resolve('src/playground-render-context.ts') }
            return undefined
        })
    },
}

await rm('dist/scene-browser-chunks', { recursive: true, force: true })
await build({
    entryPoints: ['src/scene-browser.ts'],
    outdir: 'dist',
    entryNames: '[name]',
    chunkNames: 'scene-browser-chunks/[name]-[hash]',
    splitting: true,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [sceneBrowserAdapters],
})
