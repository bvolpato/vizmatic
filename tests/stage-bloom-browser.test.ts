import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it.runIf(process.env.VIZMATIC_BROWSER_TESTS === '1')('keeps browser bloom smooth, deterministic, and clear of the untouched background', async () => {
    const bundled = await build({
        stdin: { contents: "export * from './src/stage/index'; export { FilmPlayer } from './src/stage/player'", resolveDir: resolve('.') },
        bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    })
    const browser = await chromium.launch({ headless: true })
    try {
        const page = await browser.newPage()
        const result: { rows: number[][]; corner: number[]; stable: boolean } = await page.evaluate(`(async () => {
            const engine = await import(${JSON.stringify(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.text).toString('base64')}`)})
            const canvas = document.createElement('canvas')
            canvas.style.width = '960px'
            document.body.append(canvas)
            const film = await engine.compileFilm(engine.film({ width: 960, height: 540, bloom: 0.6 }, (s) => {
                s.add(engine.circle(100, { stroke: 'yellow', width: 5 }))
                s.wait(1)
            }))
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
        })()`)
        expect(result.corner).toEqual([11, 12, 16, 255])
        expect(result.stable).toBe(true)
        // Adjacent levels mix spatially instead of producing long, uniformly colored contour bands.
        const rises = result.rows.reduce((sum, row) => sum + row.filter((v, i) => i > 0 && v > row[i - 1]!).length, 0)
        expect(rises).toBeGreaterThan(30)
        const mean = result.rows[0]!.map((_, x) => result.rows.reduce((sum, row) => sum + row[x]!, 0) / result.rows.length)
        expect(mean[0]).toBeGreaterThan(mean.at(-1)! + 2)
        expect(Math.max(...mean.slice(31).map((v, i) => Math.abs(v - mean[i + 30]!)))).toBeLessThan(1)
    } finally {
        await browser.close()
    }
}, 30_000)
