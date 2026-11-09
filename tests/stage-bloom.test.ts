import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { compileFilm, isFilm } from 'vizmatic/stage'
import { parseColor } from '../src/stage/color'
import { BLOOM_SOURCE } from '../src/stage/raster'

type Bloom = (pixels: Uint8Array, w: number, h: number, amount: number, background: readonly number[], dither?: boolean) => void

/**
 * The first version of the bloom, as the worker ran it before the fast one.
 * With dither off, the fast version must give the same bytes for every frame. Do not edit this reference.
 */
const FIRST_BLOOM_SOURCE = String.raw`
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
        // A layer drops the columns and rows that do not fill one of its cells, so it can end a few pixels
        // before the frame does. Those pixels read the last cell.
        const x0 = Math.min(layer.w - 1, Math.max(0, Math.floor(fx))), y0 = Math.min(layer.h - 1, Math.max(0, Math.floor(fy)))
        const x1 = Math.min(layer.w - 1, x0 + 1), y1 = Math.min(layer.h - 1, y0 + 1)
        const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0))
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
`

const build = (source: string) => new Function(`${source}; return bloom`)() as Bloom
const first = build(FIRST_BLOOM_SOURCE), fast = build(BLOOM_SOURCE)
const page = [11, 12, 16] as const

/** A small generator with a seed, so that a failure repeats. */
function random(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function noise(w: number, h: number): Uint8Array {
    const rand = random(w * 7919 + h), pixels = new Uint8Array(w * h * 4)
    for (let i = 0; i < pixels.length; i++) pixels[i] = rand() * 256
    return pixels
}

/** A dark page with a few bright rectangles, like a frame of a film: most of it has no light. */
function marks(w: number, h: number): Uint8Array {
    const rand = random(w * 104729 + h), pixels = new Uint8Array(w * h * 4)
    for (let i = 0; i < pixels.length; i += 4) pixels.set([page[0], page[1], page[2], 255], i)
    for (let n = 0; n < 12; n++) {
        const left = Math.floor(rand() * w), top = Math.floor(rand() * h)
        const right = Math.min(w, left + 1 + Math.floor(rand() * w / 8)), bottom = Math.min(h, top + 1 + Math.floor(rand() * h / 8))
        const color = [rand() * 256, rand() * 256, rand() * 256]
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) pixels.set(color, (y * w + x) * 4)
    }
    return pixels
}

/** Run both versions on copies of the pixels, and return the place of the first byte that differs, or -1. */
function firstDifference(pixels: Uint8Array, w: number, h: number, amount: number, background: readonly number[]): number {
    const expected = pixels.slice(), actual = pixels.slice()
    first(expected, w, h, amount, background)
    fast(actual, w, h, amount, background, false)
    if (Buffer.compare(expected, actual) === 0) return -1
    return expected.findIndex((value, index) => value !== actual[index])
}

// The widths of the brief, with one size that no layer divides, and one small frame.
const SIZES = [[640, 360], [1280, 720], [1920, 1080], [3840, 2160], [1283, 722], [97, 57]] as const

describe('fast bloom', () => {
    it.each(SIZES)('gives the bytes of the first version on random frames at %i by %i', (w, h) => {
        expect(firstDifference(noise(w, h), w, h, 0.6, page)).toBe(-1)
        expect(firstDifference(marks(w, h), w, h, 0.14, page)).toBe(-1)
        // A black page: every mark is light, and the gain is high enough to clip.
        expect(firstDifference(marks(w, h), w, h, 1.7, [0, 0, 0])).toBe(-1)
    }, 120_000)

    it('gives the bytes of the first version on frames of two films', async () => {
        const { Resvg } = createRequire(import.meta.url)('@resvg/resvg-js') as typeof import('@resvg/resvg-js')
        for (const [id, times] of [['lorenz', [8, 30]], ['fourier-epicycles', [30.5]]] as const) {
            const module = await import(`../examples/films/${id}.ts`) as { default: unknown }
            if (!isFilm(module.default)) throw new Error(`${id} has no film as its default export`)
            const film = await compileFilm(module.default, { look: 'midnight' })
            const background = parseColor(film.background!).slice(0, 3)
            for (const time of times) {
                const svg = film.svg(time)
                for (const [w] of SIZES) {
                    const image = new Resvg(svg, { fitTo: { mode: 'width', value: w }, font: { loadSystemFonts: false } }).render()
                    const pixels = new Uint8Array(image.pixels)
                    // The frame must have light, or the test compares nothing.
                    expect(pixels.some((value, index) => index % 4 === 0 && value > background[0]! + 40)).toBe(true)
                    expect([id, time, w, firstDifference(pixels, image.width, image.height, film.bloom, background)]).toEqual([id, time, w, -1])
                }
            }
        }
    }, 240_000)

    it('gives the bytes of the first version when the pixels do not start on a multiple of 4', () => {
        const w = 640, h = 360, source = marks(w, h)
        const expected = source.slice()
        first(expected, w, h, 0.5, page)
        // The fast version reads 32-bit numbers only from an aligned start. This start is not aligned.
        const shifted = new Uint8Array(source.length + 1).subarray(1)
        shifted.set(source)
        fast(shifted, w, h, 0.5, page, false)
        expect(Buffer.compare(expected, shifted)).toBe(0)
    })

    it.each([
        ['a gain that is not finite', Infinity, page],
        ['a gain below 0', -0.5, page],
        ['a page color that is not a whole number or a byte', 0.8, [10.5, 12.25, 300]],
        ['a page color that is not a number', 0.8, [NaN, 12, 16]],
    ] as const)('gives the bytes of the first version for %s', (_name, amount, background) => {
        for (const [w, h] of [[640, 360], [1283, 722]] as const) {
            expect(firstDifference(marks(w, h), w, h, amount, background)).toBe(-1)
            expect(firstDifference(noise(w, h), w, h, amount, background)).toBe(-1)
        }
    }, 60_000)

    it('keeps the order of the adds in the running sums of the blur', () => {
        // A page color just under the color of the pixels leaves a light of 1e-10 in every cell, next to
        // marks that are 1e12 times brighter. A sum of the two is not exact, so another order of the adds
        // gives another last bit, and a gain of 1e11 turns that bit into a byte. The small size shows the
        // order along the rows, and the large one the order along the columns.
        const background = page.map((value) => value - 1e-10)
        for (const [w, h] of [[640, 360], [1920, 1080]] as const) {
            expect([w, h, firstDifference(marks(w, h), w, h, 1e11, background)]).toEqual([w, h, -1])
        }
    }, 60_000)

    it('gives the bytes of the first version for a frame that is lower than a cell of a layer', () => {
        // The first version read past the end of such a frame, and every color came out as 0.
        for (const [w, h] of [[1920, 8], [333, 1], [2, 2], [16, 16]] as const) {
            expect([w, h, firstDifference(noise(w, h), w, h, 0.6, page)]).toEqual([w, h, -1])
            expect([w, h, firstDifference(marks(w, h), w, h, 0.14, page)]).toEqual([w, h, -1])
        }
    })

    it('dithers a whole span even when its brightest spill is less than one level', () => {
        const w = 32, h = 16, pixels = new Uint8Array(w * h * 4)
        for (let i = 0; i < pixels.length; i += 4) pixels.set([1, 1, 1, 255], i)
        const plain = pixels.slice()
        fast(plain, w, h, 0.2, [0, 0, 0], false)
        expect(plain).toEqual(pixels)
        fast(pixels, w, h, 0.2, [0, 0, 0], true)
        const colors = new Set<number>()
        for (let i = 0; i < pixels.length; i += 4) colors.add(pixels[i]!)
        expect(colors).toEqual(new Set([1, 2]))
    })

    it('leaves a frame with no light as it is', () => {
        const w = 640, h = 360, pixels = new Uint8Array(w * h * 4)
        for (let i = 0; i < pixels.length; i += 4) pixels.set([page[0], page[1], page[2], 255], i)
        const before = pixels.slice()
        fast(pixels, w, h, 0.6, page, true)
        expect(Buffer.compare(before, pixels)).toBe(0)
    })
})
