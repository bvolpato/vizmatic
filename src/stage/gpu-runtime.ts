import { paintFrame } from './display-canvas'
import { paintCanvasBloom, type CanvasBloom } from './bloom-canvas'
import { createWebGLBloomPresenter, supportsWebGLBloom, WebGLSubframeAccumulator, type WebGLBloomPresenter } from './bloom-webgl'
import { parseColor } from './color'
import type { Frame } from './display'
import type { Path } from './geometry'
import { decodeGpuJob, type GpuFrameJob } from './gpu-wire'
import type { StageImage } from './node'
import { isSuspend, type CompiledFilm, type CompileOverrides } from './stage'
import type * as Engine from './browser'

const canvas = document.createElement('canvas')
let context: CanvasRenderingContext2D
const accumulated = document.createElement('canvas')
let average: CanvasRenderingContext2D
/** The picture is painted in half floats, and the dithered write at the end is the only one that rounds. */
let float = false
const bloomCanvas = document.createElement('canvas')
let bloomPresenter: WebGLBloomPresenter | null | undefined
let bloomBgKey: string | null | undefined
let bloomBgRgb: readonly number[] = [0, 0, 0]
let floatAccum: WebGLSubframeAccumulator | null = null
const images = new Map<string, ImageBitmap>()
let bloom: CanvasBloom | null = null
let film: CompiledFilm | undefined
let lastRenderedJob: { width: number; height: number; dither: boolean; frames: readonly Frame[] } | null = null

function samePaint(a: unknown, b: unknown): boolean {
    if (a === b) return true
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
        return true
    }
    const ga = a as {
        type?: string
        from?: readonly number[]
        to?: readonly number[]
        center?: readonly number[]
        radius?: number
        stops?: readonly (readonly [number, readonly number[]])[]
    }
    const gb = b as typeof ga
    if (ga.type !== gb.type || !ga.stops || !gb.stops || ga.stops.length !== gb.stops.length) return false
    if (Boolean(ga.from) !== Boolean(gb.from) || Boolean(ga.to) !== Boolean(gb.to)) return false
    if (ga.from && gb.from && (ga.from[0] !== gb.from[0] || ga.from[1] !== gb.from[1])) return false
    if (ga.to && gb.to && (ga.to[0] !== gb.to[0] || ga.to[1] !== gb.to[1])) return false
    if (Boolean(ga.center) !== Boolean(gb.center) || ga.radius !== gb.radius) return false
    if (ga.center && gb.center && (ga.center[0] !== gb.center[0] || ga.center[1] !== gb.center[1])) return false
    for (let i = 0; i < ga.stops.length; i++) {
        const sa = ga.stops[i]!, sb = gb.stops[i]!
        if (sa[0] !== sb[0] || !samePaint(sa[1], sb[1])) return false
    }
    return true
}

function samePath(a: Path, b: Path): boolean {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        const ra = a[i]!, rb = b[i]!
        if (ra.closed !== rb.closed || Boolean(ra.straight) !== Boolean(rb.straight) || ra.p.length !== rb.p.length) return false
        for (let j = 0; j < ra.p.length; j++) if (ra.p[j] !== rb.p[j]) return false
    }
    return true
}

function sameCrop(
    a?: { x: number; y: number; width: number; height: number },
    b?: { x: number; y: number; width: number; height: number },
): boolean {
    if (a === b) return true
    if (!a || !b) return false
    return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function sameClips(a?: readonly Path[], b?: readonly Path[]): boolean {
    if (a === b) return true
    if (!a || !b || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!samePath(a[i]!, b[i]!)) return false
    return true
}

function sameFrame(a: Frame, b: Frame): boolean {
    if (a === b) return true
    if (a.width !== b.width || a.height !== b.height || a.background !== b.background
        || a.bloom !== b.bloom || a.dark !== b.dark || a.ops.length !== b.ops.length) return false
    for (let i = 0; i < a.ops.length; i++) {
        const oa = a.ops[i]!, ob = b.ops[i]!
        if (oa.kind !== ob.kind) return false
        if (oa.kind === 'image' && ob.kind === 'image') {
            if (oa.image.pixels || ob.image.pixels) return false
            if (oa.alpha !== ob.alpha || oa.blend !== ob.blend || oa.dim !== ob.dim
                || !samePaint(oa.backdrop, ob.backdrop) || !sameClips(oa.clips, ob.clips)
                || !sameCrop(oa.image.crop, ob.image.crop)
                || oa.image.src !== ob.image.src || oa.image.width !== ob.image.width || oa.image.height !== ob.image.height) return false
            for (let m = 0; m < 6; m++) if (oa.matrix[m] !== ob.matrix[m]) return false
        } else if (oa.kind === 'path' && ob.kind === 'path') {
            if (oa.fillAlpha !== ob.fillAlpha || oa.strokeAlpha !== ob.strokeAlpha
                || oa.strokeWidth !== ob.strokeWidth || oa.cap !== ob.cap || oa.join !== ob.join
                || oa.dashOffset !== ob.dashOffset || oa.glow !== ob.glow || oa.blend !== ob.blend
                || !sameClips(oa.clips, ob.clips) || !samePaint(oa.fill, ob.fill)
                || !samePaint(oa.stroke, ob.stroke) || !samePaint(oa.glowColor, ob.glowColor)) return false
            if ((oa.dash?.length ?? 0) !== (ob.dash?.length ?? 0)) return false
            if (oa.dash && ob.dash) {
                for (let d = 0; d < oa.dash.length; d++) if (oa.dash[d] !== ob.dash[d]) return false
            }
            if (!samePath(oa.path, ob.path) || !samePath(oa.strokePath, ob.strokePath)) return false
        }
    }
    return true
}

function sameJobFrames(job: GpuFrameJob): boolean {
    const prev = lastRenderedJob
    if (!prev || prev.width !== job.width || prev.height !== job.height || prev.dither !== job.dither) return false
    if (prev.frames.length !== job.frames.length) return false
    for (let i = 0; i < job.frames.length; i++) if (!sameFrame(prev.frames[i]!, job.frames[i]!)) return false
    return true
}

/** A 2D context, in half floats when the export asks for them and the browser has them. */
function context2d(target: HTMLCanvasElement, wanted: boolean): CanvasRenderingContext2D | null {
    const made = target.getContext('2d', { willReadFrequently: false, ...(wanted ? { colorType: 'float16' } : {}) } as CanvasRenderingContext2DSettings)
    if (made && wanted && (made.getContextAttributes() as { colorType?: string }).colorType !== 'float16') throw new Error('this browser has no canvas in half floats')
    return made
}

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

async function paint(job: GpuFrameJob): Promise<{ repeat?: boolean; pixels: Promise<Uint8Array<ArrayBuffer>>; rasterMs: number; bloomMs: number; readbackStarted: number }> {
    const { width, height, frames, dither } = job
    if (!frames.length) throw new Error('A GPU frame needs at least one sample')
    if (sameJobFrames(job)) {
        const now = performance.now()
        return { repeat: true, pixels: Promise.resolve(new Uint8Array(0)), rasterMs: 0, bloomMs: 0, readbackStarted: now }
    }
    if (!supportsWebGLBloom(canvas)) throw new Error('The GPU rendering context was lost')
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = accumulated.width = width
        canvas.height = accumulated.height = height
        bloom = null
    }
    await prepareImages(job)
    const started = performance.now()
    let directSource: HTMLCanvasElement | null = null
    if (frames.length > 1) {
        if (!floatAccum && typeof WebGLSubframeAccumulator === 'function') floatAccum = new WebGLSubframeAccumulator(float)
        if (floatAccum?.begin(canvas)) {
            let ok = true
            for (let i = 0; i < frames.length; i++) {
                paintFrame(context, frames[i], width / frames[i].width, lookup)
                if (!floatAccum.add(canvas)) { ok = false; break }
            }
            if (ok) directSource = floatAccum.resolveCanvas()
        }
    }
    let target: HTMLCanvasElement
    let targetCtx: CanvasRenderingContext2D | null = null
    if (frames.length === 1) {
        paintFrame(context, frames[0], width / frames[0].width, lookup)
        target = canvas
        targetCtx = context
    } else if (directSource) {
        target = directSource
    } else {
        average.resetTransform()
        average.globalAlpha = 1
        average.globalCompositeOperation = 'source-over'
        average.clearRect(0, 0, width, height)
        for (let i = 0; i < frames.length; i++) {
            paintFrame(context, frames[i], width / frames[i].width, lookup)
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
        target = accumulated
        targetCtx = average
    }
    const rasterMs = performance.now() - started
    const bloomStart = performance.now()
    const last = frames[frames.length - 1]
    let outputCanvas: HTMLCanvasElement = target
    if (float || (last.dark && last.bloom > 0)) {
        if (bloomBgKey !== last.background) {
            bloomBgKey = last.background
            bloomBgRgb = parseColor(last.background ?? '#000000')
        }
        if (bloomPresenter === undefined) bloomPresenter = createWebGLBloomPresenter(bloomCanvas, undefined, float)
        // In half floats, the frame of a light look and a frame with no bloom need the dithered write too.
        if (bloomPresenter && bloomPresenter.paint(target, last.dark ? last.bloom : 0, bloomBgRgb, dither)) {
            // Direct WebGL2 bloom skips the WebGL2-to-Canvas2D drawImage roundtrip before VideoFrame capture.
            outputCanvas = bloomCanvas
        } else if (float) {
            throw new Error('the frame is too large for a write in half floats')
        } else {
            if (!targetCtx) {
                average.resetTransform()
                average.globalAlpha = 1
                average.globalCompositeOperation = 'copy'
                average.drawImage(target, 0, 0)
                target = accumulated
                targetCtx = average
            }
            bloom = paintCanvasBloom(target, targetCtx, last.bloom, last.background, bloom, dither)
            outputCanvas = target
        }
    }
    const bloomMs = performance.now() - bloomStart
    // Raw RGBA goes through the same FFmpeg color conversion and quality settings as CPU export.
    const readbackStarted = performance.now()
    const snapshot = new VideoFrame(outputCanvas, { timestamp: 0 })
    const buffer = new Uint8Array(width * height * 4)
    const pixels = snapshot.copyTo(buffer, { format: 'RGBA', colorSpace: 'srgb' }).then(() => buffer).finally(() => snapshot.close())
    pixels.catch(() => {})
    lastRenderedJob = { width, height, dither, frames }
    // Keep only assets used by this frame. Generated pixel canvases use the painter's WeakMap.
    const used = new Set(frames.flatMap(frame => frame.ops.flatMap(op => op.kind === 'image' && !op.image.pixels ? [op.image.asset?.src ?? op.image.src] : [])))
    for (const [source, bitmap] of images) if (!used.has(source)) { bitmap.close(); images.delete(source) }
    return { pixels, rasterMs, bloomMs, readbackStarted }
}

async function run(): Promise<void> {
    const { source, float: wanted } = await (await fetch('./config')).json() as { source?: FilmSource; float?: boolean }
    float = wanted === true
    const main = context2d(canvas, float), sums = context2d(accumulated, float)
    if (!main || !sums || !supportsWebGLBloom(canvas)) throw new Error('Hardware Canvas/WebGL bloom is unavailable')
    context = main
    average = sums
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
            const { repeat, pixels, rasterMs, bloomMs, readbackStarted } = await paint(job)
            // Keep pixel readback pipelined, but serialize HTTP delivery so full frames
            // never overtake each other and corrupt a subsequent x-frame-repeat snapshot.
            const prior = pending[pending.length - 1]
            const sent = pixels.then(async buffer => {
                if (prior) await prior
                const headers: Record<string, string> = {
                    'x-raster-ms': String(rasterMs),
                    'x-bloom-ms': String(bloomMs),
                    'x-readback-ms': String(repeat ? 0 : performance.now() - readbackStarted),
                }
                if (repeat) headers['x-frame-repeat'] = '1'
                const result = await fetch(`./result/${id}`, { method: 'POST', body: buffer, signal, headers })
                if (!result.ok) throw new Error(`GPU frame delivery returned HTTP ${result.status}`)
            })
            sent.catch(error => transport.abort(error))
            pending.push(sent)
            if (pending.length >= 4) await pending.shift()
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
