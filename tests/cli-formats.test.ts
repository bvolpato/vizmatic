import { spawnSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { Resvg } from '@resvg/resvg-js'
import { afterEach, describe, expect, it } from 'vitest'
import { detectBackgroundColor, detectContentBounds } from '../src/autocrop'

interface OutputDetail {
    theme: 'dark' | 'light'
    format: 'png' | 'svg'
    path: string
    width: number
    height: number
}

interface ManifestEntry {
    width: number
    height: number
    outputWidth: number
    outputHeight: number
    outputs: string[]
    outputDetails: OutputDetail[]
}

const tempDirs: string[] = []

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function renderCli(source: string, options: string[] = []) {
    const directory = await mkdtemp(join(tmpdir(), 'vizmatic-cli-format-'))
    tempDirs.push(directory)
    const framePath = join(directory, 'format-frame.tsx')
    const renderDir = join(directory, 'renders')
    await writeFile(framePath, source)

    const env: NodeJS.ProcessEnv = { ...process.env, VIZMATIC_DISABLE_NETWORK: '1' }
    delete env.NODE_OPTIONS
    for (const key of Object.keys(env)) {
        if (key.startsWith('TSX_') || key.startsWith('VITEST')) delete env[key]
    }

    const result = spawnSync(process.execPath, [
        '--import',
        'tsx',
        resolve('src/cli.ts'),
        'render',
        framePath,
        '--out',
        renderDir,
        '--theme',
        'light',
        ...options,
    ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env,
    })

    return { directory, renderDir, result }
}

function svgRoot(svg: string) {
    const attributes = svg.match(/^<svg\b([^>]*)>/)?.[1]
    expect(attributes, 'expected an SVG root element').toBeDefined()
    const readAttribute = (name: string) => attributes?.match(new RegExp(`(?:^|\\s)${name}="([^"]+)"`))?.[1]
    return {
        width: Number(readAttribute('width')),
        height: Number(readAttribute('height')),
        viewBox: readAttribute('viewBox'),
    }
}

function manifestAt(path: string): Promise<ManifestEntry[]> {
    return readFile(join(path, 'manifest.json'), 'utf8').then((contents) => JSON.parse(contents) as ManifestEntry[])
}

const fittedFrame = `import React from 'react'
export const width = 400
export const height = 240
export const create = () => <div style={{ display: 'flex', position: 'absolute', left: 50, top: 35, width: 180, height: 70, backgroundColor: '#3157d5' }} />
`

const themeWidthFrame = `import React from 'react'
export const width = 520
export const height = 200
export const create = (theme) => <div style={{ display: 'flex', position: 'absolute', left: 40, top: 40, width: theme === 'dark' ? 180 : 420, height: 60, backgroundColor: '#3157d5' }} />
`

describe('CLI output formats', () => {
    it('keeps PNG as the default format', async () => {
        const { renderDir, result } = await renderCli(fittedFrame)

        expect(result.status, result.stderr || result.stdout).toBe(0)
        const manifest = await manifestAt(renderDir)
        expect(manifest[0]?.outputs).toEqual(['format-frame_light.png'])
        expect(manifest[0]?.outputDetails).toMatchObject([{ format: 'png', path: 'format-frame_light.png' }])
        const png = await readFile(join(renderDir, 'format-frame_light.png'))
        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
        await expect(readFile(join(renderDir, 'format-frame_light.svg'))).rejects.toMatchObject({ code: 'ENOENT' })
    }, 30_000)

    it('writes a cropped vector SVG with theme, background, and watermark options', async () => {
        const { renderDir, result } = await renderCli(fittedFrame, [
            '--format', 'svg',
            '--background', 'theme',
            '--watermark', 'Vector Label',
        ])

        expect(result.status, result.stderr || result.stdout).toBe(0)
        const manifest = await manifestAt(renderDir)
        const detail = manifest[0]?.outputDetails[0]
        expect(detail).toMatchObject({ format: 'svg', path: 'format-frame_light.svg' })
        const svg = await readFile(join(renderDir, 'format-frame_light.svg'), 'utf8')
        expect(svg.startsWith('<svg')).toBe(true)
        expect((svg.match(/<path\b/g) ?? []).length).toBeGreaterThan(0)
        const dimensions = svgRoot(svg)
        expect(dimensions.width).toBe(detail?.width)
        expect(dimensions.height).toBe(detail?.height)
        expect(dimensions.viewBox).not.toBe(`0 0 400 240`)
        expect(dimensions.height).toBeLessThan(240)
    }, 30_000)

    it('writes both PNG and SVG and reports each output format', async () => {
        const { renderDir, result } = await renderCli(fittedFrame, ['--format', 'both', '--scale', '1'])

        expect(result.status, result.stderr || result.stdout).toBe(0)
        const manifest = await manifestAt(renderDir)
        expect(manifest[0]?.outputs).toEqual(['format-frame_light.png', 'format-frame_light.svg'])
        expect(manifest[0]?.outputDetails.map(({ format }) => format)).toEqual(['png', 'svg'])
        expect((await readFile(join(renderDir, 'format-frame_light.png'))).subarray(0, 8).toString('hex'))
            .toBe('89504e470d0a1a0a')
        expect((await readFile(join(renderDir, 'format-frame_light.svg'), 'utf8')).startsWith('<svg')).toBe(true)
    }, 30_000)

    it.each(['svg', 'both'])('balances modest SVG gutters with --format %s without changing geometry', async (format) => {
        const source = `import React from 'react'
export const width = 500
export const height = 400
export const create = () => <div style={{ display: 'flex', position: 'absolute', left: 24, top: 56, width: 452, height: 320, backgroundColor: 'blue' }} />
`
        const { renderDir, result } = await renderCli(source, ['--format', format, '--scale', '1'])

        expect(result.status, result.stderr || result.stdout).toBe(0)
        const manifest = await manifestAt(renderDir)
        const detail = manifest[0]?.outputDetails.find(({ format }) => format === 'svg')
        const svg = await readFile(join(renderDir, 'format-frame_light.svg'), 'utf8')
        expect(svgRoot(svg)).toEqual({ width: 500, height: 368, viewBox: '0 32 500 368' })
        expect(detail).toMatchObject({ width: 500, height: 368 })

        const raster = new Resvg(svg).render()
        const pixels = new Uint8Array(raster.pixels.buffer)
        expect(detectContentBounds(pixels, raster.width, raster.height, detectBackgroundColor(pixels), 0)).toEqual({
            x: 24, y: 24, width: 452, height: 320,
        })
        if (format === 'both') {
            const png = await readFile(join(renderDir, 'format-frame_light.png'))
            expect(png.readUInt32BE(16)).toBe(raster.width)
            expect(png.readUInt32BE(20)).toBe(raster.height)
        }
    }, 30_000)

    it('uses the resolved canvas size, not a cropped SVG size, for the next theme', async () => {
        const { renderDir, result } = await renderCli(themeWidthFrame, ['--format', 'svg', '--theme', 'dark,light'])

        expect(result.status, result.stderr || result.stdout).toBe(0)
        const manifest = await manifestAt(renderDir)
        const entry = manifest[0]
        expect(entry).toMatchObject({ width: 520, height: 200 })
        expect(entry?.outputDetails.map(({ theme }) => theme)).toEqual(['dark', 'light'])
        expect(entry?.outputDetails[0]?.width).toBeLessThan(entry?.outputDetails[1]?.width ?? 0)

        for (const detail of entry?.outputDetails ?? []) {
            const svg = await readFile(join(renderDir, detail.path), 'utf8')
            expect(svgRoot(svg)).toMatchObject({ width: detail.width, height: detail.height })
        }
    }, 30_000)

    it('rejects unknown formats and auto-grows SVG canvases when content overflows', async () => {
        const invalid = await renderCli(fittedFrame, ['--format', 'webp'])
        expect(invalid.result.status).toBe(1)
        expect(invalid.result.stderr).toContain('--format png|svg|both')

        const overflowingFrame = `import React from 'react'
export const width = 320
export const height = 200
export const autoSize = true
export const create = () => <div style={{ display: 'flex', position: 'absolute', left: 20, top: 30, width: 410, height: 70, backgroundColor: '#3157d5' }} />
`
        const grown = await renderCli(overflowingFrame, ['--format', 'svg'])
        expect(grown.result.status, grown.result.stderr || grown.result.stdout).toBe(0)
        const manifest = await manifestAt(grown.renderDir)
        const detail = manifest[0]?.outputDetails[0]
        const svg = await readFile(join(grown.renderDir, 'format-frame_light.svg'), 'utf8')
        expect(detail?.width).toBeGreaterThan(320)
        expect(svgRoot(svg).width).toBe(detail?.width)
    }, 30_000)
})
