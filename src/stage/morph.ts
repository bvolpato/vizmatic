import {
    pathLength, reverseRing, ringCenter, ringLength, segmentCount, signedArea, type Path, type Ring,
} from './geometry'

/** Split the longest segments until a ring has `target` segments. The shape does not change. */
function growTo(r: Ring, target: number): Ring {
    const count = segmentCount(r)
    if (count >= target || count === 0) return r
    const segments: { pts: number[]; length: number }[] = []
    for (let i = 0; i < count; i++) {
        const o = i * 6
        const pts = Array.from(r.p.subarray(o, o + 8))
        segments.push({ pts, length: chord(pts) })
    }
    while (segments.length < target) {
        let longest = 0
        for (let i = 1; i < segments.length; i++) if (segments[i]!.length > segments[longest]!.length) longest = i
        const [a, b] = bisect(segments[longest]!.pts)
        segments.splice(longest, 1, { pts: a, length: chord(a) }, { pts: b, length: chord(b) })
    }
    const out = new Float64Array(2 + target * 6)
    out[0] = r.p[0]!
    out[1] = r.p[1]!
    for (let i = 0; i < target; i++) {
        const pts = segments[i]!.pts
        for (let k = 0; k < 6; k++) out[2 + i * 6 + k] = pts[2 + k]!
    }
    return { p: out, closed: r.closed }
}

function chord(pts: readonly number[]): number {
    return Math.hypot(pts[2]! - pts[0]!, pts[3]! - pts[1]!)
        + Math.hypot(pts[4]! - pts[2]!, pts[5]! - pts[3]!)
        + Math.hypot(pts[6]! - pts[4]!, pts[7]! - pts[5]!)
}

function bisect(p: readonly number[]): [number[], number[]] {
    const ax = (p[0]! + p[2]!) / 2, ay = (p[1]! + p[3]!) / 2
    const bx = (p[2]! + p[4]!) / 2, by = (p[3]! + p[5]!) / 2
    const cx = (p[4]! + p[6]!) / 2, cy = (p[5]! + p[7]!) / 2
    const dx = (ax + bx) / 2, dy = (ay + by) / 2
    const ex = (bx + cx) / 2, ey = (by + cy) / 2
    const fx = (dx + ex) / 2, fy = (dy + ey) / 2
    return [[p[0]!, p[1]!, ax, ay, dx, dy, fx, fy], [fx, fy, ex, ey, cx, cy, p[6]!, p[7]!]]
}

/** Rotate a closed ring's start so its anchors line up with another ring of the same size. */
function bestRotation(a: Ring, b: Ring): Ring {
    const count = segmentCount(b)
    if (!a.closed || !b.closed || count < 2) return b
    const [ax, ay] = ringCenter(a), [bx, by] = ringCenter(b)
    const stride = Math.max(1, Math.floor(count / 48))
    let best = 0, bestCost = Infinity
    for (let shift = 0; shift < count; shift += stride) {
        let cost = 0
        for (let i = 0; i < count; i += stride) {
            const j = (i + shift) % count
            const dx = a.p[i * 6]! - ax - (b.p[j * 6]! - bx)
            const dy = a.p[i * 6 + 1]! - ay - (b.p[j * 6 + 1]! - by)
            cost += dx * dx + dy * dy
        }
        if (cost < bestCost) {
            bestCost = cost
            best = shift
        }
    }
    if (best === 0) return b
    const out = new Float64Array(b.p.length)
    out[0] = b.p[best * 6]!
    out[1] = b.p[best * 6 + 1]!
    for (let i = 0; i < count; i++) {
        const j = (i + best) % count
        for (let k = 0; k < 6; k++) out[2 + i * 6 + k] = b.p[2 + j * 6 + k]!
    }
    return { p: out, closed: b.closed }
}

/** A ring shrunk to a point. It has `count` segments, so it can grow into a real ring. */
function pointRing(x: number, y: number, count: number, closed: boolean): Ring {
    const out = new Float64Array(2 + count * 6)
    for (let i = 0; i < out.length; i += 2) {
        out[i] = x
        out[i + 1] = y
    }
    return { p: out, closed }
}

function pairRings(from: Path, to: Path): [Ring, Ring][] {
    const rank = (path: Path) => [...path].sort((a, b) =>
        (Math.abs(signedArea(b)) + ringLength(b) * 0.01) - (Math.abs(signedArea(a)) + ringLength(a) * 0.01))
    const a = rank(from), b = rank(to)
    const pairs: [Ring, Ring][] = []
    const free = b.slice()
    for (const ringA of a) {
        if (free.length === 0) {
            const [x, y] = ringCenter(ringA)
            pairs.push([ringA, pointRing(x, y, segmentCount(ringA), ringA.closed)])
            continue
        }
        // Largest rings pair first. Each takes the nearest remaining ring among the next few.
        const [ax, ay] = ringCenter(ringA)
        let bestIndex = 0, bestCost = Infinity
        for (let i = 0; i < Math.min(free.length, 3); i++) {
            const [bx, by] = ringCenter(free[i]!)
            const cost = Math.hypot(ax - bx, ay - by) + i * 40
            if (cost < bestCost) {
                bestCost = cost
                bestIndex = i
            }
        }
        pairs.push([ringA, free[bestIndex]!])
        free.splice(bestIndex, 1)
    }
    for (const ringB of free) {
        const [x, y] = ringCenter(ringB)
        pairs.push([pointRing(x, y, segmentCount(ringB), ringB.closed), ringB])
    }
    return pairs
}

export interface AlignedPaths {
    readonly from: Float64Array[]
    readonly to: Float64Array[]
    readonly closed: boolean[]
}

/** Give two paths matching structure, so straight-line motion between points morphs them. */
export function alignPaths(from: Path, to: Path, minSegments = 12): AlignedPaths {
    const pairs = pairRings(from, to)
    const a: Float64Array[] = [], b: Float64Array[] = [], closed: boolean[] = []
    for (const [ra, rb] of pairs) {
        const target = Math.max(segmentCount(ra), segmentCount(rb), ra.closed && rb.closed ? minSegments : 1)
        let x = growTo(ra, target)
        let y = growTo(rb, target)
        if (x.closed && y.closed) {
            // Matching winding direction prevents a ring from folding through itself.
            if (Math.sign(signedArea(x)) !== Math.sign(signedArea(y)) && signedArea(x) !== 0 && signedArea(y) !== 0) y = reverseRing(y)
            y = bestRotation(x, y)
        } else if (!x.closed && !y.closed) {
            // Open curves pick the direction with the shorter total travel.
            const n = x.p.length
            const straight = Math.hypot(x.p[0]! - y.p[0]!, x.p[1]! - y.p[1]!) + Math.hypot(x.p[n - 2]! - y.p[n - 2]!, x.p[n - 1]! - y.p[n - 1]!)
            const flipped = Math.hypot(x.p[0]! - y.p[n - 2]!, x.p[1]! - y.p[n - 1]!) + Math.hypot(x.p[n - 2]! - y.p[0]!, x.p[n - 1]! - y.p[1]!)
            if (flipped < straight) y = reverseRing(y)
        }
        a.push(x.p)
        b.push(y.p)
        closed.push(x.closed && y.closed)
    }
    return { from: a, to: b, closed }
}

/** Returns a function from eased progress to a morphed path. Endpoints return the exact originals. */
export function pathMixer(from: Path, to: Path): (alpha: number) => Path {
    if (from === to) return () => to
    if (pathLength(from) === 0 && from.length === 0) return (alpha) => alpha >= 1 ? to : from
    const aligned = alignPaths(from, to)
    return (alpha) => {
        if (alpha <= 0) return from
        if (alpha >= 1) return to
        const rings: Ring[] = new Array(aligned.from.length)
        for (let r = 0; r < rings.length; r++) {
            const a = aligned.from[r]!, b = aligned.to[r]!
            const out = new Float64Array(a.length)
            for (let i = 0; i < a.length; i++) out[i] = a[i]! + (b[i]! - a[i]!) * alpha
            rings[r] = { p: out, closed: aligned.closed[r]! }
        }
        return rings
    }
}

/** Longest common subsequence over keys. Returns index pairs in order. */
export function matchSequence<T>(a: readonly T[], b: readonly T[]): [number, number][] {
    const n = a.length, m = b.length
    const table: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
        }
    }
    const pairs: [number, number][] = []
    let i = 0, j = 0
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            pairs.push([i++, j++])
        } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
            i++
        } else {
            j++
        }
    }
    return pairs
}
