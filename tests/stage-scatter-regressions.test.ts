import { describe, expect, it } from 'vitest'
import { compileFilm, film, group, linear, parseColor, pathBounds, scatter, type CompiledFilm, type Scatter } from '../src/stage/index'
import { clock } from '../src/stage/track'

const frame = { x: [0, 10] as const, y: [0, 10] as const, width: 800, height: 800 }

function at<T>(time: number, read: () => T): T {
    const before = clock.now
    clock.now = time
    try {
        return read()
    } finally {
        clock.now = before
    }
}

function searchWidth(f: CompiledFilm, time: number): number {
    const yellow = parseColor('yellow')
    const widths = f.frame(time).ops.flatMap((op) => op.kind === 'path' && op.stroke === yellow
        ? [pathBounds(op.strokePath)?.width ?? 0]
        : [])
    return Math.max(0, ...widths)
}

describe('scatter state and geometry', () => {
    it('plays an insert twice with independent points and can reinsert a removed name', async () => {
        await compileFilm(film({}, (s) => {
            const c = s.add(scatter([], frame))
            const add = c.insert({ x: 3, y: 4 })
            s.play(add)
            s.play(add)
            s.play(c.move(0, [6, 4]))
            expect(c.positionOf(1)).toEqual([3, 4])
            expect(c.point(1).get('x')).toBeCloseTo(c.p(3, 4)[0])
            const named = c.insert({ name: 'q', x: 5, y: 5 })
            s.play(named)
            s.play(c.remove('q'))
            s.play(named)
            expect(c.indexOf('q')).toBe(3)
            expect(c.point('q').get('visible')).toBe(true)
        }))
    })

    it('partitions coincident centers with the same tie rule as the data', async () => {
        await compileFilm(film({}, (s) => {
            const c = s.add(scatter([{ x: 2, y: 5 }, { x: 8, y: 5 }, { x: 5, y: 4 }], frame))
            const [a, b] = c.cells([0, 1])
            s.play(c.move(1, [2, 5]), { duration: 1 })
            expect(a.points).toEqual([2])
            expect(b.points).toEqual([])
            expect(b.ringAt(1)).toBeNull()
            expect(b.ringAt(0)).not.toBeNull()
        }))
    })

    it('keeps the bisector between two centers on an offset axis', async () => {
        await compileFilm(film({}, () => {
            const base = 1e10
            const c = scatter([], { ...frame, x: [base, base + 10] })
            const [left, right] = c.cells([[base + 2, 5], [base + 8, 5]])
            expect(Math.max(...left.ringAt(0)!.map(([x]) => x))).toBeCloseTo(0)
            expect(Math.min(...right.ringAt(0)!.map(([x]) => x))).toBeCloseTo(0)
        }))
    })

    it('encloses all corners of a region in a rotated parent', async () => {
        await compileFilm(film({}, (s) => {
            const c = scatter([], frame)
            s.add(group(c).rotate(Math.PI / 4))
            expect(c.region().width).toBeCloseTo(800 * Math.SQRT2)
            expect(c.region().height).toBeCloseTo(800 * Math.SQRT2)
        }))
    })

    it('finds data and queries by position inside a hull', async () => {
        await compileFilm(film({}, (s) => {
            const c = s.add(scatter([{ x: 1, y: 1, group: 'g' }, { x: 9, y: 1, group: 'g' }, { x: 5, y: 9, group: 'g', query: true }, { x: 5, y: 4 }, { x: 5, y: 3, query: true }], { ...frame, groupLabels: false }))
            const hull = c.hull('g')
            expect(hull.points).toEqual([0, 1, 3])
            expect(hull.holds(4)).toBe(true)
        }))
    })

    it('evaluates a search predicate against each frame, including later inserts', async () => {
        let c!: Scatter
        const f = await compileFilm(film({}, (s) => {
            c = s.add(scatter([{ x: 5, y: 5, query: true }, { x: 2, y: 5, group: 'g' }, { x: 6, y: 5 }], { ...frame, groupLabels: false }))
            s.play(c.nearest(0, 1, { among: (p) => p.group === 'g' && p.x < 7 }), { duration: 0 })
            s.wait(1)
            s.play(c.assign(2, 'g'), { duration: 0 })
            s.wait(1)
            s.play(c.move(2, [8, 5]), { duration: 1, ease: linear })
            s.play(c.insert({ x: 5.5, y: 5, group: 'g' }), { duration: 1 })
            s.wait(1)
        }))
        expect(c.neighbors).toEqual([3])
        for (const [time, width] of [[4.5, 80], [0.5, 480], [1.5, 160], [3.5, 480]]) {
            expect(searchWidth(f, time)).toBeCloseTo(width)
        }
    })

    it('reads the query, region and groups at the requested time', async () => {
        await compileFilm(film({}, (s) => {
            const c = s.add(scatter([{ x: 5, y: 5, query: true }, { x: 2, y: 5, group: 'g' }, { x: 8, y: 5 }], { ...frame, groupLabels: false }))
            const left = c.span({ x: [0, 3] })
            s.play(c.nearest(0, 1), { duration: 0 })
            s.wait(1)
            s.play(c.move(1, [9, 5]), c.assign(2, 'g'), { duration: 1 })
            s.play(c.remove(1))
            s.at(0.5, () => {
                expect(c.positionOf(1)[0]).toBeCloseTo(2)
                expect(c.count('g')).toBe(1)
                expect(c.groupOf(2)).toBeUndefined()
                expect(c.neighbors).toEqual([1])
                expect(c.nearestTo(0, 1)[0].index).toBe(1)
                expect(left.points).toEqual([1])
                expect(left.holds(1)).toBe(true)
            })
        }))
    })

    it('places a group label above its moving members when moves overlap', async () => {
        let c!: Scatter
        await compileFilm(film({}, (s) => {
            c = s.add(scatter([{ x: 2, y: 2, group: 'g' }, { x: 8, y: 2, group: 'g' }], frame))
            s.play(c.move(0, [4, 2], { duration: 1 }), c.move(1, [6, 2], { duration: 2 }), { ease: linear })
        }))
        for (const time of [2, 0.5, 1.5, 0]) {
            at(time, () => expect(c.groupLabels[0].get('x')).toBeCloseTo((c.dots[0].get('x') + c.dots[1].get('x')) / 2))
        }
    })

    it('copies a nested scatter and its shade at the time of the copy', async () => {
        await compileFilm(film({}, (s) => {
            const original = scatter([{ x: 2, y: 2, name: 'a', label: false }], frame)
            const area = original.span({ x: [0, 5] })
            const parent = s.add(group(original))
            s.at(2, () => s.play(original.remove('a'), area.shade(), { duration: 1 }))
            const copy = s.add(parent.clone()).children[0] as Scatter
            expect(copy.positionOf('a')).toEqual([2, 2])
            expect(copy.areas[0].shaded).toBe(false)
            s.play(copy.move('a', [8, 8]), copy.areas[0].shade(), { duration: 1 })
            expect(at(1, () => original.dots[0].get('x'))).toBeCloseTo(original.p(2, 2)[0])
            expect(area.fillAt(1).opacity).toBe(0)
            expect(copy.areas[0].fillAt(1).opacity).toBeGreaterThan(0)
        }))
    })

    it('keeps new points and areas independent across two generations of copies', async () => {
        await compileFilm(film({}, (s) => {
            const original = scatter([], frame)
            const parent = s.add(group(original))
            const copy = s.add(parent.clone()).children[0] as Scatter
            s.play(copy.insert({ x: 2, y: 5 }))
            const next = s.add(copy.clone())
            const area = next.span({ x: [0, 5] })
            s.play(next.insert({ x: 5, y: 5, name: 'new' }), next.move(0, [8, 5]), area.shade())
            expect(original.dots).toHaveLength(0)
            expect(copy.dots).toHaveLength(1)
            expect(copy.nameLabels).toEqual([null])
            expect(copy.positionOf(0)).toEqual([2, 5])
            expect(copy.areas).toHaveLength(0)
            expect(next.positionOf(0)).toEqual([8, 5])
            expect(area.points).toEqual([1])
        }))
    })

    it('takes a static copy of a search while its ring is growing', async () => {
        let copy!: Scatter
        const f = await compileFilm(film({}, (s) => {
            const c = s.add(scatter([{ x: 5, y: 5 }, { x: 7, y: 5 }], frame))
            s.play(c.nearest(0, 1), { duration: 2, ease: linear })
            s.at(1, () => { copy = s.add(c.clone()) })
            s.remove(c)
            s.wait(0.5)
            s.play(copy.nearest(0, 1), { duration: 1, ease: linear })
        }))
        expect(copy.neighbors).toEqual([1])
        expect(searchWidth(f, 2.25)).toBeCloseTo(160)
        expect(searchWidth(f, 3)).toBeCloseTo(240)
    })

    it('preserves empty axes and a fixed view while validating managed points and ranges', async () => {
        await compileFilm(film({}, () => {
            const outside = scatter([{ x: 12, y: 0, group: 'legacy' }], frame)
            expect(outside.dots[0].get('x')).toBeCloseTo(outside.p(12, 0)[0])
            expect(() => scatter([{ x: 12, y: 0, name: 'managed', label: false }], frame)).toThrow(/outside the plot/)
            expect(() => scatter([], { ...frame, x: [3, 2] })).toThrow(/x.*range/)
            expect(() => scatter([{ x: NaN, y: 0 }], frame)).toThrow(/finite/)
            expect(scatter([{ x: 1, y: 1 }], { ...frame, labelSize: 0, radius: 0 }).dots[0].bounds().width).toBe(0)
            expect(scatter([]).axis.bounds()).toEqual({ x: -450, y: 260, width: 900, height: 0 })
            expect(scatter([], { x: [0, 10] }).axis.bounds().y).toBe(260)
            expect(scatter([], { y: [0, 10] }).axis.bounds().height).toBeGreaterThan(520)
        }))
    })
})
