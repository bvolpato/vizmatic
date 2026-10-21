import React, { type ReactElement, type ReactNode } from 'react'
import { readFile, mkdir, open, rename, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { brotliDecompressSync } from 'node:zlib'
import { Resvg } from '@resvg/resvg-js'
import * as primitives from './primitives'
import { satori, type Font } from './satori'
import { withRenderContext } from './renderContext'
import { prepareAccessibleSvg, addSvgAccessibility } from './svg-accessibility'
import { renderRgbaVideo } from './video'
import { prepareScene, type PreparedScene } from './scene-runtime'
import {
    normalizeSceneTime, sceneSha256, SCENE_LIMITS, SCENE_RUNTIME_VERSION,
    type SceneElement, type SceneFrameRequest, type SceneJson, type SceneRequest,
} from './scene-contract'
import { SCENE_COMPONENT_NAMES, SCENE_DOM_TAGS } from './scene-components'
import { validateResolvedSceneResources } from './scene-graph'
import { getThemeColors } from './theme'

interface SceneRasterOptions {
    /** Physical pixels per logical scene pixel, from 0.25 to 1. Scaled dimensions must be even integers. */
    outputScale?: number
}

export interface RenderSceneFrameOptions extends SceneFrameRequest, SceneRasterOptions { outputPath: string }
export interface RenderSceneVideoOptions extends SceneRequest, SceneRasterOptions {
    outputPath: string
    signal?: AbortSignal
    /** Sample fewer output frames without changing the scene's logical fps or frame globals. */
    previewFps?: number
}

export interface SceneRenderOutput {
    runtimeVersion: string
    sourceSha256: string
    /** Includes the complete render request and bundled font/emoji fingerprint. */
    inputSha256: string
    /** SHA-256 of the actual PNG or MP4 bytes. */
    assetSha256: string
    fontAssetsSha256: string
    width: number
    height: number
    /** Requested narration duration, in seconds. */
    duration: number
    fps: number
    frameCount: number
    bytes: number
    outputPath: string
    time?: number
    /** MP4 duration after rounding to a whole number of frames, in seconds. */
    encodedDuration?: number
    /** Present for a reduced-resolution or reduced-frame-rate preview. */
    outputScale?: number
    previewFps?: number
    logicalWidth?: number
    logicalHeight?: number
    logicalFps?: number
    logicalFrameCount?: number
}

interface SceneOutputSettings { width: number; height: number; fps: number; frameCount: number; outputScale: number; preview: boolean }

function outputSettings(prepared: PreparedScene, outputScale = 1, previewFps?: number): SceneOutputSettings {
    if (!Number.isFinite(outputScale) || outputScale < 0.25 || outputScale > 1) {
        throw new Error('Scene outputScale must be from 0.25 to 1.')
    }
    const { width: logicalWidth, height: logicalHeight, fps: logicalFps, duration } = prepared.request
    const width = logicalWidth * outputScale, height = logicalHeight * outputScale
    if (![width, height].every((value) => Number.isInteger(value) && value >= 2 && value % 2 === 0)) {
        throw new Error('Scaled scene width and height must be positive even integers.')
    }
    const fps = previewFps === undefined ? logicalFps : previewFps
    if (!Number.isInteger(fps) || fps < 1 || fps > logicalFps) {
        throw new Error('Scene previewFps must be an integer from 1 to the logical scene fps.')
    }
    const frameCount = Math.round(duration * fps)
    if (frameCount < 1) throw new Error('Scene preview duration must round to at least one output frame.')
    return { width, height, fps, frameCount, outputScale, preview: outputScale !== 1 || fps !== logicalFps }
}

const assetPins = {
    'fonts/Inter-Regular.ttf': '1b08e7fc267a5c7e1d614100f604b83e7e8a0be241f0f288faa2b3ac93a683ba',
    'fonts/Inter-SemiBold.ttf': 'e7a1aaf7eda9f2fad4131725fa556265ec75ca7b2d756260173a040363e8d4f7',
    'fonts/Inter-Bold.ttf': 'b37284b5701b6b168dfc770aa1a4ac492106422fd3ba76bc7641e37434e8019c',
    'fonts/JetBrainsMono-Regular.ttf': '44ce4a84f20d60f24539bd0cef11f79c29e38609e0f8adf18551c9794a5d9dc3',
    'fonts/NotoSans-Regular.ttf': '5be701a9511117e73603bdab95947feef4f18bd1851dbddc30659370b26c69f1',
    'fonts/NotoSansMath-Regular.ttf': '3cbaf44af13f592bc7f7172a50edab4c73ac2f3d19af2d697a01ebd3288e322d',
    'emoji.json.br': '4911e822be2ed684fe811cadf036139e3efe353ffe2990311e1763f38ae7daab',
} as const

interface SceneAssets {
    fonts: Font[]
    fontFiles: string[]
    emoji: Record<string, string>
    sha256: string
}

let assetsPromise: Promise<SceneAssets> | undefined

async function sceneAssets(): Promise<SceneAssets> {
    assetsPromise ??= loadSceneAssets().catch((error: unknown) => { assetsPromise = undefined; throw error })
    return assetsPromise
}

async function loadSceneAssets(): Promise<SceneAssets> {
    const moduleDir = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))
    // Always read the package's pinned assets. Environment paths and network
    // fallback belong to the trusted CLI, never this editable-source renderer.
    const assetDir = join(moduleDir, '..', 'assets')
    const files = new Map<string, Buffer>()
    for (const [name, expected] of Object.entries(assetPins)) {
        const bytes = await readFile(join(assetDir, name))
        if (await sceneSha256(bytes) !== expected) throw new Error(`Pinned scene asset does not match: ${name}`)
        files.set(name, bytes)
    }
    const fontDefinitions: Array<[string, string, 400 | 600 | 700]> = [
        ['Inter', 'Inter-Regular.ttf', 400], ['Inter', 'Inter-SemiBold.ttf', 600],
        ['Inter', 'Inter-Bold.ttf', 700], ['JetBrains Mono', 'JetBrainsMono-Regular.ttf', 400],
        ['Noto Sans', 'NotoSans-Regular.ttf', 400], ['Noto Sans Math', 'NotoSansMath-Regular.ttf', 400],
    ]
    return {
        fonts: fontDefinitions.map(([name, filename, weight]) => ({
            name, weight, style: 'normal', data: Uint8Array.from(files.get(`fonts/${filename}`)!).buffer,
        })),
        fontFiles: fontDefinitions.map(([, filename]) => join(assetDir, 'fonts', filename)),
        emoji: JSON.parse(brotliDecompressSync(files.get('emoji.json.br')!).toString('utf8')) as Record<string, string>,
        sha256: await sceneSha256(JSON.stringify(assetPins)),
    }
}

const trustedComponents: Record<string, React.ElementType | undefined> = Object.fromEntries(SCENE_COMPONENT_NAMES.map((name) => [name, primitives[name]]))
const svgTags = new Set<string>(SCENE_DOM_TAGS.filter((name) => !['div', 'span', 'p', 'strong', 'em', 'b', 'i', 'br'].includes(name)))
interface RasterBudget { pixels: number; count: number; nodes: number; svgBytes: number }

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

function serializeSvg(node: ReactNode, budget: RasterBudget, depth = 0): string {
    if (++budget.nodes > SCENE_LIMITS.nodes * 16) throw new Error('Resolved scene exceeds its host element budget.')
    if (depth > SCENE_LIMITS.depth * 2) throw new Error('Resolved SVG exceeds its depth limit.')
    const emit = (chunk: string): string => {
        budget.svgBytes += Buffer.byteLength(chunk)
        if (budget.svgBytes > SCENE_LIMITS.graphBytes * 4) throw new Error('Resolved SVG exceeds its serialized byte budget.')
        return chunk
    }
    if (node === null || node === undefined || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return emit(xml(node))
    if (Array.isArray(node)) return node.map((child) => serializeSvg(child, budget, depth + 1)).join('')
    if (!React.isValidElement<Record<string, unknown>>(node)) throw new Error('Invalid resolved SVG child.')
    if (node.type === React.Fragment) return serializeSvg(node.props.children as ReactNode, budget, depth + 1)
    if (node.type === primitives.SvgMathText) {
        const { text, x, y, fill, fontSize = 13, fontFamily = 'JetBrains Mono', fontWeight = 700, textAnchor = 'middle', dominantBaseline = 'middle', opacity = 1 } = node.props
        return serializeSvg(React.createElement('text', { x, y, fill, fontSize, fontFamily, fontWeight, textAnchor, dominantBaseline, opacity }, String(text)), budget, depth + 1)
    }
    if (typeof node.type === 'function') {
        return serializeSvg((node.type as (props: Record<string, unknown>) => ReactNode)(node.props), budget, depth + 1)
    }
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
    return emit(`<${node.type}${attributes}>`) + serializeSvg(node.props.children as ReactNode, budget, depth + 1) + emit(`</${node.type}>`)
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

function renderSvgImage(element: ReactElement<Record<string, unknown>>, assets: SceneAssets, width: number, height: number, budget: RasterBudget, outputScale = 1, includePng = true): { pixels: Uint8Array; png?: Uint8Array } {
    const root = React.cloneElement(element, { xmlns: 'http://www.w3.org/2000/svg', width, height })
    const svg = serializeSvg(root, budget)
    const image = new Resvg(svg, {
        font: { loadSystemFonts: false, fontFiles: assets.fontFiles, defaultFontFamily: 'Inter' },
        background: 'rgba(0,0,0,0)',
        ...(outputScale !== 1 ? { fitTo: { mode: 'width' as const, value: width * outputScale } } : {}),
    }).render()
    if (image.width !== width * outputScale || image.height !== height * outputScale) throw new Error('SVG frame does not match scaled scene dimensions.')
    return { pixels: image.pixels, ...(includePng ? { png: image.asPng() } : {}) }
}

function rasterizeNestedSvg(node: ReactNode, assets: SceneAssets, defaultWidth: number, defaultHeight: number, budget: RasterBudget): ReactNode {
    if (++budget.nodes > SCENE_LIMITS.nodes * 16) throw new Error('Resolved scene exceeds its host element budget.')
    if (Array.isArray(node)) return node.map((child) => rasterizeNestedSvg(child, assets, defaultWidth, defaultHeight, budget))
    if (!React.isValidElement<Record<string, unknown>>(node)) return node
    if (node.type === 'svg') {
        const width = typeof node.props.width === 'number' ? node.props.width : defaultWidth
        const height = typeof node.props.height === 'number' ? node.props.height : defaultHeight
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
            || width > SCENE_LIMITS.canvasEdge || height > SCENE_LIMITS.canvasEdge || width * height > SCENE_LIMITS.canvasPixels) {
            throw new Error('Nested SVG dimensions exceed the scene canvas limits.')
        }
        budget.pixels += width * height
        budget.count += 1
        if (budget.pixels > defaultWidth * defaultHeight * 4 || budget.count > 16) {
            throw new Error('Nested SVG rasterization exceeds the per-frame pixel or image budget.')
        }
        const { png } = renderSvgImage(node, assets, width, height, budget)
        return React.createElement('img', { width, height, src: `data:image/png;base64,${Buffer.from(png!).toString('base64')}`,
            style: { display: 'flex', flexShrink: 0, ...(node.props.style as React.CSSProperties | undefined) } })
    }
    // Trusted components are resolved here so SVG fragments produced by them get
    // the same pinned-font path as explicit SVG authored in the editor.
    if (typeof node.type === 'function') return rasterizeNestedSvg((node.type as (props: Record<string, unknown>) => ReactNode)(node.props), assets, defaultWidth, defaultHeight, budget)
    validateResolvedSceneResources(node.props)
    return React.cloneElement(node, {}, rasterizeNestedSvg(node.props.children as ReactNode, assets, defaultWidth, defaultHeight, budget))
}

async function renderPreparedFrame(prepared: PreparedScene, assets: SceneAssets, time: number, outputScale: number, includePng: boolean): Promise<{ png?: Uint8Array; pixels: Uint8Array }> {
    const evaluated = await prepared.evaluate(time)
    const { width, height, theme } = prepared.request
    const c = getThemeColors(theme)
    let element = graphToReact(evaluated.graph, c)
    if (React.isValidElement<Record<string, unknown>>(element) && element.type === 'svg') {
        // A native SVG scene does not pass through Satori, which drops <text>.
        // The exact same pinned-font rasterizer is used by PNG preview and MP4.
        const image = renderSvgImage(React.cloneElement(element, {
            children: [React.createElement('rect', { key: '__scene_background', width, height, fill: c.bg }), element.props.children],
        }), assets, width, height, { pixels: 0, count: 0, nodes: 0, svgBytes: 0 }, outputScale, includePng)
        return image
    }
    element = React.createElement('div', { style: { display: 'flex', position: 'relative', width, height, backgroundColor: c.bg, fontFamily: 'Inter', color: c.textPrimary } }, element)
    return withRenderContext({ background: 'theme' }, async () => {
        element = rasterizeNestedSvg(element, assets, width, height, { pixels: 0, count: 0, nodes: 0, svgBytes: 0 })
        const accessible = prepareAccessibleSvg(element)
        const layoutNodes: Parameters<typeof addSvgAccessibility>[2] = []
        const rendered = await satori(accessible.element as ReactElement, {
            width, height, fonts: assets.fonts,
            loadAdditionalAsset: async (code, segment) => {
                if (code !== 'emoji') return []
                const points = [...segment].map((character) => character.codePointAt(0)!.toString(16))
                const candidates = [points.join('-'), points.filter((point) => point !== 'fe0f').join('-')]
                const svg = candidates.map((name) => assets.emoji[`${name}.svg`]).find(Boolean)
                if (!svg) throw new Error('A scene glyph is not available in the pinned offline font and emoji assets.')
                return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
            },
            onNodeDetected: (node) => layoutNodes.push(node),
        })
        const svg = addSvgAccessibility(rendered, accessible.graphs, layoutNodes)
        const image = new Resvg(svg, { background: c.bg, font: { loadSystemFonts: false, fontFiles: assets.fontFiles },
            ...(outputScale !== 1 ? { fitTo: { mode: 'width' as const, value: width * outputScale } } : {}),
        }).render()
        if (image.width !== width * outputScale || image.height !== height * outputScale) throw new Error('Layout frame does not match scaled scene dimensions.')
        return { pixels: image.pixels, ...(includePng ? { png: image.asPng() } : {}) }
    })
}

async function outputMetadata(prepared: PreparedScene, assets: SceneAssets, settings: SceneOutputSettings, outputPath: string, bytes: number, kind: 'png' | 'mp4', time?: number): Promise<SceneRenderOutput> {
    const { width, height, duration, fps, frameCount } = prepared.request
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(outputPath)) digest.update(chunk)
    return {
        runtimeVersion: SCENE_RUNTIME_VERSION, sourceSha256: prepared.sourceSha256,
        inputSha256: await sceneSha256(JSON.stringify({ requestSha256: prepared.inputSha256, fontAssetsSha256: assets.sha256, kind, ...(time !== undefined ? { time } : {}),
            ...(settings.preview ? { outputScale: settings.outputScale, width: settings.width, height: settings.height, fps: settings.fps, frameCount: settings.frameCount } : {}),
        })),
        assetSha256: digest.digest('hex'), fontAssetsSha256: assets.sha256,
        width: settings.width, height: settings.height, duration, fps: settings.fps, frameCount: settings.frameCount, bytes, outputPath: resolve(outputPath),
        ...(settings.preview ? { outputScale: settings.outputScale, ...(kind === 'mp4' ? { previewFps: settings.fps } : {}),
            logicalWidth: width, logicalHeight: height, logicalFps: fps, logicalFrameCount: frameCount } : {}),
    }
}

async function atomicWrite(outputPath: string, bytes: Uint8Array): Promise<void> {
    const target = resolve(outputPath)
    await mkdir(dirname(target), { recursive: true })
    const temporary = join(dirname(target), `.vizmatic-scene-${randomUUID()}.tmp`)
    const file = await open(temporary, 'wx', 0o600)
    try {
        await file.writeFile(bytes)
        await file.close()
        await rename(temporary, target)
    } catch (error) {
        await file.close().catch(() => {})
        await rm(temporary, { force: true })
        throw error
    }
}

export async function renderSceneFrame(options: RenderSceneFrameOptions): Promise<SceneRenderOutput> {
    if (typeof options.outputPath !== 'string' || !options.outputPath) throw new Error('Scene outputPath is required.')
    const prepared = await prepareScene(options)
    const settings = outputSettings(prepared, options.outputScale)
    const time = normalizeSceneTime(options.time, prepared.request.duration)
    const assets = await sceneAssets()
    const image = await renderPreparedFrame(prepared, assets, time, settings.outputScale, true)
    await atomicWrite(options.outputPath, image.png!)
    return { ...await outputMetadata(prepared, assets, settings, options.outputPath, image.png!.byteLength, 'png', time), time }
}

export async function renderSceneVideo(options: RenderSceneVideoOptions): Promise<SceneRenderOutput> {
    if (typeof options.outputPath !== 'string' || !options.outputPath) throw new Error('Scene outputPath is required.')
    const prepared = await prepareScene(options)
    const settings = outputSettings(prepared, options.outputScale, options.previewFps)
    const assets = await sceneAssets()
    const { duration } = prepared.request
    const output = await renderRgbaVideo(async (frame) => (await renderPreparedFrame(prepared, assets, frame.time / 1_000, settings.outputScale, false)).pixels, {
        width: settings.width, height: settings.height, duration: duration * 1_000, fps: settings.fps, outputPath: options.outputPath, signal: options.signal,
    })
    return { ...await outputMetadata(prepared, assets, settings, options.outputPath, output.bytes, 'mp4'), encodedDuration: output.duration / 1_000 }
}
