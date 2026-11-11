import { isGradient, type Paint, type Rgba } from './color'
import type { DrawOp, Frame } from './display'
import type { Path } from './geometry'

/**
 * True when two frames paint the same picture.
 *
 * Most frames of a film repeat the frame before, because the picture holds while a voice speaks.
 * A renderer uses this test to give the same pixels again and skip the paint. The test compares
 * the draw lists, and it never reports two different pictures as equal. It can report two equal
 * pictures as different, such as two paths with the same points in different rings. That costs
 * one paint and nothing else.
 */
export function sameFrame(a: Frame, b: Frame): boolean {
    if (a === b) return true
    if (a.width !== b.width || a.height !== b.height || a.background !== b.background || a.bloom !== b.bloom || a.dark !== b.dark) return false
    const left = a.ops, right = b.ops
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i++) if (!sameOp(left[i]!, right[i]!)) return false
    return true
}

function sameOp(a: DrawOp, b: DrawOp): boolean {
    if (a === b) return true
    if (a.kind === 'image') {
        if (b.kind !== 'image' || a.alpha !== b.alpha || a.dim !== b.dim || !sameNumbers(a.backdrop, b.backdrop)) return false
        const x = a.image, y = b.image
        // A prepared asset holds the bytes of the picture, so one asset is one picture.
        if (x.asset !== y.asset || x.src !== y.src || x.width !== y.width || x.height !== y.height) return false
        const p = x.crop, q = y.crop
        if (p !== q && (!p || !q || p.x !== q.x || p.y !== q.y || p.width !== q.width || p.height !== q.height)) return false
        const m = a.matrix, n = b.matrix
        return m[0] === n[0] && m[1] === n[1] && m[2] === n[2] && m[3] === n[3] && m[4] === n[4] && m[5] === n[5]
    }
    if (b.kind !== 'path') return false
    return a.fillAlpha === b.fillAlpha && a.strokeAlpha === b.strokeAlpha && a.strokeWidth === b.strokeWidth
        && a.glow === b.glow && a.blend === b.blend && a.cap === b.cap && a.join === b.join && a.dashOffset === b.dashOffset
        && sameNumbers(a.dash, b.dash) && sameNumbers(a.glowColor, b.glowColor)
        && samePaint(a.fill, b.fill) && samePaint(a.stroke, b.stroke)
        // A node that does not move gives the same path object in each frame, so this is mostly one comparison.
        && samePath(a.path, b.path) && samePath(a.strokePath, b.strokePath)
}

function sameNumbers(a: ArrayLike<number> | null | undefined, b: ArrayLike<number> | null | undefined): boolean {
    if (a === b) return true
    if (!a || !b || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
}

function samePaint(a: Paint | null, b: Paint | null): boolean {
    if (a === b) return true
    if (!a || !b) return false
    const gradient = isGradient(a)
    if (gradient !== isGradient(b)) return false
    if (!gradient) return sameNumbers(a as Rgba, b as Rgba)
    const x = a as Exclude<Paint, Rgba>, y = b as Exclude<Paint, Rgba>
    if (x.type !== y.type || x.stops.length !== y.stops.length) return false
    for (let i = 0; i < x.stops.length; i++) {
        if (x.stops[i]![0] !== y.stops[i]![0] || !sameNumbers(x.stops[i]![1], y.stops[i]![1])) return false
    }
    if (x.type === 'linear' && y.type === 'linear') return sameNumbers(x.from, y.from) && sameNumbers(x.to, y.to)
    if (x.type === 'radial' && y.type === 'radial') return sameNumbers(x.center, y.center) && x.radius === y.radius
    // The painters draw a stroke with a color along its length as solid pieces, so its stops are all that it holds.
    return true
}

function samePath(a: Path, b: Path): boolean {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        const x = a[i]!, y = b[i]!
        if (x === y) continue
        if (x.closed !== y.closed || !!x.straight !== !!y.straight || !sameNumbers(x.p, y.p)) return false
    }
    return true
}
