import { spawnSync } from 'child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'

const tempDirs: string[] = []
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0
const hasFfprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function runVideoCli(source: string, options: string[] = [], prepare?: (directory: string) => void) {
    const directory = await mkdtemp(join(tmpdir(), 'vizmatic-cli-video-'))
    tempDirs.push(directory)
    await writeFile(join(directory, 'motion.tsx'), source)
    prepare?.(directory)
    const env: NodeJS.ProcessEnv = { ...process.env, VIZMATIC_DISABLE_NETWORK: '1' }
    delete env.NODE_OPTIONS
    for (const key of Object.keys(env)) {
        if (key.startsWith('TSX_') || key.startsWith('VITEST')) delete env[key]
    }
    const renderDir = join(directory, 'videos')
    const result = spawnSync(process.execPath, [
        '--import', 'tsx', resolve('src/cli.ts'), 'video', join(directory, 'motion.tsx'),
        '--out', renderDir, ...options.map((option) => option.replace('{directory}', directory)),
    ], { cwd: process.cwd(), encoding: 'utf8', env })
    return { result, renderDir }
}

const animatedSource = `import React from 'react'
import { defineAnimation, tween, getThemeColors } from 'vizmatic'
export const width = 64
export const height = 48
export function createAnimation(theme) {
    const c = getThemeColors(theme)
    return defineAnimation({
        initial: { x: 0 },
        timeline: [tween({ x: 40 }, { duration: 100 })],
        render: ({ x }) => <div style={{ display: 'flex', width, height, color: c.textPrimary }}>
            <div style={{ display: 'flex', position: 'absolute', left: x, top: 8, width: 16, height: 16, backgroundColor: c.secondary }} />
        </div>,
    })
}
`

describe('CLI video export', () => {
    it.skipIf(!hasFfmpeg)('encodes both themes at 60 fps with scaling and supplied audio', async () => {
        const { result, renderDir } = await runVideoCli(animatedSource, [
            '--theme', 'dark,light', '--fps', '60', '--scale', '2',
            '--audio', '{directory}/tone.wav', '--crf', '20', '--preset', 'ultrafast', '--threads', '1',
        ], (directory) => {
            const audio = spawnSync('ffmpeg', [
                '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
                '-i', 'sine=frequency=440:duration=0.02', join(directory, 'tone.wav'),
            ], { encoding: 'utf8' })
            expect(audio.status, audio.stderr).toBe(0)
        })
        expect(result.status, result.stderr || result.stdout).toBe(0)
        const manifest = JSON.parse(await readFile(join(renderDir, 'video-manifest.json'), 'utf8'))
        expect(manifest[0]).toMatchObject({ width: 64, height: 48, outputs: ['motion_dark.mp4', 'motion_light.mp4'] })
        expect(manifest[0].outputDetails).toMatchObject([
            { theme: 'dark', width: 128, height: 96, fps: 60, duration: 100, frameCount: 6, audioIncluded: true },
            { theme: 'light', width: 128, height: 96, fps: 60, duration: 100, frameCount: 6, audioIncluded: true },
        ])
        for (const theme of ['dark', 'light']) {
            const outputPath = join(renderDir, `motion_${theme}.mp4`)
            expect((await readFile(outputPath)).subarray(4, 8).toString('ascii')).toBe('ftyp')
            if (hasFfprobe) {
                const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', outputPath], { encoding: 'utf8' })
                expect(probe.status, probe.stderr).toBe(0)
                const streams = JSON.parse(probe.stdout).streams
                expect(streams.find((stream: { codec_type: string }) => stream.codec_type === 'video'))
                    .toMatchObject({ codec_name: 'h264', r_frame_rate: '60/1', nb_read_frames: '6', width: 128, height: 96 })
                expect(streams.find((stream: { codec_type: string }) => stream.codec_type === 'audio'))
                    .toMatchObject({ codec_name: 'aac' })
            }
        }
    }, 30_000)

    it('explains unsupported static inputs and alpha backgrounds', async () => {
        const staticInput = await runVideoCli(`export const create = () => null`, ['--theme', 'dark'])
        expect(staticInput.result.status).toBe(1)
        expect(staticInput.result.stderr).toContain('must export createAnimation(theme) for video rendering')

        const transparentInput = await runVideoCli(animatedSource, ['--theme', 'dark', '--background', 'transparent'])
        expect(transparentInput.result.status).toBe(1)
        expect(transparentInput.result.stderr).toContain('MP4 requires an opaque background')
        expect(await readdir(transparentInput.renderDir)).toEqual([])
    }, 30_000)

    it('reports a missing FFmpeg executable and removes temporary output', async () => {
        const { result, renderDir } = await runVideoCli(animatedSource, [
            '--theme', 'dark', '--ffmpeg', '/missing-vizmatic-ffmpeg',
        ])
        expect(result.status).toBe(1)
        expect(result.stderr).toContain('Unable to start FFmpeg: spawn /missing-vizmatic-ffmpeg ENOENT')
        expect(await readdir(renderDir)).toEqual([])
    }, 30_000)
})
