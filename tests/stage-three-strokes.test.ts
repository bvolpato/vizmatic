import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'
import { frameToSvg, type DrawOp, type Frame } from '../src/stage/display'
import { polyPath } from '../src/stage/geometry'
import { curve3d, line3d, parametricSurface, scene3d, vector3d, type Scene3D } from '../src/stage/three'

function frame(scene: Scene3D, dark: boolean): Frame {
    const ops: DrawOp[] = []
    scene.rawOps!([1, 0, 0, 1, 160, 120], 1, ops)
    return { width: 320, height: 240, ops, dark, bloom: 0, background: dark ? '#101820' : '#f8f6ee' }
}

const pixels = (frame: Frame) => new Resvg(frameToSvg(frame), { font: { loadSystemFonts: false } }).render().pixels
const maxDifference = (a: Uint8Array, b: Uint8Array) => a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i]!)), 0)
const camera = { theta: 0, phi: Math.PI / 2, perspective: false, unit: 100, fog: 0 } as const

describe('continuous 3D strokes', () => {
    it.each([[true, 0], [false, 0], [true, 1], [false, -1]] as const)('rasterizes a subdivided oblique line like one stroke (dark=%s, depth=%s)', (dark, depth) => {
        const render = (pieces: number) => {
            const view = scene3d(camera)
            view.add(line3d([-depth, -1.2, -0.37], [depth, 1.2, 0.37], { color: '#2288dd', width: 5, pieces }))
            return pixels(frame(view, dark))
        }
        const actual = render(14), expected = render(1)
        // Equivalent polyline tessellations can differ slightly at edge pixels.
        expect(maxDifference(actual, expected)).toBeLessThanOrEqual(15)
    })

    it.each([[true, 0], [false, 0], [true, 1], [false, -1]] as const)('keeps a translucent glowing curve uniform through its joins (dark=%s, depth=%s)', (dark, depth) => {
        const view = scene3d(camera)
        view.add(curve3d(t => [depth * t, t, 0.31 * t], -1.2, 1.2, { color: '#2288dd', width: 5, opacity: 0.6, glow: 8, samples: 144 }))
        const actual = frame(view, dark)
        const first = actual.ops.find(op => op.kind === 'path' && op.strokeAlpha > 0)!
        if (first.kind !== 'path') throw new Error('Missing curve')
        const path = polyPath(Array.from({ length: 145 }, (_, i) => {
            const t = -1.2 + 2.4 * i / 144
            return [160 + 100 * t, 120 - 31 * t] as const
        })).map(ring => ({ ...ring, straight: true }))
        const reference = { ...actual, ops: [{ ...first, path, strokePath: path, glow: 8 }] }
        const a = pixels(actual), b = pixels(reference)
        // Subpixel tessellation may differ by a byte. Separate round caps and
        // glow filters produce repeated, much larger bands in the interior.
        expect(maxDifference(a, b)).toBeLessThanOrEqual(2)
    })

    it('joins the vector shaft without filling its space beside the arrowhead', () => {
        const view = scene3d(camera)
        view.add(vector3d([0, -1.2, 0], [0, 1.2, 0], { color: '#2288dd', width: 5, halo: false, tip: 18 }))
        const image = pixels(frame(view, true))
        const at = (x: number, y: number) => Array.from(image.slice((y * 320 + x) * 4, (y * 320 + x + 1) * 4))
        for (let x = 45; x < 250; x++) expect(at(x, 120)).toEqual(at(45, 120))
        expect(at(279, 120)).not.toEqual(at(290, 120))
        expect(at(280, 108)).toEqual(at(290, 120))
    })

    it('retains a surface between the back and front portions of one line', () => {
        const render = (withLine: boolean) => {
            const view = scene3d({ ...camera, ambient: 1, brightness: 1, shine: 0 })
            view.add(parametricSurface((u, v) => [0, u, v], [-0.5, 0.5], [-0.4, 0.4], {
                color: '#dd4422', mesh: false, resolution: [2, 2],
            }))
            if (withLine) view.add(line3d([-1, -1.2, 0], [1, 1.2, 0], { color: '#2288dd', width: 6 }))
            return pixels(frame(view, true))
        }
        const actual = render(true), surface = render(false)
        const at = (image: Uint8Array, x: number) => Array.from(image.slice((120 * 320 + x) * 4, (120 * 320 + x + 1) * 4))
        expect(at(actual, 130)).toEqual(at(surface, 130))
        expect(at(actual, 190)).toEqual([34, 136, 221, 255])
        expect(at(actual, 70)).toEqual([34, 136, 221, 255])
    })

    it.each([true, false])('does not stripe a glowing curve when distant faces split its depth order (dark=%s)', dark => {
        const render = (faces: boolean) => {
            const view = scene3d(camera)
            view.add(curve3d(t => [t, t, 0], -1.2, 1.2, { color: '#2288dd', width: 5, glow: 8, samples: 144 }))
            if (faces) for (const depth of [-1, -0.6, -0.2, 0.2, 0.6, 1]) {
                view.add(parametricSurface((u, v) => [depth, u, v], [-0.1, 0.1], [0.7, 0.9], {
                    color: '#dd4422', mesh: false, resolution: [1, 1],
                }))
            }
            return pixels(frame(view, dark)).subarray(95 * 320 * 4, 145 * 320 * 4)
        }
        expect(maxDifference(render(true), render(false))).toBeLessThanOrEqual(2)
    })

    it('keeps a multicolor curve\'s glow matched to its local palette', () => {
        const view = scene3d(camera)
        view.add(curve3d(t => [0, t, 0], -1.2, 1.2, { colors: ['#ff0000', '#0000ff'], width: 2, glow: 16 }))
        const image = pixels({ ...frame(view, true), background: null })
        // Outside the crisp core: compare the halo itself, not the colored line.
        const left = (114 * 320 + 60) * 4, right = (114 * 320 + 260) * 4
        expect(image[left]).toBeGreaterThan(image[left + 2]! * 2)
        expect(image[right + 2]).toBeGreaterThan(image[right]! * 2)
        expect(image[left + 3]).toBeGreaterThan(5)
        expect(image[right + 3]).toBeGreaterThan(5)
    })
})
