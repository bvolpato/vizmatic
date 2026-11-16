import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { compileFilm, film, tex } from '../src/stage/index'

it.runIf(process.env.VIZMATIC_BROWSER_TESTS === '1')('renders chemistry and fallback text identically after cold browser loads and cache hits', async () => {
    const sources = [String.raw`\text{H₂O}`, String.raw`\ce{2 H2 + O2 -> 2 H2O}`]
    const bundled = await build({
        entryPoints: { stage: 'src/stage/browser.ts' }, outdir: '/virtual-equation',
        bundle: true, write: false, splitting: true, format: 'esm', platform: 'browser', target: 'es2022',
        define: { __VIZMATIC_ASSET_PATH__: JSON.stringify('/assets/') },
    })
    const files = new Map(bundled.outputFiles.map((file) => [file.path.replace('/virtual-equation', ''), file.contents]))
    const browser = await chromium.launch({ headless: true })
    try {
        const page = await browser.newPage()
        await page.route('http://equation.test/**', async (route) => {
            const path = new URL(route.request().url()).pathname
            if (path.startsWith('/assets/fonts/')) {
                await route.fulfill({ contentType: 'font/ttf', body: await readFile(resolve(`.${path}`)) })
            } else if (files.has(path)) {
                await route.fulfill({ contentType: 'text/javascript', body: Buffer.from(files.get(path)!) })
            } else await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Equations</title>' })
        })
        await page.goto('http://equation.test/')
        const svgs: string[] = await page.evaluate(`(async () => {
            const sources = ${JSON.stringify(sources)}
            const engine = await import('/stage.js')
            const result = []
            for (let repeat = 0; repeat < 2; repeat++) {
                for (const source of sources) {
                    const compiled = await engine.compileFilm(engine.film((s) => {
                        const equation = s.add(engine.tex(source))
                        if (!equation.part(source).length) throw new Error('No target in browser equation')
                        s.wait(1)
                    }))
                    result.push(compiled.svg(0))
                }
            }
            return result
        })()`)
        const expected: string[] = []
        for (const source of sources) {
            const compiled = await compileFilm(film((s) => { s.add(tex(source)); s.wait(1) }))
            expected.push(compiled.svg(0))
        }
        expect(svgs).toEqual([...expected, ...expected])
    } finally {
        await browser.close()
    }
}, 30_000)
