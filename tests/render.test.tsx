import React from 'react'
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { inflateSync } from 'zlib'
import { describe, expect, it, vi } from 'vitest'
import { analyzeContrast } from '../src/diagnostics'
import {
    defineIllustration,
    detectBackgroundColor,
    detectContentBounds,
    detectOverflow,
    colors,
    CalloutCard,
    defineAnimation,
    getReadableColor,
    getReadableToneColor,
    getToneFill,
    getThemeColors,
    getReadableTextColor,
    MetricCard,
    renderAnimatedGif,
    renderAnimationGif,
    renderToBuffer,
    renderToSvg,
    Scene,
    StepCard,
    Watermark,
    wrapWithWatermark,
    BarChart,
    Box,
    DonutChart,
    GraphDiagram,
    Grid,
    Icon,
    LayeredNetwork,
    LineChart,
    Matrix,
    MiniBarChart,
    Panel,
    ParetoChart,
    QuadrantChart,
    Row,
    renderToPngWithOutput,
    Timeline,
    TreeDiagram,
    DashedLine,
    hold,
    tween,
} from '../src'
import { chartTicks, formatChartValue } from '../src/primitives/charts'
import type { SatoriNode } from '../src'

let packageBuilt = false

type CliManifestEntry = {
    width: number
    height: number
    outputWidth?: number
    outputHeight?: number
    outputs?: string[]
    outputDetails?: Array<{
        theme: 'dark' | 'light'
        path: string
        width: number
        height: number
    }>
}

function cliChildEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
    delete env.NODE_OPTIONS
    for (const key of Object.keys(env)) {
        if (key.startsWith('TSX_') || key.startsWith('VITEST')) delete env[key]
    }
    return env
}

function ensurePackageBuild() {
    if (packageBuilt) return
    if (
        existsSync(join(process.cwd(), 'dist', 'cli.js'))
        && existsSync(join(process.cwd(), 'dist', 'index.cjs'))
    ) {
        packageBuilt = true
        return
    }
    if (process.env.VIZMATIC_TEST_USE_EXISTING_BUILD === '1') {
        expect(existsSync(join(process.cwd(), 'dist', 'cli.js'))).toBe(true)
        packageBuilt = true
        return
    }

    const build = spawnSync('pnpm', ['build'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: cliChildEnv(),
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

function gifTransparencyFlags(buffer: Buffer): boolean[] {
    const flags: boolean[] = []
    for (let index = 0; index <= buffer.length - 8; index += 1) {
        if (buffer[index] === 0x21 && buffer[index + 1] === 0xf9 && buffer[index + 2] === 0x04) {
            flags.push((buffer[index + 3] & 0x01) === 0x01)
        }
    }
    return flags
}

function gifFrameDelays(buffer: Buffer): number[] {
    const delays: number[] = []
    for (let index = 0; index <= buffer.length - 8; index += 1) {
        if (buffer[index] === 0x21 && buffer[index + 1] === 0xf9 && buffer[index + 2] === 0x04) {
            delays.push(buffer.readUInt16LE(index + 4) * 10)
        }
    }
    return delays
}

function gifLocalPaletteFlags(buffer: Buffer): boolean[] {
    expect(buffer.subarray(0, 6).toString('ascii')).toMatch(/^GIF8[79]a$/)
    const globalPaletteSize = (buffer[10] & 0x80) === 0
        ? 0
        : 3 * (1 << ((buffer[10] & 0x07) + 1))
    let offset = 13 + globalPaletteSize
    const flags: boolean[] = []

    const skipSubBlocks = () => {
        while (offset < buffer.length) {
            const length = buffer[offset++]
            if (length === 0) return
            offset += length
        }
    }

    while (offset < buffer.length) {
        const marker = buffer[offset++]
        if (marker === 0x3b) break
        if (marker === 0x21) {
            offset += 1
            skipSubBlocks()
            continue
        }
        if (marker !== 0x2c) throw new Error(`unsupported GIF marker 0x${marker.toString(16)}`)

        const packed = buffer[offset + 8]
        const hasLocalPalette = (packed & 0x80) !== 0
        flags.push(hasLocalPalette)
        offset += 9
        if (hasLocalPalette) offset += 3 * (1 << ((packed & 0x07) + 1))
        offset += 1
        skipSubBlocks()
    }

    return flags
}

function pixelBounds(
    image: { width: number; height: number; pixels: Uint8Array },
    matches: (r: number, g: number, b: number, a: number) => boolean,
): { minX: number; maxX: number; minY: number; maxY: number } {
    let minX = image.width
    let minY = image.height
    let maxX = -1
    let maxY = -1

    for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
            const offset = (y * image.width + x) * 4
            if (matches(image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2], image.pixels[offset + 3])) {
                minX = Math.min(minX, x)
                minY = Math.min(minY, y)
                maxX = Math.max(maxX, x)
                maxY = Math.max(maxY, y)
            }
        }
    }

    return { minX, maxX, minY, maxY }
}

function reactProps(element: React.ReactElement): Record<string, unknown> {
    return element.props as Record<string, unknown>
}

function collectElements(
    node: React.ReactNode,
    matches: (element: React.ReactElement) => boolean,
): React.ReactElement[] {
    const elements: React.ReactElement[] = []

    React.Children.forEach(node, (child) => {
        if (!React.isValidElement(child)) return
        const element = child as React.ReactElement
        if (matches(element)) elements.push(element)
        elements.push(...collectElements(reactProps(element).children as React.ReactNode, matches))
    })

    return elements
}

function hexToRgb(hex: string): [number, number, number] {
    const value = hex.startsWith('#') ? hex.slice(1) : hex
    return [
        parseInt(value.slice(0, 2), 16),
        parseInt(value.slice(2, 4), 16),
        parseInt(value.slice(4, 6), 16),
    ]
}

async function renderBuiltCliFrame(prefix: string, frameName: string, source: string) {
    ensurePackageBuild()

    const outDir = await mkdtemp(join(tmpdir(), prefix))
    const framePath = join(outDir, frameName)
    const renderDir = join(outDir, 'renders')
    const packageRoot = process.cwd()

    try {
        await writeFile(framePath, source)

        const result = spawnSync(process.execPath, [
            join(packageRoot, 'dist', 'cli.js'),
            framePath,
            '--out',
            renderDir,
            '--theme',
            'light',
            '--scale',
            '1',
        ], {
            cwd: outDir,
            encoding: 'utf8',
            env: cliChildEnv(),
        })

        expect(result.status, result.stderr || result.stdout).toBe(0)

        const outputName = `${frameName.replace(/\.[^.]+$/, '')}_light.png`
        const buffer = await readFile(join(renderDir, outputName))
        const manifest = JSON.parse(await readFile(join(renderDir, 'manifest.json'), 'utf8')) as CliManifestEntry[]

        return { buffer, manifest }
    } finally {
        await rm(outDir, { recursive: true, force: true })
    }
}

function expectBottomPadding(image: { width: number; height: number; pixels: Uint8Array }) {
    const bg = detectBackgroundColor(image.pixels)
    const overflow = detectOverflow(image.pixels, image.width, image.height, bg)
    const bounds = detectContentBounds(image.pixels, image.width, image.height, bg, 0)

    expect(overflow.overflows, overflow.message).toBe(false)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(image.height - 4)
}

function expectTightHorizontalPadding(image: { width: number; height: number; pixels: Uint8Array }) {
    const bg = detectBackgroundColor(image.pixels)
    const bounds = detectContentBounds(image.pixels, image.width, image.height, bg, 0)
    const rightPadding = image.width - (bounds.x + bounds.width)

    expect(bounds.x).toBeLessThanOrEqual(32)
    expect(rightPadding).toBeLessThanOrEqual(32)
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

        const lowAlphaEdgePixels = new Uint8Array(width * height * 4)
        for (let x = 0; x < width; x++) {
            const offset = ((height - 1) * width + x) * 4
            lowAlphaEdgePixels[offset] = 12
            lowAlphaEdgePixels[offset + 1] = 20
            lowAlphaEdgePixels[offset + 2] = 36
            lowAlphaEdgePixels[offset + 3] = 32
        }

        const lowAlphaOverflow = detectOverflow(lowAlphaEdgePixels, width, height, bg)
        expect(lowAlphaOverflow.overflows).toBe(true)
        expect(lowAlphaOverflow.edges.bottom).toBe(true)
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

    it('keeps the final bar inset from the chart edge', async () => {
        const frame = defineIllustration((c) => (
            <BarChart
                c={c}
                title="Token mix"
                width={360}
                height={250}
                format="percent"
                data={[
                    { label: 'cache read', value: 0.78, color: 'positive', valueLabel: '78%' },
                    { label: 'uncached', value: 0.14, color: 'warning', valueLabel: '14%' },
                    { label: 'write', value: 0.08, color: '#2563eb', valueLabel: '8%' },
                ]}
            />
        ))

        const buffer = await renderToBuffer(frame.create('light'), 430, 360, { scale: 1 })
        const image = decodePng(buffer)
        const opaqueBounds = pixelBounds(image, (_r, _g, _b, a) => a > 240)
        const blueBounds = pixelBounds(
            image,
            (r, g, b, a) => a > 240 && Math.abs(r - 53) < 6 && Math.abs(g - 111) < 6 && Math.abs(b - 236) < 6,
        )

        expect(blueBounds.maxX).toBeGreaterThan(0)
        expect(opaqueBounds.maxX - blueBounds.maxX).toBeGreaterThanOrEqual(30)
    }, 30_000)

    it('keeps line chart endpoints inset from plot edges', () => {
        const chart = LineChart({
            c: getThemeColors('light'),
            width: 460,
            height: 250,
            format: 'percent',
            labels: ['cold', 't+1', 't+2', 't+3', 't+4'],
            series: [
                { name: 'cache read', points: [0.05, 0.42, 0.71, 0.86, 0.90], color: 'positive', area: true },
                { name: 'relative cost', points: [1.00, 0.58, 0.35, 0.20, 0.16], color: 'warning' },
            ],
        })
        const circles = collectElements(chart, (element) => element.type === 'circle')
        const circleXs = circles.map((circle) => Number(reactProps(circle).cx))

        expect(circleXs.length).toBe(10)
        expect(Math.min(...circleXs)).toBeGreaterThanOrEqual(60)
        expect(Math.max(...circleXs)).toBeLessThanOrEqual(420)
    })

    it('detects Pareto frontier geometry and renders safe log-scale points', async () => {
        const c = getThemeColors('light')
        const chart = ParetoChart({
            c,
            width: 520,
            height: 280,
            points: [
                { x: 1, y: 5, label: 'frontier-a' },
                { x: 2, y: 4, label: 'dominated' },
                { x: 3, y: 8, label: 'frontier-b' },
                { x: 4, y: 3, label: 'dominated-c' },
            ],
        })
        const frontierPaths = collectElements(chart, (element) =>
            element.type === 'path' && reactProps(element)['data-pareto-frontier'] === true,
        )
        const circles = collectElements(chart, (element) => element.type === 'circle')

        expect(frontierPaths).toHaveLength(1)
        expect(String(reactProps(frontierPaths[0]).d)).toMatch(/^M .+ L .+/)
        expect(circles).toHaveLength(4)
        expect(circles.filter((circle) => reactProps(circle)['data-pareto-status'] === 'frontier')).toHaveLength(2)
        expect(circles.filter((circle) => reactProps(circle)['data-pareto-status'] === 'dominated')).toHaveLength(2)
        expect(circles.filter((circle) => Number(reactProps(circle).opacity) < 1)).toHaveLength(2)

        const invertedChart = ParetoChart({
            c,
            xObjective: 'maximize',
            yObjective: 'minimize',
            points: [
                { x: 1, y: 5 },
                { x: 3, y: 4 },
                { x: 2, y: 2 },
            ],
        })
        const invertedCircles = collectElements(invertedChart, (element) => element.type === 'circle')
        expect(invertedCircles.filter((circle) => reactProps(circle)['data-pareto-status'] === 'frontier')).toHaveLength(2)
        expect(invertedCircles.filter((circle) => reactProps(circle)['data-pareto-status'] === 'dominated')).toHaveLength(1)

        const logChart = ParetoChart({
            c,
            xScale: 'log',
            xMin: 1,
            xMax: 100,
            width: 520,
            height: 280,
            points: [
                { x: 0, y: 2, label: 'zero' },
                { x: 10, y: 5, label: 'ten' },
                { x: 100, y: 6, label: 'hundred' },
                { x: -3, y: 1, label: 'negative' },
            ],
        })
        const logCircles = collectElements(logChart, (element) => element.type === 'circle')
        const logTickLabels = collectElements(logChart, (element) =>
            element.type === 'div' && String(element.key).startsWith('pareto-x-tick-'),
        )
        expect(logCircles).toHaveLength(2)
        expect(logTickLabels).toHaveLength(5)
        expect(reactProps(logTickLabels[0]).style).toMatchObject({
            justifyContent: 'flex-start',
            transform: 'translate(0, -50%)',
        })
        expect(reactProps(logTickLabels.at(-1)!).style).toMatchObject({
            justifyContent: 'flex-end',
            transform: 'translate(-100%, -50%)',
        })
        for (const circle of logCircles) {
            expect(Number.isFinite(Number(reactProps(circle).cx))).toBe(true)
            expect(Number.isFinite(Number(reactProps(circle).cy))).toBe(true)
        }
        await expect(renderToSvg(logChart, 520, 280)).resolves.not.toContain('NaN')
    })

    it('emphasizes selected QuadrantChart regions without overpowering others', () => {
        const chart = QuadrantChart({
            c: getThemeColors('light'),
            width: 460,
            height: 260,
            regions: {
                topLeft: { label: 'best', color: 'positive', emphasis: true },
                topRight: { label: 'maybe', color: 'primary' },
                bottomLeft: { label: 'defer', color: 'neutral' },
                bottomRight: { label: 'avoid', color: 'warning' },
            },
            points: [],
        })
        const regions = collectElements(chart, (element) => {
            const props = reactProps(element)
            return element.type === 'rect' && typeof props.opacity === 'number'
        })

        expect(regions).toHaveLength(4)
        expect(regions.filter((region) => Number(reactProps(region).opacity) === 0.2)).toHaveLength(1)
        expect(regions.filter((region) => Number(reactProps(region).opacity) === 0.1)).toHaveLength(3)
        const emphasized = regions.find((region) => Number(reactProps(region).opacity) === 0.2)
        expect(reactProps(emphasized!).stroke).toBe(reactProps(emphasized!).fill)
        expect(Number(reactProps(emphasized!).strokeWidth)).toBeGreaterThan(0)
    })

    it('maps QuadrantChart values, thresholds, and numeric axes to the configured domains', async () => {
        const chart = QuadrantChart({
            c: getThemeColors('light'),
            width: 460,
            height: 260,
            xMin: 0,
            xMax: 100,
            yMin: 0,
            yMax: 200,
            xThreshold: 25,
            yThreshold: 150,
            showTicks: true,
            formatX: (value) => `$${value}`,
            formatY: 'integer',
            regions: {
                topLeft: { label: 'best', color: 'positive', emphasis: true },
                topRight: { label: 'premium', color: 'primary' },
                bottomLeft: { label: 'budget', color: 'neutral' },
                bottomRight: { label: 'avoid', color: 'warning' },
            },
            points: [{ x: 25, y: 150, label: 'threshold' }],
        })
        const regions = collectElements(chart, (element) => {
            const props = reactProps(element)
            return element.type === 'rect' && typeof props.opacity === 'number'
        })
        const [point] = collectElements(chart, (element) => element.type === 'circle')
        const labels = collectElements(chart, (element) => element.type === 'div')
            .map((element) => String(reactProps(element).children))

        expect(Number(reactProps(regions[0]).width)).toBeCloseTo(98)
        expect(Number(reactProps(regions[1]).width)).toBeCloseTo(294)
        expect(Number(reactProps(regions[0]).height)).toBeCloseTo(51.5)
        expect(Number(reactProps(regions[2]).height)).toBeCloseTo(154.5)
        expect(Number(reactProps(point).cx)).toBeCloseTo(146)
        expect(Number(reactProps(point).cy)).toBeCloseTo(69.5)
        expect(labels).toEqual(expect.arrayContaining(['$0', '$25', '$50', '$75', '$100', '0', '50', '100', '150', '200']))
        await expect(renderToSvg(chart, 460, 260)).resolves.not.toContain('NaN')
    })

    it('keeps clamped bars and line markers inside the plot area', () => {
        const c = getThemeColors('light')
        const barChart = BarChart({
            c,
            width: 320,
            height: 220,
            min: 10,
            max: 20,
            data: [{ label: 'below range', value: 0, color: 'positive' }],
        })
        const [bar] = collectElements(barChart, (element) => element.type === 'rect')
        expect(bar).toBeDefined()
        const barY = Number(reactProps(bar!).y)
        const barHeight = Number(reactProps(bar!).height)
        expect(barY).toBeGreaterThanOrEqual(18)
        expect(barY + barHeight).toBeLessThanOrEqual(180)

        const lineChart = LineChart({
            c,
            width: 320,
            height: 220,
            min: 0,
            max: 1,
            series: [{ name: 'outside', points: [-1, 2], color: 'primary' }],
        })
        const markers = collectElements(lineChart, (element) => element.type === 'circle')
        expect(markers).toHaveLength(2)
        for (const marker of markers) {
            const props = reactProps(marker)
            const extent = Number(props.r) + Number(props.strokeWidth) / 2
            const center = Number(props.cy)
            expect(center - extent).toBeGreaterThanOrEqual(18)
            expect(center + extent).toBeLessThanOrEqual(196)
        }
    })

    it('handles chart boundary values without invalid or duplicate geometry', async () => {
        expect(formatChartValue(999_999.5, 'compact')).toBe('1.0M')
        expect(chartTicks(4, 4, 4)).toEqual([4])

        const c = getThemeColors('light')
        const miniBars = MiniBarChart({
            c,
            max: 0,
            data: [{ label: 'zero', value: 0 }],
        })
        await expect(renderToSvg(miniBars, 180, 100)).resolves.not.toContain('NaN')

        const shortDash = DashedLine({ x1: 0, y1: 0, x2: 2, y2: 0, color: c.primary, dotSpacing: 8 })
        expect(shortDash).toHaveLength(1)
    })

    it('positions donut center content inside the ring', () => {
        const donut = DonutChart({
            c: getThemeColors('light'),
            size: 140,
            thickness: 20,
            centerValue: '100%',
            segments: [{ label: 'complete', value: 1, color: 'positive' }],
        })
        const overlays = collectElements(donut, (element) => {
            const style = reactProps(element).style as React.CSSProperties | undefined
            return element.type === 'div' && style?.position === 'absolute'
        })

        expect(overlays).toContainEqual(expect.objectContaining({
            props: expect.objectContaining({
                style: expect.objectContaining({ top: 20, left: 20, width: 100, height: 100 }),
            }),
        }))
    })

    it('spaces line chart labels when series are empty', () => {
        const chart = LineChart({
            c: getThemeColors('light'),
            width: 300,
            height: 180,
            labels: ['first', 'second', 'third'],
            series: [],
        })
        const labels = collectElements(chart, (element) =>
            element.type === 'div' && ['first', 'second', 'third'].includes(String(reactProps(element).children)),
        )
        const positions = labels.map((label) => Number((reactProps(label).style as React.CSSProperties).left))

        expect(positions).toHaveLength(3)
        expect(new Set(positions).size).toBe(3)
        expect(Math.min(...positions)).toBeGreaterThan(0)
        expect(Math.max(...positions)).toBeLessThan(300)
    })

    it('keeps graph nodes inside the canvas at normalized boundaries', () => {
        const graph = GraphDiagram({
            c: getThemeColors('light'),
            width: 400,
            height: 240,
            padding: 20,
            nodeWidth: 100,
            nodeHeight: 50,
            nodes: [
                { id: 'start', label: 'Start', x: 0, y: 0 },
                { id: 'end', label: 'End', x: 1, y: 1 },
            ],
            edges: [],
        })
        const nodes = collectElements(graph, (element) => {
            const style = reactProps(element).style as React.CSSProperties | undefined
            return element.type === 'div'
                && style?.position === 'absolute'
                && style.width === 100
                && style.height === 50
        })
        const positions = nodes.map((node) => reactProps(node).style as React.CSSProperties)

        expect(positions).toHaveLength(2)
        expect(positions.map(({ left, top }) => [left, top])).toEqual([
            [0, 0],
            [300, 190],
        ])
    })

    it('auto-lays graph nodes when coordinates are omitted', () => {
        const graph = GraphDiagram({
            c: getThemeColors('light'),
            width: 720,
            height: 280,
            nodeWidth: 120,
            nodeHeight: 50,
            nodes: [
                { id: 'input', label: 'Input' },
                { id: 'left', label: 'Left branch' },
                { id: 'right', label: 'Right branch' },
                { id: 'output', label: 'Output' },
            ],
            edges: [
                { from: 'input', to: 'left' },
                { from: 'input', to: 'right' },
                { from: 'left', to: 'output' },
                { from: 'right', to: 'output' },
            ],
        })
        const nodes = collectElements(graph, (element) => {
            const style = reactProps(element).style as React.CSSProperties | undefined
            return element.type === 'div'
                && style?.position === 'absolute'
                && style.width === 120
                && style.height === 50
        }).map((node) => reactProps(node).style as React.CSSProperties)
        const paths = collectElements(graph, (element) => element.type === 'path' && Boolean(reactProps(element).markerEnd))

        expect(nodes).toHaveLength(4)
        expect(paths).toHaveLength(4)
        expect(new Set(nodes.map(({ left, top }) => `${left}:${top}`)).size).toBe(4)
        expect(reactProps(graph)['data-vizmatic-connector-crossings']).toBe(0)
    })

    it('reports crossings from manually positioned graph connectors', () => {
        const graph = GraphDiagram({
            c: getThemeColors('light'),
            width: 500,
            height: 260,
            nodeWidth: 80,
            nodeHeight: 44,
            nodes: [
                { id: 'top-left', label: 'A', x: 0, y: 0 },
                { id: 'bottom-left', label: 'B', x: 0, y: 1 },
                { id: 'top-right', label: 'C', x: 1, y: 0 },
                { id: 'bottom-right', label: 'D', x: 1, y: 1 },
            ],
            edges: [
                { from: 'top-left', to: 'bottom-right' },
                { from: 'bottom-left', to: 'top-right' },
            ],
        })

        expect(reactProps(graph)['data-vizmatic-connector-crossings']).toBe(1)
    })

    it('renders auto and manual self-loops and rejects mixed coordinate modes', () => {
        const loop = GraphDiagram({
            c: getThemeColors('light'),
            nodes: [{ id: 'retry', label: 'Retry' }],
            edges: [{ from: 'retry', to: 'retry', label: 'again' }],
        })
        const paths = collectElements(loop, (element) => element.type === 'path' && Boolean(reactProps(element).markerEnd))

        expect(paths).toHaveLength(1)
        const manualLoop = GraphDiagram({
            c: getThemeColors('light'),
            width: 420,
            height: 260,
            nodes: [{ id: 'retry', label: 'Retry', x: 0.4, y: 0.7 }],
            edges: [{ from: 'retry', to: 'retry', label: 'again' }],
        })
        expect(collectElements(manualLoop, (element) => element.type === 'path' && Boolean(reactProps(element).markerEnd))).toHaveLength(1)
        expect(() => GraphDiagram({
            c: getThemeColors('light'),
            nodes: [
                { id: 'manual', label: 'Manual', x: 0.2, y: 0.5 },
                { id: 'auto', label: 'Auto' },
            ],
            edges: [],
        })).toThrow(/all define both x and y, or all omit coordinates/)
    })

    it('keeps fixed auto-layout dimensions and stable ordered geometry', () => {
        const props = {
            c: getThemeColors('light'),
            width: 640,
            height: 280,
            sizing: 'fixed' as const,
            nodes: [
                { id: 'input', label: 'Input' },
                { id: 'left', label: 'Left' },
                { id: 'right', label: 'Right' },
                { id: 'output', label: 'Output' },
            ],
            edges: [
                { from: 'input', to: 'left' },
                { from: 'input', to: 'right' },
                { from: 'left', to: 'output' },
                { from: 'right', to: 'output' },
            ],
        }
        const geometry = () => {
            const graph = GraphDiagram(props)
            const nodes = collectElements(graph, (element) => {
                const style = reactProps(element).style as React.CSSProperties | undefined
                return element.type === 'div' && style?.position === 'absolute' && style.width === 150
            }).map((node) => {
                const style = reactProps(node).style as React.CSSProperties
                return [style.left, style.top]
            })
            const paths = collectElements(graph, (element) => element.type === 'path' && Boolean(reactProps(element).markerEnd))
                .map((path) => reactProps(path).d)
            return { graph, nodes, paths }
        }
        const first = geometry()
        const second = geometry()

        expect(reactProps(first.graph).style).toMatchObject({ width: 640, height: 280 })
        expect({ nodes: first.nodes, paths: first.paths }).toEqual({ nodes: second.nodes, paths: second.paths })
    })

    it('lays out nested graph groups, technical icons, and semantic relationships', () => {
        const graph = GraphDiagram({
            c: getThemeColors('light'),
            width: 760,
            height: 300,
            sizing: 'fixed',
            ariaLabel: 'Production architecture',
            groups: [
                { id: 'cloud', label: 'Cloud', tone: 'blue' },
                { id: 'data', label: 'Data', parent: 'cloud', tone: 'green' },
            ],
            nodes: [
                { id: 'client', label: 'Client', icon: 'browser' },
                { id: 'api', label: 'API', icon: 'server', iconSize: 999, group: 'cloud' },
                { id: 'db', label: 'Database', icon: 'database', group: 'data' },
            ],
            edges: [
                { from: 'client', to: 'api', kind: 'sync', arrow: 'both' },
                { from: 'api', to: 'db', kind: 'event' },
            ],
        })
        const groups = collectElements(graph, (element) => Boolean(reactProps(element)['data-vizmatic-graph-group']))
            .map((element) => reactProps(element).style as React.CSSProperties)
        const paths = collectElements(graph, (element) => element.type === 'path' && Boolean(reactProps(element).d))
            .map(reactProps)
            .filter((props) => props.markerStart || props.markerEnd)

        expect(reactProps(graph)['aria-label']).toBe('Production architecture')
        expect(groups).toHaveLength(2)
        expect(Number(groups[0].width)).toBeGreaterThan(Number(groups[1].width))
        expect(Number(groups[0].height)).toBeGreaterThan(Number(groups[1].height))
        expect(paths).toHaveLength(2)
        expect(paths[0].markerStart).toBeTruthy()
        expect(paths[0].markerEnd).toBeTruthy()
        expect(paths[1].strokeDasharray).toBe('2 6')
        expect(collectElements(graph, (element) => element.type === 'svg' && reactProps(element)['aria-label'] === 'API icon')).toHaveLength(1)
        const apiIcon = collectElements(graph, (element) => reactProps(element)['data-vizmatic-graph-icon'] === 'api')[0]
        expect(reactProps(apiIcon).style).toMatchObject({ width: 50, height: 50, overflow: 'hidden' })
    })

    it('validates graph groups and manual edge endpoints', () => {
        const c = getThemeColors('light')
        expect(() => GraphDiagram({
            c,
            nodes: [{ id: 'api', label: 'API', group: 'missing' }],
            edges: [],
            groups: [],
        })).toThrow(/missing group "missing"/)
        expect(() => GraphDiagram({
            c,
            nodes: [{ id: 'api', label: 'API' }],
            edges: [],
            groups: [{ id: 'empty', label: 'Empty' }],
        })).toThrow(/contains no nodes/)
        expect(() => GraphDiagram({
            c,
            nodes: [{ id: 'api', label: 'API', group: 'one' }],
            edges: [],
            groups: [
                { id: 'one', label: 'One', parent: 'two' },
                { id: 'two', label: 'Two', parent: 'one' },
            ],
        })).toThrow(/parent cycle/)
        expect(() => GraphDiagram({
            c,
            nodes: [{ id: 'api', label: 'API', x: 0.5, y: 0.5 }],
            edges: [{ from: 'api', to: 'missing' }],
        })).toThrow(/references a missing node/)
        expect(() => GraphDiagram({
            c,
            nodes: [{ id: 'api', label: 'API', x: 0.5, y: 0.5, group: 'prod' }],
            edges: [],
            groups: [{ id: 'prod', label: 'Production' }],
        })).toThrow(/groups require automatic layout/)
    })

    it('uses readable text when matrix colorization is disabled', () => {
        const matrix = Matrix({
            c: getThemeColors('light'),
            data: [[0.5]],
            colorize: false,
        })

        expect(analyzeContrast(matrix, 'light')).not.toContainEqual(expect.objectContaining({
            code: 'accessibility.low_contrast',
        }))
    })

    it('keeps semantic text tokens readable in both themes', () => {
        for (const theme of ['dark', 'light'] as const) {
            const c = getThemeColors(theme)
            const names = [
                'primary',
                'secondary',
                'positive',
                'warning',
                'critical',
                'info',
                'accent',
                'neutral',
            ] as const
            const colors = names.map((name) => getReadableColor(name, c))
            const labels = React.createElement('div', {
                style: { display: 'flex', backgroundColor: c.bgCard },
            }, ...colors.map((color, index) => React.createElement('div', {
                key: index,
                style: { display: 'flex', color, fontSize: 14 },
            }, 'Readable label')))

            expect(analyzeContrast(labels, theme)).not.toContainEqual(expect.objectContaining({
                code: 'accessibility.low_contrast',
            }))
        }
    })

    it('keeps tone text readable in both themes', () => {
        for (const theme of ['dark', 'light'] as const) {
            const c = getThemeColors(theme)
            const tones = ['blue', 'purple', 'green', 'warm', 'cyan', 'pink', 'red', 'critical', 'neutral', 'sunset', 'ocean', 'dark'] as const
            const labels = React.createElement('div', {
                style: { display: 'flex', backgroundColor: c.bgCard },
            }, ...tones.map((tone) => React.createElement('div', {
                key: tone,
                style: { display: 'flex', color: getReadableToneColor(tone, c), fontSize: 14 },
            }, tone)))

            expect(analyzeContrast(labels, theme)).not.toContainEqual(expect.objectContaining({
                code: 'accessibility.low_contrast',
            }))
        }
    })

    it('uses readable labels on solid semantic fills', () => {
        for (const theme of ['dark', 'light'] as const) {
            const c = getThemeColors(theme)
            const samples = [
                Box({ c, label: 'Filled box', color: 'positive' }),
                Matrix({ c, data: [[0.15, 0.5, 0.85]] }),
                LayeredNetwork({
                    c,
                    layers: [
                        { title: 'Input', nodes: ['A'], tone: 'blue' },
                        { title: 'Output', nodes: ['B'], tone: 'green' },
                    ],
                }),
            ]

            for (const sample of samples) {
                expect(analyzeContrast(sample, theme)).not.toContainEqual(expect.objectContaining({
                    code: 'accessibility.low_contrast',
                }))
            }
        }
    })

    it('uses readable labels on common CSS color formats', () => {
        const c = getThemeColors('light')
        for (const background of [
            '#fff',
            'rgb(255, 255, 255)',
            'hsl(0, 0%, 100%)',
            'rgba(255, 255, 255, 0.5)',
            'transparent',
            'var(--unknown-fill)',
        ]) {
            expect(getReadableTextColor(background, c)).toBe(c.textPrimary)
        }
        expect(getReadableTextColor('#000', c)).toBe(c.textOnColor)
    })

    it('does not guess contrast against unresolved gradient backgrounds', () => {
        const card = React.createElement('div', {
            style: {
                display: 'flex',
                backgroundImage: 'linear-gradient(90deg, #111827, #312e81)',
                color: '#ffffff',
            },
        }, 'Gradient label')

        expect(analyzeContrast(card, 'light', new Set(), '#ffffff')).not.toContainEqual(expect.objectContaining({
            code: 'accessibility.low_contrast',
        }))
    })

    it('checks solid backgrounds when background images are disabled', () => {
        const label = React.createElement('div', {
            style: {
                display: 'flex',
                backgroundColor: '#ffffff',
                backgroundImage: 'none',
                color: '#ffffff',
            },
        }, 'Unreadable label')

        expect(analyzeContrast(label, 'light')).toContainEqual(expect.objectContaining({
            code: 'accessibility.low_contrast',
        }))
    })

    it('renders network layers with no nodes', async () => {
        const network = LayeredNetwork({
            c: getThemeColors('light'),
            layers: [{ title: 'Empty layer', nodes: [] }],
        })

        await expect(renderToSvg(network, 900, 400)).resolves.toMatch(/^<svg\b/)
    })

    it('renders donut, timeline, tree, and icon primitives together', async () => {
        const c = getThemeColors('light')
        const donut = DonutChart({
            c,
            width: 300,
            height: 230,
            segments: [
                { label: 'charts', value: 0.4, color: 'positive' },
                { label: 'flows', value: 0.35, color: 'primary' },
                { label: 'icons', value: 0.25, color: 'warning' },
            ],
        })
        const tree = TreeDiagram({
            c,
            width: 320,
            height: 220,
            nodeWidth: 120,
            root: {
                label: 'Scene',
                tone: 'purple',
                children: [
                    { label: 'Chart', tone: 'green' },
                    { label: 'Narrative', tone: 'blue' },
                ],
            },
        })

        expect(collectElements(donut, (element) => element.type === 'path')).toHaveLength(3)
        expect(collectElements(tree, (element) => element.type === 'path')).toHaveLength(2)

        const frame = defineIllustration((themeColors) => (
            <Scene c={themeColors} title="Primitive family" gap={16}>
                <Row gap={16} align="stretch">
                    <DonutChart
                        c={themeColors}
                        width={300}
                        height={230}
                        title="Share"
                        format="percent"
                        centerValue="100%"
                        centerLabel="total"
                        segments={[
                            { label: 'charts', value: 0.4, color: 'positive' },
                            { label: 'flows', value: 0.35, color: 'primary' },
                            { label: 'icons', value: 0.25, color: 'warning' },
                        ]}
                    />
                    <Timeline
                        c={themeColors}
                        title="Timeline"
                        width={300}
                        events={[
                            { time: 'plan', title: 'Choose primitive', detail: 'match intent', tone: 'blue' },
                            { time: 'ship', title: 'Render output', detail: 'dark and light', tone: 'green' },
                        ]}
                    />
                    <TreeDiagram
                        c={themeColors}
                        title="Tree"
                        width={320}
                        height={230}
                        nodeWidth={120}
                        root={{
                            label: 'Scene',
                            tone: 'purple',
                            children: [
                                { label: 'Chart', tone: 'green' },
                                { label: 'Narrative', tone: 'blue' },
                            ],
                        }}
                    />
                </Row>
                <Icon c={themeColors} name="spark" tone="warm" size={28} />
            </Scene>
        ))

        const buffer = await renderToBuffer(frame.create('light'), 1040, 520, { scale: 1 })
        const image = decodePng(buffer)
        const opaqueBounds = pixelBounds(image, (_r, _g, _b, a) => a > 0)

        expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
        expect(opaqueBounds.maxX).toBeGreaterThan(opaqueBounds.minX)
        expect(opaqueBounds.maxY).toBeGreaterThan(opaqueBounds.minY)
        expect(pixelAt(image, 0, 0)[3]).toBe(0)
    }, 30_000)

    it('applies panel gap between direct body children', () => {
        const panel = Panel({
            c: getThemeColors('light'),
            title: 'Cache breakers',
            gap: 14,
            children: [
                React.createElement('div', { key: 'rows' }, 'rows'),
                React.createElement('div', { key: 'callout' }, 'callout'),
            ],
        })
        const panelElement = panel as React.ReactElement<{ children?: React.ReactNode }>
        const children = React.Children.toArray(panelElement.props.children)
        const body = children[1] as React.ReactElement<{ style: React.CSSProperties }>

        expect(body.props.style.gap).toBe(14)
    })

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
                env: cliChildEnv(),
            })
            expect(result.status, result.stderr || result.stdout).toBe(0)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('resolves dark and light theme tokens', () => {
        expect(getThemeColors('dark').bg).not.toBe(getThemeColors('light').bg)
        expect(getThemeColors('dark').primary).toBe(getThemeColors('light').primary)
        expect(getThemeColors('light')).toMatchObject({
            primaryLight: '#8b5cf6',
            secondaryLight: '#3b82f6',
            positiveLight: '#10b981',
            warningLight: '#f59e0b',
            criticalLight: '#ef4444',
            infoLight: '#06b6d4',
            accentLight: '#f472b6',
        })
        expect(colors).toMatchObject({
            preset: 'default',
            fontSans: 'Inter',
            fontMono: 'JetBrains Mono',
        })

        const engineering = getThemeColors('light', 'engineering')
        expect(engineering).toMatchObject({
            preset: 'engineering',
            bg: '#f4f4f5',
            shadow: 'rgba(0, 0, 0, 0)',
            fontSans: 'Inter',
            fontMono: 'JetBrains Mono',
        })
    })

    it('uses flat shared surfaces for the engineering preset', async () => {
        const c = getThemeColors('light', 'engineering')
        const metric = MetricCard({ c, label: 'Cache read', value: '84%', tone: 'green', shadow: true }) as React.ReactElement<{ style: React.CSSProperties }>
        const callout = CalloutCard({ c, title: 'Stable prefix', detail: 'Repeated context stays cacheable.', tone: 'purple' }) as React.ReactElement<{ style: React.CSSProperties }>

        expect(metric.props.style).toMatchObject({ borderRadius: 5 })
        expect(metric.props.style.boxShadow).toBeUndefined()
        expect(callout.props.style).toMatchObject({
            backgroundColor: getToneFill('purple', c),
            borderRadius: 5,
        })
        expect(callout.props.style.backgroundImage).toBeUndefined()
        expect(callout.props.style.boxShadow).toBeUndefined()

        const svg = await renderToSvg(
            <Scene c={c}>
                {metric}
                {callout}
            </Scene>,
            520,
            320,
        )
        expect(svg).not.toContain('linearGradient')
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
            const delays = gifFrameDelays(buffer)
            expect(delays).toHaveLength(18)
            expect(delays.reduce((total, delay) => total + delay, 0)).toBe(1_080)
            expect(gifLocalPaletteFlags(buffer)).toEqual(Array.from({ length: 18 }, () => false))
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('uses the requested frame rate for scene transitions', async () => {
        const c = getThemeColors('dark')
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-scene-fps-'))
        const outputPath = join(outDir, 'frame.gif')

        try {
            await renderAnimatedGif([{
                element: <Scene c={c}><StepCard c={c} title="Frame" tone="blue" /></Scene>,
                duration: 200,
                transition: 'appear',
                transitionDuration: 1_000,
            }], {
                width: 320,
                height: 200,
                outputPath,
                theme: 'dark',
                fps: 10,
            })

            const delays = gifFrameDelays(await readFile(outputPath))
            expect(delays).toHaveLength(11)
            expect(delays.reduce((total, delay) => total + delay, 0)).toBe(1_200)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('renders a sampled state timeline as a correctly timed GIF', async () => {
        const c = getThemeColors('dark')
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-timeline-gif-'))
        const outputPath = join(outDir, 'timeline.gif')
        const animation = defineAnimation({
            initial: { x: 0 },
            timeline: [hold(100), tween({ x: 100 }, { duration: 200, easing: 'ease-in-out' })],
            fps: 10,
            render: (state) => (
                <Scene c={c}>
                    <div style={{ display: 'flex', width: 40, marginLeft: state.x }}>
                        <StepCard c={c} title="chunk" tone="green" width={40} />
                    </div>
                </Scene>
            ),
        })

        try {
            await renderAnimationGif(animation, {
                width: 240,
                height: 140,
                outputPath,
                theme: 'dark',
            })

            const buffer = await readFile(outputPath)
            expect(buffer.subarray(0, 6).toString('ascii')).toBe('GIF89a')
            expect(gifFrameDelays(buffer).reduce((total, delay) => total + delay, 0)).toBe(300)
            expect(gifLocalPaletteFlags(buffer).every((flag) => !flag)).toBe(true)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('preserves one-bit transparency in animated GIF frames and transitions', async () => {
        const c = getThemeColors('light')
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-transparent-gif-'))
        const outputPath = join(outDir, 'frame.gif')

        try {
            await renderAnimatedGif([
                {
                    element: <Scene c={c}><StepCard c={c} title="One" tone="blue" width={180} /></Scene>,
                    duration: 100,
                },
                {
                    element: <Scene c={c}><StepCard c={c} title="Two" tone="green" width={180} /></Scene>,
                    duration: 100,
                    transition: 'appear',
                    transitionDuration: 300,
                },
            ], {
                width: 320,
                height: 200,
                outputPath,
                theme: 'light',
                background: 'transparent',
            })

            const buffer = await readFile(outputPath)
            const transparencyFlags = gifTransparencyFlags(buffer)
            expect(transparencyFlags.length).toBeGreaterThan(2)
            expect(transparencyFlags.every(Boolean)).toBe(true)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('rasterizes requested timeline backgrounds as opaque full frames', async () => {
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-opaque-timeline-gif-'))
        const outputPath = join(outDir, 'timeline.gif')
        const animation = defineAnimation({
            initial: { x: 0 },
            timeline: [tween({ x: 40 }, { duration: 200 })],
            fps: 10,
            render: (state) => (
                <div style={{ display: 'flex', width: 20, height: 20, marginLeft: state.x, background: '#ff0000' }} />
            ),
        })

        try {
            await renderAnimationGif(animation, {
                width: 120,
                height: 80,
                outputPath,
                theme: 'light',
                background: 'theme',
            })

            expect(gifTransparencyFlags(await readFile(outputPath)).every((flag) => !flag)).toBe(true)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('uses CSS background colors for GIF transition frames', async () => {
        const c = getThemeColors('light')
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-css-background-gif-'))
        const outputPath = join(outDir, 'frame.gif')

        try {
            await renderAnimatedGif([
                {
                    element: <Scene c={c}><StepCard c={c} title="One" tone="blue" width={180} /></Scene>,
                    duration: 100,
                },
                {
                    element: <Scene c={c}><StepCard c={c} title="Two" tone="green" width={180} /></Scene>,
                    duration: 100,
                    transition: 'appear',
                    transitionDuration: 300,
                },
            ], {
                width: 320,
                height: 200,
                outputPath,
                theme: 'light',
                background: 'rebeccapurple',
            })

            const transparencyFlags = gifTransparencyFlags(await readFile(outputPath))
            expect(transparencyFlags.length).toBeGreaterThan(2)
            expect(transparencyFlags.every((flag) => !flag)).toBe(true)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('honors solid boxes and color-only grid cells', async () => {
        const c = getThemeColors('dark')
        const solid = await renderToSvg(<Box c={c} label="Solid" color="positive" />, 240, 160)
        const gradient = await renderToSvg(<Box c={c} label="Gradient" color="positive" gradient />, 240, 160)
        const grid = await renderToSvg(
            <Grid c={c} rows={[[{ color: '#ff00ff' }, { opacity: 0.5 }]]} />,
            240,
            160,
        )

        expect(solid).not.toContain('linearGradient')
        expect(gradient).toContain('linearGradient')
        expect(grid).toContain('opacity="0.5"')
    }, 30_000)

    it('uses explicit light theme defaults for direct-render watermarks', async () => {
        const c = getThemeColors('light')
        const svg = await renderToSvg(
            <Scene c={c}><StepCard c={c} title="Light" tone="green" /></Scene>,
            320,
            200,
            { watermark: true, theme: 'light' },
        )

        expect(svg).toContain('#7c3aed')
        expect(svg).not.toContain('#a78bfa')
    }, 30_000)

    it('renders an ad hoc TSX frame through the CLI shortcut', async () => {
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-cli-'))
        const framePath = join(outDir, 'frame.tsx')
        const renderDir = join(outDir, 'renders')

        try {
            await writeFile(framePath, `import React from 'react'
import { defineIllustration, Scene, StepCard } from 'vizmatic'

export const width = 320
export const height = 240

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
                env: cliChildEnv(),
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
            await writeFile(framePath, `preset = "engineering";
width = 520;
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
                env: cliChildEnv(),
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

    it('warns and uses the default theme for an unknown bare-frame preset', async () => {
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-unknown-preset-cli-'))
        const framePath = join(outDir, 'unknown-preset.tsx')
        const renderDir = join(outDir, 'renders')

        try {
            await writeFile(framePath, `preset = "missing"; // fall back instead of executing this assignment
width = 320;
height = 240;

<Scene title="Unknown preset" background={c.bg}>
    <StepCard title="Default theme" tone="green" />
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
                'light',
            ], {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: cliChildEnv(),
            })

            expect(result.status, result.stderr || result.stdout).toBe(0)
            expect(result.stderr).toContain('Unknown preset "missing"; using "default"')

            const buffer = await readFile(join(renderDir, 'unknown-preset_light.png'))
            expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
            expect(pixelAt(decodePng(buffer), 0, 0)).toEqual([...hexToRgb(getThemeColors('light').bg), 255])
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('loads default-element TSX modules with multiline imports', async () => {
        const { buffer } = await renderBuiltCliFrame('vizmatic-cli-multiline-', 'multiline.tsx', `import {
  getThemeColors,
  Scene,
  StepCard,
} from 'vizmatic'

const c = getThemeColors('light')

export default (
  <Scene c={c}>
    <StepCard c={c} title="Multiline import" tone="green" />
  </Scene>
)
`)

        expect(decodePng(buffer).width).toBeGreaterThan(0)
    }, 30_000)

    it('loads modules with an aliased default React import', async () => {
        const { buffer } = await renderBuiltCliFrame('vizmatic-cli-react-alias-', 'react-alias.tsx', `import { default as React } from 'react'
import { getThemeColors, Scene, StepCard } from 'vizmatic'

const c = getThemeColors('light')
export default <Scene c={c}><StepCard c={c} title="React alias" tone="green" /></Scene>
`)

        expect(decodePng(buffer).width).toBeGreaterThan(0)
    }, 30_000)

    it('keeps the original module URL while supplying a global React binding', async () => {
        ensurePackageBuild()
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-cli-relative-asset-'))
        const framePath = join(outDir, 'frame.tsx')
        const renderDir = join(outDir, 'renders')

        try {
            await writeFile(join(outDir, 'label.txt'), 'Asset label\n')
            await writeFile(framePath, `import { readFileSync } from 'fs'
import { getThemeColors, Scene, StepCard } from 'vizmatic'

export const width = 320
export const height = 200

const label = readFileSync(new URL('./label.txt', import.meta.url), 'utf8').trim()

export function create(theme = 'light') {
  const c = getThemeColors(theme)
  return <Scene c={c}><StepCard c={c} title={label} tone="green" /></Scene>
}
`)

            const result = spawnSync(process.execPath, [
                join(process.cwd(), 'dist', 'cli.js'),
                framePath,
                '--out',
                renderDir,
                '--theme',
                'light',
            ], { cwd: outDir, encoding: 'utf8', env: cliChildEnv() })

            expect(result.status, result.stderr || result.stdout).toBe(0)
            await expect(readFile(join(renderDir, 'frame_light.png'))).resolves.toBeDefined()
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('preserves module-relative assets, dynamic imports, and source strings', async () => {
        ensurePackageBuild()
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-cli-relative-module-'))
        const framePath = join(outDir, 'relative.tsx')
        const renderDir = join(outDir, 'renders')

        try {
            await writeFile(join(outDir, 'package.json'), '{"type":"module"}\n')
            await writeFile(join(outDir, 'label.txt'), 'Relative asset')
            await writeFile(join(outDir, 'detail.ts'), `export const detail = 'Dynamic import'\n`)
            await writeFile(framePath, `/*
import React from 'react'
*/
import { readFileSync } from 'fs'
import { defineIllustration, Scene, StepCard } from 'vizmatic'

const literal = "from './untouched'"
if (literal !== "from './untouched'") throw new Error('source string was rewritten')
const exampleSource = \`
import React from 'react'
\`
if (!exampleSource.includes("from 'react'")) throw new Error('template string was rewritten')
const title = readFileSync(new URL('./label.txt', import.meta.url), 'utf8')
const { detail } = await import('./detail.ts')
const frame = defineIllustration((c) => (
  <Scene c={c}>
    <StepCard c={c} title={title} subtitle={detail} tone="green" />
  </Scene>
))

export const create = frame.create
export default frame.default
`)

            const result = spawnSync(process.execPath, [
                join(process.cwd(), 'dist', 'cli.js'),
                framePath,
                '--out',
                renderDir,
                '--theme',
                'light',
            ], { cwd: outDir, encoding: 'utf8', env: cliChildEnv() })

            expect(result.status, result.stderr || result.stdout).toBe(0)
            await expect(readFile(join(renderDir, 'relative_light.png'))).resolves.toBeDefined()
            expect((await readdir(outDir)).some((name) => name.includes('.vizmatic-'))).toBe(false)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('loads bare frames with multiline dependency imports', async () => {
        const { buffer } = await renderBuiltCliFrame('vizmatic-cli-bare-multiline-', 'bare-multiline.tsx', `import {
  basename,
} from 'path'

const title = basename('/tmp/multiline-import')

<Scene>
  <StepCard title={title} tone="green" />
</Scene>
`)

        expect(decodePng(buffer).width).toBeGreaterThan(0)
    }, 30_000)

    it('uses collision-safe output stems for duplicate frame basenames', async () => {
        ensurePackageBuild()
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-cli-collision-'))
        const firstDir = join(outDir, 'a')
        const secondDir = join(outDir, 'b')
        const renderDir = join(outDir, 'renders')

        try {
            await mkdir(firstDir, { recursive: true })
            await mkdir(secondDir, { recursive: true })
            await writeFile(join(firstDir, 'frame.tsx'), '<Scene><StepCard title="First" tone="green" /></Scene>\n')
            await writeFile(join(secondDir, 'frame.tsx'), '<Scene><StepCard title="Second" tone="purple" /></Scene>\n')

            const result = spawnSync(process.execPath, [
                join(process.cwd(), 'dist', 'cli.js'),
                firstDir,
                secondDir,
                '--out',
                renderDir,
                '--theme',
                'light',
                '--scale',
                '1',
            ], { cwd: outDir, encoding: 'utf8', env: cliChildEnv() })

            expect(result.status, result.stderr || result.stdout).toBe(0)
            const manifest = JSON.parse(await readFile(join(renderDir, 'manifest.json'), 'utf8')) as CliManifestEntry[]
            expect(manifest.map((entry) => entry.outputs?.[0])).toEqual([
                'a__frame_light.png',
                'b__frame_light.png',
            ])
            await expect(readFile(join(renderDir, 'a__frame_light.png'))).resolves.toBeDefined()
            await expect(readFile(join(renderDir, 'b__frame_light.png'))).resolves.toBeDefined()
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('records exact dimensions for every themed CLI output', async () => {
        ensurePackageBuild()
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-cli-manifest-'))
        const framePath = join(outDir, 'theme-size.tsx')
        const renderDir = join(outDir, 'renders')

        try {
            await writeFile(framePath, `<Scene>
  <div style={{ display: 'flex', width: c.bg === '#f5f7fa' ? 1300 : 400, height: 120, backgroundColor: c.primary }} />
</Scene>
`)
            const result = spawnSync(process.execPath, [
                join(process.cwd(), 'dist', 'cli.js'),
                framePath,
                '--out',
                renderDir,
                '--theme',
                'dark,light',
            ], { cwd: outDir, encoding: 'utf8', env: cliChildEnv() })

            expect(result.status, result.stderr || result.stdout).toBe(0)
            const manifest = JSON.parse(await readFile(join(renderDir, 'manifest.json'), 'utf8')) as CliManifestEntry[]
            const details = manifest[0]?.outputDetails ?? []
            expect(details).toHaveLength(2)

            for (const detail of details) {
                const image = decodePng(await readFile(join(renderDir, detail.path)))
                expect({ width: detail.width, height: detail.height }).toEqual({ width: image.width, height: image.height })
            }
            expect(details[0]?.width).not.toBe(details[1]?.width)
            expect(manifest[0]?.outputWidth).toBe(Math.max(...details.map((detail) => detail.width)))
            expect(manifest[0]?.outputHeight).toBe(Math.max(...details.map((detail) => detail.height)))
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
                env: cliChildEnv(),
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

    it('auto-expands generated default CLI dimensions when content overflows', async () => {
        ensurePackageBuild()

        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-generated-auto-size-cli-'))
        const framePath = join(outDir, 'generated-default.tsx')
        const renderDir = join(outDir, 'renders')
        const packageRoot = process.cwd()

        try {
            await writeFile(framePath, `import React from 'react'
import { CalloutCard, defineIllustration, Row, Scene } from 'vizmatic'

export const width = 960
export const height = 540

const frame = defineIllustration((c) => (
    <Scene c={c} title="Generated default">
        <Row gap={18} width="100%" justify="center">
            <CalloutCard c={c} title="First wide panel" detail="Generated wrappers often set default dimensions." tone="blue" width={470} />
            <CalloutCard c={c} title="Second wide panel" detail="The CLI should still fit content." tone="purple" width={470} />
            <CalloutCard c={c} title="Third wide panel" detail="No user size was provided upstream." tone="green" width={470} />
        </Row>
    </Scene>
))

export const create = frame.create
export default frame.default
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
                env: cliChildEnv(),
            })

            expect(result.status, result.stderr || result.stdout).toBe(0)

            const manifest = JSON.parse(await readFile(join(renderDir, 'manifest.json'), 'utf8')) as Array<{ width: number; height: number }>
            expect(manifest[0]?.width).toBeGreaterThan(960)
            expect(manifest[0]?.height).toBe(540)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('auto-expands generated default CLI height when content overflows vertically', async () => {
        ensurePackageBuild()

        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-generated-auto-height-cli-'))
        const framePath = join(outDir, 'generated-tall.tsx')
        const renderDir = join(outDir, 'renders')
        const packageRoot = process.cwd()

        try {
            await writeFile(framePath, `import React from 'react'
import { defineIllustration, Scene } from 'vizmatic'

export const width = 960
export const height = 540

const frame = defineIllustration((c) => (
    <Scene c={c} title="Generated tall">
        <div
            style={{
                width: '100%',
                height: 620,
                borderRadius: 10,
                background: c.bgCard,
                border: \`1px solid \${c.border}\`,
            }}
        />
    </Scene>
))

export const create = frame.create
export default frame.default
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
                env: cliChildEnv(),
            })

            expect(result.status, result.stderr || result.stdout).toBe(0)

            const manifest = JSON.parse(await readFile(join(renderDir, 'manifest.json'), 'utf8')) as Array<{ width: number; height: number }>
            expect(manifest[0]?.width).toBe(960)
            expect(manifest[0]?.height).toBeGreaterThan(540)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('auto-expands omitted CLI height for dashboard rows that clip at the bottom', async () => {
        const { buffer, manifest } = await renderBuiltCliFrame('vizmatic-dashboard-autofit-', 'dashboard.tsx', String.raw`<Scene gap={18}>
  <Row gap={14} width="100%" align="stretch">
    <MetricCard
      label="Cost per task"
      value="10-20%"
      detail="relative to baseline"
      tone="green"
      width={220}
      valueFontSize={24}
    />
    <MetricCard
      label="Warm cache read"
      value="target: >80%"
      detail="long-running sessions"
      tone="purple"
      width={220}
      valueFontSize={18}
    />
    <MetricCard
      label="Cache writes"
      value="spike watch"
      detail="deploy regression signal"
      tone="warm"
      width={220}
      valueFontSize={18}
    />
    <MetricCard
      label="Service tier"
      value="route mix"
      detail="standard, Flex, Batch"
      tone="cyan"
      width={220}
      valueFontSize={18}
    />
  </Row>
  <Row gap={18} align="stretch">
    <LineChart
      title="Cache and cost after deploy"
      width={460}
      height={250}
      format="percent"
      labels={["cold", "t+1", "t+2", "t+3", "t+4"]}
      series={[
        { name: "cache read", points: [0.05, 0.42, 0.71, 0.86, 0.90], color: "positive", area: true },
        { name: "relative cost", points: [1.00, 0.58, 0.35, 0.20, 0.16], color: "warning" },
      ]}
    />
    <BarChart
      title="Token mix"
      width={360}
      height={250}
      format="percent"
      data={[
        { label: "cache read", value: 0.78, color: "positive", valueLabel: "78%" },
        { label: "uncached", value: 0.14, color: "warning", valueLabel: "14%" },
        { label: "write", value: 0.08, color: "secondary", valueLabel: "8%" },
      ]}
    />
  </Row>
  <StatusList
    width="100%"
    rows={[
      { label: "Monitor warm-turn cache-read rate by route and model", detail: "drop after deploy usually means request-shape regression", status: "check", tone: "green" },
      { label: "Watch cache-write spikes without traffic growth", detail: "often points to prefix churn", status: "warn", tone: "warm" },
      { label: "Compare p95 latency for standard, Flex, and Batch paths", detail: "cost work should not hide product latency changes", status: "info", tone: "cyan" },
    ]}
  />
</Scene>
`)

        const image = decodePng(buffer)
        expect(manifest[0]?.width).toBe(960)
        expect(manifest[0]?.height).toBeGreaterThan(540)
        expect(image.height).toBeGreaterThan(540)
        expectBottomPadding(image)
    }, 30_000)

    it('crops horizontal gutters after CLI auto-size without reflow', async () => {
        const { buffer, manifest } = await renderBuiltCliFrame('vizmatic-loop-horizontal-crop-', 'loop.tsx', String.raw`<Scene gap={22}>
  <Flow
    connectorTone="purple"
    stages={[
      {
        eyebrow: "find",
        title: "Cloud Cost Management",
        subtitle: "where spend moved",
        tone: "purple",
        lines: ["service", "team", "deploy window"],
        width: 205,
      },
      {
        eyebrow: "explain",
        title: "Agent Observability",
        subtitle: "what reached the provider",
        tone: "blue",
        lines: ["token mix", "cache reads", "cache writes"],
        width: 205,
      },
      {
        eyebrow: "classify",
        title: "APM",
        subtitle: "whether a user waited",
        tone: "cyan",
        lines: ["interactive", "background", "batchable"],
        width: 205,
      },
      {
        eyebrow: "verify",
        title: "DDSQL and monitors",
        subtitle: "whether the fix held",
        tone: "green",
        lines: ["cache rate", "cost per task", "latency"],
        width: 205,
      },
    ]}
  />
  <Row width="100%" gap={16} align="stretch">
    <MetricCard
      label="Relative cost per task"
      value="100% -> 10-20%"
      detail="sanitized representative workflow"
      tone="green"
      width={250}
      valueFontSize={20}
    />
    <MetricCard
      label="Opportunity from request shape"
      value="80-90%"
      detail="caching and prefix stability"
      tone="purple"
      width={250}
      valueFontSize={24}
    />
    <CalloutCard
      title="No model downgrade required"
      detail="The largest wins came from keeping repeated context stable, preserving cache controls, and routing background work separately."
      tone="blue"
      width={460}
    />
  </Row>
</Scene>
`)

        const image = decodePng(buffer)
        expect(image.width).toBeLessThan(1140)
        expect(image.width).toBeGreaterThan(1040)
        expect(manifest[0]?.outputWidth).toBe(image.width)
        expect(manifest[0]?.outputHeight).toBe(image.height)
        expectTightHorizontalPadding(image)
    }, 30_000)

    it('can crop height while preserving declared width for fixed-frame consumers', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'vizmatic-height-crop-'))
        const outputPath = join(dir, 'frame.png')

        try {
            const c = getThemeColors('dark')
            const output = await renderToPngWithOutput(
                <Scene c={c} title="Fixed width" background={c.bg} contentWidth={520}>
                    <Panel c={c} title="Compact content" tone="green" width={480}>
                        <StepCard c={c} title="Done" subtitle="height-only crop" tone="green" />
                    </Panel>
                </Scene>,
                {
                    width: 760,
                    height: 620,
                    outputPath,
                    scale: 1,
                    background: 'theme',
                    crop: 'height',
                },
            )

            const image = decodePng(await readFile(outputPath))
            expect(output.width).toBe(760)
            expect(image.width).toBe(760)
            expect(output.height).toBeLessThan(620)
            expect(image.height).toBe(output.height)

            const background = detectBackgroundColor(image.pixels)
            const content = detectContentBounds(
                image.pixels,
                image.width,
                image.height,
                background,
                0,
            )
            const bottomPadding = image.height - (content.y + content.height)
            expect(bottomPadding).toBeGreaterThanOrEqual(20)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    }, 30_000)

    it('reports final responsive layout nodes and exposes observers on direct render APIs', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'vizmatic-layout-observer-'))
        const outputPath = join(dir, 'frame.png')
        const frame = () => (
            <div style={{ display: 'flex', width: '100%', height: '100%' }}>
                <div style={{ display: 'flex', width: 120, height: 40, backgroundColor: '#22c55e' }}>Final layout</div>
            </div>
        )

        try {
            const pngNodes: SatoriNode[] = []
            const output = await renderToPngWithOutput(frame(), {
                width: 360,
                height: 300,
                outputPath,
                scale: 1,
                crop: true,
                onNodeDetected: (node) => pngNodes.push(node),
            }, () => frame(), 'light')

            expect(output.height).toBeLessThan(300)
            expect(pngNodes.length).toBeGreaterThan(0)
            expect(Math.max(...pngNodes.map((node) => node.top + node.height))).toBeLessThanOrEqual(output.height + 0.5)

            const bufferNodes: SatoriNode[] = []
            await renderToBuffer(frame(), 360, 120, { scale: 1, onNodeDetected: (node) => bufferNodes.push(node) })
            expect(bufferNodes.length).toBeGreaterThan(0)

            const svgNodes: SatoriNode[] = []
            await renderToSvg(frame(), 360, 120, { onNodeDetected: (node) => svgNodes.push(node) })
            expect(svgNodes.length).toBeGreaterThan(0)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    }, 30_000)

    it('does not let final autocrop reintroduce clipping after CLI auto-size', async () => {
        const { buffer, manifest } = await renderBuiltCliFrame('vizmatic-routing-autocrop-', 'routing.tsx', String.raw`<Scene>
  <GraphDiagram
    width={900}
    height={410}
    nodeWidth={150}
    nodeHeight={64}
    nodes={[
      { id: "apm", label: "APM trace", detail: "request context", x: 0.10, y: 0.50, tone: "blue" },
      { id: "wait", label: "User waiting?", detail: "blocking path", x: 0.32, y: 0.50, tone: "purple" },
      { id: "standard", label: "Standard tier", detail: "chat, UI, response path", x: 0.56, y: 0.28, tone: "green" },
      { id: "background", label: "Background work", detail: "evals, enrichment, backfills", x: 0.56, y: 0.72, tone: "cyan" },
      { id: "batch", label: "Batch", detail: "finite independent jobs", x: 0.80, y: 0.62, tone: "green" },
      { id: "flex", label: "Flex", detail: "can wait, not batch-shaped", x: 0.80, y: 0.84, tone: "warm" },
      { id: "measure", label: "Measure task", detail: "cost, latency, quality", x: 0.90, y: 0.28, tone: "purple" },
    ]}
    edges={[
      { from: "apm", to: "wait", label: "inspect", tone: "blue" },
      { from: "wait", to: "standard", label: "yes", tone: "green" },
      { from: "wait", to: "background", label: "no", tone: "cyan" },
      { from: "background", to: "batch", label: "finite", tone: "green" },
      { from: "background", to: "flex", label: "can wait", tone: "warm" },
      { from: "standard", to: "measure", label: "verify", tone: "purple" },
      { from: "batch", to: "measure", label: "verify", tone: "purple" },
      { from: "flex", to: "measure", label: "verify", tone: "purple" },
    ]}
  />
  <Row gap={14} width="100%">
    <MetricCard
      label="Interactive"
      value="standard"
      detail="optimize cache and model choice first"
      tone="green"
      width={300}
      valueFontSize={20}
    />
    <MetricCard
      label="Background"
      value="Flex / Batch"
      detail="when completion time can move"
      tone="cyan"
      width={300}
      valueFontSize={20}
    />
    <CalloutCard
      title="Route by workflow, not habit"
      detail="Agent Observability shows model cost. APM shows whether anyone waited."
      tone="purple"
      width={330}
    />
  </Row>
</Scene>
`)

        const image = decodePng(buffer)
        expect(manifest[0]?.width).toBeGreaterThan(960)
        expect(manifest[0]?.height).toBeGreaterThan(540)
        expectBottomPadding(image)
    }, 30_000)

    it('renders a directory of multiple bare TSX frames through the built CLI', async () => {
        ensurePackageBuild()

        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-bare-directory-'))
        const framesDir = join(outDir, 'frames')
        const renderDir = join(outDir, 'renders')
        const packageRoot = process.cwd()

        try {
            await mkdir(framesDir, { recursive: true })
            await mkdir(join(framesDir, '_shared'), { recursive: true })
            await writeFile(join(framesDir, '_shared', 'helper.tsx'), 'export const helper = <div>not a frame</div>\n')
            await writeFile(join(framesDir, '01-flow.tsx'), String.raw`<Scene gap={18}>
  <Flow
    stages={[
      { title: "Find", subtitle: "owner", tone: "purple", width: 180 },
      { title: "Explain", subtitle: "trace", tone: "blue", width: 180 },
      { title: "Verify", subtitle: "result", tone: "green", width: 180 },
    ]}
  />
</Scene>
`)
            await writeFile(join(framesDir, '02-graph.tsx'), String.raw`<Scene>
  <GraphDiagram
    width={720}
    height={320}
    nodes={[
      { id: "a", label: "APM", detail: "context", x: 0.18, y: 0.50, tone: "blue" },
      { id: "b", label: "Agent trace", detail: "span fields", x: 0.50, y: 0.30, tone: "purple" },
      { id: "c", label: "Fix", detail: "verify", x: 0.82, y: 0.50, tone: "green" },
    ]}
    edges={[
      { from: "a", to: "b", label: "open", tone: "blue" },
      { from: "b", to: "c", label: "patch", tone: "green" },
    ]}
  />
</Scene>
`)
            await writeFile(join(framesDir, '03-panel.tsx'), String.raw`<Scene>
  <Row gap={14} width="100%" align="stretch">
    <Panel title="Cache layout" tone="green" width={460}>
      <StatusList
        rows={[
          { label: "Stable prefix", detail: "same bytes across turns", status: "check", tone: "green" },
          { label: "Volatile fields", detail: "move late", status: "warn", tone: "warm" },
        ]}
      />
    </Panel>
    <CalloutCard
      title="Directory render"
      detail="Multiple generated bare-frame wrappers stay ESM."
      tone="purple"
      width={360}
    />
  </Row>
</Scene>
`)

            const result = spawnSync(process.execPath, [
                join(packageRoot, 'dist', 'cli.js'),
                framesDir,
                '--out',
                renderDir,
                '--theme',
                'light',
                '--scale',
                '1',
            ], {
                cwd: outDir,
                encoding: 'utf8',
                env: cliChildEnv(),
            })

            expect(result.status, result.stderr || result.stdout).toBe(0)

            const manifest = JSON.parse(await readFile(join(renderDir, 'manifest.json'), 'utf8')) as Array<{ outputs: string[] }>
            expect(manifest).toHaveLength(3)
            for (const entry of manifest) {
                const output = entry.outputs[0]
                expect(output).toBeTruthy()
                const buffer = await readFile(join(renderDir, output))
                expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
            }
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('keeps generated default CLI dimensions strict when autoSize is disabled', async () => {
        ensurePackageBuild()

        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-generated-strict-size-cli-'))
        const framePath = join(outDir, 'generated-strict.tsx')
        const renderDir = join(outDir, 'renders')
        const packageRoot = process.cwd()

        try {
            await writeFile(framePath, `import React from 'react'
import { CalloutCard, defineIllustration, Row, Scene } from 'vizmatic'

export const width = 960
export const height = 540
export const autoSize = false

const frame = defineIllustration((c) => (
    <Scene c={c} title="Generated strict">
        <Row gap={18} width="100%" justify="center">
            <CalloutCard c={c} title="First wide panel" detail="Default width overflows." tone="blue" width={470} />
            <CalloutCard c={c} title="Second wide panel" detail="Auto-fit disabled." tone="purple" width={470} />
            <CalloutCard c={c} title="Third wide panel" detail="Surface the error." tone="green" width={470} />
        </Row>
    </Scene>
))

export const create = frame.create
export default frame.default
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
                env: cliChildEnv(),
            })

            expect(result.status).not.toBe(0)
            expect(result.stderr || result.stdout).toContain('Canvas overflow detected')
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
                env: cliChildEnv(),
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
        const sideEffectPath = join(outDir, 'side-effect.ts')
        const renderDir = join(outDir, 'renders')
        const packageRoot = process.cwd()

        try {
            await writeFile(helperPath, `export const title = 'Bare global'\n`)
            await writeFile(sideEffectPath, `globalThis.__vizmaticSideEffectLoaded = true\n`)
            await writeFile(framePath, `import { title } from './copy'

width = 560
height = 320

import './side-effect'

const literal = "from './copy'"
if (literal !== "from './copy'") throw new Error('source string was rewritten')
if (!globalThis.__vizmaticSideEffectLoaded) throw new Error('side-effect import did not load')
const sourceText = \`
import './missing-template-import'
\`
if (!sourceText.includes('missing-template-import')) throw new Error('template string was rewritten')
/*
import './missing-comment-import'
*/
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
                env: cliChildEnv(),
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
                env: cliChildEnv(),
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
                '1.333',
            ], {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: cliChildEnv(),
            })

            expect(result.status, result.stderr || result.stdout).toBe(0)
            expect(result.stdout).toContain('rendered')

            const buffer = await readFile(join(renderDir, 'animated_dark.gif'))
            expect(buffer.subarray(0, 6).toString('ascii')).toBe('GIF89a')
            const dimensions = { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
            expect(Number.isInteger(dimensions.width)).toBe(true)
            expect(Number.isInteger(dimensions.height)).toBe(true)

            const manifest = JSON.parse(await readFile(join(renderDir, 'gif-manifest.json'), 'utf8')) as CliManifestEntry[]
            expect(manifest[0]?.outputDetails).toEqual([{
                theme: 'dark',
                path: 'animated_dark.gif',
                ...dimensions,
            }])
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)

    it('renders an imported createAnimation timeline through the GIF CLI', async () => {
        const outDir = await mkdtemp(join(tmpdir(), 'vizmatic-cli-timeline-'))
        const framePath = join(outDir, 'timeline.tsx')
        const renderDir = join(outDir, 'renders')

        try {
            await writeFile(framePath, `import React from 'react'
import {
    Scene,
    StepCard,
    defineAnimation,
    getThemeColors,
    hold,
    tween,
    type ThemeMode,
} from 'vizmatic'

export const width = 240
export const height = 140

function frame(theme: ThemeMode, x: number) {
    const c = getThemeColors(theme)
    return <Scene c={c}><div style={{ display: 'flex', marginLeft: x }}><StepCard c={c} title="chunk" width={60} /></div></Scene>
}

export function create(theme: ThemeMode = 'dark') {
    return frame(theme, 100)
}

export function createAnimation(theme: ThemeMode) {
    return defineAnimation({
        initial: { x: 0 },
        timeline: [hold(100), tween({ x: 100 }, { duration: 200 })],
        fps: 5,
        render: (state) => frame(theme, state.x),
    })
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
                '--fps',
                '10',
            ], {
                cwd: process.cwd(),
                encoding: 'utf8',
                env: cliChildEnv(),
            })

            expect(result.status, result.stderr || result.stdout).toBe(0)
            const buffer = await readFile(join(renderDir, 'timeline_dark.gif'))
            const delays = gifFrameDelays(buffer)
            expect(delays).toHaveLength(3)
            expect(delays.reduce((total, delay) => total + delay, 0)).toBe(300)
        } finally {
            await rm(outDir, { recursive: true, force: true })
        }
    }, 30_000)
})
