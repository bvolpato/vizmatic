import { execFile, spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { chmod, mkdir, open, rename, rm, stat, writeFile } from 'fs/promises'
import { connect, createServer, type Socket } from 'net'
import { createInterface } from 'readline'
import { basename, dirname, join, resolve } from 'path'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
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
export type H264Encoder = 'libx264' | 'videotoolbox' | 'nvenc' | 'vaapi' | 'qsv' | 'amf'
export type H264EncoderRequest = H264Encoder | 'auto'
export type HardwareH264Encoder = Exclude<H264Encoder, 'libx264'>
export const HARDWARE_H264_ENCODERS: readonly HardwareH264Encoder[] = ['videotoolbox', 'nvenc', 'vaapi', 'qsv', 'amf']

export interface RgbaVideoOptions {
    width: number
    height: number
    /** Requested duration before rounding to a whole number of frames. */
    duration: number
    outputPath: string
    /** After drawing, return true only if the RGBA bytes equal the preceding frame.
     * Return 'compare' to check consecutive RGBA snapshots byte for byte.
     * Sends timestamped RGBA packets and expands holds after color conversion. */
    frameIsRepeat?: (frame: VideoFrameInfo) => boolean | 'compare'
    fps?: number
    audioPath?: string
    /** Seconds to skip in the audio file, for a render that starts partway through a timeline. */
    audioOffset?: number
    ffmpegPath?: string
    /** H.264 writes MP4. VP9 writes WebM. */
    codec?: VideoCodec
    /**
     * The default is libx264. Auto probes local hardware for standard-quality output, except in CI.
     * Auto preserves custom CRF, x264 parameters and tuning by selecting software.
     * NVENC uses NVIDIA's dedicated video encoder; RGBA drawing and color conversion are unchanged.
     */
    h264Encoder?: H264EncoderRequest
    /** Native quality for explicit Apple VideoToolbox output, from 0 to 100. The default is 75. */
    videoToolboxQuality?: number
    /** Fail before painting if an explicit encoder cannot encode these settings. Auto permits software. */
    requireH264Encoder?: boolean
    /**
     * x264 speed preset, default fast. NVENC maps ultrafast/superfast/veryfast/faster/fast/medium
     * to p1/p2/p3/p4/p5/p6, and slow/slower/veryslow/placebo to p7, with high-quality tuning.
     * These preserve the speed/quality preference, not identical compression or image quality.
     */
    preset?: string
    /** x264 tuning, such as "animation" or "grain". NVENC falls back to software to preserve it. */
    tune?: string
    /**
     * More settings for the H.264 encoder, as x264 writes them: `name=value` pairs with a colon between them,
     * such as "aq-strength=1.0:trellis=0". They come after the preset and the tune, so they replace a value of those.
     */
    x264Params?: string
    /**
     * Default 18 for H.264, 30 for VP9. Explicit NVENC maps 1..51 to VBR CQ of the same number,
     * without a bitrate cap. CQ and CRF are not equivalent quality scales. CRF 0 keeps software
     * lossless encoding, since NVENC CQ 0 means automatic quality, not lossless.
     */
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
    /** Full RGBA packets written when frameIsRepeat is supplied. */
    rgbaPackets?: number
    /** The encoder that produced the H.264 stream. Absent for other codecs. */
    h264Encoder?: H264Encoder
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

    let lastSvg: string | undefined
    let lastPixels: Uint8Array | undefined
    let lastRepeat = false
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
        if (svg === lastSvg && lastPixels) {
            lastRepeat = true
            return lastPixels
        }
        const rendered = new Resvg(svg, {
            fitTo: { mode: 'width', value: options.width * scale },
            background: backgroundColor,
        }).render()
        if (rendered.width !== options.width * scale || rendered.height !== options.height * scale) {
            throw new Error('All video frames must match the scaled canvas dimensions')
        }
        lastRepeat = false
        lastSvg = svg
        lastPixels = rendered.pixels
        return rendered.pixels
    }, {
        ...options,
        width: options.width * scale,
        height: options.height * scale,
        duration: animation.duration,
        frameIsRepeat: options.frameIsRepeat ?? (() => lastRepeat),
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

/** Ask each FFmpeg program about an option only once, including during concurrent exports. */
const ffmpegOptions = new Map<string, Promise<boolean>>()

type H264Format = { width: number; height: number; fps: number }
type H264SelectionOptions = Pick<RgbaVideoOptions, 'preset' | 'crf' | 'tune' | 'x264Params' | 'signal' | 'requireH264Encoder' | 'videoToolboxQuality'>

const NVENC_PRESETS: Readonly<Record<string, string>> = {
    ultrafast: 'p1', superfast: 'p2', veryfast: 'p3', faster: 'p4', fast: 'p5', medium: 'p6',
    slow: 'p7', slower: 'p7', veryslow: 'p7', placebo: 'p7',
}

const QSV_PRESETS: Readonly<Record<string, string>> = {
    ultrafast: 'veryfast', superfast: 'veryfast', veryfast: 'veryfast', faster: 'faster', fast: 'fast',
    medium: 'medium', slow: 'slow', slower: 'slower', veryslow: 'veryslow', placebo: 'veryslow',
}

const AMF_PRESETS: Readonly<Record<string, string>> = {
    ultrafast: 'speed', superfast: 'speed', veryfast: 'speed', faster: 'speed', fast: 'balanced',
    medium: 'balanced', slow: 'quality', slower: 'quality', veryslow: 'quality', placebo: 'quality',
}

function vaapiDevice(): string {
    return process.env.VIZMATIC_VAAPI_DEVICE || '/dev/dri/renderD128'
}

function nvencArgs(options: H264SelectionOptions): string[] {
    // FFmpeg 6.1's nvenc_h264.c defines p1..p7, hq and VBR CQ (0 is automatic, 1..51 is quality).
    // https://github.com/FFmpeg/FFmpeg/blob/n6.1/libavcodec/nvenc_h264.c
    return ['-c:v', 'h264_nvenc', '-preset', NVENC_PRESETS[options.preset ?? 'fast']!, '-tune', 'hq',
        '-profile:v', 'high', '-rc', 'vbr', '-cq', String(options.crf ?? 18), '-b:v', '0', '-g', '250']
}

function videoToolboxArgs({ width, height, fps }: H264Format, quality = 75): string[] {
    const args = ['-c:v', 'h264_videotoolbox', '-allow_sw', '0', '-profile:v', 'high', '-q:v', String(quality), '-g', '250']
    const blocks = Math.ceil(width / 16) * Math.ceil(height / 16)
    if (blocks <= 8192 && blocks * fps <= 245760) args.push('-level:v', '4.0')
    else if (blocks <= 8704 && blocks * fps <= 522240) args.push('-level:v', '4.2')
    return args
}

function vaapiArgs(options: H264SelectionOptions): string[] {
    return ['-c:v', 'h264_vaapi', '-profile:v', 'high', '-qp', String(options.crf ?? 18), '-g', '250']
}

function qsvArgs(options: H264SelectionOptions): string[] {
    return ['-c:v', 'h264_qsv', '-preset', QSV_PRESETS[options.preset ?? 'fast']!, '-profile:v', 'high',
        '-global_quality', String(options.crf ?? 18), '-g', '250']
}

function amfArgs(options: H264SelectionOptions): string[] {
    const qp = String(options.crf ?? 18)
    return ['-c:v', 'h264_amf', '-quality', AMF_PRESETS[options.preset ?? 'fast']!, '-profile:v', 'high',
        '-rc', 'cqp', '-qp_i', qp, '-qp_p', qp, '-g', '250']
}

function hardwareEncoderArgs(encoder: HardwareH264Encoder, format: H264Format, options: H264SelectionOptions): {
    inputPrefix: string[]
    filterSuffix: string
    codecArgs: string[]
    pixFmt: string | null
} {
    switch (encoder) {
        case 'videotoolbox':
            return { inputPrefix: [], filterSuffix: '', codecArgs: videoToolboxArgs(format, options.videoToolboxQuality), pixFmt: 'yuv420p' }
        case 'nvenc':
            return { inputPrefix: [], filterSuffix: '', codecArgs: nvencArgs(options), pixFmt: 'yuv420p' }
        case 'vaapi':
            return { inputPrefix: ['-vaapi_device', vaapiDevice()], filterSuffix: ',format=nv12,hwupload', codecArgs: vaapiArgs(options), pixFmt: null }
        case 'qsv':
            return { inputPrefix: [], filterSuffix: '', codecArgs: qsvArgs(options), pixFmt: 'nv12' }
        case 'amf':
            return { inputPrefix: [], filterSuffix: '', codecArgs: amfArgs(options), pixFmt: 'yuv420p' }
    }
}

export function platformHardwareCandidates(): HardwareH264Encoder[] {
    if (process.platform === 'darwin') return ['videotoolbox', 'nvenc']
    if (process.platform === 'win32') return ['nvenc', 'amf', 'qsv']
    return existsSync(vaapiDevice()) ? ['nvenc', 'vaapi', 'qsv'] : ['nvenc', 'qsv']
}

/** Check each encoded presentation time before replacing the caller's movie. */
async function verifyHardwareFrames(ffmpeg: string, path: string, count: number, fps: number, signal?: AbortSignal): Promise<void> {
    const seen = new Uint8Array(Math.ceil(count / 8))
    // Stream copy preserves the packet timestamps and avoids a second encode or decode.
    const child = spawn(ffmpeg, ['-nostdin', '-v', 'error', '-xerror', '-copyts', '-i', path, '-map', '0:v:0',
        '-c:v', 'copy', '-avoid_negative_ts', 'disabled', '-f', 'framecrc', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], signal })
    let timeScale = 0, timeUnit = 0, packets = 0
    let stderr = '', invalid = false
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-MAX_STDERR_CHARS) })
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => {
        if (line.startsWith('#')) {
            const clock = /^#tb 0:\s*(\d+)\/(\d+)$/.exec(line)
            if (clock) {
                timeUnit = Number(clock[1])
                timeScale = Number(clock[2])
            }
            return
        }
        const pts = /^0,\s*-?\d+,\s*(-?\d+),/.exec(line)
        const index = pts ? Number(pts[1]) * timeUnit * fps / timeScale : NaN
        if (!timeScale || !timeUnit || !Number.isSafeInteger(index) || index < 0 || index >= count) {
            invalid = true
            return
        }
        const byte = Math.floor(index / 8), mask = 1 << (index % 8)
        if (seen[byte]! & mask) invalid = true
        seen[byte] = seen[byte]! | mask
        packets++
    })
    await new Promise<void>((done, fail) => {
        child.once('error', fail)
        child.once('close', (code, sig) => code === 0 ? done() : fail(describeExit(code, sig, stderr)))
    })
    if (invalid || packets !== count) {
        let missing = 0
        while (missing < count && (seen[Math.floor(missing / 8)]! & (1 << (missing % 8)))) missing++
        const detail = missing < count ? `; missing frame ${missing}` : ''
        throw new Error(`Hardware H.264 packet timing mismatch: expected ${count} frames at ${fps} fps, found ${packets}${detail}`)
    }
}

const hardwareProbes = new Set<string>()
const pendingHardwareProbes = new Map<string, Promise<boolean>>()

async function probeH264Encoder(
    encoder: HardwareH264Encoder,
    ffmpegPath: string,
    format: H264Format,
    options: H264SelectionOptions,
): Promise<boolean> {
    const { width, height, fps } = format
    const hw = hardwareEncoderArgs(encoder, format, options)
    const args = ['-nostdin', '-v', 'error', '-abort_on', 'empty_output', ...hw.inputPrefix, '-f', 'lavfi',
        '-i', `color=size=${width}x${height}:rate=${fps},format=rgba`,
        '-frames:v', '1', '-vf', `${COLOR_FILTER}${hw.filterSuffix}`,
        ...hw.codecArgs,
        ...(hw.pixFmt ? ['-pix_fmt', hw.pixFmt] : []), ...COLOR_TAGS, '-f', 'null', '-']
    const key = JSON.stringify([ffmpegPath, args])
    if (hardwareProbes.has(key)) return true
    // A cancellable caller owns its probe so aborting it cannot interrupt another export.
    let probe = options.signal ? undefined : pendingHardwareProbes.get(key)
    if (!probe) {
        probe = new Promise<boolean>((done, fail) => {
            const child = execFile(ffmpegPath, args, {
                timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 65536, signal: options.signal,
            }, error => {
                if (options.signal?.aborted) fail(abortError())
                else {
                    if (!error) hardwareProbes.add(key)
                    done(!error)
                }
            })
            child.stdin?.end()
        })
        if (!options.signal) pendingHardwareProbes.set(key, probe)
    }
    try {
        return await probe
    } finally {
        // Busy devices, timeouts and driver failures must be retryable in the same process.
        if (pendingHardwareProbes.get(key) === probe) pendingHardwareProbes.delete(key)
    }
}

/**
 * Resolve to an actual encoder after encoding one frame with the output format and settings.
 * Auto prefers VideoToolbox on macOS and NVENC elsewhere, with a software fallback. Any nonempty
 * CI or GITHUB_ACTIONS environment variable disables automatic hardware selection. Explicit requests
 * still probe in CI. Custom x264 tuning/parameters and nondefault CRF keep auto on software.
 */
export async function resolveH264Encoder(
    requested: H264EncoderRequest = 'libx264',
    ffmpegPath = 'ffmpeg',
    format: H264Format = { width: 1920, height: 1080, fps: 30 },
    options: H264SelectionOptions = {},
): Promise<H264Encoder> {
    if (options.signal?.aborted) throw abortError()
    if (options.videoToolboxQuality !== undefined) {
        if (requested !== 'videotoolbox') throw new Error('videoToolboxQuality requires h264Encoder: videotoolbox')
        if (!Number.isInteger(options.videoToolboxQuality) || options.videoToolboxQuality < 0 || options.videoToolboxQuality > 100)
            throw new Error('videoToolboxQuality must be an integer between 0 and 100')
    }
    if (requested === 'libx264') return requested
    if (requested !== 'auto' && !HARDWARE_H264_ENCODERS.includes(requested))
        throw new Error('h264Encoder must be libx264, videotoolbox, nvenc, vaapi, qsv, amf or auto')
    const { width, height, fps } = format
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value % 2 === 0)
        || !Number.isInteger(fps) || fps < 1 || fps > 120) throw new Error('Invalid H.264 probe dimensions or FPS')
    const crf = options.crf ?? 18
    const preset = options.preset ?? 'fast'
    if (!Number.isInteger(crf) || crf < 0 || crf > 51) throw new Error('crf must be an integer between 0 and 51')
    if (requested === 'auto' && (process.env.CI || process.env.GITHUB_ACTIONS || crf !== 18
        || options.tune !== undefined || options.x264Params !== undefined)) return 'libx264'

    const candidates: HardwareH264Encoder[] = requested === 'auto'
        ? platformHardwareCandidates()
        : [requested]
    for (const encoder of candidates) {
        const supported = options.x264Params === undefined && (encoder === 'videotoolbox'
            ? crf === 18 && (options.tune === undefined || options.tune === 'animation')
            : options.tune === undefined && crf > 0 && Object.hasOwn(NVENC_PRESETS, preset))
        if (!supported) continue
        const available = await probeH264Encoder(encoder, ffmpegPath, format, options)
        if (options.signal?.aborted) throw abortError()
        if (available) return encoder
    }
    if (options.requireH264Encoder && requested !== 'auto')
        throw new Error(`Requested H.264 encoder ${requested} is unavailable for these settings`)
    return 'libx264'
}

/** Probe all platform-relevant native hardware H.264 encoders for diagnostics (`vizmatic doctor`). */
export async function probeAvailableH264Encoders(
    ffmpegPath = 'ffmpeg',
    format: H264Format = { width: 1920, height: 1080, fps: 30 },
    signal?: AbortSignal,
): Promise<HardwareH264Encoder[]> {
    const candidates = platformHardwareCandidates()
    const results = await Promise.all(
        candidates.map(async (encoder) => (await probeH264Encoder(encoder, ffmpegPath, format, { signal })) ? encoder : null),
    )
    return results.filter((encoder): encoder is HardwareH264Encoder => encoder !== null)
}

function hasFfmpegOption(ffmpegPath: string, component: string, option: string): Promise<boolean> {
    const key = JSON.stringify([ffmpegPath, component, option])
    let answer = ffmpegOptions.get(key)
    if (!answer) {
        answer = new Promise<boolean>((done) => {
            // Close stdin so a wrapper that reads it can exit. A busy encoder may take time to answer.
            const child = execFile(ffmpegPath, ['-hide_banner', '-h', component], { maxBuffer: 1 << 20 }, (error, stdout) => {
                done(!error && stdout.includes(option))
            })
            child.stdin?.end()
        })
        ffmpegOptions.set(key, answer)
    }
    return answer
}

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
    return hasFfmpegOption(ffmpegPath, 'muxer=mp4', 'movie_timescale')
}

// IVF frames carry a fourcc, picture dimensions and integer presentation timestamps.
function rgbaIvfHeader(width: number, height: number, fps: number, frames: number): Buffer {
    const header = Buffer.alloc(32)
    header.write('DKIF')
    header.writeUInt16LE(32, 6)
    header.write('RGBA', 8)
    header.writeUInt16LE(width, 12)
    header.writeUInt16LE(height, 14)
    header.writeUInt32LE(fps, 16)
    header.writeUInt32LE(1, 20)
    header.writeUInt32LE(frames, 24)
    return header
}

function rgbaPacketHeader(bytes: number, index: number): Buffer {
    const header = Buffer.alloc(12)
    header.writeUInt32LE(bytes)
    header.writeBigUInt64LE(BigInt(index), 4)
    return header
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
    const repeat = options.frameIsRepeat
    if (repeat !== undefined && typeof repeat !== 'function') throw new Error('frameIsRepeat must be a function')
    if (repeat && (width > 65535 || height > 65535 || expectedBytes > 0x7fffffff || schedule.count > 0xffffffff)) {
        throw new Error('Timestamped RGBA frames exceed the IVF packet or header limits')
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
    if (options.x264Params !== undefined && (typeof options.x264Params !== 'string' || options.x264Params.length === 0)) {
        throw new Error('x264Params must be a non-empty string when provided')
    }
    if (options.audioOffset !== undefined && (!Number.isFinite(options.audioOffset) || options.audioOffset < 0)) {
        throw new Error('audioOffset must be a non-negative finite number of seconds')
    }
    if (!Number.isSafeInteger(threads) || threads < 1) throw new Error('threads must be a positive safe integer')
    if (options.audioPath !== undefined && (typeof options.audioPath !== 'string' || options.audioPath.length === 0)) {
        throw new Error('audioPath must be a non-empty path when provided')
    }
    if (options.signal?.aborted) throw abortError()

    if (codec !== 'h264' && (options.h264Encoder !== undefined || options.requireH264Encoder))
        throw new Error('h264Encoder applies only to H.264 output')
    const requested = options.h264Encoder ?? 'libx264'
    const h264Encoder = await resolveH264Encoder(requested, ffmpegPath, { width, height, fps }, options)

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
    const hw = codec === 'h264' && h264Encoder !== 'libx264'
        ? hardwareEncoderArgs(h264Encoder, { width, height, fps }, options)
        : null
    const args = [
        // If the encoder gets no frame, it must fail. Without this flag, it writes a movie with no frames
        // and reports success.
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-abort_on', 'empty_output',
        ...(hw ? hw.inputPrefix : []),
        ...(repeat
            ? ['-f', 'ivf', '-fpsprobesize', '0', '-probesize', '32', '-analyzeduration', '1']
            : ['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`, '-framerate', String(fps)]),
        '-i', 'pipe:0',
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
        const durationSeconds = schedule.duration / 1_000
        const chapters = options.chapters ?? []
        if (options.title || chapters.length > 0) {
            const path = join(outputDirectory, `.${basename(outputPath)}.${randomUUID()}.tmp.ffmeta`)
            await writeFile(path, chapterMetadata(options.title, chapters, durationSeconds), { mode: 0o600 })
            sidecars.push(path)
            args.push('-f', 'ffmetadata', '-i', path)
            metadataInput = inputs++
        }
        const srt = captionsToSrt(options.captions ?? [], durationSeconds)
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
    // VideoToolbox can reach the frame limit before FFmpeg finishes muxing AAC.
    // The input already ends at the last scheduled frame, including held frames.
    if (h264Encoder !== 'videotoolbox' || !options.audioPath) args.push('-frames:v', String(schedule.count))
    const baseFilter = repeat ? `${COLOR_FILTER},fps=${fps}` : COLOR_FILTER
    args.push('-t', seconds, '-vf', hw ? `${baseFilter}${hw.filterSuffix}` : baseFilter)
    if (codec === 'vp9') {
        // The quality mode needs a zero bitrate. Row threading makes VP9 practical at HD and above.
        args.push('-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-threads:v', String(threads))
    } else if (hw) {
        args.push(...hw.codecArgs)
    } else {
        args.push('-c:v', 'libx264', '-preset', preset)
        if (options.tune) args.push('-tune', options.tune)
        // Slow presets and the animation tune raise the reference frames, which raises the H.264
        // level. At 1080p60, more than 4 needs level 5, above the level 4.2 that Apple documents.
        if (options.tune === 'animation' || /slow|placebo/.test(preset)) args.push('-refs', '4')
        args.push('-crf', String(crf))
        if (options.x264Params) args.push('-x264-params', options.x264Params)
        args.push('-threads:v', String(threads))
    }
    const pixFmt = hw ? hw.pixFmt : 'yuv420p'
    if (pixFmt) args.push('-pix_fmt', pixFmt)
    args.push(...COLOR_TAGS)
    if (options.audioPath) {
        if (codec === 'vp9') args.push('-c:a', 'libopus', '-b:a', '160k', '-ar', '48000', '-ac', '2')
        // 384 kbit/s is what YouTube asks for in a stereo upload. A site encodes the sound again, so the file keeps more than a viewer needs.
        else {
            args.push('-c:a', 'aac', '-b:a', '384k', '-ar', '48000', '-ac', '2')
            // Noise reconstruction can produce isolated decoder-dependent spikes, even at this bitrate.
            if (await hasFfmpegOption(ffmpegPath, 'encoder=aac', '-aac_pns')) args.push('-aac_pns', '0')
        }
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

        const writeFrameBytes = (bytes: Buffer, index: number) => {
            const write = new Promise<void>((done, fail) => {
                input.write(bytes, error => error ? fail(error) : done())
            })
            return withAbort(observeEncoder(write, index, true), options.signal)
        }
        let packets = 0
        let lastPacket = -1
        let previous: Buffer | undefined
        if (repeat) await writeFrameBytes(rgbaIvfHeader(width, height, fps, schedule.count), 0)
        for (let index = 0; index < schedule.count; index++) {
            const info = frameInfo(index, schedule, fps)
            const rendered = await withAbort(observeEncoder(Promise.resolve(renderFrame(info)), index, false), options.signal)
            if (!(rendered instanceof Uint8Array) || rendered.byteLength !== expectedBytes) {
                throw new Error(`Frame ${index} must contain exactly ${expectedBytes} RGBA bytes`)
            }
            if (inputError) throw describeExit(null, null, inputError.message || stderr)

            const hint = repeat?.(info)
            let unchanged = hint === true
            if (hint === 'compare') {
                unchanged = previous?.equals(rendered) === true
                if (!unchanged) {
                    // A renderer may return a different view of storage it rewrites on the next draw.
                    previous ??= Buffer.allocUnsafeSlow(expectedBytes)
                    previous.set(rendered)
                }
            } else {
                previous = undefined
            }
            // A refresh bounds how far painting can run ahead of encoding during a long hold.
            // The last packet gives FFmpeg the exact end of the hold, including a one-frame film.
            if (!unchanged || index === 0 || index === schedule.count - 1 || index - lastPacket >= 16) {
                if (repeat) await writeFrameBytes(rgbaPacketHeader(expectedBytes, index), index)
                const pixels = Buffer.from(rendered.buffer, rendered.byteOffset, rendered.byteLength)
                await writeFrameBytes(pixels, index)
                lastPacket = index
                packets++
            } else if (hint === 'compare') {
                // Give Node a turn to release native readbacks when a hold skips the write.
                await yieldToEventLoop()
            }
            if (options.onProgress) {
                await withAbort(observeEncoder(Promise.resolve(options.onProgress(info)), index, false), options.signal)
            }
        }

        input.end()
        const exit = await withAbort(exited, options.signal)
        if (exit.error) throw new Error(`Unable to start FFmpeg: ${exit.error.message}`, { cause: exit.error })
        if (exit.code !== 0) throw describeExit(exit.code, exit.signal, stderr)

        if (h264Encoder !== 'libx264') await verifyHardwareFrames(ffmpegPath, tempPath, schedule.count, fps, options.signal)
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
            ...(repeat && { rgbaPackets: packets }),
            ...(codec === 'h264' ? { h264Encoder } : {}),
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
