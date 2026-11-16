import { expect, it } from 'vitest'
import { scattering, verifyScattering, WIDTHS } from '../examples/films/_quantum-tunneling/model'

it('satisfies the scattering boundaries, conserved current, and stationary Schrodinger equation', () => {
    expect(verifyScattering).not.toThrow()
    expect(scattering(0).T).toBe(1)
    const transmission = WIDTHS.map((width) => scattering(width).T)
    expect(transmission[0]).toBeGreaterThan(transmission[1])
    expect(transmission[1]).toBeGreaterThan(transmission[2])
    expect(transmission[2]).toBeGreaterThan(0)
})
