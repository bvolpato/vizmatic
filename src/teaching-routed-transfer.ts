import type { CanvasBounds, CanvasPoint } from './canvas-components'
import type { TeachingPainter } from './teaching-canvas'
import { pointAlongSamples, routeOrthogonalGraph, routingSegmentBlocked, type GraphPortSide, type RoutingObstacle } from './graph-routing'

export interface TeachingRoutedEndpoint<Shape extends CanvasBounds = CanvasBounds> {
    id: string
    shape: Shape
    opacity: number
    side?: GraphPortSide
}

export interface TeachingRouteObstacle {
    id: string
    bounds: CanvasBounds
}

export interface TeachingRoutedTransferOptions<Shape extends CanvasBounds = CanvasBounds> {
    id: string
    source: TeachingRoutedEndpoint<Shape>
    target: TeachingRoutedEndpoint<Shape>
    /** The complete stroked path and marker stay inside this rectangle. */
    corridor: CanvasBounds
    obstacles: readonly TeachingRouteObstacle[]
    color?: string
    width?: number
    margin?: number
    opacity?: number
    progress?: number
    focusTarget?: string
    marker?: { radius?: number, fill?: string, stroke?: string, strokeWidth?: number }
}

export interface TeachingRoutedTransfer<Shape extends CanvasBounds = CanvasBounds> {
    id: string
    source: TeachingRoutedEndpoint<Shape>
    target: TeachingRoutedEndpoint<Shape>
    points: readonly Readonly<CanvasPoint>[]
    length: number
    clearance: number
    positionAt(progress: number): CanvasPoint
}

function finite(value: number, name: string): void {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
}

function nonnegative(value: number, name: string): void {
    finite(value, name)
    if (value < 0) throw new Error(`${name} must be nonnegative`)
}

function bounds(value: CanvasBounds, name: string): void {
    for (const field of ['x', 'y', 'width', 'height'] as const) finite(value[field], `${name} ${field}`)
    if (value.width <= 0 || value.height <= 0) throw new Error(`${name} dimensions must be positive`)
    finite(value.x + value.width, `${name} right edge`)
    finite(value.y + value.height, `${name} bottom edge`)
}

function identifier(id: string, name: string): void {
    if (typeof id !== 'string' || !id.trim()) throw new Error(`${name} must be a nonempty ID`)
}

function alpha(value: number): number {
    finite(value, 'Routed transfer opacity')
    return Math.max(0, Math.min(1, value))
}

function expanded(box: CanvasBounds, clearance: number): RoutingObstacle {
    return { left: box.x - clearance, top: box.y - clearance, right: box.x + box.width + clearance, bottom: box.y + box.height + clearance }
}

function lengthOf(points: readonly CanvasPoint[]): number {
    let sum = 0
    for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
    return sum
}

/** Trim the router's endpoint leads so the moving marker also clears endpoint ink. */
function trimLeads(points: CanvasPoint[], amount: number): CanvasPoint[] {
    const length = lengthOf(points)
    if (length <= 2 * amount) throw new Error('endpoint spacing leaves no positive-length clear transfer')
    const result: CanvasPoint[] = [pointAlongSamples(points, amount / length)]
    let distance = 0
    for (let i = 1; i < points.length; i++) {
        distance += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)
        if (distance > amount + 0.000001 && distance < length - amount - 0.000001) result.push(points[i]!)
    }
    result.push(pointAlongSamples(points, 1 - amount / length))
    return result
}

function parameters<Shape extends CanvasBounds>(options: TeachingRoutedTransferOptions<Shape>) {
    identifier(options.id, 'Routed transfer ID')
    identifier(options.source.id, 'Routed transfer source')
    identifier(options.target.id, 'Routed transfer target')
    if (options.source.id === options.target.id) throw new Error('Routed transfer source and target IDs must differ')
    bounds(options.source.shape, 'Routed transfer source')
    bounds(options.target.shape, 'Routed transfer target')
    bounds(options.corridor, 'Routed transfer corridor')
    const ids = new Set([options.source.id, options.target.id])
    for (const obstacle of options.obstacles) {
        identifier(obstacle.id, 'Routed transfer obstacle')
        if (ids.has(obstacle.id)) throw new Error(`Duplicate routed transfer object ID: ${obstacle.id}`)
        ids.add(obstacle.id)
        bounds(obstacle.bounds, `Routed transfer obstacle ${obstacle.id}`)
    }
    const width = options.width ?? 3, margin = options.margin ?? 2
    nonnegative(width, 'Routed transfer width')
    if (width === 0) throw new Error('Routed transfer width must be positive')
    nonnegative(margin, 'Routed transfer margin')
    if (options.progress !== undefined) finite(options.progress, 'Routed transfer progress')
    if (options.marker && options.progress === undefined) throw new Error('Routed transfer marker requires progress')
    const radius = options.marker?.radius ?? 7, strokeWidth = options.marker?.strokeWidth ?? 3
    nonnegative(radius, 'Routed transfer marker radius')
    if (radius === 0) throw new Error('Routed transfer marker radius must be positive')
    nonnegative(strokeWidth, 'Routed transfer marker stroke width')
    const markerInk = options.progress === undefined ? 0 : radius + (options.marker?.stroke ? strokeWidth / 2 : 0)
    const clearance = Math.max(width / 2, markerInk) + margin
    const opacity = Math.min(alpha(options.source.opacity), alpha(options.target.opacity), alpha(options.opacity ?? 1))
    return { width, margin, radius, strokeWidth, clearance, opacity }
}

/**
 * Plan one deterministic orthogonal transfer using the existing graph router.
 * Whole segments are checked against expanded rectangles, including endpoint
 * bounds. Replan when an endpoint or obstacle moves. No rounded corner or
 * unchecked straight-line fallback can invalidate the clearance contract.
 */
export function planTeachingRoutedTransfer<Shape extends CanvasBounds>(options: TeachingRoutedTransferOptions<Shape>): TeachingRoutedTransfer<Shape> {
    const { clearance } = parameters(options)
    const fail = (reason: string): never => { throw new Error(`Cannot route transfer ${options.id} (${options.source.id} → ${options.target.id}): ${reason}`) }
    // The existing router permits a 0.001 px geometric tolerance. The larger
    // guard keeps the promised ink clearance conservative at that boundary.
    const guard = clearance + 0.01, corridor = options.corridor
    if (corridor.width <= 2 * guard || corridor.height <= 2 * guard) fail('corridor is too small for the requested ink clearance')
    const origin = { x: corridor.x + guard, y: corridor.y + guard }
    const toLocal = (shape: CanvasBounds) => {
        const x = shape.x - origin.x, y = shape.y - origin.y
        finite(x, 'Routed transfer local x')
        finite(y, 'Routed transfer local y')
        // Remove translation-induced subpixel cancellation before route ties.
        return { x: Number(x.toFixed(6)), y: Number(y.toFixed(6)), width: shape.width, height: shape.height }
    }
    const endpoints = [options.source, options.target]
    const nodes = endpoints.map(endpoint => {
        const b = toLocal(endpoint.shape)
        return { id: endpoint.id, cx: b.x + b.width / 2, cy: b.y + b.height / 2, width: b.width, height: b.height }
    })
    const obstacles = options.obstacles.map(obstacle => expanded(toLocal(obstacle.bounds), 0))
    const result = routeOrthogonalGraph(nodes, [{ from: options.source.id, to: options.target.id, fromSide: options.source.side, toSide: options.target.side }], corridor.width - 2 * guard, corridor.height - 2 * guard, guard, 14, obstacles)
    const raw = result.routes.get(0)
    if (!raw) return fail(result.failures[0]?.reason ?? 'no legal route was returned')
    const points = (() => {
        try { return trimLeads(raw, guard).map(point => ({ x: point.x + origin.x, y: point.y + origin.y })) }
        catch (error) { return fail(error instanceof Error ? error.message : String(error)) }
    })()
    const occupied = [...endpoints.map(endpoint => expanded(endpoint.shape, clearance)), ...options.obstacles.map(obstacle => expanded(obstacle.bounds, clearance))]
    for (const point of points) {
        if (point.x < corridor.x + clearance || point.x > corridor.x + corridor.width - clearance
            || point.y < corridor.y + clearance || point.y > corridor.y + corridor.height - clearance) fail('route ink leaves the permitted corridor')
    }
    for (let i = 1; i < points.length; i++) {
        if (occupied.some(obstacle => routingSegmentBlocked(points[i - 1]!, points[i]!, obstacle))) fail('a complete route segment violates object clearance')
    }
    const immutable = Object.freeze(points.map(point => Object.freeze(point)))
    return {
        id: options.id, source: options.source, target: options.target, points: immutable,
        length: lengthOf(immutable), clearance,
        positionAt(progress) {
            finite(progress, 'Routed transfer progress')
            return pointAlongSamples(immutable, Math.max(0, Math.min(1, progress)))
        },
    }
}

/** Paint through the host's checked path, target, opacity and marker primitives. */
export function createTeachingRoutedTransfer<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>) {
    return (options: TeachingRoutedTransferOptions<Shape>): TeachingRoutedTransfer<Shape> | null => {
        const { width, radius, strokeWidth, opacity } = parameters(options)
        if (opacity === 0) return null
        const route = planTeachingRoutedTransfer(options), color = options.color ?? '#63DEEC'
        const paint = () => painter.opacity(opacity, () => {
            painter.path(route.points, { id: `${options.id}:route`, color, width })
            if (options.progress !== undefined && options.progress > 0 && options.progress < 1) {
                const point = route.positionAt(options.progress)
                painter.circle(point.x, point.y, radius, options.marker?.fill ?? color, options.marker?.stroke, strokeWidth)
            }
        })
        if (painter.target) painter.target(options.focusTarget ?? options.id, paint)
        else paint()
        return route
    }
}
