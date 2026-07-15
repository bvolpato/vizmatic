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

async function renderToPixels(
    element: ReactNode,
    width: number,
    height: number,
    scale: number,
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
        background: 'rgba(0, 0, 0, 0)',
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

function encodeGif(frames: PixelFrame[], loop: number): Uint8Array {
    if (frames.length === 0) throw new Error('No GIF frames to encode')
    const firstFrame = frames[0]
    const gif = GIFEncoder()

    for (const frame of frames) {
        const palette = quantize(frame.pixels, 256, { format: 'rgba4444', oneBitAlpha: true })
        const index = applyPalette(frame.pixels, palette, 'rgba4444')
        const transparentIndex = palette.findIndex((color) => color[3] === 0)
        gif.writeFrame(index, firstFrame.width, firstFrame.height, {
            palette,
            delay: Math.max(2, Math.round(frame.delay / 10)),
            repeat: loop,
            transparent: transparentIndex >= 0,
            transparentIndex,
        })
    }

    gif.finish()
    return gif.bytes()
}

const TRANSITION_FPS = 15
const MIN_TRANSITION_FRAMES = 3

async function scenesToFrames(
    scenes: AnimatedScene[],
    options: Required<Pick<AnimationOptions, 'width' | 'height' | 'loop' | 'scale' | 'theme' | 'background'>> & Pick<AnimationOptions, 'brand' | 'watermark'>,
): Promise<PixelFrame[]> {
    if (scenes.length === 0) throw new Error('Animated GIF requires at least one scene')

    const renderedScenes = await Promise.all(scenes.map((scene) => {
        const watermark = options.watermark ?? options.brand
        const element = watermark
            ? wrapWithWatermark(scene.element, options.width, options.height, options.theme, watermark)
            : scene.element
        return renderToPixels(element, options.width, options.height, options.scale, options.background)
    }))

    const frames: PixelFrame[] = []
    const scaledWidth = renderedScenes[0].width
    const scaledHeight = renderedScenes[0].height

    for (let index = 0; index < scenes.length; index += 1) {
        const scene = scenes[index]
        const current = renderedScenes[index]
        const transition = scene.transition ?? 'none'
        const transitionDuration = scene.transitionDuration ?? 400

        if (index > 0 && transition !== 'none') {
            const previous = renderedScenes[index - 1]
            const transitionFrames = Math.max(
                MIN_TRANSITION_FRAMES,
                Math.round((transitionDuration / 1000) * TRANSITION_FPS),
            )
            const frameDelay = transitionDuration / transitionFrames

            for (let frameIndex = 0; frameIndex < transitionFrames; frameIndex += 1) {
                const amount = (frameIndex + 1) / transitionFrames
                const pixels = transition === 'fade'
                    ? blendPixels(previous.pixels, current.pixels, amount)
                    : blendPixels(backgroundPixels(scaledWidth, scaledHeight, options.theme, options.background), current.pixels, amount)
                frames.push({ pixels, delay: frameDelay, width: scaledWidth, height: scaledHeight })
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

export async function renderAnimatedGif(
    scenes: AnimatedScene[],
    options: AnimationOptions,
): Promise<void> {
    await renderAnimatedGifWithOutput(scenes, options)
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
