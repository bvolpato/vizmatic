import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeFilmCacheKey, saveCachedFilm, tryRestoreCachedFilm } from '../scripts/render-films'
import { parseNarratedArgs, planNarrated } from '../src/narrated-cli'
import { disableUserCodeCapabilities } from '../src/playground-sandbox'
import { isValidSceneStyleProperty, validateResolvedSceneResources, validateSceneGraph } from '../src/scene-graph'
import { renderSceneFrame } from '../src/scene-renderer'
import { filePathToUrl, loadBinaryAsset } from '../src/stage/assets'
import { paintCanvasBloom, type BloomLayer } from '../src/stage/bloom-canvas'
import { compileFilm, film, frameToSvg, fromSvg, image, LOOKS, paintFrame, parseColor, rect, type ImageOp, type PathOp } from '../src/stage/index'
import { FilmPlayer } from '../src/stage/player'
import { sanitizePreviewLogText, startPreview } from '../src/stage/preview/server'
import { RasterPool } from '../src/stage/raster'
import { renderNarrationHold } from 'vizmatic/stage/export'
import { loadRuntime } from '../src/studio/sandbox-host'

const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
}

afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop()!
        await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
})

describe('Section 2 bugfixes', () => {
    it('accepts --text-gap in vizmatic narrated check and forwards it to vizmatic check', () => {
        const request = parseNarratedArgs(['check', 'examples/lessons/attention', '--motion', '--text-gap', '0.3'])
        expect(request.options.get('--text-gap')).toBe('0.3')
        expect(request.options.get('--motion')).toBe(true)

        const steps = planNarrated(
            request,
            {
                entry: 'film.ts',
                look: 'midnight',
                output: 'attention',
                check: [],
                render: { workers: 4, draftWorkers: 2 },
                before: [],
                voice: { current: true, why: 'current' },
                mix: { current: true, why: 'current' },
                scenes: [],
                gap: 0.4,
                length: 10,
            },
            ['node', 'dist/cli.js'],
        )
        expect(steps).toHaveLength(1)
        expect(steps[0]!.words).toEqual(['vizmatic', 'check', 'film.ts', '--look', 'midnight', '--motion', '--text-gap', '0.3'])
    })

    it('exports renderNarrationHold from vizmatic/stage/export', () => {
        expect(typeof renderNarrationHold).toBe('function')
    })

    it('isolates look color tokens across concurrent async compileFilm and interleaved frame(t) updaters', async () => {
        const paperDef = film({ look: 'paper' }, (s) => {
            const swatch = s.add(rect(40, 40, { fill: 'ink', stroke: null }))
            s.update(swatch, (node) => {
                node.set('fill', parseColor('ink'))
            })
            s.wait(1)
        })
        const midnightDef = film({ look: 'midnight' }, (s) => {
            const swatch = s.add(rect(40, 40, { fill: 'ink', stroke: null }))
            s.update(swatch, (node) => {
                node.set('fill', parseColor('ink'))
            })
            s.wait(1)
        })

        const [paperFilm, midnightFilm] = await Promise.all([
            compileFilm(paperDef),
            compileFilm(midnightDef),
        ])

        const paperInk = LOOKS.paper.colors.ink
        const midnightInk = LOOKS.midnight.colors.ink
        expect(paperInk).not.toBe(midnightInk)

        for (const t of [0, 0.5, 1]) {
            const paperFrame = paperFilm.frame(t)
            const midnightFrame = midnightFilm.frame(t)
            const paperPath = paperFrame.ops.find((op): op is PathOp => op.kind === 'path')
            const midnightPath = midnightFrame.ops.find((op): op is PathOp => op.kind === 'path')
            expect(paperPath?.fill).toEqual(parseColor(paperInk))
            expect(midnightPath?.fill).toEqual(parseColor(midnightInk))
        }
    })

    it('rejects pending and queued RasterPool jobs when a worker exits unexpectedly', async () => {
        const pool = new RasterPool(1)
        try {
            const workers = (pool as unknown as { workers: Array<{ terminate: () => Promise<number> }> }).workers
            const slowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">${'<rect width="1920" height="1080" fill="#ffffff"/>'.repeat(80)}</svg>`
            const first = pool.run({ svgs: [slowSvg], width: 1920, height: 1080, bloom: 1, background: [0, 0, 0] })
            const second = pool.run({ svgs: [slowSvg], width: 1920, height: 1080, bloom: 1, background: [0, 0, 0] })

            await workers[0]!.terminate()

            await expect(first).rejects.toThrow(/Raster worker exited unexpectedly|terminated/i)
            await expect(second).rejects.toThrow(/Raster worker exited unexpectedly|terminated/i)
            await expect(pool.run({ svgs: [slowSvg], width: 64, height: 64, bloom: 0, background: [0, 0, 0] })).rejects.toThrow(/Raster worker exited unexpectedly/i)
        } finally {
            await pool.close()
        }
    })

    it('preserves RGB values during bloom on tiny (< 16px) frames', async () => {
        const pool = new RasterPool(1)
        try {
            const tinySvg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><rect width="12" height="12" fill="#ffffff"/></svg>'
            const rgba = await pool.run({ svgs: [tinySvg], width: 12, height: 12, bloom: 1, background: [11, 12, 16] })
            let brightPixels = 0
            for (let i = 0; i < rgba.length; i += 4) {
                if (rgba[i]! > 200 && rgba[i + 1]! > 200 && rgba[i + 2]! > 200) brightPixels++
            }
            expect(brightPixels).toBe(12 * 12)
        } finally {
            await pool.close()
        }
    })

    it('encodes # and % safely in filePathToUrl and reads bundled fonts in Node even with DOM globals present', async () => {
        const trickyPath = '/tmp/dir#1%20name/dist/stage.cjs'
        const encoded = filePathToUrl(trickyPath)
        expect(encoded).toContain('%231%2520name')
        expect(fileURLToPath(encoded)).toBe(trickyPath)

        const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
        const prevDocument = (globalThis as Record<string, unknown>).document
        ;(globalThis as Record<string, unknown>).document = {}
        try {
            const fontBytes = await loadBinaryAsset('fonts/Inter-Regular.ttf')
            expect(fontBytes.byteLength).toBeGreaterThan(10_000)
        } finally {
            if (hadDocument) (globalThis as Record<string, unknown>).document = prevDocument
            else delete (globalThis as Record<string, unknown>).document
        }
    })

    it('evicts rejected runtime promises in loadRuntime so subsequent retries succeed', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 503 })
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'window.__studioRuntimeLoaded = true;' })
        vi.stubGlobal('fetch', fetchMock)

        await expect(loadRuntime('https://studio-retry-test.invalid/assets/')).rejects.toThrow(/HTTP 503/)
        await expect(loadRuntime('https://studio-retry-test.invalid/assets/')).resolves.toBe('window.__studioRuntimeLoaded = true;')
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('recognizes plain isSuspend errors in FilmPlayer without crashing playback', async () => {
        let resolved = false
        let resolveSuspend!: () => void
        const wait = new Promise<void>((resolve) => {
            resolveSuspend = () => {
                resolved = true
                resolve()
            }
        })
        const fakeFilm = {
            width: 320,
            height: 180,
            duration: 1,
            fps: 30,
            background: '#000000',
            frame: () => {
                if (!resolved) throw { isVizmaticSuspend: true, promise: wait }
                return { width: 320, height: 180, background: '#000000', bloom: 0, dark: true, ops: [] }
            },
        }
        const ctxStub = {
            setTransform: vi.fn(),
            clearRect: vi.fn(),
            fillRect: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            fillStyle: '#000000',
            globalAlpha: 1,
            globalCompositeOperation: 'source-over',
        }
        const canvasStub = {
            width: 320,
            height: 180,
            clientWidth: 320,
            clientHeight: 180,
            getBoundingClientRect: () => ({ width: 320, height: 180 }),
            getContext: () => ctxStub,
        }
        vi.stubGlobal('window', { devicePixelRatio: 1 })
        const player = new FilmPlayer(canvasStub as unknown as HTMLCanvasElement, fakeFilm as never)
        try {
            expect(() => player.seek(0)).not.toThrow()
            expect(ctxStub.fillRect).not.toHaveBeenCalled()
            resolveSuspend()
            await wait
            await Promise.resolve()
            expect(ctxStub.fillRect).toHaveBeenCalled()
        } finally {
            player.destroy()
        }
    })

    it('prevents dark marks on non-black dark backgrounds from glowing positive in paintCanvasBloom', () => {
        const operations: Array<{ target: string; composite: string; style?: string }> = []
        const makeCanvas = (label: string) => {
            const ctx = {
                globalCompositeOperation: 'source-over',
                globalAlpha: 1,
                filter: 'none',
                fillStyle: '#000000',
                setTransform: vi.fn(),
                clearRect: vi.fn(),
                drawImage: vi.fn(() => {
                    operations.push({ target: label, composite: ctx.globalCompositeOperation })
                }),
                fillRect: vi.fn(() => {
                    operations.push({ target: label, composite: ctx.globalCompositeOperation, style: String(ctx.fillStyle) })
                }),
            }
            return {
                width: 320,
                height: 180,
                getContext: () => ctx,
            }
        }
        let layerSeq = 0
        vi.stubGlobal('document', {
            createElement: () => makeCanvas(`layer-${layerSeq++}`),
        })
        const mainCanvas = makeCanvas('main')
        const mainCtx = mainCanvas.getContext()
        const layers: BloomLayer[] = []
        paintCanvasBloom(mainCanvas as unknown as HTMLCanvasElement, mainCtx as unknown as CanvasRenderingContext2D, 1, '#0b1526', layers)

        const layer0Ops = operations.filter((op) => op.target === 'layer-0')
        expect(layer0Ops.map((op) => op.composite)).toEqual(['source-over', 'lighten', 'difference'])
        expect(layer0Ops[1]?.style).toBe('#0b1526')
        expect(layer0Ops[2]?.style).toBe('#0b1526')
    })

    it('propagates Node.blend onto ImageOp, frameToSvg, and paintFrame', async () => {
        const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
        const compiled = await compileFilm(film({}, (s) => {
            s.add(image(tinyPng, { width: 100, height: 100 }).set('blend', 'screen'))
            s.wait(0.5)
        }))
        const frame = compiled.frame(0)
        const imgOp = frame.ops.find((op): op is ImageOp => op.kind === 'image')
        expect(imgOp?.blend).toBe('screen')

        const svg = frameToSvg(frame)
        expect(svg).toContain('mix-blend-mode:screen')

        let observedComposite = 'source-over'
        const ctxStub = {
            globalAlpha: 1,
            globalCompositeOperation: 'source-over',
            fillStyle: '#000',
            setTransform: vi.fn(),
            fillRect: vi.fn(),
            clearRect: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
            transform: vi.fn(),
            beginPath: vi.fn(),
            rect: vi.fn(),
            clip: vi.fn(),
            drawImage: vi.fn(() => {
                observedComposite = ctxStub.globalCompositeOperation
            }),
        }
        paintFrame(ctxStub as unknown as CanvasRenderingContext2D, frame, 1, (img) => (img.src === tinyPng ? ({} as CanvasImageSource) : null))
        expect(observedComposite).toBe('screen')
    })
})

describe('Section 3 security & sandbox hardening', () => {
    it('blocks CSS injection via style keys, declaration delimiters, marker*, and hyphenated CSS resource props', async () => {
        expect(isValidSceneStyleProperty('backgroundColor')).toBe(true)
        expect(isValidSceneStyleProperty('--accent-color')).toBe(true)
        expect(isValidSceneStyleProperty('fill:url(https://evil.example/x);x')).toBe(false)

        expect(() => validateSceneGraph({
            kind: 'vizmatic.element',
            type: 'div',
            props: { style: { 'fill:url(https://evil.example/x);x': '1' } },
        })).toThrow(/style property/i)

        expect(() => validateSceneGraph({
            kind: 'vizmatic.element',
            type: 'div',
            props: { style: { color: 'red; background: url(https://evil.example/x)' } },
        })).toThrow(/delimiters|external/i)

        for (const prop of ['markerStart', 'marker-end', 'clip-path', 'mask-image', 'shape-outside', 'offset-path']) {
            expect(() => validateResolvedSceneResources({ [prop]: 'url(https://evil.example/leak.svg#a)' })).toThrow(/external/i)
        }
        expect(() => validateResolvedSceneResources({ markerEnd: 'url(#local-arrow)' })).not.toThrow()

        const dir = await makeTempDir('vizmatic-scene-style-key-')
        await expect(renderSceneFrame({
            source: `<Board width={320} height={180}><div style={{ ["background:url(https://evil.example/p.png);x"]: "1" }}>hi</div></Board>`,
            width: 320,
            height: 180,
            duration: 1,
            outputPath: join(dir, 'out.png'),
        })).rejects.toThrow(/style property/i)
    })

    it('locks Worker prototype chains, postMessage, FontFace, and StorageManager in disableUserCodeCapabilities', () => {
        const workerGlobalProto = {
            indexedDB: { open: () => 'leaked-idb' },
            caches: { open: () => 'leaked-caches' },
            fetch: () => 'leaked-fetch',
            importScripts: () => 'leaked-scripts',
        }
        const dedicatedWorkerProto = Object.create(workerGlobalProto) as Record<string, unknown>
        dedicatedWorkerProto.postMessage = () => 'leaked-proto-postMessage'
        dedicatedWorkerProto.close = () => 'leaked-close'

        const storageProto = {
            getDirectory: () => 'leaked-opfs',
            estimate: () => 'leaked-estimate',
        }
        const storageInstance = Object.create(storageProto)
        const navigatorProto = {
            storage: storageInstance,
            sendBeacon: () => true,
        }
        const navigatorInstance = Object.create(navigatorProto)

        const mockSelf = Object.create(dedicatedWorkerProto) as Record<string, unknown>
        mockSelf.navigator = navigatorInstance
        mockSelf.postMessage = () => 'leaked-own-postMessage'
        mockSelf.FontFace = function FontFace() {}

        disableUserCodeCapabilities(mockSelf)

        expect(() => mockSelf.postMessage).toThrow(/disabled in the Vizmatic playground/)
        expect(() => mockSelf.FontFace).toThrow(/disabled in the Vizmatic playground/)
        expect(() => mockSelf.indexedDB).toThrow(/disabled in the Vizmatic playground/)
        expect(() => (Object.getPrototypeOf(Object.getPrototypeOf(mockSelf)) as Record<string, unknown>).indexedDB).toThrow(/disabled in the Vizmatic playground/)
        expect(() => (Object.getPrototypeOf(mockSelf) as Record<string, unknown>).postMessage).toThrow(/disabled in the Vizmatic playground/)
        expect(() => (mockSelf.navigator as Record<string, unknown>).storage).toThrow(/disabled in the Vizmatic playground/)
        expect(() => (storageProto as Record<string, unknown>).getDirectory).toThrow(/disabled in the Vizmatic playground/)
    })

    it('guards fromSvg against out-of-range numeric entities, <use> cycles/bombs, and circular gradients/patterns', () => {
        expect(() => fromSvg('<svg viewBox="0 0 100 100"><title>&#999999999;&#x110000;&#0;&#xd800;</title><rect width="10" height="10" fill="#fff"/></svg>')).not.toThrow()

        expect(() => fromSvg(
            '<svg viewBox="0 0 100 100"><defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/></svg>',
        )).toThrow(/Circular <use>/i)

        const levels = Array.from({ length: 18 }, (_, i) =>
            `<g id="l${i}"><use href="#l${i + 1}"/><use href="#l${i + 1}"/></g>`,
        ).join('')
        const bomb = `<svg viewBox="0 0 100 100"><defs>${levels}<rect id="l18" width="2" height="2" fill="#fff"/></defs><use href="#l0"/></svg>`
        expect(() => fromSvg(bomb)).toThrow(/node budget/i)

        expect(() => fromSvg(
            '<svg viewBox="0 0 100 100"><defs><pattern id="p1"><rect width="5" height="5" fill="url(#p2)"/></pattern><pattern id="p2"><rect width="5" height="5" fill="url(#p1)"/></pattern><linearGradient id="g1" href="#g2"/><linearGradient id="g2" href="#g1"/></defs><rect width="10" height="10" fill="url(#p1)" stroke="url(#g1)"/></svg>',
        )).not.toThrow()
    })

    it('hardens preview server POST /log against cross-origin requests, oversized payloads, and ANSI escape injection', async () => {
        expect(sanitizePreviewLogText('bad\x1b[31mRED\x1b[0m\x1b]0;pwned\x07\x08\nok')).toBe('badRED\nok')

        const dir = await makeTempDir('vizmatic-preview-sec-')
        const filmPath = join(dir, 'demo.ts')
        await writeFile(
            filmPath,
            `import { film, rect } from 'vizmatic/stage'\nexport default film({}, (s) => { s.add(rect(40, 40, { fill: 'blue' })); s.wait(1) })\n`,
            'utf8',
        )

        const logs: string[] = []
        const server = await startPreview({ file: filmPath, log: (line: string) => logs.push(line) })
        try {
            const crossSite = await fetch(`${server.url}log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
                body: JSON.stringify({ kind: 'error', message: 'spoofed' }),
            })
            expect(crossSite.status).toBe(403)

            const crossOrigin = await fetch(`${server.url}log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
                body: JSON.stringify({ kind: 'error', message: 'spoofed' }),
            })
            expect(crossOrigin.status).toBe(403)

            const badJson = await fetch(`${server.url}log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${server.port}` },
                body: '{not-json',
            })
            expect(badJson.status).toBe(400)

            const huge = await fetch(`${server.url}log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${server.port}` },
                body: JSON.stringify({ kind: 'error', message: 'x'.repeat(80_000) }),
            })
            expect(huge.status).toBe(413)

            const clean = await fetch(`${server.url}log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${server.port}`, 'Sec-Fetch-Site': 'same-origin' },
                body: JSON.stringify({ kind: 'error', message: 'boom \x1b[31mred\x1b[0m' }),
            })
            expect(clean.status).toBe(204)
            expect(logs.some((entry) => entry.includes('boom red') && !entry.includes('\x1b'))).toBe(true)
        } finally {
            await server.close()
        }
    })
})

describe('Section 4 film render cache helpers', () => {
    it('invalidates cache keys on film source, look, or quality changes and restores matching MP4s', async () => {
        const dir = await makeTempDir('vizmatic-film-cache-')
        const filmsDir = join(dir, 'films')
        const cacheDir = join(dir, 'cache')
        const outDir = join(dir, 'out')

        const { mkdir } = await import('node:fs/promises')
        await mkdir(filmsDir, { recursive: true })
        await mkdir(outDir, { recursive: true })
        await writeFile(join(filmsDir, 'shared.ts'), 'export const LABEL = "v1"\n', 'utf8')
        await writeFile(join(filmsDir, 'sample.ts'), 'import { LABEL } from "./shared"\nexport default LABEL\n', 'utf8')

        const keyV1 = await computeFilmCacheKey({ id: 'sample', look: 'midnight' }, 'high', 'engine-1', filmsDir)
        const keyQuality = await computeFilmCacheKey({ id: 'sample', look: 'midnight' }, 'draft', 'engine-1', filmsDir)
        const keyLook = await computeFilmCacheKey({ id: 'sample', look: 'paper' }, 'high', 'engine-1', filmsDir)
        expect(keyV1).not.toBe(keyQuality)
        expect(keyV1).not.toBe(keyLook)

        const renderedPath = join(outDir, 'rendered.mp4')
        const restoredPath = join(outDir, 'restored.mp4')
        await writeFile(renderedPath, Buffer.from('fake-mp4-bytes'))
        await saveCachedFilm(cacheDir, 'sample', keyV1, renderedPath)

        expect(await tryRestoreCachedFilm(cacheDir, 'sample', 'wrong-key', restoredPath)).toBeNull()
        expect(await tryRestoreCachedFilm(cacheDir, 'sample', keyV1, restoredPath)).toBe(14)
        expect((await readFile(restoredPath, 'utf8'))).toBe('fake-mp4-bytes')

        await writeFile(join(filmsDir, 'shared.ts'), 'export const LABEL = "v2"\n', 'utf8')
        const keyV2 = await computeFilmCacheKey({ id: 'sample', look: 'midnight' }, 'high', 'engine-1', filmsDir)
        expect(keyV2).not.toBe(keyV1)
    })
})
