import { curveThrough, linePath, type Path, type Vec } from './geometry'
import { Node, group } from './node'
import { arrow, dot, line, type ShapeStyle } from './shapes'
import { tex } from './tex'
import { text, type TextOptions } from './text'
import type { ColorInput } from './color'

export interface AxesOptions {
    /** Math range on the x axis. */
    x?: readonly [number, number]
    y?: readonly [number, number]
    /** On-screen size in stage pixels. */
    width?: number
    height?: number
    xStep?: number
    yStep?: number
    color?: ColorInput
    /** Number labels on ticks. */
    labels?: boolean
    labelSize?: number
    /** Faint background grid. */
    grid?: boolean
    xLabel?: string
    yLabel?: string
    tips?: boolean
}

/**
 * Coordinate axes. `.p(x, y)` converts math coordinates to stage points in this
 * group's local space, and `.plot(f)` draws a function on them.
 */
export class Axes extends Node {
    readonly xRange: readonly [number, number]
    readonly yRange: readonly [number, number]
    readonly plotWidth: number
    readonly plotHeight: number
    /** Lines and ticks, for drawing in on their own. */
    readonly lines = new Node()
    readonly grid = new Node()
    readonly numbers = new Node()

    constructor(options: AxesOptions = {}) {
        super()
        this.xRange = options.x ?? [-5, 5]
        this.yRange = options.y ?? [-3, 3]
        this.plotWidth = options.width ?? 1100
        this.plotHeight = options.height ?? 640
        const color = options.color ?? 'dim'
        const xStep = options.xStep ?? niceStep(this.xRange[1] - this.xRange[0])
        const yStep = options.yStep ?? niceStep(this.yRange[1] - this.yRange[0])
        const originX = clampInto(0, this.xRange), originY = clampInto(0, this.yRange)
        const left = this.p(this.xRange[0], originY), right = this.p(this.xRange[1], originY)
        const bottom = this.p(originX, this.yRange[0]), top = this.p(originX, this.yRange[1])

        if (options.grid) {
            for (const x of ticks(this.xRange, xStep)) {
                this.grid.add(line(this.p(x, this.yRange[0]), this.p(x, this.yRange[1]), { stroke: 'grid', width: 1.25 }))
            }
            for (const y of ticks(this.yRange, yStep)) {
                this.grid.add(line(this.p(this.xRange[0], y), this.p(this.xRange[1], y), { stroke: 'grid', width: 1.25 }))
            }
        }
        const tips = options.tips ?? true
        const axis = (from: Vec, to: Vec) => tips
            ? arrow(from, to, { stroke: color, width: 2, tip: 13 })
            : line(from, to, { stroke: color, width: 2 })
        this.lines.add(axis(left, right), axis(bottom, top))
        const tickSize = 6
        for (const x of ticks(this.xRange, xStep)) {
            if (x === originX) continue
            const [px, py] = this.p(x, originY)
            this.lines.add(line([px, py - tickSize], [px, py + tickSize], { stroke: color, width: 2 }))
        }
        for (const y of ticks(this.yRange, yStep)) {
            if (y === originY) continue
            const [px, py] = this.p(originX, y)
            this.lines.add(line([px - tickSize, py], [px + tickSize, py], { stroke: color, width: 2 }))
        }
        if (options.labels ?? true) {
            const size = options.labelSize ?? 20
            for (const x of ticks(this.xRange, xStep)) {
                if (x === originX) continue
                const [px, py] = this.p(x, originY)
                this.numbers.add(tex(formatTick(x), { size, color: 'dim', display: false }).moveTo([px, py + 26]))
            }
            for (const y of ticks(this.yRange, yStep)) {
                if (y === originY) continue
                const [px, py] = this.p(originX, y)
                this.numbers.add(tex(formatTick(y), { size, color: 'dim', display: false }).moveTo([px - 28, py]))
            }
        }
        this.add(this.grid, this.lines, this.numbers)
        if (options.xLabel) this.add(tex(options.xLabel, { size: 28, color: 'ink', display: false }).moveTo([right[0] + 4, right[1] - 26]))
        if (options.yLabel) {
            const label = tex(options.yLabel, { size: 28, color: 'ink', display: false })
            this.add(label.moveTo([top[0] + 16 + label.width / 2, top[1] + 4]))
        }
    }

    /** Math coordinates to this group's local stage coordinates. */
    p(x: number, y: number): [number, number] {
        const [x0, x1] = this.xRange, [y0, y1] = this.yRange
        return [
            ((x - x0) / (x1 - x0) - 0.5) * this.plotWidth,
            (0.5 - (y - y0) / (y1 - y0)) * this.plotHeight,
        ]
    }

    /** Math coordinates to stage coordinates, following this group's transform. */
    world(x: number, y: number): [number, number] {
        const [lx, ly] = this.p(x, y)
        return this.toWorld(lx, ly)
    }

    /** Geometry of a function over a range, clipped to the visible y range. */
    plotPath(f: (x: number) => number, options: { from?: number; to?: number; samples?: number } = {}): Path {
        const from = options.from ?? this.xRange[0], to = options.to ?? this.xRange[1]
        const samples = options.samples ?? 160
        const [y0, y1] = this.yRange
        const margin = (y1 - y0) * 0.02
        const points: Vec[] = []
        for (let i = 0; i <= samples; i++) {
            const x = from + (to - from) * i / samples
            const y = f(x)
            points.push(Number.isFinite(y) && y >= y0 - margin && y <= y1 + margin ? this.p(x, y) : [NaN, NaN])
        }
        return curveThrough(points)
    }

    /** Draw a function on the axes. The curve becomes a child, so it moves with them. */
    plot(f: (x: number) => number, style: ShapeStyle & { from?: number; to?: number; samples?: number } = {}): Node {
        const curve = new Node(this.plotPath(f, style)).stroke(style.stroke ?? 'blue', style.width ?? 4)
        if (style.glow) curve.glow(style.glow)
        if (style.dash) curve.dash(style.dash)
        this.add(curve)
        return curve
    }

    /** A point on the axes. */
    dotAt(x: number, y: number, color: ColorInput = 'yellow', radius = 9): Node {
        const point = dot(radius, color).at(this.p(x, y))
        this.add(point)
        return point
    }

    /** Dashed guides from a point down to both axes. */
    guides(x: number, y: number, style: ShapeStyle = {}): Node {
        const originX = clampInto(0, this.xRange), originY = clampInto(0, this.yRange)
        const made = group(
            line(this.p(x, originY), this.p(x, y), { stroke: 'dim', width: 2, dash: [6, 7], ...style }),
            line(this.p(originX, y), this.p(x, y), { stroke: 'dim', width: 2, dash: [6, 7], ...style }),
        )
        this.add(made)
        return made
    }
}

export function axes(options: AxesOptions = {}): Axes {
    return new Axes(options)
}

function clampInto(value: number, range: readonly [number, number]): number {
    return Math.max(range[0], Math.min(range[1], value))
}

function niceStep(span: number): number {
    const rough = span / 8
    const power = Math.pow(10, Math.floor(Math.log10(rough)))
    const unit = rough / power
    return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power
}

function ticks(range: readonly [number, number], step: number): number[] {
    const out: number[] = []
    const first = Math.ceil(range[0] / step - 1e-9) * step
    for (let value = first; value <= range[1] + 1e-9; value += step) out.push(Math.round(value / step) * step)
    return out
}

function formatTick(value: number): string {
    const rounded = Math.round(value * 1000) / 1000
    return String(rounded)
}

export interface PlaneOptions {
    /** Stage pixels per math unit. */
    unit?: number
    /** Extent in math units. Defaults to overscan past the frame edges, for warps that pull in. */
    x?: readonly [number, number]
    y?: readonly [number, number]
    color?: ColorInput
    /** Minor grid lines per unit. */
    minor?: number
    axisColor?: ColorInput
    width?: number
}

/**
 * The classic infinite grid. Each line is a dense path, so it bends smoothly
 * under `applyMatrix` and under `warp` with a nonlinear function.
 */
export class NumberPlane extends Node {
    readonly unit: number
    readonly major = new Node()
    readonly minor = new Node()
    readonly axes = new Node()

    constructor(options: PlaneOptions = {}) {
        super()
        this.unit = options.unit ?? 120
        const [x0, x1] = options.x ?? [-12, 12]
        const [y0, y1] = options.y ?? [-8, 8]
        const u = this.unit
        const stroke = options.color ?? 'blue'
        const width = options.width ?? 1.6
        const minorPerUnit = options.minor ?? 0
        const segment = (a: Vec, b: Vec, count: number): Path => {
            const points: Vec[] = []
            for (let i = 0; i <= count; i++) points.push([a[0] + (b[0] - a[0]) * i / count, a[1] + (b[1] - a[1]) * i / count])
            return points.length > 2 ? curveThrough(points) : linePath(a, b)
        }
        const density = 16
        const add = (parent: Node, a: Vec, b: Vec, color: ColorInput, w: number, count: number) => {
            parent.add(new Node(segment(a, b, count)).stroke(color, w))
        }
        for (let x = x0; x <= x1; x++) {
            if (minorPerUnit > 0 && x < x1) {
                for (let k = 1; k < minorPerUnit; k++) {
                    const mx = x + k / minorPerUnit
                    add(this.minor, [mx * u, y0 * u], [mx * u, y1 * u], 'grid', 1, density)
                }
            }
            if (x !== 0) add(this.major, [x * u, y0 * u], [x * u, y1 * u], stroke, width, density)
        }
        for (let y = y0; y <= y1; y++) {
            if (minorPerUnit > 0 && y < y1) {
                for (let k = 1; k < minorPerUnit; k++) {
                    const my = y + k / minorPerUnit
                    add(this.minor, [x0 * u, my * u], [x1 * u, my * u], 'grid', 1, density)
                }
            }
            if (y !== 0) add(this.major, [x0 * u, y * u], [x1 * u, y * u], stroke, width, density)
        }
        const axisColor = options.axisColor ?? 'ink'
        add(this.axes, [x0 * u, 0], [x1 * u, 0], axisColor, 2.6, density)
        add(this.axes, [0, y0 * u], [0, y1 * u], axisColor, 2.6, density)
        this.add(this.minor, this.major, this.axes)
    }

    /** Math coordinates to stage coordinates. y points up on the plane. */
    p(x: number, y: number): [number, number] {
        return [x * this.unit, -y * this.unit]
    }

    /** A vector drawn from the origin, as an arrow. */
    vector(x: number, y: number, style: ShapeStyle = {}): Node {
        return arrow([0, 0], this.p(x, y), { stroke: 'yellow', width: 5, tip: 22, ...style })
    }
}

export function plane(options: PlaneOptions = {}): NumberPlane {
    return new NumberPlane(options)
}

export interface DecimalOptions {
    digits?: number
    size?: number
    color?: ColorInput
    /** Defaults to mono, in every film: a number that changes keeps its width in mono. */
    font?: TextOptions['font']
    prefix?: string
    suffix?: string
}

/** A number readout that follows a function of the timeline, drawn fresh each frame. */
export function decimal(read: () => number, options: DecimalOptions = {}): Node {
    const node = new Node()
    node.draw = () => {
        const value = read()
        const body = (options.prefix ?? '') + value.toFixed(options.digits ?? 2) + (options.suffix ?? '')
        return text(body, { size: options.size ?? 36, color: options.color ?? 'ink', font: options.font ?? 'mono' })
    }
    return node
}
