/**
 * The landing page's scroll film. Scroll position sets the time directly, so
 * every drawing here is a pure function of the timeline.
 */
import {
    circle, colorAlong, curveThrough, dot, draw, dynamic, fadeIn, fadeOut, film, line, linear, Node, pointAt, polyPath,
    smooth, tex, text, write, type Vec,
} from 'vizmatic/stage'

const R = 190
const TURNS_ON_WAVE = 2
const WAVE_START = -130
const WAVE_WIDTH = 820
const MAX_TERMS = 24
const HUB: Vec = [-560, 30]

/** One odd harmonic of a square wave: radius and spin rate. */
function harmonic(k: number): { radius: number; spin: number } {
    const spin = 2 * k - 1
    return { radius: (R * 4) / (Math.PI * spin), spin }
}

interface Coefficient {
    freq: number
    re: number
    im: number
}

/** Discrete Fourier transform of a closed outline, biggest circles first. */
function fourier(points: readonly Vec[], keep: number): Coefficient[] {
    const n = points.length
    const out: Coefficient[] = []
    for (let f = -Math.floor(keep / 2); f <= Math.floor(keep / 2); f++) {
        let re = 0, im = 0
        for (let i = 0; i < n; i++) {
            const angle = (-2 * Math.PI * f * i) / n
            const cos = Math.cos(angle), sin = Math.sin(angle)
            re += points[i]![0] * cos - points[i]![1] * sin
            im += points[i]![0] * sin + points[i]![1] * cos
        }
        out.push({ freq: f, re: re / n, im: im / n })
    }
    return out.sort((a, b) => Math.hypot(b.re, b.im) - Math.hypot(a.re, a.im))
}

export default film({
    title: 'Scrub me',
    description: 'A circle becomes a wave, circles become a square wave, and circles draw a letter.',
    fps: 60,
}, (s) => {
    const phase = s.value(0)
    const terms = s.value(1)
    const waveShown = s.value(0)

    // ── A point goes around ─────────────────────────────────────────────
    s.chapter('A point goes around')
    const axisX = line([HUB[0] - 280, HUB[1]], [WAVE_START + WAVE_WIDTH + 20, HUB[1]], { stroke: 'grid', width: 2 })
    const axisY = line([HUB[0], HUB[1] - 300], [HUB[0], HUB[1] + 300], { stroke: 'grid', width: 2 })
    s.add(axisX, axisY)
    s.play(draw(axisX), draw(axisY), { duration: 0.9 })

    const arms = dynamic(() => {
        const out: Node[] = []
        let x = HUB[0], y = HUB[1]
        const n = terms.value
        for (let k = 1; k <= MAX_TERMS; k++) {
            const amount = Math.max(0, Math.min(1, n - k + 1))
            if (amount <= 0) break
            const { radius, spin } = harmonic(k)
            const r = radius * amount
            const a = phase.value * spin
            const nx = x + Math.cos(a) * r, ny = y - Math.sin(a) * r
            out.push(circle(r, { stroke: 'blue', width: 1.4, opacity: 0.32 + 0.3 * amount }).at(x, y))
            out.push(line([x, y], [nx, ny], { stroke: 'ink', width: k === 1 ? 3 : 2 }))
            x = nx
            y = ny
        }
        out.push(dot(8, 'yellow').glow(14).at(x, y))
        return out
    })
    s.play(fadeIn(arms, { duration: 0.8 }))
    s.play(phase.to(Math.PI * 2, { duration: 3.4, ease: linear }))

    // ── Its height is a wave ────────────────────────────────────────────
    s.chapter('Its height is a wave')
    const wave = dynamic(() => {
        const shown = waveShown.value
        if (shown <= 0) return null
        const n = terms.value
        const sample = (u: number): Vec => {
            let y = 0
            const angle = phase.value - u * TURNS_ON_WAVE * Math.PI * 2
            for (let k = 1; k <= MAX_TERMS; k++) {
                const amount = Math.max(0, Math.min(1, n - k + 1))
                if (amount <= 0) break
                const { radius, spin } = harmonic(k)
                y += Math.sin(angle * spin) * radius * amount
            }
            return [WAVE_START + u * WAVE_WIDTH, HUB[1] - y]
        }
        const points: Vec[] = []
        const count = Math.max(2, Math.round(420 * shown))
        for (let i = 0; i <= count; i++) points.push(sample((i / count) * shown))
        const curve = new Node(curveThrough(points)).stroke(colorAlong('yellow', 'orange', 'pink', 'purple'), 4.5).glow(9)
        // The thread from the moving tip to the head of the wave.
        let x = HUB[0], y = HUB[1]
        for (let k = 1; k <= MAX_TERMS; k++) {
            const amount = Math.max(0, Math.min(1, n - k + 1))
            if (amount <= 0) break
            const { radius, spin } = harmonic(k)
            x += Math.cos(phase.value * spin) * radius * amount
            y -= Math.sin(phase.value * spin) * radius * amount
        }
        const thread = line([x, y], points[0]!, { stroke: 'dim', width: 1.6, dash: [5, 7] })
        return [thread, curve]
    })
    s.add(wave)
    s.play(waveShown.to(1, { duration: 2.2, ease: smooth }), phase.to(Math.PI * 2 + 3.2, { duration: 2.2, ease: linear }))
    s.play(phase.to(Math.PI * 2 + 7, { duration: 1.8, ease: linear }))

    // ── Stack circles ───────────────────────────────────────────────────
    s.chapter('Add circles and the wave sharpens')
    const heading = s.add(tex('\\sum_{k=1}^{n} \\frac{\\sin\\,(2k-1)\\theta}{2k-1}', { size: 58 }).at(350, -380))
    s.play(write(heading, { duration: 1.2 }), phase.to(Math.PI * 2 + 8.6, { duration: 1.2, ease: linear }))
    s.play(terms.to(2, { duration: 1 }), phase.to(Math.PI * 2 + 10, { duration: 1, ease: linear }))
    s.play(terms.to(4, { duration: 1.2 }), phase.to(Math.PI * 2 + 11.4, { duration: 1.2, ease: linear }))
    s.play(terms.to(MAX_TERMS, { duration: 2.4 }), phase.to(Math.PI * 2 + 14, { duration: 2.4, ease: linear }))

    // ── Any shape ───────────────────────────────────────────────────────
    s.chapter('Enough circles can draw anything')
    s.play(fadeOut([arms, wave, heading, axisX, axisY]), { duration: 0.9 })

    // The outline of a serif letter, sampled and turned into rotating circles.
    const letter = text('v', { font: 'serif', size: 900 })
    const leaf = letter.chars[0]!
    const ringPath = [leaf.get('path')![0]!]
    const outline: Vec[] = []
    for (let i = 0; i < 480; i++) {
        const [x, y] = pointAt(ringPath, i / 480)
        outline.push([x, y])
    }
    const coefficients = fourier(outline, 121)
    const position = (u: number, count: number): Vec => {
        let x = 0, y = 0
        for (let k = 0; k < count; k++) {
            const c = coefficients[k]!
            const a = 2 * Math.PI * c.freq * u
            const cos = Math.cos(a), sin = Math.sin(a)
            x += c.re * cos - c.im * sin
            y += c.re * sin + c.im * cos
        }
        return [x, y]
    }
    const pen = s.value(0)
    const fill = s.value(0)
    const penDrawing = dynamic(() => {
        const u = pen.value
        const out: Node[] = []
        const steps = Math.max(2, Math.round(u * 520))
        const traced: Vec[] = []
        for (let i = 0; i <= steps; i++) traced.push(position((i / steps) * u, coefficients.length))
        out.push(new Node(curveThrough(traced)).stroke(colorAlong('blue', 'teal', 'yellow'), 3.5).glow(10))
        if (u < 0.999) {
            let x = 0, y = 0
            for (let k = 0; k < 60; k++) {
                const c = coefficients[k]!
                const a = 2 * Math.PI * c.freq * u
                const nx = x + c.re * Math.cos(a) - c.im * Math.sin(a)
                const ny = y + c.re * Math.sin(a) + c.im * Math.cos(a)
                const r = Math.hypot(c.re, c.im)
                if (r > 1.5) out.push(circle(r, { stroke: 'blue', width: 1, opacity: 0.22 }).at(x, y))
                out.push(line([x, y], [nx, ny], { stroke: 'ink', width: 1.2, opacity: 0.8 }))
                x = nx
                y = ny
            }
        }
        return out
    })
    s.add(penDrawing)
    s.play(pen.to(1, { duration: 5.5, ease: linear }))
    const glyphFill = dynamic(() => {
        const amount = fill.value
        if (amount <= 0) return null
        return new Node(polyPath(outline, true)).fill('yellow', amount * 0.14)
    })
    s.add(glyphFill)
    const formula = s.add(tex('f(t) = \\sum_{n} c_n\\, e^{2\\pi i n t}', { size: 58 }).at(560, 330))
    s.play(fill.to(1, { duration: 1 }), write(formula, { duration: 1.4 }))
    s.wait(0.8)
})
