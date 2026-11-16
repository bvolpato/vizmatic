import { resolve } from 'node:path'
import { build } from 'esbuild'
import { Resvg } from '@resvg/resvg-js'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { compileFilm, film, frameToSvg, scalarField } from '../src/stage/index'

it.runIf(process.env.VIZMATIC_BROWSER_TESTS === '1')('paints sampled fields identically in Canvas and SVG across seeks', async () => {
    const options = { x: [-1, 1], y: [-1, 1], domain: [-2, 3], colors: ['#102030', '#10a0b0', '#ffdd44'], width: 32, height: 16, resolution: [32, 16] } as const
    const compiled = await compileFilm(film({ width: 32, height: 16, bloom: 0 }, s => {
        s.add(scalarField((x, y, time) => x + y + time, options)); s.wait(1)
    }))
    const bundled = await build({ stdin: { contents: "export * from './src/stage/index'", resolveDir: resolve('.') }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })
    const browser = await chromium.launch({ headless: true })
    try {
        const page = await browser.newPage()
        const actual: number[][] = await page.evaluate(`(async () => {
            const engine = await import(${JSON.stringify(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)})
            const canvas = Object.assign(document.createElement('canvas'), { width: 32, height: 16 })
            const ctx = canvas.getContext('2d')
            const compiled = await engine.compileFilm(engine.film({ width: 32, height: 16, bloom: 0 }, s => {
                s.add(engine.scalarField((x,y,t) => x+y+t, ${JSON.stringify(options)})); s.wait(1)
            }))
            return [0, 1, 0.3, 0].map(t => {
                engine.paintFrame(ctx, compiled.frame(t))
                return Array.from(ctx.getImageData(0, 0, 32, 16).data)
            })
        })()`)
        for (const [i, time] of [0, 1, 0.3, 0].entries()) {
            const expected = new Resvg(frameToSvg(compiled.frame(time))).render().pixels
            expect(actual[i]).toEqual(Array.from(expected))
        }
    } finally { await browser.close() }
}, 30_000)
