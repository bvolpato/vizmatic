import React, { type ReactNode } from 'react'
import * as primitives from './primitives'
import { SCENE_COMPONENT_NAMES, SCENE_DOM_TAGS } from './scene-components'
import { SCENE_LIMITS, type SceneElement, type SceneJson } from './scene-contract'
import { isValidSceneStyleProperty, validateResolvedSceneResources } from './scene-graph'
import type { ThemeColors } from './theme'

export interface RasterBudget {
    pixels: number
    count: number
    nodes: number
    svgBytes: number
}

export function createRasterBudget(): RasterBudget {
    return { pixels: 0, count: 0, nodes: 0, svgBytes: 0 }
}

const trustedComponents: Record<string, React.ElementType | undefined> = Object.fromEntries(
    SCENE_COMPONENT_NAMES.map((name) => [name, primitives[name]]),
)
const svgTags = new Set<string>(
    SCENE_DOM_TAGS.filter((name) => !['div', 'span', 'p', 'strong', 'em', 'b', 'i', 'br'].includes(name)),
)

function isElement(value: SceneJson): value is SceneJson & SceneElement {
    return Boolean(value && !Array.isArray(value) && typeof value === 'object' && value.kind === 'vizmatic.element')
}

function xmlEscape(value: string | number): string {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
    })[character]!)
}

function svgAttribute(name: string): string {
    if (name === 'className') return 'class'
    if (name === 'xlinkHref') return 'href'
    if (/^(?:viewBox|preserveAspectRatio|gradientUnits|gradientTransform|patternUnits|patternContentUnits|patternTransform|markerWidth|markerHeight|markerUnits|refX|refY|textLength|lengthAdjust|clipPathUnits)$/.test(name)) return name
    return name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
}

/** Serialize a resolved SVG React tree inside a bounded scene byte/node budget. */
export function serializeSceneSvg(
    node: ReactNode,
    budget: RasterBudget,
    utf8Length: (chunk: string) => number,
    depth = 0,
): string {
    if (++budget.nodes > SCENE_LIMITS.nodes * 16) throw new Error('Resolved scene exceeds its host element budget.')
    if (depth > SCENE_LIMITS.depth * 2) throw new Error('Resolved SVG exceeds its depth limit.')
    const emit = (chunk: string): string => {
        budget.svgBytes += utf8Length(chunk)
        if (budget.svgBytes > SCENE_LIMITS.graphBytes * 4) throw new Error('Resolved SVG exceeds its serialized byte budget.')
        return chunk
    }
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return emit(xmlEscape(node))
    if (Array.isArray(node)) return node.map((child) => serializeSceneSvg(child, budget, utf8Length, depth + 1)).join('')
    if (!React.isValidElement<Record<string, unknown>>(node)) throw new Error('Invalid resolved SVG child.')
    if (node.type === React.Fragment) return serializeSceneSvg(node.props.children as ReactNode, budget, utf8Length, depth + 1)
    if (node.type === primitives.SvgMathText) {
        const { text, x, y, fill, fontSize = 13, fontFamily = 'JetBrains Mono', fontWeight = 700, textAnchor = 'middle', dominantBaseline = 'middle', opacity = 1 } = node.props
        return serializeSceneSvg(React.createElement('text', { x, y, fill, fontSize, fontFamily, fontWeight, textAnchor, dominantBaseline, opacity }, String(text)), budget, utf8Length, depth + 1)
    }
    if (typeof node.type === 'function') {
        return serializeSceneSvg((node.type as (props: Record<string, unknown>) => ReactNode)(node.props), budget, utf8Length, depth + 1)
    }
    if (typeof node.type !== 'string' || !svgTags.has(node.type)) throw new Error('Only SVG components may be placed inside an SVG scene.')
    validateResolvedSceneResources(node.props)
    const attributes = Object.entries(node.props).filter(([key, value]) => key !== 'children' && key !== 'key' && value !== undefined && value !== null)
        .map(([key, value]) => {
            if (key === 'style' && typeof value === 'object') {
                if (Array.isArray(value)) throw new Error('Unsupported SVG style attribute.')
                const style = Object.entries(value as Record<string, unknown>)
                    .filter(([, item]) => item !== undefined && item !== null)
                    .map(([property, item]) => {
                        if (!isValidSceneStyleProperty(property) || typeof item === 'object' || typeof item === 'function' || /[;{}]/.test(String(item))) {
                            throw new Error(`Scene style property ${JSON.stringify(property)} is not allowed.`)
                        }
                        return `${svgAttribute(property)}:${String(item)}`
                    }).join(';')
                return ` style="${xmlEscape(style)}"`
            }
            if (!/^[A-Za-z_][\w:.-]*$/.test(key) || typeof value === 'object' || typeof value === 'function') throw new Error('Unsupported SVG attribute.')
            return ` ${svgAttribute(key)}="${xmlEscape(String(value))}"`
        }).join('')
    return emit(`<${node.type}${attributes}>`) + serializeSceneSvg(node.props.children as ReactNode, budget, utf8Length, depth + 1) + emit(`</${node.type}>`)
}

/** Convert an evaluated JSON scene graph into host React elements backed by trusted primitives. */
export function sceneGraphToReact(value: SceneJson, theme: ThemeColors): ReactNode {
    if (Array.isArray(value)) return value.map((child) => sceneGraphToReact(child, theme))
    if (!isElement(value)) return value as ReactNode
    const convertProp = (prop: SceneJson): unknown => {
        if (isElement(prop)) return sceneGraphToReact(prop, theme)
        if (Array.isArray(prop)) return prop.map(convertProp)
        if (prop && typeof prop === 'object') return Object.fromEntries(Object.entries(prop).map(([key, item]) => [key, convertProp(item)]))
        return prop
    }
    const props = Object.fromEntries(Object.entries(value.props).map(([name, prop]) => [name, convertProp(prop)]))
    const component = trustedComponents[value.type]
    if (component) props.c ??= theme
    return React.createElement((component ?? value.type) as React.ElementType, props, ...value.children.map((child) => sceneGraphToReact(child, theme)))
}

/**
 * Validate nested SVG dimensions, permitting finite positive fractional dimensions produced
 * by scaled density tokens (for example 13.5px) while bounding the integer raster size.
 */
export function resolveNestedSvgSize(
    widthProp: unknown,
    heightProp: unknown,
    defaultWidth: number,
    defaultHeight: number,
): { width: number; height: number; rasterWidth: number; rasterHeight: number } {
    const width = typeof widthProp === 'number' ? widthProp : defaultWidth
    const height = typeof heightProp === 'number' ? heightProp : defaultHeight
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
        || width > SCENE_LIMITS.canvasEdge || height > SCENE_LIMITS.canvasEdge) {
        throw new Error('Nested SVG dimensions exceed the scene canvas limits.')
    }
    const rasterWidth = Math.max(1, Math.ceil(width))
    const rasterHeight = Math.max(1, Math.ceil(height))
    if (rasterWidth > SCENE_LIMITS.canvasEdge || rasterHeight > SCENE_LIMITS.canvasEdge
        || rasterWidth * rasterHeight > SCENE_LIMITS.canvasPixels) {
        throw new Error('Nested SVG dimensions exceed the scene canvas limits.')
    }
    return { width, height, rasterWidth, rasterHeight }
}
