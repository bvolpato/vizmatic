/**
 * Gradient descent on a two-basin loss, with real iterates. Two starts 0.12 apart
 * are found by bisection on the ridge between the basins, so they travel together
 * for a long time and still finish in different minima.
 */
import {
    Node, arrow, dot, dynamic, fadeIn, film, line, linear, parseColor, polyPath, ramp, rect, smoother, text, tex, write,
    type Rgba, type Ring, type Vec,
} from 'vizmatic/stage'

const SIZE = 3
const GRID = 38
const ETA = 0.32
const STEPS = 170
const CENTER: Vec = [-235, 16]
const SCALE = 124
const CAMERA_DISTANCE = 16
const FLOOR = -1.02
const HEIGHT = 2.15
const COLUMN = 480

const bump = (dx: number, dy: number, s: number) => Math.exp(-(dx * dx + dy * dy) / (2 * s * s))
const loss = (x: number, y: number) => 1.5 - 1.25 * bump(x - 1.25, y + 0.95, 0.95) - 0.82 * bump(x + 1.45, y - 1.05, 0.8)
    + 0.045 * (x * x + y * y) + 0.1 * Math.sin(1.5 * x + 0.4) * Math.cos(1.3 * y)

function gradient(x: number, y: number): Vec {
    const h = 1e-4
    return [(loss(x + h, y) - loss(x - h, y)) / (2 * h), (loss(x, y + h) - loss(x, y - h)) / (2 * h)]
}

function descend(x0: number, y0: number): Vec[] {
    const path: Vec[] = [[x0, y0]]
    let x = x0, y = y0
    for (let i = 0; i < STEPS; i++) {
        const [gx, gy] = gradient(x, y)
        x -= ETA * gx
        y -= ETA * gy
        path.push([x, y])
    }
    return path
}

/** Which minimum a start falls into. */
const fallsRight = (x: number, y: number) => descend(x, y)[STEPS]![0] > 0

function ridge(y: number): number {
    let low = -1, high = 2.8
    for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2
        if (fallsRight(mid, y)) high = mid
        else low = mid
    }
    return (low + high) / 2
}

/** Marching squares over the floor, as one list of short segments per level. */
function contours(levels: readonly number[], resolution: number): [Vec, Vec][][] {
    const out: [Vec, Vec][][] = levels.map(() => [])
    const cell = (2 * SIZE) / resolution
    const at = (i: number, j: number) => loss(-SIZE + i * cell, -SIZE + j * cell)
    for (let i = 0; i < resolution; i++) {
        for (let j = 0; j < resolution; j++) {
            const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]
            const corners: Vec[] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]
            levels.forEach((level, index) => {
                const hits: Vec[] = []
                for (let k = 0; k < 4; k++) {
                    const a = v[k]!, b = v[(k + 1) % 4]!
                    if ((a < level) === (b < level)) continue
                    const t = (level - a) / (b - a)
                    const [ax, ay] = corners[k]!, [bx, by] = corners[(k + 1) % 4]!
                    hits.push([-SIZE + (ax + (bx - ax) * t) * cell, -SIZE + (ay + (by - ay) * t) * cell])
                }
                if (hits.length >= 2) out[index]!.push([hits[0]!, hits[1]!])
                if (hits.length === 4) out[index]!.push([hits[2]!, hits[3]!])
            })
        }
    }
    return out
}

export default film({
    title: 'Gradient descent',
    description: 'Two starts a hair apart run downhill together, then finish in different minima.',
    fps: 60,
    bloom: 0.12,
}, (s) => {
    const azimuth = s.value(-0.55)
    const elevation = s.value(0.6)
    const rise = s.value(0)
    const stepA = s.value(0)
    const stepB = s.value(0)
    const showB = s.value(0)
    const showA = s.value(0)
    const arrowAlpha = s.value(0)

    const split = ridge(2.6)
    const pathA = descend(split + 0.06, 2.6)
    const pathB = descend(split - 0.06, 2.6)

    // Loss range, for mapping height to color.
    let low = Infinity, high = -Infinity
    for (let i = 0; i <= 120; i++) {
        for (let j = 0; j <= 120; j++) {
            const v = loss(-SIZE + (i * 2 * SIZE) / 120, -SIZE + (j * 2 * SIZE) / 120)
            low = Math.min(low, v)
            high = Math.max(high, v)
        }
    }
    const heightOf = (x: number, y: number) => ((loss(x, y) - low) / (high - low)) * HEIGHT + FLOOR + 0.16

    // The surface is dark glass. Height shows through its contour lines, which carry the light.
    const palette = ramp(64, 'blue', 'teal', 'green', 'yellow')
    const groundTone = parseColor('bg')
    const dark = s.look.dark
    const surfaceTone = (level: number, light: number): Rgba => {
        const base = palette[level]!
        const amount = dark ? 0.1 + 0.34 * light * (0.35 + (0.65 * level) / 63) : 0.2 + 0.3 * light
        return [
            groundTone[0] + (base[0] - groundTone[0]) * amount,
            groundTone[1] + (base[1] - groundTone[1]) * amount,
            groundTone[2] + (base[2] - groundTone[2]) * amount,
            1,
        ]
    }
    interface Quad { corners: [number, number][]; fill: Rgba; edge: Rgba; lines: { a: Vec; b: Vec; level: number }[] }
    const levels = Array.from({ length: 16 }, (_, i) => low + ((i + 0.6) * (high - low)) / 16)
    const levelColors = ramp(levels.length, 'blue', 'teal', 'green', 'yellow')
    const quads: Quad[] = []
    const cell = (2 * SIZE) / GRID
    for (let i = 0; i < GRID; i++) {
        for (let j = 0; j < GRID; j++) {
            const x0 = -SIZE + i * cell, y0 = -SIZE + j * cell, x1 = x0 + cell, y1 = y0 + cell
            const [gx, gy] = gradient((x0 + x1) / 2, (y0 + y1) / 2)
            const k = HEIGHT / (high - low)
            const nx = -gx * k, ny = -gy * k, nz = 1
            const size = Math.hypot(nx, ny, nz)
            const lambert = Math.max(0, (nx * -0.42 + ny * -0.58 + nz * 0.7) / size)
            const level = Math.min(63, Math.floor(((loss((x0 + x1) / 2, (y0 + y1) / 2) - low) / (high - low)) * 64))
            const light = 0.45 + 0.75 * lambert
            const corners: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
            const values = corners.map(([x, y]) => loss(x, y))
            const lines: Quad['lines'] = []
            levels.forEach((value, index) => {
                const hits: Vec[] = []
                for (let c = 0; c < 4; c++) {
                    const va = values[c]!, vb = values[(c + 1) % 4]!
                    if ((va < value) === (vb < value)) continue
                    const t = (value - va) / (vb - va)
                    const [ax, ay] = corners[c]!, [bx, by] = corners[(c + 1) % 4]!
                    hits.push([ax + (bx - ax) * t, ay + (by - ay) * t])
                }
                if (hits.length >= 2) lines.push({ a: hits[0]!, b: hits[1]!, level: index })
            })
            quads.push({ corners, fill: surfaceTone(level, light), edge: surfaceTone(level, light * 1.7), lines })
        }
    }

    const levelLines = contours(levels, 96)
    const faintPaint = parseColor('faint')

    const stage = dynamic(() => {
        const az = azimuth.value, el = elevation.value
        const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el)
        const project = (x: number, y: number, z: number): { p: Vec; depth: number } => {
            const X = x * ca - y * sa, Y = x * sa + y * ca
            const depth = Y * ce - z * se + CAMERA_DISTANCE
            const k = (SCALE * CAMERA_DISTANCE) / depth
            return { p: [CENTER[0] + X * k, CENTER[1] - (Y * se + z * ce) * k], depth }
        }
        const out: Node[] = []

        // The floor sits under everything, because the camera stays above the horizon.
        const floorCorners: Vec[] = ([[-SIZE, -SIZE], [SIZE, -SIZE], [SIZE, SIZE], [-SIZE, SIZE]] as const).map(([x, y]) => project(x, y, FLOOR).p)
        out.push(new Node(polyPath(floorCorners, true)).stroke(faintPaint, 1.4).fill('surface', 0.55))
        levelLines.forEach((segments, index) => {
            const rings: Ring[] = []
            for (const [a, b] of segments) rings.push(...polyPath([project(a[0], a[1], FLOOR).p, project(b[0], b[1], FLOOR).p]))
            if (rings.length) out.push(new Node(rings).stroke(levelColors[index]!, 1.2, 0.72))
        })
        const shadow = (path: Vec[], step: number, color: string, alpha: number) => {
            if (alpha <= 0) return
            const end = Math.min(path.length - 1, Math.floor(step))
            const points: Vec[] = []
            for (let i = 0; i <= end; i++) points.push(project(path[i]![0], path[i]![1], FLOOR).p)
            if (points.length > 1) out.push(new Node(polyPath(points)).stroke(color, 2.4, alpha))
        }
        shadow(pathA, stepA.value, 'orange', showA.value)
        shadow(pathB, stepB.value, 'pink', showB.value)

        interface Item { depth: number; node: Node }
        const items: Item[] = []
        const lift = rise.value
        const z = (x: number, y: number) => FLOOR + (heightOf(x, y) - FLOOR) * lift
        for (const quad of quads) {
            const corners = quad.corners.map(([x, y]) => project(x, y, z(x, y)))
            const depth = (corners[0]!.depth + corners[1]!.depth + corners[2]!.depth + corners[3]!.depth) / 4
            const parts: Node[] = [new Node(polyPath(corners.map((corner) => corner.p), true)).fill(quad.fill).stroke(quad.edge, 0.7)]
            for (const mark of quad.lines) {
                parts.push(line(project(mark.a[0], mark.a[1], z(mark.a[0], mark.a[1]) + 0.004).p, project(mark.b[0], mark.b[1], z(mark.b[0], mark.b[1]) + 0.004).p, {
                    stroke: levelColors[mark.level]!, width: 1.5,
                }))
            }
            items.push({ depth, node: parts.length === 1 ? parts[0]! : new Node().add(...parts) })
        }
        const trail = (path: Vec[], step: number, color: string, alpha: number) => {
            if (alpha <= 0) return
            const end = Math.min(path.length - 1, step)
            const whole = Math.floor(end)
            const position = (i: number): Vec => {
                const a = path[Math.floor(i)]!, b = path[Math.min(path.length - 1, Math.floor(i) + 1)]!
                const f = i - Math.floor(i)
                return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
            }
            const lifted = (i: number) => {
                const [x, y] = position(i)
                return project(x, y, z(x, y) + 0.035)
            }
            for (let i = 0; i < whole; i++) {
                const a = lifted(i), b = lifted(i + 1)
                items.push({
                    depth: (a.depth + b.depth) / 2 - 0.18,
                    node: line(a.p, b.p, { stroke: color, width: 4.2 }).opacity(alpha),
                })
            }
            const tip = lifted(end)
            items.push({ depth: tip.depth - 0.3, node: dot(11, color).at(tip.p).glow(14).opacity(alpha) })
        }
        trail(pathA, stepA.value, 'orange', showA.value)
        trail(pathB, stepB.value, 'pink', showB.value)

        const alpha = arrowAlpha.value
        if (alpha > 0) {
            const index = Math.min(pathA.length - 1, Math.floor(stepA.value))
            const [x, y] = pathA[index]!
            const [gx, gy] = gradient(x, y)
            const size = Math.hypot(gx, gy) || 1
            const length = 1.05
            const tx = x - (gx / size) * length, ty = y - (gy / size) * length
            const a = project(x, y, z(x, y) + 0.05)
            const b = project(tx, ty, z(tx, ty) + 0.05)
            items.push({ depth: a.depth - 0.4, node: arrow(a.p, b.p, { stroke: 'ink', width: 4, tip: 20 }).opacity(alpha) })
            const away = tex('-\\nabla f', { size: 34, color: 'ink', display: false })
            // Sit beside the shaft, on its upper side, so the label covers neither the ball nor the arrow.
            const shaftX = b.p[0] - a.p[0], shaftY = b.p[1] - a.p[1]
            const shaftLength = Math.hypot(shaftX, shaftY) || 1
            const upward = shaftX > 0 ? -1 : 1
            const sideX = (-shaftY / shaftLength) * upward, sideY = (shaftX / shaftLength) * upward
            away.moveTo([(a.p[0] + b.p[0]) / 2 + sideX * 58, (a.p[1] + b.p[1]) / 2 + sideY * 58])
            const bb = away.bounds()
            items.push({ depth: a.depth - 0.5, node: new Node().add(
                rect(bb.width + 14, bb.height + 10, { fill: 'bg', stroke: null, radius: 6 }).at(bb.x + bb.width / 2, bb.y + bb.height / 2).opacity(0.94),
                away,
            ).opacity(alpha) })
        }
        items.sort((p, q) => q.depth - p.depth)
        for (const item of items) out.push(item.node)
        return out
    })

    // ── Column ──────────────────────────────────────────────────────────────

    const backing = rect(960 - COLUMN + 70, 1080, { fill: 'bg', stroke: null }).at((COLUMN - 70 + 960) / 2, 0).zIndex(5)
    const rule = line([COLUMN - 70, -540], [COLUMN - 70, 540], { stroke: 'grid', width: 1.2 }).zIndex(5)
    const place = <T extends Node>(node: T, top: number): T => {
        node.alignTo([COLUMN, 0], 'left').alignTo([0, top], 'top')
        node.zIndex(6)
        return node
    }
    const label = (content: string, top: number) => place(text(content, { size: 19, color: 'dim', uppercase: true, tracking: 0.08, weight: 600 }), top)
    const title = place(text('Downhill, one step at a time.', { font: 'serif', size: 58, maxWidth: 410, leading: 1.08 }), -490)
    const rule1 = place(tex('\\theta_{t+1} = \\theta_t - \\eta \\, \\nabla f(\\theta_t)', { size: 36 }), -340)
    const etaNote = place(text(`Step size eta = ${ETA}. Each step moves against the local slope, and nothing else.`, { size: 22, color: 'dim', maxWidth: 400, leading: 1.4 }), -280)

    const stepLabel = label('Step', -176)
    const stepRead = dynamic(() => place(text(String(Math.floor(Math.max(stepA.value, stepB.value))).padStart(3, ' '), { font: 'mono', size: 56, color: 'ink' }), -150)).zIndex(6)

    const lossLabelA = label('Loss, start A', -66)
    const lossReadA = dynamic(() => {
        const [x, y] = pathA[Math.min(STEPS, Math.floor(stepA.value))]!
        return place(text(loss(x, y).toFixed(3), { font: 'mono', size: 38, color: 'orange' }), -40)
    }).zIndex(6)
    const lossLabelB = label('Loss, start B', -66)
    lossLabelB.alignTo([COLUMN + 200, 0], 'left')
    const lossReadB = dynamic(() => {
        const [x, y] = pathB[Math.min(STEPS, Math.floor(stepB.value))]!
        const node = place(text(loss(x, y).toFixed(3), { font: 'mono', size: 38, color: 'pink' }), -40)
        node.alignTo([COLUMN + 200, 0], 'left')
        return node
    }).zIndex(6)

    // Loss against step, for both runs.
    const CHART_X = COLUMN, CHART_W = 380, CHART_TOP = 72, CHART_H = 200
    const chartY = (v: number) => CHART_TOP + CHART_H - ((v - low) / (high - low)) * CHART_H
    const chartLabel = label('Loss against step', 36)
    const chartAxes = new Node().add(
        line([CHART_X, CHART_TOP], [CHART_X, CHART_TOP + CHART_H], { stroke: 'faint', width: 1.3 }),
        line([CHART_X, CHART_TOP + CHART_H], [CHART_X + CHART_W, CHART_TOP + CHART_H], { stroke: 'faint', width: 1.3 }),
    ).zIndex(6)
    const chartTick0 = place(text('0', { font: 'mono', size: 18, color: 'dim' }), CHART_TOP + CHART_H + 8)
    const chartTick1 = place(text(String(STEPS), { font: 'mono', size: 18, color: 'dim' }), CHART_TOP + CHART_H + 8)
    chartTick1.alignTo([CHART_X + CHART_W, 0], 'right')
    const chart = dynamic(() => {
        const draw = (path: Vec[], step: number, color: string, alpha: number): Node | null => {
            if (alpha <= 0) return null
            const end = Math.min(STEPS, Math.floor(step))
            if (end < 1) return null
            const points: Vec[] = []
            for (let i = 0; i <= end; i++) points.push([CHART_X + (i / STEPS) * CHART_W, chartY(loss(path[i]![0], path[i]![1]))])
            return new Node(polyPath(points)).stroke(color, 3, alpha)
        }
        return [draw(pathA, stepA.value, 'orange', showA.value), draw(pathB, stepB.value, 'pink', showB.value)].filter((n): n is Node => n !== null)
    }).zIndex(6)
    const outcome = place(text('Same rule, same step size, starts 0.12 apart. Different answers.', { size: 24, color: 'ink', maxWidth: 400, leading: 1.38 }), 340)

    // ── Timeline ────────────────────────────────────────────────────────────

    s.add(stage)
    s.add(backing, rule)
    s.chapter('The landscape')
    s.play(rise.to(1, { ease: smoother }), azimuth.to(-0.15, { ease: smoother }), write(title), { duration: 3.2 })
    s.wait(0.4)

    s.chapter('The rule')
    s.play(showA.to(1), arrowAlpha.to(1), write(rule1), fadeIn(etaNote), azimuth.to(0.1, { ease: linear }), { duration: 1.6 })
    s.play(fadeIn([stepLabel, stepRead, lossLabelA, lossReadA, chartLabel, chartAxes, chartTick0, chartTick1, chart]), azimuth.to(0.2, { ease: linear }), { duration: 0.9 })
    for (let i = 1; i <= 4; i++) {
        s.play(stepA.to(i * 6), azimuth.to(0.2 + i * 0.05, { ease: linear }), { duration: 0.9 })
        s.wait(0.25)
    }

    s.chapter('Let it run')
    s.play(arrowAlpha.to(0), { duration: 0.5 })
    s.play(stepA.to(STEPS, { ease: linear }), azimuth.to(1.15, { ease: smoother }), { duration: 8 })
    s.wait(0.8)

    s.chapter('A close neighbor')
    s.play(showB.to(1), fadeIn([lossLabelB, lossReadB]), azimuth.to(0.75, { ease: smoother }), { duration: 1.4 })
    s.play(stepB.to(STEPS, { ease: linear }), azimuth.to(-0.25, { ease: smoother }), { duration: 8.5 })
    s.wait(0.6)

    s.chapter('From above')
    s.play(elevation.to(1.32, { ease: smoother }), azimuth.to(0.05, { ease: smoother }), fadeIn(outcome, { shift: [0, 10] }), { duration: 3.6 })
    s.wait(4.4)
})
