/**
 * One test of "a point is inside an outline", for the film check and for the emphasis of `indicate`. The two
 * must agree on what is on a shape, so they share this file. It is not a part of the public geometry.
 */
import type { Path, Ring } from './geometry'

/** The count of straight pieces that stand for one curve of a ring, in a test of a point or of a crossing. */
export const CURVE_PIECES = 6

/** The points of a curve between two anchors, as straight pieces. A ring of straight lines needs one piece for each. */
export function pieces(r: Ring, o: number, visit: (x0: number, y0: number, x1: number, y1: number) => boolean): boolean {
    const p = r.p
    const x0 = p[o]!, y0 = p[o + 1]!, x3 = p[o + 6]!, y3 = p[o + 7]!
    if (r.straight) return visit(x0, y0, x3, y3)
    const x1 = p[o + 2]!, y1 = p[o + 3]!, x2 = p[o + 4]!, y2 = p[o + 5]!
    let lastX = x0, lastY = y0
    for (let k = 1; k <= CURVE_PIECES; k++) {
        const t = k / CURVE_PIECES, u = 1 - t
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
        const x = a * x0 + b * x1 + c * x2 + d * x3
        const y = a * y0 + b * y1 + c * y2 + d * y3
        if (visit(lastX, lastY, x, y)) return true
        lastX = x
        lastY = y
    }
    return false
}

/** True when a point is inside an outline, by the even-odd rule. An open outline counts as closed by a straight line. */
export function encloses(path: Path, px: number, py: number): boolean {
    let inside = false
    const edge = (x0: number, y0: number, x1: number, y1: number) => {
        if ((y0 > py) !== (y1 > py) && px < x0 + (x1 - x0) * (py - y0) / (y1 - y0)) inside = !inside
        return false
    }
    for (const r of path) {
        const p = r.p
        if (p.length < 8) continue
        for (let o = 0; o + 7 < p.length; o += 6) pieces(r, o, edge)
        edge(p[p.length - 2]!, p[p.length - 1]!, p[0]!, p[1]!)
    }
    return inside
}
