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
    /** The name at the top. A name that is too wide is set smaller, down to 0.6 of `titleSize`. */
    title?: string
    /** The picture in the middle. It must not be on the stage or in a group yet. A picture that is too large is scaled down to fit. */
    figure?: Node
    /** The text at the bottom. It wraps to the width of the card. */
    caption?: string
    /**
     * The number of caption lines to keep room for. Set it to the longest caption of a row, so that a card
     * with a short caption has the same layout as the others. Defaults to the lines of this caption.
     */
    captionLines?: number
    /** The color of the border and the title. Defaults to ink. */
    color?: ColorInput
    /** The color of the caption. Defaults to ink. */
    captionColor?: ColorInput
    /** Font size of the title. Defaults to 40. */
    titleSize?: number
    /** Font size of the caption. Defaults to 0.72 of `titleSize`. */
    captionSize?: number
    /** Space between the border and the content. Defaults to 0.7 of `titleSize`. */
    padding?: number
    /** The fill of the card. Pass null for none. Defaults to the surface color. */
    fill?: ColorInput | null
    radius?: number
    /** Width of the border. Defaults to 3. */
    borderWidth?: number
    font?: TextOptions['font']
}

const LEADING = 1.25
// The widest title, as a part of the space between the paddings.
const TITLE_WIDTH = 0.92
// The smallest title, as a part of `titleSize`. A longer title is an error, because nobody can read it.
const TITLE_FLOOR = 0.6

/** The advance width of a line of text. It includes the side bearings, which the bounds of the ink do not. */
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
 * caption sit at fixed distances from the border, and the picture is centered in the space between them.
 * Cards with one width, one height, and one `captionLines` share one layout whatever they hold.
 */
export class Card extends Node {
    static override readonly holdsContent = true

    readonly frame: Node
    readonly title: Node | null
    readonly figure: Node | null
    readonly caption: Node | null
    /** The space that the picture may use, in the coordinates of the card, where (0, 0) is its middle. */
    readonly figureBox: Bounds

    constructor(options: CardOptions = {}) {
        super()
        const size = options.titleSize ?? 40
        const captionSize = options.captionSize ?? size * 0.72
        const padding = options.padding ?? size * 0.7
        const gap = size * 0.6
        const width = options.width ?? 420
        const inner = width - padding * 2
        if (inner <= 0) throw new Error(`card: a width of ${width} leaves no room inside a padding of ${padding}`)
        const font = options.font
        const color = options.color ?? 'ink'
        const figure = options.figure ?? null
        if (figure?.parent) throw new Error('card: the figure is already on the stage or in a group. Pass a node that has no parent, such as figure.clone()')

        let title = options.title ? text(options.title, { size, font, color }) : null
        if (title && advance(title) > inner * TITLE_WIDTH) {
            const scale = (inner * TITLE_WIDTH) / advance(title)
            if (scale < TITLE_FLOOR) throw new Error(`card: the title ${JSON.stringify(options.title)} is too long for a width of ${width}. Shorten it, or widen the card`)
            title = text(options.title!, { size: size * scale, font, color })
        }
        const lines = options.caption ? wrap(options.caption, inner, { size: captionSize, font }) : []
        const caption = lines.length > 0
            ? text(lines.join('\n'), { size: captionSize, font, color: options.captionColor ?? 'ink', align: 'center', leading: LEADING })
            : null
        if (caption && advance(caption) > inner) {
            throw new Error(`card: a word of the caption ${JSON.stringify(options.caption)} is wider than the card. Shorten it, or widen the card`)
        }
        const rows = Math.max(lines.length, options.captionLines ?? 0)

        const natural = figure?.bounds()
        const drawn = natural && (natural.width > 0 || natural.height > 0) ? natural : null
        const titleBand = title ? size : 0
        const captionBand = rows > 0 ? (rows - 1) * LEADING * captionSize + captionSize : 0
        const around = (title && (drawn || rows > 0) ? gap : 0) + (rows > 0 && drawn ? gap : 0)
        const fixed = padding * 2 + titleBand + captionBand + around
        const fitted = drawn ? drawn.height * Math.min(1, drawn.width > 0 ? inner / drawn.width : 1) : 0
        const height = options.height ?? fixed + fitted
        const room = height - fixed
        // A figure needs at least the height of a line of the title, or nobody can see what it is.
        if (room < (drawn ? Math.min(size, fitted) : 0) - 1e-9) {
            throw new Error(`card: a height of ${height} leaves no room for ${drawn ? 'the figure between the title and the caption' : 'the title and the caption'}. Raise the height to ${Math.ceil(fixed + (drawn ? Math.min(size, fitted) : 0))} or more`)
        }

        this.frame = rect(width, height, {
            radius: options.radius ?? 16, fill: options.fill === undefined ? 'surface' : options.fill, stroke: color, width: options.borderWidth ?? 3,
        })
        this.add(this.frame)
        const top = -height / 2 + padding
        const bottom = height / 2 - padding
        const areaTop = top + titleBand + (title && (drawn || rows > 0) ? gap : 0)
        const areaBottom = bottom - captionBand - (rows > 0 && drawn ? gap : 0)
        this.figureBox = { x: -inner / 2, y: areaTop, width: inner, height: Math.max(0, areaBottom - areaTop) }

        if (figure && drawn) {
            const scale = Math.min(1, drawn.width > 0 ? inner / drawn.width : 1, drawn.height > 0 ? room / drawn.height : 1)
            if (scale < 1) figure.scale(scale)
            const placed = figure.bounds()
            figure.shift(-(placed.x + placed.width / 2), (areaTop + areaBottom) / 2 - (placed.y + placed.height / 2))
        }
        if (figure) this.add(figure)
        if (title) this.add(title.at(0, top + size / 2))
        // A caption with fewer lines than the room for it starts at the top of that room.
        if (caption) this.add(caption.at(0, bottom - captionBand + ((lines.length - 1) * LEADING * captionSize + captionSize) / 2))
        this.title = title
        this.figure = figure
        this.caption = caption
    }
}

/** A box with a title, a picture, and a caption, such as `card({ title: 'Logs', figure: pictogram('logs'), caption: 'one line per event' })`. */
export function card(options: CardOptions = {}): Card {
    return new Card(options)
}
