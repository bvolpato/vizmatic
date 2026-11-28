/**
 * The way of a pen through a filled shape. A letter of a font is an outline, and a pen does not draw an outline:
 * it draws a line through the middle, as wide as the letter is there. This finds that line. It draws the shape on
 * a grid of pixels, makes it thin, and follows what is left. Each point of the line knows how far the edge of the
 * shape is, so discs of that size along the line give the shape back.
 */
import type { Path } from './geometry'

/** One stroke of a pen: `x`, `y` and the half width at each of its points, in the units of the shape. */
export type PenStroke = readonly (readonly [x: number, y: number, r: number])[]

const STEPS = 10

/** The contours of a path as polygons. */
function flatten(path: Path): number[][] {
    return path.map(({ p }) => {
        const out = [p[0]!, p[1]!]
        for (let i = 2; i + 5 < p.length; i += 6) {
            const x0 = p[i - 2]!, y0 = p[i - 1]!, x1 = p[i]!, y1 = p[i + 1]!, x2 = p[i + 2]!, y2 = p[i + 3]!, x3 = p[i + 4]!, y3 = p[i + 5]!
            for (let k = 1; k <= STEPS; k++) {
                const t = k / STEPS, u = 1 - t
                out.push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3)
            }
        }
        return out
    })
}

/** Fill polygons on a grid with the nonzero rule, which the fonts use. */
function rasterize(polygons: readonly number[][], x0: number, y0: number, cell: number, width: number, height: number): Uint8Array {
    const grid = new Uint8Array(width * height)
    for (let row = 0; row < height; row++) {
        const y = y0 + (row + 0.5) * cell
        const hits: [number, number][] = []
        for (const polygon of polygons) {
            for (let i = 0; i < polygon.length; i += 2) {
                const j = (i + 2) % polygon.length, ya = polygon[i + 1]!, yb = polygon[j + 1]!
                if ((ya <= y) === (yb <= y)) continue
                const xa = polygon[i]!, xb = polygon[j]!
                hits.push([xa + (y - ya) / (yb - ya) * (xb - xa), yb > ya ? 1 : -1])
            }
        }
        hits.sort((a, b) => a[0] - b[0])
        let winding = 0
        for (let k = 0; k + 1 < hits.length; k++) {
            winding += hits[k]![1]
            if (winding === 0) continue
            const from = Math.max(0, Math.ceil((hits[k]![0] - x0) / cell - 0.5)), to = Math.min(width - 1, Math.floor((hits[k + 1]![0] - x0) / cell - 0.5))
            for (let x = from; x <= to; x++) grid[row * width + x] = 1
        }
    }
    return grid
}

/** The distance from each filled pixel to the nearest empty one, in pixels. */
function distances(grid: Uint8Array, width: number, height: number): Float64Array {
    const far = 1e12, d = new Float64Array(width * height)
    for (let i = 0; i < d.length; i++) d[i] = grid[i] ? far : 0
    const pass = (n: number, at: (i: number) => number) => {
        const f = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1)
        for (let i = 0; i < n; i++) f[i] = d[at(i)]!
        let k = 0
        v[0] = 0; z[0] = -Infinity; z[1] = Infinity
        for (let q = 1; q < n; q++) {
            let s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!)
            while (s <= z[k]!) { k--; s = ((f[q]! + q * q) - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!) }
            k++
            v[k] = q; z[k] = s; z[k + 1] = Infinity
        }
        k = 0
        for (let q = 0; q < n; q++) {
            while (z[k + 1]! < q) k++
            d[at(q)] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!
        }
    }
    for (let x = 0; x < width; x++) pass(height, (i) => i * width + x)
    for (let y = 0; y < height; y++) pass(width, (i) => y * width + i)
    for (let i = 0; i < d.length; i++) d[i] = Math.sqrt(d[i]!)
    return d
}

/** Make a filled grid thin, down to lines of one pixel (Zhang and Suen, 1984). */
function thin(grid: Uint8Array, width: number, height: number): Uint8Array {
    const out = Uint8Array.from(grid)
    const ring = [-width, -width + 1, 1, width + 1, width, width - 1, -1, -width - 1]
    for (let changed = true; changed;) {
        changed = false
        for (const second of [false, true]) {
            const gone: number[] = []
            for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
                const i = y * width + x
                if (!out[i]) continue
                let count = 0, turns = 0
                for (let k = 0; k < 8; k++) {
                    const here = out[i + ring[k]!]!
                    count += here
                    if (!here && out[i + ring[(k + 1) % 8]!]) turns++
                }
                if (count < 2 || count > 6 || turns !== 1) continue
                const n = out[i + ring[0]!]!, e = out[i + ring[2]!]!, s = out[i + ring[4]!]!, w = out[i + ring[6]!]!
                if (second ? n * e * w === 0 && n * s * w === 0 : n * e * s === 0 && e * s * w === 0) gone.push(i)
            }
            for (const i of gone) out[i] = 0
            if (gone.length > 0) changed = true
        }
    }
    return out
}

/** A round dot can lose all of its pixels when it gets thin. Give each such part its middle back. */
function keepParts(line: Uint8Array, grid: Uint8Array, room: Float64Array, width: number): void {
    const seen = new Uint8Array(grid.length)
    for (let start = 0; start < grid.length; start++) {
        if (!grid[start] || seen[start]) continue
        const stack = [start]
        let middle = start, kept = false
        seen[start] = 1
        while (stack.length > 0) {
            const i = stack.pop()!
            if (line[i]) kept = true
            if (room[i]! > room[middle]!) middle = i
            for (const step of [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1]) if (grid[i + step] && !seen[i + step]) { seen[i + step] = 1; stack.push(i + step) }
        }
        if (!kept) line[middle] = 1
    }
}

interface Edge { a: number; b: number; pixels: number[]; used: boolean }

/** Follow the thin lines: a list of chains of pixels, from one end or crossing to the next. */
function chains(line: Uint8Array, width: number): { edges: Edge[]; nodes: Map<number, Edge[]>; lone: number[] } {
    const around = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1]
    const beside = new Set([-width, -1, 1, width])
    const pixels: number[] = []
    for (let i = 0; i < line.length; i++) if (line[i]) pixels.push(i)
    // A diagonal step counts only when no straight step goes the same way, so a corner is not a crossing.
    const near = (i: number): number[] => around.filter((step) => {
        if (!line[i + step]) return false
        if (beside.has(step)) return true
        const dx = step === -width - 1 || step === width - 1 ? -1 : 1, dy = step < 0 ? -width : width
        return !line[i + dx] && !line[i + dy]
    }).map((step) => i + step)
    const neighbors = new Map(pixels.map((i) => [i, near(i)]))
    const isNode = (i: number) => neighbors.get(i)!.length !== 2
    const nodes = new Map<number, Edge[]>(), edges: Edge[] = [], lone: number[] = []
    const seen = new Set<string>()
    const follow = (start: number, next: number) => {
        const path = [start, next]
        let before = start, here = next
        while (!isNode(here) && here !== start) {
            const onward: number = neighbors.get(here)!.find((i) => i !== before)!
            before = here; here = onward
            path.push(here)
        }
        const key = (a: number, b: number) => `${a}>${b}`
        if (seen.has(key(here, before))) return
        seen.add(key(start, next)); seen.add(key(here, before))
        const edge: Edge = { a: start, b: here, pixels: path, used: false }
        edges.push(edge)
        for (const node of new Set([start, here])) nodes.set(node, [...(nodes.get(node) ?? []), edge])
    }
    const done = new Set<number>()
    for (const i of pixels) if (isNode(i)) {
        if (neighbors.get(i)!.length === 0) lone.push(i)
        for (const next of neighbors.get(i)!) follow(i, next)
    }
    for (const edge of edges) for (const i of edge.pixels) done.add(i)
    // What is left are rings with no end and no crossing, such as an "o". They start at their top.
    for (const i of pixels) if (!done.has(i) && !isNode(i)) {
        follow(i, neighbors.get(i)![0]!)
        for (const pixel of edges[edges.length - 1]!.pixels) done.add(pixel)
    }
    return { edges, nodes, lone }
}

/**
 * The strokes of a pen that draws a filled path, in the order in which a hand would draw them: from left to right,
 * and a dot or a bar that is apart after the body. `resolution` is the size of the grid for one unit of `size`.
 */
export function penStrokes(path: Path, size: number, resolution = 150): PenStroke[] {
    const polygons = flatten(path).filter((polygon) => polygon.length >= 6)
    if (polygons.length === 0) return []
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const polygon of polygons) for (let i = 0; i < polygon.length; i += 2) {
        x0 = Math.min(x0, polygon[i]!); x1 = Math.max(x1, polygon[i]!); y0 = Math.min(y0, polygon[i + 1]!); y1 = Math.max(y1, polygon[i + 1]!)
    }
    const cell = size / resolution
    x0 -= cell * 2; y0 -= cell * 2
    const width = Math.ceil((x1 - x0) / cell) + 3, height = Math.ceil((y1 - y0) / cell) + 3
    const grid = rasterize(polygons, x0, y0, cell, width, height)
    const room = distances(grid, width, height)
    const line = thin(grid, width, height)
    keepParts(line, grid, room, width)
    const { edges, nodes, lone } = chains(line, width)
    const at = (i: number): [number, number] => [i % width, Math.floor(i / width)]
    const degree = (node: number) => nodes.get(node)?.filter((edge) => !edge.used).length ?? 0
    // A short branch that is no longer than the letter is wide there is a corner of the outline, not a stroke.
    for (const edge of edges) {
        if (edge.a === edge.b) continue
        const free = [edge.a, edge.b].find((node) => nodes.get(node)!.length === 1), joint = free === edge.a ? edge.b : edge.a
        if (free !== undefined && nodes.get(joint)!.length > 2 && edge.pixels.length < room[joint]! * 1.6 + 2) edge.used = true
    }

    const strokes: { pixels: number[] }[] = []
    const heading = (pixels: readonly number[], end: boolean): [number, number] => {
        // The direction in which a chain arrives at its end (or leaves its start), over some pixels.
        const n = Math.min(pixels.length - 1, 9), tip = end ? pixels[pixels.length - 1]! : pixels[0]!, back = end ? pixels[pixels.length - 1 - n]! : pixels[n]!
        const [tx, ty] = at(tip), [bx, by] = at(back), d = Math.hypot(tx - bx, ty - by) || 1
        return end ? [(tx - bx) / d, (ty - by) / d] : [(bx - tx) / d, (by - ty) / d]
    }
    const oriented = (edge: Edge, from: number) => (edge.a === from ? edge.pixels : [...edge.pixels].reverse())
    const grow = (first: Edge, from: number) => {
        let pixels = oriented(first, from), here = first.a === from ? first.b : first.a
        first.used = true
        for (;;) {
            const choices = (nodes.get(here) ?? []).filter((edge) => !edge.used)
            if (choices.length === 0) break
            const [hx, hy] = heading(pixels, true)
            let best: { pixels: number[]; edge: Edge } | null = null, score = -Infinity
            for (const edge of choices) for (const way of edge.a === edge.b ? [edge.pixels, [...edge.pixels].reverse()] : [oriented(edge, here)]) {
                const [vx, vy] = heading(way, false), straight = hx * vx + hy * vy
                if (straight > score) { score = straight; best = { pixels: way, edge } }
            }
            // A pen goes on through a crossing. It does not turn back on itself.
            if (!best || (score < -0.25 && choices.length > 1) || score < -0.8) break
            best.edge.used = true
            pixels = [...pixels, ...best.pixels.slice(1)]
            here = best.edge.a === here ? best.edge.b : best.edge.a
        }
        strokes.push({ pixels })
    }
    const left = (node: number) => { const [x, y] = at(node); return x + y * 0.15 }
    for (;;) {
        const open = [...nodes.keys()].filter((node) => degree(node) > 0)
        if (open.length === 0) break
        // A stroke starts at a free end when there is one, the one that is most to the left.
        const ends = open.filter((node) => degree(node) % 2 === 1), from = (ends.length > 0 ? ends : open).reduce((a, b) => (left(b) < left(a) ? b : a))
        const choices = nodes.get(from)!.filter((edge) => !edge.used)
        grow(choices.reduce((a, b) => (b.pixels.length > a.pixels.length ? b : a)), from)
    }
    for (const i of lone) strokes.push({ pixels: [i] })

    const longest = Math.max(1, ...strokes.map((stroke) => stroke.pixels.length))
    const made = strokes.map(({ pixels }) => {
        const raw = pixels.map((i) => { const [x, y] = at(i); return [x, y, Math.max(0.5, room[i]! - 0.25)] as const })
        // Pixels are stairs. A mean over some pixels makes a line of them, and keeps the two ends.
        const smooth = raw.map((_, k) => {
            const reach = Math.min(4, k, raw.length - 1 - k)
            let sx = 0, sy = 0, sr = 0, n = 0
            for (let j = -reach; j <= reach; j++) { const w = reach + 1 - Math.abs(j), p = raw[k + j]!; sx += p[0] * w; sy += p[1] * w; sr += p[2] * w; n += w }
            return [x0 + (sx / n + 0.5) * cell, y0 + (sy / n + 0.5) * cell, sr / n * cell] as [number, number, number]
        })
        // The thin line stops before the round end of a stroke. The disc at its end reaches the edge.
        const points = smooth.filter((_, k) => k % 2 === 0 || k === smooth.length - 1)
        const top = Math.min(...points.map((p) => p[1])), start = Math.min(...points.map((p) => p[0]))
        const tall = Math.max(...points.map((p) => p[1])) - top, wide = Math.max(...points.map((p) => p[0])) - start
        // Dots come after the body of the letter, and so do bars, such as the one of a "t".
        const bar = wide > tall * 2.2 && pixels.length < longest * 0.95 && top - y0 < (y1 - y0) * 0.6
        return { points, late: pixels.length < longest * 0.3 || bar ? 1 : 0, start, top }
    })
    made.sort((a, b) => a.late - b.late || a.start - b.start || a.top - b.top)
    return made.map((stroke) => stroke.points)
}
