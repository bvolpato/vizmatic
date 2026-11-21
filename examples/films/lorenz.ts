/**
 * The Lorenz system with sigma = 10, rho = 28, beta = 8/3, integrated by fourth
 * order Runge-Kutta at a fixed step. The separation readout and the time when two
 * nearby runs part are measured from the same integration that gets drawn.
 */
import {
    Node, axes, dot, dynamic, fadeIn, fadeOut, film, integrateTrajectory, line, linear, polyPath, ramp, rect, smoother, text, tex, write,
    type Rgba, type Vec,
} from 'vizmatic/stage'

const SIGMA = 10, RHO = 28, BETA = 8 / 3
const DT = 0.004
const COLUMN = 480
const CENTER: Vec = [-232, 8]

type Samples = readonly (readonly number[])[]

function derivative(_time: number, [x, y, z]: readonly number[]): readonly number[] {
    return [SIGMA * (y - x), x * (RHO - z) - y, x * y - BETA * z]
}

export default film({
    title: 'The Lorenz attractor',
    description: 'Many deterministic trajectories fill a butterfly, and two nearby starts part ways.',
    fps: 60,
    bloom: 0.2,
}, (s) => {
    const SPAN = 15000
    // Settle onto the attractor first, so every drawn run starts on it.
    const settled = integrateTrajectory(derivative, { initial: [1, 1, 1], to: 6000 * DT, step: DT }).sample(6000 * DT)

    const OFFSET = 1e-5
    const runA = integrateTrajectory(derivative, { initial: settled, to: (SPAN - 1) * DT, step: DT }).states
    const runB = integrateTrajectory(derivative, { initial: [settled[0] + OFFSET, settled[1], settled[2]], to: (SPAN - 1) * DT, step: DT }).states
    const separation = new Float64Array(SPAN)
    let partedAt = -1
    for (let i = 0; i < SPAN; i++) {
        separation[i] = Math.hypot(runA[i]![0]! - runB[i]![0]!, runA[i]![1]! - runB[i]![1]!, runA[i]![2]! - runB[i]![2]!)
        if (partedAt < 0 && separation[i]! > 10) partedAt = i * DT
    }

    const CLOUD = 72
    const cloudColors: readonly Rgba[] = ramp(CLOUD, 'blue', 'teal', 'green', 'yellow', 'orange', 'pink', 'purple')
    const cloud = Array.from({ length: CLOUD }, (_, i) => integrateTrajectory(derivative, { initial: [settled[0] + (i - CLOUD / 2) * 0.012, settled[1], settled[2]], to: (SPAN - 1) * DT, step: DT }).states)

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

    const tail = (data: Samples, from: number, to: number, stride: number): Vec[] => {
        const out: Vec[] = []
        for (let i = Math.max(0, from); i <= to; i += stride) out.push(project(data[i]![0]!, data[i]![1]!, data[i]![2]!))
        return out
    }

    /** A line that fades into its own past, in four stretches. */
    const comet = (data: Samples, head: number, length: number, color: string | Rgba, width: number, stride: number, alpha: number): Node[] => {
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
            out.push(dot(8, 'yellow').at(project(runA[head]![0]!, runA[head]![1]!, runA[head]![2]!)).glow(12).opacity(showSingle.value))
        }
        if (showPair.value > 0) {
            const a = showPair.value
            out.push(...comet(runA, head, 1400, 'yellow', 3, 2, a), ...comet(runB, head, 1400, 'pink', 3, 2, a))
            out.push(dot(8, 'yellow').at(project(runA[head]![0]!, runA[head]![1]!, runA[head]![2]!)).glow(10).opacity(a))
            out.push(dot(8, 'pink').at(project(runB[head]![0]!, runB[head]![1]!, runB[head]![2]!)).glow(10).opacity(a))
        }
        if (showCloud.value > 0) {
            const a = showCloud.value
            cloud.forEach((data, i) => {
                out.push(...comet(data, head, 420, cloudColors[i]!, 2, 4, a))
                out.push(dot(4.5, cloudColors[i]!).at(project(data[head]![0]!, data[head]![1]!, data[head]![2]!)).opacity(a))
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
