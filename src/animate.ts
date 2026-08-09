import { Resvg } from '@resvg/resvg-js'
import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { ReactNode } from 'react'
import * as gifenc from 'gifenc'
import parseCssColor from 'parse-css-color'
import { wrapWithWatermark, type WatermarkInput } from './brand'
import { getFonts, loadAdditionalAsset } from './render'
import { withRenderContext, type RenderBackground } from './renderContext'
import { satori } from './satori'
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
}

export interface AnimationOutput {
    width: number
    height: number
}

interface PixelFrame {
    pixels: Uint8Array
    delay: number
    width: number
    height: number
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
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
    const fonts = await getFonts()
    const svg = await withRenderContext({ background }, () => satori(element as React.ReactElement, {
        width,
        height,
        fonts,
        loadAdditionalAsset,
    }))

    const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: width * scale },
        background: rasterBackground(background, theme),
    })
    const rendered = resvg.render()
    return {
        pixels: rendered.pixels,
        width: rendered.width,
        height: rendered.height,
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

function encodeGif(frames: PixelFrame[], loop: number): Uint8Array {
    if (frames.length === 0) throw new Error('No GIF frames to encode')
    const firstFrame = frames[0]
    const gif = GIFEncoder()
    const palette = sharedPalette(frames)
    let first = true

    for (const frame of frames) {
        if (frame.width !== firstFrame.width || frame.height !== firstFrame.height) {
            throw new Error('All GIF frames must have matching dimensions')
        }
        writeGifFrame(gif, frame, loop, palette, first)
        first = false
    }

    gif.finish()
    return gif.bytes()
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
    const fps = sceneTransitionFps(options.fps)

    const renderedScenes = await Promise.all(scenes.map((scene) => {
        const watermark = options.watermark ?? options.brand
        const element = watermark
            ? wrapWithWatermark(scene.element, options.width, options.height, options.theme, watermark)
            : scene.element
        return renderToPixels(element, options.width, options.height, options.scale, options.theme, options.background)
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
    }

    await mkdir(dirname(options.outputPath), { recursive: true })
    const frames = await scenesToFrames(scenes, normalized)
    const bytes = encodeGif(frames, normalized.loop)
    await writeFile(options.outputPath, bytes)
    return { width: frames[0].width, height: frames[0].height }
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
): void {
    const index = applyPalette(frame.pixels, palette, 'rgba4444')
    const transparentIndex = palette.findIndex((color) => color[3] === 0)
    let remainingDelay = frame.delay
    let includePalette = first

    do {
        const delay = Math.min(655_350, remainingDelay)
        gif.writeFrame(index, frame.width, frame.height, {
            ...(includePalette ? { palette } : {}),
            delay: Math.max(20, delay),
            repeat: loop,
            transparent: transparentIndex >= 0,
            transparentIndex,
        })
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
            writeGifFrame(gif, pending, normalized.loop, palette, first)
            first = false
        }
        pending = { ...rendered, delay: sampled.frame.delay }
    }

    if (!pending || !dimensions) throw new Error('Animated GIF requires at least one frame')
    writeGifFrame(gif, pending, normalized.loop, palette, first)
    gif.finish()
    await mkdir(dirname(options.outputPath), { recursive: true })
    await writeFile(options.outputPath, gif.bytes())
    return dimensions
}
