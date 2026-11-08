import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encode } from 'fast-png'
import { circle, compileFilm, film, image, resolveImageAsset, type Frame } from '../src/stage/index'
import { RasterPool, framesToJob, rasterMemoBytes, type RasterJob } from '../src/stage/raster'

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
    directory = await mkdtemp(join(tmpdir(), 'vizmatic-raster-memo-'))
    counter = join(directory, 'raster-calls')
    probe.wrapper = join(directory, 'resvg.cjs')
    const backend = createRequire(import.meta.url).resolve('@resvg/resvg-js')
    // Count actual native rasterizations without exposing production cache controls.
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

describe('exact worker raster memoization', () => {
    it('reuses a prepared static result after all four samples and owns its retained pixels', async () => {
        const f = await fixture(), pool = new RasterPool(1)
        const sample = (time: number) => framesToJob(Array.from({ length: 4 }, (_, i) => f.compiled.frame(time + i / 480)), 97, background, 57)
        try {
            const first = await pool.run(sample(.2)), expected = first.slice()
            expect(await calls()).toBe(4)
            first.fill(0)
            const second = await pool.run(sample(.3))
            expect(second).toEqual(expected)
            expect(await calls()).toBe(4)
            second.fill(255)
            expect(await pool.run(sample(.4))).toEqual(expected)
            expect(await calls()).toBe(4)
            expect(f.updates()).toBe(12)
            expect(await pool.run(raw(sample(.4)))).toEqual(expected)
            expect(await calls()).toBe(8)
        } finally { await pool.close() }
    })

    it.each([false, true])('matches uncached RGBA for moving subpixel/crop/alpha frames, transparent=%s', async transparent => {
        const f = await fixture(true, .7, transparent), pool = new RasterPool(1)
        try {
            for (const t of [.1, .45, .9]) {
                const job = framesToJob(Array.from({ length: 4 }, (_, i) => f.compiled.frame(t + i / 480)), 97, background, 57)
                const expected = await pool.run(raw(job)), actual = await pool.run(job)
                expect(actual).toEqual(expected)
                expect(actual).toHaveLength(97 * 57 * 4)
                expect(await pool.run(job)).toEqual(expected)
            }
            expect(await calls()).toBe(24)
            expect(f.updates()).toBe(12)
        } finally { await pool.close() }
    })

    it('invalidates for every raster/composite input rather than only the first shutter sample', async () => {
        const f = await fixture(true), pool = new RasterPool(1), reference = new RasterPool(1)
        const a = f.compiled.frame(.1), b = f.compiled.frame(.6)
        const make = (frames = [a, a, a, a]) => framesToJob(frames, 97, background, 57)
        const jobs = [make(), make([a, a, b, a]), make([b, a, a, a]), make()]
        const width = make(); width.width = 99; jobs.push(width)
        const height = make(); height.height = 59; jobs.push(height)
        const bloom = make(); bloom.bloom = .1; jobs.push(bloom)
        const color = make(); color.background = [255, 255, 255]; jobs.push(color)
        const count = make([a]); jobs.push(count)
        try {
            for (const job of jobs) {
                expect(await pool.run(job)).toEqual(await reference.run(raw(job)))
                expect(await pool.run(job)).toEqual(await reference.run(raw(job)))
            }
        } finally { await Promise.all([pool.close(), reference.close()]) }
    })

    it('does not trust flags on raw SVG jobs, unprepared resources, or changed queued factory jobs', async () => {
        const f = await fixture(), pool = new RasterPool(1)
        const job = () => framesToJob([f.compiled.frame(.2)], 97, background, 57)
        try {
            const forged = { ...raw(job()), memoize: true }
            await pool.run(forged); await pool.run(forged)
            expect(await calls()).toBe(2)
            const frame = f.compiled.frame(.2)
            const unprepared = { ...frame, ops: frame.ops.map(op => op.kind === 'image' ? { ...op, image: { ...op.image, asset: undefined, crop: undefined } } : op) } as Frame
            const external = framesToJob([unprepared], 97, background, 57)
            await pool.run(external); await pool.run(external)
            expect(await calls()).toBe(4)
            const blocker = pool.run(raw(job()))
            const changed = job(), queued = pool.run(changed)
            changed.svgs[0] = changed.svgs[0]!.replace('<svg ', '<svg id="changed" ')
            await blocker; await queued; await pool.run(changed)
            expect(await calls()).toBe(7)
        } finally { await pool.close() }
    })

    it('rereads an external image even when its SVG and job object are unchanged', async () => {
        const filename = join(directory, 'changing.png'), pool = new RasterPool(1)
        const png = (rgba: number[]) => encode({ width: 1, height: 1, channels: 4, depth: 8, data: Uint8Array.from(rgba) })
        const frame: Frame = { width: 4, height: 4, background: null, bloom: 0, dark: false, ops: [{
            kind: 'image', image: { src: filename, width: 4, height: 4 }, matrix: [1, 0, 0, 1, 0, 0], alpha: 1,
        }] }
        const job = framesToJob([frame], 4, background, 4)
        try {
            await writeFile(filename, png([255, 0, 0, 255]))
            expect(Array.from((await pool.run(job)).slice(0, 4))).toEqual([255, 0, 0, 255])
            await writeFile(filename, png([0, 0, 255, 255]))
            expect(Array.from((await pool.run(job)).slice(0, 4))).toEqual([0, 0, 255, 255])
            expect(await calls()).toBe(2)
        } finally { await pool.close() }
    })

    it('does not retain an oversized serialized key', async () => {
        const pool = new RasterPool(1)
        const frame: Frame = { width: 4, height: 4, background: '#fff' + ' '.repeat(4 * 1024 ** 2), bloom: 0, dark: false, ops: [] }
        const job = framesToJob([frame], 4, background, 4)
        try {
            expect(Array.from((await pool.run(job)).slice(0, 4))).toEqual([255, 255, 255, 255])
            expect(Array.from((await pool.run(job)).slice(0, 4))).toEqual([255, 255, 255, 255])
            expect(await calls()).toBe(2)
        } finally { await pool.close() }
    })

    it('bypasses raw resource-bearing background/style values and caps retained frame memory', async () => {
        const f = await fixture(), pool = new RasterPool(1)
        const base = f.compiled.frame(.2)
        const frame = { ...base, background: 'url(#not-a-color)' }
        const job = framesToJob([frame], 97, background, 57)
        try {
            await pool.run(job); await pool.run(job)
            expect(await calls()).toBe(2)
            const nonEnumStyle: Frame = { ...base, ops: base.ops.map(op => op.kind === 'path' ? { ...op, blend: 'difference' as typeof op.blend } : op) }
            const styled = framesToJob([nonEnumStyle], 97, background, 57)
            await pool.run(styled); await pool.run(styled)
            expect(await calls()).toBe(4)
            expect(rasterMemoBytes(3840, 2160)).toBe(3840 * 2160 * 4 + 8 * 1024 ** 2)
            expect(rasterMemoBytes(7680, 4320)).toBe(0)
        } finally { await pool.close() }
    })
})
