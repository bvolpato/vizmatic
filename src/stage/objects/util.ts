import { clock } from '../track'
import type { Ease } from '../ease'
import { Node, type NodeProps, type PropName } from '../node'
import { Value } from '../anim'
import type { Stage } from '../stage'
import { tex } from '../tex'
import { text, type TextOptions } from '../text'
import type { Path, Ring, Vec } from '../geometry'
import type { ColorInput } from '../color'
import { parseColor, type Rgba } from '../color'

/**
 * Put a node on stage if needed and make sure it and its parents show from time t. The node arrives at t,
 * which in a sequence is later than the time of the stage. A node in a group that is not on stage brings the
 * whole group, so it keeps the place that the group gives it.
 */
export function reveal(node: Node, t: number, stage: Stage): void {
    if (!node.mounted) {
        let top = node
        while (top.parent && top.parent !== stage.root) top = top.parent
        stage.mountAt(top, t)
    }
    for (let n: Node | null = node; n && n !== stage.root; n = n.parent) {
        if (!sampleAt(n, 'visible', t)) n.track('visible').step(t, true)
    }
}

export function sampleAt<K extends PropName>(node: Node, prop: K, t: number): NodeProps[K] {
    const saved = clock.now
    clock.now = t
    const value = node.get(prop)
    clock.now = saved
    return value
}

export function stepAt<K extends PropName>(node: Node, prop: K, value: NodeProps[K], t: number): void {
    node.track(prop).step(t, value)
}

/** Tween a Value over an explicit window. */
export function tweenValue(value: Value, to: number, t0: number, t1: number, ease: Ease): void {
    const from = value.track.sample(t0)
    value.track.add({ t0, t1, ease, to, at: (a) => from + (to - from) * a })
}

/** Windows for a staggered list that fills [t0, t1]. `lag` is a fraction of one item's time. */
export function staggered(count: number, lag: number, t0: number, t1: number): [number, number][] {
    if (count === 0) return []
    const each = (t1 - t0) / (1 + (count - 1) * lag)
    return Array.from({ length: count }, (_, i) => {
        const start = t0 + i * lag * each
        return [start, start + each] as [number, number]
    })
}

/** The first share of the time at which an ease is at a share of the way. An ease may pass the end and come back. */
export function reaches(ease: Ease, share: number): number {
    if (share <= 0) return 0
    const steps = 256
    for (let k = 1; k <= steps; k++) {
        if (ease(k / steps) < share) continue
        let low = (k - 1) / steps, high = k / steps
        for (let pass = 0; pass < 24; pass++) {
            const middle = (low + high) / 2
            if (ease(middle) >= share) high = middle
            else low = middle
        }
        return high
    }
    return 1
}

/**
 * An ease that never goes back and never passes its end: at each share of the time, the furthest share of
 * the way that the ease has reached. The cursor of `lanes` and of `dateLine` shows events and cannot hide
 * them again, so an ease that bounces or passes its end must not move the cursor back, or past the end of
 * the advance.
 */
export function forwardOnly(ease: Ease): Ease {
    const steps = 256
    const most = new Float64Array(steps + 1)
    let top = 0
    for (let k = 0; k <= steps; k++) {
        top = Math.max(top, Math.min(1, ease(k / steps)))
        most[k] = top
    }
    // An ease that only rises keeps its own value at every time, not a value between two samples.
    return (share) => (share <= 0 ? 0 : Math.max(most[Math.min(steps, Math.floor(share * steps))]!, Math.min(1, ease(Math.min(1, share)))))
}

/** Direct straight-line interpolation between two paths with the same structure. */
export function lerpSame(from: Path, to: Path): (alpha: number) => Path {
    return (alpha) => {
        if (alpha <= 0) return from
        if (alpha >= 1) return to
        return from.map((r, i) => {
            const a = r.p, b = to[i]!.p
            const out = new Float64Array(a.length)
            for (let k = 0; k < a.length; k++) out[k] = a[k]! + (b[k]! - a[k]!) * alpha
            return { p: out, closed: r.closed }
        })
    }
}

/** A math or plain label as a node, unless it already is one. A plain label with no `font` is in the font of the film. */
export function labelNode(label: string | Node, options: { size: number; color?: ColorInput; math?: boolean; font?: TextOptions['font']; weight?: TextOptions['weight'] }): Node {
    if (typeof label !== 'string') return label
    if (options.math) return tex(label, { size: options.size, color: options.color ?? 'ink', display: false })
    return text(label, { size: options.size, color: options.color ?? 'ink', font: options.font, weight: options.weight ?? 400 })
}

/** Relative luminance, for choosing readable text over a filled cell. */
export function luminance(color: Rgba): number {
    const f = (v: number) => {
        const x = v / 255
        return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(color[0]) + 0.7152 * f(color[1]) + 0.0722 * f(color[2])
}

export function solidColor(input: ColorInput): Rgba {
    if (typeof input === 'string') return parseColor(input)
    if (Array.isArray(input)) return input as unknown as Rgba
    const stops = (input as { stops: readonly (readonly [number, Rgba])[] }).stops
    return stops[0]![1]
}

/**
 * Small seeded generator (mulberry32), for layouts and jitter that repeat exactly: `const random = seededRandom(7)`,
 * then each `random()` is a number from 0 up to 1. A film is built more than once, so it must not use `Math.random`.
 */
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let v = Math.imul(state ^ (state >>> 15), 1 | state)
        v ^= v + Math.imul(v ^ (v >>> 7), 61 | v)
        return ((v ^ (v >>> 14)) >>> 0) / 4294967296
    }
}

export function stepsBetween(min: number, max: number, step: number): number[] {
    const out: number[] = []
    const first = Math.ceil(min / step - 1e-9) * step
    for (let value = first; value <= max + step * 1e-6; value += step) out.push(Math.round(value / step) * step)
    return out
}

/** A value that a call cannot take, in a few words for a message. */
export function said(value: unknown): string {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'string') return `the string ${JSON.stringify(value.length > 48 ? `${value.slice(0, 48)}...` : value)}`
    if (typeof value === 'number' || typeof value === 'boolean') return `the value ${value}`
    if (typeof value === 'function') return 'a function'
    if (Array.isArray(value)) return value.length <= 4 && value.every((item) => typeof item === 'number') ? `the list [${value.join(', ')}]` : 'a list'
    return value instanceof Node ? 'a node' : 'an object'
}

/** Round axis ticks: about `count` of them, on 1, 2, or 5 steps. */
export function niceTicks(min: number, max: number, count = 5): { ticks: number[]; step: number } {
    const span = max - min || 1
    const rough = span / Math.max(1, count)
    const power = Math.pow(10, Math.floor(Math.log10(rough)))
    const unit = rough / power
    const step = (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power
    return { ticks: stepsBetween(min, max, step), step }
}

export function formatNumber(value: number, step?: number): string {
    if (step !== undefined && step < 1) {
        const digits = Math.min(4, Math.ceil(-Math.log10(step) - 1e-9))
        return value.toFixed(digits)
    }
    const rounded = Math.round(value * 1000) / 1000
    if (Math.abs(rounded) >= 1000 && Number.isInteger(rounded)) return rounded.toLocaleString('en-US')
    return String(rounded)
}

/** Straight run of segments as one open ring. */
export function polylineRing(points: readonly Vec[]): Ring {
    const first = points[0]!
    const out = new Array<number>(2 + (points.length - 1) * 6)
    out[0] = first[0]
    out[1] = first[1]
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!, b = points[i]!
        const o = 2 + (i - 1) * 6
        out[o] = a[0] + (b[0] - a[0]) / 3
        out[o + 1] = a[1] + (b[1] - a[1]) / 3
        out[o + 2] = a[0] + (b[0] - a[0]) * 2 / 3
        out[o + 3] = a[1] + (b[1] - a[1]) * 2 / 3
        out[o + 4] = b[0]
        out[o + 5] = b[1]
    }
    return { p: Float64Array.from(out), closed: false, straight: true }
}
