import { assertEqual, complex, type Vec } from 'vizmatic/stage'

// David Tong, Quantum Mechanics, §2.4.2, equations (2.58)–(2.61).
// https://www.damtp.cam.ac.uk/user/tong/qm/qmhtml/S2.html#S2.SS4.SSS2
// Translate his barrier [-a,a] to [0,L], with L=2a. Units: hbar=2m=V0=1.
export const ENERGY = 0.4
export const WIDTHS = [1.2, 2.4, 3.6] as const
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]]
const scale = (a: Vec, n: number): Vec => [a[0] * n, a[1] * n]
export const norm2 = (z: Vec): number => z[0] ** 2 + z[1] ** 2
const phase = (angle: number): Vec => [Math.cos(angle), Math.sin(angle)]

/** Exact stationary solution, normalized to unit incoming amplitude, not unit integrated density. */
export function scattering(width: number, energy = ENERGY) {
    if (!Number.isFinite(width) || width < 0 || !(energy > 0 && energy < 1)) throw new Error('Scattering requires width >= 0 and 0 < E < V0=1')
    const k = Math.sqrt(energy), kappa = Math.sqrt(1 - energy)
    const c = Math.cosh(kappa * width), h = Math.sinh(kappa * width)
    // Propagate unit transmitted amplitude backward through the barrier, then normalize its incident part.
    const incoming: Vec = [c, (kappa / k - k / kappa) * h / 2]
    const reflected: Vec = [0, -(k / kappa + kappa / k) * h / 2]
    const r = complex.div(reflected, incoming), exit = complex.div([1, 0], incoming)
    const left = (x: number): Vec => add(phase(k * x), complex.mul(r, phase(-k * x)))
    const leftDerivative = (x: number): Vec => complex.mul([0, k], add(phase(k * x), scale(complex.mul(r, phase(-k * x)), -1)))
    const inside = (x: number): Vec => complex.mul(exit, [Math.cosh(kappa * (x - width)), k / kappa * Math.sinh(kappa * (x - width))])
    const insideDerivative = (x: number): Vec => complex.mul(exit, [kappa * Math.sinh(kappa * (x - width)), k * Math.cosh(kappa * (x - width))])
    const right = (x: number): Vec => complex.mul(exit, phase(k * (x - width)))
    const rightDerivative = (x: number): Vec => complex.mul([0, k], right(x))
    const stationary = (x: number): Vec => x < 0 ? left(x) : x > width ? right(x) : inside(x)
    const derivative = (x: number): Vec => x < 0 ? leftDerivative(x) : x > width ? rightDerivative(x) : insideDerivative(x)
    const psi = (x: number, time: number): Vec => complex.mul(stationary(x), phase(-energy * time))
    const current = (x: number): number => {
        const z = stationary(x), dz = derivative(x)
        return 2 * (z[0] * dz[1] - z[1] * dz[0])
    }
    return { width, energy, k, kappa, r, exit, R: norm2(r), T: norm2(exit), left, inside, right, leftDerivative, insideDerivative, rightDerivative, stationary, psi, current }
}

/** Independent boundary, flux, differential-equation and closed-form checks, also run by browser films. */
export function verifyScattering(): void {
    const near = (a: number, b: number, why: string, tolerance = 1e-9) => assertEqual(Math.abs(a - b) < tolerance, true, why)
    const same = (a: Vec, b: Vec, why: string) => { near(a[0], b[0], why); near(a[1], b[1], why) }
    for (const energy of [0.15, ENERGY, 0.85]) for (const width of [0, ...WIDTHS]) {
        const m = scattering(width, energy)
        near(m.R + m.T, 1, 'Reflected and transmitted probability currents sum to incident current')
        near(m.T, 1 / (1 + Math.sinh(m.kappa * width) ** 2 / (4 * energy * (1 - energy))), 'Transmission agrees with Tong equation 2.61')
        same(m.left(0), m.inside(0), 'Wavefunction is continuous at entry')
        same(m.leftDerivative(0), m.insideDerivative(0), 'Derivative is continuous at entry')
        same(m.inside(width), m.right(width), 'Wavefunction is continuous at exit')
        same(m.insideDerivative(width), m.rightDerivative(width), 'Derivative is continuous at exit')
        for (const x of [-2, ...(width ? [width / 2] : []), width + 2]) {
            near(m.current(x), 2 * m.k * m.T, 'Current is constant in all three regions')
            near(norm2(m.psi(x, 3.7)), norm2(m.stationary(x)), 'Density is stationary while phase rotates')
            const dx = 1e-3, a = m.stationary(x - dx), b = m.stationary(x), c = m.stationary(x + dx)
            const potential = x > 0 && x < width ? 1 : 0
            for (const i of [0, 1] as const) near(-(a[i] - 2 * b[i] + c[i]) / dx ** 2 + potential * b[i], energy * b[i], 'Finite-difference Schrodinger residual', 2e-6)
        }
    }
}
