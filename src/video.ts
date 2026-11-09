import { execFile, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { chmod, mkdir, open, rename, rm, stat, writeFile } from 'fs/promises'
import { connect, createServer, type Socket } from 'net'
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

export type VideoCodec = 'h264' | 'vp9'

export interface RgbaVideoOptions {
    width: number
    height: number
    /** Requested duration before rounding to a whole number of frames. */
    duration: number
    outputPath: string
    fps?: number
    audioPath?: string
    /** Seconds to skip in the audio file, for a render that starts partway through a timeline. */
    audioOffset?: number
    ffmpegPath?: string
    /** H.264 writes MP4. VP9 writes WebM. */
    codec?: VideoCodec
    preset?: string
    /** Encoder tuning for H.264, such as "animation" for flat color and line art. */
    tune?: string
    crf?: number
    threads?: number
    /** Title in the file's metadata. MP4 only. */
    title?: string
    /** Chapter markers, in seconds from the start of the video. MP4 only. Players show them on the timeline. */
    chapters?: readonly { title: string; time: number }[]
    /** A caption track that the viewer can switch on, in seconds from the start of the video. MP4 only. */
    captions?: readonly { t0: number; t1: number; text: string }[]
    signal?: AbortSignal
    onProgress?: (frame: VideoFrameInfo) => void | Promise<void>
}

/** FFmpeg metadata with a title and chapters. Each chapter ends where the next one starts. */
export function chapterMetadata(title: string | undefined, chapters: readonly { title: string; time: number }[], duration: number): string {
    const escape = (value: string) => value.replace(/[\\=;#]/g, (c) => `\\${c}`).replace(/\r?\n/g, ' ')
    const marks = chapters.filter((chapter) => Number.isFinite(chapter.time) && chapter.time < duration).map((chapter) => ({ title: chapter.title, time: Math.max(0, chapter.time) })).sort((a, b) => a.time - b.time)
    // Players expect the first chapter to cover the start of the video.
    if (marks.length > 0) marks[0]!.time = 0
    let out = ';FFMETADATA1\n'
    if (title) out += `title=${escape(title)}\n`
    marks.forEach((mark, index) => {
        const end = index + 1 < marks.length ? marks[index + 1]!.time : duration
        out += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(mark.time * 1000)}\nEND=${Math.round(end * 1000)}\ntitle=${escape(mark.title)}\n`
    })
    return out
}

/** Captions as SubRip text, clipped to the video. */
export function captionsToSrt(captions: readonly { t0: number; t1: number; text: string }[], duration: number): string {
    const stamp = (seconds: number) => {
        const ms = Math.round(seconds * 1000)
        const pad = (value: number, size = 2) => String(value).padStart(size, '0')
        return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
    }
    return captions
        .filter((cue) => cue.t1 > 0 && cue.t0 < duration && cue.t1 > cue.t0 && cue.text.trim().length > 0)
        .sort((a, b) => a.t0 - b.t0)
        .map((cue, index) => `${index + 1}\n${stamp(Math.max(0, cue.t0))} --> ${stamp(Math.min(duration, cue.t1))}\n${cue.text.trim()}\n`)
        .join('\n')
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

/**
 * Convert full-range sRGB input to limited-range BT.709 and tag the stream.
 *
 * Without this, FFmpeg converts with its BT.601 default and writes no tags. Players
 * then decode HD video as BT.709, which shifts saturated yellows, greens, and blues.
 */
const COLOR_FILTER = 'scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709'
const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']

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

/** Streams a typed TSX animation to H.264 MP4 with BT.709 color at exact video frame times (30 fps by default). */
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
    if (signal.aborted) {
        // The caller gets the abort. The operation can still fail later, when the encoder stops, and
        // nothing else waits for it. A rejection that nothing handles ends Node.
        promise.catch(() => {})
        return Promise.reject(abortError())
    }

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

const LOOPBACK = '127.0.0.1'

/**
 * A pair of connected TCP sockets on the loopback address, to carry the frames to FFmpeg on macOS.
 *
 * The pipe that Node gives a child process is a local socket pair. On macOS its buffers hold 8 KB, and a
 * 1080p frame is 8 MB, so one frame takes about a thousand turns of write and read. A TCP socket on the
 * loopback address has much larger buffers. FFmpeg gets one end of the pair as its standard input, and it
 * reads `pipe:0` as before, so the bytes that it reads are the same.
 *
 * Returns undefined when the pair cannot be made, or when the environment variable `VIZMATIC_FFMPEG_PIPE`
 * is `1`. The caller then uses the pipe.
 */
async function loopbackPair(): Promise<{ ours: Socket; theirs: Socket } | undefined> {
    // Only macOS takes this path. The gain is measured there, and not on other systems.
    if (process.platform !== 'darwin' || process.env.VIZMATIC_FFMPEG_PIPE === '1') return undefined
    // The server keeps our end half open. So when FFmpeg stops early, our end stays up until a write fails,
    // as with a pipe.
    const server = createServer({ allowHalfOpen: true })
    // Every socket of this function. A failure destroys them all.
    const sockets: Socket[] = []
    let timer: NodeJS.Timeout | undefined
    try {
        return await new Promise<{ ours: Socket; theirs: Socket }>((resolvePair, rejectPair) => {
            // A firewall rule can drop the connection without an error.
            timer = setTimeout(() => rejectPair(new Error('The loopback connection timed out.')), 2_000)
            let ours: Socket | undefined
            let theirs: Socket | undefined
            let connected = false
            const finish = () => {
                if (!ours || !theirs || !connected) return
                // Another local process can connect to the port first. The pair is the connection that comes
                // from the address and the port of our own client, on the loopback address.
                const pair = theirs.localAddress === LOOPBACK && ours.remoteAddress === theirs.localAddress && ours.remotePort === theirs.localPort
                if (pair) resolvePair({ ours, theirs })
                else rejectPair(new Error('The loopback connection came from another process.'))
            }
            server.once('error', rejectPair)
            server.once('connection', (socket) => {
                // One connection is enough, so the port closes at the first one. The system then refuses
                // each later connection, and none stays open.
                server.close()
                sockets.push(socket)
                ours = socket
                finish()
            })
            server.listen(0, LOOPBACK, () => {
                const address = server.address()
                if (!address || typeof address === 'string') {
                    rejectPair(new Error('The loopback server has no port.'))
                    return
                }
                theirs = connect(address.port, LOOPBACK)
                sockets.push(theirs)
                theirs.once('error', rejectPair)
                theirs.once('connect', () => {
                    connected = true
                    finish()
                })
            })
        })
    } catch {
        for (const socket of sockets) socket.destroy()
        return undefined
    } finally {
        if (timer) clearTimeout(timer)
        server.close()
    }
}

/** The answer for each FFmpeg program, so that a process asks one time. */
const movieTimescale = new Map<string, Promise<boolean>>()

/**
 * Says if this FFmpeg can set the time scale of an MP4.
 *
 * The chapter track of an MP4 counts in the time scale of the movie. FFmpeg 7 and later take for that scale the least
 * common multiple of the scales of the tracks: millions of units in a second for a picture, sound at 48 kHz and
 * captions. A chapter of some minutes then does not fit in 32 bits. FFmpeg drops it, writes a warning, and exits with 0.
 * One millisecond is the scale that FFmpeg wrote up to version 6, and it holds a chapter of any length.
 * An FFmpeg with no such option, which is 4.3 and older, writes one millisecond always.
 */
function hasMovieTimescale(ffmpegPath: string): Promise<boolean> {
    let answer = movieTimescale.get(ffmpegPath)
    if (!answer) {
        answer = new Promise<boolean>((done) => {
            const child = execFile(ffmpegPath, ['-hide_banner', '-h', 'muxer=mp4'], { timeout: 5_000, maxBuffer: 1 << 20 }, (error, stdout) => {
                done(!error && String(stdout).includes('movie_timescale'))
            })
            child.stdin?.end()
        })
        movieTimescale.set(ffmpegPath, answer)
    }
    return answer
}

/**
 * Encodes caller-rendered RGBA frames as H.264 MP4 or VP9 WebM, tagged BT.709.
 * Frames are requested and written one at a time, so the caller controls
 * rendering and memory use.
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
    const codec = options.codec ?? 'h264'
    if (codec !== 'h264' && codec !== 'vp9') throw new Error('codec must be h264 or vp9')
    const preset = options.preset ?? 'fast'
    const crf = options.crf ?? (codec === 'vp9' ? 30 : 18)
    const threads = options.threads ?? 4
    if (typeof ffmpegPath !== 'string' || ffmpegPath.length === 0) throw new Error('ffmpegPath must be a non-empty path')
    if (typeof preset !== 'string' || preset.length === 0) throw new Error('preset must be a non-empty string')
    const maxCrf = codec === 'vp9' ? 63 : 51
    if (!Number.isInteger(crf) || crf < 0 || crf > maxCrf) throw new Error(`crf must be an integer between 0 and ${maxCrf}`)
    if (options.tune !== undefined && (typeof options.tune !== 'string' || options.tune.length === 0)) {
        throw new Error('tune must be a non-empty string when provided')
    }
    if (options.audioOffset !== undefined && (!Number.isFinite(options.audioOffset) || options.audioOffset < 0)) {
        throw new Error('audioOffset must be a non-negative finite number of seconds')
    }
    if (!Number.isSafeInteger(threads) || threads < 1) throw new Error('threads must be a positive safe integer')
    if (options.audioPath !== undefined && (typeof options.audioPath !== 'string' || options.audioPath.length === 0)) {
        throw new Error('audioPath must be a non-empty path when provided')
    }
    if (options.signal?.aborted) throw abortError()

    const outputPath = resolve(options.outputPath)
    const outputDirectory = dirname(outputPath)
    await mkdir(outputDirectory, { recursive: true })
    const extension = codec === 'vp9' ? 'webm' : 'mp4'
    const tempPath = join(outputDirectory, `.${basename(outputPath)}.${randomUUID()}.tmp.${extension}`)
    const tempFile = await open(tempPath, 'wx', 0o600)
    try {
        await tempFile.close()
    } catch (error) {
        await rm(tempPath, { force: true })
        throw error
    }
    const seconds = formatSeconds(schedule.duration)
    const args = [
        // If the encoder gets no frame, it must fail. Without this flag, it writes a movie with no frames
        // and reports success.
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-abort_on', 'empty_output',
        '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`,
        '-framerate', String(fps), '-i', 'pipe:0',
    ]
    let inputs = 1
    let audioInput = -1
    if (options.audioPath) {
        if (options.audioOffset) args.push('-ss', String(options.audioOffset))
        args.push('-i', resolve(options.audioPath))
        audioInput = inputs++
    }
    // Chapters and captions travel inside an MP4. Other containers keep their sidecar files.
    const sidecars: string[] = []
    let metadataInput = -1, captionInput = -1
    if (codec === 'h264') {
        const chapters = options.chapters ?? []
        if (options.title || chapters.length > 0) {
            const path = join(outputDirectory, `.${basename(outputPath)}.${randomUUID()}.tmp.ffmeta`)
            await writeFile(path, chapterMetadata(options.title, chapters, schedule.duration), { mode: 0o600 })
            sidecars.push(path)
            args.push('-f', 'ffmetadata', '-i', path)
            metadataInput = inputs++
        }
        const srt = captionsToSrt(options.captions ?? [], schedule.duration)
        if (srt) {
            const path = join(outputDirectory, `.${basename(outputPath)}.${randomUUID()}.tmp.srt`)
            await writeFile(path, srt, { mode: 0o600 })
            sidecars.push(path)
            args.push('-f', 'srt', '-i', path)
            captionInput = inputs++
        }
    }
    args.push('-map', '0:v:0')
    if (options.audioPath) args.push('-map', `${audioInput}:a:0`, '-af', `asetpts=PTS-STARTPTS,apad,atrim=duration=${seconds}`)
    if (captionInput >= 0) args.push('-map', `${captionInput}:0`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng')
    if (metadataInput >= 0) args.push('-map_metadata', String(metadataInput), '-map_chapters', String(metadataInput))
    args.push('-frames:v', String(schedule.count), '-t', seconds, '-vf', COLOR_FILTER)
    if (codec === 'vp9') {
        // The quality mode needs a zero bitrate. Row threading makes VP9 practical at HD and above.
        args.push('-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-threads:v', String(threads))
    } else {
        args.push('-c:v', 'libx264', '-preset', preset)
        if (options.tune) args.push('-tune', options.tune)
        // Slow presets and the animation tune raise the reference frames, which raises the H.264
        // level. At 1080p60, more than 4 needs level 5, above the level 4.2 that Apple documents.
        if (options.tune === 'animation' || /slow|placebo/.test(preset)) args.push('-refs', '4')
        args.push('-crf', String(crf), '-threads:v', String(threads))
    }
    args.push('-pix_fmt', 'yuv420p', ...COLOR_TAGS)
    if (options.audioPath) {
        if (codec === 'vp9') args.push('-c:a', 'libopus', '-b:a', '160k', '-ar', '48000', '-ac', '2')
        // 384 kbit/s is what YouTube asks for in a stereo upload. A site encodes the sound again, so the file keeps more than a viewer needs.
        else args.push('-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2')
    }
    if (codec === 'h264') {
        args.push('-movflags', '+faststart')
        if (metadataInput >= 0 && await hasMovieTimescale(ffmpegPath)) args.push('-movie_timescale', '1000')
    }
    args.push(tempPath)

    let stderr = ''
    let inputError: Error | undefined
    let child: ReturnType<typeof spawn>
    const pair = await loopbackPair()
    try {
        child = spawn(ffmpegPath, args, { stdio: [pair ? pair.theirs : 'pipe', 'ignore', 'pipe'] })
    } catch (error) {
        pair?.ours.destroy()
        pair?.theirs.destroy()
        await rm(tempPath, { force: true })
        for (const path of sidecars) await rm(path, { force: true })
        throw error
    }
    // The child has its own copy of its end. This copy must close, so that the child alone reads the frames.
    pair?.theirs.destroy()
    const frameInput = pair ? pair.ours : child.stdin
    child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString()
        if (stderr.length > MAX_STDERR_CHARS) stderr = stderr.slice(-MAX_STDERR_CHARS)
    })
    frameInput?.on('error', (error) => { inputError = error })
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
        const input = frameInput
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
        // The temp file is private while it is incomplete. The finished video is a normal file.
        await chmod(tempPath, 0o644)
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
        // An encoder that stops early closes its input. A pipe reports that as EPIPE, and a socket can report a reset.
        const code = (error as NodeJS.ErrnoException | undefined)?.code
        if (inputError && error instanceof Error && (error.message === 'write EPIPE' || code === 'EPIPE' || code === 'ECONNRESET')) {
            throw describeExit(null, null, stderr || inputError.message)
        }
        throw error
    } finally {
        pair?.ours.destroy()
        await rm(tempPath, { force: true })
        for (const path of sidecars) await rm(path, { force: true })
    }
}
