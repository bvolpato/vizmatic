import type { CanvasBounds } from './canvas-components'
import type { TeachingConnectionOptions, TeachingPainter, TeachingRoute } from './teaching-canvas'

export interface TeachingTransferEndpoint {
    shape: CanvasBounds
    /** Use the same local opacity supplied when painting this endpoint. */
    opacity: number
}

export interface TeachingTransferOptions extends TeachingConnectionOptions {
    source: TeachingTransferEndpoint
    target: TeachingTransferEndpoint
    opacity?: number
    progress?: number
    margin?: number
    particle?: { radius?: number, fill?: string, stroke?: string, strokeWidth?: number }
}

function nonnegative(value: number, name: string): void {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and nonnegative`)
}

function alpha(value: number): number {
    if (!Number.isFinite(value)) throw new Error('Transfer opacity must be finite')
    return Math.max(0, Math.min(1, value))
}

function bounds(shape: CanvasBounds): void {
    if (![shape.x, shape.y, shape.width, shape.height].every(Number.isFinite) || shape.width <= 0 || shape.height <= 0) {
        throw new Error('Transfer endpoints require finite positive rectangular bounds')
    }
    nonnegative(shape.radius ?? 0, 'Transfer corner radius')
}

function center(shape: CanvasBounds) {
    return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 }
}

/** Distance to the rounded rectangle along a unit ray from its center. */
function edgeDistance(shape: CanvasBounds, ux: number, uy: number): number {
    const halfWidth = shape.width / 2, halfHeight = shape.height / 2
    const limit = Math.min(ux === 0 ? Infinity : halfWidth / Math.abs(ux), uy === 0 ? Infinity : halfHeight / Math.abs(uy))
    const radius = Math.min(shape.radius ?? 0, halfWidth, halfHeight)
    if (radius === 0) return limit
    const outside = (distance: number) => Math.hypot(
        Math.max(0, Math.abs(ux * distance) - (halfWidth - radius)),
        Math.max(0, Math.abs(uy * distance) - (halfHeight - radius)),
    ) > radius
    if (!outside(limit)) return limit
    let low = 0, high = limit
    for (let index = 0; index < 32; index += 1) {
        const middle = (low + high) / 2
        if (outside(middle)) high = middle
        else low = middle
    }
    return low
}

function safeGap(shape: CanvasBounds, ux: number, uy: number, clearance: number, edge: number): number {
    const expanded = Math.min(
        ux === 0 ? Infinity : (shape.width / 2 + clearance) / Math.abs(ux),
        uy === 0 ? Infinity : (shape.height / 2 + clearance) / Math.abs(uy),
    )
    return expanded - edge
}

/** Compose attached flow and a marker with one visibility and clearance contract. */
export function createTeachingTransfer<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>) {
    return (options: TeachingTransferOptions): TeachingRoute | null => {
        const { source, target, color = '#63DEEC', width = 3, margin = 2, progress, particle } = options
        bounds(source.shape)
        bounds(target.shape)
        nonnegative(width, 'Transfer stroke width')
        if (width === 0) throw new Error('Transfer stroke width must be positive')
        nonnegative(margin, 'Transfer margin')
        const opacity = Math.min(alpha(source.opacity), alpha(target.opacity), alpha(options.opacity ?? 1))
        for (const gap of [options.gap, options.fromGap, options.toGap]) {
            if (gap !== undefined) nonnegative(gap, 'Transfer gap')
        }
        if (progress !== undefined && !Number.isFinite(progress)) throw new Error('Transfer progress must be finite')
        if (particle && progress === undefined) throw new Error('Transfer particle requires progress')
        const radius = particle?.radius ?? 7, strokeWidth = particle?.strokeWidth ?? 3
        nonnegative(radius, 'Transfer particle radius')
        if (radius === 0) throw new Error('Transfer particle radius must be positive')
        nonnegative(strokeWidth, 'Transfer particle stroke width')
        if (opacity === 0) return null

        const a = center(source.shape), z = center(target.shape)
        const distance = Math.hypot(z.x - a.x, z.y - a.y)
        if (!Number.isFinite(distance) || distance === 0) throw new Error('Transfer endpoints must have distinct finite centers')
        const ux = (z.x - a.x) / distance, uy = (z.y - a.y) / distance
        const sourceEdge = edgeDistance(source.shape, ux, uy), targetEdge = edgeDistance(target.shape, ux, uy)
        const markerRadius = progress === undefined ? 0 : radius + (particle?.stroke ? strokeWidth / 2 : 0)
        const clearance = Math.max(width / 2, markerRadius) + margin
        const fromGap = Math.max(options.fromGap ?? options.gap ?? 0, safeGap(source.shape, ux, uy, clearance, sourceEdge))
        const toGap = Math.max(options.toGap ?? options.gap ?? 0, safeGap(target.shape, ux, uy, clearance, targetEdge))
        if (distance <= sourceEdge + targetEdge + fromGap + toGap) throw new Error('Transfer endpoints leave no room for the requested clearance')
        let route!: TeachingRoute
        painter.opacity(opacity, () => {
            route = painter.connect(source.shape, target.shape, { color, width, fromGap, toGap })
            if (progress !== undefined && progress > 0 && progress < 1) {
                const x = route.from.x * (1 - progress) + route.to.x * progress
                const y = route.from.y * (1 - progress) + route.to.y * progress
                painter.circle(x, y, radius, particle?.fill ?? color, particle?.stroke, strokeWidth)
            }
        })
        return route
    }
}
