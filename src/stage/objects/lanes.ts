import { Node, ownLabels } from '../node'
import { parseSvgPath, polyPath, rectPath, type Bounds, type Path } from '../geometry'
import { arrow, dot, line } from '../shapes'
import { text, type TextOptions } from '../text'
import { smooth } from '../ease'
import type { ColorInput } from '../color'
import type { Anim, AnimContext, AnimOptions } from '../anim'
import { Box } from '../layout'
import { formatNumber, forwardOnly, niceTicks, reaches, reveal, staggered, stepAt } from './util'

/** The name of a lane, or its index. */
export type LaneRef = string | number

export interface Lane {
    name: string
    /** The color of the spans and the marks of the lane. Defaults to blue. */
    color?: ColorInput
}

/**
 * Where the label of an event goes, when the film must choose. For a span: over the bar, under it, or beside
 * it at its left or its right end. For a handoff: at the left or the right of its arrow, and over or under
 * the boundary that the arrow crosses first. For a mark: over the dot, under it, or beside it.
 */
export type LaneLabelSide = 'left' | 'right' | 'over' | 'under'

export type LaneEvent =
    /**
     * A span: the lane works from `start` to `end`. `open` draws a span with no end mark, for work that goes on.
     * `idle` draws a dashed outline with a faint fill, for a lane that waits while another lane works.
     */
    | { lane: LaneRef; start: number; end: number; label?: string; labelSide?: LaneLabelSide; color?: ColorInput; open?: boolean; idle?: boolean }
    /**
     * A handoff: control passes from one lane to another at a time. `dashed` draws an arrow of dashes, for a
     * message whose sender does not wait and runs on.
     */
    | { from: LaneRef; to: LaneRef; at: number; label?: string; labelSide?: LaneLabelSide; color?: ColorInput; dashed?: boolean }
    /** A mark: one instant on one lane. */
    | { lane: LaneRef; at: number; label?: string; labelSide?: LaneLabelSide; color?: ColorInput }

/** A line along the time area between two lanes, such as the line between user space and the kernel. */
export interface LaneBoundary {
    /** The two lanes that the boundary is between. They are neighbors. */
    between: readonly [LaneRef, LaneRef]
    /** Text after the right end of the line, outside the time area. */
    label?: string
    /** Defaults to yellow. */
    color?: ColorInput
    /** Show the number of handoffs that crossed the boundary so far, after the label, and a tick on the line for each one. */
    count?: boolean
}

export interface LanesOptions {
    /** The width of the time area. The lane names are outside it, at the left. Defaults to 1400. */
    width?: number
    /** The height of the bar of a span. Defaults to 44. */
    barHeight?: number
    /**
     * From the middle of one lane to the middle of the next. Defaults to a value with room for the label of a
     * handoff between two bars. Two lanes with a boundary between them are further apart, by 1.25 of the text size.
     */
    pitch?: number
    /** The times at the two ends. Defaults to the range of the events. */
    domain?: readonly [number, number]
    /** Ticks under the lanes: a count, or the values. Without it, no axis is drawn, for a sequence that is not to scale. */
    ticks?: number | readonly number[]
    /** How to write a tick. */
    format?: (time: number) => string
    /** A line under the axis that names the unit. Without `ticks`, the axis is a line with this label and no ticks. */
    axisLabel?: string
    /** Lines between lanes that are neighbors. A handoff crosses each boundary that is between its two lanes. */
    boundaries?: readonly LaneBoundary[]
    /** Draw the cursor. With false, no cursor is ever drawn, and the events still appear at their times. On by default. */
    cursor?: boolean
    /**
     * The color of the patches behind the labels, the bars and the arrows of dashes. They hide the cursor and
     * the lines of the lanes there. Defaults to the background of the look. On a panel of another color, give
     * that color. Pass null for no patches, on a background with no single color.
     */
    backing?: ColorInput | null
    /** Text size. Defaults to 26. */
    size?: number
    font?: TextOptions['font']
}

/** One event of a `Lanes` object. It is hidden until the cursor reaches it. */
export class LaneEventNode extends Node {
    constructor(
        readonly kind: 'span' | 'handoff' | 'mark',
        /** The bar of a span, the arrow of a handoff, or the dot of a mark. */
        readonly shape: Node,
        /** The label of the event, or null when it has none. */
        readonly text: Node | null,
        /** The arrow head of an open span that reaches the last end of the domain. */
        readonly tip: Node | null,
        /** The dashed outline of an idle span. */
        readonly edge: Node | null,
    ) {
        super()
    }
}

interface Plan {
    kind: 'span' | 'handoff' | 'mark'
    /** The lane of a span or a mark, and the lane that a handoff leaves. */
    lane: number
    /** The lane that a handoff goes to. */
    target: number
    /** The time of a handoff or a mark, and the two ends of a span. */
    start: number
    end: number
    open: boolean
    idle: boolean
    /** The arrow of the handoff is a line of dashes. */
    dashed: boolean
    /** The label is inside the bar of the span. */
    inside: boolean
    /** How far the head of the arrow of a handoff goes while the arrow draws, with its sign. */
    travel: number
    /** The boundaries that a handoff crosses. */
    walls: number[]
    /** The ticks that a handoff leaves on the boundaries that count, as places in the list of all ticks. */
    ticks: number[]
}

interface Wall {
    /** The lane over the line. The lane under it is the next one. */
    upper: number
    /** The y of the line. */
    y: number
    label: string | undefined
    count: boolean
}

interface Thing {
    box: Bounds
    /** The event that the thing is a part of, or -1 for a part of a boundary. */
    event: number
    /** What the thing is, for an error: "the arrow of event 3". */
    name: string
}

interface Row {
    y: number
    cover: [number, number]
}

/** The opacity of the fill of a bar. A label in ink reads on it in a dark look and in a light one. */
const FILL = 0.5
/** The opacity of the fill of an idle bar. */
const FAINT = 0.14
/** Seconds for a label or an outline to arrive. */
const FADE = 0.3
/** Seconds for an arrow or a dot to arrive with its label. */
const REVEAL = 0.5

/** A bar from `x0` to `x1`. A flat bar has a right end with no round corners, for a span that goes on. */
function barPath(x0: number, x1: number, top: number, height: number, radius: number, flat: boolean): Path {
    const width = x1 - x0
    if (!(width > 0)) return []
    if (!flat) return rectPath(x0, top, width, height, radius)
    const r = Math.min(radius, width, height / 2), bottom = top + height
    return parseSvgPath(`M${x0 + r} ${top}L${x1} ${top}L${x1} ${bottom}L${x0 + r} ${bottom}Q${x0} ${bottom} ${x0} ${bottom - r}L${x0} ${top + r}Q${x0} ${top} ${x0 + r} ${top}Z`)
}

/**
 * The outline of an idle bar, as lines that start at the left end, so that the dashes stay in place while the
 * bar grows. Without `closed`, it has no right end.
 */
function edgePath(x0: number, x1: number, top: number, height: number, radius: number, closed: boolean): Path {
    const width = x1 - x0
    if (!(width > 0)) return []
    const r = Math.min(radius, closed ? width / 2 : width, height / 2), bottom = top + height
    const end = closed ? x1 - r : x1
    const left = `M${x0 + r} ${top}Q${x0} ${top} ${x0} ${top + r}L${x0} ${bottom - r}Q${x0} ${bottom} ${x0 + r} ${bottom}`
    const sides = `M${x0 + r} ${top}L${end} ${top}M${x0 + r} ${bottom}L${end} ${bottom}`
    const right = closed ? `M${end} ${top}Q${x1} ${top} ${x1} ${top + r}L${x1} ${bottom - r}Q${x1} ${bottom} ${end} ${bottom}` : ''
    return parseSvgPath(left + sides + right)
}

/**
 * Who runs when: one lane per actor, a bar for each span of work, an arrow for each handoff between two
 * lanes, and a dot for each instant. Time runs from left to right. `advance(to)` moves a cursor to a time
 * and stops there, and what the cursor passes appears, so a narration can step through the sequence. With
 * `ticks`, the object also draws a time axis, for a chart of durations. With `boundaries`, it draws a line
 * between two lanes and counts the handoffs that cross it.
 * `.at()` places the middle of the time area. The names of the lanes are outside it, at the left.
 */
export class Lanes extends Node {
    /** The name of each lane, at the left of the time area. */
    readonly names: Node[] = []
    /** A faint line along each lane. */
    readonly rails: Node[] = []
    /** One node per event, in the order given. */
    readonly events: LaneEventNode[] = []
    /** The events by kind, in the order given. */
    readonly spans: LaneEventNode[] = []
    readonly handoffs: LaneEventNode[] = []
    readonly marks: LaneEventNode[] = []
    /** One node per boundary: its line, its label, and its counter. */
    readonly boundaries: Node[] = []
    /** The number at the right end of each boundary that counts its crossings, or null for a boundary that does not. */
    readonly counters: (Node | null)[] = []
    /** The axis line, the ticks and their numbers, and the axis label. Null without `ticks`. */
    readonly axis: Node | null
    /** A thin vertical line over all lanes, at the time of the object. The first `advance` shows it. */
    readonly cursor: Node
    /** The times at the two ends of the time area. */
    readonly domain: readonly [number, number]
    private readonly w: number
    private readonly barHeight: number
    private readonly laneNames: string[]
    /** The y of the middle of each lane. */
    private readonly ys: number[] = []
    private readonly plans: Plan[] = []
    private readonly walls: Wall[] = []
    /**
     * Shapes in the background color, under the events and over the cursor and the lines of the lanes: a
     * copy of each bar, a strip behind each arrow of dashes, and a patch behind each label. So no line shows
     * through a bar or between two dashes, or passes through a text.
     */
    private readonly unders: (Node | null)[] = []
    private readonly patches: (Node | null)[] = []
    /** The ticks that the handoffs leave on the boundaries that count. */
    private readonly ticks: Node[] = []
    private readonly drawCursor: boolean
    private cursorTime: number
    private started = false

    constructor(lanes: readonly (string | Lane)[], events: readonly LaneEvent[], options: LanesOptions = {}) {
        super()
        if (lanes.length === 0) throw new Error('lanes: give it at least one lane')
        const size = options.size ?? 26
        const font = options.font
        this.w = options.width ?? 1400
        this.barHeight = options.barHeight ?? 44
        if (!(Number.isFinite(size) && size > 0)) throw new Error('lanes: size is a text size, more than 0')
        if (!(Number.isFinite(this.w) && this.w > 0)) throw new Error('lanes: width is the width of the time area, more than 0')
        if (!(Number.isFinite(this.barHeight) && this.barHeight > 0)) throw new Error('lanes: barHeight is the height of a bar, more than 0')
        const pitch = options.pitch ?? Math.round(this.barHeight + size * 2.2)
        if (!(Number.isFinite(pitch) && pitch >= this.barHeight)) throw new Error(`lanes: pitch is the distance from one lane to the next. Give it ${this.barHeight} or more, the height of a bar`)

        const specs = lanes.map((lane) => (typeof lane === 'string' ? { name: lane } : lane))
        this.laneNames = specs.map((lane) => lane.name)
        this.laneNames.forEach((name, index) => {
            if (this.laneNames.indexOf(name) !== index) throw new Error(`lanes: two lanes have the name ${JSON.stringify(name)}. Give each lane its own name`)
        })
        const laneOf = (ref: LaneRef, owner: string): number => {
            const lane = this.find(ref)
            if (lane === null) throw new Error(`lanes: ${owner} names the lane ${JSON.stringify(ref)}. ${this.known()}`)
            return lane
        }

        // The boundaries come first, because a boundary moves the two lanes around it apart.
        const wallColors: ColorInput[] = []
        ;(options.boundaries ?? []).forEach((boundary, index) => {
            const [one, other] = [laneOf(boundary.between[0], `boundary ${index}`), laneOf(boundary.between[1], `boundary ${index}`)]
            if (Math.abs(one - other) !== 1) throw new Error(`lanes: boundary ${index} is between the lanes ${JSON.stringify(this.laneNames[one])} and ${JSON.stringify(this.laneNames[other])}, which are not neighbors. A boundary is a line between two lanes that are next to each other`)
            const upper = Math.min(one, other)
            const twin = this.walls.findIndex((wall) => wall.upper === upper)
            if (twin >= 0) throw new Error(`lanes: boundaries ${twin} and ${index} are between the same two lanes. Give two lanes one boundary`)
            this.walls.push({ upper, y: 0, label: boundary.label === undefined || boundary.label.trim() === '' ? undefined : boundary.label, count: boundary.count === true })
            wallColors.push(boundary.color ?? 'yellow')
        })
        const half = this.barHeight / 2
        // The room between the bars of a lane and the bars of the next one. With a boundary, it holds two rows of text and the line.
        const rooms = specs.slice(1).map((_, index) => pitch - this.barHeight + (this.walls.some((wall) => wall.upper === index) ? size * 1.25 : 0))
        let down = 0
        specs.forEach((_, index) => {
            this.ys.push(down)
            down += this.barHeight + (rooms[index] ?? 0)
        })
        const middle = this.ys[this.ys.length - 1]! / 2
        this.ys.forEach((y, index) => (this.ys[index] = y - middle))
        for (const wall of this.walls) wall.y = this.ys[wall.upper]! + half + rooms[wall.upper]! / 2

        // Read the events before anything is drawn, so that a wrong event is named and not a wrong place.
        const colors: ColorInput[] = [], labels: (string | undefined)[] = [], sides: (LaneLabelSide | undefined)[] = []
        events.forEach((event, index) => {
            const plan: Plan = { kind: 'mark', lane: 0, target: 0, start: 0, end: 0, open: false, idle: false, dashed: false, inside: false, travel: 0, walls: [], ticks: [] }
            if ('from' in event) {
                plan.kind = 'handoff'
                plan.lane = laneOf(event.from, `event ${index}`)
                plan.target = laneOf(event.to, `event ${index}`)
                plan.start = plan.end = event.at
                plan.dashed = event.dashed === true
                if (plan.lane === plan.target) throw new Error(`lanes: event ${index} is a handoff from the lane ${JSON.stringify(this.laneNames[plan.lane])} to itself. A handoff goes to another lane. For one instant on one lane, use a mark: { lane, at }`)
                // The order of the lanes says which boundaries a handoff crosses. The film does not.
                const [low, high] = [Math.min(plan.lane, plan.target), Math.max(plan.lane, plan.target)]
                this.walls.forEach((wall, at) => {
                    if (low <= wall.upper && wall.upper < high) plan.walls.push(at)
                })
            } else if ('start' in event) {
                plan.kind = 'span'
                plan.lane = plan.target = laneOf(event.lane, `event ${index}`)
                plan.start = event.start
                plan.end = event.end
                plan.open = event.open === true
                plan.idle = event.idle === true
            } else if ('lane' in event && 'at' in event) {
                plan.lane = plan.target = laneOf(event.lane, `event ${index}`)
                plan.start = plan.end = event.at
            } else {
                throw new Error(`lanes: event ${index} is not a span ({ lane, start, end }), a handoff ({ from, to, at }) or a mark ({ lane, at })`)
            }
            if (!Number.isFinite(plan.start) || !Number.isFinite(plan.end)) throw new Error(`lanes: event ${index} has a time that is not a number`)
            if (plan.kind === 'span' && !(plan.end > plan.start)) throw new Error(`lanes: the span of event ${index} starts at ${plan.start} and ends at ${plan.end}. A span ends after it starts`)
            colors.push(event.color ?? (plan.kind === 'handoff' ? 'ink' : specs[plan.lane]!.color ?? 'blue'))
            labels.push(event.label === undefined || event.label.trim() === '' ? undefined : event.label)
            if (event.labelSide !== undefined && !['left', 'right', 'over', 'under'].includes(event.labelSide)) throw new Error(`lanes: event ${index} has the labelSide ${JSON.stringify(event.labelSide)}. Use 'left', 'right', 'over' or 'under'`)
            sides.push(event.labelSide)
            this.plans.push(plan)
        })
        const named = (index: number) => (labels[index] === undefined ? `event ${index}` : `event ${index} (${JSON.stringify(labels[index])})`)
        // An arrow needs its head and a piece of line between two bars.
        const least = Math.ceil(this.barHeight + size * 0.9)
        if (pitch < least && this.plans.some((plan) => plan.kind === 'handoff')) throw new Error(`lanes: a pitch of ${pitch} leaves ${pitch - this.barHeight} px between two bars, and the arrow of a handoff needs ${least - this.barHeight}. Give a pitch of ${least} or more`)
        // Two bars at one place would read as one. Two spans of a lane may meet at one time.
        specs.forEach((lane, at) => {
            const own = this.plans.map((plan, index) => ({ plan, index })).filter(({ plan }) => plan.kind === 'span' && plan.lane === at).sort((a, b) => a.plan.start - b.plan.start || a.index - b.index)
            for (let k = 1; k < own.length; k++) {
                const before = own[k - 1]!, after = own[k]!
                if (after.plan.start < before.plan.end) throw new Error(`lanes: the spans of ${named(before.index)} and ${named(after.index)} overlap on the lane ${JSON.stringify(lane.name)}: one ends at ${before.plan.end}, and the other starts at ${after.plan.start}. A lane does one thing at a time. End the first span where the second one starts`)
            }
        })

        let domain = options.domain
        if (!domain) {
            const least = Math.min(...this.plans.map((plan) => plan.start)), most = Math.max(...this.plans.map((plan) => plan.end))
            if (!(most > least)) throw new Error('lanes: the events give no range of time. Give it a domain: the times at the two ends')
            domain = [least, most]
        }
        if (!(Number.isFinite(domain[0]) && Number.isFinite(domain[1]) && domain[1] > domain[0])) throw new Error('lanes: the domain needs two different ends, the smaller one first')
        const [first, last] = domain
        this.domain = [first, last]
        this.cursorTime = first
        this.plans.forEach((plan, index) => {
            const outside = [plan.start, plan.end].find((time) => time < first || time > last)
            if (outside !== undefined) throw new Error(`lanes: event ${index} has the time ${outside}, outside the domain ${first} to ${last}`)
        })

        const left = -this.w / 2, right = this.w / 2
        const count = specs.length
        specs.forEach((lane, index) => {
            const y = this.y(index)
            this.rails.push(line([left, y], [right, y], { stroke: 'grid', width: 2 }))
            this.names.push(text(lane.name, { size, font, color: 'ink', anchor: 'right' }).at(left - size * 0.9, y))
        })
        const foot = this.y(count - 1) + pitch / 2
        this.axis = options.ticks === undefined && !options.axisLabel ? null : this.buildAxis(options, size, foot)
        this.drawCursor = options.cursor !== false
        const backing = options.backing === undefined ? 'bg' : options.backing
        // The cursor goes a little past the bars of the first and the last lane, and down to the axis when
        // there is one. A longer end would show as a short piece over a label that is over the first lane.
        const past = half + Math.min((pitch - this.barHeight) / 2, size * 0.5)
        this.cursor = line([0, this.y(0) - past], [0, this.axis ? foot : this.y(count - 1) + past], { stroke: 'faint', width: 2 }).at(this.x(first), 0).hide()

        // The shape of each event. A label must not touch any of them, so they are all known before a label gets its place.
        const weight = Math.max(2, size * 0.11), outline = Math.max(2, size * 0.077), dotRadius = Math.max(4, size * 0.32)
        const dashes = [size * 0.3, size * 0.25]
        const tipGap = 3, tipLength = this.barHeight * 0.4
        const shapes: Node[] = [], tips: (Node | null)[] = [], edges: (Node | null)[] = [], things: Thing[] = []
        const ground = new Node()
        this.plans.forEach((plan, index) => {
            const x = this.x(plan.start), y = this.y(plan.lane), color = colors[index]!
            let tip: Node | null = null, edge: Node | null = null
            if (plan.kind === 'span') {
                const end = this.x(plan.end)
                const bar = new Node(this.bar(plan, plan.end, true)).fill(color, plan.idle ? FAINT : FILL)
                if (plan.idle) {
                    // A lane that waits: no solid bar, and an outline of dashes.
                    edge = new Node(this.edge(plan, plan.end, !plan.open)).stroke(color, outline).dash(dashes)
                    edge.set('cap', 'butt')
                } else if (!plan.open) {
                    // The outline closes a bar. An open span has none, so it looks like a span that still grows.
                    bar.stroke(color, outline)
                }
                if (plan.open && plan.end >= last) {
                    tip = new Node(polyPath([[end + tipGap, y - half], [end + tipGap + tipLength, y], [end + tipGap, y + half]], true)).fill(color, plan.idle ? FAINT : FILL)
                    if (plan.idle) tip.stroke(color, outline).dash(dashes)
                }
                shapes.push(bar)
                this.unders.push(backing === null ? null : new Node(this.bar(plan, plan.end, true)).fill(backing).hide())
                things.push({ box: { x, y: y - half, width: end - x + (tip ? tipGap + tipLength : 0), height: this.barHeight }, event: index, name: `the bar of ${named(index)}` })
            } else if (plan.kind === 'handoff') {
                const way = plan.target > plan.lane ? 1 : -1
                const from = y + way * half, to = this.y(plan.target) - way * half
                const made = arrow([x, from], [x, to], { stroke: color, width: weight, tip: size * 0.5, dash: plan.dashed ? dashes : undefined })
                if (plan.dashed) made.children[0]!.set('cap', 'butt')
                plan.travel = way * made.children[0]!.bounds().height
                const box = made.bounds()
                shapes.push(made)
                // Behind an arrow of dashes, a strip hides the cursor. A cursor that stops at the handoff would fill the gaps between the dashes.
                const strip = plan.dashed && backing !== null ? line([x, from], [x, to], { stroke: backing, width: weight + 2 }).hide() : null
                strip?.set('cap', 'butt')
                this.unders.push(strip)
                things.push({ box: { x: box.x, y: Math.min(from, to), width: box.width, height: Math.abs(to - from) }, event: index, name: `the arrow of ${named(index)}` })
                for (const at of plan.walls) {
                    if (!this.walls[at]!.count) continue
                    // Where the arrow passes the line, it leaves a tick. The rim sets the tick apart from the arrow.
                    plan.ticks.push(this.ticks.length)
                    const tick = dot(size * 0.22, wallColors[at]!).at(x, this.walls[at]!.y)
                    if (backing !== null) tick.stroke(backing, 2)
                    this.ticks.push(tick)
                }
            } else {
                // The dot has a rim in the color of the backing, so it reads on a bar of its own color.
                const made = dot(dotRadius, color).at(x, y)
                if (backing !== null) made.stroke(backing, weight)
                shapes.push(made)
                this.unders.push(null)
                things.push({ box: { x: x - dotRadius, y: y - dotRadius, width: dotRadius * 2, height: dotRadius * 2 }, event: index, name: `the dot of ${named(index)}` })
            }
            tips.push(tip)
            edges.push(edge)
        })

        const clearX = size * 0.3, clearY = size * 0.1
        const touches = (a: Bounds, b: Bounds) => a.x < b.x + b.width + clearX && b.x < a.x + a.width + clearX && a.y < b.y + b.height + clearY && b.y < a.y + a.height + clearY
        const advice = 'Use a wider width, a larger pitch, shorter labels, times that are further apart, or another labelSide'
        if (this.axis) things.push({ box: { x: left, y: foot - 1, width: this.w, height: size * 1.9 }, event: -1, name: 'the axis' })
        const padX = size * 0.22, padY = size * 0.16, inset = size * 0.5
        // The rows of text in the room between a lane and the next one, and how far the patch of a label in
        // a row goes, up and down. Without a boundary: one row, in the middle. With a boundary: one row over
        // the line and one under it. `towards` puts the row on the side of the upper lane first.
        const rowsOf = (upper: number, towards: boolean): Row[] => {
            const top = this.ys[upper]! + half, bottom = this.ys[upper + 1]! - half
            const wall = this.walls.find((candidate) => candidate.upper === upper)
            if (!wall) return [{ y: (top + bottom) / 2, cover: [top, bottom] }]
            // `.at(x, y)` puts the middle of the capital letters at y. That is a little over the middle of a text with its tails.
            const lift = size * 0.07
            const over: Row = { y: (top + wall.y) / 2 - lift, cover: [top, wall.y - 2] }, under: Row = { y: (wall.y + bottom) / 2 - lift, cover: [wall.y + 2, bottom] }
            return towards ? [over, under] : [under, over]
        }

        // The boundaries: a line of dashes along the time area. The label and the number are after the right
        // end of the line, outside the time area, as the names of the lanes are before the left end. So a
        // handoff may be at any time, to the last end of the domain. The labels start at one x, and the
        // numbers end at one x, so that two counters read as one column.
        const wallLabels = this.walls.map((wall, index) => (wall.label === undefined ? null : text(wall.label, { size, font, color: wallColors[index]! })))
        const wallValues = this.walls.map((wall, index) => {
            if (!wall.count) return null
            // One text for each value, so the number is a text that the film check can read.
            const total = this.plans.filter((plan) => plan.walls.includes(index)).length
            return Array.from({ length: total + 1 }, (_, value) => text(String(value), { size, font, color: wallColors[index]!, weight: 600 }))
        })
        const widestLabel = Math.max(0, ...wallLabels.map((label) => (label ? label.bounds().width : 0)))
        const widestValue = Math.max(0, ...wallValues.flatMap((values) => (values ?? []).map((value) => value.bounds().width)))
        const labelsStart = right + size * 0.9
        const valuesEnd = labelsStart + widestLabel + (widestLabel > 0 && widestValue > 0 ? size * 0.5 : 0) + widestValue
        this.walls.forEach((wall, index) => {
            const made = new Node()
            const rule = line([left, wall.y], [right, wall.y], { stroke: wallColors[index]!, width: 2, dash: dashes })
            rule.set('cap', 'butt')
            made.add(rule)
            things.push({ box: { x: left, y: wall.y - 1, width: this.w, height: 2 }, event: -1, name: `the line of ${wall.label === undefined ? `boundary ${index}` : `boundary ${index} (${JSON.stringify(wall.label)})`}` })
            const label = wallLabels[index]
            if (label) made.add(label.at(labelsStart - label.bounds().x, wall.y))
            let counter: Node | null = null
            const values = wallValues[index]
            if (values) {
                counter = new Node()
                values.forEach((value, at) => {
                    const ink = value.bounds()
                    counter!.add(value.at(valuesEnd - ink.x - ink.width, wall.y))
                    if (at > 0) value.hide()
                })
                made.add(counter)
            }
            this.boundaries.push(made)
            this.counters.push(counter)
        })

        // The place of each label. A label takes the first place where it is in the time area and touches
        // nothing. With no such place, the film is wrong, and the author must know. The labels get their
        // places in the order of time, so that the result does not depend on the order of the list.
        const gapX = size * 0.45
        const texts: (Node | null)[] = this.plans.map(() => null)
        const order = this.plans.map((_, index) => index).sort((a, b) => this.plans[a]!.start - this.plans[b]!.start || a - b)
        for (const index of order) {
            const content = labels[index], plan = this.plans[index]!, side = sides[index]
            if (content === undefined) {
                this.patches[index] = null
                continue
            }
            const made = text(content, { size, font, color: 'ink' })
            const ink = made.bounds()
            const x = this.x(plan.start), y = this.y(plan.lane)
            const startAt = (edge: number) => edge - ink.x, endAt = (edge: number) => edge - ink.x - ink.width, middleAt = (at: number) => at - ink.x - ink.width / 2
            // `cover` is how far the patch behind the label goes, up and down. A label between two lanes or
            // on a lane covers its whole row, so no short piece of the cursor shows over or under the text.
            // A label over or under a bar or a dot covers from them to its far side.
            // `.at(x, y)` puts the middle of the capital letters at y. The base line is 0.36 of the size under it.
            const overAt = (edge: number, least: number): Row => {
                const at = edge - size * 0.78
                return { y: at, cover: [ink.y + at - padY, Math.max(least, ink.y + at + ink.height + padY)] }
            }
            const underAt = (edge: number, least: number): Row => {
                const at = edge + size * 0.7
                return { y: at, cover: [Math.min(least, ink.y + at - padY), ink.y + at + ink.height + padY] }
            }
            const band: Row = { y, cover: [y - half, y + half] }
            let places: { x: number; y: number; cover: [number, number]; inside?: boolean }[]
            if (plan.kind === 'span') {
                const end = this.x(plan.end)
                const overs = [{ x: startAt(x), ...overAt(y - half, y - half) }, { x: endAt(end), ...overAt(y - half, y - half) }]
                if (side === 'over') places = overs
                else if (side === 'under') places = [{ x: startAt(x), ...underAt(y + half, y + half) }, { x: endAt(end), ...underAt(y + half, y + half) }]
                else if (side === 'right') places = [{ x: startAt(end + gapX), ...band }]
                else if (side === 'left') places = [{ x: endAt(x - gapX), ...band }]
                // Inside, the label is at the start of the bar. So it is near the cursor when the bar starts to grow.
                else places = [...(ink.width + inset * 2 <= end - x && ink.height + size * 0.24 <= this.barHeight ? [{ x: startAt(x + inset), ...band, inside: true }] : []), ...overs]
            } else if (plan.kind === 'handoff') {
                // The label is beside the lane that the handoff leaves. Between two lanes that are not
                // neighbours, the rows near the next lanes come after it, and no row is on a lane.
                const way = plan.target > plan.lane ? 1 : -1
                let rows: Row[] = []
                for (let lane = plan.lane; lane !== plan.target; lane += way) rows.push(...rowsOf(Math.min(lane, lane + way), way > 0))
                if (side === 'over' || side === 'under') {
                    const upper = Math.min(plan.lane, plan.lane + way)
                    if (!this.walls.some((wall) => wall.upper === upper)) throw new Error(`lanes: ${named(index)} has the labelSide '${side}'. The label of a handoff is at the 'left' or at the 'right' of its arrow. 'over' and 'under' are the two sides of a boundary, and no boundary is beside the lane that this handoff leaves`)
                    const [overRow, underRow] = rowsOf(upper, true)
                    rows = [side === 'over' ? overRow! : underRow!]
                }
                const atRight = rows.map((row) => ({ x: startAt(x + gapX), ...row })), atLeft = rows.map((row) => ({ x: endAt(x - gapX), ...row }))
                places = side === 'left' ? atLeft : side === 'right' ? atRight : [...atRight, ...atLeft]
            } else {
                // Over the dot, or over the bar that the dot is on. Near an end of the time area, the label moves to stay in it.
                const width = Math.min(ink.width, this.w)
                const at = Math.min(Math.max(x, left + width / 2), right - width / 2)
                const onBar = this.plans.some((other) => other.kind === 'span' && other.lane === plan.lane && other.start <= plan.start && plan.start <= other.end)
                const reach = onBar ? half : dotRadius
                // With no bar, the patch stops short of the line of the lane, behind the dot.
                if (side === 'under') places = [{ x: middleAt(at), ...underAt(y + reach, onBar ? y + half : y + 2) }]
                else if (side === 'right') places = [{ x: startAt(x + dotRadius + gapX), ...band }]
                else if (side === 'left') places = [{ x: endAt(x - dotRadius - gapX), ...band }]
                else places = [{ x: middleAt(at), ...overAt(y - reach, onBar ? y - half : y - 2) }]
            }
            let met: Thing | null = null, chosen: (typeof places)[number] | null = null
            for (const place of places) {
                const box: Bounds = { x: ink.x + place.x, y: ink.y + place.y, width: ink.width, height: ink.height }
                if (box.x < left - 0.5 || box.x + box.width > right + 0.5) continue
                // A label has its place beside its own shape, or inside it.
                const hit = things.find((thing) => thing.event !== index && touches(box, thing.box))
                if (hit) {
                    met ??= hit
                    continue
                }
                chosen = place
                things.push({ box, event: index, name: `the label of ${named(index)}` })
                break
            }
            if (!chosen) {
                if (!met) throw new Error(`lanes: the label of ${named(index)} is wider than the room that the time area has for it. ${advice}`)
                throw new Error(`lanes: the label of ${named(index)} touches ${met.name}. ${advice}`)
            }
            plan.inside = chosen.inside === true
            texts[index] = made.at(chosen.x, chosen.y)
            // The film sets the height of a bar and the size of the text. So the film check judges the room of a label in its bar.
            if (plan.inside) made.data['fit'] = 'Give the lanes a taller bar (`barHeight`) or a smaller text (`size`).'
            this.patches[index] = backing === null ? null : new Node(rectPath(ink.x + chosen.x - padX, chosen.cover[0], ink.width + padX * 2, chosen.cover[1] - chosen.cover[0])).fill(backing).hide()
        }

        this.plans.forEach((plan, index) => {
            const label = texts[index] ?? null
            const node = new LaneEventNode(plan.kind, shapes[index]!, label, tips[index] ?? null, edges[index] ?? null)
            for (const part of [node.shape, node.edge, node.tip, ...plan.ticks.map((at) => this.ticks[at]!), label]) if (part) node.add(part)
            node.hide()
            for (const part of [this.unders[index], this.patches[index]]) if (part) ground.add(part)
            this.events.push(node)
            if (plan.kind === 'span') this.spans.push(node)
            else if (plan.kind === 'handoff') this.handoffs.push(node)
            else this.marks.push(node)
        })

        // The order of what is drawn goes by kind, whatever the order of the list: the lines of the lanes, the
        // bars, the boundaries, the arrows, the dots. A label touches nothing, so it is with its event. The
        // cursor is under the patches, and the patches are under all that the film must see in full.
        this.add(...this.rails)
        if (this.axis) this.add(this.axis)
        this.add(this.cursor, ground, ...this.spans, ...this.boundaries, ...this.handoffs, ...this.marks, ...this.names)
        // The object places each label beside its own bars, arrows and lines. The film check does not judge that room.
        ownLabels(this, { name: 'set of lanes' })
    }

    /** The label of an event belongs to its bar, its arrow, or its dot, so a light on that shape keeps the label bright. */
    override labelsOf(part: Node): readonly Node[] {
        return this.events.find((event) => event.shape === part)?.children ?? []
    }

    /** The time of the cursor after the changes that are scheduled so far. It starts at the first end of the domain. */
    get time(): number {
        return this.cursorTime
    }

    /** The x of a time, in the coordinates of the object. The middle of the domain is at 0. */
    x(time: number): number {
        return -this.w / 2 + ((time - this.domain[0]) / (this.domain[1] - this.domain[0])) * this.w
    }

    /** The y of the middle of a lane, in the coordinates of the object. The first lane and the last one are at the same distance from 0. */
    y(lane: LaneRef): number {
        const index = this.find(lane)
        if (index === null) throw new Error(`lanes: no lane ${JSON.stringify(lane)}. ${this.known()}`)
        return this.ys[index]!
    }

    /**
     * The box of a part of the object, in stage pixels, for `place` and `beside` of the layout: such as
     * `beside(note, flow.region({ lane: 'monitor', at: 1.09 }), 'above')`. Without a lane it is the time
     * area over all lanes. `lane` is the row of the bars of one lane. `between` is the room between the
     * bars of two lanes. `from` and `to` are times of the domain, and `at` is one time. The box is where
     * the object is now, so ask for it after the object has its place.
     */
    region(part: { lane?: LaneRef; between?: readonly [LaneRef, LaneRef]; from?: number; to?: number; at?: number } = {}): Box {
        const names = ['lane', 'between', 'from', 'to', 'at']
        if (typeof part !== 'object' || part === null) throw new Error(`lanes: region takes an object such as { lane: 0, at: 4 }, and it got ${part === null ? 'null' : typeof part}`)
        const unknown = Object.keys(part).find((name) => !names.includes(name))
        if (unknown !== undefined) throw new Error(`lanes: region has no part "${unknown}". Its parts are: ${names.join(', ')}`)
        if (part.at !== undefined && (part.from !== undefined || part.to !== undefined)) throw new Error('lanes: region takes `at` for one time, or `from` and `to` for a stretch of time, not both')
        const half = this.barHeight / 2
        let top = this.ys[0]! - half, bottom = this.ys[this.ys.length - 1]! + half
        if (part.lane !== undefined && part.between !== undefined) throw new Error('lanes: region takes `lane` or `between`, not both. `lane` is the row of one lane, and `between` is the room between two lanes')
        if (part.lane !== undefined) {
            top = this.y(part.lane) - half
            bottom = this.y(part.lane) + half
        } else if (part.between !== undefined) {
            const one = this.y(part.between[0]), other = this.y(part.between[1])
            if (one === other) throw new Error(`lanes: region: \`between\` names the lane ${JSON.stringify(part.between[0])} two times. Give two lanes, such as the first two: ${JSON.stringify(this.laneNames.slice(0, 2))}`)
            top = Math.min(one, other) + half
            bottom = Math.max(one, other) - half
        }
        const from = part.at ?? part.from ?? this.domain[0], to = part.at ?? part.to ?? this.domain[1]
        for (const time of [from, to]) {
            // A time outside the domain is outside the object, and so would be what a film puts there.
            if (!(Number.isFinite(time) && time >= this.domain[0] && time <= this.domain[1])) throw new Error(`lanes: region: a time is ${time}. \`from\`, \`to\` and \`at\` are times of the domain, ${this.domain[0]} to ${this.domain[1]}`)
        }
        if (from > to) throw new Error(`lanes: region: \`from\` is ${from} and \`to\` is ${to}. Give a \`from\` that is not after \`to\``)
        const [x0, y0] = this.toWorld(this.x(from), top), [x1, y1] = this.toWorld(this.x(to), bottom)
        return new Box(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1))
    }

    /**
     * How many handoffs crossed a boundary up to the time of the cursor, after the changes that are scheduled
     * so far. Name the boundary by its index or by its label.
     */
    crossings(boundary: number | string): number {
        const index = typeof boundary === 'number' ? (Number.isInteger(boundary) && boundary >= 0 && boundary < this.walls.length ? boundary : -1) : this.walls.findIndex((wall) => wall.label === boundary)
        if (index < 0) {
            const known = this.walls.length === 0 ? 'The object has no boundary' : `The boundaries are ${this.walls.map((wall, at) => (wall.label === undefined ? `${at}` : `${at} (${JSON.stringify(wall.label)})`)).join(', ')}`
            throw new Error(`lanes: no boundary ${JSON.stringify(boundary)}. ${known}`)
        }
        return this.plans.filter((plan) => plan.walls.includes(index) && (plan.start < this.cursorTime || (plan.start === this.cursorTime && this.started))).length
    }

    /** The names, the lines of the lanes, the boundaries and the axis arrive, lane by lane. No event shows yet. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'lanes.enter', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const windows = staggered(this.names.length, Math.max(0, options.lag ?? 0.25), ctx.t0, ctx.t1)
                this.names.forEach((name, index) => {
                    const [start, end] = windows[index]!, rail = this.rails[index]!
                    stepAt(name, 'opacity', 0, ctx.t0)
                    name.tween('opacity', 1, start, end, ctx.ease)
                    stepAt(rail, 'trimTo', 0, ctx.t0)
                    rail.tween('trimTo', 1, start, end, ctx.ease)
                })
                // A boundary comes with the lane under it: its line draws from the left, and its text fades in.
                this.walls.forEach((wall, index) => {
                    const [start, end] = windows[wall.upper + 1]!
                    const [rule, ...words] = this.boundaries[index]!.children
                    stepAt(rule!, 'trimTo', 0, ctx.t0)
                    rule!.tween('trimTo', 1, start, end, ctx.ease)
                    for (const word of words) {
                        stepAt(word, 'opacity', 0, ctx.t0)
                        word.tween('opacity', 1, start, end, ctx.ease)
                    }
                })
                if (this.axis) {
                    stepAt(this.axis, 'opacity', 0, ctx.t0)
                    this.axis.tween('opacity', 1, ctx.t0 + (ctx.t1 - ctx.t0) * 0.3, ctx.t1, ctx.ease)
                }
            },
        }
    }

    /**
     * The cursor moves from its time to `to`, and stops. What it passes appears. A span grows with the cursor.
     * A handoff draws its arrow and a mark shows its dot when the cursor reaches them. A label arrives when its
     * event is complete, and a label inside a bar arrives when the bar starts to grow. All of it is over when
     * the animation ends: when the last event needs time after the cursor reaches it, the cursor stops early.
     */
    advance(to: number, options: AnimOptions = {}): Anim {
        // Find a wrong time now, where the film names it. Check again when the move is scheduled, because an
        // advance that is earlier in the same sequence moves the cursor first.
        this.checkAdvance(to)
        return {
            label: 'lanes.advance', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                this.checkAdvance(to)
                this.sweep(to, ctx)
            },
        }
    }

    /** The same as `advance` to the last end of the domain. It takes 4 seconds when the film gives no duration. */
    showAll(options: AnimOptions = {}): Anim {
        return this.advance(this.domain[1], { ...options, duration: options.duration ?? 4 })
    }

    private find(ref: LaneRef): number | null {
        if (typeof ref === 'number') return Number.isInteger(ref) && ref >= 0 && ref < this.laneNames.length ? ref : null
        const index = this.laneNames.indexOf(ref)
        return index < 0 ? null : index
    }

    private known(): string {
        return `The lanes are ${this.laneNames.map((name, index) => `${index} (${JSON.stringify(name)})`).join(', ')}`
    }

    private checkAdvance(to: number): void {
        const [first, last] = this.domain
        if (!Number.isFinite(to) || to < first || to > last) throw new Error(`lanes: cannot advance to ${to}. The domain is ${first} to ${last}`)
        if (to < this.cursorTime) throw new Error(`lanes: cannot advance to ${to}. The cursor is at ${this.cursorTime}, and it does not go back`)
    }

    /**
     * The bar of a span when the cursor is at a time. An open span has a flat right end. So has an idle span
     * that is not `complete`, because its outline has no right end before that.
     */
    private bar(plan: Plan, time: number, complete: boolean): Path {
        const y = this.y(plan.lane), half = this.barHeight / 2
        return barPath(this.x(plan.start), this.x(Math.min(Math.max(time, plan.start), plan.end)), y - half, this.barHeight, Math.max(3, this.barHeight * 0.14), plan.open || (plan.idle && !complete))
    }

    /** The outline of an idle span when the cursor is at a time. */
    private edge(plan: Plan, time: number, closed: boolean): Path {
        const y = this.y(plan.lane), half = this.barHeight / 2
        return edgePath(this.x(plan.start), this.x(Math.min(Math.max(time, plan.start), plan.end)), y - half, this.barHeight, Math.max(3, this.barHeight * 0.14), closed)
    }

    private buildAxis(options: LanesOptions, size: number, y: number): Node {
        const [first, last] = this.domain
        const slack = (last - first) * 1e-9
        const inside = (value: number) => value >= first - slack && value <= last + slack
        let ticks: readonly number[]
        if (options.ticks === undefined) {
            // An axis label with no ticks: a line of time that is not to scale.
            ticks = []
        } else if (typeof options.ticks === 'object') {
            ticks = options.ticks
            const stray = ticks.find((tick) => !Number.isFinite(tick) || !inside(tick))
            if (stray !== undefined) throw new Error(`lanes: the tick ${stray} is outside the domain ${first} to ${last}`)
        } else {
            if (!(Number.isFinite(options.ticks) && options.ticks! >= 1)) throw new Error('lanes: ticks is a count of 1 or more, or the values to mark')
            ticks = niceTicks(first, last, options.ticks).ticks.filter(inside)
        }
        // Write every tick with the decimals that the finest one needs, so 0.25 does not read as 0.3.
        const decimals = (value: number) => [0, 1, 2, 3].find((digits) => Math.abs(value * 10 ** digits - Math.round(value * 10 ** digits)) < 1e-9) ?? 4
        const digits = Math.max(0, ...ticks.map(decimals))
        const format = options.format ?? ((value: number) => (digits > 0 ? value.toFixed(digits) : formatNumber(value)))
        const axis = new Node()
        axis.add(line([-this.w / 2, y], [this.w / 2, y], { stroke: 'faint', width: 1.5 }))
        let before: { end: number; words: string } | null = null
        for (const tick of [...ticks].sort((a, b) => a - b)) {
            const x = this.x(tick), words = format(tick)
            const number = text(words, { size, font: options.font, color: 'dim' }).at(x, y + size * 1.15)
            const box = number.bounds()
            if (before && box.x < before.end + size * 0.3) throw new Error(`lanes: the ticks ${JSON.stringify(before.words)} and ${JSON.stringify(words)} touch. Use fewer ticks, a shorter format, or a wider width`)
            before = { end: box.x + box.width, words }
            axis.add(line([x, y], [x, y + size * 0.3], { stroke: 'faint', width: 1.5 }), number)
        }
        if (options.axisLabel) axis.add(text(options.axisLabel, { size, font: options.font, color: 'dim', anchor: 'right' }).at(this.w / 2, y + size * 2.6))
        return axis
    }

    /** Write the keys of one advance, from the time of the cursor to `to`, and move the bookkeeping. */
    private sweep(to: number, ctx: AnimContext): void {
        const { t0, t1 } = ctx
        const from = this.cursorTime, first = !this.started, moves = to > from
        reveal(this, t0, ctx.stage)
        // The share of the travel time at which the cursor reaches a time.
        const ease = forwardOnly(ctx.ease)
        const share = (time: number) => (moves ? reaches(ease, (time - from) / (to - from)) : 0)
        // An end or an instant is due once: when the cursor reaches it. An instant at the first end of the
        // domain is due on the first advance.
        const due = (time: number) => time <= to && (time > from || (time === from && first))
        // The number that each counter shows before this advance.
        const counts = this.walls.map((_, index) => this.crossings(index))

        const steps: { share: number; seconds: number; run: (start: number, end: number) => void }[] = []
        this.plans.forEach((plan, index) => {
            if (plan.kind === 'span') {
                // A span starts when the cursor leaves its start. So a stop at the start of a span shows nothing of it.
                if (plan.start >= from && plan.start < to) steps.push({ share: share(plan.start), seconds: plan.inside ? FADE : 0, run: (start, end) => this.startSpan(index, start, end) })
                if (due(plan.end)) steps.push({ share: share(plan.end), seconds: FADE, run: (start, end) => this.endSpan(index, start, end) })
            } else if (due(plan.start)) {
                steps.push({ share: share(plan.start), seconds: REVEAL, run: (start, end) => (plan.kind === 'handoff' ? this.showHandoff(index, start, end, counts) : this.showMark(index, start, end)) })
            }
        })
        // In the order of time, because a counter goes up by one for each handoff, in the order that the cursor passes them.
        steps.sort((a, b) => a.share - b.share)

        // The cursor stops early by the least time that lets every step end with the animation. It keeps
        // 0.6 of the time at least. With less time than that, the steps are shorter.
        const whole = t1 - t0
        let tail = 0
        for (const step of steps) if (step.share > 0) tail = Math.max(tail, (step.seconds - whole * (1 - step.share)) / step.share)
        const arrive = t1 - Math.min(tail, whole * 0.4)

        if (first && this.drawCursor) {
            stepAt(this.cursor, 'visible', true, t0)
            stepAt(this.cursor, 'opacity', 0, t0)
            this.cursor.tween('opacity', 1, t0, Math.min(t1, t0 + FADE), smooth)
        }
        if (moves) {
            const at = (alpha: number) => from + (to - from) * alpha
            // One key gives the place for every frame, from the same eased share as the bars. So the right
            // end of a growing bar is at the cursor at every frame, with any ease. The ease never goes back
            // and never passes its end, so the cursor and the bars stay in the range of the advance.
            this.cursor.track('x').add({ t0, t1: arrive, ease, to: this.x(to), at: (alpha) => this.x(at(alpha)) })
            this.plans.forEach((plan, index) => {
                if (plan.kind !== 'span' || plan.start >= to || plan.end <= from) return
                const node = this.events[index]!
                for (const part of [node.shape, this.unders[index]]) {
                    part?.track('path').add({ t0, t1: arrive, ease, to: this.bar(plan, to, false), at: (alpha) => this.bar(plan, at(alpha), false) })
                }
                node.edge?.track('path').add({ t0, t1: arrive, ease, to: this.edge(plan, to, false), at: (alpha) => this.edge(plan, at(alpha), false) })
            })
        }
        for (const step of steps) {
            const start = t0 + step.share * (arrive - t0)
            step.run(start, Math.min(t1, start + step.seconds))
        }
        this.cursorTime = to
        this.started = true
    }

    private startSpan(index: number, start: number, end: number): void {
        const node = this.events[index]!, plan = this.plans[index]!
        stepAt(node, 'visible', true, start)
        if (this.unders[index]) stepAt(this.unders[index]!, 'visible', true, start)
        // What closes the span waits for its end: the outline, the arrow head, and a label over the bar.
        if (!plan.open && !plan.idle) stepAt(node.shape, 'strokeOpacity', 0, start)
        if (node.tip) stepAt(node.tip, 'opacity', 0, start)
        // A label inside the bar comes at once, so the viewer reads what the lane does while the bar grows.
        this.showLabel(index, start, plan.inside ? start : null, end)
    }

    private endSpan(index: number, start: number, end: number): void {
        const node = this.events[index]!, plan = this.plans[index]!
        if (!plan.open && !plan.idle) node.shape.tween('strokeOpacity', 1, start, end, smooth)
        if (!plan.open && plan.idle) {
            // The outline of dashes gets its right end, and the bar its round corners.
            for (const part of [node.shape, this.unders[index]]) if (part) stepAt(part, 'path', this.bar(plan, plan.end, true), start)
            stepAt(node.edge!, 'path', this.edge(plan, plan.end, true), start)
        }
        node.tip?.tween('opacity', 1, start, end, smooth)
        if (!plan.inside) this.showLabel(index, null, start, end)
    }

    private showHandoff(index: number, start: number, end: number, counts: number[]): void {
        const node = this.events[index]!, plan = this.plans[index]!
        const [shaft, head] = node.shape.children as [Node, Node]
        const drawn = start + (end - start) * 0.5
        stepAt(node, 'visible', true, start)
        // The head leaves the first lane and leads the shaft to the second. The strip behind an arrow of dashes goes with them.
        for (const part of [shaft, this.unders[index]]) {
            if (!part) continue
            stepAt(part, 'visible', true, start)
            stepAt(part, 'trimTo', 0, start)
            part.tween('trimTo', 1, start, drawn, smooth)
        }
        stepAt(head, 'y', -plan.travel, start)
        head.tween('y', 0, start, drawn, smooth)
        for (const at of plan.ticks) {
            stepAt(this.ticks[at]!, 'opacity', 0, start)
            this.ticks[at]!.tween('opacity', 1, start + (drawn - start) * 0.5, drawn, smooth)
        }
        // The counter of each boundary that the handoff crosses goes up at the moment the cursor passes the handoff.
        for (const at of plan.walls) {
            const values = this.counters[at]?.children
            if (values) {
                stepAt(values[counts[at]!]!, 'visible', false, start)
                stepAt(values[counts[at]! + 1]!, 'visible', true, start)
            }
            counts[at]!++
        }
        this.showLabel(index, start, drawn, end)
    }

    private showMark(index: number, start: number, end: number): void {
        const node = this.events[index]!
        const grown = start + (end - start) * 0.5
        stepAt(node, 'visible', true, start)
        for (const prop of ['sx', 'sy'] as const) {
            stepAt(node.shape, prop, 0.3, start)
            node.shape.tween(prop, 1, start, grown, smooth)
        }
        stepAt(node.shape, 'opacity', 0, start)
        node.shape.tween('opacity', 1, start, grown, smooth)
        this.showLabel(index, start, grown, end)
    }

    /** The label is away from `hidden`, and arrives from `start` to `end`. A null leaves that part to another call. */
    private showLabel(index: number, hidden: number | null, start: number | null, end: number): void {
        const label = this.events[index]!.text
        if (!label) return
        if (hidden !== null) stepAt(label, 'opacity', 0, hidden)
        if (start === null) return
        // The patch comes at once. It has the color of the background, so the viewer sees no change, and a
        // patch that is half there would let the cursor show through the text.
        if (this.patches[index]) stepAt(this.patches[index]!, 'visible', true, start)
        label.tween('opacity', 1, start, end, smooth)
    }
}

/**
 * Lanes over time, one per actor, with spans, handoffs and marks:
 * `lanes(['guest', 'KVM'], [{ lane: 'guest', start: 0, end: 30, label: 'runs' }, { from: 'guest', to: 'KVM', at: 30, label: 'VM exit' }, { lane: 'KVM', start: 30, end: 42 }])`.
 */
export function lanes(names: readonly (string | Lane)[], events: readonly LaneEvent[], options: LanesOptions = {}): Lanes {
    return new Lanes(names, events, options)
}
