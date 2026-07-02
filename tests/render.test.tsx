import React from 'react'
import { spawnSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { inflateSync } from 'zlib'
import { describe, expect, it, vi } from 'vitest'
import {
    defineIllustration,
    detectBackgroundColor,
    detectContentBounds,
    detectOverflow,
    getThemeColors,
    renderAnimatedGif,
    renderToBuffer,
    Scene,
    StepCard,
    Watermark,
    wrapWithWatermark,
} from '../src'

let packageBuilt = false

function ensurePackageBuild() {
    if (packageBuilt) return

    const build = spawnSync('pnpm', ['build'], {
        cwd: process.cwd(),
        encoding: 'utf8',
    })
    expect(build.status, build.stderr || build.stdout).toBe(0)
    packageBuilt = true
}

function decodePng(buffer: Buffer): { width: number; height: number; pixels: Uint8Array } {
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')

    let offset = 8
    let width = 0
    let height = 0
    let bitDepth = 0
    let colorType = 0
    const idat: Buffer[] = []

    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset)
        const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
        const data = buffer.subarray(offset + 8, offset + 8 + length)
        offset += length + 12

        if (type === 'IHDR') {
            width = data.readUInt32BE(0)
            height = data.readUInt32BE(4)
            bitDepth = data[8]
            colorType = data[9]
        } else if (type === 'IDAT') {
            idat.push(data)
        } else if (type === 'IEND') {
            break
        }
    }

    expect(bitDepth).toBe(8)
    expect(colorType).toBe(6)

    const bytesPerPixel = 4
    const stride = width * bytesPerPixel
    const inflated = inflateSync(Buffer.concat(idat))
    const pixels = new Uint8Array(width * height * bytesPerPixel)
    let sourceOffset = 0
    let previous = new Uint8Array(stride)

    for (let y = 0; y < height; y++) {
        const filter = inflated[sourceOffset++]
        const row = inflated.subarray(sourceOffset, sourceOffset + stride)
        sourceOffset += stride
        const outOffset = y * stride

        for (let x = 0; x < stride; x++) {
            const left = x >= bytesPerPixel ? pixels[outOffset + x - bytesPerPixel] : 0
            const up = previous[x]
            const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0
            const raw = row[x]
            let value: number

            if (filter === 0) {
                value = raw
            } else if (filter === 1) {
                value = raw + left
            } else if (filter === 2) {
                value = raw + up
            } else if (filter === 3) {
                value = raw + Math.floor((left + up) / 2)
            } else if (filter === 4) {
                const p = left + up - upLeft
                const pa = Math.abs(p - left)
                const pb = Math.abs(p - up)
                const pc = Math.abs(p - upLeft)
                value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
            } else {
                throw new Error(`unsupported PNG filter ${filter}`)
            }

            pixels[outOffset + x] = value & 0xff
        }

        previous = pixels.subarray(outOffset, outOffset + stride)
    }

    return { width, height, pixels }
}

function pixelAt(image: { width: number; pixels: Uint8Array }, x: number, y: number): [number, number, number, number] {
    const offset = (y * image.width + x) * 4
    return [
        image.pixels[offset],
        image.pixels[offset + 1],
        image.pixels[offset + 2],
        image.pixels[offset + 3],
    ]
}

function hexToRgb(hex: string): [number, number, number] {
    const value = hex.startsWith('#') ? hex.slice(1) : hex
    return [
        parseInt(value.slice(0, 2), 16),
        parseInt(value.slice(2, 4), 16),
        parseInt(value.slice(4, 6), 16),
    ]
}

describe('vizmatic render pipeline', () => {
    it('keeps opaque black content visible on transparent backgrounds', () => {
        const width = 12
        const height = 12
        const pixels = new Uint8Array(width * height * 4)

        for (let y = 4; y < 8; y++) {
            for (let x = 4; x < 8; x++) {
                const offset = (y * width + x) * 4
                pixels[offset] = 0
                pixels[offset + 1] = 0
                pixels[offset + 2] = 0
                pixels[offset + 3] = 255
            }
        }

        const bg = detectBackgroundColor(pixels)
        expect(bg).toBe('transparent')
        expect(detectContentBounds(pixels, width, height, bg, 0)).toEqual({ x: 4, y: 4, width: 4, height: 4 })
        expect(detectOverflow(pixels, width, height, bg).overflows).toBe(false)

        for (let y = 0; y < height; y++) {
            const offset = y * width * 4
            pixels[offset + 3] = 255
        }

        const overflow = detectOverflow(pixels, width, height, bg)
        expect(overflow.overflows).toBe(true)
        expect(overflow.edges.left).toBe(true)
    })

    it('renders with vendored fonts and emoji without network fetches', async () => {
        const fetchMock = vi.fn(async () => {
            throw new Error('network disabled in test')
        })
        vi.stubGlobal('fetch', fetchMock)

        try {
            const buffer = await renderToBuffer((
                <div style={{ display: 'flex', fontFamily: 'Inter', fontSize: 32, fontWeight: 700 }}>
                    Offline assets 💡
                </div>
            ), 560, 180)

            expect(fetchMock).not.toHaveBeenCalled()
            expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
            expect(buffer.length).toBeGreaterThan(5_000)
        } finally {
            vi.unstubAllGlobals()
        }
    }, 30_000)

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

    it('renders alpha-transparent PNG backgrounds by default', async () => {
        const frame = defineIllustration((c) => (
            <Scene c={c} title="Transparent default">
                <StepCard c={c} title="Alpha" subtitle="no canvas fill" tone="green" />
            </Scene>
        ))

        const buffer = await renderToBuffer(frame.create('dark'), 520, 320, { scale: 1 })
        const image = decodePng(buffer)
        expect(pixelAt(image, 0, 0)[3]).toBe(0)
    }, 30_000)

    it('renders scenes without a title or subtitle', async () => {
        const frame = defineIllustration((c) => (
            <Scene c={c} align="center" contentWidth={420}>
                <StepCard c={c} title="Titleless" subtitle="visual-only" tone="cyan" width={240} />
            </Scene>
        ))

        const buffer = await renderToBuffer(frame.create('light'), 520, 320, { scale: 1 })
        const image = decodePng(buffer)
        expect(image.width).toBe(520)
        expect(image.height).toBe(320)
        expect(pixelAt(image, 0, 0)[3]).toBe(0)
    }, 30_000)

    it('renders the theme background when requested', async () => {
        const frame = defineIllustration((c) => (
            <Scene c={c} title="Opaque theme">
                <StepCard c={c} title="Theme" subtitle="canvas fill" tone="purple" />
            </Scene>
        ))

        const buffer = await renderToBuffer(frame.create('dark'), 520, 320, { scale: 1, background: 'theme' })
        const image = decodePng(buffer)
        expect(pixelAt(image, 0, 0)).toEqual([...hexToRgb(getThemeColors('dark').bg), 255])
    }, 30_000)

    it('renders through the built CommonJS entrypoint with packaged assets outside the repo cwd', async () => {
        ensurePackageBuild()

        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-cjs-assets-'))
        const packageRoot = process.cwd()

        try {
            const result = spawnSync(process.execPath, ['-e', `
const React = require(${JSON.stringify(join(packageRoot, 'node_modules', 'react'))})
const originalFetch = global.fetch.bind(global)
const externalFetches = []
global.fetch = async (input, init) => {
  const url = String(input)
  if (url.startsWith('http://') || url.startsWith('https://')) {
    externalFetches.push(url)
    throw new Error('network disabled in test: ' + url)
  }
  return originalFetch(input, init)
}
const { defineIllustration, renderToBuffer, Scene, StepCard } = require(${JSON.stringify(join(packageRoot, 'dist', 'index.cjs'))})
const frame = defineIllustration((c) => React.createElement(Scene, { c, title: 'CJS smoke' },
  React.createElement(StepCard, { c, title: 'Rendered 💡', subtitle: 'CommonJS', tone: 'green' })
))
renderToBuffer(frame.create('dark'), 720, 420)
  .then((buffer) => {
    if (externalFetches.length !== 0) {
      console.error('external fetches', externalFetches)
      process.exit(4)
    }
    if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') process.exit(2)
    if (buffer.length <= 10000) process.exit(3)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
`], {
                cwd: outDir,
                encoding: 'utf8',
            })
            expect(result.status, result.stderr || result.stdout).toBe(0)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
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

    it('renders a bare TSX frame through the CLI without imports or theme wiring', async () => {
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-bare-cli-'))
        const framePath = join(outDir, 'bare-frame.tsx')
        const renderDir = join(outDir, 'renders')

        try {
            await writeFile(framePath, `width = 520;
height = 300;

<Scene title="Bare frame" subtitle="CLI adds imports and theme">
    <Row gap={12} width="100%">
        <StepCard title="No imports" subtitle="binary render" tone="green" />
        <CalloutCard title="No c prop" detail="Theme is injected automatically." tone="purple" width={220} />
    </Row>
</Scene>
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

            const buffer = await readFile(join(renderDir, 'bare-frame_dark.png'))
            expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')

            const manifest = JSON.parse(await readFile(join(renderDir, 'manifest.json'), 'utf8')) as Array<{ width: number; height: number }>
            expect(manifest[0]).toMatchObject({ width: 520, height: 300 })
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('auto-expands omitted CLI dimensions when content overflows', async () => {
        ensurePackageBuild()

        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-auto-size-cli-'))
        const framePath = join(outDir, 'auto-size.tsx')
        const renderDir = join(outDir, 'renders')
        const packageRoot = process.cwd()

        try {
            await writeFile(framePath, `<Scene title="Auto-sized frame" subtitle="dimensions omitted">
    <Row gap={18} width="100%" justify="center">
        <CalloutCard title="First wide panel" detail="Default width would overflow." tone="blue" width={470} />
        <CalloutCard title="Second wide panel" detail="The CLI grows width." tone="purple" width={470} />
        <CalloutCard title="Third wide panel" detail="The render succeeds." tone="green" width={470} />
    </Row>
</Scene>
`)

            const result = spawnSync(process.execPath, [
                join(packageRoot, 'dist', 'cli.js'),
                framePath,
                '--out',
                renderDir,
                '--theme',
                'light',
            ], {
                cwd: outDir,
                encoding: 'utf8',
            })

            expect(result.status, result.stderr || result.stdout).toBe(0)
            const buffer = await readFile(join(renderDir, 'auto-size_light.png'))
            expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')

            const manifest = JSON.parse(await readFile(join(renderDir, 'manifest.json'), 'utf8')) as Array<{ width: number; height: number }>
            expect(manifest[0]?.width).toBeGreaterThan(960)
            expect(manifest[0]?.height).toBe(540)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('keeps explicit CLI dimensions strict when content overflows', async () => {
        ensurePackageBuild()

        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-explicit-overflow-cli-'))
        const framePath = join(outDir, 'explicit-overflow.tsx')
        const renderDir = join(outDir, 'renders')
        const packageRoot = process.cwd()

        try {
            await writeFile(framePath, `width = 960
height = 540

<Scene title="Explicit frame" subtitle="dimensions should stay strict">
    <Row gap={18} width="100%" justify="center">
        <CalloutCard title="First wide panel" detail="Default width overflows." tone="blue" width={470} />
        <CalloutCard title="Second wide panel" detail="No auto-grow." tone="purple" width={470} />
        <CalloutCard title="Third wide panel" detail="Surface the error." tone="green" width={470} />
    </Row>
</Scene>
`)

            const result = spawnSync(process.execPath, [
                join(packageRoot, 'dist', 'cli.js'),
                framePath,
                '--out',
                renderDir,
                '--theme',
                'light',
            ], {
                cwd: outDir,
                encoding: 'utf8',
            })

            expect(result.status).not.toBe(0)
            expect(result.stderr || result.stdout).toContain('Canvas overflow detected')
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('renders a bare TSX frame through the built CLI outside the repo cwd', async () => {
        ensurePackageBuild()

        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-built-bare-cli-'))
        const framePath = join(outDir, 'bare-global.tsx')
        const helperPath = join(outDir, 'copy.ts')
        const renderDir = join(outDir, 'renders')
        const packageRoot = process.cwd()

        try {
            await writeFile(helperPath, `export const title = 'Bare global'\n`)
            await writeFile(framePath, `import { title } from './copy'

width = 560
height = 320

const detail = 'package-owned imports'

<Scene title={title} subtitle={detail}>
    <Row gap={12} width="100%">
        <StepCard title="React" subtitle="resolved by CLI" tone="green" />
        <CalloutCard title="Relative import" detail="resolved by CLI" tone="cyan" width={240} />
    </Row>
</Scene>
`)

            const result = spawnSync(process.execPath, [
                join(packageRoot, 'dist', 'cli.js'),
                framePath,
                '--out',
                renderDir,
                '--theme',
                'light',
                '--scale',
                '2',
            ], {
                cwd: outDir,
                encoding: 'utf8',
            })

            expect(result.status, result.stderr || result.stdout).toBe(0)
            expect(result.stdout).toContain('rendered')

            const buffer = await readFile(join(renderDir, 'bare-global_light.png'))
            expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
            expect(pixelAt(decodePng(buffer), 0, 0)[3]).toBe(0)

            const opaqueRenderDir = join(outDir, 'opaque-renders')
            const opaqueResult = spawnSync(process.execPath, [
                join(packageRoot, 'dist', 'cli.js'),
                framePath,
                '--out',
                opaqueRenderDir,
                '--theme',
                'dark',
                '--background',
                'theme',
            ], {
                cwd: outDir,
                encoding: 'utf8',
            })

            expect(opaqueResult.status, opaqueResult.stderr || opaqueResult.stdout).toBe(0)
            const opaqueBuffer = await readFile(join(opaqueRenderDir, 'bare-global_dark.png'))
            expect(pixelAt(decodePng(opaqueBuffer), 0, 0)).toEqual([...hexToRgb(getThemeColors('dark').bg), 255])
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('renders an imported createScenes module through the GIF CLI', async () => {
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-cli-gif-'))
        const framePath = join(outDir, 'animated.tsx')
        const renderDir = join(outDir, 'renders')

        try {
            await writeFile(framePath, `import React from 'react'
import {
    Scene,
    StepCard,
    getThemeColors,
    type AnimatedScene,
    type ThemeMode,
} from 'vizmatic'

export const width = 420
export const height = 240

function frame(theme: ThemeMode, title: string) {
    const c = getThemeColors(theme)
    return (
        <Scene c={c} title={title}>
            <StepCard c={c} title="GIF" subtitle="module import" tone="green" />
        </Scene>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return frame(theme, 'Static fallback')
}

export function createScenes(theme: ThemeMode): AnimatedScene[] {
    return [
        { element: frame(theme, 'First'), duration: 200, transition: 'appear' },
        { element: frame(theme, 'Second'), duration: 200, transition: 'fade' },
    ]
}

export default create('dark')
`)

            const result = spawnSync(process.execPath, [
                '--import',
                'tsx',
                'src/cli.ts',
                'gif',
                framePath,
                '--out',
                renderDir,
                '--theme',
                'dark',
                '--scale',
                '1',
            ], {
                cwd: process.cwd(),
                encoding: 'utf8',
            })

            expect(result.status, result.stderr || result.stdout).toBe(0)
            expect(result.stdout).toContain('rendered')

            const buffer = await readFile(join(renderDir, 'animated_dark.gif'))
            expect(buffer.subarray(0, 6).toString('ascii')).toBe('GIF89a')
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)
})
