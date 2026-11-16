import { describe, expect, it, vi } from 'vitest'
import { density, orbitals, psi1s, psi2pz, psi3dx2y2, sliceOffset } from '../examples/films/_hydrogen-orbitals/model'
import hydrogenFilm from '../examples/films/hydrogen-orbitals'
import { compileFilm } from '../src/stage/stage'
import { frameToSvg } from '../src/stage/display'

vi.mock('vizmatic/stage', () => import('../src/stage/index'))

describe('analytic hydrogen orbitals', () => {
    it('normalizes every real orbital over space without fitting constants to the rendered grid', () => {
        // Four-point Gauss-Legendre integrates the angular polynomials exactly.
        const mu = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526]
        const weights = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538]
        const steps = 8192, limit = 90, dr = limit / steps, azimuths = 12
        for (const orbital of orbitals) {
            let integral = 0
            for (let i = 0; i <= steps; i++) {
                const r = i * dr
                let angular = 0
                for (let j = 0; j < mu.length; j++) {
                    for (let k = 0; k < azimuths; k++) {
                        const angle = k * 2 * Math.PI / azimuths, rho = r * Math.sqrt(1 - mu[j] ** 2)
                        angular += weights[j] * density(orbital, rho * Math.cos(angle), rho * Math.sin(angle), r * mu[j]) * 2 * Math.PI / azimuths
                    }
                }
                integral += (i === 0 || i === steps ? 1 : i % 2 ? 4 : 2) * r * r * angular
            }
            expect(Math.abs(integral * dr / 3 - 1)).toBeLessThan(1e-8)
        }
    })

    it('satisfies the hydrogen Schrodinger equation away from the Coulomb singularity', () => {
        const h = 0.001
        for (const { psi, n } of orbitals) {
            for (const [x, y, z] of [[1.2, 0.7, 2.1], [-2.3, 1.1, -0.8], [5, 2, 1]]) {
                const value = psi(x, y, z)
                const laplacian = (psi(x + h, y, z) + psi(x - h, y, z) + psi(x, y + h, z) + psi(x, y - h, z) + psi(x, y, z + h) + psi(x, y, z - h) - 6 * value) / (h * h)
                const residual = -0.5 * laplacian - value / Math.hypot(x, y, z) + value / (2 * n * n)
                expect(Math.abs(residual)).toBeLessThan(1e-8)
            }
        }
    })

    it('preserves nodal planes, sign parity, peak density and nonzero tails', () => {
        expect(psi1s(0, 0, 0)).toBeCloseTo(1 / Math.sqrt(Math.PI), 14)
        expect(psi2pz(1, 2, 0)).toBe(0)
        expect(psi2pz(1, 2, 3)).toBe(-psi2pz(1, 2, -3))
        expect(psi3dx2y2(2, 2, 1)).toBe(0)
        expect(psi3dx2y2(2, -2, 1)).toBe(0)
        expect(psi3dx2y2(3, 1, 2)).toBe(-psi3dx2y2(1, 3, 2))
        for (const orbital of orbitals) {
            for (const p of [[0, 0, 0], [2, 1, 3], [6, 0, 0], [1, 9, -3]]) {
                expect(density(orbital, ...p as [number, number, number])).toBeLessThanOrEqual(orbital.peak)
            }
            expect(density(orbital, orbital.extent * 2, 0, orbital.extent)).toBeGreaterThan(0)
        }
    })

    it('moves the section deterministically while the underlying orbital stays fixed', () => {
        const samples = [0, 4, 6, 8, 12].map((t) => sliceOffset(t, 0, 9))
        expect([12, 8, 6, 4, 0].map((t) => sliceOffset(t, 0, 9)).reverse()).toEqual(samples)
        expect(sliceOffset(0, 0, 9)).toBe(0)
        expect(sliceOffset(12, 0, 9)).toBe(0)
        expect(Math.max(...samples)).toBeCloseTo(3.15, 12)
    })

    it('keeps the lower-threshold surface visible and the same density slice after the threshold changes', async () => {
        const film = await compileFilm(hydrogenFilm)
        const before = film.frame(40), after = film.frame(48)
        const triangles = (frame: typeof before) => frame.ops.filter((op) => op.kind === 'path' && op.path[0]?.straight && op.fill !== null && op.fillAlpha > 0.99)
        expect(triangles(after).length).toBeGreaterThan(1000)
        const image = (frame: typeof before) => frame.ops.find((op) => op.kind === 'image')
        expect(image(after)).toEqual(image(before))
        expect(film.svg(48)).toBe(frameToSvg(after))
    })
})
