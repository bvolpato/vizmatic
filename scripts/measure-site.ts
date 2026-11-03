/**
 * Measure the numbers the landing page quotes, on this machine, and write them
 * to docs/assets/site/measurements.json. Run it by hand after engine changes:
 *
 *   npx tsx scripts/measure-site.ts
 *
 * The site must be built first. The docs server must run on the given port.
 */
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { compileFilm } from '../src/stage/index'
import { renderFilmVideo } from '../src/stage/export'
import scrub from './site-films/scrub'

const port = process.argv[2] ?? '4819'
const compiled = await compileFilm(scrub)
const out = join(tmpdir(), `vizmatic-measure-${process.pid}.mp4`)
const started = performance.now()
const result = await renderFilmVideo(compiled, out, { quality: 'standard', onProgress: () => undefined })
const seconds = (performance.now() - started) / 1000
await rm(out, { force: true })

// The older path re-lays out a TSX frame for each video frame. Measure it in the same run, so
// the page compares two numbers taken under the same load. This needs a built dist.
const legacyOut = join(tmpdir(), `vizmatic-measure-legacy-${process.pid}`)
const legacyStarted = performance.now()
const legacy = spawnSync(process.execPath, ['dist/cli.js', 'video', 'examples/videos/calculus-tangent.tsx', '--out', legacyOut, '--theme', 'dark', '--fps', '30'], { encoding: 'utf8' })
const legacySeconds = (performance.now() - legacyStarted) / 1000
if (legacy.status !== 0) throw new Error(`The older video path failed: ${legacy.stderr}`)
const legacyManifest = JSON.parse(await readFile(join(legacyOut, 'video-manifest.json'), 'utf8')) as { outputDetails?: { frameCount?: number }[] }
const legacyFrames = legacyManifest.outputDetails?.[0]?.frameCount ?? 234
await rm(legacyOut, { recursive: true, force: true })

const browser = await chromium.launch({ headless: true })
let seekMs = 0
try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage()
    await page.route('**/__measure.html', (route) => route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><script type="module" src="/assets/stage/stage.js"></script><vz-film id="f" src="/assets/stage/site/scrub.js" nocontrols label="measure" style="width:1080px"></vz-film>',
    }))
    await page.goto(`http://127.0.0.1:${port}/__measure.html`)
    await page.waitForFunction(() => (document.getElementById('f') as unknown as { controller?: unknown }).controller, null, { timeout: 60_000 })
    seekMs = await page.evaluate(() => {
        const player = (document.getElementById('f') as unknown as { controller: { seek(t: number): void; film: { duration: number } } }).controller
        const count = 240
        const passes: number[] = []
        // Seek back and forth across the film, as a scrolling reader does. The fastest pass
        // removes most of the noise from other work on the machine.
        for (let pass = 0; pass < 5; pass++) {
            const begin = performance.now()
            for (let i = 0; i < count; i++) player.seek(player.film.duration * (i % 2 === 0 ? i / count : 1 - i / count))
            passes.push((performance.now() - begin) / count)
        }
        return Math.min(...passes)
    })
} finally {
    await browser.close()
}

const machine = `${cpus()[0]?.model ?? 'unknown CPU'}, ${cpus().length} logical CPUs`
const measurements = {
    measuredAt: new Date().toISOString().slice(0, 10),
    export: {
        fps: Math.round((result.frameCount / seconds) * 10) / 10,
        frames: result.frameCount,
        width: result.width,
        height: result.height,
        filmFps: result.fps,
        threads: result.workers,
        machine,
    },
    legacyVideo: { fps: Math.round((legacyFrames / legacySeconds) * 10) / 10, frames: legacyFrames, height: 720, machine },
    seek: { ms: Math.round(seekMs * 100) / 100, film: 'scrub', canvasWidth: 2160, machine },
}
await mkdir('docs/assets/site', { recursive: true })
await writeFile('docs/assets/site/measurements.json', `${JSON.stringify(measurements, null, 2)}\n`)
console.log(JSON.stringify(measurements, null, 2))
