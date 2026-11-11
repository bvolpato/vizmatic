import type { Ease } from './ease'
import type { FontFamily } from './font'

/** The font of a text that names none, outside a film and in a film that names no font. */
export const LIBRARY_FONT: FontFamily = 'sans'

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
    /**
     * The font that the film names for its texts, or null: outside a film, and in a film that names none.
     * A text measures its glyphs when it is made, so the font must be known then. The font of a film lives on
     * its stage. The stage puts it here when the callback of the film starts, at each call that the callback
     * makes on the stage, and while one of its frames is drawn.
     */
    font: null as FontFamily | null,
    /**
     * The stage of the film whose callback runs now, or null outside a film. The stage puts itself here where
     * it puts its font. The layout reads the frame from it, and adds a check for the end of the build: a node
     * that it put off the frame stops the build.
     */
    canvas: null as { readonly width: number; readonly height: number; readonly checks: (() => void)[] } | null,
    /** The time of the frame that is drawn now, in render mode. A value that is read at another time is not this frame's. */
    at: 0,
    /**
     * While a frame is drawn: the frame is proven to stay as it is for every later time before this one.
     * It starts at Infinity. Each read of a track lowers it to the next change of that track, and each part
     * of the frame that uses the time itself lowers it by `changesAt` or `changesNow`. The export does not
     * draw a frame again before this time.
     */
    steady: Infinity,
}

/** Say that the frame in progress can change at `time`, and not before, as far as the caller knows. */
export function changesAt(time: number): void {
    if (time < clock.steady) clock.steady = time
}

/** Say that the frame in progress changes with the time now, or that the caller cannot tell when it changes. */
export function changesNow(): void {
    clock.steady = -Infinity
}

/**
 * The name of the property of a frame that holds its steady time. A symbol of the registry, so that an export
 * with its own copy of the engine reads the frames of the copy that drew them.
 */
export const STEADY = Symbol.for('vizmatic.frame.steady')

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
    /**
     * For a key whose value rests during parts of its span, as a key that holds several moves: the time
     * before which the value stays as it is at `time`, or -Infinity while the value is on its way. A key
     * without it is on its way for its whole span.
     */
    until?: (time: number) => number
}

/** A key with a duration: the value moves from the start of the key to its end. Every other key is a step, which sets a value at one time. */
const moves = <T>(key: Key<T>): boolean => key.at !== null && key.t1 > key.t0

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
        // A frame that reads this value stays the same until the next key starts. A read at another time
        // than the time of the frame says nothing about the frame, so then the frame has no steady time.
        if (t !== clock.at) clock.steady = -Infinity
        else if (index + 1 < keys.length && keys[index + 1]!.t0 < clock.steady) clock.steady = keys[index + 1]!.t0
        if (index < 0) return this.initial
        const key = keys[index]!
        if (t >= key.t1 || !key.at) return key.to
        // The value is on its way, unless the key says that it rests now. Its end can be a change too.
        const rests = key.until ? Math.min(key.until(t), key.t1) : -Infinity
        if (!(rests > t)) clock.steady = -Infinity
        else if (rests < clock.steady) clock.steady = rests
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

    /**
     * A step that does not take the place of a motion. It sets the value at a time, and a motion that starts
     * at that time stays in effect, whatever the order in which the two were written. A change of the pivot
     * of a node writes the place of the node this way: it keeps the node where it is, and it is not a move.
     * So the order of two animations of one play does not decide if a node moves.
     */
    stepUnder(t: number, value: T): void {
        const keys = this.keys
        let index = keys.length
        while (index > 0 && (keys[index - 1]!.t0 > t || (keys[index - 1]!.t0 === t && moves(keys[index - 1]!)))) index--
        keys.splice(index, 0, { t0: t, t1: t, ease: null, to: value, at: null })
    }

    /** Last time this track changes. */
    get end(): number {
        let end = 0
        for (const key of this.keys) if (key.t1 > end) end = key.t1
        return end
    }
}
