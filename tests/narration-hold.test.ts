import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { renderNarrationHold } from '../src/stage-export'

it.skipIf(spawnSync('ffmpeg', ['-version']).status !== 0)('joins a take and demonstration on the exact stereo frame', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vizmatic-hold-'))
    try {
        const narration = join(dir, 'take.wav')
        execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.25:s=48000:d=0.05', narration])
        const sound = { samples: new Float32Array(1200).fill(-0.5), sampleRate: 48000 }
        const options = { narration, sound, speechFrames: 2111, holdFrames: 2113, output: join(dir, 'beat.flac') }
        await expect(renderNarrationHold({ ...options, holdFrames: 1199 })).rejects.toThrow('exceeds')
        await renderNarrationHold(options)
        const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', options.output, '-f', 's16le', '-'])
        expect(pcm.length).toBe((2111 + 2113) * 4)
        for (const channel of [0, 1]) {
            const sample = (frame: number) => pcm.readInt16LE(frame * 4 + channel * 2)
            expect(sample(2110)).toBeGreaterThan(0)
            expect(sample(2111)).toBe(-16384)
            expect(sample(3310)).toBe(-16384)
            expect(sample(3311)).toBe(0)
        }
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})
