import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRgbaVideo, type RgbaVideoOptions, type RgbaVideoOutput } from '../src/video'
import { renderFilmVideo } from '../src/stage/export'
import { GpuRasterizer, GpuUnavailableError } from '../src/stage/gpu-raster'
import { selectGpuRenderer, type GpuExportOptions } from '../src/stage/gpu-selection'
import { RasterPool } from '../src/stage/raster'
import { compileFilm, film, Suspend } from '../src/stage/stage'

vi.mock('../src/video', () => ({ renderRgbaVideo: vi.fn(), resolveH264Encoder: vi.fn() }))

function encoded(options: RgbaVideoOptions): RgbaVideoOutput {
    const fps = options.fps ?? 30
    return {
        width: options.width, height: options.height, fps,
        frameCount: Math.round(options.duration / 1000 * fps), duration: options.duration,
        outputPath: options.outputPath, bytes: 0, audioIncluded: false,
    }
}

beforeEach(() => {
    vi.stubEnv('CI', '')
    vi.stubEnv('GITHUB_ACTIONS', '')
    vi.spyOn(GpuRasterizer, 'create').mockRejectedValue(new GpuUnavailableError('No test GPU'))
    // The encoder boundary is mocked. Large fixtures exercise selection gates without rasterizing them.
    vi.mocked(renderRgbaVideo).mockImplementation(async (_render, options) => encoded(options))
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.resetAllMocks()
    vi.unstubAllEnvs()
})

function fixture(eligibleForAuto = false) {
    return compileFilm(film({
        width: eligibleForAuto ? 1280 : 16, height: eligibleForAuto ? 720 : 16,
        fps: eligibleForAuto ? 30 : 2, background: '#123456', bloom: 0,
    }, s => { s.wait(eligibleForAuto ? 10 : 1) }))
}

function selection(request: 'auto' | 'gpu', signal?: AbortSignal): GpuExportOptions {
    return { request, width: 16, height: 16, from: 0, to: 1, count: 2, subframes: 1, shutterSpan: 0, dither: false, workers: 1, signal }
}

function mockGpu(mismatch = false) {
    const pixels = new Uint8Array(16 * 16 * 4)
    if (!mismatch) for (let at = 0; at < pixels.length; at += 4) pixels.set([0x12, 0x34, 0x56, 255], at)
    const run = vi.fn<GpuRasterizer['run']>().mockResolvedValue(pixels)
    const close = vi.fn(async () => {})
    const gpu = { device: 'Test GPU', rasterMs: 0, bloomMs: 0, readbackMs: 0, run, close } as unknown as GpuRasterizer
    vi.mocked(GpuRasterizer.create).mockResolvedValue(gpu)
    return { gpu, run, close, pixels }
}

describe('GPU probe selection', () => {
    it.each([
        { workers: 32, memoryBudget: 1024 ** 3 },
        { workers: 4, memoryBudget: 3 * 16 * 16 * 16 },
    ])('keeps the CPU when the probe cannot fill a batch of $workers workers', async options => {
        const result = await selectGpuRenderer(await fixture(), { ...selection('auto'), ...options })
        expect(result.gpu).toBeUndefined()
        expect(result.reason).toContain('whole CPU worker batch')
        expect(GpuRasterizer.create).not.toHaveBeenCalled()
    })

    it.each(['auto', 'gpu'] as const)('aborts a never-resolving suspended frame and closes both backends for %s', async request => {
        const controller = new AbortController()
        const gpu = mockGpu()
        const closeCpu = vi.spyOn(RasterPool.prototype, 'close')
        const compiled = await fixture()
        vi.spyOn(compiled, 'frame').mockImplementationOnce(() => {
            queueMicrotask(() => controller.abort())
            throw new Suspend(new Promise(() => {}))
        })
        await expect(selectGpuRenderer(compiled, selection(request, controller.signal))).rejects.toMatchObject({ name: 'AbortError' })
        expect(gpu.close).toHaveBeenCalledTimes(1)
        expect(closeCpu).toHaveBeenCalledTimes(1)
    })

    it.each(['warmup', 'results'] as const)('aborts a pending CPU %s and closes both backends', async phase => {
        const controller = new AbortController()
        const gpu = mockGpu()
        const closeCpu = vi.spyOn(RasterPool.prototype, 'close')
        let timer: ReturnType<typeof setTimeout> | undefined
        const run = vi.spyOn(RasterPool.prototype, 'run').mockImplementation(() => {
            timer ??= setTimeout(() => controller.abort(), 0)
            return new Promise(() => {})
        })
        if (phase === 'results') run.mockResolvedValueOnce(gpu.pixels)
        try {
            await expect(selectGpuRenderer(await fixture(), selection('auto', controller.signal))).rejects.toMatchObject({ name: 'AbortError' })
            expect(gpu.close).toHaveBeenCalledTimes(1)
            expect(closeCpu).toHaveBeenCalledTimes(1)
        } finally { clearTimeout(timer) }
    })

    it.each([
        { request: 'auto', held: 3, selected: false },
        { request: 'auto', held: 1, selected: true },
        { request: 'auto', held: 0, selected: true },
        { request: 'gpu', held: 3, selected: true },
    ] as const)('samples consecutive output frames for $request with $held holds', async ({ request, held, selected }) => {
        const gpu = mockGpu()
        const closeCpu = vi.spyOn(RasterPool.prototype, 'close')
        const compiled = await compileFilm(film({ width: 16, height: 16, fps: 30 }, s => { s.wait(40) }))
        const frameAt = compiled.frame.bind(compiled)
        vi.spyOn(compiled, 'frame').mockImplementation(time => {
            const index = Math.round(time * compiled.fps)
            // Each sample center belongs to a different scene. The first scenes hold their frames.
            const scene = Math.floor(index / 400)
            const value = scene < held ? scene : index % 400
            return { ...frameAt(time), background: `#${value.toString(16).padStart(6, '0')}` }
        })
        let now = 0
        vi.spyOn(performance, 'now').mockImplementation(() => now)
        vi.spyOn(RasterPool.prototype, 'run').mockImplementation(async () => { now += 100; return gpu.pixels })
        gpu.run.mockImplementation(async () => { now += 10; return gpu.pixels })
        const result = await selectGpuRenderer(compiled, { ...selection(request), to: 40, count: 1200 })
        expect(result.gpu).toBe(selected ? gpu.gpu : undefined)
        expect(gpu.close).toHaveBeenCalledTimes(selected ? 0 : 1)
        expect(closeCpu).toHaveBeenCalledTimes(1)
    })

    it.each([4, 5])('requires %i frames to amortize the entire probe, including warmup', async count => {
        const gpu = mockGpu()
        const compiled = await compileFilm(film({ width: 16, height: 16, fps: 30 }, s => { s.wait(count / 30) }))
        const frameAt = compiled.frame.bind(compiled)
        vi.spyOn(compiled, 'frame').mockImplementation(time => ({
            ...frameAt(time), background: `#00000${Math.round(time * compiled.fps)}`,
        }))
        let now = 0
        vi.spyOn(performance, 'now').mockImplementation(() => now)
        vi.spyOn(RasterPool.prototype, 'run').mockImplementation(async () => { now += 100; return gpu.pixels })
        gpu.run.mockImplementation(async () => { now += 10; return gpu.pixels })
        const result = await selectGpuRenderer(compiled, { ...selection('auto'), count, to: compiled.duration })
        // Warmup costs 110 ms and measurement costs 330 ms. Each exported frame saves 90 ms.
        if (count === 4) {
            expect(result.gpu).toBeUndefined()
            expect(result.reason).toContain('CPU avoids GPU transfer/startup overhead')
            expect(gpu.close).toHaveBeenCalledTimes(1)
        } else {
            expect(result.gpu).toBe(gpu.gpu)
            expect(gpu.close).not.toHaveBeenCalled()
        }
    })

    it.each(['auto', 'gpu'] as const)('preserves abort and closes both probe backends for %s', async request => {
        const controller = new AbortController()
        const aborted = new DOMException('Probe cancelled', 'AbortError')
        const gpu = mockGpu()
        const closeCpu = vi.spyOn(RasterPool.prototype, 'close')
        gpu.run.mockImplementationOnce(async () => { controller.abort(); throw aborted })
        await expect(selectGpuRenderer(await fixture(), selection(request, controller.signal))).rejects.toBe(aborted)
        expect(gpu.close).toHaveBeenCalledTimes(1)
        expect(closeCpu).toHaveBeenCalledTimes(1)
    })

    it.each(['auto', 'gpu'] as const)('rejects mismatched pixels and closes both probe backends for %s', async request => {
        const gpu = mockGpu(true)
        const closeCpu = vi.spyOn(RasterPool.prototype, 'close')
        const selected = selectGpuRenderer(await fixture(), selection(request))
        const reason = 'GPU sample pixels differ materially from the CPU renderer'
        if (request === 'auto') await expect(selected).resolves.toEqual({ source: false, reason })
        else await expect(selected).rejects.toThrow(reason)
        expect(gpu.close).toHaveBeenCalledTimes(1)
        expect(closeCpu).toHaveBeenCalledTimes(1)
    })
})

describe('film export backend', () => {
    it.each(['auto', 'gpu'] as const)('handles an unavailable GPU for %s without hiding the reason', async backend => {
        const unavailable = new GpuUnavailableError('Hardware renderer is unavailable')
        vi.mocked(GpuRasterizer.create).mockRejectedValue(unavailable)
        const output = renderFilmVideo(await fixture(true), 'unused.mp4', { backend, workers: 1 })
        if (backend === 'auto') {
            await expect(output).resolves.toMatchObject({ backend: 'cpu', backendReason: unavailable.message })
            expect(renderRgbaVideo).toHaveBeenCalledTimes(1)
        } else {
            await expect(output).rejects.toBe(unavailable)
            expect(renderRgbaVideo).not.toHaveBeenCalled()
        }
        expect(GpuRasterizer.create).toHaveBeenCalledTimes(1)
    })

    it.each(['CI', 'GITHUB_ACTIONS'])('never launches a GPU under %s, including explicit requests', async name => {
        vi.stubEnv(name, 'true')
        const compiled = await fixture(true)
        for (const backend of [undefined, 'auto', 'cpu', 'gpu'] as const) {
            vi.mocked(renderRgbaVideo).mockClear()
            const output = renderFilmVideo(compiled, 'unused.mp4', { backend, workers: 1 })
            if (backend === 'gpu') {
                await expect(output).rejects.toThrow('GPU rendering is disabled in CI')
                expect(renderRgbaVideo).not.toHaveBeenCalled()
            } else {
                await expect(output).resolves.toMatchObject({ backend: 'cpu', backendReason: 'CI uses CPU rendering' })
                expect(renderRgbaVideo).toHaveBeenCalledTimes(1)
            }
        }
        expect(GpuRasterizer.create).not.toHaveBeenCalled()
    })

    it.each(['success', 'abort'] as const)('closes the selected GPU after export %s', async outcome => {
        const gpu = mockGpu()
        const controller = new AbortController()
        const aborted = new DOMException('Encoding cancelled', 'AbortError')
        vi.mocked(renderRgbaVideo).mockImplementationOnce(async (render, options) => {
            const frame = await render({ index: 0, count: 2, time: 0, duration: 1000, progress: 0, fps: 2 })
            expect(frame).toEqual(gpu.pixels)
            if (outcome === 'abort') { controller.abort(); throw aborted }
            return encoded(options)
        })
        const output = renderFilmVideo(await fixture(), 'unused.mp4', { backend: 'gpu', workers: 1, signal: controller.signal })
        if (outcome === 'abort') await expect(output).rejects.toBe(aborted)
        else await expect(output).resolves.toMatchObject({ backend: 'gpu', gpuDevice: 'Test GPU' })
        expect(gpu.close).toHaveBeenCalledTimes(1)
        expect(renderRgbaVideo).toHaveBeenCalledTimes(1)
    })
})
