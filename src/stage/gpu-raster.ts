import { randomBytes } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GpuBrowser } from './gpu-browser'
import { encodeGpuJob, type GpuJob } from './gpu-wire'
import { bundleGpuFilm, type GpuFilmSource } from './gpu-source'

export class GpuUnavailableError extends Error {
    constructor(message: string) { super(message); this.name = 'GpuUnavailableError' }
}

interface Pending {
    id: number
    packet: Uint8Array
    bytes: number
    resolve: (pixels: Uint8Array) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
}

async function runtimePath(): Promise<string> {
    let directory = dirname(import.meta.url ? fileURLToPath(import.meta.url) : __filename)
    for (let depth = 0; depth < 5; depth++) {
        for (const path of [join(directory, 'stage-browser', 'gpu-renderer.js'), join(directory, 'dist', 'stage-browser', 'gpu-renderer.js')]) {
            try { await readFile(path); return path } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            }
        }
        directory = dirname(directory)
    }
    throw new GpuUnavailableError('The GPU renderer bundle is missing. Rebuild or reinstall Vizmatic.')
}

async function body(request: IncomingMessage, maximum: number): Promise<Buffer> {
    const chunks: Buffer[] = []
    let length = 0
    for await (const chunk of request) {
        length += chunk.length
        if (length > maximum) throw new GpuUnavailableError('GPU frame delivery exceeded its expected size')
        chunks.push(chunk)
    }
    return Buffer.concat(chunks, length)
}

/** One hardware Canvas/WebGL worker. Binary frames stay on an authenticated loopback connection. */
export class GpuRasterizer {
    device = ''
    usesFilmSource = false
    rasterMs = 0
    bloomMs = 0
    readbackMs = 0
    private readonly token = randomBytes(24).toString('hex')
    private readonly server = createServer((req, res) => {
        void this.handle(req, res).catch(error => {
            if (!res.headersSent) res.writeHead(500).end()
            else res.destroy()
            this.fail(error instanceof GpuUnavailableError ? error : new GpuUnavailableError(String(error)))
        })
    })
    private browser: GpuBrowser | undefined
    private origin = ''
    private source: Buffer = Buffer.alloc(0)
    private readonly files = new Map<string, Uint8Array>()
    private starting = true
    private readonly pending = new Map<number, Pending>()
    private readonly queue: Pending[] = []
    private poll: ServerResponse | undefined
    private serial = 0
    private lastPixels: Uint8Array | undefined
    private lastPixelsId = -1
    private failure: Error | undefined
    private closing: Promise<void> | undefined
    private readyResolve!: () => void
    private readyReject!: (error: Error) => void
    private readonly ready = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })

    private constructor(private readonly signal?: AbortSignal, private readonly filmSource?: GpuFilmSource) {
        this.ready.catch(() => {})
        this.server.on('error', error => this.fail(error))
        signal?.addEventListener('abort', this.abort, { once: true })
    }

    static async create(signal?: AbortSignal, source?: GpuFilmSource): Promise<GpuRasterizer> {
        const renderer = new GpuRasterizer(signal, source)
        try {
            await renderer.start()
            if (renderer.failure) throw renderer.failure
            renderer.starting = false
            return renderer
        } catch (error) {
            await renderer.close()
            if (signal?.aborted) throw new DOMException('The export was aborted', 'AbortError')
            if (error instanceof Error && error.name === 'AbortError') throw error
            throw error instanceof GpuUnavailableError ? error : new GpuUnavailableError((error as Error).message)
        }
    }

    private readonly abort = () => {
        this.fail(new DOMException('The export was aborted', 'AbortError'))
        if (!this.starting) void this.close()
    }

    private async start(): Promise<void> {
        if (this.signal?.aborted) throw new DOMException('The export was aborted', 'AbortError')
        const path = await runtimePath()
        this.source = await readFile(path)
        const filmBundle = this.filmSource && await bundleGpuFilm(this.filmSource).catch(() => undefined)
        if (filmBundle) {
            this.files.set('film.js', filmBundle)
            const directory = dirname(path)
            for (const name of await readdir(directory)) if (name.endsWith('.js')) this.files.set(`engine/${name}`, await readFile(join(directory, name)))
            const fonts = join(directory, '..', '..', 'assets', 'fonts')
            for (const name of await readdir(fonts)) if (name.endsWith('.ttf')) this.files.set(`assets/fonts/${name}`, await readFile(join(fonts, name)))
        }
        if (this.failure) throw this.failure
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject)
            this.server.listen(0, '127.0.0.1', () => { this.server.removeListener('error', reject); resolve() })
        })
        const address = this.server.address()
        if (!address || typeof address === 'string') throw new GpuUnavailableError('Could not open the GPU frame transport')
        this.origin = `http://127.0.0.1:${address.port}`
        if (this.failure) throw this.failure
        this.browser = await GpuBrowser.launch(error => this.fail(new GpuUnavailableError(error.message)), this.signal)
        if (this.signal?.aborted) { await this.browser.close(); throw new DOMException('The export was aborted', 'AbortError') }
        await this.browser.send('Target.setDiscoverTargets', { discover: true })
        await this.browser.send('Target.createTarget', { url: `${this.origin}/${this.token}/` })
        const { gpu } = await this.browser.send<{ gpu: { auxAttributes?: { glRenderer?: string }; featureStatus?: Record<string, string> } }>('SystemInfo.getInfo')
        this.device = String(gpu.auxAttributes?.glRenderer ?? '')
        if (!this.device || /SwiftShader|llvmpipe|softpipe|software rasterizer|Microsoft Basic Render/i.test(this.device)
            || !String(gpu.featureStatus?.['2d_canvas']).startsWith('enabled')) {
            throw new GpuUnavailableError('The browser has no hardware-accelerated Canvas renderer')
        }
        const timer = setTimeout(() => this.fail(new GpuUnavailableError('The GPU renderer did not become ready')), 10_000)
        try { await this.ready } finally { clearTimeout(timer) }
    }

    private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        const base = `/${this.token}/`
        const origin = request.headers.origin
        if (request.headers.host !== this.origin.slice(7) || (origin !== undefined && origin !== this.origin)
            || request.headers['sec-fetch-site'] === 'cross-site' || !request.url?.startsWith(base)) {
            response.writeHead(403, { Connection: 'close' }).end(); return
        }
        const route = request.url.slice(base.length)
        if (request.method === 'GET' && route === '') {
            response.setHeader('Content-Type', 'text/html')
            response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self' data:; img-src data: blob:")
            response.end('<!doctype html><title>Vizmatic GPU export</title><script type="module" src="./runtime.js"></script>')
        } else if (request.method === 'GET' && route === 'runtime.js') {
            response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(this.source)
        } else if (request.method === 'GET' && route === 'config') {
            response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ source: this.files.has('film.js') && this.filmSource && { overrides: this.filmSource.overrides, expected: this.filmSource.expected } }))
        } else if (request.method === 'GET' && this.files.has(route)) {
            response.writeHead(200, { 'Content-Type': route.endsWith('.js') ? 'text/javascript' : 'font/ttf' }).end(this.files.get(route))
        } else if (request.method === 'POST' && route === 'ready') {
            this.usesFilmSource = this.files.has('film.js') && request.headers['x-film-source'] === 'ready'
            response.end(); this.readyResolve()
        } else if (request.method === 'GET' && route === 'next') {
            if (this.closing || this.failure) { response.writeHead(204).end(); return }
            if (this.poll) { response.writeHead(409).end(); return }
            this.poll = response
            response.once('close', () => { if (this.poll === response) this.poll = undefined })
            this.dispatch()
        } else if (request.method === 'POST' && /^result\/\d+$/.test(route)) {
            const id = Number(route.slice(7)), job = this.pending.get(id)
            if (!job) { response.writeHead(404, { Connection: 'close' }).end(); return }
            let pixels: Uint8Array
            if (request.headers['x-frame-repeat'] === '1') {
                await body(request, 0)
                if (!this.lastPixels || this.lastPixels.byteLength !== job.bytes || this.lastPixelsId !== id - 1) {
                    throw new GpuUnavailableError('GPU frame repeat arrived out of order or before an initial frame')
                }
                pixels = this.lastPixels
                this.lastPixelsId = id
            } else {
                pixels = await body(request, job.bytes)
                if (pixels.byteLength !== job.bytes) throw new GpuUnavailableError('GPU frame delivery was truncated')
                this.lastPixels = pixels
                this.lastPixelsId = id
            }
            this.pending.delete(id); clearTimeout(job.timer)
            this.rasterMs += Number(request.headers['x-raster-ms']) || 0
            this.bloomMs += Number(request.headers['x-bloom-ms']) || 0
            this.readbackMs += Number(request.headers['x-readback-ms']) || 0
            response.end(); job.resolve(pixels)
        } else if (request.method === 'POST' && route === 'error') {
            const message = (await body(request, 8192)).toString('utf8').replace(/[\x00-\x1f\x7f]/g, ' ')
            response.end(); this.fail(new GpuUnavailableError(message))
        } else response.writeHead(404).end()
    }

    private dispatch(): void {
        if (!this.poll || !this.queue.length) return
        const response = this.poll, job = this.queue.shift()!
        this.poll = undefined
        response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'x-frame-id': String(job.id) }).end(job.packet)
    }

    run(job: GpuJob): Promise<Uint8Array> {
        if (this.failure) return Promise.reject(this.failure)
        if (this.closing) return Promise.reject(new GpuUnavailableError('The GPU renderer is closed'))
        const packet = encodeGpuJob(job), id = this.serial++
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.fail(new GpuUnavailableError('The GPU renderer timed out while painting a frame')), 30_000)
            const pending = { id, packet, bytes: job.width * job.height * 4, resolve, reject, timer }
            this.pending.set(id, pending); this.queue.push(pending); this.dispatch()
        })
    }

    private fail(error: Error): void {
        this.failure ??= error
        this.readyReject(this.failure)
        for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(this.failure) }
        this.pending.clear(); this.queue.length = 0
        this.poll?.writeHead(204).end(); this.poll = undefined
    }

    close(): Promise<void> {
        if (this.closing) return this.closing
        this.closing = (async () => {
            this.signal?.removeEventListener('abort', this.abort)
            this.fail(new GpuUnavailableError('The GPU renderer is closed'))
            await this.browser?.close().catch(() => {})
            this.server.closeAllConnections()
            if (this.server.listening) await new Promise<void>(resolve => this.server.close(() => resolve()))
        })()
        return this.closing
    }
}
