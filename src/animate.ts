import { Resvg } from '@resvg/resvg-js'
import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { ReactNode } from 'react'
import * as gifenc from 'gifenc'
import { wrapWithWatermark, type WatermarkInput } from './brand'
import { getFonts, loadAdditionalAsset } from './render'
import { satori } from './satori'

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
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
    const fonts = await getFonts()
    const svg = await satori(element as React.ReactElement, {
        width,
        height,
        fonts,
        loadAdditionalAsset,
    })

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
        result[index] = Math.round(base[index] * inverse + overlay[index] * opacity)
        result[index + 1] = Math.round(base[index + 1] * inverse + overlay[index + 1] * opacity)
        result[index + 2] = Math.round(base[index + 2] * inverse + overlay[index + 2] * opacity)
        result[index + 3] = 255
    }

    return result
}

function backgroundPixels(width: number, height: number, theme: 'dark' | 'light'): Uint8Array {
    const buffer = new Uint8Array(width * height * 4)
    const color = theme === 'light'
        ? { r: 245, g: 247, b: 250 }
        : { r: 21, g: 22, b: 32 }

    for (let index = 0; index < buffer.length; index += 4) {
        buffer[index] = color.r
        buffer[index + 1] = color.g
        buffer[index + 2] = color.b
        buffer[index + 3] = 255
    }

    return buffer
}

function encodeGif(frames: PixelFrame[], loop: number): Uint8Array {
    if (frames.length === 0) throw new Error('No GIF frames to encode')
    const firstFrame = frames[0]
    const gif = GIFEncoder()

    for (const frame of frames) {
        const palette = quantize(frame.pixels, 256, { format: 'rgba4444' })
        const index = applyPalette(frame.pixels, palette, 'rgba4444')
        gif.writeFrame(index, firstFrame.width, firstFrame.height, {
            palette,
            delay: Math.max(2, Math.round(frame.delay / 10)),
            repeat: loop,
        })
    }

    gif.finish()
    return gif.bytes()
}

const TRANSITION_FPS = 15
const MIN_TRANSITION_FRAMES = 3

async function scenesToFrames(
    scenes: AnimatedScene[],
    options: Required<Pick<AnimationOptions, 'width' | 'height' | 'loop' | 'scale' | 'theme'>> & Pick<AnimationOptions, 'brand' | 'watermark'>,
): Promise<PixelFrame[]> {
    if (scenes.length === 0) throw new Error('Animated GIF requires at least one scene')

    const renderedScenes = []
    for (const scene of scenes) {
        const watermark = options.watermark ?? options.brand
        const element = watermark
            ? wrapWithWatermark(scene.element, options.width, options.height, options.theme, watermark)
            : scene.element
        renderedScenes.push(await renderToPixels(element, options.width, options.height, options.scale))
    }

    const frames: PixelFrame[] = []
    const scaledWidth = options.width * options.scale
    const scaledHeight = options.height * options.scale

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
                    : blendPixels(backgroundPixels(scaledWidth, scaledHeight, options.theme), current.pixels, amount)
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
    const normalized = {
        ...options,
        loop: options.loop ?? 0,
        scale: options.scale ?? 1,
        theme: options.theme ?? 'dark',
    }

    await mkdir(dirname(options.outputPath), { recursive: true })
    const frames = await scenesToFrames(scenes, normalized)
    const bytes = encodeGif(frames, normalized.loop)
    await writeFile(options.outputPath, bytes)
}
