import type { Bounds } from '../geometry'
import { fadeIn, fadeOut, par, write, type Anim, type AnimOptions } from '../anim'
import { easeOutCubic } from '../ease'
import { Node, ownLabels } from '../node'
import { line, rect } from '../shapes'
import { text, type TextNode, type TextOptions } from '../text'
import type { ColorInput } from '../color'
import { oneNode } from '../layout'
import { reveal, sampleAt, staggered, stepAt } from './util'
import { Counter, counter, countUp } from './verbs'

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
const advance = (node: TextNode) => node.advanceWidth

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
        if (figure !== null) oneNode('card', figure, 'the figure')
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
        // The card places its title and its caption. The figure is of the film, so the film check judges its text.
        ownLabels(this, { name: 'card', labels: [title, caption] })
    }

    /** The frame traces in, then the title, figure, and caption settle in top to bottom. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'card.enter', duration: options.duration ?? 0.85, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                const fillTarget = sampleAt(this.frame, 'fillOpacity', ctx.t0)
                stepAt(this.frame, 'trimTo', 0, ctx.t0)
                stepAt(this.frame, 'fillOpacity', 0, ctx.t0)
                this.frame.tween('trimTo', 1, ctx.t0, ctx.t0 + span * 0.65, ctx.ease)
                this.frame.tween('fillOpacity', fillTarget, ctx.t0 + span * 0.2, ctx.t0 + span * 0.8, ctx.ease)
                const items = [this.title, this.figure, this.caption].filter((item): item is Node => item !== null)
                const windows = staggered(items.length, Math.max(0, options.lag ?? 0.2), ctx.t0 + span * 0.25, ctx.t1)
                items.forEach((item, index) => {
                    const [start, end] = windows[index]!
                    const target = sampleAt(item, 'opacity', ctx.t0)
                    stepAt(item, 'opacity', 0, ctx.t0)
                    item.tween('opacity', target, start, end, ctx.ease)
                })
            },
        }
    }
}

/** A box with a title, a picture, and a caption, such as `card({ title: 'Logs', figure: pictogram('logs'), caption: 'one line per event' })`. */
export function card(options: CardOptions = {}): Card {
    return new Card(options)
}

export interface TitleCardOptions {
    /** Optional short eyebrow label rendered above the headline. */
    eyebrow?: string
    /** Optional supporting line rendered below the glowing accent rule. */
    subtitle?: string
    /** Accent color for the eyebrow and glowing divider bar. Defaults to 'blue'. */
    accent?: ColorInput
    /** Headline font size. Auto-scales down if the title exceeds `width`. Defaults to 92. */
    size?: number
    /** Maximum text width in stage pixels. Defaults to 1480. */
    width?: number
    /** Headline font family. Defaults to 'serif'. */
    font?: TextOptions['font']
}

/**
 * A broadcast-quality opening or section title card with eyebrow, serif headline,
 * glowing accent rule, and subtitle. Animate with `.enter()` and `.exit()`.
 */
export class TitleCardNode extends Node {
    readonly eyebrow: TextNode | null
    readonly heading: TextNode
    readonly rule: Node
    readonly subtitle: TextNode | null

    constructor(title: string, options: TitleCardOptions = {}) {
        super()
        const maxWidth = options.width ?? 1480
        const accent = options.accent ?? 'blue'
        const baseSize = options.size ?? 92
        const font = options.font ?? 'serif'

        let heading = text(title, { size: baseSize, font, color: 'ink' })
        if (advance(heading) > maxWidth) {
            const fitted = Math.max(40, Math.floor(baseSize * (maxWidth / advance(heading))))
            heading = text(title, { size: fitted, font, color: 'ink' })
        }
        const headingSize = heading.bounds().height || baseSize

        const eyebrow = options.eyebrow
            ? text(options.eyebrow.toUpperCase(), { size: 24, font: 'mono', weight: 600, color: accent })
            : null
        const ruleHalf = Math.min(260, Math.max(120, Math.round(advance(heading) * 0.24)))
        const rule = line([-ruleHalf, 0], [ruleHalf, 0], { stroke: accent, width: 4, glow: 10 })
        const subtitle = options.subtitle
            ? text(options.subtitle, { size: 34, font: 'sans', color: 'dim', maxWidth, align: 'center' })
            : null

        const eyebrowY = -(headingSize * 0.72 + 34)
        const ruleY = headingSize * 0.62 + 26
        const subtitleY = ruleY + 48

        if (eyebrow) this.add(eyebrow.at(0, eyebrowY))
        this.add(heading.at(0, 0))
        this.add(rule.at(0, ruleY))
        if (subtitle) this.add(subtitle.at(0, subtitleY))

        this.eyebrow = eyebrow
        this.heading = heading
        this.rule = rule
        this.subtitle = subtitle
        ownLabels(this, { name: 'titleCard', labels: [eyebrow, heading, subtitle] })
    }

    /** Reveal the eyebrow, handwrite or settle the headline, trace the accent rule, and bring in the subtitle. */
    enter(options: AnimOptions = {}): Anim {
        const duration = options.duration ?? 1.25
        return {
            label: 'titleCard.enter', duration, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                if (this.eyebrow) {
                    fadeIn(this.eyebrow, { shift: [0, 12], duration: span * 0.45, ease: easeOutCubic })
                        .schedule({ ...ctx, t0: ctx.t0, t1: ctx.t0 + span * 0.45, ease: easeOutCubic })
                }
                write(this.heading, { duration: span * 0.72, lag: 0.14 })
                    .schedule({ ...ctx, t0: ctx.t0 + span * 0.08, t1: ctx.t0 + span * 0.8 })
                stepAt(this.rule, 'trimTo', 0, ctx.t0)
                this.rule.tween('trimTo', 1, ctx.t0 + span * 0.35, ctx.t0 + span * 0.85, easeOutCubic)
                if (this.subtitle) {
                    const start = ctx.t0 + span * 0.48
                    stepAt(this.subtitle, 'opacity', 0, ctx.t0)
                    fadeIn(this.subtitle, { shift: [0, 14], duration: ctx.t1 - start, ease: easeOutCubic })
                        .schedule({ ...ctx, t0: start, t1: ctx.t1, ease: easeOutCubic })
                }
            },
        }
    }

    /** Smoothly lift and fade out the title card. */
    exit(options: AnimOptions = {}): Anim {
        return fadeOut(this, { duration: options.duration ?? 0.55, shift: [0, -20], ease: options.ease })
    }
}

/** Instant cinematic opening or chapter title card with `.enter()` and `.exit()`. */
export function titleCard(title: string, options: TitleCardOptions = {}): TitleCardNode {
    return new TitleCardNode(title, options)
}

export interface MetricTileOptions {
    /** Short metric label shown above the value. */
    label: string
    /** Target numeric value shown when the tile settles. */
    value: number
    /** Starting value animated from during `.enter()`. Defaults to 0. */
    from?: number
    prefix?: string
    suffix?: string
    digits?: number
    /** Optional delta or context line beneath the readout (e.g. '-62% p99'). */
    delta?: string
    /** Accent color for the top highlight bar, value tint, and border. Defaults to 'blue'. */
    color?: ColorInput
    /** Outer width in pixels. Defaults to 380. */
    width?: number
    /** Outer height in pixels. Defaults to 220. */
    height?: number
}

/**
 * Animated KPI tile with glowing accent strip, crisp label, live `Counter`, and optional delta line.
 * `.enter()` traces the frame and counts up from `from` to `value`; `.countTo(next)` animates updates.
 */
export class MetricTile extends Node {
    readonly frame: Node
    readonly accentBar: Node
    readonly labelNode: TextNode
    readonly counter: Counter
    readonly deltaNode: TextNode | null
    readonly targetValue: number

    constructor(options: MetricTileOptions) {
        super()
        const width = options.width ?? 380
        const height = options.height ?? 220
        const color = options.color ?? 'blue'
        const from = options.from ?? 0
        this.targetValue = options.value

        this.frame = rect(width, height, { radius: 18, fill: 'surface', stroke: color, width: 2.5 })
        const barW = Math.max(80, width - 72)
        this.accentBar = line([-barW / 2, -height / 2 + 18], [barW / 2, -height / 2 + 18], { stroke: color, width: 4, glow: 8 })
        this.labelNode = text(options.label.toUpperCase(), { size: 22, font: 'mono', weight: 600, color: 'dim' })
        this.counter = counter(from, {
            size: 62, weight: 700, color: 'ink', prefix: options.prefix, suffix: options.suffix, digits: options.digits ?? 0,
        })
        this.deltaNode = options.delta
            ? text(options.delta, { size: 24, font: 'mono', color })
            : null

        this.add(this.frame)
        this.add(this.accentBar)
        this.add(this.labelNode.at(0, -height / 2 + 54))
        this.add(this.counter.at(0, options.delta ? 4 : 18))
        if (this.deltaNode) this.add(this.deltaNode.at(0, height / 2 - 38))
        ownLabels(this, { name: 'metricTile', labels: [this.labelNode, this.deltaNode] })
    }

    /** Trace the tile frame, glow the top strip, and count the readout up to its target value. */
    enter(options: AnimOptions = {}): Anim {
        const duration = options.duration ?? 1.0
        return {
            label: 'metricTile.enter', duration, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                const fillTarget = sampleAt(this.frame, 'fillOpacity', ctx.t0)
                stepAt(this.frame, 'trimTo', 0, ctx.t0)
                stepAt(this.frame, 'fillOpacity', 0, ctx.t0)
                this.frame.tween('trimTo', 1, ctx.t0, ctx.t0 + span * 0.55, easeOutCubic)
                this.frame.tween('fillOpacity', fillTarget, ctx.t0 + span * 0.15, ctx.t0 + span * 0.65, easeOutCubic)
                stepAt(this.accentBar, 'trimTo', 0, ctx.t0)
                this.accentBar.tween('trimTo', 1, ctx.t0 + span * 0.12, ctx.t0 + span * 0.65, easeOutCubic)
                const body = [this.labelNode, this.counter, ...(this.deltaNode ? [this.deltaNode] : [])]
                for (const part of body) {
                    const targetOpacity = sampleAt(part, 'opacity', ctx.t0)
                    stepAt(part, 'opacity', 0, ctx.t0)
                    part.tween('opacity', targetOpacity, ctx.t0 + span * 0.18, ctx.t0 + span * 0.55, easeOutCubic)
                }
                countUp(this.counter, this.targetValue, { duration: span * 0.82, ease: options.ease ?? easeOutCubic })
                    .schedule({ ...ctx, t0: ctx.t0 + span * 0.18, t1: ctx.t1, ease: options.ease ?? easeOutCubic })
            },
        }
    }

    /** Animate the metric readout to a new numeric value. */
    countTo(next: number, options: AnimOptions = {}): Anim {
        return par(countUp(this.counter, next, options))
    }
}

/** Animated KPI tile with built-in counter, glowing accent bar, `.enter()`, and `.countTo()`. */
export function metricTile(options: MetricTileOptions): MetricTile {
    return new MetricTile(options)
}
