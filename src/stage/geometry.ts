/**
 * Vector geometry for the stage engine.
 *
 * Every shape is a list of rings. A ring is a run of cubic Bezier segments in a
 * flat array: [x0, y0, c1x, c1y, c2x, c2y, x1, y1, c1x, ...]. One representation
 * for lines, arcs, glyphs, and imported SVG makes any shape morph into any other.
 *
 * Rings and paths are immutable by convention. Length tables and bounds are
 * cached per ring, so sampling the same geometry on many frames stays cheap.
 */

export type Vec = readonly [number, number]
/** 2x3 affine matrix: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Mat = readonly [number, number, number, number, number, number]

export interface Ring {
    readonly p: Float64Array
    readonly closed: boolean
    /** Every segment is a straight line, so painters can use cheap line commands. */
    readonly straight?: boolean
}

export type Path = readonly Ring[]

export interface Bounds {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]
export const EMPTY_BOUNDS: Bounds = { x: 0, y: 0, width: 0, height: 0 }

const KAPPA = 0.5522847498307936
const LUT_STEPS = 10

export function mul(m: Mat, n: Mat): Mat {
    return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ]
}

export function invert(m: Mat): Mat {
    const det = m[0] * m[3] - m[1] * m[2]
    if (Math.abs(det) < 1e-12) return IDENTITY
    const i = 1 / det
    return [
        m[3] * i, -m[1] * i, -m[2] * i, m[0] * i,
        (m[2] * m[5] - m[3] * m[4]) * i,
        (m[1] * m[4] - m[0] * m[5]) * i,
    ]
}

export function apply(m: Mat, x: number, y: number): [number, number] {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Translate * Rotate * Scale * Translate(-pivot). */
export function compose(x: number, y: number, rotation: number, sx: number, sy: number, px: number, py: number): Mat {
    const cos = rotation === 0 ? 1 : Math.cos(rotation)
    const sin = rotation === 0 ? 0 : Math.sin(rotation)
    const a = cos * sx
    const b = sin * sx
    const c = -sin * sy
    const d = cos * sy
    return [a, b, c, d, x - a * px - c * py, y - b * px - d * py]
}

/** Mean scale of a matrix, used to scale stroke widths with the geometry. */
export function matScale(m: Mat): number {
    return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
}

export function ring(points: ArrayLike<number>, closed = false): Ring {
    return { p: points instanceof Float64Array ? points : Float64Array.from(points as ArrayLike<number>), closed }
}

export function segmentCount(r: Ring): number {
    return Math.max(0, (r.p.length - 2) / 6)
}

function lineInto(out: number[], x0: number, y0: number, x1: number, y1: number): void {
    out.push(x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3, x0 + (x1 - x0) * 2 / 3, y0 + (y1 - y0) * 2 / 3, x1, y1)
}

export function linePath(a: Vec, b: Vec): Path {
    const out = [a[0], a[1]]
    lineInto(out, a[0], a[1], b[0], b[1])
    return [ring(out)]
}

export function polyPath(points: readonly Vec[], closed = false): Path {
    if (points.length === 0) return []
    const first = points[0]!
    const out = [first[0], first[1]]
    for (let i = 1; i < points.length; i++) lineInto(out, points[i - 1]![0], points[i - 1]![1], points[i]![0], points[i]![1])
    if (closed) {
        const last = points[points.length - 1]!
        if (last[0] !== first[0] || last[1] !== first[1]) lineInto(out, last[0], last[1], first[0], first[1])
    }
    return [ring(out, closed)]
}

/** A smooth cubic spline through every point (Catmull-Rom, centripetal-ish tension). */
export function smoothPath(points: readonly Vec[], closed = false, tension = 1 / 6): Path {
    const n = points.length
    if (n === 0) return []
    if (n < 3) return polyPath(points, closed)
    const at = (i: number): Vec => closed ? points[(i + n) % n]! : points[Math.max(0, Math.min(n - 1, i))]!
    const out = [points[0]![0], points[0]![1]]
    const count = closed ? n : n - 1
    for (let i = 0; i < count; i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
        out.push(
            p1[0] + (p2[0] - p0[0]) * tension, p1[1] + (p2[1] - p0[1]) * tension,
            p2[0] - (p3[0] - p1[0]) * tension, p2[1] - (p3[1] - p1[1]) * tension,
            p2[0], p2[1],
        )
    }
    return [ring(out, closed)]
}

/** Elliptical or circular arc, with one cubic per 45 degrees at most. */
export function arcPath(cx: number, cy: number, rx: number, ry: number, from: number, to: number): Path {
    const sweep = to - from
    if (sweep === 0) return []
    const closed = Math.abs(Math.abs(sweep) - Math.PI * 2) < 1e-9
    const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 4) - 1e-9))
    const step = sweep / count
    const k = (4 / 3) * Math.tan(step / 4)
    const out = [cx + Math.cos(from) * rx, cy + Math.sin(from) * ry]
    for (let i = 0; i < count; i++) {
        const a0 = from + i * step, a1 = a0 + step
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1)
        out.push(cx + (c0 - k * s0) * rx, cy + (s0 + k * c0) * ry, cx + (c1 + k * s1) * rx, cy + (s1 - k * c1) * ry, cx + c1 * rx, cy + s1 * ry)
    }
    if (closed) {
        out[out.length - 2] = out[0]!
        out[out.length - 1] = out[1]!
    }
    return [ring(out, closed)]
}

export function circlePath(cx: number, cy: number, r: number): Path {
    return arcPath(cx, cy, r, r, 0, Math.PI * 2)
}

export function rectPath(x: number, y: number, width: number, height: number, radius = 0): Path {
    const r = Math.max(0, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2))
    if (r === 0) return polyPath([[x, y], [x + width, y], [x + width, y + height], [x, y + height]], true)
    const k = r * (1 - KAPPA)
    const right = x + width, bottom = y + height
    const out = [x + r, y]
    lineInto(out, x + r, y, right - r, y)
    out.push(right - k, y, right, y + k, right, y + r)
    lineInto(out, right, y + r, right, bottom - r)
    out.push(right, bottom - k, right - k, bottom, right - r, bottom)
    lineInto(out, right - r, bottom, x + r, bottom)
    out.push(x + k, bottom, x, bottom - k, x, bottom - r)
    lineInto(out, x, bottom - r, x, y + r)
    out.push(x, y + k, x + k, y, x + r, y)
    return [ring(out, true)]
}

/** Smooth open curve through samples of a parametric function. */
export function parametricPath(f: (t: number) => Vec, from: number, to: number, samples = 64): Path {
    const count = Math.max(2, Math.floor(samples))
    const points: Vec[] = []
    for (let i = 0; i <= count; i++) points.push(f(from + (to - from) * i / count))
    return curveThrough(points)
}

/**
 * Hermite fit through samples. Non-finite samples split the curve into separate
 * rings, so poles such as tan(x) leave gaps instead of drawing vertical strokes.
 */
export function curveThrough(points: readonly Vec[]): Path {
    const rings: Ring[] = []
    let run: Vec[] = []
    const flush = () => {
        if (run.length >= 2) rings.push(...smoothPath(run))
        run = []
    }
    for (const point of points) {
        if (Number.isFinite(point[0]) && Number.isFinite(point[1])) run.push(point)
        else flush()
    }
    flush()
    return rings
}

export function concat(...paths: readonly Path[]): Path {
    return paths.flat()
}

export function transformPath(path: Path, m: Mat): Path {
    if (m === IDENTITY) return path
    const out: Ring[] = new Array(path.length)
    for (let r = 0; r < path.length; r++) {
        const src = path[r]!.p
        const dst = new Float64Array(src.length)
        for (let i = 0; i < src.length; i += 2) {
            const x = src[i]!, y = src[i + 1]!
            dst[i] = m[0] * x + m[2] * y + m[4]
            dst[i + 1] = m[1] * x + m[3] * y + m[5]
        }
        out[r] = { p: dst, closed: path[r]!.closed }
    }
    return out
}

/** Deform a path through any point function. Segments split first, so curved maps stay smooth. */
export function warpPath(path: Path, f: (x: number, y: number) => Vec, subdivisions = 4): Path {
    const dense = subdivisions > 1 ? path.map((r) => subdivideEach(r, subdivisions)) : path
    return dense.map((r) => {
        const count = segmentCount(r)
        const anchors: Vec[] = []
        for (let i = 0; i <= count; i++) {
            const mapped = f(r.p[i * 6]!, r.p[i * 6 + 1]!)
            anchors.push(mapped)
        }
        const out = [anchors[0]![0], anchors[0]![1]]
        for (let i = 0; i < count; i++) {
            // Controls map through the same function to keep curvature between anchors.
            const c1 = f(r.p[i * 6 + 2]!, r.p[i * 6 + 3]!)
            const c2 = f(r.p[i * 6 + 4]!, r.p[i * 6 + 5]!)
            out.push(c1[0], c1[1], c2[0], c2[1], anchors[i + 1]![0], anchors[i + 1]![1])
        }
        return ring(out, r.closed)
    })
}

function splitInto(src: ArrayLike<number>, o: number, t: number, left: number[], right: number[]): void {
    const x0 = src[o]!, y0 = src[o + 1]!, x1 = src[o + 2]!, y1 = src[o + 3]!
    const x2 = src[o + 4]!, y2 = src[o + 5]!, x3 = src[o + 6]!, y3 = src[o + 7]!
    const ax = x0 + (x1 - x0) * t, ay = y0 + (y1 - y0) * t
    const bx = x1 + (x2 - x1) * t, by = y1 + (y2 - y1) * t
    const cx = x2 + (x3 - x2) * t, cy = y2 + (y3 - y2) * t
    const dx = ax + (bx - ax) * t, dy = ay + (by - ay) * t
    const ex = bx + (cx - bx) * t, ey = by + (cy - by) * t
    const fx = dx + (ex - dx) * t, fy = dy + (ey - dy) * t
    left.push(ax, ay, dx, dy, fx, fy)
    right.length = 0
    right.push(fx, fy, ex, ey, cx, cy, x3, y3)
}

/** Split every segment of a ring into n equal parameter pieces. Geometry is unchanged. */
export function subdivideEach(r: Ring, n: number): Ring {
    const count = segmentCount(r)
    if (n <= 1 || count === 0) return r
    const out: number[] = [r.p[0]!, r.p[1]!]
    for (let i = 0; i < count; i++) {
        let seg: number[] = Array.from(r.p.subarray(i * 6, i * 6 + 8))
        for (let k = n; k > 1; k--) {
            const rest: number[] = []
            splitInto(seg, 0, 1 / k, out, rest)
            seg = rest
        }
        out.push(seg[2]!, seg[3]!, seg[4]!, seg[5]!, seg[6]!, seg[7]!)
    }
    return ring(out, r.closed)
}

interface RingMeasure {
    /** Cumulative arc length at the end of each segment. */
    total: Float64Array
    /** Per segment: arc length at each of LUT_STEPS parameter steps. */
    lut: Float64Array
    length: number
}

const measures = new WeakMap<Ring, RingMeasure>()

function measure(r: Ring): RingMeasure {
    const cached = measures.get(r)
    if (cached) return cached
    const count = segmentCount(r)
    const total = new Float64Array(count)
    const lut = new Float64Array(count * LUT_STEPS)
    let sum = 0
    const p = r.p
    for (let i = 0; i < count; i++) {
        const o = i * 6
        const x0 = p[o]!, y0 = p[o + 1]!, x1 = p[o + 2]!, y1 = p[o + 3]!, x2 = p[o + 4]!, y2 = p[o + 5]!, x3 = p[o + 6]!, y3 = p[o + 7]!
        let lastX = x0, lastY = y0, acc = 0
        for (let k = 1; k <= LUT_STEPS; k++) {
            const t = k / LUT_STEPS, u = 1 - t
            const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
            const x = a * x0 + b * x1 + c * x2 + d * x3
            const y = a * y0 + b * y1 + c * y2 + d * y3
            acc += Math.hypot(x - lastX, y - lastY)
            lut[i * LUT_STEPS + k - 1] = acc
            lastX = x
            lastY = y
        }
        sum += acc
        total[i] = sum
    }
    const result = { total, lut, length: sum }
    measures.set(r, result)
    return result
}

export function ringLength(r: Ring): number {
    return measure(r).length
}

export function pathLength(path: Path): number {
    let sum = 0
    for (const r of path) sum += measure(r).length
    return sum
}

/** Locate an arc-length distance as a segment index and parameter. */
function locate(m: RingMeasure, distance: number): [number, number] {
    const count = m.total.length
    if (count === 0) return [0, 0]
    if (distance <= 0) return [0, 0]
    if (distance >= m.length) return [count - 1, 1]
    let lo = 0, hi = count - 1
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (m.total[mid]! < distance) lo = mid + 1
        else hi = mid
    }
    const before = lo === 0 ? 0 : m.total[lo - 1]!
    const local = distance - before
    const base = lo * LUT_STEPS
    let k = 0
    while (k < LUT_STEPS - 1 && m.lut[base + k]! < local) k++
    const start = k === 0 ? 0 : m.lut[base + k - 1]!
    const end = m.lut[base + k]!
    const fraction = end > start ? (local - start) / (end - start) : 0
    return [lo, (k + fraction) / LUT_STEPS]
}

/** Keep the part of a ring between two arc-length fractions. */
export function trimRing(r: Ring, from: number, to: number): Ring | null {
    const count = segmentCount(r)
    if (count === 0) return null
    const a = Math.max(0, Math.min(1, from))
    const b = Math.max(0, Math.min(1, to))
    if (b <= a) return null
    if (a === 0 && b === 1) return r
    const m = measure(r)
    if (m.length === 0) return null
    const [i0, t0] = locate(m, a * m.length)
    const [i1, t1] = locate(m, b * m.length)
    const out: number[] = []
    for (let i = i0; i <= i1; i++) {
        let seg: number[] = Array.from(r.p.subarray(i * 6, i * 6 + 8))
        const start = i === i0 ? t0 : 0
        const end = i === i1 ? t1 : 1
        if (start > 0) {
            const rest: number[] = []
            splitInto(seg, 0, start, [], rest)
            seg = rest
        }
        if (end < 1) {
            const left: number[] = []
            const rest: number[] = []
            const scaled = start > 0 ? (end - start) / (1 - start) : end
            splitInto(seg, 0, scaled, left, rest)
            seg = [seg[0]!, seg[1]!, ...left]
        }
        if (out.length === 0) out.push(seg[0]!, seg[1]!)
        out.push(seg[2]!, seg[3]!, seg[4]!, seg[5]!, seg[6]!, seg[7]!)
    }
    return ring(out, false)
}

/**
 * Keep a fraction of a path. With `each`, every ring draws at once, which suits
 * glyphs. Without it, rings draw one after another along the total length.
 */
export function trimPath(path: Path, from: number, to: number, each = false): Path {
    if (from <= 0 && to >= 1) return path
    const out: Ring[] = []
    if (each) {
        for (const r of path) {
            const piece = trimRing(r, from, to)
            if (piece) out.push(piece)
        }
        return out
    }
    const total = pathLength(path)
    if (total === 0) return []
    let travelled = 0
    for (const r of path) {
        const length = ringLength(r)
        const start = (from * total - travelled) / (length || 1)
        const end = (to * total - travelled) / (length || 1)
        travelled += length
        if (end <= 0 || start >= 1) continue
        const piece = trimRing(r, Math.max(0, start), Math.min(1, end))
        if (piece) out.push(piece)
    }
    return out
}

/** Point at an arc-length fraction of a path, in the path's own coordinates. */
export function pointAt(path: Path, fraction: number): [number, number] {
    const total = pathLength(path)
    if (total === 0) {
        const first = path[0]?.p
        return first ? [first[0]!, first[1]!] : [0, 0]
    }
    let remaining = Math.max(0, Math.min(1, fraction)) * total
    for (let i = 0; i < path.length; i++) {
        const r = path[i]!
        const length = ringLength(r)
        if (remaining <= length || i === path.length - 1) {
            const [segment, t] = locate(measure(r), remaining)
            return evaluate(r.p, segment * 6, t)
        }
        remaining -= length
    }
    return [0, 0]
}

/** Unit tangent at an arc-length fraction, in the path's own coordinates. */
export function tangentAt(path: Path, fraction: number): [number, number] {
    const delta = 0.002
    const a = pointAt(path, Math.max(0, fraction - delta))
    const b = pointAt(path, Math.min(1, fraction + delta))
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
}

function evaluate(p: ArrayLike<number>, o: number, t: number): [number, number] {
    const u = 1 - t
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
    return [
        a * p[o]! + b * p[o + 2]! + c * p[o + 4]! + d * p[o + 6]!,
        a * p[o + 1]! + b * p[o + 3]! + c * p[o + 5]! + d * p[o + 7]!,
    ]
}

function extendCubicAxis(range: [number, number], p0: number, p1: number, p2: number, p3: number): void {
    range[0] = Math.min(range[0], p0, p3)
    range[1] = Math.max(range[1], p0, p3)
    if (p1 >= range[0] && p1 <= range[1] && p2 >= range[0] && p2 <= range[1]) return
    const a = -p0 + 3 * p1 - 3 * p2 + p3
    const b = 2 * (p0 - 2 * p1 + p2)
    const c = p1 - p0
    const roots: number[] = []
    if (Math.abs(a) < 1e-9) {
        if (Math.abs(b) > 1e-9) roots.push(-c / b)
    } else {
        const disc = b * b - 4 * a * c
        if (disc >= 0) {
            const s = Math.sqrt(disc)
            roots.push((-b + s) / (2 * a), (-b - s) / (2 * a))
        }
    }
    for (const t of roots) {
        if (t <= 0 || t >= 1) continue
        const u = 1 - t
        const value = u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
        range[0] = Math.min(range[0], value)
        range[1] = Math.max(range[1], value)
    }
}

const ringBounds = new WeakMap<Ring, Bounds>()

function boundsOfRing(r: Ring): Bounds {
    const cached = ringBounds.get(r)
    if (cached) return cached
    const p = r.p
    if (p.length < 2) return EMPTY_BOUNDS
    const xs: [number, number] = [p[0]!, p[0]!]
    const ys: [number, number] = [p[1]!, p[1]!]
    for (let o = 0; o + 7 < p.length; o += 6) {
        extendCubicAxis(xs, p[o]!, p[o + 2]!, p[o + 4]!, p[o + 6]!)
        extendCubicAxis(ys, p[o + 1]!, p[o + 3]!, p[o + 5]!, p[o + 7]!)
    }
    const bounds = { x: xs[0], y: ys[0], width: xs[1] - xs[0], height: ys[1] - ys[0] }
    ringBounds.set(r, bounds)
    return bounds
}

export function pathBounds(path: Path): Bounds | null {
    if (path.length === 0) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const r of path) {
        if (r.p.length < 2) continue
        const b = boundsOfRing(r)
        minX = Math.min(minX, b.x)
        minY = Math.min(minY, b.y)
        maxX = Math.max(maxX, b.x + b.width)
        maxY = Math.max(maxY, b.y + b.height)
    }
    if (minX === Infinity) return null
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
    if (!a) return b
    if (!b) return a
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/** Shoelace area over the anchors. The sign gives the winding direction. */
export function signedArea(r: Ring): number {
    const p = r.p
    let sum = 0
    for (let o = 0; o + 7 < p.length; o += 6) {
        sum += p[o]! * p[o + 7]! - p[o + 6]! * p[o + 1]!
    }
    return sum / 2
}

export function ringCenter(r: Ring): [number, number] {
    const b = boundsOfRing(r)
    return [b.x + b.width / 2, b.y + b.height / 2]
}

export function reverseRing(r: Ring): Ring {
    const p = r.p
    const out = new Float64Array(p.length)
    for (let i = 0; i < p.length; i += 2) {
        out[i] = p[p.length - 2 - i]!
        out[i + 1] = p[p.length - 1 - i]!
    }
    return { p: out, closed: r.closed }
}

/** Parse SVG path data, including arcs and relative commands, into cubic rings. */
export function parseSvgPath(d: string): Path {
    const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)
    if (!tokens) return []
    const rings: Ring[] = []
    let out: number[] = []
    let i = 0, x = 0, y = 0, startX = 0, startY = 0
    let lastCmd = '', lastCx = 0, lastCy = 0
    const num = () => Number(tokens[i++])
    const flags = (): number => {
        // Arc flags can run together with the next number, such as "a1 1 0 00.5 .5".
        const token = tokens[i]!
        if (token.length > 1 && (token[0] === '0' || token[0] === '1') && !token.startsWith('0.') && !token.startsWith('1.')) {
            tokens[i] = token.slice(1)
            return Number(token[0])
        }
        i++
        return Number(token)
    }
    const flush = (closed: boolean) => {
        if (out.length >= 8) rings.push(ring(out, closed))
        out = []
    }
    const begin = (px: number, py: number) => {
        if (out.length === 0) out.push(px, py)
    }
    let cmd = ''
    while (i < tokens.length) {
        const token = tokens[i]!
        if (/^[a-zA-Z]$/.test(token)) {
            cmd = token
            i++
        } else if (cmd === 'M') {
            cmd = 'L'
        } else if (cmd === 'm') {
            cmd = 'l'
        } else if (cmd === '' ) {
            throw new Error(`Invalid SVG path data: ${d.slice(0, 40)}`)
        }
        const rel = cmd >= 'a'
        switch (cmd.toUpperCase()) {
            case 'M': {
                flush(false)
                x = (rel ? x : 0) + num()
                y = (rel ? y : 0) + num()
                startX = x
                startY = y
                out.push(x, y)
                break
            }
            case 'L': {
                const nx = (rel ? x : 0) + num(), ny = (rel ? y : 0) + num()
                begin(x, y)
                lineInto(out, x, y, nx, ny)
                x = nx
                y = ny
                break
            }
            case 'H': {
                const nx = (rel ? x : 0) + num()
                begin(x, y)
                lineInto(out, x, y, nx, y)
                x = nx
                break
            }
            case 'V': {
                const ny = (rel ? y : 0) + num()
                begin(x, y)
                lineInto(out, x, y, x, ny)
                y = ny
                break
            }
            case 'C': {
                const ox = rel ? x : 0, oy = rel ? y : 0
                const c1x = ox + num(), c1y = oy + num(), c2x = ox + num(), c2y = oy + num(), nx = ox + num(), ny = oy + num()
                begin(x, y)
                out.push(c1x, c1y, c2x, c2y, nx, ny)
                lastCx = c2x
                lastCy = c2y
                x = nx
                y = ny
                break
            }
            case 'S': {
                const ox = rel ? x : 0, oy = rel ? y : 0
                const smooth = 'CScs'.includes(lastCmd)
                const c1x = smooth ? 2 * x - lastCx : x, c1y = smooth ? 2 * y - lastCy : y
                const c2x = ox + num(), c2y = oy + num(), nx = ox + num(), ny = oy + num()
                begin(x, y)
                out.push(c1x, c1y, c2x, c2y, nx, ny)
                lastCx = c2x
                lastCy = c2y
                x = nx
                y = ny
                break
            }
            case 'Q': {
                const ox = rel ? x : 0, oy = rel ? y : 0
                const qx = ox + num(), qy = oy + num(), nx = ox + num(), ny = oy + num()
                begin(x, y)
                out.push(x + (qx - x) * 2 / 3, y + (qy - y) * 2 / 3, nx + (qx - nx) * 2 / 3, ny + (qy - ny) * 2 / 3, nx, ny)
                lastCx = qx
                lastCy = qy
                x = nx
                y = ny
                break
            }
            case 'T': {
                const ox = rel ? x : 0, oy = rel ? y : 0
                const smooth = 'QTqt'.includes(lastCmd)
                const qx = smooth ? 2 * x - lastCx : x, qy = smooth ? 2 * y - lastCy : y
                const nx = ox + num(), ny = oy + num()
                begin(x, y)
                out.push(x + (qx - x) * 2 / 3, y + (qy - y) * 2 / 3, nx + (qx - nx) * 2 / 3, ny + (qy - ny) * 2 / 3, nx, ny)
                lastCx = qx
                lastCy = qy
                x = nx
                y = ny
                break
            }
            case 'A': {
                const rx = num(), ry = num(), angle = num(), large = flags(), sweep = flags()
                const nx = (rel ? x : 0) + num(), ny = (rel ? y : 0) + num()
                begin(x, y)
                arcInto(out, x, y, rx, ry, angle, large === 1, sweep === 1, nx, ny)
                x = nx
                y = ny
                break
            }
            case 'Z': {
                if (out.length > 0) {
                    if (x !== startX || y !== startY) lineInto(out, x, y, startX, startY)
                    flush(true)
                }
                x = startX
                y = startY
                break
            }
            default:
                throw new Error(`Unsupported SVG path command: ${cmd}`)
        }
        lastCmd = cmd
    }
    flush(false)
    return rings
}

function arcInto(out: number[], x0: number, y0: number, rxIn: number, ryIn: number, degrees: number, large: boolean, sweep: boolean, x1: number, y1: number): void {
    let rx = Math.abs(rxIn), ry = Math.abs(ryIn)
    if (rx === 0 || ry === 0 || (x0 === x1 && y0 === y1)) {
        lineInto(out, x0, y0, x1, y1)
        return
    }
    const phi = degrees * Math.PI / 180
    const cos = Math.cos(phi), sin = Math.sin(phi)
    const dx = (x0 - x1) / 2, dy = (y0 - y1) / 2
    const xp = cos * dx + sin * dy, yp = -sin * dx + cos * dy
    const lambda = xp * xp / (rx * rx) + yp * yp / (ry * ry)
    if (lambda > 1) {
        const scale = Math.sqrt(lambda)
        rx *= scale
        ry *= scale
    }
    const numerator = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp
    const denominator = rx * rx * yp * yp + ry * ry * xp * xp
    const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator))
    const cxp = factor * rx * yp / ry, cyp = -factor * ry * xp / rx
    const cx = cos * cxp - sin * cyp + (x0 + x1) / 2
    const cy = sin * cxp + cos * cyp + (y0 + y1) / 2
    const start = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx)
    let delta = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - start
    if (sweep && delta < 0) delta += Math.PI * 2
    if (!sweep && delta > 0) delta -= Math.PI * 2
    const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9))
    const step = delta / count
    const k = (4 / 3) * Math.tan(step / 4)
    for (let i = 0; i < count; i++) {
        const a0 = start + i * step, a1 = a0 + step
        const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1)
        const q1x = (c0 - k * s0) * rx, q1y = (s0 + k * c0) * ry
        const q2x = (c1 + k * s1) * rx, q2y = (s1 - k * c1) * ry
        const ex = c1 * rx, ey = s1 * ry
        out.push(
            cos * q1x - sin * q1y + cx, sin * q1x + cos * q1y + cy,
            cos * q2x - sin * q2y + cx, sin * q2x + cos * q2y + cy,
            i === count - 1 ? x1 : cos * ex - sin * ey + cx,
            i === count - 1 ? y1 : sin * ex + cos * ey + cy,
        )
    }
}

function fmt(value: number): string {
    const rounded = Math.round(value * 100) / 100
    return rounded === 0 ? '0' : String(rounded)
}

/** Serialize a path to compact SVG path data. */
export function pathToD(path: Path): string {
    const parts: string[] = []
    for (const r of path) {
        const p = r.p
        if (p.length < 2) continue
        parts.push('M', fmt(p[0]!), ' ', fmt(p[1]!))
        if (r.straight) {
            for (let o = 2; o + 5 < p.length; o += 6) parts.push('L', fmt(p[o + 4]!), ' ', fmt(p[o + 5]!))
            if (r.closed) parts.push('Z')
            continue
        }
        for (let o = 2; o + 5 < p.length; o += 6) {
            parts.push('C', fmt(p[o]!), ' ', fmt(p[o + 1]!), ' ', fmt(p[o + 2]!), ' ', fmt(p[o + 3]!), ' ', fmt(p[o + 4]!), ' ', fmt(p[o + 5]!))
        }
        if (r.closed) parts.push('Z')
    }
    return parts.join('')
}
