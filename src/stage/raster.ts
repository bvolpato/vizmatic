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

// Only this serializer can admit a job for reuse. A copy of a job, or a job whose SVG changed, must
// not share the pixels of a file or a URL whose bytes can change between two equal jobs.
const embeddedJobs = new WeakMap<RasterJob, readonly string[]>()

function embeddedResources(frame: Frame): boolean {
    if (typeof frame.width !== 'number' || typeof frame.height !== 'number') return false
    if (frame.background !== null && (typeof frame.background !== 'string' || !parseCssColor(frame.background))) return false
    for (const op of frame.ops) {
        if (op.kind === 'image') {
            const { asset, src, width, height } = op.image
            if (!isImageAsset(asset) || src !== asset.src || typeof width !== 'number' || typeof height !== 'number') return false
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
export const BLOOM_SOURCE = String.raw`
// A run of 16 pixels of a row. The bloom decides for each span if it has work to do.
const SPAN = 16
// The pixels as 32-bit numbers hold red in the low byte only where the low byte is first in memory.
const LOW_BYTE_FIRST = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

// One layer of the bloom: the mean color of each cell of factor by factor pixels, less the background.
// The sums of the cells stay with the layer, so a coarser layer can add them in place of the pixels.
function downsample(src, words, w, factor, lw, lh, background, finer) {
  const data = new Float32Array(lw * lh * 3), sums = new Int32Array(lw * lh * 3)
  const row = lw * 3
  if (finer) {
    // Whole cells of the finer layer tile each cell of this one. A sum of whole numbers is exact in any order.
    const step = factor / finer.factor, from = finer.sums, fromRow = finer.lw * 3
    for (let y = 0; y < lh; y++) {
      for (let yy = 0; yy < step; yy++) {
        let i = y * row, o = (y * step + yy) * fromRow
        for (let x = 0; x < lw; x++, i += 3) {
          let r = 0, g = 0, b = 0
          for (let xx = 0; xx < step; xx++, o += 3) { r += from[o]; g += from[o + 1]; b += from[o + 2] }
          sums[i] += r; sums[i + 1] += g; sums[i + 2] += b
        }
      }
    }
  } else if (words && factor <= 257) {
    // One load for each pixel. Red and blue add up in the two halves of one number, and green in a second one.
    // A half holds a row of 257 pixels at most.
    for (let y = 0; y < lh; y++) {
      for (let yy = 0; yy < factor; yy++) {
        let i = y * row, o = (y * factor + yy) * w
        for (let x = 0; x < lw; x++, i += 3) {
          let rb = 0, g = 0
          for (let xx = 0; xx < factor; xx++, o++) { const v = words[o]; rb += v & 0xff00ff; g += v & 0xff00 }
          sums[i] += rb & 0xffff; sums[i + 1] += g >>> 8; sums[i + 2] += rb >>> 16
        }
      }
    }
  } else {
    for (let y = 0; y < lh; y++) {
      for (let yy = 0; yy < factor; yy++) {
        let i = y * row, o = (y * factor + yy) * w * 4
        for (let x = 0; x < lw; x++, i += 3) {
          let r = 0, g = 0, b = 0
          for (let xx = 0; xx < factor; xx++, o += 4) { r += src[o]; g += src[o + 1]; b += src[o + 2] }
          sums[i] += r; sums[i + 1] += g; sums[i + 2] += b
        }
      }
    }
  }
  const norm = 1 / (factor * factor), br = background[0], bg = background[1], bb = background[2]
  for (let i = 0; i < data.length; i += 3) {
    // Only light above the background contributes, so the page never lifts or fogs.
    // The mean is rounded to 32 bits before the background comes off, as when the layer stored it first.
    data[i] = Math.max(0, Math.fround(sums[i] * norm) - br)
    data[i + 1] = Math.max(0, Math.fround(sums[i + 1] * norm) - bg)
    data[i + 2] = Math.max(0, Math.fround(sums[i + 2] * norm) - bb)
  }
  return { data, sums, lw, lh, factor }
}

// Box blur in place, along the rows and then along the columns. Each running sum adds and takes away its
// values in the order of the first version, so that the last bit of each result stays the same.
function boxBlur(data, tmp, sums, w, h, radius) {
  const norm = 1 / (radius * 2 + 1), row = w * 3, last = w - 1, bottom = h - 1
  for (let y = 0; y < h; y++) {
    const base = y * row
    let r = 0, g = 0, b = 0
    for (let k = -radius; k <= radius; k++) {
      const i = base + (k < 0 ? 0 : k < last ? k : last) * 3
      r += data[i]; g += data[i + 1]; b += data[i + 2]
    }
    for (let x = 0, o = base; x < w; x++, o += 3) {
      tmp[o] = r * norm; tmp[o + 1] = g * norm; tmp[o + 2] = b * norm
      const hi = base + (x + radius < last ? x + radius + 1 : last) * 3, lo = base + (x > radius ? x - radius : 0) * 3
      r += data[hi] - data[lo]; g += data[hi + 1] - data[lo + 1]; b += data[hi + 2] - data[lo + 2]
    }
  }
  // The columns go a row at a time, with one running sum for each column. That reads the memory in order.
  sums.fill(0, 0, row)
  for (let k = -radius; k <= radius; k++) {
    const base = (k < 0 ? 0 : k < bottom ? k : bottom) * row
    for (let i = 0; i < row; i++) sums[i] += tmp[base + i]
  }
  for (let y = 0; y < h; y++) {
    const base = y * row
    const hi = (y + radius < bottom ? y + radius + 1 : bottom) * row, lo = (y > radius ? y - radius : 0) * row
    for (let i = 0; i < row; i++) {
      data[base + i] = sums[i] * norm
      sums[i] += tmp[hi + i] - tmp[lo + i]
    }
  }
}

// The thresholds of the dither for one frame size: a byte for each pixel, from interleaved gradient noise
// (Jimenez, 2014). The byte k stands for the threshold (k + 0.5) / 256, so a threshold is never 0 and never 1.
// The table depends on the place of a pixel only, so a frame is the same in every frame and on every run.
// A worker keeps the table of its last size: a film has one size, and the table costs more than a frame to make.
let grainBytes = null, grainWidth = 0, grainHeight = 0
function grainOf(w, h) {
  if (grainBytes && grainWidth === w && grainHeight === h) return grainBytes
  const bytes = new Uint8Array(w * h)
  for (let y = 0, i = 0; y < h; y++) {
    const down = 0.00583715 * y
    for (let x = 0; x < w; x++, i++) {
      const place = 0.06711056 * x + down
      const noise = 52.9829189 * (place - Math.floor(place))
      bytes[i] = (noise - Math.floor(noise)) * 256
    }
  }
  grainBytes = bytes; grainWidth = w; grainHeight = h
  return bytes
}

// Bloom: bright marks spill soft light. Blurred layers add on top of the sharp image.
//
// In the plain write, each expression keeps the order of the first version of this function, which looped over
// each pixel, layer and channel. So the bytes are the same. tests/stage-bloom.test.ts keeps that version and
// compares.
//
// The light is a smooth ramp over a few of the 256 levels of a channel. The plain write cuts each value down
// to a whole level, which draws a contour line where the ramp passes a level. With a dither, the write first
// adds the threshold of the pixel, which is between 0 and 1. Each pixel then goes to the level below or above
// in the right share, and a line becomes fine grain. What holds for each pixel and channel:
// - With no light, the value is the whole number of the byte, and a threshold below 1 leaves it there.
// - The byte is the byte of the plain write, or one level above it. The dithered blend is the same sum in
//   another order, so it is the plain value give or take 1e-9, and a threshold is 0.002 or more from 0 and 1.
// - Over the 256 thresholds, the mean of the byte is the value, give or take 1/512 of a level.
// - A pixel with alpha 0 gets no threshold, so it has no grain: a film with no page stays clean where nothing
//   is drawn.
function bloom(pixels, w, h, amount, background, dither) {
  const layers = []
  // The spread follows output width, so a small preview and a 4K master look alike.
  const k = w / 1920
  const words = LOW_BYTE_FIRST && pixels.byteOffset % 4 === 0 ? new Uint32Array(pixels.buffer, pixels.byteOffset, w * h) : null
  for (const [base, radius, weight] of [[4, 3, 0.55], [8, 4, 0.3], [16, 4, 0.15]]) {
    const factor = Math.max(1, Math.round(base * k))
    const lw = Math.max(1, Math.floor(w / factor)), lh = Math.max(1, Math.floor(h / factor))
    if (lw * factor > w || lh * factor > h) {
      // The frame is lower than one cell of this layer. The first version read past the end of the pixels
      // here, and every color of the frame came out as 0. Keep that result until the defect has its own fix.
      for (let i = 0; i < w * h * 4; i += 4) { pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0 }
      return
    }
    let finer = null
    for (const layer of layers) if (factor % layer.factor === 0) finer = layer
    const layer = downsample(pixels, words, w, factor, lw, lh, background, finer)
    layer.radius = radius
    layer.weight = weight
    layers.push(layer)
  }
  const tmp = new Float32Array(layers.reduce((most, layer) => Math.max(most, layer.data.length), 0))
  const sums = new Float64Array(w * 3)
  for (const layer of layers) {
    boxBlur(layer.data, tmp, sums, layer.lw, layer.lh, layer.radius)
    boxBlur(layer.data, tmp, sums, layer.lw, layer.lh, layer.radius)
  }

  const spans = Math.ceil(w / SPAN)
  for (const layer of layers) {
    const { lw, factor } = layer
    // For each x of the frame: the two cells of the layer that it reads, and how much of each.
    const x0 = new Int32Array(w), x1 = new Int32Array(w), tx = new Float64Array(w), sx = new Float64Array(w)
    for (let x = 0; x < w; x++) {
      const fx = (x + 0.5) / factor - 0.5
      // A layer drops the columns and rows that do not fill one of its cells, so it can end a few pixels
      // before the frame does. Those pixels read the last cell.
      const a = Math.min(lw - 1, Math.max(0, Math.floor(fx))), b = Math.min(lw - 1, a + 1)
      const t = Math.min(1, Math.max(0, fx - a))
      x0[x] = a * 3; x1[x] = b * 3; tx[x] = t; sx[x] = 1 - t
    }
    layer.x0 = x0; layer.x1 = x1; layer.tx = tx; layer.sx = sx
    // Two rows of the layer, each stretched to the width of the frame. A row of the frame mixes the two.
    // The mix along x of one row of the layer is the same for each row of the frame that reads it.
    layer.rows = [new Float64Array(w * 3), new Float64Array(w * 3)]
    // The most light in the cells that each span of a stretched row reads.
    layer.most = [new Float64Array(spans), new Float64Array(spans)]
    layer.held = [-1, -1]
    layer.top = -1; layer.low = -1; layer.ty = 0; layer.sy = 0
  }
  // Stretch one row of a layer into one of its two slots.
  const stretch = (layer, index, slot) => {
    const { data, x0, x1, tx, sx } = layer
    const out = layer.rows[slot], most = layer.most[slot], base = index * layer.lw * 3
    layer.held[slot] = index
    for (let span = 0; span < spans; span++) {
      const from = span * SPAN, to = Math.min(w, from + SPAN)
      let top = 0, least = 0
      for (let i = base + x0[from], end = base + x1[to - 1] + 3; i < end; i++) {
        const v = data[i]
        top = Math.max(top, v); least = Math.min(least, v)
      }
      // A value below 0 can come from the running sums of the blur, and it darkens a pixel. Such a span,
      // or one with a value that is not a number, has no limit, so it is always computed.
      most[span] = least >= 0 ? top : Infinity
      if (top === 0 && least === 0) { out.fill(0, from * 3, to * 3); continue }
      for (let x = from, o = from * 3; x < to; x++, o += 3) {
        const a = base + x0[x], b = base + x1[x], t = tx[x], s = sx[x]
        out[o] = data[a] * s + data[b] * t
        out[o + 1] = data[a + 1] * s + data[b + 1] * t
        out[o + 2] = data[a + 2] * s + data[b + 2] * t
      }
    }
  }

  const l0 = layers[0], l1 = layers[1], l2 = layers[2]
  const w0 = l0.weight, w1 = l1.weight, w2 = l2.weight
  // The runs of pixels that a row computes, as pairs of a start and an end.
  const runs = new Int32Array(spans * 2)
  // With a dither, for each run: -1 where the plain write changes a byte, so each pixel has work. For a dim
  // span, the least threshold byte that can lift a pixel of the span.
  const leasts = dither ? new Int16Array(spans) : null
  const grain = dither ? grainOf(w, h) : null
  // The pixels of a dim span that have work.
  const picks = new Int32Array(SPAN)
  const STEP = 1 / 256, HALF = 0.5 / 256, INV = 1 / 255, gain = amount * 2.4
  let count = 0
  for (let y = 0; y < h; y++) {
    let moved = false
    for (const layer of layers) {
      const fy = (y + 0.5) / layer.factor - 0.5
      const y0 = Math.min(layer.lh - 1, Math.max(0, Math.floor(fy))), y1 = Math.min(layer.lh - 1, y0 + 1)
      layer.ty = Math.min(1, Math.max(0, fy - y0)); layer.sy = 1 - layer.ty
      let top = layer.held[0] === y0 ? 0 : layer.held[1] === y0 ? 1 : -1
      if (top < 0) { top = layer.held[0] === y1 ? 1 : 0; stretch(layer, y0, top); moved = true }
      let low = layer.held[0] === y1 ? 0 : layer.held[1] === y1 ? 1 : -1
      if (low < 0) { low = 1 - top; stretch(layer, y1, low); moved = true }
      layer.top = top; layer.low = low
    }
    if (moved) {
      // A layer took a new row, so find again the spans that have work. At the last rows of the frame a
      // layer can read one row twice with no new row. The runs before that still cover all the work.
      //
      // The blend of a channel is 255 - (255 - p) * (255 - m) / 255. There p is the byte of the pixel, and m
      // is the light of the three layers times the gain. The result goes to a byte, which drops its fraction.
      // For m from 0 to just under 1, the result is from p to just under p + 1, so the byte stays p.
      // The light of a layer at a pixel is a mix of four cells, so it is not more than the most of them, and
      // not below 0 when none of them is. So a span whose limit of m is from 0 to 0.999 keeps every byte.
      const m0 = l0.most[l0.top], n0 = l0.most[l0.low], m1 = l1.most[l1.top], n1 = l1.most[l1.low], m2 = l2.most[l2.top], n2 = l2.most[l2.low]
      count = 0
      for (let span = 0; span < spans; span++) {
        const c0 = m0[span] > n0[span] ? m0[span] : n0[span], c1 = m1[span] > n1[span] ? m1[span] : n1[span], c2 = m2[span] > n2[span] ? m2[span] : n2[span]
        const limit = (c0 * w0 + c1 * w1 + c2 * w2) * amount * 2.4
        const dim = limit >= 0 && limit < 0.999
        const from = span * SPAN, to = Math.min(w, from + SPAN)
        if (!leasts) {
          if (dim) continue
          if (count > 0 && runs[count - 1] === from) runs[count - 1] = to
          else { runs[count] = from; runs[count + 1] = to; count += 2 }
          continue
        }
        // With a dither, a span with no light at all keeps every byte. A dim span is a run of its own. There a
        // pixel gets less light than the limit, so its byte goes up only when its threshold and the limit pass
        // 1: that is from the threshold byte least. A limit under half a threshold step lifts no pixel.
        if (limit === 0) continue
        if (dim) {
          const least = Math.ceil((0.999999 - limit) * 256 - 0.5)
          if (least > 255) continue
          runs[count] = from; runs[count + 1] = to; leasts[count >> 1] = least; count += 2
        } else if (count > 0 && runs[count - 1] === from && leasts[(count >> 1) - 1] < 0) runs[count - 1] = to
        else { runs[count] = from; runs[count + 1] = to; leasts[count >> 1] = -1; count += 2 }
      }
    }
    const a0 = l0.rows[l0.top], b0 = l0.rows[l0.low], a1 = l1.rows[l1.top], b1 = l1.rows[l1.low], a2 = l2.rows[l2.top], b2 = l2.rows[l2.low]
    const s0 = l0.sy, t0 = l0.ty, s1 = l1.sy, t1 = l1.ty, s2 = l2.sy, t2 = l2.ty
    const line = y * w * 4
    if (!leasts) {
      for (let n = 0; n < count; n += 2) {
        for (let o = runs[n] * 3, p = line + runs[n] * 4, end = runs[n + 1] * 3; o < end; o += 3, p += 4) {
          const r = 0 + (a0[o] * s0 + b0[o] * t0) * w0 + (a1[o] * s1 + b1[o] * t1) * w1 + (a2[o] * s2 + b2[o] * t2) * w2
          const g = 0 + (a0[o + 1] * s0 + b0[o + 1] * t0) * w0 + (a1[o + 1] * s1 + b1[o + 1] * t1) * w1 + (a2[o + 1] * s2 + b2[o + 1] * t2) * w2
          const b = 0 + (a0[o + 2] * s0 + b0[o + 2] * t0) * w0 + (a1[o + 2] * s1 + b1[o + 2] * t1) * w1 + (a2[o + 2] * s2 + b2[o + 2] * t2) * w2
          // Screen blend keeps highlights from clipping harshly.
          pixels[p] = 255 - (255 - pixels[p]) * (255 - Math.min(255, r * amount * 2.4)) / 255
          pixels[p + 1] = 255 - (255 - pixels[p + 1]) * (255 - Math.min(255, g * amount * 2.4)) / 255
          pixels[p + 2] = 255 - (255 - pixels[p + 2]) * (255 - Math.min(255, b * amount * 2.4)) / 255
        }
      }
      continue
    }
    // The dithered blend. It is the screen blend above as p + m * (255 - p) / 255, with the weight of a layer,
    // its share of the two rows and the gain in one factor. That is fewer steps for each pixel.
    const A0 = s0 * w0 * gain, B0 = t0 * w0 * gain, A1 = s1 * w1 * gain, B1 = t1 * w1 * gain, A2 = s2 * w2 * gain, B2 = t2 * w2 * gain
    const rowGrain = y * w
    for (let n = 0; n < count; n += 2) {
      const least = leasts[n >> 1]
      if (least < 0) {
        for (let x = runs[n], o = x * 3, p = line + x * 4, i = rowGrain + x, end = runs[n + 1]; x < end; x++, o += 3, p += 4, i++) {
          // A choice with no branch: a branch here made the pass a tenth slower.
          const t = pixels[p + 3] === 0 ? 0 : grain[i] * STEP + HALF
          const r = a0[o] * A0 + b0[o] * B0 + a1[o] * A1 + b1[o] * B1 + a2[o] * A2 + b2[o] * B2
          const g = a0[o + 1] * A0 + b0[o + 1] * B0 + a1[o + 1] * A1 + b1[o + 1] * B1 + a2[o + 1] * A2 + b2[o + 1] * B2
          const b = a0[o + 2] * A0 + b0[o + 2] * B0 + a1[o + 2] * A1 + b1[o + 2] * B1 + a2[o + 2] * A2 + b2[o + 2] * B2
          const pr = pixels[p], pg = pixels[p + 1], pb = pixels[p + 2]
          pixels[p] = pr + Math.min(255, r) * (255 - pr) * INV + t
          pixels[p + 1] = pg + Math.min(255, g) * (255 - pg) * INV + t
          pixels[p + 2] = pb + Math.min(255, b) * (255 - pb) * INV + t
        }
        continue
      }
      // A dim span: first find the pixels with a threshold of least or more, with no branch. Then give only
      // those their light. The light is under one level there, so it has no limit of 255 to keep. The plain
      // write keeps every byte of a dim span, so a pixel with alpha 0 takes no light: its factor q is 0.
      let found = 0
      for (let x = runs[n], i = rowGrain + x, end = runs[n + 1]; x < end; x++, i++) { picks[found] = x; found += ((grain[i] - least) >>> 31) ^ 1 }
      for (let j = 0; j < found; j++) {
        const x = picks[j], o = x * 3, p = line + x * 4
        const t = grain[rowGrain + x] * STEP + HALF, q = pixels[p + 3] === 0 ? 0 : INV
        const r = a0[o] * A0 + b0[o] * B0 + a1[o] * A1 + b1[o] * B1 + a2[o] * A2 + b2[o] * B2
        const g = a0[o + 1] * A0 + b0[o + 1] * B0 + a1[o + 1] * A1 + b1[o + 1] * B1 + a2[o + 1] * A2 + b2[o + 1] * B2
        const b = a0[o + 2] * A0 + b0[o + 2] * B0 + a1[o + 2] * A1 + b1[o + 2] * B1 + a2[o + 2] * A2 + b2[o + 2] * B2
        const pr = pixels[p], pg = pixels[p + 1], pb = pixels[p + 2]
        pixels[p] = pr + r * (255 - pr) * q + t
        pixels[p + 1] = pg + g * (255 - pg) * q + t
        pixels[p + 2] = pb + b * (255 - pb) * q + t
      }
    }
  }
}
`

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
    /** Counts and times of the jobs of this pool. The export adds its own waits. */
    readonly stats: ExportStats = {
        workers: 0, computed: 0, reused: 0, mainMs: 0,
        rasterMs: 0, averageMs: 0, bloomMs: 0, frameWaitMs: 0, encoderWaitMs: 0, encoderFinishMs: 0,
    }

    constructor(size = defaultPoolSize()) {
        const resvgPath = resolveResvg()
        this.stats.workers = size
        for (let i = 0; i < size; i++) {
            const worker = new Worker(RASTER_WORKER_SOURCE, { eval: true, workerData: { resvgPath } })
            worker.on('message', (message: WorkerReply) => {
                const entry = this.pending.get(message.id)
                this.pending.delete(message.id)
                this.idle.push(worker)
                this.pump()
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
        this.failure ??= new Error('The raster pool was closed.')
        for (const entry of this.pending.values()) entry.reject(this.failure)
        this.pending.clear()
        this.queue.length = 0
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
