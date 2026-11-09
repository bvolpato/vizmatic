import { mkdir, stat, writeFile } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { encode as encodePng } from 'fast-png'
import * as gifenc from 'gifenc'
import { renderRgbaVideo, type RgbaVideoOutput, type VideoCodec, type VideoFrameInfo } from '../video'
import { parseColor } from './color'
import { frameToSvg, type Frame } from './display'
import { RasterPool, defaultPoolSize, framesToJob, rasterMemoBytes } from './raster'
import { CanvasRenderer, type FrameRenderer } from './canvas-raster'
import { film as defineFilm, isFilm, isSuspend, type CompiledFilm, type CompileOverrides, type FilmDefinition } from './stage'
import { text } from './text'

export type Quality = 'draft' | 'standard' | 'high' | 'master'
export type { VideoCodec } from '../video'

export interface FilmRenderOptions extends CompileOverrides {
    /** Output width in pixels. Defaults to the film's logical width. */
    width?: number
    quality?: Quality
    /** Sub-frames averaged per frame for real motion blur. 1 turns it off. */
    motionBlur?: number
    /** Fraction of the frame interval the shutter stays open. */
    shutter?: number
    workers?: number
    /** Approximate limit in bytes for frame buffers held at one time. */
    memoryBudget?: number
    from?: number
    to?: number
    /** Set to false to leave chapter markers out of an MP4. */
    chapters?: boolean
    /** Set to false to leave the caption track out of an MP4. The WebVTT sidecar is not affected. */
    embedCaptions?: boolean
    audioPath?: string
    ffmpegPath?: string
    /** Encoder threads. Rasterizing is usually the slower step, so a few are enough. */
    threads?: number
    signal?: AbortSignal
    onProgress?: (frame: VideoFrameInfo) => void | Promise<void>
}

export interface FilmVideoOutput extends RgbaVideoOutput {
    title: string
    workers: number
    motionBlur: number
    codec: VideoCodec
}

export interface FilmGifOutput {
    width: number
    height: number
    frameCount: number
    duration: number
    fps: number
    bytes: number
    outputPath: string
    title: string
}

const QUALITY: Record<Quality, { crf: number; vp9Crf: number; preset: string; motionBlur: number }> = {
    draft: { crf: 26, vp9Crf: 40, preset: 'veryfast', motionBlur: 1 },
    standard: { crf: 18, vp9Crf: 31, preset: 'medium', motionBlur: 1 },
    high: { crf: 15, vp9Crf: 24, preset: 'slow', motionBlur: 4 },
    master: { crf: 11, vp9Crf: 15, preset: 'slow', motionBlur: 8 },
}

const DEFAULT_GIF_WIDTH = 960
/** GIF delays are whole hundredths of a second, so 25 fps keeps time exactly. */
const DEFAULT_GIF_FPS = 25
const GIF_PALETTE_FRAMES = 12
const GIF_PALETTE_PIXELS = 1 << 19
const MAX_GIF_DELAY = 655_350

async function resolveFilm(film: FilmDefinition | CompiledFilm, overrides: CompileOverrides): Promise<CompiledFilm> {
    // The definition compiles itself, so this works even if a tool bundles its own engine.
    return isFilm(film) ? film.compile(overrides) : film
}

function frameAt(film: CompiledFilm, time: number): Frame | Promise<Frame> {
    try {
        return film.frame(time)
    } catch (error) {
        if (!isSuspend(error)) throw error
        return error.promise.then(() => frameAt(film, time))
    }
}

function backgroundBytes(color: string | null): readonly [number, number, number] {
    if (!color) return [0, 0, 0]
    const rgba = parseColor(color)
    return [rgba[0], rgba[1], rgba[2]]
}

/** Today's renderer: each frame as SVG text, rasterized by resvg on worker threads, with the bloom in JavaScript. */
class SvgRenderer implements FrameRenderer {
    readonly label = 'svg (resvg)'
    readonly stats = { frames: 0, svgMs: 0 }
    private readonly pool: RasterPool

    constructor(workers: number) {
        this.pool = new RasterPool(workers)
    }

    get size(): number {
        return this.pool.size
    }

    render(frames: readonly Frame[], width: number, height: number): Promise<Uint8Array> {
        const t0 = performance.now()
        const job = framesToJob(frames, width, backgroundBytes, height)
        this.stats.frames++
        this.stats.svgMs += performance.now() - t0
        return this.pool.run(job)
    }

    close(): Promise<void> {
        return this.pool.close()
    }
}

/** True when the environment asks for the canvas renderer. It is a prototype, so the default stays the SVG renderer. */
export function canvasRendererRequested(): boolean {
    const value = (process.env.VIZMATIC_RENDERER ?? '').trim().toLowerCase()
    if (value === '' || value === 'svg') return false
    if (value === 'canvas') return true
    throw new Error(`VIZMATIC_RENDERER must be "canvas" or "svg", but it is ${JSON.stringify(process.env.VIZMATIC_RENDERER)}.`)
}

/**
 * Open the renderer of the films. `workers` is the number of frames that the SVG renderer may work on at
 * one time. The canvas renderer has its own count, because a frame in flight costs it less memory.
 */
function openRenderer(workers: number, inFlight?: number): FrameRenderer {
    return canvasRendererRequested() ? new CanvasRenderer(inFlight ?? workers) : new SvgRenderer(workers)
}

/**
 * How many frames the canvas renderer may hold in flight within the memory budget. Each one holds its
 * pixels, the surface that a thread of the library draws on, and at most one more surface for a sub-frame.
 */
function canvasInFlight(width: number, height: number, options: { workers?: number; memoryBudget?: number }): number {
    const budget = options.memoryBudget ?? Math.min(2 * 1024 ** 3, totalmem() * 0.25)
    const fits = Math.max(1, Math.floor(budget * 0.75 / (width * height * 4 * 3)))
    return Math.max(1, Math.min(fits, Math.floor(options.workers ?? fits)))
}

/** Output size for an image. Height follows the film's proportions. */
function outputSize(film: CompiledFilm, requested?: number): { width: number; height: number } {
    const width = requested ?? film.width
    if (!Number.isInteger(width) || width < 2) throw new Error(`Output width must be an integer of at least 2, but received ${width}.`)
    return { width, height: Math.max(1, Math.round(width * film.height / film.width)) }
}

/** H.264 and VP9 need even dimensions, so round to the nearest even size. */
function evenSize(film: CompiledFilm, requested?: number): { width: number; height: number } {
    const { width, height } = outputSize(film, requested)
    return { width: width + (width % 2), height: Math.max(2, height + (height % 2)) }
}

function timeRange(film: CompiledFilm, options: FilmRenderOptions): { from: number; to: number } {
    const from = Math.max(0, options.from ?? 0)
    const to = Math.min(film.duration, options.to ?? film.duration)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
        throw new Error(`The render range ${from}:${to} is empty. The film is ${film.duration.toFixed(2)} seconds long.`)
    }
    return { from, to }
}

export interface RenderPlan {
    workers: number
    readAhead: number
}

/**
 * Limit how many full frames exist at once. A 4K frame is 33 MB, and a worker
 * holds more than one while it rasterizes and composites, so a fixed read-ahead
 * could use many gigabytes.
 */
export function planRender(width: number, height: number, motionBlur: number, options: { workers?: number; memoryBudget?: number } = {}): RenderPlan {
    const frameBytes = width * height * 4
    const budget = options.memoryBudget ?? Math.min(2 * 1024 ** 3, totalmem() * 0.25)
    const requested = Math.max(1, Math.floor(options.workers ?? defaultPoolSize()))
    // Measured at 4K: a worker holds about three frames without motion blur. With motion
    // blur it also holds every sub-frame until garbage collection, plus the running sum.
    // Include the private retained RGBA result and its bounded serialized key.
    const perWorker = frameBytes * (motionBlur > 1 ? motionBlur + 4 : 3) + rasterMemoBytes(width, height)
    const workers = Math.max(1, Math.min(requested, Math.floor(budget * 0.75 / perWorker)))
    const extra = Math.floor(budget * 0.25 / frameBytes)
    return { workers, readAhead: Math.max(workers + 1, Math.min(workers * 2, workers + extra)) }
}

/**
 * Rasterize frames in parallel and hand them out in order, holding only a bounded
 * number at a time. Call `next(i)` with i increasing from 0.
 */
function frameStream(
    film: CompiledFilm,
    renderer: FrameRenderer,
    timeOf: (index: number) => number,
    size: { width: number; height: number },
    count: number,
    readAhead: number,
    subframes = 1,
    shutterSpan = 0,
    times?: RenderTimes,
): (index: number) => Promise<Uint8Array> {
    const inFlight = new Map<number, Promise<Uint8Array>>()
    const submit = async (index: number): Promise<Uint8Array> => {
        const base = timeOf(index)
        const frames: Frame[] = []
        for (let sub = 0; sub < subframes; sub++) {
            const t0 = performance.now()
            const sampled = frameAt(film, base + (sub / subframes) * shutterSpan)
            if (times) times.sampleMs += performance.now() - t0
            frames.push(await sampled)
        }
        // The stream only reads the pixels, so a frame that repeats may come back as the same array.
        return renderer.render(frames, size.width, size.height, { reuse: true })
    }
    return async (index) => {
        for (let ahead = index; ahead < Math.min(count, index + readAhead); ahead++) {
            if (inFlight.has(ahead)) continue
            const job = submit(ahead)
            // The consumer awaits it later. An abort must not surface as an unhandled rejection first.
            job.catch(() => {})
            inFlight.set(ahead, job)
        }
        const t0 = performance.now()
        const pixels = await inFlight.get(index)!
        if (times) times.waitMs += performance.now() - t0
        inFlight.delete(index)
        return pixels
    }
}

/** Where a render spends its time, in milliseconds. `VIZMATIC_RENDER_STATS=1` prints it after a movie. */
interface RenderTimes {
    /** The film computes its draw lists. This runs on the main thread. */
    sampleMs: number
    /** The main thread waits for the pixels of the next frame. */
    waitMs: number
    /** The main thread waits for FFmpeg to take a frame. */
    pipeMs: number
}

function reportTimes(renderer: FrameRenderer, times: RenderTimes, frames: number, wallMs: number): void {
    if (!process.env.VIZMATIC_RENDER_STATS) return
    const round = (value: number) => Math.round(value * 10) / 10
    const stats = Object.fromEntries(Object.entries(renderer.stats ?? {}).map(([name, value]) => [name, round(value)]))
    process.stderr.write(`render stats ${JSON.stringify({
        renderer: renderer.label, inFlight: renderer.size, frames, wallMs: round(wallMs), fps: round(frames * 1000 / wallMs),
        sampleMs: round(times.sampleMs), waitForPixelsMs: round(times.waitMs), waitForEncoderMs: round(times.pipeMs), ...stats,
        // The largest memory of this process, with its worker threads. Node reports kilobytes.
        peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024),
    })}\n`)
}

/** Encode a film to H.264 MP4 or VP9 WebM. Frames rasterize in parallel and encode in order. */
/**
 * The H.264 settings that a film uses at a quality. Use them for any clip you join to a film
 * without encoding it again. Players such as QuickTime read one set of decoder settings from
 * the start of a file, and they stop decoding at a clip that uses different ones.
 */
export function filmEncoderSettings(quality: Quality = 'standard'): { crf: number; preset: string; tune: 'animation' } {
    const settings = QUALITY[quality]
    if (!settings) throw new Error(`Unknown quality: ${quality}. Use draft, standard, high, or master.`)
    return { crf: settings.crf, preset: settings.preset, tune: 'animation' }
}

export async function renderFilmVideo(
    film: FilmDefinition | CompiledFilm,
    outputPath: string,
    options: FilmRenderOptions & { codec?: VideoCodec } = {},
): Promise<FilmVideoOutput> {
    const compiled = await resolveFilm(film, options)
    const quality = QUALITY[options.quality ?? 'standard']
    if (!quality) throw new Error(`Unknown quality: ${options.quality}. Use draft, standard, high, or master.`)
    const size = evenSize(compiled, options.width)
    const motionBlur = Math.max(1, Math.floor(options.motionBlur ?? quality.motionBlur))
    const shutter = options.shutter ?? 0.5
    const fps = compiled.fps
    const codec = options.codec ?? 'h264'
    const { from, to } = timeRange(compiled, options)
    const plan = planRender(size.width, size.height, motionBlur, options)
    const renderer = openRenderer(plan.workers, canvasInFlight(size.width, size.height, options))
    try {
        const count = Math.max(1, Math.round((to - from) * fps))
        const times: RenderTimes = { sampleMs: 0, waitMs: 0, pipeMs: 0 }
        const next = frameStream(compiled, renderer, (index) => from + index / fps, size, count, readAheadOf(renderer, plan), motionBlur, shutter / fps, times)
        const started = performance.now()
        let handed = 0
        const output = await renderRgbaVideo(async (info) => {
            // The time between two requests is the time that FFmpeg took to accept the frame before.
            if (handed > 0) times.pipeMs += performance.now() - handed
            const pixels = await next(info.index)
            handed = performance.now()
            return pixels
        }, {
            width: size.width, height: size.height, fps, duration: (to - from) * 1000, outputPath,
            codec,
            crf: codec === 'vp9' ? quality.vp9Crf : quality.crf,
            preset: quality.preset,
            // Flat color and fine lines keep their edges better with this tuning.
            tune: codec === 'h264' ? filmEncoderSettings(options.quality).tune : undefined,
            threads: options.threads ?? 6,
            audioPath: options.audioPath,
            audioOffset: from > 0 ? from : undefined,
            ffmpegPath: options.ffmpegPath,
            // An MP4 carries the film's title, chapters, and captions. A range render shifts them to its own start.
            title: compiled.title,
            chapters: options.chapters === false ? [] : shiftedChapters(compiled, from),
            captions: options.embedCaptions === false ? [] : compiled.captions.map((cue) => ({ t0: cue.t0 - from, t1: cue.t1 - from, text: cue.text })),
            signal: options.signal,
            onProgress: options.onProgress,
        })
        reportTimes(renderer, times, output.frameCount, performance.now() - started)
        return { ...output, title: compiled.title, workers: renderer.size, motionBlur, codec }
    } finally {
        await renderer.close()
    }
}

/**
 * How many frames the stream starts before the encoder asks for them. The SVG renderer has a queue
 * in front of its workers. The canvas renderer has none: each frame that it starts is in flight.
 */
function readAheadOf(renderer: FrameRenderer, plan: RenderPlan): number {
    return renderer instanceof CanvasRenderer ? renderer.size : plan.readAhead
}

/** Chapters for a render that starts at `from`. The chapter already running at that moment starts the video. */
function shiftedChapters(film: CompiledFilm, from: number): { title: string; time: number }[] {
    const sorted = [...film.chapters].sort((a, b) => a.time - b.time)
    const running = sorted.filter((chapter) => chapter.time <= from).pop()
    const later = sorted.filter((chapter) => chapter.time > from).map((chapter) => ({ title: chapter.title, time: chapter.time - from }))
    return running ? [{ title: running.title, time: 0 }, ...later] : later
}

// The package format differs between bundlers, so accept both shapes.
type GifencApi = Pick<typeof gifenc, 'GIFEncoder' | 'applyPalette' | 'quantize'>
const gifApi: GifencApi = typeof gifenc.GIFEncoder === 'function' ? gifenc : (gifenc as unknown as { default: GifencApi }).default

function changedRegion(previous: Uint8Array, current: Uint8Array, width: number, height: number): { x: number; y: number; width: number; height: number } | null {
    let minX = width, minY = height, maxX = -1, maxY = -1
    for (let y = 0; y < height; y++) {
        const row = y * width * 4
        for (let x = 0; x < width; x++) {
            const o = row + x * 4
            if (previous[o] !== current[o] || previous[o + 1] !== current[o + 1] || previous[o + 2] !== current[o + 2]) {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                maxY = y
            }
        }
    }
    return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

function cropRegion(pixels: Uint8Array, canvasWidth: number, region: { x: number; y: number; width: number; height: number }): Uint8Array {
    const out = new Uint8Array(region.width * region.height * 4)
    for (let y = 0; y < region.height; y++) {
        const start = ((region.y + y) * canvasWidth + region.x) * 4
        out.set(pixels.subarray(start, start + region.width * 4), y * region.width * 4)
    }
    return out
}

/**
 * Encode a film as an optimized GIF with one shared palette. Only the changed
 * rectangle of each frame is stored. FFmpeg is not needed.
 */
export async function renderFilmGif(film: FilmDefinition | CompiledFilm, outputPath: string, options: FilmRenderOptions & { loop?: boolean } = {}): Promise<FilmGifOutput> {
    const compiled = await resolveFilm(film, { ...options, fps: undefined })
    const size = outputSize(compiled, options.width ?? Math.min(DEFAULT_GIF_WIDTH, compiled.width))
    const fps = Math.min(options.fps ?? DEFAULT_GIF_FPS, 50)
    const { from, to } = timeRange(compiled, options)
    const count = Math.max(1, Math.round((to - from) * fps))
    const delay = 1000 / fps
    const plan = planRender(size.width, size.height, 1, options)
    const renderer = openRenderer(plan.workers, canvasInFlight(size.width, size.height, options))
    try {
        // Build one palette from frames across the film, so colors do not flicker between frames.
        const sampleCount = Math.min(count, GIF_PALETTE_FRAMES)
        const samples = await Promise.all(Array.from({ length: sampleCount }, async (_, i) => {
            const index = Math.floor((i + 0.5) * count / sampleCount)
            return renderer.render([await frameAt(compiled, from + index / fps)], size.width, size.height)
        }))
        const perFrame = Math.max(1, Math.floor(GIF_PALETTE_PIXELS / sampleCount))
        const combined = new Uint8Array(perFrame * sampleCount * 4)
        samples.forEach((pixels, i) => {
            const total = pixels.length / 4
            for (let k = 0; k < perFrame; k++) {
                const at = Math.floor((k + 0.5) * total / perFrame) * 4
                combined.set(pixels.subarray(at, at + 4), (i * perFrame + k) * 4)
            }
        })
        const palette = gifApi.quantize(combined, 256, { format: 'rgb565' })
        const gif = gifApi.GIFEncoder()
        const next = frameStream(compiled, renderer, (index) => from + index / fps, size, count, readAheadOf(renderer, plan))
        const repeat = options.loop === false ? -1 : 0
        let previous: Uint8Array | null = null
        let pending: { index: Uint8Array; region: { x: number; y: number; width: number; height: number }; delay: number } | null = null
        const flush = (first: boolean) => {
            if (!pending) return
            let remaining = pending.delay
            let includePalette = first
            do {
                const span = Math.min(MAX_GIF_DELAY, remaining)
                const start = gif.bytesView().length
                gif.writeFrame(pending.index, pending.region.width, pending.region.height, {
                    ...(includePalette ? { palette } : {}),
                    delay: Math.max(20, span), repeat, dispose: 1,
                })
                if (pending.region.x !== 0 || pending.region.y !== 0) {
                    // gifenc has no frame offset option, so patch the image descriptor.
                    const bytes = gif.bytesView()
                    const descriptor = start + 8
                    if (bytes[descriptor] !== 0x2c) throw new Error('The GIF encoder wrote an unexpected frame layout.')
                    bytes[descriptor + 1] = pending.region.x & 0xff
                    bytes[descriptor + 2] = (pending.region.x >> 8) & 0xff
                    bytes[descriptor + 3] = pending.region.y & 0xff
                    bytes[descriptor + 4] = (pending.region.y >> 8) & 0xff
                }
                includePalette = false
                remaining -= span
            } while (remaining > 0)
        }
        let wroteAny = false
        for (let i = 0; i < count; i++) {
            options.signal?.throwIfAborted()
            const pixels = await next(i)
            // A renderer that knows that a frame repeats gives the same array again, and no scan is needed.
            const region: { x: number; y: number; width: number; height: number } | null = previous
                ? (previous === pixels ? null : changedRegion(previous, pixels, size.width, size.height))
                : { x: 0, y: 0, width: size.width, height: size.height }
            if (!region) {
                // Nothing changed, so the previous frame simply holds longer.
                if (pending) pending.delay += delay
            } else {
                flush(!wroteAny)
                if (pending) wroteAny = true
                const cropped = region.width === size.width && region.height === size.height ? pixels : cropRegion(pixels, size.width, region)
                pending = { index: gifApi.applyPalette(cropped, palette, 'rgb565'), region, delay }
                previous = pixels
            }
            await options.onProgress?.({ index: i, count, time: i * delay, duration: count * delay, progress: i / count, fps })
        }
        flush(!wroteAny)
        gif.finish()
        const path = resolve(outputPath)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, gif.bytesView())
        return { width: size.width, height: size.height, frameCount: count, duration: count * delay, fps, bytes: (await stat(path)).size, outputPath: path, title: compiled.title }
    } finally {
        await renderer.close()
    }
}

/** Render one moment to a PNG. */
export async function renderFilmFrame(film: FilmDefinition | CompiledFilm, time: number, outputPath: string, options: FilmRenderOptions = {}): Promise<{ width: number; height: number; outputPath: string }> {
    const compiled = await resolveFilm(film, options)
    const { width, height } = outputSize(compiled, options.width)
    const renderer = openRenderer(1)
    try {
        const frame = await frameAt(compiled, time)
        const pixels = await renderer.render([frame], width, height)
        const path = resolve(outputPath)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, encodePng({ width, height, data: pixels, depth: 8, channels: 4 }))
        return { width, height, outputPath: path }
    } finally {
        await renderer.close()
    }
}

/** Render many moments as PNG files, for review strips and posters. */
export async function renderFilmFrames(film: FilmDefinition | CompiledFilm, times: readonly number[], outputPrefix: string, options: FilmRenderOptions = {}): Promise<string[]> {
    const compiled = await resolveFilm(film, options)
    const { width, height } = outputSize(compiled, options.width)
    const plan = planRender(width, height, 1, options)
    const renderer = openRenderer(plan.workers)
    try {
        await mkdir(dirname(resolve(outputPrefix)), { recursive: true })
        // Frames are sampled one at a time because the engine's clock is shared.
        const frames: Frame[] = []
        for (const time of times) frames.push(await frameAt(compiled, time))
        return await Promise.all(frames.map(async (frame, index) => {
            const pixels = await renderer.render([frame], width, height)
            const path = resolve(`${outputPrefix}${String(index).padStart(3, '0')}.png`)
            await writeFile(path, encodePng({ width, height, data: pixels, depth: 8, channels: 4 }))
            return path
        }))
    } finally {
        await renderer.close()
    }
}

export interface FilmSheetOptions extends CompileOverrides {
    /** Width of one tile in pixels. Defaults to 480. */
    width?: number
    /** Tiles in a row. Defaults to 3 for up to nine tiles, and 4 for more. */
    columns?: number
    workers?: number
    /** Approximate limit in bytes for frame buffers held at one time. */
    memoryBudget?: number
}

export interface FilmSheetOutput {
    width: number
    height: number
    columns: number
    rows: number
    /** The time of each tile, in reading order. */
    times: number[]
    outputPath: string
}

/** The time under a tile of a contact sheet, such as 1:02.50. */
export function sheetStamp(time: number): string {
    const hundredths = Math.round(time * 100)
    const minutes = Math.floor(hundredths / 6000)
    return `${minutes}:${((hundredths - minutes * 6000) / 100).toFixed(2).padStart(5, '0')}`
}

/**
 * Render many moments into one PNG: a grid of small frames, each with its time under it.
 * Use it to read a film that you cannot play. The frames are in reading order.
 */
export async function renderFilmSheet(film: FilmDefinition | CompiledFilm, times: readonly number[], outputPath: string, options: FilmSheetOptions = {}): Promise<FilmSheetOutput> {
    if (times.length === 0) throw new Error('A contact sheet needs at least one time.')
    const compiled = await resolveFilm(film, options)
    const tile = outputSize(compiled, options.width ?? 480)
    const requested = options.columns ?? (times.length <= 9 ? 3 : 4)
    if (!Number.isInteger(requested) || requested < 1) throw new Error(`A contact sheet needs a whole number of columns, at least 1, but received ${requested}.`)
    const columns = Math.min(times.length, requested)
    const rows = Math.ceil(times.length / columns)
    const gap = Math.max(4, Math.round(tile.width * 0.025))
    // The band under each tile holds its time.
    const band = Math.max(20, Math.round(tile.width * 0.075))
    const width = columns * tile.width + (columns + 1) * gap
    const height = rows * (tile.height + band) + (rows + 1) * gap
    const corner = (index: number) => ({ x: gap + (index % columns) * (tile.width + gap), y: gap + Math.floor(index / columns) * (tile.height + band + gap) })
    const plan = planRender(tile.width, tile.height, 1, options)
    const renderer = openRenderer(plan.workers)
    try {
        // Frames are sampled one at a time because the engine's clock is shared.
        const frames: Frame[] = []
        for (const time of times) frames.push(await frameAt(compiled, time))
        const tiles = await Promise.all(frames.map((frame) => renderer.render([frame], tile.width, tile.height)))
        // The times are a film frame of their own, so they use the film's look and its fonts.
        const labels = await defineFilm({ width, height, look: compiled.look, background: 'surface', bloom: 0 }, (stage) => {
            times.forEach((time, index) => {
                const at = corner(index)
                stage.add(text(sheetStamp(time), { font: 'mono', size: band * 0.6, color: 'dim' }).at(at.x + tile.width / 2 - width / 2, at.y + tile.height + band / 2 - height / 2))
            })
        }).compile({})
        const sheet = await renderer.render([await frameAt(labels, 0)], width, height)
        tiles.forEach((pixels, index) => {
            const at = corner(index)
            for (let row = 0; row < tile.height; row++) {
                sheet.set(pixels.subarray(row * tile.width * 4, (row + 1) * tile.width * 4), ((at.y + row) * width + at.x) * 4)
            }
        })
        const path = resolve(outputPath)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, encodePng({ width, height, data: sheet, depth: 8, channels: 4 }))
        return { width, height, columns, rows, times: [...times], outputPath: path }
    } finally {
        await renderer.close()
    }
}

/** Write one moment as standalone SVG. Text is outlines, so no fonts are needed to view it. */
export async function renderFilmSvg(film: FilmDefinition | CompiledFilm, time: number, outputPath: string, options: FilmRenderOptions = {}): Promise<{ width: number; height: number; outputPath: string }> {
    const compiled = await resolveFilm(film, options)
    const path = resolve(outputPath)
    await mkdir(dirname(path), { recursive: true })
    const frame = await frameAt(compiled, time)
    const scale = (options.width ?? compiled.width) / compiled.width
    await writeFile(path, frameToSvg(frame, { scale }))
    return { width: Math.round(compiled.width * scale), height: Math.round(compiled.height * scale), outputPath: path }
}

/**
 * A good still for a thumbnail: the author's choice, or else the latest moment at
 * rest that shows most of what the fullest moment shows. Mid-animation frames
 * make poor posters, so only moments between animations qualify.
 */
export async function posterTime(film: CompiledFilm): Promise<number> {
    if (film.posterTime !== undefined) return Math.max(0, Math.min(film.duration, film.posterTime))
    const active = (t: number) => film.clips.some((clip) => clip.t0 < t && t < clip.t1)
    const nudge = 1e-3
    const candidates = new Set<number>()
    for (const clip of film.clips) {
        const t = clip.t1 + nudge
        if (t < film.duration && !active(t)) candidates.add(t)
    }
    if (candidates.size === 0) for (let i = 1; i <= 10; i++) candidates.add((film.duration * i) / 10 - nudge)
    const scored: { time: number; ink: number }[] = []
    for (const time of [...candidates].sort((a, b) => a - b)) {
        const frame = await frameAt(film, time)
        scored.push({ time, ink: frame.ops.length })
    }
    const fullest = Math.max(...scored.map((entry) => entry.ink))
    const rich = scored.filter((entry) => entry.ink >= fullest * 0.75)
    return rich[rich.length - 1]?.time ?? film.duration
}

/** Captions as WebVTT, for a sidecar track. */
export function captionsToVtt(film: CompiledFilm): string {
    const stamp = (seconds: number) => {
        const m = Math.floor(seconds / 60), s = seconds - m * 60
        return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`
    }
    const cues = film.captions.map((cue) => `${stamp(cue.t0)} --> ${stamp(cue.t1)}\n${cue.text}`)
    return `WEBVTT\n\n${cues.join('\n\n')}\n`
}

export { fromComponent, type FromComponentOptions } from './objects/from-component'
