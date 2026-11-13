import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { planAvcSplice } from '../src/avc-splice'

const toolsAvailable = ['ffprobe', 'ffmpeg'].every(tool => spawnSync(tool, ['-version']).status === 0)

it.skipIf(!toolsAvailable)('copies the selected closed GOP with B-frame timestamps and rejects an interior cut', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vizmatic-splice-'))
    try {
        const path = join(folder, "editor's movie.mp4")
        execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=96x64:r=24',
            '-frames:v', '24', '-c:v', 'libx264', '-threads', '1', '-x264-params', 'keyint=8:min-keyint=8:scenecut=0:bframes=2:b-adapt=0:open-gop=0', path])
        const segment = { path, startFrame: 8, endFrame: 16 }
        const plan = await planAvcSplice([segment, segment])
        expect(plan.frameCount).toBe(16)
        const hashes = (args: string[], input?: string) =>
            execFileSync('ffmpeg', ['-v', 'error', ...args, '-map', '0:v:0', '-threads', '1', '-f', 'framehash', '-'], { encoding: 'utf8', input })
                .split('\n').filter(line => line.startsWith('0,')).map(line => line.split(',').at(-1)?.trim())
        const source = hashes(['-i', path]).slice(8, 16)
        expect(hashes(['-copyts', '-safe', '0', '-auto_convert', '0', '-protocol_whitelist', 'file,pipe',
            '-f', 'concat', '-i', 'pipe:0'], plan.concatScript)).toEqual([...source, ...source])
        await expect(planAvcSplice([{ ...segment, startFrame: 9 }])).rejects.toThrow(/IDR/)
    } finally {
        await rm(folder, { recursive: true, force: true })
    }
})
