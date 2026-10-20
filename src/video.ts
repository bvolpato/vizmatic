import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { mkdir, open, rename, rm, stat } from 'fs/promises'
import { basename, dirname, join, resolve } from 'path'
import { Resvg } from '@resvg/resvg-js'
import parseCssColor from 'parse-css-color'
import type { OverflowResult } from './autocrop'
import type { WatermarkInput } from './brand'
import { CanvasOverflowError, renderToSvg, type RenderBackground } from './render'
import { getThemeColors, type ThemeMode } from './theme'
import { sampleAnimationFrame, type DefinedAnimation } from './timeline'

export interface VideoFrameInfo {
    /** Zero-based frame index. The final frame is always before the video endpoint. */
    index: number
    count: number
    /** Frame presentation time in milliseconds. */
    time: number
    /** Duration rounded to the nearest whole frame, in milliseconds. */
    duration: number
    /** Fraction of the video represented by this frame, from 0 to 1. */
    progress: number
    fps: number
}

export interface RgbaVideoOptions {
    width: number
    height: number
    /** Requested duration before rounding to a whole number of frames. */
    duration: number
    outputPath: string
    fps?: number
    audioPath?: string
    ffmpegPath?: string
    preset?: string
    crf?: number
    threads?: number
    signal?: AbortSignal
    onProgress?: (frame: VideoFrameInfo) => void | Promise<void>
}

export interface RgbaVideoOutput {
    width: number
    height: number
    frameCount: number
    duration: number
    fps: number
    bytes: number
    outputPath: string
    audioIncluded: boolean
}

export interface AnimationVideoOptions extends Omit<RgbaVideoOptions, 'duration'> {
    /** Physical output pixels per logical scene pixel. Defaults to 1. Scaled dimensions must be even integers. */
    scale?: number
    theme?: ThemeMode
    /** MP4 has no alpha channel. Defaults to the opaque theme background. */
    background?: RenderBackground
    watermark?: WatermarkInput
    brand?: boolean | string
}

export type RgbaVideoFrameRenderer = (frame: VideoFrameInfo) => Uint8Array | Promise<Uint8Array>

interface FrameSchedule {
    count: number
    duration: number
}

interface EncoderExit {
    code: number | null
    signal: NodeJS.Signals | null
    error?: Error
}

const MAX_STDERR_CHARS = 8_192

function validateTiming(duration: number, fps: number): FrameSchedule {
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('duration must be a positive finite number')
    }
    if (!Number.isInteger(fps) || fps < 1 || fps > 120) {
        throw new Error('fps must be an integer between 1 and 120')
    }

    const count = Math.round(duration * fps / 1_000)
    if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error('duration must round to at least one frame and no more than Number.MAX_SAFE_INTEGER frames')
    }

    return { count, duration: count * 1_000 / fps }
}

function frameInfo(index: number, schedule: FrameSchedule, fps: number): VideoFrameInfo {
    return {
        index,
        count: schedule.count,
        time: index * 1_000 / fps,
        duration: schedule.duration,
        progress: index / schedule.count,
        fps,
    }
}

/** Lazily yields every frame timestamp; it never emits a duplicate endpoint frame. */
export function* videoFrameSchedule(duration: number, fps = 30): Generator<VideoFrameInfo> {
    const schedule = validateTiming(duration, fps)
    for (let index = 0; index < schedule.count; index++) {
        yield frameInfo(index, schedule, fps)
    }
}

/** Streams a typed TSX animation to H.264 MP4 at exact video frame times (30 fps by default). */
export async function renderAnimationVideo<S extends object>(
    animation: DefinedAnimation<S>,
    options: AnimationVideoOptions,
): Promise<RgbaVideoOutput> {
    const scale = options.scale ?? 1
    if (!Number.isFinite(options.width) || options.width <= 0
        || !Number.isFinite(options.height) || options.height <= 0) {
        throw new Error('Animation width and height must be positive finite numbers')
    }
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('scale must be a positive finite number')
    const theme = options.theme ?? 'dark'
    const background = options.background ?? 'theme'
    const backgroundColor = background === 'theme' ? getThemeColors(theme).bg : background
    const parsedBackground = parseCssColor(backgroundColor)
    if (!parsedBackground || parsedBackground.alpha !== 1) {
        throw new Error('MP4 requires an opaque background; use "theme" or an opaque CSS color')
    }

    return renderRgbaVideo(async (info) => {
        const sampled = sampleAnimationFrame(animation, info.time, {
            index: info.index, count: info.count, delay: 1_000 / info.fps, fps: info.fps,
        })
        const edges = { top: false, right: false, bottom: false, left: false }
        const svg = await renderToSvg(animation.render(sampled.state, sampled.frame), options.width, options.height, {
            theme,
            background,
            watermark: options.watermark ?? options.brand,
            onNodeDetected: (node) => {
                edges.top ||= node.top < -0.5
                edges.right ||= node.left + node.width > options.width + 0.5
                edges.bottom ||= node.top + node.height > options.height + 0.5
                edges.left ||= node.left < -0.5
            },
        })
        const names = Object.keys(edges).filter((edge) => edges[edge as keyof typeof edges])
        if (names.length) {
            const overflow: OverflowResult = {
                overflows: true, edges,
                message: `Content overflows canvas at: ${names.join(', ')}. Increase the illustration dimensions.`,
            }
            throw new CanvasOverflowError(options.width, options.height, overflow, {
                frameIndex: info.index, frameCount: info.count, time: info.time, label: sampled.frame.label,
            })
        }
        const rendered = new Resvg(svg, {
            fitTo: { mode: 'width', value: options.width * scale },
            background: backgroundColor,
        }).render()
        if (rendered.width !== options.width * scale || rendered.height !== options.height * scale) {
            throw new Error('All video frames must match the scaled canvas dimensions')
        }
        return rendered.pixels
    }, {
        ...options,
        width: options.width * scale,
        height: options.height * scale,
        duration: animation.duration,
    })
}

function abortError(): Error {
    const error = new Error('Video export was aborted.')
    error.name = 'AbortError'
    return error
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise
    if (signal.aborted) return Promise.reject(abortError())

    return new Promise((resolvePromise, rejectPromise) => {
        const cleanup = () => signal.removeEventListener('abort', onAbort)
        const onAbort = () => {
            cleanup()
            rejectPromise(abortError())
        }
        signal.addEventListener('abort', onAbort, { once: true })
        promise.then(
            (value) => {
                cleanup()
                resolvePromise(value)
            },
            (error: unknown) => {
                cleanup()
                rejectPromise(error)
            },
        )
    })
}

function formatSeconds(durationMs: number): string {
    return (durationMs / 1_000).toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
}

function describeExit(code: number | null, signal: NodeJS.Signals | null, stderr: string): Error {
    const status = signal ? `signal ${signal}` : `exit code ${code}`
    const detail = stderr.trim()
    return new Error(`FFmpeg failed (${status})${detail ? `: ${detail}` : ''}`)
}

async function stopEncoder(child: ReturnType<typeof spawn>, exited: Promise<unknown>): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    let timer: NodeJS.Timeout | undefined
    const terminated = await Promise.race([
        exited.then(() => true),
        new Promise<false>((resolvePromise) => { timer = setTimeout(() => resolvePromise(false), 1_000) }),
    ])
    if (timer) clearTimeout(timer)
    if (!terminated) {
        child.kill('SIGKILL')
        await exited
    }
}

/**
 * Encodes caller-rendered RGBA frames as H.264 MP4. Frames are requested and
 * written one at a time, so the caller controls rendering and memory use.
 */
export async function renderRgbaVideo(
    renderFrame: RgbaVideoFrameRenderer,
    options: RgbaVideoOptions,
): Promise<RgbaVideoOutput> {
    const fps = options.fps ?? 30
    const schedule = validateTiming(options.duration, fps)
    const { width, height } = options
    if (!Number.isSafeInteger(width) || width <= 0 || width % 2 !== 0) {
        throw new Error('width must be a positive even integer')
    }
    if (!Number.isSafeInteger(height) || height <= 0 || height % 2 !== 0) {
        throw new Error('height must be a positive even integer')
    }
    const expectedBytes = width * height * 4
    if (!Number.isSafeInteger(expectedBytes)) {
        throw new Error('frame dimensions are too large')
    }
    if (typeof renderFrame !== 'function') throw new Error('renderFrame must be a function')
    if (typeof options.outputPath !== 'string' || options.outputPath.length === 0) {
        throw new Error('outputPath must be a non-empty path')
    }

    const ffmpegPath = options.ffmpegPath ?? 'ffmpeg'
    const preset = options.preset ?? 'fast'
    const crf = options.crf ?? 18
    const threads = options.threads ?? 4
    if (typeof ffmpegPath !== 'string' || ffmpegPath.length === 0) throw new Error('ffmpegPath must be a non-empty path')
    if (typeof preset !== 'string' || preset.length === 0) throw new Error('preset must be a non-empty string')
    if (!Number.isInteger(crf) || crf < 0 || crf > 51) throw new Error('crf must be an integer between 0 and 51')
    if (!Number.isSafeInteger(threads) || threads < 1) throw new Error('threads must be a positive safe integer')
    if (options.audioPath !== undefined && (typeof options.audioPath !== 'string' || options.audioPath.length === 0)) {
        throw new Error('audioPath must be a non-empty path when provided')
    }
    if (options.signal?.aborted) throw abortError()

    const outputPath = resolve(options.outputPath)
    const outputDirectory = dirname(outputPath)
    await mkdir(outputDirectory, { recursive: true })
    const tempPath = join(outputDirectory, `.${basename(outputPath)}.${randomUUID()}.tmp.mp4`)
    const tempFile = await open(tempPath, 'wx', 0o600)
    try {
        await tempFile.close()
    } catch (error) {
        await rm(tempPath, { force: true })
        throw error
    }
    const seconds = formatSeconds(schedule.duration)
    const args = [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`,
        '-framerate', String(fps), '-i', 'pipe:0',
    ]
    if (options.audioPath) args.push('-i', resolve(options.audioPath))
    args.push('-map', '0:v:0')
    if (options.audioPath) args.push('-map', '1:a:0', '-af', `asetpts=PTS-STARTPTS,apad,atrim=duration=${seconds}`)
    args.push(
        '-frames:v', String(schedule.count),
        '-t', seconds,
        '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), '-threads:v', String(threads),
        '-pix_fmt', 'yuv420p',
    )
    if (options.audioPath) args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2')
    args.push('-movflags', '+faststart', tempPath)

    let stderr = ''
    let inputError: Error | undefined
    let child: ReturnType<typeof spawn>
    try {
        child = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    } catch (error) {
        await rm(tempPath, { force: true })
        throw error
    }
    child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString()
        if (stderr.length > MAX_STDERR_CHARS) stderr = stderr.slice(-MAX_STDERR_CHARS)
    })
    child.stdin?.on('error', (error) => { inputError = error })
    let exitResult: EncoderExit | undefined
    const exited = new Promise<EncoderExit>((resolvePromise) => {
        child.once('error', (error) => {
            exitResult = { code: null, signal: null, error }
            resolvePromise(exitResult)
        })
        child.once('close', (code, signal) => {
            exitResult = { code, signal }
            resolvePromise(exitResult)
        })
    })

    function observeEncoder<T>(operation: Promise<T>, index: number, finishAfterSuccess: boolean): Promise<T | undefined> {
        const lastFrame = index === schedule.count - 1
        const completed = (exit: EncoderExit): Promise<T | undefined> => {
            if (!exit.error && exit.code === 0 && lastFrame) {
                return finishAfterSuccess ? Promise.resolve(undefined) : operation
            }
            if (exit.error) return Promise.reject(new Error(`Unable to start FFmpeg: ${exit.error.message}`, { cause: exit.error }))
            return Promise.reject(describeExit(exit.code, exit.signal, stderr))
        }
        if (exitResult) return completed(exitResult)

        return new Promise((resolvePromise, rejectPromise) => {
            const cleanup = () => {
                child.removeListener('error', onError)
                child.removeListener('close', onClose)
            }
            const onError = (error: Error) => {
                cleanup()
                rejectPromise(new Error(`Unable to start FFmpeg: ${error.message}`, { cause: error }))
            }
            const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
                cleanup()
                void completed({ code, signal }).then(resolvePromise, rejectPromise)
            }
            child.once('error', onError)
            child.once('close', onClose)
            operation.then(
                (value) => {
                    cleanup()
                    resolvePromise(value)
                },
                (error: unknown) => {
                    cleanup()
                    rejectPromise(error)
                },
            )
        })
    }

    try {
        const input = child.stdin
        if (!input) throw new Error('FFmpeg did not provide a frame input stream')

        for (let index = 0; index < schedule.count; index++) {
            const info = frameInfo(index, schedule, fps)
            const rendered = await withAbort(observeEncoder(Promise.resolve(renderFrame(info)), index, false), options.signal)
            if (!(rendered instanceof Uint8Array) || rendered.byteLength !== expectedBytes) {
                throw new Error(`Frame ${index} must contain exactly ${expectedBytes} RGBA bytes`)
            }
            if (inputError) throw describeExit(null, null, inputError.message || stderr)

            const pixels = Buffer.from(rendered.buffer, rendered.byteOffset, rendered.byteLength)
            const write = new Promise<void>((resolvePromise, rejectPromise) => {
                input.write(pixels, (error) => error ? rejectPromise(error) : resolvePromise())
            })
            await withAbort(observeEncoder(write, index, true), options.signal)
            if (options.onProgress) {
                await withAbort(observeEncoder(Promise.resolve(options.onProgress(info)), index, false), options.signal)
            }
        }

        input.end()
        const exit = await withAbort(exited, options.signal)
        if (exit.error) throw new Error(`Unable to start FFmpeg: ${exit.error.message}`, { cause: exit.error })
        if (exit.code !== 0) throw describeExit(exit.code, exit.signal, stderr)

        const outputStat = await stat(tempPath)
        await rename(tempPath, outputPath)
        return {
            width,
            height,
            frameCount: schedule.count,
            duration: schedule.duration,
            fps,
            bytes: outputStat.size,
            outputPath,
            audioIncluded: options.audioPath !== undefined,
        }
    } catch (error) {
        await stopEncoder(child, exited)
        if (inputError && error instanceof Error && (error.message === 'write EPIPE' || (error as NodeJS.ErrnoException).code === 'EPIPE')) {
            throw describeExit(null, null, stderr || inputError.message)
        }
        throw error
    } finally {
        await rm(tempPath, { force: true })
    }
}
