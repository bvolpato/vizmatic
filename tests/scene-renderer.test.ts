import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Resvg } from '@resvg/resvg-js'
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

function pngPixels(data: Buffer): { width: number; height: number; pixels: Uint8Array } {
    const width = data.readUInt32BE(16), height = data.readUInt32BE(20)
    const image = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${data.toString('base64')}"/></svg>`).render()
    return { width, height, pixels: image.pixels }
}

function pixelAt(image: ReturnType<typeof pngPixels>, x: number, y: number): number[] {
    return [...image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
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

    it('scales fixed SVG coordinates and nested layout rasters without changing logical scene globals', async () => {
        const path = await directory()
        const fixed = '<svg width={width} height={height} viewBox="0 0 320 180"><rect x={160} y={90} width={80} height={40} fill="#ff0000"/></svg>'
        for (const [name, source] of [
            ['native', fixed],
            ['nested', `<div style={{display:"flex",width,height}}>${fixed}</div>`],
        ]) {
            const request = { ...base, width: 320, height: 180, source }
            const full = await renderSceneFrame({ ...request, outputPath: join(path, `${name}-full.png`) })
            const explicit = await renderSceneFrame({ ...request, outputScale: 1, outputPath: join(path, `${name}-explicit.png`) })
            const preview = await renderSceneFrame({ ...request, outputScale: 0.5, outputPath: join(path, `${name}-preview.png`) })
            const otherScale = await renderSceneFrame({ ...request, outputScale: 0.6, outputPath: join(path, `${name}-other-scale.png`) })
            expect(explicit.assetSha256).toBe(full.assetSha256)
            expect(explicit.inputSha256).toBe(full.inputSha256)
            expect(full.logicalWidth).toBeUndefined()
            expect(preview).toMatchObject({ width: 160, height: 90, outputScale: 0.5, logicalWidth: 320, logicalHeight: 180, logicalFps: 8, logicalFrameCount: 4 })
            expect(preview.inputSha256).not.toBe(full.inputSha256)
            expect(otherScale.inputSha256).not.toBe(preview.inputSha256)
            const image = pngPixels(await readFile(preview.outputPath))
            expect([image.width, image.height]).toEqual([160, 90])
            expect(pixelAt(image, 90, 50)).toEqual([255, 0, 0, 255])
            expect(pixelAt(image, 70, 50)).not.toEqual([255, 0, 0, 255])
            expect(pixelAt(image, 125, 50)).not.toEqual([255, 0, 0, 255])
        }
        const quarter = await renderSceneFrame({ ...base, width: 320, height: 192, outputScale: 0.25, outputPath: join(path, 'quarter.png') })
        expect(quarter).toMatchObject({ width: 80, height: 48, outputScale: 0.25 })
    })

    it('validates preview output limits before writing, while retaining logical scene and raster budgets', async () => {
        const path = await directory()
        const outputPath = join(path, 'preserved.png')
        await writeFile(outputPath, 'preserved')
        for (const outputScale of [0, 0.249, 1.01, Infinity, NaN, 0.3, 0.5]) {
            // This 160x90 canvas has no even height at scale 0.5.
            await expect(renderSceneFrame({ ...base, outputScale, outputPath })).rejects.toThrow(/outputScale|Scaled scene/)
        }
        for (const previewFps of [0, -1, 1.5, 9, Infinity, NaN]) {
            await expect(renderSceneVideo({ ...base, previewFps, outputPath })).rejects.toThrow('previewFps')
        }
        // @ts-expect-error JavaScript and JSON callers must not pass an explicit null.
        await expect(renderSceneVideo({ ...base, previewFps: null, outputPath })).rejects.toThrow('previewFps')
        await expect(renderSceneVideo({ ...base, duration: 0.02, fps: 25, previewFps: 12, outputPath })).rejects.toThrow('at least one output frame')
        await expect(renderSceneFrame({ ...base, width: 3840, height: 2160, outputScale: 0.25, outputPath })).rejects.toThrow('Scene width')
        await expect(renderSceneVideo({ ...base, duration: 120, fps: 60, previewFps: 12, outputPath })).rejects.toThrow('3600 frames')
        await expect(renderSceneFrame({ ...base, width: 320, height: 180, outputScale: 0.5,
            source: '<div style={{display:"flex"}}>{Array.from({length:5},()=> <svg width={width} height={height}><rect width={width} height={height}/></svg>)}</div>', outputPath,
        })).rejects.toThrow('pixel or image budget')
        expect(await readFile(outputPath, 'utf8')).toBe('preserved')
        expect(await readdir(path)).toEqual(['preserved.png'])
    })

    it.skipIf(!hasFfmpeg)('samples 12 fps previews with the original 25 fps logical globals and fixed coordinates', async () => {
        const path = await directory()
        const request = { ...base, width: 320, height: 180, duration: 1, fps: 25, seed: 42, cues: { reveal: 0.3 },
            source: `if (width !== 320 || height !== 180 || fps !== 25 || duration !== 1 || seed !== 42 || cues.reveal !== 0.3 || frame !== Math.floor(time * 25 + 1e-9) || progress !== time / duration) throw 'Logical scene changed';
<svg width={width} height={height} viewBox="0 0 320 180"><rect x={frame * 12} y={80} width={20} height={20} fill="#ff0000"/></svg>`,
        }
        const video = await renderSceneVideo({ ...request, outputScale: 0.5, previewFps: 12, outputPath: join(path, 'preview.mp4') })
        expect(video).toMatchObject({ width: 160, height: 90, fps: 12, frameCount: 12, duration: 1, encodedDuration: 1,
            outputScale: 0.5, previewFps: 12, logicalWidth: 320, logicalHeight: 180, logicalFps: 25, logicalFrameCount: 25 })
        const otherFps = await renderSceneVideo({ ...request, outputScale: 0.5, previewFps: 10, outputPath: join(path, 'preview-10.mp4') })
        expect(otherFps.inputSha256).not.toBe(video.inputSha256)
        for (const index of [0, 1, 5, 11]) {
            const frame = await renderSceneFrame({ ...request, time: index / 12, outputScale: 0.5, outputPath: join(path, `preview-${index}.png`) })
            const png = spawnSync('ffmpeg', ['-v', 'error', '-i', frame.outputPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1_000_000 })
            const mp4 = spawnSync('ffmpeg', ['-v', 'error', '-i', video.outputPath, '-vf', `select=eq(n\\,${index})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1_000_000 })
            expect(png.status, png.stderr.toString()).toBe(0)
            expect(mp4.status, mp4.stderr.toString()).toBe(0)
            expect(mp4.stdout.length).toBe(png.stdout.length)
            const meanError = png.stdout.reduce((total, byte, offset) => total + Math.abs(byte - mp4.stdout[offset]), 0) / png.stdout.length
            expect(meanError).toBeLessThan(4)
            const expectedX = Math.floor(index / 12 * 25 + 1e-9) * 6 + 4
            const offset = (45 * 160 + expectedX) * 3
            expect(mp4.stdout[offset]).toBeGreaterThan(230)
            expect(mp4.stdout[offset + 1]).toBeLessThan(25)
            expect(mp4.stdout[offset + 2]).toBeLessThan(25)
        }
        const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', video.outputPath], { encoding: 'utf8' })
        expect(probe.status).toBe(0)
        expect(JSON.parse(probe.stdout).streams[0]).toMatchObject({ codec_name: 'h264', width: 160, height: 90, r_frame_rate: '12/1', nb_frames: '12' })
    }, 30_000)

    it.skipIf(!hasFfmpeg)('avoids unused root PNG encoding for video while retaining nested SVG PNGs', async () => {
        const path = await directory()
        const rendered = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>').render()
        const pngSpy = vi.spyOn(Object.getPrototypeOf(rendered), 'asPng')
        await renderSceneVideo({ ...base, outputPath: join(path, 'native.mp4') })
        expect(pngSpy).not.toHaveBeenCalled()
        await renderSceneVideo({ ...base, source: '<div style={{display:"flex"}}><svg width={160} height={90}><rect width={80} height={40} fill="#ff0000"/></svg></div>', outputPath: join(path, 'nested.mp4') })
        expect(pngSpy).toHaveBeenCalledTimes(4)
    })

    it.skipIf(!hasFfmpeg)('accepts CLI preview JSON and reports actual output settings without permitting video options on PNGs', async () => {
        const path = await directory()
        const input = join(path, 'request.json')
        await writeFile(input, JSON.stringify({ ...base, width: 320, height: 180, fps: 25, outputScale: 0.5, previewFps: 12 }))
        const outputPath = join(path, 'preview.mp4')
        const rendered = spawnSync(process.execPath, ['dist/scene-cli.js', '--input', input, '--output', outputPath], { encoding: 'utf8' })
        expect(rendered.status, rendered.stderr).toBe(0)
        expect(JSON.parse(rendered.stdout)).toMatchObject({ outputScale: 0.5, previewFps: 12, width: 160, height: 90, fps: 12, frameCount: 6, logicalWidth: 320, logicalHeight: 180, logicalFps: 25, logicalFrameCount: 13 })
        const invalid = spawnSync(process.execPath, ['dist/scene-cli.js', '--input', input, '--output', join(path, 'preview.png')], { encoding: 'utf8' })
        expect(invalid.status).toBe(1)
        expect(invalid.stderr).toContain('unsupported field')
        await writeFile(input, JSON.stringify({ ...base, previewFps: null }))
        const nullFps = spawnSync(process.execPath, ['dist/scene-cli.js', '--input', input, '--output', outputPath], { encoding: 'utf8' })
        expect(nullFps.status).toBe(1)
        expect(nullFps.stderr).toContain('previewFps')
    }, 30_000)

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
