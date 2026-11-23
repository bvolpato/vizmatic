/**
 * The Lorenz system with sigma = 10, rho = 28, beta = 8/3, integrated by fourth
 * order Runge-Kutta at a fixed step. The separation readout and the time when two
 * nearby runs part are measured from the same integration that gets drawn.
 */
import {
    Node, axes, dot, dynamic, fadeIn, fadeOut, film, line, linear, polyPath, ramp, rect, smoother, text, tex, write,
    type Rgba, type Vec,
} from 'vizmatic/stage'

const SIGMA = 10, RHO = 28, BETA = 8 / 3
const DT = 0.004
const SPAN = 15000
const CLOUD = 72
// Chapter 3 only advances `clock` from 0 to 24 (6,000 steps of DT = 0.004).
const CLOUD_SPAN = 6001
const OFFSET = 1e-5
const COLUMN = 480
const CENTER: Vec = [-232, 8]

function integrateLorenz(x0: number, y0: number, z0: number, steps: number): Float64Array {
    const out = new Float64Array(steps * 3)
    let x = x0, y = y0, z = z0
    out[0] = x; out[1] = y; out[2] = z
    const half = DT * 0.5
    const sixth = DT / 6
    for (let i = 1; i < steps; i++) {
        const k1x = SIGMA * (y - x)
        const k1y = x * (RHO - z) - y
        const k1z = x * y - BETA * z

        const x2 = x + half * k1x, y2 = y + half * k1y, z2 = z + half * k1z
        const k2x = SIGMA * (y2 - x2)
        const k2y = x2 * (RHO - z2) - y2
        const k2z = x2 * y2 - BETA * z2

        const x3 = x + half * k2x, y3 = y + half * k2y, z3 = z + half * k2z
        const k3x = SIGMA * (y3 - x3)
        const k3y = x3 * (RHO - z3) - y3
        const k3z = x3 * y3 - BETA * z3

        const x4 = x + DT * k3x, y4 = y + DT * k3y, z4 = z + DT * k3z
        const k4x = SIGMA * (y4 - x4)
        const k4y = x4 * (RHO - z4) - y4
        const k4z = x4 * y4 - BETA * z4

        x += sixth * (k1x + 2 * k2x + 2 * k3x + k4x)
        y += sixth * (k1y + 2 * k2y + 2 * k3y + k4y)
        z += sixth * (k1z + 2 * k2z + 2 * k3z + k4z)
        const o = i * 3
        out[o] = x; out[o + 1] = y; out[o + 2] = z
    }
    return out
}

interface LorenzData {
    runA: Float64Array
    runB: Float64Array
    separation: Float64Array
    partedAt: number
    cloud: readonly Float64Array[]
}

let cachedLorenz: LorenzData | undefined

// Compute deterministic RK4 trajectories once per module load so Suspend retries and theme switches cost 0 ms.
function getLorenzData(): LorenzData {
    if (cachedLorenz) return cachedLorenz
    // Settle onto the attractor first, so every drawn run starts on it.
    const warmup = integrateLorenz(1, 1, 1, 6001)
    const sx = warmup[6000 * 3]!, sy = warmup[6000 * 3 + 1]!, sz = warmup[6000 * 3 + 2]!
    const runA = integrateLorenz(sx, sy, sz, SPAN)
    const runB = integrateLorenz(sx + OFFSET, sy, sz, SPAN)
    const separation = new Float64Array(SPAN)
    let partedAt = -1
    for (let i = 0; i < SPAN; i++) {
        const o = i * 3
        const d = Math.hypot(runA[o]! - runB[o]!, runA[o + 1]! - runB[o + 1]!, runA[o + 2]! - runB[o + 2]!)
        separation[i] = d
        if (partedAt < 0 && d > 10) partedAt = i * DT
    }
    const cloud = Array.from({ length: CLOUD }, (_, i) => integrateLorenz(sx + (i - CLOUD / 2) * 0.012, sy, sz, CLOUD_SPAN))
    cachedLorenz = { runA, runB, separation, partedAt, cloud }
    return cachedLorenz
}

export default film({
    title: 'The Lorenz attractor',
    description: 'Many deterministic trajectories fill a butterfly, and two nearby starts part ways.',
    fps: 60,
    bloom: 0.2,
}, (s) => {
    const { runA, runB, separation, partedAt, cloud } = getLorenzData()
    const cloudColors: readonly Rgba[] = ramp(CLOUD, 'blue', 'teal', 'green', 'yellow', 'orange', 'pink', 'purple')

    const clock = s.value(0)
    const showSingle = s.value(1)
    const showPair = s.value(0)
    const showCloud = s.value(0)
    const azimuth = s.value(-1.25)
    const tilt = s.value(0.28)
    const zoom = s.value(1)

    const project = (x: number, y: number, z: number): Vec => {
        const az = azimuth.value, el = tilt.value
        const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el)
        const X = x * ca - y * sa, Y = x * sa + y * ca
        const Z = z - 25
        const distance = 150
        const depth = Y * ce - Z * se + distance
        const scale = (19 * zoom.value * distance) / depth
        return [CENTER[0] + X * scale, CENTER[1] - (Y * se + Z * ce) * scale]
    }

    const sampleHead = (data: Float64Array, headFloat: number): Vec => {
        const maxIdx = data.length / 3 - 1
        const clamped = Math.max(0, Math.min(maxIdx, headFloat))
        const i0 = Math.floor(clamped)
        const i1 = Math.min(maxIdx, i0 + 1)
        const frac = clamped - i0
        const o0 = i0 * 3, o1 = i1 * 3
        return project(
            data[o0]! + (data[o1]! - data[o0]!) * frac,
            data[o0 + 1]! + (data[o1 + 1]! - data[o0 + 1]!) * frac,
            data[o0 + 2]! + (data[o1 + 2]! - data[o0 + 2]!) * frac,
        )
    }

    const tail = (data: Float64Array, from: number, to: number, stride: number, tip?: Vec): Vec[] => {
        const out: Vec[] = []
        const maxIdx = data.length / 3 - 1
        const limit = Math.min(maxIdx, to)
        for (let i = Math.max(0, from); i <= limit; i += stride) {
            const o = i * 3
            out.push(project(data[o]!, data[o + 1]!, data[o + 2]!))
        }
        if (tip) out.push(tip)
        return out
    }

    /** A line that fades into its own past, in four stretches. */
    const comet = (data: Float64Array, headFloat: number, length: number, color: string | Rgba, width: number, stride: number, alpha: number, tip: Vec): Node[] => {
        const maxIdx = data.length / 3 - 1
        const clamped = Math.max(0, Math.min(maxIdx, headFloat))
        const head = Math.floor(clamped)
        const out: Node[] = []
        const stops = [[1, 0.6, 0.1], [0.6, 0.32, 0.26], [0.32, 0.12, 0.55], [0.12, 0, 1]] as const
        for (const [far, near, opacity] of stops) {
            const from = Math.floor(clamped - length * far), to = Math.floor(clamped - length * near)
            if (to <= 0 || to <= from) continue
            const points = tail(data, Math.max(0, from), Math.min(head, to), stride, near === 0 ? tip : undefined)
            if (points.length > 1) out.push(new Node(polyPath(points)).stroke(color, width, opacity * alpha))
        }
        return out
    }

    const scene = dynamic(() => {
        const t = clock.value
        const headFloat = Math.max(0, Math.min(SPAN - 1, t / DT))
        const head = Math.floor(headFloat)
        const out: Node[] = []
        if (showSingle.value > 0) {
            // The long trail keeps the shape of the butterfly while one point runs through it.
            const tipA = sampleHead(runA, headFloat)
            const points = tail(runA, 0, head, 2, tipA)
            if (points.length > 1) out.push(new Node(polyPath(points)).stroke('blue', 1.6, 0.8 * showSingle.value).glow(3, 'blue'))
            out.push(dot(8, 'yellow').at(tipA).glow(12).opacity(showSingle.value))
        }
        if (showPair.value > 0) {
            const a = showPair.value
            const tipA = sampleHead(runA, headFloat), tipB = sampleHead(runB, headFloat)
            out.push(...comet(runA, headFloat, 1400, 'yellow', 3, 2, a, tipA), ...comet(runB, headFloat, 1400, 'pink', 3, 2, a, tipB))
            out.push(dot(8, 'yellow').at(tipA).glow(10).opacity(a))
            out.push(dot(8, 'pink').at(tipB).glow(10).opacity(a))
        }
        if (showCloud.value > 0) {
            const a = showCloud.value
            cloud.forEach((data, i) => {
                const tip = sampleHead(data, headFloat)
                out.push(...comet(data, headFloat, 420, cloudColors[i]!, 2, 6, a, tip))
                out.push(dot(4.5, cloudColors[i]!).at(tip).opacity(a))
            })
        }
        return out
    })

    // ── Column ──────────────────────────────────────────────────────────────

    const rule = line([COLUMN - 70, -540], [COLUMN - 70, 540], { stroke: 'grid', width: 1.2 }).zIndex(6)
    const place = <T extends Node>(node: T, top: number): T => {
        node.alignTo([COLUMN, 0], 'left').alignTo([0, top], 'top')
        node.zIndex(6)
        return node
    }
    const label = (content: string, top: number) => place(text(content, { size: 26, color: 'dim', weight: 600 }), top)
    const column = rect(960 - COLUMN + 70, 1080, { fill: 'bg', stroke: null }).at((COLUMN - 70 + 960) / 2, 0).zIndex(5)

    const title = place(text('The rules are exact. The future is not.', { font: 'text-serif', size: 44, maxWidth: 430, leading: 1.08 }), -496)
    const equations = place(tex('\\begin{aligned} \\dot{x} &= \\sigma (y - x) \\\\ \\dot{y} &= x (\\rho - z) - y \\\\ \\dot{z} &= x y - \\beta z \\end{aligned}', { size: 34 }), -374)
    const constants = place(tex('\\sigma = 10, \\quad \\rho = 28, \\quad \\beta = 8/3', { size: 28, color: 'dim' }), -226)
    const timeLabel = label('Model time (dimensionless)', -172)
    const timeRead = dynamic(() => place(text(clock.value.toFixed(2).padStart(5, ' '), { font: 'mono', size: 42, color: 'ink' }), -138)).zIndex(6)

    const gapLabel = label('Distance between the two runs', -72)
    const gapRead = dynamic(() => {
        const head = Math.min(SPAN - 1, Math.floor(clock.value / DT))
        const value = separation[head]!
        const body = value < 0.01 ? value.toExponential(2).replace('e-', ' e-') : value.toFixed(2)
        return place(text(body, { font: 'mono', size: 42, color: 'pink' }), -38)
    }).zIndex(6)
    // Log-scale separation over time. The straight rise is exponential growth.
    const CX = COLUMN + 84, CW = 310, CT = 34, CH = 224
    const chartSpan = Math.max(26, Math.ceil(partedAt + 4))
    const chartAxes = axes({
        x: [0, chartSpan], y: [1e-6, 1e2], yScale: 'log',
        width: CW, height: CH, color: 'faint', tips: false, labelSize: 28,
        xTicks: [], yTicks: [-5, -3, -1, 1].map((power) => 10 ** power),
        yFormat: (value) => `10^{${Math.round(Math.log10(value))}}`,
    }).at(CX + CW / 2, CT + CH / 2).zIndex(6)
    const distanceSeries: Vec[] = []
    for (let i = 0; i < SPAN; i += 12) distanceSeries.push([i * DT, separation[i]!])
    chartAxes.plot(distanceSeries, { to: () => Math.min(clock.value, chartSpan), stroke: 'pink', width: 2.6 })
    const axisNote = place(text('Log distance vs. model time', { size: 26, color: 'dim' }), CT + CH + 16)
    const partedNote = place(text(`Starting ${OFFSET} apart, they are 10 units apart by t = ${partedAt.toFixed(1)}.`, { size: 26, color: 'ink', maxWidth: 420, leading: 1.35 }), 334)
    const cloudNote = place(text(`${CLOUD} starts packed into a line ${(0.012 * (CLOUD - 1)).toFixed(2)} long. Soon they cover the whole shape.`, { size: 26, color: 'ink', maxWidth: 420, leading: 1.35 }), 334)

    // ── Timeline ────────────────────────────────────────────────────────────

    s.add(scene)
    s.add(column, rule)
    s.chapter('One path')
    s.caption('Three deterministic differential equations trace one trajectory around the Lorenz butterfly.', 10.6)
    s.play(write(title), write(equations), fadeIn(constants), fadeIn([timeLabel, timeRead]), clock.to(3.2, { ease: linear }), azimuth.to(-1.05, { ease: linear }), { duration: 4 })
    s.play(clock.to(11, { ease: linear }), azimuth.to(-0.6, { ease: linear }), { duration: 7 })
    s.wait(0.2)

    s.chapter('Two paths')
    s.caption('Two runs starting 10⁻⁵ apart stay indistinguishable at first, then diverge exponentially to opposite wings.', 15.6)
    s.play(showSingle.to(0.22), showPair.to(1), fadeIn([gapLabel, gapRead, chartAxes, axisNote]), azimuth.to(-0.58, { ease: linear }), clock.to(0, { ease: smoother }), { duration: 2.2 })
    s.play(clock.to(Math.min(partedAt + 3.5, SPAN * DT - 1), { ease: linear }), azimuth.to(-1.05, { ease: linear }), { duration: 10.5 })
    s.play(fadeIn(partedNote, { shift: [0, 8] }), { duration: 0.9 })
    s.wait(2.8)

    s.chapter('A crowd')
    s.caption('Seventy-two tightly packed initial states quickly stretch and fold across the entire attractor.', 11.8)
    s.play(showPair.to(0), showSingle.to(0.08), showCloud.to(1), clock.to(0, { ease: smoother }), fadeOut(partedNote), azimuth.to(-1.1, { ease: linear }), { duration: 1.8 })
    s.play(fadeIn(cloudNote, { shift: [0, 8] }), { duration: 0.8 })
    s.play(clock.to(24, { ease: linear }), azimuth.to(-0.35, { ease: linear }), { duration: 8.5 })
    s.wait(1.5)
})
