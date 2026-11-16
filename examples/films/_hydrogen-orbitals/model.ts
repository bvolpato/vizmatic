/**
 * Normalized real spatial eigenfunctions for nonrelativistic hydrogen, with
 * a fixed proton, Z = 1 and coordinates in Bohr radii a0. Returned amplitudes
 * have units a0^(-3/2), and their squares have units a0^(-3).
 *
 * UCSB PHYSCS36, Hydrogen Atom Wavefunctions (1s and 2pz):
 * https://web.ece.ucsb.edu/~ilan/Classes/PHYSCS36_S2008/Hydrogen_Wavefunctions.htm
 * Rosenthal, University of Delaware CHEM651, normalized real d orbitals:
 * https://www1.udel.edu/chem/rosenthal/CHEM651/Fall%202012/Lectures/Lecture%201%20-%20Structure%20of%20the%20Atom_Slides.pdf
 * The real x2-y2 orbital is the normalized sum of m = +2 and m = -2.
 * Global time phase is omitted; stationary-state density does not change.
 */
export const psi1s = (x: number, y: number, z: number): number => Math.exp(-Math.hypot(x, y, z)) / Math.sqrt(Math.PI)
export const psi2pz = (x: number, y: number, z: number): number => z * Math.exp(-Math.hypot(x, y, z) / 2) / (4 * Math.sqrt(2 * Math.PI))
export const psi3dx2y2 = (x: number, y: number, z: number): number => (x * x - y * y) * Math.exp(-Math.hypot(x, y, z) / 3) / (81 * Math.sqrt(2 * Math.PI))

export const orbitals = [
    { id: '1s', psi: psi1s, n: 1, l: 0, extent: 3, unit: 150, peak: psi1s(0, 0, 0) ** 2, slice: 'xz', formula: '\\psi_{1s}=\\frac{e^{-r}}{\\sqrt{\\pi}}', nodes: 'No nodal plane' },
    { id: '2pz', psi: psi2pz, n: 2, l: 1, extent: 9, unit: 28, peak: psi2pz(0, 0, 2) ** 2, slice: 'xz', formula: '\\psi_{2p_z}=\\frac{z e^{-r/2}}{4\\sqrt{2\\pi}}', nodes: 'One nodal plane: z = 0' },
    { id: '3dx2-y2', psi: psi3dx2y2, n: 3, l: 2, extent: 22, unit: 14, peak: psi3dx2y2(6, 0, 0) ** 2, slice: 'xy', formula: '\\psi_{3d_{x^2-y^2}}=\\frac{(x^2-y^2)e^{-r/3}}{81\\sqrt{2\\pi}}', nodes: 'Two nodal planes: x = ±y' },
] as const

/** Model coordinates of the moving section; this moves the view, not the state. */
export function sliceOffset(time: number, start: number, extent: number): number {
    const phase = Math.max(0, Math.min(1, (time - start - 2) / 8))
    return phase === 0 || phase === 1 ? 0 : extent * 0.35 * Math.sin(2 * Math.PI * phase)
}

export function density(orbital: typeof orbitals[number], x: number, y: number, z: number): number {
    return orbital.psi(x, y, z) ** 2
}
