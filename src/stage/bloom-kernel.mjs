/** Floating-point bloom shared by the browser and raster workers. Each instance keeps its own scratch buffers. */
export function createBloom() {
    // A run of 16 pixels of a row. The bloom decides for each span if it has work to do.
    const SPAN = 16
    // The pixels as 32-bit numbers hold red in the low byte only where the low byte is first in memory.
    const LOW_BYTE_FIRST = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

    // One layer of the bloom: the mean color of each cell of factor by factor pixels, less the background.
    // The sums of the cells stay with the layer, so a coarser layer can add them in place of the pixels.
    function downsample(src, words, w, layer, background) {
      const { factor, lw, lh, data, sums, finer } = layer
      sums.fill(0)
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

    // A film reuses one size. Keep only that size, and rebuild the geometry when either dimension changes.
    let scratch = null
    function scratchOf(w, h) {
      if (scratch && scratch.w === w && scratch.h === h) return scratch
      const layers = []
      // The spread follows output width, so a small preview and a 4K master look alike.
      const k = w / 1920
      for (const [base, radius, weight] of [[4, 3, 0.55], [8, 4, 0.3], [16, 4, 0.15]]) {
        const factor = Math.max(1, Math.min(w, h, Math.round(base * k)))
        const lw = Math.max(1, Math.floor(w / factor)), lh = Math.max(1, Math.floor(h / factor))
        let finer = null
        for (const layer of layers) if (factor % layer.factor === 0) finer = layer
        const layer = { factor, lw, lh, finer, radius, weight, data: new Float32Array(lw * lh * 3), sums: new Int32Array(lw * lh * 3) }
        layers.push(layer)
      }
      const tmp = new Float32Array(layers.reduce((most, layer) => Math.max(most, layer.data.length), 0))
      const sums = new Float64Array(layers[0].lw * 3)

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
      const runs = new Int32Array(spans * 2), leasts = new Int16Array(spans), picks = new Int32Array(SPAN)
      scratch = { w, h, layers, tmp, sums, spans, runs, leasts, picks }
      return scratch
    }

    // Stretch one row of a layer into one of its two slots.
    function stretch(layer, index, slot, w, spans) {
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
      const { layers, tmp, sums, spans, runs, picks } = scratchOf(w, h)
      const words = LOW_BYTE_FIRST && pixels.byteOffset % 4 === 0 ? new Uint32Array(pixels.buffer, pixels.byteOffset, w * h) : null
      for (const layer of layers) downsample(pixels, words, w, layer, background)
      for (const layer of layers) {
        boxBlur(layer.data, tmp, sums, layer.lw, layer.lh, layer.radius)
        boxBlur(layer.data, tmp, sums, layer.lw, layer.lh, layer.radius)
        layer.held[0] = -1; layer.held[1] = -1
      }

      const l0 = layers[0], l1 = layers[1], l2 = layers[2]
      const w0 = l0.weight, w1 = l1.weight, w2 = l2.weight
      // With a dither, for each run: -1 where the plain write changes a byte, so each pixel has work. For a dim
      // span, the least threshold byte that can lift a pixel of the span.
      const leasts = dither ? scratch.leasts : null
      const grain = dither ? grainOf(w, h) : null
      const STEP = 1 / 256, HALF = 0.5 / 256, INV = 1 / 255, gain = amount * 2.4
      let count = 0
      for (let y = 0; y < h; y++) {
        let moved = false
        for (const layer of layers) {
          const fy = (y + 0.5) / layer.factor - 0.5
          const y0 = Math.min(layer.lh - 1, Math.max(0, Math.floor(fy))), y1 = Math.min(layer.lh - 1, y0 + 1)
          layer.ty = Math.min(1, Math.max(0, fy - y0)); layer.sy = 1 - layer.ty
          let top = layer.held[0] === y0 ? 0 : layer.held[1] === y0 ? 1 : -1
          if (top < 0) { top = layer.held[0] === y1 ? 1 : 0; stretch(layer, y0, top, w, spans); moved = true }
          let low = layer.held[0] === y1 ? 0 : layer.held[1] === y1 ? 1 : -1
          if (low < 0) { low = 1 - top; stretch(layer, y1, low, w, spans); moved = true }
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
    return bloom
}
