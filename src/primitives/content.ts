import React from 'react'
import {
    typography,
    type ThemeColors,
    type ToneName,
    getToneColor,
    getToneGradient,
} from '../theme'

import { Column, compactChildren, type FlexAlign, formatMathText, Panel, Row } from './layout'
import { Card, renderMaybeMath } from './surfaces'

// ─── ProgressRow / ProgressList — Compact labeled score bars ───────────────

export interface ProgressRowSpec {
    label: React.ReactNode
    value: number
    valueLabel?: React.ReactNode
    tone?: ToneName
    muted?: boolean
}

interface ProgressRowProps extends ProgressRowSpec {
    c: ThemeColors
    labelWidth?: number
    valueWidth?: number
    barHeight?: number
    fontSize?: number
}

export function ProgressRow({
    label,
    value,
    valueLabel,
    tone = 'blue',
    muted = false,
    c,
    labelWidth = 42,
    valueWidth = 38,
    barHeight = 8,
    fontSize = 10,
}: ProgressRowProps): React.ReactElement {
    const accent = muted ? c.textMuted : getToneColor(tone, c)
    const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)

    return React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
        }
    },
        React.createElement('div', {
            style: {
                width: labelWidth,
                color: muted ? c.textMuted : c.textPrimary,
                fontSize,
                fontWeight: 800,
                lineHeight: 1,
            }
        }, label),
        React.createElement('div', {
            style: {
                display: 'flex',
                flex: 1,
                height: barHeight,
                borderRadius: 999,
                backgroundColor: c.bgSubtle,
                border: `1px solid ${c.borderSubtle}`,
                overflow: 'hidden',
            }
        },
            React.createElement('div', {
                style: {
                    width: `${pct}%`,
                    height: '100%',
                    borderRadius: 999,
                    backgroundColor: accent,
                    opacity: muted ? 0.62 : 1,
                }
            }),
        ),
        React.createElement('div', {
            style: {
                width: valueWidth,
                color: accent,
                fontSize,
                fontWeight: 800,
                fontFamily: 'JetBrains Mono',
                lineHeight: 1,
                textAlign: 'right' as const,
            }
        }, valueLabel ?? `${pct}%`),
    )
}

interface ProgressListProps {
    rows: ProgressRowSpec[]
    c: ThemeColors
    gap?: number
    labelWidth?: number
    valueWidth?: number
    barHeight?: number
    fontSize?: number
}

export function ProgressList({
    rows,
    c,
    gap = 8,
    labelWidth,
    valueWidth,
    barHeight,
    fontSize,
}: ProgressListProps): React.ReactElement {
    return Column({
        gap,
        align: 'stretch',
        children: rows.map((row, index) => React.createElement(React.Fragment, { key: `progress-${index}` },
            ProgressRow({
                ...row,
                c,
                labelWidth,
                valueWidth,
                barHeight,
                fontSize,
            })
        )),
    })
}

// ─── MiniBarChart — Tiny in-card distribution bars without full axes ───────

export interface MiniBarDatum {
    label: React.ReactNode
    value: number
    tone?: ToneName
    color?: string
    valueLabel?: React.ReactNode
    opacity?: number
}

interface MiniBarChartProps {
    data: MiniBarDatum[]
    c: ThemeColors
    max?: number
    minBarHeight?: number
    height?: number
    barWidth?: number
    gap?: number
    radius?: number
    fontSize?: number
    showValues?: boolean
}

export function MiniBarChart({
    data,
    c,
    max,
    minBarHeight = 8,
    height = 92,
    barWidth = 22,
    gap = 10,
    radius = 7,
    fontSize = 9,
    showValues = false,
}: MiniBarChartProps): React.ReactElement {
    const safeMax = max ?? Math.max(1, ...data.map((item) => Math.max(0, item.value)))
    const barMaxHeight = Math.max(minBarHeight, height - (showValues ? 34 : 20))

    return React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap,
            height,
            width: '100%',
            padding: '0 4px',
            boxSizing: 'border-box' as const,
        }
    },
        ...data.map((item, index) => {
            const tone = item.tone ?? 'blue'
            const barHeight = Math.max(minBarHeight, Math.round((Math.max(0, item.value) / safeMax) * barMaxHeight))
            const fill = item.color ?? getToneGradient(tone)

            return React.createElement('div', {
                key: `mini-bar-${index}-${String(item.label)}`,
                style: {
                    display: 'flex',
                    flexDirection: 'column' as const,
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 5,
                    height: '100%',
                    minWidth: barWidth,
                }
            },
                ...compactChildren([
                showValues && React.createElement('div', {
                    style: {
                        color: getToneColor(tone, c),
                        fontFamily: 'JetBrains Mono',
                        fontSize,
                        fontWeight: 800,
                        lineHeight: 1,
                    }
                }, item.valueLabel ?? item.value),
                React.createElement('div', {
                    style: {
                        display: 'flex',
                        width: barWidth,
                        height: barHeight,
                        borderRadius: `${radius}px ${radius}px 4px 4px`,
                        ...(fill.startsWith('linear-gradient')
                            ? { backgroundImage: fill }
                            : { backgroundColor: fill }),
                        opacity: item.opacity ?? 0.92,
                    }
                }),
                React.createElement('div', {
                    style: {
                        color: c.textMuted,
                        fontFamily: 'JetBrains Mono',
                        fontSize,
                        fontWeight: 700,
                        lineHeight: 1,
                        minHeight: fontSize + 2,
                    }
                }, item.label),
                ])
            )
        }),
    )
}

// ─── DetailList — Repeated small rows inside cards and panels ───────────────

interface DetailListProps {
    items: React.ReactNode[]
    c: ThemeColors
    tone?: ToneName
    gap?: number
    padding?: number | string
    fontSize?: number
    mono?: boolean
    math?: boolean
}

export function DetailList({
    items,
    c,
    tone,
    gap = 7,
    padding = '7px 8px',
    fontSize = 10,
    mono = false,
    math = false,
}: DetailListProps): React.ReactElement {
    const accent = tone ? getToneColor(tone, c) : c.borderSubtle

    return Column({
        gap,
        align: 'stretch',
        children: items.map((item, index) => React.createElement('div', {
            key: `detail-${index}`,
            style: {
                padding,
                borderRadius: 8,
                backgroundColor: c.bgSubtle,
                border: `1px solid ${tone ? `${accent}44` : c.borderSubtle}`,
                color: c.textSecondary,
                fontSize,
                lineHeight: 1.3,
                fontFamily: mono ? 'JetBrains Mono' : 'Inter',
            }
        }, renderMaybeMath(item, math)))
    })
}

// ─── Tile / TileGrid — Uniform mini-cards built from a data array ───────────

export interface TileSpec {
    title: React.ReactNode
    subtitle?: React.ReactNode
    eyebrow?: React.ReactNode
    icon?: React.ReactNode
    tone?: ToneName
    lines?: React.ReactNode[]
    children?: React.ReactNode
    width?: number | string
    minHeight?: number | string
}

interface TileProps extends TileSpec {
    c: ThemeColors
    align?: 'left' | 'center'
    padding?: number | string
    radius?: number
    shadow?: boolean
    math?: boolean
}

export function Tile({
    title,
    subtitle,
    eyebrow,
    icon,
    tone = 'blue',
    lines,
    children,
    width,
    minHeight = 84,
    c,
    align = 'center',
    padding = '14px 16px',
    radius = 10,
    shadow = true,
    math = false,
}: TileProps): React.ReactElement {
    const accent = getToneColor(tone, c)
    const textAlign = align
    const crossAlign = align === 'center' ? 'center' : 'flex-start'

    const detailLines = (lines ?? []).map((line, index) => React.createElement('div', {
        key: `tile-line-${index}`,
        style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: align === 'center' ? 'center' : 'flex-start',
            gap: 6,
            ...typography.tiny,
            color: c.textSecondary,
            lineHeight: 1.3,
            textAlign,
        }
    },
        React.createElement('span', {
            style: {
                display: 'flex',
                width: 4,
                height: 4,
                borderRadius: 999,
                backgroundColor: accent,
                flexShrink: 0,
            }
        }),
        renderMaybeMath(line, math),
    ))

    return Card({
        c,
        width,
        minHeight,
        padding,
        radius,
        shadow,
        borderColor: `${accent}88`,
        children: React.createElement('div', {
            style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column' as const,
                justifyContent: 'center',
                alignItems: crossAlign,
                gap: 5,
            }
        },
            ...compactChildren([
            icon != null && React.createElement('div', {
                style: { display: 'flex', fontSize: 22, lineHeight: 1 }
            }, icon),
            eyebrow != null && React.createElement('div', {
                style: {
                    ...typography.tiny,
                    color: c.textMuted,
                    fontWeight: 800,
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.05em',
                    lineHeight: 1.2,
                    textAlign,
                }
            }, renderMaybeMath(eyebrow, math)),
            React.createElement('div', {
                style: {
                    ...typography.label,
                    color: accent,
                    fontWeight: 800,
                    lineHeight: 1.15,
                    textAlign,
                }
            }, renderMaybeMath(title, math)),
            subtitle != null && React.createElement('div', {
                style: {
                    ...typography.tiny,
                    color: c.textSecondary,
                    lineHeight: 1.3,
                    textAlign,
                }
            }, renderMaybeMath(subtitle, math)),
            detailLines.length > 0 && React.createElement('div', {
                style: {
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column' as const,
                    gap: 4,
                    marginTop: 2,
                }
            }, ...detailLines),
            children,
            ])
        ),
    })
}

interface TileGridProps {
    tiles: TileSpec[]
    c: ThemeColors
    columns?: number
    gap?: number
    tileWidth?: number | string
    minHeight?: number | string
    align?: 'left' | 'center'
    math?: boolean
}

export function TileGrid({
    tiles,
    c,
    columns,
    gap = 12,
    tileWidth,
    minHeight,
    align = 'center',
    math = false,
}: TileGridProps): React.ReactElement {
    const renderTile = (tile: TileSpec, index: number) => React.createElement(React.Fragment, { key: `tile-${index}` },
        Tile({
            ...tile,
            c,
            align,
            math,
            width: tile.width ?? tileWidth,
            minHeight: tile.minHeight ?? minHeight,
        })
    )

    if (!columns || columns >= tiles.length) {
        return Row({ gap, align: 'stretch', justify: 'center', wrap: true, children: tiles.map(renderTile) })
    }

    const rows: TileSpec[][] = []
    for (let i = 0; i < tiles.length; i += columns) {
        rows.push(tiles.slice(i, i + columns))
    }

    return Column({
        gap,
        align: 'stretch',
        children: rows.map((rowTiles, rowIndex) => React.createElement(React.Fragment, { key: `tile-row-${rowIndex}` },
            Row({ gap, align: 'stretch', justify: 'center', children: rowTiles.map((tile, colIndex) => renderTile(tile, rowIndex * columns + colIndex)) })
        )),
    })
}

// ─── CodeBlock — Monospace multi-line block for code, scratchpads, traces ──

export interface CodeLineSpec {
    text: React.ReactNode
    tone?: ToneName
    dim?: boolean
    prefix?: React.ReactNode
}

interface CodeBlockProps {
    lines: Array<React.ReactNode | CodeLineSpec>
    c: ThemeColors
    title?: React.ReactNode
    tone?: ToneName
    width?: number | string
    minWidth?: number | string
    fontSize?: number
    showLineNumbers?: boolean
    padding?: number | string
    radius?: number
    background?: string
    shadow?: boolean
    math?: boolean
}

function isCodeLineSpec(line: React.ReactNode | CodeLineSpec): line is CodeLineSpec {
    return typeof line === 'object' && line !== null && !React.isValidElement(line) && 'text' in line
}

export function CodeBlock({
    lines,
    c,
    title,
    tone,
    width,
    minWidth,
    fontSize = 12,
    showLineNumbers = false,
    padding = 14,
    radius = 10,
    background,
    shadow = false,
    math = false,
}: CodeBlockProps): React.ReactElement {
    const headerAccent = tone ? getToneColor(tone, c) : c.textMuted
    const numberWidth = String(lines.length).length * (fontSize * 0.62) + 8

    const lineElements = lines.map((line, index) => {
        const spec: CodeLineSpec = isCodeLineSpec(line) ? line : { text: line }
        const accent = spec.tone ? getToneColor(spec.tone, c) : undefined
        const textColor = spec.dim ? c.textMuted : (accent ?? c.textSecondary)

        return React.createElement('div', {
            key: `code-line-${index}`,
            style: {
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                width: '100%',
                padding: accent ? '3px 7px' : '1px 0',
                borderRadius: accent ? 5 : 0,
                ...(accent ? { backgroundColor: `${accent}1f` } : {}),
                boxSizing: 'border-box' as const,
            }
        },
            ...compactChildren([
            showLineNumbers && React.createElement('div', {
                style: {
                    display: 'flex',
                    width: numberWidth,
                    flexShrink: 0,
                    justifyContent: 'flex-end',
                    color: c.textMuted,
                    fontFamily: 'JetBrains Mono',
                    fontSize: fontSize - 1,
                    lineHeight: 1.5,
                    opacity: 0.7,
                }
            }, String(index + 1)),
            spec.prefix != null && React.createElement('div', {
                style: {
                    display: 'flex',
                    flexShrink: 0,
                    color: accent ?? c.textMuted,
                    fontFamily: 'JetBrains Mono',
                    fontWeight: 800,
                    fontSize,
                    lineHeight: 1.5,
                }
            }, spec.prefix),
            React.createElement('div', {
                style: {
                    display: 'flex',
                    flex: 1,
                    color: textColor,
                    fontFamily: 'JetBrains Mono',
                    fontWeight: accent ? 700 : 500,
                    fontSize,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap' as const,
                }
            }, math && typeof spec.text === 'string' ? formatMathText(spec.text) : spec.text),
            ])
        )
    })

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: 8,
            ...(width != null ? { width } : {}),
            ...(minWidth != null ? { minWidth } : {}),
            padding,
            borderRadius: radius,
            backgroundColor: background ?? c.bgSubtle,
            border: `1px solid ${tone ? `${headerAccent}44` : c.borderSubtle}`,
            boxSizing: 'border-box' as const,
            ...(shadow ? { boxShadow: `0 9px 24px ${c.shadow}` } : {}),
        }
    },
        ...compactChildren([
        title != null && React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                paddingBottom: 8,
                borderBottom: `1px solid ${c.borderSubtle}`,
                color: c.textSecondary,
                fontFamily: 'JetBrains Mono',
                fontSize: fontSize - 1,
                fontWeight: 800,
                letterSpacing: '0.02em',
            }
        },
            React.createElement('span', {
                style: {
                    display: 'flex',
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: headerAccent,
                    flexShrink: 0,
                }
            }),
            renderMaybeMath(title, math),
        ),
        React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                gap: 2,
                width: '100%',
            }
        }, ...lineElements),
        ])
    )
}

// ─── Comparison — Side-by-side tone-labelled panels with optional vs divider ─

export interface ComparisonSideSpec {
    title: React.ReactNode
    subtitle?: React.ReactNode
    eyebrow?: React.ReactNode
    tone?: ToneName
    lines?: React.ReactNode[]
    children?: React.ReactNode
    footer?: React.ReactNode
    width?: number | string
}

interface ComparisonProps {
    sides: ComparisonSideSpec[]
    c: ThemeColors
    divider?: React.ReactNode | boolean
    gap?: number
    sideWidth?: number | string
    minHeight?: number | string
    align?: FlexAlign
    math?: boolean
}

function renderComparisonDivider(divider: React.ReactNode | boolean, c: ThemeColors, key: React.Key): React.ReactElement {
    const label = divider === true ? 'vs' : divider
    return React.createElement('div', {
        key,
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'stretch',
            flexShrink: 0,
        }
    },
        React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 30,
                height: 30,
                padding: '0 8px',
                borderRadius: 999,
                backgroundColor: c.bgCard,
                border: `1px solid ${c.borderLight}`,
                color: c.textMuted,
                fontFamily: 'Inter',
                fontSize: 11,
                fontWeight: 900,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.06em',
                boxShadow: `0 4px 12px ${c.shadow}`,
            }
        }, label),
    )
}

export function Comparison({
    sides,
    c,
    divider = false,
    gap = 14,
    sideWidth,
    minHeight,
    align = 'stretch',
    math = false,
}: ComparisonProps): React.ReactElement {
    const children = sides.flatMap((side, index) => {
        const tone = side.tone ?? 'blue'
        const panel = React.createElement(React.Fragment, { key: `comparison-side-${index}` },
            Panel({
                c,
                tone,
                title: side.title,
                subtitle: side.subtitle,
                footer: side.footer,
                width: side.width ?? sideWidth,
                minHeight,
                bodyStyle: { gap: 8 },
                children: side.eyebrow != null
                    ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 8 } },
                        React.createElement('div', {
                            style: {
                                ...typography.tiny,
                                color: c.textMuted,
                                fontWeight: 800,
                                textTransform: 'uppercase' as const,
                                letterSpacing: '0.05em',
                            }
                        }, renderMaybeMath(side.eyebrow, math)),
                        side.children ?? DetailList({ items: side.lines ?? [], c, tone, math }),
                    )
                    : (side.children ?? DetailList({ items: side.lines ?? [], c, tone, math })),
            })
        )

        if (divider && index < sides.length - 1) {
            return [panel, renderComparisonDivider(divider, c, `comparison-divider-${index}`)]
        }
        return [panel]
    })

    return Row({ gap, align, justify: 'center', children })
}

// ─── KeyValueList — Label↔value spec rows ──────────────────────────────────

export interface KeyValueRow {
    key: React.ReactNode
    value: React.ReactNode
    tone?: ToneName
    valueMono?: boolean
}

interface KeyValueListProps {
    rows: KeyValueRow[]
    c: ThemeColors
    title?: React.ReactNode
    width?: number | string
    minWidth?: number | string
    keyWidth?: number | string
    gap?: number
    fontSize?: number
    divider?: boolean
    keyMono?: boolean
    math?: boolean
}

export function KeyValueList({
    rows,
    c,
    title,
    width,
    minWidth,
    keyWidth,
    gap = 0,
    fontSize = 11,
    divider = true,
    keyMono = false,
    math = false,
}: KeyValueListProps): React.ReactElement {
    const rowElements = rows.map((row, index) => {
        const accent = row.tone ? getToneColor(row.tone, c) : undefined
        const isLast = index === rows.length - 1
        const valueMono = row.valueMono ?? true

        return React.createElement('div', {
            key: `kv-row-${index}`,
            style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                width: '100%',
                padding: divider ? '7px 0' : '4px 0',
                ...(divider && !isLast ? { borderBottom: `1px solid ${c.borderSubtle}` } : {}),
                boxSizing: 'border-box' as const,
            }
        },
            React.createElement('div', {
                style: {
                    display: 'flex',
                    ...(keyWidth != null ? { width: keyWidth, flexShrink: 0 } : {}),
                    color: c.textSecondary,
                    fontFamily: keyMono ? 'JetBrains Mono' : 'Inter',
                    fontSize,
                    fontWeight: 600,
                    lineHeight: 1.3,
                }
            }, renderMaybeMath(row.key, math)),
            React.createElement('div', {
                style: {
                    display: 'flex',
                    flex: 1,
                    justifyContent: 'flex-end',
                    textAlign: 'right' as const,
                    color: accent ?? c.textPrimary,
                    fontFamily: valueMono ? 'JetBrains Mono' : 'Inter',
                    fontSize,
                    fontWeight: 800,
                    lineHeight: 1.3,
                }
            }, renderMaybeMath(row.value, math)),
        )
    })

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap,
            ...(width != null ? { width } : {}),
            ...(minWidth != null ? { minWidth } : {}),
        }
    },
        ...compactChildren([
        title != null && React.createElement('div', {
            style: {
                display: 'flex',
                ...typography.tiny,
                color: c.textMuted,
                fontWeight: 800,
                textTransform: 'uppercase' as const,
                letterSpacing: '0.05em',
                paddingBottom: 4,
            }
        }, renderMaybeMath(title, math)),
        ...rowElements,
        ])
    )
}

// ─── WindowFrame — Browser / terminal / app window chrome around content ────

interface WindowFrameProps {
    c: ThemeColors
    children?: React.ReactNode
    title?: React.ReactNode
    variant?: 'window' | 'browser' | 'terminal'
    tone?: ToneName
    dots?: boolean
    width?: number | string
    minWidth?: number | string
    height?: number | string
    minHeight?: number | string
    padding?: number | string
    radius?: number
    shadow?: boolean
    background?: string
    bodyStyle?: React.CSSProperties
}

export function WindowFrame({
    c,
    children,
    title,
    variant = 'window',
    tone = 'blue',
    dots = true,
    width,
    minWidth,
    height,
    minHeight,
    padding = 16,
    radius = 10,
    shadow = true,
    background,
    bodyStyle,
}: WindowFrameProps): React.ReactElement {
    const isTerminal = variant === 'terminal'
    const surface = background ?? (isTerminal ? c.bgSubtle : c.bgCard)
    const accent = getToneColor(tone, c)

    const trafficDot = (color: string, key: string) => React.createElement('span', {
        key,
        style: { display: 'flex', width: 10, height: 10, borderRadius: 999, backgroundColor: color }
    })

    const titleBar = React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '8px 12px',
            backgroundColor: isTerminal ? c.bg === 'transparent' ? c.bgHover : c.bgHover : c.bgSubtle,
            borderBottom: `1px solid ${c.borderSubtle}`,
            boxSizing: 'border-box' as const,
        }
    },
        ...compactChildren([
        dots && React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }
        },
            trafficDot(c.criticalLight, 'dot-r'),
            trafficDot(c.warningLight, 'dot-y'),
            trafficDot(c.positiveLight, 'dot-g'),
        ),
        title != null && (variant === 'browser'
            ? React.createElement('div', {
                style: {
                    display: 'flex',
                    flex: 1,
                    alignItems: 'center',
                    height: 22,
                    padding: '0 12px',
                    borderRadius: 999,
                    backgroundColor: c.bgCard,
                    border: `1px solid ${c.borderSubtle}`,
                    color: c.textSecondary,
                    fontFamily: 'JetBrains Mono',
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: 1,
                }
            }, title)
            : React.createElement('div', {
                style: {
                    display: 'flex',
                    flex: 1,
                    justifyContent: dots ? 'center' : 'flex-start',
                    color: isTerminal ? accent : c.textSecondary,
                    fontFamily: isTerminal ? 'JetBrains Mono' : 'Inter',
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1,
                }
            }, title)),
        dots && title != null && variant !== 'browser' && React.createElement('div', {
            style: { display: 'flex', width: 52, flexShrink: 0 }
        }, ''),
        ])
    )

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            ...(width != null ? { width } : {}),
            ...(minWidth != null ? { minWidth } : {}),
            ...(height != null ? { height } : {}),
            ...(minHeight != null ? { minHeight } : {}),
            borderRadius: radius,
            border: `1px solid ${c.borderSubtle}`,
            backgroundColor: surface,
            overflow: 'hidden' as const,
            boxSizing: 'border-box' as const,
            ...(shadow ? { boxShadow: `0 12px 30px ${c.shadow}` } : {}),
        }
    },
        titleBar,
        React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                width: '100%',
                padding,
                boxSizing: 'border-box' as const,
                ...(isTerminal ? { fontFamily: 'JetBrains Mono', color: c.textSecondary } : {}),
                ...bodyStyle,
            }
        }, children),
    )
}
