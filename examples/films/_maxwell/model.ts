import { assertEqual, type Vec3 } from 'vizmatic/stage'

// Tong, Electrodynamics, §§4.3.1–4.3.2 and 4.4:
// https://www.damtp.cam.ac.uk/user/tong/em/em3.pdf
// E is in units of E0, cB in the same units, and distance/time units give c = 1.
export const C = 1
export const K = 2 * Math.PI / 5
export const OMEGA = C * K
export const PERIOD = 2 * Math.PI / OMEGA

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function wave(x: number, t: number, ratio: number): { e: Vec3; cb: Vec3 } {
  const phase = K * x - OMEGA * t
  const e: Vec3 = [0, ratio * Math.sin(phase), Math.cos(phase)]
  return { e, cb: cross([1, 0, 0], e) }
}

// Each shot is a distinct monochromatic solution, not a time-varying medium.
export function polarizationAt(time: number): number {
  return time < 16 ? 0 : time < 25 ? 0.5 : 1
}

export function verifyPlaneWaves(): void {
  const near = (a: number, b: number, why: string, tolerance = 1e-9) =>
    assertEqual(Math.abs(a - b) < tolerance, true, why)
  const h = 1e-4
  const derivative = (a: Vec3, b: Vec3): Vec3 => [
    (a[0] - b[0]) / (2 * h), (a[1] - b[1]) / (2 * h), (a[2] - b[2]) / (2 * h),
  ]
  const curlAlongX = (d: Vec3): Vec3 => [0, -d[2], d[1]]

  near(OMEGA, C * K, 'Vacuum dispersion: omega = ck')
  for (const ratio of [0, 0.5, 1]) {
    let meanFlux = 0
    for (let i = 0; i < 64; i++) {
      const t = i * PERIOD / 64
      const x = 0.37
      const { e, cb } = wave(x, t, ratio)
      const flow = cross(e, cb)
      const e2 = e.reduce((sum, v) => sum + v * v, 0)
      near(e[0], 0, 'E is transverse and divergence-free')
      near(cb[0], 0, 'B is transverse and divergence-free')
      near(e.reduce((sum, v, j) => sum + v * cb[j], 0), 0, 'E and B are orthogonal')
      near(Math.hypot(...e), Math.hypot(...cb), '|E| = |cB|')
      near(flow[0], e2, 'E cross cB = |E| squared along +x')
      near(flow[1], 0, 'No transverse energy flow along y')
      near(flow[2], 0, 'No transverse energy flow along z')
      assertEqual(flow[0] >= 0, true, 'Energy never flows backward')
      const shifted = wave(x + C * 0.23, t + 0.23, ratio)
      for (let j = 0; j < 3; j++) {
        near(shifted.e[j], e[j], 'E travels at +c')
        near(shifted.cb[j], cb[j], 'cB travels at the same +c')
      }

      // Independent centered differences check both curl equations, including signs.
      const xp = wave(x + h, t, ratio), xm = wave(x - h, t, ratio)
      const tp = wave(x, t + h, ratio), tm = wave(x, t - h, ratio)
      const curlE = curlAlongX(derivative(xp.e, xm.e))
      const curlB = curlAlongX(derivative(xp.cb, xm.cb))
      const dtE = derivative(tp.e, tm.e), dtB = derivative(tp.cb, tm.cb)
      for (let j = 0; j < 3; j++) {
        near(curlE[j], -dtB[j], 'Faraday: curl E = -dt B, c = 1', 1e-8)
        near(curlB[j], dtE[j], 'Ampere-Maxwell: curl B = dt E, c = 1', 1e-8)
      }
      if (ratio === 0) near(e[1], 0, 'Linear polarization stays on one axis')
      else near(e[1] ** 2 / ratio ** 2 + e[2] ** 2, 1, 'Observer tip lies on the displayed ellipse')
      if (ratio === 1) near(e2, 1, 'Circular polarization has constant magnitude and flux')
      meanFlux += flow[0] / 64
    }
    near(meanFlux, (1 + ratio ** 2) / 2, 'Cycle-average flux follows the squared component amplitudes')
    const zeroPhaseTime = 0
    const now = wave(0, zeroPhaseTime, ratio)
    const quarter = wave(0, zeroPhaseTime + PERIOD / 4, ratio)
    near(now.e[2], 1, 'Observer starts at +z when phase is zero')
    near(quarter.e[1], -ratio, 'Quarter-cycle later, the tip rotates toward -y')
    near(quarter.e[2], 0, 'Components are in quadrature')
  }
  near(polarizationAt(15.99), 0, 'Linear chapter uses the linear solution')
  near(polarizationAt(16), 0.5, 'Elliptical chapter uses the 2:1 solution')
  near(polarizationAt(25), 1, 'Circular chapter uses equal amplitudes')
}
