import { spawnSync } from 'child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderRgbaVideo, videoFrameSchedule } from '../src/video'

const tempDirs: string[] = []
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0
const hasFfprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function tempDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'vizmatic-video-test-'))
    tempDirs.push(directory)
    return directory
}

describe('RGBA video export', () => {
    it('schedules rounded frames without duplicating the final endpoint', () => {
        const frames = [...videoFrameSchedule(250, 10)]

        expect(frames.map(({ index, count, time, duration, progress }) => ({
            index, count, time, duration, progress,
        }))).toEqual([
            { index: 0, count: 3, time: 0, duration: 300, progress: 0 },
            { index: 1, count: 3, time: 100, duration: 300, progress: 1 / 3 },
            { index: 2, count: 3, time: 200, duration: 300, progress: 2 / 3 },
        ])
        expect(frames.at(-1)?.time).toBeLessThan(frames.at(-1)?.duration ?? 0)
    })

    it('rejects invalid dimensions and frame rates before starting FFmpeg', async () => {
        const outputPath = join(tmpdir(), 'vizmatic-invalid-video.mp4')
        const renderFrame = () => new Uint8Array(4)

        await expect(renderRgbaVideo(renderFrame, {
            width: 3, height: 2, duration: 100, outputPath,
        })).rejects.toThrow('width must be a positive even integer')
        await expect(renderRgbaVideo(renderFrame, {
            width: 2, height: 2, duration: 100, fps: 121, outputPath,
        })).rejects.toThrow('fps must be an integer between 1 and 120')
        await expect(renderRgbaVideo(renderFrame, {
            width: 2, height: 2, duration: 1, fps: 30, outputPath,
        })).rejects.toThrow('duration must round to at least one frame')
    })

    it.skipIf(!hasFfmpeg)('writes a small H.264 MP4 with optional padded AAC audio', async () => {
        const directory = await tempDirectory()
        const outputPath = join(directory, 'lesson.mp4')
        const audioPath = join(directory, 'short-audio.wav')
        const generatedAudio = spawnSync('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.05',
            '-c:a', 'pcm_s16le', audioPath,
        ], { encoding: 'utf8' })
        expect(generatedAudio.status, generatedAudio.stderr).toBe(0)

        const progress: number[] = []
        const reusablePixels = new Uint8Array(64 * 48 * 4)
        const result = await renderRgbaVideo(({ index }) => {
            for (let offset = 0; offset < reusablePixels.length; offset += 4) {
                reusablePixels[offset] = index === 0 ? 30 : 220
                reusablePixels[offset + 1] = 100
                reusablePixels[offset + 2] = 180
                reusablePixels[offset + 3] = 255
            }
            return reusablePixels
        }, {
            width: 64,
            height: 48,
            duration: 250,
            fps: 10,
            outputPath,
            audioPath,
            onProgress: ({ progress: value }) => { progress.push(value) },
        })

        expect(result).toMatchObject({
            width: 64,
            height: 48,
            frameCount: 3,
            duration: 300,
            fps: 10,
            outputPath,
            audioIncluded: true,
        })
        expect(result.bytes).toBeGreaterThan(500)
        expect(progress).toEqual([0, 1 / 3, 2 / 3])
        expect((await readFile(outputPath)).subarray(4, 8).toString('ascii')).toBe('ftyp')

        if (hasFfprobe) {
            const probe = spawnSync('ffprobe', [
                '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', outputPath,
            ], { encoding: 'utf8' })
            expect(probe.status, probe.stderr).toBe(0)
            const metadata = JSON.parse(probe.stdout) as {
                streams: Array<Record<string, unknown>>
                format: Record<string, string>
            }
            const video = metadata.streams.find((stream) => stream.codec_type === 'video')
            const audio = metadata.streams.find((stream) => stream.codec_type === 'audio')
            expect(video).toMatchObject({
                codec_name: 'h264',
                pix_fmt: 'yuv420p',
                width: 64,
                height: 48,
                nb_read_frames: '3',
            })
            expect(audio).toMatchObject({ codec_name: 'aac', sample_rate: '48000', channels: 2 })
            expect(Number(metadata.format.duration)).toBeCloseTo(0.3, 2)
        }
    }, 30_000)

    it.skipIf(!hasFfmpeg)('preserves an existing output when frame rendering fails', async () => {
        const directory = await tempDirectory()
        const outputPath = join(directory, 'lesson.mp4')
        await writeFile(outputPath, 'previous output')

        await expect(renderRgbaVideo(({ index }) => {
            if (index === 1) throw new Error('scene painter failed')
            return new Uint8Array(32 * 24 * 4)
        }, {
            width: 32,
            height: 24,
            duration: 200,
            fps: 10,
            outputPath,
        })).rejects.toThrow('scene painter failed')

        expect(await readFile(outputPath, 'utf8')).toBe('previous output')
        expect(await readdir(directory)).toEqual(['lesson.mp4'])
    }, 30_000)

    it.skipIf(!hasFfmpeg)('stops FFmpeg and removes its temporary file on abort', async () => {
        const directory = await tempDirectory()
        const outputPath = join(directory, 'lesson.mp4')
        await writeFile(outputPath, 'previous output')
        const controller = new AbortController()
        const pending = renderRgbaVideo(() => new Promise<Uint8Array>(() => {}), {
            width: 32,
            height: 24,
            duration: 10_000,
            outputPath,
            signal: controller.signal,
        })
        setTimeout(() => controller.abort(), 30)

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
        expect(await readFile(outputPath, 'utf8')).toBe('previous output')
        expect(await readdir(directory)).toEqual(['lesson.mp4'])
    }, 30_000)
})
