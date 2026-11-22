import { describe, expect, it } from 'vitest'
import { Resvg } from '@resvg/resvg-js'
import { compileFilm, film, frameToSvg } from '../src/stage/index'
import { isosurface, type IsosurfaceGeometry, type IsosurfaceOptions } from '../src/stage/three/implicit'
import { scene3d, View3D } from '../src/stage/three/index'

const box = { x: [-1.4, 1.4], y: [-1.4, 1.4], z: [-1.4, 1.4] } as const
const squaredRadius = (x: number, y: number, z: number) => x * x + y * y + z * z

function camera(): View3D {
    const view = new View3D()
    view.rx = 1
    view.uy = 1
    view.dz = 1
    view.perspective = false
    return view
}

function expectClosed(geometry: IsosurfaceGeometry): void {
    const edges = new Map<string, { count: number; orientation: number }>()
    const used = new Set<number>()
    for (const triangle of geometry.triangles) {
        for (let i = 0; i < 3; i++) {
            const a = triangle[i], b = triangle[(i + 1) % 3]
            used.add(a)
            const key = a < b ? `${a}:${b}` : `${b}:${a}`
            const edge = edges.get(key) ?? { count: 0, orientation: 0 }
            edge.count++
            edge.orientation += a < b ? 1 : -1
            edges.set(key, edge)
        }
    }
    expect([...edges.values()].every(({ count, orientation }) => count === 2 && orientation === 0)).toBe(true)
    expect(used.size - edges.size + geometry.triangles.length).toBe(2)
}

describe('CPU implicit surfaces', () => {
    it('approximates analytic sphere levels with outward normals and a closed shared-edge mesh', () => {
        const sphere = isosurface(squaredRadius, { ...box, level: 1, resolution: 24 })
        const geometry = sphere.geometry
        expect(geometry.triangles.length).toBeGreaterThan(1000)
        for (let i = 0; i < geometry.positions.length; i++) {
            const p = geometry.positions[i], n = geometry.normals[i], r = Math.hypot(...p)
            expect(Math.abs(r - 1)).toBeLessThan(0.006)
            expect(Math.hypot(...n)).toBeCloseTo(1, 12)
            expect((p[0] * n[0] + p[1] * n[1] + p[2] * n[2]) / r).toBeGreaterThan(0.98)
        }
        expectClosed(geometry)
        const smaller = isosurface(squaredRadius, { ...box, level: 0.25, resolution: 24 }).geometry
        expect(Math.max(...smaller.positions.map((p) => Math.hypot(...p)))).toBeCloseTo(0.5, 2)
        expect(smaller).not.toBe(geometry)
    })

    it('welds exact grid-vertex crossings and orients density lobes toward decreasing values', () => {
        const exact = isosurface(squaredRadius, { x: [-1, 1], y: [-1, 1], z: [-1, 1], level: 0.25, resolution: 8 }).geometry
        expectClosed(exact)
        const density = isosurface((x, y, z) => Math.exp(-squaredRadius(x, y, z)), {
            ...box, level: Math.exp(-1), normals: 'decreasing', resolution: 16,
        }).geometry
        for (let i = 0; i < density.positions.length; i++) {
            const p = density.positions[i], n = density.normals[i]
            expect(p[0] * n[0] + p[1] * n[1] + p[2] * n[2]).toBeGreaterThan(0.95)
        }
        expectClosed(density)
    })

    it('converges under refinement and produces no geometry for a constant or absent level', () => {
        const error = (resolution: number) => {
            const mesh = isosurface(squaredRadius, { ...box, level: 1, resolution }).geometry
            return Math.max(...mesh.positions.map((p) => Math.abs(Math.hypot(...p) - 1)))
        }
        expect(error(12) / error(24)).toBeGreaterThan(3)
        expect(isosurface(() => 1, { ...box, level: 1 }).geometry.triangles).toEqual([])
        expect(isosurface(squaredRadius, { ...box, level: -1 }).geometry.triangles).toEqual([])
    })

    it('interpolates small offsets from a large level and handles offset overflow', () => {
        const options = { x: [0, 1], y: [0, 1], z: [0, 1], resolution: 1 } as const
        const shifted = isosurface((x) => 1e16 + 6 * x, { ...options, level: 1e16 + 2 }).geometry
        expect(shifted.positions.length).toBeGreaterThan(0)
        for (const [x] of shifted.positions) expect(x).toBeCloseTo(1 / 3, 14)
        const extreme = isosurface((x) => Number.MAX_VALUE * (2 * x - 1), { ...options, level: Number.MAX_VALUE / 2 }).geometry
        for (const [x] of extreme.positions) expect(x).toBeCloseTo(0.75, 14)
    })

    it('covers raster seams between acute triangles on an opaque planar surface', () => {
        const surface = isosurface((x, y, z) => x + y + z, {
            x: [-1, 1], y: [-1, 1], z: [-1, 1], level: 0.001,
            resolution: 24, shaded: false, color: '#ff0000',
        })
        const view = camera()
        view.unit = 180
        view.matrix = [1, 0, 0, 1, 256, 256]
        surface.emit(view, 0)
        const svg = frameToSvg({ width: 512, height: 512, ops: view.ops, background: '#ffffff', bloom: 0, dark: false })
        const pixels = new Resvg(svg, { font: { loadSystemFonts: false } }).render().pixels
        let seams = 0
        for (let y = 190; y <= 320; y++) for (let x = 190; x <= 320; x++) {
            if (pixels[(y * 512 + x) * 4 + 1] > 12) seams++
        }
        expect(seams).toBe(0)
    })

    it('culls using oriented geometric normals and keeps lighting, alpha, fog, and depth', () => {
        const surface = isosurface(squaredRadius, { ...box, level: 1, resolution: 12, cull: true, color: '#4488ff', opacity: 0.6 })
        const front = camera()
        front.fog = 0.5
        surface.emit(front, 0)
        expect(front.ops.length).toBeGreaterThan(100)
        expect(front.depths.every((z) => z > -0.12)).toBe(true)
        expect(front.ops.every((op) => op.fillAlpha === 0.6)).toBe(true)
        expect(new Set(front.ops.map((op) => JSON.stringify(op.fill))).size).toBeGreaterThan(20)
        const back = camera()
        back.dz = -1
        surface.emit(back, 10)
        expect(back.ops.length).toBe(front.ops.length)
        const inside = camera()
        inside.perspective = true
        inside.distance = 0.5
        surface.emit(inside, 0)
        expect(inside.ops).toEqual([])
    })

    it('clips triangles that cross the camera near plane and respects reveal', () => {
        const plane = isosurface((x) => x, { ...box, resolution: [1, 1, 1], opacity: 0.5 })
        const view = camera()
        view.perspective = true
        view.distance = 0.5
        plane.emit(view, 0)
        expect(view.ops.length).toBeGreaterThan(0)
        expect(view.ops.every((op) => op.path.every((ring) => [...ring.p].every(Number.isFinite)))).toBe(true)
        expect(view.depths.every((z) => z < 0.45)).toBe(true)
        plane.set('trimTo', 0)
        const hidden = camera()
        plane.emit(hidden, 0)
        expect(hidden.ops).toEqual([])
        hidden.measuring = true
        plane.emit(hidden, 0)
        expect(hidden.ops.length).toBeGreaterThan(0)
    })

    it('renders through Scene3D into SVG with stable frames when scrubbing', async () => {
        const compiled = await compileFilm(film((s) => {
            const scene = s.add(scene3d({ perspective: false, fog: 0 }))
            scene.add(isosurface(squaredRadius, { ...box, level: 1, resolution: 8, cull: true, mesh: '#fff' }))
            s.wait(2)
        }))
        const first = frameToSvg(compiled.frame(0.25))
        compiled.frame(1.5)
        expect(frameToSvg(compiled.frame(0.25))).toBe(first)
        expect(first).toContain('<path')
        expect(first).not.toMatch(/NaN|Infinity/)
    })

    it('enforces finite domains, bounded sampling and finite field values', () => {
        let calls = 0
        const field = () => { calls++; return 0 }
        const invalid: Partial<IsosurfaceOptions>[] = [
            { resolution: 65 }, { resolution: 1.5 }, { resolution: [4, 0, 4] },
            { level: NaN }, { x: [1, 1] }, { y: [-Infinity, 1] },
        ]
        for (const options of invalid) expect(() => isosurface(field, { ...box, ...options })).toThrow(RangeError)
        expect(calls).toBe(0)
        expect(() => isosurface(() => NaN, box).geometry).toThrow('field must be finite')
        expect(() => isosurface((x, y, z) => Math.cos(Math.PI * 32 * x) * Math.cos(Math.PI * 32 * y) * Math.cos(Math.PI * 32 * z), {
            x: [0, 1], y: [0, 1], z: [0, 1], resolution: 32,
        }).geometry).toThrow('triangle budget exceeded')
    })

    it('samples once per grid point and caches model geometry within a practical CPU budget', () => {
        let calls = 0
        const started = performance.now()
        const sphere = isosurface((x, y, z) => { calls++; return squaredRadius(x, y, z) }, { ...box, level: 1, resolution: 24, cull: true })
        const first = camera()
        sphere.emit(first, 0)
        expect(calls).toBe(25 ** 3)
        const geometry = sphere.geometry
        for (const t of [3, 1, 0, 3]) sphere.emit(camera(), t)
        expect(sphere.geometry).toBe(geometry)
        expect(calls).toBe(25 ** 3)
        expect(first.ops.length).toBeLessThan(6000)
        expect(performance.now() - started).toBeLessThan(3000)
    })
})
