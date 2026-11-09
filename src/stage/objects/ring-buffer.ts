import { Node, type PropName } from '../node'
import { arcPath, polyPath, ring as contour, type Path, type Vec } from '../geometry'
import { toPaint, type ColorInput } from '../color'
import { text, type TextOptions } from '../text'
import { clock, type Key } from '../track'
import type { Ease } from '../ease'
import type { Anim, AnimOptions } from '../anim'
import { reveal, sampleAt, staggered, stepAt } from './util'

export interface RingBufferOptions {
    /** Outer radius. Defaults to 170. */
    radius?: number
    /** Radial size of a slot. Defaults to 0.32 of `radius`. */
    thickness?: number
    /** The outline of the slots, the caption, and the color of an entry that has none. Defaults to blue. */
    color?: ColorInput
    /** A caption under the ring, such as 'submission queue'. */
    label?: string
    /**
     * The distance from the band to the top of the capital letters of the caption. The default is the room
     * of an arrow head and a name of 5 em under the band, and of the numbers when the ring has `numbers`. It
     * follows from `radius`, `size` and `numbers`, and from no other option. So two rings that share these
     * three have their captions on one line. Give two rings that differ one `captionGap`.
     */
    captionGap?: number
    /** Text size of the caption and the pointer names. Defaults to 26. */
    size?: number
    /**
     * Text size of the label of an entry. A label that is too wide for its slot is set smaller, down to 0.6
     * of this size. Defaults to 0.28 of `thickness`, and to `size` at the most. With the default thickness, a
     * word of four letters such as 'read' then keeps the size, so short labels have one size.
     */
    labelSize?: number
    /** The name of the head pointer. Null draws no head pointer. Defaults to 'head'. */
    head?: string | null
    /** The name of the tail pointer. Null draws no tail pointer. Defaults to 'tail'. */
    tail?: string | null
    /** The color of the arrow head and the name of the head pointer. Defaults to the `color` of the ring. */
    headColor?: ColorInput
    /** The color of the arrow head and the name of the tail pointer. Defaults to the `color` of the ring. */
    tailColor?: ColorInput
    /** Which pointer is outside the ring. The other one is inside. Defaults to 'head'. */
    outside?: 'head' | 'tail'
    /**
     * When the tail pointer moves. With 'push', it moves at each push, also for a pending entry: it is the
     * index that the producer keeps. With 'publish', it stays behind the pending entries until `publish()`:
     * it is the index that the consumer reads. A dim arrow head with no name then shows where the producer
     * writes. Defaults to 'push'.
     */
    tailFollows?: 'push' | 'publish'
    /** Show the running index beside each pointer name, such as 'tail 5'. */
    counts?: boolean
    /** Write the number of each slot beside it. */
    numbers?: boolean
    font?: TextOptions['font']
}

export interface RingBufferEntry {
    /** Defaults to the `color` of the ring. */
    color?: ColorInput
    /** A short text in the slot, such as 'A' or 'read'. */
    label?: string
    /** The entry is written and not yet published: a dashed outline with no fill. `publish()` fills it. */
    pending?: boolean
}

/** The head pointer, the tail pointer, and the mark of the place where the producer writes. */
type Kind = 'head' | 'tail' | 'writer'

/** A text, the size of its ink, and where the middle of the ink is from the point that `.at()` places. */
interface Ink {
    node: Node
    w: number
    h: number
    dx: number
    dy: number
}

interface Move {
    t0: number
    t1: number
    ease: Ease
}

/** How a pointer moves: the count at which the list of its moves starts, the moves, and its name at each count. */
interface Motion {
    start: number
    moves: Move[]
    names: Ink[]
    /** The keys of the x and the y of the pointer, and of the rotation of its arrow head. Null before the first move. */
    keys: Key<number>[] | null
}

/** The default text size of a label, as a share of the thickness. */
const LABEL = 0.28
const KEYED = ['x', 'y', 'rotation'] as const

function measured(node: Node): Ink {
    const box = node.bounds()
    return { node, w: box.width, h: box.height, dx: box.x + box.width / 2, dy: box.y + box.height / 2 }
}

/** Half of the room that an upright box takes along a direction. */
function halfAlong(angle: number, w: number, h: number): number {
    return (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) / 2
}

/** How far an upright box reaches to the side and down, when its near edge goes around a circle of radius `from`. */
function sweep(from: number, w: number, h: number): [number, number] {
    let side = 0, down = 0
    for (let step = 0; step <= 90; step++) {
        const angle = (step / 180) * Math.PI, far = from + halfAlong(angle, w, h)
        side = Math.max(side, far * Math.cos(angle) + w / 2)
        down = Math.max(down, far * Math.sin(angle) + h / 2)
    }
    return [side, down]
}

/** The sizes that follow from the number of slots, the radius and the thickness. */
function measures(slots: number, radius: number, thickness: number): { inner: number; weight: number; inset: number; edge: number; rim: number; labelRoom: number } {
    const inner = radius - thickness, middle = radius - thickness / 2
    // The width of a slot at its narrow end. The outlines and the room around a fill stay small beside it.
    const chord = 2 * inner * Math.sin(Math.PI / slots)
    const weight = Math.max(1.5, Math.min(4, radius * 0.0175, chord * 0.2))
    const inset = Math.min(weight / 2 + 3, chord * 0.22, thickness * 0.22)
    // The outline of a pending entry is thinner than the outline of a slot. It is inside the edge of the
    // fill, so an entry keeps its size when it fills.
    const edge = Math.max(1, weight * 0.6)
    const rim = Math.min(inset + edge / 2, chord * 0.3, thickness * 0.3)
    // An upright label fits in every slot when it fits in the circle that fits in a fill, with a margin.
    const labelRoom = (Math.min(thickness, 2 * middle * Math.sin(Math.PI / slots)) - 2 * inset) * 0.82
    return { inner, weight, inset, edge, rim, labelRoom }
}

/**
 * How far the moves of a pointer have taken it at a time, in slots: one for each move that is over, and a
 * part for each move that runs. Moves that share time add up, so the pushes of one `par` or one `lagged`
 * move the pointer without a jump.
 */
function travelled(moves: readonly Move[], time: number): { whole: number; part: number } {
    let whole = 0, part = 0
    for (const move of moves) {
        // A key gives its time back with a small error. A billionth of a second is more than that error.
        if (time >= move.t1 - 1e-9) whole += 1
        else if (time > move.t0 + 1e-9) part += move.ease((time - move.t0) / (move.t1 - move.t0))
    }
    return { whole, part }
}

/** The share of its time after which an ease is half way. */
function halfway(ease: Ease): number {
    let low = 0, high = 1
    for (let k = 0; k < 24; k++) {
        const middle = (low + high) / 2
        if (ease(middle) < 0.5) low = middle
        else high = middle
    }
    return (low + high) / 2
}

/** Take away what the timeline holds for a property from a time on. The caller then sets the value from that time. */
function cut(node: Node, prop: PropName, t: number): void {
    const keys = node.tracks?.get(prop)?.keys
    if (!keys) return
    for (let k = keys.length - 1; k >= 0; k--) if (keys[k]!.t0 >= t || keys[k]!.t1 > t) keys.splice(k, 1)
}

/** A piece of a band between two radii. Its two straight sides are parallel to its two radii, `inset` inside them. */
function sector(inner: number, outer: number, from: number, to: number, inset = 0): Path {
    const far = Math.asin(inset / outer), near = Math.asin(inset / inner)
    const a = arcPath(0, 0, outer, outer, from + far, to - far)[0]!.p
    const b = arcPath(0, 0, inner, inner, to - near, from + near)[0]!.p
    const points = Array.from(a)
    const lineTo = (x: number, y: number) => {
        const x0 = points[points.length - 2]!, y0 = points[points.length - 1]!
        points.push(x0 + (x - x0) / 3, y0 + (y - y0) / 3, x0 + (x - x0) * 2 / 3, y0 + (y - y0) * 2 / 3, x, y)
    }
    lineTo(b[0]!, b[1]!)
    for (let k = 2; k < b.length; k++) points.push(b[k]!)
    lineTo(a[0]!, a[1]!)
    return [contour(points, true)]
}

/**
 * A pointer of a ring: an arrow head, and a name for the head and the tail. Its place is its tip, on the
 * band. A film may scale, grow or turn a pointer, and each of these moves the pivot of a node to the middle
 * of its bounds. A pointer keeps its pivot at its tip. So it grows about the tip, and the tip stays on the
 * band while the pointer goes around.
 */
class Pointer extends Node {
    override pivotAt(_point: Vec): this {
        return this
    }
}

/**
 * A ring buffer: a band of slots, the entries in them, and two pointers. The producer writes an entry at the
 * tail with `push()`, and the consumer reads the entry at the head with `pop()`. The two indexes only move
 * forward, and the slot of an index is the index modulo the number of slots. It is the picture of the two
 * rings of io_uring, of a virtqueue, and of any bounded queue. `enter()` draws the band, then brings the
 * pointers and the caption. `.at()` places the center of the ring. The bounds of the ring hold the outside
 * name at every slot, so a zone or a card around a ring has room for it.
 */
export class RingBuffer extends Node {
    /** The outline of each slot. Slot 0 is at the top, and the slots follow clockwise. */
    readonly slots: Node[] = []
    /** The entry of each slot: its fill, its outline, and its label. Its opacity is 0 while the slot is empty. */
    readonly entries: Node[] = []
    /** The number beside each slot. The list is empty without `numbers`. */
    readonly numbers: Node[] = []
    /**
     * The arrow head and the name of each pointer, or null for a pointer whose name is null. Fade, scale, or
     * recolor a pointer as one node. Its place is its tip, and the ring moves it: do not move it.
     */
    readonly headPointer: Node | null
    readonly tailPointer: Node | null
    /** The dim arrow head at the place where the producer writes. Null without `tailFollows: 'publish'`. */
    readonly writeMarker: Node | null
    /** The text under the ring, or null for a ring with no `label`. */
    readonly caption: Node | null
    /** The number of slots. */
    readonly size: number
    /** The outer radius of the band, and the radial size of a slot. */
    readonly radius: number
    readonly thickness: number
    private headCount = 0
    private tailCount = 0
    /** For each slot, true while its entry is written and not published. */
    private unpublished: boolean[]
    private motion: Record<Kind, Motion>
    private readonly slotColor: ColorInput
    private readonly headName: string | null
    private readonly tailName: string | null
    private readonly outsideKind: 'head' | 'tail'
    private readonly follows: 'push' | 'publish'
    private readonly showCounts: boolean
    private readonly textSize: number
    private readonly font: TextOptions['font']
    /** The thickness and the label size that the film gave. Advice for another radius keeps them. */
    private readonly givenThickness: number | undefined
    private readonly givenLabelSize: number | undefined
    /** The width of the outline of a slot. */
    private readonly weight: number
    /** The length of the arrow head of a pointer. */
    private readonly tipLength: number
    /** The room between two parts that must not touch. */
    private readonly gap: number
    /** How far the ink of the outside name is from the center, at the least. */
    private readonly nameFrom: number
    /** How far the top of the capital letters of the caption is from the center. */
    private readonly captionTop: number
    private readonly labelSize: number
    /** The diameter of the circle that an upright label must fit in, and the width of the outline of a pending entry. */
    private readonly labelRoom: number
    private readonly edgeWidth: number

    constructor(slots: number, options: RingBufferOptions = {}) {
        super()
        if (!Number.isInteger(slots) || slots < 2 || slots > 64) throw new Error(`ringBuffer: a ring has 2 to 64 slots, a whole number. It got ${slots}`)
        const radius = options.radius ?? 170
        if (!(Number.isFinite(radius) && radius > 0)) throw new Error('ringBuffer: radius is the outer radius, more than 0')
        const thickness = options.thickness ?? radius * 0.32
        if (!(Number.isFinite(thickness) && thickness > 0 && thickness < radius)) throw new Error(`ringBuffer: thickness is the radial size of a slot, more than 0 and less than the radius of ${radius}`)
        const size = options.size ?? 26
        if (!(Number.isFinite(size) && size > 0)) throw new Error('ringBuffer: size is a text size, more than 0')
        this.size = slots
        this.radius = radius
        this.thickness = thickness
        this.givenThickness = options.thickness
        this.givenLabelSize = options.labelSize
        this.slotColor = options.color ?? 'blue'
        this.headName = options.head === undefined ? 'head' : options.head
        this.tailName = options.tail === undefined ? 'tail' : options.tail
        this.outsideKind = options.outside === 'tail' ? 'tail' : 'head'
        this.follows = options.tailFollows === 'publish' ? 'publish' : 'push'
        this.showCounts = options.counts ?? false
        this.textSize = size
        this.font = options.font
        this.tipLength = size * 0.62
        this.gap = size * 0.3
        this.unpublished = Array.from({ length: slots }, () => false)

        const { inner, weight, inset, edge, rim, labelRoom } = measures(slots, radius, thickness)
        this.weight = weight
        this.labelRoom = labelRoom
        this.edgeWidth = edge
        this.labelSize = options.labelSize ?? Math.min(size, thickness * LABEL)
        if (!(Number.isFinite(this.labelSize) && this.labelSize > 0)) throw new Error('ringBuffer: labelSize is a text size, more than 0')

        const half = Math.PI / slots
        for (let slot = 0; slot < slots; slot++) {
            const angle = this.angle(slot)
            const outline = new Node(sector(inner, radius, angle - half, angle + half)).stroke(this.slotColor, weight).fill('surface')
            this.slots.push(outline)
            // The fill is smaller than its slot, so two entries side by side read as two, and not as one arc.
            const fill = new Node(sector(inner + inset, radius - inset, angle - half, angle + half, inset)).fill(this.slotColor)
            // A pending entry has a dashed outline, which reads as "not yet there" in the color of the ring too.
            const dashed = new Node(sector(inner + rim, radius - rim, angle - half, angle + half, rim)).stroke(this.slotColor, edge).dash([edge * 2.4, edge * 2.6])
            this.entries.push(new Node().add(fill, dashed).opacity(0))
        }

        // From the band outward: the arrow head of the outside pointer, the numbers, then the outside name.
        const outsideName = this.outsideKind === 'head' ? this.headName : this.tailName
        let reach = this.outerEdge + (outsideName === null ? 0 : this.tipLength)
        if (options.numbers) {
            const from = reach + this.gap
            const inks = this.slots.map((_, slot) => measured(text(String(slot), { size: size * 0.7, font: this.font, color: 'dim' })))
            const places = inks.map((ink, slot) => {
                const angle = this.angle(slot), along = from + halfAlong(angle, ink.w, ink.h)
                reach = Math.max(reach, from + 2 * halfAlong(angle, ink.w, ink.h))
                return [Math.cos(angle) * along, Math.sin(angle) * along] as const
            })
            inks.forEach((ink, slot) => {
                const next = (slot + 1) % slots, other = inks[next]!
                const apart = Math.abs(places[slot]![0] - places[next]![0]) >= (ink.w + other.w) / 2 + 2 || Math.abs(places[slot]![1] - places[next]![1]) >= (ink.h + other.h) / 2 + 2
                if (!apart) throw new Error(`ringBuffer: the numbers of ${slots} slots touch each other around a ring of radius ${radius}. Raise radius, lower size, or leave out numbers`)
                this.numbers.push(ink.node.at(places[slot]![0] - ink.dx, places[slot]![1] - ink.dy))
            })
        }
        // A name beside a number reads as one phrase, such as "head 95 3". So the name keeps three gaps from the numbers.
        this.nameFrom = reach + this.gap * (options.numbers ? 3 : 1)

        // The place of the caption follows from the radius, the size, and whether the ring has numbers: the
        // room of the widest outline, an arrow head, numbers of two digits, and a name of 5 em by 1 em.
        const twoDigits = measured(text('88', { size: size * 0.7, font: this.font }))
        const nominal = radius + 2 + this.tipLength + this.gap + (options.numbers ? Math.hypot(twoDigits.w, twoDigits.h) * 1.15 + this.gap * 3 : 0)
        const captionGap = options.captionGap ?? sweep(nominal, size * 5, size)[1] + size * 0.5 - radius
        if (!(Number.isFinite(captionGap) && captionGap >= 0)) throw new Error('ringBuffer: captionGap is the distance from the band to the caption, 0 or more')
        this.captionTop = options.label ? radius + captionGap : Infinity

        // With counts, a name needs the room of a count of two digits from the start. A count of three
        // digits is checked when a pointer reaches it.
        const extent: [number, number] = [0, 0]
        for (const kind of ['head', 'tail'] as const) {
            const name = kind === 'head' ? this.headName : this.tailName
            if (name === null) continue
            const words = this.showCounts ? `${name} 88`.trim() : name
            const widest = measured(text(words, { size, font: this.font }))
            this.checkName(kind, words, widest)
            if (this.outsideKind === kind) [extent[0], extent[1]] = sweep(this.nameFrom, widest.w, widest.h)
        }
        // A shape with no paint. It gives the ring bounds that hold the outside name at every slot.
        if (extent[0] > 0) this.add(new Node(polyPath([[-extent[0], -extent[1]], [extent[0], -extent[1]], [extent[0], extent[1]], [-extent[0], extent[1]]], true)))
        this.add(...this.slots, ...this.entries, ...this.numbers)

        this.headPointer = this.headName === null ? null : this.pointer('head', options.headColor ?? this.slotColor)
        this.tailPointer = this.tailName === null ? null : this.pointer('tail', options.tailColor ?? this.slotColor)
        this.writeMarker = this.follows === 'publish' && this.tailPointer ? this.pointer('writer', options.tailColor ?? this.slotColor).opacity(0.5) : null
        this.motion = { head: this.settled('head', 0), tail: this.settled('tail', 0), writer: this.settled('writer', 0) }
        // The tail pointer is over the mark of the writer, and hides it while the two are at one slot.
        for (const pointer of [this.headPointer, this.writeMarker, this.tailPointer]) if (pointer) this.add(pointer)

        // `.at()` places a point near the middle of the capital letters. A capital letter gives how far its top is from that point.
        const capital = measured(text('H', { size, font: this.font }))
        this.caption = options.label ? text(options.label, { size, font: this.font, color: this.slotColor }).at(0, this.captionTop + capital.h / 2 - capital.dy) : null
        if (this.caption) this.add(this.caption)
    }

    /** The running index of the consumer: the number of entries that were read. Its slot is `head % size`. */
    get head(): number {
        return this.headCount
    }

    /** The running index of the producer: the number of entries that were written. Its slot is `tail % size`. */
    get tail(): number {
        return this.tailCount
    }

    /** The number of entries in the ring: `tail - head`. It is 0 for an empty ring, and `size` for a full ring. */
    get length(): number {
        return this.tailCount - this.headCount
    }

    /** The number of entries that are written and not published. */
    get pending(): number {
        return this.unpublished.filter(Boolean).length
    }

    /**
     * The middle of a slot in the coordinates of the ring, so that a film can fly an entry in from another
     * place. The slot wraps: `p(size)` is `p(0)`. A fraction gives a place between two slots.
     */
    p(slot: number): [number, number] {
        if (!Number.isFinite(slot)) throw new Error(`ringBuffer: p(${slot}) names no slot. Give it a number`)
        const angle = this.angle(slot), middle = this.radius - this.thickness / 2
        return [Math.cos(angle) * middle, Math.sin(angle) * middle]
    }

    /** A copy with its own entries and pointers, at rest in the state that the ring has now. */
    override clone(): this {
        const copy = super.clone()
        copy.unpublished = [...this.unpublished]
        copy.motion = { head: copy.settled('head', this.reached('head')), tail: copy.settled('tail', this.reached('tail')), writer: copy.settled('writer', this.reached('writer')) }
        return copy
    }

    /**
     * The producer writes at the tail. The slot at the tail fills, then the tail pointer moves one slot on.
     * With `counts`, the number beside the name changes when the pointer arrives. A `pending` entry is a
     * dashed outline with no fill until `publish()`. With `tailFollows: 'publish'`, the tail pointer stays
     * for a pending entry, and the mark of the writer moves.
     */
    push(entry: RingBufferEntry = {}, options: AnimOptions = {}): Anim {
        // Find a wrong color or a label that is too long now, where the film names it.
        const paint = toPaint(entry.color ?? this.slotColor)
        if (entry.label) this.labelled(entry.label, paint, entry.pending === true)
        return {
            label: 'ringBuffer.push', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                if (this.length >= this.size) throw new Error(`ringBuffer: the ring is full, ${this.length} of ${this.size} slots. pop() before the next push()`)
                const slot = this.tailCount % this.size
                const cell = this.entries[slot]!, fill = cell.children[0]!, dashed = cell.children[1]!
                const filled = this.tailPointer ? ctx.t0 + (ctx.t1 - ctx.t0) * 0.45 : ctx.t1
                // In one play with a pop of this slot, the entry that was read is still there. It leaves
                // in the first half of the time, as it is, and the new entry arrives in the second half.
                const from = sampleAt(cell, 'opacity', ctx.t0) > 0 ? (ctx.t0 + filled) / 2 : ctx.t0
                cell.tween('opacity', 0, ctx.t0, from, ctx.ease)
                // The slot is now of the new entry. What the timeline still held for the old one, which is
                // the rest of a `publish()`, must not fill the new one or take its outline away.
                const last = cell.children.length > 2 ? cell.children[cell.children.length - 1]! : null
                cut(fill, 'fillOpacity', from)
                cut(dashed, 'strokeOpacity', from)
                stepAt(fill, 'fill', paint, from)
                stepAt(fill, 'fillOpacity', entry.pending ? 0 : 1, from)
                // Only a pending entry shows its outline. Over a fill, the outline would show as a border while the entry fades.
                stepAt(dashed, 'stroke', paint, from)
                stepAt(dashed, 'strokeOpacity', entry.pending ? 1 : 0, from)
                // The label of the entry that was in this slot before is still a part of the ring. Hide it.
                if (last) stepAt(last, 'visible', false, from)
                if (entry.label) {
                    // With no fill under it, the label has the color of the entry. On a fill, it has the color of the background.
                    const [x, y] = this.p(slot), ink = this.labelled(entry.label, entry.pending ? paint : 'bg', entry.pending === true)
                    clock.now = from
                    cell.add(ink.node.at(x - ink.dx, y - ink.dy))
                }
                cell.tween('opacity', 1, from, filled, ctx.ease)
                if (this.follows === 'publish') {
                    this.advance('writer', filled, ctx.t1, ctx.ease)
                    // The tail is the index that the consumer reads. It cannot pass an entry that is not published.
                    if (!entry.pending && this.pending === 0) this.advance('tail', filled, ctx.t1, ctx.ease)
                } else {
                    this.advance('tail', filled, ctx.t1, ctx.ease)
                }
                this.unpublished[slot] = entry.pending === true
                this.tailCount += 1
            },
        }
    }

    /**
     * The producer publishes what it wrote: every pending entry fills. With a `lag`, the entries fill one
     * after another, from the oldest. With `tailFollows: 'publish'`, the tail pointer moves over them.
     */
    publish(options: AnimOptions = {}): Anim {
        return {
            label: 'ringBuffer.publish', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                const counts: number[] = []
                for (let count = this.headCount; count < this.tailCount; count++) if (this.unpublished[count % this.size]) counts.push(count)
                const windows = staggered(counts.length, Math.max(0, options.lag ?? 0), ctx.t0, ctx.t1)
                const ground = toPaint('bg')
                counts.forEach((count, index) => {
                    const [start, end] = windows[index]!
                    const cell = this.entries[count % this.size]!
                    cell.children[0]!.tween('fillOpacity', 1, start, end, ctx.ease)
                    stepAt(cell.children[1]!, 'strokeOpacity', 0, end)
                    // A label that fades from one color to the other is lost half way, when it has the
                    // color of what is under it. It changes at once when the fill is half there.
                    const label = cell.children.length > 2 ? cell.children[cell.children.length - 1]! : null
                    for (const glyph of label?.children ?? []) stepAt(glyph, 'fill', ground, start + (end - start) * halfway(ctx.ease))
                    this.unpublished[count % this.size] = false
                })
                if (this.follows !== 'publish' || !this.tailPointer) return
                // The tail goes over each entry in the time in which that entry fills. An entry that was
                // not pending has the time of the entry before it.
                let window: [number, number] = [ctx.t0, ctx.t1]
                for (let count = this.reached('tail'); count < this.tailCount; count++) {
                    window = windows[counts.indexOf(count)] ?? window
                    this.advance('tail', window[0], window[1], ctx.ease)
                }
            },
        }
    }

    /** The consumer reads at the head. The entry at the head empties, then the head pointer moves one slot on. */
    pop(options: AnimOptions = {}): Anim {
        return {
            label: 'ringBuffer.pop', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                if (this.length <= 0) throw new Error('ringBuffer: the ring is empty. push() before the next pop()')
                const slot = this.headCount % this.size
                if (this.unpublished[slot]) throw new Error('ringBuffer: the entry at the head is pending, so the consumer cannot see it. publish() before pop()')
                const emptied = this.headPointer ? ctx.t0 + (ctx.t1 - ctx.t0) * 0.45 : ctx.t1
                this.entries[slot]!.tween('opacity', 0, ctx.t0, emptied, ctx.ease)
                this.advance('head', emptied, ctx.t1, ctx.ease)
                this.headCount += 1
            },
        }
    }

    /** The band draws slot by slot, from slot 0. Then the pointers and the caption arrive. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'ringBuffer.enter', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                const windows = staggered(this.size, Math.max(0, options.lag ?? 0.5), ctx.t0, ctx.t0 + span * 0.7)
                const fade = (node: Node, start: number, end: number) => {
                    const opacity = sampleAt(node, 'opacity', ctx.t0)
                    // An empty slot has nothing to bring in.
                    if (opacity === 0) return
                    stepAt(node, 'opacity', 0, ctx.t0)
                    node.tween('opacity', opacity, start, end, ctx.ease)
                }
                this.slots.forEach((slot, index) => {
                    const [start, end] = windows[index]!
                    stepAt(slot, 'trimTo', 0, ctx.t0)
                    stepAt(slot, 'fillOpacity', 0, ctx.t0)
                    slot.tween('trimTo', 1, start, end, ctx.ease)
                    slot.tween('fillOpacity', 1, (start + end) / 2, end, ctx.ease)
                    fade(this.entries[index]!, (start + end) / 2, end)
                    if (this.numbers[index]) fade(this.numbers[index]!, start, end)
                })
                for (const part of [this.headPointer, this.tailPointer, this.writeMarker, this.caption]) if (part) fade(part, ctx.t0 + span * 0.65, ctx.t1)
            },
        }
    }

    /** The angle of the middle of a slot. Slot 0 is at the top, and y points down, so a larger angle is clockwise. */
    private angle(slot: number): number {
        return -Math.PI / 2 + (((slot % this.size) + this.size) % this.size) * ((Math.PI * 2) / this.size)
    }

    /** The outer and the inner edge of the ink of the band. A pointer touches the band there. */
    private get outerEdge(): number {
        return this.radius + this.weight / 2
    }

    private get innerEdge(): number {
        return this.radius - this.thickness - this.weight / 2
    }

    private pointerOf(kind: Kind): Node | null {
        return kind === 'head' ? this.headPointer : kind === 'tail' ? this.tailPointer : this.writeMarker
    }

    /** The mark of the writer is on the side of the tail. */
    private outsideOf(kind: Kind): boolean {
        return (kind === 'head') === (this.outsideKind === 'head')
    }

    /** The count that a pointer has after its moves: the slot where it is, or where it goes. */
    private reached(kind: Kind): number {
        return this.motion[kind].start + this.motion[kind].moves.length
    }

    /** A pointer: its arrow head, with its tip at the place of the pointer, and its name. */
    private pointer(kind: Kind, color: ColorInput): Pointer {
        // The arrow head points at the band: toward the center from outside, and away from it from inside.
        const base = this.outsideOf(kind) ? this.tipLength : -this.tipLength, side = this.tipLength * 0.55
        const made = new Pointer().add(new Node(polyPath([[0, 0], [base, -side], [base, side]], true)).fill(color))
        if (kind === 'writer') return made
        // The name is drawn again for each frame: the text changes with the count, and its place with the
        // angle. It finds its ring through its parents, so the name of a copy follows the copy.
        const name = new Node()
        name.draw = function (this: Node, time: number): Node {
            return (this.parent!.parent as RingBuffer).nameNow(kind, time)
        }
        return made.add(name)
    }

    /** A pointer at rest at the slot of a count, with no move on the timeline. */
    private settled(kind: Kind, count: number): Motion {
        const pointer = this.pointerOf(kind)
        if (!pointer) return { start: count, moves: [], names: [], keys: null }
        const [x, y, rotation] = this.tip(kind, count, 0)
        pointer.at(x, y).children[0]!.set('rotation', rotation)
        return { start: count, moves: [], names: kind === 'writer' ? [] : [this.nameText(kind, count)[1]], keys: null }
    }

    /** Where a pointer touches the band, and the angle of its arrow head, a part of a slot past the slot of a count. */
    private tip(kind: Kind, count: number, part: number): [number, number, number] {
        const angle = this.angle(count) + part * ((Math.PI * 2) / this.size)
        const edge = this.outsideOf(kind) ? this.outerEdge : this.innerEdge
        return [Math.cos(angle) * edge, Math.sin(angle) * edge, angle]
    }

    /** The name of a pointer as a text, with its count when the ring shows counts. */
    private nameText(kind: Kind, count: number): [string, Ink] {
        const name = (kind === 'head' ? this.headName : this.tailName)!
        const words = this.showCounts ? `${name} ${count}`.trim() : name
        return [words, measured(text(words, { size: this.textSize, font: this.font, color: 'ink' }))]
    }

    /**
     * A name must have room at every slot: inside the ring for the inside pointer, and over the caption
     * for the outside one. The message gives a radius, or a distance of the caption, that has the room.
     */
    private checkName(kind: 'head' | 'tail', words: string, ink: Ink): void {
        const digits = this.showCounts && words.endsWith(' 88') ? ' With counts, a name needs the room of a count of two digits, and "88" stands for it.' : ''
        if (this.outsideKind === kind) {
            const lowest = sweep(this.nameFrom, ink.w, ink.h)[1]
            if (lowest + this.gap > this.captionTop) throw new Error(`ringBuffer: the name ${JSON.stringify(words)} can reach the caption under the ring.${digits} Set captionGap to ${Math.ceil(lowest + this.textSize * 0.5 - this.radius)} or more, or use a shorter name`)
            return
        }
        // The inside name goes around the center with its pointer. It fits at every angle when its
        // diagonal fits across the inside of the ring, less one arrow head.
        const room = (radius: number) => {
            const thickness = this.givenThickness ?? radius * 0.32
            return 2 * (radius - thickness - measures(this.size, radius, thickness).weight / 2 - this.gap) - this.tipLength
        }
        const diagonal = Math.hypot(ink.w, ink.h)
        if (diagonal <= room(this.radius)) return
        const wide = Math.floor(Math.sqrt(Math.max(0, room(this.radius) ** 2 - ink.h * ink.h)))
        let larger = Math.ceil(this.radius / 10) * 10 + 10
        while (diagonal > room(larger)) larger += 10
        throw new Error(`ringBuffer: the name ${JSON.stringify(words)} is ${Math.ceil(ink.w)} px wide, and the inside of the ring has room for ${wide} px.${digits} Raise radius to ${larger}, or put this pointer outside with outside: '${kind}'`)
    }

    /**
     * The name of a pointer at a time: the text of its count, upright, at its place for the angle of the
     * pointer, in the color that the arrow head has. The place is from the tip, as the name is a part of
     * the pointer. It writes the place straight into the text. A setter would record a change when a film
     * measures the ring inside `to()`.
     */
    private nameNow(kind: Kind, time: number): Node {
        const motion = this.motion[kind]
        const { whole, part } = travelled(motion.moves, time)
        // The count is the number of whole slots that the pointer has passed. So it changes when the pointer
        // arrives at a slot, also while moves that share time carry it past several slots.
        const ink = motion.names[this.showCounts ? Math.min(motion.names.length - 1, Math.floor(whole + part + 1e-9)) : 0]!
        const [tipX, tipY, angle] = this.tip(kind, motion.start + whole, part)
        const [x, y] = this.namePlace(this.outsideOf(kind), angle, ink)
        ink.node.base.x = x - tipX
        ink.node.base.y = y - tipY
        const paint = this.pointerOf(kind)!.children[0]!.get('fill')
        if (paint) for (const glyph of ink.node.children) glyph.base.fill = paint
        return ink.node
    }

    /**
     * The label of an entry as a text. A label that is too wide is set smaller, down to 0.6 of its size, as
     * the title of a card is. A label that is still too wide is an error, which says what fits. The label
     * of a pending entry has less room, by the outline on each side: it is as far from that outline as the
     * label of a filled entry is from the edge of the fill.
     */
    private labelled(label: string, color: ColorInput, pending: boolean): Ink {
        // A heavy weight keeps the label readable on a fill.
        const made = (size: number) => measured(text(label, { size, font: this.font, weight: 600, color }))
        const taken = pending ? 2 * 0.82 : 0
        const room = this.labelRoom - taken * this.edgeWidth
        const full = made(this.labelSize)
        const diagonal = Math.hypot(full.w, full.h)
        if (diagonal <= room) return full
        if (diagonal * 0.6 <= room) return made(this.labelSize * room / diagonal)
        // Three ways to get room, each with a number that was tried. More thickness is not one of them: in a
        // ring of many slots it makes a slot narrower.
        const each = diagonal / this.labelSize
        const fits = (slots: number, radius: number) => {
            const thickness = this.givenThickness ?? radius * 0.32, sizes = measures(slots, radius, thickness)
            return (this.givenLabelSize ?? Math.min(this.textSize, thickness * LABEL)) * 0.6 * each <= sizes.labelRoom - taken * sizes.edge
        }
        const ways: string[] = []
        if (room / each >= 1) ways.push(`labelSize: ${Math.floor(room / each)}`)
        let fewer = this.size - 1
        while (fewer >= 2 && !fits(fewer, this.radius)) fewer -= 1
        if (fewer >= 2) ways.push(`${fewer} slots`)
        let larger = Math.ceil(this.radius / 10) * 10 + 10
        while (larger <= this.radius * 8 && !fits(this.size, larger)) larger += 10
        if (larger <= this.radius * 8) ways.push(`radius: ${larger}`)
        const wide = Math.floor(Math.sqrt(Math.max(0, room * Math.abs(room) - (full.h * 0.6) ** 2)))
        throw new Error(`ringBuffer: the label ${JSON.stringify(label)} does not fit in a slot. At ${Math.round(this.labelSize * 6) / 10} px, its smallest size, it is ${Math.ceil(full.w * 0.6)} px wide, and a slot has room for ${wide} px. It fits ${ways.map((way) => `with ${way}`).join(', or ')}${ways.length ? ', or' : ''} as a shorter label`)
    }

    /**
     * Where `.at()` puts a name, for a pointer at an angle. The name is upright, so the room that it takes
     * along the pointer changes with the angle. Its nearest ink stays one gap away from the arrow head.
     */
    private namePlace(outside: boolean, angle: number, ink: Ink): [number, number] {
        const half = halfAlong(angle, ink.w, ink.h)
        let far: number
        if (outside) {
            far = this.nameFrom + half
        } else {
            // A long name does not fit near the band, where the inside is narrow. It moves toward the center
            // until its corners are one gap inside the band.
            const room = this.innerEdge - this.gap
            const fits = Math.sqrt(Math.max(0, room * room + half * half - (ink.w * ink.w + ink.h * ink.h) / 4)) - half
            far = Math.min(this.innerEdge - this.tipLength - this.gap - half, fits)
        }
        return [Math.cos(angle) * far - ink.dx, Math.sin(angle) * far - ink.dy]
    }

    /**
     * A pointer moves one slot on, along the band. The pointer has one key for each of its x and its y, and
     * its arrow head has one for its rotation. A key reads every move of the pointer, as the name does. So
     * moves that share time add up, and the arrow head and the name stay together at every frame. At rest,
     * the pointer is exactly at the middle of its slot, after any number of turns.
     */
    private advance(kind: Kind, t0: number, t1: number, ease: Ease): void {
        const pointer = this.pointerOf(kind)
        if (!pointer) return
        const motion = this.motion[kind], count = this.reached(kind) + 1
        const owner = (index: number) => (index === 2 ? pointer.children[0]! : pointer)
        motion.moves.push({ t0, t1, ease })
        if (kind !== 'writer' && this.showCounts) {
            const [words, ink] = this.nameText(kind, count)
            // The name had the room of two digits from the start. A third digit, and each one after it, is checked here.
            if (count >= 100) this.checkName(kind, words, ink)
            motion.names[count - motion.start] = ink
        }
        if (!motion.keys) {
            motion.keys = KEYED.map((prop, index) => {
                // A key gets its progress, not the time. With no ease of its own, the progress gives the time back.
                const key: Key<number> = { t0, t1, ease: null, to: 0, at: (progress) => {
                    const { whole, part } = travelled(motion.moves, key.t0 + progress * (key.t1 - key.t0))
                    return this.tip(kind, motion.start + whole, part)[index]!
                } }
                owner(index).track(prop).add(key)
                return key
            })
        }
        const rest = this.tip(kind, count, 0)
        motion.keys.forEach((key, index) => {
            key.t1 = Math.max(key.t1, t1)
            key.to = rest[index]!
            // A move that is scheduled later can start sooner, as the faster of two pushes in one play. The
            // key starts with the first move. It is the one key of its track, so the track stays in order.
            key.t0 = Math.min(key.t0, t0)
        })
    }
}

/** A ring buffer with a head and a tail: `ringBuffer(8, { label: 'submission queue', color: 'blue' })`. `push()` writes at the tail, and `pop()` reads at the head. */
export function ringBuffer(slots: number, options: RingBufferOptions = {}): RingBuffer {
    return new RingBuffer(slots, options)
}
