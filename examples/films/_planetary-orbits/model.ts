import type { Vec3 } from 'vizmatic/stage'

export interface Planet {
    readonly id: string
    readonly name: string
    /** Semimajor axis in AU. */
    readonly a: number
    /** Sidereal orbital period in Earth years. */
    readonly period: number
    readonly eccentricity: number
    /** Inclination to the J2000 ecliptic, in radians. */
    readonly inclination: number
    /** Longitude of the ascending node, in radians; defaults to zero. */
    readonly node?: number
    /** Argument of perihelion (not its longitude), in radians; defaults to zero. */
    readonly periapsis?: number
    /** Mean anomaly at years = 0, in radians; defaults to perihelion. */
    readonly meanAnomalyAtEpoch?: number
}

const TAU = 2 * Math.PI
const DEG = Math.PI / 180

// Illustrative fixed Kepler ellipses, NOT an ephemeris or an N-body simulation.
// NASA/JPL sources verified 2026-11-16:
// https://ssd.jpl.nasa.gov/planets/approx_pos.html (Table 1, J2000 values)
// supplies a, e, I, L, longitude of perihelion and ascending node. Convert
// omega = longitude of perihelion - node; M0 = L - longitude of perihelion.
// Earth uses the Earth/Moon barycenter row, including its tiny signed tilt.
// https://ssd.jpl.nasa.gov/planets/phys_par.html (Sidereal Orbital Period, y)
// supplies periods. Elements and periods are approximate and held constant;
// secular rates, perturbations and the Earth/Moon separation are omitted.
// The source's 1800-2050 accuracy bounds do NOT apply to this frozen model.
export const PLANETS: readonly Planet[] = [
    {
        id: 'mercury', name: 'Mercury', a: 0.38709927, period: 0.2408467,
        eccentricity: 0.20563593, inclination: 7.00497902 * DEG, node: 48.33076593 * DEG,
        periapsis: (77.45779628 - 48.33076593) * DEG,
        meanAnomalyAtEpoch: (252.25032350 - 77.45779628) * DEG,
    },
    {
        id: 'venus', name: 'Venus', a: 0.72333566, period: 0.61519726,
        eccentricity: 0.00677672, inclination: 3.39467605 * DEG, node: 76.67984255 * DEG,
        periapsis: (131.60246718 - 76.67984255) * DEG,
        meanAnomalyAtEpoch: (181.97909950 - 131.60246718) * DEG,
    },
    {
        id: 'earth', name: 'Earth', a: 1.00000261, period: 1.0000174,
        eccentricity: 0.01671123, inclination: -0.00001531 * DEG, node: 0,
        periapsis: 102.93768193 * DEG,
        meanAnomalyAtEpoch: (100.46457166 - 102.93768193) * DEG,
    },
    {
        id: 'mars', name: 'Mars', a: 1.52371034, period: 1.8808476,
        eccentricity: 0.09339410, inclination: 1.84969142 * DEG, node: 49.55953891 * DEG,
        periapsis: (-23.94362959 - 49.55953891) * DEG,
        meanAnomalyAtEpoch: (-4.55343205 + 23.94362959) * DEG,
    },
    {
        id: 'jupiter', name: 'Jupiter', a: 5.20288700, period: 11.862615,
        eccentricity: 0.04838624, inclination: 1.30439695 * DEG, node: 100.47390909 * DEG,
        periapsis: (14.72847983 - 100.47390909) * DEG,
        meanAnomalyAtEpoch: (34.39644051 - 14.72847983) * DEG,
    },
    {
        id: 'saturn', name: 'Saturn', a: 9.53667594, period: 29.447498,
        eccentricity: 0.05386179, inclination: 2.48599187 * DEG, node: 113.66242448 * DEG,
        periapsis: (92.59887831 - 113.66242448) * DEG,
        meanAnomalyAtEpoch: (49.95424423 - 92.59887831) * DEG,
    },
    {
        id: 'uranus', name: 'Uranus', a: 19.18916464, period: 84.016846,
        eccentricity: 0.04725744, inclination: 0.77263783 * DEG, node: 74.01692503 * DEG,
        periapsis: (170.95427630 - 74.01692503) * DEG,
        meanAnomalyAtEpoch: (313.23810451 - 170.95427630) * DEG,
    },
    {
        id: 'neptune', name: 'Neptune', a: 30.06992276, period: 164.79132,
        eccentricity: 0.00859048, inclination: 1.77004347 * DEG, node: 131.78422574 * DEG,
        periapsis: (44.96476227 - 131.78422574) * DEG,
        meanAnomalyAtEpoch: (-55.12002969 - 44.96476227) * DEG,
    },
]

export interface OrbitalState {
    /** Heliocentric AU: XY is the ecliptic, +Z is ecliptic north. */
    readonly position: Vec3
    /** True anomaly from perihelion, in [0, 2pi) radians. */
    readonly anomaly: number
    readonly meanAnomaly: number
    readonly eccentricAnomaly: number
    /** Distance from the Sun in AU. */
    readonly radius: number
}

function wrap(angle: number): number {
    const remainder = angle % TAU
    return remainder < 0 ? remainder + TAU : remainder
}

// Solve M = E - e sin(E) directly at each seek. Bracketed Newton steps avoid
// divergence even near e = 1; there is no integration state or accumulated drift.
function solveKepler(meanAnomaly: number, e: number): number {
    if (!(e >= 0 && e < 1)) throw new RangeError('eccentricity must be in [0, 1)')
    const m = meanAnomaly > Math.PI ? meanAnomaly - TAU : meanAnomaly
    if (m === 0 || e === 0) return m
    let low = -Math.PI, high = Math.PI
    let E = e < 0.8 ? m : Math.sign(m) * Math.PI
    for (let i = 0; i < 64; i++) {
        const residual = E - e * Math.sin(E) - m
        if (residual === 0) return E
        if (residual > 0) high = E
        else low = E
        const step = residual / (1 - e * Math.cos(E))
        if (Math.abs(step) < 1e-14) return E
        const next = E - step
        E = next > low && next < high ? next : (low + high) / 2
    }
    return E
}

function positionAt(planet: Planet, E: number): Vec3 {
    const { a, eccentricity: e, inclination: i, node = 0, periapsis = 0 } = planet
    const x = a * (Math.cos(E) - e)
    const y = a * Math.sqrt((1 - e) * (1 + e)) * Math.sin(E)
    const u = x * Math.cos(periapsis) - y * Math.sin(periapsis)
    const v = x * Math.sin(periapsis) + y * Math.cos(periapsis)
    return [
        u * Math.cos(node) - v * Math.cos(i) * Math.sin(node),
        u * Math.sin(node) + v * Math.cos(i) * Math.cos(node),
        v * Math.sin(i),
    ]
}

/** Years from the J2000 reference phase; accepts negative and out-of-order seeks.
 * Display scaling and clock acceleration belong to the film. Floating-point
 * phase precision eventually degrades at extremely large absolute times.
 */
export function orbitalState(planet: Planet, years: number): OrbitalState {
    if (!Number.isFinite(years)) throw new RangeError('years must be finite')
    // Reduce time before multiplying by 2pi so even large finite seeks stay finite.
    const meanAnomaly = wrap((planet.meanAnomalyAtEpoch ?? 0) + TAU * ((years % planet.period) / planet.period))
    const E = solveKepler(meanAnomaly, planet.eccentricity)
    const e = planet.eccentricity
    return {
        position: positionAt(planet, E),
        anomaly: wrap(Math.atan2(Math.sqrt((1 - e) * (1 + e)) * Math.sin(E), Math.cos(E) - e)),
        meanAnomaly,
        eccentricAnomaly: wrap(E),
        radius: planet.a * (1 - e * Math.cos(E)),
    }
}
