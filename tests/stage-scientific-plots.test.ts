import { describe, expect, it } from 'vitest'
import { axes } from '../src/stage/objects'
import { areaUnder, band, riemann } from '../src/stage/objects/math'
import { contourPaths } from '../src/stage/contours'
import { colorBar } from '../src/stage/color-bar'
import { sampleStops, type LinearGradient } from '../src/stage/color'
import { formatAxisTick, scaleMapping, type AxisScale } from '../src/stage/scales'
import { curveThrough, parametricPath, pathBounds, type Path, type Vec } from '../src/stage/geometry'
import { parametric } from '../src/stage/shapes'
import { group } from '../src/stage/node'
import { draw } from '../src/stage/anim'
import { linear } from '../src/stage/ease'
import type { Node } from '../src/stage/node'
import { at, compile, expectPure } from './helpers/stage-objects'

const anchors = (path: Path): Vec[][] => path.map(({ p }) => Array.from({ length: (p.length - 2) / 6 + 1 }, (_, i) => [p[i * 6], p[i * 6 + 1]]))
const segments = (path: Path) => path.reduce((sum, ring) => sum + (ring.p.length - 2) / 6, 0)
const expectPoint = (point: Vec, expected: Vec) => point.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(Math.max(1, Math.abs(expected[i])) * 1e-12))

describe('scientific axis scales', () => {
    it.each<[AxisScale, [number, number], number[]]>([
        ['linear', [-20, 60], [-20, 0, 13, 60]],
        ['log', [1e-6, 1e6], [1e-6, 0.01, 1, 1000, 1e6]],
        [{ type: 'log', base: 2 }, [1, 1024], [1, 2, 32, 1024]],
        [{ type: 'symlog', constant: 0.5 }, [-100, 100], [-100, -2, -1e-6, 0, 1e-6, 2, 100]],
    ])('round trips %j in local and transformed world coordinates', (scale, domain, values) => {
        const ax = axes({ x: domain, y: domain, xScale: scale, yScale: scale, width: 800, height: 300, labels: false }).at(10, 50).rotate(0.3)
        group(ax).at(-30, 20).scale([1.7, 0.6]).rotate(-0.7)
        for (const value of values) {
            expectPoint(ax.coords(...ax.p(value, value)), [value, value])
            expectPoint(ax.fromWorld(...ax.world(value, value)), [value, value])
        }
        expectPoint(ax.p(domain[0], domain[0]), [-400, 150])
        expectPoint(ax.p(domain[1], domain[1]), [400, -150])
    })

    it('uses log decade spacing and a symmetric, continuous symlog center', () => {
        const log = scaleMapping([1, 1000], 'log')
        expect(log.map(10)).toBeCloseTo(1 / 3)
        expect(log.map(100)).toBeCloseTo(2 / 3)
        expect(log.ticks()).toEqual([1, 10, 100, 1000])
        expect(scaleMapping([1, 64], { type: 'log', base: 2 }).ticks()).toEqual([1, 2, 4, 8, 16, 32, 64])
        const sym = scaleMapping([-100, 100], { type: 'symlog', constant: 2 })
        expect(sym.map(0)).toBe(0.5)
        for (const v of [1e-9, 0.1, 2, 20]) expect(sym.map(v) + sym.map(-v)).toBeCloseTo(1, 14)
        expect(sym.ticks()).toContain(0)
        expect(sym.ticks()).toEqual(sym.ticks().map((v) => -v).reverse().map((v) => v === 0 ? 0 : v))
    })

    it('keeps small ticks distinct and large values compact', () => {
        const tiny = scaleMapping([0, 1e-6]).ticks()
        expect(tiny.length).toBeGreaterThan(3)
        expect(new Set(tiny.map(formatAxisTick)).size).toBe(tiny.length)
        expect(formatAxisTick(1e-7)).toBe('1\\times 10^{-7}')
        expect(formatAxisTick(1e7)).toBe('1\\times 10^{7}')
        expect(formatAxisTick(0.1 + 0.2)).toBe('0.3')
        expect(formatAxisTick(-0)).toBe('0')
        const offset = scaleMapping([1e15, 1e15 + 10]).ticks()
        expect(offset).toHaveLength(11)
        expect(new Set(offset.map((v) => formatAxisTick(v, 1))).size).toBe(offset.length)
        expect(scaleMapping([-1, 100], 'symlog').ticks()).toContain(0)
        const tinyAxes = axes({ labels: false }).scale(1e-7)
        expectPoint(tinyAxes.fromWorld(...tinyAxes.world(1, 2)), [1, 2])
    })

    it('feeds explicit data ticks to custom TeX formatters and follows changing domains', async () => {
        const seen: number[] = []
        await compile((s) => {
            s.add(axes({ x: [1, 100], y: [0, 1], xScale: 'log', xTicks: [100, 10, 1, 0, 1000, 10], yTicks: [], xFormat: (v) => { seen.push(v); return `${v}` } }))
            s.wait(0.1)
        })
        expect([...new Set(seen)]).toEqual([1, 10, 100])
        let range: readonly [number, number] = [1, 100]
        const ax = axes({ x: () => range, xScale: 'log', y: [0, 1], labels: false })
        expect(ax.p(10, 0.5)[0]).toBeCloseTo(0)
        range = [10, 1000]
        expect(ax.p(100, 0.5)[0]).toBeCloseTo(0)
        expectPoint(ax.coords(...ax.p(50, 0.2)), [50, 0.2])
        range = [0, 100]
        expect(() => ax.p(1, 0)).toThrow('a log domain must be positive')
    })

    it('rejects invalid domains, transforms and tick steps instead of producing invalid geometry', () => {
        expect(() => axes({ x: [0, 100], xScale: 'log', labels: false })).toThrow('a log domain must be positive')
        expect(() => axes({ x: [2, 2], labels: false })).toThrow('finite increasing ends')
        expect(() => axes({ x: [0, Infinity], labels: false })).toThrow('finite increasing ends')
        expect(() => axes({ xStep: 0, labels: false })).toThrow('tick step')
        expect(() => axes({ xScale: { type: 'symlog', constant: 0 }, labels: false })).toThrow('symlog constant')
        expect(() => scaleMapping([1, 10], { type: 'log', base: 1 })).toThrow('log base')
        const ax = axes({ labels: false }).scale([0, 1])
        expect(() => ax.fromWorld(0, 0)).toThrow('singular')
    })

    it('preserves integer differences in narrow nonlinear domains and spans hundreds of decades', () => {
        for (const type of ['log', 'symlog'] as const) for (const low of type === 'log' ? [1e15] : [1e15, -1e15]) {
            const high = low + 10, scale = scaleMapping([low, high], type)
            expect(scale.ticks().length).toBeGreaterThanOrEqual(6)
            for (let i = 0; i <= 10; i++) {
                expect(scale.map(low + i)).toBeCloseTo(i / 10, 13)
                expect(scale.invert(scale.map(low + i))).toBe(low + i)
            }
        }
        const wide = scaleMapping([1e-300, 1e300], 'log')
        for (const value of [1e-300, 1e-150, 1, 1e150, 1e300]) {
            expect(Math.abs(wide.invert(wide.map(value)) / value - 1)).toBeLessThan(1e-12)
        }
        expect(wide.map(0)).toBeNaN()
    })
})

describe('areas on scientific axes', () => {
    it.each([false, true])('rejects zero-baseline helpers on logarithmic y axes (moving %s)', (moving) => {
        const ax = axes({ x: [1, 10], y: moving ? () => [1, 100] : [1, 100], yScale: 'log', labels: false })
        expect(() => areaUnder(ax, () => 10)).toThrow('areaUnder: a zero baseline is undefined on a logarithmic y axis. Use areaUnder with a positive over curve, or band with two positive curves.')
        expect(() => riemann(ax, () => 10)).toThrow('riemann: a zero baseline is undefined on a logarithmic y axis. Use areaUnder with a positive over curve, or band with two positive curves.')
    })

    it('keeps positive logarithmic bands finite and maps their edges to the same domain', () => {
        const ax = axes({ x: [1, 10], y: [1, 100], yScale: { type: 'log', base: 10 }, width: 900, height: 400, labels: false })
        const under = areaUnder(ax, () => 100, { over: () => 10 }).get('path')!
        const between = band(ax, () => 10, () => 100).get('path')!
        expect(under).toEqual(between)
        expect(between).toHaveLength(1)
        expect(between[0].closed).toBe(true)
        expect([...between[0].p].every(Number.isFinite)).toBe(true)
        expect(pathBounds(between)).toEqual({ x: -450, y: -200, width: 900, height: 200 })
    })

    it.each<AxisScale>(['linear', 'symlog'])('preserves finite zero-baseline area and rectangles on %s axes', (yScale) => {
        const ax = axes({ x: [1, 3], y: [-1, 10], yScale, labels: false })
        const area = areaUnder(ax, () => 4).get('path')!
        expect(area).toHaveLength(1)
        expect([...area[0].p].every(Number.isFinite)).toBe(true)
        expect(anchors(area)[0]).toContainEqual(ax.p(3, 0))
        const sum = riemann(ax, () => 4, { n: 2 })
        expect(sum.children).toHaveLength(2)
        for (const leaf of sum.children) {
            expect(leaf.get('path')!.every((ring) => [...ring.p].every(Number.isFinite))).toBe(true)
            const bounds = leaf.bounds()
            expect(bounds.y + bounds.height).toBeCloseTo(ax.p(1, 0)[1], 10)
        }
    })
})

describe('adaptive function plotting', () => {
    it('preserves the default uniform spline and series geometry', () => {
        const ax = axes({ x: [-1, 1], y: [-1, 1], labels: false })
        const points = Array.from({ length: 9 }, (_, i) => { const x = -1 + i / 4; return ax.p(x, x * x) })
        expect(ax.plotPath((x) => x * x, { samples: 8 })).toEqual(curveThrough(points))
        const data: Vec[] = [[-1, 0], [0.2, 0.8], [1, 0.1]]
        expect(anchors(ax.plotPath(data, { adaptive: true }))).toEqual([data.map(([x, y]) => ax.p(x, y))])
    })

    it('retains reverse parameter order for uniform function plots', () => {
        const ax = axes({ x: [-1, 1], y: [-1, 1], labels: false })
        const points = Array.from({ length: 9 }, (_, i) => { const x = 1 - i / 4; return ax.p(x, x * x) })
        expect(ax.plotPath((x) => x * x, { from: 1, to: -1, samples: 8 })).toEqual(curveThrough(points))
    })

    it('meets pixel error on a parabola and refines more at larger screen scale', () => {
        const ax = axes({ x: [-2, 2], y: [0, 4], width: 800, height: 400, labels: false })
        const coarse = ax.plotPath((x) => x * x, { samples: 2, adaptive: { tolerance: 2 } })
        const fine = ax.plotPath((x) => x * x, { samples: 2, adaptive: { tolerance: 0.25 } })
        expect(segments(fine)).toBeGreaterThan(segments(coarse))
        for (const points of anchors(fine)) for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i]
            for (const t of [0.2, 0.5, 0.8]) {
                const px = a[0] + (b[0] - a[0]) * t, py = a[1] + (b[1] - a[1]) * t
                const x = ax.coords(px, py)[0]
                expect(Math.abs(py - ax.p(x, x * x)[1])).toBeLessThanOrEqual(0.25 + 1e-9)
            }
        }
        ax.scale(4)
        expect(segments(ax.plotPath((x) => x * x, { samples: 2, adaptive: { tolerance: 0.25 } }))).toBeGreaterThan(segments(fine))
    })

    it('samples evenly in mapped x coordinates across nine decades', () => {
        const ax = axes({ x: [1, 1e9], y: [0, 9], xScale: 'log', width: 900, height: 450, labels: false })
        const path = ax.plotPath(Math.log10, { samples: 3, adaptive: true })
        expect(segments(path)).toBe(3)
        const points = anchors(path)[0]
        expectPoint(points[1], [-150, 75])
        expectPoint(points[2], [150, -75])
        const semi = axes({ x: [0, 9], y: [1, 1e9], yScale: 'log', labels: false })
        expect(segments(semi.plotPath((x) => 10 ** x, { samples: 3, adaptive: true }))).toBe(3)
    })

    it.each([false, true])('does not sample or bridge explicit excluded intervals (adaptive %s)', (adaptive) => {
        const ax = axes({ x: [-1, 1], y: [-1, 1], labels: false })
        const path = ax.plotPath((x) => {
            if (x === 0 || (x >= 0.2 && x <= 0.4)) throw new Error('sampled an excluded interval')
            return x
        }, { adaptive, discontinuities: [[0.3, 0.4], [0, 0], [0.2, 0.35]] })
        const runs = anchors(path)
        expect(runs).toHaveLength(3)
        expect(runs.map((run) => run.map((p) => ax.coords(...p)[0]))).toSatisfy((parts: number[][]) => parts[0].every((x) => x < 0) && parts[1].every((x) => x > 0 && x < 0.2) && parts[2].every((x) => x > 0.4))
    })

    it('splits nonfinite holes, poles and unresolved finite jumps', () => {
        const ax = axes({ x: [-1, 1], y: [-2, 2], width: 800, height: 400, labels: false })
        const hole = ax.plotPath((x) => Math.abs(x) < 0.1 ? NaN : x, { adaptive: true })
        expect(hole).toHaveLength(2)
        const pole = ax.plotPath((x) => 0.2 / x, { adaptive: true })
        expect(pole).toHaveLength(2)
        for (const run of anchors(pole)) expect(run.every((p) => p[0] < 0) || run.every((p) => p[0] > 0)).toBe(true)
        const step = ax.plotPath((x) => x < 0.123 ? -1 : 1, { adaptive: true })
        expect(step).toHaveLength(2)
        for (const run of anchors(step)) expect(new Set(run.map((p) => p[1])).size).toBe(1)
        for (const path of [hole, pole, step]) for (const ring of path) expect([...ring.p].every(Number.isFinite)).toBe(true)
    })

    it('clips steep continuous lines at the visible boundary and limits evaluations', () => {
        const ax = axes({ x: [-1, 1], y: [-1, 1], width: 800, height: 400, labels: false })
        const steep = ax.plotPath((x) => 100 * x, { adaptive: true })
        expect(steep).toHaveLength(1)
        expect(pathBounds(steep)).toEqual({ x: -4, y: -200, width: 8, height: 400 })
        let calls = 0
        const path = ax.plotPath((x) => { calls++; return Math.sin(1000 * x) }, { adaptive: { maxSamples: 60, tolerance: 0.01 } })
        expect(calls).toBeLessThanOrEqual(60)
        for (const ring of path) expect([...ring.p].every(Number.isFinite)).toBe(true)
    })

    it('traces fixed adaptive plots and deterministically rebuilds moving domains', async () => {
        let curve!: Node, moving!: Node
        const film = await compile((s) => {
            const range = s.value(1)
            const fixed = s.add(axes({ x: [-1, 1], y: [-1, 1], labels: false }))
            curve = fixed.plot((x) => x * x, { adaptive: true })
            const ax = s.add(axes({ x: () => [range.value, range.value * 100], y: [0, 4], xScale: 'log', labels: false }))
            moving = ax.plot(Math.log10, { adaptive: true, samples: 4 })
            s.play(draw(curve), range.to(10), { duration: 1, ease: linear })
            s.wait(0.1)
        })
        expect(curve.draw).toBeNull()
        expect(curve.get('path')!.length).toBeGreaterThan(0)
        expect(moving.draw).not.toBeNull()
        const built = at(0.5, () => moving.draw!(0.5)) as Node
        expect(segments(built.get('path')!)).toBe(4)
        expectPure(film, [0, 0.25, 0.5, 1])
    })
})

describe('adaptive parametric curves', () => {
    it('preserves the default uniform spline, including reversed parameter order', () => {
        const f = (t: number): Vec => [80 * Math.cos(t), 120 * Math.sin(2 * t)]
        for (const [from, to] of [[0, 2 * Math.PI], [2 * Math.PI, 0]]) {
            expect(parametric(f, from, to).get('path')).toEqual(parametricPath(f, from, to, 96))
            expect(parametric(f, from, to, { samples: 8, adaptive: false }).get('path')).toEqual(parametricPath(f, from, to, 8))
        }
    })

    it('bounds the chord error of a loop in local pixels without spline overshoot', () => {
        const circle = (t: number): Vec => [100 * Math.cos(t), 100 * Math.sin(t)]
        const coarse = parametric(circle, 0, 2 * Math.PI, { samples: 4, adaptive: { tolerance: 2 } }).get('path')!
        const fine = parametric(circle, 0, 2 * Math.PI, { samples: 4, adaptive: { tolerance: 0.25 } }).get('path')!
        expect(fine).toHaveLength(1)
        expect(segments(fine)).toBeGreaterThan(segments(coarse))
        const points = anchors(fine)[0]
        expectPoint(points[0], points.at(-1)!)
        for (let i = 1; i < points.length; i++) {
            const a = points[i - 1], b = points[i]
            expect(Math.abs(Math.hypot(...a) - 100)).toBeLessThan(1e-10)
            expect(100 - Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)).toBeLessThanOrEqual(0.25)
        }
        const ring = fine[0].p
        for (let i = 0; i + 7 < ring.length; i += 6) for (let k = 1; k <= 3; k++) {
            expectPoint([ring[i + 2 * k], ring[i + 2 * k + 1]], [ring[i] + (ring[i + 6] - ring[i]) * k / 3, ring[i + 1] + (ring[i + 7] - ring[i + 1]) * k / 3])
        }
    })

    it('matches axes refinement in the same coordinates and leaves parametric geometry unclipped', () => {
        const ax = axes({ x: [-1, 1], y: [-1, 1], width: 400, height: 200, labels: false })
        const options = { samples: 2, adaptive: { tolerance: 0.3 } }
        const plot = anchors(ax.plotPath((x) => x * x, options))
        const curve = anchors(parametric((t) => ax.p(t, t * t), -1, 1, options).get('path')!)
        expect(curve.map((run) => run.length)).toEqual(plot.map((run) => run.length))
        curve.forEach((run, i) => run.forEach((point, j) => expectPoint(point, plot[i][j])))
        const steep = parametric((t) => ax.p(t, 100 * t), -1, 1, options).get('path')!
        expect(pathBounds(steep)).toEqual({ x: -200, y: -10000, width: 400, height: 20000 })
    })

    it.each([false, true])('excludes parameter intervals in both directions without sampling them (adaptive %s)', (adaptive) => {
        const f = (t: number): Vec => {
            if (t === 0 || (t >= 0.2 && t <= 0.4)) throw new Error('sampled an excluded interval')
            return [100 * t, 100 * t * t]
        }
        const options = { adaptive, discontinuities: [[0.3, 0.4], [0, 0], [0.2, 0.35]] as const }
        for (const [from, to] of [[-1, 1], [1, -1]]) {
            const runs = anchors(parametric(f, from, to, options).get('path')!)
            expect(runs).toHaveLength(3)
            const ordered = from < to ? runs : [...runs].reverse().map((run) => [...run].reverse())
            expect(ordered[0].every(([x]) => x < 0)).toBe(true)
            expect(ordered[1].every(([x]) => x > 0 && x < 20)).toBe(true)
            expect(ordered[2].every(([x]) => x > 40)).toBe(true)
            for (const run of runs) for (let i = 1; i < run.length; i++) expect((run[i][0] - run[i - 1][0]) * (to - from)).toBeGreaterThanOrEqual(0)
        }
    })

    it('splits nonfinite coordinates, poles, and finite jumps on either coordinate', () => {
        const cases: ((t: number) => Vec)[] = [
            (t) => [Math.abs(t) < 0.1 ? NaN : 100 * t, 100 * t],
            (t) => [100 * t, 1 / t],
            (t) => [100 * t, t < 0.123 ? -100 : 100],
            (t) => [t < 0.123 ? -100 : 100, 100 * t],
        ]
        for (const [index, f] of cases.entries()) {
            const path = parametric(f, -1, 1, { adaptive: true }).get('path')!
            expect(path).toHaveLength(2)
            for (const ring of path) expect([...ring.p].every(Number.isFinite)).toBe(true)
            for (const run of anchors(path)) {
                const coordinate = index === 2 ? 1 : 0
                expect(run.every((p) => p[coordinate] < 0) || run.every((p) => p[coordinate] > 0)).toBe(true)
            }
        }
    })

    it('bounds evaluations across all spans and leaves unresolved intervals open', () => {
        let calls = 0
        const f = (t: number): Vec => { calls++; return [100 * t, 100 * Math.sin(31 * t)] }
        const exhausted = parametric(f, -1, 1, { samples: 1, adaptive: { tolerance: 0.001, maxSamples: 5 } }).get('path')!
        expect(calls).toBe(5)
        expect(exhausted).toEqual([])
        calls = 0
        const limited = parametric(f, -1, 1, { adaptive: { tolerance: 0.01, maxSamples: 60 }, discontinuities: [[0, 0]] }).get('path')!
        expect(calls).toBeLessThanOrEqual(60)
        for (const ring of limited) expect([...ring.p].every(Number.isFinite)).toBe(true)
        expect(() => parametric(f, 0, 1, { adaptive: { maxSamples: 4 } })).toThrow('maxSamples')
        expect(() => parametric(f, 0, 1, { adaptive: { maxDepth: 25 } })).toThrow('maxDepth')
        expect(() => parametric(f, 0, 1, { adaptive: { tolerance: 0 } })).toThrow('tolerance')
    })
})

describe('reusable scalar contours', () => {
    it('interpolates and stitches an affine level set on a rectangular mathematical domain', () => {
        let calls = 0
        const levels = contourPaths((x, y) => { calls++; return 2 * x + y }, { x: [-2, 3], y: [-4, 6], levels: [0, 2], resolution: [20, 12] })
        expect(calls).toBe(21 * 13)
        expect(levels.map((c) => c.level)).toEqual([0, 2])
        for (const contour of levels) {
            expect(contour.paths).toHaveLength(1)
            for (const [x, y] of contour.paths[0]) expect(2 * x + y).toBeCloseTo(contour.level, 11)
            const [first, last] = [contour.paths[0][0], contour.paths[0].at(-1)!]
            expect(first.some((v, i) => v === (i === 0 ? -2 : -4) || v === (i === 0 ? 3 : 6))).toBe(true)
            expect(last.some((v, i) => v === (i === 0 ? -2 : -4) || v === (i === 0 ? 3 : 6))).toBe(true)
        }
    })

    it('returns a single closed circle with grid-level interpolation accuracy', () => {
        const [{ paths }] = contourPaths((x, y) => x * x + y * y, { x: [-2, 2], y: [-2, 2], levels: [1], resolution: 80 })
        expect(paths).toHaveLength(1)
        expect(paths[0][0]).toEqual(paths[0].at(-1))
        expect(paths[0].length).toBeGreaterThan(100)
        for (const [x, y] of paths[0]) expect(Math.abs(x * x + y * y - 1)).toBeLessThan(0.001)
    })

    it('chooses saddle connectivity from bilinear values, not the arithmetic center', () => {
        const run = (values: number[]) => contourPaths((x, y) => values[0] * (1 - x) * (1 - y) + values[1] * x * (1 - y) + values[2] * x * y + values[3] * (1 - x) * y,
            { x: [0, 1], y: [0, 1], levels: [0], resolution: 1 })[0].paths
        const edge = ([x, y]: Vec) => y === 0 ? 0 : x === 1 ? 1 : y === 1 ? 2 : 3
        const pairs = (paths: Vec[][]) => paths.map((p) => [edge(p[0]), edge(p.at(-1)!)].sort().join('-')).sort()
        // Positive mean, negative ac-bd: a center-value heuristic would join the wrong regions.
        expect(pairs(run([10, -4, 1, -4]))).toEqual(['0-3', '1-2'])
        expect(pairs(run([4, -10, 4, -1]))).toEqual(['0-1', '2-3'])
        expect(pairs(run([-10, 4, -1, 4]))).toEqual(['0-3', '1-2'])
    })

    it('retains both crossing branches at an exact saddle', () => {
        const [{ paths }] = contourPaths((x, y) => (x - 0.5) * (y - 0.5), { x: [0, 1], y: [0, 1], levels: [0], resolution: 1 })
        expect(paths).toHaveLength(2)
        for (const path of paths) {
            expect(path).toContainEqual([0.5, 0.5])
            expect(path.every(([x]) => x === 0.5) || path.every(([, y]) => y === 0.5)).toBe(true)
        }
    })

    it('preserves zero edges and branches when a saddle lies on a grid vertex', () => {
        const [{ paths }] = contourPaths((x, y) => x * y, { x: [-1, 1], y: [-1, 1], levels: [0], resolution: 2 })
        expect(paths).toHaveLength(4)
        for (const path of paths) {
            expect(path).toContainEqual([0, 0])
            expect(path.every(([x]) => x === 0) || path.every(([, y]) => y === 0)).toBe(true)
        }
        const branched = contourPaths((x, y) => (x - 0.3) * y, { x: [0, 1], y: [-1, 1], levels: [0], resolution: [1, 2] })[0].paths
        expect(branched).toHaveLength(4)
        for (const path of branched) for (const [x, y] of path) expect((x - 0.3) * y).toBeCloseTo(0, 14)
    })

    it('keeps grid samples finite on very large finite coordinate domains', () => {
        const sampled: number[] = []
        const [{ paths }] = contourPaths((x) => { sampled.push(x); return x }, { x: [0, 1e308], y: [0, 1], levels: [5e307], resolution: 4 })
        expect(sampled.every(Number.isFinite)).toBe(true)
        expect(paths).toHaveLength(1)
        expect(paths[0][0]).toEqual([5e307, 0])
        expect(paths[0].at(-1)).toEqual([5e307, 1])
    })

    it('preserves level interpolation with a large scalar offset', () => {
        const [{ paths }] = contourPaths((x, y) => 1e15 + 8 * x + 4 * y, { x: [0, 1], y: [0, 1], levels: [1e15 + 3], resolution: 1 })
        expect(paths).toHaveLength(1)
        for (const [x, y] of paths[0]) expect(8 * x + 4 * y).toBeCloseTo(3, 13)
    })

    it('leaves holes at missing samples and handles exact grid-vertex levels without zero segments', () => {
        const [{ paths }] = contourPaths((x, y) => Math.abs(y) < 0.2 ? NaN : x, { x: [-1, 1], y: [-1, 1], levels: [0], resolution: 20 })
        expect(paths).toHaveLength(2)
        for (const path of paths) {
            expect(path.every(([, y]) => y <= -0.2) || path.every(([, y]) => y >= 0.2)).toBe(true)
            for (let i = 1; i < path.length; i++) expect(path[i]).not.toEqual(path[i - 1])
            for (const [x] of path) expect(x).toBe(0)
        }
        expect(contourPaths(() => 2, { x: [0, 1], y: [0, 1], levels: [1, 2, 3] }).every((v) => v.paths.length === 0)).toBe(true)
    })

    it('rejects invalid input without evaluating a field', () => {
        const field = () => { throw new Error('unexpected evaluation') }
        expect(() => contourPaths(field, { x: [1, 0], y: [0, 1], levels: [0] })).toThrow('finite increasing ends')
        expect(() => contourPaths(field, { x: [0, 1], y: [0, 1], levels: [NaN] })).toThrow('levels must be finite')
        expect(() => contourPaths(field, { x: [0, 1], y: [0, 1], levels: [0], resolution: 0 })).toThrow('positive integer')
        expect(contourPaths(field, { x: [0, 1], y: [0, 1], levels: [] })).toEqual([])
    })
})

describe('fixed numeric color bars', () => {
    it.each<[AxisScale, [number, number], number]>([
        ['linear', [0, 100], 50], ['log', [1, 10000], 100], ['symlog', [-100, 100], 0],
    ])('aligns %j tick values with the fixed color ramp', async (scale, domain, middle) => {
        let bar!: Node
        await compile((s) => {
            bar = s.add(colorBar({ domain, colors: ['#000000', '#ff0000', '#ffffff'], scale, ticks: [domain[0], middle, domain[1]], width: 400 }))
            s.wait(0.1)
        })
        const ramp = bar.children[0].get('fill') as LinearGradient
        expect(ramp.from).toEqual([-200, 0])
        expect(ramp.to).toEqual([200, 0])
        expect(sampleStops(ramp.stops, scaleMapping(domain, scale).map(middle))).toEqual([255, 0, 0, 1])
        expect(bar.children.filter((_, i) => i > 0 && i % 2 === 1).map((tick) => pathBounds(tick.get('path')!)!.x)).toEqual([-200, 0, 200])
    })

    it('runs upward in vertical mode and leaves room between automatic labels', async () => {
        let vertical!: Node, small!: Node
        await compile((s) => {
            vertical = s.add(colorBar({ domain: [0, 1], colors: ['blue', 'yellow'], vertical: true, height: 300, ticks: [0, 0.5, 1], label: 'Probability' }))
            small = s.add(colorBar({ domain: [0, 1e-6], colors: ['blue', 'yellow'], width: 400 }))
            s.wait(0.1)
        })
        const ramp = vertical.children[0].get('fill') as LinearGradient
        expect(ramp.from).toEqual([0, 150])
        expect(ramp.to).toEqual([0, -150])
        expect(vertical.children.filter((_, i) => i > 0 && i < 7 && i % 2 === 1).map((tick) => pathBounds(tick.get('path')!)!.y)).toEqual([150, 0, -150])
        const labels = small.children.filter((_, i) => i > 0 && i % 2 === 0).map((n) => n.bounds())
        expect(labels.length).toBeGreaterThanOrEqual(2)
        expect(labels.length).toBeLessThan(11)
        for (let i = 1; i < labels.length; i++) expect(labels[i].x - labels[i - 1].x - labels[i - 1].width).toBeGreaterThanOrEqual(8 - 1e-9)
    })
})
