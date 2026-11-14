import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { createCanvasReadback } from '../src/canvas-readback'
import { renderRgbaVideo } from '../src/video'

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0

describe('serial canvas readback', () => {
    it('executes each draw and returns the captured pixels until the command, font or native state changes', () => {
        const ink: string[] = []
        const context = {
            font: '',
            reset() { ink.length = 0; this.font = '' },
            fillText(label: string) { ink.push(this.font + label) },
            getImageData() { return ink.join() },
        }
        let reads = 0, draws = 0
        const cache = createCanvasReadback(context, () => { reads++; return new TextEncoder().encode(ink.join()) })
        const draw = (font: string) => cache.frame(ctx => { draws++; ctx.font = font; ctx.fillText('7') })
        const first = draw('12px serif')
        expect(draw('12px serif')).toBe(first)
        expect(draw('14px serif')).not.toEqual(first)
        cache.frame(ctx => { ctx.fillText('8'); expect(ctx.getImageData()).toBe('8') })
        draw('14px serif')
        expect(reads).toBe(4)
        expect(draws).toBe(4)
        expect(cache.stats()).toEqual({ frames: 5, reused: 1, tracking: false })
    })

    it('keeps native gradient identity and mutable paint state after a reused frame', () => {
        const context = {
            fillStyle: '' as string | { color: string },
            ink: '',
            reset() { this.fillStyle = ''; this.ink = '' },
            fillRect() { this.ink = typeof this.fillStyle === 'string' ? this.fillStyle : this.fillStyle.color },
            createLinearGradient() { return { color: 'red' } },
        }
        const frames = createCanvasReadback(context, () => new TextEncoder().encode(context.ink))
        const flat = () => frames.frame(ctx => { ctx.fillStyle = 'blue'; ctx.fillRect() })
        expect(flat()).toBe(flat())
        const gradient = context.createLinearGradient()
        const paint = () => frames.frame(ctx => { ctx.fillStyle = gradient; expect(ctx.fillStyle).toBe(gradient); ctx.fillRect() })
        expect(new TextDecoder().decode(paint())).toBe('red')
        gradient.color = 'green'
        expect(new TextDecoder().decode(paint())).toBe('green')
        expect(frames.stats()).toEqual({ frames: 4, reused: 1, tracking: false })
    })

    it('disables reuse when getLineDash throws after setLineDash mutates native dash state', () => {
        const context = {
            dash: [] as number[],
            ink: '',
            failRead: false,
            reset() { this.dash = []; this.ink = '' },
            setLineDash(segments: number[]) { this.dash = [...segments] },
            getLineDash() {
                if (this.failRead) throw new Error('getLineDash failed')
                return [...this.dash]
            },
            stroke() { this.ink = this.dash.join(',') || 'solid' },
        }
        const cache = createCanvasReadback(context, () => new TextEncoder().encode(context.ink))
        const segments = [4, 2]
        const dashed = cache.frame(ctx => { ctx.setLineDash(segments); segments[0] = 99; ctx.stroke() })
        segments[0] = 4
        expect(cache.frame(ctx => { ctx.setLineDash(segments); ctx.stroke() })).toBe(dashed)

        expect(new TextDecoder().decode(cache.frame(ctx => { ctx.stroke() }))).toBe('solid')
        context.failRead = true
        const afterFailure = cache.frame(ctx => {
            try { ctx.setLineDash([6, 2]) } catch {}
            ctx.stroke()
        })
        expect(new TextDecoder().decode(afterFailure)).toBe('6,2')
        expect(cache.stats()).toEqual({ frames: 4, reused: 1, tracking: false })
    })

    it('disables reuse when setLineDash receives extra untracked arguments', () => {
        const context = {
            dash: [] as number[],
            phase: 0,
            ink: '',
            reset() { this.dash = []; this.phase = 0; this.ink = '' },
            setLineDash(segments: number[], options?: { phase: number }) {
                this.dash = [...segments]
                this.phase = options?.phase ?? 0
            },
            getLineDash() { return [...this.dash] },
            stroke() { this.ink = `${this.dash.join(',')}@${this.phase}` },
        }
        const cache = createCanvasReadback(context, () => new TextEncoder().encode(context.ink))
        const options = { phase: 1 }
        expect(new TextDecoder().decode(cache.frame(ctx => { ctx.setLineDash([4, 2], options); ctx.stroke() }))).toBe('4,2@1')
        options.phase = 3
        expect(new TextDecoder().decode(cache.frame(ctx => { ctx.setLineDash([4, 2], options); ctx.stroke() }))).toBe('4,2@3')
        expect(cache.stats()).toEqual({ frames: 2, reused: 0, tracking: false })
    })

    it('disables reuse when caught property setters, getters or rejected writes diverge from tracked state', () => {
        let tint = 'plain'
        const setterContext = {
            ink: '',
            reset() { tint = 'plain'; this.ink = '' },
            fillRect() { this.ink = tint },
            set filter(value: string) {
                tint = 'filtered'
                if (value === 'bad') throw new TypeError('Unsupported filter')
            },
        }
        const setterCache = createCanvasReadback(setterContext, () => new TextEncoder().encode(setterContext.ink))
        expect(new TextDecoder().decode(setterCache.frame(ctx => { ctx.fillRect() }))).toBe('plain')
        const filtered = setterCache.frame(ctx => { try { ctx.filter = 'bad' } catch {} ctx.fillRect() })
        expect(new TextDecoder().decode(filtered)).toBe('filtered')
        expect(setterCache.stats()).toEqual({ frames: 2, reused: 0, tracking: false })

        let status = 'clean'
        const getterContext = {
            ink: '',
            reset() { status = 'clean'; this.ink = '' },
            fillRect() { this.ink = status },
            get status(): string { status = 'probed'; throw new Error('Status unavailable') },
        }
        const getterCache = createCanvasReadback(getterContext, () => new TextEncoder().encode(getterContext.ink))
        expect(new TextDecoder().decode(getterCache.frame(ctx => { ctx.fillRect() }))).toBe('clean')
        const probed = getterCache.frame(ctx => { try { void ctx.status } catch {} ctx.fillRect() })
        expect(new TextDecoder().decode(probed)).toBe('probed')
        expect(getterCache.stats()).toEqual({ frames: 2, reused: 0, tracking: false })

        let writable = false, currentFill = '#000000'
        const guarded = new Proxy({
            ink: '',
            reset() { currentFill = '#000000'; this.ink = '' },
            fillRect() { this.ink = currentFill },
        } as { fillStyle?: string; ink: string; reset(): void; fillRect(): void }, {
            set(target, key, value, receiver) {
                if (key !== 'fillStyle') return Reflect.set(target, key, value, receiver)
                if (!writable) return false
                currentFill = String(value)
                return true
            },
        })
        const rejectedCache = createCanvasReadback(guarded, () => new TextEncoder().encode(guarded.ink))
        expect(new TextDecoder().decode(rejectedCache.frame(ctx => { Reflect.set(ctx, 'fillStyle', '#ff0000'); ctx.fillRect() }))).toBe('#000000')
        writable = true
        expect(new TextDecoder().decode(rejectedCache.frame(ctx => { Reflect.set(ctx, 'fillStyle', '#ff0000'); ctx.fillRect() }))).toBe('#ff0000')
        expect(rejectedCache.stats()).toEqual({ frames: 2, reused: 0, tracking: false })
    })

    it('counts only completed frames when readPixels throws and accepts cross-realm Uint8Array snapshots', () => {
        let failRead = true
        const crossRealm = runInNewContext('new Uint8Array([16, 32, 48, 255])') as Uint8Array
        expect(crossRealm instanceof Uint8Array).toBe(false)
        const context = { fillStyle: '', reset() { this.fillStyle = '' }, fillRect() {} }
        const readback = createCanvasReadback(context, () => {
            if (failRead) throw new Error('readback failed')
            return crossRealm
        })

        expect(() => readback.frame(ctx => { ctx.fillStyle = '#ffffff'; ctx.fillRect() })).toThrow('readback failed')
        expect(readback.stats()).toEqual({ frames: 0, reused: 0, tracking: false })

        failRead = false
        const fresh = createCanvasReadback(context, () => crossRealm)
        expect(fresh.frame(ctx => { if ('fillRect' in ctx) ctx.fillRect() })).toBe(crossRealm)
        expect(fresh.frame(ctx => { if ('fillRect' in ctx) ctx.fillRect() })).toBe(crossRealm)
        expect(fresh.stats()).toEqual({ frames: 2, reused: 1, tracking: true })
    })

    it.skipIf(!hasFfmpeg)('produces byte-identical MP4 output to fresh readback in renderRgbaVideo', async () => {
        const width = 32, height = 32, bytes = width * height * 4
        const makeSurface = () => {
            const buffer = new Uint8Array(bytes)
            const context = {
                fillStyle: '#000000',
                reset() { buffer.fill(0); this.fillStyle = '#000000' },
                fillRect() {
                    const r = Number.parseInt(this.fillStyle.slice(1, 3), 16)
                    const g = Number.parseInt(this.fillStyle.slice(3, 5), 16)
                    const b = Number.parseInt(this.fillStyle.slice(5, 7), 16)
                    for (let i = 0; i < bytes; i += 4) { buffer[i] = r; buffer[i + 1] = g; buffer[i + 2] = b; buffer[i + 3] = 255 }
                },
            }
            return { context, snapshot: () => buffer.slice() }
        }
        const paint = (ctx: { fillStyle: string; fillRect(): void }, index: number) => {
            ctx.fillStyle = index < 3 ? '#1e3a5f' : (index < 5 ? '#2bd4a4' : '#1e3a5f')
            ctx.fillRect()
        }
        const folder = await mkdtemp(join(tmpdir(), 'vizmatic-canvas-readback-'))
        try {
            const directPath = join(folder, 'direct.mp4'), reusedPath = join(folder, 'reused.mp4')
            const base = { width, height, duration: 800, fps: 10, crf: 18, preset: 'ultrafast', threads: 1 }
            const fresh = makeSurface()
            await renderRgbaVideo(({ index }) => { fresh.context.reset(); paint(fresh.context, index); return fresh.snapshot() }, { ...base, outputPath: directPath })
            const cached = makeSurface()
            const readback = createCanvasReadback(cached.context, () => cached.snapshot())
            await renderRgbaVideo(({ index }) => readback.frame(ctx => paint(ctx, index)), { ...base, outputPath: reusedPath })
            expect(readback.stats()).toEqual({ frames: 8, reused: 5, tracking: true })
            expect(await readFile(reusedPath)).toEqual(await readFile(directPath))
        } finally {
            await rm(folder, { recursive: true, force: true })
        }
    })
})
