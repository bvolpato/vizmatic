import { smoothstep, type MotionEasing, type MotionPoint } from './motion'

const DEFAULT_MORPH_SAMPLES = 64
const MAX_MORPH_SAMPLES = 4096

export interface PathMorphOptions {
    /** Number of evenly spaced arc-length samples in the returned polyline. */
    samples?: number
    easing?: MotionEasing
}

function clampProgress(progress: number): number {
    if (!Number.isFinite(progress)) throw new Error('Polyline morph progress must be finite')
    return Math.max(0, Math.min(1, progress))
}

function validatePolyline(points: readonly MotionPoint[], context: string): void {
    if (!Array.isArray(points) || points.length === 0) {
        throw new Error(`${context} polyline must be a non-empty array`)
    }

    for (let index = 0; index < points.length; index += 1) {
        const point = points[index]
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            throw new Error(`${context} point ${index} coordinates must be finite`)
        }
    }
}

function validateSamples(samples: number): void {
    if (!Number.isInteger(samples) || samples < 2) {
        throw new Error('Polyline morph samples must be an integer of at least 2')
    }
    if (samples > MAX_MORPH_SAMPLES) {
        throw new Error(`Polyline morph samples cannot exceed ${MAX_MORPH_SAMPLES}`)
    }
}

function resamplePolyline(points: readonly MotionPoint[], samples: number): MotionPoint[] {
    const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y))
    const total = lengths.reduce((sum, length) => sum + length, 0)
    if (!Number.isFinite(total)) throw new Error('Polyline morph arc length must be finite')
    if (total === 0) return Array.from({ length: samples }, () => ({ ...points[0] }))
    let segment = 0
    let offset = 0
    return Array.from({ length: samples }, (_, index) => {
        if (index === samples - 1) return { ...points[points.length - 1] }
        const distance = total * (index / (samples - 1))
        while (segment < lengths.length - 1 && (lengths[segment] === 0 || distance > offset + lengths[segment])) {
            offset += lengths[segment++]
        }
        const t = (distance - offset) / lengths[segment]
        const from = points[segment], to = points[segment + 1]
        return { x: from.x * (1 - t) + to.x * t, y: from.y * (1 - t) + to.y * t }
    })
}

/** Prepare arc-length correspondence once, then sample fresh points at any progress. */
export function createPolylineMorph(
    from: readonly MotionPoint[],
    to: readonly MotionPoint[],
    options: PathMorphOptions = {},
): (progress: number) => MotionPoint[] {
    validatePolyline(from, 'Start')
    validatePolyline(to, 'End')

    const samples = options.samples ?? DEFAULT_MORPH_SAMPLES
    validateSamples(samples)
    const startSamples = resamplePolyline(from, samples)
    const endSamples = resamplePolyline(to, samples)
    const easing = options.easing ?? smoothstep
    return (progress) => {
        const amount = clampProgress(progress)
        const eased = amount === 0 || amount === 1 ? amount : easing(amount)
        if (!Number.isFinite(eased)) throw new Error('Polyline morph easing must return a finite number')
        const t = Math.max(0, Math.min(1, eased))
        return startSamples.map((start, index) => {
            const end = endSamples[index]
            return { x: start.x * (1 - t) + end.x * t, y: start.y * (1 - t) + end.y * t }
        })
    }
}

/** Morph two polylines by matching points at equal fractions of their arc length. */
export function morphPolyline(
    from: readonly MotionPoint[],
    to: readonly MotionPoint[],
    progress: number,
    options: PathMorphOptions = {},
): MotionPoint[] {
    return createPolylineMorph(from, to, options)(progress)
}
