import { toPaint, type ColorInput, type Rgba } from '../color'
import { polyPath, type Vec } from '../geometry'
import { solidColor } from '../objects/util'
import { Object3D, type Vec3, type View3D } from './index'

export type ScalarField3D = (x: number, y: number, z: number) => number

export interface IsosurfaceOptions {
    x: readonly [number, number]
    y: readonly [number, number]
    z: readonly [number, number]
    level?: number
    /** Grid cells per axis, from 1 to 64. Defaults to 24. At most 100,000 triangles. */
    resolution?: number | readonly [number, number, number]
    color?: ColorInput
    opacity?: number
    shaded?: boolean
    /** Defaults to false, so open surfaces and translucent shells show both sides. */
    cull?: boolean
    /** Increasing points out of f < level. Use decreasing for density lobes f > level. */
    normals?: 'increasing' | 'decreasing'
    mesh?: ColorInput | false
    meshOpacity?: number
    meshWidth?: number
}

export interface IsosurfaceGeometry {
    readonly positions: readonly Vec3[]
    readonly triangles: readonly (readonly [number, number, number])[]
    /** Smooth unit normals at shared vertices, oriented as specified by `normals`. */
    readonly normals: readonly Vec3[]
}

// Every cube uses the same body diagonal and face diagonals. Adjacent cells
// therefore agree even on ambiguous saddle faces, unlike naive marching cubes.
const TETRAHEDRA = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]] as const
const MAX_TRIANGLES = 100_000

function unit(x: number, y: number, z: number): Vec3 {
    const length = Math.hypot(x, y, z) || 1
    return [x / length, y / length, z / length]
}

/**
 * A static, cached marching-tetrahedra mesh. The field must be pure and finite
 * throughout the box. The grid approximates the level set linearly and does not
 * cap surfaces that meet the box. Features smaller than a grid cell may be lost.
 */
export class Isosurface3D extends Object3D {
    private readonly ranges: readonly (readonly number[])[]
    private readonly resolution: readonly number[]
    private readonly options: IsosurfaceOptions
    private cached: IsosurfaceGeometry | null = null
    private faceNormals: Vec3[] = []
    private shadingNormals: Vec3[] = []
    private screen = new Float64Array(0)
    private valid = new Uint8Array(0)

    constructor(private readonly field: ScalarField3D, options: IsosurfaceOptions) {
        super()
        this.options = { ...options }
        this.ranges = [options.x, options.y, options.z].map((range) => {
            if (!range || range.length !== 2 || !range.every(Number.isFinite) || !(range[1] > range[0]) || !Number.isFinite(range[1] - range[0])) {
                throw new RangeError('isosurface: x, y and z must be finite increasing ranges')
            }
            return [...range]
        })
        const resolution = options.resolution ?? 24
        this.resolution = typeof resolution === 'number' ? [resolution, resolution, resolution] : [...resolution]
        if (this.resolution.length !== 3 || !this.resolution.every((n) => Number.isInteger(n) && n >= 1 && n <= 64)) {
            throw new RangeError('isosurface: resolution must contain integers from 1 to 64')
        }
        if (!Number.isFinite(options.level ?? 0)) throw new RangeError('isosurface: level must be finite')
        this.base.fill = toPaint(options.color ?? 'blue')
    }

    /** Frozen geometry, computed once on first access or render. No camera-dependent sampling. */
    get geometry(): IsosurfaceGeometry {
        if (!this.cached) this.cached = this.compute()
        return this.cached
    }

    private compute(): IsosurfaceGeometry {
        const [nx, ny, nz] = this.resolution, sy = nz + 1, sx = (ny + 1) * sy
        const size = (nx + 1) * sx, level = this.options.level ?? 0
        const axes = this.ranges.map(([lo, hi], axis) => {
            const n = this.resolution[axis]
            const values = Array.from({ length: n + 1 }, (_, i) => lo + (hi - lo) * (i / n))
            if (values.some((value, i) => i > 0 && value <= values[i - 1])) {
                throw new RangeError('isosurface: range is too small for resolution at this coordinate magnitude')
            }
            return values
        })
        const values = new Float64Array(size)
        for (let i = 0; i <= nx; i++) {
            for (let j = 0; j <= ny; j++) {
                for (let k = 0; k <= nz; k++) {
                    const value = this.field(axes[0][i], axes[1][j], axes[2][k])
                    if (!Number.isFinite(value)) {
                        throw new RangeError(`isosurface: field must be finite at (${axes[0][i]}, ${axes[1][j]}, ${axes[2][k]})`)
                    }
                    values[i * sx + j * sy + k] = value
                }
            }
        }

        const positions: Vec3[] = [], triangles: [number, number, number][] = []
        const normalSums: [number, number, number][] = [], faceNormals: Vec3[] = []
        const edges = new Map<number, number>()
        const direction = this.options.normals === 'decreasing' ? -1 : 1
        const coordinate = (id: number): Vec3 => [axes[0][Math.floor(id / sx)], axes[1][Math.floor(id % sx / sy)], axes[2][id % sy]]
        const edge = (a: number, b: number): number => {
            if (a > b) [a, b] = [b, a]
            const fa = values[a], fb = values[b]
            let da = fa - level, db = fb - level
            if (!Number.isFinite(da) || !Number.isFinite(db)) {
                const scale = Math.max(Math.abs(fa), Math.abs(fb), Math.abs(level))
                da = fa / scale - level / scale
                db = fb / scale - level / scale
            }
            const scale = Math.max(Math.abs(da), Math.abs(db))
            const t = -(da / scale) / (db / scale - da / scale)
            // Exact grid-vertex hits must share one vertex across *all* incident edges.
            const key = t === 0 ? -a - 1 : t === 1 ? -b - 1 : a * size + b
            const existing = edges.get(key)
            if (existing !== undefined) return existing
            const p = coordinate(a), q = coordinate(b)
            const index = positions.length
            positions.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t])
            normalSums.push([0, 0, 0])
            edges.set(key, index)
            return index
        }
        const cellScale = Math.max(...this.ranges.map(([lo, hi], axis) => (hi - lo) / this.resolution[axis]))
        const triangle = (a: number, b: number, c: number, towards: Vec3): void => {
            if (a === b || b === c || a === c) return
            const p = positions[a], q = positions[b], r = positions[c]
            const ex = (q[0] - p[0]) / cellScale, ey = (q[1] - p[1]) / cellScale, ez = (q[2] - p[2]) / cellScale
            const fx = (r[0] - p[0]) / cellScale, fy = (r[1] - p[1]) / cellScale, fz = (r[2] - p[2]) / cellScale
            let x = ey * fz - ez * fy, y = ez * fx - ex * fz, z = ex * fy - ey * fx
            if (Math.hypot(x, y, z) === 0) return
            if ((x * towards[0] + y * towards[1] + z * towards[2]) * direction < 0) {
                [b, c] = [c, b]
                x = -x
                y = -y
                z = -z
            }
            if (triangles.length >= MAX_TRIANGLES) throw new RangeError('isosurface: triangle budget exceeded (100,000); reduce resolution')
            triangles.push([a, b, c])
            faceNormals.push(unit(x, y, z))
            for (const id of [a, b, c]) {
                normalSums[id][0] += x
                normalSums[id][1] += y
                normalSums[id][2] += z
            }
        }
        for (let i = 0; i < nx; i++) {
            for (let j = 0; j < ny; j++) {
                for (let k = 0; k < nz; k++) {
                    const a = i * sx + j * sy + k
                    const cube = [a, a + sx, a + sx + sy, a + sy, a + 1, a + sx + 1, a + sx + sy + 1, a + sy + 1]
                    const inside = cube.map((id) => values[id] < level)
                    if (inside.every(Boolean) || inside.every((v) => !v)) continue
                    for (const tetra of TETRAHEDRA) {
                        const low: number[] = [], high: number[] = []
                        for (const corner of tetra) (inside[corner] ? low : high).push(cube[corner])
                        if (!low.length || !high.length) continue
                        const p = coordinate(low[0]), q = coordinate(high[0])
                        const towards: Vec3 = [(q[0] - p[0]) / cellScale, (q[1] - p[1]) / cellScale, (q[2] - p[2]) / cellScale]
                        if (low.length === 1 || high.length === 1) {
                            const single = low.length === 1 ? low : high, other = low.length === 1 ? high : low
                            triangle(edge(single[0], other[0]), edge(single[0], other[1]), edge(single[0], other[2]), towards)
                        } else {
                            const v0 = edge(low[0], high[0]), v1 = edge(low[0], high[1])
                            const v2 = edge(low[1], high[1]), v3 = edge(low[1], high[0])
                            triangle(v0, v1, v2, towards)
                            triangle(v0, v2, v3, towards)
                        }
                    }
                }
            }
        }
        const normals = normalSums.map(([x, y, z]) => Object.freeze(unit(x, y, z)))
        this.faceNormals = faceNormals
        this.shadingNormals = triangles.map(([a, b, c]) => unit(
            normals[a][0] + normals[b][0] + normals[c][0],
            normals[a][1] + normals[b][1] + normals[c][1],
            normals[a][2] + normals[b][2] + normals[c][2],
        ))
        this.screen = new Float64Array(positions.length * 3)
        this.valid = new Uint8Array(positions.length)
        return Object.freeze({
            positions: Object.freeze(positions.map((p) => Object.freeze(p))),
            triangles: Object.freeze(triangles.map((t) => Object.freeze(t))),
            normals: Object.freeze(normals),
        })
    }

    emit(view: View3D, _time: number): void {
        const base = this.get('fill')
        const rgb: Rgba = base ? solidColor(base) : [90, 180, 240, 1]
        const alpha = this.objectAlpha(view) * (this.options.opacity ?? 1) * this.get('fillOpacity') * rgb[3]
        if (alpha <= 0.002) return
        const { positions, triangles } = this.geometry
        const { screen, valid } = this
        positions.forEach(([x, y, z], i) => {
            valid[i] = Number(view.project(x, y, z))
            screen[i * 3] = view.px
            screen[i * 3 + 1] = view.py
            screen[i * 3 + 2] = view.pz
        })
        const mesh = this.options.mesh ? solidColor(this.options.mesh) : null
        const reveal = view.measuring ? 1 : Math.max(0, Math.min(1, this.get('trimTo')))
        const count = Math.ceil(triangles.length * reveal)
        for (let i = 0; i < count; i++) {
            const ids = triangles[i], points = ids.map((id) => positions[id])
            const center = [0, 1, 2].map((axis) => points[0][axis] / 3 + points[1][axis] / 3 + points[2][axis] / 3)
            const towardCamera = view.perspective
                ? unit(view.dx + (view.fx - center[0]) / view.distance, view.dy + (view.fy - center[1]) / view.distance, view.dz + (view.fz - center[2]) / view.distance)
                : [view.dx, view.dy, view.dz]
            const normal = this.faceNormals[i]
            const facing = normal[0] * towardCamera[0] + normal[1] * towardCamera[1] + normal[2] * towardCamera[2]
            if (this.options.cull && facing <= 0) continue
            const projected: Vec[] = []
            let depth = 0
            if (ids.every((id) => valid[id])) {
                for (const id of ids) {
                    projected.push([screen[id * 3], screen[id * 3 + 1]])
                    depth += screen[id * 3 + 2] / 3
                }
            } else {
                // Clip straddling triangles at the same near plane used by View3D.
                // Dropping the whole triangle would leave holes as the camera moves.
                const near = view.distance - 0.050001
                const z = (p: Vec3): number => (p[0] - view.fx) * view.dx + (p[1] - view.fy) * view.dy + (p[2] - view.fz) * view.dz
                const clipped: Vec3[] = []
                for (let j = 0; j < 3; j++) {
                    const p = points[j], q = points[(j + 1) % 3], pz = z(p), qz = z(q)
                    if (pz <= near) clipped.push(p)
                    if ((pz <= near) !== (qz <= near)) {
                        const t = (near - pz) / (qz - pz)
                        clipped.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])])
                    }
                }
                if (clipped.length < 3) continue
                for (const p of clipped) {
                    if (!view.project(...p)) break
                    projected.push([view.px, view.py])
                    depth += view.pz / clipped.length
                }
                if (projected.length !== clipped.length) continue
            }
            const flip = facing < 0 ? -1 : 1, n = this.shadingNormals[i]
            const lit = this.options.shaded === false ? rgb : view.shaded([n[0] * flip, n[1] * flip, n[2] * flip], rgb)
            const color = view.fogged(lit[0], lit[1], lit[2], depth)
            let painted = projected
            if (alpha >= 0.995 && !mesh) {
                // Offset each edge, with beveled corners to bound the expansion
                // even at acute tips. This covers raster seams without a stroke
                // pass or the unbounded spikes of a miter. Alpha faces stay exact.
                const area = projected.reduce((sum, p, j) => {
                    const q = projected[(j + 1) % projected.length]
                    return sum + p[0] * q[1] - p[1] * q[0]
                }, 0)
                const pad = (area < 0 ? -1 : 1) * 0.55 * view.scale
                const offsets = projected.map((p, j) => {
                    const q = projected[(j + 1) % projected.length], dx = q[0] - p[0], dy = q[1] - p[1]
                    const length = Math.hypot(dx, dy) || 1
                    return [dy / length * pad, -dx / length * pad]
                })
                painted = projected.flatMap(([x, y], j): Vec[] => {
                    const before = offsets[(j + offsets.length - 1) % offsets.length], after = offsets[j]
                    return [[x + before[0], y + before[1]], [x + after[0], y + after[1]]]
                })
            }
            const path = polyPath(painted, true).map((ring) => ({ ...ring, straight: true }))
            view.push({
                kind: 'path', path, strokePath: path, fill: color, fillAlpha: alpha,
                stroke: mesh, strokeAlpha: alpha * (this.options.meshOpacity ?? 0.35) * (mesh?.[3] ?? 1),
                strokeWidth: (this.options.meshWidth ?? 1) * view.scale,
                cap: 'round', join: 'round', dash: null, dashOffset: 0, glow: 0, glowColor: null, blend: 'normal',
            }, depth)
        }
    }
}

/** Extract f(x, y, z) = level in a finite box as a cached CPU vector mesh. */
export function isosurface(field: ScalarField3D, options: IsosurfaceOptions): Isosurface3D {
    return new Isosurface3D(field, options)
}
