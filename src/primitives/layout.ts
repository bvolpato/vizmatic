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
} from '../theme'
import { getRenderBackground } from '../renderContext'

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

export type FlexAlign = 'start' | 'center' | 'end' | 'stretch'
export type FlexJustify = 'start' | 'center' | 'end' | 'space-between' | 'space-around'

export function flexAlign(align: FlexAlign): React.CSSProperties['alignItems'] {
    return {
        start: 'flex-start',
        center: 'center',
        end: 'flex-end',
        stretch: 'stretch',
    }[align] as React.CSSProperties['alignItems']
}

export function flexJustify(justify: FlexJustify): React.CSSProperties['justifyContent'] {
    return {
        start: 'flex-start',
        center: 'center',
        end: 'flex-end',
        'space-between': 'space-between',
        'space-around': 'space-around',
    }[justify] as React.CSSProperties['justifyContent']
}

type TextFitAlign = 'left' | 'center' | 'right'

export function textFitStyle(align: TextFitAlign = 'left'): React.CSSProperties {
    return {
        minWidth: 0,
        maxWidth: '100%',
        whiteSpace: 'normal' as const,
        overflowWrap: 'break-word' as const,
        textAlign: align,
    }
}

export function compactChildren(children: React.ReactNode[]): React.ReactNode[] {
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

export type IconName =
    | 'agent'
    | 'chart'
    | 'check'
    | 'code'
    | 'database'
    | 'file'
    | 'git'
    | 'globe'
    | 'image'
    | 'layers'
    | 'lock'
    | 'play'
    | 'spark'
    | 'terminal'
    | 'tool'
    | 'warning'

type IconShape = {
    tag: 'circle' | 'line' | 'path' | 'polyline' | 'rect'
    attrs: Record<string, string | number>
}

const iconShapes: Record<IconName, IconShape[]> = {
    agent: [
        { tag: 'rect', attrs: { x: 5, y: 7, width: 14, height: 12, rx: 4 } },
        { tag: 'path', attrs: { d: 'M12 7V4' } },
        { tag: 'circle', attrs: { cx: 12, cy: 3, r: 1 } },
        { tag: 'circle', attrs: { cx: 9, cy: 13, r: 1 } },
        { tag: 'circle', attrs: { cx: 15, cy: 13, r: 1 } },
        { tag: 'path', attrs: { d: 'M9 17h6' } },
    ],
    chart: [
        { tag: 'path', attrs: { d: 'M4 19V5' } },
        { tag: 'path', attrs: { d: 'M4 19h16' } },
        { tag: 'polyline', attrs: { points: '7 15 11 11 14 13 19 7' } },
    ],
    check: [{ tag: 'polyline', attrs: { points: '20 6 9 17 4 12' } }],
    code: [
        { tag: 'polyline', attrs: { points: '8 9 4 12 8 15' } },
        { tag: 'polyline', attrs: { points: '16 9 20 12 16 15' } },
        { tag: 'path', attrs: { d: 'M13 5l-2 14' } },
    ],
    database: [
        { tag: 'path', attrs: { d: 'M4 7c0-2 16-2 16 0s-16 2-16 0Z' } },
        { tag: 'path', attrs: { d: 'M4 7v5c0 2 16 2 16 0V7' } },
        { tag: 'path', attrs: { d: 'M4 12v5c0 2 16 2 16 0v-5' } },
    ],
    file: [
        { tag: 'path', attrs: { d: 'M6 3h8l4 4v14H6Z' } },
        { tag: 'path', attrs: { d: 'M14 3v5h5' } },
        { tag: 'path', attrs: { d: 'M9 13h6' } },
        { tag: 'path', attrs: { d: 'M9 17h4' } },
    ],
    git: [
        { tag: 'circle', attrs: { cx: 6, cy: 6, r: 2 } },
        { tag: 'circle', attrs: { cx: 18, cy: 18, r: 2 } },
        { tag: 'circle', attrs: { cx: 6, cy: 18, r: 2 } },
        { tag: 'path', attrs: { d: 'M8 6h3a5 5 0 0 1 5 5v5' } },
        { tag: 'path', attrs: { d: 'M6 8v8' } },
    ],
    globe: [
        { tag: 'circle', attrs: { cx: 12, cy: 12, r: 9 } },
        { tag: 'path', attrs: { d: 'M3 12h18' } },
        { tag: 'path', attrs: { d: 'M12 3a14 14 0 0 1 0 18' } },
        { tag: 'path', attrs: { d: 'M12 3a14 14 0 0 0 0 18' } },
    ],
    image: [
        { tag: 'rect', attrs: { x: 4, y: 5, width: 16, height: 14, rx: 3 } },
        { tag: 'circle', attrs: { cx: 9, cy: 10, r: 1.5 } },
        { tag: 'polyline', attrs: { points: '7 17 11 13 14 16 16 14 20 18' } },
    ],
    layers: [
        { tag: 'path', attrs: { d: 'M12 3 3 8l9 5 9-5Z' } },
        { tag: 'path', attrs: { d: 'm3 13 9 5 9-5' } },
        { tag: 'path', attrs: { d: 'm3 18 9 5 9-5' } },
    ],
    lock: [
        { tag: 'rect', attrs: { x: 5, y: 10, width: 14, height: 10, rx: 2 } },
        { tag: 'path', attrs: { d: 'M8 10V7a4 4 0 0 1 8 0v3' } },
    ],
    play: [{ tag: 'path', attrs: { d: 'M8 5v14l11-7Z' } }],
    spark: [
        { tag: 'path', attrs: { d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z' } },
        { tag: 'path', attrs: { d: 'M5 16l.8 2.2L8 19l-2.2.8L5 22l-.8-2.2L2 19l2.2-.8Z' } },
    ],
    terminal: [
        { tag: 'polyline', attrs: { points: '5 7 10 12 5 17' } },
        { tag: 'path', attrs: { d: 'M12 17h7' } },
    ],
    tool: [
        { tag: 'path', attrs: { d: 'M14 6a5 5 0 0 0 6 6L11 21l-6-6 9-9Z' } },
        { tag: 'path', attrs: { d: 'M8 18l-2-2' } },
    ],
    warning: [
        { tag: 'path', attrs: { d: 'M12 4 22 20H2Z' } },
        { tag: 'path', attrs: { d: 'M12 9v5' } },
        { tag: 'path', attrs: { d: 'M12 17h.01' } },
    ],
}

export interface IconProps {
    c: ThemeColors
    name: IconName
    tone?: ToneName
    color?: string
    size?: number
    strokeWidth?: number
    label?: string
    muted?: boolean
}

export function Icon({
    c,
    name,
    tone = 'blue',
    color,
    size = 24,
    strokeWidth = 2,
    label,
    muted = false,
}: IconProps): React.ReactElement {
    const stroke = muted ? c.textMuted : (color ?? getToneColor(tone, c))
    const shapes = iconShapes[name]

    return React.createElement('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke,
        strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        role: label ? 'img' : undefined,
        'aria-hidden': label ? undefined : 'true',
        'aria-label': label,
        style: { flex: `0 0 ${size}px` },
    }, shapes.map((shape, index) => React.createElement(shape.tag, {
        key: `${name}-${index}`,
        ...shape.attrs,
    })))
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
                gap,
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

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

