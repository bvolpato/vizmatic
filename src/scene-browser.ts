import React, { type ReactElement, type ReactNode } from 'react'
import { Resvg, initWasm, type ResvgRenderOptions } from '@resvg/resvg-wasm'
import type satori from 'satori/standalone'
import type { Font } from 'satori/standalone'
import * as primitives from './primitives'
import { withRenderContext } from './playground-render-context'
import { prepareAccessibleSvg, addSvgAccessibility } from './svg-accessibility'
import { prepareScene, type PreparedScene } from './scene-runtime'
import { initializeBrowserQuickJS } from './scene-browser-quickjs'
import { createRetryableInitializer } from './retryable-initializer'
import {
    normalizeSceneTime, sceneSha256, SCENE_LIMITS, SCENE_RUNTIME_VERSION,
    type SceneElement, type SceneJson, type SceneRequest,
} from './scene-contract'
import { SCENE_COMPONENT_NAMES, SCENE_DOM_TAGS } from './scene-components'
import { validateResolvedSceneResources } from './scene-graph'
import { getThemeColors } from './theme'
import { SCENE_BROWSER_FONT_PINS, SCENE_BROWSER_WASM_PINS, SCENE_BROWSER_EMOJI_SHA256 } from './scene-browser-pins'

export { SCENE_BROWSER_FONT_PINS, SCENE_BROWSER_WASM_PINS, SCENE_BROWSER_EMOJI_SHA256 } from './scene-browser-pins'
export { SCENE_RUNTIME_VERSION, SCENE_LIMITS } from './scene-contract'
export type { SceneRequest } from './scene-contract'

export interface BrowserSceneAssets {
    quickjsWasm: ArrayBuffer
    /** A loader defers the layout engine and its WASM until a non-SVG scene needs it. */
    layoutWasm: ArrayBuffer | (() => Promise<ArrayBuffer>)
    resvgWasm: ArrayBuffer
    fonts: Record<keyof typeof SCENE_BROWSER_FONT_PINS, ArrayBuffer>
    /** Pinned offline emoji, loaded only if Satori encounters an emoji glyph. */
    emoji?: Record<string, string> | (() => Promise<Record<string, string>>)
}

export interface BrowserSceneFrame {
    /** Owned RGBA bytes. Its buffer may be transferred without detaching WASM memory. */
    pixels: Uint8Array
    width: number
    height: number
    time: number
    sourceSha256: string
    inputSha256: string
    runtimeVersion: string
    timings: { evaluateMs: number; rasterMs: number; totalMs: number }
}

export interface PreparedBrowserScene {
    request: PreparedScene['request']
    sourceSha256: string
    inputSha256: string
    width: number
    height: number
    /** Compile once, then evaluate each time in a fresh bounded QuickJS VM. */
    render(time?: number): Promise<BrowserSceneFrame>
}

export interface BrowserSceneRenderer {
    prepare(request: SceneRequest, options?: { outputScale?: number }): Promise<PreparedBrowserScene>
}

interface BrowserRasterAssets {
    fonts: Font[]
    fontOptions: NonNullable<ResvgRenderOptions['font']>
    emoji(): Promise<Record<string, string>>
    layout: typeof satori
}

const initializeRasterizer = createRetryableInitializer(initWasm)
// Primitive render context is scoped to a worker rather than Node AsyncLocalStorage.
// Serialize overlapping callers so it cannot leak between asynchronous Satori frames.
let renderTail: Promise<unknown> = Promise.resolve()

function serializeRender<T>(render: () => Promise<T>): Promise<T> {
    const result = renderTail.then(render, render)
    renderTail = result.catch(() => undefined)
    return result
}

export async function createBrowserSceneRenderer(assets: BrowserSceneAssets): Promise<BrowserSceneRenderer> {
    await Promise.all([
        ...(['quickjsWasm', 'resvgWasm'] as const).map(async (name) => {
            const bytes = assets[name as keyof typeof SCENE_BROWSER_WASM_PINS]
            if (!(bytes instanceof ArrayBuffer) || await sceneSha256(new Uint8Array(bytes)) !== SCENE_BROWSER_WASM_PINS[name]) {
                throw new Error(`Pinned browser scene asset does not match: ${name}`)
            }
        }),
        ...Object.entries(SCENE_BROWSER_FONT_PINS).map(async ([name, expected]) => {
            const bytes = assets.fonts?.[name as keyof typeof SCENE_BROWSER_FONT_PINS]
            if (!(bytes instanceof ArrayBuffer) || await sceneSha256(new Uint8Array(bytes)) !== expected) {
                throw new Error(`Pinned browser scene font does not match: ${name}`)
            }
        }),
    ])
    await Promise.all([
        initializeBrowserQuickJS(assets.quickjsWasm),
        initializeRasterizer(assets.resvgWasm),
    ])
    const definitions: Array<[string, keyof typeof SCENE_BROWSER_FONT_PINS, 400 | 600 | 700]> = [
        ['Inter', 'interRegular', 400], ['Inter', 'interSemiBold', 600], ['Inter', 'interBold', 700],
        ['JetBrains Mono', 'jetBrainsMono', 400], ['Noto Sans', 'notoSans', 400], ['Noto Sans Math', 'notoSansMath', 400],
    ]
    let emojiPromise: Promise<Record<string, string>> | undefined
    let layoutPromise: Promise<typeof satori> | undefined
    const layout = (): Promise<typeof satori> => {
        layoutPromise ??= Promise.all([
            import('./scene-browser-layout'),
            Promise.resolve().then(() => typeof assets.layoutWasm === 'function' ? assets.layoutWasm() : assets.layoutWasm),
        ]).then(async ([module, bytes]) => {
            if (!(bytes instanceof ArrayBuffer) || await sceneSha256(new Uint8Array(bytes)) !== SCENE_BROWSER_WASM_PINS.layoutWasm) {
                throw new Error('Pinned browser scene asset does not match: layoutWasm')
            }
            return module.initializeBrowserLayout(bytes)
        }).catch((error: unknown) => { layoutPromise = undefined; throw error })
        return layoutPromise
    }
    const rasterAssets: BrowserRasterAssets = {
        fonts: definitions.map(([name, key, weight]) => ({ name, weight, style: 'normal', data: assets.fonts[key] })),
        fontOptions: { fontBuffers: definitions.map(([, key]) => new Uint8Array(assets.fonts[key])), defaultFontFamily: 'Inter' },
        layout: async (element, options) => (await layout())(element, options),
        emoji: () => {
            emojiPromise ??= Promise.resolve().then(async () => {
                if (!assets.emoji) return {}
                const emoji = typeof assets.emoji === 'function' ? await assets.emoji() : assets.emoji
                if (await sceneSha256(JSON.stringify(emoji)) !== SCENE_BROWSER_EMOJI_SHA256) {
                    throw new Error('Pinned browser scene emoji does not match.')
                }
                return emoji
            })
                .catch((error: unknown) => { emojiPromise = undefined; throw error })
            return emojiPromise
        },
    }
    return {
        async prepare(request, { outputScale = 1 } = {}) {
            const prepared = await prepareScene(request)
            const width = prepared.request.width * outputScale, height = prepared.request.height * outputScale
            if (!Number.isFinite(outputScale) || outputScale < 0.25 || outputScale > 1
                || ![width, height].every((value) => Number.isInteger(value) && value >= 2 && value % 2 === 0)) {
                throw new Error('Browser scene outputScale must be from 0.25 to 1 and produce positive even dimensions.')
            }
            let lastGraph: string | undefined, lastPixels: Uint8Array | undefined
            return {
                request: prepared.request, sourceSha256: prepared.sourceSha256, inputSha256: prepared.inputSha256, width, height,
                render: (requestedTime = 0) => serializeRender(async () => {
                    const time = normalizeSceneTime(requestedTime, prepared.request.duration)
                    const started = performance.now()
                    const evaluated = await prepared.evaluate(time)
                    const evaluatedAt = performance.now()
                    const graph = JSON.stringify(evaluated.graph)
                    if (graph !== lastGraph || !lastPixels) {
                        lastPixels = await renderGraph(evaluated.graph, prepared, rasterAssets, outputScale)
                        lastGraph = graph
                    }
                    // Keep one immutable backing frame for static diagrams. Each caller
                    // owns its copy and can transfer or modify it without poisoning reuse.
                    const pixels = lastPixels.slice()
                    const finished = performance.now()
                    return { pixels, width, height, time, sourceSha256: prepared.sourceSha256,
                        inputSha256: evaluated.inputSha256, runtimeVersion: SCENE_RUNTIME_VERSION,
                        timings: { evaluateMs: evaluatedAt - started, rasterMs: finished - evaluatedAt, totalMs: finished - started } }
                }),
            }
        },
    }
}

const trustedComponents: Record<string, React.ElementType | undefined> = Object.fromEntries(SCENE_COMPONENT_NAMES.map((name) => [name, primitives[name]]))
const svgTags = new Set<string>(SCENE_DOM_TAGS.filter((name) => !['div', 'span', 'p', 'strong', 'em', 'b', 'i', 'br'].includes(name)))
interface RasterBudget { pixels: number; count: number; nodes: number; svgBytes: number }
const budget = (): RasterBudget => ({ pixels: 0, count: 0, nodes: 0, svgBytes: 0 })
const encoder = new TextEncoder()

function isElement(value: SceneJson): value is SceneJson & SceneElement {
    return Boolean(value && !Array.isArray(value) && typeof value === 'object' && value.kind === 'vizmatic.element')
}

const xml = (value: string | number): string => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character]!)

function svgAttribute(name: string): string {
    if (name === 'className') return 'class'
    if (name === 'xlinkHref') return 'href'
    if (/^(?:viewBox|preserveAspectRatio|gradientUnits|gradientTransform|patternUnits|patternContentUnits|patternTransform|markerWidth|markerHeight|markerUnits|refX|refY|textLength|lengthAdjust|clipPathUnits)$/.test(name)) return name
    return name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
}

// These host-side conversions mirror scene-renderer.ts. Neither executable author
// values nor unvalidated resources cross the isolated evaluator's JSON boundary.
function serializeSvg(node: ReactNode, limits: RasterBudget, depth = 0): string {
    if (++limits.nodes > SCENE_LIMITS.nodes * 16) throw new Error('Resolved scene exceeds its host element budget.')
    if (depth > SCENE_LIMITS.depth * 2) throw new Error('Resolved SVG exceeds its depth limit.')
    const emit = (chunk: string): string => {
        limits.svgBytes += encoder.encode(chunk).byteLength
        if (limits.svgBytes > SCENE_LIMITS.graphBytes * 4) throw new Error('Resolved SVG exceeds its serialized byte budget.')
        return chunk
    }
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return emit(xml(node))
    if (Array.isArray(node)) return node.map((child) => serializeSvg(child, limits, depth + 1)).join('')
    if (!React.isValidElement<Record<string, unknown>>(node)) throw new Error('Invalid resolved SVG child.')
    if (node.type === React.Fragment) return serializeSvg(node.props.children as ReactNode, limits, depth + 1)
    if (node.type === primitives.SvgMathText) {
        const { text, x, y, fill, fontSize = 13, fontFamily = 'JetBrains Mono', fontWeight = 700, textAnchor = 'middle', dominantBaseline = 'middle', opacity = 1 } = node.props
        return serializeSvg(React.createElement('text', { x, y, fill, fontSize, fontFamily, fontWeight, textAnchor, dominantBaseline, opacity }, String(text)), limits, depth + 1)
    }
    if (typeof node.type === 'function') return serializeSvg((node.type as (props: Record<string, unknown>) => ReactNode)(node.props), limits, depth + 1)
    if (typeof node.type !== 'string' || !svgTags.has(node.type)) throw new Error('Only SVG components may be placed inside an SVG scene.')
    validateResolvedSceneResources(node.props)
    const attributes = Object.entries(node.props).filter(([key, value]) => key !== 'children' && key !== 'key' && value !== undefined && value !== null)
        .map(([key, value]) => {
            if (key === 'style' && typeof value === 'object') {
                const style = Object.entries(value as Record<string, unknown>).map(([property, item]) => `${svgAttribute(property)}:${String(item)}`).join(';')
                return ` style="${xml(style)}"`
            }
            if (!/^[A-Za-z_][\w:.-]*$/.test(key) || typeof value === 'object' || typeof value === 'function') throw new Error('Unsupported SVG attribute.')
            return ` ${svgAttribute(key)}="${xml(String(value))}"`
        }).join('')
    return emit(`<${node.type}${attributes}>`) + serializeSvg(node.props.children as ReactNode, limits, depth + 1) + emit(`</${node.type}>`)
}

function graphToReact(value: SceneJson, theme: ReturnType<typeof getThemeColors>): ReactNode {
    if (Array.isArray(value)) return value.map((child) => graphToReact(child, theme))
    if (!isElement(value)) return value as ReactNode
    const convertProp = (prop: SceneJson): unknown => {
        if (isElement(prop)) return graphToReact(prop, theme)
        if (Array.isArray(prop)) return prop.map(convertProp)
        if (prop && typeof prop === 'object') return Object.fromEntries(Object.entries(prop).map(([key, item]) => [key, convertProp(item)]))
        return prop
    }
    const props = Object.fromEntries(Object.entries(value.props).map(([name, prop]) => [name, convertProp(prop)]))
    const component = trustedComponents[value.type]
    if (component) props.c ??= theme
    return React.createElement((component ?? value.type) as React.ElementType, props, ...value.children.map((child) => graphToReact(child, theme)))
}

function base64(bytes: Uint8Array): string {
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384))
    return btoa(binary)
}

function rasterize(svg: string, assets: BrowserRasterAssets, width: number, height: number, outputScale = 1, png = false): { pixels: Uint8Array; png?: Uint8Array } {
    const rasterizer = new Resvg(svg, { font: assets.fontOptions, background: 'rgba(0,0,0,0)',
        ...(outputScale !== 1 ? { fitTo: { mode: 'width' as const, value: width * outputScale } } : {}) })
    try {
        const image = rasterizer.render()
        try {
            if (image.width !== width * outputScale || image.height !== height * outputScale) throw new Error('Browser frame does not match scaled scene dimensions.')
            return { pixels: image.pixels, ...(png ? { png: image.asPng() } : {}) }
        } finally { image.free() }
    } finally { rasterizer.free() }
}

function renderSvgImage(element: ReactElement<Record<string, unknown>>, assets: BrowserRasterAssets, width: number, height: number, limits: RasterBudget, outputScale = 1, includePng = false) {
    const root = React.cloneElement(element, { xmlns: 'http://www.w3.org/2000/svg', width, height })
    return rasterize(serializeSvg(root, limits), assets, width, height, outputScale, includePng)
}

function rasterizeNestedSvg(node: ReactNode, assets: BrowserRasterAssets, defaultWidth: number, defaultHeight: number, limits: RasterBudget): ReactNode {
    if (++limits.nodes > SCENE_LIMITS.nodes * 16) throw new Error('Resolved scene exceeds its host element budget.')
    if (Array.isArray(node)) return node.map((child) => rasterizeNestedSvg(child, assets, defaultWidth, defaultHeight, limits))
    if (!React.isValidElement<Record<string, unknown>>(node)) return node
    if (node.type === 'svg') {
        const width = typeof node.props.width === 'number' ? node.props.width : defaultWidth
        const height = typeof node.props.height === 'number' ? node.props.height : defaultHeight
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
            || width > SCENE_LIMITS.canvasEdge || height > SCENE_LIMITS.canvasEdge || width * height > SCENE_LIMITS.canvasPixels) throw new Error('Nested SVG dimensions exceed the scene canvas limits.')
        limits.pixels += width * height
        limits.count += 1
        if (limits.pixels > defaultWidth * defaultHeight * 4 || limits.count > 16) throw new Error('Nested SVG rasterization exceeds the per-frame pixel or image budget.')
        const { png } = renderSvgImage(node, assets, width, height, limits, 1, true)
        return React.createElement('img', { width, height, src: `data:image/png;base64,${base64(png!)}`,
            style: { display: 'flex', flexShrink: 0, ...(node.props.style as React.CSSProperties | undefined) } })
    }
    if (typeof node.type === 'function') return rasterizeNestedSvg((node.type as (props: Record<string, unknown>) => ReactNode)(node.props), assets, defaultWidth, defaultHeight, limits)
    validateResolvedSceneResources(node.props)
    return React.cloneElement(node, {}, rasterizeNestedSvg(node.props.children as ReactNode, assets, defaultWidth, defaultHeight, limits))
}

async function renderGraph(graph: SceneJson, prepared: PreparedScene, assets: BrowserRasterAssets, outputScale: number): Promise<Uint8Array> {
    const { width, height, theme } = prepared.request
    const c = getThemeColors(theme)
    let element = graphToReact(graph, c)
    if (React.isValidElement<Record<string, unknown>>(element) && element.type === 'svg') {
        return renderSvgImage(React.cloneElement(element, {
            children: [React.createElement('rect', { key: '__scene_background', width, height, fill: c.bg }), element.props.children],
        }), assets, width, height, budget(), outputScale).pixels
    }
    element = React.createElement('div', { style: { display: 'flex', position: 'relative', width, height, backgroundColor: c.bg, fontFamily: 'Inter', color: c.textPrimary } }, element)
    return withRenderContext({ background: 'theme' }, async () => {
        element = rasterizeNestedSvg(element, assets, width, height, budget())
        const accessible = prepareAccessibleSvg(element)
        const layoutNodes: Parameters<typeof addSvgAccessibility>[2] = []
        const rendered = await assets.layout(accessible.element as ReactElement, {
            width, height, fonts: assets.fonts,
            loadAdditionalAsset: async (code, segment) => {
                if (code !== 'emoji') return []
                const points = [...segment].map((character) => character.codePointAt(0)!.toString(16))
                const candidates = [points.join('-'), points.filter((point) => point !== 'fe0f').join('-')]
                const emoji = await assets.emoji()
                const svg = candidates.map((name) => emoji[`${name}.svg`]).find(Boolean)
                if (!svg) throw new Error('A scene glyph is not available in the pinned offline font and emoji assets.')
                return `data:image/svg+xml;base64,${base64(encoder.encode(svg))}`
            },
            onNodeDetected: (node) => layoutNodes.push(node),
        })
        return rasterize(addSvgAccessibility(rendered, accessible.graphs, layoutNodes), assets, width, height, outputScale).pixels
    })
}
