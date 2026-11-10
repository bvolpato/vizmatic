import { Node, ownLabels, rebindCloneParts, type Edge } from '../node'
import { invert, linePath, polyPath, rectPath, transformPath, type Path, type Ring } from '../geometry'
import { line, rect } from '../shapes'
import { text, type TextOptions } from '../text'
import { toPaint, type ColorInput } from '../color'
import { clock, Track } from '../track'
import { Value, type Anim, type AnimContext, type AnimOptions } from '../anim'
import { Box } from '../layout'
import type { Stage } from '../stage'
import { lerpSame, reveal, staggered, stepAt, tweenValue } from './util'

export interface SegmentedBarPart {
    /** The name of the part, on one line. It is the label of the part, and the film names the part by it. No two parts of a bar have one name. */
    name: string
    /** The amount of the part, in the unit of the bar. 0 or more. */
    value: number
    /** Defaults to the next color of a fixed list. Red is not in the list: it is the color of the amount over the capacity. */
    color?: ColorInput
}

export interface SegmentedBarOptions {
    /** The width of the bar from 0 to `max`. All of the object is inside it, with its labels. Defaults to 1200. */
    width?: number
    /** The height of the bar. Defaults to 2.4 of `size`. */
    height?: number
    /**
     * The amount that the bar holds: a context window in tokens, the memory of a device, the time of a request.
     * The frame of the bar ends there, with a line, and the readout shows the total against it. Without it, the
     * bar has no limit: the frame goes to the right end of the object, and the bar draws no line and no readout.
     * The right end is then `max`, or the total of the parts, for shares of a whole.
     */
    capacity?: number
    /**
     * The amount at the right end of the object. Give more than `capacity` when the parts can add up to more
     * than the capacity: the amount over it then has room at the right of the frame. Defaults to `capacity`.
     * For a bar with no `capacity`, it is the amount that the parts can grow to.
     */
    max?: number
    /** The name of the bar, over its left end. */
    title?: string
    /** Show the total over the right end of the frame, such as "12,436 / 16,000". Defaults to true with a `capacity`, and to false without one. */
    readout?: boolean
    /** A name for the room that the parts leave free, such as 'free'. The free room then has a label with its amount. Without it, the room has no label. */
    free?: string
    /** The word of the readout for the amount over the capacity. Defaults to 'over'. */
    over?: string
    /** How to write an amount. Defaults to a number with the most decimals of the values that the bar is made with, and with commas. */
    format?: (value: number) => string
    /** False draws no label under the parts: for a small bar whose parts a film names itself. Defaults to true. */
    labels?: boolean
    /** Text size of the names, the amounts, the title and the readout. Defaults to 28. */
    size?: number
    /** The font of the names and the title. The amounts are in mono. */
    font?: TextOptions['font']
}

/** What `find()` gives its function for each part. */
export interface SegmentedBarPartState {
    name: string
    value: number
    /** The value as a part of the total of the bar, 0 to 1. */
    share: number
    /** Where the part starts and ends, as amounts from the left end of the bar. */
    from: number
    to: number
    /** The place of the part in the bar. The first part, at the left, is 0. */
    index: number
}

// The colors of the parts that name none, in order. Red is not one of them: red is the amount over the capacity.
const COLORS: readonly ColorInput[] = ['blue', 'teal', 'yellow', 'purple', 'green', 'orange']
// The sizes of the layout, as parts of the text size.
// From the line of a name to the line of its amount.
const LINE = 1.25
// The room between two labels in the row under the bar. It is more than the room between two words.
const APART = 0.9
// The length of the line from a part to its label, and of the straight piece at each of its ends.
const LEADER = 1.4, STUB = 0.3
// How far the line of the capacity goes over the bar and under it.
const POST = 0.25
// The room between a text and the nearest mark.
const CLEAR = 0.3
// A label fades in the last part of the time in which its room opens, so it is not over its neighbors.
const LATE = 0.7
// The room of a label opens in the first part of the time of a part that arrives, so the part has its name while
// it grows. The label of a part that leaves stays for the same part of the time, and its room closes after it.
const NAMED = 0.4
// The fill of a part. A solid fill of a large area is too bright on a dark look.
const FILL = 0.86
// Two changes that are this near in time follow each other.
const SOON = 1e-6

interface Entry {
    name: string
    color: ColorInput
    /** The amount after the changes that are scheduled so far. */
    value: number
    /** True while the bar has the part, after the changes that are scheduled so far. */
    here: boolean
    /** A zero amount alone cannot distinguish an empty part from a part that has left. */
    present: Track<boolean>
    /** The amount at each time. */
    amount: Value
    /** How much of the room of its label the part has at each time, 0 to 1. */
    show: Value
    /** False while a box that travels to another bar stands for the box of the part. */
    box: Track<boolean>
    /** The node of the part: its box and its label. */
    node: Node
    /** The width of the room of its label. */
    wide: number
    /** The last change of the part, to refuse a change that starts before it is over. */
    last: { call: string; t0: number; t1: number } | null
}

/** A part at one time: its ends in the coordinates of the bar, and the middle of its label. */
interface Slot {
    entry: Entry | null
    from: number
    to: number
    amount: number
    show: number
    wide: number
    x: number
}

interface Layout {
    slots: Slot[]
    total: number
    /** The free room, when it has a name. */
    free: Slot | null
    /** The width that the labels need in one row. */
    need: number
}

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value))
/** A value as the film wrote it, for an error. */
const shown = (value: unknown) => (typeof value === 'string' ? JSON.stringify(value) : String(value))
const seconds = (time: number) => `${Math.round(time * 100) / 100} s`

/** How many decimals a number is written with, 3 at most. */
function decimalsOf(value: number): number {
    const written = String(value), dot = written.indexOf('.')
    return dot < 0 || written.includes('e') ? 0 : Math.min(3, written.length - dot - 1)
}

/** A number with a fixed count of decimals, and commas in its whole part. A count that runs then keeps its width. */
function fixed(digits: number): (value: number) => string {
    return (value) => {
        const [whole, part] = Math.abs(value).toFixed(digits).split('.')
        return whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (part ? `.${part}` : '')
    }
}

/**
 * The middles of labels in one row. Each one is as near to its target as the others allow: they keep their
 * order, two of them keep their room, and none passes an end of the row. `halves` holds half of the width of
 * each label, and `gaps` the room after each one. Without room for all, they stand side by side around the middle.
 */
function spread(targets: readonly number[], halves: readonly number[], gaps: readonly number[], left: number, right: number): number[] {
    const count = targets.length
    if (count === 0) return []
    // The middle of each label, when the labels stand side by side and the first one is at 0.
    const steps = [0]
    for (let i = 1; i < count; i++) steps.push(steps[i - 1]! + halves[i - 1]! + gaps[i - 1]! + halves[i]!)
    const low = left + halves[0]!, high = right - halves[count - 1]! - steps[count - 1]!
    if (high < low) return steps.map((step) => (low + high) / 2 + step)
    // With its step taken away, the place of each label must not be under the place of the label before it.
    // The nearest such places to the targets are the means of runs of labels that push each other.
    const runs: { sum: number; count: number }[] = []
    for (let i = 0; i < count; i++) {
        runs.push({ sum: targets[i]! - steps[i]!, count: 1 })
        while (runs.length > 1 && runs[runs.length - 2]!.sum / runs[runs.length - 2]!.count > runs[runs.length - 1]!.sum / runs[runs.length - 1]!.count) {
            const last = runs.pop()!, before = runs[runs.length - 1]!
            before.sum += last.sum
            before.count += last.count
        }
    }
    const out: number[] = []
    for (const run of runs) {
        const place = clamp(run.sum / run.count, low, high)
        for (let k = 0; k < run.count; k++) out.push(place + steps[out.length]!)
    }
    return out
}

/** Diagonal lines over a box. A line holds the points where x + y is one sum, so the lines stand still while the box grows. */
function hatch(left: number, top: number, width: number, height: number, step: number): Path {
    const right = left + width, bottom = top + height
    const rings: Ring[] = []
    for (let sum = Math.ceil((left + top) / step) * step; sum < right + bottom; sum += step) {
        const from = Math.max(left, sum - bottom), to = Math.min(right, sum - top)
        if (to - from > 1) rings.push(...linePath([from, sum - from], [to, sum - to]))
    }
    return rings
}

/**
 * One bar in named parts, drawn to scale: a budget against a capacity, such as a context window in tokens or
 * the memory of a device, or shares that add up to one. A part keeps its name and its color while its amount
 * changes. `resize()` grows or shrinks parts, `insert()` and `remove()` bring a part and take one out, `cut()`
 * takes parts out and gives their room to the rest, and `send()` moves a part to another bar. The amount over
 * the capacity stands at the right of the frame, in red with a hatch, and the readout says how much it is.
 * Each part has its name and its amount under it, and the object keeps two labels apart. `.at()` places the
 * middle of the bar from 0 to `max`.
 */
export class SegmentedBar extends Node {
    /** The outline of the bar from 0 to the capacity, with the fill of the free room. */
    readonly frame: Node
    /** The line at the capacity, or null for a bar that was made with no `capacity`. */
    readonly limit: Node | null = null
    /** The name of the bar, or null. */
    readonly title: Node | null = null
    /** The total against the capacity, or null. It is drawn again for each frame. */
    readonly readout: Node | null = null
    /** The amount that the bar holds. */
    readonly capacity: number
    /** The amount at the right end of the object. */
    readonly max: number
    /** The nodes of the parts are its children. */
    private readonly layer = new Node()
    /** The label of the free room, or null. */
    private readonly rest: Node | null = null
    /** Every part that the bar had, in the order in which they came. A node finds its part by its index here. */
    private entries: Entry[] = []
    /** The parts from the left to the right, with the parts that left. */
    private order: Entry[] = []
    private readonly w: number
    private readonly h: number
    private readonly size: number
    private readonly font: TextOptions['font']
    private readonly format: (value: number) => string
    private readonly limited: boolean
    private readonly showLabels: boolean
    private readonly freeName: string | undefined
    private readonly overWord: string
    /** The widths of the border of the frame, of the room between two parts, and of the line to a label. */
    private readonly border: number
    private readonly seam: number
    private readonly hair: number
    /** The room that an amount takes in a label: the width of the widest amount that the bar can hold. */
    private readonly valueRoom: number
    /** The width of the room of the label of the free room, and the width of the title. 0 for a bar that has none. */
    private readonly freeWide: number
    private readonly titleWide: number
    /** The y of the line of the title, of the names, and of the amounts. */
    private readonly titleY: number
    private readonly nameY: number
    private readonly valueY: number
    /** The top and the bottom of the two lines of a label. */
    private readonly labelTop: number
    private readonly labelBottom: number
    /** The layout of the last time that a frame asked for, and the count of changes that it was made with. */
    private cache: { time: number; version: number; layout: Layout } | null = null
    private version = 0
    /** The stage that looks at the sum of the parts when its film is built. */
    private watched: Stage | null = null

    constructor(parts: readonly SegmentedBarPart[], options: SegmentedBarOptions = {}) {
        super()
        if (!Array.isArray(parts)) throw new Error(`segmentedBar: the first argument is the list of the parts, such as [{ name: 'history', value: 8200 }], and it is ${shown(parts)}`)
        const size = this.size = options.size ?? 28
        if (!(Number.isFinite(size) && size > 0)) throw new Error('segmentedBar: size is a text size, more than 0')
        const width = this.w = options.width ?? 1200
        if (!(Number.isFinite(width) && width > 0)) throw new Error('segmentedBar: width is the width of the bar, more than 0')
        const height = this.h = options.height ?? Math.round(size * 2.4)
        if (!(Number.isFinite(height) && height > 0)) throw new Error('segmentedBar: height is the height of the bar, more than 0')
        this.font = options.font
        this.showLabels = options.labels ?? true
        this.freeName = options.free
        this.overWord = options.over ?? 'over'
        for (const [name, word] of [['title', options.title], ['free', options.free], ['over', options.over]] as const) {
            if (word !== undefined && (typeof word !== 'string' || word.trim() === '' || /[\r\n]/.test(word))) throw new Error(`segmentedBar: ${name} is ${shown(word)}. Give one line of text`)
        }

        const specs = parts.map((part, index) => this.checked(part, `part ${index}`))
        specs.forEach((spec, index) => {
            if (specs.findIndex((other) => other.name === spec.name) !== index) throw new Error(`segmentedBar: two parts have the name ${JSON.stringify(spec.name)}. A name is the identity of a part: give each part its own name`)
        })
        const total = specs.reduce((sum, spec) => sum + spec.value, 0)
        this.limited = options.capacity !== undefined
        if (options.max !== undefined && !(Number.isFinite(options.max) && options.max > 0)) throw new Error(`segmentedBar: max is ${shown(options.max)}. Give the amount at the right end of the object, more than 0`)
        // A bar with no capacity has no limit, so no amount is over: its frame goes to its right end. With the
        // total of the parts as the capacity, parts that grow into the room of `max` would show as over a line that the bar does not draw.
        const capacity = this.capacity = options.capacity ?? options.max ?? total
        if (!(Number.isFinite(capacity) && capacity > 0)) {
            throw new Error(this.limited ? `segmentedBar: capacity is ${shown(options.capacity)}. Give the amount that the bar holds, more than 0` : 'segmentedBar: the parts add up to 0, so the bar has no scale. Give a capacity, or a part with a value')
        }
        const max = this.max = options.max ?? capacity
        if (max < capacity) throw new Error(`segmentedBar: max is ${max}, and the capacity is ${capacity}. max is the amount at the right end of the object: give the capacity or more`)
        this.format = options.format ?? fixed(Math.max(0, ...[capacity, max, ...specs.map((spec) => spec.value)].map(decimalsOf)))
        if (typeof this.format !== 'function') throw new Error('segmentedBar: format is a function that writes an amount, such as (value) => `${value} GB`')
        // The text of an amount is measured and drawn, so a format that gives a number would stop the film with an error of the text.
        const written: unknown = this.format(capacity)
        if (typeof written !== 'string') throw new Error(`segmentedBar: format gave ${shown(written)} for the amount ${capacity}. A format gives a text, such as (value) => \`\${value} GB\``)
        if (total > max + this.slack) throw new Error(this.tooMuch(total, specs.map((spec) => spec.name)))

        this.border = Math.min(height / 2, Math.max(2, size * 0.08))
        this.seam = Math.max(3, size * 0.12)
        this.hair = Math.max(1.5, size * 0.07)
        // The highest and the lowest point of the letters of the two fonts, from the place that `.at()` gives a
        // text. They are measured, so the rows have the right room in each font.
        const reach = [text('0', { size, font: this.font }), text('0', { size, font: 'mono' })].map((probe) => [probe.get('py') - probe.letters[0], probe.letters[1] - probe.get('py')] as const)
        const up = Math.max(...reach.map((own) => own[0])), down = Math.max(...reach.map((own) => own[1]))
        this.titleY = -height / 2 - size * (POST + CLEAR) - down
        this.nameY = height / 2 + size * (LEADER + CLEAR) + up
        this.valueY = this.nameY + size * LINE
        this.labelTop = this.nameY - up
        this.labelBottom = this.valueY + down
        this.valueRoom = Math.max(...[0, capacity, max].map((value) => this.widthOf(this.format(value), 'mono')))
        this.freeWide = this.freeName === undefined ? 0 : Math.max(this.widthOf(this.freeName, this.font), this.valueRoom)

        const left = -width / 2, frameWidth = this.x(capacity) - left
        this.frame = rect(frameWidth, height, { radius: Math.min(height / 2, size * 0.2), fill: 'surface', stroke: 'gridStrong', width: this.border }).at(left + frameWidth / 2, 0)
        this.add(this.frame, this.layer)
        if (this.limited) {
            const post = height / 2 + size * POST
            this.limit = line([this.x(capacity), -post], [this.x(capacity), post], { stroke: 'ink', width: Math.max(3, size * 0.11) })
            // A flat end stops where the line is measured, so the readout has its room over it.
            this.limit.set('cap', 'butt')
            this.add(this.limit)
        }
        specs.forEach((spec) => this.put(this.entryOf(spec, this.partNode(), spec.value, 1), this.order.length))
        if (this.showLabels && this.freeName !== undefined) {
            this.rest = this.drawn((bar, _own, time) => bar.restAt(time))
            this.add(this.rest)
        }
        const need = this.rowOf(this.order.map((entry) => ({ wide: entry.wide, show: 1 })).concat(this.rest ? [{ wide: this.freeWide, show: 1 }] : []))
        if (this.showLabels && need > width + 0.5) throw new Error(this.tooWide(need, this.order.length))

        const readout = options.readout ?? this.limited
        const titleWidth = this.titleWide = options.title === undefined ? 0 : this.widthOf(options.title, this.font)
        if (options.title !== undefined) {
            this.title = text(options.title, { size, font: this.font, color: 'dim', anchor: 'left' }).at(left, this.titleY)
            this.add(this.title)
        }
        if (readout) {
            // The widest text of the readout: the bar full to its right end.
            const widest = this.widthOf(this.readoutWords(max), 'mono')
            if (titleWidth + (titleWidth > 0 ? size : 0) + widest > frameWidth) {
                throw new Error(`segmentedBar: ${titleWidth > 0 ? 'the title and the readout need' : 'the readout needs'} ${Math.ceil(titleWidth + (titleWidth > 0 ? size : 0) + widest)} px over the bar, and the bar is ${Math.floor(frameWidth)} px wide up to its capacity. Give a larger width, a smaller size${titleWidth > 0 ? ', a shorter title' : ''}, or readout: false`)
            }
            this.readout = this.drawn((bar, _own, time) => bar.readoutAt(time))
            this.add(this.readout)
        } else if (titleWidth > width) {
            throw new Error(`segmentedBar: the title is ${Math.ceil(titleWidth)} px wide, and the bar is ${width} px wide. Give a shorter title, a larger width, or a smaller size`)
        }

        // The layout measures the room that the object can take at any time: the bar to its right end, the row
        // over it, and the labels under it. So a bar that starts empty has its place for the parts that come.
        const top = this.title || this.readout ? this.titleY - up : -height / 2 - (this.limit ? size * POST : this.border / 2)
        const bottom = this.showLabels ? this.labelBottom : height / 2 + (this.limit ? size * POST : this.border / 2)
        this.layoutBox = [left - this.border / 2, top, width / 2 + this.border / 2, bottom]
        // The object places the names and the amounts under its parts, and the title and the readout over its frame. The film check does not judge that room.
        ownLabels(this, { name: 'segmented bar', labels: [this.title, this.readout, this.rest, ...this.order.map((entry) => entry.node.children[1]!)] })
    }

    /** The names of the parts from the left to the right, after the changes that are scheduled so far. */
    get names(): string[] {
        return this.order.filter((entry) => entry.here).map((entry) => entry.name)
    }

    /** The number of parts, after the changes that are scheduled so far. */
    get count(): number {
        return this.names.length
    }

    /** The sum of the amounts of the parts, after the changes that are scheduled so far. */
    get total(): number {
        return this.order.reduce((sum, entry) => sum + (entry.here ? entry.value : 0), 0)
    }

    /** The room that the parts leave under the capacity, after the changes that are scheduled so far. 0 for a bar that is full or over. */
    get free(): number {
        const free = this.capacity - this.total
        return free > this.slack ? free : 0
    }

    /** The amount over the capacity, after the changes that are scheduled so far. 0 for a bar that is not over. */
    get over(): number {
        const over = this.total - this.capacity
        return over > this.slack ? over : 0
    }

    /** True when the bar has a part of this name, after the changes that are scheduled so far. */
    has(name: string): boolean {
        return this.order.some((entry) => entry.here && entry.name === name)
    }

    /** The amount of a part, after the changes that are scheduled so far. */
    amount(name: string): number {
        return this.partNamed(name, 'amount').value
    }

    /** Where a part starts and where it ends, as amounts from the left end of the bar, after the changes that are scheduled so far. */
    range(name: string): [number, number] {
        const entry = this.partNamed(name, 'range')
        let from = 0
        for (const other of this.order) {
            if (other === entry) break
            if (other.here) from += other.value
        }
        return [from, from + entry.value]
    }

    /**
     * The names of the parts that a function picks, from the left to the right, after the changes that are
     * scheduled so far: `bar.cut(bar.find((part) => part.share < 0.1))`. The function gets the name of a part,
     * its value, its share of the total, its two ends, and its index.
     */
    find(test: (part: SegmentedBarPartState) => boolean): string[] {
        if (typeof test !== 'function') throw new Error('segmentedBar: find takes a function of a part, such as (part) => part.share < 0.1')
        const total = this.total
        let from = 0, index = 0
        const out: string[] = []
        for (const entry of this.order) {
            if (!entry.here) continue
            if (test({ name: entry.name, value: entry.value, share: total > 0 ? entry.value / total : 0, from, to: from + entry.value, index })) out.push(entry.name)
            from += entry.value
            index++
        }
        return out
    }

    /**
     * The node of a part: its box and its label. Fade it, light it with `spotlight`, or give it to a
     * `connector`. A part that left the bar has no node.
     */
    part(name: string): Node {
        return this.partNamed(name, 'part').node
    }

    /** The x of an amount, in the coordinates of the object. The middle of the bar from 0 to `max` is at 0. */
    x(value: number): number {
        if (!(Number.isFinite(value) && value >= 0 && value <= this.max + this.slack)) throw new Error(`segmentedBar: x: the amount is ${shown(value)}. The bar goes from 0 to ${this.max}`)
        return -this.w / 2 + (value / this.max) * this.w
    }

    /**
     * The middle of an edge of the box of a part, in the coordinates of the object, after the changes that are
     * scheduled so far: the point where a line to the part ends. Defaults to the top edge, because the labels
     * are under the bar. The point does not follow the part: read it again after the next change.
     */
    p(name: string, edge: Edge = 'top'): [number, number] {
        const [from, to] = this.range(name).map((value) => this.x(Math.min(value, this.max))) as [number, number]
        if (edge === 'top') return [(from + to) / 2, -this.h / 2]
        if (edge === 'bottom') return [(from + to) / 2, this.h / 2]
        if (edge === 'left') return [from, 0]
        if (edge === 'right') return [to, 0]
        throw new Error(`segmentedBar: the edge of p() is 'top', 'bottom', 'left' or 'right', not ${shown(edge)}`)
    }

    /**
     * The box of a piece of the bar, in stage pixels, for `place` and `beside`, and for the ends of a `brace`: such as
     * `beside(note, bar.region({ part: 'history' }), 'above')`. Without a piece it is the frame, from 0 to the
     * capacity. `part` is the box of one part, and `label` is the box of its label under the bar: the place
     * for a note under a part, because the label of a narrow part is not under its box. `from` and `to` are
     * amounts, and `at` is one amount. The box is where the bar is now, after the changes that are scheduled
     * so far, so ask for it after the bar has its place.
     */
    region(piece: { part?: string; label?: string; from?: number; to?: number; at?: number } = {}): Box {
        const names = ['part', 'label', 'from', 'to', 'at']
        if (typeof piece !== 'object' || piece === null) throw new Error(`segmentedBar: region takes an object such as { part: 'history' }, and it got ${piece === null ? 'null' : typeof piece}`)
        const unknown = Object.keys(piece).find((name) => !names.includes(name))
        if (unknown !== undefined) throw new Error(`segmentedBar: region has no piece "${unknown}". Its pieces are: ${names.join(', ')}`)
        const amounts = piece.from !== undefined || piece.to !== undefined
        if (piece.label !== undefined) {
            if (piece.part !== undefined || amounts || piece.at !== undefined) throw new Error('segmentedBar: region takes `label` for the label of one part, with no other piece')
            const entry = this.partNamed(piece.label, 'region')
            if (!this.showLabels) throw new Error(`segmentedBar: region: the bar draws no labels (labels: false), so the label of ${JSON.stringify(piece.label)} has no place. Use { part: ${JSON.stringify(piece.label)} } for the box of the part`)
            // The labels after the changes that are scheduled so far: the layout at the end of the last one.
            const slot = this.layoutAt(Number.POSITIVE_INFINITY).slots.find((own) => own.entry === entry)
            const middle = slot ? slot.x : this.p(piece.label, 'bottom')[0]
            return this.worldBox(middle - entry.wide / 2, this.labelTop, middle + entry.wide / 2, this.labelBottom)
        }
        if (piece.part !== undefined && (amounts || piece.at !== undefined)) throw new Error('segmentedBar: region takes `part` for one part, or amounts with `from`, `to` and `at`, not both')
        if (piece.at !== undefined && amounts) throw new Error('segmentedBar: region takes `at` for one amount, or `from` and `to` for a stretch, not both')
        const [from, to] = piece.part !== undefined ? this.range(piece.part).map((value) => Math.min(value, this.max)) as [number, number] : [piece.at ?? piece.from ?? 0, piece.at ?? piece.to ?? this.capacity]
        if (from > to) throw new Error(`segmentedBar: region: \`from\` is ${from} and \`to\` is ${to}. Give a \`from\` that is not after \`to\``)
        return this.worldBox(this.x(from), -this.h / 2, this.x(to), this.h / 2)
    }

    /** The label of a part belongs to its box, so a light on the box keeps the label bright. */
    override labelsOf(part: Node): readonly Node[] {
        const entry = this.entries.find((own) => own.node.children[0] === part)
        return entry ? [entry.node.children[1]!] : []
    }

    /** A parent can clone the whole group. Snapshot both the visible values and the membership at that time. */
    protected override [rebindCloneParts](copy: this, copies: ReadonlyMap<Node, Node>): void {
        const entries = new Map<Entry, Entry>()
        copy.entries = this.entries.map((entry) => {
            const value = Math.max(0, entry.amount.value)
            const here = entry.present.sample(clock.now)
            const snapshot = {
                ...entry, value, here, last: null,
                present: new Track(here), amount: new Value(value), show: new Value(entry.show.value),
                box: new Track(entry.box.sample(clock.now)),
                node: copies.get(entry.node)!,
            }
            entries.set(entry, snapshot)
            return snapshot
        })
        copy.order = this.order.map((entry) => entries.get(entry)!)
        copy.cache = null
        copy.watched = null
    }

    /** The frame arrives, and then the parts grow from the left, one after another, each with its label. The total counts up with them. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'segmentedBar.enter', duration: options.duration ?? 1.4, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                for (const node of [this.frame, this.limit, this.title, this.readout, this.rest]) {
                    if (!node) continue
                    stepAt(node, 'opacity', 0, ctx.t0)
                    node.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.3, ctx.ease)
                }
                const here = this.order.filter((entry) => entry.here)
                const windows = staggered(here.length, Math.max(0, options.lag ?? 0.5), ctx.t0 + span * 0.15, ctx.t1)
                here.forEach((entry, index) => {
                    const [start, end] = windows[index]!
                    this.claim(entry, 'enter()', ctx)
                    entry.amount.track.step(ctx.t0, 0)
                    tweenValue(entry.amount, entry.value, start, end, ctx.ease)
                    entry.show.track.step(ctx.t0, 0)
                    tweenValue(entry.show, 1, start, start + (end - start) * NAMED, ctx.ease)
                })
                this.changed(ctx)
            },
        }
    }

    /**
     * Parts take new amounts: `resize('cache', 4)` for one part, or `resize({ weights: 3.4, cache: 4 })` for
     * several at one time. Each box grows or shrinks to scale, the parts at its right move, and the amounts
     * and the total count. A total over the capacity shows as over, and it needs a `max` that has room for it.
     */
    resize(name: string, value: number, options?: AnimOptions): Anim
    resize(values: Readonly<Record<string, number>>, options?: AnimOptions): Anim
    resize(first: string | Readonly<Record<string, number>>, second?: number | AnimOptions, third?: AnimOptions): Anim {
        const one = typeof first === 'string'
        if (!one && (typeof first !== 'object' || first === null || Array.isArray(first))) throw new Error(`segmentedBar: resize takes the name of a part and its new value, or an object of names and values such as { cache: 4 }. It got ${shown(first)}`)
        const changes: [string, number][] = one ? [[first, second as number]] : Object.entries(first)
        const options = ((one ? third : second) ?? {}) as AnimOptions
        if (changes.length === 0) throw new Error('segmentedBar: resize got no part. Give names and values, such as { cache: 4 }')
        // A previous step of a sequence can add or remove the part before this resize plays.
        for (const [name, value] of changes) {
            this.checkName(name, 'resize')
            this.amountOk(value, `resize: the new value of ${JSON.stringify(name)}`)
        }
        return {
            label: 'segmentedBar.resize', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                for (const [name, value] of changes) {
                    const entry = this.partNamed(name, 'resize')
                    this.claim(entry, `resize(${JSON.stringify(name)})`, ctx)
                    tweenValue(entry.amount, value, ctx.t0, ctx.t1, ctx.ease)
                    entry.value = value
                }
                this.changed(ctx)
            },
        }
    }

    /**
     * A part arrives: its box grows from nothing at its place, the parts at its right move, and its label
     * comes when it has room. `before` names the part that it goes in front of. Without it, the part goes to
     * the right end. A part that makes the total pass the capacity shows as over.
     */
    insert(part: SegmentedBarPart, options: AnimOptions & { before?: string } = {}): Anim {
        const spec = this.checked(part, 'insert: the part')
        if (options.before !== undefined) this.checkName(options.before, 'insert')
        return {
            label: 'segmentedBar.insert', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                const at = this.arrivalIndex(spec.name, options.before, 'insert', ctx.t0)
                reveal(this, ctx.t0, ctx.stage)
                const entry = this.entryOf(spec, this.partNode(), 0, 0)
                this.put(entry, at, ctx.t0)
                tweenValue(entry.amount, spec.value, ctx.t0, ctx.t1, ctx.ease)
                tweenValue(entry.show, 1, ctx.t0, ctx.t0 + (ctx.t1 - ctx.t0) * NAMED, ctx.ease)
                entry.value = spec.value
                entry.last = { call: `insert(${JSON.stringify(spec.name)})`, t0: ctx.t0, t1: ctx.t1 }
                this.changed(ctx)
            },
        }
    }

    /**
     * Parts leave: each box shrinks to nothing, the parts at its right close the room, and its label goes.
     * The room that they leave is free. Give one name or a list. `cut()` gives the room to the parts that stay.
     */
    remove(names: string | readonly string[], options: AnimOptions = {}): Anim {
        const list = this.listed(names, 'remove')
        return {
            label: 'segmentedBar.remove', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                for (const name of list) {
                    const entry = this.partNamed(name, 'remove')
                    this.claim(entry, `remove(${JSON.stringify(name)})`, ctx)
                    this.leave(entry, ctx.t0, ctx.t1, ctx)
                }
                this.changed(ctx)
            },
        }
    }

    /**
     * Parts leave, and the parts that stay take their room: each one grows by the same factor, so the total
     * is what it was. It is a renormalization: the shares of a distribution after a mask, or after a cut at
     * a threshold. The cut parts shrink first, and the viewer sees the room that they leave. Then the rest grow.
     */
    cut(names: string | readonly string[], options: AnimOptions = {}): Anim {
        const list = this.listed(names, 'cut')
        return {
            label: 'segmentedBar.cut', duration: options.duration ?? 1.4, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const gone = list.map((name) => this.partNamed(name, 'cut'))
                const stay = this.order.filter((entry) => entry.here && !gone.includes(entry))
                const before = this.total, rest = stay.reduce((sum, entry) => sum + entry.value, 0)
                if (!(rest > 0)) throw new Error(`segmentedBar: cut: ${stay.length === 0 ? 'no part stays' : 'the parts that stay add up to 0'}, so nothing can take the room of the parts that go. Use remove() to take parts out and leave their room free`)
                const turn = ctx.t0 + (ctx.t1 - ctx.t0) * 0.45
                for (const entry of gone) {
                    this.claim(entry, `cut(${JSON.stringify(entry.name)})`, ctx)
                    this.leave(entry, ctx.t0, turn, ctx)
                }
                for (const entry of stay) {
                    this.claim(entry, 'cut()', ctx)
                    entry.value = (entry.value * before) / rest
                    tweenValue(entry.amount, entry.value, turn, ctx.t1, ctx.ease)
                }
                this.changed(ctx)
            },
        }
    }

    /**
     * A part moves to another bar: its box leaves this bar, travels, and lands at its place in the other one,
     * to the scale of that bar. The parts of this bar close its room, and the parts of the other bar make room.
     * The part keeps its name, its amount and its color. `before` names the part of the other bar that it
     * goes in front of. Without it, the part goes to the right end.
     */
    send(name: string, to: SegmentedBar, options: AnimOptions & { before?: string } = {}): Anim {
        this.checkName(name, 'send')
        if (!(to instanceof SegmentedBar)) throw new Error(`segmentedBar: send: the second argument is the bar that takes the part, and it is ${shown(to)}`)
        if (to === this) throw new Error('segmentedBar: send: the part is in this bar already. Give the other bar')
        if (options.before !== undefined) to.checkName(options.before, 'send')
        return {
            label: 'segmentedBar.send', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                const from = this.partNamed(name, 'send')
                const place = to.arrivalIndex(name, options.before, 'send', ctx.t0)
                this.claim(from, `send(${JSON.stringify(name)})`, ctx)
                reveal(this, ctx.t0, ctx.stage)
                reveal(to, ctx.t0, ctx.stage)
                const value = from.value, span = ctx.t1 - ctx.t0
                const node = to.partNode()
                const entry = to.entryOf({ name, value, color: from.color }, node, 0, 0)
                // The box that travels stands for the two boxes: the one that left, and the one that is not there yet.
                const start = this.slotAt(from, ctx.t0)
                from.box.step(ctx.t0, false)
                entry.box = new Track(false)
                entry.box.step(ctx.t1, true)
                to.put(entry, place, ctx.t0)
                // The box leaves first. Then the room in this bar closes, and the room in the other bar is open
                // before the box lands. The label goes before the room closes, and the new one comes when the room
                // is open, so no label counts an amount that the box does not have.
                const at = (share: number) => ctx.t0 + span * share
                tweenValue(from.show, 0, ctx.t0, at(0.25), ctx.ease)
                tweenValue(from.amount, 0, at(0.25), at(0.7), ctx.ease)
                from.value = 0
                from.here = false
                from.present.step(at(0.7), false)
                tweenValue(entry.amount, value, at(0.3), at(0.75), ctx.ease)
                tweenValue(entry.show, 1, at(0.6), ctx.t1, ctx.ease)
                entry.value = value
                entry.last = { call: `send(${JSON.stringify(name)})`, t0: ctx.t0, t1: ctx.t1 }

                // The carrier is under the stage root, so inherit each part's opacity up to that root once.
                const opacityOf = (box: Node): number => {
                    let alpha = 1
                    for (let own: Node | null = box; own && own !== ctx.stage.root; own = own.parent) {
                        if (!own.get('visible')) return 0
                        alpha *= own.get('opacity')
                    }
                    return alpha
                }
                const carrier = new Node()
                // The box is on its way from one bar to the other. The film check does not take it as a mark beside a text.
                carrier.data['decoration'] = true
                carrier.draw = (time) => {
                    const share = clamp(ctx.ease(span > 0 ? clamp((time - ctx.t0) / span) : 1))
                    // Both paths follow their bars and parents, including rotation and nonuniform scale.
                    const source = from.node.children[0]!, target = node.children[0]!
                    const a = transformPath(this.blockPath(start.from, start.to), source.worldMatrix())
                    // The place where the box lands follows the other bar, while its parts make room.
                    const landing = to.slotAt(entry, time), wide = (value / to.max) * to.w
                    if ((start.to - start.from) * (1 - share) + wide * share < 0.05) return null
                    const b = transformPath(to.blockPath(landing.from, landing.from + wide), target.worldMatrix())
                    const alpha = opacityOf(source), beta = opacityOf(target)
                    // The renderer applies the carrier's parents, so return the path in its own coordinates.
                    const path = transformPath(lerpSame(a, b)(share), invert(carrier.worldMatrix()))
                    return new Node(path).fill(from.color, FILL).opacity(alpha + (beta - alpha) * share)
                }
                ctx.stage.mountAt(carrier, ctx.t0)
                carrier.track('visible').step(ctx.t1, false)
                // For the lights of the film: the box is as bright as the part that it becomes.
                ctx.stage.marks.set(carrier, node)
                this.changed(ctx)
                to.changed(ctx)
            },
        }
    }

    /**
     * The end of each change: the frames are laid out again, and the bar asks its stage to look at the sum of
     * the parts when the film is built. The sum cannot be judged here. The changes of one play are scheduled
     * one after another, so a part that arrives is scheduled before the part that leaves in the same play.
     */
    private changed(ctx: AnimContext): void {
        this.version++
        if (this.watched === ctx.stage) return
        this.watched = ctx.stage
        ctx.stage.checks.push(() => this.settle(ctx.stage.fps))
    }

    /**
     * A spring can cross the end of the bar between its keys. Check the frames of each change and its
     * endpoints. A long hold adds no work.
     */
    private settle(fps: number): void {
        const marks = new Set<number>([0])
        for (const entry of this.order) {
            for (const key of [...entry.amount.track.keys, ...entry.show.track.keys]) {
                marks.add(key.t0).add(key.t1)
                const first = Math.ceil(key.t0 * fps), end = Math.ceil(key.t1 * fps)
                if (!(fps > 0 && Number.isSafeInteger(first) && Number.isSafeInteger(end))) {
                    throw new Error('segmentedBar: give the film a positive finite frame rate and each change a finite duration')
                }
                for (let frame = first; frame < end; frame++) marks.add(frame / fps)
            }
        }
        const times = [...marks].sort((a, b) => a - b)
        // The first time of the largest sum is the one to name: the change that starts there is the cause.
        let most = 0, when = 0, widest = 0, crowded = 0
        const look = (time: number) => {
            const layout = this.layoutAt(time)
            if (layout.total > most + this.slack) [most, when] = [layout.total, time]
            if (layout.need > widest + 0.5) [widest, crowded] = [layout.need, time]
        }
        times.forEach(look)
        if (most > this.max + this.slack) throw new Error(this.tooMuch(most, this.layoutAt(when).slots.filter((slot) => slot.amount > 0).map((slot) => slot.entry!.name), when))
        if (widest > this.w + 0.5) throw new Error(this.tooWide(widest, this.layoutAt(crowded).slots.filter((slot) => slot.show > 0).length, crowded))
    }

    /** A sum of amounts may differ from the capacity by the error of the arithmetic, and no more. */
    private get slack(): number {
        return (this.max ?? this.capacity) * 1e-9
    }

    /** The message for parts that pass the right end of the bar. It has the numbers as they are, because a format can round them to the same text. */
    private tooMuch(total: number, names: readonly string[], time?: number): string {
        const room = Math.ceil(total * 1000) / 1000
        const parts = names.length <= 6 ? `the parts ${names.map((name) => JSON.stringify(name)).join(', ')}` : `the ${names.length} parts from ${JSON.stringify(names[0])} to ${JSON.stringify(names[names.length - 1])}`
        return `segmentedBar: ${parts} add up to ${room}${time === undefined ? '' : ` at ${seconds(time)}`}, and the bar ends at ${this.max}. Give the bar max: ${room} or more: the amount over the capacity of ${this.capacity} then has room at the right of the frame`
    }

    private arrivalIndex(name: string, before: string | undefined, call: string, time: number): number {
        if (this.has(name)) throw new Error(`segmentedBar: ${call}: the bar has a part ${JSON.stringify(name)} already. A name is the identity of a part: give the part that arrives another name, or change the part with resize()`)
        const departing = this.entries.find((entry) => entry.name === name && entry.last && time < entry.last.t1 - SOON)
        if (departing) throw new Error(`segmentedBar: ${call} brings ${JSON.stringify(name)} at ${seconds(time)}. Its previous change ends at ${seconds(departing.last!.t1)}. Play the arrival after that change`)
        return before === undefined ? this.order.length : this.order.indexOf(this.partNamed(before, call))
    }

    /**
     * Take the time of a change of a part. Two changes of one part at one time would each write its amounts,
     * and the picture would follow neither. So a change that starts before the last one is over is refused.
     */
    private claim(entry: Entry, call: string, ctx: AnimContext): void {
        const { t0, t1 } = ctx
        if (!(Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0)) throw new Error(`segmentedBar: ${call} plays from ${String(t0)} to ${String(t1)}. Give the play a duration that is a number, 0 or more`)
        const last = entry.last
        if (last && t0 < last.t1 - SOON) {
            // A film can write a change at an earlier time after a later one, with `s.at()`. The amounts of a part are written in the order of time.
            const advice = t1 <= last.t0 + SOON
                ? `The bar takes the changes of a part in the order of time, and the film calls ${last.call} first. Call ${call} before it`
                : 'Play the two one after the other: in a seq(), or in two calls of s.play. For two new values of one part at one time, give resize() the last value'
            throw new Error(`segmentedBar: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. Both change the part ${JSON.stringify(entry.name)}, and a part takes one change at a time. ${advice}`)
        }
        entry.last = { call, t0, t1 }
    }

    /**
     * A part goes: its amount runs to nothing, and so does the room of its label. The label stays while the
     * box shrinks, so the viewer knows what leaves.
     */
    private leave(entry: Entry, t0: number, t1: number, ctx: AnimContext): void {
        tweenValue(entry.amount, 0, t0, t1, ctx.ease)
        tweenValue(entry.show, 0, t0 + (t1 - t0) * (1 - NAMED), t1, ctx.ease)
        entry.value = 0
        entry.here = false
        entry.present.step(t1, false)
    }

    /** A part of the film, checked: its name, its value, and its color. */
    private checked(part: unknown, what: string): SegmentedBarPart {
        if (typeof part !== 'object' || part === null) throw new Error(`segmentedBar: ${what} is ${shown(part)}. Give a part such as { name: 'history', value: 8200 }`)
        const { name, value, color } = part as SegmentedBarPart
        if (typeof name !== 'string' || name.trim() === '') throw new Error(`segmentedBar: ${what} has no name. Give each part a name, such as { name: 'history', value: 8200 }`)
        // The lines of a text with a line break start at the left, so they leave the middle of the label.
        if (/[\r\n]/.test(name)) throw new Error(`segmentedBar: the name ${JSON.stringify(name)} has a line break. A name is one line: give a shorter name`)
        this.amountOk(value, `the value of ${JSON.stringify(name)}`)
        try {
            if (color !== undefined) toPaint(color)
        } catch {
            throw new Error(`segmentedBar: the color of ${JSON.stringify(name)} is ${shown(color)}, which is not a color. Use a color of the look, such as 'teal', or a CSS color`)
        }
        return { name, value, color }
    }

    private amountOk(value: unknown, what: string): void {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`segmentedBar: ${what} is ${shown(value)}. An amount is a number, 0 or more`)
    }

    /** The names of a call, as a list with each name one time. */
    private listed(names: string | readonly string[], call: string): string[] {
        const list = typeof names === 'string' ? [names] : Array.isArray(names) ? [...new Set(names as readonly string[])] : null
        if (!list || list.length === 0) throw new Error(`segmentedBar: ${call} takes the name of a part, or a list of names with one name at least. It got ${shown(names)}`)
        for (const name of list) this.checkName(name, call)
        return list
    }

    /** The part of a name that the bar has, after the changes that are scheduled so far. */
    private partNamed(name: string, call: string): Entry {
        const found = this.order.find((entry) => entry.here && entry.name === name)
        if (found) return found
        const names = this.names
        throw new Error(`segmentedBar: ${call}: no part ${shown(name)}. ${names.length > 0 ? `The parts are ${names.map((own) => JSON.stringify(own)).join(', ')}` : 'The bar has no part'}`)
    }

    private checkName(name: string, call: string): void {
        if (typeof name !== 'string' || !name.trim() || /[\r\n]/.test(name)) throw new Error(`segmentedBar: ${call} needs a part name on one line. It got ${shown(name)}`)
    }

    private widthOf(content: string, font: TextOptions['font']): number {
        const made = text(content, { size: this.size, font })
        // The advance width holds the side bearings, and the ink can pass it with a slanted letter.
        return Math.max(made.get('px') * 2, made.bounds().width)
    }

    private entryOf(spec: SegmentedBarPart, node: Node, amount: number, show: number): Entry {
        return {
            name: spec.name, color: spec.color ?? COLORS[this.entries.length % COLORS.length]!, value: spec.value, here: true,
            present: new Track(true), amount: new Value(amount), show: new Value(show), box: new Track(true), node,
            wide: Math.max(this.widthOf(spec.name, this.font), this.valueRoom), last: null,
        }
    }

    /** Give a part its place in the bar, and its node to the tree from a time on. */
    private put(entry: Entry, at: number, time?: number): void {
        if (time !== undefined) {
            entry.present.initial = false
            entry.present.step(time, true)
        }
        ownLabels(this, { labels: [entry.node.children[1]!] })
        this.entries.push(entry)
        entry.node.data['part'] = this.entries.length - 1
        this.order.splice(at, 0, entry)
        const saved = clock.now
        if (time !== undefined) clock.now = time
        this.layer.add(entry.node)
        clock.now = saved
    }

    /** The width that labels need in one row, each with the share of its room that it has, and with the room between two of them. */
    private rowOf(labels: readonly { wide: number; show: number }[]): number {
        return labels.reduce((sum, label, index) => sum + label.wide * label.show + (index > 0 ? (this.size * APART * (label.show + labels[index - 1]!.show)) / 2 : 0), 0)
    }

    /** The labels of the parts stand in one row under the bar. A row with no room for them is an error that says what to change. */
    private tooWide(need: number, parts: number, time?: number): string {
        return `segmentedBar: the labels of ${parts} parts${this.rest ? ' and of the free room' : ''} need ${Math.ceil(need)} px in one row${time === undefined ? '' : ` at ${seconds(time)}`}, and the bar is ${Math.floor(this.w)} px wide. Give a width of ${Math.ceil(need)} or more, a smaller size, shorter names, fewer parts${time === undefined ? '' : ' at one time'}, or labels: false`
    }

    /** A node that is drawn again for each frame. It finds its bar through its parents, so the node of a copy draws the copy. */
    private drawn(build: (bar: SegmentedBar, own: Node, time: number) => Node | readonly Node[] | null): Node {
        const node = new Node()
        node.draw = function (this: Node, time: number): Node | readonly Node[] | null {
            for (let up = this.parent; up; up = up.parent) if (up instanceof SegmentedBar) return build(up, this, time)
            return null
        }
        return node
    }

    /** The node of a part: its box, and then its label. Each asks its bar for the part of its index. */
    private partNode(): Node {
        const box = this.drawn((bar, own, time) => bar.boxAt(own.parent!.data['part'] as number, time))
        const label = this.drawn((bar, own, time) => bar.labelAt(own.parent!.data['part'] as number, time))
        return new Node().add(box, label)
    }

    /** The places of the parts and of their labels at a time. */
    private layoutAt(time: number): Layout {
        const cached = this.cache
        if (cached && cached.time === time && cached.version === this.version) return cached.layout
        const unit = this.w / this.max, left = -this.w / 2
        const slots: Slot[] = []
        let total = 0
        for (const entry of this.order) {
            // An ease that passes its end must not give a part a width under 0.
            const amount = Math.max(0, entry.amount.track.sample(time)), show = clamp(entry.show.track.sample(time))
            if (amount === 0 && show === 0) continue
            slots.push({ entry, from: left + total * unit, to: left + (total + amount) * unit, amount, show, wide: entry.wide, x: 0 })
            total += amount
        }
        let free: Slot | null = null
        if (this.rest) {
            const room = Math.max(0, this.capacity - total), from = left + Math.min(total, this.capacity) * unit
            // The label of the free room goes while the room gets narrower than half a text size.
            free = { entry: null, from, to: left + this.capacity * unit, amount: room, show: clamp((room * unit) / (this.size * 0.5)), wide: this.freeWide, x: 0 }
        }
        let need = 0
        if (this.showLabels) {
            const row = [...slots, ...(free ? [free] : [])].filter((slot) => slot.show > 0)
            const gaps = row.map((slot, index) => (this.size * APART * (slot.show + (row[index + 1]?.show ?? 0))) / 2)
            const places = spread(row.map((slot) => (slot.from + slot.to) / 2), row.map((slot) => (slot.wide * slot.show) / 2), gaps, left, -left)
            row.forEach((slot, index) => { slot.x = places[index]! })
            need = this.rowOf(row)
        }
        const layout = { slots, total, free, need }
        this.cache = { time, version: this.version, layout }
        return layout
    }

    /** Where a part is at a time, in the coordinates of the bar. A part with no room is at the end of the parts. */
    private slotAt(entry: Entry, time: number): { from: number; to: number } {
        const layout = this.layoutAt(time)
        const slot = layout.slots.find((own) => own.entry === entry)
        if (slot) return slot
        // A part that has no amount yet is where it will grow: after the parts before it.
        const unit = this.w / this.max
        let before = 0
        for (const other of this.order) {
            if (other === entry) break
            before += Math.max(0, other.amount.track.sample(time))
        }
        return { from: -this.w / 2 + before * unit, to: -this.w / 2 + before * unit }
    }

    /** The box of a part between two x, in the coordinates of the bar. Two parts have a little room between them, and a narrow part keeps most of its width. */
    private block(from: number, to: number): [x: number, y: number, width: number, height: number] {
        const room = Math.min(this.seam, (to - from) * 0.4), high = this.h - this.border
        return [from + room / 2, -high / 2, to - from - room, high]
    }

    /** The rounded path shared by a part and its traveling box, in the coordinates of the bar. */
    private blockPath(from: number, to: number): Path {
        const [x, y, width, height] = this.block(from, to)
        return rectPath(x, y, width, height, Math.min(this.size * 0.14, width / 2))
    }

    /** The bounds of all four corners after the transform. */
    private worldBox(left: number, top: number, right: number, bottom: number): Box {
        const corners = [this.toWorld(left, top), this.toWorld(right, top), this.toWorld(right, bottom), this.toWorld(left, bottom)]
        const xs = corners.map((point) => point[0]), ys = corners.map((point) => point[1])
        return new Box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
    }

    /**
     * The box of a part, with the mark of the amount over the capacity: the part is red from the line of the
     * capacity on, with a hatch, so that color is not the only sign. The room between two parts stays, so the
     * viewer still sees which parts are over. The mark is a piece of the box of its part, so it fades with the
     * part, and a light on the part keeps it bright.
     */
    private boxAt(index: number, time: number): Node | readonly Node[] | null {
        const entry = this.entries[index]
        if (!entry || !entry.box.sample(time)) return null
        const layout = this.layoutAt(time)
        const slot = layout.slots.find((own) => own.entry === entry)
        if (!slot || slot.to - slot.from < 0.05) return null
        const [x, y, width, height] = this.block(slot.from, slot.to)
        const box = new Node(this.blockPath(slot.from, slot.to)).fill(entry.color, FILL)
        // A part that the line cuts is red from the line on.
        const from = Math.max(x, this.x(this.capacity)), wide = x + width - from
        if (layout.total - this.capacity <= this.slack || wide < 0.05) return box
        const lines = new Node(hatch(from, y, wide, height, this.size * 0.5)).stroke('bg', Math.max(2, this.size * 0.09), 0.6)
        lines.set('cap', 'butt')
        return [box, new Node(rectPath(from, y, wide, height, Math.min(this.size * 0.14, wide / 2))).fill('red'), lines]
    }

    private labelAt(index: number, time: number): Node | null {
        const entry = this.entries[index]
        if (!entry || !this.showLabels) return null
        const slot = this.layoutAt(time).slots.find((own) => own.entry === entry)
        return slot ? this.labelOf(entry.name, slot, { name: 'ink', value: 'dim', line: entry.color }) : null
    }

    private restAt(time: number): Node | null {
        const free = this.layoutAt(time).free
        return free ? this.labelOf(this.freeName!, free, { name: 'dim', value: 'dim', line: 'faint' }) : null
    }

    /** A label: the name over the amount, and a line from the middle of the part to the middle of the label. */
    private labelOf(name: string, slot: Slot, look: { name: ColorInput; value: ColorInput; line: ColorInput }): Node | null {
        // The label shows when most of its room is open, so it does not stand over its neighbors while they move.
        const opacity = clamp((slot.show - LATE) / (1 - LATE))
        if (opacity <= 0.002) return null
        const size = this.size
        // The line starts over the middle of the label when that is under the part, and it is then straight.
        // For a label that the others pushed away, it starts a little inside the nearest end of the part.
        const inset = Math.min((slot.to - slot.from) / 2, size * 0.2), from = clamp(slot.x, slot.from + inset, slot.to - inset)
        // A line that would lean by a few pixels is drawn straight: it reads as a line that missed its place.
        const foot = Math.abs(slot.x - from) < size * 0.15 ? from : slot.x
        const top = this.h / 2 + this.border / 2, end = this.h / 2 + size * LEADER, stub = size * STUB
        const leader = new Node(polyPath([[from, top], [from, top + stub], [foot, end - stub], [foot, end]])).stroke(look.line, this.hair)
        // A flat end starts at the border of the bar, and does not go into a part.
        leader.set('cap', 'butt')
        let amount = text(this.format(slot.amount), { size, font: 'mono', color: look.value })
        // A format can write an amount that is wider than the widest one of the bar. The text is then smaller, and stays in its room.
        const wide = amount.bounds().width
        if (wide > slot.wide) amount = text(this.format(slot.amount), { size: (size * slot.wide) / wide, font: 'mono', color: look.value })
        return new Node().add(leader, text(name, { size, font: this.font, color: look.name }).at(slot.x, this.nameY), amount.at(slot.x, this.valueY)).opacity(opacity)
    }

    /** The words of the readout for a total: the total, the capacity of a bar that has one, and the amount over it. */
    private readoutWords(total: number): string {
        const over = total - this.capacity
        const base = this.limited ? `${this.format(total)} / ${this.format(this.capacity)}` : this.format(total)
        // An amount that the format writes as 0 is not said.
        return over > this.slack && this.format(over) !== this.format(0) ? `${base}  ${this.overWord} ${this.format(over)}` : base
    }

    private readoutAt(time: number): Node {
        const total = this.layoutAt(time).total
        const words = this.readoutWords(total), color: ColorInput = total - this.capacity > this.slack ? 'red' : 'ink'
        let made = text(words, { size: this.size, font: 'mono', color, anchor: 'right' })
        // The words keep away from the title, also with a format that writes more than the widest amount.
        const room = this.x(this.capacity) + this.w / 2 - (this.title ? this.titleWide + this.size : 0), wide = made.bounds().width
        if (wide > room && room > 0) made = text(words, { size: (this.size * room) / wide, font: 'mono', color, anchor: 'right' })
        return made.at(this.x(this.capacity), this.titleY)
    }
}

/** One bar in named parts to scale: `segmentedBar([{ name: 'system', value: 1200 }, { name: 'history', value: 8200 }], { capacity: 16000, title: 'context window', free: 'free' })`. `bar.resize('history', 186)` shrinks a part, and `bar.insert()`, `bar.remove()`, `bar.cut()` and `bar.send()` change the parts. */
export function segmentedBar(parts: readonly SegmentedBarPart[], options: SegmentedBarOptions = {}): SegmentedBar {
    return new SegmentedBar(parts, options)
}
