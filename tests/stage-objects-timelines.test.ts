import { describe, expect, it } from 'vitest'
import { checkFilm, compileFilm, bitField, segmentedBar, spring, fadeIn, film, group, lagged, linear, mixColor, PAGE_STATES, parseColor, pathBounds, pathLength, pathToD, rect, seq, stateGrid, text, zone, lanes, smooth, delay, par, spotlight, dateLine, boxOf, fitted, type CompiledFilm, type Node, type PathOp, type Rgba, type Lanes, type LaneEvent, type LaneTimelineEvent, TextNode } from '../src/stage/index'
import { clock } from '../src/stage/track'
import type { Anim } from '../src/stage/anim'
import { at, compile, expectPure, paths } from './helpers/stage-objects'

describe('state grid', () => {
    type Grid = ReturnType<typeof stateGrid>
    const middle = (node: Node) => { const box = node.bounds(); return [box.x + box.width / 2, box.y + box.height / 2] }
    const look = (cell: Node) => ({ fill: cell.get('fill'), fillOpacity: cell.get('fillOpacity'), stroke: cell.get('stroke'), dashed: cell.get('dash') !== null })
    /** The look of a state, read from a grid of one cell. Call it while a film is built. */
    const lookOf = (state: string, options: Partial<Parameters<typeof stateGrid>[0]> = {}) => look(stateGrid({ columns: 1, rows: 1, ...options, initial: state }).cells[0]!)
    const fills = (grid: Grid) => grid.cells.map((cell) => cell.get('fillOpacity'))
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)
    const words = (key: Node) => key.children.map((entry) => (entry.children[1] as unknown as { source: string }).source)
    const fleet = { healthy: { color: 'green' }, draining: { color: 'yellow', fill: 0.3 }, down: { color: 'red', fill: 0, dash: true } }

    it('places its middle, puts each cell where p() says, and keeps the edges on whole pixels', async () => {
        await compileFilm(film(() => {
            const grid = stateGrid({ columns: 4, rows: 2, cell: 20, gap: 4 }).at(100, 50)
            expect(grid.cells).toHaveLength(8)
            expect([grid.columns, grid.rows, grid.size]).toEqual([4, 2, 8])
            // 4 cells of 20 with 3 gaps of 4 are 92 wide, and 2 rows are 44 tall, around the place of the grid.
            const box = grid.bounds()
            expect([box.x, box.y, box.width, box.height]).toEqual([54, 28, 92, 44])
            // The index is row * columns + column: cell 5 is in the second row, in the second column.
            expect(grid.p(0)).toEqual([-36, -12])
            expect(grid.p(5)).toEqual([-12, 12])
            grid.cells.forEach((cell, index) => expect(middle(cell)).toEqual([100 + grid.p(index)[0], 50 + grid.p(index)[1]]))
            // A grid that is 35 wide and 9 tall cannot have its middle and its edges on whole pixels. The edges win.
            const odd = stateGrid({ columns: 3, rows: 1, cell: 9, gap: 4 })
            for (const cell of odd.cells) {
                const edges = cell.bounds()
                expect([edges.x, edges.y]).toEqual([Math.round(edges.x), Math.round(edges.y)])
            }
            expect(Math.abs(middle(odd)[0])).toBe(0.5)
            expect(Math.abs(middle(odd)[1])).toBe(0.5)
            // The default cell is 28, and the default gap is 0.18 of the cell in whole pixels, 3 at least.
            const plain = stateGrid({ columns: 2, rows: 1 })
            expect(plain.cells[0]!.bounds().width).toBe(28)
            expect(plain.p(1)[0] - plain.p(0)[0]).toBe(33)
            const small = stateGrid({ columns: 2, rows: 1, cell: 8 })
            expect(small.p(1)[0] - small.p(0)[0]).toBe(11)
        }))
    })

    it('takes the first states from one name, a list, or a function of the index', async () => {
        await compileFilm(film(() => {
            const names = ['absent', 'zero', 'present', 'dirty', 'shared', 'copied']
            expect(stateGrid({ columns: 3, rows: 2, initial: 'dirty' }).count('dirty')).toBe(6)
            const listed = stateGrid({ columns: 3, rows: 2, initial: names })
            expect(names.map((_, index) => listed.stateOf(index))).toEqual(names)
            const computed = stateGrid({ columns: 3, rows: 2, initial: (index) => (index % 2 ? 'file' : 'swapped') })
            expect(computed.indexes('file')).toEqual([1, 3, 5])
            expect(computed.count('swapped')).toBe(3)
            expect(computed.count('present')).toBe(0)
            // Without `initial`, every cell has the first state of the record.
            expect(stateGrid({ columns: 2, rows: 1 }).indexes('absent')).toEqual([0, 1])
            expect(stateGrid({ columns: 2, rows: 1, states: fleet }).indexes('healthy')).toEqual([0, 1])
        }))
    })

    it('gives a cell the color of its state for the fill and the outline, with the fill opacity and the dashes of the state', async () => {
        let purple!: Rgba, faint!: Rgba
        const compiled = await compile((s) => {
            purple = parseColor('purple')
            faint = parseColor('faint')
            s.add(stateGrid({ columns: 3, rows: 1, initial: ['absent', 'present', 'dirty'] }))
            s.wait(1)
        })
        const [absent, present, dirty] = paths(compiled, 0.5)
        // A fill of 0 draws the outline only.
        expect(absent!.fill).toBeNull()
        expect(absent!.stroke).toEqual(faint)
        expect(absent!.dash).not.toBeNull()
        expect(present!.fill).toEqual(purple)
        expect(present!.stroke).toEqual(purple)
        expect(present!.fillAlpha).toBeCloseTo(0.7, 6)
        expect(present!.strokeAlpha).toBe(1)
        expect(present!.dash).toBeNull()
        expect(dirty!.fillAlpha).toBeCloseTo(0.8, 6)
    })

    it('gives the eight states of memory pages their looks', async () => {
        await compileFilm(film(() => {
            const pages = {
                absent: ['faint', 0, true], zero: ['dim', 0.25, false], present: ['purple', 0.7, false], dirty: ['orange', 0.8, false],
                shared: ['teal', 0.6, false], copied: ['green', 0.8, false], file: ['purple', 0.3, false], swapped: ['red', 0.3, false],
            } as const
            expect(Object.keys(PAGE_STATES)).toEqual(Object.keys(pages))
            const grid = stateGrid({ columns: 8, rows: 1, initial: Object.keys(pages) })
            Object.values(pages).forEach(([color, fill, dashed], index) => {
                expect(look(grid.cells[index]!)).toEqual({ fill: parseColor(color), fillOpacity: fill, stroke: parseColor(color), dashed })
            })
        }))
    })

    it('draws an outline that grows with the cell, from 1 to 3 pixels', async () => {
        await compileFilm(film(() => {
            const widths = [8, 28, 40, 200].map((cell) => stateGrid({ columns: 1, rows: 1, cell }).cells[0]!.get('strokeWidth'))
            expect(widths).toEqual([1, expect.closeTo(1.54, 6), expect.closeTo(2.2, 6), 3])
        }))
    })

    it('closes the dashes around a cell, with one dash centered on each corner', async () => {
        await compileFilm(film(() => {
            for (const side of [12, 28, 90]) {
                const cell = stateGrid({ columns: 1, rows: 1, cell: side }).cells[0]!
                const [dash, room] = cell.get('dash')!
                // Sixteen dashes go around: four for each quarter, so the four corners look the same. The length
                // of a rounded corner is not exact, so allow a thousandth of the outline.
                expect(Math.abs(((dash! + room!) * 16) / pathLength(cell.get('path')!) - 1)).toBeLessThan(0.001)
                expect(dash!).toBeGreaterThan(room!)
                // The ends of a dash are flat, so a dash is as long as its pattern says.
                expect(cell.get('cap')).toBe('butt')
                // The outline starts where the top left corner ends. The middle of that corner is an eighth of a
                // circle before it, and the middle of a dash is there.
                const box = cell.bounds(), start = cell.get('path')![0]!.p[0]!
                const radius = start - box.x
                expect(radius).toBeCloseTo(side * 0.16, 6)
                expect(cell.get('dashOffset') - (Math.PI / 4) * radius).toBeCloseTo(dash! / 2, 6)
            }
        }))
    })

    it('changes one cell, a list of cells, or the cells that a function picks', async () => {
        let grid!: Grid
        let present!: ReturnType<typeof look>, dirty!: ReturnType<typeof look>, file!: ReturnType<typeof look>, absent!: ReturnType<typeof look>
        await compile((s) => {
            [absent, present, dirty, file] = ['absent', 'present', 'dirty', 'file'].map((state) => lookOf(state)) as [typeof absent, typeof absent, typeof absent, typeof absent]
            grid = s.add(stateGrid({ columns: 4, rows: 2, initial: 'absent' }))
            s.play(grid.change(5, 'present'), { duration: 1 })
            // A cell that the list names twice changes once.
            s.play(grid.change([7, 1, 1, 0], 'dirty'), { duration: 1 })
            s.play(grid.change((index, state) => state === 'absent' && index < 4, 'file'), { duration: 1 })
        })
        expect(grid.indexes('present')).toEqual([5])
        expect(grid.indexes('dirty')).toEqual([0, 1, 7])
        expect(grid.indexes('file')).toEqual([2, 3])
        expect(grid.indexes('absent')).toEqual([4, 6])
        // The cells have their new looks when each change ends, and not before it starts.
        expect(at(1, () => look(grid.cells[5]!))).toEqual(present)
        expect(at(1, () => look(grid.cells[7]!))).toEqual(absent)
        expect(at(2, () => [0, 1, 7].map((index) => look(grid.cells[index]!)))).toEqual([dirty, dirty, dirty])
        expect(at(2, () => look(grid.cells[2]!))).toEqual(absent)
        expect(at(3, () => [2, 3].map((index) => look(grid.cells[index]!)))).toEqual([file, file])
        expect(at(3, () => [4, 6].map((index) => look(grid.cells[index]!)))).toEqual([absent, absent])
    })

    it('fades the fill, its opacity and the outline to the new state, and switches the dashes half way', async () => {
        let grid!: Grid
        let absent!: ReturnType<typeof look>, present!: ReturnType<typeof look>
        await compile((s) => {
            absent = lookOf('absent')
            present = lookOf('present')
            grid = s.add(stateGrid({ columns: 1, rows: 1, initial: 'absent' }))
            s.wait(1)
            s.play(grid.change(0, 'present'), { duration: 2, ease: linear })
            s.wait(1)
        })
        const cell = grid.cells[0]!
        const mixed = (share: number) => mixColor(absent.stroke as Rgba, present.stroke as Rgba, share)
        expect(at(1, () => look(cell))).toEqual(absent)
        // A quarter of the way: the colors and the opacity are a quarter of the way, and the outline is still dashed.
        expect(at(1.5, () => look(cell))).toEqual({ fill: mixed(0.25), fillOpacity: expect.closeTo(0.175, 6), stroke: mixed(0.25), dashed: true })
        expect(at(1.99, () => cell.get('dash'))).not.toBeNull()
        expect(at(2.01, () => cell.get('dash'))).toBeNull()
        expect(at(2.5, () => look(cell))).toEqual({ fill: mixed(0.75), fillOpacity: expect.closeTo(0.525, 6), stroke: mixed(0.75), dashed: false })
        expect(at(3, () => look(cell))).toEqual(present)
        expect(at(4, () => look(cell))).toEqual(present)
    })

    it('brings the dashes back when a cell goes to a dashed state', async () => {
        let grid!: Grid
        let absent!: ReturnType<typeof look>
        await compile((s) => {
            absent = lookOf('absent')
            grid = s.add(stateGrid({ columns: 1, rows: 1, initial: 'present' }))
            s.play(grid.change(0, 'absent'), { duration: 1, ease: linear })
        })
        expect(at(0.49, () => grid.cells[0]!.get('dash'))).toBeNull()
        expect(at(0.51, () => grid.cells[0]!.get('dash'))).toEqual(stateGrid({ columns: 1, rows: 1 }).cells[0]!.get('dash'))
        expect(at(1, () => look(grid.cells[0]!))).toEqual(absent)
    })

    it('sweeps the cells in index order, whatever the order of the list, over the whole duration', async () => {
        let grid!: Grid, listed!: Grid
        await compile((s) => {
            grid = s.add(stateGrid({ columns: 2, rows: 2, initial: 'absent' }))
            listed = s.add(stateGrid({ columns: 2, rows: 2, initial: 'absent' }))
            s.wait(1)
            // With a lag of 1, each cell starts when the cell before it ends: four cells, one second each.
            s.play(grid.change(() => true, 'present', { lag: 1 }), listed.change([3, 0, 2, 1], 'present', { lag: 1 }), { duration: 4, ease: linear })
        })
        for (const made of [grid, listed]) {
            expect(at(1, () => fills(made))).toEqual([0, 0, 0, 0])
            expect(at(1.5, () => fills(made))).toEqual([expect.closeTo(0.35, 6), 0, 0, 0])
            expect(at(3.5, () => fills(made))).toEqual([0.7, 0.7, expect.closeTo(0.35, 6), 0])
            expect(at(4.5, () => fills(made))).toEqual([0.7, 0.7, 0.7, expect.closeTo(0.35, 6)])
            expect(at(5, () => fills(made))).toEqual([0.7, 0.7, 0.7, 0.7])
        }
    })

    it('gives each cell three tenths of the time of a change by default, at every count', async () => {
        const grids: Grid[] = []
        await compile((s) => {
            for (const columns of [8, 50]) grids.push(s.add(stateGrid({ columns, rows: 1, initial: 'absent' })))
            s.play(...grids.map((grid) => grid.change(() => true, 'present')), { duration: 10, ease: linear })
        })
        for (const grid of grids) {
            const first = grid.cells[0]!, last = grid.cells[grid.size - 1]!
            // The first cell changes from 0 to 3 seconds, and the last one from 7 to 10.
            expect(at(1.5, () => first.get('fillOpacity'))).toBeCloseTo(0.35, 6)
            expect(at(3, () => first.get('fillOpacity'))).toBeCloseTo(0.7, 6)
            expect(at(7, () => last.get('fillOpacity'))).toBe(0)
            expect(at(8.5, () => last.get('fillOpacity'))).toBeCloseTo(0.35, 6)
            expect(at(10, () => last.get('fillOpacity'))).toBeCloseTo(0.7, 6)
        }
    })

    it('takes the duration and the ease of a change and of an entrance from their options', async () => {
        await compileFilm(film(() => {
            const grid = stateGrid({ columns: 2, rows: 2 })
            expect(grid.change(0, 'dirty').duration).toBe(1)
            expect(grid.change(0, 'dirty', { duration: 3, ease: linear })).toMatchObject({ duration: 3, ease: linear })
            expect(grid.enter().duration).toBe(1.2)
            expect(grid.enter({ duration: 2, ease: linear })).toMatchObject({ duration: 2, ease: linear })
        }))
    })

    it('gives two cells half of the time each, with no pause between them', async () => {
        let grid!: Grid
        await compile((s) => {
            grid = s.add(stateGrid({ columns: 2, rows: 1, initial: 'absent' }))
            s.play(grid.change(() => true, 'present'), { duration: 2, ease: linear })
        })
        expect(at(0.5, () => fills(grid))).toEqual([expect.closeTo(0.35, 6), 0])
        expect(at(1, () => fills(grid))).toEqual([expect.closeTo(0.7, 6), 0])
        expect(at(1.5, () => fills(grid))).toEqual([0.7, expect.closeTo(0.35, 6)])
    })

    it('counts the states after two changes in one sequence, where the second change sees what the first one left', async () => {
        let grid!: Grid
        let dirty!: ReturnType<typeof look>, copied!: ReturnType<typeof look>
        await compile((s) => {
            dirty = lookOf('dirty')
            copied = lookOf('copied')
            grid = s.add(stateGrid({ columns: 3, rows: 2, initial: 'absent' }))
            const first = grid.change([0, 1, 2], 'dirty'), second = grid.change((_, state) => state === 'dirty', 'copied')
            // A change takes effect when the film plays it, not when the film makes it.
            expect(grid.count('dirty')).toBe(0)
            s.play(seq(first, second), { duration: 2 })
        })
        expect(grid.count('copied')).toBe(3)
        expect(grid.count('dirty')).toBe(0)
        expect(grid.count('absent')).toBe(3)
        expect([0, 1, 2, 3].map((index) => grid.stateOf(index))).toEqual(['copied', 'copied', 'copied', 'absent'])
        // On the timeline, the three cells are dirty after the first half, and copied at the end.
        expect(at(1, () => [0, 1, 2].map((index) => look(grid.cells[index]!)))).toEqual([dirty, dirty, dirty])
        expect(at(2, () => [0, 1, 2].map((index) => look(grid.cells[index]!)))).toEqual([copied, copied, copied])
    })

    it('leaves a cell that already has the state alone, and gives it no part of the time', async () => {
        let grid!: Grid
        await compile((s) => {
            grid = s.add(stateGrid({ columns: 4, rows: 1, initial: ['present', 'absent', 'present', 'absent'] }))
            s.play(grid.change([0, 1, 2, 3], 'present', { lag: 1 }), { duration: 2, ease: linear })
            // A change that finds no cell to change does nothing.
            s.play(grid.change(() => true, 'present'), { duration: 1 })
        })
        // Two cells change, so each has half of the time. With a part for each of the four, cell 1 would start at 0.5.
        expect(at(0.5, () => fills(grid))).toEqual([0.7, expect.closeTo(0.35, 6), 0.7, 0])
        expect(at(1.5, () => fills(grid))).toEqual([0.7, 0.7, 0.7, expect.closeTo(0.35, 6)])
        expect(grid.count('present')).toBe(4)
        expect(at(2.5, () => fills(grid))).toEqual([0.7, 0.7, 0.7, 0.7])
    })

    it('takes its own set of states', async () => {
        let grid!: Grid
        let down!: ReturnType<typeof look>
        await compile((s) => {
            down = lookOf('down', { states: fleet })
            grid = s.add(stateGrid({ columns: 5, rows: 2, states: fleet, initial: (index) => (index === 3 ? 'draining' : 'healthy') }))
            // A state without a fill has a fill of 0.7.
            expect(look(grid.cells[0]!)).toEqual({ fill: parseColor('green'), fillOpacity: 0.7, stroke: parseColor('green'), dashed: false })
            expect(grid.cells[3]!.get('fillOpacity')).toBe(0.3)
            s.play(grid.change([3, 4], 'down'), { duration: 1 })
            // The states of memory pages are not states of this grid.
            expect(() => grid.change(0, 'present')).toThrow(/no state "present". The states are healthy, draining, down/)
        })
        expect([grid.count('healthy'), grid.count('draining'), grid.count('down')]).toEqual([8, 0, 2])
        expect(at(1, () => look(grid.cells[4]!))).toEqual(down)
        expect(down).toMatchObject({ fillOpacity: 0, dashed: true })
    })

    it('makes a legend that starts at its place, with each sample and its name on one middle line and the same room between every pair', async () => {
        await compileFilm(film(() => {
            const grid = stateGrid({ columns: 4, rows: 2, initial: 'absent' })
            const key = grid.legend([['absent', 'not in memory'], 'present', ['dirty', 'DIRTY']], { size: 30, gap: 40 }).at(100, 50)
            // The legend is a node of its own. The grid still holds its cells and nothing else.
            expect(key.parent).toBeNull()
            expect(grid.children).toHaveLength(8)
            expect(words(key)).toEqual(['not in memory', 'present', 'DIRTY'])
            const samples = key.children.map((entry) => entry.children[0]!.bounds()), names = key.children.map((entry) => entry.children[1]!.bounds())
            expect(samples[0]!.x).toBeCloseTo(100, 6)
            // A sample is a little smaller than the text, with an even side, so its top and bottom are on whole pixels.
            for (const sample of samples) {
                expect(sample.y + sample.height / 2).toBeCloseTo(50, 6)
                expect([sample.width, sample.height]).toEqual([26, 26])
            }
            expect(key.children.map((entry) => entry.children[1]!.data['size'])).toEqual([30, 30, 30])
            // Capitals are as tall as the line is meant for: their middle is the middle line of the samples.
            expect(Math.abs(names[2]!.y + names[2]!.height / 2 - 50)).toBeLessThan(1)
            // Every name has a part above the line and a part below it, and no name is far off the line.
            for (const name of names) expect(Math.abs(name.y + name.height / 2 - 50)).toBeLessThan(30 * 0.15)
            // The room is measured to the ink of a name: the same after each sample, and the same before the next one.
            names.forEach((name, index) => {
                expect(name.x - (samples[index]!.x + samples[index]!.width)).toBeCloseTo(30 * 0.45, 6)
                if (index + 1 < samples.length) expect(samples[index + 1]!.x - (name.x + name.width)).toBeCloseTo(40, 6)
            })
            // The names are dim, so the cells of the grid stay the strongest marks.
            expect(key.children[1]!.children[1]!.children[0]!.get('fill')).toEqual(parseColor('dim'))
            // A sample has the look of a cell in that state.
            const cells = key.children.map((entry) => look(entry.children[0]!))
            expect(cells).toEqual([lookOf('absent'), lookOf('present'), lookOf('dirty')])
            // The default size is 26, and the default gap is 1.3 of the size.
            const plain = grid.legend(['absent', 'present']).children.map((entry) => entry.children.map((part) => part.bounds()))
            expect(plain[1]![0]!.x - (plain[0]![1]!.x + plain[0]![1]!.width)).toBeCloseTo(26 * 1.3, 6)
            expect(plain[0]![0]!.width).toBe(22)
            expect(grid.legend(['absent']).children[0]!.children[1]!.data['size']).toBe(26)
            // The names take the font of the legend.
            expect(grid.legend(['absent'], { font: 'mono' }).children[0]!.children[1]!.bounds().width).toBeGreaterThan(plain[0]![1]!.width + 5)
        }))
    })

    it('lists the states that the grid has now, in the order of the record, when the legend gets no list', async () => {
        await compile((s) => {
            const grid = s.add(stateGrid({ columns: 3, rows: 1, initial: ['dirty', 'absent', 'dirty'] }))
            expect(words(grid.legend())).toEqual(['absent', 'dirty'])
            s.play(grid.change(1, 'swapped'), { duration: 1 })
            expect(words(grid.legend())).toEqual(['dirty', 'swapped'])
            expect(words(grid.legend(['swapped', 'zero']))).toEqual(['swapped', 'zero'])
        })
    })

    it('enters row by row, with nothing on screen at the start and every cell at the end', async () => {
        let grid!: Grid
        const compiled = await compile((s) => {
            grid = stateGrid({ columns: 3, rows: 4, initial: 'present' })
            s.wait(0.5)
            s.play(grid.enter({ lag: 1 }), { duration: 2, ease: linear })
            s.wait(0.5)
        })
        expect(compiled.frame(0.2).ops).toHaveLength(0)
        // Four rows with a lag of 1: each row has half a second, one after the other. The cells of a row arrive together.
        const rows = () => [0, 1, 2, 3].map((row) => [0, 1, 2].map((column) => shows(grid.cells[row * 3 + column]!)))
        const half = expect.closeTo(0.5, 6)
        expect(at(0.75, rows)).toEqual([[half, half, half], [0, 0, 0], [0, 0, 0], [0, 0, 0]])
        expect(at(1.75, rows)).toEqual([[1, 1, 1], [1, 1, 1], [half, half, half], [0, 0, 0]])
        expect(at(2.6, rows)).toEqual([[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]])
        expect(compiled.frame(2.6).ops).toHaveLength(12)
    })

    it('starts a row a quarter of the time of one row after the row before it, by default', async () => {
        let grid!: Grid
        await compile((s) => {
            grid = stateGrid({ columns: 1, rows: 4, initial: 'present' })
            // Four rows that start a quarter apart take 1.75 times the time of one row: one second for each row.
            s.play(grid.enter(), { duration: 1.75, ease: linear })
        })
        expect(at(0.5, () => grid.cells.map(shows))).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.25, 6), 0, 0])
        expect(at(1.25, () => grid.cells.map(shows))).toEqual([1, 1, expect.closeTo(0.75, 6), expect.closeTo(0.5, 6)])
    })

    it('enters at its turn in a sequence, and stays in the group that holds it', async () => {
        let grid!: Grid, outer!: Node
        const compiled = await compile((s) => {
            grid = stateGrid({ columns: 2, rows: 2, cell: 20, gap: 4, initial: 'present' })
            outer = group(grid).at(300, 0)
            s.wait(1)
            s.play(seq(fadeIn(rect(50, 50)), grid.enter()), { duration: 2 })
            s.wait(0.5)
        })
        // During the first half, the film draws the rectangle and no cell.
        expect(compiled.frame(1.5).ops).toHaveLength(1)
        expect(compiled.frame(3.2).ops).toHaveLength(5)
        expect(grid.parent).toBe(outer)
        expect(at(3.2, () => grid.cells[0]!.bounds().x)).toBe(300 - 22)
    })

    it('shows a grid that the film hid, when it enters', async () => {
        const compiled = await compile((s) => {
            const grid = s.add(stateGrid({ columns: 2, rows: 2, initial: 'present' }).hide())
            s.wait(0.5)
            s.play(grid.enter(), { duration: 1 })
            s.wait(0.5)
        })
        expect(compiled.frame(0.3).ops).toHaveLength(0)
        expect(compiled.frame(1.8).ops).toHaveLength(4)
    })

    it('gives a copy its own cells and its own states', async () => {
        let grid!: Grid, copy!: Grid
        await compile((s) => {
            grid = s.add(stateGrid({ columns: 2, rows: 1, initial: 'absent' }))
            copy = s.add(grid.clone().at(0, 100))
            expect(copy.cells[0]).not.toBe(grid.cells[0])
            expect(copy.children).toEqual(copy.cells)
            s.play(copy.change(0, 'present'), { duration: 1 })
        })
        expect(copy.stateOf(0)).toBe('present')
        expect(grid.stateOf(0)).toBe('absent')
        expect(at(1, () => [fills(copy), fills(grid)])).toEqual([[0.7, 0], [0, 0]])
    })

    it('names a wrong size, state, list or index', async () => {
        await compileFilm(film(() => {
            expect(() => stateGrid({ columns: 0, rows: 2 })).toThrow(/columns is 0. Give a whole number, 1 or more/)
            expect(() => stateGrid({ columns: 2, rows: 1.5 })).toThrow(/rows is 1.5. Give a whole number, 1 or more/)
            expect(() => stateGrid({ columns: 100, rows: 51 })).toThrow(/100 by 51 is 5100 cells, and a grid draws 5000 at most/)
            expect(stateGrid({ columns: 100, rows: 50 }).size).toBe(5000)
            expect(() => stateGrid({ columns: 2, rows: 2, cell: 0 })).toThrow(/cell is the side/)
            expect(() => stateGrid({ columns: 2, rows: 2, gap: -1 })).toThrow(/gap is the room/)
            expect(() => stateGrid({ columns: 2, rows: 2, states: {} })).toThrow(/at least one state/)
            expect(() => stateGrid({ columns: 2, rows: 2, states: { on: { color: 'green', fill: 1.5 } } })).toThrow(/the fill of the state "on" is 1.5. A fill is an opacity, 0 to 1/)
            expect(() => stateGrid({ columns: 2, rows: 2, states: { on: { color: 'green', fill: -0.1 } } })).toThrow(/the fill of the state "on" is -0.1/)
            expect(() => stateGrid({ columns: 2, rows: 2, initial: 'missing' })).toThrow(/no state "missing". The states are absent, zero, present, dirty, shared, copied, file, swapped/)
            expect(() => stateGrid({ columns: 2, rows: 2, initial: () => 'gone' })).toThrow(/no state "gone"/)
            expect(() => stateGrid({ columns: 2, rows: 2, initial: ['absent', 'gone', 'absent', 'absent'] })).toThrow(/no state "gone"/)
            expect(() => stateGrid({ columns: 2, rows: 2, initial: ['absent', 'zero'] })).toThrow(/the initial list has a length of 2, and the number of cells is 4/)
            const grid = stateGrid({ columns: 2, rows: 2 })
            expect(() => grid.p(4)).toThrow(/no cell 4. The cells of this grid are 0 to 3/)
            expect(() => grid.stateOf(-1)).toThrow(/no cell -1/)
            // A change names its mistake when the film makes it, before the film plays it.
            expect(() => grid.change(1.5, 'dirty')).toThrow(/no cell 1.5/)
            expect(() => grid.change([0, 9], 'dirty')).toThrow(/no cell 9/)
            expect(() => grid.change(0, 'drity')).toThrow(/no state "drity"/)
            expect(() => grid.change(() => true, 'drity')).toThrow(/no state "drity"/)
            expect(() => grid.count('drity')).toThrow(/no state "drity"/)
            expect(() => grid.indexes('drity')).toThrow(/no state "drity"/)
            expect(() => grid.legend(['drity'])).toThrow(/no state "drity"/)
            expect(() => grid.legend([])).toThrow(/give the legend at least one state/)
            expect(() => grid.legend(undefined, { size: 0 })).toThrow(/size of the legend/)
            expect(() => grid.legend(undefined, { gap: -1 })).toThrow(/gap of the legend/)
        }))
    })
})

describe('lanes', () => {
    const names = [{ name: 'guest', color: 'red' }, { name: 'KVM', color: 'teal' }, { name: 'monitor', color: 'blue' }]
    const events: LaneEvent[] = [
        { lane: 'guest', start: 0, end: 30, label: 'runs' },
        { from: 'guest', to: 'KVM', at: 30, label: 'VM exit' },
        { lane: 'KVM', start: 30, end: 42 },
        { from: 'KVM', to: 'monitor', at: 42, label: 'return to user space' },
        { lane: 'monitor', start: 42, end: 70, label: 'emulates the device' },
        { from: 'monitor', to: 'KVM', at: 70, label: 'KVM_RUN' },
        { lane: 'KVM', start: 70, end: 78 },
        { from: 'KVM', to: 'guest', at: 78, label: 'VM entry' },
        { lane: 'guest', start: 78, end: 100, label: 'runs', open: true },
    ]
    // 10 px for each unit of time, and lanes at -100, 0 and 100, with bars from 20 over a lane to 20 under it.
    const sized = { width: 1000, barHeight: 40, pitch: 100 }
    const at = <T,>(time: number, read: () => T): T => { clock.now = time; return read() }
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)
    const right = (node: Node) => { const box = node.bounds(); return box.x + box.width }
    const bottom = (node: Node) => { const box = node.bounds(); return box.y + box.height }
    const words = (node: Node) => node.children.map((child) => (child as unknown as { source?: string }).source).filter(Boolean)

    it('puts a time on x and a lane on y, each bar from the start of its span to its end, and the names at the left', async () => {
        await compileFilm(film(() => {
            const flow: ReturnType<typeof lanes> = lanes(names, events, sized)
            expect([flow.x(0), flow.x(50), flow.x(100)]).toEqual([-500, 0, 500])
            expect([flow.y('guest'), flow.y('KVM'), flow.y(2)]).toEqual([-100, 0, 100])
            expect(flow.domain).toEqual([0, 100])
            // One node per event, in the order given, and the same nodes by kind.
            expect(flow.events.map((event): 'span' | 'handoff' | 'mark' => event.kind)).toEqual(['span', 'handoff', 'span', 'handoff', 'span', 'handoff', 'span', 'handoff', 'span'])
            expect(flow.spans).toEqual([0, 2, 4, 6, 8].map((index) => flow.events[index]))
            expect(flow.handoffs).toEqual([1, 3, 5, 7].map((index) => flow.events[index]))
            expect(flow.marks).toEqual([])
            const bar = flow.spans[2]!.shape.bounds()
            expect(bar.x).toBeCloseTo(flow.x(42), 6)
            expect(bar.x + bar.width).toBeCloseTo(flow.x(70), 6)
            expect([bar.y, bar.y + bar.height]).toEqual([80, 120])
            flow.rails.forEach((rail, index) => {
                const box = rail.bounds()
                expect([box.x, box.x + box.width, box.y]).toEqual([-500, 500, flow.y(index)])
            })
            // The names end at one x, outside the time area, each at the height of its lane.
            const ends = flow.names.map(right)
            expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(4)
            expect(Math.max(...ends)).toBeLessThan(-500 - 8)
            flow.names.forEach((name, index) => expect(Math.abs(name.bounds().y + name.bounds().height / 2 - flow.y(index))).toBeLessThan(8))
            expect(flow.names.map((name) => (name as unknown as { source: string }).source)).toEqual(['guest', 'KVM', 'monitor'])
            // `.at()` places the middle of the time area, not the middle of the object with its names.
            const moved = lanes(names, events, sized).at(120, -30)
            const rail = moved.rails[1]!.bounds()
            expect([rail.x + rail.width / 2, rail.y]).toEqual([120, -30])
        }))
    })

    it('gives a span the color of its lane, or its own', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['plain', { name: 'teal', color: 'teal' }], [
                { lane: 'plain', start: 0, end: 10 }, { lane: 'teal', start: 10, end: 20 }, { lane: 'teal', start: 20, end: 30, color: 'red' },
            ])
            const paint = (color: string) => rect(1, 1, { fill: color, stroke: null }).get('fill')
            expect(flow.spans.map((span) => span.shape.get('fill'))).toEqual([paint('blue'), paint('teal'), paint('red')])
            // A handoff is in ink, whatever the colors of its two lanes. A mark takes the color of its lane. Each takes its own color when it has one.
            const more = lanes(['plain', { name: 'teal', color: 'teal' }], [
                { from: 'teal', to: 'plain', at: 10 }, { from: 'plain', to: 'teal', at: 20, color: 'orange' }, { lane: 'teal', at: 30 }, { lane: 'teal', at: 40, color: 'red' },
            ])
            expect(more.handoffs.map((handoff) => handoff.shape.children[0]!.get('stroke'))).toEqual([paint('ink'), paint('orange')])
            expect(more.handoffs.map((handoff) => handoff.shape.children[1]!.get('fill'))).toEqual([paint('ink'), paint('orange')])
            expect(more.marks.map((mark) => mark.shape.get('fill'))).toEqual([paint('teal'), paint('red')])
        }))
    })

    it('draws the arrow of a handoff at its time, from the edge of one bar to the edge of the other', async () => {
        await compileFilm(film(() => {
            const flow = lanes(names, events, sized)
            const down = flow.handoffs[0]!.shape.bounds()
            expect(down.x + down.width / 2).toBeCloseTo(flow.x(30), 6)
            expect([down.y, down.y + down.height]).toEqual([-80, -20])
            // The head is at the lane that the handoff goes to: under the arrow on the way down, over it on the way up.
            expect(bottom(flow.handoffs[0]!.shape.children[1]!)).toBe(-20)
            const up = flow.handoffs[2]!.shape
            expect([up.bounds().y, bottom(up)]).toEqual([20, 80])
            expect(up.children[1]!.bounds().y).toBe(20)
            expect(bottom(up.children[1]!)).toBeLessThan(40)
        }))
    })

    it('puts the label of a span inside its bar when it fits, and over the bar when it does not', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['a'], [
                { lane: 'a', start: 0, end: 50, label: 'fits' },
                { lane: 'a', start: 50, end: 53, label: 'does not fit' },
                { lane: 'a', start: 96, end: 100, label: 'near the end' },
            ], { ...sized, size: 26 })
            const [inside, over, last] = flow.spans.map((span) => ({ bar: span.shape.bounds(), text: span.text!.bounds() }))
            // Inside: at the start of the bar, with room at both sides, and between its top and its bottom.
            expect(inside!.text.x).toBeCloseTo(inside!.bar.x + 13, 6)
            expect(inside!.text.x + inside!.text.width).toBeLessThan(inside!.bar.x + inside!.bar.width - 13)
            expect(inside!.text.y).toBeGreaterThan(inside!.bar.y)
            expect(inside!.text.y + inside!.text.height).toBeLessThan(inside!.bar.y + inside!.bar.height)
            // Over: it starts at the left end of the bar, and does not touch the bar.
            expect(over!.text.x).toBeCloseTo(over!.bar.x, 6)
            expect(over!.text.x + over!.text.width).toBeGreaterThan(over!.bar.x + over!.bar.width)
            expect(over!.text.y + over!.text.height).toBeLessThan(over!.bar.y - 3)
            // Over a bar at the right end, where it would leave the time area: it ends at the right end of the bar.
            expect(last!.text.x + last!.text.width).toBeCloseTo(500, 6)
            // A bar that is too low for the text has its label over it, at any width.
            const low = lanes(['a'], [{ lane: 'a', start: 0, end: 100, label: 'fits' }], { ...sized, barHeight: 20, size: 26 })
            expect(bottom(low.spans[0]!.text!)).toBeLessThan(low.spans[0]!.shape.bounds().y)
            // A bar that is wider than its label by less than the room at both sides: the label is over it.
            const width = inside!.text.width
            const tight = lanes(['a'], [{ lane: 'a', start: 0, end: (width + 20) / 10, label: 'fits' }, { lane: 'a', start: 50, end: 50 + (width + 30) / 10, label: 'fits' }], { ...sized, size: 26, domain: [0, 100] })
            expect(bottom(tight.spans[0]!.text!)).toBeLessThan(tight.spans[0]!.shape.bounds().y)
            expect(tight.spans[1]!.text!.bounds().y).toBeGreaterThan(tight.spans[1]!.shape.bounds().y)
        }))
    })

    it('puts the label of a handoff at the right of its arrow, between the two lanes, and at the left when the right has no room', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['a', 'b', 'c'], [
                { from: 'a', to: 'b', at: 20, label: 'at the right' },
                { from: 'b', to: 'a', at: 96, label: 'near the end' },
                { from: 'a', to: 'c', at: 50, label: 'two lanes down' },
                { from: 'c', to: 'a', at: 75, label: 'up' },
            ], { ...sized, domain: [0, 100] })
            const [plain, late, far, up] = flow.handoffs.map((handoff) => ({ arrow: handoff.shape.bounds(), text: handoff.text!.bounds() }))
            expect(plain!.text.x).toBeGreaterThan(plain!.arrow.x + plain!.arrow.width + 4)
            expect(plain!.text.x).toBeLessThan(plain!.arrow.x + plain!.arrow.width + 16)
            // Between the two bars: under the bar of the first lane and over the bar of the second.
            expect(plain!.text.y).toBeGreaterThan(flow.y('a') + 20)
            expect(plain!.text.y + plain!.text.height).toBeLessThan(flow.y('b') - 20)
            expect(Math.abs(plain!.text.y + plain!.text.height / 2 - (flow.y('a') + flow.y('b')) / 2)).toBeLessThan(6)
            // At the right, this label would leave the time area. It goes to the left of its arrow.
            expect(late!.text.x + late!.text.width).toBeLessThan(late!.arrow.x - 4)
            expect(late!.text.x + late!.text.width).toBeGreaterThan(late!.arrow.x - 16)
            // Over two lanes, the label is beside the lane that the handoff leaves, where no bar of the middle lane is.
            expect(far!.text.y + far!.text.height).toBeLessThan(flow.y('b') - 20)
            expect(far!.text.x).toBeGreaterThan(far!.arrow.x + far!.arrow.width)
            expect(up!.text.y).toBeGreaterThan(flow.y('b') + 20)
            // With an arrow close at the right, the label goes to the left of its own arrow.
            const close = lanes(['a', 'b'], [{ from: 'a', to: 'b', at: 50, label: 'enter' }, { from: 'b', to: 'a', at: 52, label: 'leave' }], { ...sized, domain: [0, 100] })
            expect(right(close.handoffs[0]!.text!)).toBeLessThan(close.handoffs[0]!.shape.bounds().x)
            expect(close.handoffs[1]!.text!.bounds().x).toBeGreaterThan(right(close.handoffs[1]!.shape))
        }))
    })

    it('puts a mark on its lane as a dot with its label over it, and keeps the label in the time area', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['a', 'b'], [
                { lane: 'a', at: 0, label: 'the first instant' },
                { lane: 'a', at: 50, label: 'middle' },
                { lane: 'a', at: 100, label: 'the last instant' },
                { lane: 'b', start: 40, end: 60 },
                { lane: 'b', at: 50, label: 'on a bar' },
            ], sized)
            const [first, middle, last, onBar] = flow.marks.map((mark) => ({ dot: mark.shape.bounds(), text: mark.text!.bounds() }))
            expect([middle!.dot.x + middle!.dot.width / 2, middle!.dot.y + middle!.dot.height / 2]).toEqual([flow.x(50), flow.y('a')])
            expect(middle!.text.x + middle!.text.width / 2).toBeCloseTo(flow.x(50), 6)
            expect(middle!.text.y + middle!.text.height).toBeLessThan(middle!.dot.y)
            expect(middle!.text.y + middle!.text.height).toBeGreaterThan(middle!.dot.y - 12)
            expect(first!.text.x).toBeCloseTo(-500, 6)
            expect(last!.text.x + last!.text.width).toBeCloseTo(500, 6)
            // A label over a dot that is on a bar is over the bar.
            expect(onBar!.text.y + onBar!.text.height).toBeLessThan(flow.spans[0]!.shape.bounds().y)
        }))
    })

    it('ends an open span with an arrow head when it reaches the end of the domain, and gives it no outline', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['a'], [
                { lane: 'a', start: 0, end: 40 }, { lane: 'a', start: 40, end: 60, open: true }, { lane: 'a', start: 70, end: 100, open: true },
            ], sized)
            expect(flow.spans.map((span) => span.shape.get('stroke') !== null)).toEqual([true, false, false])
            expect(flow.spans.map((span) => span.tip !== null)).toEqual([false, false, true])
            const tip = flow.spans[2]!.tip!.bounds()
            expect(tip.x).toBeGreaterThan(500)
            expect(tip.x + tip.width).toBeLessThan(500 + 24)
            expect([tip.y, tip.y + tip.height]).toEqual([-20, 20])
        }))
    })

    it('draws an axis with the ticks and the format that it is given, and no axis without ticks', async () => {
        await compileFilm(film(() => {
            expect(lanes(names, events, sized).axis).toBeNull()
            const flow = lanes(names, events, { ...sized, ticks: [0, 50, 100], format: (time) => `${time} ms`, axisLabel: 'time since the exit' })
            expect(words(flow.axis!)).toEqual(['0 ms', '50 ms', '100 ms', 'time since the exit'])
            const numbers = flow.axis!.children.filter((child) => /ms$/.test((child as unknown as { source?: string }).source ?? ''))
            numbers.forEach((number, index) => {
                const box = number.bounds()
                expect(Math.abs(box.x + box.width / 2 - flow.x(index * 50))).toBeLessThan(3)
                // Under the bars of the last lane.
                expect(box.y).toBeGreaterThan(flow.y('monitor') + 20)
            })
            // A count gives round ticks inside the domain, written as plain numbers.
            expect(words(lanes(names, events, { ...sized, ticks: 4 }).axis!)).toEqual(['0', '20', '40', '60', '80', '100'])
            expect(words(lanes(['a'], [{ lane: 'a', start: 0, end: 1 }], { ticks: [0, 0.25, 0.5, 1] }).axis!)).toEqual(['0.00', '0.25', '0.50', '1.00'])
            // The cursor goes down to the line of the axis. With no axis, it stops a little under the bars of the last lane.
            const line = flow.axis!.children[0]!.bounds().y
            expect(bottom(flow.cursor)).toBeCloseTo(line, 6)
            expect(line).toBeCloseTo(flow.y('monitor') + 50, 6)
            const bare = lanes(names, events, sized)
            expect(bottom(bare.cursor)).toBeLessThan(bare.y('monitor') + 20 + 14)
            expect(bottom(bare.cursor)).toBeGreaterThan(bare.y('monitor') + 20)
            // An axis label with no ticks is a line of time that is not to scale: the line and the label, and no tick.
            const loose = lanes(names, events, { ...sized, axisLabel: 'time, not to scale' })
            expect(words(loose.axis!)).toEqual(['time, not to scale'])
            expect(loose.axis!.children).toHaveLength(2)
            expect(right(loose.axis!.children[0]!) - loose.axis!.children[0]!.bounds().x).toBe(1000)
        }))
    })

    it('enters with its names, its lanes and its axis, and shows no event and no cursor', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            flow = lanes(['a', 'b'], [{ lane: 'a', start: 0, end: 50, label: 'runs' }, { from: 'a', to: 'b', at: 50, label: 'call' }], { ...sized, domain: [0, 100], ticks: [0, 100] })
            s.wait(0.5)
            s.play(flow.enter({ lag: 1 }), { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        expect(compiled.frame(0.2).ops).toHaveLength(0)
        // With a lag of 1, the second lane starts when the first one is done.
        expect(at(0.75, () => flow.names.map(shows))).toEqual([expect.closeTo(0.5, 6), 0])
        expect(at(0.75, () => flow.rails.map((rail) => rail.get('trimTo')))).toEqual([expect.closeTo(0.5, 6), 0])
        // The axis waits for the first third of the time, then fades in.
        expect(at(0.75, () => shows(flow.axis!))).toBe(0)
        expect(at(1.2, () => shows(flow.axis!))).toBeGreaterThan(0)
        expect(at(1.2, () => shows(flow.axis!))).toBeLessThan(1)
        expect(at(1.6, () => [...flow.names, ...flow.rails, flow.axis!].map(shows))).toEqual([1, 1, 1, 1, 1])
        expect(at(1.6, () => flow.rails.map((rail) => rail.get('trimTo')))).toEqual([1, 1])
        expect(at(1.6, () => [...flow.events, flow.cursor].map(shows))).toEqual([0, 0, 0])
        // Two names of one letter, two lines, the axis line, and two ticks with one number each.
        expect(compiled.frame(1.6).ops).toHaveLength(2 + 2 + 1 + 2 + 4)
        expect(flow.time).toBe(0)
    })

    it('grows a span with the cursor, so that its right end is at the cursor at every frame of an eased advance', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(names, events, sized))
            s.wait(1)
            s.play(flow.advance(20), { duration: 2 })
            s.wait(1)
        }))
        const bar = flow.spans[0]!.shape
        // Before the first advance, no event shows and the cursor is hidden.
        expect(at(0.5, () => [...flow.events, flow.cursor].map(shows))).toEqual(Array(10).fill(0))
        for (const [time, share] of [[1.5, 0.25], [2.4, 0.7]] as const) {
            // The default ease is not linear: a quarter of the time is much less than a quarter of the way.
            const cursor = flow.x(20 * smooth(share))
            expect(at(time, () => right(bar))).toBeCloseTo(cursor, 6)
            expect(at(time, () => flow.cursor.get('x'))).toBeCloseTo(cursor, 6)
            expect(at(time, () => bar.bounds().x)).toBeCloseTo(flow.x(0), 6)
            expect(at(time, () => [flow.spans[0]!, flow.cursor].map(shows))).toEqual([1, 1])
        }
        expect(flow.x(20 * smooth(0.25))).toBeLessThan(flow.x(2))
        // The cursor stops at the time, inside the span. No other event shows.
        expect(at(3.5, () => [right(bar), flow.cursor.get('x')])).toEqual([flow.x(20), flow.x(20)])
        expect(at(3.5, () => flow.events.slice(1).map(shows))).toEqual(Array(8).fill(0))
        expect(flow.time).toBe(20)
    })

    it('shows a handoff when the cursor reaches it and not before, and its label when the arrow is drawn', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(names, events, sized))
            // From 0 to 40 at a constant speed in 2 seconds: the cursor reaches the handoff of time 30 at 1.5 s.
            s.play(flow.advance(40), { duration: 2, ease: linear })
            s.wait(1)
        }))
        const handoff = flow.handoffs[0]!, [shaft, head] = handoff.shape.children as [Node, Node]
        expect(at(1.45, () => shows(handoff))).toBe(0)
        expect(at(1.55, () => shows(handoff))).toBe(1)
        // The arrow draws from the lane that the handoff leaves: the head starts there and leads the shaft.
        expect(at(1.5, () => shaft.get('trimTo'))).toBe(0)
        expect(at(1.5, () => head.bounds().y)).toBeCloseTo(-80, 6)
        expect(at(1.6, () => shaft.get('trimTo'))).toBeGreaterThan(0)
        expect(at(1.6, () => shaft.get('trimTo'))).toBeLessThan(1)
        expect(at(1.6, () => shows(handoff.text!))).toBe(0)
        expect(at(1.75, () => [shaft.get('trimTo'), bottom(head)])).toEqual([1, -20])
        expect(at(1.75, () => shows(handoff.text!))).toBeLessThan(1)
        expect(at(2, () => shows(handoff.text!))).toBe(1)
        // The span of the next lane starts at the same time, and grows with the cursor.
        expect(at(1.45, () => shows(flow.spans[1]!))).toBe(0)
        expect(at(1.75, () => [shows(flow.spans[1]!), right(flow.spans[1]!.shape)])).toEqual([1, flow.x(35)])
        // The handoff of time 42 is after the cursor.
        expect(at(3, () => shows(flow.handoffs[1]!))).toBe(0)
    })

    it('stops the cursor early, so that a handoff at the end of an advance is complete when the advance ends', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(names, events, sized))
            s.play(flow.advance(30), { duration: 2, ease: linear })
            s.wait(1)
            s.play(flow.advance(42), { duration: 0.5, ease: linear })
        }))
        const handoff = flow.handoffs[0]!
        // The arrow and its label take half a second. The cursor has the first 1.5 s for its way.
        expect(at(0.75, () => flow.cursor.get('x'))).toBeCloseTo(flow.x(15), 6)
        expect(at(1.5, () => [flow.cursor.get('x'), right(flow.spans[0]!.shape)])).toEqual([flow.x(30), flow.x(30)])
        expect(at(1.45, () => shows(handoff))).toBe(0)
        expect(at(2, () => [shows(handoff), shows(handoff.text!), handoff.shape.children[0]!.get('trimTo')])).toEqual([1, 1, 1])
        // A stop at the start of a span shows nothing of it.
        expect(at(2.5, () => shows(flow.spans[1]!))).toBe(0)
        // The next advance starts at the time of the first handoff, and does not draw it again.
        expect(at(3.1, () => [shows(handoff.text!), handoff.shape.children[0]!.get('trimTo')])).toEqual([1, 1])
        // A short advance keeps 0.6 of its time for the cursor, and the handoff is still complete at its end.
        expect(at(3.3, () => flow.cursor.get('x'))).toBeCloseTo(flow.x(42), 6)
        expect(at(3.29, () => shows(flow.handoffs[1]!))).toBe(0)
        expect(at(3.5, () => [shows(flow.handoffs[1]!), shows(flow.handoffs[1]!.text!)])).toEqual([1, 1])
    })

    it('brings a label inside a bar when the span starts, and a label over a bar and the outline when the span is complete', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['a'], [
                { lane: 'a', start: 0, end: 50, label: 'inside' },
                { lane: 'a', start: 50, end: 54, label: 'over the bar' },
                { lane: 'a', start: 60, end: 100, label: 'goes on', open: true },
            ], sized))
            s.play(flow.advance(25), { duration: 2, ease: linear })
            s.play(flow.advance(52), { duration: 2, ease: linear })
            s.play(flow.advance(54), { duration: 1, ease: linear })
            s.play(flow.advance(100), { duration: 2, ease: linear })
        }))
        const [inside, over, open] = flow.spans
        // The label inside is there after 0.3 s, long before the bar is as long as the label.
        expect(at(0.15, () => shows(inside!.text!))).toBeCloseTo(0.5, 6)
        expect(at(0.3, () => [shows(inside!.text!), right(inside!.shape)])).toEqual([1, flow.x(3.75)])
        // A span that grows has no outline. The outline comes when the cursor reaches its end.
        expect(at(2, () => inside!.shape.get('strokeOpacity'))).toBe(0)
        expect(at(4, () => inside!.shape.get('strokeOpacity'))).toBe(1)
        // The second span is not complete at 52: its bar shows, and its label does not.
        expect(at(4, () => [shows(over!), right(over!.shape), shows(over!.text!), over!.shape.get('strokeOpacity')])).toEqual([1, flow.x(52), 0, 0])
        expect(at(4.69, () => shows(over!.text!))).toBe(0)
        expect(at(5, () => [right(over!.shape), shows(over!.text!), over!.shape.get('strokeOpacity')])).toEqual([flow.x(54), 1, 1])
        // The arrow head of an open span comes when the span reaches the end of the domain.
        expect(at(6, () => [shows(open!), shows(open!.tip!)])).toEqual([1, 0])
        expect(at(7, () => [right(open!.shape), shows(open!.tip!)])).toEqual([flow.x(100), 1])
    })

    it('chains two advances in one sequence, keeps the time of the cursor, and refuses to go back', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(names, events, sized))
            expect(flow.time).toBe(0)
            const first = flow.advance(30), second = flow.advance(50)
            // The time moves when an advance is scheduled, not when it is made.
            expect(flow.time).toBe(0)
            s.play(seq(first, second), { duration: 2, ease: linear })
            expect(flow.time).toBe(50)
            expect(() => flow.advance(49)).toThrow(/cannot advance to 49\. The cursor is at 50, and it does not go back/)
            expect(() => flow.advance(101)).toThrow(/cannot advance to 101\. The domain is 0 to 100/)
            expect(() => flow.advance(Number.NaN)).toThrow(/cannot advance to NaN/)
            // The second of two advances in one sequence is checked when it is scheduled.
            expect(() => s.play(seq(flow.advance(60), flow.advance(55)))).toThrow(/cannot advance to 55\. The cursor is at 60/)
            // An advance to the time of the cursor is not a step back.
            s.play(flow.advance(60), { duration: 0.5 })
            expect(flow.time).toBe(60)
        }))
        // The second advance starts where the first one stops: at 30 after one second, then on to 50.
        expect(at(1, () => flow.cursor.get('x'))).toBeCloseTo(flow.x(30), 6)
        expect(at(1.5, () => flow.cursor.get('x'))).toBeGreaterThan(flow.x(35))
        expect(at(1.5, () => flow.cursor.get('x'))).toBeLessThan(flow.x(50))
        expect(at(2, () => [flow.cursor.get('x'), right(flow.spans[2]!.shape)])).toEqual([flow.x(50), flow.x(50)])
        expect(at(2, () => flow.events.map(shows))).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0])
    })

    it('shows a handoff exactly when the cursor is at its time or past it, at every frame of an eased advance', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(names, events, sized))
            s.play(flow.showAll(), { duration: 4 })
        }))
        const seen = new Set<boolean>()
        for (let frame = 0; frame <= 80; frame++) {
            const time = frame / 20
            const cursor = at(time, () => flow.cursor.get('x'))
            for (const [handoff, when] of [[flow.handoffs[0]!, 30], [flow.handoffs[2]!, 70]] as const) {
                if (Math.abs(cursor - flow.x(when)) < 0.5) continue
                expect(at(time, () => shows(handoff) > 0)).toBe(cursor > flow.x(when))
                seen.add(cursor > flow.x(when))
            }
        }
        expect([...seen].sort()).toEqual([false, true])
        // The default ease is slow at its two ends: the cursor reaches 30 after more than 0.3 of the time.
        expect(at(1.3, () => shows(flow.handoffs[0]!))).toBe(0)
    })

    it('shows a mark when the cursor reaches it, and a mark at the first end of the domain on the first advance', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['a'], [{ lane: 'a', at: 0, label: 'start' }, { lane: 'a', at: 50, label: 'tick' }], { ...sized, domain: [0, 100] }))
            s.wait(1)
            s.play(flow.advance(0), { duration: 1 })
            s.play(flow.advance(100), { duration: 2, ease: linear })
        }))
        const [first, second] = flow.marks
        expect(at(0.9, () => [first!, second!, flow.cursor].map(shows))).toEqual([0, 0, 0])
        // The dot comes first, then its label. Both are complete after half a second.
        expect(at(1.02, () => shows(first!.shape))).toBeLessThan(0.2)
        // The dot grows as it comes: it starts at 0.3 of its size.
        expect(at(1, () => first!.shape.get('sx'))).toBeCloseTo(0.3, 6)
        expect(at(1.1, () => first!.shape.get('sx'))).toBeGreaterThan(0.3)
        expect(at(1.1, () => first!.shape.get('sx'))).toBeLessThan(1)
        // The cursor fades in over the first 0.3 s of the first advance.
        expect(at(1.1, () => shows(flow.cursor))).toBeGreaterThan(0)
        expect(at(1.1, () => shows(flow.cursor))).toBeLessThan(1)
        expect(at(1.3, () => shows(flow.cursor))).toBe(1)
        expect(at(1.1, () => shows(first!.shape))).toBeGreaterThan(0)
        expect(at(1.1, () => shows(first!.text!))).toBe(0)
        expect(at(1.5, () => [shows(first!), shows(first!.shape), shows(first!.text!), first!.shape.get('sx')])).toEqual([1, 1, 1, 1])
        expect(at(2, () => [shows(second!), flow.cursor.get('x')])).toEqual([0, flow.x(0)])
        // The cursor is at 50 after one second of the second advance.
        expect(at(2.95, () => shows(second!))).toBe(0)
        expect(at(3.05, () => shows(second!))).toBe(1)
        expect(at(3.5, () => [shows(second!.shape), shows(second!.text!)])).toEqual([1, 1])
        // The first mark is not shown again.
        expect(at(2.1, () => [shows(first!.shape), shows(first!.text!)])).toEqual([1, 1])
    })

    it('hides the line of a lane behind a bar, as far as the bar goes', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(names, events, sized))
            s.play(flow.advance(20), { duration: 1 })
            s.wait(1)
        }))
        const ops = compiled.frame(1.5).ops.filter((op): op is PathOp => op.kind === 'path')
        const line = ops.findIndex((op) => op.node === flow.rails[0]), bar = ops.findIndex((op) => op.node === flow.spans[0]!.shape)
        expect(line).toBeGreaterThanOrEqual(0)
        expect(bar).toBeGreaterThan(line)
        // The bar lets what is under it show through. A shape of the same outline is under it, and nothing shows through that one.
        expect(ops[bar]!.fillAlpha).toBeLessThan(0.9)
        const under = ops.slice(line + 1, bar).filter((op) => op.fillAlpha === 1 && pathBounds(op.path)!.width === pathBounds(ops[bar]!.path)!.width)
        expect(under).toHaveLength(1)
        expect(pathBounds(under[0]!.path)).toEqual(pathBounds(ops[bar]!.path))
        expect(pathBounds(ops[bar]!.path)!.width).toBeCloseTo(200, 6)
    })

    it('shows every event with showAll, at once when the film gives it no time', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(names, events, sized))
            s.wait(1)
            s.play(flow.showAll(), { duration: 0 })
            s.wait(1)
        }))
        expect(flow.time).toBe(100)
        const before = compiled.frame(0.5).ops.length
        expect(at(0.9, () => flow.events.map(shows))).toEqual(Array(9).fill(0))
        expect(at(1, () => [...flow.events, ...flow.events.flatMap((event) => (event.text ? [event.text] : [])), flow.spans[4]!.tip!, flow.cursor].map(shows))).toEqual(Array(18).fill(1))
        expect(at(1, () => flow.cursor.get('x'))).toBe(flow.x(100))
        expect(at(1, () => flow.spans.map((span) => right(span.shape)))).toEqual([30, 42, 70, 78, 100].map((time) => flow.x(time)))
        expect(at(1, () => flow.handoffs.map((handoff) => handoff.shape.children[0]!.get('trimTo')))).toEqual([1, 1, 1, 1])
        expect(compiled.frame(1.5).ops.length).toBeGreaterThan(before + 60)
    })

    it('keeps the cursor and the lines of the lanes behind the labels, so that the film check finds no line through a text', async () => {
        const report = await checkFilm(film({ fps: 20 }, (s) => {
            // At 50 the cursor is behind the label of the handoff of time 42 and the label inside the bar that grows.
            const flow = s.add(lanes(names, events, sized).at(60, 0))
            s.play(flow.advance(50), { duration: 1 })
            s.wait(1)
        }))
        expect(report.diagnostics).toEqual([])
        // The same stop with marks: the cursor is behind the label of the mark that it stops at.
        const marked = await checkFilm(film({ fps: 20 }, (s) => {
            const flow = s.add(lanes(['a', 'b'], [{ lane: 'a', start: 0, end: 60, label: 'runs' }, { lane: 'b', at: 40, label: 'interrupt' }], sized).at(60, 0))
            s.play(flow.advance(40), { duration: 1 })
            s.wait(1)
        }))
        expect(marked.diagnostics).toEqual([])
    })

    it('gives a copy its own events, which advance without the first object', async () => {
        let flow!: Lanes<LaneTimelineEvent>, copy!: Lanes<LaneTimelineEvent>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            flow = lanes(names, events, sized)
            copy = flow.clone()
            expect(copy.events[0]).not.toBe(flow.events[0])
            expect(copy.children).toContain(copy.events[0])
            expect(copy.spans[0]).toBe(copy.events[0])
            expect(copy.events[0]!.shape.parent).toBe(copy.events[0])
            s.add(flow, copy.at(0, 400))
            s.play(copy.advance(50), { duration: 1 })
        }))
        expect([flow.time, copy.time]).toEqual([0, 50])
        expect(at(1, () => flow.events.map(shows))).toEqual(Array(9).fill(0))
        expect(at(1, () => copy.events.map(shows))).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0])
        // Nothing of the first object is in the picture but its names and its lines: 15 letters and 3 lines.
        const upper = compiled.frame(1).ops.filter((op): op is PathOp => op.kind === 'path').filter((op) => pathBounds(op.path)!.y < 540 + 150)
        expect(upper).toHaveLength(18)
    })

    it('draws a boundary between two lanes that are neighbors, moves the two lanes apart, and puts its label after the right end of the line', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['user', 'kernel', 'drive'], [{ lane: 'user', start: 0, end: 100 }], {
                ...sized, size: 26, boundaries: [{ between: ['user', 'kernel'], label: 'system call line' }, { between: ['drive', 'kernel'], color: 'purple' }],
            })
            // Each boundary adds 1.25 of the text size to the distance of its two lanes. The first lane and the last one stay at the same distance from 0.
            expect(flow.y('kernel') - flow.y('user')).toBeCloseTo(100 + 26 * 1.25, 6)
            expect(flow.y('drive') - flow.y('kernel')).toBeCloseTo(100 + 26 * 1.25, 6)
            expect(flow.y('user')).toBeCloseTo(-flow.y('drive'), 6)
            expect(lanes(['user', 'kernel', 'drive'], [{ lane: 'user', start: 0, end: 100 }], { ...sized, boundaries: [{ between: ['user', 'kernel'] }] }).y('drive') - flow.y('drive')).toBeCloseTo(-26 * 1.25 / 2, 6)
            expect(flow.boundaries).toHaveLength(2)
            const [rule, label] = flow.boundaries[0]!.children
            const line = rule!.bounds()
            // The line is along the whole time area, in the middle between the bars of the two lanes.
            expect([line.x, line.x + line.width]).toEqual([-500, 500])
            expect(line.y).toBeCloseTo((flow.y('user') + 20 + flow.y('kernel') - 20) / 2, 6)
            expect(rule!.get('dash')).not.toBeNull()
            const paint = (color: string) => rect(1, 1, { fill: color, stroke: null }).get('fill')
            expect(rule!.get('stroke')).toEqual(paint('yellow'))
            expect(flow.boundaries[1]!.children[0]!.get('stroke')).toEqual(paint('purple'))
            // The label has room of its own after the right end of the time area, at the height of the line, as a name has before the left end.
            expect((label as unknown as { source: string }).source).toBe('system call line')
            expect(label!.bounds().x).toBeCloseTo(500 + 26 * 0.9, 6)
            expect(Math.abs(label!.bounds().y + label!.bounds().height / 2 - line.y)).toBeLessThan(6)
            // A boundary with no label and no count is a line and no more.
            expect(flow.boundaries[1]!.children).toHaveLength(1)
            expect(flow.counters).toEqual([null, null])
        }))
    })

    it('counts the handoffs that cross a boundary, up to the time of the cursor, and shows the number and a tick for each one', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['user', 'kernel', 'drive'], [
                { from: 'user', to: 'kernel', at: 10 },
                { from: 'kernel', to: 'drive', at: 20, dashed: true },
                // From the last lane to the first: this handoff crosses the two boundaries.
                { from: 'drive', to: 'user', at: 30 },
                { from: 'kernel', to: 'user', at: 40, dashed: true },
            ], { ...sized, domain: [0, 100], boundaries: [{ between: ['user', 'kernel'], label: 'system call line', count: true }, { between: ['drive', 'kernel'], label: 'device' }] }))
            expect([flow.crossings(0), flow.crossings('system call line'), flow.crossings(1), flow.crossings('device')]).toEqual([0, 0, 0, 0])
            // At a constant speed, the cursor reaches 10 after 0.75 s and 20 after 1.5 s: it stops early for the arrow of 20.
            s.play(flow.advance(25), { duration: 2, ease: linear })
            expect([flow.crossings(0), flow.crossings('device')]).toEqual([1, 1])
            s.play(flow.showAll(), { duration: 2 })
            expect([flow.crossings('system call line'), flow.crossings(1)]).toEqual([3, 2])
            expect(() => flow.crossings('wall')).toThrow(/no boundary "wall"\. The boundaries are 0 \("system call line"\), 1 \("device"\)/)
            expect(() => flow.crossings(2)).toThrow(/no boundary 2/)
        }))
        // The counter is after the label, at the right end. Only the first boundary counts.
        const counter = flow.counters[0]!, label = flow.boundaries[0]!.children[1]!
        expect(flow.counters[1]).toBeNull()
        expect(flow.boundaries[0]!.children[2]).toBe(counter)
        const shown = (time: number) => at(time, () => counter.children.filter((value) => value.get('visible')).map((value) => (value as unknown as { source: string }).source))
        expect(shown(0)).toEqual(['0'])
        expect(at(0, () => label.bounds().x)).toBeGreaterThan(500 + 8)
        expect(at(0, () => right(label))).toBeLessThan(at(0, () => counter.children[0]!.bounds().x) - 8)
        // The number goes up at the moment the cursor passes the handoff. A dashed handoff over the other boundary does not move it.
        expect(shown(0.7)).toEqual(['0'])
        expect(shown(0.8)).toEqual(['1'])
        expect(shown(1.9)).toEqual(['1'])
        expect(shown(4)).toEqual(['3'])
        // The handoff leaves a tick where its arrow passes a line that counts: on the first boundary, and not on the second.
        const [first, second, third] = flow.handoffs
        expect([first!.children.length, second!.children.length, third!.children.length]).toEqual([2, 1, 2])
        const tick = first!.children[1]!
        expect(at(0, () => [tick.bounds().x + tick.bounds().width / 2, tick.bounds().y + tick.bounds().height / 2])).toEqual([flow.x(10), flow.boundaries[0]!.children[0]!.bounds().y])
        expect(at(0.8, () => shows(tick))).toBe(0)
        expect(at(1.1, () => [shows(first!), shows(tick)])).toEqual([1, 1])
        // A dashed handoff has an arrow of dashes. The others have a solid line.
        expect(flow.handoffs.map((handoff) => handoff.shape.children[0]!.get('dash') !== null)).toEqual([false, true, false, true])
    })

    it('hides the cursor behind an arrow of dashes, so that a cursor that stops at the handoff does not fill the gaps', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['a', 'b'], [{ from: 'a', to: 'b', at: 50, dashed: true }, { from: 'b', to: 'a', at: 80 }], { ...sized, domain: [0, 100] }))
            s.play(flow.advance(50), { duration: 1 })
            s.wait(1)
            s.play(flow.advance(80), { duration: 1 })
            s.wait(1)
        }))
        const strip = (time: number, handoff: number) => {
            const ops = compiled.frame(time).ops.filter((op): op is PathOp => op.kind === 'path')
            const cursor = ops.findIndex((op) => op.node === flow.cursor), shaft = ops.findIndex((op) => op.node === flow.handoffs[handoff]!.shape.children[0])
            expect(cursor).toBeGreaterThanOrEqual(0)
            expect(shaft).toBeGreaterThan(cursor)
            const arrow = flow.handoffs[handoff]!.shape.bounds()
            // A line that nothing shows through, wider than the arrow, over the cursor and under the arrow, from one end of the arrow to the other.
            return ops.slice(cursor + 1, shaft).filter((op) => {
                const box = pathBounds(op.strokePath)
                return box !== null && op.strokeAlpha === 1 && op.strokeWidth > ops[shaft]!.strokeWidth && Math.abs(box.x - (960 + arrow.x + arrow.width / 2)) < 0.01 && box.y <= 540 + arrow.y && box.y + box.height >= 540 + arrow.y + arrow.height
            }).length
        }
        expect(strip(1.5, 0)).toBe(1)
        // A solid arrow covers the cursor by itself.
        expect(strip(3.5, 1)).toBe(0)
    })

    it('counts in the order of time when the events are in another order, and brings a boundary in with the lane under it', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = lanes(['user', 'kernel'], [
                { from: 'kernel', to: 'user', at: 60 },
                { from: 'user', to: 'kernel', at: 20 },
                { from: 'user', to: 'kernel', at: 80 },
                { from: 'kernel', to: 'user', at: 40 },
            ], { ...sized, domain: [0, 100], boundaries: [{ between: ['user', 'kernel'], label: 'line', count: true }] })
            s.play(flow.enter({ lag: 1 }), { duration: 1, ease: linear })
            s.play(flow.advance(90), { duration: 9, ease: linear })
        }))
        const [rule, label, counter] = flow.boundaries[0]!.children
        // With a lag of 1, the second lane has the second half of the time. The line and its text come with it.
        expect(at(0.4, () => [rule!.get('trimTo'), shows(label!), shows(counter!)])).toEqual([0, 0, 0])
        expect(at(0.75, () => [rule!.get('trimTo'), shows(label!), shows(counter!)])).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.5, 6), expect.closeTo(0.5, 6)])
        expect(at(1, () => [rule!.get('trimTo'), shows(label!), shows(counter!)])).toEqual([1, 1, 1])
        // The cursor passes one unit of time in a tenth of a second: 20 at 3 s, 40 at 5 s, 60 at 7 s, 80 at 9 s.
        const shown = (time: number) => at(time, () => counter!.children.filter((value) => value.get('visible')).map((value) => (value as unknown as { source: string }).source))
        expect([2.9, 3.1, 4.9, 5.1, 6.9, 7.1, 8.9, 9.1].map(shown)).toEqual([['0'], ['1'], ['1'], ['2'], ['2'], ['3'], ['3'], ['4']])
        expect(flow.crossings('line')).toBe(4)
    })

    it('puts the label of a handoff that crosses a boundary beside the lane that it leaves, and no label on the line', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['user', 'kernel'], [
                { lane: 'user', start: 0, end: 20 },
                { from: 'user', to: 'kernel', at: 20, label: 'read' },
                { lane: 'kernel', start: 20, end: 50, label: 'works' },
                { from: 'kernel', to: 'user', at: 50, label: 'returns' },
                { lane: 'kernel', start: 80, end: 82, label: 'over its bar' },
            ], { ...sized, size: 26, domain: [0, 100], boundaries: [{ between: ['user', 'kernel'], label: 'system call line', count: true }] })
            const line = flow.boundaries[0]!.children[0]!.bounds().y
            const [down, up] = flow.handoffs.map((handoff) => handoff.text!.bounds())
            // On the way down, the label is over the line, under the bars of the upper lane. On the way up, it is under the line.
            expect(down!.y).toBeGreaterThan(flow.y('user') + 20 + 4)
            expect(down!.y + down!.height).toBeLessThan(line - 4)
            expect(up!.y).toBeGreaterThan(line + 4)
            expect(up!.y + up!.height).toBeLessThan(flow.y('kernel') - 20 - 4)
            // A label over a bar of the lower lane stays under the line.
            expect(flow.spans[2]!.text!.bounds().y).toBeGreaterThan(line + 4)
        }))
    })

    it('refuses a boundary that is not between two neighbors, and takes a handoff at the last end of the domain beside a boundary with a label', async () => {
        await compileFilm(film(() => {
            const span = { lane: 'a', start: 0, end: 10 }
            expect(() => lanes(['a', 'b', 'c'], [span], { boundaries: [{ between: ['a', 'c'] }] })).toThrow(/boundary 0 is between the lanes "a" and "c", which are not neighbors\. A boundary is a line between two lanes that are next to each other/)
            expect(() => lanes(['a', 'b'], [span], { boundaries: [{ between: ['a', 'a'] }] })).toThrow(/which are not neighbors/)
            expect(() => lanes(['a', 'b'], [span], { boundaries: [{ between: ['a', 'x'] }] })).toThrow(/boundary 0 names the lane "x"\. The lanes are 0 \("a"\), 1 \("b"\)/)
            expect(() => lanes(['a', 'b'], [span], { boundaries: [{ between: ['a', 'b'] }, { between: [1, 0] }] })).toThrow(/boundaries 0 and 1 are between the same two lanes/)
            expect(() => lanes(['a', 'b'], [span]).crossings(0)).toThrow(/no boundary 0\. The object has no boundary/)
            // The label and the number of a boundary are outside the time area. So a handoff may be at the last end of the domain, with no room after it.
            for (const boundary of [{ label: 'line' }, { count: true }, { label: 'line', count: true }, {}]) {
                const last = lanes(['a', 'b'], [{ lane: 'a', start: 0, end: 100 }, { from: 'a', to: 'b', at: 100, label: 'call' }], { ...sized, boundaries: [{ between: ['a', 'b'], ...boundary }] })
                expect(last.handoffs[0]!.shape.bounds().x + last.handoffs[0]!.shape.bounds().width / 2).toBeCloseTo(500, 6)
                for (const word of last.boundaries[0]!.children.slice(1)) expect(word.bounds().x).toBeGreaterThan(500 + 8)
            }
            // With too little room, a label would touch the line.
            expect(() => lanes(['a', 'b'], [{ lane: 'a', start: 0, end: 50 }, { from: 'a', to: 'b', at: 50, label: 'lgy' }], { ...sized, size: 26, pitch: 64, domain: [0, 100], boundaries: [{ between: ['a', 'b'] }] })).toThrow(/the label of event 1 \("lgy"\) touches the (bar of event 0|line of boundary 0)/)
            // A label over a bar of the lower lane, with no bar over it: it would touch the line and nothing else.
            const lower = (pitch: number) => lanes(['a', 'b'], [{ lane: 'b', start: 50, end: 52, label: 'lgy' }], { ...sized, size: 26, pitch, domain: [0, 100], boundaries: [{ between: ['a', 'b'], label: 'wall' }] })
            expect(() => lower(64)).toThrow(/the label of event 0 \("lgy"\) touches the line of boundary 0 \("wall"\)\. Use a wider width, a larger pitch/)
            expect(lower(100).spans[0]!.text!.bounds().y).toBeGreaterThan(lower(100).boundaries[0]!.children[0]!.bounds().y + 3)
        }))
    })

    it('draws an idle span as an outline of dashes with a faint fill, with no right end while it grows', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        const film_ = film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['thread'], [
                { lane: 'thread', start: 0, end: 20, label: 'runs' },
                { lane: 'thread', start: 20, end: 60, label: 'sleeps', idle: true },
                { lane: 'thread', start: 70, end: 100, idle: true, open: true },
            ], sized).at(60, 0))
            // The cursor stops in the idle span, where the label is: the right end of the outline would be a line through the text.
            s.play(flow.advance(24), { duration: 1, ease: linear })
            s.wait(1)
            s.play(flow.advance(60), { duration: 1, ease: linear })
            s.play(flow.showAll(), { duration: 1, ease: linear })
            s.wait(0.5)
        })
        const report = await checkFilm(film_)
        expect(report.diagnostics).toEqual([])
        const [solid, idle, open] = flow.spans
        // A solid span has its own outline. An idle span has a faint fill, and its outline is a second shape, of dashes.
        expect([solid!.edge, solid!.shape.get('stroke') !== null]).toEqual([null, true])
        expect(idle!.shape.get('stroke')).toBeNull()
        expect(at(4, () => idle!.shape.get('fillOpacity'))).toBeLessThan(at(4, () => solid!.shape.get('fillOpacity')) / 2)
        expect(idle!.edge!.get('dash')).not.toBeNull()
        // The outline grows with the bar, and it is there from the start of the span.
        expect(at(1.5, () => [shows(idle!), shows(idle!.edge!), right(idle!.shape), right(idle!.edge!)])).toEqual([1, 1, 60 + flow.x(24), 60 + flow.x(24)])
        expect(at(1.5, () => idle!.edge!.bounds().x)).toBeCloseTo(60 + flow.x(20), 6)
        // While the span grows, the outline is its left end, its top and its bottom. Its right end comes when the span is complete.
        expect(at(1.5, () => idle!.edge!.get('path')!.length)).toBe(3)
        // The cursor reaches the end of the span at 2.7 s: it stops 0.3 s early for what closes the span.
        expect(at(2.65, () => idle!.edge!.get('path')!.length)).toBe(3)
        expect(at(2.75, () => [idle!.edge!.get('path')!.length, right(idle!.edge!)])).toEqual([4, 60 + flow.x(60)])
        // The bar of an idle span has a square corner at its right end while it grows, where its outline has no end. When the span is complete, the corner is round.
        const corner = (node: Node, x: number, y: number) => {
            const points = node.get('path')![0]!.p
            for (let k = 0; k + 1 < points.length; k += 2) if (Math.abs(points[k]! - x) < 1e-6 && Math.abs(points[k + 1]! - y) < 1e-6) return true
            return false
        }
        expect(at(1.5, () => corner(idle!.shape, flow.x(24), -20))).toBe(true)
        expect(at(3.5, () => corner(idle!.shape, flow.x(60), -20))).toBe(false)
        expect(at(3.5, () => corner(solid!.shape, flow.x(20), -20))).toBe(false)
        // An open idle span never gets a right end. At the end of the domain, it gets an arrow head of dashes.
        expect(at(4.4, () => [open!.edge!.get('path')!.length, right(open!.edge!), shows(open!.tip!)])).toEqual([3, 60 + flow.x(100), 1])
        expect(open!.tip!.get('dash')).not.toBeNull()
        expect(solid!.tip).toBeNull()
    })

    it('draws the bars, then the boundaries, then the arrows, then the dots, whatever the order of the list', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            // The mark and the handoff are on the bar of the middle lane, and are listed before it.
            flow = s.add(lanes(['a', 'b', 'c'], [
                { lane: 'b', at: 30, color: 'yellow' },
                { from: 'a', to: 'c', at: 60 },
                { lane: 'b', start: 10, end: 90 },
            ], { ...sized, domain: [0, 100], boundaries: [{ between: ['a', 'b'] }] }))
            s.play(flow.showAll(), { duration: 0 })
            s.wait(1)
        }))
        const ops = compiled.frame(0.5).ops.filter((op): op is PathOp => op.kind === 'path')
        const place = (node: Node) => ops.findIndex((op) => op.node === node)
        const drawn = [flow.rails[1]!, flow.spans[0]!.shape, flow.boundaries[0]!.children[0]!, flow.handoffs[0]!.shape.children[0]!, flow.marks[0]!.shape].map(place)
        expect(Math.min(...drawn)).toBeGreaterThanOrEqual(0)
        expect(drawn).toEqual([...drawn].sort((a, b) => a - b))
        // The list keeps the order that the film gave.
        expect(flow.events.map((event) => event.kind)).toEqual(['mark', 'handoff', 'span'])
    })

    it('gives the labels their places in the order of time, so that the order of the list changes nothing', async () => {
        await compileFilm(film(() => {
            const options = { ...sized, domain: [0, 100] as [number, number] }
            const first = { from: 0, to: 1, at: 40, label: 'aaaaa' }, second = { from: 1, to: 0, at: 50, label: 'bbbb' }, third = { from: 0, to: 1, at: 53 }
            const outcome = (list: LaneEvent[]) => {
                try {
                    return lanes(['a', 'b'], list, options).events.filter((event) => event.text).map((event) => `${(event.text as unknown as { source: string }).source} at ${Math.round(event.text!.bounds().x)}`).sort()
                } catch (error) {
                    return (error as Error).message.replace(/event \d+/g, 'event')
                }
            }
            // In the order of time, the first label takes the place at the right of its arrow, and the second label has no place left.
            expect(outcome([first, second, third])).toBe('lanes: the label of event ("bbbb") touches the arrow of event. Use a wider width, a larger pitch, shorter labels, times that are further apart, or another labelSide')
            expect(outcome([second, first, third])).toEqual(outcome([first, second, third]))
            expect(outcome([third, second, first])).toEqual(outcome([first, second, third]))
            // The film settles it: the first label at the left of its arrow leaves the room between the two arrows to the second.
            const settled = lanes(['a', 'b'], [{ ...first, labelSide: 'left' }, second, third], options)
            expect(right(settled.handoffs[0]!.text!)).toBeLessThan(settled.handoffs[0]!.shape.bounds().x)
            expect(right(settled.handoffs[1]!.text!)).toBeLessThan(settled.handoffs[1]!.shape.bounds().x)
            expect(settled.handoffs[1]!.text!.bounds().x).toBeGreaterThan(right(settled.handoffs[0]!.shape))
            // Two orders of a list that has a layout give the same layout.
            const far = [{ from: 0, to: 1, at: 20, label: 'aaaaa' }, { from: 1, to: 0, at: 60, label: 'bbbb' }]
            expect(outcome([far[1]!, far[0]!])).toEqual(outcome(far))
            expect(outcome(far)).toHaveLength(2)
        }))
    })

    it('puts a label at the side that the film names: over, under, left or right', async () => {
        await compileFilm(film(() => {
            const options = { ...sized, size: 26, domain: [0, 100] as [number, number] }
            // A short span at the foot of an arrow has no room for a label over it. Under it, and beside it, there is room.
            const short = (labelSide?: 'left' | 'right' | 'over' | 'under') => lanes(['a', 'b'], [{ from: 0, to: 1, at: 50 }, { lane: 1, start: 50, end: 54, label: 'handles it', labelSide }], options).spans[0]!
            expect(() => short()).toThrow(/the label of event 1 \("handles it"\) touches the arrow of event 0/)
            expect(() => short('over')).toThrow(/touches the arrow of event 0/)
            const under = short('under'), after = short('right'), before = short('left')
            expect(under.text!.bounds().y).toBeGreaterThan(bottom(under.shape) + 3)
            expect(under.text!.bounds().x).toBeCloseTo(under.shape.bounds().x, 6)
            // Beside the bar, the label is on the lane, at the height of the bar.
            expect(after.text!.bounds().x).toBeGreaterThan(right(after.shape) + 4)
            expect(after.text!.bounds().x).toBeLessThan(right(after.shape) + 16)
            expect(Math.abs(after.text!.bounds().y + after.text!.bounds().height / 2 - 50)).toBeLessThan(6)
            expect(right(before.text!)).toBeLessThan(before.shape.bounds().x - 4)
            // A label that fits inside its bar goes over the bar when the film says so.
            const wide = lanes(['a'], [{ lane: 0, start: 0, end: 50, label: 'fits', labelSide: 'over' }], options).spans[0]!
            expect(bottom(wide.text!)).toBeLessThan(wide.shape.bounds().y)
            // A handoff: at the left of its arrow with room at the right, and over or under the boundary that it crosses.
            const cross = (labelSide?: 'left' | 'right' | 'over' | 'under') => lanes(['a', 'b'], [{ from: 0, to: 1, at: 50, label: 'call', labelSide }], { ...options, boundaries: [{ between: [0, 1] }] })
            const line = cross().boundaries[0]!.children[0]!.bounds().y
            expect(right(cross('left').handoffs[0]!.text!)).toBeLessThan(cross('left').handoffs[0]!.shape.bounds().x)
            expect(cross('right').handoffs[0]!.text!.bounds().x).toBeGreaterThan(right(cross('right').handoffs[0]!.shape))
            expect(bottom(cross().handoffs[0]!.text!)).toBeLessThan(line)
            expect(bottom(cross('over').handoffs[0]!.text!)).toBeLessThan(line)
            expect(cross('under').handoffs[0]!.text!.bounds().y).toBeGreaterThan(line)
            expect(() => lanes(['a', 'b'], [{ from: 0, to: 1, at: 50, label: 'call', labelSide: 'under' }], options)).toThrow(/event 0 \("call"\) has the labelSide 'under'\. The label of a handoff is at the 'left' or at the 'right' of its arrow/)
            // A mark: under its dot, or beside it.
            const mark = (labelSide?: 'left' | 'right' | 'over' | 'under') => lanes(['a'], [{ lane: 0, at: 50, label: 'irq', labelSide }], options).marks[0]!
            expect(bottom(mark().text!)).toBeLessThan(mark().shape.bounds().y)
            expect(bottom(mark('over').text!)).toBeLessThan(mark('over').shape.bounds().y)
            expect(mark('under').text!.bounds().y).toBeGreaterThan(bottom(mark('under').shape))
            expect(mark('right').text!.bounds().x).toBeGreaterThan(right(mark('right').shape) + 4)
            expect(right(mark('left').text!)).toBeLessThan(mark('left').shape.bounds().x - 4)
            // A label under the last lane must not touch the axis.
            expect(() => lanes(['a'], [{ lane: 0, start: 0, end: 50, label: 'fits', labelSide: 'under' }], { ...options, ticks: 2 })).toThrow(/the label of event 0 \("fits"\) touches the axis/)
            expect(() => lanes(['a'], [{ lane: 0, at: 5, label: 'x', labelSide: 'top' as never }], options)).toThrow(/event 0 has the labelSide "top"\. Use 'left', 'right', 'over' or 'under'/)
        }))
    })

    it('paints its patches in the backing color that it is given, and draws none with null', async () => {
        const paint = (color: string) => rect(1, 1, { fill: color, stroke: null }).get('fill')
        const marked: LaneEvent[] = [...events, { lane: 'KVM', at: 50, label: 'tick' }, { from: 'guest', to: 'monitor', at: 90, dashed: true }]
        const count = async (backing: string | null | undefined, color: string) => {
            let flow!: Lanes<LaneTimelineEvent>
            const compiled = await compileFilm(film({ fps: 20 }, (s) => {
                flow = s.add(lanes(names, marked, { ...sized, ...(backing === undefined ? {} : { backing }) }))
                s.play(flow.showAll(), { duration: 0 })
                s.wait(1)
            }))
            const ops = compiled.frame(0.5).ops.filter((op): op is PathOp => op.kind === 'path')
            const same = (value: unknown) => JSON.stringify(value) === JSON.stringify(paint(color))
            // Filled patches behind the bars and the labels, the strip behind the arrow of dashes, and the rim of the dot.
            return { fills: ops.filter((op) => op.fillAlpha === 1 && same(op.fill)).length, strips: ops.filter((op) => !op.fill && op.strokeAlpha === 1 && same(op.stroke)).length, rim: flow.marks[0]!.shape.get('stroke') }
        }
        // Five bars, and eight labels: seven of the sequence and the label of the mark.
        expect(await count(undefined, 'bg')).toEqual({ fills: 13, strips: 1, rim: paint('bg') })
        expect(await count('surface', 'surface')).toEqual({ fills: 13, strips: 1, rim: paint('surface') })
        expect(await count('surface', 'bg')).toMatchObject({ fills: 0, strips: 0 })
        expect(await count(null, 'bg')).toEqual({ fills: 0, strips: 0, rim: null })
    })

    it('draws no cursor with cursor: false, and still shows the events at their times', async () => {
        let flow!: Lanes<LaneTimelineEvent>, plain!: Lanes<LaneTimelineEvent>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(names, events, { ...sized, cursor: false }))
            plain = s.add(lanes(names, events, sized).at(0, 400))
            s.play(flow.advance(30), plain.advance(30), { duration: 1, ease: linear })
            s.play(flow.advance(50), plain.advance(50), { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        for (const time of [0, 0.25, 0.5, 1, 1.5, 2, 2.4]) {
            expect(at(time, () => shows(flow.cursor))).toBe(0)
            expect(compiled.frame(time).ops.some((op) => op.kind === 'path' && op.node === flow.cursor)).toBe(false)
            // All the rest is as with a cursor: the same events show, and the bars are as long.
            expect(at(time, () => flow.events.map(shows))).toEqual(at(time, () => plain.events.map(shows)))
            expect(at(time, () => flow.spans.map((span) => right(span.shape)))).toEqual(at(time, () => plain.spans.map((span) => right(span.shape))))
        }
        expect(at(2.4, () => shows(plain.cursor))).toBe(1)
        expect(at(2.4, () => flow.events.map(shows))).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0])
        expect(flow.time).toBe(50)
    })

    it('keeps the cursor and the bars in the range of the advance, and never moves them back, with an ease that passes its end or bounces', async () => {
        const overshoot = (t: number) => { const x = t - 1; return x * x * (2.70158 * x + 1.70158) + 1 }
        const bounce = (t: number) => {
            if (t < 1 / 2.75) return 7.5625 * t * t
            if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75
            if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375
            return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375
        }
        const back = (t: number) => Math.sin(t * Math.PI)
        for (const ease of [overshoot, bounce, back]) {
            let flow!: Lanes<LaneTimelineEvent>
            await compileFilm(film({ fps: 20 }, (s) => {
                flow = s.add(lanes(names, events, sized))
                s.play(flow.advance(36), { duration: 2, ease })
                s.play(flow.advance(74), { duration: 2, ease })
            }))
            let before = flow.x(0), least = 0
            for (let frame = 0; frame <= 80; frame++) {
                const time = frame / 20, end = flow.x(time <= 2 ? 36 : 74)
                const cursor = at(time, () => flow.cursor.get('x'))
                expect(cursor).toBeLessThanOrEqual(end + 1e-6)
                expect(cursor).toBeGreaterThanOrEqual(before - 1e-6)
                least = Math.min(least, cursor - before)
                before = cursor
                // No bar is past the cursor, and a handoff shows only when the cursor is at it or past it.
                for (const span of flow.spans) if (at(time, () => shows(span) > 0 && span.shape.bounds().width > 0)) expect(at(time, () => right(span.shape))).toBeLessThanOrEqual(cursor + 1e-6)
                flow.handoffs.forEach((handoff, index) => {
                    if (at(time, () => shows(handoff)) > 0) expect(cursor).toBeGreaterThanOrEqual(flow.x([30, 42, 70, 78][index]!) - 0.5)
                })
            }
            // The cursor is at the time of each advance when the advance ends.
            expect(at(2, () => flow.cursor.get('x'))).toBeCloseTo(flow.x(36), 6)
            expect(at(4, () => flow.cursor.get('x'))).toBeCloseTo(flow.x(74), 6)
        }
    })

    it('ends the numbers of all counters at one x, with room for the widest number from the start', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            const list: LaneEvent[] = []
            for (let k = 0; k < 12; k++) list.push({ from: k % 2, to: 1 - (k % 2), at: 5 + k * 6 })
            list.push({ from: 1, to: 2, at: 90 })
            flow = s.add(lanes(['user space', 'kernel', 'drive'], list, { ...sized, domain: [0, 100], boundaries: [{ between: [0, 1], label: 'system call line', count: true }, { between: [1, 2], label: 'bus', count: true }] }))
            s.play(flow.showAll(), { duration: 2, ease: linear })
        }))
        const [calls, bus] = flow.counters, labels = flow.boundaries.map((boundary) => boundary.children[1]!)
        // The first counter goes to 12, and the second to 1.
        expect([calls!.children.length, bus!.children.length]).toEqual([13, 2])
        const ends = [...calls!.children, ...bus!.children].map((value) => at(0, () => right(value)))
        expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(1.5)
        // The two labels start at one x. The widest number, of two digits, has its room after the longest label.
        expect(at(0, () => labels[0]!.bounds().x)).toBeCloseTo(at(0, () => labels[1]!.bounds().x), 6)
        const widest = Math.min(...calls!.children.map((value) => at(0, () => value.bounds().x)))
        expect(widest).toBeGreaterThan(at(0, () => right(labels[0]!)) + 8)
        expect(at(0, () => calls!.children[12]!.bounds().width)).toBeGreaterThan(at(0, () => calls!.children[1]!.bounds().width) * 1.5)
        // The label does not move when the number grows.
        expect(at(2, () => labels[0]!.bounds().x)).toBe(at(0, () => labels[0]!.bounds().x))
        expect(at(2, () => calls!.children.filter((value) => value.get('visible')).map((value) => (value as unknown as { source: string }).source))).toEqual(['12'])
        // The numbers are after the longest label, whichever boundary has it.
        await compileFilm(film(() => {
            const other = lanes(['a', 'b', 'c'], [{ from: 0, to: 2, at: 50 }], { ...sized, domain: [0, 100], boundaries: [{ between: [0, 1], label: 'bus', count: true }, { between: [1, 2], label: 'system call line', count: true }] })
            const long = other.boundaries[1]!.children[1]!
            for (const counter of other.counters) expect(counter!.children[0]!.bounds().x).toBeGreaterThan(right(long) + 8)
        }))
    })

    it('does not count a handoff at the first end of the domain before the first advance', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['a', 'b'], [{ from: 0, to: 1, at: 0 }, { lane: 1, start: 0, end: 50 }], { ...sized, domain: [0, 100], boundaries: [{ between: [0, 1], count: true }] }))
            // The cursor is at 0, and so is the handoff. No advance has shown it.
            expect(flow.crossings(0)).toBe(0)
            s.wait(1)
            s.play(flow.advance(0), { duration: 1 })
            expect(flow.crossings(0)).toBe(1)
        }))
        const shown = (time: number) => at(time, () => flow.counters[0]!.children.filter((value) => value.get('visible')).map((value) => (value as unknown as { source: string }).source))
        expect([shown(0.5), shown(1.5)]).toEqual([['0'], ['1']])
        expect(at(0.5, () => shows(flow.handoffs[0]!))).toBe(0)
    })

    it('puts itself on the stage with the first advance, and takes 1.6 s for an advance and 4 s for showAll when the film gives no time', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            flow = lanes(names, events, sized)
            expect(flow.advance(10).duration).toBe(1.6)
            expect(flow.showAll().duration).toBe(4)
            expect([flow.advance(10, { duration: 3 }).duration, flow.showAll({ duration: 2 }).duration]).toEqual([3, 2])
            // The object is not on the stage: no `s.add`, and no `enter`.
            s.wait(0.5)
            s.play(flow.advance(50))
            expect(s.time).toBeCloseTo(2.1, 6)
            s.play(flow.showAll())
            expect(s.time).toBeCloseTo(6.1, 6)
        }))
        expect(compiled.frame(0.25).ops).toHaveLength(0)
        // From the start of the advance, the names and the lines are there: 15 letters and 3 lines.
        expect(compiled.frame(0.5).ops.length).toBeGreaterThanOrEqual(18)
        expect(at(2.1, () => flow.events.map(shows))).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0])
        expect(flow.mounted).toBe(true)
    })

    it('refuses labels that would touch, and names the two events and what to do', async () => {
        await compileFilm(film(() => {
            const advice = 'Use a wider width, a larger pitch, shorter labels, times that are further apart, or another labelSide'
            // Three arrows close together: the label of the middle one has no room at the right or at the left.
            expect(() => lanes(['a', 'b'], [
                { from: 'a', to: 'b', at: 40, label: 'the first handoff' },
                { from: 'b', to: 'a', at: 50, label: 'the second handoff' },
                { from: 'a', to: 'b', at: 60, label: 'the third handoff' },
            ], { ...sized, domain: [0, 100] })).toThrow(`lanes: the label of event 1 ("the second handoff") touches the arrow of event 2 ("the third handoff"). ${advice}`)
            // Two short spans side by side: the second label has no room over its bar.
            expect(() => lanes(['a'], [
                { lane: 'a', start: 40, end: 42, label: 'the first span' },
                { lane: 'a', start: 44, end: 46, label: 'the second span' },
            ], { ...sized, domain: [0, 100] })).toThrow(`lanes: the label of event 1 ("the second span") touches the label of event 0 ("the first span"). ${advice}`)
            // A label over a bar at the foot of an arrow.
            expect(() => lanes(['a', 'b'], [
                { from: 'a', to: 'b', at: 30 },
                { lane: 'b', start: 30, end: 34, label: 'handles the exit' },
            ], { ...sized, domain: [0, 100] })).toThrow(`lanes: the label of event 1 ("handles the exit") touches the arrow of event 0. ${advice}`)
            // With too little room between two lanes, the label of a handoff touches a bar.
            expect(() => lanes(['a', 'b'], [
                { lane: 'a', start: 0, end: 60 },
                { from: 'a', to: 'b', at: 30, label: 'lgy' },
            ], { ...sized, pitch: 64 })).toThrow(`lanes: the label of event 1 ("lgy") touches the bar of event 0. ${advice}`)
            // A label that ends 3 px before an arrow touches it: a label needs a clear distance. With 20 px it has its place.
            const probe = lanes(['a', 'b'], [{ from: 'a', to: 'b', at: 0, label: 'call' }], { ...sized, domain: [0, 100] })
            const end = right(probe.handoffs[0]!.text!) + 500, arrow = probe.handoffs[0]!.shape.bounds().width / 2
            const near = (gap: number) => lanes(['a', 'b'], [{ from: 'a', to: 'b', at: 0, label: 'call' }, { from: 'b', to: 'a', at: (end + gap + arrow) / 10 }], { ...sized, domain: [0, 100] })
            expect(() => near(3)).toThrow(`lanes: the label of event 0 ("call") touches the arrow of event 1. ${advice}`)
            expect(near(20).handoffs[0]!.text!.bounds().x).toBeCloseTo(probe.handoffs[0]!.text!.bounds().x, 6)
            // Wider than the time area: no place holds it.
            expect(() => lanes(['a'], [{ lane: 'a', at: 5, label: 'a label that is much wider than the whole time area' }], { width: 300, domain: [0, 10] })).toThrow(/the label of event 0 \("a label that is much wider than the whole time area"\) is wider than the room/)
            // The same events with more room are accepted.
            expect(lanes(['a', 'b'], [
                { from: 'a', to: 'b', at: 10, label: 'the first handoff' },
                { from: 'b', to: 'a', at: 40, label: 'the second handoff' },
                { from: 'a', to: 'b', at: 70, label: 'the third handoff' },
            ], { ...sized, domain: [0, 100] }).handoffs).toHaveLength(3)
        }))
    })

    it('names a wrong lane, event, domain or size', async () => {
        await compileFilm(film(() => {
            const span = { lane: 'a', start: 0, end: 10 }
            expect(() => lanes([], [])).toThrow(/at least one lane/)
            expect(() => lanes(['a', 'b', 'a'], [span])).toThrow(/two lanes have the name "a"\. Give each lane its own name/)
            expect(() => lanes(['a', 'b'], [{ lane: 'c', start: 0, end: 10 }])).toThrow(/event 0 names the lane "c"\. The lanes are 0 \("a"\), 1 \("b"\)/)
            expect(() => lanes(['a', 'b'], [span, { from: 'a', to: 2, at: 5 }])).toThrow(/event 1 names the lane 2\. The lanes are 0 \("a"\), 1 \("b"\)/)
            expect(() => lanes(['a'], [{ lane: 'a', start: 10, end: 10 }])).toThrow(/the span of event 0 starts at 10 and ends at 10\. A span ends after it starts/)
            expect(() => lanes(['a'], [{ lane: 'a', start: 10, end: 4 }])).toThrow(/A span ends after it starts/)
            expect(() => lanes(['a'], [span, { lane: 'a', at: 120 }], { domain: [0, 100] })).toThrow(/event 1 has the time 120, outside the domain 0 to 100/)
            expect(() => lanes(['a'], [{ lane: 'a', start: -5, end: 10 }], { domain: [0, 100] })).toThrow(/event 0 has the time -5, outside the domain 0 to 100/)
            expect(() => lanes(['a', 'b'], [span, { from: 'b', to: 1, at: 5 }])).toThrow(/event 1 is a handoff from the lane "b" to itself\. A handoff goes to another lane/)
            expect(() => lanes(['a'], [span], { domain: [5, 5] })).toThrow(/the domain needs two different ends, the smaller one first/)
            expect(() => lanes(['a'], [span], { domain: [10, 0] })).toThrow(/the domain needs two different ends/)
            expect(() => lanes(['a'], [{ lane: 'a', at: 5 }])).toThrow(/the events give no range of time\. Give it a domain/)
            expect(() => lanes(['a'], [])).toThrow(/the events give no range of time/)
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: Number.NaN }])).toThrow(/event 0 has a time that is not a number/)
            expect(() => lanes(['a'], [{ lane: 'a' } as never])).toThrow(/event 0 is not a span/)
            expect(() => lanes(['a'], [span], { width: 0 })).toThrow(/width is the width of the time area/)
            expect(() => lanes(['a'], [span], { barHeight: -1 })).toThrow(/barHeight is the height of a bar/)
            expect(() => lanes(['a'], [span], { size: 0 })).toThrow(/size is a text size/)
            expect(() => lanes(['a'], [span], { barHeight: 44, pitch: 40 })).toThrow(/pitch is the distance from one lane to the next\. Give it 44 or more/)
            expect(() => lanes(['a'], [span], { ticks: [0, 20] })).toThrow(/the tick 20 is outside the domain 0 to 10/)
            expect(() => lanes(['a'], [span], { ticks: 0 })).toThrow(/ticks is a count of 1 or more/)
            expect(() => lanes(['a'], [span], { width: 300, ticks: [0, 1, 2], format: (time) => `${time} seconds` })).toThrow(/the ticks "0 seconds" and "1 seconds" touch\. Use fewer ticks, a shorter format, or a wider width/)
            expect(() => lanes(['a', 'b'], [span]).y('c')).toThrow(/no lane "c"\. The lanes are 0 \("a"\), 1 \("b"\)/)
            // A pitch with no room for an arrow between two bars, when a handoff needs one. With no handoff, the same pitch is accepted.
            expect(() => lanes(['a', 'b'], [span, { from: 'a', to: 'b', at: 5 }], { barHeight: 44, pitch: 50 })).toThrow(/a pitch of 50 leaves 6 px between two bars, and the arrow of a handoff needs 24\. Give a pitch of 68 or more/)
            expect(lanes(['a', 'b'], [span], { barHeight: 44, pitch: 50 }).spans).toHaveLength(1)
            expect(lanes(['a', 'b'], [span, { from: 'a', to: 'b', at: 5 }], { barHeight: 44, pitch: 68 }).handoffs).toHaveLength(1)
            // Two spans that overlap on one lane. Two spans that meet at one time are accepted.
            expect(() => lanes(['a'], [{ lane: 'a', start: 30, end: 60, label: 'two' }, { lane: 'a', start: 0, end: 50, label: 'one' }])).toThrow(/the spans of event 1 \("one"\) and event 0 \("two"\) overlap on the lane "a": one ends at 50, and the other starts at 30/)
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: 100 }, { lane: 'a', start: 30, end: 60 }])).toThrow(/the spans of event 0 and event 1 overlap on the lane "a"/)
            expect(lanes(['a', 'b'], [{ lane: 'a', start: 0, end: 50 }, { lane: 'a', start: 50, end: 60 }, { lane: 'b', start: 30, end: 55 }]).spans).toHaveLength(3)
            // A domain with no event in it is accepted: the lanes are empty.
            expect(lanes(['a'], [], { domain: [0, 10] }).events).toEqual([])
        }))
    })

    const paint = (color: string) => rect(1, 1, { fill: color, stroke: null }).get('fill')
    const middle = (node: Node) => { const box = node.bounds(); return [box.x + box.width / 2, box.y + box.height / 2] }
    /** The text that a text which counts down shows at a time. */
    const reads = (node: Node, time: number) => at(time, () => (node.draw!(time) as TextNode).source)

    it('draws a deadline as a line at its time over all lanes, with its text over the line, and nothing of it without the option', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['a', 'b'], [{ lane: 'a', start: 0, end: 60 }], { ...sized, domain: [0, 100], deadline: { at: 80, label: 'deadline' } })
            expect(flow.deadlines).toHaveLength(1)
            const [rule, label] = flow.deadlines[0]!.children
            const line = rule!.bounds()
            expect(line.x + line.width / 2).toBeCloseTo(flow.x(80), 6)
            // From over the bars of the first lane to under the bars of the last one.
            expect(line.y).toBeLessThan(flow.y('a') - 20 - 26)
            expect(bottom(rule!)).toBeGreaterThan(flow.y('b') + 20)
            expect(rule!.get('dash')).not.toBeNull()
            expect(rule!.get('stroke')).toEqual(paint('red'))
            // The text is over the top of the line, in the middle, in the color of the line.
            expect((label as TextNode).source).toBe('deadline')
            expect(middle(label!)[0]).toBeCloseTo(flow.x(80), 0)
            expect(bottom(label!)).toBeLessThan(line.y)
            expect(bottom(label!)).toBeGreaterThan(line.y - 26)
            // Near the last end of the time area, the text stays in the time area.
            const late = lanes(['a'], [{ lane: 'a', start: 0, end: 60 }], { ...sized, domain: [0, 100], deadline: { at: 99, label: 'the deadline of the request', color: 'orange' } })
            expect(right(late.deadlines[0]!.children[1]!)).toBeCloseTo(500, 6)
            expect(late.deadlines[0]!.children[0]!.get('stroke')).toEqual(paint('orange'))
            // The domain holds a deadline that is after the last event.
            expect(lanes(['a'], [{ lane: 'a', start: 0, end: 60 }], { deadline: { at: 80 } }).domain).toEqual([0, 80])
            // An object with no deadline has none of these parts, and the parts of before are in the same order.
            const plain = lanes(names, events, sized)
            expect([plain.deadlines, plain.links, plain.brackets]).toEqual([[], [], []])
            expect(plain.children).toEqual([...plain.rails, plain.cursor, plain.children[4]!, ...plain.spans, ...plain.handoffs, ...plain.marks, ...plain.names])
        }))
    })

    it('brings a deadline in with enter: its line draws from its top, and its bar and its text fade in', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = lanes(['a'], [{ lane: 'a', start: 0, end: 60 }], { ...sized, domain: [0, 100], deadline: { at: 80, label: 'deadline', drain: true } })
            s.play(flow.enter(), { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        const [rule, whole, left, label] = flow.deadlines[0]!.children
        // They wait for the first third of the time, as the axis does.
        expect(at(0.2, () => [rule!.get('trimTo'), shows(whole!), shows(left!), shows(label!)])).toEqual([0, 0, 0, 0])
        const half = at(0.65, () => [rule!.get('trimTo'), shows(whole!), shows(left!), shows(label!)])
        for (const value of half) expect(value).toBeCloseTo(0.5, 6)
        expect(at(1.2, () => [rule!.get('trimTo'), shows(whole!), shows(left!), shows(label!)])).toEqual([1, 1, 1, 1])
        // The line starts at its top end, over the lanes, so it draws down from there.
        const points = rule!.get('path')![0]!.p
        expect(points[1]).toBeLessThan(flow.y('a') - 20)
        expect(points[points.length - 1]).toBeGreaterThan(flow.y('a') + 20)
        // No event shows, and the cursor is hidden.
        expect(at(1.2, () => [...flow.events, flow.cursor].map(shows))).toEqual([0, 0])
    })

    it('drains the bar of a deadline with the cursor, so that the end of the bar is at the cursor at every frame, and gives the time that is left', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['a', 'b'], [{ lane: 'a', start: 0, end: 60 }], { ...sized, domain: [0, 100], deadline: { at: 80, label: 'deadline', drain: true } }))
            expect(flow.remaining()).toBe(80)
            s.wait(1)
            s.play(flow.advance(40), { duration: 2 })
            expect(flow.remaining()).toBe(40)
            expect(flow.remaining('deadline')).toBe(40)
            s.play(flow.advance(100), { duration: 1, ease: linear })
            // Past the deadline, the time that is left is less than 0.
            expect(flow.remaining()).toBe(-20)
        }))
        const [rule, whole, left] = flow.deadlines[0]!.children
        // Before the first advance: the bar goes from the first end of the domain to the line, over the lanes.
        expect(at(0.5, () => [left!.bounds().x, right(left!)])).toEqual([flow.x(0), flow.x(80)])
        expect([whole!.bounds().x, right(whole!)]).toEqual([flow.x(0), flow.x(80)])
        expect(bottom(left!)).toBeLessThan(flow.y('a') - 20 - 26)
        expect(left!.bounds().y).toBeGreaterThan(rule!.bounds().y)
        for (const [time, share] of [[1.5, 0.25], [2.4, 0.7]] as const) {
            const cursor = flow.x(40 * smooth(share))
            expect(at(time, () => left!.bounds().x)).toBeCloseTo(cursor, 6)
            expect(at(time, () => flow.cursor.get('x'))).toBeCloseTo(cursor, 6)
            expect(at(time, () => right(left!))).toBeCloseTo(flow.x(80), 6)
        }
        // The cursor stays out of the label row over the first lane, also with a drain bar.
        expect(flow.cursor.bounds().y).toBeGreaterThan(bottom(whole!) + 26)
        expect(at(3.5, () => left!.bounds().x)).toBeCloseTo(flow.x(70), 6)
        // After the deadline, nothing is left of the bar, and the faint bar of the whole time stays.
        expect(at(3.9, () => left!.get('path'))).toEqual([])
        expect(at(3.9, () => [whole!.bounds().x, right(whole!)])).toEqual([flow.x(0), flow.x(80)])
        // With `from`, the clock starts later: the bar starts there, and it does not drain before that time.
        let late!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            late = s.add(lanes(['a'], [{ lane: 'a', start: 0, end: 60 }], { ...sized, domain: [0, 100], deadline: { at: 80, drain: { from: 30 } } }))
            s.play(late.advance(20), { duration: 1 })
            expect(late.remaining()).toBe(50)
            s.play(late.advance(50), { duration: 1 })
            expect(late.remaining()).toBe(30)
        }))
        expect(at(1, () => late.deadlines[0]!.children[2]!.bounds().x)).toBeCloseTo(late.x(30), 6)
        expect(at(2, () => late.deadlines[0]!.children[2]!.bounds().x)).toBeCloseTo(late.x(50), 6)
    })

    it('writes the text of a deadline from the time that is left at the cursor, at every frame, and a copy follows its own cursor', async () => {
        let flow!: Lanes<LaneTimelineEvent>, copy!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = lanes(['a'], [{ lane: 'a', start: 0, end: 60 }], { ...sized, domain: [0, 100], deadline: { at: 80, label: (left) => (left > 0 ? `${left} s left` : 'too late') } })
            copy = flow.clone()
            s.add(flow, copy.at(0, 300))
            s.wait(1)
            s.play(flow.advance(100), { duration: 2, ease: linear })
        }))
        const readout = flow.deadlines[0]!.children[1]!
        expect(reads(readout, 0.5)).toBe('80 s left')
        expect(reads(readout, 1.5)).toBe('55 s left')
        expect(reads(readout, 2)).toBe('30 s left')
        expect(reads(readout, 2.6)).toBe('too late')
        // The copy did not advance, so its text stays.
        expect(reads(copy.deadlines[0]!.children[1]!, 2.6)).toBe('80 s left')
        // The text starts at one x for every value, so it does not shake while it counts down.
        const starts = [0.5, 1.5, 2].map((time) => at(time, () => (readout.draw!(time) as Node).get('x')))
        expect(new Set(starts).size).toBe(1)
    })

    it('puts the texts of two deadlines on one line, and refuses a deadline that it cannot draw', async () => {
        await compileFilm(film(() => {
            const span = { lane: 'a', start: 0, end: 60 }
            const two = lanes(['a'], [span], { ...sized, domain: [0, 100], deadline: [{ at: 30, label: 'timeout', drain: true }, { at: 90, label: 'give up' }] })
            // The two texts stand on one line, with the bar or without it.
            const [first, second] = two.deadlines.map((made) => made.children[made.children.length - 1]!.get('y'))
            expect(first).toBe(second)
            expect(two.remaining('give up')).toBe(90)
            expect(() => lanes(['a'], [span], { ...sized, domain: [0, 100], deadline: [{ at: 50, label: 'the first deadline' }, { at: 55, label: 'the second deadline' }] }))
                .toThrow('lanes: the label of deadline 1 ("the second deadline") touches the label of deadline 0 ("the first deadline"). Use shorter labels, or deadlines that are further apart')
            expect(() => lanes(['a'], [span], { domain: [0, 100], deadline: { at: 120 } })).toThrow('lanes: deadline 0 has the time 120, outside the domain 0 to 100. Give a domain that holds it')
            expect(() => lanes(['a'], [span], { deadline: { at: Number.NaN } })).toThrow("lanes: deadline 0 needs its time, such as deadline: { at: 20, label: 'deadline' }")
            expect(() => lanes(['a'], [span], { deadline: { at: 50, drain: { from: 70 } } })).toThrow('lanes: deadline 0 is at 50, and its bar starts at 70. The bar starts before the deadline')
            expect(() => lanes(['a'], [span], { deadline: { at: 0, drain: true } })).toThrow(/deadline 0 is at 0, the first end of the domain, so its bar has no time to show/)
            expect(() => lanes(['a'], [span], { deadline: { at: 50, label: (() => 7) as never } })).toThrow(/the label of deadline 0 is a function, and it returned number for 50/)
            expect(() => two.remaining(2)).toThrow('lanes: no deadline 2. The deadlines are 0 ("timeout"), 1 ("give up")')
            expect(() => lanes(['a'], [span]).remaining()).toThrow('lanes: no deadline 0. The object has no deadline: give it the option `deadline`')
            // A label of an event is not on the line of a deadline: it takes a place that is clear of the line, or the build stops.
            const clear = lanes(['a'], [{ lane: 'a', start: 40, end: 100, label: 'a label that the line would cross' }], { ...sized, deadline: { at: 50 } })
            expect(clear.spans[0]!.text!.bounds().x).toBeGreaterThan(clear.x(50) + 7)
            expect(() => lanes(['a'], [{ lane: 'a', at: 50, label: 'on the line' }], { ...sized, domain: [0, 100], deadline: { at: 50 } }))
                .toThrow(/the label of event 0 \("on the line"\) touches the line of deadline 0/)
        }))
    })

    it('refuses deadline labels and drain bars that cannot fit their time area', async () => {
        await compileFilm(film(() => {
            const span = { lane: 'a', start: 0, end: 100 }
            const long = 'A deadline label that is wider than this time area'
            for (const label of [long, () => long, (left: number) => left < 0 ? long : 'ok']) {
                expect(() => lanes(['a'], [span], { width: 300, domain: [0, 100], deadline: { at: 80, label } })).toThrow(/label of deadline 0.*wider than the time area.*shorter label/)
            }
            for (const drain of [{}, null, 1, { from: Number.NaN }]) {
                expect(() => lanes(['a'], [span], { deadline: { at: 80, drain: drain as never } })).toThrow(/deadline 0 takes drain: true, false, or \{ from: time \}/)
            }
            expect(() => lanes(['a'], [span], { deadline: [{ at: 40, drain: true }, { at: 80, drain: true }] })).toThrow(/bars of deadlines 0 and 1 overlap.*Keep drain on one deadline/)
            expect(lanes(['a'], [span], { deadline: [{ at: 40, drain: true }, { at: 80, drain: { from: 40 } }] }).deadlines).toHaveLength(2)
        }))
    })

    it('checks a countdown label at intermediate frames instead of coercing invalid output or drawing outside the time area', async () => {
        for (const invalid of [7, 'W'.repeat(100)]) {
            const message = typeof invalid === 'number' ? /returned number for/ : /leaves the time area while counting down.*shorter format/
            await expect(compileFilm(film((s) => {
                const flow = s.add(lanes(['a'], [{ lane: 'a', start: 0, end: 100 }], {
                    width: 300, domain: [0, 100], deadline: { at: 80, label: ((left: number) => left > 50 && left < 70 ? invalid : 'ok') as never },
                }))
                s.play(flow.showAll(), { duration: 2, ease: linear })
            }))).rejects.toThrow(message)
        }
    })

    it('puts a child span in a row under its parent, gives two children that overlap two rows, and moves the next lane down', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['a', 'b'], [
                { lane: 'a', start: 0, end: 100, id: 'turn' },
                { lane: 'a', start: 10, end: 50, inside: 'turn', id: 'one' },
                { lane: 'a', start: 40, end: 80, inside: 'turn', id: 'two' },
                { lane: 'a', start: 60, end: 90, inside: 'turn', id: 'three' },
                { lane: 'a', start: 15, end: 30, inside: 'one', id: 'deep' },
                { lane: 'a', at: 20, inside: 'one', id: 'dot' },
                { lane: 'b', start: 0, end: 10 },
            ], sized)
            // A row of children is 43 under the row over it: the height of a bar and a small gap.
            const tops = (id: string) => flow.find(id).shape.bounds().y - (flow.y('a') - 20)
            expect(['turn', 'one', 'two', 'three', 'deep'].map(tops)).toEqual([0, 43, 86, 43, 86])
            const one = flow.find('one').shape.bounds()
            expect([one.x, one.x + one.width, one.height]).toEqual([flow.x(10), flow.x(50), 40])
            // A mark that is inside a span is on the bar of that span.
            expect(middle(flow.find('dot').shape)).toEqual([flow.x(20), flow.y('a') + 43])
            // Two rows of children are under the first lane, so the second lane is 86 further down.
            expect(flow.y('b') - flow.y('a')).toBe(186)
            expect(lanes(['a', 'b'], [{ lane: 'a', start: 0, end: 100 }, { lane: 'b', start: 0, end: 10 }], sized).y('b')).toBe(50)
            // The line of the lane is the line of its first row, and the cursor goes to under the last lane.
            expect(flow.rails[0]!.bounds().y).toBe(flow.y('a'))
            expect(bottom(flow.cursor)).toBeGreaterThan(flow.y('b') + 20)
            // With children in the last lane, the cursor and the axis are under them.
            const last = lanes(['a'], [{ lane: 'a', start: 0, end: 100, id: 'turn' }, { lane: 'a', start: 10, end: 50, inside: 'turn' }], { ...sized, ticks: [0, 100] })
            expect(last.axis!.children[0]!.bounds().y).toBe(last.y('a') + 50 + 43)
            expect(bottom(last.cursor)).toBe(last.y('a') + 50 + 43)
        }))
    })

    it('starts a handoff under the lowest bar that its lane has at that time, and keeps the label of a child in its bar or beside it', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['a', 'b'], [
                { lane: 'a', start: 0, end: 100, id: 'turn', label: 'turn' },
                { lane: 'a', start: 10, end: 50, inside: 'turn', id: 'one', label: 'tool' },
                { lane: 'a', start: 60, end: 62, inside: 'turn', id: 'short', label: 'gate' },
                { from: 'a', to: 'b', at: 30 },
                { from: 'a', to: 'b', at: 90 },
                { from: 'b', to: 'a', at: 45 },
                { lane: 'a', at: 40, inside: 'one', id: 'token', label: 'token' },
            ], sized)
            // At 30 a child is there, so the arrow starts under the child. At 90 the parent is alone.
            expect(flow.handoffs[0]!.shape.bounds().y).toBe(flow.y('a') + 20 + 43)
            expect(flow.handoffs[1]!.shape.bounds().y).toBe(flow.y('a') + 20)
            expect(flow.handoffs[2]!.shape.bounds().y).toBe(flow.y('a') + 20 + 43)
            expect(bottom(flow.handoffs[0]!.shape)).toBe(flow.y('b') - 20)
            // A label that fits is inside its bar, in its own row.
            const tool = flow.find('one'), gate = flow.find('short')
            expect(tool.text!.bounds().x).toBeGreaterThan(tool.shape.bounds().x)
            expect(Math.abs(middle(tool.text!)[1]! - (flow.y('a') + 43))).toBeLessThan(6)
            // A label that does not fit is beside its bar, in the row of the bar: the parent is over it.
            expect(gate.text!.bounds().x).toBeGreaterThan(right(gate.shape))
            expect(Math.abs(middle(gate.text!)[1]! - (flow.y('a') + 43))).toBeLessThan(6)
            // The label of a mark in a child has the parent over it too, so it is on the bar of the child, beside the dot.
            const token = flow.find('token')
            expect(token.text!.bounds().x).toBeGreaterThan(right(token.shape))
            expect(right(token.text!)).toBeLessThan(right(tool.shape))
            expect(Math.abs(middle(token.text!)[1]! - (flow.y('a') + 43))).toBeLessThan(6)
            // The box of a lane holds its children, and the room between two lanes starts under them.
            const lane = flow.region({ lane: 'a' }), room = flow.region({ between: ['a', 'b'] })
            expect([lane.top, lane.bottom]).toEqual([flow.y('a') - 20, flow.y('a') + 20 + 43])
            expect([room.top, room.bottom]).toEqual([flow.y('a') + 20 + 43, flow.y('b') - 20])
        }))
    })

    it('refuses a child span that has no parent, another lane, or a time outside its parent', async () => {
        await compileFilm(film(() => {
            const turn = { lane: 'a', start: 0, end: 50, id: 'turn', label: 'turn' }
            expect(() => lanes(['a'], [turn, { lane: 'a', start: 10, end: 20, inside: 'nope' }])).toThrow('lanes: event 1 is inside "nope", and no span has this id. The spans with an id are "turn"')
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: 50 }, { lane: 'a', start: 10, end: 20, inside: 'turn' }])).toThrow('lanes: event 1 is inside "turn", and no span has this id. No span has an id: give the outer span an `id`')
            expect(() => lanes(['a', 'b'], [turn, { lane: 'b', start: 10, end: 20, inside: 'turn' }])).toThrow('lanes: event 1 is on the lane "b", and it is inside event 0 ("turn"), which is on the lane "a". A span holds events of its own lane. For work on another lane, use a handoff')
            expect(() => lanes(['a'], [turn, { lane: 'a', start: 40, end: 60, inside: 'turn' }], { domain: [0, 100] })).toThrow('lanes: event 1 is inside event 0 ("turn"), and it goes from 40 to 60, outside 0 to 50. A span holds what is in its own time')
            expect(() => lanes(['a'], [turn, { lane: 'a', at: 60, inside: 'turn' }], { domain: [0, 100] })).toThrow('lanes: event 1 is inside event 0 ("turn"), and it is at 60, outside 0 to 50')
            expect(() => lanes(['a'], [{ ...turn, inside: 'turn' }])).toThrow('lanes: event 0 ("turn") is inside itself. `inside` is the id of another span, the one that holds it')
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: 50, id: 'x', inside: 'y' }, { lane: 'a', start: 0, end: 50, id: 'y', inside: 'x' }])).toThrow(/event 0 is inside a span that is inside event 0\. Take `inside` from one of them/)
            // Two spans of a lane that overlap with no parent are still an error, and the message names `inside`.
            expect(() => lanes(['a'], [turn, { lane: 'a', start: 10, end: 20 }])).toThrow(/overlap on the lane "a".*For a span that is a part of another one, give it `inside` with the id of the outer span/)
            expect(() => lanes(['a'], [turn, { lane: 'a', start: 60, end: 70, id: 'turn' }])).toThrow('lanes: events 0 and 1 have the id "turn". Give each event its own id')
        }))
    })

    it('draws a link from a time on one lane to a time on another, at the later of the two times, and crosses no boundary', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['a', 'b', 'c'], [
                { lane: 'a', start: 0, end: 40 },
                { lane: 'c', start: 60, end: 80 },
                { from: 'c', to: 'a', at: [60, 40], id: 'hit', label: 'hit' },
                { from: 'b', to: 'c', at: [10, 30], id: 'late' },
            ], { ...sized, boundaries: [{ between: ['a', 'b'], count: true }] }))
            expect(flow.events.map((event) => event.kind)).toEqual(['span', 'span', 'link', 'link'])
            expect(flow.links).toEqual([flow.events[2], flow.events[3]])
            expect(flow.timeOf('hit')).toBe(60)
            s.wait(1)
            s.play(flow.advance(50), { duration: 1, ease: linear })
            expect(flow.stateOf('hit')).toBe('ahead')
            s.play(flow.advance(60), { duration: 1, ease: linear })
            expect(flow.stateOf('hit')).toBe('done')
            s.wait(1)
        }))
        const hit = flow.find('hit'), [shaft, head] = hit.shape.children
        // It leaves the top of the bar of `c` at 60 and arrives under the bar of `a` at 40, 3 px from each bar.
        const line = shaft!.bounds()
        expect(line.x).toBeGreaterThan(flow.x(40) - 1)
        expect(line.x + line.width).toBeLessThan(flow.x(60) + 1)
        expect(line.y + line.height).toBeLessThan(flow.y('c') - 20)
        expect(line.y + line.height).toBeGreaterThan(flow.y('c') - 20 - 5)
        // The head is at the end of the link: at the lane that it points at, at the earlier time.
        expect(head!.bounds().y).toBeGreaterThan(flow.y('a') + 20)
        expect(head!.bounds().y).toBeLessThan(flow.y('a') + 20 + 5)
        expect(Math.abs(middle(head!)[0]! - flow.x(40))).toBeLessThan(12)
        // With no bar at its time, an end of a link is near the line of the lane, where a dot would be.
        const late = flow.find('late').shape.bounds()
        expect(late.y).toBeGreaterThan(flow.y('b'))
        expect(late.y).toBeLessThan(flow.y('b') + 16)
        // The link shows when the cursor reaches the later of its two times, and not before. Its label comes with it.
        // The cursor stops early at 60, so that the link is complete when the advance ends: it is at 58 at 2.5 s.
        expect(at(1.9, () => shows(hit))).toBe(0)
        expect(at(2.5, () => shows(hit))).toBe(0)
        expect(at(2.7, () => [shows(hit), shaft!.get('trimTo') < 1, shows(hit.text!)])).toEqual([1, true, 0])
        expect(at(3.2, () => [shows(hit), shaft!.get('trimTo')])).toEqual([1, expect.closeTo(1, 6)])
        expect(at(4, () => [shows(hit.text!), shows(head!)])).toEqual([1, 1])
        // The label is not on the line: it is beside it, between the two lanes.
        const text = hit.text!.bounds()
        expect(text.x > line.x + line.width || text.x + text.width < line.x || text.y > line.y + line.height || text.y + text.height < line.y).toBe(false)
        expect(text.y).toBeGreaterThan(flow.y('a') + 20)
        expect(text.y + text.height).toBeLessThan(flow.y('c') - 20)
        // No control passes with a link, so the counter of the boundary stays at 0.
        expect(flow.crossings(0)).toBe(0)
    })

    it('draws a link on one lane as an arc over the bars, with its label over the arc, and keeps a label off a slanted line', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['a', 'b'], [
                { lane: 'b', start: 0, end: 30 },
                { lane: 'b', start: 50, end: 80 },
                { from: 'b', to: 'b', at: [30, 50], id: 'retry', label: 'retry' },
            ], { ...sized, pitch: 160 })
            const retry = flow.find('retry'), arc = retry.shape.bounds()
            expect(flow.links).toHaveLength(1)
            // From the top of one bar to the top of the next, 3 px from each, and up between them.
            expect(arc.x).toBeGreaterThan(flow.x(30))
            expect(arc.x + arc.width).toBeLessThan(flow.x(50) + 1)
            expect(arc.y + arc.height).toBeLessThanOrEqual(flow.y('b') - 20)
            expect(arc.y).toBeLessThan(flow.y('b') - 20 - 15)
            // The label is over the top of the arc, at its middle.
            expect(bottom(retry.text!)).toBeLessThan(arc.y)
            expect(middle(retry.text!)[0]).toBeCloseTo(flow.x(40), 0)
            // On the first lane, the arc and its label have room under the bar of a deadline that drains.
            const under = lanes(['a'], [{ lane: 'a', start: 0, end: 30 }, { lane: 'a', start: 50, end: 80 }, { from: 'a', to: 'a', at: [30, 50], label: 'retry' }], { ...sized, domain: [0, 100], deadline: { at: 90, drain: true } })
            expect(under.links[0]!.text!.bounds().y).toBeGreaterThan(bottom(under.deadlines[0]!.children[1]!) + 2)
            // A link that goes back in time on one lane is an arc too: it goes up, not down through the bars.
            const back = lanes(['a'], [{ lane: 'a', start: 0, end: 30 }, { lane: 'a', start: 50, end: 80 }, { from: 'a', to: 'a', at: [50, 30] }], sized).links[0]!.shape.bounds()
            expect(back.y).toBeLessThan(-20 - 15)
            expect(back.y + back.height).toBeLessThanOrEqual(-20)
            // The label of a slanted link is clear of its line, also where the line is nearly flat.
            const flat = lanes(['a', 'b'], [{ from: 'a', to: 'b', at: [10, 90], label: 'arrives late' }], { ...sized, domain: [0, 100] }).links[0]!
            const words = flat.text!.bounds(), [from, to] = [[flat.shape.bounds().x, flat.shape.bounds().y], [right(flat.shape), bottom(flat.shape)]]
            const lineAt = (x: number) => from[1]! + ((x - from[0]!) / (to[0]! - from[0]!)) * (to[1]! - from[1]!)
            // At both ends of the text, the line is over the text or under it by 6 px or more.
            for (const x of [words.x, words.x + words.width]) expect(Math.min(Math.abs(lineAt(x) - words.y), Math.abs(lineAt(x) - (words.y + words.height)))).toBeGreaterThan(6)
            expect(lineAt(words.x) > words.y + words.height || lineAt(words.x + words.width) < words.y).toBe(true)
            // In a high room between two lanes, the patch behind the label of a link is as high as the text, so the
            // cursor shows over the label and under it. In a low room, the patch covers the room, as for a handoff.
            const patchOf = (made: Lanes<LaneTimelineEvent>) => made.children[made.children.indexOf(made.cursor) + 1]!.children[0]!.bounds().height
            const link: LaneTimelineEvent[] = [{ from: 'a', to: 'b', at: [20, 60], label: 'late' }]
            expect(patchOf(lanes(['a', 'b'], link, { ...sized, pitch: 240, domain: [0, 100] }))).toBeLessThan(40)
            expect(patchOf(lanes(['a', 'b'], link, { ...sized, domain: [0, 100] }))).toBe(60)
            expect(() => lanes(['a'], [{ from: 'a', to: 'a', at: [20, 20] }], { domain: [0, 100] })).toThrow('lanes: event 0 is a link from the lane "a" to itself at one time, 20. A link on one lane joins two times')
            const retriedSpan: LaneTimelineEvent[] = [{ lane: 0, start: 0, end: 80 }, { from: 0, to: 0, at: [40, 50] }]
            expect(() => lanes(['trace'], [...retriedSpan, { bracket: [0, 70] }])).toThrow(/bracket of event 2 meets the arc of event 1.*below/)
            expect(lanes(['trace'], [...retriedSpan, { bracket: [0, 70], labelSide: 'under' }]).brackets).toHaveLength(1)
            expect(() => lanes(['a', 'b'], [{ from: 'a', to: 'b', at: [20] as never }], { domain: [0, 100] })).toThrow(/event 0 is a link, and `at` is its two times/)
            expect(() => lanes(['a', 'b'], [{ from: 'a', to: 'b', at: [20, 60], label: 'x', labelSide: 'over' }], { domain: [0, 100] })).toThrow(/The label of a link between two lanes is at the 'left' or at the 'right' of its line/)
        }))
    })

    it('draws a bracket over its lane or under it, grows it with the cursor, and closes it with its name when the cursor reaches its end', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['a', 'b'], [
                { lane: 'a', start: 0, end: 100 },
                { bracket: [20, 60], id: 'over', label: 'window' },
                { bracket: [30, 70], id: 'under', label: 'gap', labelSide: 'under' },
                { bracket: [10, 20], lane: 'b', id: 'named' },
            ], sized))
            expect(flow.brackets.map((made) => made.kind)).toEqual(['bracket', 'bracket', 'bracket'])
            s.wait(1)
            s.play(flow.advance(40), { duration: 1, ease: linear })
            expect([flow.stateOf('over'), flow.stateOf('under')]).toEqual(['running', 'running'])
            s.play(flow.advance(60), { duration: 1, ease: linear })
            expect([flow.stateOf('over'), flow.stateOf('under')]).toEqual(['done', 'running'])
            s.wait(1)
        }))
        const over = flow.find('over'), under = flow.find('under')
        const closed = at(4, () => over.shape.bounds())
        // Without a lane, a bracket is over the first lane, and under the last one with labelSide 'under'.
        expect([closed.x, closed.x + closed.width]).toEqual([flow.x(20), flow.x(60)])
        expect(closed.y + closed.height).toBeLessThan(flow.y('a') - 20)
        expect(closed.y + closed.height).toBeGreaterThan(flow.y('a') - 20 - 10)
        expect(at(4, () => under.shape.bounds().y)).toBeGreaterThan(flow.y('b') + 20)
        expect(flow.find('named').shape.bounds().y).toBeGreaterThan(flow.y('a') + 20)
        expect(bottom(flow.find('named').shape)).toBeLessThan(flow.y('b') - 20)
        // The name is on the far side of the line, at the middle of the window.
        expect(bottom(over.text!)).toBeLessThan(closed.y)
        expect(middle(over.text!)[0]).toBeCloseTo(flow.x(40), 0)
        expect(under.text!.bounds().y).toBeGreaterThan(bottom(under.shape))
        // Nothing of the bracket shows before the cursor leaves its start.
        expect(at(1.4, () => shows(over))).toBe(0)
        // While it grows, its last end is at the cursor, it has one end mark, and its name is hidden.
        expect(at(1.75, () => [shows(over), right(over.shape), shows(over.text!)])).toEqual([1, expect.closeTo(flow.x(30), 6), 0])
        const pieces = (time: number) => at(time, () => (over.shape.get('path')![0]!.p.length - 2) / 6)
        expect(pieces(1.75)).toBe(2)
        // In the next advance too. The cursor stops early there, so that the name is complete when the advance ends.
        expect(at(2.5, () => right(over.shape))).toBeCloseTo(at(2.5, () => flow.cursor.get('x')), 6)
        expect(at(2.5, () => right(over.shape))).toBeGreaterThan(flow.x(50))
        // At its end, it gets its second end mark, and then its name.
        expect(pieces(3.5)).toBe(3)
        expect(at(3.5, () => shows(over.text!))).toBe(1)
        expect(at(3.5, () => shows(under.text!))).toBe(0)
        await compileFilm(film(() => {
            expect(() => lanes(['a'], [{ bracket: [40, 20] }], { domain: [0, 100] })).toThrow('lanes: the bracket of event 0 starts at 40 and ends at 20. A bracket ends after it starts')
            expect(() => lanes(['a'], [{ bracket: [40, 60], labelSide: 'left' as never }], { domain: [0, 100] })).toThrow("lanes: event 0 is a bracket with the labelSide \"left\". A bracket is 'over' its lane or 'under' it")
            expect(() => lanes(['a'], [{ bracket: [40] as never }], { domain: [0, 100] })).toThrow(/event 0 is a bracket, and `bracket` is its two times/)
            // Two brackets at one side of a lane are on one line. They may meet at one time, and they may not overlap.
            expect(lanes(['a'], [{ bracket: [20, 40] }, { bracket: [40, 60] }, { bracket: [30, 50], labelSide: 'under' }], { domain: [0, 100] }).brackets).toHaveLength(3)
            expect(() => lanes(['a'], [{ bracket: [40, 60], label: 'two' }, { bracket: [20, 50], label: 'one' }], { domain: [0, 100] }))
                .toThrow('lanes: the brackets of event 1 ("one") and event 0 ("two") overlap over the lane "a": one ends at 50, and the other starts at 40. Put one of them at the other side of the lane with labelSide, or on another lane. Two brackets may meet at one time')
            // Under the last lane, the axis leaves room for the bracket and its name, with the pitch that the object has by default.
            const low = lanes(['a'], [{ lane: 'a', start: 0, end: 100 }, { bracket: [20, 60], label: 'gap', labelSide: 'under' }], { width: 1000, ticks: [0, 100] })
            expect(low.axis!.children[0]!.bounds().y - bottom(low.brackets[0]!.text!)).toBeGreaterThan(26 * 0.3)
            expect(lanes(['a'], [{ lane: 'a', start: 0, end: 100 }, { bracket: [20, 60], label: 'gap' }], { width: 1000, ticks: [0, 100] }).axis!.children[0]!.bounds().y).toBe(50.5)
            // A name that is wider than its bracket, beside a deadline at the first end of the bracket: it starts after the line.
            const late = lanes(['a'], [{ bracket: [50, 56], label: 'six units late' }], { ...sized, domain: [0, 100], deadline: { at: 50 } })
            expect(late.brackets[0]!.text!.bounds().x).toBeGreaterThan(late.x(50) + 7)
            expect(late.brackets[0]!.text!.bounds().x).toBeLessThan(late.x(50) + 12)
        }))
    })

    it('gives a span that failed a cross at its end and one that was cancelled a square, when the cursor reaches the end and not before', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['a', 'b'], [
                { lane: 'a', start: 0, end: 40, outcome: 'failed', id: 'failed', label: 'attempt' },
                { lane: 'a', start: 40, end: 80, outcome: 'cancelled', id: 'cancelled' },
                { lane: 'b', at: 20, outcome: 'failed', id: 'mark' },
                { lane: 'b', start: 30, end: 60, id: 'fine' },
            ], sized))
            s.wait(1)
            s.play(flow.advance(39), { duration: 1, ease: linear })
            expect(flow.stateOf('failed')).toBe('running')
            s.play(flow.advance(40), { duration: 1, ease: linear })
            expect([flow.stateOf('failed'), flow.stateOf('cancelled'), flow.stateOf('fine')]).toEqual(['failed', 'ahead', 'running'])
            s.play(flow.showAll(), { duration: 1 })
            expect([flow.stateOf('cancelled'), flow.stateOf('fine'), flow.stateOf('mark')]).toEqual(['cancelled', 'done', 'failed'])
        }))
        const failed = flow.find('failed'), cancelled = flow.find('cancelled')
        // The sign is on the end of the bar, at the middle of its height.
        expect(middle(failed.sign!)).toEqual([flow.x(40), flow.y('a')])
        expect(middle(cancelled.sign!)).toEqual([flow.x(80), flow.y('a')])
        expect(flow.find('fine').sign).toBeNull()
        // A disc in red with a cross of two lines, or a disc in orange with a square: the shape says which, without the color.
        const [disc, cross] = failed.sign!.children, [other, square] = cancelled.sign!.children
        expect([disc!.get('fill'), other!.get('fill')]).toEqual([paint('red'), paint('orange')])
        expect([cross!.get('fill'), cross!.get('stroke') !== null]).toEqual([null, true])
        expect(pathToD(cross!.get('path')!).match(/M/g)).toHaveLength(2)
        expect([square!.get('fill') !== null, square!.get('stroke')]).toEqual([true, null])
        // The sign is over the next bar of the lane, which starts where this one ends.
        expect(flow.children.indexOf(failed)).toBeGreaterThan(flow.children.indexOf(cancelled))
        // It is hidden while the span runs, and it arrives when the cursor reaches the end.
        expect(at(1.9, () => [shows(failed), shows(failed.sign!)])).toEqual([1, 0])
        expect(at(3.4, () => shows(failed.sign!))).toBeGreaterThan(0)
        expect(at(4, () => [shows(failed.sign!), failed.sign!.get('sx')])).toEqual([1, 1])
        expect(at(3.5, () => shows(cancelled.sign!))).toBe(0)
        // A mark with an outcome is the sign, in place of the dot.
        const mark = flow.find('mark')
        expect([mark.sign, mark.shape.children.length]).toEqual([null, 2])
        expect(mark.shape.children[0]!.get('fill')).toEqual(paint('red'))
        // The label of a span keeps clear of the sign: inside a bar that has room, and not under the sign.
        expect(right(failed.text!)).toBeLessThan(flow.x(40) - 13)
        // A light on the bar keeps its label and its sign bright.
        expect(flow.labelsOf(failed.shape)).toEqual([failed.shape, failed.sign, failed.text])
        expect(flow.labelsOf(flow.find('fine').shape)).toBe(flow.find('fine').children)
        // A copy has its own signs, at the same place among its parts.
        const copy = flow.clone()
        expect(copy.find('failed').sign).not.toBe(failed.sign)
        const eventCopy = failed.clone()
        expect(eventCopy.sign).not.toBe(failed.sign)
        expect(eventCopy.sign!.parent).toBe(eventCopy)
        await compileFilm(film(() => {
            // A bar that has room for its label alone has no room for the label and the sign: then the label is over the bar.
            const width = failed.text!.bounds().width
            const tight = (outcome: object) => lanes(['a'], [{ lane: 'a', start: 0, end: (width + 26 + 6) / 10, label: 'attempt', ...outcome }], { ...sized, domain: [0, 100] }).spans[0]!
            expect(tight({}).text!.bounds().y).toBeGreaterThan(-20)
            expect(bottom(tight({ outcome: 'failed' }).text!)).toBeLessThan(-20)
            // A label beside the bar starts after the sign.
            const beside = lanes(['a'], [{ lane: 'a', start: 0, end: 20, label: 'attempt', outcome: 'failed', labelSide: 'right' }], { ...sized, domain: [0, 100] }).spans[0]!
            expect(beside.text!.bounds().x).toBeGreaterThan(right(beside.sign!) + 7)
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: 10, outcome: 'broken' as never }])).toThrow(`lanes: event 0 has the outcome "broken". Use 'failed' or 'cancelled', or give it no outcome`)
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: 10, open: true, outcome: 'failed' }])).toThrow("lanes: the span of event 0 is `open`, and it has the outcome 'failed'. An open span has no end. Remove `open`, and end the span at the time when it fails")
        }))
    })

    it('stops a handoff that is lost beside the lane that it leaves, ends it with the sign, and counts no crossing for it', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['a', 'b', 'c'], [
                { lane: 'b', start: 0, end: 50 },
                { from: 'b', to: 'a', at: 20, outcome: 'failed', id: 'up', label: 'ack' },
                { from: 'b', to: 'c', at: 40, outcome: 'cancelled', id: 'down' },
                { from: 'a', to: 'b', at: 60, id: 'through' },
            ], { ...sized, domain: [0, 100], boundaries: [{ between: ['a', 'b'], label: 'network', count: true }] }))
            s.wait(1)
            s.play(flow.showAll(), { duration: 2, ease: linear })
            s.wait(1)
        }))
        const up = flow.find('up'), down = flow.find('down'), wall = flow.boundaries[0]!.children[0]!.bounds().y
        // The line leaves the bar of its lane, and the sign is at its other end, short of the boundary.
        expect(bottom(up.shape)).toBe(flow.y('b') - 20)
        expect(up.shape.children).toHaveLength(1)
        expect(bottom(up.sign!)).toBeCloseTo(up.shape.bounds().y, 6)
        expect(up.sign!.bounds().y).toBeGreaterThan(wall + 2)
        expect(middle(up.sign!)[0]).toBe(flow.x(20))
        // Without a boundary, it stops before the middle of the room, far from the other lane.
        expect(down.shape.bounds().y).toBe(flow.y('b') + 20)
        expect(bottom(down.sign!)).toBeLessThan((flow.y('b') + flow.y('c')) / 2 + 13)
        expect(bottom(down.sign!)).toBeLessThan(flow.y('c') - 20 - 10)
        expect([up.sign!.children[0]!.get('fill'), down.sign!.children[0]!.get('fill')]).toEqual([paint('red'), paint('orange')])
        // The label is beside the sign, clear of it.
        expect(up.text!.bounds().x).toBeGreaterThan(right(up.sign!) + 7)
        await compileFilm(film(() => {
            for (const from of [0, 1]) {
                const tight = lanes(['a', 'b'], [{ from, to: 1 - from, at: 2, outcome: 'failed' }], { domain: [0, 5], pitch: 68, boundaries: [{ between: [0, 1], count: true }] })
                const wall = tight.boundaries[0]!.children[0]!.bounds().y, disc = tight.handoffs[0]!.sign!
                expect(from === 0 ? wall - bottom(disc) : disc.bounds().y - wall).toBeGreaterThan(2)
            }
        }))
        // Only the handoff that arrives crosses the boundary.
        expect(flow.crossings('network')).toBe(1)
        // The line draws, and then the sign arrives.
        expect(at(1.3, () => shows(up))).toBe(0)
        expect(at(1.45, () => [shows(up), shows(up.sign!)])).toEqual([1, 0])
        expect(at(2.2, () => shows(up.sign!))).toBe(1)
    })

    it('draws a stretch where the lane is down as a hatched block in red with its label over it, and grows the hatch with the cursor', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['gpu'], [
                { lane: 0, start: 0, end: 30, label: 'runs' },
                { lane: 0, start: 30, end: 80, down: true, label: 'lost', id: 'out' },
                { lane: 0, start: 80, end: 100, down: true, open: true, color: 'dim', id: 'still' },
            ], sized))
            s.wait(1)
            s.play(flow.advance(55), { duration: 1, ease: linear })
            s.play(flow.showAll(), { duration: 1, ease: linear })
            s.wait(1)
        }))
        const out = flow.find('out'), still = flow.find('still')
        // A faint fill, an outline, and a hatch of slanted lines inside the block.
        expect([out.shape.get('fill'), out.shape.get('fillOpacity')]).toEqual([paint('red'), 0.14])
        expect(flow.spans[0]!.shape.get('fillOpacity')).toBe(0.5)
        expect([out.shape.get('stroke'), still.shape.get('stroke')]).toEqual([paint('red'), null])
        expect(still.shape.get('fill')).toEqual(paint('dim'))
        const hatch = at(4, () => out.edge!.get('path')!)
        expect(hatch.length).toBeGreaterThan(30)
        const reach = at(4, () => out.edge!.bounds())
        expect(reach.x).toBeGreaterThanOrEqual(flow.x(30))
        expect(reach.x + reach.width).toBeLessThanOrEqual(flow.x(80))
        expect([reach.y >= -20, reach.y + reach.height <= 20]).toEqual([true, true])
        expect(out.edge!.get('dash')).toBeNull()
        // The label is over the block and not inside it, where the hatch would cross the text.
        expect(bottom(out.text!)).toBeLessThan(out.shape.bounds().y)
        // The hatch grows with the block, and the lines that are there stay in place.
        const half = at(1.9, () => out.edge!.bounds())
        expect(half.x + half.width).toBeLessThanOrEqual(flow.x(49.5))
        expect(half.x + half.width).toBeGreaterThan(flow.x(49.5) - 15)
        const first = (path: readonly { p: Float64Array }[]) => [...path[0]!.p]
        expect(first(at(1.9, () => out.edge!.get('path')!))).toEqual(first(hatch))
        await compileFilm(film(() => {
            // A lane that is down does no work in that time.
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: 50, down: true }, { lane: 'a', start: 40, end: 60 }])).toThrow(/the spans of event 0 and event 1 overlap on the lane "a"/)
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: 50, down: true, idle: true }])).toThrow('lanes: the span of event 0 is `idle` and `down`. A lane that is down does not wait. Use one of the two')
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: 50, down: true, outcome: 'failed' }])).toThrow(/the span of event 0 is `down`, and it has an `outcome`/)
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: 90, id: 'turn' }, { lane: 'a', start: 0, end: 50, down: true, inside: 'turn' }])).toThrow(/the span of event 1 is `down`, and it has `inside`/)
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: 90, id: 'out', down: true }, { lane: 'a', start: 0, end: 50, inside: 'out' }])).toThrow(/event 1 is inside event 0, which is a stretch where the lane is down/)
        }))
    })

    it('checks the actual countdowns when two deadline labels share a row', async () => {
        await expect(compileFilm(film((s) => {
            const flow = lanes(['a'], [], { width: 900, domain: [0, 100], deadline: [
                { at: 40, label: (left) => left > 14 && left < 19 ? 'retry window closing' : 'retry' },
                { at: 58, label: () => 'stop' },
            ] })
            s.play(flow.advance(24), { duration: 2, ease: linear })
            s.wait(1)
        }))).rejects.toThrow(/touches the label of deadline .*while counting down/)
    })

    it('rejects overlapping advances on one cursor and chains consecutive advances', async () => {
        for (const overlap of [par, (...verbs: Anim[]) => lagged(verbs, { lag: 0.5 })]) {
            await expect(compileFilm(film((s) => {
                const flow = lanes(['a'], [{ lane: 0, start: 0, end: 10 }, { lane: 0, at: 2 }])
                s.play(overlap(flow.advance(5), flow.showAll()))
            }))).rejects.toThrow(/two advances overlap on the same cursor.*sequence/)
        }
        await compileFilm(film((s) => {
            const flow = lanes(['a'], [{ lane: 0, start: 0, end: 10 }])
            s.play(seq(flow.advance(5), flow.showAll()))
            expect(flow.time).toBe(10)
        }))
    })

    it('continues a clone from its visible cursor when the source has future advances', async () => {
        let copy!: Lanes<LaneTimelineEvent>
        await compileFilm(film((s) => {
            const flow = s.add(lanes(['a'], [{ lane: 0, start: 0, end: 10, id: 'work', outcome: 'failed' }], { deadline: { at: 8 } }))
            const holder = s.add(group(flow))
            s.play(flow.showAll(), { duration: 2, ease: linear })
            s.at(0.75, () => {
                const grouped = s.add(holder.clone()).children[0] as typeof flow
                copy = s.add(grouped.clone())
                expect(copy.time).toBeCloseTo(5)
                expect(copy.stateOf('work')).toBe('running')
                expect(copy.remaining()).toBeCloseTo(3)
                s.play(copy.advance(7), { duration: 1 })
                expect(copy.time).toBe(7)
                expect(grouped.time).toBeCloseTo(5)
                s.play(copy.showAll(), { duration: 1 })
            })
            expect(flow.time).toBe(10)
        }))
        expect(at(1.75, () => copy.cursor.get('x'))).toBeCloseTo(copy.x(7))
        expect(at(2.75, () => shows(copy.find('work').sign!))).toBe(1)
    })

    it('keeps a child mark label inside the span and measures a rotated event through its group', async () => {
        await compileFilm(film(() => {
            const flow = lanes(['request'], [
                { lane: 0, start: 0, end: 100, id: 'parent' },
                { lane: 0, start: 10, end: 80, inside: 'parent', id: 'generate' },
                { lane: 0, at: 78, inside: 'generate', id: 'token', label: 'first token' },
            ])
            const words = flow.find('token').text!.bounds()
            expect(words.x + words.width).toBeLessThan(flow.x(78))
            group(flow).rotate(0.4)
            const region = flow.region({ event: 'generate' })
            const shape = flow.find('generate').shape.bounds()
            // The region encloses the four corners of the bar, including its rounded ends.
            expect(region.width).toBeGreaterThanOrEqual(shape.width - 0.01)
            expect(region.height).toBeGreaterThanOrEqual(shape.height - 0.01)
        }))
    })

    it('stops the cursor at an event by its id, and gives the node, the time, the box and a point of an event', async () => {
        let flow!: Lanes<LaneTimelineEvent>
        await compileFilm(film({ fps: 20 }, (s) => {
            flow = s.add(lanes(['a', 'b'], [
                { lane: 'a', start: 10, end: 40, id: 'span' },
                { lane: 'b', at: 50, id: 'mark' },
                { from: 'a', to: 'b', at: 60, id: 'handoff' },
                { from: 'b', to: 'a', at: [70, 20], id: 'link' },
                { bracket: [20, 80], id: 'bracket' },
                { lane: 'b', start: 80, end: 90 },
            ], { ...sized, domain: [0, 100] }).at(60, 30))
            expect([flow.find('span'), flow.find(1), flow.find('link')]).toEqual([flow.events[0], flow.events[1], flow.events[3]])
            expect(flow.find('span').eventId).toBe('span')
            expect(flow.find(5).eventId).toBeNull()
            // The time of an event is the time when it is complete: the end of a span or a bracket, the later time of a link.
            expect(['span', 'mark', 'handoff', 'link', 'bracket'].map((id) => flow.timeOf(id))).toEqual([40, 50, 60, 70, 80])
            expect([flow.timeOf('span', 'start'), flow.timeOf('bracket', 'start'), flow.timeOf('mark', 'start')]).toEqual([10, 20, 50])
            expect(flow.stateOf('span')).toBe('ahead')
            s.play(flow.advance('span'), { duration: 1 })
            expect([flow.time, flow.stateOf('span'), flow.stateOf('mark')]).toEqual([40, 'done', 'ahead'])
            s.play(flow.advance('mark'), { duration: 1 })
            expect([flow.time, flow.stateOf('mark')]).toEqual([50, 'done'])
            // The cursor does not go back to an event that it passed.
            expect(() => flow.advance('span')).toThrow('lanes: cannot advance to 40. The cursor is at 50, and it does not go back')
            expect(() => flow.advance('nope')).toThrow('lanes: no event has the id "nope". The ids are "span", "mark", "handoff", "link", "bracket"')
            expect(() => flow.find(9)).toThrow('lanes: no event 9. The events are 0 to 5')
            expect(() => lanes(['a'], [{ lane: 'a', start: 0, end: 10 }]).find('x')).toThrow('lanes: no event has the id "x". No event has an id: give the event an `id`')
            expect(() => flow.timeOf('span', 'middle' as never)).toThrow("lanes: timeOf takes 'start' or 'end', and it got \"middle\"")
        }))
        // The cursor is at the time of the event when the advance ends.
        expect(at(1, () => flow.cursor.get('x'))).toBe(flow.x(40))
        expect(at(2, () => flow.cursor.get('x'))).toBe(flow.x(50))
        // The box of an event is the box of its complete shape, on the stage. The object is at (60, 30).
        const box = flow.region({ event: 'span' })
        expect([box.left, box.right, box.top, box.bottom]).toEqual([60 + flow.x(10), 60 + flow.x(40), 30 + flow.y('a') - 20, 30 + flow.y('a') + 20])
        const dot = flow.region({ event: 'mark' })
        expect([dot.cx, dot.cy]).toEqual([60 + flow.x(50), 30 + flow.y('b')])
        const arrow = flow.region({ event: 'handoff' })
        expect([arrow.cx, arrow.top, arrow.bottom]).toEqual([60 + flow.x(60), 30 + flow.y('a') + 20, 30 + flow.y('b') - 20])
        const line = flow.region({ event: 'bracket' })
        expect([line.left, line.right]).toEqual([60 + flow.x(20), 60 + flow.x(80)])
        expect(line.bottom).toBeLessThan(30 + flow.y('a') - 20)
        // A point on an event is in the coordinates of the object: the middle of its top by default.
        expect(flow.p('span')).toEqual([flow.x(25), flow.y('a') - 20])
        expect([flow.p('span', 'bottom'), flow.p('span', 'left'), flow.p('span', 'right')]).toEqual([[flow.x(25), flow.y('a') + 20], [flow.x(10), flow.y('a')], [flow.x(40), flow.y('a')]])
        expect(flow.toWorld(...flow.p('mark', 'top'))[0]).toBe(60 + flow.x(50))
        expect(() => flow.p('span', 'middle' as never)).toThrow("lanes: p takes the edge 'top', 'bottom', 'left' or 'right', and it got \"middle\"")
        expect(() => flow.region({ event: 'span', lane: 'a' })).toThrow('lanes: region takes `event` alone, and it also got `lane`. An event has its own lane and its own time')
    })

    it('places every label of the new parts so that the film check finds nothing, with a text gap of 0.3 and of 0.7', async () => {
        const build = (textGap: number) => checkFilm(film({ fps: 12 }, (s) => {
            const flow = s.add(lanes(
                ['caller', 'provider'],
                [
                    { lane: 'caller', start: 0, end: 20, idle: true, label: 'waits', outcome: 'failed' },
                    { from: 'caller', to: 'provider', at: 1, label: 'request' },
                    { lane: 'provider', start: 1, end: 7, label: 'attempt 1', outcome: 'failed', id: 'first' },
                    { lane: 'provider', start: 2, end: 5, inside: 'first', label: 'tool' },
                    { from: 'provider', to: 'provider', at: [7, 9], label: 'retry' },
                    { lane: 'provider', start: 9, end: 15, down: true, label: 'outage' },
                    { from: 'provider', to: 'caller', at: 16, label: 'reply', outcome: 'failed' },
                    { bracket: [20, 23], lane: 'provider', labelSide: 'under', label: 'late' },
                ],
                { width: 1300, pitch: 240, domain: [0, 24], ticks: [0, 8, 16, 24], deadline: { at: 20, drain: true, label: (left) => `${Math.ceil(left)} s left` } },
            ).at(80, 40))
            s.play(flow.enter(), { duration: 0.5 })
            s.play(flow.advance(8), { duration: 1 })
            s.wait(0.5)
            s.play(flow.showAll(), { duration: 1 })
            s.wait(0.5)
        }), { textGap, motion: true })
        expect((await build(0.3)).diagnostics).toEqual([])
        expect((await build(0.7)).diagnostics).toEqual([])
    })
})

describe('date line', () => {
    type Line = ReturnType<typeof dateLine>
    const RECORD = [
        { at: '2025-06-10', label: 'the newsletter', color: 'orange' },
        { at: '2026-03-24', label: 'the technical report', note: 'names Anyrun' },
        { at: 2020, label: 'the paper' },
    ]
    const CROWD = [
        { at: '2025-06-03', label: 'the first post' }, { at: '2025-06-10', label: 'the newsletter' }, { at: '2025-06-16', label: 'the second post', note: 'two weeks later' },
        { at: '2025-09-01', label: 'the conference talk' }, { at: '2025-12-12', label: 'the documentation' }, { at: '2026-03-24', label: 'the technical report', note: 'names Anyrun' },
        { at: '2026-03-30', label: 'the reply' },
    ]
    // Ten years on 1000 px. At size 20 a dot has a radius of 5.4, and the first and the last date are that far inside the ends of the line.
    const sized = { width: 1000, from: 2020, to: 2030, size: 20 }
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)
    const paint = (color: string) => rect(1, 1, { fill: color, stroke: null }).get('fill')
    const edges = (node: Node) => { const box = node.bounds(); return [box.x, box.y, box.x + box.width, box.y + box.height] as const }
    const middle = (node: Node) => { const box = node.bounds(); return [box.x + box.width / 2, box.y + box.height / 2] as const }
    /** The texts under the line, from left to right. */
    const numbers = (line: Line) => line.axis.children.filter((child) => typeof (child as unknown as { source?: unknown }).source === 'string')
    const written = (line: Line) => numbers(line).map((node) => (node as unknown as { source: string }).source)
    /** The room of the label of an event with its note: left, top, right, bottom. */
    const room = (event: Line['events'][number]) => {
        const boxes = [event.text!, ...(event.note ? [event.note] : [])].map(edges)
        return [Math.min(...boxes.map((box) => box[0])), Math.min(...boxes.map((box) => box[1])), Math.max(...boxes.map((box) => box[2])), Math.max(...boxes.map((box) => box[3]))] as const
    }
    const sideOf = (event: Line['events'][number]) => (event.text!.bounds().y < 0 ? 'over' : 'under')
    const stemOf = (event: Line['events'][number]) => edges(event.stem!)
    const labelOf = (event: Line['events'][number]) => edges(event.text!)
    type Events = Parameters<typeof dateLine>[0]
    type Options = NonNullable<Parameters<typeof dateLine>[1]>
    /** Random numbers from 0 to 1 that are the same in each run. */
    const randomOf = (seed: number) => {
        let state = (seed * 2654435761) >>> 0
        return () => {
            state = (state + 0x6d2b79f5) >>> 0
            let t = state
            t = Math.imul(t ^ (t >>> 15), t | 1)
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
    }
    /**
     * Builds a line that must fail, and reads the changes that its error names after "What works for this
     * line". `lines` builds the line with each of these changes, so a test can see that the advice is true.
     */
    const follow = (events: Events, options: Options = {}) => {
        let message = ''
        try {
            dateLine(events, options)
        } catch (error) {
            if (!(error instanceof Error)) throw error
            message = error.message
        }
        const ways = /What works for this line: (.+)$/.exec(message)?.[1]?.split(/, or |, | or /) ?? []
        const changed = (index: number, change: (event: Events[number]) => Events[number]) => events.map((event, at) => (at === index ? change(event) : event))
        const lines = ways.map((way) => {
            const number = /^(width|levels|rows): (\d+)$/.exec(way)
            if (number) return () => dateLine(events, { ...options, [number[1]!]: Number(number[2]) })
            const unit = /^unit: '(year|month|day)'$/.exec(way)
            if (unit) return () => dateLine(events, { ...options, unit: unit[1] as 'year' })
            if (way === 'no unit') return () => dateLine(events, { ...options, unit: undefined })
            if (way.startsWith("scale: 'order'")) return () => dateLine(events, { ...options, scale: 'order', from: undefined, to: undefined, unit: undefined })
            const end = /^(from|to): (.+)$/.exec(way)
            if (end) return () => dateLine(events, { ...options, [end[1]!]: JSON.parse(end[2]!) as string | number })
            const bare = /^no (side|label) for event (\d+)$/.exec(way)
            if (bare) return () => dateLine(changed(Number(bare[2]), (event) => (bare[1] === 'side' ? { ...event, side: undefined } : { at: event.at, mark: event.mark, color: event.color })), options)
            const side = /^side: '(over|under)' for event (\d+)$/.exec(way)
            if (side) return () => dateLine(changed(Number(side[2]), (event) => ({ ...event, side: side[1] as 'over' })), options)
            const date = /^at: (.+) for event (\d+)$/.exec(way)
            if (date) return () => dateLine(changed(Number(date[2]), (event) => ({ ...event, at: JSON.parse(date[1]!) as string | number })), options)
            throw new Error(`the test does not know the advice "${way}"`)
        })
        return { message, ways, lines }
    }

    it('puts each event at its date on a line of its width, and reads a year, a month, or a day', async () => {
        await compileFilm(film(() => {
            const line = dateLine(RECORD, sized).at(100, 50)
            // `.at()` places the middle of the line.
            expect(edges(line.axis.children[0]!)).toEqual([-400, 50, 600, 50])
            expect([2020, 2025, 2030].map((year) => line.x(year))).toEqual([expect.closeTo(-494.6, 6), expect.closeTo(0, 6), expect.closeTo(494.6, 6)])
            expect(line.domain).toEqual([2020, 2030])
            // A year is its first day, and a month is its first day. 2 July is the middle of a leap year: 183 of 366 days.
            const perYear = 989.2 / 10
            expect(line.x('2025')).toBeCloseTo(0, 6)
            expect(line.x('2024-07-02')).toBeCloseTo(-0.5 * perYear, 6)
            expect(line.x('2025-07')).toBeCloseTo((181 / 365) * perYear, 6)
            expect(line.x('2025-07-02')).toBeCloseTo((182 / 365) * perYear, 6)
            expect(line.x(2023.25)).toBeCloseTo(-1.75 * perYear, 6)
            // One node per event, in the order of the list. `p` is the place of its dot, in the coordinates of the object.
            expect(line.events.map((event) => event.text!.source)).toEqual(['the newsletter', 'the technical report', 'the paper'])
            expect(line.events.map((event) => event.note?.source)).toEqual([undefined, 'names Anyrun', undefined])
            expect(dateLine([{ at: 2021, label: 'a', note: ' ' }]).events[0]!.note).toBeNull()
            line.events.forEach((event, index) => {
                const [x, y] = line.p(index)
                expect([x, y]).toEqual([expect.closeTo(line.x(RECORD[index]!.at), 6), 0])
                expect(middle(event.mark)).toEqual([expect.closeTo(100 + x, 6), expect.closeTo(50, 6)])
                expect(event.children).toEqual([event.stem, event.halo, event.mark, event.text, ...(event.note ? [event.note] : [])])
            })
            expect(line.p(2)[0]).toBeCloseTo(-494.6, 6)
            // An event has its color on its dot, its stem and its label, or ink. A note is in dim.
            expect(line.events.map((event) => [event.mark.get('fill'), event.stem!.get('stroke'), event.text!.chars[0]!.get('fill')])).toEqual([
                [paint('orange'), paint('orange'), paint('orange')], [paint('ink'), paint('ink'), paint('ink')], [paint('ink'), paint('ink'), paint('ink')],
            ])
            expect(line.events[1]!.note!.chars[0]!.get('fill')).toEqual(paint('dim'))
            // Without `from` and `to`, the line holds the whole years around the events. It is 1600 wide.
            expect(dateLine([{ at: '2020-05-01', label: 'a' }, { at: '2026-03-24', label: 'b' }]).domain).toEqual([2020, 2027])
            expect(dateLine([{ at: 2021, label: 'a' }, { at: 2023, label: 'b' }]).domain).toEqual([2021, 2023])
            expect(dateLine([{ at: 2021, label: 'a' }]).domain).toEqual([2021, 2022])
            expect(edges(dateLine([{ at: 2021, label: 'a' }]).axis.children[0]!)).toEqual([-800, 0, 800, 0])
            // `from` and `to` take the same dates as an event.
            expect(dateLine([{ at: 2021, label: 'a' }], { from: '2020-07-02', to: '2022' }).domain).toEqual([2020.5, 2022])
            // A leap year is every fourth year, but for a year of a hundred that is not a year of four hundred: 1900 has no 29 February.
            expect(() => dateLine([{ at: '1900-02-29', label: 'a' }])).toThrow(/has the date "1900-02-29"/)
            expect(dateLine([{ at: '2000-02-29', label: 'a' }]).x('2000-03')).toBeGreaterThan(dateLine([{ at: '2000-02-29', label: 'a' }]).p(0)[0])
            // `font` reaches every text of the object: the label, the note, the numbers, and the words "not to scale".
            const glyph = (font: 'sans' | 'text-serif', letter: string, size: number, italic = false) => text(letter, { font, size, italic }).chars[0]!.get('path')
            for (const font of ['sans', 'text-serif'] as const) {
                const made = dateLine([{ at: '5.1', label: 'a', note: 'b' }], { scale: 'order', size: 20, ...(font === 'sans' ? {} : { font }) })
                const parts = numbers(made) as unknown as { chars: Node[] }[]
                expect([made.events[0]!.text!.chars[0]!.get('path'), made.events[0]!.note!.chars[0]!.get('path'), parts[0]!.chars[0]!.get('path'), parts[1]!.chars[0]!.get('path')])
                    .toEqual([glyph(font, 'a', 20), glyph(font, 'b', 17), glyph(font, '5', 18), glyph(font, 'n', 18, true)])
            }
            expect(glyph('sans', 'a', 20)).not.toEqual(glyph('text-serif', 'a', 20))
        }))
    })

    it('writes a number in the middle under a tick for each year, or for every second, fifth or tenth one and so on, so that two numbers never touch', async () => {
        await compileFilm(film(() => {
            const event = [{ at: 2022, label: 'a' }]
            const years = dateLine(event, sized)
            expect(years.unit).toBe('year')
            expect(written(years)).toEqual(['2020', '2021', '2022', '2023', '2024', '2025', '2026', '2027', '2028', '2029', '2030'])
            // The line, a tick for each year, and the numbers.
            expect(years.axis.children).toHaveLength(1 + 11 + 11)
            // A number is in the middle under its tick, in dim. The first and the last one too, so half of each passes the end of the line.
            const boxes = numbers(years).map(edges)
            boxes.forEach((box, index) => expect((box[0] + box[2]) / 2).toBeCloseTo(years.x(2020 + index), 6))
            expect(boxes[0]![0]).toBeLessThan(-510)
            expect(boxes[10]![2]).toBeGreaterThan(510)
            // `extent` and the bounds of the object hold these halves.
            expect([years.extent.left, years.extent.right]).toEqual([expect.closeTo(boxes[0]![0], 6), expect.closeTo(boxes[10]![2], 6)])
            expect([edges(years)[0], edges(years)[2]]).toEqual([expect.closeTo(boxes[0]![0], 6), expect.closeTo(boxes[10]![2], 6)])
            expect(boxes.every((box) => box[1] > 18 && box[3] < 34)).toBe(true)
            expect(numbers(years).map((node) => (node as unknown as { chars: Node[] }).chars[0]!.get('fill'))).toEqual(boxes.map(() => paint('dim')))
            // On a narrow line, a number for every second year, and still a tick for each year.
            const narrow = dateLine(event, { ...sized, width: 300 })
            expect(written(narrow)).toEqual(['2020', '2022', '2024', '2026', '2028', '2030'])
            expect(narrow.axis.children).toHaveLength(1 + 11 + 6)
            // The tick of a year with a number is longer than the tick of a year with none.
            const tickAt = (year: number) => narrow.axis.children.slice(1).find((child) => child.bounds().width === 0 && Math.abs(child.bounds().x - narrow.x(year)) < 0.01)!.bounds().height
            expect([tickAt(2024), tickAt(2030)]).toEqual([12, 12])
            expect(tickAt(2025)).toBeLessThan(8)
            // A year that is narrower than 0.3 of the text size has no small tick: 200 years on 400 px have the 5 ticks of the numbers.
            const dense = dateLine([{ at: 2000, label: 'a' }], { width: 400, from: 1900, to: 2100, size: 20 })
            expect(written(dense)).toEqual(['1900', '1950', '2000', '2050', '2100'])
            expect(dense.axis.children).toHaveLength(1 + 5 + 5)
            // The numbers are at round years, and the first year of the line has none when it is not round.
            expect(written(dateLine([{ at: 2000, label: 'a' }], { width: 600, from: 1974, to: 2018, size: 20 }))).toEqual(['1975', '1980', '1985', '1990', '1995', '2000', '2005', '2010', '2015'])
            expect(written(dateLine(event, { width: 1000, from: 2020.5, to: 2023.2, size: 20 }))).toEqual(['2021', '2022', '2023'])
            // A short line that holds no round year counts from its first year.
            expect(written(dateLine(event, { width: 60, from: 2021, to: 2024, size: 20 }))).toEqual(['2021'])
            // The step is 1, 2 or 5 times a power of ten, for any span: 12,000 years have a number for every 2,000.
            expect(written(dateLine([{ at: 0, label: 'a' }], { width: 900, from: -10000, to: 2000 }))).toEqual(['-10000', '-8000', '-6000', '-4000', '-2000', '0', '2000'])
            // At every width, two numbers are 10 px apart or more, and each one is in the middle under its tick.
            for (let width = 100; width <= 1600; width += 50) {
                for (const [from, to] of [[2020, 2030], [1974, 2018], [1900, 2100], [2021, 2024], [-10000, 2000], [-500000, 2000]] as const) {
                    const line = dateLine([{ at: from, label: 'a' }], { width, from, to, size: 20 })
                    const made = numbers(line).map(edges)
                    expect(made.length).toBeGreaterThan(0)
                    made.forEach((box, index) => {
                        expect((box[0] + box[2]) / 2).toBeCloseTo(line.x(Number(written(line)[index])), 6)
                        if (index > 0) expect(box[0] - made[index - 1]![2]).toBeGreaterThanOrEqual(10)
                    })
                }
            }
        }))
    })

    it('has a tick for each month or for each day on a short line, with the name of the month or the number of the day, and the year or the month at the first tick', async () => {
        await compileFilm(film(() => {
            const span = (from: string, to: string, options: Parameters<typeof dateLine>[1] = {}) => dateLine([{ at: from }, { at: to }], options)
            // 17 months: a tick for each month. The line holds the whole months around the events.
            const months = span('2025-06-09', '2026-11-06', { width: 1720 })
            expect(months.unit).toBe('month')
            expect(months.domain).toEqual([expect.closeTo(2025 + 151 / 365, 9), expect.closeTo(2026 + 334 / 365, 9)])
            // The first tick says the year too, and each January has the number of its year in place of its name.
            expect(written(months)).toEqual(['Jun 2025', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', '2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
            expect(months.axis.children).toHaveLength(1 + 19 + 19)
            numbers(months).map(edges).forEach((box, index) => expect((box[0] + box[2]) / 2).toBeCloseTo(months.x(index < 7 ? `2025-${String(index + 6).padStart(2, '0')}` : `2026-${String(index - 6).padStart(2, '0')}`), 6))
            // With less room: a name for every second month, then for every third and every sixth one, counted from January. Each month keeps its tick.
            const half = span('2025-06-09', '2026-11-06', { width: 860 })
            expect(written(half)).toEqual(['Jun 2025', 'Sep', 'Nov', '2026', 'Mar', 'May', 'Jul', 'Sep', 'Nov'])
            expect(half.axis.children).toHaveLength(1 + 19 + 9)
            expect(written(span('2025-06-09', '2026-11-06', { width: 430 }))).toEqual(['Jun 2025', 'Oct', '2026', 'Apr', 'Jul', 'Oct'])
            expect(written(span('2025-06-09', '2026-11-06', { width: 200 }))).toEqual(['Jul', '2026', 'Jul'])
            // Six days: a tick for each day with its number. The first tick says the month and the year too.
            const days = dateLine(['05', '06', '07', '08', '09', '10'].map((day) => ({ at: `2025-05-${day}` })))
            expect(days.unit).toBe('day')
            expect(days.domain).toEqual([expect.closeTo(2025 + 124 / 365, 9), expect.closeTo(2025 + 129 / 365, 9)])
            expect(written(days)).toEqual(['May 5, 2025', '6', '7', '8', '9', '10'])
            // A line of days that starts at the first day of a month, and a line of months that starts in January.
            expect(written(span('2025-05-01', '2025-05-06'))).toEqual(['May 2025', '2', '3', '4', '5', '6'])
            expect(written(span('2025-01-10', '2025-05-02'))).toEqual(['2025', 'Feb', 'Mar', 'Apr', 'May', 'Jun'])
            // The first day of a month has the name of the month. With less room: every second, seventh or fourteenth day, counted from that first day.
            expect(written(span('2025-05-20', '2025-06-29'))).toEqual(['May 20, 2025', '23', '25', '27', '29', 'Jun', '3', '5', '7', '9', '11', '13', '15', '17', '19', '21', '23', '25', '27', '29'])
            expect(written(span('2025-05-20', '2025-06-29', { width: 700 }))).toEqual(['May 20, 2025', 'Jun', '8', '15', '22'])
            // A text that would touch the text of the first tick has none: here the 15 of January.
            expect(written(span('2025-01-10', '2025-05-02', { unit: 'day' }))).toEqual(['Jan 10, 2025', '22', 'Feb', '8', '15', '22', 'Mar', '8', '15', '22', 'Apr', '8', '15', '22', 'May'])
            // Each of these 113 days has a tick, at 14 px for a day. At 6 px for a day, which is less than 0.3 of the text size, the line has the ticks of its texts only.
            expect(span('2025-01-10', '2025-05-02', { unit: 'day' }).axis.children).toHaveLength(1 + 113 + 15)
            const fewer = span('2025-01-10', '2025-05-02', { unit: 'day', width: 700 })
            expect(written(fewer)).toEqual(['Jan 10, 2025', 'Feb', '15', 'Mar', '15', 'Apr', '15', 'May'])
            expect(fewer.axis.children).toHaveLength(1 + 8 + 8)
            // Without `unit`, the span decides: days up to 45 days, months under 2 years, and years from 2 years. One date has the year around it.
            expect([span('2025-05-20', '2025-07-04').unit, span('2025-05-20', '2025-07-05').unit]).toEqual(['day', 'month'])
            expect([span('2025-02-20', '2027-02-19').unit, span('2025-02-20', '2027-02-20').unit]).toEqual(['month', 'year'])
            expect([dateLine([{ at: '2025-05-03' }]).unit, dateLine([{ at: '2025-05-03' }]).domain]).toEqual(['year', [2025, 2026]])
            // `from` and `to` are the span when the film gives them, and they take a date as a text.
            const given = dateLine([{ at: '2025-07-03' }], { from: '2025-06', to: '2025-09-15' })
            expect([given.unit, written(given)]).toEqual(['month', ['Jun 2025', 'Jul', 'Aug', 'Sep']])
            expect(written(dateLine([{ at: '2025-05-03' }], { from: 2025, to: 2026 }))).toEqual(['2025', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', '2026'])
            // The unit of the film wins over the span.
            const forced = span('2025-06-09', '2026-11-06', { unit: 'year' })
            expect([forced.unit, forced.domain, written(forced)]).toEqual(['year', [2025, 2027], ['2025', '2026', '2027']])
            // When the texts of the unit of the span have no room, the line has the ticks of the next unit.
            expect([span('2025-05-20', '2025-06-29', { width: 120 }).unit, written(span('2025-05-20', '2025-06-29', { width: 120 }))]).toEqual(['month', ['May 2025', 'Jul']])
            // A unit of the film that has no room, or no tick on the line, is an error.
            const noRoom = follow([{ at: 2000 }, { at: 2030 }], { unit: 'month' })
            expect(noRoom.message).toBe("dateLine: the line from 2000 to 2030 has no room for a tick for each month at a width of 1600: their texts touch, also at every sixth month. What works for this line: no unit, unit: 'year', or width: 4800")
            const noYear = follow([{ at: 2025.3 }], { from: 2025.2, to: 2025.6, unit: 'year' })
            expect(noYear.message).toBe("dateLine: the line from 2025.2 to 2025.6 holds the start of no year, so it has no tick. What works for this line: no unit, or unit: 'month'")
            for (const line of [...noRoom.lines, ...noYear.lines]) expect(line).not.toThrow()
            expect(() => dateLine([{ at: 2000 }, { at: 2002 }], { unit: 'day', width: 900 })).toThrow(/has no room for a tick for each day at a width of 900: their texts touch, also at every fourteenth day\. What works for this line: no unit, or unit: 'month'/)
            expect(written(dateLine([{ at: 2025.3 }], { from: 2025.2, to: 2025.6 }))).toEqual(['Apr 2025', 'May', 'Jun', 'Jul', 'Aug'])
            expect(() => dateLine([{ at: 2021 }], { unit: 'week' as never })).toThrow(/unit is 'year', 'month' or 'day', not "week"/)
            expect(() => dateLine([{ at: 2021 }], { unit: 'day', scale: 'order' })).toThrow(/unit is the tick of a line with scale 'time'\. With 'order', each event has its own tick/)
        }))
    })

    it('puts the labels over the line and under it by turns in date order, each one at the end of a stem from its dot, with its note under it', async () => {
        await compileFilm(film(() => {
            const line = dateLine(RECORD, sized)
            // In date order: the paper is over the line, the newsletter under it, and the report over it.
            expect(line.events.map(sideOf)).toEqual(['under', 'over', 'over'])
            // The order of the list changes nothing: the dates decide.
            const turned = dateLine([RECORD[2]!, RECORD[0]!, RECORD[1]!], sized)
            expect([turned.events[1]!, turned.events[2]!, turned.events[0]!].map(labelOf)).toEqual(line.events.map(labelOf))
            const [news, report, paper] = line.events as [Line['events'][number], Line['events'][number], Line['events'][number]]
            // A label is in the middle over the end of its stem. A label at an end of the line starts at that end, and its stem is under it.
            expect(Math.abs(middle(news.text!)[0] - line.p(0)[0])).toBeLessThan(1.5)
            expect(Math.abs(middle(report.text!)[0] - line.p(1)[0])).toBeLessThan(1.5)
            expect(labelOf(paper)[0]).toBeCloseTo(-500, 6)
            expect(labelOf(paper)[2]).toBeGreaterThan(line.p(2)[0])
            // The stem goes from the line to a little short of the label.
            const [, overTop, , overBottom] = stemOf(report)
            expect(overBottom).toBe(0)
            expect(overTop).toBeLessThan(-20)
            expect(overTop - room(report)[3]).toBeGreaterThan(1)
            expect(overTop - room(report)[3]).toBeLessThan(8)
            expect(stemOf(report)[0]).toBeCloseTo(line.p(1)[0], 6)
            // Under the line, the label is under the numbers, and the stem ends short of it.
            const [, underTop, , underBottom] = stemOf(news)
            expect(underTop).toBeGreaterThan(Math.max(...numbers(line).map((node) => edges(node)[3])) + 2)
            expect(room(news)[1]).toBeGreaterThan(Math.max(...numbers(line).map((node) => edges(node)[3])) + 10)
            expect(room(news)[1] - underBottom).toBeGreaterThan(1)
            expect(room(news)[1] - underBottom).toBeLessThan(8)
            // The note is under its label, in the middle, and smaller.
            const note = edges(report.note!), words = labelOf(report)
            expect(note[1]).toBeGreaterThan(words[3] + 2)
            expect(note[1]).toBeLessThan(words[3] + 10)
            expect(Math.abs((note[0] + note[2]) / 2 - (words[0] + words[2]) / 2)).toBeLessThan(1.5)
            expect([report.text!.data['size'], report.note!.data['size']]).toEqual([20, 17])
        }))
    })

    it('starts a stem under the line under the row of the texts, at the x of its mark, so that it touches no text', async () => {
        await compileFilm(film(() => {
            const rowOf = (made: Line) => { const boxes = numbers(made).map(edges); return [Math.min(...boxes.map((box) => box[1])), Math.max(...boxes.map((box) => box[3]))] as const }
            // The second event of each line is under the line, in its turn: at a tick, over the text of a tick and not at the tick, beside a text, and between two texts.
            for (const at of [2022, 2022.1, 2022.3, 2022.5]) {
                const line = dateLine([{ at: 2020, label: 'a' }, { at, label: 'b' }], sized)
                const event = line.events[1]!, stem = stemOf(event), [, bottom] = rowOf(line)
                expect(sideOf(event)).toBe('under')
                // The stem is at the x of the mark. It starts under the row of the texts, and ends short of its label.
                expect(stem[0]).toBeCloseTo(line.p(1)[0], 6)
                expect(stem[1] - bottom).toBeGreaterThan(2)
                expect(stem[3]).toBeGreaterThan(stem[1] + 4)
                expect(room(event)[1] - stem[3]).toBeGreaterThan(1)
                // So it passes through no text and beside none: every text under the line ends over it.
                for (const box of numbers(line).map(edges)) expect(stem[1] - box[3]).toBeGreaterThan(2)
                expect(room(event)[1] - bottom).toBeGreaterThan(10)
            }
            // A stem over the line starts at its mark.
            expect(stemOf(dateLine([{ at: 2020.4, label: 'a' }], sized).events[0]!)[3]).toBe(0)
            // The row of the texts ends under the tails of their letters, as the y of "May".
            const days = dateLine([{ at: '2025-05-05', label: 'a' }, { at: '2025-05-06', label: 'b' }])
            expect(sideOf(days.events[1]!)).toBe('under')
            expect(rowOf(days)[1]).toBeGreaterThan(edges(numbers(days)[1]!)[3] + 3)
            expect(stemOf(days.events[1]!)[1] - rowOf(days)[1]).toBeGreaterThan(2)
        }))
    })

    it('has the room of all its events as its bounds from the start, so a zone holds the labels that are still hidden', async () => {
        let line!: Line, around!: ReturnType<typeof zone>
        await compileFilm(film({ fps: 20 }, (s) => {
            line = dateLine(RECORD, sized)
            // `extent` is the room of the line with all its labels, in the coordinates of the object.
            expect(line.extent.top).toBeCloseTo(Math.min(...line.events.map((event) => room(event)[1])), 0)
            expect(line.extent.bottom).toBeGreaterThanOrEqual(Math.max(...line.events.map((event) => room(event)[3])) - 0.5)
            expect(line.extent.bottom).toBeLessThan(Math.max(...line.events.map((event) => room(event)[3])) + 8)
            expect(line.extent.left).toBeLessThanOrEqual(-500)
            expect(line.extent.right).toBeGreaterThanOrEqual(500)
            // The events are hidden, and the bounds of the object are this room.
            expect(line.events.map((event) => event.get('visible'))).toEqual([false, false, false])
            const whole = [line.extent.left, line.extent.top, line.extent.right, line.extent.bottom].map((value) => expect.closeTo(value, 6))
            expect(edges(line)).toEqual(whole)
            // `.at()` still places the middle of the line.
            line.at(100, 50)
            expect(edges(line.axis.children[0]!)).toEqual([-400, 50, 600, 50])
            line.at(0, 0)
            around = zone(line, { padding: 30 })
            s.add(around)
            s.play(line.showAll(), { duration: 1 })
        }))
        // The border of the zone is 30 px from the room of the labels, before the events show and after.
        for (const time of [0, 1.5]) {
            at(time, () => {
                const border = edges(around.frame), inside = edges(line)
                expect([inside[0] - border[0], inside[1] - border[1], border[2] - inside[2], border[3] - inside[3]]).toEqual([30, 30, 30, 30].map((value) => expect.closeTo(value, 6)))
                for (const event of line.events) {
                    const own = room(event)
                    expect([own[0] >= border[0] + 30 - 0.5, own[1] >= border[1] + 30 - 0.5, own[2] <= border[2] - 30 + 0.5, own[3] <= border[3] - 30 + 0.5]).toEqual([true, true, true, true])
                }
            })
        }
        expect(at(1.5, () => line.events.map((event) => event.get('visible')))).toEqual([true, true, true])
    })

    it('finds a place for every label of a crowd: no two labels meet, no stem passes through a label, and all of them are inside the line', async () => {
        await compileFilm(film(() => {
            const same = [{ at: 2021, label: 'first of the year' }, { at: 2021, label: 'second of the year' }, { at: 2021, label: 'third' }, { at: 2021, label: 'fourth' }, { at: 2023, label: 'alone' }]
            // Three long labels at one side: the second one goes up, and the third one must not sit on the stem of the second.
            const tall = [{ at: 2021, label: 'a first label that is long and wide' }, { at: 2023.3, label: 'a second label, long too' }, { at: 2023.9, label: 'the third label is long' }].map((event) => ({ ...event, side: 'over' as const }))
            // Three events at the last end of the line: a label beside its stem has room at the left only.
            const late = ['a long label one', 'a long label two', 'a long label three'].map((label) => ({ at: 2029.9, label }))
            const lines = [
                dateLine(CROWD, { width: 1800, from: 2025, to: 2027 }), dateLine(same, { width: 700, from: 2020, to: 2024, size: 22 }),
                dateLine(tall, { width: 800, from: 2020, to: 2025, size: 20 }), dateLine(late, sized),
            ]
            for (const line of lines) {
                const half = line.axis.children[0]!.bounds().width / 2
                const rooms = line.events.map(room)
                rooms.forEach((own, index) => {
                    expect(own[0]).toBeGreaterThanOrEqual(-half - 0.5)
                    expect(own[2]).toBeLessThanOrEqual(half + 0.5)
                    rooms.forEach((other, at) => {
                        if (at <= index) return
                        // Two labels have room between them: beside each other, or one over the other.
                        const beside = Math.max(other[0] - own[2], own[0] - other[2]), over = Math.max(other[1] - own[3], own[1] - other[3])
                        expect(Math.max(beside, over)).toBeGreaterThan(2)
                    })
                    line.events.forEach((other, at) => {
                        if (at === index) return
                        const [x, top, , bottom] = stemOf(other)
                        const passes = x > own[0] - 2 && x < own[2] + 2 && top < own[3] && bottom > own[1]
                        expect(passes).toBe(false)
                    })
                })
            }
            // Three events in two weeks: their labels are at more than one place around their dots, and the labels of one row are 18 px apart or more.
            const [first, news, second] = lines[0]!.events
            expect(new Set([first, news, second].map((event) => `${sideOf(event!)} ${Math.round(labelOf(event!)[0])}`)).size).toBe(3)
            // Four events of one date use more than one height, and their stems are on one line.
            const year = lines[1]!.events.slice(0, 4)
            expect(new Set(year.map((event) => Math.round(labelOf(event)[1]))).size).toBeGreaterThan(1)
            expect(new Set(year.map((event) => Math.round(stemOf(event)[0]))).size).toBe(1)
            // A label beside its stem: the far end of the stem is at the height of the label, not short of it.
            const flag = year.find((event) => labelOf(event)[0] > stemOf(event)[0] + 2)!
            const far = sideOf(flag) === 'over' ? stemOf(flag)[1] : stemOf(flag)[3]
            expect(far).toBeGreaterThan(labelOf(flag)[1])
            expect(far).toBeLessThan(labelOf(flag)[3])
        }))
    })

    it('keeps the side that an event asks for, and ends each error of a layout with the changes that work for that line', async () => {
        await compileFilm(film(() => {
            const under = dateLine(RECORD.map((event) => ({ ...event, side: 'under' as const })), sized)
            expect(under.events.map(sideOf)).toEqual(['under', 'under', 'under'])
            const over = dateLine(RECORD.map((event) => ({ ...event, side: 'over' as const })), sized)
            expect(over.events.map(sideOf)).toEqual(['over', 'over', 'over'])
            // An event with a side has fewer places, so it takes its place first. The newsletter is near it, and goes to the other side.
            expect(dateLine([RECORD[0]!, { ...RECORD[1]!, side: 'under' as const }, RECORD[2]!], sized).events.map(sideOf)).toEqual(['over', 'under', 'over'])
            expect(dateLine([RECORD[0]!, RECORD[1]!, { ...RECORD[2]!, side: 'under' as const }], sized).events.map(sideOf)).toEqual(['under', 'over', 'under'])

            // An error of a layout ends with the changes that work for its line. The object builds the line with each one, so each one is true.
            const same = ['first of the year', 'second of the year', 'third', 'fourth', 'fifth', 'sixth', 'seventh'].map((label) => ({ at: 2021, label }))
            const tight = { width: 700, from: 2020, to: 2024, size: 22 }
            const cases: [Events, Options, string][] = [
                // Seven events of one date have no room at one height, and four have room at two.
                [same, { ...tight, levels: 1 }, 'the label of event 2 ("third") has no place. It meets the label of event 0 ("first of the year") at every height. What works for this line: levels: 4'],
                [same.slice(0, 4), { ...tight, levels: 1 }, 'the label of event 2 ("third") has no place. It meets the label of event 0 ("first of the year") at every height. What works for this line: levels: 2'],
                [[{ at: 2021, label: 'a label that is much wider than the line of this object' }], { width: 300 }, 'the label of event 0 ("a label that is much wider than the line of this object") is 637 px wide, and the line is 300. What works for this line: width: 638, or no label for event 0'],
                // A side that has no place: only the side helps, so the advice is the side. The label of a mark in a row goes over the line.
                [[{ at: 2021 }, { at: 2021, label: 'a', side: 'under' }], {}, "the label of event 1 (\"a\") has no place under the line. Its mark is in a row over the line, where a label goes over the line. What works for this line: no side for event 1, side: 'over' for event 1, or no label for event 1"],
                [[{ at: '2025-06-10', label: 'a', side: 'over' }, { at: '2025-06-12', label: 'b' }], { from: 2020, to: 2027, width: 1180 }, "the label of event 0 (\"a\") has no place over the line. The mark of event 1 (\"b\") is in its way. What works for this line: no side for event 0, side: 'under' for event 0, or at: \"2025-06-12\" for event 0"],
                // Three events with labels in a few days: the mark in the middle row has a mark under it and a mark over it.
                [[{ at: '2025-06-10', label: 'a' }, { at: '2025-06-12', label: 'b' }, { at: '2025-06-14', label: 'c' }], { from: 2020, to: 2027, width: 1180 }, "the label of event 1 (\"b\") has no place. The mark of event 2 (\"c\") is in its way. What works for this line: at: \"2025-06-14\" for event 1, no label for event 1, or scale: 'order' without the ends and the unit of the line"],
                [Array.from({ length: 4 }, () => ({ at: 2021 })), { rows: 3 }, 'the marks near event 3 (at 2021) need 4 rows, and `rows` is 3. What works for this line: rows: 4'],
                [[{ at: '2025-06-03', label: 'a' }, { at: '2025-06-04', label: 'b' }], { scale: 'order', width: 300 }, 'the dates "2025-06-03" and "2025-06-04" touch under the line. What works for this line: width: 450'],
                [[{ at: 2021, label: 'a' }], { scale: 'order', width: 100 }, 'a width of 100 has no room for the events before the words "not to scale". What works for this line: width: 217'],
                [[{ at: 2021, label: 'a' }], { width: 40 }, 'a width of 40 has no room for the events. What works for this line: width: 68'],
                [[{ at: 2019, label: 'a' }], { from: 2020, to: 2027 }, 'event 0 ("a") is at 2019, outside the line from 2020 to 2027. What works for this line: from: 2019'],
                [[{ at: '2028-07', label: 'late' }], { from: 2020, to: 2027 }, 'event 0 ("late") is at "2028-07", outside the line from 2020 to 2027. What works for this line: to: "2028-07"'],
            ]
            for (const [events, options, message] of cases) {
                const failed = follow(events, options)
                expect(failed.message).toBe(`dateLine: ${message}`)
                expect(failed.lines.length).toBeGreaterThan(0)
                for (const line of failed.lines) expect(line).not.toThrow()
            }
            // More heights give more labels a place, and a line that builds has no error.
            expect(() => dateLine(same.slice(0, 2), { ...tight, levels: 1 })).not.toThrow()
            expect(() => dateLine(same.slice(0, 4), { ...tight, levels: 3 })).not.toThrow()
            // When no change of one option works, the error says so.
            expect(() => dateLine(Array.from({ length: 12 }, (_, index) => ({ at: 2021, label: `event ${index}` })), { ...tight, levels: 1 })).toThrow(/has no place\. It meets the label of event \d+ \("event \d+"\) at every height\. No one change of an option gives this line a layout\. Use fewer events, or two lines$/)
        }))
    })

    it('puts the events at equal steps in date order with scale order, writes each date as the film gave it, and says that the line is not to scale', async () => {
        await compileFilm(film(() => {
            const line = dateLine([{ at: '5.10', label: 'ten' }, { at: '5.1', label: 'one' }, { at: '6.0', label: 'six' }, { at: '5.3', label: 'three' }, { at: '5.3', label: 'three again' }], { width: 1000, scale: 'order', size: 20 })
            // Four versions in their order: 5.10 is after 5.3. The words at the end of the line take their room.
            expect(written(line)).toEqual(['5.1', '5.3', '5.10', '6.0', 'not to scale'])
            const xs = ['5.1', '5.3', '5.10', '6.0'].map((version) => line.x(version))
            const step = xs[1]! - xs[0]!
            expect(step).toBeGreaterThan(200)
            expect([xs[2]! - xs[1]!, xs[3]! - xs[2]!, xs[0]! + 500]).toEqual([expect.closeTo(step, 6), expect.closeTo(step, 6), expect.closeTo(step / 2, 6)])
            // Two events of one date have one place.
            expect([0, 1, 2, 3, 4].map((index) => line.p(index)[0])).toEqual([xs[2], xs[0], xs[3], xs[1], xs[1]])
            // Each date is under its tick, in ink. "not to scale" ends at the end of the line, after the last date.
            const boxes = numbers(line).map(edges)
            boxes.slice(0, 4).forEach((box, index) => expect(Math.abs((box[0] + box[2]) / 2 - xs[index]!)).toBeLessThan(1.5))
            expect((numbers(line)[0] as unknown as { chars: Node[] }).chars[0]!.get('fill')).toEqual(paint('ink'))
            expect(boxes[4]![2]).toBeCloseTo(500, 6)
            expect(boxes[4]![0]).toBeGreaterThan(xs[3]! + step / 2)
            // The words are in the row of the dates.
            expect(Math.abs((boxes[4]![1] + boxes[4]![3]) / 2 - (boxes[0]![1] + boxes[0]![3]) / 2)).toBeLessThan(3)
            // An event is known by its date as the film wrote it. "5.1" and "5.1.0" are two texts, so they have two places, in the order of the list.
            const texts = dateLine([{ at: '5.1', label: 'a' }, { at: '5.1.0', label: 'b' }, { at: '5.1', label: 'c' }, { at: '6', label: 'd' }], { scale: 'order' })
            expect(written(texts)).toEqual(['5.1', '5.1.0', '6', 'not to scale'])
            expect([texts.p(0)[0], texts.p(1)[0], texts.p(2)[0]]).toEqual([texts.x('5.1'), texts.x('5.1.0'), texts.x('5.1')])
            expect(texts.x('5.1.0')).toBeGreaterThan(texts.x('5.1') + 100)
            expect(line.domain).toEqual([-0.5, 3.5])
            // With dates, the steps are equal too, whatever the time between the dates. A date is written as the film gave it.
            const dates = dateLine([{ at: '2026-03-24', label: 'c' }, { at: 2020, label: 'a' }, { at: '2025-06', label: 'b' }], { width: 1000, scale: 'order', size: 20 })
            expect(written(dates)).toEqual(['2020', '2025-06', '2026-03-24', 'not to scale'])
            expect(dates.x('2025-06') - dates.x(2020)).toBeCloseTo(dates.x('2026-03-24') - dates.x('2025-06'), 6)
            // A line with scale time says nothing of its scale.
            expect(written(dateLine(RECORD, sized))).not.toContain('not to scale')
            // The line has a place for the dates of its events, and for no other.
            expect(() => line.x('5.2')).toThrow(/the line has no place for "5\.2"\. With scale 'order', it has the dates of its events: "5\.1", "5\.3", "5\.10", "6\.0"/)
            expect(() => line.advance('7.0')).toThrow(/the line cannot advance to "7\.0"/)
            expect(() => dateLine([{ at: '5.1', label: 'a' }, { at: '2025-06-10', label: 'b' }], { scale: 'order' })).toThrow(/event 1 \("b"\) has the date "2025-06-10"\. With scale 'order', give every event a date .*, or give every event a version such as '5\.1'/)
            expect(() => dateLine([{ at: 'v5', label: 'a' }, { at: '5.1', label: 'b' }], { scale: 'order' })).toThrow(/event 0 \("a"\) has the date "v5"/)
            expect(() => dateLine([{ at: 2021, label: 'a' }], { scale: 'order', from: 2020 })).toThrow(/from and to are the ends of a line with scale 'time'/)
            expect(() => dateLine([{ at: 2021, label: 'a' }], { scale: 'order', width: 100 })).toThrow(/a width of 100 has no room for the events before the words "not to scale"/)
            // A version is not a date on a line with scale time.
            expect(() => dateLine([{ at: '5.1', label: 'a' }])).toThrow(/event 0 \("a"\) has the date "5\.1"\. A date is 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', or a number of years/)
        }))
    })

    it('moves its cursor to a date and stops there, and each event appears when the cursor passes it', async () => {
        let line!: Line, bare!: Line, stops!: Line
        const dates: number[] = []
        const events = [{ at: 2020, label: 'a' }, { at: 2022, label: 'b', note: 'n' }, { at: 2024, label: 'c' }, { at: 2030, label: 'd' }]
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            line = s.add(dateLine(events, sized))
            bare = s.add(dateLine(events, { ...sized, cursor: false }).at(0, 300))
            // This one is not on the stage: its first advance brings it.
            stops = dateLine(events, sized).at(0, -300)
            dates.push(line.date)
            s.wait(1)
            s.play(line.advance(2025), bare.advance(2025), stops.advance(2022), { duration: 2, ease: linear })
            dates.push(line.date)
            s.wait(1)
            s.play(seq(line.advance('2026'), line.advance(2028)), stops.advance(2024), { duration: 2, ease: linear })
            dates.push(line.date)
            s.play(line.showAll(), { duration: 2, ease: linear })
            dates.push(line.date)
            s.wait(0.5)
        }))
        expect(dates).toEqual([2020, 2025, 2028, 2030])
        const [a, b, c, d] = line.events as [Line['events'][number], Line['events'][number], Line['events'][number], Line['events'][number]]
        const cursor = (time: number) => at(time, () => (line.cursor.get('visible') ? line.cursor.get('x') : null))
        // A fade that ends at the time of the reading is 1 but for the last digits.
        const one = expect.closeTo(1, 6)
        // Before the first advance, the film draws the two lines with their ticks and numbers, and no event or cursor:
        // a line, 11 ticks, and 11 numbers of 4 digits each. The third line comes with its first advance.
        expect(compiled.frame(0.5).ops).toHaveLength(2 * 56)
        expect(compiled.frame(1.05).ops.length).toBeGreaterThan(3 * 56)
        // An event at the date where the cursor stops shows once: the next advance leaves it as it is.
        const [first, stopped] = stops.events
        expect(at(3.9, () => [shows(first!.text!), shows(stopped!.text!), stopped!.mark.get('opacity'), stopped!.stem!.get('trimTo')])).toEqual([1, 1, 1, 1])
        for (const time of [4.02, 4.3]) expect(at(time, () => [shows(first!.text!), first!.mark.get('opacity'), shows(stopped!.text!), stopped!.mark.get('opacity'), stopped!.stem!.get('trimTo')])).toEqual([1, 1, 1, 1, 1])
        expect(at(0.5, () => [a, b, c, d].map(shows))).toEqual([0, 0, 0, 0])
        expect(cursor(0.5)).toBeNull()
        // The last event of this advance needs 0.5 s after the cursor reaches it, so the cursor arrives 0.125 s
        // before the end. It reaches 2022 at 1.75 s and 2024 at 2.5 s, and stops at 2025.
        expect([cursor(1), cursor(1.9375), cursor(2.875), cursor(3), cursor(3.9)]).toEqual([expect.closeTo(line.x(2020), 6), expect.closeTo(line.x(2022.5), 6), expect.closeTo(line.x(2025), 6), expect.closeTo(line.x(2025), 6), expect.closeTo(line.x(2025), 6)])
        // The first advance shows the cursor, in 0.3 s.
        expect([1, 1.15, 1.3].map((time) => at(time, () => line.cursor.get('opacity')))).toEqual([0, expect.closeTo(0.5, 6), 1])
        // An event at the first end of the line appears with the first advance.
        expect(at(1.01, () => a.get('visible'))).toBe(true)
        expect(at(1.74, () => [b, c, d].map(shows))).toEqual([0, 0, 0])
        // The dot and the stem come first, and the stem draws from the line. Then the label and the note.
        expect(at(1.875, () => [b.get('visible'), b.mark.get('opacity'), b.stem!.get('trimTo'), shows(b.text!), shows(b.note!)])).toEqual([true, expect.closeTo(0.5, 2), expect.closeTo(0.5, 2), 0, 0])
        expect(at(2.25, () => [b.mark.get('opacity'), b.mark.get('sx'), b.stem!.get('trimTo'), shows(b.text!), shows(b.note!)])).toEqual([1, 1, 1, one, one])
        expect(at(2.49, () => c.get('visible'))).toBe(false)
        // All of it is over when the animation ends.
        expect(at(3, () => [shows(c), c.mark.get('opacity'), shows(c.text!)])).toEqual([1, 1, one])
        expect(at(3.9, () => shows(d))).toBe(0)
        // The second advance of a sequence starts where the first one stops.
        expect([cursor(4.5), cursor(5), cursor(5.5), cursor(6)]).toEqual([expect.closeTo(line.x(2025.5), 6), expect.closeTo(line.x(2026), 6), expect.closeTo(line.x(2027), 6), expect.closeTo(line.x(2028), 6)])
        // `showAll` goes to the end of the line, where the last event is. The cursor arrives 0.5 s before the end.
        expect(at(7.4, () => shows(d))).toBe(0)
        expect([cursor(7.5), cursor(8)]).toEqual([expect.closeTo(line.x(2030), 6), expect.closeTo(line.x(2030), 6)])
        expect(at(8, () => [shows(d), d.mark.get('opacity'), shows(d.text!)])).toEqual([1, 1, one])
        // Without a cursor, the events appear at the same times.
        expect(at(3, () => bare.cursor.get('visible'))).toBe(false)
        expect(at(2.25, () => bare.events.map((event) => (event.get('visible') ? shows(event.text!) : 0)))).toEqual([1, one, 0, 0])
        // The cursor does not go back, and it stays on the line.
        expect(() => line.advance(2029)).toThrow(/cannot advance to 2029\. The cursor is past it, and it does not go back/)
        expect(() => bare.advance(2031)).toThrow(/cannot advance to 2031\. The line goes from 2020 to 2030/)
        expect(() => bare.advance('tomorrow')).toThrow(/the line cannot advance to "tomorrow"\. A date is/)
        expect(() => bare.advance(2024)).toThrow(/The cursor is past it/)
        // The check is made again when the move is scheduled: the second advance of this sequence would go back.
        await expect(compile((s) => {
            const made = s.add(dateLine(events, sized))
            s.play(seq(made.advance(2028), made.advance(2026)))
        })).rejects.toThrow(/cannot advance to 2026\. The cursor is past it, and it does not go back/)
    })

    it('enters with its line, its ticks and its numbers from the first end, and with no event', async () => {
        let line!: Line
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            line = dateLine(RECORD, sized)
            s.wait(1)
            s.play(line.enter(), { duration: 2, ease: linear })
            s.wait(0.5)
        }))
        expect(compiled.frame(0.5).ops).toHaveLength(0)
        // The line draws over the first 1.4 s. A number arrives when the line reaches it, in 0.6 s.
        const rule = line.axis.children[0]!
        expect([1, 1.7, 2.4, 3].map((time) => at(time, () => rule.get('trimTo')))).toEqual([0, expect.closeTo(0.5, 6), 1, 1])
        const [first, , , , , sixth] = numbers(line), last = numbers(line)[10]!
        expect(at(1.3, () => [first, sixth, last].map(shows))).toEqual([expect.closeTo(0.5, 1), 0, 0])
        expect(at(1.9, () => [first, sixth, last].map(shows))).toEqual([1, expect.closeTo(1 / 3, 1), 0])
        expect(at(3, () => numbers(line).map(shows))).toEqual(numbers(line).map(() => 1))
        expect(at(3.4, () => [...line.events.map((event) => event.get('visible')), line.cursor.get('visible')])).toEqual([false, false, false, false])
        expect(compiled.frame(3.4).ops).toHaveLength(56)
        const turn = await compile((s) => {
            s.wait(1)
            s.play(seq(fadeIn(rect(10, 10).at(-900, -500), { duration: 1 }), { ...dateLine(RECORD, sized).enter(), duration: 1 }))
            s.wait(0.5)
        })
        // In the first second, the rectangle is the one mark that the film draws.
        for (const time of [1.3, 1.99]) expect(turn.frame(time).ops).toHaveLength(1)
        expect(turn.frame(3.4).ops).toHaveLength(57)
        const lefts: number[] = []
        for (const shift of [0, 300]) {
            const moved = await compile((s) => {
                const made = dateLine(RECORD, sized)
                group(made).at(shift, 0)
                s.play(made.enter(), { duration: 1 })
                s.wait(0.5)
            })
            lefts.push(Math.min(...paths(moved, 1.4).flatMap((op) => pathBounds(op.path)?.x ?? [])))
        }
        // The line of a group that the film moved is the same picture, 300 to the right.
        expect(lefts[1]! - lefts[0]!).toBeCloseTo(300, 6)
        // A copy enters with its own ticks, and shows its own events.
        let copy!: Line
        await compileFilm(film({ fps: 20 }, (s) => {
            const made = dateLine(RECORD, sized)
            copy = made.clone()
            s.play(copy.enter(), { duration: 1 })
            s.play(copy.showAll(), { duration: 1 })
            expect(made.mounted).toBe(false)
            expect(copy.events[0]).not.toBe(made.events[0])
        }))
        expect(at(2, () => copy.events.map(shows))).toEqual([1, 1, 1])
    })

    it('draws an event with no label as a mark only, as a dot, a star or a ring, and gives a mark that would touch another one a row over the line', async () => {
        await compileFilm(film(() => {
            const line = dateLine([{ at: '2025-06-09' }, { at: '2025-06-10', mark: 'star' }, { at: '2025-10-29', mark: 'ring', color: 'teal' }, { at: '2026-03-06' }, { at: '2026-03-06' }, { at: '2026-03-06' }], { width: 1720 })
            // An event with no label has no stem and no text: its node holds its mark, and the ring that shows when the event is lit.
            expect(line.events.map((event) => [event.stem, event.text, event.note, event.children])).toEqual(line.events.map((event) => [null, null, null, [event.halo, event.mark]]))
            // At size 26, a dot is 14 px wide. A star is 1.8 times a dot from point to point. A ring is a dot with a line around the color of the background.
            const [first, star, ring] = line.events as [Line['events'][number], Line['events'][number], Line['events'][number]]
            expect([first.mark.bounds().width, star.mark.bounds().height, ring.mark.bounds().width + ring.mark.get('strokeWidth')]).toEqual([expect.closeTo(14.04, 6), expect.closeTo(7.02 * 1.8 * (1 + Math.cos(Math.PI / 5)), 6), expect.closeTo(14.04, 6)])
            expect([first.mark.get('fill'), star.mark.get('fill'), ring.mark.get('fill'), ring.mark.get('stroke')]).toEqual([paint('ink'), paint('ink'), paint('bg'), paint('teal')])
            // The star is one day after the first dot, which is 3 px: it goes to the second row. Three marks of one day take the line and two rows.
            const pitch = -line.p(1)[1]
            expect(pitch).toBeGreaterThan(2 * 7.02 * 1.8)
            expect(line.events.map((_, index) => line.p(index)[1])).toEqual([0, -pitch, 0, 0, -pitch, -2 * pitch].map((y) => expect.closeTo(y, 6)))
            line.events.forEach((event, index) => expect(middle(event.mark)[0]).toBeCloseTo(line.p(index)[0], 6))
            expect(line.p(3)[0]).toBe(line.p(5)[0])
            // The rows are in `extent`, with the ring of a lit event around the highest mark.
            expect(line.extent.top).toBeCloseTo(-2 * pitch - 7.02 - 26 * 0.07, 6)

            // A mark has a clear room of 0.18 of the text size around it: 4.7 px at size 26. In the record of a film, at its width and at half of it, no mark is in the room of another one.
            const record = ['2025-06-09', '2025-06-10*', '2025-10-29', '2026-02-24', '2026-02-27', '2026-03-06', '2026-03-06', '2026-03-24*', '2026-03-25', '2026-04-17', '2026-04-29', '2026-05-13', '2026-05-27',
                '2026-06-02', '2026-06-24', '2026-07-06', '2026-07-30', '2026-08-13', '2026-08-19', '2026-08-28', '2026-09-02', '2026-11-06', '2026-11-06']
                .map((date) => (date.endsWith('*') ? { at: date.slice(0, -1), mark: 'star' as const } : { at: date }))
            for (const width of [1720, 860]) {
                const made = dateLine(record, { width })
                const circles = made.events.map((_, index) => ({ at: made.p(index), radius: record[index]!.mark ? 7.02 * 1.8 : 7.02 }))
                circles.forEach((one, index) => circles.slice(index + 1).forEach((other) => expect(Math.hypot(one.at[0] - other.at[0], one.at[1] - other.at[1])).toBeGreaterThanOrEqual(one.radius + other.radius + 26 * 0.18 - 1e-6)))
                expect(new Set(circles.map((one) => Math.round(one.at[1]))).size).toBe(width === 1720 ? 2 : 4)
            }
            // Two marks that are 13.9 px apart at size 20 are in the room of each other, and two marks that are 14.8 px apart are not.
            expect(dateLine([{ at: 2022 }, { at: 2022.14 }], sized).p(1)[1]).toBeLessThan(-10)
            expect(dateLine([{ at: 2022 }, { at: 2022.15 }], sized).p(1)[1]).toBe(0)
            // The ends of the line keep the radius of the largest mark, so a star at an end is inside the width.
            const ends = dateLine([{ at: 2020, mark: 'star' }, { at: 2030, mark: 'star' }], sized)
            expect([edges(ends.events[0]!.mark)[0], edges(ends.events[1]!.mark)[2]]).toEqual([expect.closeTo(-500 + 9.72 * (1 - Math.cos(Math.PI / 10)), 6), expect.closeTo(500 - 9.72 * (1 - Math.cos(Math.PI / 10)), 6)])

            // The rows grow as the marks need. Four marks of one day take four rows, and the bounds hold them.
            const four = dateLine(Array.from({ length: 4 }, () => ({ at: 2021 })))
            expect(four.events.map((_, index) => four.p(index)[1] / four.p(1)[1])).toEqual([0, 1, 2, 3].map((row) => expect.closeTo(row, 6)))
            expect(edges(four)[1]).toBeCloseTo(four.p(3)[1] - 7.02 - 26 * 0.07, 6)
            // 60 marks at random dates on 860 px build with the rows that the object has when the film gives no number.
            for (let seed = 1; seed <= 25; seed++) {
                const random = randomOf(seed)
                expect(() => dateLine(Array.from({ length: 60 }, () => ({ at: 2025.42 + random() * 1.5 })), { width: 860, from: 2025.42, to: 2026.92 })).not.toThrow()
            }
            // `rows` is the most rows. With fewer rows than the marks need, the error names the number that is enough.
            expect(() => dateLine(Array.from({ length: 11 }, () => ({ at: 2021 })))).toThrow(/the marks near event 10 \(at 2021\) need 11 rows, and `rows` is 10\. What works for this line: rows: 11$/)
            expect(() => dateLine(Array.from({ length: 11 }, () => ({ at: 2021 })), { rows: 11 })).not.toThrow()
            expect(() => dateLine([{ at: 2021 }], { rows: 0 })).toThrow(/rows is the most rows of marks, a whole number of 1 or more/)

            // Two events with labels that are near each other are no error. The later mark goes one row up, and its label goes over the line, from its mark. The label of the earlier one goes under the line.
            const posts = dateLine([{ at: 2020, label: 'the Firecracker paper' }, { at: '2025-06-10', label: 'the newsletter' }, { at: '2025-06-16', label: 'the second post' }, { at: '2026-03-24', label: 'the technical report', note: 'names Anyrun' }], { width: 1180, from: 2020, to: 2027, font: 'text-serif' })
            expect([posts.p(1)[1], posts.p(2)[1]]).toEqual([0, expect.closeTo(-(2 * 7.02 + 26 * 0.18 + 1.56), 1)])
            expect(posts.events.map(sideOf)).toEqual(['over', 'under', 'over', 'over'])
            expect(stemOf(posts.events[2]!)[3]).toBeCloseTo(posts.p(2)[1], 6)
            expect(room(posts.events[2]!)[3]).toBeLessThan(posts.p(2)[1] - 7.02)
            // Events with labels at one date have one place, on the line.
            const twins = dateLine([{ at: 2021, label: 'a' }, { at: 2021, label: 'b' }, { at: 2021, label: 'c' }], sized)
            expect(twins.events.map((_, index) => twins.p(index))).toEqual([twins.p(0), twins.p(0), twins.p(0)])
            expect(twins.p(0)[1]).toBe(0)
            // A label over the line counts its height from its mark. For a mark in a row, the stem is as long as for a mark on the line: 1.5 of the text size, less the room before the label.
            const raised = dateLine([{ at: 2021 }, { at: 2021, label: 'a' }], sized)
            expect([raised.p(1)[1] < -10, sideOf(raised.events[1]!)]).toEqual([true, 'over'])
            expect(stemOf(raised.events[1]!)[3] - stemOf(raised.events[1]!)[1]).toBeCloseTo(stemOf(dateLine([{ at: 2021, label: 'a' }], sized).events[0]!)[3] - stemOf(dateLine([{ at: 2021, label: 'a' }], sized).events[0]!)[1], 6)
            // A mark with no label at the date of an event with a label goes over it, and the label goes under the line, away from that mark.
            const mixed = dateLine([{ at: 2021, label: 'a' }, { at: 2021 }], sized)
            expect([mixed.p(0)[1], mixed.p(1)[1] < -10, sideOf(mixed.events[0]!)]).toEqual([0, true, 'under'])
            // A label or a note that is a number is written as its text, and a value that is no text is an error.
            const counted = dateLine([{ at: 2021, label: 7, note: 5 }], sized)
            expect([counted.events[0]!.text!.source, counted.events[0]!.note!.source]).toEqual(['7', '5'])
            expect(() => dateLine([{ at: 2021, label: 'a', note: true as never }])).toThrow(/the note of event 0 is true\. A note is a text, or a number that the line writes as its text/)
            expect(() => dateLine([{ at: 2021, label: { a: 1 } as never }])).toThrow(/the label of event 0 is \{"a":1\}\. A label is a text, or a number that the line writes as its text/)
        }))
    })

    it('takes away a tick that is in the clear room of a mark while the event shows, by any way that the film shows it', async () => {
        let line!: Line, shown!: Line
        const tickOf = (made: Line, date: string | number) => made.axis.children.slice(1).find((child) => child.bounds().width === 0 && Math.abs(child.bounds().x - made.x(date)) < 0.01)!
        await compileFilm(film({ fps: 20 }, (s) => {
            line = s.add(dateLine([{ at: '2025-06-09' }, { at: '2025-07-02' }, { at: '2025-08-15' }, { at: '2025-09-01', label: 'a' }], { width: 1720, from: '2025-06', to: '2026-12' }))
            // At size 20 a dot has a radius of 5.4, its clear room is 3.6, and half a tick is 1: a tick is in the room of a mark up to 10 px from its middle.
            const near = dateLine([{ at: 2022.09 }, { at: 2024.11 }, { at: 2026 }, { at: 2026 }, { at: 2028, label: 'a' }], sized)
            const ticks = () => [2022, 2024, 2026, 2028].map((year) => tickOf(near, year).get('visible'))
            expect(ticks()).toEqual([true, true, true, true])
            // 8.9 px from the tick of 2022: the mark is 2.5 px beside the tick, in its clear room. `show()` takes the tick away, and `hide()` brings it back.
            near.events[0]!.show()
            expect(ticks()).toEqual([false, true, true, true])
            near.events[0]!.hide()
            expect(ticks()).toEqual([true, true, true, true])
            // 10.9 px from the tick of 2024: the tick stays.
            near.events[1]!.show()
            expect(ticks()).toEqual([true, true, true, true])
            // Two marks at the tick of 2026: the one in the row over the line is clear of the tick, and the one on the line is not.
            expect([near.p(2)[1], near.p(3)[1] < -10]).toEqual([0, true])
            near.events[3]!.show()
            expect(ticks()).toEqual([true, true, true, true])
            near.events[2]!.show()
            expect(ticks()).toEqual([true, true, false, true])
            // The mark of an event with a label takes its tick away too.
            near.events[4]!.show()
            expect(ticks()).toEqual([true, true, false, false])
            // On the stage, the tick leaves at the time when the event shows: with `show()`, and with a fade.
            shown = s.add(dateLine([{ at: 2022 }, { at: 2024 }, { at: 2026 }], sized).at(0, 300))
            s.wait(1)
            shown.events[0]!.show()
            s.play(line.advance('2025-07-20'), fadeIn(shown.events[1]!), { duration: 1, ease: linear })
            s.play(line.showAll(), { duration: 1, ease: linear })
        }))
        // The cursor reaches 2 July at 1.5 s. Its mark is 3 px after the tick of July. The mark of 9 June is 25 px from the tick of June.
        const ticks = (time: number) => at(time, () => ['2025-06', '2025-07', '2025-08', '2025-09'].map((date) => tickOf(line, date).get('visible')))
        expect(ticks(0.5)).toEqual([true, true, true, true])
        expect(ticks(1.45)).toEqual([true, true, true, true])
        expect(ticks(1.55)).toEqual([true, false, true, true])
        // The event of 1 September has a label, and its mark is at the tick.
        expect(ticks(3.5)).toEqual([true, false, true, false])
        expect(at(3.5, () => line.events.map((event) => event.get('visible')))).toEqual([true, true, true, true])
        const years = (time: number) => at(time, () => [2022, 2024, 2026].map((year) => tickOf(shown, year).get('visible')))
        expect(years(0.5)).toEqual([true, true, true])
        expect(years(1.5)).toEqual([false, false, true])
        // A copy has its own ticks.
        const copy = shown.clone()
        copy.events[2]!.show()
        expect([tickOf(copy, 2026).get('visible'), at(3.5, () => tickOf(shown, 2026).get('visible'))]).toEqual([false, true])
    })

    it('gives one event the look of the lit event with light: the accent color, and a ring around its mark', async () => {
        let lights!: Line, early!: Line, same!: Line
        const lit: (number | null)[] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            lights = s.add(dateLine([{ at: 2021, label: 'a', note: 'n', color: 'teal' }, { at: 2023 }, { at: 2025, mark: 'ring' }], { ...sized, accent: 'red' }).at(0, 300))
            // The color of these two events is the accent color.
            same = s.add(dateLine([{ at: 2021, color: 'red' }, { at: 2023, color: 'red' }], { ...sized, accent: 'red' }))
            early = s.add(dateLine([{ at: 2021 }, { at: 2023, label: 'b' }], sized).at(0, -300))
            s.wait(1)
            // An event that is lit while it is hidden stays hidden.
            s.play(lights.showAll(), same.showAll(), early.light(1), { duration: 1, ease: linear })
            lit.push(lights.lit)
            s.play(lights.light(0), same.light(0), early.showAll(), { duration: 1, ease: linear })
            lit.push(lights.lit)
            s.play(lights.light(2), { duration: 1, ease: linear })
            lit.push(lights.lit)
            s.play(lights.light(2), { duration: 1, ease: linear })
            s.play(lights.light(null), { duration: 1, ease: linear })
            lit.push(lights.lit)
        }))
        // `lit` is the index after the changes that the film has played.
        expect(lit).toEqual([null, 0, 2, null])
        const [first, , ring] = lights.events as [Line['events'][number], Line['events'][number], Line['events'][number]]
        const looks = (time: number) => at(time, () => [first.mark.get('fill'), first.stem!.get('stroke'), first.text!.chars[0]!.get('fill'), first.note!.chars[0]!.get('fill'), first.halo.get('opacity'), ring.mark.get('stroke'), ring.mark.get('fill'), ring.halo.get('opacity')])
        const [teal, red, ink, dim, bg] = ['teal', 'red', 'ink', 'dim', 'bg'].map(paint)
        expect(looks(2)).toEqual([teal, teal, teal, dim, 0, ink, bg, 0])
        // The mark, the stem and the label take the accent color, and the ring around the mark shows. The note stays in dim.
        expect(looks(3)).toEqual([red, red, red, dim, 1, ink, bg, 0])
        expect(looks(2.5)[0]).not.toEqual(teal)
        expect(looks(2.5)[0]).not.toEqual(red)
        expect(looks(2.5)[4]).toBeCloseTo(0.5, 6)
        // The next event takes the look from the one before. A ring has the accent on its line.
        expect(looks(4)).toEqual([teal, teal, teal, dim, 0, red, bg, 1])
        // The same event again changes nothing, and null leaves no event lit.
        expect(looks(4.5)).toEqual(looks(4))
        expect(looks(6)).toEqual([teal, teal, teal, dim, 0, ink, bg, 0])
        // The ring is in the accent color, around the mark and inside its clear room: 5.4 + 1.4 px at size 20, with a line of 1.5.
        expect([first.halo.get('stroke'), first.halo.bounds().width, first.halo.get('strokeWidth')]).toEqual([red, expect.closeTo(2 * (5.4 + 1.4), 6), 1.5])
        expect(middle(first.halo)).toEqual(middle(first.mark).map((value) => expect.closeTo(value, 6)))
        // An event whose own color is the accent color looks lit by its ring only: the lit look differs from every look that is not lit.
        expect(at(3, () => same.events.map((event) => [event.mark.get('fill'), event.halo.get('opacity')]))).toEqual([[red, 1], [red, 0]])
        // An event that was lit while it was hidden appears lit.
        const late = early.events[1]!
        expect(at(1.9, () => [late.get('visible'), late.halo.get('opacity')])).toEqual([false, expect.closeTo(0.9, 6)])
        expect(at(3, () => [late.get('visible'), late.mark.get('fill'), late.text!.chars[0]!.get('fill'), late.halo.get('opacity')])).toEqual([true, paint('orange'), paint('orange'), 1])
        // The accent is orange when the film gives none, and the animations take these times when the film gives none.
        let durations: number[] = []
        await compileFilm(film(() => {
            const plain = dateLine([{ at: 2021 }], sized)
            durations = [plain.enter().duration, plain.advance(2022).duration, plain.showAll().duration, plain.light(null).duration]
            expect(() => plain.light(1)).toThrow(/cannot light event 1\. The line has the events 0 to 0\. Use null for no lit event/)
            expect(() => plain.light(0.5)).toThrow(/cannot light event 0\.5/)
        }))
        expect(durations).toEqual([1, 1.6, 3, 0.4])
    })

    it('keeps its cursor in a room of its own under the line, where it touches no mark, no tick, no stem and no text, and never moves it back or past the date with an ease that bounces', async () => {
        await compileFilm(film(() => {
            const record = ['2025-06-09', '2025-06-10*', '2025-10-29', '2026-03-06', '2026-03-06', '2026-03-24*', '2026-03-25', '2026-11-06'].map((date) => (date.endsWith('*') ? { at: date.slice(0, -1), mark: 'star' as const } : { at: date }))
            const lines = [
                dateLine(RECORD, sized), dateLine(CROWD, { width: 1800, from: 2025, to: 2027 }), dateLine([{ at: '5.1', label: 'one' }, { at: '5.19', label: 'the fix', mark: 'ring' }], { scale: 'order', width: 900 }),
                dateLine([...record, { at: '2026-07-01', label: 'a', mark: 'star' }, { at: '2026-07-02', label: 'b' }], { width: 1720 }), dateLine([{ at: '2025-05-05', label: 'a' }, { at: '2025-05-10', label: 'b', note: 'n' }], { size: 40 }),
            ]
            /** The room of the ink of a node: its bounds, and half of its line. */
            const ink = (node: Node) => { const box = edges(node), half = node.get('stroke') ? node.get('strokeWidth') / 2 : 0; return [box[0] - half, box[1] - half, box[2] + half, box[3] + half] as const }
            for (const line of lines) {
                // The cursor is a pointer under the line. It moves along the line only, so its height is the room that it needs: nothing else is in it, at any date.
                const [left, top, right, bottom] = edges(line.cursor)
                expect(top).toBeGreaterThan(0)
                expect([bottom - top, right - left]).toEqual([expect.closeTo((right - left) * (0.32 / 0.42), 6), expect.closeTo(right - left, 6)])
                const outside = (box: readonly [number, number, number, number]) => box[3] < top - 1 || box[1] > bottom + 1
                // The marks, the ring of a lit event, the stems, the labels and the notes.
                for (const event of line.events) {
                    for (const part of [event.mark, event.halo, event.stem]) if (part) expect(outside(ink(part))).toBe(true)
                    for (const words of [event.text, event.note]) if (words) expect(outside(edges(words))).toBe(true)
                }
                // The line and its ticks are over it, and the texts under the line are under it.
                for (const part of line.axis.children) {
                    const isText = typeof (part as unknown as { source?: unknown }).source === 'string'
                    expect(isText ? edges(part)[1] > bottom + 1 : ink(part)[3] < top - 1).toBe(true)
                }
            }
        }))
        // An ease that passes its end and comes back, and an ease that starts backward.
        const eases = [(t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2, (t: number) => 2.70158 * t ** 3 - 1.70158 * t ** 2]
        for (const ease of eases) {
            let line!: Line
            await compileFilm(film({ fps: 20 }, (s) => {
                line = s.add(dateLine([{ at: 2021, label: 'a' }, { at: 2029, label: 'b' }], sized))
                s.play(line.advance(2022), { duration: 0.5, ease: linear })
                s.play(line.advance(2026), { duration: 2, ease })
            }))
            const xs = Array.from({ length: 41 }, (_, step) => at(0.5 + step * 0.05, () => line.cursor.get('x')))
            xs.forEach((x, index) => {
                expect(x).toBeGreaterThanOrEqual(line.x(2022) - 1e-6)
                expect(x).toBeLessThanOrEqual(line.x(2026) + 1e-6)
                if (index > 0) expect(x).toBeGreaterThanOrEqual(xs[index - 1]! - 1e-6)
            })
            expect(xs[40]).toBeCloseTo(line.x(2026), 6)
        }
    })

    it('uses as few heights as the labels need, so more levels never make a line fail', async () => {
        await compileFilm(film(() => {
            const places = (line: Line) => line.events.map(labelOf)
            // A long label over the line, six labels under it, and one more over it. The last one needs the first one at another height.
            const crowd = [
                { at: '2020-01', label: 'the Firecracker paper at NSDI, by Agache and others', side: 'over' as const },
                ...['2020-03', '2020-05', '2020-07', '2020-09', '2020-11', '2021-01'].map((at, index) => ({ at, label: `v0.2${index}`, side: 'under' as const })),
                { at: '2021-09', label: 'Lambda adopts it', side: 'over' as const },
            ]
            const made = (levels: number) => dateLine(crowd, { width: 1800, from: 2020, to: 2027, levels })
            expect(() => made(2)).toThrow(/has no place/)
            const three = places(made(3))
            for (const levels of [4, 5, 6, 7, 8]) expect(places(made(levels))).toEqual(three)
            // 24 events with long labels on 1500 px: the search goes back many times, and finds their places with 3 heights. So 4 levels give the same places.
            const words = ['the paper', 'a first public release', 'the newsletter', 'the technical report on the whole system', 'v2', 'a talk', 'the second post of the series', 'documentation', 'the reply', 'an incident in production', 'GA', 'the fix', 'open source', 'the acquisition is announced']
            const notes = [undefined, 'names Anyrun', undefined, undefined, 'two weeks later', undefined, 'by Agache and others at NSDI', undefined]
            const dense = Array.from({ length: 24 }, (_, index) => {
                const years = 2000 + (30 * (index + 0.5)) / 24, year = Math.floor(years), month = 1 + Math.floor((years - year) * 12)
                return { at: `${year}-${String(month).padStart(2, '0')}-${String(1 + ((index * 7) % 27)).padStart(2, '0')}`, label: words[index % words.length]!, note: notes[index % notes.length] }
            })
            const heights = (line: Line) => new Set(line.events.map((event) => Math.round(labelOf(event)[1]))).size
            const tight = dateLine(dense, { width: 1500, levels: 3 })
            expect(heights(tight)).toBeGreaterThan(4)
            expect(places(dateLine(dense, { width: 1500, levels: 4 }))).toEqual(places(tight))
            expect(() => dateLine(dense, { width: 1500, levels: 2 })).toThrow(/has no place/)
        }))
    })

    it('refuses a date that it cannot read, a date outside the line, and a line that ends before it starts', async () => {
        await compileFilm(film(() => {
            const format = /A date is 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', or a number of years/
            expect(() => dateLine([])).toThrow(/give it at least one event/)
            expect(() => dateLine([{ at: 2021, label: ' ' }])).toThrow(/event 0 has an empty label\. Give it a label, or leave `label` out for a mark with no label/)
            // A label and a note are one line each. The note is the second line.
            expect(() => dateLine([{ at: 2021, label: 'two\nlines' }])).toThrow(/the label of event 0 \("two\\nlines"\) has a line break\. A label is one line\. Use `note` for a second line/)
            expect(() => dateLine([{ at: 2021, label: 'a', note: 'two\nlines' }])).toThrow(/the note of event 0 \("a"\) has a line break\. A note is one line/)
            expect(() => dateLine([{ at: 2021, note: 'n' }])).toThrow(/event 0 \(at 2021\) has a note and no label\. A note is the second line of a label/)
            expect(() => dateLine([{ at: 2021, mark: 'square' as never }])).toThrow(/event 0 \(at 2021\) has the mark "square"\. Use 'dot', 'star' or 'ring'/)
            expect(() => dateLine([{ at: 2021 }], { accent: 'nope' })).toThrow(/accent is "nope", which is not a color/)
            expect(() => dateLine([{ at: '2025-13-01', label: 'a' }])).toThrow(/event 0 \("a"\) has the date "2025-13-01"\. A date is/)
            // 2025 is not a leap year, and 2024 is.
            expect(() => dateLine([{ at: '2025-02-29', label: 'a' }])).toThrow(format)
            expect(() => dateLine([{ at: '2024-02-29', label: 'a' }])).not.toThrow()
            expect(() => dateLine([{ at: '2025-04-31', label: 'a' }])).toThrow(format)
            expect(() => dateLine([{ at: '2025-6-1', label: 'a' }])).toThrow(format)
            expect(() => dateLine([{ at: 'June 2025', label: 'a' }])).toThrow(/has the date "June 2025"/)
            expect(() => dateLine([{ at: NaN, label: 'a' }])).toThrow(/has the date NaN/)
            expect(() => dateLine([{ at: 2027, label: 'a' }, { at: 2020, label: 'b' }], { from: 2020, to: 2027 })).not.toThrow()
            expect(() => dateLine([{ at: 2021, label: 'a' }], { from: 2027, to: 2020 })).toThrow(/the line goes from 2027 to 2020\. Give a `from` that is before `to`/)
            expect(() => dateLine([{ at: 2021, label: 'a' }], { from: 2021, to: 2021 })).toThrow(/the line goes from 2021 to 2021/)
            expect(() => dateLine([{ at: 2021, label: 'a' }], { from: 'soon' })).toThrow(/from is "soon"\. A date is/)
            // An error prints the ends of the line as the film wrote them, and as dates when the film gave none.
            expect(() => dateLine([{ at: '2025-05-03', label: 'a' }, { at: '2025-05-08', label: 'b' }]).advance('2025-06')).toThrow(/cannot advance to "2025-06"\. The line goes from 2025-05-03 to 2025-05-08/)
            expect(() => dateLine([{ at: '2025-05-03', label: 'a' }], { from: '2025-05', to: '2025-05-02' })).toThrow(/event 0 \("a"\) is at "2025-05-03", outside the line from "2025-05" to "2025-05-02"\. What works for this line: to: "2025-05-03"/)
            expect(() => dateLine([{ at: '2025-05-03T10:00', label: 'a' }])).toThrow(format)
            expect(() => dateLine([{ at: 2021, label: 'a', side: 'left' as never }])).toThrow(/event 0 \("a"\) has the side "left"\. Use 'over' or 'under'/)
            expect(() => dateLine([{ at: 2021, label: 'a' }], { scale: 'log' as never })).toThrow(/scale is 'time' or 'order', not "log"/)
            expect(() => dateLine([{ at: 2021, label: 'a' }], { levels: 0 })).toThrow(/levels is the number of heights/)
            expect(() => dateLine([{ at: 2021, label: 'a' }], { size: 0 })).toThrow(/size is the text size of the labels/)
            expect(() => dateLine([{ at: 2021, label: 'a' }], { width: 0 })).toThrow(/width is the length of the line/)
            const line = dateLine(RECORD, sized)
            expect(() => line.x('x')).toThrow(/the line has no place for "x"\. A date is/)
            expect(() => line.p(3)).toThrow(/no event 3\. The line has 3 events/)
        }))
    })
})

describe('bit field', () => {
    const address = [
        { bits: 16, label: 'sign extension', unused: true },
        { bits: 9, label: 'PGD', color: 'blue' },
        { bits: 9, label: 'PUD', color: 'teal' },
        { bits: 9, label: 'PMD', color: 'green' },
        { bits: 9, label: 'PTE', color: 'orange' },
        { bits: 12, label: 'offset', color: 'purple' },
    ]
    /** `struct io_uring_sqe` of Linux 6.12, 64 bytes. A union is shown by its first member. */
    const sqe = [
        { bits: 1, label: 'opcode' }, { bits: 1, label: 'flags' }, { bits: 2, label: 'ioprio' }, { bits: 4, label: 'fd' }, { bits: 8, label: 'off' },
        { bits: 8, label: 'addr' }, { bits: 4, label: 'len' }, { bits: 4, label: 'rw_flags' },
        { bits: 8, label: 'user_data' }, { bits: 2, label: 'buf_index' }, { bits: 2, label: 'personality' }, { bits: 4, label: 'splice_fd_in' },
        { bits: 8, label: 'addr3' }, { bits: 8, label: '__pad2', unused: true },
    ]
    type Box = { x: number; y: number; width: number; height: number }
    const ends = (box: Box) => [box.x, box.x + box.width] as const
    const middle = (node: Node) => { const box = node.bounds(); return [box.x + box.width / 2, box.y + box.height / 2] as const }
    const source = (node: Node | null) => (node as unknown as { source: string } | null)?.source
    const shown = (made: ReturnType<typeof bitField>) => made.numbers.map(source)
    /** The color of a text: the fill of its first glyph. */
    const ink = (node: Node | null) => node!.children[0]!.get('fill')
    const inkOf = (color: string) => text('a', { color }).children[0]!.get('fill')
    /** The texts that a field has shown as its value, in the order that they arrived. */
    const valuesOf = (made: ReturnType<typeof bitField>, index: number) => made.fields[index]!.children.filter((node) => source(node) !== undefined && node !== made.labels[index] && !made.numbers.includes(node))
    const size = (node: Node | null) => node!.data['size'] as number
    /** Two boxes with this much room between them, in x or in y. */
    const apart = (a: Box, b: Box, room: number) => a.x + a.width + room <= b.x || b.x + b.width + room <= a.x || a.y + a.height + room <= b.y || b.y + b.height + room <= a.y
    const message = (run: () => unknown) => { try { run() } catch (error) { return (error as Error).message } return '' }
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)
    /** The lines of the hatch of a field: what the field strokes other than its box. */
    const hatchOf = (made: ReturnType<typeof bitField>, index: number) => made.fields[index]!.children.find((node) => node !== made.boxes[index] && node.get('path') !== null && node.get('stroke') !== null)
    /** True when a line of a hatch comes nearer than 4 px to a text. */
    const crosses = (lines: Node, part: Box) => lines.get('path')!.some((ring) => {
        const [x0, y0] = [ring.p[0]!, ring.p[1]!], [x1, y1] = [ring.p[ring.p.length - 2]!, ring.p[ring.p.length - 1]!]
        return Array.from({ length: 11 }, (_, step) => [x0 + ((x1 - x0) * step) / 10, y0 + ((y1 - y0) * step) / 10] as const)
            .some(([x, y]) => x > part.x - 4 && x < ends(part)[1] + 4 && y > part.y - 4 && y < part.y + part.height + 4)
    })

    it('centers the row of boxes on its place, and gives each box a width for its bits', async () => {
        await compileFilm(film(() => {
            const made = bitField(address, { width: 1400, height: 70 }).at(300, 200)
            const boxes = made.boxes.map((box) => box.bounds())
            // The row is 1400 wide and 70 high, and its middle is the place of the object. The first field is at the left.
            expect(boxes[0]!.x).toBeCloseTo(300 - 700, 6)
            expect(ends(boxes[5]!)[1]).toBeCloseTo(300 + 700, 6)
            for (const box of boxes) {
                expect(box.y).toBeCloseTo(200 - 35, 6)
                expect(box.height).toBeCloseTo(70, 6)
            }
            // The boxes follow each other with one small room between them, so each field is a box of its own.
            const rooms = boxes.slice(1).map((box, index) => box.x - ends(boxes[index]!)[1])
            for (const room of rooms) {
                expect(room).toBeGreaterThan(4)
                expect(room).toBeCloseTo(rooms[0]!, 6)
            }
            // A box and the room after it are in proportion to the bits of the field: 16, 9, 9, 9, 9 and 12 of 64.
            // So each field starts at the place of its bit.
            const unit = (1400 + rooms[0]!) / 64
            expect(boxes.map((box) => (box.width + rooms[0]!) / unit)).toEqual([16, 9, 9, 9, 9, 12].map((bits) => expect.closeTo(bits, 6)))
            expect(boxes.map((box) => (box.x - boxes[0]!.x) / unit)).toEqual([0, 16, 25, 34, 43, 52].map((bit) => expect.closeTo(bit, 6)))
            expect(made.total).toBe(64)
            // The defaults: 1200 wide, and 2.6 of the text size high.
            const plain = bitField(address, { size: 30 })
            expect(ends(plain.boxes[5]!.bounds())[1] - plain.boxes[0]!.bounds().x).toBeCloseTo(1200, 6)
            expect(plain.boxes[0]!.bounds().height).toBeCloseTo(78, 6)
        }))
    })

    it('gives every field one width when the scale is even', async () => {
        await compileFilm(film(() => {
            const made = bitField(address, { width: 1400, scale: 'even' })
            const boxes = made.boxes.map((box) => box.bounds())
            for (const box of boxes) expect(box.width).toBeCloseTo(boxes[0]!.width, 6)
            expect(boxes[0]!.x).toBeCloseTo(-700, 6)
            expect(ends(boxes[5]!)[1]).toBeCloseTo(700, 6)
            // The numbers still count the bits of each field.
            expect(made.range('PGD')).toEqual([47, 39])
        }))
    })

    it('gives a narrow field the least width, and lets the others share the rest in proportion', async () => {
        await compileFilm(film(() => {
            const widths = (made: ReturnType<typeof bitField>) => made.boxes.map((box) => box.bounds().width)
            const row = (made: ReturnType<typeof bitField>) => ends(made.boxes[made.boxes.length - 1]!.bounds())[1] - made.boxes[0]!.bounds().x
            // In 1000 px a bit has about 31 px, so the two fields of one bit take 100. The other two share the rest, 1 to 4.
            const made = bitField([{ bits: 1 }, { bits: 1 }, { bits: 6 }, { bits: 24 }], { width: 1000, minWidth: 100 })
            const [first, second, third, fourth] = widths(made)
            const room = made.boxes[1]!.bounds().x - ends(made.boxes[0]!.bounds())[1]
            expect([first, second]).toEqual([expect.closeTo(100, 6), expect.closeTo(100, 6)])
            expect(third!).toBeGreaterThan(100)
            expect((fourth! + room) / (third! + room)).toBeCloseTo(4, 6)
            expect(row(made)).toBeCloseTo(1000, 6)
            // A field of 5 bits is wide enough at first. When the four narrow fields take 140 each, it is not, so it takes 140 too.
            const chain = bitField([{ bits: 1 }, { bits: 1 }, { bits: 1 }, { bits: 1 }, { bits: 5 }, { bits: 23 }], { width: 1000, minWidth: 140 })
            expect(widths(chain).slice(0, 5)).toEqual(Array(5).fill(expect.closeTo(140, 6)))
            expect(widths(chain)[5]!).toBeGreaterThan(140)
            expect(row(chain)).toBeCloseTo(1000, 6)
            // Fields that cannot have the least width are an error, also with an even scale.
            expect(() => bitField(address, { width: 400, minWidth: 100 })).toThrow(/a width of 400 has no room for 6 fields of 100 or more. Give a larger width or a smaller minWidth/)
            expect(() => bitField(address, { width: 400, minWidth: 100, scale: 'even' })).toThrow(/no room for 6 fields of 100 or more/)
        }))
    })

    it('numbers the bits from the right, with the high bit over the left end of a field and the low bit over its right end', async () => {
        await compileFilm(film(() => {
            const made = bitField(address, { width: 1400 })
            expect(shown(made)).toEqual(['63', '48', '47', '39', '38', '30', '29', '21', '20', '12', '11', '0'])
            expect(made.range(0)).toEqual([63, 48])
            expect(made.range('PTE')).toEqual([20, 12])
            expect(made.range('offset')).toEqual([11, 0])
            made.boxes.forEach((node, index) => {
                const box = node.bounds()
                const high = made.numbers[index * 2]!.bounds(), low = made.numbers[index * 2 + 1]!.bounds()
                // Both numbers are over the box, a little inside its two ends.
                for (const number of [high, low]) {
                    expect(number.y + number.height).toBeLessThan(box.y - 4)
                    expect(number.y + number.height).toBeGreaterThan(box.y - 20)
                }
                expect(high.x - box.x).toBeGreaterThan(2)
                expect(high.x - box.x).toBeLessThan(10)
                expect(ends(box)[1] - ends(low)[1]).toBeGreaterThan(2)
                expect(ends(box)[1] - ends(low)[1]).toBeLessThan(10)
                // A number is a part of its field, so it fades and moves with it.
                expect(made.fields[index]!.children).toContain(made.numbers[index * 2])
                expect(made.fields[index]!.children).toContain(made.numbers[index * 2 + 1])
            })
            // The numbers are smaller than the labels, and dim, so that the names of the fields stand out.
            expect(size(made.numbers[0]!)).toBeLessThan(26 * 0.8)
            for (const number of made.numbers) expect(ink(number)).toEqual(inkOf('dim'))
            // A field of one bit shows one number, over the middle of its box.
            const flags = bitField([{ bits: 6, label: 'rest' }, { bits: 1, label: 'W' }, { bits: 1, label: 'P' }], { width: 600 })
            expect(shown(flags)).toEqual(['7', '2', '1', '0'])
            expect(middle(flags.numbers[2]!)[0]).toBeCloseTo(middle(flags.boxes[1]!)[0], 6)
            expect(middle(flags.numbers[3]!)[0]).toBeCloseTo(middle(flags.boxes[2]!)[0], 6)
            // Without numbers, the object writes none, and a range still counts the bits.
            const bare = bitField(address, { width: 1400, numbers: false })
            expect(bare.numbers).toHaveLength(0)
            expect(bare.range('PGD')).toEqual([47, 39])
        }))
    })

    it('counts offsets up from the left, one over each boundary, with the total over the right end', async () => {
        await compileFilm(film(() => {
            const made = bitField([{ bits: 4, label: 'fd' }, { bits: 8, label: 'off' }, { bits: 8, label: 'addr' }, { bits: 4, label: 'len' }], { width: 1200, numbers: 'offsets' })
            expect(shown(made)).toEqual(['0', '4', '12', '20', '24'])
            expect(made.range('fd')).toEqual([0, 3])
            expect(made.range('addr')).toEqual([12, 19])
            expect(made.range(3)).toEqual([20, 23])
            expect(made.total).toBe(24)
            const boxes = made.boxes.map((box) => box.bounds())
            expect(middle(made.numbers[0]!)[0]).toBeCloseTo(boxes[0]!.x, 6)
            boxes.slice(1).forEach((box, index) => {
                expect(middle(made.numbers[index + 1]!)[0]).toBeCloseTo((ends(boxes[index]!)[1] + box.x) / 2, 6)
            })
            expect(middle(made.numbers[4]!)[0]).toBeCloseTo(ends(boxes[3]!)[1], 6)
            // The total is a part of the last field.
            expect(made.fields[3]!.children).toContain(made.numbers[4])
        }))
    })

    it('writes the label inside the box, or the value inside and the label under the box', async () => {
        await compileFilm(film(() => {
            const made = bitField([{ bits: 8, label: 'type' }, { bits: 8, label: 'length', value: '0x40', color: 'orange' }, { bits: 8, value: '1' }, { bits: 8 }], { width: 1200, color: 'teal' })
            const boxes = made.boxes.map((box) => box.bounds())
            const inside = (box: Box, part: Box) => part.x > box.x + 8 && ends(part)[1] < ends(box)[1] - 8 && part.y > box.y + 8 && part.y + part.height < box.y + box.height - 8
            // Without a value, the label is in the middle of the box.
            expect(source(made.labels[0]!)).toBe('type')
            expect(inside(boxes[0]!, made.labels[0]!.bounds())).toBe(true)
            expect(middle(made.labels[0]!)[0]).toBeCloseTo(middle(made.boxes[0]!)[0], 6)
            expect(Math.abs(middle(made.labels[0]!)[1] - middle(made.boxes[0]!)[1])).toBeLessThan(4)
            expect(made.values[0]).toBeNull()
            // With a value, the value is in the box, in mono, and the label is under the box, on the middle of the field.
            const value = made.values[1]!, label = made.labels[1]!
            expect(source(value)).toBe('0x40')
            expect(inside(boxes[1]!, value.bounds())).toBe(true)
            expect(middle(value)[0]).toBeCloseTo(middle(made.boxes[1]!)[0], 6)
            expect(value.bounds().width).toBeCloseTo(text('0x40', { font: 'mono', size: 26 }).bounds().width, 6)
            expect(source(label)).toBe('length')
            expect(label.bounds().y).toBeGreaterThan(boxes[1]!.y + boxes[1]!.height + 4)
            expect(label.bounds().y).toBeLessThan(boxes[1]!.y + boxes[1]!.height + 24)
            expect(middle(label)[0]).toBeCloseTo(middle(made.boxes[1]!)[0], 6)
            expect(made.labels[2]).toBeNull()
            expect(inside(boxes[2]!, made.values[2]!.bounds())).toBe(true)
            expect([made.labels[3], made.values[3]]).toEqual([null, null])
            // A field holds its box and its texts. A field with no text holds its box and its two numbers.
            expect(made.fields[1]!.children).toEqual(expect.arrayContaining([made.boxes[1], value, label]))
            expect(made.fields[3]!.children).toHaveLength(3)
            // A field has the color of the object, or its own. The label under a box has the color of its field.
            const stroke = (color: string) => rect(10, 10, { stroke: color }).get('stroke')
            expect(made.boxes.map((box) => box.get('stroke'))).toEqual([stroke('teal'), stroke('orange'), stroke('teal'), stroke('teal')])
            expect(label.children[0]!.get('fill')).toEqual(stroke('orange'))
            expect(bitField([{ bits: 4 }]).boxes[0]!.get('stroke')).toEqual(stroke('blue'))
            // The labels take the font of the object, inside a box and under it. A value stays in mono.
            const mono = bitField([{ bits: 8, label: 'type' }, { bits: 8, label: 'length', value: '0x40' }], { width: 1200, font: 'mono' })
            expect(made.labels[0]!.bounds().width).toBeCloseTo(text('type', { size: 26 }).bounds().width, 6)
            expect(mono.labels[0]!.bounds().width).toBeCloseTo(text('type', { font: 'mono', size: 26 }).bounds().width, 6)
            expect(mono.labels[1]!.bounds().width).toBeCloseTo(text('length', { font: 'mono', size: 26 }).bounds().width, 6)
            expect(mono.values[1]!.bounds().width).toBeCloseTo(value.bounds().width, 6)
        }))
    })

    it('sets a text that is too wide in a smaller size, with room between it and the border', async () => {
        await compileFilm(film(() => {
            const made = bitField([{ bits: 1, label: 'a long name' }, { bits: 1, label: 'P' }, { bits: 1, label: 'instruction', value: '0x00000000' }], { width: 420, scale: 'even', numbers: false })
            // A box is about 136 px wide. The long texts are wider than that at size 26, and the short label is not.
            for (const part of [made.labels[0], made.values[2], made.labels[2]]) {
                expect(size(part)).toBeLessThan(26)
                expect(size(part)).toBeGreaterThanOrEqual(26 * 0.6)
            }
            expect(size(made.labels[1])).toBe(26)
            made.boxes.forEach((node, index) => {
                const box = node.bounds()
                for (const part of [made.labels[index], made.values[index]]) {
                    if (!part) continue
                    expect(part.bounds().x).toBeGreaterThan(box.x + 8)
                    expect(ends(part.bounds())[1]).toBeLessThan(ends(box)[1] - 8)
                }
            })
            // The label under the third box is as wide as the text in the box may be, so it cannot meet a label of a neighbor.
            expect(made.labels[2]!.bounds().width).toBeCloseTo(made.values[2]!.bounds().width, 3)
            expect(made.labels[2]!.bounds().y).toBeGreaterThan(made.boxes[2]!.bounds().y + made.boxes[2]!.bounds().height)
        }))
    })

    it('refuses a text that cannot fit at 0.6 of the size, and says how wide the box is and what to do', async () => {
        await compileFilm(film(() => {
            const parts = [{ bits: 1, label: 'present' }, { bits: 31, label: 'frame' }]
            // Build one object first, so that the fonts are there when the errors are read.
            bitField(parts, { width: 800, scale: 'even' })
            const narrow = message(() => bitField(parts, { width: 800 }))
            expect(narrow).toMatch(/^bitField: the label "present" of field 0 does not fit in its box, which is 19 px wide\. Give a larger width, scale: 'even', a minWidth of \d+ or more, or a shorter text$/)
            // The least width that the message names is enough, and a little less is not.
            const least = Number(/a minWidth of (\d+) or more/.exec(narrow)![1])
            const fixed = bitField(parts, { width: 800, minWidth: least })
            expect(size(fixed.labels[0])).toBeGreaterThanOrEqual(26 * 0.6)
            expect(size(fixed.labels[0])).toBeLessThan(26 * 0.65)
            expect(() => bitField(parts, { width: 800, minWidth: least - 3 })).toThrow(/does not fit in its box/)
            // With an even scale, the message does not name what the object already does.
            const even = message(() => bitField([{ bits: 1, label: 'a label that is far too long', value: '1' }, { bits: 1 }], { width: 300, scale: 'even' }))
            expect(even).toMatch(/^bitField: the label "a label that is far too long" of field 0 does not fit under its box, which is 147 px wide\. Give a larger width, or a shorter text$/)
            expect(() => bitField([{ bits: 4, value: '0x00000000000000000000' }], { width: 200 })).toThrow(/the value "0x00000000000000000000" of field 0 does not fit in its box, which is 200 px wide/)
            // Two fields are too narrow. The message names one least width that is enough for both, not the one of the first.
            const flags = [{ bits: 1, label: 'present' }, { bits: 1, label: 'writable page' }, { bits: 30, label: 'frame' }]
            const both = Number(/a minWidth of (\d+) or more/.exec(message(() => bitField(flags, { width: 800 })))![1])
            expect(bitField(flags, { width: 800, minWidth: both }).labels.map(source)).toEqual(['present', 'writable page', 'frame'])
            expect(() => bitField(flags, { width: 800, minWidth: both - 3 })).toThrow(/the label "writable page" of field 1 does not fit/)
            // The message names only what helps. Here 21 fields cannot have the least width that the long label
            // needs, and an even scale gives it a box of 80 px, which is too narrow as well.
            const crowd = [{ bits: 1, label: 'a label of thirty characters !' }, ...Array.from({ length: 19 }, () => ({ bits: 1 })), { bits: 44, label: 'rest' }]
            expect(message(() => bitField(crowd, { width: 1800 }))).toMatch(/does not fit in its box, which is 22 px wide\. Give a larger width, or a shorter text$/)
            // A wide field gains nothing from an even scale, so the message does not name it.
            expect(message(() => bitField([{ bits: 9, label: 'a name that is much too long for it' }, { bits: 1 }], { width: 300 }))).not.toMatch(/even/)
        }))
    })

    it('gives the middle of each edge of a box, by index and by label', async () => {
        await compileFilm(film(() => {
            const made = bitField(address, { width: 1400, height: 80 }).at(100, -50)
            const box = made.boxes[4]!.bounds()
            // A point is in the coordinates of the object, so the place of the object is not in it.
            expect(made.p('PTE')).toEqual(made.p(4))
            expect(made.p('PTE')).toEqual(made.p('PTE', 'bottom'))
            expect(made.p('PTE')).toEqual([expect.closeTo(box.x + box.width / 2 - 100, 6), expect.closeTo(40, 6)])
            expect(made.p(4, 'top')).toEqual([made.p(4)[0], expect.closeTo(-40, 6)])
            // On the stage, the points are on the two edges of the box.
            expect(made.toWorld(...made.p('PTE'))).toEqual([expect.closeTo(box.x + box.width / 2, 6), expect.closeTo(box.y + box.height, 6)])
            expect(made.toWorld(...made.p('PTE', 'top'))).toEqual([expect.closeTo(box.x + box.width / 2, 6), expect.closeTo(box.y, 6)])
            // The left and the right edge, for a line that leaves the row at one of its ends.
            const first = made.boxes[0]!.bounds(), last = made.boxes[5]!.bounds()
            expect(made.toWorld(...made.p(0, 'left'))).toEqual([expect.closeTo(first.x, 6), expect.closeTo(first.y + 40, 6)])
            expect(made.toWorld(...made.p('offset', 'right'))).toEqual([expect.closeTo(last.x + last.width, 6), expect.closeTo(last.y + 40, 6)])
            expect(made.p('offset', 'right')).toEqual([expect.closeTo(700, 6), expect.closeTo(0, 6)])
            expect(made.p(0)[0]).toBeLessThan(made.p('PGD')[0])
            expect(made.field('PTE')).toBe(made.fields[4])
            expect(made.field(0)).toBe(made.fields[0])
            expect(made.field('PTE').children).toContain(made.boxes[4])
        }))
    })

    it('keeps every text clear of the other texts and inside its box in rows of many narrow fields', async () => {
        await compileFilm(film(() => {
            const flag = (label: string) => ({ bits: 1, label })
            const entry = [flag('NX'), { bits: 4, label: 'PKEY' }, { bits: 7, label: 'ignored', unused: true }, { bits: 40, label: 'physical frame number' }, { bits: 3, label: 'AVL', unused: true },
                ...['G', 'PAT', 'D', 'A', 'PCD', 'PWT', 'US', 'RW', 'P'].map(flag)]
            const rows = [
                bitField(entry, { width: 1800, minWidth: 84 }),
                bitField(entry.map((part) => ({ ...part, label: part.label.slice(0, 7), value: '0' })), { width: 1800, scale: 'even' }),
                bitField(Array.from({ length: 32 }, () => ({ bits: 1 })), { width: 800, numbers: 'offsets' }),
                bitField(Array.from({ length: 16 }, () => ({ bits: 4 })), { width: 500 }),
                bitField(Array.from({ length: 16 }, () => ({ bits: 1 })), { width: 420 }),
            ]
            for (const made of rows) {
                const texts = [...made.labels, ...made.values, ...made.numbers].filter((node): node is Node => node !== null).map((node) => node.bounds())
                texts.forEach((one, index) => {
                    for (const other of texts.slice(index + 1)) expect(apart(one, other, 4)).toBe(true)
                })
                made.boxes.forEach((node, index) => {
                    const box = node.bounds()
                    const part = (made.values[index] ?? made.labels[index])?.bounds()
                    if (!part) return
                    expect(part.x).toBeGreaterThan(box.x + 8)
                    expect(ends(part)[1]).toBeLessThan(ends(box)[1] - 8)
                    expect(part.y).toBeGreaterThan(box.y + 8)
                    expect(part.y + part.height).toBeLessThan(box.y + box.height - 8)
                })
                // A number is over the boxes and not in them.
                for (const number of made.numbers) expect(number.bounds().y + number.bounds().height).toBeLessThan(made.boxes[0]!.bounds().y)
            }
            // No number of the first row had to go: one for each of the ten fields of one bit, and two for each of the other four.
            expect(rows[0]!.numbers).toHaveLength(18)
        }))
    })

    it('drops a number that would meet another: the number of a field of one bit first, and bit 0, the first offset and the total last', async () => {
        await compileFilm(film(() => {
            // A box of 26 px has no room for two numbers, so each field shows its high bit. The last field shows bit 0.
            const nibbles = bitField(Array.from({ length: 16 }, () => ({ bits: 4 })), { width: 500 })
            expect(shown(nibbles)).toEqual([...Array.from({ length: 15 }, (_, index) => String(63 - index * 4)), '0'])
            // 64 bits as 20, 3, 2, 1, 30, 1, 2, 3 and 2. The number of the narrow field of one bit, 38, is wider than its
            // box. It goes, and the high bit of the wide field beside it, 37, stays. The low bits 41, 39 and 5 go
            // before the high bits of their fields, and the last field shows bit 0 and not bit 1.
            const mixed = bitField([20, 3, 2, 1, 30, 1, 2, 3, 2].map((bits) => ({ bits })), { width: 1200 })
            expect(shown(mixed)).toEqual(['63', '44', '43', '40', '37', '8', '7', '6', '4', '2', '0'])
            // The number of a first field of one bit goes too, when the high bit of the field after it needs the room.
            expect(shown(bitField([{ bits: 1 }, { bits: 4 }, { bits: 59 }], { width: 1200 }))).toEqual(['62', '59', '58', '0'])
            // Between two wide fields, the number of the field of one bit goes, and both wide fields keep their numbers.
            const wide = bitField([{ bits: 100 }, { bits: 1 }, { bits: 127 }], { width: 2000, minWidth: 12 })
            expect(shown(wide)).toEqual(['227', '128', '126', '0'])
            // 32 fields, 25 px from one to the next: an offset of two digits has no room beside the next one, so every second one goes.
            const bytes = bitField(Array.from({ length: 32 }, () => ({ bits: 1 })), { width: 800, numbers: 'offsets' })
            expect(shown(bytes)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '14', '16', '18', '20', '22', '24', '26', '28', '30', '32'])
            // The total stays, and the offset before it goes, though that offset came first.
            const odd = bitField(Array.from({ length: 31 }, () => ({ bits: 1 })), { width: 775, numbers: 'offsets' })
            expect(shown(odd).slice(-3)).toEqual(['26', '28', '31'])
            // The offset of a field of one byte goes before the offset of a wide field: 102 stays, and 100 and 101 go.
            expect(shown(bitField([{ bits: 100 }, { bits: 1 }, { bits: 1 }, { bits: 97 }], { width: 1000, numbers: 'offsets', minWidth: 12 }))).toEqual(['0', '102', '199'])
            // A last field of one bit keeps its number, bit 0, and the number of the field before it goes.
            expect(shown(bitField([{ bits: 62 }, { bits: 1 }, { bits: 1 }], { width: 400, minWidth: 6 }))).toEqual(['63', '2', '0'])
            // Offset 0 stays when the total would meet it.
            expect(shown(bitField([{ bits: 8 }], { width: 14, numbers: 'offsets' }))).toEqual(['0'])
            // The total takes the place of the offset 8, and then it meets the offset 4 too. Both go, so no two numbers touch.
            const displaced = bitField([{ bits: 4 }, { bits: 4 }, { bits: 99992 }], { width: 58.8, scale: 'even', numbers: 'offsets' })
            expect(shown(displaced)).toEqual(['0', '100000'])
        }))
    })

    it('draws a field that carries nothing as a faint box with a hatch that stops around its text', async () => {
        await compileFilm(film(() => {
            const made = bitField([{ bits: 8, label: 'reserved', unused: true }, { bits: 8, label: 'type' }, { bits: 8, unused: true, color: 'red' }], { width: 900 })
            expect(hatchOf(made, 1)).toBeUndefined()
            const hatch = hatchOf(made, 0)
            // The box is fainter than the box of a field in use, and it is drawn over the hatch.
            expect(made.boxes[0]!.get('stroke')).toEqual(rect(10, 10, { stroke: 'faint' }).get('stroke'))
            expect(made.boxes[0]!.get('fillOpacity')).toBeLessThan(made.boxes[1]!.get('fillOpacity'))
            expect(made.fields[0]!.children.indexOf(hatch!)).toBeLessThan(made.fields[0]!.children.indexOf(made.boxes[0]!))
            // The lines are inside the box, at both sides of the label, and no line enters the room of the label.
            const box = made.boxes[0]!.bounds(), label = made.labels[0]!.bounds(), drawn = hatch!.bounds()
            expect(drawn.x).toBeGreaterThan(box.x - 1e-6)
            expect(ends(drawn)[1]).toBeLessThan(ends(box)[1] + 1e-6)
            expect(drawn.y).toBeGreaterThan(box.y - 1e-6)
            expect(drawn.y + drawn.height).toBeLessThan(box.y + box.height + 1e-6)
            expect(drawn.x).toBeLessThan(label.x - 20)
            expect(ends(drawn)[1]).toBeGreaterThan(ends(label)[1] + 20)
            const rings = hatch!.get('path')!
            expect(rings.length).toBeGreaterThan(20)
            expect(crosses(hatch!, label)).toBe(false)
            // With a value, the hatch stops around the value in the box. The label is under the box, and it is dim, not faint.
            const filled = bitField([{ bits: 8, label: 'reserved', value: '0x00', unused: true }, { bits: 8, label: 'type' }], { width: 600 })
            expect(crosses(hatchOf(filled, 0)!, filled.values[0]!.bounds())).toBe(false)
            expect(filled.labels[0]!.children[0]!.get('fill')).toEqual(text('a', { color: 'dim' }).children[0]!.get('fill'))
            expect(filled.values[0]!.children[0]!.get('fill')).toEqual(text('a', { color: 'dim' }).children[0]!.get('fill'))
            // The text of an unused field is dimmer than the text of a field in use.
            expect(made.labels[0]!.children[0]!.get('fill')).toEqual(text('a', { color: 'dim' }).children[0]!.get('fill'))
            expect(made.labels[1]!.children[0]!.get('fill')).toEqual(text('a', { color: 'ink' }).children[0]!.get('fill'))
            // An unused field with a color of its own keeps the hatch, in that color. With no text, the hatch has no hole.
            const red = hatchOf(made, 2)!
            expect(red.get('stroke')).toEqual(rect(10, 10, { stroke: 'red' }).get('stroke'))
            expect(red.bounds().width).toBeGreaterThan(made.boxes[2]!.bounds().width - 6)
            expect(red.get('path')!.length).toBeLessThan(rings.length)
            // The lines of two boxes are parts of one pattern: a line of the second box is a whole number of steps from a line of the first.
            const sums = (node: Node) => node.get('path')!.map((ring) => ring.p[0]! + ring.p[1]!)
            const step = sums(red)[1]! - sums(red)[0]!
            const steps = (sums(red)[0]! - sums(hatch!)[0]!) / step
            expect(step).toBeGreaterThan(8)
            expect(steps).toBeCloseTo(Math.round(steps), 6)
        }))
    })

    it('enters with nothing on screen at the start, the fields one after another from the left, and all of it at the end', async () => {
        let made!: ReturnType<typeof bitField>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = bitField(address, { width: 1400 })
            s.wait(0.5)
            s.play(made.enter({ lag: 1 }), { duration: 3, ease: linear })
            s.wait(0.5)
        }))
        expect((await compiled.frame(0.2)).ops).toHaveLength(0)
        expect((await compiled.frame(0.5)).ops).toHaveLength(0)
        // Six fields with a lag of 1: each has half a second, one after the other.
        expect(at(0.75, () => made.fields.map(shows))).toEqual([expect.closeTo(0.5, 6), 0, 0, 0, 0, 0])
        expect(at(2.25, () => made.fields.map(shows))).toEqual([1, 1, 1, expect.closeTo(0.5, 6), 0, 0])
        expect(at(3.6, () => [made, ...made.fields].map(shows))).toEqual(Array(7).fill(1))
        // The texts and the numbers are parts of their field, so the first field is on screen with its label and its two numbers.
        const first = (await compiled.frame(0.9)).ops.filter((op): op is PathOp => op.kind === 'path' && Math.max(op.fillAlpha, op.strokeAlpha) > 0)
        expect(first.length).toBe(made.fields[0]!.leaves().length)
        expect((await compiled.frame(3.6)).ops).toHaveLength(made.leaves().length)
    })

    it('fills rows from the top when it wraps, each row as wide as the width, with the boundaries of the rows in line', async () => {
        await compileFilm(film(() => {
            // The 64 bytes of the structure, as four rows of 16: five, three, four and two fields.
            const made = bitField(sqe, { width: 1600, height: 60, wrap: 16, rowGap: 40, numbers: 'offsets' }).at(100, 50)
            // The offset of each member is the one that the kernel asserts with BUILD_BUG_SQE_ELEM in io_uring/io_uring.c.
            expect(made.fields.map((_, index) => made.range(index)[0])).toEqual([0, 1, 2, 4, 8, 16, 24, 28, 32, 40, 42, 44, 48, 56])
            expect(made.range('addr3')).toEqual([48, 55])
            expect(made.range('__pad2')).toEqual([56, 63])
            expect(made.total).toBe(64)
            const boxes = made.boxes.map((box) => box.bounds())
            const rows = [boxes.slice(0, 5), boxes.slice(5, 8), boxes.slice(8, 12), boxes.slice(12)]
            rows.forEach((row, index) => {
                // Each row is 1600 wide. The rows are 60 high and 40 apart, and the middle of all four is the place of the object.
                expect(row[0]!.x).toBeCloseTo(100 - 800, 6)
                expect(ends(row[row.length - 1]!)[1]).toBeCloseTo(100 + 800, 6)
                for (const box of row) {
                    expect(box.y).toBeCloseTo(50 - 180 + index * 100, 6)
                    expect(box.height).toBeCloseTo(60, 6)
                }
            })
            // A field starts at the place of its byte in every row, so the boundaries of the rows are in line.
            const room = boxes[1]!.x - ends(boxes[0]!)[1]
            const starts = [0, 1, 2, 4, 8, 0, 8, 12, 0, 8, 10, 12, 0, 8]
            expect(boxes.map((box) => ((box.x - (100 - 800)) / (1600 + room)) * 16)).toEqual(starts.map((start) => expect.closeTo(start, 6)))
            for (const index of [6, 9, 13]) expect(boxes[index]!.x).toBeCloseTo(boxes[4]!.x, 6)
            // Each row starts with its own offset, over its left end. Only the last row shows the total, over its right end.
            expect(shown(made)).toEqual(['0', '1', '2', '4', '8', '16', '24', '28', '32', '40', '42', '44', '48', '56', '64'])
            for (const [number, box] of [[5, 5], [8, 8], [12, 12]] as const) {
                expect(middle(made.numbers[number]!)[0]).toBeCloseTo(100 - 800, 6)
                expect(made.numbers[number]!.bounds().y + made.numbers[number]!.bounds().height).toBeLessThan(boxes[box]!.y - 4)
                // The numbers of a row are under the boxes of the row over it.
                expect(made.numbers[number]!.bounds().y).toBeGreaterThan(boxes[box - 1]!.y + 60 + 4)
            }
            expect(middle(made.numbers[14]!)[0]).toBeCloseTo(100 + 800, 6)
            // A point of a field is on the edge of its box, in any row. It is in the coordinates of the object.
            expect(made.p('__pad2')).toEqual([expect.closeTo(boxes[13]!.x + boxes[13]!.width / 2 - 100, 6), expect.closeTo(180, 6)])
            expect(made.p('addr', 'top')).toEqual([expect.closeTo(boxes[5]!.x + boxes[5]!.width / 2 - 100, 6), expect.closeTo(-80, 6)])
            expect(made.p('user_data', 'left')).toEqual([expect.closeTo(-800, 6), expect.closeTo(50, 6)])
            expect(made.toWorld(...made.p('splice_fd_in'))).toEqual([expect.closeTo(boxes[11]!.x + boxes[11]!.width / 2, 6), expect.closeTo(boxes[11]!.y + 60, 6)])
            // The texts of a row are in its boxes.
            expect(Math.abs(middle(made.labels[9]!)[1] - middle(made.boxes[9]!)[1])).toBeLessThan(4)
        }))
    })

    it('keeps the boundaries of the rows in line when narrow fields take the least width', async () => {
        await compileFilm(film(() => {
            // At 1200 px a byte has 75 px, less than the least width. The fields of one byte, in the first row, take 110.
            const made = bitField(sqe, { width: 1200, wrap: 16, numbers: 'offsets', minWidth: 110 })
            const boxes = made.boxes.map((box) => box.bounds())
            expect([boxes[0]!.width, boxes[1]!.width]).toEqual([expect.closeTo(110, 6), expect.closeTo(110, 6)])
            for (const box of boxes) expect(box.width).toBeGreaterThan(110 - 1e-6)
            // The rows have their columns in common: a field that starts at one byte of its row starts at one x, in every row.
            const places = new Map<number, number>()
            boxes.forEach((box, index) => {
                const start = made.range(index)[0] % 16
                expect(box.x).toBeCloseTo(places.get(start) ?? box.x, 6)
                places.set(start, box.x)
            })
            expect([...places.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 8, 10, 12])
            // So `addr`, under the two wide fields of one byte, is wider than `off`, which has as many bytes.
            expect(boxes[5]!.width).toBeGreaterThan(boxes[4]!.width + 60)
            // Each row is still as wide as the width, and the bytes that need no more room share the rest evenly.
            for (const first of [0, 5, 8, 12]) expect(boxes[first]!.x).toBeCloseTo(-600, 6)
            for (const last of [4, 7, 11, 13]) expect(ends(boxes[last]!)[1]).toBeCloseTo(600, 6)
            expect(boxes[6]!.width).toBeCloseTo(boxes[7]!.width, 6)
            // A last row with fewer bytes has room in the same columns. Its two fields of one byte take the least width.
            const short = bitField([{ bits: 8, label: 'a' }, { bits: 8, label: 'b' }, { bits: 1, label: 'cc' }, { bits: 1, label: 'dd' }], { width: 560, wrap: 16, minWidth: 60, numbers: 'offsets' })
            const [a, , cc, dd] = short.boxes.map((box) => box.bounds())
            expect([cc!.width, dd!.width]).toEqual([expect.closeTo(60, 6), expect.closeTo(60, 6)])
            expect(cc!.x).toBeCloseTo(a!.x, 6)
            expect(ends(dd!)[1]).toBeLessThan(ends(a!)[1])
            // A field of two bytes over two fields of one byte: the narrow ones take the least width first, so the
            // wide one is as wide as both, and every field has the least width or more.
            const stacked = bitField([{ bits: 2, label: 'ab' }, { bits: 14, label: 'rest' }, { bits: 1, label: 'a' }, { bits: 1, label: 'b' }, { bits: 14, label: 'more' }], { width: 800, wrap: 16, minWidth: 100 })
            const [ab, , one, two] = stacked.boxes.map((box) => box.bounds())
            expect([one!.width, two!.width]).toEqual([expect.closeTo(100, 6), expect.closeTo(100, 6)])
            expect(ab!.x).toBeCloseTo(one!.x, 6)
            expect(ends(ab!)[1]).toBeCloseTo(ends(two!)[1], 6)
            // When the fields cannot have the least width, the message names the rows and not one row.
            expect(() => bitField(sqe, { width: 300, wrap: 16, numbers: 'offsets', minWidth: 110 })).toThrow(/a width of 300 has no room for the fields of 110 or more in rows of 16 bytes. Give a larger width or a smaller minWidth/)
        }))
    })

    it('gives the rows the room that their numbers and labels need, and a short last row the width of its bits', async () => {
        await compileFilm(film(() => {
            const bytes = (count: number, label: string, value?: string) => ({ bits: count, label, ...(value ? { value } : {}) })
            const top = (node: Node) => node.bounds().y, bottom = (node: Node) => node.bounds().y + node.bounds().height
            // With no row gap given, the numbers of the second row are clear of the boxes of the first.
            const plain = bitField([bytes(8, 'a'), bytes(8, 'b'), bytes(8, 'c')], { width: 1600, wrap: 16, numbers: 'offsets' })
            expect(top(plain.numbers[2]!)).toBeGreaterThan(bottom(plain.boxes[0]!) + 8)
            // A last row with half the bytes is half as long, and it starts at the left. A byte has one width in both rows.
            expect(plain.boxes[2]!.bounds().x).toBeCloseTo(-800, 6)
            expect(plain.boxes[2]!.bounds().width).toBeCloseTo(plain.boxes[0]!.bounds().width, 6)
            expect(shown(plain)).toEqual(['0', '8', '16', '24'])
            // One row with half the bytes of a full row starts at the left end of a full row too. So two structures
            // with one `wrap` and one `width` have one scale, and `.at()` is the middle of a full row.
            const single = bitField([bytes(4, 'a'), bytes(4, 'b')], { width: 1600, wrap: 16, numbers: 'offsets' }).at(100, 0)
            expect(single.boxes[0]!.bounds().x).toBeCloseTo(100 - 800, 6)
            expect(ends(single.boxes[1]!.bounds())[1]).toBeLessThan(100)
            expect(single.boxes[0]!.bounds().width).toBeCloseTo(plain.boxes[0]!.bounds().width / 2 - (single.boxes[1]!.bounds().x - ends(single.boxes[0]!.bounds())[1]) / 2, 6)
            // With labels under the boxes, the rows are farther apart: a label of the first row is clear of the numbers of the second.
            const named = bitField([bytes(8, 'a', '1'), bytes(8, 'b', '2'), bytes(8, 'c', '3')], { width: 1600, wrap: 16, numbers: 'offsets' })
            expect(top(named.boxes[2]!) - top(named.boxes[0]!)).toBeGreaterThan(top(plain.boxes[2]!) - top(plain.boxes[0]!) + 26)
            expect(top(named.numbers[2]!)).toBeGreaterThan(bottom(named.labels[0]!) + 8)
            expect(top(named.labels[2]!)).toBeGreaterThan(bottom(named.boxes[2]!))
            // Without numbers and without labels under the boxes, the rows are near each other.
            const bare = bitField([bytes(8, 'a'), bytes(8, 'b'), bytes(8, 'c')], { width: 1600, wrap: 16, numbers: false })
            expect(top(bare.boxes[2]!) - bottom(bare.boxes[0]!)).toBeGreaterThan(8)
            expect(top(bare.boxes[2]!) - bottom(bare.boxes[0]!)).toBeLessThan(top(plain.boxes[2]!) - bottom(plain.boxes[0]!))
            // Values with no label under them need no room under the boxes: the rows are as near as without values.
            const unnamed = bitField([{ bits: 8, value: '1' }, { bits: 8, value: '2' }, { bits: 8, value: '3' }], { width: 1600, wrap: 16, numbers: 'offsets' })
            expect(top(unnamed.boxes[2]!) - top(unnamed.boxes[0]!)).toBeCloseTo(top(plain.boxes[2]!) - top(plain.boxes[0]!), 6)
            // An empty value puts its label under the box as any value does, so the rows have room for the labels.
            const empty = bitField([bytes(8, 'a'), bytes(8, 'b'), bytes(8, 'c')].map((part) => ({ ...part, value: '' })), { width: 1600, wrap: 16, numbers: 'offsets' })
            expect(top(empty.boxes[2]!) - top(empty.boxes[0]!)).toBeCloseTo(top(named.boxes[2]!) - top(named.boxes[0]!), 6)
            // The bits count down through the rows, and with an even scale each row shares its width among its fields.
            const word = bitField([{ bits: 16 }, { bits: 16 }, { bits: 32 }], { width: 800, wrap: 32 })
            expect(shown(word)).toEqual(['63', '48', '47', '32', '31', '0'])
            expect(word.range(2)).toEqual([31, 0])
            const even = bitField([{ bits: 1 }, { bits: 3 }, { bits: 4 }, { bits: 8 }], { width: 800, wrap: 8, scale: 'even' })
            expect(even.boxes[1]!.bounds().width).toBeCloseTo(even.boxes[0]!.bounds().width, 6)
            expect(even.boxes[3]!.bounds().width).toBeCloseTo(800, 6)
            // An even scale has no width for a bit, so a last row with fewer bits is as wide as the other rows.
            const short = bitField([{ bits: 4 }, { bits: 4 }, { bits: 4 }], { width: 800, wrap: 8, scale: 'even' })
            expect(short.boxes[2]!.bounds().width).toBeCloseTo(800, 6)
            // A row gap with no room for the numbers is an error. The room that the message names is enough.
            const tight = message(() => bitField([bytes(8, 'a'), bytes(8, 'b'), bytes(8, 'c')], { wrap: 16, numbers: 'offsets', rowGap: 10 }))
            expect(tight).toMatch(/^bitField: rowGap is the room between two rows\. The numbers and the labels of these fields need \d+ or more$/)
            const needed = Number(/need (\d+) or more/.exec(tight)![1])
            const close = bitField([bytes(8, 'a'), bytes(8, 'b'), bytes(8, 'c')], { wrap: 16, numbers: 'offsets', rowGap: needed })
            expect(top(close.numbers[2]!)).toBeGreaterThanOrEqual(bottom(close.boxes[0]!))
            expect(top(close.boxes[2]!) - bottom(close.boxes[0]!)).toBeCloseTo(needed, 6)
            expect(() => bitField([bytes(8, 'a'), bytes(8, 'b'), bytes(8, 'c')], { wrap: 16, numbers: 'offsets', rowGap: needed - 2 })).toThrow(/rowGap is the room/)
            // With one row, no text can meet a box of a next row, so any row gap is right: also 0.
            expect(bitField([bytes(8, 'a'), bytes(8, 'b')], { rowGap: 0, numbers: 'offsets' }).boxes).toHaveLength(2)
            expect(bitField([bytes(8, 'a'), bytes(8, 'b')], { wrap: 16, rowGap: 0, numbers: 'offsets' }).boxes).toHaveLength(2)
            // A field that crosses the end of a row, and a row with no room for its fields, are errors.
            expect(() => bitField([bytes(8, 'a'), bytes(4, 'b'), bytes(8, 'off')], { wrap: 16, numbers: 'offsets' })).toThrow(/field 2 \("off"\) has 8 bytes and starts at byte 12 of a row of 16, so it crosses the end of the row. Split it into two fields, or change wrap/)
            expect(() => bitField([{ bits: 20 }], { wrap: 16 })).toThrow(/field 0 has 20 bits and starts at bit 0 of a row of 16/)
            expect(() => bitField([bytes(8, 'a'), bytes(2, 'b'), bytes(2, 'c'), bytes(2, 'd'), bytes(2, 'e')], { width: 300, wrap: 8, minWidth: 80, scale: 'even' })).toThrow(/a width of 300 has no room for 4 fields of 80 or more in row 1. Give a larger width or a smaller minWidth/)
        }))
    })

    it('changes a value in place: the old text fades out, then the new text fades in, and values holds the new text', async () => {
        let made!: ReturnType<typeof bitField>
        let first!: Node
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(bitField([{ bits: 1, label: 'P', value: '0' }, { bits: 7, label: 'rest', value: '0x00' }], { width: 600, minWidth: 80 }))
            first = made.values[0]!
            s.wait(0.5)
            s.play(made.setValue('P', '1'), { duration: 1, ease: linear })
            s.wait(0.5)
            s.play(seq(made.setValue(1, '0x7f'), made.setValue('rest', '0x01')), { duration: 2, ease: linear })
            s.wait(0.5)
        }))
        const next = made.values[0]!
        expect(next).not.toBe(first)
        expect(source(next)).toBe('1')
        // The old text is not drawn after the change: the frame has as many marks as before it.
        expect((await compiled.frame(1.6)).ops).toHaveLength((await compiled.frame(0.4)).ops.length)
        expect(made.field('P').children).toContain(next)
        // The new text is in the middle of the box, as the first one was.
        expect(at(2, () => middle(next)[0])).toBeCloseTo(at(2, () => middle(made.boxes[0]!)[0]), 6)
        expect(at(2, () => Math.abs(middle(next)[1] - middle(made.boxes[0]!)[1]))).toBeLessThan(4)
        // The change runs from 0.5 to 1.5. The old text leaves in the first half, and the new one arrives in the second.
        expect(at(0.4, () => [shows(first), shows(next)])).toEqual([1, 0])
        expect(at(0.75, () => [shows(first), shows(next)])).toEqual([expect.closeTo(0.5, 6), 0])
        expect(at(1.25, () => [shows(first), shows(next)])).toEqual([0, expect.closeTo(0.5, 6)])
        expect(at(1.6, () => [shows(first), shows(next)])).toEqual([0, 1])
        for (let time = 0.4; time < 1.7; time += 0.05) expect(at(time, () => Math.min(shows(first), shows(next)))).toBe(0)
        // Two changes in one sequence, from 2 to 3 and from 3 to 4: the second one starts from the text of the first.
        const texts = made.field('rest').children.filter((node) => source(node)?.startsWith('0x'))
        expect(texts.map(source)).toEqual(['0x00', '0x7f', '0x01'])
        expect(made.values[1]).toBe(texts[2])
        expect(at(2.9, () => texts.map(shows))).toEqual([0, expect.closeTo(0.8, 6), 0])
        expect(at(3.25, () => texts.map(shows))).toEqual([0, expect.closeTo(0.5, 6), 0])
        expect(at(3.75, () => texts.map(shows))).toEqual([0, 0, expect.closeTo(0.5, 6)])
        expect(at(4.3, () => texts.map(shows))).toEqual([0, 0, 1])
    })

    it('fits a new value as it fits the first one, moves the hole of a hatch with it, and refuses a field with no value', async () => {
        let made!: ReturnType<typeof bitField>
        let old!: Box
        // The object is away from 0, 0, and the lines of a hatch are in the coordinates of the object.
        const local = (box: Box) => ({ ...box, x: box.x - 300, y: box.y - 200 })
        await compileFilm(film({ fps: 20 }, (s) => {
            // Two rows of 8 bytes: two fields of 4, and one reserved field of 8.
            made = s.add(bitField([{ bits: 4, label: 'fd', value: '3' }, { bits: 4, label: 'len' }, { bits: 8, label: 'reserved', value: '0', unused: true }], { width: 300, wrap: 8, numbers: 'offsets' }).at(300, 200))
            old = local(made.values[2]!.bounds())
            s.wait(0.5)
            s.play(made.setValue('fd', '0xffffffff'), made.setValue('reserved', '0x0000'), { duration: 1, ease: linear })
            s.wait(0.5)
            // A field with no value has its label in the box, so a value has no room there.
            expect(() => made.setValue('len', '8')).toThrow(/field 1 \("len"\) was built with no value, so its box has no room for one. Give the field a value when you build the object/)
            expect(() => made.setValue('size', '8')).toThrow(/no field has the label "size"/)
            // A text that cannot fit at 0.6 of the size is an error when the film asks for it, and it changes nothing.
            const shown = made.values[0]
            expect(() => made.setValue('fd', '0xffffffffffffffff')).toThrow(/the value "0xffffffffffffffff" of field 0 \("fd"\) does not fit in its box, which is 147 px wide\. Give a larger width, or a shorter text$/)
            // Where the fields can have it, the message names a least width. It is the one for the new text, which is
            // wider than the text of any field: an object that is built with it and with that text has no error.
            const roomy = [{ bits: 4, label: 'fd', value: '3' }, { bits: 28, label: 'rest' }]
            const least = Number(/a minWidth of (\d+) or more/.exec(message(() => bitField(roomy, { width: 800 }).setValue('fd', '0xffffffffffffffff')))![1])
            expect(least).toBeGreaterThan(150)
            expect(source(bitField([{ ...roomy[0]!, value: '0xffffffffffffffff' }, roomy[1]!], { width: 800, minWidth: least }).values[0])).toBe('0xffffffffffffffff')
            expect(() => made.setValue('fd', '1\n2')).toThrow(/the value "1\\n2" of field 0 has a line break. A value is one line/)
            expect(() => made.setValue('fd', 7 as never)).toThrow(/the new value of field 0 \("fd"\) is 7. A value is a text, such as '1' or ''/)
            expect(() => (made.setValue as (which: string) => unknown)('fd')).toThrow(/the new value of field 0 \("fd"\) is undefined/)
            expect(made.values[0]).toBe(shown)
        }))
        // The new value of ten characters is wider than the room in the box, so it is smaller, with room at both sides.
        const value = made.values[0]!, box = at(2, () => made.boxes[0]!.bounds()), drawn = at(2, () => value.bounds())
        expect(source(value)).toBe('0xffffffff')
        expect(size(value)).toBeLessThan(26)
        expect(size(value)).toBeGreaterThanOrEqual(26 * 0.6)
        expect(drawn.x).toBeGreaterThan(box.x + 8)
        expect(ends(drawn)[1]).toBeLessThan(ends(box)[1] - 8)
        // The value of the second row is in the box of the second row.
        const wide = local(at(2, () => made.values[2]!.bounds())), lower = local(at(2, () => made.boxes[2]!.bounds()))
        expect(wide.y).toBeGreaterThan(lower.y + 8)
        expect(wide.y + wide.height).toBeLessThan(lower.y + lower.height - 8)
        expect(wide.width).toBeGreaterThan(old.width * 3)
        // The new value of an unused field is dim, as the first one was. The new value of a field in use is not.
        expect(ink(made.values[2])).toEqual(inkOf('dim'))
        expect(ink(made.values[0])).toEqual(inkOf('ink'))
        // The hole in the hatch takes the size of the new text at the middle of the change, while no text shows.
        const lines = hatchOf(made, 2)!
        expect(at(0.9, () => crosses(lines, old))).toBe(false)
        expect(at(0.9, () => crosses(lines, wide))).toBe(true)
        expect(at(1.1, () => crosses(lines, wide))).toBe(false)
    })

    it('gives the same picture when a film plays one setValue animation twice', async () => {
        let made!: ReturnType<typeof bitField>
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(bitField([{ bits: 1, label: 'P', value: '0' }, { bits: 7, label: 'rest', value: '0x00' }], { width: 600, minWidth: 80 }))
            const change = made.setValue('P', '1')
            s.wait(0.5)
            s.play(change, { duration: 1, ease: linear })
            s.wait(0.5)
            s.play(change, { duration: 1, ease: linear })
            s.wait(0.5)
            s.play(made.setValue('P', '2'), { duration: 1, ease: linear })
            s.play(change, { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        const texts = valuesOf(made, 0)
        expect(texts.map(source)).toEqual(['0', '1', '2'])
        // The first play runs from 0.5 to 1.5. The second play, from 2 to 3, changes nothing: the box shows 1 all the time.
        for (const time of [1.6, 2, 2.25, 2.5, 2.75, 3, 3.4]) expect(at(time, () => texts.map(shows))).toEqual([0, 1, 0])
        // Another change, from 3.5 to 4.5, puts 2 in the box. The first animation, played again, brings 1 back.
        expect(at(4.4, () => texts.map(shows))).toEqual([0, 0, expect.closeTo(0.8, 6)])
        expect(at(4.75, () => texts.map(shows))).toEqual([0, 0, expect.closeTo(0.5, 6)])
        expect(at(5.25, () => texts.map(shows))).toEqual([0, expect.closeTo(0.5, 6), 0])
        expect(at(5.8, () => texts.map(shows))).toEqual([0, 1, 0])
        expect(made.values[0]).toBe(texts[1])
        // Two changes of one field at one time: the later one wins, and the text of the first one does not show under it.
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(bitField([{ bits: 1, label: 'P', value: '0' }, { bits: 7, label: 'rest', value: '0x00' }], { width: 600, minWidth: 80 }))
            s.wait(0.5)
            s.play(made.setValue('P', '1'), made.setValue('P', '2'), { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        expect(valuesOf(made, 0).map(source)).toEqual(['0', '1', '2'])
        expect(at(1.25, () => valuesOf(made, 0).map(shows))).toEqual([0, 0, expect.closeTo(0.5, 6)])
        expect(at(1.8, () => valuesOf(made, 0).map(shows))).toEqual([0, 0, 1])
        expect(source(made.values[0])).toBe('2')
    })

    it('takes an empty text as a value: an empty box with its label under it, which setValue fills', async () => {
        let made!: ReturnType<typeof bitField>
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(bitField([{ bits: 4, label: 'fd', value: '' }, { bits: 4, label: 'len' }, { bits: 8, label: 'res', value: '7' }], { width: 600, numbers: 'offsets' }))
            s.wait(0.5)
            s.play(made.setValue('fd', '3'), { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        const boxes = at(0, () => made.boxes.map((box) => box.bounds()))
        // The field with the empty value has its label under its box, as the field with the value 7 has. The other label is in its box.
        expect(at(0, () => made.labels[0]!.bounds().y)).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height + 4)
        expect(at(0, () => made.labels[0]!.get('y'))).toBeCloseTo(at(0, () => made.labels[2]!.get('y')), 6)
        expect(at(0, () => made.labels[1]!.bounds().y)).toBeLessThan(boxes[1]!.y + boxes[1]!.height)
        // The box is empty at first, and then it shows the new value.
        const texts = valuesOf(made, 0)
        expect(texts.map(source)).toEqual(['', '3'])
        expect(at(0.4, () => texts[0]!.bounds().width)).toBe(0)
        expect(at(1.8, () => shows(texts[1]!))).toBe(1)
        expect(made.values[0]).toBe(texts[1])
        const drawn = at(1.8, () => texts[1]!.bounds())
        expect(drawn.x).toBeGreaterThan(boxes[0]!.x + 8)
        expect(drawn.y).toBeGreaterThan(boxes[0]!.y + 8)
        expect(drawn.y + drawn.height).toBeLessThan(boxes[0]!.y + boxes[0]!.height - 8)
        // An empty value takes no room, so the hatch of an unused field has no hole: its lines are those of a field with no text.
        await compileFilm(film(() => {
            const empty = bitField([{ bits: 8, label: 'pad', value: '', unused: true }], { width: 400 })
            const none = bitField([{ bits: 8, unused: true }], { width: 400 })
            expect(hatchOf(empty, 0)!.get('path')!.length).toBe(hatchOf(none, 0)!.get('path')!.length)
            expect(crosses(hatchOf(empty, 0)!, { x: -6, y: -6, width: 12, height: 12 })).toBe(true)
            // A value of one character has a hole.
            const one = bitField([{ bits: 8, label: 'pad', value: '0', unused: true }], { width: 400 })
            expect(crosses(hatchOf(one, 0)!, { x: -6, y: -6, width: 12, height: 12 })).toBe(false)
        }))
    })

    it('has a duration and a lag of its own when the film gives none', async () => {
        let made!: ReturnType<typeof bitField>
        await compileFilm(film({ fps: 20 }, (s) => {
            made = bitField([{ bits: 1, label: 'N', value: '1' }, { bits: 1, label: 'Z', value: '0' }, { bits: 1, label: 'C', value: '0' }], { width: 400 })
            expect(made.enter().duration).toBe(1.4)
            expect(made.enter({ duration: 3 }).duration).toBe(3)
            expect(made.setValue('N', '0').duration).toBe(0.6)
            expect(made.setValue('N', '0', { duration: 2 }).duration).toBe(2)
            s.wait(0.5)
            // With no lag given, a field starts 0.35 of its own time after the field before it.
            s.play(made.enter(), { duration: 1.7, ease: linear })
            s.wait(0.5)
        }))
        // Three fields in 1.7 s: each one takes 1 s, and they start at 0.5, 0.85 and 1.2.
        expect(at(1, () => made.fields.map(shows))).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.15, 6), 0])
        expect(at(1.7, () => made.fields.map(shows))).toEqual([1, expect.closeTo(0.85, 6), expect.closeTo(0.5, 6)])
        expect(at(2.3, () => made.fields.map(shows))).toEqual([1, 1, 1])
    })

    it('gives a copy its own fields, boxes and texts', async () => {
        await compileFilm(film(() => {
            const made = bitField([{ bits: 8, label: 'type', value: '7' }, { bits: 8, label: 'rest' }], { width: 600 }), copy = made.clone()
            expect(copy.field('type')).not.toBe(made.field('type'))
            expect(copy.field('type').children).toEqual(expect.arrayContaining([copy.boxes[0], copy.values[0], copy.labels[0], copy.numbers[0]]))
            expect(copy.boxes[0]).not.toBe(made.boxes[0])
            expect(copy.values[1]).toBeNull()
            expect(copy.p('rest')).toEqual(made.p('rest'))
            expect(copy.range('rest')).toEqual([7, 0])
        }))
    })

    it('names a wrong field, size or option', async () => {
        await compileFilm(film(() => {
            const made = bitField(address)
            expect(() => bitField([])).toThrow(/at least one field/)
            expect(() => bitField([{ bits: 0 }])).toThrow(/field 0 has 0 bits. A field has a whole number of bits, 1 or more/)
            expect(() => bitField([{ bits: 4 }, { bits: 1.5, label: 'half' }])).toThrow(/field 1 \("half"\) has 1.5 bits/)
            expect(() => bitField([{ bits: Number.NaN }])).toThrow(/whole number of bits/)
            expect(() => bitField(address, { width: 0 })).toThrow(/width is the width of one row of fields, more than 0/)
            expect(() => bitField(address, { size: 0 })).toThrow(/size is a text size, more than 0/)
            expect(() => bitField(address, { size: -4 })).toThrow(/size is a text size/)
            expect(() => bitField(address, { height: 0 })).toThrow(/height is the height of the boxes/)
            expect(() => bitField(address, { height: 30 })).toThrow(/A text of size 26 needs a height of 39 or more/)
            expect(() => bitField(address, { scale: 'equal' as never })).toThrow(/scale is 'proportional' or 'even', not "equal"/)
            expect(() => bitField(address, { numbers: 'bytes' as never })).toThrow(/numbers is 'bits', 'offsets' or false, not "bytes"/)
            expect(() => bitField(address, { minWidth: -1 })).toThrow(/minWidth is the least width of a field, 0 or more/)
            expect(() => bitField(Array.from({ length: 64 }, () => ({ bits: 1 })), { width: 100 })).toThrow(/a width of 100 has no room for 64 fields. Give a larger width$/)
            // A box with no inside is an error too: here a bit has 2 px, less than the room between two boxes.
            expect(() => bitField([{ bits: 1, label: 'P' }, { bits: 499 }], { width: 1000 })).toThrow(/field 0 \("P"\) is too narrow to draw in a width of 1000. Give a larger width, scale: 'even', or a minWidth$/)
            expect(() => bitField(Array.from({ length: 64 }, () => ({ bits: 1 })), { width: 500, scale: 'even' })).toThrow(/field 0 is too narrow to draw in a width of 500. Give a larger width$/)
            expect(() => bitField(address, { wrap: 0 })).toThrow(/wrap is the number of bits in one row, a whole number, 1 or more/)
            expect(() => bitField(address, { wrap: 2.5 })).toThrow(/wrap is the number of bits in one row/)
            expect(() => bitField(address, { rowGap: -1 })).toThrow(/rowGap is the room between two rows/)
            for (const read of [() => made.field('PGE'), () => made.p('PGE'), () => made.range('PGE')]) {
                expect(read).toThrow(/no field has the label "PGE". The labels are "sign extension", "PGD", "PUD", "PMD", "PTE", "offset"/)
            }
            expect(() => made.field(6)).toThrow(/no field 6. The object has 6 fields, and the first is field 0/)
            expect(() => made.p(-1)).toThrow(/no field -1/)
            expect(() => made.range(1.5)).toThrow(/no field 1.5/)
            expect(() => made.p('PTE', 'middle' as never)).toThrow(/the edge of p\(\) is 'top', 'bottom', 'left' or 'right', not "middle"/)
            // A label or a value is one line of text. Its lines would start at the left and leave the middle of the box.
            expect(() => bitField([{ bits: 8, label: 'physical\nframe number' }])).toThrow(/the label "physical\\nframe number" of field 0 has a line break. A label is one line: give a shorter text, or a second field/)
            expect(() => bitField([{ bits: 8, label: 'a' }, { bits: 8, label: 'b', value: '0x1\n0x2' }])).toThrow(/the value "0x1\\n0x2" of field 1 has a line break. A value is one line/)
            // A film is not type-checked when it runs, so a number can arrive in place of a text.
            expect(() => bitField([{ bits: 4, label: 'a', value: 7 as never }])).toThrow(/the value of field 0 is 7. A value is a text, such as "7"/)
            expect(() => bitField([{ bits: 4, label: 5 as never }])).toThrow(/the label of field 0 is 5. A label is a text, such as "5"/)
            // Two fields may share a name. A film must then give the index.
            const twice = bitField([{ bits: 4, label: 'reserved' }, { bits: 4, label: 'type' }, { bits: 4, label: 'reserved' }], { width: 900 })
            expect(() => twice.p('reserved')).toThrow(/2 fields have the label "reserved". Give the index: 0 or 2/)
            expect(twice.field('type')).toBe(twice.fields[1])
            expect(() => bitField([{ bits: 4 }]).field('type')).toThrow(/No field has a label, so give an index/)
        }))
    })
})

describe('segmented bar', () => {
    type Bar = ReturnType<typeof segmentedBar>
    // The room between two parts, at the default text size of 28.
    const SEAM = 28 * 0.12
    // A bar of 10 units that is 1000 wide: one unit is 100 px, and the left end is at -500.
    const two = (options: Parameters<typeof segmentedBar>[1] = {}) => segmentedBar([{ name: 'a', value: 2 }, { name: 'b', value: 6 }], { capacity: 10, width: 1000, ...options })
    const shares = () => segmentedBar([{ name: 'create', value: 0.5 }, { name: 'revoke', value: 0.25 }, { name: 'rename', value: 0.15 }, { name: 'quota', value: 0.1 }], { width: 1000 })
    const crowded = [['instructions', 2], ['authorization', 1], ['retrieved passages', 1], ['answer reserve', 20], ['task', 1], ['tool results', 1]].map(([name, value]) => ({ name: name as string, value: value as number }))
    /** The left and the right end of the box of a part at a time, on the stage. Null when the part draws no box. */
    const ends = (part: Node, t: number): [number, number] | null => at(t, () => {
        const box = part.children[0]!.bounds()
        return box.width > 0 ? [box.x, box.x + box.width] : null
    })
    /** What a label draws at a time: its two texts, the x of its middle, its two ends, its opacity, and the box of its line to the part. Null when it draws nothing. */
    const drawn = (node: Node, t: number) => at(t, () => {
        const made = node.draw!(t) as Node | null
        if (!made) return null
        const [leader, name, amount] = made.children as unknown as [Node, TextNode, TextNode]
        const boxes = [name.bounds(), amount.bounds()], line = pathBounds(leader.get('path')!)!
        return {
            name: name.source, amount: amount.source, x: name.get('x'), y: [name.get('y'), amount.get('y')], opacity: made.get('opacity'), sizes: [name.size, amount.size], fonts: [name.font, amount.font],
            left: Math.min(...boxes.map((box) => box.x)), right: Math.max(...boxes.map((box) => box.x + box.width)),
            leader: { left: line.x, right: line.x + line.width, top: line.y, bottom: line.y + line.height, stroke: leader.get('stroke') },
        }
    })
    const label = (part: Node, t: number) => drawn(part.children[1]!, t)
    const readout = (bar: Bar, t: number) => at(t, () => bar.readout!.draw!(t) as unknown as TextNode)
    /** The label of the free room. */
    const rest = (bar: Bar, t: number) => drawn((bar as unknown as { rest: Node }).rest, t)
    const message = (run: () => unknown) => { try { run() } catch (error) { return (error as Error).message } return '' }
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    /** The filled shapes of a color at a time, on the canvas. A letter is not one of them. */
    const filled = (f: CompiledFilm, t: number, color: Rgba) => paths(f, t).filter((op) => same(op.fill, color) && op.node?.data['key'] === undefined).map((op) => pathBounds(op.path)!)

    it('draws each part to scale from the left end, and places the middle of the bar from 0 to max', async () => {
        await compileFilm(film(() => {
            const bar = two().at(100, 50)
            expect([bar.x(0), bar.x(2.5), bar.x(10)]).toEqual([-500, -250, 500])
            // Part a holds 2 of the 10 units, so it is a fifth of the width. Two parts have a little room between them.
            const a = ends(bar.part('a'), 0)!, b = ends(bar.part('b'), 0)!
            expect(a[0]).toBeCloseTo(100 - 500 + SEAM / 2, 6)
            expect(a[1]).toBeCloseTo(100 - 300 - SEAM / 2, 6)
            expect(b[0]).toBeCloseTo(100 - 300 + SEAM / 2, 6)
            expect(b[1]).toBeCloseTo(100 + 300 - SEAM / 2, 6)
            // The frame goes from 0 to the capacity, around the place of the object.
            const frame = bar.frame.bounds()
            expect(frame.x).toBeCloseTo(-400, 6)
            expect(frame.x + frame.width).toBeCloseTo(600, 6)
            expect(frame.y + frame.height / 2).toBeCloseTo(50, 6)
            expect(frame.height).toBe(67)
            // With room for an amount over the capacity, the frame ends at the capacity, and a part has the scale of `max`.
            const roomy = segmentedBar([{ name: 'a', value: 5 }], { capacity: 10, max: 20, width: 1000 })
            expect(roomy.frame.bounds().width).toBeCloseTo(500, 6)
            expect(ends(roomy.part('a'), 0)![1]).toBeCloseTo(-250 - SEAM / 2, 6)
            expect([roomy.capacity, roomy.max]).toEqual([10, 20])
            // The line of the capacity stands at the end of the frame, and the region with no piece is the frame.
            const post = roomy.limit!.bounds()
            expect(post.x + post.width / 2).toBeCloseTo(0, 6)
            expect([roomy.region().left, roomy.region().right]).toEqual([-500, 0])
            // The title starts at the left end of the bar, and the readout ends at the line of the capacity.
            const titled = segmentedBar([{ name: 'a', value: 5 }], { capacity: 10, max: 20, width: 1000, title: 'window' })
            expect(Math.abs(titled.title!.bounds().x + 500)).toBeLessThan(3)
            const words = readout(titled, 0).bounds()
            expect(Math.abs(words.x + words.width)).toBeLessThan(3)
            // `height` sets the height of the bar, and a bar with no `width` is 1200 wide.
            expect(two({ height: 100 }).frame.bounds().height).toBe(100)
            expect(segmentedBar([{ name: 'a', value: 1 }]).frame.bounds().width).toBeCloseTo(1200, 6)
            // Without a capacity, the parts are shares of the whole bar: the last one ends at the right end.
            const whole = shares()
            expect(whole.capacity).toBeCloseTo(1, 12)
            expect(whole.limit).toBeNull()
            expect(ends(whole.part('quota'), 0)![1]).toBeCloseTo(500 - SEAM / 2, 6)
        }))
    })

    it('gives the places of a part and of an amount: p(), region(), range() and x()', async () => {
        await compileFilm(film(() => {
            const bar = two().at(100, 50)
            expect(bar.range('a')).toEqual([0, 2])
            expect(bar.range('b')).toEqual([2, 8])
            // The points are in the coordinates of the object. The bar is 67 high.
            expect(bar.p('b')).toEqual([0, -33.5])
            expect(bar.p('b', 'bottom')).toEqual([0, 33.5])
            expect(bar.p('b', 'left')).toEqual([-300, 0])
            expect(bar.p('b', 'right')).toEqual([300, 0])
            // A region is a box of the stage, where the object is now.
            const part = bar.region({ part: 'b' })
            expect([part.left, part.right, part.top, part.bottom]).toEqual([-200, 400, 16.5, 83.5])
            const frame = bar.region()
            expect([frame.left, frame.right]).toEqual([-400, 600])
            const stretch = bar.region({ from: 1, to: 3 })
            expect([stretch.left, stretch.right]).toEqual([-300, -100])
            expect(bar.region({ at: 7 }).point('top')).toEqual([300, 16.5])
            expect(message(() => bar.p('zz'))).toBe('segmentedBar: range: no part "zz". The parts are "a", "b"')
            expect(message(() => bar.p('a', 'middle' as never))).toMatch(/the edge of p\(\) is 'top', 'bottom', 'left' or 'right', not "middle"/)
            expect(message(() => bar.x(11))).toMatch(/x: the amount is 11\. The bar goes from 0 to 10/)
            expect(message(() => bar.region({ part: 'a', at: 2 }))).toMatch(/`part` for one part, or amounts .* not both/)
            expect(message(() => bar.region({ from: 3, to: 1 }))).toMatch(/`from` is 3 and `to` is 1/)
            expect(message(() => bar.region({ lane: 'a' } as never))).toMatch(/region has no piece "lane"\. Its pieces are: part, label, from, to, at/)
            // The label of a part: its two lines under the bar, around the middle of the label. The room of a label is as wide as the widest amount at least.
            const under = bar.region({ label: 'b' }), words = label(bar.part('b'), 0)!
            expect((under.left + under.right) / 2).toBeCloseTo(100 + words.x, 6)
            expect(under.left).toBeLessThanOrEqual(100 + words.left)
            expect(under.right).toBeGreaterThanOrEqual(100 + words.right)
            expect(under.top).toBeGreaterThan(part.bottom)
            expect(under.top).toBeLessThan(50 + words.y[0]!)
            expect(under.bottom).toBeGreaterThan(50 + words.y[1]!)
            expect(under.bottom).toBeCloseTo(boxOf(bar).bottom, 6)
            // The label of a narrow part is not under its box: its region follows the label.
            const tight = segmentedBar(crowded, { capacity: 32, width: 1400, free: 'free' })
            const pushed = tight.region({ label: 'retrieved passages' })
            expect((pushed.left + pushed.right) / 2).toBeCloseTo(label(tight.part('retrieved passages'), 0)!.x, 6)
            expect(pushed.left).toBeGreaterThan(tight.region({ part: 'retrieved passages' }).right)
            expect(message(() => bar.region({ label: 'a', at: 2 }))).toBe('segmentedBar: region takes `label` for the label of one part, with no other piece')
            expect(message(() => bar.region({ label: 'zz' }))).toBe('segmentedBar: region: no part "zz". The parts are "a", "b"')
            expect(message(() => two({ labels: false }).region({ label: 'a' }))).toBe('segmentedBar: region: the bar draws no labels (labels: false), so the label of "a" has no place. Use { part: "a" } for the box of the part')
        }))
    })

    it('reads its state: the names, the count, the total, the free room, the amount over, and the parts that a function picks', async () => {
        await compileFilm(film(() => {
            const bar = segmentedBar([{ name: 'system', value: 1200 }, { name: 'tools', value: 2400 }, { name: 'trace', value: 8200 }], { capacity: 16000 })
            expect(bar.names).toEqual(['system', 'tools', 'trace'])
            expect([bar.count, bar.total, bar.free, bar.over]).toEqual([3, 11800, 4200, 0])
            expect(bar.amount('tools')).toBe(2400)
            expect([bar.has('trace'), bar.has('zz')]).toEqual([true, false])
            expect(bar.find((part) => part.share > 0.2)).toEqual(['tools', 'trace'])
            // The function gets each part with its two ends and its index, from the left.
            const seen: unknown[] = []
            bar.find((part) => { seen.push([part.name, part.value, part.from, part.to, part.index]); return false })
            expect(seen).toEqual([['system', 1200, 0, 1200, 0], ['tools', 2400, 1200, 3600, 1], ['trace', 8200, 3600, 11800, 2]])
            expect(bar.find((part) => part.from <= 3000 && 3000 < part.to)).toEqual(['tools'])
            // A bar that holds more than its capacity is over, and has no free room.
            const full = segmentedBar([{ name: 'cache', value: 30 }], { capacity: 24, max: 34 })
            expect([full.over, full.free]).toEqual([6, 0])
            // In floating point, these two amounts add up to a little less than 0.8. The bar is full, with no free room.
            expect(0.7 + 0.1).toBeLessThan(0.8)
            expect(segmentedBar([{ name: 'p', value: 0.7 }, { name: 'q', value: 0.1 }], { capacity: 0.8 }).free).toBe(0)
            expect(message(() => bar.amount('zz'))).toBe('segmentedBar: amount: no part "zz". The parts are "system", "tools", "trace"')
        }))
    })

    it('resizes a part in place: its box follows the amount, the parts at its right move, and the amounts count', async () => {
        let bar!: Bar
        await compile((s) => {
            bar = s.add(two())
            s.play(bar.resize('a', 4), { duration: 1, ease: linear })
            expect(bar.amount('a')).toBe(4)
            expect(bar.total).toBe(10)
            expect(bar.range('b')).toEqual([4, 10])
            // The places are read after the change: part b is from -100 to 500 now, and its label is under its middle.
            expect([bar.region({ part: 'b' }).left, bar.region({ part: 'b' }).right]).toEqual([-100, 500])
            expect(bar.region({ label: 'b' }).point('top')[0]).toBeCloseTo(200, 6)
            expect(bar.p('b')[0]).toBe(200)
        })
        const a = bar.part('a'), b = bar.part('b')
        // Half way, part a holds 3 units: it ends at -200, and part b starts there and keeps its width of 600.
        expect(ends(a, 0.5)![1]).toBeCloseTo(-200 - SEAM / 2, 6)
        expect(ends(b, 0.5)![0]).toBeCloseTo(-200 + SEAM / 2, 6)
        expect(ends(b, 0.5)![1]).toBeCloseTo(400 - SEAM / 2, 6)
        expect(ends(a, 1)![1]).toBeCloseTo(-100 - SEAM / 2, 6)
        expect(ends(b, 1)![1]).toBeCloseTo(500 - SEAM / 2, 6)
        // The amount under the part and the total over the bar count with it.
        expect([label(a, 0)!.amount, label(a, 0.5)!.amount, label(a, 1)!.amount]).toEqual(['2', '3', '4'])
        expect([readout(bar, 0).source, readout(bar, 0.5).source, readout(bar, 1).source]).toEqual(['8 / 10', '9 / 10', '10 / 10'])
    })

    it('resizes several parts at one time, and a second change in a sequence starts from the first', async () => {
        let bar!: Bar
        const compiled = await compile((s) => {
            bar = s.add(two())
            s.play(bar.resize({ a: 1, b: 9 }), { duration: 1, ease: linear })
            expect([bar.amount('a'), bar.amount('b')]).toEqual([1, 9])
            s.play(seq(bar.resize('a', 3, { duration: 1 }), bar.resize('a', 0, { duration: 1 })), bar.resize('b', 4, { duration: 2 }), { ease: linear })
            expect([bar.amount('a'), bar.amount('b'), bar.total]).toEqual([0, 4, 4])
        })
        // Half way through the first change, part a holds 1.5 and part b holds 7.5.
        expect(ends(bar.part('a'), 0.5)![1]).toBeCloseTo(-350 - SEAM / 2, 6)
        expect(ends(bar.part('b'), 0.5)![1]).toBeCloseTo(400 - SEAM / 2, 6)
        // From 1 to 2 part a grows to 3, and from 2 to 3 it shrinks to nothing. Part b shrinks over the two seconds.
        expect(ends(bar.part('a'), 2)![1]).toBeCloseTo(-200 - SEAM / 2, 6)
        expect(ends(bar.part('a'), 2.5)![1]).toBeCloseTo(-350 - SEAM / 2, 6)
        expect(ends(bar.part('b'), 2.5)).toEqual([expect.closeTo(-350 + SEAM / 2, 6), expect.closeTo(-350 + 525 - SEAM / 2, 6)])
        expect(ends(bar.part('a'), 3)).toBeNull()
        // A part of no amount keeps its label: it is still a part of the bar.
        expect(label(bar.part('a'), 3)).toMatchObject({ name: 'a', amount: '0', opacity: 1 })
        // A frame is a function of its time: the bar draws the same picture in any order of the frames.
        expectPure(compiled, [0.2, 0.5, 1.4, 2.5, 3])
    })

    it('brings a part with insert: it grows from nothing at its place, and its label comes early with its name', async () => {
        let bar!: Bar, orange!: Rgba
        await compile((s) => {
            orange = parseColor('orange')
            bar = s.add(two())
            s.play(bar.insert({ name: 'new', value: 2, color: 'orange' }, { before: 'b' }), { duration: 1, ease: linear })
            expect(bar.names).toEqual(['a', 'new', 'b'])
            expect([bar.amount('new'), bar.total, bar.free]).toEqual([2, 10, 0])
            // Without `before`, a part goes to the right end.
            s.play(bar.insert({ name: 'last', value: 0 }), { duration: 0.5 })
            expect(bar.names).toEqual(['a', 'new', 'b', 'last'])
        })
        // A part with no color takes the next color of the list: the fourth part is purple, and the line to its label shows it.
        expect(label(bar.part('last'), 1.5)!.leader.stroke).toEqual(parseColor('purple'))
        const added = bar.part('new')
        expect(ends(added, 0)).toBeNull()
        // Half way it holds 1 unit, between part a and part b, and part b starts where it ends.
        expect(ends(added, 0.5)).toEqual([expect.closeTo(-300 + SEAM / 2, 6), expect.closeTo(-200 - SEAM / 2, 6)])
        expect(ends(bar.part('b'), 0.5)![0]).toBeCloseTo(-200 + SEAM / 2, 6)
        expect(ends(added, 1)).toEqual([expect.closeTo(-300 + SEAM / 2, 6), expect.closeTo(-100 - SEAM / 2, 6)])
        expect(at(1, () => added.children[0]!.draw!(1) as Node).get('fill')).toEqual(orange)
        // The room of the label opens in the first four tenths of the time, and the label shows at the end of that.
        expect(label(added, 0.1)).toBeNull()
        expect(label(added, 0.5)).toMatchObject({ name: 'new', amount: '1', opacity: 1 })
        expect(label(added, 1)).toMatchObject({ name: 'new', amount: '2', opacity: 1 })
    })

    it('takes parts out with remove: a box shrinks to nothing, the rest close the room, and the name stays while it shrinks', async () => {
        let bar!: Bar, a!: Node, c!: Node
        await compile((s) => {
            bar = s.add(segmentedBar([{ name: 'a', value: 2 }, { name: 'b', value: 6 }, { name: 'c', value: 1 }], { capacity: 10, width: 1000 }))
            a = bar.part('a')
            c = bar.part('c')
            s.play(bar.remove('a'), { duration: 1, ease: linear })
            expect(bar.names).toEqual(['b', 'c'])
            expect([bar.total, bar.free, bar.has('a')]).toEqual([7, 3, false])
            expect(message(() => bar.part('a'))).toBe('segmentedBar: part: no part "a". The parts are "b", "c"')
            // A list takes several parts out at one time.
            s.play(bar.remove(['b', 'c']), { duration: 1, ease: linear })
            expect([bar.count, bar.total, bar.free]).toEqual([0, 0, 10])
        })
        expect(ends(a, 0.5)).toEqual([expect.closeTo(-500 + SEAM / 2, 6), expect.closeTo(-400 - SEAM / 2, 6)])
        expect(ends(a, 1)).toBeNull()
        // Part c was at 800 to 900 of the 1000 px. It moves left by the room of part a.
        expect(ends(c, 0)![0]).toBeCloseTo(300 + SEAM / 2, 6)
        expect(ends(c, 0.5)![0]).toBeCloseTo(200 + SEAM / 2, 6)
        expect(ends(c, 1)![0]).toBeCloseTo(100 + SEAM / 2, 6)
        expect(label(a, 0.5)).toMatchObject({ name: 'a', amount: '1', opacity: 1 })
        expect(label(a, 1)).toBeNull()
        expect(ends(c, 2)).toBeNull()
        expect(label(c, 2)).toBeNull()
    })

    it('cuts parts and gives their room to the rest in proportion, so the total stays: first the cut parts go, and then the rest grow', async () => {
        let bar!: Bar, rename!: Node
        await compile((s) => {
            bar = s.add(shares())
            rename = bar.part('rename')
            // Top-k with k = 2: the parts after the second one.
            s.play(bar.cut(bar.find((part) => part.index >= 2)), { duration: 1, ease: linear })
            expect(bar.names).toEqual(['create', 'revoke'])
            expect(bar.amount('create')).toBeCloseTo(2 / 3, 12)
            expect(bar.amount('revoke')).toBeCloseTo(1 / 3, 12)
            expect(bar.total).toBeCloseTo(1, 12)
        })
        const create = bar.part('create'), revoke = bar.part('revoke')
        // The cut parts shrink in the first 0.45 of the time, and the parts that stay do not change yet.
        expect(ends(rename, 0.225)![1] - ends(rename, 0.225)![0]).toBeCloseTo(75 - SEAM, 6)
        expect(ends(create, 0.45)![1]).toBeCloseTo(0 - SEAM / 2, 6)
        expect(ends(revoke, 0.45)![1]).toBeCloseTo(250 - SEAM / 2, 6)
        expect(ends(rename, 0.45)).toBeNull()
        // Then the two that stay grow by one factor, to the whole bar.
        expect(ends(create, 1)![1]).toBeCloseTo(-500 + 2000 / 3 - SEAM / 2, 6)
        expect(ends(revoke, 1)![1]).toBeCloseTo(500 - SEAM / 2, 6)
        // A cut that leaves no part has nothing to give the room to.
        await expect(compile((s) => { s.play(s.add(two()).cut(['a', 'b'])) })).rejects.toThrow('segmentedBar: cut: no part stays, so nothing can take the room of the parts that go. Use remove() to take parts out and leave their room free')
    })

    it('sends a part to another bar: it leaves, travels as one box, and lands at its place to the scale of the other bar', async () => {
        let from!: Bar, to!: Bar, teal!: Rgba, y!: Node
        const compiled = await compile((s) => {
            teal = parseColor('teal')
            from = s.add(segmentedBar([{ name: 'x', value: 2 }, { name: 'y', value: 4 }], { capacity: 10, width: 1000 }).at(0, -200))
            to = s.add(segmentedBar([{ name: 'z', value: 5 }], { capacity: 20, width: 1000 }).at(0, 200))
            y = from.part('y')
            s.play(from.send('y', to), { duration: 1, ease: linear })
            expect([from.names, to.names]).toEqual([['x'], ['z', 'y']])
            expect([from.total, to.total, to.amount('y'), from.has('y')]).toEqual([2, 9, 4, false])
            s.wait(0.5)
        })
        // One box has the color of the part at each time: in the first bar, on its way, and in the second bar.
        const boxes = [0, 0.5, 0.999, 1.2].map((t) => filled(compiled, t, teal))
        expect(boxes.map((list) => list.length)).toEqual([1, 1, 1, 1])
        const [start, middle, near, end] = boxes.map((list) => list[0]!)
        // The canvas has the stage point 0, 0 at 960, 540. In the first bar the part is 400 wide, from -300 to 100.
        expect([start!.x, start!.x + start!.width, start!.y + start!.height / 2]).toEqual([expect.closeTo(960 - 300 + SEAM / 2, 6), expect.closeTo(960 + 100 - SEAM / 2, 6), expect.closeTo(540 - 200, 6)])
        // In the second bar one unit is 50 px, so the part is 200 wide, after part z: from -250 to -50.
        expect([end!.x, end!.x + end!.width, end!.y + end!.height / 2]).toEqual([expect.closeTo(960 - 250 + SEAM / 2, 6), expect.closeTo(960 - 50 - SEAM / 2, 6), expect.closeTo(540 + 200, 6)])
        // Half way, the box is half way between the two places, and it has a width between the two.
        expect([middle!.x, middle!.x + middle!.width, middle!.y + middle!.height / 2]).toEqual([expect.closeTo(960 - 275 + SEAM / 2, 6), expect.closeTo(960 + 25 - SEAM / 2, 6), expect.closeTo(540, 6)])
        // It lands on the place of the part, so the picture does not jump when the box of the part takes its place.
        expect(Math.abs(near!.x - end!.x)).toBeLessThan(0.2)
        expect(Math.abs(near!.y - end!.y)).toBeLessThan(0.5)
        // The first bar closes the room, and the second bar has the part with its label.
        expect(ends(y, 1)).toBeNull()
        expect(label(y, 1)).toBeNull()
        expect(label(to.part('y'), 1.2)).toMatchObject({ name: 'y', amount: '4', opacity: 1 })
        expect([readout(from, 1.2).source, readout(to, 1.2).source]).toEqual(['2 / 10', '9 / 20'])
        // `before` names the part of the other bar that the part goes in front of.
        await compile((s) => {
            const first = s.add(two().at(0, -200)), second = s.add(segmentedBar([{ name: 'z', value: 5 }], { capacity: 20, width: 1000 }).at(0, 200))
            s.play(first.send('b', second, { before: 'z' }))
            expect(second.names).toEqual(['b', 'z'])
            expect(second.range('z')).toEqual([6, 11])
        })
        // The place where the box lands follows the other bar: part z shrinks to 1 unit while the box is on its way.
        const moving = await compile((s) => {
            const first = s.add(segmentedBar([{ name: 'x', value: 2 }, { name: 'y', value: 4 }], { capacity: 10, width: 1000 }).at(0, -200))
            const second = s.add(segmentedBar([{ name: 'z', value: 5 }], { capacity: 20, width: 1000 }).at(0, 200))
            s.play(first.send('y', second), second.resize('z', 1), { duration: 1, ease: linear })
            s.wait(0.5)
        })
        const [landing, landed] = [0.999, 1.2].map((t) => filled(moving, t, teal)[0]!)
        expect(landed!.x).toBeCloseTo(960 - 450 + SEAM / 2, 6)
        expect(Math.abs(landing!.x - landed!.x)).toBeLessThan(0.5)
    })

    it('shows the amount over the capacity at the right of the frame, in red with a hatch, and says it in the readout', async () => {
        let bar!: Bar, red!: Rgba, backdrop!: Rgba
        const compiled = await compile((s) => {
            red = parseColor('red')
            backdrop = parseColor('bg')
            // One unit is 30 px, the left end is at -510, and the line of the capacity is at 210.
            bar = s.add(segmentedBar([{ name: 'weights', value: 8 }, { name: 'cache', value: 4 }], { capacity: 24, max: 34, width: 1020, format: (value) => `${value.toFixed(1)} GB` }))
            s.play(bar.resize('cache', 24), { duration: 1, ease: linear })
            expect([bar.total, bar.over, bar.free]).toEqual([32, 8, 0])
        })
        expect(filled(compiled, 0, red)).toEqual([])
        expect(readout(bar, 0).source).toBe('12.0 GB / 24.0 GB')
        // At 0.5 the cache holds 14 and the total is 22: under the capacity.
        expect(filled(compiled, 0.5, red)).toEqual([])
        // At 0.8 the cache holds 20 and the total is 28: 4 over, which is 120 px from the line on.
        const marks = filled(compiled, 0.8, red)
        expect(marks).toHaveLength(1)
        expect(marks[0]!.x).toBeCloseTo(960 + 210, 6)
        expect(marks[0]!.x + marks[0]!.width).toBeCloseTo(960 + 330 - SEAM / 2, 6)
        // The hatch is the second sign beside the color: lines in the background color, inside the red box.
        const lines = paths(compiled, 0.8).filter((op) => op.fill === null && same(op.stroke, backdrop))
        expect(lines).toHaveLength(1)
        const hatch = pathBounds(lines[0]!.path)!
        expect(hatch.x).toBeGreaterThanOrEqual(marks[0]!.x - 1e-6)
        expect(hatch.x + hatch.width).toBeLessThanOrEqual(marks[0]!.x + marks[0]!.width + 1e-6)
        expect(lines[0]!.path.length).toBeGreaterThan(5)
        // The readout says the amount, with the word, in red.
        expect(readout(bar, 0.8).source).toBe('28.0 GB / 24.0 GB  over 4.0 GB')
        expect(readout(bar, 0.8).children[0]!.get('fill')).toEqual(red)
        expect(readout(bar, 0.5).children[0]!.get('fill')).toEqual(parseColor('ink'))
        expect(readout(bar, 1).source).toBe('32.0 GB / 24.0 GB  over 8.0 GB')
        await compileFilm(film(() => {
            // `over` sets the word.
            expect(readout(segmentedBar([{ name: 'a', value: 8 }], { capacity: 5, max: 10, over: 'too much' }), 0).source).toBe('8 / 5  too much 3')
            // An amount over the capacity that the format writes as 0 is not said.
            expect(readout(segmentedBar([{ name: 'a', value: 8.3 }], { capacity: 8, max: 10, format: (value) => String(Math.round(value)) }), 0).source).toBe('8 / 8')
        }))
    })

    it('keeps the room between two parts that are over the capacity, and does not call a sum with a rounding error over', async () => {
        let red!: Rgba
        const compiled = await compile((s) => {
            red = parseColor('red')
            // The line of the capacity is at 0. Part b is over from the line on, and part c is over as a whole.
            s.add(segmentedBar([{ name: 'a', value: 4 }, { name: 'b', value: 2 }, { name: 'c', value: 2 }], { capacity: 5, max: 10, width: 1000, over: 'too much' }))
            // In floating point, these three shares add up to a little more than 1.
            expect(0.34 + 0.56 + 0.1).toBeGreaterThan(1)
            const whole = s.add(segmentedBar([{ name: 'p', value: 0.34 }, { name: 'q', value: 0.56 }, { name: 'r', value: 0.1 }], { capacity: 1, width: 1000 }).at(0, 300))
            expect(whole.over).toBe(0)
            expect(readout(whole, 0).source).toBe('1.00 / 1.00')
            s.wait(1)
        })
        const marks = filled(compiled, 0.5, red)
        expect(marks.map((box) => [box.x - 960, box.x + box.width - 960])).toEqual([
            [expect.closeTo(0, 6), expect.closeTo(100 - SEAM / 2, 6)],
            [expect.closeTo(100 + SEAM / 2, 6), expect.closeTo(300 - SEAM / 2, 6)],
        ])
    })

    it('draws the amount over the capacity as a piece of the box of its part, so a light on the part keeps its mark bright', async () => {
        let bar!: Bar, red!: Rgba
        const compiled = await compile((s) => {
            red = parseColor('red')
            // The line of the capacity is at 0. Part b is over from the line on, and part c is over as a whole.
            bar = s.add(segmentedBar([{ name: 'a', value: 4 }, { name: 'b', value: 2 }, { name: 'c', value: 2 }], { capacity: 5, max: 10, width: 1000 }))
            s.play(spotlight(bar.part('c'), { within: bar, dim: 0.2 }), { duration: 0.5 })
            s.wait(0.5)
        })
        const marks = (t: number) => paths(compiled, t).filter((op) => same(op.fill, red) && op.node?.data['key'] === undefined).map((op) => op.node!.drawer)
        // Each red mark is drawn by the box of its part, so it is in the node that `part()` gives.
        expect(marks(0)).toEqual([bar.part('b').children[0], bar.part('c').children[0]])
        // With the light on part c, its mark keeps its red, and the mark of part b goes toward the background.
        expect(marks(0.9)).toEqual([bar.part('c').children[0]])
    })

    it('has no limit without a capacity: with a max, the frame goes to the right end, and a part that grows is not over', async () => {
        let bar!: Bar, red!: Rgba
        const compiled = await compile((s) => {
            red = parseColor('red')
            bar = s.add(segmentedBar([{ name: 'input', value: 2 }, { name: 'output', value: 1 }], { max: 10, width: 1000, readout: true }))
            expect([bar.capacity, bar.max, bar.limit]).toEqual([10, 10, null])
            // One unit is 100 px, and the frame holds the room that the parts can grow to.
            expect(bar.frame.bounds().width).toBeCloseTo(1000, 6)
            expect(ends(bar.part('output'), 0)![1]).toBeCloseTo(-200 - SEAM / 2, 6)
            s.play(bar.resize('output', 7), { duration: 1, ease: linear })
            expect([bar.total, bar.over, bar.free]).toEqual([9, 0, 1])
        })
        expect(ends(bar.part('output'), 1)![1]).toBeCloseTo(400 - SEAM / 2, 6)
        expect(filled(compiled, 1, red)).toEqual([])
        // The readout of a bar with no capacity is the total alone, and it does not turn red.
        expect(readout(bar, 1).source).toBe('9')
        expect(readout(bar, 1).children[0]!.get('fill')).toEqual(parseColor('ink'))
    })

    it('names the free room and counts it, and takes its label away when no room is left', async () => {
        let bar!: Bar
        await compile((s) => {
            bar = s.add(two({ free: 'free' }))
            s.play(bar.resize('b', 8), { duration: 1, ease: linear })
            expect(bar.free).toBe(0)
        })
        // The free room is from 300 to 500, and its label is under its middle.
        expect(rest(bar, 0)).toMatchObject({ name: 'free', amount: '2', opacity: 1 })
        expect(rest(bar, 0)!.x).toBeCloseTo(400, 6)
        expect(rest(bar, 0.5)).toMatchObject({ amount: '1' })
        expect(rest(bar, 0.5)!.x).toBeCloseTo(450, 6)
        expect(rest(bar, 1)).toBeNull()
        // A bar with no name for the free room draws no label for it.
        await compileFilm(film(() => { expect((two() as unknown as { rest: Node | null }).rest).toBeNull() }))
    })

    it('keeps the labels of narrow parts apart, in the order of the parts, and inside the width of the bar', async () => {
        await compileFilm(film(() => {
            const bar = segmentedBar(crowded, { capacity: 32, width: 1400, free: 'free' })
            const labels = [...bar.names.map((name) => label(bar.part(name), 0)!), rest(bar, 0)!]
            expect(labels.map((own) => own.name)).toEqual([...crowded.map((part) => part.name), 'free'])
            // Each label has the room that a text needs to the next one, 0.3 of the text size, and more.
            labels.slice(1).forEach((own, index) => expect(own.left - labels[index]!.right).toBeGreaterThan(28 * 0.3))
            expect(labels[0]!.left).toBeGreaterThanOrEqual(-700)
            expect(labels[labels.length - 1]!.right).toBeLessThanOrEqual(700)
            // The three narrow parts at the left are 43.75 px each: their labels cannot all be under their middles.
            const middle = (name: string) => (bar.x(bar.range(name)[0]) + bar.x(bar.range(name)[1])) / 2
            expect(label(bar.part('retrieved passages'), 0)!.x).toBeGreaterThan(middle('retrieved passages') + 100)
            // A label with room is under the middle of its part.
            const wide = segmentedBar([{ name: 'a', value: 5 }, { name: 'b', value: 5 }], { width: 1000 })
            expect([label(wide.part('a'), 0)!.x, label(wide.part('b'), 0)!.x]).toEqual([-250, 250])
        }))
    })

    it('writes the name over the amount under the bar, and joins each label to its part with a line', async () => {
        await compileFilm(film(() => {
            const bar = segmentedBar(crowded, { capacity: 32, width: 1400, free: 'free' })
            // The bar is 67 high, and its border is 2.24 wide. The line goes from the border to 1.4 text sizes under the bar.
            const reserve = label(bar.part('answer reserve'), 0)!
            expect(reserve.leader.top).toBeCloseTo(33.5 + 1.12, 6)
            expect(reserve.leader.bottom).toBeCloseTo(33.5 + 28 * 1.4, 6)
            // The name is under the line, and the amount is one line of text under the name.
            expect(reserve.y[0]!).toBeGreaterThan(reserve.leader.bottom)
            expect(reserve.y[1]! - reserve.y[0]!).toBeCloseTo(28 * 1.25, 6)
            // A label whose middle is under its part has a straight line.
            expect([reserve.leader.left, reserve.leader.right]).toEqual([expect.closeTo(reserve.x, 6), expect.closeTo(reserve.x, 6)])
            // A label that the others pushed away has a line that starts inside its part and ends over the middle of the label.
            const pushed = label(bar.part('retrieved passages'), 0)!
            const [from, to] = bar.range('retrieved passages').map((value) => bar.x(value)) as [number, number]
            expect(pushed.leader.left).toBeGreaterThan(from)
            expect(pushed.leader.left).toBeLessThan(to)
            expect(pushed.leader.right).toBeCloseTo(pushed.x, 6)
        }))
    })

    it('writes its names, its amounts, its title and its readout at 28 px by default, in the font of the film and in mono', async () => {
        await compile(() => {
            const bar = two({ title: 'window', free: 'free' })
            const part = label(bar.part('a'), 0)!
            expect(part.sizes).toEqual([28, 28])
            expect(part.fonts).toEqual(['text-serif', 'mono'])
            expect(rest(bar, 0)!.sizes).toEqual([28, 28])
            expect([(bar.title as TextNode).size, (bar.title as TextNode).font, (bar.title as TextNode).source]).toEqual([28, 'text-serif', 'window'])
            expect([readout(bar, 0).size, readout(bar, 0).font]).toEqual([28, 'mono'])
            // `size` sets all of them, and `font` names the font of the names when it is not the font of the film.
            const large = two({ size: 40, font: 'sans' })
            expect(label(large.part('a'), 0)!.sizes).toEqual([40, 40])
            expect(label(large.part('a'), 0)!.fonts).toEqual(['sans', 'mono'])
            expect(large.frame.bounds().height).toBe(96)
        }, { font: 'text-serif' })
    })

    it('writes an amount with the decimals of its values and with commas, or with the format of the film', async () => {
        await compileFilm(film(() => {
            const tokens = segmentedBar([{ name: 'history', value: 8200 }], { capacity: 16000 })
            expect(label(tokens.part('history'), 0)!.amount).toBe('8,200')
            expect(readout(tokens, 0).source).toBe('8,200 / 16,000')
            // One value with one decimal gives every amount one decimal, so a count that runs keeps its width.
            const memory = segmentedBar([{ name: 'weights', value: 7.6 }, { name: 'workspace', value: 2 }], { capacity: 24 })
            expect(label(memory.part('workspace'), 0)!.amount).toBe('2.0')
            expect(readout(memory, 0).source).toBe('9.6 / 24.0')
            const percent = segmentedBar([{ name: 'birds', value: 0.62 }, { name: 'sing', value: 0.38 }], { format: (share) => `${Math.round(share * 100)}%`, readout: true })
            expect(label(percent.part('birds'), 0)!.amount).toBe('62%')
            // Without a capacity the readout is the total alone, and a bar draws one only when the film asks for it.
            expect(readout(percent, 0).source).toBe('100%')
            expect(shares().readout).toBeNull()
            expect(two({ readout: false }).readout).toBeNull()
            // A format that writes more than the widest amount of the bar gets a smaller text, in the label and in the readout.
            const wordy = segmentedBar([{ name: 'a', value: 2 }], { capacity: 10, width: 400, title: 'window', format: (value) => (value === 2 ? 'two units of the whole' : String(value)) })
            expect(label(wordy.part('a'), 0)!.sizes).toEqual([28, expect.any(Number)])
            expect(label(wordy.part('a'), 0)!.sizes[1]!).toBeLessThan(10)
            expect(readout(wordy, 0).source).toBe('two units of the whole / 10')
            expect(readout(wordy, 0).size).toBeLessThan(28)
        }))
    })

    it('measures as the room that it can take at any time, so the layout gives an empty bar the place of a full one', async () => {
        await compileFilm(film(() => {
            const empty = boxOf(segmentedBar([], { capacity: 10, width: 1000 })), full = boxOf(two())
            expect([empty.left, empty.right, empty.top, empty.bottom]).toEqual([full.left, full.right, full.top, full.bottom])
            // The measure is the width of the bar and the two halves of its border.
            expect(full.width).toBeCloseTo(1000 + 2.24, 6)
            // The labels of the parts are a part of the measure, and so is the row of the readout.
            expect(full.bottom).toBeGreaterThan(33.5 + 28 * 2)
            expect(full.top).toBeLessThan(-33.5 - 28)
            const bare = boxOf(two({ labels: false, readout: false }))
            expect([bare.top, bare.bottom]).toEqual([expect.closeTo(-33.5 - 7, 6), expect.closeTo(33.5 + 7, 6)])
            // `fitted` builds a bar whose measure is as wide as a region.
            const made = fitted(800, (width) => two({ width }))
            expect(boxOf(made).width).toBeCloseTo(800, 6)
            // No label and no box leaves the measure, also for a bar that is over its capacity with ten parts.
            const many = segmentedBar(Array.from({ length: 10 }, (_, index) => ({ name: `request ${index + 1}`, value: index === 9 ? 6 : 3 })), { capacity: 24, max: 33, width: 1700, free: 'free', title: 'pool' })
            const ink = at(0, () => many.bounds()), measure = boxOf(many)
            expect(ink.x).toBeGreaterThanOrEqual(measure.left)
            expect(ink.x + ink.width).toBeLessThanOrEqual(measure.right)
            expect(ink.y).toBeGreaterThanOrEqual(measure.top)
            expect(ink.y + ink.height).toBeLessThanOrEqual(measure.bottom)
        }))
    })

    it('enters with its frame first, and then its parts grow from the left, one after another, while the total counts up', async () => {
        let bar!: Bar
        await compile((s) => {
            bar = two()
            // The animation brings the bar to the stage.
            s.play(bar.enter(), { duration: 1, ease: linear })
            expect(bar.mounted).toBe(true)
            expect(bar.total).toBe(8)
        })
        const a = bar.part('a'), b = bar.part('b')
        expect([ends(a, 0), ends(b, 0)]).toEqual([null, null])
        expect(readout(bar, 0).source).toBe('0 / 10')
        expect(at(0, () => bar.frame.get('opacity'))).toBe(0)
        expect(at(0.3, () => bar.frame.get('opacity'))).toBeCloseTo(1, 6)
        // Part a grows from 0.15 on, and part b starts later.
        expect(ends(a, 0.3)).not.toBeNull()
        expect(ends(b, 0.3)).toBeNull()
        expect(ends(a, 1)![1]).toBeCloseTo(-300 - SEAM / 2, 6)
        expect(ends(b, 1)![1]).toBeCloseTo(300 - SEAM / 2, 6)
        expect(label(a, 1)).toMatchObject({ name: 'a', amount: '2', opacity: 1 })
        expect(readout(bar, 1).source).toBe('8 / 10')
    })

    it('lays the parts out from all their changes, when changes of two parts overlap in time', async () => {
        let bar!: Bar
        await compile((s) => {
            bar = s.add(two())
            // Part a grows from 0 to 1 s, and part b shrinks from 0.5 to 1 s.
            s.play(bar.resize('a', 4, { duration: 1, ease: linear }), delay(bar.resize('b', 2, { duration: 0.5, ease: linear }), 0.5))
            expect(bar.total).toBe(6)
        })
        // At 0.75 part a holds 3.5 and part b holds 4.
        expect(ends(bar.part('a'), 0.75)![1]).toBeCloseTo(-150 - SEAM / 2, 6)
        expect(ends(bar.part('b'), 0.75)).toEqual([expect.closeTo(-150 + SEAM / 2, 6), expect.closeTo(250 - SEAM / 2, 6)])
        expect(readout(bar, 0.75).source).toBe('8 / 10')
    })

    it('refuses two changes of one part at one time, and says how to play them', async () => {
        await expect(compile((s) => {
            const bar = s.add(two())
            s.play(bar.resize('a', 1), bar.resize('a', 3), { duration: 1 })
        })).rejects.toThrow('segmentedBar: resize("a") plays from 0 s to 1 s, and resize("a") plays from 0 s to 1 s. Both change the part "a", and a part takes one change at a time. Play the two one after the other: in a seq(), or in two calls of s.play. For two new values of one part at one time, give resize() the last value')
        // A cut changes every part, so it cannot play with a change of a part that stays.
        await expect(compile((s) => {
            const bar = s.add(shares())
            s.play(bar.cut('quota'), bar.resize('create', 0.4), { duration: 1 })
        })).rejects.toThrow(/resize\("create"\) plays from 0 s to 1 s, and cut\(\) plays from 0 s to 1 s\. Both change the part "create"/)
        // A change that the film writes at an earlier time, after a later one, is named as that.
        await expect(compile((s) => {
            const bar = s.add(two())
            s.at(5, () => s.play(bar.resize('a', 1), { duration: 1 }))
            s.play(bar.resize('a', 3), { duration: 1 })
        })).rejects.toThrow(/The bar takes the changes of a part in the order of time, and the film calls resize\("a"\) first\. Call resize\("a"\) before it/)
        // An ease that passes its end gives a part no width under 0: the part is gone, and the next one starts at the left end.
        let bar!: Bar
        await compile((s) => {
            bar = s.add(two())
            s.play(bar.resize('a', 0), { duration: 1, ease: (share) => share * 1.5 })
        })
        expect(ends(bar.part('a'), 0.9)).toBeNull()
        expect(ends(bar.part('b'), 0.9)![0]).toBeCloseTo(-500 + SEAM / 2, 6)
    })

    it('preserves earlier frames when the film replays an insertion', async () => {
        let first!: Node, second!: Node
        await compile((s) => {
            const bar = s.add(two())
            const insert = bar.insert({ name: 'cache', value: 1 })
            s.play(insert, { duration: 1 })
            first = bar.part('cache')
            s.play(bar.remove('cache'), { duration: 1 })
            s.play(insert, { duration: 1 })
            second = bar.part('cache')
        })
        expect(label(first, 1)?.amount).toBe('1')
        expect(ends(first, 1)).toEqual(ends(second, 3))
        expect(ends(second, 1)).toBeNull()
    })

    it('resolves part names when each step of a sequence plays', async () => {
        await compile((s) => {
            const bar = s.add(two()), archive = s.add(segmentedBar([], { capacity: 10 }))
            s.play(seq(bar.remove('a'), bar.insert({ name: 'a', value: 3 })))
            s.play(seq(bar.send('a', archive), archive.send('a', bar, { before: 'b' })))
            expect(bar.names).toEqual(['a', 'b'])
            expect(bar.amount('a')).toBe(3)
            expect(archive.count).toBe(0)
        })
    })

    it('refuses a replacement while the previous part is leaving', async () => {
        await expect(compile((s) => {
            const bar = s.add(two())
            s.play(bar.remove('a'), bar.insert({ name: 'a', value: 1 }), { duration: 1 })
        })).rejects.toThrow(/previous.*ends at 1 s/)
    })

    it('knows in one sequence a part that an insert before it brings, and refuses a part that is not there', async () => {
        let bar!: Bar
        await compile((s) => {
            bar = s.add(two())
            s.play(seq(bar.insert({ name: 'n', value: 1 }), bar.resize('n', 2), bar.remove('a')))
            expect(bar.names).toEqual(['b', 'n'])
            expect(bar.amount('n')).toBe(2)
        })
        await compileFilm(film((s) => {
            const made = two()
            expect(message(() => s.play(made.resize('zz', 1)))).toBe('segmentedBar: resize: no part "zz". The parts are "a", "b"')
            expect(message(() => made.resize('a', -1))).toBe('segmentedBar: resize: the new value of "a" is -1. An amount is a number, 0 or more')
            expect(message(() => made.resize('a', '3' as never))).toMatch(/the new value of "a" is "3"\. An amount is a number/)
            expect(message(() => made.resize({}))).toMatch(/resize got no part/)
            expect(message(() => made.resize(['a'] as never))).toMatch(/resize takes the name of a part and its new value, or an object of names and values/)
            expect(message(() => s.play(made.remove('zz')))).toBe('segmentedBar: remove: no part "zz". The parts are "a", "b"')
            expect(message(() => made.remove([]))).toMatch(/remove takes the name of a part, or a list of names with one name at least/)
            expect(message(() => s.play(made.cut('zz')))).toMatch(/cut: no part "zz"/)
            expect(message(() => s.play(made.insert({ name: 'a', value: 1 })))).toBe('segmentedBar: insert: the bar has a part "a" already. A name is the identity of a part: give the part that arrives another name, or change the part with resize()')
            expect(message(() => s.play(made.insert({ name: 'c', value: 1 }, { before: 'zz' })))).toMatch(/insert: no part "zz"/)
            expect(message(() => made.insert({ name: '', value: 1 }))).toMatch(/insert: the part has no name/)
            expect(message(() => made.insert({ name: 'c', value: 1, color: 'no-color' }))).toMatch(/the color of "c" is "no-color", which is not a color/)
            expect(message(() => made.send('a', made))).toBe('segmentedBar: send: the part is in this bar already. Give the other bar')
            expect(message(() => made.send('a', {} as never))).toMatch(/send: the second argument is the bar that takes the part/)
            expect(message(() => s.play(made.send('a', two())))).toMatch(/send: the bar has a part "a" already/)
            expect(message(() => made.find('a' as never))).toMatch(/find takes a function of a part/)
        }))
        // A film that plays one insert two times would bring two parts of one name.
        await expect(compile((s) => {
            const made = s.add(two())
            const arrive = made.insert({ name: 'c', value: 1 })
            s.play(arrive)
            s.play(arrive)
        })).rejects.toThrow(/insert: the bar has a part "c" already/)
    })

    it('checks for overflow on the frames of a spring animation', async () => {
        await expect(compile((s) => {
            const bar = s.add(segmentedBar([{ name: 'cache', value: 0 }], { capacity: 10 }))
            s.play(bar.resize('cache', 9), { duration: 1, ease: spring({ frequency: 8 }) })
        }, { fps: 30 })).rejects.toThrow(/add up to .* and the bar ends at 10/)
    })

    it('refuses parts that add up to more than the bar holds, and says which max has room for them', async () => {
        await compileFilm(film(() => {
            expect(message(() => segmentedBar([{ name: 'a', value: 8 }, { name: 'b', value: 4 }], { capacity: 10 }))).toBe('segmentedBar: the parts "a", "b" add up to 12, and the bar ends at 10. Give the bar max: 12 or more: the amount over the capacity of 10 then has room at the right of the frame')
            expect(() => segmentedBar([{ name: 'a', value: 8 }, { name: 'b', value: 4 }], { capacity: 10, max: 12 })).not.toThrow()
        }))
        // The bar looks at the whole film when it is built. The message has the largest sum, its parts, and the time of it.
        await expect(compile((s) => { s.play(s.add(two()).resize('b', 12)) })).rejects.toThrow(/the parts "a", "b" add up to 14 at 0\.9 s, and the bar ends at 10\. Give the bar max: 14 or more/)
        await expect(compile((s) => { s.play(s.add(two()).insert({ name: 'c', value: 3 })) })).rejects.toThrow(/the parts "a", "b", "c" add up to 11 at 0\.8 s, and the bar ends at 10\. Give the bar max: 11 or more/)
        // A part that arrives before another one leaves passes the end for a moment.
        await expect(compile((s) => {
            const bar = s.add(two())
            s.play(bar.insert({ name: 'c', value: 4 }, { duration: 0.5 }), delay(bar.remove('a', { duration: 0.5 }), 0.5))
        })).rejects.toThrow(/the parts "a", "b", "c" add up to 12 at 0\.5 s, and the bar ends at 10/)
        // With two eases, the sum passes the end between the starts and the ends of the two changes, and is under it at each of them.
        await expect(compile((s) => {
            const bar = s.add(two())
            s.play(bar.insert({ name: 'c', value: 4 }, { ease: linear }), bar.remove('a', { ease: (share) => share ** 3 }), { duration: 1 })
        })).rejects.toThrow(/the parts "a", "b", "c" add up to 10\.\d+ at 0\.\d+ s, and the bar ends at 10/)
        // A part may arrive while another one leaves, in any order of the two calls: the sum is never over the end.
        let swapped!: Bar
        await compile((s) => {
            swapped = s.add(two())
            s.play(swapped.insert({ name: 'c', value: 4 }), swapped.remove('a'), swapped.resize('b', 5), { duration: 1, ease: linear })
            expect([swapped.names, swapped.total]).toEqual([['b', 'c'], 9])
        })
        expect(readout(swapped, 0.5).source).toBe('9 / 10')
        // A bar that takes a part from another bar must have room for it.
        await expect(compile((s) => {
            const bar = s.add(two()), small = s.add(segmentedBar([{ name: 'z', value: 3 }], { capacity: 4 }))
            s.play(bar.send('b', small))
        })).rejects.toThrow(/the parts "z", "b" add up to 9 at 0\.9 s, and the bar ends at 4/)
    })

    it('says what is wrong with a bar that it cannot build', async () => {
        await compileFilm(film(() => {
            expect(message(() => segmentedBar([{ name: 'a', value: 1 }, { name: 'a', value: 2 }]))).toBe('segmentedBar: two parts have the name "a". A name is the identity of a part: give each part its own name')
            expect(message(() => segmentedBar([{ name: 'a', value: -1 }]))).toBe('segmentedBar: the value of "a" is -1. An amount is a number, 0 or more')
            expect(message(() => segmentedBar([{ name: 'a', value: Number.NaN }]))).toMatch(/the value of "a" is NaN/)
            expect(message(() => segmentedBar([{ name: 'a\nb', value: 1 }]))).toMatch(/the name "a\\nb" has a line break\. A name is one line/)
            expect(message(() => segmentedBar([{ value: 1 } as never]))).toMatch(/part 0 has no name/)
            expect(message(() => segmentedBar('a' as never))).toMatch(/the first argument is the list of the parts/)
            expect(message(() => segmentedBar([]))).toBe('segmentedBar: the parts add up to 0, so the bar has no scale. Give a capacity, or a part with a value')
            expect(message(() => segmentedBar([{ name: 'a', value: 1 }], { capacity: 0 }))).toMatch(/capacity is 0\. Give the amount that the bar holds, more than 0/)
            expect(message(() => segmentedBar([{ name: 'a', value: 1 }], { capacity: 10, max: 5 }))).toMatch(/max is 5, and the capacity is 10/)
            expect(message(() => segmentedBar([{ name: 'a', value: 1 }], { max: -1 }))).toBe('segmentedBar: max is -1. Give the amount at the right end of the object, more than 0')
            // A format that gives a number is named, and does not stop the film with an error of the text.
            expect(message(() => two({ format: ((value: number) => value) as never }))).toBe('segmentedBar: format gave 10 for the amount 10. A format gives a text, such as (value) => `${value} GB`')
            expect(message(() => two({ format: 'GB' as never }))).toMatch(/format is a function that writes an amount/)
            expect(message(() => two({ width: 0 }))).toMatch(/width is the width of the bar, more than 0/)
            expect(message(() => two({ size: -2 }))).toMatch(/size is a text size, more than 0/)
            expect(message(() => two({ title: 'a\nb' }))).toMatch(/title is "a\\nb"\. Give one line of text/)
            // The labels stand in one row under the bar. The message gives a width that has room for them.
            const narrow = message(() => segmentedBar(crowded, { capacity: 32, width: 700, free: 'free' }))
            const need = Number(/Give a width of (\d+) or more/.exec(narrow)?.[1])
            expect(narrow).toMatch(/^segmentedBar: the labels of 6 parts and of the free room need \d+ px in one row, and the bar is 700 px wide\. Give a width of \d+ or more, a smaller size, shorter names, fewer parts, or labels: false$/)
            expect(() => segmentedBar(crowded, { capacity: 32, width: need, free: 'free' })).not.toThrow()
            expect(() => segmentedBar(crowded, { capacity: 32, width: need - 2, free: 'free' })).toThrow(/the labels of 6 parts/)
            expect(() => segmentedBar(crowded, { capacity: 32, width: 700, labels: false })).not.toThrow()
            // The title and the readout share the row over the frame.
            expect(message(() => two({ width: 300, readout: false, title: 'the context window of the run' }))).toMatch(/^segmentedBar: the title is \d+ px wide, and the bar is 300 px wide\. Give a shorter title, a larger width, or a smaller size$/)
            expect(message(() => two({ width: 300, title: 'the context window of the run' }))).toMatch(/the title and the readout need \d+ px over the bar, and the bar is 300 px wide up to its capacity\. Give a larger width, a smaller size, a shorter title, or readout: false/)
        }))
        // A part that arrives needs room for its label too.
        await expect(compile((s) => {
            const bar = s.add(segmentedBar(crowded.slice(0, 5), { capacity: 32, width: 960 }))
            s.play(bar.insert({ name: 'tool results of the run', value: 1 }))
        })).rejects.toThrow(/the labels of 6 parts need \d+ px in one row at 0\.32 s, and the bar is 960 px wide\. Give a width of \d+ or more, a smaller size, shorter names, fewer parts at one time, or labels: false/)
    })

    it('gives a copy its own parts, which do not follow the bar', async () => {
        let bar!: Bar, copy!: Bar
        await compile((s) => {
            bar = s.add(two())
            copy = s.add(bar.clone().at(0, 300))
            s.play(bar.resize('a', 4), { duration: 1, ease: linear })
            expect([bar.amount('a'), copy.amount('a')]).toEqual([4, 2])
            s.play(copy.remove('b'), { duration: 1, ease: linear })
            expect([bar.names, copy.names]).toEqual([['a', 'b'], ['a']])
        })
        expect(ends(bar.part('a'), 1)![1]).toBeCloseTo(-100 - SEAM / 2, 6)
        expect(ends(copy.part('a'), 1)![1]).toBeCloseTo(-300 - SEAM / 2, 6)
        expect(ends(bar.part('b'), 2)![1]).toBeCloseTo(500 - SEAM / 2, 6)
        expect([label(bar.part('a'), 2)!.amount, label(copy.part('a'), 2)!.amount]).toEqual(['4', '2'])
    })

    it('takes an independent snapshot of the current values and parts when cloning a group', async () => {
        let original!: Bar, copy!: Bar
        await compile((s) => {
            original = two()
            const parent = s.add(group(original))
            s.at(4, () => s.play(original.remove('b'), original.resize('a', 3), original.insert({ name: 'future', value: 0 })))
            copy = s.add(parent.clone().shift(0, 200)).children[0] as Bar
            expect(copy.names).toEqual(['a', 'b'])
            expect(copy.amount('a')).toBe(2)
            expect(copy.part('a')).not.toBe(original.part('a'))
            s.play(copy.resize('a', 4))
            const again = s.add(copy.clone())
            s.play(again.remove('b'))
            expect(again.names).toEqual(['a'])
            expect(copy.names).toEqual(['a', 'b'])
        })
        expect(original.names).toEqual(['a', 'future'])
        expect(original.amount('a')).toBe(3)
        expect(label(original.part('a'), 1)?.amount).toBe('2')
        expect(label(copy.part('a'), 5)?.amount).toBe('4')
    })

    it('freezes one travelling segment when its group is cloned during a send', async () => {
        let blue!: Rgba
        const compiled = await compile((s) => {
            blue = parseColor('blue')
            const options = { capacity: 10, width: 500, labels: false, readout: false }
            const source = segmentedBar([{ name: 'cache', value: 6, color: 'blue' }], options)
            const target = segmentedBar([], options)
            const bars = s.add(group(group(source).at(-400, 0).opacity(0.4), group(target).at(400, 0).opacity(0.8)).at(0, -300).opacity(0.5))
            s.play(source.send('cache', target), { duration: 1, ease: linear })
            s.at(0.5, () => {
                const snapshot = s.add(bars.clone().shift(0, 200))
                s.add(snapshot.clone().shift(0, 200))
                // An endpoint alone has no copy of the transfer between the two groups.
                s.add(source.clone(), target.clone())
            })
            s.add(bars.clone().shift(0, 600))
            s.wait(1)
        })
        const marks = (t: number) => paths(compiled, t).filter((op) => same(op.fill, blue) && op.fillAlpha > 0)
            .map((op) => ({ ...pathBounds(op.path)!, alpha: op.fillAlpha })).sort((a, b) => a.y - b.y)
        const middle = marks(0.5)
        expect(middle).toHaveLength(3)
        for (const [i, mark] of middle.entries()) {
            expect(mark).toEqual({ ...middle[0], y: expect.closeTo(middle[0]!.y + 200 * i, 6) })
        }
        const later = marks(1.5)
        expect(later).toHaveLength(4)
        expect(middle[0]!.alpha).toBeCloseTo((marks(0)[0]!.alpha + later[0]!.alpha) / 2)
        expect(later.slice(1, 3)).toEqual(middle.slice(1))
        expect(later[0]!.x).toBeGreaterThan(middle[0]!.x)
        expect(later[3]).toEqual({ ...later[0], y: expect.closeTo(later[0]!.y + 600, 6) })
        expect(marks(0.5)).toEqual(middle)
    })

    it('keeps the shape and opacity of a part at both ends of a rotated transfer', async () => {
        let teal!: Rgba
        const compiled = await compile((s) => {
            teal = parseColor('teal')
            const source = two(), target = segmentedBar([], { capacity: 20 })
            s.add(group(source.at(-200, 0), target.at(200, 0)).rotate(Math.PI / 4).opacity(0.4))
            const region = source.region({ part: 'b' })
            const corners = [-300, 300].flatMap((x) => [-33.5, 33.5].map((y) => source.toWorld(x, y)))
            expect(region.left).toBeCloseTo(Math.min(...corners.map(([x]) => x)))
            expect(region.right).toBeCloseTo(Math.max(...corners.map(([x]) => x)))
            s.wait(1)
            s.play(source.send('b', target), { duration: 1, ease: linear })
            s.wait(1)
        })
        const box = (t: number) => paths(compiled, t).find((op) => same(op.fill, teal) && op.node?.data['key'] === undefined)!
        for (const t of [1, 2]) {
            const previous = box(t - 1e-8), next = box(t)
            expect(next.fillAlpha).toBeCloseTo(previous.fillAlpha)
            const before = pathBounds(previous.path)!, after = pathBounds(next.path)!
            for (const key of ['x', 'y', 'width', 'height'] as const) expect(after[key]).toBeCloseTo(before[key], 3)
        }
        expect(box(1.5).fillAlpha).toBeCloseTo(box(0.9).fillAlpha)
    })

    it('places its own labels, so the film check reports nothing on a crowded bar while its parts change', async () => {
        const report = await checkFilm(film({ fps: 10 }, (s) => {
            const bar = s.add(segmentedBar(crowded, { capacity: 32, max: 40, width: 1700, free: 'free', title: 'context window' }).at(0, -200))
            const shelf = s.add(segmentedBar([{ name: 'old run', value: 6 }], { capacity: 40, width: 1700, free: 'free', title: 'archive' }).at(0, 250))
            s.play(bar.resize('task', 4), { duration: 1 })
            // A part that arrives has its label among the labels that push each other: with insert, and from another bar. The bar is then over its capacity.
            s.play(bar.insert({ name: 'notes', value: 3 }, { before: 'task' }), { duration: 1 })
            s.wait(1)
            s.play(shelf.send('old run', bar, { before: 'task' }), { duration: 1 })
            s.wait(1.5)
            // The box of a part on its way is over the title of the other bar for more than a second.
            s.play(bar.send('answer reserve', shelf), { duration: 4 })
            s.wait(1)
        }), { motion: true, textGap: 0.7 })
        expect(report.diagnostics).toEqual([])
    })

    it('says which label belongs to the box of a part, so a light on the box keeps its label bright', async () => {
        let bar!: Bar
        const compiled = await compile((s) => {
            bar = s.add(two())
            expect(bar.labelsOf(bar.part('a').children[0]!)).toEqual([bar.part('a').children[1]])
            expect(bar.labelsOf(bar.frame)).toEqual([])
            s.play(spotlight(bar.part('a').children[0]!, { within: bar, dim: 0.2 }), { duration: 0.5 })
            s.wait(0.5)
        })
        // The name of the lit part keeps its color, and the name of the other part goes toward the background.
        const inkOf = (word: string) => paths(compiled, 0.9).find((op) => op.node?.parent instanceof TextNode && op.node.parent.source === word)!.fill
        expect(inkOf('a')).toEqual(parseColor('ink'))
        expect(inkOf('b')).not.toEqual(parseColor('ink'))
    })
})
