import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

function launchBrowser() {
    return chromium.launch({
        headless: true, timeout: 10_000,
        executablePath: process.env.VIZMATIC_BROWSER_EXECUTABLE_PATH,
        args: process.env.VIZMATIC_BROWSER_GPU === 'hardware'
            ? ['--enable-gpu']
            : ['--enable-gpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    })
}

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
    const browser = await step('launch', launchBrowser)
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

// The probe reads pixels only to compare with the CPU oracle. Production bloom
// runs between those reads, with its own getImageData/readPixels calls counted.
const GPU_PROBE = `(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    const read = CanvasRenderingContext2D.prototype.getImageData;
    const extension = WebGL2RenderingContext.prototype.getExtension;
    const parameter = WebGL2RenderingContext.prototype.getParameter;
    let gl = null, contexts = 0, reads = 0, gpuReads = 0, allocations = 0, liveTextures = 0, errorChecks = 0;
    const getError = WebGL2RenderingContext.prototype.getError;
    WebGL2RenderingContext.prototype.getError = function() { errorChecks++; return getError.call(this); };
    const createTexture = WebGL2RenderingContext.prototype.createTexture;
    const deleteTexture = WebGL2RenderingContext.prototype.deleteTexture;
    WebGL2RenderingContext.prototype.createTexture = function() {
        const texture = createTexture.call(this);
        if (texture) { allocations++; liveTextures++; }
        return texture;
    };
    WebGL2RenderingContext.prototype.deleteTexture = function(texture) {
        if (texture) liveTextures--;
        return deleteTexture.call(this, texture);
    };
    HTMLCanvasElement.prototype.getContext = function(kind, options) {
        if (kind === 'webgl2') {
            contexts++;
            if (globalThis.failure === 'unavailable') return null;
            // Exercise shader parity even on GPU-less CI. The software case
            // separately verifies that production selects the CPU fallback.
            options = { ...options, failIfMajorPerformanceCaveat: false };
        }
        const context = getContext.call(this, kind, options);
        if (kind === 'webgl2') gl = context;
        return context;
    };
    WebGL2RenderingContext.prototype.getExtension = function(name) {
        if (name === 'EXT_color_buffer_float' && globalThis.failure === 'no-float') return null;
        return extension.call(this, name);
    };
    WebGL2RenderingContext.prototype.getParameter = function(name) {
        const debug = extension.call(this, 'WEBGL_debug_renderer_info');
        if (debug && name === debug.UNMASKED_RENDERER_WEBGL) {
            return globalThis.failure === 'software' ? 'ANGLE (Google, SwiftShader driver)' : 'Parity test GPU';
        }
        return parameter.call(this, name);
    };
    CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        reads++;
        return read.apply(this, args);
    };
    WebGL2RenderingContext.prototype.readPixels = function() {
        gpuReads++;
        throw new Error('Production bloom must not read GPU pixels');
    };
    const canvases = Array.from({ length: 24 }, () => document.createElement('canvas'));
    const states = new Array(canvases.length).fill(null);
    globalThis.loseBloomContext = () => extension.call(gl, 'WEBGL_lose_context').loseContext();
    globalThis.bloomProbe = ({ width, height, background = '#0b0c10', amount = 0.6, pattern = 'marks', slot = 0 }) => {
        const { paintCanvasBloom, createBloom, parseColor } = globalThis.testEngine;
        const canvas = canvases[slot];
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const draw = () => {
            ctx.clearRect(0, 0, width, height);
            if (background !== null) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
            if (pattern === 'flat') return;
            if (pattern === 'noise') {
                const image = ctx.createImageData(width, height);
                let seed = 7919;
                for (let i = 0; i < image.data.length; i += 4) {
                    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                    image.data.set([seed & 255, (seed >>> 8) & 255, (seed >>> 16) & 255, 255], i);
                }
                ctx.putImageData(image, 0, 0);
                return;
            }
            // Asymmetric marks exercise row orientation, clamped edges, broad
            // halos, fractional background colors, and partially filled cells.
            ctx.fillStyle = '#f8ad31'; ctx.fillRect(0, 0, width / 13, height / 9);
            ctx.fillStyle = '#6bcaff'; ctx.fillRect(width - 13, height - 9, 13, 9);
            ctx.strokeStyle = '#d4ef83'; ctx.lineWidth = 2.7;
            ctx.beginPath(); ctx.arc(width * .43, height * .38, Math.min(width, height) * .18, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = '#451327'; ctx.fillRect(width * .65, height * .6, width * .11, height * .12);
            if (background === null) {
                for (let i = 0; i < 8; i++) {
                    ctx.fillStyle = 'rgba(93, 181, 237, ' + [0.004, 0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 1][i] + ')';
                    ctx.fillRect(width * .1 + i * width * .1, height * .7, width * .07, height * .2);
                }
            }
        };
        draw();
        const input = read.call(ctx, 0, 0, width, height);
        ctx.putImageData(input, 0, 0);
        const source = read.call(ctx, 0, 0, width, height);
        const expected = new Uint8Array(source.data);
        createBloom()(expected, width, height, amount, parseColor(background ?? '#000000'), true);
        // putImageData, like drawImage, crosses the canvas premultiplied storage
        // boundary. Compare both displayed outputs, including alpha-zero RGB.
        const reference = document.createElement('canvas'); reference.width = width; reference.height = height;
        const referenceCtx = reference.getContext('2d', { willReadFrequently: true });
        referenceCtx.putImageData(new ImageData(new Uint8ClampedArray(expected), width, height), 0, 0);
        const wanted = read.call(referenceCtx, 0, 0, width, height).data;
        const beforeReads = reads, beforeAllocations = allocations;
        states[slot] = paintCanvasBloom(canvas, ctx, amount, background, states[slot]);
        const actual = read.call(ctx, 0, 0, width, height).data;
        const firstReads = reads - beforeReads;
        const warmAllocations = allocations;
        const warmErrorChecks = errorChecks;
        // Reuse the exact bytes. Chrome can change its premultiplication path
        // after the first WebGL drawImage, so check stability after that transfer.
        ctx.putImageData(input, 0, 0);
        const secondSource = read.call(ctx, 0, 0, width, height).data;
        states[slot] = paintCanvasBloom(canvas, ctx, amount, background, states[slot]);
        const again = read.call(ctx, 0, 0, width, height).data;
        ctx.putImageData(input, 0, 0);
        const thirdSource = read.call(ctx, 0, 0, width, height).data;
        states[slot] = paintCanvasBloom(canvas, ctx, amount, background, states[slot]);
        const third = read.call(ctx, 0, 0, width, height).data;
        let max = 0, maxOpaque = 0, maxPremultiplied = 0, alphaChanged = 0, unstable = 0;
        let error = 0, signedError = 0, expectedLight = 0, actualLight = 0, changed = 0, clearChanged = 0;
        for (let i = 0; i < actual.length; i++) {
            if (again[i] !== third[i]) unstable++;
            if (i % 4 === 3) { if (actual[i] !== wanted[i]) alphaChanged++; continue; }
            const alpha = wanted[(i & ~3) + 3], delta = actual[i] - wanted[i];
            max = Math.max(max, Math.abs(delta));
            if (alpha === 255) maxOpaque = Math.max(maxOpaque, Math.abs(delta));
            const premultiplied = Math.round(actual[i] * alpha / 255) - Math.round(wanted[i] * alpha / 255);
            maxPremultiplied = Math.max(maxPremultiplied, Math.abs(premultiplied));
            if (alpha === 0 && actual[i] !== 0) clearChanged++;
            if (delta) changed++;
            error += Math.abs(premultiplied); signedError += premultiplied;
            expectedLight += (wanted[i] - source.data[i]) * alpha / 255;
            actualLight += (actual[i] - source.data[i]) * alpha / 255;
        }
        const debug = gl && extension.call(gl, 'WEBGL_debug_renderer_info');
        return {
            width, height, background, pattern, max, maxOpaque, maxPremultiplied, alphaChanged, unstable, clearChanged,
            meanError: error / (width * height * 3), bias: signedError / (width * height * 3), changed,
            lightRatio: expectedLight ? actualLight / expectedLight : 1,
            reads: firstReads, repeatReads: reads - beforeReads - firstReads, gpuReads, contexts,
            newTextures: warmAllocations - beforeAllocations, repeatTextures: allocations - warmAllocations, liveTextures,
            renderer: debug ? parameter.call(gl, debug.UNMASKED_RENDERER_WEBGL) : null,
            sourceChanges: secondSource.reduce((sum, value, i) => sum + (value !== thirdSource[i]), 0),
            repeatErrorChecks: errorChecks - warmErrorChecks,
        };
    };
})()`

interface Probe {
    width: number
    height: number
    background?: string | null
    amount?: number
    pattern?: 'flat' | 'noise' | 'marks'
    slot?: number
}

interface Parity {
    max: number
    maxOpaque: number
    maxPremultiplied: number
    alphaChanged: number
    unstable: number
    sourceChanges: number
    repeatErrorChecks: number
    clearChanged: number
    meanError: number
    bias: number
    lightRatio: number
    reads: number
    repeatReads: number
    gpuReads: number
    contexts: number
    newTextures: number
    repeatTextures: number
    liveTextures: number
    renderer: string | null
}

it.runIf(process.env.VIZMATIC_BROWSER_TESTS === '1')('matches the CPU kernel on the GPU, shares bounded targets, and falls back on the same frame', async () => {
    const bundled = await step('GPU bundle', () => build({
        stdin: { contents: "export { paintCanvasBloom } from './src/stage/bloom-canvas'; export { createBloom } from './src/stage/bloom-kernel.mjs'; export { parseColor } from './src/stage/color'", resolveDir: resolve('.') },
        bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    }))
    const browser = await step('GPU launch', launchBrowser)
    let failed = false
    try {
        for (const failure of ['none', 'unavailable', 'no-float', 'software']) {
            const page = await step(`${failure}: page`, () => browser.newPage())
            try {
                await page.route('http://bloom.test/**', route => route.request().url().endsWith('/engine.js')
                    ? route.fulfill({ contentType: 'text/javascript', body: bundled.outputFiles[0]!.text })
                    : route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>GPU bloom parity</title>' }))
                await step(`${failure}: setup`, async () => {
                    await page.goto('http://bloom.test/', { timeout: 10_000 })
                    await page.evaluate(`globalThis.failure = ${JSON.stringify(failure)}`)
                    await page.evaluate(GPU_PROBE)
                    await page.evaluate(`(async () => { globalThis.testEngine = await import('/engine.js') })()`)
                })
                const probe = async (input: Probe): Promise<Parity> => {
                    const result: Parity = await step(`${failure}: ${JSON.stringify(input)}`, () => page.evaluate(`globalThis.bloomProbe(${JSON.stringify(input)})`))
                    console.info('[bloom parity]', JSON.stringify(result))
                    expect(result.alphaChanged).toBe(0)
                    expect(result.clearChanged).toBe(0)
                    expect(result.unstable).toBe(0)
                    expect(result.sourceChanges).toBe(0)
                    expect(result.maxOpaque).toBeLessThanOrEqual(1)
                    // Canvas upload/copy rounds premultiplied bytes differently
                    // on NVIDIA and SwiftShader. At alpha 4/255 a single stored
                    // level expands to 64 RGB levels on readback. Bound the actual
                    // displayed error; opaque colors keep the stricter one level.
                    expect(result.maxPremultiplied).toBeLessThanOrEqual(2)
                    expect(result.meanError).toBeLessThan(0.02)
                    expect(Math.abs(result.bias)).toBeLessThan(0.01)
                    if (input.amount !== 0) {
                        expect(result.lightRatio).toBeGreaterThan(0.995)
                        expect(result.lightRatio).toBeLessThan(1.005)
                    }
                    expect(result.gpuReads).toBe(0)
                    expect(result.contexts).toBe(1)
                    expect(result.repeatTextures).toBe(0)
                    expect(result.repeatErrorChecks).toBe(0)
                    expect(result.liveTextures).toBeLessThanOrEqual(14)
                    return result
                }
                if (failure === 'none') {
                    const cases: Probe[] = [
                        { width: 640, height: 360 },
                        { width: 640, height: 360, background: '#183044', pattern: 'flat' },
                        { width: 1283, height: 722, background: '#183044' },
                        { width: 1283, height: 722, background: 'hsl(217, 37%, 9%)' },
                        { width: 1920, height: 1080, amount: 0.14 },
                        { width: 2560, height: 1440, amount: 1.7 },
                        { width: 3840, height: 2160, amount: 0.6 },
                        { width: 640, height: 360, pattern: 'noise', amount: 0.6 },
                        { width: 640, height: 360, background: null, amount: 0 },
                        { width: 640, height: 360, background: null },
                        { width: 97, height: 57, background: null },
                        { width: 1920, height: 8 },
                        { width: 333, height: 1 },
                        { width: 2, height: 2 },
                    ]
                    for (const input of cases) {
                        const result = await probe(input)
                        expect(result.renderer).toMatch(process.env.VIZMATIC_BROWSER_GPU === 'hardware' ? /NVIDIA|AMD|Intel|Apple/i : /SwiftShader/i)
                        expect(result.reads).toBe(0)
                        expect(result.repeatReads).toBe(0)
                        if (input.pattern === 'flat') expect(result.max).toBe(0)
                    }
                    // More players than Chrome's per-page context allowance,
                    // alternating two sizes. Neither contexts nor targets grow.
                    for (let slot = 0; slot < 24; slot++) {
                        const result = await probe({ width: slot % 2 ? 320 : 640, height: slot % 2 ? 180 : 360, slot })
                        expect(result.reads).toBe(0)
                        if (slot >= 2) expect(result.newTextures).toBe(0)
                    }
                    // Force a real loss, then use the same state and source. No
                    // clearing or blank frame is allowed while falling back.
                    await step('lose context', () => page.evaluate('globalThis.loseBloomContext()'))
                    const lost = await probe({ width: 640, height: 360 })
                    expect(lost.reads).toBe(1)
                    expect(lost.repeatReads).toBe(2)
                    expect(lost.max).toBe(0)
                } else {
                    for (const background of ['#183044', null]) {
                        const result = await probe({ width: 640, height: 360, background })
                        expect(result.reads).toBe(1)
                        expect(result.repeatReads).toBe(2)
                        expect(result.max).toBe(0)
                    }
                }
            } finally { await step(`${failure}: close page`, () => page.close(), 5_000) }
        }
    } catch (error) {
        failed = true
        throw error
    } finally {
        try { await step('GPU close', () => browser.close(), 5_000) }
        catch (error) {
            if (!failed) throw error
            console.error('[bloom browser] GPU cleanup also failed:', error)
        }
    }
}, 90_000)
