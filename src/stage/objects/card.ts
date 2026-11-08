import type { Bounds } from '../geometry'
import { Node } from '../node'
import { rect } from '../shapes'
import { text, type TextOptions } from '../text'
import type { ColorInput } from '../color'

export interface CardOptions {
    /** Outer width, in pixels. Defaults to 420. */
    width?: number
    /** Outer height, in pixels. Without it, the card is as tall as its content. Give one height to the cards of a row. */
    height?: number
    /** The name at the top. A name that is too wide is set smaller. */
    title?: string
    /** The picture in the middle. A picture that is too large is scaled down to fit. */
    figure?: Node
    /** The line at the bottom. It wraps to the width of the card. */
    caption?: string
    /** The color of the border and the title. Defaults to ink. */
    color?: ColorInput
    /** The color of the caption. Defaults to ink. */
    captionColor?: ColorInput
    /** Font size of the title. Defaults to 40. */
    size?: number
    /** Font size of the caption. Defaults to 0.72 of `size`. */
    captionSize?: number
    /** Space between the border and the content. Defaults to 0.7 of `size`. */
    padding?: number
    /** The fill of the card. Pass null for none. Defaults to the surface color. */
    fill?: ColorInput | null
    radius?: number
    /** Width of the border. Defaults to 3. */
    weight?: number
    font?: TextOptions['font']
}

const LEADING = 1.25
// The widest title, as a part of the space between the paddings.
const TITLE_WIDTH = 0.92

/** The width that a line of text advances, which does not depend on its letters. */
const advance = (node: Node) => node.get('px') * 2

function wrap(content: string, width: number, options: TextOptions): string[] {
    const lines: string[] = []
    for (const paragraph of content.split('\n')) {
        let line = ''
        for (const word of paragraph.split(' ')) {
            const next = line ? `${line} ${word}` : word
            if (line && advance(text(next, options)) > width) {
                lines.push(line)
                line = word
            } else {
                line = next
            }
        }
        lines.push(line)
    }
    return lines
}

/**
 * A box with a title at the top, a picture in the middle, and a caption at the bottom. The title and the
 * caption sit at fixed distances from the border, and the picture is centered in the space between them,
 * so the cards of a row share one layout whatever they hold.
 */
export class Card extends Node {
    readonly frame: Node
    readonly title: Node | null
    readonly figure: Node | null
    readonly caption: Node | null
    /** The space that the picture may use, in the coordinates of the card. */
    readonly figureBox: Bounds

    constructor(options: CardOptions = {}) {
        super()
        const size = options.size ?? 40
        const captionSize = options.captionSize ?? size * 0.72
        const padding = options.padding ?? size * 0.7
        const gap = size * 0.6
        const width = options.width ?? 420
        const inner = width - padding * 2
        if (inner <= 0) throw new Error(`card: a width of ${width} leaves no room inside a padding of ${padding}`)
        const font = options.font ?? 'text-serif'
        const color = options.color ?? 'ink'

        let title = options.title ? text(options.title, { size, font, color }) : null
        if (title && advance(title) > inner * TITLE_WIDTH) {
            title = text(options.title!, { size: size * (inner * TITLE_WIDTH) / advance(title), font, color })
        }
        const lines = options.caption ? wrap(options.caption, inner, { size: captionSize, font }) : []
        const caption = lines.length > 0
            ? text(lines.join('\n'), { size: captionSize, font, color: options.captionColor ?? 'ink', align: 'center', leading: LEADING })
            : null
        const figure = options.figure ?? null
        const natural = figure?.bounds()
        const drawn = natural && natural.width > 0 && natural.height > 0 ? natural : null

        const titleBand = title ? size : 0
        const captionBand = caption ? (lines.length - 1) * LEADING * captionSize + captionSize : 0
        const around = (title && (drawn || caption) ? gap : 0) + (caption && drawn ? gap : 0)
        const fitted = drawn ? drawn.height * Math.min(1, inner / drawn.width) : 0
        const height = options.height ?? padding * 2 + titleBand + captionBand + around + fitted
        const room = height - padding * 2 - titleBand - captionBand - around
        if (drawn && room <= 0) {
            throw new Error(`card: a height of ${height} leaves no room for the figure between the title and the caption. Raise the height, or shorten the caption`)
        }

        this.frame = rect(width, height, {
            radius: options.radius ?? 16, fill: options.fill === undefined ? 'surface' : options.fill, stroke: color, width: options.weight ?? 3,
        })
        this.add(this.frame)
        const top = -height / 2 + padding
        const bottom = height / 2 - padding
        const areaTop = top + titleBand + (title && (drawn || caption) ? gap : 0)
        const areaBottom = bottom - captionBand - (caption && drawn ? gap : 0)
        this.figureBox = { x: -inner / 2, y: areaTop, width: inner, height: Math.max(0, areaBottom - areaTop) }

        if (figure && drawn) {
            const scale = Math.min(1, inner / drawn.width, room / drawn.height)
            if (scale < 1) figure.scale(scale)
            const placed = figure.bounds()
            figure.shift(-(placed.x + placed.width / 2), (areaTop + areaBottom) / 2 - (placed.y + placed.height / 2))
        }
        if (figure) this.add(figure)
        if (title) this.add(title.at(0, top + size / 2))
        if (caption) this.add(caption.at(0, bottom - captionBand / 2))
        this.title = title
        this.figure = figure
        this.caption = caption
    }
}

/** A box with a title, a picture, and a caption, such as `card({ title: 'Logs', figure: pictogram('logs'), caption: 'one line per event' })`. */
export function card(options: CardOptions = {}): Card {
    return new Card(options)
}
