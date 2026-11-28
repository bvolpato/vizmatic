import { findBrowser } from './gpu-browser'
import { GpuRasterizer, GpuUnavailableError } from './gpu-raster'
export { findBrowser, GpuRasterizer }
import { gpuSourceOf } from './gpu-source'
import { RasterPool, framesToJob, sameRasterJob } from './raster'
import { parseColor } from './color'
import { isSuspend, type CompiledFilm } from './stage'
import type { Frame } from './display'
import { totalmem } from 'node:os'

export interface GpuExportOptions {
    request: 'auto' | 'gpu'
    width: number
    height: number
    from: number
    to: number
    count: number
    subframes: number
    shutterSpan: number
    dither: boolean
    workers: number
    memoryBudget?: number
    /** When true and CPU is selected, return the warmed CPU RasterPool instead of closing it. */
    keepPool?: boolean
    signal?: AbortSignal
}

export interface GpuSelection {
    gpu?: GpuRasterizer
    pool?: RasterPool
    source: boolean
    reason: string
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise
    if (signal.aborted) {
        promise.catch(() => {})
        return Promise.reject(new DOMException('The export was aborted', 'AbortError'))
    }
    return new Promise((resolve, reject) => {
        const cleanup = () => signal.removeEventListener('abort', onAbort)
        const onAbort = () => {
            cleanup()
            reject(new DOMException('The export was aborted', 'AbortError'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        promise.then(
            value => { cleanup(); resolve(value) },
            error => { cleanup(); reject(error) },
        )
    })
}

export async function sampleGpuFrames(film: CompiledFilm, times: readonly number[], signal?: AbortSignal): Promise<Frame[]> {
    const frames: Frame[] = []
    for (const time of times) for (;;) {
        if (signal?.aborted) throw new DOMException('The export was aborted', 'AbortError')
        try { frames.push(film.frame(time)); break } catch (error) {
            if (!isSuspend(error)) throw error
            await withAbort(error.promise, signal)
        }
    }
    return frames
}

/**
 * Approximate parity safeguard: tolerate antialiasing differences while checking local color bias. Each layer of
 * soft light on the CPU is rounded to a byte, and the error of many layers adds up. A picture in half floats does
 * not have that error, so it may be further from the CPU picture: `tile` levels in a tile and `mean` in the frame.
 */
export function matchingGpuPixels(cpu: Uint8Array, gpu: Uint8Array, width = cpu.length / 4, tile = 2.5, mean = 2.5): boolean {
    if (!cpu.length || cpu.length !== gpu.length || cpu.length % 4
        || !Number.isSafeInteger(width) || width < 1 || (cpu.length / 4) % width) return false
    const pixels = cpu.length / 4, height = pixels / width
    let total = 0, different = 0, alpha = 0
    for (let top = 0; top < height; top += 64) for (let left = 0; left < width; left += 64) {
        const right = Math.min(left + 64, width), bottom = Math.min(top + 64, height)
        const signed = [0, 0, 0]
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
            const i = (y * width + x) * 4
            let peak = 0
            for (let channel = 0; channel < 3; channel++) {
                const delta = cpu[i + channel] - gpu[i + channel]
                const magnitude = Math.abs(delta)
                signed[channel] += delta
                total += magnitude; peak = Math.max(peak, magnitude)
            }
            if (peak > 48) different++
            if (Math.abs(cpu[i + 3] - gpu[i + 3]) > 8) alpha++
        }
        const tilePixels = (right - left) * (bottom - top)
        if (signed.some(sum => Math.abs(sum) > tilePixels * tile)) return false
    }
    return total <= pixels * 3 * mean && different <= pixels * 0.004 && alpha <= pixels * 0.001
}

export async function selectGpuRenderer(film: CompiledFilm, options: GpuExportOptions): Promise<GpuSelection> {
    if (options.signal?.aborted) throw new DOMException('The export was aborted', 'AbortError')
    const { width, height, dither, subframes, shutterSpan, workers } = options
    let count = 3
    if (options.request === 'auto') {
        // Time one whole CPU worker batch (capped at 12 frames) to measure sustained throughput without bloated probes.
        const budget = options.memoryBudget ?? Math.min(2 * 1024 ** 3, totalmem() * 0.25)
        const capacity = Math.min(12, Math.max(3, workers), Math.floor(budget / (width * height * 4 * 4)))
        count = Math.floor(capacity / workers) * workers
        if (count < 3) return { source: false, reason: 'GPU probe needs at least three frames and a whole CPU worker batch' }
    }
    let gpu: GpuRasterizer | undefined
    let keep = false
    const started = performance.now()
    try {
        // An export that chooses its backend by speed compares the two pictures, so it paints in bytes as the CPU does.
        const float = options.request === 'gpu' && options.dither
        gpu = await GpuRasterizer.create(options.signal, gpuSourceOf(film), float)
        const source = gpu.usesFilmSource
        // Explicit GPU mode only needs up to 3 CPU workers for pixel parity verification, not the entire CPU pool.
        const probeWorkers = options.request === 'gpu' ? Math.min(options.workers, count) : options.workers
        const pool = new RasterPool(probeWorkers)
        let keepPool = false
        const timesAt = (time: number) => Array.from({ length: subframes }, (_, index) => time + index / subframes * shutterSpan)
        const background = (value: string | null): readonly [number, number, number] => {
            const color = parseColor(value ?? '#000000'); return [color[0], color[1], color[2]]
        }
        try {
            const indices = Array.from({ length: count }, (_, i) => Math.floor(options.count * (i + 0.5) / count))
            const frameTime = (index: number) => options.from + index / film.fps
            const moments = indices.map(frameTime)
            if (options.request === 'auto') {
                const warmTimes = timesAt(moments[0])
                const warm = await sampleGpuFrames(film, warmTimes, options.signal)
                const warmJob = framesToJob(warm, width, background, height, dither)
                // Start every CPU worker before measuring; otherwise worker startup makes GPU look faster.
                await withAbort(Promise.all(Array.from({ length: probeWorkers }, () => pool.run(warmJob))), options.signal)
                await gpu.run(source ? { times: warmTimes, width, height, dither } : { frames: warm, width, height, dither })
            }
            let buildMs = 0, prepareCpuMs = 0
            const frames: Frame[][] = []
            const jobs: ReturnType<typeof framesToJob>[] = []
            const cpuStart = performance.now()
            const cpuPromises: Promise<Uint8Array>[] = []
            for (const moment of moments) {
                if (options.signal?.aborted) throw new DOMException('The export was aborted', 'AbortError')
                const before = performance.now()
                const frame = await sampleGpuFrames(film, timesAt(moment), options.signal)
                buildMs += performance.now() - before
                frames.push(frame)
                const job = framesToJob(frame, width, background, height, dither)
                prepareCpuMs += performance.now() - before
                jobs.push(job)
                const rendered = pool.run(job)
                rendered.catch(() => {})
                cpuPromises.push(rendered)
            }
            const cpu = await withAbort(Promise.all(cpuPromises), options.signal)
            const cpuMs = performance.now() - cpuStart
            const gpuStart = performance.now()
            const gpuFrames = await Promise.all(moments.map((moment, index) => gpu!.run(source
                ? { times: timesAt(moment), width, height, dither }
                : { frames: frames[index], width, height, dither })))
            const gpuMs = performance.now() - gpuStart + (source ? 0 : buildMs)
            if (!cpu.every((pixels, i) => matchingGpuPixels(pixels, gpuFrames[i], width, float ? 12 : 2.5, float ? 5 : 2.5))) {
                throw new GpuUnavailableError('GPU sample pixels differ materially from the CPU renderer')
            }
            let reuse = 0
            if (options.request === 'auto') {
                // An export can reuse only the preceding output frame. Two distant probe
                // centers can differ even when each belongs to a long hold.
                for (const [i, index] of indices.entries()) {
                    if (!index) continue
                    const previous = await sampleGpuFrames(film, timesAt(frameTime(index - 1)), options.signal)
                    if (sameRasterJob(jobs[i], framesToJob(previous, width, background, height, dither))) reuse++
                }
            }
            // The CPU still builds a raster job on a hold, but skips the worker's raster work.
            const estimatedCpuMs = cpuMs - Math.max(0, cpuMs - prepareCpuMs) * reuse / count
            const measured = `CPU ${(estimatedCpuMs / count).toFixed(1)} ms/frame, GPU ${(gpuMs / count).toFixed(1)} ms/frame`
                + (options.request === 'auto' ? `; ${reuse}/${count} sampled frames reusable on CPU` : '')
            if (options.request === 'auto') {
                const probeMs = performance.now() - started
                if (gpuMs >= estimatedCpuMs * 0.85 || (estimatedCpuMs - gpuMs) / count * options.count <= probeMs) {
                    if (options.keepPool) {
                        keepPool = true
                        pool.stats.computed = pool.stats.reused = pool.stats.mainMs = pool.stats.rasterMs = pool.stats.averageMs = pool.stats.bloomMs = 0
                    }
                    return { ...(keepPool ? { pool } : {}), source: false, reason: `${measured}; CPU avoids GPU transfer/startup overhead` }
                }
            }
            keep = true
            gpu.rasterMs = gpu.bloomMs = gpu.readbackMs = 0
            return { gpu, source: !!source, reason: `${options.request === 'gpu' ? 'GPU requested; ' : ''}${measured}` }
        } finally { if (!keepPool) await pool.close() }
    } catch (error) {
        if (options.request === 'gpu' || !(error instanceof GpuUnavailableError)) throw error
        return { source: false, reason: error.message }
    } finally { if (!keep) await gpu?.close() }
}
