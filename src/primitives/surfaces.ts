import React from 'react'
import {
    typography,
    type ThemeColors,
    type ToneName,
    getToneColor,
    getToneFill,
    getToneGradient,
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
    gap = 12,
    align = 'center',
    wrap = false,
    children,
}: StackProps): React.ReactElement {
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
    padding = 20,
    radius = 8,
    gap,
    align = 'stretch',
    justify = 'start',
    shadow = false,
    background,
    borderColor,
    bodyStyle,
}: CardProps): React.ReactElement {
    const hasHeader = title || subtitle || tone

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: flexAlign(align),
            justifyContent: flexJustify(justify),
            gap: gap ?? (hasHeader || footer ? 10 : 0),
            backgroundColor: background ?? c.bgCard,
            borderRadius: radius,
            border: `1px solid ${borderColor ?? c.borderSubtle}`,
            padding,
            ...(width !== undefined ? { width } : {}),
            ...(minWidth !== undefined ? { minWidth } : {}),
            ...(height !== undefined ? { height } : {}),
            ...(minHeight !== undefined ? { minHeight } : {}),
            ...(shadow ? { boxShadow: `0 9px 24px ${c.shadow}` } : {}),
        }
    },
        ...compactChildren([
        hasHeader && React.createElement('div', {
            style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column' as const,
                gap: subtitle ? 5 : 0,
            }
        },
            ...compactChildren([
            (title || tone) && React.createElement('div', {
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: c.textPrimary,
                    ...typography.small,
                    ...textFitStyle(),
                    fontWeight: 900,
                    lineHeight: 1.2,
                }
            },
                tone && ToneStrip({ tone, width: 30, height: 4 }),
                title,
            ),
            subtitle && React.createElement('div', {
                style: {
                    display: 'flex',
                    color: c.textSecondary,
                    ...typography.tiny,
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
                ...typography.tiny,
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
    tone = 'blue',
    detail,
    width = 112,
    math = false,
}: ValuePillProps): React.ReactElement {
    const accent = getToneColor(tone, c)

    return Card({
        c,
        tone,
        width,
        padding: 12,
        radius: 10,
        shadow: true,
        title: React.createElement('span', {
            style: {
                textTransform: 'uppercase' as const,
                letterSpacing: '0.05em',
            }
        }, renderMaybeMath(label, math)),
        children: React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                gap: 4,
            }
        },
            React.createElement('div', {
                style: {
                    color: accent,
                    fontFamily: 'JetBrains Mono',
                    fontSize: 24,
                    fontWeight: 900,
                    lineHeight: 1,
                }
            }, renderMaybeMath(value, math)),
            detail && React.createElement('div', {
                style: {
                    color: c.textSecondary,
                    ...typography.tiny,
                    lineHeight: 1.3,
                }
            }, renderMaybeMath(detail, math)),
        ),
    })
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
    tone = 'purple',
    result,
    detail,
    width = 190,
    height,
    math = false,
    align = 'left',
}: EquationCardProps): React.ReactElement {
    const accent = getToneColor(tone, c)
    const textAlign = align

    return Card({
        c,
        tone,
        width,
        height,
        padding: 16,
        radius: 10,
        shadow: true,
        title,
        children: React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                gap: 8,
                alignItems: align === 'center' ? 'center' : 'flex-start',
            }
        },
            React.createElement('div', {
                style: {
                    color: c.textPrimary,
                    fontFamily: 'JetBrains Mono',
                    fontSize: 15,
                    fontWeight: 800,
                    lineHeight: 1.3,
                    textAlign,
                }
            }, renderMaybeMath(formula, math)),
            result && React.createElement('div', {
                style: {
                    color: accent,
                    fontFamily: 'JetBrains Mono',
                    fontSize: 28,
                    fontWeight: 900,
                    lineHeight: 1,
                    textAlign,
                }
            }, renderMaybeMath(result, math)),
            detail && React.createElement('div', {
                style: {
                    color: c.textSecondary,
                    ...typography.tiny,
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
    tone = 'blue',
    width,
    minWidth = 34,
    height = 20,
    padding = '0 8px',
    radius = 6,
    fontSize = 9,
    mono = true,
    filled = false,
    math = false,
}: BadgePillProps): React.ReactElement {
    const accent = getToneColor(tone, c)

    return React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            ...(width != null ? { width } : {}),
            ...(minWidth != null ? { minWidth } : {}),
            ...(height != null ? { height } : {}),
            padding,
            borderRadius: radius,
            ...(filled ? { backgroundImage: getToneGradient(tone) } : { backgroundColor: `${accent}18` }),
            border: `1px solid ${filled ? `${accent}00` : `${accent}55`}`,
            color: filled ? c.textOnColor : accent,
            fontSize,
            fontWeight: 800,
            lineHeight: 1,
            fontFamily: mono ? 'JetBrains Mono' : 'Inter',
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
    minHeight = 78,
    padding = '0 18px',
    radius = 8,
    shadow = true,
    align = 'left',
    subtitleMono = true,
    math = false,
}: GradientChipProps): React.ReactElement {
    const textAlign = align

    return React.createElement('div', {
        style: {
            ...(width != null ? { width } : {}),
            ...(minWidth != null ? { minWidth } : {}),
            ...(height != null ? { height } : {}),
            ...(minHeight != null ? { minHeight } : {}),
            boxSizing: 'border-box' as const,
            borderRadius: radius,
            ...(gradient != null ? { backgroundImage: gradient } : { backgroundImage: getToneGradient(tone) }),
            color: c.textOnColor,
            display: 'flex',
            flexDirection: 'column' as const,
            justifyContent: 'center',
            alignItems: align === 'center' ? 'center' : 'flex-start',
            gap: 5,
            padding,
            ...(shadow ? { boxShadow: `0 12px 30px ${c.shadow}` } : {}),
        },
    },
        React.createElement('div', {
            style: {
                ...typography.label,
                color: c.textOnColor,
                fontWeight: 900,
                lineHeight: 1.1,
                textAlign,
            }
        }, renderMaybeMath(title, math)),
        subtitle && React.createElement('div', {
            style: {
                fontSize: 11,
                color: 'rgba(255,255,255,0.86)',
                lineHeight: 1.2,
                textAlign,
                fontFamily: subtitleMono ? 'JetBrains Mono' : 'Inter',
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
    tone = 'blue',
    width = 210,
    minWidth,
    minHeight = 74,
    padding = '12px 14px',
    radius = 8,
    shadow = true,
    align = 'center',
    math = false,
}: StepCardProps): React.ReactElement {
    const accent = getToneColor(tone, c)
    const engineering = c.preset === 'engineering'
    const textAlign = align

    return Card({
        c,
        width,
        minWidth,
        minHeight,
        padding,
        radius: engineering ? 5 : radius,
        shadow: engineering ? false : shadow,
        background: engineering ? getToneFill(tone, c) : undefined,
        borderColor: engineering ? accent : `${accent}88`,
        children: React.createElement('div', {
            style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column' as const,
                justifyContent: 'center',
                alignItems: align === 'center' ? 'center' : 'flex-start',
                gap: subtitle ? 5 : 2,
            }
        },
            eyebrow && React.createElement('div', {
                style: {
                    ...typography.tiny,
                    fontFamily: c.fontMono,
                    color: c.textMuted,
                    fontWeight: engineering ? 400 : 800,
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.05em',
                    ...textFitStyle(textAlign),
                    lineHeight: 1.2,
                }
            }, renderMaybeMath(eyebrow, math)),
            React.createElement('div', {
                style: {
                    ...typography.label,
                    fontFamily: c.fontSans,
                    color: engineering ? c.textPrimary : accent,
                    fontWeight: 700,
                    lineHeight: 1.15,
                    ...textFitStyle(textAlign),
                }
            }, renderMaybeMath(title, math)),
            subtitle && React.createElement('div', {
                style: {
                    ...typography.tiny,
                    fontFamily: c.fontMono,
                    color: c.textMuted,
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
    tone = 'blue',
    detail,
    width,
    minWidth,
    minHeight = 74,
    padding = '10px 12px',
    radius = 8,
    shadow = true,
    align = 'center',
    math = false,
    valueMono = true,
    valueFontSize = 10,
    valueColor,
}: MetricCardProps): React.ReactElement {
    const accent = getToneColor(tone, c)
    const textAlign = align

    return Card({
        c,
        width,
        minWidth,
        minHeight,
        padding,
        radius,
        shadow,
        borderColor: `${accent}66`,
        children: React.createElement('div', {
            style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column' as const,
                justifyContent: 'center',
                alignItems: align === 'center' ? 'center' : 'flex-start',
                gap: 3,
            }
        },
            ...compactChildren([
            React.createElement('div', {
                style: {
                    fontSize: 11,
                    fontWeight: 800,
                    color: accent,
                    lineHeight: 1.1,
                    ...textFitStyle(textAlign),
                }
            }, renderMaybeMath(label, math)),
            React.createElement('div', {
                style: {
                    fontSize: valueFontSize,
                    fontWeight: 700,
                    color: valueColor ?? c.textPrimary,
                    lineHeight: 1.15,
                    ...textFitStyle(textAlign),
                    fontFamily: valueMono ? 'JetBrains Mono' : 'Inter',
                }
            }, renderMaybeMath(value, math)),
            detail && React.createElement('div', {
                style: {
                    ...typography.tiny,
                    color: c.textMuted,
                    lineHeight: 1.2,
                    ...textFitStyle(textAlign),
                }
            }, renderMaybeMath(detail, math)),
            ])
        ),
    })
}
