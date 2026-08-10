import React from 'react'
import {
    type ThemeColors,
    type ColorName,
    getReadableColor,
} from '../theme'

import { clamp } from './layout'
import {
    chartColor,
    chartDomain,
    ChartFrame,
    chartLabel,
    type ChartMargins,
    chartTicks,
    type ChartValueFormat,
    createPlotArea,
    formatChartValue,
    pointLabelPlacement,
    xInPlot,
    yInPlot,
} from './charts'

export interface ScatterPoint {
    x: number
    y: number
    label?: string
    color?: ColorName | string
    size?: number
}

interface ScatterPlotProps {
    points: ScatterPoint[]
    c: ThemeColors
    title?: string
    subtitle?: string
    width?: number
    height?: number
    xMin?: number
    xMax?: number
    yMin?: number
    yMax?: number
    xAxisLabel?: string
    yAxisLabel?: string
    formatX?: ChartValueFormat
    formatY?: ChartValueFormat
    showGrid?: boolean
    footer?: string
}

export function ScatterPlot({
    points,
    c,
    title,
    subtitle,
    width = 380,
    height = 260,
    xMin,
    xMax,
    yMin,
    yMax,
    xAxisLabel,
    yAxisLabel,
    formatX = 'decimal',
    formatY = 'decimal',
    showGrid = true,
    footer,
}: ScatterPlotProps): React.ReactElement {
    const margin: ChartMargins = { top: 20, right: 24, bottom: xAxisLabel ? 46 : 34, left: yAxisLabel ? 54 : 42 }
    const plot = createPlotArea(width, height, margin)
    const xDomain = chartDomain(points.map((item) => item.x), xMin, xMax)
    const yDomain = chartDomain(points.map((item) => item.y), yMin, yMax)
    const xTicks = chartTicks(xDomain.min, xDomain.max, 4)
    const yTicks = chartTicks(yDomain.min, yDomain.max, 4)

    const pointFor = (xValue: number, yValue: number) => ({
        x: xInPlot(xValue, xDomain, plot),
        y: yInPlot(yValue, yDomain, plot),
    })

    const pointGeometries = points.map((item, index) => {
        const point = pointFor(item.x, item.y)
        return { item, index, point, color: chartColor(item.color, c, index) }
    })

    return ChartFrame({ c, title, subtitle, width, footer, children:
        React.createElement('div', { style: { position: 'relative' as const, width, height, display: 'flex' } },
            React.createElement('svg', { width, height, viewBox: `0 0 ${width} ${height}` },
                showGrid && React.createElement('g', {},
                    ...xTicks.map((tick) => {
                        const x = xInPlot(tick, xDomain, plot)
                        return React.createElement('line', {
                            key: `x-tick-${tick}`,
                            x1: x,
                            y1: plot.y,
                            x2: x,
                            y2: plot.bottom,
                            stroke: c.borderSubtle,
                            strokeWidth: 1,
                        })
                    }),
                    ...yTicks.map((tick) => {
                        const y = yInPlot(tick, yDomain, plot)
                        return React.createElement('line', {
                            key: `y-tick-${tick}`,
                            x1: plot.x,
                            y1: y,
                            x2: plot.right,
                            y2: y,
                            stroke: c.borderSubtle,
                            strokeWidth: 1,
                        })
                    })
                ),
                React.createElement('rect', { x: plot.x, y: plot.y, width: plot.innerWidth, height: plot.innerHeight, fill: 'transparent', stroke: c.borderLight, strokeWidth: 1.2, rx: 6 }),
                ...pointGeometries.map(({ item, index, point, color }) =>
                    React.createElement('circle', {
                        key: `${item.label ?? 'point'}-${index}`,
                        cx: point.x,
                        cy: point.y,
                        r: item.size ?? 7,
                        fill: color,
                        opacity: 0.92,
                        stroke: c.bgCard,
                        strokeWidth: 2,
                    })
                ),
            ),
            ...xTicks.map((tick) => {
                const x = xInPlot(tick, xDomain, plot)
                return chartLabel(`x-tick-label-${tick}`, formatChartValue(tick, formatX), x, plot.bottom + 18, c, { width: 44 })
            }),
            ...yTicks.map((tick) => {
                const y = yInPlot(tick, yDomain, plot)
                return chartLabel(`y-tick-label-${tick}`, formatChartValue(tick, formatY), plot.x - 8, y, c, { align: 'right', width: 36 })
            }),
            xAxisLabel && chartLabel('scatter-x-axis-label', xAxisLabel, plot.x + plot.innerWidth / 2, height - 8, c, {
                width: plot.innerWidth,
                fontFamily: 'Inter',
                fontWeight: 700,
            }),
            yAxisLabel && chartLabel('scatter-y-axis-label', yAxisLabel, 12, plot.y + plot.innerHeight / 2, c, {
                width: plot.innerHeight,
                fontFamily: 'Inter',
                fontWeight: 700,
                transform: 'translate(-50%, -50%) rotate(-90deg)',
            }),
            ...pointGeometries.flatMap(({ item, index, point, color }) => {
                if (!item.label) return []
                const placement = pointLabelPlacement(point.x, point.y, plot, index)
                return [chartLabel(`scatter-point-label-${index}`, item.label, placement.x, placement.y, c, {
                    align: placement.align,
                    width: placement.width,
                    bounds: placement.bounds,
                    color,
                    fontWeight: 800,
                })]
            }),
        )
    })
}

export type ParetoObjective = 'minimize' | 'maximize'
export type ParetoXScale = 'linear' | 'log'

export interface ParetoChartProps {
    points: ScatterPoint[]
    c: ThemeColors
    title?: string
    subtitle?: string
    width?: number
    height?: number
    xMin?: number
    xMax?: number
    yMin?: number
    yMax?: number
    xAxisLabel?: string
    yAxisLabel?: string
    formatX?: ChartValueFormat
    formatY?: ChartValueFormat
    showGrid?: boolean
    xScale?: ParetoXScale
    xObjective?: ParetoObjective
    yObjective?: ParetoObjective
    frontierColor?: ColorName | string
    showGoal?: boolean
    goalLabel?: string
    footer?: string
}

interface ParetoPointGeometry {
    point: ScatterPoint
    index: number
    x: number
    y: number
    color: string
    frontier: boolean
}

function pointDominates(
    candidate: ScatterPoint,
    point: ScatterPoint,
    xObjective: ParetoObjective,
    yObjective: ParetoObjective,
): boolean {
    const xNoWorse = xObjective === 'minimize' ? candidate.x <= point.x : candidate.x >= point.x
    const yNoWorse = yObjective === 'minimize' ? candidate.y <= point.y : candidate.y >= point.y
    const xBetter = xObjective === 'minimize' ? candidate.x < point.x : candidate.x > point.x
    const yBetter = yObjective === 'minimize' ? candidate.y < point.y : candidate.y > point.y
    return xNoWorse && yNoWorse && (xBetter || yBetter)
}

function paretoFrontierIndices(
    points: Array<{ point: ScatterPoint; index: number }>,
    xObjective: ParetoObjective,
    yObjective: ParetoObjective,
): Set<number> {
    const frontier = new Set<number>()
    for (const candidate of points) {
        const dominated = points.some(({ point }) => pointDominates(point, candidate.point, xObjective, yObjective))
        if (!dominated) frontier.add(candidate.index)
    }
    return frontier
}

function positiveLogDomain(values: number[], min?: number, max?: number): { min: number; max: number; range: number } {
    const positiveValues = values.filter((value) => Number.isFinite(value) && value > 0)
    const positiveMin = min !== undefined && Number.isFinite(min) && min > 0
        ? min
        : Math.min(...positiveValues, 1)
    const fallbackMax = Math.max(...positiveValues, positiveMin * 10)
    const positiveMax = max !== undefined && Number.isFinite(max) && max > 0
        ? max
        : fallbackMax
    const safeMin = Math.max(Number.MIN_VALUE, positiveMin)
    const safeMax = positiveMax > safeMin ? positiveMax : safeMin * 10
    return { min: safeMin, max: safeMax, range: Math.log(safeMax) - Math.log(safeMin) }
}

function logChartTicks(min: number, max: number, count = 5): number[] {
    if (!(min > 0) || !(max > min) || count <= 1) return [min]
    const startPower = Math.ceil(Math.log10(min))
    const endPower = Math.floor(Math.log10(max))
    const powers = Array.from({ length: Math.max(0, endPower - startPower + 1) }, (_, index) => 10 ** (startPower + index))
        .filter((value) => value >= min && value <= max)
    if (powers.length >= 4) return powers
    return Array.from({ length: count }, (_, index) => min * (max / min) ** (index / (count - 1)))
}

/**
 * Scatter plot that highlights non-dominated points and their Pareto frontier.
 * By default, lower x and higher y are preferred, which suits cost-versus-score charts.
 */
export function ParetoChart({
    points,
    c,
    title,
    subtitle,
    width = 640,
    height = 360,
    xMin,
    xMax,
    yMin,
    yMax,
    xAxisLabel,
    yAxisLabel,
    formatX = 'decimal',
    formatY = 'decimal',
    showGrid = true,
    xScale = 'linear',
    xObjective = 'minimize',
    yObjective = 'maximize',
    frontierColor,
    showGoal = true,
    goalLabel,
    footer,
}: ParetoChartProps): React.ReactElement {
    const margin: ChartMargins = { top: 22, right: 26, bottom: xAxisLabel ? 48 : 36, left: yAxisLabel ? 56 : 44 }
    const plot = createPlotArea(width, height, margin)
    const validPoints = points
        .map((point, index) => ({ point, index }))
        .filter(({ point }) => Number.isFinite(point.x)
            && Number.isFinite(point.y)
            && (xScale !== 'log' || point.x > 0))
    const frontierIndices = paretoFrontierIndices(validPoints, xObjective, yObjective)
    const xDomain = xScale === 'log'
        ? positiveLogDomain(validPoints.map(({ point }) => point.x), xMin, xMax)
        : chartDomain(validPoints.map(({ point }) => point.x), xMin, xMax)
    const yDomain = chartDomain(validPoints.map(({ point }) => point.y), yMin, yMax)
    const xTicks = xScale === 'log'
        ? logChartTicks(xDomain.min, xDomain.max)
        : chartTicks(xDomain.min, xDomain.max, 5)
    const yTicks = chartTicks(yDomain.min, yDomain.max, 5)
    const frontier = chartColor(frontierColor ?? 'positive', c, 0)

    const pointFor = (xValue: number, yValue: number) => {
        const x = xScale === 'log'
            ? plot.x + ((Math.log(xValue > 0 ? xValue : xDomain.min) - Math.log(xDomain.min)) / xDomain.range) * plot.innerWidth
            : xInPlot(xValue, xDomain, plot)
        return {
            x: clamp(x, plot.x, plot.right),
            y: clamp(yInPlot(yValue, yDomain, plot), plot.y, plot.bottom),
        }
    }

    const pointGeometries = validPoints.map(({ point, index }) => {
        const pointPosition = pointFor(point.x, point.y)
        const isFrontier = frontierIndices.has(index)
        return {
            point,
            index,
            x: pointPosition.x,
            y: pointPosition.y,
            color: chartColor(point.color ?? (isFrontier ? frontier : 'neutral'), c, index),
            frontier: isFrontier,
        } satisfies ParetoPointGeometry
    })
    const frontierGeometries = pointGeometries
        .filter((geometry) => geometry.frontier)
        .sort((left, right) => left.point.x - right.point.x)
    const frontierPath = frontierGeometries.length > 1
        ? frontierGeometries.map((geometry, index) => `${index === 0 ? 'M' : 'L'} ${geometry.x.toFixed(1)} ${geometry.y.toFixed(1)}`).join(' ')
        : undefined
    const goalText = goalLabel ?? `goal: ${xObjective === 'minimize' ? 'lower x' : 'higher x'} · ${yObjective === 'maximize' ? 'higher y' : 'lower y'}`
    const goalXStart = plot.right - 72
    const goalY = plot.y + 18
    const goalXEnd = xObjective === 'minimize' ? goalXStart - 26 : goalXStart + 26
    const goalYStart = plot.y + 52
    const goalYEnd = yObjective === 'maximize' ? goalYStart - 26 : goalYStart + 26
    const arrowSize = 5

    return ChartFrame({
        c,
        title,
        subtitle,
        width,
        footer,
        legend: [
            { label: 'Pareto frontier', color: frontier },
            { label: 'dominated', color: 'neutral' },
        ],
        children: React.createElement('div', { style: { position: 'relative' as const, width, height, display: 'flex' } },
            React.createElement('svg', { width, height, viewBox: `0 0 ${width} ${height}` },
                showGrid && React.createElement('g', {},
                    ...xTicks.map((tick) => {
                        const x = pointFor(tick, yDomain.min).x
                        return React.createElement('line', {
                            key: `pareto-x-grid-${tick}`,
                            x1: x,
                            y1: plot.y,
                            x2: x,
                            y2: plot.bottom,
                            stroke: c.borderSubtle,
                            strokeWidth: 1,
                        })
                    }),
                    ...yTicks.map((tick) => {
                        const y = yInPlot(tick, yDomain, plot)
                        return React.createElement('line', {
                            key: `pareto-y-grid-${tick}`,
                            x1: plot.x,
                            y1: y,
                            x2: plot.right,
                            y2: y,
                            stroke: c.borderSubtle,
                            strokeWidth: 1,
                        })
                    }),
                ),
                React.createElement('rect', {
                    x: plot.x,
                    y: plot.y,
                    width: plot.innerWidth,
                    height: plot.innerHeight,
                    fill: 'transparent',
                    stroke: c.borderLight,
                    strokeWidth: 1.2,
                    rx: 6,
                }),
                showGoal && React.createElement('g', { 'data-pareto-goal': true, stroke: frontier, fill: 'none', strokeWidth: 2, strokeLinecap: 'round' },
                    React.createElement('line', { x1: goalXStart, y1: goalY, x2: goalXEnd, y2: goalY }),
                    React.createElement('line', { x1: goalXEnd, y1: goalY, x2: goalXEnd + (xObjective === 'minimize' ? arrowSize : -arrowSize), y2: goalY - arrowSize }),
                    React.createElement('line', { x1: goalXEnd, y1: goalY, x2: goalXEnd + (xObjective === 'minimize' ? arrowSize : -arrowSize), y2: goalY + arrowSize }),
                    React.createElement('line', { x1: goalXStart, y1: goalYStart, x2: goalXStart, y2: goalYEnd }),
                    React.createElement('line', { x1: goalXStart, y1: goalYEnd, x2: goalXStart - arrowSize, y2: goalYEnd + (yObjective === 'maximize' ? arrowSize : -arrowSize) }),
                    React.createElement('line', { x1: goalXStart, y1: goalYEnd, x2: goalXStart + arrowSize, y2: goalYEnd + (yObjective === 'maximize' ? arrowSize : -arrowSize) }),
                ),
                frontierPath && React.createElement('path', {
                    'data-pareto-frontier': true,
                    d: frontierPath,
                    fill: 'none',
                    stroke: frontier,
                    strokeWidth: 3,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                }),
                ...pointGeometries
                    .filter((geometry) => !geometry.frontier)
                    .concat(pointGeometries.filter((geometry) => geometry.frontier))
                    .map(({ point, index, x, y, color, frontier: isFrontier }) => React.createElement('circle', {
                        key: `pareto-point-${point.label ?? 'point'}-${index}`,
                        'data-pareto-status': isFrontier ? 'frontier' : 'dominated',
                        cx: x,
                        cy: y,
                        r: Math.max(4, Math.min(20, point.size ?? (isFrontier ? 8 : 7))),
                        fill: color,
                        opacity: isFrontier ? 1 : 0.38,
                        stroke: isFrontier ? frontier : c.bgCard,
                        strokeWidth: isFrontier ? 3 : 2,
                    })),
            ),
            ...xTicks.map((tick) => {
                const x = pointFor(tick, yDomain.min).x
                return chartLabel(`pareto-x-tick-${tick}`, formatChartValue(tick, formatX), x, plot.bottom + 18, c, { width: 52 })
            }),
            ...yTicks.map((tick) => {
                const y = yInPlot(tick, yDomain, plot)
                return chartLabel(`pareto-y-tick-${tick}`, formatChartValue(tick, formatY), plot.x - 8, y, c, { align: 'right', width: 42 })
            }),
            showGoal && chartLabel('pareto-goal-label', goalText, plot.right - 2, plot.y + 9, c, {
                align: 'right',
                width: 170,
                color: frontier,
                fontWeight: 850,
                fontSize: 11,
                bounds: { x: plot.x, y: plot.y, width: plot.innerWidth, height: plot.innerHeight, padding: 4 },
            }),
            xAxisLabel && chartLabel('pareto-x-axis-label', xAxisLabel, plot.x + plot.innerWidth / 2, height - 8, c, {
                width: plot.innerWidth,
                fontFamily: 'Inter',
                fontWeight: 700,
            }),
            yAxisLabel && chartLabel('pareto-y-axis-label', yAxisLabel, 12, plot.y + plot.innerHeight / 2, c, {
                width: plot.innerHeight,
                fontFamily: 'Inter',
                fontWeight: 700,
                transform: 'translate(-50%, -50%) rotate(-90deg)',
            }),
            ...pointGeometries.flatMap(({ point, index, x, y, color, frontier: isFrontier }) => {
                if (!point.label) return []
                const placement = pointLabelPlacement(x, y, plot, index, 110)
                return [chartLabel(`pareto-point-label-${index}`, point.label, placement.x, placement.y, c, {
                    align: placement.align,
                    width: placement.width,
                    bounds: placement.bounds,
                    color: isFrontier ? color : c.textMuted,
                    fontWeight: isFrontier ? 850 : 600,
                })]
            }),
        ),
    })
}

export interface QuadrantRegion {
    label: string
    detail?: string
    color?: ColorName | string
    emphasis?: boolean
}

export interface QuadrantChartProps {
    points: ScatterPoint[]
    regions: {
        topLeft: QuadrantRegion
        topRight: QuadrantRegion
        bottomLeft: QuadrantRegion
        bottomRight: QuadrantRegion
    }
    c: ThemeColors
    title?: string
    subtitle?: string
    width?: number
    height?: number
    xMin?: number
    xMax?: number
    yMin?: number
    yMax?: number
    xThreshold?: number
    yThreshold?: number
    xAxisLabel?: string
    yAxisLabel?: string
    formatX?: ChartValueFormat
    formatY?: ChartValueFormat
    showTicks?: boolean
    showGrid?: boolean
    footer?: string
}

export function QuadrantChart({
    points,
    regions,
    c,
    title,
    subtitle,
    width = 700,
    height = 360,
    xMin,
    xMax,
    yMin,
    yMax,
    xThreshold,
    yThreshold,
    xAxisLabel,
    yAxisLabel,
    formatX = 'decimal',
    formatY = 'decimal',
    showTicks = false,
    showGrid = false,
    footer,
}: QuadrantChartProps): React.ReactElement {
    const margin: ChartMargins = {
        top: 18,
        right: 20,
        bottom: xAxisLabel ? (showTicks ? 58 : 46) : showTicks ? 36 : 24,
        left: yAxisLabel ? (showTicks ? 72 : 54) : showTicks ? 48 : 24,
    }
    const plot = createPlotArea(width, height, margin)
    const xDomain = xMin === undefined && xMax === undefined
        ? { min: 0, max: 1, range: 1 }
        : chartDomain(points.map((point) => point.x), xMin, xMax)
    const yDomain = yMin === undefined && yMax === undefined
        ? { min: 0, max: 1, range: 1 }
        : chartDomain(points.map((point) => point.y), yMin, yMax)
    const resolvedXThreshold = clamp(xThreshold ?? xDomain.min + xDomain.range / 2, xDomain.min, xDomain.max)
    const resolvedYThreshold = clamp(yThreshold ?? yDomain.min + yDomain.range / 2, yDomain.min, yDomain.max)
    const midX = xInPlot(resolvedXThreshold, xDomain, plot)
    const midY = yInPlot(resolvedYThreshold, yDomain, plot)
    const xTicks = showTicks || showGrid ? chartTicks(xDomain.min, xDomain.max, 5) : []
    const yTicks = showTicks || showGrid ? chartTicks(yDomain.min, yDomain.max, 5) : []
    const regionEntries = [
        { key: 'top-left', region: regions.topLeft, x: plot.x, y: plot.y, width: midX - plot.x, height: midY - plot.y },
        { key: 'top-right', region: regions.topRight, x: midX, y: plot.y, width: plot.right - midX, height: midY - plot.y },
        { key: 'bottom-left', region: regions.bottomLeft, x: plot.x, y: midY, width: midX - plot.x, height: plot.bottom - midY },
        { key: 'bottom-right', region: regions.bottomRight, x: midX, y: midY, width: plot.right - midX, height: plot.bottom - midY },
    ]
    const pointGeometries = points.map((point, index) => ({
        point,
        index,
        x: xInPlot(clamp(point.x, xDomain.min, xDomain.max), xDomain, plot),
        y: yInPlot(clamp(point.y, yDomain.min, yDomain.max), yDomain, plot),
        color: chartColor(point.color, c, index),
    }))

    return ChartFrame({
        c,
        title,
        subtitle,
        width,
        footer,
        children: React.createElement('div', {
            style: { position: 'relative' as const, width, height, display: 'flex' }
        },
            React.createElement('svg', { width, height, viewBox: `0 0 ${width} ${height}` },
                ...regionEntries.map(({ key, region, x, y, width: regionWidth, height: regionHeight }, index) => {
                    const color = chartColor(region.color, c, index)
                    const emphasized = region.emphasis === true
                    return React.createElement('rect', {
                        key: `quadrant-${key}`,
                        x,
                        y,
                        width: regionWidth,
                        height: regionHeight,
                        fill: color,
                        opacity: emphasized ? 0.2 : 0.1,
                        stroke: emphasized ? color : 'transparent',
                        strokeWidth: emphasized ? 2 : 0,
                    })
                }),
                showGrid && React.createElement('g', {},
                    ...xTicks.map((tick) => {
                        const x = xInPlot(tick, xDomain, plot)
                        return React.createElement('line', {
                            key: `quadrant-x-grid-${tick}`,
                            x1: x,
                            y1: plot.y,
                            x2: x,
                            y2: plot.bottom,
                            stroke: c.borderSubtle,
                            strokeWidth: 1,
                        })
                    }),
                    ...yTicks.map((tick) => {
                        const y = yInPlot(tick, yDomain, plot)
                        return React.createElement('line', {
                            key: `quadrant-y-grid-${tick}`,
                            x1: plot.x,
                            y1: y,
                            x2: plot.right,
                            y2: y,
                            stroke: c.borderSubtle,
                            strokeWidth: 1,
                        })
                    }),
                ),
                React.createElement('rect', {
                    x: plot.x,
                    y: plot.y,
                    width: plot.innerWidth,
                    height: plot.innerHeight,
                    fill: 'transparent',
                    stroke: c.borderLight,
                    strokeWidth: 1.2,
                    rx: 8,
                }),
                React.createElement('line', {
                    x1: midX,
                    y1: plot.y,
                    x2: midX,
                    y2: plot.bottom,
                    stroke: c.borderLight,
                    strokeWidth: 1.4,
                }),
                React.createElement('line', {
                    x1: plot.x,
                    y1: midY,
                    x2: plot.right,
                    y2: midY,
                    stroke: c.borderLight,
                    strokeWidth: 1.4,
                }),
                ...(showTicks ? xTicks : []).map((tick) => {
                    const x = xInPlot(tick, xDomain, plot)
                    return React.createElement('line', {
                        key: `quadrant-x-tick-${tick}`,
                        x1: x,
                        y1: plot.bottom,
                        x2: x,
                        y2: plot.bottom + 5,
                        stroke: c.textMuted,
                        strokeWidth: 1.2,
                    })
                }),
                ...(showTicks ? yTicks : []).map((tick) => {
                    const y = yInPlot(tick, yDomain, plot)
                    return React.createElement('line', {
                        key: `quadrant-y-tick-${tick}`,
                        x1: plot.x - 5,
                        y1: y,
                        x2: plot.x,
                        y2: y,
                        stroke: c.textMuted,
                        strokeWidth: 1.2,
                    })
                }),
                ...pointGeometries.map(({ point, index, x, y, color }) => React.createElement('circle', {
                    key: `quadrant-point-${point.label ?? index}`,
                    cx: x,
                    cy: y,
                    r: point.size ?? 8,
                    fill: color,
                    stroke: c.bgCard,
                    strokeWidth: 3,
                })),
            ),
            ...regionEntries.flatMap(({ key, region, x, y, width: regionWidth }, index) => {
                const color = chartColor(region.color, c, index)
                return [
                    chartLabel(`quadrant-label-${key}`, region.label, x + regionWidth / 2, y + 18, c, {
                        width: Math.max(1, regionWidth - 24),
                        color,
                        fontFamily: 'Inter',
                        fontWeight: 900,
                        fontSize: 11,
                    }),
                    ...(region.detail ? [chartLabel(`quadrant-detail-${key}`, region.detail, x + regionWidth / 2, y + 34, c, {
                        width: Math.max(1, regionWidth - 24),
                        color: c.textMuted,
                        fontSize: 11,
                    })] : []),
                ]
            }),
            ...(showTicks ? xTicks : []).map((tick) => {
                const x = xInPlot(tick, xDomain, plot)
                return chartLabel(`quadrant-x-tick-label-${tick}`, formatChartValue(tick, formatX), x, plot.bottom + 18, c, { width: 54 })
            }),
            ...(showTicks ? yTicks : []).map((tick) => {
                const y = yInPlot(tick, yDomain, plot)
                return chartLabel(`quadrant-y-tick-label-${tick}`, formatChartValue(tick, formatY), plot.x - 9, y, c, { align: 'right', width: 48 })
            }),
            ...pointGeometries.flatMap(({ point, index, x, y, color }) => {
                if (!point.label) return []
                const placement = pointLabelPlacement(x, y, plot, index, 110)
                return [chartLabel(`quadrant-point-label-${index}`, point.label, placement.x, placement.y, c, {
                    align: placement.align,
                    width: 110,
                    bounds: placement.bounds,
                    color,
                    fontFamily: 'Inter',
                    fontWeight: 850,
                    fontSize: 11,
                })]
            }),
            xAxisLabel && chartLabel('quadrant-x-axis-label', xAxisLabel, plot.x + plot.innerWidth / 2, height - 8, c, {
                width: plot.innerWidth,
                fontFamily: 'Inter',
                fontWeight: 700,
            }),
            yAxisLabel && chartLabel('quadrant-y-axis-label', yAxisLabel, 12, plot.y + plot.innerHeight / 2, c, {
                width: plot.innerHeight,
                fontFamily: 'Inter',
                fontWeight: 700,
                transform: 'translate(-50%, -50%) rotate(-90deg)',
            }),
        ),
    })
}

export interface IntervalDatum {
    label: string
    low: number
    mid: number
    high: number
    color?: ColorName | string
    lowLabel?: string
    midLabel?: string
    highLabel?: string
}

interface IntervalPlotProps {
    data: IntervalDatum[]
    c: ThemeColors
    title?: string
    subtitle?: string
    width?: number
    height?: number
    min?: number
    max?: number
    format?: ChartValueFormat
    axisLabel?: string
    footer?: string
}

export function IntervalPlot({
    data,
    c,
    title,
    subtitle,
    width = 640,
    height = 220,
    min,
    max,
    format = 'decimal',
    axisLabel,
    footer,
}: IntervalPlotProps): React.ReactElement {
    const margin: ChartMargins = { top: 22, right: 28, bottom: axisLabel ? 44 : 30, left: 96 }
    const plot = createPlotArea(width, height, margin)
    const rowGap = data.length <= 1 ? 0 : plot.innerHeight / data.length
    const domain = chartDomain(data.flatMap((item) => [item.low, item.mid, item.high]), min, max)
    const ticks = chartTicks(domain.min, domain.max, 5)
    const scaleX = (value: number) => xInPlot(value, domain, plot)

    const rows = data.map((item, index) => {
        const y = data.length <= 1 ? plot.y + plot.innerHeight / 2 : plot.y + rowGap * index + rowGap / 2
        return {
            item,
            index,
            y,
            color: chartColor(item.color, c, index),
            lowX: scaleX(item.low),
            midX: scaleX(item.mid),
            highX: scaleX(item.high),
        }
    })

    return ChartFrame({ c, title, subtitle, width, footer, children:
        React.createElement('div', { style: { position: 'relative' as const, width, height, display: 'flex' } },
            React.createElement('svg', { width, height, viewBox: `0 0 ${width} ${height}` },
                ...ticks.map((tick) => {
                    const x = scaleX(tick)
                    return React.createElement('line', {
                        key: `interval-tick-${tick}`,
                        x1: x,
                        y1: plot.y,
                        x2: x,
                        y2: plot.bottom,
                        stroke: c.borderSubtle,
                        strokeWidth: 1,
                    })
                }),
                React.createElement('line', { x1: plot.x, y1: plot.bottom, x2: plot.right, y2: plot.bottom, stroke: c.borderLight, strokeWidth: 1.2 }),
                ...rows.flatMap(({ item, index, y, color, lowX, midX, highX }) => [
                    React.createElement('line', { key: `${item.label}-range-${index}`, x1: lowX, y1: y, x2: highX, y2: y, stroke: color, strokeWidth: 9, strokeLinecap: 'round', opacity: 0.9 }),
                    React.createElement('circle', { key: `${item.label}-mid-${index}`, cx: midX, cy: y, r: 10, fill: c.bgCard, stroke: color, strokeWidth: 4 }),
                ]),
            ),
            ...ticks.map((tick) => {
                const x = scaleX(tick)
                return chartLabel(`interval-tick-label-${tick}`, formatChartValue(tick, format), x, height - margin.bottom + 17, c, { width: 48 })
            }),
            axisLabel && chartLabel('interval-axis-label', axisLabel, plot.x + plot.innerWidth / 2, height - 8, c, {
                width: plot.innerWidth,
                fontFamily: 'Inter',
                fontWeight: 700,
            }),
            ...rows.flatMap(({ item, index, y, lowX, midX, highX }) => [
                chartLabel(`interval-row-label-${index}`, item.label, plot.x - 12, y, c, {
                    align: 'right',
                    width: 84,
                    color: c.textPrimary,
                    fontFamily: 'Inter',
                    fontWeight: 900,
                }),
                chartLabel(`interval-low-${index}`, item.lowLabel ?? formatChartValue(item.low, format), lowX, y + 25, c, { width: 48, bounds: { x: plot.x, y: 0, width: plot.innerWidth, height } }),
                chartLabel(`interval-mid-${index}`, item.midLabel ?? formatChartValue(item.mid, format), midX, y - 16, c, {
                    width: 48,
                    bounds: { x: plot.x, y: 0, width: plot.innerWidth, height },
                    color: c.textPrimary,
                    fontWeight: 900,
                }),
                chartLabel(`interval-high-${index}`, item.highLabel ?? formatChartValue(item.high, format), highX, y + 25, c, { width: 48, bounds: { x: plot.x, y: 0, width: plot.innerWidth, height } }),
            ]),
        )
    })
}

// ─── Badge — Small labeled pill ─────────────────────────────────────────────

interface BadgeProps {
    label: string
    c: ThemeColors
    color?: ColorName
}

export function Badge({ label, c, color = 'primary' }: BadgeProps): React.ReactElement {
    const solidColor = getReadableColor(color, c)
    return React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: `${solidColor}20`,
            color: solidColor,
            borderRadius: 999,
            padding: '4px 12px',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'Inter',
            border: `1px solid ${solidColor}40`,
        }
    }, label)
}

// ─── DotPoint — Labeled circle for scatter/space plots ──────────────────────

interface DotPointProps {
    x: number  // pixel coords
    y: number
    label: string
    color: string
    c: ThemeColors
    size?: number
    labelOffset?: { x?: number; y?: number }
}

export function DotPoint({ x, y, label, color, c, size = 12, labelOffset }: DotPointProps): React.ReactElement[] {
    const offX = labelOffset?.x ?? 0
    const offY = labelOffset?.y ?? -22

    return [
        // Dot
        React.createElement('div', {
            key: `dot-${label}`,
            style: {
                position: 'absolute' as const,
                left: x - size / 2,
                top: y - size / 2,
                width: size,
                height: size,
                borderRadius: '50%',
                backgroundColor: color,
                boxShadow: `0 0 14px ${color}50`,
                display: 'flex',
            }
        }),
        // Label
        React.createElement('div', {
            key: `label-${label}`,
            style: {
                position: 'absolute' as const,
                left: x + offX - 30,
                top: y + offY,
                fontSize: 13,
                fontWeight: 600,
                color: c.textPrimary,
                fontFamily: 'JetBrains Mono',
                textAlign: 'center' as const,
                width: 60,
            }
        }, label),
    ]
}

// ─── DashedLine — Dotted/dashed connection between two points ───────────────

interface DashedLineProps {
    x1: number
    y1: number
    x2: number
    y2: number
    color: string
    dotSpacing?: number
    dotSize?: number
}

export function DashedLine({ x1, y1, x2, y2, color, dotSpacing = 8, dotSize = 2 }: DashedLineProps): React.ReactElement[] {
    const dx = x2 - x1
    const dy = y2 - y1
    const length = Math.sqrt(dx * dx + dy * dy)
    // Segments shorter than one dot spacing would otherwise render nothing at all.
    const numDots = Math.max(1, Math.floor(length / dotSpacing))
    const dots: React.ReactElement[] = []

    for (let i = 0; i < numDots; i++) {
        if (i % 2 === 1) continue // skip every other for dashed effect
        const t = i / numDots
        dots.push(
            React.createElement('div', {
                key: `dash-${i}`,
                style: {
                    position: 'absolute' as const,
                    left: x1 + t * dx - dotSize / 2,
                    top: y1 + t * dy - dotSize / 2,
                    width: dotSize,
                    height: dotSize,
                    borderRadius: '50%',
                    backgroundColor: color,
                }
            })
        )
    }

    return dots
}

// ─── Legend — Color-coded key ────────────────────────────────────────────────

interface LegendItem {
    label: string
    color: string
    style?: 'solid' | 'dashed'
}

interface LegendProps {
    items: LegendItem[]
    c: ThemeColors
    title?: string
}

export function Legend({ items, c, title }: LegendProps): React.ReactElement {
    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: 10,
            backgroundColor: c.bgCard,
            borderRadius: 8,
            border: `1px solid ${c.borderSubtle}`,
            padding: '14px 16px',
        }
    },
        title && React.createElement('div', {
            style: {
                fontSize: 11,
                fontWeight: 700,
                color: c.textSecondary,
                textTransform: 'uppercase' as const,
                letterSpacing: 1,
                fontFamily: 'Inter',
            }
        }, title),

        ...items.map((item, i) =>
            React.createElement('div', {
                key: `legend-${i}`,
                style: { display: 'flex', alignItems: 'center', gap: 8 }
            },
                React.createElement('div', {
                    style: {
                        width: 16,
                        height: item.style === 'dashed' ? 0 : 2,
                        backgroundColor: item.color,
                        ...(item.style === 'dashed' ? {
                            borderTop: `2px dashed ${item.color}`,
                        } : {}),
                    }
                }),
                React.createElement('div', {
                    style: {
                        fontSize: 11,
                        color: c.textMuted,
                        fontFamily: 'Inter',
                    }
                }, item.label),
            )
        ),
    )
}
