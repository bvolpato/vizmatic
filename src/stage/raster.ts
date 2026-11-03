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

export const RASTER_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const { Resvg } = require(workerData.resvgPath)

function downsample(src, w, h, factor) {
  const dw = Math.max(1, Math.floor(w / factor)), dh = Math.max(1, Math.floor(h / factor))
  const out = new Float32Array(dw * dh * 3)
  const norm = 1 / (factor * factor)
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0
      for (let yy = 0; yy < factor; yy++) {
        let o = ((y * factor + yy) * w + x * factor) * 4
        for (let xx = 0; xx < factor; xx++) { r += src[o]; g += src[o + 1]; b += src[o + 2]; o += 4 }
      }
      const i = (y * dw + x) * 3
      out[i] = r * norm; out[i + 1] = g * norm; out[i + 2] = b * norm
    }
  }
  return { data: out, w: dw, h: dh }
}

function boxBlur(img, radius) {
  const { data, w, h } = img
  const tmp = new Float32Array(data.length)
  const norm = 1 / (radius * 2 + 1)
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) sum += data[(y * w + Math.min(w - 1, Math.max(0, k))) * 3 + c]
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + c] = sum * norm
        sum += data[(y * w + Math.min(w - 1, x + radius + 1)) * 3 + c] - data[(y * w + Math.max(0, x - radius)) * 3 + c]
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) sum += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * 3 + c]
      for (let y = 0; y < h; y++) {
        data[(y * w + x) * 3 + c] = sum * norm
        sum += tmp[(Math.min(h - 1, y + radius + 1) * w + x) * 3 + c] - tmp[(Math.max(0, y - radius) * w + x) * 3 + c]
      }
    }
  }
}

// Bloom: bright marks spill soft light. Blurred layers add on top of the sharp image.
function bloom(pixels, w, h, amount, background) {
  const [br, bg, bb] = background
  const layers = []
  // The spread follows output width, so a small preview and a 4K master look alike.
  const k = w / 1920
  for (const [base, radius, weight] of [[4, 3, 0.55], [8, 4, 0.3], [16, 4, 0.15]]) {
    const factor = Math.max(1, Math.round(base * k))
    const layer = downsample(pixels, w, h, factor)
    const d = layer.data
    for (let i = 0; i < d.length; i += 3) {
      // Only light above the background contributes, so the page never lifts or fogs.
      d[i] = Math.max(0, d[i] - br); d[i + 1] = Math.max(0, d[i + 1] - bg); d[i + 2] = Math.max(0, d[i + 2] - bb)
    }
    boxBlur(layer, radius); boxBlur(layer, radius)
    layers.push({ ...layer, factor, weight })
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      let r = 0, g = 0, b = 0
      for (const layer of layers) {
        const fx = (x + 0.5) / layer.factor - 0.5, fy = (y + 0.5) / layer.factor - 0.5
        const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy))
        const x1 = Math.min(layer.w - 1, x0 + 1), y1 = Math.min(layer.h - 1, y0 + 1)
        const tx = Math.max(0, fx - x0), ty = Math.max(0, fy - y0)
        const d = layer.data, lw = layer.w
        for (let c = 0; c < 3; c++) {
          const v = (d[(y0 * lw + x0) * 3 + c] * (1 - tx) + d[(y0 * lw + x1) * 3 + c] * tx) * (1 - ty)
            + (d[(y1 * lw + x0) * 3 + c] * (1 - tx) + d[(y1 * lw + x1) * 3 + c] * tx) * ty
          if (c === 0) r += v * layer.weight
          else if (c === 1) g += v * layer.weight
          else b += v * layer.weight
        }
      }
      // Screen blend keeps highlights from clipping harshly.
      pixels[o] = 255 - (255 - pixels[o]) * (255 - Math.min(255, r * amount * 2.4)) / 255
      pixels[o + 1] = 255 - (255 - pixels[o + 1]) * (255 - Math.min(255, g * amount * 2.4)) / 255
      pixels[o + 2] = 255 - (255 - pixels[o + 2]) * (255 - Math.min(255, b * amount * 2.4)) / 255
    }
  }
}

function raster(svg, width, height) {
  const image = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render()
  if (image.height === height) return image.pixels
  // Rounding can differ by a row at unusual sizes. Keep the requested size exactly.
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = Math.min(image.height - 1, y) * width * 4
    out.set(image.pixels.subarray(row, row + width * 4), y * width * 4)
  }
  return out
}

parentPort.on('message', (job) => {
  try {
    let out
    if (job.svgs.length === 1) {
      out = new Uint8Array(raster(job.svgs[0], job.width, job.height))
    } else {
      // Motion blur: average sub-frames across the shutter.
      const n = job.svgs.length
      // Sixteen bits hold 257 full-white sub-frames, at half the memory of thirty-two.
      let sum = null
      for (const svg of job.svgs) {
        const px = raster(svg, job.width, job.height)
        if (!sum) sum = n <= 257 ? new Uint16Array(px.length) : new Uint32Array(px.length)
        for (let i = 0; i < px.length; i++) sum[i] += px[i]
      }
      out = new Uint8Array(sum.length)
      for (let i = 0; i < sum.length; i++) out[i] = sum[i] / n + 0.5
    }
    if (job.bloom > 0) bloom(out, job.width, job.height, job.bloom, job.background)
    parentPort.postMessage({ id: job.id, pixels: out }, [out.buffer])
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
}

interface Pending {
    resolve: (pixels: Uint8Array) => void
    reject: (error: Error) => void
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

    constructor(size = defaultPoolSize()) {
        const resvgPath = resolveResvg()
        for (let i = 0; i < size; i++) {
            const worker = new Worker(RASTER_WORKER_SOURCE, { eval: true, workerData: { resvgPath } })
            worker.on('message', (message: { id: number; pixels?: Uint8Array; error?: string }) => {
                const entry = this.pending.get(message.id)
                this.pending.delete(message.id)
                this.idle.push(worker)
                this.pump()
                if (!entry) return
                if (message.error || !message.pixels) entry.reject(new Error(`Frame rasterization failed: ${message.error}`))
                else entry.resolve(message.pixels)
            })
            worker.on('error', (error: unknown) => this.fail(error instanceof Error ? error : new Error(String(error))))
            this.workers.push(worker)
            this.idle.push(worker)
        }
    }

    get size(): number {
        return this.workers.length
    }

    private fail(error: Error): void {
        this.failure = error
        for (const entry of this.pending.values()) entry.reject(error)
        this.pending.clear()
    }

    private pump(): void {
        while (this.idle.length > 0 && this.queue.length > 0) {
            const worker = this.idle.pop()!
            const { job, id } = this.queue.shift()!
            worker.postMessage({ id, ...job })
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
        this.failure ??= new Error('The raster pool was closed.')
        for (const entry of this.pending.values()) entry.reject(this.failure)
        this.pending.clear()
        this.queue.length = 0
        await Promise.all(this.workers.map((worker) => worker.terminate()))
    }
}

export function defaultPoolSize(): number {
    return Math.max(1, Math.min(12, cpus().length - 2))
}

export function framesToJob(frames: readonly Frame[], width: number, parseBackground: (color: string | null) => readonly [number, number, number], height?: number): RasterJob {
    const first = frames[0]!
    const scale = width / first.width
    return {
        svgs: frames.map((frame) => frameToSvg(frame)),
        width,
        height: height ?? Math.round(first.height * scale),
        bloom: first.dark ? first.bloom : 0,
        background: parseBackground(first.background),
    }
}
