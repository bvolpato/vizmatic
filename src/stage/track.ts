import type { Ease } from './ease'

/**
 * The clock every read and write goes through.
 *
 * Compile mode runs the author's function once and records keys. Render mode
 * samples those keys at any time, in any order, so a frame is a pure function of t.
 */
export const clock = {
    now: 0,
    mode: 'free' as 'free' | 'compile' | 'render',
    /** Increments once per rendered frame and invalidates per-frame overlays. */
    frame: 0,
    /** While set, writes to mounted nodes collect here instead of creating keys. */
    capture: null as null | Set<Overlayable>,
}

export interface Overlayable {
    overlay: Map<string, unknown> | null
}

export interface Key<T> {
    t0: number
    t1: number
    ease: Ease | null
    to: T
    /** Value at eased progress. Absent for a step key. */
    at: ((alpha: number) => T) | null
}

/** One property over time. Keys sort by start time, and a later key wins from its start. */
export class Track<T> {
    readonly keys: Key<T>[] = []
    constructor(public initial: T) {}

    sample(t: number): T {
        const keys = this.keys
        let lo = 0, hi = keys.length - 1, index = -1
        while (lo <= hi) {
            const mid = (lo + hi) >> 1
            if (keys[mid]!.t0 <= t) {
                index = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        if (index < 0) return this.initial
        const key = keys[index]!
        if (t >= key.t1 || !key.at) return key.to
        const span = key.t1 - key.t0
        const raw = span > 0 ? (t - key.t0) / span : 1
        return key.at(key.ease ? key.ease(raw) : raw)
    }

    add(key: Key<T>): void {
        const keys = this.keys
        let index = keys.length
        while (index > 0 && keys[index - 1]!.t0 > key.t0) index--
        keys.splice(index, 0, key)
    }

    step(t: number, value: T): void {
        this.add({ t0: t, t1: t, ease: null, to: value, at: null })
    }

    /** Last time this track changes. */
    get end(): number {
        let end = 0
        for (const key of this.keys) if (key.t1 > end) end = key.t1
        return end
    }
}
