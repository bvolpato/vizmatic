import { apply, circlePath, invert, polyPath, rectPath, type Vec } from '../geometry'
import { dynamic, Node, ownLabels, rebindCloneParts } from '../node'
import { arrow, dot, line } from '../shapes'
import { tex } from '../tex'
import { text, type TextOptions } from '../text'
import { mixPaint, toPaint, type ColorInput, type Paint } from '../color'
import { Value, type Anim, type AnimContext, type AnimOptions } from '../anim'
import { clock, Track } from '../track'
import type { Box } from '../layout'
import { Part, propAt, reveal, sampleAt, solidColor, staggered, stepAt, stepsBetween, tweenValue, worldBox } from './util'

type Reactive = number | (() => number)
const read = (value: Reactive): number => typeof value === 'function' ? value() : value

/** A value with a name on a number line. The name is its identity for `move`, `snap`, `remove` and `point`. */
export interface NumberLinePoint {
    name: string
    value: number
    /**
     * The color of the dot and of the text. Without it, the dot takes the color of the band that it is in, and
     * the text is in ink. On a line with no band color, the dot is yellow.
     */
    color?: ColorInput
    /** The text over the dot. Defaults to the name. `false` draws the dot alone. */
    label?: string | false
}

/** A cut of the line that can move. It splits the line into the band under it and the band over it. */
export interface NumberLineThreshold {
    at: number
    /** A word over the threshold, before its value, such as 'cutoff'. */
    label?: string
    /** Write the value of the threshold after its label. It counts while the threshold moves. On by default. */
    readout?: boolean
    /** Defaults to ink. */
    color?: ColorInput
    /** The band of a value that is exactly at the threshold: the band over it (the default), or the band under it. */
    ties?: 'over' | 'under'
}

/** A part of the line between two thresholds, or between a threshold and an end of the line. */
export interface NumberLineBand {
    /** Written under the line, at the side of the band. */
    name?: string
    /** With a color, the band is shaded in it, and a point with no color of its own takes it. */
    color?: ColorInput
    /** Draw the points of this band as rings, not as dots: a second sign beside the color. */
    hollow?: boolean
}

export interface NumberLineOptions {
    /** The values at the two ends. Defaults to -5 to 5, or to the first and the last of `ticks`. */
    range?: readonly [number, number]
    /** On-screen length in stage pixels. For the layout, this is the width: `fitted(region, (length) => numberLine({ length }))`. */
    length?: number
    /** The distance between two ticks. Defaults to 1. Give `step` or `ticks`, not both. */
    step?: number
    /**
     * The values of the ticks, at any steps: the values that a number format can store, the levels of a
     * quantizer, the limits of a scale. `snap` takes a point to the nearest of them.
     */
    ticks?: readonly number[]
    /** Write a number under each tick. On by default. */
    labels?: boolean
    /** Write a number only under these ticks. The other ticks are shorter. */
    tickLabels?: readonly number[]
    /** Text size of the numbers under the ticks. Defaults to 6/7 of `size`: 24. */
    labelSize?: number
    /**
     * How to write a value: under a tick, at a threshold, in a bracket. With it, the numbers under the ticks
     * are plain text in the font of the film, such as `(value) => `${value} ms``. Without it, they are math.
     */
    format?: (value: number) => string
    color?: ColorInput
    tips?: boolean
    /** The width of the line and of the ticks, in pixels. */
    width?: number
    /** Text size of the names of the points, the thresholds and the bands, and of a bracket. Defaults to 28. */
    size?: number
    /** The font of those texts. Defaults to the font of the film. */
    font?: TextOptions['font']
    /** Values with a name, as dots on the line. `move`, `snap`, `insert` and `remove` change them. */
    points?: readonly NumberLinePoint[]
    /** Cuts of the line, from the smallest to the largest: a value, or `{ at, label }`. `moveThreshold` moves one. */
    thresholds?: readonly (number | NumberLineThreshold)[]
    /** One band for each part that the thresholds leave, from left to right: a name, or `{ name, color, hollow }`. */
    bands?: readonly (string | NumberLineBand)[]
    /** Write the number of points of each band after its name. */
    counts?: boolean
    /** How many heights the names of the points may take over the line. The line uses as few as the names need. Defaults to 2. */
    levels?: number
}

export interface NumberLineBracketOptions {
    /** The text at the bracket: a fixed text, or a function of the gap. Defaults to the gap, as `format` writes it. */
    label?: string | ((gap: number, from: number, to: number) => string)
    /** Under the line (the default), or over the names of the points. */
    side?: 'under' | 'over'
    /** Defaults to ink. */
    color?: ColorInput
    /** Move the bracket away from the line by this many pixels, for a second bracket. */
    offset?: number
}

/** A point as a function of `find` sees it. */
export interface NumberLinePointView {
    readonly name: string
    readonly value: number
    /** The index of the band that the point is in: 0 on a line with no threshold. */
    readonly band: number
}

type Align = 'center' | 'right' | 'left'
type BracketEnd = number | { pointId: number }

interface Slot {
    level: number
    align: Align
}

interface Crossing {
    before: number
    now: number
    share: number
}

interface PointEntry {
    /** A number of its own. The name of a point that left can come back as another point. */
    id: number
    name: string
    /** The value after the changes that are scheduled so far. */
    value: number
    /** The value at each time. */
    at: Value
    /** True from the time at which the point counts, to the time at which it starts to leave. */
    alive: Track<boolean>
    color: ColorInput | undefined
    /** The dot and the text, at the x of the value. */
    node: Node
    label: Node | null
    /** The width of the ink of the label. */
    width: number
    slot: Slot | null
    /** Earlier traces are needed when a film copies the line at an earlier time. */
    traces: Node[]
    /** A static copy can catch a dot halfway through a change of color or size. */
    snapshot: { crossing: Crossing; traveling: boolean; resume: number } | null
    /** False from the time that a `remove` is scheduled. */
    here: boolean
    last: { call: string; t0: number; t1: number } | null
}

interface ThresholdEntry {
    value: number
    at: Value
    label: string | undefined
    readout: boolean
    color: ColorInput
    ties: 'over' | 'under'
    node: Node
    last: { call: string; t0: number; t1: number } | null
}

/** Seconds for a point to take the look of the band that it enters. The dot swells and comes back in that time. */
const CROSS = 0.35
/** Two changes of one part may meet at one time, to this many seconds. */
const SOON = 1e-6
/** The most ticks of a line. A step that is far too small for the range would build this many lines and more. */
const MOST_TICKS = 2000
/** The most places that the search for the names of the points may try with one number of heights. */
const SEARCH = 40000
/** The opacity of the shade of a band. Text in ink and in dim reads on it in a dark look and in a light one. */
const SHADE = 0.13

const seconds = (time: number): string => `${Math.round(time * 1000) / 1000} s`
/** A value as the film wrote it, for an error. */
const written = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : typeof value === 'object' && value !== null ? 'an object' : String(value))
const decimalsOf = (value: number): number => [0, 1, 2, 3].find((digits) => Math.abs(value * 10 ** digits - Math.round(value * 10 ** digits)) < 1e-9) ?? 3

/**
 * One axis with ticks and numbers. The ticks are at equal steps, or at the values of a list. On the line: points
 * with a name that move and snap to the nearest tick, thresholds that move, bands that the thresholds bound,
 * with a shade, a name and a count, and a bracket for the gap between two values. A point takes the look of
 * the band that it is in, at the moment that it crosses a threshold or that a threshold passes it.
 * `.at()` places the middle of the line.
 */
export class NumberLine extends Node {
    readonly range: readonly [number, number]
    readonly length: number
    readonly line: Node
    readonly ticks = new Node()
    readonly numbers = new Node()
    /** The values of the ticks, from the smallest to the largest. `snap` takes a point to one of them. */
    readonly tickValues: readonly number[]
    /**
     * The room of the line with the names of its points, its thresholds and its bands, in the coordinates of
     * the object: the middle of the line is at (0, 0). Null on a line with no points, thresholds or bands.
     */
    readonly extent: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number } | null = null
    /** The node of each point that the line has had, in the order in which they came: a dot and its text. */
    readonly pointNodes: Node[] = []
    /** The text of each point, or null for a point with none. */
    readonly pointLabels: (Node | null)[] = []
    /** The node of each threshold: its line and its label. */
    readonly thresholdNodes: Node[] = []
    /** The ticks and the numbers, and the x of each one, for `enter()`. Two lists, so a copy of the object gets its own nodes. */
    private readonly marks: Node[] = []
    private readonly markXs: number[] = []
    private entries: PointEntry[] = []
    private cuts: ThresholdEntry[] = []
    private readonly bands: NumberLineBand[] = []
    private readonly counts: boolean
    private readonly size: number
    private readonly font: TextOptions['font']
    private readonly readoutFormat: Intl.NumberFormat | ((value: number) => string)
    private readonly levels: number
    private readonly radius: number
    /** The y of the middle of the numbers under the ticks, and the y under them. */
    private readonly numbersBottom: number
    /** The names of the points that an `insert` made and that the film did not play yet. */
    private pending = new Set<string>()
    private serial = 0
    /** The shade of the bands, under the line. Null on a line with no band. */
    private readonly shade: Node | null = null
    private readonly captions: Node | null = null
    private traces = new Node()
    private thresholdLayer = new Node()
    /**
     * A patch behind each name that the line of a threshold passes, in the color that a viewer sees behind the
     * name. It is over the thresholds and under the points: the line passes behind a name, not through it.
     */
    private readonly patches: Node | null = null
    private pointLayer = new Node()

    constructor(options: NumberLineOptions = {}) {
        super()
        const listed = options.ticks !== undefined
        if (listed && options.step !== undefined) throw new Error('numberLine: give `step` for ticks at equal steps, or `ticks` for a list of values, not both')
        if (listed) {
            if (!Array.isArray(options.ticks) || options.ticks.length === 0) throw new Error('numberLine: ticks is a list of values, such as [0, 0.25, 0.5, 1, 2, 4]. Give it at least one value')
            const stray = options.ticks.find((tick) => typeof tick !== 'number' || !Number.isFinite(tick))
            if (stray !== undefined) throw new Error(`numberLine: the tick ${written(stray)} is not a number`)
            const twice = options.ticks.find((tick, index) => options.ticks!.indexOf(tick) !== index)
            if (twice !== undefined) throw new Error(`numberLine: the tick ${twice} is in the list two times. Give each value one time`)
        }
        const sorted = listed ? [...options.ticks!].sort((a, b) => a - b) : []
        this.range = options.range ?? (sorted.length > 1 ? [sorted[0]!, sorted[sorted.length - 1]!] : [-5, 5])
        const [min, max] = this.range
        if (!(Number.isFinite(min) && Number.isFinite(max) && max > min)) throw new Error(`numberLine: the range is ${written(min)} to ${written(max)}. Give two different values, the smaller one first`)
        this.length = options.length ?? 1200
        if (!(Number.isFinite(this.length) && this.length > 0)) throw new Error('numberLine: length is the length of the line in pixels, more than 0')
        const step = options.step ?? 1
        if (!(Number.isFinite(step) && step > 0)) throw new Error(`numberLine: step is ${written(step)}. A step is the distance between two ticks, more than 0`)
        const extendedGrid = options.points !== undefined || options.thresholds !== undefined || options.bands !== undefined || options.tickLabels !== undefined || options.levels !== undefined || options.format !== undefined
        if (!listed && extendedGrid && (max - min) / step > MOST_TICKS) throw new Error(`numberLine: a step of ${step} gives ${Math.round((max - min) / step)} ticks from ${min} to ${max}. Give a larger step, or the \`ticks\` to draw`)
        const outside = sorted.find((tick) => tick < min || tick > max)
        if (outside !== undefined) throw new Error(`numberLine: the tick ${outside} is outside the line, which goes from ${min} to ${max}. Give a range that holds it`)
        this.size = options.size ?? 28
        if (!(Number.isFinite(this.size) && this.size > 0)) throw new Error('numberLine: size is a text size, more than 0')
        const numberSize = options.labelSize ?? Math.round(this.size * 6 / 7)
        if (!(Number.isFinite(numberSize) && numberSize > 0)) throw new Error('numberLine: labelSize is the text size of the numbers, more than 0')
        this.font = options.font
        this.levels = options.levels ?? 2
        if (!Number.isInteger(this.levels) || this.levels < 1) throw new Error('numberLine: levels is the number of heights for the names of the points, a whole number of 1 or more')
        this.counts = options.counts === true
        this.radius = Math.max(9, Math.round(this.size * 0.3))

        const color = options.color ?? 'dim'
        const width = options.width ?? 2
        const half = this.length / 2
        const tips = options.tips ?? true
        this.line = tips
            ? arrow([-half - 36, 0], [half + 36, 0], { stroke: color, width, tip: 14, both: true })
            : line([-half, 0], [half, 0], { stroke: color, width })
        this.tickValues = listed ? sorted : stepsBetween(min, max, step)
        const labels = options.labels ?? true
        if (typeof labels !== 'boolean') throw new Error('numberLine: labels is true or false. Use tickLabels to select which ticks get a number')
        const named = new Set<number>()
        if (options.tickLabels !== undefined) {
            if (!Array.isArray(options.tickLabels)) throw new Error('numberLine: tickLabels is a list of the ticks that get a number')
            if (!labels) throw new Error('numberLine: labels: false hides every number. Omit it to show the numbers selected by tickLabels')
            for (const value of options.tickLabels) {
                // A step of 0.1 can produce 0.30000000000000004 when the film names 0.3.
                const tick = this.tickValues.includes(value) ? value : this.tickValues.find((candidate) => Number.isFinite(value) && Math.abs(candidate - value) <= Number.EPSILON * Math.abs(candidate) * 2)
                if (tick === undefined) throw new Error(`numberLine: tickLabels names ${written(value)}, which is not a tick of the line. Name a tick, or add the value to \`ticks\``)
                named.add(tick)
            }
        }
        const numbered = (value: number): boolean => labels && (options.tickLabels === undefined || named.has(value))
        // Large numbers stand a little lower, so they keep their room under the ticks. A line that gives
        // `labelSize` alone keeps the place that its numbers always had.
        const numberY = options.format || options.size !== undefined ? Math.max(34, 7 + numberSize * 0.72) : 34
        const stamps: { value: number; node: Node; x: number }[] = []
        for (const value of this.tickValues) {
            const [x] = this.p(value)
            // With a list of the ticks to name, a tick with no number is shorter, so the named ones lead the eye.
            const tall = options.tickLabels === undefined || numbered(value) ? 7 : 4
            const tick = line([x, -tall], [x, tall], { stroke: color, width })
            this.ticks.add(tick)
            this.marks.push(tick)
            this.markXs.push(x)
            if (numbered(value)) {
                let label: Node
                if (options.format) {
                    label = text(String(options.format(value)), { size: numberSize, color: 'dim', font: this.font })
                } else {
                    label = tex(String(Math.round(value * 1000) / 1000), { size: numberSize, color: 'dim', display: false })
                    label.set('py', -numberSize * 0.25)
                }
                this.numbers.add(label.at(x, numberY))
                this.marks.push(label)
                this.markXs.push(x)
                stamps.push({ value, node: label, x })
            }
        }
        this.numbersBottom = stamps.length > 0 ? numberY + numberSize * 0.62 : 10
        // A list of ticks is not at equal steps, so two numbers can meet. The line with a step keeps the look that it had.
        if (listed || options.tickLabels !== undefined) {
            const boxes = stamps.map((stamp) => ({ ...stamp, box: stamp.node.bounds() }))
            const room = numberSize * 0.3
            const hit = boxes.findIndex((one, index) => index > 0 && one.box.x - (boxes[index - 1]!.box.x + boxes[index - 1]!.box.width) < room)
            if (hit > 0) {
                // The ticks that have room for a number, from the last one down: for a number format, the large values are the sparse ones.
                const keep: number[] = []
                let edge = Infinity
                for (let index = boxes.length - 1; index >= 0; index--) {
                    const { box, value } = boxes[index]!
                    if (box.x + box.width <= edge - room) {
                        keep.unshift(value)
                        edge = box.x
                    }
                }
                const words = (index: number) => JSON.stringify(options.format ? String(options.format(boxes[index]!.value)) : String(Math.round(boxes[index]!.value * 1000) / 1000))
                throw new Error(`numberLine: the numbers ${words(hit - 1)} and ${words(hit)} touch under the line. What works for this line: tickLabels: [${keep.join(', ')}], which names the ticks that have room, or a longer \`length\`, or a smaller \`labelSize\``)
            }
        }

        // The thresholds, and the bands that they leave.
        const cuts = (options.thresholds ?? []).map((given, index) => {
            const spec: NumberLineThreshold = typeof given === 'number' ? { at: given } : given
            if (typeof spec !== 'object' || spec === null || typeof spec.at !== 'number' || !Number.isFinite(spec.at)) throw new Error(`numberLine: threshold ${index} is ${written(typeof spec === 'object' && spec !== null ? spec.at : spec)}. A threshold is a value, or { at, label }`)
            if (spec.at < min || spec.at > max) throw new Error(`numberLine: threshold ${index} is at ${spec.at}, outside the line, which goes from ${min} to ${max}`)
            if (spec.ties !== undefined && spec.ties !== 'over' && spec.ties !== 'under') throw new Error(`numberLine: threshold ${index} has ties: ${written(spec.ties)}. Use 'over' or 'under': the band of a value that is exactly at the threshold`)
            this.paintOf(spec.color ?? 'ink', `the color of threshold ${index}`)
            return spec
        })
        cuts.forEach((cut, index) => {
            if (index > 0 && !(cut.at > cuts[index - 1]!.at)) throw new Error(`numberLine: threshold ${index} is at ${cut.at}, and threshold ${index - 1} is at ${cuts[index - 1]!.at}. Give the thresholds from the smallest to the largest`)
        })
        const given: readonly (string | NumberLineBand)[] = options.bands ?? Array.from({ length: cuts.length > 0 ? cuts.length + 1 : 0 }, () => ({}))
        if (!Array.isArray(given)) throw new Error('numberLine: bands is a list, with one band for each part that the thresholds leave')
        const bands = given.map((band) => (typeof band === 'string' ? { name: band } : band))
        if (options.bands !== undefined && bands.length !== cuts.length + 1) {
            throw new Error(`numberLine: ${bands.length} band${bands.length === 1 ? '' : 's'} and ${cuts.length} threshold${cuts.length === 1 ? '' : 's'}. ${cuts.length} threshold${cuts.length === 1 ? ' leaves' : 's leave'} ${cuts.length + 1} bands: give ${cuts.length + 1} bands, or ${Math.max(0, bands.length - 1)} thresholds`)
        }
        bands.forEach((band, index) => {
            if (typeof band !== 'object' || band === null) throw new Error(`numberLine: band ${index} is ${written(band)}. A band is a name, or { name, color, hollow }`)
            if (band.color !== undefined) this.paintOf(band.color, `the color of band ${index}`)
            if (band.name !== undefined && bands.findIndex((other) => other.name === band.name) !== index) throw new Error(`numberLine: two bands have the name ${JSON.stringify(band.name)}. Give each band its own name`)
            this.bands.push(band)
        })

        const points = options.points ?? []
        if (!Array.isArray(points)) throw new Error('numberLine: points is a list, such as [{ name: \'A\', value: 1.8 }]')
        const digits = Math.max(this.tickValues.reduce((maxDigits, tick) => Math.max(maxDigits, decimalsOf(tick)), 0), ...cuts.map((cut) => decimalsOf(cut.at)), ...points.map((point) => (typeof point?.value === 'number' ? decimalsOf(point.value) : 0)))
        this.readoutFormat = options.format ?? new Intl.NumberFormat('en-US', {
            useGrouping: false, minimumFractionDigits: digits, maximumFractionDigits: 4,
        })

        const staged = bands.length > 0 || options.points !== undefined || options.levels !== undefined
        if (bands.length > 0) {
            this.shade = new Part<NumberLine>(this, (owner, time) => owner.drawShade(time))
            if (this.counts || this.bands.some((band) => band.name !== undefined)) this.captions = new Part<NumberLine>(this, (owner, time) => owner.drawCaptions(time))
        }
        // The shade is under the line. A line with no band has the children that it always had.
        if (this.shade) this.add(this.shade)
        this.add(this.line, this.ticks, this.numbers)
        if (staged) {
            this.extent = { left: -half - (tips ? 36 : 0), right: half + (tips ? 36 : 0), top: -this.topRoom(cuts.length), bottom: this.captions ? this.captionY + this.size * 0.62 : this.numbersBottom }
            // A shape with no paint draws nothing and has bounds. It keeps the room of the names and the labels
            // from the start, so the layout measures the line as it is when the points arrive.
            this.add(new Node(rectPath(this.extent.left, this.extent.top, this.extent.right - this.extent.left, this.extent.bottom - this.extent.top)))
            if (this.captions) this.add(this.captions)
            this.add(this.traces, this.thresholdLayer)
            if (cuts.length > 0) {
                this.patches = new Part<NumberLine>(this, (owner, time) => owner.drawPatches(time))
                this.add(this.patches)
            }
            this.add(this.pointLayer)
        }
        cuts.forEach((cut, index) => {
            const node = new Node().at(this.p(cut.at)[0], 0)
            const paint = cut.color ?? 'ink'
            node.add(line([0, -this.panelTop - this.size * 0.12 - (index % 2) * this.size * 1.25], [0, 12], { stroke: paint, width: Math.max(3, this.size * 0.1) }))
            node.add(new Part<NumberLine>(this, (owner, time) => owner.drawThresholdLabel(index, time)))
            this.cuts.push({ value: cut.at, at: new Value(cut.at), label: cut.label === undefined || cut.label.trim() === '' ? undefined : cut.label, readout: cut.readout !== false, color: paint, ties: cut.ties ?? 'over', node, last: null })
            this.thresholdNodes.push(node)
            this.thresholdLayer.add(node)
        })
        points.forEach((point, index) => {
            const spec = this.checkedPoint(point, `point ${index}`)
            if (this.entries.some((entry) => entry.name === spec.name)) throw new Error(this.taken(spec.name, 'points'))
            const entry = this.entryOf(spec, true)
            this.entries.push(entry)
            this.pointNodes.push(entry.node)
            this.pointLabels.push(entry.label)
            this.pointLayer.add(entry.node)
        })
        if (this.entries.length > 0) this.relayout(null)
        if (this.captions) {
            // The names of the bands stand in one row under the line, in the order of the bands.
            const widths = this.captionParts(this.bands.map(() => 0)).made.map((one) => one.width)
            const needed = widths.reduce((sum, one) => sum + one, 0) + this.size * (widths.length - 1)
            if (needed > this.length) throw new Error(`numberLine: the names of the bands need ${Math.ceil(needed)} px in one row, and the line is ${this.length} px long. Give shorter names, a smaller \`size\`, or a longer \`length\``)
        }
        ownLabels(this, { name: 'number line', plot: true })
    }

    // ── Places ────────────────────────────────────────────────────────────

    /** Value to local stage coordinates. */
    p(value: number): [number, number] {
        const [min, max] = this.range
        return [((value - min) / (max - min) - 0.5) * this.length, 0]
    }

    world(value: number): [number, number] {
        const [x, y] = this.p(value)
        return this.toWorld(x, y)
    }

    /** The node of a point, by its name: its dot and its text. A light or a connector takes it, and it follows the point. */
    point(name: string): Node {
        return this.need(name, 'point').node
    }

    /** The node of a threshold, by its index or by its label: its line and its label. */
    threshold(which: number | string = 0): Node {
        return this.cut(which, 'threshold').node
    }

    /**
     * The box of a part of the line, in stage pixels, for `place` and `beside` of the layout: such as
     * `beside(note, axis, 'above', 'tight', axis.region({ at: 0.7 }))`. `from` and `to` are values, `at` is one
     * value, and `band` is a band by its index or its name. Without them it is the whole line. The box is as
     * high as the room of the line with its names. It is where the line is now, after the changes that are
     * scheduled so far, so ask for it after the line has its place.
     */
    region(part: { from?: number; to?: number; at?: number; band?: number | string } = {}): Box {
        const names = ['from', 'to', 'at', 'band']
        if (typeof part !== 'object' || part === null) throw new Error(`numberLine: region takes an object such as { at: 0.7 }, and it got ${part === null ? 'null' : typeof part}`)
        const unknown = Object.keys(part).find((name) => !names.includes(name))
        if (unknown !== undefined) throw new Error(`numberLine: region has no part "${unknown}". Its parts are: ${names.join(', ')}`)
        const stretch = part.from !== undefined || part.to !== undefined
        if (part.at !== undefined && stretch) throw new Error('numberLine: region takes `at` for one value, or `from` and `to` for a stretch, not both')
        if (part.band !== undefined && (stretch || part.at !== undefined)) throw new Error('numberLine: region takes `band` for one band, or values with `from`, `to` and `at`, not both')
        let from = part.at ?? part.from ?? this.range[0], to = part.at ?? part.to ?? this.range[1]
        if (part.band !== undefined) {
            const index = this.bandIndex(part.band, 'region')
            const edges = [this.range[0], ...this.cuts.map((cut) => cut.value), this.range[1]]
            from = edges[index]!
            to = edges[index + 1]!
        }
        for (const value of [from, to]) {
            if (!(Number.isFinite(value) && value >= this.range[0] && value <= this.range[1])) throw new Error(`numberLine: region: a value is ${value}. \`from\`, \`to\` and \`at\` are values of the line, ${this.range[0]} to ${this.range[1]}`)
        }
        if (from > to) throw new Error(`numberLine: region: \`from\` is ${from} and \`to\` is ${to}. Give a \`from\` that is not after \`to\``)
        const top = this.extent ? this.extent.top : -7, bottom = this.extent ? this.extent.bottom : this.numbersBottom
        return worldBox(this, this.p(from)[0], top, this.p(to)[0], bottom)
    }

    // ── State ─────────────────────────────────────────────────────────────

    /** The names of the points of the line, in the order in which they came, after the changes that are scheduled so far. */
    get names(): string[] {
        return this.entries.filter((entry) => entry.here).map((entry) => entry.name)
    }

    /** The value of each threshold, after the changes that are scheduled so far. */
    get thresholds(): number[] {
        return this.cuts.map((cut) => cut.value)
    }

    /** The value of a point, after the changes that are scheduled so far. */
    value(name: string): number {
        return this.need(name, 'value').value
    }

    /** The index of the band that a point is in, after the changes that are scheduled so far. 0 on a line with no threshold. */
    bandOf(name: string): number {
        return this.bandFor(this.need(name, 'bandOf').value, null)
    }

    /** How many points a band holds, by its index or its name, after the changes that are scheduled so far. */
    count(band: number | string): number {
        const index = this.bandIndex(band, 'count')
        return this.entries.filter((entry) => entry.here && this.bandFor(entry.value, null) === index).length
    }

    /** The names of the points that a function picks. It gets each point with its value and its band, after the changes that are scheduled so far. */
    find(test: (point: NumberLinePointView) => boolean): string[] {
        if (typeof test !== 'function') throw new Error('numberLine: find takes a function of a point, such as (point) => point.band === 1')
        return this.entries.filter((entry) => entry.here && test({ name: entry.name, value: entry.value, band: this.bandFor(entry.value, null) })).map((entry) => entry.name)
    }

    /**
     * The tick that is nearest to a value: the tick that `snap` takes a point to. When two ticks are as near,
     * it is the one with the even index in `tickValues`. That is the rule of a number format when the list
     * starts at an even code, such as 0.
     */
    nearestTick(value: number): number {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`numberLine: nearestTick: the value is ${written(value)}. Give a number`)
        this.requireTicks('nearestTick')
        const ticks = this.tickValues
        let best = 0
        for (let index = 1; index < ticks.length; index++) {
            const nearer = Math.abs(ticks[index]! - value) - Math.abs(ticks[best]! - value)
            if (nearer < 0 || (nearer === 0 && index % 2 === 0)) best = index
        }
        return ticks[best]!
    }

    // ── Parts that a film adds ────────────────────────────────────────────

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
        ownLabels(this, { labels: [node] })
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

    /**
     * A bracket for the gap between two values, with the gap at its middle: `axis.bracket('A', 'B')`. An end is
     * a value, or the name of a point. An end that is a point follows the point, and the text counts with it.
     * The bracket is on the line from now on: fade it in with `fadeIn`.
     */
    bracket(from: number | string, to: number | string, options: NumberLineBracketOptions = {}): Node {
        const bind = (end: number | string): BracketEnd => {
            if (typeof end === 'string') return { pointId: this.need(end, 'bracket').id }
            if (typeof end !== 'number' || !Number.isFinite(end) || end < this.range[0] || end > this.range[1]) throw new Error(`numberLine: bracket: an end is ${written(end)}. An end is a value of the line, ${this.range[0]} to ${this.range[1]}, or the name of a point`)
            return end
        }
        const start = bind(from), finish = bind(to)
        const side = options.side ?? 'under'
        if (side !== 'under' && side !== 'over') throw new Error(`numberLine: bracket: side is 'under' or 'over', not ${written(side)}`)
        const offset = options.offset ?? 0
        if (!Number.isFinite(offset)) throw new Error('numberLine: bracket: offset is a number of pixels')
        const color = options.color ?? 'ink'
        this.paintOf(color, 'bracket: the color')
        const label = options.label
        const node = new Part<NumberLine>(this, (owner, time) => owner.drawBracket(start, finish, side, offset, color, label, time))
        this.add(node)
        ownLabels(this, { labels: [node] })
        return node
    }

    // ── Verbs ─────────────────────────────────────────────────────────────

    /** The line draws from its first end, its ticks and its numbers arrive as it passes them, and then the bands, the thresholds and the points. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'numberLine.enter', duration: options.duration ?? 1.4, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx
                const span = t1 - t0, drawn = t0 + span * 0.6, soon = span * 0.2
                // A line with tips is an arrow: its shaft, the head at its last end, and the head at its first end.
                const [shaft, last, first] = this.line.children.length > 0 ? this.line.children : [this.line]
                stepAt(shaft!, 'trimTo', 0, t0)
                shaft!.tween('trimTo', 1, t0, drawn, ease)
                if (first) {
                    stepAt(first, 'opacity', 0, t0)
                    first.tween('opacity', 1, t0, t0 + soon, ease)
                }
                // The head at the last end comes when the line is there.
                if (last) {
                    stepAt(last, 'opacity', 0, t0)
                    last.tween('opacity', 1, drawn - soon * 0.3, drawn, ease)
                }
                this.marks.forEach((mark, index) => {
                    const start = t0 + (drawn - t0) * Math.min(1, Math.max(0, this.markXs[index]! / this.length + 0.5))
                    stepAt(mark, 'opacity', 0, t0)
                    mark.tween('opacity', 1, start, Math.min(t1, start + soon), ease)
                })
                for (const node of [this.shade, this.captions, ...this.thresholdNodes]) {
                    if (!node) continue
                    stepAt(node, 'opacity', 0, t0)
                    node.tween('opacity', 1, t0 + span * 0.45, t0 + span * 0.8, ease)
                }
                const here = this.entries.filter((entry) => entry.here).sort((a, b) => a.value - b.value)
                const windows = staggered(here.length, Math.max(0, options.lag ?? 0.3), t0 + span * 0.5, t1)
                here.forEach((entry, index) => this.arrive(entry.node, windows[index]![0], windows[index]![1], ease, t0))
            },
        }
    }

    /**
     * Points go to new values: `move('A', 2.4)` for one point, or `move({ A: 2.4, B: 1.3 })` for several at one
     * time. Each dot slides along the line. A point that crosses a threshold takes the look of its new band at
     * that moment, and the counts follow. A bracket at the point follows it.
     */
    move(name: string, to: number, options?: AnimOptions): Anim
    move(values: Readonly<Record<string, number>>, options?: AnimOptions): Anim
    move(first: string | Readonly<Record<string, number>>, second?: number | AnimOptions, third?: AnimOptions): Anim {
        const one = typeof first === 'string'
        if (!one && (typeof first !== 'object' || first === null || Array.isArray(first))) throw new Error(`numberLine: move takes the name of a point and its new value, or an object of names and values such as { A: 2.4 }. It got ${written(first)}`)
        const changes: [string, number][] = one ? [[first, second as number]] : Object.entries(first)
        const options = ((one ? third : second) ?? {}) as AnimOptions
        if (changes.length === 0) throw new Error('numberLine: move got no point. Give names and values, such as { A: 2.4 }')
        // Find a wrong name or value now, where the film names it. The values change when the animation is
        // scheduled, so that a second move in the same sequence starts from the first.
        for (const [name, value] of changes) {
            this.need(name, 'move')
            this.inRange(value, `move: the new value of ${JSON.stringify(name)}`)
        }
        return {
            label: 'numberLine.move', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                for (const [name, value] of changes) {
                    const entry = this.need(name, 'move')
                    this.claim(entry, `move(${JSON.stringify(name)})`, `the point ${JSON.stringify(name)}`, ctx)
                    this.slide(entry, value, ctx)
                }
                this.relayout(ctx, true)
            },
        }
    }

    /**
     * Points go to the nearest tick: `snap('w')` for one point, a list of names, or `snap()` for every point.
     * A point leaves a ring at the place that it came from, and a line from there to the tick: the error of
     * the rounding, as a length. `trace: false` leaves none. The next change of the point takes them away.
     * When two ticks are as near, the point goes to the one that `nearestTick` gives. A point that is on a
     * tick does not move.
     */
    snap(which?: string | readonly string[], options: AnimOptions & { trace?: boolean } = {}): Anim {
        const list = which === undefined ? null : typeof which === 'string' ? [which] : which
        if (list !== null) {
            if (!Array.isArray(list)) throw new Error(`numberLine: snap takes the name of a point, a list of names, or nothing for every point. It got ${written(which)}`)
            for (const name of list) this.need(name, 'snap')
            if (list.length > 0) this.requireTicks('snap')
        }
        return {
            label: 'numberLine.snap', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const chosen = list === null ? this.entries.filter((entry) => entry.here) : list.map((name) => this.need(name, 'snap'))
                if (chosen.length > 0) this.requireTicks('snap')
                for (const entry of chosen) {
                    const tick = this.nearestTick(entry.value)
                    if (tick === entry.value) continue
                    this.claim(entry, `snap(${JSON.stringify(entry.name)})`, `the point ${JSON.stringify(entry.name)}`, ctx)
                    const from = this.p(entry.value)[0], to = this.p(tick)[0]
                    this.slide(entry, tick, ctx)
                    if (options.trace === false) continue
                    const ghost = new Node(circlePath(from, 0, this.radius - 1)).stroke('dim', 2).dash([4, 4])
                    const error = line([from, 0], [to, 0], { stroke: 'red', width: Math.max(5, this.radius * 0.6) })
                    error.set('cap', 'butt')
                    const trace = new Node().add(error, ghost)
                    clock.now = ctx.t0
                    this.traces.add(trace)
                    stepAt(ghost, 'opacity', 0, ctx.t0)
                    ghost.tween('opacity', 1, ctx.t0, ctx.t0 + (ctx.t1 - ctx.t0) * 0.4, ctx.ease)
                    // The line of the error grows with the dot: its end is under the dot at each frame.
                    stepAt(error, 'trimTo', 0, ctx.t0)
                    error.tween('trimTo', 1, ctx.t0, ctx.t1, ctx.ease)
                    entry.traces.push(trace)
                }
                this.relayout(ctx, true)
            },
        }
    }

    /**
     * A point arrives: its dot grows at its value, and its text comes with it. With `from`, the dot travels
     * from a place of the stage to its value, such as from a row of a list: give a point or a node. The
     * counts take the point when it lands.
     */
    insert(point: NumberLinePoint, options: AnimOptions & { from?: Vec | Node } = {}): Anim {
        const spec = this.checkedPoint(point, 'insert: the point')
        if (this.entries.some((entry) => entry.here && entry.name === spec.name) || this.pending.has(spec.name)) throw new Error(this.taken(spec.name, 'insert'))
        const from = options.from
        if (from !== undefined && !(from instanceof Node) && !(Array.isArray(from) && from.length === 2 && Number.isFinite(from[0]) && Number.isFinite(from[1]))) throw new Error(`numberLine: insert: \`from\` is ${written(from)}. Give a point [x, y] of the stage, or a node`)
        this.pending.add(spec.name)
        return {
            label: 'numberLine.insert', duration: options.duration ?? 0.7, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                this.pending.delete(spec.name)
                // A film that plays one insert twice would bring two points of one name.
                if (this.entries.some((other) => other.here && other.name === spec.name)) throw new Error(this.taken(spec.name, 'insert'))
                const { t0, t1, ease } = ctx
                const entry = this.entryOf(spec, false)
                if (entry.label) ownLabels(this, { labels: [entry.label] })
                this.entries.push(entry)
                this.pointNodes.push(entry.node)
                this.pointLabels.push(entry.label)
                clock.now = t0
                if (!this.pointLayer.parent) this.add(this.traces, this.thresholdLayer, this.pointLayer)
                if (!this.extent) {
                    // A copy made before a plain axis first used these layers freezes them hidden.
                    reveal(this.pointLayer, t0, ctx.stage)
                    reveal(this.traces, t0, ctx.stage)
                }
                this.pointLayer.add(entry.node)
                entry.alive.step(t1, true)
                entry.last = { call: `insert(${JSON.stringify(spec.name)})`, t0, t1 }
                if (from === undefined) {
                    this.arrive(entry.node, t0, t1, ease, t0)
                } else {
                    const [wx, wy] = from instanceof Node ? from.center : from
                    const [x0, y0] = apply(invert(this.worldMatrix()), wx, wy)
                    const x1 = this.p(spec.value)[0]
                    stepAt(entry.node, 'x', x0, t0)
                    stepAt(entry.node, 'y', y0, t0)
                    entry.node.tween('x', x1, t0, t1, ease)
                    entry.node.tween('y', 0, t0, t1, ease)
                    // The text comes when the dot is at its place, so it does not travel over the picture.
                    if (entry.label) {
                        stepAt(entry.label, 'opacity', 0, t0)
                        entry.label.tween('opacity', 1, t0 + (t1 - t0) * 0.8, t1, ease)
                    }
                }
                this.relayout(ctx)
            },
        }
    }

    /** Points leave: `remove('p4')`, or a list of names. Each dot shrinks and fades with its text. The counts lose the point when it starts to leave. */
    remove(which: string | readonly string[], options: AnimOptions = {}): Anim {
        const list = typeof which === 'string' ? [which] : which
        if (!Array.isArray(list) || list.length === 0) throw new Error(`numberLine: remove takes the name of a point, or a list of names. It got ${written(which)}`)
        for (const name of list) this.need(name, 'remove')
        return {
            label: 'numberLine.remove', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                const { t0, t1, ease } = ctx
                for (const name of list) {
                    const entry = this.need(name, 'remove')
                    this.claim(entry, `remove(${JSON.stringify(name)})`, `the point ${JSON.stringify(name)}`, ctx)
                    entry.here = false
                    entry.alive.step(t0, false)
                    entry.node.tween('opacity', 0, t0, t1, ease)
                    entry.node.tween('sx', 0.3, t0, t1, ease)
                    entry.node.tween('sy', 0.3, t0, t1, ease)
                    entry.node.track('visible').step(t1, false)
                    this.fadeTrace(entry, t0, t1, ease)
                }
                this.relayout(ctx)
            },
        }
    }

    /**
     * A threshold goes to a new value: `moveThreshold(0.5)`. Its line slides, the shade of the two bands
     * beside it follows, and its value counts. Each point that it passes takes the look of its new band at
     * that moment, and the counts follow. `which` names the threshold by its index or its label, on a line
     * with more than one. A threshold does not pass another one.
     */
    moveThreshold(to: number, options: AnimOptions & { which?: number | string } = {}): Anim {
        this.cut(options.which ?? 0, 'moveThreshold')
        this.inRange(to, 'moveThreshold: the new value')
        return {
            label: 'numberLine.moveThreshold', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const entry = this.cut(options.which ?? 0, 'moveThreshold'), index = this.cuts.indexOf(entry)
                this.claim(entry, `moveThreshold(${to})`, `threshold ${index}`, ctx)
                const from = entry.at.track.sample(ctx.t0)
                for (const point of this.entries) if (point.snapshot) point.snapshot.resume = Math.min(point.snapshot.resume, ctx.t0)
                tweenValue(entry.at, to, ctx.t0, ctx.t1, ctx.ease)
                entry.node.track('x').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: this.p(to)[0], at: (alpha) => this.p(from + (to - from) * alpha)[0] })
                entry.value = to
                if (this.cuts.length > 1) {
                    // A parallel move can schedule the neighbor later. Check both tracks after the film has built them.
                    ctx.stage.checks.push(() => {
                        this.orderedThresholds(ctx.t1, index)
                        const samples = Math.min(256, Math.max(1, Math.ceil((ctx.t1 - ctx.t0) * ctx.stage.fps)))
                        for (let i = 0; i < samples; i++) this.orderedThresholds(ctx.t0 + (ctx.t1 - ctx.t0) * i / samples, index)
                    })
                }
                // A name that the threshold would stand on at its new place goes to the side of its dot.
                this.relayout(ctx)
            },
        }
    }

    /**
     * A copy with its own points and thresholds, at the values that the line shows now. A change of the copy
     * does not change the line.
     */
    protected override [rebindCloneParts](copy: this, parts: ReadonlyMap<Node, Node>): void {
        // A later insert appends to these lists even when none of the original points had a label.
        Object.assign(copy, { pointNodes: [...copy.pointNodes], pointLabels: [...copy.pointLabels], thresholdNodes: [...copy.thresholdNodes] })
        // A plain axis only attaches these layers when its first point arrives.
        if (!parts.has(this.pointLayer)) {
            copy.traces = new Node()
            copy.pointLayer = new Node()
            copy.thresholdLayer = new Node()
        }
        copy.entries = this.entries.map((entry, index) => {
            const value = entry.at.value
            const alive = entry.alive.sample(clock.now)
            const traces = entry.traces.filter((trace) => trace.get('visible')).map((trace) => parts.get(trace)!)
            const snapshot = { crossing: this.crossingAt(entry, clock.now), traveling: this.traveling(entry, clock.now), resume: Infinity }
            return { ...entry, value, at: new Value(value), here: alive, alive: new Track(alive), node: copy.pointNodes[index]!, label: copy.pointLabels[index] ?? null, traces, snapshot, last: null }
        })
        copy.cuts = this.cuts.map((cut, index) => {
            const value = cut.at.value
            return { ...cut, value, at: new Value(value), node: copy.thresholdNodes[index]!, last: null }
        })
        copy.pending = new Set()
    }

    // ── Bookkeeping ───────────────────────────────────────────────────────

    private requireTicks(call: string): void {
        if (this.tickValues.length === 0) throw new Error(`numberLine: ${call}: the line has no ticks in its range. Give a smaller step or list the ticks to snap to`)
    }

    private need(name: string, call: string): PointEntry {
        const entry = typeof name === 'string' ? this.entries.find((one) => one.here && one.name === name) : undefined
        if (!entry) {
            const names = this.names
            const known = names.length === 0 ? 'The line has no points: give `points` to numberLine(), or play an insert()' : `The points are ${names.slice(0, 12).map((one) => JSON.stringify(one)).join(', ')}${names.length > 12 ? `, and ${names.length - 12} more` : ''}`
            throw new Error(`numberLine: ${call}: no point ${written(name)}. ${known}`)
        }
        return entry
    }

    private cut(which: number | string, call: string): ThresholdEntry {
        const index = typeof which === 'number' ? (Number.isInteger(which) && which >= 0 && which < this.cuts.length ? which : -1) : this.cuts.findIndex((cut) => cut.label === which)
        if (index < 0) {
            const known = this.cuts.length === 0 ? 'The line has no threshold: give `thresholds` to numberLine()' : `The thresholds are ${this.cuts.map((cut, at) => (cut.label === undefined ? `${at}` : `${at} (${JSON.stringify(cut.label)})`)).join(', ')}`
            throw new Error(`numberLine: ${call}: no threshold ${written(which)}. ${known}`)
        }
        return this.cuts[index]!
    }

    private bandIndex(band: number | string, call: string): number {
        const count = this.cuts.length + 1
        const index = typeof band === 'number' ? (Number.isInteger(band) && band >= 0 && band < count ? band : -1) : this.bands.findIndex((one) => one.name === band)
        if (index < 0) {
            const names = Array.from({ length: count }, (_, at) => (this.bands[at]?.name === undefined ? `${at}` : `${at} (${JSON.stringify(this.bands[at]!.name)})`))
            throw new Error(`numberLine: ${call}: no band ${written(band)}. The bands are ${names.join(', ')}`)
        }
        return index
    }

    private orderedThresholds(time: number, moving?: number): number[] {
        const values = this.cuts.map((cut) => cut.at.track.sample(time))
        for (let i = 1; i < values.length; i++) {
            if (values[i - 1]! < values[i]!) continue
            const index = moving === i ? i : i - 1, other = index === i ? i - 1 : i
            throw new Error(`numberLine: moveThreshold: threshold ${index} cannot go to ${values[index]}: threshold ${other} is at ${values[other]}, and the thresholds keep their order. The cuts meet or cross at ${seconds(time)}. Change their targets or play the moves in sequence`)
        }
        return values
    }

    /** The index of the band of a value: at a time of the film, or after the changes that are scheduled so far. */
    private bandFor(value: number, time: number | null): number {
        let band = 0
        for (const cut of this.cuts) {
            const at = time === null ? cut.value : cut.at.track.sample(time)
            if (cut.ties === 'over' ? value >= at : value > at) band++
        }
        return band
    }

    private inRange(value: unknown, what: string): void {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`numberLine: ${what} is ${written(value)}. Give a number`)
        if (value < this.range[0] || value > this.range[1]) throw new Error(`numberLine: ${what} is ${value}, outside the line, which goes from ${this.range[0]} to ${this.range[1]}. Give a value of the line, or make the line with a range that holds it`)
    }

    private paintOf(color: ColorInput, what: string): Paint {
        try {
            return toPaint(color)
        } catch {
            throw new Error(`numberLine: ${what} is ${written(color)}, which is not a color. Use a color of the look, such as 'teal', or a CSS color`)
        }
    }

    private taken(name: string, call: string): string {
        return `numberLine: ${call}: the line has a point ${JSON.stringify(name)} already. A name is the identity of a point: give the point that arrives another name, or change the point with move()`
    }

    /** A point of the film, checked. */
    private checkedPoint(point: unknown, what: string): { name: string; value: number; color: ColorInput | undefined; words: string | null } {
        if (typeof point !== 'object' || point === null) throw new Error(`numberLine: ${what} is ${written(point)}. Give a point such as { name: 'A', value: 1.8 }`)
        const { name, value, color, label } = point as NumberLinePoint
        if (typeof name !== 'string' || name.trim() === '') throw new Error(`numberLine: ${what} has no name. Give each point a name, such as { name: 'A', value: 1.8 }`)
        this.inRange(value, `the value of the point ${JSON.stringify(name)}`)
        if (color !== undefined) this.paintOf(color, `the color of the point ${JSON.stringify(name)}`)
        if (label !== undefined && label !== false && typeof label !== 'string') throw new Error(`numberLine: the label of the point ${JSON.stringify(name)} is ${written(label)}. A label is a text, or false for a dot with no text`)
        const words = label === false ? null : (label ?? name).trim()
        if (words !== null && /[\r\n]/.test(words)) throw new Error(`numberLine: the label of the point ${JSON.stringify(name)} has a line break. A label is one line`)
        return { name, value, color, words: words === '' ? null : words }
    }

    /** The record and the nodes of a point. `counted` is false for a point that an insert brings later. */
    private entryOf(spec: { name: string; value: number; color: ColorInput | undefined; words: string | null }, counted: boolean): PointEntry {
        const node = new Node().at(this.p(spec.value)[0], 0)
        const id = this.serial++
        const label = spec.words === null ? null : text(spec.words, { size: this.size, font: this.font, color: spec.color ?? 'ink' })
        const width = label ? label.bounds().width : 0
        if (label) {
            label.at(0, this.nameY(1))
            // The line from the dot to a name that is not right over it.
            node.add(new Part<NumberLine>(this, (owner, time) => owner.drawStem(id, time)))
        }
        node.add(new Part<NumberLine>(this, (owner, time) => owner.drawDot(id, time)))
        if (label) node.add(label)
        return { id, name: spec.name, value: spec.value, at: new Value(spec.value), alive: new Track(counted), color: spec.color, node, label, width, slot: null, traces: [], snapshot: null, here: true, last: null }
    }

    /**
     * Take the time of a change of a point or of a threshold. Two changes of one part at one time would each
     * write its value, and the picture would follow neither. So a change that starts before the last one is
     * over is refused.
     */
    private claim(entry: { last: { call: string; t0: number; t1: number } | null }, call: string, part: string, ctx: AnimContext): void {
        const { t0, t1 } = ctx
        if (!(Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0)) throw new Error(`numberLine: ${call} plays from ${String(t0)} to ${String(t1)}. Give the play a duration that is a number, 0 or more`)
        const last = entry.last
        if (last && t0 < last.t1 - SOON) {
            // A film can write a change at an earlier time after a later one, with `s.at()`. A value is written in the order of time.
            const advice = t1 <= last.t0 + SOON
                ? `The line takes the changes of a part in the order of time, and the film calls ${last.call} first. Call ${call} before it`
                : 'Play the two one after the other: in a seq(), or in two calls of s.play. For two new values at one time, give the last value only'
            throw new Error(`numberLine: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. Both change ${part}, and a part takes one change at a time. ${advice}`)
        }
        entry.last = { call, t0, t1 }
    }

    /** Write the keys that take a point to a value, and move the bookkeeping. */
    private slide(entry: PointEntry, to: number, ctx: AnimContext): void {
        const from = entry.at.track.sample(ctx.t0)
        if (entry.snapshot) entry.snapshot.resume = Math.min(entry.snapshot.resume, ctx.t0)
        tweenValue(entry.at, to, ctx.t0, ctx.t1, ctx.ease)
        entry.node.track('x').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: this.p(to)[0], at: (alpha) => this.p(from + (to - from) * alpha)[0] })
        entry.value = to
        this.fadeTrace(entry, ctx.t0, ctx.t0 + (ctx.t1 - ctx.t0) * 0.4, ctx.ease)
    }

    /** The ring and the line of the last snap of a point leave. */
    private fadeTrace(entry: PointEntry, t0: number, t1: number, ease: AnimContext['ease']): void {
        const trace = entry.traces.at(-1)
        if (!trace || !sampleAt(trace, 'visible', t0)) return
        trace.tween('opacity', 0, t0, t1, ease)
        trace.track('visible').step(t1, false)
    }

    /** A dot grows and fades in at its place. `hidden` is the time from which it is away before that. */
    private arrive(node: Node, start: number, end: number, ease: AnimContext['ease'], hidden: number): void {
        stepAt(node, 'opacity', 0, hidden)
        node.tween('opacity', 1, start, end, ease)
        for (const prop of ['sx', 'sy'] as const) {
            stepAt(node, prop, 0.3, hidden)
            node.tween(prop, 1, start, end, ease)
        }
    }

    // ── The names of the points ───────────────────────────────────────────

    /** The y of the middle of a name at a height, counted from 1. */
    private nameY(level: number): number {
        return -(this.radius + this.size * 0.95 + (level - 1) * this.size * 1.25)
    }

    /** How far the shade of the bands goes over the line: the room of the names at every height. */
    private get panelTop(): number {
        return -this.nameY(this.levels) + this.size * 0.75
    }

    /** How far the line goes up with a number of thresholds: their labels are over the shade, at two heights by turns. */
    private topRoom(thresholds: number): number {
        return this.panelTop + (thresholds > 0 ? this.size * 1.4 : 0) + (thresholds > 1 ? this.size * 1.25 : 0)
    }

    /** The y of the middle of the names of the bands, under the numbers. */
    private get captionY(): number {
        return this.numbersBottom + this.size * 0.85
    }

    /** Where the middle of a name is, from its dot, at a place of the search. */
    private labelAt(entry: PointEntry, slot: Slot): [number, number] {
        const beside = this.size * 0.22 + entry.width / 2
        return [slot.align === 'center' ? 0 : slot.align === 'right' ? beside : -beside, this.nameY(slot.level)]
    }

    /**
     * The place of each name, with as few heights as the names need. A name is over its dot. When two dots
     * are near, a name goes to the left or to the right of its dot, and then to a higher place, with a line
     * from the dot. No two names meet, and no such line passes through a name. With `clear`, no name stands
     * on the line of a threshold.
     */
    private placeNames(items: readonly PointEntry[], most: number, clear: boolean): Slot[] | null {
        const size = this.size, clearX = size * 0.35, stemClear = size * 0.14
        const xs = items.map((entry) => this.p(entry.value)[0])
        const walls = clear ? this.cuts.map((cut) => this.p(cut.value)[0]) : []
        const boxOf = (index: number, slot: Slot) => {
            const [dx, y] = this.labelAt(items[index]!, slot)
            const cx = xs[index]! + dx, half = items[index]!.width / 2
            return { x0: cx - half, x1: cx + half, y }
        }
        // A line from a dot passes every height under its name. Beside its name, it also reaches the height of the name.
        const reach = (slot: Slot) => (slot.level === 1 ? 0 : slot.align === 'center' ? slot.level - 1 : slot.level)
        const conflict = (a: number, slotA: Slot, b: number, slotB: Slot): boolean => {
            const boxA = boxOf(a, slotA), boxB = boxOf(b, slotB)
            if (slotA.level === slotB.level && boxA.x0 < boxB.x1 + clearX && boxB.x0 < boxA.x1 + clearX) return true
            if (slotB.level <= reach(slotA) && xs[a]! > boxB.x0 - stemClear && xs[a]! < boxB.x1 + stemClear) return true
            if (slotA.level <= reach(slotB) && xs[b]! > boxA.x0 - stemClear && xs[b]! < boxA.x1 + stemClear) return true
            return false
        }
        const order = items.map((_, index) => index).sort((a, b) => xs[a]! - xs[b]! || a - b)
        const candidates: Slot[] = []
        for (let level = 1; level <= most; level++) for (const align of ['center', 'right', 'left'] as const) candidates.push({ level, align })
        const chosen: (Slot | null)[] = items.map(() => null)
        let tried = 0
        const go = (k: number): boolean => {
            if (k === order.length) return true
            const index = order[k]!
            for (const slot of candidates) {
                if (++tried > SEARCH) return false
                const box = boxOf(index, slot)
                // Only the names before this one have a place.
                let free = !walls.some((wall) => wall > box.x0 - stemClear * 2 && wall < box.x1 + stemClear * 2)
                for (let j = k - 1; j >= 0 && free; j--) if (conflict(index, slot, order[j]!, chosen[order[j]!]!)) free = false
                if (!free) continue
                chosen[index] = slot
                if (go(k + 1)) return true
                chosen[index] = null
            }
            return false
        }
        return go(0) ? (chosen as Slot[]) : null
    }

    /** Give names that exchange places different heights for the crossing. Stationary names keep their level. */
    private crossingLevels(items: PointEntry[], slots: Slot[], ctx: AnimContext) {
        // A shorter parallel move can finish before a longer one passes its resting dot.
        const stops = new Set([ctx.t0, ctx.t1])
        for (const entry of items) for (const key of entry.at.track.keys) {
            if (key.t0 >= ctx.t1 || key.t1 <= ctx.t0) continue
            stops.add(Math.max(ctx.t0, key.t0))
            stops.add(key.t1)
        }
        const boundaries = [...stops].sort((a, b) => a - b)
        const end = boundaries[boundaries.length - 1]!
        const times = [ctx.t0]
        for (let i = 1; i < boundaries.length; i++) {
            const start = boundaries[i - 1]!, stop = boundaries[i]!
            for (let k = 1; k <= 8; k++) times.push(start + (stop - start) * k / 8)
        }
        const paths = items.map((entry, index) => ({
            entry, level: slots[index]!.level, distance: Math.abs(entry.at.track.sample(end) - entry.at.track.sample(ctx.t0)), values: times.map((t) => entry.at.track.sample(t)), others: [] as PointEntry[],
        }))
        for (let i = 0; i < paths.length; i++) {
            const a = paths[i]!
            for (let j = i + 1; j < paths.length; j++) {
                const b = paths[j]!
                if (!a.values.some((v, k) => v < b.values[k]!) || !a.values.some((v, k) => v > b.values[k]!)) continue
                a.others.push(b.entry)
                b.others.push(a.entry)
            }
        }
        const assigned = new Map<PointEntry, number>()
        for (const path of [...paths].sort((a, b) => a.distance - b.distance)) {
            if (path.others.length === 0) continue
            const taken = new Set(path.others.map((other) => assigned.get(other)))
            if (taken.has(path.level)) {
                let level = 1
                while (taken.has(level)) level++
                if (level > this.levels) throw new Error(`numberLine: the labels that pass ${JSON.stringify(path.entry.name)} need more than ${this.levels} heights during this move. Increase levels, hide a label, or play the moves in sequence`)
                path.level = level
            }
            assigned.set(path.entry, path.level)
        }
        return { paths, end }
    }

    /** Place the names at rest or schedule their paths to the new places. */
    private relayout(ctx: AnimContext | null, moving = false): void {
        const items = this.entries.filter((entry) => entry.here && entry.label)
        if (items.length === 0) return
        let slots: Slot[] | null = null
        // First with every name clear of the lines of the thresholds. A dot that is on a threshold has no such place: then without that rule.
        for (const clear of this.cuts.length > 0 ? [true, false] : [false]) {
            for (let most = 1; most <= this.levels && !slots; most++) slots = this.placeNames(items, most, clear)
        }
        if (!slots) {
            let more = 0
            for (let most = this.levels + 1; most <= this.levels + 3 && !more; most++) if (this.placeNames(items, most, false)) more = most
            const sorted = [...items].sort((a, b) => a.value - b.value)
            const near = sorted.reduce((best, entry, index) => (index > 0 && entry.value - sorted[index - 1]!.value < sorted[best]!.value - sorted[best - 1]!.value ? index : best), 1)
            const pair = sorted.length > 1 ? ` The points ${JSON.stringify(sorted[near - 1]!.name)} and ${JSON.stringify(sorted[near]!.name)} are the nearest two.` : ''
            throw new Error(`numberLine: the names of the points have no place over the line with ${this.levels} height${this.levels === 1 ? '' : 's'}: two names would meet, or the line from a dot would pass through a name.${pair} What works for this line: ${more ? `levels: ${more}, ` : ''}shorter labels, \`label: false\` for the points that need no name, or a longer \`length\``)
        }
        const crossings = ctx && moving ? this.crossingLevels(items, slots, ctx) : null
        items.forEach((entry, index) => {
            const slot = slots![index]!, label = entry.label!
            const [x, y] = this.labelAt(entry, slot)
            entry.slot = slot
            if (!ctx) {
                label.at(x, y)
                return
            }
            if (Math.abs(propAt(label, 'x', ctx.t0) - x) > 0.01 || Math.abs(propAt(label, 'x', ctx.t1) - x) > 0.01) label.tween('x', x, ctx.t0, ctx.t1, ctx.ease)
            const path = crossings?.paths[index], startY = propAt(label, 'y', ctx.t0)
            if (crossings && path && path.others.length > 0) {
                const crossingY = this.nameY(path.level)
                // The horizontal gap determines when the label rises, including when the two dots have different speeds.
                label.track('y').add({ t0: ctx.t0, t1: crossings.end, to: y, ease: null, at: (progress) => {
                    const time = ctx.t0 + progress * (crossings.end - ctx.t0)
                    const center = propAt(entry.node, 'x', time) + propAt(label, 'x', time)
                    let lift = 0
                    for (const other of path.others) {
                        const otherCenter = propAt(other.node, 'x', time) + propAt(other.label!, 'x', time)
                        const gap = Math.abs(center - otherCenter) - (entry.width + other.width) / 2
                        lift = Math.max(lift, Math.min(1, 1 - gap / this.size))
                    }
                    const rest = startY + (y - startY) * ctx.ease(progress)
                    return rest + (crossingY - rest) * lift
                } })
            } else if (Math.abs(startY - y) > 0.01) {
                label.tween('y', y, ctx.t0, ctx.t1, ctx.ease)
            }
        })
    }

    // ── What the line draws again on each frame ───────────────────────────

    /** The color of a point in a band: its own, or that of the band. */
    private colorIn(entry: PointEntry, band: number): Paint {
        if (entry.color !== undefined) return toPaint(entry.color)
        const own = this.bands[band]?.color
        if (own !== undefined) return toPaint(own)
        // On a line with a band color, a point in a band with none is neutral. On a line with none, it is the yellow of a marker.
        return toPaint(this.bands.some((one) => one.color !== undefined) ? 'ink' : 'yellow')
    }

    private crossingAt(entry: PointEntry, time: number): Crossing {
        const bandAt = (t: number) => this.bandFor(entry.at.track.sample(t), t)
        const now = bandAt(time)
        const frozen = entry.snapshot
        if (frozen && now === frozen.crossing.now) {
            const share = frozen.crossing.share + Math.max(0, time - frozen.resume) / CROSS
            if (time < frozen.resume || share < 1) return { ...frozen.crossing, share }
        }
        let before = now, share = 1
        if (this.cuts.length > 0 && bandAt(time - CROSS) !== now) {
            // The moment of the crossing: the last time in this window at which the point was in another band.
            let low = time - CROSS, high = time
            for (let pass = 0; pass < 14; pass++) {
                const middle = (low + high) / 2
                if (bandAt(middle) === now) high = middle
                else low = middle
            }
            before = bandAt(low)
            share = Math.min(1, Math.max(0, (time - high) / CROSS))
        }
        return { before, now, share }
    }

    /** The dot takes the look of its new band over the course of a crossing. */
    private drawDot(id: number, time: number): Node[] | null {
        const entry = this.entries.find((one) => one.id === id)
        if (!entry) return null
        const { before, now, share } = this.crossingAt(entry, time)
        const paint = share >= 1 ? this.colorIn(entry, now) : mixPaint(this.colorIn(entry, before), this.colorIn(entry, now), share)
        const hollowOf = (band: number) => (this.bands[band]?.hollow ? 1 : 0)
        const hollow = hollowOf(before) + (hollowOf(now) - hollowOf(before)) * share
        // At a crossing the dot swells for a moment, in the room between it and its name, so the eye finds the point that changed.
        const r = this.radius * (share >= 1 ? 1 : 1 + 0.4 * Math.sin(Math.PI * share)), rim = Math.max(3, r * 0.32)
        return [new Node(circlePath(0, 0, r - rim / 2)).fill(hollow <= 0 ? paint : mixPaint(paint, toPaint('bg'), hollow)).stroke(paint, rim)]
    }

    /** The line from a dot to its name, when the name is not right over the dot. */
    private drawStem(id: number, time: number): Node | null {
        const entry = this.entries.find((one) => one.id === id)
        const label = entry?.label
        if (!entry || !label) return null
        // A dot that travels has no line to its name: the line would pass through the names that the dot passes.
        if (this.traveling(entry, time)) return null
        const x = propAt(label, 'x', time), y = propAt(label, 'y', time)
        // At the first height, the name is at its dot, in the middle or at one side: it needs no line.
        if (y > this.nameY(1) - 1) return null
        const over = Math.abs(x) <= entry.width / 2
        const end = over ? y + this.size * 0.62 : y
        return line([0, -this.radius - 3], [0, end], { stroke: 'faint', width: 1.5 })
    }

    private traveling(entry: PointEntry, time: number): boolean {
        if (entry.snapshot && time < entry.snapshot.resume) return entry.snapshot.traveling
        return Math.abs(propAt(entry.node, 'x', time) - propAt(entry.node, 'x', time - 1 / 240)) > 1e-6
    }

    /** The shade of each band that has a color, from the line up to the top of the names. */
    private drawShade(time: number): Node[] {
        // The renderer can seek between the samples of a custom easing function.
        const edges = [this.range[0], ...this.orderedThresholds(time), this.range[1]]
        const out: Node[] = []
        this.bands.forEach((band, index) => {
            if (band.color === undefined) return
            const x0 = this.p(edges[index]!)[0], x1 = this.p(edges[index + 1]!)[0]
            if (x1 - x0 < 0.5) return
            out.push(new Node(rectPath(x0, -this.panelTop, x1 - x0, this.panelTop + 12)).fill(band.color, SHADE))
        })
        return out
    }

    /** The patch behind each name that the line of a threshold is behind at this time: the background, with the shade of each band that the name is over. */
    private drawPatches(time: number): Node[] {
        const size = this.size, half = this.length / 2
        const walls = this.cuts.map((cut) => this.p(cut.at.track.sample(time))[0])
        const edges = [-half, ...walls, half]
        const ground = solidColor(toPaint('bg'))
        const out: Node[] = []
        for (const entry of this.entries) {
            const label = entry.label
            // A name that fades in has its patch from the start, so no line shows through it while it comes.
            if (!label || !entry.node.parent || propAt(entry.node, 'opacity', time) * propAt(label, 'opacity', time) < 0.05) continue
            const visible = entry.node.tracks?.get('visible')
            if (visible ? !visible.sample(time) : !entry.node.base.visible) continue
            const x = propAt(entry.node, 'x', time) + propAt(label, 'x', time), y = propAt(label, 'y', time)
            const x0 = x - entry.width / 2 - size * 0.2, x1 = x + entry.width / 2 + size * 0.2
            if (!walls.some((wall) => wall > x0 - 2 && wall < x1 + 2)) continue
            // One patch in the background hides the line. Over it, the shade of each band that the name is over, as beside the patch.
            out.push(new Node(rectPath(x0, y - size * 0.5, x1 - x0, size * 1.14)).fill(ground))
            this.bands.forEach((band, index) => {
                const from = Math.max(x0, edges[index]!), to = Math.min(x1, edges[index + 1]!)
                if (band.color === undefined || to - from < 0.2) return
                out.push(new Node(rectPath(from, y - size * 0.5, to - from, size * 1.14)).fill(band.color, SHADE))
            })
        }
        return out
    }

    /** The name and the number of each band as texts, and the room of each pair. */
    private captionParts(counts: readonly number[]): { made: { name: Node | null; number: Node | null; nameWidth: number; width: number }[]; gap: number } {
        const size = this.size, gap = size * 0.35
        // The room of the widest number, so a name does not move when a count gets a digit.
        const widest = this.counts ? text('8'.repeat(String(Math.max(1, this.entries.length)).length), { size, font: this.font, weight: 600 }).bounds().width : 0
        const made = this.bands.map((band, index) => {
            const color = band.color ?? 'ink'
            const name = band.name === undefined ? null : text(band.name, { size, font: this.font, color, anchor: 'left' })
            const number = this.counts ? text(String(counts[index] ?? 0), { size, font: this.font, color, weight: 600, anchor: 'left' }) : null
            const nameWidth = name ? name.bounds().width : 0
            return { name, number, nameWidth, width: nameWidth + (name && number ? gap : 0) + widest }
        })
        return { made, gap }
    }

    /** The name of each band under the line, with the number of its points. The first is at the left end, the last at the right end, and one between them is under the middle of its band. */
    private drawCaptions(time: number): Node[] {
        const size = this.size, half = this.length / 2
        const edges = [this.range[0], ...this.cuts.map((cut) => cut.at.track.sample(time)), this.range[1]].map((value) => this.p(value)[0])
        const counts = this.bands.map(() => 0)
        if (this.counts) for (const entry of this.entries) if (entry.alive.sample(time)) counts[this.bandFor(entry.at.track.sample(time), time)]++
        const { made, gap } = this.captionParts(counts)
        const last = made.length - 1
        // Each caption wants the middle of its band. The two at the ends are at the ends of the line.
        const lefts = made.map((one, index) => (index === 0 ? -half : index === last ? half - one.width : (edges[index]! + edges[index + 1]!) / 2 - one.width / 2))
        for (let index = 1; index < last; index++) lefts[index] = Math.max(lefts[index]!, lefts[index - 1]! + made[index - 1]!.width + size)
        for (let index = last - 1; index > 0; index--) lefts[index] = Math.min(lefts[index]!, lefts[index + 1]! - made[index]!.width - size)
        const out: Node[] = []
        made.forEach((one, index) => {
            let x = lefts[index]!
            if (one.name) {
                out.push(one.name.at(x, this.captionY))
                x += one.nameWidth + gap
            }
            if (one.number) out.push(one.number.at(x, this.captionY))
        })
        return out
    }

    /** Keep extra digits when rounding would hide a gap or put the cutoff on the wrong side of a point. */
    private readout(value: number, thresholdTime?: number): string {
        if (typeof this.readoutFormat === 'function') return this.readoutFormat(value)
        // Like toFixed, keep very large values in exponential notation.
        if (Math.abs(value) >= 1e21) return String(value)
        const label = this.readoutFormat.format(value === 0 ? 0 : value)
        const rounded = Number(label)
        if (rounded === value) return label
        if (rounded === 0) return String(value)
        if (thresholdTime !== undefined) {
            for (const point of this.entries) {
                if (!point.alive.sample(thresholdTime)) continue
                const score = point.at.track.sample(thresholdTime)
                if (Math.sign(rounded - score) !== Math.sign(value - score)) return String(value)
            }
        }
        return label
    }

    /** The label of a threshold over its line: its word and its value at this time. Near an end of the line, it stays over the line. */
    private drawThresholdLabel(index: number, time: number): Node | null {
        const cut = this.cuts[index]
        if (!cut) return null
        const value = cut.at.track.sample(time)
        const words = [cut.label, cut.readout ? String(this.readout(value, time)) : undefined].filter((part) => part !== undefined && part !== '').join(' ')
        if (words === '') return null
        const made = text(words, { size: this.size, font: this.font, color: cut.color })
        const half = made.bounds().width / 2, x = this.p(value)[0], end = this.length / 2
        const center = half > end ? 0 : Math.min(Math.max(x, -end + half), end - half)
        // Two thresholds that are near have their labels at two heights.
        return made.at(center - x, -(this.panelTop + this.size * 0.95 + (index % 2) * this.size * 1.25))
    }

    /** The value of an end of a bracket at a time: a value, or the value of a point. Null when the point is gone. */
    private endAt(end: BracketEnd, time: number): number | null {
        if (typeof end === 'number') return end
        const entry = this.entries.find((one) => one.id === end.pointId)
        return entry && sampleAt(entry.node, 'visible', time) ? entry.at.track.sample(time) : null
    }

    private drawBracket(from: BracketEnd, to: BracketEnd, side: 'under' | 'over', offset: number, color: ColorInput, label: NumberLineBracketOptions['label'], time: number): Node[] | null {
        const a = this.endAt(from, time), b = this.endAt(to, time)
        if (a === null || b === null) return null
        const size = this.size, cap = size * 0.3, way = side === 'under' ? 1 : -1
        const x0 = this.p(Math.min(a, b))[0], x1 = this.p(Math.max(a, b))[0]
        const base = side === 'under'
            ? (this.captions ? this.captionY + size * 0.62 : this.numbersBottom) + size * 0.55 + offset
            : -((this.extent ? this.topRoom(this.cuts.length) : this.radius + size * 1.9) + size * 0.4 + offset)
        // The two short ends point at the line, so the bracket reads as a measure of the values on it.
        const mark = new Node(polyPath([[x0, base - way * cap], [x0, base], [x1, base], [x1, base - way * cap]])).stroke(color, Math.max(2.5, size * 0.09))
        const words = typeof label === 'function' ? label(Math.abs(b - a), a, b) : label ?? this.readout(Math.abs(b - a))
        if (words === undefined || words === null || String(words) === '') return [mark]
        return [mark, text(String(words), { size, font: this.font, color }).at((x0 + x1) / 2, base + way * size * 0.85)]
    }
}

/** One axis with ticks: `numberLine({ range: [0, 1], step: 0.25, points: [{ name: 'A', value: 0.3 }], thresholds: [0.5] })`. */
export function numberLine(options: NumberLineOptions = {}): NumberLine {
    return new NumberLine(options)
}
