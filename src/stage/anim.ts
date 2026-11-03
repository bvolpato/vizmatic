import { smooth, linear, thereAndBack, wiggle as wiggleEase, type Ease } from './ease'
import {
    apply, compose, matScale, pointAt, subdivideEach, tangentAt, transformPath, warpPath, circlePath, linePath, rectPath,
    type Mat, type Path, type Vec,
} from './geometry'
import { isGradient, sampleStops, toPaint, type ColorInput, type Paint, type Rgba } from './color'
import { clock, Track } from './track'
import { Node, type NodeProps, type PropName } from './node'
import { matchSequence, pathMixer } from './morph'
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

export type Target = Node | readonly Node[]

function list(target: Target): Node[] {
    return Array.isArray(target) ? [...target] as Node[] : [target as Node]
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
export function to<T extends Node>(node: T, change: (node: T) => unknown, options: AnimOptions & { restore?: boolean } = {}): Anim {
    return {
        label: 'to', duration: options.duration ?? 1, ease: options.ease,
        schedule(ctx) {
            ensureVisible(node, ctx.t0, ctx.stage)
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
    if (px !== undefined || py !== undefined) {
        const nextPx = px ?? node.get('px'), nextPy = py ?? node.get('py')
        const m: Mat = compose(node.get('x'), node.get('y'), node.get('rotation'), node.get('sx'), node.get('sy'), node.get('px'), node.get('py'))
        const [startX, startY] = apply(m, nextPx, nextPy)
        stepAt(node, 'px', nextPx, t0)
        stepAt(node, 'py', nextPy, t0)
        stepAt(node, 'x', startX, t0)
        stepAt(node, 'y', startY, t0)
        props.delete('px')
        props.delete('py')
    }
    clock.now = t0
    for (const [prop, value] of props) {
        const from = node.get(prop)
        if (from === value) continue
        if (restore) restoreValues.set(prop, from)
        node.tween(prop, value, t0, t1, ease)
    }
    for (const [prop, value] of restoreValues) stepAt(node, prop, value, t1)
}

export function moveTo(node: Node, target: Vec | Node, options: AnimOptions = {}): Anim {
    return { ...to(node, (n) => n.moveTo(target), options), label: 'moveTo' }
}

export function shift(node: Node, dx: number, dy: number, options: AnimOptions = {}): Anim {
    return { ...to(node, (n) => n.shift(dx, dy), options), label: 'shift' }
}

export function scaleBy(node: Node, factor: number | Vec, options: AnimOptions & { about?: Vec } = {}): Anim {
    return { ...to(node, (n) => n.scale(factor, options.about), options), label: 'scale' }
}

export function rotate(node: Node, radians: number, options: AnimOptions & { about?: Vec } = {}): Anim {
    return { ...to(node, (n) => n.rotate(radians, options.about), options), label: 'rotate' }
}

export function recolor(node: Node, color: ColorInput, options: AnimOptions = {}): Anim {
    return { ...to(node, (n) => n.color(color), options), label: 'recolor' }
}

export function fade(node: Node, opacity: number, options: AnimOptions = {}): Anim {
    return { ...to(node, (n) => n.opacity(opacity), { duration: 0.6, ...options }), label: 'fade' }
}

/** Follow a path, or the shape of a node, from start to end. */
export function along(node: Node, track: Path | Node, options: AnimOptions & { orient?: boolean } = {}): Anim {
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
            pairs.forEach(([x, y], i) => {
                const start = ctx.t0 + i * lag * each
                // A piece that finishes early stays until the target appears at the end.
                ghost(ctx.stage, x, y, { t0: start, t1: start + each, ease: ctx.ease, appear: ctx.t0, hide: ctx.t1 })
            })
            finishMorph(a, b, ctx)
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

function finishMorph(a: readonly Node[], b: readonly Node[], ctx: AnimContext): void {
    for (const node of a) hideAt(node, ctx.t0)
    for (const node of b) node.track('visible').step(ctx.t1, true)
    clock.now = ctx.t0
}

/**
 * Morph equations and labels by meaning. Glyphs that exist on both sides travel
 * to their new places. The rest fade out or in where they stand.
 */
export function morphMatching(from: Node, to: Node, options: AnimOptions & { key?: (leaf: Node) => unknown; fadeShift?: Vec } = {}): Anim {
    return {
        label: 'morphMatching', duration: options.duration ?? 1.4, ease: options.ease,
        schedule(ctx) {
            prepareTargets([to], ctx)
            const keyOf = options.key ?? ((leaf: Node) => leaf.data['key'])
            const fromLeaves = drawable(from), toLeaves = drawable(to)
            const fromBaked = fromLeaves.map(bake), toBaked = toLeaves.map(bake)
            const pairs = matchSequence(fromLeaves.map(keyOf), toLeaves.map(keyOf))
            const usedFrom = new Set(pairs.map(([i]) => i)), usedTo = new Set(pairs.map(([, j]) => j))
            for (const [i, j] of pairs) ghost(ctx.stage, fromBaked[i]!, toBaked[j]!, ctx)
            const span = ctx.t1 - ctx.t0
            const offset = options.fadeShift ?? [0, 0]
            const shifted = (bakedPath: Path, dx: number, dy: number) => transformPath(bakedPath, [1, 0, 0, 1, dx, dy])
            fromBaked.forEach((baked, i) => {
                if (usedFrom.has(i)) return
                ghost(ctx.stage, baked, {
                    ...baked, path: shifted(baked.path, offset[0], offset[1]), fillOpacity: 0, strokeOpacity: 0,
                }, { t0: ctx.t0, t1: ctx.t0 + span * 0.55, ease: ctx.ease })
            })
            toBaked.forEach((baked, j) => {
                if (usedTo.has(j)) return
                ghost(ctx.stage, {
                    ...baked, path: shifted(baked.path, -offset[0], -offset[1]), fillOpacity: 0, strokeOpacity: 0,
                }, baked, { t0: ctx.t0 + span * 0.35, t1: ctx.t1, ease: ctx.ease })
            })
            finishMorph([from], [to], ctx)
        },
    }
}

// ── Emphasis ────────────────────────────────────────────────────────────────

/** Swell and tint for a moment, then return. */
export function indicate(target: Target, options: AnimOptions & { color?: ColorInput; scale?: number } = {}): Anim {
    const nodes = list(target)
    const anims = nodes.map((node) => retime(to(node, (n) => {
        n.scale(options.scale ?? 1.14)
        n.color(options.color ?? 'yellow')
    }, { restore: true }), { ease: options.ease ?? thereAndBack }))
    return { ...par(...anims), label: 'indicate', duration: options.duration ?? 0.9 }
}

/** Shake gently to draw the eye. */
export function shake(node: Node, options: AnimOptions & { angle?: number; cycles?: number } = {}): Anim {
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
    return {
        label: 'circumscribe', duration: options.duration ?? 1.3, ease: options.ease ?? linear,
        schedule(ctx) {
            const b = target.bounds()
            const pad = options.pad ?? 14
            const outline = new Node(rectPath(b.x - pad, b.y - pad, b.width + pad * 2, b.height + pad * 2, options.radius ?? 12))
                .stroke(options.color ?? 'yellow', options.width ?? 3)
                .glow(8)
            ctx.stage.add(outline)
            const t0 = ctx.t0, t1 = ctx.t1, mid = t0 + (t1 - t0) * 0.55
            stepAt(outline, 'trimTo', 0, t0)
            outline.tween('trimTo', 1, t0, mid, smooth)
            outline.tween('trimFrom', 1, mid - (t1 - t0) * 0.08, t1, smooth)
            hideAt(outline, t1)
        },
    }
}

/** Radial burst at a point, for a moment of arrival. */
export function flash(point: Vec | Node, options: AnimOptions & { color?: ColorInput; radius?: number; rays?: number } = {}): Anim {
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
    return {
        label: 'ripple', duration: options.duration ?? 1, ease: options.ease ?? smooth,
        schedule(ctx) {
            const center: Vec = point instanceof Node ? point.center : point
            const ring = new Node(circlePath(0, 0, options.radius ?? 90)).stroke(options.color ?? 'blue', options.width ?? 3).at(center)
            ctx.stage.add(ring)
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
    return {
        label: 'pulse', duration: options.duration ?? 1.1, ease: options.ease ?? smooth,
        schedule(ctx) {
            const path = line.get('path')
            if (!path) return
            const lit = new Node(transformPath(path, line.worldMatrix()))
                .stroke(options.color ?? 'yellow', options.width ?? (line.get('strokeWidth') + 1.5))
                .glow(options.glow ?? 10)
            ctx.stage.add(lit)
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
