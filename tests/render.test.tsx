import React from 'react'
import { spawnSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { defineIllustration, renderAnimatedGif, renderToBuffer, Scene, StepCard, getThemeColors, Watermark, wrapWithWatermark } from '../src'

describe('vizmatic render pipeline', () => {
    it('renders a PNG buffer from a themed scene', async () => {
        const frame = defineIllustration((c) => (
            <Scene c={c} title="Smoke test">
                <StepCard c={c} title="Rendered" subtitle="PNG output" tone="green" />
            </Scene>
        ))

        const buffer = await renderToBuffer(frame.create('dark'), 720, 420)
        expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
        expect(buffer.length).toBeGreaterThan(10_000)
    }, 30_000)

    it('resolves dark and light theme tokens', () => {
        expect(getThemeColors('dark').bg).not.toBe(getThemeColors('light').bg)
        expect(getThemeColors('dark').primary).toBe(getThemeColors('light').primary)
    })

    it('supports custom watermark text, image, and position', () => {
        const image = 'data:image/svg+xml;base64,PHN2Zy8+'
        const wrapped = wrapWithWatermark(<div />, 320, 180, 'dark', {
            text: 'LeetLLM',
            image: { src: image, width: 18, height: 12 },
            position: 'bottom-left',
        }) as React.ReactElement<{ children: React.ReactNode }>
        const children = React.Children.toArray(wrapped.props.children)
        const watermark = children[1] as React.ReactElement<{ style: Record<string, unknown>; children: React.ReactNode }>
        const watermarkChildren = React.Children.toArray(watermark.props.children)
        const logo = watermarkChildren[0] as React.ReactElement<{ src: string; width: number; height: number }>
        const label = watermarkChildren[1] as React.ReactElement<{ children: React.ReactNode }>

        expect(watermark.props.style.bottom).toBe(8)
        expect(watermark.props.style.left).toBe(10)
        expect(watermark.props.style.top).toBeUndefined()
        expect(logo.props.src).toBe(image)
        expect(logo.props.width).toBe(18)
        expect(logo.props.height).toBe(12)
        expect(label.props.children).toBe('LeetLLM')
    })

    it('supports a JSX watermark element', () => {
        const wrapped = wrapWithWatermark(<div />, 320, 180, 'light', (
            <Watermark position="bottom-right" opacity={0.9}>
                <div style={{ color: '#123456', fontWeight: 800 }}>Custom mark</div>
            </Watermark>
        )) as React.ReactElement<{ children: React.ReactNode }>
        const children = React.Children.toArray(wrapped.props.children)
        const watermark = children[1] as React.ReactElement<{ style: Record<string, unknown>; children: React.ReactNode }>
        const custom = watermark.props.children as React.ReactElement<{ children: React.ReactNode; style: Record<string, unknown> }>

        expect(watermark.props.style.bottom).toBe(8)
        expect(watermark.props.style.right).toBe(10)
        expect(watermark.props.style.opacity).toBe(0.9)
        expect(custom.props.children).toBe('Custom mark')
        expect(custom.props.style.color).toBe('#123456')
    })

    it('renders an animated GIF from scene frames', async () => {
        const c = getThemeColors('dark')
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-gif-'))
        const outputPath = join(outDir, 'frame.gif')

        try {
            await renderAnimatedGif([
                {
                    element: (
                        <Scene c={c} title="GIF smoke">
                            <StepCard c={c} title="Prompt" subtitle="scene 1" tone="blue" />
                        </Scene>
                    ),
                    duration: 140,
                    transition: 'appear',
                },
                {
                    element: (
                        <Scene c={c} title="GIF smoke">
                            <StepCard c={c} title="Rendered" subtitle="scene 2" tone="green" />
                        </Scene>
                    ),
                    duration: 140,
                    transition: 'fade',
                },
            ], {
                width: 640,
                height: 360,
                outputPath,
                theme: 'dark',
                scale: 1,
            })

            const buffer = await readFile(outputPath)
            expect(buffer.subarray(0, 6).toString('ascii')).toBe('GIF89a')
            expect(buffer.length).toBeGreaterThan(5_000)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('renders an ad hoc TSX frame through the CLI shortcut', async () => {
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-cli-'))
        const framePath = join(outDir, 'frame.tsx')
        const renderDir = join(outDir, 'renders')

        try {
            await writeFile(framePath, `import React from 'react'
import { defineIllustration, Scene, StepCard } from 'vizmatic'

export const width = 320
export const height = 180

const frame = defineIllustration((c) => (
    <Scene c={c} title="Ad hoc">
        <StepCard c={c} title="Binary" tone="green" />
    </Scene>
))

export const create = frame.create
export default frame.default
`)

            const result = spawnSync(process.execPath, [
                '--import',
                'tsx',
                'src/cli.ts',
                framePath,
                '--out',
                renderDir,
                '--theme',
                'dark',
            ], {
                cwd: process.cwd(),
                encoding: 'utf8',
            })

            expect(result.status, result.stderr || result.stdout).toBe(0)
            expect(result.stdout).toContain('rendered')

            const buffer = await readFile(join(renderDir, 'frame_dark.png'))
            expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)
})
