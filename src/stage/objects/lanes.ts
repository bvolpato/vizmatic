import { Node, ownLabels } from '../node'
import { parseSvgPath, pointAt, polyPath, rectPath, type Bounds, type Path } from '../geometry'
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
 * it at its left or its right end. For a handoff or a link: at the left or the right of its arrow, and for a
 * handoff also over or under the boundary that the arrow crosses first. For a mark: over the dot, under it,
 * or beside it. For a bracket: `'over'` and `'under'` are the two sides of its lane.
 */
export type LaneLabelSide = 'left' | 'right' | 'over' | 'under'

/** The `id` of an event, or its index in the list of events. */
export type LaneEventRef = string | number

/**
 * How an event ends when it does not end well. `'failed'` is an error or a timeout, and its sign is a cross.
 * `'cancelled'` is a stop on purpose, and its sign is a square. A span has the sign at its end, a mark is the
 * sign, and a handoff stops on its way and ends with the sign: the message is lost.
 */
export type LaneOutcome = 'failed' | 'cancelled'

/** Where an event is in time, as the cursor of the object sees it. */
export type LaneEventState = 'ahead' | 'running' | 'done' | LaneOutcome

export type LaneEvent =
    /**
     * A span: the lane works from `start` to `end`. `open` draws a span with no end mark, for work that goes on.
     * `idle` draws a dashed outline with a faint fill, for a lane that waits while another lane works. `down`
     * draws a hatched block, for a stretch where the lane is not there: an outage, a GPU that is lost.
     * `inside` is the id of a span of the same lane that holds this one, such as a tool call in a turn: the
     * child has a row of its own under its parent.
     */
    | { lane: LaneRef; start: number; end: number; id?: string; label?: string; labelSide?: LaneLabelSide; color?: ColorInput; open?: boolean; idle?: boolean; down?: boolean; inside?: string; outcome?: LaneOutcome }
    /**
     * A handoff: control passes from one lane to another at a time. `dashed` draws an arrow of dashes, for a
     * message whose sender does not wait and runs on.
     */
    | { from: LaneRef; to: LaneRef; at: number; id?: string; label?: string; labelSide?: LaneLabelSide; color?: ColorInput; dashed?: boolean; outcome?: LaneOutcome }
    /**
     * A link: an arrow from a time on one lane to another time on a lane, such as a retry, or a cache hit that
     * points at the write that made the entry. `at` is the time on `from` and the time on `to`. The two lanes
     * can be one lane, and the arrow can point back in time. No control passes, so a link crosses no boundary.
     */
    | { from: LaneRef; to: LaneRef; at: readonly [number, number]; id?: string; label?: string; labelSide?: LaneLabelSide; color?: ColorInput; dashed?: boolean }
    /** A mark: one instant on one lane. `inside` is the id of a span, and puts the dot on the bar of that span. */
    | { lane: LaneRef; at: number; id?: string; label?: string; labelSide?: LaneLabelSide; color?: ColorInput; inside?: string; outcome?: LaneOutcome }
    /**
     * A bracket: a window of time with a name, such as the time to the first token. It is over its lane, or
     * under it with `labelSide: 'under'`. Without a lane, it is over the first lane or under the last one.
     */
    | { bracket: readonly [number, number]; lane?: LaneRef; id?: string; label?: string; labelSide?: 'over' | 'under'; color?: ColorInput }

/** A line at one time over all lanes, such as a deadline that a request must beat, a cutoff, or a kill time. */
export interface LaneDeadline {
    /** The time of the line. */
    at: number
    /**
     * Text over the line. A function gets the time that is left at the cursor and returns the text, so the
     * text counts down. The time that is left is less than 0 when the cursor is past the line.
     */
    label?: string | ((left: number) => string)
    /** Defaults to red. */
    color?: ColorInput
    /**
     * Draw the time that is left as a bar over the lanes. The bar ends at the line, and its other end follows
     * the cursor, so the bar drains. With `{ from }`, the clock starts at that time and not at the first end
     * of the domain.
     */
    drain?: boolean | { from: number }
}

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
    /** One line at a time over all lanes, or a list of them. With `drain`, a bar shows the time that is left. */
    deadline?: LaneDeadline | readonly LaneDeadline[]
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
        readonly kind: 'span' | 'handoff' | 'mark' | 'link' | 'bracket',
        /** The bar of a span, the arrow of a handoff or a link, the dot of a mark, or the line of a bracket. */
        readonly shape: Node,
        /** The label of the event, or null when it has none. */
        readonly text: Node | null,
        /** The arrow head of an open span that reaches the last end of the domain. */
        readonly tip: Node | null,
        /** The dashed outline of an idle span, or the hatch of a span where the lane is down. */
        readonly edge: Node | null,
        /** The sign of a span or a handoff with an `outcome`: a cross or a square on a disc. A mark with an outcome is its sign. */
        readonly sign: Node | null = null,
        /** The `id` that the film gave the event, or null. */
        readonly eventId: string | null = null,
    ) {
        super()
    }
}

interface Plan {
    kind: 'span' | 'handoff' | 'mark' | 'link' | 'bracket'
    id: string | null
    /** The lane of a span, a mark or a bracket, and the lane that a handoff or a link leaves. */
    lane: number
    /** The lane that a handoff or a link goes to. */
    target: number
    /** The time of a handoff or a mark, the two ends of a span or a bracket, and the two times of a link, the earlier one first. */
    start: number
    end: number
    /** The row of a span or a mark in its lane: 0 for the lane itself, and 1 or more for a child span. */
    row: number
    /** The span that holds a child span or a mark, as an index, or -1. */
    parent: number
    outcome: LaneOutcome | null
    /** The span is a stretch where the lane is down. */
    down: boolean
    /** The link points back in time: its time on `to` is the earlier one. */
    back: boolean
    /** The bracket is under its lane. */
    under: boolean
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
    /** The event that the thing is a part of, or -1 for a part of a boundary or of a deadline. */
    event: number
    /** What the thing is, for an error: "the arrow of event 3". */
    name: string
    /** The thing is the bar of a span. A mark that is inside the span may have its label on that bar. */
    bar?: boolean
}

interface Row {
    y: number
    cover: [number, number]
}

interface Limit {
    at: number
    /** The time at which the clock of the bar starts. */
    from: number
    drain: boolean
    /** The text of the line when it is one text, for `remaining('deadline')`. */
    name: string | undefined
    /** The top and the height of the bar. */
    top: number
    height: number
}

/** The opacity of the fill of a bar. A label in ink reads on it in a dark look and in a light one. */
const FILL = 0.5
/** The opacity of the fill of an idle bar, and of a stretch where the lane is down. */
const FAINT = 0.14
/** The opacity of the lines of a hatch, and of the part of a drain bar that is left. */
const HATCH = 0.7
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
 * The hatch of a stretch where the lane is down: slanted lines from `x0` to `x1`, each cut at the two ends.
 * The lines start from `x0`, so they stay in place while the block grows.
 */
function hatchPath(x0: number, x1: number, top: number, height: number, step: number): Path {
    // The lines stop a little inside the block, so no end shows past a round corner.
    const inset = 2, low = x0 + inset, high = x1 - inset, foot = top + height - inset, rise = height - inset * 2
    if (!(high - low > 1 && rise > 0)) return []
    let lines = ''
    for (let start = low - Math.floor(rise / step) * step; start < high; start += step) {
        // One line goes from (start, foot) up to (start + rise, foot - rise).
        const from = Math.max(start, low), to = Math.min(start + rise, high)
        if (to - from > 1) lines += `M${from} ${foot - (from - start)}L${to} ${foot - (to - start)}`
    }
    return lines === '' ? [] : parseSvgPath(lines)
}

/**
 * The sign of an outcome: a disc with a cross for an event that failed, or with a square for one that was
 * cancelled. The shape says the outcome, so the sign reads without its color.
 */
function signNode(outcome: LaneOutcome, radius: number, backing: ColorInput | null, rim: number): Node {
    const disc = dot(radius, outcome === 'failed' ? 'red' : 'orange')
    // The rim sets the sign apart from the bar that it is on, as the rim of a dot does.
    if (backing !== null) disc.stroke(backing, rim)
    const reach = radius * 0.42, ink = backing ?? 'bg'
    const glyph = outcome === 'failed'
        ? new Node(parseSvgPath(`M${-reach} ${-reach}L${reach} ${reach}M${reach} ${-reach}L${-reach} ${reach}`)).stroke(ink, Math.max(2, radius * 0.24))
        : new Node(rectPath(-reach, -reach, reach * 2, reach * 2, 1)).fill(ink)
    return new Node().add(disc, glyph)
}

/**
 * Who runs when: one lane per actor, a bar for each span of work, an arrow for each handoff between two
 * lanes, and a dot for each instant. Time runs from left to right. `advance(to)` moves a cursor to a time
 * and stops there, and what the cursor passes appears, so a narration can step through the sequence. With
 * `ticks`, the object also draws a time axis, for a chart of durations. With `boundaries`, it draws a line
 * between two lanes and counts the handoffs that cross it. With `deadline`, it draws a line at a time that
 * a request must beat, and the time that is left as a bar that drains. A span can hold child spans, fail,
 * or be a stretch where its lane is down. A link joins two times, and a bracket names a window of time.
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
    readonly links: LaneEventNode[] = []
    readonly brackets: LaneEventNode[] = []
    /** One node per deadline: its line, then its bar when it drains, then its text. */
    readonly deadlines: Node[] = []
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
    /** From the middle of a row of a lane to the middle of the row of its child spans. */
    private readonly rowPitch: number
    /** How far the rows of the child spans of each lane go under the bars of the lane. 0 for a lane with no child span. */
    private readonly depths: number[] = []
    private readonly plans: Plan[] = []
    private readonly walls: Wall[] = []
    private readonly limits: Limit[] = []
    /** The part that is left of the bar of each deadline that drains, or null. */
    private readonly drains: (Node | null)[] = []
    /** The box of the shape of each event when it is complete, in the coordinates of the object. */
    private readonly boxes: Bounds[] = []
    /** How a bracket is drawn: its distance from the bars of its lane, and the length of its two ends. */
    private readonly bracketGap: number
    private readonly bracketEnd: number
    /** The distance between two lines of a hatch. */
    private readonly hatchStep: number
    /**
     * Shapes in the background color, under the events and over the cursor and the lines of the lanes: a
     * copy of each bar, a strip behind each arrow of dashes, and a patch behind each label. So no line shows
     * through a bar or between two dashes, or passes through a text.
     */
    private readonly unders: (Node | null)[] = []
    private readonly patches: (Node | null)[] = []
    /** The ticks that the handoffs leave on the boundaries that count. */
    private readonly ticks: Node[] = []
    /** The signs of the spans with an outcome. They are over all bars. */
    private readonly signs: Node[] = []
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
            const lane = this.laneIndex(ref)
            if (lane === null) throw new Error(`lanes: ${owner} names the lane ${JSON.stringify(ref)}. ${this.known()}`)
            return lane
        }
        // A child span is as high as its parent, and close under it, so the two read as one block.
        this.rowPitch = this.barHeight + Math.max(3, Math.round(size * 0.12))
        this.bracketGap = size * 0.5
        this.bracketEnd = size * 0.28
        this.hatchStep = size * 0.5

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

        // Read the events before anything is drawn, so that a wrong event is named and not a wrong place.
        const colors: ColorInput[] = [], labels: (string | undefined)[] = [], sides: (LaneLabelSide | undefined)[] = [], holders: (string | undefined)[] = []
        const outcomeOf = (value: unknown, index: number): LaneOutcome | null => {
            if (value === undefined) return null
            if (value !== 'failed' && value !== 'cancelled') throw new Error(`lanes: event ${index} has the outcome ${JSON.stringify(value)}. Use 'failed' or 'cancelled', or give it no outcome`)
            return value
        }
        events.forEach((event, index) => {
            const plan: Plan = { kind: 'mark', id: null, lane: 0, target: 0, start: 0, end: 0, row: 0, parent: -1, outcome: null, down: false, back: false, under: false, open: false, idle: false, dashed: false, inside: false, travel: 0, walls: [], ticks: [] }
            let holder: string | undefined
            if ('bracket' in event) {
                plan.kind = 'bracket'
                if (!Array.isArray(event.bracket) || event.bracket.length !== 2) throw new Error(`lanes: event ${index} is a bracket, and \`bracket\` is its two times, such as bracket: [0, 320]`)
                plan.start = event.bracket[0]
                plan.end = event.bracket[1]
                if (event.labelSide !== undefined && event.labelSide !== 'over' && event.labelSide !== 'under') throw new Error(`lanes: event ${index} is a bracket with the labelSide ${JSON.stringify(event.labelSide)}. A bracket is 'over' its lane or 'under' it`)
                plan.under = event.labelSide === 'under'
                plan.lane = plan.target = event.lane === undefined ? (plan.under ? specs.length - 1 : 0) : laneOf(event.lane, `event ${index}`)
            } else if ('from' in event) {
                plan.lane = laneOf(event.from, `event ${index}`)
                plan.target = laneOf(event.to, `event ${index}`)
                plan.dashed = event.dashed === true
                if (typeof event.at === 'object') {
                    plan.kind = 'link'
                    if (!Array.isArray(event.at) || event.at.length !== 2) throw new Error(`lanes: event ${index} is a link, and \`at\` is its two times: the time on \`from\` and the time on \`to\`, such as at: [30, 12]`)
                    const [leaves, arrives] = event.at as readonly [number, number]
                    plan.start = Math.min(leaves, arrives)
                    plan.end = Math.max(leaves, arrives)
                    plan.back = arrives < leaves
                    if (plan.lane === plan.target && leaves === arrives) throw new Error(`lanes: event ${index} is a link from the lane ${JSON.stringify(this.laneNames[plan.lane])} to itself at one time, ${leaves}. A link on one lane joins two times`)
                } else {
                    plan.kind = 'handoff'
                    plan.start = plan.end = event.at
                    plan.outcome = outcomeOf('outcome' in event ? event.outcome : undefined, index)
                    if (plan.lane === plan.target) throw new Error(`lanes: event ${index} is a handoff from the lane ${JSON.stringify(this.laneNames[plan.lane])} to itself. A handoff goes to another lane. For one instant on one lane, use a mark: { lane, at }`)
                    // The order of the lanes says which boundaries a handoff crosses. The film does not.
                    // A handoff that is lost stops beside the lane that it leaves, so it crosses none.
                    const [low, high] = [Math.min(plan.lane, plan.target), Math.max(plan.lane, plan.target)]
                    this.walls.forEach((wall, at) => {
                        if (plan.outcome === null && low <= wall.upper && wall.upper < high) plan.walls.push(at)
                    })
                }
            } else if ('start' in event) {
                plan.kind = 'span'
                plan.lane = plan.target = laneOf(event.lane, `event ${index}`)
                plan.start = event.start
                plan.end = event.end
                plan.open = event.open === true
                plan.idle = event.idle === true
                plan.down = event.down === true
                plan.outcome = outcomeOf(event.outcome, index)
                holder = event.inside
                if (plan.down && plan.idle) throw new Error(`lanes: the span of event ${index} is \`idle\` and \`down\`. A lane that is down does not wait. Use one of the two`)
                if (plan.down && (plan.outcome !== null || holder !== undefined)) throw new Error(`lanes: the span of event ${index} is \`down\`, and it has ${plan.outcome !== null ? 'an `outcome`' : '`inside`'}. A stretch where the lane is down is no work of the lane. Give the outcome to the span that ends there, and keep the stretch out of another span`)
                if (plan.open && plan.outcome !== null) throw new Error(`lanes: the span of event ${index} is \`open\`, and it has the outcome '${plan.outcome}'. An open span has no end. Remove \`open\`, and end the span at the time when it ${plan.outcome === 'failed' ? 'fails' : 'is cancelled'}`)
            } else if ('lane' in event && 'at' in event) {
                plan.lane = plan.target = laneOf(event.lane, `event ${index}`)
                plan.start = plan.end = event.at
                plan.outcome = outcomeOf(event.outcome, index)
                holder = event.inside
            } else {
                throw new Error(`lanes: event ${index} is not a span ({ lane, start, end }), a handoff ({ from, to, at }), a mark ({ lane, at }), a link ({ from, to, at: [time, time] }) or a bracket ({ bracket: [time, time] })`)
            }
            if (!Number.isFinite(plan.start) || !Number.isFinite(plan.end)) throw new Error(`lanes: event ${index} has a time that is not a number`)
            if (plan.kind === 'span' && !(plan.end > plan.start)) throw new Error(`lanes: the span of event ${index} starts at ${plan.start} and ends at ${plan.end}. A span ends after it starts`)
            if (plan.kind === 'bracket' && !(plan.end > plan.start)) throw new Error(`lanes: the bracket of event ${index} starts at ${plan.start} and ends at ${plan.end}. A bracket ends after it starts`)
            if (event.id !== undefined) {
                if (typeof event.id !== 'string' || event.id === '') throw new Error(`lanes: event ${index} has the id ${JSON.stringify(event.id)}. An id is a text that is not empty`)
                const twin = this.plans.findIndex((other) => other.id === event.id)
                if (twin >= 0) throw new Error(`lanes: events ${twin} and ${index} have the id ${JSON.stringify(event.id)}. Give each event its own id`)
                plan.id = event.id
            }
            colors.push(event.color ?? (plan.kind === 'handoff' ? 'ink' : plan.kind === 'link' || plan.kind === 'bracket' ? 'dim' : plan.down ? 'red' : specs[plan.lane]!.color ?? 'blue'))
            labels.push(event.label === undefined || event.label.trim() === '' ? undefined : event.label)
            if (event.labelSide !== undefined && !['left', 'right', 'over', 'under'].includes(event.labelSide)) throw new Error(`lanes: event ${index} has the labelSide ${JSON.stringify(event.labelSide)}. Use 'left', 'right', 'over' or 'under'`)
            sides.push(event.labelSide)
            holders.push(holder)
            this.plans.push(plan)
        })
        const named = (index: number) => (labels[index] === undefined ? `event ${index}` : `event ${index} (${JSON.stringify(labels[index])})`)

        // The span that holds a child span or a mark. A child span has a row of its own under its parent.
        holders.forEach((holder, index) => {
            if (holder === undefined) return
            const plan = this.plans[index]!, parent = this.plans.findIndex((other) => other.id === holder)
            const spans = this.plans.filter((other) => other.kind === 'span' && other.id !== null).map((other) => JSON.stringify(other.id))
            if (parent < 0 || this.plans[parent]!.kind !== 'span') throw new Error(`lanes: ${named(index)} is inside ${JSON.stringify(holder)}, and no span has this id. ${spans.length === 0 ? 'No span has an id: give the outer span an `id`' : `The spans with an id are ${spans.join(', ')}`}`)
            if (parent === index) throw new Error(`lanes: ${named(index)} is inside itself. \`inside\` is the id of another span, the one that holds it`)
            const outer = this.plans[parent]!
            if (outer.lane !== plan.lane) throw new Error(`lanes: ${named(index)} is on the lane ${JSON.stringify(this.laneNames[plan.lane])}, and it is inside ${named(parent)}, which is on the lane ${JSON.stringify(this.laneNames[outer.lane])}. A span holds events of its own lane. For work on another lane, use a handoff`)
            if (outer.down) throw new Error(`lanes: ${named(index)} is inside ${named(parent)}, which is a stretch where the lane is down. A lane that is down does no work`)
            if (plan.start < outer.start || plan.end > outer.end) throw new Error(`lanes: ${named(index)} is inside ${named(parent)}, and it ${plan.kind === 'span' ? `goes from ${plan.start} to ${plan.end}` : `is at ${plan.start}`}, outside ${outer.start} to ${outer.end}. A span holds what is in its own time`)
            plan.parent = parent
        })
        const levelOf = (index: number): number => {
            let level = 0
            for (let up = this.plans[index]!.parent; up >= 0; up = this.plans[up]!.parent) {
                if (++level > this.plans.length) throw new Error(`lanes: ${named(index)} is inside a span that is inside ${named(index)}. Take \`inside\` from one of them`)
            }
            return level
        }
        const levels = this.plans.map((_, index) => levelOf(index))
        // Each child takes the first row under its parent that is free in its time, so two children that overlap have two rows.
        const children = this.plans.map((_, index) => index).filter((index) => this.plans[index]!.kind === 'span' && this.plans[index]!.parent >= 0)
            .sort((a, b) => levels[a]! - levels[b]! || this.plans[a]!.start - this.plans[b]!.start || a - b)
        const placed: number[] = []
        for (const index of children) {
            const plan = this.plans[index]!
            let row = this.plans[plan.parent]!.row + 1
            while (placed.some((at) => this.plans[at]!.lane === plan.lane && this.plans[at]!.row === row && this.plans[at]!.start < plan.end && plan.start < this.plans[at]!.end)) row++
            plan.row = row
            placed.push(index)
        }
        for (const plan of this.plans) if (plan.kind === 'mark' && plan.parent >= 0) plan.row = this.plans[plan.parent]!.row
        specs.forEach((_, lane) => this.depths.push(Math.max(0, ...this.plans.filter((plan) => plan.lane === lane && (plan.kind === 'span' || plan.kind === 'mark')).map((plan) => plan.row)) * this.rowPitch))

        // The room between the bars of a lane and the bars of the next one. With a boundary, it holds two rows of text and the line.
        const rooms = specs.slice(1).map((_, index) => pitch - this.barHeight + (this.walls.some((wall) => wall.upper === index) ? size * 1.25 : 0))
        let down = 0
        specs.forEach((_, index) => {
            this.ys.push(down)
            down += this.barHeight + (rooms[index] ?? 0) + this.depths[index]!
        })
        const middle = this.ys[this.ys.length - 1]! / 2
        this.ys.forEach((y, index) => (this.ys[index] = y - middle))
        for (const wall of this.walls) wall.y = this.ys[wall.upper]! + half + rooms[wall.upper]! / 2 + this.depths[wall.upper]!

        // An arrow needs its head and a piece of line between two bars.
        const least = Math.ceil(this.barHeight + size * 0.9)
        if (pitch < least && this.plans.some((plan) => plan.kind === 'handoff')) throw new Error(`lanes: a pitch of ${pitch} leaves ${pitch - this.barHeight} px between two bars, and the arrow of a handoff needs ${least - this.barHeight}. Give a pitch of ${least} or more`)
        // Two bars at one place would read as one. Two spans of a lane may meet at one time. A child span has its own row.
        specs.forEach((lane, at) => {
            const own = this.plans.map((plan, index) => ({ plan, index })).filter(({ plan }) => plan.kind === 'span' && plan.lane === at && plan.parent < 0).sort((a, b) => a.plan.start - b.plan.start || a.index - b.index)
            for (let k = 1; k < own.length; k++) {
                const before = own[k - 1]!, after = own[k]!
                if (after.plan.start < before.plan.end) throw new Error(`lanes: the spans of ${named(before.index)} and ${named(after.index)} overlap on the lane ${JSON.stringify(lane.name)}: one ends at ${before.plan.end}, and the other starts at ${after.plan.start}. A lane does one thing at a time. End the first span where the second one starts. For a span that is a part of another one, give it \`inside\` with the id of the outer span`)
            }
        })

        // Two brackets at one side of a lane are on one line, so two that overlap would read as one long bracket.
        const windows = this.plans.map((plan, index) => ({ plan, index })).filter(({ plan }) => plan.kind === 'bracket').sort((a, b) => a.plan.start - b.plan.start || a.index - b.index)
        windows.forEach((after, at) => {
            const before = windows.slice(0, at).find((other) => other.plan.lane === after.plan.lane && other.plan.under === after.plan.under && after.plan.start < other.plan.end)
            if (before) throw new Error(`lanes: the brackets of ${named(before.index)} and ${named(after.index)} overlap ${after.plan.under ? 'under' : 'over'} the lane ${JSON.stringify(this.laneNames[after.plan.lane])}: one ends at ${before.plan.end}, and the other starts at ${after.plan.start}. Put one of them at the other side of the lane with labelSide, or on another lane. Two brackets may meet at one time`)
        })

        // The deadlines are known before the domain, because the domain holds them.
        const limitSpecs = options.deadline === undefined ? [] : Array.isArray(options.deadline) ? (options.deadline as readonly LaneDeadline[]) : [options.deadline as LaneDeadline]
        limitSpecs.forEach((limit, index) => {
            if (typeof limit !== 'object' || limit === null || !Number.isFinite(limit.at)) throw new Error(`lanes: deadline ${index} needs its time, such as deadline: { at: 20, label: 'deadline' }`)
            const from = typeof limit.drain === 'object' && limit.drain !== null ? limit.drain.from : undefined
            if (from !== undefined && !(Number.isFinite(from) && from < limit.at)) throw new Error(`lanes: deadline ${index} is at ${limit.at}, and its bar starts at ${from}. The bar starts before the deadline`)
            if (limit.label !== undefined && typeof limit.label !== 'string' && typeof limit.label !== 'function') throw new Error(`lanes: the label of deadline ${index} is a text, or a function from the time that is left to a text, such as (left) => \`\${left} s left\``)
            // The clock of a bar with no `from` starts at the first end of the domain, which is not known yet.
            this.limits.push({ at: limit.at, from: from ?? Number.NaN, drain: limit.drain !== undefined && limit.drain !== false, name: typeof limit.label === 'string' && limit.label.trim() !== '' ? limit.label : undefined, top: 0, height: 0 })
        })

        let domain = options.domain
        if (!domain) {
            const starts = [...this.plans.map((plan) => plan.start), ...this.limits.flatMap((limit) => (Number.isNaN(limit.from) ? [limit.at] : [limit.at, limit.from]))]
            const least = Math.min(...starts), most = Math.max(...this.plans.map((plan) => plan.end), ...this.limits.map((limit) => limit.at))
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
        this.limits.forEach((limit, index) => {
            if (Number.isNaN(limit.from)) limit.from = first
            const outside = [limit.at, limit.from].find((time) => time < first || time > last)
            if (outside !== undefined) throw new Error(`lanes: deadline ${index} has the time ${outside}, outside the domain ${first} to ${last}. Give a domain that holds it`)
            if (limit.drain && !(limit.from < limit.at)) throw new Error(`lanes: deadline ${index} is at ${limit.at}, the first end of the domain, so its bar has no time to show. Give a domain that starts before the deadline, or remove \`drain\``)
        })

        const left = -this.w / 2, right = this.w / 2
        const count = specs.length
        specs.forEach((lane, index) => {
            const y = this.y(index)
            this.rails.push(line([left, y], [right, y], { stroke: 'grid', width: 2 }))
            this.names.push(text(lane.name, { size, font, color: 'ink', anchor: 'right' }).at(left - size * 0.9, y))
        })
        // A bracket under the last lane has its name under it, so the axis leaves room for the two.
        const low = this.plans.some((plan) => plan.kind === 'bracket' && plan.under && plan.lane === count - 1)
        const foot = Math.max(this.y(count - 1) + pitch / 2, low ? this.y(count - 1) + half + size * 2.2 : -Infinity) + this.depths[count - 1]!
        this.axis = options.ticks === undefined && !options.axisLabel ? null : this.buildAxis(options, size, foot)
        this.drawCursor = options.cursor !== false
        const backing = options.backing === undefined ? 'bg' : options.backing
        // The cursor goes a little past the bars of the first and the last lane, and down to the axis when
        // there is one. A longer end would show as a short piece over a label that is over the first lane.
        const past = half + Math.min((pitch - this.barHeight) / 2, size * 0.5)
        const cursorFoot = this.axis ? foot : this.y(count - 1) + past + this.depths[count - 1]!
        // A deadline starts over the room that a label or a bracket takes over the first lane. Its bar is over that room.
        // The room holds a label over a bar or a bracket with its name, and more for an arc of a link with its label.
        const drainHeight = size * 0.4
        const overRoom = size * (this.plans.some((plan) => plan.kind === 'link' && plan.lane === 0 && plan.target === 0) ? 2.5 : 2)
        // Every line starts at one height, so the texts of two deadlines are on one line. One bar that drains moves them all up.
        const limitTop = this.y(0) - half - overRoom - (this.limits.some((limit) => limit.drain) ? drainHeight + size * 0.3 : 0)
        // With a bar that drains, the cursor goes up to the bar, so the viewer sees that the cursor moves the end of the bar.
        const cursorTop = this.limits.some((limit) => limit.drain) ? limitTop + size * 0.15 + drainHeight : this.y(0) - past
        this.cursor = line([0, cursorTop], [0, cursorFoot], { stroke: 'faint', width: 2 }).at(this.x(first), 0).hide()

        // The shape of each event. A label must not touch any of them, so they are all known before a label gets its place.
        const weight = Math.max(2, size * 0.11), outline = Math.max(2, size * 0.077), dotRadius = Math.max(4, size * 0.32)
        const dashes = [size * 0.3, size * 0.25]
        const tipGap = 3, tipLength = this.barHeight * 0.4
        // The sign of an outcome is as large as a letter, so the cross and the square read at the size of the text.
        const signRadius = size * 0.5
        const shapes: Node[] = [], tips: (Node | null)[] = [], edges: (Node | null)[] = [], signs: (Node | null)[] = [], things: Thing[] = []
        // Where a link has its ends and its line, for the place of its label.
        const linkEnds: ({ from: [number, number]; to: [number, number]; top: number } | null)[] = []
        const ground = new Node()
        // How far the rows under a lane are taken at a time: a handoff or a link ends on the lowest bar that is there.
        const depthAt = (lane: number, time: number) => Math.max(0, ...this.plans.filter((plan) => plan.kind === 'span' && plan.lane === lane && plan.start <= time && time <= plan.end).map((plan) => plan.row)) * this.rowPitch
        // The y where a line from another lane meets a lane at a time: the edge of a bar, or a place near the line of the lane.
        const meet = (lane: number, time: number, side: 1 | -1): number => {
            const onBar = this.plans.some((plan) => plan.kind === 'span' && plan.lane === lane && plan.start <= time && time <= plan.end)
            if (!onBar) return this.ys[lane]! + side * (dotRadius + 3)
            return side > 0 ? this.ys[lane]! + half + depthAt(lane, time) : this.ys[lane]! - half
        }
        this.plans.forEach((plan, index) => {
            const x = this.x(plan.start), y = this.rowY(plan), color = colors[index]!
            let tip: Node | null = null, edge: Node | null = null, sign: Node | null = null, ends: (typeof linkEnds)[number] = null
            if (plan.kind === 'span') {
                const end = this.x(plan.end)
                const bar = new Node(this.bar(plan, plan.end, true)).fill(color, plan.idle || plan.down ? FAINT : FILL)
                if (plan.idle) {
                    // A lane that waits: no solid bar, and an outline of dashes.
                    edge = new Node(this.edge(plan, plan.end, !plan.open)).stroke(color, outline).dash(dashes)
                    edge.set('cap', 'butt')
                } else {
                    if (plan.down) {
                        // A lane that is not there: a hatch says so without its color.
                        edge = new Node(this.edge(plan, plan.end, true)).stroke(color, outline)
                        edge.set('cap', 'butt')
                        edge.set('strokeOpacity', HATCH)
                    }
                    // The outline closes a bar. An open span has none, so it looks like a span that still grows.
                    if (!plan.open) bar.stroke(color, outline)
                }
                if (plan.open && plan.end >= last) {
                    tip = new Node(polyPath([[end + tipGap, y - half], [end + tipGap + tipLength, y], [end + tipGap, y + half]], true)).fill(color, plan.idle || plan.down ? FAINT : FILL)
                    if (plan.idle) tip.stroke(color, outline).dash(dashes)
                }
                shapes.push(bar)
                this.unders.push(backing === null ? null : new Node(this.bar(plan, plan.end, true)).fill(backing).hide())
                this.boxes.push({ x, y: y - half, width: end - x, height: this.barHeight })
                things.push({ box: { x, y: y - half, width: end - x + (tip ? tipGap + tipLength : 0), height: this.barHeight }, event: index, name: `the bar of ${named(index)}`, bar: true })
                if (plan.outcome) {
                    // The sign is on the end of the bar: the place where the work stopped.
                    sign = signNode(plan.outcome, Math.min(signRadius, Math.max(half, 8)), backing, weight).at(end, y)
                    const reach = sign.bounds()
                    things.push({ box: reach, event: index, name: `the sign of ${named(index)}` })
                }
            } else if (plan.kind === 'handoff') {
                const way = plan.target > plan.lane ? 1 : -1
                const laneY = this.y(plan.lane)
                const from = laneY + way * half + (way > 0 ? depthAt(plan.lane, plan.start) : 0), to = this.y(plan.target) - way * half + (way < 0 ? depthAt(plan.target, plan.start) : 0)
                if (plan.outcome) {
                    // A message that is lost: the line stops in the room beside the lane that it leaves, before a
                    // boundary, and ends with the sign.
                    const next = plan.lane + way
                    const room = Math.abs((way > 0 ? this.ys[next]! - half : this.ys[next]! + half + this.depths[next]!) - from)
                    const walled = this.walls.some((wall) => wall.upper === Math.min(plan.lane, next))
                    const shaft = Math.max(size * 0.25, Math.min(room * 0.45 - signRadius, walled ? room / 2 - 3 - signRadius * 2 : room))
                    const stop = from + way * shaft
                    const made = new Node().add(line([x, from], [x, stop], { stroke: color, width: weight, dash: plan.dashed ? dashes : undefined }))
                    made.children[0]!.set('cap', 'butt')
                    sign = signNode(plan.outcome, signRadius, backing, weight).at(x, stop + way * signRadius)
                    shapes.push(made)
                    this.unders.push(null)
                    const far = stop + way * signRadius * 2
                    this.boxes.push({ x: x - signRadius, y: Math.min(from, far), width: signRadius * 2, height: Math.abs(far - from) })
                    things.push({ box: this.boxes[index]!, event: index, name: `the arrow of ${named(index)}` })
                } else {
                    const made = arrow([x, from], [x, to], { stroke: color, width: weight, tip: size * 0.5, dash: plan.dashed ? dashes : undefined })
                    if (plan.dashed) made.children[0]!.set('cap', 'butt')
                    plan.travel = way * made.children[0]!.bounds().height
                    const box = made.bounds()
                    shapes.push(made)
                    // Behind an arrow of dashes, a strip hides the cursor. A cursor that stops at the handoff would fill the gaps between the dashes.
                    const strip = plan.dashed && backing !== null ? line([x, from], [x, to], { stroke: backing, width: weight + 2 }).hide() : null
                    strip?.set('cap', 'butt')
                    this.unders.push(strip)
                    this.boxes.push({ x: box.x, y: Math.min(from, to), width: box.width, height: Math.abs(to - from) })
                    things.push({ box: { x: box.x, y: Math.min(from, to), width: box.width, height: Math.abs(to - from) }, event: index, name: `the arrow of ${named(index)}` })
                    for (const at of plan.walls) {
                        if (!this.walls[at]!.count) continue
                        // Where the arrow passes the line, it leaves a tick. The rim sets the tick apart from the arrow.
                        plan.ticks.push(this.ticks.length)
                        const tick = dot(size * 0.22, wallColors[at]!).at(x, this.walls[at]!.y)
                        if (backing !== null) tick.stroke(backing, 2)
                        this.ticks.push(tick)
                    }
                }
            } else if (plan.kind === 'link') {
                const [leaves, arrives] = plan.back ? [plan.end, plan.start] : [plan.start, plan.end]
                const way = plan.target > plan.lane ? 1 : plan.target < plan.lane ? -1 : 0
                // On one lane, the link is an arc over the bars. Between two lanes, it is a straight line from one to the other.
                const a: [number, number] = [this.x(leaves), meet(plan.lane, leaves, way === 0 ? -1 : way)]
                const b: [number, number] = [this.x(arrives), meet(plan.target, arrives, way === 0 ? -1 : (-way as 1 | -1))]
                const rise = way === 0 ? Math.min(size * 1.1, Math.abs(b[0] - a[0]) * 0.5) : 0
                // `bend` is to the left of the way of the arrow. An arc goes up, whatever its way.
                const made = arrow(a, b, { stroke: color, width: weight, tip: size * 0.45, pad: 3, bend: way === 0 ? (b[0] > a[0] ? -2 : 2) * rise : 0, dash: plan.dashed ? dashes : undefined })
                if (plan.dashed) made.children[0]!.set('cap', 'butt')
                shapes.push(made)
                this.unders.push(null)
                const box = made.bounds()
                this.boxes.push({ x: box.x, y: box.y, width: box.width, height: box.height })
                ends = { from: a, to: b, top: box.y }
                // A label must not be on the line. The line is slanted, so it is many small boxes and not one large box.
                const shaft = made.children[0]!.get('path') ?? []
                const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (size * 0.6)))
                let before = pointAt(shaft, 0)
                for (let piece = 1; piece <= pieces; piece++) {
                    const point = pointAt(shaft, piece / pieces)
                    things.push({ box: { x: Math.min(before[0], point[0]), y: Math.min(before[1], point[1]), width: Math.abs(point[0] - before[0]), height: Math.abs(point[1] - before[1]) }, event: index, name: `the line of ${named(index)}` })
                    before = point
                }
                const head = made.children[1]!.bounds()
                things.push({ box: head, event: index, name: `the line of ${named(index)}` })
            } else if (plan.kind === 'bracket') {
                const made = new Node(this.bracket(plan, plan.end, true)).stroke(color, weight)
                made.set('cap', 'butt')
                made.set('join', 'miter')
                shapes.push(made)
                this.unders.push(null)
                const end = this.x(plan.end), level = this.bracketY(plan), tick = (plan.under ? -1 : 1) * this.bracketEnd
                this.boxes.push({ x, y: Math.min(level, level + tick), width: end - x, height: this.bracketEnd })
                things.push({ box: this.boxes[index]!, event: index, name: `the bracket of ${named(index)}` })
            } else {
                // The dot has a rim in the color of the backing, so it reads on a bar of its own color.
                // A mark with an outcome is the sign of that outcome, in place of the dot.
                const radius = plan.outcome ? signRadius : dotRadius
                const made = plan.outcome ? signNode(plan.outcome, radius, backing, weight).at(x, y) : dot(dotRadius, color).at(x, y)
                if (!plan.outcome && backing !== null) made.stroke(backing, weight)
                shapes.push(made)
                this.unders.push(null)
                this.boxes.push({ x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 })
                things.push({ box: { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 }, event: index, name: `the ${plan.outcome ? 'sign' : 'dot'} of ${named(index)}` })
            }
            tips.push(tip)
            edges.push(edge)
            signs.push(sign)
            linkEnds.push(ends)
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
            const top = this.ys[upper]! + half + this.depths[upper]!, bottom = this.ys[upper + 1]! - half
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

        // The deadlines: a line of dashes at one time, over all lanes, with its text over its top end. The
        // line starts over the room that a label or a bracket takes over the first lane. With `drain`, a bar
        // over that room ends at the line, and its other end follows the cursor.
        const limitName = (index: number) => (this.limits[index]!.name === undefined ? `deadline ${index}` : `deadline ${index} (${JSON.stringify(this.limits[index]!.name)})`)
        const limitTexts: Thing[] = []
        limitSpecs.forEach((spec, index) => {
            const limit = this.limits[index]!, color = spec.color ?? 'red', x = this.x(limit.at)
            limit.height = drainHeight
            const top = limitTop
            limit.top = top + size * 0.15
            const made = new Node()
            const rule = line([x, top], [x, cursorFoot], { stroke: color, width: 2, dash: dashes })
            rule.set('cap', 'butt')
            made.add(rule)
            things.push({ box: { x: x - 1, y: top, width: 2, height: cursorFoot - top }, event: -1, name: `the line of ${limitName(index)}` })
            let drain: Node | null = null
            if (limit.drain) {
                // A faint bar for the whole time, and over it the part that is left.
                const start = this.x(limit.from)
                drain = new Node(this.drain(limit, first)).fill(color, HATCH)
                made.add(new Node(rectPath(start, limit.top, x - start, limit.height, limit.height / 2)).fill(color, FAINT), drain)
                things.push({ box: { x: start, y: limit.top, width: x - start, height: limit.height }, event: -1, name: `the bar of ${limitName(index)}` })
            }
            this.drains.push(drain)
            const write = spec.label
            if (write !== undefined && !(typeof write === 'string' && write.trim() === '')) {
                const textY = top - size * 0.75
                let box: Bounds
                if (typeof write === 'string') {
                    const words = text(write, { size, font, color })
                    const ink = words.bounds()
                    // Over the line. Near an end of the time area, the text moves to stay in it.
                    const width = Math.min(ink.width, this.w)
                    const at = Math.min(Math.max(x, left + width / 2), right - width / 2)
                    made.add(words.at(at - ink.x - ink.width / 2, textY))
                    box = { x: at - ink.width / 2, y: ink.y + textY, width: ink.width, height: ink.height }
                } else {
                    // A text that counts down. It starts at one x for every value, so it does not shake.
                    const whole = limit.at - limit.from
                    const inks = [whole, whole / 2, 0].map((value) => {
                        const words: unknown = write(value)
                        if (typeof words !== 'string') throw new Error(`lanes: the label of ${limitName(index)} is a function, and it returned ${words === null ? 'null' : typeof words} for ${value}. It returns the text for a time that is left, such as (left) => \`\${left} s left\``)
                        return text(words, { size, font, color }).bounds()
                    })
                    const width = Math.min(Math.max(...inks.map((ink) => ink.width)), this.w)
                    const start = Math.min(Math.max(x - width / 2, left), right - width)
                    const readout = new Node()
                    // The text finds its object through the tree, so the text of a copy follows the cursor of the copy.
                    readout.draw = function (this: Node) {
                        let owner: Node | null = this.parent
                        while (owner && !(owner instanceof Lanes)) owner = owner.parent
                        const now = owner instanceof Lanes ? owner.shownTime() : first
                        return text(String(write(Number((limit.at - Math.max(now, limit.from)).toFixed(9)))), { size, font, color, anchor: 'left' }).at(start, textY)
                    }
                    made.add(readout)
                    box = { x: start, y: inks[0]!.y + textY, width, height: inks[0]!.height }
                }
                const hit = limitTexts.find((other) => touches(box, other.box))
                if (hit) throw new Error(`lanes: the label of ${limitName(index)} touches ${hit.name}. Use shorter labels, or deadlines that are further apart`)
                limitTexts.push({ box, event: -1, name: `the label of ${limitName(index)}` })
                things.push(limitTexts[limitTexts.length - 1]!)
            }
            this.deadlines.push(made)
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
            const x = this.x(plan.start), y = this.rowY(plan)
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
            // `on` is the span whose bar the label may be on: the bar that a mark is on.
            let places: { x: number; y: number; cover: [number, number]; inside?: boolean; on?: number }[]
            if (plan.kind === 'span') {
                const end = this.x(plan.end)
                // The sign of an outcome is on the end of the bar, so a label in the bar or beside it keeps clear of the sign.
                const signed = plan.outcome ? Math.min(signRadius, Math.max(half, 8)) : 0
                const overs = [{ x: startAt(x), ...overAt(y - half, y - half) }, { x: endAt(end), ...overAt(y - half, y - half) }]
                const atRight = { x: startAt(end + signed + gapX), ...band }, atLeft = { x: endAt(x - gapX), ...band }
                if (side === 'over') places = overs
                else if (side === 'under') places = [{ x: startAt(x), ...underAt(y + half, y + half) }, { x: endAt(end), ...underAt(y + half, y + half) }]
                else if (side === 'right') places = [atRight]
                else if (side === 'left') places = [atLeft]
                else {
                    // Inside, the label is at the start of the bar. So it is near the cursor when the bar starts to grow.
                    // A hatch would pass through a text, so a stretch where the lane is down has no label inside.
                    const inner = !plan.down && ink.width + inset * 2 <= end - x - signed && ink.height + size * 0.24 <= this.barHeight ? [{ x: startAt(x + inset), ...band, inside: true }] : []
                    // A child span has its parent over it, so its label is in its bar or beside it.
                    places = plan.row > 0 ? [...inner, atRight, atLeft] : [...inner, ...overs]
                }
            } else if (plan.kind === 'handoff') {
                // The label is beside the lane that the handoff leaves. Between two lanes that are not
                // neighbours, the rows near the next lanes come after it, and no row is on a lane.
                const way = plan.target > plan.lane ? 1 : -1
                let rows: Row[] = []
                // A handoff that is lost stays in the room beside the lane that it leaves.
                for (let lane = plan.lane; lane !== (plan.outcome ? plan.lane + way : plan.target); lane += way) rows.push(...rowsOf(Math.min(lane, lane + way), way > 0))
                if (side === 'over' || side === 'under') {
                    const upper = Math.min(plan.lane, plan.lane + way)
                    if (!this.walls.some((wall) => wall.upper === upper)) throw new Error(`lanes: ${named(index)} has the labelSide '${side}'. The label of a handoff is at the 'left' or at the 'right' of its arrow. 'over' and 'under' are the two sides of a boundary, and no boundary is beside the lane that this handoff leaves`)
                    const [overRow, underRow] = rowsOf(upper, true)
                    rows = [side === 'over' ? overRow! : underRow!]
                }
                // The sign of a lost handoff is wider than an arrow.
                const reach = plan.outcome ? signRadius : 0
                const atRight = rows.map((row) => ({ x: startAt(x + reach + gapX), ...row })), atLeft = rows.map((row) => ({ x: endAt(x - reach - gapX), ...row }))
                places = side === 'left' ? atLeft : side === 'right' ? atRight : [...atRight, ...atLeft]
            } else if (plan.kind === 'link') {
                const ends = linkEnds[index]!
                if (plan.lane === plan.target) {
                    // Over the top of the arc. Near an end of the time area, the label moves to stay in it.
                    if (side !== undefined && side !== 'over') throw new Error(`lanes: ${named(index)} has the labelSide '${side}'. The label of a link on one lane is over its arc. Remove the labelSide`)
                    const width = Math.min(ink.width, this.w)
                    const at = Math.min(Math.max((ends.from[0] + ends.to[0]) / 2, left + width / 2), right - width / 2)
                    places = [{ x: middleAt(at), ...overAt(ends.top, ends.top) }]
                } else {
                    if (side === 'over' || side === 'under') throw new Error(`lanes: ${named(index)} has the labelSide '${side}'. The label of a link between two lanes is at the 'left' or at the 'right' of its line`)
                    const way = plan.target > plan.lane ? 1 : -1
                    const rows: Row[] = []
                    for (let lane = plan.lane; lane !== plan.target; lane += way) {
                        for (const row of rowsOf(Math.min(lane, lane + way), way > 0)) {
                            // A link asks for a high room between its lanes. There, the patch is as high as the text,
                            // so the cursor shows over the label and under it as two long pieces, and not as one wide gap.
                            const top = ink.y + row.y - padY, bottom = ink.y + row.y + ink.height + padY
                            rows.push(top - row.cover[0] >= size && row.cover[1] - bottom >= size ? { y: row.y, cover: [top, bottom] } : row)
                        }
                    }
                    // The line is slanted, so it is at one x at the top of a row of text and at another x at its bottom.
                    const [high, low] = [Math.min(ends.from[1], ends.to[1]), Math.max(ends.from[1], ends.to[1])]
                    const across = (level: number) => ends.from[0] + ((Math.min(Math.max(level, high), low) - ends.from[1]) / (ends.to[1] - ends.from[1])) * (ends.to[0] - ends.from[0])
                    // A line that is nearly flat stays under a text for a long way, so the clear distance is also up and down.
                    const clear = size * 0.3
                    const reachOf = (row: Row) => {
                        const one = across(ink.y + row.y - clear), other = across(ink.y + row.y + ink.height + clear)
                        return [Math.min(one, other), Math.max(one, other)] as const
                    }
                    const atRight = rows.map((row) => ({ x: startAt(reachOf(row)[1] + gapX), ...row })), atLeft = rows.map((row) => ({ x: endAt(reachOf(row)[0] - gapX), ...row }))
                    places = side === 'left' ? atLeft : side === 'right' ? atRight : [...atRight, ...atLeft]
                }
            } else if (plan.kind === 'bracket') {
                // On the far side of the line of the bracket, at its middle. Near an end of the time area, the label moves to stay in it.
                const level = this.bracketY(plan), end = this.x(plan.end)
                const width = Math.min(ink.width, this.w)
                const at = Math.min(Math.max((x + end) / 2, left + width / 2), right - width / 2)
                const row = plan.under ? underAt(level, level) : overAt(level, level)
                // A name that is wider than its bracket can be near a line at one end, such as a deadline. Then
                // it starts a little after the first end of the bracket, or ends a little before the last one.
                const nudge = size * 0.35
                places = [{ x: middleAt(at), ...row }, { x: startAt(x + nudge), ...row }, { x: endAt(end - nudge), ...row }]
            } else {
                // Over the dot, or over the bar that the dot is on. Near an end of the time area, the label moves to stay in it.
                const width = Math.min(ink.width, this.w)
                const at = Math.min(Math.max(x, left + width / 2), right - width / 2)
                const onBar = this.plans.some((other) => other.kind === 'span' && other.lane === plan.lane && other.row === plan.row && other.start <= plan.start && plan.start <= other.end)
                const radius = plan.outcome ? signRadius : dotRadius
                const reach = onBar ? (plan.outcome ? Math.max(half, radius) : half) : radius
                // With no bar, the patch stops short of the line of the lane, behind the dot.
                const over = { x: middleAt(at), ...overAt(y - reach, onBar ? y - half : y - 2) }, under = { x: middleAt(at), ...underAt(y + reach, onBar ? y + half : y + 2) }
                // A mark that is inside a span may have its label on the bar of that span, beside the dot.
                const on = plan.parent >= 0 ? plan.parent : undefined
                const atRight = { x: startAt(x + radius + gapX), ...band, on }, atLeft = { x: endAt(x - radius - gapX), ...band, on }
                if (side === 'under') places = [under]
                else if (side === 'right') places = [atRight]
                else if (side === 'left') places = [atLeft]
                else if (side === 'over' || on === undefined) places = [over]
                // The bar of a child span has its parent over it: the label is over the bar when that place is free, and on the bar when it is not.
                else places = [over, atRight, atLeft, under]
            }
            let met: Thing | null = null, chosen: (typeof places)[number] | null = null
            for (const place of places) {
                const box: Bounds = { x: ink.x + place.x, y: ink.y + place.y, width: ink.width, height: ink.height }
                if (box.x < left - 0.5 || box.x + box.width > right + 0.5) continue
                // A label has its place beside its own shape, or inside it.
                const hit = things.find((thing) => thing.event !== index && !(thing.bar === true && thing.event === place.on) && touches(box, thing.box))
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
            const label = texts[index] ?? null, sign = signs[index] ?? null
            const node = new LaneEventNode(plan.kind, shapes[index]!, label, tips[index] ?? null, edges[index] ?? null, sign, plan.id)
            // The sign of a handoff is a part of its event. The sign of a span is over all bars, so the next bar of the lane does not hide it.
            for (const part of [node.shape, node.edge, node.tip, ...plan.ticks.map((at) => this.ticks[at]!), plan.kind === 'handoff' ? sign : null, label]) if (part) node.add(part)
            node.hide()
            // A sign waits for the end of its span, or for the line of its handoff.
            sign?.hide()
            if (plan.kind === 'span' && sign) this.signs.push(sign)
            for (const part of [this.unders[index], this.patches[index]]) if (part) ground.add(part)
            this.events.push(node)
            if (plan.kind === 'span') this.spans.push(node)
            else if (plan.kind === 'handoff') this.handoffs.push(node)
            else if (plan.kind === 'link') this.links.push(node)
            else if (plan.kind === 'bracket') this.brackets.push(node)
            else this.marks.push(node)
        })

        // The order of what is drawn goes by kind, whatever the order of the list: the lines of the lanes, the
        // bars, the brackets, the boundaries, the deadlines, the arrows, the links, the signs, the dots. A
        // label touches nothing, so it is with its event. The cursor is under the patches, and the patches
        // are under all that the film must see in full.
        this.add(...this.rails)
        if (this.axis) this.add(this.axis)
        this.add(this.cursor, ground, ...this.spans, ...this.brackets, ...this.boundaries, ...this.deadlines, ...this.handoffs, ...this.links, ...this.signs, ...this.marks, ...this.names)
        // The object places each label beside its own bars, arrows and lines. The film check does not judge that room.
        ownLabels(this, { name: 'set of lanes' })
    }

    /**
     * The label of an event belongs to its bar, its arrow, or its dot, so a light on that shape keeps the label
     * bright. So does the sign of a span with an outcome, which is not in the node of its event.
     */
    override labelsOf(part: Node): readonly Node[] {
        const event = this.events.find((candidate) => candidate.shape === part)
        if (!event) return []
        return event.sign && event.sign.parent !== event ? [...event.children, event.sign] : event.children
    }

    /** The time of the cursor after the changes that are scheduled so far. It starts at the first end of the domain. */
    get time(): number {
        return this.cursorTime
    }

    /** The x of a time, in the coordinates of the object. The middle of the domain is at 0. */
    x(time: number): number {
        return -this.w / 2 + ((time - this.domain[0]) / (this.domain[1] - this.domain[0])) * this.w
    }

    /**
     * The y of the middle of the bars of a lane, in the coordinates of the object. The first lane and the last
     * one are at the same distance from 0. The child spans of a lane are in rows under these bars.
     */
    y(lane: LaneRef): number {
        const index = this.laneIndex(lane)
        if (index === null) throw new Error(`lanes: no lane ${JSON.stringify(lane)}. ${this.known()}`)
        return this.ys[index]!
    }

    /** The node of an event, by its `id` or by its index in the list of events. */
    find(event: LaneEventRef): LaneEventNode {
        return this.events[this.eventIndex(event)]!
    }

    /**
     * The time of an event. A span and a bracket have two times, and `edge` says which one: their end, or
     * their start with `'start'`. For a link it is the later of its two times, the time when it shows.
     */
    timeOf(event: LaneEventRef, edge: 'start' | 'end' = 'end'): number {
        if (edge !== 'start' && edge !== 'end') throw new Error(`lanes: timeOf takes 'start' or 'end', and it got ${JSON.stringify(edge)}`)
        const plan = this.plans[this.eventIndex(event)]!
        return edge === 'start' && plan.kind !== 'link' ? plan.start : plan.end
    }

    /**
     * Where an event is at the time of the cursor, after the changes that are scheduled so far: `'ahead'`
     * before the cursor reaches it, `'running'` for a span or a bracket that the cursor is in, and `'done'`
     * after it. An event with an `outcome` has that outcome in place of `'done'`.
     */
    stateOf(event: LaneEventRef): LaneEventState {
        const plan = this.plans[this.eventIndex(event)]!
        if (plan.end < this.cursorTime || (plan.end === this.cursorTime && this.started)) return plan.outcome ?? 'done'
        return (plan.kind === 'span' || plan.kind === 'bracket') && this.cursorTime > plan.start ? 'running' : 'ahead'
    }

    /**
     * The time that is left to a deadline at the time of the cursor, after the changes that are scheduled so
     * far. It is less than 0 when the cursor is past the deadline. Name the deadline by its index or by its
     * label. Without a name, it is the first deadline.
     */
    remaining(deadline: number | string = 0): number {
        const index = typeof deadline === 'number' ? (Number.isInteger(deadline) && deadline >= 0 && deadline < this.limits.length ? deadline : -1) : this.limits.findIndex((limit) => limit.name === deadline)
        if (index < 0) {
            const known = this.limits.length === 0 ? 'The object has no deadline: give it the option `deadline`' : `The deadlines are ${this.limits.map((limit, at) => (limit.name === undefined ? `${at}` : `${at} (${JSON.stringify(limit.name)})`)).join(', ')}`
            throw new Error(`lanes: no deadline ${JSON.stringify(deadline)}. ${known}`)
        }
        const limit = this.limits[index]!
        return limit.at - Math.max(this.cursorTime, limit.from)
    }

    /**
     * A point on an event, in the coordinates of the object, for the end of an arrow or a line from a note:
     * the middle of the top of its bar, its arrow, its dot or its bracket, or of another edge. It is the place
     * of the complete event. `flow.toWorld(...flow.p('retry'))` gives the place on the stage.
     */
    p(event: LaneEventRef, edge: 'top' | 'bottom' | 'left' | 'right' = 'top'): [number, number] {
        const box = this.boxes[this.eventIndex(event)]!
        if (edge === 'top' || edge === 'bottom') return [box.x + box.width / 2, edge === 'top' ? box.y : box.y + box.height]
        if (edge === 'left' || edge === 'right') return [edge === 'left' ? box.x : box.x + box.width, box.y + box.height / 2]
        throw new Error(`lanes: p takes the edge 'top', 'bottom', 'left' or 'right', and it got ${JSON.stringify(edge)}`)
    }

    /**
     * The box of a part of the object, in stage pixels, for `place` and `beside` of the layout: such as
     * `beside(note, flow.region({ lane: 'monitor', at: 1.09 }), 'above')`. Without a lane it is the time
     * area over all lanes. `lane` is the row of the bars of one lane. `between` is the room between the
     * bars of two lanes. `from` and `to` are times of the domain, and `at` is one time. `event` is the box
     * of one event, by its id or its index: its bar, its arrow, its dot, or its bracket. The box is where
     * the object is now, so ask for it after the object has its place.
     */
    region(part: { lane?: LaneRef; between?: readonly [LaneRef, LaneRef]; from?: number; to?: number; at?: number; event?: LaneEventRef } = {}): Box {
        const names = ['lane', 'between', 'from', 'to', 'at', 'event']
        if (typeof part !== 'object' || part === null) throw new Error(`lanes: region takes an object such as { lane: 0, at: 4 }, and it got ${part === null ? 'null' : typeof part}`)
        const unknown = Object.keys(part).find((name) => !names.includes(name))
        if (unknown !== undefined) throw new Error(`lanes: region has no part "${unknown}". Its parts are: ${names.join(', ')}`)
        if (part.event !== undefined) {
            const other = names.find((name) => name !== 'event' && (part as Record<string, unknown>)[name] !== undefined)
            if (other !== undefined) throw new Error(`lanes: region takes \`event\` alone, and it also got \`${other}\`. An event has its own lane and its own time`)
            const box = this.boxes[this.eventIndex(part.event)]!
            const [x0, y0] = this.toWorld(box.x, box.y), [x1, y1] = this.toWorld(box.x + box.width, box.y + box.height)
            return new Box(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1))
        }
        if (part.at !== undefined && (part.from !== undefined || part.to !== undefined)) throw new Error('lanes: region takes `at` for one time, or `from` and `to` for a stretch of time, not both')
        const half = this.barHeight / 2
        // The rows of the child spans of a lane are a part of the lane.
        let top = this.ys[0]! - half, bottom = this.ys[this.ys.length - 1]! + half + this.depths[this.ys.length - 1]!
        if (part.lane !== undefined && part.between !== undefined) throw new Error('lanes: region takes `lane` or `between`, not both. `lane` is the row of one lane, and `between` is the room between two lanes')
        if (part.lane !== undefined) {
            top = this.y(part.lane) - half
            bottom = this.y(part.lane) + half + this.depths[this.laneIndex(part.lane)!]!
        } else if (part.between !== undefined) {
            const one = this.y(part.between[0]), other = this.y(part.between[1])
            if (one === other) throw new Error(`lanes: region: \`between\` names the lane ${JSON.stringify(part.between[0])} two times. Give two lanes, such as the first two: ${JSON.stringify(this.laneNames.slice(0, 2))}`)
            top = Math.min(one, other) + half + this.depths[this.laneIndex(part.between[one < other ? 0 : 1])!]!
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

    /** The names, the lines of the lanes, the boundaries, the deadlines and the axis arrive, lane by lane. No event shows yet. */
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
                // A deadline comes with the axis: its line draws from its top, and its bar and its text fade in.
                for (const made of this.deadlines) {
                    const [rule, ...rest] = made.children
                    const start = ctx.t0 + (ctx.t1 - ctx.t0) * 0.3
                    stepAt(rule!, 'trimTo', 0, ctx.t0)
                    rule!.tween('trimTo', 1, start, ctx.t1, ctx.ease)
                    for (const part of rest) {
                        stepAt(part, 'opacity', 0, ctx.t0)
                        part.tween('opacity', 1, start, ctx.t1, ctx.ease)
                    }
                }
            },
        }
    }

    /**
     * The cursor moves from its time to `to`, and stops. What it passes appears. A span grows with the cursor.
     * A handoff draws its arrow and a mark shows its dot when the cursor reaches them. A label arrives when its
     * event is complete, and a label inside a bar arrives when the bar starts to grow. All of it is over when
     * the animation ends: when the last event needs time after the cursor reaches it, the cursor stops early.
     * `to` is a time, or the id of an event. With an id, the cursor stops at the time of that event, which is
     * the end of a span or a bracket, so a note can point at the event while the cursor waits there.
     */
    advance(to: number | string, options: AnimOptions = {}): Anim {
        const time = typeof to === 'string' ? this.timeOf(to) : to
        // Find a wrong time now, where the film names it. Check again when the move is scheduled, because an
        // advance that is earlier in the same sequence moves the cursor first.
        this.checkAdvance(time)
        return {
            label: 'lanes.advance', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                this.checkAdvance(time)
                this.sweep(time, ctx)
            },
        }
    }

    /** The same as `advance` to the last end of the domain. It takes 4 seconds when the film gives no duration. */
    showAll(options: AnimOptions = {}): Anim {
        return this.advance(this.domain[1], { ...options, duration: options.duration ?? 4 })
    }

    private laneIndex(ref: LaneRef): number | null {
        if (typeof ref === 'number') return Number.isInteger(ref) && ref >= 0 && ref < this.laneNames.length ? ref : null
        const index = this.laneNames.indexOf(ref)
        return index < 0 ? null : index
    }

    private eventIndex(ref: LaneEventRef): number {
        if (typeof ref === 'number') {
            if (Number.isInteger(ref) && ref >= 0 && ref < this.plans.length) return ref
            throw new Error(`lanes: no event ${ref}. ${this.plans.length === 0 ? 'The object has no event' : `The events are 0 to ${this.plans.length - 1}`}`)
        }
        const index = this.plans.findIndex((plan) => plan.id === ref)
        if (index < 0) {
            const ids = this.plans.filter((plan) => plan.id !== null).map((plan) => JSON.stringify(plan.id))
            throw new Error(`lanes: no event has the id ${JSON.stringify(ref)}. ${ids.length === 0 ? 'No event has an id: give the event an `id`' : `The ids are ${ids.join(', ')}`}`)
        }
        return index
    }

    /** The time of the cursor at the frame that is drawn now. `time` is the time after all changes that are scheduled. */
    private shownTime(): number {
        return this.domain[0] + ((this.cursor.get('x') + this.w / 2) / this.w) * (this.domain[1] - this.domain[0])
    }

    /** The y of the middle of the row of a span or a mark: the row of its lane, or a row under it for a child span. */
    private rowY(plan: Plan): number {
        return this.ys[plan.lane]! + plan.row * this.rowPitch
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
        const y = this.rowY(plan), half = this.barHeight / 2
        return barPath(this.x(plan.start), this.x(Math.min(Math.max(time, plan.start), plan.end)), y - half, this.barHeight, Math.max(3, this.barHeight * 0.14), plan.open || (plan.idle && !complete))
    }

    /** The outline of an idle span when the cursor is at a time, or the hatch of a span where the lane is down. */
    private edge(plan: Plan, time: number, closed: boolean): Path {
        const y = this.rowY(plan), half = this.barHeight / 2
        if (plan.down) return hatchPath(this.x(plan.start), this.x(Math.min(Math.max(time, plan.start), plan.end)), y - half, this.barHeight, this.hatchStep)
        return edgePath(this.x(plan.start), this.x(Math.min(Math.max(time, plan.start), plan.end)), y - half, this.barHeight, Math.max(3, this.barHeight * 0.14), closed)
    }

    /** The y of the line of a bracket: over the bars of its lane, or under its lowest row. */
    private bracketY(plan: Plan): number {
        const half = this.barHeight / 2
        return plan.under ? this.ys[plan.lane]! + half + this.depths[plan.lane]! + this.bracketGap : this.ys[plan.lane]! - half - this.bracketGap
    }

    /** The line of a bracket when the cursor is at a time: its first end, its line, and its last end when it is `closed`. */
    private bracket(plan: Plan, time: number, closed: boolean): Path {
        const level = this.bracketY(plan), end = level + (plan.under ? -1 : 1) * this.bracketEnd
        const x0 = this.x(plan.start), x1 = this.x(Math.min(Math.max(time, plan.start), plan.end))
        return parseSvgPath(`M${x0} ${end}L${x0} ${level}L${x1} ${level}${closed ? `L${x1} ${end}` : ''}`)
    }

    /** The part that is left of the bar of a deadline when the cursor is at a time. */
    private drain(limit: Limit, time: number): Path {
        const x0 = this.x(Math.min(Math.max(time, limit.from), limit.at)), x1 = this.x(limit.at)
        return x1 - x0 > 0.5 ? rectPath(x0, limit.top, x1 - x0, limit.height, Math.min(limit.height / 2, (x1 - x0) / 2)) : []
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
            if (plan.kind === 'span' || plan.kind === 'bracket') {
                // A span starts when the cursor leaves its start. So a stop at the start of a span shows nothing of it.
                if (plan.start >= from && plan.start < to) steps.push({ share: share(plan.start), seconds: plan.inside ? FADE : 0, run: (start, end) => this.startSpan(index, start, end) })
                // The sign of an outcome arrives as a dot does, which takes longer than an outline.
                if (due(plan.end)) steps.push({ share: share(plan.end), seconds: plan.outcome ? REVEAL : FADE, run: (start, end) => this.endSpan(index, start, end) })
            } else if (due(plan.end)) {
                // A link shows at the later of its two times, when both of its ends are there.
                steps.push({ share: share(plan.end), seconds: REVEAL, run: (start, end) => (plan.kind === 'handoff' ? this.showHandoff(index, start, end, counts) : plan.kind === 'link' ? this.showLink(index, start, end) : this.showMark(index, start, end)) })
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
                if ((plan.kind !== 'span' && plan.kind !== 'bracket') || plan.start >= to || plan.end <= from) return
                const node = this.events[index]!
                if (plan.kind === 'bracket') {
                    // The line of a bracket grows with the cursor, as a bar does.
                    node.shape.track('path').add({ t0, t1: arrive, ease, to: this.bracket(plan, to, false), at: (alpha) => this.bracket(plan, at(alpha), false) })
                    return
                }
                for (const part of [node.shape, this.unders[index]]) {
                    part?.track('path').add({ t0, t1: arrive, ease, to: this.bar(plan, to, false), at: (alpha) => this.bar(plan, at(alpha), false) })
                }
                node.edge?.track('path').add({ t0, t1: arrive, ease, to: this.edge(plan, to, false), at: (alpha) => this.edge(plan, at(alpha), false) })
            })
            // The bar of a deadline drains: its first end is at the cursor at every frame.
            this.limits.forEach((limit, index) => {
                this.drains[index]?.track('path').add({ t0, t1: arrive, ease, to: this.drain(limit, to), at: (alpha) => this.drain(limit, at(alpha)) })
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
        if (plan.kind === 'bracket') {
            // The name of a bracket waits for its end, as a label over a bar does.
            this.showLabel(index, start, null, end)
            return
        }
        if (this.unders[index]) stepAt(this.unders[index]!, 'visible', true, start)
        // What closes the span waits for its end: the outline, the arrow head, and a label over the bar.
        if (!plan.open && !plan.idle) stepAt(node.shape, 'strokeOpacity', 0, start)
        if (node.tip) stepAt(node.tip, 'opacity', 0, start)
        // A label inside the bar comes at once, so the viewer reads what the lane does while the bar grows.
        this.showLabel(index, start, plan.inside ? start : null, end)
    }

    private endSpan(index: number, start: number, end: number): void {
        const node = this.events[index]!, plan = this.plans[index]!
        // A span with an outcome has more time, for its sign. What closes the bar takes the time of a fade.
        const faded = Math.min(end, start + FADE)
        if (plan.kind === 'bracket') {
            // The line gets its last end, and then its name.
            stepAt(node.shape, 'path', this.bracket(plan, plan.end, true), start)
            this.showLabel(index, null, start, faded)
            return
        }
        if (!plan.open && !plan.idle) node.shape.tween('strokeOpacity', 1, start, faded, smooth)
        if (!plan.open && plan.idle) {
            // The outline of dashes gets its right end, and the bar its round corners.
            for (const part of [node.shape, this.unders[index]]) if (part) stepAt(part, 'path', this.bar(plan, plan.end, true), start)
            stepAt(node.edge!, 'path', this.edge(plan, plan.end, true), start)
        }
        node.tip?.tween('opacity', 1, start, faded, smooth)
        if (node.sign) this.pop(node.sign, start, start + (end - start) * 0.5)
        if (!plan.inside) this.showLabel(index, null, start, faded)
    }

    private showHandoff(index: number, start: number, end: number, counts: number[]): void {
        const node = this.events[index]!, plan = this.plans[index]!
        const [shaft, head] = node.shape.children as [Node, Node]
        const drawn = start + (end - start) * 0.5
        stepAt(node, 'visible', true, start)
        if (node.sign) {
            // A handoff that is lost: the line leaves its lane, and the sign arrives where the line stops.
            stepAt(shaft, 'trimTo', 0, start)
            shaft.tween('trimTo', 1, start, start + (drawn - start) * 0.5, smooth)
            this.pop(node.sign, start + (drawn - start) * 0.5, drawn)
            this.showLabel(index, start, drawn, end)
            return
        }
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

    /** A link draws its line from its first end to its second, and its head arrives when the line is there. */
    private showLink(index: number, start: number, end: number): void {
        const node = this.events[index]!
        const [shaft, head] = node.shape.children as [Node, Node]
        const drawn = start + (end - start) * 0.5
        stepAt(node, 'visible', true, start)
        stepAt(shaft, 'trimTo', 0, start)
        shaft.tween('trimTo', 1, start, drawn, smooth)
        stepAt(head, 'opacity', 0, start)
        head.tween('opacity', 1, start + (drawn - start) * 0.6, drawn, smooth)
        this.showLabel(index, start, drawn, end)
    }

    /** The sign of an outcome arrives as a dot does: it grows from a small size and fades in. It is hidden until then. */
    private pop(sign: Node, start: number, end: number): void {
        stepAt(sign, 'visible', true, start)
        for (const prop of ['sx', 'sy'] as const) {
            stepAt(sign, prop, 0.3, start)
            sign.tween(prop, 1, start, end, smooth)
        }
        stepAt(sign, 'opacity', 0, start)
        sign.tween('opacity', 1, start, end, smooth)
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
 * A trace of a request with a deadline:
 * `lanes(['server'], [{ lane: 0, start: 0, end: 18, id: 'answer', label: 'answer' }, { lane: 0, start: 2, end: 9, inside: 'answer', label: 'retrieval', outcome: 'failed' }], { deadline: { at: 20, label: 'deadline', drain: true } })`.
 */
export function lanes(names: readonly (string | Lane)[], events: readonly LaneEvent[], options: LanesOptions = {}): Lanes {
    return new Lanes(names, events, options)
}
