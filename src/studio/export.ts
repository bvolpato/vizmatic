/**
 * Browser export. Every frame is painted at its exact time and handed to the
 * encoder, so results are deterministic and never depend on how fast the machine
 * is. This module runs in the Studio page and inside the code sandbox.
 */
import * as gifenc from 'gifenc'
import { FilmPlayer } from '../stage/player'
import { Suspend, type CompiledFilm } from '../stage/index'
import { muxMp4, muxWebm, vp9Config, type Mp4Sample, type VideoCodec } from './mp4'

export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'png' | 'svg'
export type ExportQuality = 'draft' | 'standard' | 'high'

export interface ExportSettings {
    format: ExportFormat
    /** Output width in pixels. Height follows the film's aspect ratio. */
    width: number
    fps: number
    quality: ExportQuality
    /** Sub-frames averaged per frame. 1 turns it off. */
    motionBlur: number
    from: number
    to: number
    /** The frame to capture, for still formats. */
    time: number
}

export interface ExportProgress {
    done: number
    total: number
    stage: string
}

export interface ExportResult {
    bytes: Uint8Array
    type: string
    extension: string
    /** What actually happened, such as the codec used. */
    note: string
}

export interface ExportControl {
    signal?: AbortSignal
    onProgress?: (progress: ExportProgress) => void
}

export class ExportCancelled extends Error {
    constructor() {
        super('Export was cancelled.')
        this.name = 'ExportCancelled'
    }
}

const BITS_PER_PIXEL: Record<ExportQuality, number> = { draft: 0.05, standard: 0.11, high: 0.22 }

/** Pick an even size for the film's aspect ratio. Video encoders need even dimensions. */
export function evenSize(film: { width: number; height: number }, width: number): { width: number; height: number } {
    let w = Math.max(16, Math.round(width / 2) * 2)
    for (let attempt = 0; attempt < 8; attempt++) {
        const h = w * film.height / film.width
        if (Math.abs(h - Math.round(h)) < 1e-6 && Math.round(h) % 2 === 0) return { width: w, height: Math.round(h) }
        w += 2
    }
    const h = Math.round((w * film.height / film.width) / 2) * 2
    return { width: w, height: h }
}

function nextTask(): Promise<void> {
    return new Promise((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => resolve()
        channel.port2.postMessage(0)
    })
}

/** Paints frames at any resolution, including bloom and optional motion blur. */
class FramePainter {
    readonly canvas = document.createElement('canvas')
    private readonly player: FilmPlayer
    private readonly accumulate: HTMLCanvasElement | null
    private readonly accumulateCtx: CanvasRenderingContext2D | null

    constructor(private readonly film: CompiledFilm, readonly width: number, readonly height: number, private readonly blur: number) {
        this.player = new FilmPlayer(this.canvas, film, { pixelRatio: width / film.width })
        if (this.canvas.height !== height) this.canvas.height = height
        if (blur > 1) {
            this.accumulate = document.createElement('canvas')
            this.accumulate.width = width
            this.accumulate.height = height
            this.accumulateCtx = this.accumulate.getContext('2d')!
        } else {
            this.accumulate = null
            this.accumulateCtx = null
        }
    }

    async paint(time: number, fps: number): Promise<HTMLCanvasElement> {
        if (!this.accumulate || !this.accumulateCtx) {
            await this.seek(time)
            return this.canvas
        }
        const shutter = 0.5 / fps
        for (let i = 0; i < this.blur; i++) {
            await this.seek(time + (i / this.blur) * shutter)
            this.accumulateCtx.globalAlpha = 1 / (i + 1)
            this.accumulateCtx.drawImage(this.canvas, 0, 0)
        }
        this.accumulateCtx.globalAlpha = 1
        return this.accumulate
    }

    private async seek(time: number): Promise<void> {
        for (let attempt = 0; attempt < 8; attempt++) {
            try {
                this.film.frame(time)
                break
            } catch (error) {
                if (!(error instanceof Suspend)) throw error
                await error.promise
            }
        }
        this.player.seek(time)
    }

    destroy(): void {
        this.player.destroy()
    }
}

function h264Candidates(width: number, height: number, fps: number): string[] {
    const blocks = Math.ceil(width / 16) * Math.ceil(height / 16)
    const rate = blocks * fps
    const levels: [number, number, string][] = [
        [3600, 108_000, '1F'], [8192, 245_760, '28'], [8704, 522_240, '2A'], [22_080, 589_824, '32'],
        [36_864, 983_040, '33'], [36_864, 2_073_600, '34'], [139_264, 4_177_920, '3C'],
    ]
    const fit = levels.filter(([frame, perSecond]) => blocks <= frame && rate <= perSecond).map(([, , code]) => code)
    const out: string[] = []
    for (const profile of ['6400', '4D00', '4200']) for (const level of fit) out.push(`avc1.${profile}${level}`)
    return out
}

function vp9Candidates(width: number, height: number, fps: number): string[] {
    const pixels = width * height
    const levels: [number, number, string][] = [
        [1_000_000, 34_000_000, '31'], [2_300_000, 70_000_000, '40'], [2_300_000, 140_000_000, '41'], [9_000_000, 280_000_000, '50'], [9_000_000, 560_000_000, '51'], [36_000_000, 1_200_000_000, '60'],
    ]
    return levels.filter(([frame, rate]) => pixels <= frame && pixels * fps <= rate).map(([, , code]) => `vp09.00.${code}.08`)
}

interface EncoderChoice {
    codec: string
    container: 'mp4' | 'webm'
    mp4Codec?: VideoCodec
    config: VideoEncoderConfig
}

async function chooseEncoder(format: 'mp4' | 'webm', width: number, height: number, fps: number, bitrate: number): Promise<EncoderChoice | null> {
    if (typeof VideoEncoder === 'undefined') return null
    const base = { width, height, bitrate, framerate: fps, latencyMode: 'quality' as const }
    const test = async (codec: string, extra: Partial<VideoEncoderConfig> = {}): Promise<VideoEncoderConfig | null> => {
        const config: VideoEncoderConfig = { ...base, codec, ...extra }
        try {
            const support = await VideoEncoder.isConfigSupported(config)
            return support.supported ? config : null
        } catch {
            return null
        }
    }
    if (format === 'mp4') {
        for (const codec of h264Candidates(width, height, fps)) {
            const config = await test(codec, { avc: { format: 'avc' } })
            if (config) return { codec, container: 'mp4', mp4Codec: 'avc1', config }
        }
        for (const codec of vp9Candidates(width, height, fps)) {
            const config = await test(codec)
            if (config) return { codec, container: 'mp4', mp4Codec: 'vp09', config }
        }
    }
    for (const codec of vp9Candidates(width, height, fps)) {
        const config = await test(codec)
        if (config) return { codec, container: 'webm', config }
    }
    const vp8 = await test('vp8')
    if (vp8) return { codec: 'vp8', container: 'webm', config: vp8 }
    return null
}

async function exportVideo(film: CompiledFilm, settings: ExportSettings, control: ExportControl): Promise<ExportResult> {
    const { width, height } = evenSize(film, settings.width)
    const fps = settings.fps
    const bitrate = Math.round(Math.min(120_000_000, Math.max(500_000, width * height * fps * BITS_PER_PIXEL[settings.quality])))
    const choice = await chooseEncoder(settings.format as 'mp4' | 'webm', width, height, fps, bitrate)
    if (!choice) {
        throw new Error('This browser has no video encoder for that format. Export as film.tsx and render it with the Vizmatic CLI, or try Chrome or Safari.')
    }
    const total = Math.max(1, Math.round((settings.to - settings.from) * fps))
    const samples: Mp4Sample[] = []
    let description: Uint8Array | null = null
    let colorSpace: VideoColorSpaceInit | undefined
    let encoderError: Error | null = null
    const encoder = new VideoEncoder({
        output(chunk, metadata) {
            const data = new Uint8Array(chunk.byteLength)
            chunk.copyTo(data)
            samples.push({ data, timestamp: chunk.timestamp, keyframe: chunk.type === 'key' })
            const config = metadata?.decoderConfig
            if (config) {
                if (config.description) {
                    const source = config.description as ArrayBuffer | ArrayBufferView
                    description = source instanceof ArrayBuffer
                        ? new Uint8Array(source.slice(0))
                        : new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength))
                }
                colorSpace = config.colorSpace ?? colorSpace
            }
        },
        error(error) {
            encoderError = error instanceof Error ? error : new Error(String(error))
        },
    })
    encoder.configure(choice.config)
    const painter = new FramePainter(film, width, height, settings.motionBlur)
    const keyEvery = Math.max(1, Math.round(fps * 2))
    try {
        for (let index = 0; index < total; index++) {
            if (control.signal?.aborted) throw new ExportCancelled()
            if (encoderError) throw encoderError
            const time = settings.from + index / fps
            const source = await painter.paint(time, fps)
            const frame = new VideoFrame(source, {
                timestamp: Math.round((index * 1_000_000) / fps),
                duration: Math.round(1_000_000 / fps),
            })
            encoder.encode(frame, { keyFrame: index % keyEvery === 0 })
            frame.close()
            control.onProgress?.({ done: index + 1, total, stage: 'Encoding' })
            // Back-pressure keeps memory flat, and yielding keeps the window responsive.
            while (encoder.encodeQueueSize > 6) {
                await new Promise((resolve) => setTimeout(resolve, 4))
                if (encoderError) throw encoderError
            }
            if (index % 3 === 0) await nextTask()
        }
        await encoder.flush()
        if (encoderError) throw encoderError
    } finally {
        painter.destroy()
        if (encoder.state !== 'closed') encoder.close()
    }
    control.onProgress?.({ done: total, total, stage: 'Writing file' })
    await nextTask()
    if (choice.container === 'webm') {
        return {
            bytes: muxWebm({ width, height, fps, codecId: choice.codec === 'vp8' ? 'V_VP8' : 'V_VP9', samples }),
            type: 'video/webm', extension: 'webm',
            note: settings.format === 'mp4'
                ? `This browser cannot write MP4 here, so this is WebM (${choice.codec}). The film.tsx export renders MP4 with the CLI.`
                : `WebM, ${choice.codec}, ${width}x${height} at ${fps} fps`,
        }
    }
    const color = {
        primaries: 1, transfer: 1, matrix: 1,
        fullRange: (colorSpace as VideoColorSpaceInit | undefined)?.fullRange ?? false,
    }
    const box = choice.mp4Codec === 'vp09' ? vp9Config(choice.codec, color) : description
    if (!box) throw new Error('The encoder did not supply a decoder configuration.')
    return {
        bytes: muxMp4({ codec: choice.mp4Codec!, width, height, fps, description: box, samples, color }),
        type: 'video/mp4', extension: 'mp4',
        note: `MP4, ${choice.mp4Codec === 'avc1' ? 'H.264' : 'VP9'} (${choice.codec}), ${width}x${height} at ${fps} fps`,
    }
}

const gifApi = typeof gifenc.GIFEncoder === 'function' ? gifenc : gifenc.default

async function exportGif(film: CompiledFilm, settings: ExportSettings, control: ExportControl): Promise<ExportResult> {
    const { width, height } = evenSize(film, settings.width)
    // GIF timing has a resolution of 10 ms, and most viewers slow down beyond 50 fps.
    const fps = Math.min(30, settings.fps)
    const total = Math.max(1, Math.round((settings.to - settings.from) * fps))
    const painter = new FramePainter(film, width, height, settings.motionBlur)
    const gif = gifApi.GIFEncoder()
    const scratch = document.createElement('canvas')
    scratch.width = width
    scratch.height = height
    const ctx = scratch.getContext('2d', { willReadFrequently: true })!
    try {
        for (let index = 0; index < total; index++) {
            if (control.signal?.aborted) throw new ExportCancelled()
            ctx.drawImage(await painter.paint(settings.from + index / fps, fps), 0, 0)
            const pixels = new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer)
            const palette = gifApi.quantize(pixels, 256, { format: 'rgb565' })
            const indexed = gifApi.applyPalette(pixels, palette, 'rgb565')
            gif.writeFrame(indexed, width, height, { palette, delay: Math.round(1000 / fps), repeat: 0 })
            control.onProgress?.({ done: index + 1, total, stage: 'Encoding' })
            await nextTask()
        }
    } finally {
        painter.destroy()
    }
    gif.finish()
    return { bytes: gif.bytes().slice(), type: 'image/gif', extension: 'gif', note: `GIF, ${width}x${height} at ${fps} fps` }
}

async function exportPng(film: CompiledFilm, settings: ExportSettings): Promise<ExportResult> {
    const { width, height } = evenSize(film, settings.width)
    const painter = new FramePainter(film, width, height, 1)
    try {
        const canvas = await painter.paint(settings.time, settings.fps)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('The browser could not encode this PNG.')
        return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/png', extension: 'png', note: `PNG, ${width}x${height}` }
    } finally {
        painter.destroy()
    }
}

/** Render a film to a file in memory. */
export async function exportFilm(film: CompiledFilm, settings: ExportSettings, control: ExportControl = {}): Promise<ExportResult> {
    switch (settings.format) {
        case 'mp4':
        case 'webm':
            return exportVideo(film, settings, control)
        case 'gif':
            return exportGif(film, settings, control)
        case 'png':
            return exportPng(film, settings)
        case 'svg':
            return {
                bytes: new TextEncoder().encode(film.svg(settings.time)),
                type: 'image/svg+xml', extension: 'svg',
                note: `SVG at ${film.width}x${film.height}. Text is outlines, so no fonts are needed.`,
            }
    }
}
