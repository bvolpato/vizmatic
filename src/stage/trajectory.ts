/** A pure, explicitly time-dependent differential equation dy/dt = f(t, y). */
export type TrajectoryDerivative = (time: number, state: readonly number[]) => readonly number[]

export interface TrajectoryOptions {
    initial: readonly number[]
    from?: number
    to: number
    /** Maximum RK4 step size. The last step ends exactly at `to`. Defaults to 1/120. */
    step?: number
    /** Work limit, checked before evaluating the derivative. Defaults to 100,000. */
    maxSteps?: number
}

export interface Trajectory {
    readonly times: readonly number[]
    readonly states: readonly (readonly number[])[]
    /** Component bounds, including extrema of the cubic interpolant between steps. */
    readonly bounds: readonly (readonly [number, number])[]
    /** Cubic Hermite interpolation, clamped to the time interval. Returns a fresh array. */
    sample(time: number): number[]
}

const MAX_VALUES = 2_000_000

function finiteState(state: readonly number[], dimension: number, time: number): number[] {
    const values = Array.from(state)
    if (values.length !== dimension || !values.every(Number.isFinite)) {
        throw new RangeError(`trajectory: expected ${dimension} finite components at time ${time}`)
    }
    return values
}

/**
 * Precompute fixed-step RK4 in any dimension. The derivative must be pure: it
 * receives explicit time, never the film clock. Sampling does not integrate or
 * call the derivative, so reverse playback and out-of-order frames agree.
 * This explicit solver is for non-stiff systems; reduce `step` to check accuracy.
 */
export function integrateTrajectory(derivative: TrajectoryDerivative, options: TrajectoryOptions): Trajectory {
    const from = options.from ?? 0, to = options.to, step = options.step ?? 1 / 120
    const maxSteps = options.maxSteps ?? 100_000
    const dimension = options.initial.length
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || !Number.isFinite(to - from)) {
        throw new RangeError('trajectory: require finite times with to >= from')
    }
    if (!Number.isFinite(step) || step <= 0 || !Number.isSafeInteger(maxSteps) || maxSteps < 1) {
        throw new RangeError('trajectory: step must be positive and finite; maxSteps must be a positive integer')
    }
    const steps = (to - from) / step
    if (!Number.isFinite(steps)) throw new RangeError('trajectory: sampling budget exceeded')
    // Decimal divisions such as 0.07 / 0.01 can round just above an integer.
    const count = to === from ? 0 : Math.max(1, Math.ceil(steps - 4 * Number.EPSILON * Math.max(1, steps)))
    if (!dimension || count > maxSteps || (count + 1) * dimension > MAX_VALUES) {
        throw new RangeError('trajectory: empty state or sampling budget exceeded (maxSteps or 2,000,000 state values)')
    }
    const states: (readonly number[])[] = [Object.freeze(finiteState(options.initial, dimension, from))]
    const times = [from]
    const slopes: number[][] = []
    const evaluate = (time: number, state: readonly number[]): number[] =>
        finiteState(derivative(time, Object.freeze(finiteState(state, dimension, time))), dimension, time)

    if (count) slopes.push(evaluate(from, states[0]))
    for (let i = 0; i < count; i++) {
        const time = times[i], end = i === count - 1 ? to : Math.min(to, from + (i + 1) * step)
        const h = end - time, middle = time + h / 2
        if (!(end > time) || middle === time || middle === end) {
            throw new RangeError('trajectory: step is too small to advance time at this magnitude')
        }
        const y = states[i], k1 = slopes[i]
        const k2 = evaluate(middle, y.map((v, j) => v + h * (k1[j] / 2)))
        const k3 = evaluate(middle, y.map((v, j) => v + h * (k2[j] / 2)))
        const k4 = evaluate(end, y.map((v, j) => v + h * k3[j]))
        const next = finiteState(y.map((v, j) => v + h * (k1[j] / 6 + k2[j] / 3 + k3[j] / 3 + k4[j] / 6)), dimension, end)
        times.push(end)
        states.push(Object.freeze(next))
        slopes.push(evaluate(end, next))
    }

    // Store polynomial coefficients once, so sample() is O(log steps + dimension).
    const coefficients: number[][] = []
    const bounds: [number, number][] = states[0].map((v) => [v, v])
    for (let i = 0; i < count; i++) {
        const h = times[i + 1] - times[i], row: number[] = []
        for (let j = 0; j < dimension; j++) {
            const start = states[i][j], end = states[i + 1][j]
            const m0 = h * slopes[i][j], m1 = h * slopes[i + 1][j], delta = end - start
            const a = m0 + m1 - 2 * delta, b = 3 * delta - 2 * m0 - m1, c = m0
            if (![a, b, c, delta].every(Number.isFinite)) {
                throw new RangeError('trajectory: non-finite interpolation coefficients; rescale the state or reduce step')
            }
            row.push(a, b, c)
            const range = bounds[j]
            range[0] = Math.min(range[0], end)
            range[1] = Math.max(range[1], end)
            // Solve 3*a*u^2 + 2*b*u + c = 0 after scaling to avoid overflow.
            const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c))
            const aa = scale ? 3 * (a / scale) : 0, bb = scale ? 2 * (b / scale) : 0, cc = scale ? c / scale : 0
            const discriminant = bb * bb - 4 * aa * cc
            const roots: number[] = []
            if (aa === 0) {
                if (bb !== 0) roots.push(-cc / bb)
            } else if (discriminant >= 0) {
                const q = -0.5 * (bb + (bb < 0 ? -1 : 1) * Math.sqrt(discriminant))
                roots.push(q / aa)
                if (q !== 0) roots.push(cc / q)
            }
            for (const u of roots) {
                if (u > 0 && u < 1) {
                    const value = ((a * u + b) * u + c) * u + start
                    if (!Number.isFinite(value)) throw new RangeError('trajectory: non-finite interpolated state')
                    range[0] = Math.min(range[0], value)
                    range[1] = Math.max(range[1], value)
                }
            }
        }
        coefficients.push(row)
    }

    return Object.freeze({
        times: Object.freeze(times),
        states: Object.freeze(states),
        bounds: Object.freeze(bounds.map((range) => Object.freeze(range))),
        sample(time: number): number[] {
            if (!Number.isFinite(time)) throw new RangeError('trajectory: sample time must be finite')
            if (time <= from || !count) return Array.from(states[0])
            if (time >= to) return Array.from(states[count])
            let low = 0, high = count
            while (high - low > 1) {
                const middle = (low + high) >>> 1
                if (times[middle] <= time) low = middle
                else high = middle
            }
            const u = (time - times[low]) / (times[low + 1] - times[low]), row = coefficients[low]
            return states[low].map((v, j) => {
                const k = j * 3
                const value = ((row[k] * u + row[k + 1]) * u + row[k + 2]) * u + v
                // Roundoff near an extremum must not put a sample outside its reported bounds.
                return Math.max(bounds[j][0], Math.min(bounds[j][1], value))
            })
        },
    })
}
