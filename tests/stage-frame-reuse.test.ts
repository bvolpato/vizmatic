import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encode } from 'fast-png'
import { circle, compileFilm, film, frameToSvg, image, resolveImageAsset, type CompiledFilm, type Frame } from '../src/stage/index'
import { renderFilmGif, renderFilmVideo } from '../src/stage/export'
import { BLOOM_SOURCE, RasterPool, framesToJob, sameRasterJob, type RasterJob } from '../src/stage/raster'

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0

const probe = vi.hoisted(() => ({ wrapper: '' }))
vi.mock('node:worker_threads', async importOriginal => {
    const actual = await importOriginal<typeof import('node:worker_threads')>()
    return { ...actual, Worker: class extends actual.Worker {
        constructor(source: string | URL, options?: import('node:worker_threads').WorkerOptions) {
            super(source, { ...options, workerData: { ...options?.workerData, resvgPath: probe.wrapper } })
        }
    } }
})

let directory: string, counter: string
beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vizmatic-frame-reuse-'))
    counter = join(directory, 'raster-calls')
    probe.wrapper = join(directory, 'resvg.cjs')
    const backend = createRequire(import.meta.url).resolve('@resvg/resvg-js')
    // Count the real rasterizations, with no counter in the production code.
    await writeFile(probe.wrapper, `const {Resvg}=require(${JSON.stringify(backend)});const {appendFileSync}=require('node:fs');exports.Resvg=class {constructor(...args){appendFileSync(${JSON.stringify(counter)},'1');this.image=new Resvg(...args)}render(){return this.image.render()}}`)
})
beforeEach(async () => { await writeFile(counter, '') })
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })
const calls = async () => (await readFile(counter)).length
const background = () => [11, 12, 16] as const
const raw = (job: RasterJob): RasterJob => ({ ...job, svgs: job.svgs.slice() })

async function fixture(moving = false, bloom = .8, transparent = false) {
    const bytes = encode({ width: 2, height: 2, channels: 4, depth: 8,
        data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 255, 255]) })
    const asset = await resolveImageAsset(bytes)
    let updates = 0
    const compiled = await compileFilm(film({ width: 127, height: 73, background: transparent ? null : '#0b0c10', bloom }, s => {
        s.add(image(asset, { width: 35.25, height: 21.5, crop: { x: 1, y: 0, width: 1, height: 2 }, opacity: .6 }).rotate(.21).at(-15.125, 2.375))
        const mark = s.add(circle(8.125, { fill: 'blue', stroke: 'pink', width: 1.25 }).at(20.125, -3.25).glow(1.2))
        s.update(mark, (node, time) => { updates++; if (moving) node.at(20.125 + time * 4.25, -3.25 + time) })
        s.wait(2)
    }))
    updates = 0
    return { compiled, updates: () => updates }
}

/** The bloom of the worker, to run on pixels in the test. */
const bloom = new Function(`${BLOOM_SOURCE}; return bloom`)() as (pixels: Uint8Array, w: number, h: number, amount: number, background: readonly number[], dither: boolean) => void

/** A frame with motion blur from three samples that differ, and the average of the samples with no bloom. */
async function blurred() {
    const f = await fixture(true), pool = new RasterPool(1)
    try {
        const samples = [f.compiled.frame(.1), f.compiled.frame(.6), f.compiled.frame(.9)]
        const job = raw(framesToJob(samples, 97, background, 57))
        const frame = await pool.run(job)
        // The same job with no bloom is the average alone.
        const average = await pool.run({ ...raw(job), bloom: 0 })
        const alone = await Promise.all(samples.map((sample) => pool.run({ ...raw(framesToJob([sample], 97, background, 57)), bloom: 0 })))
        expect(Buffer.compare(alone[0]!, alone[1]!)).not.toBe(0)
        expect(Buffer.compare(alone[1]!, alone[2]!)).not.toBe(0)
        return { job, frame, average }
    } finally {
        await pool.close()
    }
}

describe('the shutter samples of one frame', () => {
    it('writes the bloom and its dither once, on the average of the samples, and not on each sample', async () => {
        const { job, frame, average } = await blurred()
        const expected = average.slice()
        bloom(expected, job.width, job.height, job.bloom, job.background, true)
        expect(Buffer.compare(frame, expected)).toBe(0)
    })

    it('dithers a frame with motion blur: each byte is the plain byte or one level above it, and many are above', async () => {
        const { job, frame, average } = await blurred()
        const plain = average.slice()
        bloom(plain, job.width, job.height, job.bloom, job.background, false)
        let lifted = 0, outside = 0
        for (let i = 0; i < frame.length; i++) {
            const step = frame[i]! - plain[i]!
            if (step === 1) lifted++
            else if (step !== 0) outside++
        }
        expect(outside).toBe(0)
        expect(lifted).toBeGreaterThan(500)
    })

    it('rasterizes equal neighbors among the sub-frames once, and averages them as if each had its own raster', async () => {
        const f = await fixture(true, 0), pool = new RasterPool(1)
        const a = f.compiled.frame(.1), b = f.compiled.frame(.6), c = f.compiled.frame(.9)
        const single = (frame: Frame) => pool.run(raw(framesToJob([frame], 97, background, 57)))
        try {
            const [pa, pb, pc] = [await single(a), await single(b), await single(c)]
            expect(pa).not.toEqual(pb)
            await writeFile(counter, '')
            // The average of the sub-frames, with the division and the rounding of a job that has no equal neighbors.
            const mean = (parts: Uint8Array[]) => Uint8Array.from(parts[0]!, (_, i) => parts.reduce((sum, part) => sum + part[i]!, 0) / parts.length + 0.5)
            expect(await pool.run(raw(framesToJob([a, a, b, b], 97, background, 57)))).toEqual(mean([pa, pa, pb, pb]))
            expect(await calls()).toBe(2)
            expect(await pool.run(raw(framesToJob([a, b, b, b, c], 97, background, 57)))).toEqual(mean([pa, pb, pb, pb, pc]))
            expect(await calls()).toBe(5)
            // Equal sub-frames that are not neighbors each get a raster. The result is the same.
            expect(await pool.run(raw(framesToJob([a, b, a], 97, background, 57)))).toEqual(mean([pa, pb, pa]))
            expect(await calls()).toBe(8)
            expect(await pool.run(raw(framesToJob([b, b, b], 97, background, 57)))).toEqual(pb)
            expect(await calls()).toBe(9)
            // Four sub-frames that all differ, as in a moving frame at the quality high: one pass adds the four.
            const d = f.compiled.frame(1.3), pd = await single(d)
            expect(pd).not.toEqual(pc)
            await writeFile(counter, '')
            expect(await pool.run(raw(framesToJob([a, b, c, d], 97, background, 57)))).toEqual(mean([pa, pb, pc, pd]))
            expect(await calls()).toBe(4)
            // More than four sub-frames that differ: the first four go to sums, and the rest join them.
            const times = [.05, .15, .25, .35, .45, .55, .65, .75, .85]
            const parts = [] as Uint8Array[]
            for (const time of times) parts.push(await single(f.compiled.frame(time)))
            await writeFile(counter, '')
            expect(await pool.run(raw(framesToJob(times.map(time => f.compiled.frame(time)), 97, background, 57)))).toEqual(mean(parts))
            expect(await calls()).toBe(9)
            // More than 257 sub-frames take the path with a 32-bit sum for each byte.
            const many = [...Array.from({ length: 130 }, () => a), ...Array.from({ length: 129 }, () => b)]
            expect(await pool.run(raw(framesToJob(many, 97, background, 57)))).toEqual(mean(many.map(frame => frame === a ? pa : pb)))
            expect(await calls()).toBe(11)
        } finally { await pool.close() }
    })
})

describe('a frame that is equal to the frame before', () => {
    // A mark that rests, moves for half a second, and rests again.
    const restMoveRest = () => compileFilm(film({ width: 128, height: 74, fps: 10, background: '#0b0c10', bloom: .8 }, s => {
        const mark = s.add(circle(8.125, { fill: 'blue', stroke: 'pink', width: 1.25 }).at(-30, 0).glow(1.2))
        s.update(mark, (node, time) => { node.at(-30 + 60 * Math.min(1, Math.max(0, (time - .5) / .5)), 0) })
        s.wait(1.5)
    }))

    it.skipIf(!hasFfmpeg).each([1, 3])('takes the pixels of that frame with no raster, with %i workers', async workers => {
        const compiled = await restMoveRest()
        // The frames that differ from the frame before them, counted here from the SVG text.
        let distinct = 0, last = ''
        for (let index = 0; index < 15; index++) {
            const svg = frameToSvg(compiled.frame(index / 10))
            if (svg !== last) distinct++
            last = svg
        }
        expect(distinct).toBeGreaterThan(3)
        expect(distinct).toBeLessThan(10)
        const video = await renderFilmVideo(compiled, join(directory, `reuse-${workers}.mp4`), { workers, quality: 'draft' })
        expect(video.frameCount).toBe(15)
        expect(await calls()).toBe(distinct)
        // With motion blur, each frame is a list of sub-frames. A list equal to the list before it has no raster,
        // and a list of equal sub-frames has one.
        await writeFile(counter, '')
        const still = await compileFilm(film({ width: 128, height: 74, fps: 10, background: '#0b0c10', bloom: .8 }, s => {
            s.add(circle(8.125, { fill: 'blue' }).glow(1.2))
            s.wait(1)
        }))
        await renderFilmVideo(still, join(directory, `still-${workers}.mp4`), { workers, quality: 'draft', motionBlur: 4 })
        expect(await calls()).toBe(1)
    }, 60_000)

    it('gives the same GIF with one worker and with three', async () => {
        const compiled = await restMoveRest()
        const one = await renderFilmGif(compiled, join(directory, 'one.gif'), { workers: 1 })
        const three = await renderFilmGif(compiled, join(directory, 'three.gif'), { workers: 3 })
        expect(one.frameCount).toBe(three.frameCount)
        expect(await readFile(three.outputPath)).toEqual(await readFile(one.outputPath))
    })

    it('compares only unchanged jobs of the serializer with embedded images, on every input', async () => {
        const f = await fixture(true)
        const a = f.compiled.frame(.1), b = f.compiled.frame(.6)
        const make = (frames = [a, a]) => framesToJob(frames, 97, background, 57)
        expect(sameRasterJob(make(), make())).toBe(true)
        expect(sameRasterJob(make(), make([a, b]))).toBe(false)
        expect(sameRasterJob(make(), make([a]))).toBe(false)
        for (const change of [
            (job: RasterJob) => { job.width = 99 }, (job: RasterJob) => { job.height = 59 }, (job: RasterJob) => { job.bloom = .1 },
            (job: RasterJob) => { job.background = [255, 255, 255] },
            (job: RasterJob) => { job.dither = false },
        ]) {
            const changed = make()
            change(changed)
            expect(sameRasterJob(make(), changed)).toBe(false)
        }
        // A copy of a job, and a job whose text changed after the serializer made it, are not trusted.
        expect(sameRasterJob(make(), raw(make()))).toBe(false)
        expect(sameRasterJob(raw(make()), make())).toBe(false)
        const edited = make()
        edited.svgs[0] = edited.svgs[0]!.replace('<svg ', '<svg id="changed" ')
        expect(sameRasterJob(edited, edited)).toBe(false)
        // An image from a file can change between two jobs with the same text. So can a resource that a
        // background or a style names, and the serializer admits only the values that it knows.
        const external = { ...a, ops: a.ops.map(op => op.kind === 'image' ? { ...op, image: { ...op.image, asset: undefined, crop: undefined } } : op) } as Frame
        const resource = { ...a, background: 'url(#not-a-color)' }
        const style = { ...a, ops: a.ops.map(op => op.kind === 'path' ? { ...op, blend: 'difference' as typeof op.blend } : op) } as Frame
        for (const frame of [external, resource, style]) {
            expect(sameRasterJob(framesToJob([frame], 97, background, 57), framesToJob([frame], 97, background, 57))).toBe(false)
        }
    })

    it.skipIf(process.platform === 'win32')('rasterizes again each frame that shows an image from a file, because the file can change', async () => {
        const filename = join(directory, 'changing.png')
        const png = (rgba: number[]) => encode({ width: 1, height: 1, channels: 4, depth: 8, data: Uint8Array.from(rgba) })
        const frame: Frame = { width: 4, height: 4, background: null, bloom: 0, dark: false, ops: [{
            kind: 'image', image: { src: filename, width: 4, height: 4 }, matrix: [1, 0, 0, 1, 0, 0], alpha: 1,
        }] }
        // A stand-in for a compiled film whose every frame is the same draw list, with the image not embedded.
        const still = { width: 4, height: 4, fps: 10, duration: 1.2, title: '', chapters: [], captions: [], frame: () => frame } as unknown as CompiledFilm
        // A stand-in for FFmpeg: it copies its input to its last argument, which is the output path.
        const encoder = join(directory, 'copy-input.sh')
        await writeFile(encoder, '#!/bin/sh\nfor last; do :; done\nexec cat > "$last"\n', { mode: 0o755 })
        await writeFile(filename, png([255, 0, 0, 255]))
        const output = await renderFilmVideo(still, join(directory, 'changing.raw'), {
            workers: 1, ffmpegPath: encoder,
            onProgress: async (info) => { if (info.index === 0) await writeFile(filename, png([0, 0, 255, 255])) },
        })
        const frames = await readFile(output.outputPath)
        expect(frames).toHaveLength(12 * 4 * 4 * 4)
        expect(Array.from(frames.subarray(0, 4))).toEqual([255, 0, 0, 255])
        expect(Array.from(frames.subarray(frames.length - 4))).toEqual([0, 0, 255, 255])
        expect(await calls()).toBe(12)
    })
})
