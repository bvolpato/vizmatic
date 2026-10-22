#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import { chromium } from 'playwright'
import { Resvg } from '@resvg/resvg-js'
import { renderSceneFrame } from '../dist/index.js'
import { getSceneBrowserAssetPaths } from '../dist/scene-browser-assets.js'

const paths = getSceneBrowserAssetPaths()
const files = new Map([
    ['/scene-browser.js', await readFile(new URL('../dist/scene-browser.js', import.meta.url))],
    ...await Promise.all((await readdir(new URL('../dist/scene-browser-chunks/', import.meta.url)))
        .map(async name => [`/scene-browser-chunks/${name}`, await readFile(new URL(`../dist/scene-browser-chunks/${name}`, import.meta.url))])),
    ...await Promise.all(Object.entries(paths).filter(([, path]) => typeof path === 'string' && path.endsWith('.wasm'))
        .map(async ([name, path]) => [`/${name}`, await readFile(path)])),
    ...await Promise.all(Object.entries(paths.fonts).map(async ([name, path]) => [`/${name}`, await readFile(path)])),
    ['/emoji', brotliDecompressSync(await readFile(paths.emojiBrotli))],
])
const assetNames = Object.keys(paths).filter((name) => name.endsWith('Wasm') && name !== 'layoutWasm')
const fontNames = Object.keys(paths.fonts)
const worker = `import {createBrowserSceneRenderer} from '/scene-browser.js';
const load = name => fetch('/'+name).then(r=>r.arrayBuffer());
const fonts = Object.fromEntries(await Promise.all(${JSON.stringify(fontNames)}.map(async name=>[name,await load(name)])));
const assets={...Object.fromEntries(await Promise.all(${JSON.stringify(assetNames)}.map(async name=>[name,await load(name)]))),layoutWasm:()=>load('layoutWasm'),fonts,emoji:()=>fetch('/emoji').then(r=>r.json())};
const renderer=await createBrowserSceneRenderer(assets);
self.onmessage=async({data})=>{try {
 if(data.corruptFont){await createBrowserSceneRenderer({...assets,fonts:{...fonts,interRegular:new ArrayBuffer(4)}});return;}
 if(data.retryLayout){let attempts=0;const retry=await createBrowserSceneRenderer({...assets,layoutWasm:()=>++attempts===1?Promise.reject(Error('Temporary asset failure')):assets.layoutWasm()});const scene=await retry.prepare(data.request);let failure;try{await scene.render(0)}catch(error){failure=error.message}const frame=await scene.render(0);self.postMessage({id:data.id,ok:true,attempts,failure,width:frame.width});return;}
 const scene=await renderer.prepare(data.request,{outputScale:data.outputScale??1});
 const frames=[];
 for(const time of data.times??[0]){const frame=await scene.render(time);const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',frame.pixels))].map(x=>x.toString(16).padStart(2,'0')).join('');frames.push({...frame,pixels:undefined,hash});if(data.transfer)self.postMessage({id:data.id,partial:true,pixels:frame.pixels},[frame.pixels.buffer]);}
 self.postMessage({id:data.id,ok:true,frames});
 }catch(error){self.postMessage({id:data.id,ok:false,error:String(error.message??error)});}};
self.postMessage({ready:true});`
const requests = []
const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    requests.push(pathname)
    const bytes = pathname === '/worker.js' ? Buffer.from(worker) : files.get(pathname)
    if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Scene browser verification</title>')
    } else if (bytes) {
        response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('Wasm') ? 'application/wasm' : 'application/octet-stream')
        response.end(bytes)
    } else { response.statusCode = 404; response.end('Not found') }
})
const directory = await mkdtemp(join(tmpdir(), 'vizmatic-browser-check-'))
let browser
try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(String(error)))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.evaluate(() => new Promise((resolve, reject) => {
        window.sceneWorker = new Worker('/worker.js', { type: 'module' })
        window.sceneWorker.onerror = error => reject(new Error(error.message))
        window.sceneWorker.onmessage = ({data}) => { if (data.ready) resolve(true) }
    }))
    let id = 0
    const render = (request, extra = {}) => page.evaluate(data => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Browser render timed out')), 15_000)
        const handler = ({data: result}) => { if (result.id === data.id && !result.partial) { clearTimeout(timer); window.sceneWorker.removeEventListener('message', handler); resolve(result) } }
        window.sceneWorker.addEventListener('message', handler)
        window.sceneWorker.postMessage(data)
    }), { id: ++id, request, ...extra })
    const source = `const x=lerp(30,220,ease(progress));\n<svg viewBox="0 0 320 180"><defs><linearGradient id="g"><stop stopColor={c.info}/><stop offset="1" stopColor={c.positive}/></linearGradient></defs><circle cx={x} cy={45} r={18} fill="url(#g)"/><text x={10} y={140} fill={c.textPrimary} fontSize={24} fontFamily="Inter">Exact font: λ →</text></svg>`
    const primitive = `<Scene title="Primitive parity" padding={18} gap={8}><Row gap={12}><MetricCard label="Latency" value="18 ms" tone="green"/><Badge label="Ready" color="info"/></Row><svg width={160} height={40}><rect width={160} height={40} fill={c.bgCard}/><text x={5} y={28} fontFamily="Inter" fontSize={18} fill={c.textPrimary}>Nested SVG</text></svg></Scene>`
    const cases = [
        { source, width: 320, height: 180, duration: 2, fps: 25, theme: 'dark' },
        { source, width: 180, height: 320, duration: 2, fps: 25, theme: 'light' },
        { source: primitive, width: 640, height: 360, duration: 2, fps: 25, theme: 'dark' },
        { source: primitive, width: 640, height: 360, duration: 2, fps: 25, theme: 'light' },
        { source: '<div style={{display:"flex",fontSize:40}}>Pinned emoji 😀</div>', width: 320, height: 180, duration: 2, fps: 25, theme: 'dark' },
        { source: '<Scene title="Math parity" padding={12}><MathText text="x² + λ → y"/><EquationCard title="Balance" formula="E = mc²"/></Scene>', width: 640, height: 360, duration: 2, fps: 25, theme: 'dark' },
    ]
    const results = []
    for (const [index, request] of cases.entries()) {
        const time = 0.7, outputScale = index === 1 ? 0.5 : 1
        const result = await render(request, { times: [time, time], outputScale })
        assert.equal(result.ok, true, JSON.stringify(result))
        assert.equal(result.frames[0].hash, result.frames[1].hash, 'Repeated frame is deterministic')
        const outputPath = join(directory, `${index}.png`)
        await renderSceneFrame({ ...request, time, outputScale, outputPath })
        const png = await readFile(outputPath)
        const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
        const rasterizer = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/></svg>`)
        const expected = createHash('sha256').update(rasterizer.render().pixels).digest('hex')
        assert.equal(result.frames[0].hash, expected, `Browser RGBA must exactly match Node PNG pixels for case ${index}`)
        if (index < 2) {
            assert.equal(requests.includes('/layoutWasm'), false, 'SVG does not fetch layout WASM')
            assert.equal(requests.some(path => path.includes('/scene-browser-chunks/scene-browser-layout-')), false, 'SVG does not fetch the Satori layout chunk')
        }
        results.push({ index, time, hash: expected, timings: result.frames.map(frame => frame.timings) })
    }
    const corrupted = await render(cases[0], { corruptFont: true })
    assert.equal(corrupted.ok, false)
    assert.match(corrupted.error, /Pinned browser scene font does not match/)
    const transferred = await render(cases[2], { times: [0, 0, 1], transfer: true })
    assert.equal(transferred.ok, true, JSON.stringify(transferred))
    assert.equal(new Set(transferred.frames.map(frame => frame.hash)).size, 1, 'Transfer does not detach the retained unchanged-graph raster')
    const animated = await render(cases[0], { times: [0, 1, 0], transfer: true })
    assert.equal(animated.ok, true, JSON.stringify(animated))
    assert.equal(animated.frames[0].hash, animated.frames[2].hash, 'Revisited frames are independent of evaluation order')
    assert.notEqual(animated.frames[0].hash, animated.frames[1].hash, 'A changed graph invalidates its retained raster')
    const recoveredLayout = await render(cases[2], { retryLayout: true })
    assert.deepEqual(recoveredLayout, { id, ok: true, attempts: 2, failure: 'Temporary asset failure', width: 640 })
    const forbidden = [
        'while(true){}\n<svg/>',
        '<svg><use href="https://example.com/secret"/></svg>',
        '<div onClick="no"/>',
        'const probe=[typeof fetch,typeof self,typeof document,typeof process];\n<div>{probe.some(x=>x!=="undefined")?(()=>{throw Error("Host globals exposed")})():"Isolated"}</div>',
    ]
    for (const [index, source] of forbidden.entries()) {
        const result = await render({ ...cases[0], source })
        assert.equal(result.ok, index === forbidden.length - 1, JSON.stringify(result))
    }
    const beforeAnimation = requests.length
    const benchmark = await render({ ...cases[0], width: 1920, height: 1080 }, { outputScale: 0.5, times: Array.from({length: 61}, (_, index) => index / 30) })
    assert.equal(benchmark.ok, true, JSON.stringify(benchmark))
    assert.equal(requests.length, beforeAnimation, 'Playback does not issue network requests')
    const times = benchmark.frames.slice(1).map(frame => frame.timings.totalMs).sort((a,b) => a-b)
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log(JSON.stringify({ parity: results, browserErrors: errors, warmFrameMs: { median: times[30], p95: times[57], max: times.at(-1) }, playbackFrames: times.length, playbackNetworkRequests: requests.length - beforeAnimation }, null, 2))
} finally {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
}
