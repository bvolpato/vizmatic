import type { Bounds } from '../geometry'
import { Node } from '../node'
import { rect } from '../shapes'
import { text, type TextNode, type TextOptions } from '../text'
import { advanceWidth } from '../text-fit'
import type { ColorInput } from '../color'

export interface ChipOptions {
    /** Font size of the label. Defaults to 28. */
    size?: number
    /** The color of the label. Defaults to ink. */
    color?: ColorInput
    /** The color of the border. Defaults to gridStrong. */
    stroke?: ColorInput
    /** The fill of the box. Pass null for none. Defaults to the surface color. */
    fill?: ColorInput | null
    /** A dashed border, for a thing that is absent or only planned. */
    dash?: readonly number[]
    /** The least width of the box, so that the chips of a column have one width. */
    minWidth?: number
    /** The height of the box, in font sizes. Defaults to 2.3, which leaves the height of a capital letter above and below the label. */
    height?: number
    /** The room at the two sides of the label together, in font sizes. Defaults to 1.7. A pill with round ends reads well with 1.5. */
    room?: number
    /** Round ends, as a pill. */
    round?: boolean
    /** The radius of the corners when the ends are not round. Defaults to 10. */
    radius?: number
    /** Width of the border. Defaults to 2. */
    borderWidth?: number
    font?: TextOptions['font']
    /**
     * The point of the box that `.at(x, y)` places: its left end, its middle, or its right end. Defaults to
     * left, as for a tag and a row of chips: a box that takes its width from its text starts at its x.
     */
    anchor?: 'left' | 'center' | 'right'
}

/**
 * A short label in a box that fits it, with room on every side: a name, a state, a unit. The box takes its
 * width from the label, so a chip is never smaller than its text. `.at(x, y)` places the left end of the box,
 * and `anchor: 'center'` its middle.
 */
export class Chip extends Node {
    readonly frame: Node
    /** The label. `Node.label` is the name of a node in a timeline, so this part is `text`. */
    readonly text: TextNode
    /** The border, in the coordinates of the chip, where (0, 0) is the point that `.at` places. */
    readonly box: Bounds

    constructor(content: string, options: ChipOptions = {}) {
        super()
        if (content.trim() === '') throw new Error('chip: give it a label')
        const size = options.size ?? 28
        const rise = options.height ?? 2.3
        // Under 1.4 sizes the border touches the letters that go below the line.
        if (!(rise >= 1.4)) throw new Error(`chip: a height of ${rise} font sizes leaves no room around the label. Use 1.4 or more`)
        const height = Math.round(size * rise)
        const room = options.room ?? 1.7
        // Under half a font size at each side, the border touches the first and the last letter.
        if (!(room >= 1)) throw new Error(`chip: a room of ${room} font sizes at the sides leaves the label on the border. Use 1 or more`)
        const width = Math.max(options.minWidth ?? 0, Math.round(advanceWidth(content, size, { font: options.font }) + size * room))
        const middle = options.anchor === 'center' ? 0 : options.anchor === 'right' ? -width / 2 : width / 2
        this.frame = rect(width, height, {
            radius: options.round ? height / 2 : options.radius ?? 10,
            fill: options.fill === undefined ? 'surface' : options.fill,
            stroke: options.stroke ?? 'gridStrong', width: options.borderWidth ?? 2, dash: options.dash,
        }).at(middle, 0)
        this.text = text(content, { font: options.font, size, color: options.color ?? 'ink' }).at(middle, 0)
        this.box = { x: middle - width / 2, y: -height / 2, width, height }
        this.add(this.frame, this.text)
    }
}

/** A short label in a box that fits it, such as `chip('virtio', { color: 'green', stroke: 'green' }).at(120, 40)`, with its left end at x 120. */
export function chip(content: string, options: ChipOptions = {}): Chip {
    return new Chip(content, options)
}

/** One chip of a row: its label, or its label with its own colors. */
export type ChipRowItem = string | { text: string; color?: ColorInput; stroke?: ColorInput }

export interface ChipRowOptions extends ChipOptions {
    /** The width at which the row starts a new line. Without it, the row is one line. */
    maxWidth?: number
    /** Space between two chips of a line. Defaults to half a font size. */
    gap?: number
    /** Space between two lines. Defaults to 0.43 of a font size. */
    lineGap?: number
}

/**
 * Chips in a row that starts a new line when it is full: a list of names, of flags, of states.
 * `.at(x, y)` places the left end of the first line, at the height of its middle. With `anchor: 'center'`,
 * each line has its middle at x, and with `anchor: 'right'`, each line ends at x.
 */
export class ChipRow extends Node {
    readonly chips: readonly Chip[]
    /** The area of all the lines, in the coordinates of the row, where (0, 0) is the point that `.at` places, at the height of the first line. */
    readonly box: Bounds

    constructor(items: readonly ChipRowItem[], options: ChipRowOptions = {}) {
        super()
        if (items.length === 0) throw new Error('chipRow: give it at least one chip')
        const { maxWidth, gap: gapOption, lineGap: lineGapOption, anchor = 'left', ...shared } = options
        const size = shared.size ?? 28
        const gap = gapOption ?? Math.round(size * 0.5), lineGap = lineGapOption ?? Math.round(size * 0.43)
        // Each line, with the place of its chips from its left end, and its width.
        const lines: { chips: Chip[]; width: number }[] = [{ chips: [], width: 0 }]
        let x = 0, y = 0
        for (const item of items) {
            const own = typeof item === 'string' ? { text: item } : item
            const made = chip(own.text, { ...shared, ...(own.color === undefined ? {} : { color: own.color }), ...(own.stroke === undefined ? {} : { stroke: own.stroke }), anchor: 'left' })
            if (maxWidth !== undefined && made.box.width > maxWidth) {
                throw new Error(`chipRow: the chip ${JSON.stringify(own.text)} is ${made.box.width} wide, and the row is ${maxWidth} wide. Shorten the label, or widen the row`)
            }
            // A chip that would pass the end of the line starts the next line.
            if (maxWidth !== undefined && x > 0 && x + made.box.width > maxWidth) {
                x = 0
                y += made.box.height + lineGap
                lines.push({ chips: [], width: 0 })
            }
            const line = lines[lines.length - 1]!
            line.chips.push(made.at(x, y))
            x += made.box.width
            line.width = x
            x += gap
        }
        // A line starts at x, has its middle at x, or ends at x.
        const start = (width: number) => (anchor === 'center' ? -width / 2 : anchor === 'right' ? -width : 0)
        for (const line of lines) for (const made of line.chips) made.shift(start(line.width), 0)
        const chips = lines.flatMap((line) => line.chips)
        const height = chips[0]!.box.height, widest = Math.max(...lines.map((line) => line.width))
        this.chips = chips
        this.box = { x: start(widest), y: -height / 2, width: widest, height: y + height }
        this.add(...chips)
    }
}

/** Chips in a row that wraps, such as `chipRow(['KVM', 'seccomp', 'cgroups'], { maxWidth: 600 }).at(-900, 300)`, or with `anchor: 'center'` for a row with its middle at x. */
export function chipRow(items: readonly ChipRowItem[], options: ChipRowOptions = {}): ChipRow {
    return new ChipRow(items, options)
}
