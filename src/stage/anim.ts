import { smooth, linear, thereAndBack, wiggle as wiggleEase, type Ease } from './ease'
import { encloses } from './enclose'
import {
    apply, compose, matScale, pathBounds, pointAt, subdivideEach, tangentAt, transformPath, warpPath, circlePath, linePath, rectPath,
    type Bounds, type Mat, type Path, type Vec,
} from './geometry'
import { contrast, isGradient, over, sampleStops, toPaint, type ColorInput, type Paint, type Rgba } from './color'
import { clock, Track } from './track'
import { Node, type NodeProps, type PropName } from './node'
import { Block, nodeOrPoint, nodesFor, oneNode } from './layout'
import { matchSequence, pathMixer } from './morph'
import { Pictogram } from './objects/pictograms'
import type { Stage } from './stage'

export interface AnimContext {
    t0: number
    t1: number
    ease: Ease
    stage: Stage
}

/** A piece of motion. `schedule` writes timeline keys for a window of time. */
export interface Anim {
    label: string
    duration: number
    ease?: Ease
    schedule(ctx: AnimContext): void
}

export interface AnimOptions {
    duration?: number
    ease?: Ease
    /** Fraction of one item's time between the starts of consecutive items. */
    lag?: number
}

/** What an animation acts on: a node, a block of the layout, or a list of them. A block stands for its nodes. */
export type Target = Node | Block | readonly (Node | Block)[]

function list(target: Target, what = 'an animation'): Node[] {
    return nodesFor(what, target)
}

/** The middle of the bounds of nodes that are one target, as a stage point. */
function middleOf(nodes: readonly Node[]): Vec {
    const boxes = nodes.map((node) => node.bounds())
    const left = Math.min(...boxes.map((b) => b.x)), right = Math.max(...boxes.map((b) => b.x + b.width)), top = Math.min(...boxes.map((b) => b.y)), bottom = Math.max(...boxes.map((b) => b.y + b.height))
    return [(left + right) / 2, (top + bottom) / 2]
}

function run(anim: Anim, t0: number, t1: number, parent: AnimContext): void {
    clock.now = t0
    anim.schedule({ t0, t1, ease: anim.ease ?? parent.ease, stage: parent.stage })
}

// ── Composition ─────────────────────────────────────────────────────────────

/** Run together. Each piece keeps its own length unless the whole is rescaled. */
export function par(...anims: readonly Anim[]): Anim {
    const duration = Math.max(0, ...anims.map((a) => a.duration))
    return {
        label: 'par', duration,
        schedule(ctx) {
            const k = duration > 0 ? (ctx.t1 - ctx.t0) / duration : 1
            for (const anim of anims) run(anim, ctx.t0, ctx.t0 + anim.duration * k, ctx)
        },
    }
}

/** Run one after another. */
export function seq(...anims: readonly Anim[]): Anim {
    const duration = anims.reduce((sum, a) => sum + a.duration, 0)
    return {
        label: 'seq', duration,
        schedule(ctx) {
            const k = duration > 0 ? (ctx.t1 - ctx.t0) / duration : 1
            let t = ctx.t0
            for (const anim of anims) {
                const next = t + anim.duration * k
                run(anim, t, next, ctx)
                t = next
            }
        },
    }
}

/** Start each piece after a fraction of the previous one has played. */
export function lagged(anims: readonly Anim[], options: { lag?: number; duration?: number } = {}): Anim {
    const lag = options.lag ?? 0.15
    const longest = Math.max(0, ...anims.map((a) => a.duration))
    const natural = anims.length === 0 ? 0 : longest * (1 + (anims.length - 1) * lag)
    return {
        label: 'lagged', duration: options.duration ?? natural,
        schedule(ctx) {
            const total = ctx.t1 - ctx.t0
            const each = anims.length === 0 ? 0 : total / (1 + (anims.length - 1) * lag)
            anims.forEach((anim, i) => {
                const start = ctx.t0 + i * lag * each
                run(anim, start, start + each, ctx)
            })
        },
    }
}

export function delay(anim: Anim, seconds: number): Anim {
    return {
        label: anim.label, duration: anim.duration + seconds, ease: anim.ease,
        schedule(ctx) {
            const k = anim.duration + seconds > 0 ? (ctx.t1 - ctx.t0) / (anim.duration + seconds) : 1
            run(anim, ctx.t0 + seconds * k, ctx.t1, ctx)
        },
    }
}

/** Change an animation's length or easing without changing what it does. */
export function retime(anim: Anim, options: AnimOptions): Anim {
    return { ...anim, duration: options.duration ?? anim.duration, ease: options.ease ?? anim.ease }
}

/** Run a plain function at a moment on the timeline. */
export function call(fn: () => void): Anim {
    return { label: 'call', duration: 0, schedule: () => fn() }
}

// ── Stage presence ──────────────────────────────────────────────────────────

function ensureVisible(node: Node, t: number, stage: Stage): void {
    if (!node.mounted) {
        // A part of an off-stage group brings the whole group, so it keeps its
        // parent's transform instead of being pulled out of it.
        let top = node
        while (top.parent && top.parent !== stage.root) top = top.parent
        stage.mountAt(top, t)
    }
    for (let n: Node | null = node; n && n !== stage.root; n = n.parent) {
        const previous = clock.now
        clock.now = t
        const visible = n.get('visible')
        clock.now = previous
        if (!visible) n.track('visible').step(t, true)
    }
}

function hideAt(node: Node, t: number): void {
    node.track('visible').step(t, false)
}

/** Keep an item hidden from the start of a staggered reveal until its own turn. */
function holdUntil(node: Node, t0: number, start: number): void {
    if (start <= t0) return
    node.track('visible').step(t0, false)
    node.track('visible').step(start, true)
}

const stepAt = <K extends PropName>(node: Node, prop: K, value: NodeProps[K], t: number): void => {
    node.track(prop).step(t, value)
}

function valueAt<K extends PropName>(node: Node, prop: K, t: number): NodeProps[K] {
    const previous = clock.now
    clock.now = t
    const value = node.get(prop)
    clock.now = previous
    return value
}

function solid(paint: Paint): Rgba {
    return isGradient(paint) ? sampleStops(paint.stops, 0.5) : paint as Rgba
}

function drawable(target: Target): Node[] {
    return list(target).flatMap((node) => node.leaves().filter((leaf) => leaf.get('path')))
}

// ── Reveal and dismiss ──────────────────────────────────────────────────────

function drawLeaf(leaf: Node, t0: number, t1: number, ease: Ease, outline: number): void {
    const d = t1 - t0
    const fill = leaf.get('fill'), stroke = leaf.get('stroke')
    const fillTarget = leaf.get('fillOpacity')
    const strokeTarget = leaf.get('strokeOpacity')
    if (fill && !stroke) {
        // Filled shapes trace an outline first, and the fill soaks in behind it.
        const width = valueAt(leaf, 'strokeWidth', t0)
        stepAt(leaf, 'stroke', solid(fill), t0)
        stepAt(leaf, 'strokeWidth', outline, t0)
        stepAt(leaf, 'strokeOpacity', 1, t0)
        stepAt(leaf, 'trimTo', 0, t0)
        stepAt(leaf, 'fillOpacity', 0, t0)
        leaf.tween('trimTo', 1, t0, t0 + d * 0.72, ease)
        leaf.tween('fillOpacity', fillTarget, t0 + d * 0.42, t1, ease)
        leaf.tween('strokeOpacity', 0, t0 + d * 0.62, t1, ease)
        stepAt(leaf, 'stroke', null, t1)
        stepAt(leaf, 'strokeWidth', width, t1)
        stepAt(leaf, 'strokeOpacity', strokeTarget, t1)
        return
    }
    stepAt(leaf, 'trimTo', 0, t0)
    leaf.tween('trimTo', 1, t0, fill ? t0 + d * 0.8 : t1, ease)
    if (fill) {
        stepAt(leaf, 'fillOpacity', 0, t0)
        leaf.tween('fillOpacity', fillTarget, t0 + d * 0.5, t1, ease)
    }
}

function drawAnim(label: string, target: Target, options: AnimOptions, defaults: { lag: number; duration: number; outline: number }): Anim {
    const nodes = list(target)
    const count = drawable(nodes).length
    const lag = options.lag ?? defaults.lag
    const natural = options.duration ?? (count <= 1 ? defaults.duration : Math.min(defaults.duration * 2.4, defaults.duration + count * 0.035))
    return {
        label, duration: natural, ease: options.ease,
        schedule(ctx) {
            for (const node of nodes) ensureVisible(node, ctx.t0, ctx.stage)
            const leaves = drawable(nodes)
            if (leaves.length === 0) return
            const total = ctx.t1 - ctx.t0
            const each = total / (1 + (leaves.length - 1) * lag)
            leaves.forEach((leaf, i) => {
                const start = ctx.t0 + i * lag * each
                clock.now = start
                holdUntil(leaf, ctx.t0, start)
                drawLeaf(leaf, start, start + each, ctx.ease, defaults.outline)
            })
            clock.now = ctx.t0
        },
    }
}

/** Trace strokes in order. Filled shapes outline first, then fill. */
export function draw(target: Target, options: AnimOptions = {}): Anim {
    return drawAnim('draw', target, options, { lag: 0.04, duration: 1.3, outline: 2 })
}

/** Handwrite text and equations: each glyph is outlined, then filled. */
export function write(target: Target, options: AnimOptions = {}): Anim {
    return drawAnim('write', target, options, { lag: 0.22, duration: 1.1, outline: 1.3 })
}

/** The reverse of draw. */
export function erase(target: Target, options: AnimOptions = {}): Anim {
    const nodes = list(target)
    return {
        label: 'erase', duration: options.duration ?? 0.8, ease: options.ease,
        schedule(ctx) {
            const leaves = drawable(nodes)
            const lag = options.lag ?? 0.02
            const each = (ctx.t1 - ctx.t0) / (1 + Math.max(0, leaves.length - 1) * lag)
            leaves.forEach((leaf, i) => {
                const start = ctx.t0 + i * lag * each
                clock.now = start
                const fill = leaf.get('fill')
                if (leaf.get('stroke')) leaf.tween('trimFrom', 1, start, start + each, ctx.ease)
                if (fill) leaf.tween('fillOpacity', 0, start, start + each * 0.7, ctx.ease)
            })
            for (const node of nodes) hideAt(node, ctx.t1)
        },
    }
}

export interface FadeOptions extends AnimOptions {
    /** Start offset for fades in, or travel for fades out. */
    shift?: Vec
    /** Start scale for fades in, or end scale for fades out. */
    scale?: number
}

export function fadeIn(target: Target, options: FadeOptions = {}): Anim {
    const nodes = list(target)
    return {
        label: 'fadeIn', duration: options.duration ?? 0.8, ease: options.ease,
        schedule(ctx) {
            const items = options.lag !== undefined && nodes.length === 1 && nodes[0]!.children.length > 0 ? nodes[0]!.children : nodes
            for (const node of nodes) ensureVisible(node, ctx.t0, ctx.stage)
            const lag = options.lag ?? 0
            const each = (ctx.t1 - ctx.t0) / (1 + Math.max(0, items.length - 1) * lag)
            items.forEach((node, i) => {
                const start = ctx.t0 + i * lag * each, end = start + each
                clock.now = start
                holdUntil(node, ctx.t0, start)
                const opacity = node.get('opacity')
                stepAt(node, 'opacity', 0, start)
                node.tween('opacity', opacity, start, end, ctx.ease)
                if (options.shift) {
                    const x = node.get('x'), y = node.get('y')
                    stepAt(node, 'x', x + options.shift[0], start)
                    stepAt(node, 'y', y + options.shift[1], start)
                    node.tween('x', x, start, end, ctx.ease)
                    node.tween('y', y, start, end, ctx.ease)
                }
                if (options.scale !== undefined) scaleFrom(node, options.scale, start, end, ctx.ease)
            })
            clock.now = ctx.t0
        },
    }
}

function scaleFrom(node: Node, factor: number, t0: number, t1: number, ease: Ease, about?: Vec): void {
    const previous = clock.now
    clock.now = t0
    node.pivotAt(about ?? node.center)
    const sx = node.get('sx'), sy = node.get('sy')
    stepAt(node, 'sx', sx * factor, t0)
    stepAt(node, 'sy', sy * factor, t0)
    node.tween('sx', sx, t0, t1, ease)
    node.tween('sy', sy, t0, t1, ease)
    clock.now = previous
}

export function fadeOut(target: Target, options: FadeOptions = {}): Anim {
    const nodes = list(target)
    return {
        label: 'fadeOut', duration: options.duration ?? 0.6, ease: options.ease,
        schedule(ctx) {
            for (const node of nodes) {
                const opacity = node.get('opacity')
                node.tween('opacity', 0, ctx.t0, ctx.t1, ctx.ease)
                if (options.shift) {
                    node.tween('x', node.get('x') + options.shift[0], ctx.t0, ctx.t1, ctx.ease)
                    node.tween('y', node.get('y') + options.shift[1], ctx.t0, ctx.t1, ctx.ease)
                }
                if (options.scale !== undefined) {
                    node.pivotAt(node.center)
                    node.tween('sx', node.get('sx') * options.scale, ctx.t0, ctx.t1, ctx.ease)
                    node.tween('sy', node.get('sy') * options.scale, ctx.t0, ctx.t1, ctx.ease)
                }
                hideAt(node, ctx.t1)
                stepAt(node, 'opacity', opacity, ctx.t1)
            }
        },
    }
}

/** Scale up from nothing. Pass a stage point to grow from it, such as an arrow's tail. */
export function grow(target: Target, options: AnimOptions & { from?: Vec } = {}): Anim {
    const nodes = list(target)
    return {
        label: 'grow', duration: options.duration ?? 0.9, ease: options.ease,
        schedule(ctx) {
            for (const node of nodes) {
                ensureVisible(node, ctx.t0, ctx.stage)
                scaleFrom(node, 0.001, ctx.t0, ctx.t1, ctx.ease, options.from)
            }
        },
    }
}

/** Show at this moment, with no transition. */
export function appear(target: Target): Anim {
    const nodes = list(target)
    return { label: 'appear', duration: 0, schedule: (ctx) => { for (const node of nodes) ensureVisible(node, ctx.t0, ctx.stage) } }
}

/** Hide at this moment, with no transition. */
export function vanish(target: Target): Anim {
    const nodes = list(target)
    return { label: 'vanish', duration: 0, schedule: (ctx) => { for (const node of nodes) hideAt(node, ctx.t0) } }
}

// ── Change ──────────────────────────────────────────────────────────────────

/**
 * Animate any change. Make the change on the node inside the callback, and the
 * engine interpolates from the old state to the new one, including geometry.
 *
 *   s.play(to(dot, (d) => d.moveTo(axes.p(2, 4)).color('yellow').scale(1.5)))
 */
export function to<T extends Node | Block>(node: T, change: (node: T) => unknown, options: AnimOptions & { restore?: boolean } = {}): Anim {
    // A block of the layout is its nodes: `to(block, () => place(block, region))` moves each one.
    const nodes = nodesFor('to', node, 'the first argument')
    if (typeof change !== 'function') throw new Error('to: the second argument is the change, a function such as (node) => node.shift(100, 0)')
    return {
        label: 'to', duration: options.duration ?? 1, ease: options.ease,
        schedule(ctx) {
            for (const each of nodes) ensureVisible(each, ctx.t0, ctx.stage)
            const touched = new Set<{ overlay: Map<string, unknown> | null }>()
            clock.capture = touched
            try {
                change(node)
            } finally {
                clock.capture = null
            }
            for (const entry of touched) {
                const target = entry as Node
                const values = new Map(target.overlay!)
                target.overlay!.clear()
                applyChanges(target, values, ctx, options.restore === true)
            }
        },
    }
}

function applyChanges(node: Node, values: Map<string, unknown>, ctx: AnimContext, restore: boolean): void {
    const { t0, t1, ease } = ctx
    const props = values as Map<PropName, NodeProps[PropName]>
    const restoreValues = new Map<PropName, NodeProps[PropName]>()
    // A changed pivot moves first with no visible effect. Then the pivot point
    // travels in a straight line while rotation and scale happen around it.
    const px = props.get('px') as number | undefined, py = props.get('py') as number | undefined
    // The place of the node at the start, when the change moves its pivot: the place of the new pivot.
    let start: { x: number; y: number } | null = null
    if (px !== undefined || py !== undefined) {
        const nextPx = px ?? node.get('px'), nextPy = py ?? node.get('py')
        const m: Mat = compose(node.get('x'), node.get('y'), node.get('rotation'), node.get('sx'), node.get('sy'), node.get('px'), node.get('py'))
        const [startX, startY] = apply(m, nextPx, nextPy)
        stepAt(node, 'px', nextPx, t0)
        stepAt(node, 'py', nextPy, t0)
        // The place of the new pivot keeps the node where it is. It does not take the place of a motion of the same play.
        node.track('x').stepUnder(t0, startX)
        node.track('y').stepUnder(t0, startY)
        start = { x: startX, y: startY }
        props.delete('px')
        props.delete('py')
    }
    clock.now = t0
    for (const [prop, value] of props) {
        // With a new pivot, the node starts at the place of that pivot, and the change gives the same place when
        // it does not move the node. The track cannot give that start: a motion of the same play, such as `along`,
        // may be in effect at this time, and a motion from here to here would take its place.
        const place = start && (prop === 'x' || prop === 'y') ? start[prop] : null
        const from = place ?? node.get(prop)
        if (from === value || (place !== null && Math.abs(place - (value as number)) < 1e-9)) continue
        if (restore) restoreValues.set(prop, from)
        node.tween(prop, value, t0, t1, ease)
    }
    for (const [prop, value] of restoreValues) stepAt(node, prop, value, t1)
}

/** A change of each node of a target, as one animation. A block of the layout stands for its nodes. */
function toEach(what: string, target: Node | Block, change: (node: Node, all: readonly Node[]) => unknown, options: AnimOptions): Anim {
    const nodes = nodesFor(what, target, 'the first argument')
    return { ...to(target, () => { for (const node of nodes) change(node, nodes) }, options), label: what === 'scaleBy' ? 'scale' : what }
}

/** Move a node so that its middle is on a stage point, or on the middle of another node. A block moves as one. */
export function moveTo(node: Node | Block, target: Vec | Node | Block, options: AnimOptions = {}): Anim {
    const nodes = nodesFor('moveTo', node, 'the first argument')
    if (!(target instanceof Block)) nodeOrPoint('moveTo', target, 'the place')
    if (node instanceof Node && !(target instanceof Block)) return { ...to(node, (n) => n.moveTo(target), options), label: 'moveTo' }
    return {
        ...to(node, () => {
            // One distance for all the nodes, so that a block keeps its shape.
            const [x, y] = target instanceof Block ? middleOf(target.nodes) : target instanceof Node ? target.center : target
            const [cx, cy] = middleOf(nodes)
            for (const each of nodes) each.moveTo([each.center[0] + x - cx, each.center[1] + y - cy])
        }, options),
        label: 'moveTo',
    }
}

export function shift(node: Node | Block, dx: number, dy: number, options: AnimOptions = {}): Anim {
    return toEach('shift', node, (n) => n.shift(dx, dy), options)
}

/** Scale a node about its middle, or about a stage point. A block scales as one, about its middle. */
export function scaleBy(node: Node | Block, factor: number | Vec, options: AnimOptions & { about?: Vec } = {}): Anim {
    let about: Vec | undefined
    return toEach('scaleBy', node, (n, all) => {
        if (n === all[0]) about = options.about ?? (all.length > 1 ? middleOf(all) : undefined)
        n.scale(factor, about)
    }, options)
}

/** Turn a node about its middle, or about a stage point. A block turns as one, about its middle. */
export function rotate(node: Node | Block, radians: number, options: AnimOptions & { about?: Vec } = {}): Anim {
    let about: Vec | undefined
    return toEach('rotate', node, (n, all) => {
        if (n === all[0]) about = options.about ?? (all.length > 1 ? middleOf(all) : undefined)
        n.rotate(radians, about)
    }, options)
}

export function recolor(node: Node | Block, color: ColorInput, options: AnimOptions = {}): Anim {
    return toEach('recolor', node, (n) => n.color(color), options)
}

export function fade(node: Node | Block, opacity: number, options: AnimOptions = {}): Anim {
    return toEach('fade', node, (n) => n.opacity(opacity), { duration: 0.6, ...options })
}

/** Follow a path, or the shape of a node, from start to end. */
export function along(node: Node, track: Path | Node, options: AnimOptions & { orient?: boolean } = {}): Anim {
    oneNode('along', node, 'the first argument')
    if (track instanceof Block) oneNode('along', track, 'the track')
    return {
        label: 'along', duration: options.duration ?? 2, ease: options.ease,
        schedule(ctx) {
            ensureVisible(node, ctx.t0, ctx.stage)
            const path = track instanceof Node
                ? transformPath(track.get('path') ?? [], track.worldMatrix())
                : track
            const inverse = node.parent ? invertSafe(node.parent.worldMatrix()) : null
            const position = (alpha: number): [number, number] => {
                const [x, y] = pointAt(path, alpha)
                return inverse ? apply(inverse, x, y) : [x, y]
            }
            const [endX, endY] = position(1)
            node.track('x').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: endX, at: (a) => position(a)[0] })
            node.track('y').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: endY, at: (a) => position(a)[1] })
            if (options.orient) {
                const angle = (alpha: number) => {
                    const [dx, dy] = tangentAt(path, alpha)
                    return Math.atan2(dy, dx)
                }
                node.track('rotation').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: angle(1), at: angle })
            }
        },
    }
}

function invertSafe(m: Mat): Mat {
    const det = m[0] * m[3] - m[1] * m[2]
    if (Math.abs(det) < 1e-12) return [1, 0, 0, 1, 0, 0]
    const i = 1 / det
    return [m[3] * i, -m[1] * i, -m[2] * i, m[0] * i, (m[2] * m[5] - m[3] * m[4]) * i, (m[1] * m[4] - m[0] * m[5]) * i]
}

/**
 * Deform every shape under a node through a function of stage position.
 * This is how a grid bends under a matrix or a complex map.
 */
export function warp(target: Target, f: (x: number, y: number) => Vec, options: AnimOptions & { subdivisions?: number } = {}): Anim {
    const nodes = list(target)
    return {
        label: 'warp', duration: options.duration ?? 2, ease: options.ease,
        schedule(ctx) {
            for (const leaf of drawable(nodes)) {
                ensureVisible(leaf, ctx.t0, ctx.stage)
                const path = leaf.get('path')!
                const world = leaf.worldMatrix()
                const inverse = invertSafe(world)
                // Both ends share one structure, and every point travels straight to its image.
                // General morph matching could flip or rotate rings and distort the motion.
                const start = path.map((r) => subdivideEach(r, options.subdivisions ?? 6))
                const end = warpPath(start, (x, y) => {
                    const [wx, wy] = apply(world, x, y)
                    const [mx, my] = f(wx, wy)
                    return apply(inverse, mx, my)
                }, 1)
                leaf.track('path').add({
                    t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: end,
                    at: (alpha) => start.map((r, i) => {
                        const a = r.p, b = end[i]!.p
                        const out = new Float64Array(a.length)
                        for (let k = 0; k < a.length; k++) out[k] = a[k]! + (b[k]! - a[k]!) * alpha
                        return { p: out, closed: r.closed }
                    }),
                })
            }
        },
    }
}

/** Multiply a node's geometry by a 2x2 matrix around a stage point. */
export function applyMatrix(target: Target, matrix: readonly [readonly [number, number], readonly [number, number]], options: AnimOptions & { origin?: Vec; yUp?: boolean } = {}): Anim {
    const [ox, oy] = options.origin ?? [0, 0]
    const flip = options.yUp === false ? 1 : -1
    const [[a, b], [c, d]] = matrix
    return {
        ...warp(target, (x, y) => {
            const ux = x - ox, uy = (y - oy) * flip
            const vx = a * ux + b * uy, vy = c * ux + d * uy
            return [ox + vx, oy + vy * flip]
        }, { subdivisions: 1, ...options }),
        label: 'applyMatrix',
    }
}

// ── Morphing ────────────────────────────────────────────────────────────────

interface Baked {
    path: Path
    fill: Paint | null
    fillOpacity: number
    stroke: Paint | null
    strokeOpacity: number
    strokeWidth: number
    glow: number
    glowColor: Rgba | null
    cap: NodeProps['cap']
    dash: NodeProps['dash']
    z: number
    fixed: boolean
    key: unknown
}

function chainOpacity(node: Node): number {
    let value = 1
    for (let n: Node | null = node; n; n = n.parent) value *= n.get('opacity')
    return value
}

function bake(leaf: Node): Baked {
    const m = leaf.worldMatrix()
    const opacity = chainOpacity(leaf)
    let z = 0
    let fixed = false
    for (let n: Node | null = leaf; n; n = n.parent) {
        z += n.get('z')
        fixed ||= n.get('fixed')
    }
    return {
        path: transformPath(leaf.get('path') ?? [], m),
        fill: leaf.get('fill'),
        fillOpacity: leaf.get('fill') ? leaf.get('fillOpacity') * opacity : 0,
        stroke: leaf.get('stroke'),
        strokeOpacity: leaf.get('stroke') ? leaf.get('strokeOpacity') * opacity : 0,
        strokeWidth: leaf.get('strokeWidth') * matScale(m),
        glow: leaf.get('glow'),
        glowColor: leaf.get('glowColor'),
        cap: leaf.get('cap'),
        dash: leaf.get('dash'),
        z,
        fixed,
        key: leaf.data['key'],
    }
}

/** A temporary shape that exists only while a morph plays. */
function ghost(stage: Stage, from: Baked, to: Baked, ctx: { t0: number; t1: number; ease: Ease; appear?: number; hide?: number }): Node {
    const node = new Node()
    // A ghost is on its way from one picture to the next, and it can be a letter. The film check does not take it as a mark beside a text.
    node.data['decoration'] = true
    node.base.visible = false
    node.base.path = from.path
    node.base.cap = from.cap
    node.base.z = from.z
    node.base.fixed = from.fixed
    node.base.fill = from.fill ?? to.fill
    node.base.stroke = from.stroke ?? to.stroke
    node.base.fillOpacity = from.fillOpacity
    node.base.strokeOpacity = from.strokeOpacity
    node.base.strokeWidth = from.strokeWidth || to.strokeWidth
    node.base.glow = from.glow
    node.base.glowColor = from.glowColor ?? to.glowColor
    stage.root.add(node)
    node.track('visible').initial = false
    node.track('visible').keys.length = 0
    stepAt(node, 'visible', true, ctx.appear ?? ctx.t0)
    node.track('path').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: to.path, at: pathMixer(from.path, to.path) })
    if (from.fill && to.fill) node.tween('fill', to.fill, ctx.t0, ctx.t1, ctx.ease)
    if (from.stroke && to.stroke) node.tween('stroke', to.stroke, ctx.t0, ctx.t1, ctx.ease)
    node.tween('fillOpacity', to.fillOpacity, ctx.t0, ctx.t1, ctx.ease)
    node.tween('strokeOpacity', to.strokeOpacity, ctx.t0, ctx.t1, ctx.ease)
    node.tween('strokeWidth', to.strokeWidth || from.strokeWidth, ctx.t0, ctx.t1, ctx.ease)
    if (from.glow !== to.glow) node.tween('glow', to.glow, ctx.t0, ctx.t1, ctx.ease)
    stepAt(node, 'visible', false, ctx.hide ?? ctx.t1)
    return node
}

function pairCounts<T>(from: readonly T[], to: readonly T[]): [T, T][] {
    const count = Math.max(from.length, to.length)
    const pairs: [T, T][] = []
    for (let i = 0; i < count; i++) {
        pairs.push([
            from[Math.min(from.length - 1, Math.floor(i * from.length / count))]!,
            to[Math.min(to.length - 1, Math.floor(i * to.length / count))]!,
        ])
    }
    return pairs
}

/**
 * Turn `from` into `to`, whatever their shapes. Afterwards `to` is on stage and
 * `from` is hidden, so later code always refers to the node it can see.
 */
export function morph(from: Target, to: Target, options: AnimOptions & { lag?: number } = {}): Anim {
    const a = list(from), b = list(to)
    return {
        label: 'morph', duration: options.duration ?? 1.2, ease: options.ease,
        schedule(ctx) {
            prepareTargets(b, ctx)
            const fromLeaves = drawable(a).map(bake)
            const toLeaves = drawable(b).map(bake)
            if (fromLeaves.length === 0 || toLeaves.length === 0) {
                for (const node of a) hideAt(node, ctx.t0)
                for (const node of b) ensureVisible(node, ctx.t0, ctx.stage)
                return
            }
            const pairs = pairCounts(fromLeaves, toLeaves)
            const lag = options.lag ?? 0
            const each = (ctx.t1 - ctx.t0) / (1 + Math.max(0, pairs.length - 1) * lag)
            const ghosts = pairs.map(([x, y], i) => {
                const start = ctx.t0 + i * lag * each
                // A piece that finishes early stays until the target appears at the end.
                return ghost(ctx.stage, x, y, { t0: start, t1: start + each, ease: ctx.ease, appear: ctx.t0, hide: ctx.t1 })
            })
            finishMorph(a, b, ghosts, ctx)
        },
    }
}

function prepareTargets(targets: readonly Node[], ctx: AnimContext): void {
    clock.now = ctx.t0
    for (const node of targets) {
        ctx.stage.mountAt(node, ctx.t0)
        hideAt(node, ctx.t0)
    }
}

function finishMorph(a: readonly Node[], b: readonly Node[], ghosts: readonly Node[], ctx: AnimContext): void {
    for (const node of a) hideAt(node, ctx.t0)
    for (const node of b) node.track('visible').step(ctx.t1, true)
    // For the lights of the film, which must not dim a node while it changes its shape.
    ctx.stage.morphs.push({ start: ctx.t0, end: ctx.t1, from: a, to: b, ghosts })
    clock.now = ctx.t0
}

/**
 * Morph equations and labels by meaning. Glyphs that exist on both sides travel
 * to their new places. The rest fade out or in where they stand.
 */
export function morphMatching(from: Node, to: Node, options: AnimOptions & { key?: (leaf: Node) => unknown; fadeShift?: Vec } = {}): Anim {
    oneNode('morphMatching', from, 'the first argument')
    oneNode('morphMatching', to, 'the second argument')
    return {
        label: 'morphMatching', duration: options.duration ?? 1.4, ease: options.ease,
        schedule(ctx) {
            prepareTargets([to], ctx)
            const keyOf = options.key ?? ((leaf: Node) => leaf.data['key'])
            const fromLeaves = drawable(from), toLeaves = drawable(to)
            const fromBaked = fromLeaves.map(bake), toBaked = toLeaves.map(bake)
            const pairs = matchSequence(fromLeaves.map(keyOf), toLeaves.map(keyOf))
            const usedFrom = new Set(pairs.map(([i]) => i)), usedTo = new Set(pairs.map(([, j]) => j))
            const ghosts = pairs.map(([i, j]) => ghost(ctx.stage, fromBaked[i]!, toBaked[j]!, ctx))
            const span = ctx.t1 - ctx.t0
            const offset = options.fadeShift ?? [0, 0]
            const shifted = (bakedPath: Path, dx: number, dy: number) => transformPath(bakedPath, [1, 0, 0, 1, dx, dy])
            fromBaked.forEach((baked, i) => {
                if (usedFrom.has(i)) return
                ghosts.push(ghost(ctx.stage, baked, {
                    ...baked, path: shifted(baked.path, offset[0], offset[1]), fillOpacity: 0, strokeOpacity: 0,
                }, { t0: ctx.t0, t1: ctx.t0 + span * 0.55, ease: ctx.ease }))
            })
            toBaked.forEach((baked, j) => {
                if (usedTo.has(j)) return
                ghosts.push(ghost(ctx.stage, {
                    ...baked, path: shifted(baked.path, -offset[0], -offset[1]), fillOpacity: 0, strokeOpacity: 0,
                }, baked, { t0: ctx.t0 + span * 0.35, t1: ctx.t1, ease: ctx.ease }))
            })
            finishMorph([from], [to], ghosts, ctx)
        },
    }
}

// ── Emphasis ────────────────────────────────────────────────────────────────

/**
 * Swell and tint for a moment, then return.
 *
 * A fill that another part of the target is drawn on is a backing: the disc of a numbered ring, the panel of
 * a box, a solid badge under its number. A backing and what is on it never take the tint together, because
 * one color for both hides the content: the tint goes to the one of the two that leaves more contrast between
 * them. On a dark panel, the border and the text light up. On a light panel, the panel lights up under its
 * dark text. So pass a shape together with what is on it, as one group or a list.
 *
 * A part is on a fill when it is drawn after the fill, it is smaller, and its middle is inside the shape of
 * the fill. A text, a formula and a pictogram are one part each. An object with a `color()` of its own, such
 * as a tag, gets that call. A shape with nothing on it takes the tint in full. The choice is made when the
 * animation starts, from what shows then. `fill: true` is `node.color(color)` with no choice.
 */
export function indicate(target: Target, options: AnimOptions & { color?: ColorInput; scale?: number; fill?: boolean } = {}): Anim {
    const nodes = list(target, 'indicate')
    const color = options.color ?? 'yellow'
    return {
        label: 'indicate', duration: options.duration ?? 0.9,
        schedule(ctx) {
            let tint: (node: Node) => void = (node) => { node.color(color) }
            if (!options.fill) {
                // The choice is for this moment: a part can move onto a fill, change its color, or arrive, before the animation starts.
                for (const node of nodes) ensureVisible(node, ctx.t0, ctx.stage)
                clock.now = ctx.t0
                const plan = tintPlan(nodes, color, ctx.stage)
                tint = (node) => applyTint(node, plan)
            }
            const anims = nodes.map((node) => retime(to(node, (n) => {
                n.scale(options.scale ?? 1.14)
                tint(n)
            }, { restore: true }), { ease: options.ease ?? thereAndBack }))
            par(...anims).schedule(ctx)
        },
    }
}

/** A pair with less contrast than this is hard to read, also in large text. */
const READABLE = 3
/** A part is on a fill when its box is smaller than the box of the fill by this much. A part of the size of the fill is its border, or its twin. */
const SMALLER = 0.9

/**
 * One thing that `indicate` tints as a whole or leaves as a whole. A shape is one outline. A text, a formula,
 * a pictogram, and a drawing that a function makes again on each frame are one part each: none of their
 * marks is the backing of another. An object with a `color()` of its own is one part too.
 */
interface TintPart {
    node: Node
    kind: 'shape' | 'whole' | 'object'
    /** Its place in the draw order of the stage. */
    order: number
    bounds: Bounds
    /** The colors that a viewer sees of each mark of the part: its line, its fill, or both. */
    colors: Rgba[][]
    /** For a shape with a fill, which can be a backing: the color that a viewer sees, and its opacity. */
    fill: { color: Rgba; alpha: number } | null
    /** False for a drawing that takes its colors from a function: a tint cannot reach it. */
    tints: boolean
}

/** What `indicate` does at one start: the paint, the parts, the fills that keep their color, and the parts that keep all their colors. */
interface TintPlan {
    color: ColorInput
    paint: Paint
    parts: Map<Node, TintPart>
    keepFill: Set<Node>
    keepPart: Set<Node>
}

const isText = (node: Node): boolean => typeof (node as { source?: unknown }).source === 'string' && (Array.isArray((node as { chars?: unknown }).chars) || Array.isArray((node as { glyphs?: unknown }).glyphs))

/** The place of each node of the stage in the order of drawing, as the renderer walks the tree: a node, then its children by `z`. */
function drawOrder(root: Node): Map<Node, number> {
    const order = new Map<Node, number>()
    const walk = (node: Node): void => {
        order.set(node, order.size)
        const children = node.children
        if (children.length === 0) return
        const sorted = children.some((child) => child.get('z') !== 0)
            ? children.map((child, index) => ({ child, index, z: child.get('z') })).sort((a, b) => a.z - b.z || a.index - b.index).map((entry) => entry.child)
            : children
        for (const child of sorted) walk(child)
    }
    walk(root)
    return order
}

/** The opacity that a node has for a viewer now: 0 when it or a group that holds it is hidden. */
function shownOpacity(node: Node): number {
    let opacity = 1
    for (let up: Node | null = node; up; up = up.parent) {
        if (!up.get('visible')) return 0
        opacity *= up.get('opacity')
    }
    return opacity
}

/**
 * Decide what a tint leaves alone, from the parts as they are now. Each part that shows has at most one
 * backing: the last fill drawn before it whose shape holds the middle of the part. For each backing, the
 * tint goes to its content or to its fill, by the contrast that each choice leaves between the two.
 */
function tintPlan(targets: readonly Node[], color: ColorInput, stage: Stage): TintPlan {
    const paint = toPaint(color)
    const plan: TintPlan = { color, paint, parts: new Map(), keepFill: new Set(), keepPart: new Set() }
    const order = drawOrder(stage.root)
    const backdrop = stage.backdrop
    // The color that a viewer sees of a paint: a gradient by its middle, and a paint that is not opaque over the background of the film.
    const seen = (value: Paint, alpha: number): Rgba => over(isGradient(value) ? sampleStops(value.stops, 0.5) : value as Rgba, alpha, backdrop)
    const marks = (node: Node, opacity: number): Rgba[] => {
        const stroke = node.get('stroke'), fill = node.get('fill')
        return [...(stroke ? [seen(stroke, node.get('strokeOpacity') * opacity)] : []), ...(fill ? [seen(fill, node.get('fillOpacity') * opacity)] : [])]
    }
    const add = (node: Node, kind: TintPart['kind']): void => {
        const opacity = shownOpacity(node)
        // A part that does not show is no content and no backing. It still takes the tint, as each paint did before.
        const part: TintPart = { node, kind, order: opacity > 0.002 ? order.get(node) ?? Infinity : -1, bounds: { x: 0, y: 0, width: 0, height: 0 }, colors: [], fill: null, tints: true }
        plan.parts.set(node, part)
        if (part.order < 0) return
        if (kind === 'shape') {
            const path = node.get('path'), fill = node.get('fill')
            part.bounds = (path && pathBounds(transformPath(path, node.worldMatrix()))) ?? node.bounds()
            part.colors = [marks(node, opacity)]
            // A glyph is a mark of its text, so it is not the backing of the next glyph.
            if (path && fill && node.data['key'] === undefined) part.fill = { color: seen(fill, node.get('fillOpacity') * opacity), alpha: node.get('fillOpacity') * opacity }
            return
        }
        part.bounds = node.bounds()
        // A drawing that a function makes again on each frame has the colors of what the function returns now.
        const built = node.draw ? node.draw(clock.now) : null
        const drawn = node.draw ? (built ? (Array.isArray(built) ? built as readonly Node[] : [built as Node]) : []) : [node]
        part.tints = !node.draw
        const leaves = drawn.flatMap((each) => each.all()).filter((each) => each.get('visible') && (each.get('stroke') || each.get('fill')))
        // An object with a color of its own is seen by its body, the first mark that it draws.
        part.colors = (kind === 'object' ? leaves.slice(0, 1) : leaves).map((each) => marks(each, opacity)).filter((list) => list.length > 0)
    }
    const visited = new Set<Node>()
    const visit = (node: Node): void => {
        if (visited.has(node)) return
        visited.add(node)
        if (node.color !== Node.prototype.color) return add(node, 'object')
        if (isText(node) || node instanceof Pictogram || node.draw || node.rawOps) return add(node, 'whole')
        if (node.get('stroke') || node.get('fill')) add(node, 'shape')
        for (const child of node.children) visit(child)
    }
    for (const target of targets) visit(target)

    // The backing of each part: the fills that are drawn before it are in a grid of cells, so a part looks at the
    // fills of one cell and not at every fill.
    const shown = [...plan.parts.values()].filter((part) => part.order >= 0 && (part.bounds.width > 0 || part.bounds.height > 0)).sort((a, b) => a.order - b.order)
    const fills = shown.filter((part) => part.fill)
    const cell = Math.max(8, fills.reduce((sum, part) => sum + Math.max(part.bounds.width, part.bounds.height), 0) / Math.max(1, fills.length))
    const cells = new Map<number, TintPart[]>(), wide: TintPart[] = []
    const key = (ix: number, iy: number): number => ix * 1048576 + iy
    const paths = new Map<TintPart, Path>()
    const holds = (fill: TintPart, x: number, y: number): boolean => {
        const b = fill.bounds
        if (x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) return false
        let path = paths.get(fill)
        if (!path) paths.set(fill, path = transformPath(fill.node.get('path')!, fill.node.worldMatrix()))
        return encloses(path, x, y)
    }
    const contents = new Map<TintPart, TintPart[]>()
    for (const part of shown) {
        const x = part.bounds.x + part.bounds.width / 2, y = part.bounds.y + part.bounds.height / 2, area = part.bounds.width * part.bounds.height
        let backing: TintPart | null = null
        for (const fill of [...(cells.get(key(Math.floor(x / cell), Math.floor(y / cell))) ?? []), ...wide]) {
            if ((!backing || fill.order > backing.order) && area < fill.bounds.width * fill.bounds.height * SMALLER && holds(fill, x, y)) backing = fill
        }
        if (backing) {
            const on = contents.get(backing)
            if (on) on.push(part)
            else contents.set(backing, [part])
        }
        if (!part.fill) continue
        const b = part.bounds
        const x0 = Math.floor(b.x / cell), x1 = Math.floor((b.x + b.width) / cell), y0 = Math.floor(b.y / cell), y1 = Math.floor((b.y + b.height) / cell)
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 1024) { wide.push(part); continue }
        for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
            const list = cells.get(key(ix, iy))
            if (list) list.push(part)
            else cells.set(key(ix, iy), [part])
        }
    }

    // A part is seen by its line or by its fill: the one with more contrast counts. A part of many marks, such as a
    // text of two colors, is as readable as its least readable mark.
    const contrastOf = (part: TintPart, against: Rgba): number => Math.min(Infinity, ...part.colors.map((list) => Math.max(...list.map((each) => contrast(each, against)))))
    const tintColor = seen(paint, 1)
    for (const [backing, on] of contents) {
        const fill = backing.fill!
        const tinted = seen(paint, fill.alpha)
        // The tint on the content: the fill keeps its color. A drawing that the tint cannot reach stays as it is.
        const onContent = Math.min(...on.map((part) => (part.tints ? contrast(tintColor, fill.color) : contrastOf(part, fill.color))))
        // The tint on the fill: the content keeps its colors.
        const onBacking = Math.min(...on.map((part) => contrastOf(part, tinted)))
        const asItIs = Math.min(...on.map((part) => contrastOf(part, fill.color)))
        const best = Math.max(onContent, onBacking)
        if (best < READABLE && asItIs > best) {
            // No tint keeps this pair readable, such as a light number on a light badge: both keep their colors.
            plan.keepFill.add(backing.node)
            for (const part of on) plan.keepPart.add(part.node)
        } else if (onBacking > onContent && !(onContent >= READABLE && fill.alpha < 1)) {
            for (const part of on) plan.keepPart.add(part.node)
        } else {
            // Also for a wash, a fill that is not opaque, when the tint is readable on it: a wash hardly shows a tint.
            plan.keepFill.add(backing.node)
        }
    }
    return plan
}

/** Give the tint to a target and its parts, but for what the plan keeps. */
function applyTint(target: Node, plan: TintPlan): void {
    const paint = plan.paint
    // A paint that is not opaque keeps its alpha: a wash stays a wash.
    const like = (old: Paint): Paint => (!isGradient(paint) && !isGradient(old) && (old as Rgba)[3] < 1 ? [(paint as Rgba)[0], (paint as Rgba)[1], (paint as Rgba)[2], (old as Rgba)[3]] : paint)
    const tintNode = (node: Node, withFill: boolean): void => {
        const stroke = node.get('stroke'), fill = node.get('fill')
        if (stroke) node.set('stroke', like(stroke))
        if (fill && withFill) node.set('fill', like(fill))
        if (node.get('glowColor') && !isGradient(paint)) node.set('glowColor', paint as Rgba)
    }
    const visit = (node: Node): void => {
        const part = plan.parts.get(node)
        if (part) {
            if (!plan.keepPart.has(node)) {
                if (part.kind === 'object') node.color(plan.color)
                else if (part.kind === 'shape') tintNode(node, !plan.keepFill.has(node))
                else for (const each of node.all()) tintNode(each, true)
            }
            if (part.kind !== 'shape') return
        } else if (node.get('glowColor') && !isGradient(paint)) {
            // A group can have a glow of its own, with no line and no fill.
            node.set('glowColor', paint as Rgba)
        }
        for (const child of node.children) visit(child)
    }
    visit(target)
}

/** Shake gently to draw the eye. */
export function shake(node: Node, options: AnimOptions & { angle?: number; cycles?: number } = {}): Anim {
    oneNode('shake', node, 'the first argument')
    return {
        label: 'shake', duration: options.duration ?? 0.8,
        ease: wiggleEase(options.cycles ?? 3),
        schedule(ctx) {
            clock.now = ctx.t0
            const [cx, cy] = node.center
            node.pivotAt([cx, cy])
            const rotation = node.get('rotation')
            const angle = options.angle ?? 0.08
            const track = node.track('rotation')
            track.add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: rotation, at: (alpha) => rotation + angle * alpha })
        },
    }
}

/** Trace a line around a node for emphasis, then let it run off. */
export function circumscribe(target: Node, options: AnimOptions & { color?: ColorInput; pad?: number; radius?: number; width?: number } = {}): Anim {
    oneNode('circumscribe', target, 'the first argument')
    return {
        label: 'circumscribe', duration: options.duration ?? 1.3, ease: options.ease ?? linear,
        schedule(ctx) {
            const b = target.bounds()
            const pad = options.pad ?? 14
            const outline = new Node(rectPath(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2, options.radius ?? 12))
                .stroke(options.color ?? 'yellow', options.width ?? 3)
                .glow(8)
            // A film puts this line around a text on purpose, so the film check does not judge the text against it.
            outline.data['decoration'] = true
            ctx.stage.add(outline)
            ctx.stage.marks.set(outline, target)
            const t0 = ctx.t0, t1 = ctx.t1, mid = t0 + (t1 - t0) * 0.55
            stepAt(outline, 'trimTo', 0, t0)
            outline.tween('trimTo', 1, t0, mid, smooth)
            outline.tween('trimFrom', 1, mid - (t1 - t0) * 0.08, t1, smooth)
            hideAt(outline, t1)
        },
    }
}

/**
 * Tell the lights of the film what a mark of a verb is for. A mark for a node is as bright as that node. A
 * mark at a point belongs to no node: it arrives now, with its own look.
 */
function markOf(ctx: AnimContext, mark: Node, target: Vec | Node): void {
    if (target instanceof Node) ctx.stage.marks.set(mark, target)
    else ctx.stage.arrivals.set(mark, ctx.t0)
}

/** Radial burst at a point, for a moment of arrival. */
export function flash(point: Vec | Node, options: AnimOptions & { color?: ColorInput; radius?: number; rays?: number } = {}): Anim {
    nodeOrPoint('flash', point, 'the first argument')
    return {
        label: 'flash', duration: options.duration ?? 0.7, ease: options.ease ?? smooth,
        schedule(ctx) {
            const center: Vec = point instanceof Node ? point.center : point
            const radius = options.radius ?? 54
            const rays = options.rays ?? 12
            for (let i = 0; i < rays; i++) {
                const angle = (i / rays) * Math.PI * 2
                const cos = Math.cos(angle), sin = Math.sin(angle)
                const ray = new Node(linePath([center[0] + cos * radius * 0.35, center[1] + sin * radius * 0.35], [center[0] + cos * radius, center[1] + sin * radius]))
                    .stroke(options.color ?? 'yellow', 2.5)
                    .glow(5)
                ctx.stage.add(ray)
                markOf(ctx, ray, point)
                stepAt(ray, 'trimTo', 0, ctx.t0)
                ray.tween('trimTo', 1, ctx.t0, ctx.t0 + (ctx.t1 - ctx.t0) * 0.6, ctx.ease)
                ray.tween('trimFrom', 1, ctx.t0 + (ctx.t1 - ctx.t0) * 0.25, ctx.t1, ctx.ease)
                hideAt(ray, ctx.t1)
            }
        },
    }
}

/** Expanding ring that fades out, for a pulse from a point. */
export function ripple(point: Vec | Node, options: AnimOptions & { color?: ColorInput; radius?: number; width?: number } = {}): Anim {
    nodeOrPoint('ripple', point, 'the first argument')
    return {
        label: 'ripple', duration: options.duration ?? 1, ease: options.ease ?? smooth,
        schedule(ctx) {
            const center: Vec = point instanceof Node ? point.center : point
            const ring = new Node(circlePath(0, 0, options.radius ?? 90)).stroke(options.color ?? 'blue', options.width ?? 3).at(center)
            ctx.stage.add(ring)
            markOf(ctx, ring, point)
            stepAt(ring, 'sx', 0.05, ctx.t0)
            stepAt(ring, 'sy', 0.05, ctx.t0)
            ring.tween('sx', 1, ctx.t0, ctx.t1, ctx.ease)
            ring.tween('sy', 1, ctx.t0, ctx.t1, ctx.ease)
            ring.tween('strokeOpacity', 0, ctx.t0 + (ctx.t1 - ctx.t0) * 0.2, ctx.t1, ctx.ease)
            hideAt(ring, ctx.t1)
        },
    }
}

/**
 * A short lit segment that travels along a line: a packet on an edge, a signal
 * on a wire. The source line stays in place underneath.
 */
export function pulse(line: Node, options: AnimOptions & { color?: ColorInput; length?: number; width?: number; glow?: number } = {}): Anim {
    oneNode('pulse', line, 'the first argument')
    return {
        label: 'pulse', duration: options.duration ?? 1.1, ease: options.ease ?? smooth,
        schedule(ctx) {
            const path = line.get('path')
            if (!path) return
            const lit = new Node(transformPath(path, line.worldMatrix()))
                .stroke(options.color ?? 'yellow', options.width ?? (line.get('strokeWidth') + 1.5))
                .glow(options.glow ?? 10)
            ctx.stage.add(lit)
            ctx.stage.marks.set(lit, line)
            const length = options.length ?? 0.18
            stepAt(lit, 'trimFrom', 0, ctx.t0)
            stepAt(lit, 'trimTo', 0, ctx.t0)
            lit.track('trimTo').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: 1, at: (a) => Math.min(1, a * (1 + length)) })
            lit.track('trimFrom').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: 1, at: (a) => Math.max(0, a * (1 + length) - length) })
            hideAt(lit, ctx.t1)
        },
    }
}

// ── Values ──────────────────────────────────────────────────────────────────

/** A number on the timeline. Read `.value` inside `dynamic` and `update` to drive anything. */
export class Value {
    readonly track: Track<number>
    constructor(initial: number) {
        this.track = new Track(initial)
    }

    get value(): number {
        return this.track.sample(clock.now)
    }

    /** Set at the current point on the timeline. */
    set(value: number): this {
        this.track.step(clock.now, value)
        return this
    }

    to(value: number, options: AnimOptions = {}): Anim {
        const track = this.track
        return {
            label: 'value', duration: options.duration ?? 1, ease: options.ease,
            schedule(ctx) {
                const from = track.sample(ctx.t0)
                track.add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: value, at: (a) => from + (value - from) * a })
            },
        }
    }
}

export { toPaint }
