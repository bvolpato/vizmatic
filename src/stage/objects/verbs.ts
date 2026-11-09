import { dynamic, Node } from '../node'
import { apply, invert, rectPath, type Vec } from '../geometry'
import { text, type TextOptions } from '../text'
import { smooth, linear } from '../ease'
import { toPaint, type ColorInput } from '../color'
import { Value, type Anim, type AnimOptions, type Target } from '../anim'
import { addLight, inside } from '../light'
import { Block, nodesFor, oneNode } from '../layout'
import { clock } from '../track'
import { reveal, stepAt, tweenValue } from './util'

function list(target: Target, what = 'an animation'): Node[] {
    return nodesFor(what, target)
}

function glyphsOf(target: Target): Node[] {
    return list(target).flatMap((node) => node.leaves().filter((leaf) => leaf.get('path')))
}

export interface TypewriterOptions extends AnimOptions {
    /** Show a block cursor at the writing position. */
    cursor?: boolean
    cursorColor?: ColorInput
}

/** Characters appear one at a time, at a steady rate, with an optional cursor. */
export function typewriter(target: Target, options: TypewriterOptions = {}): Anim {
    const glyphs = glyphsOf(target)
    return {
        label: 'typewriter', duration: options.duration ?? Math.max(0.5, glyphs.length * 0.035), ease: options.ease ?? linear,
        schedule(ctx) {
            for (const node of list(target)) reveal(node, ctx.t0, ctx.stage)
            const leaves = glyphsOf(target)
            if (leaves.length === 0) return
            const span = ctx.t1 - ctx.t0
            let cursor: Node | null = null
            if (options.cursor) {
                const first = leaves[0]!.bounds()
                const height = first.height * 1.35 || 24
                cursor = new Node(rectPath(0, -height / 2, Math.max(3, height * 0.1), height)).fill(options.cursorColor ?? 'ink')
                // The cursor stands beside the last letter on purpose, so the film check does not judge the text against it.
                cursor.data['decoration'] = true
                ctx.stage.add(cursor)
                ctx.stage.marks.set(cursor, list(target)[0]!)
            }
            leaves.forEach((leaf, i) => {
                const at = ctx.t0 + span * ctx.ease(i / leaves.length)
                const opacity = leaf.get('opacity')
                stepAt(leaf, 'opacity', 0, ctx.t0)
                stepAt(leaf, 'opacity', opacity, at)
                if (cursor) {
                    clock.now = at
                    const b = leaf.bounds()
                    stepAt(cursor, 'x', b.x + b.width + 3, at)
                    stepAt(cursor, 'y', b.y + b.height / 2, at)
                    clock.now = ctx.t0
                }
            })
            if (cursor) stepAt(cursor, 'visible', false, ctx.t1)
        },
    }
}

export interface WipeOptions extends AnimOptions {
    /** Edge the reveal starts from. */
    from?: 'left' | 'right' | 'top' | 'bottom'
    /** Share of the time each mark takes to fade up as the edge passes. */
    soft?: number
    /** Slide each mark this far as it arrives. */
    travel?: number
}

/**
 * Reveal marks in the order a moving edge reaches them. Each mark fades up as
 * the edge passes, so a dense diagram opens like a sweep across the page.
 */
export function wipe(target: Target, options: WipeOptions = {}): Anim {
    return {
        label: 'wipe', duration: options.duration ?? 1.2, ease: options.ease ?? smooth,
        schedule(ctx) {
            const from = options.from ?? 'left'
            for (const node of list(target)) reveal(node, ctx.t0, ctx.stage)
            const leaves = list(target).flatMap((node) => node.leaves())
            const position = (leaf: Node): number => {
                const b = leaf.bounds()
                const cx = b.x + b.width / 2, cy = b.y + b.height / 2
                return from === 'left' ? cx : from === 'right' ? -cx : from === 'top' ? cy : -cy
            }
            const values = leaves.map(position)
            const low = Math.min(...values), high = Math.max(...values)
            const soft = options.soft ?? 0.25
            const travel = options.travel ?? 0
            const span = ctx.t1 - ctx.t0
            const dx = from === 'left' ? -travel : from === 'right' ? travel : 0
            const dy = from === 'top' ? -travel : from === 'bottom' ? travel : 0
            leaves.forEach((leaf, i) => {
                const fraction = high > low ? (values[i]! - low) / (high - low) : 0
                const start = ctx.t0 + span * (1 - soft) * ctx.ease(fraction)
                const end = start + span * soft
                const opacity = leaf.get('opacity')
                stepAt(leaf, 'opacity', 0, ctx.t0)
                leaf.tween('opacity', opacity, start, end, smooth)
                if (travel) {
                    const x = leaf.get('x'), y = leaf.get('y')
                    stepAt(leaf, 'x', x + dx, ctx.t0)
                    stepAt(leaf, 'y', y + dy, ctx.t0)
                    leaf.tween('x', x, start, end, smooth)
                    leaf.tween('y', y, start, end, smooth)
                }
            })
        },
    }
}

export interface CounterOptions {
    digits?: number
    size?: number
    color?: ColorInput
    /** Defaults to mono, in every film: a number that changes keeps its width in mono. */
    font?: TextOptions['font']
    weight?: 400 | 600 | 700
    prefix?: string
    suffix?: string
    /** Thousands separators. */
    grouped?: boolean
}

/** A number readout. Animate it with `countUp`. */
export class Counter extends Node {
    readonly value: Value

    constructor(initial = 0, options: CounterOptions = {}) {
        super()
        this.value = new Value(initial)
        const digits = options.digits ?? 0
        const format = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: options.grouped ?? true })
        const inner = dynamic(() => {
            const body = `${options.prefix ?? ''}${format.format(this.value.value)}${options.suffix ?? ''}`
            return text(body, { size: options.size ?? 48, color: options.color ?? 'ink', font: options.font ?? 'mono', weight: options.weight ?? 400 })
        })
        this.add(inner)
    }
}

export function counter(initial = 0, options: CounterOptions = {}): Counter {
    return new Counter(initial, options)
}

/** Count a Counter or Value to a target. */
export function countUp(target: Counter | Value, to: number, options: AnimOptions = {}): Anim {
    const given: unknown = target
    if (!(given instanceof Counter || given instanceof Value)) throw new Error(`countUp: the first argument is ${given instanceof Block ? 'a block of the layout' : given instanceof Node ? 'a node of another kind' : String(given)}. Give a counter, such as counter(0), or a value of the stage`)
    const value = target instanceof Counter ? target.value : target
    return {
        label: 'countUp', duration: options.duration ?? 1.2, ease: options.ease,
        schedule(ctx) {
            if (target instanceof Counter) reveal(target, ctx.t0, ctx.stage)
            tweenValue(value, to, ctx.t0, ctx.t1, ctx.ease)
        },
    }
}

/** Steady rotation for as long as it plays: radians per second, around the center or a point. */
export function spin(node: Node, rate: number, options: AnimOptions & { about?: Vec } = {}): Anim {
    oneNode('spin', node, 'the first argument')
    return {
        label: 'spin', duration: options.duration ?? 2, ease: options.ease ?? linear,
        schedule(ctx) {
            reveal(node, ctx.t0, ctx.stage)
            clock.now = ctx.t0
            node.pivotAt(options.about ?? node.center)
            const start = node.get('rotation')
            const seconds = ctx.t1 - ctx.t0
            node.tween('rotation', start + rate * seconds, ctx.t0, ctx.t1, ctx.ease)
        },
    }
}

/** Two nodes trade places along opposite arcs. */
export function swap(a: Node, b: Node, options: AnimOptions & { lift?: number } = {}): Anim {
    oneNode('swap', a, 'the first argument')
    oneNode('swap', b, 'the second argument')
    return {
        label: 'swap', duration: options.duration ?? 0.9, ease: options.ease,
        schedule(ctx) {
            reveal(a, ctx.t0, ctx.stage)
            reveal(b, ctx.t0, ctx.stage)
            clock.now = ctx.t0
            const ca = a.center, cb = b.center
            const lift = options.lift ?? Math.max(60, Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) * 0.3)
            const travel = (node: Node, from: Vec, to: Vec, sign: number) => {
                const inverse = node.parent ? invert(node.parent.worldMatrix()) : ([1, 0, 0, 1, 0, 0] as const)
                const x0 = node.get('x'), y0 = node.get('y')
                const [lfx, lfy] = apply(inverse, from[0], from[1]), [ltx, lty] = apply(inverse, to[0], to[1])
                const x1 = x0 + ltx - lfx, y1 = y0 + lty - lfy
                node.track('x').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: x1, at: (t) => x0 + (x1 - x0) * t })
                node.track('y').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: y1, at: (t) => y0 + (y1 - y0) * t - sign * lift * 4 * t * (1 - t) })
            }
            travel(a, ca, cb, 1)
            travel(b, cb, ca, -1)
        },
    }
}

export interface HighlightOptions extends AnimOptions {
    color?: ColorInput
    opacity?: number
    /** Extra room around the target. */
    pad?: number
    radius?: number
    /** Keep the mark afterwards. By default it stays until you fade it. */
    from?: 'left' | 'right'
}

/**
 * A marker stroke sweeps across a target and stays behind it. `.mark` is the
 * node, so it can be faded out later.
 */
export function highlightSweep(target: Target, options: HighlightOptions = {}): Anim & { mark: Node } {
    const mark = new Node([])
    // A film puts this mark behind a text on purpose, so the film check does not judge the text against it.
    mark.data['decoration'] = true
    const nodes = list(target)
    return {
        mark,
        label: 'highlightSweep', duration: options.duration ?? 0.7, ease: options.ease,
        schedule(ctx) {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
            for (const node of nodes) {
                const b = node.bounds()
                x0 = Math.min(x0, b.x)
                y0 = Math.min(y0, b.y)
                x1 = Math.max(x1, b.x + b.width)
                y1 = Math.max(y1, b.y + b.height)
            }
            const pad = options.pad ?? 6
            const left = x0 - pad, top = y0 - pad, width = x1 - x0 + pad * 2, height = y1 - y0 + pad * 2
            const radius = options.radius ?? 3
            const color = options.color ?? 'yellow'
            mark.base.fill = toPaint(color)
            mark.base.fillOpacity = options.opacity ?? 0.26
            // The mark sits behind the target in draw order.
            const parent = ctx.stage.root
            parent.add(mark)
            ctx.stage.marks.set(mark, nodes[0]!)
            const first = nodes[0]!
            let anchor: Node = first
            while (anchor.parent && anchor.parent !== parent) anchor = anchor.parent
            const index = parent.children.indexOf(anchor)
            parent.children.splice(parent.children.indexOf(mark), 1)
            parent.children.splice(index >= 0 ? index : parent.children.length, 0, mark)
            const fromRight = options.from === 'right'
            const shape = (a: number) => {
                const w = Math.max(0.01, width * a)
                return rectPath(fromRight ? left + width - w : left, top, w, height, radius)
            }
            mark.track('path').step(ctx.t0, shape(0))
            mark.track('path').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: shape(1), at: shape })
        },
    }
}

export interface SpotlightOptions extends AnimOptions {
    /**
     * The part of its color that the rest keeps, from 0 to 1. At 0 the rest has the color of the background.
     * Defaults to 0.3 on a dark look and to 0.4 on a light look, which leave dim text at the same contrast.
     */
    dim?: number
    /** Dim only inside this node, such as one chart or one group. The rest of the stage does not change. */
    within?: Node
    /** One node or more that stay bright with the targets, such as a heading, a source line, or a backdrop. */
    keep?: Target
}

/** A film can read a node from a list at an index that is not there, such as `rows[7]` of six rows. Say so. */
function mustBeNodes(nodes: readonly unknown[], what: string): void {
    for (const node of nodes) {
        if (!(node instanceof Node)) throw new Error(`spotlight: ${what} is ${node === null ? 'null' : typeof node}, not a node. Check the index or the name that the film reads it from`)
    }
}

/**
 * Put the light on one node or more: `s.play(spotlight(row3))`. The rest of the stage dims, and the targets
 * keep their look. The light stays on. A second `spotlight` moves it, and `spotlight(null)` turns it off.
 *
 * The rest is every node that shows before the light starts and that is not a target, not in a target,
 * and not an ancestor of a target. An ancestor keeps its look, and its other children dim. Pinned nodes
 * and the nodes in `keep` stay bright as the targets do. A node that comes to the stage with the light, or
 * later, is not dimmed.
 *
 * A dim node keeps its opacity. Its colors go toward the background of the film, so it still hides what is
 * behind it, and a fade that the film makes while the light is on is still there when the light goes off.
 *
 * The verb only adds a light to the list of the stage. What is dim at a time comes from that list in time
 * order, when the film is complete. So a film can name its lights, and bring its nodes, in any order.
 */
export function spotlight(target: Target | null, options: SpotlightOptions = {}): Anim {
    // A film that writes spotlight(a, b) means a light on two nodes, and the second one would be lost as an option.
    if (options instanceof Node || options instanceof Block || Array.isArray(options)) throw new Error('spotlight: the second argument is a node, and it must be the options. To light more than one node, give them as one list: spotlight([a, b])')
    // A block of the layout stands for its nodes. Each other value has the message of `mustBeNodes`.
    const each = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]).flatMap((item) => (item instanceof Block ? item.nodes : [item]))
    const targets = target === null ? null : each(target) as Node[]
    const keep = options.keep === undefined ? [] : each(options.keep) as Node[]
    const within = options.within
    if (targets?.length === 0) throw new Error('spotlight: the list of targets is empty. Give it a node to light, or null to turn the light off')
    mustBeNodes(targets ?? [], 'a target')
    mustBeNodes(keep, 'a node in keep')
    if (within !== undefined) mustBeNodes([within], 'the node for within')
    const { dim, duration } = options
    if (dim !== undefined && !(typeof dim === 'number' && dim >= 0 && dim <= 1)) throw new Error(`spotlight: dim is ${typeof dim === 'string' ? JSON.stringify(dim) : String(dim)}. It is the part of its color that the rest keeps, a number from 0 to 1`)
    if (duration !== undefined && !(Number.isFinite(duration) && duration >= 0)) throw new Error(`spotlight: duration is ${duration}. It is the time that the light takes to change, in seconds, 0 or more`)
    if (within && targets?.some((node) => !inside(node, within))) throw new Error('spotlight: a target is not inside the node for within. Give a part of that node, or leave within out to dim the whole stage')
    return {
        label: 'spotlight', duration: duration ?? 0.5, ease: options.ease,
        schedule(ctx) {
            const { stage } = ctx
            if (targets?.includes(stage.camera)) throw new Error('spotlight: a target is the camera, which is not a part of the picture. Give it a node that the film draws')
            if (targets?.includes(stage.root)) throw new Error('spotlight: a target is the root of the stage, which holds every node, so nothing would dim. Give it one node or more, or null to turn the light off')
            addLight(stage, { start: ctx.t0, end: ctx.t1, ease: ctx.ease, targets, keep, within: within ?? null, dim: dim ?? (stage.look.dark ? 0.3 : 0.4) })
        },
    }
}
