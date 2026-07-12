import React from 'react'
import {
    typography,
    heatColor,
    type ThemeColors,
    type ColorName,
    type ToneName,
    getColor,
    getGradient,
    getToneColor,
    getToneGradient,
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

export interface QuadrantRegion {
    label: string
    detail?: string
    color?: ColorName | string
}

interface QuadrantChartProps {
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
    xAxisLabel?: string
    yAxisLabel?: string
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
    xAxisLabel,
    yAxisLabel,
    footer,
}: QuadrantChartProps): React.ReactElement {
    const margin: ChartMargins = { top: 18, right: 20, bottom: xAxisLabel ? 46 : 24, left: yAxisLabel ? 54 : 24 }
    const plot = createPlotArea(width, height, margin)
    const halfWidth = plot.innerWidth / 2
    const halfHeight = plot.innerHeight / 2
    const midX = plot.x + halfWidth
    const midY = plot.y + halfHeight
    const regionEntries = [
        { key: 'top-left', region: regions.topLeft, x: plot.x, y: plot.y },
        { key: 'top-right', region: regions.topRight, x: midX, y: plot.y },
        { key: 'bottom-left', region: regions.bottomLeft, x: plot.x, y: midY },
        { key: 'bottom-right', region: regions.bottomRight, x: midX, y: midY },
    ]
    const pointGeometries = points.map((point, index) => ({
        point,
        index,
        x: plot.x + clamp(point.x, 0, 1) * plot.innerWidth,
        y: plot.y + plot.innerHeight - clamp(point.y, 0, 1) * plot.innerHeight,
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
                ...regionEntries.map(({ key, region, x, y }, index) => React.createElement('rect', {
                    key: `quadrant-${key}`,
                    x,
                    y,
                    width: halfWidth,
                    height: halfHeight,
                    fill: chartColor(region.color, c, index),
                    opacity: 0.1,
                })),
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
            ...regionEntries.flatMap(({ key, region, x, y }, index) => {
                const color = chartColor(region.color, c, index)
                return [
                    chartLabel(`quadrant-label-${key}`, region.label, x + halfWidth / 2, y + 18, c, {
                        width: halfWidth - 24,
                        color,
                        fontFamily: 'Inter',
                        fontWeight: 900,
                        fontSize: 11,
                    }),
                    ...(region.detail ? [chartLabel(`quadrant-detail-${key}`, region.detail, x + halfWidth / 2, y + 34, c, {
                        width: halfWidth - 24,
                        color: c.textMuted,
                        fontSize: 9,
                    })] : []),
                ]
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
                    fontSize: 10,
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
    const solidColor = getColor(color, c)
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

export function DotPoint({ x, y, label, color, size = 12, labelOffset }: DotPointProps): React.ReactElement[] {
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
                color,
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
    const numDots = Math.floor(length / dotSpacing)
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
