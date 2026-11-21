import React, { type ReactElement, type ReactNode } from 'react'
import { readFile, mkdir, open, rename, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { brotliDecompressSync } from 'node:zlib'
import { Resvg } from '@resvg/resvg-js'
import { satori, type Font } from './satori'
import { withRenderContext } from './renderContext'
import { prepareAccessibleSvg, addSvgAccessibility } from './svg-accessibility'
import { renderRgbaVideo } from './video'
import { prepareScene, type PreparedScene } from './scene-runtime'
import {
    normalizeSceneTime, sceneSha256, SCENE_LIMITS, SCENE_RUNTIME_VERSION,
    type SceneFrameRequest, type SceneJson, type SceneRequest,
} from './scene-contract'
import { validateResolvedSceneResources } from './scene-graph'
import {
    createRasterBudget,
    resolveNestedSvgSize,
    sceneGraphToReact,
    serializeSceneSvg,
    type RasterBudget,
} from './scene-host'
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
    'fonts/InstrumentSerif-Regular.ttf': '498efd461f6ddfcb7a111bf9a565709d2085d48201d501ead960d93e84ffbb88',
    'fonts/InstrumentSerif-Italic.ttf': '08939b8bdf534afec24ae0ef5e03f948940cd9a8fe08e7fecbad040e62327385',
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
    const fontDefinitions: Array<[string, string, 400 | 600 | 700, ('normal' | 'italic')?]> = [
        ['Inter', 'Inter-Regular.ttf', 400], ['Inter', 'Inter-SemiBold.ttf', 600],
        ['Inter', 'Inter-Bold.ttf', 700], ['JetBrains Mono', 'JetBrainsMono-Regular.ttf', 400],
        ['Noto Sans', 'NotoSans-Regular.ttf', 400], ['Noto Sans Math', 'NotoSansMath-Regular.ttf', 400],
        ['Instrument Serif', 'InstrumentSerif-Regular.ttf', 400], ['Instrument Serif', 'InstrumentSerif-Italic.ttf', 400, 'italic'],
    ]
    return {
        fonts: fontDefinitions.map(([name, filename, weight, style]) => ({
            name, weight, style: style ?? 'normal', data: Uint8Array.from(files.get(`fonts/${filename}`)!).buffer,
        })),
        fontFiles: fontDefinitions.map(([, filename]) => join(assetDir, 'fonts', filename)),
        emoji: JSON.parse(brotliDecompressSync(files.get('emoji.json.br')!).toString('utf8')) as Record<string, string>,
        sha256: await sceneSha256(JSON.stringify(assetPins)),
    }
}

const utf8ByteLength = (chunk: string) => Buffer.byteLength(chunk)

function renderSvgImage(element: ReactElement<Record<string, unknown>>, assets: SceneAssets, width: number, height: number, budget: RasterBudget, outputScale = 1, includePng = true): { pixels: Uint8Array; png?: Uint8Array } {
    const root = React.cloneElement(element, { xmlns: 'http://www.w3.org/2000/svg', width, height })
    const svg = serializeSceneSvg(root, budget, utf8ByteLength)
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
        const { width, height, rasterWidth, rasterHeight } = resolveNestedSvgSize(node.props.width, node.props.height, defaultWidth, defaultHeight)
        budget.pixels += rasterWidth * rasterHeight
        budget.count += 1
        if (budget.pixels > defaultWidth * defaultHeight * 4 || budget.count > 16) {
            throw new Error('Nested SVG rasterization exceeds the per-frame pixel or image budget.')
        }
        const svgElement = node.props.viewBox == null && (rasterWidth !== width || rasterHeight !== height)
            ? React.cloneElement(node, { viewBox: `0 0 ${width} ${height}` })
            : node
        const { png } = renderSvgImage(svgElement, assets, rasterWidth, rasterHeight, budget)
        return React.createElement('img', { width, height, src: `data:image/png;base64,${Buffer.from(png!).toString('base64')}`,
            style: { display: 'flex', flexShrink: 0, ...(node.props.style as React.CSSProperties | undefined) } })
    }
    // Trusted components are resolved here so SVG fragments produced by them get
    // the same pinned-font path as explicit SVG authored in the editor.
    if (typeof node.type === 'function') return rasterizeNestedSvg((node.type as (props: Record<string, unknown>) => ReactNode)(node.props), assets, defaultWidth, defaultHeight, budget)
    validateResolvedSceneResources(node.props)
    return React.cloneElement(node, {}, rasterizeNestedSvg(node.props.children as ReactNode, assets, defaultWidth, defaultHeight, budget))
}

async function renderEvaluatedGraph(
    graph: SceneJson,
    prepared: PreparedScene,
    assets: SceneAssets,
    outputScale: number,
    includePng: boolean,
    accessible: boolean,
): Promise<{ png?: Uint8Array; pixels: Uint8Array }> {
    const { width, height, theme } = prepared.request
    const c = getThemeColors(theme)
    let element = sceneGraphToReact(graph, c)
    if (React.isValidElement<Record<string, unknown>>(element) && element.type === 'svg') {
        // A native SVG scene does not pass through Satori, which drops <text>.
        // The exact same pinned-font rasterizer is used by PNG preview and MP4.
        return renderSvgImage(React.cloneElement(element, {
            children: [React.createElement('rect', { key: '__scene_background', width, height, fill: c.bg }), element.props.children],
        }), assets, width, height, createRasterBudget(), outputScale, includePng)
    }
    element = React.createElement('div', { style: { display: 'flex', position: 'relative', width, height, backgroundColor: c.bg, fontFamily: 'Inter', color: c.textPrimary } }, element)
    return withRenderContext({ background: 'theme' }, async () => {
        element = rasterizeNestedSvg(element, assets, width, height, createRasterBudget())
        const preparedSvg = accessible ? prepareAccessibleSvg(element) : null
        const layoutNodes: Parameters<typeof addSvgAccessibility>[2] = []
        const rendered = await satori((preparedSvg ? preparedSvg.element : element) as ReactElement, {
            width, height, fonts: assets.fonts,
            loadAdditionalAsset: async (code, segment) => {
                if (code !== 'emoji') return []
                const points = [...segment].map((character) => character.codePointAt(0)!.toString(16))
                const candidates = [points.join('-'), points.filter((point) => point !== 'fe0f').join('-')]
                const svg = candidates.map((name) => assets.emoji[`${name}.svg`]).find(Boolean)
                if (!svg) throw new Error('A scene glyph is not available in the pinned offline font and emoji assets.')
                return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
            },
            onNodeDetected: preparedSvg ? (node) => layoutNodes.push(node) : undefined,
        })
        const svg = preparedSvg ? addSvgAccessibility(rendered, preparedSvg.graphs, layoutNodes) : rendered
        const image = new Resvg(svg, { background: c.bg, font: { loadSystemFonts: false, fontFiles: assets.fontFiles },
            ...(outputScale !== 1 ? { fitTo: { mode: 'width' as const, value: width * outputScale } } : {}),
        }).render()
        if (image.width !== width * outputScale || image.height !== height * outputScale) throw new Error('Layout frame does not match scaled scene dimensions.')
        return { pixels: image.pixels, ...(includePng ? { png: image.asPng() } : {}) }
    })
}

async function renderPreparedFrame(prepared: PreparedScene, assets: SceneAssets, time: number, outputScale: number, includePng: boolean): Promise<{ png?: Uint8Array; pixels: Uint8Array }> {
    const evaluated = await prepared.evaluate(time)
    return renderEvaluatedGraph(evaluated.graph, prepared, assets, outputScale, includePng, true)
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
    let lastGraph: string | undefined
    let lastPixels: Uint8Array | undefined
    let lastRepeat = false
    const output = await renderRgbaVideo(async (frame) => {
        const evaluated = await prepared.evaluate(frame.time / 1_000)
        const serialized = JSON.stringify(evaluated.graph)
        if (serialized === lastGraph && lastPixels) {
            lastRepeat = true
            return lastPixels
        }
        lastRepeat = false
        lastGraph = serialized
        lastPixels = (await renderEvaluatedGraph(evaluated.graph, prepared, assets, settings.outputScale, false, false)).pixels
        return lastPixels
    }, {
        width: settings.width, height: settings.height, duration: duration * 1_000, fps: settings.fps,
        outputPath: options.outputPath, signal: options.signal,
        frameIsRepeat: () => lastRepeat,
    })
    return { ...await outputMetadata(prepared, assets, settings, options.outputPath, output.bytes, 'mp4'), encodedDuration: output.duration / 1_000 }
}
