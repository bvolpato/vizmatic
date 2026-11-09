import {
    apply, compose, IDENTITY, invert, mul, pathBounds, transformPath, unionBounds,
    type Bounds, type Mat, type Path, type Vec,
} from './geometry'
import { isGradient, mixColor, mixPaint, toPaint, type ColorInput, type Paint, type Rgba } from './color'
import { clock, Track, type Key } from './track'
import type { Ease } from './ease'
import { pathMixer } from './morph'
import type { DrawOp } from './display'
import type { ImageAsset, ImageCrop } from './image'

export type BlendMode = 'normal' | 'screen' | 'multiply' | 'overlay'
export type Edge = 'left' | 'right' | 'top' | 'bottom'
export type Side = Edge | 'up' | 'down' | Vec

export interface NodeProps {
    x: number
    y: number
    rotation: number
    sx: number
    sy: number
    px: number
    py: number
    opacity: number
    /**
     * The part of its color that a node keeps while a light is on something else: at 1 the node has its own
     * look, and at 0 its paints are the background color of the film. `spotlight` owns it, so a film that
     * fades a node and a light that dims it do not write the same value. It does not change the alpha, so a
     * dim node still hides what is behind it. It does not add up along a branch: a node draws with the
     * least `dim` of itself and its ancestors.
     */
    dim: number
    visible: boolean
    z: number
    path: Path | null
    fill: Paint | null
    fillOpacity: number
    stroke: Paint | null
    strokeOpacity: number
    strokeWidth: number
    cap: 'round' | 'butt' | 'square'
    join: 'round' | 'miter' | 'bevel'
    dash: readonly number[] | null
    dashOffset: number
    trimFrom: number
    trimTo: number
    trimEach: boolean
    glow: number
    glowColor: Rgba | null
    blend: BlendMode
    /** Ignore the camera. Use it for titles, captions, and other screen-space marks. */
    fixed: boolean
    image: StageImage | null
}

export interface StageImage {
    /** Embedded raster, local filename or legacy URL, resolved before the film is rendered. */
    readonly src: string
    readonly width: number
    readonly height: number
    readonly crop?: Readonly<ImageCrop>
    readonly asset?: ImageAsset
}

export type PropName = keyof NodeProps

// Nodes inherit these through the prototype chain, so this object must stay unfrozen:
// assigning over a frozen inherited property throws.
export const DEFAULT_PROPS: Readonly<NodeProps> = {
    x: 0, y: 0, rotation: 0, sx: 1, sy: 1, px: 0, py: 0,
    opacity: 1, dim: 1, visible: true, z: 0,
    path: null, fill: null, fillOpacity: 1, stroke: null, strokeOpacity: 1, strokeWidth: 3,
    cap: 'round', join: 'round', dash: null, dashOffset: 0,
    trimFrom: 0, trimTo: 1, trimEach: false,
    glow: 0, glowColor: null, blend: 'normal', fixed: false, image: null,
}

const NUMERIC: ReadonlySet<PropName> = new Set<PropName>([
    'x', 'y', 'rotation', 'sx', 'sy', 'px', 'py', 'opacity', 'dim', 'z', 'fillOpacity', 'strokeOpacity',
    'strokeWidth', 'dashOffset', 'trimFrom', 'trimTo', 'glow',
])

/** Build the value function for a key between two values of a property. */
export function mixer<K extends PropName>(prop: K, from: NodeProps[K], to: NodeProps[K]): ((alpha: number) => NodeProps[K]) | null {
    if (NUMERIC.has(prop)) {
        const a = from as number, b = to as number
        return ((alpha: number) => a + (b - a) * alpha) as unknown as (alpha: number) => NodeProps[K]
    }
    if (prop === 'fill' || prop === 'stroke') {
        const a = from as Paint | null, b = to as Paint | null
        if (a && b) return ((alpha: number) => mixPaint(a, b, alpha)) as unknown as (alpha: number) => NodeProps[K]
        return null
    }
    if (prop === 'glowColor') {
        const a = from as Rgba | null, b = to as Rgba | null
        if (a && b) return ((alpha: number) => mixColor(a, b, alpha)) as unknown as (alpha: number) => NodeProps[K]
        return null
    }
    if (prop === 'path') {
        const a = from as Path | null, b = to as Path | null
        if (a && b) return pathMixer(a, b) as unknown as (alpha: number) => NodeProps[K]
        return null
    }
    return null
}

let nextId = 1

/**
 * Every visible thing on stage. A node with a path draws. A node with children
 * groups. Both can carry a transform, and every property can change over time.
 *
 * Setter methods chain and apply at the current point on the timeline, so the
 * same calls set up a node before it appears and change it afterwards.
 */
export class Node {
    readonly id = nextId++
    parent: Node | null = null
    children: Node[] = []
    /** Free-form metadata, such as the source character of a glyph. */
    data: Record<string, unknown> = {}
    /** Label shown in timelines and diagnostics. */
    label = ''
    base: NodeProps = Object.create(DEFAULT_PROPS) as NodeProps
    tracks: Map<PropName, Track<unknown>> | null = null
    overlay: Map<string, unknown> | null = null
    overlayFrame = -1
    /** On stage: writes become timeline keys instead of initial state. */
    mounted = false
    /** Rebuilt on every frame from timeline values. */
    draw: ((time: number) => Node | readonly Node[] | null) | null = null
    /** Emits draw operations directly, for objects with thousands of marks such as 3D meshes. */
    rawOps: ((matrix: Mat, alpha: number, ops: DrawOp[]) => void) | null = null
    /**
     * The node whose `draw` built this node for the frame that is on screen. A node that `draw` returns has no
     * parent, so this is the way from a mark of a dynamic drawing up to the object that made it.
     */
    drawer: Node | null = null

    constructor(path?: Path | null) {
        if (path) this.base.path = path
    }

    // ── Raw property access ───────────────────────────────────────────────

    get<K extends PropName>(prop: K): NodeProps[K] {
        const overlay = this.overlay
        if (overlay !== null && overlay.has(prop) && (this.overlayFrame === clock.frame || clock.capture !== null)) {
            return overlay.get(prop) as NodeProps[K]
        }
        const track = this.tracks?.get(prop)
        if (track) return track.sample(clock.now) as NodeProps[K]
        return this.base[prop]
    }

    set<K extends PropName>(prop: K, value: NodeProps[K]): this {
        if (clock.capture) {
            this.overlay ??= new Map()
            this.overlay.set(prop, value)
            clock.capture.add(this)
            return this
        }
        if (!this.mounted) {
            this.base[prop] = value
            return this
        }
        if (clock.mode === 'render') {
            this.overlay ??= new Map()
            if (this.overlayFrame !== clock.frame) {
                this.overlay.clear()
                this.overlayFrame = clock.frame
            }
            this.overlay.set(prop, value)
            return this
        }
        this.track(prop).step(clock.now, value)
        return this
    }

    track<K extends PropName>(prop: K): Track<NodeProps[K]> {
        this.tracks ??= new Map()
        let track = this.tracks.get(prop) as Track<NodeProps[K]> | undefined
        if (!track) {
            track = new Track<NodeProps[K]>(this.base[prop])
            this.tracks.set(prop, track as Track<unknown>)
        }
        return track
    }

    /** Record a change from the current value to `to` over [t0, t1]. */
    tween<K extends PropName>(prop: K, to: NodeProps[K], t0: number, t1: number, ease: Ease | null): void {
        const previous = clock.now
        clock.now = t0
        const from = this.get(prop)
        clock.now = previous
        const at = t1 > t0 ? mixer(prop, from, to) : null
        const key: Key<NodeProps[K]> = { t0, t1, ease, to, at }
        this.track(prop).add(key)
    }

    // ── Tree ──────────────────────────────────────────────────────────────

    add(...nodes: Node[]): this {
        for (const child of nodes) {
            if (child.parent === this) continue
            child.parent?.drop(child)
            child.parent = this
            this.children.push(child)
            if (this.mounted) mountTree(child, clock.now)
        }
        return this
    }

    drop(child: Node): this {
        const index = this.children.indexOf(child)
        if (index >= 0) this.children.splice(index, 1)
        child.parent = null
        return this
    }

    /** Self and all descendants, parents first. */
    all(): Node[] {
        const out: Node[] = []
        const visit = (node: Node) => {
            out.push(node)
            for (const child of node.children) visit(child)
        }
        visit(this)
        return out
    }

    /** Descendants that draw something. A leaf group returns itself if it draws. */
    leaves(): Node[] {
        return this.all().filter((node) => node.get('path') !== null || node.draw !== null || node.get('image') !== null)
    }

    /**
     * A static copy of the current state, off stage. An object that keeps its parts in fields, such as the
     * glyphs of a text or the frame of a card, gets fields that point at the copies of those parts.
     */
    clone(): this {
        const copies = new Map<Node, Node>()
        const copy = this.copyTree(copies)
        // A copy of one label of an object is text of the film. A copy of the whole object keeps the marks of its labels.
        delete copy.data['ownLabel']
        for (const [from, to] of copies) {
            for (const [key, value] of Object.entries(from)) {
                if (key === 'parent' || key === 'children') continue
                const target = to as unknown as Record<string, unknown>
                if (value instanceof Node) {
                    const part = copies.get(value)
                    if (part) target[key] = part
                } else if (Array.isArray(value) && value.some((item) => item instanceof Node) && value.every((item) => item === null || item instanceof Node)) {
                    // A list may have gaps, such as the intervals of a chart where one item has none.
                    target[key] = value.map((item: Node | null) => (item ? copies.get(item) ?? item : null))
                }
            }
        }
        return copy
    }

    private copyTree(copies: Map<Node, Node>): this {
        const copy = Object.create(Object.getPrototypeOf(this)) as this
        Object.assign(copy, this)
        ;(copy as { id: number }).id = nextId++
        copy.parent = null
        copy.drawer = null
        copy.mounted = false
        copy.tracks = null
        copy.overlay = null
        copy.overlayFrame = -1
        copy.data = { ...this.data }
        copy.base = Object.create(DEFAULT_PROPS) as NodeProps
        for (const key of Object.keys(DEFAULT_PROPS) as PropName[]) {
            ;(copy.base as unknown as Record<string, unknown>)[key] = this.get(key)
        }
        copy.children = this.children.map((child) => {
            const next = child.copyTree(copies)
            next.parent = copy
            return next
        })
        copies.set(this, copy)
        return copy
    }

    // ── Transforms ────────────────────────────────────────────────────────

    localMatrix(): Mat {
        return compose(this.get('x'), this.get('y'), this.get('rotation'), this.get('sx'), this.get('sy'), this.get('px'), this.get('py'))
    }

    worldMatrix(): Mat {
        let m = this.localMatrix()
        for (let node = this.parent; node; node = node.parent) m = mul(node.localMatrix(), m)
        return m
    }

    toWorld(x: number, y: number): [number, number] {
        return apply(this.worldMatrix(), x, y)
    }

    /** Stage-space bounds of this node and its descendants. */
    bounds(): Bounds {
        return this.boundsFrom(this.parent ? this.parent.worldMatrix() : IDENTITY) ?? { x: 0, y: 0, width: 0, height: 0 }
    }

    private boundsFrom(parent: Mat): Bounds | null {
        const m = mul(parent, this.localMatrix())
        let result: Bounds | null = null
        const path = this.get('path')
        if (path) result = pathBounds(transformPath(path, m))
        const image = this.get('image')
        if (image) result = unionBounds(result, boundsOfRect(m, image.width, image.height))
        if (this.draw) {
            const built = this.draw(clock.now)
            const list = built === null ? [] : Array.isArray(built) ? built as Node[] : [built as Node]
            for (const child of list) result = unionBounds(result, child.boundsFrom(m))
        }
        for (const child of this.children) {
            if (child.get('visible')) result = unionBounds(result, child.boundsFrom(m))
        }
        return result
    }

    get center(): [number, number] {
        const b = this.bounds()
        return [b.x + b.width / 2, b.y + b.height / 2]
    }
    get top(): [number, number] {
        const b = this.bounds()
        return [b.x + b.width / 2, b.y]
    }
    get bottom(): [number, number] {
        const b = this.bounds()
        return [b.x + b.width / 2, b.y + b.height]
    }
    get left(): [number, number] {
        const b = this.bounds()
        return [b.x, b.y + b.height / 2]
    }
    get right(): [number, number] {
        const b = this.bounds()
        return [b.x + b.width, b.y + b.height / 2]
    }
    get width(): number {
        return this.bounds().width
    }
    get height(): number {
        return this.bounds().height
    }

    /** Set the local position of the origin. */
    at(x: number | Vec, y?: number): this {
        const [px, py] = typeof x === 'number' ? [x, y ?? 0] : x
        this.set('x', px)
        this.set('y', py)
        return this
    }

    shift(dx: number | Vec, dy?: number): this {
        const [ox, oy] = typeof dx === 'number' ? [dx, dy ?? 0] : dx
        this.set('x', this.get('x') + ox)
        this.set('y', this.get('y') + oy)
        return this
    }

    /** Move so the center of the bounds lands on a stage point or on another node's center. */
    moveTo(target: Vec | Node): this {
        const destination: Vec = target instanceof Node ? target.center : target
        const [cx, cy] = this.center
        const inverse = this.parent ? invert(this.parent.worldMatrix()) : IDENTITY
        const [lx0, ly0] = apply(inverse, cx, cy)
        const [lx1, ly1] = apply(inverse, destination[0], destination[1])
        return this.shift(lx1 - lx0, ly1 - ly0)
    }

    /** Move the origin to a stage point without changing how anything looks. */
    pivotAt(point: Vec): this {
        const parent = this.parent ? this.parent.worldMatrix() : IDENTITY
        const before = mul(parent, this.localMatrix())
        const [lx, ly] = apply(invert(before), point[0], point[1])
        const [nx, ny] = apply(invert(parent), point[0], point[1])
        this.set('px', lx)
        this.set('py', ly)
        this.set('x', nx)
        this.set('y', ny)
        return this
    }

    /** Scale around the center, or around a given stage point. */
    scale(factor: number | Vec, about?: Vec): this {
        const [fx, fy] = typeof factor === 'number' ? [factor, factor] : factor
        this.pivotAt(about ?? this.center)
        this.set('sx', this.get('sx') * fx)
        this.set('sy', this.get('sy') * fy)
        return this
    }

    /** Rotate around the center, or around a given stage point. */
    rotate(radians: number, about?: Vec): this {
        this.pivotAt(about ?? this.center)
        this.set('rotation', this.get('rotation') + radians)
        return this
    }

    /** Scale to an exact on-screen width or height, keeping proportions. */
    fitTo(size: { width?: number; height?: number }): this {
        const b = this.bounds()
        const scales: number[] = []
        if (size.width !== undefined && b.width > 0) scales.push(size.width / b.width)
        if (size.height !== undefined && b.height > 0) scales.push(size.height / b.height)
        return scales.length ? this.scale(Math.min(...scales)) : this
    }

    // ── Layout ────────────────────────────────────────────────────────────

    /** Place beside another node or stage point, with a gap measured between bounds. */
    nextTo(target: Node | Vec, side: Side = 'right', gap = 28): this {
        const [dx, dy] = direction(side)
        const b = target instanceof Node ? target.bounds() : { x: target[0], y: target[1], width: 0, height: 0 }
        const own = this.bounds()
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2
        const anchorX = cx + dx * (b.width / 2 + gap + own.width / 2)
        const anchorY = cy + dy * (b.height / 2 + gap + own.height / 2)
        return this.moveTo([anchorX, anchorY])
    }

    /** Line up one edge with another node's same edge. */
    alignTo(target: Node | Vec, edge: Edge): this {
        const own = this.bounds()
        const b = target instanceof Node ? target.bounds() : { x: target[0], y: target[1], width: 0, height: 0 }
        if (edge === 'left') return this.shift(b.x - own.x, 0)
        if (edge === 'right') return this.shift(b.x + b.width - own.x - own.width, 0)
        if (edge === 'top') return this.shift(0, b.y - own.y)
        return this.shift(0, b.y + b.height - own.y - own.height)
    }

    /** Lay out children in a row or column, keeping the group's center. */
    arrange(side: Side = 'right', gap = 24): this {
        const [dx, dy] = direction(side)
        const center = this.center
        let previous: Node | null = null
        for (const child of this.children) {
            if (previous) {
                const b = previous.bounds(), own = child.bounds()
                const px = b.x + b.width / 2 + dx * (b.width / 2 + gap + own.width / 2)
                const py = b.y + b.height / 2 + dy * (b.height / 2 + gap + own.height / 2)
                child.moveTo([dx === 0 ? b.x + b.width / 2 : px, dy === 0 ? b.y + b.height / 2 : py])
            }
            previous = child
        }
        return this.moveTo(center)
    }

    // ── Paint ─────────────────────────────────────────────────────────────

    fill(color: ColorInput | null, opacity?: number): this {
        this.set('fill', color === null ? null : toPaint(color))
        if (opacity !== undefined) this.set('fillOpacity', opacity)
        return this
    }

    stroke(color: ColorInput | null, width?: number, opacity?: number): this {
        this.set('stroke', color === null ? null : toPaint(color))
        if (width !== undefined) this.set('strokeWidth', width)
        if (opacity !== undefined) this.set('strokeOpacity', opacity)
        return this
    }

    /** Recolor this node and its descendants, keeping whichever paints exist. */
    color(color: ColorInput): this {
        const paint = toPaint(color)
        for (const node of this.all()) {
            if (node.get('stroke')) node.set('stroke', paint)
            if (node.get('fill')) node.set('fill', paint)
            if (node.get('glowColor') && !isGradient(paint)) node.set('glowColor', paint as Rgba)
        }
        return this
    }

    opacity(value: number): this {
        return this.set('opacity', value)
    }

    /** Soft light around the shape. The radius is in stage pixels. */
    glow(radius: number, color?: ColorInput): this {
        this.set('glow', radius)
        if (color !== undefined) {
            const paint = toPaint(color)
            this.set('glowColor', isGradient(paint) ? null : paint as Rgba)
        }
        return this
    }

    dash(pattern: readonly number[] | null, offset = 0): this {
        this.set('dash', pattern)
        return this.set('dashOffset', offset)
    }

    zIndex(value: number): this {
        return this.set('z', value)
    }

    /** Pin to the screen so the camera does not move this node. */
    pin(): this {
        return this.set('fixed', true)
    }

    hide(): this {
        return this.set('visible', false)
    }

    show(): this {
        return this.set('visible', true)
    }

    named(label: string): this {
        this.label = label
        return this
    }

    /**
     * The labels that belong to one part of this object, such as the name and the readout of a bar. A light
     * on the part keeps them bright. An object that has such labels says so here.
     */
    labelsOf(_part: Node): readonly Node[] {
        return []
    }
}

function boundsOfRect(m: Mat, width: number, height: number): Bounds {
    const corners = [apply(m, 0, 0), apply(m, width, 0), apply(m, width, height), apply(m, 0, height)]
    const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

export function direction(side: Side): Vec {
    if (typeof side !== 'string') return side
    if (side === 'left') return [-1, 0]
    if (side === 'right') return [1, 0]
    if (side === 'top' || side === 'up') return [0, -1]
    return [0, 1]
}

/** Mark a subtree as on stage. Future writes become keys on the timeline. */
export function mountTree(node: Node, time: number): void {
    const wasVisible = node.base.visible
    for (const entry of node.all()) entry.mounted = true
    if (time > 0 || !wasVisible) {
        const track = node.track('visible')
        track.initial = false
        if (wasVisible) track.step(time, true)
    }
}

/**
 * Say that an object places its own labels beside its own marks, such as an axes with its numbers. The film
 * check then does not judge the distance between one of these labels and a mark of the same object, because
 * a film cannot move the two apart. The object gets `data.ownLayout`, and each label gets `data.ownLabel`.
 *
 * Call it when the object is built. Without `labels`, each text and each dynamic drawing that is in the object
 * now is a label of the object. An object that also holds nodes of a film, such as a card with its figure,
 * names its labels. Text that a film adds later has no mark, so the check judges it as any other text.
 *
 * `plot` is for an object that a film draws data on. A line of the film may then pass a label of the object,
 * as a curve passes the numbers of an axis. `name` is the name of the object in a message of the check: see
 * `objectName`.
 */
export function ownLabels<T extends Node>(owner: T, options: { name?: string; labels?: readonly (Node | null)[]; plot?: boolean } = {}): T {
    if (options.name) objectName(owner, options.name)
    // A plot stays a plot when a method of the object marks one more label.
    if (options.plot || !owner.data['ownLayout']) owner.data['ownLayout'] = options.plot ? 'plot' : true
    const labels = options.labels ?? owner.all().filter((node) => node.draw !== null || node.children.some((child) => child.data['key'] !== undefined))
    for (const label of labels) if (label) label.data['ownLabel'] = true
    return owner
}

/**
 * Give an object of the library the name that the film check prints for its marks: `a line of a connector`. The
 * name is a string in `data.object`. The check does not read the name of a class, because a minified build
 * changes that name to one letter.
 */
export function objectName<T extends Node>(node: T, name: string): T {
    node.data['object'] = name
    return node
}

/** A group. Children keep their own transforms inside it. */
export function group(...children: Node[]): Node {
    return new Node().add(...children)
}

/** A node that rebuilds its contents on every frame from timeline values. */
export function dynamic(build: (time: number) => Node | readonly Node[] | null): Node {
    const node = new Node()
    node.draw = build
    return node
}

