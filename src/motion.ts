export interface MotionPoint {
    x: number
    y: number
}

export type MotionEasing = (progress: number) => number

export interface ArcSwapOptions {
    /** Maximum perpendicular distance each point travels from the direct path. */
    lift?: number
    easing?: MotionEasing
}

const DEFAULT_ARC_LIFT = 80

function assertFiniteProgress(progress: number): void {
    if (!Number.isFinite(progress)) throw new Error('Motion progress must be finite')
}

function clampProgress(progress: number): number {
    assertFiniteProgress(progress)
    return Math.max(0, Math.min(1, progress))
}

function assertPoint(point: MotionPoint, context: string): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new Error(`${context} coordinates must be finite`)
    }
}

function interpolate(from: MotionPoint, to: MotionPoint, progress: number): MotionPoint {
    return {
        x: from.x * (1 - progress) + to.x * progress,
        y: from.y * (1 - progress) + to.y * progress,
    }
}

/** Cubic ease-in-out with progress clamped to the unit interval. */
export function smoothstep(progress: number): number {
    const amount = clampProgress(progress)
    return amount * amount * (3 - 2 * amount)
}

/** Move two points to each other's positions along mirrored quadratic arcs. */
export function arcSwap(
    from: MotionPoint,
    to: MotionPoint,
    progress: number,
    options: ArcSwapOptions = {},
): readonly [MotionPoint, MotionPoint] {
    assertPoint(from, 'Arc swap start')
    assertPoint(to, 'Arc swap end')
    const amount = clampProgress(progress)
    const lift = options.lift ?? DEFAULT_ARC_LIFT
    if (!Number.isFinite(lift)) throw new Error('Arc swap lift must be finite')

    if (amount === 0) return [{ x: from.x, y: from.y }, { x: to.x, y: to.y }]
    if (amount === 1) return [{ x: to.x, y: to.y }, { x: from.x, y: from.y }]

    const eased = (options.easing ?? smoothstep)(amount)
    if (!Number.isFinite(eased)) throw new Error('Motion easing must return a finite number')
    const t = Math.max(0, Math.min(1, eased))

    if (t === 0) return [{ x: from.x, y: from.y }, { x: to.x, y: to.y }]
    if (t === 1) return [{ x: to.x, y: to.y }, { x: from.x, y: from.y }]

    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (!Number.isFinite(length)) throw new Error('Arc swap distance must be finite')
    if (length === 0) return [{ x: from.x, y: from.y }, { x: to.x, y: to.y }]

    const normalX = -dy / length
    const normalY = dx / length
    const arcHeight = 4 * (1 - t) * t * lift
    const firstBase = interpolate(from, to, t)
    const secondBase = interpolate(to, from, t)
    const first = {
        x: firstBase.x + normalX * arcHeight,
        y: firstBase.y + normalY * arcHeight,
    }
    const second = {
        x: secondBase.x - normalX * arcHeight,
        y: secondBase.y - normalY * arcHeight,
    }

    assertPoint(first, 'Arc swap result')
    assertPoint(second, 'Arc swap result')
    return [first, second]
}

function pathLengths(points: readonly MotionPoint[]): number[] {
    const lengths: number[] = []
    let total = 0

    for (let index = 0; index < points.length; index += 1) {
        const point = points[index]!
        assertPoint(point, `Path point ${index}`)
        if (index === 0) continue

        const previous = points[index - 1]!
        const length = Math.hypot(point.x - previous.x, point.y - previous.y)
        if (!Number.isFinite(length)) throw new Error('Path segment length must be finite')
        total += length
        if (!Number.isFinite(total)) throw new Error('Path length must be finite')
        lengths.push(length)
    }

    return lengths
}

/** Return the visible prefix of a polyline at a fraction of its arc length. */
export function tracePolyline(points: readonly MotionPoint[], progress: number): MotionPoint[] {
    const amount = clampProgress(progress)
    if (points.length === 0) return []
    const lengths = pathLengths(points)
    if (amount === 1) return points.map(({ x, y }) => ({ x, y }))

    const traced: MotionPoint[] = [{ x: points[0]!.x, y: points[0]!.y }]
    if (amount === 0 || lengths.length === 0) return traced

    const total = lengths.reduce((sum, length) => sum + length, 0)
    if (total === 0) return traced

    const target = total * amount
    let travelled = 0

    for (let index = 0; index < lengths.length; index += 1) {
        const segmentLength = lengths[index]!
        const next = points[index + 1]!
        if (segmentLength === 0) continue

        const segmentEnd = travelled + segmentLength
        if (target >= segmentEnd) {
            traced.push({ x: next.x, y: next.y })
            travelled = segmentEnd
            continue
        }

        const segmentProgress = (target - travelled) / segmentLength
        const point = interpolate(points[index]!, next, segmentProgress)
        assertPoint(point, 'Polyline trace result')
        const previous = traced[traced.length - 1]!
        if (point.x !== previous.x || point.y !== previous.y) traced.push(point)
        return traced
    }

    return traced
}

/** Return the point at a fraction of a polyline's actual arc length. */
export function pointAlongPath(points: readonly MotionPoint[], progress: number): MotionPoint {
    if (points.length === 0) throw new Error('Cannot find a point along an empty path')
    const traced = tracePolyline(points, progress)
    return { ...traced[traced.length - 1]! }
}
