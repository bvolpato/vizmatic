import React from 'react'
import {
    type ThemeColors,
    type ToneName,
    getReadableToneColor,
    getToneColor,
    withColorAlpha,
    densityOf,
    typeOf,
    hasShadow,
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
    barHeight: barHeightProp,
    fontSize: fontSizeProp,
}: ProgressRowProps): React.ReactElement {
    const barHeight = barHeightProp ?? Math.max(3, densityOf(c).g(6))
    const fontSize = fontSizeProp ?? densityOf(c).f(11)
    const accent = muted ? c.textMuted : getToneColor(tone, c)
    const accentText = muted ? c.textMuted : getReadableToneColor(tone, c)
    const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)

    return React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            gap: densityOf(c).s(8),
            width: '100%',
        }
    },
        React.createElement('div', {
            style: {
                width: labelWidth,
                color: muted ? c.textMuted : c.textPrimary,
                fontSize,
                fontWeight: 400,
                lineHeight: 1,
            }
        }, label),
        React.createElement('div', {
            style: {
                display: 'flex',
                flex: 1,
                height: barHeight,
                borderRadius: 1,
                backgroundColor: c.borderSubtle,
                overflow: 'hidden',
            }
        },
            React.createElement('div', {
                style: {
                    width: `${pct}%`,
                    height: '100%',
                    backgroundColor: accent,
                    opacity: muted ? 0.62 : 1,
                }
            }),
        ),
        React.createElement('div', {
            style: {
                width: valueWidth,
                color: accentText,
                fontSize,
                fontWeight: 400,
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
    gap: gapProp,
    labelWidth,
    valueWidth,
    barHeight,
    fontSize,
}: ProgressListProps): React.ReactElement {
    const gap = gapProp ?? densityOf(c).s(8)
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
    minBarHeight = 3,
    height = 92,
    barWidth: barWidthProp,
    gap: gapProp,
    radius: radiusProp,
    fontSize: fontSizeProp,
    showValues = false,
}: MiniBarChartProps): React.ReactElement {
    const gap = gapProp ?? densityOf(c).s(10)
    const radius = radiusProp ?? densityOf(c).r(3)
    const fontSize = fontSizeProp ?? densityOf(c).type.micro
    const barWidth = barWidthProp ?? densityOf(c).f(20)
    // A non-positive explicit max would divide bar heights by zero and emit NaN geometry.
    const requestedMax = max != null && max > 0 ? max : undefined
    const safeMax = requestedMax ?? Math.max(1, ...data.map((item) => Math.max(0, item.value)))
    const barMaxHeight = Math.max(minBarHeight, height - (showValues ? 34 : 20))

    return React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            gap,
            height,
            width: '100%',
            padding: `${densityOf(c).s(0)}px ${densityOf(c).s(4)}px`,
            boxSizing: 'border-box' as const,
        }
    },
        ...data.map((item, index) => {
            const tone = item.tone ?? 'blue'
            const barHeight = Math.max(minBarHeight, Math.round((Math.max(0, item.value) / safeMax) * barMaxHeight))
            const fill = item.color ?? getToneColor(tone, c)

            return React.createElement('div', {
                key: `mini-bar-${index}-${String(item.label)}`,
                style: {
                    display: 'flex',
                    flexDirection: 'column' as const,
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: densityOf(c).s(5),
                    height: '100%',
                    minWidth: barWidth,
                }
            },
                ...compactChildren([
                showValues && React.createElement('div', {
                    style: {
                        display: 'flex',
                        color: getReadableToneColor(tone, c),
                        fontFamily: 'JetBrains Mono',
                        fontSize,
                        fontWeight: 600,
                        lineHeight: 1,
                    }
                }, item.valueLabel ?? item.value),
                React.createElement('div', {
                    style: {
                        display: 'flex',
                        width: barWidth,
                        height: barHeight,
                        borderRadius: `${radius}px ${radius}px 0 0`,
                        ...(fill.startsWith('linear-gradient')
                            ? { backgroundImage: fill }
                            : { backgroundColor: fill }),
                        opacity: item.opacity ?? 1,
                    }
                }),
                React.createElement('div', {
                    style: {
                        display: 'flex',
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
    gap: gapProp,
    padding: paddingProp,
    fontSize: fontSizeProp,
    mono = false,
    math = false,
}: DetailListProps): React.ReactElement {
    const gap = gapProp ?? densityOf(c).s(7)
    const padding = paddingProp ?? `${densityOf(c).s(7)}px ${densityOf(c).s(8)}px`
    const fontSize = fontSizeProp ?? densityOf(c).f(11)
    const accent = tone ? getToneColor(tone, c) : c.borderSubtle

    return Column({
        gap,
        align: 'stretch',
        children: items.map((item, index) => React.createElement('div', {
            key: `detail-${index}`,
            style: {
                display: 'flex',
                padding,
                ...(index === 0 ? {} : { borderTop: `1px solid ${tone ? withColorAlpha(accent, 0x33 / 0xff) : c.borderSubtle}` }),
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
    tone,
    lines,
    children,
    width,
    minHeight,
    c,
    align = 'left',
    padding: paddingProp,
    radius: radiusProp,
    shadow = false,
    math = false,
}: TileProps): React.ReactElement {
    const padding = paddingProp ?? `${densityOf(c).s(10)}px ${densityOf(c).s(12)}px`
    const radius = radiusProp ?? densityOf(c).r(8)
    const accent = getToneColor(tone ?? 'neutral', c)
    const textAlign = align
    const crossAlign = align === 'center' ? 'center' : 'flex-start'

    const detailLines = (lines ?? []).map((line, index) => React.createElement('div', {
        key: `tile-line-${index}`,
        style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: align === 'center' ? 'center' : 'flex-start',
            gap: densityOf(c).s(6),
            ...typeOf(c, 'tiny'),
            color: c.textSecondary,
            lineHeight: 1.3,
            textAlign,
        }
    },
        React.createElement('span', {
            style: {
                display: 'flex',
                width: 3,
                height: 3,
                borderRadius: 999,
                backgroundColor: tone ? accent : c.textMuted,
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
        borderColor: tone ? withColorAlpha(accent, 0.5) : c.border,
        children: React.createElement('div', {
            style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column' as const,
                justifyContent: 'center',
                alignItems: crossAlign,
                gap: densityOf(c).s(4),
            }
        },
            ...compactChildren([
            icon != null && React.createElement('div', {
                style: { display: 'flex', fontSize: densityOf(c).f(22), lineHeight: 1 }
            }, icon),
            eyebrow != null && React.createElement('div', {
                style: {
                    ...typeOf(c, 'tiny'),
                    color: tone ? getReadableToneColor(tone, c) : c.textMuted,
                    fontWeight: 400,
                    lineHeight: 1.2,
                    textAlign,
                }
            }, renderMaybeMath(eyebrow, math)),
            React.createElement('div', {
                style: {
                    ...typeOf(c, 'label'),
                    color: c.textPrimary,
                    fontWeight: 600,
                    lineHeight: 1.15,
                    textAlign,
                }
            }, renderMaybeMath(title, math)),
            subtitle != null && React.createElement('div', {
                style: {
                    ...typeOf(c, 'tiny'),
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
                    gap: densityOf(c).s(4),
                    marginTop: densityOf(c).s(2),
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
    gap: gapProp,
    tileWidth,
    minHeight,
    align = 'left',
    math = false,
}: TileGridProps): React.ReactElement {
    const gap = gapProp ?? densityOf(c).s(12)
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
        return Row({ gap, align: 'stretch', justify: 'start', wrap: true, children: tiles.map(renderTile) })
    }

    const rows: TileSpec[][] = []
    for (let i = 0; i < tiles.length; i += columns) {
        rows.push(tiles.slice(i, i + columns))
    }

    return Column({
        gap,
        align: 'stretch',
        children: rows.map((rowTiles, rowIndex) => React.createElement(React.Fragment, { key: `tile-row-${rowIndex}` },
            Row({ gap, align: 'stretch', justify: 'start', children: rowTiles.map((tile, colIndex) => renderTile(tile, rowIndex * columns + colIndex)) })
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
    fontSize: fontSizeProp,
    showLineNumbers = false,
    padding: paddingProp,
    radius: radiusProp,
    background,
    shadow = false,
    math = false,
}: CodeBlockProps): React.ReactElement {
    const fontSize = fontSizeProp ?? densityOf(c).f(12)
    const padding = paddingProp ?? densityOf(c).s(14)
    const radius = radiusProp ?? densityOf(c).r(10)
    const headerAccent = tone ? getToneColor(tone, c) : c.textMuted
    const numberWidth = String(lines.length).length * (fontSize * 0.62) + 8

    const lineElements = lines.map((line, index) => {
        const spec: CodeLineSpec = isCodeLineSpec(line) ? line : { text: line }
        const accent = spec.tone ? getToneColor(spec.tone, c) : undefined
        const accentText = spec.tone && accent ? getReadableToneColor(spec.tone, c, withColorAlpha(accent, 0x1f / 0xff), background ?? c.bgSubtle) : undefined
        const textColor = spec.dim ? c.textMuted : (accentText ?? c.textSecondary)

        return React.createElement('div', {
            key: `code-line-${index}`,
            style: {
                display: 'flex',
                alignItems: 'flex-start',
                gap: densityOf(c).s(8),
                width: '100%',
                padding: accent ? '3px 7px' : '1px 0',
                borderRadius: accent ? 5 : 0,
                ...(accent ? { backgroundColor: withColorAlpha(accent, 0x1f / 0xff) } : {}),
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
                    color: accent ? c.textSecondary : c.textMuted,
                    fontFamily: 'JetBrains Mono',
                    fontSize: fontSize - 1,
                    lineHeight: 1.5,
                }
            }, String(index + 1)),
            spec.prefix != null && React.createElement('div', {
                style: {
                    display: 'flex',
                    flexShrink: 0,
                    color: accentText ?? c.textMuted,
                    fontFamily: 'JetBrains Mono',
                    fontWeight: 600,
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
                    fontWeight: 400,
                    fontSize,
                    lineHeight: 1.45,
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
            gap: densityOf(c).s(8),
            ...(width != null ? { width } : {}),
            ...(minWidth != null ? { minWidth } : {}),
            padding,
            borderRadius: radius,
            backgroundColor: background ?? c.bgSubtle,
            border: `1px solid ${tone ? withColorAlpha(headerAccent, 0x44 / 0xff) : c.borderSubtle}`,
            boxSizing: 'border-box' as const,
            ...(shadow && hasShadow(c) ? { boxShadow: `0 9px 24px ${c.shadow}` } : {}),
        }
    },
        ...compactChildren([
        title != null && React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: densityOf(c).s(8),
                paddingBottom: densityOf(c).s(8),
                borderBottom: `1px solid ${c.borderSubtle}`,
                color: c.textSecondary,
                fontFamily: 'JetBrains Mono',
                fontSize: fontSize - 1,
                fontWeight: 400,
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
                gap: densityOf(c).s(2),
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
                minWidth: densityOf(c).f(26),
                height: densityOf(c).f(22),
                padding: `0 ${densityOf(c).s(6)}px`,
                borderRadius: 999,
                backgroundColor: c.bgCard,
                border: `1px solid ${c.borderLight}`,
                color: c.textMuted,
                fontFamily: 'Inter',
                fontSize: densityOf(c).type.micro,
                fontWeight: 400,
            }
        }, label),
    )
}

export function Comparison({
    sides,
    c,
    divider = false,
    gap: gapProp,
    sideWidth,
    minHeight,
    align = 'stretch',
    math = false,
}: ComparisonProps): React.ReactElement {
    const gap = gapProp ?? densityOf(c).s(14)
    const children = sides.flatMap((side, index) => {
        const tone = side.tone
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
                                ...typeOf(c, 'tiny'),
                                color: c.textMuted,
                                fontWeight: 400,
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
    gap: gapProp,
    fontSize: fontSizeProp,
    divider = true,
    keyMono = false,
    math = false,
}: KeyValueListProps): React.ReactElement {
    const gap = gapProp ?? densityOf(c).s(0)
    const fontSize = fontSizeProp ?? densityOf(c).type.small
    const rowElements = rows.map((row, index) => {
        const accent = row.tone ? getReadableToneColor(row.tone, c) : undefined
        const isLast = index === rows.length - 1
        const valueMono = row.valueMono ?? true

        return React.createElement('div', {
            key: `kv-row-${index}`,
            style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: densityOf(c).s(14),
                width: '100%',
                padding: `${divider ? densityOf(c).s(5) : densityOf(c).s(2)}px 0`,
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
                    fontWeight: 400,
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
                    fontWeight: 400,
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
                ...typeOf(c, 'small'),
                color: c.textPrimary,
                fontWeight: 600,
                paddingBottom: densityOf(c).s(4),
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
    padding: paddingProp,
    radius: radiusProp,
    shadow = false,
    background,
    bodyStyle,
}: WindowFrameProps): React.ReactElement {
    const padding = paddingProp ?? densityOf(c).s(16)
    const radius = radiusProp ?? densityOf(c).r(10)
    const isTerminal = variant === 'terminal'
    const surface = background ?? (isTerminal ? c.bgSubtle : c.bgCard)
    const titleColor = isTerminal ? getReadableToneColor(tone, c, c.bgHover) : c.textSecondary

    const trafficDot = (color: string, key: string) => React.createElement('span', {
        key,
        style: { display: 'flex', width: densityOf(c).g(9), height: densityOf(c).g(9), borderRadius: 999, backgroundColor: color }
    })

    const titleBar = React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            gap: densityOf(c).s(10),
            width: '100%',
            padding: `${densityOf(c).s(8)}px ${densityOf(c).s(12)}px`,
            backgroundColor: isTerminal ? c.bg === 'transparent' ? c.bgHover : c.bgHover : c.bgSubtle,
            borderBottom: `1px solid ${c.borderSubtle}`,
            boxSizing: 'border-box' as const,
        }
    },
        ...compactChildren([
        dots && React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: densityOf(c).s(6), flexShrink: 0 }
        },
            trafficDot(c.borderLight, 'dot-r'),
            trafficDot(c.borderLight, 'dot-y'),
            trafficDot(c.borderLight, 'dot-g'),
        ),
        title != null && (variant === 'browser'
            ? React.createElement('div', {
                style: {
                    display: 'flex',
                    flex: 1,
                    alignItems: 'center',
                    height: densityOf(c).f(22),
                    padding: `0 ${densityOf(c).s(12)}px`,
                    borderRadius: densityOf(c).r(6),
                    backgroundColor: c.bgCard,
                    border: `1px solid ${c.borderSubtle}`,
                    color: c.textSecondary,
                    fontFamily: 'JetBrains Mono',
                    fontSize: densityOf(c).f(11),
                    fontWeight: 600,
                    lineHeight: 1,
                }
            }, title)
            : React.createElement('div', {
                style: {
                    display: 'flex',
                    flex: 1,
                    justifyContent: dots ? 'center' : 'flex-start',
                    color: titleColor,
                    fontFamily: isTerminal ? 'JetBrains Mono' : 'Inter',
                    fontSize: densityOf(c).type.small,
                    fontWeight: 400,
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
            ...(shadow && hasShadow(c) ? { boxShadow: `0 12px 30px ${c.shadow}` } : {}),
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
