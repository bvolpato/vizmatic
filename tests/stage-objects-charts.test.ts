import { describe, expect, it } from 'vitest'
import { attentionMatrix, barChart, checkFilm, compileFilm, film, group, heatmap, matrixProduct, CELL_STATES, histogram, lagged, linear, mixColor, parseColor, pathBounds, pie, seq, text, delay, par, spotlight, boxOf, fitted, type CompiledFilm, type Node, type PathOp, type Rgba, type Stage, TextNode } from '../src/stage/index'
import { at, compile, paths } from './helpers/stage-objects'

describe('charts', () => {
    it('barChart grows from zero and lands on its data', async () => {
        let chart!: ReturnType<typeof barChart>
        const f = await compile((s) => {
            chart = s.add(barChart([{ label: 'a', value: 50 }, { label: 'b', value: 100 }], { width: 400, height: 200 }))
            s.play(chart.enter({ duration: 1 }))
        })
        expect(at(0.0001, () => pathBounds(chart.bar(1).get('path')!)!.height)).toBeLessThan(2)
        expect(at(f.duration, () => pathBounds(chart.bar(1).get('path')!)!.height)).toBeCloseTo(200, 3)
        expect(at(f.duration, () => pathBounds(chart.bar(0).get('path')!)!.height)).toBeCloseTo(100, 3)
    })

    it('barChart update rescales and counts', async () => {
        let chart!: ReturnType<typeof barChart>
        const f = await compile((s) => {
            chart = s.add(barChart([{ label: 'a', value: 50 }, { label: 'b', value: 100 }], { width: 400, height: 200 }))
            s.play(chart.update([200, 100]), { duration: 1 })
        })
        expect(at(f.duration, () => chart.values[0]!.value)).toBe(200)
        expect(at(f.duration, () => pathBounds(chart.bar(1).get('path')!)!.height)).toBeCloseTo(100, 3)
    })

    it('histogram fills in sample order', async () => {
        let chart!: ReturnType<typeof histogram>
        const samples = Array.from({ length: 100 }, (_, i) => i % 10)
        const f = await compile((s) => {
            chart = s.add(histogram(samples, { bins: 10, range: [0, 10] }))
            s.play(chart.fillUp({ duration: 1, ease: linear }))
        })
        // Axis labels are filled too, so measure what the samples add on top of them.
        const fillOf = (t: number) => paths(f, t).filter((op) => op.fill).reduce((sum, op) => sum + op.path.length, 0)
        expect(fillOf(f.duration) - fillOf(0)).toBe(10)
        expect(fillOf(0.5) - fillOf(0)).toBe(10)
        const barHeight = (t: number) => Math.max(...paths(f, t).filter((op) => op.fill).map((op) => pathBounds(op.path)!.height))
        expect(barHeight(0.5)).toBeLessThan(barHeight(f.duration))
    })

    it('pie wedges add up to the whole circle', async () => {
        let chart!: ReturnType<typeof pie>
        await compile((s) => {
            chart = s.add(pie([{ label: 'a', value: 3 }, { label: 'b', value: 1 }], { radius: 100, gap: 0 }))
        })
        const a = chart.wedges[0]!.get('path')!, b = chart.wedges[1]!.get('path')!
        // Three quarters of the circle starts at the top and sweeps clockwise.
        expect(pathBounds(a)!.x).toBeCloseTo(-100, 1)
        expect(pathBounds(b)!.width).toBeCloseTo(100, 0)
        expect(pathBounds(b)!.height).toBeCloseTo(100, 0)
    })

    it('heatmap looks up cells and rejects bad indices', async () => {
        let chart!: ReturnType<typeof heatmap>
        await compile((s) => {
            chart = s.add(heatmap([[0, 1], [2, 3]], { cell: 40, gap: 0 }))
        })
        expect(chart.cell(1, 1).get('x')).toBe(20)
        expect(chart.cell(1, 1).get('y')).toBe(20)
        expect(chart.row(0)).toHaveLength(2)
        expect(() => chart.cell(2, 0)).toThrow(/2 by 2/)
    })
})

describe('bar chart and histogram: states, a second series, cuts and a sort', () => {
    // A chart at the middle of a 1920 by 1080 frame. Its columns are 200 wide, with middles at -200, 0 and 200.
    // The baseline is at y 200, and a value v is at y 200 - 400 v. A frame draws a stage point at (960 + x, 540 + y).
    const DATA = [{ label: 'sat', value: 0.5 }, { label: 'ran', value: 0.3 }, { label: 'ate', value: 0.2 }]
    type Chart = ReturnType<typeof barChart>
    const make = (options: Parameters<typeof barChart>[1] = {}, data = DATA) => barChart(data, { width: 600, height: 400, max: 1, labelSize: 30, barColor: 'blue', ...options })
    const middle = (node: Node) => { const b = node.bounds(); return [b.x + b.width / 2, b.y + b.height / 2] as const }
    /** True for a mark that a node drew, or that a drawing of the node made for this frame. */
    const from = (op: PathOp, owner: Node | null | undefined): boolean => {
        for (let node: Node | null | undefined = op.node; node; node = node.parent ?? node.drawer) if (node === owner) return true
        return false
    }
    const drawn = (f: CompiledFilm, t: number, owner: Node | null | undefined) => paths(f, t).filter((op) => from(op, owner))
    /** The texts that a node drew at a time, in the order in which it drew them. */
    const said = (f: CompiledFilm, t: number, owner: Node | null | undefined) => [...new Set(drawn(f, t, owner).flatMap((op) => (op.node?.data['key'] !== undefined ? [op.node.parent as TextNode] : [])))].map((words) => words.source)
    const boundsOf = (ops: readonly PathOp[]) => {
        const boxes = ops.map((op) => pathBounds(op.path)!)
        const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y))
        return { x, y, right: Math.max(...boxes.map((b) => b.x + b.width)), bottom: Math.max(...boxes.map((b) => b.y + b.height)) }
    }
    // A histogram of ten samples in five bins of [0, 5): 2, 3, 4 and 1 samples in the bins of 1, 2, 3 and 4.
    // The plot is 500 wide and 200 high, so a bin is 100 wide and one sample is 50 high.
    const SAMPLES = [1.5, 1.5, 2.2, 2.4, 2.6, 3.1, 3.2, 3.3, 3.4, 4.5]
    const bins = (options: Parameters<typeof histogram>[1] = {}) => histogram(SAMPLES, { bins: 5, range: [0, 5], width: 500, height: 200, labelSize: 30, gap: 0, ...options })
    const fills = (f: CompiledFilm, t: number, owner: Node) => drawn(f, t, owner.children[0]).filter((op) => op.fill)
    /** The marks of the states on the screen: the shape, the middle and the color of each. */
    const stateMarks = (f: CompiledFilm, t: number) => paths(f, t).filter((op) => typeof op.node?.data['shape'] === 'string' && op.strokeAlpha + op.fillAlpha > 0.5).map((op) => {
        const b = pathBounds(op.path)!
        return { shape: op.node!.data['shape'] as string, x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), color: op.stroke ?? op.fill }
    })

    it('leaves a chart that uses none of the new parts with the nodes that it had', async () => {
        let chart!: Chart
        await compile((s) => {
            chart = s.add(barChart(DATA, { width: 600, height: 400 }))
            s.play(chart.enter(), { duration: 1 })
            s.play(chart.update([0.1, 0.9, 0.4]), { duration: 1 })
        })
        // Three bars, the baseline, three labels and three numbers: a film that fades the children one by one sees no other node.
        expect(chart.children).toHaveLength(10)
        expect(chart.children.slice(0, 4)).toEqual([...chart.bars, chart.baseline])
        expect([chart.ticks, chart.valueCut, chart.rankCut, chart.referenceValues]).toEqual([null, null, null, null])
        expect(chart.outlines).toEqual([])
        expect(chart.order).toEqual([0, 1, 2])
        expect(chart.cut).toEqual({ at: null, after: null })
    })

    it('gives a bar a state: the color of the bar, a mark under its label, and a bright label', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(make())
            s.play(chart.mark('ran', 'target'), { duration: 1 })
            expect(chart.state('ran')).toBe('target')
            s.play(chart.mark(1, 'chosen'), chart.mark(2, 'masked'), { duration: 1 })
            s.play(chart.mark('ran', 'plain'), { duration: 1 })
            expect([0, 1, 2].map((index) => chart.state(index))).toEqual(['plain', 'plain', 'masked'])
        })
        const fill = (index: number, t: number) => at(t, () => chart.bar(index).get('fill'))
        const label = (index: number, t: number) => at(t, () => chart.labels[index]!.children[0]!.get('fill'))
        expect(fill(1, 0)).toEqual(parseColor('blue'))
        expect(fill(1, 1)).toEqual(parseColor('green'))
        expect(fill(1, 2)).toEqual(parseColor('yellow'))
        expect(fill(1, 3)).toEqual(parseColor('blue'))
        expect(label(1, 0)).toEqual(parseColor('dim'))
        expect(label(1, 1)).toEqual(parseColor('ink'))
        expect(label(1, 3)).toEqual(parseColor('dim'))
        // The mark is under the label, on the middle of the column: the label is at y 227, and the mark 1.2 sizes lower.
        expect(stateMarks(f, 0.999)).toEqual([{ shape: 'ring', x: 960, y: 540 + 227 + 36, color: parseColor('green') }])
        // A mark of another shape takes the place of the old one, and each bar has its own.
        expect(stateMarks(f, 1.999).map((mark) => [mark.shape, mark.x])).toEqual([['check', 960], ['cross', 1160]])
        expect(stateMarks(f, 1.999)[0]!.color).toEqual(parseColor('yellow'))
        expect(stateMarks(f, 3).map((mark) => mark.shape)).toEqual(['cross'])
        // A dim state: the bar, its label and its number are faint.
        expect(at(2, () => chart.bar(2).get('fillOpacity'))).toBeCloseTo(0.3, 6)
        expect(at(0, () => chart.bar(2).get('fillOpacity'))).toBeCloseTo(0.84, 6)
        expect(label(2, 2)).toEqual(parseColor('faint'))
        expect(drawn(f, 2, chart.readouts[2])[0]!.fillAlpha).toBeCloseTo(0.45, 6)
        expect(drawn(f, 2, chart.readouts[1])[0]!.fillAlpha).toBeCloseTo(1, 6)
    })

    it('puts every bar back to plain, and changes only the bars that a call names', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(make())
            s.play(chart.mark(['sat', 2], 'chosen', { lag: 1 }), { duration: 2 })
            s.play(chart.clearStates(), { duration: 1 })
        })
        // With a lag of 1, the second bar starts when the first one is done.
        expect(stateMarks(f, 0.999).map((mark) => mark.x)).toEqual([760])
        expect(stateMarks(f, 2).map((mark) => mark.x)).toEqual([760, 1160])
        expect(at(2, () => chart.bar(1).get('fill'))).toEqual(parseColor('blue'))
        expect(stateMarks(f, 3)).toEqual([])
        expect(at(3, () => chart.bar(0).get('fill'))).toEqual(parseColor('blue'))
        expect([0, 1, 2].map((index) => chart.state(index))).toEqual(['plain', 'plain', 'plain'])
    })

    it('keeps the room of the state marks from the start with `states`, and measures a mark from the first one without it', async () => {
        await compileFilm(film((s) => {
            const plain = make(), ready = make({ states: true })
            // The mark of a state is 1.2 text sizes under the middle of the label, and 0.36 of a size in radius.
            const bottom = 200 + 12 + 15 + 30 * 1.2 + 30 * 0.36
            expect(boxOf(ready).bottom).toBeCloseTo(bottom, 6)
            expect(boxOf(plain).bottom).toBeLessThan(bottom - 20)
            // The room is not drawn: the chart on the screen is as high as before.
            expect(ready.bounds().height).toBeCloseTo(plain.bounds().height, 6)
            s.add(plain, ready)
            s.play(plain.mark(0, 'target'), ready.mark(0, 'target'))
            expect(boxOf(ready).bottom).toBeCloseTo(bottom, 6)
            expect(boxOf(plain).bottom).toBeCloseTo(bottom, 6)
        }))
    })

    it('takes a table of states, and refuses a state whose color is its only sign', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(make({ states: { legal: { color: 'teal', mark: 'dot' }, masked: { mark: 'cross', dim: true } } }))
            s.play(chart.mark(0, 'legal'), { duration: 1 })
        })
        expect(stateMarks(f, 1)).toEqual([{ shape: 'dot', x: 760, y: 803, color: parseColor('teal') }])
        expect(() => chart.mark(0, 'target')).toThrow('barChart: mark(): no state "target". The states are plain, legal, masked')
        expect(() => make({ states: { loud: { color: 'red' } as never } })).toThrow('the state "loud" has no mark, so its color is its only sign')
        expect(() => make({ states: { odd: { mark: 'star' as never } } })).toThrow('the mark of the state "odd" is "star". A mark is \'dot\', \'ring\', \'check\' or \'cross\'')
        expect(() => make({ states: { plain: { mark: 'dot' } } })).toThrow('a table of states cannot change `plain`')
        expect(() => make({ states: { legal: { mark: 'dot' } } }).mask(0)).toThrow('mask(): no state "masked". The states are plain, legal. Add a state `masked` to the table')
    })

    it('masks bars and gives their share to the rest, with the same sum at every frame', async () => {
        let chart!: Chart
        const values = (t: number) => at(t, () => chart.values.map((value) => value.value))
        await compile((s) => {
            chart = s.add(make())
            s.play(chart.mask('ate'), { duration: 1 })
            expect(chart.state('ate')).toBe('masked')
            // A second mask starts from what the first one left.
            s.play(chart.mask(1), { duration: 1 })
        })
        expect(values(1)[0]).toBeCloseTo(0.625, 9)
        expect(values(1)[1]).toBeCloseTo(0.375, 9)
        expect(values(1)[2]).toBe(0)
        for (const t of [0, 0.2, 0.5, 0.8, 1, 1.4, 2]) expect(values(t).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 9)
        expect(values(2)).toEqual([1, 0, 0])
        // The bar is drawn to its value: a bar of 0.625 is 250 high.
        expect(at(1, () => pathBounds(chart.bar(0).get('path')!)!.height)).toBeCloseTo(250, 6)
        expect(at(1, () => pathBounds(chart.bar(2).get('path')!)!.height)).toBeCloseTo(0, 6)
    })

    it('masks without a new share on request, and refuses a share that cannot be given', async () => {
        let chart!: Chart
        await compile((s) => {
            chart = s.add(make())
            s.play(chart.mask([0, 1], { renormalize: false }), { duration: 1 })
            expect(() => s.play(chart.mask(2))).toThrow('barChart: mask() leaves no bar with a value, so no bar can take the share of the masked ones')
        })
        expect(at(1, () => chart.values.map((value) => value.value))).toEqual([0, 0, 0.2])
        await compile((s) => {
            const signed = s.add(barChart([{ label: 'a', value: 0.5 }, { label: 'b', value: -0.5 }], { min: -1, max: 1 }))
            expect(() => s.play(signed.mask(0))).toThrow('the value of bar 1 ("b") is -0.5. A share is 0 or more. For values that are not shares, use mask(bars, { renormalize: false })')
            s.play(signed.mask(0, { renormalize: false }))
        })
    })

    it('refuses a mask and another change of the values at one time, and takes them one after the other', async () => {
        await compile((s) => {
            const chart = s.add(make())
            expect(() => s.play(chart.mask(2), chart.update([0.2, 0.2, 0.6]), { duration: 1 })).toThrow('barChart: update() plays from 0 s to 1 s, and mask() plays from 0 s to 1 s. Both set the values of the bars')
        })
        await compile((s) => {
            const chart = s.add(make())
            expect(() => s.play(chart.update([0.2, 0.2, 0.6]), chart.mask(2), { duration: 1 })).toThrow('barChart: mask() plays from 0 s to 1 s, and update() plays from 0 s to 1 s')
        })
        let chart!: Chart
        await compile((s) => {
            chart = s.add(make())
            s.play(seq(chart.update([0.2, 0.2, 0.6]), chart.mask(2)), { duration: 2 })
            // Two updates at one time are as they were before: the last one wins.
            s.play(chart.update([0.5, 0.5, 0]), chart.update([0.25, 0.75, 0]), { duration: 1 })
        })
        expect(at(2, () => chart.values.map((value) => value.value))).toEqual([0.5, 0.5, 0])
        expect(at(3, () => chart.values.map((value) => value.value))).toEqual([0.25, 0.75, 0])
    })

    it('refuses an update that overlaps a mask in another branch of a play', async () => {
        await compile((s) => {
            const chart = s.add(make())
            // The sequence schedules its update at 2 s before the other branch schedules its update at 0.5 s.
            const sequence = seq(chart.mask(2, { duration: 2 }), chart.update([0.2, 0.3, 0.5], { duration: 1 }))
            const duringMask = delay(chart.update([0.1, 0.1, 0.8], { duration: 0.5 }), 0.5)
            expect(() => s.play(par(sequence, duringMask))).toThrow(/(?=.*\bmask\b)(?=.*\bupdate\b).*\bseq\b/i)
        })
    })

    it.each([
        ['both bounds', {}, 1, false],
        ['the upper bound', { min: 0 }, 1, true],
        ['the lower bound', { max: 0 }, -1, false],
    ] as const)('refuses concurrent reference and update calls when the scale sets %s', async (_bounds, scale, start, referenceFirst) => {
        await compile((s) => {
            const chart = s.add(barChart([{ label: 'a', value: start }], scale))
            const update = chart.update([3 * start], { duration: 2 })
            const reference = chart.reference([5 * start], { duration: 1 })
            const play = () => referenceFirst ? s.play(reference, update) : s.play(update, reference)
            expect(play).toThrow(/(?=.*\bmin\b)(?=.*\bmax\b).*\bseq\b/i)
        })
    })

    it('lets the bar finish its update after its reference reaches the top of a fixed scale', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(barChart([{ label: 'a', value: 1 }], { min: 0, max: 5, height: 100 }))
            s.play(chart.update([3], { duration: 2 }), chart.reference([5], { duration: 1 }), { ease: linear })
        })
        const height = (part: Node, time: number) => pathBounds(drawn(f, time, part)[0]!.path)!.height
        expect(height(chart.outlines[0]!, 1)).toBeCloseTo(100)
        expect(height(chart.bar(0), 1)).toBeCloseTo(40)
        expect(height(chart.outlines[0]!, 2)).toBeCloseTo(100)
        expect(height(chart.bar(0), 2)).toBeCloseTo(60)
        expect(at(2, () => chart.values[0]!.value)).toBe(3)
    })

    it('holds the values of the bars as outlines, so an update shows before and after', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(make())
            s.play(chart.reference(), { duration: 1 })
            expect(chart.referenceValues).toEqual([0.5, 0.3, 0.2])
            s.play(chart.update([0.1, 0.8, 0.1]), { duration: 1 })
            s.play(chart.reference(null), { duration: 1 })
            expect(chart.referenceValues).toBeNull()
        })
        expect(chart.outlines).toHaveLength(3)
        expect(drawn(f, 0, chart.outlines[0])).toEqual([])
        // An outline is a line with no fill, around the bar as it was: 200 high for 0.5, on the first column.
        const outline = (index: number, t: number) => drawn(f, t, chart.outlines[index])[0]!
        expect(outline(0, 2).fill).toBeNull()
        expect(outline(0, 2).stroke).toEqual(parseColor('ink'))
        const b = pathBounds(outline(0, 2).path)!
        expect([b.x, b.y, b.width, b.height].map(Math.round)).toEqual([960 - 200 - 72, 540, 144, 200])
        expect(Math.round(pathBounds(outline(1, 2).path)!.height)).toBe(120)
        // The bars moved, and the outlines did not.
        expect(at(2, () => pathBounds(chart.bar(0).get('path')!)!.height)).toBeCloseTo(40, 6)
        expect(drawn(f, 3, chart.outlines[0])).toEqual([])
    })

    it('moves the second series to new values, and brings it from the baseline when it does not show', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(make())
            s.play(chart.reference([0.8, 0.1, 0.1]), { duration: 1 })
            s.play(chart.reference([0.4, 0.3, 0.3]), { duration: 1 })
        })
        const height = (index: number, t: number) => pathBounds(drawn(f, t, chart.outlines[index])[0]!.path)!.height
        expect(height(0, 0.5)).toBeGreaterThan(40)
        expect(height(0, 0.5)).toBeLessThan(300)
        expect(height(0, 1)).toBeCloseTo(320, 6)
        expect(height(0, 1.5)).toBeCloseTo(240, 6)
        expect(height(0, 2)).toBeCloseTo(160, 6)
        expect(chart.referenceValues).toEqual([0.4, 0.3, 0.3])
        expect(() => chart.reference([0.5, 0.5])).toThrow('barChart: reference() has 2 values, and the chart has 3 bars. Give one value for each bar')
        expect(() => chart.reference([0.5, Number.NaN, 0.1])).toThrow('barChart: reference(): value 1 is NaN. Each value is a finite number')
    })

    it('draws the second series of the options from the start, holds it in the scale, and brings it in with the bars', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            // No fixed scale: the largest value of both series is at the top of the plot.
            chart = s.add(barChart(DATA, { width: 600, height: 400, reference: [1, 0.25, 0.25], referenceColor: 'orange' }))
            s.wait(1)
            s.play(chart.enter(), { duration: 2 })
        })
        expect(Math.round(pathBounds(drawn(f, 0.5, chart.outlines[0])[0]!.path)!.height)).toBe(400)
        expect(drawn(f, 0.5, chart.outlines[0])[0]!.stroke).toEqual(parseColor('orange'))
        expect(at(0.5, () => pathBounds(chart.bar(0).get('path')!)!.height)).toBeCloseTo(200, 6)
        // At the start of the enter the outlines are away, and at its end they stand.
        expect(drawn(f, 1.05, chart.outlines[0])).toEqual([])
        expect(Math.round(pathBounds(drawn(f, 3, chart.outlines[0])[0]!.path)!.height)).toBe(400)
        // An update that passes the second series takes the scale with it, and the outline follows the scale.
        let grown!: Chart
        const g = await compile((s) => {
            grown = s.add(barChart(DATA, { width: 600, height: 400, reference: [1, 0.25, 0.25] }))
            s.play(grown.update([2, 0.3, 0.2]), { duration: 1 })
        })
        expect(Math.round(pathBounds(drawn(g, 1, grown.outlines[0])[0]!.path)!.height)).toBe(200)
        // Bars that get smaller leave the scale to the second series, and it grows again when the second series goes.
        let small!: Chart
        const h = await compile((s) => {
            small = s.add(barChart(DATA, { width: 600, height: 400, reference: [1, 0.25, 0.25] }))
            s.play(small.update([0.1, 0.1, 0.1]), { duration: 1 })
            s.play(small.reference(null), { duration: 1 })
        })
        expect(Math.round(pathBounds(drawn(h, 1, small.outlines[0])[0]!.path)!.height)).toBe(400)
        expect(at(1, () => pathBounds(small.bar(0).get('path')!)!.height)).toBeCloseTo(40, 6)
        expect(at(2, () => pathBounds(small.bar(0).get('path')!)!.height)).toBeCloseTo(400, 6)
    })

    it('puts the number of a bar past an outline that ends over the bar', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(make())
            s.wait(1)
            s.play(chart.reference([0.2, 0.9, 0.2]), { duration: 1 })
        })
        const number = (index: number, t: number) => boundsOf(drawn(f, t, chart.readouts[index]))
        // The number of "ran" is over its bar of 0.3, and then over the outline of 0.9: 240 higher.
        expect(number(1, 2).bottom).toBeCloseTo(number(1, 1).bottom - 240, 3)
        expect(number(1, 2).bottom).toBeLessThan(540 + 200 - 360)
        // An outline that ends under the bar moves no number.
        expect(number(0, 2).bottom).toBeCloseTo(number(0, 1).bottom, 6)
    })

    it('draws a line across the bars at a value, moves it, and takes it away', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(make())
            s.wait(1)
            s.play(chart.cutAt(0.25, { label: (value) => `p >= ${value.toFixed(2)}` }), { duration: 1 })
            expect(chart.cut).toEqual({ at: 0.25, after: null })
            expect(chart.below()).toEqual([2])
            s.play(chart.cutAt(0.45, { color: 'red' }), { duration: 1 })
            expect(chart.below()).toEqual([1, 2])
            expect(chart.below(0.6)).toEqual([0, 1, 2])
            // A bar at the value is not under it.
            expect(chart.below(0.3)).toEqual([2])
            s.play(chart.cutAt(null), { duration: 1 })
            expect(chart.cut.at).toBeNull()
        })
        expect(chart.valueCut).not.toBeNull()
        expect(drawn(f, 0.5, chart.valueCut)).toEqual([])
        const line = (t: number) => drawn(f, t, chart.valueCut).filter((op) => op.dash)[0]!
        // The line is at the height of the value, from the left edge of the plot to a little past its right edge.
        const b = pathBounds(line(2).path)!
        expect([b.x, b.y, b.height].map(Math.round)).toEqual([660, 540 + 200 - 100, 0])
        expect(b.x + b.width).toBeCloseTo(960 + 300 + 9, 6)
        expect(line(1.99).stroke).toEqual(parseColor('ink'))
        // While it draws, the line grows from the left, and its label is not there yet.
        expect(pathBounds(line(1.3).path)!.width).toBeLessThan(400)
        expect(said(f, 1.3, chart.valueCut)).toEqual([])
        // The label is after the right end of the line, at its height, and it follows the value.
        expect(said(f, 2, chart.valueCut)).toEqual(['p >= 0.25'])
        const words = boundsOf(drawn(f, 2, chart.valueCut).filter((op) => !op.dash))
        expect(words.x).toBeGreaterThan(1269 + 9)
        expect((words.y + words.bottom) / 2).toBeGreaterThan(630)
        expect((words.y + words.bottom) / 2).toBeLessThan(650)
        expect(said(f, 2.5, chart.valueCut)).toEqual(['p >= 0.35'])
        expect(Math.round(pathBounds(line(3).path)!.y)).toBe(540 + 200 - 180)
        // A later call changes what it names: the color here, and the label stays.
        expect(line(3).stroke).toEqual(parseColor('red'))
        expect(said(f, 3, chart.valueCut)).toEqual(['p >= 0.45'])
        expect(drawn(f, 4, chart.valueCut)).toEqual([])
    })

    it('refuses a cut that is not on the scale, and a label that is not a text', async () => {
        const chart = make()
        expect(() => chart.cutAt(1.2)).toThrow('barChart: cutAt(): the value 1.2 is outside the scale, which goes to 1. Give a value of the scale, or a wider `min` and `max`')
        expect(() => chart.cutAt(Number.NaN)).toThrow('barChart: cutAt(): the value is NaN. It is a finite number of the scale')
        expect(() => chart.cutAt(0.5, { label: (() => 5) as never })).toThrow('barChart: cutAt(): the label is a function that returned number. A label is a text')
        expect(() => chart.cutAfter(4)).toThrow('barChart: cutAfter(): the count is 4. It is the number of bars before the line, a whole number from 0 to 3')
        expect(() => chart.cutAfter(1.5)).toThrow('the count is 1.5')
        expect(() => make({ cutAt: { value: 2 } })).toThrow('barChart: the option `cutAt`: the value 2 is outside the scale')
        expect(() => chart.below()).toThrow('barChart: below() needs a value, or a cut that `cutAt()` drew')
        expect(() => chart.tail()).toThrow('barChart: tail() needs a count, or a cut that `cutAfter()` drew')
        // A chart whose scale follows the data takes a cut at any value.
        expect(() => barChart(DATA).cutAt(7)).not.toThrow()
    })

    it('draws a line after a number of bars, between two columns, and gives the bars after it', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(make())
            s.play(chart.cutAfter(2, { label: (count) => `top ${count}` }), { duration: 1 })
            expect(chart.cut).toEqual({ at: null, after: 2 })
            expect(chart.tail()).toEqual([2])
            expect(chart.tail(1)).toEqual([1, 2])
            s.play(chart.cutAfter(1), { duration: 1 })
            expect(chart.tail()).toEqual([1, 2])
        })
        const line = (t: number) => pathBounds(drawn(f, t, chart.rankCut).filter((op) => op.dash)[0]!.path)!
        // The line is between the second and the third column, from the bottom of the plot to over the numbers of the bars.
        expect([line(1).x, line(1).width, line(1).y + line(1).height].map(Math.round)).toEqual([960 + 100, 0, 740])
        expect(line(1).y).toBeCloseTo(540 - 200 - 10 - 30 * 1.25, 6)
        expect(said(f, 1, chart.rankCut)).toEqual(['top 2'])
        const words = boundsOf(drawn(f, 1, chart.rankCut).filter((op) => !op.dash))
        expect(words.bottom).toBeLessThan(line(1).y)
        expect((words.x + words.right) / 2).toBeGreaterThan(1050)
        expect((words.x + words.right) / 2).toBeLessThan(1070)
        expect(Math.round(line(2).x)).toBe(960 - 100)
        expect(said(f, 2, chart.rankCut)).toEqual(['top 1'])
    })

    it('shows the cuts of the options from the start, and lets a film hide one until its verb', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = make({ cutAt: { value: 0.4, label: 'mean' }, cutAfter: { count: 1, label: 'top 1' } })
            // The label of a cut is a part of the measure of the chart from the start, also while it is hidden.
            const right = boxOf(chart).right
            expect(right).toBeGreaterThan(300 + 9 + 12 + 40)
            chart.rankCut!.hide()
            expect(boxOf(chart).right).toBe(right)
            s.add(chart)
            s.wait(1)
            s.play(chart.cutAfter(1), { duration: 1 })
        })
        expect(said(f, 0.5, chart.valueCut)).toEqual(['mean'])
        expect(drawn(f, 0.5, chart.rankCut)).toEqual([])
        expect(said(f, 2, chart.rankCut)).toEqual(['top 1'])
        // The line draws: it does not jump in.
        const half = pathBounds(drawn(f, 1.5, chart.rankCut).filter((op) => op.dash)[0]!.path)!
        expect(half.height).toBeGreaterThan(50)
        expect(half.height).toBeLessThan(400)
        // In an enter, a cut comes after the bars: it is away at the start, and whole at the end.
        let entered!: Chart
        const g = await compile((s) => {
            entered = make({ cutAt: { value: 0.4, label: 'mean' } })
            s.play(entered.enter(), { duration: 2 })
        })
        expect(drawn(g, 0.5, entered.valueCut)).toEqual([])
        expect(pathBounds(drawn(g, 2, entered.valueCut).filter((op) => op.dash)[0]!.path)!.width).toBeCloseTo(609, 6)
        expect(said(g, 2, entered.valueCut)).toEqual(['mean'])
    })

    it('puts the number of a bar past a line of a cut that would cross it', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(make())
            s.wait(1)
            // The line at 0.35 is 20 px over the bar of 0.3, where its number is. It is far from the other two bars.
            s.play(chart.cutAt(0.35), { duration: 1 })
            s.play(chart.cutAt(0.9), { duration: 1 })
        })
        const number = (index: number, t: number) => boundsOf(drawn(f, t, chart.readouts[index]))
        const line = 540 + 200 - 140
        expect(number(1, 1).bottom).toBeGreaterThan(line - 30)
        expect(number(1, 2).bottom).toBeLessThan(line - 9)
        expect(number(1, 2).bottom).toBeCloseTo(number(1, 1).bottom - 20, 3)
        expect(number(0, 2).bottom).toBeCloseTo(number(0, 1).bottom, 6)
        // When the line is far again, the number is back over its bar.
        expect(number(1, 3).bottom).toBeCloseTo(number(1, 1).bottom, 6)
        // A line of the options that the film hides until its verb moves no number.
        let hidden!: Chart, shown!: Chart
        const g = await compile((s) => {
            hidden = make({ cutAt: { value: 0.35 } })
            hidden.valueCut!.hide()
            shown = make({ cutAt: { value: 0.35 } }).at(0, 2000)
            s.add(hidden, shown)
        })
        const top = (chart: Chart) => boundsOf(drawn(g, 0, chart.readouts[1])).bottom - at(0, () => chart.get('y'))
        expect(top(hidden)).toBeCloseTo(number(1, 1).bottom, 6)
        expect(top(shown)).toBeCloseTo(number(1, 2).bottom, 6)
    })

    it('ends each verb in its last picture when the play has no duration', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(make({ states: true }))
            s.play(chart.mark(0, 'target'), chart.mask(2), chart.reference([0.2, 0.2, 0.6]), chart.cutAt(0.4, { label: 'limit' }), chart.cutAfter(1), chart.sort('ascending'), { duration: 0 })
            s.wait(1)
        })
        expect(chart.order).toEqual([2, 1, 0])
        expect(at(0, () => chart.values.map((value) => Math.round(value.value * 1000) / 1000))).toEqual([0.625, 0.375, 0])
        expect(stateMarks(f, 0).map((mark) => [mark.shape, mark.x])).toEqual([['ring', 1160], ['cross', 760]])
        expect(at(0, () => Math.round(middle(chart.bar(0))[0]))).toBe(200)
        expect(Math.round(pathBounds(drawn(f, 0, chart.outlines[2])[0]!.path)!.height)).toBe(240)
        expect(said(f, 0, chart.valueCut)).toEqual(['limit'])
        expect(drawn(f, 0, chart.rankCut).filter((op) => op.dash)).toHaveLength(1)
        // A sort with no time has no bar on its way, so it adds no patch: the bars, the baseline, the labels,
        // the numbers, what each bar carries, and the two cuts.
        expect(chart.children).toHaveLength(3 + 1 + 3 + 3 + 3 + 2)
    })

    it('sorts the bars in steps: one bar goes to its column, and the bars that it passes make room', async () => {
        let chart!: Chart
        const data = [{ label: 'low', value: 0.2 }, { label: 'high', value: 0.5 }, { label: 'mid', value: 0.3 }]
        const f = await compile((s) => {
            chart = s.add(make({ states: true }, data))
            s.play(chart.mark('low', 'target'), { duration: 1 })
            s.play(chart.sort(), { duration: 2 })
            expect(chart.order).toEqual([1, 2, 0])
        })
        const x = (node: Node, t: number) => at(t, () => Math.round(middle(node)[0]))
        expect([0, 1, 2].map((index) => x(chart.bar(index), 1))).toEqual([-200, 0, 200])
        // The first step takes half of the time: "high" goes to the first column, and "low" moves one on. "mid" waits.
        expect([0, 1, 2].map((index) => x(chart.bar(index), 2))).toEqual([0, -200, 200])
        expect([0, 1, 2].map((index) => x(chart.bar(index), 3))).toEqual([200, -200, 0])
        // A bar keeps its index, and its label, its number and its mark go with it.
        expect(chart.bar(1)).toBe(chart.bars[1])
        expect([0, 1, 2].map((index) => x(chart.labels[index]!, 3) - x(chart.labels[index]!, 1))).toEqual([400, -200, -200])
        const number = boundsOf(drawn(f, 3, chart.readouts[0]))
        expect(Math.round((number.x + number.right) / 2)).toBe(960 + 200)
        expect(stateMarks(f, 3).map((mark) => mark.x)).toEqual([960 + 200])
        // A place on the column of a bar follows the bar.
        expect(at(3, () => chart.p('low'))).toEqual([200, 200 - 80])
        expect(at(3, () => chart.p('high', 1))).toEqual([-200, -200])
    })

    it('sorts by the values at the end of the sort, keeps bars with one value in their order, and takes a list', async () => {
        let chart!: Chart
        await compile((s) => {
            chart = s.add(make())
            // The update is named first, so the sort sees its values.
            s.play(chart.update([0.1, 0.6, 0.3]), chart.sort(), { duration: 1 })
            expect(chart.order).toEqual([1, 2, 0])
            s.play(chart.sort('ascending'), { duration: 1 })
            expect(chart.order).toEqual([0, 2, 1])
            s.play(chart.sort(['ran', 0, 'ate']), { duration: 1 })
            expect(chart.order).toEqual([1, 0, 2])
            expect(chart.tail(1)).toEqual([0, 2])
            s.play(chart.update([0.4, 0.4, 0.4]), { duration: 1 })
            s.play(chart.sort(), { duration: 1 })
            expect(chart.order).toEqual([1, 0, 2])
        })
        expect(() => chart.sort([0, 1])).toThrow('barChart: sort() names 2 bars, and the chart has 3. Name each bar one time, in the new order')
        expect(() => chart.sort([0, 1, 1])).toThrow('barChart: sort() names bar 1 ("ran") two times')
        expect(() => chart.sort('up' as never)).toThrow('barChart: sort() got "up". It takes \'descending\', \'ascending\', or a list of the bars in their new order')
    })

    it('refuses a sort that starts while another one moves the bars', async () => {
        await compile((s) => {
            const chart = s.add(make())
            expect(() => s.play(chart.sort('ascending'), chart.sort(), { duration: 1 })).toThrow('barChart: sort() plays from 0 s to 1 s, and the sort before it plays from 0 s to 1 s. A bar has one way to its column')
        })
    })

    it('puts a patch behind a bar that passes others, and none with no backing', async () => {
        let chart!: Chart, bare!: Chart
        const data = [{ label: 'low', value: 0.2 }, { label: 'high', value: 0.5 }]
        const f = await compile((s) => {
            chart = s.add(make({}, data))
            bare = s.add(make({ backing: null }, data).at(0, 2000))
            s.play(chart.sort(), bare.sort(), { duration: 1 })
        })
        // Two bars, the baseline, two labels and two numbers. The sort adds one patch to the first chart.
        expect(bare.children).toHaveLength(7)
        expect(chart.children).toHaveLength(8)
        const patch = chart.children[7]!
        expect(drawn(f, 0.5, patch)[0]!.fill).toEqual(parseColor('bg'))
        // The patch is as wide as one column, under the bar that moves and over the bar that it passes.
        const b = pathBounds(drawn(f, 0.5, patch)[0]!.path)!
        expect(b.width).toBeCloseTo(300, 6)
        expect(Math.round(b.x + b.width / 2)).toBe(960)
        const order = paths(f, 0.5).map((op) => (from(op, patch) ? 'patch' : from(op, chart.bar(1)) ? 'mover' : from(op, chart.bar(0)) ? 'passed' : ''))
        expect(order.indexOf('passed')).toBeLessThan(order.indexOf('patch'))
        expect(order.indexOf('patch')).toBeLessThan(order.indexOf('mover'))
        // After the sort it is away, and the bars are in one layer again.
        expect(drawn(f, 1, patch)).toEqual([])
        expect(at(1, () => patch.get('visible'))).toBe(false)
        expect(at(1, () => chart.bar(1).get('z'))).toBe(0)
    })

    it('lets a part that a bar gets while it moves join the move', async () => {
        let chart!: Chart
        const data = [{ label: 'low', value: 0.2 }, { label: 'mid', value: 0.3 }, { label: 'high', value: 0.5 }]
        const f = await compile((s) => {
            chart = s.add(make({}, data))
            // "low" moves in the two steps of the sort. Its mark comes in the middle of the first step.
            s.play(chart.sort('descending', { duration: 2 }), delay(chart.mark('low', 'target', { duration: 0.2 }), 0.5), chart.reference())
        })
        expect(chart.order).toEqual([2, 1, 0])
        expect(stateMarks(f, 2).map((mark) => mark.x)).toEqual([960 + 200])
        // The outline of the second series was made before the sort, and it is with its bar too.
        const b = pathBounds(drawn(f, 2, chart.outlines[0])[0]!.path)!
        expect(Math.round(b.x + b.width / 2)).toBe(960 + 200)
        // In the first step the mark is where its bar is, between two columns.
        const bar = at(0.9, () => middle(chart.bar(0))[0])
        expect(stateMarks(f, 0.9)[0]!.x).toBeCloseTo(960 + bar, -1)
        expect(bar).toBeGreaterThan(-200)
        expect(bar).toBeLessThan(0)
        // A part that a bar gets after a sort is in the column where the bar is now.
        let later!: Chart
        const g = await compile((s) => {
            later = s.add(make({}, data))
            s.play(later.sort(), { duration: 1 })
            s.play(later.mark('low', 'target'), { duration: 1 })
        })
        expect(stateMarks(g, 2).map((mark) => mark.x)).toEqual([960 + 200])
        // A part that the film gives a bar at a time before a sort that it named first goes with the bar too.
        let early!: Chart
        const h = await compile((s) => {
            early = s.add(make({}, data))
            s.wait(1)
            s.play(early.sort(), { duration: 1 })
            s.at(0.2, () => s.play(early.mark('low', 'target'), { duration: 0.2 }))
        })
        expect(stateMarks(h, 0.5).map((mark) => mark.x)).toEqual([960 - 200])
        expect(stateMarks(h, 2).map((mark) => mark.x)).toEqual([960 + 200])
    })

    it('draws the lines of a fixed scale, and refuses a value that is not on it', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(make({ ticks: [0, 0.5, 1], format: (value) => value.toFixed(1) }))
        })
        expect(said(f, 0, chart.ticks)).toEqual(['0.0', '0.5', '1.0'])
        const lines = drawn(f, 0, chart.ticks).filter((op) => op.stroke && !op.fill).map((op) => pathBounds(op.path)!)
        expect(lines.map((b) => Math.round(b.y))).toEqual([740, 540, 340])
        expect(lines.map((b) => [Math.round(b.x), Math.round(b.width)])).toEqual([[660, 600], [660, 600], [660, 600]])
        // The values are before the left edge of the plot, so `fitted` gives the plot the width that is left.
        const words = boundsOf(drawn(f, 0, chart.ticks).filter((op) => op.fill))
        expect(words.right).toBeLessThan(660 - 10)
        expect(() => make({ ticks: 3, max: undefined })).toThrow('barChart: ticks need a scale that does not change. Give `max` with them')
        expect(() => make({ ticks: [0, 2] })).toThrow('barChart: the tick 2 is not on the scale, which goes from 0 to 1')
        expect(() => chart.update([0.2, 1.4, 0.1])).toThrow('barChart: update(): the value of bar 1 ("ran") is 1.4, and the scale goes from 0 to 1. Give a `min` and a `max` that hold every value')
        expect(() => chart.reference([0.2, 0.2, -0.1])).toThrow('barChart: reference(): the value of bar 2 ("ate") is -0.1, and the scale goes from 0 to 1')
        expect(() => make({ ticks: 2 }, [{ label: 'a', value: 3 }])).toThrow('barChart: the data: the value of bar 0 ("a") is 3')
        // Without ticks, a bar may pass the end of the plot, as it did before.
        expect(() => make().update([0.2, 1.4, 0.1])).not.toThrow()
    })

    it('is as wide as its region with `fitted`, with the values of its scale and the label of a cut', async () => {
        await compileFilm(film(() => {
            const chart = fitted(900, (width) => make({ width, ticks: [0, 0.5, 1], cutAt: { value: 0.5, label: 'a limit with a long name' } }))
            expect(boxOf(chart).width).toBeCloseTo(900, 0)
            expect(chart.region().width).toBeLessThan(700)
        }))
    })

    it('gives the box of a column and of the plot in stage pixels, where the chart is', async () => {
        await compile((s) => {
            const chart = s.add(make().at(100, 50))
            expect(chart.region()).toMatchObject({ left: -200, right: 400, top: -150, bottom: 250 })
            expect(chart.region('ran')).toMatchObject({ left: 0, right: 200, top: -150, bottom: 250 })
            s.play(chart.sort('ascending'), { duration: 1 })
            expect(chart.region('ran')).toMatchObject({ left: 0, right: 200 })
            expect(chart.region('ate')).toMatchObject({ left: -200, right: 0 })
            expect(chart.p(0)).toEqual([200, 0])
        })
    })

    it('keeps a moving column and its connector anchor together in a rotated group', async () => {
        let chart!: Chart
        await compile((s) => {
            chart = make()
            s.add(group(chart).rotate(Math.PI / 4))
            s.play(chart.sort([2, 0, 1]), { duration: 2, ease: linear })
        })
        for (const [time, x] of [[0, 200], [1, 0], [2, -200]] as const) {
            at(time, () => {
                expect(chart.p(2)[0]).toBeCloseTo(x)
                const box = chart.region(2)
                const [cx, cy] = chart.toWorld(x, 0)
                expect(box.cx).toBeCloseTo(cx)
                expect(box.cy).toBeCloseTo(cy)
                expect(box.width).toBeCloseTo(600 / Math.sqrt(2))
                expect(box.height).toBeCloseTo(600 / Math.sqrt(2))
            })
        }
    })

    it('reads the threshold and counts that are visible at the current frame', async () => {
        let bars!: Chart, hist!: ReturnType<typeof histogram>
        await compile((s) => {
            bars = s.add(make({ cutAt: { value: 0.25 } }))
            hist = s.add(bins({ cutAt: { value: 2 } }))
            s.play(bars.cutAt(0.45), hist.cutAt(4), { duration: 2, ease: linear })
            s.play(bars.cutAt(null), hist.cutAt(null))
        })
        expect(at(0, () => bars.below())).toEqual([2])
        expect(at(1, () => bars.below())).toEqual([1, 2])
        expect(at(1, () => hist.sides())).toEqual({ below: 5, above: 5 })
    })

    it('lays a chart of rows out the other way: marks at the left of the labels, and the two cuts turned', async () => {
        let chart!: Chart
        const f = await compile((s) => {
            chart = s.add(barChart([{ label: 'a long name', value: 0.5 }, { label: 'b', value: 0.2 }], { width: 600, height: 200, horizontal: true, max: 1, labelSize: 30, states: true, cutAt: { value: 0.75, label: 'limit' }, cutAfter: { count: 1, label: 'top 1' } }))
            s.play(chart.mark([0, 1], 'chosen'), { duration: 1 })
            s.play(chart.sort('ascending'), { duration: 1 })
        })
        // The marks are in one column, at the left of the longest label.
        const marks = stateMarks(f, 1)
        expect(marks.map((mark) => mark.y)).toEqual([490, 590])
        expect(marks[0]!.x).toBe(marks[1]!.x)
        const long = boundsOf(drawn(f, 1, chart.labels[0]))
        expect(marks[0]!.x).toBeLessThan(long.x - 10)
        // The line of a value runs down the plot, and its label is over the plot.
        const value = pathBounds(drawn(f, 1, chart.valueCut).filter((op) => op.dash)[0]!.path)!
        expect([value.x, value.width, value.y + value.height].map(Math.round)).toEqual([960 - 300 + 450, 0, 640])
        expect(boundsOf(drawn(f, 1, chart.valueCut).filter((op) => !op.dash)).bottom).toBeLessThan(440)
        // The line of a rank runs between two rows, and its label is after the plot.
        const rank = pathBounds(drawn(f, 1, chart.rankCut).filter((op) => op.dash)[0]!.path)!
        expect([rank.x, rank.y, rank.height].map(Math.round)).toEqual([660, 540, 0])
        expect(boundsOf(drawn(f, 1, chart.rankCut).filter((op) => !op.dash)).x).toBeGreaterThan(1260)
        // A sort moves the rows up and down.
        expect(at(2, () => Math.round(middle(chart.bar(0))[1]))).toBe(50)
        expect(stateMarks(f, 2).map((mark) => mark.y)).toEqual([590, 490])
    })

    it('names a bar by its index or its label, and says which bars there are', async () => {
        const chart = make()
        expect(chart.find('ran')).toBe(1)
        expect(chart.find('none')).toBeNull()
        expect(() => chart.mark('none', 'target')).toThrow('barChart: mark(): no bar has the label "none". The labels are "sat", "ran", "ate"')
        expect(() => chart.mark(3, 'target')).toThrow('barChart: mark(): no bar 3. The chart has 3 bars, 0 to 2')
        expect(() => chart.mask(1.5)).toThrow('barChart: mask(): no bar 1.5')
        expect(() => chart.state(null as never)).toThrow('barChart: state(): a bar is named by its index or by its label, and it got null')
        const twins = make({}, [{ label: 'a', value: 0.5 }, { label: 'a', value: 0.5 }])
        expect(() => twins.mark('a', 'target')).toThrow('barChart: mark(): 2 bars have the label "a". Name the bar by its index: 0, 1')
        expect(() => twins.find('a')).toThrow('2 bars have the label "a"')
        expect(() => chart.update([1, 2, 3, 4])).toThrow('barChart: update() got 4 values, and the chart has 3 bars. Give one value for each bar')
        expect(() => chart.update([1, Number.POSITIVE_INFINITY])).toThrow('barChart: update(): value 1 is Infinity. Each value is a finite number')
    })

    it('makes a copy that is a still picture, and refuses to act on it', async () => {
        await compile((s) => {
            const chart = s.add(make({ states: true }))
            s.play(chart.sort('ascending'), chart.mark(0, 'target'), { duration: 1 })
            const copy = chart.clone()
            // The copy has the order and the states of its source at that time, and its own nodes.
            expect(copy.order).toEqual([2, 1, 0])
            expect(copy.state(0)).toBe('target')
            expect(copy.bars[0]).not.toBe(chart.bars[0])
            for (const act of [() => copy.mark(1, 'chosen'), () => copy.clearStates(), () => copy.mask(1), () => copy.reference(), () => copy.cutAt(0.5), () => copy.cutAfter(1), () => copy.sort()]) {
                expect(act).toThrow(/^barChart: \w+\(\) is called on a copy of a chart\. Build a second chart from the data/)
            }
            // The source is as it was: a later change of its order leaves the copy alone.
            s.play(chart.sort(), { duration: 1 })
            expect(chart.order).toEqual([0, 1, 2])
            expect(copy.order).toEqual([2, 1, 0])
            const twin = bins().clone()
            expect(() => twin.cutAt(2)).toThrow('histogram: cutAt() is called on a copy of a histogram')
            expect(() => twin.outline([1])).toThrow('histogram: outline() is called on a copy of a histogram')
        })
    })

    it('refuses to change a bar chart, a histogram, or its outline inside a cloned group', async () => {
        let copies: Node[] = [], before = 0
        const f = await compile((s) => {
            const bars = make({ cutAt: { value: 0.25 }, cutAfter: { count: 1 } })
            const hist = bins({ cutAt: { value: 2 } })
            const outline = hist.outline([1, 4])
            const original = s.add(group(group(bars, hist)))
            s.play(bars.sort([2, 0, 1]), bars.mark(0, 'target'))
            const first = s.add(original.clone())

            // The second copy must take its order and state from the first copy.
            s.play(bars.sort([1, 2, 0]), bars.mark(0, 'chosen'))
            const second = s.add(first.clone())
            copies = [first, second]
            before = s.time
            s.play(bars.update([0.4, 0.5, 0.1]), bars.cutAt(0.75), bars.cutAfter(2), hist.cutAt(4))

            const nodes = [original, first, second].flatMap((root) => root.all())
            expect(new Set(nodes).size).toBe(nodes.length)
            for (const root of [first, second]) {
                const parts = root.children[0]!.children
                const barCopy = parts[0] as typeof bars, histCopy = parts[1] as typeof hist
                const outlineCopy = histCopy.children[hist.children.indexOf(outline)] as typeof outline
                for (const part of [barCopy.bar(0), barCopy.valueCut, barCopy.rankCut]) expect(barCopy.children).toContain(part)
                expect(histCopy.children).toContain(histCopy.threshold)
                expect(barCopy.order).toEqual([2, 0, 1])
                expect(barCopy.state(0)).toBe('target')
                expect(barCopy.cut).toEqual({ at: 0.25, after: 1 })
                expect(histCopy.cut).toBe(2)
                for (const change of [
                    () => barCopy.mark(0, 'chosen'), () => barCopy.clearStates(), () => barCopy.mask(0),
                    () => barCopy.reference(), () => barCopy.cutAt(0.5), () => barCopy.cutAfter(2),
                    () => barCopy.sort(), () => histCopy.cutAt(3), () => outlineCopy.fillUp({ count: 1 }),
                ]) expect(() => s.play(change())).toThrow(/copy|clone/i)
                expect(() => histCopy.outline([2])).toThrow(/copy|clone/i)
            }
            expect(bars.order).toEqual([1, 2, 0])
            expect(bars.state(0)).toBe('chosen')
            expect(bars.cut).toEqual({ at: 0.75, after: 2 })
            expect(hist.cut).toBe(4)
            expect(outline.shown.value).toBe(2)
        })
        for (const copy of copies) {
            const picture = (time: number) => drawn(f, time, copy).map((op) => [op.path, op.fillAlpha, op.strokeAlpha])
            expect(picture(before).length).toBeGreaterThan(0)
            expect(picture(f.duration)).toEqual(picture(before))
        }
    })

    it('refuses overlapping state changes on one bar and recommends a sequence', async () => {
        await compile((s) => {
            const chart = s.add(make())
            const changes = ['target', 'chosen', 'target'].map((state) => chart.mark(0, state, { duration: 1 }))
            expect(() => s.play(lagged(changes, { lag: 0.2 }))).toThrow(/(?=.*\b(?:mark|state)\b).*\bseq\b/i)
        })
    })

    for (const [name, makeCut] of [
        ['barChart.cutAt', () => { const chart = make({ max: 3 }); return chart.cutAt.bind(chart) }],
        ['barChart.cutAfter', () => { const chart = make(); return chart.cutAfter.bind(chart) }],
        ['histogram.cutAt', () => { const chart = bins(); return chart.cutAt.bind(chart) }],
    ] as const) {
        it(`refuses overlapping calls to ${name} and recommends a sequence`, async () => {
            await compile((s) => {
                const cut = makeCut()
                expect(() => s.play(cut(1, { duration: 1 }), delay(cut(2, { duration: 1 }), 0.5))).toThrow(/\bseq\b/i)
            })
        })

        it(`refuses disjoint calls to ${name} scheduled in reverse time order`, async () => {
            await compile((s) => {
                const cut = makeCut()
                const late = delay(cut(2, { label: 'late', duration: 1 }), 2)
                const early = cut(1, { label: 'early', duration: 1 })
                expect(() => s.play(late, early)).toThrow(/chronolog|\border\b|earl(?:y|ier).*first/i)
            })
        })
    }

    it('refuses a color that the look does not have where the film names it', async () => {
        expect(() => make({ referenceColor: 'nope' })).toThrow('Unknown color: "nope"')
        expect(() => make({ backing: 'nope' })).toThrow('Unknown color: "nope"')
        expect(() => make({ cutAt: { value: 0.5, color: 'nope' } })).toThrow('Unknown color: "nope"')
        expect(() => make().cutAfter(1, { color: 'nope' })).toThrow('Unknown color: "nope"')
        expect(() => make({ states: { odd: { color: 'nope', mark: 'dot' } } })).toThrow('Unknown color: "nope"')
        expect(() => bins().cutAt(2, { color: 'nope' })).toThrow('Unknown color: "nope"')
        expect(() => bins().outline([1], { color: 'nope' })).toThrow('Unknown color: "nope"')
    })

    it('takes the changes of the state of a bar in the order of time', async () => {
        await compile((s) => {
            const chart = s.add(make())
            s.wait(2)
            s.play(chart.mark(0, 'target'), { duration: 1 })
            expect(() => s.at(1, () => s.play(chart.mark(0, 'chosen'), { duration: 0.5 }))).toThrow('barChart: mark() changes the state of bar 0 ("sat") at 1 s, and the film named a change of the same bar at 2 s before it')
        })
    })

    it('reports nothing on its own layout, at a text gap of 0.3 and of 0.7', async () => {
        const scene = film({ fps: 10 }, (s) => {
            const chart = s.add(make({ states: true, ticks: [0, 0.5, 1], reference: [0.3, 0.4, 0.3], cutAt: { value: 0.35, label: 'limit 0.35' }, cutAfter: { count: 2, label: 'top 2' }, format: (value) => value.toFixed(2) }))
            s.play(chart.mark(0, 'target'), chart.mark(1, 'chosen'), { duration: 0.5 })
            s.play(chart.mask(2), { duration: 1 })
            s.wait(0.5)
        })
        for (const textGap of [0.3, 0.7]) expect((await checkFilm(scene, { textGap })).diagnostics, `gap ${textGap}`).toEqual([])
    })

    it('draws a threshold on a histogram, with the count of the samples on each side', async () => {
        let chart!: ReturnType<typeof histogram>
        const f = await compile((s) => {
            chart = s.add(bins())
            s.wait(1)
            s.play(chart.cutAt(2.5, { label: 'limit' }), { duration: 1 })
            expect(chart.cut).toBe(2.5)
            // A sample at the value is at or over it.
            expect(chart.sides()).toEqual({ below: 4, above: 6 })
            expect(chart.sides(2.6)).toEqual({ below: 4, above: 6 })
            expect(chart.sides(2.61)).toEqual({ below: 5, above: 5 })
            s.play(chart.cutAt(4), { duration: 1 })
            expect(chart.sides()).toEqual({ below: 9, above: 1 })
            s.play(chart.cutAt(null), { duration: 1 })
            expect(chart.cut).toBeNull()
        })
        expect(drawn(f, 0.5, chart.threshold)).toEqual([])
        // The line is at the value, from the baseline to over the plot.
        const line = pathBounds(drawn(f, 2, chart.threshold).filter((op) => op.dash)[0]!.path)!
        expect([line.x, line.width, line.y + line.height].map(Math.round)).toEqual([960, 0, 640])
        expect(line.y).toBeLessThan(440 - 30)
        expect(said(f, 2, chart.threshold)).toEqual(['4', '6', 'limit'])
        // The count of the samples under the value is at the left of the line, and the other one at its right.
        const texts = drawn(f, 2, chart.threshold).filter((op) => !op.dash)
        const of = (source: string) => boundsOf(texts.filter((op) => (op.node!.parent as TextNode).source === source))
        expect(of('4').right).toBeLessThan(960)
        expect(of('6').x).toBeGreaterThan(960)
        expect(of('4').bottom).toBeLessThan(440)
        expect(of('limit').bottom).toBeLessThan(of('6').y)
        // While the line moves, the counts follow it: at half of the way it is at 3.25.
        expect(said(f, 2.5, chart.threshold).slice(0, 2)).toEqual(['7', '3'])
        expect(said(f, 3, chart.threshold).slice(0, 2)).toEqual(['9', '1'])
        expect(drawn(f, 4, chart.threshold)).toEqual([])
    })

    it('keeps one side of a threshold bright, and cuts the bar that the line is in', async () => {
        let chart!: ReturnType<typeof histogram>, low!: ReturnType<typeof histogram>, both!: ReturnType<typeof histogram>
        const f = await compile((s) => {
            chart = s.add(bins({ cutAt: { value: 2.5 } }))
            low = s.add(bins({ cutAt: { value: 2.5, keep: 'below' } }).at(0, 1000))
            both = s.add(bins({ cutAt: { value: 2.5, keep: 'both' } }).at(0, 2000))
        })
        // The bins of 1 and of 2 are at the left, the bin of 2 is cut in two halves, and the bins of 3 and 4 are at the right.
        const parts = fills(f, 0, chart).map((op) => { const b = pathBounds(op.path)!; return [Math.round(b.x - 960), Math.round(b.width), Math.round(b.height), Math.round(op.fillAlpha * 100) / 100] })
        expect(parts).toEqual([[-150, 100, 100, 0.3], [-50, 50, 150, 0.3], [0, 50, 150, 1], [50, 100, 200, 1], [150, 100, 50, 1]])
        expect(fills(f, 0, low).map((op) => Math.round(op.fillAlpha * 100) / 100)).toEqual([1, 1, 0.3, 0.3, 0.3])
        // With both sides kept, the bars are one shape, as in a histogram with no threshold.
        expect(fills(f, 0, both)).toHaveLength(1)
        expect(fills(f, 0, both)[0]!.fillAlpha).toBe(1)
        expect(said(f, 0, both.threshold)).toEqual(['4', '6'])
        // A threshold of the options that the film hides until its verb leaves the bars as they are.
        let hidden!: ReturnType<typeof histogram>
        const g = await compile((s) => {
            hidden = bins({ cutAt: { value: 2.5 } })
            hidden.threshold!.hide()
            s.add(hidden)
            s.wait(1)
            s.play(hidden.cutAt(2.5), { duration: 1 })
        })
        expect(fills(g, 0.5, hidden)).toHaveLength(1)
        expect(fills(g, 2, hidden)).toHaveLength(5)
    })

    it('counts the samples that show, and writes a count as the film asks', async () => {
        let chart!: ReturnType<typeof histogram>
        const f = await compile((s) => {
            chart = s.add(bins({ cutAt: { value: 3, count: (count, total) => `${count} of ${total}` } }))
            s.play(chart.fillUp({ count: 5, ease: linear }), { duration: 1 })
            expect(chart.sides()).toEqual({ below: 5, above: 0 })
            expect(chart.counts()).toEqual([0, 2, 3, 0, 0])
            s.play(chart.fillUp({ ease: linear }), { duration: 1 })
            expect(chart.sides()).toEqual({ below: 5, above: 5 })
            expect(chart.counts()).toEqual([0, 2, 3, 4, 1])
        })
        expect(said(f, 1, chart.threshold)).toEqual(['5 of 5', '0 of 5'])
        expect(said(f, 2, chart.threshold)).toEqual(['5 of 10', '5 of 10'])
        // A sample outside the range is in no bar and in no count.
        const wide = histogram([-1, 1, 2, 9], { bins: 5, range: [0, 5] })
        expect(wide.sides(1.5)).toEqual({ below: 1, above: 1 })
    })

    it('refuses a threshold that is not on the axis, and options that it cannot draw', async () => {
        const chart = bins()
        expect(() => chart.cutAt(6)).toThrow('histogram: cutAt(): the value 6 is outside the axis, which goes from 0 to 5. Give a value of the axis, or a wider `range`')
        expect(() => chart.cutAt(Number.NaN)).toThrow('histogram: cutAt(): the value is NaN')
        expect(() => chart.cutAt(2, { keep: 'left' as never })).toThrow('histogram: cutAt(): keep is "left". It is \'above\', \'below\' or \'both\'')
        expect(() => chart.cutAt(2, { count: (() => 3) as never })).toThrow('histogram: cutAt(): count returned number. It returns a text')
        expect(() => bins({ cutAt: { value: -1 } })).toThrow('histogram: the option `cutAt`: the value -1 is outside the axis')
        expect(() => chart.sides()).toThrow('histogram: sides() needs a value, or a threshold that `cutAt()` drew')
    })

    it('draws a second distribution as one outline on the same bins, and fills it up', async () => {
        let chart!: ReturnType<typeof histogram>, second!: ReturnType<ReturnType<typeof histogram>['outline']>
        const f = await compile((s) => {
            chart = s.add(bins())
            second = chart.outline([0.5, 4.2, 4.8, 4.9], { color: 'orange' })
            expect(second.counts()).toEqual([1, 0, 0, 0, 3])
            expect(second.sides(4.5)).toEqual({ below: 2, above: 2 })
            s.play(second.fillUp({ ease: linear }), { duration: 2 })
        })
        expect(second.parent).toBe(chart)
        expect(drawn(f, 0, second)).toEqual([])
        const line = drawn(f, 2, second)[0]!
        expect(line.fill).toBeNull()
        expect(line.stroke).toEqual(parseColor('orange'))
        // One line from the baseline at the left end, over the top of each bin, to the baseline at the right end.
        const points = line.path[0]!.p
        const corners: number[][] = []
        for (let i = 0; i < points.length; i += 6) corners.push([Math.round(points[i]! - 960), Math.round(points[i + 1]! - 540)])
        expect(corners.slice(0, 4)).toEqual([[-250, 100], [-250, 50], [-150, 50], [-150, 100]])
        expect(corners.slice(-3)).toEqual([[150, -50], [250, -50], [250, 100]])
        // After one sample of four, only the first bin is up.
        expect(pathBounds(drawn(f, 0.5, second)[0]!.path)!.height).toBeCloseTo(50, 6)
        // The histogram under it is as it was: one shape for all its bars.
        expect(fills(f, 2, chart)).toHaveLength(1)
    })

    it('refuses a second distribution that is higher than the scale, and says what scale holds it', async () => {
        const chart = bins()
        expect(() => chart.outline([1, 1, 1, 1, 1])).toThrow('histogram: outline(): one bin of the second distribution holds 5 samples, and the scale of the histogram ends at 4. Give the histogram `max: 5` or more, so that both distributions fit')
        expect(() => bins({ max: 5 }).outline([1, 1, 1, 1, 1])).not.toThrow()
        expect(() => chart.outline([1, Number.NaN])).toThrow('histogram: outline(): sample 1 is NaN. Each sample is a finite number')
        expect(() => chart.outline([1]).fillUp({ count: 2 })).toThrow('histogram: outline: fillUp() got the count 2. It is from 0 to 1, the number of samples')
    })
})

describe('heatmap as a tensor grid', () => {
    type Grid = ReturnType<typeof heatmap>
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)
    const source = (node: Node | null | undefined) => (node as (Node & { source?: string }) | null | undefined)?.source
    const sizeOf = (node: Node) => (node as Node & { size?: number }).size
    const half = expect.closeTo(0.5, 6)
    /** The sign of the state of a cell: the last node that the grid ties to the cell, after its numbers. */
    const signOf = (grid: Grid, row: number, col: number) => { const parts = grid.labelsOf(grid.cell(row, col)); return parts[parts.length - 1]! }
    const inkOf = (label: Node) => label.children[0]!.get('fill')

    it('draws as it did before it had a size: cells of 44, labels of 16, and a number of any width', async () => {
        await compileFilm(film(() => {
            const plain = heatmap([[0.123456, 1]], { values: true, rowLabels: ['a'], format: (value) => value.toFixed(6) })
            expect(plain.cell(0, 0).bounds().width).toBe(44)
            expect(sizeOf(plain.rowLabels[0]!)).toBe(16)
            // The number is wider than its cell, and the grid still draws: a film from before `size` keeps its frames.
            expect(plain.numbers[0]![0]!.bounds().width).toBeGreaterThan(44)
            expect(plain.frame).toBeNull()
            expect(plain.caption).toBeNull()
        }))
    })

    describe('heatmap regressions', () => {
        it('keeps shipped updates as simultaneous fill tweens and preserves the printed nodes', async () => {
            let printed!: Node
            const f = await compile((s) => {
                const grid = s.add(heatmap([[0, 1]], { values: true }))
                const original = [...grid.numbers[0]!]
                printed = original[0]!
                s.play(grid.update([[1, 0]], { lag: 1 }), { duration: 1, ease: linear })
                const low = grid.colorFor(0), high = grid.colorFor(1)
                expect(at(0.5, () => grid.row(0).map((cell) => cell.get('fill')))).toEqual([mixColor(low, high, 0.5), mixColor(high, low, 0.5)])
                s.play(grid.update([[0.5]]), grid.update([[0.25]]))
                expect(grid.numbers[0]![0]).toBe(original[0])
                expect(grid.numbers[0]![1]).toBe(original[1])
                expect(grid.numbers[0]!.map(source)).toEqual(['0', '1'])
                expect(grid.values()).toEqual([[0.25, 0]])
                s.play(spotlight(grid.cell(0, 0)))
            })
            expect(at(f.duration, () => printed.get('dim'))).toBeLessThan(1)
        })

        it('keeps the cells, their signs, and the axis parts inside a cloned group', async () => {
            await compile((s) => {
                const grid = heatmap([[0, 1]], { values: true, axes: ['r', 'c'], initial: 'masked' })
                const holder = s.add(group(grid))
                const duplicate = s.add(holder.clone().at(0, 200))
                const copy = duplicate.children[0] as Grid
                s.play(copy.setValue({ col: 0 }, 1, { state: 'open' }))
                const again = s.add(duplicate.clone().at(0, -200)).children[0] as Grid
                s.play(again.setValue({ col: 1 }, 0, { state: 'open' }))
                expect(grid.value(0, 0)).toBe(0)
                expect(grid.stateOf(0, 0)).toBe('masked')
                expect(grid.numbers[0]![0]!.parent).toBe(grid)
                expect(copy.cell(0, 0).parent).toBe(copy)
                expect(copy.numbers[0]![0]!.parent).toBe(copy)
                expect(copy.axis('r').parent).toBe(copy)
                expect(shows(signOf(grid, 0, 0))).toBe(1)
                expect(shows(signOf(copy, 0, 0))).toBe(0)
                expect(again.values()).toEqual([[1, 0]])
                expect(copy.values()).toEqual([[1, 1]])
                expect(grid.values()).toEqual([[0, 1]])
                expect(again.cell(0, 1).parent).toBe(again)
                expect(again.axis('c').parent).toBe(again)
                expect(again.numbers[0]![1]!.parent).toBe(again)
                expect(shows(again.numbers[0]![1]!)).toBe(1)
                expect(shows(copy.numbers[0]![1]!)).toBe(0)
                expect(shows(signOf(copy, 0, 1))).toBe(1)
                expect(shows(signOf(again, 0, 1))).toBe(0)
            })
        })

        it('bounds rotated cells and every cell of an unrolled slice that crosses patches', async () => {
            await compile((s) => {
                const square = heatmap([[0]], { size: 28, cell: 100, radius: 0 })
                s.add(group(square).set('rotation', Math.PI / 4))
                expect(square.region().width).toBeCloseTo(square.cell(0, 0).bounds().width)
                const grid = s.add(heatmap(Array.from({ length: 4 }, () => [0, 1, 2, 3]), { size: 28, cell: 60, gap: 4 }))
                s.play(grid.cut(2, 2, { unroll: true, gap: 20 }))
                expect(grid.region({ row: [0, 2] })).toEqual(boxOf(grid.cells.slice(0, 3).flat()))
            })
        })

        it('rejects overlapping writes before changing any cell of the rejected operation', async () => {
            await compile((s) => {
                const grid = s.add(heatmap([[0, 1]], { size: 28 }))
                expect(() => s.play(lagged([grid.mark({ col: 1 }, 'masked'), grid.mark({}, 'future')], { lag: 0.2 }))).toThrow(/cell.*seq/)
                expect(grid.stateOf(0, 0)).toBe('open')
                expect(grid.stateOf(0, 1)).toBe('masked')
                expect(grid.labelsOf(grid.cell(0, 0))).toHaveLength(0)
            })
        })

        it('checks function values for every selected cell before painting the slice', async () => {
            await compile((s) => {
                const grid = s.add(heatmap([[0, 1]], { size: 28, values: true }))
                expect(() => s.play(grid.setValue({}, (_row, col) => col === 0 ? 1 : NaN))).toThrow(/NaN/)
                expect(grid.values()).toEqual([[0, 1]])
                expect(grid.numbers[0]!.map(source)).toEqual(['0', '1'])
            })
        })

        it('protects lit numbers and moving cells from concurrent changes', async () => {
            await compile((s) => {
                const lit = s.add(heatmap([[0, 1]], { values: 'lit' }))
                expect(() => s.play(lit.light({ col: 0 }), lit.setValue({ col: 0 }, 1))).toThrow(/cell.*seq/)
                const grid = s.add(heatmap([[0, 1]], { size: 28, values: true }))
                expect(() => s.play(grid.setValue({ col: 0 }, 1), grid.cut(1, 1))).toThrow(/cell.*seq/)
                const lights = s.add(heatmap([[0, 1]], { size: 28 }))
                expect(() => s.play(lights.light({ col: 0 }), lights.light({ col: 1 }))).toThrow(/light.*seq/)
            })
        })

        it('resolves the size of a patch when its cut plays and refreshes names on join', async () => {
            await compile((s) => {
                const grid = s.add(heatmap([[0], [1]], { size: 28, rowLabels: ['a', 'b'] }))
                s.play(grid.light({ row: 0 }))
                s.play(seq(grid.cut(2, 1, { unroll: true }), grid.setValue({ patch: 0 }, [1, 0]), grid.join()))
                expect(grid.values()).toEqual([[1], [0]])
                expect(grid.lit).toBeNull()
                expect(grid.rowLabels.map(inkOf)).toEqual([parseColor('dim'), parseColor('dim')])
            })
        })

        it('keeps identical formatted text readable when the cell changes shade', async () => {
            await compile((s) => {
                const grid = s.add(heatmap([[0, 0, 0.4]], { size: 28, values: true, colors: ['#000', '#fff'], format: (v) => v.toFixed(0), initial: (_r, c) => c === 1 ? 'masked' : 'open' }))
                s.play(grid.update([[0.4, 0.4]]))
                expect(shows(grid.numbers[0]![1]!)).toBe(0)
                s.play(grid.mark({ col: 1 }, 'open'))
                const reference = grid.numbers[0]![2]!
                for (const label of grid.numbers[0]!) {
                    expect(source(label)).toBe('0')
                    expect(shows(label)).toBe(1)
                    expect(inkOf(label)).toEqual(inkOf(reference))
                }
            })
        })

        it('rejects missing row values and heights that overlap the names of adjacent rows', async () => {
            await compile((s) => {
                expect(() => heatmap([null] as never, { size: 28 })).toThrow(/heatmap:.*rows/)
                expect(() => heatmap([Array<number>(2)], { size: 28 })).toThrow(/heatmap:.*cell \(0, 0\)/)
                expect(() => heatmap([[0], [1]], { size: 28, cellHeight: 5, rowLabels: ['WWW', 'WWW'] })).toThrow(/heatmap:.*row.*cellHeight/)
                s.wait(0.1)
            })
        })

        it.each([
            { domain: [NaN, 1] as const }, { domain: [2, 1] as const }, { colors: [] }, { colors: [[0, 0, Infinity, 1] as const] },
        ])('rejects invalid sized color options %# before drawing', async (options) => {
            await compile(() => {
                expect(() => heatmap([[0, 1]], { size: 28, ...options })).toThrow(/heatmap:.*(?:domain|colors)/)
            })
        })

        it('selects the existing cells of a ragged legacy chart and explains why it cannot be cut', async () => {
            await compile((s) => {
                const grid = s.add(heatmap([[0], [1, 2]]))
                expect(grid.find(() => true)).toEqual([[0, 0], [1, 0], [1, 1]])
                expect(grid.region({ row: 0 }).width).toBe(44)
                s.play(grid.mark({}, 'masked'))
                expect(grid.count('masked')).toBe(3)
                expect(() => grid.cut(1, 1)).toThrow(/heatmap:.*rectangular/)
            })
        })

        it('rejects an invalid lag before writing any cells', async () => {
            await compile((s) => {
                const grid = s.add(heatmap([[0, 1]], { size: 28 }))
                expect(() => s.play(grid.setValue({}, [1, 0], { lag: Infinity }))).toThrow(/heatmap:.*lag.*finite/)
                expect(grid.values()).toEqual([[0, 1]])
            })
        })
    })

    it('with a size, makes a cell wide enough for the widest number, on whole pixels, and prints every text at that size', async () => {
        await compileFilm(film(() => {
            const grid = heatmap([[0.25, -0.75], [1, 0]], { size: 30, values: true, rowLabels: ['cat', 'sat'], columnLabels: ['d0', 'd1'] })
            const widest = Math.max(...grid.numbers.flat().map((number) => number.bounds().width))
            // The widest number has 0.45 of the text size at each side.
            expect(grid.cell(0, 0).bounds().width).toBe(Math.ceil(widest + 27))
            expect(grid.cell(0, 0).bounds().height).toBe(grid.cell(0, 0).bounds().width)
            expect([...grid.numbers.flat(), ...grid.rowLabels, ...grid.columnLabels].map(sizeOf)).toEqual(Array.from({ length: 8 }, () => 30))
            for (const cell of grid.cells.flat()) {
                const box = cell.bounds()
                expect([box.x, box.y]).toEqual([Math.round(box.x), Math.round(box.y)])
            }
            // Three cells of 75 with two gaps of 4 are 233 wide. The edges are on whole pixels, and the middle is half a pixel off.
            const odd = heatmap([[1, 2, 3]], { size: 28, cell: 75, gap: 4 })
            expect(odd.cells[0]!.map((cell) => cell.bounds().x)).toEqual([-116, -37, 42])
            expect(odd.cell(0, 0).bounds().y).toBe(-37)
            // An option of a tensor with no size gives text of 28. A cell with a short number has the room of four
            // characters, so that a number such as 0.25 can take the place of a 1. A grid with no number has 2.6 of the size.
            const named = heatmap([[1, 2]], { values: true, name: 'x', domain: [0, 2] })
            expect([sizeOf(named.numbers[0]![0]!), sizeOf(named.caption!)]).toEqual([28, 28])
            const four = text('0.00', { size: 28, font: 'mono' }).bounds().width
            expect(named.cell(0, 0).bounds().width).toBe(Math.ceil(four + 25.2))
            expect(named.setValue({ row: 0, col: 0 }, 0.25, { state: 'open' }).label).toBe('heatmap.setValue')
            expect(heatmap([[1, 2]], { size: 28 }).cell(0, 0).bounds().width).toBe(73)
        }))
    })

    it('gives the middle of a cell, the middle of an edge, and the box of a slice on the stage', async () => {
        await compileFilm(film(() => {
            const grid = heatmap([[1, 2, 3], [4, 5, 6]], { size: 28, cell: 100, gap: 4 }).at(200, 50)
            expect(grid.p(0, 0)).toEqual([-104, -52])
            expect(grid.p(1, 2)).toEqual([104, 52])
            expect(grid.p(1, 2, 'top')).toEqual([104, 2])
            expect(grid.p(1, 2, 'right')).toEqual([154, 52])
            grid.cells.forEach((row, i) => row.forEach((cell, j) => expect([cell.get('x'), cell.get('y')]).toEqual(grid.p(i, j))))
            const whole = grid.region(), row = grid.region({ row: 1 }), block = grid.region({ row: 0, col: [1, 2] })
            expect([whole.left, whole.top, whole.right, whole.bottom]).toEqual([46, -52, 354, 152])
            expect([row.left, row.top, row.right, row.bottom]).toEqual([46, 52, 354, 152])
            expect([block.left, block.top, block.right, block.bottom]).toEqual([150, -52, 354, 48])
            expect(grid.values({ row: 1, col: [0, 1] })).toEqual([[4, 5]])
            expect(() => grid.p(2, 0)).toThrow(/no cell \(2, 0\)\. It is 2 by 3/)
            expect(() => grid.p(0, 0, 'middle' as never)).toThrow(/the edge of p\(\) is 'top', 'bottom', 'left' or 'right', not "middle"/)
            expect(() => grid.region({ row: 5 })).toThrow(/the row of a slice is 5\. Give one row, or the first and the last one, from 0 to 1/)
            expect(() => grid.region({ rows: 1 } as never)).toThrow(/a slice has no part "rows"\. Its parts are: row, col, patch/)
            expect(() => grid.region({ row: [1, 0] })).toThrow(/the row of a slice is \[1, 0\]/)
        }))
    })

    it('stops for a text that does not fit and for values that are not a grid, and names the change that works', async () => {
        await compileFilm(film(() => {
            expect(() => heatmap([[0.123, 0.5]], { size: 30, values: true, cell: 40, format: (value) => value.toFixed(3) })).toThrow(/a cell is 40 px wide, and the widest number needs \d+ at size 30\. Give a cell of \d+ or more, a smaller size, or a format with fewer digits/)
            expect(() => heatmap([[1, 2]], { size: 30, columnLabels: ['a very long name', 'b'] })).toThrow(/the column label "a very long name" is \d+ px wide at size 30, and a column is 82 px wide\. Give a cell of \d+ or more, a shorter label, a smaller labelSize, or columnLabelAngle/)
            // Tilted, the same label fits.
            expect(heatmap([[1, 2]], { size: 30, columnLabels: ['a very long name', 'b'], columnLabelAngle: -Math.PI / 4 }).columnLabels).toHaveLength(2)
            let message = ''
            try {
                heatmap([[0.25, 0.5, 0.75]], { width: 120, values: true })
            } catch (error) {
                message = (error as Error).message
            }
            expect(message).toMatch(/a width of 120 gives each of the 3 columns 38 px, and the widest number needs \d+\. Give a width of \d+ or more, a smaller size, or a format with fewer digits/)
            // The width of the message is enough, and the cells share it.
            const enough = Number(/Give a width of (\d+)/.exec(message)![1])
            const fits = heatmap([[0.25, 0.5, 0.75]], { width: enough, values: true })
            expect(fits.region().width).toBeCloseTo(enough, 6)
            expect(() => heatmap([[1, 2], [3]], { size: 28 })).toThrow(/row 1 has 1 values, and row 0 has 2\. Give every row the same number of values/)
            expect(() => heatmap([[1, Number.NaN]], { size: 28 })).toThrow(/the value of cell \(0, 1\) is NaN\. A value is a number\. For a cell with no value yet, give a number and the state 'empty'/)
            expect(() => heatmap([[1, 2]], { size: 28, rowLabels: ['a', 'b'] })).toThrow(/rowLabels has 2 names, and the grid has 1 rows/)
            expect(() => heatmap([[1, 2]], { width: 300, cell: 60 })).toThrow(/width sets the width of a cell, and so does cell\. Give one of them/)
            expect(() => heatmap([[1, 2]], { axes: ['batch', 'seq', 'd'] })).toThrow(/axes has 3 names, and a grid has 2 axes\. Give `depth` for the size of "batch"/)
            expect(() => heatmap([[1, 2]], { axes: ['seq'] })).toThrow(/axes has 1 name, and the grid has 2 axes: its rows and its columns/)
            expect(() => heatmap([[1, 2]], { initial: 'gone' })).toThrow(/initial gives cell \(0, 0\) the state "gone"\. The states are open, empty, masked, future, padding/)
            expect(() => heatmap([[1, 2]], { states: { open: { mark: 'cross' } } })).toThrow(/states names the state 'open'\. Every grid has it/)
            expect(() => heatmap([[1, 2]], { states: { odd: { mark: 'star' as never } } })).toThrow(/the mark of the state "odd" is "star"\. A mark is 'none', 'cross', 'hatch' or 'dash'/)
            expect(() => heatmap([[1, 2]], { shown: { columns: 3 } })).toThrow(/shown\.columns is 3\. Give a whole number from 1 to 2/)
        }))
    })

    it('update gives every cell its new shade and prints its new number, with one number in a cell at the end', async () => {
        let grid!: Grid
        const f = await compile((s) => {
            grid = s.add(heatmap([[0, 1], [2, 3]], { size: 28, values: true }))
            s.play(grid.update([[3, 2], [1, 0]]), { duration: 1 })
        })
        expect(grid.numbers.flat().map(source)).toEqual(['3', '2', '1', '0'])
        expect(grid.values()).toEqual([[3, 2], [1, 0]])
        expect(at(f.duration, () => grid.cells.flat().map((cell) => cell.get('fill')))).toEqual([3, 2, 1, 0].map((value) => grid.colorFor(value)))
        // Each cell shows its new number, and the old one is gone.
        const seen = at(f.duration, () => grid.children.filter((child) => source(child) !== undefined && shows(child) > 0).map(source))
        expect(seen).toEqual(['3', '2', '1', '0'])
    })

    it('changes a number in place: the old one leaves, then the new one comes at the same place, and the shade follows', async () => {
        let grid!: Grid, old!: Node
        await compile((s) => {
            grid = s.add(heatmap([[0.2, 0.8]], { size: 28, values: true, domain: [0, 1] }))
            old = grid.numbers[0]![0]!
            s.wait(1)
            s.play(grid.setValue({ row: 0, col: 0 }, 0.9), { duration: 1, ease: linear })
            s.wait(0.5)
        })
        const next = grid.numbers[0]![0]!
        expect(next).not.toBe(old)
        expect([source(old), source(next)]).toEqual(['0.2', '0.9'])
        expect([next.get('x'), next.get('y')]).toEqual([old.get('x'), old.get('y')])
        // No moment shows two numbers: the old one is gone at the half, and the new one starts there.
        expect(at(1.25, () => [shows(old), shows(next)])).toEqual([half, 0])
        expect(at(1.5, () => [shows(old), shows(next)])).toEqual([0, 0])
        expect(at(1.75, () => [shows(old), shows(next)])).toEqual([0, half])
        expect(at(2, () => [shows(old), shows(next)])).toEqual([0, 1])
        expect(at(1, () => grid.cell(0, 0).get('fill'))).toEqual(grid.colorFor(0.2))
        expect(at(2, () => grid.cell(0, 0).get('fill'))).toEqual(grid.colorFor(0.9))
        expect([grid.value(0, 0), grid.value(0, 1)]).toEqual([0.9, 0.8])
    })

    it('sweeps a slice with a lag, one cell after the other, and takes its values as a list, a block, one number or a function', async () => {
        let grid!: Grid
        await compile((s) => {
            grid = s.add(heatmap([[1, 2, 3], [4, 5, 6]], { size: 28, values: true, domain: [0, 20] }))
            // With a lag of 1, each of the three cells has one second.
            s.play(grid.setValue({ row: 0 }, [7, 8, 9], { lag: 1 }), { duration: 3, ease: linear })
            expect(grid.values()).toEqual([[7, 8, 9], [4, 5, 6]])
            s.play(grid.setValue({ row: [0, 1], col: [0, 1] }, [[10, 11], [12, 13]]), grid.setValue({ col: 2 }, 0), { duration: 1 })
            expect(grid.values()).toEqual([[10, 11, 0], [12, 13, 0]])
            s.play(grid.setValue((row) => row === 1, (_row, _col, value) => value + 1), { duration: 1 })
            expect(grid.values()).toEqual([[10, 11, 0], [13, 14, 1]])
            expect(() => grid.setValue({ row: 0 }, [1, 2])).toThrow(/setValue got 2 values for 3 cells\. Give one number for each cell of the slice, row by row, or one number for all of them/)
            expect(() => grid.setValue({ row: 0 }, 'high' as never)).toThrow(/the values of setValue are "high"\. Give one number, a list of numbers, or a function/)
            expect(() => grid.setValue({ row: 0 }, [1, Number.NaN, 2])).toThrow(/setValue got the value NaN\. A value is a number/)
        })
        const first = grid.children.filter((child) => ['7', '8', '9'].includes(source(child) ?? ''))
        expect(first.map(source)).toEqual(['7', '8', '9'])
        expect(at(1, () => first.map(shows))).toEqual([1, 0, 0])
        expect(at(2, () => first.map(shows))).toEqual([1, 1, 0])
        expect(at(3, () => first.map(shows))).toEqual([1, 1, 1])
    })

    it('stops for a value outside the range of its first values, and for a number that its cell cannot hold', async () => {
        await compileFilm(film(() => {
            const grid = heatmap([[0, 1]], { size: 28, values: true })
            expect(() => grid.setValue({ row: 0, col: 0 }, 5)).toThrow(/setValue got the value 5, outside the range of the colors, 0 to 1, which comes from the first values\. Give the grid a `domain` that holds every value of the film, such as domain: \[0, 5\]/)
            expect(() => grid.update([[0.5, -2]])).toThrow(/update got the value -2 for cell \(0, 1\), outside the range of the colors, 0 to 1.*domain: \[-2, 1\]/)
            // A range that the film gave is its choice: a value outside it takes the color of the nearest end.
            const ranged = heatmap([[0, 1]], { size: 28, values: true, domain: [0, 1] })
            expect(ranged.setValue({ row: 0, col: 0 }, 5).label).toBe('heatmap.setValue')
            expect(() => ranged.setValue({ row: 0, col: 0 }, 123456)).toThrow(/setValue got the value 123456, and its text "123456" needs \d+ px in a cell of \d+\. Give a cell of \d+ or more, a smaller size, or a format with fewer digits/)
        }))
    })

    it('stops for two changes of one number at one time, and takes them in a seq', async () => {
        await expect(compile((s) => {
            const grid = s.add(heatmap([[0, 1]], { size: 28, values: true }))
            s.play(grid.setValue({ row: 0, col: 0 }, 1), grid.setValue({ row: 0, col: 0 }, 0.5), { duration: 1 })
        })).rejects.toThrow(/setValue changes the number of cell \(0, 0\) from 0 s to 1 s, and the change before it ends at 1 s\. A cell changes its number one change at a time\. Play the two in a `seq`, or give one change the last value/)
        let grid!: Grid
        const f = await compile((s) => {
            grid = s.add(heatmap([[0, 1]], { size: 28, values: true }))
            // Two cells change together, and one cell changes two times in a row.
            s.play(grid.setValue({ row: 0, col: 0 }, 1), grid.setValue({ row: 0, col: 1 }, 0), { duration: 1 })
            s.play(seq(grid.setValue({ row: 0, col: 0 }, 0.5), grid.setValue({ row: 0, col: 0 }, 0.25)), { duration: 1 })
        })
        expect(grid.values()).toEqual([[0.25, 0]])
        expect(at(f.duration, () => grid.children.filter((child) => shows(child) > 0 && source(child) !== undefined).map(source))).toEqual(['0', '0.25'])
    })

    it('covers a cell with the sign of its state, hides its number under the sign, and brings both back with open', async () => {
        let grid!: Grid, surface!: Rgba
        await compile((s) => {
            surface = parseColor('surface')
            grid = s.add(heatmap([[0.2, 0.8], [0.5, 0.1]], { size: 28, values: true }))
            expect(grid.count('open')).toBe(4)
            s.wait(1)
            s.play(grid.mark({ col: 1 }, 'future'), { duration: 1, ease: linear })
            expect([grid.stateOf(0, 1), grid.stateOf(1, 1), grid.stateOf(0, 0)]).toEqual(['future', 'future', 'open'])
            expect([grid.count('future'), grid.count('open')]).toEqual([2, 2])
            expect(grid.find((_row, _col, _value, state) => state === 'future')).toEqual([[0, 1], [1, 1]])
            s.wait(0.5)
            s.play(grid.mark({ row: 0, col: 1 }, 'open'), { duration: 1, ease: linear })
            expect([grid.stateOf(0, 1), grid.count('future')]).toEqual(['open', 1])
            s.wait(0.5)
        })
        const number = grid.numbers[1]![1]!, sign = signOf(grid, 1, 1)
        expect(sign).not.toBe(number)
        // The number leaves in the first half of the time, and the sign comes in the second, so the sign is never over a number.
        expect(at(1.25, () => [shows(number), shows(sign)])).toEqual([half, 0])
        expect(at(1.75, () => [shows(number), shows(sign)])).toEqual([0, half])
        expect(at(2, () => [shows(number), shows(sign)])).toEqual([0, 1])
        expect(at(2, () => [grid.cell(1, 1).get('fill'), grid.cell(1, 1).get('fillOpacity')])).toEqual([surface, 0.4])
        // The value stays under the sign, and the cell that opens again shows it with its shade.
        expect(grid.value(0, 1)).toBe(0.8)
        const back = grid.numbers[0]![1]!, gone = signOf(grid, 0, 1)
        expect(at(2.75, () => [shows(back), shows(gone)])).toEqual([0, half])
        expect(at(3.25, () => [shows(back), shows(gone)])).toEqual([half, 0])
        expect(at(3.5, () => [shows(back), shows(gone), grid.cell(0, 1).get('fill'), grid.cell(0, 1).get('fillOpacity')])).toEqual([1, 0, grid.colorFor(0.8), 1])
    })

    it('picks the cells of a change when it plays, has a sign for each state, and takes the states of the film', async () => {
        await compile((s) => {
            const grid = s.add(heatmap([[1, 2, 3], [4, 5, 6], [7, 8, 9]], { size: 28, values: true }))
            // The second change finds the cells that the first one covered.
            s.play(seq(grid.mark((row, col) => col > row, 'future'), grid.mark((_row, _col, _value, state) => state === 'future', 'padding')))
            expect([grid.count('future'), grid.count('padding'), grid.count('open')]).toEqual([0, 3, 6])
            expect(() => grid.mark({ row: 0 }, 'gone')).toThrow(/no state "gone"\. The states are open, empty, masked, future, padding/)
            // A cell that has the state already does not change and takes no time: the two other cells of the row share the two seconds.
            const started = s.time
            s.play(grid.mark({ row: 1 }, 'padding', { lag: 1 }), { duration: 2, ease: linear })
            const last = grid.labelsOf(grid.cell(1, 1)).at(-1)!
            expect(at(started + 1.75, () => last.get('opacity'))).toBeCloseTo(0.5, 6)
            expect(() => grid.count('gone')).toThrow(/no state "gone"/)
            expect(Object.keys(CELL_STATES)).toEqual(['empty', 'masked', 'future', 'padding'])
            // The four signs differ in shape: an outline, a cross, lines, and dashes.
            const signs = heatmap([[1, 2, 3, 4]], { size: 28, initial: (_row, col) => Object.keys(CELL_STATES)[col]! })
            const rings = [0, 1, 2, 3].map((col) => signOf(signs, 0, col).get('path')!.length)
            expect(rings[0]).toBe(1)
            expect(rings[1]).toBe(3)
            expect(rings[2]).toBeGreaterThan(3)
            expect(rings[3]).toBeGreaterThan(8)
            expect(new Set(rings).size).toBe(4)
            const own = heatmap([[1, 2]], { values: true, states: { ignored: { mark: 'cross', color: 'red' } }, initial: (_row, col) => (col === 0 ? 'ignored' : 'open') })
            expect([own.stateOf(0, 0), own.count('ignored')]).toEqual(['ignored', 1])
            expect(signOf(own, 0, 0).get('stroke')).toEqual(parseColor('red'))
            expect(() => own.mark({ col: 1 }, 'future')).toThrow(/no state "future"\. The states are open, ignored/)
        })
    })

    it('fills an empty cell: one change writes its value and opens it', async () => {
        let map!: Grid
        await compile((s) => {
            map = s.add(heatmap([[0, 0], [0, 0]], { size: 28, values: true, initial: 'empty', domain: [0, 9] }))
            expect([map.count('empty'), map.count('open')]).toEqual([4, 0])
            s.wait(1)
            s.play(map.setValue({ row: 0, col: 1 }, 7, { state: 'open' }), { duration: 1, ease: linear })
            expect([map.stateOf(0, 1), map.value(0, 1), map.count('empty')]).toEqual(['open', 7, 3])
            expect(() => map.setValue({ row: 0, col: 0 }, 1, { state: 'gone' })).toThrow(/no state "gone"/)
        })
        const number = map.numbers[0]![1]!, sign = signOf(map, 0, 1)
        expect(source(number)).toBe('7')
        // The outline of the empty cell leaves first, and then the number comes.
        expect([1, 1.25, 1.5, 1.75, 2].map((time) => at(time, () => [shows(sign), shows(number)]))).toEqual([[1, 0], [half, 0], [0, 0], [0, half], [0, 1]])
        expect(at(2, () => [map.cell(0, 1).get('fill'), map.cell(0, 1).get('fillOpacity')])).toEqual([map.colorFor(7), 1])
        expect(at(2, () => shows(map.numbers[0]![0]!))).toBe(0)
    })

    it('enters with the sign of each covered cell, and keeps a covered number and an unlit number hidden', async () => {
        let grid!: Grid, lit!: Grid
        await compile((s) => {
            grid = heatmap([[1, 2], [3, 4]], { size: 28, values: true, axes: ['seq', 'd'], initial: (row, col) => (row === 0 && col === 1 ? 'future' : 'open') })
            lit = heatmap([[1, 2]], { size: 28, values: 'lit' }).at(0, 300)
            s.play(grid.enter(), lit.enter(), { duration: 1, ease: linear })
        })
        expect(at(0.01, () => [grid.cell(0, 0), grid.numbers[0]![0]!, signOf(grid, 0, 1), grid.caption!, grid.axis('seq')].map(shows))).toEqual([expect.closeTo(0.02, 6), expect.closeTo(0.02, 6), 0, expect.closeTo(0.025, 6), expect.closeTo(0.025, 6)])
        expect(at(1, () => [grid.cell(0, 1), signOf(grid, 0, 1), grid.numbers[0]![1]!, grid.numbers[1]![1]!, grid.caption!, grid.axis('seq')].map(shows))).toEqual([1, 1, 0, 1, 1, 1])
        expect(at(1, () => [...lit.cells[0]!, ...lit.numbers[0]!].map(shows))).toEqual([1, 1, 0, 0])
    })

    it('ties the number and the sign of a cell to the cell, so a light on the cell keeps them bright', async () => {
        let grid!: Grid
        const f = await compile((s) => {
            grid = s.add(heatmap([[1, 2]], { size: 28, values: true, domain: [0, 9] }))
            s.play(grid.setValue({ row: 0, col: 0 }, 5), { duration: 0.5 })
            s.play(spotlight(grid.cell(0, 0)), { duration: 0.5 })
        })
        expect(grid.labelsOf(grid.cell(0, 0)).map(source)).toEqual(['1', '5'])
        expect(grid.labelsOf(grid.numbers[0]![0]!)).toEqual([])
        expect(at(f.duration, () => [grid.numbers[0]![0]!.get('dim'), grid.cell(0, 0).get('dim')])).toEqual([1, 1])
        expect(at(f.duration, () => grid.numbers[0]![1]!.get('dim'))).toBeLessThan(1)
    })

    it('prints a number dark on a light cell and light on a dark one, with a contrast of 4 or more', async () => {
        await compileFilm(film(() => {
            const light = (color: Rgba) => { const channel = (value: number) => { const x = value / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]) }
            const grid = heatmap([Array.from({ length: 41 }, (_, index) => index)], { size: 28, values: true, cell: 60 })
            const ratios = grid.numbers[0]!.map((number, col) => {
                const ink = light(number.children[0]!.get('fill') as Rgba), cell = light(grid.cell(0, col).get('fill') as Rgba)
                return (Math.max(ink, cell) + 0.05) / (Math.min(ink, cell) + 0.05)
            })
            expect(Math.min(...ratios)).toBeGreaterThan(4)
        }))
    })

    it('puts one outline around a slice, slides it to the next slice, and makes the names of the slice bright', async () => {
        let grid!: Grid, ink!: Rgba, dim!: Rgba
        const lit: unknown[] = []
        await compile((s) => {
            ink = parseColor('ink')
            dim = parseColor('dim')
            grid = s.add(heatmap([[1, 2, 3], [4, 5, 6], [7, 8, 9]], { size: 28, cell: 100, gap: 4, rowLabels: ['a', 'b', 'c'], columnLabels: ['x', 'y', 'z'] }))
            lit.push(grid.lit)
            s.wait(1)
            s.play(grid.light({ row: 0 }), { duration: 1, ease: linear })
            lit.push(grid.lit)
            s.play(grid.light({ row: 2, col: [1, 2] }), { duration: 1, ease: linear })
            lit.push(grid.lit)
            s.play(grid.light(null), { duration: 1, ease: linear })
            lit.push(grid.lit)
        })
        expect(lit).toEqual([null, { row: [0, 0], col: [0, 2] }, { row: [2, 2], col: [1, 2] }, null])
        const frame = grid.frame!
        const box = (time: number) => at(time, () => pathBounds(frame.get('path')!)!)
        // The outline is in the room around its cells: two pixels of the gap, and half of its line.
        expect([box(2).x, box(2).y, box(2).width, box(2).height]).toEqual([-158, -158, 316, 108])
        expect(at(1.5, () => frame.get('opacity'))).toBeCloseTo(0.5, 6)
        // It slides: at the half of the move, it is half way.
        expect([box(2.5).x, box(2.5).y, box(2.5).width]).toEqual([-106, -54, 264])
        expect([box(3).x, box(3).y, box(3).width, box(3).height]).toEqual([-54, 50, 212, 108])
        expect(at(4, () => frame.get('opacity'))).toBe(0)
        // A slice that takes every column names no column.
        expect(at(2, () => [...grid.rowLabels, ...grid.columnLabels].map(inkOf))).toEqual([ink, dim, dim, dim, dim, dim])
        expect(at(3, () => [...grid.rowLabels, ...grid.columnLabels].map(inkOf))).toEqual([dim, dim, ink, dim, ink, ink])
        expect(at(4, () => [...grid.rowLabels, ...grid.columnLabels].map(inkOf))).toEqual([dim, dim, dim, dim, dim, dim])
    })

    it('does not slide the outline over numbers: in a grid that prints them, it leaves one slice and comes in at the next', async () => {
        let grid!: Grid
        await compile((s) => {
            grid = s.add(heatmap([[1, 2], [3, 4], [5, 6]], { size: 28, cell: 100, gap: 4, values: true }))
            s.play(grid.light({ row: 0 }), { duration: 1, ease: linear })
            s.play(grid.light({ row: 2 }), { duration: 1, ease: linear })
        })
        const frame = grid.frame!
        const top = (time: number) => at(time, () => pathBounds(frame.get('path')!)!.y)
        expect([top(1), top(1.25), top(1.75), top(2)]).toEqual([-158, -158, 50, 50])
        expect([1, 1.25, 1.5, 1.75, 2].map((time) => at(time, () => frame.get('opacity')))).toEqual([1, half, 0, half, 1])
    })

    it("with values: 'lit', prints the numbers of the lit slice only, and none under the outline while it moves", async () => {
        let grid!: Grid
        await compile((s) => {
            grid = s.add(heatmap([[1, 2, 3, 4]], { size: 28, values: 'lit' }))
            s.wait(1)
            s.play(grid.light({ col: [0, 1] }), { duration: 1, ease: linear })
            s.play(grid.light({ col: [2, 3] }), { duration: 1, ease: linear })
        })
        const seen = (time: number) => at(time, () => grid.numbers[0]!.map(shows))
        expect(seen(0.5)).toEqual([0, 0, 0, 0])
        expect(seen(2)).toEqual([1, 1, 0, 0])
        // The numbers that leave are gone before the half of the move, and the ones that come start after it.
        expect(seen(2.2)).toEqual([half, half, 0, 0])
        expect(seen(2.5)).toEqual([0, 0, 0, 0])
        expect(seen(2.8)).toEqual([0, 0, half, half])
        expect(seen(3)).toEqual([0, 0, 1, 1])
    })

    it('draws a brace with the name and the size of each axis, sheets for the third axis, and the shape', async () => {
        await compileFilm(film(() => {
            const x = heatmap([[1, 2, 3], [4, 5, 6]], { values: true, axes: ['batch', 'seq', 'd'], depth: 3, name: 'x' })
            expect(x.shape).toEqual([3, 2, 3])
            expect(source(x.caption)).toBe('x [3, 2, 3]')
            expect(['batch', 'seq', 'd'].map((name) => source(x.axis(name).children[1]))).toEqual(['batch = 3', 'seq = 2', 'd = 3'])
            // The brace of the rows is at the right of the cells and of the sheets, and the brace of the columns is under them.
            const cells = x.region()
            expect(x.slabs).toHaveLength(2)
            const sheets = Math.max(...x.slabs.map((slab) => slab.bounds().x + slab.bounds().width))
            expect(sheets).toBeGreaterThan(cells.right)
            expect(x.axis('seq').children[0]!.bounds().x).toBeGreaterThan(sheets)
            expect(x.axis('d').children[0]!.bounds().y).toBeGreaterThan(Math.max(...x.slabs.map((slab) => slab.bounds().y + slab.bounds().height)))
            expect(x.caption!.bounds().y).toBeGreaterThan(x.axis('d').bounds().y + x.axis('d').bounds().height)
            // A deep tensor draws four sheets at the most, and its label gives the true size.
            const deep = heatmap([[1, 2]], { axes: ['batch', 'seq', 'd'], depth: 32 })
            expect(deep.slabs).toHaveLength(3)
            expect([source(deep.axis('batch').children[1]), source(deep.caption), deep.shape]).toEqual(['batch = 32', '[32, 1, 2]', [32, 1, 2]])
            // A name alone gives the shape and no brace.
            const named = heatmap([[1, 2]], { name: 'W' })
            expect(source(named.caption)).toBe('W [1, 2]')
            expect(() => named.axis('seq')).toThrow(/no axis "seq"\. The grid has no `axes`/)
            expect(() => x.axis('time')).toThrow(/no axis "time"\. The axes are "batch", "seq", "d"/)
        }))
    })

    it('keeps the room of every row and column from the start, and grow() shows the next ones with their names and the new shape', async () => {
        let grid!: Grid, room!: ReturnType<typeof boxOf>
        const shapes: number[][] = []
        const f = await compile((s) => {
            grid = s.add(heatmap([[1, 0, 0], [0.4, 0.6, 0], [0.2, 0.3, 0.5]], {
                size: 28, values: true, rowLabels: ['a', 'b', 'c'], columnLabels: ['a', 'b', 'c'], axes: ['queries', 'keys'], shown: { rows: 2, columns: 2 },
            }))
            // The layout measures the grid here, before it grows.
            room = boxOf(grid)
            shapes.push(grid.shape)
            expect([grid.shownRows, grid.shownCols, grid.count('open')]).toEqual([2, 2, 4])
            // A change is for the cells that wait too: the column of a padding token is padding in the row that comes later.
            s.play(grid.mark({ col: 0 }, 'padding'), grid.setValue({ row: 2, col: 1 }, 0.9), { duration: 0.5 })
            expect([grid.stateOf(2, 0), grid.value(2, 1), grid.count('padding')]).toEqual(['padding', 0.9, 2])
            s.wait(0.5)
            s.play(grid.grow({ rows: 1, columns: 1 }), { duration: 1 })
            shapes.push(grid.shape)
            expect([grid.shownRows, grid.shownCols, grid.count('open'), grid.count('padding')]).toEqual([3, 3, 6, 3])
            expect(() => grid.grow({})).toThrow(/grow adds no row and no column\. Give a count, such as \{ columns: 1 \}/)
            expect(() => grid.grow({ rows: 0.5 })).toThrow(/grow adds 0\.5 rows\. Give a whole number, 0 or more/)
        })
        expect(shapes).toEqual([[2, 2], [3, 3]])
        // The cells that wait do not show, with what a change gave them, and the layout measures the grid with them and with its last braces.
        expect(at(0.75, () => [grid.cell(2, 2), grid.numbers[2]![2]!, grid.rowLabels[2]!, grid.columnLabels[2]!, grid.numbers[2]![1]!, signOf(grid, 2, 0)].map(shows))).toEqual([0, 0, 0, 0, 0, 0])
        expect(at(f.duration, () => [source(grid.numbers[2]![1]), shows(grid.numbers[2]![1]!), shows(signOf(grid, 2, 0)), shows(grid.numbers[2]![0]!)])).toEqual(['0.9', 1, 1, 0])
        const after = at(f.duration, () => grid.bounds())
        expect([room.left, room.top, room.right, room.bottom].map(Math.round)).toEqual([after.x, after.y, after.x + after.width, after.y + after.height].map(Math.round))
        expect(at(0.5, () => grid.bounds().width)).toBeLessThan(room.width - 60)
        expect(at(f.duration, () => [grid.cell(2, 2), grid.numbers[2]![2]!, grid.rowLabels[2]!, grid.columnLabels[2]!].map(shows))).toEqual([1, 1, 1, 1])
        expect([source(grid.axis('queries').children.at(-1)), source(grid.axis('keys').children.at(-1)), source(grid.caption)]).toEqual(['queries = 3', 'keys = 3', '[3, 3]'])
        // One label of each brace shows at the end, and the brace of the rows is at the right of the new column.
        expect(at(f.duration, () => grid.axis('queries').children.slice(1).map(shows))).toEqual([0, 1])
        expect(at(f.duration, () => grid.axis('queries').children[0]!.bounds().x)).toBeGreaterThan(grid.p(0, 2, 'right')[0])
        expect(at(0.5, () => grid.axis('queries').children[0]!.bounds().x)).toBeLessThan(grid.p(0, 2)[0])
        await expect(compile((s) => {
            const full = s.add(heatmap([[1, 2]], { size: 28, shown: { columns: 1 } }))
            s.play(seq(full.grow({ columns: 1 }), full.grow({ columns: 1 })))
        })).rejects.toThrow(/grow would show 1 rows and 3 columns, and the grid has 1 by 2\. Make the grid with every row and column that it will have, and give `shown`/)
        await expect(compile((s) => {
            const full = s.add(heatmap([[1, 2]], { size: 28, shown: { columns: 1 } }))
            s.play(full.light({ col: 1 }))
        })).rejects.toThrow(/light names a cell that does not show yet: the grid shows 1 rows and 1 columns of its 1 by 2\. Play grow\(\) first/)
    })

    it('cuts into patches that move apart, unrolls each patch into one row of cells, and joins again', async () => {
        let grid!: Grid
        const first: [number, number][] = []
        const f = await compile((s) => {
            grid = s.add(heatmap(Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => i * 4 + j)), { size: 26, cell: 60, gap: 4, values: true, name: 'image' }))
            for (const [i, j] of [[0, 0], [0, 1], [0, 2], [3, 3]] as const) first.push(grid.p(i, j))
            expect(grid.patchShape).toBeNull()
            s.wait(1)
            s.play(grid.cut(2, 2, { gap: 20 }), { duration: 1 })
            expect(grid.patchShape).toEqual([2, 2])
            // Two cells of one patch keep their distance, and two patches are apart by the gap more.
            expect(grid.p(0, 1)[0] - grid.p(0, 0)[0]).toBe(64)
            expect(grid.p(0, 2)[0] - grid.p(0, 1)[0]).toBe(84)
            expect(grid.p(2, 0)[1] - grid.p(1, 0)[1]).toBe(84)
            // The grid stays around its middle.
            expect(grid.p(0, 0)[0]).toBe(-grid.p(0, 3)[0])
            const patch = grid.region({ patch: 1 })
            expect([patch.width, patch.height]).toEqual([124, 124])
            s.wait(0.5)
            s.play(grid.cut(2, 2, { gap: 20, unroll: true }), { duration: 1 })
            // Patch 1 is the second row now: its four cells, row by row, from the left.
            const row = [[0, 2], [0, 3], [1, 2], [1, 3]].map(([i, j]) => grid.p(i!, j!))
            expect(row.map((place) => place[1])).toEqual([row[0]![1], row[0]![1], row[0]![1], row[0]![1]])
            expect(row.map((place) => place[0] - row[0]![0])).toEqual([0, 64, 128, 192])
            expect(grid.p(0, 2)[1] - grid.p(0, 0)[1]).toBe(80)
            expect([grid.region({ patch: 1 }).width, grid.region({ patch: 1 }).height]).toEqual([252, 60])
            s.wait(0.5)
            s.play(grid.join(), { duration: 1 })
            expect(grid.patchShape).toBeNull()
            expect([[0, 0], [0, 1], [0, 2], [3, 3]].map(([i, j]) => grid.p(i!, j!))).toEqual(first)
            expect(() => grid.cut(3, 2)).toThrow(/the grid has 4 rows, which do not cut into patches of 3\. Give a count that divides 4/)
            expect(() => grid.cut(2, 0)).toThrow(/a patch of cut has 0 columns\. Give a whole number, 1 or more/)
        })
        // A cell, its number and the shape: the cell and its number are at the place of p() at the end of each move, and the shape leaves and comes back.
        const cell = grid.cell(0, 2), number = grid.numbers[0]![2]!
        expect(at(1, () => [cell.get('x'), cell.get('y')])).toEqual(first[2])
        expect(at(2, () => [cell.get('x'), number.get('x')])).toEqual([first[2]![0] + 10, first[2]![0] + 10])
        expect(at(f.duration, () => [cell.get('x'), cell.get('y'), number.get('x'), number.get('y')])).toEqual([...first[2]!, ...first[2]!])
        expect([1, 2, 3.5, f.duration].map((time) => at(time, () => grid.caption!.get('opacity')))).toEqual([1, 0, 0, 1])
        await expect(compile((s) => {
            const whole = s.add(heatmap([[1, 2], [3, 4]], { size: 28 }))
            s.play(whole.light({ patch: 0 }))
        })).rejects.toThrow(/light names patch 0, and the grid is whole\. Play cut\(\) first/)
        await expect(compile((s) => {
            const cut = s.add(heatmap([[1, 2], [3, 4]], { size: 28 }))
            s.play(seq(cut.cut(1, 2, { unroll: true }), cut.light({ row: 0 })))
        })).rejects.toThrow(/light names rows and columns, and the grid is unrolled: each of its rows is a patch now\. Name a patch, such as \{ patch: 0 \}, or play join\(\) first/)
        await expect(compile((s) => {
            const cut = s.add(heatmap([[1, 2], [3, 4]], { size: 28 }))
            s.play(seq(cut.cut(1, 2), cut.light({ patch: 2 })))
        })).rejects.toThrow(/no patch 2\. The grid has 2 patches, 0 to 1/)
    })

    it('lists the places of a window, row by row, so their count is the size of the output', async () => {
        await compileFilm(film(() => {
            const grid = heatmap(Array.from({ length: 5 }, (_, i) => Array.from({ length: 6 }, (_, j) => i + j)), { size: 28 })
            const places = grid.windows(3)
            expect([places.length, places[0]!.length]).toEqual([3, 4])
            expect(places[1]![2]).toEqual({ row: [1, 3], col: [2, 4] })
            expect(grid.values(places[1]![2])).toEqual([[3, 4, 5], [4, 5, 6], [5, 6, 7]])
            // A stride of 2 gives a pooling: the windows do not share a cell.
            const pooled = grid.windows(2, { stride: 2 })
            expect([pooled.length, pooled[0]!.length, pooled[1]![2]]).toEqual([2, 3, { row: [2, 3], col: [4, 5] }])
            expect(grid.windows([1, 6]).map((line) => line.length)).toEqual([1, 1, 1, 1, 1])
            expect(() => grid.windows(6)).toThrow(/a window of 6 by 6 is larger than the grid, which shows 5 by 6\. Give a smaller window/)
            expect(() => grid.windows(0)).toThrow(/the size of windows is 0\. Give a whole number, 1 or more/)
            expect(() => grid.windows(2, { stride: 0 })).toThrow(/the stride of windows is 0/)
        }))
    })

    it('makes a copy with its own cells and its own record', async () => {
        await compile((s) => {
            const grid = s.add(heatmap([[0.2, 0.8]], { size: 28, values: true, domain: [0, 1] }))
            const copy = s.add(grid.clone().at(0, 200))
            expect(copy.cell(0, 0)).not.toBe(grid.cell(0, 0))
            expect(copy.numbers[0]![0]).not.toBe(grid.numbers[0]![0])
            expect(copy.children).toContain(copy.numbers[0]![0])
            s.play(copy.setValue({ row: 0, col: 0 }, 1), copy.mark({ col: 1 }, 'masked'), { duration: 1 })
            expect([grid.value(0, 0), grid.stateOf(0, 1), source(grid.numbers[0]![0])]).toEqual([0.2, 'open', '0.2'])
            expect([copy.value(0, 0), copy.stateOf(0, 1), source(copy.numbers[0]![0])]).toEqual([1, 'masked', '1'])
        })
    })

    it('takes its width from the layout, so that all of it, with its names, is as wide as a region', async () => {
        await compileFilm(film(() => {
            const rows = [[0.91, 0.12, 0.33], [0.05, 0.84, 0.47]]
            const made = fitted(700, (width) => heatmap(rows, { width, values: true, rowLabels: ['statistics alone', 'chart image'], columnLabels: ['recall', 'precision', 'F1'] }))
            expect(boxOf(made).width).toBeCloseTo(700, 0)
            // The cells have what the names leave.
            expect(made.region().width).toBeLessThan(600)
            expect(made.cell(0, 0).bounds().width).toBeCloseTo((made.region().width - 6) / 3, 6)
        }))
    })

    it('places its names, its braces and its shape so that the film check reports nothing, at a room of 0.3 and of 0.7', async () => {
        for (const textGap of [0.3, 0.7]) {
            const report = await checkFilm(film({ fps: 10 }, (s) => {
                const grid = s.add(heatmap([[0.2, -0.4, 0.9, 0.1], [0.5, 0.3, -0.7, 0.6], [-0.1, 0.8, 0.4, -0.5]], {
                    values: true, rowLabels: ['Birds', 'migrate', 'south'], columnLabels: ['f0', 'f1', 'f2', 'f3'], axes: ['batch', 'seq', 'd'], depth: 2, name: 'x', domain: [-1, 1],
                    initial: (row, col) => (row === 2 && col > 1 ? 'future' : 'open'),
                }))
                s.wait(1.2)
                s.play(grid.light({ row: 1 }), grid.mark({ row: 0, col: 3 }, 'padding'), { duration: 0.5 })
                s.wait(1.2)
            }), { textGap, motion: true })
            expect(report.diagnostics).toEqual([])
        }
    })
})

describe('attention matrix', () => {
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)
    const source = (node: Node | null | undefined) => (node as (Node & { source?: string }) | null | undefined)?.source
    const sizeOf = (node: Node) => (node as Node & { size?: number }).size
    const words = ['The', 'garden', 'is', 'quiet']
    const weights = [[1, 0, 0, 0], [0.4, 0.6, 0, 0], [0.2, 0.3, 0.5, 0], [0.1, 0.2, 0.3, 0.4]]

    it('draws as it did before it had a size: cells of 42, labels of 18, and the colors up to the largest weight', async () => {
        await compileFilm(film(() => {
            const plain = attentionMatrix(words, words, weights.map((row) => row.map((weight) => weight / 2)))
            expect(plain.cell(0, 0).bounds().width).toBe(42)
            expect(sizeOf(plain.rowLabels[0]!)).toBe(18)
            expect(plain.colorFor(0.5)).toEqual(plain.colorFor(1))
            expect(plain.colorFor(0.25)).not.toEqual(plain.colorFor(0.5))
            expect(plain.count('future')).toBe(0)
        }))
    })

    it('starts with the mask of a decoder: a row reads its own column and the columns before it', async () => {
        await compileFilm(film(() => {
            const masked = attentionMatrix(words, words, weights, { size: 30, values: true, mask: 'causal' })
            expect(masked.find((_row, _col, _value, state) => state === 'future')).toEqual([[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]])
            expect([masked.count('future'), masked.count('open')]).toEqual([6, 10])
            expect(masked.numbers.flat().map(sizeOf)).toEqual(Array.from({ length: 16 }, () => 30))
            // A weight is a share: the colors go from 0 to 1, whatever the largest weight is.
            const low = attentionMatrix(['a', 'b'], ['a', 'b'], [[0.2, 0.1], [0.1, 0.2]], { size: 30 })
            expect(low.colorFor(0.2)).not.toEqual(low.colorFor(1))
            const scores = [[2, 0], [0.5, 1]]
            const weightsScale = attentionMatrix(['a', 'b'], ['a', 'b'], scores, { size: 30 })
            expect(weightsScale.colorFor(2)).toEqual(weightsScale.colorFor(1))
            const scoresScale = attentionMatrix(['a', 'b'], ['a', 'b'], scores, { size: 30, domain: [0, 2] })
            expect(scoresScale.colorFor(2)).not.toEqual(scoresScale.colorFor(1))
            expect(() => attentionMatrix(words, words, weights, { mask: 'causal', initial: 'empty' })).toThrow(/mask and initial both set the first states\. Give one of them/)
            expect(() => attentionMatrix(words, words, weights, { mask: 'full' as never })).toThrow(/mask is 'causal', not "full"\. For another mask, give `initial`/)
        }))
    })

    it('sweeps a row from scores to weights from the left, keeps the masked cells covered, and grows by one token', async () => {
        let grid!: ReturnType<typeof attentionMatrix>
        const scores = [[2, 0, 0, 0], [0.4, 1.8, 0, 0], [0.3, 1.2, 0.9, 0], [0.2, 1.4, 0.1, 1.1]]
        const f = await compile((s) => {
            grid = s.add(attentionMatrix(words, words, scores, { size: 30, values: true, mask: 'causal', domain: [0, 2], shown: { rows: 3, columns: 3 }, axes: ['queries', 'keys'] }))
            expect(grid.shape).toEqual([3, 3])
            // With a lag of 1, each of the four cells of the row has a quarter of the time.
            s.play(grid.setValue({ row: 2 }, [0.2, 0.5, 0.3, 0], { lag: 1 }), { duration: 4, ease: linear })
            expect(grid.values({ row: 2 })).toEqual([[0.2, 0.5, 0.3]])
            s.play(grid.grow({ rows: 1, columns: 1 }), { duration: 1 })
            expect([grid.shape, grid.count('future')]).toEqual([[4, 4], 6])
        })
        const row = [0, 1, 2].map((col) => grid.numbers[2]![col]!)
        expect(row.map(source)).toEqual(['0.2', '0.5', '0.3'])
        expect([1, 2, 3].map((time) => at(time, () => row.map(shows)))).toEqual([[1, 0, 0], [1, 1, 0], [1, 1, 1]])
        // The new token is under the mask in the rows before it, and it reads every column.
        expect(at(f.duration, () => [grid.stateOf(2, 3), grid.stateOf(3, 3), shows(grid.numbers[3]![3]!), shows(grid.numbers[2]![3]!)])).toEqual(['future', 'open', 1, 0])
        expect(at(f.duration, () => [shows(grid.rowLabels[3]!), shows(grid.columnLabels[3]!)])).toEqual([1, 1])
    })
})

describe('matrix product', () => {
    type Product = ReturnType<typeof matrixProduct>
    const shows = (node: Node) => { for (let up: Node | null = node; up; up = up.parent) if (!up.get('visible') || up.get('opacity') <= 0) return 0; return node.get('opacity') }
    const source = (node: Node | null | undefined) => (node as (Node & { source?: string }) | null | undefined)?.source
    const A = [[1, 2, 3], [4, 5, 6]], B = [[7, 8], [9, 10], [11, 12]]
    /** The texts of the line of the sum that show, from the left. */
    const lineAt = (product: Product, time: number) => at(time, () => product.line!.children.filter((part) => source(part) !== undefined && shows(part) > 0).sort((a, b) => a.get('x') - b.get('x')).map(source).join(' '))

    it('draws the two operands and the result to one scale, with their names and their shapes', async () => {
        await compileFilm(film(() => {
            const product = matrixProduct(A, B)
            expect(product.shape).toEqual([[2, 3], [3, 2], [2, 2]])
            const cells = [product.a, product.b, product.c].map((grid) => grid.cell(0, 0).bounds().width)
            expect(cells).toEqual([cells[0], cells[0], cells[0]])
            // The widest number of the three grids, 154 of the result, sets the cell.
            expect(cells[0]).toBe(Math.max(78, Math.ceil(product.c.numbers[1]![1]!.bounds().width + 27)))
            expect(product.captions.map((caption) => caption.children.map(source).join(''))).toEqual(['A[2,3]', 'B[3,2]', 'C[2,2]'])
            // The two inner sizes are in one color, and no other size has it.
            const yellow = parseColor('yellow')
            const tinted = product.captions.map((caption) => caption.children.map((part) => (part.children[0]!.get('fill') as Rgba).join() === yellow.join()))
            expect(tinted).toEqual([[false, false, false, false, true, false], [false, false, true, false, false, false], [false, false, false, false, false, false]])
            // The grids follow each other from the left, and the shapes are over them, on one line.
            const boxes = [product.a, product.b, product.c].map((grid) => grid.bounds())
            expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(boxes[1]!.x)
            expect(boxes[1]!.x + boxes[1]!.width).toBeLessThan(boxes[2]!.x)
            const tops = product.captions.map((caption) => caption.children[1]!.get('y'))
            expect(tops).toEqual([tops[0], tops[0], tops[0]])
            expect(tops[0]).toBeLessThan(Math.min(...boxes.map((box) => box.y)))
            expect([product.result(0, 0), product.result(1, 1), product.filled, product.lit, product.terms, product.sum]).toEqual([58, 154, 0, null, 0, 0])
            expect(matrixProduct(A, B, { filled: true }).filled).toBe(4)
            expect(matrixProduct([[0.5, -1.5, 2]], [[2], [0.25], [-1]], { names: ['q', 'k', 'score'] }).shape).toEqual([[1, 3], [3, 1], [1, 1]])
        }))
    })

    it('stops for operands that have no product, and says which sizes must be equal', async () => {
        await compileFilm(film(() => {
            expect(() => matrixProduct(A, A)).toThrow(/the first operand is 2 by 3 and the second is 2 by 3\. The columns of the first \(3\) must be as many as the rows of the second \(2\)\. The transpose of the second operand fits/)
            expect(() => matrixProduct(A, [[1, 2]])).toThrow(/The columns of the first \(3\) must be as many as the rows of the second \(1\)\. Give operands whose inner sizes are equal/)
            expect(() => matrixProduct([1, 2, 3] as never, B)).toThrow(/the first operand is not a matrix\. Give a list of rows.*A vector is one row, \[\[1, 2, 3\]\], or one column/)
            expect(() => matrixProduct(A, [[7, 8], [9], [11, 12]])).toThrow(/the second operand is not a matrix/)
            expect(() => matrixProduct(Array(1), [[3]])).toThrow(/the first operand is not a matrix/)
            expect(() => matrixProduct([Array(2)], [[3], [4]])).toThrow(/the value \(0, 0\) of the first operand is undefined/)
            expect(() => matrixProduct([[1, Number.NaN, 3]], B)).toThrow(/the value \(0, 1\) of the first operand is NaN\. A value is a number/)
            expect(() => matrixProduct(A, B, { names: ['A', 'B'] as never })).toThrow(/names is \[A, B\]\. Give three names/)
            const product = matrixProduct(A, B)
            expect(() => product.pair(2, 0)).toThrow(/pair names the cell \(2, 0\) of the result, which is 2 by 2\. Give a row from 0 to 1 and a column from 0 to 1/)
            expect(() => product.addTerm(0)).toThrow(/addTerm takes the number of terms to add, a whole number, 1 or more, and it got 0/)
        }))
    })

    it('pairs a row with a column, takes the terms into a running sum one by one, and stores the sum in its cell', async () => {
        let product!: Product
        const seen: unknown[] = []
        const state = () => [product.lit, product.terms, product.sum, product.filled, product.c.stateOf(0, 1)]
        await compile((s) => {
            product = s.add(matrixProduct(A, B))
            s.wait(1)
            s.play(product.pair(0, 1), { duration: 1, ease: linear })
            seen.push(state())
            expect([product.a.lit, product.b.lit, product.c.lit]).toEqual([{ row: [0, 0], col: [0, 2] }, { row: [0, 2], col: [1, 1] }, { row: [0, 0], col: [1, 1] }])
            s.play(product.addTerm(), { duration: 1, ease: linear })
            seen.push(state())
            s.play(product.addTerm(2), { duration: 2, ease: linear })
            seen.push(state())
            s.play(product.store(), { duration: 1, ease: linear })
            seen.push(state())
            s.wait(0.5)
        })
        expect(seen).toEqual([[[0, 1], 0, 0, 0, 'empty'], [[0, 1], 1, 8, 0, 'empty'], [[0, 1], 3, 64, 0, 'empty'], [[0, 1], 3, 64, 1, 'open']])
        // The line has every term of the pair from the start, and no sum. Each term then brings the sum so far.
        expect(lineAt(product, 2)).toBe('1 × 8 + 2 × 10 + 3 × 12')
        expect(lineAt(product, 3)).toBe('1 × 8 = 8')
        expect(lineAt(product, 4)).toBe('1 × 8 + 2 × 10 = 28')
        expect(lineAt(product, 5)).toBe('1 × 8 + 2 × 10 + 3 × 12 = 64')
        // A term in the sum has the colors of its two operands, and its two cells have a tint.
        const [first, , second] = product.line!.children
        const blue = at(1, () => parseColor('blue')), orange = at(1, () => parseColor('orange'))
        expect(at(3, () => [first!.children[0]!.get('fill'), second!.children[0]!.get('fill')])).toEqual([blue, orange])
        expect(at(2, () => first!.children[0]!.get('fill'))).not.toEqual(blue)
        expect(at(3, () => product.a.cell(0, 0).get('fill'))).not.toEqual(at(2, () => product.a.cell(0, 0).get('fill')))
        expect(at(3, () => product.a.cell(0, 1).get('fill'))).toEqual(at(2, () => product.a.cell(0, 1).get('fill')))
        // The sum lands on the place of the number of its cell, and the cell takes over there: one number arrives.
        const total = product.line!.children.find((part) => source(part) === '64')!, number = product.c.numbers[0]![1]!
        expect(at(5.79, () => shows(number))).toBe(0)
        expect(at(5.79, () => shows(total))).toBe(1)
        const landed = at(5.8, () => { const box = total.bounds(), own = number.bounds(); return [box.x - own.x, box.y - own.y, box.width - own.width] })
        expect(landed.map((delta) => Math.abs(delta) < 1e-6)).toEqual([true, true, true])
        expect(at(5.81, () => [shows(total), shows(number)])).toEqual([0, 1])
        expect(lineAt(product, 6)).toBe('1 × 8 + 2 × 10 + 3 × 12')
    })

    it('keeps later grids hidden until their entrance starts', async () => {
        let product!: Product
        await compile((s) => {
            product = matrixProduct(A, B)
            s.play(product.enter(), { duration: 4, ease: linear })
        })
        expect(at(0.5, () => [shows(product.b.cell(0, 0)), shows(product.c.cell(0, 0))])).toEqual([0, 0])
        expect(at(1.5, () => shows(product.b.cell(0, 0)))).toBeGreaterThan(0)
        expect(at(1.5, () => shows(product.c.cell(0, 0)))).toBe(0)
    })

    it.each([
        { layout: 'wide grids', a: A, b: B },
        { layout: 'a wide subtotal', a: [[1, 1, 1]], b: [[1000], [1000], [-1999]] },
    ])('keeps the fitted width through every subtotal with $layout', async ({ a, b }) => {
        await compile((s) => {
            const natural = matrixProduct(a, b, { size: 34 }), minimum = boxOf(natural).width
            const target = Math.ceil(minimum) + 180
            const product = fitted(target, (width) => matrixProduct(a, b, { width, size: 34 }))
            const room = boxOf(product)
            expect(room.width).toBeCloseTo(target, 6)
            expect(product.a.cell(0, 0).bounds().width).toBe(natural.a.cell(0, 0).bounds().width)
            expect(product.a.get('x')).toBeLessThan(natural.a.get('x'))
            expect(product.c.get('x')).toBeGreaterThan(natural.c.get('x'))
            expect(() => matrixProduct(a, b, { width: minimum - 1, size: 34 })).toThrow(/matrixProduct:.*width.*Give a width of/)
            s.play(product.pair(0, b[0]!.length - 1))
            for (let term = 0; term < b.length; term++) {
                s.play(product.addTerm())
                expect(boxOf(product).width).toBeCloseTo(target, 6)
                for (const label of product.line!.children.filter((part) => shows(part) > 0)) {
                    const box = label.bounds()
                    expect(box.x).toBeGreaterThanOrEqual(room.left)
                    expect(box.x + box.width).toBeLessThanOrEqual(room.right)
                }
            }
            s.play(product.store())
            expect(boxOf(product).width).toBeCloseTo(target, 6)
        })
    })

    it('replays a saved pair and a saved computation from a fresh line', async () => {
        await compile((s) => {
            const product = s.add(matrixProduct(A, B))
            const pair = product.pair(0, 0), compute = product.compute(0, 1)
            s.play(seq(pair, product.addTerm(), pair))
            expect([product.sum, lineAt(product, s.duration)]).toEqual([0, '1 × 7 + 2 × 9 + 3 × 11'])
            s.play(seq(compute, compute))
            expect([product.sum, product.filled, lineAt(product, s.duration)]).toEqual([64, 1, '1 × 8 + 2 × 10 + 3 × 12'])
        })
    })

    it.each(['product', 'group'])('continues two generations of a partially computed %s independently', async (kind) => {
        await compile((s) => {
            const product = matrixProduct(A, B)
            s.add(group(product))
            s.play(seq(product.pair(0, 1), product.addTerm()))
            const clone = (p: Product) => kind === 'product' ? s.add(p.clone()) : s.add(p.parent!.clone()).children[0] as Product
            const child = clone(product)
            s.play(child.addTerm())
            const grandchild = clone(child)
            s.play(seq(grandchild.addTerm(), grandchild.store()))
            const state = (p: Product) => [p.sum, p.filled, lineAt(p, s.duration), shows(p.c.numbers[0]![1]!)]
            expect(state(product)).toEqual([8, 0, '1 × 8 = 8', 0])
            expect(state(child)).toEqual([28, 0, '1 × 8 + 2 × 10 = 28', 0])
            expect(state(grandchild)).toEqual([64, 1, '1 × 8 + 2 × 10 + 3 × 12', 1])
        })
    })

    it('lands the plate on the cell in a scaled and translated group', async () => {
        let product!: Product
        await compile((s) => {
            product = matrixProduct([[1, 2]], [[3], [4]])
            s.add(group(product).scale(2).at(100, 50))
            s.play(product.pair(0, 0), { duration: 1 })
            s.play(product.addTerm(2), { duration: 1 })
            s.play(product.store(), { duration: 1, ease: linear })
        })
        at(2.8 - 1e-7, () => {
            const plate = product.line!.children.find((part) => part.data['decoration'])!
            const target = product.c.cell(0, 0).bounds(), bounds = plate.bounds()
            expect(shows(plate)).toBeGreaterThan(0.99)
            for (const key of ['x', 'y', 'width', 'height'] as const) expect(bounds[key]).toBeCloseTo(target[key], 3)
        })
    })

    it('allows the suggested next step after a scheduling error', async () => {
        await compile((s) => {
            const product = s.add(matrixProduct(A, B))
            expect(() => s.play(product.addTerm())).toThrow(/Play pair\(row, col\) first/)
            s.play(product.pair(0, 0))
            expect(() => s.play(product.store())).toThrow(/Play addTerm\(3\) first/)
            s.play(seq(product.addTerm(3), product.store()))
            expect(product.sum).toBe(58)
        })
    })

    it('takes the steps of a product in their order, one at a time, and says which step is missing', async () => {
        const run = (build: (product: Product, s: Stage) => void) => compile((s) => build(s.add(matrixProduct(A, B)), s))
        await expect(run((product, s) => s.play(product.addTerm()))).rejects.toThrow(/addTerm\(\) has no pair to take a term of\. Play pair\(row, col\) first/)
        await expect(run((product, s) => s.play(product.store()))).rejects.toThrow(/store\(\) has no pair to write the sum of\. Play pair\(row, col\) first/)
        await expect(run((product, s) => s.play(seq(product.pair(0, 0), product.addTerm(2), product.store())))).rejects.toThrow(/store\(\) writes a sum, and the sum of the pair \(0, 0\) has 2 of its 3 terms\. Play addTerm\(1\) first, or compute\(0, 0\) for the whole cell/)
        await expect(run((product, s) => s.play(seq(product.pair(0, 0), product.addTerm(2), product.addTerm(2))))).rejects.toThrow(/addTerm\(2\) would take 4 terms, and the pair \(0, 0\) has 3, with 2 in the sum\. Give addTerm\(1\) at the most/)
        await expect(run((product, s) => s.play(seq(product.pair(0, 0), product.addTerm(3), product.addTerm())))).rejects.toThrow(/has 3, all in the sum\. Play store\(\) to write the sum, or pair\(\) for the next cell/)
        await expect(run((product, s) => s.play(seq(product.compute(0, 0), product.store())))).rejects.toThrow(/the sum of the pair \(0, 0\) is in its cell already\. Play pair\(row, col\) for the next cell/)
        await expect(run((product, s) => s.play(product.pair(0, 0), product.addTerm(), { duration: 1 }))).rejects.toThrow(/addTerm\(\) plays from 0 s to 1 s, and pair\(0, 0\) plays from 0 s to 1 s\. A product takes one step at a time\. Play the two in a `seq`, or one after the other/)
        await expect(run((product, s) => s.play(lagged([product.enter(), product.pair(0, 0)], { lag: 0.5 })))).rejects.toThrow(/matrixProduct: pair\(0, 0\) plays from .* and enter\(\) plays from/)
    })

    it('computes one cell in one play, moves to the next pair, and completes the result', async () => {
        let product!: Product
        const f = await compile((s) => {
            product = s.add(matrixProduct(A, B))
            s.play(product.compute(0, 0), { duration: 3 })
            expect([product.lit, product.terms, product.sum, product.filled]).toEqual([[0, 0], 3, 58, 1])
            const first = product.line!
            s.play(product.pair(1, 1), { duration: 1 })
            expect([product.lit, product.terms, product.sum]).toEqual([[1, 1], 0, 0])
            expect(product.line).not.toBe(first)
            s.play(product.addTerm(3), { duration: 1 })
            expect(product.sum).toBe(154)
            s.play(product.complete(), { duration: 1 })
            expect([product.lit, product.filled, product.a.lit, product.b.lit, product.c.lit]).toEqual([null, 4, null, null, null])
            // A product can start again after it is complete.
            s.play(product.pair(0, 0), { duration: 1 })
            expect(product.lit).toEqual([0, 0])
        })
        expect(at(6, () => product.c.numbers.flat().map(shows))).toEqual([1, 1, 1, 1])
        expect(product.c.numbers.flat().map(source)).toEqual(['58', '64', '139', '154'])
        // The tint of the cells of a pair leaves with the pair.
        expect(at(6, () => product.a.cell(1, 0).get('fill'))).toEqual(at(0, () => product.a.cell(1, 0).get('fill')))
        expect(lineAt(product, f.duration)).toBe('1 × 7 + 2 × 9 + 3 × 11')
    })

    it('writes a negative number of a term in brackets, and keeps the room of its longest line for the layout', async () => {
        let product!: Product, room!: ReturnType<typeof boxOf>
        const f = await compile((s) => {
            product = s.add(matrixProduct([[0.5, -1.5, 2]], [[2], [0.25], [-1]], { names: ['q', 'k', 'score'] }))
            // The layout measures the object here, before its first pair.
            room = boxOf(product)
            s.play(product.compute(0, 0), { duration: 3 })
        })
        expect(lineAt(product, 2.2)).toBe('0.5 × 2 + (-1.5) × 0.25 + 2 × (-1) = -1.37')
        expect(product.sum).toBeCloseTo(-1.375, 9)
        // The box of the object, before its first pair, holds the line of the sum: no part of the line is outside it.
        const line = at(2.2, () => product.line!.bounds())
        expect(room.left).toBeLessThanOrEqual(line.x)
        expect(room.right).toBeGreaterThanOrEqual(line.x + line.width)
        expect(room.bottom).toBeGreaterThanOrEqual(line.y + line.height)
        expect(room.bottom).toBeGreaterThan(at(f.duration, () => product.b.bounds().y + product.b.bounds().height) + 30)
    })

    it('places its signs, its shapes and its sum so that the film check reports nothing, at a room of 0.3 and of 0.7', async () => {
        for (const textGap of [0.3, 0.7]) {
            const report = await checkFilm(film({ fps: 10 }, (s) => {
                const product = s.add(matrixProduct(A, B))
                s.wait(0.5)
                s.play(product.compute(0, 1), { duration: 4 })
                s.wait(1.2)
                s.play(product.compute(1, 0), { duration: 4 })
                s.wait(1.2)
            }), { textGap, motion: true })
            expect(report.diagnostics).toEqual([])
        }
    })
})
