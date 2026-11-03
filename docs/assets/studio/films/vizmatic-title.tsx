/**
 * The website hero: a seamless ten-second loop. Lit curves flow across the
 * frame, gather into the wordmark, part around it, and let go again. Every
 * phase runs a whole number of cycles per loop, so the last frame meets the first.
 */
import {
    Node, dynamic, film, linearGradient, parseColor, pointAt, polyPath, smooth, smoothPath, text, transformPath,
    type Path, type Vec,
} from 'vizmatic/stage'

const LOOP = 10
const TAU = Math.PI * 2
const SAMPLES = 180
const EDGE = 1120

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/** The shared gesture: one travelling swell, with a slower swell inside it. */
function wave(x: number, seed: number, t: number, amount: number): number {
    const a = Math.sin(x * 0.0042 + seed * 1.7 + (TAU * t) / LOOP)
    const b = Math.sin(x * 0.0091 - seed * 0.9 - (TAU * 2 * t) / LOOP)
    const c = Math.sin(x * 0.0023 + seed * 0.4 + (TAU * t) / LOOP)
    return amount * (a * 62 + b * 26 + c * 88)
}

/** 1 while the word stands, 0 while the curves run free. Staggered across the word. */
function gathered(t: number, stagger: number): number {
    const shift = stagger * 0.55
    const release = clamp01((t - 2.1 - shift) / 2.1)
    const gather = clamp01((t - 5.9 - shift) / 2.6)
    return 1 - smooth(release) + smooth(gather)
}

export default film({
    title: 'Vizmatic',
    description: 'Curves gather into a wordmark and let go again, as a seamless loop.',
    fps: 60,
    bloom: 0.24,
}, (s) => {
    const mark = text('vizmatic', { font: 'serif', size: 360 }).at(0, -6)
    const bounds = mark.bounds()
    const glyphs = mark.chars.map((leaf) => transformPath(leaf.get('path')!, leaf.worldMatrix()))
    const left = bounds.x, width = bounds.width
    const pigment = linearGradient([-EDGE, 0], [EDGE, 0], ['blue', 'teal', 'yellow', 'orange', 'pink'])
    const ink = parseColor('ink'), highlight = parseColor('yellow')

    interface Strand { outline: Vec[]; seed: number; stagger: number; lane: number }
    const strands: Strand[][] = glyphs.map((path, g) => path.map((ring, r) => {
        const outline: Vec[] = []
        const single: Path = [ring]
        for (let i = 0; i < SAMPLES; i++) outline.push(pointAt(single, i / SAMPLES))
        const lane = ((g + r * 0.5) / Math.max(1, glyphs.length - 1) - 0.5) * 300
        return { outline, seed: g * 1.3 + r * 2.1, stagger: g / Math.max(1, glyphs.length - 1), lane }
    }))

    const FIELD = 64
    const field = Array.from({ length: FIELD }, (_, i) => {
        const k = i - (FIELD - 1) / 2
        return { base: k * 19, seed: i * 0.37, weight: 1 - Math.abs(k) / FIELD }
    })

    s.add(dynamic((t) => {
        const out: Node[] = []
        const calm = 1 - 0.68 * gathered(t, 0.5)
        const part = gathered(t, 0.5)
        for (const line of field) {
            const points: Vec[] = []
            for (let i = 0; i <= 70; i++) {
                const x = -EDGE + (2 * EDGE * i) / 70
                const bulge = Math.exp(-((x / 760) ** 4))
                // The field parts like streamlines around an obstacle.
                const side = line.base >= 0 ? 1 : -1
                const push = side * 262 * Math.exp(-(line.base * line.base) / (2 * 190 * 190)) * bulge * part
                points.push([x, line.base * (1 + 0.32 * part) + push + wave(x, line.seed, t, calm)])
            }
            out.push(new Node(smoothPath(points)).stroke(pigment, 1.35, 0.16 + 0.32 * line.weight * line.weight))
        }

        // A soft highlight crosses the word once per loop.
        const cycle = ((t + 1.6) % LOOP) / LOOP
        const at = -0.2 + cycle * 3.1
        const shine = linearGradient([left, 0], [left + width, 0], [
            [0, ink], [clamp01(at - 0.11), ink], [clamp01(at), highlight], [clamp01(at + 0.11), ink], [1, ink],
        ])

        strands.forEach((group) => {
            const rings: Path[] = []
            let settled = 1
            for (const strand of group) {
                const alpha = gathered(t, strand.stagger)
                settled = Math.min(settled, alpha)
                if (alpha >= 0.999) {
                    rings.push(polyPath(strand.outline, true))
                    continue
                }
                const points: Vec[] = strand.outline.map(([gx, gy], i) => {
                    const u = i / SAMPLES
                    const run = u < 0.5 ? u * 2 : (1 - u) * 2
                    const x = -EDGE + 2 * EDGE * run
                    const y = strand.lane + wave(x, strand.seed, t, 1) + (u < 0.5 ? 0.8 : -0.8)
                    // Points near the word's center of gravity land first, which feels drawn in.
                    const local = smooth(clamp01((alpha * 1.34 - 0.34 * Math.abs(run - 0.5) * 2)))
                    return [x + (gx - x) * local, y + (gy - y) * local]
                })
                rings.push(polyPath(points, true))
            }
            const shape = new Node(rings.flat())
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
