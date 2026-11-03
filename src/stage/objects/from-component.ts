import type { ReactNode } from 'react'
import { renderToSvg, type RenderBackground } from '../../render'
import type { ThemeMode } from '../../theme'
import { fromSvg, type FromSvgOptions, type SvgNode } from '../svg-import'

export interface FromComponentOptions extends FromSvgOptions {
    /** Layout size of the component, in pixels. */
    width: number
    height: number
    theme?: ThemeMode
    /** Canvas behind the component. Transparent by default, so it sits on the film. */
    canvas?: RenderBackground
    /** Scale on stage. Layout stays at `width` and `height`, so dense text stays small. */
    scale?: number
}

/**
 * Render any Vizmatic TSX component and return it as animatable vector nodes, so
 * every existing diagram and chart can be written on, faded, and morphed.
 * It runs in Node only, because it needs the layout engine:
 *
 *   const flow = await fromComponent(<Flow c={c} stages={stages} />, { width: 900, height: 300 })
 *   s.play(write(flow))
 */
export async function fromComponent(element: ReactNode, options: FromComponentOptions): Promise<SvgNode> {
    const { width, height, theme, canvas, scale, ...rest } = options
    const svg = await renderToSvg(element, width, height, { theme: theme ?? 'dark', background: canvas, watermark: false })
    return fromSvg(svg, { ...rest, width: width * (scale ?? 1), height: height * (scale ?? 1) })
}
