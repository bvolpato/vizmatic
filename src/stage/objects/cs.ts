import { polyPath, rectPath, circlePath, parseSvgPath, smoothPath, tangentAt, pointAt, pathLength, trimPath, concat, type Path, type Vec } from '../geometry'
import { Node, ownLabels, objectName, rebindCloneParts } from '../node'
import { line } from '../shapes'
import { filmFont, text, type TextOptions } from '../text'
import { tex } from '../tex'
import { fontFor, glyphPath } from '../font'
import { ramp, toPaint, type ColorInput, type Paint } from '../color'
import { morphMatching, par, pulse, recolor, seq, type Anim, type AnimContext, type AnimOptions } from '../anim'
import { matchSequence } from '../morph'
import { Heatmap } from './charts'
import { Suspend } from '../stage'
import { clock } from '../track'
import type { Ease } from '../ease'
import { linear } from '../ease'
import { reveal, sampleAt, seededRandom, staggered, stepAt } from './util'
import { oneObject } from '../layout'

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

/**
 * The state of a node. Each state has a sign beside its color, so it also reads in a gray print: an active
 * node has a wide border, a done node has a check at its corner, a failed node has a cross, and a node that
 * is off has a border of dashes and dim text.
 */
export type GraphState = 'idle' | 'active' | 'done' | 'failed' | 'off'

const GRAPH_STATES: readonly GraphState[] = ['idle', 'active', 'done', 'failed', 'off']
const STATE_COLORS: Record<Exclude<GraphState, 'idle'>, ColorInput> = { active: 'yellow', done: 'green', failed: 'red', off: 'faint' }
/** The height of a line of text in a node that has a value, as a multiple of its text size. */
const NODE_LINE = 1.25
/** The width of the border of a node, and of the border of an active node. */
const NODE_STROKE = 2.5
const ACTIVE_STROKE = 5
/** The dashes of a node and of an edge that are off. */
const OFF_DASH: readonly number[] = [9, 7]

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
    /**
     * A short text in the node, under its label: a number that a pass computes, a score. A node with a value
     * draws as a box, as wide as its texts unless it has a `width`. Give `''` for a value that arrives
     * later. `setValue` and `send` change it.
     */
    value?: string
    /** A short text under the node, such as a gradient under a value. Give `''` for a note that arrives later. `setNote` and `send` change it. */
    note?: string
    /** The state of the node at the start. Defaults to idle. */
    state?: GraphState
}

export interface GraphEdgeSpec {
    from: string
    to: string
    label?: string
    color?: ColorInput
    width?: number
    dash?: readonly number[]
    directed?: boolean
    /** Where the label is on the edge, from 0 at its start to 1 at its end. Defaults to 0.5. */
    labelAt?: number
}

export interface GraphOptions {
    layout?: 'dagre' | 'force' | 'circle' | 'manual'
    direction?: 'LR' | 'RL' | 'TB' | 'BT'
    /**
     * Bounding size for force and circle layouts. With `fit: true`, also sets the size of the default
     * layout, from the outline of the first node to the outline of the last one.
     */
    width?: number
    /** The height of the graph, as `width`. */
    height?: number
    /** Fit the default layout to `width` and `height`. Defaults to false, so existing layouts keep their places. */
    fit?: boolean
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
    /** The font of the node labels. Defaults to the font of the film. */
    font?: TextOptions['font']
    /** The font of the edge labels. Defaults to the font that the film names, and to mono in a film that names none. */
    edgeFont?: TextOptions['font']
    /** Text size of the values and the notes of the nodes. Defaults to `labelSize`. */
    valueSize?: number
    /** The color of the notes under the nodes. Defaults to dim. */
    noteColor?: ColorInput
    /** The ids of the nodes that show at the start. The other nodes arrive with `grow`. Defaults to all. */
    shown?: readonly string[]
    /** The id of the node where the token starts. With a token, the graph is a state machine: `go(id)` moves the token along an edge. */
    token?: string
    /** The color of the token. Defaults to yellow. */
    tokenColor?: ColorInput
}

export class GraphNode extends Node {
    shape!: Node
    caption: Node | null = null
    halfWidth = 0
    halfHeight = 0
    round = true
    /** Space outside a node for its token ring. */
    ringClearance = 0
    /** The value in the node, or null for a node that was built with none. */
    value: Node | null = null
    /** The note under the node, or null for a node that was built with none. */
    note: Node | null = null
    /** The mark of a state at the corner of the node: a check or a cross. Null until a state needs it. */
    badge: Node | null = null
    /** The ring of the token around the node. Null in a graph with no token. */
    ring: Node | null = null

    /**
     * A patch under the note, in the color of the background. An edge that leaves the node downward passes
     * behind it, as an edge passes behind its own label, so no line crosses the text of the note.
     */
    notePlate: Node | null = null

    /** Point on this node's outline facing a stage point, in graph space. */
    edgePoint(fx: number, fy: number, tx: number, ty: number, pad = 0): Vec {
        const dx = tx - fx, dy = ty - fy
        const length = Math.hypot(dx, dy) || 1
        const width = this.halfWidth + this.ringClearance, height = this.halfHeight + this.ringClearance
        if (this.round) return [fx + (dx / length) * (width + pad), fy + (dy / length) * (width + pad)]
        const sx = dx === 0 ? Infinity : width / Math.abs(dx)
        const sy = dy === 0 ? Infinity : height / Math.abs(dy)
        const s = Math.min(sx, sy)
        return [fx + dx * s + (dx / length) * pad, fy + dy * s + (dy / length) * pad]
    }
}

export class GraphEdge extends Node {
    shaft!: Node
    tip: Node | null = null
    caption: Node | null = null
    /** The token in transit on this edge. The caption covers it while it passes behind the text. */
    token: Node | null = null
    labelAt = 0.5
    from = ''
    to = ''
    tipSize = 14
    /** An edge with a direction goes from `from` to `to` only. The token of a state machine follows it. */
    directed = true
    /** The color and the width of the line as it was built. A lit or a pruned edge comes back to them. */
    lineColor: ColorInput = 'dim'
    lineWidth = 2.2
}

/** The two ends of the line of an edge, for a layout that routes its own edges: the box nodes of a tree. */
const EDGE_ENDS = new WeakMap<GraphEdgeSpec, readonly [Vec, Vec]>()

/** A value as the film wrote it, for a message. */
const quoted = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : String(value))

/** A time in seconds, for a message. */
const secondsOf = (time: number): string => `${Math.round(time * 100) / 100} s`

/** Run code that reads node state as of a time. */
function asOf<T>(time: number, read: () => T): T {
    const saved = clock.now
    clock.now = time
    try {
        return read()
    } finally {
        clock.now = saved
    }
}

/**
 * A lit part that runs along the line of an edge, with the line or against it. `pulse` runs with the line
 * only, and a gradient goes back along the edge that its value came on. The light is a part of the edge,
 * under its label: it passes behind the label as the line does, and does not cross the text.
 */
function runLight(edge: GraphEdge, back: boolean, t0: number, t1: number, ease: Ease, color: ColorInput, length: number): void {
    const shaft = edge.shaft, path = sampleAt(shaft, 'path', t0)
    if (!path || !(t1 > t0)) return
    const lit = new Node(path).stroke(color, sampleAt(shaft, 'strokeWidth', t0) + 1.5).glow(10)
    // The light shows from its own start to its own end. In a sequence, its start is later than the start of the play.
    lit.base.visible = false
    edge.add(lit)
    if (edge.caption) {
        edge.children.splice(edge.children.indexOf(lit), 1)
        edge.children.splice(edge.children.indexOf(edge.caption), 0, lit)
    }
    stepAt(lit, 'visible', true, t0)
    const head = (a: number) => Math.min(1, a * (1 + length)), tail = (a: number) => Math.max(0, a * (1 + length) - length)
    stepAt(lit, 'trimFrom', back ? 1 : 0, t0)
    stepAt(lit, 'trimTo', back ? 1 : 0, t0)
    lit.track('trimTo').add({ t0, t1, ease, to: back ? 0 : 1, at: (a) => (back ? 1 - tail(a) : head(a)) })
    lit.track('trimFrom').add({ t0, t1, ease, to: back ? 0 : 1, at: (a) => (back ? 1 - head(a) : tail(a)) })
    stepAt(lit, 'visible', false, t1)
}

/** The mark in the badge of a state: a check for done, a cross for failed. */
function badgeMark(mark: 'done' | 'failed', radius: number): Path {
    const u = radius * 0.46
    if (mark === 'done') return polyPath([[-u, u * 0.08], [-u * 0.3, u * 0.78], [u, -u * 0.72]])
    return concat(polyPath([[-u * 0.8, -u * 0.8], [u * 0.8, u * 0.8]]), polyPath([[u * 0.8, -u * 0.8], [-u * 0.8, u * 0.8]]))
}

interface NodeLook {
    paint: Paint
    fillOpacity: number
    width: number
    dash: readonly number[] | null
    ink: Paint
    mark: 'done' | 'failed' | null
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
 *
 * A node has a state, which `setState` changes and `stateOf` reads. A node with a `value` is a box with a
 * name and a number: `setValue` changes the number, and `send` brings a new one along an edge, with the
 * arrow or against it, for the two passes of a computation graph. With the option `token`, the graph is a
 * state machine: `go(id)` moves the token along an edge, and `current` is the node where it is. With the
 * option `shown`, some nodes wait, and `grow` brings them with their edges.
 */
export class Graph extends Node {
    readonly nodes = new Map<string, GraphNode>()
    readonly edges: GraphEdge[] = []
    readonly edgeLayer = new Node()
    readonly nodeLayer = new Node()
    private readonly specs: readonly GraphNodeSpec[]
    private readonly labelSize: number
    private readonly valueSize: number
    private readonly textFont: TextOptions['font']
    private readonly noteColor: ColorInput
    /** The color and the fill of each node as it was built: the look of the idle state. */
    private readonly built = new Map<string, { paint: Paint; fillOpacity: number }>()
    /** The state of each node, after the changes that are scheduled so far. */
    protected readonly states = new Map<string, GraphState>()
    /** The text of the value and of the note of each node, after the changes that are scheduled so far. */
    private readonly words = new Map<string, { value: string | null; note: string | null }>()
    /** The nodes and the edges that do not show yet. */
    protected readonly waiting = new Set<string>()
    private readonly waitingEdges = new Set<GraphEdge>()
    /** The dot that carries the token along an edge. Null in a graph with no token. */
    private readonly tokenDot: Node | null = null
    private readonly tokenPaint: Paint
    private tokenAt: string | null = null
    /** The call that moved the token last, and the time when that move ends. */
    private tokenMove: { call: string; t0: number; t1: number } | null = null
    /** The call that last changed the look of each node, and the time when that change ends. */
    private readonly lookMoves = new Map<string, { ctx: AnimContext; call: string; t0: number; t1: number }>()

    /** The name of the object in a message. */
    protected get kind(): string {
        return 'graph'
    }

    constructor(nodes: readonly GraphNodeSpec[], edges: readonly GraphEdgeSpec[], options: GraphOptions = {}) {
        super()
        this.specs = nodes
        const what = this.kind
        const defaultRadius = options.radius ?? 30
        const labelSize = this.labelSize = options.labelSize ?? 26
        const valueSize = this.valueSize = options.valueSize ?? labelSize
        if (!(Number.isFinite(valueSize) && valueSize > 0)) throw new Error(`${what}: valueSize is the text size of the values and the notes, more than 0`)
        this.textFont = options.font
        this.noteColor = options.noteColor ?? 'dim'
        this.tokenPaint = this.paintOf(options.tokenColor ?? 'yellow', 'tokenColor')
        const frames = nodes.map((spec) => this.frame(spec, defaultRadius))
        // The room under a node for its note: a gap, and one line of text.
        const noteRoom = valueSize * (0.3 + NODE_LINE)
        const rooms = nodes.map((spec) => (spec.note === undefined ? 0 : noteRoom))
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
            nodes.forEach((spec, index) => {
                const { width, height } = frames[index]!
                // The layout keeps the room of a note free, under the box of its node.
                g.setNode(spec.id, { width, height: height + rooms[index]! })
            })
            edges.forEach((edge, i) => g.setEdge(edge.from, edge.to, {}, String(i)))
            dagre.layout(g)
            const info = g.graph() as { width?: number; height?: number }
            const cx = (info.width ?? 0) / 2, cy = (info.height ?? 0) / 2
            nodes.forEach((spec, index) => {
                const placed = g.node(spec.id)
                positions.set(spec.id, [placed.x - cx, placed.y - cy - rooms[index]! / 2])
            })
            const roomOf = new Map(nodes.map((spec, index) => [spec.id, rooms[index]!]))
            edges.forEach((edge, i) => {
                const data = g.edge({ v: edge.from, w: edge.to, name: String(i) }) as { points?: { x: number; y: number }[] }
                if (!data?.points) return
                // A node with a note is higher than the middle that the layout gave it, by half of the room of the
                // note. The points of the edge go up with the two nodes, from the lift of one to the lift of the other.
                const first = (roomOf.get(edge.from) ?? 0) / 2, last = (roomOf.get(edge.to) ?? 0) / 2
                const count = data.points.length
                routes.set(edge, data.points.map((point, at) => (first === 0 && last === 0
                    ? [point.x - cx, point.y - cy]
                    : [point.x - cx, point.y - cy - (first + (last - first) * (count > 1 ? at / (count - 1) : 0))])))
            })
            // The room that the label of an edge needs between two nodes, along each axis: the label, and a part of the
            // line at each of its ends, so that the edge still reads as a line with an arrow.
            const labelRoom = (edge: GraphEdgeSpec, axis: 0 | 1): number => {
                if (!edge.label) return 0
                const size = options.edgeLabelSize ?? 20
                return axis === 0 ? text(edge.label, { size, font: options.edgeFont ?? filmFont() ?? 'mono' }).bounds().width + size * 3.4 : size * 4
            }
            const fit = (axis: 0 | 1, target: number | undefined, name: 'width' | 'height'): void => {
                if (target === undefined) return
                if (!(Number.isFinite(target) && target > 0)) throw new Error(`${what}: ${name} is ${quoted(target)}. Give a size in pixels, more than 0`)
                const other: 0 | 1 = axis === 0 ? 1 : 0
                const centers = nodes.map((spec) => positions.get(spec.id)![axis])
                // How far a node goes before and after its middle, on an axis. The note is under the box.
                const before = (index: number, on: 0 | 1) => (on === 0 ? frames[index]!.width : frames[index]!.height) / 2
                const after = (index: number, on: 0 | 1) => before(index, on) + (on === 1 ? rooms[index]! : 0)
                const middle = (Math.min(...centers) + Math.max(...centers)) / 2
                const low = (k: number) => Math.min(...centers.map((c, index) => (c - middle) * k - before(index, axis)))
                const high = (k: number) => Math.max(...centers.map((c, index) => (c - middle) * k + after(index, axis)))
                const span = (k: number) => high(k) - low(k)
                if (span(0) > target + 1e-6) throw new Error(`${what}: a ${name} of ${target} is less than the ${name} of the largest node, which is ${Math.ceil(span(0))}. Give a ${name} of ${Math.ceil(span(0))} or more`)
                // All nodes are in one line across this axis, so there is nothing to move apart.
                if (Math.max(...centers) - Math.min(...centers) < 1e-6) return
                let under = 0, over = 1
                while (span(over) < target) over *= 2
                for (let pass = 0; pass < 60; pass++) {
                    const k = (under + over) / 2
                    if (span(k) < target) under = k
                    else over = k
                }
                const k = over
                // The axis along which the layout puts one rank after another. An edge goes from a rank to a later one.
                const ranks: 0 | 1 = (options.direction ?? 'LR') === 'LR' || options.direction === 'RL' ? 0 : 1
                // Two nodes that are side by side on the other axis must keep room between them. Along the ranks, two
                // nodes that an edge joins must keep the room of the line of the edge, and of its label.
                let least = 0, tight: [number, number] | null = null
                for (let i = 0; i < nodes.length; i++) {
                    for (let j = i + 1; j < nodes.length; j++) {
                        const a = positions.get(nodes[i]!.id)!, b = positions.get(nodes[j]!.id)!
                        const joins = axis === ranks ? edges.filter((edge) => (edge.from === nodes[i]!.id && edge.to === nodes[j]!.id) || (edge.from === nodes[j]!.id && edge.to === nodes[i]!.id)) : []
                        // Two nodes with no part at one place of the other axis, and no edge between them, can pass each other.
                        const apart = a[other] + after(i, other) <= b[other] - before(j, other) || b[other] + after(j, other) <= a[other] - before(i, other)
                        if (apart && joins.length === 0) continue
                        const distance = Math.abs(a[axis] - b[axis])
                        if (distance < 1e-6) continue
                        const [first, second] = a[axis] < b[axis] ? [i, j] : [j, i]
                        const label = Math.max(0, ...joins.map((edge) => labelRoom(edge, axis)))
                        const need = (after(first, axis) + before(second, axis) + Math.max(labelSize, label)) / distance
                        if (need > least) {
                            least = need
                            tight = [first, second]
                        }
                    }
                }
                if (tight && k < least - 1e-6) throw new Error(`${what}: a ${name} of ${target} leaves no room between the nodes ${quoted(nodes[tight[0]]!.id)} and ${quoted(nodes[tight[1]]!.id)}. Give a ${name} of ${Math.ceil(span(least))} or more, shorter labels, or fewer nodes ${axis === 0 ? 'side by side' : 'one over the other'}`)
                const shift = -(low(k) + high(k)) / 2
                const moved = (value: number) => (value - middle) * k + shift
                const place = (point: Vec): Vec => (axis === 0 ? [moved(point[0]), point[1]] : [point[0], moved(point[1])])
                for (const spec of nodes) positions.set(spec.id, place(positions.get(spec.id)!))
                for (const [edge, points] of routes) routes.set(edge, points.map(place))
            }
            if (options.fit) {
                fit(0, options.width, 'width')
                fit(1, options.height, 'height')
            }
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
        const ringGap = Math.max(6, labelSize * 0.25), ringWeight = Math.max(3.5, labelSize * 0.14)
        nodes.forEach((spec, index) => {
            const view = new GraphNode()
            const color = spec.color ?? nodeColor
            const { width, height, box } = frames[index]!
            view.halfWidth = width / 2
            view.halfHeight = height / 2
            view.round = !box
            if (options.token !== undefined) view.ringClearance = ringGap + ringWeight / 2
            view.shape = new Node(box ? rectPath(-width / 2, -height / 2, width, height, 8) : circlePath(0, 0, width / 2))
                .fill(color, options.fillOpacity ?? 0.16)
                .stroke(color, NODE_STROKE)
            view.add(view.shape)
            // A node with a value has two lines: its label, and its value under it. The two are centered in the box.
            const valued = spec.value !== undefined
            const lines = (spec.label ? labelSize * NODE_LINE : 0) + valueSize * NODE_LINE
            if (spec.label) {
                view.caption = spec.math
                    ? tex(spec.label, { size: labelSize, color: 'ink', display: false })
                    : text(spec.label, { size: labelSize, font: options.font, color: 'ink' })
                view.add(view.caption.at(0, valued ? -lines / 2 + (labelSize * NODE_LINE) / 2 : 0))
            }
            if (valued) {
                view.fill('ink')
                view.value = this.word(spec.value!, 'value').at(0, lines / 2 - (valueSize * NODE_LINE) / 2)
                view.add(view.value)
            }
            if (spec.note !== undefined) {
                view.note = this.word(this.oneLine(spec.note, 'note', spec.id), 'note').at(0, height / 2 + valueSize * (0.3 + NODE_LINE / 2))
                view.notePlate = new Node(this.plate(view.note)).fill('bg')
                view.add(view.notePlate, view.note)
            }
            view.named(spec.id)
            view.at(positions.get(spec.id) ?? [0, 0])
            this.nodes.set(spec.id, view)
            this.nodeLayer.add(view)
            this.built.set(spec.id, { paint: toPaint(color), fillOpacity: options.fillOpacity ?? 0.16 })
            this.words.set(spec.id, { value: spec.value ?? null, note: spec.note ?? null })
            const state = spec.state ?? 'idle'
            if (!GRAPH_STATES.includes(state)) throw new Error(`${what}: the state of the node ${quoted(spec.id)} is ${quoted(state)}. The states are ${GRAPH_STATES.join(', ')}`)
            this.states.set(spec.id, state)
            if (state !== 'idle') this.paint(spec.id, this.look(spec.id, state), null)
            if (view.value) this.bindValueInk(view, view.value)
        })
        const directed = options.directed ?? true
        const edgeColor = options.edgeColor ?? 'dim'
        const edgeLabelSize = options.edgeLabelSize ?? 20
        const edgeFont = options.edgeFont ?? filmFont() ?? 'mono'
        for (const spec of edges) {
            const from = this.nodes.get(spec.from), to = this.nodes.get(spec.to)
            if (!from || !to) throw new Error(`Graph edge ${spec.from} -> ${spec.to} refers to a node that does not exist.`)
            const view = new GraphEdge()
            view.from = spec.from
            view.to = spec.to
            const a = positions.get(spec.from)!, b = positions.get(spec.to)!
            const route = routes.get(spec)
            const horizontal = (options.direction ?? 'LR') === 'LR' || options.direction === 'RL'
            const ends = EDGE_ENDS.get(spec)
            const path = ends ? polyPath([ends[0], ends[1]]) : routeEdge(from, to, a, b, route, horizontal)
            const isDirected = spec.directed ?? directed
            const color = spec.color ?? edgeColor
            view.directed = isDirected
            view.lineColor = color
            view.lineWidth = spec.width ?? 2.2
            const { head, trimmed } = isDirected ? tipPath(path, view.tipSize) : { head: [] as Path, trimmed: path }
            view.shaft = new Node(trimmed).stroke(color, spec.width ?? 2.2)
            if (spec.dash) view.shaft.dash(spec.dash)
            view.add(view.shaft)
            if (head.length) {
                view.tip = new Node(head).fill(color)
                view.add(view.tip)
            }
            if (spec.label) {
                const share = spec.labelAt ?? 0.5
                view.labelAt = share
                if (!(Number.isFinite(share) && share >= 0 && share <= 1)) throw new Error(`${what}: labelAt of the edge ${spec.from} -> ${spec.to} is ${quoted(share)}. It is a share of the edge, from 0 at its start to 1 at its end`)
                const [mx, my] = pointAt(path, share)
                const caption = text(spec.label, { size: edgeLabelSize, color: 'ink', font: edgeFont }).at(mx, my)
                const pad = edgeLabelSize * 0.34
                const plate = new Node(rectPath(mx - caption.width / 2 - pad, my - edgeLabelSize * 0.68, caption.width + pad * 2, edgeLabelSize * 1.36, 4)).fill('bg')
                view.caption = new Node().add(plate, caption)
                view.add(view.caption)
            }
            this.edges.push(view)
            this.edgeLayer.add(view)
        }
        this.add(this.edgeLayer, this.nodeLayer)
        if (options.shown !== undefined) {
            if (!Array.isArray(options.shown)) throw new Error(`${what}: shown is ${quoted(options.shown)}. Give the list of the ids of the nodes that show at the start`)
            for (const id of options.shown) this.view(id, 'shown')
            const shown = new Set(options.shown)
            for (const [id, view] of this.nodes) {
                if (shown.has(id)) continue
                this.waiting.add(id)
                view.hide()
            }
            // An edge shows when both of its nodes show.
            for (const edge of this.edges) {
                if (!this.waiting.has(edge.from) && !this.waiting.has(edge.to)) continue
                this.waitingEdges.add(edge)
                edge.hide()
            }
        }
        if (options.token !== undefined) {
            const start = this.view(options.token, 'token')
            if (this.waiting.has(options.token)) throw new Error(`${what}: the token starts at the node ${quoted(options.token)}, which does not show at the start. Name it in shown`)
            // Each node has a ring around it, and the ring of the node with the token shows. A ring is a sign of its
            // own: it stays when a state changes the color of the node.
            for (const view of this.nodes.values()) {
                const w = view.halfWidth + ringGap, h = view.halfHeight + ringGap
                view.ring = new Node(view.round ? circlePath(0, 0, w) : rectPath(-w, -h, w * 2, h * 2, 8 + ringGap)).stroke(this.tokenPaint, ringWeight)
                view.ring.set('opacity', view === start ? 1 : 0)
                view.add(view.ring)
            }
            this.tokenAt = options.token
            this.tokenDot = new Node(circlePath(0, 0, this.tokenRadius)).fill(this.tokenPaint)
            this.tokenDot.set('opacity', 0)
            this.add(this.tokenDot)
        }
        ownLabels(this, { name: 'graph' })
    }

    protected override [rebindCloneParts](copy: this, parts: ReadonlyMap<Node, Node>): void {
        Object.assign(copy, {
            nodes: new Map([...this.nodes].map(([id, node]) => [id, parts.get(node) as GraphNode])),
            states: new Map(this.states),
            words: new Map([...this.words].map(([id, words]) => [id, { ...words }])),
            waiting: new Set(this.waiting),
            waitingEdges: new Set([...this.waitingEdges].map((edge) => parts.get(edge) as GraphEdge)),
            lookMoves: new Map(),
            tokenMove: null,
        })
        for (const view of copy.nodes.values()) if (view.value) copy.bindValueInk(view, view.value)
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

    /** The state of a node, after the changes that are scheduled so far. */
    stateOf(id: string): GraphState {
        this.view(id, 'stateOf')
        return this.states.get(id)!
    }

    /** The text of the value of a node, after the changes that are scheduled so far. Null for a node that was built with no value. */
    valueOf(id: string): string | null {
        this.view(id, 'valueOf')
        return this.words.get(id)!.value
    }

    /** The text of the note under a node, after the changes that are scheduled so far. Null for a node that was built with no note. */
    noteOf(id: string): string | null {
        this.view(id, 'noteOf')
        return this.words.get(id)!.note
    }

    /** True when a node shows, after the changes that are scheduled so far. A node that the option `shown` leaves out shows after its `grow`. */
    isShown(id: string): boolean {
        this.view(id, 'isShown')
        return !this.waiting.has(id)
    }

    /** The id of the node where the token is, after the changes that are scheduled so far. Null in a graph with no token. */
    get current(): string | null {
        return this.tokenAt
    }

    /**
     * The middle of an edge of a node, in the coordinates of the graph: the point where a line or a note of the
     * film starts. Defaults to the bottom edge, which for a node with a note is under the note. The point does
     * not follow the graph: read it again after the graph or the node moves.
     */
    p(id: string, edge: 'top' | 'bottom' | 'left' | 'right' = 'bottom'): [number, number] {
        const view = this.view(id, 'p')
        const x = view.get('x'), y = view.get('y')
        if (edge === 'top') return [x, y - view.halfHeight]
        if (edge === 'bottom') return [x, y + view.halfHeight + (view.note ? this.valueSize * (0.3 + NODE_LINE) : 0)]
        if (edge === 'left') return [x - view.halfWidth, y]
        if (edge === 'right') return [x + view.halfWidth, y]
        throw new Error(`${this.kind}: the edge of p() is 'top', 'bottom', 'left' or 'right', not ${quoted(edge)}`)
    }

    /** Nodes pop in by order, and each edge draws as its source is shown. */
    enter(options: AnimOptions = {}): Anim {
        const lag = options.lag ?? 0.14
        return {
            label: 'graph.enter', duration: options.duration ?? 2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                // A node that waits for its `grow` takes no turn.
                const ordered = this.specs.filter((spec) => !this.waiting.has(spec.id)).map((spec) => this.nodes.get(spec.id)!)
                const windows = staggered(ordered.length, lag, ctx.t0, ctx.t0 + (ctx.t1 - ctx.t0) * 0.78)
                const startOf = new Map<GraphNode, number>()
                ordered.forEach((view, i) => {
                    const [start, end] = windows[i]!
                    startOf.set(view, end)
                    popIn(view, ctx.t0, start, end, ctx.ease)
                })
                for (const edge of this.edges) {
                    if (this.waitingEdges.has(edge)) continue
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
                    if (this.tokenAt !== null && edge.caption) {
                        const caption = edge.caption, words = caption.children[1]!
                        for (const [axis, prop] of [[0, 'x'], [1, 'y']] as const) {
                            const origin = words.get(prop)
                            const offset = (a: number) => pointAt(geometry(a), edge.labelAt)[axis] - origin
                            caption.track(prop).add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: offset(1), at: offset })
                        }
                    }
                }
            },
        }
    }

    /**
     * A node goes to a state. The border and the fill take the color of the state, and the sign of the state
     * comes with it: a wide border for active, a check for done, a cross for failed, dashes and dim text for
     * off. `idle` gives the node the look that it was built with. `color` replaces the color of the state,
     * such as a second color for a second active node.
     */
    setState(id: string, state: GraphState, options: AnimOptions & { color?: ColorInput } = {}): Anim {
        this.view(id, 'setState')
        if (!GRAPH_STATES.includes(state)) throw new Error(`${this.kind}: setState: no state ${quoted(state)}. The states are ${GRAPH_STATES.join(', ')}`)
        // Find a wrong color now, where the film names it.
        const look = this.look(id, state, options.color)
        return {
            label: 'graph.state', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                this.settable(id, state)
                this.claimLook(id, `setState(${quoted(id)}, ${quoted(state)})`, ctx)
                this.states.set(id, state)
                this.paint(id, look, ctx)
            },
        }
    }

    /**
     * The value of a node changes in place. The old text fades out, then the new text fades in, so no moment
     * shows two texts. It works on a node that was built with a `value`, because the box keeps its size. A
     * text that is too wide for the box is an error.
     */
    setValue(id: string, value: string, options: AnimOptions = {}): Anim {
        const write = this.write(id, 'value', value, 'setValue')
        return {
            label: 'graph.setValue', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                write(ctx.t0, ctx.t1, ctx.ease)
            },
        }
    }

    /** The note under a node changes in place, as `setValue` changes the value. It works on a node that was built with a `note`. */
    setNote(id: string, note: string, options: AnimOptions = {}): Anim {
        const write = this.write(id, 'note', note, 'setNote')
        return {
            label: 'graph.setNote', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                write(ctx.t0, ctx.t1, ctx.ease)
            },
        }
    }

    /**
     * A light goes from one node to another along their edge, in the direction that the call names: with the
     * arrow, or against it. With `value` or `note`, the node at the end takes the new text when the light
     * arrives. So one call is one step of a pass: `send('w', 'mul', { value: '6' })` forward, and
     * `send('loss', 'mul', { note: '2', color: 'pink' })` back along the same edge.
     * As with `connector.send`, `duration` is travel time. A value or a note then changes over 0.5 seconds.
     */
    send(from: string, to: string, options: AnimOptions & { color?: ColorInput; length?: number; value?: string; note?: string } = {}): Anim {
        this.view(from, 'send')
        this.view(to, 'send')
        const edge = this.edges.find((own) => own.from === from && own.to === to) ?? this.edges.find((own) => own.from === to && own.to === from)
        if (!edge) throw new Error(`${this.kind}: send: no edge joins ${quoted(from)} and ${quoted(to)}. ${this.joined(from)}`)
        const back = edge.from !== from
        const color = options.color ?? 'yellow'
        this.paintOf(color, 'the color of send')
        const travel = options.duration ?? 0.9, length = options.length ?? 0.3
        if (!(Number.isFinite(travel) && travel > 0)) throw new Error(`${this.kind}: send: duration is the travel time in seconds, more than 0, and it is ${quoted(travel)}`)
        if (!(Number.isFinite(length) && length > 0 && length <= 1)) throw new Error(`${this.kind}: send: length is the share of the edge that lights at once, more than 0 and at most 1, and it is ${quoted(length)}`)
        const writes = [
            ...(options.value === undefined ? [] : [this.write(to, 'value', options.value, 'send')]),
            ...(options.note === undefined ? [] : [this.write(to, 'note', options.note, 'send')]),
        ]
        return {
            label: 'graph.send', duration: travel + (writes.length > 0 ? 0.5 : 0), ease: options.ease ?? linear,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                const arrives = ctx.t0 + span * travel / (travel + (writes.length > 0 ? 0.5 : 0))
                runLight(edge, back, ctx.t0, arrives, ctx.ease, color, length)
                for (const write of writes) write(arrives, ctx.t1, ctx.ease)
            },
        }
    }

    /**
     * The token goes to another node along the edge between the two. An edge with an arrow takes the token
     * from its start to its end only. A move with no edge is an error that names the nodes that the token
     * can go to: a state machine has no such step. `current` is then the new node.
     */
    go(to: string, options: AnimOptions = {}): Anim {
        this.view(to, 'go')
        this.tokenNeeded('go')
        return {
            label: 'graph.go', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const from = this.tokenAt!
                const edge = this.step(from, to)
                if (!edge) throw new Error(`${this.kind}: go: no edge goes from ${quoted(from)}, where the token is, to ${quoted(to)}. ${this.steps(from)}. For a step that the machine refuses, play refuse(${quoted(to)})`)
                this.claimToken(`go(${quoted(to)})`, ctx)
                const span = ctx.t1 - ctx.t0
                const back = edge.from !== from
                this.carry((a) => pointAt(edge.shaft.get('path')!, back ? 1 - a : a), ctx, edge)
                // The ring leaves the old node while the dot starts, and comes to the new node while the dot arrives.
                this.nodes.get(from)!.ring!.tween('opacity', 0, ctx.t0, ctx.t0 + span * 0.3, ctx.ease)
                this.nodes.get(to)!.ring!.tween('opacity', 1, ctx.t1 - span * 0.3, ctx.t1, ctx.ease)
                this.tokenAt = to
            },
        }
    }

    /**
     * The machine refuses a step: the token starts toward a node, turns back, and its ring is red for a
     * moment. The token stays where it is, and `current` does not change. The node can be one that no edge
     * reaches from here, or the end of an edge whose guard says no.
     */
    refuse(to: string, options: AnimOptions = {}): Anim {
        this.view(to, 'refuse')
        this.tokenNeeded('refuse')
        const red = toPaint('red')
        return {
            label: 'graph.refuse', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const from = this.tokenAt!
                if (to === from) throw new Error(`${this.kind}: refuse: the token is at ${quoted(to)}. Name the node that the machine does not let it go to`)
                this.claimToken(`refuse(${quoted(to)})`, ctx)
                const edge = this.step(from, to)
                const here = this.nodes.get(from)!, there = this.nodes.get(to)!
                const [hx, hy] = [sampleAt(here, 'x', ctx.t0), sampleAt(here, 'y', ctx.t0)], [tx, ty] = [sampleAt(there, 'x', ctx.t0), sampleAt(there, 'y', ctx.t0)]
                // With no edge, the token tries the straight line between the two nodes.
                const path = edge ? sampleAt(edge.shaft, 'path', ctx.t0)! : polyPath([here.edgePoint(hx, hy, tx, ty, 2), there.edgePoint(tx, ty, hx, hy, 2)])
                const back = edge ? edge.from !== from : false
                // The dot goes a third of the way, and comes back. It turns before the label of an edge, so that it does not stop on a text.
                let reach = 0.34
                const plates = this.edges.filter((own) => own.caption && !this.waitingEdges.has(own)).map((own) => asOf(ctx.t0, () => own.caption!.children[0]!.bounds()))
                const room = this.tokenRadius * 1.5
                const onLabel = (share: number) => {
                    const [x, y] = asOf(ctx.t0, () => this.toWorld(...pointAt(path, back ? 1 - share : share)))
                    return plates.some((box) => x > box.x - room && x < box.x + box.width + room && y > box.y - room && y < box.y + box.height + room)
                }
                while (reach > 0.1 && onLabel(reach)) reach -= 0.02
                this.carry((a) => {
                    const share = reach * (1 - Math.abs(1 - 2 * a))
                    return pointAt(path, back ? 1 - share : share)
                }, ctx, edge)
                const span = ctx.t1 - ctx.t0, ring = here.ring!
                ring.tween('stroke', red, ctx.t0 + span * 0.3, ctx.t0 + span * 0.5, ctx.ease)
                ring.tween('stroke', this.tokenPaint, ctx.t0 + span * 0.75, ctx.t1, ctx.ease)
            },
        }
    }

    /**
     * Nodes that wait arrive, one after another, each with the edges that join it to the nodes that show. An
     * edge from a node that shows draws first, and the new node pops in at its end. A node that shows
     * already takes no time. The option `shown` says which nodes wait.
     */
    grow(which: string | readonly string[], options: AnimOptions = {}): Anim {
        const ids = typeof which === 'string' ? [which] : [...which]
        if (ids.length === 0) throw new Error(`${this.kind}: grow: give the id of a node, or a list of ids`)
        for (const id of ids) this.view(id, 'grow')
        const lag = Math.max(0, options.lag ?? 0.5)
        return {
            label: 'graph.grow', duration: options.duration ?? 0.7 * (1 + (ids.length - 1) * lag), ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const fresh = [...new Set(ids)].filter((id) => this.waiting.has(id))
                this.growable(fresh)
                const windows = staggered(fresh.length, lag, ctx.t0, ctx.t1)
                fresh.forEach((id, order) => {
                    const [start, end] = windows[order]!, span = end - start
                    this.waiting.delete(id)
                    const joins = this.edges.filter((edge) => this.waitingEdges.has(edge) && !this.waiting.has(edge.from) && !this.waiting.has(edge.to))
                    // An edge that ends at the new node comes from a node that shows. It leads the eye, so it draws first, and
                    // the node pops in at its end. An edge that starts at the new node draws after the node is there.
                    const led = joins.some((edge) => edge.to === id)
                    const view = this.nodes.get(id)!
                    stepAt(view, 'visible', true, start)
                    popIn(view, start, led ? start + span * 0.4 : start, led ? end : start + span * 0.6, ctx.ease)
                    for (const edge of joins) {
                        this.waitingEdges.delete(edge)
                        const [from, to] = edge.to === id ? [start, start + span * 0.6] : [start + span * 0.4, end]
                        stepAt(edge, 'visible', true, start)
                        stepAt(edge.shaft, 'trimTo', 0, start)
                        edge.shaft.tween('trimTo', 1, from, to, ctx.ease)
                        // The plate of the label is there from the start, in the color of the background, so the line
                        // passes behind it. The words of the label arrive when the line is drawn: no line crosses them.
                        for (const part of [edge.tip, edge.caption?.children[1]]) {
                            if (!part) continue
                            const opacity = sampleAt(part, 'opacity', start)
                            stepAt(part, 'opacity', 0, start)
                            part.tween('opacity', opacity, to - (to - from) * 0.3, to, ctx.ease)
                        }
                    }
                })
            },
        }
    }

    /** A hook for a layout with an order, such as a tree: stop a `grow` that the layout cannot show. The nodes are in the order of the call. */
    protected growable(_ids: readonly string[]): void {}

    /** A hook for a layout with an order, such as a tree: stop a `setState` that would give a wrong picture. */
    protected settable(_id: string, _state: GraphState): void {}

    /**
     * Take the time of a change of the look of a node. Two changes at one time would each write the colors,
     * the border and the mark of the node, and the picture would not be the state that `stateOf` gives. So a
     * change of one node that starts before the last one is over is an error. The parts of one call, such as
     * the prune and the light of a `keep`, are one change.
     */
    protected claimLook(id: string, call: string, ctx: AnimContext): void {
        const last = this.lookMoves.get(id)
        if (last && last.ctx !== ctx && ctx.t1 <= last.t0 && ctx.t0 < last.t0) {
            throw new Error(`${this.kind}: schedule changes to the look of node ${quoted(id)} in time order. Put ${call} at ${secondsOf(ctx.t0)} before ${last.call} at ${secondsOf(last.t0)}`)
        }
        if (last && last.ctx !== ctx && ctx.t0 < last.t1 - 1e-6) {
            throw new Error(`${this.kind}: ${call} plays from ${secondsOf(ctx.t0)} to ${secondsOf(ctx.t1)}, and ${last.call} plays from ${secondsOf(last.t0)} to ${secondsOf(last.t1)}. Both change the look of the node ${quoted(id)}, and a node takes one look at a time. Play the two in a \`seq\`, or in two calls of \`s.play\``)
        }
        this.lookMoves.set(id, { ctx, call, t0: ctx.t0, t1: ctx.t1 })
    }

    /** The node of an id, or an error that names the call and the nodes of the graph. */
    protected view(id: string, call: string): GraphNode {
        const found = this.nodes.get(id)
        if (found) return found
        const ids = [...this.nodes.keys()]
        const known = ids.length <= 12 ? ids.map(quoted).join(', ') : `${ids.slice(0, 12).map(quoted).join(', ')} and ${ids.length - 12} more`
        throw new Error(`${this.kind}: ${call}: no node ${quoted(id)}. The nodes are ${known}`)
    }

    /** A color of the look, or an error that says where the film gave it. */
    protected paintOf(color: ColorInput, name: string): Paint {
        try {
            return toPaint(color)
        } catch {
            throw new Error(`${this.kind}: ${name} is ${quoted(color)}, which is not a color. Use a color of the look, such as 'orange', or a CSS color`)
        }
    }

    /** The look of a node in a state. */
    protected look(id: string, state: GraphState, color?: ColorInput): NodeLook {
        const built = this.built.get(id)!
        const paint = color !== undefined ? this.paintOf(color, 'the color of a state') : state === 'idle' ? built.paint : toPaint(STATE_COLORS[state])
        return {
            paint,
            // A node that is off is weaker than the others, and its fill with it.
            fillOpacity: state === 'off' ? built.fillOpacity * 0.5 : built.fillOpacity,
            width: state === 'active' ? ACTIVE_STROKE : NODE_STROKE,
            dash: state === 'off' ? OFF_DASH : null,
            ink: toPaint(state === 'off' ? 'dim' : 'ink'),
            mark: state === 'done' || state === 'failed' ? state : null,
        }
    }

    /** Give a node a look: over a time, or at once with `null` while the graph is built. */
    protected paint(id: string, look: NodeLook, when: Pick<AnimContext, 't0' | 't1' | 'ease'> | null): void {
        const view = this.nodes.get(id)!, shape = view.shape
        const texts = (view.caption?.leaves() ?? []).filter((leaf) => leaf.get('fill') !== null)
        if (view.value) texts.push(view)
        if (!when) {
            shape.set('stroke', look.paint).set('fill', look.paint).set('fillOpacity', look.fillOpacity).set('strokeWidth', look.width).set('dash', look.dash)
            for (const leaf of texts) leaf.set('fill', look.ink)
            if (look.mark) view.add(view.badge = this.badge(view, look.mark, look.paint))
            return
        }
        const { t0, t1, ease } = when, turn = (t0 + t1) / 2
        shape.tween('stroke', look.paint, t0, t1, ease)
        shape.tween('fill', look.paint, t0, t1, ease)
        shape.tween('fillOpacity', look.fillOpacity, t0, t1, ease)
        shape.tween('strokeWidth', look.width, t0, t1, ease)
        // Dashes cannot fade to a line, so they switch when the colors are half way.
        if ((sampleAt(shape, 'dash', t0) === null) !== (look.dash === null)) stepAt(shape, 'dash', look.dash, turn)
        for (const leaf of texts) leaf.tween('fill', look.ink, t0, t1, ease)
        const old = view.badge
        if (!look.mark) {
            if (old) old.tween('opacity', 0, t0, t1, ease)
            return
        }
        if (!old) {
            // The badge is a part of the node from here on. It is hidden until this change starts.
            const badge = view.badge = this.badge(view, look.mark, look.paint)
            badge.base.visible = false
            view.add(badge)
            stepAt(badge, 'visible', true, t0)
            stepAt(badge, 'opacity', 0, t0)
            badge.tween('opacity', 1, t0, t1, ease)
            return
        }
        const [disc, sign] = [old.children[0]!, old.children[1]!]
        // A badge that shows changes its mark when the colors are half way. A badge that is hidden has the new mark from the start.
        stepAt(sign, 'path', badgeMark(look.mark, this.badgeRadius), sampleAt(old, 'opacity', t0) > 0.01 ? turn : t0)
        disc.tween('stroke', look.paint, t0, t1, ease)
        sign.tween('stroke', look.paint, t0, t1, ease)
        old.tween('opacity', 1, t0, t1, ease)
    }

    private get badgeRadius(): number {
        return Math.max(11, this.labelSize * 0.48)
    }

    private get tokenRadius(): number {
        return Math.max(8, this.labelSize * 0.34)
    }

    /** The mark of a state: a disc at the top right corner of the node, with a check or a cross in it. */
    private badge(view: GraphNode, mark: 'done' | 'failed', paint: Paint): Node {
        const radius = this.badgeRadius
        // The middle of the badge is a little outside the corner, so that the badge is clear of the label of a
        // small node. On a circle, the corner is the point of the outline at 45 degrees.
        const out = view.round ? (view.halfWidth + radius * 0.35) * Math.SQRT1_2 : 0
        const [x, y] = view.round ? [out, -out] : [view.halfWidth + radius * 0.15, -view.halfHeight - radius * 0.15]
        const disc = new Node(circlePath(0, 0, radius)).fill('bg').stroke(paint, 2)
        const sign = new Node(badgeMark(mark, radius)).stroke(paint, Math.max(2.5, radius * 0.24))
        return new Node().add(disc, sign).at(x, y)
    }

    /** A text of one line, or an error. A film is not type-checked when it runs, so a number can arrive here. */
    private oneLine(content: unknown, what: 'value' | 'note', id: string): string {
        if (typeof content !== 'string') throw new Error(`${this.kind}: the ${what} of the node ${quoted(id)} is ${JSON.stringify(content)}. A ${what} is a text, such as ${JSON.stringify(String(content))}`)
        if (/[\r\n]/.test(content)) throw new Error(`${this.kind}: the ${what} ${JSON.stringify(content)} of the node ${quoted(id)} has a line break. A ${what} is one line`)
        return content
    }

    /** The patch under a note that is not yet a part of a node: the box of its letters, with a little room. An empty note has none. */
    private plate(note: Node): Path {
        const box = note.bounds(), pad = this.valueSize * 0.25
        return box.width > 0 ? rectPath(box.x - pad, box.y - pad * 0.5, box.width + pad * 2, box.height + pad, 4) : []
    }

    /** Every value on this node follows one ink track, including a value that arrives during a state change. */
    private bindValueInk(view: GraphNode, value: Node): void {
        const ink = view.track('fill')
        for (const leaf of value.leaves()) {
            if (leaf.get('fill') === null) continue
            leaf.tracks ??= new Map()
            leaf.tracks.set('fill', ink)
        }
    }

    /** The text of a value or of a note. A value is in ink and strong, because it is the part that changes. */
    private word(content: string, what: 'value' | 'note'): Node {
        return what === 'value'
            ? text(content, { size: this.valueSize, font: this.textFont, color: 'ink', weight: 600 })
            : text(content, { size: this.valueSize, font: this.textFont, color: this.noteColor })
    }

    /** The size of a node, and whether it is a box. A node with a value is a box that holds its label and its value. */
    private frame(spec: GraphNodeSpec, radius: number): { width: number; height: number; box: boolean } {
        if (spec.value === undefined) {
            if (spec.width) return { width: spec.width, height: spec.height ?? this.labelSize * 2, box: true }
            return { width: (spec.radius ?? radius) * 2, height: (spec.radius ?? radius) * 2, box: false }
        }
        const size = this.labelSize
        const value = this.oneLine(spec.value, 'value', spec.id)
        const label = !spec.label ? 0 : (spec.math ? tex(spec.label, { size, display: false }) : text(spec.label, { size, font: this.textFont })).bounds().width
        const widest = Math.max(label, this.word(value, 'value').bounds().width)
        const width = spec.width ?? Math.ceil(widest + size * 1.2)
        if (widest > width - size) throw new Error(`${this.kind}: the texts of the node ${quoted(spec.id)} are ${Math.ceil(widest)} px wide, and its box is ${width} px wide, with ${Math.max(0, Math.floor(width - size))} px for a text. Give the node a width of ${Math.ceil(widest + size)} or more, or shorter texts`)
        return { width, height: spec.height ?? Math.round((spec.label ? size * NODE_LINE : 0) + this.valueSize * NODE_LINE + size * 0.6), box: true }
    }

    /**
     * Build the new text of a value or of a note now, so that a text that cannot fit is an error at the line
     * of the film that names it. The function that comes back writes the change over a time.
     */
    private write(id: string, what: 'value' | 'note', content: string, call: string): (t0: number, t1: number, ease: Ease) => void {
        const view = this.view(id, call)
        if (!view[what]) throw new Error(`${this.kind}: ${call}: the node ${quoted(id)} was built with no ${what}, so it has no room for one. Give the node a ${what} when you build the ${this.kind}, such as ${what}: ''`)
        this.oneLine(content, what, id)
        const next = this.word(content, what)
        const wide = next.bounds().width, room = view.halfWidth * 2 - this.labelSize
        if (what === 'value' && wide > room) throw new Error(`${this.kind}: ${call}: the value ${JSON.stringify(content)} of the node ${quoted(id)} is ${Math.ceil(wide)} px wide, and its box has ${Math.max(0, Math.floor(room))} px for a text. Give the node a width of ${Math.ceil(wide + this.labelSize)} or more when you build the ${this.kind}, or a shorter value`)
        ownLabels(this, { labels: [next] })
        // The new text has the place of the text that the node was built with: a text of a node does not move.
        next.at(view[what]!.get('x'), view[what]!.get('y'))
        // Measure the patch of a note now, while the text is not a part of the node and its bounds are in the coordinates of the node.
        const patch = what === 'note' ? this.plate(next) : null
        return (t0, t1, ease) => {
            // Read the text that the node shows when this change starts, so that a second change in one sequence follows the first.
            const words = this.words.get(id)!, old = view[what]!
            // A film may play one animation twice. The node shows this text already, so nothing changes.
            if (old === next || words[what] === content) return
            const turn = (t0 + t1) / 2
            // The new text is a part of the node from here on. It is hidden until this change starts.
            if (!next.mounted) next.base.visible = false
            view.add(next)
            // The patch of a note takes the size of the new text while no text shows.
            if (patch && view.notePlate) stepAt(view.notePlate, 'path', patch, turn)
            stepAt(next, 'visible', true, t0)
            stepAt(next, 'opacity', 0, t0)
            // A value in a node that is off is dim, as the label of the node is.
            if (what === 'value') this.bindValueInk(view, next)
            old.tween('opacity', 0, t0, turn, ease)
            // The old text is hidden from the turn on. So when a film changes one text twice at one time, the text of the first change does not arrive under the text of the second.
            stepAt(old, 'visible', false, turn)
            next.tween('opacity', 1, turn, t1, ease)
            view[what] = next
            words[what] = content
        }
    }

    /** The edge that takes the token from one node to another, or null: an edge with an arrow goes one way. */
    private step(from: string, to: string): GraphEdge | null {
        return this.edges.find((edge) => !this.waitingEdges.has(edge) && edge.from === from && edge.to === to)
            ?? this.edges.find((edge) => !this.waitingEdges.has(edge) && !edge.directed && edge.from === to && edge.to === from)
            ?? null
    }

    /** The nodes that the token can go to from a node, as a sentence. */
    private steps(from: string): string {
        const next = [...new Set(this.edges.flatMap((edge) => (this.waitingEdges.has(edge) ? [] : edge.from === from ? [edge.to] : !edge.directed && edge.to === from ? [edge.from] : [])))]
        return next.length > 0 ? `From ${quoted(from)}, the token can go to ${next.map(quoted).join(', ')}` : `No edge leaves ${quoted(from)}`
    }

    /** The nodes that an edge joins to a node, as a sentence. */
    private joined(id: string): string {
        const others = [...new Set(this.edges.flatMap((edge) => (edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : [])))]
        return others.length > 0 ? `The edges of ${quoted(id)} join it to ${others.map(quoted).join(', ')}` : `${quoted(id)} has no edge`
    }

    private tokenNeeded(call: string): void {
        if (this.tokenAt === null) throw new Error(`${this.kind}: ${call}: this ${this.kind} has no token. Give the option token the id of the node where the token starts`)
    }

    /**
     * Take the time of a move of the token. Two moves at one time would each write a way for the one dot, and
     * the picture would follow neither. So a move that starts before the last one is over is an error.
     */
    private claimToken(call: string, ctx: AnimContext): void {
        const last = this.tokenMove
        if (last && ctx.t0 < last.t1 - 1e-6) throw new Error(`${this.kind}: ${call} plays from ${secondsOf(ctx.t0)} to ${secondsOf(ctx.t1)}, and ${last.call} plays from ${secondsOf(last.t0)} to ${secondsOf(last.t1)}. The token makes one move at a time. Play the two in a \`seq\`, or in two calls of \`s.play\``)
        this.tokenMove = { call, t0: ctx.t0, t1: ctx.t1 }
    }

    /** The dot of the token shows, follows a way over the time of the move, and goes. */
    private carry(way: (share: number) => [number, number], ctx: AnimContext, edge: GraphEdge | null): void {
        if (edge && !edge.token) {
            edge.token = new Node(circlePath(0, 0, this.tokenRadius)).fill(this.tokenPaint).opacity(0)
            edge.add(edge.token)
            if (edge.caption) {
                edge.children.splice(edge.children.indexOf(edge.token), 1)
                edge.children.splice(edge.children.indexOf(edge.caption), 0, edge.token)
            }
        }
        const dot = edge?.token ?? this.tokenDot!, span = ctx.t1 - ctx.t0
        // Sample the route at the time of the frame so a token follows a node that moves during go().
        const position = (a: number) => way(Math.max(0, Math.min(1, (a - 0.1) / 0.8)))
        const [ex, ey] = asOf(ctx.t1, () => way(1))
        dot.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.15, ctx.ease)
        dot.track('x').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: ex, at: (a) => position(a)[0] })
        dot.track('y').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: ey, at: (a) => position(a)[1] })
        dot.tween('opacity', 0, ctx.t1 - span * 0.15, ctx.t1, ctx.ease)
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

/** Nodes and edges with an automatic layout: `graph([{ id: 'plan', label: 'plan' }, { id: 'act', label: 'act' }], [{ from: 'plan', to: 'act' }], { token: 'plan' })`, then `g.go('act')` and `g.setState('plan', 'done')`. */
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
    /** A short text in the node, under its label. A tree with a value has box nodes. Give `''` for a value that arrives later, with `setValue`. */
    value?: string
    /** The label of the edge from the parent to this node: a condition, a probability. Defaults to the `weight`, as `format` writes it. */
    edge?: string
    /** The number of the edge from the parent to this node: a probability, a cost. With `score`, the tree multiplies or adds the weights along each path. */
    weight?: number
    /** The state of the node at the start. Defaults to idle. */
    state?: GraphState
}

export interface TreeOptions extends Pick<GraphOptions, 'radius' | 'labelSize' | 'nodeColor' | 'edgeColor' | 'fillOpacity' | 'font' | 'valueSize' | 'edgeLabelSize' | 'edgeFont' | 'token' | 'tokenColor'> {
    levelGap?: number
    siblingGap?: number
    direction?: 'down' | 'right'
    /**
     * `'box'` draws each node as a box that holds its label and its value, and all boxes have one size. Defaults
     * to box for a tree with a value or a score, and to circle for any other tree. A box tree has a `labelSize`
     * of 28, and a `valueSize` and an `edgeLabelSize` of 26.
     */
    shape?: 'circle' | 'box'
    /** The width of each box. Defaults to the width of the widest text, with room at both sides. */
    nodeWidth?: number
    /**
     * The width of the tree, from the left edge of its first node to the right edge of its last one. It sets
     * the room between the leaves of a tree that grows down, and the room between the levels of a tree that
     * grows to the right. A width with no room for the nodes is an error.
     */
    width?: number
    /** Each node shows a score as its value: the product or the sum of the weights from the root. The root has 1 for a product, and 0 for a sum. */
    score?: 'product' | 'sum'
    /** How a weight and a score are written. Defaults to a whole number as it is, and to two decimals for any other. */
    format?: (value: number) => string
    /** The nodes that show at the start: a depth, where 0 is the root alone, or a list of ids, each with the nodes over it. The other nodes arrive with `grow`. Defaults to all. */
    shown?: number | readonly string[]
}

/**
 * A tidy tree: parents center over children, and subtrees never overlap.
 *
 * With box nodes, a node holds a name and a value, and an edge has a label: a tree of continuations with a
 * probability on each edge, a decision tree, a search tree. `grow` brings one node at a time, `path` lights
 * the way from the root to a node, `prune` turns a branch off, and `keep` is one step of a beam search: it
 * keeps some nodes of the frontier and prunes the others. `frontier`, `score` and `stateOf` read the tree.
 */
export class TreeGraph extends Graph {
    readonly depths = new Map<string, number>()
    /** The parent of each node under the root, and the children of each node, in the order of the tree. */
    private readonly parents = new Map<string, string>()
    private readonly kids = new Map<string, string[]>()
    private readonly scores = new Map<string, number>()
    private readonly scored: 'product' | 'sum' | null
    /** The nodes on a lit path, each with the color of its light. */
    private lit = new Map<string, Paint>()
    private pruned = new Set<string>()

    protected override get kind(): string {
        return 'tree'
    }

    protected override [rebindCloneParts](copy: this, parts: ReadonlyMap<Node, Node>): void {
        super[rebindCloneParts](copy, parts)
        Object.assign(copy, { depths: new Map(this.depths), lit: new Map(this.lit), pruned: new Set(this.pruned) })
    }

    constructor(root: TreeSpec, options: TreeOptions = {}) {
        const specs: GraphNodeSpec[] = []
        const links: GraphEdgeSpec[] = []
        const depthOf = new Map<string, number>()
        const parentOf = new Map<string, string>(), scoreOf = new Map<string, number>()
        const down = options.direction !== 'right'
        const format = options.format ?? ((value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2)))
        const score = options.score ?? null
        if (score !== null && score !== 'product' && score !== 'sum') throw new Error(`tree: score is 'product' or 'sum', not ${quoted(score)}`)

        // Read the tree one time before the layout: what its nodes hold says how large a node is.
        let valued = score !== null, labelled = false, leaves = 0, levels = 0
        const texts: { label?: string; math?: boolean; value?: string }[] = [], edgeLabels: string[] = []
        // The score of each node, in the order of the tree: the layout walks the tree in that order too.
        const running: number[] = []
        const namedIds = new Set<string>()
        const read = (node: TreeSpec, depth: number, above: number): void => {
            if (node.id !== undefined) {
                if (namedIds.has(node.id)) throw new Error(`tree: two nodes have the id ${quoted(node.id)}. Give each node its own id`)
                namedIds.add(node.id)
            }
            if (node.value !== undefined) valued = true
            if (node.weight !== undefined && !Number.isFinite(node.weight)) throw new Error(`tree: the weight of the node ${quoted(node.id ?? node.label ?? '')} is ${quoted(node.weight)}. A weight is a number`)
            if (depth > 0 && score !== null && node.weight === undefined) throw new Error(`tree: with score: '${score}', each node under the root has a weight, and the node ${quoted(node.id ?? node.label ?? '')} has none. Give it a weight, such as weight: 0.5`)
            const own = depth === 0 ? above : score === 'product' ? above * node.weight! : score === 'sum' ? above + node.weight! : above
            running.push(own)
            const edge = depth === 0 ? undefined : node.edge ?? (node.weight !== undefined ? format(node.weight) : undefined)
            if (edge !== undefined && edge !== '') {
                labelled = true
                edgeLabels.push(edge)
            }
            texts.push({ label: node.label, math: node.math, value: node.value ?? (score !== null ? format(own) : undefined) })
            levels = Math.max(levels, depth + 1)
            const children = node.children ?? []
            if (children.length === 0) leaves += 1
            for (const child of children) read(child, depth + 1, own)
        }
        read(root, 0, score === 'product' ? 1 : 0)

        if (options.shape !== undefined && options.shape !== 'box' && options.shape !== 'circle') throw new Error(`tree: shape is 'box' or 'circle', not ${quoted(options.shape)}`)
        if (options.shape === 'circle' && valued) throw new Error("tree: a circle has no room for a value. Give shape: 'box', or leave shape out: a tree with a value or a score has box nodes")
        const boxed = options.shape ? options.shape === 'box' : valued
        // A tree of circles keeps the sizes that it had before it had boxes. A box tree has sizes that a viewer reads in a lesson video.
        const labelSize = options.labelSize ?? (boxed ? 28 : 24)
        const valueSize = options.valueSize ?? (boxed ? 26 : labelSize)
        const edgeLabelSize = options.edgeLabelSize ?? 26
        const edgeFont = options.edgeFont ?? filmFont() ?? 'mono'
        const radius = options.radius ?? 28
        let nodeWidth = radius * 2, nodeHeight = radius * 2
        if (boxed) {
            // All boxes have one size: the size that holds the widest text of the tree.
            const widths = texts.map((own) => Math.max(
                !own.label ? 0 : (own.math ? tex(own.label, { size: labelSize, display: false }) : text(own.label, { size: labelSize, font: options.font })).bounds().width,
                own.value === undefined ? 0 : text(own.value, { size: valueSize, font: options.font, weight: 600 }).bounds().width,
            ))
            const widest = Math.max(...widths)
            nodeHeight = Math.round(valued ? labelSize * NODE_LINE + valueSize * NODE_LINE + labelSize * 0.6 : labelSize * 2)
            nodeWidth = options.nodeWidth ?? Math.ceil(Math.max(widest + labelSize * 1.2, labelSize * 2.6))
            if (!(Number.isFinite(nodeWidth) && nodeWidth > 0) || widest > nodeWidth - labelSize) {
                const own = texts[widths.indexOf(widest)]!
                throw new Error(`tree: a nodeWidth of ${quoted(options.nodeWidth)} has no room for the texts of the node ${quoted(own.label ?? own.value ?? '')}, which are ${Math.ceil(widest)} px wide. Give a nodeWidth of ${Math.ceil(widest + labelSize)} or more, shorter texts, or a smaller labelSize`)
            }
        }
        // The size of a node along the line of its siblings, and along the levels.
        const across = down ? nodeWidth : nodeHeight, along = down ? nodeHeight : nodeWidth
        const widestEdge = labelled ? Math.max(...edgeLabels.map((label) => text(label, { size: edgeLabelSize, font: edgeFont }).bounds().width)) : 0
        // The room between two levels holds the label of an edge, with room at both of its ends.
        const levelRoom = labelled ? (down ? edgeLabelSize * 3.8 : widestEdge + edgeLabelSize * 3) : labelSize * 2.6
        let levelGap = options.levelGap ?? (boxed ? Math.round(along + levelRoom) : 130)
        let siblingGap = options.siblingGap ?? (boxed ? Math.round(across + labelSize * 0.9) : 96)
        if (options.width !== undefined) {
            const width = options.width
            if (!(Number.isFinite(width) && width > 0)) throw new Error(`tree: width is ${quoted(width)}. Give a size in pixels, more than 0`)
            if (down && options.siblingGap !== undefined) throw new Error('tree: width and siblingGap both set the room between the leaves. Give one of the two')
            if (!down && options.levelGap !== undefined) throw new Error('tree: width and levelGap both set the room between the levels of a tree that grows to the right. Give one of the two')
            // The parts that share the width: the leaves of a tree that grows down, the levels of a tree that grows to the right.
            const count = down ? leaves : levels
            const least = down ? nodeWidth + labelSize * 0.3 : nodeWidth + (labelled ? widestEdge + edgeLabelSize * 1.6 : labelSize)
            const gap = count > 1 ? (width - nodeWidth) / (count - 1) : 0
            if (count > 1 && gap < least) throw new Error(`tree: a width of ${width} gives each of the ${count} ${down ? 'leaves' : 'levels'} ${Math.max(0, Math.floor(gap))} px, and a node ${labelled && !down ? 'with the label of its edge ' : ''}needs ${Math.ceil(least)}. Give a width of ${Math.ceil(nodeWidth + (count - 1) * least)} or more, ${boxed ? 'shorter texts, a smaller labelSize' : 'a smaller radius'}, or fewer ${down ? 'leaves' : 'levels'}`)
            if (count > 1) {
                if (down) siblingGap = gap
                else levelGap = gap
            }
        }
        for (const [name, value] of [['levelGap', levelGap], ['siblingGap', siblingGap]] as const) {
            if (!Number.isFinite(value)) throw new Error(`tree: ${name} is ${quoted(value)}. Give a distance in pixels`)
        }

        let counter = 0
        let leafCursor = 0
        const place = (node: TreeSpec, depth: number): { id: string; position: number } => {
            while (node.id === undefined && namedIds.has(`n${counter}`)) counter++
            const id = node.id ?? `n${counter++}`
            depthOf.set(id, depth)
            // The nodes are placed in the order in which they were read, so this node is the next one of the list.
            const own = running[specs.length]!
            if (score !== null) scoreOf.set(id, own)
            const children = node.children ?? []
            let position: number
            const entry: GraphNodeSpec = { id, label: node.label, color: node.color, math: node.math }
            if (boxed) {
                entry.width = nodeWidth
                entry.height = nodeHeight
                const value = node.value ?? (score !== null ? format(own) : undefined)
                if (value !== undefined) entry.value = value
            }
            if (node.state !== undefined) entry.state = node.state
            specs.push(entry)
            if (children.length === 0) {
                position = leafCursor++
            } else {
                const placed = children.map((child) => place(child, depth + 1))
                position = (placed[0]!.position + placed[placed.length - 1]!.position) / 2
                placed.forEach((child, index) => {
                    const link: GraphEdgeSpec = { from: id, to: child.id, directed: false }
                    const spec = children[index]!
                    const label = spec.edge ?? (spec.weight !== undefined ? format(spec.weight) : undefined)
                    if (label !== undefined && label !== '') {
                        link.label = label
                        // Nearer to the child than to the parent: the edges of one parent are further apart there.
                        link.labelAt = 0.56
                    }
                    links.push(link)
                    parentOf.set(child.id, id)
                })
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
        if (boxed) {
            // The line of an edge of a box tree goes from the middle of the side of the parent that faces the
            // children to the middle of the side of the child that faces the parent. So the lines of one
            // parent start at one point, and each one ends at the middle of its box.
            const placeOf = new Map(specs.map((spec) => [spec.id, spec.at!]))
            const reach = along / 2 + 2
            for (const link of links) {
                const [px, py] = placeOf.get(link.from)!, [x, y] = placeOf.get(link.to)!
                EDGE_ENDS.set(link, down ? [[px, py + reach], [x, y - reach]] : [[px + reach, py], [x - reach, y]])
            }
        }
        let shown: string[] | undefined
        if (options.shown !== undefined) {
            const given = options.shown
            if (typeof given === 'number') {
                if (!(Number.isInteger(given) && given >= 0)) throw new Error(`tree: shown is ${given}. Give a depth, where 0 is the root alone, or a list of ids`)
                shown = specs.filter((spec) => depthOf.get(spec.id)! <= given).map((spec) => spec.id)
            } else if (Array.isArray(given)) {
                // A node shows with the nodes over it: a node with no parent on the stage has no place in a tree.
                const all = new Set<string>([specs[0]!.id])
                for (const id of given as readonly string[]) {
                    if (!depthOf.has(id)) throw new Error(`tree: shown: no node ${quoted(id)}. The nodes are ${specs.map((spec) => quoted(spec.id)).join(', ')}`)
                    for (let at: string | undefined = id; at !== undefined; at = parentOf.get(at)) all.add(at)
                }
                shown = [...all]
            } else {
                throw new Error(`tree: shown is ${quoted(given)}. Give a depth, where 0 is the root alone, or a list of ids`)
            }
        }
        super(specs, links, {
            layout: 'manual', radius, labelSize, nodeColor: options.nodeColor, edgeColor: options.edgeColor, fillOpacity: options.fillOpacity, font: options.font, directed: false,
            valueSize, edgeLabelSize, edgeFont: options.edgeFont, shown, token: options.token, tokenColor: options.tokenColor,
        })
        for (const [id, depth] of depthOf) this.depths.set(id, depth)
        for (const spec of specs) this.kids.set(spec.id, [])
        for (const [id, parent] of parentOf) {
            this.parents.set(id, parent)
            this.kids.get(parent)!.push(id)
        }
        for (const [id, value] of scoreOf) this.scores.set(id, value)
        this.scored = score
        objectName(this, 'tree')
        if (labelled) this.checkLabels(down, levelGap, siblingGap)
    }

    /**
     * The frontier, after the changes that are scheduled so far: the nodes that show, have no child that
     * shows, and are open. A node that is done, failed or off is not open. The ids are in the order of the tree.
     */
    get frontier(): string[] {
        return [...this.nodes.keys()].filter((id) => this.open(id) && !this.kids.get(id)!.some((child) => !this.waiting.has(child)))
    }

    /** The score of a node: the product or the sum of the weights from the root, as the option `score` says. */
    score(id: string): number {
        this.view(id, 'score')
        if (this.scored === null) throw new Error("tree: score: this tree has no score. Give the option score: 'product' or 'sum', and a weight to each node under the root")
        return this.scores.get(id)!
    }

    /** The ids of the nodes on the lit paths, after the changes that are scheduled so far, in the order of the tree. */
    get litPath(): string[] {
        return [...this.nodes.keys()].filter((id) => this.lit.has(id))
    }

    /** Grow from the root, one level at a time. */
    override enter(options: AnimOptions = {}): Anim {
        return {
            label: 'tree.enter', duration: options.duration ?? 2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                // A level whose nodes all wait for their `grow` takes no time.
                const levels = Math.max(...[...this.depths].filter(([id]) => !this.waiting.has(id)).map(([, depth]) => depth)) + 1
                const span = (ctx.t1 - ctx.t0) / levels
                for (const [id, view] of this.nodes) {
                    if (this.waiting.has(id)) continue
                    const depth = this.depths.get(id) ?? 0
                    const start = ctx.t0 + depth * span
                    popIn(view, ctx.t0, start, start + span, ctx.ease)
                }
                for (const edge of this.edges) {
                    if (this.waiting.has(edge.to)) continue
                    const depth = this.depths.get(edge.to) ?? 1
                    const start = ctx.t0 + (depth - 1) * span + span * 0.3
                    stepAt(edge.shaft, 'trimTo', 0, ctx.t0)
                    edge.shaft.tween('trimTo', 1, start, start + span * 0.8, ctx.ease)
                    // The words of the label of an edge arrive when its line is drawn. The plate of the label is there
                    // from the start, in the color of the background, so the line passes behind it.
                    const words = edge.caption?.children[1]
                    if (words) {
                        stepAt(words, 'opacity', 0, ctx.t0)
                        words.tween('opacity', 1, start + span * 0.5, start + span * 0.8, ctx.ease)
                    }
                }
            },
        }
    }

    /**
     * Light the way from the root to a node, or to each node of a list. A light runs down each edge, and the
     * edge and its node keep the color: a lit edge is wider, and a lit node is active. The lit paths are then
     * these paths, in this color, and no other: a path that was lit and is not named goes back to its plain
     * look. So a second call moves the light, a list lights two paths, and `null` turns the light off. With
     * `add: true`, the paths that are lit stay as they are, and this call lights one more: a second path in a
     * second color. A node that is done or failed keeps its state.
     */
    path(to: string | readonly string[] | null, options: AnimOptions & { color?: ColorInput; add?: boolean } = {}): Anim {
        const ends = to === null ? [] : typeof to === 'string' ? [to] : [...to]
        for (const id of ends) this.view(id, 'path')
        const paint = this.paintOf(options.color ?? 'yellow', 'the color of path')
        const call = `path(${to === null ? 'null' : JSON.stringify(to)})`
        return {
            label: 'tree.path', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                this.relight(this.ways(ends, 'path'), paint, options.add === true, call, ctx)
            },
        }
    }

    /**
     * Turn a branch off: the node and all under it. Each node gets a border of dashes and dim text, and each
     * edge of the branch a line of dashes, from the top of the branch down. The nodes of the branch that wait
     * are off too, and never grow: a pruned branch does no more work.
     */
    prune(id: string, options: AnimOptions = {}): Anim {
        this.view(id, 'prune')
        if (!this.parents.has(id)) throw new Error(`tree: prune: ${quoted(id)} is the root. A prune turns off a branch under the root`)
        return {
            label: 'tree.prune', duration: options.duration ?? 0.7, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                this.cut([id], `prune(${quoted(id)})`, ctx)
            },
        }
    }

    /**
     * One step of a beam search. Name the nodes of the frontier that the search keeps: their paths from the
     * root are lit, and every other node of the frontier is pruned, with each branch that then has no open
     * node. A node that is not in the frontier is an error that names the frontier. `frontier` is then the
     * kept nodes, and the next `grow` gives them children.
     */
    keep(which: string | readonly string[], options: AnimOptions & { color?: ColorInput } = {}): Anim {
        const kept = typeof which === 'string' ? [which] : [...which]
        if (kept.length === 0) throw new Error('tree: keep: give the id of a node of the frontier, or a list of ids. A search keeps one node at the least')
        for (const id of kept) this.view(id, 'keep')
        const paint = this.paintOf(options.color ?? 'yellow', 'the color of keep')
        const call = `keep(${JSON.stringify(which)})`
        return {
            label: 'tree.keep', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const frontier = this.frontier
                for (const id of kept) {
                    if (!frontier.includes(id)) throw new Error(`tree: keep: ${quoted(id)} is not in the frontier. The frontier is ${frontier.length > 0 ? frontier.map(quoted).join(', ') : 'empty'}: the open nodes that show and have no child that shows`)
                }
                const ways = this.ways(kept, 'keep')
                // A node that the search does not keep is dead, and so is each node over it that has no other open node under it.
                const dead = new Set(frontier.filter((id) => !kept.includes(id)))
                for (let changed = true; changed;) {
                    changed = false
                    for (const [id, children] of this.kids) {
                        if (dead.has(id) || ways.has(id) || !this.parents.has(id) || this.waiting.has(id) || this.states.get(id) === 'off') continue
                        const showing = children.filter((child) => !this.waiting.has(child))
                        if (showing.length === 0 || !showing.every((child) => dead.has(child) || this.states.get(child) === 'off')) continue
                        dead.add(id)
                        changed = true
                    }
                }
                this.cut([...dead].filter((id) => !dead.has(this.parents.get(id)!)), call, ctx)
                this.relight(ways, paint, false, call, ctx)
            },
        }
    }

    /** A pruned branch stays off: its edges keep their dashes, so a node of it with another state would be a wrong picture. */
    protected override settable(id: string, state: GraphState): void {
        if (state !== 'off' && this.pruned.has(id)) {
            throw new Error(`tree: setState: ${quoted(id)} is in a pruned branch, and a pruned branch stays off. Prune later, or leave the node out of the prune`)
        }
    }

    /** A node under a branch that is off cannot grow, and a node grows after its parent. */
    protected override growable(ids: readonly string[]): void {
        const arriving = new Set<string>()
        for (const id of ids) {
            const parent = this.parents.get(id)
            if (parent !== undefined && this.waiting.has(parent) && !arriving.has(parent)) throw new Error(`tree: grow: the parent of ${quoted(id)} is ${quoted(parent)}, which does not show yet. Grow ${quoted(parent)} first, or name it before ${quoted(id)} in the same call`)
            if (this.states.get(id) === 'off') {
                let top = id
                while (this.parents.has(top) && this.states.get(this.parents.get(top)!) === 'off') top = this.parents.get(top)!
                throw new Error(`tree: grow: ${quoted(id)} is ${top === id ? 'off' : `in the branch of ${quoted(top)}, which is pruned`}. A branch that is off does not grow. Grow the node before the prune, or leave it out`)
            }
            arriving.add(id)
        }
    }

    /** True for a node that shows and is idle or active. */
    private open(id: string): boolean {
        const state = this.states.get(id)
        return !this.waiting.has(id) && (state === 'idle' || state === 'active')
    }

    /** The nodes on the ways from the root to some nodes. Each way must show, and no part of it may be off. */
    private ways(ends: readonly string[], call: string): Set<string> {
        const all = new Set<string>()
        for (const end of ends) {
            for (let id: string | undefined = end; id !== undefined; id = this.parents.get(id)) {
                if (this.waiting.has(id)) throw new Error(`tree: ${call}: ${id === end ? `the node ${quoted(end)}` : `the node ${quoted(id)}, on the way to ${quoted(end)},`} does not show yet. Grow it first`)
                if (this.states.get(id) === 'off') throw new Error(`tree: ${call}: ${id === end ? `the node ${quoted(end)}` : `the node ${quoted(id)}, on the way to ${quoted(end)},`} is off. A light does not go through a pruned branch`)
                all.add(id)
            }
        }
        return all
    }

    /** The edge from the parent of a node to the node. */
    private edgeTo(id: string): GraphEdge {
        return this.edges.find((edge) => edge.to === id)!
    }

    /**
     * Light the ways that are given. Without `add`, the lit paths become these ways in this color: a part that
     * is on no way goes plain, and a part that is lit in another color takes the new one. With `add`, what is
     * lit stays as it is. The parts light from the root down.
     */
    private relight(ways: Set<string>, paint: Paint, add: boolean, call: string, ctx: AnimContext): void {
        const { t0, t1, ease } = ctx
        for (const id of add ? [] : [...this.lit.keys()].filter((own) => !ways.has(own))) {
            this.lit.delete(id)
            // A node that a prune of this play turned off keeps the look of the prune.
            if (this.states.get(id) === 'off') continue
            if (this.parents.has(id)) this.strokeEdge(this.edgeTo(id), toPaint(this.edgeTo(id).lineColor), this.edgeTo(id).lineWidth, t0, t1, ease)
            if (this.states.get(id) === 'active') {
                this.claimLook(id, call, ctx)
                this.states.set(id, 'idle')
                this.paint(id, this.look(id, 'idle'), ctx)
            }
        }
        const color = JSON.stringify(paint)
        const fresh = [...ways].filter((id) => !this.lit.has(id) || (!add && JSON.stringify(this.lit.get(id)) !== color))
        // One level after another: the light is at one depth at a time, as a walk down the tree is.
        const depths = [...new Set(fresh.map((id) => this.depths.get(id)!))].sort((a, b) => a - b)
        const windows = staggered(depths.length, 1, t0, t1)
        for (const id of fresh) {
            const [start, end] = windows[depths.indexOf(this.depths.get(id)!)]!, span = end - start
            this.lit.set(id, paint)
            if (this.parents.has(id)) {
                const edge = this.edgeTo(id)
                runLight(edge, false, start, start + span * 0.7, ease, paint, 0.3)
                this.strokeEdge(edge, paint, edge.lineWidth * 2, start + span * 0.3, start + span * 0.8, ease)
            }
            const state = this.states.get(id)!
            if (state === 'idle' || state === 'active') {
                this.claimLook(id, call, ctx)
                this.states.set(id, 'active')
                this.paint(id, this.look(id, 'active', paint), { t0: this.parents.has(id) ? start + span * 0.5 : start, t1: end, ease })
            }
        }
    }

    /** Turn off some branches: each node that is given, and all under it. The nodes of one depth change together, from the top down. */
    private cut(tops: readonly string[], call: string, ctx: AnimContext): void {
        const branch: string[] = []
        const walk = (id: string) => {
            branch.push(id)
            for (const child of this.kids.get(id)!) walk(child)
        }
        for (const top of tops) walk(top)
        const showing = branch.filter((id) => !this.waiting.has(id) && !this.pruned.has(id))
        const depths = [...new Set(showing.map((id) => this.depths.get(id)!))].sort((a, b) => a - b)
        const windows = staggered(depths.length, 0.5, ctx.t0, ctx.t1)
        const off = toPaint('faint'), dim = toPaint('dim')
        for (const id of showing) {
            const [start, end] = windows[depths.indexOf(this.depths.get(id)!)]!
            this.claimLook(id, call, ctx)
            this.paint(id, this.look(id, 'off'), { t0: start, t1: end, ease: ctx.ease })
            const edge = this.edgeTo(id)
            this.strokeEdge(edge, off, edge.lineWidth, start, end, ctx.ease)
            stepAt(edge.shaft, 'dash', OFF_DASH, (start + end) / 2)
            // The label of the edge stays, and is dim: a viewer still reads the number that lost.
            for (const leaf of edge.caption?.children[1]?.leaves() ?? []) leaf.tween('fill', dim, start, end, ctx.ease)
        }
        // A node of the branch that waits is off too, so the branch does not grow.
        for (const id of branch) {
            this.pruned.add(id)
            this.states.set(id, 'off')
            this.lit.delete(id)
        }
    }

    /** The line of an edge takes a color and a width. */
    private strokeEdge(edge: GraphEdge, paint: Paint, width: number, t0: number, t1: number, ease: Ease): void {
        edge.shaft.tween('stroke', paint, t0, t1, ease)
        edge.shaft.tween('strokeWidth', width, t0, t1, ease)
    }

    /**
     * The labels of the edges must be clear of each other and of the nodes. The tree gives each label its
     * place, so a label with no room is an error that says which distance to change.
     */
    private checkLabels(down: boolean, levelGap: number, siblingGap: number): void {
        const boxes = this.edges.flatMap((edge) => {
            const plate = edge.caption?.children[0]
            if (!plate) return []
            const b = plate.bounds()
            return [{ id: edge.to, left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height }]
        })
        const meet = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
        for (const label of boxes) {
            for (const [id, view] of this.nodes) {
                const x = view.get('x'), y = view.get('y')
                if (!meet(label, { left: x - view.halfWidth, top: y - view.halfHeight, right: x + view.halfWidth, bottom: y + view.halfHeight })) continue
                throw new Error(`tree: the label of the edge to ${quoted(label.id)} has no room between the levels: it meets the node ${quoted(id)}. Give a larger ${down ? 'levelGap' : 'levelGap or width'} (the levelGap is ${Math.round(levelGap)} now), a shorter label, or a smaller edgeLabelSize`)
            }
        }
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                if (!meet(boxes[i]!, boxes[j]!)) continue
                throw new Error(`tree: the labels of the edges to ${quoted(boxes[i]!.id)} and ${quoted(boxes[j]!.id)} meet. Give a larger ${down ? 'siblingGap or width' : 'siblingGap'} (the siblingGap is ${Math.round(siblingGap)} now), shorter labels, or a smaller edgeLabelSize`)
            }
        }
    }
}

/** A tidy tree: `tree({ id: 'the', label: 'The dog', children: [{ id: 'ran', label: 'ran', weight: 0.6 }, { id: 'slept', label: 'slept', weight: 0.4 }] }, { score: 'product', shown: 0 })`, then `t.grow(['ran', 'slept'])` and `t.path('slept')`. */
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
    /** The font of the values. Defaults to mono. The indexes are in mono. */
    font?: TextOptions['font']
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
        ownLabels(this, { name: 'row of array cells' })
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

interface LanguageRule {
    keywords: ReadonlySet<string>
    /** Markers that start a comment that runs to the end of the line. */
    lineComments: readonly string[]
    /** The open and close markers of a comment that can span lines. */
    blockComment?: readonly [string, string]
    /** The quote characters that delimit a string. Any other quote is punctuation, such as the prime in `x'`. */
    quotes: string
    /** Read `'a'` as a string where `'` alone is not a quote, as in Rust and Dafny. */
    charLiterals?: boolean
    /** Keywords match in any case. */
    insensitive?: boolean
    /** An identifier, where it differs from letters, digits, `_`, and `$`. */
    word?: RegExp
    /** A keyword that starts with a symbol, such as `\in` in TLA+ or `#print` in Lean. */
    symbolKeyword?: RegExp
    /** A number form that the common pattern does not cover, such as `#x7fffffff` in SMT-LIB. */
    number?: RegExp
    /** The word after an opening parenthesis names a function, as in Lisp. */
    headIsFunction?: boolean
}

const words = (list: string): ReadonlySet<string> => new Set(list.split(' '))
const C_STYLE = { lineComments: ['//'], blockComment: ['/*', '*/'], quotes: '"\'' } as const

const LANGUAGES: Record<string, LanguageRule> = {
    ts: { ...C_STYLE, quotes: '"\'`', keywords: words('const let var function return if else for while do switch case break continue new class extends implements interface type enum import export from default async await yield try catch finally throw typeof instanceof in of this super null undefined true false void as readonly public private protected static get set') },
    python: { lineComments: ['#'], quotes: '"\'', keywords: words('def return if elif else for while in not and or is class import from as with try except finally raise lambda yield pass break continue global nonlocal None True False self async await assert del print') },
    rust: { ...C_STYLE, quotes: '"', charLiterals: true, keywords: words('fn let mut pub struct enum impl trait use mod match if else for while loop return self Self as in where const static crate super true false ref move async await dyn type unsafe') },
    go: { ...C_STYLE, quotes: '"\'`', keywords: words('func var const type struct interface package import return if else for range switch case default break continue go defer select chan map nil true false') },
    java: { ...C_STYLE, keywords: words('abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public record return short static super switch this throw throws true false try var void volatile while') },
    c: { ...C_STYLE, keywords: words('auto bool break case char const continue default do double else enum extern false float for goto if inline int long register return short signed sizeof static struct switch true typedef union unsigned void volatile while NULL') },
    sql: { lineComments: ['--'], quotes: '"\'`', insensitive: true, keywords: words('select from where join left right inner outer on group by order having limit as and or not in is null insert into values update set delete create table with distinct count sum avg min max') },
    bash: { lineComments: ['#'], quotes: '"\'`', keywords: words('if then else elif fi for do done while case esac in function return export local echo cd exit set') },
    // Specification and proof languages. A prime is part of a name or an operator in each of them, so it never starts a string.
    tla: {
        lineComments: ['\\*'], blockComment: ['(*', '*)'], quotes: '"',
        // An operator word such as `\in`, and the fairness prefix of `WF_vars(Next)`.
        symbolKeyword: /^(?:\\[A-Za-z]+|[SW]F_)/,
        keywords: words('MODULE EXTENDS CONSTANT CONSTANTS VARIABLE VARIABLES ASSUME ASSUMPTION AXIOM THEOREM LEMMA PROOF BY QED LET IN IF THEN ELSE CASE OTHER CHOOSE EXCEPT UNCHANGED ENABLED DOMAIN SUBSET UNION INSTANCE WITH LOCAL RECURSIVE LAMBDA TRUE FALSE BOOLEAN STRING SPECIFICATION INVARIANT PROPERTY CONSTRAINT SYMMETRY INIT NEXT CHECK_DEADLOCK'),
    },
    dafny: {
        ...C_STYLE, quotes: '"', charLiterals: true,
        keywords: words('abstract array assert assume bool break by calc case char class codatatype const constructor datatype decreases else ensures exists export extends false forall fresh function ghost if import in include int invariant iterator lemma map match method modifies module multiset nat new newtype null object old opened predicate print provides reads real refines requires return returns reveals seq set static string then this trait true type var while witness yield'),
    },
    lean: {
        lineComments: ['--'], blockComment: ['/-', '-/'], quotes: '"',
        word: /^[A-Za-z_][\w!?']*/, symbolKeyword: /^#[a-z_]+/,
        keywords: words('theorem lemma def example abbrev instance structure inductive class axiom opaque namespace section end open import variable universe where with by fun match let in have show from at do if then else return for mutual private protected partial noncomputable unsafe deriving termination_by decreasing_by macro syntax notation calc sorry intro intros apply exact refine constructor cases induction rcases obtain simp simp_all omega decide rfl rw unfold exists use contradiction trivial assumption'),
    },
    smt: {
        lineComments: [';'], quotes: '"', headIsFunction: true,
        word: /^[A-Za-z_~!@$%^&*+=<>.?/-][\w~!@$%^&*+=<>.?/-]*/, number: /^(#x[\da-fA-F]+|#b[01]+)/,
        keywords: words('assert check-sat check-sat-assuming declare-const declare-datatypes declare-fun declare-sort define-const define-fun define-fun-rec define-sort echo exit get-info get-model get-option get-proof get-unsat-core get-value pop push reset set-info set-logic set-option exists forall let match par as _ !'),
    },
    plain: { lineComments: [], quotes: '', keywords: new Set() },
}

const ALIASES: Record<string, string> = {
    js: 'ts', jsx: 'ts', tsx: 'ts', typescript: 'ts', javascript: 'ts', py: 'python', rs: 'rust', golang: 'go', sh: 'bash', shell: 'bash',
    'tla+': 'tla', tlaplus: 'tla', dfy: 'dafny', lean4: 'lean', smt2: 'smt', smtlib: 'smt', 'smt-lib': 'smt', cpp: 'c', 'c++': 'c', h: 'c', text: 'plain',
}

/** The languages that `tokenize` and `codeBlock` color. An unknown name falls back to TypeScript. */
export const CODE_LANGUAGES: readonly string[] = Object.keys(LANGUAGES)

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function stringPattern(rule: LanguageRule): RegExp | null {
    const forms = [...rule.quotes].map((quote) => {
        const q = escapeRegExp(quote)
        return `${q}(?:[^${q}\\\\]|\\\\.)*${q}?`
    })
    // A character literal is one character, or one escape, in single quotes. A lifetime such as 'a has no closing quote.
    if (rule.charLiterals) forms.push(`'(?:[^'\\\\]|\\\\.)'`)
    return forms.length > 0 ? new RegExp(`^(?:${forms.join('|')})`) : null
}

/** A small tokenizer for film code. It colors the common cases and never blocks on odd input. */
export function tokenize(source: string, language = 'ts'): Omit<CodeToken, 'glyphs'>[] {
    const name = language.toLowerCase()
    const rule = LANGUAGES[ALIASES[name] ?? name] ?? LANGUAGES['ts']!
    const string = stringPattern(rule)
    const word = rule.word ?? /^[A-Za-z_$][\w$]*/
    const out: Omit<CodeToken, 'glyphs'>[] = []
    // A block comment can end on a later line.
    let inBlock = false
    source.split('\n').forEach((row, line) => {
        let i = 0
        let afterOpen = false
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
            if (inBlock) {
                const close = rest.indexOf(rule.blockComment![1])
                inBlock = close < 0
                push(close < 0 ? rest : rest.slice(0, close + rule.blockComment![1].length), 'comment')
                continue
            }
            if (rule.lineComments.some((marker) => rest.startsWith(marker))) {
                push(rest, 'comment')
                continue
            }
            if (rule.blockComment && rest.startsWith(rule.blockComment[0])) {
                const close = rest.indexOf(rule.blockComment[1], rule.blockComment[0].length)
                inBlock = close < 0
                push(close < 0 ? rest : rest.slice(0, close + rule.blockComment[1].length), 'comment')
                continue
            }
            const headed = afterOpen
            afterOpen = rest[0] === '('
            const quoted = string?.exec(rest)
            if (quoted) {
                push(quoted[0], 'string')
                continue
            }
            const number = rule.number?.exec(rest) ?? /^(0x[\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:e[-+]?\d+)?)/.exec(rest)
            if (number) {
                push(number[0], 'number')
                continue
            }
            const symbol = rule.symbolKeyword?.exec(rest)
            if (symbol) {
                push(symbol[0], 'keyword')
                continue
            }
            const found = word.exec(rest)
            if (found) {
                const value = found[0]
                const after = rest.slice(value.length)
                const isKeyword = rule.keywords.has(rule.insensitive ? value.toLowerCase() : value)
                const kind: TokenKind = isKeyword ? 'keyword'
                    : (rule.headIsFunction ? headed : /^\s*\(/.test(after)) ? 'function'
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
    /** One of `CODE_LANGUAGES`, or an alias such as `py`, `tla+`, or `smt2`. Defaults to TypeScript. */
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
            // The film check reads the font size and the words of a text here. `text()` records the size in the same way.
            line.data['size'] = size
            line.data['source'] = rows[i]!.trim()
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
        ownLabels(this, { name: 'code block' })
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
        // Compare one character with one glyph. A string or a comment has a glyph for each space inside it, and those do not count either.
        const blank = (char: string) => /\s/.test(char)
        const needle = [...fragment].filter((char) => !blank(char))
        if (needle.length === 0) return []
        const out: Node[] = []
        for (let row = 0; row < this.lines.length; row++) {
            const glyphs = tokens.filter((token) => token.line === row).flatMap((token) => token.glyphs).filter((glyph) => !blank(glyph.data['key'] as string))
            for (let at = 0; at + needle.length <= glyphs.length; at++) {
                if (!needle.every((char, offset) => glyphs[at + offset]!.data['key'] === char)) continue
                out.push(...glyphs.slice(at, at + needle.length))
                // The next match starts after this one.
                at += needle.length - 1
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
    leaf.data['base'] = 0
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
    oneObject('morphCode', from, 'the first argument', CodeBlock, 'a block of code, such as codeBlock(source)')
    oneObject('morphCode', to, 'the second argument', CodeBlock, 'a block of code, such as codeBlock(source)')
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
    /** The font of the layer labels. Defaults to the font of the film. */
    font?: TextOptions['font']
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
                const caption = text(name, { size, font: options.font, color: 'dim' }).at(x, height / 2 + size * 1.5)
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
        ownLabels(this, { name: 'neural net' })
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
    /** The font of the tokens. Defaults to mono. The line under a chip is in mono. */
    font?: TextOptions['font']
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
        ownLabels(this, { name: 'row of tokens' })
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
    /** The font of the token labels. Defaults to the font of the film. */
    font?: TextOptions['font']
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
        font: options.font,
    })
}

