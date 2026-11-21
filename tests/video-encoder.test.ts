import { spawnSync } from 'child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderFilmVideo } from '../src/stage/export'
import { film } from '../src/stage/stage'
import { platformHardwareCandidates, renderRgbaVideo, resolveH264Encoder, type H264EncoderRequest } from '../src/video'

const directories: string[] = []
const format = { width: 192, height: 128, fps: 30 }
const onCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS)
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

beforeEach(() => {
    vi.stubEnv('CI', '')
    vi.stubEnv('GITHUB_ACTIONS', '')
})

afterEach(async () => {
    vi.unstubAllEnvs()
    await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function directory(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), 'vizmatic-encoder-test-'))
    directories.push(path)
    return path
}

/** A controllable encoder process, so selection and cancellation run on CPU-only CI too. */
async function encoder(config: { failures?: number; delay?: number; failRender?: boolean } = {}) {
    const path = await directory()
    const ffmpegPath = join(path, 'ffmpeg')
    await writeFile(ffmpegPath, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const log = path.join(__dirname, 'calls.jsonl');
const config = ${JSON.stringify(config)};
const previous = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').map(JSON.parse) : [];
const probe = args.includes('lavfi');
fs.appendFileSync(log, JSON.stringify({ args, pid: process.pid }) + '\\n');
if (probe) {
    const count = previous.filter(call => call.args.includes('lavfi')).length;
    setTimeout(() => process.exit(count < (config.failures || 0) ? 1 : 0), config.delay || 0);
} else if (args.includes('framecrc')) {
    process.stdout.write('#tb 0: 1/30\\n0, 0, 0, 1, 1, 0\\n0, 1, 1, 1, 1, 0\\n0, 2, 2, 1, 1, 0\\n');
} else if (args.includes('rawvideo') || args.includes('ivf')) {
    process.stdin.resume();
    process.stdin.on('end', () => {
        if (config.failRender) process.exit(1);
        fs.writeFileSync(args.at(-1), 'encoded movie');
    });
}
`, { mode: 0o755 })
    const calls = async (): Promise<{ args: string[]; pid: number }[]> => {
        try {
            return (await readFile(join(path, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
            throw error
        }
    }
    return { path, ffmpegPath, calls }
}

const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

describe('H.264 encoder selection', () => {
    it('probes actual dimensions, frame rate, conversion and quality; caches only that configuration', async () => {
        const fake = await encoder()
        const quality = { crf: 16, preset: 'slow' }
        expect(await resolveH264Encoder('nvenc', fake.ffmpegPath, format, quality)).toBe('nvenc')
        expect(await resolveH264Encoder('nvenc', fake.ffmpegPath, format, quality)).toBe('nvenc')
        expect(await resolveH264Encoder('nvenc', fake.ffmpegPath, { ...format, width: 256 }, quality)).toBe('nvenc')
        expect(await resolveH264Encoder('nvenc', fake.ffmpegPath, format, { ...quality, crf: 20 })).toBe('nvenc')
        const calls = await fake.calls()
        expect(calls).toHaveLength(3)
        expect(value(calls[0]!.args, '-i')).toBe('color=size=192x128:rate=30,format=rgba')
        expect(value(calls[0]!.args, '-vf')).toContain('out_color_matrix=bt709')
        expect(value(calls[0]!.args, '-pix_fmt')).toBe('yuv420p')
        expect(value(calls[0]!.args, '-c:v')).toBe('h264_nvenc')
        expect(value(calls[0]!.args, '-preset')).toBe('p7')
        expect(value(calls[0]!.args, '-cq')).toBe('16')
        expect(value(calls[2]!.args, '-cq')).toBe('20')
    })

    it('shares uncancelled probes and retries failures without poisoning the cache', async () => {
        const fake = await encoder({ failures: 1, delay: 40 })
        expect(await Promise.all([1, 2].map(() => resolveH264Encoder('nvenc', fake.ffmpegPath, format))))
            .toEqual(['libx264', 'libx264'])
        expect(await fake.calls()).toHaveLength(1)
        expect(await resolveH264Encoder('nvenc', fake.ffmpegPath, format)).toBe('nvenc')
        expect(await resolveH264Encoder('nvenc', fake.ffmpegPath, format)).toBe('nvenc')
        expect(await fake.calls()).toHaveLength(2)
    })

    it.each(['CI', 'GITHUB_ACTIONS'])('keeps auto on software under %s, even after a cached hardware success', async name => {
        const fake = await encoder()
        expect(await resolveH264Encoder('nvenc', fake.ffmpegPath, format)).toBe('nvenc')
        vi.stubEnv(name, 'true')
        expect(await resolveH264Encoder('auto', fake.ffmpegPath, format, { requireH264Encoder: true })).toBe('libx264')
        expect(await resolveH264Encoder('nvenc', fake.ffmpegPath, { ...format, width: 256 }, { requireH264Encoder: true })).toBe('nvenc')
        expect(await fake.calls()).toHaveLength(2)
    })

    it('selects local hardware automatically and reports only the actual backend', async () => {
        const fake = await encoder()
        const selected = process.platform === 'darwin' ? 'videotoolbox' : 'nvenc'
        expect(await resolveH264Encoder('auto', fake.ffmpegPath, format)).toBe(selected)
        const output = await renderRgbaVideo(() => new Uint8Array(format.width * format.height * 4), {
            ...format, duration: 100, outputPath: join(fake.path, 'movie.mp4'), ffmpegPath: fake.ffmpegPath,
            h264Encoder: 'auto', requireH264Encoder: true,
        })
        expect(output.h264Encoder).toBe(selected)
    })

    it('allows auto to fall back when every local hardware probe fails', async () => {
        const fake = await encoder({ failures: 10 })
        expect(await resolveH264Encoder('auto', fake.ffmpegPath, format, { requireH264Encoder: true })).toBe('libx264')
        expect(await fake.calls()).toHaveLength(platformHardwareCandidates().length)
    })

    it('supports explicit vaapi, qsv, and amf native hardware H.264 encoders', async () => {
        const fake = await encoder()
        expect(await resolveH264Encoder('vaapi', fake.ffmpegPath, format, { crf: 20 })).toBe('vaapi')
        expect(await resolveH264Encoder('qsv', fake.ffmpegPath, format, { crf: 19, preset: 'medium' })).toBe('qsv')
        expect(await resolveH264Encoder('amf', fake.ffmpegPath, format, { crf: 22, preset: 'slow' })).toBe('amf')
        const calls = await fake.calls()
        expect(calls).toHaveLength(3)
        expect(value(calls[0]!.args, '-c:v')).toBe('h264_vaapi')
        expect(value(calls[0]!.args, '-vf')).toContain('format=nv12,hwupload')
        expect(value(calls[0]!.args, '-qp')).toBe('20')
        expect(calls[0]!.args).toContain('-vaapi_device')
        expect(value(calls[1]!.args, '-c:v')).toBe('h264_qsv')
        expect(value(calls[1]!.args, '-global_quality')).toBe('19')
        expect(value(calls[1]!.args, '-pix_fmt')).toBe('nv12')
        expect(value(calls[2]!.args, '-c:v')).toBe('h264_amf')
        expect(value(calls[2]!.args, '-quality')).toBe('quality')
        expect(value(calls[2]!.args, '-qp_i')).toBe('22')
    })

    it('selects local hardware automatically for standard film exports when auto is requested', async () => {
        const fake = await encoder()
        const movie = film({ ...format, bloom: 0 }, s => { s.wait(0.1) })
        const result = await renderFilmVideo(movie, join(fake.path, 'auto-hw.mp4'), {
            width: format.width, backend: 'cpu', workers: 1, motionBlur: 1, quality: 'standard',
            h264Encoder: 'auto', ffmpegPath: fake.ffmpegPath,
        })
        const expected = platformHardwareCandidates()[0]
        expect(result.h264Encoder).toBe(expected)
    })

    it.each([{ tune: 'grain' }, { tune: 'animation' }, { x264Params: 'aq-strength=1.0' }, { crf: 16 }, { crf: 0 }])
        ('preserves quality settings with software in auto mode: %j', async quality => {
            const fake = await encoder()
            expect(await resolveH264Encoder('auto', fake.ffmpegPath, format, quality)).toBe('libx264')
            expect(await fake.calls()).toEqual([])
        })

    it.each([{ tune: 'grain' }, { tune: 'animation' }, { x264Params: 'trellis=0' }, { crf: 0 }, { preset: 'unknown' }])
        ('never silently discards unsupported explicit NVENC settings: %j', async quality => {
            const fake = await encoder()
            expect(await resolveH264Encoder('nvenc', fake.ffmpegPath, format, quality)).toBe('libx264')
            await expect(resolveH264Encoder('nvenc', fake.ffmpegPath, format, { ...quality, requireH264Encoder: true }))
                .rejects.toThrow('Requested H.264 encoder nvenc is unavailable for these settings')
            expect(await fake.calls()).toEqual([])
        })

    it('preserves VideoToolbox quality fallback and the default software API', async () => {
        const fake = await encoder()
        expect(await resolveH264Encoder()).toBe('libx264')
        for (const quality of [{ crf: 16 }, { tune: 'grain' }, { x264Params: 'trellis=0' }]) {
            expect(await resolveH264Encoder('videotoolbox', fake.ffmpegPath, format, quality)).toBe('libx264')
        }
        expect(await fake.calls()).toEqual([])
        expect(await resolveH264Encoder('videotoolbox', fake.ffmpegPath, format, { tune: 'animation' })).toBe('videotoolbox')
    })

    it('probes and encodes a high-quality film with the native VideoToolbox quality', async () => {
        const fake = await encoder()
        const movie = film({ ...format, bloom: 0.2 }, s => { s.wait(0.1) })
        const result = await renderFilmVideo(movie, join(fake.path, 'high.mp4'), {
            width: format.width, backend: 'cpu', workers: 1, motionBlur: 1, quality: 'high', dither: true,
            h264Encoder: 'videotoolbox', requireH264Encoder: true, ffmpegPath: fake.ffmpegPath,
        })
        expect(result.h264Encoder).toBe('videotoolbox')
        const calls = await fake.calls()
        for (const kind of ['lavfi', 'ivf']) {
            const args = calls.find(call => call.args.includes(kind))!.args
            expect(value(args, '-c:v')).toBe('h264_videotoolbox')
            expect(value(args, '-q:v')).toBe('90')
            expect(value(args, '-allow_sw')).toBe('0')
            expect(args).not.toContain('-x264-params')
        }
    })

    it('retains the high-quality software settings when optional VideoToolbox is unavailable', async () => {
        const fake = await encoder({ failures: 1 })
        const movie = film({ ...format, bloom: 0.2 }, s => { s.wait(0.1) })
        const result = await renderFilmVideo(movie, join(fake.path, 'fallback.mp4'), {
            width: format.width, backend: 'cpu', workers: 1, motionBlur: 1,
            quality: 'high', look: 'midnight', dither: true, h264Encoder: 'videotoolbox', ffmpegPath: fake.ffmpegPath,
        })
        expect(result.h264Encoder).toBe('libx264')
        const args = (await fake.calls()).find(call => call.args.includes('ivf'))!.args
        expect(value(args, '-crf')).toBe('15')
        expect(value(args, '-x264-params')).toContain('trellis=0')
        expect(args).not.toContain('-q:v')
    })

    it('falls back before rendering, but a required unavailable encoder preserves the previous movie', async () => {
        const fake = await encoder({ failures: 10 })
        const outputPath = join(fake.path, 'movie.mp4')
        const paint = vi.fn(() => new Uint8Array(format.width * format.height * 4))
        const options = { ...format, duration: 100, outputPath, ffmpegPath: fake.ffmpegPath, h264Encoder: 'nvenc' as const }
        const output = await renderRgbaVideo(paint, options)
        expect(output.h264Encoder).toBe('libx264')
        expect(paint).toHaveBeenCalledTimes(3)
        await writeFile(outputPath, 'previous movie')
        await expect(renderRgbaVideo(paint, { ...options, requireH264Encoder: true })).rejects.toThrow('unavailable')
        expect(paint).toHaveBeenCalledTimes(3)
        expect(await readFile(outputPath, 'utf8')).toBe('previous movie')
        const render = (await fake.calls()).find(call => call.args.includes('rawvideo'))!
        expect(value(render.args, '-c:v')).toBe('libx264')
    })

    it('uses the probed NVENC quality and color settings for the actual render', async () => {
        const fake = await encoder()
        const result = await renderRgbaVideo(() => new Uint8Array(format.width * format.height * 4), {
            ...format, duration: 100, outputPath: join(fake.path, 'movie.mp4'), ffmpegPath: fake.ffmpegPath,
            h264Encoder: 'nvenc', requireH264Encoder: true, preset: 'medium', crf: 14,
        })
        expect(result.h264Encoder).toBe('nvenc')
        const calls = await fake.calls()
        const probe = calls.find(call => call.args.includes('lavfi'))!.args
        const render = calls.find(call => call.args.includes('rawvideo'))!.args
        for (const flag of ['-c:v', '-preset', '-tune', '-profile:v', '-rc', '-cq', '-b:v', '-vf', '-pix_fmt', '-colorspace']) {
            expect(value(render, flag), flag).toBe(value(probe, flag))
        }
        expect(value(render, '-preset')).toBe('p6')
        expect(value(render, '-cq')).toBe('14')
        expect(value(render, '-rc')).toBe('vbr')
        expect(value(render, '-b:v')).toBe('0')
    })

    it('aborts before starting a probe or drawing, including software and cached selections', async () => {
        const fake = await encoder()
        await resolveH264Encoder('nvenc', fake.ffmpegPath, format)
        const signal = AbortSignal.abort()
        for (const requested of ['libx264', 'nvenc', 'auto'] as const) {
            await expect(resolveH264Encoder(requested, fake.ffmpegPath, format, { signal })).rejects.toMatchObject({ name: 'AbortError' })
        }
        const paint = vi.fn()
        await expect(renderRgbaVideo(paint, {
            ...format, duration: 100, outputPath: join(fake.path, 'movie.mp4'), ffmpegPath: fake.ffmpegPath,
            h264Encoder: 'nvenc', signal,
        })).rejects.toMatchObject({ name: 'AbortError' })
        expect(paint).not.toHaveBeenCalled()
        expect(await fake.calls()).toHaveLength(1)
    })

    it('kills a cancelled probe, does not cache its result and allows a later retry', async () => {
        const fake = await encoder({ delay: 2000 })
        const controller = new AbortController()
        const probe = resolveH264Encoder('nvenc', fake.ffmpegPath, format, { signal: controller.signal })
        const rejection = expect(probe).rejects.toMatchObject({ name: 'AbortError' })
        await vi.waitFor(async () => expect(await fake.calls()).toHaveLength(1), { timeout: 5000 })
        controller.abort()
        await rejection
        const [{ pid }] = await fake.calls()
        await vi.waitFor(() => expect(() => process.kill(pid!, 0)).toThrow(), { timeout: 5000 })
        expect(await resolveH264Encoder('nvenc', fake.ffmpegPath, format)).toBe('nvenc')
        expect(await fake.calls()).toHaveLength(2)
    })

    it('cancels one export without aborting another caller probing the same format', async () => {
        const fake = await encoder({ delay: 2000 })
        const controller = new AbortController()
        const privateProbe = resolveH264Encoder('nvenc', fake.ffmpegPath, format, { signal: controller.signal })
        const rejection = expect(privateProbe).rejects.toMatchObject({ name: 'AbortError' })
        const sharedProbe = resolveH264Encoder('nvenc', fake.ffmpegPath, format)
        await vi.waitFor(async () => expect(await fake.calls()).toHaveLength(2), { timeout: 5000 })
        controller.abort()
        await rejection
        expect(await sharedProbe).toBe('nvenc')
        expect(await resolveH264Encoder('nvenc', fake.ffmpegPath, format)).toBe('nvenc')
        expect(await fake.calls()).toHaveLength(2)
    })

    it('does not restart painting with software if hardware fails after a successful probe', async () => {
        const fake = await encoder({ failRender: true })
        const outputPath = join(fake.path, 'movie.mp4')
        await writeFile(outputPath, 'previous movie')
        const paint = vi.fn(() => new Uint8Array(format.width * format.height * 4))
        await expect(renderRgbaVideo(paint, {
            ...format, duration: 100, outputPath, ffmpegPath: fake.ffmpegPath, h264Encoder: 'nvenc',
        })).rejects.toThrow('FFmpeg failed')
        expect(paint).toHaveBeenCalledTimes(3)
        expect((await fake.calls()).filter(call => call.args.includes('rawvideo'))).toHaveLength(1)
        expect(await readFile(outputPath, 'utf8')).toBe('previous movie')
        expect((await readdir(fake.path)).some(name => name.includes('.tmp.'))).toBe(false)
    })

    it('rejects unknown encoders and invalid hardware probe formats before spawning', async () => {
        const fake = await encoder()
        await expect(resolveH264Encoder('cuda' as H264EncoderRequest, fake.ffmpegPath, format)).rejects.toThrow('h264Encoder must be')
        await expect(resolveH264Encoder('nvenc', fake.ffmpegPath, { ...format, width: 191 })).rejects.toThrow('Invalid H.264 probe')
        await expect(resolveH264Encoder('nvenc', fake.ffmpegPath, format, { crf: 52 })).rejects.toThrow('crf must be')
        await expect(resolveH264Encoder('videotoolbox', fake.ffmpegPath, format, { videoToolboxQuality: 101 })).rejects.toThrow('videoToolboxQuality must be')
        expect(await fake.calls()).toEqual([])
    })

    it.skipIf(!hasFfmpeg)('keeps dither and fine-line grain tuning byte-identical to explicit software output', async () => {
        const path = await directory()
        const pixels = new Uint8Array(format.width * format.height * 4)
        for (let y = 0; y < format.height; y++) {
            for (let x = 0; x < format.width; x++) {
                const shade = x === 96 || y === 64 ? 240 : 40 + Math.floor(x / 4) + (x + y) % 2
                pixels.set([shade, shade, shade, 255], (y * format.width + x) * 4)
            }
        }
        const options = { ...format, duration: 100, tune: 'grain', preset: 'slow', crf: 16, x264Params: 'aq-strength=1.0' }
        const software = join(path, 'software.mp4')
        const automatic = join(path, 'automatic.mp4')
        await renderRgbaVideo(() => pixels, { ...options, outputPath: software, h264Encoder: 'libx264' })
        const output = await renderRgbaVideo(() => pixels, { ...options, outputPath: automatic, h264Encoder: 'auto' })
        expect(output.h264Encoder).toBe('libx264')
        expect(await readFile(automatic)).toEqual(await readFile(software))
    })

    it.skipIf(onCI || !hasFfmpeg)('encodes real NVENC frames with BT.709 colors and verifies presentation times', async ({ skip }) => {
        if (await resolveH264Encoder('nvenc', 'ffmpeg', format) !== 'nvenc') return skip()
        const outputPath = join(await directory(), 'nvenc.mp4')
        const pixels = new Uint8Array(format.width * format.height * 4)
        for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([230, 190, 40, 255], offset)
        const output = await renderRgbaVideo(() => pixels, {
            ...format, duration: 100, outputPath, h264Encoder: 'nvenc', requireH264Encoder: true,
        })
        expect(output.h264Encoder).toBe('nvenc')
        expect(output.frameCount).toBe(3)
        const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
        expect(decoded.status, decoded.stderr.toString()).toBe(0)
        const center = (64 * format.width + 96) * 3
        for (const [channel, expected] of [230, 190, 40].entries()) {
            expect(Math.abs(decoded.stdout[center + channel]! - expected)).toBeLessThan(8)
        }
    })
})
