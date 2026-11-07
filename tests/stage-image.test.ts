import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { encode } from 'fast-png'
import { GIFEncoder } from 'gifenc'
import { Resvg } from '@resvg/resvg-js'
import { compileFilm, film, image, Node, checkFilm, frameInkBounds, resolveImageAsset, type ImageOp } from '../src/stage/index'

const directories: string[] = []
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAABgcQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAEAAQDASIAAhEAAxEA/9oADAMBAAIRAxEAPwCLAFF/f//Z'
const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAP8AAP///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw=='
const bytes = () => encode({ width: 2, height: 1, depth: 8, channels: 4, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]) })
const cropBytes = () => encode({ width: 8, height: 4, depth: 8, channels: 4,
    data: new Uint8Array(Array(4).fill([...Array(4).fill([255, 0, 0, 255]).flat(), ...Array(4).fill([0, 255, 0, 128]).flat()]).flat()) })
const uri = (data: Uint8Array) => 'data:image/png;base64,' + Buffer.from(data).toString('base64')
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
async function directory() { const p = await mkdtemp(join(tmpdir(), 'vizmatic-image-')); directories.push(p); return p }
function pixels(svg: string) { return new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels }
function pixel(data: Uint8Array, x: number, y: number, width = 64) { return Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)) }
function wrongWidth(input: Uint8Array): Uint8Array {
    const out = input.slice(), view = new DataView(out.buffer)
    view.setUint32(16, 1)
    let crc = -1
    for (const byte of out.subarray(12, 29)) {
        crc ^= byte
        for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (-(crc & 1) & 0xedb88320)
    }
    view.setUint32(29, (crc ^ -1) >>> 0)
    return out
}

describe('prepared image assets', () => {
    it('copies local bytes, validates metadata and digest, and freezes an embedded asset', async () => {
        const input = bytes(), expected = sha(input), root = await directory()
        await writeFile(join(root, 'figure.png'), input)
        const asset = await resolveImageAsset('figure.png', { baseDir: root, id: 'figure-1', mediaType: 'image/png', sha256: expected, width: 2, height: 1 })
        expect(asset).toMatchObject({ id: 'figure-1', width: 2, height: 1, sha256: expected, mediaType: 'image/png', src: uri(input) })
        expect(Object.isFrozen(asset)).toBe(true)
        const copied = await resolveImageAsset(input)
        input.fill(0)
        expect(copied.src).toBe(asset.src)
        expect(await readFile(join(root, 'figure.png'))).not.toEqual(input)
    })

    it('rejects missing, corrupt, wrong-MIME, wrong-size and wrong-digest sources', async () => {
        await expect(resolveImageAsset('missing.png', { baseDir: await directory() })).rejects.toThrow('Could not read image asset')
        await expect(resolveImageAsset('https://example.com/figure.png')).rejects.toThrow('remote URLs are not loaded')
        await expect(resolveImageAsset(bytes(), { mediaType: 'image/jpeg' })).rejects.toThrow('Unsupported image asset media type')
        await expect(resolveImageAsset(new Uint8Array([1, 2, 3]))).rejects.toThrow('not a PNG')
        await expect(resolveImageAsset(bytes(), { width: 3 })).rejects.toThrow('not the declared 3')
        await expect(resolveImageAsset(bytes(), { sha256: '0'.repeat(64) })).rejects.toThrow('SHA-256 mismatch')
        await expect(resolveImageAsset('data:image/png;base64,!!!!')).rejects.toThrow('invalid')
        const corrupt = bytes(); corrupt[corrupt.length - 1] ^= 1
        await expect(resolveImageAsset(corrupt)).rejects.toThrow(/CRC/)
        const deep = encode({ width: 1, height: 1, depth: 16, channels: 3, data: new Uint16Array([1, 2, 3]) })
        await expect(resolveImageAsset(deep)).rejects.toThrow('8-bit')
    })

    it('validates every static and keyed picture before returning a compiled film', async () => {
        const missing = film(s => {
            s.add(new Node().set('image', { src: 'missing-stage-figure.png', width: 20, height: 10 }).opacity(0))
            s.wait(1)
        })
        await expect(compileFilm(missing)).rejects.toThrow('Could not read image asset')
        const report = await checkFilm(missing)
        expect(report.ok).toBe(false)
        expect(report.diagnostics).toMatchObject([{ code: 'film.image_asset', severity: 'error' }])
        const invalidLater = film(s => {
            const node = s.add(new Node())
            s.at(.123, () => node.set('image', { src: 'data:image/png;base64,AAAA', width: 10, height: 10 }))
            s.wait(1)
        })
        await expect(compileFilm(invalidLater)).rejects.toThrow('not a supported PNG')
    })

    it('embeds legacy local image sources so export no longer depends on their filename', async () => {
        const root = await directory(), path = join(root, 'legacy.png')
        await writeFile(path, bytes())
        const compiled = await compileFilm(film({ width: 64, height: 64, bloom: 0 }, s => {
            s.add(image(path, { width: 20, height: 10 }))
            s.wait(1)
        }))
        await rm(path)
        expect(compiled.svg(.5)).toContain('data:image/png;base64,')
        expect(compiled.svg(.5)).not.toContain(path)
        expect(pixel(pixels(compiled.svg(.5)), 24, 32)[0]).toBe(255)
    })

    it('keeps legacy JPEG and GIF pixels and fails corrupt inputs before export', async () => {
        for (const src of [jpeg, gif]) {
            const compiled = await compileFilm(film({ width: 64, height: 64, bloom: 0 }, s => {
                s.add(image(src, { width: 16 })); s.wait(1)
            }))
            const color = pixel(pixels(compiled.svg(.5)), 32, 32)
            expect(color[0]).toBeGreaterThan(245)
            expect(color[1]).toBeLessThan(5)
            expect(color[2]).toBeLessThan(5)
        }
        for (const src of [gif.slice(0, -4), jpeg.slice(0, -4)]) {
            await expect(compileFilm(film(s => { s.add(image(src, { width: 10, height: 10 })); s.wait(1) }))).rejects.toThrow(/Image/)
        }
    })

    it('validates GIF compression through dictionary growth and rejects malformed pixel codes', async () => {
        const encoder = GIFEncoder(), size = 128
        const palette = Array.from({ length: 256 }, (_, n) => [n, 255 - n, n])
        const indices = Uint8Array.from({ length: size * size }, (_, n) => (n * 73 + Math.floor(n / size) * 17) % 256)
        encoder.writeFrame(indices, size, size, { palette, delay: 100, repeat: 0 })
        encoder.finish()
        const src = 'data:image/gif;base64,' + Buffer.from(encoder.bytes()).toString('base64')
        const compiled = await compileFilm(film({ width: 64, height: 64, bloom: 0 }, s => { s.add(image(src, { width: 32 })); s.wait(1) }))
        expect(pixel(pixels(compiled.svg(.5)), 32, 32)[3]).toBe(255)
        const broken = Buffer.from(gif.split(',')[1], 'base64')
        broken[broken.length - 4] = 0xff
        const corrupt = 'data:image/gif;base64,' + broken.toString('base64')
        await expect(compileFilm(film(s => { s.add(image(corrupt, { width: 10 })); s.wait(1) }))).rejects.toThrow(/GIF/)
    })

    it('bounds legacy PNG inflation while retaining 16-bit and Adam7 image decoding', async () => {
        const oversized = uri(wrongWidth(bytes()))
        await expect(compileFilm(film(s => { s.add(image(oversized, { width: 16 })); s.wait(1) }))).rejects.toThrow('expands beyond its declared dimensions')
        for (const interlace of ['null', 'Adam7'] as const) for (const depth of [8, 16] as const) {
            const values = depth === 8 ? new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255]) : new Uint16Array([65535, 0, 0, 65535, 65535, 0, 0, 65535])
            const src = uri(encode({ width: 2, height: 1, depth, channels: 4, data: values }, { interlace }))
            const compiled = await compileFilm(film({ width: 64, height: 64, bloom: 0 }, s => { s.add(image(src, { width: 16 })); s.wait(1) }))
            expect(pixel(pixels(compiled.svg(.5)), 32, 32)).toEqual([255, 0, 0, 255])
        }
    })

    it('preloads and embeds legacy HTTP images while honoring explicit and environment offline policies', async () => {
        let requests = 0
        const server = createServer((_request, response) => { requests++; response.setHeader('Content-Type', 'image/jpeg'); response.end(Buffer.from(jpeg.split(',')[1], 'base64')) })
        await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
        const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/image.jpg`
        const definition = film({ width: 64, height: 64, bloom: 0 }, s => { s.add(image(url, { width: 16, height: 16 })); s.wait(1) })
        try {
            await expect(compileFilm(definition, { imageNetwork: 'deny' })).rejects.toThrow('Network image loading is disabled')
            for (const variable of ['VIZMATIC_DISABLE_NETWORK', 'VIZMATIC_OFFLINE']) {
                vi.stubEnv(variable, '1')
                await expect(compileFilm(definition)).rejects.toThrow('Network image loading is disabled')
                vi.stubEnv(variable, '')
            }
            expect(requests).toBe(0)
            const compiled = await compileFilm(definition)
            expect(requests).toBe(1)
            expect(compiled.svg(.5)).toContain('data:image/jpeg;base64,')
            expect(pixel(pixels(compiled.svg(.5)), 32, 32)[0]).toBeGreaterThan(245)
            expect(requests).toBe(1)
        } finally { await new Promise<void>(done => server.close(() => done())) }
    })
})

describe('image geometry and actual pixels', () => {
    it('reports transparent-only films and transparent crops as blank while keeping white paper visible', async () => {
        const transparent = encode({ width: 2, height: 1, depth: 8, channels: 4, data: new Uint8Array([255, 255, 255, 0, 255, 255, 255, 0]) })
        const white = encode({ width: 2, height: 1, depth: 8, channels: 3, data: new Uint8Array([255, 255, 255, 255, 255, 255]) })
        const partial = await resolveImageAsset(encode({ width: 2, height: 1, depth: 8, channels: 4, data: new Uint8Array([255, 0, 0, 255, 255, 255, 255, 0]) }))
        const nodes = [image(await resolveImageAsset(transparent)), image(uri(transparent)), image(partial, { crop: { x: 1, y: 0, width: 1, height: 1 } })]
        for (const node of nodes) {
            const compiled = await compileFilm(film({ width: 64, height: 64, fps: 10, bloom: 0 }, s => { s.add(node); s.wait(2) }))
            expect((await checkFilm(compiled, { motion: true })).diagnostics.some(d => d.code === 'film.blank')).toBe(true)
            expect(frameInkBounds(compiled.frame(1))).toBeNull()
        }
        const paper = await compileFilm(film({ width: 64, height: 64, fps: 10, bloom: 0 }, s => { s.add(image(uri(white))); s.wait(2) }))
        expect((await checkFilm(paper, { motion: true })).diagnostics.some(d => d.code === 'film.blank')).toBe(false)
    })
    it('contains without stretching and covers by cropping source pixels', async () => {
        const asset = await resolveImageAsset(bytes())
        const contain = image(asset, { width: 20, height: 20 })
        expect(contain.bounds()).toEqual({ x: -10, y: -5, width: 20, height: 10 })
        const cover = image(asset, { width: 20, height: 20, fit: 'cover' })
        const op = cover.get('image')!
        expect(op.crop).toEqual({ x: .5, y: 0, width: 1, height: 1 })
        expect(cover.bounds()).toEqual({ x: -10, y: -10, width: 20, height: 20 })
        expect(() => image(asset, { crop: { x: 1, y: 0, width: 2, height: 1 } })).toThrow('inside the intrinsic image')
        expect(() => image(asset, { width: Infinity })).toThrow('positive finite')
    })

    it('paints the selected source region with alpha and its node transform', async () => {
        const asset = await resolveImageAsset(cropBytes())
        const compiled = await compileFilm(film({ width: 64, height: 64, background: '#ffffff', bloom: 0 }, s => {
            s.add(image(asset, { width: 16, height: 8, crop: { x: 4, y: 0, width: 4, height: 4 }, opacity: .5 }).rotate(Math.PI / 2).at(4, -3))
            s.wait(1)
        }))
        const op = compiled.frame(.5).ops[0] as ImageOp
        expect(op.alpha).toBe(.5)
        const ink = frameInkBounds(compiled.frame(.5))!
        expect(ink.x).toBeCloseTo(32)
        expect(ink.y).toBeCloseTo(25)
        expect(ink.width).toBeCloseTo(8)
        expect(ink.height).toBeCloseTo(8)
        const center = pixel(pixels(compiled.svg(.5)), 36, 29)
        expect(center[0]).toBeGreaterThanOrEqual(190)
        expect(center[0]).toBeLessThanOrEqual(192)
        expect(center[1]).toBe(255)
        expect(center[2]).toBe(center[0])
        expect(pixel(pixels(compiled.svg(.5)), 5, 5)).toEqual([255, 255, 255, 255])
    })

    it('reports image bounds outside the canvas instead of treating images as absent ink', async () => {
        const asset = await resolveImageAsset(bytes())
        const compiled = await compileFilm(film({ width: 64, height: 64, bloom: 0 }, s => {
            s.add(image(asset, { width: 20 }).at(100, 100))
            s.wait(1)
        }))
        expect(frameInkBounds(compiled.frame(.5))).toEqual({ x: 122, y: 127, width: 20, height: 10 })
        expect((await checkFilm(compiled, { times: [.5] })).diagnostics).toMatchObject([{ code: 'film.off_canvas' }])
    })
})

it('preloads browser pixels before first paint and matches the Node SVG backend', async () => {
    const bundled = await build({ stdin: { contents: `export * from './src/stage/index'; export { FilmPlayer } from './src/stage/player'`, resolveDir: resolve('.') }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' })
    const server = createServer((request, response) => {
        if (request.url === '/image.jpg' || request.url === '/image.gif') {
            const src = request.url.endsWith('.jpg') ? jpeg : gif
            response.setHeader('Content-Type', src.slice(5, src.indexOf(';')))
            response.end(Buffer.from(src.split(',')[1], 'base64'))
            return
        }
        response.setHeader('Content-Type', request.url === '/engine.js' ? 'text/javascript' : 'text/html')
        response.end(request.url === '/engine.js' ? bundled.outputFiles[0].text : '<canvas width="64" height="64" style="width:64px;height:64px"></canvas>')
    })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const address = server.address() as { port: number }
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
    try {
        const page = await browser.newPage()
        await page.goto(`http://127.0.0.1:${address.port}`)
        const actual = await page.evaluate(`(async () => {
            const engine = await import('/engine.js')
            const asset = await engine.resolveImageAsset(${JSON.stringify(uri(cropBytes()))})
            const compiled = await engine.compileFilm(engine.film({ width: 64, height: 64, background: '#ffffff', bloom: 0 }, s => {
                s.add(engine.image(asset, { width: 16, height: 16, crop: { x: 4, y: 0, width: 4, height: 4 }, opacity: .5 }).rotate(Math.PI / 2).at(4, -3))
                s.wait(1)
            }))
            const canvas = document.querySelector('canvas')
            const player = new engine.FilmPlayer(canvas, compiled, { pixelRatio: 1 })
            player.seek(.5)
            const rgba = Array.from(canvas.getContext('2d').getImageData(36, 29, 1, 1).data)
            const legacy = []
            for (const src of [${JSON.stringify(jpeg)}, ${JSON.stringify(gif)}, '/image.jpg', '/image.gif']) {
                const f = await engine.compileFilm(engine.film({width:64,height:64,bloom:0}, s => { s.add(engine.image(src,{width:16,height:16})); s.wait(1) }))
                const p = new engine.FilmPlayer(canvas,f,{pixelRatio:1}); p.seek(.5)
                legacy.push({rgba:Array.from(canvas.getContext('2d').getImageData(32,32,1,1).data),svg:f.svg(.5)})
                p.destroy()
            }
            let denied = false
            try { await engine.compileFilm(engine.film({imageNetwork:'deny'}, s => {s.add(engine.image('/image.jpg',{width:16,height:16}));s.wait(1)})) } catch(e) { denied = e.message.includes('Network image loading is disabled') }
            return { rgba, svg: compiled.svg(.5), errorCount: (await engine.checkFilm(compiled, { times: [.5] })).summary.errors, legacy, denied }
        })()`) as { rgba: number[]; svg: string; errorCount: number; legacy: {rgba:number[];svg:string}[]; denied:boolean }
        expect(actual.errorCount).toBe(0)
        const reference = pixel(pixels(actual.svg), 36, 29)
        actual.rgba.forEach((value, i) => expect(Math.abs(value - reference[i]), JSON.stringify({ browser: actual.rgba, node: reference })).toBeLessThanOrEqual(1))
        expect(actual.rgba[1]).toBe(255)
        expect(actual.rgba[0]).toBeLessThan(200)
        expect(actual.denied).toBe(true)
        for (const entry of actual.legacy) {
            const node = pixel(pixels(entry.svg), 32, 32)
            expect(entry.rgba[0]).toBeGreaterThan(245)
            entry.rgba.forEach((value, i) => expect(Math.abs(value - node[i])).toBeLessThanOrEqual(2))
        }
    } finally {
        await browser.close()
        await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
    }
}, 30_000)
