/**
 * Vizmatic — Brand
 *
 * Adds a small theme-aware watermark to rendered artifacts.
 */

import React, { type ReactNode } from 'react'

export type WatermarkPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface WatermarkImageOptions {
    src: string
    width?: number
    height?: number
    alt?: string
}

export interface WatermarkOptions {
    text?: string | false
    image?: string | WatermarkImageOptions
    icon?: ReactNode | string | false
    element?: ReactNode
    position?: WatermarkPosition
    opacity?: number
    color?: string
}

export interface WatermarkElementProps extends WatermarkOptions {
    children?: ReactNode
}

export type WatermarkInput = boolean | string | WatermarkOptions | React.ReactElement<WatermarkElementProps>

const DEFAULT_WATERMARK_TEXT = 'Vizmatic'
const WATERMARK_COLOR_DARK = '#a78bfa'
const WATERMARK_COLOR_LIGHT = '#7c3aed'

/**
 * Compact Vizmatic frame-grid mark. Kept as JSX so Satori can embed it in PNG,
 * SVG, and GIF renders without reading external assets.
 */
function VizmaticIcon({ size = 14, color }: { size?: number; color: string }): React.ReactElement {
    return React.createElement('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: size,
        height: size,
        viewBox: '0 0 28 28',
        fill: 'none',
    },
        React.createElement('rect', { x: 2.5, y: 2.5, width: 23, height: 23, rx: 6.5, stroke: color, strokeWidth: 2, opacity: 0.54 }),
        React.createElement('rect', { x: 7, y: 7, width: 5.5, height: 5.5, rx: 1.8, fill: color, opacity: 0.35 }),
        React.createElement('rect', { x: 15.5, y: 7, width: 5.5, height: 5.5, rx: 1.8, fill: color }),
        React.createElement('rect', { x: 7, y: 15.5, width: 5.5, height: 5.5, rx: 1.8, fill: color, opacity: 0.82 }),
        React.createElement('rect', { x: 15.5, y: 15.5, width: 5.5, height: 5.5, rx: 1.8, stroke: color, strokeWidth: 1.5, opacity: 0.72 }),
        React.createElement('path', { d: 'M9.75 9.75h8.5M9.75 18.25h8.5M9.75 9.75v8.5M18.25 9.75v8.5', stroke: color, strokeWidth: 1.6, strokeLinecap: 'round', opacity: 0.88 }),
    )
}

export function normalizeWatermark(watermark: WatermarkInput | undefined): WatermarkOptions | undefined {
    if (watermark == null || watermark === false) return undefined
    if (watermark === true) return {}
    if (typeof watermark === 'string') return { text: watermark }
    if (React.isValidElement<WatermarkElementProps>(watermark)) {
        if (watermark.type !== Watermark) return { element: watermark }
        const { children, ...props } = watermark.props
        return {
            ...props,
            element: children ?? props.element,
        }
    }
    return watermark
}

export function Watermark(_props: WatermarkElementProps): null {
    return null
}

function positionStyle(position: WatermarkPosition): React.CSSProperties {
    switch (position) {
        case 'top-left':
            return { top: 8, left: 10 }
        case 'bottom-left':
            return { bottom: 8, left: 10 }
        case 'bottom-right':
            return { bottom: 8, right: 10 }
        case 'top-right':
        default:
            return { top: 8, right: 10 }
    }
}

function imageNode(image: WatermarkOptions['image']): ReactNode {
    if (!image) return undefined
    const imageOptions = typeof image === 'string' ? { src: image } : image

    return React.createElement('img', {
        src: imageOptions.src,
        alt: imageOptions.alt ?? '',
        width: imageOptions.width ?? 14,
        height: imageOptions.height ?? 14,
        style: {
            display: 'block',
            width: imageOptions.width ?? 14,
            height: imageOptions.height ?? 14,
            objectFit: 'contain' as const,
        },
    })
}

function iconNode(icon: WatermarkOptions['icon'], color: string): ReactNode {
    if (icon === false) return undefined
    if (icon == null) return React.createElement(VizmaticIcon, { size: 13, color })
    if (typeof icon !== 'string') return icon

    return React.createElement('div', {
        style: {
            minWidth: 13,
            height: 13,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color,
            fontSize: icon.length > 2 ? 8 : 10,
            fontWeight: 800,
            fontFamily: 'Inter',
            lineHeight: 1,
        },
    }, icon)
}

/**
 * Wrap an illustration element with a watermark overlay.
 */
export function wrapWithWatermark(
    element: React.ReactNode,
    width: number,
    height: number,
    theme: 'dark' | 'light' = 'dark',
    watermark: WatermarkInput = true,
): React.ReactElement {
    const isDark = theme === 'dark'
    const options = normalizeWatermark(watermark)
    const color = options?.color ?? (isDark ? WATERMARK_COLOR_DARK : WATERMARK_COLOR_LIGHT)
    const position = options?.position ?? 'top-right'
    const opacity = options?.opacity ?? (isDark ? 0.55 : 0.40)
    const icon = options ? imageNode(options.image) ?? iconNode(options.icon, color) : undefined
    const text = options?.text ?? DEFAULT_WATERMARK_TEXT
    const content = options?.element ?? [
        icon,
        text !== false && text && React.createElement('div', {
            key: 'text',
            style: {
                fontSize: 11,
                fontWeight: 600,
                color,
                fontFamily: 'Inter',
                letterSpacing: 0.3,
            },
        }, text),
    ]

    return React.createElement('div', {
        style: {
            width,
            height,
            display: 'flex',
            position: 'relative' as const,
        }
    },
        element,
        options && React.createElement('div', {
            style: {
                position: 'absolute' as const,
                ...positionStyle(position),
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                opacity,
            },
        },
            content,
        ),
    )
}

export function wrapWithBrand(
    element: React.ReactNode,
    width: number,
    height: number,
    theme: 'dark' | 'light' = 'dark',
    label = DEFAULT_WATERMARK_TEXT,
): React.ReactElement {
    return wrapWithWatermark(element, width, height, theme, label)
}
