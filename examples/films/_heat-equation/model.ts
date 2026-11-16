import { assertEqual } from 'vizmatic/stage'

// MIT 18.03, Poonen, §29: https://math.mit.edu/~poonen/03/notes.pdf
// Dimensionless u_tau = u_xx on [0, pi], with both ends held at zero.
// The finite sum is an exact solution for this chosen smooth initial profile.
export const MODES = [{ n: 1, a: 0.5 }, { n: 3, a: 0.3 }, { n: 5, a: 0.2 }] as const
export const remaining = (n: number, tau: number): number => Math.exp(-n * n * tau)
export const temperature = (x: number, tau: number): number =>
  MODES.reduce((sum, { n, a }) => sum + a * remaining(n, tau) * Math.sin(n * x), 0)

export function modelTime(seconds: number): number {
  if (seconds <= 8) return 0
  if (seconds <= 20) return (seconds - 8) * 0.01
  if (seconds <= 30) return 0.12 + (seconds - 20) * 0.048
  return 0.6 + Math.min(10, seconds - 30) * 0.18
}

export function verifyHeatSolution(): void {
  const near = (a: number, b: number, why: string, tolerance = 1e-9) =>
    assertEqual(Math.abs(a - b) < tolerance, true, why)
  const h = 1e-4
  let previousMass = Infinity, previousNorm = Infinity
  for (const tau of [0, 0.02, 0.06, 0.12, 0.6, 1, 2.4, 20]) {
    near(temperature(0, tau), 0, 'Left endpoint stays at zero')
    near(temperature(Math.PI, tau), 0, 'Right endpoint stays at zero')
    for (let i = 1; i < 100; i++) {
      const x = i * Math.PI / 100
      const u = temperature(x, tau)
      assertEqual(u >= -1e-12 && u <= 1, true, 'Temperature stays inside the fixed color domain')
      const dt = (temperature(x, tau + h) - temperature(x, tau - h)) / (2 * h)
      const dxx = (temperature(x + h, tau) - 2 * u + temperature(x - h, tau)) / (h * h)
      near(dt, dxx, 'The displayed analytic profile obeys u_tau = u_xx', 1e-5)
      if (tau === 0) {
        // Positive initial profile: sin(x) [3.2(sin²x - 13/16)² + 23/80].
        near(u, Math.sin(x) * (3.2 * (Math.sin(x) ** 2 - 13 / 16) ** 2 + 23 / 80), 'Chosen initial profile is nonnegative')
      }
    }
    const mass = MODES.reduce((sum, { n, a }) => sum + 2 * a * remaining(n, tau) / n, 0)
    const norm = Math.PI / 2 * MODES.reduce((sum, { n, a }) => sum + (a * remaining(n, tau)) ** 2, 0)
    assertEqual(mass < previousMass, true, 'Heat leaves through the fixed-temperature ends')
    assertEqual(norm < previousNorm, true, 'Squared L2 norm decreases')
    previousMass = mass
    previousNorm = norm
    for (const { n } of MODES) {
      near(Math.log(remaining(n, tau + 0.01) / remaining(n, tau)) / 0.01, -n * n, 'Log-amplitude decay rate is exactly -n²')
    }
  }
  near(modelTime(8), 0, 'Initial profile is held for the first chapter')
  near(modelTime(20), 0.12, 'First time segment reaches tau = 0.12')
  near(modelTime(30), 0.6, 'Second time segment reaches tau = 0.6')
  near(modelTime(40), 2.4, 'Final displayed model time is 2.4')
  assertEqual(temperature(Math.PI / 3, 0.12) > temperature(Math.PI / 3, 0), true, 'The linked cool probe initially warms')
  assertEqual(Math.abs(temperature(Math.PI / 3, 20)) < 1e-8, true, 'The solution approaches zero')
}
