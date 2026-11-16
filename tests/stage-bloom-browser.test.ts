import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

async function step<T>(name: string, run: () => Promise<T>, milliseconds = 15_000): Promise<T> {
    console.info(`[bloom browser] ${name}: start`)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        const result = await Promise.race([run(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error(`[bloom browser] ${name} exceeded ${milliseconds}ms`)
                console.error(error.message)
                reject(error)
            }, milliseconds)
        })])
        console.info(`[bloom browser] ${name}: done`)
        return result
    } finally { clearTimeout(timer) }
}

it.runIf(process.env.VIZMATIC_BROWSER_TESTS === '1')('keeps browser bloom smooth, deterministic, and clear of the untouched background', async () => {
    const bundled = await step('bundle', () => build({
        stdin: { contents: "export * from './src/stage/index'; export { FilmPlayer } from './src/stage/player'", resolveDir: resolve('.') },
        bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    }))
    const browser = await step('launch', () => chromium.launch({ headless: true, timeout: 10_000 }))
    let failed = false
    try {
        const page = await step('new page', () => browser.newPage())
        await page.route('http://bloom.test/**', route => route.request().url().endsWith('/engine.js')
            ? route.fulfill({ contentType: 'text/javascript', body: bundled.outputFiles[0]!.text })
            : route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Bloom parity</title>' }))
        await step('page setup', () => page.goto('http://bloom.test/', { timeout: 10_000 }))
        await step('module import', () => page.evaluate(`(async () => {
            globalThis.testEngine = await import('/engine.js')
        })()`))
        await step('compile', () => page.evaluate(`(async () => {
            const engine = globalThis.testEngine
            globalThis.testFilm = await engine.compileFilm(engine.film({ width: 960, height: 540, bloom: 0.6 }, (s) => {
                s.add(engine.circle(100, { stroke: 'yellow', width: 5 }))
                s.wait(1)
            }))
        })()`))
        const result: { rows: number[][]; corner: number[]; stable: boolean } = await step('paint and readback', () => page.evaluate(`(() => {
            const engine = globalThis.testEngine, film = globalThis.testFilm
            const canvas = document.createElement('canvas')
            canvas.style.width = '960px'
            document.body.append(canvas)
            const player = new engine.FilmPlayer(canvas, film, { pixelRatio: 1 })
            const ctx = canvas.getContext('2d')
            const read = () => ctx.getImageData(0, 0, canvas.width, canvas.height).data
            player.seek(0.5)
            const first = read()
            player.seek(0.5)
            const second = read()
            const rows = Array.from({ length: 9 }, (_, row) => Array.from({ length: 110 }, (_, x) => first[((266 + row) * 960 + 588 + x) * 4]))
            player.destroy()
            return { rows, corner: Array.from(first.slice(0, 4)), stable: first.every((v, i) => v === second[i]) }
        })()`))
        expect(result.corner).toEqual([11, 12, 16, 255])
        expect(result.stable).toBe(true)
        // Adjacent levels mix spatially instead of producing long, uniformly colored contour bands.
        const rises = result.rows.reduce((sum, row) => sum + row.filter((v, i) => i > 0 && v > row[i - 1]!).length, 0)
        expect(rises).toBeGreaterThan(30)
        const mean = result.rows[0]!.map((_, x) => result.rows.reduce((sum, row) => sum + row[x]!, 0) / result.rows.length)
        expect(mean[0]).toBeGreaterThan(mean.at(-1)! + 2)
        expect(Math.max(...mean.slice(31).map((v, i) => Math.abs(v - mean[i + 30]!)))).toBeLessThan(1)
    } catch (error) {
        failed = true
        throw error
    } finally {
        try { await step('close', () => browser.close(), 5_000) }
        catch (error) {
            if (!failed) throw error
            console.error('[bloom browser] cleanup also failed:', error)
        }
    }
}, 30_000)
