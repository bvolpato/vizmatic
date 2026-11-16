/**
 * Node export: SVG frames rasterize on worker threads with resvg, and the
 * results reach the encoder in order. The worker source is a string, so it runs
 * unchanged from the ESM build, the CommonJS build, tsx, and tests.
 */
import { createRequire } from 'node:module'
import { cpus } from 'node:os'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { frameToSvg, type Frame } from './display'
import { isImageAsset } from './image'
import parseCssColor from 'parse-css-color'
import { createBloom } from './bloom-kernel.mjs'

// Only this serializer can admit a job for reuse. A copy of a job, or a job whose SVG changed, must
// not share the pixels of a file or a URL whose bytes can change between two equal jobs.
const embeddedJobs = new WeakMap<RasterJob, readonly string[]>()

function embeddedResources(frame: Frame): boolean {
    if (typeof frame.width !== 'number' || typeof frame.height !== 'number') return false
    if (frame.background !== null && (typeof frame.background !== 'string' || !parseCssColor(frame.background))) return false
    for (const op of frame.ops) {
        if (op.kind === 'image') {
            const { asset, src, width, height } = op.image
            if ((!op.image.pixels && (!isImageAsset(asset) || src !== asset.src)) || typeof width !== 'number' || typeof height !== 'number') return false
            if (op.blend !== undefined && !['normal', 'screen', 'multiply', 'overlay'].includes(op.blend)) return false
        } else {
            if (!['normal', 'screen', 'multiply', 'overlay'].includes(op.blend)) return false
            if (!['round', 'butt', 'square'].includes(op.cap) || !['round', 'miter', 'bevel'].includes(op.join)) return false
        }
    }
    return true
}

/**
 * The bloom pass of the worker, as source text. Tests build the same function from this text, and compare it
 * with the first version of the function.
 */
// tsx/esbuild can retain function names with this helper. The serialized kernel
// must supply it itself because a worker cannot close over the importing module.
export const BLOOM_SOURCE = `const __name = (fn, name) => Object.defineProperty(fn, 'name', { value: name, configurable: true }); const bloom = (${createBloom.toString()})()`

export const RASTER_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const { Resvg } = require(workerData.resvgPath)

${BLOOM_SOURCE}
function raster(svg, width, height) {
  const image = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render()
  // Each read of the pixels makes a copy of the whole image, so read them once.
  const pixels = image.pixels
  if (image.height === height) return pixels
  // Rounding can differ by a row at unusual sizes. Keep the requested size exactly.
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = Math.min(image.height - 1, y) * width * 4
    out.set(pixels.subarray(row, row + width * 4), y * width * 4)
  }
  return out
}

// The pixels of a sub-frame as 32-bit numbers. Such a view needs a start on a multiple of 4.
function pixelWords(px) {
  if (px.byteOffset % 4 !== 0) px = new Uint8Array(px)
  return new Uint32Array(px.buffer, px.byteOffset, px.length >> 2)
}

// Add up to four sub-frames, each times its count, in one pass over the memory. One number holds the sums
// of two bytes of a pixel in its two halves, and a second number holds the other two bytes.
// With a table, write the bytes of the average to the output. Without one, add to the sums.
function addSubFrames(group, counts, low, high, table, out) {
  const a = group[0], b = group[1] || a, c = group[2] || a, d = group[3] || a
  const ca = counts[0], cb = counts[1] || 0, cc = counts[2] || 0, cd = counts[3] || 0
  if (!table) {
    for (let i = 0; i < a.length; i++) {
      const va = a[i], vb = b[i], vc = c[i], vd = d[i]
      low[i] += (va & 0xff00ff) * ca + (vb & 0xff00ff) * cb + (vc & 0xff00ff) * cc + (vd & 0xff00ff) * cd
      high[i] += ((va >>> 8) & 0xff00ff) * ca + ((vb >>> 8) & 0xff00ff) * cb + ((vc >>> 8) & 0xff00ff) * cc + ((vd >>> 8) & 0xff00ff) * cd
    }
    return
  }
  for (let i = 0; i < a.length; i++) {
    const va = a[i], vb = b[i], vc = c[i], vd = d[i]
    const l = (va & 0xff00ff) * ca + (vb & 0xff00ff) * cb + (vc & 0xff00ff) * cc + (vd & 0xff00ff) * cd
    const h = ((va >>> 8) & 0xff00ff) * ca + ((vb >>> 8) & 0xff00ff) * cb + ((vc >>> 8) & 0xff00ff) * cc + ((vd >>> 8) & 0xff00ff) * cd
    // Each byte goes back to the place in the number that it came from, so the order of the bytes in
    // memory does not matter.
    out[i] = table[l & 0xffff] | table[h & 0xffff] << 8 | table[l >>> 16] << 16 | table[h >>> 16] << 24
  }
}

// Motion blur: the average of the sub-frames across the shutter.
function average(svgs, width, height, clock) {
  const n = svgs.length
  // Up to 257 sub-frames, the sum of a byte fits in 16 bits, so two sums share one 32-bit number.
  const packed = n <= 257
  let group = [], counts = [], low = null, high = null, sum = null
  for (let k = 0; k < n;) {
    // Sub-frames next to each other with the same SVG text give the same pixels. Rasterize the text once,
    // and count it once for each of them.
    let count = 1
    while (k + count < n && svgs[k + count] === svgs[k]) count++
    const before = performance.now()
    const px = raster(svgs[k], width, height)
    clock.rasterMs += performance.now() - before
    // The average of equal sub-frames is the sub-frame.
    if (count === n) return new Uint8Array(px)
    if (!packed) {
      if (!sum) sum = new Uint32Array(px.length)
      for (let i = 0; i < px.length; i++) sum[i] += px[i] * count
    } else {
      if (group.length === 4) {
        // A fifth sub-frame arrives. Add the four before it to the sums, so that no more than four
        // sub-frames stay in memory.
        if (!low) { low = new Uint32Array(width * height); high = new Uint32Array(width * height) }
        addSubFrames(group, counts, low, high, null, null)
        group = []; counts = []
      }
      group.push(pixelWords(px)); counts.push(count)
    }
    k += count
  }
  // A sum has one result. A table gives the division and the rounding once for each sum, not for each byte.
  const table = new Uint8Array(255 * n + 1)
  for (let i = 0; i < table.length; i++) table[i] = i / n + 0.5
  const out = new Uint8Array(width * height * 4), words = new Uint32Array(out.buffer)
  if (!packed) {
    for (let i = 0; i < out.length; i++) out[i] = table[sum[i]]
  } else if (!low) {
    // Four sub-frames or fewer, as at the quality high. One pass gives the result, with no sums in memory.
    addSubFrames(group, counts, null, null, table, words)
  } else {
    addSubFrames(group, counts, low, high, null, null)
    for (let i = 0; i < words.length; i++) {
      const l = low[i], h = high[i]
      words[i] = table[l & 0xffff] | table[h & 0xffff] << 8 | table[l >>> 16] << 16 | table[h >>> 16] << 24
    }
  }
  return out
}

parentPort.on('message', (job) => {
  try {
    // The time of each step goes back with the pixels, for the export benchmark.
    const clock = { rasterMs: 0 }
    const started = performance.now()
    let out
    if (job.svgs.length === 1) {
      out = new Uint8Array(raster(job.svgs[0], job.width, job.height))
      clock.rasterMs = performance.now() - started
    } else {
      out = average(job.svgs, job.width, job.height, clock)
    }
    const averageMs = performance.now() - started - clock.rasterMs
    const beforeBloom = performance.now()
    // With motion blur, the bloom and its dither come once, after the average of the shutter samples. The
    // average cuts each value to a whole level, so grain in a sample would not reach the frame. The bloom is
    // the last write before the encoder, so nothing after it rounds the grain away.
    if (job.bloom > 0) bloom(out, job.width, job.height, job.bloom, job.background, job.dither !== false)
    const bloomMs = performance.now() - beforeBloom
    parentPort.postMessage({ id: job.id, pixels: out, rasterMs: clock.rasterMs, averageMs, bloomMs }, [out.buffer])
  } catch (error) {
    parentPort.postMessage({ id: job.id, error: String(error && error.message || error) })
  }
})
`

export interface RasterJob {
    svgs: string[]
    width: number
    height: number
    bloom: number
    /** Background color in 0-255 RGB. Light above it blooms. */
    background: readonly [number, number, number]
    /**
     * Round the light of the bloom to whole levels with a fixed pattern of thresholds, so that soft light
     * has fine grain and no contour lines. On unless false. The pattern depends on the place of a pixel
     * only, so two equal jobs give the same bytes. The export turns it off for a GIF, whose palette cannot
     * hold the grain, and for a movie at `draft` or `standard` that does not ask for it.
     */
    dither?: boolean
}

interface Pending {
    resolve: (pixels: Uint8Array) => void
    reject: (error: Error) => void
}

/**
 * Where the time of an export goes. `scripts/bench-export.ts` prints it.
 * It is internal, and it can change with the export path.
 */
export interface ExportStats {
    workers: number
    /** Frames that a worker rasterized. */
    computed: number
    /** Frames that took the pixels of the frame before. No worker saw them. */
    reused: number
    /** Main thread: `film.frame()`, `frameToSvg`, the comparison with the frame before, and the message to a worker. */
    mainMs: number
    /** Worker threads, added over all workers: resvg, the average of the sub-frames of motion blur, and the bloom. */
    rasterMs: number
    averageMs: number
    bloomMs: number
    /** The export loop waits for the next frame in order. */
    frameWaitMs: number
    /** The export loop waits for the encoder to take a frame. */
    encoderWaitMs: number
    /** From the last frame to the finished file. */
    encoderFinishMs: number
}

let statsListener: ((stats: ExportStats) => void) | undefined

/** Internal. Set a listener to read the stats of each export when it ends. Pass undefined to remove it. */
export function onExportStats(listener: ((stats: ExportStats) => void) | undefined): void {
    statsListener = listener
}

/** Internal. An export calls it once, when it ends. */
export function reportExportStats(stats: ExportStats): void {
    statsListener?.(stats)
}

interface WorkerReply {
    id: number
    pixels?: Uint8Array
    error?: string
    rasterMs?: number
    averageMs?: number
    bloomMs?: number
}

function resolveResvg(): string {
    const here = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
    return createRequire(here).resolve('@resvg/resvg-js')
}

/** A pool of rasterizer threads. Jobs may finish in any order. */
export class RasterPool {
    private readonly workers: Worker[] = []
    private readonly idle: Worker[] = []
    private readonly queue: { job: RasterJob; id: number }[] = []
    private readonly pending = new Map<number, Pending>()
    private nextId = 1
    private failure: Error | null = null
    private closing = false
    /** Counts and times of the jobs of this pool. The export adds its own waits. */
    readonly stats: ExportStats = {
        workers: 0, computed: 0, reused: 0, mainMs: 0,
        rasterMs: 0, averageMs: 0, bloomMs: 0, frameWaitMs: 0, encoderWaitMs: 0, encoderFinishMs: 0,
    }

    constructor(size = defaultPoolSize()) {
        const resvgPath = resolveResvg()
        this.stats.workers = size
        for (let i = 0; i < size; i++) {
            // This string is CommonJS even when its caller used node --input-type=module.
            const execArgv = process.execArgv.filter((arg, i, args) => arg !== '--input-type' && !arg.startsWith('--input-type=') && args[i - 1] !== '--input-type')
            const worker = new Worker(RASTER_WORKER_SOURCE, { eval: true, execArgv, workerData: { resvgPath } })
            worker.on('message', (message: WorkerReply) => {
                const entry = this.pending.get(message.id)
                this.pending.delete(message.id)
                if (!this.failure && !this.closing) {
                    this.idle.push(worker)
                    this.pump()
                }
                if (!entry) return
                if (message.error || !message.pixels) {
                    entry.reject(new Error(`Frame rasterization failed: ${message.error}`))
                    return
                }
                this.stats.computed++
                this.stats.rasterMs += message.rasterMs ?? 0
                this.stats.averageMs += message.averageMs ?? 0
                this.stats.bloomMs += message.bloomMs ?? 0
                entry.resolve(message.pixels)
            })
            worker.on('error', (error: unknown) => this.fail(error instanceof Error ? error : new Error(String(error))))
            worker.on('exit', (code: number) => {
                if (this.closing) return
                const index = this.idle.indexOf(worker)
                if (index >= 0) this.idle.splice(index, 1)
                if (code !== 0 || this.pending.size > 0 || this.queue.length > 0) {
                    this.fail(new Error(`Raster worker exited unexpectedly with code ${code}.`))
                }
            })
            this.workers.push(worker)
            this.idle.push(worker)
        }
    }

    get size(): number {
        return this.workers.length
    }

    private fail(error: Error): void {
        this.failure ??= error
        this.queue.length = 0
        this.idle.length = 0
        for (const entry of this.pending.values()) entry.reject(this.failure)
        this.pending.clear()
    }

    private pump(): void {
        if (this.failure || this.closing) return
        while (this.idle.length > 0 && this.queue.length > 0) {
            const worker = this.idle.pop()!
            const { job, id } = this.queue.shift()!
            // The message copies the SVG text to the worker, on this thread.
            const started = performance.now()
            worker.postMessage({ id, ...job })
            this.stats.mainMs += performance.now() - started
        }
    }

    run(job: RasterJob): Promise<Uint8Array> {
        if (this.failure) return Promise.reject(this.failure)
        const id = this.nextId++
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
            this.queue.push({ job, id })
            this.pump()
        })
    }

    async close(): Promise<void> {
        this.closing = true
        this.fail(new Error('The raster pool was closed.'))
        await Promise.all(this.workers.map((worker) => worker.terminate()))
    }
}

/**
 * True when job b gives the same pixels as job a, so b can take the pixels of a.
 * Both jobs must come from `framesToJob` unchanged, with all their images embedded. A file or a URL can
 * change between two jobs with the same SVG text, so a job that reads one is never equal to another.
 */
export function sameRasterJob(a: RasterJob, b: RasterJob): boolean {
    const admitted = (job: RasterJob): boolean => {
        const original = embeddedJobs.get(job)
        return !!original && original.length === job.svgs.length && original.every((svg, i) => svg === job.svgs[i])
    }
    return a.width === b.width && a.height === b.height && a.bloom === b.bloom && (a.dither !== false) === (b.dither !== false)
        && a.background.length === b.background.length && a.background.every((channel, i) => channel === b.background[i])
        && a.svgs.length === b.svgs.length && admitted(a) && admitted(b) && a.svgs.every((svg, i) => svg === b.svgs[i])
}

export function defaultPoolSize(): number {
    return Math.max(1, Math.min(12, cpus().length - 2))
}

export function framesToJob(frames: readonly Frame[], width: number, parseBackground: (color: string | null) => readonly [number, number, number], height?: number, dither = true): RasterJob {
    const first = frames[0]!
    const scale = width / first.width
    const job: RasterJob = {
        svgs: frames.map((frame) => frameToSvg(frame)),
        width,
        height: height ?? Math.round(first.height * scale),
        bloom: first.dark ? first.bloom : 0,
        background: parseBackground(first.background),
        dither,
    }
    if (frames.every(embeddedResources)) embeddedJobs.set(job, job.svgs.slice())
    return job
}
