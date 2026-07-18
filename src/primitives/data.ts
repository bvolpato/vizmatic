import React from 'react'
import {
    typography,
    heatColor,
    type ThemeColors,
    type ToneName,
    getToneColor,
} from '../theme'

import { compactChildren, formatMathText, textFitStyle } from './layout'
import { SvgFrame, SvgPoint, VectorArrow, VectorSegment } from './svg'

// ─── Matrix — Grid of values with optional heatmap coloring ─────────────────

interface MatrixProps {
    data: number[][]
    c: ThemeColors
    rowLabels?: string[]
    colLabels?: string[]
    labels?: React.ReactNode[][]
    title?: string
    cellSize?: number
    cellWidth?: number
    cellHeight?: number
    rowLabelWidth?: number
    format?: 'decimal' | 'percent' | 'integer'
    colorize?: boolean
    colorScale?: 'heat' | 'strength'
}

export function Matrix({
    data,
    c,
    rowLabels,
    colLabels,
    labels,
    title,
    cellSize = 48,
    cellWidth,
    cellHeight,
    rowLabelWidth,
    format = 'decimal',
    colorize = true,
    colorScale = 'heat',
}: MatrixProps): React.ReactElement {
    const resolvedCellWidth = cellWidth ?? cellSize
    const resolvedCellHeight = cellHeight ?? cellSize
    const resolvedRowLabelWidth = rowLabelWidth ?? cellSize
    const formatValue = (v: number) => {
        if (format === 'percent') return `${Math.round(v * 100)}%`
        if (format === 'integer') return `${Math.round(v)}`
        return v.toFixed(2)
    }
    const cellColor = (value: number) => {
        if (colorScale === 'heat') return heatColor(value)
        if (value < 0.34) return c.bgHover
        if (value < 0.67) return c.infoDark
        return c.positiveDark
    }

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            gap: 12,
        }
    },
        title && React.createElement('div', {
            style: { ...typography.label, color: c.textPrimary }
        }, title),

        React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                gap: 2,
            }
        },
            // Column labels
            colLabels && React.createElement('div', {
                style: {
                    display: 'flex',
                    gap: 2,
                    marginLeft: rowLabels ? resolvedRowLabelWidth + 4 : 0,
                }
            },
                ...colLabels.map((label, i) =>
                    React.createElement('div', {
                        key: `col-${i}`,
                        style: {
                            width: resolvedCellWidth,
                            textAlign: 'center' as const,
                            fontSize: 11,
                            fontWeight: 600,
                            color: c.textSecondary,
                            fontFamily: 'JetBrains Mono',
                        }
                    }, label)
                )
            ),

            // Data rows
            ...data.map((row, ri) =>
                React.createElement('div', {
                    key: `row-${ri}`,
                    style: {
                        display: 'flex',
                        gap: 2,
                        alignItems: 'center',
                    }
                },
                    rowLabels && React.createElement('div', {
                        style: {
                            width: resolvedRowLabelWidth,
                            textAlign: 'right' as const,
                            paddingRight: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            color: c.textSecondary,
                            fontFamily: 'JetBrains Mono',
                        }
                    }, rowLabels[ri]),

                    ...row.map((value, ci) =>
                        React.createElement('div', {
                            key: `cell-${ri}-${ci}`,
                            style: {
                                width: resolvedCellWidth,
                                height: resolvedCellHeight,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: colorize ? cellColor(value) : c.bgCard,
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 600,
                                color: !colorize
                                    ? c.textPrimary
                                    : colorScale === 'strength' && value < 0.34
                                        ? c.textSecondary
                                        : c.textOnColor,
                                fontFamily: 'JetBrains Mono',
                            }
                        }, labels?.[ri]?.[ci] ?? formatValue(value))
                    ),
                )
            ),
        ),
    )
}

// ─── Heatmap — Convenience alias for Matrix with colorize ───────────────────

interface HeatmapProps {
    data: number[][]
    xLabels: string[]
    yLabels: string[]
    c: ThemeColors
    labels?: React.ReactNode[][]
    title?: string
    cellSize?: number
    cellWidth?: number
    cellHeight?: number
    rowLabelWidth?: number
    colorScale?: 'heat' | 'strength'
}

export function Heatmap({
    data,
    xLabels,
    yLabels,
    c,
    labels,
    title,
    cellSize = 52,
    cellWidth,
    cellHeight,
    rowLabelWidth,
    colorScale,
}: HeatmapProps): React.ReactElement {
    return Matrix({
        data,
        colLabels: xLabels,
        rowLabels: yLabels,
        c,
        labels,
        title,
        colorize: true,
        cellSize,
        cellWidth,
        cellHeight,
        rowLabelWidth,
        colorScale,
    })
}

// ─── TiledMatrix — Symbolic matrix with highlighted tile regions ────────────

export interface TiledMatrixRegion {
    rowStart: number
    rowEnd: number
    colStart: number
    colEnd: number
    tone?: ToneName
}

interface TiledMatrixProps {
    rows: number
    cols: number
    c: ThemeColors
    regions?: TiledMatrixRegion[]
    title?: React.ReactNode
    subtitle?: React.ReactNode
    cellSize?: number
    gap?: number
    tone?: ToneName
    muted?: boolean
    crossedOut?: boolean
}

export function TiledMatrix({
    rows,
    cols,
    c,
    regions = [],
    title,
    subtitle,
    cellSize = 24,
    gap = 3,
    tone = 'blue',
    muted = false,
    crossedOut = false,
}: TiledMatrixProps): React.ReactElement {
    const safeRows = Math.max(1, Math.floor(rows))
    const safeCols = Math.max(1, Math.floor(cols))
    const baseAccent = getToneColor(tone, c)
    const cellRows = Array.from({ length: safeRows }, (_, row) =>
        React.createElement('div', {
            key: `tiled-matrix-row-${row}`,
            style: {
                display: 'flex',
                gap,
            }
        },
            ...Array.from({ length: safeCols }, (_, col) => {
                const regionIndex = regions.findIndex((region) =>
                    row >= region.rowStart
                    && row < region.rowEnd
                    && col >= region.colStart
                    && col < region.colEnd
                )
                const region = regionIndex >= 0 ? regions[regionIndex] : undefined
                const accent = getToneColor(region?.tone ?? tone, c)

                return React.createElement('div', {
                    key: `tiled-matrix-cell-${row}-${col}`,
                    'data-region': regionIndex >= 0 ? regionIndex : undefined,
                    style: {
                        width: cellSize,
                        height: cellSize,
                        boxSizing: 'border-box' as const,
                        borderRadius: Math.max(2, Math.min(6, Math.round(cellSize * 0.18))),
                        backgroundColor: region ? `${accent}42` : (muted ? c.bgSubtle : `${baseAccent}0f`),
                        border: `1px solid ${region ? `${accent}aa` : c.borderSubtle}`,
                        opacity: muted ? 0.55 : 1,
                    }
                })
            }),
        )
    )

    const grid = React.createElement('div', {
        'data-crossed-out': crossedOut ? 'true' : undefined,
        style: {
            position: 'relative' as const,
            display: 'flex',
            flexDirection: 'column' as const,
            gap,
            padding: gap,
            borderRadius: 10,
            backgroundColor: c.bgSubtle,
            border: `1px solid ${c.borderLight}`,
            boxShadow: `0 8px 18px ${c.shadow}`,
            overflow: 'hidden',
        }
    },
        ...cellRows,
        ...(crossedOut ? [
            React.createElement('div', {
                key: 'cross-forward',
                style: {
                    position: 'absolute' as const,
                    left: '-12%',
                    top: '50%',
                    width: '124%',
                    height: 4,
                    borderRadius: 999,
                    backgroundColor: c.criticalLight,
                    transform: 'rotate(36deg)',
                    transformOrigin: 'center',
                    boxShadow: `0 0 0 1px ${c.bgCard}`,
                }
            }),
            React.createElement('div', {
                key: 'cross-backward',
                style: {
                    position: 'absolute' as const,
                    left: '-12%',
                    top: '50%',
                    width: '124%',
                    height: 4,
                    borderRadius: 999,
                    backgroundColor: c.criticalLight,
                    transform: 'rotate(-36deg)',
                    transformOrigin: 'center',
                    boxShadow: `0 0 0 1px ${c.bgCard}`,
                }
            }),
        ] : []),
    )

    return React.createElement('div', {
        role: 'img',
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            gap: 7,
        }
    },
        ...compactChildren([
            title && React.createElement('div', {
                style: {
                    color: muted ? c.textMuted : baseAccent,
                    fontFamily: 'Inter',
                    fontSize: 13,
                    fontWeight: 900,
                    lineHeight: 1.1,
                    textAlign: 'center' as const,
                }
            }, title),
            subtitle && React.createElement('div', {
                style: {
                    color: c.textMuted,
                    fontFamily: 'JetBrains Mono',
                    fontSize: 9,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    textAlign: 'center' as const,
                }
            }, subtitle),
            grid,
        ])
    )
}

// ─── DataTable — Compact text table for labels, matrices, and examples ─────

interface DataTableProps {
    rows: React.ReactNode[][]
    c: ThemeColors
    cellWidth?: number
    firstColWidth?: number
    cellHeight?: number
    gap?: number
    headerRows?: number
    headerCols?: number
    fontSize?: number
    math?: boolean
}

export function DataTable({
    rows,
    c,
    cellWidth = 54,
    firstColWidth = cellWidth,
    cellHeight = 28,
    gap = 5,
    headerRows = 1,
    headerCols = 1,
    fontSize = 10,
    math = false,
}: DataTableProps): React.ReactElement {
    const renderCell = (cell: React.ReactNode) =>
        math && typeof cell === 'string' ? formatMathText(cell) : cell

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap,
            alignItems: 'center',
        }
    },
        ...rows.map((row, rowIndex) => React.createElement('div', {
            key: `${rowIndex}-${row.map(String).join('|')}`,
            style: {
                display: 'flex',
                gap,
            }
        },
            ...row.map((cell, colIndex) => {
                const isHeaderRow = rowIndex < headerRows
                const isHeaderCol = colIndex < headerCols
                return React.createElement('div', {
                    key: `${rowIndex}-${colIndex}-${String(cell)}`,
                    style: {
                        width: colIndex === 0 ? firstColWidth : cellWidth,
                        height: cellHeight,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: 7,
                        backgroundColor: isHeaderRow ? c.bgSubtle : c.bgHover,
                        color: isHeaderCol ? c.textPrimary : c.textSecondary,
                        fontFamily: 'JetBrains Mono',
                        fontSize,
                        fontWeight: isHeaderCol ? 850 : 650,
                        lineHeight: 1.15,
                        ...textFitStyle('center'),
                    }
                }, renderCell(cell))
            }),
        )),
    )
}

// ─── Grid — Plain flex grid for reusable cells without table semantics ──────

interface GridCell {
    label?: React.ReactNode
    tone?: ToneName
    color?: string
    backgroundColor?: string
    borderColor?: string
    opacity?: number
}

interface GridProps {
    rows: Array<Array<React.ReactNode | GridCell>>
    c: ThemeColors
    cellWidth?: number
    cellHeight?: number
    gap?: number
    radius?: number
    fontSize?: number
    math?: boolean
    headerRows?: number
    headerCols?: number
}

function isGridCell(cell: React.ReactNode | GridCell): cell is GridCell {
    return typeof cell === 'object' && cell !== null && !React.isValidElement(cell) && (
        'label' in cell
        || 'tone' in cell
        || 'color' in cell
        || 'backgroundColor' in cell
        || 'borderColor' in cell
        || 'opacity' in cell
    )
}

export function Grid({
    rows,
    c,
    cellWidth = 34,
    cellHeight = 30,
    gap = 5,
    radius = 7,
    fontSize = 10,
    math = false,
    headerRows = 0,
    headerCols = 0,
}: GridProps): React.ReactElement {
    const renderCellLabel = (cell: React.ReactNode | GridCell) => {
        const label = isGridCell(cell) ? cell.label : cell
        return math && typeof label === 'string' ? formatMathText(label) : label
    }

    const cellStyle = (cell: React.ReactNode | GridCell, rowIndex: number, colIndex: number): React.CSSProperties => {
        const config = isGridCell(cell) ? cell : {}
        const toneColor = config.tone ? getToneColor(config.tone, c) : undefined
        const isHeader = rowIndex < headerRows || colIndex < headerCols
        return {
            width: cellWidth,
            height: cellHeight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius,
            backgroundColor: config.backgroundColor ?? (toneColor ? `${toneColor}22` : isHeader ? c.bgSubtle : c.bgHover),
            border: `1px solid ${config.borderColor ?? (toneColor ? `${toneColor}55` : c.borderSubtle)}`,
            color: config.color ?? (toneColor ?? (isHeader ? c.textPrimary : c.textSecondary)),
            ...(config.opacity !== undefined ? { opacity: config.opacity } : {}),
            fontFamily: 'JetBrains Mono',
            fontSize,
            fontWeight: isHeader || toneColor ? 850 : 650,
            lineHeight: 1.15,
            ...textFitStyle('center'),
        }
    }

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap,
            alignItems: 'center',
        }
    },
        ...rows.map((row, rowIndex) => React.createElement('div', {
            key: `grid-row-${rowIndex}`,
            style: {
                display: 'flex',
                gap,
            }
        },
            ...row.map((cell, colIndex) => React.createElement('div', {
                key: `grid-cell-${rowIndex}-${colIndex}`,
                style: cellStyle(cell, rowIndex, colIndex),
            }, renderCellLabel(cell)))
        )),
    )
}

// ─── AxisPlot — SVG axes, points, and vectors for math illustrations ───────

interface AxisPlotPoint {
    x: number
    y: number
    fill?: string
    tone?: ToneName
    r?: number
    stroke?: string
    strokeWidth?: number
    opacity?: number
}

interface AxisPlotVector {
    x1: number
    y1: number
    x2: number
    y2: number
    color?: string
    tone?: ToneName
    strokeWidth?: number
    opacity?: number
    arrow?: boolean
    arrowSize?: number
    showStartDot?: boolean
    showEndDot?: boolean
    dotRadius?: number
}

export interface AxisPlotPath {
    points: Array<{ x: number; y: number }>
    color?: string
    tone?: ToneName
    strokeWidth?: number
    opacity?: number
    interpolation?: 'linear' | 'step-after'
    dashed?: boolean
}

interface AxisPlotProps {
    c: ThemeColors
    width: number
    height: number
    xMin?: number
    xMax?: number
    yMin?: number
    yMax?: number
    padding?: number
    showFrame?: boolean
    showAxes?: boolean
    showGrid?: boolean
    gridCount?: number
    frameRx?: number
    frameFill?: string
    frameStroke?: string
    axisColor?: string
    points?: AxisPlotPoint[]
    vectors?: AxisPlotVector[]
    paths?: AxisPlotPath[]
    xAxisLabel?: string
    yAxisLabel?: string
    children?: React.ReactNode
}

export function AxisPlot({
    c,
    width,
    height,
    xMin = -1,
    xMax = 1,
    yMin = -1,
    yMax = 1,
    padding = 18,
    showFrame = true,
    showAxes = true,
    showGrid = false,
    gridCount = 5,
    frameRx = 8,
    frameFill,
    frameStroke,
    axisColor,
    points = [],
    vectors = [],
    paths = [],
    xAxisLabel,
    yAxisLabel,
    children,
}: AxisPlotProps): React.ReactElement {
    const innerWidth = Math.max(1, width - padding * 2)
    const innerHeight = Math.max(1, height - padding * 2)
    const xRange = xMax === xMin ? 1 : xMax - xMin
    const yRange = yMax === yMin ? 1 : yMax - yMin
    const sx = (x: number) => padding + ((x - xMin) / xRange) * innerWidth
    const sy = (y: number) => padding + innerHeight - ((y - yMin) / yRange) * innerHeight
    const xAxisY = yMin <= 0 && yMax >= 0 ? sy(0) : padding + innerHeight / 2
    const yAxisX = xMin <= 0 && xMax >= 0 ? sx(0) : padding + innerWidth / 2
    const axisStroke = axisColor ?? c.borderLight
    const gridIndexes = Array.from({ length: Math.max(0, gridCount) }, (_, index) => index + 1)

    const elements: React.ReactElement[] = []

    if (showFrame) {
        elements.push(SvgFrame({
            key: 'axis-frame',
            x: padding / 2,
            y: padding / 2,
            width: width - padding,
            height: height - padding,
            rx: frameRx,
            c,
            fill: frameFill,
            stroke: frameStroke,
        }))
    }

    if (showGrid && gridCount > 0) {
        elements.push(...gridIndexes.flatMap((index) => {
            const x = padding + innerWidth * index / (gridCount + 1)
            const y = padding + innerHeight * index / (gridCount + 1)
            return [
                React.createElement('line', {
                    key: `axis-grid-x-${index}`,
                    x1: x,
                    y1: padding,
                    x2: x,
                    y2: padding + innerHeight,
                    stroke: c.borderSubtle,
                    strokeWidth: 1,
                    opacity: 0.75,
                }),
                React.createElement('line', {
                    key: `axis-grid-y-${index}`,
                    x1: padding,
                    y1: y,
                    x2: padding + innerWidth,
                    y2: y,
                    stroke: c.borderSubtle,
                    strokeWidth: 1,
                    opacity: 0.75,
                }),
            ]
        }))
    }

    if (showAxes) {
        elements.push(
            React.createElement('line', {
                key: 'axis-x',
                x1: padding,
                y1: xAxisY,
                x2: padding + innerWidth,
                y2: xAxisY,
                stroke: axisStroke,
                strokeWidth: 1.6,
                opacity: 0.85,
            }),
            React.createElement('line', {
                key: 'axis-y',
                x1: yAxisX,
                y1: padding,
                x2: yAxisX,
                y2: padding + innerHeight,
                stroke: axisStroke,
                strokeWidth: 1.6,
                opacity: 0.85,
            }),
        )
    }

    elements.push(...paths.flatMap((path, index) => {
        if (path.points.length < 2) return []
        const [first, ...rest] = path.points
        const commands = [`M ${sx(first.x)} ${sy(first.y)}`]
        for (const point of rest) {
            if (path.interpolation === 'step-after') {
                commands.push(`H ${sx(point.x)} V ${sy(point.y)}`)
            } else {
                commands.push(`L ${sx(point.x)} ${sy(point.y)}`)
            }
        }
        return [React.createElement('path', {
            key: `axis-path-${index}`,
            d: commands.join(' '),
            fill: 'none',
            stroke: path.color ?? getToneColor(path.tone ?? 'blue', c),
            strokeWidth: path.strokeWidth ?? 3,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            strokeDasharray: path.dashed ? '8 7' : undefined,
            opacity: path.opacity ?? 1,
        })]
    }))

    elements.push(...vectors.map((vector, index) => {
        const color = vector.color ?? getToneColor(vector.tone ?? 'blue', c)
        const x1 = sx(vector.x1)
        const y1 = sy(vector.y1)
        const x2 = sx(vector.x2)
        const y2 = sy(vector.y2)
        if (vector.arrow) {
            return VectorArrow({
                key: `axis-vector-${index}`,
                x1,
                y1,
                x2,
                y2,
                color,
                strokeWidth: vector.strokeWidth,
                arrowSize: vector.arrowSize,
                opacity: vector.opacity,
            })
        }
        return VectorSegment({
            key: `axis-vector-${index}`,
            x1,
            y1,
            x2,
            y2,
            color,
            strokeWidth: vector.strokeWidth,
            opacity: vector.opacity,
            showStartDot: vector.showStartDot,
            showEndDot: vector.showEndDot,
            dotRadius: vector.dotRadius,
        })
    }))

    elements.push(...points.map((point, index) => SvgPoint({
        key: `axis-point-${index}`,
        cx: sx(point.x),
        cy: sy(point.y),
        r: point.r ?? 5,
        fill: point.fill ?? getToneColor(point.tone ?? 'blue', c),
        stroke: point.stroke,
        strokeWidth: point.strokeWidth,
        opacity: point.opacity,
    })))

    elements.push(...React.Children.toArray(children).filter(React.isValidElement))

    const svg = React.createElement('svg', {
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
    }, ...elements)

    if (!xAxisLabel && !yAxisLabel) return svg

    return React.createElement('div', {
        style: {
            position: 'relative' as const,
            width,
            height,
            display: 'flex',
        }
    },
        svg,
        xAxisLabel && React.createElement('div', {
            key: 'axis-x-label',
            style: {
                position: 'absolute' as const,
                left: width / 2,
                bottom: 0,
                width: width - padding * 2,
                transform: 'translateX(-50%)',
                textAlign: 'center' as const,
                color: c.textMuted,
                fontFamily: 'Inter',
                fontSize: 11,
                fontWeight: 750,
            }
        }, xAxisLabel),
        yAxisLabel && React.createElement('div', {
            key: 'axis-y-label',
            style: {
                position: 'absolute' as const,
                left: 0,
                top: height / 2,
                width: height - padding * 2,
                transform: 'translate(-50%, -50%) rotate(-90deg)',
                textAlign: 'center' as const,
                color: c.textMuted,
                fontFamily: 'Inter',
                fontSize: 11,
                fontWeight: 750,
            }
        }, yAxisLabel),
    )
}
