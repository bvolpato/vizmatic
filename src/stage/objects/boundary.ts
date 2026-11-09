import { Node } from '../node'
import { apply, invert, rectPath, type Bounds } from '../geometry'
import { dot, line } from '../shapes'
import { text, type TextOptions } from '../text'
import type { ColorInput } from '../color'
import type { Anim, AnimOptions } from '../anim'
import type { Ease } from '../ease'
import { clock } from '../track'
import { reveal, sampleAt, stepAt } from './util'

export interface BoundaryOptions {
    /** The length of the line. Defaults to 1600. */
    width?: number
    /** The name of the line, over its left end, such as 'system call line'. */
    label?: string
    /** The name of the side over the line, at the left end, such as 'user space'. */
    above?: string
    /** The name of the side under the line, at the left end, such as 'kernel'. */
    below?: string
    /** The color of the line, its label and its ticks. Defaults to yellow. */
    color?: ColorInput
    /** The width of the stroke. Defaults to 3. A wall that is harder to cross can take 6. */
    weight?: number
    /** A dashed line, for a boundary that is a rule and not a wall. */
    dash?: boolean
    /**
     * Show a tally of the crossings. `true` shows the number alone. A string is the word after the number.
     * A pair is the word for one and the word for more, such as `['system call', 'system calls']`.
     */
    tally?: boolean | string | readonly [one: string, many: string]
    /**
     * Where the tally is. 'end' puts it over the right end of the line, next to the line, and `x()` keeps
     * crossings clear of it. 'over' puts it on a row of its own, over the place where a mark starts, so that
     * crossings have the line up to its right end. Defaults to 'end'.
     */
    tallySide?: 'end' | 'over'
    /** The digits that the tally has room for. A count with more digits is an error. Defaults to 6. */
    tallyDigits?: number
    /** Text size of the tally. Defaults to `size`. */
    tallySize?: number
    /** The color of the number of the tally. Its word stays dim. Defaults to ink. */
    tallyColor?: ColorInput
    /**
     * How many crossings one tick stands for. Give the lines that a film compares one value, so that their
     * ticks compare as their counts do. Without it, one tick is one crossing until the line is full.
     */
    tickScale?: number
    /** Text size. Defaults to 26. */
    size?: number
    font?: TextOptions['font']
}

export interface BoundaryCrossOptions extends AnimOptions {
    /** 'down' goes from over the line to under it, 'up' the reverse, and 'round' goes down and comes back. Defaults to down. */
    direction?: 'down' | 'up' | 'round'
    /** How far from the line the mark starts and ends. Defaults to 2.7 of the text size of the line, as a whole number: 70 at size 26. */
    reach?: number
    /** The color of the mark and of its tick. Without it, the mark is ink and the tick has the color of the line. */
    color?: ColorInput
    /** A short text beside the place where the mark starts. It fades with the mark. */
    label?: string
    /** How much the tally goes up. A whole number, 0 or more. Defaults to 1. */
    counts?: number
}

/** A crossing that `s.play()` can run. It also gives its two parts, for a film that reads their places. */
export interface BoundaryCrossing extends Anim {
    /** The mark that travels. */
    readonly mark: Node
    /** The text of the crossing, or null when it has none. */
    readonly labelNode: Node | null
}

/** A span of time in which a number changes. A span of no length is a step. */
interface Span {
    t0: number
    t1: number
    ease: Ease | null
}

interface Change extends Span {
    amount: number
}

interface Clear extends Span {
    /** The number of changes that were scheduled before this clear. The clear takes those away, and no later one. */
    before: number
}

/** What the tally needs to draw itself at a time. */
interface TallyLook {
    size: number
    y: number
    over: boolean
    /** The width that a digit and a separator take in the number. */
    digit: number
    separator: number
    /** The word for a count of one and the word for another count. Empty when the tally is a number alone. */
    words: readonly { content: string; shift: number; end: number }[]
    /** How long the tally stays at 1 before it shows the word for one, in seconds. */
    rest: number
    /** The widest box that the tally can take, in the coordinates of the line. */
    box: Bounds
}

const TICK_LIMIT = 400
const DIRECTIONS = ['down', 'up', 'round']
const whole = (value: number) => Math.round(value).toLocaleString('en-US')

/** How much of a span has passed at a time, from 0 to 1, with the ease of the span. */
function progress(span: Span, time: number): number {
    if (time < span.t0) return 0
    if (time >= span.t1) return 1
    const raw = (time - span.t0) / (span.t1 - span.t0)
    return Math.max(0, Math.min(1, span.ease ? span.ease(raw) : raw))
}

/**
 * The share of its time after which an ease has done a share of its way. A mark that travels from one side
 * of a line to the other is on the line when the ease is half way: that is at 0.5 of the time for a
 * symmetric ease, and earlier or later for others.
 */
function reachedAt(ease: Ease, share: number): number {
    if (share <= 0) return 0
    const steps = 64
    let low = 0, high = 1
    for (let step = 1; step <= steps; step++) {
        if (ease(step / steps) >= share) {
            low = (step - 1) / steps
            high = step / steps
            break
        }
    }
    for (let round = 0; round < 30; round++) {
        const middle = (low + high) / 2
        if (ease(middle) >= share) high = middle
        else low = middle
    }
    return high
}

/** A number with two digits that count, for a note that says "about". */
function about(value: number): number {
    const unit = 10 ** Math.max(0, Math.floor(Math.log10(value)) - 1)
    return Math.round(value / unit) * unit
}

function overlaps(a: Bounds, b: Bounds, alongX: number, alongY: number): boolean {
    return a.x < b.x + b.width + alongX && b.x < a.x + a.width + alongX && a.y < b.y + b.height + alongY && b.y < a.y + a.height + alongY
}

/**
 * An open line between two sides, such as user space and the kernel, that counts what crosses it. `cross()`
 * sends a mark through the line: the line lights there, a tick stays, and the tally goes up. `addCrossings()`
 * runs the tally up with no mark, for a number that is too large to draw, and fills the line with ticks.
 * `clear()` starts the next round of a comparison. `.at()` places the middle of the line. The names are at
 * the left end and the tally is at the right end, and `x()` gives the places between them.
 *
 * What changes with time is kept in lists that a change replaces and never edits, and in the nodes. So a copy
 * of the line, made alone or with the group or the zone that holds it, has its own tally and its own ticks.
 */
export class Boundary extends Node {
    readonly line: Node
    /** The name of the line, or null when it has none. */
    readonly labelNode: Node | null
    /** The names of the side over the line and of the side under it. Each is null when it is not given. */
    readonly sides: readonly [Node | null, Node | null]
    /** The number and the word of the tally, as one node, or null when the line shows no tally. */
    readonly tallyNode: Node | null
    /** The note under the right end of the line that says what one tick stands for, such as "each tick: about 40". It is null while one tick is one crossing. */
    noteNode: Node | null = null
    /** The ticks that are on the line after the changes that are scheduled so far, in the order that they arrive. */
    ticks: readonly Node[] = []
    private readonly length: number
    private readonly weight: number
    private readonly size: number
    private readonly tint: ColorInput
    private readonly font: TextOptions['font']
    private readonly pattern: readonly number[] | null
    private readonly tally: TallyLook | null
    private readonly digits: number
    /** The crossings that one tick stands for, when the film gives a `tickScale`. */
    private readonly each: number | null
    /** How far from the line a mark starts when a crossing does not say. */
    private readonly reach: number
    /** The two ends of the part of the line that is free for crossings. */
    private readonly first: number
    private readonly last: number
    /** The boxes of the names and of the tally. The text of a crossing stays clear of them. */
    private readonly blocks: readonly Bounds[]
    /** The height of the note that says what one tick stands for, under the line. */
    private readonly noteY: number
    /** Where the name of the side under the line ends, in the coordinates of the line, or null with no such name. */
    private readonly underEnd: number | null
    private changes: readonly Change[] = []
    private clears: readonly Clear[] = []
    private total = 0
    /** What the note says that one tick stands for, or 0 while there is no note. */
    private perTick = 0

    constructor(options: BoundaryOptions = {}) {
        super()
        const length = this.length = options.width ?? 1600
        if (!(Number.isFinite(length) && length > 0)) throw new Error('boundary: width is the length of the line, more than 0')
        const weight = this.weight = options.weight ?? 3
        if (!(Number.isFinite(weight) && weight > 0)) throw new Error('boundary: weight is the width of the stroke, more than 0')
        const size = this.size = options.size ?? 26
        if (!(Number.isFinite(size) && size > 0)) throw new Error('boundary: size is a text size, more than 0')
        const tallySize = options.tallySize ?? size
        if (!(Number.isFinite(tallySize) && tallySize > 0)) throw new Error('boundary: tallySize is a text size, more than 0')
        this.digits = options.tallyDigits ?? 6
        if (!Number.isInteger(this.digits) || this.digits < 1 || this.digits > 15) throw new Error(`boundary: tallyDigits is ${this.digits}. Give the number of digits that the tally has room for, from 1 to 15`)
        this.each = options.tickScale ?? null
        if (this.each !== null && !(Number.isFinite(this.each) && this.each >= 1)) throw new Error(`boundary: tickScale is ${this.each}. Give the number of crossings that one tick stands for, 1 or more`)
        const side = options.tallySide ?? 'end'
        if (side !== 'end' && side !== 'over') throw new Error(`boundary: tallySide is ${JSON.stringify(side)}. Use 'end' or 'over'`)
        const color = this.tint = options.color ?? 'yellow'
        const font = this.font = options.font
        const left = -length / 2, right = length / 2
        const reach = this.reach = Math.round(size * 2.7), radius = size * 0.27

        // The note is smaller than the names. With the tally at the end of the line, `x()` keeps marks away
        // from that end, so the note is next to the line, on the baseline of the name under it. With no
        // tally there, marks cross up to the end, so the note is under the way of a mark and of its text,
        // as the tally is over it.
        const counted = options.tally !== undefined && options.tally !== false
        const beside = counted && side === 'end'
        this.noteY = beside ? weight / 2 + size * 1.09 : reach + size * 1.1
        // A shape with no paint, as tall as the way of a mark, and of the note when the note is under that
        // way. It draws nothing, and it gives the line bounds that hold a crossing, so that a zone or a
        // card around the line leaves room for the marks.
        const low = !beside && (counted || this.each !== null) ? this.noteY + size * 0.3 : reach + radius
        this.add(new Node(rectPath(left, -reach - radius, length, reach + radius + low)))
        this.line = line([left, 0], [right, 0], { stroke: color, width: weight })
        if (options.dash) {
            // Fit a whole number of dashes to the line, so that it ends in a full dash and not in a stub.
            const on = weight * 4, off = weight * 3.2
            const dashes = Math.max(1, Math.round((length + off) / (on + off)))
            const fit = length / (dashes * (on + off) - off)
            this.pattern = [on * fit, off * fit]
            this.line.dash(this.pattern)
        } else {
            this.pattern = null
        }
        this.add(this.line)

        // The ink of a text starts a little after the point that `.at()` places. Put the ink itself on the end of the line.
        const flush = <T extends Node>(node: T, x: number, y: number): T => {
            node.at(x, y)
            return node.shift(x - node.bounds().x, 0)
        }
        // A row of text over the line has its baseline 0.7 of the size over the stroke, so the tail of a "p"
        // stays clear of a tick. A row under the line has the top of its capitals 0.6 of the size under it.
        const over = -(weight / 2 + size * 1.05), under = weight / 2 + size
        const name = (content: string | undefined, tone: ColorInput, y: number) =>
            content ? flush(text(content, { size, font, color: tone, anchor: 'left' }), left, y) : null
        const above = name(options.above, 'dim', over)
        const below = name(options.below, 'dim', under)
        // The two side names are next to the line, so that they read as a pair. The label goes over them.
        this.labelNode = name(options.label, color, above ? over - size * 1.4 : over)
        this.sides = [above, below]
        // Measured here, where the line is not placed yet: the bounds of a part are in the coordinates of the stage.
        const lower = below?.bounds()
        this.underEnd = lower ? lower.x + lower.width : null
        const names = [this.labelNode, above, below].filter((node): node is NonNullable<typeof node> => node !== null)
        this.add(...names)

        let tallyRoom = 0
        if (options.tally === undefined || options.tally === false) {
            this.tally = null
            this.tallyNode = null
        } else {
            const given = options.tally === true ? [] : typeof options.tally === 'string' ? [options.tally, options.tally] : [...options.tally]
            if (given.length !== 0 && (given.length !== 2 || given.some((word) => typeof word !== 'string'))) throw new Error("boundary: tally is true, a word, or the word for one and the word for more, such as ['system call', 'system calls']")
            const trimmed = given.map((word) => word.trim())
            if (trimmed.some((word) => word === '') && trimmed.some((word) => word !== '')) throw new Error("boundary: tally has a word for one count and none for the other. Give both, such as ['system call', 'system calls']")
            // A digit takes the width of the widest digit, so the digits of a number that runs keep their places.
            const advance = (glyph: string) => text(glyph, { size: tallySize, font, weight: 600 }).get('px') * 2
            const digit = Math.max(...[...'0123456789'].map(advance)), separator = advance(',')
            // The word ends at the right end of the line. The number ends just before the word and grows to
            // the left, so the word does not move when digits are added.
            const words = trimmed.filter((word) => word !== '').map((content) => {
                const ink = text(content, { size: tallySize, font, anchor: 'right' }).bounds()
                return { content, shift: -(ink.x + ink.width), end: -ink.width - tallySize * 0.25 }
            })
            const number = this.digits * digit + Math.floor((this.digits - 1) / 3) * separator
            tallyRoom = number - Math.min(0, ...words.map((word) => word.end))
            // Next to the line, or over the place where a mark starts with the reach that the line gives it.
            const y = side === 'over' ? -(reach + radius + size * 0.4 + tallySize * 0.56) : -(weight / 2 + tallySize * 1.05)
            if (side === 'over' && tallyRoom > length) throw new Error(`boundary: a line of ${length} is too short for its tally, which needs ${Math.ceil(tallyRoom)}. Make the line longer, or give it fewer tallyDigits`)
            // A viewer needs half a second to read a short word, and one second for 20 characters. The film check
            // reports a text that is up for less as too brief, so the word for one does not show for less.
            const rest = Math.max(0.5, (words[0]?.content.length ?? 0) / 20)
            this.tally = { size: tallySize, y, over: side === 'over', digit, separator, words, rest, box: { x: right - tallyRoom, y: y - tallySize * 0.45, width: tallyRoom, height: tallySize * 1.01 } }
            // Each part has a paint and no shape: it draws its glyphs in that paint. So a film that recolors
            // the tally recolors the digits too, which are made again for each frame.
            const part = (draw: Node['draw'], paint: ColorInput) => {
                const node = new Node().fill(paint).at(right, y)
                node.draw = draw
                return node
            }
            this.tallyNode = new Node().add(part(Boundary.drawNumber, options.tallyColor ?? 'ink'), ...(words.length ? [part(Boundary.drawWord, 'dim')] : []))
            this.add(this.tallyNode)
        }

        // The text of a crossing is on the right of its mark. Next to a name it would read as one phrase with
        // the name, so the first place is farther from the names than the last place is from the tally.
        const afterNames = size * 2, beforeTally = size * 1.2, margin = size * 0.8
        const nameRoom = Math.max(0, ...names.map((node) => node.bounds().width))
        this.first = left + (nameRoom > 0 ? nameRoom + afterNames : margin)
        this.last = right - (this.tally && !this.tally.over ? tallyRoom + beforeTally : margin)
        if (this.last < this.first) {
            const needed = Math.ceil(length + this.first - this.last)
            throw new Error(`boundary: a line of ${length} has no room for a crossing between its two ends. The names and the tally need ${needed}. Make the line longer or the names shorter, or put the tally on a row of its own with tallySide: 'over'`)
        }
        this.blocks = [...names.map((node) => node.bounds()), ...(this.tally ? [this.tally.box] : [])]
    }

    /**
     * A place along the line for `cross()`, in the coordinates of the line: 0 is the first place after the
     * names and 1 is the last place before the tally, with room for the widest tally of the line.
     */
    x(part: number): number {
        if (!(part >= 0 && part <= 1)) throw new Error(`boundary: x(${part}) is not a place on the line. A part is from 0 to 1: 0 is the first place after the names, and 1 is the last place before the tally`)
        return this.first + (this.last - this.first) * part
    }

    /** The tally after the changes that are scheduled so far. */
    get count(): number {
        return this.total
    }

    /** The line draws from the left, then the names, the tally and the ticks arrive. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'boundary.enter', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const drawn = ctx.t0 + (ctx.t1 - ctx.t0) * 0.6
                stepAt(this.line, 'trimTo', 0, ctx.t0)
                this.line.tween('trimTo', 1, ctx.t0, drawn, ctx.ease)
                // A tick with no line under it would be a stroke in the air, so the ticks wait for the line too.
                for (const part of [this.labelNode, ...this.sides, this.tallyNode, this.noteNode, ...this.ticks]) {
                    if (!part) continue
                    const shown = sampleAt(part, 'opacity', ctx.t0)
                    stepAt(part, 'opacity', 0, ctx.t0)
                    part.tween('opacity', shown, drawn, ctx.t1, ctx.ease)
                }
            },
        }
    }

    /**
     * A mark travels through the line at `x`, a place in the coordinates of the line: use `line.x(part)`.
     * Where the mark passes, the line lights for a moment and a tick stays. The tally goes up when the
     * mark is on the line the first time.
     */
    cross(x: number, options: BoundaryCrossOptions = {}): BoundaryCrossing {
        const { direction, reach, counts } = this.checked(x, options)
        const start = direction === 'up' ? reach : -reach
        const mark = dot(this.size * 0.27, options.color ?? 'ink').at(x, start).zIndex(2)
        const caption = options.label ? this.caption(options.label, x, start) : null
        return {
            mark, labelNode: caption,
            label: 'boundary.cross', duration: options.duration ?? (direction === 'round' ? 1.4 : 0.8), ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx
                // A round trip is two legs with a turn between them, so the mark slows down at the far side.
                const turn = direction === 'round' ? (t0 + t1) / 2 : t1
                const leg = turn - t0
                for (const part of caption ? [mark, caption] : [mark]) {
                    this.attach(part, t0)
                    Boundary.fade(part, t0, t1, leg * 0.2, ease)
                }
                // A crossing that a film plays again starts again from its start.
                stepAt(mark, 'y', start, t0)
                mark.tween('y', -start, t0, turn, ease)
                if (direction === 'round') mark.tween('y', start, turn, t1, ease)
                const half = reachedAt(ease, 0.5)
                this.land(x, t0 + leg * half, leg, t0, t1, options.color, counts)
                if (direction === 'round') this.light(x, turn + leg * half, leg, t0, t1, options.color)
                clock.now = t0
            },
        }
    }

    /**
     * The tally runs up by `count` with no mark, for a number that is too large to draw, such as
     * `line.addCrossings(10000)`. The number on screen runs through whole values and ends exact. The line
     * fills with ticks from the left while the number runs: one tick for each crossing, or for each
     * `tickScale` crossings. When the line is full, a note under it says what one tick stands for.
     */
    addCrossings(count: number, options: AnimOptions = {}): Anim {
        if (!Number.isInteger(count) || count < 0) throw new Error(`boundary: addCrossings(${count}) is not a count. A count is a whole number, 0 or more`)
        if (!this.tallyNode) throw new Error('boundary: addCrossings() runs the tally up, and this line shows no tally. Give the line `tally: true`, or a word')
        return {
            label: 'boundary.addCrossings', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const next = this.total + count
                this.checkCount(next)
                const free = this.freeSlots()
                const room = Math.min(free.length, TICK_LIMIT - this.ticks.length)
                const wanted = Math.ceil(next / (this.each ?? 1)) - this.ticks.length
                if (this.each !== null && wanted > room) {
                    const holds = this.ticks.length + room
                    throw new Error(`boundary: with a tickScale of ${this.each}, a count of ${whole(next)} is ${whole(this.ticks.length + wanted)} ticks, and the line has room for ${holds}. Give a tickScale of ${Math.ceil(next / holds)} or more, or a longer line`)
                }
                // Without a scale, a count that is too large fills the line, and the note says what a tick stands for.
                const fill = Math.max(0, Math.min(wanted, room))
                const span = ctx.t1 - ctx.t0
                const added = free.slice(0, fill).map((x, index) => {
                    // The tick of a share of the count arrives when the number on screen has run that share.
                    const arrives = ctx.t0 + span * reachedAt(ctx.ease, (index + 0.5) / fill)
                    return this.tick(x, this.tint, arrives, Math.min(ctx.t1, arrives + 0.12))
                })
                this.ticks = [...this.ticks, ...added]
                this.changes = [...this.changes, { t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, amount: count }]
                this.total = next
                this.remark(ctx.t0, ctx.t1)
                clock.now = ctx.t0
            },
        }
    }

    /** The ticks and the note fade and the tally goes back to 0, for the next round of a comparison. */
    clear(options: AnimOptions = {}): Anim {
        return {
            label: 'boundary.clear', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                for (const part of [...this.ticks, ...(this.noteNode ? [this.noteNode] : [])]) {
                    // A tick that arrives after the clear starts would come back. Take it away when it arrives.
                    const from = Math.max(ctx.t0, (part.data['arrives'] as number | undefined) ?? ctx.t0), to = Math.max(ctx.t1, from)
                    part.tween('opacity', 0, from, to, ctx.ease)
                }
                this.ticks = []
                this.noteNode = null
                this.perTick = 0
                this.clears = [...this.clears, { t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, before: this.changes.length }]
                this.total = 0
            },
        }
    }

    /**
     * One mark travels through several lines, one under the other, such as a system call line and the wall of
     * a virtual machine. Give the lines in the order that the mark meets them. `x` is a place in the
     * coordinates of the first line. Each line lights, keeps a tick and counts when the mark is on it. The mark
     * is on the stage and not in a line, and its place is in the coordinates of the stage.
     */
    static through(lines: readonly Boundary[], x: number, options: BoundaryCrossOptions = {}): BoundaryCrossing {
        if (lines.length < 2) throw new Error('crossThrough: give it two lines or more. For one line, use line.cross(x)')
        const top = lines[0]!
        const { direction, reach, counts } = top.checked(x, options)
        const way = direction === 'up' ? -1 : 1
        // Where the mark meets each line: in the coordinates of the stage, and along that line.
        const meet = () => {
            const [stageX] = top.toWorld(x, 0)
            return lines.map((line) => {
                const [, stageY] = line.toWorld(0, 0)
                return { line, stageX, stageY, own: apply(invert(line.worldMatrix()), stageX, stageY)[0] }
            })
        }
        meet().forEach((at, index, all) => {
            if (index === 0) return
            if ((at.stageY - all[index - 1]!.stageY) * way <= 0) throw new Error('crossThrough: give the lines in the order that the mark meets them: from the top for down and round, from the bottom for up')
            // The mark comes to this line from far away, so it must pass clear of every text of the line.
            const clear = at.own >= at.line.first && at.own <= at.line.last
                && !(at.line.tally?.over && at.own + at.line.size * 0.27 > at.line.tally.box.x - at.line.size * 0.3)
            if (!clear) throw new Error(`crossThrough: the mark meets line ${index} at x = ${Math.round(at.own)} of that line, under its names or its tally. Its free part runs from ${Math.ceil(at.line.first)} to ${Math.floor(at.line.last)}. Move the mark, or the line`)
        })
        const mark = dot(top.size * 0.27, options.color ?? 'ink')
        const caption = options.label ? top.caption(options.label, x, -way * reach) : null
        return {
            mark, labelNode: caption,
            label: 'boundary.crossThrough', duration: options.duration ?? (direction === 'round' ? 1.4 : 0.8) * lines.length, ease: options.ease,
            schedule: (ctx) => {
                const { t0, t1, ease } = ctx
                for (const line of lines) reveal(line, t0, ctx.stage)
                const places = meet()
                const from = places[0]!.stageY - way * reach, to = places[places.length - 1]!.stageY + way * reach
                const turn = direction === 'round' ? (t0 + t1) / 2 : t1
                // The time that the mark is near one line: the share of one reach on each side in the whole way.
                const near = (turn - t0) * Math.min(1, (2 * reach) / Math.abs(to - from))
                ctx.stage.mountAt(mark, t0)
                stepAt(mark, 'x', places[0]!.stageX, t0)
                stepAt(mark, 'y', from, t0)
                Boundary.fade(mark, t0, t1, near * 0.2, ease)
                mark.tween('y', to, t0, turn, ease)
                if (direction === 'round') mark.tween('y', from, turn, t1, ease)
                if (caption) {
                    top.attach(caption, t0)
                    Boundary.fade(caption, t0, t1, near * 0.2, ease)
                }
                for (const { line, own, stageY } of places) {
                    const share = (stageY - from) / (to - from)
                    line.land(own, t0 + (turn - t0) * reachedAt(ease, share), near, t0, t1, options.color, counts)
                    if (direction === 'round') line.light(own, turn + (t1 - turn) * reachedAt(ease, 1 - share), near, t0, t1, options.color)
                }
                clock.now = t0
            },
        }
    }

    /** The number of a tally. It finds its line through the tree, so the number of a copy reads the changes of the copy. */
    private static drawNumber(this: Node, time: number): Node | null {
        const owner = Boundary.owner(this)
        if (!owner?.tally) return null
        const { size, digit, separator, words } = owner.tally
        const paint = this.get('fill') ?? 'ink'
        const glyphs = [...whole(owner.shown(time))]
        const widths = glyphs.map((glyph) => (glyph === ',' ? separator : digit))
        const row = new Node()
        let x = (words[owner.wordAt(time)]?.end ?? 0) - widths.reduce((sum, width) => sum + width, 0)
        glyphs.forEach((glyph, index) => {
            row.add(text(glyph, { size, font: owner.font, weight: 600, color: paint }).at(x + widths[index]! / 2, 0))
            x += widths[index]!
        })
        return row
    }

    private static drawWord(this: Node, time: number): Node | null {
        const owner = Boundary.owner(this)
        if (!owner?.tally) return null
        const word = owner.tally.words[owner.wordAt(time)]!
        return text(word.content, { size: owner.tally.size, font: owner.font, color: this.get('fill') ?? 'dim', anchor: 'right' }).at(word.shift, 0)
    }

    private static owner(node: Node): Boundary | null {
        for (let up = node.parent; up; up = up.parent) if (up instanceof Boundary) return up
        return null
    }

    /**
     * A part of a crossing shows from `t0`, fades in, fades out before `t1`, and is gone after. It is hidden
     * then, and not only clear: a hidden part does not count in the bounds of the line, so a mark that went
     * farther than the bounds of the line does not make the line taller for the rest of the film.
     */
    private static fade(part: Node, t0: number, t1: number, time: number, ease: Ease): void {
        stepAt(part, 'visible', true, t0)
        stepAt(part, 'opacity', 0, t0)
        part.tween('opacity', 1, t0, t0 + time, ease)
        part.tween('opacity', 0, t1 - time, t1, ease)
        stepAt(part, 'visible', false, t1)
    }

    /** The input of a crossing, checked where the film names it. */
    private checked(x: number, options: BoundaryCrossOptions): { direction: 'down' | 'up' | 'round'; reach: number; counts: number } {
        const direction = options.direction ?? 'down', reach = options.reach ?? this.reach, counts = options.counts ?? 1
        const half = this.length / 2, radius = this.size * 0.27
        if (!(x >= -half && x <= half)) throw new Error(`boundary: x is ${x}, and the line runs from ${-half} to ${half}. Use line.x(part) for a place on the line`)
        if (!DIRECTIONS.includes(direction)) throw new Error(`boundary: direction is ${JSON.stringify(direction)}. Use 'down', 'up' or 'round'`)
        if (!(Number.isFinite(reach) && reach > 0)) throw new Error('boundary: reach is how far from the line the mark starts, more than 0')
        if (!Number.isInteger(counts) || counts < 0) throw new Error(`boundary: counts is ${counts}. A crossing counts a whole number, 0 or more`)
        // A tally on a row of its own is over the way of a mark with the reach of the line, and no higher.
        if (this.tally?.over && x + radius > this.tally.box.x - this.size * 0.3 && reach + radius > -(this.tally.box.y + this.tally.box.height) - this.size * 0.15) {
            throw new Error(`boundary: with a reach of ${reach}, the mark at x = ${Math.round(x)} goes into the tally. Under the tally a mark has a reach of ${Math.floor(this.reach)} at most: give a smaller reach, or a place before ${Math.floor(this.tally.box.x - this.size * 0.3 - radius)}`)
        }
        // Find a full line now, where the film names the crossing. The crossings of one `lagged` are all
        // made before the first one is scheduled, so the line checks again when a crossing lands.
        if (this.each === null) this.checkLimit()
        return { direction, reach, counts }
    }

    private checkLimit(): void {
        if (this.ticks.length >= TICK_LIMIT) throw new Error(`boundary: a line holds ${TICK_LIMIT} ticks, and this crossing is one more. Use addCrossings(count) for a number that is too large to draw`)
    }

    private checkCount(count: number): void {
        if (this.tally && count >= 10 ** this.digits) throw new Error(`boundary: a tally of ${whole(count)} has more than the ${this.digits} digits that the line keeps room for. Give the line tallyDigits: ${String(count).length}`)
    }

    /** Make a node a part of the line that shows from a time on, and not before. */
    private attach(node: Node, time: number): void {
        clock.now = time
        this.add(node)
    }

    /**
     * The text of a crossing, beside the place where its mark starts. It stays there: a text that travels
     * with the mark would pass through the line. It is on the right of the mark, or on the left when the
     * right has no room. A text with no room on either side is an error.
     */
    private caption(content: string, x: number, start: number): Node {
        const node = text(content, { size: this.size * 0.85, font: this.font, color: 'dim', anchor: 'left' }).at(0, start)
        const ink = node.bounds(), gap = this.size * 0.67, half = this.length / 2, edge = this.size * 0.8
        const sides = [x + gap, x - gap - ink.width]
        // The best place is beside the free part of the line, with no name and no tally over it or under it.
        const beside = (left: number) => left >= this.first - edge && left + ink.width <= this.last + edge
        // On a short line, a place that is on the line and touches no name and no tally is good enough.
        const clear = (left: number) => left >= -half && left + ink.width <= half
            && !this.blocks.some((block) => overlaps({ ...ink, x: left }, block, this.size * 0.3, this.size * 0.15))
        const place = sides.find((left) => beside(left) && clear(left)) ?? sides.find(clear)
        if (place === undefined) throw new Error(`boundary: the text ${JSON.stringify(content)} of the crossing at x = ${Math.round(x)} has no room beside its mark: it is ${Math.ceil(ink.width)} wide, and it must stay on the line and clear of the names and the tally. Give a shorter text, another place, another reach, or a longer line`)
        return node.shift(place - ink.x, 0)
    }

    /** The mark is on the line: the line lights, a tick stays if the count asks for one more, and the tally goes up. */
    private land(x: number, pass: number, near: number, t0: number, t1: number, color: ColorInput | undefined, counts: number): void {
        const next = this.total + counts
        this.checkCount(next)
        this.light(x, pass, near, t0, t1, color)
        // With a scale, a tick stands for several crossings, so not every crossing leaves one.
        if (this.each === null || Math.ceil(next / this.each) > this.ticks.length) {
            this.checkLimit()
            this.ticks = [...this.ticks, this.tick(x, color ?? this.tint, pass, Math.min(t1, pass + near * 0.15))]
        }
        this.changes = [...this.changes, { t0: pass, t1: pass, ease: null, amount: counts }]
        this.total = next
        if (this.each !== null) this.remark(pass, Math.min(t1, pass + near * 0.5))
    }

    /** A short stroke across the line, which arrives at a time. A heavy line has a heavier tick, so that it does not look like a hair. */
    private tick(x: number, color: ColorInput, arrives: number, shown: number): Node {
        const out = this.weight / 2 + this.size * 0.3
        const tick = line([0, -out], [0, out], { stroke: color, width: this.tickWidth }).at(x, 0).zIndex(1)
        tick.data['arrives'] = arrives
        this.attach(tick, arrives)
        stepAt(tick, 'opacity', 0, arrives)
        tick.tween('opacity', 1, arrives, shown, null)
        return tick
    }

    private get tickWidth(): number {
        return Math.max(Math.min(this.weight, 3), this.weight * 0.75)
    }

    /** A short piece of the line around `x`, wider and with a glow, which shows while a mark passes. */
    private light(x: number, pass: number, near: number, t0: number, t1: number, color: ColorInput | undefined): void {
        // The piece is shorter than the room that `x()` keeps at the two ends, so it does not reach under a text.
        const half = this.length / 2, reach = this.size * 1.1
        const from = Math.max(-half, x - reach), to = Math.min(half, x + reach)
        const piece = line([from, 0], [to, 0], { stroke: color ?? this.tint, width: this.weight + 3, glow: 10 })
        // On a dashed line the piece has the same dashes at the same places.
        if (this.pattern) piece.dash(this.pattern, (from + half) % (this.pattern[0]! + this.pattern[1]!))
        const starts = Math.max(t0, pass - near * 0.12), ends = Math.min(t1, pass + near * 0.35)
        this.attach(piece, starts)
        stepAt(piece, 'opacity', 0, starts)
        piece.tween('opacity', 1, starts, pass, null)
        piece.tween('opacity', 0, pass, ends, null)
    }

    /**
     * The places for the ticks of `addCrossings`, from the left. Each gap between two ticks of the line, or
     * between a tick and an end of the free part, takes the places that fit at one spacing, which is not
     * less than two ticks need to read as two: 6, or two widths of a tick. So a line that has the ticks of
     * some crossings fills with no break around them.
     */
    private freeSlots(): number[] {
        const least = Math.max(6, this.tickWidth * 2)
        // A tick just outside the free part, such as the tick of a crossing at the end of the line, bounds the places too.
        const taken = [...new Set(this.ticks.map((tick) => tick.get('x')))].filter((x) => x > this.first - least && x < this.last + least).sort((a, b) => a - b)
        const stops = taken.map((x) => ({ x, free: false }))
        if (!(stops.length && stops[0]!.x <= this.first)) stops.unshift({ x: this.first, free: true })
        if (!(stops[stops.length - 1]!.x >= this.last)) stops.push({ x: this.last, free: true })
        const places: number[] = []
        for (let index = 0; index + 1 < stops.length; index++) {
            const from = stops[index]!, to = stops[index + 1]!
            const parts = Math.floor((to.x - from.x) / least + 1e-9)
            // A free part that is shorter than the least spacing has one place.
            if (parts === 0 && from.free && to.free) places.push(from.x)
            // An end of the free part is a place. A tick is not: the places start one spacing after it.
            for (let part = from.free ? 0 : 1; part <= (to.free ? parts : parts - 1) && parts > 0; part++) places.push(from.x + ((to.x - from.x) * part) / parts)
        }
        return places
    }

    /** Show, change or keep the note that says what one tick stands for, after a change of the count or of the ticks. */
    private remark(t0: number, t1: number): void {
        const each = this.ticks.length > 0 && this.total > this.ticks.length ? about(this.each ?? this.total / this.ticks.length) : 0
        const value = each > 1 ? each : 0
        if (value === this.perTick) return
        // A note that changes leaves first, and the new one comes after it, so the two are never on each other.
        const part = (t1 - t0) * 0.3, old = this.noteNode
        if (old) old.tween('opacity', 0, t0, t0 + part, null)
        this.perTick = value
        this.noteNode = null
        if (!value) return
        const right = this.length / 2, beside = this.tally !== null && !this.tally.over
        const words = `each tick: about ${whole(value)}`
        const note = text(words, { size: this.size * 0.75, font: this.font, color: 'dim', anchor: 'right' }).at(right, this.noteY)
        note.shift(right - note.bounds().x - note.bounds().width, 0)
        if (beside && this.underEnd !== null && note.bounds().x < this.underEnd + this.size * 0.6) throw new Error(`boundary: a line of ${this.length} has no room under it for the note "${words}" beside the name of the side. Make the line longer, or the name shorter`)
        // The note comes at the start of the change, so a viewer has the time of the run to read it.
        const arrives = old ? t0 + part : t0
        this.attach(note, arrives)
        stepAt(note, 'opacity', 0, arrives)
        note.tween('opacity', 1, arrives, arrives + part, null)
        this.noteNode = note
    }

    /** The tally on screen at a time. Each change counts from its own moment, so crossings that overlap in time add up. */
    private shown(time: number): number {
        let total = 0, next = 0
        for (let index = 0; index <= this.changes.length; index++) {
            for (; next < this.clears.length && this.clears[next]!.before === index; next++) total = Math.round(total * (1 - progress(this.clears[next]!, time)))
            if (index < this.changes.length) total += Math.round(this.changes[index]!.amount * progress(this.changes[index]!, time))
        }
        return total
    }

    /**
     * Which word the tally shows at a time: 0 is the word for one, and 1 is the word for more. The word for
     * one shows where the tally stays at 1 for the time that a viewer needs to read it. A tally that only
     * passes 1 keeps the word for more: a number that runs from 0 to 313 shows 1 for one frame, and the first
     * of several fast crossings shows it for a moment. The word for one there would be a flicker.
     */
    private wordAt(time: number): 0 | 1 {
        const rest = this.tally?.rest ?? 0
        if (this.shown(time) !== 1) return 1
        // How long the tally is 1 before this time, or after it, up to the time that it must stay.
        const stays = (way: 1 | -1): number => {
            const step = 1 / 60
            let far = 0
            while (far < rest && this.shown(time + way * Math.min(rest, far + step)) === 1) far = Math.min(rest, far + step)
            if (far >= rest) return rest
            // The tally changes in the next step. Find the moment, so that each frame of the stretch gets the same answer.
            let low = far, high = Math.min(rest, far + step)
            for (let round = 0; round < 12; round++) {
                const middle = (low + high) / 2
                if (this.shown(time + way * middle) === 1) low = middle
                else high = middle
            }
            return low
        }
        return stays(-1) + stays(1) >= rest ? 0 : 1
    }
}

/** An open line between two sides that counts what crosses it: `boundary({ label: 'system call line', above: 'user space', below: 'kernel', tally: ['system call', 'system calls'] })`. `.at(x, y)` places its middle. */
export function boundary(options: BoundaryOptions = {}): Boundary {
    return new Boundary(options)
}

/** One mark through several lines, from the first to the last: `crossThrough([calls, wall], calls.x(0.5), { direction: 'round' })`. Each line lights, keeps a tick, and counts. */
export function crossThrough(lines: readonly Boundary[], x: number, options: BoundaryCrossOptions = {}): BoundaryCrossing {
    return Boundary.through(lines, x, options)
}
