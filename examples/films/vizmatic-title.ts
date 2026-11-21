/**
 * The website hero: a seamless ten-second loop. Lit curves flow across the
 * frame, gather into the wordmark, part around it, and let go again. Every
 * phase runs a whole number of cycles per loop, so the last frame meets the first.
 */
import {
    Node, dynamic, film, linearGradient, parseColor, pointAt, polyPath, smooth, text, transformPath,
    type Path, type Ring, type Vec,
} from 'vizmatic/stage'

const LOOP = 10
const TAU = Math.PI * 2
const SAMPLES = 120
const FIELD = 64
const FIELD_STEPS = 56
const FIELD_BANDS = 8
const EDGE = 1120

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** 1 while the word stands, 0 while the curves run free. Staggered across the word. */
function gathered(t: number, stagger: number): number {
    const shift = stagger * 0.55
    const release = clamp01((t - 2.1 - shift) / 2.1)
    const gather = clamp01((t - 5.9 - shift) / 2.6)
    return 1 - smooth(release) + smooth(gather)
}

/** Precomputed angle-addition weights for the two-frequency wave at one (x, seed). */
interface WaveCoeffs {
    w1Cos: number
    w1Sin: number
    w2Cos: number
    w2Sin: number
}

function makeWaveCoeffs(x: number, seed: number): WaveCoeffs {
    const a = x * 0.0042 + seed * 1.7
    const b = x * 0.0091 - seed * 0.9
    const c = x * 0.0023 + seed * 0.4
    return {
        w1Cos: 62 * Math.sin(a) + 88 * Math.sin(c),
        w1Sin: 62 * Math.cos(a) + 88 * Math.cos(c),
        w2Cos: 26 * Math.sin(b),
        w2Sin: 26 * Math.cos(b),
    }
}

export default film({
    title: 'Vizmatic',
    description: 'Curves gather into a wordmark and let go again, as a seamless loop.',
    fps: 60,
    bloom: 0.24,
    bleed: true,
}, (s) => {
    const mark = text('vizmatic', { font: 'text-serif', size: 280 }).at(0, -6)
    const bounds = mark.bounds()
    const glyphs = mark.chars.map((leaf) => transformPath(leaf.get('path')!, leaf.worldMatrix()))
    const left = bounds.x, width = bounds.width
    const pigment = linearGradient([-EDGE, 0], [EDGE, 0], ['blue', 'teal', 'yellow', 'orange', 'pink'])
    const ink = parseColor('ink'), highlight = parseColor('yellow')

    interface StrandSample {
        gx: number
        gy: number
        x: number
        baseY: number
        bias: number
        w1Cos: number
        w1Sin: number
        w2Cos: number
        w2Sin: number
    }
    interface Strand {
        settledRing: Ring
        samples: StrandSample[]
        stagger: number
    }
    const strands: Strand[][] = glyphs.map((path, g) => path.map((ring, r) => {
        const single: Path = [ring]
        const seed = g * 1.3 + r * 2.1
        const stagger = g / Math.max(1, glyphs.length - 1)
        const lane = ((g + r * 0.5) / Math.max(1, glyphs.length - 1) - 0.5) * 300
        const samples: StrandSample[] = []
        for (let i = 0; i < SAMPLES; i++) {
            const [gx, gy] = pointAt(single, i / SAMPLES)
            const u = i / SAMPLES
            const run = u < 0.5 ? u * 2 : (1 - u) * 2
            const x = -EDGE + 2 * EDGE * run
            const w = makeWaveCoeffs(x, seed)
            samples.push({
                gx,
                gy,
                x,
                baseY: lane + (u < 0.5 ? 0.8 : -0.8),
                bias: 0.34 * Math.abs(run - 0.5) * 2,
                ...w,
            })
        }
        return { settledRing: ring, samples, stagger }
    }))
    // Exact original Bezier paths reused directly while a glyph is fully settled (zero allocations).
    const settledGlyphs: Path[] = glyphs

    // Precompute x positions, obstacle bulge envelope, and per-line wave coefficients once.
    const xs = new Float64Array(FIELD_STEPS + 1)
    const bulges = new Float64Array(FIELD_STEPS + 1)
    for (let i = 0; i <= FIELD_STEPS; i++) {
        const x = -EDGE + (2 * EDGE * i) / FIELD_STEPS
        xs[i] = x
        bulges[i] = Math.exp(-((x / 760) ** 4))
    }

    interface FieldLine {
        base: number
        pushAmp: number
        w1Cos: Float64Array
        w1Sin: Float64Array
        w2Cos: Float64Array
        w2Sin: Float64Array
    }
    interface FieldBand {
        opacity: number
        lines: FieldLine[]
    }

    // Group the 64 streamlines into 8 symmetric opacity bands so Canvas2D executes 8 gradient strokes
    // per frame instead of 64 separate stroke calls, while preserving the smooth center-to-edge fade.
    const bandBuckets: { weightSum: number; lines: FieldLine[] }[] = Array.from(
        { length: FIELD_BANDS },
        () => ({ weightSum: 0, lines: [] }),
    )
    for (let idx = 0; idx < FIELD; idx++) {
        const k = idx - (FIELD - 1) / 2
        const base = k * 19
        const seed = idx * 0.37
        const weight = 1 - Math.abs(k) / FIELD
        const side = base >= 0 ? 1 : -1
        const pushAmp = side * 262 * Math.exp(-(base * base) / (2 * 190 * 190))
        const w1Cos = new Float64Array(FIELD_STEPS + 1)
        const w1Sin = new Float64Array(FIELD_STEPS + 1)
        const w2Cos = new Float64Array(FIELD_STEPS + 1)
        const w2Sin = new Float64Array(FIELD_STEPS + 1)
        for (let i = 0; i <= FIELD_STEPS; i++) {
            const w = makeWaveCoeffs(xs[i]!, seed)
            w1Cos[i] = w.w1Cos
            w1Sin[i] = w.w1Sin
            w2Cos[i] = w.w2Cos
            w2Sin[i] = w.w2Sin
        }
        const distNorm = Math.abs(k) / ((FIELD - 1) / 2)
        const bandIndex = Math.min(FIELD_BANDS - 1, Math.floor(distNorm * FIELD_BANDS))
        const bucket = bandBuckets[bandIndex]!
        bucket.weightSum += weight
        bucket.lines.push({ base, pushAmp, w1Cos, w1Sin, w2Cos, w2Sin })
    }
    const fieldBands: FieldBand[] = bandBuckets
        .filter((bucket) => bucket.lines.length > 0)
        .map((bucket) => {
            const meanWeight = bucket.weightSum / bucket.lines.length
            return {
                opacity: 0.16 + 0.32 * meanWeight * meanWeight,
                lines: bucket.lines,
            }
        })

    s.add(dynamic((t) => {
        const out: Node[] = []
        const phase1 = (TAU * t) / LOOP
        const phase2 = -(TAU * 2 * t) / LOOP
        const c1 = Math.cos(phase1), s1 = Math.sin(phase1)
        const c2 = Math.cos(phase2), s2 = Math.sin(phase2)

        const part = gathered(t, 0.5)
        const calm = 1 - 0.68 * part
        const spread = 1 + 0.32 * part

        for (const band of fieldBands) {
            const bandPath: Ring[] = []
            for (const line of band.lines) {
                const baseY = line.base * spread
                const pushLine = line.pushAmp * part
                const { w1Cos, w1Sin, w2Cos, w2Sin } = line
                const points: Vec[] = new Array(FIELD_STEPS + 1)
                for (let i = 0; i <= FIELD_STEPS; i++) {
                    const waveY = calm * (w1Cos[i]! * c1 + w1Sin[i]! * s1 + w2Cos[i]! * c2 + w2Sin[i]! * s2)
                    points[i] = [xs[i]!, baseY + pushLine * bulges[i]! + waveY]
                }
                bandPath.push(polyPath(points)[0]!)
            }
            out.push(new Node(bandPath).stroke(pigment, 1.35, band.opacity))
        }

        // A soft highlight crosses the word once per loop.
        const cycle = ((t + 1.6) % LOOP) / LOOP
        const at = -0.2 + cycle * 3.1
        const shine = linearGradient([left, 0], [left + width, 0], [
            [0, ink], [clamp01(at - 0.11), ink], [clamp01(at), highlight], [clamp01(at + 0.11), ink], [1, ink],
        ])

        strands.forEach((group, g) => {
            let settled = 1
            for (const strand of group) {
                const alpha = gathered(t, strand.stagger)
                if (alpha < settled) settled = alpha
            }
            let shapePath: Path
            if (settled >= 0.999) {
                shapePath = settledGlyphs[g]!
            } else {
                const rings: Ring[] = []
                for (const strand of group) {
                    const alpha = gathered(t, strand.stagger)
                    if (alpha >= 0.999) {
                        rings.push(strand.settledRing)
                        continue
                    }
                    const samples = strand.samples
                    const points: Vec[] = new Array(samples.length)
                    const aScaled = alpha * 1.34
                    for (let i = 0; i < samples.length; i++) {
                        const pt = samples[i]!
                        const y = pt.baseY + (pt.w1Cos * c1 + pt.w1Sin * s1 + pt.w2Cos * c2 + pt.w2Sin * s2)
                        // Points near the word's center of gravity land first, which feels drawn in.
                        const local = smooth(clamp01(aScaled - pt.bias))
                        points[i] = [pt.x + (pt.gx - pt.x) * local, y + (pt.gy - y) * local]
                    }
                    rings.push(polyPath(points, true)[0]!)
                }
                shapePath = rings
            }
            const shape = new Node(shapePath)
            // Letters land as a lit outline, then flood with ink at the very end.
            const fill = smooth(clamp01((settled - 0.9) / 0.1))
            if (fill > 0) shape.fill(shine, fill)
            if (fill < 1) shape.stroke(pigment, 2.6, 1 - fill * fill)
            out.push(shape)
        })
        return out
    }))
    s.wait(LOOP)
})
