import { arcPath, polyPath, rectPath, ring, smoothPath, type Path, type Vec } from '../geometry'
import { dynamic, Node, ownLabels, rebindCloneParts } from '../node'
import { circle, dot, line, polyline, svgPath } from '../shapes'
import { text, type TextOptions } from '../text'
import { sampleStops, toPaint, type ColorInput, type Paint, type Rgba } from '../color'
import { type Anim, type AnimContext, type AnimOptions, Value } from '../anim'
import type { Ease } from '../ease'
import { Box } from '../layout'
import { clock } from '../track'
import { DEFAULT_SERIES, formatNumber, luminance, niceTicks, reveal, sampleAt, small, solidColor, staggered, stepAt, tweenValue, xyAxes, xyPoint, type XYFrame } from './util'

export interface ChartOptions {
    width?: number
    height?: number
    /** Text size for direct labels and ticks. */
    labelSize?: number
    color?: ColorInput
    /** The font of the labels and the ticks. Defaults to the font of the film. A value that the chart prints is in mono. */
    font?: TextOptions['font']
}

// ── Bars ────────────────────────────────────────────────────────────────────

export interface BarDatum {
    label: string
    value: number
    color?: ColorInput
}

/** A bar of a chart: its index in the data, or its label. */
export type BarRef = number | string

export type BarMark = 'dot' | 'ring' | 'check' | 'cross'

/** The look of one state of a bar. */
export interface BarState {
    /** A mark beside the label of the bar, so that color is not the only sign of the state. */
    mark: BarMark
    /** The color of the bar and of its mark in this state. Without it, the bar keeps its own color. */
    color?: ColorInput
    /** The bar is out: its fill, its label and its number are faint. */
    dim?: boolean
}

/**
 * The states of a bar of a small distribution, beside `plain`, which is the bar as the data gives it. Each
 * has its own mark, so color is not the only sign.
 */
export const BAR_STATES = {
    /** The bar that the data names as right: the label of a training example, the true class. */
    target: { color: 'green', mark: 'ring' },
    /** The bar that a draw or a rule picked: the sampled token, the winner. */
    chosen: { color: 'yellow', mark: 'check' },
    /** A bar that a rule took out: a token that the grammar forbids, the tail after a cut. */
    masked: { mark: 'cross', dim: true },
} satisfies Record<string, BarState>

/** The text of a cut: fixed words, or a function of the value or the count of the cut, which follows the line while it moves. */
export type BarCutLabel = string | ((value: number) => string)

export interface BarCutOptions {
    label?: BarCutLabel
    /** The color of the line and of its label. Defaults to ink. */
    color?: ColorInput
}

export interface BarChartOptions extends ChartOptions {
    /** Fraction of each band left empty between bars. */
    gap?: number
    /** Fixes the top of the scale. Defaults to the largest value. For shares or probabilities, give 1. */
    max?: number
    min?: number
    showValues?: boolean
    format?: (value: number) => string
    horizontal?: boolean
    radius?: number
    /** The color of each bar that has none of its own. Without it, each bar takes the next color of a list. */
    barColor?: ColorInput
    /**
     * Lines of the scale behind the bars, each with its value: about that many, or the values to mark. They
     * need a scale that does not change, so give `max` with them. `min` then stays what it is at the start.
     */
    ticks?: number | readonly number[]
    /**
     * `true`, or a table of states for `mark()`. The chart then keeps the room of the state marks from the
     * start: one text size under the labels, or at their left in a horizontal chart. Without it, the states
     * are `BAR_STATES`, and the chart measures a mark from the first `mark()` that draws one.
     */
    states?: true | Record<string, BarState>
    /** A second series from the start: one value for each bar, drawn as an outline on the same column. */
    reference?: readonly number[]
    /** The color of the outlines of the second series. Defaults to ink. */
    referenceColor?: ColorInput
    /**
     * The color behind the chart. In a sort, a bar that passes others has a patch of this color under it, so
     * its label does not print over theirs. Defaults to the background of the look. Set it to the color of a
     * panel that the chart is on. With null, the chart draws no patch, and the bars pass through each other.
     */
    backing?: ColorInput | null
    /** A line across the bars at a value, from the start: a threshold, a mean, a limit. */
    cutAt?: BarCutOptions & { value: number }
    /** A line after a number of bars, from the start: the cut of a top-k rule. */
    cutAfter?: BarCutOptions & { count: number }
}

interface Look {
    paint: Paint | null
    mark: BarMark | null
    dim: boolean
}

interface Cut {
    last?: PlayWindow
    /** The line and the label. */
    node: Node
    /** The value of a cut at a value, or the number of bars before a cut after a rank. */
    where: Value
    /** How much of the line is drawn, from 0 to 1. */
    drawn: Value
    /** The label and the color from a time on, in the order of the calls. */
    looks: { time: number; label: BarCutLabel | undefined; color: ColorInput }[]
    /** Where the cut is after the changes that are scheduled so far, or null for a cut that is gone. */
    target: number | null
}

/** One move of a bar to another column: the shift of the bar along the row of the columns, over a time. */
interface Move {
    t0: number
    t1: number
    ease: Ease
    from: number
    to: number
}

/** Two times that differ by less than this are one time: the rounding of a sum of durations. */
const SOON = 1e-6
type PlayWindow = { t0: number; t1: number }
type ValueChange = PlayWindow & { call: string; strict: boolean }

function overlaps(a: PlayWindow, b: PlayWindow): boolean {
    return a.t0 < b.t1 - SOON && b.t0 < a.t1 - SOON
}

function claimCut(cut: { last?: PlayWindow }, next: PlayWindow, call: string): void {
    if (cut.last && next.t0 < cut.last.t1 - SOON) {
        throw new Error(`${call} starts at ${seconds(next.t0)}, before the previous cut ends at ${seconds(cut.last.t1)}. Play changes to the same cut in a seq, in chronological order.`)
    }
    cut.last = next
}

function visibleCut(cut: { node: Node; drawn: Value; where: Value } | null): number | null {
    return cut && cut.node.get('visible') && cut.drawn.value > 0 ? cut.where.value : null
}

// A dynamic drawing closes over its chart. A static copy must keep the drawing from the time of the copy.
function snapshotDrawing(part: Node, copies: ReadonlyMap<Node, Node>): void {
    if (!part.draw) return
    const drawing = part.draw(clock.now)
    const still = drawing instanceof Node ? drawing.clone() : drawing?.map((node) => node.clone()) ?? null
    copies.get(part)!.draw = () => still
}

function snapshotCut<T extends { node: Node; where: Value; drawn: Value }>(cut: T | null, copies: ReadonlyMap<Node, Node>): T | null {
    if (!cut) return null
    for (const part of cut.node.children) snapshotDrawing(part, copies)
    return { ...cut, node: copies.get(cut.node)!, where: new Value(cut.where.value), drawn: new Value(cut.drawn.value) }
}
/** The opacity of the fill of a bar, and of a bar whose state is dim. */
const BAR_FILL = 0.84, DIM_FILL = 0.3
/** How much of its number a dim bar keeps. */
const DIM_TEXT = 0.45
/** The radius of the mark of a state, as a part of the text size. */
const MARK = 0.36

const seconds = (time: number): string => `${Math.round(time * 1000) / 1000} s`

/** The times of an animation. A time that is not a number would write keys that no frame finds. */
function windowOf(ctx: AnimContext, call: string): [number, number] {
    if (!(Number.isFinite(ctx.t0) && Number.isFinite(ctx.t1) && ctx.t1 >= ctx.t0)) throw new Error(`${call} plays from ${String(ctx.t0)} to ${String(ctx.t1)}. Give the play a duration that is a number, 0 or more`)
    return [ctx.t0, ctx.t1]
}

/** The words of a cut at a value. A label that is a function is called with the value. */
function cutWords(what: string, label: BarCutLabel | undefined, value: number): string | null {
    if (label === undefined) return null
    const words = typeof label === 'function' ? label(value) : label
    if (typeof words !== 'string') throw new Error(`${what}: the label is ${typeof label === 'function' ? `a function that returned ${words === null ? 'null' : typeof words}` : words === null ? 'null' : typeof words}. A label is a text, or a function of the value that returns a text, such as (value) => \`top \${value}\``)
    return words === '' ? null : words
}

/** The mark of a state, around 0, 0. */
function stateMark(kind: BarMark, r: number, width: number, paint: Paint): Node {
    const made = kind === 'ring' ? circle(r - width / 2, { stroke: paint, width })
        : kind === 'check' ? polyline([[-r, r * 0.05], [-r * 0.3, r * 0.75], [r, -r * 0.7]], { stroke: paint, width })
            : kind === 'cross' ? svgPath(`M${-r * 0.85} ${-r * 0.85}L${r * 0.85} ${r * 0.85}M${-r * 0.85} ${r * 0.85}L${r * 0.85} ${-r * 0.85}`, { stroke: paint, width })
                : dot(r * 0.8, paint)
    made.data['shape'] = kind
    return made
}

/**
 * Bars with direct labels and a single hairline baseline. `enter()` grows them from zero and `update(values)`
 * animates to new data, with readouts that count. With `max: 1` it is a small distribution on a fixed scale.
 * `mark()` gives a bar a state, `mask()` takes bars out and gives their share to the rest, `reference()` draws
 * a second series as outlines on the same columns, `cutAt()` and `cutAfter()` draw a line across the bars, and
 * `sort()` moves the bars to a new order. A bar keeps its index through all of them.
 */
export class BarChart extends Node {
    private isCopy = false
    private staticCopy = false
    readonly bars: Node[] = []
    readonly labels: Node[] = []
    readonly readouts: Node[] = []
    readonly baseline: Node
    readonly values: Value[]
    /** The outline of the second series on each bar. The list is empty until the chart has a second series. */
    readonly outlines: Node[] = []
    /** The lines of the scale and their values, or null for a chart with no `ticks`. */
    readonly ticks: Node | null = null
    /** The line and the label of the cut at a value, or null until the chart has one. */
    valueCut: Node | null = null
    /** The line and the label of the cut after a rank, or null until the chart has one. */
    rankCut: Node | null = null
    private readonly maxValue: Value
    private readonly minValue: Value
    private readonly w: number
    private readonly h: number
    private readonly horizontal: boolean
    private readonly band: number
    private readonly gap: number
    private readonly fixedMax?: number
    private readonly fixedMin?: number
    private readonly labelSize: number
    private readonly font: TextOptions['font']
    private readonly format: (value: number) => string
    private readonly showValues: boolean
    private readonly names: string[]
    /** The color of each bar in the state `plain`. */
    private readonly colors: ColorInput[]
    /** Where the label of each bar is in the chart, and where its bar starts, when the bar is in the column of its index. */
    private readonly homes: [x: number, y: number][] = []
    private readonly feet: [x: number, y: number][] = []
    /** The width of each label, measured when a part first needs it. */
    private widths: number[] | null = null
    private readonly looks = new Map<string, Look>()
    private readonly referenceColor: ColorInput
    private readonly backing: ColorInput | null
    /** Where each line of the scale is, along the values, for a chart with `ticks`. */
    private tickPlaces: number[] = []
    /** The value of the second series on each bar, and how much of the outlines shows, from 0 to 1. */
    private readonly outlineValues: Value[]
    private readonly referenceShown = new Value(0)
    /** The bookkeeping. The animations change it when they are scheduled, so two changes in one sequence chain. */
    private slots: number[]
    private stateOf: string[]
    /** The time of the last change of the state of each bar. */
    private changed: (PlayWindow | null)[]
    /** The moves of each bar, in the order of time. A part that a bar gets later follows them. */
    private moves: Move[][]
    private referenceTargets: number[] | null = null
    private cuts: { at: Cut | null; after: Cut | null } = { at: null, after: null }
    private lastSort: { t0: number; t1: number } | null = null
    private readonly valueChanges: ValueChange[] = []
    private readonly protectedChanges: ValueChange[] = []
    /** What a bar gets beside its label and its number: the outline of the second series, and the mark of its state. */
    private carriers: (Node | null)[]
    private holders: (Node | null)[]
    /** How much of its number a bar shows, for a bar that was dim at some time. */
    private fades: (Value | undefined)[] = []

    constructor(data: readonly BarDatum[], options: BarChartOptions = {}) {
        super()
        this.w = options.width ?? 900
        this.h = options.height ?? 520
        this.horizontal = options.horizontal ?? false
        this.gap = options.gap ?? 0.28
        const labelSize = this.labelSize = options.labelSize ?? 20
        this.font = options.font
        this.showValues = options.showValues ?? true
        this.referenceColor = options.referenceColor ?? 'ink'
        this.backing = options.backing === undefined ? 'bg' : options.backing
        // A color that the look does not have stops the build here, and not at the first frame that draws it.
        for (const color of [this.referenceColor, this.backing, options.cutAt?.color, options.cutAfter?.color]) if (color != null) toPaint(color)
        const count = Math.max(1, data.length)
        this.band = (this.horizontal ? this.h : this.w) / count
        const numbers = data.map((d) => d.value)
        const second = options.reference
        if (second !== undefined) this.checkValues('the option `reference`', second, data.length)
        this.maxValue = new Value(options.max ?? Math.max(0, ...numbers, ...(second ?? [])))
        this.minValue = new Value(options.min ?? Math.min(0, ...numbers, ...(second ?? [])))
        if (options.ticks !== undefined && options.max === undefined) throw new Error('barChart: ticks need a scale that does not change. Give `max` with them, such as max: 1 for shares')
        this.fixedMax = options.max
        // The lines of the scale are drawn one time, so the scale keeps both of its ends.
        this.fixedMin = options.ticks !== undefined ? this.minValue.value : options.min
        this.values = data.map((d) => new Value(d.value))
        this.outlineValues = data.map((_, i) => new Value(second?.[i] ?? 0))
        this.names = data.map((d) => d.label)
        this.colors = data.map((d, i) => d.color ?? options.barColor ?? DEFAULT_SERIES[i % DEFAULT_SERIES.length]!)
        this.slots = data.map((_, i) => i)
        this.stateOf = data.map(() => 'plain')
        this.changed = data.map(() => null)
        this.moves = data.map(() => [])
        this.carriers = data.map(() => null)
        this.holders = data.map(() => null)
        const format = this.format = options.format ?? ((v: number) => formatNumber(Math.round(v * 100) / 100))
        const baseColor = options.color ?? 'faint'
        const [ax, ay] = this.place(0, 0, 'start'), [bx, by] = this.place(count - 1, 0, 'end')
        this.baseline = line([ax, ay], [bx, by], { stroke: baseColor, width: 1.5 })
        data.forEach((datum, i) => {
            const color = this.colors[i]!
            // Slightly translucent: large solid areas bloom too hard and read as blocks of light.
            const bar = new Node(this.barPath(i, datum.value)).fill(color, BAR_FILL)
            this.bars.push(bar)
            const label = small(datum.label, labelSize, 'dim', options.font)
            this.labels.push(label)
            const [px, py] = this.place(i, 0, 'mid')
            if (this.horizontal) label.at(px - 12 - label.width / 2, py)
            else label.at(px, py + 12 + labelSize / 2)
            this.homes.push([label.get('x'), label.get('y')])
            this.feet.push([px, py])
            if (this.showValues) {
                const readout = dynamic(() => {
                    const value = this.values[i]!.value
                    const node = small(format(value), labelSize, 'ink', 'mono')
                    const [px, py] = this.tip(i, this.clear(i, value, this.horizontal ? 12 + node.width + labelSize * 0.3 : 10 + labelSize * 1.4))
                    const fade = this.fades[i]?.value ?? 1
                    if (fade !== 1) node.opacity(fade)
                    if (this.horizontal) return node.at(px + 12 + node.width / 2, py)
                    return node.at(px, py + (value >= 0 ? -1 : 1) * (10 + labelSize * 0.6))
                })
                this.readouts.push(readout)
            }
        })
        if (options.ticks !== undefined) {
            this.add(this.ticks = this.makeScale(options.ticks, options.format))
            this.checkScale('the data', numbers)
            if (second) this.checkScale('the option `reference`', second)
        }
        this.add(...this.bars, this.baseline, ...this.labels, ...this.readouts)
        ownLabels(this, { name: 'bar chart', plot: true })

        this.looks.set('plain', { paint: null, mark: null, dim: false })
        const table: Record<string, BarState> = typeof options.states === 'object' ? options.states : BAR_STATES
        if (options.states !== undefined && options.states !== true && (typeof options.states !== 'object' || options.states === null)) throw new Error('barChart: states is true, or a table of states such as { target: { color: \'green\', mark: \'ring\' } }')
        for (const [name, state] of Object.entries(table)) {
            if (name === 'plain') throw new Error('barChart: a table of states cannot change `plain`. It is the bar as the data gives it. Give the state another name')
            if (typeof state !== 'object' || state === null) throw new Error(`barChart: the state ${JSON.stringify(name)} is ${state === null ? 'null' : typeof state}. A state is a look, such as { color: 'green', mark: 'ring' }`)
            if (state.mark === undefined) throw new Error(`barChart: the state ${JSON.stringify(name)} has no mark, so its color is its only sign. Give it a mark: 'dot', 'ring', 'check' or 'cross'`)
            if (!['dot', 'ring', 'check', 'cross'].includes(state.mark)) throw new Error(`barChart: the mark of the state ${JSON.stringify(name)} is ${JSON.stringify(state.mark)}. A mark is 'dot', 'ring', 'check' or 'cross'`)
            this.looks.set(name, { paint: state.color === undefined ? null : toPaint(state.color), mark: state.mark, dim: state.dim === true })
        }
        // With `states`, each bar has the place of its mark from the start, so the layout measures it.
        if (options.states !== undefined) data.forEach((_, i) => this.holder(i, null))
        if (second !== undefined) {
            this.referenceTargets = [...second]
            this.referenceShown.track.initial = 1
            data.forEach((_, i) => this.outline(i, null))
        }
        if (options.cutAt !== undefined) {
            this.checkCut('at', options.cutAt.value, 'the option `cutAt`')
            this.cuts.at = this.makeCut('at', options.cutAt.value, options.cutAt, null)
        }
        if (options.cutAfter !== undefined) {
            this.checkCut('after', options.cutAfter.count, 'the option `cutAfter`')
            this.cuts.after = this.makeCut('after', options.cutAfter.count, options.cutAfter, null)
        }
    }

    private lengthOf(value: number): number {
        const span = (this.maxValue.value - this.minValue.value) || 1
        return (value / span) * (this.horizontal ? this.w : this.h)
    }

    /** Baseline position for bar i. */
    private place(i: number, _unused: number, at: 'start' | 'mid' | 'end'): [number, number] {
        const center = (i + 0.5) * this.band
        const half = this.band / 2
        const along = at === 'mid' ? center : at === 'start' ? center - half : center + half
        const span = (this.maxValue.value - this.minValue.value) || 1
        if (this.horizontal) {
            const zero = (-this.minValue.value / span) * this.w - this.w / 2
            return [zero, along - this.h / 2]
        }
        const zero = this.h / 2 - (-this.minValue.value / span) * this.h
        return [along - this.w / 2, zero]
    }

    private tip(i: number, value: number): [number, number] {
        const [px, py] = this.place(i, 0, 'mid')
        const length = this.lengthOf(value)
        return this.horizontal ? [px + length, py] : [px, py - length]
    }

    /**
     * The value that the number of a bar stands past: the end of the bar, or a line that would cross the
     * number. An outline of the second series that ends past the bar is such a line, and so is the line of a
     * cut that is past the end of the bar by less than `room`, the room that the number takes, in pixels.
     * The number goes there as the line arrives.
     */
    private clear(i: number, value: number, room: number): number {
        let past = value
        const shown = this.referenceShown.value
        if (shown > 0) {
            const other = this.outlineValues[i]!.value
            past = value + ((value >= 0 ? Math.max(value, other) : Math.min(value, other)) - value) * shown
        }
        const cut = this.cuts.at
        // A line that the film hides until its verb is in the way of no number.
        const drawn = cut && cut.node.get('visible') ? cut.drawn.value : 0
        if (cut && drawn > 0) {
            const at = cut.where.value
            const pixels = (this.horizontal ? this.w : this.h) / ((this.maxValue.value - this.minValue.value) || 1)
            const beyond = (at - past) * (value >= 0 ? 1 : -1) * pixels
            // The line draws from one end, so the number is out of its way early.
            if (beyond >= 0 && beyond < room) past += (at - past) * Math.min(1, drawn * 4)
        }
        return past
    }

    private barPath(i: number, value: number): Path {
        const [px, py] = this.place(i, 0, 'mid')
        const thick = this.band * (1 - this.gap)
        const length = this.lengthOf(value)
        if (this.horizontal) return rectPath(px, py - thick / 2, length, thick)
        return rectPath(px - thick / 2, py - length, thick, length)
    }

    bar(i: number): Node {
        return this.bars[i]!
    }

    /** The name, the readout and the state mark of a bar belong to it, so a light on the bar keeps them bright. */
    override labelsOf(part: Node): readonly Node[] {
        const index = this.bars.indexOf(part)
        return index < 0 ? [] : [this.labels[index], this.readouts[index], this.carriers[index]].filter((node): node is Node => node != null)
    }

    // ── What a film reads ─────────────────────────────────────────────────

    /** The index of the bar with a label, or null when no bar has it. Two bars with one label are an error: name such a bar by its index. */
    find(label: string): number | null {
        const found = this.names.flatMap((name, index) => (name === label ? [index] : []))
        if (found.length > 1) throw new Error(`barChart: ${found.length} bars have the label ${JSON.stringify(label)}. Name the bar by its index: ${found.join(', ')}`)
        return found[0] ?? null
    }

    /** The state of a bar, after the changes that are scheduled so far. A bar starts `plain`. */
    state(which: BarRef): string {
        return this.stateOf[this.index(which, 'state()')]!
    }

    /** The bars in the order of the columns, after the sorts that are scheduled so far: `order[0]` is the index of the bar in the first column. */
    get order(): number[] {
        const order: number[] = []
        this.slots.forEach((slot, index) => { order[slot] = index })
        return order
    }

    /** The two cuts, after the changes that are scheduled so far: the value of the cut at a value, and the number of bars before the cut after a rank. Null for a cut that the chart does not have. */
    get cut(): { at: number | null; after: number | null } {
        return { at: this.cuts.at?.target ?? null, after: this.cuts.after?.target ?? null }
    }

    /** The values of the second series, after the changes that are scheduled so far, or null for a chart that shows none. */
    get referenceValues(): number[] | null {
        return this.referenceTargets ? [...this.referenceTargets] : null
    }

    /**
     * The bars after a rank, in the order of the columns: what a top-k rule drops. Without a count, it is the
     * count of the cut that `cutAfter()` drew.
     */
    tail(count?: number): number[] {
        const from = count ?? this.cuts.after?.target ?? null
        if (from === null) throw new Error('barChart: tail() needs a count, or a cut that `cutAfter()` drew. Give the number of bars to keep, such as tail(2)')
        this.checkCut('after', from, 'tail()')
        return this.order.slice(from)
    }

    /**
     * The bars whose value is under a value at the time of the film: what a threshold drops. Without a value,
     * it is the value of the cut that `cutAt()` drew.
     */
    below(value?: number): number[] {
        const limit = value ?? visibleCut(this.cuts.at)
        if (limit === null) throw new Error('barChart: below() needs a value, or a cut that `cutAt()` drew. Give the threshold, such as below(0.1)')
        if (!Number.isFinite(limit)) throw new Error(`barChart: below() got ${limit}. A threshold is a finite number`)
        return this.order.filter((index) => this.values[index]!.value < limit)
    }

    /**
     * A place on the column of a bar, in the coordinates of the chart, for a note or the end of an arrow:
     * the end of the bar, or the height of another value on its column.
     */
    p(which: BarRef, value?: number): [number, number] {
        const index = this.index(which, 'p()')
        const at = value ?? this.values[index]!.value
        if (!Number.isFinite(at)) throw new Error(`barChart: p() got the value ${at}. A value is a finite number`)
        const point = this.tip(index, at)
        const axis = this.horizontal ? 1 : 0
        point[axis] += this.bars[index]!.get(this.horizontal ? 'y' : 'x')
        return point
    }

    /**
     * The box of the column of a bar, in stage pixels, for `place` and `beside` of the layout: the whole
     * height of the plot, one band wide. Without a bar it is the plot. The box is where the chart is now, so
     * ask for it after the chart has its place.
     */
    region(which?: BarRef): Box {
        const along = this.horizontal ? this.h : this.w
        let from = -along / 2, to = along / 2
        if (which !== undefined) {
            const index = this.index(which, 'region()')
            from = index * this.band - along / 2 + this.bars[index]!.get(this.horizontal ? 'y' : 'x')
            to = from + this.band
        }
        const [left, right] = this.horizontal ? [-this.w / 2, this.w / 2] : [from, to]
        const [top, bottom] = this.horizontal ? [from, to] : [-this.h / 2, this.h / 2]
        const corners = [this.toWorld(left, top), this.toWorld(right, top), this.toWorld(left, bottom), this.toWorld(right, bottom)]
        const xs = corners.map(([x]) => x), ys = corners.map(([, y]) => y)
        return new Box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
    }

    // ── What a film plays ─────────────────────────────────────────────────

    /** Baseline and labels appear, then bars rise one after another while readouts count up. The second series and the cuts of the options arrive with them. */
    enter(options: AnimOptions = {}): Anim {
        if (this.staticCopy) this.own('enter()')
        const lag = options.lag ?? 0.12
        return {
            label: 'barChart.enter', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                this.claimValues('enter()', ctx.t0, ctx.t1, false)
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                stepAt(this.baseline, 'trimTo', 0, ctx.t0)
                this.baseline.tween('trimTo', 1, ctx.t0, ctx.t0 + span * 0.4, ctx.ease)
                if (this.ticks) {
                    stepAt(this.ticks, 'opacity', 0, ctx.t0)
                    this.ticks.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.4, ctx.ease)
                }
                const windows = staggered(this.bars.length, lag, ctx.t0 + span * 0.1, ctx.t1)
                if (this.referenceTargets) {
                    this.referenceShown.track.step(ctx.t0, 0)
                    tweenValue(this.referenceShown, 1, ctx.t0 + span * 0.1, ctx.t0 + span * 0.4, ctx.ease)
                }
                this.bars.forEach((bar, i) => {
                    const [start, end] = windows[i]!
                    const target = this.values[i]!.track.sample(ctx.t0)
                    this.values[i]!.track.step(ctx.t0, 0)
                    tweenValue(this.values[i]!, target, start, end, ctx.ease)
                    bar.track('path').step(ctx.t0, this.barPath(i, 0))
                    bar.track('path').add({
                        t0: start, t1: end, ease: ctx.ease,
                        to: this.barPath(i, target),
                        at: (a) => this.barPath(i, target * a),
                    })
                    const label = this.labels[i]!
                    stepAt(label, 'opacity', 0, ctx.t0)
                    label.tween('opacity', 1, start, start + (end - start) * 0.6, ctx.ease)
                    const readout = this.readouts[i]
                    if (readout) {
                        stepAt(readout, 'opacity', 0, ctx.t0)
                        readout.tween('opacity', 1, start, start + (end - start) * 0.5, ctx.ease)
                    }
                    // An outline of the second series rises with its bar.
                    if (this.referenceTargets) {
                        const outline = this.outlineValues[i]!
                        const height = outline.track.sample(ctx.t0)
                        outline.track.step(ctx.t0, 0)
                        tweenValue(outline, height, start, end, ctx.ease)
                    }
                })
                // A cut is over the bars, so it comes when they stand.
                for (const cut of [this.cuts.at, this.cuts.after]) {
                    if (!cut || cut.target === null || cut.drawn.track.sample(ctx.t0) <= 0 || !sampleAt(cut.node, 'visible', ctx.t0)) continue
                    cut.drawn.track.step(ctx.t0, 0)
                    tweenValue(cut.drawn, 1, ctx.t0 + span * 0.6, ctx.t1, ctx.ease)
                }
            },
        }
    }

    /** Animate to new values. The scale follows unless it was fixed at creation. */
    update(values: readonly number[], options: AnimOptions = {}): Anim {
        if (this.staticCopy) this.own('update()')
        if (values.length > this.bars.length) throw new Error(`barChart: update() got ${values.length} values, and the chart has ${this.bars.length} bars. Give one value for each bar`)
        this.checkValues('update()', values)
        this.checkScale('update()', values)
        return {
            label: 'barChart.update', duration: options.duration ?? 1.1, ease: options.ease,
            schedule: (ctx) => {
                this.claimValues('update()', ctx.t0, ctx.t1, false)
                this.retarget(values, ctx)
            },
        }
    }

    /** The bars go to new values, and the scale follows unless it was fixed. The scale holds the second series too. */
    private retarget(values: readonly number[], ctx: AnimContext): void {
        const from = this.values.map((v) => v.track.sample(ctx.t0))
        const fromMax = this.maxValue.track.sample(ctx.t0), fromMin = this.minValue.track.sample(ctx.t0)
        const second = this.referenceTargets ?? []
        const toMax = this.fixedMax ?? Math.max(0, ...values, ...second), toMin = this.fixedMin ?? Math.min(0, ...values, ...second)
        tweenValue(this.maxValue, toMax, ctx.t0, ctx.t1, ctx.ease)
        tweenValue(this.minValue, toMin, ctx.t0, ctx.t1, ctx.ease)
        values.forEach((value, i) => {
            tweenValue(this.values[i]!, value, ctx.t0, ctx.t1, ctx.ease)
            const bar = this.bars[i]
            if (!bar) return
            const at = (a: number) => this.barPathAt(i, from[i]! + (value - from[i]!) * a, fromMax + (toMax - fromMax) * a, fromMin + (toMin - fromMin) * a)
            bar.track('path').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: at(1), at })
        })
    }

    private barPathAt(i: number, value: number, max: number, min: number): Path {
        const span = (max - min) || 1
        const center = (i + 0.5) * this.band
        const thick = this.band * (1 - this.gap)
        if (this.horizontal) {
            const zero = (-min / span) * this.w - this.w / 2
            return rectPath(zero, center - this.h / 2 - thick / 2, (value / span) * this.w, thick)
        }
        const zero = this.h / 2 - (-min / span) * this.h
        const length = (value / span) * this.h
        return rectPath(center - this.w / 2 - thick / 2, zero - length, thick, length)
    }

    /**
     * Bars take a state: `target`, `chosen`, `masked`, `plain`, or a state of the table of the chart. The bar
     * takes the color of the state, and the mark of the state comes beside its label. A dim state makes the
     * bar, its label and its number faint. `which` is an index, a label, or a list of them. A bar that has the
     * state does not change. `lag` makes the bars change one after another, in the order of the list.
     */
    mark(which: BarRef | readonly BarRef[], state: string, options: AnimOptions = {}): Anim {
        this.own('mark()')
        const picked = this.indexes(which, 'mark()')
        this.look(state, 'mark()')
        return {
            label: 'barChart.mark', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = windowOf(ctx, 'barChart: mark()')
                const windows = staggered(picked.length, Math.max(0, options.lag ?? 0), t0, t1)
                picked.forEach((index, order) => this.checkStateChange(index, state, windows[order]![0], 'mark()'))
                reveal(this, t0, ctx.stage)
                picked.forEach((index, order) => this.paint(index, state, windows[order]![0], windows[order]![1], ctx.ease))
            },
        }
    }

    /** Every bar goes back to `plain`. The values, the cuts and the second series stay. */
    clearStates(options: AnimOptions = {}): Anim {
        this.own('clearStates()')
        return {
            label: 'barChart.clearStates', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = windowOf(ctx, 'barChart: clearStates()')
                this.bars.forEach((_, index) => this.checkStateChange(index, 'plain', t0, 'clearStates()'))
                reveal(this, t0, ctx.stage)
                this.bars.forEach((_, index) => this.paint(index, 'plain', t0, t1, ctx.ease))
            },
        }
    }

    /**
     * Bars go to 0 and take the state `masked`, and the other bars grow by the same factor, so that the sum
     * of all bars stays what it was: a distribution stays a distribution. The share moves at one pace, so the
     * sum is the same at every frame. With `renormalize: false`, the other bars keep their values.
     */
    mask(which: BarRef | readonly BarRef[], options: AnimOptions & { renormalize?: boolean } = {}): Anim {
        this.own('mask()')
        const picked = this.indexes(which, 'mask()')
        this.look('masked', 'mask()')
        return {
            label: 'barChart.mask', duration: options.duration ?? 1.1, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = windowOf(ctx, 'barChart: mask()')
                const now = this.values.map((v) => v.track.sample(t0))
                const next = [...now]
                for (const index of picked) next[index] = 0
                if (options.renormalize !== false) {
                    const under = now.findIndex((value) => value < 0)
                    if (under >= 0) throw new Error(`barChart: mask() gives the share of the masked bars to the other bars, and the value of ${this.nameOf(under)} is ${now[under]}. A share is 0 or more. For values that are not shares, use mask(bars, { renormalize: false })`)
                    const all = now.reduce((sum, value) => sum + value, 0), rest = next.reduce((sum, value) => sum + value, 0)
                    if (all > 0 && !(rest > 0)) throw new Error('barChart: mask() leaves no bar with a value, so no bar can take the share of the masked ones. Leave one bar with a value that is more than 0, or use mask(bars, { renormalize: false })')
                    if (rest > 0) for (let i = 0; i < next.length; i++) next[i] = next[i]! * all / rest
                }
                this.checkScale('mask()', next)
                for (const index of picked) this.checkStateChange(index, 'masked', t0, 'mask()')
                this.claimValues('mask()', t0, t1, true)
                reveal(this, t0, ctx.stage)
                this.retarget(next, ctx)
                for (const index of picked) this.paint(index, 'masked', t0, t1, ctx.ease)
            },
        }
    }

    /**
     * The second series: one outline on each column, such as the values before a change, the truth beside a
     * prediction, or a teacher beside a student. With no values, the outlines take the values that the bars
     * have now, so the next `update()` shows before and after. With values, outlines that show move to them,
     * and outlines that do not show rise from the baseline. `reference(null)` takes the outlines away.
     */
    reference(values?: readonly number[] | null, options: AnimOptions = {}): Anim {
        this.own('reference()')
        if (values) {
            this.checkValues('reference()', values, this.bars.length)
            this.checkScale('reference()', values)
        }
        return {
            label: 'barChart.reference', duration: options.duration ?? (values === null ? 0.5 : values ? 1.1 : 0.5), ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = windowOf(ctx, 'barChart: reference()')
                this.claimValues('reference()', t0, t1, false)
                reveal(this, t0, ctx.stage)
                const shown = this.referenceShown.track.sample(t0) > 0
                if (values === null) {
                    if (this.referenceTargets) tweenValue(this.referenceShown, 0, t0, t1, ctx.ease)
                    this.referenceTargets = null
                } else {
                    const targets = values ? [...values] : this.values.map((v) => v.track.sample(t0))
                    this.bars.forEach((_, i) => {
                        this.outline(i, t0)
                        const value = this.outlineValues[i]!
                        // Outlines that arrive with values rise from the baseline. Outlines that hold the bars are on them at once.
                        if (!shown) value.track.step(t0, values ? 0 : targets[i]!)
                        tweenValue(value, targets[i]!, t0, t1, ctx.ease)
                    })
                    this.referenceTargets = targets
                    if (!shown) this.referenceShown.track.step(t0, 0)
                    tweenValue(this.referenceShown, 1, t0, shown || !values ? t1 : t0 + (t1 - t0) * 0.4, ctx.ease)
                }
                // A scale that follows the data holds both series, so it may change here. The bars keep their values.
                const rest = this.values.map((v) => v.track.sample(t1)), second = this.referenceTargets ?? []
                const toMax = this.fixedMax ?? Math.max(0, ...rest, ...second), toMin = this.fixedMin ?? Math.min(0, ...rest, ...second)
                if (toMax !== this.maxValue.track.sample(t1) || toMin !== this.minValue.track.sample(t1)) this.retarget(rest, ctx)
            },
        }
    }

    /**
     * A line across the bars at a value, with a label at its end: a threshold, a mean, a limit. The first call
     * draws the line. A later call moves it, and a label that is a function of the value follows it.
     * `cutAt(null)` takes the line away. `below()` gives the bars under the line.
     */
    cutAt(value: number | null, options: AnimOptions & BarCutOptions = {}): Anim {
        return this.cutTo('at', value, options)
    }

    /**
     * A line after a number of bars, between two columns, with a label at its end: the cut of a top-k rule.
     * The count is from 0 to the number of bars. The line counts columns, so it stays where it is when the
     * bars are sorted. `cutAfter(null)` takes it away. `tail()` gives the bars after the line.
     */
    cutAfter(count: number | null, options: AnimOptions & BarCutOptions = {}): Anim {
        return this.cutTo('after', count, options)
    }

    private cutTo(kind: 'at' | 'after', where: number | null, options: AnimOptions & BarCutOptions): Anim {
        const call = kind === 'at' ? 'cutAt()' : 'cutAfter()'
        this.own(call)
        if (where !== null) {
            this.checkCut(kind, where, call)
            cutWords(`barChart: ${call}`, options.label, where)
            // A color that the look does not have stops the build here, and not at the first frame.
            if (options.color !== undefined) toPaint(options.color)
        }
        return {
            label: `barChart.${kind === 'at' ? 'cutAt' : 'cutAfter'}`, duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = windowOf(ctx, `barChart: ${call}`)
                reveal(this, t0, ctx.stage)
                let cut = this.cuts[kind]
                if (cut) claimCut(cut, { t0, t1 }, `barChart: ${call}`)
                if (where === null) {
                    if (!cut || cut.target === null) return
                    tweenValue(cut.drawn, 0, t0, t1, ctx.ease)
                    cut.target = null
                    return
                }
                if (!cut) {
                    cut = this.makeCut(kind, where, options, t0)
                    cut.last = { t0, t1 }
                    this.cuts = { ...this.cuts, [kind]: cut }
                }
                else if (options.label !== undefined || options.color !== undefined) {
                    // A call names what it changes. The rest of the look stays.
                    const look = cut.looks[cut.looks.length - 1]!
                    cut.looks.push({ time: t0, label: options.label ?? look.label, color: options.color ?? look.color })
                }
                const visible = sampleAt(cut.node, 'visible', t0) && cut.drawn.track.sample(t0) > 0
                if (!visible) {
                    // A line that does not show starts at its new place, and then draws.
                    reveal(cut.node, t0, ctx.stage)
                    cut.where.track.step(t0, where)
                    cut.drawn.track.step(t0, 0)
                    tweenValue(cut.drawn, 1, t0, t1, ctx.ease)
                } else {
                    tweenValue(cut.where, where, t0, t1, ctx.ease)
                    if (cut.drawn.track.sample(t0) < 1) tweenValue(cut.drawn, 1, t0, t1, ctx.ease)
                }
                cut.target = where
            },
        }
    }

    /**
     * The bars move to a new order of the columns, in steps that a viewer can follow. In each step one bar
     * goes to its new column, in front of the others, and the bars that it passes move one column on, so no
     * two bars stand in one column. The steps play one after another and share the time. `'descending'`
     * puts the largest value first, and `'ascending'` the smallest. A list names the bars in their new
     * order. The order is by the values at the end of the sort: in one play, name an `update()` before the
     * `sort()`. A bar keeps its index, so `chart.bar(2)` is the same bar after it, with its label, its number,
     * its mark and its outline.
     */
    sort(order: 'descending' | 'ascending' | readonly BarRef[] = 'descending', options: AnimOptions = {}): Anim {
        this.own('sort()')
        let given: number[] | null = null
        if (typeof order !== 'string') {
            if (!Array.isArray(order)) throw new Error('barChart: sort() takes \'descending\', \'ascending\', or a list of the bars in their new order')
            given = (order as readonly BarRef[]).map((which) => this.index(which, 'sort()'))
            const twice = given.find((index, at) => given!.indexOf(index) !== at)
            if (twice !== undefined) throw new Error(`barChart: sort() names ${this.nameOf(twice)} two times. Name each bar one time`)
            if (given.length !== this.bars.length) throw new Error(`barChart: sort() names ${given.length} bars, and the chart has ${this.bars.length}. Name each bar one time, in the new order`)
        } else if (order !== 'descending' && order !== 'ascending') {
            throw new Error(`barChart: sort() got ${JSON.stringify(order)}. It takes 'descending', 'ascending', or a list of the bars in their new order`)
        }
        return {
            label: 'barChart.sort', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = windowOf(ctx, 'barChart: sort()')
                const last = this.lastSort
                if (last && t0 < last.t1 - SOON) throw new Error(`barChart: sort() plays from ${seconds(t0)} to ${seconds(t1)}, and the sort before it plays from ${seconds(last.t0)} to ${seconds(last.t1)}. A bar has one way to its column, so a sort starts when the sort before it is over. Play the two in a \`seq\`, or give one sort the last order`)
                this.lastSort = { t0, t1 }
                reveal(this, t0, ctx.stage)
                const final = this.values.map((v) => v.track.sample(t1))
                const sign = order === 'ascending' ? 1 : -1
                // Bars with one value keep the order that they have.
                const next = given ?? this.bars.map((_, index) => index).sort((a, b) => sign * (final[a]! - final[b]!) || this.slots[a]! - this.slots[b]!)
                // The steps: from the first column on, the bar of a column comes from further on, and the bars between make room.
                const now = this.order
                const steps: { mover: number; to: number; passed: number[] }[] = []
                next.forEach((index, slot) => {
                    const from = now.indexOf(index)
                    if (from === slot) return
                    steps.push({ mover: index, to: slot, passed: now.slice(slot, from) })
                    now.splice(from, 1)
                    now.splice(slot, 0, index)
                })
                steps.forEach((step, turn) => {
                    const start = t0 + (t1 - t0) * turn / steps.length, end = t0 + (t1 - t0) * (turn + 1) / steps.length
                    this.travel(step.mover, step.to, start, end, ctx.ease, true)
                    for (const index of step.passed) this.travel(index, this.slots[index]! + 1, start, end, ctx.ease, false)
                })
            },
        }
    }

    /** A bar goes to a column, with all that belongs to it. A bar that passes others is in front of them while it moves. */
    private travel(index: number, slot: number, t0: number, t1: number, ease: Ease, front: boolean): void {
        const axis = this.horizontal ? 'y' : 'x'
        const before = this.slots[index]!
        for (const node of [this.bars[index], this.labels[index], this.readouts[index], this.carriers[index]]) {
            if (!node) continue
            node.tween(axis, sampleAt(node, axis, t0) + (slot - before) * this.band, t0, t1, ease)
            if (front && t1 > t0) {
                const z = sampleAt(node, 'z', t0)
                stepAt(node, 'z', z + 1, t0)
                stepAt(node, 'z', z, t1)
            }
        }
        if (front && t1 > t0 && this.backing !== null) {
            const patch = this.patch(before, this.backing)
            patch.base.z = 0.5
            this.addAt(this, patch, t0)
            patch.tween(axis, (slot - before) * this.band, t0, t1, ease)
            // The patch is there while the bar is over others, and not at the two ends, where it is alone in its column.
            const edge = (t1 - t0) * 0.15
            stepAt(patch, 'opacity', 0, t0)
            patch.tween('opacity', 1, t0, t0 + edge, null)
            patch.tween('opacity', 0, t1 - edge, t1, null)
            stepAt(patch, 'visible', false, t1)
        }
        this.moves[index]!.push({ t0, t1, ease, from: (before - index) * this.band, to: (slot - index) * this.band })
        this.slots[index] = slot
    }

    // ── Parts ─────────────────────────────────────────────────────────────

    /** A place on the chart: a distance along the row of the columns, in bands, and a value. It follows the scale. */
    private spot(bands: number, value: number): [number, number] {
        const span = (this.maxValue.value - this.minValue.value) || 1
        const across = bands * this.band
        if (this.horizontal) return [(-this.minValue.value / span) * this.w - this.w / 2 + (value / span) * this.w, across - this.h / 2]
        return [across - this.w / 2, this.h / 2 - (-this.minValue.value / span) * this.h - (value / span) * this.h]
    }

    /** Add a part at a time of the film: on the stage, a node that is added shows from the time of the clock. */
    private addAt(parent: Node, part: Node, time: number | null): void {
        const saved = clock.now
        if (time !== null) clock.now = time
        parent.add(part)
        clock.now = saved
    }

    /** The lines of the scale behind the bars, each with its value: at the left of a chart of columns, and under a chart of rows. */
    private makeScale(ticks: number | readonly number[], format?: (value: number) => string): Node {
        const min = this.minValue.value, max = this.maxValue.value, size = this.labelSize
        if (!(max > min)) throw new Error(`barChart: the scale goes from ${min} to ${max}, so it has no room for ticks. Give a \`max\` that is over \`min\``)
        let values: readonly number[], step: number | undefined
        if (typeof ticks === 'number') {
            if (!Number.isInteger(ticks) || ticks < 1) throw new Error(`barChart: ticks is ${ticks}. It is about how many values to mark, a whole number that is 1 or more, or the list of the values`)
            ;({ ticks: values, step } = niceTicks(min, max, ticks))
        } else {
            if (!Array.isArray(ticks)) throw new Error('barChart: ticks is about how many values to mark, or the list of the values, such as [0, 0.5, 1]')
            values = ticks
            const bad = values.find((value) => typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
            if (bad !== undefined) throw new Error(`barChart: the tick ${String(bad)} is not on the scale, which goes from ${min} to ${max}. Give values of the scale`)
        }
        const made = new Node()
        for (const value of values) {
            const [x, y] = this.spot(0, value)
            this.tickPlaces.push(this.horizontal ? x : y)
            const words = small(format ? format(value) : formatNumber(value, step), size, 'dim', this.font)
            if (this.horizontal) made.add(line([x, -this.h / 2], [x, this.h / 2], { stroke: 'grid', width: 1.25 }), words.at(x, this.h / 2 + 12 + size * 0.6))
            else made.add(line([-this.w / 2, y], [this.w / 2, y], { stroke: 'grid', width: 1.25 }), words.at(-this.w / 2 - 12 - words.width / 2, y))
        }
        return made
    }

    /**
     * A patch in the color behind the chart, as large as one column with its label, its number and its mark.
     * A bar that passes others in a sort has it under it. It holds the part of the baseline and of the lines
     * of the scale that it covers, so they do not break.
     */
    private patch(slot: number, color: ColorInput): Node {
        const size = this.labelSize, room = 4
        const from = slot * this.band - (this.horizontal ? this.h : this.w) / 2, to = from + this.band
        const marks = this.holders.some(Boolean) ? size * (0.45 + MARK * 2) : 0
        const made = new Node()
        const ruler = this.baseline.get('stroke') ?? toPaint('faint'), weight = this.baseline.get('strokeWidth')
        if (this.horizontal) {
            const left = Math.min(...this.homes.map(([x], index) => x - this.labelWidths()[index]! / 2)) - marks - room
            const numbers = this.showValues ? 12 + Math.max(...[this.maxValue.value, this.minValue.value].map((value) => small(this.format(value), size, 'ink', 'mono').width)) : 0
            made.add(new Node(rectPath(left, from, this.w / 2 + numbers + room - left, to - from)).fill(color))
            for (const x of this.tickPlaces) made.add(line([x, from], [x, to], { stroke: 'grid', width: 1.25 }))
            made.add(line([this.feet[0]![0], from], [this.feet[0]![0], to], { stroke: ruler, width: weight }))
        } else {
            const top = -this.h / 2 - (this.showValues ? 10 + size * 1.15 : 0) - room
            const bottom = Math.max(...this.homes.map(([, y]) => y)) + size * 0.6 + (marks ? size * (0.6 + MARK * 2) : 0) + room
            made.add(new Node(rectPath(from, top, to - from, bottom - top)).fill(color))
            for (const y of this.tickPlaces) made.add(line([from, y], [to, y], { stroke: 'grid', width: 1.25 }))
            made.add(line([from, this.feet[0]![1]], [to, this.feet[0]![1]], { stroke: ruler, width: weight }))
        }
        return made
    }

    /** The shift of a bar from the column of its index at a time, along the row of the columns. */
    private shiftAt(index: number, time: number): number {
        let shift = 0
        for (const move of this.moves[index]!) {
            if (move.t0 > time) break
            shift = time >= move.t1 ? move.to : move.from + (move.to - move.from) * move.ease((time - move.t0) / (move.t1 - move.t0))
        }
        return shift
    }

    /**
     * What a bar gets beside its label and its number, as one node that moves with the bar. A bar gets it at
     * the first change that needs it, at the time of that change, so a film that never uses a state, a second
     * series or a sort has the same nodes as before. A carrier that comes while its bar moves joins the move.
     */
    private carrier(index: number, time: number | null): Node {
        const found = this.carriers[index]
        if (found) return found
        const made = this.carriers[index] = new Node()
        const axis = this.horizontal ? 'y' : 'x'
        made.base[axis] = time === null ? 0 : this.shiftAt(index, time)
        this.addAt(this, made, time)
        if (time !== null) {
            for (const move of this.moves[index]!) {
                if (move.t1 <= time) continue
                if (move.t0 >= time) made.track(axis).add({ t0: move.t0, t1: move.t1, ease: move.ease, to: move.to, at: (a) => move.from + (move.to - move.from) * a })
                else made.track(axis).add({ t0: time, t1: move.t1, ease: null, to: move.to, at: (a) => move.from + (move.to - move.from) * move.ease((time + a * (move.t1 - time) - move.t0) / (move.t1 - move.t0)) })
            }
        }
        return made
    }

    /** The width of each label, in the pixels of the chart. A label in the chart measures in the pixels of the stage. */
    private labelWidths(): number[] {
        return this.widths ??= this.names.map((name) => small(name, this.labelSize, 'dim', this.font).width)
    }

    /** The node that holds the mark of the state of a bar, beside its label. It has the room of a mark with no mark in it. */
    private holder(index: number, time: number | null): Node {
        const found = this.holders[index]
        if (found) return found
        const size = this.labelSize, r = size * MARK
        const [x, y] = this.homes[index]!
        const made = this.holders[index] = new Node()
        // In a horizontal chart the marks are in one column, at the left of the longest label.
        if (this.horizontal) made.at(this.feet[index]![0] - 12 - Math.max(...this.labelWidths()) - size * 0.45 - r, y)
        else made.at(x, y + size * 1.2)
        // The room of a mark, with no paint: the layout measures a hidden part, and nothing draws it.
        made.add(new Node(rectPath(-r, -r, r * 2, r * 2)).hide())
        this.addAt(this.carrier(index, time), made, time)
        return made
    }

    /** The outline of the second series on a bar. It reads the scale at each frame, so it follows an update. */
    private outline(index: number, time: number | null): Node {
        const found = this.outlines[index]
        if (found) return found
        const width = Math.max(2.5, this.labelSize * 0.1)
        const made = this.outlines[index] = dynamic(() => {
            const shown = this.referenceShown.value
            if (shown <= 0) return null
            const path = this.barPathAt(index, this.outlineValues[index]!.value, this.maxValue.value, this.minValue.value)
            return new Node(path).stroke(this.referenceColor, width, shown)
        })
        this.addAt(this.carrier(index, time), made, time)
        return made
    }

    private checkStateChange(index: number, state: string, t0: number, call: string): void {
        const last = this.changed[index]
        if (last && t0 < last.t0 - SOON) throw new Error(`barChart: ${call} changes the state of ${this.nameOf(index)} at ${seconds(t0)}, and the film named a change of the same bar at ${seconds(last.t0)} before it. Name changes in chronological order.`)
        if (this.stateOf[index] === state) return
        if (last && t0 < last.t1 - SOON) throw new Error(`barChart: ${call} changes the state of ${this.nameOf(index)} before its previous change ends. Play changes to the same bar in a seq.`)
    }

    /** A bar takes the look of a state. A mark of another shape comes in as the old one goes. */
    private paint(index: number, state: string, t0: number, t1: number, ease: Ease): void {
        const from = this.stateOf[index]!
        if (from === state) return
        this.changed[index] = { t0, t1 }
        this.stateOf[index] = state
        const was = this.looks.get(from)!, look = this.looks.get(state)!
        const bar = this.bars[index]!
        bar.tween('fill', look.paint ?? toPaint(this.colors[index]!), t0, t1, ease)
        if (look.dim !== was.dim) bar.tween('fillOpacity', look.dim ? DIM_FILL : BAR_FILL, t0, t1, ease)
        // The label is bright in a state with a mark, and faint in a dim state.
        const words = toPaint(look.dim ? 'faint' : look.mark ? 'ink' : 'dim')
        for (const glyph of this.labels[index]!.children) if (glyph.get('fill')) glyph.tween('fill', words, t0, t1, ease)
        if (look.dim !== was.dim && this.readouts[index]) tweenValue(this.fades[index] ??= new Value(1), look.dim ? DIM_TEXT : 1, t0, t1, ease)
        const holder = this.holder(index, t0)
        const color = look.paint ?? toPaint(look.dim ? 'dim' : 'ink')
        const tint = (made: Node, time: number | null) => {
            for (const leaf of made.leaves()) {
                const prop = leaf.get('fill') ? 'fill' : 'stroke'
                if (time === null) leaf.tween(prop, color, t0, t1, ease)
                else stepAt(leaf, prop, color, time)
            }
        }
        const old = holder.children.find((child) => child.data['shape'] === was.mark)
        if (look.mark === was.mark) {
            if (old) tint(old, null)
            return
        }
        if (old) {
            old.tween('opacity', 0, t0, t1, ease)
            stepAt(old, 'visible', false, t1)
        }
        if (look.mark === null) return
        let next = holder.children.find((child) => child.data['shape'] === look.mark)
        if (!next) {
            next = stateMark(look.mark, this.labelSize * MARK, Math.max(2, this.labelSize * 0.11), color)
            next.base.visible = false
            this.addAt(holder, next, t0)
        }
        tint(next, t0)
        stepAt(next, 'opacity', 0, t0)
        stepAt(next, 'visible', true, t0)
        next.tween('opacity', 1, t0, t1, ease)
    }

    /** The two ends of the line of a cut, and the place of its label. */
    private cutPlace(kind: 'at' | 'after', where: number): { from: [number, number]; to: [number, number]; label: [number, number]; anchor: 'left' | 'center' } {
        const size = this.labelSize, w = this.w, h = this.h
        const over = size * 0.3
        // The line of a value runs across the columns, and the line of a rank runs along them.
        if ((kind === 'at') !== this.horizontal) {
            if (this.horizontal) {
                // The numbers of the bars are after the plot, so the label of a line between two tight rows is after them.
                const numbers = this.showValues && this.band < size * 2.6 ? 12 + Math.max(...[this.maxValue.value, this.minValue.value].map((value) => small(this.format(value), size, 'ink', 'mono').width)) : 0
                const y = where * this.band - h / 2
                return { from: [-w / 2, y], to: [w / 2 + over + numbers, y], label: [w / 2 + over + numbers + size * 0.4, y], anchor: 'left' }
            }
            const y = this.spot(0, where)[1]
            return { from: [-w / 2, y], to: [w / 2 + over, y], label: [w / 2 + over + size * 0.4, y], anchor: 'left' }
        }
        // The numbers of the bars are over the plot, so the label of a line between two columns is over them.
        const top = -h / 2 - (!this.horizontal && this.showValues ? 10 + size * 1.25 : over)
        const x = this.horizontal ? this.spot(0, where)[0] : where * this.band - w / 2
        return { from: [x, h / 2], to: [x, top], label: [x, top - size * 0.85], anchor: 'center' }
    }

    /** The line and the label of a cut. With a time, the cut is made at that time and its line is not drawn yet. */
    private makeCut(kind: 'at' | 'after', where: number, options: BarCutOptions, time: number | null): Cut {
        const size = this.labelSize
        const what = `barChart: ${kind === 'at' ? 'cutAt' : 'cutAfter'}`
        const cut: Cut = { node: new Node(), where: new Value(where), drawn: new Value(time === null ? 1 : 0), looks: [{ time: -Infinity, label: options.label, color: options.color ?? 'ink' }], target: where }
        const lookAt = (now: number) => {
            let look = cut.looks[0]!
            for (const entry of cut.looks) if (entry.time <= now) look = entry
            return look
        }
        const stroke = dynamic((now) => {
            const drawn = cut.drawn.value
            if (drawn <= 0) return null
            const { from, to } = this.cutPlace(kind, cut.where.value)
            return line(from, [from[0] + (to[0] - from[0]) * drawn, from[1] + (to[1] - from[1]) * drawn], { stroke: lookAt(now).color, width: Math.max(2.5, size * 0.1), dash: [size * 0.4, size * 0.3] })
        })
        const words = dynamic((now) => {
            // The label comes when the line reaches its end.
            const shown = Math.min(1, Math.max(0, (cut.drawn.value - 0.6) / 0.4))
            if (shown <= 0) return null
            const look = lookAt(now), value = cut.where.value
            const content = cutWords(what, look.label, kind === 'after' ? Math.round(value) : value)
            if (content === null) return null
            const { label: at, anchor } = this.cutPlace(kind, value)
            return text(content, { size, color: look.color, font: this.font, anchor }).at(at).opacity(shown)
        })
        cut.node.add(stroke, words)
        if (time !== null) cut.node.base.visible = false
        this.addAt(this, cut.node, time)
        ownLabels(this, { labels: [words] })
        if (kind === 'at') this.valueCut = cut.node
        else this.rankCut = cut.node
        return cut
    }

    // ── Checks ────────────────────────────────────────────────────────────

    /**
     * Keep the shipped behavior of plain charts. Once a chart uses the new parts, copy its current picture,
     * including dynamic numbers and cuts, so a change on the source cannot move a line on the copy.
     */
    protected override [rebindCloneParts](copy: this, copies: ReadonlyMap<Node, Node>): void {
        copy.isCopy = true
        copy.slots = [...this.slots]
        copy.stateOf = [...this.stateOf]
        copy.staticCopy = Boolean(this.ticks || this.cuts.at || this.cuts.after || this.lastSort || this.carriers.some(Boolean))
        if (!copy.staticCopy) return
        for (const part of [...this.readouts, ...this.outlines]) snapshotDrawing(part, copies)
        copy.cuts = { at: snapshotCut(this.cuts.at, copies), after: snapshotCut(this.cuts.after, copies) }
        Object.assign(copy, {
            values: this.values.map((value) => new Value(value.value)),
            maxValue: new Value(this.maxValue.value),
            minValue: new Value(this.minValue.value),
        })
    }

    private own(call: string): void {
        if (this.isCopy) throw new Error(`barChart: ${call} is called on a copy of a chart. Build a second chart from the data to animate it independently.`)
    }

    private nameOf(index: number): string {
        return `bar ${index} (${JSON.stringify(this.names[index])})`
    }

    private index(which: BarRef, call: string): number {
        const count = this.bars.length
        if (typeof which === 'number') {
            if (Number.isInteger(which) && which >= 0 && which < count) return which
            throw new Error(`barChart: ${call}: no bar ${which}. ${count === 0 ? 'The chart has no bar' : count === 1 ? 'The chart has one bar, 0' : `The chart has ${count} bars, 0 to ${count - 1}`}`)
        }
        if (typeof which !== 'string') throw new Error(`barChart: ${call}: a bar is named by its index or by its label, and it got ${which === null ? 'null' : typeof which}`)
        const found = this.names.flatMap((name, index) => (name === which ? [index] : []))
        if (found.length === 1) return found[0]!
        if (found.length === 0) throw new Error(`barChart: ${call}: no bar has the label ${JSON.stringify(which)}. The labels are ${this.names.map((name) => JSON.stringify(name)).join(', ')}`)
        throw new Error(`barChart: ${call}: ${found.length} bars have the label ${JSON.stringify(which)}. Name the bar by its index: ${found.join(', ')}`)
    }

    /** The bars that a call names, each one time, in the order of the call. */
    private indexes(which: BarRef | readonly BarRef[], call: string): number[] {
        const list = Array.isArray(which) ? which as readonly BarRef[] : [which as BarRef]
        return [...new Set(list.map((one) => this.index(one, call)))]
    }

    private look(state: string, call: string): Look {
        const look = this.looks.get(state)
        if (!look) throw new Error(`barChart: ${call}: no state ${JSON.stringify(state)}. The states are ${[...this.looks.keys()].join(', ')}${call === 'mask()' ? '. Add a state `masked` to the table, such as masked: { mark: \'cross\', dim: true }' : ''}`)
        return look
    }

    /** A list of finite numbers. With `count`, it has one number for each bar. */
    private checkValues(what: string, values: readonly number[], count?: number): void {
        if (!Array.isArray(values)) throw new Error(`barChart: ${what} takes a list of numbers, one for each bar`)
        if (count !== undefined && values.length !== count) throw new Error(`barChart: ${what} has ${values.length} values, and the chart has ${count} bars. Give one value for each bar`)
        const bad = values.findIndex((value) => typeof value !== 'number' || !Number.isFinite(value))
        if (bad >= 0) throw new Error(`barChart: ${what}: value ${bad} is ${String(values[bad])}. Each value is a finite number`)
    }

    /** With `ticks`, the chart draws its scale, so each value is on it. Without them, a bar may pass the end of the plot, as before. */
    private checkScale(what: string, values: readonly number[]): void {
        if (!this.ticks) return
        const min = this.fixedMin!, max = this.fixedMax!
        const room = (max - min) * 1e-9
        const bad = values.findIndex((value) => value < min - room || value > max + room)
        if (bad >= 0) throw new Error(`barChart: ${what}: the value of ${this.nameOf(bad)} is ${values[bad]}, and the scale goes from ${min} to ${max}. Give a \`min\` and a \`max\` that hold every value. Without \`ticks\`, a bar may pass the end of the plot`)
    }

    /** A cut is on the scale, or between two columns. A line outside the plot would point at nothing. */
    private checkCut(kind: 'at' | 'after', where: number, what: string): void {
        if (kind === 'after') {
            if (!Number.isInteger(where) || where < 0 || where > this.bars.length) throw new Error(`barChart: ${what}: the count is ${where}. It is the number of bars before the line, a whole number from 0 to ${this.bars.length}`)
            return
        }
        if (typeof where !== 'number' || !Number.isFinite(where)) throw new Error(`barChart: ${what}: the value is ${String(where)}. It is a finite number of the scale`)
        if ((this.fixedMax !== undefined && where > this.fixedMax) || (this.fixedMin !== undefined && where < this.fixedMin)) {
            throw new Error(`barChart: ${what}: the value ${where} is outside the scale, which goes ${this.fixedMin !== undefined ? `from ${this.fixedMin} ` : ''}${this.fixedMax !== undefined ? `to ${this.fixedMax}` : ''}. Give a value of the scale, or a wider \`min\` and \`max\``)
        }
    }

    /**
     * Take the time of a change of the values. `mask()` computes its values from the values at its start, so
     * a change of the values at the same time would leave a picture that follows one of the two only.
     */
    private claimValues(call: string, t0: number, t1: number, strict: boolean): void {
        if (this.isCopy) return
        const protectedChange = strict || call === 'reference()'
        const change = { call, t0, t1, strict }
        // Existing films can schedule many ordinary updates. Only the new verbs can conflict with them.
        for (const last of protectedChange ? this.valueChanges : this.protectedChanges) {
            if (call === 'reference()' && last.call === call && t0 < last.t1 - SOON) throw new Error('barChart: play changes to the reference in a seq, in chronological order.')
            if (!overlaps(change, last)) continue
            if (call === 'reference()' || last.call === 'reference()') {
                if (call === 'enter()' || last.call === 'enter()') throw new Error('barChart: enter() animates the outlines. Play reference() after enter() in a seq.')
                if (this.fixedMin === undefined || this.fixedMax === undefined) throw new Error('barChart: reference() and a bar update share the automatic scale. Set both min and max for concurrent changes, or play the changes in a seq.')
                continue
            }
            if (!(strict || last.strict)) continue
            throw new Error(`barChart: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. Both set the values of the bars, so the picture would follow one of them only. Play the two in a \`seq\`, or give one \`update()\` the last values`)
        }
        this.valueChanges.push(change)
        if (protectedChange) this.protectedChanges.push(change)
    }
}

/** Bars with labels and numbers: `barChart([{ label: 'sat', value: 0.6 }, { label: 'ran', value: 0.4 }], { max: 1, labelSize: 30 })`. */
export function barChart(data: readonly BarDatum[], options: BarChartOptions = {}): BarChart {
    return new BarChart(data, options)
}

// ── Histogram ───────────────────────────────────────────────────────────────

export interface HistogramCutOptions {
    /** A name over the line, such as 'observed'. */
    label?: string
    /** The color of the line. Defaults to ink. */
    color?: ColorInput
    /**
     * The side that stays bright: the samples at or over the value, or the samples under it. The other side
     * goes faint. `'both'` leaves the bars as they are. Defaults to `'above'`.
     */
    keep?: 'above' | 'below' | 'both'
    /** How to write the count of a side, from the count and the number of samples that show. Defaults to the count. */
    count?: (count: number, total: number) => string
}

export interface HistogramOptions extends ChartOptions {
    bins?: number
    range?: readonly [number, number]
    /** Fixes the top of the scale, for a stable axis while samples arrive. */
    max?: number
    gap?: number
    /** Number of x tick labels. */
    ticks?: number
    colors?: readonly ColorInput[]
    /** A threshold from the start: a line at a value, with the count of the samples on each side. */
    cutAt?: HistogramCutOptions & { value: number }
}

interface HistogramCut {
    last?: PlayWindow
    node: Node
    where: Value
    drawn: Value
    /** The options from a time on, in the order of the calls. */
    looks: { time: number; options: HistogramCutOptions }[]
    target: number | null
}

/** How much of its color a bar keeps on the side of a threshold that is not kept. */
const FAR_SIDE = 0.3

/** The bin of each sample, or -1 for a sample outside the range. */
function binned(samples: readonly number[], bins: number, low: number, high: number): Int32Array {
    const assigned = new Int32Array(samples.length)
    samples.forEach((sample, i) => {
        const bin = Math.min(bins - 1, Math.floor(((sample - low) / ((high - low) || 1)) * bins))
        assigned[i] = sample < low || sample > high ? -1 : bin
    })
    return assigned
}

/**
 * A second distribution on the bins of a histogram, drawn as one outline over the bars. `histogram.outline()`
 * makes it. `fillUp()` drops its samples in, in order, as the histogram does with its own.
 */
export class HistogramOutline extends Node {
    private isCopy = false
    readonly shown: Value
    readonly total: number
    private readonly samples: readonly number[]
    private readonly assigned: Int32Array

    constructor(private readonly owner: Histogram, samples: readonly number[], options: { color?: ColorInput; width?: number } = {}) {
        super()
        this.samples = [...samples]
        this.total = samples.length
        this.assigned = binned(samples, owner.bins, owner.range[0], owner.range[1])
        this.shown = new Value(samples.length)
        const most = Math.max(0, ...this.counts(samples.length))
        if (most > owner.peak) throw new Error(`histogram: outline(): one bin of the second distribution holds ${most} samples, and the scale of the histogram ends at ${owner.peak}. Give the histogram \`max: ${most}\` or more, so that both distributions fit`)
        const color = toPaint(options.color ?? 'orange'), width = options.width ?? 4
        if (!(Number.isFinite(width) && width > 0)) throw new Error('histogram: outline(): width is the width of the outline, more than 0')
        const w = owner.chartWidth, h = owner.chartHeight
        this.add(dynamic(() => {
            const counts = this.counts()
            if (counts.every((count) => count === 0)) return null
            // One line over the tops of the bins. It goes down to the baseline at each end, and has no gaps.
            const points: Vec[] = [[-w / 2, h / 2]]
            counts.forEach((count, bin) => {
                const y = h / 2 - (count / owner.peak) * h
                points.push([-w / 2 + (bin / owner.bins) * w, y], [-w / 2 + ((bin + 1) / owner.bins) * w, y])
            })
            points.push([w / 2, h / 2])
            return new Node(polyPath(points)).stroke(color, width)
        }))
    }

    /** The samples in each bin: those that show at the time of the film, or the first `count` of them. */
    counts(count?: number): number[] {
        const n = Math.max(0, Math.min(this.total, Math.round(count ?? this.shown.value)))
        const out = new Array<number>(this.owner.bins).fill(0)
        for (let i = 0; i < n; i++) {
            const bin = this.assigned[i]!
            if (bin >= 0) out[bin]!++
        }
        return out
    }

    /** The samples that show under a value, and those at or over it, at the time of the film. A sample outside the range of the histogram does not count. */
    sides(value: number): { below: number; above: number } {
        if (!Number.isFinite(value)) throw new Error(`histogram: sides() got ${value}. A threshold is a finite number`)
        const n = Math.max(0, Math.min(this.total, Math.round(this.shown.value)))
        let below = 0, above = 0
        for (let i = 0; i < n; i++) {
            if (this.assigned[i]! < 0) continue
            if (this.samples[i]! < value) below++
            else above++
        }
        return { below, above }
    }

    protected override [rebindCloneParts](copy: this, copies: ReadonlyMap<Node, Node>): void {
        copy.isCopy = true
        Object.assign(copy, { shown: new Value(this.shown.value) })
        snapshotDrawing(this.children[0]!, copies)
    }

    /** Samples arrive in order, from none to `count` (all of them by default). */
    fillUp(options: AnimOptions & { count?: number } = {}): Anim {
        if (this.isCopy) throw new Error('histogram: fillUp() is called on a copy of an outline. Build a second outline to animate its samples.')
        const shown = this.shown
        const target = options.count ?? this.total
        if (!(Number.isFinite(target) && target >= 0 && target <= this.total)) throw new Error(`histogram: outline: fillUp() got the count ${target}. It is from 0 to ${this.total}, the number of samples`)
        return {
            label: 'histogram.outline.fill', duration: options.duration ?? 3, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                if (shown.track.keys.length === 0) shown.track.initial = 0
                tweenValue(shown, target, ctx.t0, ctx.t1, ctx.ease)
            },
        }
    }
}

/**
 * A distribution that can fill up over time. `fillUp()` drops the samples in, in order, so bars rise exactly
 * as the data accumulates. `cutAt()` draws a threshold with the count of the samples on each side, and
 * `outline()` draws a second distribution over the first.
 */
export class Histogram extends Node {
    private isCopy = false
    private staticCopy = false
    readonly shown: Value
    readonly bins: number
    readonly range: readonly [number, number]
    readonly chartWidth: number
    readonly chartHeight: number
    readonly axis = new Node()
    readonly total: number
    private readonly assigned: Int32Array
    readonly peak: number
    /** The line of the threshold, its two counts and its name, or null until the histogram has one. */
    threshold: Node | null = null
    private readonly samples: readonly number[]
    private readonly labelSize: number
    private readonly font: TextOptions['font']
    private line: HistogramCut | null = null

    constructor(samples: readonly number[], options: HistogramOptions = {}) {
        super()
        this.chartWidth = options.width ?? 900
        this.chartHeight = options.height ?? 480
        this.bins = options.bins ?? 24
        const low = options.range?.[0] ?? Math.min(...samples)
        const high = options.range?.[1] ?? Math.max(...samples)
        this.range = [low, high]
        this.total = samples.length
        this.samples = [...samples]
        this.assigned = new Int32Array(samples.length)
        const counts = new Int32Array(this.bins)
        samples.forEach((sample, i) => {
            const bin = Math.min(this.bins - 1, Math.floor(((sample - low) / ((high - low) || 1)) * this.bins))
            this.assigned[i] = sample < low || sample > high ? -1 : bin
            if (this.assigned[i]! >= 0) counts[bin]!++
        })
        this.peak = options.max ?? Math.max(1, ...counts)
        this.shown = new Value(samples.length)
        const labelSize = this.labelSize = options.labelSize ?? 20
        this.font = options.font
        const w = this.chartWidth, h = this.chartHeight
        const baseline = line([-w / 2, h / 2], [w / 2, h / 2], { stroke: options.color ?? 'faint', width: 1.5 })
        this.axis.add(baseline)
        const { ticks, step } = niceTicks(low, high, options.ticks ?? 6)
        for (const tick of ticks) {
            const x = this.xAt(tick)
            this.axis.add(line([x, h / 2], [x, h / 2 + 6], { stroke: 'faint', width: 1.5 }))
            this.axis.add(small(formatNumber(tick, step), labelSize, 'dim', options.font).at(x, h / 2 + 12 + labelSize * 0.6))
        }
        const palette = (options.colors ?? ['blue']).map((c) => solidColor(c))
        const stops = palette.map((c, i) => [palette.length === 1 ? 0 : i / (palette.length - 1), c] as const)
        const gap = options.gap ?? 0.12
        const bars = dynamic((now) => {
            const n = Math.max(0, Math.min(this.total, Math.round(this.shown.value)))
            const current = new Int32Array(this.bins)
            for (let i = 0; i < n; i++) {
                const bin = this.assigned[i]!
                if (bin >= 0) current[bin]!++
            }
            const width = w / this.bins
            const split = this.splitAt(now)
            if (split) {
                // A threshold cuts each bar where its line is. The side that is not kept goes faint.
                const out: Node[] = []
                for (let b = 0; b < this.bins; b++) {
                    const height = (current[b]! / this.peak) * h
                    if (height <= 0) continue
                    const left = -w / 2 + b * width + width * gap / 2, right = left + width * (1 - gap)
                    const color = palette.length === 1 ? palette[0]! : sampleStops(stops, b / Math.max(1, this.bins - 1))
                    const middle = Math.min(right, Math.max(left, split.x))
                    if (middle > left) out.push(new Node(rectPath(left, h / 2 - height, middle - left, height)).fill(color, split.below))
                    if (right > middle) out.push(new Node(rectPath(middle, h / 2 - height, right - middle, height)).fill(color, split.above))
                }
                return out
            }
            const rings = []
            const out: Node[] = []
            for (let b = 0; b < this.bins; b++) {
                const height = (current[b]! / this.peak) * h
                if (height <= 0) continue
                const shape = rectPath(-w / 2 + b * width + width * gap / 2, h / 2 - height, width * (1 - gap), height)
                if (palette.length === 1) rings.push(...shape)
                else out.push(new Node(shape).fill(sampleStops(stops, b / Math.max(1, this.bins - 1))))
            }
            if (rings.length) out.push(new Node(rings).fill(palette[0]!))
            return out
        })
        this.add(bars, this.axis)
        ownLabels(this, { name: 'histogram', plot: true })
        if (options.cutAt !== undefined) {
            this.checkCut(options.cutAt.value, 'the option `cutAt`', options.cutAt)
            this.line = this.makeCut(options.cutAt.value, options.cutAt, null)
        }
    }

    private xAt(value: number): number {
        const [low, high] = this.range
        return ((value - low) / ((high - low) || 1) - 0.5) * this.chartWidth
    }

    /** Local stage point for a value and a count. */
    p(value: number, count: number): [number, number] {
        return [this.xAt(value), this.chartHeight / 2 - (count / this.peak) * this.chartHeight]
    }

    /** The samples in each bin, at the time of the film. */
    counts(): number[] {
        const n = Math.max(0, Math.min(this.total, Math.round(this.shown.value)))
        const out = new Array<number>(this.bins).fill(0)
        for (let i = 0; i < n; i++) {
            const bin = this.assigned[i]!
            if (bin >= 0) out[bin]!++
        }
        return out
    }

    /**
     * The samples that show under a value, and those at or over it, at the time of the film. Without a value,
     * it is the value of the threshold. A sample outside the range of the histogram is in no bar and in no count.
     */
    sides(value?: number): { below: number; above: number } {
        const limit = value ?? visibleCut(this.line)
        if (limit === null) throw new Error('histogram: sides() needs a value, or a threshold that `cutAt()` drew')
        if (!Number.isFinite(limit)) throw new Error(`histogram: sides() got ${limit}. A threshold is a finite number`)
        return this.sidesAt(limit)
    }

    /** The value of the threshold, after the changes that are scheduled so far, or null. */
    get cut(): number | null {
        return this.line?.target ?? null
    }

    private sidesAt(limit: number): { below: number; above: number } {
        const n = Math.max(0, Math.min(this.total, Math.round(this.shown.value)))
        let below = 0, above = 0
        for (let i = 0; i < n; i++) {
            if (this.assigned[i]! < 0) continue
            if (this.samples[i]! < limit) below++
            else above++
        }
        return { below, above }
    }

    /** The look of the threshold at a time: the options of the last call that is not after it. */
    private cutLook(now: number): HistogramCutOptions {
        let look: HistogramCutOptions = {}
        for (const entry of this.line?.looks ?? []) if (entry.time <= now) look = entry.options
        return look
    }

    /** Where the threshold cuts the bars at a time, and the opacity of each side. Null when no threshold shows, or when it keeps both sides. */
    private splitAt(now: number): { x: number; below: number; above: number } | null {
        const cut = this.line
        // A threshold that the film hides until its verb leaves the bars as they are.
        if (!cut || !cut.node.get('visible')) return null
        const drawn = cut.drawn.value
        const keep = this.cutLook(now).keep ?? 'above'
        if (drawn <= 0 || keep === 'both') return null
        const far = 1 - (1 - FAR_SIDE) * drawn
        return { x: this.xAt(cut.where.value), below: keep === 'below' ? 1 : far, above: keep === 'above' ? 1 : far }
    }

    /** Samples arrive in order, from none to `count` (all of them by default). */
    fillUp(options: AnimOptions & { count?: number } = {}): Anim {
        if (this.staticCopy) this.own('fillUp()')
        const shown = this.shown
        const target = options.count ?? this.total
        return {
            label: 'histogram.fill', duration: options.duration ?? 3, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                if (shown.track.keys.length === 0) shown.track.initial = 0
                tweenValue(shown, target, ctx.t0, ctx.t1, ctx.ease)
            },
        }
    }

    /**
     * A threshold: a line at a value, with the count of the samples on each side over the plot. The count at
     * the left is of the samples under the value, and the count at the right of those at or over it. The
     * side that `keep` names stays bright, and the other side goes faint. The first call draws the line. A
     * later call moves it, and the counts follow. `cutAt(null)` takes it away. `sides()` gives the two counts.
     */
    cutAt(value: number | null, options: AnimOptions & HistogramCutOptions = {}): Anim {
        this.own('cutAt()')
        if (value !== null) this.checkCut(value, 'cutAt()', options)
        const { duration, ease, lag: _lag, ...look } = options
        return {
            label: 'histogram.cutAt', duration: duration ?? 0.8, ease,
            schedule: (ctx) => {
                const [t0, t1] = windowOf(ctx, 'histogram: cutAt()')
                reveal(this, t0, ctx.stage)
                let cut = this.line
                if (cut) claimCut(cut, { t0, t1 }, 'histogram: cutAt()')
                if (value === null) {
                    if (!cut || cut.target === null) return
                    tweenValue(cut.drawn, 0, t0, t1, ctx.ease)
                    cut.target = null
                    return
                }
                if (!cut) {
                    cut = this.line = this.makeCut(value, look, t0)
                    cut.last = { t0, t1 }
                }
                // A call names what it changes. The rest of the look stays.
                else if (Object.keys(look).length > 0) cut.looks.push({ time: t0, options: { ...this.cutLook(t0), ...look } })
                const visible = sampleAt(cut.node, 'visible', t0) && cut.drawn.track.sample(t0) > 0
                if (!visible) {
                    reveal(cut.node, t0, ctx.stage)
                    cut.where.track.step(t0, value)
                    cut.drawn.track.step(t0, 0)
                    tweenValue(cut.drawn, 1, t0, t1, ctx.ease)
                } else {
                    tweenValue(cut.where, value, t0, t1, ctx.ease)
                    if (cut.drawn.track.sample(t0) < 1) tweenValue(cut.drawn, 1, t0, t1, ctx.ease)
                }
                cut.target = value
            },
        }
    }

    private checkCut(value: number, what: string, options: HistogramCutOptions): void {
        const [low, high] = this.range
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`histogram: ${what}: the value is ${String(value)}. It is a finite number of the axis`)
        if (value < low || value > high) throw new Error(`histogram: ${what}: the value ${value} is outside the axis, which goes from ${low} to ${high}. Give a value of the axis, or a wider \`range\``)
        if (options.keep !== undefined && !['above', 'below', 'both'].includes(options.keep)) throw new Error(`histogram: ${what}: keep is ${JSON.stringify(options.keep)}. It is 'above', 'below' or 'both'`)
        if (options.label !== undefined && typeof options.label !== 'string') throw new Error(`histogram: ${what}: the label is ${typeof options.label}. It is a text, such as 'observed'`)
        // A color that the look does not have stops the build here, and not at the first frame.
        if (options.color !== undefined) toPaint(options.color)
        if (options.count !== undefined) {
            if (typeof options.count !== 'function') throw new Error(`histogram: ${what}: count is a function of the count and the total that returns a text, such as (count, total) => \`\${count} of \${total}\``)
            const words = options.count(0, this.total)
            if (typeof words !== 'string') throw new Error(`histogram: ${what}: count returned ${words === null ? 'null' : typeof words}. It returns a text, such as (count, total) => \`\${count} of \${total}\``)
        }
    }

    /** The line, the two counts and the name of the threshold. With a time, it is made at that time and its line is not drawn yet. */
    private makeCut(value: number, options: HistogramCutOptions, time: number | null): HistogramCut {
        const size = this.labelSize, h = this.chartHeight
        const cut: HistogramCut = { node: new Node(), where: new Value(value), drawn: new Value(time === null ? 1 : 0), looks: [{ time: -Infinity, options }], target: value }
        // The counts are over the plot, one at each side of the line, and the name is over the end of the line.
        const top = -h / 2 - size * 1.45
        const stroke = dynamic((now) => {
            const drawn = cut.drawn.value
            if (drawn <= 0) return null
            const x = this.xAt(cut.where.value)
            return line([x, h / 2], [x, h / 2 + (top - h / 2) * drawn], { stroke: this.cutLook(now).color ?? 'ink', width: Math.max(2.5, size * 0.1), dash: [size * 0.4, size * 0.3] })
        })
        const words = dynamic((now) => {
            const shown = Math.min(1, Math.max(0, (cut.drawn.value - 0.6) / 0.4))
            if (shown <= 0) return null
            const look = this.cutLook(now), keep = look.keep ?? 'above'
            const x = this.xAt(cut.where.value), y = -h / 2 - size * 0.75
            const { below, above } = this.sidesAt(cut.where.value)
            const write = look.count ?? ((count: number) => String(count))
            const total = below + above
            const out: Node[] = [
                text(write(below, total), { size, font: 'mono', color: keep === 'above' ? 'dim' : 'ink', anchor: 'right' }).at(x - size * 0.45, y).opacity(shown),
                text(write(above, total), { size, font: 'mono', color: keep === 'below' ? 'dim' : 'ink', anchor: 'left' }).at(x + size * 0.45, y).opacity(shown),
            ]
            if (look.label) out.push(text(look.label, { size, font: this.font, color: look.color ?? 'ink' }).at(x, top - size * 0.85).opacity(shown))
            return out
        })
        cut.node.add(stroke, words)
        const saved = clock.now
        if (time !== null) {
            cut.node.base.visible = false
            clock.now = time
        }
        this.add(cut.node)
        clock.now = saved
        ownLabels(this, { labels: [words] })
        this.threshold = cut.node
        return cut
    }

    /**
     * A histogram with a threshold or an outline keeps its current bins and counts when copied.
     * A plain histogram retains the shipped behavior of its dynamic bars.
     */
    protected override [rebindCloneParts](copy: this, copies: ReadonlyMap<Node, Node>): void {
        copy.isCopy = true
        copy.staticCopy = Boolean(this.line || this.children.some((part) => part instanceof HistogramOutline))
        if (!copy.staticCopy) return
        Object.assign(copy, { shown: new Value(this.shown.value) })
        snapshotDrawing(this.children[0]!, copies)
        copy.line = snapshotCut(this.line, copies)
    }

    private own(call: string): void {
        if (this.isCopy) throw new Error(`histogram: ${call} is called on a copy of a histogram. Build a second histogram from the samples to animate it independently.`)
    }

    /** Overlay a curve, such as the fitted density, on the same axes. f returns a count. */
    curve(f: (x: number) => number, options: { color?: ColorInput; width?: number; samples?: number } = {}): Node {
        const [low, high] = this.range
        const samples = options.samples ?? 120
        const points: Vec[] = []
        for (let i = 0; i <= samples; i++) {
            const x = low + (high - low) * i / samples
            points.push(this.p(x, f(x)))
        }
        const node = new Node(smoothPath(points)).stroke(options.color ?? 'yellow', options.width ?? 4)
        this.add(node)
        return node
    }

    /**
     * A second distribution on the same bins and the same scale, as one outline over the bars: the current
     * week over the reference week, the effect over the null. It returns the outline, which has its own
     * `fillUp()`. A bin of the second distribution that is higher than the scale is an error: give the
     * histogram a `max` that holds both.
     */
    outline(samples: readonly number[], options: { color?: ColorInput; width?: number } = {}): HistogramOutline {
        this.own('outline()')
        if (!Array.isArray(samples)) throw new Error('histogram: outline() takes the samples of the second distribution, as a list of numbers')
        const bad = samples.findIndex((sample) => typeof sample !== 'number' || !Number.isFinite(sample))
        if (bad >= 0) throw new Error(`histogram: outline(): sample ${bad} is ${String(samples[bad])}. Each sample is a finite number`)
        const node = new HistogramOutline(this, samples, options)
        this.add(node)
        return node
    }
}

/** A distribution in bins: `histogram(samples, { bins: 20, range: [0, 1], max: 40 })`. */
export function histogram(samples: readonly number[], options: HistogramOptions = {}): Histogram {
    return new Histogram(samples, options)
}

// ── Lines ───────────────────────────────────────────────────────────────────

export interface LineSeries {
    name?: string
    /** Y values at x = 0, 1, 2, ... */
    values?: readonly number[]
    points?: readonly Vec[]
    color?: ColorInput
    width?: number
    dash?: readonly number[]
    /** Soft fill under the line. */
    area?: number
    smooth?: boolean
}

export interface LineChartOptions extends ChartOptions {
    x?: readonly [number, number]
    y?: readonly [number, number]
    xLabel?: string
    yLabel?: string
    xFormat?: (x: number) => string
    yFormat?: (y: number) => string
    xTicks?: number
    yTicks?: number
}

export class LineChart extends Node {
    readonly lines: Node[] = []
    readonly areas: Node[] = []
    readonly names: Node[] = []
    readonly axis: Node
    private readonly byName = new Map<string, Node>()
    private readonly frame: XYFrame

    constructor(series: readonly LineSeries[], options: LineChartOptions = {}) {
        super()
        const resolved = series.map((entry) => entry.points ?? (entry.values ?? []).map((value, i) => [i, value] as Vec))
        const xs = resolved.flat().map((p) => p[0]), ys = resolved.flat().map((p) => p[1])
        const yLow = Math.min(...ys), yHigh = Math.max(...ys)
        const yPad = (yHigh - yLow || 1) * 0.08
        const xRange = options.x ?? [Math.min(...xs), Math.max(...xs)]
        const yRange = options.y ?? [yLow >= 0 && yLow < (yHigh - yLow) * 0.4 ? 0 : yLow - yPad, yHigh + yPad]
        const w = options.width ?? 900, h = options.height ?? 480
        this.frame = { xRange, yRange, w, h }
        const labelSize = options.labelSize ?? 18
        this.axis = xyAxes(this.frame, { labelSize, color: options.color, font: options.font, xLabel: options.xLabel, yLabel: options.yLabel, xFormat: options.xFormat, yFormat: options.yFormat, xTicks: options.xTicks, yTicks: options.yTicks })
        this.add(this.axis)
        const ends: { label: Node; y: number }[] = []
        series.forEach((entry, i) => {
            const color = entry.color ?? DEFAULT_SERIES[i % DEFAULT_SERIES.length]!
            const points = resolved[i]!.map(([x, y]) => xyPoint(this.frame, x, y) as Vec)
            if (entry.area) {
                const base = xyPoint(this.frame, xRange[0], Math.max(yRange[0], 0))[1]
                const shape = polyPath([...points, [points[points.length - 1]![0], base], [points[0]![0], base]], true)
                const area = new Node(shape).fill(color, entry.area)
                this.areas.push(area)
                this.add(area)
            }
            const path = entry.smooth === false ? polyPath(points) : smoothPath(points)
            const stroke = new Node(path).stroke(color, entry.width ?? 3.5)
            if (entry.dash) stroke.dash(entry.dash)
            this.lines.push(stroke)
            this.add(stroke)
            if (entry.name) {
                this.byName.set(entry.name, stroke)
                const label = small(entry.name, labelSize + 1, color, options.font)
                const last = points[points.length - 1]!
                ends.push({ label, y: last[1] })
                label.at(last[0] + 12 + label.width / 2, last[1])
                this.names.push(label)
                this.add(label)
            }
        })
        // Direct labels at line ends, nudged apart when lines finish close together.
        ends.sort((a, b) => a.y - b.y)
        const spacing = labelSize * 1.25
        for (let pass = 0; pass < 8; pass++) {
            for (let i = 1; i < ends.length; i++) {
                const overlap = spacing - (ends[i]!.y - ends[i - 1]!.y)
                if (overlap > 0) {
                    ends[i - 1]!.y -= overlap / 2
                    ends[i]!.y += overlap / 2
                }
            }
        }
        for (const end of ends) end.label.at(end.label.get('x'), end.y)
        ownLabels(this, { name: 'line chart', plot: true })
    }

    p(x: number, y: number): [number, number] {
        return xyPoint(this.frame, x, y)
    }

    series(name: string): Node {
        const found = this.byName.get(name)
        if (!found) throw new Error(`No series named ${JSON.stringify(name)}.`)
        return found
    }

    /** Axes fade in, lines draw left to right, and their labels arrive as each line lands. */
    enter(options: AnimOptions = {}): Anim {
        const lag = options.lag ?? 0.1
        return {
            label: 'lineChart.enter', duration: options.duration ?? 2.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                stepAt(this.axis, 'opacity', 0, ctx.t0)
                this.axis.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.3, ctx.ease)
                const windows = staggered(this.lines.length, lag, ctx.t0 + span * 0.15, ctx.t1)
                this.lines.forEach((stroke, i) => {
                    const [start, end] = windows[i]!
                    stepAt(stroke, 'trimTo', 0, ctx.t0)
                    stroke.tween('trimTo', 1, start, end, ctx.ease)
                    const name = this.names[i]
                    if (name) {
                        stepAt(name, 'opacity', 0, ctx.t0)
                        name.tween('opacity', 1, end - (end - start) * 0.2, Math.min(ctx.t1, end + span * 0.1), ctx.ease)
                    }
                })
                for (const area of this.areas) {
                    const target = area.get('fillOpacity')
                    stepAt(area, 'fillOpacity', 0, ctx.t0)
                    area.tween('fillOpacity', target, ctx.t0 + span * 0.5, ctx.t1, ctx.ease)
                }
            },
        }
    }
}

export function lineChart(series: readonly LineSeries[], options: LineChartOptions = {}): LineChart {
    return new LineChart(series, options)
}

// ── Pie and donut ───────────────────────────────────────────────────────────

export interface PieDatum {
    label: string
    value: number
    color?: ColorInput
}

export interface PieOptions {
    radius?: number
    /** Inner radius as a fraction of the outer radius. 0 makes a pie. */
    hole?: number
    /** Angular gap between wedges, in radians. */
    gap?: number
    labelSize?: number
    /** Show each share as a percentage beside its label. */
    percent?: boolean
    labels?: boolean
    centerLabel?: string
    centerSize?: number
    /** The font of the labels. Defaults to the font of the film. The center label is in the display serif. */
    font?: TextOptions['font']
}

function wedgePath(a0: number, a1: number, inner: number, outer: number): Path {
    if (a1 - a0 < 1e-4) return []
    const outerArc = arcPath(0, 0, outer, outer, a0, a1)[0]!.p
    const points: number[] = Array.from(outerArc)
    const cx = points[points.length - 2]!, cy = points[points.length - 1]!
    const hop = (x: number, y: number, tx: number, ty: number) => {
        points.push(x + (tx - x) / 3, y + (ty - y) / 3, x + (tx - x) * 2 / 3, y + (ty - y) * 2 / 3, tx, ty)
    }
    if (inner > 0.01) {
        const innerArc = arcPath(0, 0, inner, inner, a1, a0)[0]!.p
        hop(cx, cy, innerArc[0]!, innerArc[1]!)
        for (let i = 2; i < innerArc.length; i++) points.push(innerArc[i]!)
        hop(innerArc[innerArc.length - 2]!, innerArc[innerArc.length - 1]!, outerArc[0]!, outerArc[1]!)
    } else {
        hop(cx, cy, 0, 0)
        hop(0, 0, outerArc[0]!, outerArc[1]!)
    }
    return [ring(points, true)]
}

/** Share of a whole, labeled directly. `enter()` sweeps around, and `update()` re-divides it. */
export class PieChart extends Node {
    readonly wedges: Node[] = []
    readonly labels: Node[] = []
    readonly leaders: Node[] = []
    readonly centerText: Node | null = null
    private readonly shares: number[]
    private readonly inner: number
    private readonly outer: number
    private readonly gap: number

    constructor(data: readonly PieDatum[], options: PieOptions = {}) {
        super()
        this.outer = options.radius ?? 240
        this.inner = this.outer * (options.hole ?? 0)
        this.gap = options.gap ?? (this.inner > 0 ? 0.018 : 0.008)
        const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0) || 1
        this.shares = data.map((d) => Math.max(0, d.value) / total)
        const size = options.labelSize ?? 20
        const angles = this.angles(this.shares)
        data.forEach((datum, i) => {
            const color = datum.color ?? DEFAULT_SERIES[i % DEFAULT_SERIES.length]!
            const [a0, a1] = angles[i]!
            const wedge = new Node(wedgePath(a0, a1, this.inner, this.outer)).fill(color, 0.86)
            this.wedges.push(wedge)
            this.add(wedge)
        })
        if (options.labels ?? true) {
            data.forEach((datum, i) => {
                const [a0, a1] = angles[i]!
                const mid = (a0 + a1) / 2
                const cos = Math.cos(mid), sin = Math.sin(mid)
                const r0 = this.outer + 6, r1 = this.outer + 30
                const elbowX = cos * r1, elbowY = sin * r1
                const endX = elbowX + (cos >= 0 ? 18 : -18)
                const leader = new Node(polyPath([[cos * r0, sin * r0], [elbowX, elbowY], [endX, elbowY]])).stroke('faint', 1.25)
                const percent = options.percent ?? true
                const body = percent ? `${datum.label}  ${Math.round(this.shares[i]! * 100)}%` : datum.label
                const label = small(body, size, 'ink', options.font)
                label.at(endX + (cos >= 0 ? 8 + label.width / 2 : -8 - label.width / 2), elbowY)
                this.leaders.push(leader)
                this.labels.push(label)
                this.add(leader, label)
            })
        }
        if (options.centerLabel) {
            const center = text(options.centerLabel, { size: options.centerSize ?? Math.max(24, this.inner * 0.34), font: 'serif', color: 'ink' }).at(0, 0)
            ;(this as { centerText: Node | null }).centerText = center
            this.add(center)
        }
        ownLabels(this, { name: 'pie chart' })
    }

    private angles(shares: readonly number[], sweep = 1): [number, number][] {
        let cursor = -Math.PI / 2
        return shares.map((share) => {
            const span = share * Math.PI * 2 * sweep
            const gap = Math.min(this.gap * sweep, span * 0.45)
            const out: [number, number] = [cursor + gap / 2, cursor + span - gap / 2]
            cursor += span
            return out
        })
    }

    /** Wedges sweep open around the circle, then the labels arrive. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'pie.enter', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                const sweepEnd = ctx.t0 + span * 0.78
                this.wedges.forEach((wedge, i) => {
                    const at = (a: number): Path => {
                        const [x, y] = this.angles(this.shares, a)[i]!
                        return wedgePath(x, y, this.inner, this.outer)
                    }
                    wedge.track('path').step(ctx.t0, [])
                    wedge.track('path').add({ t0: ctx.t0, t1: sweepEnd, ease: ctx.ease, to: at(1), at })
                })
                for (const node of [...this.labels, ...this.leaders, ...(this.centerText ? [this.centerText] : [])]) {
                    stepAt(node, 'opacity', 0, ctx.t0)
                    node.tween('opacity', 1, ctx.t0 + span * 0.62, ctx.t1, ctx.ease)
                }
            },
        }
    }

    /** Re-divide the circle. Geometry animates, and labels follow their wedges. */
    update(values: readonly number[], options: AnimOptions = {}): Anim {
        return {
            label: 'pie.update', duration: options.duration ?? 1.1, ease: options.ease,
            schedule: (ctx) => {
                const total = values.reduce((sum, v) => sum + Math.max(0, v), 0) || 1
                const next = values.map((v) => Math.max(0, v) / total)
                const previous = [...this.shares]
                this.wedges.forEach((wedge, i) => {
                    const at = (a: number): Path => {
                        const shares = previous.map((share, k) => share + ((next[k] ?? 0) - share) * a)
                        const [x, y] = this.angles(shares)[i]!
                        return wedgePath(x, y, this.inner, this.outer)
                    }
                    wedge.track('path').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: at(1), at })
                })
                for (const node of [...this.labels, ...this.leaders]) {
                    node.tween('opacity', 0, ctx.t0, ctx.t0 + (ctx.t1 - ctx.t0) * 0.3, ctx.ease)
                }
                next.forEach((share, i) => { this.shares[i] = share })
            },
        }
    }
}

export function pie(data: readonly PieDatum[], options: PieOptions = {}): PieChart {
    return new PieChart(data, options)
}

export function donut(data: readonly PieDatum[], options: PieOptions = {}): PieChart {
    return new PieChart(data, { hole: 0.62, ...options })
}

// ── Heatmap ─────────────────────────────────────────────────────────────────

export interface HeatmapOptions {
    /** Cell edge in stage pixels. */
    cell?: number
    cellWidth?: number
    cellHeight?: number
    gap?: number
    colors?: readonly ColorInput[]
    /** Value range for the color ramp. */
    domain?: readonly [number, number]
    /** Print values in cells. */
    values?: boolean
    format?: (value: number) => string
    valueSize?: number
    rowLabels?: readonly string[]
    columnLabels?: readonly string[]
    labelSize?: number
    /** Tilt column labels so long names fit, in radians. */
    columnLabelAngle?: number
    radius?: number
    /** The font of the row and the column labels. Defaults to the font of the film. The values in the cells are in mono. */
    font?: TextOptions['font']
}

export class Heatmap extends Node {
    readonly cells: Node[][] = []
    readonly rowLabels: Node[] = []
    readonly columnLabels: Node[] = []
    readonly numbers: Node[][] = []
    readonly rowCount: number
    readonly colCount: number
    private readonly stops: readonly (readonly [number, Rgba])[]
    private readonly domain: readonly [number, number]

    constructor(values: readonly (readonly number[])[], options: HeatmapOptions = {}) {
        super()
        this.rowCount = values.length
        this.colCount = Math.max(0, ...values.map((row) => row.length))
        const w = options.cellWidth ?? options.cell ?? 44
        const h = options.cellHeight ?? options.cell ?? 44
        const gap = options.gap ?? 2
        const flat = values.flat()
        this.domain = options.domain ?? [Math.min(...flat), Math.max(...flat)]
        const palette = (options.colors ?? ['surface', 'blue', 'yellow']).map((c) => solidColor(c))
        this.stops = palette.map((c, i) => [palette.length === 1 ? 0 : i / (palette.length - 1), c] as const)
        const totalW = this.colCount * w + (this.colCount - 1) * gap
        const totalH = this.rowCount * h + (this.rowCount - 1) * gap
        const labelSize = options.labelSize ?? 16
        const valueSize = options.valueSize ?? Math.min(h * 0.38, w * 0.36)
        const format = options.format ?? ((v: number) => (Math.round(v * 100) / 100).toString())
        values.forEach((row, i) => {
            const cells: Node[] = []
            const numbers: Node[] = []
            row.forEach((value, j) => {
                const cx = -totalW / 2 + j * (w + gap) + w / 2
                const cy = -totalH / 2 + i * (h + gap) + h / 2
                const color = this.colorFor(value)
                const cell = new Node(rectPath(-w / 2, -h / 2, w, h, options.radius ?? 0)).fill(color).at(cx, cy)
                cells.push(cell)
                this.add(cell)
                if (options.values) {
                    const label = text(format(value), { size: valueSize, font: 'mono', color: luminance(color) > 0.32 ? '#101114' : '#f2efe6' }).at(cx, cy)
                    numbers.push(label)
                    this.add(label)
                }
            })
            this.cells.push(cells)
            this.numbers.push(numbers)
        })
        options.rowLabels?.forEach((name, i) => {
            const label = small(name, labelSize, 'dim', options.font)
            const y = -totalH / 2 + i * (h + gap) + h / 2
            label.at(-totalW / 2 - 10 - label.width / 2, y)
            this.rowLabels.push(label)
            this.add(label)
        })
        options.columnLabels?.forEach((name, j) => {
            const label = small(name, labelSize, 'dim', options.font)
            const x = -totalW / 2 + j * (w + gap) + w / 2
            const angle = options.columnLabelAngle ?? 0
            if (angle !== 0) {
                // Tilted labels end at their column, reading up and to the right.
                const length = label.width
                label.at(x + Math.cos(angle) * length / 2, -totalH / 2 - 12 + Math.sin(angle) * length / 2)
                label.set('rotation', angle)
            } else {
                label.at(x, -totalH / 2 - 10 - labelSize / 2)
            }
            this.columnLabels.push(label)
            this.add(label)
        })
        ownLabels(this, { name: 'heatmap' })
    }

    colorFor(value: number): Rgba {
        const [low, high] = this.domain
        return sampleStops(this.stops, Math.max(0, Math.min(1, (value - low) / ((high - low) || 1))))
    }

    cell(row: number, column: number): Node {
        const found = this.cells[row]?.[column]
        if (!found) throw new Error(`Heatmap has no cell (${row}, ${column}). It is ${this.rowCount} by ${this.colCount}.`)
        return found
    }

    row(index: number): Node[] {
        return [...(this.cells[index] ?? [])]
    }

    col(index: number): Node[] {
        return this.cells.map((row) => row[index]!).filter(Boolean)
    }

    /** Cells fade in along the diagonal. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'heatmap.enter', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                const diagonals = this.rowCount + this.colCount - 1
                const each = span * 0.5
                const stagger = diagonals > 1 ? (span - each) / (diagonals - 1) : 0
                this.cells.forEach((row, i) => row.forEach((cell, j) => {
                    const start = ctx.t0 + (i + j) * stagger
                    stepAt(cell, 'opacity', 0, ctx.t0)
                    cell.tween('opacity', 1, start, start + each, ctx.ease)
                    const number = this.numbers[i]?.[j]
                    if (number) {
                        stepAt(number, 'opacity', 0, ctx.t0)
                        number.tween('opacity', 1, start, start + each, ctx.ease)
                    }
                }))
                for (const label of [...this.rowLabels, ...this.columnLabels]) {
                    stepAt(label, 'opacity', 0, ctx.t0)
                    label.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.4, ctx.ease)
                }
            },
        }
    }

    /** Recolor every cell to new values. */
    update(values: readonly (readonly number[])[], options: AnimOptions = {}): Anim {
        return {
            label: 'heatmap.update', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                values.forEach((row, i) => row.forEach((value, j) => {
                    const cell = this.cells[i]?.[j]
                    if (cell) cell.tween('fill', this.colorFor(value), ctx.t0, ctx.t1, ctx.ease)
                }))
            },
        }
    }
}

export function heatmap(values: readonly (readonly number[])[], options: HeatmapOptions = {}): Heatmap {
    return new Heatmap(values, options)
}

