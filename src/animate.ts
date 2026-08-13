import { Resvg } from '@resvg/resvg-js'
import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { ReactNode } from 'react'
import * as gifenc from 'gifenc'
import parseCssColor from 'parse-css-color'
import { wrapWithWatermark, type WatermarkInput } from './brand'
import type { CropRegion, OverflowResult } from './autocrop'
import { CanvasOverflowError, getFonts, loadAdditionalAsset, type AnimationOverflowContext } from './render'
import { withRenderContext, type RenderBackground } from './renderContext'
import { satori, type SatoriNode } from './satori'
import { getThemeColors } from './theme'
import { sampleAnimationFrames, type DefinedAnimation } from './timeline'

interface GifencApi {
    GIFEncoder: typeof gifenc.GIFEncoder
    applyPalette: typeof gifenc.applyPalette
    quantize: typeof gifenc.quantize
}

type GifencShape = Partial<GifencApi> & {
    default?: Partial<GifencApi>
}

function resolveGifenc(api: GifencShape): GifencApi {
    if (
        typeof api.GIFEncoder === 'function'
        && typeof api.applyPalette === 'function'
        && typeof api.quantize === 'function'
    ) {
        return api as GifencApi
    }

    const fallback = api.default
    if (
        fallback
        && typeof fallback.GIFEncoder === 'function'
        && typeof fallback.applyPalette === 'function'
        && typeof fallback.quantize === 'function'
    ) {
        return fallback as GifencApi
    }

    throw new Error('gifenc exports could not be resolved')
}

const { GIFEncoder, applyPalette, quantize } = resolveGifenc(gifenc as GifencShape)

export type TransitionType = 'none' | 'fade' | 'appear'

export interface AnimatedScene {
    element: ReactNode
    duration: number
    transition?: TransitionType
    transitionDuration?: number
    label?: string
}

export interface AnimationOptions {
    width: number
    height: number
    outputPath: string
    loop?: number
    scale?: number
    watermark?: WatermarkInput
    brand?: boolean | string
    theme?: 'dark' | 'light'
    background?: RenderBackground
    fps?: number
    /** Encode opaque animations as changed rectangles. Disable for byte-level debugging or legacy decoders. */
    deltaFrames?: boolean
}

export interface AnimationOutput {
    width: number
    height: number
    frameCount: number
    encodedFrameCount: number
    deltaFrameCount: number
    duration: number
    bytes: number
}

interface PixelFrame {
    pixels: Uint8Array
    delay: number
    width: number
    height: number
    x?: number
    y?: number
    delta?: boolean
}

interface GifEncodingOutput {
    bytes: Uint8Array
    encodedFrameCount: number
    deltaFrameCount: number
}

type GifPalette = number[][]

const MAX_PALETTE_SAMPLE_PIXELS = 1_000_000
const MAX_TIMELINE_PALETTE_FRAMES = 24

async function renderToPixels(
    element: ReactNode,
    width: number,
    height: number,
    scale: number,
    theme: 'dark' | 'light',
    background: RenderBackground,
    overflowContext?: AnimationOverflowContext,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
    const fonts = await getFonts()
    const layoutNodes: SatoriNode[] = []
    const svg = await withRenderContext({ background }, () => satori(element as React.ReactElement, {
        width,
        height,
        fonts,
        loadAdditionalAsset,
        onNodeDetected: overflowContext ? (node) => layoutNodes.push(node) : undefined,
    }))

    const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: width * scale },
        background: rasterBackground(background, theme),
    })
    const rendered = resvg.render()
    const output = {
        pixels: rendered.pixels,
        width: rendered.width,
        height: rendered.height,
    }
    if (overflowContext) {
        const overflow = detectLayoutOverflow(layoutNodes, width, height)
        if (overflow.overflows) throw new CanvasOverflowError(width, height, overflow, overflowContext)
    }
    return output
}

function detectLayoutOverflow(nodes: SatoriNode[], width: number, height: number): OverflowResult {
    const epsilon = 0.5
    const edges = {
        top: nodes.some((node) => node.top < -epsilon),
        right: nodes.some((node) => node.left + node.width > width + epsilon),
        bottom: nodes.some((node) => node.top + node.height > height + epsilon),
        left: nodes.some((node) => node.left < -epsilon),
    }
    const names = (Object.entries(edges) as Array<[keyof typeof edges, boolean]>)
        .filter(([, overflows]) => overflows)
        .map(([edge]) => edge)
    return {
        overflows: names.length > 0,
        edges,
        message: names.length
            ? `Content overflows canvas at: ${names.join(', ')}. Increase the illustration dimensions.`
            : '',
    }
}

function blendPixels(base: Uint8Array, overlay: Uint8Array, opacity: number): Uint8Array {
    const result = new Uint8Array(base.length)
    const inverse = 1 - opacity

    for (let index = 0; index < base.length; index += 4) {
        const baseAlpha = (base[index + 3] / 255) * inverse
        const overlayAlpha = (overlay[index + 3] / 255) * opacity
        const outputAlpha = baseAlpha + overlayAlpha

        if (outputAlpha === 0) continue
        result[index] = Math.round((base[index] * baseAlpha + overlay[index] * overlayAlpha) / outputAlpha)
        result[index + 1] = Math.round((base[index + 1] * baseAlpha + overlay[index + 1] * overlayAlpha) / outputAlpha)
        result[index + 2] = Math.round((base[index + 2] * baseAlpha + overlay[index + 2] * overlayAlpha) / outputAlpha)
        result[index + 3] = Math.round(outputAlpha * 255)
    }

    return result
}

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
    const h = ((hue % 360) + 360) % 360
    const s = saturation / 100
    const l = lightness / 100
    const chroma = (1 - Math.abs(2 * l - 1)) * s
    const segment = h / 60
    const intermediate = chroma * (1 - Math.abs((segment % 2) - 1))
    let channels: [number, number, number]
    if (segment < 1) channels = [chroma, intermediate, 0]
    else if (segment < 2) channels = [intermediate, chroma, 0]
    else if (segment < 3) channels = [0, chroma, intermediate]
    else if (segment < 4) channels = [0, intermediate, chroma]
    else if (segment < 5) channels = [intermediate, 0, chroma]
    else channels = [chroma, 0, intermediate]

    const offset = l - chroma / 2
    return [
        Math.round((channels[0] + offset) * 255),
        Math.round((channels[1] + offset) * 255),
        Math.round((channels[2] + offset) * 255),
    ]
}

function colorForBackground(background: RenderBackground, theme: 'dark' | 'light'): { r: number; g: number; b: number; a: number } {
    const value = background === 'theme' ? getThemeColors(theme).bg : background
    const parsed = parseCssColor(value)
    if (!parsed) throw new Error(`Invalid animation background color: ${value}`)

    const [r, g, b] = parsed.type === 'hsl'
        ? hslToRgb(parsed.values[0], parsed.values[1], parsed.values[2])
        : [parsed.values[0], parsed.values[1], parsed.values[2]]
    return { r, g, b, a: Math.round(parsed.alpha * 255) }
}

function rasterBackground(background: RenderBackground, theme: 'dark' | 'light'): string {
    const { r, g, b, a } = colorForBackground(background, theme)
    return `rgba(${r}, ${g}, ${b}, ${a / 255})`
}

function backgroundPixels(width: number, height: number, theme: 'dark' | 'light', background: RenderBackground): Uint8Array {
    const buffer = new Uint8Array(width * height * 4)
    const color = colorForBackground(background, theme)

    for (let index = 0; index < buffer.length; index += 4) {
        buffer[index] = color.r
        buffer[index + 1] = color.g
        buffer[index + 2] = color.b
        buffer[index + 3] = color.a
    }

    return buffer
}

function samplePixels(pixels: Uint8Array, limit: number): Uint8Array {
    const pixelCount = pixels.length / 4
    if (pixelCount <= limit) return pixels.slice()

    const sample = new Uint8Array(limit * 4)
    for (let index = 0; index < limit; index += 1) {
        const sourcePixel = Math.floor(((index + 0.5) * pixelCount) / limit)
        sample.set(pixels.subarray(sourcePixel * 4, sourcePixel * 4 + 4), index * 4)
    }
    return sample
}

function sharedPalette(frames: readonly Pick<PixelFrame, 'pixels'>[]): GifPalette {
    if (frames.length === 0) throw new Error('No GIF frames to quantize')
    const pixelsPerFrame = Math.max(1, Math.floor(MAX_PALETTE_SAMPLE_PIXELS / frames.length))
    const samples = frames.map((frame) => samplePixels(frame.pixels, pixelsPerFrame))
    const length = samples.reduce((total, sample) => total + sample.length, 0)
    const combined = new Uint8Array(length)
    let offset = 0
    for (const sample of samples) {
        combined.set(sample, offset)
        offset += sample.length
    }
    return quantize(combined, 256, { format: 'rgba4444', oneBitAlpha: true })
}

function changedBounds(previous: Uint8Array, current: Uint8Array, width: number, height: number): CropRegion | undefined {
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    for (let index = 0; index < current.length; index += 4) {
        if (
            previous[index] === current[index]
            && previous[index + 1] === current[index + 1]
            && previous[index + 2] === current[index + 2]
            && previous[index + 3] === current[index + 3]
        ) continue
        const pixel = index / 4
        const x = pixel % width
        const y = Math.floor(pixel / width)
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
    }
    return maxX < minX ? undefined : {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    }
}

function cropFramePixels(pixels: Uint8Array, canvasWidth: number, region: CropRegion): Uint8Array {
    const output = new Uint8Array(region.width * region.height * 4)
    for (let y = 0; y < region.height; y += 1) {
        const source = ((region.y + y) * canvasWidth + region.x) * 4
        output.set(pixels.subarray(source, source + region.width * 4), y * region.width * 4)
    }
    return output
}

function deltaPixelFrame(frame: PixelFrame, previous: Uint8Array | undefined, enabled: boolean): PixelFrame {
    if (!enabled || !previous) return frame
    const bounds = changedBounds(previous, frame.pixels, frame.width, frame.height)
    if (!bounds || (bounds.width === frame.width && bounds.height === frame.height)) return frame
    return {
        ...frame,
        x: bounds.x,
        y: bounds.y,
        delta: true,
        width: bounds.width,
        height: bounds.height,
        pixels: cropFramePixels(frame.pixels, frame.width, bounds),
    }
}

function encodeGif(frames: PixelFrame[], loop: number, deltaFrames: boolean): GifEncodingOutput {
    if (frames.length === 0) throw new Error('No GIF frames to encode')
    const firstFrame = frames[0]
    const gif = GIFEncoder()
    const palette = sharedPalette(frames)
    let first = true
    let encodedFrameCount = 0
    let deltaFrameCount = 0
    let previousPixels: Uint8Array | undefined

    let pending: PixelFrame | undefined
    for (const frame of frames) {
        if (frame.width !== firstFrame.width || frame.height !== firstFrame.height) {
            throw new Error('All GIF frames must have matching dimensions')
        }
        if (pending && pixelsEqual(pending.pixels, frame.pixels)) {
            pending.delay += frame.delay
            continue
        }
        if (pending) {
            const encoded = deltaPixelFrame(pending, previousPixels, deltaFrames)
            writeGifFrame(gif, encoded, loop, palette, first, deltaFrames)
            previousPixels = pending.pixels
            encodedFrameCount += 1
            if (encoded.delta) deltaFrameCount += 1
            first = false
        }
        pending = { ...frame }
    }

    if (pending) {
        const encoded = deltaPixelFrame(pending, previousPixels, deltaFrames)
        writeGifFrame(gif, encoded, loop, palette, first, deltaFrames)
        encodedFrameCount += 1
        if (encoded.delta) deltaFrameCount += 1
    }

    gif.finish()
    return { bytes: gif.bytes(), encodedFrameCount, deltaFrameCount }
}

const DEFAULT_TRANSITION_FPS = 20
const MIN_TRANSITION_FRAMES = 3

function sceneTransitionFps(fps: number | undefined): number {
    const resolved = fps ?? DEFAULT_TRANSITION_FPS
    if (!Number.isInteger(resolved) || resolved < 1 || resolved > 50) {
        throw new Error('Animation fps must be an integer from 1 to 50')
    }
    return resolved
}

function transitionFrameDelays(duration: number, count: number): number[] {
    const totalCentiseconds = Math.max(count * 2, Math.round(duration / 10))
    let previous = 0
    return Array.from({ length: count }, (_, index) => {
        const cumulative = Math.round(((index + 1) / count) * totalCentiseconds)
        const delay = (cumulative - previous) * 10
        previous = cumulative
        return delay
    })
}

async function scenesToFrames(
    scenes: AnimatedScene[],
    options: Required<Pick<AnimationOptions, 'width' | 'height' | 'loop' | 'scale' | 'theme' | 'background'>> & Pick<AnimationOptions, 'brand' | 'watermark' | 'fps'>,
): Promise<PixelFrame[]> {
    if (scenes.length === 0) throw new Error('Animated GIF requires at least one scene')
    for (const [index, scene] of scenes.entries()) {
        if (!Number.isFinite(scene.duration) || scene.duration <= 0) {
            throw new Error(`Animated scene ${index + 1} duration must be a positive finite number`)
        }
        if (scene.transition != null && !['none', 'fade', 'appear'].includes(scene.transition)) {
            throw new Error(`Animated scene ${index + 1} has unknown transition "${scene.transition}"`)
        }
        if (scene.transitionDuration != null && (!Number.isFinite(scene.transitionDuration) || scene.transitionDuration <= 0)) {
            throw new Error(`Animated scene ${index + 1} transitionDuration must be a positive finite number`)
        }
    }
    const fps = sceneTransitionFps(options.fps)

    const renderedScenes = await Promise.all(scenes.map((scene, sceneIndex) => {
        const watermark = options.watermark ?? options.brand
        const element = watermark
            ? wrapWithWatermark(scene.element, options.width, options.height, options.theme, watermark)
            : scene.element
        return renderToPixels(
            element,
            options.width,
            options.height,
            options.scale,
            options.theme,
            options.background,
            { sceneIndex, label: scene.label },
        )
    }))

    const frames: PixelFrame[] = []
    const scaledWidth = renderedScenes[0].width
    const scaledHeight = renderedScenes[0].height

    for (let index = 0; index < scenes.length; index += 1) {
        const scene = scenes[index]
        const current = renderedScenes[index]
        const transition = scene.transition ?? 'none'
        const transitionDuration = scene.transitionDuration ?? 400

        if (transition !== 'none') {
            const previous = index > 0
                ? renderedScenes[index - 1]
                : {
                    pixels: backgroundPixels(scaledWidth, scaledHeight, options.theme, options.background),
                    width: scaledWidth,
                    height: scaledHeight,
                }
            const transitionFrames = Math.max(
                MIN_TRANSITION_FRAMES,
                Math.round((transitionDuration / 1000) * fps),
            )
            const frameDelays = transitionFrameDelays(transitionDuration, transitionFrames)

            for (let frameIndex = 0; frameIndex < transitionFrames; frameIndex += 1) {
                const amount = (frameIndex + 1) / transitionFrames
                const pixels = transition === 'fade'
                    ? blendPixels(previous.pixels, current.pixels, amount)
                    : blendPixels(backgroundPixels(scaledWidth, scaledHeight, options.theme, options.background), current.pixels, amount)
                frames.push({ pixels, delay: frameDelays[frameIndex], width: scaledWidth, height: scaledHeight })
            }
        }

        frames.push({
            pixels: current.pixels,
            delay: scene.duration,
            width: scaledWidth,
            height: scaledHeight,
        })
    }

    return frames
}

export async function renderAnimatedGif<S extends object = object>(
    scenes: AnimatedScene[] | DefinedAnimation<S>,
    options: AnimationOptions,
): Promise<void> {
    if (!Array.isArray(scenes)) {
        await renderAnimationGifWithOutput(scenes, options)
    } else {
        await renderAnimatedGifWithOutput(scenes, options)
    }
}

export async function renderAnimatedGifWithOutput(
    scenes: AnimatedScene[],
    options: AnimationOptions,
): Promise<AnimationOutput> {
    const normalized = {
        ...options,
        loop: options.loop ?? 0,
        scale: options.scale ?? 1,
        theme: options.theme ?? 'dark',
        background: options.background ?? 'theme',
        deltaFrames: options.deltaFrames ?? true,
    }

    await mkdir(dirname(options.outputPath), { recursive: true })
    const frames = await scenesToFrames(scenes, normalized)
    const encoded = encodeGif(
        frames,
        normalized.loop,
        normalized.deltaFrames && colorForBackground(normalized.background, normalized.theme).a === 255,
    )
    await writeFile(options.outputPath, encoded.bytes)
    return {
        width: frames[0].width,
        height: frames[0].height,
        frameCount: frames.length,
        encodedFrameCount: encoded.encodedFrameCount,
        deltaFrameCount: encoded.deltaFrameCount,
        duration: frames.reduce((total, frame) => total + frame.delay, 0),
        bytes: encoded.bytes.length,
    }
}

function pixelsEqual(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return false
    }
    return true
}

function writeGifFrame(
    gif: ReturnType<typeof GIFEncoder>,
    frame: PixelFrame,
    loop: number,
    palette: GifPalette,
    first: boolean,
    delta: boolean,
): void {
    const index = applyPalette(frame.pixels, palette, 'rgba4444')
    const transparentIndex = palette.findIndex((color) => color[3] === 0)
    let remainingDelay = frame.delay
    let includePalette = first

    do {
        const delay = Math.min(655_350, remainingDelay)
        const frameStart = gif.bytesView().length
        gif.writeFrame(index, frame.width, frame.height, {
            ...(includePalette ? { palette } : {}),
            delay: Math.max(20, delay),
            repeat: loop,
            transparent: transparentIndex >= 0,
            transparentIndex,
            dispose: delta && frame.delta ? 1 : undefined,
        })
        if ((frame.x ?? 0) !== 0 || (frame.y ?? 0) !== 0) {
            const bytes = gif.bytesView()
            const descriptor = frameStart + 8
            if (bytes[descriptor] !== 0x2c) throw new Error('GIF image descriptor was not written')
            const x = frame.x ?? 0
            const y = frame.y ?? 0
            bytes[descriptor + 1] = x & 0xff
            bytes[descriptor + 2] = (x >> 8) & 0xff
            bytes[descriptor + 3] = y & 0xff
            bytes[descriptor + 4] = (y >> 8) & 0xff
        }
        includePalette = false
        remainingDelay -= delay
    } while (remainingDelay > 0)
}

function representativeFrameIndexes(frameCount: number): number[] {
    const count = Math.min(frameCount, MAX_TIMELINE_PALETTE_FRAMES)
    if (count === frameCount) return Array.from({ length: count }, (_, index) => index)

    return Array.from({ length: count }, (_, index) =>
        Math.round((index * (frameCount - 1)) / (count - 1))
    )
}

export async function renderAnimationGif<S extends object>(
    animation: DefinedAnimation<S>,
    options: AnimationOptions,
): Promise<void> {
    await renderAnimationGifWithOutput(animation, options)
}

export async function renderAnimationGifWithOutput<S extends object>(
    animation: DefinedAnimation<S>,
    options: AnimationOptions,
): Promise<AnimationOutput> {
    const normalized = {
        ...options,
        loop: options.loop ?? 0,
        scale: options.scale ?? 1,
        theme: options.theme ?? 'dark',
        background: options.background ?? 'theme',
        deltaFrames: options.deltaFrames ?? true,
    }
    const frames = sampleAnimationFrames(animation, { fps: options.fps })
    const paletteFrames: PixelFrame[] = []
    const paletteIndexes = representativeFrameIndexes(frames.length)
    const palettePixelsPerFrame = Math.max(1, Math.floor(MAX_PALETTE_SAMPLE_PIXELS / paletteIndexes.length))
    for (const index of paletteIndexes) {
        const sampled = frames[index]
        const rawElement = animation.render(sampled.state, sampled.frame)
        const watermark = normalized.watermark ?? normalized.brand
        const element = watermark
            ? wrapWithWatermark(rawElement, normalized.width, normalized.height, normalized.theme, watermark)
            : rawElement
        const rendered = await renderToPixels(
            element,
            normalized.width,
            normalized.height,
            normalized.scale,
            normalized.theme,
            normalized.background,
        )
        paletteFrames.push({
            ...rendered,
            pixels: samplePixels(rendered.pixels, palettePixelsPerFrame),
            delay: sampled.frame.delay,
        })
    }
    const palette = sharedPalette(paletteFrames)
    const gif = GIFEncoder()
    let pending: PixelFrame | undefined
    let dimensions: Pick<PixelFrame, 'width' | 'height'> | undefined
    let first = true

    let encodedFrameCount = 0
    let deltaFrameCount = 0
    let previousPixels: Uint8Array | undefined
    const useDeltaFrames = normalized.deltaFrames
        && colorForBackground(normalized.background, normalized.theme).a === 255

    for (const sampled of frames) {
        const rawElement = animation.render(sampled.state, sampled.frame)
        const watermark = normalized.watermark ?? normalized.brand
        const element = watermark
            ? wrapWithWatermark(rawElement, normalized.width, normalized.height, normalized.theme, watermark)
            : rawElement
        const rendered = await renderToPixels(
            element,
            normalized.width,
            normalized.height,
            normalized.scale,
            normalized.theme,
            normalized.background,
            {
                frameIndex: sampled.frame.index,
                frameCount: sampled.frame.count,
                time: sampled.frame.time,
                label: sampled.frame.label,
            },
        )
        dimensions ??= { width: rendered.width, height: rendered.height }
        if (rendered.width !== dimensions.width || rendered.height !== dimensions.height) {
            throw new Error('All GIF frames must have matching dimensions')
        }

        if (pending && pixelsEqual(pending.pixels, rendered.pixels)) {
            pending.delay += sampled.frame.delay
            continue
        }
        if (pending) {
            const encoded = deltaPixelFrame(pending, previousPixels, useDeltaFrames)
            writeGifFrame(gif, encoded, normalized.loop, palette, first, useDeltaFrames)
            previousPixels = pending.pixels
            encodedFrameCount += 1
            if (encoded.delta) deltaFrameCount += 1
            first = false
        }
        pending = { ...rendered, delay: sampled.frame.delay }
    }

    if (!pending || !dimensions) throw new Error('Animated GIF requires at least one frame')
    const encoded = deltaPixelFrame(pending, previousPixels, useDeltaFrames)
    writeGifFrame(gif, encoded, normalized.loop, palette, first, useDeltaFrames)
    encodedFrameCount += 1
    if (encoded.delta) deltaFrameCount += 1
    gif.finish()
    await mkdir(dirname(options.outputPath), { recursive: true })
    const bytes = gif.bytes()
    await writeFile(options.outputPath, bytes)
    return {
        ...dimensions,
        frameCount: frames.length,
        encodedFrameCount,
        deltaFrameCount,
        duration: frames.reduce((total, frame) => total + frame.frame.delay, 0),
        bytes: bytes.length,
    }
}
