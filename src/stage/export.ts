import { mkdir, stat, writeFile } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { encode as encodePng } from 'fast-png'
import * as gifenc from 'gifenc'
import { renderRgbaVideo, type RgbaVideoOutput, type VideoCodec, type VideoFrameInfo } from '../video'
import { parseColor } from './color'
import { frameToSvg, type Frame } from './display'
import { RasterPool, defaultPoolSize, framesToJob, reportExportStats, sameRasterJob, type RasterJob } from './raster'
import { film as defineFilm, isFilm, isSuspend, type CompiledFilm, type CompileOverrides, type FilmDefinition } from './stage'
import { text } from './text'

export type Quality = 'draft' | 'standard' | 'high' | 'master'
export type { VideoCodec } from '../video'

export interface FilmRenderOptions extends CompileOverrides {
    /** Output width in pixels. Defaults to the film's logical width. */
    width?: number
    quality?: Quality
    /**
     * Dither the bloom, so that soft light on a dark look has no contour lines. Without this option, a movie
     * has the dither at `high` and `master` and not at `draft` and `standard`, and a PNG has it. A GIF never
     * has it. An MP4 with the dither also gets the encoder settings that keep the grain.
     */
    dither?: boolean
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

/**
 * `dither` says if a movie at this quality has a dithered bloom when the export does not say. `grain` is what
 * the H.264 encoder gets in addition when the film has a dithered bloom, as x264 settings.
 *
 * A dithered bloom is fine grain of one level, in place of contour lines in soft light. It costs time, in the
 * bloom pass and in the encoder. So `draft` and `standard`, the qualities for work on a film, have none unless
 * the export asks for it. `high` and `master`, the qualities for a copy to publish, have it.
 *
 * With the settings of a film alone, the encoder drops the grain and leaves squares of 16 px in its place.
 * - `trellis=0` keeps the small values that are the grain.
 * - `subme=6` stops the search for the best mode at P-frames. In B-frames, that search costs about 40% more
 *   encoder time with the grain.
 * - `aq-strength` gives the flat dark parts the bits that keep the grain. `high` and `master` have enough bits
 *   with the 0.6 of the animation tune. `standard` needs 1.0, and `draft` needs 2.0.
 * None of these changes the decoder settings of the file, so `filmEncoderSettings` stays true.
 */
const QUALITY: Record<Quality, { crf: number; vp9Crf: number; preset: string; motionBlur: number; dither: boolean; grain: string }> = {
    draft: { crf: 26, vp9Crf: 40, preset: 'veryfast', motionBlur: 1, dither: false, grain: 'aq-strength=2.0' },
    standard: { crf: 18, vp9Crf: 31, preset: 'medium', motionBlur: 1, dither: false, grain: 'aq-strength=1.0:subme=6:trellis=0' },
    high: { crf: 15, vp9Crf: 24, preset: 'slow', motionBlur: 4, dither: true, grain: 'subme=6:trellis=0' },
    master: { crf: 11, vp9Crf: 15, preset: 'slow', motionBlur: 8, dither: true, grain: 'subme=6:trellis=0' },
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
    const perWorker = frameBytes * (motionBlur > 1 ? motionBlur + 4 : 3)
    const workers = Math.max(1, Math.min(requested, Math.floor(budget * 0.75 / perWorker)))
    const extra = Math.floor(budget * 0.25 / frameBytes)
    return { workers, readAhead: Math.max(workers + 1, Math.min(workers * 2, workers + extra)) }
}

/** A job and the pixels that it gives. */
interface Rendered {
    job: RasterJob
    pixels: Promise<Uint8Array>
}

/**
 * Rasterize frames in parallel and hand them out in order, holding only a bounded
 * number at a time. Call `next(i)` with i increasing from 0.
 *
 * A frame that is equal to the frame before takes its pixels, and no worker sees it. The two frames
 * share one buffer, so the caller must not write to the pixels. For the comparison, the stream keeps
 * the SVG text of the last job, and the pixels of the last frame until the stream ends.
 */
function frameStream(
    film: CompiledFilm,
    pool: RasterPool,
    timeOf: (index: number) => number,
    size: { width: number; height: number },
    count: number,
    readAhead: number,
    subframes = 1,
    shutterSpan = 0,
    dither = true,
): (index: number) => Promise<Uint8Array> {
    const inFlight = new Map<number, Promise<Uint8Array>>()
    const stats = pool.stats
    // The job of the frame before. Jobs are compared in the order of the frames.
    let before: Promise<Rendered | null> = Promise.resolve(null)
    const submit = (index: number): Promise<Uint8Array> => {
        const previous = before
        const rendered = (async (): Promise<Rendered> => {
            const base = timeOf(index)
            const frames: Frame[] = []
            for (let sub = 0; sub < subframes; sub++) {
                const started = performance.now()
                const frame = frameAt(film, base + (sub / subframes) * shutterSpan)
                stats.mainMs += performance.now() - started
                frames.push(await frame)
            }
            let started = performance.now()
            const job = framesToJob(frames, size.width, backgroundBytes, size.height, dither)
            stats.mainMs += performance.now() - started
            // A frame before that failed has nothing to share. Its own index reports the failure.
            const last = await previous.catch(() => null)
            started = performance.now()
            const same = last !== null && sameRasterJob(last.job, job)
            stats.mainMs += performance.now() - started
            if (same) {
                stats.reused++
                return last!
            }
            return { job, pixels: pool.run(job) }
        })()
        before = rendered
        return rendered.then((entry) => entry.pixels)
    }
    return async (index) => {
        for (let ahead = index; ahead < Math.min(count, index + readAhead); ahead++) {
            if (inFlight.has(ahead)) continue
            const job = submit(ahead)
            // The consumer awaits it later. An abort must not surface as an unhandled rejection first.
            job.catch(() => {})
            inFlight.set(ahead, job)
        }
        const pixels = await inFlight.get(index)!
        inFlight.delete(index)
        return pixels
    }
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
    const pool = new RasterPool(plan.workers)
    try {
        const count = Math.max(1, Math.round((to - from) * fps))
        const dither = options.dither ?? quality.dither
        const next = frameStream(compiled, pool, (index) => from + index / fps, size, count, plan.readAhead, motionBlur, shutter / fps, dither)
        // Only a dark look has bloom, so only its film has the grain of the dither. A film object with no look
        // counts as a film with no bloom.
        const grain = dither && compiled.bloom > 0 && compiled.look?.dark === true
        const stats = pool.stats
        // When the export loop took the last frame. From then, it waits for the encoder.
        let handed = 0
        const output = await renderRgbaVideo(async (info) => {
            const asked = performance.now()
            if (handed > 0) stats.encoderWaitMs += asked - handed
            const pixels = await next(info.index)
            handed = performance.now()
            stats.frameWaitMs += handed - asked
            return pixels
        }, {
            width: size.width, height: size.height, fps, duration: (to - from) * 1000, outputPath,
            codec,
            crf: codec === 'vp9' ? quality.vp9Crf : quality.crf,
            preset: quality.preset,
            // Flat color and fine lines keep their edges better with this tuning.
            tune: codec === 'h264' ? filmEncoderSettings(options.quality).tune : undefined,
            x264Params: codec === 'h264' && grain ? quality.grain : undefined,
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
        stats.encoderFinishMs = performance.now() - handed
        reportExportStats(stats)
        return { ...output, title: compiled.title, workers: pool.size, motionBlur, codec }
    } finally {
        await pool.close()
    }
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
    const pool = new RasterPool(plan.workers)
    try {
        // Build one palette from frames across the film, so colors do not flicker between frames.
        const sampleCount = Math.min(count, GIF_PALETTE_FRAMES)
        const samples = await Promise.all(Array.from({ length: sampleCount }, async (_, i) => {
            const index = Math.floor((i + 0.5) * count / sampleCount)
            return pool.run(framesToJob([await frameAt(compiled, from + index / fps)], size.width, backgroundBytes, size.height, false))
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
        // A palette of 256 colors cannot hold the grain of a dithered bloom, so a GIF gets the plain write.
        const next = frameStream(compiled, pool, (index) => from + index / fps, size, count, plan.readAhead, 1, 0, false)
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
            // A frame that is equal to the frame before arrives as the same buffer.
            const region: { x: number; y: number; width: number; height: number } | null = !previous
                ? { x: 0, y: 0, width: size.width, height: size.height }
                : previous === pixels ? null : changedRegion(previous, pixels, size.width, size.height)
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
        await pool.close()
    }
}

/** Render one moment to a PNG. */
export async function renderFilmFrame(film: FilmDefinition | CompiledFilm, time: number, outputPath: string, options: FilmRenderOptions = {}): Promise<{ width: number; height: number; outputPath: string }> {
    const compiled = await resolveFilm(film, options)
    const { width, height } = outputSize(compiled, options.width)
    const pool = new RasterPool(1)
    try {
        const frame = await frameAt(compiled, time)
        // A still is for a look at the picture, so it has the dither unless the export turns it off.
        const pixels = await pool.run(framesToJob([frame], width, backgroundBytes, height, options.dither !== false))
        const path = resolve(outputPath)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, encodePng({ width, height, data: pixels, depth: 8, channels: 4 }))
        return { width, height, outputPath: path }
    } finally {
        await pool.close()
    }
}

/** Render many moments as PNG files, for review strips and posters. */
export async function renderFilmFrames(film: FilmDefinition | CompiledFilm, times: readonly number[], outputPrefix: string, options: FilmRenderOptions = {}): Promise<string[]> {
    const compiled = await resolveFilm(film, options)
    const { width, height } = outputSize(compiled, options.width)
    const plan = planRender(width, height, 1, options)
    const pool = new RasterPool(plan.workers)
    try {
        await mkdir(dirname(resolve(outputPrefix)), { recursive: true })
        // Frames are sampled one at a time because the engine's clock is shared.
        const frames: Frame[] = []
        for (const time of times) frames.push(await frameAt(compiled, time))
        return await Promise.all(frames.map(async (frame, index) => {
            const pixels = await pool.run(framesToJob([frame], width, backgroundBytes, height, options.dither !== false))
            const path = resolve(`${outputPrefix}${String(index).padStart(3, '0')}.png`)
            await writeFile(path, encodePng({ width, height, data: pixels, depth: 8, channels: 4 }))
            return path
        }))
    } finally {
        await pool.close()
    }
}

export interface FilmSheetOptions extends CompileOverrides {
    /** Width of one tile in pixels. Defaults to 480. */
    width?: number
    /** Tiles in a row. Defaults to 3 for up to nine tiles, and 4 for more. */
    columns?: number
    /** Set to false for tiles with no dither in their bloom. */
    dither?: boolean
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
    const pool = new RasterPool(plan.workers)
    try {
        // Frames are sampled one at a time because the engine's clock is shared.
        const frames: Frame[] = []
        for (const time of times) frames.push(await frameAt(compiled, time))
        const tiles = await Promise.all(frames.map((frame) => pool.run(framesToJob([frame], tile.width, backgroundBytes, tile.height, options.dither !== false))))
        // The times are a film frame of their own, so they use the film's look and its fonts.
        const labels = await defineFilm({ width, height, look: compiled.look, background: 'surface', bloom: 0 }, (stage) => {
            times.forEach((time, index) => {
                const at = corner(index)
                stage.add(text(sheetStamp(time), { font: 'mono', size: band * 0.6, color: 'dim' }).at(at.x + tile.width / 2 - width / 2, at.y + tile.height + band / 2 - height / 2))
            })
        }).compile({})
        const sheet = await pool.run(framesToJob([await frameAt(labels, 0)], width, backgroundBytes, height))
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
        await pool.close()
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
