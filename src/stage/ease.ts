/** Rate functions map animation progress in [0, 1] to eased progress. */
export type Ease = (t: number) => number

const clamp01 = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t

export const linear: Ease = (t) => t

function sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x))
}

/** The house default. A sigmoid with a calm start and a calm landing. */
export function smoothBy(inflection: number): Ease {
    const low = sigmoid(-inflection / 2)
    const high = sigmoid(inflection / 2)
    return (t) => {
        if (t <= 0) return 0
        if (t >= 1) return 1
        return (sigmoid(inflection * (t - 0.5)) - low) / (high - low)
    }
}

export const smooth: Ease = smoothBy(10)
/** Fifth-order smoothstep, for long camera moves. */
export const smoother: Ease = (t) => {
    const x = clamp01(t)
    return x * x * x * (x * (x * 6 - 15) + 10)
}

export const easeInQuad: Ease = (t) => t * t
export const easeOutQuad: Ease = (t) => 1 - (1 - t) * (1 - t)
export const easeInCubic: Ease = (t) => t * t * t
export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3)
export const easeInOutCubic: Ease = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
export const easeOutQuint: Ease = (t) => 1 - Math.pow(1 - t, 5)
export const easeInOutQuint: Ease = (t) => t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2
export const easeOutExpo: Ease = (t) => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
export const easeInExpo: Ease = (t) => t <= 0 ? 0 : Math.pow(2, 10 * t - 10)

export const rushInto: Ease = (t) => 2 * smooth(t / 2)
export const rushFrom: Ease = (t) => 2 * smooth(t / 2 + 0.5) - 1
export const slowInto: Ease = (t) => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))

/** Overshoot the target once, then settle. */
export function overshoot(amount = 1.70158): Ease {
    return (t) => {
        const x = t - 1
        return x * x * ((amount + 1) * x + amount) + 1
    }
}

/** Physically based settle. Exactly 1 at t=1 so holds never drift. */
export function spring(options: { bounce?: number; frequency?: number } = {}): Ease {
    const bounce = options.bounce ?? 0.28
    const frequency = options.frequency ?? 2.2
    const decay = -Math.log(Math.max(0.0001, bounce)) * 2.4
    return (t) => {
        if (t <= 0) return 0
        if (t >= 1) return 1
        return 1 - Math.exp(-decay * t) * Math.cos(frequency * Math.PI * 2 * t) * (1 - t)
    }
}

export const bounce: Ease = (t) => {
    const n = 7.5625, d = 2.75
    if (t < 1 / d) return n * t * t
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
    return n * (t -= 2.625 / d) * t + 0.984375
}

/** Goes to 1 and returns to 0. Ends where it started, for emphasis. */
export const thereAndBack: Ease = (t) => smooth(t < 0.5 ? 2 * t : 2 * (1 - t))

export function thereAndBackWithPause(pause = 1 / 3): Ease {
    const a = (1 - pause) / 2
    return (t) => {
        if (t < a) return smooth(t / a)
        if (t < 1 - a) return 1
        return smooth((1 - t) / a)
    }
}

/** Oscillates around 0 and ends at 0. */
export function wiggle(cycles = 2): Ease {
    return (t) => thereAndBack(t) * Math.sin(cycles * Math.PI * 2 * t)
}

/** Stops short of the target, for an unfinished gesture. */
export function notQuiteThere(amount = 0.7, inner: Ease = smooth): Ease {
    return (t) => amount * inner(t)
}

/** Holds at 1 for the last part of the time. */
export function lingering(hold = 0.25, inner: Ease = smooth): Ease {
    return (t) => inner(clamp01(t / (1 - hold)))
}

/** Backs up briefly, then runs through to the target. */
export function runningStart(pull = -0.5): Ease {
    return (t) => {
        const u = 1 - t
        // Degree-6 Bezier over the values [0, 0, pull, pull, 1, 1, 1].
        return 15 * u ** 4 * t ** 2 * pull + 20 * u ** 3 * t ** 3 * pull
            + 15 * u ** 2 * t ** 4 + 6 * u * t ** 5 + t ** 6
    }
}

/** Restrict an ease to a window of the animation. */
export function during(from: number, to: number, inner: Ease = smooth): Ease {
    return (t) => inner(clamp01((t - from) / (to - from)))
}

/** CSS-style cubic-bezier timing function. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
    const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
    const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
    const slope = (t: number) => (3 * ax * t + 2 * bx) * t + cx
    return (x) => {
        if (x <= 0) return 0
        if (x >= 1) return 1
        let t = x
        for (let i = 0; i < 8; i++) {
            const dx = sampleX(t) - x
            const d = slope(t)
            if (Math.abs(dx) < 1e-5 || Math.abs(d) < 1e-6) break
            t -= dx / d
        }
        return sampleY(t)
    }
}
