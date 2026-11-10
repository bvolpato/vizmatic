import { describe, expect, expectTypeOf, it } from 'vitest'
import { compileFilm, film, group, linear, numberLine, parseColor, pathBounds, type Node, type NumberLineOptions, type PathOp, type Stage } from '../src/stage/index'
import { clock } from '../src/stage/track'

const compile = (build: (stage: Stage) => void) => compileFilm(film({}, build))
type Line = ReturnType<typeof numberLine>

function at<T>(time: number, read: () => T): T {
    const saved = clock.now
    clock.now = time
    try {
        return read()
    } finally {
        clock.now = saved
    }
}

describe('number line regressions', () => {
    it('preserves the boolean labels option and labels only the selected ticks', async () => {
        expectTypeOf<NumberLineOptions['labels']>().toEqualTypeOf<boolean | undefined>()
        await compile(() => {
            const ticks = [0, 1, 2, 3]
            const line = numberLine({ ticks, tickLabels: [1, 3] })
            expect(line.numbers.children.map((label) => label.get('x'))).toEqual([line.p(1)[0], line.p(3)[0]])
            expect(() => numberLine({ ticks, labels: false, tickLabels: [1] })).toThrow(/labels: false.*tickLabels/)
        })
    })

    it('keeps a tickless axis usable and refuses to snap a point on it', async () => {
        await compile((s) => {
            const line = s.add(numberLine({ range: [0.1, 0.2], points: [{ name: 'A', value: 0.15 }] }))
            expect(line.ticks.children).toHaveLength(0)
            expect(() => line.nearestTick(0.15)).toThrow(/no ticks/)
            expect(() => line.snap('A')).toThrow(/no ticks/)
            expect(line.value('A')).toBe(0.15)
            s.play(line.move('A', 0.2))
        })
    })

    it('preserves dense regular ticks on a legacy axis', async () => {
        await compile(() => {
            expect(numberLine({ range: [0, 2001], labels: false }).ticks.children).toHaveLength(2002)
        })
    })

    it('includes all four corners of a region inside a rotated group', async () => {
        await compile((s) => {
            const line = numberLine({ range: [0, 10], length: 1000, labels: false, points: [] })
            s.add(group(line).rotate(Math.PI / 4, [0, 0]).at(70, 30))
            const region = line.region({ from: 2, to: 6 })
            const corners = [2, 6].flatMap((value) => [line.extent!.top, line.extent!.bottom].map((y) => line.toWorld(line.p(value)[0], y)))
            expect(region.left).toBeCloseTo(Math.min(...corners.map(([x]) => x)))
            expect(region.right).toBeCloseTo(Math.max(...corners.map(([x]) => x)))
            expect(region.top).toBeCloseTo(Math.min(...corners.map(([, y]) => y)))
            expect(region.bottom).toBeCloseTo(Math.max(...corners.map(([, y]) => y)))
        })
    })

    it('keeps each bracket attached to the point that existed when it was made', async () => {
        let first!: Node, second!: Node
        await compile((s) => {
            const line = s.add(numberLine({ range: [0, 10], length: 1000, labels: false, points: [{ name: 'A', value: 2 }] }))
            first = line.bracket(0, 'A', { label: '' })
            s.wait(1)
            s.play(line.remove('A'), { duration: 1 })
            s.play(line.insert({ name: 'A', value: 8 }), { duration: 1 })
            second = line.bracket(0, 'A', { label: '' })
            s.wait(1)
        })
        expect(at(3.5, () => second.bounds().width)).toBeCloseTo(800)
        expect(at(0.5, () => first.bounds().width)).toBeCloseTo(200)
        expect(at(3.5, () => first.bounds().width)).toBe(0)
    })

    it('removes a copied snap trace on the next move and preserves the source trace', async () => {
        let source!: Line, copy!: Line
        const compiled = await compile((s) => {
            source = numberLine({ range: [0, 10], labels: false, points: [{ name: 'A', value: 2.4 }] })
            const parent = s.add(group(source).at(0, -200))
            s.play(source.snap('A'), { duration: 1 })
            s.at(4, () => s.play(source.move('A', 9)))
            const cloned = s.add(parent.clone().at(0, 200))
            copy = cloned.children[0] as Line
            s.wait(1)
            s.play(copy.move('A', 8), { duration: 1 })
            s.wait(1)
        })
        const traces = (line: Line, time: number) => {
            const parts = new Set(line.all())
            return compiled.frame(time).ops.filter((op) => op.kind === 'path' && op.stroke === parseColor('red') && op.node && parts.has(op.node))
        }
        expect(traces(copy, 1.5)).toHaveLength(1)
        expect(traces(copy, 3.5)).toHaveLength(0)
        expect(traces(source, 3.5)).toHaveLength(1)
        expect(source.value('A')).toBe(9)
        expect(copy.value('A')).toBe(8)
    })

    it('gives successive group copies their own empty layers and label arrays', async () => {
        await compile((s) => {
            const original = numberLine({ labels: false })
            const groupA = s.add(group(original)), groupB = s.add(groupA.clone())
            const first = groupB.children[0] as Line
            s.play(first.insert({ name: 'A', value: 2, label: false }))
            const second = s.add(groupB.clone()).children[0] as Line
            s.play(second.insert({ name: 'B', value: 3 }))
            s.play(second.move('A', 4))
            expect(original.pointNodes).toHaveLength(0)
            expect(first.pointLabels).toEqual([null])
            expect(first.value('A')).toBe(2)
            expect(second.value('A')).toBe(4)
            expect(second.names).toEqual(['A', 'B'])
        })
    })

    it('draws the first insert in a copy made before the original inserts a point', async () => {
        let copy!: Line
        const compiled = await compile((s) => {
            const original = s.add(numberLine({ labels: false }))
            s.at(3, () => s.play(original.insert({ name: 'future', value: 2 })))
            copy = s.add(original.clone())
            s.play(copy.insert({ name: 'present', value: 4, label: false }))
            s.wait(1)
        })
        expect(copy.names).toEqual(['present'])
        expect(compiled.frame(1).ops.some((op) => op.kind === 'path' && op.node?.drawer?.parent === copy.point('present'))).toBe(true)
    })

    it.each(['direct', 'nested'])('freezes membership and the moving dot in a %s copy at an earlier time', async (mode) => {
        let source!: Line, copy!: Line
        const compiled = await compile((s) => {
            source = numberLine({ range: [0, 10], labels: false, thresholds: [4.9], bands: [{ color: 'blue' }, { color: 'green' }], points: [{ name: 'A', value: 2 }] })
            const parent = s.add(group(source))
            s.play(source.move('A', 8), { duration: 4, ease: linear })
            s.play(source.remove('A'))
            s.play(source.insert({ name: 'B', value: 9 }))
            s.at(2, () => {
                copy = mode === 'direct' ? s.add(source.clone()) : s.add(parent.clone()).children[0] as Line
            })
        })
        expect(copy.names).toEqual(['A'])
        expect(copy.value('A')).toBe(5)
        expect(copy.count(1)).toBe(1)
        const dot = (line: Line, time: number) => compiled.frame(time).ops.find((op): op is PathOp => op.kind === 'path' && op.fill !== null && op.stroke !== null && op.node?.drawer?.parent === line.pointNodes[0])!
        const original = dot(source, 2), frozen = dot(copy, 4.5)
        expect(pathBounds(frozen.strokePath)).toEqual(pathBounds(original.strokePath))
        expect(frozen.stroke).toEqual(original.stroke)
    })

    it('can replay an insert after its original point leaves', async () => {
        await compile((s) => {
            const line = s.add(numberLine({ points: [] }))
            const insert = line.insert({ name: 'A', value: 2 })
            s.play(insert)
            const first = line.point('A')
            s.play(line.remove('A'))
            s.play(insert)
            expect(line.names).toEqual(['A'])
            expect(line.count(0)).toBe(1)
            expect(line.point('A')).not.toBe(first)
            expect(line.point('A').get('visible')).toBe(true)
        })
    })

    it('rejects adjacent thresholds that cross between ordered endpoints', async () => {
        await expect(compile((s) => {
            const line = s.add(numberLine({ range: [0, 10], thresholds: [3, 6] }))
            s.play(line.moveThreshold(9, { which: 1, duration: 4, ease: linear }), line.moveThreshold(7, { duration: 1, ease: linear }))
        }).then(() => undefined)).rejects.toThrow(/threshold.*order/)
        await compile((s) => {
            const line = s.add(numberLine({ range: [0, 10], thresholds: [3, 6] }))
            s.play(line.moveThreshold(7), line.moveThreshold(9, { which: 1 }))
            expect(line.thresholds).toEqual([7, 9])
        })
    })

    it.each(['one move', 'parallel moves'])('separates labels that exchange places with %s', async (mode) => {
        let line!: Line
        await compile((s) => {
            line = s.add(numberLine({ range: [0, 10], length: 1000, labels: false, points: [{ name: 'A', value: 2 }, { name: 'B', value: 8 }] }))
            const options = { duration: 2, ease: linear }
            if (mode === 'one move') s.play(line.move({ A: 8, B: 2 }), options)
            else s.play(line.move('A', 8), line.move('B', 2), options)
        })
        for (const time of [0.98, 1, 1.02]) {
            const [a, b] = at(time, () => line.pointLabels.map((label) => label!.bounds()))
            expect(a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
        }
        expect(at(2, () => line.pointLabels[0]!.get('y'))).toBe(at(0, () => line.pointLabels[0]!.get('y')))
    })

    it('separates labels that cross after a shorter parallel move has ended', async () => {
        let line!: Line
        await compile((s) => {
            line = s.add(numberLine({ range: [0, 10], length: 1000, labels: false, points: [{ name: 'A', value: 2 }, { name: 'B', value: 8 }] }))
            s.play(line.move('A', 8, { duration: 4, ease: linear }), line.move('B', 6, { duration: 1, ease: linear }))
        })
        const [a, b] = at(8 / 3, () => line.pointLabels.map((label) => label!.bounds()))
        expect(a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
    })
})
