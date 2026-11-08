import { Axes, NumberPlane, type PlaneOptions } from '../objects'
import { apply, arcPath, circlePath, invert, parametricPath, pathBounds, pathLength, pointAt, polyPath, ring, type Path, type Ring, type Vec } from '../geometry'
import { dynamic, Node, type Side, direction } from '../node'
import { arrow, brace, dot, line, rect, type ShapeStyle } from '../shapes'
import { tex, TexNode } from '../tex'
import { ramp, sampleStops, toPaint, type ColorInput, type Rgba } from '../color'
import { clock } from '../track'
import { morphMatching, warp, type Anim, type AnimOptions } from '../anim'
import { labelNode, polylineRing, seededRandom, stepsBetween } from './util'

type Reactive = number | (() => number)
const read = (value: Reactive): number => typeof value === 'function' ? value() : value

// ── Number line ─────────────────────────────────────────────────────────────

export interface NumberLineOptions {
    range?: readonly [number, number]
    /** On-screen length in stage pixels. */
    length?: number
    step?: number
    labels?: boolean
    labelSize?: number
    color?: ColorInput
    tips?: boolean
    width?: number
}

export class NumberLine extends Node {
    readonly range: readonly [number, number]
    readonly length: number
    readonly line: Node
    readonly ticks = new Node()
    readonly numbers = new Node()

    constructor(options: NumberLineOptions = {}) {
        super()
        this.range = options.range ?? [-5, 5]
        this.length = options.length ?? 1200
        const color = options.color ?? 'dim'
        const width = options.width ?? 2
        const half = this.length / 2
        const tips = options.tips ?? true
        this.line = tips
            ? arrow([-half - 36, 0], [half + 36, 0], { stroke: color, width, tip: 14, both: true })
            : line([-half, 0], [half, 0], { stroke: color, width })
        const step = options.step ?? 1
        for (const value of stepsBetween(this.range[0], this.range[1], step)) {
            const [x] = this.p(value)
            this.ticks.add(line([x, -7], [x, 7], { stroke: color, width }))
            if (options.labels ?? true) {
                const size = options.labelSize ?? 24
                const label = tex(String(Math.round(value * 1000) / 1000), { size, color: 'dim', display: false })
                label.set('py', -size * 0.25)
                this.numbers.add(label.at(x, 34))
            }
        }
        this.add(this.line, this.ticks, this.numbers)
    }

    /** Value to local stage coordinates. */
    p(value: number): [number, number] {
        const [min, max] = this.range
        return [((value - min) / (max - min) - 0.5) * this.length, 0]
    }

    world(value: number): [number, number] {
        const [x, y] = this.p(value)
        return this.toWorld(x, y)
    }

    /** A point on the line. Pass a function to follow a Value over time. */
    marker(value: Reactive, options: { color?: ColorInput; label?: string; radius?: number; labelSize?: number } = {}): Node {
        const color = options.color ?? 'yellow'
        const size = options.labelSize ?? 28
        const build = (): Node[] => {
            const [x] = this.p(read(value))
            const parts: Node[] = [dot(options.radius ?? 9, color).at(x, 0)]
            if (options.label) parts.push(tex(options.label, { size, color, display: false }).at(x, -size * 1.15))
            return parts
        }
        const node = typeof value === 'function' ? dynamic(build) : new Node().add(...build())
        this.add(node)
        return node
    }

    /** A highlighted span, with open or closed endpoints. */
    interval(from: number, to: number, options: { color?: ColorInput; width?: number; offset?: number; openLeft?: boolean; openRight?: boolean } = {}): Node {
        const color = options.color ?? 'blue'
        const offset = options.offset ?? 0
        const [a] = this.p(from), [b] = this.p(to)
        const band = line([a, offset], [b, offset], { stroke: color, width: options.width ?? 7 })
        const end = (x: number, open?: boolean) => open
            ? dot(9, 'bg').stroke(color, 4).at(x, offset)
            : dot(9, color).at(x, offset)
        const node = new Node().add(band, end(a, options.openLeft), end(b, options.openRight))
        this.add(node)
        return node
    }
}

export function numberLine(options: NumberLineOptions = {}): NumberLine {
    return new NumberLine(options)
}

// ── Complex plane ───────────────────────────────────────────────────────────

export interface ComplexPlaneOptions extends PlaneOptions {
    /** Label real and imaginary integers out to this distance from the origin. */
    labelRange?: number
    labelSize?: number
}

export class ComplexPlane extends NumberPlane {
    readonly numbers = new Node()

    constructor(options: ComplexPlaneOptions = {}) {
        super(options)
        const range = options.labelRange ?? 3
        const size = options.labelSize ?? 22
        for (let k = -range; k <= range; k++) {
            if (k === 0) continue
            const real = tex(String(k), { size, color: 'ink', display: false })
            real.set('py', -size * 0.25)
            this.numbers.add(real.at(k * this.unit, 22))
            const name = k === 1 ? 'i' : k === -1 ? '-i' : `${k}i`
            const imaginary = tex(name, { size, color: 'ink', display: false })
            imaginary.set('py', -size * 0.25)
            this.numbers.add(imaginary.at(-size * 0.9, -k * this.unit))
        }
        this.add(this.numbers)
    }

    /** Complex number to local stage coordinates. */
    z(re: number, im: number): [number, number] {
        return this.p(re, im)
    }
}

export function complexPlane(options: ComplexPlaneOptions = {}): ComplexPlane {
    return new ComplexPlane(options)
}

/**
 * Deform a complex plane through f(re, im). Labels stay readable by fading
 * separately, so this moves only the grid.
 */
export function applyComplex(plane: NumberPlane, f: (re: number, im: number) => Vec, options: AnimOptions & { subdivisions?: number } = {}): Anim {
    const inverse = invert(plane.worldMatrix())
    const world = plane.worldMatrix()
    const unit = plane.unit
    const anim = warp([plane.minor, plane.major, plane.axes], (x, y) => {
        const [lx, ly] = apply(inverse, x, y)
        const [re, im] = f(lx / unit, -ly / unit)
        return apply(world, re * unit, -im * unit)
    }, { duration: 3, ...options })
    return { ...anim, label: 'applyComplex' }
}

/** Small complex arithmetic on [re, im] pairs. */
export const complex = {
    mul: (a: Vec, b: Vec): Vec => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
    div: (a: Vec, b: Vec): Vec => {
        const d = b[0] * b[0] + b[1] * b[1] || 1e-12
        return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]
    },
    exp: (a: Vec): Vec => {
        const r = Math.exp(a[0])
        return [r * Math.cos(a[1]), r * Math.sin(a[1])]
    },
    log: (a: Vec): Vec => [Math.log(Math.hypot(a[0], a[1]) || 1e-12), Math.atan2(a[1], a[0])],
    pow: (a: Vec, n: number): Vec => {
        const r = Math.pow(Math.hypot(a[0], a[1]), n), angle = Math.atan2(a[1], a[0]) * n
        return [r * Math.cos(angle), r * Math.sin(angle)]
    },
    sin: (a: Vec): Vec => [Math.sin(a[0]) * Math.cosh(a[1]), Math.cos(a[0]) * Math.sinh(a[1])],
    cos: (a: Vec): Vec => [Math.cos(a[0]) * Math.cosh(a[1]), -Math.sin(a[0]) * Math.sinh(a[1])],
    inv: (a: Vec): Vec => {
        const d = a[0] * a[0] + a[1] * a[1] || 1e-12
        return [a[0] / d, -a[1] / d]
    },
}

// ── Vector fields and flow ──────────────────────────────────────────────────

export type FieldFn = (x: number, y: number, t: number) => Vec

export interface VectorFieldOptions {
    x?: readonly [number, number]
    y?: readonly [number, number]
    /** Math units between arrows. */
    step?: number
    /** Stage pixels per math unit. */
    unit?: number
    /** Longest arrow, in stage pixels. */
    maxLength?: number
    /** Magnitude that reaches the last color. */
    max?: number
    colors?: readonly ColorInput[]
    /** Thickness of the shaft. */
    width?: number
    /** Recompute from f(x, y, t) on every frame. */
    animate?: boolean
}

function arrowRing(x0: number, y0: number, dx: number, dy: number, thickness: number): Ring {
    const length = Math.hypot(dx, dy) || 1e-6
    const ux = dx / length, uy = dy / length
    const tip = Math.min(length * 0.42, thickness * 5.2)
    const half = thickness / 2
    const head = tip * 0.42
    const bx = x0 + dx - ux * tip, by = y0 + dy - uy * tip
    const nx = -uy, ny = ux
    return polyPath([
        [x0 + nx * half, y0 + ny * half],
        [bx + nx * half, by + ny * half],
        [bx + nx * head, by + ny * head],
        [x0 + dx, y0 + dy],
        [bx - nx * head, by - ny * head],
        [bx - nx * half, by - ny * half],
        [x0 - nx * half, y0 - ny * half],
    ], true)[0]!
}

/** A grid of arrows that shows a field's direction and strength. y points up in field space. */
export class VectorField extends Node {
    readonly unit: number
    readonly arrows: Node[] = []

    constructor(readonly f: FieldFn, options: VectorFieldOptions = {}) {
        super()
        const unit = this.unit = options.unit ?? 120
        const [x0, x1] = options.x ?? [-8, 8]
        const [y0, y1] = options.y ?? [-4.5, 4.5]
        const step = options.step ?? 0.5
        const longest = options.maxLength ?? step * unit * 0.92
        const width = options.width ?? 2.6
        const palette = (options.colors ?? ['blue', 'teal', 'green', 'yellow', 'orange', 'red']).map((c) => toPaint(c))
        const stops = palette.map((c, i) => [palette.length === 1 ? 0 : i / (palette.length - 1), c as Rgba] as const)
        const positions: Vec[] = []
        for (const y of stepsBetween(y0, y1, step)) for (const x of stepsBetween(x0, x1, step)) positions.push([x, y])
        const magnitude = options.max ?? (() => {
            const samples = positions.map(([x, y]) => {
                const [u, v] = f(x, y, 0)
                return Math.hypot(u, v)
            }).filter(Number.isFinite).sort((a, b) => a - b)
            return samples[Math.floor(samples.length * 0.9)] || 1
        })()
        const shape = (x: number, y: number, t: number): { ring: Ring; at: number; cx: number; cy: number } | null => {
            const [u, v] = f(x, y, t)
            const m = Math.hypot(u, v)
            if (!Number.isFinite(m) || m < 1e-9) return null
            const amount = Math.min(1, m / magnitude)
            // Compressed length: small vectors stay visible, large ones stay in their cell.
            const length = longest * (0.22 + 0.78 * (1 - Math.exp(-2.2 * m / magnitude)))
            const dx = (u / m) * length, dy = -(v / m) * length
            const px = x * unit, py = -y * unit
            return { ring: arrowRing(px - dx / 2, py - dy / 2, dx, dy, width), at: amount, cx: px, cy: py }
        }
        if (options.animate) {
            // One draw per color band keeps a live field fast.
            const bands = 12
            this.draw = (time) => {
                const rings: Ring[][] = Array.from({ length: bands }, () => [])
                for (const [x, y] of positions) {
                    const made = shape(x, y, time)
                    if (made) rings[Math.min(bands - 1, Math.floor(made.at * bands))]!.push(made.ring)
                }
                return rings.flatMap((list, band) => list.length === 0 ? [] : [
                    new Node(list).fill(sampleStops(stops, (band + 0.5) / bands)),
                ])
            }
            return
        }
        for (const [x, y] of positions) {
            const made = shape(x, y, 0)
            if (!made) continue
            const leaf = recenter([made.ring]).fill(sampleStops(stops, made.at))
            this.arrows.push(leaf)
            this.add(leaf)
        }
    }
}

/** A leaf with its origin at the center of its geometry, so it scales about itself. */
function recenter(path: Path): Node {
    const b = pathBounds(path)
    if (!b) return new Node(path)
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2
    const shifted = path.map((r) => {
        const out = new Float64Array(r.p.length)
        for (let i = 0; i < out.length; i += 2) {
            out[i] = r.p[i]! - cx
            out[i + 1] = r.p[i + 1]! - cy
        }
        return { p: out, closed: r.closed }
    })
    return new Node(shifted).at(cx, cy)
}

export function vectorField(f: FieldFn, options: VectorFieldOptions = {}): VectorField {
    return new VectorField(f, options)
}

export interface StreamLinesOptions {
    x?: readonly [number, number]
    y?: readonly [number, number]
    unit?: number
    /** Math units between seed points. Smaller is denser. */
    spacing?: number
    /** Integration step and number of steps for each line. */
    dt?: number
    steps?: number
    colors?: readonly ColorInput[]
    max?: number
    width?: number
    /** Passes per second along a full line. */
    speed?: number
    /** Lit fraction of each line. */
    tail?: number
    seed?: number
    /** Show the whole lines faintly underneath the moving light. */
    trace?: number
}

/**
 * Flow made visible: lines are integrated once, then light runs along them.
 * Drawing is batched by color and brightness, so hundreds of lines stay live.
 */
export class StreamLines extends Node {
    readonly lineCount: number

    constructor(f: FieldFn, options: StreamLinesOptions = {}) {
        super()
        const unit = options.unit ?? 120
        const [x0, x1] = options.x ?? [-8.5, 8.5]
        const [y0, y1] = options.y ?? [-5, 5]
        const spacing = options.spacing ?? 0.55
        const dt = options.dt ?? 0.03
        const steps = options.steps ?? 130
        const width = options.width ?? 2.2
        const speed = options.speed ?? 0.35
        const tail = options.tail ?? 0.42
        const random = seededRandom(options.seed ?? 7)
        const palette = (options.colors ?? ['blue', 'teal', 'green', 'yellow', 'orange', 'red']).map((c) => toPaint(c))
        const stops = palette.map((c, i) => [palette.length === 1 ? 0 : i / (palette.length - 1), c as Rgba] as const)
        interface Line { points: Vec[]; phase: number; speedRate: number; color: number }
        const lines: Line[] = []
        const speeds: number[] = []
        const margin = 0.6
        for (let sy = y0; sy <= y1; sy += spacing) {
            for (let sx = x0; sx <= x1; sx += spacing) {
                let x = sx + (random() - 0.5) * spacing, y = sy + (random() - 0.5) * spacing
                const phase = random()
                const points: Vec[] = [[x * unit, -y * unit]]
                let total = 0
                for (let i = 0; i < steps; i++) {
                    const [k1u, k1v] = f(x, y, 0)
                    const [k2u, k2v] = f(x + k1u * dt / 2, y + k1v * dt / 2, 0)
                    const [k3u, k3v] = f(x + k2u * dt / 2, y + k2v * dt / 2, 0)
                    const [k4u, k4v] = f(x + k3u * dt, y + k3v * dt, 0)
                    const u = (k1u + 2 * k2u + 2 * k3u + k4u) / 6, v = (k1v + 2 * k2v + 2 * k3v + k4v) / 6
                    if (!Number.isFinite(u) || !Number.isFinite(v)) break
                    const m = Math.hypot(u, v)
                    total += m
                    if (m < 1e-6) break
                    x += u * dt
                    y += v * dt
                    if (x < x0 - margin || x > x1 + margin || y < y0 - margin || y > y1 + margin) break
                    if (i % 2 === 1) points.push([x * unit, -y * unit])
                }
                if (points.length < 5) continue
                const mean = total / (points.length * 2)
                speeds.push(mean)
                lines.push({ points, phase, speedRate: 0.8 + random() * 0.4, color: mean })
            }
        }
        const sorted = [...speeds].sort((a, b) => a - b)
        const top = options.max ?? (sorted[Math.floor(sorted.length * 0.92)] || 1)
        const colorBands = 8
        for (const entry of lines) entry.color = Math.min(colorBands - 1, Math.floor(Math.min(1, entry.color / top) * colorBands))
        this.lineCount = lines.length
        const fadeBands = 6
        const trace = options.trace ?? 0
        const tracePath: Ring[][] = Array.from({ length: colorBands }, () => [])
        if (trace > 0) for (const entry of lines) tracePath[entry.color]!.push(polylineRing(entry.points))
        this.draw = (time) => {
            const buckets: Ring[][] = Array.from({ length: colorBands * fadeBands }, () => [])
            for (const entry of lines) {
                const count = entry.points.length
                const window = Math.max(3, Math.floor(count * tail))
                const travel = count + window
                const head = ((time * speed * entry.speedRate + entry.phase) % 1) * travel
                for (let band = 0; band < fadeBands; band++) {
                    const from = Math.floor(head - window * (1 - band / fadeBands))
                    const to = Math.floor(head - window * (1 - (band + 1) / fadeBands))
                    const a = Math.max(0, from), b = Math.min(count - 1, to)
                    if (b - a < 1) continue
                    buckets[entry.color * fadeBands + band]!.push(polylineRing(entry.points.slice(a, b + 1)))
                }
            }
            const out: Node[] = []
            if (trace > 0) {
                tracePath.forEach((rings, c) => {
                    if (rings.length) out.push(new Node(rings).stroke(sampleStops(stops, (c + 0.5) / colorBands), width * 0.6).set('strokeOpacity', trace))
                })
            }
            buckets.forEach((rings, index) => {
                if (rings.length === 0) return
                const c = Math.floor(index / fadeBands), band = index % fadeBands
                const node = new Node(rings).stroke(sampleStops(stops, (c + 0.5) / colorBands), width)
                node.set('strokeOpacity', Math.pow((band + 1) / fadeBands, 1.6))
                // Round caps would overlap at band joins and show as bright beads.
                if (band < fadeBands - 1) node.set('cap', 'butt')
                out.push(node)
            })
            return out
        }
    }
}

export function streamLines(f: FieldFn, options: StreamLinesOptions = {}): StreamLines {
    return new StreamLines(f, options)
}

// ── Calculus on Axes ────────────────────────────────────────────────────────

export interface RiemannOptions {
    from?: number
    to?: number
    n?: number
    /** Where each rectangle samples the function. */
    rule?: 'left' | 'mid' | 'right'
    colors?: readonly ColorInput[]
    opacity?: number
    stroke?: ColorInput
    strokeWidth?: number
}

/** Rectangles under a curve. Morph one set into a finer one to show the integral appear. */
export function riemann(axes: Axes, f: (x: number) => number, options: RiemannOptions = {}): Node {
    const from = options.from ?? axes.xRange[0], to = options.to ?? axes.xRange[1]
    const n = options.n ?? 12
    const rule = options.rule ?? 'mid'
    const colors = ramp(n, ...(options.colors ?? ['blue', 'teal', 'green']))
    const made = new Node()
    const dx = (to - from) / n
    for (let i = 0; i < n; i++) {
        const left = from + i * dx
        const sample = rule === 'left' ? left : rule === 'right' ? left + dx : left + dx / 2
        const y = f(sample)
        const [ax, ay] = axes.p(left, 0), [bx, by] = axes.p(left + dx, y)
        const leaf = recenter(polyPath([[ax, ay], [bx, ay], [bx, by], [ax, by]], true))
        leaf.fill(colors[i]!, options.opacity ?? 0.72)
        leaf.stroke(options.stroke ?? 'bg', options.strokeWidth ?? (n > 40 ? 0.5 : 1.4))
        made.add(leaf)
    }
    axes.add(made)
    return made
}

export interface AreaOptions {
    from?: Reactive
    to?: Reactive
    fill?: ColorInput
    opacity?: number
    samples?: number
}

function areaPath(axes: Axes, f: (x: number) => number, from: number, to: number, samples: number): Path {
    const points: Vec[] = []
    for (let i = 0; i <= samples; i++) {
        const x = from + (to - from) * i / samples
        points.push(axes.p(x, f(x)))
    }
    points.push(axes.p(to, 0), axes.p(from, 0))
    return polyPath(points, true)
}

/** Shaded region between a curve and the x axis. Pass functions for bounds that move. */
export function areaUnder(axes: Axes, f: (x: number) => number, options: AreaOptions = {}): Node {
    const samples = options.samples ?? 96
    const color = options.fill ?? 'blue'
    const opacity = options.opacity ?? 0.28
    const from = options.from ?? axes.xRange[0], to = options.to ?? axes.xRange[1]
    const node = typeof from === 'function' || typeof to === 'function'
        ? dynamic(() => {
            const a = read(from), b = read(to)
            return Math.abs(b - a) < 1e-9 ? null : new Node(areaPath(axes, f, a, b, samples)).fill(color, opacity)
        })
        : new Node(areaPath(axes, f, from, to, samples)).fill(color, opacity)
    axes.add(node)
    return node
}

function slopeAt(axes: Axes, f: (x: number) => number, x: number): { point: Vec; ux: number; uy: number } {
    const span = axes.xRange[1] - axes.xRange[0]
    const h = span * 1e-4
    const a = axes.p(x - h, f(x - h)), b = axes.p(x + h, f(x + h))
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return { point: axes.p(x, f(x)), ux: (b[0] - a[0]) / length, uy: (b[1] - a[1]) / length }
}

export interface TangentOptions extends ShapeStyle {
    /** Length of the drawn segment, in stage pixels. */
    length?: number
    /** Mark the point of tangency. */
    point?: boolean
}

/** The tangent at x, as a line on the axes. Pass a function of time to make it slide. */
export function tangentLine(axes: Axes, f: (x: number) => number, x: Reactive, style: TangentOptions = {}): Node {
    const length = style.length ?? 420
    const color = style.stroke ?? 'yellow'
    const build = (): Node[] => {
        const { point, ux, uy } = slopeAt(axes, f, read(x))
        const parts = [line(
            [point[0] - ux * length / 2, point[1] - uy * length / 2],
            [point[0] + ux * length / 2, point[1] + uy * length / 2],
            { stroke: color, width: style.width ?? 3.5, glow: style.glow, dash: style.dash },
        )]
        if (style.point ?? true) parts.push(dot(8, color).at(point))
        return parts
    }
    const node = typeof x === 'function' ? dynamic(build) : new Node().add(...build())
    axes.add(node)
    return node
}

export interface SecantOptions extends ShapeStyle {
    /** Extra length past each point, in stage pixels. */
    extend?: number
    points?: boolean
    /** Draw the run and rise legs of the slope triangle. */
    legs?: boolean
    legColor?: ColorInput
}

/** The line through two points on a curve. Pass functions to shrink h on screen. */
export function secantLine(axes: Axes, f: (x: number) => number, a: Reactive, b: Reactive, style: SecantOptions = {}): Node {
    const extend = style.extend ?? 140
    const color = style.stroke ?? 'yellow'
    const build = (): Node[] => {
        const xa = read(a), xb = read(b)
        const pa = axes.p(xa, f(xa)), pb = axes.p(xb, f(xb))
        const length = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1
        const ux = (pb[0] - pa[0]) / length, uy = (pb[1] - pa[1]) / length
        const parts = [line([pa[0] - ux * extend, pa[1] - uy * extend], [pb[0] + ux * extend, pb[1] + uy * extend], { stroke: color, width: style.width ?? 3.5, glow: style.glow })]
        if (style.legs) {
            const corner: Vec = [pb[0], pa[1]]
            const leg = style.legColor ?? 'dim'
            parts.unshift(line(pa, corner, { stroke: leg, width: 2, dash: [6, 7] }), line(corner, pb, { stroke: leg, width: 2, dash: [6, 7] }))
        }
        if (style.points ?? true) parts.push(dot(8, color).at(pa), dot(8, color).at(pb))
        return parts
    }
    const node = typeof a === 'function' || typeof b === 'function' ? dynamic(build) : new Node().add(...build())
    axes.add(node)
    return node
}

/** Dashed drop lines from a point on the axes. Pass functions to follow a moving point. */
export function dashedGuides(axes: Axes, x: Reactive, y: Reactive, style: ShapeStyle = {}): Node {
    const build = (): Node[] => {
        const px = read(x), py = read(y)
        const originX = Math.max(axes.xRange[0], Math.min(axes.xRange[1], 0))
        const originY = Math.max(axes.yRange[0], Math.min(axes.yRange[1], 0))
        const common = { stroke: 'dim', width: 2, dash: [6, 7], ...style }
        return [line(axes.p(px, originY), axes.p(px, py), common), line(axes.p(originX, py), axes.p(px, py), common)]
    }
    const node = typeof x === 'function' || typeof y === 'function' ? dynamic(build) : new Node().add(...build())
    axes.add(node)
    return node
}

// ── Geometry marks ──────────────────────────────────────────────────────────

export interface AngleOptions {
    radius?: number
    color?: ColorInput
    width?: number
    label?: string
    labelSize?: number
    /** Soft wedge under the arc. */
    fillOpacity?: number
    /** Take the long way around. */
    reflex?: boolean
}

/** An angle at a vertex, between the rays toward two points. */
export function angleMark(vertex: Vec, from: Vec, to: Vec, options: AngleOptions = {}): Node {
    const radius = options.radius ?? 54
    const color = options.color ?? 'yellow'
    const a0 = Math.atan2(from[1] - vertex[1], from[0] - vertex[0])
    let sweep = Math.atan2(to[1] - vertex[1], to[0] - vertex[0]) - a0
    while (sweep <= -Math.PI) sweep += Math.PI * 2
    while (sweep > Math.PI) sweep -= Math.PI * 2
    if (options.reflex) sweep += sweep > 0 ? -Math.PI * 2 : Math.PI * 2
    const node = new Node()
    if (options.fillOpacity) {
        const points: Vec[] = [vertex]
        for (let i = 0; i <= 24; i++) {
            const a = a0 + sweep * i / 24
            points.push([vertex[0] + Math.cos(a) * radius, vertex[1] + Math.sin(a) * radius])
        }
        node.add(new Node(polyPath(points, true)).fill(color, options.fillOpacity))
    }
    node.add(new Node(arcPath(vertex[0], vertex[1], radius, radius, a0, a0 + sweep)).stroke(color, options.width ?? 3))
    if (options.label) {
        const size = options.labelSize ?? 30
        const mid = a0 + sweep / 2
        const distance = radius + size * 0.72
        node.add(tex(options.label, { size, color, display: false }).at(vertex[0] + Math.cos(mid) * distance, vertex[1] + Math.sin(mid) * distance))
    }
    return node
}

/** The small square that marks a right angle. */
export function rightAngle(vertex: Vec, a: Vec, b: Vec, options: { size?: number; color?: ColorInput; width?: number } = {}): Node {
    const size = options.size ?? 26
    const unit = (p: Vec): Vec => {
        const dx = p[0] - vertex[0], dy = p[1] - vertex[1]
        const l = Math.hypot(dx, dy) || 1
        return [dx / l, dy / l]
    }
    const [ax, ay] = unit(a), [bx, by] = unit(b)
    return new Node(polyPath([
        [vertex[0] + ax * size, vertex[1] + ay * size],
        [vertex[0] + (ax + bx) * size, vertex[1] + (ay + by) * size],
        [vertex[0] + bx * size, vertex[1] + by * size],
    ])).stroke(options.color ?? 'ink', options.width ?? 2.5)
}

// ── Matrices ────────────────────────────────────────────────────────────────

export interface MatrixOptions {
    size?: number
    color?: ColorInput
    /** Space between columns and rows, as multiples of size. */
    gapX?: number
    gapY?: number
    bracket?: '[' | '(' | '|'
    bracketColor?: ColorInput
}

const DELIMITERS: Record<'[' | '(' | '|', readonly [string, string]> = {
    '[': ['[', ']'], '(': ['(', ')'], '|': ['|', '|'],
}

/** A typeset matrix with real TeX brackets. Each entry is its own node. */
export class MatrixNode extends Node {
    readonly cells: TexNode[][]
    readonly entries = new Node()
    readonly brackets = new Node()
    readonly rowCount: number
    readonly colCount: number
    private readonly positions: Vec[][]
    private readonly options: MatrixOptions

    constructor(rows: readonly (readonly (string | number)[])[], options: MatrixOptions = {}) {
        super()
        this.options = options
        const size = options.size ?? 52
        const color = options.color ?? 'ink'
        this.rowCount = rows.length
        this.colCount = Math.max(0, ...rows.map((row) => row.length))
        const made = rows.map((row) => row.map((value) => {
            const cell = tex(String(value), { size, color, display: false })
            cell.set('py', -size * 0.25)
            return cell
        }))
        const widths = Array.from({ length: this.colCount }, (_, j) => Math.max(0, ...made.map((row) => row[j]?.width ?? 0)))
        const gapX = (options.gapX ?? 0.85) * size
        const rowStep = (options.gapY ?? 1.32) * size
        const totalWidth = widths.reduce((sum, w) => sum + w, 0) + gapX * Math.max(0, this.colCount - 1)
        const totalHeight = rowStep * Math.max(0, this.rowCount - 1) + size
        const columnX: number[] = []
        let cursor = -totalWidth / 2
        for (const width of widths) {
            columnX.push(cursor + width / 2)
            cursor += width + gapX
        }
        this.positions = made.map((row, i) => row.map((cell, j) => {
            const position: Vec = [columnX[j]!, (i - (this.rowCount - 1) / 2) * rowStep]
            cell.at(position)
            this.entries.add(cell)
            return position
        }))
        this.cells = made
        const kind = DELIMITERS[options.bracket ?? '[']
        // A delimiter is symmetric about the math axis, a quarter em above the baseline,
        // so a rule of half the height plus that quarter em asks for exactly this height.
        const em = (totalHeight + size * 0.5) / size
        const stretch = `\\rule{0pt}{${(em / 2 + 0.25).toFixed(3)}em}`
        const pad = size * 0.42
        const left = tex(`\\left${kind[0]}${stretch}\\right.`, { size, color: options.bracketColor ?? color })
        const right = tex(`\\left.${stretch}\\right${kind[1]}`, { size, color: options.bracketColor ?? color })
        left.moveTo([-totalWidth / 2 - pad - left.width / 2, 0])
        right.moveTo([totalWidth / 2 + pad + right.width / 2, 0])
        this.brackets.add(left, right)
        this.add(this.brackets, this.entries)
    }

    cell(row: number, column: number): TexNode {
        const found = this.cells[row]?.[column]
        if (!found) throw new Error(`Matrix has no cell (${row}, ${column}). It is ${this.rowCount} by ${this.colCount}.`)
        return found
    }

    row(index: number): TexNode[] {
        return [...(this.cells[index] ?? [])]
    }

    col(index: number): TexNode[] {
        return this.cells.map((row) => row[index]!).filter(Boolean)
    }

    /** Replace one entry, morphing matching glyphs. Later calls to `.cell` return the new one. */
    setCell(row: number, column: number, value: string | number, options: AnimOptions = {}): Anim {
        const size = this.options.size ?? 52
        const next = tex(String(value), { size, color: this.options.color ?? 'ink', display: false })
        next.set('py', -size * 0.25)
        const position = this.positions[row]![column]!
        next.at(position)
        const previous = this.cell(row, column)
        const self = this
        const anim = morphMatching(previous, next, { duration: 0.8, ...options })
        return {
            ...anim,
            schedule(ctx) {
                self.entries.add(next)
                next.track('visible').initial = false
                self.cells[row]![column] = next
                anim.schedule(ctx)
            },
        }
    }
}

export function matrix(rows: readonly (readonly (string | number)[])[], options: MatrixOptions = {}): MatrixNode {
    return new MatrixNode(rows, options)
}

// ── Annotation marks ────────────────────────────────────────────────────────

function boundsOf(target: Node | readonly Node[]): { x: number; y: number; width: number; height: number } {
    const list: readonly Node[] = Array.isArray(target) ? target as readonly Node[] : [target as Node]
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const node of list) {
        const b = node.bounds()
        x0 = Math.min(x0, b.x)
        y0 = Math.min(y0, b.y)
        x1 = Math.max(x1, b.x + b.width)
        y1 = Math.max(y1, b.y + b.height)
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export interface BraceLabelOptions {
    side?: 'bottom' | 'top' | 'left' | 'right'
    gap?: number
    size?: number
    color?: ColorInput
    /** Set for plain text labels. Labels are math by default. */
    plain?: boolean
    depth?: number
}

/** A brace along one side of a node or nodes, with a label at its point. */
export function braceLabel(target: Node | readonly Node[], label: string, options: BraceLabelOptions = {}): Node {
    const b = boundsOf(target)
    const side = options.side ?? 'bottom'
    const gap = options.gap ?? 12
    const color = options.color ?? 'ink'
    const size = options.size ?? 34
    const left = b.x, right = b.x + b.width, top = b.y, bottom = b.y + b.height
    const [from, to]: [Vec, Vec] = side === 'bottom' ? [[left, bottom + gap], [right, bottom + gap]]
        : side === 'top' ? [[right, top - gap], [left, top - gap]]
            : side === 'left' ? [[left - gap, top], [left - gap, bottom]]
                : [[right + gap, bottom], [right + gap, top]]
    const mark = brace(from, to, { stroke: color, depth: options.depth })
    const tip = mark.data['tip'] as Vec
    const caption = labelNode(label, { size, color, math: !options.plain })
    caption.moveTo(tip)
    const dir = direction(side as Side)
    const shifted = 10 + (dir[0] !== 0 ? caption.width / 2 : caption.height / 2)
    caption.shift(dir[0] * shifted, dir[1] * shifted)
    const made = new Node().add(mark, caption)
    // The caption sits beside the brace on purpose.
    made.data['ownLayout'] = true
    return made
}

export interface SurroundOptions {
    pad?: number
    radius?: number
    color?: ColorInput
    width?: number
    fill?: ColorInput
    fillOpacity?: number
    glow?: number
}

/** A rounded box around a node or nodes, measured now. */
export function surroundingBox(target: Node | readonly Node[], options: SurroundOptions = {}): Node {
    const b = boundsOf(target)
    const pad = options.pad ?? 12
    const box = rect(b.width + pad * 2, b.height + pad * 2, { radius: options.radius ?? 8, stroke: options.color ?? 'yellow', width: options.width ?? 2.5, glow: options.glow })
    if (options.fill) box.fill(options.fill, options.fillOpacity ?? 0.14)
    return box.at(b.x + b.width / 2, b.y + b.height / 2)
}

export interface LabeledDotOptions {
    color?: ColorInput
    radius?: number
    side?: Side
    gap?: number
    size?: number
    plain?: boolean
    labelColor?: ColorInput
}

/** A point with a label. The node's origin stays on the point. */
export class LabeledDot extends Node {
    readonly mark: Node
    readonly caption: Node

    constructor(label: string, options: LabeledDotOptions = {}) {
        super()
        const color = options.color ?? 'yellow'
        this.mark = dot(options.radius ?? 9, color)
        this.caption = labelNode(label, { size: options.size ?? 30, color: options.labelColor ?? color, math: !options.plain })
        this.add(this.mark, this.caption)
        this.caption.nextTo(this.mark, options.side ?? [0.72, -0.72], options.gap ?? 8)
    }
}

export function labeledDot(label: string, options: LabeledDotOptions = {}): LabeledDot {
    return new LabeledDot(label, options)
}

// ── Trails ──────────────────────────────────────────────────────────────────

export interface TracedOptions {
    color?: ColorInput
    width?: number
    /** Seconds of history to keep. Older parts of the trail are gone. */
    tail?: number
    /** Brightness at the old end, from 0 to 1. Use 1 for a solid trail. */
    fade?: number
    /** Samples per second along the trail. */
    rate?: number
    glow?: number
}

/**
 * The path a moving point has taken. It is computed by re-reading the point at
 * earlier times, so it scrubs correctly in both directions. The point function
 * should read Values or tracked node properties, not `update` overlays.
 */
export function traced(point: () => Vec, from: number, to: number, options: TracedOptions = {}): Node {
    const color = options.color ?? 'yellow'
    const width = options.width ?? 3
    const rate = options.rate ?? 60
    const fade = options.fade ?? (options.tail !== undefined ? 0 : 1)
    const bands = fade >= 1 ? 1 : 10
    const cache = new Map<number, Vec>()
    const sample = (index: number): Vec => {
        const cached = cache.get(index)
        if (cached) return cached
        const saved = clock.now
        clock.now = from + index / rate
        const value = point()
        clock.now = saved
        // Timeline values are only final once compile ends, so cache during rendering only.
        if (clock.mode === 'render') cache.set(index, value)
        return value
    }
    return dynamic((time) => {
        if (time <= from) return null
        const end = Math.min(time, to)
        const start = options.tail !== undefined ? Math.max(from, end - options.tail) : from
        const i0 = Math.ceil((start - from) * rate), i1 = Math.floor((end - from) * rate)
        if (i1 - i0 < 1) return null
        const points: Vec[] = []
        for (let i = i0; i <= i1; i++) points.push(sample(i))
        const saved = clock.now
        clock.now = end
        points.push(point())
        clock.now = saved
        const out: Node[] = []
        for (let band = 0; band < bands; band++) {
            const a = Math.floor((points.length - 1) * band / bands)
            const b = Math.min(points.length - 1, Math.floor((points.length - 1) * (band + 1) / bands))
            if (b - a < 1) continue
            const node = new Node([polylineRing(points.slice(a, b + 1))]).stroke(color, width)
            const light = bands === 1 ? 1 : fade + (1 - fade) * Math.pow((band + 1) / bands, 1.5)
            node.set('strokeOpacity', light)
            // Round caps would overlap at band joins and show as bright beads.
            if (band < bands - 1) node.set('cap', 'butt')
            if (options.glow) node.glow(options.glow)
            out.push(node)
        }
        return out
    })
}

// ── Fourier ─────────────────────────────────────────────────────────────────

export interface FourierTerm {
    /** Whole turns per trip around the shape. */
    readonly freq: number
    readonly amp: number
    readonly phase: number
}

/**
 * Discrete Fourier transform of a closed outline, largest terms first. Sample
 * the points evenly along the outline, for example with `samplePath`.
 */
export function fourier(points: readonly Vec[], options: { terms?: number } = {}): FourierTerm[] {
    const n = points.length
    const out: FourierTerm[] = []
    for (let k = 0; k < n; k++) {
        const freq = k <= n / 2 ? k : k - n
        let re = 0, im = 0
        for (let i = 0; i < n; i++) {
            const angle = -2 * Math.PI * freq * i / n
            const c = Math.cos(angle), s = Math.sin(angle)
            const [x, y] = points[i]!
            re += x * c - y * s
            im += x * s + y * c
        }
        out.push({ freq, amp: Math.hypot(re, im) / n, phase: Math.atan2(im, re) })
    }
    out.sort((a, b) => b.amp - a.amp || a.freq - b.freq)
    return options.terms ? out.slice(0, options.terms) : out
}

/** Value of a Fourier series at u, where u from 0 to 1 is one trip around the shape. */
export function fourierPoint(terms: readonly FourierTerm[], u: number): [number, number] {
    let x = 0, y = 0
    for (const term of terms) {
        const angle = 2 * Math.PI * term.freq * u + term.phase
        x += term.amp * Math.cos(angle)
        y += term.amp * Math.sin(angle)
    }
    return [x, y]
}

/** Evenly spaced points along a path, by arc length. */
export function samplePath(path: Path, count: number): Vec[] {
    const total = pathLength(path)
    if (total === 0) return []
    return Array.from({ length: count }, (_, i) => pointAt(path, i / count))
}

export interface EpicyclesOptions {
    /** Progress as a function of the timeline. 1 means one full trip. */
    u: () => number
    /** Most circles to draw. The sum still uses every term. */
    circles?: number
    circleColor?: ColorInput
    armColor?: ColorInput
    traceColor?: ColorInput
    traceWidth?: number
    glow?: number
    /** Share of a trip to keep lit. Use 1 for the whole drawing. */
    tail?: number
    samples?: number
}

/** Circles on circles: the tip of the chain draws the original shape. */
export class Epicycles extends Node {
    readonly terms: readonly FourierTerm[]
    private readonly outlinePoints: Vec[]

    constructor(terms: readonly FourierTerm[], options: EpicyclesOptions) {
        super()
        // Slow terms first: the eye reads the big circles as the skeleton.
        this.terms = [...terms].sort((a, b) => (a.freq === 0 ? -1 : b.freq === 0 ? 1 : 0) || b.amp - a.amp)
        const samples = options.samples ?? 1024
        this.outlinePoints = Array.from({ length: samples + 1 }, (_, i) => fourierPoint(this.terms, i / samples))
        const circles = options.circles ?? 64
        const circleColor = options.circleColor ?? 'blue'
        const armColor = options.armColor ?? 'ink'
        const traceColor = options.traceColor ?? 'yellow'
        const traceWidth = options.traceWidth ?? 3.5
        const tail = options.tail ?? 1
        const fadeBands = 12
        this.draw = () => {
            const u = options.u()
            const cycle = u - Math.floor(u)
            const out: Node[] = []
            let x = 0, y = 0
            const joints: Vec[] = []
            const bands: Ring[][] = [[], [], [], []]
            this.terms.forEach((term, index) => {
                const angle = 2 * Math.PI * term.freq * cycle + term.phase
                const nx = x + term.amp * Math.cos(angle), ny = y + term.amp * Math.sin(angle)
                if (index < circles && term.freq !== 0 && term.amp > 0.4) {
                    bands[Math.min(3, Math.floor(index / Math.max(1, circles) * 4))]!.push(...circlePath(x, y, term.amp))
                }
                x = nx
                y = ny
                if (index < circles) joints.push([x, y])
            })
            bands.forEach((rings, band) => {
                if (rings.length) out.push(new Node(rings).stroke(circleColor, 1.2).set('strokeOpacity', [0.55, 0.36, 0.22, 0.14][band]!))
            })
            if (joints.length >= 2) out.push(new Node([polylineRing(joints)]).stroke(armColor, 1.4).set('strokeOpacity', 0.85))
            const count = this.outlinePoints.length - 1
            const reach = u >= 1 ? count : Math.floor(cycle * count)
            const start = Math.max(0, reach - Math.floor(count * tail))
            if (reach - start >= 2) {
                if (tail >= 1) {
                    const trace = new Node([polylineRing(this.outlinePoints.slice(start, reach + 1))]).stroke(traceColor, traceWidth)
                    if (options.glow) trace.glow(options.glow)
                    out.push(trace)
                } else {
                    for (let band = 0; band < fadeBands; band++) {
                        const a = start + Math.floor((reach - start) * band / fadeBands)
                        const b = Math.min(reach, start + Math.floor((reach - start) * (band + 1) / fadeBands))
                        if (b - a < 1) continue
                        const node = new Node([polylineRing(this.outlinePoints.slice(a, b + 1))]).stroke(traceColor, traceWidth)
                        node.set('strokeOpacity', Math.pow((band + 1) / fadeBands, 1.5))
                        if (band < fadeBands - 1) node.set('cap', 'butt')
                        out.push(node)
                    }
                }
            }
            if (u < 1) out.push(dot(5, traceColor).at(x, y))
            return out
        }
    }

    /** The reconstructed outline as a path, for morphing the drawing into something else. */
    outline(): Path {
        return polyPath(this.outlinePoints.slice(0, -1), true)
    }

    point(u: number): [number, number] {
        return fourierPoint(this.terms, u)
    }
}

export function epicycles(terms: readonly FourierTerm[], options: EpicyclesOptions): Epicycles {
    return new Epicycles(terms, options)
}

/** A closed outline shrunk to a parametric function. */
export function ringThrough(f: (t: number) => Vec, samples = 200): Path {
    const path = parametricPath(f, 0, 1, samples)
    return path.map((r) => ring(r.p, true))
}

