import { setImmediate } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GpuBrowser } from '../src/stage/gpu-browser'
import { GpuRasterizer } from '../src/stage/gpu-raster'
import { encodeGpuJob } from '../src/stage/gpu-wire'

vi.mock('../src/stage/gpu-browser', () => ({ GpuBrowser: { launch: vi.fn() } }))
vi.mock('../src/stage/display-canvas', () => ({ paintFrame: vi.fn() }))
vi.mock('../src/stage/bloom-canvas', () => ({ paintCanvasBloom: vi.fn() }))
vi.mock('../src/stage/bloom-webgl', () => ({ supportsWebGLBloom: () => true }))
vi.mock('node:fs/promises', async importOriginal => {
    const fs = await importOriginal<typeof import('node:fs/promises')>()
    return { ...fs, readFile: (...args: Parameters<typeof fs.readFile>) =>
        String(args[0]).endsWith('/gpu-renderer.js') ? Promise.resolve(Buffer.from('')) : fs.readFile(...args) }
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
    vi.resetModules()
})

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}

describe('GPU startup settlement', () => {
    it('accumulates separate bloom and readback timings from delivered frames', async () => {
        let url = ''
        vi.mocked(GpuBrowser.launch).mockResolvedValue({
            async close() {},
            async send(method: string, params?: { url: string }) {
                if (method === 'Target.createTarget') {
                    url = params!.url
                    await fetch(new URL('./ready', url), { method: 'POST' })
                }
                return { gpu: { auxAttributes: { glRenderer: 'Hardware GPU' }, featureStatus: { '2d_canvas': 'enabled' } } }
            },
        } as unknown as GpuBrowser)
        const renderer = await GpuRasterizer.create()
        try {
            for (let index = 0; index < 2; index++) {
                const pixels = renderer.run({ frames: [], width: 1, height: 1, dither: false })
                const job = await fetch(new URL('./next', url))
                await job.arrayBuffer()
                const delivered = await fetch(new URL(`./result/${job.headers.get('x-frame-id')}`, url), {
                    method: 'POST', body: Uint8Array.of(1, 2, 3, 255),
                    headers: { 'x-raster-ms': '2', 'x-bloom-ms': '3', 'x-readback-ms': '7' },
                })
                expect(delivered.ok).toBe(true)
                expect([...await pixels]).toEqual([1, 2, 3, 255])
            }
            expect(renderer).toMatchObject({ rasterMs: 4, bloomMs: 6, readbackMs: 14 })
        } finally {
            await renderer.close()
        }
    })

    it.each(['supported', 'unsupported', 'probe error'] as const)('keeps cancellation after ready when the probe is %s', async probe => {
        const controller = new AbortController()
        const close = vi.fn(async () => {})
        let url = ''
        vi.mocked(GpuBrowser.launch).mockResolvedValue({
            close,
            async send(method: string, params?: { url: string }) {
                if (method === 'Target.createTarget') {
                    url = params!.url
                    await fetch(new URL('./ready', url), { method: 'POST' })
                }
                if (method === 'SystemInfo.getInfo') {
                    controller.abort()
                    if (probe === 'probe error') throw new Error('GPU probe failed')
                    return { gpu: { auxAttributes: { glRenderer: probe === 'supported' ? 'Hardware GPU' : 'SwiftShader' }, featureStatus: { '2d_canvas': 'enabled' } } }
                }
                return {}
            },
        } as unknown as GpuBrowser)
        let renderer: GpuRasterizer | undefined, error: unknown
        try {
            try { renderer = await GpuRasterizer.create(controller.signal) } catch (caught) { error = caught }
            expect(error).toMatchObject({ name: 'AbortError', message: 'The export was aborted' })
            expect(close).toHaveBeenCalledTimes(1)
            await expect(fetch(url)).rejects.toThrow()
        } finally {
            await renderer?.close()
        }
    })

    it('preserves a browser failure reported after ready and closes the transport', async () => {
        const close = vi.fn(async () => {})
        let url = ''
        vi.mocked(GpuBrowser.launch).mockImplementation(async onFailure => ({
            close,
            async send(method: string, params?: { url: string }) {
                if (method === 'Target.createTarget') {
                    url = params!.url
                    await fetch(new URL('./ready', url), { method: 'POST' })
                }
                if (method === 'SystemInfo.getInfo') {
                    onFailure(new Error('GPU browser disconnected'))
                    return { gpu: { auxAttributes: { glRenderer: 'Hardware GPU' }, featureStatus: { '2d_canvas': 'enabled' } } }
                }
                return {}
            },
        } as unknown as GpuBrowser))
        let renderer: GpuRasterizer | undefined, error: unknown
        try {
            try { renderer = await GpuRasterizer.create() } catch (caught) { error = caught }
            expect(error).toMatchObject({ name: 'GpuUnavailableError', message: 'GPU browser disconnected' })
            expect(close).toHaveBeenCalledTimes(1)
            await expect(fetch(url)).rejects.toThrow()
        } finally {
            await renderer?.close()
        }
    })
})

async function startRuntime(upload: 'ok' | 'network error' | 'HTTP error') {
    const packet = encodeGpuJob({
        frames: [{ width: 2, height: 2, background: null, bloom: 0, dark: true, ops: [] }],
        width: 2, height: 2, dither: false,
    })
    const readback = deferred<PlaneLayout[]>(), copying = deferred<void>(), next = deferred<Response>()
    const closed = vi.fn(), errors: string[] = [], uploads: Uint8Array[] = [], headers: Headers[] = []
    let polls = 0, pollSignal: AbortSignal | null | undefined
    vi.stubGlobal('document', {
        createElement: () => ({ width: 0, height: 0, getContext: () => ({ resetTransform() {}, clearRect() {} }) }),
    })
    vi.stubGlobal('VideoFrame', class {
        copyTo(buffer: Uint8Array) { buffer.fill(23); copying.resolve(); return readback.promise }
        close = closed
    })
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit): Promise<Response> => {
        if (url === './config') return Response.json({})
        if (url === './ready') return new Response(null)
        if (url === './error') { errors.push(String(init!.body)); return new Response(null) }
        if (url === './next') {
            if (polls++ === 0) return new Response(Uint8Array.from(packet).buffer, { headers: { 'x-frame-id': '0' } })
            pollSignal = init?.signal
            pollSignal?.addEventListener('abort', () => next.reject(pollSignal!.reason), { once: true })
            return next.promise
        }
        if (url === './result/0') {
            uploads.push(init!.body as Uint8Array)
            headers.push(new Headers(init!.headers))
            if (upload === 'network error') throw new Error('Upload disconnected')
            return new Response(null, { status: upload === 'HTTP error' ? 503 : 200 })
        }
        throw new Error(`Unexpected GPU request: ${url}`)
    })
    await import('../src/stage/gpu-runtime')
    await copying.promise
    return {
        readback, closed, errors, uploads, headers, pollAborted: () => pollSignal?.aborted,
        async finish() {
            readback.resolve([])
            next.resolve(new Response(null, { status: 204 }))
            await setImmediate()
        },
    }
}

describe('GPU runtime final-frame delivery', () => {
    it.each([
        ['readback', 'Readback failed'],
        ['network error', 'Upload disconnected'],
        ['HTTP error', 'GPU frame delivery returned HTTP 503'],
    ] as const)('reports a %s failure without waiting for the next frame', async (failure, message) => {
        const runtime = await startRuntime(failure === 'readback' ? 'ok' : failure)
        try {
            if (failure === 'readback') runtime.readback.reject(new Error(message))
            else runtime.readback.resolve([])
            await expect.poll(() => runtime.errors, { timeout: 2000, interval: 5 }).toEqual([message])
            expect(runtime.pollAborted()).toBe(true)
            expect(runtime.closed).toHaveBeenCalledTimes(1)
            expect(runtime.uploads).toHaveLength(failure === 'readback' ? 0 : 1)
        } finally {
            await runtime.finish()
        }
    })

    it('delivers a successful readback while keeping the next poll open', async () => {
        let now = 100
        vi.spyOn(performance, 'now').mockImplementation(() => now)
        const runtime = await startRuntime('ok')
        try {
            now += 50
            runtime.readback.resolve([])
            await expect.poll(() => runtime.uploads.length, { timeout: 2000, interval: 5 }).toBe(1)
            expect([...runtime.uploads[0]]).toEqual(Array(16).fill(23))
            expect(runtime.headers[0].get('x-bloom-ms')).toBe('0')
            expect(runtime.headers[0].get('x-readback-ms')).toBe('50')
            expect(runtime.errors).toEqual([])
            expect(runtime.pollAborted()).not.toBe(true)
            expect(runtime.closed).toHaveBeenCalledTimes(1)
        } finally {
            await runtime.finish()
        }
    })
})
