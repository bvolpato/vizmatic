import { curveThrough, linePath, polyPath, type Path, type Ring, type Vec } from './geometry'
import { Node, dynamic, group, ownLabels, objectName } from './node'
import { arrow, dot, line, type ShapeStyle } from './shapes'
import { tex } from './tex'
import { text, type TextOptions } from './text'
import type { ColorInput } from './color'
import { valueAt } from './numbers'
import { said } from './objects/util'

/** A number, or a function that gives the number now: `() => t.value` follows a Value of the film. */
export type Reactive = number | (() => number)
/** The two ends of an axis, or a function that gives them now, for a window that moves. */
export type AxisRange = readonly [number, number] | (() => readonly [number, number])
/**
 * What a plot draws: a function of x, or the points of a series as `[x, y]` with x in rising order. A function
 * is a smooth curve through even samples. A series is straight lines through its own points, so its shape
 * stays the same while it grows or scrolls.
 */
export type Curve = ((x: number) => number) | readonly Vec[]

/** The number of a value now. A function must give a number: a wrong one stops the frame, and the message names the call. */
function read(what: string, name: string, value: Reactive): number {
    if (typeof value !== 'function') return value
    const given: unknown = value()
    if (typeof given !== 'number' || !Number.isFinite(given)) throw new Error(`${what}: the function of ${name} gave ${said(given)}. It gives the number now, such as () => now.value`)
    return given
}

/** A curve that a call has checked: its value at x, and the x of each of its own points when it is a series. */
export interface Sampled {
    readonly at: (x: number) => number
    readonly xs: readonly number[] | null
}

/** Check a curve of a plot or of an area. An error names the call and the argument, and says what to give. */
export function curveOf(what: string, name: string, curve: unknown): Sampled {
    if (typeof curve === 'function') return { at: curve as (x: number) => number, xs: null }
    if (!Array.isArray(curve)) throw new Error(`${what}: ${name} is a function of x, such as (x) => x * x, or the points of a series, such as [[0, 2], [1, 5]], and it is ${said(curve)}`)
    const points = curve as readonly unknown[]
    points.forEach((point, index) => {
        if (!Array.isArray(point) || point.length !== 2 || typeof point[0] !== 'number' || typeof point[1] !== 'number' || !Number.isFinite(point[0])) {
            throw new Error(`${what}: point ${index} of ${name} is ${said(point)}. A point of a series is [x, y], and its x is a number`)
        }
        const before = index > 0 ? (points[index - 1] as Vec)[0] : -Infinity
        if (!(point[0] > before)) throw new Error(`${what}: point ${index} of ${name} has the x ${point[0]}, and the point before it has the x ${before}. The points of a series have their x in rising order`)
    })
    const series = curve as readonly Vec[]
    return { at: (x) => valueAt(series, x), xs: series.map((point) => point[0]) }
}

/** Check an end of a curve or of an area: none, a number, or a function that gives a number. */
export function endOf(what: string, name: string, value: unknown): Reactive | undefined {
    if (value === undefined || typeof value === 'function' || (typeof value === 'number' && Number.isFinite(value))) return value as Reactive | undefined
    throw new Error(`${what}: ${name} is a number, or a function that gives the number now, such as () => now.value, and it is ${said(value)}`)
}

/**
 * The x values at which a plot samples its curves between two ends. For functions, they cut the span into
 * `samples` equal parts. With a series, they are the two ends and the x of each point of the series between
 * them, so the samples stay at the data when an end moves.
 */
export function sampleXs(from: number, to: number, samples: number, curves: readonly Sampled[]): number[] {
    const series = curves.filter((curve) => curve.xs !== null)
    if (series.length === 0) return Array.from({ length: samples + 1 }, (_, i) => from + (to - from) * i / samples)
    if (!(to > from)) return []
    const inner = new Set<number>()
    for (const curve of series) {
        const xs = curve.xs!
        // The first point after the left end, by halving.
        let low = 0, high = xs.length
        while (low < high) {
            const middle = (low + high) >> 1
            if (xs[middle]! > from) high = middle
            else low = middle + 1
        }
        for (let i = low; i < xs.length && xs[i]! < to; i++) inner.add(xs[i]!)
    }
    return [from, ...[...inner].sort((a, b) => a - b), to]
}

export interface AxesOptions {
    /**
     * Math range on the x axis. A function gives the range now, for a window that moves along a series:
     * `x: () => [now.value - 60, now.value + 20]`. The axes then draw their ticks, their numbers and each
     * curve again on every frame, and a tick fades as it comes to an end of the range.
     */
    x?: AxisRange
    /** Math range on the y axis. It takes a function too. A y range that moves fast is hard to read: keep it, or move it slowly. */
    y?: AxisRange
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

export interface PlotOptions extends ShapeStyle {
    /** Where the curve starts and ends on the x axis. A function follows a Value, so `to: () => now.value` draws the curve up to a time. */
    from?: Reactive
    to?: Reactive
    /** The number of equal parts that a function is sampled at. A series has its own points. */
    samples?: number
}

export interface AxisMarkerOptions {
    /** A value on the x axis: the line is vertical, and its label is over the plot. A function follows a Value. */
    x?: Reactive
    /** A value on the y axis: the line is level, and its label is at the right of the plot. Give x or y, and not both. */
    y?: Reactive
    label?: string
    color?: ColorInput
    width?: number
    /** The dashes of the line. Pass null for a solid line. */
    dash?: readonly number[] | null
    glow?: number
    labelSize?: number
    /** The font of the label. Defaults to the font of the film. */
    font?: TextOptions['font']
}

/** The last pixels before an end of a range that moves, over which a tick fades. */
const TICK_FADE = 40
/** How far a tick goes to each side of its axis. */
const TICK_SIZE = 6
/** The least room between a number and the end of its tick: enough to see that the two do not touch. */
const TICK_ROOM = 4
/** The most ticks of one axis with a range that moves. Such axes draw each tick again on every frame. */
const MOST_TICKS = 200

/**
 * Coordinate axes. `.p(x, y)` converts math coordinates to stage points in this
 * group's local space, and `.plot(f)` draws a function on them.
 */
export class Axes extends Node {
    readonly plotWidth: number
    readonly plotHeight: number
    /** Lines and ticks, for drawing in on their own. */
    readonly lines = new Node()
    readonly grid = new Node()
    readonly numbers = new Node()
    /**
     * True when a range is a function. The ticks, the grid, the numbers, the names of the axes, and each mark
     * that a helper puts on the axes are then drawn again on every frame, at their place for the range of that
     * frame. So fade these parts in: `draw` has no line to trace.
     */
    readonly moving: boolean
    private readonly xSource: AxisRange
    private readonly ySource: AxisRange
    /** What the frame is drawn with: it is drawn one time, or again on every frame when a range moves. */
    private readonly style: { color: ColorInput; xStep?: number; yStep?: number; tips: boolean; labelSize: number }

    constructor(options: AxesOptions = {}) {
        super()
        this.xSource = rangeSource('x', options.x) ?? [-5, 5]
        this.ySource = rangeSource('y', options.y) ?? [-3, 3]
        this.moving = typeof this.xSource === 'function' || typeof this.ySource === 'function'
        this.plotWidth = options.width ?? 1100
        this.plotHeight = options.height ?? 640
        this.style = { color: options.color ?? 'dim', xStep: options.xStep, yStep: options.yStep, tips: options.tips ?? true, labelSize: options.labelSize ?? 20 }
        const numbers = options.labels ?? true
        if (this.moving) {
            // A range that is wrong now stops the build here, and not at the first frame.
            this.steps()
            if (options.grid) this.grid.draw = () => this.gridMarks()
            this.lines.draw = () => this.lineMarks()
            if (numbers) this.numbers.draw = () => this.numberMarks()
        } else {
            if (options.grid) this.grid.add(...this.gridMarks())
            this.lines.add(...this.lineMarks())
            if (numbers) this.numbers.add(...this.numberMarks())
        }
        this.add(this.grid, this.lines, this.numbers)
        // The names of the axes are at the ends of the axis lines, so they move when the origin moves.
        const names = () => this.nameMarks(options.xLabel, options.yLabel)
        if (options.xLabel || options.yLabel) this.add(...(this.moving ? [dynamic(names)] : names()))
        ownLabels(this, { name: 'pair of axes', plot: true })
    }

    /** The x range now. On axes with a range that moves, it changes with the time of the film. */
    get xRange(): readonly [number, number] {
        return rangeNow('x', this.xSource)
    }

    get yRange(): readonly [number, number] {
        return rangeNow('y', this.ySource)
    }

    /** The ticks of each axis and the point where the axes cross, for the ranges now. */
    private steps(): { xs: number[]; ys: number[]; originX: number; originY: number } {
        const xRange = this.xRange, yRange = this.yRange
        const xStep = this.style.xStep ?? niceStep(xRange[1] - xRange[0]), yStep = this.style.yStep ?? niceStep(yRange[1] - yRange[0])
        if (this.moving) {
            for (const [axis, range, step] of [['x', xRange, xStep], ['y', yRange, yStep]] as const) {
                const count = (range[1] - range[0]) / step
                if (!(count <= MOST_TICKS)) throw new Error(`axes: the ${axis} range ${range[0]} to ${range[1]} has ${Number.isFinite(count) ? Math.round(count) : 'no end of'} ticks at a step of ${step}, and axes with a range that moves draw each tick again on every frame. Give a larger ${axis}Step`)
            }
        }
        return { xs: ticks(xRange, xStep), ys: ticks(yRange, yStep), originX: clampInto(0, xRange), originY: clampInto(0, yRange) }
    }

    /**
     * How much of a tick shows. On a range that moves, a tick comes in and goes out over the last pixels
     * before an end of the range, so no number appears at once. `half` is half of the size of a number along
     * its axis: a number is gone before any part of it passes the end of the axis.
     */
    private shown(axis: 'x' | 'y', value: number, half = 0): number {
        const moves = typeof (axis === 'x' ? this.xSource : this.ySource) === 'function'
        if (!moves) return 1
        const range = axis === 'x' ? this.xRange : this.yRange, length = axis === 'x' ? this.plotWidth : this.plotHeight
        const along = (value - range[0]) / (range[1] - range[0]) * length
        return Math.max(0, Math.min(1, (Math.min(along, length - along) - half) / TICK_FADE))
    }

    /** True when a point is inside both ranges now. On axes with a range that moves, a mark at a point outside does not show. */
    holds(x: number, y: number): boolean {
        const [x0, x1] = this.xRange, [y0, y1] = this.yRange
        return x >= x0 && x <= x1 && y >= y0 && y <= y1
    }

    private gridMarks(): Node[] {
        const { xs, ys } = this.steps(), xRange = this.xRange, yRange = this.yRange
        return [
            ...xs.map((x) => faded(line(this.p(x, yRange[0]), this.p(x, yRange[1]), { stroke: 'grid', width: 1.25 }), this.shown('x', x))),
            ...ys.map((y) => faded(line(this.p(xRange[0], y), this.p(xRange[1], y), { stroke: 'grid', width: 1.25 }), this.shown('y', y))),
        ].filter((mark): mark is Node => mark !== null)
    }

    private lineMarks(): Node[] {
        const { xs, ys, originX, originY } = this.steps(), xRange = this.xRange, yRange = this.yRange
        const color = this.style.color
        const axis = (from: Vec, to: Vec) => this.style.tips
            ? arrow(from, to, { stroke: color, width: 2, tip: 13 })
            : line(from, to, { stroke: color, width: 2 })
        const out: (Node | null)[] = [
            axis(this.p(xRange[0], originY), this.p(xRange[1], originY)),
            axis(this.p(originX, yRange[0]), this.p(originX, yRange[1])),
        ]
        for (const x of xs) {
            if (x === originX) continue
            const [px, py] = this.p(x, originY)
            out.push(faded(line([px, py - TICK_SIZE], [px, py + TICK_SIZE], { stroke: color, width: 2 }), this.shown('x', x)))
        }
        for (const y of ys) {
            if (y === originY) continue
            const [px, py] = this.p(originX, y)
            out.push(faded(line([px - TICK_SIZE, py], [px + TICK_SIZE, py], { stroke: color, width: 2 }), this.shown('y', y)))
        }
        return out.filter((mark): mark is Node => mark !== null)
    }

    private numberMarks(): Node[] {
        const { xs, ys, originX, originY } = this.steps()
        const size = this.style.labelSize
        // The middle of a number is 26 pixels under the x axis, or 28 beside the y axis. On fixed axes that is so at
        // every size of the numbers: films place what is beside the axes by it, so a number must not move there.
        // Axes with a range that moves are newer, and their room grows with the size of the numbers.
        const grown = this.moving ? size / 20 : 1
        const under = 26 * grown, beside = 28 * grown
        // A large or a wide number would touch its tick at that place. It moves away as far as it must to clear the tick, and no further.
        const clear = TICK_SIZE + TICK_ROOM
        const out: (Node | null)[] = []
        for (const x of xs) {
            if (x === originX) continue
            const [px, py] = this.p(x, originY)
            const number = tex(formatTick(x), { size, color: 'dim', display: false })
            number.moveTo([px, py + Math.max(under, clear + number.height / 2)])
            out.push(faded(number, this.shown('x', x, this.moving ? number.width / 2 : 0)))
        }
        for (const y of ys) {
            if (y === originY) continue
            const [px, py] = this.p(originX, y)
            const number = tex(formatTick(y), { size, color: 'dim', display: false })
            number.moveTo([px - Math.max(beside, clear + number.width / 2), py])
            out.push(faded(number, this.shown('y', y, this.moving ? number.height / 2 : 0)))
        }
        return out.filter((mark): mark is Node => mark !== null)
    }

    /** The name of each axis, at the end of its line. */
    private nameMarks(xLabel?: string, yLabel?: string): Node[] {
        const originX = clampInto(0, this.xRange), originY = clampInto(0, this.yRange)
        const right = this.p(this.xRange[1], originY), top = this.p(originX, this.yRange[1])
        const out: Node[] = []
        if (xLabel) out.push(tex(xLabel, { size: 28, color: 'ink', display: false }).moveTo([right[0] + 4, right[1] - 26]))
        if (yLabel) {
            const label = tex(yLabel, { size: 28, color: 'ink', display: false })
            out.push(label.moveTo([top[0] + 16 + label.width / 2, top[1] + 4]))
        }
        return out
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

    /** Geometry of a function or of a series over a range, clipped to the visible y range. */
    plotPath(curve: Curve, options: { from?: number; to?: number; samples?: number } = {}): Path {
        return this.pathOf(curveOf('plotPath', 'the curve', curve), options.from ?? this.xRange[0], options.to ?? this.xRange[1], options.samples)
    }

    private pathOf(curve: Sampled, from: number, to: number, samples = 160): Path {
        const [y0, y1] = this.yRange
        const margin = (y1 - y0) * 0.02
        const points: Vec[] = sampleXs(from, to, samples, [curve]).map((x) => {
            const y = curve.at(x)
            return Number.isFinite(y) && y >= y0 - margin && y <= y1 + margin ? this.p(x, y) : [NaN, NaN]
        })
        return curve.xs === null ? curveThrough(points) : linesThrough(points)
    }

    /**
     * Draw a function or a series on the axes. The curve becomes a child, so it moves with them. A series is
     * the list of its points, `[x, y]` with x in rising order, and it is drawn as straight lines through them.
     * With a `from` or a `to` that is a function, and on axes with a range that moves, the curve is drawn
     * again on every frame: it grows with a Value, and it is cut at the two ends of a range that moves.
     */
    plot(curve: Curve, style: PlotOptions = {}): Node {
        const sampled = curveOf('plot', 'the curve', curve)
        const from = endOf('plot', 'from', style.from), to = endOf('plot', 'to', style.to)
        const styled = (path: Path): Node => {
            const made = new Node(path).stroke(style.stroke ?? 'blue', style.width ?? 4)
            if (style.glow) made.glow(style.glow)
            if (style.dash) made.dash(style.dash)
            return made
        }
        const made = this.moving || typeof from === 'function' || typeof to === 'function'
            ? objectName(dynamic(() => {
                const [a, b] = this.span(from, to)
                return b > a ? styled(this.pathOf(sampled, a, b, style.samples)) : null
            }), 'curve')
            : styled(this.pathOf(sampled, from ?? this.xRange[0], to ?? this.xRange[1], style.samples))
        this.add(made)
        return made
    }

    /** The two ends of a curve or an area now. On axes with a range that moves, they stay inside the x range. `what` names the call in a message. */
    span(from: Reactive | undefined, to: Reactive | undefined, what = 'plot'): [number, number] {
        const [x0, x1] = this.xRange
        const a = from === undefined ? x0 : read(what, 'from', from), b = to === undefined ? x1 : read(what, 'to', to)
        return this.moving ? [Math.max(a, x0), Math.min(b, x1)] : [a, b]
    }

    /** A point on the axes. On axes with a range that moves, it follows the range, and it does not show while it is outside. */
    dotAt(x: number, y: number, color: ColorInput = 'yellow', radius = 9): Node {
        const build = () => dot(radius, color).at(this.p(x, y))
        const point = this.moving ? dynamic(() => (this.holds(x, y) ? build() : null)) : build()
        this.add(point)
        return point
    }

    /** Dashed guides from a point down to both axes. On axes with a range that moves, they follow the range, and they do not show while the point is outside. */
    guides(x: number, y: number, style: ShapeStyle = {}): Node {
        const build = (): Node[] => {
            const originX = clampInto(0, this.xRange), originY = clampInto(0, this.yRange)
            return [
                line(this.p(x, originY), this.p(x, y), { stroke: 'dim', width: 2, dash: [6, 7], ...style }),
                line(this.p(originX, y), this.p(x, y), { stroke: 'dim', width: 2, dash: [6, 7], ...style }),
            ]
        }
        const made = this.moving ? dynamic(() => (this.holds(x, y) ? build() : null)) : group(...build())
        this.add(made)
        return made
    }

    /**
     * A line across the plot at one value of x or of y, with a label at its end: the present on a time axis, a
     * deploy, a limit. `marker({ x: () => now.value, label: 'now' })` follows a Value. The label of a vertical
     * line is over the plot, and the label of a level line is at the right of the plot. Near an end of the
     * plot, the label stays beside the plot: it does not pass the end. A marker that follows a value does not
     * show while the value is outside the range.
     */
    marker(options: AxisMarkerOptions): Node {
        const what = 'axes.marker'
        if (typeof options !== 'object' || options === null) throw new Error(`${what}: the options are an object such as { x: 3, label: 'now' }, and the argument is ${said(options)}`)
        const vertical = options.x !== undefined
        if (vertical === (options.y !== undefined)) throw new Error("axes.marker: give x for a vertical line or y for a level line, and one of the two only, such as marker({ x: 3, label: 'now' })")
        const value = endOf(what, vertical ? 'x' : 'y', vertical ? options.x : options.y)!
        const color = options.color ?? 'yellow', size = options.labelSize ?? 28
        if (options.label !== undefined && typeof options.label !== 'string') throw new Error(`${what}: label is the text at the end of the line, and it is ${said(options.label)}`)
        if (!(size > 0) || !Number.isFinite(size)) throw new Error(`${what}: labelSize is the size of the label in pixels, more than 0, and it is ${said(options.labelSize)}`)
        // The room between the label and the end of the line: more than the 0.3 of the text size that the film check asks for.
        const gap = size * 0.4
        const label = (): Node | null => (options.label ? text(options.label, { size, color, font: options.font }) : null)
        const measure = label()
        if (measure && vertical && measure.width > this.plotWidth) {
            throw new Error(`${what}: the label ${JSON.stringify(options.label)} is ${Math.ceil(measure.width)} wide, and the plot is ${this.plotWidth} wide. Use a shorter label, or a smaller labelSize`)
        }
        const build = (): Node[] => {
            const at = read(what, vertical ? 'x' : 'y', value), xRange = this.xRange, yRange = this.yRange
            const [low, high] = vertical ? xRange : yRange
            if (!(at >= low && at <= high)) return []
            const from = vertical ? this.p(at, yRange[0]) : this.p(xRange[0], at), to = vertical ? this.p(at, yRange[1]) : this.p(xRange[1], at)
            const mark = line(from, to, { stroke: color, width: options.width ?? 2.5, glow: options.glow, dash: options.dash === null ? undefined : options.dash ?? [8, 8] })
            const name = label()
            if (!name) return [mark]
            // Along the plot, the middle of the label stays this far from the middle of the plot, so no part of it passes an end.
            const room = Math.max(0, (vertical ? this.plotWidth - name.width : this.plotHeight - name.height) / 2)
            const inside = (place: number) => Math.max(-room, Math.min(room, place))
            return [mark, name.moveTo(vertical ? [inside(to[0]), to[1] - gap - name.height / 2] : [to[0] + gap + name.width / 2, inside(to[1])])]
        }
        const live = this.moving || typeof value === 'function'
        if (!live && build().length === 0) {
            const [low, high] = vertical ? this.xRange : this.yRange
            throw new Error(`${what}: ${vertical ? 'x' : 'y'} is ${read(what, vertical ? 'x' : 'y', value)}, and the ${vertical ? 'x' : 'y'} range is ${low} to ${high}. Give a value inside the range`)
        }
        const node = objectName(live ? dynamic(build) : new Node().add(...build()), 'marker')
        this.add(node)
        ownLabels(this, { labels: [node] })
        return node
    }
}

export function axes(options: AxesOptions = {}): Axes {
    return new Axes(options)
}

/** A range of an axis as it was given, checked: none, two numbers, or a function. */
function rangeSource(axis: 'x' | 'y', range: unknown): AxisRange | undefined {
    if (range === undefined || typeof range === 'function' || Array.isArray(range)) return range as AxisRange | undefined
    throw new Error(`axes: ${axis} is the range of the ${axis} axis: its two ends, such as [0, 10], or a function that gives them now, and it is ${said(range)}`)
}

/** The two ends of a range now. A function must give two numbers, the first one under the second. */
function rangeNow(axis: 'x' | 'y', source: AxisRange): readonly [number, number] {
    if (typeof source !== 'function') return source
    const range: unknown = source()
    if (!Array.isArray(range) || range.length !== 2 || !Number.isFinite(range[0]) || !Number.isFinite(range[1]) || !(range[1] > range[0])) {
        throw new Error(`axes: the function of the ${axis} range gave ${said(range)}. It gives the two ends of the range now, the first one under the second, such as () => [now.value - 8, now.value + 4]`)
    }
    return range as [number, number]
}

/** A mark at a part of its opacity, or null for a mark that does not show. */
function faded(mark: Node, alpha: number): Node | null {
    if (alpha <= 0) return null
    return alpha < 1 ? mark.opacity(alpha) : mark
}

/** Straight segments through samples. A sample that is not finite splits the line, as in `curveThrough`. */
function linesThrough(points: readonly Vec[]): Path {
    const rings: Ring[] = []
    let run: Vec[] = []
    const flush = () => {
        if (run.length >= 2) rings.push(...polyPath(run))
        run = []
    }
    for (const point of points) {
        if (Number.isFinite(point[0]) && Number.isFinite(point[1])) run.push(point)
        else flush()
    }
    flush()
    return rings
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
        objectName(this, 'number plane')
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
