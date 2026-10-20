import {
    createCanvasComponents,
    type CanvasBounds,
    type CanvasPainter,
    type CanvasPoint,
} from './canvas-components'
import { tracePolyline } from './motion'

export interface TeachingPathOptions {
    color?: string
    width?: number
    clip?: CanvasBounds
    closed?: boolean
    fill?: string
}

export interface TeachingConnectionOptions {
    color?: string
    width?: number
    gap?: number
    fromGap?: number
    toGap?: number
}

export interface TeachingRoute {
    from: CanvasPoint
    to: CanvasPoint
}

/** Inject host methods so every mark retains checked geometry and label metadata. */
export interface TeachingPainter<Shape extends CanvasBounds = CanvasBounds> extends CanvasPainter<Shape> {
    math(value: string, x: number, y: number, size: number, color?: string, align?: 'left' | 'center' | 'right'): unknown
    line(x1: number, y1: number, x2: number, y2: number, color?: string, width?: number): unknown
    arrow(x1: number, y1: number, x2: number, y2: number, color?: string, width?: number): unknown
    path(points: readonly CanvasPoint[], options?: TeachingPathOptions): unknown
    connect(source: CanvasBounds, target: CanvasBounds, options?: TeachingConnectionOptions): TeachingRoute
}

export interface TeachingPlot {
    point(x: number, y: number): CanvasPoint
    bounds: CanvasBounds
    xDomain: readonly [number, number]
    yDomain: readonly [number, number]
}

export interface TeachingAxesOptions extends CanvasBounds {
    xDomain: readonly [number, number]
    yDomain: readonly [number, number]
    equalUnits?: boolean
    xLabel?: string
    yLabel?: string
    color?: string
    gridColor?: string
    fontSize?: number
    xTicks?: readonly number[]
    yTicks?: readonly number[]
    formatX?: (value: number) => string
    formatY?: (value: number) => string
}

export interface TeachingCurveOptions {
    plot: TeachingPlot
    points: readonly CanvasPoint[]
    color: string
    width?: number
    progress?: number
}

export interface TeachingScatterPoint extends CanvasPoint {
    color?: string
    radius?: number
}

export interface TeachingScatterOptions {
    plot: TeachingPlot
    points: readonly TeachingScatterPoint[]
    color?: string
    radius?: number
    opacity?: number
}

export interface TeachingBarsOptions extends CanvasBounds {
    values: readonly number[]
    labels?: readonly string[]
    colors?: readonly string[]
    color?: string
    max?: number
    progress?: number
    showValues?: boolean
    format?: (value: number) => string
    fontSize?: number
    gap?: number
}

export interface TeachingBarsResult<Shape> {
    bars: (Shape | null)[]
    slots: CanvasBounds[]
    bounds: CanvasBounds
}

export interface TeachingFlowNode extends CanvasBounds {
    id: string
    label: string
    color?: string
    fill?: string
    fontSize?: number
}

export interface TeachingFlowEdge extends TeachingConnectionOptions {
    from: string
    to: string
    progress?: number
}

export interface TeachingFlowGraphOptions {
    nodes: readonly TeachingFlowNode[]
    edges: readonly TeachingFlowEdge[]
    stroke?: string
    fill?: string
    textColor?: string
    padding?: number
}

const INK = '#8D9CB9'
const ACCENT = '#63DEEC'
const PANEL = '#18283B'

function finite(value: number, name: string): void {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
}

function positive(value: number, name: string): void {
    finite(value, name)
    if (value <= 0) throw new Error(`${name} must be positive`)
}

function boundsOf(options: CanvasBounds): CanvasBounds {
    finite(options.x, 'Teaching x')
    finite(options.y, 'Teaching y')
    positive(options.width, 'Teaching width')
    positive(options.height, 'Teaching height')
    return { x: options.x, y: options.y, width: options.width, height: options.height }
}

function amount(value: number, name = 'Teaching progress'): number {
    finite(value, name)
    return Math.max(0, Math.min(1, value))
}

function domainOf(domain: readonly [number, number], name: string): readonly [number, number] {
    finite(domain[0], `${name} start`)
    finite(domain[1], `${name} end`)
    if (domain[1] <= domain[0] || !Number.isFinite(domain[1] - domain[0])) {
        throw new Error(`${name} must have a finite positive span`)
    }
    return [domain[0], domain[1]]
}

/** Chart and graph compositions built entirely from the host's checked primitives. */
export function createTeachingCanvas<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>) {
    const components = createCanvasComponents(painter)

    function axes(options: TeachingAxesOptions): TeachingPlot {
        let bounds = boundsOf(options)
        const xDomain = domainOf(options.xDomain, 'Plot x domain')
        const yDomain = domainOf(options.yDomain, 'Plot y domain')
        if (options.equalUnits) {
            const xSpan = xDomain[1] - xDomain[0]
            const ySpan = yDomain[1] - yDomain[0]
            const pixelsPerUnit = Math.min(bounds.width / xSpan, bounds.height / ySpan)
            const width = xSpan * pixelsPerUnit
            const height = ySpan * pixelsPerUnit
            bounds = boundsOf({
                x: bounds.x + (bounds.width - width) / 2,
                y: bounds.y + (bounds.height - height) / 2,
                width, height,
            })
        }
        const { x, y, width, height } = bounds
        const { color = INK, gridColor, fontSize = 28, xTicks = [], yTicks = [], formatX = String, formatY = String } = options
        positive(fontSize, 'Axis font size')
        xTicks.forEach((tick) => finite(tick, 'Axis x tick'))
        yTicks.forEach((tick) => finite(tick, 'Axis y tick'))
        const plot: TeachingPlot = {
            bounds, xDomain, yDomain,
            point(px, py) {
                finite(px, 'Plot point x')
                finite(py, 'Plot point y')
                const point = {
                    x: x + (px - xDomain[0]) / (xDomain[1] - xDomain[0]) * width,
                    y: y + height - (py - yDomain[0]) / (yDomain[1] - yDomain[0]) * height,
                }
                finite(point.x, 'Mapped point x')
                finite(point.y, 'Mapped point y')
                return point
            },
        }
        for (const tick of xTicks) {
            if (tick < xDomain[0] || tick > xDomain[1]) continue
            const point = plot.point(tick, yDomain[0])
            if (gridColor) painter.path([{ x: point.x, y }, { x: point.x, y: y + height }], { color: gridColor, width: 1, clip: bounds })
            painter.line(point.x, y + height, point.x, y + height + 7, color, 2)
            painter.text(formatX(tick), point.x, y + height + 36, fontSize, color, 'center')
        }
        for (const tick of yTicks) {
            if (tick < yDomain[0] || tick > yDomain[1]) continue
            const point = plot.point(xDomain[0], tick)
            if (gridColor) painter.path([{ x, y: point.y }, { x: x + width, y: point.y }], { color: gridColor, width: 1, clip: bounds })
            painter.line(x - 7, point.y, x, point.y, color, 2)
            painter.text(formatY(tick), x - 18, point.y + 9, fontSize, color, 'right')
        }
        painter.line(x, y + height, x + width, y + height, color, 2)
        painter.line(x, y, x, y + height, color, 2)
        if (options.xLabel) painter.text(options.xLabel, x + width / 2, y + height + 72, 30, color, 'center')
        if (options.yLabel) painter.text(options.yLabel, x, y - 26, 30, color, 'left')
        return plot
    }

    function curve(options: TeachingCurveOptions): CanvasPoint[] {
        const { plot, points, color, width = 4, progress = 1 } = options
        positive(width, 'Curve width')
        const mapped = points.map((point) => plot.point(point.x, point.y))
        const visible = tracePolyline(mapped, progress)
        if (visible.length > 1) painter.path(visible, { color, width, clip: plot.bounds })
        return visible
    }

    function scatter(options: TeachingScatterOptions): unknown[] {
        const { plot, points, color = ACCENT, radius = 7, opacity = 1 } = options
        positive(radius, 'Scatter radius')
        const alpha = amount(opacity, 'Scatter opacity')
        const projected = points.map((point) => {
            positive(point.radius ?? radius, 'Scatter point radius')
            return { ...plot.point(point.x, point.y), radius: point.radius ?? radius, color: point.color ?? color }
        })
        const shapes: unknown[] = []
        if (alpha === 0) return shapes
        const { x, y, width, height } = plot.bounds
        painter.opacity(alpha, () => {
            for (const point of projected) {
                // Keep the complete mark inside the plot without hiding any ink from host checks.
                if (point.x - point.radius < x || point.x + point.radius > x + width || point.y - point.radius < y || point.y + point.radius > y + height) continue
                shapes.push(painter.circle(point.x, point.y, point.radius, point.color))
            }
        })
        return shapes
    }

    function bars(options: TeachingBarsOptions): TeachingBarsResult<Shape> {
        const bounds = boundsOf(options)
        const { x, y, width, height } = bounds
        const { values, labels, colors, color = ACCENT, progress = 1, showValues = false, format = String, fontSize = 28, gap = 20 } = options
        positive(fontSize, 'Bar font size')
        finite(gap, 'Bar gap')
        if (gap < 0) throw new Error('Bar gap must be nonnegative')
        values.forEach((value) => {
            finite(value, 'Bar value')
            if (value < 0) throw new Error('Bar values must be nonnegative')
        })
        if (labels && labels.length !== values.length) throw new Error('Bar labels must match values')
        if (colors && colors.length !== values.length) throw new Error('Bar colors must match values')
        const maximumValue = values.reduce((maximum, value) => Math.max(maximum, value), 0)
        const maximum = options.max ?? (maximumValue || 1)
        positive(maximum, 'Bar maximum')
        if (maximum < maximumValue) throw new Error('Bar maximum must contain every value')
        const reveal = amount(progress)
        if (!values.length) return { bars: [], slots: [], bounds }
        const barWidth = (width - gap * (values.length - 1)) / values.length
        positive(barWidth, 'Bar width after gaps')
        const shapes: (Shape | null)[] = []
        const slots: CanvasBounds[] = []
        values.forEach((value, index) => {
            const left = x + index * (barWidth + gap)
            const barHeight = value / maximum * height * reveal
            slots.push({ x: left, y, width: barWidth, height })
            shapes.push(barHeight > 0 ? painter.rect(left, y + height - barHeight, barWidth, barHeight, colors?.[index] ?? color, undefined, Math.min(8, barWidth / 2, barHeight / 2)) : null)
            if (labels) painter.text(labels[index], left + barWidth / 2, y + height + 38, fontSize, INK, 'center')
            if (showValues && reveal > 0) painter.text(format(value), left + barWidth / 2, y + height - barHeight - 14, fontSize, colors?.[index] ?? color, 'center')
        })
        return { bars: shapes, slots, bounds }
    }

    function flowGraph(options: TeachingFlowGraphOptions): { nodes: Record<string, Shape>, routes: TeachingRoute[] } {
        const { nodes, edges, stroke = ACCENT, fill = PANEL, textColor = '#FFFFFF', padding = 12 } = options
        finite(padding, 'Flow node padding')
        if (padding < 0) throw new Error('Flow node padding must be nonnegative')
        const descriptors: Record<string, Shape> = Object.create(null) as Record<string, Shape>
        for (const node of nodes) {
            if (!node.id || Object.hasOwn(descriptors, node.id)) throw new Error('Flow node IDs must be nonempty and unique')
            const bounds = boundsOf(node)
            positive(node.fontSize ?? 30, 'Flow node font size')
            finite(node.radius ?? 14, 'Flow node radius')
            if ((node.radius ?? 14) < 0) throw new Error('Flow node radius must be nonnegative')
            descriptors[node.id] = { ...bounds, radius: node.radius ?? 14 } as Shape
        }
        for (const edge of edges) {
            if (!Object.hasOwn(descriptors, edge.from) || !Object.hasOwn(descriptors, edge.to)) throw new Error('Flow edge must reference existing nodes')
            if (edge.from === edge.to) throw new Error('Flow edges must connect distinct nodes')
            if (edge.progress !== undefined) amount(edge.progress)
            if (edge.width !== undefined) positive(edge.width, 'Flow edge width')
            for (const gap of [edge.gap, edge.fromGap, edge.toGap]) {
                if (gap !== undefined) finite(gap, 'Flow edge gap')
            }
        }
        const routes = edges.map((edge) => {
            const { from, to, progress, ...style } = edge
            const route = painter.connect(descriptors[from], descriptors[to], { color: stroke, ...style })
            if (progress !== undefined) components.particle({ points: [route.from, route.to], progress, radius: 7, fill: style.color ?? stroke })
            return route
        })
        for (const node of nodes) {
            const shape = components.card({
                ...descriptors[node.id], label: node.label, id: node.id,
                fill: node.fill ?? fill, stroke: node.color ?? stroke, textColor,
                fontSize: node.fontSize ?? 30, padding,
            })
            // Connectors retain these descriptor references while the host supplies their audit IDs.
            Object.assign(descriptors[node.id], shape)
        }
        return { nodes: descriptors, routes }
    }

    return { axes, curve, scatter, bars, flowGraph }
}
