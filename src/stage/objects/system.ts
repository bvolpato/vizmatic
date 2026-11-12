import { apply, invert, parseSvgPath, pathLength, pointAt, polyPath, rectPath, tangentAt, transformPath, trimPath, smoothPath, IDENTITY, type Path, type Vec, type Mat } from '../geometry'
import { Node, ownLabels, type Edge, objectName } from '../node'
import { filmFont, text, type TextOptions } from '../text'
import { circle, dot, line } from '../shapes'
import { toPaint, type ColorInput } from '../color'
import { morphMatching, type Anim, type AnimOptions } from '../anim'
import { linear, smooth, type Ease } from '../ease'
import { clock } from '../track'
import { reveal, staggered, stepAt } from './util'
import { Block, nodeOrPoint, oneNode } from '../layout'
import type { Stage } from '../stage'
import { pictogram } from './pictograms'

/** Left, right, or center a single line of text on a stage position. Its baseline never shifts. */
function place(node: Node, x: number, y: number, align: 'left' | 'right' | 'center' = 'left'): Node {
    const half = node.get('px')
    return node.at(align === 'left' ? x + half : align === 'right' ? x - half : x, y)
}

function advanceWidth(node: Node): number {
    return node.get('px') * 2
}

// ── Info box ────────────────────────────────────────────────────────────────

export interface InfoRow {
    label: string
    value?: string
    /** Color for the value. */
    tone?: ColorInput
    /** Thin meter under the row, from 0 to 1. */
    meter?: number
    /** Small trend drawn at the end of the row. */
    spark?: readonly number[]
}

export interface InfoBoxOptions {
    title: string
    subtitle?: string
    /** Short status tag at the top right, such as "p99" or "degraded". */
    badge?: string
    badgeTone?: ColorInput
    rows?: readonly InfoRow[]
    /** Small chips along the bottom. */
    tags?: readonly string[]
    /** Width in stage pixels. Grows to fit the content when omitted. */
    width?: number
    /** Base text size. Everything scales from it. Raise it for a presentation. */
    size?: number
    /** Color of the left edge. */
    accent?: ColorInput
    fill?: ColorInput
    border?: ColorInput
    radius?: number
    /** The font of the title and the row labels. Defaults to the font of the film. The subtitle, the badge, the values and the tags are in mono. */
    font?: TextOptions['font']
}

/**
 * A compact node for system stories: a title, a status, and rows of labeled
 * metrics at reading size. It packs information like an engineering figure,
 * not a slide. For a talk, raise `size` and the whole box scales with it.
 */
export class InfoBox extends Node {
    readonly frame: Node
    readonly accentBar: Node | null = null
    readonly titleNode: Node
    readonly subtitleNode: Node | null = null
    readonly badgeNode: Node | null = null
    readonly rowLabels: Node[] = []
    readonly rowValues: (Node | null)[] = []
    readonly meters: Node[] = []
    readonly tagNodes: Node[] = []
    readonly boxWidth: number
    readonly boxHeight: number
    private readonly valueSize: number

    constructor(options: InfoBoxOptions) {
        super()
        const size = options.size ?? 14
        this.valueSize = size
        const pad = size * 0.8
        const rows = options.rows ?? []
        const rowHeight = size * 1.56
        const title = text(options.title, { size: size * 1.14, font: options.font, weight: 600, color: 'ink' })
        const subtitle = options.subtitle ? text(options.subtitle, { size: size * 0.86, font: 'mono', color: 'dim' }) : null
        const badgeTone = options.badgeTone ?? options.accent ?? 'dim'
        const badge = options.badge ? text(options.badge, { size: size * 0.78, font: 'mono', color: badgeTone }) : null
        const labels = rows.map((row) => text(row.label, { size, font: options.font, color: 'dim' }))
        const values = rows.map((row) => row.value !== undefined ? text(row.value, { size, font: 'mono', color: row.tone ?? 'ink' }) : null)
        const sparkWidth = size * 3.6
        const contentWidth = Math.max(
            advanceWidth(title) + (badge ? advanceWidth(badge) + size * 1.6 : 0),
            subtitle ? advanceWidth(subtitle) : 0,
            ...rows.map((row, i) => advanceWidth(labels[i]!) + (values[i] ? advanceWidth(values[i]!) + size * 1.1 : 0) + (row.spark ? sparkWidth + size * 0.6 : 0)),
            0,
        )
        const width = this.boxWidth = Math.max(options.width ?? 0, contentWidth + pad * 2)
        const headerHeight = size * 1.4 + (subtitle ? size * 1.2 : 0)
        const rowsHeight = rows.reduce((sum, row) => sum + rowHeight + (row.meter !== undefined ? size * 0.32 : 0), 0)
        const tagsHeight = options.tags?.length ? size * 1.72 : 0
        const height = this.boxHeight = pad * 1.5 + headerHeight + (rows.length ? size * 0.55 : 0) + rowsHeight + tagsHeight
        const left = -width / 2 + pad, right = width / 2 - pad
        this.frame = new Node(rectPath(-width / 2, -height / 2, width, height, options.radius ?? 4))
            .fill(options.fill ?? 'surface')
            .stroke(options.border ?? 'gridStrong', 1)
        this.add(this.frame)
        if (options.accent) {
            const bar = new Node(rectPath(-width / 2, -height / 2 + 1, 2.5, height - 2)).fill(options.accent)
            ;(this as { accentBar: Node | null }).accentBar = bar
            this.add(bar)
        }
        let y = -height / 2 + pad * 0.75 + size * 0.62
        this.titleNode = place(title, left, y)
        this.add(title)
        if (badge) {
            ;(this as { badgeNode: Node | null }).badgeNode = place(badge, right, y, 'right')
            this.add(badge)
        }
        y += size * 1.3
        if (subtitle) {
            ;(this as { subtitleNode: Node | null }).subtitleNode = place(subtitle, left, y - size * 0.1)
            this.add(subtitle)
            y += size * 1.2
        }
        if (rows.length) {
            const ruleY = y - size * 0.38
            this.add(line([-width / 2 + pad, ruleY], [width / 2 - pad, ruleY], { stroke: 'grid', width: 1 }))
            y += size * 0.5
        }
        rows.forEach((row, i) => {
            place(labels[i]!, left, y)
            this.rowLabels.push(labels[i]!)
            this.add(labels[i]!)
            let end = right
            const value = values[i]
            if (value) {
                place(value, end, y, 'right')
                this.add(value)
                end -= advanceWidth(value) + size * 0.7
            }
            this.rowValues.push(value ?? null)
            if (row.spark) {
                const spark = sparkline(row.spark, { width: sparkWidth, height: size * 0.82, color: row.tone ?? 'blue', dotted: true, weight: 1.2 })
                this.add(spark.at(end - sparkWidth / 2, y - size * 0.1))
            }
            y += rowHeight
            if (row.meter !== undefined) {
                const meterY = y - size * 0.62
                this.add(line([left, meterY], [right, meterY], { stroke: 'grid', width: 2 }))
                const meter = line([left, meterY], [left + (right - left) * Math.max(0, Math.min(1, row.meter)), meterY], { stroke: row.tone ?? 'blue', width: 2 })
                meter.set('cap', 'butt')
                this.meters.push(meter)
                this.add(meter)
                y += size * 0.32
            }
        })
        if (options.tags?.length) {
            let x = left
            const tagY = height / 2 - pad * 0.7 - size * 0.4
            for (const tag of options.tags) {
                const label = text(tag, { size: size * 0.78, font: 'mono', color: 'dim' })
                const w = advanceWidth(label) + size * 0.7
                const chip = new Node(rectPath(x, tagY - size * 0.62, w, size * 1.24, 2)).stroke('gridStrong', 1)
                place(label, x + size * 0.35, tagY)
                this.tagNodes.push(label)
                this.add(chip, label)
                x += w + size * 0.34
            }
        }
        ownLabels(this, { name: 'info box' })
    }

    /** Stage point on one side of the box. `at` moves along the side, from -1 to 1. */
    port(side: Edge, at = 0): [number, number] {
        const b = this.bounds()
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2
        if (side === 'left') return [b.x, cy + at * b.height / 2]
        if (side === 'right') return [b.x + b.width, cy + at * b.height / 2]
        if (side === 'top') return [cx + at * b.width / 2, b.y]
        return [cx + at * b.width / 2, b.y + b.height]
    }

    /** The frame draws, then the contents settle in, top to bottom. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'infoBox.enter', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                const fillTarget = this.frame.get('fillOpacity')
                stepAt(this.frame, 'trimTo', 0, ctx.t0)
                stepAt(this.frame, 'fillOpacity', 0, ctx.t0)
                this.frame.tween('trimTo', 1, ctx.t0, ctx.t0 + span * 0.65, ctx.ease)
                this.frame.tween('fillOpacity', fillTarget, ctx.t0 + span * 0.2, ctx.t0 + span * 0.8, ctx.ease)
                const items = this.children.filter((child) => child !== this.frame)
                const windows = staggered(items.length, 0.06, ctx.t0 + span * 0.25, ctx.t1)
                items.forEach((item, i) => {
                    const [start, end] = windows[i]!
                    const target = item.get('opacity')
                    stepAt(item, 'opacity', 0, ctx.t0)
                    item.tween('opacity', target, start, end, ctx.ease)
                })
            },
        }
    }

    /** Change a row's value in place. Matching digits slide, and the others cross-fade. */
    setValue(row: number, value: string, options: AnimOptions & { tone?: ColorInput } = {}): Anim {
        const previous = this.rowValues[row]
        if (!previous) throw new Error(`Info box row ${row} has no value to change.`)
        const next = text(value, { size: this.valueSize, font: 'mono', color: options.tone ?? 'ink' })
        const right = previous.get('x') + previous.get('px')
        place(next, right, previous.get('y'), 'right')
        const anim = morphMatching(previous, next, { duration: 0.5, ...options })
        return {
            ...anim,
            label: 'infoBox.setValue',
            schedule: (ctx) => {
                this.add(next)
                ownLabels(this, { labels: [next] })
                this.rowValues[row] = next
                anim.schedule(ctx)
            },
        }
    }
}

export function infoBox(options: InfoBoxOptions): InfoBox {
    return new InfoBox(options)
}

// ── Sparkline ───────────────────────────────────────────────────────────────

export interface SparklineOptions {
    width?: number
    height?: number
    color?: ColorInput
    weight?: number
    /** Mark the latest value. */
    dotted?: boolean
    area?: number
}

/** A word-sized line chart, with no axes. */
export function sparkline(values: readonly number[], options: SparklineOptions = {}): Node {
    const width = options.width ?? 80, height = options.height ?? 20
    const low = Math.min(...values), high = Math.max(...values)
    const span = high - low || 1
    const points = values.map((value, i): Vec => [
        (i / Math.max(1, values.length - 1) - 0.5) * width,
        (0.5 - (value - low) / span) * height,
    ])
    const color = options.color ?? 'blue'
    const made = new Node()
    if (options.area) {
        made.add(new Node(polyPath([...points, [width / 2, height / 2], [-width / 2, height / 2]], true)).fill(color, options.area))
    }
    made.add(new Node(values.length > 2 ? smoothPath(points) : polyPath(points)).stroke(color, options.weight ?? 1.5))
    if (options.dotted) made.add(dot((options.weight ?? 1.5) * 1.5, color).at(points[points.length - 1]!))
    return objectName(made, 'sparkline')
}

// ── Connector ───────────────────────────────────────────────────────────────

/** An end of a connector: a node, a block of the layout, or a point of the stage. */
export type ConnectorEnd = Node | Block | Vec

export interface ConnectorOptions {
    /** Side to leave from and arrive at. Chosen automatically when omitted. */
    from?: Edge
    to?: Edge
    route?: 'curve' | 'ortho' | 'straight'
    color?: ColorInput
    width?: number
    dash?: readonly number[]
    /** Draw an arrowhead at the end. */
    tip?: boolean
    tipSize?: number
    /** Label on the line, on a plate so the line never crosses its text. */
    label?: string
    /** The font of the label. Defaults to the font that the film names, and to mono in a film that names none. */
    font?: TextOptions['font']
    labelSize?: number
    labelColor?: ColorInput
    labelBackground?: ColorInput
    /** Where the label sits along the line. */
    labelAt?: number
    /** Space between the line and the box it touches. */
    gap?: number
    /** Slide each end along its side, from -1 to 1. Use it to separate parallel lines. */
    fromOffset?: number
    toOffset?: number
    curvature?: number
    radius?: number
    /** Dashes travel along the line at this many pixels per second. */
    flow?: number
}

/** How `connector.send` sends a mark along a line. */
export interface SendOptions extends AnimOptions {
    /** Travel from the second end of the line to the first, as the answer to a request does. */
    reverse?: boolean
    /**
     * The part of the way where the message is lost, from 0 to 1. It stops there, with a cross ahead of it.
     * The way of a message that stops ends before the node, with room for the cross: at 1, it stops where a
     * refused message stops.
     */
    lost?: number
    /** The receiver does not take the message. It stops before the end of the line, with a cross between it and the receiver. */
    refused?: boolean
    /** Seconds that a message that is lost or refused stays with its cross, before both go. Defaults to 0.8. */
    hold?: number
    /** The color of the cross. Defaults to red. */
    stopColor?: ColorInput
    /** Room between the mark and the node at each end of the line, and between the mark and its cross. Defaults to 8. */
    gap?: number
}

/** Seconds for a mark to grow in at the start of its way, and to shrink out when it goes. */
const SEND_GROW = 0.15, SEND_LEAVE = 0.12
/** A time for a message, with two digits. */
const round = (seconds: number): number => Math.round(seconds * 100) / 100
/** The times at which each mark of a film is on its way, so that one mark is not sent two times at once. A film that is built again has a new stage. */
const ON_ITS_WAY = new WeakMap<Stage, Map<Node, [from: number, to: number][]>>()

interface Anchor {
    point: Vec
    normal: Vec
}

const NORMALS: Record<Edge, Vec> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] }

function sidePoint(b: { x: number; y: number; width: number; height: number }, side: Edge, offset: number): Vec {
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2
    if (side === 'left') return [b.x, cy + offset * b.height / 2]
    if (side === 'right') return [b.x + b.width, cy + offset * b.height / 2]
    if (side === 'top') return [cx + offset * b.width / 2, b.y]
    return [cx + offset * b.width / 2, b.y + b.height]
}

function chooseSides(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): [Edge, Edge] {
    const gapX = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width))
    const gapY = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height))
    const ax = a.x + a.width / 2, ay = a.y + a.height / 2, bx = b.x + b.width / 2, by = b.y + b.height / 2
    if (gapX >= gapY) return bx >= ax ? ['right', 'left'] : ['left', 'right']
    return by >= ay ? ['bottom', 'top'] : ['top', 'bottom']
}

function fillet(points: readonly Vec[], radius: number): Path {
    let d = `M${points[0]![0]} ${points[0]![1]}`
    for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1]!, at = points[i]!, next = points[i + 1]!
        const l0 = Math.hypot(at[0] - prev[0], at[1] - prev[1]), l1 = Math.hypot(next[0] - at[0], next[1] - at[1])
        const r = Math.min(radius, l0 / 2, l1 / 2)
        if (r < 0.5) {
            d += `L${at[0]} ${at[1]}`
            continue
        }
        const p0x = at[0] - (at[0] - prev[0]) / (l0 || 1) * r, p0y = at[1] - (at[1] - prev[1]) / (l0 || 1) * r
        const p1x = at[0] + (next[0] - at[0]) / (l1 || 1) * r, p1y = at[1] + (next[1] - at[1]) / (l1 || 1) * r
        d += `L${p0x} ${p0y}Q${at[0]} ${at[1]} ${p1x} ${p1y}`
    }
    const last = points[points.length - 1]!
    return parseSvgPath(`${d}L${last[0]} ${last[1]}`)
}

interface ActivePulse {
    t0: number
    t1: number
    ease: Ease
    color: ColorInput
    length: number
    width: number
    glow: number
}

/**
 * A line between two nodes that is routed fresh on every frame. Move a node and
 * the line follows. `draw(connector)` traces it, and `.pulse()` sends a signal.
 */
export class Connector extends Node {
    private readonly fromEnd: ConnectorEnd
    private readonly toEnd: ConnectorEnd
    private readonly options: ConnectorOptions
    private readonly pulses: ActivePulse[] = []
    /** The label is made on the first frame that shows it. Its font is the one of the film that made the connector. */
    private readonly labelFont: NonNullable<TextOptions['font']>
    private plate: Node | null = null
    private caption: Node | null = null

    constructor(from: ConnectorEnd, to: ConnectorEnd, options: ConnectorOptions = {}) {
        // An empty path lets the standard draw and write verbs animate trimTo here.
        super([])
        // A block of the layout is an end as a node is: the line meets the middle of the edge of its box.
        for (const [end, name] of [[from, 'the first end'], [to, 'the second end']] as const) {
            if (end instanceof Block) continue
            try {
                nodeOrPoint('connector', end, name)
            } catch (error) {
                throw new Error((error as Error).message.replace('Give a node, or a point', 'Give a node, a block of the layout, or a point'))
            }
        }
        this.fromEnd = from
        this.toEnd = to
        this.options = options
        this.labelFont = options.font ?? filmFont() ?? 'mono'
        this.base.stroke = toPaint(options.color ?? 'dim')
        this.base.strokeWidth = options.width ?? 1.6
        this.draw = (time) => this.build(time)
        // The label sits on the line, on a plate. `build` makes it later.
        ownLabels(this, { name: 'connector', labels: [] })
        // The line ends at the two nodes on purpose, so the film check does not judge their text against it.
        this.data['attached'] = [from, to].flatMap((end) => (end instanceof Block ? end.nodes : end instanceof Node ? [end] : []))
        this.data['line'] = true
    }

    private anchors(): [Anchor, Anchor] {
        const { fromEnd, toEnd, options } = this
        const gap = options.gap ?? 3
        // A block has the measure of the layout, so the line leaves from the box that the layout placed.
        const measure = (block: Block) => { const box = block.box; return { x: box.left, y: box.top, width: box.width, height: box.height } }
        const boxOf = (end: ConnectorEnd) => end instanceof Block ? measure(end) : end instanceof Node ? end.bounds() : { x: end[0], y: end[1], width: 0, height: 0 }
        const a = boxOf(fromEnd), b = boxOf(toEnd)
        const [autoFrom, autoTo] = chooseSides(a, b)
        const sideFrom = options.from ?? autoFrom, sideTo = options.to ?? autoTo
        const anchor = (end: ConnectorEnd, box: typeof a, side: Edge, offset: number): Anchor => {
            const normal = NORMALS[side]
            if (!(end instanceof Node || end instanceof Block)) return { point: end, normal }
            const [x, y] = sidePoint(box, side, offset)
            return { point: [x + normal[0] * gap, y + normal[1] * gap], normal }
        }
        return [anchor(fromEnd, a, sideFrom, options.fromOffset ?? 0), anchor(toEnd, b, sideTo, options.toOffset ?? 0)]
    }

    /** Geometry from end to end at this moment, in stage coordinates. */
    routeNow(): Path {
        const [a, b] = this.anchors()
        const route = this.options.route ?? 'curve'
        if (route === 'straight') return polyPath([a.point, b.point])
        if (route === 'ortho') {
            const r = this.options.radius ?? 8
            const horizontalA = a.normal[0] !== 0, horizontalB = b.normal[0] !== 0
            if (horizontalA && horizontalB) {
                const mid = (a.point[0] + b.point[0]) / 2
                return fillet([a.point, [mid, a.point[1]], [mid, b.point[1]], b.point], r)
            }
            if (!horizontalA && !horizontalB) {
                const mid = (a.point[1] + b.point[1]) / 2
                return fillet([a.point, [a.point[0], mid], [b.point[0], mid], b.point], r)
            }
            const corner: Vec = horizontalA ? [b.point[0], a.point[1]] : [a.point[0], b.point[1]]
            return fillet([a.point, corner, b.point], r)
        }
        const distance = Math.hypot(b.point[0] - a.point[0], b.point[1] - a.point[1])
        const reach = Math.max(18, distance * (this.options.curvature ?? 0.42))
        const c1: Vec = [a.point[0] + a.normal[0] * reach, a.point[1] + a.normal[1] * reach]
        const c2: Vec = [b.point[0] + b.normal[0] * reach, b.point[1] + b.normal[1] * reach]
        return parseSvgPath(`M${a.point[0]} ${a.point[1]}C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${b.point[0]} ${b.point[1]}`)
    }

    private build(time: number): Node[] {
        const inverse: Mat = this.parent && this.parent !== null ? invert(this.worldMatrix()) : IDENTITY
        const whole = transformPath(this.routeNow(), inverse)
        const length = pathLength(whole)
        if (length < 1) return []
        const progress = this.get('trimTo')
        const options = this.options
        const stroke = this.get('stroke')
        const width = this.get('strokeWidth')
        const out: Node[] = []
        const tip = options.tip ?? true
        const tipSize = tip ? (options.tipSize ?? Math.max(7, width * 4.4)) : 0
        const shaftEnd = progress * (1 - tipSize / length)
        const shaft = trimPath(whole, this.get('trimFrom'), shaftEnd)
        const color = stroke ?? toPaint('dim')
        if (shaft.length) {
            const node = new Node(shaft).stroke(color, width)
            if (options.dash || options.flow) {
                node.dash(options.dash ?? [6, 6], options.flow ? -time * options.flow : 0)
            }
            node.set('strokeOpacity', this.get('strokeOpacity'))
            out.push(node)
        }
        if (tip && progress > 0.02) {
            const [x, y] = pointAt(whole, progress)
            const [ux, uy] = tangentAt(whole, Math.min(0.997, progress))
            const half = tipSize * 0.38
            const bx = x - ux * tipSize, by = y - uy * tipSize
            out.push(new Node(polyPath([[x, y], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]], true)).fill(color))
        }
        for (const entry of this.pulses) {
            if (time < entry.t0 || time >= entry.t1) continue
            const a = entry.ease((time - entry.t0) / (entry.t1 - entry.t0))
            const from = Math.max(0, a * (1 + entry.length) - entry.length), to = Math.min(1, a * (1 + entry.length))
            const lit = trimPath(whole, from, to)
            if (lit.length) out.push(new Node(lit).stroke(entry.color, entry.width).glow(entry.glow))
        }
        if (options.label && progress > 0.5) {
            const size = options.labelSize ?? 12
            if (!this.caption) {
                this.caption = text(options.label, { size, font: this.labelFont, color: options.labelColor ?? 'dim' })
                ownLabels(this, { labels: [this.caption] })
            }
            const textWidth = advanceWidth(this.caption)
            const pad = size * 0.35
            this.plate ??= new Node(rectPath(-textWidth / 2 - pad, -size * 0.72, textWidth + pad * 2, size * 1.44, 2)).fill(options.labelBackground ?? 'bg')
            const [mx, my] = pointAt(whole, options.labelAt ?? 0.5)
            const fade = Math.min(1, (progress - 0.5) * 4)
            out.push(this.plate.at(mx, my).opacity(fade), this.caption.at(mx, my).opacity(fade))
        }
        return out
    }

    /** Send a signal along the line. Pulses can overlap, and they follow a moving route. */
    pulse(options: AnimOptions & { color?: ColorInput; length?: number; width?: number; glow?: number } = {}): Anim {
        return {
            label: 'connector.pulse', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                this.pulses.push({
                    t0: ctx.t0, t1: ctx.t1, ease: ctx.ease,
                    color: options.color ?? 'yellow', length: options.length ?? 0.22,
                    width: options.width ?? this.get('strokeWidth') + 1.2, glow: options.glow ?? 6,
                })
            },
        }
    }

    /**
     * Send a mark along the line, as a message between the two ends: a request, an answer, a packet. The mark
     * grows in beside the first node and travels at one speed. `duration` is its time on the way, so a slow
     * message has a long one. A message that arrives goes into the node at the end. One that is lost stops on
     * the way, and one that is refused stops before the node: each has a cross, and stays for `hold`. The
     * animation lasts for the way and for what comes after it. The mark never fades, so the line under it does
     * not show through a text on it.
     */
    send(mark: Node, options: SendOptions = {}): Anim {
        oneNode('connector.send', mark, 'the mark')
        const { lost, refused = false, reverse = false } = options
        if (lost !== undefined && !(lost >= 0 && lost <= 1)) throw new Error(`connector.send: lost is the part of the way where the message is lost, from 0 to 1, and it is ${lost}`)
        if (lost !== undefined && refused) throw new Error('connector.send: a message is lost on the way or refused at the end, and this one is both. Give lost or refused')
        const travel = options.duration ?? 0.9, gap = options.gap ?? 8, hold = options.hold ?? 0.8
        // A time that is not a number would put the mark nowhere, and the film would say nothing.
        if (!(Number.isFinite(travel) && travel > 0)) throw new Error(`connector.send: duration is the time of the message on its way, in seconds, more than 0, and it is ${travel}`)
        if (!(Number.isFinite(hold) && hold >= 0)) throw new Error(`connector.send: hold is how long a message that is lost or refused stays with its cross, in seconds, 0 or more, and it is ${hold}`)
        if (!(Number.isFinite(gap) && gap >= 0)) throw new Error(`connector.send: gap is the room between the mark and a node, in pixels, 0 or more, and it is ${gap}`)
        const stopped = lost !== undefined || refused
        const after = (stopped ? hold : 0) + SEND_LEAVE
        return {
            label: 'connector.send', duration: travel + after, ease: options.ease ?? linear,
            schedule: (ctx) => {
                const stretch = (ctx.t1 - ctx.t0) / (travel + after)
                const arrives = ctx.t0 + travel * stretch, leaves = ctx.t1 - SEND_LEAVE * stretch
                // A mark is at one place at a time. A second message at the same time needs its own mark.
                const marks = ON_ITS_WAY.get(ctx.stage) ?? new Map<Node, [number, number][]>()
                ON_ITS_WAY.set(ctx.stage, marks)
                const busy = (marks.get(mark) ?? []).find(([from, to]) => ctx.t0 < to - 1e-9 && from < ctx.t1 - 1e-9)
                if (busy) throw new Error(`connector.send: the mark is on its way from ${round(busy[0])} s to ${round(busy[1])} s, and this message is from ${round(ctx.t0)} s to ${round(ctx.t1)} s. One mark is at one place at a time. Send a copy of it, such as link.send(mark.clone()), or a new mark for each message`)
                marks.set(mark, [...(marks.get(mark) ?? []), [ctx.t0, ctx.t1]])
                clock.now = ctx.t0
                reveal(this, ctx.t0, ctx.stage)
                reveal(mark, ctx.t0, ctx.stage)
                // The pivot of the mark is its middle: its place is the place of its middle, and it grows about it.
                mark.pivotAt(mark.center)
                const route = this.routeNow(), length = pathLength(route), box = mark.bounds()
                const point = (part: number): Vec => pointAt(route, reverse ? 1 - part : part)
                // Half of the mark along the line, at a part of the way.
                const half = (part: number) => {
                    const [ux, uy] = tangentAt(route, Math.min(0.999, Math.max(0.001, reverse ? 1 - part : part)))
                    return (box.width * Math.abs(ux) + box.height * Math.abs(uy)) / 2
                }
                const cross = Math.round(Math.min(box.width, box.height) * 0.92)
                // The mark starts and stops clear of the two nodes. One that is lost or refused leaves room for its
                // cross before the node, so a message that is lost at the end of its way stops there too.
                const first = (half(0) + gap) / length, last = 1 - (half(1) + gap + (stopped ? cross + gap : 0)) / length
                if (!(last > first)) throw new Error(`connector.send: the line is ${Math.round(length)} long, and a mark that is ${Math.round(box.width)} by ${Math.round(box.height)} needs more to travel. Move the two nodes apart, or send a smaller mark`)
                const stop = first + (last - first) * (lost ?? 1)
                const inverse = mark.parent ? invert(mark.parent.worldMatrix()) : IDENTITY
                const place = (alpha: number): Vec => apply(inverse, ...point(first + (stop - first) * alpha))
                mark.track('x').add({ t0: ctx.t0, t1: arrives, ease: ctx.ease, to: place(1)[0], at: (alpha) => place(alpha)[0] })
                mark.track('y').add({ t0: ctx.t0, t1: arrives, ease: ctx.ease, to: place(1)[1], at: (alpha) => place(alpha)[1] })
                // A node grows in over a moment, stays, and shrinks out. It is hidden after that, at its own size.
                const life = (node: Node, from: number) => {
                    for (const prop of ['sx', 'sy'] as const) {
                        const size = node.get(prop)
                        stepAt(node, prop, size * 0.001, from)
                        node.tween(prop, size, from, Math.min(from + SEND_GROW * stretch, (from + leaves) / 2), smooth)
                        node.tween(prop, size * 0.01, leaves, ctx.t1, smooth)
                        stepAt(node, prop, size, ctx.t1)
                    }
                    node.track('visible').step(ctx.t1, false)
                }
                life(mark, ctx.t0)
                if (!stopped) return
                // The cross is ahead of the mark, and never nearer to the node than the room at an end of the line.
                const ahead = point(Math.min(stop + (half(stop) + gap + cross / 2) / length, 1 - (gap + cross / 2) / length))
                const stopMark = pictogram('cross', { size: cross, accent: options.stopColor ?? 'red', weight: 2.4 }).at(ahead)
                ctx.stage.mountAt(stopMark, arrives)
                clock.now = arrives
                life(stopMark, arrives)
                clock.now = ctx.t0
            },
        }
    }

    /** Point at a fraction along the current route, for placing notes beside the line. */
    pointNow(fraction = 0.5): [number, number] {
        return pointAt(this.routeNow(), fraction)
    }
}

/**
 * A line from one end to another, which follows its ends while they move. An end is a node, a block of the
 * layout, or a point of the stage. At a node and at a block, the line meets the middle of the edge of the box
 * that faces the other end.
 */
export function connector(from: ConnectorEnd, to: ConnectorEnd, options: ConnectorOptions = {}): Connector {
    return new Connector(from, to, options)
}

// ── Legend ──────────────────────────────────────────────────────────────────

export interface LegendItem {
    label: string
    color?: ColorInput
    kind?: 'swatch' | 'line' | 'dash' | 'dot' | 'ring'
}

export interface LegendOptions {
    direction?: 'row' | 'column'
    size?: number
    gap?: number
    /** The font of the labels. Defaults to the font of the film. */
    font?: TextOptions['font']
}

/** A small key. Prefer direct labels. Use this when a figure holds too many marks to label. */
export function legend(items: readonly LegendItem[], options: LegendOptions = {}): Node {
    const size = options.size ?? 13
    const row = (options.direction ?? 'row') === 'row'
    const gap = options.gap ?? (row ? size * 1.5 : size * 0.6)
    const keyWidth = size * 1.5
    const made = new Node()
    let cursor = 0
    const entries: { node: Node; width: number }[] = []
    for (const item of items) {
        const color = item.color ?? 'dim'
        const kind = item.kind ?? 'swatch'
        const key = kind === 'line' ? line([-keyWidth / 2, 0], [keyWidth / 2, 0], { stroke: color, width: 2.2 })
            : kind === 'dash' ? line([-keyWidth / 2, 0], [keyWidth / 2, 0], { stroke: color, width: 2, dash: [4, 3.5] })
                : kind === 'dot' ? dot(size * 0.32, color)
                    : kind === 'ring' ? circle(size * 0.32, { stroke: color, width: 1.6 })
                        : new Node(rectPath(-size * 0.42, -size * 0.42, size * 0.84, size * 0.84, 1.5)).fill(color)
        const caption = text(item.label, { size, font: options.font, color: 'dim' })
        const width = keyWidth + size * 0.5 + advanceWidth(caption)
        const entry = new Node()
        entry.add(key.at(keyWidth / 2, 0))
        place(caption, keyWidth + size * 0.5, 0)
        entry.add(caption)
        entries.push({ node: entry, width })
    }
    const total = entries.reduce((sum, entry) => sum + entry.width, 0) + gap * Math.max(0, entries.length - 1)
    const widest = Math.max(0, ...entries.map((entry) => entry.width))
    const step = size * 1.2 + gap
    entries.forEach((entry, i) => {
        if (row) {
            entry.node.at(-total / 2 + cursor, 0)
            cursor += entry.width + gap
        } else {
            entry.node.at(-widest / 2, (i - (entries.length - 1) / 2) * step)
        }
        made.add(entry.node)
    })
    return ownLabels(made, { name: 'legend' })
}

// ── Callout ─────────────────────────────────────────────────────────────────

export interface CalloutOptions {
    title?: string
    /** Which way the text sits from its target. */
    side?: Edge
    /** Distance from the target to the text, in stage pixels. */
    distance?: number
    /** Slide the text along the other axis. */
    offset?: number
    /** Wrap width for the body. */
    width?: number
    size?: number
    color?: ColorInput
    bodyColor?: ColorInput
    /** Plate behind the text, for placing a note over busy marks. */
    plate?: boolean
    /** The font of the title and the body. Defaults to the font of the film. */
    font?: TextOptions['font']
}

/**
 * A note with a leader line back to what it describes. The leader stops at the
 * text block's edge, so it never runs through the words.
 */
export class Callout extends Node {
    readonly leader: Node
    readonly marker: Node
    readonly body: Node
    readonly titleNode: Node | null = null

    constructor(target: Node | Vec, body: string, options: CalloutOptions = {}) {
        super()
        nodeOrPoint('callout', target, 'the target')
        const size = options.size ?? 15
        const color = options.color ?? 'yellow'
        const side = options.side ?? 'right'
        const distance = options.distance ?? 72
        const wrap = options.width ?? 280
        const normal = NORMALS[side]
        const box = target instanceof Node ? target.bounds() : { x: target[0], y: target[1], width: 0, height: 0 }
        const anchor = target instanceof Node ? sidePoint(box, side, 0) : target
        const title = options.title ? text(options.title, { size, font: options.font, weight: 600, color }) : null
        const copy = text(body, { size: size * 0.94, font: options.font, color: options.bodyColor ?? 'dim', maxWidth: wrap, leading: 1.36 })
        const titleHeight = title ? size * 1.42 : 0
        const blockWidth = Math.max(copy.width, title ? advanceWidth(title) : 0)
        const copyHeight = copy.height
        const blockHeight = titleHeight + copyHeight
        const offset = options.offset ?? 0
        const blockLeft = side === 'right' ? anchor[0] + distance
            : side === 'left' ? anchor[0] - distance - blockWidth
                : anchor[0] - blockWidth / 2 + offset
        const blockTop = side === 'bottom' ? anchor[1] + distance
            : side === 'top' ? anchor[1] - distance - blockHeight
                : anchor[1] - blockHeight / 2 + offset
        if (options.plate) {
            const pad = size * 0.5
            this.add(new Node(rectPath(blockLeft - pad, blockTop - pad, blockWidth + pad * 2, blockHeight + pad * 2, 3)).fill('bg', 0.86))
        }
        if (title) {
            ;(this as { titleNode: Node | null }).titleNode = place(title, blockLeft, blockTop + size * 0.62)
            this.add(title)
        }
        copy.moveTo([blockLeft + copy.width / 2, blockTop + titleHeight + copyHeight / 2])
        this.body = copy
        this.add(copy)
        const reach: Vec = side === 'right' ? [blockLeft - 8, blockTop + blockHeight / 2]
            : side === 'left' ? [blockLeft + blockWidth + 8, blockTop + blockHeight / 2]
                : side === 'bottom' ? [blockLeft + blockWidth / 2, blockTop - 8]
                    : [blockLeft + blockWidth / 2, blockTop + blockHeight + 8]
        const elbow: Vec = normal[0] !== 0 ? [anchor[0] + normal[0] * distance * 0.45, reach[1]] : [reach[0], anchor[1] + normal[1] * distance * 0.45]
        this.leader = new Node(polyPath([anchor, elbow, reach])).stroke(color, 1.25)
        this.marker = dot(3, color).at(anchor)
        this.add(this.leader, this.marker)
        ownLabels(this, { name: 'callout' })
        // The leader ends at the target on purpose, so the film check does not judge the text of the target against it.
        if (target instanceof Node) this.data['attached'] = [target]
    }

    /** The marker lands, the leader runs out, and the text settles at the end of it. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'callout.enter', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                stepAt(this.marker, 'opacity', 0, ctx.t0)
                this.marker.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.2, ctx.ease)
                stepAt(this.leader, 'trimTo', 0, ctx.t0)
                this.leader.tween('trimTo', 1, ctx.t0, ctx.t0 + span * 0.55, ctx.ease)
                for (const child of this.children) {
                    if (child === this.marker || child === this.leader) continue
                    const target = child.get('opacity')
                    stepAt(child, 'opacity', 0, ctx.t0)
                    child.tween('opacity', target, ctx.t0 + span * 0.42, ctx.t1, ctx.ease)
                }
            },
        }
    }
}

export function callout(target: Node | Vec, body: string, options: CalloutOptions = {}): Callout {
    return new Callout(target, body, options)
}

