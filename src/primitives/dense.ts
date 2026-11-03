import React from 'react'
import { densityOf, getReadableToneColor, getToneColor, withColorAlpha, type ThemeColors, type ToneName } from '../theme'
import { compactChildren } from './layout'

// ─── Text measurement ───────────────────────────────────────────────────────

// Inter's advance widths for printable ASCII, in thousandths of an em. Knowing the
// real widths lets boxes fit their words before any font has loaded.
const INTER_REGULAR = [281, 288, 466, 633, 642, 982, 644, 300, 365, 365, 501, 662, 288, 460, 288, 360, 631, 407, 610, 618, 646, 593, 620, 566, 619, 620, 288, 302, 662, 662, 662, 511, 966, 690, 654, 730, 722, 601, 590, 746, 743, 269, 571, 672, 565, 903, 753, 765, 639, 765, 644, 642, 646, 744, 690, 985, 682, 679, 629, 365, 360, 365, 471, 456, 323, 562, 612, 571, 612, 583, 370, 613, 591, 242, 242, 549, 242, 876, 591, 600, 612, 612, 376, 528, 327, 591, 562, 818, 546, 562, 552, 426, 333, 426, 662]
const INTER_SEMIBOLD = [252, 321, 523, 644, 650, 1004, 663, 326, 373, 373, 540, 673, 319, 465, 319, 379, 660, 423, 623, 636, 666, 612, 640, 576, 640, 640, 319, 329, 673, 673, 673, 543, 999, 728, 659, 737, 722, 605, 588, 749, 746, 277, 580, 703, 565, 922, 759, 769, 645, 773, 652, 650, 660, 736, 728, 1020, 720, 713, 652, 373, 379, 373, 481, 469, 351, 574, 624, 583, 624, 591, 389, 625, 612, 262, 262, 569, 262, 900, 612, 609, 624, 624, 397, 549, 353, 612, 587, 839, 569, 588, 566, 455, 359, 455, 673]

/** Width of a line of text in pixels, to size boxes before layout runs. */
export function estimateTextWidth(text: string, fontSize: number, options: { mono?: boolean; weight?: number } = {}): number {
    if (options.mono) return Array.from(text).length * fontSize * 0.6
    const table = (options.weight ?? 400) >= 600 ? INTER_SEMIBOLD : INTER_REGULAR
    let units = 0
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0
        if (code >= 32 && code < 127) units += table[code - 32]!
        else units += code > 0x2e80 ? 1000 : 600
    }
    return (units / 1000) * fontSize
}

// ─── StatusDot ──────────────────────────────────────────────────────────────

export type DiagramStatus = 'ok' | 'warn' | 'error' | 'idle' | ToneName

export function statusColor(status: DiagramStatus, c: ThemeColors): string {
    if (status === 'ok') return c.positiveLight
    if (status === 'warn') return c.warningLight
    if (status === 'error') return c.criticalLight
    if (status === 'idle') return c.textMuted
    return getToneColor(status, c)
}

export function StatusDot({ status = 'ok', c, size }: { status?: DiagramStatus; c: ThemeColors; size?: number }): React.ReactElement {
    const resolved = size ?? densityOf(c).f(8)
    return React.createElement('div', {
        style: {
            display: 'flex',
            flexShrink: 0,
            width: resolved,
            height: resolved,
            borderRadius: 999,
            backgroundColor: statusColor(status, c),
        },
    })
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

interface SparklineProps {
    values: readonly number[]
    c: ThemeColors
    width?: number
    height?: number
    tone?: ToneName
    color?: string
    /** Fill under the line. */
    area?: boolean
    /** Mark the final value. */
    endDot?: boolean
    min?: number
    max?: number
    strokeWidth?: number
}

/** A word-sized line chart for putting a trend next to a number. */
export function Sparkline({
    values, c, width, height, tone, color, area = false, endDot = true, min, max, strokeWidth,
}: SparklineProps): React.ReactElement {
    const d = densityOf(c)
    const w = width ?? d.f(72)
    const h = height ?? d.f(18)
    const stroke = color ?? (tone ? getToneColor(tone, c) : c.textSecondary)
    const line = strokeWidth ?? d.w(1.5)
    const finite = values.filter(Number.isFinite)
    const low = min ?? Math.min(...finite), high = max ?? Math.max(...finite)
    const range = high - low || 1
    const inset = endDot ? d.g(3) : line
    const x = (index: number) => inset + (values.length <= 1 ? 0 : (index / (values.length - 1)) * (w - inset * 2))
    const y = (value: number) => inset + (1 - (value - low) / range) * (h - inset * 2)
    const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`).join(' ')
    const last = values.length - 1
    return React.createElement('svg', {
        width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true', style: { display: 'flex', flexShrink: 0 },
    },
        ...compactChildren([
            area && values.length > 1 && React.createElement('path', {
                key: 'area',
                d: `${path} L ${x(last).toFixed(2)} ${h} L ${x(0).toFixed(2)} ${h} Z`,
                fill: withColorAlpha(stroke, 0.14),
            }),
            React.createElement('path', {
                key: 'line', d: path, fill: 'none', stroke, strokeWidth: line, strokeLinecap: 'round', strokeLinejoin: 'round',
            }),
            endDot && values.length > 0 && React.createElement('circle', {
                key: 'dot', cx: x(last), cy: y(values[last]!), r: d.g(2.25), fill: stroke,
            }),
        ]),
    )
}

// ─── InlineBar ──────────────────────────────────────────────────────────────

interface InlineBarProps {
    value: number
    c: ThemeColors
    width?: number | string
    height?: number
    tone?: ToneName
    color?: string
    /** Past this fraction the bar turns to the warning color, for capacity. */
    warnAt?: number
}

/** A hairline capacity bar that sits under a value. */
export function InlineBar({ value, c, width = '100%', height, tone, color, warnAt }: InlineBarProps): React.ReactElement {
    const d = densityOf(c)
    const fraction = Math.max(0, Math.min(1, value))
    const fill = color ?? (warnAt != null && fraction >= warnAt ? c.warningLight : tone ? getToneColor(tone, c) : c.textSecondary)
    return React.createElement('div', {
        style: {
            display: 'flex',
            width,
            height: height ?? Math.max(2, d.g(3)),
            borderRadius: 1,
            backgroundColor: c.borderSubtle,
            overflow: 'hidden',
        },
    }, React.createElement('div', {
        style: { display: 'flex', width: `${Math.round(fraction * 1000) / 10}%`, height: '100%', backgroundColor: fill },
    }))
}

// ─── FactRows ───────────────────────────────────────────────────────────────

export interface FactRow {
    key: React.ReactNode
    value: React.ReactNode
    tone?: ToneName
    /** Draw a small capacity bar under the row. */
    bar?: number
}

interface FactRowsProps {
    rows: readonly FactRow[]
    c: ThemeColors
    width?: number | string
    fontSize?: number
    /** Set values in monospace, so columns of numbers line up. */
    mono?: boolean
    gap?: number
}

/** Tight rows of key and value, the workhorse of an information-dense node. */
export function FactRows({ rows, c, width = '100%', fontSize, mono = true, gap }: FactRowsProps): React.ReactElement {
    const d = densityOf(c)
    const size = fontSize ?? d.type.micro
    return React.createElement('div', {
        style: { display: 'flex', flexDirection: 'column' as const, width, gap: gap ?? d.s(2) },
    }, ...rows.map((row, index) => React.createElement('div', {
        key: `fact-${index}`,
        style: { display: 'flex', flexDirection: 'column' as const, width: '100%', gap: 1 },
    },
        React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', width: '100%', gap: d.s(8), lineHeight: 1.25 },
        },
            React.createElement('div', {
                style: { display: 'flex', flexShrink: 0, color: c.textMuted, fontFamily: c.fontSans, fontSize: size },
            }, row.key),
            React.createElement('div', {
                style: {
                    display: 'flex',
                    color: row.tone ? getReadableToneColor(row.tone, c) : c.textPrimary,
                    fontFamily: mono ? c.fontMono : c.fontSans,
                    fontSize: size,
                    textAlign: 'right' as const,
                },
            }, row.value),
        ),
        ...compactChildren([row.bar != null && InlineBar({ value: row.bar, c, tone: row.tone, warnAt: 0.85 })]),
    )))
}

// ─── MetricStrip ────────────────────────────────────────────────────────────

export interface StripMetric {
    label: React.ReactNode
    value: React.ReactNode
    unit?: React.ReactNode
    tone?: ToneName
    spark?: readonly number[]
    bar?: number
}

interface MetricStripProps {
    metrics: readonly StripMetric[]
    c: ThemeColors
    width?: number | string
    /** Lay out in a row with even columns, or stack. */
    direction?: 'row' | 'column'
    sparkWidth?: number
}

/** Numbers with their units, side by side without a card around each one. */
export function MetricStrip({ metrics, c, width = '100%', direction = 'row', sparkWidth }: MetricStripProps): React.ReactElement {
    const d = densityOf(c)
    return React.createElement('div', {
        style: { display: 'flex', flexDirection: direction, width, gap: direction === 'row' ? d.s(14) : d.s(6) },
    }, ...metrics.map((metric, index) => React.createElement('div', {
        key: `metric-${index}`,
        style: { display: 'flex', flexDirection: 'column' as const, flex: direction === 'row' ? 1 : undefined, minWidth: 0, gap: d.s(1) },
    },
        React.createElement('div', {
            style: { display: 'flex', alignItems: 'baseline', gap: d.s(2), lineHeight: 1.1 },
        },
            React.createElement('div', {
                style: {
                    display: 'flex',
                    color: metric.tone ? getReadableToneColor(metric.tone, c) : c.textPrimary,
                    fontFamily: c.fontMono,
                    fontSize: d.f(14),
                },
            }, metric.value),
            ...compactChildren([metric.unit != null && React.createElement('div', {
                key: 'unit',
                style: { display: 'flex', color: c.textMuted, fontFamily: c.fontSans, fontSize: d.type.micro },
            }, metric.unit)]),
        ),
        React.createElement('div', {
            style: { display: 'flex', color: c.textMuted, fontFamily: c.fontSans, fontSize: d.type.micro, lineHeight: 1.2 },
        }, metric.label),
        ...compactChildren([
            metric.spark && Sparkline({ values: metric.spark, c, tone: metric.tone, width: sparkWidth ?? d.f(56), height: d.f(14) }),
            metric.bar != null && InlineBar({ value: metric.bar, c, tone: metric.tone, warnAt: 0.85 }),
        ]),
    )))
}

// ─── TagList ────────────────────────────────────────────────────────────────

/** Small hairline tags: region, version, owner, runtime. */
export function TagList({ tags, c, tone }: { tags: readonly React.ReactNode[]; c: ThemeColors; tone?: ToneName }): React.ReactElement {
    const d = densityOf(c)
    return React.createElement('div', {
        style: { display: 'flex', flexWrap: 'wrap' as const, gap: d.s(3) },
    }, ...tags.map((tag, index) => React.createElement('div', {
        key: `tag-${index}`,
        style: {
            display: 'flex',
            padding: `${Math.max(1, d.s(1.5))}px ${d.s(5)}px`,
            border: `1px solid ${tone ? withColorAlpha(getToneColor(tone, c), 0.5) : c.border}`,
            borderRadius: d.r(4),
            color: tone ? getReadableToneColor(tone, c) : c.textSecondary,
            fontFamily: c.fontSans,
            fontSize: d.type.micro,
            lineHeight: 1.1,
            whiteSpace: 'nowrap' as const,
        },
    }, tag)))
}

// ─── DiagramLegend ──────────────────────────────────────────────────────────

export interface DiagramLegendItem {
    label: React.ReactNode
    tone?: ToneName
    color?: string
    /** Show a line sample in a stroke style, or a filled swatch. */
    style?: 'solid' | 'dashed' | 'dotted' | 'swatch' | 'dot'
}

/** A one-line key. It sits in a corner and takes no more room than it needs. */
export function DiagramLegend({ items, c, title, width }: { items: readonly DiagramLegendItem[]; c: ThemeColors; title?: React.ReactNode; width?: number | string }): React.ReactElement {
    const d = densityOf(c)
    const sample = d.f(18)
    return React.createElement('div', {
        style: {
            display: 'flex', flexWrap: 'wrap' as const, alignItems: 'center', gap: `${d.s(3)}px ${d.s(12)}px`,
            ...(width != null ? { width } : {}),
            color: c.textSecondary, fontFamily: c.fontSans, fontSize: d.type.micro, lineHeight: 1.2,
        },
    },
        ...compactChildren([
            title != null && React.createElement('div', { key: 'title', style: { display: 'flex', color: c.textMuted } }, title),
            ...items.map((item, index) => {
                const color = item.color ?? (item.tone ? getToneColor(item.tone, c) : c.textSecondary)
                const style = item.style ?? 'solid'
                const mark = style === 'swatch' || style === 'dot'
                    ? React.createElement('div', {
                        style: {
                            display: 'flex', width: d.g(8), height: d.g(8), flexShrink: 0,
                            borderRadius: style === 'dot' ? 999 : 2, backgroundColor: color,
                        },
                    })
                    : React.createElement('svg', {
                        width: sample, height: d.g(8), viewBox: `0 0 ${sample} ${d.g(8)}`, style: { display: 'flex', flexShrink: 0 },
                    }, React.createElement('line', {
                        x1: 0, x2: sample, y1: d.g(4), y2: d.g(4), stroke: color, strokeWidth: d.w(2),
                        strokeDasharray: style === 'dashed' ? '5 3' : style === 'dotted' ? '1.5 3' : undefined,
                        strokeLinecap: style === 'dotted' ? 'round' : 'butt',
                    }))
                return React.createElement('div', {
                    key: `legend-${index}`,
                    style: { display: 'flex', alignItems: 'center', gap: d.s(5) },
                }, mark, React.createElement('div', { style: { display: 'flex' } }, item.label))
            }),
        ]),
    )
}

// ─── SmallMultiples ─────────────────────────────────────────────────────────

export interface SmallMultipleItem {
    label: React.ReactNode
    values: readonly number[]
    /** Current reading, shown at the top right of its cell. */
    value?: React.ReactNode
    unit?: React.ReactNode
    tone?: ToneName
    status?: DiagramStatus
    /** A baseline such as a target or SLO, drawn across the cell. */
    reference?: number
}

interface SmallMultiplesProps {
    items: readonly SmallMultipleItem[]
    c: ThemeColors
    columns?: number
    cellWidth?: number
    cellHeight?: number
    /** Give all cells one y scale, so they compare directly. */
    sharedScale?: boolean
    area?: boolean
}

/**
 * The same chart repeated with one dimension changing. A dozen of these on a
 * page show more than one chart with a dozen lines on it.
 */
export function SmallMultiples({ items, c, columns, cellWidth, cellHeight, sharedScale = false, area = true }: SmallMultiplesProps): React.ReactElement {
    const d = densityOf(c)
    const width = cellWidth ?? d.f(118)
    const height = cellHeight ?? d.f(30)
    const perRow = columns ?? Math.min(items.length, 6)
    const all = items.flatMap((item) => [...item.values, ...(item.reference != null ? [item.reference] : [])])
    const sharedMin = sharedScale ? Math.min(...all) : undefined
    const sharedMax = sharedScale ? Math.max(...all) : undefined
    const rows: SmallMultipleItem[][] = []
    for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow) as SmallMultipleItem[])

    return React.createElement('div', {
        style: { display: 'flex', flexDirection: 'column' as const, gap: d.s(10) },
    }, ...rows.map((row, rowIndex) => React.createElement('div', {
        key: `multiples-row-${rowIndex}`,
        style: { display: 'flex', gap: d.s(16) },
    }, ...row.map((item, index) => {
        const low = sharedMin ?? Math.min(...item.values, ...(item.reference != null ? [item.reference] : []))
        const high = sharedMax ?? Math.max(...item.values, ...(item.reference != null ? [item.reference] : []))
        const range = high - low || 1
        const referenceY = item.reference != null ? d.g(3) + (1 - (item.reference - low) / range) * (height - d.g(6)) : undefined
        return React.createElement('div', {
            key: `multiple-${index}`,
            style: { display: 'flex', flexDirection: 'column' as const, width, gap: d.s(2) },
        },
            React.createElement('div', {
                style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: d.s(6), lineHeight: 1.2 },
            },
                React.createElement('div', {
                    style: { display: 'flex', alignItems: 'center', gap: d.s(4), minWidth: 0, color: c.textSecondary, fontFamily: c.fontSans, fontSize: d.type.micro, whiteSpace: 'nowrap' as const, overflow: 'hidden' },
                }, ...compactChildren([item.status && React.createElement(React.Fragment, { key: 'dot' }, StatusDot({ status: item.status, c, size: d.g(6) })), item.label])),
                item.value != null && React.createElement('div', {
                    style: { display: 'flex', flexShrink: 0, alignItems: 'baseline', gap: d.s(2), color: item.tone ? getReadableToneColor(item.tone, c) : c.textPrimary, fontFamily: c.fontMono, fontSize: d.type.small },
                }, ...compactChildren([item.value, item.unit != null && React.createElement('span', { key: 'unit', style: { display: 'flex', color: c.textMuted, fontFamily: c.fontSans, fontSize: d.type.micro } }, item.unit)])),
            ),
            React.createElement('div', {
                style: { display: 'flex', position: 'relative' as const, width, height, borderBottom: `1px solid ${c.borderSubtle}` },
            },
                ...compactChildren([
                    referenceY != null && React.createElement('svg', {
                        key: 'reference',
                        width, height, viewBox: `0 0 ${width} ${height}`,
                        style: { position: 'absolute' as const, left: 0, top: 0 },
                    }, React.createElement('line', { x1: 0, x2: width, y1: referenceY, y2: referenceY, stroke: c.borderLight, strokeWidth: d.stroke.hair, strokeDasharray: `${d.s(4)} ${d.s(4)}` })),
                    Sparkline({ values: item.values, c, tone: item.tone, width, height, area, min: low, max: high }),
                ]),
            ),
        )
    }))))
}
