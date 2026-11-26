import React from 'react'
import { densityOf, type ThemeColors } from './theme'
import { renderMathSvg } from './math'

export interface MathSvgProps {
    tex: string
    c?: ThemeColors
    fontSize?: number
    color?: string
    display?: boolean
    style?: React.CSSProperties
}

/** Satori-safe LaTeX equation primitive backed by MathJax SVG (Node/TSX renderer). */
export function MathSvg({
    tex,
    c,
    fontSize: fontSizeProp,
    color,
    display = false,
    style,
}: MathSvgProps): React.ReactElement {
    const fontSize = fontSizeProp ?? densityOf(c).f(15)
    const resolvedColor = color ?? c?.textPrimary ?? '#f2efe6'
    const rendered = renderMathSvg(tex, {
        fontSize,
        color: resolvedColor,
        display,
    })
    const width = Math.ceil(rendered.width)
    const height = Math.ceil(rendered.height)
    const src = `data:image/svg+xml;utf8,${encodeURIComponent(rendered.svg)}`
    return React.createElement('img', {
        src,
        alt: tex,
        width,
        height,
        style: { display: 'flex', flexShrink: 0, ...style },
    })
}
