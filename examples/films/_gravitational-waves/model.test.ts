import { describe, expect, it } from 'vitest'
import { period, ringPoint, separation, speed, strain, strainAmplitude, ttMatrix } from './model'

describe('the gravitational-wave film model', () => {
    it('is symmetric, transverse and traceless for every polarization', () => {
        for (const mode of ['plus', 'cross', 'circular'] as const) {
            const { plus, cross } = strain(0.7, 1.3, mode)
            const h = ttMatrix(plus, cross)
            expect(h[0][1]).toBe(h[1][0])
            expect(h[0][0] + h[1][1] + h[2][2]).toBe(0)
            expect(h[2]).toEqual([0, 0, 0])
            expect(h.map((row) => row[2])).toEqual([0, 0, 0])
        }
    })

    it('propagates phase toward +z at c and obeys the vacuum wave equation', () => {
        const step = 1e-3, z = 0.73, t = 0.21
        for (const mode of ['plus', 'cross', 'circular'] as const) {
            const here = strain(z, t, mode), later = strain(z + speed * 0.61, t + 0.61, mode)
            for (const key of ['plus', 'cross'] as const) {
                expect(later[key]).toBeCloseTo(here[key], 14)
                const dtt = (strain(z, t + step, mode)[key] - 2 * here[key] + strain(z, t - step, mode)[key]) / step ** 2
                const dzz = (strain(z + step, t, mode)[key] - 2 * here[key] + strain(z - step, t, mode)[key]) / step ** 2
                expect(dtt - speed ** 2 * dzz).toBeCloseTo(0, 10)
            }
        }
    })

    it('stretches opposite transverse directions with the required factor of one half', () => {
        expect(separation(1, 0, strainAmplitude, 0)).toEqual([1 + strainAmplitude / 2, 0])
        expect(separation(0, 1, strainAmplitude, 0)).toEqual([0, 1 - strainAmplitude / 2])
        const u = Math.SQRT1_2
        const rotated = separation(u, u, 0, strainAmplitude)
        expect(rotated[0]).toBeCloseTo(u * (1 + strainAmplitude / 2), 14)
        expect(rotated[1]).toBeCloseTo(rotated[0], 14)
        // Area preservation is first order only, not an exact claim.
        const a = separation(1, 0, strainAmplitude, strainAmplitude)
        const b = separation(0, 1, strainAmplitude, strainAmplitude)
        expect(a[0] * b[1] - a[1] * b[0]).toBeCloseTo(1 - strainAmplitude ** 2 / 2, 14)
    })

    it('keeps each test mass in its transverse plane and reverses strain after half a cycle', () => {
        for (const angle of [0, 0.4, Math.PI / 2, Math.PI]) {
            const a = ringPoint(angle, 1.2, 0.7, 'circular', 1)
            const b = ringPoint(angle, 1.2, 0.7 + period / 2, 'circular', 1)
            expect(a[2]).toBe(1.2)
            expect(b[2]).toBe(1.2)
            expect((a[0] + b[0]) / 2).toBeCloseTo(Math.cos(angle), 14)
            expect((a[1] + b[1]) / 2).toBeCloseTo(Math.sin(angle), 14)
        }
    })
})
