import { Resvg } from '@resvg/resvg-js'
import { build } from 'esbuild'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import { colorBar, compileFilm, film, frameToSvg, scalarField, type AxisScale } from '../src/stage/index'
import { scaleMapping } from '../src/stage/scales'

const WIDTH = 402, HEIGHT = 80
const fractions = [0.25, 0.5, 0.75]
const cases: { scale: AxisScale; domain: readonly [number, number]; colors: string[] }[] = [
    { scale: 'linear', domain: [0, 1], colors: ['#000000', '#ffffff'] },
    { scale: 'log', domain: [1, 10000], colors: ['#102030', '#10a0b0', '#ffdd44'] },
    { scale: 'symlog', domain: [-100, 100], colors: ['#2255dd', '#eeeeee', '#dd4422'] },
]

function comparePixels(pixels: ArrayLike<number>): void {
    for (const fraction of fractions) {
        const x = 1 + Math.round(400 * fraction)
        const field = (20 * WIDTH + x) * 4, bar = (60 * WIDTH + x) * 4
        for (let channel = 0; channel < 4; channel++) {
            expect(Math.abs(pixels[field + channel] - pixels[bar + channel]), `fraction ${fraction}, channel ${channel}: field ${pixels[field + channel]}, bar ${pixels[bar + channel]}`).toBeLessThanOrEqual(2)
        }
    }
}

describe('rendered numeric color legend', () => {
    it.each(cases)('matches actual scalar field pixels on a $scale scale in SVG', async (options) => {
        const normalization = scaleMapping(options.domain, options.scale)
        const compiled = await compileFilm(film({ width: WIDTH, height: HEIGHT, bloom: 0, background: '#ffffff' }, (s) => {
            // Half-pixel alignment puts all three requested fractions at actual pixel centers.
            s.add(colorBar({ ...options, width: 400, height: 20, ticks: [] }).at(0.5, 20))
            for (const fraction of fractions) s.add(scalarField(() => normalization.invert(fraction), {
                ...options, x: [0, 1], y: [0, 1], width: 20, height: 20, resolution: 2,
            }).at((fraction - 0.5) * 400, -20))
            s.wait(1)
        }))
        comparePixels(new Resvg(frameToSvg(compiled.frame(0)), { font: { loadSystemFonts: false } }).render().pixels)
    })

    it.runIf(process.env.VIZMATIC_BROWSER_TESTS === '1')('matches actual scalar field pixels in Canvas', async () => {
        const bundled = await build({ stdin: { contents: "export * from './src/stage/index'", resolveDir: resolve('.') }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })
        const browser = await chromium.launch({ headless: true })
        try {
            const page = await browser.newPage()
            const scenarios = cases.map((options) => ({ ...options, values: fractions.map((f) => scaleMapping(options.domain, options.scale).invert(f)) }))
            const actual: number[][] = await page.evaluate(`(async () => {
                const e = await import(${JSON.stringify(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)})
                const canvas = Object.assign(document.createElement('canvas'), { width: ${WIDTH}, height: ${HEIGHT} })
                const ctx = canvas.getContext('2d'), frames = []
                for (const options of ${JSON.stringify(scenarios)}) {
                    const compiled = await e.compileFilm(e.film({width: ${WIDTH}, height: ${HEIGHT}, bloom: 0, background: '#ffffff'}, s => {
                        s.add(e.colorBar({...options, width: 400, height: 20, ticks: []}).at(0.5, 20))
                        options.values.forEach((value, i) => s.add(e.scalarField(() => value, {...options, x: [0,1], y: [0,1], width: 20, height: 20, resolution: 2}).at((i-1)*100, -20)))
                        s.wait(1)
                    }))
                    e.paintFrame(ctx, compiled.frame(0))
                    frames.push(Array.from(ctx.getImageData(0, 0, ${WIDTH}, ${HEIGHT}).data))
                }
                return frames
            })()`)
            actual.forEach(comparePixels)
        } finally { await browser.close() }
    }, 30_000)
})
