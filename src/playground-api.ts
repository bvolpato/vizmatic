import React from 'react'
import { Watermark, wrapWithWatermark } from './brand'
import * as primitives from './primitives'
import * as themeApi from './theme'
import { SVG_ACCESSIBILITY_COMPONENT } from './svg-accessibility'

type PlaygroundApi = Record<string, unknown>
type ThemeColors = ReturnType<typeof themeApi.getThemeColors>

const SVG_PRIMITIVES = new Set([
    'ArrowMarkerDef',
    'SvgFrame',
    'SvgPoint',
    'VectorArrow',
    'VectorSegment',
])

function withTheme(Component: unknown, c: ThemeColors): unknown {
    if (typeof Component !== 'function') return Component

    const themedComponent = function VizmaticPlaygroundTheme(props: Record<string, unknown> | null) {
        return React.createElement(Component as React.ComponentType<Record<string, unknown>>, props?.c ? props : { ...props, c })
    }
    if ((Component as { [SVG_ACCESSIBILITY_COMPONENT]?: boolean })[SVG_ACCESSIBILITY_COMPONENT]) {
        Object.defineProperty(themedComponent, SVG_ACCESSIBILITY_COMPONENT, { value: true })
    }
    return themedComponent
}

function withThemeCall(Component: unknown, c: ThemeColors): unknown {
    if (typeof Component !== 'function') return Component

    return function VizmaticPlaygroundThemeCall(props: Record<string, unknown> | null) {
        return (Component as (props: Record<string, unknown>) => unknown)(props?.c ? props : { ...props, c })
    }
}

export function createPlaygroundApi(c: ThemeColors): PlaygroundApi {
    const api: PlaygroundApi = { ...themeApi, ...primitives, Watermark, wrapWithWatermark }
    const scoped: PlaygroundApi = {}

    for (const [name, value] of Object.entries(api)) {
        if (!/^[A-Z]/.test(name) || name === 'Watermark' || name === 'MathText') {
            scoped[name] = value
        } else if (name === 'DotPoint' || name === 'DashedLine' || SVG_PRIMITIVES.has(name)) {
            scoped[name] = withThemeCall(value, c)
        } else {
            scoped[name] = withTheme(value, c)
        }
    }

    return scoped
}
