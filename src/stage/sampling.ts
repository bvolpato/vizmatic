import { polyPath, type Path, type Ring, type Vec } from './geometry'

export interface AdaptiveSampling {
    /** Maximum sampled deviation from a straight chord in pixels. Axes include their current transform; parametric curves use local pixels before later transforms. Defaults to 0.75. */
    tolerance?: number
    /** Refinement depth per initial interval. Defaults to 12, at most 24. */
    maxDepth?: number
    /** Maximum function evaluations per path. Defaults to 20000. Unresolved intervals are left open. */
    maxSamples?: number
    /** Break unresolved finite jumps larger than this many pixels in the same measurement space. Defaults to 8. */
    jumpThreshold?: number
}

/** Internal mapping from the curve parameter to the coordinate used for subdivision. */
interface SamplingSpace {
    parameter?: { map: (value: number) => number; invert: (value: number) => number }
    measure?: (point: Vec) => Vec
    clipY?: readonly [number, number]
    name?: string
}

export function continuousSpans(from: number, to: number, excluded: readonly (readonly [number, number])[] = [], name = 'plot'): [number, number][] {
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error(`${name}: from and to must be finite`)
    if (from > to) return continuousSpans(to, from, excluded, name).reverse().map(([a, b]) => [b, a])
    const gaps = excluded.map((gap) => {
        if (gap.length !== 2 || !gap.every(Number.isFinite) || gap[1] < gap[0]) throw new Error(`${name}: discontinuities must be finite [from, to] intervals in increasing order`)
        return gap
    }).sort((a, b) => a[0] - b[0])
    const nudge = (x: number, direction: number) => x + direction * Math.max(Number.MIN_VALUE, Math.abs(x) * Number.EPSILON, (to - from) * Number.EPSILON)
    const spans: [number, number][] = []
    let start = from
    for (const [low, high] of gaps) {
        if (high < start || low > to) continue
        const end = nudge(low, -1)
        if (end > start) spans.push([start, Math.min(to, end)])
        start = Math.max(start, nudge(high, 1))
        if (start >= to) break
    }
    if (to > start) spans.push([start, to])
    return spans
}

/** Shared adaptive polylines, with gaps for nonfinite samples and unresolved jumps. */
export function adaptivePath(f: (parameter: number) => Vec, spans: readonly (readonly [number, number])[], samples: number, options: AdaptiveSampling, space: SamplingSpace = {}): Path {
    const tolerance = options.tolerance ?? 0.75, maxDepth = options.maxDepth ?? 12
    const maxSamples = options.maxSamples ?? 20000, jump = options.jumpThreshold ?? 8
    const { parameter, measure = (point: Vec) => point, clipY, name = 'plot' } = space
    if (!Number.isInteger(samples) || samples < 1 || samples > 100000) throw new Error(`${name}: samples must be an integer from 1 to 100000`)
    if (!(tolerance > 0) || !Number.isFinite(tolerance)) throw new Error(`${name}: adaptive tolerance must be finite and greater than 0`)
    if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 24) throw new Error(`${name}: adaptive maxDepth must be an integer from 0 to 24`)
    if (!Number.isInteger(maxSamples) || maxSamples < 5) throw new Error(`${name}: adaptive maxSamples must be an integer of at least 5`)
    if (!(jump > 0) || !Number.isFinite(jump)) throw new Error(`${name}: adaptive jumpThreshold must be finite and greater than 0`)
    const paths: Ring[] = []
    let run: Vec[] = [], evaluated = 0
    const flush = () => { if (run.length > 1) paths.push(...polyPath(run)); run = [] }
    // Clip accepted chords, so a steep continuous curve reaches the plot boundary exactly.
    const segment = (a: Vec, b: Vec) => {
        let low = 0, high = 1
        const dy = b[1] - a[1]
        if (clipY) {
            if (dy === 0) { if (a[1] < clipY[0] || a[1] > clipY[1]) { flush(); return } }
            else {
                const first = (clipY[0] - a[1]) / dy, last = (clipY[1] - a[1]) / dy
                low = Math.max(0, Math.min(first, last)); high = Math.min(1, Math.max(first, last))
                if (low >= high) { flush(); return }
            }
        }
        const at = (t: number): Vec => t === 0 ? a : t === 1 ? b : [a[0] + t * (b[0] - a[0]), a[1] + t * dy]
        const start = at(low), end = at(high), previous = run[run.length - 1]
        if (!previous || previous[0] !== start[0] || previous[1] !== start[1]) { flush(); run.push(start) }
        run.push(end)
        if (high < 1) flush()
    }
    for (const [from, to] of spans) {
        const left = parameter ? parameter.map(from) : from, right = parameter ? parameter.map(to) : to
        if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error(`${name}: adaptive endpoints must be in the scale domain`)
        const cache = new Map<number, Vec | null>()
        const sample = (u: number): Vec | null => {
            if (cache.has(u)) return cache.get(u)!
            if (evaluated >= maxSamples) return null
            const value = u === left ? from : u === right ? to : Math.max(Math.min(from, to), Math.min(Math.max(from, to), parameter ? parameter.invert(u) : u))
            evaluated++
            const point = f(value)
            const valid = point.every(Number.isFinite) ? point : null
            cache.set(u, valid)
            return valid
        }
        const refine = (a: number, b: number, depth: number): void => {
            const positions = [a, a + (b - a) / 4, a + (b - a) / 2, a + (b - a) * 0.75, b]
            const points = positions.map(sample)
            if (points.every((p) => p === null)) { flush(); return }
            if (points.some((p) => p === null)) {
                if (depth < maxDepth && evaluated < maxSamples) {
                    refine(a, positions[2], depth + 1); refine(positions[2], b, depth + 1)
                } else flush()
                return
            }
            const local = points as Vec[], screen = local.map(measure)
            const start = screen[0], end = screen[4]
            const error = Math.max(...screen.slice(1, 4).map((p, i) => {
                const t = (i + 1) / 4
                return Math.hypot(p[0] - (start[0] + (end[0] - start[0]) * t), p[1] - (start[1] + (end[1] - start[1]) * t))
            }))
            if (error <= tolerance) { segment(local[0], local[4]); return }
            if (depth < maxDepth && evaluated < maxSamples) {
                refine(a, positions[2], depth + 1); refine(positions[2], b, depth + 1)
            } else if (evaluated >= maxSamples) flush()
            else {
                // An unresolved finite jump is a gap, not a vertical stroke. Small residuals keep their samples.
                for (let i = 1; i < local.length; i++) {
                    if (Math.hypot(screen[i][0] - screen[i - 1][0], screen[i][1] - screen[i - 1][1]) > jump) flush()
                    else segment(local[i - 1], local[i])
                }
            }
        }
        for (let i = 0; i < samples && evaluated < maxSamples; i++) refine(left + (right - left) * (i / samples), i === samples - 1 ? right : left + (right - left) * ((i + 1) / samples), 0)
        flush()
    }
    return paths
}
