/**
 * 3D on the stage: a camera, meshes, curves, and points, all projected to paths
 * on every frame and drawn back to front. There is no GPU dependency, so the
 * browser and the video exporter produce the same picture. Camera angles and
 * every object's opacity and reveal live on the timeline like anything else.
 */
import { Node } from '../node'
import { parseColor, sampleStops, toPaint, type ColorInput, type Paint, type Rgba } from '../color'
import { Value, type Anim, type AnimOptions } from '../anim'
import { clock } from '../track'
import { text } from '../text'
import { tex } from '../tex'
import { solidColor, stepsBetween, tweenValue } from '../objects/util'
import type { DrawOp, PathOp } from '../display'
import type { Mat, Path, Ring, Vec } from '../geometry'

export type Vec3 = readonly [number, number, number]
type Reactive3 = Vec3 | (() => Vec3)

const read3 = (value: Reactive3): Vec3 => typeof value === 'function' ? value() : value

const normalize = (v: Vec3): Vec3 => {
    const length = Math.hypot(v[0], v[1], v[2]) || 1
    return [v[0] / length, v[1] / length, v[2] / length]
}

export interface Scene3DOptions {
    /** Angle down from straight overhead, in radians. 0 looks straight down. */
    phi?: number
    /** Rotation around the vertical axis, in radians. */
    theta?: number
    /** Camera distance in math units. Smaller exaggerates perspective. */
    distance?: number
    /** Stage pixels per math unit. */
    unit?: number
    focus?: Vec3
    /** Set to false for an orthographic view. */
    perspective?: boolean
    /** Direction toward the light, in world space. */
    light?: Vec3
    /** Share of light that reaches every face, from 0 to 1. */
    ambient?: number
    /** Size of the bright highlight. 0 turns it off. */
    shine?: number
    /** How much distant marks sink toward the background, from 0 to 1. */
    fog?: number
    fogColor?: ColorInput
    /** Multiplies lit surface color. Defaults to 0.8 on dark looks, where large areas also bloom. */
    brightness?: number
}

/** Everything an object needs to project itself for one frame. */
export class View3D {
    readonly ops: PathOp[] = []
    readonly depths: number[] = []
    // Camera basis: right, up, and the direction from the focus toward the camera.
    rx = 0
    ry = 0
    ux = 0
    uy = 0
    uz = 0
    dx = 0
    dy = 0
    dz = 0
    fx = 0
    fy = 0
    fz = 0
    distance = 12
    unit = 100
    perspective = true
    matrix: Mat = [1, 0, 0, 1, 0, 0]
    alpha = 1
    scale = 1
    light: Vec3 = [0, 0, 1]
    half: Vec3 = [0, 0, 1]
    ambient = 0.4
    shine = 0.2
    fog = 0
    fogColor: Rgba = [0, 0, 0, 1]
    depthRange = 1
    brightness = 1
    // The last projected point.
    px = 0
    py = 0
    pz = 0
    ps = 1

    /** Project a world point. Returns false when it falls behind the camera. */
    project(x: number, y: number, z: number): boolean {
        const vx = x - this.fx, vy = y - this.fy, vz = z - this.fz
        const cx = vx * this.rx + vy * this.ry
        const cy = vx * this.ux + vy * this.uy + vz * this.uz
        const cz = vx * this.dx + vy * this.dy + vz * this.dz
        let s = 1
        if (this.perspective) {
            const gap = this.distance - cz
            if (gap <= 0.05) return false
            s = this.distance / gap
        }
        const sx = cx * this.unit * s, sy = -cy * this.unit * s
        const m = this.matrix
        this.px = m[0] * sx + m[2] * sy + m[4]
        this.py = m[1] * sx + m[3] * sy + m[5]
        this.pz = cz
        this.ps = s
        return true
    }

    /** Local stage point before the scene's own transform, for placing labels. */
    screen(x: number, y: number, z: number): [number, number] | null {
        const vx = x - this.fx, vy = y - this.fy, vz = z - this.fz
        const cx = vx * this.rx + vy * this.ry
        const cy = vx * this.ux + vy * this.uy + vz * this.uz
        const cz = vx * this.dx + vy * this.dy + vz * this.dz
        let s = 1
        if (this.perspective) {
            const gap = this.distance - cz
            if (gap <= 0.05) return null
            s = this.distance / gap
        }
        return [cx * this.unit * s, -cy * this.unit * s]
    }

    /** Mix a color toward the background for marks further from the camera. */
    fogged(r: number, g: number, b: number, depth: number): Rgba {
        if (this.fog <= 0) return [r, g, b, 1]
        // Marks at or in front of the focus stay clean. Only those behind it sink away.
        const t = Math.max(0, Math.min(1, (-depth / this.depthRange) * this.fog))
        return [
            r + (this.fogColor[0] - r) * t,
            g + (this.fogColor[1] - g) * t,
            b + (this.fogColor[2] - b) * t,
            1,
        ]
    }

    push(op: PathOp, depth: number): void {
        this.ops.push(op)
        this.depths.push(depth)
    }
}

function strokeOp(path: Path, color: Paint, alpha: number, width: number, glow = 0, cap: PathOp['cap'] = 'round'): PathOp {
    return {
        kind: 'path', path, strokePath: path, fill: null, fillAlpha: 0, stroke: color, strokeAlpha: alpha, strokeWidth: width,
        cap, join: 'round', dash: null, dashOffset: 0, glow, glowColor: null, blend: 'normal',
    }
}

function fillOp(path: Path, color: Paint, alpha: number, stroke: Paint | null, strokeAlpha: number, strokeWidth: number): PathOp {
    return {
        kind: 'path', path, strokePath: path, fill: color, fillAlpha: alpha, stroke, strokeAlpha, strokeWidth,
        cap: 'round', join: 'round', dash: null, dashOffset: 0, glow: 0, glowColor: null, blend: 'normal',
    }
}

function lineRing(x0: number, y0: number, x1: number, y1: number): Ring {
    const dx = x1 - x0, dy = y1 - y0
    const p = new Float64Array(8)
    p[0] = x0
    p[1] = y0
    p[2] = x0 + dx / 3
    p[3] = y0 + dy / 3
    p[4] = x0 + dx * 2 / 3
    p[5] = y0 + dy * 2 / 3
    p[6] = x1
    p[7] = y1
    return { p, closed: false, straight: true }
}

function polygonRing(points: readonly number[]): Ring {
    const count = points.length / 2
    const p = new Float64Array(2 + count * 6)
    p[0] = points[0]!
    p[1] = points[1]!
    let o = 2
    for (let i = 0; i < count; i++) {
        const ax = points[i * 2]!, ay = points[i * 2 + 1]!
        const bx = points[((i + 1) % count) * 2]!, by = points[((i + 1) % count) * 2 + 1]!
        p[o++] = ax + (bx - ax) / 3
        p[o++] = ay + (by - ay) / 3
        p[o++] = ax + (bx - ax) * 2 / 3
        p[o++] = ay + (by - ay) * 2 / 3
        p[o++] = bx
        p[o++] = by
    }
    return { p, closed: true, straight: true }
}

const KAPPA = 0.5522847498307936

function circleRing(cx: number, cy: number, r: number): Ring {
    const k = r * KAPPA
    return {
        closed: true,
        p: Float64Array.of(
            cx + r, cy,
            cx + r, cy + k, cx + k, cy + r, cx, cy + r,
            cx - k, cy + r, cx - r, cy + k, cx - r, cy,
            cx - r, cy - k, cx - k, cy - r, cx, cy - r,
            cx + k, cy - r, cx + r, cy - k, cx + r, cy,
        ),
    }
}

/**
 * A thing in a 3D scene. It is a regular node with an empty 2D path, so verbs
 * work on it: fadeIn sets opacity, and draw animates its reveal through trimTo.
 */
export abstract class Object3D extends Node {
    constructor() {
        super([])
    }

    abstract emit(view: View3D, time: number): void

    /** Screen-facing labels, drawn on top. */
    labelsNow(_view: View3D): Node[] {
        return []
    }

    protected objectAlpha(view: View3D): number {
        return view.alpha * this.get('opacity')
    }
}

export class Scene3D extends Node {
    readonly phi: Value
    readonly theta: Value
    readonly distance: Value
    readonly unit: Value
    readonly focusX: Value
    readonly focusY: Value
    readonly focusZ: Value
    private readonly orthographic: boolean
    private readonly settings: Scene3DOptions
    private readonly spins: { from: number; to: number; rate: number }[] = []
    private openSpin: { from: number; to: number; rate: number } | null = null

    constructor(options: Scene3DOptions = {}) {
        super()
        this.settings = options
        this.phi = new Value(options.phi ?? 1.15)
        this.theta = new Value(options.theta ?? -1.0)
        this.distance = new Value(options.distance ?? 14)
        this.unit = new Value(options.unit ?? 120)
        this.focusX = new Value(options.focus?.[0] ?? 0)
        this.focusY = new Value(options.focus?.[1] ?? 0)
        this.focusZ = new Value(options.focus?.[2] ?? 0)
        this.orthographic = options.perspective === false
        this.rawOps = (matrix, alpha, ops) => this.render(matrix, alpha, ops)
        this.draw = (time) => {
            const view = this.view(this.worldless, 1, time)
            return this.children.flatMap((child) => child instanceof Object3D && child.get('visible') ? child.labelsNow(view) : [])
        }
    }

    private readonly worldless: Mat = [1, 0, 0, 1, 0, 0]

    private view(matrix: Mat, alpha: number, time: number): View3D {
        const view = new View3D()
        const phi = this.phi.value
        let theta = this.theta.value
        for (const spin of this.spins) {
            if (time > spin.from) theta += (Math.min(time, spin.to) - spin.from) * spin.rate
        }
        const sinP = Math.sin(phi), cosP = Math.cos(phi), sinT = Math.sin(theta), cosT = Math.cos(theta)
        view.rx = -sinT
        view.ry = cosT
        view.ux = -cosP * cosT
        view.uy = -cosP * sinT
        view.uz = sinP
        view.dx = sinP * cosT
        view.dy = sinP * sinT
        view.dz = cosP
        view.fx = this.focusX.value
        view.fy = this.focusY.value
        view.fz = this.focusZ.value
        view.distance = this.distance.value
        view.unit = this.unit.value
        view.perspective = !this.orthographic
        view.matrix = matrix
        view.alpha = alpha
        view.scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]))
        const light = normalize(this.settings.light ?? [-0.45, -0.55, 0.85])
        view.light = light
        view.half = normalize([light[0] + view.dx, light[1] + view.dy, light[2] + view.dz])
        view.ambient = this.settings.ambient ?? 0.26
        view.shine = this.settings.shine ?? 0.2
        view.fog = this.settings.fog ?? 0.6
        const background = parseColor('bg')
        view.fogColor = this.settings.fogColor ? solidColor(this.settings.fogColor) : background
        view.depthRange = Math.max(3, view.distance * 0.5)
        // Large lit areas pick up bloom on dark looks, so they start a little lower to keep their color.
        view.brightness = this.settings.brightness ?? (background[0] + background[1] + background[2] < 200 ? 0.8 : 1)
        return view
    }

    private render(matrix: Mat, alpha: number, ops: DrawOp[]): void {
        const time = clock.now
        const view = this.view(matrix, alpha, time)
        for (const child of this.children) {
            if (child instanceof Object3D && child.get('visible')) child.emit(view, time)
        }
        const count = view.ops.length
        const order = new Uint32Array(count)
        for (let i = 0; i < count; i++) order[i] = i
        const depths = view.depths
        order.sort((a, b) => depths[a]! - depths[b]!)
        for (let i = 0; i < count; i++) ops.push(view.ops[order[i]!]!)
    }

    /** Move the camera over time. Any subset of phi, theta, distance, unit, and focus. */
    orbit(target: { phi?: number; theta?: number; distance?: number; unit?: number; focus?: Vec3 }, options: AnimOptions = {}): Anim {
        return {
            label: 'camera3d', duration: options.duration ?? 2, ease: options.ease,
            schedule: (ctx) => {
                if (target.phi !== undefined) tweenValue(this.phi, target.phi, ctx.t0, ctx.t1, ctx.ease)
                if (target.theta !== undefined) tweenValue(this.theta, target.theta, ctx.t0, ctx.t1, ctx.ease)
                if (target.distance !== undefined) tweenValue(this.distance, target.distance, ctx.t0, ctx.t1, ctx.ease)
                if (target.unit !== undefined) tweenValue(this.unit, target.unit, ctx.t0, ctx.t1, ctx.ease)
                if (target.focus) {
                    tweenValue(this.focusX, target.focus[0], ctx.t0, ctx.t1, ctx.ease)
                    tweenValue(this.focusY, target.focus[1], ctx.t0, ctx.t1, ctx.ease)
                    tweenValue(this.focusZ, target.focus[2], ctx.t0, ctx.t1, ctx.ease)
                }
            },
        }
    }

    /** Start a slow ambient rotation here on the timeline, in radians per second. */
    spin(rate = 0.12): this {
        this.stopSpin()
        this.openSpin = { from: clock.now, to: Infinity, rate }
        this.spins.push(this.openSpin)
        return this
    }

    stopSpin(): this {
        if (this.openSpin) this.openSpin.to = clock.now
        this.openSpin = null
        return this
    }

    /** Stage point of a world position at this moment, for placing 2D notes. */
    stagePoint(point: Vec3): [number, number] {
        const view = this.view(this.worldMatrix(), 1, clock.now)
        return view.project(point[0], point[1], point[2]) ? [view.px, view.py] : [0, 0]
    }
}

export function scene3d(options: Scene3DOptions = {}): Scene3D {
    return new Scene3D(options)
}

// ── Surfaces ────────────────────────────────────────────────────────────────

export interface SurfaceOptions {
    /** Grid cells in each direction. A number applies to both. */
    resolution?: number | readonly [number, number]
    /** One color for the whole surface. */
    color?: ColorInput
    /** Color ramp by height. */
    colors?: readonly ColorInput[]
    /** Two colors in a checker pattern. */
    checker?: readonly [ColorInput, ColorInput]
    /** Any color per face. */
    colorAt?: (x: number, y: number, z: number, u: number, v: number) => Rgba
    opacity?: number
    /** Thin lines along the cells. */
    mesh?: ColorInput | false
    meshOpacity?: number
    meshWidth?: number
    /** Set to false for flat, unlit color. */
    shaded?: boolean
    /** Skip faces pointing away. Good for closed shapes such as spheres. */
    cull?: boolean
    /** Recompute the shape on every frame from time. */
    animate?: boolean
    /** Point normals away from this point. Closed shapes need it so `cull` keeps the near side. */
    outwardFrom?: Vec3
}

export type ParametricFn = (u: number, v: number, t: number) => Vec3

/** A shaded mesh. Faces sort with everything else in the scene, so objects can intersect. */
export class Surface3D extends Object3D {
    private readonly nu: number
    private readonly nv: number
    private readonly positions: Float64Array
    private readonly normals: Float64Array
    private readonly vertexNormals: Float64Array
    private readonly shadingNormals: Float64Array
    private readonly faceColors: Float32Array
    private computedFor = -Infinity
    private readonly screenX: Float64Array
    private readonly screenY: Float64Array
    private readonly screenZ: Float64Array
    private readonly valid: Uint8Array
    private readonly meshColor: Rgba | null
    private ramp: readonly (readonly [number, Rgba])[] | null = null
    private checkerColors: readonly [Rgba, Rgba] | null = null

    constructor(
        private readonly fn: ParametricFn,
        private readonly uRange: readonly [number, number],
        private readonly vRange: readonly [number, number],
        private readonly options: SurfaceOptions = {},
    ) {
        super()
        const res = options.resolution ?? 40
        this.nu = typeof res === 'number' ? res : res[0]
        this.nv = typeof res === 'number' ? res : res[1]
        const vertices = (this.nu + 1) * (this.nv + 1)
        this.positions = new Float64Array(vertices * 3)
        this.normals = new Float64Array(this.nu * this.nv * 3)
        this.vertexNormals = new Float64Array(vertices * 3)
        this.shadingNormals = new Float64Array(this.nu * this.nv * 3)
        this.faceColors = new Float32Array(this.nu * this.nv * 3)
        this.screenX = new Float64Array(vertices)
        this.screenY = new Float64Array(vertices)
        this.screenZ = new Float64Array(vertices)
        this.valid = new Uint8Array(vertices)
        this.meshColor = options.mesh ? solidColor(options.mesh) : null
        if (options.colors) {
            const palette = options.colors.map((c) => solidColor(c))
            this.ramp = palette.map((c, i) => [palette.length === 1 ? 0 : i / (palette.length - 1), c] as const)
        }
        if (options.checker) this.checkerColors = [solidColor(options.checker[0]), solidColor(options.checker[1])]
        if (options.color || (!options.colors && !options.checker && !options.colorAt)) {
            this.base.fill = toPaint(options.color ?? 'blue')
        }
    }

    private compute(time: number): void {
        const { nu, nv, positions, normals, faceColors, fn, uRange, vRange, options } = this
        let o = 0
        let zMin = Infinity, zMax = -Infinity
        for (let i = 0; i <= nu; i++) {
            const u = uRange[0] + (uRange[1] - uRange[0]) * i / nu
            for (let j = 0; j <= nv; j++) {
                const v = vRange[0] + (vRange[1] - vRange[0]) * j / nv
                const p = fn(u, v, time)
                positions[o++] = p[0]
                positions[o++] = p[1]
                positions[o++] = p[2]
                if (p[2] < zMin) zMin = p[2]
                if (p[2] > zMax) zMax = p[2]
            }
        }
        const stride = nv + 1
        const vertexNormals = this.vertexNormals
        vertexNormals.fill(0)
        for (let i = 0; i < nu; i++) {
            for (let j = 0; j < nv; j++) {
                const a = (i * stride + j) * 3, b = ((i + 1) * stride + j) * 3
                const c = ((i + 1) * stride + j + 1) * 3, d = (i * stride + j + 1) * 3
                const ex = positions[c]! - positions[a]!, ey = positions[c + 1]! - positions[a + 1]!, ez = positions[c + 2]! - positions[a + 2]!
                const fx = positions[d]! - positions[b]!, fy = positions[d + 1]! - positions[b + 1]!, fz = positions[d + 2]! - positions[b + 2]!
                let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx
                const length = Math.hypot(nx, ny, nz) || 1
                nx /= length
                ny /= length
                nz /= length
                if (options.outwardFrom) {
                    const [ox, oy, oz] = options.outwardFrom
                    const mx = (positions[a]! + positions[c]!) / 2 - ox, my = (positions[a + 1]! + positions[c + 1]!) / 2 - oy, mz = (positions[a + 2]! + positions[c + 2]!) / 2 - oz
                    if (nx * mx + ny * my + nz * mz < 0) {
                        nx = -nx
                        ny = -ny
                        nz = -nz
                    }
                }
                const f = (i * nv + j) * 3
                normals[f] = nx
                normals[f + 1] = ny
                normals[f + 2] = nz
                for (const vertex of [a / 3, b / 3, c / 3, d / 3]) {
                    vertexNormals[vertex * 3]! += nx
                    vertexNormals[vertex * 3 + 1]! += ny
                    vertexNormals[vertex * 3 + 2]! += nz
                }
                if (this.ramp || this.checkerColors || options.colorAt) {
                    let color: Rgba
                    if (options.colorAt) {
                        const mx = (positions[a]! + positions[c]!) / 2, my = (positions[a + 1]! + positions[c + 1]!) / 2, mz = (positions[a + 2]! + positions[c + 2]!) / 2
                        color = options.colorAt(mx, my, mz, (i + 0.5) / nu, (j + 0.5) / nv)
                    } else if (this.checkerColors) {
                        color = this.checkerColors[(i + j) % 2]!
                    } else {
                        const mz = (positions[a + 2]! + positions[c + 2]! + positions[b + 2]! + positions[d + 2]!) / 4
                        color = sampleStops(this.ramp!, zMax > zMin ? (mz - zMin) / (zMax - zMin) : 0)
                    }
                    faceColors[f] = color[0]
                    faceColors[f + 1] = color[1]
                    faceColors[f + 2] = color[2]
                }
            }
        }
        // Shade with normals averaged across neighbors, so curved surfaces read as smooth.
        const shading = this.shadingNormals
        for (let i = 0; i < nu; i++) {
            for (let j = 0; j < nv; j++) {
                const a = (i * stride + j) * 3, b = ((i + 1) * stride + j) * 3
                const c = ((i + 1) * stride + j + 1) * 3, d = (i * stride + j + 1) * 3
                let sx = 0, sy = 0, sz = 0
                for (const v of [a, b, c, d]) {
                    sx += vertexNormals[v]!
                    sy += vertexNormals[v + 1]!
                    sz += vertexNormals[v + 2]!
                }
                const length = Math.hypot(sx, sy, sz) || 1
                const f = (i * nv + j) * 3
                shading[f] = sx / length
                shading[f + 1] = sy / length
                shading[f + 2] = sz / length
            }
        }
    }

    emit(view: View3D, time: number): void {
        const { options, nu, nv, normals, shadingNormals, faceColors, screenX, screenY, screenZ, valid } = this
        const alpha = this.objectAlpha(view) * (options.opacity ?? 1) * this.get('fillOpacity')
        if (alpha <= 0.002) return
        if (options.animate ? this.computedFor !== time : this.computedFor === -Infinity) {
            this.compute(options.animate ? time : 0)
            this.computedFor = time
        }
        const positions = this.positions
        const stride = nv + 1
        const count = (nu + 1) * (nv + 1)
        for (let i = 0; i < count; i++) {
            const k = i * 3
            if (view.project(positions[k]!, positions[k + 1]!, positions[k + 2]!)) {
                screenX[i] = view.px
                screenY[i] = view.py
                screenZ[i] = view.pz
                valid[i] = 1
            } else {
                valid[i] = 0
            }
        }
        const solid = this.ramp || this.checkerColors || options.colorAt ? null : solidOf(this.get('fill'))
        const shaded = options.shaded ?? true
        const opaque = alpha >= 0.995
        const reveal = this.get('trimTo')
        const rows = Math.ceil(reveal * nu)
        const { light, half, ambient, shine, brightness, dx, dy, dz } = view
        const cull = options.cull ?? false
        const meshColor = this.meshColor
        const meshAlpha = (options.meshOpacity ?? 0.35) * alpha
        const meshWidth = (options.meshWidth ?? 1) * view.scale
        const seam = 0.55 * view.scale
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < nv; j++) {
                const a = i * stride + j, b = (i + 1) * stride + j, c = (i + 1) * stride + j + 1, d = i * stride + j + 1
                if (!valid[a] || !valid[b] || !valid[c] || !valid[d]) continue
                const f = (i * nv + j) * 3
                const facing = normals[f]! * dx + normals[f + 1]! * dy + normals[f + 2]! * dz
                if (facing < 0 && cull) continue
                const flip = facing < 0 ? -1 : 1
                const nx = shadingNormals[f]! * flip, ny = shadingNormals[f + 1]! * flip, nz = shadingNormals[f + 2]! * flip
                let r: number, g: number, bl: number
                if (solid) {
                    r = solid[0]
                    g = solid[1]
                    bl = solid[2]
                } else {
                    r = faceColors[f]!
                    g = faceColors[f + 1]!
                    bl = faceColors[f + 2]!
                }
                if (shaded) {
                    const wrap = 0.5 + 0.5 * (nx * light[0] + ny * light[1] + nz * light[2])
                    const diffuse = (ambient + (1 - ambient) * wrap * wrap) * brightness
                    const spec = shine > 0 ? shine * Math.pow(Math.max(0, nx * half[0] + ny * half[1] + nz * half[2]), 42) * 255 : 0
                    r = Math.min(255, r * diffuse + spec)
                    g = Math.min(255, g * diffuse + spec)
                    bl = Math.min(255, bl * diffuse + spec)
                }
                const depth = (screenZ[a]! + screenZ[b]! + screenZ[c]! + screenZ[d]!) / 4
                const color = view.fogged(r, g, bl, depth)
                let ax = screenX[a]!, ay = screenY[a]!, bx = screenX[b]!, by = screenY[b]!
                let cx = screenX[c]!, cy = screenY[c]!, ex = screenX[d]!, ey = screenY[d]!
                if (opaque && !meshColor) {
                    // Growing each opaque face a little hides the seams between neighbors.
                    // Stroking every face would hide them too, at several times the cost.
                    const mx = (ax + bx + cx + ex) / 4, my = (ay + by + cy + ey) / 4
                    const grow = (x: number, y: number): number => seam / (Math.hypot(x - mx, y - my) || 1)
                    const ka = grow(ax, ay), kb = grow(bx, by), kc = grow(cx, cy), ke = grow(ex, ey)
                    ax += (ax - mx) * ka
                    ay += (ay - my) * ka
                    bx += (bx - mx) * kb
                    by += (by - my) * kb
                    cx += (cx - mx) * kc
                    cy += (cy - my) * kc
                    ex += (ex - mx) * ke
                    ey += (ey - my) * ke
                }
                const ring = polygonRing([ax, ay, bx, by, cx, cy, ex, ey])
                view.push(meshColor
                    ? fillOp([ring], color, alpha, meshColor, meshAlpha, meshWidth)
                    : fillOp([ring], color, alpha, null, 0, 0), depth)
            }
        }
    }
}

function solidOf(paint: Paint | null): Rgba {
    if (!paint) return [90, 180, 240, 1]
    return Array.isArray(paint) ? paint as unknown as Rgba : solidColor(paint as never)
}

/** A surface over any two parameters. */
export function parametricSurface(fn: ParametricFn, u: readonly [number, number], v: readonly [number, number], options: SurfaceOptions = {}): Surface3D {
    return new Surface3D(fn, u, v, options)
}

/** A height field z = f(x, y). `f` also receives time when `animate` is on. */
export function surface(f: (x: number, y: number, t: number) => number, options: SurfaceOptions & { x?: readonly [number, number]; y?: readonly [number, number] } = {}): Surface3D {
    const x = options.x ?? [-4, 4], y = options.y ?? [-4, 4]
    return new Surface3D((u, v, t) => [u, v, f(u, v, t)], x, y, { colors: options.color || options.checker || options.colorAt ? undefined : ['blue', 'teal', 'yellow'], ...options })
}

export function sphere(radius = 1, options: SurfaceOptions & { center?: Vec3 } = {}): Surface3D {
    const [cx, cy, cz] = options.center ?? [0, 0, 0]
    return new Surface3D(
        (u, v) => [cx + radius * Math.sin(v) * Math.cos(u), cy + radius * Math.sin(v) * Math.sin(u), cz + radius * Math.cos(v)],
        [0, Math.PI * 2], [0, Math.PI],
        { cull: true, resolution: [64, 40], outwardFrom: [cx, cy, cz], ...options },
    )
}

// ── Lines and points ────────────────────────────────────────────────────────

export interface Line3DStyle {
    color?: ColorInput
    /** Color ramp along the line. */
    colors?: readonly ColorInput[]
    width?: number
    opacity?: number
    glow?: number
    /** Draw over everything else in the scene. */
    onTop?: boolean
    /** Nudge toward the camera so a line lying on a surface stays visible. */
    bias?: number
}

const ON_TOP = 1e6

/** A curve in space, cut into pieces so it passes correctly in front of and behind other marks. */
export class Curve3D extends Object3D {
    private readonly points: Float64Array
    private readonly stops: readonly (readonly [number, Rgba])[] | null

    constructor(f: (t: number) => Vec3, from: number, to: number, private readonly style: Line3DStyle & { samples?: number } = {}) {
        super()
        const samples = style.samples ?? 240
        this.points = new Float64Array((samples + 1) * 3)
        for (let i = 0; i <= samples; i++) {
            const [x, y, z] = f(from + (to - from) * i / samples)
            this.points[i * 3] = x
            this.points[i * 3 + 1] = y
            this.points[i * 3 + 2] = z
        }
        this.base.stroke = toPaint(style.color ?? 'yellow')
        this.base.strokeWidth = style.width ?? 3
        if (style.colors) {
            const palette = style.colors.map((c) => solidColor(c))
            this.stops = palette.map((c, i) => [palette.length === 1 ? 0 : i / (palette.length - 1), c] as const)
        } else {
            this.stops = null
        }
    }

    emit(view: View3D): void {
        const alpha = this.objectAlpha(view) * (this.style.opacity ?? 1) * this.get('strokeOpacity')
        if (alpha <= 0.002) return
        const trim = this.get('trimTo')
        const count = this.points.length / 3 - 1
        const last = Math.floor(trim * count)
        if (last < 1) return
        const piece = Math.max(2, Math.ceil(count / 72))
        const base = this.get('stroke') ?? toPaint('yellow')
        const width = this.get('strokeWidth') * view.scale
        const bias = this.style.onTop ? ON_TOP : this.style.bias ?? 0.12
        const glow = (this.style.glow ?? 0) * view.scale
        for (let start = 0; start < last; start += piece) {
            const end = Math.min(last, start + piece)
            const coords: Vec[] = []
            let depth = 0
            let scale = 0
            let drawn = 0
            for (let i = start; i <= end; i++) {
                if (!view.project(this.points[i * 3]!, this.points[i * 3 + 1]!, this.points[i * 3 + 2]!)) continue
                coords.push([view.px, view.py])
                depth += view.pz
                scale += view.ps
                drawn++
            }
            if (drawn < 2) continue
            depth /= drawn
            scale /= drawn
            const rgb = this.stops ? sampleStops(this.stops, (start + end) / 2 / count) : solidOf(base)
            const color = view.fogged(rgb[0], rgb[1], rgb[2], depth)
            view.push(strokeOp([chain(coords)], color, alpha, width * scale, glow, 'round'), depth + bias)
        }
    }
}

function chain(points: readonly Vec[]): Ring {
    const p = new Float64Array(2 + (points.length - 1) * 6)
    p[0] = points[0]![0]
    p[1] = points[0]![1]
    let o = 2
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!
        p[o++] = a[0] + (b[0] - a[0]) / 3
        p[o++] = a[1] + (b[1] - a[1]) / 3
        p[o++] = a[0] + (b[0] - a[0]) * 2 / 3
        p[o++] = a[1] + (b[1] - a[1]) * 2 / 3
        p[o++] = b[0]
        p[o++] = b[1]
    }
    return { p, closed: false, straight: true }
}

export function curve3d(f: (t: number) => Vec3, from: number, to: number, style: Line3DStyle & { samples?: number } = {}): Curve3D {
    return new Curve3D(f, from, to, style)
}

/** A straight line in space. Ends can be functions, so it can follow moving points. */
export class Line3D extends Object3D {
    constructor(
        private readonly a: Reactive3,
        private readonly b: Reactive3,
        private readonly style: Line3DStyle & { pieces?: number } = {},
    ) {
        super()
        this.base.stroke = toPaint(style.color ?? 'ink')
        this.base.strokeWidth = style.width ?? 2.5
    }

    emit(view: View3D): void {
        const alpha = this.objectAlpha(view) * (this.style.opacity ?? 1) * this.get('strokeOpacity')
        if (alpha <= 0.002) return
        const a = read3(this.a), b = read3(this.b)
        const pieces = this.style.pieces ?? 14
        const trim = this.get('trimTo')
        const base = solidOf(this.get('stroke'))
        const width = this.get('strokeWidth') * view.scale
        const bias = this.style.onTop ? ON_TOP : this.style.bias ?? 0
        for (let i = 0; i < pieces; i++) {
            const t0 = (i / pieces) * trim, t1 = ((i + 1) / pieces) * trim
            if (!view.project(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0)) continue
            const x0 = view.px, y0 = view.py, z0 = view.pz, s0 = view.ps
            if (!view.project(a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1)) continue
            const depth = (z0 + view.pz) / 2
            const color = view.fogged(base[0], base[1], base[2], depth)
            view.push(strokeOp([lineRing(x0, y0, view.px, view.py)], color, alpha, width * (s0 + view.ps) / 2, 0, 'butt'), depth + bias)
        }
    }
}

export function line3d(a: Reactive3, b: Reactive3, style: Line3DStyle & { pieces?: number } = {}): Line3D {
    return new Line3D(a, b, style)
}

/** An arrow in space. The head always faces the camera, so it reads from any angle. */
export class Vector3D extends Line3D {
    private readonly from3: Reactive3
    private readonly to3: Reactive3
    private readonly tipSize: number
    private readonly tipBias: number

    constructor(from: Reactive3, to: Reactive3, style: Line3DStyle & { tip?: number } = {}) {
        super(from, () => {
            // The shaft stops a little short, so its end never pokes through the head.
            const a = read3(from), b = read3(to)
            const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1
            const pull = Math.min(0.9, 0.22 / length)
            return [b[0] - (b[0] - a[0]) * pull, b[1] - (b[1] - a[1]) * pull, b[2] - (b[2] - a[2]) * pull]
        }, { color: 'yellow', width: 4, ...style })
        this.from3 = from
        this.to3 = to
        this.tipSize = style.tip ?? 24
        // The head sorts with its shaft, so an arrow drawn on top keeps its head.
        this.tipBias = style.onTop ? ON_TOP : style.bias ?? 0
    }

    override emit(view: View3D): void {
        super.emit(view)
        const trim = this.get('trimTo')
        if (trim < 0.98) return
        const a = read3(this.from3), b = read3(this.to3)
        const alpha = this.objectAlpha(view)
        if (!view.project(a[0], a[1], a[2])) return
        const ax = view.px, ay = view.py
        if (!view.project(b[0], b[1], b[2])) return
        const bx = view.px, by = view.py, depth = view.pz, s = view.ps
        const length = Math.hypot(bx - ax, by - ay) || 1
        const ux = (bx - ax) / length, uy = (by - ay) / length
        const size = this.tipSize * view.scale * s
        const half = size * 0.42
        const rgb = solidOf(this.get('stroke'))
        const color = view.fogged(rgb[0], rgb[1], rgb[2], depth)
        const ring = polygonRing([bx, by, bx - ux * size - uy * half, by - uy * size + ux * half, bx - ux * size + uy * half, by - uy * size - ux * half])
        view.push(fillOp([ring], color, alpha, null, 0, 0), depth + 0.01 + this.tipBias)
    }
}

export function vector3d(from: Reactive3, to: Reactive3, style: Line3DStyle & { tip?: number } = {}): Vector3D {
    return new Vector3D(from, to, style)
}

export interface Points3DStyle {
    color?: ColorInput
    /** Per-point color. */
    colorAt?: (index: number, point: Vec3) => ColorInput
    /** Radius in stage pixels at the focus. */
    radius?: number
    opacity?: number
    onTop?: boolean
    /** Nudge toward the camera so a point resting on a surface is not cut by it. */
    bias?: number
    /** Soft ring around each point. */
    halo?: number
}

/** Points in space. Pass a function to move them. They shrink with distance and sort with everything else. */
export class Points3D extends Object3D {
    constructor(private readonly source: readonly Vec3[] | (() => readonly Vec3[]), private readonly style: Points3DStyle = {}) {
        super()
        this.base.fill = toPaint(style.color ?? 'yellow')
    }

    emit(view: View3D): void {
        const alpha = this.objectAlpha(view) * (this.style.opacity ?? 1) * this.get('fillOpacity')
        if (alpha <= 0.002) return
        const points = typeof this.source === 'function' ? this.source() : this.source
        const radius = (this.style.radius ?? 8) * view.scale
        const trim = this.get('trimTo')
        const shown = Math.ceil(points.length * trim)
        const base = solidOf(this.get('fill'))
        const bias = this.style.onTop ? ON_TOP : this.style.bias ?? 0
        for (let i = 0; i < shown; i++) {
            const point = points[i]!
            if (!view.project(point[0], point[1], point[2])) continue
            const rgb = this.style.colorAt ? solidColor(this.style.colorAt(i, point)) : base
            const color = view.fogged(rgb[0], rgb[1], rgb[2], view.pz)
            const r = radius * view.ps
            if (this.style.halo) {
                view.push(fillOp([circleRing(view.px, view.py, r * (1 + this.style.halo))], color, alpha * 0.18, null, 0, 0), view.pz + bias - 0.001)
            }
            view.push(fillOp([circleRing(view.px, view.py, r)], color, alpha, null, 0, 0), view.pz + bias)
        }
    }
}

export function points3d(points: readonly Vec3[] | (() => readonly Vec3[]), style: Points3DStyle = {}): Points3D {
    return new Points3D(points, style)
}

/** One point in space, as a convenience over points3d. */
export function point3d(point: Reactive3, style: Points3DStyle = {}): Points3D {
    return new Points3D(() => [read3(point)], style)
}

/** The path a moving point has taken, with a fading tail. Scrubs correctly in both directions. */
export class Trail3D extends Object3D {
    private readonly cache = new Map<number, Vec3>()

    constructor(
        private readonly point: () => Vec3,
        private readonly from: number,
        private readonly to: number,
        private readonly style: Line3DStyle & { tail?: number; rate?: number; fade?: number } = {},
    ) {
        super()
        this.base.stroke = toPaint(style.color ?? 'yellow')
        this.base.strokeWidth = style.width ?? 3
    }

    private sample(index: number, rate: number): Vec3 {
        const cached = this.cache.get(index)
        if (cached) return cached
        const saved = clock.now
        clock.now = this.from + index / rate
        const value = this.point()
        clock.now = saved
        if (clock.mode === 'render') this.cache.set(index, value)
        return value
    }

    emit(view: View3D, time: number): void {
        if (time <= this.from) return
        const alpha = this.objectAlpha(view) * (this.style.opacity ?? 1)
        const rate = this.style.rate ?? 30
        const end = Math.min(time, this.to)
        const tail = this.style.tail
        const start = tail !== undefined ? Math.max(this.from, end - tail) : this.from
        const i0 = Math.ceil((start - this.from) * rate), i1 = Math.floor((end - this.from) * rate)
        if (i1 - i0 < 1) return
        const width = this.get('strokeWidth') * view.scale
        const base = solidOf(this.get('stroke'))
        const fade = this.style.fade ?? (tail !== undefined ? 0 : 1)
        const bias = this.style.onTop ? ON_TOP : this.style.bias ?? 0
        const glow = (this.style.glow ?? 0) * view.scale
        // Keep only the samples where the point moved. A point that waits and then travels
        // still gets every piece on the part it travelled, so each piece sorts by its own depth.
        const moved: Vec3[] = []
        let last: Vec3 | null = null
        for (let k = i0; k <= i1; k++) {
            const p = this.sample(k, rate)
            if (last && Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) + Math.abs(p[2] - last[2]) < 1e-9) continue
            moved.push(p)
            last = p
        }
        const span = moved.length - 1
        if (span < 1) return
        const piece = Math.max(1, Math.ceil(span / 48))
        for (let i = 0; i < span; i += piece) {
            const coords: Vec[] = []
            let depth = 0
            let scale = 0
            for (let k = i; k <= Math.min(span, i + piece); k++) {
                const p = moved[k]!
                if (!view.project(p[0], p[1], p[2])) continue
                coords.push([view.px, view.py])
                depth += view.pz
                scale += view.ps
            }
            if (coords.length < 2) continue
            depth /= coords.length
            scale /= coords.length
            const fraction = Math.min(1, (i + piece / 2) / span)
            const light = fade + (1 - fade) * Math.pow(fraction, 1.6)
            const color = view.fogged(base[0], base[1], base[2], depth)
            view.push(strokeOp([chain(coords)], color, alpha * light, width * scale, glow, 'butt'), depth + bias)
        }
    }
}

export function trail3d(point: () => Vec3, from: number, to: number, style: Line3DStyle & { tail?: number; rate?: number; fade?: number } = {}): Trail3D {
    return new Trail3D(point, from, to, style)
}

// ── Axes, grid, and labels ──────────────────────────────────────────────────

export interface Axes3DOptions {
    x?: readonly [number, number]
    y?: readonly [number, number]
    z?: readonly [number, number]
    step?: number
    color?: ColorInput
    width?: number
    /** Labels at the axis tips. Pass false to leave them off. */
    labels?: boolean | readonly [string, string, string]
    labelSize?: number
    numbers?: boolean
    ticks?: boolean
    /** Pull toward the camera, so axes lying in a surface do not break into dashes. */
    bias?: number
    onTop?: boolean
}

/** Three axes with ticks and tips. */
export class Axes3D extends Object3D {
    private readonly ranges: readonly (readonly [number, number])[]
    private readonly step: number
    private readonly tags: readonly Node[]
    private readonly numberNodes: { node: Node; at: Vec3 }[] = []

    constructor(private readonly options: Axes3DOptions = {}) {
        super()
        this.ranges = [options.x ?? [-4, 4], options.y ?? [-4, 4], options.z ?? [-2.5, 2.5]]
        this.step = options.step ?? 1
        this.base.stroke = toPaint(options.color ?? 'dim')
        this.base.strokeWidth = options.width ?? 2
        const size = options.labelSize ?? 34
        const names = options.labels === false ? null : Array.isArray(options.labels) ? options.labels : ['x', 'y', 'z']
        this.tags = names ? names.map((name) => tex(name as string, { size, display: false, color: 'ink' })) : []
        if (options.numbers) {
            const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const
            this.ranges.forEach((range, axis) => {
                for (const value of stepsBetween(range[0], range[1], this.step)) {
                    if (value === 0) continue
                    const at: Vec3 = [axes[axis]![0] * value, axes[axis]![1] * value, axes[axis]![2] * value]
                    this.numberNodes.push({ node: text(String(value), { size: 18, color: 'dim' }), at })
                }
            })
        }
    }

    emit(view: View3D): void {
        const alpha = this.objectAlpha(view) * this.get('strokeOpacity')
        if (alpha <= 0.002) return
        const trim = this.get('trimTo')
        const rgb = solidOf(this.get('stroke'))
        const width = this.get('strokeWidth') * view.scale
        const unitVectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const
        const bias = this.options.onTop ? ON_TOP : this.options.bias ?? 0.4
        this.ranges.forEach((range, axis) => {
            const u = unitVectors[axis]!
            const pieces = 16
            const low = range[0], high = low + (range[1] - low) * trim
            for (let i = 0; i < pieces; i++) {
                const a = low + (high - low) * i / pieces, b = low + (high - low) * (i + 1) / pieces
                if (!view.project(u[0] * a, u[1] * a, u[2] * a)) continue
                const x0 = view.px, y0 = view.py, z0 = view.pz
                if (!view.project(u[0] * b, u[1] * b, u[2] * b)) continue
                const depth = (z0 + view.pz) / 2
                view.push(strokeOp([lineRing(x0, y0, view.px, view.py)], view.fogged(rgb[0], rgb[1], rgb[2], depth), alpha, width, 0, 'butt'), depth + bias)
            }
            if (this.options.ticks ?? true) {
                for (const value of stepsBetween(range[0], high, this.step)) {
                    if (value === 0) continue
                    if (!view.project(u[0] * value, u[1] * value, u[2] * value)) continue
                    const cx = view.px, cy = view.py, depth = view.pz
                    const size = 5 * view.ps * view.scale
                    const ring: Ring = lineRing(cx - (axis === 2 ? size : 0), cy - (axis === 2 ? 0 : size), cx + (axis === 2 ? size : 0), cy + (axis === 2 ? 0 : size))
                    view.push(strokeOp([ring], view.fogged(rgb[0], rgb[1], rgb[2], depth), alpha, width * 0.8, 0, 'butt'), depth + bias)
                }
            }
            if (trim > 0.98 && view.project(u[0] * range[1], u[1] * range[1], u[2] * range[1])) {
                const tipX = view.px, tipY = view.py, depth = view.pz
                const back = range[1] - 0.2
                if (view.project(u[0] * back, u[1] * back, u[2] * back)) {
                    const length = Math.hypot(tipX - view.px, tipY - view.py) || 1
                    const ux = (tipX - view.px) / length, uy = (tipY - view.py) / length
                    const size = 14 * view.scale, half = size * 0.42
                    const ring = polygonRing([tipX, tipY, tipX - ux * size - uy * half, tipY - uy * size + ux * half, tipX - ux * size + uy * half, tipY - uy * size - ux * half])
                    view.push(fillOp([ring], view.fogged(rgb[0], rgb[1], rgb[2], depth), alpha, null, 0, 0), depth + bias)
                }
            }
        })
    }

    override labelsNow(view: View3D): Node[] {
        const alpha = this.get('opacity') * this.get('strokeOpacity')
        if (alpha <= 0.002 || this.get('trimTo') < 0.9) return []
        const out: Node[] = []
        const unitVectors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const
        this.tags.forEach((tag, axis) => {
            const u = unitVectors[axis]!
            const reach = this.ranges[axis]![1] + 0.35
            const at = view.screen(u[0] * reach, u[1] * reach, u[2] * reach)
            if (at) {
                tag.at(at)
                tag.set('opacity', alpha)
                out.push(tag)
            }
        })
        for (const { node, at } of this.numberNodes) {
            const screen = view.screen(at[0], at[1], at[2])
            if (screen) {
                node.at(screen[0] + 12, screen[1] + 14)
                node.set('opacity', alpha)
                out.push(node)
            }
        }
        return out
    }
}

export function axes3d(options: Axes3DOptions = {}): Axes3D {
    return new Axes3D(options)
}

export interface GridPlaneOptions {
    x?: readonly [number, number]
    y?: readonly [number, number]
    z?: number
    step?: number
    color?: ColorInput
    width?: number
    opacity?: number
}

/** A hairline grid on a horizontal plane, to ground a scene. */
export class GridPlane3D extends Object3D {
    constructor(private readonly options: GridPlaneOptions = {}) {
        super()
        this.base.stroke = toPaint(options.color ?? 'grid')
        this.base.strokeWidth = options.width ?? 1.2
    }

    emit(view: View3D): void {
        const alpha = this.objectAlpha(view) * (this.options.opacity ?? 1) * this.get('strokeOpacity')
        if (alpha <= 0.002) return
        const [x0, x1] = this.options.x ?? [-5, 5]
        const [y0, y1] = this.options.y ?? [-5, 5]
        const z = this.options.z ?? 0
        const step = this.options.step ?? 1
        const rgb = solidOf(this.get('stroke'))
        const width = this.get('strokeWidth') * view.scale
        const trim = this.get('trimTo')
        const run = (ax: number, ay: number, bx: number, by: number) => {
            const pieces = 10
            for (let i = 0; i < pieces; i++) {
                const t0 = (i / pieces) * trim, t1 = ((i + 1) / pieces) * trim
                if (!view.project(ax + (bx - ax) * t0, ay + (by - ay) * t0, z)) continue
                const px = view.px, py = view.py, pz = view.pz
                if (!view.project(ax + (bx - ax) * t1, ay + (by - ay) * t1, z)) continue
                const depth = (pz + view.pz) / 2
                view.push(strokeOp([lineRing(px, py, view.px, view.py)], view.fogged(rgb[0], rgb[1], rgb[2], depth), alpha, width, 0, 'butt'), depth - 0.05)
            }
        }
        for (const x of stepsBetween(x0, x1, step)) run(x, y0, x, y1)
        for (const y of stepsBetween(y0, y1, step)) run(x0, y, x1, y)
    }
}

export function gridPlane3d(options: GridPlaneOptions = {}): GridPlane3D {
    return new GridPlane3D(options)
}

/** A label pinned to a point in space. It always faces the camera. */
export class Label3D extends Object3D {
    private readonly content: Node

    constructor(content: string | Node, private readonly position: Reactive3, options: { size?: number; color?: ColorInput; math?: boolean; offset?: Vec } = {}) {
        super()
        this.content = typeof content === 'string'
            ? options.math === false
                ? text(content, { size: options.size ?? 28, color: options.color ?? 'ink' })
                : tex(content, { size: options.size ?? 32, color: options.color ?? 'ink', display: false })
            : content
        this.offset = options.offset ?? [0, 0]
    }

    private readonly offset: Vec

    emit(): void {
        // Labels draw through labelsNow.
    }

    override labelsNow(view: View3D): Node[] {
        const alpha = this.get('opacity')
        if (alpha <= 0.002) return []
        const p = read3(this.position)
        const at = view.screen(p[0], p[1], p[2])
        if (!at) return []
        this.content.at(at[0] + this.offset[0], at[1] + this.offset[1])
        this.content.set('opacity', alpha * this.get('trimTo'))
        return [this.content]
    }
}

export function label3d(content: string | Node, position: Reactive3, options: { size?: number; color?: ColorInput; math?: boolean; offset?: Vec } = {}): Label3D {
    return new Label3D(content, position, options)
}
