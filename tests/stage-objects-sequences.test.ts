import { describe, expect, it } from 'vitest'
import { checkFilm, compileFilm, film, group, linear, numberLine, parseColor, pathBounds, rect, scatter, seq, text, tokens, delay, boxOf, fitted, type CompiledFilm, type Node, type PathOp, type Stage, TextNode, type FontFamily, pipeline, PipelineItemNode, TOKEN_STATES, Node as StageNode, rectPath, ramp, place as placeIn, Box as LayoutBox, beside } from '../src/stage/index'
import { at, compile, expectPure, paths, svgAt } from './helpers/stage-objects'

describe('number line', () => {
    type Line = ReturnType<typeof numberLine>
    const middle = (node: Node) => { const box = node.bounds(); return [box.x + box.width / 2, box.y + box.height / 2] as const }
    /** The texts that a frame draws, each one time: a text of a drawing that is rebuilt on each frame is one of them. */
    const words = (f: CompiledFilm, t: number) => [...new Set(paths(f, t).filter((op) => op.node?.data['key'] !== undefined).map((op) => (op.node!.parent as unknown as { source: string }).source))]
    /** The dot of a point in a frame: the only mark of its node with a fill and a line. */
    const dotOf = (f: CompiledFilm, t: number, point: Node) => paths(f, t).find((op) => op.fill !== null && op.stroke !== null && op.node?.drawer?.parent === point)!
    const wide = (op: PathOp) => { const box = pathBounds(op.strokePath)!; return [box.x, box.x + box.width] as const }
    const orange = () => parseColor('orange'), green = () => parseColor('green')

    it('puts the ticks of a list at their values, and a number under the ticks that the film names', async () => {
        await compile(() => {
            const line = numberLine({ ticks: [4, 0, 0.5, 1, 2], tickLabels: [0, 1, 4], length: 800 })
            // The list is in any order, and the line goes from its first value to its last.
            expect(line.tickValues).toEqual([0, 0.5, 1, 2, 4])
            expect(line.range).toEqual([0, 4])
            expect(line.ticks.children.map((tick) => middle(tick)[0])).toEqual([-400, -300, -200, 0, 400])
            expect(line.numbers.children.map((number) => number.get('x'))).toEqual([-400, -200, 400])
            // A tick with no number is shorter than a tick with one.
            const heights = line.ticks.children.map((tick) => tick.bounds().height)
            expect(heights[1]).toBeLessThan(heights[0]!)
            expect(heights[3]).toBeLessThan(heights[2]!)
            // With a format, the numbers are plain text, as the film writes them.
            const plain = numberLine({ range: [0, 600], ticks: [0, 250, 550], format: (value) => `${value} ms`, length: 900 })
            expect(plain.numbers.children.map((number) => (number as unknown as { source: string }).source)).toEqual(['0 ms', '250 ms', '550 ms'])
            expect(plain.numbers.children[2]!.get('x')).toBeCloseTo(plain.p(550)[0], 6)
        })
    })

    it('adds nothing to a line with no points, thresholds or bands', async () => {
        await compile(() => {
            const line = numberLine({ range: [0, 10], length: 500 })
            expect(line.children).toEqual([line.line, line.ticks, line.numbers])
            expect(line.ticks.children).toHaveLength(11)
            expect(line.numbers.children).toHaveLength(11)
            expect(line.extent).toBeNull()
            // The numbers of a line with a step are 24 px, as they were: 6/7 of the default size.
            expect(line.numbers.children[0]!.bounds().height).toBeLessThan(24)
            expect(line.numbers.children[0]!.get('y')).toBe(34)
        })
    })

    it('refuses ticks that it cannot draw truly, and names what works', async () => {
        await compile(() => {
            expect(() => numberLine({ ticks: [0, 1], step: 0.5 })).toThrow(/give `step` for ticks at equal steps, or `ticks` for a list of values, not both/)
            expect(() => numberLine({ ticks: [] })).toThrow(/at least one value/)
            expect(() => numberLine({ ticks: [0, NaN] })).toThrow(/the tick NaN is not a number/)
            expect(() => numberLine({ ticks: [0, 1, 1] })).toThrow(/the tick 1 is in the list two times/)
            expect(() => numberLine({ range: [0, 1], ticks: [0, 2] })).toThrow(/the tick 2 is outside the line, which goes from 0 to 1/)
            expect(() => numberLine({ ticks: [0, 1, 2], tickLabels: [0, 1.5] })).toThrow(/tickLabels names 1\.5, which is not a tick of the line/)
            expect(() => numberLine({ range: [3, 3] })).toThrow(/the range is 3 to 3\. Give two different values, the smaller one first/)
            expect(() => numberLine({ step: 0 })).toThrow(/step is 0\. A step is the distance between two ticks, more than 0/)
            expect(() => numberLine({ range: [0, 1], step: 0.0001, points: [{ name: 'p', value: 0.3 }] })).toThrow(/gives 10000 ticks from 0 to 1/)
            // Numbers that touch: the message names the ticks that have room, from the last one down.
            const grid = [0, 0.125, 0.25, 0.375, 0.5, 1, 2, 4]
            let message = ''
            try { numberLine({ ticks: grid, length: 600 }) } catch (error) { message = (error as Error).message }
            expect(message).toMatch(/the numbers "0" and "0\.125" touch under the line/)
            const named = /tickLabels: \[([^\]]+)\]/.exec(message)![1]!.split(', ').map(Number)
            expect(named[named.length - 1]).toBe(4)
            // The list that the message names builds.
            expect(numberLine({ ticks: grid, length: 600, tickLabels: named }).numbers.children).toHaveLength(named.length)
        })
    })

    it('gives the tick that is nearest to a value, and of two that are as near the one with the even index', async () => {
        await compile(() => {
            const line = numberLine({ ticks: [0, 1, 2, 3] })
            expect(line.nearestTick(0.4)).toBe(0)
            expect(line.nearestTick(0.6)).toBe(1)
            expect(line.nearestTick(0.5)).toBe(0)
            expect(line.nearestTick(1.5)).toBe(2)
            expect(line.nearestTick(2.5)).toBe(2)
            // A value past the last tick goes to it.
            expect(line.nearestTick(9)).toBe(3)
            // The ticks of a step are ticks too.
            expect(numberLine({ range: [0, 1], step: 0.25 }).nearestTick(0.7)).toBe(0.75)
        })
    })

    it('moves a point along the line, and a second move in one sequence starts from the first', async () => {
        let line!: Line
        await compile((s) => {
            line = s.add(numberLine({ range: [0, 10], length: 1000, points: [{ name: 'A', value: 2 }, { name: 'B', value: 9 }] }))
            expect(line.value('A')).toBe(2)
            s.play(seq(line.move('A', 6), line.move('A', 4)), { duration: 2, ease: linear })
            expect(line.value('A')).toBe(4)
            // Two points at one time, by their names.
            s.play(line.move({ A: 5, B: 8 }), { duration: 1, ease: linear })
        })
        const x = (name: string, time: number) => at(time, () => line.point(name).get('x'))
        expect([0, 0.5, 1, 1.5, 2].map((time) => x('A', time))).toEqual([2, 4, 6, 5, 4].map((value) => line.p(value)[0]))
        expect(x('A', 2.5)).toBeCloseTo(line.p(4.5)[0], 6)
        expect(x('B', 2.5)).toBeCloseTo(line.p(8.5)[0], 6)
        expect([line.value('A'), line.value('B')]).toEqual([5, 8])
        expect(line.names).toEqual(['A', 'B'])
    })

    it('snaps a point to the nearest tick, and leaves the error as a line from the place that it came from', async () => {
        let line!: Line
        const f = await compile((s) => {
            line = s.add(numberLine({ ticks: [0, 0.5, 1, 2], length: 1000, points: [{ name: 'w', value: 0.7 }, { name: 'v', value: 1.6 }, { name: 'u', value: 1 }] }))
            s.play(line.snap(), { duration: 1, ease: linear })
            s.wait(1)
            s.play(line.move('v', 1.5), { duration: 1, ease: linear })
            s.wait(1)
        })
        expect([line.value('w'), line.value('v'), line.value('u')]).toEqual([0.5, 1.5, 1])
        expect(at(1, () => line.point('w').get('x'))).toBe(line.p(0.5)[0])
        expect(at(1, () => line.point('v').get('x'))).toBe(line.p(2)[0])
        const red = parseColor('red')
        const errors = (time: number) => paths(f, time).filter((op) => op.stroke === red).map(wide).sort((a, b) => a[0] - b[0])
        // Two points moved, so two lines: each one goes from the old place to the tick. The point on a tick has none.
        const done = errors(1.5)
        expect(done).toHaveLength(2)
        expect(done[0]![1] - done[0]![0]).toBeCloseTo(line.p(0.7)[0] - line.p(0.5)[0], 3)
        expect(done[1]![1] - done[1]![0]).toBeCloseTo(line.p(2)[0] - line.p(1.6)[0], 3)
        // Half way, the line is as long as the way that the dot has gone.
        const half = errors(0.5)
        expect(half[1]![1] - half[1]![0]).toBeCloseTo((line.p(2)[0] - line.p(1.6)[0]) / 2, 3)
        // The next move of a point takes its line away.
        expect(errors(3.5)).toHaveLength(1)
        // `trace: false` leaves no line.
        const bare = await compile((s) => {
            const other = s.add(numberLine({ ticks: [0, 1], points: [{ name: 'w', value: 0.7 }] }))
            s.play(other.snap('w', { trace: false }), { duration: 1 })
            s.wait(1)
        })
        expect(paths(bare, 1.5).filter((op) => op.stroke === red)).toHaveLength(0)
    })

    it('puts a point in the band of its side of a threshold, and a point at the threshold in the band that the film names', async () => {
        await compile(() => {
            const points = [{ name: 'a', value: 4 }, { name: 'b', value: 5 }, { name: 'c', value: 6 }]
            const line = numberLine({ range: [0, 10], thresholds: [5], bands: ['low', 'high'], points })
            expect(['a', 'b', 'c'].map((name) => line.bandOf(name))).toEqual([0, 1, 1])
            expect([line.count('low'), line.count('high'), line.count(1)]).toEqual([1, 2, 2])
            expect(line.find((point) => point.band === 1)).toEqual(['b', 'c'])
            expect(line.thresholds).toEqual([5])
            const under = numberLine({ range: [0, 10], thresholds: [{ at: 5, ties: 'under' }], points })
            expect(under.bandOf('b')).toBe(0)
            // Two thresholds leave three bands.
            const three = numberLine({ range: [0, 10], thresholds: [3, 7], points })
            expect(['a', 'b', 'c'].map((name) => three.bandOf(name))).toEqual([1, 1, 1])
            expect([0, 1, 2].map((band) => three.count(band))).toEqual([0, 3, 0])
            expect(() => numberLine({ thresholds: [1], bands: ['one'] })).toThrow(/1 band and 1 threshold\. 1 threshold leaves 2 bands: give 2 bands, or 0 thresholds/)
            expect(() => numberLine({ thresholds: [2, 1] })).toThrow(/threshold 1 is at 1, and threshold 0 is at 2\. Give the thresholds from the smallest to the largest/)
            expect(() => numberLine({ thresholds: [9] })).toThrow(/threshold 0 is at 9, outside the line, which goes from -5 to 5/)
            expect(() => numberLine({ thresholds: [1], bands: ['same', 'same'] })).toThrow(/two bands have the name "same"/)
            expect(() => line.count('middle')).toThrow(/no band "middle"\. The bands are 0 \("low"\), 1 \("high"\)/)
        })
    })

    it('gives a point the look of its band when a threshold passes it, at that moment and not before', async () => {
        let line!: Line
        const f = await compile((s) => {
            line = s.add(numberLine({ range: [0, 10], length: 1000, thresholds: [5], bands: [{ color: 'orange', hollow: true }, { color: 'green' }], points: [{ name: 'p', value: 3 }] }))
            // The threshold goes from 5 to 1 in two seconds, so it is at the point at 1 s.
            s.play(line.moveThreshold(1), { duration: 2, ease: linear })
            s.wait(1)
        })
        const point = line.point('p')
        // Before: a ring in the color of the band under the threshold. The fill is the background.
        expect(dotOf(f, 0.95, point).stroke).toEqual(orange())
        expect(dotOf(f, 0.95, point).fill).not.toEqual(orange())
        // A moment after the crossing, the look is between the two.
        expect(dotOf(f, 1.1, point).stroke).not.toEqual(orange())
        expect(dotOf(f, 1.1, point).stroke).not.toEqual(green())
        // After: a dot in the color of the band over the threshold.
        expect(dotOf(f, 1.6, point).stroke).toEqual(green())
        expect(dotOf(f, 1.6, point).fill).toEqual(green())
        expect(line.bandOf('p')).toBe(1)
        expect(line.thresholds).toEqual([1])
        expect(at(1, () => line.threshold().get('x'))).toBe(line.p(3)[0])
    })

    it('gives a point the look of its band when it crosses a threshold', async () => {
        let line!: Line
        const f = await compile((s) => {
            line = s.add(numberLine({ range: [0, 10], length: 1000, thresholds: [5], bands: [{ color: 'orange' }, { color: 'green' }], points: [{ name: 'p', value: 3 }, { name: 'own', value: 3, color: 'blue', label: false }] }))
            s.play(line.move({ p: 7, own: 7 }), { duration: 2, ease: linear })
            s.wait(1)
        })
        expect(dotOf(f, 0.95, line.point('p')).fill).toEqual(orange())
        expect(dotOf(f, 1.6, line.point('p')).fill).toEqual(green())
        // A point with a color of its own keeps it in every band.
        expect(dotOf(f, 0.5, line.point('own')).fill).toEqual(parseColor('blue'))
        expect(dotOf(f, 2.5, line.point('own')).fill).toEqual(parseColor('blue'))
        expect(line.bandOf('own')).toBe(1)
    })

    it('counts the points of each band under the line, at each frame', async () => {
        let line!: Line
        const f = await compile((s) => {
            line = s.add(numberLine({ range: [0, 10], length: 1000, labels: false, thresholds: [{ at: 5, readout: false }], bands: ['low', 'high'], counts: true, points: [2, 4, 6, 8].map((value) => ({ name: `p${value}`, value, label: false as const })) }))
            // The threshold passes the point at 6 after one second.
            s.play(line.moveThreshold(7), { duration: 2, ease: linear })
            s.wait(1)
        })
        const numbers = (time: number) => words(f, time).filter((text) => /^\d+$/.test(text)).sort()
        expect(words(f, 0.5)).toEqual(expect.arrayContaining(['low', 'high']))
        expect(numbers(0.9)).toEqual(['2'])
        expect(numbers(1.1)).toEqual(['1', '3'])
        expect([line.count('low'), line.count('high')]).toEqual([3, 1])
    })

    it('writes the value of a threshold over it, and counts it while the threshold moves', async () => {
        let line!: Line
        const f = await compile((s) => {
            line = s.add(numberLine({ range: [0, 10], length: 1000, format: (value) => value.toFixed(1), thresholds: [{ at: 5, label: 'cutoff' }, { at: 8, readout: false, label: 'limit' }] }))
            s.play(line.moveThreshold(1), { duration: 2, ease: linear })
        })
        expect(words(f, 0)).toEqual(expect.arrayContaining(['cutoff 5.0', 'limit']))
        expect(words(f, 1)).toContain('cutoff 3.0')
        expect(words(f, 2)).toContain('cutoff 1.0')
        expect(line.threshold('limit')).toBe(line.thresholdNodes[1])
    })

    it('shows which side of a fixed point the moving cutoff is on when the band counts change', async () => {
        const f = await compile((s) => {
            const line = s.add(numberLine({
                ticks: [4, 6, 8], points: [{ name: 'A', value: 5 }, { name: 'B', value: 8 }],
                thresholds: [{ at: 4, label: 'cutoff' }], bands: ['below', 'above'], counts: true,
            }))
            s.play(line.moveThreshold(6), { duration: 2, ease: linear })
        })
        expect(words(f, 0.96)).toEqual(expect.arrayContaining(['cutoff 4.96', '0', '2']))
        expect(words(f, 1)).toEqual(expect.arrayContaining(['cutoff 5', '0', '2']))
        expect(words(f, 1.000001)).toEqual(expect.arrayContaining(['cutoff 5.000001', '1']))
        expect(words(f, 1.04)).toEqual(expect.arrayContaining(['cutoff 5.04', '1']))
    })

    it('shows fractional bracket gaps as points move on an integer grid', async () => {
        const f = await compile((s) => {
            const line = s.add(numberLine({ ticks: [0, 1, 2], labels: false, points: [{ name: 'A', value: 1 }] }))
            line.bracket(0, 'A')
            line.bracket(0, 0.000001, { side: 'over' })
            s.play(line.move('A', 2), { duration: 1, ease: linear })
        })
        expect(words(f, 0.25)).toEqual(expect.arrayContaining(['1.25', '0.000001']))
    })

    it('keeps the thresholds in their order', async () => {
        await expect(compile((s) => {
            const line = s.add(numberLine({ range: [0, 10], thresholds: [3, 6] }))
            s.play(line.moveThreshold(7))
        })).rejects.toThrow(/threshold 0 cannot go to 7: threshold 1 is at 6, and the thresholds keep their order/)
        await compile((s) => {
            const line = s.add(numberLine({ range: [0, 10], thresholds: [3, 6] }))
            s.play(line.moveThreshold(9, { which: 1 }))
            s.play(line.moveThreshold(7))
            expect(line.thresholds).toEqual([7, 9])
            expect(() => line.moveThreshold(11)).toThrow(/the new value is 11, outside the line, which goes from 0 to 10/)
            expect(() => line.moveThreshold(4, { which: 2 })).toThrow(/no threshold 2\. The thresholds are 0, 1/)
        })
    })

    it('refuses two changes of one point at one time, and takes two points at one time', async () => {
        const build = (play: (s: Stage, line: Line) => void) => compile((s) => {
            const line = s.add(numberLine({ range: [0, 10], thresholds: [5], points: [{ name: 'A', value: 2 }, { name: 'B', value: 8 }] }))
            play(s, line)
        })
        await expect(build((s, line) => s.play(line.move('A', 3), line.move('A', 4)))).rejects.toThrow(/move\("A"\) plays from 0 s to 1 s, and move\("A"\) plays from 0 s to 1 s\. Both change the point "A", and a part takes one change at a time/)
        await expect(build((s, line) => s.play(line.move('A', 3.4), line.snap('A')))).rejects.toThrow(/snap\("A"\) plays from 0 s to 0\.8 s, and move\("A"\)/)
        // A point that a move takes to a tick has no way to go in a snap, so the two play together.
        await build((s, line) => s.play(line.move('A', 3), line.snap('A')))
        await expect(build((s, line) => s.play(line.moveThreshold(3), line.moveThreshold(4)))).rejects.toThrow(/Both change threshold 0/)
        // A change that the film writes at an earlier time, after a later one.
        await expect(build((s, line) => {
            s.at(5, () => s.play(line.move('A', 3)))
            s.play(line.move('A', 4))
        })).rejects.toThrow(/The line takes the changes of a part in the order of time/)
        // Two points, a point and a threshold, and a sequence of one point: each plays.
        await build((s, line) => {
            s.play(line.move('A', 3), line.move('B', 4), line.moveThreshold(6))
            s.play(seq(line.move('A', 7), line.snap('A')))
            expect(line.value('A')).toBe(7)
        })
    })

    it('places names that are near beside their dots and over them, and no name on the line of a threshold', async () => {
        await compile((s) => {
            const points = [0.9992, 0.9981, 0.9968, 0.9952, 0.9944, 0.9944, 0.9944].map((value, index) => ({ name: `Q${index + 1}`, value }))
            const line = s.add(numberLine({ range: [0.98, 1], ticks: [0.98, 0.99, 1], length: 1500, format: (value) => value.toFixed(2), points, thresholds: [0.995] }))
            const boxes = line.pointLabels.map((label) => label!.bounds())
            const meets = (a: typeof boxes[number], b: typeof boxes[number]) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
            for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(meets(boxes[i]!, boxes[j]!), `Q${i + 1} and Q${j + 1}`).toBe(false)
            // Three points at one value: one name at each side of the dot, and one over them.
            const [left, right, over] = [boxes[4]!, boxes[5]!, boxes[6]!].sort((a, b) => b.y - a.y || a.x - b.x)
            const x = line.toWorld(...line.p(0.9944))[0]
            expect(left!.x + left!.width).toBeLessThan(x)
            expect(right!.x).toBeGreaterThan(x)
            expect(over!.y + over!.height).toBeLessThan(left!.y)
            // The point at 0.9952 is 15 px from the threshold: its name is at one side of the line.
            const wall = line.toWorld(...line.p(0.995))[0]
            for (const box of boxes) expect(box.x > wall || box.x + box.width < wall).toBe(true)
            // With one height, three names at one value have no place. The message names the option that works.
            expect(() => numberLine({ range: [0.98, 1], length: 1500, levels: 1, points })).toThrow(/the names of the points have no place over the line with 1 height.*What works for this line: levels: 2/)
            // A point with no label takes no room.
            expect(numberLine({ range: [0.98, 1], length: 1500, levels: 1, points: points.map((point) => ({ ...point, label: false as const })) }).pointLabels).toEqual(points.map(() => null))
        })
    })

    it('lifts the name of a point that passes another point, and not the names of points that move together', async () => {
        let line!: Line
        await compile((s) => {
            line = s.add(numberLine({ range: [0, 10], length: 1000, points: [{ name: 'A', value: 2 }, { name: 'B', value: 5 }] }))
            s.play(line.move('A', 8), { duration: 2, ease: linear })
            s.play(line.move({ A: 9, B: 6 }), { duration: 2, ease: linear })
        })
        const y = (name: string, time: number) => at(time, () => line.pointLabels[line.names.indexOf(name)]!.get('y'))
        const rest = y('A', 0)
        // On its way over B, the name of A is one height up. It is back at the end.
        expect(y('A', 1)).toBeLessThan(rest - 20)
        expect(y('A', 2)).toBeCloseTo(rest, 6)
        expect(y('B', 1)).toBeCloseTo(rest, 6)
        // The two keep their order in the second move, so no name goes up.
        expect(y('A', 3)).toBeCloseTo(rest, 6)
        expect(y('B', 3)).toBeCloseTo(rest, 6)
    })

    it('draws a bracket that follows its two points, with their gap', async () => {
        let line!: Line, gap!: Node
        const f = await compile((s) => {
            line = s.add(numberLine({ range: [0, 10], length: 1000, labels: false, format: (value) => value.toFixed(1), points: [{ name: 'A', value: 2 }, { name: 'B', value: 5 }] }))
            gap = line.bracket('A', 'B')
            line.bracket(1, 'A', { side: 'over', label: (width, from, to) => `${from} to ${to}: ${width}` })
            s.wait(1)
            s.play(line.move('A', 4), { duration: 2, ease: linear })
            s.play(line.remove('B'), { duration: 1 })
            s.wait(1)
        })
        const ends = (time: number) => at(time, () => { const box = gap.bounds(); const [x0] = line.toWorld(line.p(0)[0], 0); return [box.x - x0, box.x + box.width - x0] })
        // The bracket goes from one point to the other. Its text is the gap, and it counts while a point moves.
        expect(ends(0.5)[0]).toBeCloseTo(200, 0)
        expect(ends(0.5)[1]).toBeCloseTo(500, 0)
        expect(words(f, 0.5)).toEqual(expect.arrayContaining(['3.0', '1 to 2: 1']))
        expect(ends(2)[0]).toBeCloseTo(300, 0)
        expect(words(f, 2)).toContain('2.0')
        expect(words(f, 3)).toEqual(expect.arrayContaining(['1.0', '1 to 4: 3']))
        // A bracket of a point that left is not drawn.
        expect(words(f, 4.5)).not.toContain('1.0')
        expect(() => line.bracket('A', 'nobody')).toThrow(/bracket: no point "nobody"\. The points are "A"/)
        expect(() => line.bracket(0, 11)).toThrow(/an end is 11\. An end is a value of the line, 0 to 10, or the name of a point/)
    })

    it('brings a point with insert and takes one with remove, and the counts follow', async () => {
        let line!: Line
        const f = await compile((s) => {
            line = s.add(numberLine({ range: [0, 10], length: 1000, labels: false, thresholds: [{ at: 5, readout: false }], bands: ['low', 'high'], counts: true, points: [{ name: 'A', value: 2 }] }).at(0, 100))
            s.play(line.insert({ name: 'new', value: 8 }, { from: [300, -200] }), { duration: 1, ease: linear })
            expect(line.names).toEqual(['A', 'new'])
            expect(line.count('high')).toBe(1)
            expect(() => line.insert({ name: 'new', value: 1 })).toThrow(/insert: the line has a point "new" already/)
            s.wait(1)
            s.play(line.remove('A'), { duration: 1 })
            expect(line.names).toEqual(['new'])
            expect(() => line.point('A')).toThrow(/no point "A"\. The points are "new"/)
            // The name of a point that left is free again.
            s.play(line.insert({ name: 'A', value: 9 }), { duration: 1 })
            expect(line.pointNodes).toHaveLength(3)
            s.wait(1)
        })
        const node = line.point('new')
        // The dot travels from the place of the stage to its value.
        expect(at(0, () => node.toWorld(0, 0))).toEqual([300, -200])
        expect(at(0.5, () => node.toWorld(0, 0))).toEqual([(300 + line.p(8)[0]) / 2, -50])
        expect(at(1, () => node.toWorld(0, 0))).toEqual([line.p(8)[0], 100])
        const numbers = (time: number) => words(f, time).filter((text) => /^\d+$/.test(text)).sort()
        // The count takes the point when it lands, and loses a point when it starts to leave.
        expect(numbers(0.5)).toEqual(['0', '1'])
        expect(numbers(1.5)).toEqual(['1'])
        expect(numbers(2.1)).toEqual(['0', '1'])
        expect(numbers(4.5)).toEqual(['0', '2'])
    })

    it('gives the box of a part for the layout, and takes its length as its width', async () => {
        await compile((s) => {
            const line = s.add(numberLine({ range: [0, 10], length: 1000, thresholds: [4], bands: ['low', 'high'], points: [{ name: 'A', value: 2 }] }).at(100, 50))
            const at4 = line.region({ at: 4 })
            expect(at4.left).toBeCloseTo(0, 6)
            expect(at4.right).toBeCloseTo(0, 6)
            expect(at4.top).toBe(50 + line.extent!.top)
            expect(at4.bottom).toBe(50 + line.extent!.bottom)
            const high = line.region({ band: 'high' })
            const edges = (box: { left: number; right: number }) => [box.left, box.right].map((x) => Math.round(x * 1e6) / 1e6)
            expect(edges(high)).toEqual([0, 600])
            expect(edges(line.region())).toEqual([-400, 600])
            expect(edges(line.region({ from: 1, to: 2 }))).toEqual([-300, -200])
            expect(() => line.region({ at: 11 })).toThrow(/a value is 11\. `from`, `to` and `at` are values of the line, 0 to 10/)
            expect(() => line.region({ at: 1, to: 2 })).toThrow(/`at` for one value, or `from` and `to` for a stretch, not both/)
            expect(() => line.region({ where: 1 } as never)).toThrow(/region has no part "where"\. Its parts are: from, to, at, band/)
            // `fitted` gives the line the length that makes all of it as wide as a region.
            const made = fitted(900, (length) => numberLine({ range: [0, 10], length, points: [{ name: 'a long name at the end', value: 10 }] }))
            expect(boxOf(made).width).toBeCloseTo(900, 0)
            expect(made.length).toBeLessThan(900)
            // The room of the names is a part of the measure from the start, with no point yet.
            expect(boxOf(numberLine({ range: [0, 10], points: [] })).height).toBeGreaterThan(boxOf(numberLine({ range: [0, 10] })).height + 40)
        })
    })

    it('enters with nothing on screen at the start, and all of it at the end', async () => {
        let line!: Line
        const f = await compile((s) => {
            line = numberLine({ range: [0, 10], thresholds: [5], bands: [{ name: 'low', color: 'orange' }, 'high'], points: [{ name: 'A', value: 2 }] })
            s.wait(0.5)
            s.play(line.enter(), { duration: 1 })
            s.wait(0.5)
        })
        expect(f.frame(0.2).ops).toHaveLength(0)
        expect(words(f, 1.9)).toEqual(expect.arrayContaining(['A', 'low', 'high', '5']))
        const shows = (node: Node, time: number) => at(time, () => (node.get('visible') ? node.get('opacity') : 0))
        expect(shows(line.point('A'), 0.6)).toBe(0)
        expect(shows(line.point('A'), 1.9)).toBe(1)
        expect(shows(line.threshold(), 1.9)).toBe(1)
        expect(shows(line.numbers.children[10]!, 0.55)).toBe(0)
        expect(shows(line.numbers.children[10]!, 1.9)).toBe(1)
    })

    it('gives a copy its own points and thresholds', async () => {
        let line!: Line, copy!: Line
        const f = await compile((s) => {
            line = s.add(numberLine({ range: [0, 10], length: 1000, thresholds: [5], bands: [{ color: 'orange' }, { color: 'green' }], points: [{ name: 'A', value: 2 }] }).at(0, -200))
            s.play(line.move('A', 4), { duration: 1 })
            copy = s.add(line.clone().at(0, 200))
            s.play(copy.move('A', 8), copy.moveThreshold(9), { duration: 1, ease: linear })
            s.play(copy.insert({ name: 'B', value: 1 }), { duration: 0.5 })
            s.wait(0.5)
        })
        expect([line.value('A'), copy.value('A')]).toEqual([4, 8])
        expect([line.thresholds, copy.thresholds]).toEqual([[5], [9]])
        expect([line.names, copy.names]).toEqual([['A'], ['A', 'B']])
        expect(copy.point('A')).not.toBe(line.point('A'))
        expect(at(2.5, () => line.point('A').get('x'))).toBe(line.p(4)[0])
        expect(at(2.5, () => copy.point('A').get('x'))).toBe(line.p(8)[0])
        // The dot of the copy has the look of the band of the copy: under its threshold at 9. The dot of the line is under 5 too.
        expect(dotOf(f, 2.9, copy.point('A')).fill).toEqual(orange())
        expect(dotOf(f, 2.9, line.point('A')).fill).toEqual(orange())
        expect(copy.bandOf('A')).toBe(0)
    })

    it('passes the film check with its names, its bands and a threshold that moves', async () => {
        const made = film({ fps: 20 }, (s) => {
            const scores = [0.52, 0.61, 0.67, 0.69, 0.71, 0.78, 0.83, 0.9, 0.94, 0.97]
            const line = s.add(numberLine({
                range: [0.4, 1], ticks: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], format: (value) => value.toFixed(2), length: 1500,
                thresholds: [{ at: 0.7, label: 'cutoff' }], bands: [{ name: 'human review', color: 'orange', hollow: true }, { name: 'auto-serve', color: 'green' }], counts: true,
                points: scores.map((value, index) => ({ name: `p${index + 1}`, value })),
            }))
            line.bracket('p1', 'p3')
            s.wait(0.5)
            s.play(line.moveThreshold(0.5), { duration: 1 })
            s.play(line.move('p1', 0.99), { duration: 1 })
            s.play(line.snap('p2'), { duration: 0.6 })
            s.wait(1)
        })
        for (const textGap of [0.3, 0.7]) expect((await checkFilm(made, { motion: true, textGap, readingSpeed: 0 })).diagnostics, `text gap ${textGap}`).toEqual([])
    })

    it('says what is wrong with a point, and what to give', async () => {
        await compile(() => {
            const line = numberLine({ range: [0, 10], points: [{ name: 'A', value: 2 }] })
            expect(() => numberLine({ range: [0, 10], points: [{ name: 'A', value: 12 }] })).toThrow(/the value of the point "A" is 12, outside the line, which goes from 0 to 10/)
            expect(() => numberLine({ points: [{ name: '', value: 1 }] })).toThrow(/point 0 has no name/)
            expect(() => numberLine({ points: [{ name: 'A', value: 1 }, { name: 'A', value: 2 }] })).toThrow(/the line has a point "A" already/)
            expect(() => numberLine({ points: [{ name: 'A', value: 1, color: 'no such color' }] })).toThrow(/the color of the point "A" is "no such color", which is not a color/)
            expect(() => numberLine({ points: [{ name: 'A', value: 1, label: 'two\nlines' }] })).toThrow(/the label of the point "A" has a line break/)
            expect(() => line.move('B', 1)).toThrow(/move: no point "B"\. The points are "A"/)
            expect(() => line.move('A', 11)).toThrow(/move: the new value of "A" is 11, outside the line/)
            expect(() => line.move({})).toThrow(/move got no point/)
            expect(() => line.snap('B')).toThrow(/snap: no point "B"/)
            expect(() => line.remove([])).toThrow(/remove takes the name of a point, or a list of names/)
            expect(() => numberLine().value('A')).toThrow(/no point "A"\. The line has no points: give `points` to numberLine\(\), or play an insert\(\)/)
            expect(() => numberLine().moveThreshold(1)).toThrow(/no threshold 0\. The line has no threshold: give `thresholds` to numberLine\(\)/)
            expect(() => numberLine({ levels: 0 })).toThrow(/levels is the number of heights/)
        })
    })
})

describe('scatter', () => {
    type Plane = ReturnType<typeof scatter>
    // A plot of 800 by 800 for 10 by 10 units: one unit is 80 px, and the middle of the plot is at (5, 5).
    const frame = { x: [0, 10] as const, y: [0, 10] as const, width: 800, height: 800 }
    const middle = (node: Node) => { const box = node.bounds(); return [box.x + box.width / 2, box.y + box.height / 2] as const }
    const meets = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    const holds = (outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
    /** The marks of the search in a frame: its ring, the ring around each point that it holds, and its lines. They are the only yellow lines. */
    const search = (f: CompiledFilm, t: number) => paths(f, t).filter((op) => op.stroke === parseColor('yellow') && op.fill === null).map((op) => pathBounds(op.strokePath)!)
    const shows = (node: Node, time: number) => at(time, () => (node.get('visible') ? node.get('opacity') : 0))

    it('adds nothing to a chart with no name, no area and no search', async () => {
        await compile(() => {
            const chart = scatter([{ x: 0, y: 0, group: 'g' }, { x: 1, y: 1, group: 'g' }, { x: 2, y: 0 }])
            expect(chart.children).toEqual([chart.axis, ...chart.dots, ...chart.groupLabels])
            expect(chart.nameLabels).toEqual([null, null, null])
            expect(chart.areas).toEqual([])
        })
    })

    it('writes the name of a point beside its mark, inside the plot and clear of the other names', async () => {
        await compile(() => {
            const chart = scatter([
                { x: 5, y: 5, name: 'middle' }, { x: 9.8, y: 5, name: 'at the right edge' }, { x: 5, y: 5.5, name: 'near' },
                { x: 2, y: 2, name: 'hidden', label: false }, { x: 2, y: 8, name: 'k', label: 'a label' }, { x: 7, y: 8, name: 'low', side: 'under' },
            ], frame)
            const boxes = chart.nameLabels.map((label) => label?.bounds() ?? null), dots = chart.dots.map((mark) => mark.bounds())
            // At the right of its mark by default.
            expect(boxes[0]!.x).toBeGreaterThan(dots[0]!.x + dots[0]!.width)
            expect(Math.abs(middle(chart.nameLabels[0]!)[1] - middle(chart.dots[0]!)[1])).toBeLessThan(3)
            // At the right it would leave the plot, so it takes another side, inside the plot.
            expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(401)
            expect(meets(boxes[1]!, dots[1]!)).toBe(false)
            const texts = boxes.filter((box) => box !== null)
            for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) expect(meets(texts[i]!, texts[j]!), `${i} and ${j}`).toBe(false)
            expect(boxes[3]).toBeNull()
            expect((chart.nameLabels[4] as unknown as { source: string }).source).toBe('a label')
            expect(boxes[5]!.y).toBeGreaterThan(dots[5]!.y + dots[5]!.height)
            expect(chart.labelsOf(chart.point('middle'))).toEqual([chart.nameLabels[0]])
            expect(chart.indexOf('near')).toBe(2)
            expect(() => scatter([{ x: 9.9, y: 5, name: 'a long name', side: 'right' }], frame)).toThrow(/the name of the point "a long name" has no room at the side 'right'/)
            expect(() => scatter([{ x: 1, y: 1, name: 'a' }, { x: 2, y: 2, name: 'a' }], frame)).toThrow(/the chart has a point "a" already/)
            expect(() => scatter([{ x: 1, y: 1, name: 'a', side: 'north' as 'over' }], frame)).toThrow(/has the side "north"\. Use 'right', 'left', 'over' or 'under'/)
        })
    })

    it('gives a group its shape, and a query a dot in a ring', async () => {
        await compile(() => {
            const chart = scatter([{ x: 1, y: 1, group: 'a' }, { x: 2, y: 2, group: 'b' }, { x: 3, y: 3, name: 'q', query: true }, { x: 4, y: 4, group: 'c' }], { ...frame, radius: 10, groups: { a: 'teal', b: { shape: 'square', color: 'orange' }, c: { shape: 'ring' } } })
            expect(chart.dots.map((mark) => mark.get('path')!.length)).toEqual([1, 1, 3, 2])
            expect(chart.dots[0]!.bounds().width).toBeCloseTo(20, 6)
            expect(chart.dots[1]!.bounds().width).toBeCloseTo(17.6, 6)
            // A query is larger than a point, and in ink when it has no color: it is in no group of the data.
            expect(chart.dots[2]!.bounds().width).toBeCloseTo(32, 6)
            expect(chart.dots.map((mark) => mark.get('fill'))).toEqual([parseColor('teal'), parseColor('orange'), parseColor('ink'), parseColor('teal')])
            expect(() => scatter([], { ...frame, groups: { a: { shape: 'star' as 'dot' } } })).toThrow(/the group "a" has the shape "star"\. A shape is 'dot', 'ring', 'square', 'diamond', 'triangle'/)
        })
    })

    it('moves a point with its name, and reads its place', async () => {
        let chart!: Plane
        await compile((s) => {
            chart = s.add(scatter([{ x: 2, y: 2, name: 'a' }, { x: 8, y: 8, name: 'b' }], frame))
            s.play(chart.move('a', [6, 4]), { duration: 2, ease: linear })
            expect(chart.positionOf('a')).toEqual([6, 4])
            s.play(chart.move({ a: [1, 1], b: [2, 2] }), { duration: 1, ease: linear })
            expect([chart.positionOf('a'), chart.positionOf(1)]).toEqual([[1, 1], [2, 2]])
            expect(() => chart.move('a', [11, 4])).toThrow(/move: the new place of the point "a" is \[11, 4\], outside the plot, which goes from 0 to 10 in x and from 0 to 10 in y/)
            expect(() => chart.move('c', [1, 1])).toThrow(/move: no point "c"\. The chart has 2 points, with the indexes 0 to 1, and the names "a", "b"/)
            expect(() => chart.move(5, [1, 1])).toThrow(/no point 5/)
        })
        const mark = chart.point('a'), name = chart.nameLabels[0]!
        const round = (place: number[]) => place.map((value) => Math.round(value * 1e6) / 1e6)
        const place = (time: number) => at(time, () => round([mark.get('x'), mark.get('y')]))
        expect(place(0)).toEqual(round(chart.p(2, 2)))
        expect(place(1)).toEqual(round(chart.p(4, 3)))
        expect(place(2)).toEqual(round(chart.p(6, 4)))
        expect(place(3)).toEqual(round(chart.p(1, 1)))
        // The name keeps its side: it is as far from its mark at the end as at the start.
        const beside = (time: number) => at(time, () => name.get('x') - mark.get('x'))
        expect(beside(2)).toBeCloseTo(beside(0), 6)
        expect(beside(1)).toBeCloseTo(beside(0), 6)
    })

    it('gives points another group: the color, the shape, the count and the label of the group follow', async () => {
        let chart!: Plane
        await compile((s) => {
            chart = s.add(scatter([{ x: 1, y: 1, group: 'a' }, { x: 2, y: 2, group: 'a' }, { x: 8, y: 8, group: 'b' }], { ...frame, groups: { b: { color: 'orange', shape: 'square' }, c: 'green' } }))
            expect([chart.count('a'), chart.count('b'), chart.count('c')]).toEqual([2, 1, 0])
            s.play(chart.assign(1, 'b'), { duration: 1, ease: linear })
            expect([chart.count('a'), chart.count('b'), chart.groupOf(1)]).toEqual([1, 2, 'b'])
            expect(chart.find((point) => point.group === 'b')).toEqual([1, 2])
            s.play(chart.assign((point) => point.group === 'a', 'c'), { duration: 1, ease: linear })
            expect(() => chart.assign(0, 'd')).toThrow(/assign: no group "d"\. The groups are "b", "c", "a"\. For a group that no point has at the start, name it in the option `groups`, such as groups: \{ d: 'teal' \}/)
        })
        const mark = chart.dots[1]!
        const [b, c, a] = chart.groupLabels as [Node, Node, Node]
        // The mark of the point goes from the dot of its first group to the square of the new one, in its color.
        expect(at(0, () => mark.get('fill'))).toEqual(parseColor('teal'))
        expect(at(1, () => mark.get('fill'))).toEqual(parseColor('orange'))
        expect(at(0, () => mark.bounds().width)).toBeCloseTo(12, 6)
        expect(at(1, () => mark.bounds().width)).toBeCloseTo(10.56, 6)
        // The label of a group is over its highest member, at their mean x: it goes to its new members.
        expect(at(0, () => b.get('x'))).toBeCloseTo(chart.p(8, 8)[0], 6)
        expect(at(1, () => b.get('x'))).toBeCloseTo(chart.p(5, 8)[0], 6)
        // A group with no point has no label. It shows when the group gets its first point, and it leaves with the last one.
        expect([shows(c, 0.5), shows(c, 2)]).toEqual([0, 1])
        expect([shows(a, 0.5), shows(a, 2)]).toEqual([1, 0])
        expect(at(2, () => c.get('x'))).toBeCloseTo(chart.p(1, 1)[0], 6)
    })

    it('finds the nearest points by their distance in the units of the axes, and not a query', async () => {
        await compile(() => {
            // One unit of x is 80 px, and one unit of y is 20 px: on the screen, n3 is nearer to q than n2.
            const chart = scatter([{ x: 5, y: 5, name: 'q', query: true }, { x: 5, y: 6, name: 'n1' }, { x: 7, y: 5, name: 'n2' }, { x: 5, y: 2, name: 'n3' }, { x: 4.9, y: 5, name: 'other', query: true }], { x: [0, 10], y: [0, 20], width: 800, height: 400 })
            expect(chart.nearestTo('q')).toEqual([{ index: 1, name: 'n1', distance: 1 }, { index: 2, name: 'n2', distance: 2 }, { index: 3, name: 'n3', distance: 3 }])
            expect(chart.nearestTo('q', 2).map((one) => one.name)).toEqual(['n1', 'n2'])
            expect(chart.nearestTo('q', 1, { among: ['n2', 'n3'] })[0]!.name).toBe('n2')
            expect(chart.nearestTo('q', 1, { among: (point) => point.y < 4 })[0]!.name).toBe('n3')
            expect(chart.nearestTo([5, 3], 1)[0]!.name).toBe('n3')
            expect(() => chart.nearestTo('q', -1)).toThrow(/nearestTo: k is -1\. Give a whole number, 0 or more/)
        })
    })

    it('grows a ring from a point to its k-th nearest point, and draws a line to each point that the ring holds', async () => {
        let chart!: Plane
        const f = await compile((s) => {
            chart = s.add(scatter([{ x: 5, y: 5, name: 'q', query: true }, { x: 5, y: 6, name: 'a' }, { x: 7, y: 5, name: 'b' }, { x: 5, y: 2, name: 'c' }], frame))
            // The ring grows to the second nearest point in two seconds: its radius is the time, in units.
            s.play(chart.nearest('q', 2), { duration: 2, ease: linear })
            expect(chart.neighbors).toEqual([1, 2])
            s.wait(1)
        })
        const widest = (time: number) => Math.max(...search(f, time).map((box) => box.width))
        // The ring alone, until it reaches the first point.
        expect(search(f, 0.5)).toHaveLength(1)
        expect(widest(0.5)).toBeCloseTo(80, 3)
        // Then the nearest point has a line and a ring around its mark.
        expect(search(f, 1.2)).toHaveLength(3)
        // At the end the ring passes through the second nearest point, 2 units away, and both points have a line.
        expect(search(f, 2.5)).toHaveLength(5)
        expect(widest(2.5)).toBeCloseTo(320, 3)
        await expect(compile((s) => {
            const other = s.add(scatter([{ x: 5, y: 5, name: 'q' }, { x: 5, y: 6 }], frame))
            s.play(other.nearest('q', 2))
        })).rejects.toThrow(/nearest\("q", 2\): the search has 1 point to find\. Give a k of 1 or less/)
    })

    it('keeps the search true while its point moves, keeps it to the points of `among`, and ends it with a k of 0', async () => {
        let chart!: Plane
        const f = await compile((s) => {
            chart = s.add(scatter([{ x: 5, y: 5, name: 'q', query: true }, { x: 5, y: 6, name: 'a' }, { x: 7, y: 5, name: 'b' }, { x: 5, y: 2, name: 'c' }], frame))
            s.play(chart.nearest('q', 1), { duration: 1 })
            expect(chart.neighbors).toEqual([1])
            s.play(chart.move('q', [6.5, 5]), { duration: 1 })
            // The point is now half a unit from b: b is the nearest, with no new call.
            expect(chart.neighbors).toEqual([2])
            s.play(chart.nearest('q', 1, { among: ['c'] }), { duration: 1 })
            expect(chart.neighbors).toEqual([3])
            s.play(chart.nearest('q', 0), { duration: 1 })
            expect(chart.neighbors).toEqual([])
            s.wait(1)
        })
        const line = (time: number) => search(f, time).reduce((best, box) => (box.width > 30 && box.height < best.height ? box : best))
        // The ring is 1 unit wide around the point at its new place, with a line to b.
        expect(Math.max(...search(f, 1.99).map((box) => box.width))).toBeCloseTo(80, 0)
        expect(search(f, 1.99)).toHaveLength(3)
        // Among c alone, the ring reaches c, more than 3 units away, and the line goes down to it.
        expect(Math.max(...search(f, 2.99).map((box) => box.width))).toBeCloseTo(2 * 80 * Math.hypot(1.5, 3), 0)
        expect(line(2.99).height).toBeGreaterThan(150)
        // The search that ends keeps its points: when the ring starts to close, its line is still at c. Then the ring leaves c.
        expect(search(f, 3)).toHaveLength(3)
        expect(line(3).height).toBeGreaterThan(150)
        expect(search(f, 3.2)).toHaveLength(1)
        expect(search(f, 4.5)).toHaveLength(0)
    })

    it('draws the hull of a group around its points and their names, and grows to a point that joins', async () => {
        let chart!: Plane, hull!: ReturnType<Plane['hull']>
        await compile((s) => {
            chart = s.add(scatter([{ x: 2, y: 2, group: 'a', name: 'a1' }, { x: 3, y: 3, group: 'a' }, { x: 8, y: 8, group: 'b', name: 'b1' }], { ...frame, groupLabels: false }))
            hull = chart.hull('a')
            expect(hull.points).toEqual([0, 1])
            expect(hull.shaded).toBe(true)
            s.play(chart.assign('b1', 'a'), { duration: 2, ease: linear })
            expect(hull.points).toEqual([0, 1, 2])
            expect(hull.holds('b1')).toBe(true)
            expect(() => chart.hull('c')).toThrow(/hull: no group "c"/)
        })
        const box = (time: number) => at(time, () => hull.bounds())
        const part = (node: Node, time: number) => at(time, () => node.bounds())
        for (const node of [chart.dots[0]!, chart.dots[1]!, chart.nameLabels[0]!]) expect(holds(box(0), part(node, 0))).toBe(true)
        expect(holds(box(0), part(chart.dots[2]!, 0))).toBe(false)
        // Half way, the hull is on its way to the point. At the end it holds the point and its name.
        expect(box(1).x + box(1).width).toBeGreaterThan(box(0).x + box(0).width + 100)
        expect(box(1).x + box(1).width).toBeLessThan(box(2).x + box(2).width - 100)
        for (const node of [chart.dots[2]!, chart.nameLabels[2]!]) expect(holds(box(2), part(node, 2))).toBe(true)
    })

    it('cuts the plot into the cells of its centers, and a cell follows its center', async () => {
        let chart!: Plane, cells!: ReturnType<Plane['cells']>
        await compile((s) => {
            chart = s.add(scatter([{ x: 2.5, y: 5, name: 'c1', group: 'center' }, { x: 7.5, y: 5, name: 'c2', group: 'center' }, { x: 4, y: 5, name: 'p' }, { x: 6, y: 5, name: 'r' }, { x: 4.9, y: 1, name: 'q', query: true }], { ...frame, groupLabels: false }))
            cells = chart.cells(['c1', 'c2'])
            // The points of a cell are the points of the data: not its center, and not a query.
            expect(cells.map((cell) => cell.points)).toEqual([[2], [3]])
            expect([cells[0]!.holds('q'), cells[0]!.holds('c1'), cells[1]!.holds('q')]).toEqual([true, true, false])
            s.play(chart.move('c2', [9.7, 5]), { duration: 1, ease: linear })
            // The line between the cells is now at 6.1, so the point at 6 is in the first cell.
            expect(cells.map((cell) => cell.points)).toEqual([[2, 3], []])
            const fixed = chart.cells([[2, 5], [8, 5], [5, 9]])
            expect(fixed).toHaveLength(3)
            expect(chart.areas).toEqual([...cells, ...fixed])
            expect(() => chart.cells(['c1'])).toThrow(/cells takes a list of two centers or more/)
            expect(() => chart.cells(['c1', 'nobody'])).toThrow(/cells: no point "nobody"/)
        })
        const edges = (index: number, time: number) => at(time, () => { const box = cells[index]!.bounds(); return [box.x, box.x + box.width] })
        // Each cell is the part of the plot that is nearer to its center: the line between the two is half way.
        expect(edges(0, 0)[0]).toBeCloseTo(-400, 6)
        expect(edges(0, 0)[1]).toBeCloseTo(0, 6)
        expect(edges(1, 0)[0]).toBeCloseTo(0, 6)
        expect(edges(1, 0)[1]).toBeCloseTo(400, 6)
        expect(edges(0, 1)[1]).toBeCloseTo(chart.p(6.1, 0)[0], 6)
        expect(edges(0, 0.5)[1]).toBeCloseTo(chart.p(5.55, 0)[0], 6)
    })

    it('shades an area and reads its shade, and spans a part of the axes', async () => {
        let chart!: Plane, left!: ReturnType<Plane['span']>
        const f = await compile((s) => {
            chart = s.add(scatter([{ x: 2, y: 2 }, { x: 6, y: 3 }, { x: 4, y: 9, name: 'q', query: true }], frame))
            left = chart.span({ x: [0, 5] }, { color: 'teal' })
            const corner = chart.span({ x: [5, Infinity], y: [2, 4] })
            expect([left.points, corner.points]).toEqual([[0], [1]])
            expect(left.holds('q')).toBe(true)
            expect(left.shaded).toBe(false)
            s.wait(1)
            s.play(left.shade(), { duration: 1, ease: linear })
            expect(left.shaded).toBe(true)
            s.wait(1)
            s.play(left.shade(false, { duration: 1 }))
            expect(left.shaded).toBe(false)
            s.wait(1)
            const box = corner.bounds()
            expect([box.x, box.x + box.width, box.y, box.y + box.height].map((value) => Math.round(value))).toEqual([0, 400, 80, 240])
            expect(() => chart.span({})).toThrow(/span takes a range of x, of y, or of both/)
            expect(() => chart.span({ x: [20, 30] })).toThrow(/span: x goes from 20 to 30, outside the axis, which goes from 0 to 10/)
            expect(() => left.shade('on' as never)).toThrow(/shade takes true or false, and then the options/)
        })
        const fill = (time: number) => paths(f, time).find((op) => op.node?.drawer === left && op.fill !== null)?.fillAlpha ?? 0
        // An area that is not shaded is its outline, with no fill.
        expect(fill(0.5)).toBe(0)
        expect(fill(1.5)).toBeCloseTo(0.11, 6)
        expect(fill(2.5)).toBeCloseTo(0.22, 6)
        expect(fill(4.5)).toBe(0)
        expect(at(0.5, () => left.bounds().width)).toBeCloseTo(400, 6)
        await expect(compile((s) => {
            const other = s.add(scatter([{ x: 2, y: 2 }], frame))
            const area = other.span({ x: [0, 5] })
            s.play(area.shade(), area.shade(false))
        })).rejects.toThrow(/An area takes one change of its shade at a time/)
    })

    it('brings a point with insert and takes one with remove', async () => {
        let chart!: Plane
        await compile((s) => {
            chart = s.add(scatter([{ x: 2, y: 2, name: 'a', group: 'g' }, { x: 8, y: 8, name: 'b', group: 'g' }], frame).at(0, 100))
            s.play(chart.insert({ x: 5, y: 5, name: 'new', group: 'g' }, { from: [700, -100] }), { duration: 1, ease: linear })
            expect([chart.indexOf('new'), chart.dots.length, chart.count('g')]).toEqual([2, 3, 3])
            expect(chart.positionOf('new')).toEqual([5, 5])
            expect(chart.nearestTo('a', 1)[0]!.name).toBe('new')
            expect(() => chart.insert({ x: 1, y: 1, name: 'new' })).toThrow(/insert: the chart has a point "new" already/)
            expect(() => chart.insert({ x: 11, y: 1 })).toThrow(/insert: the place of the point is \[11, 1\], outside the plot/)
            expect(() => chart.insert({ x: 1, y: 1, group: 'h' })).toThrow(/insert: no group "h"/)
            s.play(chart.remove('new'), { duration: 1 })
            expect(chart.count('g')).toBe(2)
            expect(chart.nearestTo('a', 1)[0]!.name).toBe('b')
            expect(() => chart.point('new')).toThrow(/point: no point "new"/)
            expect(() => chart.point(2)).toThrow(/no point 2\. That point left the chart/)
            s.play(chart.nearest('a', 1), { duration: 0.5 })
        })
        const mark = chart.dots[2]!
        // The mark travels from the place of the stage to its place on the plot.
        expect(at(0, () => mark.toWorld(0, 0))).toEqual([700, -100])
        expect(at(1, () => mark.toWorld(0, 0))).toEqual([chart.p(5, 5)[0], chart.p(5, 5)[1] + 100])
        expect([shows(mark, 1), shows(chart.nameLabels[2]!, 1)]).toEqual([1, 1])
        expect([shows(mark, 2.5), shows(chart.nameLabels[2]!, 2.5)]).toEqual([0, 0])
        await expect(compile((s) => {
            const other = s.add(scatter([{ x: 2, y: 2, name: 'a' }, { x: 8, y: 8, name: 'b' }], frame))
            s.play(other.nearest('a', 1))
            s.play(other.remove('a'))
        })).rejects.toThrow(/remove: the search of nearest\(\) starts at the point "a"\. End the search first, with nearest\("a", 0\)/)
    })

    it('refuses two moves of one point at one time, and takes a move with a change of group', async () => {
        const build = (play: (s: Stage, chart: Plane) => void) => compile((s) => {
            const chart = s.add(scatter([{ x: 2, y: 2, name: 'a', group: 'g' }, { x: 8, y: 8, name: 'b', group: 'h' }], frame))
            play(s, chart)
        })
        await expect(build((s, chart) => s.play(chart.move('a', [1, 1]), chart.move('a', [3, 3])))).rejects.toThrow(/move\("a"\) plays from 0 s to 1 s, and move\("a"\) plays from 0 s to 1 s\. Both change the place of the point "a"/)
        await expect(build((s, chart) => s.play(chart.assign('a', 'h'), chart.assign('a', 'g')))).rejects.toThrow(/Both change the group of the point "a"/)
        await expect(build((s, chart) => s.play(chart.nearest('a', 1), chart.nearest('b', 1)))).rejects.toThrow(/A chart has one search, and it takes one change at a time/)
        await build((s, chart) => {
            s.play(chart.move('a', [1, 1]), chart.assign('a', 'h'), chart.move('b', [3, 3]))
            s.play(seq(chart.move('a', [2, 1]), chart.move('a', [3, 1])))
            expect([chart.positionOf('a'), chart.groupOf('a')]).toEqual([[3, 1], 'h'])
        })
    })

    it('keeps the lines of an area and of a search behind its texts, so the film check finds no line through a text', async () => {
        const made = film({ fps: 20 }, (s) => {
            const chart = s.add(scatter([
                { x: 2.5, y: 5, name: 'c1', group: 'center' }, { x: 7.5, y: 5, name: 'c2', group: 'center' },
                { x: 4.6, y: 5.2, name: 'A', group: 'left' }, { x: 5.1, y: 5, name: 'B', group: 'right', side: 'right' }, { x: 3, y: 7, group: 'left' }, { x: 7, y: 3, group: 'right' },
            ], { ...frame, labelSize: 26, groups: { left: 'blue', right: 'teal', center: { color: 'ink', shape: 'ring', label: false }, found: { color: 'green', shape: 'diamond' } } }))
            const cells = chart.cells(['c1', 'c2'])
            chart.hull('left')
            s.wait(0.5)
            s.play(chart.insert({ x: 4.8, y: 5, name: 'q', query: true, side: 'under' }), { duration: 0.5 })
            // The line between the cells passes the name of B, and the ring of the search passes the names of A and of the groups.
            s.play(cells[0]!.shade(), chart.nearest('q', 4, { among: (point) => point.group !== 'center' }), { duration: 1 })
            // The point moves away from the names, and its ring passes them.
            s.play(chart.move('q', [4.4, 3.4]), { duration: 1 })
            // The label of the new group goes over the name of A, which is one of its points.
            s.play(chart.assign(chart.neighbors.slice(0, 2), 'found'), chart.nearest('q', 2, { among: (point) => point.group !== 'center' }), { duration: 1 })
            s.wait(1)
        })
        for (const textGap of [0.3, 0.7]) expect((await checkFilm(made, { motion: true, textGap, readingSpeed: 0 })).diagnostics, `text gap ${textGap}`).toEqual([])
    })

    it('gives a copy its own points, areas and search', async () => {
        let chart!: Plane, copy!: Plane
        const f = await compile((s) => {
            chart = s.add(scatter([{ x: 2, y: 2, name: 'a', group: 'g' }, { x: 8, y: 8, name: 'b', group: 'h' }, { x: 5, y: 5, name: 'q', query: true }], { ...frame, width: 400, height: 400 }).at(-450, 0))
            const area = chart.span({ x: [0, 5] })
            s.play(chart.move('a', [4, 4]), chart.nearest('q', 1), area.shade(), { duration: 1 })
            copy = s.add(chart.clone().at(450, 0))
            s.play(copy.move('a', [1, 9]), copy.assign('a', 'h'), copy.areas[0]!.shade(false), { duration: 1, ease: linear })
            s.wait(1)
        })
        expect([chart.positionOf('a'), copy.positionOf('a')]).toEqual([[4, 4], [1, 9]])
        expect([chart.groupOf('a'), copy.groupOf('a')]).toEqual(['g', 'h'])
        expect([chart.areas[0]!.shaded, copy.areas[0]!.shaded]).toEqual([true, false])
        expect(copy.areas[0]).not.toBe(chart.areas[0])
        expect(copy.areas[0]!.chart).toBe(copy)
        // The search of the copy is at its own point: the nearest point of each chart has a line.
        expect([chart.neighbors, copy.neighbors]).toEqual([[0], [1]])
        expect(search(f, 2.5)).toHaveLength(6)
        expect(at(2.5, () => chart.point('a').get('x'))).toBe(chart.p(4, 4)[0])
        expect(at(2.5, () => copy.point('a').get('x'))).toBe(chart.p(1, 9)[0])
    })

    it('gives the box of a part of the plot for the layout, and enters with its names', async () => {
        let chart!: Plane
        await compile((s) => {
            chart = scatter([{ x: 2, y: 2, name: 'a' }, { x: 8, y: 8, name: 'b' }], frame).at(100, 50)
            const plot = chart.region(), part = chart.region({ x: [0, 5], y: [5, 10] })
            expect([plot.left, plot.right, plot.top, plot.bottom]).toEqual([-300, 500, -350, 450])
            expect([part.left, part.right, part.top, part.bottom]).toEqual([-300, 100, -350, 50])
            expect(() => chart.region({ z: [0, 1] } as never)).toThrow(/region has no part "z"\. Its parts are: x, y/)
            // `fitted` gives the plot the width that makes all of the chart, with its numbers, as wide as a region.
            const made = fitted(1000, (width) => scatter([{ x: 2, y: 2, name: 'a' }], { ...frame, width, height: 300 }))
            expect(boxOf(made).width).toBeCloseTo(1000, 0)
            s.wait(0.5)
            s.play(chart.enter(), { duration: 1 })
            s.wait(0.5)
        })
        // A name comes with its mark.
        expect([shows(chart.nameLabels[1]!, 0.6), shows(chart.nameLabels[1]!, 1.9)]).toEqual([0, 1])
    })

    it('says what is wrong with a point, and what to give', async () => {
        await compile(() => {
            const chart = scatter([{ x: 2, y: 2, name: 'a' }, { x: 8, y: 8 }], frame)
            expect(() => scatter([{ x: 1, y: 1, name: '' }], frame)).toThrow(/the name of point 0 is ""\. A name is a text that is not empty/)
            expect(() => scatter([{ x: 1, y: 1, name: 'a', label: 3 as never }], frame)).toThrow(/the label of point 0 \("a"\) is 3\. A label is a text, or false for a point with no text/)
            expect(() => scatter([], { ...frame, groups: { a: 'no such color' } })).toThrow(/the color of the group "a" is "no such color", which is not a color/)
            expect(() => chart.point('b')).toThrow(/point: no point "b"\. The chart has 2 points, with the indexes 0 to 1, and the names "a"/)
            expect(() => chart.nearest('a', 1.5)).toThrow(/nearest: k is 1\.5\. Give a whole number of points, or 0 to end the search/)
            expect(() => chart.assign([0, 7], 'g')).toThrow(/assign: no group "g"\. The chart has no group/)
            expect(() => chart.remove(7)).toThrow(/remove: no point 7/)
            expect(() => chart.move({})).toThrow(/move got no point/)
            expect(() => chart.count('g')).toThrow(/count: no group "g"/)
        })
    })
})

describe('tokens', () => {
    type Strip = ReturnType<typeof tokens>
    const message = (run: () => unknown) => { try { run() } catch (error) { return (error as Error).message } return '' }
    /** The message of the error that stops a film, or '' for a film that builds. */
    const failure = async (build: (s: Stage) => void) => { try { await compile(build, { fps: 20 }) } catch (error) { return (error as Error).message } return '' }
    const shows = (node: Node | null) => (node && node.get('visible') ? node.get('opacity') : 0)
    const ends = (node: Node) => { const box = node.bounds(); return [box.x, box.x + box.width] as const }
    const middle = (node: Node) => { const box = node.bounds(); return box.x + box.width / 2 }
    const paint = (color: string) => text('a', { color }).children[0]!.get('fill')
    const source = (node: Node | null) => (node as unknown as { source: string } | null)?.source
    /** The places of the letters of the tokens that show, from the left: the letter and the middle of its ink. */
    const letters = (strip: Strip) => strip.all()
        .filter((node) => node.data['key'] !== undefined && strip.chips.some((cell) => cell.text === node.parent) && node.parent!.get('visible') && (node.parent!.parent as Node).get('visible'))
        .map((node) => [node.data['key'] as string, Math.round(middle(node) * 100) / 100] as const).sort((a, b) => a[1] - b[1])

    /** The row of chips as the library drew it before the strip had rows, spans and states. */
    const oldRow = (items: readonly (string | { text: string; sub?: string; color?: string })[], options: { size?: number; maxWidth?: number; gap?: number; color?: string; colors?: readonly string[]; font?: FontFamily; subSize?: number; radius?: number } = {}) => {
        const made = new StageNode()
        const size = options.size ?? 22, gap = options.gap ?? size * 0.28, subSize = options.subSize ?? size * 0.62
        const padX = size * 0.42, padY = size * 0.3
        const specs = items.map((item) => (typeof item === 'string' ? { text: item } : item))
        const palette = options.colors ? ramp(specs.length, ...options.colors) : null
        let x = 0, y = 0
        const placed: { node: Node; x: number; y: number; w: number }[] = []
        const rowHeight = size + padY * 2 + (specs.some((spec) => spec.sub) ? subSize * 1.4 : 0)
        specs.forEach((spec, i) => {
            const color = spec.color ?? (palette ? palette[i]! : options.color ?? 'blue')
            const label = text(spec.text.replace(/ /g, '·'), { size, font: options.font ?? 'mono', color: 'ink' })
            const w = Math.max(label.width, size * 0.5) + padX * 2, h = size + padY * 2
            if (options.maxWidth !== undefined && x > 0 && x + w > options.maxWidth) {
                x = 0
                y += rowHeight + gap
            }
            const chip = new StageNode().add(new StageNode(rectPath(-w / 2, -h / 2, w, h, options.radius ?? 4)).fill(color, 0.18).stroke(color, 1.5), label.at(0, 0))
            if (spec.sub) chip.add(text(spec.sub, { size: subSize, font: 'mono', color: 'dim' }).at(0, h / 2 + subSize * 0.82))
            placed.push({ node: chip, x: x + w / 2, y, w })
            x += w + gap
        })
        const maxX = Math.max(...placed.map((p) => p.x + p.w / 2), 0), maxY = Math.max(...placed.map((p) => p.y), 0)
        for (const entry of placed) made.add(entry.node.at(entry.x - maxX / 2, entry.y - maxY / 2))
        return made
    }

    it('draws a strip with the old options as the row of chips drew it', async () => {
        const cases: [Parameters<typeof oldRow>[0], Parameters<typeof oldRow>[1]][] = [
            [['The', 'cat', 'sat'], {}],
            [['The', { text: ' cat', sub: '9246' }, { text: ' sat', sub: '3332', color: 'orange' }, ''], { size: 44, color: 'teal' }],
            [['a', 'b', 'c', 'd', 'e'], { size: 36, colors: ['blue', 'purple', 'red'], gap: 20, radius: 12 }],
            ['the quick brown fox jumps over the lazy dog'.split(' ').map((word, i) => ({ text: word, sub: String(i) })), { size: 30, maxWidth: 420, font: 'sans', subSize: 20 }],
            [['hello', '\n', 'world'], {}],
            [['a', 'b'], { maxWidth: Infinity }],
            [['a'], { size: 0 }],
            [[{ text: 'a', sub: '1' }], { subSize: 0 }],
            [['a', 'b'], { gap: -1 }],
            [['a', 'b'], { maxWidth: 0 }],
        ]
        for (const [items, options] of cases) {
            const now = await compile((s) => { s.add(tokens(items, options).at(40, -30)) })
            const before = await compile((s) => { s.add(oldRow(items, options).at(40, -30)) })
            expect(svgAt(now, 0)).toBe(svgAt(before, 0))
        }
        await compile(() => {
            // A plain strip holds its chips and no other part.
            const plain = tokens(['The', 'cat'])
            expect(plain.children).toEqual(plain.chips)
            expect(plain.chips.every((chip) => chip.children.length === 2)).toBe(true)
        })
    })

    it('brings the chips in from the left, each with its values, and the names, a bracket and the window with them', async () => {
        let strip!: Strip
        await compile((s) => {
            strip = tokens(['The', 'cat', 'sat'], { size: 40, label: 'input', rows: { id: [464, 3797, 3332] }, spans: [{ from: 1, to: 2, label: 'words' }] }).at(0, 0)
            s.play(strip.enter(), { duration: 2 })
        }, { fps: 20 })
        const [first, last] = [strip.token(0), strip.token(2)]
        const value = strip.row('id').values[2]!, bracket = strip.spans[0]!
        at(0, () => {
            expect(shows(first)).toBe(0)
            expect(first.get('y')).toBeCloseTo(16, 6)
            expect(shows(value)).toBe(0)
            expect(shows(bracket)).toBe(0)
        })
        // The first chip is there while the last one has not started. A value comes with its chip.
        at(0.4, () => {
            expect(shows(first)).toBeGreaterThan(0.05)
            expect(shows(last)).toBe(0)
            expect(shows(value)).toBe(0)
        })
        at(2, () => {
            for (const node of [first, last, value, bracket, strip.caption, strip.row('id').name]) expect(shows(node)).toBe(1)
            expect(first.get('y')).toBeCloseTo(0, 6)
        })
    })

    it('gives a token the look of its state: a color, a fill, an outline, and a mark that is not a color', async () => {
        await compile(() => {
            const strip = tokens([{ text: 'kept' }, { text: 'masked', state: 'masked' }, { text: 'generated', state: 'generated' }, { text: 'cached', state: 'cached' }, { text: 'dropped', state: 'dropped' }], { size: 40, color: 'teal' })
            const [kept, masked, generated, cached, dropped] = strip.chips
            // A token with no state is in the first one, with the color of the strip and no mark.
            expect(strip.stateOf(0)).toBe('kept')
            expect(kept!.box.get('fill')).toEqual(paint('teal'))
            expect(kept!.box.get('fillOpacity')).toBe(0.18)
            expect(kept!.signs).toEqual([])
            expect(kept!.text.chars[0]!.get('fill')).toEqual(paint('ink'))
            // Each other state has its color and one mark, so color is not its only sign.
            expect(masked!.box.get('stroke')).toEqual(paint('dim'))
            expect(masked!.text.chars[0]!.get('fill')).toEqual(paint('dim'))
            expect(generated!.box.get('fill')).toEqual(paint('green'))
            expect(cached!.box.get('fill')).toEqual(paint('yellow'))
            expect(dropped!.box.get('dash')).not.toBeNull()
            expect(generated!.box.get('dash')).toBeNull()
            for (const cell of [masked, generated, cached, dropped]) expect(cell!.signs).toHaveLength(1)
            // The four marks are four shapes: lines over the cell, a bar on its bottom edge, a disc on its corner, a line through its text.
            const box = (cell: Node) => cell.bounds()
            const [lines, bar, disc, strike] = [masked!.signs[0]!, generated!.signs[0]!, cached!.signs[0]!, dropped!.signs[0]!]
            expect(lines.get('path')!.length).toBeGreaterThan(6)
            expect(box(bar).y + box(bar).height / 2).toBeCloseTo(box(generated!.box).y + box(generated!.box).height, 6)
            expect(box(bar).width).toBeGreaterThan(box(generated!.box).width * 0.8)
            expect(box(disc).x + box(disc).width).toBeGreaterThan(box(cached!.box).x + box(cached!.box).width)
            expect(box(disc).y).toBeLessThan(box(cached!.box).y)
            const ink = box(dropped!.text)
            expect(box(strike).x).toBeLessThan(ink.x)
            expect(box(strike).x + box(strike).width).toBeGreaterThan(ink.x + ink.width)
            expect(box(strike).y).toBeGreaterThan(ink.y)
            expect(box(strike).y).toBeLessThan(ink.y + ink.height)
        })
    })

    it('keeps the lines of a masked token clear of its text', async () => {
        await compile(() => {
            for (const word of ['a', 'masked', ' tokenization']) {
                const cell = tokens([{ text: word, state: 'masked' }], { size: 48 }).token(0)
                const ink = cell.text.bounds()
                for (const ring of cell.signs[0]!.get('path')!) {
                    for (let step = 0; step <= 10; step++) {
                        const x = ring.p[0]! + ((ring.p[ring.p.length - 2]! - ring.p[0]!) * step) / 10, y = ring.p[1]! + ((ring.p[ring.p.length - 1]! - ring.p[1]!) * step) / 10
                        expect(x > ink.x - 4 && x < ink.x + ink.width + 4 && y > ink.y - 4 && y < ink.y + ink.height + 4, `${word}: a line at ${x}, ${y}`).toBe(false)
                    }
                }
            }
        })
    })

    it('changes the state of tokens at the time of the change, one after another, and reads the states', async () => {
        let strip!: Strip
        await compile((s) => {
            strip = s.add(tokens(['a', 'b', 'c', { text: 'd', state: 'masked' }], { size: 40 }))
            s.wait(1)
            expect(strip.find((token) => token.state === 'masked')).toEqual([3])
            s.play(strip.mark([0, 1, 3], 'masked'), { duration: 1 })
            expect(strip.stateOf(0)).toBe('masked')
            expect(strip.stateOf(2)).toBe('kept')
            expect(strip.find((token) => token.state === 'masked')).toEqual([0, 1, 3])
            expect(strip.find('c')).toEqual([2])
        }, { fps: 20 })
        const [first, second, , last] = strip.chips
        at(1, () => {
            expect(first!.box.get('fill')).toEqual(paint('blue'))
            expect(first!.signs.every((sign) => shows(sign) === 0)).toBe(true)
        })
        // The first token is on its way while the second one has not started.
        at(1.25, () => {
            expect(first!.box.get('fill')).not.toEqual(paint('blue'))
            expect(second!.box.get('fill')).toEqual(paint('blue'))
        })
        at(2, () => {
            for (const cell of [first, second]) {
                expect(cell!.box.get('fill')).toEqual(paint('dim'))
                expect(cell!.box.get('fillOpacity')).toBeCloseTo(0.05, 6)
                expect(cell!.text.chars[0]!.get('fill')).toEqual(paint('dim'))
                expect(shows(cell!.signs[0]!)).toBe(1)
            }
        })
        // A token that has the state already gets no change: its one mark is the mark that it was made with.
        expect(last!.children.filter((node) => node !== last!.box && node !== last!.text)).toHaveLength(1)
    })

    it('takes the old mark of a token away when the state changes, and picks tokens when the change plays', async () => {
        let strip!: Strip
        await compile((s) => {
            strip = s.add(tokens(['a', 'b', 'c'], { size: 40, states: { ...TOKEN_STATES, accepted: { color: 'green', mark: 'check' } } }))
            // The second change runs after the first in one sequence, and it finds the tokens that the first one changed.
            s.play(seq(strip.mark([0, 2], 'generated'), strip.mark((token) => token.state === 'generated', 'accepted')), { duration: 2 })
        }, { fps: 20 })
        expect(strip.chips.map((cell) => cell.state)).toEqual(['accepted', 'kept', 'accepted'])
        const cell = strip.token(0)
        const marks = cell.children.filter((node) => node !== cell.box && node !== cell.text)
        expect(marks).toHaveLength(2)
        at(1, () => expect(marks.map(shows)).toEqual([1, 0]))
        at(2, () => {
            expect(marks.map(shows)).toEqual([0, 1])
            expect(cell.box.get('stroke')).toEqual(paint('green'))
        })
    })

    it('rejects conflicting marks even when a sweep reaches a token later', async () => {
        for (const sweep of [false, true]) {
            const error = await failure((s) => {
                const strip = s.add(tokens(['a', 'b']))
                s.play(strip.mark(sweep ? [0, 1] : 1, 'dropped', { duration: 2, lag: 1 }), strip.mark(1, 'kept', { duration: 0.5 }))
            })
            expect(error).toMatch(/token 1.*previous mark ends at 2 s.*seq\(\)/)
        }
        const f = await compile((s) => {
            const strip = s.add(tokens(['a', 'b']))
            s.play(strip.mark(0, 'cached'), strip.mark(1, 'dropped'))
            s.play(strip.mark(1, 'kept'))
            expect(strip.stateOf(1)).toBe('kept')
            expect(strip.token(1).box.get('dash')).toBeNull()
        })
        expectPure(f, [0, 0.3, f.duration])
    })

    it('puts each value of a row under the middle of its token, and the names at the left of the first cell', async () => {
        await compile(() => {
            const strip = tokens(['The', ' cat', ' sat'], { size: 40, label: 'input', rows: { position: [0, 1, 2], id: [464, 3797] } }).at(100, 50)
            const [position, id] = [strip.row('position'), strip.row('id')]
            strip.chips.forEach((cell, index) => {
                expect(middle(position.values[index]!)).toBeCloseTo(middle(cell.box), 0)
                expect(position.values[index]!.bounds().y).toBeGreaterThan(cell.box.bounds().y + cell.box.bounds().height)
            })
            // A row with fewer values than tokens leaves the rest empty. The second row is under the first.
            expect(id.values.map(source)).toEqual(['464', '3797', undefined])
            expect(strip.value('id', 1)).toBe('3797')
            expect(strip.value('id', 2)).toBeNull()
            expect(id.values[0]!.bounds().y).toBeGreaterThan(position.values[0]!.bounds().y + position.values[0]!.bounds().height)
            // The names of the two rows and of the line of cells end at one x, left of the first cell.
            const rights = [strip.caption!, position.name!, id.name!].map((name) => ends(name)[1])
            // The ink of a name ends a little before its line box, by the side of its last letter.
            expect(Math.abs(rights[1]! - rights[0]!)).toBeLessThan(3)
            expect(Math.abs(rights[2]! - rights[0]!)).toBeLessThan(3)
            expect(rights[0]!).toBeLessThan(ends(strip.token(0).box)[0] - 40 * 0.3)
            expect(strip.caption!.bounds().y + strip.caption!.bounds().height / 2).toBeCloseTo(50, -1)
            // The column of a token is its cell and its values.
            expect(strip.column(1)).toEqual([strip.token(1), position.values[1], id.values[1]])
            expect(strip.column(2)).toEqual([strip.token(2), position.values[2]])
        })
    })

    it('makes a cell as wide as its widest value needs, and with even gives every cell the width of the widest', async () => {
        await compile(() => {
            const width = (strip: Strip, index: number) => strip.token(index).box.bounds().width
            const plain = tokens(['a', 'b'], { size: 40 })
            const valued = tokens(['a', 'b'], { size: 40, rows: { id: [29889, 7] } })
            expect(width(valued, 0)).toBeGreaterThan(width(plain, 0) + 20)
            expect(width(valued, 0)).toBeGreaterThan(valued.row('id').values[0]!.bounds().width)
            expect(width(valued, 1)).toBeCloseTo(width(plain, 1), 6)
            const even = tokens(['a', 'tokenization', 'b'], { size: 40, even: true })
            expect(width(even, 0)).toBeCloseTo(width(even, 1), 6)
            expect(width(even, 2)).toBeCloseTo(width(even, 1), 6)
            expect(width(even, 1)).toBeCloseTo(width(tokens(['tokenization'], { size: 40 }), 0), 6)
            expect(width(tokens(['a'], { size: 40, minWidth: 200 }), 0)).toBeCloseTo(200, 6)
        })
    })

    it('changes a value in place: the old text is gone before the new one shows', async () => {
        let strip!: Strip, old!: Node
        await compile((s) => {
            strip = s.add(tokens(['a', 'b'], { size: 40, minWidth: 140, rows: { p: ['0.12', '0.88'] } }))
            old = strip.row('p').values[0]!
            s.wait(1)
            s.play(strip.setValue('p', 0, '0.31'), { duration: 1 })
            expect(strip.value('p', 0)).toBe('0.31')
            s.play(strip.setValue('p', 1, null), { duration: 1 })
            expect(strip.value('p', 1)).toBeNull()
        }, { fps: 20 })
        const next = strip.row('p').values[0]!
        expect(next).not.toBe(old)
        at(1.25, () => expect([shows(old) > 0, shows(next)]).toEqual([true, 0]))
        at(1.5, () => expect([shows(old), shows(next)]).toEqual([0, 0]))
        at(2, () => {
            expect([shows(old), shows(next)]).toEqual([0, 1])
            expect(middle(next)).toBeCloseTo(middle(strip.token(0).box), 0)
        })
        expect(strip.row('p').values[1]).toBeNull()
    })

    it('moves the values of a row by one cell, so each target is under the token before it', async () => {
        const words = ['<s>', 'Sit', 'Good', 'dog']
        let strip!: Strip, values!: (Node | null)[]
        await compile((s) => {
            strip = s.add(tokens(words, { size: 40, even: true, rows: { target: words } }))
            values = [...strip.row('target').values]
            s.wait(1)
            s.play(strip.shiftRow('target', -1), { duration: 1 })
            expect(words.map((_, index) => strip.value('target', index))).toEqual(['Sit', 'Good', 'dog', null])
        }, { fps: 20 })
        at(1, () => expect(middle(values[1]!)).toBeCloseTo(middle(strip.token(1).box), 0))
        at(2, () => {
            for (const index of [1, 2, 3]) expect(middle(values[index]!)).toBeCloseTo(middle(strip.token(index - 1).box), 0)
            // The first value has no token before it: it left the strip.
            expect(shows(values[0]!)).toBe(0)
        })
        // On its way out, the value does not reach the place where the name of the row is.
        at(1.4, () => expect(ends(values[0]!)[0]).toBeGreaterThan(ends(strip.row('target').name!)[1]))
        expect(strip.row('target').values[3]).toBeNull()
    })

    it('refuses a value that is too wide for its cell, and says which option gives it room', async () => {
        const wide = await failure((s) => { const strip = s.add(tokens(['a', 'tokenization'], { size: 40, rows: { target: ['a', 'tokenization'] } })); s.play(strip.shiftRow('target', -1)) })
        expect(wide).toMatch(/shiftRow: the value "tokenization" of the row "target" needs \d+ px, and the cell of token 0 \("a"\) is \d+ px wide\. Give the strip even: true, or minWidth: \d+/)
        const set = await failure((s) => { const strip = s.add(tokens(['a', 'b'], { size: 40, even: true, rows: { id: [1, 2] } })); s.play(strip.setValue('id', 0, '1234567')) })
        expect(set).toMatch(/setValue: the value "1234567" of the row "id" needs (\d+) px.*Give the strip minWidth: \1, or a shorter value/)
        // The width that the message names is enough.
        const need = Number(/minWidth: (\d+)/.exec(set)![1])
        expect(await failure((s) => { const strip = s.add(tokens(['a', 'b'], { size: 40, even: true, minWidth: need, rows: { id: [1, 2] } })); s.play(strip.setValue('id', 0, '1234567')) })).toBe('')
    })

    it('draws a bracket from the first cell of its run to the last, with its label over its middle, and a bracket that holds another one a level higher', async () => {
        await compile(() => {
            const strip = tokens(['<s>', 'You', 'are', 'kind', 'Hello', 'there', 'OK'], {
                size: 40, spans: [{ from: 0, to: 5, label: 'prompt' }, { from: 0, to: 3, label: 'system' }, { from: 4, to: 5, label: 'user' }, { from: 6, to: 6, label: 'assistant' }],
            })
            const [prompt, system, user, assistant] = ['prompt', 'system', 'user', 'assistant'].map((id) => strip.spans.find((span) => span.key === id)!)
            for (const [span, from, to] of [[prompt, 0, 5], [system, 0, 3], [user, 4, 5], [assistant, 6, 6]] as const) {
                expect(ends(span!.bracket)[0]).toBeCloseTo(ends(strip.token(from).box)[0], 6)
                expect(ends(span!.bracket)[1]).toBeCloseTo(ends(strip.token(to).box)[1], 6)
                expect(Math.abs(middle(span!.text!) - middle(span!.bracket))).toBeLessThan(2)
                // The label is over the line of the bracket, and the line is over the cells.
                expect(span!.text!.bounds().y + span!.text!.bounds().height).toBeLessThan(span!.bracket.bounds().y)
                expect(span!.bracket.bounds().y + span!.bracket.bounds().height).toBeLessThan(strip.token(from).box.bounds().y)
                expect(strip.spanRange(span!.key)).toEqual([from, to])
            }
            // The three brackets that follow each other are on one line. The label of the last one is wider than its cell.
            expect([system!.level, user!.level, assistant!.level, prompt!.level]).toEqual([0, 0, 0, 1])
            expect(assistant!.text!.bounds().width).toBeGreaterThan(assistant!.bracket.bounds().width)
            expect(ends(assistant!.text!)[0]).toBeLessThan(ends(user!.bracket)[1])
            expect(prompt!.bracket.bounds().y + prompt!.bracket.bounds().height).toBeLessThan(system!.text!.bounds().y)
            // Two labels that would meet are on two levels.
            const near = tokens(['a', 'b'], { size: 40, spans: [{ from: 0, to: 0, label: 'a long label' }, { from: 1, to: 1, label: 'one more long label' }] })
            expect(near.spans.map((span) => span.level).sort()).toEqual([0, 1])
        })
    })

    it('draws a new bracket, slides it to other tokens with a new label, and takes it away', async () => {
        let strip!: Strip
        await compile((s) => {
            strip = s.add(tokens(['a', 'b', 'c', 'd', 'e'], { size: 40 }))
            s.play(strip.span('chunk', 0, 1, { label: 'chunk 1', color: 'teal' }), { duration: 1 })
            expect(strip.spanRange('chunk')).toEqual([0, 1])
            s.play(strip.span('chunk', 2, 4, { label: 'chunk 2' }), { duration: 1 })
            expect(strip.spanRange('chunk')).toEqual([2, 4])
            s.play(strip.span('chunk', null), { duration: 1 })
            expect(strip.spanRange('chunk')).toBeNull()
            expect(strip.spans).toEqual([])
        }, { fps: 20 })
        const span = strip.children.find((node) => (node as { key?: string }).key === 'chunk') as Node & { bracket: Node; text: Node }
        const labels = span.children.filter((node) => source(node) !== undefined)
        expect(labels.map(source)).toEqual(['chunk 1', 'chunk 2'])
        at(0, () => expect(span.bracket.get('trimTo')).toBe(0))
        at(1, () => {
            expect(span.bracket.get('trimTo')).toBe(1)
            expect(ends(span.bracket)).toEqual([ends(strip.token(0).box)[0], ends(strip.token(1).box)[1]])
            expect(labels.map(shows)).toEqual([1, 0])
            expect(span.bracket.get('stroke')).toEqual(paint('teal'))
        })
        // Half way, the bracket is between its two places, and no label shows.
        at(1.5, () => {
            expect(ends(span.bracket)[0]).toBeGreaterThan(ends(strip.token(0).box)[0] + 10)
            expect(ends(span.bracket)[0]).toBeLessThan(ends(strip.token(2).box)[0] - 10)
            expect(labels.map(shows)).toEqual([0, 0])
        })
        at(2, () => {
            expect(ends(span.bracket)[0]).toBeCloseTo(ends(strip.token(2).box)[0], 6)
            expect(ends(span.bracket)[1]).toBeCloseTo(ends(strip.token(4).box)[1], 6)
            expect(labels.map(shows)).toEqual([0, 1])
            expect(middle(labels[1]!)).toBeCloseTo(middle(span.bracket), 0)
        })
        at(3, () => expect(shows(span)).toBe(0))
    })

    it('stops a bracket that would move onto another one, and names the two', async () => {
        const clash = await failure((s) => {
            const strip = s.add(tokens(['a', 'b', 'c', 'd'], { size: 40, spans: [{ from: 0, to: 1, label: 'one' }, { from: 2, to: 3, label: 'two' }] }))
            s.play(strip.span('one', 1, 2))
        })
        expect(clash).toMatch(/the span "one" would be on the span "two".*strip\.span\("two", null\)/)
    })

    it('puts one window around a run of tokens, slides it, and takes it away', async () => {
        let strip!: Strip
        await compile((s) => {
            strip = s.add(tokens(['a', 'b', 'c', 'd', 'e'], { size: 40 }))
            expect(strip.windowRange).toBeNull()
            s.play(strip.window(0, 1), { duration: 1 })
            expect(strip.windowRange).toEqual([0, 1])
            s.play(strip.window(2, 4), { duration: 1 })
            expect(strip.windowRange).toEqual([2, 4])
            s.play(strip.window(null), { duration: 1 })
            expect(strip.windowRange).toBeNull()
            // A window that comes back does not slide from its old place: it comes in at the new one.
            s.play(strip.window(0), { duration: 1 })
            expect(strip.windowRange).toEqual([0, 0])
        }, { fps: 20 })
        const frame = strip.frame!
        const around = (from: number, to: number) => {
            const [left, right] = [ends(strip.token(from).box)[0], ends(strip.token(to).box)[1]], [a, b] = ends(frame)
            // The outline is around its cells, in the room before the next cell.
            expect(a).toBeLessThan(left)
            expect(a).toBeGreaterThan(left - 40 * 0.28)
            expect(b).toBeGreaterThan(right)
            expect(b).toBeLessThan(right + 40 * 0.28)
            expect(frame.bounds().y).toBeLessThan(strip.token(from).box.bounds().y)
        }
        at(0, () => expect(shows(frame)).toBe(0))
        at(1, () => { expect(shows(frame)).toBe(1); around(0, 1) })
        at(1.5, () => {
            expect(ends(frame)[0]).toBeGreaterThan(ends(strip.token(0).box)[1])
            expect(ends(frame)[0]).toBeLessThan(ends(strip.token(2).box)[0] - 10)
            expect(shows(frame)).toBe(1)
        })
        at(2, () => around(2, 4))
        at(3, () => expect(shows(frame)).toBe(0))
        at(3.05, () => around(0, 0))
        at(4, () => { expect(shows(frame)).toBe(1); around(0, 0) })
    })

    it('adds tokens at the end, one after another, and leaves the tokens before them where they are', async () => {
        let strip!: Strip, before!: number[]
        await compile((s) => {
            strip = s.add(tokens(['The', ' cat'], { size: 40, rows: { id: [464, 3797] } }).at(-200, 0))
            before = strip.chips.map((cell) => cell.get('x'))
            s.wait(1)
            s.play(strip.append([{ text: ' sat', state: 'generated', values: { id: 3332 } }, ' on']), { duration: 2 })
            expect(strip.count).toBe(4)
            expect(strip.texts).toEqual(['The', ' cat', ' sat', ' on'])
            expect(strip.stateOf(2)).toBe('generated')
            expect(strip.value('id', 2)).toBe('3332')
            expect(strip.value('id', 3)).toBeNull()
        }, { fps: 20 })
        const [, cat, sat, on] = strip.chips
        at(1, () => expect([shows(sat!), shows(on!)]).toEqual([0, 0]))
        // The first new token is there while the second one has not started.
        at(1.6, () => {
            expect(shows(sat!)).toBeGreaterThan(0.2)
            expect(shows(on!)).toBe(0)
        })
        at(3, () => {
            expect(strip.chips.slice(0, 2).map((cell) => cell.get('x'))).toEqual(before)
            // Each new cell is one gap after the cell before it.
            expect(ends(sat!.box)[0] - ends(cat!.box)[1]).toBeCloseTo(40 * 0.28, 6)
            expect(ends(on!.box)[0] - ends(sat!.box)[1]).toBeCloseTo(40 * 0.28, 6)
            expect([shows(sat!), shows(on!), shows(strip.row('id').values[2]!)]).toEqual([1, 1, 1])
            expect(middle(strip.row('id').values[2]!)).toBeCloseTo(middle(sat!.box), 0)
            expect(sat!.box.get('fill')).toEqual(paint('green'))
        })
    })

    it('flies a new token from a point of the stage to the end of the strip', async () => {
        let strip!: Strip
        await compile((s) => {
            strip = s.add(tokens(['The'], { size: 40 }).at(-300, -100))
            const source = s.add(rect(120, 60).at(400, 250))
            s.wait(1)
            s.play(strip.append(' cat', { from: source }), { duration: 1 })
        }, { fps: 20 })
        const cell = strip.token(1)
        at(1, () => {
            expect(shows(cell)).toBe(0)
            expect(middle(cell.box)).toBeCloseTo(400, 6)
            expect(cell.box.bounds().y + cell.box.bounds().height / 2).toBeCloseTo(250, 6)
        })
        // It shows early, so the viewer sees it fly.
        at(1.5, () => {
            expect(shows(cell)).toBe(1)
            expect(middle(cell.box)).toBeGreaterThan(-200)
            expect(middle(cell.box)).toBeLessThan(380)
        })
        at(2, () => {
            expect(ends(cell.box)[0] - ends(strip.token(0).box)[1]).toBeCloseTo(40 * 0.28, 6)
            expect(cell.box.bounds().y).toBeCloseTo(strip.token(0).box.bounds().y, 6)
        })
    })

    it('measures a strip with a width as its room, starts at the left end of the room, and stops a token that does not fit', async () => {
        await compile((s) => {
            const strip = s.add(tokens(['The', ' cat'], { size: 40, width: 600 }).at(100, 0))
            expect(boxOf(strip).left).toBeCloseTo(-200, 6)
            expect(boxOf(strip).right).toBeCloseTo(400, 6)
            expect(ends(strip.token(0).box)[0]).toBeCloseTo(-200, 6)
            // With the names of its rows, all of the strip is as wide as the region that `fitted` gets.
            const region = new LayoutBox(-700, -100, 700, 100)
            const fit = placeIn(fitted(region, (width) => tokens(['The', ' cat'], { size: 40, width, label: 'input', rows: { position: [0, 1] } })), region)
            expect(boxOf(fit).left).toBeCloseTo(-700, 0)
            expect(boxOf(fit).right).toBeCloseTo(700, 0)
            expect(ends(fit.token(0).box)[0]).toBeGreaterThan(ends(fit.row('position').name!)[1])
            // A strip with no width is as wide as its cells, and `place` centers it.
            const plain = placeIn(tokens(['The', ' cat', ' sat'], { size: 40 }), region)
            expect((ends(plain.token(0).box)[0] + ends(plain.token(2).box)[1]) / 2).toBeCloseTo(0, 6)
        })
        expect(message(() => tokens(['tokenization', 'is', 'hard'], { size: 40, width: 300 }))).toMatch(/the 3 tokens are (\d+) px wide at size 40, and the width is 300\. Give a width of \1 or more/)
        const full = await failure((s) => { const strip = s.add(tokens(['The', ' cat'], { size: 40, width: 260 })); s.play(strip.append(' sat')) })
        expect(full).toMatch(/append: the tokens would be (\d+) px wide, and the width of the strip is 260\. Give the strip a width of \1 or more/)
        const need = Number(/width of (\d+) or more/.exec(full)![1])
        expect(await failure((s) => { const strip = s.add(tokens(['The', ' cat'], { size: 40, width: need })); s.play(strip.append(' sat')) })).toBe('')
        expect(await failure((s) => { const strip = s.add(tokens(['rain'], { size: 40, width: 200 })); s.play(strip.split(0, ['r', 'a', 'i', 'n'])) })).toMatch(/split: the tokens would be \d+ px wide/)
    })

    it('checks the fixed room before replacing tokens in a merge', async () => {
        let strip!: Strip
        const full = await failure((s) => {
            strip = s.add(tokens(['a', 'b'], { size: 40, width: 150 }))
            s.play(strip.merge(0, 1, 'tokenization'))
        })
        expect(full).toMatch(/merge: the tokens would be (\d+) px wide, and the width of the strip is 150\. Give the strip a width of \1 or more/)
        expect(strip.texts).toEqual(['a', 'b'])
        const need = Number(/width of (\d+) or more/.exec(full)![1])
        const f = await compile((s) => {
            strip = s.add(tokens(['a', 'b'], { size: 40, width: need }))
            s.play(strip.merge(0, 1, 'tokenization'))
        })
        at(f.duration, () => expect(ends(strip.token(0).box)[1]).toBeLessThanOrEqual(need / 2 + 0.5))
        expect(await failure((s) => {
            const valued = s.add(tokens(['a', 'b', 'c'], { size: 40, width: 220, rows: { id: [] } }))
            s.play(valued.merge(0, 1, { values: { id: '1234567890' } }))
        })).toMatch(/merge: the tokens would be \d+ px wide/)
        expect(await failure((s) => {
            const fit = s.add(tokens(['a', 'b', 'c'], { size: 40, width: 220 }))
            s.play(fit.merge(0, 1))
        })).toBe('')
    })

    it('cuts a token into its pieces: each letter goes from its place in the token to its piece, and the tokens after it make room', async () => {
        let strip!: Strip, old!: Node, after!: Node, start!: (readonly [string, number])[], afterAt!: number, oldEnds!: readonly [number, number]
        await compile((s) => {
            strip = s.add(tokens([{ text: 'unkind', state: 'cached', color: 'teal' }, ' words'], { size: 40, rows: { id: [1, 2] }, states: { ...TOKEN_STATES, rare: { color: 'orange', mark: 'dot' } } }))
            old = strip.token(0)
            after = strip.token(1)
            s.wait(1)
            start = at(1, () => letters(strip))
            afterAt = after.get('x')
            oldEnds = ends(strip.token(0).box)
            s.play(strip.split(0, ['un', { text: 'kind', state: 'rare', values: { id: 7 } }]), { duration: 1 })
            expect(strip.texts).toEqual(['un', 'kind', ' words'])
            expect(strip.count).toBe(3)
            // A piece has the state of its token, and a piece that names a state has that one.
            expect([strip.stateOf(0), strip.stateOf(1)]).toEqual(['cached', 'rare'])
            expect([strip.value('id', 0), strip.value('id', 1), strip.value('id', 2)]).toEqual([null, '7', '2'])
        }, { fps: 20 })
        const [un, kind] = strip.chips
        // Just after the start, the picture is the same: each letter is where it was, in its piece now.
        at(1.001, () => {
            const now = letters(strip)
            expect(now.map(([key]) => key).join('')).toBe('unkind·words')
            now.forEach(([, x], index) => expect(x).toBeCloseTo(start[index]![1], 1))
            expect(shows(old)).toBeGreaterThan(0)
            // The boxes of the two pieces are the two parts of the box of the token: they start at its ends, and they meet.
            expect(ends(un!.box)[0]).toBeCloseTo(oldEnds[0], 1)
            expect(ends(kind!.box)[1]).toBeCloseTo(oldEnds[1], 1)
            expect(ends(kind!.box)[0]).toBeCloseTo(ends(un!.box)[1], 1)
        })
        at(2, () => {
            // The old cell is gone, and the two pieces are side by side with one gap between them.
            expect(old.get('visible')).toBe(false)
            expect(ends(kind!.box)[0] - ends(un!.box)[1]).toBeCloseTo(40 * 0.28, 6)
            expect(ends(after)[0] - ends(kind!.box)[1]).toBeCloseTo(40 * 0.28, 6)
            // The token after them moved right, by the room that the cut needs: a gap, and the sides of one more box.
            expect(after.get('x') - afterAt).toBeGreaterThan(40 * 0.28 + 20)
            for (const cell of [un!, kind!]) expect(Math.abs(middle(cell.text) - middle(cell.box))).toBeLessThan(2)
            expect([shows(un!.box), shows(kind!.box), shows(kind!.signs[0]!)]).toEqual([1, 1, 1])
            expect(middle(strip.row('id').values[1]!)).toBeCloseTo(middle(kind!.box), 0)
            expect(middle(strip.row('id').values[2]!)).toBeCloseTo(middle(after), 0)
        })
        // A piece keeps the color of the token for a state with no color, and a piece with its own state has the look of that state.
        at(2, () => {
            expect(un!.box.get('stroke')).toEqual(paint('yellow'))
            expect(un!.tint).toBe('teal')
            expect(kind!.box.get('stroke')).toEqual(paint('orange'))
        })
    })

    it('joins tokens into one: the letters go to their places in the new token, and the tokens after it close the room', async () => {
        let strip!: Strip, olds!: Node[], after!: Node, start!: (readonly [string, number])[], afterAt!: number
        await compile((s) => {
            strip = s.add(tokens([{ text: 'r', state: 'cached' }, { text: 'a', state: 'cached' }, 'i', 'n'], { size: 40, color: 'teal', rows: { id: [114, 97, 105, 110] } }))
            olds = [strip.token(0), strip.token(1)]
            after = strip.token(2)
            s.wait(1)
            start = at(1, () => letters(strip))
            afterAt = after.get('x')
            s.play(strip.merge(0, 1, { values: { id: 256 } }), { duration: 1 })
            expect(strip.texts).toEqual(['ra', 'i', 'n'])
            // The new token has the state that the old ones share.
            expect(strip.stateOf(0)).toBe('cached')
            expect(strip.value('id', 0)).toBe('256')
        }, { fps: 20 })
        const made = strip.token(0)
        at(1.001, () => {
            const now = letters(strip)
            expect(now.map(([key]) => key).join('')).toBe('rain')
            now.forEach(([, x], index) => expect(x).toBeCloseTo(start[index]![1], 1))
        })
        at(2, () => {
            expect(olds.map((old) => old.get('visible'))).toEqual([false, false])
            expect(shows(made.box)).toBe(1)
            expect(Math.abs(middle(made.text) - middle(made.box))).toBeLessThan(2)
            expect(ends(after)[0] - ends(made.box)[1]).toBeCloseTo(40 * 0.28, 6)
            // The token after the pair moved left, by the room that the pair gave up: a gap, and the sides of one box.
            expect(afterAt - after.get('x')).toBeGreaterThan(40 * 0.28 + 20)
            // The copies of the two old boxes are gone, and only the new box shows.
            expect(made.children.filter((node) => !made.signs.includes(node) && node.get('path') !== null && node.get('stroke') !== null && node.get('visible'))).toEqual([made.box])
            expect(middle(strip.row('id').values[0]!)).toBeCloseTo(middle(made.box), 0)
            expect(shows(strip.row('id').values[0]!)).toBe(1)
        })
        // Half way, the two old boxes are still two boxes, nearer to each other than at the start.
        at(1.5, () => {
            const copies = made.children.filter((node) => node !== made.box && !made.signs.includes(node) && node.get('path') !== null && node.get('stroke') !== null)
            expect(copies).toHaveLength(2)
            expect(copies.map(shows)).toEqual([1, 1])
            const room = ends(copies[1]!)[0] - ends(copies[0]!)[1]
            expect(room).toBeGreaterThan(0)
            expect(room).toBeLessThan(40 * 0.28)
        })
    })

    it('never cuts a box through a letter: the parts of a split and of a merge meet between two letters', async () => {
        let strip!: Strip
        await compile((s) => {
            // The values make the cells of these letters as wide as three digits, so parts in proportion to the cells would cut "rai" inside its "a".
            strip = s.add(tokens(['ra', 'i'], { size: 40, rows: { id: [256, 105] } }))
            s.wait(1)
            s.play(strip.merge(0, 1), { duration: 1 })
            s.play(strip.split(0, ['r', 'ai']), { duration: 1 })
        }, { fps: 20 })
        const boxes = (cell: Node, own: Node) => cell.children.filter((node) => node !== own && node.get('path') !== null && node.get('stroke') !== null)
        // At the end of the merge, the two copies meet between the "a" and the "i" of the new text.
        const merged = strip.children.find((node) => source((node as { text?: Node }).text ?? null) === 'rai') as Node & { box: Node; text: Node }
        at(1.999, () => {
            const cut = ends(boxes(merged, merged.box)[0]!)[1]
            const [, a, i] = merged.text.children
            expect(cut).toBeGreaterThan(ends(a!)[1])
            expect(cut).toBeLessThan(ends(i!)[0])
        })
        // At the start of the split, the two pieces meet between the "r" and the "a" of the old text.
        at(2.001, () => {
            const [r, ai] = strip.chips
            const cut = ends(r!.box)[1]
            expect(cut).toBeCloseTo(ends(ai!.box)[0], 1)
            expect(cut).toBeGreaterThan(ends(r!.text.children[0]!)[1])
            expect(cut).toBeLessThan(ends(ai!.text.children[0]!)[0])
        })
    })

    it('plays two merges in one play: each pair joins where it is, and the strip is right at the end', async () => {
        let strip!: Strip, start!: (readonly [string, number])[]
        await compile((s) => {
            strip = s.add(tokens([...'rain·train'], { size: 40 }))
            s.wait(1)
            start = at(1, () => letters(strip))
            // From the right, so the first merge does not change the index of the second pair.
            s.play(strip.merge(6, 7), strip.merge(0, 1), { duration: 1 })
            expect(strip.texts).toEqual(['ra', 'i', 'n', '·', 't', 'ra', 'i', 'n'])
        }, { fps: 20 })
        // No letter jumps at the start, also in the pair that the other merge moves.
        at(1.001, () => letters(strip).forEach(([, x], index) => expect(x).toBeCloseTo(start[index]![1], 1)))
        // Half way, the letters of the second pair are inside the copies of their boxes, which go with the new cell.
        at(1.5, () => {
            const cell = strip.token(5)
            const copies = cell.children.filter((node) => node !== cell.box && node.get('path') !== null && node.get('stroke') !== null)
            cell.text.children.forEach((glyph, index) => {
                expect(middle(glyph)).toBeGreaterThan(ends(copies[index]!)[0])
                expect(middle(glyph)).toBeLessThan(ends(copies[index]!)[1])
            })
        })
        at(2, () => {
            strip.chips.forEach((cell, index) => {
                expect(Math.abs(middle(cell.text) - middle(cell.box))).toBeLessThan(2)
                if (index > 0) expect(ends(cell.box)[0] - ends(strip.token(index - 1).box)[1]).toBeCloseTo(40 * 0.28, 6)
            })
        })
        // Two splits in one play, from the left: the first split moves the second token, which starts where it is.
        let cut!: Strip, whole!: (readonly [string, number])[]
        await compile((s) => {
            cut = s.add(tokens(['rain', 'train'], { size: 40 }))
            s.wait(1)
            whole = at(1, () => letters(cut))
            s.play(cut.split(0, ['ra', 'in']), cut.split(2, ['tra', 'in']), { duration: 1 })
            expect(cut.texts).toEqual(['ra', 'in', 'tra', 'in'])
        }, { fps: 20 })
        at(1.001, () => letters(cut).forEach(([, x], index) => expect(x).toBeCloseTo(whole[index]![1], 1)))
        // From the left, the first merge moves the second pair. That pair still starts where it is.
        let other!: Strip, before!: (readonly [string, number])[]
        await compile((s) => {
            other = s.add(tokens([...'rain·train'], { size: 40 }))
            s.wait(1)
            before = at(1, () => letters(other))
            s.play(other.merge(0, 1), other.merge(5, 6), { duration: 1 })
            expect(other.texts).toEqual(['ra', 'i', 'n', '·', 't', 'ra', 'i', 'n'])
        }, { fps: 20 })
        at(1.001, () => letters(other).forEach(([, x], index) => expect(x).toBeCloseTo(before[index]![1], 1)))
        at(2, () => other.chips.forEach((cell, index) => {
            expect(Math.abs(middle(cell.text) - middle(cell.box))).toBeLessThan(2)
            if (index > 0) expect(ends(cell.box)[0] - ends(other.token(index - 1).box)[1]).toBeCloseTo(40 * 0.28, 6)
        }))
    })

    it('with another text for the new token, shows the old texts and the new one at different times', async () => {
        let strip!: Strip, olds!: Node[]
        await compile((s) => {
            strip = s.add(tokens([{ text: 'c3', color: 'orange' }, 'a9', '!'], { size: 40 }))
            olds = [strip.token(0).text, strip.token(1).text]
            s.play(strip.merge(0, 1, 'é'), { duration: 1 })
            expect(strip.texts).toEqual(['é', '!'])
            s.play(strip.split(0, ['c3', 'a9']), { duration: 1 })
            expect(strip.texts).toEqual(['c3', 'a9', '!'])
        }, { fps: 20 })
        const merged = strip.children.find((node) => source((node as { text?: Node }).text ?? null) === 'é') as Node & { text: Node }
        const pieces = [strip.token(0).text, strip.token(1).text]
        const up = (node: Node) => (node.get('visible') && (node.parent as Node).get('visible') ? node.get('opacity') : 0)
        for (let time = 0; time <= 2.0001; time += 0.05) {
            at(time, () => {
                const texts = [olds.some((old) => up(old) > 0), up(merged.text) > 0, pieces.some((piece) => up(piece) > 0)]
                expect(texts.filter(Boolean).length, `at ${time}`).toBeLessThanOrEqual(1)
            })
        }
        // An old text fades: it is nearly gone when its cell is hidden.
        at(0.38, () => { for (const old of olds) expect(old.get('opacity')).toBeLessThan(0.1) })
        at(1, () => {
            expect(up(merged.text)).toBe(1)
            // The new token has the color of the first old one.
            expect((merged as unknown as { box: Node }).box.get('stroke')).toEqual(paint('orange'))
        })
        at(2, () => expect(pieces.map(up)).toEqual([1, 1]))
    })

    it('keeps a bracket and the window on their tokens when a change moves or replaces them', async () => {
        let strip!: Strip
        await compile((s) => {
            strip = s.add(tokens(['a', 'b', 'c', 'd', 'e'], { size: 40, spans: [{ from: 1, to: 2, label: 'pair' }, { from: 4, to: 4, label: 'end' }] }))
            s.play(strip.window(3, 4), { duration: 0.5 })
            // The pair becomes one token, and the last token becomes two.
            s.play(strip.merge(1, 2), { duration: 1 })
            expect(strip.spanRange('pair')).toEqual([1, 1])
            expect(strip.spanRange('end')).toEqual([3, 3])
            expect(strip.windowRange).toEqual([2, 3])
            s.play(strip.split(3, ['e', 'f']), { duration: 1 })
            expect(strip.spanRange('end')).toEqual([3, 4])
            expect(strip.windowRange).toEqual([2, 4])
        }, { fps: 20 })
        const [pair, end] = ['pair', 'end'].map((id) => strip.spans.find((span) => span.key === id)), frame = strip.frame!
        at(1.5, () => {
            expect(ends(pair!.bracket)[0]).toBeCloseTo(ends(strip.token(1).box)[0], 6)
            expect(ends(pair!.bracket)[1]).toBeCloseTo(ends(strip.token(1).box)[1], 6)
            expect(Math.abs(middle(pair!.text!) - middle(strip.token(1).box))).toBeLessThan(2)
            expect(ends(frame)[0]).toBeLessThan(ends(strip.token(2).box)[0])
            expect(ends(frame)[0]).toBeGreaterThan(ends(strip.token(1).box)[1])
        })
        at(2.5, () => {
            expect(ends(end!.bracket)[0]).toBeCloseTo(ends(strip.token(3).box)[0], 6)
            expect(ends(end!.bracket)[1]).toBeCloseTo(ends(strip.token(4).box)[1], 6)
            expect(ends(frame)[1]).toBeGreaterThan(ends(strip.token(4).box)[1])
            expect(ends(frame)[1]).toBeLessThan(ends(strip.token(4).box)[1] + 40 * 0.28)
        })
    })

    it('stops a split or a merge of a token that the change before it still brings in', async () => {
        const early = await failure((s) => { const strip = s.add(tokens(['r', 'a', 'i'], { size: 40 })); s.play(strip.merge(0, 1), strip.split(0, ['r', 'a'])) })
        expect(early).toMatch(/split at 0 s takes token 0 \("ra"\), which the change before it still brings in until 0\.9 s\. Play the two one after the other/)
        const flying = await failure((s) => { const strip = s.add(tokens(['r'], { size: 40 })); s.play(strip.append('a'), strip.merge(0, 1)) })
        expect(flying).toMatch(/merge at 0 s takes token 1 \("a"\)/)
        // One after the other, the same two changes work.
        expect(await failure((s) => { const strip = s.add(tokens(['r', 'a', 'i'], { size: 40 })); s.play(seq(strip.merge(0, 1), strip.split(0, ['r', 'a']), strip.merge(1, 2))); expect(strip.texts).toEqual(['r', 'ai']) })).toBe('')
    })

    it('gives the points where a line to a token ends: under the rows, over the brackets, and at the sides', async () => {
        await compile((s) => {
            const strip = s.add(tokens(['The', ' cat', ' sat'], { size: 40, rows: { position: [0, 1, 2], id: [464, 3797, 3332] }, spans: [{ from: 1, to: 2, label: 'words' }] }).at(120, -60))
            const world = (index: number, edge?: 'top' | 'bottom' | 'left' | 'right') => strip.toWorld(...strip.p(index, edge))
            const cell = strip.token(1).box.bounds(), value = strip.row('id').values[1]!.bounds(), label = strip.spans[0]!.text!.bounds()
            // The bottom point is under the last row, and the top point is over the label of the bracket.
            expect(world(1)[0]).toBeCloseTo(cell.x + cell.width / 2, 6)
            expect(world(1)[1]).toBeGreaterThan(value.y + value.height)
            expect(world(1)[1]).toBeLessThan(value.y + value.height + 40)
            expect(world(1, 'top')[1]).toBeLessThan(label.y)
            expect(world(1, 'top')[1]).toBeGreaterThan(label.y - 40)
            // A token with no bracket over it has its top point on its box.
            expect(world(0, 'top')[1]).toBeCloseTo(strip.token(0).box.bounds().y, 6)
            expect(world(1, 'left')).toEqual([cell.x, cell.y + cell.height / 2])
            expect(world(1, 'right')).toEqual([cell.x + cell.width, cell.y + cell.height / 2])
            // A strip with no rows has its bottom point on the box.
            const bare = tokens(['a'], { size: 40 })
            expect(bare.p(0)[1]).toBeCloseTo(bare.token(0).box.bounds().height / 2, 6)
            // The region of a run of tokens is the box of their cells, and the region of a row is the part of the row under them.
            const run = strip.region({ from: 1, to: 2 })
            expect([run.left, run.right, run.top, run.bottom]).toEqual([cell.x, ends(strip.token(2).box)[1], cell.y, cell.y + cell.height])
            const all = strip.region()
            expect(all.left).toBeCloseTo(ends(strip.token(0).box)[0], 6)
            const row = strip.region({ from: 1, to: 1, row: 'id' })
            expect(row.top).toBeLessThan(value.y)
            expect(row.bottom).toBeGreaterThan(value.y + value.height)
            expect(row.top).toBeGreaterThan(strip.row('position').values[1]!.bounds().y)
        })
    })

    it('measures the full boundary of a region in a rotated group', async () => {
        await compile((s) => {
            const strip = tokens(['a'], { size: 40, rows: { id: [7] } })
            s.add(group(strip).rotate(Math.PI / 4).scale([1.2, 0.8]).at(120, -60))
            const region = strip.region(), cell = strip.token(0).box.bounds()
            expect(region.left).toBeCloseTo(cell.x, 6)
            expect(region.top).toBeCloseTo(cell.y, 6)
            expect(region.width).toBeCloseTo(cell.width, 6)
            expect(region.height).toBeCloseTo(cell.height, 6)
            const row = strip.region({ row: 'id' }), value = strip.value('id', 0)
            expect(value).toBe('7')
            const ink = strip.row('id').values[0]!.bounds()
            expect(row.left).toBeLessThan(ink.x)
            expect(row.right).toBeGreaterThan(ink.x + ink.width)
            expect(row.top).toBeLessThan(ink.y)
            expect(row.bottom).toBeGreaterThan(ink.y + ink.height)
        })
    })

    it('links the tokens of two strips: one line for each pair, from under the upper token to over the lower one', async () => {
        await compile((s) => {
            const upper = s.add(tokens(['the', 'red', 'bicycle'], { size: 40, rows: { id: [1, 2, 3] } }).at(-100, -200))
            const lower = s.add(tokens(['le', 'vélo', 'rouge'], { size: 40, spans: [{ from: 1, to: 2, label: 'noun' }] }).at(80, 150))
            const lines = upper.links(lower, [[0, 0], [1, 2], [2, 1, 0.5]])
            expect(lines.children).toHaveLength(3)
            const tip = (line: Node, part: 'start' | 'end') => { const p = line.get('path')![0]!.p; return part === 'start' ? [p[0]!, p[1]!] : [p[p.length - 2]!, p[p.length - 1]!] }
            const pairs = [[0, 0], [1, 2], [2, 1]] as const
            pairs.forEach(([from, to], index) => {
                expect(tip(lines.children[index]!, 'start')).toEqual(upper.toWorld(...upper.p(from, 'bottom')))
                expect(tip(lines.children[index]!, 'end')).toEqual(lower.toWorld(...lower.p(to, 'top')))
            })
            // A line ends under the values of the upper strip, and over the label of the bracket of the lower one.
            expect(tip(lines.children[1]!, 'start')[1]).toBeGreaterThan(upper.row('id').values[1]!.bounds().y + upper.row('id').values[1]!.bounds().height)
            expect(tip(lines.children[1]!, 'end')[1]).toBeLessThan(lower.spans[0]!.text!.bounds().y)
            // A pair with a weight has a line that is weaker than a pair with none.
            expect(lines.children[2]!.get('strokeOpacity')).toBeLessThan(lines.children[0]!.get('strokeOpacity'))
            // From the lower strip, the same pair has the same two points.
            const back = lower.links(upper, [[0, 0]])
            expect(tip(back.children[0]!, 'start')).toEqual(tip(lines.children[0]!, 'end'))
            expect(tip(back.children[0]!, 'end')).toEqual(tip(lines.children[0]!, 'start'))
        })
        expect(await failure((s) => { const a = s.add(tokens(['a']).at(-200, 0)), b = s.add(tokens(['b']).at(200, 0)); a.links(b, [[0, 0]]) })).toMatch(/links: the two strips are at one height.*Put one strip over the other/)
        expect(await failure((s) => { const a = s.add(tokens(['a']).at(0, -200)), b = s.add(tokens(['b']).at(0, 200)); a.links(b, [[0, 3]]) })).toMatch(/links: no token 3\. The strip has 1 token, 0/)
        // Two strips with too little room between them: the room is from under the values of one to over the brackets of the other.
        const near = await failure((s) => {
            const a = s.add(tokens(['a', 'b'], { size: 40, rows: { id: [1, 2] } }).at(0, -110)), b = s.add(tokens(['c', 'd'], { size: 40, spans: [{ from: 0, to: 1, label: 'pair' }] }).at(0, 110))
            a.links(b, [[0, 1]])
        })
        expect(near).toMatch(/links: the room between the two strips is \d+ px, from under the values of the upper one to over the brackets of the lower one\. A line needs 60 px or more\. Move the strips apart/)
    })

    it('reports zero room when endpoint clearances overlap at different heights', async () => {
        for (const reverse of [false, true]) {
            const error = await failure((s) => {
                const upper = tokens(['a'], { size: 40, rows: { id: [1] } }).at(0, -70)
                const lower = tokens(['b'], { size: 40, spans: [{ from: 0, to: 0, label: 'label' }] }).at(0, 70)
                s.add(group(upper, lower).scale(0.8))
                if (reverse) lower.links(upper, [[0, 0]])
                else upper.links(lower, [[0, 0]])
            })
            expect(error).toMatch(/links: the room between the two strips is 0 px,.*A line needs 48 px or more\. Move the strips apart/)
        }
    })

    it('keeps links clear of row values and bracket labels in a scaled group', async () => {
        const film = await compile((s) => {
            const upper = tokens(['le', ' vélo', ' rouge'], { size: 40, rows: { id: [1, 2, 3] } }).at(0, -70)
            const lower = tokens(['the', ' red', ' bicycle'], { size: 40, spans: [{ from: 1, to: 2, label: 'noun phrase' }] }).at(40, 250)
            s.add(group(upper, lower).at(350, 0).scale(0.8))
            s.add(upper.links(lower, [[0, 0], [1, 2, 0.9], [2, 1, 0.4]]))
            s.wait(2)
        })
        const report = await checkFilm(film, { textGap: 0.7 })
        expect(report.diagnostics).toEqual([])
    })

    it('starts an arc over the box of a token, also when the token has a mark on its corner', async () => {
        await compile((s) => {
            const strip = s.add(tokens(['a', { text: 'b', state: 'cached' }, 'c'], { size: 40 }))
            const arcs = strip.arcs(1, [1, 0, 1])
            const box = strip.token(1).box.bounds()
            for (const arc of arcs.children) {
                const p = arc.get('path')![0]!.p
                expect(p[0]).toBeCloseTo(box.x + box.width / 2, 6)
                expect(p[1]).toBeCloseTo(box.y - 3, 6)
            }
        })
    })

    it('keeps a strip that wraps a plain row of chips: its tokens take a state, and it takes no part that needs one line', async () => {
        let strip!: Strip
        await compile((s) => {
            strip = s.add(tokens('the quick brown fox jumps over the lazy dog'.split(' '), { size: 40, maxWidth: 500 }))
            // The strip has more than one line.
            expect(new Set(strip.chips.map((cell) => cell.get('y'))).size).toBeGreaterThan(1)
            s.play(strip.mark((_, index) => index % 2 === 1, 'masked'), { duration: 1 })
            expect(strip.find((token) => token.state === 'masked')).toEqual([1, 3, 5, 7])
            // The points of a token on a second line are on that line.
            expect(strip.p(8, 'left')[1]).toBeCloseTo(strip.token(8).get('y'), 6)
            const box = strip.region({ from: 0, to: 8 })
            expect(box.height).toBeGreaterThan(strip.token(0).box.bounds().height * 2)
        }, { fps: 20 })
        at(1, () => expect(strip.token(1).box.get('stroke')).toEqual(paint('dim')))
        for (const run of [() => strip.append('x'), () => strip.split(0, ['t', 'he']), () => strip.merge(0, 1), () => strip.window(0, 1), () => strip.span('s', 0, 1)]) {
            expect(message(run)).toMatch(/works on a strip of one line, and this strip starts new lines at maxWidth 500\. Leave out maxWidth, or give width/)
        }
        for (const options of [{ rows: { id: [1] } }, { spans: [{ from: 0, to: 0 }] }, { label: 'input' }, { even: true }, { width: 400 }]) {
            expect(message(() => tokens(['a'], { maxWidth: 300, ...options }))).toMatch(/is for a strip of one line, and maxWidth starts new lines/)
        }
    })

    it('makes a copy with its own tokens: a change of the copy leaves the first strip as it is', async () => {
        await compile((s) => {
            const first = s.add(tokens(['The', ' cat'], { size: 40, rows: { id: [464, 3797] }, spans: [{ from: 0, to: 1, label: 'words' }] }).at(0, -200))
            const copy = s.add(first.clone().at(0, 200))
            s.play(copy.append(' sat'), copy.mark(0, 'masked'), copy.span('more', 1, 1), copy.setValue('id', 0, 7))
            expect([copy.count, copy.stateOf(0), copy.value('id', 0), copy.spans.length]).toEqual([3, 'masked', '7', 2])
            expect([first.count, first.stateOf(0), first.value('id', 0), first.spans.length]).toEqual([2, 'kept', '464', 1])
            // The parts of the copy are its own nodes.
            expect(copy.token(0)).not.toBe(first.token(0))
            expect(copy.token(0).parent).toBe(copy)
            expect(copy.row('id').values[1]!.parent).toBe(copy.row('id'))
            expect(copy.spans[0]!.first).toBe(copy.token(0))
            // A strip with no token, no value and no bracket gives its copy lists of its own too.
            const empty = s.add(tokens([], { size: 40, rows: { id: [] } }).at(-600, 0))
            const filled = s.add(empty.clone().at(-600, 300))
            s.play(filled.append('a'))
            s.play(filled.span('all', 0, 0), filled.setValue('id', 0, 7))
            expect([filled.count, filled.spans.length, filled.value('id', 0), filled.row('id').values.length]).toEqual([1, 1, '7', 1])
            expect([empty.count, empty.spans.length, empty.row('id').values.length]).toEqual([0, 0, 0])
            const bare = s.add(tokens(['a', 'b'], { size: 40, rows: { id: [] } }).at(600, 0))
            const valued = s.add(bare.clone().at(600, 300))
            s.play(valued.setValue('id', 1, 9))
            expect([valued.value('id', 1), bare.value('id', 1)]).toEqual(['9', null])
        })
    })

    it.each([false, true])('isolates empty lists when a grouped strip or its copy changes (source: %s)', async (changeSource) => {
        await compile((s) => {
            const empty = tokens([], { size: 40, rows: { id: [] } })
            const bare = tokens(['a', 'b'], { size: 40, rows: { id: [] } })
            const original = s.add(group(group(empty, bare)))
            const copy = s.add(original.clone())
            const strips = copy.children[0]!.children as Strip[]
            const [filled, untouched] = changeSource ? [empty, strips[0]!] : [strips[0]!, empty]
            const [valued, unvalued] = changeSource ? [bare, strips[1]!] : [strips[1]!, bare]
            s.play(filled.append({ text: 'a', values: { id: 7 } }), valued.setValue('id', 1, 9), valued.span('only', 0, 1), valued.mark(0, 'dropped'))
            expect([filled.count, filled.value('id', 0)]).toEqual([1, '7'])
            expect([untouched.count, untouched.row('id').values.length]).toEqual([0, 0])
            expect([valued.value('id', 1), valued.spanRange('only'), valued.stateOf(0)]).toEqual(['9', [0, 1], 'dropped'])
            expect([unvalued.value('id', 1), unvalued.spanRange('only'), unvalued.stateOf(0)]).toEqual([null, null, 'kept'])
            s.play(valued.span('only', null), valued.split(1, ['b', 'c']))
            s.play(valued.merge(1, 2))
            expect(unvalued.texts).toEqual(['a', 'b'])
        })
    })

    it('keeps the edits of a cloned strip independent across a second group clone', async () => {
        await compile((s) => {
            const original = tokens(['a'], { rows: { id: [1] } })
            const parent = s.add(group(original))
            const copy = s.add(parent.clone())
            const second = copy.children[0] as Strip
            s.play(second.append({ text: 'b', values: { id: 2 } }))
            s.play(second.span('pair', 0, 1), second.window(0, 1))
            const third = s.add(copy.clone()).children[0] as Strip
            s.play(third.merge(0, 1, { values: { id: 3 } }))
            expect([original.texts, second.texts, third.texts]).toEqual([['a'], ['a', 'b'], ['ab']])
            expect([second.spanRange('pair'), third.spanRange('pair')]).toEqual([[0, 1], [0, 0]])
            expect([second.windowRange, third.windowRange]).toEqual([[0, 1], [0, 0]])
            expect([second.value('id', 1), third.value('id', 0)]).toEqual(['2', '3'])
            expect(second.token(0).data['box']).toBe(second.token(0).box)
        })
    })

    it('lets a grouped clone change cells whose source is still arriving', async () => {
        expect(await failure((s) => {
            const strip = tokens(['r'], { size: 40 })
            const original = s.add(group(strip))
            s.play(strip.append('a', { duration: 2 }))
            s.at(0.5, () => {
                const copy = s.add(original.clone()).children[0] as Strip
                s.play(copy.merge(0, 1))
                expect(copy.texts).toEqual(['ra'])
            })
            expect(strip.texts).toEqual(['r', 'a'])
        })).toBe('')
    })

    it('places every text of its own with room: the film check finds nothing in a strip with all its parts, in both looks', async () => {
        const all = film({ fps: 20 }, (s) => {
            const strip = tokens([{ text: '<s>' }, { text: 'You', state: 'cached' }, { text: ' are', state: 'masked' }, { text: ' kind', state: 'generated' }, { text: '.', state: 'dropped' }, { text: 'Hi', state: 'accepted' }], {
                size: 40, label: 'input', rows: { position: [0, 1, 2, 3, 4, 5], id: [1, 887, 526, 8444, 29889, 6324] },
                spans: [{ from: 0, to: 4, label: 'system' }, { from: 5, to: 5, label: 'user' }, { from: 0, to: 5, label: 'prompt' }],
                states: { ...TOKEN_STATES, accepted: { color: 'green', mark: 'check' } },
            })
            s.play(strip.enter(), { duration: 1 })
            s.play(strip.window(1, 3), { duration: 0.5 })
            s.wait(1.5)
            // The texts that a change makes are texts of the strip too: a token and its values, a value, a label.
            s.play(strip.span('user', null), { duration: 0.3 })
            s.play(strip.append({ text: ' there', values: { position: 6, id: 727 } }), strip.setValue('id', 0, 2), { duration: 0.6 })
            s.play(strip.span('turn', 5, 6, { label: 'user turn' }), { duration: 0.4 })
            s.wait(1.5)
        })
        for (const look of ['midnight', 'paper'] as const) {
            for (const textGap of [0.3, 0.7]) expect((await checkFilm(all, { look, textGap })).diagnostics, `${look}, ${textGap}`).toEqual([])
        }
    })

    it('says what is wrong with an input, and what to give', async () => {
        await compile(() => { tokens(['a'], { rows: { id: [1] } }) })
        const strip = tokens(['The', 'cat', 'sat'], { size: 40, rows: { id: [1, 2, 3] } })
        const cases: [() => unknown, RegExp][] = [
            [() => tokens('abc' as never), /the first argument is "abc"\. Give the list of the tokens/],
            [() => tokens([{ text: null } as never]), /the text of token 0 is null/],
            [() => tokens(['a\nb'], { rows: {} }), /token 0 \("a\\nb"\) has a line break\. A token is one line/],
            [() => tokens([{ text: 'a', state: 'gone' }]), /no state "gone"\. The states are kept, masked, generated, cached, dropped/],
            [() => tokens(['a'], { states: {} }), /states has no state/],
            [() => tokens(['a'], { states: { kept: { mark: 'star' as never } } }), /the mark of the state "kept" is "star"/],
            [() => tokens(['a'], { states: { kept: { color: 'nope' } } }), /the color of the state "kept" is "nope", which is not a color/],
            [() => tokens(['a'], { size: 0, rows: {} }), /size is 0\. It is the text size of the tokens, more than 0/],
            [() => tokens(['a'], { size: Infinity }), /size is Infinity/],
            [() => tokens(['a'], { subSize: NaN }), /subSize is NaN/],
            [() => tokens(['a'], { size: 0 }).mark(0, 'masked'), /size is 0/],
            [() => tokens(['a\nb']).append('c'), /has a line break/],
            [() => tokens(['a'], { rows: { id: [1, 2] } }), /the row "id" has 2 values, and the strip has 1 token/],
            [() => tokens([{ text: 'a', sub: '1' }], { rows: { id: [1] } }), /token 0 has a sub, and a strip with rows has no line under a chip.*values: \{ id: "1" \}/],
            [() => tokens([{ text: 'a', values: { nope: 1 } }], { rows: { id: [1] } }), /no row "nope"\. The rows are "id"/],
            [() => tokens(['a', 'b'], { spans: [{ from: 0, to: 4 }] }), /span 0: no token 4\. The strip has 2 tokens, 0 to 1/],
            [() => tokens(['a', 'b'], { spans: [{ from: 1, to: 0 }] }), /span 0: the run starts at token 1 and ends at token 0/],
            [() => tokens(['a', 'b'], { spans: [{ from: 0, to: 0, label: 'x' }, { from: 1, to: 1, label: 'x' }] }), /two spans have the id "x"/],
            [() => strip.token(9), /no token 9\. The strip has 3 tokens, 0 to 2/],
            [() => strip.p(0, 'middle' as never), /the edge of p\(\) is 'top', 'bottom', 'left' or 'right', not "middle"/],
            [() => strip.row('nope'), /no row "nope"\. The rows are "id"/],
            [() => tokens(['a']).row('id'), /no row "id"\. The strip has no rows/],
            [() => strip.region({ lane: 1 } as never), /region has no part "lane"\. Its parts are: from, to, row/],
            [() => strip.mark(0, 'nope'), /no state "nope"/],
            [() => strip.mark('cat' as never, 'masked'), /mark takes an index, a list of indexes, or a function/],
            [() => strip.split(0, ['a']), /split takes the pieces of the token, two or more.*it got 1 piece/],
            [() => strip.merge(2, 1), /merge takes the first and the last token of a run of two or more/],
            [() => strip.merge(0, 1, { duration: 1 } as never), /the third argument of merge is the new token, and the options are the fourth/],
            [() => strip.shiftRow('id', 0), /shiftRow moves the values of a row by a whole number of cells/],
            [() => strip.window(0.5), /window takes the first and the last token under it/],
            [() => strip.span('', 0), /span takes the id of the bracket first/],
            [() => strip.links(strip, [[0, 0]]), /links joins two strips, and it got the same strip two times/],
            [() => strip.append([]), /append got an empty list/],
            [() => strip.append('x', { from: 'here' as never }), /append: from is "here"\. Give a node, or a point/],
        ]
        for (const [run, wanted] of cases) expect(message(run)).toMatch(wanted)
        // An index is read when the change plays, so a token of an append before it is there.
        expect(await failure((s) => { const made = s.add(tokens(['a'])); s.play(seq(made.append('b'), made.mark(1, 'generated'))) })).toBe('')
        expect(await failure((s) => { const made = s.add(tokens(['a', 'b'])); s.play(made.mark(5, 'masked')) })).toMatch(/mark: no token 5\. The strip has 2 tokens, 0 to 1 now\. A change reads its index when the film plays it, after the changes before it in the same play/)
        // A merge before a split in one play changes the index of the token to split, and the error says so.
        expect(await failure((s) => { const made = s.add(tokens(['to', 'ken', 'ize', 'r'])); s.play(made.merge(0, 2), made.split(3, ['r', 's'])) })).toMatch(/split: no token 3\. The strip has 2 tokens, 0 to 1 now\. A change reads its index when the film plays it/)
        expect(await failure((s) => { const made = s.add(tokens(['a', 'b'], { size: 40, even: true })); s.play(made.append('tokenization')) })).toMatch(/the token of append \("tokenization"\) needs a cell of (\d+) px.*Give the strip minWidth: \1, or leave out even/)
    })
})

describe('pipeline', () => {
    type Flow = ReturnType<typeof pipeline>
    const GATES = ['parse', 'schema', 'source', 'authority']
    // A width of 1000 at size 20: the arrow head has 18, so each of four stages has 245.5, and a capsule is 34 high.
    const sized = { width: 1000, size: 20 }
    const PITCH = 245.5
    const words = (node: Node | null) => (node as unknown as { source: string } | null)?.source
    /** How much of a node a viewer gets: its opacity and that of each holder over it, and 0 when one of them is hidden. */
    const shows = (node: Node) => {
        let value = 1
        for (let holder: Node | null = node; holder; holder = holder.parent) {
            if (!holder.get('visible')) return 0
            value *= holder.get('opacity')
        }
        return value
    }
    const paint = (color: string) => rect(1, 1, { fill: color, stroke: null }).get('fill')
    const LOOKS = ['open', 'visited', 'passed', 'stopped']
    /** What the mark of a stage shows at a time: the part that a viewer sees the most. */
    const lookOf = (flow: Flow, stage: number | string, time: number, lane = 0) => at(time, () => {
        const parts = flow.mark(stage, lane).children.map(shows)
        return LOOKS[parts.indexOf(Math.max(...parts))]
    })
    /** The badges of an item that a viewer can see at a time. */
    const badges = (item: PipelineItemNode, time: number, least = 0.99) => at(time, () => item.content.children.filter((part) => part !== item.idText && typeof words(part) === 'string' && shows(part) > least).map(words))
    /** The line of the count of a stage at a time. */
    const counted = (flow: Flow, stage: number, time: number) => at(time, () => flow.counters[stage]!.children.filter((part) => shows(part) > 0.99).map(words))
    const edges = (node: Node) => { const box = node.bounds(); return [box.x, box.y, box.x + box.width, box.y + box.height] as const }

    it('admits a new item to a free lane while another item exits', async () => {
        await compile((s) => {
            const flow = s.add(pipeline(GATES, { ...sized, lanes: 2 }))
            s.play(flow.put({ id: 'old' }))
            s.play(flow.exit('old'), flow.put({ id: 'new' }))
            expect(flow.stateOf('new').lane).toBe(1)
        })
    })

    it('reuses an id only after the previous capsule finishes leaving', async () => {
        await compile((s) => {
            const flow = s.add(pipeline(GATES, { ...sized, lanes: 2 }))
            s.play(flow.put({ id: 'x' }))
            expect(() => s.play(flow.exit('x'), flow.put({ id: 'x', lane: 1 }))).toThrow(/id "x".*free from/)
        })
    })

    it('fits the badge that the preceding change in a sequence leaves', async () => {
        await compile((s) => {
            const flow = s.add(pipeline(['a', 'b'], { width: 530, size: 28 }))
            s.play(flow.put({ id: 'x', badge: 'WWWWWW' }))
            s.play(seq(flow.setBadge('x', null), flow.pass('x')))
            expect(flow.stateOf('x')).toMatchObject({ state: 'passed', badge: undefined })
        })
    })

    it('moves only the copied pipeline when a film clones its containing group', async () => {
        await compile((s) => {
            const flow = pipeline(GATES, { ...sized, counts: true })
            const holder = s.add(group(flow))
            s.play(flow.put({ id: 'a' }))
            const copyHolder = s.add(holder.clone())
            const copy = copyHolder.children[0] as Flow
            expect(copy.item('a')).not.toBe(flow.item('a'))
            s.play(copy.move('a'))
            const next = s.add(copyHolder.clone()).children[0] as Flow
            s.play(next.move('a'))
            expect([flow.stateOf('a').stage, copy.stateOf('a').stage, next.stateOf('a').stage]).toEqual([0, 1, 2])
            expect([flow.reached(1), copy.reached(1)]).toEqual([0, 1])
            expect([flow.reached(2), copy.reached(2), next.reached(2)]).toEqual([0, 0, 1])
        })
    })

    it('can start a cloned pipeline earlier on the timeline than its source', async () => {
        await compile((s) => {
            const flow = s.add(pipeline(GATES, { ...sized, lanes: 2 }))
            s.play(flow.put([{ id: 'a' }, { id: 'b' }]))
            s.play(flow.move('a'), flow.exit('b'))
            const copy = flow.clone()
            s.at(0, () => s.play(copy.move('a'), copy.put({ id: 'b', lane: 1 })))
            expect([copy.stateOf('a').stage, flow.stateOf('a').stage]).toEqual([2, 1])
            expect(copy.stateOf('b').lane).toBe(1)
        })
    })

    it('counts a long move at the destination after the item crosses the preceding gates', async () => {
        let flow!: Flow
        await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, counts: true }))
            s.play(flow.put({ id: 'a' }), { duration: 1 })
            s.play(flow.move('a', 3), { duration: 1, ease: (t) => t ** 6 })
        })
        expect(counted(flow, 2, 1.89)).toEqual(['0'])
        expect(counted(flow, 3, 1.89)).toEqual(['0'])
        expect(counted(flow, 3, 2)).toEqual(['1'])
    })

    it('counts first visits as an item crosses stages on a backward move', async () => {
        let flow!: Flow
        await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, counts: true }))
            s.play(flow.put({ id: 'a', at: 3 }), { duration: 1 })
            s.play(flow.move('a', 0), { duration: 3, ease: (t) => t * t })
            expect(GATES.map((gate) => flow.reached(gate))).toEqual([1, 1, 1, 1])
        })
        // The move crosses the gates at one third and two thirds of the distance.
        const crossing = (distance: number) => 1 + 3 * Math.sqrt(distance)
        for (const [stage, distance] of [[2, 1 / 3], [1, 2 / 3]] as const) {
            expect(counted(flow, stage, crossing(distance) - 0.01)).toEqual(['0'])
            expect(counted(flow, stage, crossing(distance) + 0.01)).toEqual(['1'])
        }
    })

    it('encloses all four corners of a region inside a rotated parent', async () => {
        await compile((s) => {
            const flow = pipeline(GATES, sized)
            const before = flow.region({ stage: 1, lane: 0 })
            s.add(group(flow).rotate(Math.PI / 4))
            const after = flow.region({ stage: 1, lane: 0 })
            const extent = (before.width + before.height) / Math.sqrt(2)
            expect(after.width).toBeCloseTo(extent)
            expect(after.height).toBeCloseTo(extent)
        })
    })

    it('is as wide as its width, with the names at even steps over the path, and measures as its frame for the layout', async () => {
        await compileFilm(film(() => {
            const flow = pipeline(GATES, sized).at(100, 50)
            expect(flow.names.map(words)).toEqual(GATES)
            // A name starts where the id of an item starts: 0.55 of the text size after the start of its stage.
            flow.names.forEach((name, index) => expect(name.get('x')).toBeCloseTo(-500 + index * PITCH + 11, 6))
            // The marks of the first lane are on one line, at the middle of the round end of an item that is there.
            GATES.forEach((_, index) => expect(flow.mark(index).get('x')).toBeCloseTo(-500 + index * PITCH + 17, 6))
            expect(new Set(GATES.map((_, index) => flow.mark(index).get('y'))).size).toBe(1)
            // The frame: the width, and the names over one lane. The line of the lane ends at the right edge, with its arrow head.
            const box = boxOf(flow)
            expect([box.left, box.right, box.top, box.bottom]).toEqual([-400, 600, 16.5, 83.5])
            const ink = flow.bounds()
            expect(ink.x).toBeGreaterThanOrEqual(box.left)
            expect(ink.x + ink.width).toBeCloseTo(box.right, 6)
            expect(ink.y).toBeGreaterThanOrEqual(box.top)
            expect(ink.y + ink.height).toBeLessThanOrEqual(box.bottom)
            // The line of the lane has a gap at each mark, so no line goes through a ring, a check or a cross.
            const pieces = flow.rails[0]!.children.slice(0, 4)
            GATES.forEach((_, index) => {
                const mark = edges(flow.mark(index))
                expect(edges(pieces[index]!)[0]).toBeGreaterThan(mark[2] + 2)
                if (index > 0) expect(edges(pieces[index - 1]!)[2]).toBeLessThan(mark[0] - 2)
            })
            // Counts, more lanes and a tray make the frame taller, and never wider.
            const tall = boxOf(pipeline(GATES, { ...sized, counts: true, lanes: 3, tray: 'refused' }))
            expect([tall.left, tall.right, tall.height]).toEqual([-500, 500, 259])
            // So the layout can build it for a region: all of it is as wide as the region.
            const made = fitted(830, (width) => pipeline(GATES, { width, size: 20, tray: 'refused' }))
            expect(boxOf(made).width).toBeCloseTo(830, 6)
            // The default text is 28 px, over the 26 px that a lesson asks for.
            expect(pipeline(GATES).names[0]!.data['size']).toBe(28)
            expect(boxOf(pipeline(GATES)).width).toBe(1600)
        }))
    })

    it('brings an item to the first stage in a free lane, with its id and its badge, and tells where it is', async () => {
        let flow!: Flow
        const f = await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, gates: true }))
            expect(flow.ids).toEqual([])
            s.wait(1)
            s.play(flow.put({ id: 'call 17', badge: 'hold B7' }), { duration: 1 })
            expect(flow.ids).toEqual(['call 17'])
            expect(flow.stateOf('call 17')).toEqual({ id: 'call 17', stage: 0, name: 'parse', lane: 0, state: 'waiting', where: 'path', badge: 'hold B7' })
            expect([flow.count(), flow.count('parse'), flow.count('schema'), flow.reached('parse')]).toEqual([1, 1, 0, 1])
            expect(flow.items).toEqual([flow.item('call 17')])
            s.wait(1)
        })
        const item = flow.item('call 17')
        expect(item).toBeInstanceOf(PipelineItemNode)
        expect(words(item.idText)).toBe('call 17')
        // Nothing of the item shows before its time.
        expect(at(0.5, () => shows(item))).toBe(0)
        // On its way in, the capsule is whole before a text shows on it: the line of the lane does not show through a text.
        at(1.1, () => {
            expect(item.capsule.get('fillOpacity')).toBeGreaterThan(0)
            expect(shows(item.content)).toBe(0)
        })
        at(1.5, () => {
            expect(item.capsule.get('fillOpacity')).toBe(1)
            expect(shows(item.content)).toBeGreaterThan(0)
            expect(shows(item.content)).toBeLessThan(1)
            expect(item.get('x')).toBeLessThan(-500)
        })
        // At rest: its left end is at the start of the first stage, on the line of the first lane, and it hides the mark there.
        at(2.5, () => {
            expect(item.get('x')).toBeCloseTo(-500, 6)
            expect(item.get('y')).toBeCloseTo(flow.mark(0).get('y'), 6)
            expect(shows(item.content)).toBe(1)
            expect(badges(item, 2.5)).toEqual(['hold B7'])
            const [left, top, right, bottom] = edges(item.capsule), mark = edges(flow.mark(0))
            expect(left).toBeLessThan(mark[0])
            expect(right).toBeGreaterThan(mark[2])
            expect(top).toBeLessThan(mark[1])
            expect(bottom).toBeGreaterThan(mark[3])
            // The id is in the color of the item, and the border too.
            expect(item.capsule.get('stroke')).toEqual(paint('blue'))
            expect(item.idText.children[0]!.get('fill')).toEqual(paint('blue'))
        })
        expectPure(f, [0, 1.1, 1.5, 2.5])
    })

    it('brings the names, the line of the path and the tray with enter(), stage by stage, and no lane that has no item', async () => {
        let flow!: Flow
        await compile((s) => {
            flow = pipeline(GATES, { ...sized, lanes: 2, tray: 'refused', counts: true })
            // The animation brings the object to the stage: the film did not add it.
            s.play(flow.enter(), { duration: 2 })
            s.wait(1)
        })
        const name = (index: number, time: number) => at(time, () => shows(flow.names[index]!))
        // The first stage is there before the last one starts.
        expect([name(0, 0), name(3, 0)]).toEqual([0, 0])
        expect(name(0, 1)).toBe(1)
        expect(name(3, 1)).toBe(0)
        expect(GATES.map((_, index) => name(index, 2))).toEqual([1, 1, 1, 1])
        at(1, () => {
            expect(flow.rails[0]!.children[0]!.get('trimTo')).toBe(1)
            expect(flow.rails[0]!.children[3]!.get('trimTo')).toBe(0)
            expect(shows(flow.mark(3))).toBe(0)
            expect(shows(flow.counters[3]!)).toBe(0)
            expect(shows(flow.tray!)).toBe(0)
        })
        at(2, () => {
            expect(flow.rails[0]!.children.map((piece) => piece.get('trimTo'))).toEqual([1, 1, 1, 1, 1])
            expect(shows(flow.mark(3))).toBe(1)
            expect(shows(flow.counters[3]!)).toBe(1)
            expect(shows(flow.tray!)).toBe(1)
            // The second lane has no item yet, so it does not show.
            expect(flow.laneNodes.map(shows)).toEqual([1, 0])
        })
    })

    it('moves an item to the next stage and leaves a mark behind: a dot at a stage, a check at a gate', async () => {
        let flow!: Flow
        await compile((s) => {
            flow = s.add(pipeline([{ name: 'model', gate: false }, 'parse', 'schema'], { ...sized, gates: true }))
            s.play(flow.put({ id: 'a', badge: 'v1' }), { duration: 1 })
            s.play(flow.move('a'), { duration: 1, ease: linear })
            expect(flow.stateOf('a')).toMatchObject({ stage: 1, name: 'parse', state: 'waiting', badge: 'v1' })
            expect([flow.trailOf('model'), flow.trailOf('parse')]).toEqual(['visited', 'open'])
            s.play(flow.move('a'), { duration: 1, ease: linear })
            expect([flow.trailOf('model'), flow.trailOf('parse'), flow.trailOf('schema')]).toEqual(['visited', 'passed', 'open'])
            expect([flow.count('model'), flow.count('parse'), flow.count('schema')]).toEqual([0, 0, 1])
            // The last stage has no next one.
            expect(() => s.play(flow.move('a'))).toThrow(/item "a" is at the last stage, "schema"\. exit\(\) takes it off the path/)
        })
        const item = flow.item('a'), pitch = (1000 - 18) / 3
        // With a linear ease, the item is half way at half of the time, and it keeps its badge.
        expect(at(1, () => item.get('x'))).toBeCloseTo(-500, 6)
        expect(at(1.5, () => item.get('x'))).toBeCloseTo(-500 + pitch / 2, 6)
        expect(at(2, () => item.get('x'))).toBeCloseTo(-500 + pitch, 6)
        expect(at(3, () => item.get('x'))).toBeCloseTo(-500 + pitch * 2, 6)
        expect(badges(item, 2.5)).toEqual(['v1'])
        // The mark of a stage changes when the item leaves it.
        expect([lookOf(flow, 'model', 0.9), lookOf(flow, 'model', 2), lookOf(flow, 'parse', 2), lookOf(flow, 'parse', 3), lookOf(flow, 'schema', 3)]).toEqual(['open', 'visited', 'open', 'passed', 'open'])
    })

    it('takes an item through each stage of a long move, and takes the marks away when the item goes back for a second run', async () => {
        let flow!: Flow
        await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, gates: true, counts: true }))
            s.play(flow.put({ id: 'Q5' }), { duration: 1 })
            s.play(flow.move('Q5', 'authority'), { duration: 3, ease: linear })
            expect(GATES.map((gate) => flow.trailOf(gate))).toEqual(['passed', 'passed', 'passed', 'open'])
            expect(GATES.map((gate) => flow.reached(gate))).toEqual([1, 1, 1, 1])
            s.play(flow.stop('Q5', 'stale'), { duration: 1 })
            // A stopped item can go back. The stop and its reason go with the run.
            s.play(flow.move('Q5', 0), { duration: 1 })
            expect(flow.stateOf('Q5')).toMatchObject({ stage: 0, state: 'waiting', badge: undefined })
            expect(GATES.map((gate) => flow.trailOf(gate))).toEqual(['open', 'open', 'open', 'open'])
            s.play(flow.move('Q5', 'schema'), { duration: 1 })
            // The item counts one time at a stage, also in its second run.
            expect(GATES.map((gate) => flow.reached(gate))).toEqual([1, 1, 1, 1])
        })
        // The item is at 'schema' at one third of the move, and at 'source' at two thirds. The mark and the count of a stage follow.
        expect([lookOf(flow, 'schema', 1.9), lookOf(flow, 'schema', 2.4), lookOf(flow, 'source', 2.9), lookOf(flow, 'source', 3.4)]).toEqual(['open', 'passed', 'open', 'passed'])
        expect([counted(flow, 1, 1.9), counted(flow, 1, 2.1), counted(flow, 2, 2.9), counted(flow, 2, 3.1), counted(flow, 3, 3.9), counted(flow, 3, 4)]).toEqual([['0'], ['1'], ['0'], ['1'], ['0'], ['1']])
        // After the move back, no mark says that the item passed.
        expect(GATES.map((gate) => lookOf(flow, gate, 6))).toEqual(['open', 'open', 'open', 'open'])
        expect(GATES.map((_, index) => counted(flow, index, 7))).toEqual([['1'], ['1'], ['1'], ['1']])
        expect(badges(flow.item('Q5'), 6, 0.01)).toEqual([])
    })

    it('changes the badge in place: the id does not move, the capsule takes the new width, and no moment shows two texts', async () => {
        let flow!: Flow
        await compile((s) => {
            flow = s.add(pipeline(GATES, { width: 1600, size: 20 }))
            s.play(flow.put({ id: 'R-104', badge: 'id set' }), { duration: 1 })
            s.play(flow.setBadge('R-104', 'tenant A, slot 3 of 5'), { duration: 1 })
            expect(flow.stateOf('R-104').badge).toBe('tenant A, slot 3 of 5')
            s.play(flow.setBadge('R-104', null), { duration: 1 })
            expect(flow.stateOf('R-104').badge).toBeUndefined()
            expect(flow.item('R-104').badge).toBeNull()
        })
        const item = flow.item('R-104')
        const idAt = (time: number) => at(time, () => edges(item.idText))
        const wide = (time: number) => at(time, () => item.capsule.bounds().width)
        expect(idAt(2)).toEqual(idAt(1))
        expect(idAt(1.5)).toEqual(idAt(1))
        expect(idAt(3)).toEqual(idAt(1))
        expect(wide(2)).toBeGreaterThan(wide(1) + 100)
        expect(wide(3)).toBeLessThan(wide(1))
        // The capsule holds its text at each end, with the same room at the right.
        for (const time of [1, 2]) {
            const room = at(time, () => edges(item.capsule)[2] - edges(item.badge ?? item.content.children.filter((part) => shows(part) > 0.99).pop()!)[2])
            expect(room).toBeGreaterThan(8)
            expect(room).toBeLessThan(14)
        }
        expect([badges(item, 1), badges(item, 2), badges(item, 3)]).toEqual([['id set'], ['tenant A, slot 3 of 5'], []])
        for (let time = 1; time <= 3; time += 0.05) expect(badges(item, time, 0.001).length, `at ${time}`).toBeLessThanOrEqual(1)
    })

    it('gives an item the verdict of its stage: a check for a pass, and a cross, a red border and the reason for a stop', async () => {
        let flow!: Flow
        await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, gates: true }))
            s.play(flow.put({ id: 'c', color: 'orange' }), { duration: 1 })
            s.play(flow.pass('c', 'parsed'), { duration: 1 })
            expect(flow.stateOf('c')).toMatchObject({ state: 'passed', badge: 'parsed' })
            s.play(flow.move('c'), { duration: 1 })
            // The verdict stays at the stage that gave it. The text goes with the item.
            expect(flow.stateOf('c')).toMatchObject({ stage: 1, state: 'waiting', badge: 'parsed' })
            s.play(flow.stop('c', 'no grant'), { duration: 1 })
            expect(flow.stateOf('c')).toMatchObject({ stage: 1, state: 'stopped', badge: 'no grant' })
            expect(flow.find((item) => item.state === 'stopped')).toEqual(['c'])
            // A stopped item does not move on, and the message names the ways out.
            expect(() => s.play(flow.move('c'))).toThrow(/item "c" is stopped at "schema", so it does not move on\. Let it through first with pass\("c"\), send it to the tray with eject\("c"\), or move it back/)
            // A pass ends the stop, and the reason goes with it.
            s.play(flow.pass('c'), { duration: 1 })
            expect(flow.stateOf('c')).toMatchObject({ state: 'passed', badge: undefined })
            s.play(flow.move('c'), { duration: 1 })
            expect(flow.trailOf('schema')).toBe('passed')
        })
        const item = flow.item('c')
        const signs = (time: number) => at(time, () => [shows(item.check), shows(item.cross), item.capsule.get('stroke')])
        expect(signs(1)).toEqual([0, 0, paint('orange')])
        expect(signs(2)).toEqual([1, 0, paint('orange')])
        expect(signs(3)).toEqual([0, 0, paint('orange')])
        expect(signs(4)).toEqual([0, 1, paint('red')])
        expect(signs(5)).toEqual([1, 0, paint('orange')])
        expect([badges(item, 2), badges(item, 3), badges(item, 4), badges(item, 5)]).toEqual([['parsed'], ['parsed'], ['no grant'], []])
        // The id keeps the color of the item while the border is red: color is not the only sign of a stop.
        expect(at(4, () => item.idText.children[0]!.get('fill'))).toEqual(paint('orange'))
        // The item runs into its stage and comes back: it is a little further on early in the stop, and at its place at the end.
        expect(at(3.2, () => item.get('x'))).toBeGreaterThan(-500 + PITCH + 3)
        expect(at(4, () => item.get('x'))).toBeCloseTo(-500 + PITCH, 6)
    })

    it('sends a stopped item to the tray with its reason, and frees its lane for the next item', async () => {
        let flow!: Flow
        await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, gates: true, tray: 'refused' }).at(40, 20))
            s.play(flow.put({ id: 'a' }), { duration: 1 })
            s.play(flow.stop('a', 'bad JSON'), { duration: 1 })
            s.play(flow.eject('a'), { duration: 1 })
            expect(flow.stateOf('a')).toEqual({ id: 'a', stage: 0, name: 'parse', lane: null, state: 'stopped', where: 'tray', badge: 'bad JSON' })
            expect([flow.count(), flow.ids, flow.find((item) => item.where === 'tray')]).toEqual([0, ['a'], ['a']])
            // The cross stays at the stage, on the lane, where the item was stopped.
            expect(flow.trailOf('parse')).toBe('stopped')
            // An item in the tray takes no other change.
            expect(() => s.play(flow.setBadge('a', 'late'))).toThrow(/item "a" is in the tray, and an item in the tray takes no change/)
            expect(() => s.play(flow.move('a'))).toThrow(/item "a" is in the tray/)
            // A function picks the items of the path only.
            s.play(flow.move(() => true), { duration: 1 })
            expect(flow.stateOf('a').stage).toBe(0)
            // The next item takes the lane, and the marks of the lane start again.
            s.play(flow.put({ id: 'b' }), { duration: 1 })
            expect(flow.stateOf('b').lane).toBe(0)
            expect(flow.trailOf('parse')).toBe('open')
            s.play(flow.move('b'), { duration: 1 })
            s.play(flow.stop('b', 'no id'), { duration: 1 })
            s.play(flow.eject('b'), { duration: 1 })
            expect(flow.find((item) => item.where === 'tray')).toEqual(['a', 'b'])
        })
        const a = flow.item('a'), b = flow.item('b'), tray = flow.region({ tray: true })
        // On its way, an item is behind the items of the lanes that it passes, so they stay readable.
        expect([at(1.5, () => a.get('z')), at(2.5, () => a.get('z')), at(3, () => a.get('z'))]).toEqual([0, -1, 0])
        at(8, () => {
            for (const item of [a, b]) {
                const [left, top, right, bottom] = edges(item.capsule)
                expect(left).toBeGreaterThan(tray.left)
                expect(right).toBeLessThan(tray.right)
                expect(top).toBeGreaterThan(tray.top)
                expect(bottom).toBeLessThan(tray.bottom)
                expect((top + bottom) / 2).toBeCloseTo(tray.cy, 6)
                expect(shows(item.cross)).toBe(1)
            }
            // The items stand after the name of the tray, in the order in which they came, with room between them.
            expect(edges(a.capsule)[0]).toBeGreaterThan(edges(flow.trayName!)[2] + 10)
            expect(edges(b.capsule)[0] - edges(a.capsule)[2]).toBeCloseTo(10, 0)
        })
        expect([badges(a, 8), badges(b, 8)]).toEqual([['bad JSON'], ['no id']])
        expect([lookOf(flow, 'parse', 1.9), lookOf(flow, 'parse', 3), lookOf(flow, 'parse', 5), lookOf(flow, 'schema', 8)]).toEqual(['open', 'stopped', 'open', 'stopped'])
        expect(words(flow.trayName)).toBe('refused')
    })

    it('stops when the tray has no room for an item, when the pipeline has no tray, and says what to do', async () => {
        await compile((s) => {
            const none = s.add(pipeline(GATES, sized))
            s.play(none.put({ id: 'a' }))
            expect(() => none.eject('a')).toThrow(/the pipeline has no tray\. Give it one with the option `tray`, such as tray: 'rejected'/)
            expect(() => none.region({ tray: true })).toThrow(/the pipeline has no tray/)
            const small = s.add(pipeline(['in', 'out'], { width: 420, size: 20, tray: 'refused', lanes: 4 }))
            s.play(small.put([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }]))
            s.play(small.stop(['r1', 'r2', 'r3', 'r4'], 'no schema'))
            // The tray takes the items that fit in its one row, and the next one is an error that counts them.
            let held = 0
            expect(() => {
                for (const id of ['r1', 'r2', 'r3', 'r4']) {
                    s.play(small.eject(id))
                    held++
                }
            }).toThrow(/the tray has no room for item "r\d"\. It holds \d items?, and \d+ px are left for an item of \d+ px\. Use shorter reasons, a wider `width`, or send fewer items to the tray/)
            expect(held).toBeGreaterThan(0)
            expect(held).toBeLessThan(4)
            expect(small.find((item) => item.where === 'tray').length).toBe(held)
            expect(small.count()).toBe(4 - held)
            expect(() => pipeline(['a', 'b'], { width: 300, size: 20, tray: 'a very long name of a tray for refused rows' })).toThrow(/the name of the tray \("a very long name of a tray for refused rows"\) is \d+ px wide, and it leaves no room for an item in a width of 300\. Use a shorter name, or a wider `width`/)
        })
    })

    it('takes an item away with exit(), and gives its lane and its id to the next item when the exit is over', async () => {
        let flow!: Flow, first!: PipelineItemNode, second!: PipelineItemNode
        await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, gates: true }))
            s.play(flow.put({ id: 'a' }), { duration: 1 })
            s.play(flow.move('a'), { duration: 1 })
            first = flow.item('a')
            s.play(flow.exit('a'), { duration: 1 })
            expect([flow.ids, flow.count()]).toEqual([[], 0])
            expect(() => flow.stateOf('a')).toThrow(/no item "a"\. The pipeline has no item yet: put\(\) brings one/)
            // An item that is done goes on, so the gate where it waited shows a check.
            expect(flow.trailOf('schema')).toBe('passed')
            // The same id can come again: it is a new item, at the first stage.
            s.play(flow.put({ id: 'a' }), { duration: 1 })
            second = flow.item('a')
            expect(second).not.toBe(first)
            expect(flow.stateOf('a')).toMatchObject({ stage: 0, lane: 0 })
            expect([flow.trailOf('parse'), flow.trailOf('schema')]).toEqual(['open', 'open'])
            // An item that takes the lane before the exit is over would be on the item that leaves.
            expect(() => s.play(flow.exit('a'), flow.put({ id: 'b' }))).toThrow(/put\("b"\) starts at 4 s, and lane 0 is free from 4\.6 s, when exit\("a"\) is over\. Start it then or later, or give the pipeline more `lanes`/)
        })
        expect(at(2, () => shows(first))).toBe(1)
        // Its texts go before its capsule: no line shows through a text that is half there.
        at(2.7, () => {
            expect(shows(first.content)).toBeLessThan(0.5)
            expect(first.capsule.get('fillOpacity')).toBe(1)
            expect(first.get('x')).toBeGreaterThan(-500 + PITCH)
        })
        expect(at(3, () => shows(first))).toBe(0)
        expect(at(3.5, () => shows(first))).toBe(0)
        expect(at(4, () => shows(second))).toBe(1)
    })

    it('gives each item its own lane, shows a lane from its first item, and stops when no lane is free', async () => {
        let flow!: Flow
        await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, lanes: 3 }))
            s.wait(1)
            s.play(flow.put([{ id: 'a' }, { id: 'b', lane: 2 }]), { duration: 1 })
            expect([flow.stateOf('a').lane, flow.stateOf('b').lane]).toEqual([0, 2])
            expect(() => s.play(flow.put({ id: 'c', lane: 2 }))).toThrow(/lane 2 holds item "b"\. Give item "c" another lane, or leave `lane` out for the first free one/)
            s.play(flow.put({ id: 'c' }), { duration: 1 })
            expect(flow.stateOf('c').lane).toBe(1)
            expect(() => s.play(flow.put({ id: 'd' }))).toThrow(/no lane is free for item "d"\. The pipeline has 3 lanes, with "a", "c", "b"\. Give it more with the option `lanes`, or take an item off the path first with eject\(\) or exit\(\)/)
            expect(() => flow.put({ id: 'd', lane: 3 })).toThrow(/no lane 3\. The pipeline has 3 lanes, from 0 to 2/)
            expect(() => flow.put({ id: 'a' }) && s.play(flow.put({ id: 'a' }))).toThrow(/the pipeline has an item "a" already/)
            // Items of different lanes move together.
            s.play(flow.move(['a', 'b', 'c']), { duration: 1 })
            expect(flow.count('schema')).toBe(3)
        })
        const ys = ['a', 'c', 'b'].map((id) => at(4, () => flow.item(id).get('y')))
        expect(ys[1]! - ys[0]!).toBeCloseTo(34 + 15, 6)
        expect(ys[2]! - ys[1]!).toBeCloseTo(34 + 15, 6)
        expect(['a', 'c', 'b'].map((id) => at(4, () => flow.item(id).get('x')))).toEqual([-500 + PITCH, -500 + PITCH, -500 + PITCH])
        // The line of the first lane is there from the start. The line of another lane comes with its first item.
        expect(flow.laneNodes.map((lane) => at(0.5, () => shows(lane)))).toEqual([1, 0, 0])
        expect(flow.laneNodes.map((lane) => at(2, () => shows(lane)))).toEqual([1, 0, 1])
        expect(flow.laneNodes.map((lane) => at(3, () => shows(lane)))).toEqual([1, 1, 1])
        expect(flow.mark('schema', 2).get('y')).toBeCloseTo(ys[2]!, 6)
    })

    it('counts under each name the items that reached the stage, at the time when each one arrives', async () => {
        let flow!: Flow
        await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, lanes: 3, counts: (count) => `${count} rows` }))
            s.play(flow.put([{ id: 'T1' }, { id: 'T2' }, { id: 'T3' }], { lag: 1 }), { duration: 3 })
            expect(flow.reached('parse')).toBe(3)
            s.play(flow.stop('T2', 'no text'), { duration: 1 })
            // The second change sees what the first one left: the function runs when the move is scheduled.
            s.play(flow.move((item) => item.state !== 'stopped'), { duration: 1 })
            expect([flow.reached('parse'), flow.reached('schema'), flow.count('parse'), flow.count('schema')]).toEqual([3, 2, 1, 2])
            expect(flow.find((item) => item.name === 'schema')).toEqual(['T1', 'T3'])
        })
        // Each item counts when it is half there: at 0.5, 1.5 and 2.5 s.
        expect([0.4, 0.6, 1.4, 1.6, 2.4, 2.6].map((time) => counted(flow, 0, time))).toEqual([['0 rows'], ['1 rows'], ['1 rows'], ['2 rows'], ['2 rows'], ['3 rows']])
        expect([4, 4.8, 4.9, 5].map((time) => counted(flow, 1, time))).toEqual([['0 rows'], ['0 rows'], ['0 rows'], ['2 rows']])
        expect(counted(flow, 2, 5)).toEqual(['0 rows'])
        // The count line is in the dim color, under the name, at the size of the names.
        expect(flow.counters[0]!.get('x')).toBe(flow.names[0]!.get('x'))
        expect(flow.counters[0]!.get('y')).toBeGreaterThan(flow.names[0]!.get('y'))
        // Without the option, the pipeline has no count line.
        expect(pipeline(GATES, sized).counters).toEqual([])
    })

    it('stops when a count line is not a text or is too wide for its stage', async () => {
        await compileFilm(film(() => {
            expect(() => pipeline(GATES, { ...sized, counts: (() => 7) as unknown as (count: number) => string })).toThrow(/the count line for 0 is 7\. `counts` returns a text/)
            expect(() => pipeline(GATES, { ...sized, counts: (count) => `${count} rows that reached this stage of the path` })).toThrow(/the count line "0 rows that reached this stage of the path" is \d+ px wide, and a stage has room for \d+ px\. Write a shorter line in `counts`, or use a wider `width`/)
            expect(() => pipeline(GATES, { ...sized, counts: 'yes' as unknown as boolean })).toThrow(/counts is true, or a function/)
        }))
    })

    it('takes an id, a list of ids or a function for the items of a change, and brings a list one after another with a lag', async () => {
        let flow!: Flow
        await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, lanes: 3 }))
            s.play(flow.put([{ id: 1 }, { id: 2 }, { id: 3 }]), { duration: 1 })
            s.play(flow.move([1, 2, 3], { lag: 1 }), { duration: 3, ease: linear })
            // A number and its text are one id.
            expect(flow.stateOf('2').id).toBe(2)
            expect(() => s.play(flow.move([1, 1]))).toThrow(/names item 1 two times/)
            expect(() => s.play(flow.move(4))).toThrow(/move\(4\): no item 4\. The items are 1, 2, 3/)
            expect(() => s.play(flow.pass('x'))).toThrow(/pass\("x"\): no item "x"\. The items are 1, 2, 3/)
            expect(() => flow.find('stopped' as unknown as () => boolean)).toThrow(/find takes a function of an item/)
            // A function that picks no item changes nothing.
            s.play(flow.stop((item) => item.stage === 3, 'never'))
            expect(flow.find((item) => item.state === 'stopped')).toEqual([])
        })
        // Each of the three moves has one second, one after another.
        const xs = (time: number) => [1, 2, 3].map((id) => at(time, () => Math.round((flow.item(id).get('x') + 500) * 1000) / 1000))
        expect(xs(1.5)).toEqual([PITCH / 2, 0, 0])
        expect(xs(2.5)).toEqual([PITCH, PITCH / 2, 0])
        expect(xs(4)).toEqual([PITCH, PITCH, PITCH])
    })

    it('stops when two changes of one item overlap, with the advice that fits, and lets two items change together', async () => {
        await compile((s) => {
            const flow = s.add(pipeline(GATES, { ...sized, lanes: 2 }))
            s.play(flow.put([{ id: 'a' }, { id: 'b' }]), { duration: 1 })
            expect(() => s.play(flow.move('a'), flow.setBadge('a', 'x'))).toThrow(/setBadge\("a"\) plays from 1 s to 1\.5 s, and move\("a"\) plays from 1 s to 1\.8 s\. An item takes one change at a time: a change starts when the change before it is over\. Play the two in a `seq`/)
        })
        await compile((s) => {
            const flow = s.add(pipeline(GATES, { ...sized, lanes: 2 }))
            s.play(flow.put([{ id: 'a' }, { id: 'b' }]), { duration: 1 })
            expect(() => s.play(flow.move('a', { duration: 1 }), delay(flow.setBadge('a', 'x'), 0.4))).toThrow(/move\("a"\) plays from 1 s to 2 s\. .* Give move\("a"\) a `duration` of 0\.4 or less, or play the two in a `seq`/)
        })
        await compile((s) => {
            const flow = s.add(pipeline(GATES, { ...sized, lanes: 2 }))
            s.play(flow.put([{ id: 'a' }, { id: 'b' }]), { duration: 1 })
            s.play(flow.move('a'), { duration: 1 })
            expect(() => s.at(0.5, () => s.play(flow.setBadge('a', 'x')))).toThrow(/The pipeline takes the changes of an item in the order of time, and the film calls move\("a"\) first\. Call setBadge\("a"\) before it/)
        })
        let flow!: Flow
        await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, lanes: 2 }))
            s.play(flow.put([{ id: 'a' }, { id: 'b' }]), { duration: 1 })
            // In a sequence, each change has its share of the time. Two items change at one time.
            s.play(seq(flow.move('a'), flow.setBadge('a', 'x')), flow.stop('b', 'late'), { duration: 2 })
            expect(flow.stateOf('a')).toMatchObject({ stage: 1, badge: 'x' })
            expect(flow.stateOf('b').state).toBe('stopped')
            expect(() => s.play(flow.move('a'), { duration: Number.NaN })).toThrow(/plays from 3 to NaN\. Give the play a duration that is a number, 0 or more/)
            expect(() => flow.move('a', { duration: -1 })).toThrow(/the duration of move\("a"\) is -1\. Give a number, 0 or more/)
        })
        expect(badges(flow.item('a'), 3)).toEqual(['x'])
    })

    it('stops when a stage, a name or an option is wrong, and the width of the message is enough', async () => {
        await compileFilm(film(() => {
            expect(() => pipeline(['alone'])).toThrow(/give it two stages or more/)
            expect(() => pipeline(['a', 'a'])).toThrow(/two stages have the name "a"\. Give each stage its own name/)
            expect(() => pipeline(['a', ''])).toThrow(/the name of stage 1 is empty\. Give a text of one line/)
            expect(() => pipeline(['a', 'two\nlines'])).toThrow(/the name of stage 1 \("two\\nlines"\) has a line break/)
            expect(() => pipeline(['a', 'b'], { lanes: 0 })).toThrow(/lanes is 0\. It is the number of items that the path holds at one time/)
            expect(() => pipeline(['a', 'b'], { width: 0 })).toThrow(/width is the width of the object, more than 0/)
            expect(() => pipeline(['a', 'b'], { size: -1 })).toThrow(/size is a text size, more than 0/)
            expect(() => pipeline(['a', 'b'], { color: 'no such color' })).toThrow(/color is "no such color", which is not a color/)
            expect(() => pipeline(['a', 'b'], { tray: ' ' })).toThrow(/the name of the tray is empty/)
            // A name that is too wide: the message gives the least width, and that width works.
            const long = ['authorization of the caller', 'schema', 'execute']
            let least = 0
            try {
                pipeline(long, { width: 600, size: 20 })
            } catch (error) {
                const found = /the name "authorization of the caller" is (\d+) px wide at size 20, and a stage of 194 px has room for (\d+) px\. Use a shorter name, a width of (\d+) or more, or fewer stages/.exec((error as Error).message)
                expect(found, (error as Error).message).not.toBeNull()
                least = Number(found![3])
            }
            expect(least).toBeGreaterThan(600)
            expect(() => pipeline(long, { width: least, size: 20 })).not.toThrow()
            expect(() => pipeline(long, { width: least - 3, size: 20 })).toThrow(/is \d+ px wide/)
            const flow = pipeline(GATES, sized)
            expect(() => flow.p('nowhere')).toThrow(/p: no stage "nowhere"\. The stages are 0 \("parse"\), 1 \("schema"\), 2 \("source"\), 3 \("authority"\)/)
            expect(() => flow.move('a', 4)).toThrow(/move: no stage 4/)
            expect(() => flow.put({ id: 'a', at: 'nowhere' })).toThrow(/item "a": no stage "nowhere"/)
            expect(() => flow.put({ id: 'a', color: 'no such color' })).toThrow(/the color of item "a" is "no such color", which is not a color/)
            expect(() => flow.put({ id: {} as unknown as string })).toThrow(/the id of an item is \[object Object\]\. An id is a text or a number/)
            expect(() => flow.put({ id: 'a', badge: 'two\nlines' })).toThrow(/the badge of item "a" \("two\\nlines"\) has a line break/)
            expect(() => flow.setBadge('a', '')).toThrow(/the badge is empty/)
            expect(() => flow.region({ stage: 0, side: 'left' } as never)).toThrow(/region has no part "side"\. Its parts are: stage, lane, tray/)
        }))
    })

    it('stops when an item with its text is wider than the room of a stage, where the film names it, and the width of the message is enough', async () => {
        const reason = 'the book id is a number and not a text'
        let least = 0
        await compile((s) => {
            const flow = s.add(pipeline(GATES, { ...sized, lanes: 2 }))
            // An item that is too wide from the start is an error of put(), before any time passes.
            expect(() => flow.put({ id: 'call 17', badge: reason })).toThrow(/Item "call 17" with the text "the book id is a number and not a text" is \d+ px wide at size 20, and a stage has room for 235 px/)
            expect(() => flow.put({ id: 'a very long id of a tool call that no stage holds' })).toThrow(/Item "a very long id of a tool call that no stage holds" is \d+ px wide at size 20, and a stage has room for 235 px\. Use a shorter id/)
            s.play(flow.put({ id: 'call 17' }))
            // A text that comes later is checked where the film writes the change.
            for (const change of [() => flow.setBadge('call 17', reason), () => flow.pass('call 17', reason), () => flow.stop('call 17', reason)]) {
                expect(change).toThrow(/Use a shorter text, a width of \d+ or more, a smaller `size`, or fewer stages/)
            }
            try {
                flow.stop('call 17', reason)
            } catch (error) {
                least = Number(/a width of (\d+) or more/.exec((error as Error).message)![1])
            }
            // An item that comes in the same sequence is checked when the change is scheduled.
            expect(() => s.play(seq(flow.put({ id: 'call 18' }), flow.stop('call 18', reason)))).toThrow(/Item "call 18" with the text/)
        })
        expect(least).toBeGreaterThan(1000)
        await compile((s) => {
            const flow = s.add(pipeline(GATES, { width: least, size: 20 }))
            s.play(flow.put({ id: 'call 17' }))
            s.play(flow.stop('call 17', reason))
            // The capsule ends with clear room before the mark of the next stage.
            const item = flow.item('call 17')
            expect(flow.mark('schema').bounds().x - (item.capsule.bounds().x + item.capsule.bounds().width)).toBeGreaterThan(10)
            expect(() => pipeline(GATES, { width: least - 8, size: 20 }).put({ id: 'call 17' })).not.toThrow()
        })
        await compile((s) => {
            const flow = s.add(pipeline(GATES, { width: least - 8, size: 20 }))
            s.play(flow.put({ id: 'call 17' }))
            expect(() => flow.stop('call 17', reason)).toThrow(/is \d+ px wide/)
        })
    })

    it('gives a point over and under a stage, and the box of a stage, a lane and the tray, for a note or an arrow', async () => {
        await compileFilm(film(() => {
            const flow = pipeline(GATES, { ...sized, lanes: 2, tray: 'refused' }).at(100, 50)
            const box = boxOf(flow)
            // The points are in the coordinates of the object: on its top and its bottom edge, at the x of the marks of the stage.
            expect(flow.p('schema')).toEqual([-500 + PITCH + 17, -box.height / 2])
            expect(flow.p(1, 'top')).toEqual(flow.p('schema'))
            expect(flow.p('schema', 'bottom')).toEqual([-500 + PITCH + 17, box.height / 2])
            expect(flow.toWorld(...flow.p('schema'))).toEqual([100 - 500 + PITCH + 17, box.top])
            expect(() => flow.p('schema', 'left' as never)).toThrow(/the edge of p\(\) is 'top' or 'bottom', not "left"/)
            // The regions are in stage pixels: where the object is now.
            const lanes = flow.region(), stage = flow.region({ stage: 'schema' }), lane = flow.region({ lane: 1 }), one = flow.region({ stage: 2, lane: 0 }), tray = flow.region({ tray: true })
            expect([lanes.left, lanes.right]).toEqual([box.left, box.right])
            expect([stage.left, stage.right, stage.top, stage.bottom]).toEqual([box.left + PITCH, box.left + PITCH * 2, lanes.top, lanes.bottom])
            expect([lane.left, lane.right, lane.height]).toEqual([box.left, box.right, 34])
            expect(lane.bottom).toBe(lanes.bottom)
            expect([one.left, one.top, one.height]).toEqual([box.left + PITCH * 2, lanes.top, 34])
            expect(lane.cy).toBeCloseTo(flow.toWorld(0, flow.mark(0, 1).get('y'))[1], 6)
            expect([tray.left, tray.right, tray.bottom]).toEqual([box.left, box.right, box.bottom])
            expect(tray.top).toBeGreaterThan(lanes.bottom)
            expect(() => flow.region({ tray: true, lane: 0 })).toThrow(/region takes `tray`, or `stage` and `lane`, not both/)
            expect(() => flow.region({ lane: 2 })).toThrow(/region: no lane 2\. The pipeline has 2 lanes, from 0 to 1/)
            // A note beside a part of the object would lie on the object, and the layout says how to put it beside the whole.
            expect(() => beside(text('over budget', { size: 20 }), flow.names[2]!, 'under')).toThrow(/would lie on the pipeline that the other thing is a part of/)
            // A note of the film goes beside the whole object, at the x of one item or of one stage.
            const note = beside(text('over budget', { size: 20 }), flow, 'under', 'normal', flow.region({ stage: 'source' }))
            expect(boxOf(note).top).toBeGreaterThan(box.bottom)
            expect(boxOf(note).cx).toBeCloseTo(flow.region({ stage: 'source' }).cx, 6)
        }))
    })

    it('makes one item two with fork(), and two items one with join()', async () => {
        let flow!: Flow, part!: PipelineItemNode
        await compile((s) => {
            flow = s.add(pipeline(['model', 'gate', 'user'], { ...sized, lanes: 2 }))
            s.play(flow.put({ id: 'R2' }), { duration: 1 })
            s.play(flow.move('R2'), { duration: 1 })
            s.play(flow.fork('R2', { id: 'R2.act', color: 'orange' }), { duration: 1 })
            part = flow.item('R2.act')
            expect(flow.stateOf('R2.act')).toMatchObject({ stage: 1, name: 'gate', lane: 1, state: 'waiting' })
            expect([flow.ids, flow.count('gate'), flow.reached('gate')]).toEqual([['R2', 'R2.act'], 2, 2])
            expect(() => flow.fork('R2', { id: 'x', at: 'user' })).toThrow(/the new item starts at the stage of the item that it comes from\. Leave `at` out/)
            expect(() => s.play(flow.fork('R2', { id: 'R2.more' }))).toThrow(/no lane is free for item "R2\.more"/)
            expect(() => flow.join('R2', 'R2')).toThrow(/an item joins another item\. Give two ids/)
            s.play(flow.move(['R2', 'R2.act']), { duration: 1 })
            s.play(flow.join('R2.act', 'R2'), { duration: 1 })
            expect([flow.ids, flow.count('user')]).toEqual([['R2'], 1])
            // The lane of the item that joined is free again.
            s.play(flow.put({ id: 'R3' }), { duration: 1 })
            expect(flow.stateOf('R3').lane).toBe(1)
        })
        const whole = flow.item('R2'), pitch = (1000 - 18) / 3
        // The new item starts at the place of the item that it comes from, under it, and goes to its own lane.
        at(2.01, () => {
            expect(part.get('x')).toBeCloseTo(whole.get('x'), 0)
            expect(part.get('y')).toBeCloseTo(whole.get('y'), 0)
            expect(part.get('z')).toBeLessThan(whole.get('z'))
            expect(shows(part.content)).toBe(0)
        })
        // Its text shows when it is clear of that item: half way, it has none yet.
        expect(at(2.5, () => shows(part.content))).toBe(0)
        expect(at(2.9, () => shows(part.content))).toBeGreaterThan(0)
        at(3, () => {
            expect(part.get('x')).toBeCloseTo(-500 + pitch, 6)
            expect(part.get('y') - whole.get('y')).toBeCloseTo(49, 6)
            expect(shows(part.content)).toBe(1)
        })
        // The item that joins ends at the item that it joins, behind it, with no text on it. Its text is gone
        // before it leaves its lane.
        expect(at(4.35, () => shows(part.content))).toBe(0)
        expect(at(4.35, () => part.get('y') - whole.get('y'))).toBeGreaterThan(30)
        at(4.99, () => {
            expect(part.get('y')).toBeCloseTo(whole.get('y'), 0)
            expect(part.get('z')).toBeLessThan(whole.get('z'))
            expect(shows(part.content)).toBe(0)
        })
        expect(at(5, () => shows(part))).toBe(0)
        expect(at(5, () => shows(whole))).toBe(1)
    })

    it('gives a copy its own items and its own bookkeeping, so a change of the copy does not change the pipeline', async () => {
        let flow!: Flow, copy!: Flow
        await compile((s) => {
            flow = s.add(pipeline(GATES, { ...sized, gates: true, counts: true, lanes: 2, tray: 'refused' }).at(0, -200))
            s.play(flow.put([{ id: 'a', badge: 'v1' }, { id: 'b' }]), { duration: 1 })
            s.play(flow.move('a'), { duration: 1 })
            s.play(flow.stop('b', 'bad'), { duration: 1 })
            s.play(flow.eject('b'), { duration: 1 })
            copy = flow.clone().at(0, 200)
            s.add(copy)
            expect(copy.ids).toEqual(['a', 'b'])
            expect(copy.stateOf('a')).toEqual(flow.stateOf('a'))
            expect(copy.stateOf('b')).toEqual(flow.stateOf('b'))
            expect(copy.item('a')).not.toBe(flow.item('a'))
            expect(GATES.map((gate) => copy.reached(gate))).toEqual([2, 1, 0, 0])
            expect([copy.trailOf('parse'), copy.trailOf('parse', 1)]).toEqual(['passed', 'stopped'])
            // The copy takes its own changes. Its lane 1 is free, as the lane of the pipeline is.
            s.play(copy.move('a'), copy.put({ id: 'c' }), { duration: 1 })
            expect([copy.stateOf('a').stage, flow.stateOf('a').stage]).toEqual([2, 1])
            expect([copy.ids, flow.ids]).toEqual([['a', 'b', 'c'], ['a', 'b']])
            expect([copy.reached('source'), flow.reached('source'), copy.reached('parse'), flow.reached('parse')]).toEqual([1, 0, 3, 2])
            // The lanes and the marks of the pipeline are its own: the item of the copy took none of them.
            expect([flow.trailOf('schema'), copy.trailOf('schema')]).toEqual(['open', 'passed'])
            s.play(flow.put({ id: 'd' }), { duration: 1 })
            expect(flow.stateOf('d').lane).toBe(1)
            // An item of the copy that reached a stage before the copy was made does not count there again.
            s.play(copy.move('a', 0), { duration: 1 })
            s.play(copy.move('a', 'source'), { duration: 1 })
            expect(GATES.map((gate) => copy.reached(gate))).toEqual([3, 1, 1, 0])
            // Each tray has its own places: the second item of each one is at the same place.
            s.play(copy.stop('c', 'late'), flow.stop('d', 'late'), { duration: 1 })
            s.play(copy.eject('c'), { duration: 1 })
            s.play(flow.eject('d'), { duration: 1 })
        })
        expect(at(11, () => copy.item('c').get('x'))).toBeCloseTo(at(11, () => flow.item('d').get('x')), 6)
        expect(at(11, () => copy.item('c').get('x'))).toBeGreaterThan(at(11, () => copy.item('b').get('x')) + 30)
        // The item of the pipeline stays, and the item of the copy moves. Each count line shows its own count.
        expect([at(4, () => flow.item('a').get('x')), at(5, () => flow.item('a').get('x'))]).toEqual([-500 + PITCH, -500 + PITCH])
        expect([at(4, () => copy.item('a').get('x')), at(5, () => copy.item('a').get('x'))]).toEqual([-500 + PITCH, -500 + PITCH * 2])
        expect([counted(copy, 0, 4.1), counted(copy, 0, 5), counted(flow, 0, 5), counted(copy, 2, 4.1), counted(copy, 2, 5), counted(flow, 2, 5)]).toEqual([['2'], ['3'], ['2'], ['0'], ['1'], ['0']])
        expect([lookOf(copy, 'schema', 5), lookOf(flow, 'schema', 5), lookOf(copy, 'parse', 4.02, 1), lookOf(copy, 'parse', 5, 1)]).toEqual(['passed', 'open', 'stopped', 'open'])
        expect(badges(copy.item('a'), 5)).toEqual(['v1'])
        expect(at(5, () => shows(copy.item('b').cross))).toBe(1)
    })

    it('takes the font of the film for its names and its items, and its own font for the ids and the badges', async () => {
        const fontOf = (node: Node | null) => (node as TextNode).font
        await compileFilm(film({ font: 'text-serif' }, (s) => {
            const flow = s.add(pipeline(GATES, { ...sized, counts: true, tray: 'refused' }))
            const mono = s.add(pipeline(GATES, { ...sized, itemFont: 'mono', font: 'sans' }))
            s.play(flow.put({ id: 'a', badge: 'v1' }), mono.put({ id: 'a', badge: 'v1' }))
            expect([fontOf(flow.names[0]!), fontOf(flow.trayName), fontOf(flow.counters[0]!.children[0]!), fontOf(flow.item('a').idText), fontOf(flow.item('a').badge)]).toEqual(['text-serif', 'text-serif', 'text-serif', 'text-serif', 'text-serif'])
            expect([fontOf(mono.names[0]!), fontOf(mono.item('a').idText), fontOf(mono.item('a').badge)]).toEqual(['sans', 'mono', 'mono'])
        }))
    })

    it('gives the film check nothing to report on its own layout, at rest and in motion, with a text gap of 0.7', async () => {
        const made = film({ fps: 20 }, (s) => {
            const flow = s.add(pipeline([{ name: 'model', gate: false }, 'complete', 'schema', 'authorization'], { width: 1700, gates: true, counts: (count) => `${count} calls`, tray: 'refused' }))
            s.play(flow.enter())
            s.play(flow.put({ id: 'call 17', badge: 'hold B7' }))
            s.play(flow.move('call 17'))
            s.play(flow.pass('call 17', 'complete'))
            s.wait(0.6)
            s.play(flow.move('call 17'))
            s.play(flow.stop('call 17', 'id is a number'))
            s.wait(0.8)
            s.play(flow.eject('call 17'))
            s.play(flow.put({ id: 'call 18', color: 'orange' }))
            s.play(flow.move('call 18', 'authorization'), { duration: 1.5 })
            s.play(flow.setBadge('call 18', 'grant: Lena'))
            s.wait(0.8)
            s.play(flow.exit('call 18'))
            s.wait(0.5)
        })
        for (const textGap of [0.3, 0.7]) expect((await checkFilm(made, { motion: true, textGap })).diagnostics, `gap ${textGap}`).toEqual([])
    })
})

describe('object catalog', () => {
    it('names only things that the stage exports, so no entry is lost from the list of objects', async () => {
        const { FILM_OBJECTS } = await import('../src/stage/catalog')
        const stage = await import('../src/stage/index')
        // fromComponent lives in the Node-only export module, because it needs the layout engine.
        const missing = FILM_OBJECTS.filter((entry) => !(entry.name in stage) && entry.name !== 'fromComponent').map((entry) => entry.name)
        expect(missing).toEqual([])
    })

    it('names every verb that the stage exports, so a new verb is not left out of the list', async () => {
        const { FILM_OBJECTS } = await import('../src/stage/catalog')
        const named = new Set(FILM_OBJECTS.map((entry) => entry.name))
        // The two modules of verbs. A class is not a verb, and `toPaint` is a helper for colors that `anim` passes on.
        const verbs = { ...await import('../src/stage/anim'), ...await import('../src/stage/objects/verbs') } as Record<string, unknown>
        const isVerb = ([name, value]: [string, unknown]) => typeof value === 'function' && !/^class\b/.test(Function.prototype.toString.call(value)) && name !== 'toPaint'
        const missing = Object.entries(verbs).filter(isVerb).map(([name]) => name).filter((name) => !named.has(name))
        expect(missing).toEqual([])
        expect(named.has('spotlight')).toBe(true)
    })
})
