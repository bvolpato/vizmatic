import React from 'react'
import {
    type ThemeColors,
    type ToneName,
    getReadableToneColor,
    getToneColor,
    getToneFill,
    getToneGradient,
    withColorAlpha,
    densityOf,
    typeOf,
    hasShadow,
} from '../theme'

import {
    compactChildren,
    flexAlign,
    type FlexAlign,
    flexJustify,
    type FlexJustify,
    formatMathText,
    textFitStyle,
    ToneStrip,
} from './layout'

// ─── Stack — Vertical/horizontal group ──────────────────────────────────────

interface StackProps {
    direction?: 'vertical' | 'horizontal'
    gap?: number
    align?: 'start' | 'center' | 'end' | 'stretch'
    wrap?: boolean
    children: React.ReactNode
}

export function Stack({
    direction = 'vertical',
    gap: gapProp,
    align = 'center',
    wrap = false,
    children,
}: StackProps): React.ReactElement {
    const gap = gapProp ?? densityOf().s(12)
    const alignMap = {
        start: 'flex-start',
        center: 'center',
        end: 'flex-end',
        stretch: 'stretch',
    }

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: direction === 'vertical' ? 'column' as const : 'row' as const,
            alignItems: alignMap[align],
            gap,
            ...(wrap ? { flexWrap: 'wrap' as const } : {}),
        }
    }, children)
}

// ─── Card — Bordered container ──────────────────────────────────────────────

interface CardProps {
    children?: React.ReactNode
    c: ThemeColors
    title?: React.ReactNode
    subtitle?: React.ReactNode
    tone?: ToneName
    footer?: React.ReactNode
    width?: number | string
    minWidth?: number | string
    height?: number | string
    minHeight?: number | string
    padding?: number | string
    radius?: number
    gap?: number
    align?: FlexAlign
    justify?: FlexJustify
    shadow?: boolean
    background?: string
    borderColor?: string
    bodyStyle?: React.CSSProperties
}

export function Card({
    children,
    c,
    title,
    subtitle,
    tone,
    footer,
    width,
    minWidth,
    height,
    minHeight,
    padding: paddingProp,
    radius: radiusProp,
    gap,
    align = 'stretch',
    justify = 'start',
    shadow = false,
    background,
    borderColor,
    bodyStyle,
}: CardProps): React.ReactElement {
    const padding = paddingProp ?? densityOf(c).s(20)
    const radius = radiusProp ?? densityOf(c).r(8)
    const hasHeader = title || subtitle || tone
    const engineering = c.preset === 'engineering'

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: flexAlign(align),
            justifyContent: flexJustify(justify),
            gap: gap ?? (hasHeader || footer ? 10 : 0),
            backgroundColor: background ?? c.bgCard,
            borderRadius: engineering ? Math.min(radius, 5) : radius,
            border: `1px solid ${borderColor ?? c.borderSubtle}`,
            padding,
            ...(width !== undefined ? { width } : {}),
            ...(minWidth !== undefined ? { minWidth } : {}),
            ...(height !== undefined ? { height } : {}),
            ...(minHeight !== undefined ? { minHeight } : {}),
            ...(shadow && !engineering && hasShadow(c) ? { boxShadow: `0 9px 24px ${c.shadow}` } : {}),
        }
    },
        ...compactChildren([
        hasHeader && React.createElement('div', {
            style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column' as const,
                gap: densityOf(c).s(subtitle ? 5 : 0),
            }
        },
            ...compactChildren([
            (title || tone) && React.createElement('div', {
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: densityOf(c).s(8),
                    color: c.textPrimary,
                    ...typeOf(c, 'small'),
                    fontFamily: c.fontSans,
                    ...textFitStyle(),
                    fontWeight: 600,
                    lineHeight: 1.2,
                }
            },
                ...compactChildren([tone && ToneStrip({ tone }), title]),
            ),
            subtitle && React.createElement('div', {
                style: {
                    display: 'flex',
                    color: c.textSecondary,
                    ...typeOf(c, 'tiny'),
                    fontFamily: c.fontSans,
                    ...textFitStyle(),
                    lineHeight: 1.35,
                }
            }, subtitle),
            ])
        ),
        React.createElement('div', {
            style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column' as const,
                ...bodyStyle,
            }
        }, children),
        footer && React.createElement('div', {
            style: {
                width: '100%',
                display: 'flex',
                color: c.textMuted,
                ...typeOf(c, 'tiny'),
                fontFamily: c.fontSans,
                ...textFitStyle(),
            }
        }, footer),
        ])
    )
}

export function renderMaybeMath(node: React.ReactNode, math: boolean): React.ReactNode {
    return math && typeof node === 'string' ? formatMathText(node) : node
}

// ─── ValuePill — Compact parameter/value card for math flows ───────────────

interface ValuePillProps {
    label: React.ReactNode
    value: React.ReactNode
    c: ThemeColors
    tone?: ToneName
    detail?: React.ReactNode
    width?: number | string
    math?: boolean
}

export function ValuePill({
    label,
    value,
    c,
    tone,
    detail,
    width,
    math = false,
}: ValuePillProps): React.ReactElement {
    const d = densityOf(c)
    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: d.s(3),
            ...(width != null ? { width } : {}),
            padding: `${d.s(8)}px ${d.s(11)}px`,
            borderRadius: d.r(8),
            border: `1px solid ${tone ? withColorAlpha(getToneColor(tone, c), 0.5) : c.border}`,
            backgroundColor: c.bgCard,
        },
    },
        React.createElement('div', {
            style: { display: 'flex', color: c.textMuted, fontFamily: c.fontSans, fontSize: d.type.micro, lineHeight: 1.2 },
        }, renderMaybeMath(label, math)),
        React.createElement('div', {
            style: {
                display: 'flex',
                color: tone ? getReadableToneColor(tone, c) : c.textPrimary,
                fontFamily: c.fontMono,
                fontSize: d.f(20),
                lineHeight: 1.05,
            },
        }, renderMaybeMath(value, math)),
        ...compactChildren([detail && React.createElement('div', {
            style: { display: 'flex', color: c.textSecondary, fontFamily: c.fontSans, fontSize: d.type.micro, lineHeight: 1.3 },
        }, renderMaybeMath(detail, math))]),
    )
}

// ─── EquationCard — Reusable step card for calculation flows ───────────────

interface EquationCardProps {
    title: React.ReactNode
    formula: React.ReactNode
    c: ThemeColors
    tone?: ToneName
    result?: React.ReactNode
    detail?: React.ReactNode
    width?: number | string
    height?: number | string
    math?: boolean
    align?: 'left' | 'center'
}

export function EquationCard({
    title,
    formula,
    c,
    tone,
    result,
    detail,
    width,
    height,
    math = false,
    align = 'left',
}: EquationCardProps): React.ReactElement {
    const accent = tone ? getReadableToneColor(tone, c) : c.textPrimary
    const textAlign = align

    return Card({
        c,
        tone,
        width,
        height,
        padding: densityOf(c).s(16),
        radius: 10,
        shadow: true,
        title,
        children: React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                gap: densityOf(c).s(8),
                alignItems: align === 'center' ? 'center' : 'flex-start',
            }
        },
            React.createElement('div', {
                style: {
                    color: c.textPrimary,
                    fontFamily: c.fontMono,
                    fontSize: densityOf(c).f(15),
                    fontWeight: 600,
                    lineHeight: 1.3,
                    textAlign,
                }
            }, renderMaybeMath(formula, math)),
            result && React.createElement('div', {
                style: {
                    color: accent,
                    fontFamily: c.fontMono,
                    fontSize: densityOf(c).f(28),
                    fontWeight: 600,
                    lineHeight: 1,
                    textAlign,
                }
            }, renderMaybeMath(result, math)),
            detail && React.createElement('div', {
                style: {
                    color: c.textSecondary,
                    ...typeOf(c, 'tiny'),
                    lineHeight: 1.35,
                    textAlign,
                }
            }, renderMaybeMath(detail, math)),
        ),
    })
}

// ─── BadgePill — Compact label pill for tokens, stages, and states ──────────

interface BadgePillProps {
    text: React.ReactNode
    c: ThemeColors
    tone?: ToneName
    width?: number | string
    minWidth?: number | string
    height?: number | string
    padding?: number | string
    radius?: number
    fontSize?: number
    mono?: boolean
    filled?: boolean
    math?: boolean
}

export function BadgePill({
    text,
    c,
    tone = 'neutral',
    width,
    minWidth,
    height,
    padding: paddingProp,
    radius: radiusProp,
    fontSize: fontSizeProp,
    mono = false,
    filled = false,
    math = false,
}: BadgePillProps): React.ReactElement {
    const padding = paddingProp ?? `${densityOf(c).s(0)}px ${densityOf(c).s(8)}px`
    const radius = radiusProp ?? densityOf(c).r(6)
    const fontSize = fontSizeProp ?? densityOf(c).f(11)
    const accent = getToneColor(tone, c)
    const accentText = getReadableToneColor(tone, c)
    const engineering = c.preset === 'engineering'
    const resolvedHeight = height ?? densityOf(c).f(20)

    return React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            ...(width != null ? { width } : {}),
            ...(minWidth != null ? { minWidth } : {}),
            height: resolvedHeight,
            padding,
            borderRadius: engineering ? Math.min(radius, 5) : radius,
            ...(engineering
                ? { backgroundColor: getToneFill(tone, c) }
                : filled
                    ? { backgroundImage: getToneGradient(tone) }
                    : { backgroundColor: tone === 'neutral' ? 'transparent' : withColorAlpha(accent, 0x10 / 0xff) }),
            border: `1px solid ${engineering ? accent : filled ? withColorAlpha(accent, 0) : tone === 'neutral' ? c.border : withColorAlpha(accent, 0x55 / 0xff)}`,
            color: engineering ? c.textPrimary : filled ? c.textOnColor : tone === 'neutral' ? c.textSecondary : accentText,
            fontSize,
            fontWeight: 400,
            lineHeight: 1,
            fontFamily: mono ? c.fontMono : c.fontSans,
            boxSizing: 'border-box' as const,
            whiteSpace: 'nowrap' as const,
        }
    }, renderMaybeMath(text, math))
}

// ─── GradientChip — Prominent chip with title and optional sublabel ─────────

interface GradientChipProps {
    title: React.ReactNode
    c: ThemeColors
    subtitle?: React.ReactNode
    tone?: ToneName
    gradient?: string
    width?: number | string
    minWidth?: number | string
    height?: number | string
    minHeight?: number | string
    padding?: number | string
    radius?: number
    shadow?: boolean
    align?: 'left' | 'center'
    subtitleMono?: boolean
    math?: boolean
}

export function GradientChip({
    title,
    c,
    subtitle,
    tone = 'blue',
    gradient,
    width,
    minWidth,
    height,
    minHeight: minHeightProp,
    padding: paddingProp,
    radius: radiusProp,
    shadow = false,
    align = 'left',
    subtitleMono = false,
    math = false,
}: GradientChipProps): React.ReactElement {
    const d = densityOf(c)
    const minHeight = minHeightProp ?? d.s(60)
    const padding = paddingProp ?? `${d.s(8)}px ${d.s(14)}px`
    const radius = radiusProp ?? d.r(8)
    const textAlign = align
    const explicitFill = gradient != null
    const engineering = c.preset === 'engineering' && !explicitFill
    const flat = !explicitFill
    const accent = getToneColor(tone, c)
    const textColor = flat ? c.textPrimary : c.textOnColor

    return React.createElement('div', {
        style: {
            ...(width != null ? { width } : {}),
            ...(minWidth != null ? { minWidth } : {}),
            ...(height != null ? { height } : {}),
            ...(minHeight != null ? { minHeight } : {}),
            boxSizing: 'border-box' as const,
            borderRadius: engineering ? Math.min(radius, 5) : radius,
            ...(engineering
                ? { backgroundColor: getToneFill(tone, c), border: `1px solid ${accent}` }
                : flat
                    ? { backgroundColor: withColorAlpha(accent, 0x14 / 0xff), border: `1px solid ${withColorAlpha(accent, 0.45)}` }
                    : { backgroundImage: gradient }),
            color: textColor,
            display: 'flex',
            flexDirection: 'column' as const,
            justifyContent: 'center',
            alignItems: align === 'center' ? 'center' : 'flex-start',
            gap: d.s(4),
            padding,
            ...(shadow && hasShadow(c) ? { boxShadow: `0 12px 30px ${c.shadow}` } : {}),
        },
    },
        React.createElement('div', {
            style: {
                fontFamily: c.fontSans,
                fontSize: d.type.label,
                color: textColor,
                fontWeight: 600,
                lineHeight: 1.15,
                textAlign,
            }
        }, renderMaybeMath(title, math)),
        subtitle && React.createElement('div', {
            style: {
                fontSize: d.type.small,
                color: flat ? c.textSecondary : 'rgba(255,255,255,0.86)',
                lineHeight: 1.25,
                textAlign,
                fontFamily: subtitleMono ? c.fontMono : c.fontSans,
            }
        }, renderMaybeMath(subtitle, math)),
    )
}

// ─── StepCard — Centered flow card for questions, choices, and stages ───────

interface StepCardProps {
    title: React.ReactNode
    c: ThemeColors
    subtitle?: React.ReactNode
    eyebrow?: React.ReactNode
    tone?: ToneName
    width?: number | string
    minWidth?: number | string
    minHeight?: number | string
    padding?: number | string
    radius?: number
    shadow?: boolean
    align?: 'left' | 'center'
    math?: boolean
}

export function StepCard({
    title,
    c,
    subtitle,
    eyebrow,
    tone,
    width,
    minWidth,
    minHeight: minHeightProp,
    padding: paddingProp,
    radius: radiusProp,
    shadow = false,
    align = 'center',
    math = false,
}: StepCardProps): React.ReactElement {
    const d = densityOf(c)
    const minHeight = minHeightProp ?? d.s(66)
    const padding = paddingProp ?? `${d.s(10)}px ${d.s(14)}px`
    const radius = radiusProp ?? d.r(8)
    const accent = getToneColor(tone ?? 'blue', c)
    const engineering = c.preset === 'engineering'
    const textAlign = align

    return Card({
        c,
        // Width follows the words by default, within reason.
        width: width ?? d.f(200),
        minWidth,
        minHeight,
        padding,
        radius: engineering ? 5 : radius,
        justify: 'center',
        shadow: engineering ? false : shadow,
        background: engineering ? getToneFill(tone ?? 'blue', c) : undefined,
        borderColor: engineering ? accent : tone ? withColorAlpha(accent, 0.5) : c.borderLight,
        children: React.createElement('div', {
            style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column' as const,
                justifyContent: 'center',
                alignItems: align === 'center' ? 'center' : 'flex-start',
                gap: subtitle ? d.s(3) : d.s(2),
            }
        },
            eyebrow && React.createElement('div', {
                style: {
                    fontFamily: c.fontSans,
                    fontSize: d.type.micro,
                    color: tone ? getReadableToneColor(tone, c) : c.textMuted,
                    fontWeight: 400,
                    ...textFitStyle(textAlign),
                    lineHeight: 1.2,
                }
            }, renderMaybeMath(eyebrow, math)),
            React.createElement('div', {
                style: {
                    fontFamily: c.fontSans,
                    fontSize: d.type.label,
                    color: c.textPrimary,
                    fontWeight: 600,
                    lineHeight: 1.2,
                    ...textFitStyle(textAlign),
                }
            }, renderMaybeMath(title, math)),
            subtitle && React.createElement('div', {
                style: {
                    fontFamily: engineering ? c.fontMono : c.fontSans,
                    fontSize: d.type.small,
                    color: c.textSecondary,
                    lineHeight: 1.25,
                    ...textFitStyle(textAlign),
                }
            }, renderMaybeMath(subtitle, math)),
        ),
    })
}

// ─── MetricCard — Compact KPI/value card with consistent typography ──────────

interface MetricCardProps {
    label: React.ReactNode
    value: React.ReactNode
    c: ThemeColors
    tone?: ToneName
    detail?: React.ReactNode
    width?: number | string
    minWidth?: number | string
    minHeight?: number | string
    padding?: number | string
    radius?: number
    shadow?: boolean
    align?: 'left' | 'center'
    math?: boolean
    valueMono?: boolean
    valueFontSize?: number
    valueColor?: string
}

export function MetricCard({
    label,
    value,
    c,
    tone,
    detail,
    width,
    minWidth,
    minHeight,
    padding: paddingProp,
    radius: radiusProp,
    shadow = false,
    align = 'left',
    math = false,
    valueMono = true,
    valueFontSize,
    valueColor,
}: MetricCardProps): React.ReactElement {
    const d = densityOf(c)
    const padding = paddingProp ?? `${d.s(9)}px ${d.s(12)}px`
    const radius = radiusProp ?? d.r(8)
    const accent = getToneColor(tone ?? 'blue', c)
    const textAlign = align

    return Card({
        c,
        width,
        minWidth,
        minHeight,
        padding,
        radius,
        shadow,
        justify: 'center',
        borderColor: tone ? withColorAlpha(accent, 0.45) : c.border,
        children: React.createElement('div', {
            style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column' as const,
                justifyContent: 'center',
                alignItems: align === 'center' ? 'center' : 'flex-start',
                gap: d.s(3),
            }
        },
            ...compactChildren([
            React.createElement('div', {
                style: {
                    fontSize: d.type.micro,
                    fontWeight: 400,
                    color: c.textMuted,
                    fontFamily: c.fontSans,
                    lineHeight: 1.2,
                    ...textFitStyle(textAlign),
                }
            }, renderMaybeMath(label, math)),
            React.createElement('div', {
                style: {
                    fontSize: valueFontSize ?? d.f(22),
                    fontWeight: 400,
                    color: valueColor ?? (tone ? getReadableToneColor(tone, c) : c.textPrimary),
                    lineHeight: 1.1,
                    ...textFitStyle(textAlign),
                    fontFamily: valueMono ? c.fontMono : c.fontSans,
                }
            }, renderMaybeMath(value, math)),
            detail && React.createElement('div', {
                style: {
                    fontSize: d.type.micro,
                    fontFamily: c.fontSans,
                    color: c.textSecondary,
                    lineHeight: 1.25,
                    ...textFitStyle(textAlign),
                }
            }, renderMaybeMath(detail, math)),
            ])
        ),
    })
}
