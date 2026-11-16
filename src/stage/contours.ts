import type { Vec } from './geometry'

export interface ContourOptions {
    x: readonly [number, number]
    y: readonly [number, number]
    levels: readonly number[]
    /** Cells per axis, or [x cells, y cells]. Defaults to 64. At most one million grid vertices. */
    resolution?: number | readonly [number, number]
}

export interface ContourLevel {
    level: number
    /** Connected polylines in data coordinates. A closed path repeats its first point. */
    paths: Vec[][]
}

interface Vertex { id: string; point: Vec }

/**
 * Marching squares with linear edge interpolation and the bilinear asymptotic decider.
 * Samples the field once per grid vertex for all levels. Cells touching a nonfinite sample
 * are holes. Equality belongs to the high side; a constant cell emits no contour.
 * Exact bilinear saddles retain two crossing paths rather than choosing an arbitrary diagonal.
 */
export function contourPaths(field: (x: number, y: number) => number, options: ContourOptions): ContourLevel[] {
    for (const axis of ['x', 'y'] as const) {
        const range = options[axis]
        if (range.length !== 2 || !range.every(Number.isFinite) || !(range[1] > range[0]) || !Number.isFinite(range[1] - range[0])) throw new Error(`contourPaths: ${axis} must have two finite increasing ends with a finite span`)
    }
    if (options.levels.some((v) => !Number.isFinite(v))) throw new Error('contourPaths: levels must be finite')
    const resolution = options.resolution ?? 64
    const [nx, ny] = typeof resolution === 'number' ? [resolution, resolution] : resolution
    if (![nx, ny].every((v) => Number.isInteger(v) && v >= 1) || (nx + 1) * (ny + 1) > 1000000) throw new Error('contourPaths: resolution must give positive integer cell counts and at most 1000000 vertices')
    if (options.levels.length === 0) return []
    const xs = Array.from({ length: nx + 1 }, (_, i) => options.x[0] + (options.x[1] - options.x[0]) * (i / nx))
    const ys = Array.from({ length: ny + 1 }, (_, j) => options.y[0] + (options.y[1] - options.y[0]) * (j / ny))
    const values = new Float64Array((nx + 1) * (ny + 1))
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) values[j * (nx + 1) + i] = field(xs[i], ys[j])

    return options.levels.map((level) => {
        const vertices = new Map<string, Vec>(), neighbors = new Map<string, Set<string>>()
        const levelEdges = new Map<string, Map<number, Vertex>>()
        const connect = (a: Vertex, b: Vertex) => {
            if (a.id === b.id || (a.point[0] === b.point[0] && a.point[1] === b.point[1])) return
            for (const v of [a, b]) {
                vertices.set(v.id, v.point)
                if (!neighbors.has(v.id)) neighbors.set(v.id, new Set())
            }
            neighbors.get(a.id)!.add(b.id); neighbors.get(b.id)!.add(a.id)
        }
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const indices = [j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i]
            const raw = indices.map((k) => values[k])
            if (!raw.every(Number.isFinite)) continue
            const inside = raw.map((v) => v >= level)
            if (raw.every((v) => v === level)) continue
            // Subtract first to retain small differences on a large offset, then normalize the determinant.
            const offsets = raw.map((value) => value - level)
            const finiteOffsets = offsets.every(Number.isFinite)
            const magnitude = (finiteOffsets ? Math.max(...offsets.map(Math.abs)) : Math.max(Math.abs(level), ...raw.map(Math.abs))) || 1
            const v = finiteOffsets ? offsets.map((value) => value / magnitude) : raw.map((value) => value / magnitude - level / magnitude)
            const corners: Vec[] = [[xs[i], ys[j]], [xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]]
            const edgeKey = (k: number) => `${Math.min(indices[k], indices[(k + 1) % 4])}:${Math.max(indices[k], indices[(k + 1) % 4])}`
            const onEdge = (k: number, t: number): Vertex => {
                const next = (k + 1) % 4, a = corners[k], b = corners[next]
                const id = t === 0 ? `v${indices[k]}` : t === 1 ? `v${indices[next]}` : `e${edgeKey(k)}`
                return { id, point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] }
            }
            const zeroEdges = [0, 1, 2, 3].filter((k) => raw[k] === level && raw[(k + 1) % 4] === level)
            if (zeroEdges.length) {
                // A level edge is part of the bilinear zero set, not a diagonal
                // shortcut between its far corners. Share and split it at branch points.
                for (const k of zeroEdges) {
                    const key = edgeKey(k), forward = indices[k] < indices[(k + 1) % 4]
                    let cuts = levelEdges.get(key)
                    if (!cuts) {
                        cuts = new Map([[0, onEdge(k, forward ? 0 : 1)], [1, onEdge(k, forward ? 1 : 0)]])
                        levelEdges.set(key, cuts)
                    }
                    const opposite = (k + 2) % 4, next = (k + 3) % 4
                    if (v[opposite] !== 0 && v[next] !== 0 && (v[opposite] < 0) !== (v[next] < 0)) {
                        const t = v[opposite] / (v[opposite] - v[next]), rootFraction = v[next] / (v[next] - v[opposite])
                        const along = forward ? rootFraction : t
                        const root = { id: `z${key}:${along}`, point: onEdge(k, rootFraction).point }
                        cuts.set(along, root)
                        connect(root, onEdge(opposite, t))
                    }
                }
                continue
            }
            if (inside.every(Boolean) || inside.every((v) => !v)) continue
            const hits = new Map<number, Vertex>()
            for (let k = 0; k < 4; k++) {
                const next = (k + 1) % 4
                if (inside[k] === inside[next]) continue
                const t = v[k] / (v[k] - v[next])
                hits.set(k, onEdge(k, t))
            }
            if (hits.size === 2) {
                const [a, b] = [...hits.values()]
                connect(a, b)
            } else if (hits.size === 4) {
                // Nielson and Hamann's asymptotic decider: the sign of ac - bd selects connectivity.
                const determinant = v[0] * v[2] - v[1] * v[3]
                if (determinant === 0) {
                    const mixed = v[0] - v[1] + v[2] - v[3]
                    const sx = (v[0] - v[3]) / mixed, sy = (v[0] - v[1]) / mixed
                    const point: Vec = [xs[i] + sx * (xs[i + 1] - xs[i]), ys[j] + sy * (ys[j + 1] - ys[j])]
                    for (const [a, b] of [[0, 2], [1, 3]]) {
                        const saddle = { id: `s${i}:${j}:${a}`, point }
                        connect(hits.get(a)!, saddle); connect(saddle, hits.get(b)!)
                    }
                } else {
                    const pairs = determinant > 0 ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]]
                    for (const [a, b] of pairs) connect(hits.get(a)!, hits.get(b)!)
                }
            }
        }

        for (const cuts of levelEdges.values()) {
            const ordered = [...cuts].sort(([a], [b]) => a - b).map(([, vertex]) => vertex)
            for (let k = 1; k < ordered.length; k++) connect(ordered[k - 1], ordered[k])
        }

        const paths: Vec[][] = []
        const degree = new Map([...neighbors].map(([key, edges]) => [key, edges.size]))
        const walk = (start: string, next: string) => {
            const path: Vec[] = [vertices.get(start)!]
            let previous = start, current = next
            while (true) {
                neighbors.get(previous)!.delete(current); neighbors.get(current)!.delete(previous)
                path.push(vertices.get(current)!)
                if (current === start || degree.get(current) !== 2 || neighbors.get(current)!.size === 0) break
                previous = current; current = neighbors.get(current)!.values().next().value!
            }
            paths.push(path)
        }
        // Open endpoints and level vertices with branches first, then closed loops.
        for (const [start, edges] of neighbors) if (degree.get(start) !== 2) for (const next of edges) walk(start, next)
        for (const [start, edges] of neighbors) for (const next of edges) walk(start, next)
        return { level, paths }
    })
}
