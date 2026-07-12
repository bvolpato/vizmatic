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

import { clamp, textFitStyle } from './layout'

// ─── Chart helpers — Reusable axes, bars, curves, ranges, and points ────────

export type ChartValueFormat = 'decimal' | 'percent' | 'integer' | 'compact' | ((value: number) => string)

export interface ChartLegendItem {
    label: string
    color: ColorName | string
}

export interface ChartMargins {
    top: number
    right: number
    bottom: number
    left: number
}

export interface PlotArea {
    width: number
    height: number
    margin: ChartMargins
    x: number
    y: number
    right: number
    bottom: number
    innerWidth: number
    innerHeight: number
}

interface ChartFrameProps {
    children: React.ReactNode
    c: ThemeColors
    title?: string
    subtitle?: string
    legend?: ChartLegendItem[]
    footer?: string
    width?: number | string
    height?: number | string
    padding?: number
}

const chartPalette: ColorName[] = ['primary', 'secondary', 'positive', 'warning', 'info', 'accent', 'critical']

function isColorName(value: string): value is ColorName {
    return chartPalette.includes(value as ColorName) || value === 'neutral'
}

export function chartColor(color: ColorName | string | undefined, c: ThemeColors, index = 0): string {
    if (!color) return getColor(chartPalette[index % chartPalette.length], c)
    return isColorName(color) ? getColor(color, c) : color
}

export function formatChartValue(value: number, format: ChartValueFormat = 'decimal'): string {
    if (typeof format === 'function') return format(value)
    if (format === 'percent') return `${Math.round(value * 100)}%`
    if (format === 'integer') return `${Math.round(value)}`
    if (format === 'compact') {
        if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
        if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`
        return `${Math.round(value)}`
    }
    return Number.isInteger(value) ? `${value}` : value.toFixed(2)
}

export function chartDomain(values: number[], min?: number, max?: number): { min: number; max: number; range: number } {
    const rawMin = min ?? Math.min(0, ...values)
    const rawMax = max ?? Math.max(...values, 1)
    const range = rawMax === rawMin ? 1 : rawMax - rawMin
    return { min: rawMin, max: rawMax, range }
}

export function chartTicks(min: number, max: number, count = 4): number[] {
    if (count <= 1) return [min]
    const step = (max - min) / (count - 1)
    return Array.from({ length: count }, (_, index) => min + step * index)
}


function axisTextStyle(c: ThemeColors): React.CSSProperties {
    return {
        fontFamily: 'JetBrains Mono',
        fontSize: 10,
        fontWeight: 600,
        color: c.textMuted,
        lineHeight: 1,
    }
}

export function createPlotArea(width: number, height: number, margin: ChartMargins): PlotArea {
    const innerWidth = Math.max(1, width - margin.left - margin.right)
    const innerHeight = Math.max(1, height - margin.top - margin.bottom)
    return {
        width,
        height,
        margin,
        x: margin.left,
        y: margin.top,
        right: width - margin.right,
        bottom: height - margin.bottom,
        innerWidth,
        innerHeight,
    }
}

function scaleToRange(value: number, min: number, range: number, outputStart: number, outputLength: number): number {
    return outputStart + ((value - min) / range) * outputLength
}

export function xInPlot(value: number, domain: { min: number; range: number }, plot: PlotArea): number {
    return scaleToRange(value, domain.min, domain.range, plot.x, plot.innerWidth)
}

export function yInPlot(value: number, domain: { min: number; range: number }, plot: PlotArea): number {
    return plot.y + plot.innerHeight - ((value - domain.min) / domain.range) * plot.innerHeight
}

type ChartLabelAlign = 'left' | 'center' | 'right'

interface ChartLabelBounds {
    x: number
    y: number
    width: number
    height: number
    padding?: number
}

export function chartLabel(
    key: string,
    text: string,
    x: number,
    y: number,
    c: ThemeColors,
    options: {
        align?: ChartLabelAlign
        width?: number
        color?: string
        fontFamily?: string
        fontWeight?: number
        fontSize?: number
        transform?: string
        bounds?: ChartLabelBounds
        height?: number
    } = {},
): React.ReactElement {
    const align = options.align ?? 'center'
    const width = options.width ?? 72
    const fontSize = options.fontSize ?? 10
    const labelHeight = options.height ?? Math.ceil(fontSize * 1.4)
    let left = x
    let top = y
    let transform: string | undefined = options.transform ?? (
        align === 'center' ? 'translate(-50%, -50%)' :
            align === 'right' ? 'translate(-100%, -50%)' :
                'translate(0, -50%)'
    )

    if (options.bounds) {
        const padding = options.bounds.padding ?? 4
        const idealLeft = align === 'center'
            ? x - width / 2
            : align === 'right'
                ? x - width
                : x
        const idealTop = y - labelHeight / 2
        left = clamp(
            idealLeft,
            options.bounds.x + padding,
            options.bounds.x + options.bounds.width - width - padding,
        )
        top = clamp(
            idealTop,
            options.bounds.y + padding,
            options.bounds.y + options.bounds.height - labelHeight - padding,
        )
        transform = undefined
    }

    return React.createElement('div', {
        key,
        style: {
            position: 'absolute' as const,
            left,
            top,
            width,
            ...(transform !== undefined ? { transform } : {}),
            display: 'flex',
            justifyContent: align === 'right' ? 'flex-end' : align === 'left' ? 'flex-start' : 'center',
            ...textFitStyle(align),
            pointerEvents: 'none' as const,
            ...axisTextStyle(c),
            color: options.color ?? c.textMuted,
            fontFamily: options.fontFamily ?? 'JetBrains Mono',
            fontWeight: options.fontWeight ?? 600,
            fontSize,
            lineHeight: 1.15,
        }
    }, text)
}

export function pointLabelPlacement(
    x: number,
    y: number,
    plot: PlotArea,
    index: number,
    width = 70,
): { x: number; y: number; align: ChartLabelAlign; width: number; bounds: ChartLabelBounds } {
    const nearTop = y < plot.y + 34
    const nearBottom = y > plot.bottom - 34
    const nearLeft = x < plot.x + 76
    const nearRight = x > plot.right - 76

    const align: ChartLabelAlign = nearLeft ? 'left' : nearRight ? 'right' : 'center'
    const verticalOffset = nearTop ? 18 : nearBottom ? -18 : (index % 2 === 0 ? -16 : 18)

    return {
        x,
        y: y + verticalOffset,
        align,
        width,
        bounds: {
            x: plot.x,
            y: plot.y,
            width: plot.innerWidth,
            height: plot.innerHeight,
            padding: 6,
        },
    }
}

export function ChartFrame({
    children,
    c,
    title,
    subtitle,
    legend,
    footer,
    width = '100%',
    height,
    padding = 16,
}: ChartFrameProps): React.ReactElement {
    return React.createElement('div', {
        style: {
            width,
            ...(height ? { height } : {}),
            display: 'flex',
            flexDirection: 'column' as const,
            gap: 12,
            padding,
            borderRadius: 8,
            border: `1px solid ${c.borderSubtle}`,
            backgroundColor: c.bgCard,
            boxShadow: `0 9px 24px ${c.shadow}`,
        }
    },
        (title || subtitle) && React.createElement('div', {
            style: { display: 'flex', flexDirection: 'column' as const, gap: 4, minWidth: 0, maxWidth: '100%' }
        },
            title && React.createElement('div', {
                style: { ...typography.small, ...textFitStyle(), color: c.textPrimary, fontWeight: 900 }
            }, title),
            subtitle && React.createElement('div', {
                style: { ...typography.tiny, ...textFitStyle(), color: c.textSecondary, lineHeight: 1.35 }
            }, subtitle),
        ),
        children,
        (legend || footer) && React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: legend ? 'space-between' : 'center',
                gap: 12,
                minHeight: 18,
            }
        },
            legend && React.createElement('div', {
                style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const, minWidth: 0 }
            },
                ...legend.map((item, index) => React.createElement('div', {
                    key: `${item.label}-${index}`,
                    style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }
                },
                    React.createElement('span', {
                        style: {
                            width: 14,
                            height: 3,
                            borderRadius: 999,
                            backgroundColor: chartColor(item.color, c, index),
                            display: 'flex',
                        }
                    }),
                    React.createElement('span', {
                        style: { ...typography.tiny, ...textFitStyle(), color: c.textSecondary }
                    }, item.label),
                )),
            ),
            footer && React.createElement('div', {
                style: { ...typography.tiny, ...textFitStyle('right'), color: c.textMuted }
            }, footer),
        ),
    )
}

function polarPoint(cx: number, cy: number, radius: number, angleDegrees: number): { x: number; y: number } {
    const radians = (angleDegrees * Math.PI) / 180
    return {
        x: cx + radius * Math.cos(radians),
        y: cy + radius * Math.sin(radians),
    }
}

function donutArcPath(
    cx: number,
    cy: number,
    outerRadius: number,
    innerRadius: number,
    startAngle: number,
    endAngle: number,
): string {
    const span = Math.min(359.99, Math.max(0.01, endAngle - startAngle))
    const safeEnd = startAngle + span
    const outerStart = polarPoint(cx, cy, outerRadius, startAngle)
    const outerEnd = polarPoint(cx, cy, outerRadius, safeEnd)
    const innerEnd = polarPoint(cx, cy, innerRadius, safeEnd)
    const innerStart = polarPoint(cx, cy, innerRadius, startAngle)
    const largeArc = span > 180 ? 1 : 0

    return [
        `M ${outerStart.x} ${outerStart.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
        `L ${innerEnd.x} ${innerEnd.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
        'Z',
    ].join(' ')
}

export interface DonutChartSegment {
    label: string
    value: number
    color?: ColorName | string
    valueLabel?: string
}

interface DonutChartProps {
    segments: DonutChartSegment[]
    c: ThemeColors
    title?: string
    subtitle?: string
    width?: number
    height?: number
    size?: number
    thickness?: number
    format?: ChartValueFormat
    centerLabel?: React.ReactNode
    centerValue?: React.ReactNode
    showLegend?: boolean
    footer?: string
}

export function DonutChart({
    segments,
    c,
    title,
    subtitle,
    width = 360,
    height = 230,
    size,
    thickness,
    format = 'decimal',
    centerLabel,
    centerValue,
    showLegend = true,
    footer,
}: DonutChartProps): React.ReactElement {
    const positiveSegments = segments.filter((segment) => segment.value > 0)
    const total = positiveSegments.reduce((sum, segment) => sum + segment.value, 0)
    const resolvedSize = size ?? Math.min(162, Math.max(128, height - 44), Math.max(128, width * 0.48))
    const resolvedThickness = thickness ?? Math.max(20, Math.round(resolvedSize * 0.18))
    const outerRadius = resolvedSize / 2 - 2
    const innerRadius = Math.max(18, outerRadius - resolvedThickness)
    const cx = resolvedSize / 2
    const cy = resolvedSize / 2
    let cursor = -90
    const resolvedCenterValue = centerValue ?? (centerLabel != null ? formatChartValue(total, format) : undefined)

    const paths = positiveSegments.map((segment, index) => {
        const rawSpan = total > 0 ? (segment.value / total) * 360 : 0
        const gap = positiveSegments.length > 1 ? Math.min(1.5, rawSpan * 0.28) : 0
        const start = cursor + gap / 2
        const end = cursor + rawSpan - gap / 2
        cursor += rawSpan
        if (end <= start) return null

        return React.createElement('path', {
            key: `donut-segment-${segment.label}-${index}`,
            d: donutArcPath(cx, cy, outerRadius, innerRadius, start, end),
            fill: chartColor(segment.color, c, index),
        })
    }).filter(Boolean)

    const legend = showLegend && positiveSegments.length > 0 && React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: 8,
            flex: 1,
            minWidth: 112,
        }
    }, ...positiveSegments.map((segment, index) => React.createElement('div', {
        key: `donut-legend-${segment.label}-${index}`,
        style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
        }
    },
        React.createElement('span', {
            style: {
                display: 'flex',
                width: 10,
                height: 10,
                borderRadius: 3,
                backgroundColor: chartColor(segment.color, c, index),
                flexShrink: 0,
            }
        }),
        React.createElement('span', {
            style: {
                ...typography.tiny,
                ...textFitStyle(),
                color: c.textSecondary,
                flex: 1,
            }
        }, segment.label),
        React.createElement('span', {
            style: {
                ...typography.tiny,
                color: c.textPrimary,
                fontFamily: 'JetBrains Mono',
                fontWeight: 850,
                flexShrink: 0,
            }
        }, segment.valueLabel ?? formatChartValue(segment.value, format)),
    )))

    return ChartFrame({
        c,
        title,
        subtitle,
        footer,
        width,
        height,
        padding: 16,
        children: React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: showLegend ? 'space-between' : 'center',
                gap: 18,
                minHeight: resolvedSize,
                width: '100%',
            }
        },
            React.createElement('div', {
                style: {
                    position: 'relative' as const,
                    display: 'flex',
                    width: resolvedSize,
                    height: resolvedSize,
                    flexShrink: 0,
                }
            },
                React.createElement('svg', {
                    width: resolvedSize,
                    height: resolvedSize,
                    viewBox: `0 0 ${resolvedSize} ${resolvedSize}`,
                },
                    positiveSegments.length === 0
                        ? React.createElement('circle', {
                            cx,
                            cy,
                            r: (outerRadius + innerRadius) / 2,
                            fill: 'none',
                            stroke: c.borderLight,
                            strokeWidth: resolvedThickness,
                        })
                        : paths,
                ),
                (centerLabel != null || resolvedCenterValue != null) && React.createElement('div', {
                    style: {
                        position: 'absolute' as const,
                        inset: resolvedThickness,
                        display: 'flex',
                        flexDirection: 'column' as const,
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 3,
                        textAlign: 'center' as const,
                    }
                },
                    resolvedCenterValue != null && React.createElement('div', {
                        style: {
                            ...typography.small,
                            color: c.textPrimary,
                            fontFamily: 'JetBrains Mono',
                            fontSize: 18,
                            fontWeight: 900,
                            lineHeight: 1.05,
                            ...textFitStyle('center'),
                        }
                    }, resolvedCenterValue),
                    centerLabel != null && React.createElement('div', {
                        style: {
                            ...typography.tiny,
                            color: c.textMuted,
                            lineHeight: 1.2,
                            ...textFitStyle('center'),
                        }
                    }, centerLabel),
                ),
            ),
            legend,
        ),
    })
}

export interface BarChartDatum {
    label: string
    value: number
    color?: ColorName | string
    valueLabel?: string
}

export interface StackedBarSegment {
    label: string
    value: number
    color?: ColorName | string
    valueLabel?: string
}

interface StackedBarProps {
    segments: StackedBarSegment[]
    c: ThemeColors
    width?: number
    height?: number
    title?: string
    subtitle?: string
    showLegend?: boolean
}

export function StackedBar({
    segments,
    c,
    width = 480,
    height = 68,
    title,
    subtitle,
    showLegend = true,
}: StackedBarProps): React.ReactElement {
    const positiveSegments = segments.filter((segment) => segment.value > 0)
    const total = positiveSegments.reduce((sum, segment) => sum + segment.value, 0)

    return React.createElement('div', {
        style: {
            width,
            display: 'flex',
            flexDirection: 'column' as const,
            gap: 10,
        }
    },
        (title || subtitle) && React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                gap: 3,
            }
        },
            title && React.createElement('div', {
                style: { ...typography.label, color: c.textPrimary, fontWeight: 850 }
            }, title),
            subtitle && React.createElement('div', {
                style: { ...typography.tiny, color: c.textSecondary }
            }, subtitle),
        ),
        React.createElement('div', {
            style: {
                width,
                height,
                display: 'flex',
                overflow: 'hidden',
                borderRadius: 14,
                border: `1px solid ${c.borderLight}`,
                backgroundColor: c.bgCard,
                boxShadow: `0 8px 22px ${c.shadow}`,
            }
        },
            ...positiveSegments.map((segment, index) => {
                const share = total > 0 ? segment.value / total : 0
                const segmentWidth = width * share
                const color = chartColor(segment.color, c, index)
                return React.createElement('div', {
                    key: `${segment.label}-${index}`,
                    style: {
                        width: `${share * 100}%`,
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: color,
                        ...(index < positiveSegments.length - 1
                            ? { borderRight: `2px solid ${c.bgSubtle}` }
                            : {}),
                    }
                },
                    segmentWidth >= 64 && React.createElement('span', {
                        style: {
                            ...typography.small,
                            color: c.textOnColor,
                            fontWeight: 900,
                            whiteSpace: 'nowrap' as const,
                        }
                    }, segment.valueLabel ?? formatChartValue(share, 'percent')),
                )
            }),
        ),
        showLegend && React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                flexWrap: 'wrap' as const,
            }
        },
            ...positiveSegments.map((segment, index) => {
                const share = total > 0 ? segment.value / total : 0
                return React.createElement('div', {
                    key: `legend-${segment.label}-${index}`,
                    style: { display: 'flex', alignItems: 'center', gap: 7 }
                },
                    React.createElement('span', {
                        style: {
                            width: 12,
                            height: 12,
                            borderRadius: 4,
                            display: 'flex',
                            backgroundColor: chartColor(segment.color, c, index),
                        }
                    }),
                    React.createElement('span', {
                        style: { ...typography.tiny, color: c.textSecondary }
                    }, `${segment.label} ${segment.valueLabel ?? formatChartValue(share, 'percent')}`),
                )
            }),
        ),
    )
}

interface BarChartProps {
    data: BarChartDatum[]
    c: ThemeColors
    title?: string
    subtitle?: string
    width?: number
    height?: number
    min?: number
    max?: number
    format?: ChartValueFormat
    showGrid?: boolean
    showValues?: boolean
    yAxisLabel?: string
    footer?: string
}

export function BarChart({
    data,
    c,
    title,
    subtitle,
    width = 320,
    height = 220,
    min,
    max,
    format = 'decimal',
    showGrid = true,
    showValues = true,
    yAxisLabel,
    footer,
}: BarChartProps): React.ReactElement {
    const margin: ChartMargins = { top: 18, right: 38, bottom: 40, left: yAxisLabel ? 52 : 38 }
    const plot = createPlotArea(width, height, margin)
    const domain = chartDomain(data.map((item) => item.value), min, max)
    const ticks = chartTicks(domain.min, domain.max, 4)
    const barSlot = plot.innerWidth / Math.max(data.length, 1)
    const barWidth = Math.max(8, Math.min(76, barSlot * 0.72))
    const zeroY = yInPlot(0, domain, plot)
    const baselineY = clamp(zeroY, plot.y, plot.bottom)

    const barGeometries = data.map((item, index) => {
        const x = plot.x + index * barSlot + (barSlot - barWidth) / 2
        const valueY = yInPlot(item.value, domain, plot)
        const y = Math.min(valueY, baselineY)
        const barHeight = Math.max(4, Math.abs(baselineY - valueY))
        return { item, index, x, y, barHeight, valueY, color: chartColor(item.color, c, index) }
    })

    return ChartFrame({ c, title, subtitle, width, footer, children:
        React.createElement('div', { style: { position: 'relative' as const, width, height, display: 'flex' } },
            React.createElement('svg', { width, height, viewBox: `0 0 ${width} ${height}` },
                showGrid && React.createElement('g', {},
                    ...ticks.map((tick) => {
                        const y = yInPlot(tick, domain, plot)
                        return React.createElement('line', {
                            key: `tick-${tick}`,
                            x1: plot.x,
                            y1: y,
                            x2: plot.right,
                            y2: y,
                            stroke: c.borderSubtle,
                            strokeWidth: 1,
                        })
                    })
                ),
                React.createElement('line', { x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.bottom, stroke: c.borderLight, strokeWidth: 1.2 }),
                React.createElement('line', { x1: plot.x, y1: baselineY, x2: plot.right, y2: baselineY, stroke: c.borderLight, strokeWidth: 1.2 }),
                ...barGeometries.map(({ item, index, x, y, barHeight, color }) =>
                    React.createElement('rect', {
                        key: `${item.label}-${index}`,
                        x,
                        y,
                        width: barWidth,
                        height: barHeight,
                        rx: 5,
                        fill: color,
                        opacity: 0.92,
                    })
                ),
            ),
            ...ticks.map((tick) => {
                const y = yInPlot(tick, domain, plot)
                return chartLabel(`tick-label-${tick}`, formatChartValue(tick, format), plot.x - 8, y, c, { align: 'right', width: 36 })
            }),
            yAxisLabel && chartLabel('y-axis-label', yAxisLabel, 12, plot.y + plot.innerHeight / 2, c, {
                width: plot.innerHeight,
                fontFamily: 'Inter',
                fontWeight: 700,
                transform: 'translate(-50%, -50%) rotate(-90deg)',
            }),
            ...barGeometries.flatMap(({ item, index, x, y, barHeight, valueY }) => [
                ...(showValues ? [chartLabel(
                    `bar-value-${index}`,
                    item.valueLabel ?? formatChartValue(item.value, format),
                    x + barWidth / 2,
                    item.value < 0 ? y + barHeight + 12 : clamp(valueY - 8, 10, height - 28),
                    c,
                    { color: c.textPrimary, fontWeight: 800, width: 54, bounds: { x: plot.x, y: 0, width: plot.innerWidth, height } },
                )] : []),
                chartLabel(`bar-label-${index}`, item.label, x + barWidth / 2, height - 16, c, { width: 54 }),
            ]),
        )
    })
}

export interface LineChartSeries {
    name: string
    points: number[]
    color?: ColorName | string
    area?: boolean
}

interface LineChartProps {
    series: LineChartSeries[]
    c: ThemeColors
    title?: string
    subtitle?: string
    width?: number
    height?: number
    labels?: string[]
    min?: number
    max?: number
    format?: ChartValueFormat
    showGrid?: boolean
    showPoints?: boolean
    yAxisLabel?: string
    footer?: string
}

export function LineChart({
    series,
    c,
    title,
    subtitle,
    width = 420,
    height = 240,
    labels,
    min,
    max,
    format = 'decimal',
    showGrid = true,
    showPoints = true,
    yAxisLabel,
    footer,
}: LineChartProps): React.ReactElement {
    const margin: ChartMargins = { top: 18, right: 20, bottom: labels ? 36 : 24, left: yAxisLabel ? 54 : 40 }
    const plot = createPlotArea(width, height, margin)
    const allValues = series.flatMap((item) => item.points)
    const domain = chartDomain(allValues, min, max)
    const maxPoints = Math.max(...series.map((item) => item.points.length), 1)
    const xInset = maxPoints <= 1 ? 0 : Math.min(26, Math.max(14, plot.innerWidth * 0.06))
    const xStart = maxPoints <= 1 ? plot.x + plot.innerWidth / 2 : plot.x + xInset
    const xSpan = maxPoints <= 1 ? 0 : Math.max(1, plot.innerWidth - xInset * 2)
    const xStep = maxPoints <= 1 ? 0 : xSpan / (maxPoints - 1)
    const ticks = chartTicks(domain.min, domain.max, 4)

    const pointFor = (value: number, index: number) => {
        const x = xStart + index * xStep
        const y = yInPlot(value, domain, plot)
        return { x, y }
    }

    const pathFor = (points: number[]) => points
        .map((value, index) => {
            const point = pointFor(value, index)
            return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
        })
        .join(' ')

    return ChartFrame({
        c,
        title,
        subtitle,
        width,
        footer,
        legend: series.map((item, index) => ({ label: item.name, color: item.color ?? chartPalette[index % chartPalette.length] })),
        children: React.createElement('div', { style: { position: 'relative' as const, width, height, display: 'flex' } },
            React.createElement('svg', { width, height, viewBox: `0 0 ${width} ${height}` },
                showGrid && React.createElement('g', {},
                    ...ticks.map((tick) => {
                        const y = yInPlot(tick, domain, plot)
                        return React.createElement('line', {
                            key: `line-tick-${tick}`,
                            x1: plot.x,
                            y1: y,
                            x2: plot.right,
                            y2: y,
                            stroke: c.borderSubtle,
                            strokeWidth: 1,
                        })
                    })
                ),
                React.createElement('line', { x1: plot.x, y1: plot.y, x2: plot.x, y2: plot.bottom, stroke: c.borderLight, strokeWidth: 1.2 }),
                React.createElement('line', { x1: plot.x, y1: plot.bottom, x2: plot.right, y2: plot.bottom, stroke: c.borderLight, strokeWidth: 1.2 }),
                ...series.flatMap((item, seriesIndex) => {
                    if (item.points.length === 0) return []
                    const color = chartColor(item.color, c, seriesIndex)
                    const linePath = pathFor(item.points)
                    let areaPath = ''
                    if (item.area && item.points.length > 1) {
                        const firstPoint = pointFor(item.points[0], 0)
                        const lastPoint = pointFor(item.points[item.points.length - 1], item.points.length - 1)
                        areaPath = `${linePath} L ${lastPoint.x} ${plot.bottom} L ${firstPoint.x} ${plot.bottom} Z`
                    }
                    const elements: React.ReactElement[] = []
                    if (areaPath) {
                        elements.push(React.createElement('path', { key: `${item.name}-area`, d: areaPath, fill: color, opacity: 0.12 }))
                    }
                    elements.push(React.createElement('path', {
                        key: `${item.name}-line`,
                        d: linePath,
                        fill: 'none',
                        stroke: color,
                        strokeWidth: 4,
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                    }))
                    if (showPoints) {
                        elements.push(...item.points.map((value, index) => {
                            const point = pointFor(value, index)
                            return React.createElement('circle', {
                                key: `${item.name}-point-${index}`,
                                cx: point.x,
                                cy: point.y,
                                r: 5,
                                fill: c.bgCard,
                                stroke: color,
                                strokeWidth: 3,
                            })
                        }))
                    }
                    return elements
                }),
            ),
            ...ticks.map((tick) => {
                const y = yInPlot(tick, domain, plot)
                return chartLabel(`line-tick-label-${tick}`, formatChartValue(tick, format), plot.x - 8, y, c, { align: 'right', width: 36 })
            }),
            yAxisLabel && chartLabel('line-y-axis-label', yAxisLabel, 12, plot.y + plot.innerHeight / 2, c, {
                width: plot.innerHeight,
                fontFamily: 'Inter',
                fontWeight: 700,
                transform: 'translate(-50%, -50%) rotate(-90deg)',
            }),
            ...(labels ?? []).map((label, index) => {
                const x = xStart + index * xStep
                return chartLabel(`line-x-${label}`, label, x, height - 14, c, { width: 72 })
            }),
        )
    })
}

