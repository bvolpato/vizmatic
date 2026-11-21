import { paintFrame } from './display-canvas'
import { paintCanvasBloom, type CanvasBloom } from './bloom-canvas'
import { supportsWebGLBloom, WebGLSubframeAccumulator } from './bloom-webgl'
import { decodeGpuJob, type GpuFrameJob } from './gpu-wire'
import type { StageImage } from './node'
import { isSuspend, type CompiledFilm, type CompileOverrides } from './stage'
import type * as Engine from './browser'

const canvas = document.createElement('canvas')
const context = canvas.getContext('2d', { willReadFrequently: false })!
const accumulated = document.createElement('canvas')
const average = accumulated.getContext('2d', { willReadFrequently: false })!
let floatAccum: WebGLSubframeAccumulator | null = null
const images = new Map<string, ImageBitmap>()
let bloom: CanvasBloom | null = null
let film: CompiledFilm | undefined

interface FilmSource { overrides: CompileOverrides; expected: Record<string, unknown> }

async function prepareFilm(source: FilmSource): Promise<CompiledFilm> {
    const engineUrl = new URL('./engine/stage.js', location.href).href
    const filmUrl = new URL('./film.js', location.href).href
    const engine = await import(engineUrl) as typeof Engine
    engine.setAssetBase(new URL('./assets/', location.href).href)
    const module = await import(filmUrl)
    const definition = [module.default, module.default?.default, module.film].find(engine.isFilm)
    if (!definition) throw new Error('The GPU source module does not export a film')
    const compiled = await engine.compileFilm(definition, source.overrides)
    for (const [key, value] of Object.entries(source.expected)) {
        if (compiled[key as keyof CompiledFilm] !== value) throw new Error(`GPU film metadata differs from the CPU film: ${key}`)
    }
    return compiled
}

async function sample(time: number) {
    if (!film) throw new Error('No film was loaded in the GPU renderer')
    for (;;) {
        try { return film.frame(time) } catch (error) {
            if (!isSuspend(error)) throw error
            await error.promise
        }
    }
}

async function prepareImages(job: GpuFrameJob): Promise<void> {
    for (const frame of job.frames) for (const op of frame.ops) {
        if (op.kind !== 'image' || op.image.pixels) continue
        const source = op.image.asset?.src ?? op.image.src
        if (images.has(source)) continue
        if (!/^data:image\/(png|jpeg|gif);base64,/.test(source)) throw new Error('GPU image assets must contain embedded image bytes')
        const response = await fetch(source)
        images.set(source, await createImageBitmap(await response.blob()))
    }
}

function lookup(image: StageImage): CanvasImageSource | null {
    return images.get(image.asset?.src ?? image.src) ?? null
}

async function paint(job: GpuFrameJob): Promise<{ pixels: Promise<Uint8Array<ArrayBuffer>>; rasterMs: number; bloomMs: number; readbackStarted: number }> {
    const { width, height, frames, dither } = job
    if (!frames.length) throw new Error('A GPU frame needs at least one sample')
    if (!supportsWebGLBloom(canvas)) throw new Error('The GPU rendering context was lost')
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = accumulated.width = width
        canvas.height = accumulated.height = height
        bloom = null
    }
    await prepareImages(job)
    const started = performance.now()
    let usedFloatAccum = false
    if (frames.length > 1) {
        if (!floatAccum && typeof WebGLSubframeAccumulator === 'function') floatAccum = new WebGLSubframeAccumulator()
        if (floatAccum?.begin(canvas)) {
            usedFloatAccum = true
            for (let i = 0; i < frames.length; i++) {
                paintFrame(context, frames[i], width / frames[i].width, lookup)
                if (!floatAccum.add(canvas)) { usedFloatAccum = false; break }
            }
            if (usedFloatAccum && !floatAccum.resolveTo(average)) usedFloatAccum = false
        }
    }
    if (!usedFloatAccum) {
        average.resetTransform()
        average.globalAlpha = 1
        average.globalCompositeOperation = 'source-over'
        average.clearRect(0, 0, width, height)
        for (let i = 0; i < frames.length; i++) {
            paintFrame(context, frames[i], width / frames[i].width, lookup)
            if (frames.length === 1) continue
            if (i === 0) {
                average.globalCompositeOperation = 'copy'
                average.drawImage(canvas, 0, 0)
            } else {
                average.globalCompositeOperation = 'destination-in'
                average.globalAlpha = i / (i + 1)
                average.fillRect(0, 0, width, height)
                average.globalCompositeOperation = 'lighter'
                average.globalAlpha = 1 / (i + 1)
                average.drawImage(canvas, 0, 0)
            }
        }
        average.globalAlpha = 1
        average.globalCompositeOperation = 'source-over'
    }
    const target = frames.length === 1 ? canvas : accumulated
    const ctx = frames.length === 1 ? context : average
    const rasterMs = performance.now() - started
    const bloomStart = performance.now()
    const last = frames[frames.length - 1]
    if (last.dark && last.bloom > 0) bloom = paintCanvasBloom(target, ctx, last.bloom, last.background, bloom, dither)
    const bloomMs = performance.now() - bloomStart
    // Raw RGBA goes through the same FFmpeg color conversion and quality settings as CPU export.
    const readbackStarted = performance.now()
    const snapshot = new VideoFrame(target, { timestamp: 0 })
    const buffer = new Uint8Array(width * height * 4)
    const pixels = snapshot.copyTo(buffer, { format: 'RGBA', colorSpace: 'srgb' }).then(() => buffer).finally(() => snapshot.close())
    pixels.catch(() => {})
    // Keep only assets used by this frame. Generated pixel canvases use the painter's WeakMap.
    const used = new Set(frames.flatMap(frame => frame.ops.flatMap(op => op.kind === 'image' && !op.image.pixels ? [op.image.asset?.src ?? op.image.src] : [])))
    for (const [source, bitmap] of images) if (!used.has(source)) { bitmap.close(); images.delete(source) }
    return { pixels, rasterMs, bloomMs, readbackStarted }
}

async function run(): Promise<void> {
    if (!context || !average || !supportsWebGLBloom(canvas)) throw new Error('Hardware Canvas/WebGL bloom is unavailable')
    const { source } = await (await fetch('./config')).json() as { source?: FilmSource }
    // Node can prepare display frames when the browser cannot load the film or its local assets.
    if (source) film = await prepareFilm(source).catch(() => undefined)
    await fetch('./ready', { method: 'POST', headers: { 'x-film-source': film ? 'ready' : 'frames' } })
    const transport = new AbortController()
    const { signal } = transport
    try {
        let next = fetch('./next', { signal })
        const pending: Promise<void>[] = []
        for (;;) {
            const response = await next
            if (response.status === 204) { await Promise.all(pending); return }
            if (!response.ok) throw new Error(`GPU frame transport returned HTTP ${response.status}`)
            const id = response.headers.get('x-frame-id')!
            const decoded = decodeGpuJob(await response.arrayBuffer())
            next = fetch('./next', { signal })
            next.catch(() => {})
            const job: GpuFrameJob = 'times' in decoded ? { ...decoded, frames: await Promise.all(decoded.times.map(sample)) } : decoded
            const { pixels, rasterMs, bloomMs, readbackStarted } = await paint(job)
            const sent = pixels.then(async buffer => {
                const result = await fetch(`./result/${id}`, {
                    method: 'POST', body: buffer, signal,
                    headers: { 'x-raster-ms': String(rasterMs), 'x-bloom-ms': String(bloomMs), 'x-readback-ms': String(performance.now() - readbackStarted) },
                })
                if (!result.ok) throw new Error(`GPU frame delivery returned HTTP ${result.status}`)
            })
            sent.catch(error => transport.abort(error))
            pending.push(sent)
            if (pending.length >= 2) await pending.shift()
        }
    } catch (error) {
        throw signal.aborted ? signal.reason : error
    } finally {
        transport.abort()
    }
}

void run().catch(async error => {
    await fetch('./error', { method: 'POST', body: String(error?.message ?? error).slice(0, 2048) }).catch(() => {})
})
