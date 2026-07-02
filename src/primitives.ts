/**
 * Vizmatic — Primitives
 *
 * High-level, THEME-AWARE building blocks for creating illustrations.
 * All primitives accept a ThemeColors object so they render correctly
 * in both dark and light modes.
 *
 * Design goals:
 * - Simple API: minimal props, beautiful defaults
 * - Theme-aware: all colors come from ThemeColors
 * - Composable: nest freely, flexbox layout
 * - AI-friendly: no coordinate math, just CSS
 */

import React from 'react'
import {
    typography,
    heatColor,
    getThemeColors,
    type ThemeColors,
    type ThemeMode,
    type ColorName,
    type ToneName,
    getColor,
    getGradient,
    getToneColor,
    getToneGradient,
} from './theme'
import { getRenderBackground } from './renderContext'

export type IllustrationBuilder = (c: ThemeColors) => React.ReactElement

/**
 * Small export helper for embedded illustrations.
 *
 * Usage:
 *   const illustration = defineIllustration((c) => ...)
 *   export const create = illustration.create
 *   export default illustration.default
 */
export function defineIllustration(build: IllustrationBuilder, defaultTheme: ThemeMode = 'dark') {
    return {
        create(theme: ThemeMode) {
            return build(getThemeColors(theme))
        },
        default: build(getThemeColors(defaultTheme)),
    }
}

// ─── Canvas — Root wrapper for every illustration ────────────────────────────

interface CanvasProps {
    children?: React.ReactNode
    c: ThemeColors
    padding?: number
    justify?: 'center' | 'flex-start' | 'space-between' | 'space-around'
    background?: string
}

export function Canvas({ children, c, padding = 40, justify = 'center', background }: CanvasProps): React.ReactElement {
    const renderBackground = getRenderBackground()
    const canvasBackground = background ?? (renderBackground === 'theme' ? c.bg : renderBackground)

    return React.createElement('div', {
        style: {
            width: '100%',
            height: '100%',
            boxSizing: 'border-box' as const,
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            justifyContent: justify,
            backgroundColor: canvasBackground,
            fontFamily: 'Inter',
            padding,
        }
    }, children)
}

// ─── TitleBar — Standard illustration header ─────────────────────────────────

interface TitleBarProps {
    title: string
    subtitle?: string
    c: ThemeColors
}

export function TitleBar({ title, subtitle, c }: TitleBarProps): React.ReactElement {
    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            gap: 6,
            marginBottom: 24,
        }
    },
        React.createElement('div', {
            style: {
                ...typography.title,
                color: c.textPrimary,
            }
        }, title),
        subtitle && React.createElement('div', {
            style: {
                ...typography.body,
                color: c.textSecondary,
                fontFamily: 'JetBrains Mono',
            }
        }, subtitle),
    )
}

// ─── Tone helpers — shared semantic accent mapping ──────────────────────────

export type { ToneName }
export { getToneColor, getToneGradient }

type FlexAlign = 'start' | 'center' | 'end' | 'stretch'
type FlexJustify = 'start' | 'center' | 'end' | 'space-between' | 'space-around'

function flexAlign(align: FlexAlign): React.CSSProperties['alignItems'] {
    return {
        start: 'flex-start',
        center: 'center',
        end: 'flex-end',
        stretch: 'stretch',
    }[align] as React.CSSProperties['alignItems']
}

function flexJustify(justify: FlexJustify): React.CSSProperties['justifyContent'] {
    return {
        start: 'flex-start',
        center: 'center',
        end: 'flex-end',
        'space-between': 'space-between',
        'space-around': 'space-around',
    }[justify] as React.CSSProperties['justifyContent']
}

type TextFitAlign = 'left' | 'center' | 'right'

function textFitStyle(align: TextFitAlign = 'left'): React.CSSProperties {
    return {
        minWidth: 0,
        maxWidth: '100%',
        whiteSpace: 'normal' as const,
        overflowWrap: 'break-word' as const,
        textAlign: align,
    }
}

function compactChildren(children: React.ReactNode[]): React.ReactNode[] {
    return children.filter((child) => child !== undefined && child !== null && child !== false)
}

interface SceneProps {
    c: ThemeColors
    children: React.ReactNode
    title?: string
    subtitle?: string
    padding?: number
    gap?: number
    justify?: CanvasProps['justify']
    align?: FlexAlign
    contentWidth?: number | string
    background?: string
    contentStyle?: React.CSSProperties
}

export function Scene({
    c,
    children,
    title,
    subtitle,
    padding = 40,
    gap = 24,
    justify = 'flex-start',
    align = 'stretch',
    contentWidth = '100%',
    background,
    contentStyle,
}: SceneProps): React.ReactElement {
    return React.createElement(Canvas, { c, padding, justify, background },
        ...compactChildren([
            title && React.createElement(TitleBar, { c, title, subtitle }),
            React.createElement('div', {
            style: {
                width: contentWidth,
                display: 'flex',
                flexDirection: 'column' as const,
                alignItems: flexAlign(align),
                gap,
                ...contentStyle,
            }
            }, children),
        ])
    )
}

interface FlexBoxProps {
    children: React.ReactNode
    gap?: number
    align?: FlexAlign
    justify?: FlexJustify
    wrap?: boolean
    width?: number | string
    height?: number | string
    style?: React.CSSProperties
}

function flexBox(direction: 'row' | 'column', {
    children,
    gap = 12,
    align = 'center',
    justify = 'center',
    wrap = false,
    width,
    height,
    style,
}: FlexBoxProps): React.ReactElement {
    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: direction,
            alignItems: flexAlign(align),
            justifyContent: flexJustify(justify),
            gap,
            ...(wrap ? { flexWrap: 'wrap' as const } : {}),
            ...(width != null ? { width } : {}),
            ...(height != null ? { height } : {}),
            ...style,
        }
    }, children)
}

export function Row(props: FlexBoxProps): React.ReactElement {
    return flexBox('row', props)
}

export function Column(props: FlexBoxProps): React.ReactElement {
    return flexBox('column', props)
}

interface ToneStripProps {
    tone: ToneName
    width?: number
    height?: number
}

export function ToneStrip({ tone, width = 34, height = 4 }: ToneStripProps): React.ReactElement {
    return React.createElement('span', {
        style: {
            display: 'flex',
            width,
            height,
            borderRadius: 999,
            backgroundImage: getToneGradient(tone),
            flexShrink: 0,
        }
    }, '')
}

interface PanelProps {
    title: React.ReactNode
    c: ThemeColors
    children?: React.ReactNode
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
    titleFontSize?: number
    accentWidth?: number
    accentHeight?: number
    bodyStyle?: React.CSSProperties
}

export function Panel({
    title,
    c,
    children,
    subtitle,
    tone = 'blue',
    footer,
    width,
    minWidth,
    height,
    minHeight,
    padding = 14,
    radius = 8,
    gap = 10,
    align = 'stretch',
    justify = 'start',
    shadow = true,
    background,
    borderColor,
    titleFontSize,
    accentWidth = 34,
    accentHeight = 4,
    bodyStyle,
}: PanelProps): React.ReactElement {
    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: flexAlign(align),
            justifyContent: flexJustify(justify),
            gap,
            ...(width != null ? { width } : {}),
            ...(minWidth != null ? { minWidth } : {}),
            ...(height != null ? { height } : {}),
            ...(minHeight != null ? { minHeight } : {}),
            padding,
            borderRadius: radius,
            border: `1px solid ${borderColor ?? c.borderSubtle}`,
            backgroundColor: background ?? c.bgCard,
            ...(shadow ? { boxShadow: `0 9px 24px ${c.shadow}` } : {}),
        }
    },
        ...compactChildren([
        React.createElement('div', {
            style: {
                width: '100%',
                display: 'flex',
                flexDirection: 'column' as const,
                gap: subtitle ? 5 : 0,
            }
        },
            ...compactChildren([
            React.createElement('div', {
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: c.textPrimary,
                    ...typography.small,
                    ...textFitStyle(),
                    fontSize: titleFontSize ?? typography.small.fontSize,
                    fontWeight: 900,
                    lineHeight: 1.2,
                }
            },
                ToneStrip({ tone, width: accentWidth, height: accentHeight }),
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

// ─── MathText — Inline math-ish labels with scripts ─────────────────────────

type MathTextPart =
    | { kind: 'text'; value: string }
    | { kind: 'sub' | 'sup'; value: string }

function readScriptValue(text: string, start: number): { value: string; next: number } {
    if (text[start] === '{') {
        const end = text.indexOf('}', start + 1)
        if (end !== -1) return { value: text.slice(start + 1, end), next: end + 1 }
    }

    let next = start
    while (next < text.length && /[A-Za-z0-9+\-]/.test(text[next])) next += 1
    if (next === start) next += 1
    return { value: text.slice(start, next), next }
}

function parseMathText(text: string): MathTextPart[] {
    const parts: MathTextPart[] = []
    let buffer = ''
    let index = 0

    while (index < text.length) {
        const char = text[index]
        if ((char === '_' || char === '^') && index + 1 < text.length) {
            if (buffer) {
                parts.push({ kind: 'text', value: buffer })
                buffer = ''
            }
            const script = readScriptValue(text, index + 1)
            parts.push({ kind: char === '_' ? 'sub' : 'sup', value: script.value })
            index = script.next
            continue
        }

        buffer += char
        index += 1
    }

    if (buffer) parts.push({ kind: 'text', value: buffer })
    return parts
}

const subscriptChars: Record<string, string> = {
    '0': '₀',
    '1': '₁',
    '2': '₂',
    '3': '₃',
    '4': '₄',
    '5': '₅',
    '6': '₆',
    '7': '₇',
    '8': '₈',
    '9': '₉',
    '+': '₊',
    '-': '₋',
    '=': '₌',
    '(': '₍',
    ')': '₎',
    a: 'ₐ',
    e: 'ₑ',
    h: 'ₕ',
    i: 'ᵢ',
    j: 'ⱼ',
    k: 'ₖ',
    l: 'ₗ',
    m: 'ₘ',
    n: 'ₙ',
    o: 'ₒ',
    p: 'ₚ',
    r: 'ᵣ',
    s: 'ₛ',
    t: 'ₜ',
    u: 'ᵤ',
    v: 'ᵥ',
    x: 'ₓ',
}

const superscriptChars: Record<string, string> = {
    '0': '⁰',
    '1': '¹',
    '2': '²',
    '3': '³',
    '4': '⁴',
    '5': '⁵',
    '6': '⁶',
    '7': '⁷',
    '8': '⁸',
    '9': '⁹',
    '+': '⁺',
    '-': '⁻',
    '=': '⁼',
    '(': '⁽',
    ')': '⁾',
    A: 'ᴬ',
    B: 'ᴮ',
    D: 'ᴰ',
    E: 'ᴱ',
    G: 'ᴳ',
    H: 'ᴴ',
    I: 'ᴵ',
    J: 'ᴶ',
    K: 'ᴷ',
    L: 'ᴸ',
    M: 'ᴹ',
    N: 'ᴺ',
    O: 'ᴼ',
    P: 'ᴾ',
    R: 'ᴿ',
    T: 'ᵀ',
    U: 'ᵁ',
    V: 'ⱽ',
    W: 'ᵂ',
    a: 'ᵃ',
    b: 'ᵇ',
    c: 'ᶜ',
    d: 'ᵈ',
    e: 'ᵉ',
    f: 'ᶠ',
    g: 'ᵍ',
    h: 'ʰ',
    i: 'ⁱ',
    j: 'ʲ',
    k: 'ᵏ',
    l: 'ˡ',
    m: 'ᵐ',
    n: 'ⁿ',
    o: 'ᵒ',
    p: 'ᵖ',
    r: 'ʳ',
    s: 'ˢ',
    t: 'ᵗ',
    u: 'ᵘ',
    v: 'ᵛ',
    w: 'ʷ',
    x: 'ˣ',
    y: 'ʸ',
    z: 'ᶻ',
}

const superscriptWords: Record<string, string> = {
    alpha: 'ᵅ',
    beta: 'ᵝ',
    gamma: 'ᵞ',
    theta: 'ᶿ',
}

function scriptText(value: string, kind: 'sub' | 'sup'): string {
    const words = kind === 'sup' ? superscriptWords : {}
    const chars = kind === 'sub' ? subscriptChars : superscriptChars
    if (words[value]) return words[value]
    if ((value.startsWith('-') || value.startsWith('+')) && words[value.slice(1)]) {
        return `${chars[value[0]]}${words[value.slice(1)]}`
    }
    return Array.from(value).map((char) => chars[char] ?? char).join('')
}

export function formatMathText(text: string): string {
    return parseMathText(text)
        .map((part) => part.kind === 'text' ? part.value : scriptText(part.value, part.kind))
        .join('')
}

interface MathTextProps {
    text: string
}

export function MathText({ text }: MathTextProps): string {
    return formatMathText(text)
}

// ─── TextLabel — Theme-aware text node with optional math formatting ─────────

interface TextLabelProps {
    text: string
    c: ThemeColors
    variant?: keyof typeof typography
    color?: string
    fontSize?: number
    fontWeight?: number
    width?: number | string
    align?: 'left' | 'center' | 'right'
    math?: boolean
    mono?: boolean
}

export function TextLabel({
    text,
    c,
    variant = 'body',
    color,
    fontSize,
    fontWeight,
    width,
    align = 'left',
    math = false,
    mono = false,
}: TextLabelProps): React.ReactElement {
    const base = typography[variant]
    return React.createElement('div', {
        style: {
            display: 'flex',
            ...(width !== undefined ? { width } : {}),
            ...base,
            ...textFitStyle(align),
            color: color ?? c.textSecondary,
            fontSize: fontSize ?? base.fontSize,
            fontWeight: fontWeight ?? base.fontWeight,
            fontFamily: mono ? 'JetBrains Mono' : base.fontFamily,
            justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
            lineHeight: 1.35,
        }
    }, math ? formatMathText(text) : text)
}

interface SvgMathTextProps {
    text: string
    x: number
    y: number
    fill: string
    fontSize?: number
    fontFamily?: string
    fontWeight?: number
    textAnchor?: 'start' | 'middle' | 'end'
    dominantBaseline?: string
    opacity?: number
}

export function SvgMathText({
    text,
    x,
    y,
    fill,
    fontSize = 13,
    fontFamily = 'JetBrains Mono',
    fontWeight = 800,
    textAnchor = 'middle',
    dominantBaseline = 'middle',
    opacity = 1,
}: SvgMathTextProps): React.ReactElement {
    return React.createElement('text', {
        x,
        y,
        fill,
        fontSize,
        fontFamily,
        fontWeight,
        textAnchor,
        dominantBaseline,
        opacity,
    },
        ...parseMathText(text).map((part, index) => {
            if (part.kind === 'text') return part.value
            return React.createElement('tspan', {
                key: `${part.kind}-${index}-${part.value}`,
                baselineShift: part.kind === 'sub' ? 'sub' : 'super',
                fontSize: Math.round(fontSize * 0.72),
            }, part.value)
        })
    )
}

// ─── Box — Gradient or solid colored rectangle with label ────────────────────

interface BoxProps {
    label: string
    c: ThemeColors
    color?: ColorName
    width?: number
    height?: number
    fontSize?: number
    /** Use gradient background instead of solid */
    gradient?: boolean
    /** Optional sub-label below main label */
    sublabel?: string
    /** Optional icon/emoji before label */
    icon?: string
    /** Border radius */
    radius?: number
    /** Outlined style instead of filled */
    outlined?: boolean
}

export function Box({
    label,
    c,
    color = 'primary',
    width,
    height,
    fontSize = 14,
    gradient = false,
    sublabel,
    icon,
    radius = 8,
    outlined = false,
}: BoxProps): React.ReactElement {
    const solidColor = getColor(color, c)
    const gradientBg = getGradient(color)

    const style: React.CSSProperties = {
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius,
        padding: '12px 20px',
        gap: 4,
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
    }

    if (outlined) {
        style.border = `2px solid ${solidColor}`
        style.backgroundColor = 'transparent'
    } else if (gradient) {
        style.backgroundImage = gradientBg
        style.boxShadow = `0 4px 20px ${solidColor}30`
    } else {
        style.backgroundImage = gradientBg
        style.boxShadow = `0 4px 20px ${solidColor}30`
    }

    return React.createElement('div', { style },
        icon && React.createElement('div', {
            style: { fontSize: fontSize + 4 }
        }, icon),
        React.createElement('div', {
            style: {
                fontSize,
                fontWeight: 700,
                color: outlined ? solidColor : c.textOnColor,
                fontFamily: 'Inter',
                textAlign: 'center' as const,
                lineHeight: 1.3,
            }
        }, label),
        sublabel && React.createElement('div', {
            style: {
                fontSize: fontSize - 2,
                fontWeight: 400,
                color: outlined ? c.textMuted : `${c.textOnColor}b3`,
                fontFamily: 'JetBrains Mono',
                textAlign: 'center' as const,
            }
        }, sublabel),
    )
}

// ─── Arrow — Directional connector ──────────────────────────────────────────

interface ArrowProps {
    direction?: 'down' | 'right' | 'up' | 'left'
    label?: string
    length?: number
    c: ThemeColors
    color?: string
}

export function Arrow({
    direction = 'down',
    label,
    length = 40,
    c,
    color,
}: ArrowProps): React.ReactElement {
    const arrowColor = color || c.textMuted
    const isVertical = direction === 'down' || direction === 'up'
    const arrowHead = {
        down: {
            width: 14,
            height: 10,
            points: '0,0 14,0 7,10',
        },
        up: {
            width: 14,
            height: 10,
            points: '0,10 14,10 7,0',
        },
        right: {
            width: 10,
            height: 14,
            points: '0,0 10,7 0,14',
        },
        left: {
            width: 10,
            height: 14,
            points: '10,0 0,7 10,14',
        },
    }[direction]

    const line = React.createElement('div', {
        style: {
            ...(isVertical
                ? { width: 2, flexGrow: 1, minHeight: 1 }
                : { height: 2, flexGrow: 1, minWidth: 1 }),
            backgroundColor: arrowColor,
        }
    })

    const head = React.createElement('svg', {
        width: arrowHead.width,
        height: arrowHead.height,
        viewBox: `0 0 ${arrowHead.width} ${arrowHead.height}`,
        style: {
            flexShrink: 0,
        }
    },
        React.createElement('polygon', {
            points: arrowHead.points,
            fill: arrowColor,
        })
    )

    return React.createElement('div', {
        style: {
            position: 'relative' as const,
            display: 'flex',
            flexDirection: isVertical ? 'column' as const : 'row' as const,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0,
            ...(isVertical ? { height: length } : { width: length }),
        }
    },
        ...(direction === 'up' || direction === 'left' ? [head, line] : [line, head]),
        // Optional label
        label && React.createElement('div', {
            style: {
                fontSize: 10,
                color: c.textMuted,
                fontFamily: 'Inter',
                fontWeight: 500,
                position: 'absolute' as const,
                ...(isVertical ? { left: 8 } : { bottom: 12 }),
            }
        }, label),
    )
}

interface FlowArrowProps {
    direction?: 'down' | 'right' | 'up' | 'left'
    label?: string
    length?: number
    c: ThemeColors
    tone?: ToneName
    color?: string
}

export function FlowArrow({
    direction = 'right',
    label,
    length = 40,
    c,
    tone = 'blue',
    color,
}: FlowArrowProps): React.ReactElement {
    return Arrow({
        direction,
        label,
        length,
        c,
        color: color ?? getToneColor(tone, c),
    })
}

export function Connector(props: FlowArrowProps): React.ReactElement {
    return FlowArrow(props)
}

// ─── VectorArrow — SVG line with arrowhead for arbitrary angles ─────────────

interface VectorArrowProps {
    key?: React.Key
    x1: number
    y1: number
    x2: number
    y2: number
    color: string
    strokeWidth?: number
    arrowSize?: number      // arrowhead length as multiplier of strokeWidth
    opacity?: number
}

export function VectorArrow({
    key, x1, y1, x2, y2, color, strokeWidth = 2, arrowSize = 2.2, opacity = 1,
}: VectorArrowProps): React.ReactElement {
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)

    if (len < 0.001) {
        return React.createElement('g', null)
    }

    const ux = dx / len
    const uy = dy / len
    const px = -uy
    const py = ux

    const headLen = strokeWidth * arrowSize
    const headWidth = headLen * 0.6

    const backX = x2 - ux * headLen
    const backY = y2 - uy * headLen

    const points = `${x2},${y2} ${backX + px * headWidth / 2},${backY + py * headWidth / 2} ${backX - px * headWidth / 2},${backY - py * headWidth / 2}`

    return React.createElement('g', { key, opacity },
        React.createElement('line', {
            x1, y1, x2: backX, y2: backY,
            stroke: color,
            strokeWidth,
            strokeLinecap: 'round',
        }),
        React.createElement('polygon', {
            points,
            fill: color,
        }),
    )
}

// ─── VectorSegment — SVG line without arrowhead, with optional dots ─────────

interface VectorSegmentProps {
    key?: React.Key
    x1: number
    y1: number
    x2: number
    y2: number
    color: string
    strokeWidth?: number
    opacity?: number
    showStartDot?: boolean
    showEndDot?: boolean
    dotRadius?: number
}

export function VectorSegment({
    key,
    x1,
    y1,
    x2,
    y2,
    color,
    strokeWidth = 4,
    opacity = 1,
    showStartDot = false,
    showEndDot = true,
    dotRadius = 4.5,
}: VectorSegmentProps): React.ReactElement {
    return React.createElement('g', { key, opacity },
        React.createElement('line', {
            x1,
            y1,
            x2,
            y2,
            stroke: color,
            strokeWidth,
            strokeLinecap: 'round',
        }),
        showStartDot && React.createElement('circle', {
            cx: x1,
            cy: y1,
            r: dotRadius,
            fill: color,
        }),
        showEndDot && React.createElement('circle', {
            cx: x2,
            cy: y2,
            r: dotRadius,
            fill: color,
        }),
    )
}

// ─── SvgFrame — Theme-friendly SVG plot/frame background ───────────────────

interface SvgFrameProps {
    key?: React.Key
    x?: number
    y?: number
    width: number
    height: number
    c: ThemeColors
    rx?: number
    fill?: string
    stroke?: string
    strokeWidth?: number
    opacity?: number
}

export function SvgFrame({
    key,
    x = 0,
    y = 0,
    width,
    height,
    c,
    rx = 8,
    fill,
    stroke,
    strokeWidth = 1,
    opacity,
}: SvgFrameProps): React.ReactElement {
    return React.createElement('rect', {
        key,
        x,
        y,
        width,
        height,
        rx,
        fill: fill ?? c.bgSubtle,
        stroke: stroke ?? c.borderSubtle,
        strokeWidth,
        ...(opacity !== undefined ? { opacity } : {}),
    })
}

// ─── SvgPoint — Theme-friendly SVG circle primitive ─────────────────────────

interface SvgPointProps {
    key?: React.Key
    cx: number
    cy: number
    r?: number
    fill: string
    stroke?: string
    strokeWidth?: number
    opacity?: number
}

export function SvgPoint({
    key,
    cx,
    cy,
    r = 5,
    fill,
    stroke,
    strokeWidth,
    opacity,
}: SvgPointProps): React.ReactElement {
    return React.createElement('circle', {
        key,
        cx,
        cy,
        r,
        fill,
        ...(stroke ? { stroke } : {}),
        ...(strokeWidth ? { strokeWidth } : {}),
        ...(opacity !== undefined ? { opacity } : {}),
    })
}

// ─── ArrowMarkerDef — Reusable SVG marker for curved paths ──────────────────

interface ArrowMarkerDefProps {
    id: string
    color: string
    size?: number  // marker width/height in pixels
}

export function ArrowMarkerDef({ id, color, size = 5 }: ArrowMarkerDefProps): React.ReactElement {
    return React.createElement('marker', {
        id,
        viewBox: '0 0 10 10',
        refX: 9.5,
        refY: 5,
        markerWidth: size,
        markerHeight: size,
        orient: 'auto',
    },
        React.createElement('path', {
            d: 'M 0 0 L 10 5 L 0 10 z',
            fill: color,
        }),
    )
}

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

function renderMaybeMath(node: React.ReactNode, math: boolean): React.ReactNode {
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
    const textAlign = align

    return Card({
        c,
        width,
        minWidth,
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
                alignItems: align === 'center' ? 'center' : 'flex-start',
                gap: subtitle ? 5 : 2,
            }
        },
            eyebrow && React.createElement('div', {
                style: {
                    ...typography.tiny,
                    color: c.textMuted,
                    fontWeight: 800,
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.05em',
                    ...textFitStyle(textAlign),
                    lineHeight: 1.2,
                }
            }, renderMaybeMath(eyebrow, math)),
            React.createElement('div', {
                style: {
                    ...typography.label,
                    color: accent,
                    fontWeight: 700,
                    lineHeight: 1.15,
                    ...textFitStyle(textAlign),
                }
            }, renderMaybeMath(title, math)),
            subtitle && React.createElement('div', {
                style: {
                    ...typography.tiny,
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

// ─── StatusList — Rows with check/cross/warn status markers ─────────────────

export type StatusKind = 'check' | 'cross' | 'warn' | 'info' | 'pending' | 'dot'

const statusGlyphs: Record<StatusKind, string> = {
    check: '✓',
    cross: '✗',
    warn: '!',
    info: 'i',
    pending: '–',
    dot: '',
}

const statusTones: Record<StatusKind, ToneName> = {
    check: 'green',
    cross: 'red',
    warn: 'warm',
    info: 'blue',
    pending: 'neutral',
    dot: 'blue',
}

export interface StatusRowSpec {
    label: React.ReactNode
    detail?: React.ReactNode
    status?: StatusKind
    tone?: ToneName
}

interface StatusRowProps extends StatusRowSpec {
    c: ThemeColors
    boxed?: boolean
    fontSize?: number
    width?: number | string
    math?: boolean
}

export function StatusRow({
    label,
    detail,
    status = 'check',
    tone,
    c,
    boxed = true,
    fontSize = 11,
    width,
    math = false,
}: StatusRowProps): React.ReactElement {
    const accent = getToneColor(tone ?? statusTones[status], c)
    const glyph = statusGlyphs[status]

    const marker = React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            flexShrink: 0,
            borderRadius: 999,
            backgroundColor: status === 'dot' ? accent : `${accent}26`,
            border: `1px solid ${accent}`,
            color: accent,
            fontFamily: 'Inter',
            fontSize: status === 'warn' || status === 'info' ? 12 : 11,
            fontWeight: 900,
            lineHeight: 1,
        }
    }, glyph)

    return React.createElement('div', {
        style: {
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            width: width ?? '100%',
            boxSizing: 'border-box' as const,
            ...(boxed ? {
                padding: '7px 10px',
                borderRadius: 8,
                backgroundColor: `${accent}12`,
                border: `1px solid ${accent}3a`,
            } : { padding: '3px 0' }),
        }
    },
        marker,
        React.createElement('div', {
            style: {
                display: 'flex',
                flex: 1,
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize,
                fontWeight: 600,
                lineHeight: 1.3,
            }
        }, renderMaybeMath(label, math)),
        detail != null && React.createElement('div', {
            style: {
                display: 'flex',
                flexShrink: 0,
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: fontSize - 1,
                lineHeight: 1.3,
                textAlign: 'right' as const,
            }
        }, renderMaybeMath(detail, math)),
    )
}

interface StatusListProps {
    rows: StatusRowSpec[]
    c: ThemeColors
    gap?: number
    boxed?: boolean
    fontSize?: number
    width?: number | string
    math?: boolean
}

export function StatusList({
    rows,
    c,
    gap = 7,
    boxed = true,
    fontSize,
    width,
    math = false,
}: StatusListProps): React.ReactElement {
    return Column({
        gap,
        align: 'stretch',
        ...(width != null ? { width } : {}),
        children: rows.map((row, index) => React.createElement(React.Fragment, { key: `status-${index}` },
            StatusRow({ ...row, c, boxed, fontSize, math })
        )),
    })
}

// ─── Flow — Common linear stage flow with optional detail rows ──────────────

export interface FlowStageSpec {
    title: React.ReactNode
    subtitle?: React.ReactNode
    eyebrow?: React.ReactNode
    tone?: ToneName
    lines?: React.ReactNode[]
    children?: React.ReactNode
    width?: number | string
    minWidth?: number | string
    minHeight?: number | string
    padding?: number | string
}

interface FlowProps {
    stages: FlowStageSpec[]
    c: ThemeColors
    direction?: 'horizontal' | 'vertical'
    gap?: number
    connectorLength?: number
    connectorTone?: ToneName
    align?: FlexAlign
    math?: boolean
}

function renderFlowStage(stage: FlowStageSpec, c: ThemeColors, math: boolean): React.ReactElement {
    const tone = stage.tone ?? 'blue'
    const hasDetails = Boolean(stage.children || stage.lines?.length)

    if (!hasDetails) {
        return StepCard({
            title: stage.title,
            subtitle: stage.subtitle,
            eyebrow: stage.eyebrow,
            tone,
            c,
            width: stage.width,
            minWidth: stage.minWidth,
            minHeight: stage.minHeight,
            padding: stage.padding,
            math,
        })
    }

    return Panel({
        title: stage.title,
        subtitle: stage.subtitle,
        tone,
        c,
        width: stage.width,
        minWidth: stage.minWidth,
        minHeight: stage.minHeight,
        padding: stage.padding ?? 12,
        bodyStyle: { gap: 8 },
        children: stage.children ?? DetailList({ items: stage.lines ?? [], c, tone, math }),
    })
}

export function Flow({
    stages,
    c,
    direction = 'horizontal',
    gap = 10,
    connectorLength = 28,
    connectorTone = 'neutral',
    align = 'center',
    math = false,
}: FlowProps): React.ReactElement {
    const isHorizontal = direction === 'horizontal'
    const children = stages.flatMap((stage, index) => {
        const elements: React.ReactElement[] = [
            React.createElement(React.Fragment, { key: `stage-${index}` }, renderFlowStage(stage, c, math)),
        ]

        if (index < stages.length - 1) {
            elements.push(React.createElement(React.Fragment, { key: `connector-${index}` },
                FlowArrow({
                    direction: isHorizontal ? 'right' : 'down',
                    length: connectorLength,
                    c,
                    tone: connectorTone,
                })
            ))
        }

        return elements
    })

    return (isHorizontal ? Row : Column)({
        gap,
        align,
        justify: 'center',
        children,
    })
}

// ─── LayeredNetwork — Dense neural-network diagram without local coordinate code ─

export interface LayeredNetworkLayer {
    title: string
    nodes: string[]
    tone?: ToneName
}

interface LayeredNetworkProps {
    c: ThemeColors
    layers: LayeredNetworkLayer[]
    activePath?: number[]
    annotations?: string[]
    formula?: string
    legend?: string
    width?: number
    height?: number
    nodeSize?: number
    showFormula?: boolean
}

function distributeValues(count: number, start: number, end: number): number[] {
    if (count <= 1) return [(start + end) / 2]
    const step = (end - start) / (count - 1)
    return Array.from({ length: count }, (_, index) => start + index * step)
}

export function LayeredNetwork({
    c,
    layers,
    activePath = [],
    annotations = [],
    formula,
    legend = 'highlighted path',
    width = 900,
    height = 400,
    nodeSize = 56,
    showFormula = true,
}: LayeredNetworkProps): React.ReactElement {
    const radius = nodeSize / 2
    const top = 82
    const bottom = showFormula || formula ? height - 118 : height - 42
    const layerXs = distributeValues(layers.length, 82, width - 82)
    const nodeLayout = layers.map((layer, layerIndex) => ({
        ...layer,
        x: layerXs[layerIndex],
        ys: distributeValues(layer.nodes.length, top, bottom),
        tone: layer.tone ?? 'purple',
    }))

    const connectionElements = nodeLayout.slice(0, -1).flatMap((from, layerIndex) => {
        const to = nodeLayout[layerIndex + 1]
        return from.ys.flatMap((fromY, fromIndex) =>
            to.ys.map((toY, toIndex) => {
                const active = activePath[layerIndex] === fromIndex && activePath[layerIndex + 1] === toIndex
                return React.createElement('line', {
                    key: `connection-${layerIndex}-${fromIndex}-${toIndex}`,
                    x1: from.x + radius + 4,
                    y1: fromY,
                    x2: to.x - radius - 4,
                    y2: toY,
                    stroke: active ? c.warningLight : c.borderLight,
                    strokeWidth: active ? 3.6 : 1.2,
                    strokeOpacity: active ? 0.98 : 0.42,
                    strokeLinecap: 'round',
                })
            })
        )
    })

    const label = (
        key: string,
        text: string,
        x: number,
        y: number,
        labelWidth: number,
        color: string,
        fontSize = 13,
        fontWeight = 800,
        fontFamily = 'Inter',
    ) => React.createElement('div', {
        key,
        style: {
            position: 'absolute' as const,
            left: x - labelWidth / 2,
            top: y,
            width: labelWidth,
            display: 'flex',
            justifyContent: 'center',
            color,
            fontSize,
            fontWeight,
            fontFamily,
            lineHeight: 1.15,
            textAlign: 'center' as const,
        },
    }, formatMathText(text))

    const titleElements = nodeLayout.map((layer) =>
        label(`title-${layer.title}`, layer.title, layer.x, 20, 120, getToneColor(layer.tone, c), 16, 900)
    )

    const nodeElements = nodeLayout.flatMap((layer, layerIndex) =>
        layer.ys.flatMap((y, nodeIndex) => {
            const active = activePath[layerIndex] === nodeIndex
            const color = getToneColor(layer.tone, c)
            return [
                active && React.createElement('div', {
                    key: `halo-${layerIndex}-${nodeIndex}`,
                    style: {
                        position: 'absolute' as const,
                        left: layer.x - radius - 14,
                        top: y - radius - 14,
                        width: nodeSize + 28,
                        height: nodeSize + 28,
                        borderRadius: 999,
                        backgroundColor: `${c.warningLight}2e`,
                        border: `4px solid ${c.warningLight}`,
                        boxSizing: 'border-box' as const,
                        boxShadow: `0 0 18px ${c.warningLight}66`,
                    },
                }),
                React.createElement('div', {
                    key: `node-${layerIndex}-${nodeIndex}`,
                    style: {
                        position: 'absolute' as const,
                        left: layer.x - radius,
                        top: y - radius,
                        width: nodeSize,
                        height: nodeSize,
                        borderRadius: 999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: color,
                        color: c.textOnColor,
                        border: active ? `3px solid ${c.warningLight}` : `1.5px solid ${color}`,
                        boxSizing: 'border-box' as const,
                        boxShadow: active ? `0 0 16px ${c.warningLight}70` : `0 8px 14px ${c.shadow}`,
                        fontFamily: 'JetBrains Mono',
                        fontSize: 16,
                        fontWeight: 900,
                        lineHeight: 1,
                    },
                }, formatMathText(layer.nodes[nodeIndex])),
            ]
        }).filter(Boolean) as React.ReactElement[]
    )

    const annotationY = showFormula || formula ? height - 84 : height - 26
    const annotationElements = annotations.map((annotation, index) =>
        label(
            `annotation-${index}`,
            annotation,
            (layerXs[index] + layerXs[index + 1]) / 2,
            annotationY,
            132,
            c.textMuted,
            13,
            800,
            'JetBrains Mono'
        )
    )

    const formulaElement = (showFormula || formula) && formula
        ? React.createElement('div', {
            key: 'formula-wrap',
            style: {
                position: 'absolute' as const,
                left: width / 2 - 244,
                top: height - 52,
                width: 488,
                height: 44,
                borderRadius: 10,
                border: `1px solid ${c.borderSubtle}`,
                backgroundColor: c.bgCard,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize: 15,
                fontWeight: 850,
                boxShadow: `0 8px 18px ${c.shadow}`,
            },
        }, formatMathText(formula))
        : null

    const legendElement = (showFormula || formula) && formula
        ? React.createElement('div', {
            key: 'legend-wrap',
            style: {
                position: 'absolute' as const,
                left: width - 184,
                top: height - 43,
                width: 160,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: 12,
                fontWeight: 800,
            },
        },
            React.createElement('div', {
                style: {
                    width: 42,
                    height: 5,
                    borderRadius: 999,
                    backgroundColor: c.warningLight,
                },
            }),
            legend,
        )
        : null

    return React.createElement('div', {
        role: 'img',
        style: {
            width,
            height,
            maxWidth: '100%',
            position: 'relative' as const,
            display: 'flex',
            alignSelf: 'center',
            flexShrink: 0,
        },
    },
        React.createElement('svg', {
            width,
            height,
            viewBox: `0 0 ${width} ${height}`,
            style: {
                position: 'absolute' as const,
                inset: 0,
                overflow: 'visible',
            },
        }, ...connectionElements),
        ...titleElements,
        ...nodeElements,
        ...annotationElements,
        formulaElement,
        legendElement,
    )
}

export interface GraphDiagramNode {
    id: string
    label: string
    detail?: string
    x: number
    y: number
    tone?: ToneName
    muted?: boolean
    width?: number
    height?: number
}

export interface GraphDiagramEdge {
    from: string
    to: string
    tone?: ToneName
    muted?: boolean
    dashed?: boolean
    label?: string
}

interface GraphDiagramProps {
    nodes: GraphDiagramNode[]
    edges: GraphDiagramEdge[]
    c: ThemeColors
    width?: number
    height?: number
    nodeWidth?: number
    nodeHeight?: number
    padding?: number
}

export function GraphDiagram({
    nodes,
    edges,
    c,
    width = 520,
    height = 420,
    nodeWidth = 150,
    nodeHeight = 66,
    padding = 28,
}: GraphDiagramProps): React.ReactElement {
    const layout = new Map(nodes.map((node) => {
        const resolvedWidth = node.width ?? nodeWidth
        const resolvedHeight = node.height ?? nodeHeight
        return [node.id, {
            ...node,
            width: resolvedWidth,
            height: resolvedHeight,
            cx: padding + clamp(node.x, 0, 1) * (width - padding * 2),
            cy: padding + clamp(node.y, 0, 1) * (height - padding * 2),
        }]
    }))

    const edgeLayouts = edges.flatMap((edge, index) => {
        const from = layout.get(edge.from)
        const to = layout.get(edge.to)
        if (!from || !to || (from.cx === to.cx && from.cy === to.cy)) return []

        const dx = to.cx - from.cx
        const dy = to.cy - from.cy
        const absDx = Math.abs(dx)
        const absDy = Math.abs(dy)
        const fromScale = Math.min(
            absDx > 0 ? (from.width / 2) / absDx : Infinity,
            absDy > 0 ? (from.height / 2) / absDy : Infinity,
        )
        const toScale = Math.min(
            absDx > 0 ? (to.width / 2) / absDx : Infinity,
            absDy > 0 ? (to.height / 2) / absDy : Infinity,
        )
        const color = edge.muted ? c.textMuted : getToneColor(edge.tone ?? 'blue', c)
        const markerId = `graph-arrow-${edge.from}-${edge.to}-${index}`.replace(/[^a-zA-Z0-9_-]/g, '-')

        return [{
            ...edge,
            index,
            color,
            markerId,
            x1: from.cx + dx * fromScale,
            y1: from.cy + dy * fromScale,
            x2: to.cx - dx * toScale,
            y2: to.cy - dy * toScale,
        }]
    })

    return React.createElement('div', {
        role: 'img',
        style: {
            position: 'relative' as const,
            display: 'flex',
            width,
            height,
            maxWidth: '100%',
            flexShrink: 0,
        }
    },
        React.createElement('svg', {
            width,
            height,
            viewBox: `0 0 ${width} ${height}`,
            style: { position: 'absolute' as const, inset: 0, overflow: 'visible' },
        },
            React.createElement('defs', {},
                ...edgeLayouts.map((edge) => ArrowMarkerDef({
                    id: edge.markerId,
                    color: edge.color,
                    size: 5,
                }))
            ),
            ...edgeLayouts.map((edge) => React.createElement('line', {
                key: `graph-edge-${edge.index}`,
                x1: edge.x1,
                y1: edge.y1,
                x2: edge.x2,
                y2: edge.y2,
                stroke: edge.color,
                strokeWidth: edge.muted ? 1.6 : 2.8,
                strokeDasharray: edge.dashed ? '7 6' : undefined,
                strokeLinecap: 'round',
                opacity: edge.muted ? 0.48 : 0.9,
                markerEnd: `url(#${edge.markerId})`,
            })),
        ),
        ...edgeLayouts.flatMap((edge) => edge.label ? [
            React.createElement('div', {
                key: `graph-edge-label-${edge.index}`,
                style: {
                    position: 'absolute' as const,
                    left: (edge.x1 + edge.x2) / 2,
                    top: (edge.y1 + edge.y2) / 2,
                    transform: 'translate(-50%, -50%)',
                    padding: '3px 7px',
                    borderRadius: 999,
                    backgroundColor: c.bgCard,
                    border: `1px solid ${c.borderSubtle}`,
                    color: edge.muted ? c.textMuted : edge.color,
                    fontFamily: 'JetBrains Mono',
                    fontSize: 9,
                    fontWeight: 800,
                    lineHeight: 1,
                    whiteSpace: 'nowrap' as const,
                }
            }, edge.label),
        ] : []),
        ...Array.from(layout.values()).map((node) => {
            const accent = node.muted ? c.textMuted : getToneColor(node.tone ?? 'blue', c)
            return React.createElement('div', {
                key: `graph-node-${node.id}`,
                style: {
                    position: 'absolute' as const,
                    left: node.cx - node.width / 2,
                    top: node.cy - node.height / 2,
                    width: node.width,
                    height: node.height,
                    display: 'flex',
                    flexDirection: 'column' as const,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: node.detail ? 5 : 0,
                    padding: '8px 10px',
                    boxSizing: 'border-box' as const,
                    borderRadius: 10,
                    backgroundColor: node.muted ? c.bgSubtle : `${accent}16`,
                    border: `1.5px solid ${node.muted ? c.borderLight : `${accent}88`}`,
                    ...(!node.muted ? { boxShadow: `0 8px 18px ${c.shadow}` } : {}),
                    opacity: node.muted ? 0.62 : 1,
                    color: accent,
                    textAlign: 'center' as const,
                }
            },
                React.createElement('div', {
                    style: {
                        fontFamily: 'Inter',
                        fontSize: 14,
                        fontWeight: 900,
                        lineHeight: 1.15,
                    }
                }, node.label),
                node.detail && React.createElement('div', {
                    style: {
                        color: c.textMuted,
                        fontFamily: 'JetBrains Mono',
                        fontSize: 9,
                        fontWeight: 650,
                        lineHeight: 1.2,
                    }
                }, node.detail),
            )
        }),
    )
}

// ─── CalloutCard — Small highlighted takeaway block ────────────────────────

interface CalloutCardProps {
    c: ThemeColors
    children?: React.ReactNode
    title?: React.ReactNode
    detail?: React.ReactNode
    tone?: ToneName
    width?: number | string
    minHeight?: number | string
    padding?: number | string
    filled?: boolean
    align?: 'left' | 'center'
}

export function CalloutCard({
    c,
    children,
    title,
    detail,
    tone = 'blue',
    width,
    minHeight,
    padding = 12,
    filled = true,
    align = 'center',
}: CalloutCardProps): React.ReactElement {
    const accent = getToneColor(tone, c)
    const textAlign = align

    return React.createElement('div', {
        style: {
            ...(width != null ? { width } : {}),
            ...(minHeight != null ? { minHeight } : {}),
            padding,
            borderRadius: 10,
            boxSizing: 'border-box' as const,
            ...(filled
                ? { backgroundImage: getToneGradient(tone), color: c.textOnColor, border: `1px solid ${accent}00` }
                : { backgroundColor: c.bgCard, color: c.textPrimary, border: `1px solid ${accent}66` }),
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: align === 'center' ? 'center' : 'flex-start',
            justifyContent: 'center',
            gap: detail ? 5 : 0,
            boxShadow: `0 10px 24px ${c.shadow}`,
            textAlign,
        }
    },
        ...compactChildren([
        title && React.createElement('div', {
            style: {
                ...typography.small,
                color: filled ? c.textOnColor : accent,
                fontWeight: 900,
                lineHeight: 1.2,
                textAlign,
            }
        }, title),
        detail && React.createElement('div', {
            style: {
                ...typography.tiny,
                color: filled ? 'rgba(255,255,255,0.84)' : c.textSecondary,
                lineHeight: 1.3,
                textAlign,
            }
        }, detail),
        children && React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                alignItems: align === 'center' ? 'center' : 'flex-start',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1.3,
                textAlign,
            }
        }, children),
        ])
    )
}

// ─── Pipeline — Horizontal flow with arrows between stages ──────────────────

interface PipelineStage {
    label: string
    sublabel?: string
    icon?: string
    color?: ColorName
}

interface PipelineProps {
    stages: PipelineStage[]
    c: ThemeColors
    title?: string
}

export function Pipeline({ stages, c, title }: PipelineProps): React.ReactElement {
    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            gap: 20,
        }
    },
        title && React.createElement('div', {
            style: { ...typography.label, color: c.textPrimary }
        }, title),

        React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: 0,
            }
        },
            ...stages.flatMap((stage, i) => {
                const elements: React.ReactElement[] = []

                elements.push(
                    Box({
                        label: stage.label,
                        sublabel: stage.sublabel,
                        icon: stage.icon,
                        color: stage.color || 'primary',
                        gradient: true,
                        c,
                        fontSize: 13,
                    })
                )

                if (i < stages.length - 1) {
                    elements.push(
                        Arrow({ direction: 'right', length: 36, c })
                    )
                }

                return elements
            }),
        ),
    )
}

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
                                color: colorScale === 'strength' && value < 0.34 ? c.textSecondary : c.textOnColor,
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
        'label' in cell || 'tone' in cell || 'backgroundColor' in cell || 'borderColor' in cell
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

function chartColor(color: ColorName | string | undefined, c: ThemeColors, index = 0): string {
    if (!color) return getColor(chartPalette[index % chartPalette.length], c)
    return isColorName(color) ? getColor(color, c) : color
}

function formatChartValue(value: number, format: ChartValueFormat = 'decimal'): string {
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

function chartDomain(values: number[], min?: number, max?: number): { min: number; max: number; range: number } {
    const rawMin = min ?? Math.min(0, ...values)
    const rawMax = max ?? Math.max(...values, 1)
    const range = rawMax === rawMin ? 1 : rawMax - rawMin
    return { min: rawMin, max: rawMax, range }
}

function chartTicks(min: number, max: number, count = 4): number[] {
    if (count <= 1) return [min]
    const step = (max - min) / (count - 1)
    return Array.from({ length: count }, (_, index) => min + step * index)
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
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

function xInPlot(value: number, domain: { min: number; range: number }, plot: PlotArea): number {
    return scaleToRange(value, domain.min, domain.range, plot.x, plot.innerWidth)
}

function yInPlot(value: number, domain: { min: number; range: number }, plot: PlotArea): number {
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

function chartLabel(
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

function pointLabelPlacement(
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
    const margin: ChartMargins = { top: 18, right: 18, bottom: 40, left: yAxisLabel ? 52 : 38 }
    const plot = createPlotArea(width, height, margin)
    const domain = chartDomain(data.map((item) => item.value), min, max)
    const ticks = chartTicks(domain.min, domain.max, 4)
    const barGap = Math.max(8, plot.innerWidth / Math.max(data.length, 1) * 0.18)
    const barWidth = Math.max(12, (plot.innerWidth - barGap * (data.length - 1)) / Math.max(data.length, 1))
    const zeroY = yInPlot(0, domain, plot)
    const baselineY = clamp(zeroY, plot.y, plot.bottom)

    const barGeometries = data.map((item, index) => {
        const x = plot.x + index * (barWidth + barGap)
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
    const xStep = maxPoints <= 1 ? plot.innerWidth : plot.innerWidth / (maxPoints - 1)
    const ticks = chartTicks(domain.min, domain.max, 4)

    const pointFor = (value: number, index: number) => {
        const x = plot.x + index * xStep
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
                    const areaPath = item.area && item.points.length > 1
                        ? `${linePath} L ${plot.x + (item.points.length - 1) * xStep} ${plot.bottom} L ${plot.x} ${plot.bottom} Z`
                        : ''
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
            ...(labels ?? []).map((label, index, allLabels) => {
                const x = plot.x + index * xStep
                const align = index === 0 ? 'left' : index === (allLabels.length - 1) ? 'right' : 'center'
                return chartLabel(`line-x-${label}`, label, x, height - 14, c, { align, width: 72 })
            }),
        )
    })
}

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
