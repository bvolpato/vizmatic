import { resolve } from 'node:path'
import { build } from 'esbuild'
import { Resvg } from '@resvg/resvg-js'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { compileFilm, film, frameToSvg, scalarField } from '../src/stage/index'

async function step<T>(name: string, run: () => Promise<T>, milliseconds = 15_000): Promise<T> {
    console.info(`[scalar field browser] ${name}: start`)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        const result = await Promise.race([run(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error(`[scalar field browser] ${name} exceeded ${milliseconds}ms`)
                console.error(error.message)
                reject(error)
            }, milliseconds)
        })])
        console.info(`[scalar field browser] ${name}: done`)
        return result
    } finally { clearTimeout(timer) }
}

it.runIf(process.env.VIZMATIC_BROWSER_TESTS === '1')('paints sampled fields identically in Canvas and SVG across seeks', async () => {
    const options = { x: [-1, 1], y: [-1, 1], domain: [-2, 3], colors: ['#102030', '#10a0b0', '#ffdd44'], width: 32, height: 16, resolution: [32, 16] } as const
    const compiled = await step('Node compile', () => compileFilm(film({ width: 32, height: 16, bloom: 0 }, s => {
        s.add(scalarField((x, y, time) => x + y + time, options)); s.wait(1)
    })))
    const bundled = await step('bundle', () => build({ stdin: { contents: "export * from './src/stage/index'", resolveDir: resolve('.') }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' }))
    const browser = await step('launch', () => chromium.launch({ headless: true, timeout: 10_000 }))
    let failed = false
    try {
        const page = await step('new page', () => browser.newPage())
        await page.route('http://scalar-field.test/**', route => route.request().url().endsWith('/engine.js')
            ? route.fulfill({ contentType: 'text/javascript', body: bundled.outputFiles[0].text })
            : route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Scalar field parity</title>' }))
        await step('page setup', () => page.goto('http://scalar-field.test/', { timeout: 10_000 }))
        await step('module import', () => page.evaluate(`(async () => {
            globalThis.testEngine = await import('/engine.js')
        })()`))
        await step('browser compile', () => page.evaluate(`(async () => {
            const engine = globalThis.testEngine
            globalThis.testFilm = await engine.compileFilm(engine.film({ width: 32, height: 16, bloom: 0 }, s => {
                s.add(engine.scalarField((x,y,t) => x+y+t, ${JSON.stringify(options)})); s.wait(1)
            }))
        })()`))
        const actual: number[][] = await step('paint and readback', () => page.evaluate(`(() => {
            const engine = globalThis.testEngine, compiled = globalThis.testFilm
            const canvas = Object.assign(document.createElement('canvas'), { width: 32, height: 16 })
            const ctx = canvas.getContext('2d')
            return [0, 1, 0.3, 0].map(t => {
                engine.paintFrame(ctx, compiled.frame(t))
                return Array.from(ctx.getImageData(0, 0, 32, 16).data)
            })
        })()`))
        console.info('[scalar field browser] SVG pixel assertions: start')
        for (const [i, time] of [0, 1, 0.3, 0].entries()) {
            const expected = new Resvg(frameToSvg(compiled.frame(time)), { font: { loadSystemFonts: false } }).render().pixels
            expect(actual[i]).toEqual(Array.from(expected))
        }
        console.info('[scalar field browser] SVG pixel assertions: done')
    } catch (error) {
        failed = true
        throw error
    } finally {
        try { await step('close', () => browser.close(), 5_000) }
        catch (error) {
            if (!failed) throw error
            console.error('[scalar field browser] cleanup also failed:', error)
        }
    }
}, 30_000)
