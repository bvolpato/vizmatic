import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'
import { compileFilm, film, frameToSvg, scalarField } from '../src/stage/index'
import { framesToJob, sameRasterJob } from '../src/stage/raster'
import { parseColor } from '../src/stage/color'

const options = { x: [-1, 1], y: [-1, 1], domain: [-1, 1], colors: ['#000000', '#ffffff'], width: 8, height: 8, resolution: 8 } as const

describe('sampled scalar fields', () => {
    it('keeps the fixed domain, y direction, and frames independent of seek order', async () => {
        const compiled = await compileFilm(film({ width: 9, height: 9, bloom: 0 }, s => {
            s.add(scalarField((_x, y, time) => y + time, { ...options, width: 9, height: 9, resolution: 9 }))
            s.wait(1)
        }))
        const first = compiled.frame(0), later = compiled.frame(1)
        const bytes = (frame: typeof first) => new Resvg(frameToSvg(frame)).render().pixels
        const a = bytes(first), b = bytes(later)
        expect(a[0]).toBe(255)
        expect(a[8 * 9 * 4]).toBe(0)
        expect(b[8 * 9 * 4]).toBe(a[4 * 9 * 4])
        expect(b[8 * 9 * 4]).toBeGreaterThan(0)
        expect(bytes(compiled.frame(0))).toEqual(a)
        expect(bytes(first)).toEqual(a)
        const background = (value: string | null) => parseColor(value ?? '#000000').slice(0, 3) as [number, number, number]
        const oldJob = framesToJob([first], 9, background)
        const newJob = framesToJob([later], 9, background)
        expect(sameRasterJob(oldJob, newJob)).toBe(false)
        expect(sameRasterJob(oldJob, framesToJob([compiled.frame(0)], 9, background))).toBe(true)
    })

    it('preserves missing samples as transparent holes and supports transformed copies', async () => {
        const compiled = await compileFilm(film({ width: 24, height: 12, bloom: 0, background: null }, s => {
            const field = scalarField(x => x < 0 ? NaN : 1, options).at(-6, 0)
            const copy = field.clone().at(6, 0).opacity(0.5)
            s.add(field, copy)
            s.wait(1)
        }))
        const frame = compiled.frame(0)
        const images = frame.ops.filter(op => op.kind === 'image')
        expect(images).toHaveLength(2)
        expect(images[0].node).not.toBe(images[1].node)
        expect(images.map(op => op.alpha)).toEqual([1, 0.5])
        const pixels = new Resvg(frameToSvg(frame)).render().pixels
        expect(pixels[(6 * 24 + 3) * 4 + 3]).toBe(0)
        expect(pixels[(6 * 24 + 8) * 4 + 3]).toBe(255)
        expect(pixels[(6 * 24 + 20) * 4 + 3]).toBe(128)
    })

    it('rejects unbounded grids and renders an entirely missing field as empty', async () => {
        expect(() => scalarField(() => 0, { ...options, domain: [1, 1] })).toThrow('finite increasing')
        expect(() => scalarField(() => 0, { ...options, resolution: 10000 })).toThrow('resolution')
        const compiled = await compileFilm(film(s => { s.add(scalarField(() => NaN, options)); s.wait(1) }))
        expect(compiled.frame(0).ops.filter(op => op.kind === 'image')).toHaveLength(0)
    })

    it('uses the numeric legend normalization for log and symlog fields', async () => {
        const compiled = await compileFilm(film({ width: 3, height: 3, bloom: 0 }, s => {
            s.add(scalarField(x => 10 ** x, { x: [0, 2], y: [0, 1], domain: [1, 100], scale: 'log', colors: ['#000000', '#ff0000', '#ffffff'], width: 3, height: 3, resolution: 3 }))
            s.wait(1)
        }))
        const pixels = new Resvg(frameToSvg(compiled.frame(0))).render().pixels
        expect(Array.from(pixels.slice(0, 12))).toEqual([0, 0, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255])
        const symmetric = await compileFilm(film({ width: 3, height: 3, bloom: 0 }, s => {
            s.add(scalarField(x => x, { x: [-100, 100], y: [0, 1], domain: [-100, 100], scale: 'symlog', colors: ['#000000', '#ff0000', '#ffffff'], width: 3, height: 3, resolution: 3 }))
            s.wait(1)
        }))
        expect(new Resvg(frameToSvg(symmetric.frame(0))).render().pixels).toEqual(pixels)
    })

    it('samples finite extreme domains without overflowing intermediate grid coordinates', async () => {
        const seen: number[] = []
        const compiled = await compileFilm(film(s => {
            s.add(scalarField(x => { seen.push(x); return x / 1e308 }, { ...options, x: [0, 1e308], domain: [0, 1], resolution: [5, 2] }))
            s.wait(1)
        }))
        compiled.frame(0)
        expect(seen.every(Number.isFinite)).toBe(true)
        expect(new Set(seen)).toEqual(new Set([0, 2.5e307, 5e307, 7.5e307, 1e308]))
    })
})
