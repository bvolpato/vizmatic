import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderSceneFrame, renderSceneVideo } from '../src/scene-renderer'
import { SCENE_COMPONENT_NAMES } from '../src/scene-components'
import * as primitives from '../src/primitives'

const directories: string[] = []
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0
const source = `const x = lerp(20,100,ease(progress));
<svg width={width} height={height} viewBox="0 0 160 90">
  <rect width={160} height={90} fill={c.bg}/>
  <circle cx={x} cy={25} r={10} fill={c.info}/>
  <text x={8} y={68} fill={c.textPrimary} fontSize={15} fontFamily="Inter">Native SVG text</text>
</svg>`
const base = { source, width: 160, height: 90, duration: 0.5, fps: 8, theme: 'dark' as const }

async function directory(): Promise<string> {
    const result = await mkdtemp(join(tmpdir(), 'vizmatic-safe-scene-'))
    directories.push(result)
    return result
}

afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('safe scene rasterization', () => {
    it('registers the real Vizmatic JSX primitives without exposing Node APIs', () => {
        expect(SCENE_COMPONENT_NAMES).toEqual(Object.entries(primitives).filter(([name, value]) => /^[A-Z]/.test(name) && typeof value === 'function').map(([name]) => name).sort())
    })

    it('renders native SVG text deterministically offline and binds output bytes and preview time', async () => {
        const path = await directory()
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is forbidden'))
        const first = await renderSceneFrame({ ...base, time: 0.25, outputPath: join(path, 'first.png') })
        const second = await renderSceneFrame({ ...base, time: 0.25, outputPath: join(path, 'second.png') })
        const other = await renderSceneFrame({ ...base, time: 0, outputPath: join(path, 'other.png') })
        const data = await readFile(first.outputPath)
        expect(data.subarray(1, 4).toString()).toBe('PNG')
        expect(hash(data)).toBe(first.assetSha256)
        expect(first.assetSha256).toBe(second.assetSha256)
        expect(first.inputSha256).toBe(second.inputSha256)
        expect(first.inputSha256).not.toBe(other.inputSha256)
        expect(first.assetSha256).not.toBe(other.assetSha256)
        expect(first.fontAssetsSha256).toMatch(/^[a-f0-9]{64}$/)
        expect(first.time).toBe(0.25)
        expect(fetchSpy).not.toHaveBeenCalled()
        const noText = await renderSceneFrame({ ...base, source: source.replace(/<text[\s\S]*?<\/text>/, ''), outputPath: join(path, 'no-text.png'), time: 0.25 })
        expect(noText.assetSha256).not.toBe(first.assetSha256)
    })

    it('renders trusted components and raw SVG with labels inside a layout', async () => {
        const path = await directory()
        const result = await renderSceneFrame({ ...base, source: '<Board width={width} height={height}><CanvasItem x={4} y={4} width={140} height={70}><Box label="Native" fontSize={18}/></CanvasItem><svg width={16} height={16}><circle cx={8} cy={8} r={5} fill={c.info}/></svg></Board>', outputPath: join(path, 'components.png') })
        expect(result.bytes).toBeGreaterThan(100)
    })

    it('bounds aggregate nested raster allocations before creating a large frame', async () => {
        const path = await directory()
        const outputPath = join(path, 'output.png')
        await writeFile(outputPath, 'preserved')
        await expect(renderSceneFrame({ ...base, source: '<div style={{display:"flex"}}>{Array.from({length:5},()=> <svg width={width} height={height}><rect width={width} height={height}/></svg>)}</div>', outputPath })).rejects.toThrow('pixel or image budget')
        expect(await readFile(outputPath, 'utf8')).toBe('preserved')
        expect(await readdir(path)).toEqual(['output.png'])
    })

    it('rejects resource URLs after trusted components resolve CSS and SVG aliases', async () => {
        const path = await directory()
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network is forbidden'))
        for (const source of [
            '<GradientChip title="Probe" gradient="url(https://8.8.8.8/native-resource-probe)"/>',
            '<Box label="Probe" c={{bg:"#fff",textPrimary:"#000",primary:"url(https://8.8.8.8/probe)"}}/>',
            '<svg><VectorArrow x1={0} y1={0} x2={30} y2={30} color="url(https://8.8.8.8/probe)"/></svg>',
        ]) await expect(renderSceneFrame({ ...base, source, outputPath: join(path, 'blocked.png') })).rejects.toThrow()
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(await readdir(path)).toEqual([])
    })

    it('interrupts trusted SVG expansion while traversing, before collecting a huge SVG', async () => {
        const path = await directory()
        const started = Date.now()
        await expect(renderSceneFrame({ ...base,
            source: '<svg>{Array.from({length:100},()=> <AxisPlot width={100} height={60} showGrid={true} gridCount={100}/>)}</svg>',
            outputPath: join(path, 'blocked.png'),
        })).rejects.toThrow('host element budget')
        expect(Date.now() - started).toBeLessThan(5_000)
        expect(await readdir(path)).toEqual([])
    })

    it.skipIf(!hasFfmpeg)('uses identical preview frames for video and writes H264/yuv420p with exact schedule', async () => {
        const path = await directory()
        const video = await renderSceneVideo({ ...base, outputPath: join(path, 'scene.mp4') })
        expect(video.frameCount).toBe(4)
        expect(video.encodedDuration).toBe(0.5)
        expect(video.assetSha256).toBe(hash(await readFile(video.outputPath)))
        for (let index = 0; index < video.frameCount; index++) {
            const frame = await renderSceneFrame({ ...base, time: index / base.fps, outputPath: join(path, `preview-${index}.png`) })
            const png = spawnSync('ffmpeg', ['-v', 'error', '-i', frame.outputPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1_000_000 })
            const mp4 = spawnSync('ffmpeg', ['-v', 'error', '-i', video.outputPath, '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1_000_000 })
            expect(png.status, png.stderr.toString()).toBe(0)
            expect(mp4.status, mp4.stderr.toString()).toBe(0)
            expect(png.stdout.length).toBe(mp4.stdout.length)
            const meanError = png.stdout.reduce((total, byte, offset) => total + Math.abs(byte - mp4.stdout[offset]), 0) / png.stdout.length
            expect(meanError).toBeLessThan(4)
        }
        const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', video.outputPath], { encoding: 'utf8' })
        expect(probe.status).toBe(0)
        expect(JSON.parse(probe.stdout).streams[0]).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p', width: 160, height: 90, r_frame_rate: '8/1', nb_frames: '4' })
    }, 30_000)
})
