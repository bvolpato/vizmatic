import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { cpus, loadavg, tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const { values } = parseArgs({ options: {
    film: { type: 'string' }, from: { type: 'string', default: '0' },
    frames: { type: 'string', default: '90' }, width: { type: 'string', default: '1280' },
    dpr: { type: 'string', default: '1,2' }, look: { type: 'string' },
    channel: { type: 'string' }, out: { type: 'string' }, profile: { type: 'boolean' },
} })
const root = fileURLToPath(new URL('../', import.meta.url))
const out = resolve(values.out ?? join(tmpdir(), `vizmatic-browser-${Date.now()}`))
const frames = Number(values.frames), width = Number(values.width), from = Number(values.from)
const ratios = values.dpr.split(',').map(Number)
if (!Number.isInteger(frames) || frames < 2 || !Number.isInteger(width) || width < 1 || !Number.isFinite(from) || from < 0 || ratios.some(n => !Number.isFinite(n) || n <= 0)) {
    throw new Error('Use positive --width and --dpr, at least 2 --frames, and a nonnegative --from.')
}
const cases = values.film ? [{ file: resolve(values.film), from }] : [
    ['planetary-orbits', 6], ['planetary-orbits', 30], ['lorenz', 37],
    ['gradient-descent', 28], ['fourier-epicycles', 30], ['euler-circle', 8],
].map(([id, from]) => ({ file: join(root, `examples/films/${id}.ts`), from }))
const files = [...new Set(cases.map(c => c.file))]
const bundled = values.profile ? join(out, 'bundle') : await mkdtemp(join(tmpdir(), 'vizmatic-browser-bundle-'))
let browser, server
try {
    await mkdir(out, { recursive: true })
    await build({ stdin: { contents: "export * from './src/stage/browser'; export {paintCanvasBloom} from './src/stage/bloom-canvas'; export {supportsWebGLBloom} from './src/stage/bloom-webgl'", resolveDir: root },
        bundle: true, minify: !values.profile, format: 'esm', platform: 'browser', target: 'es2022', outfile: join(bundled, 'engine.js'), sourcemap: !!values.profile })
    for (const [i, file] of files.entries()) await build({ entryPoints: [file], bundle: true, minify: !values.profile,
        format: 'esm', platform: 'browser', target: 'es2022', outfile: join(bundled, `${i}.js`), sourcemap: !!values.profile,
        plugins: [{ name: 'shared-stage', setup(b) {
            b.onResolve({ filter: /^vizmatic\/stage$/ }, () => ({ path: './engine.js', external: true }))
        } }],
    })
    server = createServer(async (req, res) => {
        try {
            const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
            if (path === '/') {
                res.setHeader('Content-Type', 'text/html')
                res.end('<!doctype html><title>Vizmatic browser benchmark</title><canvas></canvas>')
                return
            }
            const base = path.startsWith('/assets/') ? root : bundled
            const file = resolve(base, '.' + path)
            if (!file.startsWith(base.endsWith(sep) ? base : base + sep)) throw new Error('Invalid path')
            const body = await readFile(file)
            res.setHeader('Content-Type', extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream')
            res.end(body)
        } catch { res.writeHead(404); res.end() }
    })
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept) })
    browser = await chromium.launch({ headless: true, channel: values.channel, args: ['--enable-gpu'], timeout: 15_000 })
    const browserCdp = await browser.newBrowserCDPSession()
    const { gpu } = await browserCdp.send('SystemInfo.getInfo')
    const metadata = { measuredAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
        chrome: browser.version(), cpu: cpus()[0]?.model, load: loadavg(), gpu: gpu.devices, featureStatus: gpu.featureStatus,
        options: { ...values, frames, width, ratios },
    }
    await writeFile(join(out, 'environment.json'), JSON.stringify(metadata, null, 2) + '\n')
    console.log(`${metadata.chrome}; ${metadata.cpu}; canvas=${gpu.featureStatus['2d_canvas']}; WebGL=${gpu.featureStatus.webgl}`)
    const page = await browser.newPage({ viewport: { width: Math.max(1280, width), height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`, { timeout: 15_000 })
    await page.evaluate(async () => {
        globalThis.engine = await import('/engine.js')
        engine.setAssetBase(new URL('/assets/', location.href).href)
        globalThis.films = new Map()
    })
    const cdp = await page.context().newCDPSession(page)
    if (values.profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }) }
    const results = []
    for (const [index, scenario] of cases.entries()) for (const ratio of ratios) {
        const compileMs = await page.evaluate(async ({ id, look }) => {
            const started = performance.now()
            if (!films.has(id)) films.set(id, await engine.compileFilm((await import(`/${id}.js`)).default, look ? { look } : {}))
            return performance.now() - started
        }, { id: files.indexOf(scenario.file), look: values.look })
        if (values.profile) await cdp.send('Profiler.start')
        const metrics = await page.evaluate(async ({ id, from, width, ratio, count }) => {
            const film = films.get(id), canvas = document.querySelector('canvas')
            canvas.width = Math.round(width * ratio)
            canvas.height = Math.round(canvas.width * film.height / film.width)
            canvas.style.width = width + 'px'
            canvas.style.height = width * film.height / film.width + 'px'
            const ctx = canvas.getContext('2d', { alpha: film.background === null, willReadFrequently: !engine.supportsWebGLBloom(canvas) })
            const rows = [], scale = canvas.width / film.width
            let bloom = null, previous, firstPaintMs = 0, readMs = 0, writeMs = 0
            const get = ctx.getImageData, put = ctx.putImageData
            ctx.getImageData = function (...args) { const t = performance.now(); const result = get.apply(this, args); readMs += performance.now() - t; return result }
            ctx.putImageData = function (...args) { const t = performance.now(); const result = put.apply(this, args); writeMs += performance.now() - t; return result }
            try {
                for (let i = 0; i < count + 10; i++) {
                    await new Promise(requestAnimationFrame)
                    readMs = writeMs = 0
                    const start = performance.now()
                    const frame = film.frame(Math.min(film.duration, from + i / film.fps))
                    const built = performance.now()
                    engine.paintFrame(ctx, frame, scale)
                    const painted = performance.now()
                    if (frame.bloom && frame.dark) bloom = engine.paintCanvasBloom(canvas, ctx, frame.bloom, frame.background, bloom)
                    const finished = performance.now()
                    if (i === 0) firstPaintMs = finished - start
                    if (i >= 10) rows.push({ build: built - start, paint: painted - built, bloom: finished - painted,
                        readback: readMs, upload: writeMs, total: finished - start, interval: start - previous, ops: frame.ops.length })
                    previous = start
                }
            } finally { ctx.getImageData = get; ctx.putImageData = put }
            const stats = key => {
                const sorted = rows.map(row => row[key]).sort((a, b) => a - b)
                return { mean: sorted.reduce((a, b) => a + b) / sorted.length, p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)] }
            }
            return { pixels: [canvas.width, canvas.height], ops: rows[0].ops, firstPaintMs,
                ...Object.fromEntries(['build', 'paint', 'bloom', 'readback', 'upload', 'total', 'interval'].map(key => [key, stats(key)])) }
        }, { id: files.indexOf(scenario.file), from: scenario.from, width, ratio, count: frames })
        if (values.profile) {
            const { profile } = await cdp.send('Profiler.stop')
            await writeFile(join(out, `${index}-dpr${ratio}.cpuprofile`), JSON.stringify(profile))
        }
        const result = { ...scenario, ratio, compileMs, ...metrics }
        results.push(result)
        console.log(`${scenario.file.split('/').at(-1)} @${scenario.from}s DPR${ratio}: JS ${metrics.total.p50.toFixed(1)}ms p50 / ${metrics.total.p95.toFixed(1)}ms p95; rAF ${metrics.interval.p50.toFixed(1)}ms; build ${metrics.build.p50.toFixed(1)}, paint ${metrics.paint.p50.toFixed(1)}, bloom ${metrics.bloom.p50.toFixed(1)}, readback ${metrics.readback.p50.toFixed(1)}ms`)
        await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n')
    }
    if (errors.length) throw new Error(errors.join('\n'))
    console.log(`Saved ${out}. Paint and bloom timings include command submission, not completion of asynchronous GPU work. Compare rAF intervals too.`)
} finally {
    try { await browser?.close() } finally {
        if (server?.listening) await new Promise(accept => server.close(accept))
        if (!values.profile) await rm(bundled, { recursive: true, force: true })
    }
}
