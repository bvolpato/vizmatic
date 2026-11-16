// Linearized TT metric and local separation response, to FIRST ORDER in h:
// https://www.damtp.cam.ac.uk/user/tong/gr/grhtml/S5.html#S5.SS2
// Eqs. 5.235-5.238. Physical strain is small; only its drawn displacement is
// magnified. The display map is not an exact finite-strain spacetime metric.
export const strainAmplitude = 1e-3
export const displayGain = 600
export const wavelength = 4
export const speed = 1
export const period = wavelength / speed
export type Polarization = 'plus' | 'cross' | 'circular'

export function strain(z: number, time: number, polarization: Polarization): { plus: number; cross: number } {
    const phase = 2 * Math.PI * (z - speed * time) / wavelength
    return {
        plus: polarization === 'cross' ? 0 : strainAmplitude * Math.cos(phase),
        cross: polarization === 'plus' ? 0 : strainAmplitude * (polarization === 'cross' ? Math.cos(phase) : Math.sin(phase)),
    }
}

export function ttMatrix(plus: number, cross: number): number[][] {
    return [[plus, cross, 0], [cross, -plus, 0], [0, 0, 0]]
}

export function separation(x: number, y: number, plus: number, cross: number, gain = 1): [number, number] {
    return [x + gain * (plus * x + cross * y) / 2,
        y + gain * (cross * x - plus * y) / 2]
}

export function ringPoint(angle: number, z: number, time: number, polarization: Polarization, gain = displayGain): [number, number, number] {
    const { plus, cross } = strain(z, time, polarization)
    return [...separation(Math.cos(angle), Math.sin(angle), plus, cross, gain), z]
}
