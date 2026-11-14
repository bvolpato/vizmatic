import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { planMediaExcerpt } from '../src/media-excerpt'

function ffmpeg(args: string[]) {
    return execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-threads', '1', '-filter_threads', '1', ...args],
        { maxBuffer: 4 * 1024 * 1024 })
}

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

it.skipIf(!hasFfmpeg)('cuts the displayed frames and both AAC channels at their source offsets', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vizmatic-excerpt-'))
    try {
        const source = join(folder, 'source.mp4')
        // Put an IDR at second four and the two swept tones on separate channels.
        ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=30:duration=6',
            '-f', 'lavfi', '-i', 'aevalsrc=0.3*sin(2*PI*(180*t+27*t*t))|0.4*sin(2*PI*(310*t+33*t*t)):s=48000:d=6',
            '-c:v', 'libx264', '-threads:v', '1', '-g', '30', '-bf', '0', '-sc_threshold', '0',
            '-c:a', 'aac', '-b:a', '256k', '-aac_pns', '0', source])
        const audio = ['-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 's16le', '-']
        const video = ['-map', '0:v:0', '-pix_fmt', 'gray', '-c:v', 'rawvideo', '-threads:v', '1', '-f', 'rawvideo', '-']
        const fromOrigin = ['-i', source]
        const pcm = ffmpeg([...fromOrigin, ...audio])
        const pictures = ffmpeg([...fromOrigin, ...video])
        const cut = planMediaExcerpt({ fps: 30, sampleRate: 48000, startFrame: 135, frameCount: 17 })
        const input = [...cut.inputArgs, '-i', source]
        const cutPcm = ffmpeg([...input, '-af', cut.audioFilter, ...audio])
        const cutPictures = ffmpeg([...input, '-vf', cut.videoFilter, ...video])
        // Each stereo sample occupies four bytes. Slice the independent full decodes at [135, 152).
        expect(cutPcm.equals(pcm.subarray(216000 * 4, 243200 * 4))).toBe(true)
        expect(cutPictures.equals(pictures.subarray(135 * 64 * 48, 152 * 64 * 48))).toBe(true)
    } finally {
        await rm(folder, { recursive: true, force: true })
    }
})

it.skipIf(!hasFfmpeg)('keeps adjacent excerpts contiguous when a frame ends between samples', () => {
    const source = ['-f', 'lavfi', '-i', 'sine=sample_rate=44100:duration=0.1']
    const audio = ['-c:a', 'pcm_s16le', '-f', 's16le', '-']
    const clock = { fps: 24, sampleRate: 44100, frameCount: 1 }
    const parts = [0, 1].map(startFrame => {
        const cut = planMediaExcerpt({ ...clock, startFrame })
        return ffmpeg([...cut.inputArgs, ...source, '-af', cut.audioFilter, ...audio])
    })
    // The first frame ends halfway between samples 1837 and 1838.
    expect(parts[0].length).toBe(1838 * 2)
    expect(Buffer.concat(parts).equals(ffmpeg([...source, ...audio]).subarray(0, 3675 * 2))).toBe(true)
})
