import {
    apply, invert, mul, pathBounds, transformPath, unionBounds,
    type Bounds, type Mat, type Node, type Vec,
} from '../stage/index'
import { clock } from '../stage/track'
import type { App } from './app'
import { KINDS } from './catalog'
import { objectById, type Beat, type StudioObject } from './model'
import { dragPointer, h } from './ui/dom'

export interface ObjectFrame {
    corners: [Vec, Vec, Vec, Vec]
    center: Vec
    halfWidth: number
    halfHeight: number
    angle: number
    aabb: Bounds
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const HANDLE = 5
const ROTATE_OFFSET = 24
const SNAP_PIXELS = 6

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
    const element = document.createElementNS(SVG_NS, tag)
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value))
    return element
}

/** Read node state at a time, then put the clock back. */
export function atTime<T>(time: number, read: () => T): T {
    const saved = { now: clock.now, mode: clock.mode }
    clock.now = time
    clock.mode = 'free'
    try {
        return read()
    } finally {
        clock.now = saved.now
        clock.mode = saved.mode
    }
}

/** Oriented box around a node in stage coordinates, at the clock's current time. */
export function frameOf(node: Node): ObjectFrame | null {
    const world = node.worldMatrix()
    const inverse = Math.abs(world[0] * world[3] - world[1] * world[2]) > 1e-9 ? invert(world) : null
    let local: Bounds | null = null
    if (inverse) {
        for (const entry of node.all()) {
            const path = entry.get('path')
            if (path && path.length) local = unionBounds(local, pathBounds(transformPath(path, mul(inverse, entry.worldMatrix()))))
        }
    }
    if (local && inverse) {
        const corners = [
            apply(world, local.x, local.y),
            apply(world, local.x + local.width, local.y),
            apply(world, local.x + local.width, local.y + local.height),
            apply(world, local.x, local.y + local.height),
        ] as [Vec, Vec, Vec, Vec]
        return boxFrom(corners)
    }
    // Drawings that rebuild each frame, such as number readouts, report plain bounds.
    let b: Bounds
    try {
        b = node.bounds()
    } catch {
        return null
    }
    if (b.width === 0 && b.height === 0) return null
    return boxFrom([[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]])
}

function boxFrom(corners: [Vec, Vec, Vec, Vec]): ObjectFrame {
    const [a, b, , d] = corners
    const center: Vec = [(corners[0][0] + corners[2][0]) / 2, (corners[0][1] + corners[2][1]) / 2]
    const xs = corners.map((corner) => corner[0]), ys = corners.map((corner) => corner[1])
    const minX = Math.min(...xs), minY = Math.min(...ys)
    return {
        corners, center,
        halfWidth: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2,
        halfHeight: Math.hypot(d[0] - a[0], d[1] - a[1]) / 2,
        angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
        aabb: { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY },
    }
}

function pointInBox(frame: ObjectFrame, x: number, y: number, pad: number): boolean {
    const cos = Math.cos(-frame.angle), sin = Math.sin(-frame.angle)
    const dx = x - frame.center[0], dy = y - frame.center[1]
    const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos
    return Math.abs(lx) <= frame.halfWidth + pad && Math.abs(ly) <= frame.halfHeight + pad
}

let hitContext: CanvasRenderingContext2D | null = null

/** Precise picking for open shapes: near the stroke or inside a fill. */
function hitsShape(node: Node, x: number, y: number, tolerance: number): boolean {
    hitContext ??= document.createElement('canvas').getContext('2d')
    const ctx = hitContext
    if (!ctx) return true
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    for (const leaf of node.all()) {
        const path = leaf.get('path')
        if (!path || path.length === 0) continue
        const world: Mat = leaf.worldMatrix()
        const baked = transformPath(path, world)
        const p = new Path2D()
        for (const ring of baked) {
            const data = ring.p
            if (data.length < 2) continue
            p.moveTo(data[0]!, data[1]!)
            for (let o = 2; o + 5 < data.length; o += 6) p.bezierCurveTo(data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!, data[o + 4]!, data[o + 5]!)
            if (ring.closed) p.closePath()
        }
        if (leaf.get('fill') && ctx.isPointInPath(p, x, y)) return true
        ctx.lineWidth = Math.max(leaf.get('strokeWidth'), 0) + tolerance * 2
        if (ctx.isPointInStroke(p, x, y)) return true
    }
    return false
}

/** Beat whose destination decides where an object sits at this time, if any. */
export function activeMoveBeat(beats: readonly Beat[], objectId: string, time: number): Beat | null {
    let found: Beat | null = null
    for (const beat of beats) {
        if (beat.target !== objectId || beat.kind !== 'move') continue
        if (beat.start <= time + 1e-6 && (!found || beat.start >= found.start)) found = beat
    }
    return found
}

type Gesture =
    | { type: 'move'; ids: string[]; startX: number; startY: number; union: Bounds; moved: boolean; key: string; origin: Map<string, { x: number; y: number; beat: string | null }> }
    | { type: 'resize'; id: string; signX: number; signY: number; start: ObjectFrame; object: StudioObject; key: string }
    | { type: 'rotate'; id: string; center: Vec; startAngle: number; rotation: number; key: string }
    | { type: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean; before: readonly string[] }
    | { type: 'pan'; left: number; top: number; x: number; y: number }

interface Guide {
    axis: 'x' | 'y'
    at: number
}

/** The canvas, the selection handles, and everything you can do to objects by dragging. */
export class StageView {
    readonly element: HTMLElement
    readonly viewport: HTMLElement
    readonly stage: HTMLElement
    readonly canvas: HTMLCanvasElement
    readonly sandboxSlot: HTMLElement
    private readonly overlay: SVGSVGElement
    private readonly input: HTMLElement
    private gesture: Gesture | null = null
    private guides: Guide[] = []
    private gestureCount = 0
    private spaceDown = false
    zoom: number | 'fit' = 'fit'
    private readonly zoomLabel: HTMLElement
    /** Stage pixels per screen pixel, inverted. */
    private k = 1
    private observer: ResizeObserver

    constructor(private readonly app: App) {
        this.canvas = h('canvas', { class: 'stage-canvas', 'data-test': 'canvas', 'aria-label': 'Film preview' })
        this.overlay = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement
        this.overlay.classList.add('stage-overlay')
        this.overlay.setAttribute('aria-hidden', 'true')
        this.input = h('div', { class: 'stage-input', 'data-test': 'stage-input' })
        this.sandboxSlot = h('div', { class: 'sandbox-slot', hidden: true })
        this.stage = h('div', { class: 'stage-sheet' }, this.canvas, this.sandboxSlot, this.overlay, this.input)
        this.viewport = h('div', { class: 'stage-viewport' }, this.stage)
        this.zoomLabel = h('button', { type: 'button', class: 'zoom-label', title: 'Fit to window', onClick: () => this.setZoom('fit') }, 'Fit')
        const hud = h('div', { class: 'stage-hud' }, this.zoomLabel)
        this.element = h('div', { class: 'stage-panel' }, this.viewport, hud)
        this.input.addEventListener('pointerdown', (event) => this.onPointerDown(event))
        this.input.addEventListener('dblclick', (event) => this.onDoubleClick(event))
        this.viewport.addEventListener('pointerdown', (event) => {
            if (event.target === this.viewport) this.app.store.select([])
        })
        this.viewport.addEventListener('wheel', (event) => this.onWheel(event), { passive: false })
        this.observer = new ResizeObserver(() => this.layout())
        this.observer.observe(this.viewport)
        window.addEventListener('keydown', (event) => {
            if (event.code === 'Space' && !isTyping(event)) this.spaceDown = true
        })
        window.addEventListener('keyup', (event) => {
            if (event.code === 'Space') this.spaceDown = false
        })
    }

    setZoom(value: number | 'fit'): void {
        this.zoom = value === 'fit' ? 'fit' : Math.max(0.1, Math.min(4, value))
        this.layout()
    }

    zoomBy(factor: number): void {
        const current = this.k
        this.setZoom(current * factor)
    }

    /** Size the sheet to the current zoom, centered in the viewport. */
    layout(): void {
        const { width, height } = this.app.stageSize()
        const pad = this.app.presenting ? 0 : 28
        const available = this.viewport.getBoundingClientRect()
        const fit = Math.max(0.05, Math.min((available.width - pad * 2) / width, (available.height - pad * 2) / height))
        const scale = this.zoom === 'fit' ? fit : this.zoom
        this.k = scale
        this.stage.style.width = `${Math.round(width * scale)}px`
        this.stage.style.height = `${Math.round(height * scale)}px`
        this.zoomLabel.textContent = this.zoom === 'fit' ? `Fit ${Math.round(scale * 100)}%` : `${Math.round(scale * 100)}%`
        this.overlay.setAttribute('viewBox', `0 0 ${Math.round(width * scale)} ${Math.round(height * scale)}`)
        this.app.resizeFilm()
        this.renderOverlay()
    }

    /** Stage coordinates under a pointer. */
    toStage(clientX: number, clientY: number): Vec {
        const rect = this.stage.getBoundingClientRect()
        const { width, height } = this.app.stageSize()
        return [(clientX - rect.left) / this.k - width / 2, (clientY - rect.top) / this.k - height / 2]
    }

    private toScreen(point: Vec): Vec {
        const { width, height } = this.app.stageSize()
        return [(point[0] + width / 2) * this.k, (point[1] + height / 2) * this.k]
    }

    /** True when a client position lies on the sheet. */
    containsClient(x: number, y: number): boolean {
        const rect = this.stage.getBoundingClientRect()
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }

    private nodeOf(id: string): Node | undefined {
        return this.app.built?.nodes.get(id)
    }

    /** Frame of an object at the playhead. */
    frameOfObject(id: string): ObjectFrame | null {
        const node = this.nodeOf(id)
        if (!node) return null
        return atTime(this.app.time, () => frameOf(node))
    }

    private isVisibleNow(id: string): boolean {
        const node = this.nodeOf(id)
        if (!node) return false
        return atTime(this.app.time, () => {
            for (let n: Node | null = node; n; n = n.parent) if (!n.get('visible')) return false
            return node.get('opacity') > 0.01
        })
    }

    private pick(x: number, y: number): string | null {
        const { project } = this.app.store
        const tolerance = 8 / this.k
        return atTime(this.app.time, () => {
            for (let i = project.objects.length - 1; i >= 0; i--) {
                const object = project.objects[i]!
                if (object.hidden || object.locked) continue
                const node = this.nodeOf(object.id)
                if (!node) continue
                const frame = frameOf(node)
                if (!frame) continue
                const visible = this.isVisibleNow(object.id)
                if (!pointInBox(frame, x, y, tolerance)) continue
                if (!visible) return object.id
                const def = KINDS[object.kind]
                if (def?.pick === 'shape' && !hitsShape(node, x, y, tolerance)) continue
                return object.id
            }
            return null
        })
    }

    private handleAt(clientX: number, clientY: number): { signX: number; signY: number } | 'rotate' | null {
        const { selection, project } = this.app.store
        if (selection.length !== 1) return null
        const object = objectById(project, selection[0]!)
        if (!object || object.locked) return null
        const frame = this.frameOfObject(object.id)
        if (!frame) return null
        const rect = this.stage.getBoundingClientRect()
        const px = clientX - rect.left, py = clientY - rect.top
        for (const handle of this.handles(object, frame)) {
            if (Math.hypot(px - handle.x, py - handle.y) <= HANDLE + 4) return handle.kind === 'rotate' ? 'rotate' : { signX: handle.signX, signY: handle.signY }
        }
        return null
    }

    private handles(object: StudioObject, frame: ObjectFrame): { x: number; y: number; signX: number; signY: number; kind: 'size' | 'rotate' }[] {
        const out: { x: number; y: number; signX: number; signY: number; kind: 'size' | 'rotate' }[] = []
        const def = KINDS[object.kind]
        const cos = Math.cos(frame.angle), sin = Math.sin(frame.angle)
        const place = (lx: number, ly: number): Vec => this.toScreen([frame.center[0] + lx * cos - ly * sin, frame.center[1] + lx * sin + ly * cos])
        const axial = def?.resize.type === 'props' && def.resize.keys.length === 1 && def.resize.keys[0] === 'length'
        const roomy = Math.min(frame.halfWidth, frame.halfHeight) * 2 * this.k > 56
        const free = def?.resize.type === 'props' && def.resize.keys.length === 2 && roomy
        // Handles stay apart on small objects, so the middle is still free to grab.
        const minimum = 11 / this.k
        const halfW = Math.max(frame.halfWidth, minimum), halfH = Math.max(frame.halfHeight, minimum)
        const add = (signX: number, signY: number) => {
            const [x, y] = place(signX * halfW, signY * halfH)
            out.push({ x, y, signX, signY, kind: 'size' })
        }
        if (axial) {
            add(-1, 0)
            add(1, 0)
        } else {
            add(-1, -1)
            add(1, -1)
            add(1, 1)
            add(-1, 1)
            if (free) {
                add(0, -1)
                add(1, 0)
                add(0, 1)
                add(-1, 0)
            }
        }
        const [tx, ty] = place(0, -halfH)
        const screenAngle = frame.angle
        out.push({ x: tx + Math.sin(screenAngle) * ROTATE_OFFSET, y: ty - Math.cos(screenAngle) * ROTATE_OFFSET, signX: 0, signY: 0, kind: 'rotate' })
        return out
    }

    // ── Pointer gestures ────────────────────────────────────────────────────

    private onWheel(event: WheelEvent): void {
        if (!(event.ctrlKey || event.metaKey)) return
        event.preventDefault()
        this.zoomBy(Math.exp(-event.deltaY * 0.002))
    }

    private onDoubleClick(event: MouseEvent): void {
        const [x, y] = this.toStage(event.clientX, event.clientY)
        const id = this.pick(x, y)
        if (id) this.app.inspector.focusPrimaryField()
    }

    private onPointerDown(event: PointerEvent): void {
        if (event.button !== 0 && event.button !== 1) return
        event.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur?.()
        const store = this.app.store
        if (this.spaceDown || event.button === 1) {
            this.gesture = { type: 'pan', left: this.viewport.scrollLeft, top: this.viewport.scrollTop, x: event.clientX, y: event.clientY }
            this.track(event)
            return
        }
        const handle = this.handleAt(event.clientX, event.clientY)
        if (handle) {
            const id = store.selection[0]!
            const object = objectById(store.project, id)!
            const frame = this.frameOfObject(id)!
            if (handle === 'rotate') {
                const [x, y] = this.toStage(event.clientX, event.clientY)
                this.gesture = { type: 'rotate', id, center: frame.center, startAngle: Math.atan2(y - frame.center[1], x - frame.center[0]), rotation: object.rotation, key: `rotate:${++this.gestureCount}` }
            } else {
                this.gesture = { type: 'resize', id, signX: handle.signX, signY: handle.signY, start: frame, object: structuredClone(object), key: `resize:${++this.gestureCount}` }
            }
            this.track(event)
            return
        }
        const [x, y] = this.toStage(event.clientX, event.clientY)
        // Inside the box of a selected object, a drag moves it even between its strokes.
        const held = store.selection.length === 1 && !event.shiftKey && !event.metaKey && !event.ctrlKey ? store.selection[0]! : null
        const heldFrame = held && !objectById(store.project, held)?.locked ? this.frameOfObject(held) : null
        const hit = heldFrame && pointInBox(heldFrame, x, y, 0) ? held : this.pick(x, y)
        if (hit) {
            let selection = [...store.selection]
            if (event.shiftKey || event.metaKey || event.ctrlKey) {
                selection = selection.includes(hit) ? selection.filter((id) => id !== hit) : [...selection, hit]
            } else if (!selection.includes(hit)) {
                selection = [hit]
            }
            store.select(selection)
            if (!selection.includes(hit)) return
            this.beginMove(selection, x, y, event)
            return
        }
        const additive = event.shiftKey || event.metaKey || event.ctrlKey
        if (!additive) store.select([])
        this.gesture = { type: 'marquee', x0: x, y0: y, x1: x, y1: y, additive, before: [...store.selection] }
        this.track(event)
    }

    private beginMove(ids: string[], x: number, y: number, event: PointerEvent): void {
        const store = this.app.store
        const movable = ids.filter((id) => !objectById(store.project, id)?.locked)
        let union: Bounds | null = null
        const origin = new Map<string, { x: number; y: number; beat: string | null }>()
        for (const id of movable) {
            const frame = this.frameOfObject(id)
            if (frame) union = unionBounds(union, frame.aabb)
            const object = objectById(store.project, id)!
            const beat = activeMoveBeat(store.project.beats, id, this.app.time)
            origin.set(id, beat
                ? { x: Number(beat.params['x']), y: Number(beat.params['y']), beat: beat.id }
                : { x: object.x, y: object.y, beat: null })
        }
        if (!union) return
        this.gesture = { type: 'move', ids: movable, startX: x, startY: y, union, moved: false, key: `move:${++this.gestureCount}`, origin }
        this.track(event)
    }

    private track(event: PointerEvent): void {
        document.body.classList.add('is-dragging')
        dragPointer(event, this.input, {
            move: (next) => this.onGestureMove(next),
            up: (next) => this.finishGesture(next),
            cancel: () => this.finishGesture(null),
        })
    }

    private onGestureMove(event: PointerEvent): void {
        const gesture = this.gesture
        if (!gesture) return
        const [x, y] = this.toStage(event.clientX, event.clientY)
        switch (gesture.type) {
            case 'pan':
                this.viewport.scrollLeft = gesture.left - (event.clientX - gesture.x)
                this.viewport.scrollTop = gesture.top - (event.clientY - gesture.y)
                break
            case 'marquee':
                gesture.x1 = x
                gesture.y1 = y
                this.applyMarquee(gesture)
                this.renderOverlay()
                break
            case 'move': {
                let dx = x - gesture.startX, dy = y - gesture.startY
                if (!gesture.moved && Math.hypot(dx, dy) * this.k < 3) return
                gesture.moved = true
                if (event.shiftKey) {
                    if (Math.abs(dx) > Math.abs(dy)) dy = 0
                    else dx = 0
                }
                const snapped = this.app.snapping && !(event.metaKey || event.ctrlKey) ? this.snapMove(gesture, dx, dy) : { dx, dy, guides: [] }
                this.guides = snapped.guides
                const origin = gesture.origin
                this.app.store.commit((draft) => {
                    for (const [id, start] of origin) {
                        if (start.beat) {
                            const beat = draft.beats.find((entry) => entry.id === start.beat)
                            if (beat) {
                                beat.params['x'] = Math.round((start.x + snapped.dx) * 1000) / 1000
                                beat.params['y'] = Math.round((start.y + snapped.dy) * 1000) / 1000
                            }
                        } else {
                            const object = objectById(draft, id)
                            if (object) {
                                object.x = Math.round((start.x + snapped.dx) * 1000) / 1000
                                object.y = Math.round((start.y + snapped.dy) * 1000) / 1000
                            }
                        }
                    }
                }, { merge: gesture.key })
                break
            }
            case 'rotate': {
                let angle = gesture.rotation + (Math.atan2(y - gesture.center[1], x - gesture.center[0]) - gesture.startAngle) * 180 / Math.PI
                angle = ((angle + 180) % 360 + 360) % 360 - 180
                if (event.shiftKey) angle = Math.round(angle / 15) * 15
                else if (this.app.snapping && Math.abs(angle - Math.round(angle / 45) * 45) < 1.5) angle = Math.round(angle / 45) * 45
                const rounded = Math.round(angle * 100) / 100
                this.app.store.commit((draft) => {
                    const object = objectById(draft, gesture.id)
                    if (object) object.rotation = rounded
                }, { merge: gesture.key })
                break
            }
            case 'resize':
                this.applyResize(gesture, x, y, event)
                break
        }
    }

    private applyResize(gesture: Extract<Gesture, { type: 'resize' }>, x: number, y: number, event: PointerEvent): void {
        const { start, signX, signY, object } = gesture
        const def = KINDS[object.kind]
        if (!def) return
        const cos = Math.cos(start.angle), sin = Math.sin(start.angle)
        const anchorLocal: Vec = event.altKey ? [0, 0] : [-signX * start.halfWidth, -signY * start.halfHeight]
        const anchor: Vec = [start.center[0] + anchorLocal[0] * cos - anchorLocal[1] * sin, start.center[1] + anchorLocal[0] * sin + anchorLocal[1] * cos]
        const dx = x - anchor[0], dy = y - anchor[1]
        const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos
        const reach = event.altKey ? 1 : 2
        let fx = signX !== 0 && start.halfWidth > 0 ? Math.max(0.02, (lx * signX) / (start.halfWidth * reach)) : 1
        let fy = signY !== 0 && start.halfHeight > 0 ? Math.max(0.02, (ly * signY) / (start.halfHeight * reach)) : 1
        const free = def.resize.type === 'props' && def.resize.keys.length === 2
        const uniform = !free || event.shiftKey
        if (uniform) {
            const f = signX !== 0 && signY !== 0 ? Math.max(fx, fy) : signX !== 0 ? fx : fy
            fx = f
            fy = f
        }
        const width = start.halfWidth * fx, height = start.halfHeight * fy
        const offsetX = event.altKey ? 0 : signX * width, offsetY = event.altKey ? 0 : signY * height
        const nextCenter: Vec = [anchor[0] + offsetX * cos - offsetY * sin, anchor[1] + offsetX * sin + offsetY * cos]
        const round = (value: number) => Math.round(value * 100) / 100
        this.app.store.commit((draft) => {
            const target = objectById(draft, gesture.id)
            if (!target) return
            if (def.resize.type === 'scale') {
                target.scale = Math.round(object.scale * fx * 1000) / 1000
            } else {
                const keys = def.resize.keys
                const limit = (key: string, value: number) => {
                    const field = def.fields.find((entry) => entry.key === key)
                    return Math.max(field?.min ?? 0, Math.min(field?.max ?? Infinity, value))
                }
                target.props[keys[0]!] = round(limit(keys[0]!, (object.props[keys[0]!] as number) * fx))
                if (keys[1]) target.props[keys[1]] = round(limit(keys[1], (object.props[keys[1]] as number) * fy))
            }
            if (!this.hasMoveBeatAtPlayhead(gesture.id)) {
                target.x = round(nextCenter[0])
                target.y = round(nextCenter[1])
            }
        }, { merge: gesture.key })
    }

    private hasMoveBeatAtPlayhead(id: string): boolean {
        return activeMoveBeat(this.app.store.project.beats, id, this.app.time) !== null
    }

    private applyMarquee(gesture: Extract<Gesture, { type: 'marquee' }>): void {
        const x0 = Math.min(gesture.x0, gesture.x1), x1 = Math.max(gesture.x0, gesture.x1)
        const y0 = Math.min(gesture.y0, gesture.y1), y1 = Math.max(gesture.y0, gesture.y1)
        const ids: string[] = gesture.additive ? [...gesture.before] : []
        const { project } = this.app.store
        for (const object of project.objects) {
            if (object.hidden || object.locked || ids.includes(object.id)) continue
            const frame = this.frameOfObject(object.id)
            if (!frame) continue
            const b = frame.aabb
            if (b.x >= x0 && b.y >= y0 && b.x + b.width <= x1 && b.y + b.height <= y1) ids.push(object.id)
        }
        this.app.store.select(ids)
    }

    private snapMove(gesture: Extract<Gesture, { type: 'move' }>, dx: number, dy: number): { dx: number; dy: number; guides: Guide[] } {
        const { width, height } = this.app.stageSize()
        const threshold = SNAP_PIXELS / this.k
        const xs: number[] = [-width / 2, 0, width / 2]
        const ys: number[] = [-height / 2, 0, height / 2]
        const moving = new Set(gesture.ids)
        for (const object of this.app.store.project.objects) {
            if (moving.has(object.id) || object.hidden) continue
            const frame = this.frameOfObject(object.id)
            if (!frame) continue
            const b = frame.aabb
            xs.push(b.x, b.x + b.width / 2, b.x + b.width)
            ys.push(b.y, b.y + b.height / 2, b.y + b.height)
        }
        const u = gesture.union
        const best = (positions: number[], targets: number[], delta: number): { delta: number; at: number | null } => {
            let result: { delta: number; at: number | null } = { delta, at: null }
            let distance = threshold
            for (const position of positions) {
                for (const target of targets) {
                    const gap = Math.abs(position + delta - target)
                    if (gap < distance) {
                        distance = gap
                        result = { delta: target - position, at: target }
                    }
                }
            }
            return result
        }
        const sx = best([u.x, u.x + u.width / 2, u.x + u.width], xs, dx)
        const sy = best([u.y, u.y + u.height / 2, u.y + u.height], ys, dy)
        const guides: Guide[] = []
        if (sx.at !== null) guides.push({ axis: 'x', at: sx.at })
        if (sy.at !== null) guides.push({ axis: 'y', at: sy.at })
        return { dx: sx.delta, dy: sy.delta, guides }
    }

    private finishGesture(event: PointerEvent | null): void {
        document.body.classList.remove('is-dragging')
        const gesture = this.gesture
        this.gesture = null
        this.guides = []
        if (gesture?.type === 'move' && !gesture.moved && event && !(event.shiftKey || event.metaKey || event.ctrlKey)) {
            // A plain click on one of several selected objects narrows the selection to it.
            const [x, y] = this.toStage(event.clientX, event.clientY)
            const hit = this.pick(x, y)
            if (hit && this.app.store.selection.length > 1) this.app.store.select([hit])
        }
        this.app.store.settle()
        this.renderOverlay()
    }

    // ── Overlay ─────────────────────────────────────────────────────────────

    /** Draw selection, handles, guides, and outlines of objects hidden at this moment. */
    renderOverlay(): void {
        const overlay = this.overlay
        while (overlay.firstChild) overlay.removeChild(overlay.firstChild)
        if (this.app.store.project.mode === 'code') return
        if (this.app.presenting) return
        const { project, selection } = this.app.store
        const selected = new Set(selection)
        const playing = this.app.playing
        const quad = (corners: readonly Vec[]) => corners.map((corner) => this.toScreen(corner).map((value) => Math.round(value * 10) / 10).join(',')).join(' ')
        if (!playing) {
            for (const object of project.objects) {
                if (object.hidden || selected.has(object.id) || this.isVisibleNow(object.id)) continue
                const frame = this.frameOfObject(object.id)
                if (!frame) continue
                overlay.appendChild(svg('polygon', { points: quad(frame.corners), class: 'ghost-box' }))
            }
        }
        const errors = this.app.built?.objectErrors
        for (const id of selection) {
            const object = objectById(project, id)
            if (!object) continue
            const frame = this.frameOfObject(id)
            if (!frame) continue
            overlay.appendChild(svg('polygon', {
                points: quad(frame.corners),
                class: `select-box${errors?.has(id) ? ' has-error' : ''}${this.isVisibleNow(id) ? '' : ' is-offstage'}`,
            }))
            if (selection.length !== 1 || object.locked || playing) continue
            const handles = this.handles(object, frame)
            const rotate = handles.find((handle) => handle.kind === 'rotate')
            if (rotate) {
                const stem = ROTATE_OFFSET
                overlay.appendChild(svg('line', {
                    x1: rotate.x - Math.sin(frame.angle) * stem, y1: rotate.y + Math.cos(frame.angle) * stem,
                    x2: rotate.x, y2: rotate.y, class: 'rotate-stem',
                }))
            }
            for (const handle of handles) {
                if (handle.kind === 'rotate') {
                    overlay.appendChild(svg('circle', { cx: handle.x, cy: handle.y, r: HANDLE, class: 'rotate-handle' }))
                } else {
                    const size = HANDLE * 2 - 2
                    overlay.appendChild(svg('rect', { x: handle.x - size / 2, y: handle.y - size / 2, width: size, height: size, class: 'size-handle' }))
                }
            }
            const label = svg('text', { x: this.toScreen(frame.corners[0])[0], y: this.toScreen(frame.corners[0])[1] - 7, class: 'select-label' })
            label.textContent = object.name
            overlay.appendChild(label)
        }
        if (selection.length > 1) {
            let union: Bounds | null = null
            for (const id of selection) {
                const frame = this.frameOfObject(id)
                if (frame) union = unionBounds(union, frame.aabb)
            }
            if (union) {
                overlay.appendChild(svg('polygon', { points: quad([[union.x, union.y], [union.x + union.width, union.y], [union.x + union.width, union.y + union.height], [union.x, union.y + union.height]]), class: 'union-box' }))
            }
        }
        const { width, height } = this.app.stageSize()
        for (const guide of this.guides) {
            const a = guide.axis === 'x' ? this.toScreen([guide.at, -height / 2]) : this.toScreen([-width / 2, guide.at])
            const b = guide.axis === 'x' ? this.toScreen([guide.at, height / 2]) : this.toScreen([width / 2, guide.at])
            overlay.appendChild(svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'snap-guide' }))
        }
        if (this.gesture?.type === 'marquee') {
            const g = this.gesture
            const a = this.toScreen([Math.min(g.x0, g.x1), Math.min(g.y0, g.y1)])
            const b = this.toScreen([Math.max(g.x0, g.x1), Math.max(g.y0, g.y1)])
            overlay.appendChild(svg('rect', { x: a[0], y: a[1], width: b[0] - a[0], height: b[1] - a[1], class: 'marquee' }))
        }
    }
}

export function isTyping(event: Event): boolean {
    const target = event.target as HTMLElement | null
    if (!target) return false
    return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
}

