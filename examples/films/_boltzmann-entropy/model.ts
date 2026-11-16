/** A finite two-compartment urn model, not molecular dynamics. A microstate in
 * this coarse description is one left/right bit for each of 20 labeled particles.
 * Coordinates within a half and momenta are deliberately not counted.
 */
export const PARTICLES = 20
export const STEPS = 42

export function multiplicity(left: number): number {
    if (!Number.isInteger(left) || left < 0 || left > PARTICLES) throw new RangeError('left count must be an integer from 0 to 20')
    let result = 1
    for (let k = 1; k <= Math.min(left, PARTICLES - left); k++) result = result * (PARTICLES - k + 1) / k
    return Math.round(result)
}

export const MULTIPLICITIES = Array.from({ length: PARTICLES + 1 }, (_, n) => multiplicity(n))
export const LOG_MULTIPLICITIES = MULTIPLICITIES.map(Math.log)

// One seeded Ehrenfest-style urn realization. Each event flips one selected
// particle's side. Animation interpolates the relocation; it is not a gas trajectory.
let seed = 0x5eeda11
export const FLIPS: readonly number[] = Array.from({ length: STEPS }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return Math.floor(seed / 2 ** 32 * PARTICLES)
})
const assignments: readonly (readonly boolean[])[] = (() => {
    const states = [Array<boolean>(PARTICLES).fill(true)]
    for (const id of FLIPS) {
        const next = [...states[states.length - 1]]
        next[id] = !next[id]
        states.push(next)
    }
    return states
})()

export interface ParticleState { id: number; x: number; y: number; left: boolean; moving: boolean }
export interface EntropyState {
    particles: ParticleState[]
    left: number
    right: number
    omega: number
    logOmega: number
}

/** Pure state at a fractional urn step. Counts come from the displayed side,
 * including the crossing frame, so every dot agrees with the numeric readout.
 */
export function stateAt(step: number): EntropyState {
    if (!Number.isFinite(step)) throw new TypeError('urn step must be finite')
    const progress = Math.max(0, Math.min(STEPS, step)), index = Math.floor(progress)
    const fraction = progress - index
    const eased = (1 - Math.cos(Math.PI * fraction)) / 2
    const particles = assignments[index].map((left, id) => {
        const moving = index < STEPS && FLIPS[index] === id
        // Each particle has a stable lane; all coordinates remain in [-1, 1].
        const reach = 0.2 + (id % 4) * 0.2
        const initialX = left ? -reach : reach
        const x = moving ? initialX * (1 - 2 * eased) : initialX
        const y = -0.76 + Math.floor(id / 4) * 0.38 + 0.035 * Math.sin(progress * 1.7 + id * 2.1)
        return { id, x, y, left: x < 0, moving }
    })
    const left = particles.filter((particle) => particle.left).length
    return { particles, left, right: PARTICLES - left, omega: MULTIPLICITIES[left], logOmega: LOG_MULTIPLICITIES[left] }
}
