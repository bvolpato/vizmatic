import { describe, expect, it } from 'vitest'
import { integrateTrajectory, type TrajectoryOptions } from '../src/stage/trajectory'

describe('deterministic RK4 trajectories', () => {
    const oscillator = (_time: number, [x, v]: readonly number[]) => [v, -x]

    it('preserves oscillator energy over many periods and converges at fourth order', () => {
        const orbit = integrateTrajectory(oscillator, { initial: [1, 0], to: 20 * Math.PI, step: 0.05 })
        for (const [x, v] of orbit.states) expect(Math.abs(x * x + v * v - 1)).toBeLessThan(3e-7)
        const error = (step: number, time: number) => {
            const [x, v] = integrateTrajectory(oscillator, { initial: [1, 0], to: 2, step }).sample(time)
            return Math.hypot(x - Math.cos(time), v + Math.sin(time))
        }
        expect(error(0.2, 2) / error(0.1, 2)).toBeGreaterThan(14)
        expect(error(0.2, 1.73) / error(0.1, 1.73)).toBeGreaterThan(10)
    })

    it('uses explicit nonzero time at all RK stages and supports arbitrary dimensions', () => {
        const trajectory = integrateTrajectory((t, state) => state.map((_, i) => (i + 1) * t ** i), {
            initial: [8, 4, 8, 16], from: 2, to: 3.07, step: 0.17,
        })
        expect(trajectory.times.at(-1)).toBe(3.07)
        for (const t of [2, 2.13, 2.65, 3.07]) {
            const state = trajectory.sample(t)
            expect(state[0]).toBeCloseTo(6 + t, 10)
            expect(state[1]).toBeCloseTo(t ** 2, 10)
            expect(state[2]).toBeCloseTo(t ** 3, 10)
            // Cubic dense output approximates the quartic solution between steps.
            expect(Math.abs(state[3] - t ** 4)).toBeLessThan(0.0001)
        }
    })

    it('keeps a three-dimensional gravitational orbit bounded with small energy and angular momentum drift', () => {
        const inclination = 0.6
        const orbit = integrateTrajectory((_t, [x, y, z, vx, vy, vz]) => {
            const r3 = Math.hypot(x, y, z) ** 3
            return [vx, vy, vz, -x / r3, -y / r3, -z / r3]
        }, { initial: [1, 0, 0, 0, Math.cos(inclination), Math.sin(inclination)], to: 2 * Math.PI, step: 0.02 })
        for (const [x, y, z, vx, vy, vz] of orbit.states) {
            expect(Math.abs((vx * vx + vy * vy + vz * vz) / 2 - 1 / Math.hypot(x, y, z) + 0.5)).toBeLessThan(1e-8)
            expect(Math.abs(Math.hypot(y * vz - z * vy, z * vx - x * vz, x * vy - y * vx) - 1)).toBeLessThan(1e-8)
        }
        expect(Math.hypot(...orbit.sample(2 * Math.PI).slice(0, 3).map((v, i) => v - (i === 0 ? 1 : 0)))).toBeLessThan(1e-6)
    })

    it('includes interior extrema in finite bounds and is independent of sampling order', () => {
        let calls = 0
        const input = [0]
        const arc = integrateTrajectory((t) => { calls++; return [1 - 2 * t] }, { initial: input, to: 1, step: 1 })
        input[0] = 99
        expect(arc.bounds).toEqual([[0, 0.25]])
        expect(arc.sample(0.5)).toEqual([0.25])
        const forward = [0.13, 0.5, 0.89].map(arc.sample)
        expect([0.89, 0.5, 0.13].map(arc.sample).reverse()).toEqual(forward)
        arc.sample(0.5)[0] = 99
        expect(arc.sample(0.5)).toEqual([0.25])
        expect(arc.sample(-1)).toEqual([0])
        expect(arc.sample(9)).toEqual(arc.states.at(-1))
        expect(calls).toBe(5)
        expect(Object.isFrozen(arc.states[0])).toBe(true)
        expect(Object.isFrozen(arc.bounds[0])).toBe(true)
    })

    it('handles a zero duration without calling the derivative', () => {
        const trajectory = integrateTrajectory(() => { throw new Error('must not run') }, { initial: [2, 3, 4], from: 5, to: 5 })
        expect(trajectory.times).toEqual([5])
        expect(trajectory.sample(10)).toEqual([2, 3, 4])
        expect(trajectory.bounds).toEqual([[2, 2], [3, 3], [4, 4]])
    })

    it('does not schedule a spurious step for decimal endpoints', () => {
        for (const to of [0.07, 0.14, 0.28, 0.56]) {
            const trajectory = integrateTrajectory(() => [1], { initial: [0], to, step: 0.01, maxSteps: Math.round(to / 0.01) })
            expect(trajectory.times.length - 1).toBe(Math.round(to / 0.01))
            expect(trajectory.times.at(-1)).toBe(to)
            expect(trajectory.sample(to)[0]).toBeCloseTo(to, 14)
        }
    })

    it('rejects invalid inputs and divergence instead of storing corrupt samples', () => {
        const invalid: Partial<TrajectoryOptions>[] = [
            { initial: [] }, { initial: [NaN] }, { from: Infinity }, { to: NaN }, { to: -1 },
            { step: 0 }, { step: -1 }, { step: Infinity }, { maxSteps: 1.5 },
        ]
        for (const options of invalid) {
            expect(() => integrateTrajectory(() => [1], { initial: [0], to: 1, ...options })).toThrow(RangeError)
        }
        expect(() => integrateTrajectory(() => [Infinity], { initial: [0], to: 1 })).toThrow('finite components')
        expect(() => integrateTrajectory(() => [1, 2], { initial: [0], to: 1 })).toThrow('1 finite components')
        expect(() => integrateTrajectory((_t, [x]) => [x * 1e300], { initial: [1e300], to: 1 })).toThrow('finite components')
        const trajectory = integrateTrajectory(() => [1], { initial: [0], to: 1 })
        expect(() => trajectory.sample(NaN)).toThrow('sample time must be finite')
    })

    it('bounds work before evaluation and makes random-access samples without new integration', () => {
        let calls = 0
        const derivative = (_t: number, state: readonly number[]) => { calls++; return state.map(() => 1) }
        expect(() => integrateTrajectory(derivative, { initial: [0], to: 1, step: Number.MIN_VALUE })).toThrow('sampling budget')
        expect(() => integrateTrajectory(derivative, { initial: [0], to: 100, step: 0.001, maxSteps: 100 })).toThrow('sampling budget')
        expect(calls).toBe(0)
        const started = performance.now()
        const trajectory = integrateTrajectory(derivative, { initial: [0, 1, 2, 3, 4, 5], to: 100, step: 0.01 })
        const builtCalls = calls
        expect(builtCalls).toBe(40_001)
        for (let i = 0; i < 2000; i++) {
            const t = ((i * 7919) % 10000) / 100
            expect(trajectory.sample(t)[5]).toBeCloseTo(t + 5, 8)
        }
        expect(calls).toBe(builtCalls)
        expect(performance.now() - started).toBeLessThan(3000)
    })
})
