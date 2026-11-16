import { describe, expect, it } from 'vitest'
import { PLANETS, orbitalState, type Planet } from './model'

const TAU = 2 * Math.PI
const reference: Planet = {
    id: 'reference', name: 'Reference', a: 2, period: 3, eccentricity: 0.6, inclination: 0,
}

describe('the planetary-orbits film model', () => {
    it('closes after positive and negative whole periods from arbitrary phases', () => {
        for (const planet of PLANETS) {
            for (const fraction of [-0.37, 0, 0.19, 0.83]) {
                const time = fraction * planet.period
                const initial = orbitalState(planet, time)
                for (const cycles of [-11, -1, 1, 17]) {
                    const repeated = orbitalState(planet, time + cycles * planet.period)
                    repeated.position.forEach((value, axis) => expect(value).toBeCloseTo(initial.position[axis], 10))
                    expect(Math.cos(repeated.anomaly)).toBeCloseTo(Math.cos(initial.anomaly), 11)
                    expect(Math.sin(repeated.anomaly)).toBeCloseTo(Math.sin(initial.anomaly), 11)
                }
            }
        }
    })

    it('keeps the Sun at a focus and reaches a(1-e) and a(1+e)', () => {
        for (const source of [...PLANETS, reference]) {
            const planet = { ...source, meanAnomalyAtEpoch: 0 }
            const near = orbitalState(planet, 0), far = orbitalState(planet, planet.period / 2)
            const { a, eccentricity: e } = planet
            expect(Math.hypot(...near.position)).toBeCloseTo(a * (1 - e), 12)
            expect(Math.hypot(...far.position)).toBeCloseTo(a * (1 + e), 12)
            const secondFocus = near.position.map((value) => -2 * e * value / (1 - e))
            for (const fraction of [0.07, 0.23, 0.41, 0.68, 0.91]) {
                const state = orbitalState(planet, fraction * planet.period)
                const otherDistance = Math.hypot(...state.position.map((value, axis) => value - secondFocus[axis]))
                expect(Math.hypot(...state.position) + otherDistance).toBeCloseTo(2 * a, 11)
                expect(state.radius).toBeCloseTo(Math.hypot(...state.position), 12)
                expect(state.radius).toBeGreaterThanOrEqual(a * (1 - e))
                expect(state.radius).toBeLessThanOrEqual(a * (1 + e))
                expect(state.radius * (1 + e * Math.cos(state.anomaly))).toBeCloseTo(a * (1 - e * e), 11)
            }
        }
    })

    it('satisfies Kepler even for circular and highly eccentric ellipses', () => {
        const orbits = [...PLANETS, ...[0, 0.8, 0.99, 0.999999].map((eccentricity) => ({ ...reference, eccentricity }))]
        for (const planet of orbits) {
            for (const fraction of [-0.999, -1e-9, 0, 1e-9, 0.001, 0.13, 0.5, 0.87, 0.999]) {
                const state = orbitalState(planet, fraction * planet.period)
                const residual = state.eccentricAnomaly - planet.eccentricity * Math.sin(state.eccentricAnomaly) - state.meanAnomaly
                expect(Math.abs(residual)).toBeLessThan(2e-13)
                expect(state.position.every(Number.isFinite)).toBe(true)
            }
        }
    })

    it('sweeps equal areas in equal times, including across perihelion', () => {
        for (const planet of [...PLANETS, reference]) {
            const area = (time: number) => {
                const { eccentricAnomaly: E } = orbitalState(planet, time)
                return 0.5 * planet.a ** 2 * Math.sqrt(1 - planet.eccentricity ** 2) * (E - planet.eccentricity * Math.sin(E))
            }
            const totalArea = Math.PI * planet.a ** 2 * Math.sqrt(1 - planet.eccentricity ** 2)
            const interval = planet.period / 32
            for (let index = 0; index < 32; index++) {
                const swept = (area((index + 1) * interval) - area(index * interval) + totalArea) % totalArea
                expect(swept / totalArea).toBeCloseTo(1 / 32, 12)
            }
        }
    })

    it('applies perihelion, inclination and ascending-node rotations in order', () => {
        const planet = { ...reference, node: Math.PI / 2, inclination: Math.PI / 2, periapsis: Math.PI / 2 }
        const near = orbitalState(planet, 0).position
        expect(near[0]).toBeCloseTo(0, 14)
        expect(near[1]).toBeCloseTo(0, 14)
        expect(near[2]).toBeCloseTo(reference.a * (1 - reference.eccentricity), 14)
        const E = Math.PI / 2
        const time = (E - reference.eccentricity) / TAU * reference.period
        const point = orbitalState(planet, time).position
        expect(point[0]).toBeCloseTo(0, 14)
        expect(point[1]).toBeCloseTo(-reference.a * Math.sqrt(1 - reference.eccentricity ** 2), 14)
        expect(point[2]).toBeCloseTo(-reference.a * reference.eccentricity, 14)
    })

    it('returns finite, identical states for repeated seeks regardless of call order', () => {
        const times = [-Number.MAX_VALUE, -1e12, -101.25, -0.01, 0, 0.25, 80.3, 1e12, Number.MAX_VALUE]
        for (const planet of PLANETS) {
            const expected = times.map((time) => orbitalState(planet, time))
            for (const index of [8, 0, 4, 1, 7, 3, 5, 2, 6]) {
                const state = orbitalState(planet, times[index])
                expect(state).toEqual(expected[index])
                for (const value of [...state.position, state.anomaly, state.meanAnomaly, state.eccentricAnomaly, state.radius]) {
                    expect(Number.isFinite(value)).toBe(true)
                }
            }
        }
        for (const time of [NaN, Infinity, -Infinity]) {
            expect(() => orbitalState(reference, time)).toThrow('years must be finite')
        }
        for (const eccentricity of [-0.1, 1, NaN]) {
            expect(() => orbitalState({ ...reference, eccentricity }, 0)).toThrow('eccentricity must be in [0, 1)')
        }
    })
})
