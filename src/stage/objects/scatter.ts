import { apply, arcPath, circlePath, invert, polyPath, rectPath, reverseRing, smoothPath, type Path, type Vec } from '../geometry'
import { Node, ownLabels, rebindCloneParts } from '../node'
import { dot, line } from '../shapes'
import { text, type TextOptions } from '../text'
import { over, toPaint, type ColorInput, type Paint, type Rgba } from '../color'
import { Value, type Anim, type AnimContext, type AnimOptions } from '../anim'
import type { Ease } from '../ease'
import { changesNow, clock, Track } from '../track'
import type { Box } from '../layout'
import type { ChartOptions } from './charts'
import { DEFAULT_SERIES, Part, propAt, reveal, small, solidColor, staggered, stepAt, tweenValue, worldBox, xyAxes, xyPoint, type XYFrame } from './util'

/** The mark of a point. A group can have its own, as a second sign beside its color. */
export type ScatterShape = 'dot' | 'ring' | 'square' | 'diamond' | 'triangle'

export interface ScatterPoint {
    x: number
    y: number
    color?: ColorInput
    radius?: number
    /** Points with the same group share a color and one direct label. */
    group?: string
    /** The identity of the point, for `move`, `assign`, `nearest` and `point`. The chart writes it beside the point. */
    name?: string
    /** The text beside the point. Defaults to the name. `false` writes none. */
    label?: string | false
    /** Where the text goes. Without it, the chart takes the first place that is free. */
    side?: 'right' | 'left' | 'over' | 'under'
    /** A point that asks, such as the query of a search: a dot in a ring. A search for the nearest points does not find it. */
    query?: boolean
}

/** The look of a group: its color and the mark of its points. */
export interface ScatterGroup {
    color?: ColorInput
    /** Defaults to dot. */
    shape?: ScatterShape
    /** Write the name of the group over its points. On by default. Use false for a group whose points have names, such as the centers of a partition. */
    label?: boolean
}

export interface ScatterOptions extends ChartOptions {
    x?: readonly [number, number]
    y?: readonly [number, number]
    radius?: number
    xLabel?: string
    yLabel?: string
    /** Label each group near its center, instead of using a legend. */
    groupLabels?: boolean
    /**
     * The look of each group, by its name: a color, or `{ color, shape }`. A group that no point has at the
     * start must be here, so that `assign` knows it.
     */
    groups?: Readonly<Record<string, ColorInput | ScatterGroup>>
    /** Text size of the names of the points. Defaults to 26. */
    nameSize?: number
}

/** A point as a function of `find`, of `among` and of a list of verbs sees it, after the changes that are scheduled so far. */
export interface ScatterPointView {
    readonly index: number
    readonly name: string | undefined
    readonly x: number
    readonly y: number
    readonly group: string | undefined
    /** True for a point that asks: a search does not find it. */
    readonly query: boolean
}

/** One point, some points, or the points that a function picks: an index, a name, a list of them, or a function of a point. */
export type ScatterWhich = number | string | readonly (number | string)[] | ((point: ScatterPointView) => boolean)

/** A point that a search found, with its distance in the units of the axes. */
export interface ScatterNeighbor {
    readonly index: number
    readonly name: string | undefined
    readonly distance: number
}

export interface ScatterAreaOptions {
    /** The color of the outline and of the shade. */
    color?: ColorInput
    /** Start with the shade on. A hull starts with it, and a cell and a span start without it. */
    shaded?: boolean
}

type Side = 'right' | 'left' | 'over' | 'under' | 'upper right' | 'upper left' | 'lower right' | 'lower left'

interface Look {
    color: ColorInput
    shape: ScatterShape
    /** False for a group that the film gave no label. */
    label: boolean
}

/** One change of the group of a point: it leaves a group and joins another over this time. */
interface Change {
    t0: number
    t1: number
    ease: Ease
    from: string | undefined
    assigned?: boolean
    to: string | undefined
}

interface Entry {
    name: string | undefined
    /** The place and the group after the changes that are scheduled so far, in the units of the axes. */
    x: number
    y: number
    group: string | undefined
    /** The group at the start, and each change of it, in the order of time. */
    first: string | undefined
    initialShares?: ReadonlyMap<string, number>
    changes: Change[]
    /** The color that the point has of its own, until `assign` gives it the color of a group. */
    initialColor: ColorInput | undefined
    own: ColorInput | undefined
    radius: number
    query: boolean
    /** The text of the name, half of the width of its ink, and the side that the film asked for. */
    words: string | null
    half: number
    side: Side | undefined
    /** True from the time at which a search can find the point, to the time at which it starts to leave. */
    alive: Track<boolean>
    /** False from the time that a `remove` is scheduled. */
    here: boolean
    lastMove: { call: string; t0: number; t1: number } | null
    lastLook: { call: string; t0: number; t1: number } | null
}

/** One state of the search: the ring grows to the k-th nearest point of `from`, among the points that `among` allows. */
interface Probe {
    t0: number
    t1: number
    ease: Ease
    from: number
    k: number
    among: ((point: ScatterPointView) => boolean) | null
    /** A copy made during a search keeps the share of the ring it showed then. */
    frozen?: number
    color: ColorInput
    /** The state before this one. The ring starts from it. */
    before: Probe | null
}

/** Two changes of one part may meet at one time, to this many seconds. */
const SOON = 1e-6
const SIDES: readonly Side[] = ['right', 'over', 'left', 'under', 'upper right', 'upper left', 'lower right', 'lower left']
const SHAPES: readonly ScatterShape[] = ['dot', 'ring', 'square', 'diamond', 'triangle']

const seconds = (time: number): string => `${Math.round(time * 1000) / 1000} s`
const written = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : typeof value === 'function' ? 'a function' : typeof value === 'object' && value !== null ? (Array.isArray(value) ? `[${value.map(written).join(', ')}]` : 'an object') : String(value))
const present = (entry: Entry, time: number | null): boolean => time === null ? entry.here : entry.alive.sample(time)
const isVec = (value: unknown): value is Vec => Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number' && Number.isFinite(value[0]) && Number.isFinite(value[1])

function readTime(): number | null {
    // Group assignments and searches have their own timelines outside Track.
    if (clock.mode === 'render') changesNow()
    return clock.mode === 'free' ? null : clock.now
}

function axisRange(given: readonly [number, number] | undefined, points: readonly ScatterPoint[], axis: 'x' | 'y'): readonly [number, number] {
    let range = given
    if (range === undefined) {
        if (points.length === 0) return [0, 1]
        let low = Infinity, high = -Infinity
        for (const point of points) {
            low = Math.min(low, point[axis])
            high = Math.max(high, point[axis])
        }
        const pad = (high - low || 1) * 0.06
        range = [low - pad, high + pad]
    }
    if (!isVec(range) || !(range[1] > range[0])) throw new Error(`scatter: the ${axis} axis range must have two finite values, the smaller one first. It got ${written(range)}`)
    const [low, high] = range
    const rough = (high - low) / (axis === 'x' ? 6 : 5)
    if (!Number.isFinite(rough) || !(10 ** Math.floor(Math.log10(rough)) > 0)) {
        throw new Error(`scatter: the ${axis} axis range ${written(range)} cannot represent its ticks. Rescale the values or give the plot a wider range`)
    }
    return [low, high]
}

/** A ring with a hole: the outer circle, and the inner one the other way round. */
function annulus(outer: number, inner: number): Path {
    return [...circlePath(0, 0, outer), ...circlePath(0, 0, inner).map(reverseRing)]
}

/** The outline of a mark around its middle. The marks have about the area of the dot of that radius. */
function markPath(shape: ScatterShape | 'target', radius: number): Path {
    if (shape === 'ring') return annulus(radius, radius * 0.56)
    if (shape === 'square') return rectPath(-radius * 0.88, -radius * 0.88, radius * 1.76, radius * 1.76, radius * 0.18)
    if (shape === 'diamond') return polyPath([[0, -radius * 1.28], [radius * 1.28, 0], [0, radius * 1.28], [-radius * 1.28, 0]], true)
    if (shape === 'triangle') return polyPath([-90, 30, 150].map((angle) => [Math.cos(angle * Math.PI / 180) * radius * 1.4, Math.sin(angle * Math.PI / 180) * radius * 1.4 + radius * 0.2] as Vec), true)
    if (shape === 'target') return [...circlePath(0, 0, radius * 0.46), ...annulus(radius, radius * 0.76)]
    return circlePath(0, 0, radius)
}

/** True when a place is inside a polygon. */
function inside(polygon: readonly Vec[], x: number, y: number): boolean {
    let within = false
    for (let index = 0, before = polygon.length - 1; index < polygon.length; before = index++) {
        const a = polygon[index]!, b = polygon[before]!
        if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) within = !within
    }
    return within
}

/** How much a node shows at a time, from 0 to 1: its opacity, or 0 when it is hidden. */
function shownAt(node: Node, time: number): number {
    const visible = node.tracks?.get('visible')
    return (visible ? visible.sample(time) as boolean : node.base.visible) ? propAt(node, 'opacity', time) : 0
}

/** The part of a convex polygon on the center's side of a bisector. Work relative to the center to retain precision on offset axes. */
function clip(polygon: readonly Vec[], center: Vec, a: number, b: number, c: number): Vec[] {
    const out: Vec[] = []
    for (let index = 0; index < polygon.length; index++) {
        const p = polygon[index]!, q = polygon[(index + 1) % polygon.length]!
        const dp = a * (p[0] - center[0]) + b * (p[1] - center[1]) - c, dq = a * (q[0] - center[0]) + b * (q[1] - center[1]) - c
        if (dp <= 0) out.push(p)
        if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
            const t = dp / (dp - dq)
            out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
        }
    }
    return out
}

/**
 * The outline of an ellipse, and only the part of it that is inside a rectangle: the ring of a search stays
 * in the plot, so it does not pass the numbers of the axes. An ellipse that is all inside is drawn whole.
 */
function ringInside(cx: number, cy: number, rx: number, ry: number, halfWidth: number, halfHeight: number): Path {
    if (cx - rx >= -halfWidth && cx + rx <= halfWidth && cy - ry >= -halfHeight && cy + ry <= halfHeight) return arcPath(cx, cy, rx, ry, 0, Math.PI * 2)
    const within = (point: Vec) => point[0] >= -halfWidth && point[0] <= halfWidth && point[1] >= -halfHeight && point[1] <= halfHeight
    // Short lines of about 6 px: at this size, a viewer sees a curve.
    const count = Math.min(720, Math.max(64, Math.ceil((Math.PI * (rx + ry)) / 6)))
    const out: Vec[][] = []
    let run: Vec[] = []
    for (let step = 0; step <= count; step++) {
        const angle = (step / count) * Math.PI * 2
        const point: Vec = [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]
        if (within(point)) {
            run.push(point)
        } else if (run.length > 0) {
            if (run.length > 1) out.push(run)
            run = []
        }
    }
    if (run.length > 1) out.push(run)
    return out.flatMap((points) => polyPath(points))
}

/** The convex hull of points, counter-clockwise in the coordinates of the screen. Points on an edge are left out. */
function convexHull(points: readonly Vec[]): Vec[] {
    const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]).filter((point, index, list) => index === 0 || point[0] !== list[index - 1]![0] || point[1] !== list[index - 1]![1])
    if (sorted.length < 3) return sorted
    const cross = (o: Vec, a: Vec, b: Vec) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    const half = (list: readonly Vec[]) => {
        const out: Vec[] = []
        for (const point of list) {
            while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, point) <= 1e-9) out.pop()
            out.push(point)
        }
        out.pop()
        return out
    }
    return [...half(sorted), ...half([...sorted].reverse())]
}

/** The outline at a distance around a convex hull, with round corners: an arc around each corner, from the end of one edge to the start of the next. */
function around(hull: readonly Vec[], distance: number): Vec[] {
    const out: Vec[] = []
    const count = hull.length
    if (count === 0) return out
    for (let index = 0; index < count; index++) {
        const before = hull[(index + count - 1) % count]!, at = hull[index]!, after = hull[(index + 1) % count]!
        // The way out of the hull at the edge that ends here, and at the edge that starts here.
        const out0 = count === 1 ? 0 : Math.atan2(at[1] - before[1], at[0] - before[0]) - Math.PI / 2
        let turn = count === 1 ? Math.PI * 2 : Math.atan2(after[1] - at[1], after[0] - at[0]) - Math.PI / 2 - out0
        while (turn < 0) turn += Math.PI * 2
        while (count > 1 && turn > Math.PI * 2 - 1e-9) turn -= Math.PI * 2
        const steps = Math.max(2, Math.ceil(turn / (Math.PI / 14)))
        for (let step = 0; step <= steps; step++) {
            const angle = out0 + (turn * step) / steps
            out.push([at[0] + Math.cos(angle) * distance, at[1] + Math.sin(angle) * distance])
        }
    }
    return out
}

/**
 * A part of the plane of a scatter that can shade: the hull of a group, a cell of a partition, or a span of
 * the axes. It follows the points that make it: a hull follows the members of its group, and a cell follows
 * its center. `shade()` turns its shade on or off, and `points` lists the points that it holds.
 */
export class ScatterArea extends Node {
    /** How far the shade is on, from 0 to 1, at each time. */
    lit: Value
    /** True after the changes that are scheduled so far when the shade is on. */
    private setting: Track<boolean>
    private last: { t0: number; t1: number } | null = null

    constructor(
        /** The chart that the area is a part of. */
        public chart: Scatter,
        /** What the area is, for a message. */
        readonly kind: 'hull' | 'cell' | 'span',
        private readonly outline: (chart: Scatter, time: number) => Vec[] | null,
        /** The indexes of the points whose place is in the area. `data` leaves out a query, and the centers of a partition. */
        private readonly members: (chart: Scatter, data: boolean) => number[],
        private readonly paint: (chart: Scatter) => ColorInput,
        shaded: boolean,
    ) {
        super()
        this.setting = new Track(shaded)
        this.lit = new Value(shaded ? 1 : 0)
        // Not an arrow function: `this` is the node that draws, which is the copy in a copy of the chart.
        this.draw = function (this: ScatterArea, time: number) {
            return this.render(time)
        }
    }

    /** True when the shade is on, after the changes that are scheduled so far. */
    get shaded(): boolean {
        return this.setting.sample(readTime() ?? Infinity)
    }

    /**
     * The indexes of the points of the data that the area holds, after the changes that are scheduled so far:
     * the points that a search in this area scores. A query is not one of them, and neither are the centers
     * of the partition of a cell.
     */
    get points(): number[] {
        return this.members(this.chart, true)
    }

    /** True when the place of a point is in the area, by its index or its name, after the changes that are scheduled so far. It is true for a query too: `cells.find((cell) => cell.holds('q'))` is the cell of the query. */
    holds(which: number | string): boolean {
        return this.members(this.chart, false).includes(this.chart.indexOf(which, 'holds'))
    }

    /** The shade comes on, or with `shade(false)` it goes off: the fill and the weight of the outline say that the area is the one that the film is in. */
    shade(on?: boolean | AnimOptions, given: AnimOptions = {}): Anim {
        // `shade({ duration: 2 })` shades too.
        const options = typeof on === 'object' && on !== null ? on : given
        if (typeof on === 'object' && on !== null) on = true
        on ??= true
        if (typeof on !== 'boolean') throw new Error(`scatter: shade takes true or false, and then the options. It got ${written(on)}`)
        const lit = on
        return {
            label: 'scatter.shade', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                if (this.last && ctx.t0 < this.last.t1 - SOON) throw new Error(`scatter: shade plays from ${seconds(ctx.t0)} to ${seconds(ctx.t1)}, and the shade of this ${this.kind} changes from ${seconds(this.last.t0)} to ${seconds(this.last.t1)}. An area takes one change of its shade at a time: play the two one after the other`)
                this.last = { t0: ctx.t0, t1: ctx.t1 }
                reveal(this, ctx.t0, ctx.stage)
                tweenValue(this.lit, lit ? 1 : 0, ctx.t0, ctx.t1, ctx.ease)
                this.setting.step(ctx.t0, lit)
            },
        }
    }

    /** The outline of the area at a time, in the coordinates of the chart. Null when the area has no room. */
    ringAt(time: number): Vec[] | null {
        const ring = this.outline(this.chart, time)
        return ring && ring.length >= 3 ? ring : null
    }

    /** The color of the area, and the opacity of its fill at a time. */
    fillAt(time: number): { color: ColorInput; opacity: number } {
        const lit = Math.min(1, Math.max(0, this.lit.track.sample(time)))
        // A hull has a faint fill at all times: it is the body of its group. A cell and a span are lines until they shade.
        const base = this.kind === 'hull' ? 0.07 : 0
        return { color: this.paint(this.chart), opacity: base + (0.22 - base) * lit }
    }

    protected override [rebindCloneParts](copy: this, _parts: ReadonlyMap<Node, Node>): void {
        const now = clock.now
        copy.setting = new Track(this.setting.sample(now))
        copy.lit = new Value(this.lit.track.sample(now))
        copy.last = null
    }

    private render(time: number): Node[] | null {
        const ring = this.ringAt(time)
        if (!ring) return null
        const lit = Math.min(1, Math.max(0, this.lit.track.sample(time)))
        const { color, opacity } = this.fillAt(time), path = polyPath(ring, true)
        const out: Node[] = []
        if (opacity > 0.004) out.push(new Node(path).fill(color, opacity))
        out.push(new Node(path).stroke(color, 2 + lit, 0.45 + 0.55 * lit))
        return out
    }
}

/**
 * Points on two axes, in groups. A point can have a name, a group can have a mark of its own, and the points
 * change: they move, arrive, leave, and take another group. `nearest` grows a ring from a point to its k-th
 * nearest point and draws a line to each point that the ring holds. `hull`, `cells` and `span` are areas of
 * the plane that can shade.
 */
export class Scatter extends Node {
    readonly dots: Node[] = []
    readonly axis: Node
    readonly groupLabels: Node[] = []
    /** The text of the name of each point, or null for a point with none. In the order of `dots`. */
    readonly nameLabels: (Node | null)[] = []
    /** Each area that `hull`, `cells` and `span` made. */
    readonly areas: ScatterArea[] = []
    private readonly frame: XYFrame
    private readonly labelSize: number
    private readonly nameSize: number
    private readonly baseRadius: number
    private readonly font: TextOptions['font']
    private readonly withGroupLabels: boolean
    /** The look of each group, in the order in which the chart came to know it, and the names in that order. */
    private readonly looks = new Map<string, Look>()
    private readonly groupNames: string[] = []
    private readonly groupHalves: number[] = []
    private labelEnd = 0
    private entries: Entry[] = []
    private probes: Probe[] = []
    private lastProbe: { call: string; t0: number; t1: number } | null = null
    /** The layer of the areas and the layer of the search, under the points. Made when the film first asks for one. */
    private areaLayer: Node | null = null
    private probeLayer: Node | null = null
    /**
     * A patch behind each name and each label of a group, in the color that a viewer sees behind it. It is
     * over the areas and the search, and under the points: a line of an area or of the search passes behind
     * a text, not through it.
     */
    private patchLayer: Node | null = null

    constructor(points: readonly ScatterPoint[], options: ScatterOptions = {}) {
        super()
        if (!Array.isArray(points)) throw new Error('scatter: the points are a list, such as [{ x: 1, y: 2 }]')
        const specs = points.map((point, index) => this.checked(point, `point ${index}`))
        const xRange = axisRange(options.x, specs, 'x'), yRange = axisRange(options.y, specs, 'y')
        this.frame = { xRange, yRange, w: options.width ?? 900, h: options.height ?? 520 }
        const labelSize = this.labelSize = options.labelSize ?? 18
        for (const [key, value] of [['width', this.frame.w], ['height', this.frame.h]] as const) {
            if (!(Number.isFinite(value) && value > 0)) throw new Error(`scatter: ${key} must be a finite number greater than 0`)
        }
        for (const [key, value] of [['labelSize', labelSize], ['radius', options.radius ?? 6]] as const) {
            if (!(Number.isFinite(value) && value >= 0)) throw new Error(`scatter: ${key} must be a finite number, 0 or more`)
        }
        this.nameSize = options.nameSize ?? 26
        if (!(Number.isFinite(this.nameSize) && this.nameSize > 0)) throw new Error('scatter: nameSize is the text size of the names of the points, more than 0')
        this.baseRadius = options.radius ?? 6
        this.font = options.font
        this.withGroupLabels = options.groupLabels ?? true
        this.axis = xyAxes(this.frame, { labelSize, color: options.color, font: options.font, xLabel: options.xLabel, yLabel: options.yLabel, hideXTicks: specs.length === 0 && !options.x, hideYTicks: specs.length === 0 && !options.y })
        for (const [name, look] of Object.entries(options.groups ?? {})) {
            const given: ScatterGroup = typeof look === 'object' && look !== null && !Array.isArray(look) && !('type' in look) ? look as ScatterGroup : { color: look as ColorInput }
            if (given.shape !== undefined && !SHAPES.includes(given.shape)) throw new Error(`scatter: the group ${JSON.stringify(name)} has the shape ${written(given.shape)}. A shape is ${SHAPES.map((shape) => `'${shape}'`).join(', ')}`)
            const color = given.color ?? DEFAULT_SERIES[this.looks.size % DEFAULT_SERIES.length]!
            this.paintOf(color, `the color of the group ${JSON.stringify(name)}`)
            this.looks.set(name, { color, shape: given.shape ?? 'dot', label: given.label !== false })
        }
        const sums = new Map<string, { sumX: number; top: number; count: number }>()
        const dots = specs.map((point, index) => {
            if (point.name !== undefined || point.words !== null || point.query) this.inPlot([point.x, point.y], `the place of point ${index}${point.name === undefined ? '' : ` (${written(point.name)})`}`)
            if (point.name !== undefined && this.entries.some((entry) => entry.name === point.name)) throw new Error(this.taken(point.name, 'the points'))
            let color = point.color
            if (point.group !== undefined) {
                let look = this.looks.get(point.group)
                if (!look) {
                    look = { color: color ?? DEFAULT_SERIES[this.looks.size % DEFAULT_SERIES.length]!, shape: 'dot', label: true }
                    this.looks.set(point.group, look)
                }
                color ??= look.color
                const sum = sums.get(point.group) ?? { sumX: 0, top: -Infinity, count: 0 }
                sum.sumX += point.x
                sum.top = Math.max(sum.top, point.y)
                sum.count++
                sums.set(point.group, sum)
            }
            this.entries.push(this.entryOf(point, true))
            return this.mark(point, color)
        })
        this.dots.push(...dots)
        this.add(this.axis, ...dots)
        if (this.withGroupLabels) {
            for (const [name, look] of this.looks) {
                if (!look.label) continue
                const label = small(name, labelSize + 2, look.color, options.font)
                const sum = sums.get(name)
                if (sum) {
                    // Above the cluster, so the label never sits on top of its own points.
                    const [px, py] = xyPoint(this.frame, sum.sumX / sum.count, sum.top)
                    label.at(px, py - labelSize * 1.2)
                } else {
                    // A group with no point yet has no place. Its label comes when `assign` gives it a point.
                    label.hide()
                }
                this.groupHalves.push(label.bounds().width / 2)
                this.groupNames.push(name)
                this.groupLabels.push(label)
                this.add(label)
            }
        }
        this.entries.forEach((entry, index) => {
            const label = this.nameOf(entry)
            this.nameLabels.push(label)
            if (!label) return
            label.at(this.namePlace(index))
            this.add(label)
        })
        ownLabels(this, { name: 'scatter chart', plot: true })
    }

    // ── Places ────────────────────────────────────────────────────────────

    p(x: number, y: number): [number, number] {
        return xyPoint(this.frame, x, y)
    }

    /** The node of the mark of a point, by its index or its name. A light or a connector takes it, and it follows the point. */
    point(which: number | string): Node {
        return this.dots[this.indexOf(which, 'point')]!
    }

    /** The name of a point belongs to its mark, so a light on the mark keeps the name bright. */
    override labelsOf(part: Node): readonly Node[] {
        const label = this.nameLabels[this.dots.indexOf(part)]
        return label ? [label] : []
    }

    /**
     * The box of a part of the plot, in stage pixels, for `place` and `beside` of the layout. `x` and `y` are
     * two values of an axis each. Without them it is the whole plot, with no numbers and no labels of the axes.
     * The box is where the chart is now, so ask for it after the chart has its place.
     */
    region(part: { x?: readonly [number, number]; y?: readonly [number, number] } = {}): Box {
        const names = ['x', 'y']
        if (typeof part !== 'object' || part === null) throw new Error(`scatter: region takes an object such as { x: [0, 5] }, and it got ${part === null ? 'null' : typeof part}`)
        const unknown = Object.keys(part).find((name) => !names.includes(name))
        if (unknown !== undefined) throw new Error(`scatter: region has no part "${unknown}". Its parts are: ${names.join(', ')}`)
        const [x0, x1] = this.rangeOf(part.x, this.frame.xRange, 'region: x'), [y0, y1] = this.rangeOf(part.y, this.frame.yRange, 'region: y')
        const [left, top] = this.p(x0, y1), [right, bottom] = this.p(x1, y0)
        return worldBox(this, left, top, right, bottom)
    }

    // ── State ─────────────────────────────────────────────────────────────

    /** The place of a point in the units of the axes, by its index or its name, after the changes that are scheduled so far. */
    positionOf(which: number | string): [number, number] {
        const index = this.indexOf(which, 'positionOf'), time = readTime()
        return time === null ? [this.entries[index]!.x, this.entries[index]!.y] : this.placeAt(index, time)
    }

    /** The group of a point, by its index or its name, after the changes that are scheduled so far. */
    groupOf(which: number | string): string | undefined {
        const entry = this.entries[this.indexOf(which, 'groupOf')]!, time = readTime()
        return time === null ? entry.group : this.groupAt(entry, time)
    }

    /** How many points a group has, after the changes that are scheduled so far. */
    count(group: string): number {
        this.lookOf(group, 'count')
        const time = readTime()
        return this.entries.filter((entry) => present(entry, time) && (time === null ? entry.group : this.groupAt(entry, time)) === group).length
    }

    /** The indexes of the points that a function picks. It gets each point with its place and its group, after the changes that are scheduled so far. */
    find(test: (point: ScatterPointView) => boolean): number[] {
        if (typeof test !== 'function') throw new Error('scatter: find takes a function of a point, such as (point) => point.group === \'fruit\'')
        return this.pick(test, 'find')
    }

    /**
     * The points that are nearest to a point or to a place, from the nearest one: `chart.nearestTo('q', 3)`.
     * The distance is in the units of the axes. A query point is not found, and `among` keeps the search to
     * some points. It reads the places after the changes that are scheduled so far, and it draws nothing.
     */
    nearestTo(from: number | string | Vec, k?: number, options: { among?: ScatterWhich } = {}): ScatterNeighbor[] {
        const at: Vec = isVec(from) ? from : this.positionOf(from as number | string)
        const self = isVec(from) ? -1 : this.indexOf(from as number | string, 'nearestTo')
        const found = this.ranked(at, self, this.filter(options.among, 'nearestTo: among'), readTime())
        if (k !== undefined && !(Number.isInteger(k) && k >= 0)) throw new Error(`scatter: nearestTo: k is ${written(k)}. Give a whole number, 0 or more`)
        return (k === undefined ? found : found.slice(0, k)).map(({ index, distance }) => ({ index, name: this.entries[index]!.name, distance }))
    }

    /** The indexes of the points that the search of `nearest` holds, from the nearest one, after the changes that are scheduled so far. Empty with no search. */
    get neighbors(): number[] {
        const time = readTime()
        const probe = this.probeAt(time ?? Infinity)
        if (!probe || probe.k === 0) return []
        return this.ranked(this.centerAt(probe.from, time), probe.from, probe.among, time).slice(0, probe.k).map((one) => one.index)
    }

    // ── Verbs ─────────────────────────────────────────────────────────────

    /** Axes draw, then points land from left to right. */
    enter(options: AnimOptions = {}): Anim {
        const lag = options.lag ?? Math.min(0.2, 8 / Math.max(1, this.dots.length))
        return {
            label: 'scatter.enter', duration: options.duration ?? 2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                stepAt(this.axis, 'opacity', 0, ctx.t0)
                this.axis.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.3, ctx.ease)
                const order = this.dots.map((point, index) => ({ point, index })).sort((a, b) => a.point.get('x') - b.point.get('x'))
                const windows = staggered(order.length, lag, ctx.t0 + span * 0.15, ctx.t1)
                order.forEach(({ point, index }, i) => {
                    const [start, end] = windows[i]!
                    const sx = point.get('sx')
                    stepAt(point, 'sx', 0.001, ctx.t0)
                    stepAt(point, 'sy', 0.001, ctx.t0)
                    point.tween('sx', sx, start, end, ctx.ease)
                    point.tween('sy', sx, start, end, ctx.ease)
                    // The name of a point comes with its mark.
                    const name = this.nameLabels[index]
                    if (name) {
                        stepAt(name, 'opacity', 0, ctx.t0)
                        name.tween('opacity', 1, start, end, ctx.ease)
                    }
                })
                for (const label of this.groupLabels) {
                    stepAt(label, 'opacity', 0, ctx.t0)
                    label.tween('opacity', 1, ctx.t0 + span * 0.7, ctx.t1, ctx.ease)
                }
            },
        }
    }

    /** A straight or curved fit through the data, drawn on the same axes. */
    fit(f: (x: number) => number, options: { color?: ColorInput; width?: number; samples?: number } = {}): Node {
        const [x0, x1] = this.frame.xRange
        const samples = options.samples ?? 60
        const points: Vec[] = []
        for (let i = 0; i <= samples; i++) {
            const x = x0 + (x1 - x0) * i / samples
            points.push(this.p(x, f(x)))
        }
        const node = new Node(smoothPath(points)).stroke(options.color ?? 'yellow', options.width ?? 3.5)
        this.add(node)
        return node
    }

    /**
     * Points go to new places: `move('q', [4, 5])` for one point, by its name or its index, or
     * `move({ q: [4, 5], c1: [2, 3] })` for several at one time. Each mark slides with its name. A search from
     * a point that moves follows it, and so does a hull or a cell that the point makes.
     */
    move(which: number | string, to: Vec, options?: AnimOptions): Anim
    move(places: Readonly<Record<string, Vec>>, options?: AnimOptions): Anim
    move(first: number | string | Readonly<Record<string, Vec>>, second?: Vec | AnimOptions, third?: AnimOptions): Anim {
        const one = typeof first === 'number' || typeof first === 'string'
        if (!one && (typeof first !== 'object' || first === null || Array.isArray(first))) throw new Error(`scatter: move takes a point and its new place, or an object of names and places such as { q: [4, 5] }. It got ${written(first)}`)
        const changes: [number | string, Vec][] = one ? [[first, second as Vec]] : Object.entries(first)
        const options = ((one ? third : second) ?? {}) as AnimOptions
        if (changes.length === 0) throw new Error('scatter: move got no point. Give names and places, such as { q: [4, 5] }')
        // Find a wrong point or place now, where the film names it. The places change when the animation is
        // scheduled, so that a second move in the same sequence starts from the first.
        for (const [which, to] of changes) {
            this.indexOf(which, 'move')
            this.inPlot(to, `move: the new place of the point ${written(which)}`)
        }
        return {
            label: 'scatter.move', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const moved: number[] = []
                for (const [which, to] of changes) {
                    const index = this.indexOf(which, 'move'), entry = this.entries[index]!, mark = this.dots[index]!
                    this.claim(entry, 'lastMove', `move(${written(which)})`, index, ctx)
                    const [x, y] = this.p(to[0], to[1])
                    mark.tween('x', x, ctx.t0, ctx.t1, ctx.ease)
                    mark.tween('y', y, ctx.t0, ctx.t1, ctx.ease)
                    entry.x = to[0]
                    entry.y = to[1]
                    moved.push(index)
                }
                // Each name goes with its point, to the place that is free at the end of the move.
                for (const index of moved) {
                    const label = this.nameLabels[index]
                    if (!label) continue
                    const [x, y] = this.namePlace(index, true, ctx.t1)
                    label.tween('x', x, ctx.t0, ctx.t1, ctx.ease)
                    label.tween('y', y, ctx.t0, ctx.t1, ctx.ease)
                }
                this.settleGroupLabels(ctx)
            },
        }
    }

    /**
     * A point arrives: its mark grows at its place, and its name comes with it. With `from`, the mark travels
     * from a place of the stage to its place, such as from a card of a list: give a point or a node. A search
     * can find the point when it has landed. The point is the last one of `dots`.
     */
    insert(point: ScatterPoint, options: AnimOptions & { from?: Vec | Node } = {}): Anim {
        const spec = this.checked(point, 'insert: the point')
        this.inPlot([spec.x, spec.y], 'insert: the place of the point')
        if (spec.name !== undefined && this.entries.some((entry) => entry.here && entry.name === spec.name)) throw new Error(this.taken(spec.name, 'insert'))
        if (spec.group !== undefined) this.lookOf(spec.group, 'insert')
        const from = options.from
        if (from !== undefined && !(from instanceof Node) && !isVec(from)) throw new Error(`scatter: insert: \`from\` is ${written(from)}. Give a point [x, y] of the stage, or a node`)
        return {
            label: 'scatter.insert', duration: options.duration ?? 0.7, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx
                if (spec.name !== undefined && this.entries.some((other) => other.here && other.name === spec.name)) throw new Error(this.taken(spec.name, 'insert'))
                // Each play owns its mark and its history, even when the film reuses the animation.
                const entry = this.entryOf(spec, false)
                const mark = this.mark(spec, spec.color ?? (spec.group === undefined ? undefined : this.looks.get(spec.group)!.color))
                const label = this.nameOf(entry)
                if (label) ownLabels(this, { labels: [label] })
                const index = this.entries.length
                // The point joins its group over the time of the insert, so a hull grows to it and does not jump.
                entry.changes.push({ t0, t1, ease, from: undefined, to: spec.group })
                entry.alive.step(t1, true)
                entry.lastMove = entry.lastLook = { call: `insert(${written(spec.name ?? index)})`, t0, t1 }
                this.entries.push(entry)
                this.dots.push(mark)
                this.nameLabels.push(label)
                clock.now = t0
                this.add(mark)
                const [x1, y1] = this.p(spec.x, spec.y)
                stepAt(mark, 'opacity', 0, t0)
                if (from === undefined) {
                    mark.tween('opacity', 1, t0, t1, ease)
                    for (const prop of ['sx', 'sy'] as const) {
                        stepAt(mark, prop, 0.3, t0)
                        mark.tween(prop, 1, t0, t1, ease)
                    }
                } else {
                    const [wx, wy] = from instanceof Node ? from.center : from
                    const [x0, y0] = apply(invert(this.worldMatrix()), wx, wy)
                    mark.tween('opacity', 1, t0, t0 + (t1 - t0) * 0.3, ease)
                    stepAt(mark, 'x', x0, t0)
                    stepAt(mark, 'y', y0, t0)
                    mark.tween('x', x1, t0, t1, ease)
                    mark.tween('y', y1, t0, t1, ease)
                }
                if (label) {
                    label.at(this.namePlace(index, false, t1))
                    this.add(label)
                    // The name comes when the mark is at its place, so it does not travel over the picture.
                    stepAt(label, 'opacity', 0, t0)
                    label.tween('opacity', 1, t0 + (t1 - t0) * (from === undefined ? 0.5 : 0.8), t1, ease)
                }
                this.settleGroupLabels(ctx)
            },
        }
    }

    /** Points leave: each mark shrinks and fades with its name. A search does not find a point from the moment that it starts to leave. */
    remove(which: ScatterWhich, options: AnimOptions = {}): Anim {
        if (typeof which !== 'function') this.pick(which, 'remove')
        return {
            label: 'scatter.remove', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx
                for (const index of this.pick(which, 'remove')) {
                    const entry = this.entries[index]!, mark = this.dots[index]!, label = this.nameLabels[index]
                    const probe = this.probes[this.probes.length - 1]
                    if (probe && probe.k > 0 && probe.from === index) throw new Error(`scatter: remove: the search of nearest() starts at the point ${written(entry.name ?? index)}. End the search first, with nearest(${written(entry.name ?? index)}, 0)`)
                    this.claim(entry, 'lastMove', `remove(${written(entry.name ?? index)})`, index, ctx)
                    this.claim(entry, 'lastLook', `remove(${written(entry.name ?? index)})`, index, ctx)
                    entry.here = false
                    entry.alive.step(t0, false)
                    entry.changes.push({ t0, t1, ease, from: entry.group, to: undefined })
                    entry.group = undefined
                    for (const node of [mark, label]) {
                        if (!node) continue
                        node.tween('opacity', 0, t0, t1, ease)
                        node.track('visible').step(t1, false)
                    }
                    mark.tween('sx', 0.3, t0, t1, ease)
                    mark.tween('sy', 0.3, t0, t1, ease)
                }
                this.settleGroupLabels(ctx)
            },
        }
    }

    /**
     * Points take another group: `assign('B', 'fruit')`, or a list, or a function of a point. Each mark takes
     * the color and the shape of the group, the label of the group goes to its new members, and a hull of
     * the group grows to them. The group is one that a point has, or one of the option `groups`.
     */
    assign(which: ScatterWhich, group: string, options: AnimOptions = {}): Anim {
        this.lookOf(group, 'assign')
        if (typeof which !== 'function') this.pick(which, 'assign')
        return {
            label: 'scatter.assign', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const look = this.lookOf(group, 'assign')
                for (const index of this.pick(which, 'assign')) {
                    const entry = this.entries[index]!, mark = this.dots[index]!
                    if (entry.group === group && entry.own === undefined) continue
                    this.claim(entry, 'lastLook', `assign(${written(entry.name ?? index)}, ${JSON.stringify(group)})`, index, ctx)
                    const before = entry.query ? 'target' : entry.group === undefined ? 'dot' : this.looks.get(entry.group)!.shape
                    entry.changes.push({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, from: entry.group, to: group, assigned: true })
                    entry.group = group
                    entry.own = undefined
                    mark.tween('fill', toPaint(look.color), ctx.t0, ctx.t1, ctx.ease)
                    if (!entry.query && before !== look.shape) mark.tween('path', markPath(look.shape, entry.radius), ctx.t0, ctx.t1, ctx.ease)
                }
                this.settleGroupLabels(ctx)
            },
        }
    }

    /**
     * A search from a point: `nearest('q', 3)`. A ring grows from the point to its third nearest point, and each
     * point that the ring reaches gets a line from the point and a ring around its mark. The search stays, and
     * it is true at each frame: when the point or its neighbors move, the lines go to the points that are the
     * nearest then. A second call with another `k` grows or shrinks the ring, and `nearest('q', 0)` ends the
     * search. `among` keeps the search to some points, such as the points of a cell. The distance is in the
     * units of the axes, so the ring is a circle when both axes have the same pixels for one unit.
     */
    nearest(from: number | string, k: number, options: AnimOptions & { among?: ScatterWhich; color?: ColorInput } = {}): Anim {
        this.indexOf(from, 'nearest')
        if (!(Number.isInteger(k) && k >= 0)) throw new Error(`scatter: nearest: k is ${written(k)}. Give a whole number of points, or 0 to end the search`)
        if (options.among !== undefined && typeof options.among !== 'function') this.pick(options.among, 'nearest: among')
        const color = options.color ?? 'yellow'
        this.paintOf(color, 'nearest: the color')
        return {
            label: 'scatter.nearest', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const index = this.indexOf(from, 'nearest')
                const call = `nearest(${written(from)}, ${k})`
                const last = this.lastProbe
                if (last && ctx.t0 < last.t1 - SOON) throw new Error(`scatter: ${call} plays from ${seconds(ctx.t0)} to ${seconds(ctx.t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. A chart has one search, and it takes one change at a time: play the two one after the other`)
                const before = this.probes[this.probes.length - 1] ?? null
                // A search that ends keeps its filter while its ring closes.
                const among = this.filter(options.among, 'nearest: among') ?? (k === 0 && before?.from === index ? before.among : null)
                const found = this.ranked(this.placeAt(index, ctx.t0), index, among, ctx.t0).length
                if (k > found) throw new Error(`scatter: ${call}: the search has ${found} point${found === 1 ? '' : 's'} to find${among ? ' among the points of `among`' : ''}. Give a k of ${found} or less`)
                this.lastProbe = { call, t0: ctx.t0, t1: ctx.t1 }
                if (!this.probeLayer) {
                    this.probeLayer = new Part<Scatter>(this, (owner, time) => owner.drawProbe(time)).zIndex(-1)
                    clock.now = ctx.t0
                    this.add(this.probeLayer)
                    this.patched()
                }
                this.probes.push({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, from: index, k, among, color, before })
            },
        }
    }

    // ── Areas ─────────────────────────────────────────────────────────────

    /**
     * The hull of a group: an outline around its points, with a faint fill. It follows the group at each
     * frame: it grows to a point that `assign` gives the group, and it leaves a point that goes to another one.
     * The hull is on the chart from now on: fade it in with `fadeIn`.
     */
    hull(group: string, options: ScatterAreaOptions = {}): ScatterArea {
        const look = this.lookOf(group, 'hull')
        if (options.color !== undefined) this.paintOf(options.color, 'hull: the color')
        const color = options.color ?? look.color
        return this.area(new ScatterArea(this, 'hull', (chart, time) => chart.hullAt(group, time), (chart, data) => {
            const ring = chart.hullAt(group, readTime() ?? Infinity)
            return ring ? chart.find((point) => !(data && point.query) && inside(ring, ...chart.p(point.x, point.y))) : []
        }, () => color, options.shaded ?? true))
    }

    /**
     * The cells of a partition of the plot: one cell for each center, which holds the places that are nearer
     * to that center than to the others. A center is a point of the chart, by its name or its index, or a
     * place [x, y]. A cell follows a center that moves. The cells are lines until `cell.shade()` shades one.
     * They are in dim, so the colors of the points read on a shaded cell: `color` gives another color.
     */
    cells(centers: readonly (number | string | Vec)[], options: ScatterAreaOptions = {}): ScatterArea[] {
        if (!Array.isArray(centers) || centers.length < 2) throw new Error('scatter: cells takes a list of two centers or more: points of the chart, or places [x, y]')
        const list: (number | Vec)[] = centers.map((center, index) => {
            if (isVec(center)) return center
            if (typeof center !== 'number' && typeof center !== 'string') throw new Error(`scatter: cells: center ${index} is ${written(center)}. A center is a point of the chart, by its name or its index, or a place [x, y]`)
            return this.indexOf(center, 'cells')
        })
        if (options.color !== undefined) this.paintOf(options.color, 'cells: the color')
        const fixed = options.color
        return list.map((_, at) => this.area(new ScatterArea(this, 'cell',
            (chart, time) => chart.cellAt(list, at, time),
            (chart, data) => chart.find((point) => !(data && (point.query || list.includes(point.index))) && chart.cellOf(list, [point.x, point.y], readTime()) === at),
            () => fixed ?? 'dim',
            options.shaded ?? false)))
    }

    /**
     * A span of the plot: `span({ x: [0, 3.35] })` is the part of the plot at the left of 3.35, and with `y`
     * too it is a rectangle. An end at `Infinity` is the end of the axis. It is lines until `shade()`.
     */
    span(part: { x?: readonly [number, number]; y?: readonly [number, number] }, options: ScatterAreaOptions = {}): ScatterArea {
        if (typeof part !== 'object' || part === null || (part.x === undefined && part.y === undefined)) throw new Error('scatter: span takes a range of x, of y, or of both, such as { x: [0, 3.35] }')
        const [x0, x1] = this.rangeOf(part.x, this.frame.xRange, 'span: x'), [y0, y1] = this.rangeOf(part.y, this.frame.yRange, 'span: y')
        if (options.color !== undefined) this.paintOf(options.color, 'span: the color')
        const color = options.color ?? 'blue'
        const corners: Vec[] = [this.p(x0, y0), this.p(x1, y0), this.p(x1, y1), this.p(x0, y1)]
        return this.area(new ScatterArea(this, 'span', () => corners, (chart, data) => chart.find((point) => !(data && point.query) && point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1), () => color, options.shaded ?? false))
    }

    /** A copy with its own points, at the places and in the groups that the chart shows now. A change of the copy does not change the chart. */
    protected override [rebindCloneParts](copy: this, _parts: ReadonlyMap<Node, Node>): void {
        // The generic clone remaps arrays that contain nodes. Empty arrays and lists of null labels also belong to this copy.
        for (const field of ['dots', 'nameLabels', 'groupLabels', 'areas'] as const) {
            if (copy[field] === this[field]) Object.assign(copy, { [field]: [...copy[field]] })
        }
        const now = clock.now
        copy.entries = this.entries.map((entry, index) => {
            const [x, y] = this.placeAt(index, now), group = this.groupAt(entry, now), here = entry.alive.sample(now)
            const own = entry.changes.some((change) => change.t0 <= now && change.assigned) ? undefined : entry.initialColor
            const initialShares = new Map<string, number>()
            for (const name of this.looks.keys()) {
                const share = this.shareIn(entry, name, now)
                if (share > 0) initialShares.set(name, share)
            }
            return { ...entry, x, y, group, first: group, initialShares, own, initialColor: own, here, changes: [], alive: new Track(here), lastMove: null, lastLook: null }
        })
        const probe = this.probeAt(now)
        copy.probes = probe ? [{ ...probe, frozen: this.progress(probe, now), t0: -Infinity, t1: -Infinity }] : []
        copy.lastProbe = null
        copy.labelEnd = 0
    }

    // ── Bookkeeping ───────────────────────────────────────────────────────

    /** The index of a point that is on the chart, by its name, after the changes that are scheduled so far. An index is checked and given back. */
    indexOf(which: number | string, call = 'indexOf'): number {
        const time = readTime()
        const index = typeof which === 'number' ? (Number.isInteger(which) && which >= 0 && which < this.entries.length && present(this.entries[which]!, time) ? which : -1)
            : typeof which === 'string' ? this.entries.findIndex((entry) => present(entry, time) && entry.name === which) : -1
        if (index < 0) {
            const names = this.entries.filter((entry) => present(entry, time) && entry.name !== undefined).map((entry) => JSON.stringify(entry.name))
            const known = `The chart has ${this.entries.length} point${this.entries.length === 1 ? '' : 's'}, with the indexes 0 to ${this.entries.length - 1}${names.length > 0 ? `, and the names ${names.slice(0, 12).join(', ')}${names.length > 12 ? `, and ${names.length - 12} more` : ''}` : ', and none has a name'}`
            const gone = typeof which === 'number' && this.entries[which] ? '. That point left the chart' : ''
            throw new Error(`scatter: ${call}: no point ${written(which)}${gone}. ${known}`)
        }
        return index
    }

    /** The indexes of the points that a `which` names, in the order of the chart. */
    private pick(which: ScatterWhich, call: string): number[] {
        if (typeof which === 'function') {
            const time = readTime()
            return this.entries.flatMap((entry, index) => present(entry, time) && which(this.viewAt(index, time)) ? [index] : [])
        }
        if (Array.isArray(which)) return [...new Set(which.map((one: number | string) => this.indexOf(one, call)))].sort((a, b) => a - b)
        return [this.indexOf(which as number | string, call)]
    }

    private viewAt(index: number, time: number | null): ScatterPointView {
        const entry = this.entries[index]!
        const [x, y] = this.centerAt(index, time)
        return { index, x, y, name: entry.name, query: entry.query, group: time === null ? entry.group : this.groupAt(entry, time) }
    }

    private filter(which: ScatterWhich | undefined, call: string): Probe['among'] {
        if (which === undefined) return null
        if (typeof which === 'function') return which
        const indexes = new Set(this.pick(which, call))
        return (point) => indexes.has(point.index)
    }

    private lookOf(group: string, call: string): Look {
        const look = typeof group === 'string' ? this.looks.get(group) : undefined
        if (!look) {
            const known = this.looks.size === 0 ? 'The chart has no group' : `The groups are ${[...this.looks.keys()].map((name) => JSON.stringify(name)).join(', ')}`
            throw new Error(`scatter: ${call}: no group ${written(group)}. ${known}. For a group that no point has at the start, name it in the option \`groups\`, such as groups: { ${typeof group === 'string' && /^[A-Za-z_$][\w$]*$/.test(group) ? group : JSON.stringify(group)}: 'teal' }`)
        }
        return look
    }

    private paintOf(color: ColorInput, what: string): Paint {
        try {
            return toPaint(color)
        } catch {
            throw new Error(`scatter: ${what} is ${written(color)}, which is not a color. Use a color of the look, such as 'teal', or a CSS color`)
        }
    }

    private taken(name: string, call: string): string {
        return `scatter: ${call}: the chart has a point ${JSON.stringify(name)} already. A name is the identity of a point: give the point another name, or change the point with move() and assign()`
    }

    /** A range of an axis that a film gives, inside the range of the axis. Without a range, it is the whole axis. */
    private rangeOf(given: readonly [number, number] | undefined, axis: readonly [number, number], what: string): [number, number] {
        if (given === undefined) return [axis[0], axis[1]]
        if (!Array.isArray(given) || given.length !== 2) throw new Error(`scatter: ${what} is ${written(given)}. Give two values of the axis, such as [0, 3.35]`)
        // An end at infinity is the end of the axis: { x: [3.35, Infinity] } is all of the plot at the right of 3.35.
        const from = given[0] === -Infinity ? axis[0] : given[0], to = given[1] === Infinity ? axis[1] : given[1]
        if (!(Number.isFinite(from) && Number.isFinite(to) && to >= from)) throw new Error(`scatter: ${what} goes from ${written(from)} to ${written(to)}. Give two values of the axis, the smaller one first`)
        if (to < axis[0] || from > axis[1]) throw new Error(`scatter: ${what} goes from ${from} to ${to}, outside the axis, which goes from ${axis[0]} to ${axis[1]}`)
        return [Math.max(from, axis[0]), Math.min(to, axis[1])]
    }

    private inPlot(place: unknown, what: string): void {
        if (!isVec(place)) throw new Error(`scatter: ${what} is ${written(place)}. A place is [x, y], in the units of the axes`)
        const { xRange, yRange } = this.frame
        if (place[0] < xRange[0] || place[0] > xRange[1] || place[1] < yRange[0] || place[1] > yRange[1]) throw new Error(`scatter: ${what} is [${place[0]}, ${place[1]}], outside the plot, which goes from ${xRange[0]} to ${xRange[1]} in x and from ${yRange[0]} to ${yRange[1]} in y. Give a place of the plot, or make the chart with the ranges \`x\` and \`y\` that hold it`)
    }

    /** A point of the film, checked. */
    private checked(point: unknown, what: string): ScatterPoint & { words: string | null } {
        if (typeof point !== 'object' || point === null) throw new Error(`scatter: ${what} is ${written(point)}. Give a point such as { x: 1, y: 2 }`)
        const spec = point as ScatterPoint
        const named = spec.name === undefined ? what : `${what} (${written(spec.name)})`
        if (!Number.isFinite(spec.x) || !Number.isFinite(spec.y)) throw new Error(`scatter: the place of ${named} must have finite x and y coordinates. It got ${written([spec.x, spec.y])}`)
        if (spec.radius !== undefined && !(Number.isFinite(spec.radius) && spec.radius >= 0)) throw new Error(`scatter: the radius of ${named} must be a finite number, 0 or more`)
        if (spec.color !== undefined) this.paintOf(spec.color, `the color of ${named}`)
        if (spec.name !== undefined && (typeof spec.name !== 'string' || spec.name.trim() === '')) throw new Error(`scatter: the name of ${what} is ${written(spec.name)}. A name is a text that is not empty`)
        if (spec.label !== undefined && spec.label !== false && typeof spec.label !== 'string') throw new Error(`scatter: the label of ${named} is ${written(spec.label)}. A label is a text, or false for a point with no text`)
        if (spec.side !== undefined && !['right', 'left', 'over', 'under'].includes(spec.side)) throw new Error(`scatter: ${named} has the side ${written(spec.side)}. Use 'right', 'left', 'over' or 'under'`)
        const words = spec.label === false ? null : (spec.label ?? spec.name ?? '').trim()
        if (words !== null && /[\r\n]/.test(words)) throw new Error(`scatter: the label of ${named} has a line break. A label is one line`)
        return { ...spec, words: words === '' ? null : words }
    }

    private entryOf(spec: ScatterPoint & { words: string | null }, counted: boolean): Entry {
        const radius = spec.radius ?? (spec.query ? Math.round(this.baseRadius * 1.6) : this.baseRadius)
        return {
            name: spec.name, x: spec.x, y: spec.y, group: spec.group, first: counted ? spec.group : undefined, changes: [], initialColor: spec.color, own: spec.color, radius, query: spec.query === true,
            words: spec.words, half: 0, side: spec.side, alive: new Track(counted), here: true, lastMove: null, lastLook: null,
        }
    }

    /** The mark of a point: a dot, the shape of its group, or the dot in a ring of a query. */
    private mark(spec: ScatterPoint, color: ColorInput | undefined): Node {
        const shape = spec.query ? 'target' : spec.group === undefined ? 'dot' : this.looks.get(spec.group)?.shape ?? 'dot'
        const radius = spec.radius ?? (spec.query ? Math.round(this.baseRadius * 1.6) : this.baseRadius)
        // A query with no color and no group is in ink: it belongs to no group of the data.
        const paint = color ?? (spec.query ? 'ink' : 'blue')
        const made = (shape === 'dot' ? dot(radius, paint) : new Node(markPath(shape, radius)).fill(paint)).at(xyPoint(this.frame, spec.x, spec.y))
        made.set('fillOpacity', 0.92)
        return made
    }

    private nameOf(entry: Entry): Node | null {
        if (entry.words === null) return null
        const label = text(entry.words, { size: this.nameSize, font: this.font, color: 'ink' })
        entry.half = label.bounds().width / 2
        return label
    }

    /**
     * Take the time of a change of a point. Two changes of the place of a point at one time would each write
     * its place, and the picture would follow neither. So a change that starts before the last one of its
     * kind is over is refused. A move and a change of group are two kinds: they play together.
     */
    private claim(entry: Entry, kind: 'lastMove' | 'lastLook', call: string, index: number, ctx: AnimContext): void {
        const { t0, t1 } = ctx
        if (!(Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0)) throw new Error(`scatter: ${call} plays from ${String(t0)} to ${String(t1)}. Give the play a duration that is a number, 0 or more`)
        const last = entry[kind]
        if (last && t0 < last.t1 - SOON) {
            const advice = t1 <= last.t0 + SOON
                ? `The chart takes the changes of a point in the order of time, and the film calls ${last.call} first. Call ${call} before it`
                : 'Play the two one after the other: in a seq(), or in two calls of s.play'
            throw new Error(`scatter: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. Both change the ${kind === 'lastMove' ? 'place' : 'group'} of the point ${written(entry.name ?? index)}, and a point takes one such change at a time. ${advice}`)
        }
        entry[kind] = { call, t0, t1 }
    }

    // ── Names and labels ──────────────────────────────────────────────────

    /**
     * The place of the middle of the name of a point, for the places that the points have after the changes
     * that are scheduled so far. The name is beside its mark, inside the plot, and it meets no other name. Of
     * the places that are left, it takes the one that covers the fewest marks of other points. A point with a
     * `side` has that place when the point is made. After a move, it has that place when the place is free.
     */
    private namePlace(index: number, moved = false, time = Infinity): [number, number] {
        const entry = this.entries[index]!
        const [x, y] = this.p(entry.x, entry.y)
        const size = this.nameSize, room = size * 0.4, r = entry.radius
        const half = entry.half
        const diagonal = r * 0.7 + room * 0.5
        const centers: Record<Side, [number, number]> = {
            'right': [x + r + room + half, y],
            'left': [x - r - room - half, y],
            'over': [x, y - r - room - size * 0.5],
            'under': [x, y + r + room + size * 0.45],
            'upper right': [x + diagonal + half, y - diagonal - size * 0.3],
            'upper left': [x - diagonal - half, y - diagonal - size * 0.3],
            'lower right': [x + diagonal + half, y + diagonal + size * 0.3],
            'lower left': [x - diagonal - half, y + diagonal + size * 0.3],
        }
        const { w, h } = this.frame
        const others = this.entries.map((other, at) => ({ other, at })).filter(({ other, at }) => at !== index && present(other, time))
        const names = others.flatMap(({ at }) => {
            const node = this.nameLabels[at]
            if (!node || !node.parent) return []
            // The place that the other name goes to, when it is on its way.
            const cx = propAt(node, 'x', time), cy = propAt(node, 'y', time)
            return [{ cx, cy, half: this.entries[at]!.half, high: size * 1.05 }]
        })
        // The label of a group that has members is a text of the chart too.
        this.groupLabels.forEach((_, at) => {
            const place = this.groupLabelAt(this.groupNames[at]!, time)
            if (place) names.push({ cx: place[0], cy: place[1], half: this.groupHalves[at]!, high: (size + this.labelSize + 2) * 0.55 })
        })
        let best: { side: Side; hits: number } | null = null
        for (const side of entry.side ? (moved ? [entry.side, ...SIDES] : [entry.side]) : SIDES) {
            const [cx, cy] = centers[side]
            const x0 = cx - half, x1 = cx + half, y0 = cy - size * 0.5, y1 = cy + size * 0.6
            if (x0 < -w / 2 - 1 || x1 > w / 2 + 1 || y0 < -h / 2 - 1 || y1 > h / 2 + 1) continue
            if (names.some((name) => Math.abs(name.cx - cx) < name.half + half + room && Math.abs(name.cy - cy) < name.high)) continue
            const hits = others.filter(({ other, at }) => {
                const mark = this.dots[at]!, ox = propAt(mark, 'x', time), oy = propAt(mark, 'y', time)
                return ox > x0 - other.radius - 2 && ox < x1 + other.radius + 2 && oy > y0 - other.radius - 2 && oy < y1 + other.radius + 2
            }).length
            if (!best || hits < best.hits) best = { side, hits }
            // The side of the film, when it is free, and the first side that covers no mark.
            if (hits === 0 || side === entry.side) break
        }
        if (!best) {
            const name = written(entry.name ?? index)
            throw new Error(entry.side && !moved
                ? `scatter: the name of the point ${name} has no room at the side '${entry.side}': there it leaves the plot or meets another name. Give the point another \`side\`, or none`
                : `scatter: the name of the point ${name} has no place beside its mark: at each side it leaves the plot or meets another name. What works: \`label: false\` for a point that needs no name, a smaller \`nameSize\`, or a larger plot`)
        }
        return centers[best.side]
    }

    /**
     * Where the label of a group goes for the members that it has after the changes that are scheduled so far:
     * over the highest one, at their mean x. Over the name of a point too, when a name is there. Null for a
     * group with no member.
     */
    private groupLabelAt(group: string, time = Infinity): [number, number] | null {
        let weight = 0, sumX = 0, highest = Infinity, highestFull = Infinity
        const members: { y: number; share: number }[] = []
        this.entries.forEach((entry, index) => {
            const share = this.shareIn(entry, group, time)
            if (share <= 0) return
            const mark = this.dots[index]!
            const y = propAt(mark, 'y', time)
            members.push({ y, share })
            weight += share
            sumX += propAt(mark, 'x', time) * share
            highest = Math.min(highest, y)
            if (share === 1) highestFull = Math.min(highestFull, y)
        })
        if (weight === 0) return null
        if (Number.isFinite(highestFull)) highest = Math.min(...members.map(({ y, share }) => highestFull + (y - highestFull) * share))
        const x = sumX / weight
        let y = highest - this.labelSize * 1.2
        const half = this.groupHalves[this.groupNames.indexOf(group)]!, apart = (this.nameSize + this.labelSize + 2) * 0.55
        const names = this.nameLabels.flatMap((node, index) => node?.parent && shownAt(node, time) > 0
            ? [{ x: propAt(node, 'x', time), y: propAt(node, 'y', time), half: this.entries[index]!.half }]
            : [])
        for (let pass = 0; pass < names.length; pass++) {
            const hit = names.find((name) => Math.abs(name.x - x) < name.half + half + this.nameSize * 0.3 && Math.abs(name.y - y) < apart)
            if (!hit) break
            y = hit.y - apart - 1
        }
        return [x, y]
    }

    /** Several verbs may move members of one group at different speeds. Read their tracks at the time of the frame. */
    private settleGroupLabels({ t0, t1 }: AnimContext): void {
        this.labelEnd = Math.max(this.labelEnd, t1)
        const chart = this
        function follow<T>(track: Track<T>, sample: (time: number) => T): void {
            track.add({
                t0, get t1() { return chart.labelEnd }, ease: null,
                at: (share) => sample(t0 + (chart.labelEnd - t0) * share),
                get to() { return sample(chart.labelEnd) },
            })
        }
        this.groupLabels.forEach((label, index) => {
            const group = this.groupNames[index]!
            for (const [prop, axis] of [['x', 0], ['y', 1]] as const) {
                const fallback = propAt(label, prop, t0)
                follow(label.track(prop), (time) => this.groupLabelAt(group, time)?.[axis] ?? fallback)
            }
            // A move leaves a label's authored fade alone. Membership changes control its arrival and departure.
            if (!this.entries.some((entry) => entry.changes.some((c) => c.t0 === t0 && (c.from === group || c.to === group)))) return
            const opacity = (time: number) => this.entries.reduce((max, entry) => Math.max(max, this.shareIn(entry, group, time)), 0)
            follow(label.track('opacity'), opacity)
            follow(label.track('visible'), (time) => opacity(time) > 0)
        })
    }

    // ── What the chart reads at a time ────────────────────────────────────

    /** The place of a point at a time, in the units of the axes. */
    private placeAt(index: number, time: number): [number, number] {
        const mark = this.dots[index]!, { xRange, yRange, w, h } = this.frame
        const x = propAt(mark, 'x', time), y = propAt(mark, 'y', time), entry = this.entries[index]!
        const [restX, restY] = this.p(entry.x, entry.y)
        return [x === restX ? entry.x : xRange[0] + (x / w + 0.5) * (xRange[1] - xRange[0]), y === restY ? entry.y : yRange[0] + (0.5 - y / h) * (yRange[1] - yRange[0])]
    }

    /** The group of a point at a time: the one that it goes to, from the start of a change. */
    private groupAt(entry: Entry, time: number): string | undefined {
        let group = entry.first
        for (const change of entry.changes) if (change.t0 <= time) group = change.to
        return group
    }

    /** How much a point is a member of a group at a time, from 0 to 1: it leaves one group and joins the next over the time of a change. */
    private shareIn(entry: Entry, group: string, time: number): number {
        let last: Change | null = null
        for (const change of entry.changes) if (change.t0 <= time) last = change
        const initial = entry.initialShares ? entry.initialShares.get(group) ?? 0 : Number(entry.first === group)
        if (!last) return initial
        if (time >= last.t1) return last.to === group ? 1 : 0
        const share = Math.min(1, Math.max(0, last.ease((time - last.t0) / (last.t1 - last.t0))))
        const from = last === entry.changes[0] ? initial : Number(last.from === group)
        return from + (Number(last.to === group) - from) * share
    }

    /**
     * The points that a search can find, from the nearest to `at`, with their distances in the units of the
     * axes. `time` is a time of the film, or null for the places after the changes that are scheduled so far.
     */
    private ranked(at: Vec, self: number, among: Probe['among'], time: number | null): { index: number; distance: number }[] {
        const out: { index: number; distance: number }[] = []
        this.entries.forEach((entry, index) => {
            if (index === self || entry.query) return
            if (!present(entry, time)) return
            const point = this.viewAt(index, time)
            if (among && !among(point)) return
            out.push({ index, distance: Math.hypot(point.x - at[0], point.y - at[1]) })
        })
        return out.sort((a, b) => a.distance - b.distance || a.index - b.index)
    }

    /** The outline of the hull of a group at a time, in the coordinates of the chart. A point that joins or leaves is on its way between the middle of the group and its own place. */
    private hullAt(group: string, time: number): Vec[] | null {
        const members: { place: Vec; share: number; corners: Vec[] }[] = []
        const size = this.nameSize
        this.entries.forEach((entry, index) => {
            const share = this.shareIn(entry, group, time)
            if (share <= 0) return
            const x = propAt(this.dots[index]!, 'x', time), y = propAt(this.dots[index]!, 'y', time), r = entry.radius
            // The room of the mark, and the room of the name beside it: the hull holds both, so its line does not cut a name.
            const corners: Vec[] = [[x - r, y], [x + r, y], [x, y - r], [x, y + r]]
            const label = this.nameLabels[index]
            if (label) {
                const lx = propAt(label, 'x', time), ly = propAt(label, 'y', time)
                corners.push([lx - entry.half, ly - size * 0.42], [lx + entry.half, ly - size * 0.42], [lx + entry.half, ly + size * 0.52], [lx - entry.half, ly + size * 0.52])
            }
            members.push({ place: [x, y], share, corners })
        })
        if (members.length === 0) return null
        const full = members.filter((member) => member.share >= 1)
        const core = full.length > 0 ? full : members
        const cx = core.reduce((sum, member) => sum + member.place[0], 0) / core.length, cy = core.reduce((sum, member) => sum + member.place[1], 0) / core.length
        const places = members.flatMap((member) => member.corners.map((corner): Vec => [cx + (corner[0] - cx) * member.share, cy + (corner[1] - cy) * member.share]))
        // The label of the group is over its members. The hull holds it too, when it shows.
        const at = this.groupNames.indexOf(group), label = this.groupLabels[at]
        if (label && full.length > 0 && (label.tracks?.get('visible')?.sample(time) ?? label.base.visible)) {
            const lx = propAt(label, 'x', time), ly = propAt(label, 'y', time), half = this.groupHalves[at]!, high = this.labelSize + 2
            places.push([lx - half, ly - high * 0.42], [lx + half, ly - high * 0.42], [lx + half, ly + high * 0.52], [lx - half, ly + high * 0.52])
        }
        // The only members are on their way in or out: the hull grows from nothing, and goes back to nothing.
        const grown = full.length > 0 ? 1 : Math.max(...members.map((member) => member.share))
        const pad = size * 0.45 * grown
        return pad < 0.5 ? null : around(convexHull(places), pad)
    }

    /** The center of a cell at a time, or after the changes that are scheduled so far, in the units of the axes. */
    private centerAt(center: number | Vec, time: number | null): Vec {
        if (typeof center !== 'number') return center
        return time === null ? [this.entries[center]!.x, this.entries[center]!.y] : this.placeAt(center, time)
    }

    /** The index of the center that is nearest to a place, after the changes that are scheduled so far. */
    private cellOf(centers: readonly (number | Vec)[], place: Vec, time: number | null): number {
        let best = 0, least = Infinity
        centers.forEach((center, index) => {
            const [x, y] = this.centerAt(center, time)
            const distance = Math.hypot(x - place[0], y - place[1])
            if (distance < least) {
                least = distance
                best = index
            }
        })
        return best
    }

    /** The outline of one cell of a partition at a time: the plot, cut at the line of equal distance to each other center. */
    private cellAt(centers: readonly (number | Vec)[], at: number, time: number): Vec[] | null {
        const { xRange, yRange } = this.frame
        let polygon: Vec[] = [[xRange[0], yRange[0]], [xRange[1], yRange[0]], [xRange[1], yRange[1]], [xRange[0], yRange[1]]]
        const own = this.centerAt(centers[at]!, time)
        for (let index = 0; index < centers.length && polygon.length >= 3; index++) {
            if (index === at) continue
            const other = this.centerAt(centers[index]!, time)
            const dx = other[0] - own[0], dy = other[1] - own[1]
            const scale = Math.max(Math.abs(dx), Math.abs(dy))
            if (scale === 0) {
                if (index < at) return null
                continue
            }
            const a = dx / scale, b = dy / scale
            polygon = clip(polygon, own, a, b, a * (dx / 2) + b * (dy / 2))
        }
        return polygon.length < 3 ? null : polygon.map(([x, y]) => this.p(x, y))
    }

    /** Make the layer of the patches, with the first area or the first search. A chart with neither has no line that could pass a text. */
    private patched(): void {
        if (this.patchLayer) return
        this.patchLayer = new Part<Scatter>(this, (owner, time) => owner.drawPatches(time)).zIndex(-0.5)
        this.add(this.patchLayer)
    }

    /** The patch behind each text of the chart at a time: the background, with the fill of each area that the text is in. */
    private drawPatches(time: number): Node[] {
        const ground = solidColor(toPaint('bg'))
        const fills = this.areas.flatMap((area) => {
            const shown = shownAt(area, time), { color, opacity } = area.fillAt(time)
            const ring = shown * opacity > 0.004 ? area.ringAt(time) : null
            return ring ? [{ ring, color: solidColor(color), opacity: shown * opacity }] : []
        })
        const texts: { node: Node; half: number; size: number }[] = []
        this.nameLabels.forEach((node, index) => { if (node && node.parent) texts.push({ node, half: this.entries[index]!.half, size: this.nameSize }) })
        this.groupLabels.forEach((node, index) => texts.push({ node, half: this.groupHalves[index]!, size: this.labelSize + 2 }))
        const out: Node[] = []
        for (const { node, half, size } of texts) {
            // A text that fades in has its patch from the start, so no line shows through it while it comes.
            if (shownAt(node, time) < 0.05) continue
            const x = propAt(node, 'x', time), y = propAt(node, 'y', time)
            let color: Rgba = ground
            for (const fill of fills) if (inside(fill.ring, x, y)) color = over(fill.color, fill.opacity, color)
            const wide = half + size * 0.12
            out.push(new Node(rectPath(x - wide, y - size * 0.5, wide * 2, size * 1.14)).fill(color))
        }
        return out
    }

    /** Add an area to the layer of the areas, under the points. */
    private area(made: ScatterArea): ScatterArea {
        if (!this.areaLayer) {
            this.areaLayer = new Node().zIndex(-2)
            this.add(this.areaLayer)
            this.patched()
        }
        this.areaLayer.add(made)
        this.areas.push(made)
        return made
    }

    /** The ring and the lines of one state of a search at a time, with the share of the ring that has grown. */
    private probeMarks(probe: Probe, time: number, radius: number, most: number, opacity: number): Node[] {
        const { xRange, yRange, w, h } = this.frame
        const center = this.placeAt(probe.from, time), [cx, cy] = this.p(center[0], center[1])
        const out: Node[] = []
        if (radius > 0) {
            const ring = ringInside(cx, cy, (radius * w) / (xRange[1] - xRange[0]), (radius * h) / (yRange[1] - yRange[0]), w / 2, h / 2)
            if (ring.length > 0) out.push(new Node(ring).stroke(probe.color, 2.5, opacity))
        }
        const own = this.entries[probe.from]!.radius
        for (const { index, distance } of this.ranked(center, probe.from, probe.among, time).slice(0, most)) {
            // A point gets its line when the ring reaches it.
            if (distance > radius * (1 + 1e-9)) continue
            const other = this.entries[index]!
            const [x, y] = this.p(...this.placeAt(index, time))
            const length = Math.hypot(x - cx, y - cy), from = own + 4, to = other.radius + 7
            out.push(new Node(circlePath(x, y, other.radius + 5)).stroke(probe.color, 2.5, opacity))
            if (length > from + to) {
                const ux = (x - cx) / length, uy = (y - cy) / length
                out.push(line([cx + ux * from, cy + uy * from], [x - ux * to, y - uy * to], { stroke: probe.color, width: 2.5 }).set('strokeOpacity', opacity))
            }
        }
        return out
    }

    /** The distance from the point of a search to its k-th nearest point at a time: the size of the ring when it has grown. */
    private reach(probe: Probe, time: number): number {
        if (probe.k === 0) return 0
        const found = this.ranked(this.placeAt(probe.from, time), probe.from, probe.among, time)
        return found.length === 0 ? 0 : found[Math.min(probe.k, found.length) - 1]!.distance
    }

    private progress(probe: Probe, time: number): number {
        return probe.frozen ?? (time >= probe.t1 ? 1 : Math.min(1, Math.max(0, probe.ease((time - probe.t0) / (probe.t1 - probe.t0)))))
    }

    /** A search started on a clone grows from the radius visible in the copied frame. */
    private radiusAt(probe: Probe, time: number): number {
        const to = this.reach(probe, time), share = this.progress(probe, time)
        if (share === 1) return to
        const from = probe.before?.from === probe.from ? this.radiusAt(probe.before, time) : 0
        return from + (to - from) * share
    }

    private probeAt(time: number): Probe | null {
        for (let i = this.probes.length - 1; i >= 0; i--) if (this.probes[i]!.t0 <= time) return this.probes[i]!
        return null
    }

    /** The search at a time: the ring grows or shrinks from the state before it, and each point inside it has a line. */
    private drawProbe(time: number): Node[] | null {
        const probe = this.probeAt(time)
        if (!probe) return null
        const share = this.progress(probe, time)
        const before = probe.before && (probe.before.k > 0 || (probe.before.frozen ?? 1) < 1) ? probe.before : null
        if (before && before.from === probe.from) {
            // The same point asks again: the ring goes from the size that it had to the new one.
            return this.probeMarks(probe, time, this.radiusAt(probe, time), share >= 1 ? probe.k : Math.max(probe.k, before.k), 1)
        }
        const out: Node[] = []
        // Another point asks: the search before this one fades while the new ring grows.
        if (before && share < 1) out.push(...this.probeMarks(before, time, this.radiusAt(before, time), before.k, 1 - share))
        if (probe.k > 0) out.push(...this.probeMarks(probe, time, this.reach(probe, time) * share, probe.k, 1))
        return out
    }
}

/** A point cloud on axes: `scatter([{ x: 1, y: 2, name: 'A', group: 'fruit' }, { x: 4, y: 5, name: 'q', query: true }])`. */
export function scatter(points: readonly ScatterPoint[], options: ScatterOptions = {}): Scatter {
    return new Scatter(points, options)
}
