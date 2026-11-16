import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it.runIf(process.env.VIZMATIC_BROWSER_TESTS === '1')('paints Fourier identically on first, repeated, and reverse poster seeks', async () => {
    const bundled = await build({
        entryPoints: { stage: 'src/stage/browser.ts', fourier: 'examples/films/fourier-epicycles.ts' },
        outdir: '/virtual-fourier', bundle: true, write: false, splitting: true,
        format: 'esm', platform: 'browser', target: 'es2022',
        alias: { 'vizmatic/stage': './src/stage/browser.ts' },
        define: { __VIZMATIC_ASSET_PATH__: JSON.stringify('/assets/') },
    })
    const files = new Map(bundled.outputFiles.map(file => [file.path.replace('/virtual-fourier', ''), file.contents]))
    const browser = await chromium.launch({ headless: true })
    try {
        const page = await browser.newPage()
        await page.route('http://fourier.test/**', async route => {
            const path = new URL(route.request().url()).pathname
            if (path.startsWith('/assets/fonts/')) {
                await route.fulfill({ contentType: 'font/ttf', body: await readFile(resolve(`.${path}`)) })
            } else if (files.has(path)) {
                await route.fulfill({ contentType: 'text/javascript', body: Buffer.from(files.get(path)!) })
            } else await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Fourier seeks</title>' })
        })
        await page.goto('http://fourier.test/')
        const results = await page.evaluate(`(async () => {
            const engine = await import('/stage.js')
            const definition = (await import('/fourier.js')).default
            const results = []
            for (const look of ['midnight', 'paper']) {
                const film = await engine.compileFilm(definition, { look })
                const canvas = document.createElement('canvas')
                canvas.style.width = '1360px'
                document.body.append(canvas)
                const player = new engine.FilmPlayer(canvas, film, { pixelRatio: 1 })
                const frame = () => JSON.stringify(film.frame(30.5), (key, value) => key === 'node' ? undefined : value)
                const before = frame()
                player.seek(30.5)
                const first = canvas.toDataURL()
                player.seek(30.5)
                const repeated = first === canvas.toDataURL()
                player.seek(0)
                player.seek(30.5)
                results.push({ look, frame: before === frame(), repeated, reverse: first === canvas.toDataURL() })
                player.destroy()
                canvas.remove()
            }
            return results
        })()`)
        expect(results).toEqual(['midnight', 'paper'].map(look => ({ look, frame: true, repeated: true, reverse: true })))
    } finally {
        await browser.close()
    }
}, 30_000)
