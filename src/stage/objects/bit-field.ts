import { Node } from '../node'
import { linePath, type Bounds, type Path, type Ring } from '../geometry'
import { rect } from '../shapes'
import { text, type TextOptions } from '../text'
import type { ColorInput } from '../color'
import type { Anim, AnimOptions } from '../anim'
import { reveal, staggered, stepAt } from './util'

export interface BitFieldPart {
    /** How many bits (or bytes) the field has. A whole number, 1 or more. */
    bits: number
    /** The name of the field, on one line. */
    label?: string
    /**
     * The content of the field, such as '0x1fe' or '1', on one line. Drawn in mono inside the box. The label
     * then goes under the box. An empty text is a value too: an empty box that `setValue()` can fill.
     */
    value?: string
    /** Defaults to the `color` of the object. */
    color?: ColorInput
    /** A field that carries nothing, such as reserved bits: a faint box with a hatch. */
    unused?: boolean
}

export interface BitFieldOptions {
    /** The width of one row: of all fields together, or of `wrap` bits. Defaults to 1200. */
    width?: number
    /** The height of the boxes. Defaults to 2.6 of `size`. */
    height?: number
    /** 'proportional' gives each field a width for its bits. 'even' gives every field of a row the same width. Defaults to proportional. */
    scale?: 'proportional' | 'even'
    /** The least width of a field, so that a field of one bit can hold a name. The wider fields share the rest. Defaults to 0. */
    minWidth?: number
    /**
     * How many bits (or bytes) one row holds. The fields then fill rows from the top, for the layout of a
     * structure. A field that would cross the end of a row is an error. Without it, all fields are in one row.
     */
    wrap?: number
    /** The room between two rows. Defaults to the room that the numbers and the labels under the boxes need, and a little more. */
    rowGap?: number
    /**
     * What to write over the boxes. 'bits' numbers the bits from the right, with the highest bit at the left,
     * such as 63, 48, 47, 39. 'offsets' counts up from 0 at the left, for the bytes of a structure. False
     * writes nothing. Defaults to 'bits'.
     */
    numbers?: 'bits' | 'offsets' | false
    /** Text size of the labels and values. The numbers are smaller. Defaults to 26. */
    size?: number
    /** The color of a field that has none of its own. Defaults to blue. */
    color?: ColorInput
    /** The font of the labels. The values and the numbers are in mono. */
    font?: TextOptions['font']
}

// The smallest text of a field, as a part of `size`. A text that needs less is an error, because nobody can read it.
const TEXT_FLOOR = 0.6
// The size of the numbers over the boxes, as a part of `size`.
const NUMBER_SIZE = 0.7
// The room between a text and the border of its box, at each side, as a part of `size`.
const PAD = 0.45
// When two numbers would meet, the one of the lower rank goes: the number of a field of one bit goes before a
// number of a wider field. Three numbers go last: bit 0, the offset at the start of a row, and the total. Of
// two numbers of one rank, the one at the right goes, so a low bit goes before the high bit of its field.
const ONE = 1, WIDE = 2, END = 3

interface NumberMark {
    node: Node
    field: number
    row: number
    /** The two ends of the ink of the number. */
    from: number
    to: number
    rank: number
}

/** A run of columns that one field takes: from the first one up to, and not with, the last. */
type Run = readonly [number, number]

/**
 * The share of each column of a row: in proportion to its bits, where every field has `least` or more. The
 * rows have their columns in common, so a bit has one place in all rows. Null when the fields cannot fit.
 */
function share(bits: readonly number[], runs: readonly Run[], room: number, least: number): number[] | null {
    const fixed: (number | null)[] = bits.map(() => null)
    const over = (run: Run, of: (column: number) => number) => {
        let sum = 0
        for (let column = run[0]; column < run[1]; column++) sum += of(column)
        return sum
    }
    // The fields with the fewest bits come first. A wider field, over them in another row, then finds their
    // columns set, and it is as wide as they are together or wider.
    const order = [...runs].sort((a, b) => over(a, (column) => bits[column]!) - over(b, (column) => bits[column]!))
    for (;;) {
        const taken = fixed.reduce<number>((sum, own) => sum + (own ?? 0), 0)
        const free = bits.reduce((sum, own, column) => sum + (fixed[column] === null ? own : 0), 0)
        const each = free > 0 ? (room - taken) / free : 0
        const own = (column: number) => fixed[column] ?? bits[column]! * each
        // A field that takes the least width leaves less for the others, so one of them can become too narrow in turn.
        const narrow = order.find((run) => over(run, own) < least - 1e-9 && over(run, (column) => (fixed[column] === null ? 1 : 0)) > 0)
        if (!narrow) {
            if (free === 0 && taken > room + 1e-9) return null
            return bits.map((_, column) => own(column))
        }
        const have = over(narrow, (column) => fixed[column] ?? 0), open = over(narrow, (column) => (fixed[column] === null ? bits[column]! : 0))
        for (let column = narrow[0]; column < narrow[1]; column++) {
            if (fixed[column] === null) fixed[column] = ((least - have) * bits[column]!) / open
        }
    }
}

/** Diagonal lines over a box. They stop around `clear`, so that no line crosses a text. */
function hatch(box: Bounds, step: number, clear: Bounds | null): Path {
    const right = box.x + box.width, bottom = box.y + box.height
    const rings: Ring[] = []
    // A line holds the points where x + y is one sum. The sums are multiples of the step, so that the lines
    // of two boxes are parts of one pattern.
    for (let sum = Math.ceil((box.x + box.y) / step) * step; sum < right + bottom; sum += step) {
        const from = Math.max(box.x, sum - bottom), to = Math.min(right, sum - box.y)
        const cut = clear ? [Math.max(clear.x, sum - clear.y - clear.height), Math.min(clear.x + clear.width, sum - clear.y)] as const : null
        const runs = cut && cut[0] < cut[1] ? [[from, Math.min(to, cut[0])], [Math.max(from, cut[1]), to]] as const : [[from, to]] as const
        for (const [a, b] of runs) {
            if (b - a > 1) rings.push(...linePath([a, sum - a], [b, sum - b]))
        }
    }
    return rings
}

/**
 * A word split into named fields: a row of boxes, one per field, with the bit numbers over them. It shows
 * a virtual address as its table indexes, the flags of a register, or the layout of a structure by byte
 * offset. The first field is at the left. With `wrap`, the fields fill rows from the top. `.at()` places the
 * middle of a full row, and of all rows from the top to the bottom. A field shows its label inside its box. A
 * field with a `value` shows the value inside and the label under the box, and `setValue()` changes the value
 * in place. `field('PTE')` is the node of one field, to light it, and `p('PTE')` is a point on its box.
 */
export class BitField extends Node {
    /** One node per field, which holds its box, its texts and its numbers. The first field is at the left. */
    readonly fields: Node[] = []
    readonly boxes: Node[] = []
    /** The name of each field, or null for a field that has none. */
    readonly labels: (Node | null)[] = []
    /** The content that each field shows now, or null for a field that has none. `setValue()` replaces the node. */
    readonly values: (Node | null)[] = []
    /** The numbers over the boxes, row by row, from the left to the right. Each one is also a part of its field. */
    readonly numbers: Node[] = []
    /** The sum of the bits of all fields. */
    readonly total: number
    /** The label and the value that each field was built with. */
    private readonly texts: { label?: string; value?: string }[]
    /** The left and the right edge of each box, and the middle of its row. */
    private readonly places: { left: number; right: number; y: number }[] = []
    private readonly ranges: [number, number][]
    private readonly half: number
    private readonly size: number
    private readonly font: TextOptions['font']
    /** The lines of each unused field. A new value changes the hole in them. */
    private readonly hatches: (Node | null)[] = []
    /** The color of the text in each box. */
    private readonly inks: ColorInput[] = []
    /** The width that an even scale would give each field, for the message of a text that does not fit. 0 with an even scale. */
    private readonly evens: number[] = []
    /** True when every field can have this least width. Always false with an even scale, which has no use for one. */
    private readonly canHave: (least: number) => boolean

    constructor(parts: readonly BitFieldPart[], options: BitFieldOptions = {}) {
        super()
        if (parts.length === 0) throw new Error('bitField: give it at least one field')
        this.texts = parts.map((part) => ({ label: part.label, value: part.value }))
        parts.forEach((part, index) => {
            if (!Number.isInteger(part.bits) || part.bits < 1) throw new Error(`bitField: ${this.nameOf(index)} has ${part.bits} bits. A field has a whole number of bits, 1 or more`)
            this.checked(index, 'label', part.label)
            this.checked(index, 'value', part.value)
        })
        const size = this.size = options.size ?? 26
        if (!(Number.isFinite(size) && size > 0)) throw new Error('bitField: size is a text size, more than 0')
        const width = options.width ?? 1200
        if (!(Number.isFinite(width) && width > 0)) throw new Error('bitField: width is the width of one row of fields, more than 0')
        const height = options.height ?? size * 2.6
        // A lower box has no room over and under a text of this size.
        if (!(Number.isFinite(height) && height >= size * 1.5)) throw new Error(`bitField: height is the height of the boxes. A text of size ${size} needs a height of ${Math.ceil(size * 1.5)} or more`)
        const scale = options.scale ?? 'proportional'
        if (scale !== 'proportional' && scale !== 'even') throw new Error(`bitField: scale is 'proportional' or 'even', not ${JSON.stringify(scale)}`)
        const numbers = options.numbers ?? 'bits'
        if (numbers !== 'bits' && numbers !== 'offsets' && numbers !== false) throw new Error(`bitField: numbers is 'bits', 'offsets' or false, not ${JSON.stringify(numbers)}`)
        const least = options.minWidth ?? 0
        if (!(Number.isFinite(least) && least >= 0)) throw new Error('bitField: minWidth is the least width of a field, 0 or more')
        const wrap = options.wrap
        if (wrap !== undefined && (!Number.isInteger(wrap) || wrap < 1)) throw new Error('bitField: wrap is the number of bits in one row, a whole number, 1 or more')
        const rowGap = options.rowGap
        if (rowGap !== undefined && !(Number.isFinite(rowGap) && rowGap >= 0)) throw new Error('bitField: rowGap is the room between two rows, 0 or more')
        this.font = options.font

        // The fields of each row, and the bit of its row at which each field starts. Without `wrap`, one row
        // holds all fields.
        const unit = numbers === 'offsets' ? 'byte' : 'bit'
        const rows: number[][] = []
        const starts: number[] = []
        let used = 0
        parts.forEach((part, index) => {
            if (index === 0 || used === wrap) {
                rows.push([])
                used = 0
            }
            if (wrap !== undefined && used + part.bits > wrap) throw new Error(`bitField: ${this.nameOf(index)} has ${part.bits} ${unit}s and starts at ${unit} ${used} of a row of ${wrap}, so it crosses the end of the row. Split it into two fields, or change wrap`)
            rows[rows.length - 1]!.push(index)
            starts.push(used)
            used += part.bits
        })
        this.total = parts.reduce((sum, part) => sum + part.bits, 0)

        const border = Math.max(2, size * 0.1)
        // The room between two boxes, from the middle of one border to the middle of the next.
        const gap = border + size * 0.12
        // A box and the gap after it are the share of the field, in a row that is one gap longer than the width.
        const room = width + gap
        const edges: [number, number][] = []
        const plural = (count: number) => `${count} field${count === 1 ? '' : 's'}`
        if (scale === 'even') {
            // Every field of a row has one share of the row, also in a last row with fewer bits.
            rows.forEach((members, row) => {
                if (room / members.length < least + gap) throw new Error(`bitField: a width of ${width} has no room for ${plural(members.length)}${least > 0 ? ` of ${least} or more` : ''}${wrap === undefined ? '' : ` in row ${row}`}. Give a larger width${least > 0 ? ' or a smaller minWidth' : ''}`)
                members.forEach((index, at) => {
                    edges[index] = [(room * at) / members.length, (room * (at + 1)) / members.length - gap]
                })
            })
            this.canHave = () => false
        } else {
            // A column is a run of bits that no field of any row cuts. A field takes the columns of its bits, so a
            // field starts at one place for its bit in every row, and the boundaries of the rows line up. This
            // holds too when a narrow field takes the least width.
            const cuts = [...new Set([0, wrap ?? this.total, ...parts.flatMap((part, index) => [starts[index]!, starts[index]! + part.bits])])].sort((a, b) => a - b)
            const runs = parts.map((part, index): Run => [cuts.indexOf(starts[index]!), cuts.indexOf(starts[index]! + part.bits)])
            const bits = cuts.slice(1).map((cut, column) => cut - cuts[column]!)
            const shares = share(bits, runs, room, least + gap)
            this.canHave = (other) => share(bits, runs, room, other + gap) !== null
            if (!shares) throw new Error(`bitField: a width of ${width} has no room for ${wrap === undefined ? plural(parts.length) : 'the fields'}${least > 0 ? ` of ${least} or more` : ''}${wrap === undefined ? '' : ` in rows of ${wrap} ${unit}s`}. Give a larger width${least > 0 ? ' or a smaller minWidth' : ''}`)
            const before = shares.reduce<number[]>((sums, own) => [...sums, sums[sums.length - 1]! + own], [0])
            runs.forEach(([from, to], index) => {
                edges[index] = [before[from]!, before[to]! - gap]
            })
        }
        rows.forEach((members) => {
            for (const index of members) {
                const [from, to] = edges[index]!
                // A box that is narrower than two borders has no inside, so it does not read as a box.
                if (to - from < border * 2) throw new Error(`bitField: ${this.nameOf(index)} is too narrow to draw in a width of ${width}. Give a larger width${scale === 'proportional' ? ", scale: 'even', or a minWidth" : ''}`)
                this.evens[index] = scale === 'proportional' ? room / members.length - gap : 0
            }
        })

        let count = 0
        this.ranges = parts.map((part) => {
            const first = count
            count += part.bits
            return numbers === 'offsets' ? [first, count - 1] : [this.total - 1 - first, this.total - count]
        })

        const half = this.half = height / 2
        const numberSize = size * NUMBER_SIZE
        const digit = text('0', { size: numberSize, font: 'mono' }).bounds()
        // The room that the texts outside the boxes take: from the top of a box to the top of its numbers, and
        // from the bottom of a box to the bottom of a label under it.
        const over = numbers === false ? 0 : border / 2 + numberSize * 0.5 + digit.height
        const under = parts.some((part) => part.value !== undefined && part.label) ? size * 1.55 : 0
        const between = rowGap ?? over + under + size * 0.6
        // With one row, no text of a row can meet a box of the next.
        if (rows.length > 1 && between < over + under) throw new Error(`bitField: rowGap is the room between two rows. The numbers and the labels of these fields need ${Math.ceil(over + under)} or more`)
        const top = -(rows.length * height + (rows.length - 1) * between) / 2
        rows.forEach((members, row) => {
            for (const index of members) this.places[index] = { left: edges[index]![0] - width / 2, right: edges[index]![1] - width / 2, y: top + half + row * (height + between) }
        })

        const marks: NumberMark[] = []
        /** A number over a row, with one point of its ink at `x`: its left end (-1), its middle (0), or its right end (1). */
        const mark = (value: number, field: number, row: number, x: number, align: -1 | 0 | 1, rank: number) => {
            const node = text(String(value), { size: numberSize, font: 'mono', color: 'dim' })
            const ink = node.bounds()
            const from = x - (ink.width * (align + 1)) / 2
            // Every number of a row stands on one line, at a fixed distance over the boxes.
            node.at(from - ink.x, this.places[field]!.y - half - border / 2 - numberSize * 0.5 - (digit.y + digit.height))
            marks.push({ node, field, row, from, to: from + ink.width, rank })
        }

        rows.forEach((members, row) => {
            members.forEach((index, at) => {
                const part = parts[index]!
                const { left, right, y } = this.places[index]!
                const middle = (left + right) / 2, last = index === parts.length - 1
                const color = part.color ?? (part.unused ? 'faint' : options.color ?? 'blue')
                this.inks[index] = part.unused ? 'dim' : 'ink'
                const value = part.value !== undefined ? this.fit(index, part.value, 'value', false, { font: 'mono', color: this.inks[index] }) : null
                const label = !part.label ? null
                    : value ? this.fit(index, part.label, 'label', true, { font: options.font, color: part.unused ? 'dim' : color })
                        : this.fit(index, part.label, 'label', false, { font: options.font, color: this.inks[index] })

                const box = rect(right - left, height, { radius: size * 0.22, fill: color, stroke: color, width: border }).at(middle, y)
                box.set('fillOpacity', part.unused ? 0.06 : 0.16)
                const field = new Node()
                // Without a value, the label is the text inside the box. The border of the box is drawn over the
                // ends of the lines, so no end shows outside a round corner.
                const lines = part.unused ? new Node(this.hatched(index, value ?? label)).stroke(color, Math.max(1, size * 0.05), 0.55) : null
                if (lines) field.add(lines)
                field.add(box)
                if (value) field.add(value)
                if (label) field.add(label)

                if (numbers === 'bits') {
                    const [high, low] = this.ranges[index]!
                    // The numbers of a field stand a little inside its ends, so the low bit of one field and the
                    // high bit of the next read as two numbers.
                    if (part.bits === 1) mark(high, index, row, middle, 0, last ? END : ONE)
                    else {
                        mark(high, index, row, left + size * 0.2, -1, WIDE)
                        mark(low, index, row, right - size * 0.2, 1, last ? END : WIDE)
                    }
                } else if (numbers === 'offsets') {
                    // An offset is a place between two bytes, so it stands over the boundary. Each row starts with
                    // its own offset.
                    mark(this.ranges[index]![0], index, row, at === 0 ? left : left - gap / 2, 0, at === 0 ? END : part.bits === 1 ? ONE : WIDE)
                    if (last) mark(this.total, index, row, right, 0, END)
                }

                this.boxes[index] = box
                this.labels[index] = label
                this.values[index] = value
                this.hatches[index] = lines
                this.fields[index] = field
                this.add(field)
            })
        })

        // Two numbers of a row nearer than this would read as one. The lower rank goes. Of two numbers of one
        // rank, the one at the right goes.
        const apart = numberSize * 0.5
        const kept: NumberMark[] = []
        for (const next of marks) {
            let fits = true
            // A number that takes the place of one may meet the number before that one too, so look again.
            for (let last = kept[kept.length - 1]; last && last.row === next.row && next.from - last.to < apart; last = kept[kept.length - 1]) {
                if (last.rank >= next.rank) {
                    fits = false
                    break
                }
                kept.pop()
            }
            if (fits) kept.push(next)
        }
        for (const { node, field } of kept) {
            this.numbers.push(node)
            this.fields[field]!.add(node)
        }
    }

    /** The node of a field, by its index or by its label. Index 0 is the first field, at the left of the first row. */
    field(which: number | string): Node {
        return this.fields[this.index(which)]!
    }

    /**
     * The middle of an edge of the box of a field, in the coordinates of the object: the point where a line
     * from the field starts. Defaults to the bottom edge. The left and the right edge are for the field at
     * an end of a row. The point does not follow the object: read it again after the object moves.
     */
    p(which: number | string, edge: 'top' | 'bottom' | 'left' | 'right' = 'bottom'): [number, number] {
        const { left, right, y } = this.places[this.index(which)]!
        if (edge === 'top') return [(left + right) / 2, y - this.half]
        if (edge === 'bottom') return [(left + right) / 2, y + this.half]
        if (edge === 'left') return [left, y]
        if (edge === 'right') return [right, y]
        throw new Error(`bitField: the edge of p() is 'top', 'bottom', 'left' or 'right', not ${JSON.stringify(edge)}`)
    }

    /**
     * The high and the low bit of a field. With `numbers: 'offsets'`, its first and its last offset. Without
     * numbers, the bits count as with `numbers: 'bits'`.
     */
    range(which: number | string): [number, number] {
        const [first, last] = this.ranges[this.index(which)]!
        return [first, last]
    }

    /** The fields arrive one after another, each with its texts and its numbers: from the left, and row by row. */
    enter(options: AnimOptions = {}): Anim {
        const lag = Math.max(0, options.lag ?? 0.35)
        return {
            label: 'bitField.enter', duration: options.duration ?? 1.4, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const windows = staggered(this.fields.length, lag, ctx.t0, ctx.t1)
                this.fields.forEach((field, index) => {
                    const [start, end] = windows[index]!
                    stepAt(field, 'opacity', 0, ctx.t0)
                    field.tween('opacity', 1, start, end, ctx.ease)
                })
            },
        }
    }

    /**
     * The value of a field changes in place, such as a flag that goes from '0' to '1'. The text in the box
     * fades out, then the new text fades in, so no moment shows two texts. It works on a field that was built
     * with a `value`, because the layout does not change. The new text follows the rule of the first one: it
     * shrinks to fit, and a text that cannot fit is an error. `values` then holds the new text.
     */
    setValue(which: number | string, value: string, options: AnimOptions = {}): Anim {
        const index = this.index(which)
        if (!this.values[index]) throw new Error(`bitField: ${this.nameOf(index)} was built with no value, so its box has no room for one. Give the field a value when you build the object, such as value: '0' or value: ''`)
        if (typeof value !== 'string') throw new Error(`bitField: the new value of ${this.nameOf(index)} is ${JSON.stringify(value)}. A value is a text, such as '1' or ''`)
        this.checked(index, 'value', value)
        // Build the new text now. A text that cannot fit is then an error at the line of the film that names it.
        const next = this.fit(index, value, 'value', false, { font: 'mono', color: this.inks[index] })
        // The hole in the lines of an unused field takes the size of the new text. Measure the text before it
        // is a part of the object, while its bounds are in the coordinates of the object.
        const lines = this.hatches[index]
        const hole = lines ? this.hatched(index, next) : null
        return {
            label: 'bitField.setValue', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                // Read the text that the field shows when this change starts, so that a second change in one
                // sequence follows the first.
                const old = this.values[index]!
                // A film may play one animation twice. The field shows this text already, so nothing changes.
                if (old === next) return
                const turn = (ctx.t0 + ctx.t1) / 2
                // The new text is a part of the field from here on. It is one already, and hidden, when the
                // film plays the animation again after another change.
                this.fields[index]!.add(next)
                next.track('visible').step(ctx.t0, true)
                stepAt(next, 'opacity', 0, ctx.t0)
                old.tween('opacity', 0, ctx.t0, turn, ctx.ease)
                // The old text is hidden from the turn on. So when a film changes one field twice at one time,
                // the text of the first change does not arrive under the text of the second.
                old.track('visible').step(turn, false)
                next.tween('opacity', 1, turn, ctx.t1, ctx.ease)
                // The hole changes while no text shows.
                if (lines && hole) stepAt(lines, 'path', hole, turn)
                this.values[index] = next
            },
        }
    }

    /** How an error names a field: its index, and its label when it has one. */
    private nameOf(index: number): string {
        return `field ${index}${this.texts[index]!.label ? ` (${JSON.stringify(this.texts[index]!.label)})` : ''}`
    }

    private index(which: number | string): number {
        if (typeof which === 'number') {
            if (!Number.isInteger(which) || which < 0 || which >= this.fields.length) throw new Error(`bitField: no field ${which}. The object has ${this.fields.length} fields, and the first is field 0`)
            return which
        }
        const found = this.texts.flatMap((own, index) => (own.label === which ? [index] : []))
        if (found.length === 1) return found[0]!
        // Two fields can share a name, such as "reserved". A film must then say which one it means.
        if (found.length > 1) throw new Error(`bitField: ${found.length} fields have the label ${JSON.stringify(which)}. Give the index: ${found.join(' or ')}`)
        const labels = this.texts.flatMap((own) => (own.label ? [JSON.stringify(own.label)] : []))
        throw new Error(`bitField: no field has the label ${JSON.stringify(which)}. ${labels.length > 0 ? `The labels are ${labels.join(', ')}` : 'No field has a label, so give an index'}`)
    }

    /** A label or a value is one line of text. A film is not type-checked when it runs, so a number can arrive here. */
    private checked(index: number, what: 'label' | 'value', content: unknown): void {
        if (content === undefined) return
        if (typeof content !== 'string') throw new Error(`bitField: the ${what} of field ${index} is ${JSON.stringify(content)}. A ${what} is a text, such as ${JSON.stringify(String(content))}`)
        // The lines of a text with a line break start at the left, so they leave the middle of the box.
        if (/[\r\n]/.test(content)) throw new Error(`bitField: the ${what} ${JSON.stringify(content)} of field ${index} has a line break. A ${what} is one line: give a shorter text, or a second field`)
    }

    /**
     * A text of a field, with its ink centered on the middle of the field: in the box, or under it. It
     * shrinks to fit the width of the box, down to TEXT_FLOOR of the size.
     */
    private fit(index: number, content: string, what: 'label' | 'value', under: boolean, style: TextOptions): Node {
        const { left, right, y } = this.places[index]!
        const size = this.size, pad = size * PAD
        let made = text(content, { ...style, size })
        const wide = made.bounds().width, inner = right - left - pad * 2
        if (wide > inner) {
            if (inner < wide * TEXT_FLOOR) {
                // The message names only what helps: an even scale when it gives this text room, and a least
                // width when the fields can have it. That is one least width for the object: enough for this
                // text and for the texts of the other fields that are too narrow, so that the film does not
                // meet one message after another.
                const need = wide * TEXT_FLOOR + pad * 2, least = Math.ceil(Math.max(need, ...this.wants()))
                const advice = ['a larger width']
                if (this.evens[index]! >= need) advice.push("scale: 'even'")
                if (this.canHave(least)) advice.push(`a minWidth of ${least} or more`)
                // The label is in the message already, so the field of a label needs only its index.
                throw new Error(`bitField: the ${what} ${JSON.stringify(content)} of ${what === 'label' ? `field ${index}` : this.nameOf(index)} does not fit ${under ? 'under' : 'in'} its box, which is ${Math.round(right - left)} px wide. Give ${advice.join(', ')}, or a shorter text`)
            }
            made = text(content, { ...style, size: (size * inner) / wide })
        }
        const drawn = made.bounds()
        return made.at((left + right) / 2 - (drawn.x + drawn.width / 2), under ? y + this.half + size * 0.9 : y)
    }

    /** The width that each field with a text too wide for its box needs, with its text at the smallest size. */
    private wants(): number[] {
        const size = this.size
        return this.texts.flatMap((own, index) => {
            const { left, right } = this.places[index]!
            const widths = [own.label ? text(own.label, { font: this.font, size }).bounds().width : 0, own.value ? text(own.value, { font: 'mono', size }).bounds().width : 0]
            const need = Math.max(...widths) * TEXT_FLOOR + size * PAD * 2
            return need > right - left ? [need] : []
        })
    }

    /** The lines of an unused field, with a hole around the text in its box. */
    private hatched(index: number, inside: Node | null): Path {
        const { left, right, y } = this.places[index]!
        const size = this.size, around = inside?.bounds()
        // An empty text takes no room, so the lines run through the middle of the box.
        const clear = around && around.width > 0 ? { x: around.x - size * 0.3, y: around.y - size * 0.25, width: around.width + size * 0.6, height: around.height + size * 0.5 } : null
        return hatch({ x: left, y: y - this.half, width: right - left, height: this.half * 2 }, size * 0.62, clear)
    }
}

/** A word split into named fields: `bitField([{ bits: 10, label: 'directory' }, { bits: 10, label: 'table', color: 'orange' }, { bits: 12, label: 'offset' }], { width: 1400 })`. */
export function bitField(parts: readonly BitFieldPart[], options: BitFieldOptions = {}): BitField {
    return new BitField(parts, options)
}
