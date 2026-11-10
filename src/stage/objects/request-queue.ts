import { Node, ownLabels } from '../node'
import { parseSvgPath, polyPath, rectPath, type Path } from '../geometry'
import { mixPaint, toPaint, type ColorInput, type Paint } from '../color'
import { dot, line, rect } from '../shapes'
import { filmFont, text, type TextOptions } from '../text'
import { advanceWidth } from '../text-fit'
import { linear, type Ease } from '../ease'
import { clock, type Key } from '../track'
import type { Anim, AnimContext, AnimOptions } from '../anim'
import { Box } from '../layout'
import { forwardOnly, reveal, staggered, stepAt } from './util'

type Id = string | number

/** The name of a waiting line, or its index. */
export type QueueLineRef = string | number

export interface QueueLine {
    /** The name over the line, with the count of the items that wait in it. */
    name: string
    /** The color of the items of the line that have none of their own. Defaults to the `color` of the queue. */
    color?: ColorInput
}

export interface QueueItem {
    /** The identity of the item, written on it: 'R1', 'A', 4219. An id is in the queue one time. */
    id: Id
    /** Defaults to the color of its line. */
    color?: ColorInput
    /**
     * The size of the item, in units of work: decode steps, tokens, seconds. A whole number, 1 or more. The item
     * shows the units that are left, and fills as it runs. Without it, the item has no number and no bar.
     */
    work?: number
    /** The blocks of the pool that the item holds while it runs. Defaults to 0. */
    blocks?: number
    /** The line that the item waits in. Defaults to the first line. */
    line?: QueueLineRef
    /** For an item of the constructor: it is in a slot from the start, as an item that runs already. */
    running?: boolean
}

/** What an item is and where, after the changes that are scheduled so far. */
export interface QueueItemState {
    id: Id
    /** `waiting` in a line, `running` in a slot, `done` after `finish`, or `rejected` after `reject`. */
    state: 'waiting' | 'running' | 'done' | 'rejected'
    /** The index of the line of the item. */
    line: number
    /** The place in its line, from 0 at the head. Null for an item that does not wait. */
    place: number | null
    /** The slot of the item. Null for an item that does not run. */
    slot: number | null
    /** The units of work of the item, or undefined. */
    work: number | undefined
    /** The units of work that are left, or undefined for an item with no `work`. */
    left: number | undefined
    /** The blocks that the item needs while it waits, and that it holds while it runs. */
    blocks: number
    /** The wait of the item: the value of the last `wait()`, or 0. */
    wait: number
    /** The wait is at the `deadline` of the queue, or past it. */
    late: boolean
    /** The status that the item left with, or undefined. */
    status: string | undefined
}

export interface QueuePool {
    /** The number of blocks. */
    blocks: number
    /** The name over the blocks, such as 'KV blocks'. Defaults to 'blocks'. */
    name?: string
    /** The blocks in one row. Defaults to 8, or to `blocks` when it is less. */
    columns?: number
}

/** The items of a call: an id, a list of ids, or a function of an item, which the queue calls when the change is scheduled. */
export type QueueWhich = Id | readonly Id[] | ((item: QueueItemState) => boolean)

/** A part of the queue, for `p` and `region`: a line, a place of a line, a slot, a block, all slots, or the pool. */
export type QueuePart = { line: QueueLineRef; place?: number } | { slot: number } | { block: number } | 'slots' | 'pool'

export interface RequestQueueOptions {
    /** The number of slots: the seats of a batch, the workers of a server. They are one column at the right. Defaults to 1. */
    slots?: number
    /**
     * The waiting lines, from the top. A line is a name, or `{ name, color }`. `admit()` serves the first line
     * that has an item, so the order of the lines is their priority. Defaults to one line, 'waiting'.
     */
    lines?: readonly (string | QueueLine)[]
    /**
     * The words of the counts: `slots` over the slots, `done` under them, and `rejected` under the lines. Null
     * for `done` or `rejected` draws no count there. Defaults to 'running', 'done' and 'rejected'.
     */
    names?: { slots?: string; done?: string | null; rejected?: string | null }
    /** Show the numbers: the items of each line, the items that run, and the two counts. Without them, the names alone. On by default. */
    counts?: boolean
    /** A pool of fixed blocks under the slots, such as the pages of a KV cache: a number of blocks, or `{ blocks, name, columns }`. */
    pool?: number | QueuePool
    /** The wait from which an item is late. The number of `wait()` turns red there, and the border of the item gets dashes. */
    deadline?: number
    /** How to write a wait, such as (ms) => `${Math.round(ms)} ms`. Defaults to the whole number. */
    format?: (wait: number) => string
    /** The width of the whole object. The lines get the places that fit. Defaults to 1600. */
    width?: number
    /** The width of an item. Defaults to the room of the longest id of the first items, and 4.3 text sizes at the least. */
    itemWidth?: number
    /** Text size of the ids. The names, the counts and the numbers are 0.93 of it: 26 at the default. Defaults to 28. */
    size?: number
    /** The color of an item whose line has no color. Defaults to blue. */
    color?: ColorInput
    /** The font of the names and the numbers. Defaults to the font of the film. */
    font?: TextOptions['font']
    /** The font of the ids, such as 'mono' for request ids. Defaults to `font`. */
    idFont?: TextOptions['font']
}

/** One stretch of motion. A stretch with leads is never further along than they are, so no item passes the item before it. */
interface Seg {
    t0: number
    t1: number
    ease: Ease
    leads: Seg[]
}

/** A move of an item: how far it is from where the move starts, at each share of the way. */
interface Move {
    seg: Seg
    at: (share: number) => readonly [number, number]
    total: readonly [number, number]
}

/** A count over time: its first value, and each change with its time. */
interface Counter {
    base: number
    steps: { time: number; delta: number }[]
}

interface Rec {
    id: Id
    /** The index of the nodes of the item in the lists of nodes. */
    index: number
    color: Paint
    line: number
    state: QueueItemState['state']
    place: number | null
    slot: number | null
    work: number | undefined
    done: number
    need: number
    /** The blocks that the item holds. */
    held: number[]
    wait: number
    status: string | undefined
    /** Where the item is before its moves, and its moves. */
    x0: number
    y0: number
    moves: Move[]
    /** The stretch in which the item arrives, and the one in which it leaves. */
    born: Seg | null
    gone: Seg | null
    /** The part of the way out after which the item starts to fade: an item that leaves a slot is clear of it first. */
    hold: number
    /** The work that was done before the runs, and the runs. */
    done0: number
    runs: { seg: Seg; units: number }[]
    /** The wait before the calls of `wait()`, the calls, and the time from which the number shows. */
    wait0: number
    waits: { seg: Seg; delta: number }[]
    clocked: number | null
    /** The stretch in which the item leaves its line for a slot. The number of its wait goes in its first part. */
    quiet: Seg | null
    /** The stretch in which the item takes the look of a rejected item. */
    marked: Seg | null
    /** The last change of the state of the item, with the time at which it is over. */
    busy: { call: string; t1: number } | null
}

interface Row {
    name: string
    color: Paint
    /** The items that wait, from the head. */
    order: Rec[]
    lastArrive: Seg | null
    lastShift: { seg: Seg; call: string } | null
    waiting: Counter
    /** The items that have no place in the picture: the line has more items than places. */
    hidden: Counter
}

interface Seat {
    owner: Rec | null
    /** The stretch in which the last item of the slot leaves it. */
    leaving: Seg | null
    /** How much of the outline shows at the start, and each change of it: an item that comes in hides it, and one that leaves shows it. */
    base: number
    changes: { seg: Seg; to: number; after: number }[]
}

/** The look of a block: the paint of its owner, or null for a free block. */
interface BlockChange {
    seg: Seg
    paint: Paint | null
}

interface Block {
    owner: Rec | null
    base: Paint | null
    changes: BlockChange[]
}

/** The sizes and the places that follow from the options. Every x and y is in the coordinates of the object. */
interface Geometry {
    w: number
    h: number
    gap: number
    pitch: number
    seatPitch: number
    /** The places of a line. */
    places: number
    left: number
    right: number
    top: number
    bottom: number
    /** The middle of the head place, of the room where an item arrives, and of the slots. */
    headX: number
    entryX: number
    seatX: number
    lineY: number[]
    seatY: number[]
    /** The height of a row of names, and of the row of the waits under a line. */
    nameRow: number
    waitRow: number
    cell: number
    cellPitch: number
    columns: number
    poolLeft: number
    poolTop: number
}

// Two times nearer than this are one time: the end of one animation is the start of the next.
const SOON = 1e-9
// A time that no film reaches, as a power of two. A key from 0 to this time gets each frame time back exactly.
const FOREVER = 2 ** 20
// A stretch that is over at every time: an item of a copy is at rest.
const OVER: Seg = { t0: -Infinity, t1: -Infinity, ease: linear, leads: [] }
// The names, the counts and the numbers, as a part of the text size of the ids: 26 px at the default of 28.
const SMALL = 0.93
// The height of an item, the room between its border and its text, and the room between two items, as parts of the text size.
const HEIGHT = 1.8
const PAD = 0.5
const GAP = 0.45
// The smallest id, as a part of the text size. A longer id is an error, as a line with one small id reads badly.
const FLOOR = 0.6
// The opacity of the fill of an item that runs, and of a block that is taken. An id in ink reads on both.
const BAR = 0.4
const TAKEN = 0.7
// The parts of the time of `reject`: the status arrives, the viewer reads it, the item fades, the line closes up.
const MARKED = 0.2
const FADES = 0.6
const CLOSES = 0.8
// An item that leaves a slot starts to fade after this part of its way out, when it is half out of the slot.
const LEAVES = 0.4
// The cross before a status and the room after it, as a part of the size of the status.
const CROSS = 0.83
// A line has places for this many items at the most. A longer line is a list, and not a picture of a queue.
const SLOTS = 12
const LINES = 4
const BLOCKS = 256

const clamp = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value)
const shown = (id: unknown) => (typeof id === 'string' ? JSON.stringify(id) : String(id))
const seconds = (time: number) => `${Math.round(time * 100) / 100} s`
/** The start of a message: the object, and the call when it is not the constructor. */
const at = (call: string) => (call === 'requestQueue' ? call : `requestQueue: ${call}`)
const total = (counter: Counter) => counter.steps.reduce((sum, step) => sum + step.delta, counter.base)
const countAt = (counter: Counter, time: number) => counter.steps.reduce((sum, step) => (step.time <= time + SOON ? sum + step.delta : sum), counter.base)

/** A key whose value at each frame is a function of the time of that frame, from a time on. */
const always = <T>(read: (time: number) => T, from: number): Key<T> => ({ t0: from, t1: from + FOREVER, ease: null, to: read(from + FOREVER), at: (alpha) => read(from + alpha * FOREVER) })

/** How far a stretch is at a time, 0 to 1. It never goes back, and it is never ahead of a stretch that it follows. */
function progress(seg: Seg, time: number): number {
    let share = time >= seg.t1 - SOON ? 1 : time <= seg.t0 ? 0 : clamp(seg.ease((time - seg.t0) / (seg.t1 - seg.t0)))
    for (const lead of seg.leads) share = Math.min(share, progress(lead, time))
    return share
}

/** A straight move. */
function slide(seg: Seg, dx: number, dy: number): Move {
    return { seg, at: (share) => [dx * share, dy * share], total: [dx, dy] }
}

/** A move along a line of straight pieces, at one speed. */
function route(seg: Seg, points: readonly (readonly [number, number])[]): Move {
    const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index]![0], point[1] - points[index]![1]))
    const whole = lengths.reduce((sum, length) => sum + length, 0)
    const [x0, y0] = points[0]!, last = points[points.length - 1]!
    const at = (share: number): readonly [number, number] => {
        let rest = share * whole
        for (let index = 0; index < lengths.length; index++) {
            const length = lengths[index]!
            if (rest <= length || index === lengths.length - 1) {
                const part = length > 0 ? Math.min(1, rest / length) : 1, from = points[index]!, to = points[index + 1]!
                return [from[0] + (to[0] - from[0]) * part - x0, from[1] + (to[1] - from[1]) * part - y0]
            }
            rest -= length
        }
        return [0, 0]
    }
    return { seg, at, total: [last[0] - x0, last[1] - y0] }
}

function oneLine(what: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`requestQueue: ${what} is ${typeof value === 'string' ? 'empty' : String(value)}. Give a text of one line`)
    if (/[\n\r\t]/.test(value)) throw new Error(`requestQueue: ${what} (${JSON.stringify(value)}) has a line break or a tab. It is one line of text`)
    return value.trim()
}

/** A `duration` and a `lag` are numbers, 0 or more. One that is not a number would write keys that no frame finds. */
function timed(call: string, options: AnimOptions): void {
    for (const key of ['duration', 'lag'] as const) {
        const value = options[key]
        if (value !== undefined && !(Number.isFinite(value) && value >= 0)) throw new Error(`requestQueue: the ${key} of ${call} is ${String(value)}. Give a number, 0 or more`)
    }
}

function paintOf(color: ColorInput, what: string): Paint {
    try {
        return toPaint(color)
    } catch {
        throw new Error(`requestQueue: ${what} is ${shown(color)}, which is not a color. Use a color of the look, such as 'orange', or a CSS color`)
    }
}

/**
 * Items with an identity that wait in line in front of slots: the requests of a model server and the seats of
 * its batch, the jobs of a pool of workers, the calls at a gate. `arrive()` puts an item at the end of its
 * line, `admit()` moves the head of a line into a free slot, `run()` lets the items in the slots work,
 * `finish()` drains a slot, and `reject()` sends an item away with its status. `wait()` runs the wait of one
 * item as a number. With `pool`, an item takes blocks while it runs and gives them back when it finishes.
 * Each animation leaves the queue in the state that the next one starts from, and `stateOf`, `find`, `count` and
 * `next` read that state. `.at()` places the middle of the object, which is `width` wide.
 */
export class RequestQueue extends Node {
    /** The line of each waiting line, with its arrow head toward the slots. The queue draws it for each frame, with a gap under each item. */
    readonly rails: Node[] = []
    /** The name and the count over each waiting line. */
    readonly captions: Node[] = []
    /** Three dots at the far end of each line. They show while the line has more items than places. The queue shows and hides the dots inside this node. */
    readonly more: Node[] = []
    /** The outline of each slot, from the top. It shows while the slot is free. The queue shows and hides the outline inside this node. */
    readonly seats: Node[] = []
    /** The name and the count over the slots. */
    readonly slotsCaption: Node
    /** The count under the slots, or null. */
    readonly doneTally: Node | null
    /** The count under the lines, or null. */
    readonly rejectedTally: Node | null
    /** One rounded square per block of the pool, row by row. The list is empty without `pool`. */
    readonly blocks: Node[] = []
    /** The name and the count over the pool, or null without `pool`. */
    readonly poolCaption: Node | null
    /**
     * One node per item, in the order of arrival: its box, its bar, its id and its numbers. Fade, light or
     * circle it as one node. The queue moves the item, so do not move this node.
     */
    readonly chips: Node[] = []
    /** The number of slots, and the places of one line. A line with more items shows the first ones, and three dots. */
    readonly slots: number
    readonly places: number
    /** The width of an item. */
    readonly itemWidth: number
    private readonly geo: Geometry
    private readonly size: number
    private readonly small: number
    private readonly font: NonNullable<TextOptions['font']>
    private readonly idFont: NonNullable<TextOptions['font']>
    private readonly showCounts: boolean
    private readonly deadline: number | undefined
    private readonly format: (wait: number) => string
    private readonly words: { slots: string; done: string | null; rejected: string | null; pool: string }
    private readonly red: Paint
    private readonly free: Paint
    /** The dashes of a free block: four in each quarter of its outline, as the cells of a state grid have. */
    private readonly cellDashes: readonly number[]
    /** The shape that gives the object its bounds: its full size, with the room where items arrive and leave. */
    private readonly frame: Node
    /** All items. `enter()` fades it. */
    private readonly layer = new Node()
    /** The parts of each item, by the index of the item: what the queue moves, and the box, the bar, and the two numbers. */
    private readonly outers: Node[] = []
    private readonly bodies: Node[] = []
    private readonly bars: Node[] = []
    private readonly numbers: Node[] = []
    private readonly unders: Node[] = []
    /** The bookkeeping. The animations change it when they are scheduled, so two changes in one sequence chain. */
    private recs: Rec[] = []
    private byId = new Map<string, Rec>()
    private rows: Row[]
    private taken: Seat[]
    private cells: Block[]
    private running: Counter = { base: 0, steps: [] }
    private finished: Counter = { base: 0, steps: [] }
    private refused: Counter = { base: 0, steps: [] }
    private used: Counter = { base: 0, steps: [] }
    /** The last `admit`. The slots take one item at a time, so the next one starts when it is over. */
    private lastAdmit: { call: string; t1: number } | null = null
    /** The change that starts last, of those that the film has played. The next change starts at that time or later. */
    private latest: { call: string; t0: number } | null = null

    constructor(items: readonly QueueItem[] = [], options: RequestQueueOptions = {}) {
        super()
        if (!Array.isArray(items)) throw new Error('requestQueue: the first argument is the list of the items that are there at the start. Give a list, or an empty one: requestQueue([], { slots: 3 })')
        const size = this.size = options.size ?? 28
        if (!(Number.isFinite(size) && size > 0)) throw new Error('requestQueue: size is a text size, more than 0')
        const small = this.small = Math.round(size * SMALL * 10) / 10
        const slots = this.slots = options.slots ?? 1
        if (!Number.isInteger(slots) || slots < 1 || slots > SLOTS) throw new Error(`requestQueue: slots is ${String(options.slots)}. A queue has 1 to ${SLOTS} slots, a whole number`)
        const font = this.font = options.font ?? filmFont() ?? 'sans'
        this.idFont = options.idFont ?? font
        this.showCounts = options.counts !== false
        if (options.deadline !== undefined && !(Number.isFinite(options.deadline) && options.deadline > 0)) throw new Error(`requestQueue: deadline is ${String(options.deadline)}. It is the wait from which an item is late, more than 0`)
        this.deadline = options.deadline
        if (options.format !== undefined && typeof options.format !== 'function') throw new Error('requestQueue: format is a function that writes a wait, such as (ms) => `${Math.round(ms)} ms`')
        this.format = options.format ?? ((wait) => String(Math.round(wait)))
        const base = paintOf(options.color ?? 'blue', 'color')
        this.red = toPaint('red')
        this.free = toPaint('faint')

        const lines = (options.lines ?? ['waiting']).map((entry) => (typeof entry === 'string' ? { name: entry } : entry))
        if (lines.length < 1 || lines.length > LINES) throw new Error(`requestQueue: lines has ${lines.length} lines. A queue has 1 to ${LINES} waiting lines`)
        this.rows = lines.map((entry, index) => {
            const name = oneLine(`the name of line ${index}`, entry?.name)
            return { name, color: entry.color === undefined ? base : paintOf(entry.color, `the color of the line ${JSON.stringify(name)}`), order: [], lastArrive: null, lastShift: null, waiting: { base: 0, steps: [] }, hidden: { base: 0, steps: [] } }
        })
        this.rows.forEach((row, index) => {
            if (this.rows.findIndex((other) => other.name === row.name) !== index) throw new Error(`requestQueue: two lines have the name ${JSON.stringify(row.name)}. Give each line its own name`)
        })
        const names = options.names ?? {}
        const pool = options.pool === undefined ? null : typeof options.pool === 'number' ? { blocks: options.pool } : options.pool
        this.words = {
            slots: oneLine('names.slots', names.slots ?? 'running'),
            done: names.done === null ? null : oneLine('names.done', names.done ?? 'done'),
            rejected: names.rejected === null ? null : oneLine('names.rejected', names.rejected ?? 'rejected'),
            pool: oneLine('the name of the pool', pool?.name ?? 'blocks'),
        }
        if (pool && (!Number.isInteger(pool.blocks) || pool.blocks < 1 || pool.blocks > BLOCKS)) throw new Error(`requestQueue: the pool has ${String(pool.blocks)} blocks. A pool has 1 to ${BLOCKS} blocks, a whole number. Let one block stand for more than one unit, and say so in its name`)
        const columns = pool ? pool.columns ?? Math.min(8, pool.blocks) : 0
        if (pool && (!Number.isInteger(columns) || columns < 1)) throw new Error(`requestQueue: the columns of the pool are ${String(pool.columns)}. Give a whole number, 1 or more`)
        this.taken = Array.from({ length: slots }, () => ({ owner: null, leaving: null, base: 1, changes: [] }))
        this.cells = Array.from({ length: pool?.blocks ?? 0 }, () => ({ owner: null, base: null, changes: [] }))

        // The first items. A wrong one is named here, before anything is drawn.
        const first = this.checked(items, 'requestQueue')
        const least = Math.round(size * 4.3)
        const w = this.itemWidth = options.itemWidth ?? Math.max(least, ...first.map((item) => Math.ceil(this.inner(item.id, item.work) + size * PAD * 2)))
        if (!(Number.isFinite(w) && w >= size * 2)) throw new Error(`requestQueue: itemWidth is ${String(options.itemWidth)}. It is the width of an item, ${Math.ceil(size * 2)} or more at this text size`)
        for (const item of first) this.fits(item.id, item.work)

        const width = options.width ?? 1600
        if (!(Number.isFinite(width) && width > 0)) throw new Error('requestQueue: width is the width of the whole object, more than 0')
        const geo = this.geo = this.measure(width, lines.length, pool ? { blocks: pool.blocks, columns } : null)
        this.places = geo.places

        this.frame = new Node(polyPath([[geo.left, geo.top], [geo.right, geo.top], [geo.right, geo.bottom], [geo.left, geo.bottom]], true))
        this.add(this.frame)

        const stroke = Math.max(2, size * 0.075), dashes = this.dashes()
        const headRight = geo.headX + geo.w / 2, seatLeft = geo.seatX - geo.w / 2
        this.rows.forEach((_, index) => {
            const y = geo.lineY[index]!
            this.rails.push(new Node())
            const dots = new Node().add(...[-1, 0, 1].map((step) => dot(Math.max(2, small * 0.1), 'dim').at(geo.entryX - geo.w * 0.2 + step * small * 0.36, y)))
            this.more.push(new Node().add(dots))
            this.captions.push(new Node().at(headRight, y - geo.h / 2 - geo.nameRow / 2))
        })
        geo.seatY.forEach((y) => {
            const outline = new Node(rectPath(geo.seatX - geo.w / 2, y - geo.h / 2, geo.w, geo.h, this.radius())).stroke(this.free, stroke).dash(dashes)
            outline.set('cap', 'butt')
            this.seats.push(new Node().add(outline))
        })
        this.slotsCaption = new Node().at(seatLeft, geo.seatY[0]! - geo.h / 2 - geo.nameRow / 2)
        this.doneTally = this.words.done !== null && this.showCounts ? new Node().at(seatLeft, geo.seatY[slots - 1]! + geo.h / 2 + geo.nameRow / 2) : null
        this.rejectedTally = this.words.rejected !== null && this.showCounts ? new Node().at(headRight, geo.lineY[lines.length - 1]! + geo.h / 2 + geo.waitRow + geo.nameRow / 2) : null
        this.poolCaption = pool ? new Node().at(geo.poolLeft, geo.poolTop + geo.nameRow / 2) : null
        const corner = Math.max(1, geo.cell * 0.16), period = (geo.cell - 2 * corner + (Math.PI / 2) * corner) / 4
        this.cellDashes = [period * 0.6, period * 0.4]
        this.cells.forEach((_, index) => {
            const [x, y] = this.blockAt(index)
            const cell = rect(geo.cell, geo.cell, { radius: corner, fill: this.free, stroke: this.free, width: Math.max(1.5, geo.cell * 0.055) }).at(x, y)
            // The ends of a dash are flat, and one dash is on the middle of each corner, so a free block still reads as a square.
            cell.set('cap', 'butt')
            cell.set('dashOffset', (Math.PI / 4) * corner + period * 0.3)
            this.blocks.push(cell)
        })
        this.add(...this.rails, ...this.more, ...this.seats, ...this.blocks, ...this.captions, this.slotsCaption)
        for (const part of [this.doneTally, this.rejectedTally, this.poolCaption]) if (part) this.add(part)
        this.add(this.layer)

        // The first items take their places: a running one in the first free slot, and the others in their lines.
        for (const item of first) {
            const rec = this.make(item)
            if (item.running) {
                const slot = this.taken.findIndex((seat) => seat.owner === null)
                if (slot < 0) throw new Error(`requestQueue: ${shown(item.id)} is the item number ${this.recs.filter((other) => other.state === 'running').length + 1} that runs at the start, and the queue has ${slots} ${slots === 1 ? 'slot' : 'slots'}. Raise \`slots\`, or leave out \`running\``)
                const blocks = this.spare(rec.need, `requestQueue: the first items: ${shown(item.id)} runs at the start, and it`)
                Object.assign(this.taken[slot]!, { owner: rec, base: 0 })
                Object.assign(rec, { state: 'running', slot, x0: geo.seatX, y0: geo.seatY[slot]! })
                for (const block of blocks) Object.assign(this.cells[block]!, { owner: rec, base: rec.color })
                rec.held = blocks
                this.running.base += 1
                this.used.base += blocks.length
            } else {
                const row = this.rows[rec.line]!
                Object.assign(rec, { place: row.order.length, x0: this.placeX(row.order.length), y0: geo.lineY[rec.line]! })
                row.order.push(rec)
                row.waiting.base += 1
                if (rec.place! >= geo.places) row.hidden.base += 1
            }
        }
        this.wireAll()
        // The queue places its names, its counts and the texts of its items. The film check does not judge that room.
        ownLabels(this, { name: 'request queue' })
    }

    /** The ids of all items, in the order of arrival, after the changes that are scheduled so far. An item that left is still in the list. */
    get ids(): Id[] {
        return this.recs.map((rec) => rec.id)
    }

    /** The number of free slots, after the changes that are scheduled so far. */
    get freeSlots(): number {
        return this.taken.filter((seat) => seat.owner === null).length
    }

    /** The number of free blocks of the pool, after the changes that are scheduled so far. 0 for a queue with no pool. */
    get freeBlocks(): number {
        return this.cells.filter((cell) => cell.owner === null).length
    }

    /** What an item is and where, after the changes that are scheduled so far. */
    stateOf(id: Id): QueueItemState {
        return this.snapshot(this.rec(id, 'stateOf'))
    }

    /**
     * The ids of the items that a function picks, in the order of arrival, after the changes that are
     * scheduled so far: `queue.find((item) => item.state === 'waiting' && item.late)`.
     */
    find(test: (item: QueueItemState) => boolean): Id[] {
        if (typeof test !== 'function') throw new Error('requestQueue: find takes a function of an item, such as (item) => item.state === \'running\'')
        return this.recs.filter((rec) => test(this.snapshot(rec))).map((rec) => rec.id)
    }

    /**
     * The number of items in a state, after the changes that are scheduled so far: `queue.count('waiting')`.
     * With a line, the items of that line only.
     */
    count(state: QueueItemState['state'], line?: QueueLineRef): number {
        if (!['waiting', 'running', 'done', 'rejected'].includes(state)) throw new Error(`requestQueue: no state ${shown(state)}. The states are 'waiting', 'running', 'done' and 'rejected'`)
        const only = line === undefined ? null : this.lineOf(line, 'count')
        return this.recs.filter((rec) => rec.state === state && (only === null || rec.line === only)).length
    }

    /**
     * The items that `admit()` takes next, as ids: the head of the first line that has an item, then the next
     * one, up to `count` items. It does not look at the free slots: `queue.admit(queue.next(queue.freeSlots))` fills them.
     */
    next(count = 1): Id[] {
        if (!Number.isInteger(count) || count < 0) throw new Error(`requestQueue: next takes a count, a whole number, 0 or more. It got ${String(count)}`)
        return this.rows.flatMap((row) => row.order).slice(0, count).map((rec) => rec.id)
    }

    /** The node of an item: its box, its bar, its id and its numbers. It follows the item, so a connector to it does too. */
    item(id: Id): Node {
        return this.chips[this.rec(id, 'item').index]!
    }

    /**
     * A point of a part, in the coordinates of the object: the middle of a slot, of a place of a line, or of
     * a block, or the middle of one of its edges. A line to a server, or a note, starts there.
     * `queue.toWorld(...queue.p({ slot: 1 }, 'right'))` is the place on the stage.
     */
    p(part: QueuePart, edge: 'center' | 'left' | 'right' | 'top' | 'bottom' = 'center'): [number, number] {
        const [left, top, right, bottom] = this.partBox(part, 'p')
        if (edge === 'center') return [(left + right) / 2, (top + bottom) / 2]
        if (edge === 'left' || edge === 'right') return [edge === 'left' ? left : right, (top + bottom) / 2]
        if (edge === 'top' || edge === 'bottom') return [(left + right) / 2, edge === 'top' ? top : bottom]
        throw new Error(`requestQueue: p: the edge is 'center', 'left', 'right', 'top' or 'bottom', not ${shown(edge)}`)
    }

    /**
     * The box of a part, in stage pixels, for `place` and `beside` of the layout: the row of a line, one place
     * of it, a slot, all slots, a block, or the pool. Without a part, the whole object. The box is where the
     * object is now, so ask for it after the object has its place.
     */
    region(part?: QueuePart): Box {
        const [left, top, right, bottom] = part === undefined ? [this.geo.left, this.geo.top, this.geo.right, this.geo.bottom] : this.partBox(part, 'region')
        const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => this.toWorld(x!, y!))
        return new Box(
            Math.min(...corners.map(([x]) => x)), Math.min(...corners.map(([, y]) => y)),
            Math.max(...corners.map(([x]) => x)), Math.max(...corners.map(([, y]) => y)),
        )
    }

    /** A copy with its own items and its own bookkeeping, at rest in the state that the queue has now. */
    override clone(): this {
        const copy = super.clone()
        // A list with no node is not copied with the nodes, so the copy would add its items to the list of this queue.
        const lists = copy as unknown as Record<string, Node[]>, mine = this as unknown as Record<string, Node[]>
        for (const name of ['chips', 'outers', 'bodies', 'bars', 'numbers', 'unders']) if (lists[name] === mine[name]) lists[name] = []
        const twins = new Map<Rec, Rec>()
        const rest = (counter: Counter): Counter => ({ base: total(counter), steps: [] })
        copy.recs = this.recs.map((rec) => {
            const [x, y] = this.placeOf(rec, Infinity)
            const twin: Rec = {
                ...rec, held: [...rec.held], x0: x, y0: y, moves: [], born: null, gone: rec.gone ? OVER : null, done0: rec.done, runs: [],
                wait0: rec.wait, waits: [], clocked: rec.clocked === null ? null : -Infinity, quiet: rec.quiet ? OVER : null, marked: rec.marked ? OVER : null, busy: null,
            }
            twins.set(rec, twin)
            return twin
        })
        copy.byId = new Map(copy.recs.map((rec) => [String(rec.id), rec]))
        copy.rows = this.rows.map((row) => ({ ...row, order: row.order.map((rec) => twins.get(rec)!), lastArrive: null, lastShift: null, waiting: rest(row.waiting), hidden: rest(row.hidden) }))
        copy.taken = this.taken.map((seat) => ({ owner: seat.owner ? twins.get(seat.owner)! : null, leaving: null, base: seat.owner ? 0 : 1, changes: [] }))
        copy.cells = this.cells.map((cell) => ({ owner: cell.owner ? twins.get(cell.owner)! : null, base: cell.owner ? cell.owner.color : null, changes: [] }))
        copy.running = rest(this.running)
        copy.finished = rest(this.finished)
        copy.refused = rest(this.refused)
        copy.used = rest(this.used)
        copy.lastAdmit = null
        copy.latest = null
        copy.wireAll()
        return copy
    }

    /** The lines, the slots, the names and the pool arrive, and then the items that are there. */
    enter(options: AnimOptions = {}): Anim {
        timed('enter()', options)
        return {
            label: 'requestQueue.enter', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'enter()', false)
                reveal(this, t0, ctx.stage)
                const span = t1 - t0
                const fade = (node: Node, start: number, end: number) => {
                    stepAt(node, 'opacity', 0, t0)
                    node.tween('opacity', 1, start, end, ctx.ease)
                }
                for (const rail of this.rails) fade(rail, t0, t0 + span * 0.6)
                const windows = staggered(this.seats.length, Math.max(0, options.lag ?? 0.4), t0, t0 + span * 0.6)
                this.seats.forEach((seat, index) => fade(seat, windows[index]![0], windows[index]![1]))
                for (const part of [...this.captions, ...this.more, this.slotsCaption, this.doneTally, this.rejectedTally, this.poolCaption, ...this.blocks]) if (part) fade(part, t0 + span * 0.2, t0 + span * 0.7)
                fade(this.layer, t0 + span * 0.4, t1)
            },
        }
    }

    /**
     * Items arrive: each one takes the place at the end of its line. With a list, they arrive one after
     * another, and `lag` sets how much later each one starts, as a part of the time of one. An item that
     * arrives in a line with no free place is not drawn, and the three dots at the end of the line show.
     * An id that the queue has is an error.
     */
    arrive(items: QueueItem | readonly QueueItem[], options: AnimOptions = {}): Anim {
        // Find a wrong item now, where the film names it. The ids are checked again when the items arrive:
        // an `arrive` before this one in the same sequence may bring the same id.
        const given = this.checked(Array.isArray(items) ? items as readonly QueueItem[] : [items as QueueItem], 'arrive')
        for (const item of given) {
            if (item.running) throw new Error(`requestQueue: arrive: ${shown(item.id)} has \`running\`. An item arrives in a line. \`running\` is for an item of the first list, and \`admit\` moves an item to a slot`)
            this.fits(item.id, item.work)
        }
        const call = `arrive(${given.length === 1 ? shown(given[0]!.id) : `[${given.map((item) => shown(item.id)).join(', ')}]`})`
        timed(call, options)
        const lag = options.lag ?? 0.5
        return {
            label: 'requestQueue.arrive', duration: options.duration ?? (given.length === 0 ? 0 : 0.6 * (1 + (given.length - 1) * lag)), ease: options.ease,
            schedule: (ctx) => {
                if (given.length === 0) return
                const [t0, t1] = this.times(ctx, call)
                for (const item of given) {
                    if (this.byId.has(String(item.id))) throw new Error(`requestQueue: ${call}: the queue has an item with the id ${shown(item.id)}. Give each item its own id`)
                }
                reveal(this, t0, ctx.stage)
                const windows = staggered(given.length, lag, t0, t1)
                given.forEach((item, index) => {
                    const [start, end] = windows[index]!
                    const row = this.rows[item.line]!
                    const seg: Seg = { t0: start, t1: end, ease: forwardOnly(ctx.ease), leads: [] }
                    // An item that arrives never passes what moves in its line: the item before it, and a line that closes up.
                    for (const [lead, what] of [[row.lastArrive, 'an item that arrives before it'], [row.lastShift?.seg ?? null, row.lastShift?.call ?? '']] as const) {
                        if (!lead || lead.t1 <= start + SOON) continue
                        if (lead.t1 > end + SOON) throw new Error(`requestQueue: ${call}: ${shown(item.id)} is in its place at ${seconds(end)}, and ${what} moves in the line ${JSON.stringify(row.name)} until ${seconds(lead.t1)}. An item takes its place behind the items before it. Give this arrival a duration that ends at ${seconds(lead.t1)} or later, or play it after the other change, in a \`seq\``)
                        seg.leads.push(lead)
                    }
                    clock.now = start
                    const rec = this.make(item)
                    const place = row.order.length
                    // The item comes in from one place behind its own.
                    Object.assign(rec, { place, x0: this.placeX(place + 1), y0: this.geo.lineY[rec.line]!, born: seg, busy: { call, t1: end } })
                    rec.moves.push(slide(seg, this.geo.pitch, 0))
                    row.order.push(rec)
                    row.lastArrive = seg
                    // The count follows an item when the item is half there.
                    row.waiting.steps.push({ time: (start + end) / 2, delta: 1 })
                    if (place >= this.geo.places) row.hidden.steps.push({ time: (start + end) / 2, delta: 1 })
                    this.wire(rec, start)
                })
            },
        }
    }

    /**
     * The head of a line goes to a free slot, and its line closes up. Without an id, it is the head of the
     * first line that has an item. With a list, the items go one after another, in the order of the list.
     * An item takes the first free slot, and the blocks of the pool that it needs. A slot that an item leaves
     * in the same play is free for it: name the `finish` before the `admit`, and the new item comes in behind
     * the one that leaves. No free slot, no free blocks, and an item that is not the head of its line are errors.
     */
    admit(which?: Id | readonly Id[], options: AnimOptions = {}): Anim {
        const list = which === undefined ? null : Array.isArray(which) ? [...which as readonly Id[]] : [which as Id]
        for (const id of list ?? []) this.idOf(id, 'admit')
        if (list && new Set(list.map(String)).size !== list.length) throw new Error(`requestQueue: admit names an item two times: [${list.map(shown).join(', ')}]`)
        const call = `admit(${list === null ? '' : list.length === 1 ? shown(list[0]) : `[${list.map(shown).join(', ')}]`})`
        timed(call, options)
        return {
            label: 'requestQueue.admit', duration: options.duration ?? Math.max(1, list?.length ?? 1) * 0.9, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const ids = list ?? this.next(1)
                if (list === null && ids.length === 0) throw new Error(`requestQueue: ${call}: no item waits. \`arrive\` an item first. When an \`arrive\` in the same play brings it, name the \`arrive\` before this call`)
                if (ids.length === 0) return
                if (this.lastAdmit && t0 < this.lastAdmit.t1 - SOON) throw new Error(`requestQueue: ${call} starts at ${seconds(t0)}, and ${this.lastAdmit.call} ends at ${seconds(this.lastAdmit.t1)}. The slots take one item at a time, so that no two items cross. Give one \`admit\` all the items, as a list: they go one after another. Or play the two in a \`seq\``)
                reveal(this, t0, ctx.stage)
                const geo = this.geo, ease = forwardOnly(ctx.ease)
                // The items go one after another: each one has its own part of the time.
                const windows = staggered(ids.length, 1, t0, t1)
                ids.forEach((id, index) => {
                    const [start, end] = windows[index]!
                    const rec = this.rec(id, call, true)
                    if (rec.state !== 'waiting') throw new Error(`requestQueue: ${call}: ${shown(id)} is ${rec.state}. \`admit\` takes an item that waits`)
                    const row = this.rows[rec.line]!
                    if (row.order[0] !== rec) throw new Error(`requestQueue: ${call}: ${shown(id)} is at place ${rec.place} of the line ${JSON.stringify(row.name)}, behind ${shown(row.order[0]!.id)}. A line serves its head first. Admit ${shown(row.order[0]!.id)} first, or reject the items before ${shown(id)}. For an item that may pass others, give it a line of its own with \`lines\``)
                    this.claim(rec, call, start, end)
                    this.still(row, call, start)
                    const slot = this.taken.findIndex((seat) => seat.owner === null)
                    if (slot < 0) throw new Error(`requestQueue: ${call}: no slot is free for ${shown(id)}: ${this.slots} of ${this.slots} run. \`finish\` an item first. When a \`finish\` in the same play frees the slot, name the \`finish\` before the \`admit\``)
                    const blocks = this.spare(rec.need, `requestQueue: ${call}: ${shown(id)}`)
                    const seat = this.taken[slot]!
                    const seg: Seg = { t0: start, t1: end, ease, leads: [] }
                    const handoff = seat.leaving !== null && seat.leaving.t1 > start + SOON
                    if (seat.leaving && handoff) {
                        // The item comes in behind the one that leaves the slot, and is never nearer to the slot than that one is to its way out.
                        if (seat.leaving.t1 > end + SOON) throw new Error(`requestQueue: ${call}: ${shown(id)} is in slot ${slot} at ${seconds(end)}, and the item before it leaves that slot until ${seconds(seat.leaving.t1)}. Give the \`finish\` a duration that ends at ${seconds(end)} or sooner, or play the \`admit\` after it, in a \`seq\``)
                        seg.leads.push(seat.leaving)
                    }
                    const y = geo.lineY[rec.line]!, to = geo.seatY[slot]!
                    // Out of the line, across to the height of the slot, and into the slot. The item changes its height
                    // only in the room between the lines and the slots, so it meets no item of another line or slot.
                    rec.moves.push(route(seg, [[geo.headX, y], [geo.headX + geo.pitch, y], [geo.seatX - geo.pitch, to], [geo.seatX, to]]))
                    // The outline of the slot goes while the item comes into it, on the last piece of its way. In a
                    // slot that an item leaves in the same play, the outline does not come back between the two.
                    const across = Math.hypot(geo.seatX - geo.headX - 2 * geo.pitch, to - y)
                    if (handoff) seat.changes.pop()
                    else seat.changes.push({ seg, to: 0, after: 1 - geo.pitch / (2 * geo.pitch + across) })
                    Object.assign(rec, { state: 'running', place: null, slot, quiet: seg })
                    seat.owner = rec
                    seat.leaving = null
                    const before = row.order.length
                    row.order.shift()
                    row.order.forEach((other, place) => {
                        other.place = place
                        other.moves.push(slide(seg, geo.pitch, 0))
                    })
                    row.lastShift = { seg, call }
                    const middle = (start + end) / 2
                    row.waiting.steps.push({ time: middle, delta: -1 })
                    this.running.steps.push({ time: middle, delta: 1 })
                    if (before > geo.places) row.hidden.steps.push({ time: middle, delta: -1 })
                    // The blocks fill as the item comes into its slot.
                    this.change(blocks, rec, start + (end - start) * 0.6, end, ease)
                    this.lastAdmit = { call, t1: end }
                })
            },
        }
    }

    /**
     * The items in the slots work for a number of units: the bar of each one grows, and its number of units
     * that are left counts down. An item with no `work` does not change. An item never does more than its work.
     */
    run(units = 1, options: AnimOptions = {}): Anim {
        if (!Number.isInteger(units) || units < 1) throw new Error(`requestQueue: run takes the units of work, a whole number, 1 or more. It got ${String(units)}`)
        timed(`run(${units})`, options)
        return {
            // Work goes at one speed, so the bar and the number run with no ease unless the film gives one.
            label: 'requestQueue.run', duration: options.duration ?? 0.8, ease: options.ease ?? linear,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, `run(${units})`)
                reveal(this, t0, ctx.stage)
                const seg: Seg = { t0, t1, ease: forwardOnly(ctx.ease), leads: [] }
                for (const rec of this.recs) {
                    if (rec.state !== 'running' || rec.work === undefined) continue
                    const step = Math.min(units, rec.work - rec.done)
                    if (step <= 0) continue
                    rec.runs.push({ seg, units: step })
                    rec.done += step
                }
            },
        }
    }

    /**
     * Items leave their slots: each one goes out at the right and fades, its slot is free, and its blocks go
     * back to the pool. Without an argument, every item in a slot that has no work left. `which` is an id, a
     * list of ids, or a function of an item. An item that has work left is an error: `run` it first.
     */
    finish(which?: QueueWhich, options: AnimOptions = {}): Anim {
        const pick = this.picker(which, 'finish')
        const call = `finish(${this.said(which)})`
        timed(call, options)
        return {
            label: 'requestQueue.finish', duration: options.duration ?? 0.7, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const inSlots = this.taken.flatMap((seat) => (seat.owner ? [seat.owner] : []))
                const chosen = which === undefined ? inSlots.filter((rec) => rec.work !== undefined && rec.done >= rec.work) : pick(inSlots, call, 'running')
                if (which === undefined && chosen.length === 0) throw new Error(`requestQueue: ${call}: no item in a slot has done its work. \`run\` first, or name the item: finish('R1')`)
                for (const rec of chosen) {
                    if (rec.work !== undefined && rec.done < rec.work) throw new Error(`requestQueue: ${call}: ${shown(rec.id)} has ${rec.work - rec.done} of ${rec.work} units of work left. Call run(${rec.work - rec.done}) first. For an item with no bar, leave out \`work\``)
                }
                if (chosen.length === 0) return
                reveal(this, t0, ctx.stage)
                const windows = staggered(chosen.length, Math.max(0, options.lag ?? 0), t0, t1)
                chosen.forEach((rec, index) => {
                    const [start, end] = windows[index]!
                    this.claim(rec, call, start, end)
                    const seg: Seg = { t0: start, t1: end, ease: forwardOnly(ctx.ease), leads: [] }
                    const seat = this.taken[rec.slot!]!
                    rec.moves.push(slide(seg, this.geo.pitch, 0))
                    seat.owner = null
                    seat.leaving = seg
                    // The outline comes back when the id of the item is clear of it: a line of dashes through a text that fades reads badly.
                    seat.changes.push({ seg, to: 1, after: Math.max(0.85, Math.min(0.98, (this.geo.w - this.size * PAD) / this.geo.pitch + 0.02)) })
                    const blocks = rec.held
                    Object.assign(rec, { state: 'done', slot: null, gone: seg, hold: LEAVES, held: [] })
                    const middle = (start + end) / 2
                    this.running.steps.push({ time: middle, delta: -1 })
                    this.finished.steps.push({ time: middle, delta: 1 })
                    this.change(blocks, null, start, end, seg.ease)
                })
            },
        }
    }

    /**
     * Waiting items leave with a status, such as '503', '429' or 'timeout': each one gets dashes, a cross and
     * the status under it, then it fades, and its line closes up. `which` is an id, a list of ids, or a
     * function of an item, such as `(item) => item.late`. Only an item that waits can be rejected.
     */
    reject(which: QueueWhich, status: string, options: AnimOptions = {}): Anim {
        if (which === undefined) throw new Error('requestQueue: reject takes the items and a status: reject(\'R7\', \'503\')')
        const pick = this.picker(which, 'reject')
        const word = oneLine('the status of reject', status)
        const wide = advanceWidth(word, this.small, { font: this.font, weight: 600 }) + this.small * CROSS
        if (wide > this.under()) throw new Error(`requestQueue: the status ${JSON.stringify(word)} is ${Math.ceil(wide)} px wide with its cross, and the room under an item is ${Math.floor(this.under())} px. Use a shorter status, or an \`itemWidth\` of ${Math.ceil(wide + this.itemWidth - this.under())} or more`)
        const call = `reject(${this.said(which)}, ${JSON.stringify(word)})`
        timed(call, options)
        return {
            label: 'requestQueue.reject', duration: options.duration ?? 1.4, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const chosen = pick(this.rows.flatMap((row) => row.order), call, 'waiting')
                if (chosen.length === 0) return
                reveal(this, t0, ctx.stage)
                const span = t1 - t0, ease = forwardOnly(ctx.ease)
                const mark: Seg = { t0, t1: t0 + span * MARKED, ease, leads: [] }
                const fade: Seg = { t0: t0 + span * FADES, t1: t0 + span * CLOSES, ease, leads: [] }
                // The line closes up when the item is gone, so no item moves into a place that still shows another.
                const close: Seg = { t0: t0 + span * CLOSES, t1, ease, leads: [] }
                for (const rec of chosen) {
                    this.claim(rec, call, t0, t1)
                    Object.assign(rec, { state: 'rejected', place: null, status: word, marked: mark, gone: fade })
                    this.refused.steps.push({ time: (fade.t0 + fade.t1) / 2, delta: 1 })
                }
                for (const row of this.rows) {
                    const before = row.order.length
                    const stays = row.order.filter((rec) => rec.state === 'waiting')
                    if (stays.length === before) continue
                    this.still(row, call, t0)
                    row.order = stays
                    stays.forEach((rec, place) => {
                        if (rec.place !== place) rec.moves.push(slide(close, (rec.place! - place) * this.geo.pitch, 0))
                        rec.place = place
                    })
                    row.lastShift = { seg: close, call }
                    row.waiting.steps.push({ time: (fade.t0 + fade.t1) / 2, delta: stays.length - before })
                    const hidden = Math.max(0, stays.length - this.geo.places) - Math.max(0, before - this.geo.places)
                    if (hidden !== 0) row.hidden.steps.push({ time: (close.t0 + close.t1) / 2, delta: hidden })
                }
            },
        }
    }

    /**
     * The wait of waiting items runs to a value, as a number under each item. The value is in the unit of the
     * film, and `format` writes it. At the `deadline` of the queue the number turns red and the border of the
     * item gets dashes: `queue.stateOf(id).late` is then true. A wait does not go back.
     */
    wait(which: QueueWhich, to: number, options: AnimOptions = {}): Anim {
        if (which === undefined) throw new Error('requestQueue: wait takes the items and a value: wait(\'R7\', 250)')
        const pick = this.picker(which, 'wait')
        if (!(Number.isFinite(to) && to >= 0)) throw new Error(`requestQueue: wait takes the wait to reach, a number, 0 or more. It got ${String(to)}`)
        const words = this.format(to)
        if (typeof words !== 'string') throw new Error(`requestQueue: format returned ${String(words)} for the wait ${to}. It returns a text`)
        const wide = advanceWidth(oneLine(`the text of the wait ${to}`, words), this.small, { font: this.font, weight: 600 })
        if (wide > this.under()) throw new Error(`requestQueue: the wait ${JSON.stringify(words)} is ${Math.ceil(wide)} px wide, and the room under an item is ${Math.floor(this.under())} px. Give a shorter \`format\`, or an \`itemWidth\` of ${Math.ceil(wide + this.itemWidth - this.under())} or more`)
        const call = `wait(${this.said(which)}, ${to})`
        timed(call, options)
        return {
            // A clock runs at one speed, so the number runs with no ease unless the film gives one.
            label: 'requestQueue.wait', duration: options.duration ?? 1.2, ease: options.ease ?? linear,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const chosen = pick(this.rows.flatMap((row) => row.order), call, 'waiting')
                if (chosen.length === 0) return
                reveal(this, t0, ctx.stage)
                const seg: Seg = { t0, t1, ease: forwardOnly(ctx.ease), leads: [] }
                for (const rec of chosen) {
                    if (to < rec.wait) throw new Error(`requestQueue: ${call}: the wait of ${shown(rec.id)} is ${rec.wait}, and a wait does not go back. Give a value of ${rec.wait} or more`)
                    rec.waits.push({ seg, delta: to - rec.wait })
                    rec.wait = to
                    rec.clocked = Math.min(rec.clocked ?? Infinity, t0)
                }
            },
        }
    }

    /**
     * An item in a slot takes more blocks of the pool, as a request whose cache grows with each token. The
     * blocks are the first free ones, so a block that another item gave back is used again. Blocks that the
     * pool does not have are an error.
     */
    take(id: Id, blocks = 1, options: AnimOptions = {}): Anim {
        this.idOf(id, 'take')
        if (!Number.isInteger(blocks) || blocks < 1) throw new Error(`requestQueue: take takes a number of blocks, a whole number, 1 or more. It got ${String(blocks)}`)
        if (this.cells.length === 0) throw new Error('requestQueue: take: the queue has no pool. Give it one: requestQueue(items, { pool: 16 })')
        const call = `take(${shown(id)}, ${blocks})`
        timed(call, options)
        return {
            label: 'requestQueue.take', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const rec = this.rec(id, call, true)
                if (rec.state !== 'running') throw new Error(`requestQueue: ${call}: ${shown(id)} is ${rec.state}. An item holds blocks while it is in a slot: \`admit\` it first`)
                const taken = this.spare(blocks, `requestQueue: ${call}: ${shown(id)}`)
                reveal(this, t0, ctx.stage)
                this.change(taken, rec, t0, t1, forwardOnly(ctx.ease))
            },
        }
    }

    /** The x of the middle of a place of a line. Place 0 is the head, next to the slots. */
    private placeX(place: number): number {
        return this.geo.headX - place * this.geo.pitch
    }

    private blockAt(index: number): [number, number] {
        const geo = this.geo
        return [geo.poolLeft + geo.cell / 2 + (index % geo.columns) * geo.cellPitch, geo.poolTop + geo.nameRow + geo.cell / 2 + Math.floor(index / geo.columns) * geo.cellPitch]
    }

    /** The room of a text under an item: the item and the gap at its two sides, less a little room to the text under the next item. */
    private under(): number {
        return this.geo.pitch - this.small * 0.3
    }

    private radius(): number {
        return Math.min(this.geo.h * 0.24, this.size * 0.4)
    }

    private dashes(): readonly number[] {
        return [this.size * 0.3, this.size * 0.22]
    }

    /** The width of the texts of an item: its id, and the room and the number of its work. */
    private inner(id: Id, work: number | undefined): number {
        const name = advanceWidth(String(id), this.size, { font: this.idFont, weight: 600 })
        return work === undefined ? name : name + this.size * 0.45 + advanceWidth(String(work), this.small, { font: this.font })
    }

    /** The text size of an id that fits its item. An id that is too wide is set smaller, and one that is still too wide is an error. */
    private fits(id: Id, work: number | undefined): number {
        const room = this.itemWidth - this.size * PAD * 2
        const name = advanceWidth(String(id), this.size, { font: this.idFont, weight: 600 })
        const rest = this.inner(id, work) - name
        if (name + rest <= room) return this.size
        const scale = (room - rest) / name
        if (scale >= FLOOR) return this.size * scale
        throw new Error(`requestQueue: the id ${shown(id)} is ${Math.ceil(name)} px wide at size ${this.size}, and an item is ${Math.floor(this.itemWidth)} px wide, with ${Math.max(0, Math.floor(room - rest))} px for its id. An id can be ${FLOOR} of the size at the least. Use a shorter id, or an \`itemWidth\` of ${Math.ceil(name * FLOOR + rest + this.size * PAD * 2)} or more`)
    }

    /** The sizes and the places that follow from the width, the lines, the slots and the pool. */
    private measure(width: number, lines: number, pool: { blocks: number; columns: number } | null): Geometry {
        const size = this.size, small = this.small, w = this.itemWidth, slots = this.slots
        const h = Math.round(size * HEIGHT), gap = Math.round(size * GAP), pitch = w + gap
        const nameRow = Math.round(small * 1.6), waitRow = Math.round(small * 1.5)
        // From one line to the next: the name over the items, the items, the waits under them, and a little room.
        const linePitch = nameRow + h + waitRow + Math.round(size * 0.3)
        // With two lines or more, two slots are as far apart as half of two lines. So a line is at the height of
        // a slot, or in the middle between two slots, and never a few pixels off one.
        const seatPitch = lines > 1 ? linePitch / 2 : h + Math.round(size * 0.5)
        const cell = Math.round(size * 1.4), cellPitch = cell + Math.max(3, Math.round(cell * 0.18))
        const columns = pool?.columns ?? 0
        const wide = (words: string) => advanceWidth(words, small, { font: this.font })
        const digits = (count: number) => '8'.repeat(String(count).length)
        // The part at the right, from the left edge of the slots: an item and the way out of a slot, or the widest text or the pool.
        const rightTexts = [
            this.showCounts ? `${this.words.slots} ${digits(slots)} / ${digits(slots)}` : this.words.slots,
            this.doneTallyWords(888),
            pool ? (this.showCounts ? `${this.words.pool} ${digits(pool.blocks)} / ${digits(pool.blocks)}` : this.words.pool) : '',
        ]
        const right = Math.max(w + pitch, ...rightTexts.map(wide), pool ? columns * cellPitch - (cellPitch - cell) : 0)
        // From the left: the room where an item arrives, the places, and the room between the lines and the slots.
        // An item goes out of its line by one place, across, and into its slot by one place.
        const across = Math.round(w * 0.5)
        const fixed = w + gap + across + right
        const places = Math.floor((width - fixed) / pitch) - 1
        if (places < 1) {
            throw new Error(`requestQueue: a width of ${width} has no room for a place in the lines: the slots, the way to them and one place take ${Math.ceil(fixed + 2 * pitch)} px. Give a width of ${Math.ceil(fixed + 2 * pitch)} or more, a smaller \`itemWidth\`, or a smaller \`size\``)
        }
        const left = -width / 2
        const seatX = left + width - right + w / 2
        // The room that the places do not take is at the far end of the lines, so the object is `width` wide
        // and the way from a line to a slot is short.
        const headX = seatX - 2 * pitch - across
        const lineRoom = headX + w / 2 - left
        const texts = [...this.rows.map((row) => (this.showCounts ? `${row.name} 888` : row.name)), this.rejectedTallyWords(888)]
        const widest = texts.reduce((most, words) => (wide(words) > wide(most) ? words : most), '')
        if (wide(widest) > lineRoom) throw new Error(`requestQueue: the text ${JSON.stringify(widest)} is ${Math.ceil(wide(widest))} px wide, and the lines are ${Math.floor(lineRoom)} px wide. Use a shorter name, or a width of ${Math.ceil(width + wide(widest) - lineRoom)} or more`)

        const lineY = Array.from({ length: lines }, (_, index) => (index - (lines - 1) / 2) * linePitch)
        const seatY = Array.from({ length: slots }, (_, index) => (index - (slots - 1) / 2) * seatPitch)
        const tally = (word: string | null) => (word !== null && this.showCounts ? nameRow : 0)
        const top = Math.min(lineY[0]!, seatY[0]!) - h / 2 - nameRow
        const underSlots = seatY[slots - 1]! + h / 2 + tally(this.words.done)
        const poolTop = underSlots + (pool ? Math.round(size * 0.3) : 0)
        const poolBottom = pool ? poolTop + nameRow + Math.ceil(pool.blocks / columns) * cellPitch - (cellPitch - cell) : underSlots
        const bottom = Math.max(lineY[lines - 1]! + h / 2 + waitRow + tally(this.words.rejected), poolBottom)
        // The middle of the object is at 0, 0.
        const lift = (top + bottom) / 2
        return {
            w, h, gap, pitch, seatPitch, places, left, right: left + width, top: top - lift, bottom: bottom - lift,
            headX, entryX: headX - places * pitch, seatX, lineY: lineY.map((y) => y - lift), seatY: seatY.map((y) => y - lift),
            nameRow, waitRow, cell, cellPitch, columns, poolLeft: seatX - w / 2, poolTop: poolTop - lift,
        }
    }

    private doneTallyWords(count: number): string {
        return this.words.done !== null && this.showCounts ? `${this.words.done} ${count}` : ''
    }

    private rejectedTallyWords(count: number): string {
        return this.words.rejected !== null && this.showCounts ? `${this.words.rejected} ${count}` : ''
    }

    /** The items of a call, with each value checked. The line of an item is its index from here on. */
    private checked(items: readonly QueueItem[], call: string): (Omit<QueueItem, 'line'> & { line: number; paint: Paint | null })[] {
        const seen = new Set<string>()
        return items.map((item, index) => {
            if (typeof item !== 'object' || item === null) throw new Error(`${at(call)}: item ${index} is ${item === null ? 'null' : typeof item}. An item is an object with an id, such as { id: 'R1', work: 4 }`)
            const id = this.idOf(item.id, call)
            if (seen.has(String(id))) throw new Error(`${at(call)}: two items have the id ${shown(id)}. Give each item its own id`)
            seen.add(String(id))
            if (item.work !== undefined && (!Number.isInteger(item.work) || item.work < 1)) throw new Error(`${at(call)}: the work of ${shown(id)} is ${String(item.work)}. It is a number of units, a whole number, 1 or more`)
            if (item.blocks !== undefined && (!Number.isInteger(item.blocks) || item.blocks < 0)) throw new Error(`${at(call)}: the blocks of ${shown(id)} are ${String(item.blocks)}. Give a whole number, 0 or more`)
            if (item.blocks && this.cells.length === 0) throw new Error(`${at(call)}: ${shown(id)} has blocks, and the queue has no pool. Give it one: requestQueue(items, { pool: 16 })`)
            if (item.blocks && item.blocks > this.cells.length) throw new Error(`${at(call)}: ${shown(id)} needs ${item.blocks} blocks, and the pool has ${this.cells.length}. Raise \`pool\`, or lower the blocks of the item`)
            return { ...item, id, line: item.line === undefined ? 0 : this.lineOf(item.line, call), paint: item.color === undefined ? null : paintOf(item.color, `the color of ${shown(id)}`) }
        })
    }

    /** An id is a text or a number. The queue knows an id by its text, so 7 and '7' are one id. */
    private idOf(id: unknown, call: string): Id {
        if ((typeof id === 'string' && id.trim() !== '' && !/[\n\r\t]/.test(id)) || (typeof id === 'number' && Number.isFinite(id))) return id
        throw new Error(`${at(call)}: an id is ${shown(id)}. An id is a text of one line or a number, such as 'R1'`)
    }

    private lineOf(line: QueueLineRef, call: string): number {
        const index = typeof line === 'number' ? (Number.isInteger(line) && line >= 0 && line < this.rows.length ? line : -1) : this.rows.findIndex((row) => row.name === line)
        if (index < 0) throw new Error(`${at(call)}: no line ${shown(line)}. The lines are ${this.rows.map((row, at) => `${at} (${JSON.stringify(row.name)})`).join(', ')}`)
        return index
    }

    /**
     * The record of an id. `played` is for a call that the film plays: the queue takes the calls of one play in
     * their order, so an `arrive` that brings the item must come before the call that names it.
     */
    private rec(id: Id, call: string, played = false): Rec {
        const rec = this.byId.get(String(this.idOf(id, call)))
        if (rec) return rec
        const known = this.recs.length === 0 ? 'The queue has no item' : `The queue has ${this.recs.length <= 8 ? this.recs.map((other) => shown(other.id)).join(', ') : `${this.recs.length} items, from ${shown(this.recs[0]!.id)} to ${shown(this.recs[this.recs.length - 1]!.id)}`}`
        throw new Error(`requestQueue: ${call}: no item has the id ${shown(id)}. ${known}${played ? '. When an `arrive` in the same play brings the item, name the `arrive` before this call: the queue takes the calls of a play in their order' : ''}`)
    }

    private snapshot(rec: Rec): QueueItemState {
        return {
            id: rec.id, state: rec.state, line: rec.line, place: rec.place, slot: rec.slot, work: rec.work, left: rec.work === undefined ? undefined : rec.work - rec.done,
            blocks: rec.state === 'running' ? rec.held.length : rec.state === 'waiting' ? rec.need : 0, wait: rec.wait, late: this.deadline !== undefined && rec.wait >= this.deadline, status: rec.status,
        }
    }

    /** How a call names its items, for a message. */
    private said(which: QueueWhich | undefined): string {
        return which === undefined ? '' : typeof which === 'function' ? 'a function' : Array.isArray(which) ? `[${(which as readonly Id[]).map(shown).join(', ')}]` : shown(which)
    }

    /**
     * The items of a call, from the items in a state. Ids are checked when the film makes the call, and looked
     * up when the change is scheduled. A function picks among the items in the state, and an id of an item
     * that is in another state is an error.
     */
    private picker(which: QueueWhich | undefined, call: string): (among: readonly Rec[], said: string, state: Rec['state']) => Rec[] {
        if (which === undefined || typeof which === 'function') return (among) => (typeof which === 'function' ? among.filter((rec) => which(this.snapshot(rec))) : [])
        const ids = Array.isArray(which) ? [...which as readonly Id[]] : [which as Id]
        for (const id of ids) this.idOf(id, call)
        if (new Set(ids.map(String)).size !== ids.length) throw new Error(`requestQueue: ${call} names an item two times: [${ids.map(shown).join(', ')}]`)
        return (among, said, state) => ids.map((id) => {
            const rec = this.rec(id, said, true)
            if (rec.state !== state || !among.includes(rec)) throw new Error(`requestQueue: ${said}: ${shown(id)} is ${rec.state}. This call takes an item that is ${state}${state === 'waiting' && rec.state === 'running' ? ': an item in a slot leaves with `finish`' : ''}`)
            return rec
        })
    }

    /**
     * The times of an animation. A time that is not a number would write keys that no frame finds. A change
     * of the state starts from the state that the changes before it left, so the film calls the changes in
     * the order of their times: a change that starts before one that the film called earlier is an error.
     */
    private times(ctx: AnimContext, call: string, change = true): [number, number] {
        if (!(Number.isFinite(ctx.t0) && Number.isFinite(ctx.t1) && ctx.t1 >= ctx.t0)) throw new Error(`requestQueue: ${call} plays from ${String(ctx.t0)} to ${String(ctx.t1)}. Give the play a duration that is a number, 0 or more`)
        if (!change) return [ctx.t0, ctx.t1]
        if (this.latest && ctx.t0 < this.latest.t0 - SOON) throw new Error(`requestQueue: ${call} starts at ${seconds(ctx.t0)}, and the film called ${this.latest.call} before it, which starts at ${seconds(this.latest.t0)}. The queue takes its changes in the order of time: each one starts from the state that the one before it left. Call ${call} before ${this.latest.call}`)
        this.latest = { call, t0: ctx.t0 }
        return [ctx.t0, ctx.t1]
    }

    /** An item changes its state one change at a time: it arrives, then it goes to a slot, then it leaves. */
    private claim(rec: Rec, call: string, t0: number, t1: number): void {
        if (rec.busy && t0 < rec.busy.t1 - SOON) throw new Error(`requestQueue: ${call} starts at ${seconds(t0)}, and ${rec.busy.call} moves ${shown(rec.id)} until ${seconds(rec.busy.t1)}. An item takes one change at a time. Play the two in a \`seq\`, or give the first one a shorter duration`)
        rec.busy = { call, t1 }
    }

    /** A line closes up one change at a time: each change starts from the places that the change before it left. */
    private still(row: Row, call: string, t0: number): void {
        const last = row.lastShift
        if (last && t0 < last.seg.t1 - SOON) throw new Error(`requestQueue: ${call} starts at ${seconds(t0)}, and the line ${JSON.stringify(row.name)} closes up after ${last.call} until ${seconds(last.seg.t1)}. A line takes one change of its order at a time. Play the two in a \`seq\`, or give one call all the items`)
    }

    /** The first free blocks, by index. Fewer free blocks than an item needs is an error that says what to do. */
    private spare(count: number, who: string): number[] {
        if (count === 0) return []
        const free = this.cells.flatMap((cell, index) => (cell.owner === null ? [index] : []))
        if (free.length < count) {
            const advice = count > this.cells.length || who.startsWith('requestQueue: the first items') ? 'Raise `pool`, or lower the blocks of the items' : '`finish` an item first, to get its blocks back. When a `finish` in the same play frees them, name the `finish` before this call'
            throw new Error(`${who} needs ${count} ${count === 1 ? 'block' : 'blocks'}, and the pool has ${free.length} free of ${this.cells.length}. ${advice}`)
        }
        return free.slice(0, count)
    }

    /** Blocks go to an owner, or back to the pool with null, one after another. The count follows each block when it is half way. */
    private change(blocks: readonly number[], owner: Rec | null, t0: number, t1: number, ease: Ease): void {
        if (blocks.length === 0) return
        const windows = staggered(blocks.length, Math.min(1, 1.5 / Math.max(1, blocks.length - 1)), t0, t1)
        blocks.forEach((block, index) => {
            const cell = this.cells[block]!
            cell.owner = owner
            cell.changes.push({ seg: { t0: windows[index]![0], t1: windows[index]![1], ease, leads: [] }, paint: owner ? owner.color : null })
            this.used.steps.push({ time: (windows[index]![0] + windows[index]![1]) / 2, delta: owner ? 1 : -1 })
        })
        if (owner) owner.held.push(...blocks)
    }

    /** The record and the nodes of a new item. The caller gives it its place. */
    private make(item: Omit<QueueItem, 'line'> & { line: number; paint: Paint | null }): Rec {
        const geo = this.geo, size = this.size, row = this.rows[item.line]!
        const color = item.paint ?? row.color
        const rec: Rec = {
            id: item.id, index: this.recs.length, color, line: item.line, state: 'waiting', place: null, slot: null, work: item.work, done: 0, need: item.blocks ?? 0, held: [],
            wait: 0, status: undefined, x0: 0, y0: 0, moves: [], born: null, gone: null, hold: 0, done0: 0, runs: [], wait0: 0, waits: [], clocked: null, quiet: null, marked: null, busy: null,
        }
        const stroke = Math.max(2, size * 0.085)
        const body = new Node(rectPath(-geo.w / 2, -geo.h / 2, geo.w, geo.h, this.radius())).fill('surface').stroke(color, stroke)
        body.set('cap', 'butt')
        const bar = new Node([]).fill(color, BAR)
        const pad = size * PAD
        // An id with a number of work starts at the left, and the number ends at the right. An id alone is in the middle.
        const name = text(String(item.id), { size: this.fits(item.id, item.work), font: this.idFont, weight: 600, color: 'ink', anchor: item.work === undefined ? 'center' : 'left' }).at(item.work === undefined ? 0 : -geo.w / 2 + pad, 0)
        const number = new Node().at(geo.w / 2 - pad, 0)
        const under = new Node().at(0, geo.h / 2 + geo.waitRow / 2)
        const chip = new Node().add(body, bar, name, number, under)
        const outer = new Node().add(chip)
        this.recs.push(rec)
        this.byId.set(String(rec.id), rec)
        this.outers.push(outer)
        this.chips.push(chip)
        this.bodies.push(body)
        this.bars.push(bar)
        this.numbers.push(number)
        this.unders.push(under)
        // The texts of an item that arrives later are labels of the queue too.
        ownLabels(this, { labels: [name, number, under] })
        this.layer.add(outer)
        return rec
    }

    /** Where an item is at a time: its place before its moves, and each move as far as it is. */
    private placeOf(rec: Rec, time: number): [number, number] {
        let x = rec.x0, y = rec.y0
        for (const move of rec.moves) {
            const share = progress(move.seg, time)
            if (share <= 0) continue
            const [dx, dy] = share >= 1 ? move.total : move.at(share)
            x += dx
            y += dy
        }
        return [x, y]
    }

    /**
     * How much of an item shows at a time. It arrives, it leaves, and in a line with more items than places
     * it shows only in a place: an item fades in on the second half of its way into the last place, when it is
     * clear of the three dots.
     */
    private showsAt(rec: Rec, time: number): number {
        const [x] = this.placeOf(rec, time), half = this.geo.pitch / 2
        // An item is all there at the middle of its way in, so the line of its waiting line does not show through it for long.
        const arrives = rec.born ? clamp(progress(rec.born, time) * 2) : 1
        const leaves = rec.gone ? 1 - clamp((progress(rec.gone, time) - rec.hold) / (1 - rec.hold)) : 1
        return arrives * leaves * clamp((x - this.geo.entryX - half) / half)
    }

    private waitAt(rec: Rec, time: number): number {
        return rec.waits.reduce((sum, wait) => sum + wait.delta * progress(wait.seg, time), rec.wait0)
    }

    private doneAt(rec: Rec, time: number): number {
        return rec.runs.reduce((sum, run) => sum + run.units * progress(run.seg, time), rec.done0)
    }

    /** An item is late while it waits with a wait at the deadline or past it. In a slot, it is served. */
    private lateAt(rec: Rec, time: number): boolean {
        return this.deadline !== undefined && this.waitAt(rec, time) >= this.deadline - SOON && !(rec.quiet && progress(rec.quiet, time) > 0)
    }

    /** The border of an item at a time: its color, or red with dashes for an item that is late or rejected. */
    private edgeAt(rec: Rec, time: number): { paint: Paint; dash: readonly number[] | null } {
        const late = this.lateAt(rec, time), share = rec.marked ? progress(rec.marked, time) : 0
        const from = late ? this.red : rec.color
        // Dashes cannot fade to a line, so they switch when the color is half way.
        return { paint: share >= 1 ? this.red : share > 0 ? mixPaint(from, this.red, share) : from, dash: late || share >= 0.5 ? this.dashes() : null }
    }

    /** The bar of an item at a time: the part of its work that is done, from the left. Its right end is flat until the work is done. */
    private barAt(rec: Rec, time: number): Path {
        if (rec.work === undefined) return []
        const geo = this.geo, part = clamp(this.doneAt(rec, time) / rec.work)
        if (part <= 0) return []
        const left = -geo.w / 2, top = -geo.h / 2, radius = this.radius()
        if (part >= 1) return rectPath(left, top, geo.w, geo.h, radius)
        const right = left + geo.w * part, r = Math.min(radius, right - left), bottom = top + geo.h
        return parseSvgPath(`M${left + r} ${top}L${right} ${top}L${right} ${bottom}L${left + r} ${bottom}Q${left} ${bottom} ${left} ${bottom - r}L${left} ${top + r}Q${left} ${top} ${left + r} ${top}Z`)
    }

    /** Put the keys and the drawings of every part that follows the bookkeeping. A copy does it again, for its own records. */
    private wireAll(): void {
        this.recs.forEach((rec) => this.wire(rec, 0))
        const words = (name: string, counter: () => Counter, of?: number) => (time: number) => (this.showCounts ? `${name} ${countAt(counter(), time)}${of === undefined ? '' : ` / ${of}`}` : name)
        this.captions.forEach((caption, index) => this.write(caption, words(this.rows[index]!.name, () => this.rows[index]!.waiting), { anchor: 'right' }))
        this.write(this.slotsCaption, words(this.words.slots, () => this.running, this.slots), { anchor: 'left' })
        // A count of 0 draws nothing: the word shows with the first item that it counts.
        if (this.doneTally) this.write(this.doneTally, (time) => (countAt(this.finished, time) > 0 ? `${this.words.done} ${countAt(this.finished, time)}` : null), { anchor: 'left' })
        if (this.rejectedTally) this.write(this.rejectedTally, (time) => (countAt(this.refused, time) > 0 ? `${this.words.rejected} ${countAt(this.refused, time)}` : null), { anchor: 'right', color: 'red' })
        if (this.poolCaption) this.write(this.poolCaption, words(this.words.pool, () => this.used, this.cells.length), { anchor: 'left' })
        this.rails.forEach((rail, index) => (rail.draw = (time) => this.railAt(index, time)))
        this.more.forEach((dots, index) => dots.children[0]!.track('opacity').add(always((time) => (countAt(this.rows[index]!.hidden, time) > 0 ? 1 : 0), 0)))
        this.seats.forEach((seat, index) => seat.children[0]!.track('opacity').add(always((time) => this.seatAt(index, time), 0)))
        this.blocks.forEach((cell, index) => {
            const look = (time: number) => this.blockLook(index, time)
            cell.track('fill').add(always((time) => look(time).paint, 0))
            cell.track('stroke').add(always((time) => look(time).paint, 0))
            cell.track('fillOpacity').add(always((time) => look(time).fill, 0))
            cell.track('dash').add(always((time) => (look(time).free ? this.cellDashes : null), 0))
        })
    }

    /**
     * The line of a waiting line at a time: from the far end to an arrow head at the side of the slots, where
     * the items go. It has a gap under each item, so it does not show through an item that fades.
     */
    private railAt(index: number, time: number): Node {
        const geo = this.geo, y = geo.lineY[index]!, reach = this.small * 0.3
        const tip = geo.headX + geo.w / 2 + geo.gap + reach
        const covered: [number, number][] = []
        for (const rec of this.recs) {
            if (this.showsAt(rec, time) <= 0) continue
            const [x, at] = this.placeOf(rec, time)
            if (Math.abs(at - y) < geo.h / 2) covered.push([Math.max(geo.entryX, x) - geo.w / 2, Math.max(geo.entryX, x) + geo.w / 2])
        }
        covered.sort((a, b) => a[0] - b[0])
        const path: Path[number][] = [...polyPath([[tip - reach, y - reach], [tip, y], [tip - reach, y + reach]])]
        let from = geo.left
        for (const [start, end] of [...covered, [tip, tip] as [number, number]]) {
            if (start > from + 1) path.push(...line([from, y], [Math.min(start, tip), y]).get('path')!)
            from = Math.max(from, end)
            if (from >= tip) break
        }
        return new Node(path).stroke('gridStrong', Math.max(2, this.size * 0.075))
    }

    /** How much of the outline of a slot shows at a time. */
    private seatAt(index: number, time: number): number {
        const seat = this.taken[index]!
        let shows = seat.base
        for (const change of seat.changes) shows += (change.to - shows) * clamp((progress(change.seg, time) - change.after) / (1 - change.after))
        return shows
    }

    /** The look of a block at a time: each change takes it from the look before to the paint of its owner, or to a free block. */
    private blockLook(index: number, time: number): { paint: Paint; fill: number; free: boolean } {
        const cell = this.cells[index]!
        let paint = cell.base ?? this.free, fill = cell.base ? TAKEN : 0, free = cell.base === null
        for (const change of cell.changes) {
            const share = progress(change.seg, time)
            if (share <= 0) continue
            const to = change.paint ?? this.free
            paint = share >= 1 ? to : mixPaint(paint, to, share)
            fill += ((change.paint ? TAKEN : 0) - fill) * share
            // Dashes cannot fade to a line, so they switch when the colors are half way.
            if (share >= 0.5) free = change.paint === null
        }
        return { paint, fill, free }
    }

    /** The keys and the drawings of one item, from a time on. Each reads the record, so the picture follows it in any order of the calls. */
    private wire(rec: Rec, from: number): void {
        const outer = this.outers[rec.index]!, body = this.bodies[rec.index]!, bar = this.bars[rec.index]!
        // An item never shows at the left of the room where items arrive. There it stands for the items that have no place.
        outer.track('x').add(always((time) => Math.max(this.geo.entryX, this.placeOf(rec, time)[0]), from))
        outer.track('y').add(always((time) => this.placeOf(rec, time)[1], from))
        outer.track('opacity').add(always((time) => this.showsAt(rec, time), from))
        outer.track('visible').add(always((time) => this.showsAt(rec, time) > 0, from))
        body.track('stroke').add(always((time) => this.edgeAt(rec, time).paint, from))
        body.track('dash').add(always((time) => this.edgeAt(rec, time).dash, from))
        bar.track('path').add(always((time) => this.barAt(rec, time), from))
        // The units of work that are left, at the right of the item.
        if (rec.work !== undefined) this.write(this.numbers[rec.index]!, (time) => String(Math.max(0, Math.ceil(rec.work! - this.doneAt(rec, time) - 1e-6))), { anchor: 'right' })
        this.wireUnder(rec)
    }

    /** Under an item: the number of its wait, and then the status that it leaves with, after a cross. */
    private wireUnder(rec: Rec): void {
        const small = this.small, texts = new Map<string, Node>()
        let status: Node | null = null
        this.unders[rec.index]!.draw = (time) => {
            const out: Node[] = []
            const share = rec.marked ? progress(rec.marked, time) : 0
            // The number goes when the item leaves its line for a slot, and when a status takes its place.
            const quiet = rec.quiet ? clamp(progress(rec.quiet, time) / 0.3) : 0
            const clocked = rec.clocked !== null && time >= rec.clocked - SOON
            // The number is gone before the status comes, so no two texts show at one place.
            const number = clocked ? clamp(1 - share * 2) : 0
            if (number > 0 && quiet < 1) {
                const late = this.lateAt(rec, time), words = this.format(this.waitAt(rec, time)), key = `${late ? 1 : 0}${words}`
                if (texts.size > 512) texts.clear()
                let made = texts.get(key)
                if (!made) texts.set(key, made = text(words, { size: small, font: this.font, color: late ? 'red' : 'dim', weight: late ? 600 : 400 }))
                made.base.opacity = number * (1 - quiet)
                out.push(made)
            }
            if (rec.status !== undefined && (clocked ? share > 0.5 : share > 0)) {
                if (!status) {
                    const word = text(rec.status, { size: small, font: this.font, color: 'red', weight: 600, anchor: 'left' })
                    const arm = small * 0.24, room = small * CROSS - arm * 2, width = arm * 2 + room + advanceWidth(rec.status, small, { font: this.font, weight: 600 })
                    const cross = new Node([...line([-arm, -arm], [arm, arm]).get('path')!, ...line([-arm, arm], [arm, -arm]).get('path')!]).stroke('red', Math.max(2, small * 0.11)).at(-width / 2 + arm, 0)
                    status = new Node().add(cross, word.at(-width / 2 + arm * 2 + room, 0))
                }
                status.base.opacity = clocked ? clamp(share * 2 - 1) : share
                out.push(status)
            }
            return out
        }
    }

    /** A text that follows a function of the time. One text is made for each value, and kept. Null draws nothing. */
    private write(holder: Node, read: (time: number) => string | null, options: { anchor: 'left' | 'right'; color?: ColorInput }): void {
        const texts = new Map<string, Node>()
        holder.draw = (time) => {
            const words = read(time)
            if (words === null) return null
            let made = texts.get(words)
            if (!made) texts.set(words, made = text(words, { size: this.small, font: this.font, color: options.color ?? 'dim', anchor: options.anchor }))
            return made
        }
    }

    /** The box of a part, in the coordinates of the object: left, top, right, bottom. */
    private partBox(part: QueuePart, call: string): [number, number, number, number] {
        const geo = this.geo, half = geo.h / 2
        const whole = (value: unknown, count: number, what: string): number => {
            if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= count) throw new Error(`requestQueue: ${call}: no ${what} ${shown(value)}. The queue has ${count === 0 ? `no ${what}` : count === 1 ? `one ${what}, ${what} 0` : `the ${what}s 0 to ${count - 1}`}`)
            return value as number
        }
        if (part === 'slots') return [geo.seatX - geo.w / 2, geo.seatY[0]! - half, geo.seatX + geo.w / 2, geo.seatY[this.slots - 1]! + half]
        if (part === 'pool' || (typeof part === 'object' && part !== null && 'block' in part)) {
            if (this.cells.length === 0) throw new Error(`requestQueue: ${call}: the queue has no pool. Give it one: requestQueue(items, { pool: 16 })`)
            if (part === 'pool') {
                const [x0, y0] = this.blockAt(0), [, y1] = this.blockAt(this.cells.length - 1)
                return [x0 - geo.cell / 2, y0 - geo.cell / 2, x0 + (Math.min(geo.columns, this.cells.length) - 1) * geo.cellPitch + geo.cell / 2, y1 + geo.cell / 2]
            }
            const [x, y] = this.blockAt(whole(part.block, this.cells.length, 'block'))
            return [x - geo.cell / 2, y - geo.cell / 2, x + geo.cell / 2, y + geo.cell / 2]
        }
        if (typeof part === 'object' && part !== null && 'slot' in part) {
            const y = geo.seatY[whole(part.slot, this.slots, 'slot')]!
            return [geo.seatX - geo.w / 2, y - half, geo.seatX + geo.w / 2, y + half]
        }
        if (typeof part === 'object' && part !== null && 'line' in part) {
            const y = geo.lineY[this.lineOf(part.line, call)]!
            if (part.place === undefined) return [this.placeX(geo.places - 1) - geo.w / 2, y - half, geo.headX + geo.w / 2, y + half]
            const x = this.placeX(whole(part.place, geo.places, 'place'))
            return [x - geo.w / 2, y - half, x + geo.w / 2, y + half]
        }
        throw new Error(`requestQueue: ${call}: the part is ${typeof part === 'string' ? JSON.stringify(part) : String(part)}. A part is { line }, { line, place }, { slot }, { block }, 'slots' or 'pool'`)
    }
}

/**
 * Items that wait in line in front of slots: `requestQueue([{ id: 'A', work: 2 }, { id: 'B', work: 4 }], { slots: 2, names: { slots: 'GPU batch' } })`.
 * `queue.admit()` moves the head of the line into a free slot, `queue.run()` lets the slots work, and `queue.finish()` drains them.
 */
export function requestQueue(items: readonly QueueItem[] = [], options: RequestQueueOptions = {}): RequestQueue {
    return new RequestQueue(items, options)
}
