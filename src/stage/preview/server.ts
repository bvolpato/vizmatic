import { existsSync, statSync, watch, type FSWatcher } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { previewPage } from './page'

export interface PreviewOptions {
    file: string
    /** Port to listen on. The default is the first free port from 4310, skipping 4173. */
    port?: number
    log?: (line: string) => void
}

export interface PreviewHandle {
    url: string
    port: number
    /** Open the preview in the default browser. */
    open(): Promise<void>
    close(): Promise<void>
}

interface EsbuildMessage {
    text: string
    location?: { file: string; line: number; column: number; lineText: string } | null
}

interface EsbuildResult {
    errors: EsbuildMessage[]
    warnings: EsbuildMessage[]
    outputFiles?: { path: string; contents: Uint8Array }[]
    metafile?: { inputs: Record<string, unknown> }
}

interface EsbuildContext {
    rebuild(): Promise<EsbuildResult>
    dispose(): Promise<void>
}

interface EsbuildApi {
    context(options: Record<string, unknown>): Promise<EsbuildContext>
    build(options: Record<string, unknown>): Promise<EsbuildResult>
}

/** The port used by another local app on the developer's machine, and by Vite's preview. */
const RESERVED_PORT = 4173
const FIRST_PORT = 4310
const PORT_ATTEMPTS = 60
const REBUILD_DELAY_MS = 40

function here(): string {
    return typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
}

/** esbuild ships with tsx, so it can sit beside the package or below tsx. */
function loadEsbuild(): EsbuildApi {
    const from = createRequire(join(here(), 'noop.js'))
    try {
        return from('esbuild') as EsbuildApi
    } catch {
        const tsx = from.resolve('tsx/package.json')
        return createRequire(tsx)('esbuild') as EsbuildApi
    }
}

function findUp(start: string, target: string): string | null {
    let directory = start
    for (let depth = 0; depth < 8; depth++) {
        const candidate = join(directory, target)
        if (existsSync(candidate)) return candidate
        const parent = dirname(directory)
        if (parent === directory) return null
        directory = parent
    }
    return null
}

const TYPES: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.ttf': 'font/ttf', '.map': 'application/json' }

/** The browser engine: prebuilt in a package, or built on demand when running from source. */
async function loadEngine(esbuild: EsbuildApi): Promise<Map<string, Uint8Array>> {
    const files = new Map<string, Uint8Array>()
    const source = join(here(), '..', 'browser.ts')
    const built = findUp(here(), 'dist/stage-browser/stage.js')
    if (existsSync(source)) {
        const result = await esbuild.build({
            entryPoints: { stage: source }, bundle: true, splitting: true, format: 'esm', target: 'es2022',
            platform: 'browser', outdir: '/stage', write: false, chunkNames: '[name]-[hash]', logLevel: 'silent',
        })
        for (const file of result.outputFiles ?? []) files.set(basename(file.path), file.contents)
        return files
    }
    if (!built) throw new Error('The browser engine is missing from this package. Reinstall vizmatic.')
    const { readdir } = await import('node:fs/promises')
    for (const name of await readdir(dirname(built))) {
        if (extname(name) === '.js') files.set(name, await readFile(join(dirname(built), name)))
    }
    return files
}

function formatBuildError(file: string, errors: readonly EsbuildMessage[]): string {
    return errors.map((error) => {
        if (!error.location) return error.text
        const { file: at, line, column, lineText } = error.location
        const caret = `${' '.repeat(column)}^`
        return `${at}:${line}:${column + 1}: ${error.text}\n\n    ${lineText}\n    ${caret}`
    }).join('\n\n') || `Could not build ${file}.`
}

function listen(server: Server, port: number): Promise<number> {
    return new Promise((done, fail) => {
        const onError = (error: NodeJS.ErrnoException) => fail(error)
        server.once('error', onError)
        server.listen(port, '127.0.0.1', () => {
            server.removeListener('error', onError)
            const address = server.address()
            done(typeof address === 'object' && address ? address.port : port)
        })
    })
}

async function bindPort(server: Server, requested?: number): Promise<number> {
    if (requested !== undefined) {
        const bound = await listen(server, requested)
        if (requested === 0 && bound === RESERVED_PORT) {
            await new Promise((done) => server.close(done))
            return bindPort(server, 0)
        }
        return bound
    }
    for (let port = FIRST_PORT; port < FIRST_PORT + PORT_ATTEMPTS; port++) {
        if (port === RESERVED_PORT) continue
        try {
            return await listen(server, port)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
        }
    }
    throw new Error(`No free port from ${FIRST_PORT}. Pass one with --port.`)
}

/** Serve a live preview of a film. Saving any file it imports rebuilds it and keeps the playhead. */
export async function startPreview(options: PreviewOptions): Promise<PreviewHandle> {
    const file = resolve(options.file)
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Film file not found: ${options.file}`)
    const log = options.log ?? (() => {})
    const esbuild = loadEsbuild()
    const engine = await loadEngine(esbuild)
    const fonts = findUp(here(), 'assets/fonts')
    if (!fonts) throw new Error('Bundled fonts are missing from this package. Reinstall vizmatic.')

    const clients = new Set<ServerResponse>()
    let version = 0
    let bundle: Uint8Array | null = null
    let lastError: string | null = null

    const send = (client: ServerResponse, event: string, data: unknown) => {
        client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    const broadcast = (event: string, data: unknown) => {
        for (const client of clients) send(client, event, data)
    }

    const context = await esbuild.context({
        entryPoints: [file],
        bundle: true,
        format: 'esm',
        target: 'es2022',
        platform: 'browser',
        write: false,
        metafile: true,
        outfile: '/film.js',
        sourcemap: 'inline',
        logLevel: 'silent',
        jsx: 'automatic',
        plugins: [{
            name: 'vizmatic-preview',
            setup(build: { onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => unknown) => void }) {
                // Films share the page's engine, because the engine's clock is module state.
                build.onResolve({ filter: /^vizmatic\/stage$/ }, () => ({ path: '/stage/stage.js', external: true }))
                build.onResolve({ filter: /^vizmatic(\/stage\/export)?$/ }, (args) => ({
                    errors: [{ text: `A film preview runs in the browser, so it can only import "vizmatic/stage", not "${args.path}".` }],
                }))
            },
        }],
    })

    const directories = new Map<string, FSWatcher>()
    let inputs = new Set<string>([file])
    const syncWatchers = () => {
        for (const input of inputs) {
            const directory = dirname(input)
            if (directories.has(directory)) continue
            directories.set(directory, watch(directory, (_event, name) => {
                // Editors often save by replacing the file, so watch folders and match by name.
                if (name && inputs.has(join(directory, name.toString()))) schedule()
            }))
        }
    }

    let timer: NodeJS.Timeout | null = null
    let building = false
    let queued = false
    const schedule = () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => void rebuild(), REBUILD_DELAY_MS)
    }

    const rebuild = async (): Promise<void> => {
        if (building) {
            queued = true
            return
        }
        building = true
        const started = performance.now()
        try {
            const result = await context.rebuild().catch((error: { errors?: EsbuildMessage[]; message?: string }) => ({
                errors: error.errors ?? [{ text: error.message ?? String(error) }], warnings: [],
                outputFiles: undefined, metafile: undefined,
            } as EsbuildResult))
            if (result.errors.length > 0) {
                lastError = formatBuildError(relative(process.cwd(), file), result.errors)
                log(`Build failed:\n${lastError}`)
                broadcast('build-error', { message: lastError })
                return
            }
            lastError = null
            bundle = result.outputFiles?.find((output) => output.path.endsWith('film.js'))?.contents ?? result.outputFiles?.[0]?.contents ?? null
            if (result.metafile) {
                const cwd = process.cwd()
                inputs = new Set(Object.keys(result.metafile.inputs)
                    .filter((input) => !input.includes('node_modules'))
                    .map((input) => resolve(cwd, input)))
                inputs.add(file)
                syncWatchers()
            }
            version += 1
            log(`Built ${relative(process.cwd(), file)} in ${Math.round(performance.now() - started)} ms`)
            broadcast('build', { version })
        } finally {
            building = false
            if (queued) {
                queued = false
                void rebuild()
            }
        }
    }

    const respond = (response: ServerResponse, status: number, type: string, body: string | Uint8Array) => {
        response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
        response.end(body)
    }

    const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        // Only pages on this machine may talk to the server, which protects against DNS rebinding.
        const host = (request.headers.host ?? '').replace(/:\d+$/, '')
        if (host !== '127.0.0.1' && host !== 'localhost') {
            respond(response, 403, 'text/plain; charset=utf-8', 'Forbidden')
            return
        }
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const path = url.pathname
        if (path === '/') {
            respond(response, 200, 'text/html; charset=utf-8', previewPage(basename(file)))
        } else if (path === '/events') {
            response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
            clients.add(response)
            request.on('close', () => clients.delete(response))
            if (lastError) send(response, 'build-error', { message: lastError })
            else if (bundle) send(response, 'build', { version })
        } else if (path === '/film.js') {
            if (bundle) respond(response, 200, TYPES['.js']!, bundle)
            else respond(response, 503, 'text/plain; charset=utf-8', lastError ?? 'The film has not been built yet.')
        } else if (path.includes('/assets/fonts/')) {
            const name = basename(path)
            const bytes = await readFile(join(fonts, name)).catch(() => null)
            if (bytes) respond(response, 200, TYPES['.ttf']!, bytes)
            else respond(response, 404, 'text/plain; charset=utf-8', `Font not found: ${name}`)
        } else if (path.startsWith('/stage/')) {
            const bytes = engine.get(basename(path))
            if (bytes) respond(response, 200, TYPES['.js']!, bytes)
            else respond(response, 404, 'text/plain; charset=utf-8', `Not found: ${path}`)
        } else if (path === '/log' && request.method === 'POST') {
            const chunks: Buffer[] = []
            for await (const chunk of request) chunks.push(chunk as Buffer)
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { kind?: string; message?: unknown }
            if (body.kind === 'error') log(`Film error:\n${String(body.message)}`)
            else if (body.kind === 'compiled') {
                const info = body.message as { ms: number; errors: number; warnings: number; duration: number }
                const issues = info.errors + info.warnings > 0 ? `, check found ${info.errors} error(s) and ${info.warnings} warning(s)` : ''
                log(`Compiled in the browser in ${info.ms} ms (${info.duration.toFixed(1)}s long${issues})`)
            }
            respond(response, 204, 'text/plain; charset=utf-8', '')
        } else {
            respond(response, 404, 'text/plain; charset=utf-8', 'Not found')
        }
    }

    const server = createServer((request, response) => {
        handle(request, response).catch((error) => {
            log(`Preview server error: ${error instanceof Error ? error.message : String(error)}`)
            if (!response.headersSent) respond(response, 500, 'text/plain; charset=utf-8', 'Server error')
            else response.end()
        })
    })
    const port = await bindPort(server, options.port)
    await rebuild()
    const url = `http://127.0.0.1:${port}/`

    return {
        url,
        port,
        async open() {
            const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
            const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
            spawn(command, args, { stdio: 'ignore', detached: true }).unref()
        },
        async close() {
            if (timer) clearTimeout(timer)
            for (const watcher of directories.values()) watcher.close()
            for (const client of clients) client.end()
            clients.clear()
            await context.dispose()
            await new Promise<void>((done) => {
                server.close(() => done())
                server.closeAllConnections?.()
            })
        },
    }
}
