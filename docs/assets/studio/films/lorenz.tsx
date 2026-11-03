/**
 * The Lorenz system with sigma = 10, rho = 28, beta = 8/3, integrated by fourth
 * order Runge-Kutta at a fixed step. The separation readout and the time when two
 * nearby runs part are measured from the same integration that gets drawn.
 */
import {
    Node, dot, dynamic, fadeIn, fadeOut, film, line, linear, polyPath, ramp, rect, smoother, text, tex, write,
    type Rgba, type Vec,
} from 'vizmatic/stage'

const SIGMA = 10, RHO = 28, BETA = 8 / 3
const DT = 0.004
const COLUMN = 480
const CENTER: Vec = [-232, 8]

type State = readonly [number, number, number]

function derivative([x, y, z]: State): State {
    return [SIGMA * (y - x), x * (RHO - z) - y, x * y - BETA * z]
}

function step(state: State, dt: number): State {
    const add = (a: State, b: State, k: number): State => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
    const k1 = derivative(state)
    const k2 = derivative(add(state, k1, dt / 2))
    const k3 = derivative(add(state, k2, dt / 2))
    const k4 = derivative(add(state, k3, dt))
    return [
        state[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
        state[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
        state[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
    ]
}

function integrate(start: State, count: number): Float32Array {
    const out = new Float32Array(count * 3)
    let state = start
    for (let i = 0; i < count; i++) {
        out[i * 3] = state[0]
        out[i * 3 + 1] = state[1]
        out[i * 3 + 2] = state[2]
        state = step(state, DT)
    }
    return out
}

export default film({
    title: 'The Lorenz attractor',
    description: 'Many deterministic trajectories fill a butterfly, and two nearby starts part ways.',
    fps: 60,
    bloom: 0.2,
}, (s) => {
    const SPAN = 15000
    // Settle onto the attractor first, so every drawn run starts on it.
    let settled: State = [1, 1, 1]
    for (let i = 0; i < 6000; i++) settled = step(settled, DT)

    const OFFSET = 1e-5
    const runA = integrate(settled, SPAN)
    const runB = integrate([settled[0] + OFFSET, settled[1], settled[2]], SPAN)
    const separation = new Float32Array(SPAN)
    let partedAt = -1
    for (let i = 0; i < SPAN; i++) {
        separation[i] = Math.hypot(runA[i * 3]! - runB[i * 3]!, runA[i * 3 + 1]! - runB[i * 3 + 1]!, runA[i * 3 + 2]! - runB[i * 3 + 2]!)
        if (partedAt < 0 && separation[i]! > 10) partedAt = i * DT
    }

    const CLOUD = 72
    const cloudColors: readonly Rgba[] = ramp(CLOUD, 'blue', 'teal', 'green', 'yellow', 'orange', 'pink', 'purple')
    const cloud = Array.from({ length: CLOUD }, (_, i) => integrate([settled[0] + (i - CLOUD / 2) * 0.012, settled[1], settled[2]], SPAN))

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

    const tail = (data: Float32Array, from: number, to: number, stride: number): Vec[] => {
        const out: Vec[] = []
        for (let i = Math.max(0, from); i <= to; i += stride) out.push(project(data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!))
        return out
    }

    /** A line that fades into its own past, in four stretches. */
    const comet = (data: Float32Array, head: number, length: number, color: string | Rgba, width: number, stride: number, alpha: number): Node[] => {
        const out: Node[] = []
        const stops = [[1, 0.6, 0.1], [0.6, 0.32, 0.26], [0.32, 0.12, 0.55], [0.12, 0, 1]] as const
        for (const [far, near, opacity] of stops) {
            const from = Math.floor(head - length * far), to = Math.floor(head - length * near)
            if (to <= 0 || to <= from) continue
            const points = tail(data, Math.max(0, from), Math.min(head, to), stride)
            if (points.length > 1) out.push(new Node(polyPath(points)).stroke(color, width, opacity * alpha))
        }
        return out
    }

    const scene = dynamic(() => {
        const t = clock.value
        const head = Math.min(SPAN - 1, Math.floor(t / DT))
        const out: Node[] = []
        if (showSingle.value > 0) {
            // The long trail keeps the shape of the butterfly while one point runs through it.
            const points = tail(runA, 0, head, 2)
            if (points.length > 1) out.push(new Node(polyPath(points)).stroke('blue', 1.6, 0.8 * showSingle.value).glow(3, 'blue'))
            out.push(dot(8, 'yellow').at(project(runA[head * 3]!, runA[head * 3 + 1]!, runA[head * 3 + 2]!)).glow(12).opacity(showSingle.value))
        }
        if (showPair.value > 0) {
            const a = showPair.value
            out.push(...comet(runA, head, 1400, 'yellow', 3, 2, a), ...comet(runB, head, 1400, 'pink', 3, 2, a))
            out.push(dot(8, 'yellow').at(project(runA[head * 3]!, runA[head * 3 + 1]!, runA[head * 3 + 2]!)).glow(10).opacity(a))
            out.push(dot(8, 'pink').at(project(runB[head * 3]!, runB[head * 3 + 1]!, runB[head * 3 + 2]!)).glow(10).opacity(a))
        }
        if (showCloud.value > 0) {
            const a = showCloud.value
            cloud.forEach((data, i) => {
                out.push(...comet(data, head, 420, cloudColors[i]!, 2, 4, a))
                out.push(dot(4.5, cloudColors[i]!).at(project(data[head * 3]!, data[head * 3 + 1]!, data[head * 3 + 2]!)).opacity(a))
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
    const label = (content: string, top: number) => place(text(content, { size: 19, color: 'dim', uppercase: true, tracking: 0.08, weight: 600 }), top)
    const column = rect(960 - COLUMN + 70, 1080, { fill: 'bg', stroke: null }).at((COLUMN - 70 + 960) / 2, 0).zIndex(5)

    const title = place(text('The rules are exact. The future is not.', { font: 'text-serif', size: 46, maxWidth: 440, leading: 1.08 }), -490)
    const equations = place(tex('\\begin{aligned} \\dot{x} &= \\sigma (y - x) \\\\ \\dot{y} &= x (\\rho - z) - y \\\\ \\dot{z} &= x y - \\beta z \\end{aligned}', { size: 36 }), -348)
    const constants = place(tex('\\sigma = 10, \\quad \\rho = 28, \\quad \\beta = 8/3', { size: 26, color: 'dim' }), -196)
    const timeLabel = label('Model time', -128)
    const timeRead = dynamic(() => place(text(`${clock.value.toFixed(2).padStart(5, ' ')} s`, { font: 'mono', size: 44, color: 'ink' }), -102)).zIndex(6)

    const gapLabel = label('Distance between the two runs', -20)
    const gapRead = dynamic(() => {
        const head = Math.min(SPAN - 1, Math.floor(clock.value / DT))
        const value = separation[head]!
        const body = value < 0.01 ? value.toExponential(2).replace('e-', ' e-') : value.toFixed(2)
        return place(text(body, { font: 'mono', size: 44, color: 'pink' }), 6)
    }).zIndex(6)
    // Log-scale separation over time. The straight rise is exponential growth.
    const CX = COLUMN + 56, CW = 330, CT = 86, CH = 210
    const logMin = -6, logMax = 2
    const chartY = (value: number) => CT + CH - ((Math.log10(Math.max(1e-6, value)) - logMin) / (logMax - logMin)) * CH
    const chartAxes = new Node().add(
        line([CX, CT], [CX, CT + CH], { stroke: 'faint', width: 1.3 }),
        line([CX, CT + CH], [CX + CW, CT + CH], { stroke: 'faint', width: 1.3 }),
        ...[-5, -3, -1, 1].map((power) => line([CX - 5, chartY(10 ** power)], [CX + 5, chartY(10 ** power)], { stroke: 'faint', width: 1.3 })),
    ).zIndex(6)
    const chartTicks = new Node().add(...[-5, -3, -1, 1].map((power) => {
        const tag = tex(`10^{${power}}`, { size: 20, color: 'dim', display: false })
        tag.alignTo([CX - 12, 0], 'right')
        const b = tag.bounds()
        tag.shift(0, chartY(10 ** power) - (b.y + b.height / 2))
        return tag
    })).zIndex(6)
    const chart = dynamic(() => {
        const head = Math.min(SPAN - 1, Math.floor(clock.value / DT))
        const points: Vec[] = []
        const span = 32
        for (let i = 0; i <= head; i += 12) points.push([CX + ((i * DT) / span) * CW, chartY(separation[i]!)])
        return points.length > 1 ? new Node(polyPath(points)).stroke('pink', 2.6) : null
    }).zIndex(6)
    const axisNote = place(text('Distance, log scale, against model time', { size: 19, color: 'dim' }), CT + CH + 10)
    const partedNote = place(text(`Starting ${OFFSET} apart, they are 10 units apart by ${partedAt.toFixed(1)} s.`, { size: 24, color: 'ink', maxWidth: 400, leading: 1.38 }), 340)
    const cloudNote = place(text(`${CLOUD} starts packed into a line ${(0.012 * (CLOUD - 1)).toFixed(2)} long. Soon they cover the whole shape.`, { size: 24, color: 'ink', maxWidth: 400, leading: 1.38 }), 340)

    // ── Timeline ────────────────────────────────────────────────────────────

    s.add(scene)
    s.add(column, rule)
    s.chapter('One path')
    s.play(write(title), write(equations), fadeIn(constants), fadeIn([timeLabel, timeRead]), clock.to(3.2, { ease: linear }), azimuth.to(-1.05, { ease: linear }), { duration: 4 })
    s.play(clock.to(11, { ease: linear }), azimuth.to(-0.6, { ease: linear }), { duration: 7 })
    s.wait(0.2)

    s.chapter('Two paths')
    s.play(showSingle.to(0.22), showPair.to(1), fadeIn([gapLabel, gapRead, chartAxes, chartTicks, chart, axisNote]), azimuth.to(-0.58, { ease: linear }), clock.to(0, { ease: smoother }), { duration: 2.2 })
    s.play(clock.to(Math.min(partedAt + 3.5, SPAN * DT - 1), { ease: linear }), azimuth.to(-1.05, { ease: linear }), { duration: 11 })
    s.play(fadeIn(partedNote, { shift: [0, 8] }), { duration: 0.9 })
    s.wait(0.6)

    s.chapter('A crowd')
    s.play(showPair.to(0), showSingle.to(0.08), showCloud.to(1), clock.to(0, { ease: smoother }), fadeOut(partedNote), azimuth.to(-1.1, { ease: linear }), { duration: 1.8 })
    s.play(fadeIn(cloudNote, { shift: [0, 8] }), { duration: 0.8 })
    s.play(clock.to(32, { ease: linear }), azimuth.to(-0.35, { ease: linear }), { duration: 14 })
    s.wait(1.5)
})
