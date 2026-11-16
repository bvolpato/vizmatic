import { describe, expect, it } from 'vitest'
import { FLIPS, LOG_MULTIPLICITIES, MULTIPLICITIES, PARTICLES, STEPS, multiplicity, stateAt } from '../examples/films/_boltzmann-entropy/model'

describe('two-compartment coarse-grained entropy model', () => {
    it('matches exhaustive left/right assignment counts and exact binomial normalization', () => {
        const counts = Array<number>(PARTICLES + 1).fill(0)
        for (let mask = 0; mask < 2 ** PARTICLES; mask++) {
            let bits = mask, left = 0
            while (bits) { bits &= bits - 1; left++ }
            counts[left]++
        }
        expect(MULTIPLICITIES).toEqual(counts)
        expect(MULTIPLICITIES.reduce((sum, n) => sum + n, 0)).toBe(2 ** PARTICLES)
        expect(multiplicity(20)).toBe(1)
        expect(multiplicity(10)).toBe(184756)
        expect(LOG_MULTIPLICITIES[10]).toBeCloseTo(Math.log(184756), 12)
        expect(() => multiplicity(1.5)).toThrow('integer')
        expect(() => multiplicity(21)).toThrow('integer')
    })

    it('moves exactly the selected particle at each urn event and preserves every identity', () => {
        for (let step = 0; step < STEPS; step++) {
            const before = stateAt(step), after = stateAt(step + 1)
            const changed = before.particles.filter((particle, i) => particle.left !== after.particles[i].left)
            expect(changed.map((p) => p.id)).toEqual([FLIPS[step]])
            for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
                const state = stateAt(step + fraction)
                expect(new Set(state.particles.map((p) => p.id)).size).toBe(PARTICLES)
                expect(state.left + state.right).toBe(PARTICLES)
                expect(state.left).toBe(state.particles.filter((p) => p.x < 0).length)
                expect(state.omega).toBe(multiplicity(state.left))
                expect(state.particles.every((p) => Math.abs(p.x) < 1 && Math.abs(p.y) < 1)).toBe(true)
            }
        }
    })

    it('is seekable and includes entropy decreases as finite fluctuations', () => {
        const times = [0, 3.25, 12.5, 24.7, 50, STEPS]
        const forward = times.map(stateAt)
        expect([...times].reverse().map(stateAt).reverse()).toEqual(forward)
        const values = Array.from({ length: STEPS + 1 }, (_, step) => stateAt(step).logOmega)
        expect(values.some((v, i) => i > 0 && v < values[i - 1])).toBe(true)
        expect(values.some((v, i) => i > 0 && v > values[i - 1])).toBe(true)
        expect(stateAt(-1)).toEqual(stateAt(0))
        expect(stateAt(STEPS + 1)).toEqual(stateAt(STEPS))
    })
})
