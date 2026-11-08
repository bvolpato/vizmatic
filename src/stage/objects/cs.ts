import { polyPath, rectPath, circlePath, parseSvgPath, smoothPath, tangentAt, pointAt, pathLength, trimPath, type Path, type Vec } from '../geometry'
import { Node } from '../node'
import { line } from '../shapes'
import { text } from '../text'
import { tex } from '../tex'
import { fontFor, glyphPath } from '../font'
import { ramp, toPaint, type ColorInput } from '../color'
import { morphMatching, par, pulse, recolor, seq, type Anim, type AnimOptions } from '../anim'
import { matchSequence } from '../morph'
import { Heatmap } from './charts'
import { Suspend } from '../stage'
import { reveal, sampleAt, seededRandom, staggered, stepAt } from './util'

// ── Graph ───────────────────────────────────────────────────────────────────

type Dagre = typeof import('@dagrejs/dagre')['default']
let dagreModule: Dagre | null = null
let dagreLoading: Promise<void> | null = null

/** Layout loads on first use, so films without graphs stay small in the browser. */
function requireDagre(): Dagre {
    if (dagreModule) return dagreModule
    dagreLoading ??= import('@dagrejs/dagre').then((module) => {
        dagreModule = (module.default ?? module) as Dagre
    })
    throw new Suspend(dagreLoading)
}

export interface GraphNodeSpec {
    id: string
    label?: string
    color?: ColorInput
    /** Circle radius. */
    radius?: number
    /** Box size. A node with a width draws as a rounded box. */
    width?: number
    height?: number
    /** Manual position, used by layout: 'manual'. */
    at?: Vec
    /** Typeset the label as math. */
    math?: boolean
}

export interface GraphEdgeSpec {
    from: string
    to: string
    label?: string
    color?: ColorInput
    width?: number
    dash?: readonly number[]
    directed?: boolean
}

export interface GraphOptions {
    layout?: 'dagre' | 'force' | 'circle' | 'manual'
    direction?: 'LR' | 'RL' | 'TB' | 'BT'
    /** Bounding size for force and circle layouts. */
    width?: number
    height?: number
    nodeGap?: number
    rankGap?: number
    radius?: number
    labelSize?: number
    edgeLabelSize?: number
    directed?: boolean
    nodeColor?: ColorInput
    edgeColor?: ColorInput
    seed?: number
    /** Fill nodes softly with their color instead of leaving them hollow. */
    fillOpacity?: number
}

export class GraphNode extends Node {
    shape!: Node
    caption: Node | null = null
    halfWidth = 0
    halfHeight = 0
    round = true

    /** Point on this node's outline facing a stage point, in graph space. */
    edgePoint(fx: number, fy: number, tx: number, ty: number, pad = 0): Vec {
        const dx = tx - fx, dy = ty - fy
        const length = Math.hypot(dx, dy) || 1
        if (this.round) return [fx + (dx / length) * (this.halfWidth + pad), fy + (dy / length) * (this.halfWidth + pad)]
        const sx = dx === 0 ? Infinity : this.halfWidth / Math.abs(dx)
        const sy = dy === 0 ? Infinity : this.halfHeight / Math.abs(dy)
        const s = Math.min(sx, sy)
        return [fx + dx * s + (dx / length) * pad, fy + dy * s + (dy / length) * pad]
    }
}

export class GraphEdge extends Node {
    shaft!: Node
    tip: Node | null = null
    caption: Node | null = null
    from = ''
    to = ''
    tipSize = 14
}

function tipPath(path: Path, size: number): { head: Path; trimmed: Path } {
    const length = pathLength(path)
    if (length <= size * 1.1) return { head: [], trimmed: path }
    const fraction = 1 - size / length
    const trimmed = trimPath(path, 0, fraction)
    const [x, y] = pointAt(path, 1)
    const [ux, uy] = tangentAt(path, 0.997)
    const half = size * 0.38
    const bx = x - ux * size, by = y - uy * size
    return {
        head: polyPath([[x, y], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]], true),
        trimmed,
    }
}

/**
 * Nodes and edges with a stable layout. `node(id)` and `edge(from, to)` return
 * ordinary nodes, so every verb works on them, and `visit` and `pulseEdge` tell
 * an algorithm's story.
 */
export class Graph extends Node {
    readonly nodes = new Map<string, GraphNode>()
    readonly edges: GraphEdge[] = []
    readonly edgeLayer = new Node()
    readonly nodeLayer = new Node()
    private readonly specs: readonly GraphNodeSpec[]

    constructor(nodes: readonly GraphNodeSpec[], edges: readonly GraphEdgeSpec[], options: GraphOptions = {}) {
        super()
        this.specs = nodes
        const defaultRadius = options.radius ?? 30
        const labelSize = options.labelSize ?? 26
        const sizeOf = (spec: GraphNodeSpec): [number, number] => spec.width
            ? [spec.width, spec.height ?? labelSize * 2]
            : [(spec.radius ?? defaultRadius) * 2, (spec.radius ?? defaultRadius) * 2]
        const layout = options.layout ?? 'dagre'
        let positions = new Map<string, Vec>()
        const routes = new Map<GraphEdgeSpec, Vec[]>()
        if (layout === 'dagre') {
            const dagre = requireDagre()
            const g = new dagre.graphlib.Graph({ multigraph: true })
            g.setGraph({
                rankdir: options.direction ?? 'LR',
                nodesep: options.nodeGap ?? 60,
                ranksep: options.rankGap ?? 110,
                edgesep: 24,
                ranker: 'network-simplex',
            })
            g.setDefaultEdgeLabel(() => ({}))
            for (const spec of nodes) {
                const [width, height] = sizeOf(spec)
                g.setNode(spec.id, { width, height })
            }
            edges.forEach((edge, i) => g.setEdge(edge.from, edge.to, {}, String(i)))
            dagre.layout(g)
            const info = g.graph() as { width?: number; height?: number }
            const cx = (info.width ?? 0) / 2, cy = (info.height ?? 0) / 2
            for (const spec of nodes) {
                const placed = g.node(spec.id)
                positions.set(spec.id, [placed.x - cx, placed.y - cy])
            }
            edges.forEach((edge, i) => {
                const data = g.edge({ v: edge.from, w: edge.to, name: String(i) }) as { points?: { x: number; y: number }[] }
                if (data?.points) routes.set(edge, data.points.map((point) => [point.x - cx, point.y - cy]))
            })
        } else if (layout === 'circle') {
            const radius = Math.min(options.width ?? 700, options.height ?? 700) / 2
            nodes.forEach((spec, i) => {
                const angle = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2
                positions.set(spec.id, [Math.cos(angle) * radius, Math.sin(angle) * radius])
            })
        } else if (layout === 'force') {
            positions = forceLayout(nodes, edges, options.width ?? 900, options.height ?? 620, options.seed ?? 3)
        } else {
            for (const spec of nodes) positions.set(spec.id, spec.at ?? [0, 0])
        }
        const nodeColor = options.nodeColor ?? 'blue'
        for (const spec of nodes) {
            const view = new GraphNode()
            const color = spec.color ?? nodeColor
            const [width, height] = sizeOf(spec)
            view.halfWidth = width / 2
            view.halfHeight = height / 2
            view.round = !spec.width
            view.shape = new Node(spec.width ? rectPath(-width / 2, -height / 2, width, height, 8) : circlePath(0, 0, width / 2))
                .fill(color, options.fillOpacity ?? 0.16)
                .stroke(color, 2.5)
            view.add(view.shape)
            if (spec.label) {
                view.caption = spec.math
                    ? tex(spec.label, { size: labelSize, color: 'ink', display: false })
                    : text(spec.label, { size: labelSize, color: 'ink' })
                view.add(view.caption.at(0, 0))
            }
            view.named(spec.id)
            view.at(positions.get(spec.id) ?? [0, 0])
            this.nodes.set(spec.id, view)
            this.nodeLayer.add(view)
        }
        const directed = options.directed ?? true
        const edgeColor = options.edgeColor ?? 'dim'
        const edgeLabelSize = options.edgeLabelSize ?? 20
        for (const spec of edges) {
            const from = this.nodes.get(spec.from), to = this.nodes.get(spec.to)
            if (!from || !to) throw new Error(`Graph edge ${spec.from} -> ${spec.to} refers to a node that does not exist.`)
            const view = new GraphEdge()
            view.from = spec.from
            view.to = spec.to
            const a = positions.get(spec.from)!, b = positions.get(spec.to)!
            const route = routes.get(spec)
            const horizontal = (options.direction ?? 'LR') === 'LR' || options.direction === 'RL'
            const path = routeEdge(from, to, a, b, route, horizontal)
            const isDirected = spec.directed ?? directed
            const color = spec.color ?? edgeColor
            const { head, trimmed } = isDirected ? tipPath(path, view.tipSize) : { head: [] as Path, trimmed: path }
            view.shaft = new Node(trimmed).stroke(color, spec.width ?? 2.2)
            if (spec.dash) view.shaft.dash(spec.dash)
            view.add(view.shaft)
            if (head.length) {
                view.tip = new Node(head).fill(color)
                view.add(view.tip)
            }
            if (spec.label) {
                const [mx, my] = pointAt(path, 0.5)
                const caption = text(spec.label, { size: edgeLabelSize, color: 'ink', font: 'mono' }).at(mx, my)
                const pad = edgeLabelSize * 0.34
                const plate = new Node(rectPath(mx - caption.width / 2 - pad, my - edgeLabelSize * 0.68, caption.width + pad * 2, edgeLabelSize * 1.36, 4)).fill('bg')
                view.caption = new Node().add(plate, caption)
                view.add(view.caption)
            }
            this.edges.push(view)
            this.edgeLayer.add(view)
        }
        this.add(this.edgeLayer, this.nodeLayer)
    }

    node(id: string): GraphNode {
        const found = this.nodes.get(id)
        if (!found) throw new Error(`Graph has no node ${JSON.stringify(id)}.`)
        return found
    }

    edge(from: string, to: string): GraphEdge {
        const found = this.edges.find((edge) => (edge.from === from && edge.to === to))
            ?? this.edges.find((edge) => edge.from === to && edge.to === from)
        if (!found) throw new Error(`Graph has no edge ${from} -> ${to}.`)
        return found
    }

    /** Nodes pop in by order, and each edge draws as its source is shown. */
    enter(options: AnimOptions = {}): Anim {
        const lag = options.lag ?? 0.14
        return {
            label: 'graph.enter', duration: options.duration ?? 2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const ordered = this.specs.map((spec) => this.nodes.get(spec.id)!)
                const windows = staggered(ordered.length, lag, ctx.t0, ctx.t0 + (ctx.t1 - ctx.t0) * 0.78)
                const startOf = new Map<GraphNode, number>()
                ordered.forEach((view, i) => {
                    const [start, end] = windows[i]!
                    startOf.set(view, end)
                    popIn(view, ctx.t0, start, end, ctx.ease)
                })
                for (const edge of this.edges) {
                    const start = startOf.get(this.nodes.get(edge.from)!) ?? ctx.t0
                    const end = Math.min(ctx.t1, start + (ctx.t1 - ctx.t0) * 0.22)
                    stepAt(edge.shaft, 'trimTo', 0, ctx.t0)
                    edge.shaft.tween('trimTo', 1, start, end, ctx.ease)
                    for (const part of [edge.tip, edge.caption]) {
                        if (!part) continue
                        stepAt(part, 'opacity', 0, ctx.t0)
                        part.tween('opacity', 1, end - (end - start) * 0.3, end, ctx.ease)
                    }
                }
            },
        }
    }

    /** A lit signal travels along an edge. */
    pulseEdge(from: string, to: string, options: AnimOptions & { color?: ColorInput; length?: number } = {}): Anim {
        const edge = this.edge(from, to)
        return { ...pulse(edge.shaft, { color: options.color ?? 'yellow', length: options.length ?? 0.3, ...options }), label: 'graph.pulse' }
    }

    /** Mark a node as reached: its color changes and it swells for a moment. */
    visit(id: string, options: AnimOptions & { color?: ColorInput } = {}): Anim {
        const view = this.node(id)
        const color = options.color ?? 'yellow'
        return {
            label: 'graph.visit', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                const paint = toPaint(color)
                view.shape.tween('stroke', paint, ctx.t0, ctx.t1, ctx.ease)
                view.shape.tween('fill', paint, ctx.t0, ctx.t1, ctx.ease)
                const span = ctx.t1 - ctx.t0
                const sx = view.get('sx')
                view.tween('sx', sx * 1.16, ctx.t0, ctx.t0 + span * 0.45, ctx.ease)
                view.tween('sy', sx * 1.16, ctx.t0, ctx.t0 + span * 0.45, ctx.ease)
                view.tween('sx', sx, ctx.t0 + span * 0.45, ctx.t1, ctx.ease)
                view.tween('sy', sx, ctx.t0 + span * 0.45, ctx.t1, ctx.ease)
            },
        }
    }

    /** Move a node. Its edges follow, re-routed as straight lines. */
    moveNode(id: string, to: Vec, options: AnimOptions = {}): Anim {
        const view = this.node(id)
        return {
            label: 'graph.move', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                const fromX = view.get('x'), fromY = view.get('y')
                view.tween('x', to[0], ctx.t0, ctx.t1, ctx.ease)
                view.tween('y', to[1], ctx.t0, ctx.t1, ctx.ease)
                for (const edge of this.edges) {
                    if (edge.from !== id && edge.to !== id) continue
                    const other = this.node(edge.from === id ? edge.to : edge.from)
                    const ox = sampleAt(other, 'x', ctx.t0), oy = sampleAt(other, 'y', ctx.t0)
                    const geometry = (a: number) => {
                        const x = fromX + (to[0] - fromX) * a, y = fromY + (to[1] - fromY) * a
                        const start = edge.from === id ? view.edgePoint(x, y, ox, oy, 2) : other.edgePoint(ox, oy, x, y, 2)
                        const end = edge.from === id ? other.edgePoint(ox, oy, x, y, 4) : view.edgePoint(x, y, ox, oy, 4)
                        return polyPath([start, end])
                    }
                    const shaftAt = (a: number) => edge.tip ? tipPath(geometry(a), edge.tipSize).trimmed : geometry(a)
                    edge.shaft.track('path').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: shaftAt(1), at: shaftAt })
                    if (edge.tip) {
                        const tipAt = (a: number) => tipPath(geometry(a), edge.tipSize).head
                        edge.tip.track('path').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: tipAt(1), at: tipAt })
                    }
                }
            },
        }
    }
}

/** A smooth line from outline to outline. Dagre's bend points shape only long edges. */
function routeEdge(from: GraphNode, to: GraphNode, a: Vec, b: Vec, route: readonly Vec[] | undefined, horizontal: boolean): Path {
    const interior = route ? route.slice(1, -1) : []
    const firstTarget = interior[0] ?? b, lastSource = interior[interior.length - 1] ?? a
    const start = from.edgePoint(a[0], a[1], firstTarget[0], firstTarget[1], 2)
    const end = to.edgePoint(b[0], b[1], lastSource[0], lastSource[1], 4)
    if (!route) return polyPath([start, end])
    if (interior.length <= 1) {
        const dx = end[0] - start[0], dy = end[1] - start[1]
        if (Math.abs(horizontal ? dy : dx) < 2) return polyPath([start, end])
        const reach = (horizontal ? dx : dy) * 0.5
        const c1 = horizontal ? `${start[0] + reach} ${start[1]}` : `${start[0]} ${start[1] + reach}`
        const c2 = horizontal ? `${end[0] - reach} ${end[1]}` : `${end[0]} ${end[1] - reach}`
        return parseSvgPath(`M${start[0]} ${start[1]}C${c1} ${c2} ${end[0]} ${end[1]}`)
    }
    return smoothPath([start, ...interior.slice(1, -1), end])
}

function popIn(node: Node, hideFrom: number, start: number, end: number, ease: (t: number) => number): void {
    const sx = sampleAt(node, 'sx', start), sy = sampleAt(node, 'sy', start)
    stepAt(node, 'sx', sx * 0.001, hideFrom)
    stepAt(node, 'sy', sy * 0.001, hideFrom)
    node.tween('sx', sx, start, end, ease)
    node.tween('sy', sy, start, end, ease)
}

function forceLayout(nodes: readonly GraphNodeSpec[], edges: readonly GraphEdgeSpec[], width: number, height: number, seed: number): Map<string, Vec> {
    const random = seededRandom(seed)
    const ids = nodes.map((spec) => spec.id)
    const x = new Float64Array(ids.length), y = new Float64Array(ids.length)
    for (let i = 0; i < ids.length; i++) {
        x[i] = (random() - 0.5) * width
        y[i] = (random() - 0.5) * height
    }
    const index = new Map(ids.map((id, i) => [id, i]))
    const k = Math.sqrt((width * height) / Math.max(1, ids.length)) * 0.72
    let temperature = Math.max(width, height) * 0.12
    for (let round = 0; round < 420; round++) {
        const dx = new Float64Array(ids.length), dy = new Float64Array(ids.length)
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const ox = x[i]! - x[j]!, oy = y[i]! - y[j]!
                const d = Math.max(1, Math.hypot(ox, oy))
                const force = k * k / d
                dx[i]! += ox / d * force
                dy[i]! += oy / d * force
                dx[j]! -= ox / d * force
                dy[j]! -= oy / d * force
            }
        }
        for (const edge of edges) {
            const a = index.get(edge.from), b = index.get(edge.to)
            if (a === undefined || b === undefined) continue
            const ox = x[a]! - x[b]!, oy = y[a]! - y[b]!
            const d = Math.max(1, Math.hypot(ox, oy))
            const force = d * d / k
            dx[a]! -= ox / d * force
            dy[a]! -= oy / d * force
            dx[b]! += ox / d * force
            dy[b]! += oy / d * force
        }
        for (let i = 0; i < ids.length; i++) {
            const length = Math.max(1e-6, Math.hypot(dx[i]!, dy[i]!))
            x[i]! += dx[i]! / length * Math.min(length, temperature)
            y[i]! += dy[i]! / length * Math.min(length, temperature)
            x[i] = Math.max(-width / 2, Math.min(width / 2, x[i]!))
            y[i] = Math.max(-height / 2, Math.min(height / 2, y[i]!))
        }
        temperature *= 0.985
    }
    return new Map(ids.map((id, i) => [id, [x[i]!, y[i]!] as Vec]))
}

export function graph(nodes: readonly GraphNodeSpec[], edges: readonly GraphEdgeSpec[], options: GraphOptions = {}): Graph {
    return new Graph(nodes, edges, options)
}

// ── Tree ────────────────────────────────────────────────────────────────────

export interface TreeSpec {
    id?: string
    label?: string
    color?: ColorInput
    children?: readonly TreeSpec[]
    math?: boolean
}

export interface TreeOptions extends Pick<GraphOptions, 'radius' | 'labelSize' | 'nodeColor' | 'edgeColor' | 'fillOpacity'> {
    levelGap?: number
    siblingGap?: number
    direction?: 'down' | 'right'
}

/** A tidy tree: parents center over children, and subtrees never overlap. */
export class TreeGraph extends Graph {
    readonly depths = new Map<string, number>()

    constructor(root: TreeSpec, options: TreeOptions = {}) {
        const specs: GraphNodeSpec[] = []
        const links: GraphEdgeSpec[] = []
        const depthOf = new Map<string, number>()
        const levelGap = options.levelGap ?? 130
        const siblingGap = options.siblingGap ?? 96
        let counter = 0
        let leafCursor = 0
        const place = (node: TreeSpec, depth: number): { id: string; position: number } => {
            const id = node.id ?? `n${counter++}`
            depthOf.set(id, depth)
            const children = node.children ?? []
            let position: number
            const entry: GraphNodeSpec = { id, label: node.label, color: node.color, math: node.math }
            specs.push(entry)
            if (children.length === 0) {
                position = leafCursor++
            } else {
                const placed = children.map((child) => place(child, depth + 1))
                position = (placed[0]!.position + placed[placed.length - 1]!.position) / 2
                for (const child of placed) links.push({ from: id, to: child.id, directed: false })
            }
            ;(entry as { at?: Vec }).at = options.direction === 'right'
                ? [depth * levelGap, position * siblingGap]
                : [position * siblingGap, depth * levelGap]
            return { id, position }
        }
        place(root, 0)
        const xs = specs.map((spec) => spec.at![0]), ys = specs.map((spec) => spec.at![1])
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
        for (const spec of specs) (spec as { at?: Vec }).at = [spec.at![0] - cx, spec.at![1] - cy]
        super(specs, links, { layout: 'manual', radius: options.radius ?? 28, labelSize: options.labelSize ?? 24, nodeColor: options.nodeColor, edgeColor: options.edgeColor, fillOpacity: options.fillOpacity, directed: false })
        for (const [id, depth] of depthOf) this.depths.set(id, depth)
    }

    /** Grow from the root, one level at a time. */
    override enter(options: AnimOptions = {}): Anim {
        return {
            label: 'tree.enter', duration: options.duration ?? 2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const levels = Math.max(...this.depths.values()) + 1
                const span = (ctx.t1 - ctx.t0) / levels
                for (const [id, view] of this.nodes) {
                    const depth = this.depths.get(id) ?? 0
                    const start = ctx.t0 + depth * span
                    popIn(view, ctx.t0, start, start + span, ctx.ease)
                }
                for (const edge of this.edges) {
                    const depth = this.depths.get(edge.to) ?? 1
                    const start = ctx.t0 + (depth - 1) * span + span * 0.3
                    stepAt(edge.shaft, 'trimTo', 0, ctx.t0)
                    edge.shaft.tween('trimTo', 1, start, start + span * 0.8, ctx.ease)
                }
            },
        }
    }
}

export function tree(root: TreeSpec, options: TreeOptions = {}): TreeGraph {
    return new TreeGraph(root, options)
}

// ── Array cells ─────────────────────────────────────────────────────────────

export interface ArrayCellsOptions {
    cell?: number
    gap?: number
    size?: number
    color?: ColorInput
    indices?: boolean
    indexSize?: number
    font?: 'mono' | 'sans'
}

/** A row of boxes. `swap(i, j)` lifts two items over each other, and `.cell(i)` follows them. */
export class ArrayCells extends Node {
    readonly slots: Node[] = []
    readonly indexLabels: Node[] = []
    /** The item at each index, updated as swaps are authored. */
    readonly items: Node[] = []
    private readonly cellSize: number
    private readonly step: number

    constructor(values: readonly (string | number)[], options: ArrayCellsOptions = {}) {
        super()
        const cell = this.cellSize = options.cell ?? 72
        const gap = options.gap ?? 6
        this.step = cell + gap
        const size = options.size ?? cell * 0.38
        const color = options.color ?? 'blue'
        const left = -((values.length - 1) * this.step) / 2
        values.forEach((_, i) => {
            const x = left + i * this.step
            const slot = new Node(rectPath(-cell / 2, -cell / 2, cell, cell, 6)).stroke('faint', 1.5).at(x, 0)
            this.slots.push(slot)
            this.add(slot)
            if (options.indices ?? true) {
                const label = text(String(i), { size: options.indexSize ?? Math.max(13, cell * 0.2), color: 'faint', font: 'mono' }).at(x, cell / 2 + (options.indexSize ?? cell * 0.2) + 2)
                this.indexLabels.push(label)
                this.add(label)
            }
        })
        values.forEach((value, i) => {
            const x = left + i * this.step
            const item = new Node().at(x, 0)
            const box = new Node(rectPath(-cell / 2 + 2, -cell / 2 + 2, cell - 4, cell - 4, 5)).fill(color, 0.16).stroke(color, 2)
            const glyphs = text(String(value), { size, font: options.font ?? 'mono', color: 'ink' }).at(0, 0)
            item.add(box, glyphs)
            item.data['box'] = box
            item.data['value'] = value
            this.items.push(item)
            this.add(item)
        })
    }

    /** The item currently at an index. */
    cell(index: number): Node {
        const found = this.items[index]
        if (!found) throw new Error(`Array has no index ${index}.`)
        return found
    }

    /** Local stage position of a slot. */
    slotAt(index: number): Vec {
        return [this.slots[index]!.get('x'), this.slots[index]!.get('y')]
    }

    /** Exchange two items along opposite arcs. */
    swap(i: number, j: number, options: AnimOptions & { lift?: number } = {}): Anim {
        return {
            label: 'array.swap', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                const a = this.items[i]!, b = this.items[j]!
                const [ax, ay] = this.slotAt(i), [bx, by] = this.slotAt(j)
                const lift = options.lift ?? this.cellSize * 0.9 + Math.abs(i - j) * 6
                const arc = (node: Node, fx: number, fy: number, tx: number, ty: number, sign: number) => {
                    node.track('x').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: tx, at: (t) => fx + (tx - fx) * t })
                    node.track('y').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: ty, at: (t) => fy + (ty - fy) * t - sign * lift * 4 * t * (1 - t) })
                }
                arc(a, ax, ay, bx, by, 1)
                arc(b, bx, by, ax, ay, -1)
                this.items[i] = b
                this.items[j] = a
            },
        }
    }

    /** Recolor an item. */
    mark(index: number, color: ColorInput, options: AnimOptions = {}): Anim {
        const item = this.cell(index)
        return { ...recolor(item.data['box'] as Node, color, { duration: 0.35, ...options }), label: 'array.mark' }
    }

    /** Cells appear from left to right. */
    enter(options: AnimOptions = {}): Anim {
        const lag = options.lag ?? 0.2
        return {
            label: 'array.enter', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const windows = staggered(this.items.length, lag, ctx.t0, ctx.t1)
                this.items.forEach((item, i) => {
                    const [start, end] = windows[i]!
                    popIn(item, ctx.t0, start, end, ctx.ease)
                    stepAt(this.slots[i]!, 'opacity', 0, ctx.t0)
                    this.slots[i]!.tween('opacity', 1, start, end, ctx.ease)
                    const index = this.indexLabels[i]
                    if (index) {
                        stepAt(index, 'opacity', 0, ctx.t0)
                        index.tween('opacity', 1, start, end, ctx.ease)
                    }
                })
            },
        }
    }
}

export function arrayCells(values: readonly (string | number)[], options: ArrayCellsOptions = {}): ArrayCells {
    return new ArrayCells(values, options)
}

// ── Code ────────────────────────────────────────────────────────────────────

export type TokenKind = 'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type' | 'punctuation' | 'plain' | 'space'

export interface CodeToken {
    text: string
    kind: TokenKind
    line: number
    glyphs: Node[]
}

const KEYWORDS: Record<string, ReadonlySet<string>> = {
    ts: new Set('const let var function return if else for while do switch case break continue new class extends implements interface type enum import export from default async await yield try catch finally throw typeof instanceof in of this super null undefined true false void as readonly public private protected static get set'.split(' ')),
    python: new Set('def return if elif else for while in not and or is class import from as with try except finally raise lambda yield pass break continue global nonlocal None True False self async await assert del print'.split(' ')),
    rust: new Set('fn let mut pub struct enum impl trait use mod match if else for while loop return self Self as in where const static crate super true false ref move async await dyn type'.split(' ')),
    go: new Set('func var const type struct interface package import return if else for range switch case default break continue go defer select chan map nil true false'.split(' ')),
    sql: new Set('select from where join left right inner outer on group by order having limit as and or not in is null insert into values update set delete create table with distinct count sum avg min max'.split(' ')),
    bash: new Set('if then else elif fi for do done while case esac in function return export local echo cd exit set'.split(' ')),
    plain: new Set(),
}

/** A small tokenizer for film code. It colors the common cases and never blocks on odd input. */
export function tokenize(source: string, language = 'ts'): Omit<CodeToken, 'glyphs'>[] {
    const lang = language === 'js' || language === 'tsx' || language === 'jsx' || language === 'typescript' || language === 'javascript' ? 'ts' : language === 'py' ? 'python' : language
    const keywords = KEYWORDS[lang] ?? KEYWORDS['ts']!
    const insensitive = lang === 'sql'
    const hashComment = lang === 'python' || lang === 'bash'
    const dashComment = lang === 'sql'
    const out: Omit<CodeToken, 'glyphs'>[] = []
    source.split('\n').forEach((row, line) => {
        let i = 0
        while (i < row.length) {
            const rest = row.slice(i)
            const push = (value: string, kind: TokenKind) => {
                out.push({ text: value, kind, line })
                i += value.length
            }
            const space = /^\s+/.exec(rest)
            if (space) {
                push(space[0], 'space')
                continue
            }
            if ((!hashComment && !dashComment && rest.startsWith('//')) || (hashComment && rest[0] === '#') || (dashComment && rest.startsWith('--'))) {
                push(rest, 'comment')
                continue
            }
            const string = /^("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)/.exec(rest)
            if (string) {
                push(string[0], 'string')
                continue
            }
            const number = /^(0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:e[-+]?\d+)?)/.exec(rest)
            if (number) {
                push(number[0], 'number')
                continue
            }
            const word = /^[A-Za-z_$][\w$]*/.exec(rest)
            if (word) {
                const value = word[0]
                const after = rest.slice(value.length)
                const isKeyword = keywords.has(insensitive ? value.toLowerCase() : value)
                const kind: TokenKind = isKeyword ? 'keyword'
                    : /^\s*\(/.test(after) ? 'function'
                        : /^[A-Z]/.test(value) ? 'type'
                            : 'plain'
                push(value, kind)
                continue
            }
            push(rest[0]!, 'punctuation')
        }
    })
    return out
}

const CODE_COLORS: Record<Exclude<TokenKind, 'space'>, string> = {
    keyword: 'purple', string: 'green', number: 'orange', comment: 'faint',
    function: 'blue', type: 'teal', punctuation: 'dim', plain: 'ink',
}

export interface CodeBlockOptions {
    language?: string
    size?: number
    /** Line height as a multiple of size. */
    leading?: number
    lineNumbers?: boolean
    /** Draw a quiet panel behind the code. */
    panel?: boolean
    padding?: number
    /** Minimum panel width, so versions of a snippet can share one frame. */
    minWidth?: number
    colors?: Partial<Record<Exclude<TokenKind, 'space'>, ColorInput>>
}

/**
 * Syntax-colored code as real glyphs. It can be written on, focused line by
 * line, and morphed token by token into a new version with `morphCode`.
 */
export class CodeBlock extends Node {
    readonly lines: Node[] = []
    readonly tokens: CodeToken[] = []
    readonly chars: Node[] = []
    readonly panelNode: Node | null = null
    readonly body = new Node()
    readonly source: string
    private readonly bar: Node
    private readonly rowHeight: number
    private readonly originY: number
    private readonly contentWidth: number

    constructor(source: string, options: CodeBlockOptions = {}) {
        super()
        this.source = source
        const size = options.size ?? 26
        const rowHeight = this.rowHeight = size * (options.leading ?? 1.5)
        const font = fontFor('mono', 400)
        const scale = size / font.unitsPerEm
        const advance = font.advance(font.glyphFor(48)) * scale
        const tokens = tokenize(source, options.language ?? 'ts')
        const rows = source.split('\n')
        const gutter = options.lineNumbers ? (String(rows.length).length + 2) * advance : 0
        const pad = options.padding ?? size * 0.9
        const width = Math.max(options.minWidth ?? 0, Math.max(...rows.map((row) => row.length)) * advance + gutter + pad * 2)
        const height = rows.length * rowHeight + pad * 2 - (rowHeight - size)
        this.contentWidth = width
        const left = -width / 2 + pad + gutter, top = -height / 2 + pad + size * 0.82
        this.originY = top
        if (options.panel ?? true) {
            const panel = new Node(rectPath(-width / 2, -height / 2, width, height, 8)).fill('surface').stroke('gridStrong', 1)
            ;(this as { panelNode: Node | null }).panelNode = panel
            this.add(panel)
        }
        // No geometry until first focused, so a morph of an unfocused block ignores it.
        this.bar = new Node().fill('yellow', 0.1)
        this.bar.base.visible = false
        this.add(this.bar)
        for (let i = 0; i < rows.length; i++) {
            const line = new Node()
            this.lines.push(line)
            this.body.add(line)
            if (options.lineNumbers) {
                const label = String(i + 1).padStart(String(rows.length).length, ' ')
                let cx = left - gutter
                for (const char of label) {
                    if (char !== ' ') line.add(makeGlyph(font, char, size, 'faint', cx, top + i * rowHeight))
                    cx += advance
                }
            }
        }
        const colors = { ...CODE_COLORS, ...options.colors }
        const column = new Map<number, number>()
        for (const token of tokens) {
            const start = column.get(token.line) ?? 0
            column.set(token.line, start + token.text.length)
            const entry: CodeToken = { ...token, glyphs: [] }
            this.tokens.push(entry)
            if (token.kind === 'space') continue
            const color = colors[token.kind]
            ;[...token.text].forEach((char, offset) => {
                const leaf = makeGlyph(font, char, size, color, left + (start + offset) * advance, top + token.line * rowHeight)
                entry.glyphs.push(leaf)
                this.chars.push(leaf)
                this.lines[token.line]!.add(leaf)
            })
        }
        this.add(this.body)
    }

    /** One line of code, as a node. Lines count from 0. */
    line(index: number): Node {
        const found = this.lines[index]
        if (!found) throw new Error(`Code has no line ${index}.`)
        return found
    }

    /**
     * Glyphs of the code that matches. A fragment that is one token, such as `lo`, matches every such token.
     * Any other fragment, such as `lo + hi`, matches as text inside a line, and spaces do not count.
     * Pass a line, counted from 0, to search that line only.
     */
    find(fragment: string, line?: number): Node[] {
        if (line !== undefined && !this.lines[line]) throw new Error(`Code has no line ${line}.`)
        const tokens = this.tokens.filter((token) => line === undefined || token.line === line)
        const exact = tokens.filter((token) => token.text === fragment)
        if (exact.length > 0) return exact.flatMap((token) => token.glyphs)
        const needle = fragment.replace(/\s/g, '')
        if (!needle) return []
        const out: Node[] = []
        for (let row = 0; row < this.lines.length; row++) {
            const glyphs = tokens.filter((token) => token.line === row).flatMap((token) => token.glyphs)
            const keys = glyphs.map((glyph) => glyph.data['key'] as string).join('')
            // A key is one character, so an index in the text is an index in the glyphs.
            for (let at = keys.indexOf(needle); at >= 0; at = keys.indexOf(needle, at + needle.length)) {
                out.push(...glyphs.slice(at, at + [...needle].length))
            }
        }
        return out
    }

    /** Dim everything except these lines, and lay a soft bar behind them. */
    focus(lines: number | readonly number[], options: AnimOptions & { dim?: number; color?: ColorInput } = {}): Anim {
        const wanted = new Set(typeof lines === 'number' ? [lines] : lines)
        return {
            label: 'code.focus', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                this.lines.forEach((line, i) => {
                    line.tween('opacity', wanted.has(i) ? 1 : options.dim ?? 0.28, ctx.t0, ctx.t1, ctx.ease)
                })
                const sorted = [...wanted].sort((a, b) => a - b)
                const first = sorted[0] ?? 0, last = sorted[sorted.length - 1] ?? first
                const y = this.originY - this.rowHeight * 0.32 + ((first + last) / 2) * this.rowHeight
                const spanRows = last - first + 1
                const barPath = rectPath(-this.contentWidth / 2 + 2, -this.rowHeight * spanRows / 2, this.contentWidth - 4, this.rowHeight * spanRows, 3)
                const wasVisible = sampleAt(this.bar, 'visible', ctx.t0)
                if (!wasVisible) {
                    stepAt(this.bar, 'x', 0, ctx.t0)
                    stepAt(this.bar, 'y', y, ctx.t0)
                    this.bar.track('path').step(ctx.t0, barPath)
                    stepAt(this.bar, 'visible', true, ctx.t0)
                    stepAt(this.bar, 'opacity', 0, ctx.t0)
                    this.bar.tween('opacity', 1, ctx.t0, ctx.t1, ctx.ease)
                } else {
                    this.bar.tween('y', y, ctx.t0, ctx.t1, ctx.ease)
                    this.bar.tween('path', barPath, ctx.t0, ctx.t1, ctx.ease)
                }
                if (options.color) this.bar.tween('fill', toPaint(options.color), ctx.t0, ctx.t1, ctx.ease)
            },
        }
    }

    /** Restore all lines and remove the focus bar. */
    unfocus(options: AnimOptions = {}): Anim {
        return {
            label: 'code.unfocus', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                for (const line of this.lines) line.tween('opacity', 1, ctx.t0, ctx.t1, ctx.ease)
                this.bar.tween('opacity', 0, ctx.t0, ctx.t1, ctx.ease)
                stepAt(this.bar, 'visible', false, ctx.t1)
            },
        }
    }
}

function makeGlyph(font: ReturnType<typeof fontFor>, char: string, size: number, color: ColorInput, x: number, baseline: number): Node {
    const leaf = new Node(glyphPath(font, font.glyphFor(char.codePointAt(0)!), size))
    leaf.base.fill = toPaint(color)
    leaf.base.trimEach = true
    leaf.data['key'] = char
    return leaf.at(x, baseline)
}

export function codeBlock(source: string, options: CodeBlockOptions = {}): CodeBlock {
    return new CodeBlock(source, options)
}

/**
 * Morph one version of code into another. Tokens are matched in order, so
 * unchanged code slides to its new place and only real edits fade.
 */
export function morphCode(from: CodeBlock, to: CodeBlock, options: AnimOptions = {}): Anim {
    const visible = (block: CodeBlock) => block.tokens.filter((token) => token.kind !== 'space' && token.glyphs.length > 0)
    const a = visible(from), b = visible(to)
    const pairs = matchSequence(a.map((token) => token.text), b.map((token) => token.text))
    const keys = new Map<Node, unknown>()
    pairs.forEach(([i, j], pair) => {
        a[i]!.glyphs.forEach((glyph, k) => keys.set(glyph, `m${pair}:${k}`))
        b[j]!.glyphs.forEach((glyph, k) => keys.set(glyph, `m${pair}:${k}`))
    })
    if (from.panelNode && to.panelNode) {
        keys.set(from.panelNode, 'panel')
        keys.set(to.panelNode, 'panel')
    }
    let unique = 0
    const anim = morphMatching(from, to, {
        duration: 1.5, ...options,
        key: (leaf) => {
            let key = keys.get(leaf)
            if (key === undefined) {
                key = `only:${unique++}`
                keys.set(leaf, key)
            }
            return key
        },
    })
    return { ...anim, label: 'morphCode' }
}

// ── Neural network ──────────────────────────────────────────────────────────

export interface NeuralNetOptions {
    width?: number
    height?: number
    radius?: number
    /** Show at most this many neurons per layer, with an ellipsis for the rest. */
    collapse?: number
    colors?: readonly ColorInput[]
    edgeColor?: ColorInput
    edgeOpacity?: number
    layerLabels?: readonly string[]
    labelSize?: number
    /** Seed for the default activations. */
    seed?: number
}

/** Layers of neurons joined by hairline weights. `forward()` runs a signal through it. */
export class NeuralNet extends Node {
    readonly neurons: Node[][] = []
    /** Edges between layer i and layer i + 1, by [from][to]. */
    readonly links: Node[][][] = []
    readonly edgeLayer = new Node()
    readonly neuronLayer = new Node()
    readonly captions: Node[] = []
    private readonly seed: number
    private readonly layerColors: readonly ColorInput[]

    constructor(layers: readonly number[], options: NeuralNetOptions = {}) {
        super()
        const width = options.width ?? 1000
        const height = options.height ?? 560
        const radius = options.radius ?? 15
        const collapse = options.collapse ?? 8
        const columnGap = layers.length > 1 ? width / (layers.length - 1) : 0
        this.seed = options.seed ?? 11
        this.layerColors = options.colors ?? ['blue', 'teal', 'teal', 'yellow']
        const edgeColor = options.edgeColor ?? 'dim'
        const edgeOpacity = options.edgeOpacity ?? 0.32
        const positions: Vec[][] = []
        layers.forEach((count, l) => {
            const shown = count > collapse ? collapse : count
            const step = Math.min(radius * 3.6, height / Math.max(1, shown + (count > collapse ? 1 : 0)))
            const x = -width / 2 + l * columnGap
            const column: Vec[] = []
            const views: Node[] = []
            const color = this.layerColors[Math.min(l, this.layerColors.length - 1)]!
            const keepTop = Math.ceil(shown / 2)
            for (let i = 0; i < shown + (count > collapse ? 1 : 0); i++) {
                const y = (i - (shown + (count > collapse ? 1 : 0) - 1) / 2) * step
                if (count > collapse && i === keepTop) {
                    this.neuronLayer.add(tex('\\vdots', { size: radius * 1.9, color: 'dim', display: false }).at(x, y))
                    continue
                }
                column.push([x, y])
                const neuron = new Node(circlePath(0, 0, radius)).stroke(color, 2.2).fill(color, 0.08).at(x, y)
                views.push(neuron)
                this.neuronLayer.add(neuron)
            }
            positions.push(column)
            this.neurons.push(views)
            const name = options.layerLabels?.[l]
            if (name) {
                const size = options.labelSize ?? 22
                const caption = text(name, { size, color: 'dim' }).at(x, height / 2 + size * 1.5)
                this.captions.push(caption)
                this.add(caption)
            }
        })
        for (let l = 0; l + 1 < positions.length; l++) {
            const rows: Node[][] = []
            for (const a of positions[l]!) {
                const row: Node[] = []
                for (const b of positions[l + 1]!) {
                    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
                    const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length
                    const link = line([a[0] + ux * radius, a[1] + uy * radius], [b[0] - ux * radius, b[1] - uy * radius], { stroke: edgeColor, width: 1.1 })
                    link.set('strokeOpacity', edgeOpacity)
                    row.push(link)
                    this.edgeLayer.add(link)
                }
                rows.push(row)
            }
            this.links.push(rows)
        }
        this.add(this.edgeLayer, this.neuronLayer)
    }

    layer(index: number): Node[] {
        return this.neurons[index] ?? []
    }

    /** Neurons appear layer by layer, then the weights draw between them. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'net.enter', duration: options.duration ?? 2.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                const layers = this.neurons.length
                const each = span * 0.45
                const gap = layers > 1 ? (span * 0.55) / (layers - 1) : 0
                this.neurons.forEach((views, l) => {
                    const windows = staggered(views.length, 0.12, ctx.t0 + l * gap, ctx.t0 + l * gap + each)
                    views.forEach((neuron, i) => popIn(neuron, ctx.t0, windows[i]![0], windows[i]![1], ctx.ease))
                })
                this.links.forEach((rows, l) => {
                    const start = ctx.t0 + l * gap + each * 0.45
                    for (const row of rows) for (const link of row) {
                        stepAt(link, 'trimTo', 0, ctx.t0)
                        link.tween('trimTo', 1, start, start + each, ctx.ease)
                    }
                })
                for (const child of this.neuronLayer.children) {
                    if (child.get('path')) continue
                    stepAt(child, 'opacity', 0, ctx.t0)
                    child.tween('opacity', 1, ctx.t0 + span * 0.3, ctx.t1, ctx.ease)
                }
                for (const caption of this.captions) {
                    stepAt(caption, 'opacity', 0, ctx.t0)
                    caption.tween('opacity', 1, ctx.t0 + span * 0.3, ctx.t1, ctx.ease)
                }
            },
        }
    }

    /** Set how strongly each neuron in a layer fires, from 0 to 1. */
    activate(layer: number, values: readonly number[], options: AnimOptions & { color?: ColorInput } = {}): Anim {
        return {
            label: 'net.activate', duration: options.duration ?? 0.45, ease: options.ease,
            schedule: (ctx) => {
                this.neurons[layer]!.forEach((neuron, i) => {
                    const amount = Math.max(0.04, Math.min(1, values[i] ?? 0))
                    neuron.tween('fillOpacity', amount, ctx.t0, ctx.t1, ctx.ease)
                    if (options.color) neuron.tween('fill', toPaint(options.color), ctx.t0, ctx.t1, ctx.ease)
                })
            },
        }
    }

    /**
     * Run a signal from the first layer to the last. Pass activations per layer,
     * or let a seeded generator pick plausible ones. The strongest paths light up.
     */
    forward(options: AnimOptions & { activations?: readonly (readonly number[])[]; color?: ColorInput; pulses?: number } = {}): Anim {
        const random = seededRandom(this.seed)
        const activations = this.neurons.map((views, l) => options.activations?.[l] ?? views.map(() => random() * random()))
        const color = options.color ?? 'yellow'
        const steps: Anim[] = []
        activations.forEach((values, l) => {
            steps.push(this.activate(l, values, { duration: 0.35 }))
            if (l + 1 >= this.neurons.length) return
            const candidates: { link: Node; score: number }[] = []
            this.links[l]!.forEach((row, i) => row.forEach((link, j) => {
                candidates.push({ link, score: (values[i] ?? 0) * (activations[l + 1]?.[j] ?? 0) })
            }))
            candidates.sort((a, b) => b.score - a.score)
            const picked = candidates.slice(0, options.pulses ?? 10)
            steps.push(par(...picked.map(({ link, score }) => pulse(link, {
                color, length: 0.42, width: 1.5 + score * 3, glow: 4, duration: 0.7,
            }))))
        })
        const whole = seq(...steps)
        return { ...whole, label: 'net.forward', duration: options.duration ?? whole.duration, ease: options.ease }
    }
}

export function neuralNet(layers: readonly number[], options: NeuralNetOptions = {}): NeuralNet {
    return new NeuralNet(layers, options)
}

// ── Tokens and attention ────────────────────────────────────────────────────

export interface TokenSpec {
    text: string
    /** Small line under the chip, such as an id or a probability. */
    sub?: string
    color?: ColorInput
}

export interface TokensOptions {
    size?: number
    /** Wrap to this width. */
    maxWidth?: number
    gap?: number
    color?: ColorInput
    /** Ramp of colors across the row. */
    colors?: readonly ColorInput[]
    font?: 'mono' | 'sans'
    subSize?: number
    radius?: number
}

/** A sequence of token chips, as in a tokenizer's output. Small type by default. */
export class TokenRow extends Node {
    readonly chips: Node[] = []

    constructor(items: readonly (string | TokenSpec)[], options: TokensOptions = {}) {
        super()
        const size = options.size ?? 22
        const gap = options.gap ?? size * 0.28
        const subSize = options.subSize ?? size * 0.62
        const padX = size * 0.42, padY = size * 0.3
        const specs = items.map((item) => typeof item === 'string' ? { text: item } as TokenSpec : item)
        const palette = options.colors ? ramp(specs.length, ...options.colors) : null
        let x = 0, y = 0
        const placed: { node: Node; x: number; y: number; w: number }[] = []
        const rowHeight = size + padY * 2 + (specs.some((s) => s.sub) ? subSize * 1.4 : 0)
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i]!
            const color = spec.color ?? (palette ? palette[i]! : options.color ?? 'blue')
            const label = text(spec.text.replace(/ /g, '·'), { size, font: options.font ?? 'mono', color: 'ink' })
            const w = Math.max(label.width, size * 0.5) + padX * 2
            const h = size + padY * 2
            if (options.maxWidth !== undefined && x > 0 && x + w > options.maxWidth) {
                x = 0
                y += rowHeight + gap
            }
            const chip = new Node()
            const box = new Node(rectPath(-w / 2, -h / 2, w, h, options.radius ?? 4)).fill(color, 0.18).stroke(color, 1.5)
            chip.add(box, label.at(0, 0))
            if (spec.sub) chip.add(text(spec.sub, { size: subSize, font: 'mono', color: 'dim' }).at(0, h / 2 + subSize * 0.82))
            chip.data['box'] = box
            placed.push({ node: chip, x: x + w / 2, y, w })
            x += w + gap
        }
        const maxX = Math.max(...placed.map((p) => p.x + p.w / 2), 0)
        const maxY = Math.max(...placed.map((p) => p.y), 0)
        for (const entry of placed) {
            entry.node.at(entry.x - maxX / 2, entry.y - maxY / 2)
            this.chips.push(entry.node)
            this.add(entry.node)
        }
    }

    token(index: number): Node {
        const found = this.chips[index]
        if (!found) throw new Error(`Token row has no token ${index}.`)
        return found
    }

    /** Chips arrive from left to right. */
    enter(options: AnimOptions = {}): Anim {
        const lag = options.lag ?? 0.16
        return {
            label: 'tokens.enter', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const windows = staggered(this.chips.length, lag, ctx.t0, ctx.t1)
                this.chips.forEach((chip, i) => {
                    const [start, end] = windows[i]!
                    const y = chip.get('y')
                    stepAt(chip, 'opacity', 0, ctx.t0)
                    stepAt(chip, 'y', y + 16, ctx.t0)
                    chip.tween('opacity', 1, start, end, ctx.ease)
                    chip.tween('y', y, start, end, ctx.ease)
                })
            },
        }
    }

    /**
     * Curved links from one token to others, brighter for stronger weights.
     * Add the result to the stage after this row is in place.
     */
    arcs(from: number, weights: readonly number[], options: { color?: ColorInput; maxWidth?: number; lift?: number } = {}): Node {
        const source = this.token(from).bounds()
        const made = new Node()
        const startX = source.x + source.width / 2, startY = source.y - 3
        weights.forEach((weight, j) => {
            if (j === from || weight <= 0.01) return
            const target = this.token(j).bounds()
            const endX = target.x + target.width / 2, endY = target.y - 3
            const lift = options.lift ?? 40 + Math.abs(endX - startX) * 0.22
            const path = parseSvgPath(`M${startX} ${startY}C${startX} ${startY - lift} ${endX} ${endY - lift} ${endX} ${endY}`)
            const node = new Node(path).stroke(options.color ?? 'yellow', 0.8 + weight * (options.maxWidth ?? 6))
            node.set('strokeOpacity', 0.2 + weight * 0.8)
            made.add(node)
        })
        return made
    }
}

export function tokens(items: readonly (string | TokenSpec)[], options: TokensOptions = {}): TokenRow {
    return new TokenRow(items, options)
}

export interface AttentionMatrixOptions {
    cell?: number
    colors?: readonly ColorInput[]
    values?: boolean
    labelSize?: number
    gap?: number
}

/**
 * Attention weights as a heatmap, with source tokens across the top and targets
 * down the side. It is a Heatmap, so `.cell(i, j)` and `.row(i)` work.
 */
export function attentionMatrix(rows: readonly string[], columns: readonly string[], weights: readonly (readonly number[])[], options: AttentionMatrixOptions = {}): Heatmap {
    return new Heatmap(weights, {
        cell: options.cell ?? 42,
        gap: options.gap ?? 2,
        colors: options.colors ?? ['surface', 'teal', 'yellow'],
        domain: [0, Math.max(...weights.flat())],
        values: options.values,
        rowLabels: rows,
        columnLabels: columns,
        labelSize: options.labelSize ?? 18,
        columnLabelAngle: -Math.PI / 4,
    })
}

