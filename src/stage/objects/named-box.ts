import { Node } from '../node'
import { rect } from '../shapes'
import { text, type TextOptions } from '../text'
import { capHeight, fittedSize } from '../text-fit'
import type { ColorInput } from '../color'

export interface NamedBoxOptions {
    /** Outer width, in pixels. */
    width: number
    /** Outer height, in pixels. */
    height: number
    /** The color of the border and the name. Defaults to ink. */
    color?: ColorInput
    /** The color of the name, when it is not the color of the border. */
    nameColor?: ColorInput
    /** Font size of the name. A name that is too wide is set smaller, down to 0.6 of this size. Defaults to 32. */
    size?: number
    /**
     * The names of the other boxes of the same size that stand beside this one. Every box of the group gets the size
     * at which its longest name fits, so that twin boxes do not have names of two sizes. Give each box the whole list.
     */
    group?: readonly string[]
    /** A second, smaller line under the name, such as the role of the thing. */
    sub?: string
    /** Font size of the second line. Defaults to 0.72 of `size`. */
    subSize?: number
    /** The color of the second line. Defaults to dim. */
    subColor?: ColorInput
    /** The fill of the box. Pass null for none. Defaults to the surface color. */
    fill?: ColorInput | null
    /** Opacity of the fill, for a light wash of the color of the border. */
    fillOpacity?: number
    /** A dashed border, for a thing that is absent or only planned. */
    dash?: readonly number[]
    radius?: number
    /** Width of the border. Defaults to 2.5. */
    borderWidth?: number
    font?: TextOptions['font']
}

// The smallest text, as a part of the size that the film asks for. A longer text is an error, because nobody can read it.
const TEXT_FLOOR = 0.6
// A box with two lines keeps this much room: above and below the lines together, and between them, in pixels.
const LINES_MARGIN = 16
const LINES_GAP = 6

/** The font sizes at which the name and the second line fit the box. A text that would be too small to read is an error. */
function fitLines(name: string, options: NamedBoxOptions): { size: number; subSize: number } {
    const { width, height, sub, font } = options
    const want = options.size ?? 32, subWant = options.subSize ?? Math.round(want * 0.72)
    // The name keeps the height of a capital letter free at each side, so it never touches the border.
    const inner = width - 2 * capHeight(want) - 8
    if (inner <= 0) throw new Error(`namedBox: a width of ${width} leaves no room for the name ${JSON.stringify(name)} at size ${want}. Widen the box, or lower the size`)
    // Two lines shrink together when the box is too low for them.
    const low = sub ? Math.min(1, (height - LINES_MARGIN) / (want + subWant + LINES_GAP)) : 1
    // The name that needs the smallest size decides for the group.
    const sizes = [name, ...(options.group ?? [])].map((each) => ({ name: each, size: fittedSize(each, inner, want, { font }) }))
    const tightest = sizes.reduce((least, each) => (each.size < least.size ? each : least))
    const size = Math.floor(tightest.size * low)
    const subSize = sub ? fittedSize(sub, inner, Math.floor(subWant * low), { font }) : 0
    for (const [line, fitted, wanted] of [[tightest.name, size, want], [sub, subSize, subWant]] as const) {
        if (line !== undefined && fitted < wanted * TEXT_FLOOR) {
            throw new Error(`namedBox: ${JSON.stringify(line)} needs a size of ${fitted} to fit a box of ${width} by ${height}, and the size is ${wanted}. Shorten the text, or make the box larger`)
        }
    }
    return { size, subSize }
}

/**
 * A box of a given size with a name in its middle: a component, an actor, a file. The name is set smaller
 * when it is wider than the box minus the height of a capital letter at each side, so a name is never larger
 * than the shape that holds it.
 */
export class NamedBox extends Node {
    readonly frame: Node
    readonly name: Node
    /** The second line, or null when the box has none. */
    readonly sub: Node | null

    constructor(name: string, options: NamedBoxOptions) {
        super()
        if (name.trim() === '') throw new Error('namedBox: give it a name')
        const { width, height, sub, font } = options
        if (!(width > 0 && height > 0)) throw new Error(`namedBox: the box ${JSON.stringify(name)} needs a width and a height over 0`)
        const { size, subSize } = fitLines(name, options)
        const color = options.color ?? 'ink'
        this.frame = rect(width, height, {
            radius: options.radius ?? 12, fill: options.fill === undefined ? 'surface' : options.fill,
            stroke: color, width: options.borderWidth ?? 2.5, dash: options.dash,
        })
        if (options.fill && options.fillOpacity !== undefined) this.frame.set('fillOpacity', options.fillOpacity)
        // With a second line, the two lines sit above and below the middle of the box.
        this.name = text(name, { font, size, color: options.nameColor ?? color }).at(0, sub ? -subSize * 0.6 : 0)
        this.sub = sub ? text(sub, { font, size: subSize, color: options.subColor ?? 'dim' }).at(0, size * 0.55) : null
        this.add(this.frame, this.name)
        if (this.sub) this.add(this.sub)
    }
}

/** A box with a name in its middle, such as `namedBox('host kernel', { width: 320, height: 96, color: 'teal', sub: 'Linux 6.1' }).at(0, 120)`. */
export function namedBox(name: string, options: NamedBoxOptions): NamedBox {
    return new NamedBox(name, options)
}
