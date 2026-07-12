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

