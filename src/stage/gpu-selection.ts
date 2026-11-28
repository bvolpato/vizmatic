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

/** Approximate parity safeguard: tolerate antialiasing differences while checking local color bias. */
export function matchingGpuPixels(cpu: Uint8Array, gpu: Uint8Array, width = cpu.length / 4): boolean {
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
        if (signed.some(sum => Math.abs(sum) > tilePixels * 2.5)) return false
    }
    return total <= pixels * 3 * 2.5 && different <= pixels * 0.004 && alpha <= pixels * 0.001
}

/** The mean of a difference of pixels in each square of 64 pixels, for each color. */
function tileMeans(width: number, height: number, delta: (i: number) => number, visit: (means: readonly number[], left: number, top: number, right: number, bottom: number) => void): void {
    for (let top = 0; top < height; top += 64) for (let left = 0; left < width; left += 64) {
        const right = Math.min(left + 64, width), bottom = Math.min(top + 64, height), sums = [0, 0, 0]
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) for (let channel = 0; channel < 3; channel++) sums[channel] += delta((y * width + x) * 4 + channel)
        visit(sums.map(sum => sum / ((right - left) * (bottom - top))), left, top, right, bottom)
    }
}

/**
 * Is a picture in half floats the picture of the CPU? Each layer of soft light is rounded to a byte on the CPU, and
 * the errors of many layers add up to a wide and smooth offset of some levels. Half floats do not have it. So a smooth
 * offset is allowed, up to 16 levels, and what is left without it must be as near as that of a picture in bytes.
 * A bloom is smooth too, and a lost one would pass here: compare it with `matchingBloom`.
 */
export function matchingHalfFloats(cpu: Uint8Array, gpu: Uint8Array, width: number): boolean {
    if (!cpu.length || cpu.length !== gpu.length || cpu.length % 4
        || !Number.isSafeInteger(width) || width < 1 || (cpu.length / 4) % width) return false
    const pixels = cpu.length / 4, height = pixels / width
    let total = 0, different = 0, alpha = 0, near = true
    tileMeans(width, height, i => cpu[i] - gpu[i], (means, left, top, right, bottom) => {
        if (means.some(mean => Math.abs(mean) > 16)) near = false
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
            const i = (y * width + x) * 4
            let peak = 0
            for (let channel = 0; channel < 3; channel++) {
                const rest = Math.abs(cpu[i + channel] - gpu[i + channel] - means[channel])
                total += rest
                peak = Math.max(peak, rest)
            }
            if (peak > 48) different++
            if (Math.abs(cpu[i + 3] - gpu[i + 3]) > 8) alpha++
        }
    })
    return near && total <= pixels * 3 * 2.5 && different <= pixels * 0.004 && alpha <= pixels * 0.001
}

/** Does the bloom of the GPU add the light that the bloom of the CPU adds? The offset of the picture is in both frames of a side, so it goes out. */
export function matchingBloom(cpu: Uint8Array, cpuPlain: Uint8Array, gpu: Uint8Array, gpuPlain: Uint8Array, width: number): boolean {
    let near = true
    tileMeans(width, cpu.length / 4 / width, i => cpu[i] - cpuPlain[i] - gpu[i] + gpuPlain[i], means => { if (means.some(mean => Math.abs(mean) > 2.5)) near = false })
    return near
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
        // A dithered export that asked for the GPU paints in half floats. A choice by speed compares like with like.
        let float = options.request === 'gpu' && dither, paint = ''
        const inBytes = (error: unknown) => {
            if (!float || options.signal?.aborted || !(error instanceof GpuUnavailableError)) throw error
            float = false
            paint = `bytes, because ${error.message}; `
        }
        try { gpu = await GpuRasterizer.create(options.signal, gpuSourceOf(film), float) } catch (error) {
            inBytes(error)
            gpu = await GpuRasterizer.create(options.signal, gpuSourceOf(film))
        }
        let source = gpu.usesFilmSource
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
            let gpuMs = 0
            const sample = async () => {
                const gpuStart = performance.now()
                const pictures = await Promise.all(moments.map((moment, index) => gpu!.run(source
                    ? { times: timesAt(moment), width, height, dither }
                    : { frames: frames[index], width, height, dither })))
                gpuMs = performance.now() - gpuStart + (source ? 0 : buildMs)
                return pictures
            }
            const differ = () => new GpuUnavailableError('GPU sample pixels differ materially from the CPU renderer')
            if (float) {
                try {
                    const half = await sample()
                    if (!cpu.every((pixels, i) => matchingHalfFloats(pixels, half[i], width))) throw new GpuUnavailableError('the sample pixels in half floats differ materially')
                    if (film.bloom > 0) {
                        const plain = frames.map(of => of.map(frame => ({ ...frame, bloom: 0 })))
                        const [cpuPlain, halfPlain] = await withAbort(Promise.all([
                            Promise.all(plain.map(of => pool.run(framesToJob(of, width, background, height, dither)))),
                            Promise.all(plain.map(of => gpu!.run({ frames: of, width, height, dither }))),
                        ]), options.signal)
                        if (!cpu.every((pixels, i) => matchingBloom(pixels, cpuPlain[i], half[i], halfPlain[i], width))) throw new GpuUnavailableError('the bloom in half floats differs materially')
                    }
                    paint = 'half floats; '
                } catch (error) {
                    inBytes(error)
                    await gpu.close()
                    gpu = await GpuRasterizer.create(options.signal, gpuSourceOf(film))
                    source = gpu.usesFilmSource
                }
            }
            if (!float) {
                const bytes = await sample()
                if (!cpu.every((pixels, i) => matchingGpuPixels(pixels, bytes[i], width))) throw differ()
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
            return { gpu, source: !!source, reason: `${options.request === 'gpu' ? 'GPU requested; ' : ''}${paint}${measured}` }
        } finally { if (!keepPool) await pool.close() }
    } catch (error) {
        if (options.request === 'gpu' || !(error instanceof GpuUnavailableError)) throw error
        return { source: false, reason: error.message }
    } finally { if (!keep) await gpu?.close() }
}
