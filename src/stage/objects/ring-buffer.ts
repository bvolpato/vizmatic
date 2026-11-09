import { Node } from '../node'
import { arcPath, polyPath, ring as contour, type Path } from '../geometry'
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
    /** Text size of the caption and the pointer names. Defaults to 26. */
    size?: number
    /**
     * Text size of the label of an entry. A label that is too wide for its slot is set smaller, down to 0.6
     * of this size. Defaults to 0.3 of `thickness`, and to `size` at the most. With the default thickness, a
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
    /** The entry is written and not yet published: an outline with no fill. `publish()` fills it. */
    pending?: boolean
}

type Kind = 'head' | 'tail'

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
    /** The keys of the x, the y and the rotation of the arrow head. Null before the first move. */
    keys: Key<number>[] | null
}

function measured(node: Node): Ink {
    const box = node.bounds()
    return { node, w: box.width, h: box.height, dx: box.x + box.width / 2, dy: box.y + box.height / 2 }
}

/** Half of the room that an upright box takes along a direction. */
function halfAlong(angle: number, w: number, h: number): number {
    return (Math.abs(Math.cos(angle)) * w + Math.abs(Math.sin(angle)) * h) / 2
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
 * A ring buffer: a band of slots, the entries in them, and two pointers. The producer writes an entry at the
 * tail with `push()`, and the consumer reads the entry at the head with `pop()`. The two indexes only move
 * forward, and the slot of an index is the index modulo the number of slots. It is the picture of the two
 * rings of io_uring, of a virtqueue, and of any bounded queue. `enter()` draws the band, then brings the
 * pointers and the caption. `.at()` places the center of the ring.
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
     * recolor a pointer as one node. The ring moves the parts inside it.
     */
    readonly headPointer: Node | null
    readonly tailPointer: Node | null
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
    private readonly outsideKind: Kind
    private readonly showCounts: boolean
    private readonly textSize: number
    private readonly font: TextOptions['font']
    /** The width of the outline of a slot. */
    private readonly weight: number
    /** The length of the arrow head of a pointer. */
    private readonly tipLength: number
    /** The room between two parts that must not touch. */
    private readonly gap: number
    /** How far the ink of the outside name is from the center, at the least. */
    private readonly nameFrom: number
    private readonly labelSize: number
    /** The diameter of the circle that fits in the fill of every slot. An upright label must fit in it. */
    private readonly labelRoom: number

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
        this.slotColor = options.color ?? 'blue'
        this.headName = options.head === undefined ? 'head' : options.head
        this.tailName = options.tail === undefined ? 'tail' : options.tail
        this.outsideKind = options.outside === 'tail' ? 'tail' : 'head'
        this.showCounts = options.counts ?? false
        this.textSize = size
        this.font = options.font
        this.tipLength = size * 0.62
        this.gap = size * 0.3
        this.unpublished = Array.from({ length: slots }, () => false)

        const inner = radius - thickness, middle = radius - thickness / 2
        // The width of a slot at its narrow end. The outline and the room around the fill stay small beside it.
        const chord = 2 * inner * Math.sin(Math.PI / slots)
        this.weight = Math.max(1.5, Math.min(4, radius * 0.0175, chord * 0.2))
        const inset = Math.min(this.weight / 2 + 3, chord * 0.22, thickness * 0.22)
        const rim = Math.min(inset + this.weight / 2, chord * 0.3, thickness * 0.3)
        this.labelSize = options.labelSize ?? Math.min(size, thickness * 0.3)
        if (!(Number.isFinite(this.labelSize) && this.labelSize > 0)) throw new Error('ringBuffer: labelSize is a text size, more than 0')
        // A label keeps a margin to the edge of its fill, where a text in the color of the background is lost.
        this.labelRoom = (Math.min(thickness, 2 * middle * Math.sin(Math.PI / slots)) - 2 * inset) * 0.82

        const half = Math.PI / slots
        for (let slot = 0; slot < slots; slot++) {
            const angle = this.angle(slot)
            const outline = new Node(sector(inner, radius, angle - half, angle + half)).stroke(this.slotColor, this.weight).fill('surface')
            this.slots.push(outline)
            // The fill is smaller than its slot, so two entries side by side read as two, and not as one arc.
            const fill = new Node(sector(inner + inset, radius - inset, angle - half, angle + half, inset)).fill(this.slotColor)
            // The outline of a pending entry is inside the edge of the fill. So the entry keeps its size when it fills.
            const edge = new Node(sector(inner + rim, radius - rim, angle - half, angle + half, rim)).stroke(this.slotColor, this.weight)
            this.entries.push(new Node().add(fill, edge).opacity(0))
        }
        this.add(...this.slots, ...this.entries)

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
            this.add(...this.numbers)
        }
        this.nameFrom = reach + this.gap

        this.headPointer = this.pointer('head', options.headColor ?? this.slotColor)
        this.tailPointer = this.pointer('tail', options.tailColor ?? this.slotColor)
        this.motion = { head: this.settled('head'), tail: this.settled('tail') }
        for (const pointer of [this.headPointer, this.tailPointer]) if (pointer) this.add(pointer)

        this.caption = null
        if (options.label) {
            let under = reach
            if (outsideName !== null) {
                // A name beside the bottom of the ring reaches lower than a name at the bottom. Keep the
                // caption under the lowest one. The room is that of a name of 5 em or less, with a count of
                // three digits, so that the captions of two rings with different names stay on one line.
                const widest = measured(text(this.showCounts ? `${outsideName} 888` : outsideName, { size, font: this.font }))
                const w = Math.max(widest.w, size * 5), h = Math.max(widest.h, size)
                for (let step = 0; step <= 90; step++) {
                    const angle = (step / 180) * Math.PI
                    under = Math.max(under, (this.nameFrom + halfAlong(angle, w, h)) * Math.sin(angle) + h / 2)
                }
            }
            // `.at()` places the middle of the capital letters, which are 0.72 of the size tall.
            this.caption = text(options.label, { size, font: this.font, color: this.slotColor }).at(0, under + size * (0.5 + 0.36))
            this.add(this.caption)
        }
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
        copy.motion = { head: copy.settled('head'), tail: copy.settled('tail') }
        return copy
    }

    /**
     * The producer writes at the tail. The slot at the tail fills, then the tail pointer moves one slot on.
     * With `counts`, the number beside the name changes when the pointer arrives. A `pending` entry is an
     * outline with no fill until `publish()`. The tail pointer moves for it too.
     */
    push(entry: RingBufferEntry = {}, options: AnimOptions = {}): Anim {
        // Find a wrong color or a label that is too long now, where the film names it.
        const paint = toPaint(entry.color ?? this.slotColor)
        if (entry.label) this.labelled(entry.label, paint)
        return {
            label: 'ringBuffer.push', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                if (this.length >= this.size) throw new Error(`ringBuffer: the ring is full, ${this.length} of ${this.size} slots. pop() before the next push()`)
                const slot = this.tailCount % this.size
                const cell = this.entries[slot]!
                const filled = this.tailPointer ? ctx.t0 + (ctx.t1 - ctx.t0) * 0.45 : ctx.t1
                stepAt(cell.children[0]!, 'fill', paint, ctx.t0)
                stepAt(cell.children[0]!, 'fillOpacity', entry.pending ? 0 : 1, ctx.t0)
                // Only a pending entry shows its outline. Over a fill, the outline would show as a border while the entry fades.
                stepAt(cell.children[1]!, 'stroke', paint, ctx.t0)
                stepAt(cell.children[1]!, 'strokeOpacity', entry.pending ? 1 : 0, ctx.t0)
                // The label of the entry that was in this slot before is still a part of the ring. Hide it.
                if (cell.children.length > 2) stepAt(cell.children[cell.children.length - 1]!, 'visible', false, ctx.t0)
                if (entry.label) {
                    // With no fill under it, the label has the color of the entry. On a fill, it has the color of the background.
                    const [x, y] = this.p(slot), ink = this.labelled(entry.label, entry.pending ? paint : 'bg')
                    clock.now = ctx.t0
                    cell.add(ink.node.at(x - ink.dx, y - ink.dy))
                }
                // A pop in the same `par` may still fade this slot out. The new entry starts from nothing.
                stepAt(cell, 'opacity', 0, ctx.t0)
                cell.tween('opacity', 1, ctx.t0, filled, ctx.ease)
                this.advance('tail', filled, ctx.t1, ctx.ease)
                this.unpublished[slot] = entry.pending === true
                this.tailCount += 1
            },
        }
    }

    /**
     * The producer publishes what it wrote: every pending entry fills. With a `lag`, the entries fill one
     * after another, from the oldest.
     */
    publish(options: AnimOptions = {}): Anim {
        return {
            label: 'ringBuffer.publish', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                const slots: number[] = []
                for (let count = this.headCount; count < this.tailCount; count++) if (this.unpublished[count % this.size]) slots.push(count % this.size)
                const windows = staggered(slots.length, Math.max(0, options.lag ?? 0), ctx.t0, ctx.t1)
                const ground = toPaint('bg')
                slots.forEach((slot, index) => {
                    const [start, end] = windows[index]!
                    const cell = this.entries[slot]!
                    cell.children[0]!.tween('fillOpacity', 1, start, end, ctx.ease)
                    stepAt(cell.children[1]!, 'strokeOpacity', 0, end)
                    const label = cell.children.length > 2 ? cell.children[cell.children.length - 1]! : null
                    for (const glyph of label?.children ?? []) glyph.tween('fill', ground, start, end, ctx.ease)
                    this.unpublished[slot] = false
                })
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
                for (const part of [this.headPointer, this.tailPointer, this.caption]) if (part) fade(part, ctx.t0 + span * 0.65, ctx.t1)
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

    /**
     * A pointer: its arrow head, then its name. The film may scale or fade the pointer, which changes its
     * own place. So the pointer itself stays where it is, and the two parts inside it move.
     */
    private pointer(kind: Kind, color: ColorInput): Node | null {
        if ((kind === 'head' ? this.headName : this.tailName) === null) return null
        // The arrow head points at the band: toward the center from outside, and away from it from inside.
        const base = this.outsideKind === kind ? this.tipLength : -this.tipLength, side = this.tipLength * 0.55
        const arrow = new Node(polyPath([[0, 0], [base, -side], [base, side]], true)).fill(color)
        // The name is drawn again for each frame: the text changes with the count, and its place with the
        // angle. It finds its ring through its parents, so the name of a copy follows the copy.
        const name = new Node()
        name.draw = function (this: Node, time: number): Node {
            return (this.parent!.parent as RingBuffer).nameNow(kind, time)
        }
        return new Node().add(arrow, name)
    }

    /** A pointer at rest at its slot, with no move on the timeline. */
    private settled(kind: Kind): Motion {
        const pointer = kind === 'head' ? this.headPointer : this.tailPointer
        const count = kind === 'head' ? this.headCount : this.tailCount
        if (!pointer) return { start: count, moves: [], names: [], keys: null }
        const [x, y, rotation] = this.tip(kind, count, 0)
        pointer.children[0]!.at(x, y).set('rotation', rotation)
        return { start: count, moves: [], names: [this.nameText(kind, count)], keys: null }
    }

    /** Where a pointer touches the band, and the angle of its arrow head, a part of a slot past the slot of a count. */
    private tip(kind: Kind, count: number, part: number): [number, number, number] {
        const angle = this.angle(count) + part * ((Math.PI * 2) / this.size)
        const edge = this.outsideKind === kind ? this.outerEdge : this.innerEdge
        return [Math.cos(angle) * edge, Math.sin(angle) * edge, angle]
    }

    /** The name of a pointer as a text, with its count when the ring shows counts. */
    private nameText(kind: Kind, count: number): Ink {
        const name = (kind === 'head' ? this.headName : this.tailName)!
        const words = this.showCounts ? `${name} ${count}`.trim() : name
        const ink = measured(text(words, { size: this.textSize, font: this.font, color: 'ink' }))
        if (this.outsideKind !== kind) {
            // The inside name goes around the center with its pointer. It fits at every angle when its
            // diagonal fits across the inside of the ring, less one arrow head.
            const room = 2 * (this.innerEdge - this.gap) - this.tipLength
            if (Math.hypot(ink.w, ink.h) > room) {
                const wide = Math.floor(Math.sqrt(Math.max(0, room * room - ink.h * ink.h)))
                throw new Error(`ringBuffer: the name ${JSON.stringify(words)} is ${Math.ceil(ink.w)} px wide, and the inside of the ring has room for ${wide} px. Raise radius, or put this pointer outside with outside: '${kind}'`)
            }
        }
        return ink
    }

    /**
     * The name of a pointer at a time: the text of its count, upright, at its place for the angle of the
     * pointer, in the color that the arrow head has. It writes the place straight into the text. A setter
     * would record a change when a film measures the ring inside `to()`.
     */
    private nameNow(kind: Kind, time: number): Node {
        const motion = this.motion[kind], pointer = (kind === 'head' ? this.headPointer : this.tailPointer)!
        const { whole, part } = travelled(motion.moves, time)
        // The count is the number of whole slots that the pointer has passed. So it changes when the pointer
        // arrives at a slot, also while moves that share time carry it past several slots.
        const ink = motion.names[this.showCounts ? Math.min(motion.names.length - 1, Math.floor(whole + part + 1e-9)) : 0]!
        const [x, y] = this.namePlace(this.outsideKind === kind, this.tip(kind, motion.start + whole, part)[2], ink)
        ink.node.base.x = x
        ink.node.base.y = y
        const paint = pointer.children[0]!.get('fill')
        if (paint) for (const glyph of ink.node.children) glyph.base.fill = paint
        return ink.node
    }

    /**
     * The label of an entry as a text. A label that is too wide is set smaller, down to 0.6 of its size, as
     * the title of a card is. A label that is still too wide is an error.
     */
    private labelled(label: string, color: ColorInput): Ink {
        // A heavy weight keeps the label readable on a fill.
        const made = (size: number) => measured(text(label, { size, font: this.font, weight: 600, color }))
        const full = made(this.labelSize)
        const scale = this.labelRoom / Math.hypot(full.w, full.h)
        if (scale >= 1) return full
        if (scale < 0.6) {
            const wide = Math.floor(Math.sqrt(Math.max(0, this.labelRoom * this.labelRoom - (full.h * 0.6) ** 2)))
            throw new Error(`ringBuffer: the label ${JSON.stringify(label)} does not fit in a slot. At its smallest size it is ${Math.ceil(full.w * 0.6)} px wide, and a slot has room for ${wide} px. Use a shorter label, or raise thickness`)
        }
        return made(this.labelSize * scale)
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
     * A pointer moves one slot on, along the band. The arrow head has one key for each of its x, its y and
     * its rotation. The key reads every move of the pointer, so that moves that share time add up. At rest,
     * the pointer is exactly at the middle of its slot, after any number of turns.
     */
    private advance(kind: Kind, t0: number, t1: number, ease: Ease): void {
        const pointer = kind === 'head' ? this.headPointer : this.tailPointer
        if (!pointer) return
        const motion = this.motion[kind], arrow = pointer.children[0]!
        const count = (kind === 'head' ? this.headCount : this.tailCount) + 1
        motion.moves.push({ t0, t1, ease })
        if (this.showCounts) motion.names[count - motion.start] = this.nameText(kind, count)
        if (!motion.keys) {
            motion.keys = (['x', 'y', 'rotation'] as const).map((prop, index) => {
                // A key gets its progress, not the time. With no ease of its own, the progress gives the time back.
                const key: Key<number> = { t0, t1, ease: null, to: 0, at: (progress) => {
                    const { whole, part } = travelled(motion.moves, key.t0 + progress * (key.t1 - key.t0))
                    return this.tip(kind, motion.start + whole, part)[index]!
                } }
                arrow.track(prop).add(key)
                return key
            })
        }
        const rest = this.tip(kind, count, 0)
        motion.keys.forEach((key, index) => {
            key.t1 = Math.max(key.t1, t1)
            key.to = rest[index]!
        })
    }
}

/** A ring buffer with a head and a tail: `ringBuffer(8, { label: 'submission queue', color: 'blue' })`. `push()` writes at the tail, and `pop()` reads at the head. */
export function ringBuffer(slots: number, options: RingBufferOptions = {}): RingBuffer {
    return new RingBuffer(slots, options)
}
