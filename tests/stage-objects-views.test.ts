import { describe, expect, it } from 'vitest'
import { checkFilm, compileFilm, chip, chipRow, fadeIn, film, group, lagged, linear, mixColor, fadeOut, parseColor, pathBounds, pathLength, pathToD, rect, namedBox, seq, tag, text, textWidth, smooth, eventLog, LogRowNode, LOG_STATES, delay, par, overshoot, spotlight, table, Table, TableCellNode, TableRowNode, TABLE_STATES, type TableColumn, type TableRow, type TableRowView, boxOf, fitted, type CompiledFilm, type Node, type PathOp, type Rgba, type Stage, type Vec, type Vec3, type LogRow, TextNode, type FontFamily, passage, shift, type Value, place as placeIn, layerStack, STACK_STATES, beside, type StackLayer } from '../src/stage/index'
import type { Anim } from '../src/stage/anim'
import { at, compile, expectPure, paths } from './helpers/stage-objects'

describe('event log', () => {
    type Log = ReturnType<typeof eventLog>
    const history: LogRow[] = [
        { id: 1, name: 'WorkflowExecutionStarted', detail: 'order' },
        { id: 2, name: 'WorkflowTaskScheduled' },
        { id: 3, name: 'WorkflowTaskStarted' },
        { id: 4, name: 'WorkflowTaskCompleted' },
        { id: 5, name: 'ActivityTaskScheduled', detail: 'chargeCard' },
        { id: 6, name: 'ActivityTaskStarted', detail: 'attempt 1' },
        { id: 7, name: 'ActivityTaskCompleted', detail: '"ch_1001"' },
    ]
    /** Rows with the ids `from` to `to`, and no detail. */
    const some = (from: number, to: number, state?: string): LogRow[] => Array.from({ length: to - from + 1 }, (_, index) => ({ id: from + index, name: `Event${from + index}`, ...(state ? { state } : {}) }))
    const words = (node: Node | null) => (node as unknown as { source: string }).source
    /** How much of a node a viewer gets: its opacity and that of each holder over it, and 0 when one of them is hidden. */
    const shows = (node: Node) => {
        let value = 1
        for (let holder: Node | null = node; holder; holder = holder.parent) {
            if (!holder.get('visible')) return 0
            value *= holder.get('opacity')
        }
        return value
    }
    const right = (node: Node) => node.bounds().x + node.bounds().width
    const bottom = (node: Node) => node.bounds().y + node.bounds().height
    /** Every line that the list has made: rows and folds, also those that do not show. */
    const made = (log: Log) => log.all().filter((node): node is LogRowNode => node instanceof LogRowNode)
    /** The lines that a viewer sees at a time, from the top: the text of the id of each. */
    const seen = (log: Log, time: number) => at(time, () => made(log).filter((node) => shows(node.content) > 0.99).sort((a, b) => a.get('y') - b.get('y')).map((node) => words(node.idText)))
    /** The text that a holder shows at a time, such as the count of the rows above. */
    const said = (holder: Node, time: number) => at(time, () => (shows(holder) > 0.99 ? holder.children.filter((child) => typeof words(child) === 'string' && child.get('visible')).map(words) : []))
    /** The line of a row by the text of its id, also when it does not show. A fold is not a row. */
    const line = (log: Log, id: number | string) => made(log).find((node) => words(node.idText) === String(id) && node.range === null)!
    /** The folds that show at a time, from the top. */
    const folds = (log: Log, time: number) => at(time, () => made(log).filter((node) => node.range !== null && shows(node.content) > 0.99).sort((a, b) => a.get('y') - b.get('y')))
    /** What a line says, part by part: the id, the range of a fold, the name, the detail, the time. */
    const says = (node: LogRowNode) => [node.idText, node.range, node.name, node.detail, node.time].map((part) => (part ? words(part) : null))
    const ink = (node: Node) => node.children[0]!.get('fill')
    /** The mark of a line at a time: the shape that shows, and its color. */
    const markOf = (node: LogRowNode, time: number) => at(time, () => {
        const shape = node.mark.children.filter((child) => child.get('visible')).sort((a, b) => b.get('opacity') - a.get('opacity'))[0]!
        const leaf = shape.leaves()[0]!
        return [shape.data['shape'], leaf.get('fill') ?? leaf.get('stroke')]
    })
    const inside = (part: Node, whole: Node) => {
        const a = part.bounds(), b = whole.bounds()
        expect(a.x).toBeGreaterThanOrEqual(b.x)
        expect(a.y).toBeGreaterThanOrEqual(b.y)
        expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width)
        expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height)
    }
    /**
     * Where the getters and the picture disagree at a time: a line of `rows` that is not at the y of `p()` or
     * does not show, a line that shows and is not in `rows`, two lines at one place, and two texts in a count
     * or in the footer.
     */
    const wrong = (log: Log, time: number): string[] => {
        const found: string[] = []
        const rows = log.rows
        at(time, () => {
            for (const row of rows) {
                const id = words(row.idText)
                if (shows(row.content) < 0.99) found.push(`row ${id} is in rows and does not show`)
                else if (Math.abs(row.get('y') - log.p(id)[1]) > 0.5) found.push(`row ${id} is not at p()`)
            }
            for (const node of made(log)) if (shows(node.content) > 0.01 && !rows.includes(node)) found.push(`line ${words(node.idText)} shows and is not in rows`)
            const places = rows.map((row) => Math.round(row.get('y')))
            if (new Set(places).size !== places.length) found.push('two lines share one place')
        })
        for (const holder of [log.earlier, log.later, log.footer!]) if (said(holder, time).length > 1) found.push(`two texts: ${said(holder, time).join(' | ')}`)
        return found
    }

    it('centers the panel on its place, with the title over the rows and the footer under them', async () => {
        await compileFilm(film(() => {
            const log = eventLog(history, { title: 'event history', footer: (count) => `${count} events`, visible: 8, size: 20, width: 600 }).at(100, 50)
            const frame = log.frame.bounds(), P = log.pitch
            expect(frame.x + frame.width / 2).toBeCloseTo(100, 6)
            expect(frame.y + frame.height / 2).toBeCloseTo(50, 6)
            // 8 lines, 8 px over and under them, and 38 px each for the title and the footer.
            expect(frame.width).toBeCloseTo(600, 6)
            expect(frame.height).toBeCloseTo(8 * P + 16 + 76, 6)
            log.rows.forEach((row, index) => expect(row.get('y')).toBeCloseTo(-frame.height / 2 + 38 + 8 + P / 2 + index * P, 6))
            // From the top: the title, a rule, the rows, a rule, the footer. The rules go from border to border.
            const [over, under] = log.rules.map((rule) => rule.bounds())
            expect(bottom(log.title!)).toBeLessThan(over!.y)
            expect(over!.y).toBeLessThan(log.rows[0]!.bounds().y)
            expect(bottom(log.rows[6]!)).toBeLessThan(under!.y)
            expect(under!.y).toBeLessThan(log.footer!.bounds().y)
            expect(over!.width).toBeCloseTo(600 - log.frame.get('strokeWidth'), 6)
            for (const part of [log.title!, log.footer!, ...log.rows]) inside(part, log.frame)
            expect(words(log.title)).toBe('event history')
            // The title and the footer start where the marks of the rows start.
            expect(Math.abs(log.title!.bounds().x - log.rows[0]!.mark.bounds().x)).toBeLessThan(2)
            // Without a title and a footer, the panel has the rows and the room around them.
            const plain = eventLog(history, { visible: 8, size: 20 })
            expect(plain.title).toBeNull()
            expect(plain.footer).toBeNull()
            expect(plain.rules).toHaveLength(0)
            expect(plain.frame.bounds().height).toBeCloseTo(8 * P + 16, 6)
            // The defaults: 640 wide, ten lines, a text size of 24.
            const usual = eventLog(history), box = usual.frame.bounds()
            expect([box.width, box.height]).toEqual([640, expect.closeTo(10 * usual.pitch + 2 * 9.6, 6)])
            expect(usual.rows[0]!.name.bounds().height / log.rows[0]!.name.bounds().height).toBeCloseTo(24 / 20, 2)
        }))
    })

    it('puts the rows as far apart as the outline needs: 0.3 of the text size from the ink of its row, and from the ink of the rows next to it', async () => {
        // Characters that go as far up and as far down as any printable ASCII character does, in mono and in the font of the details.
        const tall = 'A(|$gjy_Q'
        const lists: { log: Log; size: number }[] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            for (const size of [24, 40]) {
                for (const options of [{}, { detailFont: 'mono' as const }, { focusLook: 'band' as const }]) {
                    const log = s.add(eventLog([1, 2, 3].map((id) => ({ id, name: tall, detail: tall })), { size, width: 1400, ...options }))
                    s.play(log.focus(2), { duration: 0 })
                    lists.push({ log, size })
                }
            }
            s.wait(1)
        }))
        for (const { log, size } of lists) {
            const [above, own, below] = at(0.5, () => log.rows.map((row) => { const boxes = [row.name.bounds(), row.detail!.bounds()]; return [Math.min(...boxes.map((box) => box.y)), Math.max(...boxes.map((box) => box.y + box.height))] }))
            const box = at(0.5, () => log.outline.bounds())
            // The band has no line. The outline has one, and the room is from the edge of that line.
            const half = at(0.5, () => (log.outline.get('stroke') ? log.outline.get('strokeWidth') / 2 : 0))
            const room = size * 0.3 - 1e-6
            expect(own![0]! - (box.y + half)).toBeGreaterThanOrEqual(room)
            expect(box.y + box.height - half - own![1]!).toBeGreaterThanOrEqual(room)
            expect(box.y - half - above![1]!).toBeGreaterThanOrEqual(room)
            expect(below![0]! - (box.y + box.height + half)).toBeGreaterThanOrEqual(room)
            // The room is not more than it has to be: the distance between two rows is the ink, the room, and the line.
            expect(box.y - half - above![1]!).toBeLessThan(room + size * 0.1)
            expect(box.height).toBeCloseTo(log.pitch, 6)
            // The outline has room at its two ends too: from the mark at the left, and from the end of the panel.
            expect(at(0.5, () => log.rows[1]!.mark.bounds().x) - box.x).toBeGreaterThan(size * 0.3)
            expect(box.x).toBeGreaterThan(at(0.5, () => log.frame.bounds().x) + size * 0.2)
        }
        // The pitch follows the fonts: a list with details in mono needs less than one with details in the text font.
        expect(lists[1]!.log.pitch).toBeLessThan(lists[0]!.log.pitch)
        expect(lists[0]!.log.pitch / 24).toBeCloseTo(lists[3]!.log.pitch / 40, 1)
        expect(lists[0]!.log.pitch).toBeGreaterThan(24 * 1.7)
        expect(lists[0]!.log.pitch).toBeLessThan(24 * 1.95)
    })

    it('lines up the columns over all rows: the marks, the ends of the ids, and the starts of the names and of the details', async () => {
        await compileFilm(film(() => {
            const log = eventLog([{ id: 7, name: 'Short', detail: 'a' }, { id: 12, name: 'ActivityTaskCompleted', detail: '"ch_1001"' }, { id: 'ab', name: 'Wide', detail: 'x y' }], { size: 20 })
            const rows = log.rows
            for (const part of ['mark', 'idText', 'name', 'detail'] as const) expect(new Set(rows.map((row) => row[part]!.get('x'))).size).toBe(1)
            // An id ends at the x of its column, and a name and a detail start at theirs. The ink is there to 3 px:
            // a glyph has a little room at its sides.
            for (const row of rows) {
                expect(Math.abs(right(row.idText) - row.idText.get('x'))).toBeLessThan(3)
                expect(Math.abs(row.name.bounds().x - row.name.get('x'))).toBeLessThan(3)
                expect(Math.abs(row.detail!.bounds().x - row.detail!.get('x'))).toBeLessThan(3)
                // From the left: the mark, the id, the name, the detail. No part touches the next.
                expect(right(row.mark)).toBeLessThan(row.idText.bounds().x)
                expect(right(row.idText)).toBeLessThan(row.name.bounds().x)
                expect(right(row.name)).toBeLessThan(row.detail!.bounds().x)
                // The mark is at the middle height of the row.
                expect(row.mark.get('y')).toBe(0)
                // The id and the detail are dim, so the name is what a viewer reads first.
                expect([ink(row.idText), ink(row.detail!)]).toEqual([parseColor('dim'), parseColor('dim')])
            }
            // The names have the room of the longest name of the first rows, and the details start 18 px after it.
            expect(rows[0]!.detail!.get('x') - right(rows[1]!.name)).toBeGreaterThan(17)
            expect(rows[0]!.detail!.get('x') - right(rows[1]!.name)).toBeLessThan(20)
            // The ids have room for two digits at least, so a list that starts at 1 can go on to 99.
            const short = eventLog([{ id: 1, name: 'One' }], { size: 20 })
            expect(short.rows[0]!.name.get('x') - short.rows[0]!.idText.get('x')).toBeCloseTo(14, 6)
            expect(short.rows[0]!.idText.get('x') - short.rows[0]!.mark.get('x')).toBeCloseTo(3.4 + 12 + 24, 6)
            // The name is in mono and the detail in another font. Both stand on one baseline.
            const large = eventLog([{ id: 1, name: 'HHH', detail: 'HHH' }], { size: 100, width: 1400 }).rows[0]!
            expect(Math.abs(bottom(large.name) - bottom(large.detail!))).toBeLessThan(0.3)
            for (const font of ['mono', 'text-serif'] as const) {
                const other = eventLog([{ id: 1, name: 'HHH', detail: 'HHH' }], { size: 100, width: 1500, font }).rows[0]!
                expect(Math.abs(bottom(other.name) - bottom(other.detail!))).toBeLessThan(0.3)
            }
        }))
    })

    it('has its full height from the start, and draws nothing outside the panel while rows arrive', async () => {
        let log!: Log
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 2), { title: 'log', footer: (count) => `${count} rows`, visible: 4, size: 20, width: 400 }))
            s.wait(0.5)
            s.play(log.append(some(3, 8)), { duration: 3, ease: linear })
            s.wait(0.5)
        }))
        const sizes = [0, 0.7, 1.9, 4].map((time) => at(time, () => { const box = log.frame.bounds(); return [box.x, box.y, box.width, box.height] }))
        for (const size of sizes) expect(size).toEqual(sizes[0])
        expect(sizes[0]![3]).toBeCloseTo(4 * log.pitch + 16 + 76, 6)
        // At rest, the list is as large as its panel. And at each frame, every mark that the film draws is in the panel.
        for (const time of [0, 4]) {
            const box = at(time, () => log.bounds())
            expect([box.x, box.y, box.width, box.height]).toEqual(sizes[0])
        }
        for (let step = 0; step <= 60; step++) {
            const [panel, ...rest] = paths(compiled, 0.5 + step / 20)
            const outer = pathBounds(panel!.path)!
            for (const op of rest) {
                if (Math.max(op.fillAlpha, op.strokeAlpha) < 0.02) continue
                const box = pathBounds(op.path)!
                expect(box.y).toBeGreaterThanOrEqual(outer.y)
                expect(box.y + box.height).toBeLessThanOrEqual(outer.y + outer.height)
            }
        }
    })

    it('adds one row or many at the bottom, in the order given, and counts them', async () => {
        let log!: Log
        const counts: number[] = [], ids: (number | string)[][] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog([], { visible: 8, size: 20 }))
            counts.push(log.count)
            s.play(log.append({ id: 1, name: 'One' }), { duration: 1, ease: linear })
            counts.push(log.count)
            s.play(log.append([{ id: 'b', name: 'Two' }, { id: 3, name: 'Three' }, { id: 4, name: 'Four' }]), { duration: 3, ease: linear })
            counts.push(log.count)
            ids.push(log.ids)
            // An append with no row does nothing and takes no time.
            const none = log.append([])
            expect(none.duration).toBe(0)
            s.play(none)
            expect(log.count).toBe(4)
        }))
        const P = log.pitch
        expect(counts).toEqual([0, 1, 4])
        expect(ids[0]).toEqual([1, 'b', 3, 4])
        expect(log.rows.map((row) => words(row.name))).toEqual(['One', 'Two', 'Three', 'Four'])
        // The rows arrive one after another: each has a third of the time of its append.
        expect(seen(log, 0.5)).toEqual([])
        expect(seen(log, 1)).toEqual(['1'])
        expect(seen(log, 1.5)).toEqual(['1'])
        expect(seen(log, 2)).toEqual(['1', 'b'])
        expect(seen(log, 3)).toEqual(['1', 'b', '3'])
        expect(seen(log, 4)).toEqual(['1', 'b', '3', '4'])
        // A new row fades in over six tenths of its time, and rises to its place from a third of a row under it. No other row moves.
        const fresh = log.rows[1]!, first = log.rows[0]!
        expect(at(1.3, () => shows(fresh))).toBeCloseTo(0.5, 6)
        expect(at(1.6, () => shows(fresh))).toBeCloseTo(1, 6)
        expect(at(1.3, () => fresh.get('y') - first.get('y'))).toBeCloseTo(P + 0.35 * P * 0.7, 6)
        expect(at(2, () => fresh.get('y') - first.get('y'))).toBeCloseTo(P, 6)
        expect(at(1.5, () => first.get('y'))).toBe(at(1, () => first.get('y')))
        // The default time is 0.4 s for each row, and half a second at least.
        expect(log.append(some(10, 14)).duration).toBeCloseTo(2, 6)
        expect(log.append(some(10, 10)).duration).toBe(0.5)
    })

    it('shows the newest rows of a full window, and says in its first line how many rows are above', async () => {
        let log!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 5), { visible: 5, size: 20 }))
            s.wait(1)
            s.play(log.append(some(6, 6)), { duration: 1, ease: linear })
            s.play(log.append(some(7, 8)), { duration: 2, ease: linear })
        }))
        const P = log.pitch
        // Five rows fill the five lines, and the list has no line for a count.
        expect(seen(log, 0.5)).toEqual(['1', '2', '3', '4', '5'])
        expect(said(log.earlier, 0.5)).toEqual([])
        // A sixth row needs a line, and the count needs one: two rows go, and four rows show.
        expect(seen(log, 2)).toEqual(['3', '4', '5', '6'])
        expect(said(log.earlier, 2)).toEqual(['2 earlier'])
        expect(seen(log, 3)).toEqual(['4', '5', '6', '7'])
        expect(said(log.earlier, 3)).toEqual(['3 earlier'])
        expect(seen(log, 4)).toEqual(['5', '6', '7', '8'])
        expect(said(log.earlier, 4)).toEqual(['4 earlier'])
        // The count changes when the row that leaves is nearly gone: at 45% of the way, not at its end.
        expect(said(log.earlier, 2.44)).toEqual(['2 earlier'])
        expect(said(log.earlier, 2.46)).toEqual(['3 earlier'])
        // The count is in the first line, where the first row was, and the rows are in the lines under it.
        const top = at(0.5, () => line(log, 1).get('y'))
        expect(log.earlier.get('y')).toBeCloseTo(top, 6)
        expect(at(4, () => line(log, 5).get('y'))).toBeCloseTo(top + P, 6)
        expect(at(4, () => line(log, 8).get('y'))).toBeCloseTo(top + 4 * P, 6)
        expect(log.rows.map((row) => words(row.idText))).toEqual(['5', '6', '7', '8'])
        expect(log.count).toBe(8)
        // No row is under the window, so the last line has no count.
        expect(said(log.later, 4)).toEqual([])
        // The count is of records: a fold above the window counts each record that it holds, at the start and after a row arrives.
        let folded!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            folded = s.add(eventLog([{ id: 1, name: 'One' }, { ids: [2, 3, 4], name: 'three' }, ...some(5, 8)], { visible: 4 }))
            s.play(folded.append(some(9, 9)), { duration: 1 })
        }))
        expect(seen(folded, 0)).toEqual(['6', '7', '8'])
        expect(said(folded.earlier, 0)).toEqual(['5 earlier'])
        expect(seen(folded, 1)).toEqual(['7', '8', '9'])
        expect(said(folded.earlier, 1)).toEqual(['6 earlier'])
        // A list that is made with more rows than lines starts at its end.
        const long = eventLog(some(1, 40), { visible: 12 })
        expect(long.rows.map((row) => words(row.idText))).toEqual(some(30, 40).map((row) => String(row.id)))
        expect(said(long.earlier, 0)).toEqual(['29 earlier'])
        expect(long.count).toBe(40)
        // The count line has its three dots and one text: the list writes a text for a count that it shows, and for no other.
        expect(long.earlier.children).toHaveLength(2)
        // A fold above the window, and its unfold: the records are the same, so the count is the same. A line that left the list counts no more.
        let hidden!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            hidden = s.add(eventLog(some(1, 12), { visible: 5 }))
            s.play(hidden.fold([2, 3, 4], 'three'), { duration: 1 })
            s.play(hidden.unfold(2), { duration: 1 })
        }))
        expect([0, 1, 2].map((time) => [seen(hidden, time), said(hidden.earlier, time)])).toEqual(Array(3).fill([['9', '10', '11', '12'], ['8 earlier']]))
    })

    it('moves the rows of a full window as one when a row arrives, and no row jumps', async () => {
        let log!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 6), { visible: 5, size: 20 }))
            s.wait(1)
            s.play(log.append(some(7, 7)), { duration: 1 })
        }))
        const P = log.pitch
        const rows = [3, 4, 5, 6, 7].map((id) => line(log, id))
        const start = at(1, () => rows.map((row) => row.get('y')))
        let before = start
        for (let step = 1; step <= 20; step++) {
            const now = at(1 + step / 20, () => rows.map((row) => row.get('y')))
            // Each row is one row under the row before it, at every frame: the row that leaves, the rows that stay, and the row that comes.
            for (let index = 1; index < now.length; index++) expect(now[index]! - now[index - 1]!).toBeCloseTo(P, 6)
            // No frame moves a row by more than a small part of a row.
            expect(Math.abs(now[0]! - before[0]!)).toBeLessThan(P * 0.27)
            before = now
        }
        expect(before[0]! - start[0]!).toBeCloseTo(-P, 6)
    })

    it('fades a row that leaves before it reaches the count, and shows a new row only when it is at the window', async () => {
        let log!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 6), { title: 'log', footer: (count) => `${count} rows`, visible: 5, size: 20 }))
            s.wait(1)
            s.play(log.append(some(7, 7)), { duration: 1, ease: linear })
        }))
        const P = log.pitch
        const leaves = line(log, 3), comes = line(log, 7), stays = line(log, 5)
        const first = log.earlier.get('y')
        for (let step = 0; step <= 20; step++) {
            const time = 1 + step / 20
            const [up, opacity] = at(time, () => [(leaves.get('y') - first) / P, shows(leaves)])
            // The row that leaves is whole in its line, and gone when it is 0.4 of a row past it.
            if (up! >= 0.95) expect(opacity).toBeCloseTo(1, 6)
            if (up! <= 0.6) expect(opacity).toBe(0)
            const [down, alpha] = at(time, () => [(comes.get('y') - first) / P - 4, shows(comes)])
            if (down! >= 0.4) expect(alpha).toBe(0)
            expect(at(time, () => shows(stays))).toBe(1)
        }
        expect(at(1.2, () => shows(leaves))).toBeCloseTo(1 - 0.15 / 0.35, 6)
        expect(at(1.8, () => shows(comes))).toBeCloseTo(1 - 0.15 / 0.35, 6)
        expect(at(2, () => [shows(leaves), shows(comes)])).toEqual([0, 1])
        // A row that has left is hidden, so the frame and the bounds of the list skip it.
        expect(at(1.9, () => leaves.get('visible'))).toBe(true)
        expect(at(2, () => leaves.get('visible'))).toBe(false)
        // At the first row past the window, two rows go: the first fades where it is, for the count takes its line.
        let short!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            short = s.add(eventLog(some(1, 5), { visible: 5, size: 20 }))
            s.play(short.append(some(6, 6)), { duration: 1, ease: linear })
        }))
        const top = line(short, 1)
        expect(at(0.3, () => top.get('y'))).toBe(at(0, () => top.get('y')))
        expect(at(0.175, () => shows(top))).toBeCloseTo(0.5, 6)
        expect(at(0.4, () => shows(top))).toBe(0)
        // The count comes in the second half, when the two rows are gone.
        expect(at(0.5, () => shows(short.earlier))).toBe(0)
        expect(at(0.75, () => shows(short.earlier))).toBeCloseTo(0.5, 6)
        expect(at(1, () => shows(short.earlier))).toBe(1)
    })

    it('chains two appends in one sequence, and refuses an id that the list has', async () => {
        let log!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 2), { visible: 8, size: 20 }))
            s.play(seq(log.append(some(3, 3)), log.append(some(4, 5))), { duration: 3, ease: linear })
            expect(log.count).toBe(5)
            expect(log.ids).toEqual([1, 2, 3, 4, 5])
            // The film asks for the row now, and the list has it.
            expect(() => log.append({ id: 3, name: 'Again' })).toThrow(/the list already has a row with the id 3\. Give each row its own id/)
            // An id is known by its text, so the text '3' is the id 3.
            expect(() => log.append({ id: '3', name: 'Again' })).toThrow(/already has a row with the id "3"/)
            expect(() => log.append([{ id: 8, name: 'A' }, { id: 8, name: 'B' }])).toThrow(/two rows have the id 8/)
            // Two appends of one id in one sequence: the second finds the row of the first when it is scheduled.
            const twice = seq(log.append({ id: 9, name: 'A' }), log.append([{ id: 10, name: 'B' }, { id: 9, name: 'C' }]))
            expect(() => s.play(twice)).toThrow(/already has a row with the id 9/)
            // The append that is refused adds none of its rows: the list has row 9 of the first one, and no row 10.
            expect(log.ids).toEqual([1, 2, 3, 4, 5, 9])
            // A focus or a mark that the play names before the `append` of its row: the list has no such row yet, and says what to do.
            expect(() => s.play(log.focus(21), log.append(some(21, 21)))).toThrow(/no row has the id 21\. The list has the ids 1 to 9\. When an `append` in the same play brings the row, name the `append` before this call: the list takes the calls of a play in their order$/)
            expect(() => s.play(log.mark(21, 'answered'), log.append(some(21, 21)))).toThrow(/When an `append` in the same play brings the row, name the `append` before this call/)
            expect(log.ids).toEqual([1, 2, 3, 4, 5, 9])
            // The play that was refused did not move the time of the film, and its first append has its time.
            s.wait(1)
            s.play(log.append(some(21, 21)), log.focus(21), log.mark(21, 'answered'))
            expect(log.ids).toEqual([1, 2, 3, 4, 5, 9, 21])
            // A getter is not a call of a play, so its message has no such advice.
            expect(() => log.row(99)).toThrow(/no row has the id 99\. The list has the ids 1 to 21$/)
        }))
        // Three rows in three seconds, one after another, over the two appends.
        expect(seen(log, 1)).toEqual(['1', '2', '3'])
        expect(seen(log, 2)).toEqual(['1', '2', '3', '4'])
        expect(seen(log, 3)).toEqual(['1', '2', '3', '4', '5'])
    })

    it('brings the rows of one call together with a lag of 0, and keeps rows that overlap in time one row apart', async () => {
        let group!: Log, overlap!: Log, large!: Log, half!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            group = s.add(eventLog(some(1, 6), { visible: 5, size: 20 }))
            overlap = s.add(eventLog(some(1, 6), { visible: 5, size: 20 }))
            large = s.add(eventLog(some(1, 6), { visible: 5, size: 20 }))
            half = s.add(eventLog([], { visible: 8, size: 20 }))
            s.play(group.append(some(7, 9), { lag: 0 }), large.append(some(7, 15), { lag: 0 }), half.append(some(1, 3), { lag: 0.5 }), { duration: 2, ease: linear })
            // With the ease of the house, a row that gets a new place slows down and starts again.
            s.play(overlap.append(some(7, 9), { lag: 0.5 }), { duration: 2 })
        }))
        const P = group.pitch
        // The group goes up three rows in one move, and its rows come with it.
        const rows = [6, 7, 8, 9].map((id) => line(group, id))
        const top = group.earlier.get('y')
        expect(at(1, () => rows.map((row) => (row.get('y') - top) / P))).toEqual([2.5, 3.5, 4.5, 5.5].map((value) => expect.closeTo(value, 6)))
        expect(seen(group, 2)).toEqual(['6', '7', '8', '9'])
        expect(said(group.earlier, 2)).toEqual(['5 earlier'])
        // With a lag of 0.5, the second row starts when the first is half way. The rows stay one row apart.
        const late = [5, 6, 7, 8, 9].map((id) => line(overlap, id))
        for (let step = 1; step <= 40; step++) {
            const ys = at(2 + step / 20, () => late.filter((row) => row.get('visible')).map((row) => row.get('y')))
            for (let index = 1; index < ys.length; index++) expect(ys[index]! - ys[index - 1]!).toBeCloseTo(P, 6)
        }
        expect(seen(overlap, 4)).toEqual(['6', '7', '8', '9'])
        // Three rows in two seconds with a lag of 0.5: each has one second, and the next starts half a second later.
        expect(at(0.8, () => [1, 2, 3].map((id) => shows(line(half, id))))).toEqual([1, expect.closeTo(0.5, 6), 0])
        expect(at(1.3, () => [1, 2, 3].map((id) => shows(line(half, id))))).toEqual([1, 1, expect.closeTo(0.5, 6)])
        // A row that is still on its way in is not drawn under the window.
        for (let step = 1; step <= 40; step++) {
            for (const row of late) {
                const down = at(2 + step / 20, () => (row.get('y') - top) / P - 4)
                if (down >= 0.4) expect(at(2 + step / 20, () => shows(row))).toBe(0)
            }
        }
        // A group that is larger than the window goes through it. Nine rows go up nine lines: after four
        // ninths of the time, rows 7 to 10 are in the four lines, and none of them has a place at the end.
        expect(seen(large, 2 * 4 / 9)).toEqual(['7', '8', '9', '10'])
        expect(seen(large, 2)).toEqual(['12', '13', '14', '15'])
        expect(said(large.earlier, 2)).toEqual(['11 earlier'])
        // A row that went through is hidden at the end, so the bounds of the list are those of its panel.
        expect(at(2, () => [7, 10].map((id) => line(large, id).get('visible')))).toEqual([false, false])
        expect(at(1.9, () => line(large, 11).get('visible'))).toBe(true)
        expect(at(1.8, () => line(large, 7).get('y'))).toBe(large.earlier.get('y'))
        const box = at(2, () => large.bounds()), panel = at(2, () => large.frame.bounds())
        expect([box.y, box.height]).toEqual([panel.y, panel.height])
    })

    it('refuses two changes of the rows whose times overlap, and never leaves the picture wrong', async () => {
        const start = (): LogRow[] => [...some(1, 9), { ids: [10, 11, 12], name: 'a fold', rows: some(10, 12) }, ...some(13, 16), { ids: [17, 18], name: 'b fold', rows: some(17, 18) }, ...some(19, 20)]
        // The 23 mixes of the review, and the calls around them. `true` is a mix whose changes overlap in time.
        const cases: [string, boolean | ((visible: number) => boolean), (log: Log) => Anim][] = [
            ['seq(fold, fold)', false, (log) => seq(log.fold([13, 14], 'x'), log.fold([19, 20], 'y'))],
            ['par(fold, fold) in list order', true, (log) => par(log.fold([13, 14], 'x'), log.fold([19, 20], 'y'))],
            ['par(fold, fold) lower first', true, (log) => par(log.fold([19, 20], 'y'), log.fold([13, 14], 'x'))],
            ['lagged(fold, fold) lag 0.15', true, (log) => lagged([log.fold([13, 14], 'x'), log.fold([19, 20], 'y')])],
            ['lagged(fold, fold) lag 0.1', true, (log) => lagged([log.fold([13, 14], 'x'), log.fold([19, 20], 'y')], { lag: 0.1 })],
            ['lagged(fold lower, fold upper) lag 0.15', true, (log) => lagged([log.fold([19, 20], 'y'), log.fold([13, 14], 'x')])],
            ['lagged(fold, fold) lag 0.5', true, (log) => lagged([log.fold([13, 14], 'x'), log.fold([19, 20], 'y')], { lag: 0.5 })],
            ['lagged(fold, fold) lag 1', false, (log) => lagged([log.fold([13, 14], 'x'), log.fold([19, 20], 'y')], { lag: 1 })],
            ['seq(unfold, unfold)', false, (log) => seq(log.unfold(10), log.unfold(17))],
            ['par(unfold, unfold)', true, (log) => par(log.unfold(10), log.unfold(17))],
            ['lagged(unfold, unfold) lag 0.15', true, (log) => lagged([log.unfold(10), log.unfold(17)])],
            ['lagged(unfold, unfold) lag 0.5', true, (log) => lagged([log.unfold(10), log.unfold(17)], { lag: 0.5 })],
            ['lagged(unfold lower, unfold upper) lag 0.5', true, (log) => lagged([log.unfold(17), log.unfold(10)], { lag: 0.5 })],
            ['lagged(unfold, unfold) lag 1', false, (log) => lagged([log.unfold(10), log.unfold(17)], { lag: 1 })],
            ['par(append 1 row, append 1 row)', true, (log) => par(log.append(some(21, 21)), log.append(some(22, 22)))],
            ['par(append 2 rows, append 2 rows)', true, (log) => par(log.append(some(21, 22)), log.append(some(23, 24)))],
            ['par(append 2 rows lag 0, append 2 rows lag 0)', true, (log) => par(log.append(some(21, 22), { lag: 0 }), log.append(some(23, 24), { lag: 0 }))],
            ['lagged(append 2, append 2) lag 0.15', true, (log) => lagged([log.append(some(21, 22)), log.append(some(23, 24))])],
            ['lagged(append 2, append 2) lag 1', false, (log) => lagged([log.append(some(21, 22)), log.append(some(23, 24))], { lag: 1 })],
            ['par(append, fold)', true, (log) => par(log.append(some(21, 21)), log.fold([13, 14], 'x'))],
            ['par(fold, append)', true, (log) => par(log.fold([13, 14], 'x'), log.append(some(21, 21)))],
            ['par(append, unfold)', true, (log) => par(log.append(some(21, 21)), log.unfold(17))],
            ['par(unfold, append)', true, (log) => par(log.unfold(17), log.append(some(21, 21)))],
            ['par(fold, unfold)', true, (log) => par(log.fold([13, 14], 'x'), log.unfold(17))],
            ['par(unfold, fold)', true, (log) => par(log.unfold(17), log.fold([13, 14], 'x'))],
            // Row 1 is out of a window of 8 lines, so the window moves. In a window of 30 lines it shows, and nothing moves.
            ['par(scrollTo, append)', (visible) => visible === 8, (log) => par(log.scrollTo(1), log.append(some(21, 21)))],
            ['par(scrollTo of a row that shows, append)', false, (log) => par(log.scrollTo(19), log.append(some(21, 21)))],
            ['par(append, scrollTo of a row that shows)', false, (log) => par(log.append(some(21, 21)), log.scrollTo(20))],
            ['seq(scrollTo, append, fold)', false, (log) => seq(log.scrollTo(1), log.append(some(21, 21)), log.fold([13, 14], 'x'))],
            // A change of the rows with calls that change no row: these are free to overlap.
            ['par(mark, append, focus)', false, (log) => par(log.mark(15, 'answered'), log.append(some(21, 22)), log.focus(22))],
            ['par(focus, fold)', false, (log) => par(log.focus(13), log.fold([13, 14], 'x'))],
            ['par(mark, unfold)', false, (log) => par(log.mark(17, 'failed'), log.unfold(17))],
            ['par(enter, append, show)', false, (log) => par(log.enter(), log.append(some(21, 21)), log.show(21))],
        ]
        for (const visible of [8, 30]) {
            for (const [name, flag, build] of cases) {
                const overlaps = typeof flag === 'function' ? flag(visible) : flag
                let log!: Log, end = 0, thrown = ''
                await compileFilm(film({ fps: 20 }, (s) => {
                    log = s.add(eventLog(start(), { visible, size: 24, footer: (count) => `${count} events` }))
                    s.wait(1)
                    // A font that is not loaded yet stops the build with a promise, and the film runs again.
                    try { s.play(build(log)) } catch (error) { if (!(error instanceof Error)) throw error; thrown = error.message }
                    s.wait(1)
                    end = s.time
                }))
                // Refused, or right: each line of `rows` shows at the place that `p()` gives, and nothing else shows.
                if (overlaps) expect(thrown, name).toMatch(/^eventLog: \w+\(.*\) plays from [\d.]+ s to [\d.]+ s, and \w+\(.*\) plays from [\d.]+ s to [\d.]+ s\. The list changes its rows one change at a time: a change starts when the change before it is over\. \S/)
                else expect(thrown, name).toBe('')
                expect(wrong(log, end), `${name}, window of ${visible}`).toEqual([])
            }
        }
        // The error names the two calls and their times.
        await compileFilm(film({ fps: 20 }, (s) => {
            const log = s.add(eventLog(some(1, 9), { visible: 8, size: 24 }))
            s.wait(1)
            expect(() => s.play(log.fold([3, 4], 'x'), log.append(some(10, 11)), { duration: 2 })).toThrow(/append\(\[10, 11\]\) plays from 1 s to 3 s, and fold\(\[3, 4\]\) plays from 1 s to 3 s\./)
            // The first of the two is done, and the second is not: the list is as the fold left it.
            expect(log.count).toBe(9)
            expect(log.rows).toHaveLength(8)
            // A change at the time where the last one ends is not an overlap. Two changes of no length at one time follow each other.
            s.wait(2)
            s.play(log.append(some(10, 10)), { duration: 1 })
            s.play(log.fold([5, 6], 'y'), log.fold([7, 8], 'z'), { duration: 0 })
            expect(log.rows.map((row) => words(row.idText))).toEqual(['1', '2', '3', '5', '7', '9', '10'])
            // Two lists do not know of each other.
            const other = s.add(eventLog(some(1, 3), { visible: 8, size: 24 }))
            s.play(log.append(some(11, 11)), other.append(some(4, 4)))
            expect([log.count, other.count]).toEqual([11, 4])
            // A change that the film puts before the last one in time is refused too: its rows start from the wrong places.
            expect(() => s.at(0.5, () => s.play(log.append(some(12, 12))))).toThrow(/append\(\[12\]\) plays from 0\.5 s to 1 s, and append\(\[11\]\) plays from 4 s to 4\.5 s/)
        }))
        // This test builds 72 films. On a loaded machine that takes longer than the usual limit of a test.
    }, 60_000)

    it('gives the advice that fits two changes that overlap, and a film that follows it builds with the same pace', async () => {
        const message = (build: () => unknown) => { try { build() } catch (error) { if (!(error instanceof Error)) throw error; return error.message } return '' }
        const rule = 'The list changes its rows one change at a time: a change starts when the change before it is over. '
        // Seven short appends in one play, each 0.23 s after the one before: the film of a session log.
        const rows = some(1, 7)
        let log!: Log, advice = ''
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog([], { visible: 8, size: 20 }))
            advice = message(() => s.play(...rows.map((row, index) => delay(log.append(row, { duration: 0.25 }), 0.15 + index * 0.23))))
        }))
        expect(advice).toBe(`eventLog: append([2]) plays from 0.38 s to 0.63 s, and append([1]) plays from 0.15 s to 0.4 s. ${rule}Give one \`append\` all the rows, with \`{ lag: 0.92, duration: 0.25 + 0.23 * (rows - 1) }\`. Each row then takes 0.25 s and starts 0.23 s after the row before it, as here`)
        const [lag, first, each] = /lag: ([\d.]+), duration: ([\d.]+) \+ ([\d.]+) \* \(rows - 1\)/.exec(advice)!.slice(1).map(Number)
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog([], { visible: 8, size: 20 }))
            s.play(delay(log.append(rows, { lag: lag!, duration: first! + each! * (rows.length - 1), ease: linear }), 0.15))
            expect(s.time).toBeCloseTo(0.15 + 6 * 0.23 + 0.25, 6)
        }))
        // The pace is that of the film: each row starts 0.23 s after the row before it, and takes 0.25 s.
        rows.forEach((row, index) => {
            const start = 0.15 + index * 0.23, node = line(log, row.id as number)
            expect(at(start - 0.01, () => shows(node))).toBe(0)
            expect(at(start + 0.075, () => shows(node))).toBeCloseTo(0.5, 5)
            expect(at(start + 0.25, () => shows(node))).toBeCloseTo(1, 5)
        })
        // Two appends that start together: one call with all the rows, and `lag: 0`.
        let together!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            together = s.add(eventLog(some(1, 2), { visible: 8, size: 20 }))
            expect(message(() => s.play(together.append(some(3, 3)), together.append(some(4, 4)), { duration: 1 }))).toBe(`eventLog: append([4]) plays from 0 s to 1 s, and append([3]) plays from 0 s to 1 s. ${rule}Give one \`append\` all the rows. With \`lag: 0\`, they arrive together`)
        }))
        await compileFilm(film({ fps: 20 }, (s) => {
            together = s.add(eventLog(some(1, 2), { visible: 8, size: 20 }))
            s.play(together.append(some(3, 4), { lag: 0 }), { duration: 1, ease: linear })
        }))
        expect(at(0.3, () => [3, 4].map((id) => shows(line(together, id))))).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.5, 6)])
        // Two folds in one play: a `seq`, and the play keeps its length.
        await compileFilm(film({ fps: 20 }, (s) => {
            const list = s.add(eventLog(some(1, 8), { visible: 8, size: 20 }))
            expect(message(() => s.play(list.fold([1, 2], 'x'), list.fold([5, 6], 'y'), { duration: 1 }))).toBe(`eventLog: fold([5, 6]) plays from 0 s to 1 s, and fold([1, 2]) plays from 0 s to 1 s. ${rule}Play the two in a \`seq\`: each then has its share of the time of the play`)
        }))
        await compileFilm(film({ fps: 20 }, (s) => {
            const list = s.add(eventLog(some(1, 8), { visible: 8, size: 20 }))
            s.play(seq(list.fold([1, 2], 'x'), list.fold([5, 6], 'y')), { duration: 1 })
            expect(s.time).toBe(1)
            expect(list.rows.map((row) => words(row.idText))).toEqual(['1', '3', '4', '5', '7', '8'])
        }))
        // Two folds, the second a little after the first: the first can be shorter, or the two go in a `seq`.
        await compileFilm(film({ fps: 20 }, (s) => {
            const list = s.add(eventLog(some(1, 8), { visible: 8, size: 20 }))
            expect(message(() => s.play(lagged([list.fold([1, 2], 'x'), list.fold([5, 6], 'y')], { lag: 0.25, duration: 1 })))).toBe(`eventLog: fold([5, 6]) plays from 0.2 s to 1 s, and fold([1, 2]) plays from 0 s to 0.8 s. ${rule}fold([1, 2]) takes 0.8 s, and fold([5, 6]) starts 0.2 s after it. Give fold([1, 2]) a \`duration\` of 0.2 or less, or play the two in a \`seq\``)
        }))
        // Two cues that are nearer than the first append takes: the first gets the time that it has.
        let cues!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            cues = s.add(eventLog(some(1, 3), { visible: 12, size: 20 }))
            s.at(2, () => s.play(cues.append(some(4, 8))))
            expect(message(() => s.at(3, () => s.play(cues.append(some(9, 10)))))).toBe(`eventLog: append([9, 10]) plays from 3 s to 3.8 s, and append([4, 5, 6, 7, 8]) plays from 2 s to 4 s. ${rule}append([4, 5, 6, 7, 8]) takes 2 s, and append([9, 10]) starts 1 s after it. Give append([4, 5, 6, 7, 8]) a \`duration\` of 1 or less, or play the two in a \`seq\``)
        }))
        await compileFilm(film({ fps: 20 }, (s) => {
            cues = s.add(eventLog(some(1, 3), { visible: 12, size: 20 }))
            s.at(2, () => s.play(cues.append(some(4, 8), { duration: 1 })))
            s.at(3, () => s.play(cues.append(some(9, 10))))
            expect(cues.count).toBe(10)
        }))
        // The cues are where the film put them: row 4 starts at 2 s, and row 9 at 3 s.
        expect([1.99, 2.05].map((time) => at(time, () => shows(line(cues, 4)) > 0))).toEqual([false, true])
        expect([2.99, 3.05].map((time) => at(time, () => shows(line(cues, 9)) > 0))).toEqual([false, true])
        // A cue that the film writes after a later one: the list takes its changes in the order of time.
        await compileFilm(film({ fps: 20 }, (s) => {
            const list = s.add(eventLog(some(1, 3), { visible: 12, size: 20 }))
            s.at(5, () => s.play(list.append(some(4, 4))))
            expect(message(() => s.at(3, () => s.play(list.append(some(5, 5)))))).toBe(`eventLog: append([5]) plays from 3 s to 3.5 s, and append([4]) plays from 5 s to 5.5 s. ${rule}The list takes the changes of its rows in the order of time, and the film calls append([4]) first. Call append([5]) before it`)
        }))
        await compileFilm(film({ fps: 20 }, (s) => {
            const list = s.add(eventLog(some(1, 3), { visible: 12, size: 20 }))
            s.at(3, () => s.play(list.append(some(5, 5))))
            s.at(5, () => s.play(list.append(some(4, 4))))
            expect(list.ids).toEqual([1, 2, 3, 5, 4])
        }))
    })

    it('follows the count in the footer, and names a footer that does not fit', async () => {
        let log!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 2), { footer: (count) => `${count} events`, visible: 8, size: 20 }))
            s.wait(1)
            s.play(log.append(some(3, 4)), { duration: 2, ease: linear })
            s.play(log.fold([1, 2], 'pair'), { duration: 1 })
            const wide = s.add(eventLog(some(1, 2), { footer: (count) => (count > 2 ? 'a footer with too many words for a panel of this width, by far' : 'short'), width: 300, size: 20 }))
            expect(() => s.play(wide.append(some(3, 3)))).toThrow(/the footer "a footer with too many words .*" is \d+ px wide, and the panel has 268 px\. Use a shorter text, or raise `width`/)
            expect(() => eventLog([], { footer: () => 'two\nlines' })).toThrow(/the footer has a line break/)
        }))
        expect(said(log.footer!, 0.5)).toEqual(['2 events'])
        // The number changes when a row is half there.
        expect(said(log.footer!, 1.45)).toEqual(['2 events'])
        expect(said(log.footer!, 1.55)).toEqual(['3 events'])
        expect(said(log.footer!, 2.55)).toEqual(['4 events'])
        // A fold does not change the count: it holds its rows.
        expect(said(log.footer!, 4)).toEqual(['4 events'])
    })

    it('changes the state of one row, of a list of rows, or of the rows that a function picks', async () => {
        let log!: Log
        let purple!: Rgba, green!: Rgba, red!: Rgba
        await compileFilm(film({ fps: 20 }, (s) => {
            [purple, green, red] = ['purple', 'green', 'red'].map((name) => parseColor(name)) as [Rgba, Rgba, Rgba]
            log = s.add(eventLog(history, { visible: 8, size: 20 }))
            s.wait(1)
            s.play(log.mark(2, 'answered'), { duration: 2, ease: linear })
            // A row that the list names twice changes once. The text '7' is the id 7.
            s.play(log.mark([5, '7', 5], 'failed'), { duration: 1, ease: linear })
            // The function sees the states that the changes before it left, in the same sequence too.
            s.play(seq(log.mark(1, 'answered'), log.mark((row) => row.state === 'answered', 'failed'), log.mark((row) => row.id === 3 && row.name === 'WorkflowTaskStarted' && row.detail === undefined, 'answered')), { duration: 3, ease: linear })
        }))
        const [one, two, three, four, five, , seven] = log.rows
        // The name has the color of the state. The id and the detail keep theirs.
        expect(at(1, () => ink(two!.name))).toEqual(purple)
        expect(at(2, () => ink(two!.name))).toEqual(mixColor(purple, green, 0.5))
        expect(at(3, () => ink(two!.name))).toEqual(green)
        expect(at(3, () => ink(two!.idText))).toEqual(at(0, () => ink(two!.idText)))
        expect(at(3, () => ink(one!.detail!))).toEqual(at(0, () => ink(one!.detail!)))
        expect(at(3, () => ink(four!.name))).toEqual(purple)
        // Every glyph of the name changes.
        expect(at(3, () => two!.name.children.every((glyph) => String(glyph.get('fill')) === String(green)))).toBe(true)
        expect(at(4, () => [ink(five!.name), ink(seven!.name)])).toEqual([red, red])
        expect(at(4, () => ink(one!.name))).toEqual(purple)
        // Rows 1 and 2 were answered when the function ran, and row 3 has the name and no detail.
        expect(at(7, () => [one, two, three, four].map((row) => ink(row!.name)))).toEqual([red, red, green, purple])
    })

    it('gives each state its own mark, and changes the mark with the state', async () => {
        let log!: Log, plain!: Log
        let colors!: Record<string, Rgba>
        await compileFilm(film({ fps: 20 }, (s) => {
            colors = Object.fromEntries(['purple', 'ink', 'green', 'yellow', 'red', 'teal'].map((name) => [name, parseColor(name)]))
            log = s.add(eventLog(['stored', 'new', 'answered', 'waiting', 'failed'].map((state, index) => ({ id: index + 1, name: state, state })), { size: 24 }))
            // A state with no mark has a dot, so the states of a film keep their look.
            plain = s.add(eventLog([{ id: 1, name: 'a' }, { id: 2, name: 'b', state: 'done' }], { size: 24, states: { open: { color: 'teal' }, done: { color: 'green', mark: 'check' } } }))
            s.wait(1)
            s.play(log.mark(1, 'failed'), log.mark(2, 'stored'), { duration: 1, ease: linear })
            s.play(seq(log.mark(3, 'new'), log.mark(3, 'answered'), log.mark(3, 'stored')), { duration: 3, ease: linear })
            expect(() => eventLog([], { states: { odd: { color: 'red', mark: 'star' as never } } })).toThrow(/the mark of the state "odd" is "star"\. A mark is 'dot', 'ring', 'check' or 'cross'/)
        }))
        // A dot for a record at rest and for a new one, a check for an answer, a ring for a wait, a cross for a failure.
        expect(log.rows.map((row) => markOf(row, 0))).toEqual([['dot', colors['purple']], ['dot', colors['ink']], ['check', colors['green']], ['ring', colors['yellow']], ['cross', colors['red']]])
        expect(Object.entries(LOG_STATES).map(([name, state]) => [name, state.color, state.mark])).toEqual([['stored', 'purple', 'dot'], ['new', 'ink', 'dot'], ['answered', 'green', 'check'], ['waiting', 'yellow', 'ring'], ['failed', 'red', 'cross']])
        expect(plain.rows.map((row) => markOf(row, 0))).toEqual([['dot', colors['teal']], ['check', colors['green']]])
        // A dot is filled. A ring, a check and a cross are lines, so a ring is not a dot of another color.
        expect(log.rows.map((row) => at(0, () => { const leaf = row.mark.leaves()[0]!; return [leaf.get('fill') !== null, leaf.get('stroke') !== null] }))).toEqual([[true, false], [true, false], [false, true], [false, true], [false, true]])
        // Each mark is at the place of the dot, and about as large: it does not reach the id.
        const dot = at(0, () => log.rows[0]!.mark.bounds())
        for (const row of log.rows) {
            const box = at(0, () => row.mark.bounds())
            expect(box.x + box.width / 2).toBeCloseTo(dot.x + dot.width / 2, 0)
            expect(box.y + box.height / 2).toBeCloseTo(at(0, () => row.get('y')), 0)
            expect(box.width).toBeLessThan(24 * 0.5)
            expect(box.width).toBeGreaterThanOrEqual(24 * 0.3)
            expect(box.x + box.width + 2).toBeLessThan(at(0, () => row.idText.bounds().x))
        }
        // A mark of another shape comes in as the old one goes. Two states with one shape change color only.
        const [first, second] = log.rows
        const strength = (node: LogRowNode, shape: string, time: number) => at(time, () => { const made = node.mark.children.find((child) => child.data['shape'] === shape); return made ? shows(made) : 0 })
        expect([strength(first!, 'dot', 1.5), strength(first!, 'cross', 1.5)]).toEqual([0.5, 0.5])
        expect([strength(first!, 'dot', 2), strength(first!, 'cross', 2)]).toEqual([0, 1])
        expect(markOf(first!, 2)).toEqual(['cross', colors['red']])
        expect(markOf(second!, 1.5)).toEqual(['dot', mixColor(colors['ink']!, colors['purple']!, 0.5)])
        expect(second!.mark.children).toHaveLength(1)
        // The mark that went is hidden, so the line has one mark.
        expect(at(2, () => first!.mark.children.filter((child) => child.get('visible')))).toHaveLength(1)
        // A shape that comes back has the color of its state now: the dot of `new` is the dot of `stored` later.
        const third = log.rows[2]!
        expect([3, 4, 5].map((time) => markOf(third, time))).toEqual([['dot', colors['ink']], ['check', colors['green']], ['dot', colors['purple']]])
        expect(third.mark.children).toHaveLength(2)
    })

    it('changes the rows of one mark together, or one after another with a lag, and leaves a row that has the state', async () => {
        let log!: Log, lagging!: Log, again!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 4), { visible: 8, size: 20 }))
            lagging = s.add(eventLog(some(1, 4), { visible: 8, size: 20 }))
            again = s.add(eventLog(some(1, 4), { visible: 8, size: 20 }))
            s.play(log.mark(2, 'answered'), again.mark(2, 'answered'), { duration: 1, ease: linear })
            s.play(log.mark([4, 2, 1], 'answered'), lagging.mark([4, 2, 1], 'answered', { lag: 1 }), again.mark([4, 2, 1], 'answered', { lag: 1 }), { duration: 3, ease: linear })
            expect(log.mark(1, 'failed').duration).toBe(0.5)
        }))
        const [purple, green] = [parseColor('purple'), parseColor('green')], half = mixColor(purple, green, 0.5)
        const names = (list: Log, picked: number[], time: number) => at(time, () => picked.map((index) => ink(list.rows[index]!.name)))
        // Row 2 has the state, so it does not change again. Rows 1 and 4 change together, over the whole time.
        expect(names(log, [1], 1)).toEqual([green])
        expect(names(log, [0, 1, 3], 2.5)).toEqual([half, green, half])
        expect(names(log, [0, 3], 4)).toEqual([green, green])
        // With a lag of 1, the rows change in the order of the list, each in its third of the time.
        expect(names(lagging, [0, 1, 3], 1.5)).toEqual([half, purple, purple])
        expect(names(lagging, [0, 1, 3], 2.5)).toEqual([green, half, purple])
        expect(names(lagging, [0, 1, 3], 3.5)).toEqual([green, green, half])
        // A row that has the state takes no time: the two others have a half of the time each.
        expect(names(again, [0, 3], 1.75)).toEqual([half, purple])
        expect(names(again, [0, 3], 3.25)).toEqual([green, half])
    })

    it('takes its own states, starts a row in the first one, and draws a dim state dim', async () => {
        let log!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            const states = { done: { color: 'teal' }, running: { color: 'yellow' }, planned: { color: 'ink', dim: true } }
            log = s.add(eventLog([{ id: 1, name: 'model call', detail: 'plan' }, { id: 2, name: 'tool call', state: 'running' }, { id: 3, name: 'result', detail: 'later', state: 'planned' }], { states, visible: 8, size: 20 }))
            s.wait(1)
            s.play(log.mark(3, 'running'), { duration: 1, ease: linear })
            s.play(log.mark(1, 'planned'), { duration: 1, ease: linear })
            expect(() => log.mark(1, 'stored')).toThrow(/no state "stored"\. The states are done, running, planned/)
            expect(() => eventLog([{ id: 1, name: 'x', state: 'new' }], { states })).toThrow(/row 1 has the state "new"\. The states are done, running, planned/)
            expect(() => eventLog([], { states: {} })).toThrow(/give it at least one state/)
        }))
        const [first, second, third] = log.rows
        // A row with no state has the first state of the record.
        expect(at(1, () => [first, second, third].map((row) => ink(row!.name)))).toEqual(['teal', 'yellow', 'ink'].map((name) => parseColor(name)))
        expect([first, second, third].map((row) => markOf(row!, 1)[1])).toEqual(['teal', 'yellow', 'ink'].map((name) => parseColor(name)))
        // Each part of a dim row has an opacity of 0.4: the mark, the id, the name and the detail.
        expect(at(1, () => third!.parts.map((part) => part.get('opacity')))).toEqual([0.4, 0.4, 0.4, 0.4])
        expect(at(1, () => first!.parts.map((part) => part.get('opacity')))).toEqual([1, 1, 1, 1])
        expect(at(1.5, () => third!.parts.map((part) => part.get('opacity')))).toEqual([0.7, 0.7, 0.7, 0.7].map((value) => expect.closeTo(value, 6)))
        expect(at(2, () => [third!.name.get('opacity'), ink(third!.name)])).toEqual([1, parseColor('yellow')])
        expect(at(3, () => [first!.name.get('opacity'), first!.mark.get('opacity'), ink(first!.name)])).toEqual([0.4, 0.4, parseColor('ink')])
    })

    it('folds rows that follow each other into one line, and opens the line again', async () => {
        let log!: Log
        const during: { count: number; ids: (number | string)[]; rows: number } = { count: 0, ids: [], rows: 0 }
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(history, { visible: 8, size: 20 }))
            s.wait(1)
            // The ids can be in any order.
            s.play(log.fold([4, 2, 3], 'workflow task'), { duration: 1, ease: linear })
            Object.assign(during, { count: log.count, ids: log.ids, rows: log.rows.length })
            // A record in a fold has the line of the fold, and a connector to any of its ids goes to that line.
            expect(log.row(3)).toBe(log.rows[1])
            expect(log.row(2)).toBe(log.row(4))
            expect(log.p(3)).toEqual(log.p(2))
            expect(log.p(4, 'right')).toEqual([320, log.p(2)[1]])
            expect(log.p(3)[1]).toBeCloseTo(log.p(1)[1] + log.pitch, 6)
            expect(log.p(5)[1]).toBeCloseTo(log.p(1)[1] + 2 * log.pitch, 6)
            s.wait(1)
            expect([log.fold([5, 6], 'x').duration, log.unfold(2).duration]).toEqual([0.8, 0.8])
            // The id of an unfold is known by its text too.
            s.play(log.unfold('2'), { duration: 1, ease: linear })
            expect(log.row(3)).not.toBe(log.row(2))
        }))
        const P = log.pitch
        // The fold is one line of the window, and the list still has its seven records.
        expect(during).toEqual({ count: 7, ids: [1, 2, 3, 4, 5, 6, 7], rows: 5 })
        expect(seen(log, 1)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
        expect(seen(log, 2)).toEqual(['1', '2', '5', '6', '7'])
        // The line has the first id where the ids are, then "to" and the last id, then the name.
        const [fold] = folds(log, 2)
        expect(says(fold!)).toEqual(['2', 'to  4', 'workflow task', null, null])
        expect(fold!.idText.get('x')).toBe(line(log, 1).idText.get('x'))
        expect(fold!.range!.get('x')).toBe(line(log, 1).name.get('x'))
        // The name starts after the room of "to" and the longest id: five characters of 12 px, and 14 px.
        expect(fold!.name.get('x') - fold!.range!.get('x')).toBeCloseTo(5 * 12 + 14, 6)
        expect(right(fold!.range!)).toBeLessThan(fold!.name.bounds().x)
        // It has the state of its first row: the name and the three small dots of its mark have that color.
        expect(ink(fold!.name)).toEqual(parseColor('purple'))
        const dots = at(2, () => fold!.mark.children[0]!)
        expect(dots.children).toHaveLength(3)
        expect(dots.children.map((dot) => dot.get('fill'))).toEqual(Array(3).fill(parseColor('purple')))
        expect(fold!.mark.get('x')).toBe(line(log, 1).mark.get('x'))
        expect(fold!.mark.bounds().height).toBeLessThan(15)
        // It is where row 2 was, and the rows after it are two lines up.
        const y = (id: number, time: number) => at(time, () => line(log, id).get('y'))
        expect(at(2, () => fold!.get('y'))).toBeCloseTo(y(2, 1), 6)
        expect(y(5, 2)).toBeCloseTo(y(5, 1) - 2 * P, 6)
        expect(y(1, 2)).toBe(y(1, 1))
        // The rows go first, the others move after that, and the line comes where the rows were.
        expect(at(1.15, () => shows(line(log, 3)))).toBeCloseTo(0.5, 6)
        expect(at(1.3, () => shows(line(log, 3)))).toBe(0)
        // A row in a fold is hidden, so the bounds of the list skip it.
        expect(at(1.25, () => line(log, 3).get('visible'))).toBe(true)
        expect(at(1.3, () => line(log, 3).get('visible'))).toBe(false)
        expect(y(5, 1.15)).toBe(y(5, 1))
        expect(y(5, 1.45)).toBeCloseTo(y(5, 1) - P, 6)
        expect(at(1.3, () => shows(fold!))).toBe(0)
        expect(at(1.55, () => shows(fold!))).toBeCloseTo(0.5, 6)
        // After the unfold, the same rows are back at their places.
        expect(seen(log, 4)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
        for (const id of [1, 2, 3, 4, 5, 6, 7]) expect(y(id, 4)).toBeCloseTo(y(id, 1), 6)
        expect(at(4, () => shows(fold!))).toBe(0)
        // The rows of an unfold come last, when the rows under them have left their places.
        expect(at(3.6, () => shows(line(log, 3)))).toBe(0)
        expect(at(3.8, () => shows(line(log, 3)))).toBeCloseTo(0.5, 6)
        expect(y(5, 3.45)).toBeCloseTo(y(5, 1) - P, 6)
    })

    it('gives a fold the fields of a row: a detail, a time, a state and a family', async () => {
        let log!: Log
        const found: LogRow[] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            const rows: LogRow[] = [{ id: 1, name: 'WorkflowExecutionStarted', detail: 'order' }, ...some(2, 12)]
            log = s.add(eventLog(rows, { visible: 12, size: 20, width: 800, timeWidth: 84 }))
            s.play(seq(log.fold([2, 3], { name: 'pair', detail: 'two rows', time: '+0.10 s', state: 'answered', family: 'task' }), log.fold([9, 10, 11], 'three')), { duration: 1 })
            log.find((row) => { found.push(row); return false })
            // The names have the room that the longest of them needs. The name of a fold starts after its ids,
            // so it needs that much more: here the fold is whole, and its detail is in the column of the details.
            const longest = eventLog([{ id: 1, name: 'One', detail: 'a' }, { ids: [2, 3], name: 'a pair of rows', detail: 'two' }], { size: 20, width: 700 })
            expect(words(longest.rows[1]!.name)).toBe('a pair of rows')
            expect(longest.rows[1]!.detail!.get('x')).toBe(longest.rows[0]!.detail!.get('x'))
            expect(longest.rows[1]!.detail!.get('x') - right(longest.rows[1]!.name)).toBeGreaterThan(17)
            expect(longest.rows[1]!.detail!.get('x') - right(longest.rows[1]!.name)).toBeLessThan(20)
            // In a narrow column of names, the name of a fold has no room after its ids. It takes the room that
            // it needs, and its detail comes 18 px after it.
            const short = s.add(eventLog([{ id: 1, name: 'One', detail: 'a' }, { ids: [2, 3], name: 'a pair of rows', detail: 'two' }], { size: 20, width: 700, nameWidth: 100 }))
            const [row, fold] = short.rows
            expect(says(fold!)).toEqual(['2', 'to  3', 'a pair of rows', 'two', null])
            expect(fold!.detail!.get('x')).toBeGreaterThan(row!.detail!.get('x'))
            expect(fold!.detail!.get('x') - right(fold!.name)).toBeGreaterThan(17)
            expect(fold!.detail!.get('x') - right(fold!.name)).toBeLessThan(20)
        }))
        const [pair, three] = folds(log, 1)
        expect(says(pair!)).toEqual(['2', 'to  3', 'pair', 'two rows', '+0.10 s'])
        expect(says(three!)).toEqual(['9', 'to 11', 'three', null, null])
        // The last id ends where the longest id would end, so the names of the two folds start at one x.
        expect(pair!.name.get('x')).toBe(three!.name.get('x'))
        expect(ink(pair!.name)).toEqual(parseColor('green'))
        expect(ink(three!.name)).toEqual(parseColor('purple'))
        // A fold in a state with its own mark shows that mark, and a fold in a state with a dot has its three dots.
        expect(markOf(pair!, 1)).toEqual(['check', parseColor('green')])
        expect(markOf(three!, 1)[0]).toBe('dot')
        // The detail and the time of a fold are in the columns of the rows.
        expect(pair!.detail!.get('x')).toBe(line(log, 1).detail!.get('x'))
        expect(pair!.time!.get('x')).toBe(400 - 16)
        expect(Math.abs(right(pair!.time!) - (400 - 16))).toBeLessThan(3)
        // A function of `find()` gets a fold as one row, with its ids and its fields.
        expect(found[1]).toEqual({ id: 2, ids: [2, 3], name: 'pair', detail: 'two rows', time: '+0.10 s', state: 'answered', family: 'task' })
        expect(found[0]).toEqual({ id: 1, ids: [1], name: 'WorkflowExecutionStarted', detail: 'order', state: 'stored' })
        expect(found).toHaveLength(9)
    })

    it('builds a row that stands for several records, and opens it into its rows', async () => {
        let log!: Log
        const record = { ids: [2, 3, 4], name: 'workflow task', detail: 'worker 71293', family: 'task', rows: [
            { id: 2, name: 'WorkflowTaskScheduled', detail: 'queue orders' },
            { id: 3, name: 'WorkflowTaskStarted', detail: 'worker 71293', state: 'failed' },
            { id: 4, name: 'WorkflowTaskCompleted' },
        ] } satisfies LogRow
        let closed!: LogRowNode
        await compileFilm(film({ fps: 20 }, (s) => {
            // Each record of the film has `id` and `ids`. A list of one id is a row, and `id` is the first of the ids of a fold.
            log = s.add(eventLog([{ id: 1, ids: [1], name: 'WorkflowExecutionStarted' }, { id: 2, ...record }, { id: 5, name: 'ActivityTaskScheduled' }], { footer: (count) => `${count} events`, visible: 8, size: 20, width: 800 }))
            // The list counts records, not lines: three lines hold five records.
            expect(log.count).toBe(5)
            expect(log.ids).toEqual([1, 2, 3, 4, 5])
            expect(log.rows).toHaveLength(3)
            expect(says(log.rows[1]!)).toEqual(['2', 'to  4', 'workflow task', 'worker 71293', null])
            closed = log.rows[1]!
            // Any id of the fold gives its line and the ends of a connector to it.
            for (const id of [2, 3, 4]) {
                expect(log.row(id)).toBe(closed)
                expect(log.p(id, 'right')).toEqual([400, closed.get('y')])
            }
            expect(log.find((row) => row.family === 'task')).toEqual([2, 3, 4])
            s.wait(1)
            s.play(log.unfold(2), { duration: 1 })
            expect(log.rows.map(says)).toEqual([
                ['1', null, 'WorkflowExecutionStarted', null, null],
                ['2', null, 'WorkflowTaskScheduled', 'queue orders', null],
                ['3', null, 'WorkflowTaskStarted', 'worker 71293', null],
                ['4', null, 'WorkflowTaskCompleted', null, null],
                ['5', null, 'ActivityTaskScheduled', null, null],
            ])
            // A row of a fold has the state and the family of the fold, unless it has its own.
            expect(log.rows.map((row) => ink(row.name))).toEqual(['purple', 'purple', 'red', 'purple', 'purple'].map((name) => parseColor(name)))
            expect(log.find((row) => row.family === 'task')).toEqual([2, 3, 4])
            expect(log.count).toBe(5)
            s.wait(1)
            // With no label, `fold` closes a fold that `unfold` opened: the same line comes back.
            s.play(log.fold([2, 3, 4]), { duration: 1 })
            expect(log.rows[1]).toBe(closed)
            expect(log.rows).toHaveLength(3)
            // An append takes a fold too, and counts its records.
            s.play(log.append({ ids: [6, 7], name: 'pair', rows: [{ id: 6, name: 'Six' }, { id: 7, name: 'Seven' }] }), { duration: 1 })
            expect(log.count).toBe(7)
            expect(log.ids).toEqual([1, 2, 3, 4, 5, 6, 7])
            s.play(log.unfold(6), { duration: 1 })
            expect(log.rows.slice(3).map(says)).toEqual([['6', null, 'Six', null, null], ['7', null, 'Seven', null, null]])
            s.play(log.fold([6, 7]), { duration: 0 })
            // Rows that were never a fold need a label, and so does a part of a fold that was open.
            expect(() => s.play(log.fold([1, 5]))).toThrow(/row 2 is between 1 and 5 and not in the fold/)
            s.play(log.unfold(6), { duration: 0 })
            expect(() => s.play(log.fold([5, 6]))).toThrow(/the fold from 5 to 6 needs a label, such as fold\(\[5, 6\], 'workflow task'\)\. Only a fold that unfold\(\) opened closes with no label/)
            s.play(log.unfold(2), { duration: 0 })
            expect(() => s.play(log.fold([2, 3]))).toThrow(/the fold from 2 to 3 needs a label/)
            s.play(log.fold([2, 3, 4]), { duration: 0 })
            // The rows of a fold with a state have that state, and a fold of rows has the state of its first row.
            const stated = s.add(eventLog([
                { ids: [1, 2], name: 'pair', state: 'waiting', rows: some(1, 2) },
                { ids: [3, 4, 5], name: 'three', state: 'waiting', rows: [{ id: 3, name: 'Three' }, { id: 4, name: 'Four', state: 'answered' }, { id: 5, name: 'Five' }] },
                { id: 6, name: 'Six', state: 'failed' }, { id: 7, name: 'Seven', state: 'answered' },
            ], { size: 20 }))
            s.play(seq(stated.unfold(1), stated.unfold(3), stated.fold([6, 7], 'two')), { duration: 0 })
            expect(stated.rows.map((row) => ink(row.name))).toEqual(['yellow', 'yellow', 'yellow', 'green', 'yellow', 'red'].map((name) => parseColor(name)))
            expect(stated.find((row) => row.state === 'failed')).toEqual([6, 7])
        }))
        expect(seen(log, 0.5)).toEqual(['1', '2', '5'])
        expect(seen(log, 2)).toEqual(['1', '2', '3', '4', '5'])
        expect(seen(log, 4)).toEqual(['1', '2', '5'])
        expect(at(4, () => shows(closed))).toBe(1)
        expect(said(log.footer!, 0.5)).toEqual(['5 events'])
        expect(said(log.footer!, 5)).toEqual(['7 events'])
    })

    it('refuses to open a fold that has no rows, and counts its records all the same', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            const log = s.add(eventLog([{ id: 1, name: 'One' }, { ids: [5, 6, 7, 8, 9, 10], name: 'activity' }, { id: 11, name: 'Eleven' }], { size: 20 }))
            // Six rows with the name of the fold would say that the fold holds six records of one kind.
            expect(() => s.play(log.unfold(5))).toThrow(/the fold from 5 to 10 has no rows to open into\. Give it `rows`, one for each id, where the fold is made/)
            expect(log.count).toBe(8)
            expect(log.ids).toEqual([1, 5, 6, 7, 8, 9, 10, 11])
            expect(log.rows).toHaveLength(3)
            for (const id of [5, 7, 10]) expect(log.p(id)).toEqual(log.p(5))
            // A refused unfold takes no time from the list: the next change is free.
            s.play(log.append(some(12, 12)))
            // A fold that the film makes from rows has them, and opens.
            s.play(log.fold([11, 12], 'pair'))
            s.play(log.unfold(11))
            expect(log.rows.map((row) => words(row.idText))).toEqual(['1', '5', '11', '12'])
        }))
    })

    it('marks one record in a closed fold: the fold shows it, and each record has its own state when the fold opens', async () => {
        let log!: Log
        const found: LogRow[][] = [], states: (number | string)[][] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog([{ id: 1, name: 'One' }, { ids: [5, 6, 7, 8], name: 'activity', rows: some(5, 8) }, { id: 9, name: 'Nine' }], { visible: 8, size: 20 }))
            s.wait(1)
            // A replay answers one event. The fold shows the look of the record that was marked last.
            s.play(log.mark(7, 'answered'), { duration: 1, ease: linear })
            s.play(log.mark(6, 'failed'), { duration: 1, ease: linear })
            found.push(log.find((row) => row.state === 'failed').map((id) => ({ id, name: '' })))
            // The line of the guide: the ids that `find` gives name each record of the fold, so the mark changes them all.
            s.play(log.mark(log.find((row) => row.state === 'failed'), 'stored'), { duration: 0 })
            states.push(log.find((row) => row.state === 'stored'))
            s.play(seq(log.mark(7, 'answered'), log.mark(6, 'failed')), { duration: 0 })
            s.play(log.unfold(5), { duration: 1 })
            s.play(log.fold([5, 6, 7, 8]), { duration: 1 })
            // A function sees the fold as one row. A fold that it picks takes the state with all its records.
            s.play(log.mark((row) => row.ids!.length === 4, 'waiting'), { duration: 1, ease: linear })
            s.play(log.unfold(5), { duration: 1 })
            // The whole fold by its ids: each record takes the state.
            s.play(log.fold([5, 6, 7, 8]), { duration: 0 })
            s.play(log.mark([5, 6, 7, 8], 'answered'), { duration: 0 })
            s.play(log.unfold(5), { duration: 1 })
        }))
        const [purple, green, red, yellow] = ['purple', 'green', 'red', 'yellow'].map((name) => parseColor(name))
        const [fold] = folds(log, 1)
        // The name and the mark of the fold cross-fade to the look of the answer.
        expect(at(1.5, () => ink(fold!.name))).toEqual(mixColor(purple!, green!, 0.5))
        expect(markOf(fold!, 2)).toEqual(['check', green])
        expect(at(2, () => [1, 9].map((id) => ink(line(log, id).name)))).toEqual([purple, purple])
        expect(markOf(fold!, 3)).toEqual(['cross', red])
        // `find` gives each id of the fold. After `mark(find(...), 'stored')`, each of its records is stored again: also record 7.
        expect(found[0]!.map((row) => row.id)).toEqual([5, 6, 7, 8])
        expect(states[0]).toEqual([1, 5, 6, 7, 8, 9])
        // Open: 5 and 8 are as they were, 6 failed, 7 answered.
        expect(at(4, () => [5, 6, 7, 8].map((id) => [shows(line(log, id)), ink(line(log, id).name)]))).toEqual([[1, purple], [1, red], [1, green], [1, purple]])
        expect([5, 6, 7, 8].map((id) => markOf(line(log, id), 4)[0])).toEqual(['dot', 'cross', 'check', 'dot'])
        // Closed again, the fold has the look that it had.
        expect(markOf(fold!, 5)).toEqual(['cross', red])
        expect(markOf(fold!, 6)).toEqual(['ring', yellow])
        expect(at(6.95, () => [5, 6, 7, 8].map((id) => ink(line(log, id).name)))).toEqual([yellow, yellow, yellow, yellow])
        expect(at(8, () => [5, 6, 7, 8].map((id) => ink(line(log, id).name)))).toEqual([green, green, green, green])
    })

    it('finds the rows that a function picks, by their fields and their family', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            const log = s.add(eventLog([
                { id: 1, name: 'WorkflowExecutionStarted', family: 'workflow' },
                { ids: [2, 3, 4], name: 'workflow task', family: 'task' },
                { id: 5, name: 'ActivityTaskScheduled', detail: 'chargeCard', family: 'activity' },
                { id: 6, name: 'ActivityTaskStarted', family: 'activity', state: 'waiting' },
                { ids: [7, 8, 9], name: 'workflow task', family: 'task' },
            ], { visible: 8, size: 20, width: 800 }))
            // In the order of the list: one id for a row, and each id of a fold.
            expect(log.find((row) => row.family === 'activity')).toEqual([5, 6])
            expect(log.find((row) => row.family === 'task')).toEqual([2, 3, 4, 7, 8, 9])
            expect(log.find((row) => row.state === 'waiting')).toEqual([6])
            expect(log.find((row) => row.detail === 'chargeCard' && row.id === 5)).toEqual([5])
            expect(log.find(() => false)).toEqual([])
            // The ids go to `mark`, `row`, `p` and `focus`.
            s.play(log.mark(log.find((row) => row.family === 'task'), 'answered'))
            expect(log.find((row) => row.state === 'answered')).toEqual([2, 3, 4, 7, 8, 9])
            expect([...new Set(log.find((row) => row.family === 'task').map((id) => log.p(id)[1]))]).toEqual([log.row(3).get('y'), log.row(8).get('y')])
            // The answer follows the changes that the film has played.
            s.play(log.append({ id: 10, name: 'ActivityTaskCompleted', family: 'activity' }))
            expect(log.find((row) => row.family === 'activity')).toEqual([5, 6, 10])
        }))
    })

    it('draws the times in a column at the right, when a first row has a time', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            const rows: LogRow[] = [
                { id: 1, name: 'ActivityTaskScheduled', detail: 'a detail that is long enough to reach the times', time: '+0.13 s' },
                { id: 2, name: 'ActivityTaskStarted', detail: 'attempt 1' },
                { id: 3, name: 'ActivityTaskCompleted', detail: '"ch_1002"', time: '+12.01 s' },
            ]
            const log = s.add(eventLog(rows, { size: 20, width: 700 }))
            const [first, second, third] = log.rows
            // A time ends where the content of the panel ends, 16 px from the border. So the digits of two times are one over the other.
            expect([words(first!.time), second!.time, words(third!.time)]).toEqual(['+0.13 s', null, '+12.01 s'])
            expect(first!.time!.get('x')).toBe(350 - 16)
            expect(third!.time!.get('x')).toBe(350 - 16)
            expect(Math.abs(right(third!.time!) - (350 - 16))).toBeLessThan(3)
            // It is dim, as the id is, and in mono: each character has the same room.
            expect(ink(first!.time!)).toEqual(ink(first!.idText))
            expect(third!.time!.bounds().width).toBeGreaterThan(7 * 12)
            expect(third!.time!.bounds().width).toBeLessThan(8 * 12)
            // The column has the room of the longest time, and the details end 18 px before it.
            const times = 350 - 16 - 8 * 12
            expect(words(first!.detail).endsWith('…')).toBe(true)
            expect(right(first!.detail!)).toBeLessThanOrEqual(times - 18)
            expect(right(first!.detail!)).toBeGreaterThan(times - 18 - 20)
            // With no time in the first rows, the list has no such column, and a detail goes on to the end.
            const plain = eventLog(rows.map(({ time: _time, ...row }) => row as LogRow), { size: 20, width: 700 })
            expect(plain.rows[0]!.time).toBeNull()
            expect(right(plain.rows[0]!.detail!)).toBeGreaterThan(times)
            expect(() => plain.append({ id: 4, name: 'Late', time: '+1 s' })).toThrow(/row 4 has the time "\+1 s", and the list has no column for times\. Give a time to one of the first rows, or set `timeWidth` to 48 or more/)
            // A time that is wider than the column is refused. `timeWidth` gives the room, also to a list that starts with no time.
            expect(() => log.append({ id: 4, name: 'Late', time: '+120.01 s' })).toThrow(/the time "\+120\.01 s" is 108 px wide, and the times have 96 px\. Set `timeWidth` to 108 or more/)
            const roomy = s.add(eventLog([], { size: 20, width: 900, timeWidth: 108 }))
            s.play(roomy.append({ id: 4, name: 'Late', detail: 'a detail that is long enough to reach the times, by far', time: '+120.01 s' }))
            expect(words(roomy.rows[0]!.time)).toBe('+120.01 s')
            expect(right(roomy.rows[0]!.detail!)).toBeLessThanOrEqual(450 - 16 - 108 - 18)
            expect(right(roomy.rows[0]!.detail!)).toBeGreaterThan(450 - 16 - 108 - 18 - 20)
            expect(() => eventLog([], { timeWidth: -1 })).toThrow(/timeWidth is the room of the times, 0 or more/)
            // The time of a row of a fold counts for the column, and shows when the fold opens.
            const folded = s.add(eventLog([{ ids: [1, 2], name: 'pair', rows: [{ id: 1, name: 'One', time: '+0.10 s' }, { id: 2, name: 'Two' }] }], { size: 20, width: 700 }))
            s.play(folded.unfold(1))
            expect(folded.rows.map((row) => (row.time ? words(row.time) : null))).toEqual(['+0.10 s', null])
            // A number is taken as its text, for a detail and for a time.
            const numbers = eventLog([{ id: 1, name: 'ActivityTaskStarted', detail: 3, time: 12.5 }, { id: 2, name: 'Zero', detail: 0 }], { size: 20, width: 700 })
            expect(numbers.rows.map(says)).toEqual([['1', null, 'ActivityTaskStarted', '3', '12.5'], ['2', null, 'Zero', '0', null]])
            expect(numbers.find((row) => row.detail === '3')).toEqual([1])
            expect(() => eventLog([{ id: 1, name: 'x', detail: { text: 'no' } as never }])).toThrow(/the detail of row 1 is \{"text":"no"\}\. Give a text or a number/)
        }))
    })

    it('brings rows back from above when a fold makes room in a full window, and takes the count away when the list fits', async () => {
        let log!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 8), { visible: 5, size: 20 }))
            s.wait(1)
            s.play(log.fold([6, 7], 'pair'), { duration: 1, ease: linear })
            s.play(log.fold([1, 2, 3], 'three'), { duration: 1, ease: linear })
            s.play(log.unfold(1), { duration: 1, ease: linear })
        }))
        const P = log.pitch
        expect(seen(log, 1)).toEqual(['5', '6', '7', '8'])
        expect(said(log.earlier, 1)).toEqual(['4 earlier'])
        // The rows after the fold stay, and the row above comes down from under the count: one more row shows.
        expect(seen(log, 2)).toEqual(['4', '5', '6', '8'])
        expect(said(log.earlier, 2)).toEqual(['3 earlier'])
        expect(at(2, () => line(log, 8).get('y'))).toBe(at(1, () => line(log, 8).get('y')))
        expect(at(2, () => line(log, 5).get('y'))).toBeCloseTo(at(1, () => line(log, 5).get('y')) + P, 6)
        expect(at(1.45, () => line(log, 5).get('y') - line(log, 4).get('y'))).toBeCloseTo(P, 6)
        // Rows 1 to 3 fold above the window. Five lines are left, so they all show, and the count goes.
        expect(seen(log, 3)).toEqual(['1', '4', '5', '6', '8'])
        expect(said(log.earlier, 3)).toEqual([])
        // The fold opens above the window: the list is full again, and the count is back.
        expect(seen(log, 4)).toEqual(['4', '5', '6', '8'])
        expect(said(log.earlier, 4)).toEqual(['3 earlier'])
        expect(log.rows.map((row) => words(row.idText))).toEqual(['4', '5', '6', '8'])
        // Two rows are above a window of five lines. A fold of two rows makes room for both, and the count goes.
        // Row 2 comes down from the line of the count: no frame shows the two together.
        let tight!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            tight = s.add(eventLog(some(1, 6), { visible: 5, size: 20 }))
            s.play(tight.fold([5, 6], 'pair'), { duration: 2 })
        }))
        expect(seen(tight, 2)).toEqual(['1', '2', '3', '4', '5'])
        for (let step = 0; step <= 40; step++) {
            const [count, row] = at(step / 20, () => [shows(tight.earlier), shows(line(tight, 2))])
            expect(Math.min(count!, row!)).toBe(0)
        }
        expect(at(0.5, () => shows(tight.earlier))).toBeGreaterThan(0)
        expect(at(2, () => [tight.earlier.get('visible'), shows(line(tight, 2))])).toEqual([false, 1])
    })

    it('moves the window to a row with scrollTo, with a count of the rows above and of the rows under', async () => {
        let log!: Log
        const rows: string[][] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 20), { footer: (count) => `${count} events`, visible: 6, size: 20 }))
            s.wait(1)
            // A row that was above is the first row of the window.
            s.play(log.scrollTo(7), { duration: 1, ease: linear })
            rows.push(log.rows.map((row) => words(row.idText)))
            // A row that shows moves nothing, and a focus or a mark of it needs no scroll.
            s.play(log.scrollTo(9), log.focus(9), log.mark(9, 'answered'), { duration: 1 })
            // A mark of a row that is out of the window changes its state, and moves nothing. A focus of it is an error that names the way.
            s.play(log.mark(18, 'failed'), { duration: 0 })
            expect(() => s.play(log.focus(18))).toThrow(/row 18 is out of the window, which shows the rows 7 to 10\. Bring it in with scrollTo\(18\), named before this call in the play, or raise `visible`/)
            // A row that was under is the last row, over the count of the rows that are still under it.
            s.play(log.scrollTo(13), { duration: 1, ease: linear })
            rows.push(log.rows.map((row) => words(row.idText)))
            // The first row of the list: no row is above, so the first line is a row.
            s.play(log.scrollTo(1), { duration: 1 })
            rows.push(log.rows.map((row) => words(row.idText)))
            // A fold keeps the window where the film put it.
            s.play(log.fold([2, 3], 'pair'), { duration: 1 })
            rows.push(log.rows.map((row) => words(row.idText)))
            // An append brings the window back to the end first, in the first 0.3 of its time.
            s.play(log.append(some(21, 21)), { duration: 2, ease: linear })
            rows.push(log.rows.map((row) => words(row.idText)))
            // The last row brings the window to the end, with no count under it.
            s.play(log.scrollTo(1), { duration: 0 })
            s.play(log.scrollTo(21), { duration: 1 })
            rows.push(log.rows.map((row) => words(row.idText)))
            expect(log.scrollTo(1).duration).toBe(0.8)
            const small = s.add(eventLog(some(1, 5), { visible: 2, size: 20 }))
            expect(() => s.play(small.scrollTo(2))).toThrow(/scrollTo needs a window of 3 lines or more: one for each count, and one for the row\. This window has 2\. Raise `visible`/)
            expect(() => s.play(log.scrollTo(99))).toThrow(/no row has the id 99/)
        }))
        const P = log.pitch
        expect(rows).toEqual([['7', '8', '9', '10'], ['10', '11', '12', '13'], ['1', '2', '3', '4', '5'], ['1', '2', '4', '5', '6'], ['17', '18', '19', '20', '21'], ['17', '18', '19', '20', '21']])
        // At the end of the list, the first line counts the rows above, and no line counts under.
        expect(seen(log, 1)).toEqual(['16', '17', '18', '19', '20'])
        expect([said(log.earlier, 1), said(log.later, 1)]).toEqual([['15 earlier'], []])
        // After the scroll: six rows above, four rows in the window, ten rows under. The count under is in the last line.
        expect(seen(log, 2)).toEqual(['7', '8', '9', '10'])
        expect([said(log.earlier, 2), said(log.later, 2)]).toEqual([['6 earlier'], ['10 later']])
        expect(log.later.get('y') - log.earlier.get('y')).toBeCloseTo(5 * P, 6)
        expect(at(2, () => line(log, 7).get('y'))).toBeCloseTo(log.earlier.get('y') + P, 6)
        expect(at(2, () => line(log, 10).get('y'))).toBeCloseTo(log.later.get('y') - P, 6)
        // A long way: the old rows leave under, the new ones come from above, and no row between them flies past.
        for (let step = 0; step <= 20; step++) {
            const shown = at(1 + step / 20, () => made(log).filter((node) => shows(node) > 0).map((node) => Number(words(node.idText))))
            for (const id of shown) expect(id <= 10 || id >= 16).toBe(true)
            // The old rows are still leaving when the new ones come: the window is never empty.
            expect(at(1 + step / 20, () => Math.max(...made(log).map((node) => shows(node))))).toBeGreaterThan(0.2)
        }
        // The count under comes in the second half of the way, where the last row was.
        expect(at(1.5, () => shows(log.later))).toBe(0)
        expect(at(1.75, () => shows(log.later))).toBeCloseTo(0.5, 6)
        // No row moved for the row that showed, and the outline is on it.
        expect(seen(log, 3)).toEqual(['7', '8', '9', '10'])
        expect(at(3, () => shows(log.outline))).toBe(1)
        expect(at(3, () => ink(line(log, 9).name))).toEqual(parseColor('green'))
        // A short way: the rows move as one, three lines up.
        expect(seen(log, 4)).toEqual(['10', '11', '12', '13'])
        expect([said(log.earlier, 4), said(log.later, 4)]).toEqual([['9 earlier'], ['7 later']])
        expect(at(3.5, () => line(log, 10).get('y') - line(log, 9).get('y'))).toBeCloseTo(P, 6)
        expect(at(3.5, () => line(log, 10).get('y'))).toBeCloseTo(log.earlier.get('y') + 2.5 * P, 6)
        // Row 9 left the window, and the outline left with it.
        expect(at(4, () => shows(log.outline))).toBe(0)
        // At the first row of the list, the first line is a row, and the last line counts the rows under.
        expect(seen(log, 5)).toEqual(['1', '2', '3', '4', '5'])
        expect([said(log.earlier, 5), said(log.later, 5)]).toEqual([[], ['15 later']])
        expect(at(5, () => line(log, 1).get('y'))).toBeCloseTo(log.earlier.get('y'), 6)
        expect(seen(log, 6)).toEqual(['1', '2', '4', '5', '6'])
        expect(said(log.later, 6)).toEqual(['14 later'])
        // The append: the window is at the end after 0.6 s, and the row arrives in the 1.4 s that are left.
        expect(seen(log, 6.6)).toEqual(['16', '17', '18', '19', '20'])
        expect([said(log.earlier, 6.6), said(log.later, 6.6)]).toEqual([['15 earlier'], []])
        // The row that was marked while it was out of the window has its state when it shows.
        expect(seen(log, 7.95)).toEqual(['17', '18', '19', '20', '21'])
        expect(at(7.95, () => ink(line(log, 18).name))).toEqual(parseColor('red'))
        expect(said(log.footer!, 7.95)).toEqual(['21 events'])
        expect(seen(log, 9)).toEqual(['17', '18', '19', '20', '21'])
        expect([said(log.earlier, 9), said(log.later, 9)]).toEqual([['16 earlier'], []])
    })

    it('gives the node and the two ends of a row, and rests a row that left on the count that stands for it', async () => {
        let log!: Log, far!: Log, jump!: Log
        let kept!: LogRowNode, low!: LogRowNode
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 6), { visible: 5, size: 20, width: 500 }).at(100, 50))
            const node = log.row(4)
            expect(node).toBeInstanceOf(LogRowNode)
            expect(words(node.idText)).toBe('4')
            expect(log.rows).toContain(node)
            // The ends are on the border of the panel, at the middle height of the row, in the coordinates of the list.
            expect(log.p(4)).toEqual([-250, node.get('y')])
            expect(log.p(4, 'left')).toEqual(log.p(4))
            expect(log.p(4, 'right')).toEqual([250, node.get('y')])
            const frame = log.frame.bounds(), [x, y] = log.toWorld(...log.p(4, 'right'))
            expect(x).toBeCloseTo(frame.x + frame.width, 6)
            expect(y).toBeCloseTo(node.bounds().y + node.bounds().height / 2, 0)
            expect(log.p('4')).toEqual(log.p(4))
            // Rows 1 and 2 are above the window from the start.
            expect(() => log.row(2)).toThrow(/row 2 is out of the window, which shows the rows 3 to 6\. Bring it in with scrollTo\(2\), or raise `visible`/)
            expect(() => log.p(1)).toThrow(/row 1 is out of the window/)
            expect(() => log.row(9)).toThrow(/no row has the id 9\. The list has the ids 1 to 6/)
            expect(() => eventLog([...some(1, 6), { ids: [7, 8], name: 'pair' }], { visible: 5, size: 20 }).row(1)).toThrow(/row 1 is out of the window, which shows the rows 4 to 8\./)
            // `p()` is the place after the changes that the film has played. It does not follow the row: after one more
            // row, row 3 is out and row 4 is one line up, and the point that the film took before is the place of row 5.
            const before = log.p(4)
            kept = log.row(3)
            s.play(log.append(some(7, 7)), { duration: 1 })
            expect(log.p(4)[1]).toBeCloseTo(before[1] - log.pitch, 6)
            expect(log.p(5)).toEqual(before)
            expect(() => log.p(3)).toThrow(/row 3 is out of the window/)
            expect(log.row(7)).toBe(log.rows[3])
            // A list at its first rows: the rows that leave go under the window.
            far = s.add(eventLog(some(1, 12), { visible: 5, size: 20 }))
            s.play(far.scrollTo(1), { duration: 1 })
            low = far.row(4)
            s.play(far.scrollTo(8), { duration: 1 })
            s.play(far.append(some(13, 13)), { duration: 1 })
            jump = s.add(eventLog(some(1, 12), { visible: 5, size: 20 }))
            s.play(jump.scrollTo(1), { duration: 1 })
        }))
        // The node of a row that left rests on the line of the count, in the panel: a connector to it ends on "N earlier",
        // and not on another row.
        expect(at(1, () => [kept.get('visible'), kept.get('y')])).toEqual([false, log.earlier.get('y')])
        // On its way out and on its way in, the node goes no further than that line. So a connector to it ends in the panel at every frame.
        for (let step = 0; step <= 60; step++) {
            for (const node of [low, line(far, 12), line(far, 9), line(far, 7), line(far, 1)]) {
                const y = at(1 + step / 20, () => node.get('y'))
                expect(y).toBeGreaterThanOrEqual(far.earlier.get('y') - 1e-6)
                expect(y).toBeLessThanOrEqual(far.later.get('y') + 1e-6)
            }
        }
        // A row that comes back moves with the others too: rows 6 and 7 come from under, one line apart.
        expect(at(2.8, () => [shows(line(far, 7)) > 0, line(far, 7).get('y') - line(far, 6).get('y')])).toEqual([true, expect.closeTo(far.pitch, 6)])
        // While a row shows, it moves with the others: row 4 is one line under row 3 on their way up.
        expect(at(2.2, () => [shows(low), low.get('y') - line(far, 3).get('y')])).toEqual([1, expect.closeTo(far.pitch, 6)])
        // Under the window it rests on the last line, and above the window on the first.
        expect(at(2, () => [low.get('visible'), low.get('y')])).toEqual([true, expect.closeTo(far.earlier.get('y') + 3 * far.pitch, 6)])
        expect(at(3, () => [low.get('visible'), low.get('y')])).toEqual([false, far.earlier.get('y')])
        const under = line(far, 12)
        expect(at(2.95, () => [under.get('visible'), under.get('y')])).toEqual([false, far.later.get('y')])
        // Row 6 was above the window, and the window went past it to the first rows: it rests on the count under.
        expect(at(4.5, () => [line(jump, 6).get('visible'), line(jump, 6).get('y')])).toEqual([false, jump.earlier.get('y')])
        expect(at(5, () => [line(jump, 6).get('visible'), line(jump, 6).get('y')])).toEqual([false, jump.later.get('y')])
        expect(at(4, () => shows(under))).toBe(1)
    })

    it('moves the outline of the focus to a row, to another row, and away', async () => {
        let log!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(history, { visible: 8, size: 20, width: 600 }))
            s.wait(1)
            s.play(log.focus(2), { duration: 1, ease: linear })
            s.play(log.focus(5), { duration: 1, ease: linear })
            s.play(log.focus(5), { duration: 1, ease: linear })
            s.play(log.focus(null), { duration: 1, ease: linear })
            s.wait(1)
            s.play(log.focus(null), log.focus('7'), { duration: 1, ease: linear })
            s.play(log.focus(null), log.focus(1), { duration: 1, ease: linear })
            expect(log.focus(1).duration).toBe(0.4)
        }))
        const outline = log.outline, y = (id: number) => line(log, id).get('y')
        // The outline is at the middle of the ink of its row, which is a little under the middle of the row.
        const lift = at(2, () => outline.get('y')) - y(2)
        expect(Math.abs(lift)).toBeLessThan(1)
        expect(at(0.5, () => shows(outline))).toBe(0)
        // It fades in around the row: as wide as the panel less a margin, and one row tall.
        const on = (time: number) => at(time, () => [shows(outline), outline.get('y') - lift])
        expect(on(1.5)).toEqual([0.5, expect.closeTo(y(2), 6)])
        expect(on(2)).toEqual([1, expect.closeTo(y(2), 6)])
        const box = at(2, () => outline.bounds()), row = at(2, () => line(log, 2).bounds())
        expect([box.width, box.height]).toEqual([expect.closeTo(600 - 12.8, 6), expect.closeTo(log.pitch, 6)])
        expect(box.x).toBeLessThan(row.x)
        expect(box.x + box.width).toBeGreaterThan(row.x + row.width)
        expect(box.y).toBeLessThan(row.y)
        expect(box.y + box.height).toBeGreaterThan(row.y + row.height)
        expect(at(2, () => [outline.get('stroke'), outline.get('fill')])).toEqual([parseColor('yellow'), null])
        // On its way to row 5, three rows down, it goes out at the first row and comes in at the second. It is
        // never between the two, so it crosses no text.
        for (let step = 0; step <= 20; step++) {
            const [opacity, place] = on(2 + step / 20)
            expect(opacity).toBeCloseTo(Math.abs(step - 10) / 10, 6)
            expect(place).toBeCloseTo(step < 10 ? y(2) : y(5), 6)
        }
        expect(on(3)).toEqual([1, expect.closeTo(y(5), 6)])
        // A focus on the row that has it changes nothing.
        expect(on(3.5)).toEqual([1, expect.closeTo(y(5), 6)])
        expect(at(4.5, () => shows(outline))).toBeCloseTo(0.5, 6)
        expect(at(5, () => shows(outline))).toBe(0)
        // It is hidden then, so the bounds of the list are those of its panel.
        expect(at(4.9, () => outline.get('visible'))).toBe(true)
        expect(at(5.5, () => outline.get('visible'))).toBe(false)
        // After `focus(null)`, the outline comes in at the row. It does not come from the row before.
        expect(on(6.5)).toEqual([0.5, expect.closeTo(y(7), 6)])
        // `focus(null)` forgets its row, also in a play with the next focus: the outline comes in at row 1 from nothing.
        expect(on(7.25)).toEqual([0.25, expect.closeTo(y(1), 6)])
        expect(on(7.75)).toEqual([0.75, expect.closeTo(y(1), 6)])
    })

    it('keeps the outline with its row at every frame: before a scroll, in the same play, and when the row leaves', async () => {
        let log!: Log
        const film_ = film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 5), { title: 'log', footer: (count) => `${count} rows`, visible: 5, size: 20 }))
            s.wait(1)
            // A film lights a row as it arrives: the focus is in the play of the append.
            s.play(log.append(some(6, 6)), log.focus(6), { duration: 1, ease: linear })
            // The outline goes away while two rows arrive: it fades at its row, which moves.
            s.play(log.focus(null), log.append(some(7, 8)), { duration: 2, ease: linear })
            // A focus, and then a scroll in a later play.
            s.play(log.focus(6), { duration: 0.5 })
            s.play(log.append(some(9, 9)), { duration: 1 })
            s.play(log.append(some(10, 10)), { duration: 1, ease: linear })
            expect(() => log.focus(6)).not.toThrow()
            expect(() => s.play(log.focus(6))).toThrow(/row 6 is out of the window, which shows the rows 7 to 10/)
            s.play(log.focus(10), { duration: 1, ease: linear })
            // A focus before the append in the play: the outline goes from one row to another while both move.
            s.play(log.focus(9), log.append(some(11, 11)), { duration: 1, ease: linear })
        })
        await compileFilm(film_)
        const outline = log.outline, P = log.pitch, top = log.earlier.get('y')
        const lift = at(2, () => outline.get('y') - line(log, 6).get('y'))
        // The outline arrives with the row: at the place of the row at every frame, and no stronger than the row.
        const six = line(log, 6)
        for (let step = 0; step <= 20; step++) {
            const time = 1 + step / 20
            expect(at(time, () => outline.get('y') - lift)).toBeCloseTo(at(time, () => six.get('y')), 6)
            expect(at(time, () => shows(outline))).toBeCloseTo(at(time, () => shows(six)) * (step / 20), 6)
        }
        expect(at(1.5, () => (six.get('y') - top) / P)).toBeCloseTo(4.5, 6)
        expect(at(1.5, () => shows(outline))).toBe(0)
        expect(at(1.8, () => shows(outline))).toBeCloseTo(0.8 * (1 - 0.15 / 0.35), 6)
        expect(at(2, () => [shows(outline), (outline.get('y') - lift - top) / P])).toEqual([1, expect.closeTo(4, 6)])
        // It fades at its row, which goes up two lines in the same play.
        for (let step = 0; step <= 40; step++) {
            const time = 2 + step / 20
            expect(at(time, () => outline.get('y') - lift)).toBeCloseTo(at(time, () => six.get('y')), 6)
            expect(at(time, () => shows(outline))).toBeCloseTo(1 - step / 40, 6)
        }
        expect(at(3, () => (outline.get('y') - lift - top) / P)).toBeCloseTo(3, 6)
        // The outline has the place of its row at every frame of a later scroll.
        for (let step = 0; step <= 20; step++) expect(at(4.5 + step / 20, () => outline.get('y') - lift)).toBeCloseTo(at(4.5 + step / 20, () => six.get('y')), 6)
        expect(at(5.5, () => (six.get('y') - top) / P)).toBeCloseTo(1, 6)
        expect(at(5.5, () => shows(outline))).toBe(1)
        // Row 6 leaves with the next row, and the outline fades with it.
        for (let step = 0; step < 20; step++) expect(at(5.5 + step / 20, () => [outline.get('y') - lift, shows(outline)])).toEqual(at(5.5 + step / 20, () => [expect.closeTo(six.get('y'), 6), expect.closeTo(shows(six), 6)]))
        expect(at(6, () => shows(outline))).toBeLessThan(0.5)
        expect(at(6.5, () => shows(outline))).toBe(0)
        // The next focus starts from nothing: the outline comes in at the row.
        expect(at(7, () => [shows(outline), outline.get('y') - lift - line(log, 10).get('y')])).toEqual([0.5, expect.closeTo(0, 6)])
        // The focus before the append in the play: the outline goes out at row 10 and comes in at row 9, and both rows move.
        const [nine, ten] = [line(log, 9), line(log, 10)]
        expect(at(7.75, () => [outline.get('y') - lift, shows(outline)])).toEqual(at(7.75, () => [expect.closeTo(ten.get('y'), 6), 0.5]))
        expect(at(7.75, () => (ten.get('y') - top) / P)).toBeCloseTo(3.75, 6)
        expect(at(8.25, () => [outline.get('y') - lift, shows(outline)])).toEqual(at(8.25, () => [expect.closeTo(nine.get('y'), 6), 0.5]))
        expect(at(8.5, () => [shows(outline), (outline.get('y') - lift - top) / P])).toEqual([1, expect.closeTo(2, 6)])
        // The film check finds no line through a text, and no text on a text, at any frame.
        const report = await checkFilm(film_, { motion: true, readingSpeed: 0 })
        expect(report.diagnostics).toEqual([])
        // A row in the line that a count takes fades where it is, and the rows under it pass its place. The
        // outline is taller than the text, so it is gone before the next row reaches it.
        let full!: Log
        const passing = film({ fps: 20 }, (s) => {
            full = s.add(eventLog(some(1, 5), { visible: 5, size: 20 }))
            s.play(full.focus(1), { duration: 0 })
            s.wait(0.5)
            s.play(full.append(some(6, 8), { lag: 0 }), { duration: 1, ease: linear })
        })
        await compileFilm(passing)
        expect(at(0.5, () => shows(full.outline))).toBe(1)
        for (let step = 1; step <= 200; step++) {
            const time = 0.5 + step / 200
            const edge = at(time, () => bottom(full.outline))
            const near = at(time, () => Math.min(...[2, 3, 4].filter((id) => shows(line(full, id)) > 0.08).map((id) => line(full, id).name.bounds().y)))
            if (at(time, () => shows(full.outline)) > 0.02) expect(near - edge).toBeGreaterThan(1)
        }
        expect(at(0.52, () => shows(full.outline))).toBeGreaterThan(0.4)
        expect(at(0.55, () => shows(full.outline))).toBe(0)
        expect(at(0.6, () => shows(line(full, 1)))).toBeGreaterThan(0)
        expect((await checkFilm(passing, { motion: true, readingSpeed: 0 })).diagnostics).toEqual([])
        // The focus of the second row of an append: that row starts after one second. Before that, the outline has no row to show with.
        let two!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            two = s.add(eventLog(some(1, 2), { visible: 8, size: 20 }))
            s.play(two.append(some(3, 4)), two.focus(4), { duration: 2, ease: linear })
        }))
        expect(at(0.5, () => shows(two.outline))).toBe(0)
        expect(at(1.3, () => shows(two.outline))).toBeCloseTo(0.65 * 0.5, 6)
        expect(at(2, () => shows(two.outline))).toBe(1)
    })

    it('moves the outline to the fold when its row folds, and takes it away with a record that leaves the window', async () => {
        let log!: Log, pushed!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(history, { visible: 8, size: 20 }))
            s.play(log.focus(3), { duration: 0.5 })
            s.play(log.fold([2, 3, 4], 'workflow task'), { duration: 1, ease: linear })
            s.play(log.unfold(2), { duration: 1, ease: linear })
            s.play(log.focus(null), { duration: 0.5 })
            // After `focus(null)`, no record has the focus: a fold of the row does not bring the outline back.
            s.play(log.fold([2, 3, 4]), { duration: 1 })
            // An unfold in a full window pushes the first rows out, and the focus with them.
            pushed = s.add(eventLog([...some(1, 3), { ids: [4, 5, 6], name: 'three', rows: some(4, 6) }, ...some(7, 7)], { visible: 5, size: 20 }))
            s.play(pushed.focus(2), { duration: 0 })
            s.play(pushed.unfold(4), { duration: 1 })
            s.play(pushed.fold([4, 5, 6]), { duration: 1 })
            // The list forgot the record of the focus, so a new focus of the same row is a new focus.
            s.play(pushed.focus(2), { duration: 0.5 })
        }))
        const outline = log.outline, y = (id: number, time: number) => at(time, () => line(log, id).get('y'))
        const lift = at(0.5, () => outline.get('y')) - y(3, 0.5)
        // The outline shows as much as its line does. It leaves with row 3, and comes with the fold, in the line of row 2.
        const on = (time: number) => at(time, () => [shows(outline), outline.get('y') - lift])
        expect(on(0.65)).toEqual([expect.closeTo(0.5, 6), expect.closeTo(y(3, 0.5), 6)])
        expect(on(0.8)[0]).toBe(0)
        expect(on(1.05)).toEqual([expect.closeTo(0.5, 6), expect.closeTo(y(2, 0.5), 6)])
        expect(on(1.5)).toEqual([1, expect.closeTo(y(2, 0.5), 6)])
        // And back to the row when the fold opens.
        expect(on(1.65)[0]).toBeCloseTo(0.5, 6)
        expect(on(2.5)).toEqual([1, expect.closeTo(y(3, 0.5), 6)])
        for (const time of [3.2, 3.5, 3.8, 4]) expect(on(time)[0]).toBe(0)
        // The record of the focus left the window: the outline is gone, and it does not come back with the row.
        expect(at(4, () => shows(pushed.outline))).toBe(1)
        expect(seen(pushed, 5)).toEqual(['4', '5', '6', '7'])
        expect(at(5, () => shows(pushed.outline))).toBe(0)
        expect(seen(pushed, 6)).toEqual(['1', '2', '3', '4', '7'])
        expect(at(5.95, () => [shows(line(pushed, 2)), shows(pushed.outline)])).toEqual([1, 0])
        expect(at(6.5, () => shows(pushed.outline))).toBe(1)
    })

    it('draws the focus as a band behind the row, with focusLook', async () => {
        let band!: Log, usual!: Log
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            band = s.add(eventLog(history, { size: 20, focusLook: 'band' }).at(-400, 0))
            usual = s.add(eventLog(history, { size: 20 }).at(400, 0))
            s.play(band.focus(2), usual.focus(2), { duration: 0 })
            s.wait(1)
            expect(() => eventLog([], { focusLook: 'halo' as never })).toThrow(/focusLook is "halo"\. It is 'outline' or 'band'/)
        }))
        // The band is a faint fill in the color of the text, with no line. The outline is a line with no fill.
        expect(at(0.5, () => [band.outline.get('fill'), band.outline.get('stroke'), band.outline.get('fillOpacity')])).toEqual([parseColor('ink'), null, 0.12])
        expect(at(0.5, () => [usual.outline.get('fill'), usual.outline.get('stroke')])).toEqual([null, parseColor('yellow')])
        // The two have one shape, at the row.
        const [a, b] = at(0.5, () => [band.outline.bounds(), usual.outline.bounds()])
        expect([a!.width, a!.height, a!.y]).toEqual([b!.width, b!.height, b!.y])
        expect(band.pitch).toBe(usual.pitch)
        // The band is under the text of its row: the frame draws it before the letters.
        const ops = paths(compiled, 0.5)
        const glyph = band.rows[1]!.name.children[0]!
        expect(ops.findIndex((op) => op.node === band.outline)).toBeGreaterThan(0)
        expect(ops.findIndex((op) => op.node === band.outline)).toBeLessThan(ops.findIndex((op) => op.node === glyph))
        expect(ops.find((op) => op.node === band.outline)!.fillAlpha).toBeCloseTo(0.12, 6)
    })

    it('holds a row back with shown: false, and brings it in at its place with show()', async () => {
        let log!: Log
        const before: unknown[] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog([{ id: 1, name: 'One' }, { id: 2, name: 'Two' }, { id: 3, name: 'Three', shown: false }, { id: 4, name: 'Four', shown: false }, { ids: [5, 6], name: 'pair', shown: false, rows: some(5, 6) }], { footer: (count) => `${count} of 6 rows`, visible: 8, size: 20 }))
            // The rows have their places from the start, and the count is of the rows that show.
            before.push(log.count, log.ids, log.rows.length, log.find((row) => row.shown === false), log.find(() => true))
            expect(log.p(4)[1]).toBeCloseTo(log.p(1)[1] + 3 * log.pitch, 6)
            s.wait(1)
            // A mark of a row that does not show yet changes its state: the row arrives with it. A focus of it
            // puts the outline there, and the outline shows when the row does.
            s.play(log.mark(4, 'failed'), log.focus(4), { duration: 0 })
            s.play(log.show(3), { duration: 1, ease: linear })
            expect(log.count).toBe(3)
            // In one play, two shows count one after the other. A row that shows already does not change.
            s.play(log.show(4), log.show((row) => row.shown === false && row.ids!.length === 2), log.show([1, 3]), { duration: 1, ease: linear })
            expect(log.count).toBe(6)
            expect(log.find((row) => row.shown === false)).toEqual([])
            // With no argument, the list itself shows, as any node does.
            expect(log.hide().get('visible')).toBe(false)
            expect(log.show()).toBe(log)
            expect(log.get('visible')).toBe(true)
            expect(log.show(3).duration).toBe(0.5)
            expect(log.show([1, 2, 3]).label).toBe('eventLog.show')
            // A row that does not show yet cannot go into a fold, and a fold that does not show yet cannot open.
            const held = s.add(eventLog([{ id: 1, name: 'One' }, { id: 2, name: 'Two', shown: false }, { ids: [3, 4], name: 'pair', shown: false, rows: some(3, 4) }], { size: 20 }))
            expect(() => s.play(held.fold([1, 2], 'pair'))).toThrow(/row 2 does not show yet, so it cannot go into a fold\. Bring it in first, with show\(2\)/)
            expect(() => s.play(held.unfold(3))).toThrow(/the fold from 3 to 4 does not show yet, so it cannot open\. Bring it in first, with show\(3\)/)
            expect(() => s.play(held.show(9))).toThrow(/no row has the id 9/)
            // An append takes such a row too: it takes its line, and shows later.
            s.play(held.append({ id: 5, name: 'Five', shown: false }))
            expect([held.count, held.rows.length]).toEqual([1, 4])
        }))
        const P = log.pitch
        expect(before).toEqual([2, [1, 2, 3, 4, 5, 6], 5, [3, 4, 5, 6], [1, 2, 3, 4, 5, 6]])
        expect(seen(log, 0.5)).toEqual(['1', '2'])
        expect(said(log.footer!, 0.5)).toEqual(['2 of 6 rows'])
        // The row arrives as a row of `append` does: it fades in over six tenths of its time, and rises a third of a row.
        const three = line(log, 3)
        expect(at(1.3, () => shows(three.content))).toBeCloseTo(0.5, 6)
        expect(at(1.3, () => three.content.get('y'))).toBeCloseTo(0.35 * P * 0.7, 6)
        expect(at(2, () => [shows(three.content), three.content.get('y')])).toEqual([1, 0])
        // No row moves, and the row itself keeps its place.
        for (const id of [1, 2, 3, 4]) expect(at(1.5, () => line(log, id).get('y'))).toBe(at(0, () => line(log, id).get('y')))
        // The footer changes when the row is half there.
        expect(said(log.footer!, 1.45)).toEqual(['2 of 6 rows'])
        expect(said(log.footer!, 1.55)).toEqual(['3 of 6 rows'])
        // The outline waits for its row, and comes with it.
        const lift = at(3, () => log.outline.get('y') - line(log, 4).get('y'))
        expect(at(1.5, () => shows(log.outline))).toBe(0)
        expect(at(2.3, () => [shows(log.outline), log.outline.get('y') - lift])).toEqual([expect.closeTo(0.5, 6), expect.closeTo(line(log, 4).get('y') + 0.35 * P * 0.7, 6)])
        expect(at(3, () => shows(log.outline))).toBe(1)
        expect(at(3, () => ink(line(log, 4).name))).toEqual(parseColor('red'))
        // Two shows in one play: each row counts at the middle of its time, and the footer has one text at every frame.
        for (let step = 0; step <= 20; step++) expect(said(log.footer!, 2 + step / 20)).toHaveLength(1)
        expect(said(log.footer!, 2.45)).toEqual(['3 of 6 rows'])
        expect(said(log.footer!, 2.55)).toEqual(['6 of 6 rows'])
        expect(seen(log, 3)).toEqual(['1', '2', '3', '4', '5'])
        // A show in the play of an append: the footer follows the two in the order of time. The rows of the
        // append count at 0.5 s and at 1.5 s, and the row of the show at 1 s.
        let both!: Log, pair!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            both = s.add(eventLog([{ id: 1, name: 'One' }, { id: 2, name: 'Two', shown: false }], { footer: (count) => `${count} rows`, visible: 8, size: 20 }))
            pair = s.add(eventLog([{ id: 1, name: 'One' }, { id: 2, name: 'Two', shown: false }, { id: 3, name: 'Three', shown: false }], { footer: (count) => `${count} rows`, visible: 8, size: 20 }))
            s.play(both.append(some(3, 4)), both.show(2), pair.show(() => true), { duration: 2, ease: linear })
        }))
        expect([0.4, 0.6, 1.1, 1.6].map((time) => said(both.footer!, time))).toEqual([['1 rows'], ['2 rows'], ['3 rows'], ['4 rows']])
        // The rows of one show come one after another. A function that also picks a row that shows leaves that row as it is.
        const parts = (time: number) => at(time, () => [1, 2, 3].map((id) => shows(line(pair, id).content)))
        expect(parts(0.3)).toEqual([1, expect.closeTo(0.5, 6), 0])
        expect(parts(1.3)).toEqual([1, 1, expect.closeTo(0.5, 6)])
        expect([0.4, 0.6, 1.6].map((time) => said(pair.footer!, time))).toEqual([['1 rows'], ['2 rows'], ['3 rows']])
    })

    it('counts the rows that show above and under the window, and starts the window where rows show', async () => {
        const footer = (count: number) => `${count} events`
        const held = (ids: number[]) => some(1, 12).map((row) => ({ ...row, shown: !ids.includes(row.id as number) }))
        let above!: Log, under!: Log, long!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            above = s.add(eventLog(held([2, 3]), { visible: 6, size: 20, footer }))
            under = s.add(eventLog(held([10, 11]), { visible: 6, size: 20, footer }))
            s.play(under.scrollTo(1), { duration: 1 })
            s.play(above.show([2, 3]), under.show([10, 11]), { duration: 1, ease: linear })
            s.play(above.append(some(13, 13)), { duration: 1 })
        }))
        // Rows 1 to 7 are above the window, and two of them wait: the first line counts the five that show.
        expect([said(above.earlier, 0.5), said(above.footer!, 0.5)]).toEqual([['5 earlier'], ['10 events']])
        // A row that shows above the window counts when it is half there, as it does in the footer: at 1.25 s and at 1.75 s.
        expect([1.2, 1.25, 1.7, 1.75].map((time) => said(above.earlier, time))).toEqual([['5 earlier'], ['6 earlier'], ['6 earlier'], ['7 earlier']])
        expect([1.2, 1.25, 1.75].map((time) => said(above.footer!, time))).toEqual([['10 events'], ['11 events'], ['12 events']])
        expect([1.2, 1.3, 1.8].map((time) => said(above.footer!, time))).toEqual([['10 events'], ['11 events'], ['12 events']])
        // The next row adds one, and no more: the count was right before it.
        expect([2.4, 2.5, 3].map((time) => said(above.earlier, time))).toEqual([['7 earlier'], ['8 earlier'], ['8 earlier']])
        // The same under the window, after a scroll to the first rows.
        expect([said(under.earlier, 1.1), said(under.later, 1.1)]).toEqual([[], ['5 later']])
        expect([1.3, 1.8, 3].map((time) => said(under.later, time))).toEqual([['6 later'], ['7 later'], ['7 later']])
        expect([under.count, said(under.footer!, 3)]).toEqual([12, ['12 events']])
        // A list of 12 turns that fills on cue, in a window of 6 lines: two rows show, and ten wait.
        const starts: string[][] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            long = s.add(eventLog(held([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), { visible: 6, size: 20, footer: (count) => `${count} of 12` }))
            starts.push(long.rows.map((row) => words(row.idText)))
            s.wait(1)
            s.play(long.show([3, 4, 5]), { duration: 1 })
            s.play(long.show([6, 7]), { duration: 1, ease: linear })
            s.play(long.scrollTo(7), { duration: 1 })
            // With no row that shows, the window is at the first rows. With rows that wait at the end only, the last row that shows is the last row of the window.
            const none = eventLog(some(1, 12).map((row) => ({ ...row, shown: false })), { visible: 6, size: 20 })
            const tail = s.add(eventLog(held([11, 12]), { visible: 6, size: 20 }))
            const middle = eventLog(held([5, 6]), { visible: 6, size: 20 })
            starts.push(...[none, tail, middle].map((list) => list.rows.map((row) => words(row.idText))))
            expect(said(tail.earlier, s.time)).toEqual(['6 earlier'])
            expect(said(middle.earlier, 0)).toEqual(['5 earlier'])
            // The rows above the window wait: the first line is empty too. No "0 earlier".
            const first = eventLog(held([1, 2, 3, 4, 5, 6, 7]), { visible: 6, size: 20 })
            expect([first.rows.map((row) => words(row.idText)), said(first.earlier, 0), first.earlier.children[0]!.get('visible'), first.earlier.get('visible')]).toEqual([['8', '9', '10', '11', '12'], [], false, true])
            // The window keeps the start that the list gave it, as it keeps the place of a `scrollTo`: a fold leaves it there.
            const start = s.add(eventLog(held([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), { visible: 6, size: 20 }))
            s.play(start.fold([1, 2], 'pair'), { duration: 0 })
            expect(start.rows.map((row) => words(row.idText))).toEqual(['1', '3', '4', '5', '6'])
            // A fold that lets the rest of the list fit takes the count line away: the window goes on to the end.
            s.play(tail.fold([8, 9], 'pair'), { duration: 0 })
            expect(tail.rows.map((row) => words(row.idText))).toEqual(['7', '8', '10', '11', '12'])
            // A window of two lines has one count line: it starts at the first row, or at the end.
            expect(eventLog([{ id: 1, name: 'One' }, { id: 2, name: 'Two', shown: false }, { id: 3, name: 'Three', shown: false }], { visible: 2, size: 20 }).rows.map((row) => words(row.idText))).toEqual(['1'])
        }))
        // The window starts where rows show, with the places of the rows that wait: not at the end of the list, where it would be empty.
        expect(starts).toEqual([['1', '2', '3', '4', '5'], ['1', '2', '3', '4', '5'], ['7', '8', '9', '10'], ['8', '9', '10', '11', '12']])
        expect(seen(long, 0.5)).toEqual(['1', '2'])
        // The rows under the window wait, so the last line counts nothing. It is empty: no "0 later", and no dots.
        const dots = (holder: Node, time: number) => at(time, () => shows(holder.children[0]!))
        expect([said(long.later, 0.5), dots(long.later, 0.5), at(0.5, () => long.later.get('visible'))]).toEqual([[], 0, true])
        expect(seen(long, 2)).toEqual(['1', '2', '3', '4', '5'])
        // Rows 6 and 7 show under the window. No row moves, and the last line counts each when it is half there.
        expect([2.2, 2.3, 2.8].map((time) => said(long.later, time))).toEqual([[], ['1 later'], ['2 later']])
        expect([dots(long.later, 2.2), dots(long.later, 2.3)]).toEqual([0, 1])
        expect(seen(long, 3)).toEqual(['1', '2', '3', '4', '5'])
        expect(said(long.footer!, 3)).toEqual(['7 of 12'])
        // After the scroll, three rows are above and five wait under: the last line is empty again.
        expect(seen(long, 4)).toEqual(['4', '5', '6', '7'])
        expect([said(long.earlier, 4), said(long.later, 4), dots(long.later, 4)]).toEqual([['3 earlier'], [], 0])
        // A count is of records: a fold under the window counts each record that it holds, and a row that waits counts none.
        let folded!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            folded = s.add(eventLog([...some(1, 8), { ids: [9, 10, 11], name: 'three' }, { id: 12, name: 'Held', shown: false }, ...some(13, 14)], { visible: 5, size: 20 }))
            s.play(folded.scrollTo(1), { duration: 1 })
        }))
        expect(seen(folded, 1)).toEqual(['1', '2', '3', '4'])
        expect(said(folded.later, 1)).toEqual(['9 later'])
    })

    it('takes ids that are texts in scrollTo and show, and knows the id of a number by its text', async () => {
        let log!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
            log = s.add(eventLog(ids.map((id) => ({ id, name: `Event ${id}`, shown: id !== 'g' })), { visible: 4, size: 20, footer: (count) => `${count} rows` }))
            expect(log.rows.map((row) => words(row.idText))).toEqual(['f', 'g', 'h'])
            s.play(log.scrollTo('b'), { duration: 1 })
            expect(log.rows.map((row) => words(row.idText))).toEqual(['b', 'c'])
            s.play(log.show('g'), { duration: 1, ease: linear })
            expect(log.count).toBe(8)
            s.play(log.scrollTo('g'), log.focus('g'), { duration: 1 })
            expect(log.rows.map((row) => words(row.idText))).toEqual(['f', 'g', 'h'])
            expect(log.p('g')).toEqual(log.p('f').map((value, index) => value + index * log.pitch))
            expect(() => s.play(log.scrollTo('z'))).toThrow(/no row has the id "z"\. The list has the ids "a" to "h"/)
            expect(() => s.play(log.show(['a', 'z']))).toThrow(/no row has the id "z"/)
            // An id that is a number is known by its text too.
            const numbers = s.add(eventLog([...some(1, 9), { id: 10, name: 'Ten', shown: false }], { visible: 4, size: 20 }))
            expect(numbers.rows.map((row) => words(row.idText))).toEqual(['8', '9', '10'])
            s.play(numbers.scrollTo('2'), { duration: 0 })
            expect(numbers.rows.map((row) => words(row.idText))).toEqual(['2', '3'])
            s.play(numbers.show('10'), { duration: 0 })
            expect(numbers.count).toBe(10)
            expect(numbers.find((row) => row.shown === false)).toEqual([])
        }))
        // Row g waits at the start: the window shows f and h, and the first line counts the five rows above.
        expect(seen(log, 0)).toEqual(['f', 'h'])
        expect([said(log.earlier, 0), said(log.footer!, 0)]).toEqual([['5 earlier'], ['7 rows']])
        expect([said(log.earlier, 1), said(log.later, 1)]).toEqual([['1 earlier'], ['4 later']])
        // Row g shows under the window: the last line counts it when it is half there.
        expect([1.4, 1.6].map((time) => said(log.later, time))).toEqual([['4 later'], ['5 later']])
        expect(seen(log, 3)).toEqual(['f', 'g', 'h'])
        expect([said(log.earlier, 3), said(log.later, 3), said(log.footer!, 3)]).toEqual([['5 earlier'], [], ['8 rows']])
        expect(at(3, () => [shows(log.outline), Math.round(log.outline.get('y') - line(log, 'g').get('y'))])).toEqual([1, 0])
    })

    it('takes the outline back at each focus, whatever the film did to the node', async () => {
        let log!: Log
        await compileFilm(film({ fps: 20 }, (s) => {
            log = s.add(eventLog(some(1, 6), { visible: 6, size: 20 }))
            s.play(log.focus(3), { duration: 0.4 }); s.wait(0.6)
            s.play(fadeOut(log.outline), { duration: 0.4 }); s.wait(0.6)
            s.play(log.focus(5), { duration: 0.4 }); s.wait(0.6)
            s.play(fadeIn(log.outline), { duration: 0.4 }); s.wait(0.6)
            s.play(log.focus(null), { duration: 0.4 }); s.wait(0.6)
            s.play(log.focus(2), { duration: 0.4 }); s.wait(0.6)
            s.play(log.focus(null), { duration: 0.4 }); s.wait(0.6)
        }))
        const on = (time: number, id: number) => at(time, () => [shows(log.outline), Math.round(log.outline.get('y') - line(log, id).get('y'))])
        expect(on(0.9, 3)).toEqual([1, 0])
        // The film fades the node out itself. The next focus shows the outline again, at its row.
        expect(on(1.9, 3)[0]).toBe(0)
        expect(on(2.3, 5)).toEqual([expect.closeTo(0.5, 6), 0])
        expect(on(2.9, 5)).toEqual([1, 0])
        // The film fades the node in itself. `focus(null)` takes the outline away all the same.
        expect(on(3.9, 5)).toEqual([1, 0])
        expect(on(4.2, 5)).toEqual([expect.closeTo(0.5, 6), 0])
        expect(on(4.9, 5)[0]).toBe(0)
        expect(on(5.9, 2)).toEqual([1, 0])
        expect(on(6.9, 2)[0]).toBe(0)
    })

    it('sets the height of a row with leading, and refuses an outline that has too little room', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            const rows = some(1, 4).map((row) => ({ ...row, detail: 'a (detail), jpg' }))
            const message = (build: () => unknown) => { try { build() } catch (error) { if (!(error instanceof Error)) throw error; return error.message } return '' }
            const usual = eventLog(rows, { size: 20, visible: 4 })
            // `leading` is the height of a row as a part of the text size. The panel follows it.
            const low = eventLog(rows, { size: 20, visible: 4, leading: 1.5 })
            expect(low.pitch).toBe(30)
            expect(low.frame.bounds().height).toBeCloseTo(4 * 30 + 16, 6)
            low.rows.forEach((row, index) => expect(row.get('y') - low.rows[0]!.get('y')).toBeCloseTo(index * 30, 6))
            // The default is the height that the outline needs. A larger leading is free.
            expect(eventLog(rows, { size: 20, leading: usual.pitch / 20 }).pitch).toBeCloseTo(usual.pitch, 6)
            expect(() => eventLog(rows, { size: 20, leading: 2.4 }).focus(2)).not.toThrow()
            // A list with no focus takes the lower rows. The first focus is an error that names the leading that the outline needs.
            const refused = message(() => low.focus(2))
            expect(refused).toMatch(/^eventLog: a leading of 1\.5 leaves the outline of the focus too little room\. The outline needs 0\.3 of the text size between its line and the ink of the rows: a leading of (1\.\d+) or more\. Take that, or `focusLook: 'band'`$/)
            const needs = Number(/a leading of (1\.\d+) or more/.exec(refused)![1])
            expect(needs * 20).toBeGreaterThanOrEqual(usual.pitch)
            expect(needs * 20).toBeLessThan(usual.pitch + 0.2)
            expect(() => eventLog(rows, { size: 20, leading: needs }).focus(2)).not.toThrow()
            expect(message(() => eventLog(rows, { size: 20, leading: needs - 0.02 }).focus(2))).toMatch(/a leading of 1\.\d+ leaves the outline/)
            // `focus(null)` draws nothing, so it is free.
            expect(() => low.focus(null)).not.toThrow()
            // With the band, the lower rows are free: the band has no line. Its row has room in it, and the rows next to it are out of it.
            const band = s.add(eventLog(rows, { size: 20, visible: 4, leading: 1.5, focusLook: 'band' }))
            s.play(band.focus(2), { duration: 0 })
            const box = band.outline.bounds(), [first, own, third] = band.rows.map((row) => { const boxes = [row.name.bounds(), row.detail!.bounds()]; return [Math.min(...boxes.map((part) => part.y)), Math.max(...boxes.map((part) => part.y + part.height))] })
            expect(box.height).toBeCloseTo(30, 6)
            expect(own![0]! - box.y).toBeGreaterThanOrEqual(20 * 0.14)
            expect(box.y + box.height - own![1]!).toBeGreaterThanOrEqual(20 * 0.14)
            expect(first![1]!).toBeLessThan(box.y)
            expect(third![0]!).toBeGreaterThan(box.y + box.height)
            // A leading with no room for the ink of two rows is an error where the list is made.
            expect(message(() => eventLog(rows, { size: 20, leading: 1 }))).toMatch(/^eventLog: leading is 1\. It is the height of a row as a part of the text size, 1\.\d+ or more with these fonts: the ink of a row, and a little room$/)
            expect(() => eventLog(rows, { leading: Number.NaN })).toThrow(/leading is NaN/)
            const least = Number(/size, (1\.\d+) or more/.exec(message(() => eventLog(rows, { size: 20, leading: 1 })))![1])
            expect(least).toBeLessThanOrEqual(1.5)
            expect(least).toBeGreaterThanOrEqual(1.36)
            expect(() => eventLog(rows, { size: 20, leading: least })).not.toThrow()
            expect(() => eventLog(rows, { size: 20, leading: least - 0.01 })).toThrow(/leading is/)
        }))
    })

    it('cuts a name or a detail that is longer than its column with an ellipsis, or refuses it with ellipsis: false', async () => {
        await compileFilm(film(() => {
            const long = 'the address is empty, so the update is not accepted'
            const rows: LogRow[] = [
                { id: 1, name: 'ActivityTaskCompleted', detail: '"ch_1001"' },
                { id: 2, name: 'WorkflowExecutionUpdateAccepted', detail: 'setAddress' },
                { id: 3, name: 'ActivityTaskFailed', detail: long },
                { id: 4, name: 'WorkflowExecutionUpdateCompletedByTheWorkerAfterTheValidatorRan' },
            ]
            const log = eventLog(rows, { size: 20, width: 600, nameWidth: 252 })
            const [whole, cutName, cutDetail, alone] = log.rows
            // 252 px hold 21 characters of 12 px. A longer name keeps 20, and the ellipsis.
            expect(words(whole!.name)).toBe('ActivityTaskCompleted')
            expect(words(cutName!.name)).toBe('WorkflowExecutionUpd…')
            expect(right(cutName!.name)).toBeLessThanOrEqual(cutName!.name.get('x') + 252)
            expect(right(cutName!.name)).toBeLessThan(cutName!.detail!.bounds().x)
            // A detail ends where the content of the panel ends: 16 px from the border.
            expect(words(whole!.detail)).toBe('"ch_1001"')
            expect(words(cutDetail!.detail).endsWith('…')).toBe(true)
            expect(long.startsWith(words(cutDetail!.detail).slice(0, -1))).toBe(true)
            expect(right(cutDetail!.detail!)).toBeLessThanOrEqual(300 - 16)
            expect(right(cutDetail!.detail!)).toBeGreaterThan(300 - 16 - 20)
            // A row with no detail has no next column, so its name goes on to the end of the row.
            expect(words(alone!.name).length).toBeGreaterThan(22)
            expect(words(alone!.name).endsWith('…')).toBe(true)
            expect(right(alone!.name)).toBeLessThanOrEqual(300 - 16)
            expect(right(alone!.name)).toBeGreaterThan(300 - 16 - 14)
            // A name that is one character too long is cut too: no text goes over its room.
            const over = eventLog([{ id: 1, name: 'ActivityTaskCompleted2', detail: 'x' }, { id: 2, name: 'Short', detail: 'a detail of thirty characters.' }], { size: 20, width: 600, nameWidth: 252 })
            expect(words(over.rows[0]!.name)).toBe('ActivityTaskComplete…')
            expect(right(over.rows[0]!.name)).toBeLessThanOrEqual(over.rows[0]!.name.get('x') + 252)
            // A space before the cut is not kept: 60 px hold four characters and the ellipsis, and the fourth is a space.
            expect(words(eventLog([{ id: 1, name: 'abc defgh', detail: 'x' }], { size: 20, width: 400, nameWidth: 60 }).rows[0]!.name)).toBe('abc…')
        }))
    })

    it('lists every text that does not fit under ellipsis: false in one error, with the numbers that fit them all', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            const long = 'the address is empty, so the update is not accepted'
            const rows: LogRow[] = [
                { id: 1, name: 'ActivityTaskCompleted', detail: '"ch_1001"' },
                { id: 2, name: 'WorkflowExecutionUpdateAccepted', detail: 'setAddress' },
                { id: 3, name: 'ActivityTaskFailed', detail: long },
                { id: 4, name: 'WorkflowExecutionUpdateCompletedByTheWorkerAfterTheValidatorRan' },
            ]
            type Options = NonNullable<Parameters<typeof eventLog>[1]>
            const message = (build: () => unknown) => { try { build() } catch (error) { if (!(error instanceof Error)) throw error; return error.message } return '' }
            const numbers = (said: string): Options => {
                const nameWidth = /`nameWidth` to (\d+)/.exec(said), width = /`width` to (\d+)/.exec(said)
                return { ...(nameWidth ? { nameWidth: Number(nameWidth[1]) } : {}), ...(width ? { width: Number(width[1]) } : {}) }
            }
            /** Make the list with the numbers of its error. One round is enough: the list is made, and each text is whole. */
            const follow = (given: LogRow[], options: Options) => {
                const said = message(() => eventLog(given, { ...options, ellipsis: false }))
                const fixed: Options = { ...options, ellipsis: false, ...numbers(said) }
                const made = eventLog(given, fixed)
                expect(made.rows.map((row) => [words(row.name), row.detail ? words(row.detail) : undefined])).toEqual(given.map((row) => [row.name, row.detail === undefined ? undefined : String(row.detail)]))
                return { said, fixed }
            }
            // A name that is wider than its column, and a detail that is wider than the room of the details: one error names the two.
            const two = follow(rows.slice(0, 3), { size: 20, width: 600, nameWidth: 252 })
            expect(two.said).toMatch(/^eventLog: with `ellipsis: false`, a name and a detail show whole, and 2 texts do not fit: the name of row 2 \(37\d px, and it has 252\), the detail of row 3 \(\d+ px, and the details have \d+\)\. Set `nameWidth` to 37\d and `width` to \d+ or more$/)
            // The numbers are the least that work: with 2 px less of width, the detail does not fit.
            expect(message(() => eventLog(rows.slice(0, 3), { ...two.fixed, width: two.fixed.width! - 2 }))).toMatch(/one text does not fit: the detail of row 3/)
            expect(message(() => eventLog(rows.slice(0, 3), { ...two.fixed, nameWidth: two.fixed.nameWidth! - 2 }))).toMatch(/the name of row 2/)
            // A name alone, in a list with room: the `nameWidth` is enough.
            const name = follow(rows.slice(0, 2), { size: 20, width: 1400, nameWidth: 252 })
            expect(name.said).toMatch(/and one text does not fit: the name of row 2 \(37\d px, and it has 252\)\. Set `nameWidth` to 37\d$/)
            // A detail alone, in a list that takes the room of its names from its rows: the width is enough.
            const detail = follow(rows.slice(0, 3), { size: 20, width: 700 })
            expect(detail.said).toMatch(/and one text does not fit: the detail of row 3 \(\d+ px, and the details have \d+\)\. Raise `width` to \d+ or more$/)
            expect(message(() => eventLog(rows.slice(0, 3), { ...detail.fixed, width: detail.fixed.width! - 2 }))).toMatch(/the detail of row 3/)
            // A list that gives its names 60% of the width: the error sets the room of the names, so that a wider panel does not change it.
            const capped = follow(rows.slice(0, 3), { size: 20, width: 500 })
            expect(capped.said).toMatch(/and 3 texts do not fit: the name of row 2 \(37\d px, and it has 300\), the detail of row 2 \(\d+ px, and the details have \d+\), the detail of row 3 \(\d+ px, and the details have \d+\)\. Set `nameWidth` to 37\d and `width` to \d+ or more$/)
            // A row with no detail goes on to the end of the row. Past that, the width is what works.
            const alone = follow(rows.slice(3), { size: 20, width: 600 })
            expect(alone.said).toMatch(/and one text does not fit: the name of row 4 \(75\d px, and it has 511\)\. Raise `width` to \d+ or more$/)
            expect(message(() => eventLog(rows.slice(3), { ...alone.fixed, width: alone.fixed.width! - 2 }))).toMatch(/the name of row 4/)
            // Details with room for less than eight characters are in the same error.
            const narrow = follow([{ id: 1, name: 'ActivityTask', detail: 'a' }], { size: 20, width: 330, nameWidth: 160 })
            expect(narrow.said).toMatch(/^eventLog: with `ellipsis: false`, a name and a detail show whole\. The details have room for \d characters, and a detail needs 8\. Raise `width` to \d+ or more$/)
            expect(message(() => eventLog([{ id: 1, name: 'ActivityTask', detail: 'a' }], { ...narrow.fixed, width: narrow.fixed.width! - 2 }))).toMatch(/The details have room for 7 characters/)
            // A fold with no rows is named as the fold. The list does not report rows that the film did not write.
            const fold = follow([{ id: 1, name: 'One', detail: 'a' }, { ids: [2, 3, 4], name: 'a workflow task of the sticky queue', detail: 'worker 71293, sticky queue' }], { size: 20, width: 520 })
            expect(fold.said).toMatch(/texts? do(es)? not fit: the name of the fold from 2 to 4 /)
            expect(fold.said).not.toMatch(/row [234]/)
            // The rows of a fold are in the list of the error too: the fold opens into them later.
            const inner = follow([{ ids: [1, 2], name: 'pair', rows: [{ id: 1, name: 'One', detail: long }, { id: 2, name: 'WorkflowExecutionUpdateAccepted' }] }], { size: 20, width: 500 })
            expect(inner.said).toMatch(/one text does not fit: the detail of row 1 /)
            // More than six texts: the error names six, and counts the others.
            const many = message(() => eventLog(Array.from({ length: 8 }, (_, index) => ({ id: index + 1, name: 'Event', detail: long })), { size: 20, width: 400, ellipsis: false }))
            expect(many).toMatch(/and 8 texts do not fit: the detail of row 1 .*the detail of row 6 \(\d+ px, and the details have \d+\), and 2 more\. Raise `width` to \d+ or more$/)
            // A row that comes later is checked where the film makes the append. No column gets smaller: the rows of the list still fit.
            const log = s.add(eventLog(rows.slice(0, 2), { size: 20, width: 700, ellipsis: false }))
            const later = message(() => log.append({ id: 9, name: 'N'.repeat(40), detail: 'a detail that is longer than the room' }))
            expect(later).toMatch(/and 2 texts do not fit: the name of row 9 \(4[78]\d px, and it has 372\), the detail of row 9 \(\d+ px, and the details have \d+\)\. Set `nameWidth` to 4[78]\d and `width` to \d+ or more$/)
            const wider = s.add(eventLog(rows.slice(0, 2), { size: 20, ellipsis: false, ...numbers(later) }))
            s.play(wider.append({ id: 9, name: 'N'.repeat(40), detail: 'a detail that is longer than the room' }))
            expect(wider.rows.map((row) => words(row.name))).toEqual([rows[0]!.name, rows[1]!.name, 'N'.repeat(40)])
            // So is the label of a fold.
            expect(message(() => s.play(log.fold([1, 2], { name: 'a pair with a name that is too long for the names', detail: 'two' })))).toMatch(/one text does not fit: the name of the fold from 1 to 2 /)
            expect(log.rows).toHaveLength(2)
        }))
    })

    it('gives the names the room of the longest name of the first rows, 60% of the width at most', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            // The first rows have 21 characters at most. A row that comes later is cut to that room.
            const log = s.add(eventLog([{ id: 1, name: 'ActivityTaskCompleted', detail: 'a' }], { size: 20, width: 700 }))
            s.play(log.append({ id: 2, name: 'WorkflowExecutionUpdateAccepted', detail: 'setAddress' }))
            expect(words(log.rows[1]!.name)).toBe('WorkflowExecutionUpd…')
            // 60% of 700 is 420 px, which is 35 characters. The first name has 40.
            const capped = eventLog([{ id: 1, name: 'N'.repeat(40), detail: 'a' }], { size: 20, width: 700 })
            expect(words(capped.rows[0]!.name)).toBe(`${'N'.repeat(34)}…`)
            expect(capped.rows[0]!.detail!.get('x') - capped.rows[0]!.name.get('x')).toBeCloseTo(420 + 18, 6)
            // `nameWidth` sets the room.
            const wide = eventLog([{ id: 1, name: 'N'.repeat(40), detail: 'a' }], { size: 20, width: 800, nameWidth: 500 })
            expect(words(wide.rows[0]!.name)).toBe('N'.repeat(40))
            expect(wide.rows[0]!.detail!.get('x') - wide.rows[0]!.name.get('x')).toBeCloseTo(518, 6)
            // With no first row, the names have 60% of the width.
            const empty = s.add(eventLog([], { size: 20, width: 700 }))
            s.play(empty.append({ id: 1, name: 'N'.repeat(40), detail: 'a' }))
            expect(words(empty.rows[0]!.name)).toBe(`${'N'.repeat(34)}…`)
            // A list with no detail is not concerned by the room of the details: in a narrow panel, the names take it all.
            const narrow = eventLog([{ id: 1, name: 'WorkflowExecutionUpdateAccepted' }], { size: 20, width: 300 })
            expect(narrow.rows[0]!.detail).toBeNull()
            expect(right(narrow.rows[0]!.name)).toBeGreaterThan(150 - 16 - 14)
            expect(right(narrow.rows[0]!.name)).toBeLessThanOrEqual(150 - 16)
        }))
    })

    it('refuses a list whose details have room for less than eight characters, and names a width that works', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            const rows = history.slice(4)
            const message = (build: () => unknown) => { try { build() } catch (error) { if (!(error instanceof Error)) throw error; return error.message } return '' }
            // At 400 px the names are cut to 60% of the width, and 53 px are left: four characters of the text font.
            const narrow = message(() => eventLog(rows, { size: 20, width: 400 }))
            expect(narrow).toMatch(/^eventLog: the details have room for 4 characters, and row 5 has a detail\. A detail needs room for 8\. Raise `width` to (\d+) or more, or set `nameWidth` to (\d+) or less$/)
            const [, width, nameWidth] = /`width` to (\d+) or more, or set `nameWidth` to (\d+) or less/.exec(narrow)!
            // The width of the message works, and one px less does not. More width gives more to the names too, so it is not 400 plus what was missing.
            expect(Number(width)).toBeGreaterThan(400 + 45)
            expect(words(eventLog(rows, { size: 20, width: Number(width) }).rows[0]!.detail)).toMatch(/^charge/)
            expect(message(() => eventLog(rows, { size: 20, width: Number(width) - 1 }))).toMatch(/the details have room for 7 characters/)
            // The eight characters are those of the font of the details. Mono characters are wider than those of the
            // text font, so the same panel has room for seven of them, and a wider one for eight.
            expect(message(() => eventLog(rows, { size: 20, width: Number(width), detailFont: 'mono' }))).toMatch(/the details have room for 7 characters/)
            expect(() => eventLog(rows, { size: 20, width: Number(width) + 6, detailFont: 'mono' })).not.toThrow()
            // So does the `nameWidth` of the message, and two px more do not.
            expect(words(eventLog(rows, { size: 20, width: 400, nameWidth: Number(nameWidth) }).rows[0]!.detail)).toMatch(/^charge/)
            expect(message(() => eventLog(rows, { size: 20, width: 400, nameWidth: Number(nameWidth) + 2 }))).toMatch(/the details have room for 7 characters/)
            // A `nameWidth` that leaves little room: no detail is drawn as an ellipsis alone.
            expect(message(() => eventLog(rows, { size: 20, width: 500, nameWidth: 380 }))).toMatch(/the details have room for 1 characters, and row 5 has a detail\. A detail needs room for 8\. Raise `width` to \d+ or more, or set `nameWidth` to \d+ or less/)
            // The room that passes holds eight characters at least, so a detail that is cut keeps most of them.
            const tight = eventLog([{ id: 1, name: 'ActivityTaskScheduled', detail: 'a detail that is cut in this room' }], { size: 20, width: Number(width) })
            expect(words(tight.rows[0]!.detail).length).toBeGreaterThanOrEqual(7)
            expect(words(tight.rows[0]!.detail)).not.toBe('…')
            // A list with no detail in its first rows gives the room to the names. A row with a detail that comes later is refused.
            const plain = s.add(eventLog(some(1, 3).map((row) => ({ ...row, name: 'WorkflowExecutionUpdateAccepted' })), { size: 20, width: 400 }))
            expect(() => plain.append({ id: 4, name: 'Late', detail: 'a detail' })).toThrow(/the details have room for 0 characters, and row 4 has a detail/)
            // The detail of a fold starts after its name. In a narrow column of names, the name is cut so that the detail keeps its room.
            const fold = eventLog([{ id: 1, name: 'One', detail: 'a' }, { ids: [2, 3], name: 'a pair of rows with a long name', detail: 'two' }], { size: 20, width: 560, nameWidth: 100 }).rows[1]!
            expect(words(fold.name).endsWith('…')).toBe(true)
            expect(280 - 16 - fold.detail!.get('x')).toBeGreaterThanOrEqual(8 * 11.8)
            expect(fold.detail!.get('x') - right(fold.name)).toBeGreaterThan(17)
        }))
    })

    it('sets the size of the title and the footer with titleSize, and the font of the details with detailFont', async () => {
        await compileFilm(film(() => {
            const options = { title: 'event history', footer: (count: number) => `${count} events`, visible: 4, size: 20, width: 700 }
            const usual = eventLog(some(1, 6), options), large = eventLog(some(1, 6), { ...options, titleSize: 34 })
            // The default is 0.85 of the text size. `titleSize` sets the title and the footer, and their bands grow with it.
            const height = (node: Node) => node.bounds().height
            expect(height(large.title!) / height(usual.title!)).toBeCloseTo(34 / 17, 1)
            expect(height(large.footer!) / height(usual.footer!)).toBeCloseTo(34 / 17, 1)
            expect(usual.frame.bounds().height).toBeCloseTo(4 * usual.pitch + 16 + 2 * 38, 6)
            expect(large.frame.bounds().height).toBeCloseTo(4 * large.pitch + 16 + 2 * 76, 6)
            expect(large.pitch).toBe(usual.pitch)
            for (const part of [large.title!, large.footer!]) inside(part, large.frame)
            expect(bottom(large.title!)).toBeLessThan(large.rules[0]!.bounds().y - 34 * 0.3)
            // The counts take the size too, and are never larger than the rows.
            const count = (log: Log) => log.earlier.children.find((child) => typeof words(child) === 'string')!
            expect(height(count(usual)) / height(usual.rows[0]!.idText)).toBeLessThan(1)
            expect(height(count(large))).toBeCloseTo(height(count(eventLog(some(1, 6), { ...options, titleSize: 20 }))), 6)
            expect(height(count(large))).toBeGreaterThan(height(count(usual)) * 1.1)
            expect(count(large).get('y')).toBe(count(eventLog(some(1, 6), { ...options, titleSize: 20 })).get('y'))
            expect(() => eventLog([], { titleSize: 0 })).toThrow(/titleSize is the text size of the title and the footer, more than 0/)
            // `detailFont` sets the details, and `font` the title and the footer. A detail that is data is in mono.
            const rows = [{ id: 1, name: 'HHHH', detail: 'iiii' }, { id: 2, name: 'HHHH', detail: 'mmmm' }]
            const mono = eventLog(rows, { ...options, detailFont: 'mono' }), text_ = eventLog(rows, options), serif = eventLog(rows, { ...options, font: 'text-serif', detailFont: 'mono' })
            const widths = (log: Log) => log.rows.map((row) => { const box = row.detail!.children.map((glyph) => glyph.get('x')); return box[3]! - box[0]! })
            // In mono, four letters take the same room, whatever they are: three steps of 12 px.
            expect(widths(mono)).toEqual([expect.closeTo(36, 6), expect.closeTo(36, 6)])
            expect(widths(text_)[1]!).toBeGreaterThan(widths(text_)[0]! * 2)
            // The title keeps the font of the list.
            expect(mono.title!.bounds().width).toBe(text_.title!.bounds().width)
            expect(serif.title!.bounds().width).not.toBe(text_.title!.bounds().width)
            expect(widths(serif)).toEqual(widths(mono))
            // A detail in mono stands on the baseline of the name, with no shift.
            expect(mono.rows[0]!.detail!.get('y')).toBe(0)
            expect(text_.rows[0]!.detail!.get('y')).not.toBe(0)
        }))
    })

    it('takes the font of the film for its title, its footer and its details, and measures its rows in it', async () => {
        const rows = [{ id: 1, name: 'HHHH', detail: 'a (detail), jpg' }, { id: 2, name: 'HHHH', detail: 'mmmm' }]
        const options = { title: 'event history', footer: (count: number) => `${count} events`, visible: 4, size: 20, width: 700 }
        const widths = (log: Log) => [log.title!.bounds().width, log.rows[0]!.detail!.bounds().width, log.rows[0]!.name.bounds().width, log.pitch]
        let serif!: number[], named!: number[], own!: number[], late!: number[], usual!: number[]
        await compileFilm(film({ font: 'text-serif' }, (s) => {
            const log = s.add(eventLog(rows, options))
            serif = widths(log)
            // A font that the list names wins over the font of the film.
            own = widths(eventLog(rows, { ...options, font: 'sans' }))
            // A row that arrives later is in the font of the first rows.
            s.play(log.append({ id: 3, name: 'HHHH', detail: 'a (detail), jpg' }))
            late = [log.rows[2]!.detail!.bounds().width]
        }))
        await compileFilm(film(() => {
            named = widths(eventLog(rows, { ...options, font: 'text-serif' }))
            usual = widths(eventLog(rows, options))
        }))
        // In a film with a font, the list is as a list that names that font: the same texts, and the same height of a row.
        expect(serif).toEqual(named)
        expect(late[0]).toBe(serif[1])
        // The name is in mono in any film. The film that names no font has the list as it was.
        expect(serif[2]).toBe(usual[2])
        expect(own).toEqual(usual)
        expect(serif[0]).not.toBe(usual[0])
        expect(serif[3]).not.toBe(usual[3])
    })

    it('arrives with its panel first, and then its rows, with the outline of the focus', async () => {
        let log!: Log
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            log = eventLog(some(1, 6), { title: 'log', footer: (count) => `${count} rows`, visible: 5, size: 20 })
            s.wait(1)
            s.play(log.enter(), log.focus(5), { duration: 2, ease: linear })
            s.wait(1)
            expect(log.enter().duration).toBe(0.8)
        }))
        expect((await compiled.frame(0.5)).ops).toHaveLength(0)
        // The panel, the rules, the title and the footer have the first half of the time.
        for (const part of [log.frame, ...log.rules, log.title!, log.footer!]) expect(at(1.5, () => shows(part))).toBeCloseTo(0.5, 6)
        // The rows and the count of the rows above come as one, from a fifth of the time to its end.
        const parts = [log.earlier, ...log.rows]
        expect(at(1.4, () => parts.map(shows))).toEqual([0, 0, 0, 0, 0])
        expect(at(2.2, () => parts.map(shows))).toEqual(Array(5).fill(expect.closeTo(0.5, 6)))
        expect(at(3, () => parts.map(shows))).toEqual([1, 1, 1, 1, 1])
        expect(seen(log, 3)).toEqual(['3', '4', '5', '6'])
        // The outline comes with the rows, and is never stronger than its row.
        expect(at(2.2, () => shows(log.outline))).toBeCloseTo(0.5 * 0.6, 6)
        expect(at(3, () => shows(log.outline))).toBe(1)
        // The list was not on the stage: `enter()` puts it there.
        expect((await compiled.frame(3.5)).ops.length).toBeGreaterThan(40)
    })

    it('gives a copy its own rows and its own record of them', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            const log = eventLog(some(1, 5), { footer: (count) => `${count} rows`, visible: 5, size: 20 })
            s.add(log)
            s.play(seq(log.append(some(6, 6)), log.fold([4, 5], 'pair'), log.unfold(4), log.focus(6)), { duration: 0 })
            const copy = log.clone()
            expect(copy.rows).toHaveLength(log.rows.length)
            copy.rows.forEach((row, index) => expect(row).not.toBe(log.rows[index]))
            expect(copy.rows.map((row) => words(row.idText))).toEqual(log.rows.map((row) => words(row.idText)))
            expect(copy.all()).toContain(copy.row(6))
            expect(copy.all()).not.toContain(log.row(6))
            // A change of the copy leaves the list as it was.
            s.add(copy)
            // The copy keeps the focus: its outline is on row 6, and goes out there when the focus moves.
            const start = s.time
            expect(shows(copy.outline)).toBe(1)
            expect(copy.outline.get('y')).toBeCloseTo(copy.row(6).get('y'), 0)
            s.play(copy.focus(3), { duration: 1, ease: linear })
            expect(at(start + 0.25, () => [shows(copy.outline), Math.round(copy.outline.get('y') - copy.row(6).get('y'))])).toEqual([0.5, 0])
            expect(at(start + 1, () => [shows(copy.outline), Math.round(copy.outline.get('y') - copy.row(3).get('y'))])).toEqual([1, 0])
            expect(at(start + 1, () => shows(log.outline))).toBe(1)
            // The copy keeps the fold that was open: it closes with no label, as in the list.
            s.play(copy.fold([4, 5]), { duration: 1 })
            expect(copy.row(5)).toBe(copy.row(4))
            expect(log.row(5)).not.toBe(log.row(4))
            s.play(seq(copy.append(some(7, 7)), copy.mark(6, 'failed')), { duration: 1 })
            expect(copy.count).toBe(7)
            expect(log.count).toBe(6)
            expect(log.ids).toEqual([1, 2, 3, 4, 5, 6])
            expect(ink(log.row(6).name)).toEqual(parseColor('purple'))
            // The footer of the copy starts from the count of the list, with no change behind it.
            expect(said(copy.footer!, s.time)).toEqual(['7 rows'])
            expect(said(log.footer!, s.time)).toEqual(['6 rows'])
            // A copy that the film does not focus again: its outline goes with its row, and with the record of the focus into a fold.
            const second = s.add(log.clone())
            s.play(second.append(some(7, 7)), { duration: 1 })
            expect([shows(second.outline), Math.round(second.outline.get('y') - second.row(6).get('y'))]).toEqual([1, 0])
            expect(Math.round(log.outline.get('y') - second.outline.get('y'))).toBe(Math.round(log.pitch))
            s.play(second.fold([5, 6], 'pair'), { duration: 1 })
            expect([shows(second.outline), Math.round(second.outline.get('y') - second.row(5).get('y'))]).toEqual([1, 0])
            expect(second.row(5).range).not.toBeNull()
            // A copy of a list that `scrollTo` moved keeps the window: a fold in the copy leaves the window there, as in the list.
            const moved = s.add(eventLog(some(1, 12), { visible: 5, size: 20 }))
            s.play(moved.scrollTo(3), { duration: 0 })
            const still = s.add(moved.clone())
            expect(still.rows.map((row) => words(row.idText))).toEqual(['3', '4', '5'])
            expect([said(still.earlier, s.time), said(still.later, s.time)]).toEqual([['2 earlier'], ['7 later']])
            s.play(still.fold([4, 5], 'pair'), { duration: 0.5 })
            expect(still.rows.map((row) => words(row.idText))).toEqual(['3', '4', '6'])
            expect([said(still.earlier, s.time), said(still.later, s.time)]).toEqual([['2 earlier'], ['6 later']])
            // The list writes its counts again, from its own lines: the change of the copy is not in them.
            s.play(moved.show(3), { duration: 0 })
            expect([said(moved.earlier, s.time), said(moved.later, s.time)]).toEqual([['2 earlier'], ['7 later']])
            // The copy has no change behind it: it can change its rows while the list is still in its last change.
            const busy = s.add(eventLog(some(1, 3), { visible: 8, size: 20 }))
            const from = s.time
            s.play(busy.append(some(4, 4)), { duration: 2 })
            const free = s.add(busy.clone())
            s.at(from + 1, () => s.play(free.append(some(5, 5)), { duration: 0.5 }))
            expect(free.ids).toEqual([1, 2, 3, 4, 5])
            expect(busy.ids).toEqual([1, 2, 3, 4])
        }))
    })

    it('keeps text off text and lines off text while rows scroll, fold and unfold, and while the focus moves', async () => {
        const report = await checkFilm(film({ fps: 15 }, (s) => {
            const log = s.add(eventLog([...history, { id: 8, name: 'TimerStarted', shown: false }], { title: 'event history', footer: (count) => `${count} events`, visible: 6, size: 30, width: 860 }))
            s.play(log.show(8), log.focus(8), { duration: 0.8 })
            s.play(log.append(some(9, 10)), log.focus(10), { duration: 1.4 })
            s.play(log.focus(7), { duration: 0.6 })
            s.play(log.fold([5, 6, 7], 'activity'), { duration: 1 })
            s.play(log.append(some(11, 13), { lag: 0.5 }), { duration: 1.6 })
            s.play(log.scrollTo(3), log.focus(3), { duration: 1 })
            s.play(log.fold([1, 2, 3, 4], 'start'), { duration: 1 })
            s.play(log.unfold(5), { duration: 1 })
            s.play(log.scrollTo(13), { duration: 1 })
            s.play(log.append(some(14, 17), { lag: 0 }), log.focus(null), { duration: 1 })
            s.play(log.scrollTo(1), { duration: 0.8 })
        }), { motion: true, readingSpeed: 0 })
        expect(report.diagnostics).toEqual([])
    })

    it('names what is wrong with a row, an id, a fold or an option', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            expect(() => eventLog([{ id: 1, name: 'a' }, { id: 1, name: 'b' }])).toThrow(/two rows have the id 1\. Give each row its own id/)
            expect(() => eventLog([{ id: 1, name: 'a' }, { id: '1', name: 'b' }])).toThrow(/two rows have the id "1"/)
            expect(() => eventLog([{ id: Number.NaN, name: 'a' }])).toThrow(/the id of a row is null\. An id is a number or a text/)
            expect(() => eventLog([{ id: ' ', name: 'a' }])).toThrow(/the id of a row is " "/)
            expect(() => eventLog([{ id: 1, name: ' ' }])).toThrow(/row 1 has no name/)
            expect(() => eventLog([{ id: 1, name: 'two\nlines' }])).toThrow(/the name of row 1 has a line break or a tab/)
            expect(() => eventLog([{ id: 1, name: 'a', detail: 'a\tb' }])).toThrow(/the detail of row 1 has a line break or a tab/)
            expect(() => eventLog([{ id: 1, name: 'a', state: 'done' }])).toThrow(/row 1 has the state "done"\. The states are stored, new, answered, waiting, failed/)
            expect(() => eventLog([], { size: 0 })).toThrow(/size is a text size, more than 0/)
            expect(() => eventLog([], { width: Number.NaN })).toThrow(/width is the width of the panel, more than 0/)
            expect(() => eventLog([], { visible: 1 })).toThrow(/visible is the number of lines in the window, a whole number, 2 or more/)
            expect(() => eventLog([], { visible: 2.5 })).toThrow(/visible is the number of lines/)
            expect(() => eventLog([], { idWidth: 0 })).toThrow(/idWidth is the room of the ids, more than 0/)
            expect(() => eventLog([], { size: 20, width: 100 })).toThrow(/a width of 100 leaves 11 px for the names, and a name needs 60\. Raise `width`, or lower `size`/)
            expect(() => eventLog([], { size: 20, width: 400, nameWidth: 20 })).toThrow(/nameWidth is 20\. It is the room of the names, 60 px or more at this size/)
            expect(() => eventLog([], { size: 20, width: 400, nameWidth: 400 })).toThrow(/nameWidth is 400, and the panel has 311 px after the ids\. Lower `nameWidth`, or raise `width`/)
            expect(() => eventLog([], { size: 20, width: 300, title: 'a title with too many words for a panel of this width' })).toThrow(/the title is \d+ px wide, and the panel has 268 px\. Use a shorter text, or raise `width`/)
            expect(() => eventLog([], { title: 'two\nlines' })).toThrow(/the title has a line break/)
            // An id that is wider than the room of the ids, at the start and later. `idWidth` gives the room.
            expect(() => eventLog([{ id: 1000, name: 'a' }], { size: 20, idWidth: 24 })).toThrow(/the id 1000 is 48 px wide, and the ids have 24 px\. Set `idWidth` to 48 or more/)
            const log = s.add(eventLog(history, { visible: 8, size: 20 }))
            expect(() => log.append({ id: 100, name: 'a' })).toThrow(/the id 100 is 36 px wide, and the ids have 24 px\. Set `idWidth` to 36 or more/)
            expect(eventLog([{ id: 1, name: 'a' }], { size: 20, idWidth: 48 }).append({ id: 1000, name: 'b' }).label).toBe('eventLog.append')
            expect(words(eventLog([{ id: 1000, name: 'a' }], { size: 20 }).rows[0]!.idText)).toBe('1000')
            expect(() => log.append({ id: 8, name: 'a', state: 'done' })).toThrow(/row 8 has the state "done"/)
            // A lag or a duration that is not a number would lose rows with no error.
            expect(() => log.append(some(8, 9), { lag: Number.NaN })).toThrow(/the lag of append\(\[8, 9\]\) is NaN\. Give a number, 0 or more/)
            expect(() => log.append(some(8, 9), { duration: -1 })).toThrow(/the duration of append\(\[8, 9\]\) is -1\. Give a number, 0 or more/)
            expect(() => log.mark(1, 'answered', { lag: Number.NaN })).toThrow(/the lag of mark\(\) is NaN/)
            expect(() => log.fold([1, 2], 'x', { duration: Number.POSITIVE_INFINITY })).toThrow(/the duration of fold\(\[1, 2\]\) is Infinity/)
            expect(() => log.unfold(1, { duration: Number.NaN })).toThrow(/the duration of unfold\(1\) is NaN/)
            expect(() => log.focus(1, { duration: Number.NaN })).toThrow(/the duration of focus\(\) is NaN/)
            expect(() => log.show(1, { lag: -2 })).toThrow(/the lag of show\(\) is -2/)
            expect(() => log.scrollTo(1, { duration: Number.NaN })).toThrow(/the duration of scrollTo\(1\) is NaN/)
            expect(() => log.enter({ duration: Number.NaN })).toThrow(/the duration of enter\(\) is NaN/)
            expect(() => s.play(log.append(some(8, 9)), { duration: Number.NaN })).toThrow(/append\(\[8, 9\]\) plays from \d+(\.\d+)? to NaN\. Give the play a duration that is a number, 0 or more/)
            expect(log.count).toBe(7)
            // A wrong state is found when the film makes the change. A wrong id is found when the film plays it:
            // the row can come from a change before it in the same sequence.
            expect(() => log.mark(1, 'done')).toThrow(/no state "done"\. The states are stored, new, answered, waiting, failed/)
            expect(() => s.play(log.mark(99, 'answered'))).toThrow(/no row has the id 99\. The list has the ids 1 to 7/)
            expect(() => s.play(log.mark([1, 'x'], 'answered'))).toThrow(/no row has the id "x"/)
            expect(() => s.play(log.focus(99))).toThrow(/no row has the id 99/)
            expect(() => log.row(99)).toThrow(/no row has the id 99/)
            expect(() => log.p(99)).toThrow(/no row has the id 99/)
            expect(() => eventLog([]).row(1)).toThrow(/no row has the id 1\. The list is empty/)
            expect(() => eventLog([{ id: 'a', name: 'x' }]).row(1)).toThrow(/no row has the id 1\. The list has one row, "a"/)
            expect(() => log.fold([2], 'one')).toThrow(/a fold takes two rows or more, and got 1/)
            expect(() => log.fold([2, 3, '2'], 'twice')).toThrow(/the fold names row "2" twice/)
            expect(() => log.fold([2, 3], 'two\nlines')).toThrow(/the name of a fold has a line break/)
            expect(() => log.fold([2, 3], ' ')).toThrow(/the fold has no name\. Give a label, such as fold\(\[2, 3, 4\], 'workflow task'\)/)
            expect(() => log.fold([2, 3], { name: 'pair', state: 'done' })).toThrow(/no state "done"/)
            expect(() => log.fold([2, 3], { name: 'pair', detail: 'two\nlines' })).toThrow(/the detail of a fold has a line break/)
            expect(() => s.play(log.fold([2, 99], 'none'))).toThrow(/no row has the id 99/)
            expect(() => s.play(log.fold([2, 4], 'gap'))).toThrow(/the rows of a fold follow each other, and row 3 is between 2 and 4 and not in the fold\. Add it, or make two folds/)
            expect(() => s.play(log.fold([5, 6], { name: 'pair', time: '+1 s' }))).toThrow(/the fold from 5 to 6 has the time "\+1 s", and the list has no column for times/)
            // A row that stands for several records: its ids, and the rows that it opens into.
            expect(() => eventLog([{ name: 'a' } as never])).toThrow(/a row has no id\. Give it an `id`, or the `ids` that it stands for/)
            expect(() => eventLog([{ ids: [], name: 'a' }])).toThrow(/a row has no id/)
            expect(() => eventLog([{ id: 3, ids: [2, 3, 4], name: 'a' }])).toThrow(/a row has the id 3, and its ids start at 2\. The id of a fold is the first of its ids/)
            expect(() => eventLog([{ ids: [2, 3], name: 'a' }, { id: 3, name: 'b' }])).toThrow(/two rows have the id 3/)
            expect(() => eventLog([{ ids: [2, 2], name: 'a' }])).toThrow(/two rows have the id 2/)
            expect(() => eventLog([{ ids: [2, 3], name: ' ' }])).toThrow(/the fold from 2 to 3 has no name/)
            expect(() => eventLog([{ ids: [2, 3], name: 'a', state: 'done' }])).toThrow(/the fold from 2 to 3 has the state "done"/)
            expect(() => eventLog([{ ids: [2, 3], name: 'a', rows: [{ id: 2, name: 'b' }] }])).toThrow(/the fold from 2 to 3 has the ids 2, 3, and its rows have the ids 2\. Give one row for each id, in order/)
            expect(() => eventLog([{ ids: [2, 3], name: 'a', rows: [{ id: 3, name: 'b' }, { id: 2, name: 'c' }] }])).toThrow(/its rows have the ids 3, 2/)
            expect(() => eventLog([{ ids: [2, 3, 4], name: 'a', rows: [{ id: 2, name: 'b' }, { ids: [3, 4], name: 'c' }] } as never])).toThrow(/its rows have the ids 2, 3/)
            expect(() => eventLog([{ ids: [2, 3], name: 'a', rows: [{ id: 2, name: 'b' }, { ids: [3, 9], name: 'c' }] } as never])).toThrow(/the fold from 3 to 9 is a row of the fold from 2 to 3\. A row of a fold has one id/)
            expect(() => eventLog([{ ids: [2, 3], name: 'a', rows: [{ id: 2, name: 'b' }, { id: 3, name: 'c', state: 'done' }] }])).toThrow(/row 3 has the state "done"/)
            expect(() => eventLog([{ id: 2, name: 'a', rows: [{ id: 2, name: 'b' }] } as never])).toThrow(/row 2 has `rows`, and one id\. Give it the `ids` that it stands for/)
            expect(() => log.append({ ids: [8, 100], name: 'a' })).toThrow(/the id 100 is 36 px wide/)
            expect(() => s.play(log.unfold(2))).toThrow(/no fold starts at row 2\. The list has no fold/)
            s.play(log.fold([2, 3, 4], 'workflow task'))
            expect(() => s.play(log.fold([4, 5], 'again'))).toThrow(/row 4 is already in the fold from 2 to 4\. Open that fold first, with unfold\(2\)/)
            expect(() => s.play(log.fold([2, 3, 4]))).toThrow(/row 2 is already in the fold from 2 to 4/)
            expect(() => s.play(log.unfold(3))).toThrow(/no fold starts at row 3\. The folds start at 2/)
            expect(() => s.play(log.unfold(99))).toThrow(/no row has the id 99/)
            // A refused change leaves the list as it was.
            expect(log.count).toBe(7)
            expect(log.rows).toHaveLength(5)
        }))
    })
})

describe('chip', () => {
    it('fits its box to its label, with the same room at both sides and the label in the middle', async () => {
        await compileFilm(film(() => {
            for (const content of ['i', 'virtio', 'a long label with a jumpy g and a q']) {
                const made = chip(content, { size: 30 }).at(200, 100)
                const frame = made.frame.bounds(), ink = made.text.bounds()
                expect(frame.width).toBeCloseTo(Math.round(textWidth(content, 30, { font: 'sans' }) + 30 * 1.7), 6)
                expect(frame.height).toBe(Math.round(30 * 2.3))
                // The box starts at the place that the chip is given, as a tag and a row of chips do.
                expect(made.box).toEqual({ x: 0, y: -frame.height / 2, width: frame.width, height: frame.height })
                expect(frame.x).toBeCloseTo(200, 6)
                // The ink of the label is inside the border, with more than half a font size at each side.
                expect(ink.x - frame.x).toBeGreaterThan(15)
                expect(frame.x + frame.width - ink.x - ink.width).toBeGreaterThan(15)
                expect(Math.abs((ink.x - frame.x) - (frame.x + frame.width - ink.x - ink.width))).toBeLessThan(3)
                expect(ink.y).toBeGreaterThan(frame.y)
                expect(ink.y + ink.height).toBeLessThan(frame.y + frame.height)
            }
        }))
    })

    it('places its left end, and with an anchor its middle or its right end, as a tag and a row of chips do', async () => {
        await compileFilm(film(() => {
            const left = chip('virtio').at(100, 0), middle = chip('virtio', { anchor: 'center' }).at(100, 0), right = chip('virtio', { anchor: 'right' }).at(100, 0)
            const width = middle.box.width
            expect(left.frame.bounds().x).toBeCloseTo(100, 6)
            expect(chip('virtio', { anchor: 'left' }).at(100, 0).frame.bounds().x).toBeCloseTo(100, 6)
            expect(middle.frame.bounds().x).toBeCloseTo(100 - width / 2, 6)
            expect(right.frame.bounds().x + width).toBeCloseTo(100, 6)
            expect(left.box.x).toBe(0)
            expect(middle.box.x).toBe(-width / 2)
            expect(right.box.x).toBe(-width)
            // The three objects that take their width from their text have one rule: a tag and a row start at x too.
            const pill = tag('virtio').at(100, 0), row = chipRow(['virtio', 'KVM']).at(100, 0)
            expect(pill.pill.bounds().x).toBeCloseTo(100, 6)
            expect(row.chips[0]!.frame.bounds().x).toBeCloseTo(100, 6)
            // With the anchor at the right, each of the three ends at x.
            const ends = (node: { bounds(): { x: number; width: number } }) => node.bounds().x + node.bounds().width
            expect(ends(tag('virtio', { anchor: 'right' }).at(100, 0).pill)).toBeCloseTo(100, 6)
            expect(ends(tag('virtio', { anchor: 'right', note: 'a note' }).at(100, 0))).toBeCloseTo(100, 0)
            expect(ends(chipRow(['virtio', 'KVM'], { anchor: 'right' }).at(100, 0).chips[1]!.frame)).toBeCloseTo(100, 6)
            // With the anchor in the middle, the middle of each is at x.
            const middleOf = (node: { bounds(): { x: number; width: number } }) => node.bounds().x + node.bounds().width / 2
            expect(middleOf(tag('virtio', { anchor: 'center' }).at(100, 0).pill)).toBeCloseTo(100, 6)
            const centered = chipRow(['virtio', 'KVM', 'a longer chip'], { anchor: 'center', maxWidth: 260 }).at(100, 0)
            expect(centered.box.x).toBe(-centered.box.width / 2)
            // Each line of a row with its middle at x has its own middle there.
            const tops = [...new Set(centered.chips.map((made) => made.frame.bounds().y))]
            expect(tops.length).toBeGreaterThan(1)
            for (const top of tops) {
                const line = centered.chips.filter((made) => made.frame.bounds().y === top).map((made) => made.frame.bounds())
                expect((line[0]!.x + line[line.length - 1]!.x + line[line.length - 1]!.width) / 2).toBeCloseTo(100, 6)
            }
            // The label moves with the box.
            expect(left.text.bounds().x - left.frame.bounds().x).toBeCloseTo(middle.text.bounds().x - middle.frame.bounds().x, 6)
        }))
    })

    it('takes a least width, a height in font sizes, and round ends', async () => {
        await compileFilm(film(() => {
            expect(chip('ok', { minWidth: 260 }).box.width).toBe(260)
            expect(chip('a label that is wider than the least width', { minWidth: 100 }).box.width).toBeGreaterThan(100)
            expect(chip('ok', { size: 30, height: 2.6 }).box.height).toBe(78)
            // A pill has the same box as a chip with corners. Only the path of its border differs.
            const round = chip('ok', { round: true }), square = chip('ok')
            expect(round.box).toEqual(square.box)
            expect(pathToD(round.frame.get('path')!)).not.toBe(pathToD(square.frame.get('path')!))
            expect(() => chip('  ')).toThrow('chip: give it a label')
            expect(() => chip('ok', { height: 1.2 })).toThrow('a height of 1.2 font sizes leaves no room around the label. Use 1.4 or more')
        }))
    })

    it('takes the room at the sides of its label, in font sizes', async () => {
        await compileFilm(film(() => {
            const label = textWidth('VISION', 50, { font: 'text-serif' })
            // The default is 1.7 font sizes for the two sides together. A pill with round ends reads well with 1.5.
            expect(chip('VISION', { size: 50, font: 'text-serif' }).box.width).toBe(Math.round(label + 50 * 1.7))
            expect(chip('VISION', { size: 50, font: 'text-serif', room: 1.5 }).box.width).toBe(Math.round(label + 50 * 1.5))
            expect(() => chip('VISION', { room: 0.5 })).toThrow('a room of 0.5 font sizes at the sides leaves the label on the border. Use 1 or more')
        }))
    })

    it('draws its label in the font that it is given, and sizes its box for that font', async () => {
        await compileFilm(film(() => {
            const content = 'one process for each microVM'
            const serif = chip(content, { font: 'text-serif', size: 30 }), sans = chip(content, { size: 30 })
            // The ink of the label is as wide as the same text in the same font. The two fonts differ by many pixels.
            expect(serif.text.bounds().width).toBeCloseTo(text(content, { font: 'text-serif', size: 30 }).bounds().width, 6)
            expect(sans.text.bounds().width).toBeCloseTo(text(content, { size: 30 }).bounds().width, 6)
            expect(Math.abs(serif.text.bounds().width - sans.text.bounds().width)).toBeGreaterThan(10)
            expect(serif.box.width).toBe(Math.round(textWidth(content, 30, { font: 'text-serif' }) + 30 * 1.7))
        }))
    })
})

describe('chip row', () => {
    const names = ['KVM', 'seccomp', 'cgroups', 'namespaces', 'virtio', 'a jailer', 'rate limiters']

    it('lays the chips out from its left end, one gap apart, in the order given', async () => {
        await compileFilm(film(() => {
            const row = chipRow(names, { gap: 20 }).at(-300, 40)
            expect(row.chips.map((made) => (made.text as unknown as { source: string }).source)).toEqual(names)
            expect(row.chips[0]!.frame.bounds().x).toBeCloseTo(-300, 6)
            row.chips.slice(1).forEach((made, index) => {
                const before = row.chips[index]!.frame.bounds()
                expect(made.frame.bounds().x).toBeCloseTo(before.x + before.width + 20, 6)
                expect(made.frame.bounds().y).toBeCloseTo(before.y, 6)
            })
            const last = row.chips[row.chips.length - 1]!.frame.bounds()
            expect(row.box.width).toBeCloseTo(last.x + last.width + 300, 6)
            expect(row.box).toMatchObject({ x: 0, y: -row.chips[0]!.box.height / 2, height: row.chips[0]!.box.height })
        }))
    })

    it('starts a new line when the next chip would pass its width, and its box covers every line', async () => {
        await compileFilm(film(() => {
            const row = chipRow(names, { maxWidth: 420, lineGap: 10 }).at(0, 0)
            const tops = [...new Set(row.chips.map((made) => made.frame.bounds().y))]
            expect(tops.length).toBeGreaterThan(1)
            const height = row.chips[0]!.box.height
            tops.forEach((top, line) => expect(top).toBeCloseTo(-height / 2 + line * (height + 10), 6))
            for (const made of row.chips) {
                const frame = made.frame.bounds()
                expect(frame.x).toBeGreaterThanOrEqual(0)
                expect(frame.x + frame.width).toBeLessThanOrEqual(420)
            }
            // Each line starts at the left end.
            for (const top of tops) expect(Math.min(...row.chips.filter((made) => made.frame.bounds().y === top).map((made) => made.frame.bounds().x))).toBeCloseTo(0, 6)
            expect(row.box.height).toBeCloseTo(tops.length * height + (tops.length - 1) * 10, 6)
            expect(row.box.width).toBeLessThanOrEqual(420)
            // One line more fits when the row is wider.
            expect(new Set(chipRow(names, { maxWidth: 900 }).chips.map((made) => made.frame.bounds().y)).size).toBeLessThan(tops.length)
        }))
    })

    it('keeps a chip that ends exactly at the width on its line, and wraps only with a width', async () => {
        await compileFilm(film(() => {
            const one = chipRow(names, { gap: 20 })
            // Without a width, the row is one line, however long it is.
            expect(new Set(one.chips.map((made) => made.frame.bounds().y)).size).toBe(1)
            const two = one.chips[0]!.box.width + 20 + one.chips[1]!.box.width
            const exact = chipRow(names.slice(0, 2), { gap: 20, maxWidth: two })
            expect(exact.chips[1]!.frame.bounds().y).toBe(exact.chips[0]!.frame.bounds().y)
            expect(chipRow(names.slice(0, 2), { gap: 20, maxWidth: two - 1 }).chips[1]!.frame.bounds().y).toBeGreaterThan(exact.chips[0]!.frame.bounds().y)
        }))
    })

    it('keeps the chips and the lines apart by default, by gaps that follow the font size', async () => {
        await compileFilm(film(() => {
            for (const size of [28, 56]) {
                const row = chipRow(names, { size, maxWidth: size * 20 })
                const first = row.chips[0]!.frame.bounds(), second = row.chips[1]!.frame.bounds()
                expect(second.x - (first.x + first.width)).toBe(Math.round(size * 0.5))
                const below = row.chips.find((made) => made.frame.bounds().y > first.y)!.frame.bounds()
                expect(below.y - (first.y + first.height)).toBe(Math.round(size * 0.43))
            }
        }))
    })

    it('gives one chip its own colors, and refuses a chip that is wider than the row', async () => {
        await compileFilm(film(() => {
            const row = chipRow(['KVM', { text: 'virtio', color: 'green', stroke: 'green' }], { stroke: 'grid' })
            expect(row.chips[1]!.frame.get('stroke')).not.toEqual(row.chips[0]!.frame.get('stroke'))
            expect(row.chips[1]!.text.children[0]!.get('fill')).toEqual(row.chips[1]!.frame.get('stroke'))
            expect(() => chipRow(['a chip that is much wider than the row that holds it'], { maxWidth: 200 })).toThrow(/the chip "a chip that is much wider than the row that holds it" is \d+ wide, and the row is 200 wide/)
            expect(() => chipRow([])).toThrow('chipRow: give it at least one chip')
        }))
    })
})

describe('named box', () => {
    it('keeps a name that fits at its size, in the middle of a box of the size given', async () => {
        await compileFilm(film(() => {
            const made = namedBox('guest', { width: 300, height: 120, size: 32 }).at(50, 80)
            const frame = made.frame.bounds(), name = made.name.bounds()
            expect(frame).toMatchObject({ x: -100, y: 20, width: 300, height: 120 })
            expect(name.height).toBeCloseTo(text('guest', { size: 32 }).bounds().height, 6)
            expect(Math.abs(name.x + name.width / 2 - 50)).toBeLessThan(2)
            expect(name.y).toBeGreaterThan(frame.y)
            expect(name.y + name.height).toBeLessThan(frame.y + frame.height)
            expect(made.sub).toBeNull()
        }))
    })

    it('sets a name smaller when it is too wide, so that it stays inside the border with room at both sides', async () => {
        await compileFilm(film(() => {
            const made = namedBox('virtual machine monitor', { width: 300, height: 120, size: 32 })
            const frame = made.frame.bounds(), name = made.name.bounds()
            expect(name.height).toBeLessThan(text('virtual machine monitor', { size: 32 }).bounds().height)
            // The room at each side is the height of a capital letter of the size that the film asked for.
            expect(name.x - frame.x).toBeGreaterThan(20)
            expect(frame.x + frame.width - name.x - name.width).toBeGreaterThan(20)
        }))
    })

    it('fits the name in the font of the box', async () => {
        await compileFilm(film(() => {
            // This name fits a width of 330 in the text font, and not in the default font, which is wider.
            const name = 'one process for each VM'
            const serif = namedBox(name, { width: 330, height: 120, size: 26, font: 'text-serif' }), sans = namedBox(name, { width: 330, height: 120, size: 26 })
            expect(serif.name.bounds().height).toBeCloseTo(text(name, { font: 'text-serif', size: 26 }).bounds().height, 6)
            expect(sans.name.bounds().height).toBeLessThan(text(name, { size: 26 }).bounds().height)
        }))
    })

    it('gives the boxes of one group one text size, so that twin boxes do not differ', async () => {
        await compileFilm(film(() => {
            const names = ['frontend', 'virtual machine monitor'], look = { width: 300, height: 120, size: 32 }
            const height = (made: { name: { bounds(): { height: number } } }, sample: string) => made.name.bounds().height / text(sample, { size: 32 }).bounds().height
            // Alone, the short name keeps its size and the long name is set smaller.
            const alone = names.map((name) => namedBox(name, look))
            expect(height(alone[0]!, names[0]!)).toBeCloseTo(1, 6)
            expect(height(alone[1]!, names[1]!)).toBeLessThan(0.8)
            // In a group, both have the size of the long name.
            const twins = names.map((name) => namedBox(name, { ...look, group: names }))
            expect(height(twins[0]!, names[0]!)).toBeCloseTo(height(alone[1]!, names[1]!), 6)
            expect(height(twins[1]!, names[1]!)).toBeCloseTo(height(alone[1]!, names[1]!), 6)
            // A name of the group that cannot fit stops every box of the group, and the error names it.
            expect(() => namedBox('frontend', { ...look, group: ['frontend', 'a name that is much wider than its box can hold'] })).toThrow(/"a name that is much wider than its box can hold" needs a size of \d+ to fit a box of 300 by 120/)
        }))
    })

    it('stops when a name or a second line would be too small to read', async () => {
        await compileFilm(film(() => {
            expect(() => namedBox('a name that is much wider than its box can hold', { width: 300, height: 120 }))
                .toThrow(/"a name that is much wider than its box can hold" needs a size of \d+ to fit a box of 300 by 120, and the size is 32. Shorten the text, or make the box larger/)
            expect(() => namedBox('guest', { width: 300, height: 120, sub: 'a second line that is much wider than the box can hold at a size to read' })).toThrow(/"a second line that is much wider.*" needs a size of \d+ .* and the size is 23/)
            expect(() => namedBox('guest', { width: 40, height: 120 })).toThrow('a width of 40 leaves no room for the name "guest" at size 32')
            expect(() => namedBox(' ', { width: 300, height: 120 })).toThrow('namedBox: give it a name')
            expect(() => namedBox('guest', { width: 300, height: 0 })).toThrow('the box "guest" needs a width and a height over 0')
        }))
    })

    it('puts a second line under the name, and shrinks both in a low box so that they stay inside', async () => {
        await compileFilm(film(() => {
            // The boxes are away from the origin, so a part that is not a child of its box would stay behind.
            const roomy = namedBox('host kernel', { width: 300, height: 120, sub: 'Linux 6.1' }).at(500, 300)
            const low = namedBox('host kernel', { width: 300, height: 60, sub: 'Linux 6.1' }).at(-500, -300)
            for (const made of [roomy, low]) {
                const frame = made.frame.bounds(), name = made.name.bounds(), sub = made.sub!.bounds()
                expect(name.y).toBeGreaterThan(frame.y)
                expect(sub.y + sub.height).toBeLessThan(frame.y + frame.height)
                // The second line starts under the letters of the name.
                expect(sub.y).toBeGreaterThan(name.y + name.height * 0.6)
                expect(sub.height).toBeLessThan(name.height)
                expect(Math.abs(sub.x + sub.width / 2 - (frame.x + frame.width / 2))).toBeLessThan(2)
            }
            expect(low.name.bounds().height).toBeLessThan(roomy.name.bounds().height)
            expect(low.sub!.bounds().height).toBeLessThan(roomy.sub!.bounds().height)
        }))
    })

    it('takes the color of the border for the name, a color for the name alone, and a light fill', async () => {
        await compileFilm(film(() => {
            const plain = namedBox('guest', { width: 300, height: 120, color: 'red' })
            expect(plain.name.children[0]!.get('fill')).toEqual(plain.frame.get('stroke'))
            const own = namedBox('guest', { width: 300, height: 120, color: 'red', nameColor: 'ink' })
            expect(own.name.children[0]!.get('fill')).not.toEqual(own.frame.get('stroke'))
            expect(namedBox('guest', { width: 300, height: 120, fill: 'red', fillOpacity: 0.12 }).frame.get('fillOpacity')).toBe(0.12)
            expect(namedBox('guest', { width: 300, height: 120, fill: null }).frame.get('fill')).toBeNull()
        }))
    })
})

describe('layer stack', () => {
    type Stack = ReturnType<typeof layerStack>
    const edges = (node: Node) => { const box = node.bounds(); return [box.x, box.y, box.x + box.width, box.y + box.height] }
    /** How much of a node a viewer sees: 0 when it or a group that holds it is hidden. */
    const shows = (node: Node): number => {
        let opacity = 1
        for (let up: Node | null = node; up; up = up.parent) {
            if (!up.get('visible')) return 0
            opacity *= up.get('opacity')
        }
        return opacity
    }
    const paint = (color: string) => rect(1, 1, { fill: color, stroke: null }).get('fill')
    const sourceOf = (node: Node | undefined) => (node as unknown as { source?: string } | undefined)?.source
    /** The cells of a vector: its parts but the plate, which is the first, and the holder of the numbers, which is the last. */
    const cells = (vector: Node) => vector.children.slice(1, -1)
    const looks = (vector: Node) => cells(vector).map((cell) => [cell.get('fill'), cell.get('fillOpacity')])
    /** The numbers that a vector shows, and how much of them a viewer sees. */
    const numbers = (vector: Node) => vector.children[vector.children.length - 1]!.children.filter((made) => made.get('visible')).map(sourceOf)
    const numbersShow = (vector: Node) => shows(vector.children[vector.children.length - 1]!)
    const MODEL: readonly StackLayer[] = ['embed', { branch: ['norm', 'attention'] }, 'unembed']
    // The places of MODEL at size 28. The vector is 95 wide and 26 high, a block is 53 high, and the room between two layers is 48.
    const STREAM = -105

    it('shows the residual relative to the output of the parallel block and zero when a pass keeps its values', async () => {
        let stack!: Stack
        await compile((s) => {
            stack = s.add(layerStack([{ branch: ['adapter'], around: 'base' }, { branch: ['attention'] }], { cells: 1, digits: 0 }))
            s.play(stack.feed([2]), { duration: 0 })
            s.play(stack.pass('adapter', [5], { aroundValues: [4] }), { duration: 10 })
            s.play(stack.pass('attention'), { duration: 10 })
        })
        expect(at(8, () => numbers(stack.copy))).toEqual(['1'])
        expect(at(8, () => numbers(stack.vector))).toEqual(['4'])
        expect(at(18, () => numbers(stack.copy))).toEqual(['0'])
        expect(stack.values).toEqual([5])
    })

    it('rejects a residual that will not fit before scheduling the pass, so the author can retry', async () => {
        await compile((s) => {
            const stack = s.add(layerStack([{ branch: ['adapter'] }], { cells: 1, digits: 0, font: 'mono' }))
            s.play(stack.feed([9]))
            expect(() => s.play(stack.pass('adapter', [-9]))).toThrow(/residual.*-18/)
            expect(stack.passed).toBe(0)
            s.play(stack.pass('adapter', [8]))
            expect(stack.values).toEqual([8])
        })
    })

    it('measures the region of a stack and its block inside a rotated parent', async () => {
        await compile((s) => {
            const stack = layerStack(['encoder'])
            s.add(group(stack).rotate(Math.PI / 4))
            expect(stack.region()).toEqual(boxOf(stack))
            const block = stack.region('encoder')
            expect(block.width).toBeCloseTo(block.height)
        })
    })

    it('puts the layers on one stream from the foot up, with a block on the stream as wide as the way of the vector and the blocks of a branch together', async () => {
        await compileFilm(film(() => {
            const stack = layerStack(MODEL)
            expect(stack.ids).toEqual(['embed', 'norm', 'attention', 'unembed'])
            expect([stack.count, stack.depth]).toEqual([4, 3])
            expect(stack.ids.map((id) => stack.layerOf(id))).toEqual([0, 1, 1, 2])
            // The first block is the lowest. The way of the vector is 68 wide at each side of the stream, and the
            // blocks of the branch start where it ends. A block on the stream is as wide as both.
            expect(stack.boxes.map(edges)).toEqual([[-173, 148, 173, 201], [-37, 20, 173, 73], [-37, -50, 173, 3], [-173, -185, 173, -132]])
            expect([stack.foot, stack.head]).toEqual([[STREAM, 255], [STREAM, -255]])
            expect(stack.labels.map(sourceOf)).toEqual(['embed', 'norm', 'attention', 'unembed'])
            expect(stack.labels.map((label) => label.data['size'])).toEqual([28, 28, 28, 28])
            stack.labels.forEach((label, index) => {
                const [x0, , x1] = edges(label), [left, top, right, bottom] = edges(stack.boxes[index]!)
                expect(Math.abs((x0! + x1!) / 2 - (left! + right!) / 2)).toBeLessThan(2)
                expect(label.get('y') + stack.blocks[index]!.get('y')).toBe((top! + bottom!) / 2)
            })
            // The points of the edges of a block, for a line or a note. They are in the coordinates of the object.
            expect(stack.p('attention')).toEqual([173, -23.5])
            expect(stack.p('attention', 'right')).toEqual([173, -23.5])
            expect(stack.p('attention', 'left')).toEqual([-37, -23.5])
            expect(stack.p(2, 'top')).toEqual([68, -50])
            expect(stack.p('embed', 'bottom')).toEqual([0, 201])
            expect(stack.block('norm')).toBe(stack.blocks[1])
            const moved = layerStack(MODEL).at(100, 50)
            expect(moved.p('attention')).toEqual([173, -23.5])
            expect(moved.toWorld(...moved.p('attention'))).toEqual([273, 26.5])
            // In a stack with no branch, the blocks are around the stream.
            const plain = layerStack(['conv', 'pool'])
            expect(plain.boxes.map(edges)).toEqual([[-105, 32, 105, 85], [-105, -69, 105, -16]])
            expect(plain.foot[0]).toBe(0)
            // Another size gives the same picture: each measure follows the text size, and is a whole number of pixels.
            const large = layerStack(MODEL, { size: 56 })
            large.boxes.forEach((box, index) => edges(box).forEach((edge, side) => expect(Math.abs(edge - edges(stack.boxes[index]!)[side]! * 2)).toBeLessThanOrEqual(5)))
            expect(Math.abs(large.foot[0] - STREAM * 2)).toBeLessThanOrEqual(5)
            expect(large.labels[0]!.data['size']).toBe(56)
        }))
    })

    it('measures as its whole width for the layout, with the room of its shapes and of the parts that do not show yet', async () => {
        await compileFilm(film(() => {
            const stack = layerStack(MODEL)
            expect(stack.layoutBox).toEqual([-173, -255, 173, 255])
            const box = boxOf(stack)
            expect([box.left, box.top, box.right, box.bottom]).toEqual([-173, -255, 173, 255])
            // `width` is the width of the whole object: the blocks of the branch take what the way of the vector leaves.
            const wide = layerStack(MODEL, { width: 700 })
            expect(boxOf(wide).width).toBe(700)
            expect(edges(wide.boxes[0]!)).toEqual([-350, 148, 350, 201])
            expect(edges(wide.boxes[2]!)).toEqual([-214, -50, 350, 3])
            // A shape has its room at the left, outside the blocks, and a group has the room of its frame at the two sides.
            const shaped = layerStack(['embed', { repeat: 2, layers: [{ branch: ['attention'], shown: false }] }], { width: 700, shape: '(T, 768)' })
            expect(boxOf(shaped).width).toBe(700)
            expect(shaped.boxes[0]!.bounds().width).toBeLessThan(700 - 34 - 100)
            // The measure does not change with what shows: the shape, the vector and the branch are not there yet.
            expect(shaped.bounds().x).toBeGreaterThan(boxOf(shaped).left + 100)
            const built = fitted(640, (width) => layerStack(MODEL, { width, shape: '(T, 768)' }))
            expect(boxOf(built).width).toBeCloseTo(640, 6)
            // `place` puts the middle of the measure in the middle of a region, and `region()` gives the same box.
            const placed = placeIn(layerStack(MODEL), rect(1000, 900).at(300, -100))
            const region = placed.region()
            expect([region.left, region.top, region.right, region.bottom]).toEqual([127, -355, 473, 155])
            const block = placed.region('norm')
            expect([block.left, block.top, block.right, block.bottom]).toEqual([263, -80, 473, -27])
            // A note beside the stack, at the height of one block.
            const note = beside(text('trains', { size: 30 }), placed, 'right', 'wide', placed.block('norm'))
            expect(boxOf(note).left).toBe(473 + 48)
            expect(boxOf(note).cy).toBeCloseTo(-53.5, 6)
        }))
    })

    it('draws a branch beside the stream: a line from a point of the stream into its first block, lines between its blocks, and a line from its last block to an add on the stream', async () => {
        await compileFilm(film(() => {
            const stack = layerStack(MODEL)
            // The point where the branch leaves the stream is under its first block, and the add is over its last one.
            expect(edges(stack.taps[0]!)).toEqual([STREAM - 6, 88, STREAM + 6, 100])
            expect([stack.adds[0]!.get('x'), stack.adds[0]!.get('y')]).toEqual([STREAM, -71])
            const [read, write, chain] = [edges(stack.reads[0]!), edges(stack.writes[0]!), edges(stack.chains[0]!)]
            // The line in starts on the stream at that point and ends at the bottom edge of "norm", under its middle.
            expect([read[0], read[1], read[3]]).toEqual([STREAM, 73, 94])
            expect(read[2]).toBeGreaterThan(68)
            expect(read[2]).toBeLessThan(68 + 6)
            // The line out starts at the top edge of "attention" and ends at the ring of the add, which is 13 wide.
            expect([write[0], write[3]]).toEqual([STREAM + 13, -50])
            expect(write[1]).toBeGreaterThan(-71 - 6)
            // The line between the two blocks goes from the top edge of "norm" to the bottom edge of "attention".
            expect([chain[1], chain[3]]).toEqual([3, 20])
            expect([stack.taps.length, stack.adds.length, stack.reads.length, stack.writes.length, stack.chains.length]).toEqual([1, 1, 1, 1, 1])
            // The stream is one line from the foot to the arrow head, and the blocks and the add are drawn over it.
            const order = (node: Node) => stack.all().indexOf(node)
            expect(order(stack.stream)).toBeLessThan(order(stack.adds[0]!))
            expect(order(stack.adds[0]!)).toBeLessThan(order(stack.blocks[0]!))
            expect(stack.adds[0]!.children[0]!.get('fill')).toEqual(paint('bg'))

            // A branch around a block on the stream: the block is on the stream, at the middle height of the blocks of the branch.
            const lora = layerStack(['embed', { branch: ['A', 'B'], around: 'W' }])
            expect(lora.ids).toEqual(['embed', 'W', 'A', 'B'])
            const [, w, a, b] = lora.boxes.map(edges)
            expect((w![0]! + w![2]!) / 2).toBe(lora.foot[0])
            expect((w![1]! + w![3]!) / 2).toBe((a![3]! + b![1]!) / 2)
            // It is clear of the blocks of the branch, and it is wider than the vector, which goes behind it.
            expect(a![0]! - w![2]!).toBe(14)
            expect(w![2]! - w![0]!).toBeGreaterThan(95)
            expect(lora.layerOf('W')).toBe(lora.layerOf('B'))
        }))
    })

    it('puts the layers of a group in a frame with its label on the top line, and leaves the place where the vector rests outside the frame', async () => {
        let stack!: Stack
        await compile((s) => {
            stack = s.add(layerStack([
                { repeat: 12, layers: [{ branch: ['attention'] }, 'norm'] },
                { label: 'decoder', repeat: 'N', layers: ['MLP'] },
                { label: 'head', layers: ['linear'] },
                { layers: ['softmax'] },
            ]))
            s.play(stack.feed([1, 1, 1, 1]), { duration: 0.5 })
            s.play(stack.pass('norm'), { duration: 1 })
            s.wait(0.5)
        })
        const said = (frame: Node) => frame.children.map(sourceOf).filter((words) => words !== undefined)
        expect(stack.frames.map(said)).toEqual([['× 12'], ['decoder × N'], ['head'], []])
        const [first, second] = stack.frames.map((frame) => edges(frame.children[0]!))
        // The frame is around the blocks of its layers, with room at each side.
        for (const index of [0, 1]) {
            const box = edges(stack.boxes[index]!)
            expect(first![0]).toBeLessThan(box[0]! - 10)
            expect(first![2]).toBeGreaterThan(box[2]! + 10)
            expect(first![1]).toBeLessThan(box[1]! - 10)
            expect(first![3]).toBeGreaterThan(box[3]! + 10)
        }
        expect(second![3]).toBeLessThan(first![1]!)
        // The label is on the top line of its frame, and it ends before the right edge of the blocks.
        const label = stack.frames[0]!.children[1]!
        expect(label.get('y')).toBe(first![1])
        expect(edges(label)[2]).toBeLessThan(edges(stack.boxes[1]!)[2]!)
        // At the foot, the vector is under the first frame. After the last layer of the group, it is between the two frames.
        const height = at(0.4, () => stack.vector.bounds().height)
        expect(at(0.5, () => stack.vector.get('y')) - height / 2).toBeGreaterThan(first![3]! + 5)
        expect(at(1.9, () => stack.vector.get('y')) + height / 2).toBeLessThan(first![1]! - 5)
        expect(at(1.9, () => stack.vector.get('y')) - height / 2).toBeGreaterThan(second![3]! + 5)
        expect(stack.passed).toBe(2)
    })

    it('names a block by its id or its index, and says what to do with a name that two blocks have', async () => {
        await compileFilm(film(() => {
            const stack = layerStack(['embed', { branch: ['norm', 'attention'] }, { branch: [{ label: 'norm', id: 'norm 2' }, 'MLP'] }, 'norm'])
            expect(stack.ids).toEqual(['embed', 'norm', 'attention', 'norm 2', 'MLP', 'norm'])
            expect(stack.block('norm 2')).toBe(stack.blocks[3])
            expect(stack.block(5)).toBe(stack.blocks[5])
            expect(stack.labelOf(3)).toBe('norm')
            expect(() => stack.block('norm')).toThrow(/layerStack: "norm" names the blocks 1, 5\. Name one by its index, or give each block its own id, such as \{ label: "norm", id: "norm 2" \}/)
            expect(() => stack.p('softmax')).toThrow(/layerStack: no block "softmax"\. The blocks are 0 \("embed"\), 1 \("norm"\), 2 \("attention"\), 3 \("norm 2"\), 4 \("MLP"\), 5 \("norm"\)/)
            expect(() => stack.light(6)).toThrow(/layerStack: no block 6\. The blocks are 0 \("embed"\)/)
            expect(() => stack.stateOf(1.5)).toThrow(/layerStack: no block 1\.5\./)
            expect(() => stack.block(null as never)).toThrow(/layerStack: a block is named by its id or by its index, and null is neither/)
            expect(() => stack.p('embed', 'under' as never)).toThrow(/layerStack: edge is 'left', 'right', 'top' or 'bottom', not "under"/)
        }))
    })

    it('refuses a layer, an option or a size that gives no right picture, and says what works', async () => {
        await compileFilm(film(() => {
            expect(() => layerStack([])).toThrow(/layerStack: give it at least one layer, such as \['embed', \{ branch: \['attention'\] \}, 'unembed'\]/)
            expect(() => layerStack(['embed', 7 as never])).toThrow(/layerStack: layer 1 is 7\. A block is a label, or \{ label, id, color, state, shape \}/)
            expect(() => layerStack(['embed', { label: ' ' }])).toThrow(/layerStack: layer 1 has no label\. Give each block a label/)
            expect(() => layerStack(['two\nlines'])).toThrow(/layerStack: the label of layer 0 \("two\\nlines"\) has a line break or a tab\. A label is one line/)
            expect(() => layerStack([{ branch: [] }])).toThrow(/layerStack: layer 0 has the branch \[\]\. A branch is a list of one block or more, such as \{ branch: \['norm', 'attention'\] \}/)
            expect(() => layerStack([{ layers: [] }])).toThrow(/layerStack: layer 0 is a group with no layers/)
            expect(() => layerStack([{ layers: [{ layers: ['a'] } as never] }])).toThrow(/layerStack: layer 0 of the group of layer 0 is a group inside a group\. A group holds blocks and branches\. Give the two groups one after the other/)
            expect(() => layerStack([{ repeat: 1, layers: ['a'] }])).toThrow(/layerStack: the repeat of layer 0 is 1\. Give a count, 2 or more, or a name such as 'N'/)
            expect(() => layerStack([{ label: 'a', state: 'cold' }])).toThrow(/layerStack: layer 0 \("a"\) has the state "cold"\. The states are live, frozen/)
            expect(() => layerStack([{ label: 'a', color: 'no such color' }])).toThrow(/layerStack: the color of layer 0 \("a"\) is "no such color", which is not a color\. Use a color of the look, such as 'orange', or a CSS color/)
            // The add of a branch needs two values of one shape, so a block of a branch has no shape of its own.
            expect(() => layerStack([{ branch: [{ label: 'MLP', shape: '(T, 3072)' }] }])).toThrow(/layerStack: block 0 of layer 0 \("MLP"\) has a shape, and it is in a branch\. The add of a branch keeps the shape of the stream\. Give the shape to a block on the stream/)
            expect(() => layerStack(['a'], { states: { odd: { mark: 'star' as never } } })).toThrow(/layerStack: the mark of the state "odd" is "star"\. A mark is 'lock', 'check', 'cross', 'dot'/)
            expect(() => layerStack(['a'], { cells: 0 })).toThrow(/layerStack: cells is 0\. Give the number of cells of the vector, a whole number from 1 to 16/)
            expect(() => layerStack(['a'], { states: { broken: null as never } })).toThrow(/give the state "broken" a look/)
            expect(() => layerStack([{ branch: ['a'], shown: 'false' as never }])).toThrow(/set shown to true or false/)
            expect(() => layerStack([{ branch: Array(1) }])).toThrow(/block 0 of layer 0 is undefined/)
            expect(() => layerStack(['a'], { digits: 1.5 })).toThrow(/layerStack: digits is 1\.5\. Give the number of decimals of a value in a cell, a whole number from 0 to 3/)
            expect(() => layerStack(['a'], { size: 0 })).toThrow(/layerStack: size is a text size, more than 0/)
            expect(() => layerStack(['a'], { blockHeight: 30 })).toThrow(/layerStack: a blockHeight of 30 has no room for a label of size 28: a letter with a tail would touch the border\. Give a blockHeight of \d+ or more/)
            // A width with no room for a label is an error that names the label and the least width. That width works.
            const narrow = () => layerStack(['embed', { branch: ['multi-head attention'] }], { width: 300 })
            expect(narrow).toThrow(/layerStack: a width of 300 has no room for the label "multi-head attention", which is \d+ px wide at size 28\. Give a width of (\d+) or more, shorter labels, or a smaller size/)
            let least = 0
            try { narrow() } catch (error) { least = Number(/Give a width of (\d+)/.exec((error as Error).message)![1]) }
            expect(() => layerStack(['embed', { branch: ['multi-head attention'] }], { width: least })).not.toThrow()
            expect(() => layerStack(['embed', { branch: ['multi-head attention'] }], { width: least - 1 })).toThrow(/has no room for the label/)
            // With short labels, the vector sets the least width: a block hides the vector that is in it.
            expect(() => layerStack(['a'], { width: 100, cells: 8 })).toThrow(/layerStack: a width of 100 has no room for the vector of 8 cells, which is 187 px wide and must fit behind a block\. Give a width of 201 or more, fewer cells, or a smaller size/)
            // Without a width, the stack is as wide as its labels need, so a long label is never an error.
            const long = layerStack(['embed', { branch: ['a label of a block that is very long'] }])
            const [box, label] = [edges(long.boxes[1]!), edges(long.labels[1]!)]
            expect(label[0]! - box[0]!).toBeGreaterThan(15)
            expect(box[2]! - label[2]!).toBeGreaterThan(15)
            expect(() => layerStack([{ label: 'a very long name of a group of layers', layers: ['a'] }])).toThrow(/layerStack: the label "a very long name of a group of layers" of a group is \d+ px wide, and the top line of its frame has \d+ px for it\. Use a shorter label, or a wider stack/)
        }))
    })

    it('enters from the foot of the stream up, with each part when the stream reaches its height, and never shows the stream through a block', async () => {
        let stack!: Stack
        const compiled = await compile((s) => {
            stack = layerStack(['embed', { branch: ['attention'] }, { branch: ['LoRA'], around: 'W', shown: false }, 'unembed'], { shape: '(T)' })
            s.wait(1)
            s.play(stack.enter(), { duration: 2, ease: linear })
            s.wait(0.5)
        }, { fps: 20 })
        // The stack is not on the stage before its animation.
        expect(compiled.frame(0.5).ops).toHaveLength(0)
        const [line, head] = stack.stream.children as [Node, Node]
        expect([1, 1.5, 2, 3].map((time) => at(time, () => line.get('trimTo')))).toEqual([0, 0.25, 0.5, 1])
        // The time at which the growing end of the stream is at a height. A part starts 0.16 s before that, and takes 0.5 s.
        const reached = (y: number) => 1 + 2 * (stack.foot[1] - y) / (stack.foot[1] - stack.head[1])
        const body = (index: number) => stack.blocks[index]!.children[1]!
        const arrives = (node: Node, y: number) => [-0.16, 0.09, 0.34].map((after) => at(reached(y) + after, () => shows(node)))
        // "embed" is low and comes early. "unembed" is high and comes late.
        expect(reached(stack.p('embed', 'bottom')[1])).toBeLessThan(1.3)
        expect(reached(stack.p('unembed', 'bottom')[1])).toBeGreaterThan(2.5)
        expect(arrives(body(0), stack.p('embed', 'bottom')[1])).toEqual([0, expect.closeTo(0.5, 6), expect.closeTo(1, 6)])
        expect(arrives(body(4), stack.p('unembed', 'bottom')[1])).toEqual([0, expect.closeTo(0.5, 6), expect.closeTo(1, 6)])
        // The add of a branch comes when the stream is at the add, after the block of the branch.
        expect(arrives(stack.adds[0]!, stack.adds[0]!.get('y'))).toEqual([0, expect.closeTo(0.5, 6), expect.closeTo(1, 6)])
        expect(at(reached(stack.adds[0]!.get('y')) - 0.16, () => shows(body(1)))).toBeGreaterThan(0.4)
        expect(at(3, () => [shows(stack.adds[0]!), shows(stack.reads[0]!), shows(stack.taps[0]!), shows(head)])).toEqual([1, 1, 1, 1])
        // The backing of a block shows from the start, so the stream that grows behind a block never shows through its label.
        const backing = stack.blocks[0]!.children[0]!
        expect(at(1.2, () => [shows(backing), backing.get('fill'), backing.get('fillOpacity')])).toEqual([1, paint('bg'), 1])
        // The branch that waits for `show()`, the vector and the shape stay away. The block on the stream beside that branch enters.
        expect(at(3.4, () => [shows(stack.blocks[3]!), shows(stack.adds[1]!), shows(stack.reads[1]!), shows(stack.vector), shows(stack.tag!), shows(stack.copy), shows(stack.zoom)])).toEqual([0, 0, 0, 0, 0, 0, 0])
        expect(at(3.4, () => shows(body(2)))).toBe(1)
        const report = await checkFilm(film({ fps: 20 }, (s) => {
            const model = layerStack(['embed', { branch: ['LoRA'], around: 'LLM' }, 'unembed'], { shape: '(T)' })
            s.play(model.enter(), { duration: 1.5 })
            s.wait(0.5)
        }), { motion: true, textGap: 0.7 })
        expect(report.diagnostics).toEqual([])
    })

    it('feeds a vector at the foot of the stream and sends it through a block, behind which it takes its new values and its new shape', async () => {
        let stack!: Stack
        await compile((s) => {
            stack = s.add(layerStack([{ label: 'embed', shape: '(T, 768)' }, 'norm', { label: 'unembed', shape: '(T, 50257)' }], { shape: '(T)' }))
            expect([stack.passed, stack.values, stack.shape]).toEqual([null, null, null])
            s.wait(1)
            s.play(stack.feed([0.5, -0.5, 0, 2]), { duration: 1, ease: linear })
            expect([stack.passed, stack.values, stack.shape]).toEqual([0, [0.5, -0.5, 0, 2], '(T)'])
            s.play(stack.pass('embed', [1, 1, -1, 0.25]), { duration: 2, ease: linear })
            expect([stack.passed, stack.values, stack.shape]).toEqual([1, [1, 1, -1, 0.25], '(T, 768)'])
            // A pass to a later block goes through each layer before it. Without values, the vector keeps its values.
            s.play(stack.pass('unembed'), { duration: 2, ease: linear })
            expect([stack.passed, stack.values, stack.shape]).toEqual([3, [1, 1, -1, 0.25], '(T, 50257)'])
            s.wait(0.5)
        }, { fps: 20 })
        const vector = stack.vector, [x] = stack.foot
        const rest = (layer: number) => (layer === 0 ? stack.foot[1] - 6 - 24 : stack.p(layer - 1, 'top')[1] - 24)
        // It comes in at the foot: under the first block, in the middle of the free room of the stream.
        expect(at(0.9, () => shows(vector))).toBe(0)
        expect([1.5, 2].map((time) => at(time, () => [shows(vector), vector.get('x'), vector.get('y')]))).toEqual([[0.5, x, rest(0) + 7], [1, x, rest(0)]])
        // A cell has teal for a value over 0 and orange for one under 0, stronger for a larger value, and full from 1 on.
        expect(at(2, () => looks(vector))).toEqual([[paint('teal'), expect.closeTo(0.545, 6)], [paint('orange'), expect.closeTo(0.545, 6)], [paint('dim'), 0.14], [paint('teal'), 0.95]])
        // It goes up with the ease of the play, and it is behind the block at the half of its way.
        expect([2.5, 3, 4].map((time) => at(time, () => vector.get('y')))).toEqual([rest(0) + (rest(1) - rest(0)) / 4, stack.p('embed')[1], rest(1)])
        expect(stack.all().indexOf(vector)).toBeLessThan(stack.all().indexOf(stack.blocks[0]!))
        const [inside, around] = at(3, () => [edges(vector), edges(stack.boxes[0]!)])
        expect(inside![0]! > around![0]! && inside![1]! > around![1]! && inside![2]! < around![2]! && inside![3]! < around![3]!).toBe(true)
        // It changes there, where no viewer sees the change, and the block lights for a moment.
        expect(at(2.95, () => looks(vector)[2])).toEqual([paint('dim'), 0.14])
        expect(at(3, () => looks(vector))).toEqual([[paint('teal'), 0.95], [paint('teal'), 0.95], [paint('orange'), 0.95], [paint('teal'), expect.closeTo(0.3425, 6)]])
        const wash = stack.blocks[0]!.children[1]!.children[1]!
        expect([2.6, 2.85, 3, 3.4].map((time) => at(time, () => wash.get('opacity')))).toEqual([0, expect.closeTo(0.4 * Math.SQRT1_2, 6), expect.closeTo(0.4, 6), 0])
        // The shape is beside the vector, at its height, outside the blocks, and it changes with the vector.
        const tag = stack.tag!
        const says = () => tag.children.filter((made) => made.get('visible')).map(sourceOf)
        expect([2, 2.9, 3, 4.9, 5.4, 5.6].map((time) => at(time, says))).toEqual([['(T)'], ['(T)'], ['(T, 768)'], ['(T, 768)'], ['(T, 768)'], ['(T, 50257)']])
        expect([2, 2.5, 4].map((time) => at(time, () => tag.get('y')))).toEqual([2, 2.5, 4].map((time) => at(time, () => vector.get('y'))))
        expect(at(4, () => edges(tag)[2])).toBeLessThan(edges(stack.boxes[0]!)[0]! - 10)
        // The second pass takes the two layers one after the other, each in half of the time.
        expect([4, 5, 6].map((time) => at(time, () => vector.get('y')))).toEqual([rest(1), rest(2), rest(3)])
        expect(at(6.5, () => vector.get('y'))).toBeLessThan(stack.p('unembed', 'top')[1])
        expect(at(6.5, () => vector.get('y'))).toBeGreaterThan(stack.head[1] + 16)
    })

    it('sends a copy of the vector through a branch while the vector stays on the stream, and the add puts on the stream what the branch adds', async () => {
        let stack!: Stack
        await compile((s) => {
            stack = s.add(layerStack(MODEL))
            s.play(stack.feed([1, 1, 1, 1]), { duration: 1 })
            s.play(stack.pass('embed'), { duration: 1 })
            // The whole branch is one layer: any of its blocks names it.
            s.play(stack.pass('norm', [0.5, 0, 1, -1]), { duration: 10 })
            expect([stack.passed, stack.values]).toEqual([2, [0.5, 0, 1, -1]])
            s.wait(1)
        }, { fps: 20 })
        const { vector, copy } = stack
        const tap = 94, add = -71
        // The vector never leaves the stream.
        for (const time of [2, 3, 4.5, 6, 8.5, 10, 11.9, 12.5]) expect(at(time, () => vector.get('x'))).toBe(STREAM)
        // It goes to the point where the branch leaves the stream. The copy leaves from there, with the values of the vector.
        expect(at(3.2, () => [vector.get('y'), shows(copy), copy.get('x'), copy.get('y')])).toEqual([tap, 1, STREAM, tap])
        expect(at(3.2, () => looks(copy))).toEqual(at(3.2, () => looks(vector)))
        expect(at(3.1, () => shows(copy))).toBe(0)
        // The copy goes into the first block of the branch, and is behind the last one when it changes.
        expect(at(6, () => [copy.get('x'), copy.get('y')])).toEqual(stack.p('norm', 'top').map((value, index) => value + (index === 1 ? 26.5 : 0)))
        expect(stack.all().indexOf(copy)).toBeLessThan(stack.all().indexOf(stack.blocks[1]!))
        expect(at(6.8, () => [copy.get('x'), copy.get('y')])).toEqual([68, -23.5])
        // It comes back with what the branch adds: the new values less the old ones.
        expect(at(6.8, () => looks(copy))).toEqual([[paint('orange'), expect.closeTo(0.545, 6)], [paint('orange'), 0.95], [paint('dim'), 0.14], [paint('orange'), 0.95]])
        // The blocks of the branch light one after the other while the copy is in them.
        const wash = (index: number) => stack.blocks[index]!.children[1]!.children[1]!
        expect(at(6.35, () => [wash(1).get('opacity'), wash(2).get('opacity')])).toEqual([expect.closeTo(0.4, 6), 0])
        expect(at(7.25, () => [wash(1).get('opacity'), wash(2).get('opacity')])).toEqual([0, expect.closeTo(0.4, 6)])
        // It stops at the ring of the add, on the line of the branch, and the vector waits under it.
        expect(at(10, () => [shows(copy), copy.get('x'), copy.get('y'), copy.get('sx')])).toEqual([1, STREAM + 13 + 47.5, add, 1])
        const [waiting, coming] = at(10, () => [edges(vector), edges(copy)])
        expect(waiting![1]).toBeGreaterThan(coming![3]! + 2)
        expect(at(10, () => looks(vector))).toEqual([[paint('teal'), 0.95], [paint('teal'), 0.95], [paint('teal'), 0.95], [paint('teal'), 0.95]])
        // The add takes the copy: it gets small under the ring, and the ring swells.
        expect(stack.all().indexOf(copy)).toBeLessThan(stack.all().indexOf(stack.adds[0]!))
        expect(at(10.8, () => [shows(copy) > 0, copy.get('sx') < 0.6, copy.get('x') < STREAM + 30])).toEqual([true, true, true])
        expect(at(11, () => [shows(copy), copy.get('x')])).toEqual([0, STREAM])
        expect([10, 11, 11.9].map((time) => at(time, () => stack.adds[0]!.get('sx')))).toEqual([1, expect.closeTo(1.3, 6), 1])
        // The vector goes through the add and takes the sum. It rests over the add.
        expect(at(12, () => looks(vector))).toEqual([[paint('teal'), expect.closeTo(0.545, 6)], [paint('dim'), 0.14], [paint('teal'), 0.95], [paint('orange'), 0.95]])
        expect(at(12, () => vector.get('y'))).toBe(add - 13 - 24)
        expect(at(12.5, () => [shows(copy), copy.get('sx')])).toEqual([0, 1])
    })

    it('lets the vector do one thing at a time, chains the changes of one sequence, and says what a wrong pass needs', async () => {
        let stack!: Stack
        await compile((s) => {
            stack = s.add(layerStack(MODEL, { shape: '(T)' }))
            // Each call of a sequence starts from the state that the call before it left.
            s.play(seq(stack.feed([1, 0, 0, 0]), stack.pass('embed', [0, 1, 0, 0]), stack.pass('attention', [0, 0, 1, 0]), stack.pass('unembed')))
            expect([stack.passed, stack.values]).toEqual([3, [0, 0, 1, 0]])
            // A second vector starts at the foot again. The one that is on the stream leaves first, where it is.
            s.play(stack.feed([0, 0, 0, 1]), { duration: 1, ease: linear })
            expect([stack.passed, stack.values, stack.shape]).toEqual([0, [0, 0, 0, 1], '(T)'])
        }, { fps: 20 })
        // A pass with no duration takes the time of its last layer: 1 s for a block, 2.6 s for a branch.
        expect([stack.feed([1, 1, 1, 1]).duration, stack.pass('embed').duration, stack.pass('attention').duration]).toEqual([0.6, 1, 2.6])
        const start = 0.6 + 1 + 2.6 + 1
        const top = at(start, () => stack.vector.get('y'))
        expect(at(start + 0.2, () => [shows(stack.vector), stack.vector.get('y')])).toEqual([expect.closeTo(0.5, 6), top])
        expect(at(start + 0.4, () => stack.vector.get('y'))).toBeGreaterThan(stack.p('embed', 'bottom')[1])
        expect(at(start + 1, () => [shows(stack.vector), stack.vector.get('y')])).toEqual([1, stack.foot[1] - 30])

        await compileFilm(film((s) => {
            const model = s.add(layerStack(MODEL))
            expect(() => s.play(model.pass('embed'))).toThrow(/layerStack: pass\("embed"\) has no vector to send\. Call feed\(\) first: it puts a vector at the foot of the stream/)
            expect(() => model.feed([1, 2, 3])).toThrow(/layerStack: feed\(\) has 3 values, and the vector has 4 cells\. Give one value for each cell, or build the stack with `cells: 3`/)
            expect(() => model.pass('embed', [1, 2, 3, Number.NaN])).toThrow(/layerStack: value 3 of pass\("embed"\) is NaN\. A value is a number/)
            expect(() => model.feed([1, 1, 1, 1], { duration: -1 })).toThrow(/layerStack: the duration of feed\(\) is -1\. Give a number, 0 or more/)
            // Two changes of the vector whose times overlap are refused, with the two calls and their times.
            expect(() => s.play(model.feed([1, 1, 1, 1]), model.pass('embed'))).toThrow(/layerStack: pass\("embed"\) plays from 0 s to 1 s, and feed\(\) plays from 0 s to 0\.6 s\. The vector does one thing at a time\. Play the two in a `seq`, or give feed\(\) a duration of 0 or less/)
            // The play that was refused did not move the time of the film, so the next change waits for the feed to end.
            s.wait(1)
            s.play(model.pass('attention'))
            expect(() => s.play(model.pass('embed'))).toThrow(/layerStack: pass\("embed"\): the vector passed block 0 \("embed"\) already\. It does not go back\. feed\(\) starts again at the foot of the stream/)
            // A room between two layers that is lower than the vector is refused when the film feeds a vector, with the least room.
            const tight = layerStack(['a', 'b'], { gap: 12 })
            expect(() => tight.feed([1, 1, 1, 1])).toThrow(/layerStack: a gap of 12 has no room for the vector, which is 26 px high and rests on the stream between two layers\. Give a gap of 38 or more, or leave the gap out/)
            expect(() => layerStack(['a', 'b'], { gap: 38 }).feed([1, 1, 1, 1])).not.toThrow()
        }))
    })

    it('lights one block at a time, and gives the lit block a thick border', async () => {
        let stack!: Stack
        const compiled = await compile((s) => {
            stack = layerStack(MODEL)
            s.wait(0.5)
            // A light on a stack that is not on the stage brings the stack.
            s.play(stack.light('attention'), { duration: 1, ease: linear })
            expect(stack.current).toBe(2)
            s.play(seq(stack.light('embed'), stack.light(null), stack.light(3)), { duration: 3, ease: linear })
            expect(stack.current).toBe(3)
            s.wait(0.5)
        }, { fps: 20 })
        expect(compiled.frame(0.25).ops).toHaveLength(0)
        const halo = (index: number) => stack.blocks[index]!.children[1]!.children[2]!
        const lit = (time: number) => at(time, () => [0, 1, 2, 3].map((index) => halo(index).get('opacity')))
        expect(lit(0.5)).toEqual([0, 0, 0, 0])
        expect(lit(1)).toEqual([0, 0, 0.5, 0])
        expect(lit(1.5)).toEqual([0, 0, 1, 0])
        // The light leaves one block while it comes to the next.
        expect(lit(2)).toEqual([0.5, 0, 0.5, 0])
        expect(lit(3)).toEqual([0.5, 0, 0, 0])
        expect(lit(4.5)).toEqual([0, 0, 0, 1])
        // The border of a lit block is wider than the border of the block, in the color of the block.
        expect(halo(3).get('strokeWidth')).toBeGreaterThan(stack.boxes[3]!.get('strokeWidth') * 1.8)
        expect(halo(3).get('stroke')).toEqual(stack.boxes[3]!.get('stroke'))
        // In one play, the last light wins, and the state says so.
        let both!: Stack
        await compile((s) => {
            both = s.add(layerStack(MODEL))
            s.play(both.light('embed'), both.light('unembed'), { duration: 1 })
        })
        expect(both.current).toBe(3)
        expect(at(1, () => [both.blocks[0]!, both.blocks[3]!].map((block) => block.children[1]!.children[2]!.get('opacity')))).toEqual([0, 1])
    })

    it('marks blocks with a state that has its own sign, and reads the states back', async () => {
        let stack!: Stack
        await compile((s) => {
            stack = s.add(layerStack(['embed', { branch: [{ label: 'attention', color: 'orange' }] }, { label: 'head', state: 'frozen' }]))
            expect(stack.ids.map((id) => stack.stateOf(id))).toEqual(['live', 'live', 'frozen'])
            s.wait(1)
            // In a sequence, the function of the second change sees the states that the first one left.
            s.play(seq(stack.mark(['embed', 'attention'], 'frozen'), stack.mark((block) => block.state === 'frozen' && block.layer > 0, 'live')), { duration: 2, ease: linear })
            expect(stack.ids.map((id) => stack.stateOf(id))).toEqual(['frozen', 'live', 'live'])
            expect(stack.find((block) => block.state === 'frozen')).toEqual([0])
            expect(stack.find((block) => block.label === 'head')).toEqual([2])
            s.wait(0.5)
        }, { fps: 20 })
        const box = (index: number) => stack.boxes[index]!
        const look = (index: number) => [box(index).get('stroke'), box(index).get('strokeOpacity'), box(index).get('fillOpacity'), stack.labels[index]!.children[0]!.get('fill')]
        // A frozen block keeps its color and is dim, with a dim label. It has a lock, so the color is not its only sign.
        expect(at(0.5, () => look(2))).toEqual([paint('blue'), 0.45, 0.06, paint('dim')])
        expect(at(0.5, () => look(1))).toEqual([paint('orange'), 1, 0.16, paint('ink')])
        const marks = (index: number) => stack.blocks[index]!.children[1]!.children.slice(4)
        expect(STACK_STATES.frozen.mark).toBe('lock')
        expect(at(0.5, () => [0, 1, 2].map((index) => marks(index).map(shows)))).toEqual([[0], [0], [1]])
        // The mark is inside the block, at its right end, clear of the label.
        const [lock, frame, name] = at(0.5, () => [edges(marks(2)[0]!), edges(box(2)), edges(stack.labels[2]!)])
        expect(lock![2]).toBeLessThan(frame![2]! - 10)
        expect(lock![0]).toBeGreaterThan(name![2]! + 5)
        // Half way: the first two blocks are between their two looks.
        const near = (color: unknown) => (color as number[]).map((channel) => expect.closeTo(channel, 3))
        expect(at(1.5, () => look(1))).toEqual([near(paint('orange')), expect.closeTo(0.725, 6), expect.closeTo(0.11, 6), near(mixColor(parseColor('ink'), parseColor('dim'), 0.5))])
        expect(at(1.5, () => marks(1).map(shows))).toEqual([0.5])
        expect(at(2, () => [look(0), look(1), look(2)])).toEqual([[paint('blue'), 0.45, 0.06, paint('dim')], [paint('orange'), 0.45, 0.06, paint('dim')], [paint('blue'), 0.45, 0.06, paint('dim')]])
        expect(at(3, () => [look(0), look(1), look(2)])).toEqual([[paint('blue'), 0.45, 0.06, paint('dim')], [paint('orange'), 1, 0.16, paint('ink')], [paint('blue'), 1, 0.16, paint('ink')]])
        expect(at(3, () => [0, 1, 2].map((index) => marks(index).map(shows)))).toEqual([[1], [0], [0]])

        await compileFilm(film(() => {
            // The states of a film: a color of the state, a border of dashes, and each mark.
            const image = layerStack([{ label: 'FROM', state: 'cached' }, { label: 'COPY', state: 'skipped' }, 'RUN'], { states: { fresh: {}, cached: { color: 'dim', mark: 'check' }, failed: { color: 'red', mark: 'cross' }, skipped: { dim: true, dash: true } } })
            expect(image.ids.map((id) => image.stateOf(id))).toEqual(['cached', 'skipped', 'fresh'])
            expect(image.boxes.map((made) => made.get('stroke'))).toEqual([paint('dim'), paint('blue'), paint('blue')])
            expect(image.boxes.map((made) => made.get('dash') !== null)).toEqual([false, true, false])
            expect(() => image.mark('RUN', 'frozen')).toThrow(/layerStack: no state "frozen"\. The states are fresh, cached, failed, skipped/)
            expect(() => image.mark('ADD', 'failed')).toThrow(/layerStack: no block "ADD"/)
            expect(() => image.find('cached' as never)).toThrow(/layerStack: find takes a function of a block/)
        }))
    })

    it('replaces a block with another: the labels change with no moment that shows two, and the block keeps its id and its state', async () => {
        let stack!: Stack
        await compile((s) => {
            stack = s.add(layerStack(['embed', { branch: [{ label: 'norm', color: 'yellow', state: 'frozen' }, 'attention'] }], { width: 440 }))
            s.wait(1)
            s.play(stack.replace('norm', { label: 'RMSNorm', color: 'green' }), { duration: 2, ease: linear })
            expect([stack.labelOf('norm'), stack.ids[1], stack.stateOf('norm')]).toEqual(['RMSNorm', 'norm', 'frozen'])
            s.play(stack.replace(1, 'norm'), { duration: 1 })
            expect(stack.labelOf(1)).toBe('norm')
            s.wait(0.5)
        }, { fps: 20 })
        const texts = stack.blocks[1]!.children[1]!.children.filter((part) => sourceOf(part) !== undefined)
        expect(texts.map(sourceOf)).toEqual(['norm', 'RMSNorm', 'norm'])
        const [old, made] = texts
        expect(sourceOf(stack.labels[1])).toBe('norm')
        expect(stack.labels[1]).toBe(texts[2])
        // The old label is gone at 0.45 of the time, and the new one starts at 0.55, in the middle of the block.
        expect([1, 1.45, 1.9, 2, 2.1, 2.55, 3].map((time) => at(time, () => [shows(old!), shows(made!)]))).toEqual([[1, 0], [expect.closeTo(0.5, 6), 0], [0, 0], [0, 0], [0, 0], [0, expect.closeTo(0.5, 6)], [0, 1]])
        const [box, label] = at(3, () => [edges(stack.boxes[1]!), edges(made!)])
        expect(Math.abs((label![0]! + label![2]!) / 2 - (box![0]! + box![2]!) / 2)).toBeLessThan(2)
        // The block takes the new color, in its state: it is frozen, so its label stays dim.
        const near = (color: unknown) => (color as number[]).map((channel) => expect.closeTo(channel, 3))
        expect([1, 2, 3].map((time) => at(time, () => stack.boxes[1]!.get('stroke')))).toEqual([paint('yellow'), near(mixColor(parseColor('yellow'), parseColor('green'), 0.5)), paint('green')])
        expect(at(3, () => made!.children[0]!.get('fill'))).toEqual(paint('dim'))

        await compileFilm(film((s) => {
            const model = s.add(layerStack(['embed', { branch: ['norm'] }], { width: 400 }))
            expect(() => model.replace('norm', 'a normalization layer with a long name')).toThrow(/layerStack: replace: the label "a normalization layer with a long name" is \d+ px wide at size 28, and block 1 \("norm"\) has \d+ px for it\. Use a shorter label, or build the stack with a width of \d+ or more/)
            expect(() => model.replace('norm', '')).toThrow(/layerStack: replace: the new block of block 1 \("norm"\) is ""\. Give a label, or \{ label, color \}/)
            expect(() => model.replace('norm', { label: 'RMS', color: 'no such color' })).toThrow(/layerStack: the color of the new block of block 1 \("norm"\) is "no such color", which is not a color/)
            // Two changes of one block whose times overlap are refused. Two blocks change together.
            expect(() => s.play(model.replace('norm', 'RMS'), model.replace('norm', 'L2'))).toThrow(/layerStack: replace\("norm"\) plays from 0 s to 0\.8 s, and replace\("norm"\) plays from 0 s to 0\.8 s\. A block has one label at a time\. Play the two in a `seq`, or give the first a shorter duration/)
            expect(() => s.play(model.replace('embed', 'tokens'))).not.toThrow()
        }))
    })

    it('keeps the place of a branch that waits, brings it in with show(), and passes the stream there as a plain line before that', async () => {
        let stack!: Stack
        await compile((s) => {
            stack = s.add(layerStack(['embed', { branch: ['LoRA'], around: 'W', shown: false }, { branch: ['adapter'], shown: false }, 'head']))
            expect(stack.find((block) => !block.shown)).toEqual([2, 3])
            s.play(stack.feed([1, 1, 1, 1]), { duration: 1 })
            // The branch does not show: the vector goes through the block on the stream alone, and no copy leaves.
            s.play(stack.pass('LoRA', [0.5, 0.5, 0.5, 0.5]), { duration: 2, ease: linear })
            expect(stack.passed).toBe(2)
            s.play(stack.show('adapter'), { duration: 2, ease: linear })
            expect(stack.find((block) => !block.shown)).toEqual([2])
            s.play(stack.pass('adapter', [1, 0, 0, 0]), { duration: 4 })
            s.wait(0.5)
        }, { fps: 20 })
        const parts = (branch: number) => [stack.taps[branch]!, stack.reads[branch]!, stack.writes[branch]!, stack.adds[branch]!]
        // A branch that waits has its place: the room beside the block on the stream is empty.
        expect(at(0.5, () => [shows(stack.blocks[2]!), ...parts(0).map(shows), shows(stack.blocks[3]!), ...parts(1).map(shows)])).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        expect(edges(stack.boxes[2]!)[0]).toBeGreaterThan(edges(stack.boxes[1]!)[2]!)
        // The first pass takes "embed" in its first second and the layer of "W" in the next. The vector changes
        // behind "W", and the copy never shows.
        const [from, to] = [at(2, () => stack.vector.get('y')), at(3, () => stack.vector.get('y'))]
        const behind = 2 + (stack.p('W')[1] - from) / (to - from)
        expect(behind).toBeGreaterThan(2.3)
        expect(behind).toBeLessThan(2.7)
        expect(at(behind, () => stack.vector.get('y'))).toBeCloseTo(stack.p('W')[1], 6)
        expect(at(behind - 0.01, () => looks(stack.vector)[0])).toEqual([paint('teal'), 0.95])
        expect(at(behind + 0.01, () => looks(stack.vector)[0])).toEqual([paint('teal'), expect.closeTo(0.545, 6)])
        expect([1.2, 2, 2.5, 2.8].map((time) => at(time, () => shows(stack.copy)))).toEqual([0, 0, 0, 0])
        // show(): the point, the line in, the block, the line out and the add arrive in the order of the data.
        const [line, head] = stack.reads[1]!.children as [Node, Node]
        expect(at(3.2, () => [shows(stack.taps[1]!), line.get('trimTo'), shows(head), shows(stack.blocks[3]!), shows(stack.adds[1]!)])).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.25, 6), 0, 0, 0])
        expect(at(4, () => [shows(stack.blocks[3]!), stack.writes[1]!.children[0]!.get('trimTo'), shows(stack.adds[1]!)])).toEqual([expect.closeTo(0.5, 6), 0, 0])
        expect(at(5, () => [shows(stack.blocks[3]!), ...parts(1).map(shows), line.get('trimTo'), shows(head)])).toEqual([1, 1, 1, 1, 1, 1, 1])
        expect(at(5, () => [shows(stack.blocks[2]!), ...parts(0).map(shows)])).toEqual([0, 0, 0, 0, 0])
        // After that, a pass sends a copy through the branch.
        expect(at(7, () => shows(stack.copy))).toBe(1)
        expect(stack.values).toEqual([1, 0, 0, 0])

        await compileFilm(film((s) => {
            const model = s.add(layerStack(['embed', { branch: ['adapter'], shown: false }, 'head']))
            expect(() => model.show('embed')).toThrow(/layerStack: show: block 0 \("embed"\) is not in a branch\. show\(\) brings in a branch that was made with shown: false/)
            expect(() => s.play(model.light('adapter'))).toThrow(/layerStack: light: block 1 \("adapter"\) is in a branch that does not show\. Call show\(\) first/)
            expect(() => s.play(model.open('adapter', rect(100, 100).at(600, 0)))).toThrow(/layerStack: open: block 1 \("adapter"\) is in a branch that does not show\. Call show\(\) first/)
            s.play(model.feed([1, 1, 1, 1]))
            // Nothing changes a vector on a plain line.
            expect(() => s.play(model.pass('adapter', [0, 0, 0, 0]))).toThrow(/layerStack: pass\("adapter"\) has values, and the branch of block 1 \("adapter"\) does not show, so nothing changes the vector there\. Call show\(\) first, or give no values/)
            s.play(model.pass('adapter'))
            expect(model.passed).toBe(2)
            // With no block, it is the show() of a node.
            expect(model.hide().show()).toBe(model)
        }))
    })

    it('opens a block to a close-up of the film: two lines from the block to a frame around it, at the side where the close-up is', async () => {
        let stack!: Stack, grid!: Node, formula!: Node
        const compiled = await compile((s) => {
            stack = s.add(layerStack(MODEL).at(-400, 0))
            grid = rect(300, 200, { fill: 'surface', stroke: 'grid' }).at(300, -100)
            formula = text('y = W x', { size: 40 }).at(-800, 150)
            s.wait(1)
            s.play(stack.open('attention', grid), { duration: 2, ease: linear })
            expect(stack.opened).toBe(2)
            s.wait(1)
            // Another block opens: the first one closes in the first part of the time.
            s.play(stack.open('embed', formula), { duration: 2, ease: linear })
            expect(stack.opened).toBe(0)
            s.wait(1)
            s.play(stack.close(), { duration: 1, ease: linear })
            expect(stack.opened).toBeNull()
            s.wait(0.5)
        }, { fps: 20 })
        const [wedge, upper, lower, frame] = stack.zoom.children as [Node, Node, Node, Node]
        expect(at(0.5, () => [shows(stack.zoom), shows(grid)])).toEqual([0, 0])
        expect(compiled.frame(0.5).ops.some((op) => op.node === grid)).toBe(false)
        // The frame is around the close-up, with room, in the coordinates of the stack. The close-up is at the right,
        // so the lines leave from the right edge of the block: from its two corners to the two near corners of the frame.
        expect(at(3, () => edges(frame))).toEqual([150 - 17, -200 - 17, 450 + 17, 17])
        const corner = stack.toWorld(...stack.p('attention', 'right'))
        expect(at(3, () => edges(upper))).toEqual([corner[0], -217, 133, corner[1] - 26.5])
        expect(at(3, () => edges(lower))).toEqual([corner[0], corner[1] + 26.5, 133, 17])
        expect(at(3, () => edges(wedge))).toEqual([corner[0], -217, 133, 17])
        // They take the color of the block. They are a decoration, so the film check does not judge the close-up against them.
        expect(at(3, () => frame.get('stroke'))).toEqual(paint('blue'))
        expect(stack.zoom.data['decoration']).toBe(true)
        // The lines come first, and the close-up fades in after them.
        expect([1.6, 2.2, 3].map((time) => at(time, () => [shows(stack.zoom), shows(grid)]))).toEqual([[0.5, 0], [1, expect.closeTo(1 / 3, 6)], [1, 1]])
        // The second close-up is at the left: the lines leave from the left edge of "embed". The first one fades out.
        expect([4.35, 4.7].map((time) => at(time, () => [shows(stack.zoom), shows(grid)]))).toEqual([[expect.closeTo(0.5, 6), expect.closeTo(0.5, 6)], [0, 0]])
        const left = stack.toWorld(...stack.p('embed', 'left'))
        expect(at(6, () => edges(upper)[2])).toBe(left[0])
        expect(at(6, () => edges(frame)[2])).toBeLessThan(left[0] - 50)
        expect(at(6, () => [shows(stack.zoom), shows(grid), shows(formula)])).toEqual([1, 0, 1])
        // close(): the lines and the close-up leave.
        expect([7.5, 8, 8.4].map((time) => at(time, () => [shows(stack.zoom), shows(formula)]))).toEqual([[0.5, 0.5], [0, 0], [0, 0]])

        await compileFilm(film((s) => {
            const model = s.add(layerStack(['embed', { branch: ['LoRA'], around: 'W' }]))
            const over = rect(100, 100).at(0, -500), right = rect(100, 100).at(600, 0), far = rect(100, 100).at(-600, 0)
            expect(() => s.play(model.open('embed', over))).toThrow(/layerStack: open\("embed"\): the inside is over the stack or under it\. Place it at the right or at the left of the stack/)
            expect(() => s.play(model.open('W', right))).toThrow(/layerStack: open\("W"\): block 1 \("W"\) has a branch at its right, and the lines to the inside would cross it\. Place the inside at the left of the stack, or open a block of the branch/)
            expect(() => s.play(model.open('LoRA', far))).toThrow(/layerStack: open\("LoRA"\): block 2 \("LoRA"\) is at the right of the stream, and the lines to the inside would cross the stream\. Place the inside at the right of the stack/)
            expect(() => model.open('embed', model.blocks[1]!)).toThrow(/layerStack: open: the inside is the stack or a part of it/)
            expect(() => model.open('embed', 'grid' as never)).toThrow(/layerStack\.open: the inside is the string "grid"\. Give a node, a block of the layout, or a list of them/)
            s.play(model.open('W', far))
            // With no open block, close() changes nothing.
            const fresh = s.add(layerStack(MODEL))
            expect(() => s.play(fresh.close())).not.toThrow()
            expect(fresh.opened).toBeNull()
        }))
    })

    it('writes the value of each cell with `digits`, in cells that hold it, and hides the numbers while the edge of a block would cut them', async () => {
        let stack!: Stack
        const report = await checkFilm(film({ fps: 20 }, (s) => {
            stack = s.add(layerStack(['embed', { branch: ['attention'] }, 'scores'], { digits: 1, cells: 3 }))
            s.play(stack.feed([0.5, -1.25, 0]), { duration: 1, ease: linear })
            s.wait(1)
            s.play(stack.pass('embed', [1, -0.04, 9.9]), { duration: 2, ease: linear })
            s.wait(1)
            s.play(stack.pass('attention', [1.5, 0.96, 9.9]), { duration: 10 })
            s.wait(1)
        }), { motion: true, textGap: 0.7 })
        // No number is cut by the edge of a block, and none touches a mark of the stack.
        expect(report.diagnostics).toEqual([])
        const { vector, copy } = stack
        // A value that rounds to zero has no sign.
        expect(at(1.5, () => numbers(vector))).toEqual(['0.5', '-1.3', '0.0'])
        expect(at(4.5, () => numbers(vector))).toEqual(['1.0', '0.0', '9.9'])
        // A number is in the middle of its cell, and the cell is wider than the widest number that it may hold.
        const cell = cells(vector)[1]!, number = at(1.5, () => vector.children[vector.children.length - 1]!.children[1]!)
        const [box, ink] = at(1.5, () => [edges(cell), edges(number)])
        expect(Math.abs((ink![0]! + ink![2]!) / 2 - (box![0]! + box![2]!) / 2)).toBeLessThan(2)
        expect(ink![0]! - box![0]!).toBeGreaterThan(4)
        expect(number.data['size']).toBe(28)
        // With numbers, the fill of a cell stays under a half, so a number in ink reads on it.
        expect(at(1.5, () => looks(vector).map(([, fill]) => fill))).toEqual([expect.closeTo(0.3, 6), 0.5, 0.1])
        // The numbers are away while the vector is behind "embed", and back when it is clear of the block.
        expect([2, 2.4, 3, 3.6, 4].map((time) => at(time, () => numbersShow(vector)))).toEqual([1, 0, 0, 0, 1])
        // The copy has no numbers on its way in. On its way out, it shows what the branch adds, and it stops at the add with them.
        expect(at(7, () => [shows(copy), numbersShow(copy)])).toEqual([1, 0])
        expect(at(13, () => [numbersShow(copy), numbers(copy)])).toEqual([1, ['0.5', '1.0', '0.0']])
        expect(at(13, () => numbers(vector))).toEqual(['1.0', '0.0', '9.9'])
        // A vector with numbers is higher than one with none. The copy at the add is clear of the block under it, and
        // the vector that waits is clear of the copy.
        const [coming, block, waiting] = at(13, () => [edges(copy), edges(stack.boxes[1]!), edges(vector)])
        expect(coming![3]).toBeLessThan(block![1]! - 2)
        expect(waiting![1]).toBeGreaterThan(coming![3]! + 2)
        expect(at(16.5, () => [numbers(vector), numbersShow(vector)])).toEqual([['1.5', '1.0', '9.9'], 1])
        await compileFilm(film(() => {
            expect(() => stack.pass('scores', [100, 0, 0])).toThrow(/layerStack: value 0 of pass\("scores"\) is 100, which a cell writes as "100\.0"\. A cell has room for a number as wide as "-8\.8"\. Give smaller values, such as a tenth of each, or fewer digits/)
            expect(() => stack.pass('scores', [-8.8, 9.9, 0])).not.toThrow()
            // Without `digits`, a cell is a small square with no number.
            const plain = layerStack(MODEL)
            expect(cells(plain.vector).map((made) => [made.bounds().width, made.bounds().height])).toEqual([[20, 20], [20, 20], [20, 20], [20, 20]])
            expect(cells(layerStack(MODEL, { cells: 7 }).vector)).toHaveLength(7)
        }))
    })

    it('gives a copy its own state, and takes the font of the film and a backing of another color', async () => {
        let stack!: Stack, copy!: Stack
        await compile((s) => {
            stack = s.add(layerStack(MODEL, { shape: '(T)' }).at(-300, 0))
            s.play(stack.feed([1, 0, 0, 0]), stack.mark('embed', 'frozen'), stack.light('norm'), { duration: 1 })
            copy = s.add(stack.clone().at(300, 0))
            // A change of the copy does not change the stack, and the copy goes on from the state that it was made with.
            s.play(copy.pass('embed', [0, 1, 0, 0]), copy.mark('unembed', 'frozen'), copy.light('attention'), { duration: 1 })
            expect([stack.passed, stack.values, stack.current, stack.stateOf('unembed')]).toEqual([0, [1, 0, 0, 0], 1, 'live'])
            expect([copy.passed, copy.values, copy.current, copy.stateOf('unembed'), copy.stateOf('embed')]).toEqual([1, [0, 1, 0, 0], 2, 'frozen', 'frozen'])
        })
        expect(copy.blocks[0]).not.toBe(stack.blocks[0])
        expect(copy.vector.parent).toBe(copy)
        expect(at(2, () => [stack.vector.get('y'), copy.vector.get('y')])).toEqual([225, 124])
        expect(at(2, () => looks(copy.vector)[1])).toEqual([paint('teal'), 0.95])
        expect(at(2, () => looks(stack.vector)[1])).toEqual([paint('dim'), 0.14])
        await compileFilm(film({ font: 'text-serif' }, () => {
            const inFilm = layerStack(MODEL)
            expect((inFilm.labels[0] as TextNode).font).toBe('text-serif')
            expect((layerStack(MODEL, { font: 'mono' }).labels[0] as TextNode).font).toBe('mono')
            const onPanel = layerStack(MODEL, { backing: 'surface' })
            expect(onPanel.blocks[0]!.children[0]!.get('fill')).toEqual(paint('surface'))
            expect(() => layerStack(MODEL, { backing: 'no such color' })).toThrow(/layerStack: backing is "no such color", which is not a color/)
        }))
    })
})

describe('passage', () => {
    const POLICY = 'Refunds are accepted within 14 days of delivery. A request after that date goes to a human agent, who answers within 48 hours.'
    const RUNBOOK = 'If the error rate stays above 2% after a deploy, roll back within 15 minutes. Then page the incident commander. Write the deploy ID in the incident channel.'
    const V1 = 'Refunds are accepted within 30 days of delivery. A request after that date is refused. Gift cards are not refundable.'
    const V2 = 'Refunds are accepted within 15 days of delivery. A request after that date goes to a human agent. Gift cards are not refundable.'
    type Page = ReturnType<typeof passage>
    type Box = { x: number; y: number; right: number; bottom: number }
    // A line of 32 px text is 1.6 of the size.
    const PITCH = 51.2
    const paint = (color: string) => JSON.stringify(rect(1, 1, { fill: color, stroke: null }).get('fill'))
    const right = (node: Node) => { const box = node.bounds(); return box.x + box.width }
    const bottom = (node: Node) => { const box = node.bounds(); return box.y + box.height }
    const keys = (glyphs: readonly Node[]) => glyphs.map((glyph) => glyph.data['key']).join('')
    /** The box around the ink of some glyphs. */
    const around = (glyphs: readonly Node[]): Box => {
        const boxes = glyphs.map((glyph) => glyph.bounds())
        return { x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)), right: Math.max(...boxes.map((b) => b.x + b.width)), bottom: Math.max(...boxes.map((b) => b.y + b.height)) }
    }
    /** The box of a mark of a frame, in the coordinates of the stage: the middle of the frame of 1920 by 1080 is the point 0, 0. */
    const boxed = (op: PathOp): Box => { const b = pathBounds(op.path)!; return { x: b.x - 960, y: b.y - 540, right: b.x + b.width - 960, bottom: b.y + b.height - 540 } }
    /** The shapes of a frame that are filled in one color and are not glyphs, as boxes. */
    const filled = (f: CompiledFilm, time: number, color: string) => paths(f, time).filter((op) => op.node?.data['key'] === undefined && op.fill !== null && JSON.stringify(op.fill) === paint(color) && op.fillAlpha > 0.02).map(boxed)
    /** The lines of a frame in one color. */
    const lined = (f: CompiledFilm, time: number, color: string) => paths(f, time).filter((op) => op.stroke !== null && JSON.stringify(op.stroke) === paint(color) && op.strokeAlpha > 0.02)
    const covers = (box: Box, words: Box) => box.x <= words.x + 0.01 && box.right >= words.right - 0.01 && box.y <= words.y + 0.01 && box.bottom >= words.bottom - 0.01

    it('starts at the corner that it is given, wraps its words at its width, and measures as its width and its height', async () => {
        await compileFilm(film(() => {
            const page = passage(POLICY, { width: 600 }).at(100, 50)
            const frame = page.frame!.bounds()
            expect([frame.x, frame.y, frame.width]).toEqual([100, 50, 600])
            // The words are inside the frame, with room at both sides.
            expect(page.words.bounds().x).toBeGreaterThan(116)
            expect(right(page.words)).toBeLessThan(684)
            expect(page.words.source).toBe(POLICY)
            // The layout measures the object as its frame.
            const box = boxOf(page)
            expect([box.left, box.top, box.width, box.height]).toEqual([100, 50, 600, expect.closeTo(frame.height, 6)])
            // A narrower passage has more lines, and each line adds its height.
            const wide = passage(POLICY, { width: 1200 }), narrow = passage(POLICY, { width: 500 })
            expect(narrow.lineCount).toBeGreaterThan(wide.lineCount)
            expect(narrow.frame!.bounds().height - wide.frame!.bounds().height).toBeCloseTo((narrow.lineCount - wide.lineCount) * PITCH, 6)
            // With no frame the object is as wide too, and no letter passes its width, at any width.
            for (let width = 300; width <= 700; width += 7) {
                const bare = passage(POLICY, { width, panel: false })
                expect(bare.frame).toBeNull()
                expect(bare.words.bounds().x).toBeGreaterThanOrEqual(0)
                expect(right(bare.words)).toBeLessThanOrEqual(width)
                expect(boxOf(bare).width).toBe(width)
            }
            // A break that the film wrote starts a line, and an empty line adds half a line.
            const broken = passage('first line\nsecond line\n\nthird line', { width: 900 })
            expect([broken.lineCount, broken.text]).toEqual([3, 'first line\nsecond line\n\nthird line'])
            const tops = [0, 4, 8].map((letter) => broken.find('line')[letter]!.bounds().y)
            expect([tops[1]! - tops[0]!, tops[2]! - tops[1]!]).toEqual([expect.closeTo(PITCH, 6), expect.closeTo(PITCH * 1.5, 6)])
            // Tabs and spaces in a row are one space.
            expect(passage('a \t  b').text).toBe('a b')
            // With no width, the text is on one line and the object is as wide as that line needs, up to 900.
            const short = passage('Refunds arrive within 14 days.')
            expect(short.lineCount).toBe(1)
            expect(boxOf(short).width).toBeLessThan(560)
            expect(boxOf(short).width - right(short.words)).toBeLessThan(28)
            expect(boxOf(passage(`${POLICY} ${POLICY}`)).width).toBe(900)
            // The layout builds a passage that is as wide as a region.
            expect(boxOf(fitted(700, (width) => passage(POLICY, { width }))).width).toBeCloseTo(700, 6)
            // `lines` keeps room in the frame for lines that come later.
            const roomy = passage('one line', { width: 400, lines: 3 })
            expect(roomy.lineCount).toBe(1)
            expect(roomy.frame!.bounds().height - passage('one line', { width: 400 }).frame!.bounds().height).toBeCloseTo(2 * PITCH, 6)
            // The title is over the words, at 26 px for words of 32 px, and the frame is higher by its room.
            const titled = passage(POLICY, { width: 600, title: 'policy.md' })
            expect([titled.title!.source, titled.title!.data['size']]).toEqual(['policy.md', 26])
            // The title is 0.8 of the size of the words, and not under 26 px unless the words are.
            expect([40, 26, 20].map((size) => passage(POLICY, { width: 600, size, title: 'policy.md' }).title!.data['size'])).toEqual([32, 26, 20])
            expect(passage(POLICY, { width: 600, title: 'policy.md', titleSize: 30 }).title!.data['size']).toBe(30)
            expect(bottom(titled.title!)).toBeLessThan(titled.words.bounds().y)
            expect(titled.frame!.bounds().height - passage(POLICY, { width: 600 }).frame!.bounds().height).toBeCloseTo(39, 6)
            expect(passage(POLICY, { width: 600 }).title).toBeNull()
            // The words are in the font of the film, or in the font that the film names.
            const letter = (font: 'sans' | 'text-serif') => text('R', { font, size: 32 }).chars[0]!.get('path')
            expect(passage(POLICY).words.chars[0]!.get('path')).toEqual(letter('sans'))
            expect(passage(POLICY, { font: 'text-serif' }).words.chars[0]!.get('path')).toEqual(letter('text-serif'))

            expect(() => passage('  ')).toThrow(/passage: give it the text/)
            expect(() => passage(POLICY, { leading: 1 })).toThrow(/leading is the height of a line as a multiple of size\. The band of a span is 1\.\d+ of the size high, so give 1\.\d+ or more/)
            // A word that is wider than the passage is an error, and the width that it names is enough.
            const long = 'incomprehensibilities'
            let enough = 0
            try {
                passage(long, { width: 200 })
            } catch (error) {
                enough = Number(/Give a width of (\d+) or more, or a smaller size/.exec((error as Error).message)?.[1])
            }
            expect(enough).toBeGreaterThan(200)
            expect(() => passage(long, { width: enough - 1 })).toThrow(/the word "incomprehensibilities" is \d+ px wide at size 32, and a width of \d+ leaves \d+ px for the text/)
            expect(passage(long, { width: enough }).lineCount).toBe(1)
            expect(() => passage(POLICY, { width: 300, title: 'a title that is much wider than the passage' })).toThrow(/the title "a title that is much wider than the passage" is \d+ px wide, and a width of 300 leaves \d+ px for it\. Give a shorter title, or a width of \d+ or more/)
            expect(() => passage(POLICY, { lines: 0 })).toThrow(/lines is the least number of lines of the frame, a whole number, 1 or more, not 0/)
            expect(() => passage(POLICY, { width: 10 })).toThrow(/width is the width of the object\. Give more than \d+/)
        }))
    })

    it('finds a part by its words at the borders of words, and says why it cannot find one', async () => {
        await compileFilm(film(() => {
            const page = passage(`${POLICY}\nGift cards have no limit of days.`, { width: 700 })
            expect(keys(page.find('within 14 days'))).toBe('within14days')
            // A part that is only inside longer words: `find` gives those places, and a part of a verb must be whole words.
            expect(keys(page.find('day'))).toBe('dayday')
            expect(page.find('never')).toEqual([])
            expect(page.measure('within 14 days')).toEqual({ words: 3, characters: 14 })
            // A part may run over the end of a sentence and of a line.
            expect(page.measure('delivery. A request')).toEqual({ words: 3, characters: 19 })
            expect(page.measure('48 hours.\nGift cards').words).toBe(4)
            expect(() => page.measure('day')).toThrow(/measure: "day" is in the text only as a part of "days"\. A part starts and ends at the borders of words/)
            expect(() => page.measure('never')).toThrow(/measure: the words "never" are not in the text\. A part is words of the text, letter for letter\. The text starts with "Refunds are accepted within 14 days o\.\.\."/)
            // Words that are at two places name no part. More words, or the number of the place, do.
            expect(() => page.measure('days')).toThrow(/the words "days" are at 2 places of the text\. Give more of the words around the place, or \{ words: "days", occurrence: 0 \} for the first place/)
            expect(page.measure({ words: 'days', occurrence: 1 })).toEqual({ words: 1, characters: 4 })
            expect(page.p({ words: 'days', occurrence: 1 })[1]).toBeGreaterThan(page.p({ words: 'days', occurrence: 0 })[1] + PITCH - 1)
            expect(() => page.measure({ words: 'days', occurrence: 2 })).toThrow(/the words "days" are at 2 places of the text, and the first is occurrence 0\. There is no occurrence 2/)
            expect(() => page.measure(7 as never)).toThrow(/measure: a part of the text is its words, \{ words, occurrence \}, \{ chunk: 0 \}, or the node of a span, not 7/)
        }))
    })

    it('marks a part with a kind: a band behind its words, the sign of the kind, and a state that a film reads', async () => {
        let page!: Page
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            page = s.add(passage(POLICY, { width: 700 }).at(-350, -200))
            expect([page.spans, page.count()]).toEqual([[], 0])
            s.wait(1)
            s.play(page.mark('within 14 days', 'supported'), { duration: 1, ease: linear })
            expect(page.spans).toEqual([{ words: 'within 14 days', kind: 'supported' }])
            expect([page.kindOf('within 14 days'), page.kindOf('14 days'), page.count(), page.count('supported'), page.count('claim')]).toEqual(['supported', null, 1, 1, 0])
            expect([page.span('within 14 days').words, page.span('within 14 days').kind, page.span('within 14 days').passage]).toEqual(['within 14 days', 'supported', page])
            s.wait(1)
            // The span takes another kind: the same span, with another color and another sign.
            s.play(page.mark('within 14 days', 'contradicted'), { duration: 1 })
            expect(page.spans).toEqual([{ words: 'within 14 days', kind: 'contradicted' }])
            // Without a kind, a part takes the first kind. The spans are in the order of the text.
            s.play(page.mark('are accepted', 'claim'), page.mark('Refunds'), { duration: 0.5 })
            expect(page.spans.map((span) => `${span.words}: ${span.kind}`)).toEqual(['Refunds: mark', 'are accepted: claim', 'within 14 days: contradicted'])
            s.wait(0.5)
            s.play(page.mark('within 14 days', null), { duration: 0.5 })
            expect([page.count(), page.kindOf('within 14 days')]).toEqual([2, null])
            s.wait(0.5)
            expect(() => page.mark('Refunds', 'true')).toThrow(/passage: no kind "true"\. The kinds are mark, claim, supported, unsupported, contradicted, external, removed, added/)
            expect(() => page.count('true')).toThrow(/no kind "true"/)
            expect(() => page.span('of delivery')).toThrow(/span: no span is at "of delivery"\. The spans are "Refunds", "are accepted"\. Mark the words first, with mark\(\)/)
            expect(() => page.mark('Refunds', 'claim', { duration: -1 })).toThrow(/the duration of mark\(\) is -1\. It is a number, 0 or more/)
        }))
        const words = around(page.find('within 14 days')), next = page.find('of delivery')[0]!.bounds()
        expect(filled(compiled, 0.9, 'green')).toEqual([])
        // At rest: a green band behind the words, which ends before the next word, and a green line under the tails of the letters.
        const green = filled(compiled, 2.5, 'green')
        const band = green.find((box) => box.bottom - box.y > 30)!, line = green.find((box) => box.bottom - box.y < 6)!
        expect(green).toHaveLength(2)
        expect(covers(band, words)).toBe(true)
        expect(band.right).toBeLessThan(next.x)
        expect([line.x, line.right]).toEqual([expect.closeTo(words.x, 6), expect.closeTo(words.right, 6)])
        expect(line.y).toBeGreaterThan(words.bottom)
        expect(line.bottom).toBeLessThan(band.bottom)
        // The band and the line grow from the first word.
        const growing = filled(compiled, 1.5, 'green')
        expect(growing.map((box) => [box.x, (box.right - box.x) / (band.right - band.x)])).toEqual([[expect.closeTo(band.x, 6), expect.closeTo(0.5, 1)], [expect.closeTo(line.x, 6), expect.closeTo(0.5, 1)]])
        // The new kind: the band is red, the line has given way to a wave, and nothing is green.
        expect(filled(compiled, 4.2, 'green')).toEqual([])
        const red = filled(compiled, 4.2, 'red')
        expect(red).toHaveLength(2)
        expect(red.some((box) => Math.abs(box.x - band.x) < 0.01 && Math.abs(box.right - band.right) < 0.01 && box.bottom - box.y > 30)).toBe(true)
        const wave = red.find((box) => box.bottom - box.y < 30)!
        expect(wave.bottom - wave.y).toBeGreaterThan(line.bottom - line.y + 2)
        expect(wave.y).toBeGreaterThan(words.bottom)
        // A claim has a frame around its band, which shows when the band is around the words. A plain mark has none.
        const claim = around(page.find('are accepted'))
        expect(lined(compiled, 4.9, 'purple').some((op) => covers(boxed(op), claim) && op.strokeAlpha === 1)).toBe(true)
        // The line of the frame does not show while the end of the band grows over the letters.
        expect(lined(compiled, 4.2, 'purple')).toEqual([])
        expect(filled(compiled, 4.2, 'purple')).toHaveLength(1)
        expect(lined(compiled, 4.9, 'blue')).toEqual([])
        expect(filled(compiled, 4.9, 'blue').some((box) => covers(box, around(page.find('Refunds'))))).toBe(true)
        // Taken away: nothing of the span is drawn.
        expect(filled(compiled, 5.9, 'red')).toEqual([])
        expectPure(compiled, [0.5, 1.5, 2.5, 3.5, 4.2, 4.9, 5.9])
    })

    it('gives each kind its own sign, refuses kinds that differ by their color only, and keeps a word in one span', async () => {
        let page!: Page, old!: Node[]
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            page = s.add(passage('An old value and a new value. This line came from outside.', { width: 900 }).at(-450, -100))
            old = page.find('old value')
            s.play(page.mark('old value', 'removed'), page.mark('new value', 'added'), page.mark('This line came from outside.', 'external'), { duration: 0.5 })
            s.wait(0.5)
            // A film may play one mark twice: the second play changes nothing.
            const again = page.mark('new value', 'added')
            s.play(again, { duration: 0.5 })
            s.wait(0.5)
            // The kinds of a film of its own: each kind has a sign, and the first kind is the default.
            const own = s.add(passage(POLICY, { width: 700, kinds: { rule: { color: 'teal', sign: 'underline' }, fact: { color: 'blue' } } }).at(-350, 100))
            s.play(own.mark('within 14 days'), { duration: 0.2 })
            expect(own.spans).toEqual([{ words: 'within 14 days', kind: 'rule' }])
            expect(() => own.mark('Refunds', 'supported')).toThrow(/no kind "supported"\. The kinds are rule, fact/)
        }))
        const ops = paths(compiled, 0.9), words = around(old)
        // Words that are gone are dim, and a bar goes through the middle of their letters, over them.
        expect(at(0.9, () => old.every((glyph) => JSON.stringify(glyph.get('fill')) === paint('dim')))).toBe(true)
        expect(at(0.9, () => JSON.stringify(page.find('new value')[0]!.get('fill')))).toBe(paint('ink'))
        const bar = ops.findIndex((op) => op.node?.data['key'] === undefined && op.fill !== null && boxed(op).bottom - boxed(op).y < 6 && boxed(op).x <= words.x && boxed(op).right >= words.right)
        const through = boxed(ops[bar]!)
        expect((through.y + through.bottom) / 2).toBeGreaterThan(words.y + (words.bottom - words.y) * 0.25)
        expect((through.y + through.bottom) / 2).toBeLessThan(words.bottom - (words.bottom - words.y) * 0.25)
        expect(bar).toBeGreaterThan(ops.findIndex((op) => op.node === old[0]))
        // New words have two lines under them: one shape of two parts.
        const teal = paths(compiled, 0.9).filter((op) => op.fill !== null && JSON.stringify(op.fill) === paint('teal') && op.path.length === 2)
        expect(teal).toHaveLength(1)
        // A band that ends before a period does not reach the period, and it goes past the ink of its last letter.
        const fresh = around(page.find('new value')), period = page.find('value.').at(-1)!.bounds().x
        const behind = filled(compiled, 0.9, 'teal').find((box) => box.bottom - box.y > 30)!
        expect(behind.right).toBeGreaterThan(fresh.right)
        expect(behind.right).toBeLessThan(period)
        // Text from outside has diagonal lines over its band: many strips, each one inside the band.
        const orange = paths(compiled, 0.9).filter((op) => op.fill !== null && JSON.stringify(op.fill) === paint('orange'))
        const strips = orange.find((op) => op.path.length > 20)!, band = boxed(orange.find((op) => op.path.length === 1)!)
        expect(covers(band, boxed(strips))).toBe(true)
        expect(compiled.frame(1.9).ops).toHaveLength(compiled.frame(0.9).ops.length)

        expect(() => passage(POLICY, { kinds: { rule: { color: 'teal' }, fact: { color: 'blue' } } })).toThrow(/the kinds "rule" and "fact" have the sign 'band' both, so only their color tells them apart\. Give each kind its own sign\. The signs that are free: 'box', 'underline', 'double', 'dashed', 'wavy', 'hatch', 'strike'/)
        expect(() => passage(POLICY, { kinds: { rule: { color: 'teal', sign: 'zigzag' as never } } })).toThrow(/the sign of the kind "rule" is "zigzag"\. A sign is 'band', 'box'/)
        expect(() => passage(POLICY, { kinds: {} })).toThrow(/kinds is a record of the kinds of a span/)
        // A word is in one span, and only a span can be taken away.
        await expect(compile((s) => {
            const made = s.add(passage(POLICY))
            s.play(made.mark('within 14 days'))
            s.play(made.mark('14 days of delivery', 'claim'))
        })).rejects.toThrow(/mark: the words "14 days of delivery" share words with the span "within 14 days"\. A word is in one span\. Mark words that the other span does not hold, or take it away first with mark\("within 14 days", null\)/)
        await expect(compile((s) => {
            s.play(passage(POLICY).mark('Refunds', null))
        })).rejects.toThrow(/mark: no span is at "Refunds", so there is none to take away/)
    })

    it('cuts the text into chunks: windows of words with an overlap, sentences, paragraphs, or the words of each chunk', async () => {
        let page!: Page
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            page = s.add(passage(RUNBOOK, { width: 1100 }).at(-550, -200))
            expect(page.chunks).toEqual([])
            expect(() => page.chunk(0)).toThrow(/chunk: the passage is not cut, so it has no chunk\. Play cut\(\) first/)
            // The windows cut a fact in two: "15" ends one chunk, and "minutes." starts the next.
            s.play(page.cut({ size: 7 }), { duration: 1 })
            expect(page.chunks).toEqual(['If the error rate stays above 2%', 'after a deploy, roll back within 15', 'minutes. Then page the incident commander. Write', 'the deploy ID in the incident channel.'])
            s.wait(1)
            // A new cut takes the place of the old one.
            s.play(page.cut({ size: 7, overlap: 2 }), { duration: 1 })
            expect(page.chunks).toEqual(['If the error rate stays above 2%', 'above 2% after a deploy, roll back', 'roll back within 15 minutes. Then page', 'Then page the incident commander. Write the', 'Write the deploy ID in the incident', 'the incident channel.'])
            expect([page.chunk(2).words, page.chunk(2).kind]).toEqual(['roll back within 15 minutes. Then page', null])
            // The node of a chunk is around its words, and a part can be named by its chunk.
            const second = page.chunk(1).bounds()
            expect(covers({ x: second.x, y: second.y, right: second.x + second.width, bottom: second.y + second.height }, around(page.find('above 2% after a deploy, roll back')))).toBe(true)
            expect(page.measure({ chunk: 5 })).toEqual({ words: 3, characters: 21 })
            expect(() => page.chunk(6)).toThrow(/chunk: no chunk 6\. The passage has 6 chunks, and the first is chunk 0/)
            s.wait(1)
            s.play(page.cut({ by: 'sentence' }), { duration: 1 })
            expect(page.chunks).toEqual(['If the error rate stays above 2% after a deploy, roll back within 15 minutes.', 'Then page the incident commander.', 'Write the deploy ID in the incident channel.'])
            s.wait(1)
            s.play(page.cut(['If the error rate stays above 2%', 'above 2% after a deploy, roll back within 15 minutes.']), { duration: 0.5 })
            expect(page.chunks).toEqual(['If the error rate stays above 2%', 'above 2% after a deploy, roll back within 15 minutes.'])
            s.play(page.cut(null), { duration: 0.5 })
            expect(page.chunks).toEqual([])
            s.wait(0.5)
            const two = s.add(passage('One. Two!\nThree?\n\nFour.', { width: 600 }).at(-300, 200))
            s.play(two.cut({ by: 'paragraph' }), { duration: 0.2 })
            expect(two.chunks).toEqual(['One. Two!\nThree?', 'Four.'])
            s.play(two.cut({ by: 'sentence' }), { duration: 0.2 })
            expect(two.chunks).toEqual(['One.', 'Two!', 'Three?', 'Four.'])

            expect(() => s.play(page.cut({ size: 4, overlap: 3 }))).toThrow(/cut: overlap is the number of words that two chunks share, a whole number from 0 to half of size \(2\), not 3/)
            expect(() => s.play(page.cut({ size: 0 }))).toThrow(/cut: size is the number of words of a chunk, a whole number, 1 or more, not 0/)
            expect(() => s.play(page.cut(['Then page', 'If the error']))).toThrow(/cut: chunk 1 \("If the error"\) starts before chunk 0 or with it\. Give the chunks in the order of the text/)
            expect(() => s.play(page.cut(['If the error rate', 'the error']))).toThrow(/cut: chunk 1 \("the error"\) is inside chunk 0\. A chunk ends after the one before it/)
            expect(() => s.play(page.cut(['If the error rate', 'error rate stays', 'rate stays above']))).toThrow(/cut: chunks 0, 1 and 2 share the word "rate"\. A word is in two chunks at the most: give a smaller overlap/)
            expect(() => s.play(page.cut([]))).toThrow(/cut: the list of chunks is empty/)
            expect(() => s.play(page.cut({ by: 'word' as never }))).toThrow(/cut: by is 'sentence' or 'paragraph', not "word"/)
            expect(() => s.play(page.cut('sentence' as never))).toThrow(/cut takes \{ size, overlap \}, \{ tokens: budget \}, \{ by: 'sentence' \} or \{ by: 'paragraph' \}, the words of each chunk, or null, not "sentence"/)
            expect(() => s.play(page.cut({ size: 7 }, { colors: ['blue'] as never }))).toThrow(/the colors of cut\(\) are two colors/)
        }))
        // The chunks are bands of two colors in turn, as high as a line. Two chunks on one line have a gap between them.
        const [purple, orange] = [filled(compiled, 1.5, 'purple'), filled(compiled, 1.5, 'orange')]
        const first = purple.find((box) => covers(box, around(page.find('If the error rate stays above 2%'))))!, second = orange.find((box) => box.x > first.right)!
        expect(first.bottom - first.y).toBeCloseTo(PITCH, 6)
        expect(second.x - first.right).toBeGreaterThan(4)
        expect(second.x).toBeLessThan(page.find('after')[0]!.bounds().x)
        // Over the words that two chunks share, the first chunk has the upper half of the line and the next one the lower half.
        const shared = around(page.find('above 2%')), own = around(page.find('If the error rate stays'))
        const upper = filled(compiled, 3.5, 'purple').find((box) => covers({ ...box, bottom: shared.bottom }, shared) && box.right < shared.right + 8)!
        const lower = filled(compiled, 3.5, 'orange').find((box) => covers({ ...box, y: shared.y }, shared) && box.right < shared.right + 8)!
        expect([upper.bottom - upper.y, lower.bottom - lower.y, lower.y - upper.y]).toEqual([expect.closeTo(PITCH / 2, 6), expect.closeTo(PITCH / 2, 6), expect.closeTo(PITCH / 2, 6)])
        // The words of one chunk only have the whole line, in the color of the chunk, and they join the half with no gap.
        const whole = filled(compiled, 3.5, 'purple').find((box) => covers(box, own))!
        expect(whole.bottom - whole.y).toBeCloseTo(PITCH, 6)
        expect(upper.x - whole.right).toBeCloseTo(0, 6)
        expect(filled(compiled, 3.5, 'orange').some((box) => box.x < own.right && box.y < own.bottom && box.bottom > own.y)).toBe(false)
        // The old chunks are gone when the new ones are there, and all are gone after cut(null).
        expect(filled(compiled, 1.5, 'purple')).toHaveLength(2)
        expect(filled(compiled, 5.5, 'purple').length + filled(compiled, 5.5, 'orange').length).toBeLessThanOrEqual(5)
        expect([...filled(compiled, 7.2, 'purple'), ...filled(compiled, 7.2, 'orange')]).toEqual([])
    })

    it('moves one selection, and a counter runs to its size', async () => {
        let page!: Page, words!: Value, late!: Value
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            page = s.add(passage(POLICY, { width: 700, tokens: (text) => Math.ceil(text.length / 4) }).at(-350, -200))
            words = page.counter('words')
            expect(page.selection).toBeNull()
            expect(page.measure()).toEqual({ words: 23, characters: POLICY.length, tokens: Math.ceil(POLICY.length / 4) })
            s.wait(1)
            s.play(page.select('within 14 days'), { duration: 1, ease: linear })
            expect(page.selection).toEqual({ words: 3, characters: 14, tokens: 4 })
            // A counter that is made later starts at the size of the selection.
            late = page.counter('characters')
            expect([late.value, page.counter('words')]).toEqual([14, words])
            s.wait(1)
            s.play(page.select('Refunds are accepted within 14 days of delivery.'), { duration: 1, ease: linear })
            expect(page.selection).toEqual({ words: 8, characters: 48, tokens: 12 })
            s.wait(1)
            s.play(page.select(null), { duration: 1, ease: linear })
            expect(page.selection).toBeNull()
            s.wait(1)
            expect(() => page.counter('lines' as never)).toThrow(/a counter counts 'words', 'characters' or 'tokens', not "lines"/)
            // A passage has no tokenizer of its own.
            expect(() => passage(POLICY).counter('tokens')).toThrow(/counter\('tokens'\) needs the tokens function of the passage\. Give passage\(text, \{ tokens \}\) the tokenizer of the film, or an estimate/)
            expect(passage(POLICY).measure('within 14 days')).toEqual({ words: 3, characters: 14 })
            expect(() => passage(POLICY, { tokens: () => Number.NaN }).measure()).toThrow(/the tokens function returned NaN for "Refunds are accepted/)
        }))
        expect([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5].map((time) => at(time, () => words.value))).toEqual([0, 1.5, 3, 5.5, 8, 4, 0].map((value) => expect.closeTo(value, 6)))
        expect([2.5, 3.5, 4.5, 6.5].map((time) => at(time, () => late.value))).toEqual([14, 31, 48, 0].map((value) => expect.closeTo(value, 6)))
        // The selection is one frame around its words. Its line does not show while its ends move over letters.
        const frame = lined(compiled, 2.5, 'yellow')
        expect(frame).toHaveLength(1)
        expect(covers(boxed(frame[0]!), around(page.find('within 14 days')))).toBe(true)
        expect(boxed(frame[0]!).right).toBeLessThan(page.find('of delivery')[0]!.bounds().x)
        expect(lined(compiled, 3.5, 'yellow')).toEqual([])
        expect(filled(compiled, 3.5, 'yellow').length).toBeGreaterThan(0)
        const wide = lined(compiled, 4.5, 'yellow').map(boxed)
        expect(covers({ x: Math.min(...wide.map((box) => box.x)), y: Math.min(...wide.map((box) => box.y)), right: Math.max(...wide.map((box) => box.right)), bottom: Math.max(...wide.map((box) => box.bottom)) }, around(page.find('Refunds are accepted within 14 days of delivery.')))).toBe(true)
        expect([...lined(compiled, 6.5, 'yellow'), ...filled(compiled, 6.5, 'yellow')]).toEqual([])
    })

    it('lifts a part out as a passage of its own, from the place of its words to the place that the film gave it', async () => {
        let page!: Page, part!: Page
        const definition = film({ fps: 20 }, (s) => {
            page = s.add(passage(POLICY, { width: 700, size: 40 }).at(-800, -300))
            part = page.slip('within 14 days of delivery', { title: 'evidence' }).at(200, 100)
            // The slip has the words, the size and the font of the page, and the options that the film gives it.
            expect([part.text, part.title!.source, part.lineCount, part.words.data['size']]).toEqual(['within 14 days of delivery', 'evidence', 1, 40])
            s.wait(1)
            s.play(page.lift(part), { duration: 1, ease: linear })
            s.wait(1)
            expect(page.text).toBe(POLICY)
            // A slip is as wide as its words need, and as wide as the page at the most. A chunk is a part too.
            s.play(page.cut({ by: 'sentence' }), { duration: 0.2 })
            expect(boxOf(page.slip({ chunk: 1 })).width).toBe(700)
            expect(page.slip({ chunk: 0 }).text).toBe('Refunds are accepted within 14 days of delivery.')
            expect(() => page.lift(passage('within 14 days'))).toThrow(/lift takes a slip of this passage\. Make one with slip\(\)/)
            expect(() => page.lift(passage(POLICY).slip('within 14 days'))).toThrow(/lift takes a slip of this passage/)
            expect(() => page.slip('never')).toThrow(/slip: the words "never" are not in the text/)
        })
        const compiled = await compileFilm(definition)
        const source = page.find('within 14 days of delivery'), landed = part.find('within 14 days of delivery')
        const same = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.width - b.width) < 0.01
        /** The marks of a frame that are at the place of a glyph: [glyphs, shapes that are no glyph]. */
        const here = (time: number, glyph: Node) => {
            const box = at(time, () => glyph.bounds())
            const found = paths(compiled, time).filter((op) => op.fillAlpha > 0.5 && same({ x: boxed(op).x, y: boxed(op).y, width: boxed(op).right - boxed(op).x, height: 0 }, box))
            return [found.filter((op) => op.node?.data['key'] !== undefined).length, found.filter((op) => op.node?.data['key'] === undefined).length]
        }
        // Before the lift, the slip is not on the stage.
        expect(at(0.5, () => part.get('visible'))).toBe(false)
        // The lift starts with a copy of each letter at the place of the letter in the page. A copy is a shape and not text.
        expect(source.map((glyph) => here(1, glyph))).toEqual(source.map(() => [1, 1]))
        expect(landed.map((glyph) => here(1, glyph))).toEqual(landed.map(() => [0, 0]))
        // Half way, a copy is between the two places.
        const [from, to] = [source[0]!.bounds(), landed[0]!.bounds()]
        expect(paths(compiled, 1.4).some((op) => op.node?.data['key'] === undefined && Math.abs(boxed(op).x - (from.x + to.x) / 2) < 1 && Math.abs(boxed(op).y - (from.y + to.y) / 2) < 1)).toBe(true)
        // At the end, the words of the slip are text at their places in the slip, and the copies are gone. The page has its words.
        expect(landed.map((glyph) => here(2.5, glyph))).toEqual(landed.map(() => [1, 0]))
        expect(source.map((glyph) => here(2.5, glyph))).toEqual(source.map(() => [1, 0]))
        expect(at(2.5, () => [part.frame!.get('opacity'), part.title!.get('opacity')])).toEqual([1, 1])
        // No frame of the lift has text on text.
        expect((await checkFilm(definition, { motion: true })).diagnostics.filter((finding) => finding.code === 'film.text_overlap')).toEqual([])
    })

    it('ties a part to the span of another passage with a line that crosses no word, and follows the two', async () => {
        let answer!: Page, source!: Page, tie!: ReturnType<Page['link']>
        const definition = film({ fps: 20 }, (s) => {
            answer = s.add(passage('The shop is closed on Sunday.\nRefunds arrive immediately.', { width: 700, title: 'answer' }).at(-800, -300))
            source = s.add(passage('Opening hours: Monday to Saturday.\nClosed on Sunday.', { width: 600, title: 'source' }).at(100, -200))
            s.play(answer.mark('The shop is closed on Sunday.', 'claim'), source.mark('Closed on Sunday.'), { duration: 0.5 })
            tie = answer.link('The shop is closed on Sunday.', source.span('Closed on Sunday.'), { color: 'green' })
            s.play(tie.enter(), { duration: 1, ease: linear })
            s.wait(0.5)
            s.play(shift(source, 0, 120), { duration: 1 })
            s.wait(0.5)
            expect(tie.broken).toBe(false)
            s.play(tie.break(), { duration: 0.5 })
            expect(tie.broken).toBe(true)
            s.wait(2)
        })
        const compiled = await compileFilm(definition)
        const [claim, under, evidence] = at(1.9, () => [around(answer.find('The shop is closed on Sunday.')), around(answer.find('Refunds arrive')), around(source.find('Closed on Sunday.'))])
        const route = at(1.9, () => tie.routeNow()!)
        expect(route).toHaveLength(6)
        // The line starts under the last letter of the claim, and goes down into the room between the two lines of the answer.
        expect([route[0]![0], route[1]![0]]).toEqual([expect.closeTo(claim.right, 6), expect.closeTo(claim.right, 6)])
        expect(route[0]![1]).toBeGreaterThan(claim.bottom)
        expect(route[1]![1]).toBeGreaterThan(route[0]![1])
        expect(route[1]![1]).toBeLessThan(under.y - 4)
        // It runs level to the middle of the room between the two passages, which is at x 0, and goes down there.
        expect(route[2]).toEqual([expect.closeTo(0, 6), expect.closeTo(route[1]![1], 6)])
        expect(route[3]![0]).toBeCloseTo(0, 6)
        // It comes in level under the line of the span, and ends under the first letter of the span.
        expect([route[4]![0], route[5]![0], route[4]![1]]).toEqual([expect.closeTo(evidence.x, 6), expect.closeTo(evidence.x, 6), expect.closeTo(route[3]![1], 6)])
        expect(route[5]![1]).toBeGreaterThan(evidence.bottom)
        expect(route[4]![1]).toBeGreaterThan(route[5]![1])
        // The line is drawn from the claim: half of it at half of the time.
        const drawn = (time: number) => lined(compiled, time, 'green').filter((op) => op.fill === null && pathLength(op.path) > 100).reduce((sum, op) => sum + pathLength(op.path), 0)
        expect(drawn(1) / drawn(1.9)).toBeCloseTo(0.5, 1)
        // It follows the source: the end goes down with it, and the start stays.
        const moved = at(3.2, () => tie.routeNow()!)
        expect([moved[0], moved[5]![0], moved[5]![1] - route[5]![1]]).toEqual([route[0], route[5]![0], expect.closeTo(120, 6)])
        // A tie that does not hold: the line is two pieces of dashes in red, with a cross between them, in the room between the two passages.
        expect(lined(compiled, 3.2, 'red')).toEqual([])
        const broken = lined(compiled, 4.5, 'red')
        expect([broken.filter((op) => op.dash !== null).length, broken.filter((op) => op.dash === null).length]).toEqual([2, 2])
        for (const arm of broken.filter((op) => op.dash === null).map(boxed)) expect((arm.x + arm.right) / 2).toBeCloseTo(0, 6)
        expect(lined(compiled, 4.5, 'green')).toEqual([])
        // The film check has no finding for the line and the words, with a small room and with a large one.
        for (const textGap of [0.3, 0.7]) expect((await checkFilm(definition, { textGap, motion: true })).diagnostics.filter((finding) => finding.code !== 'film.text_brief')).toEqual([])
    })

    it('ties a part to any node, takes the nearest end of a part on two lines, and follows a part whose words change', async () => {
        let page!: Page, tie!: ReturnType<Page['link']>, end!: Node
        await compileFilm(film({ fps: 20 }, (s) => {
            page = s.add(passage('The shop is closed on Sunday.\nRefunds arrive immediately.', { width: 1000 }).at(-800, -300))
            end = page.find('Sunday.').at(-1)!
            const box = s.add(rect(200, 100).at(600, 300))
            // The endpoint leaves room for the dot beside a text label.
            const plain = page.link('Refunds arrive immediately.', box)
            expect(plain.routeNow()!.at(-1)).toEqual([expect.closeTo(500 - 32 * 0.9, 6), expect.closeTo(300, 6)])
            expect(plain.routeNow()![2]![0]).toBeCloseTo(350, 6)
            // `shift` moves the part that goes up or down.
            expect(page.link('Refunds arrive immediately.', box, { shift: 40 }).routeNow()![2]![0]).toBeCloseTo(390, 6)
            // A target under the passage: the line goes around the two by the right side, or by the left one.
            const low = s.add(rect(300, 80).at(-500, 200))
            expect(page.link('Refunds arrive immediately.', low).routeNow()![2]![0]).toBeCloseTo(200 + 32 * 0.9, 6)
            expect(page.link('Refunds arrive immediately.', low, { side: 'left' }).routeNow()![2]![0]).toBeCloseTo(-800 - 32 * 0.9, 6)
            // A part on two lines has an end on each. The line takes the end that is nearest to its side.
            const [lastOfFirst, firstOfSecond] = [around(page.find('Sunday.')), around(page.find('Refunds'))]
            expect(page.leader('Sunday.\nRefunds', 'right')[0]).toEqual([expect.closeTo(lastOfFirst.right + 800, 6), expect.any(Number)])
            expect(page.leader('Sunday.\nRefunds', 'left')[0]).toEqual([expect.closeTo(firstOfSecond.x + 800, 6), expect.any(Number)])
            expect(page.leader('Sunday.\nRefunds', 'left')[0][1] - page.leader('Sunday.\nRefunds', 'right')[0][1]).toBeCloseTo(PITCH, 6)

            expect(() => page.link('Refunds arrive immediately.', [0, 0] as never)).toThrow(/link: the target is 0,0\. Give a node: the span of another passage \(source\.span\('the words'\)\), a slip, or any node of the film/)
            expect(() => page.link('never', box)).toThrow(/link: the words "never" are not in the text/)
            expect(() => page.link('Refunds arrive immediately.', box, { side: 'up' as never })).toThrow(/the side of a link is 'left' or 'right', not "up"/)

            // A span keeps its link when a diff gives it new words: the line starts under the last of them, at each time.
            s.play(page.mark('The shop is closed on Sunday.', 'claim'), { duration: 0.5 })
            tie = s.add(page.link('The shop is closed on Sunday.', box))
            s.wait(0.5)
            s.play(page.diff('The shop is closed on Sunday and on Monday.\nRefunds arrive immediately.'), { duration: 1 })
            s.wait(1)
            s.play(page.accept(), { duration: 1 })
            s.wait(1)
        }))
        const starts = [0.8, 2.5, 4.5].map((time) => at(time, () => tie.routeNow()![0]![0]))
        expect(starts[0]).toBeCloseTo(at(0.8, () => right(end)), 6)
        expect(starts[1]).toBeCloseTo(at(2.5, () => right(page.find('Monday.').at(-1)!)), 6)
        expect(starts[2]).toBeCloseTo(at(4.5, () => right(page.find('Monday.').at(-1)!)), 6)
        expect(starts[1]).toBeGreaterThan(starts[0]! + 100)
        expect(starts[2]).toBeLessThan(starts[1]! - 50)
    })

    it('changes the text to its next version: the old words are struck, the new words arrive beside them, and accept closes the text up', async () => {
        let page!: Page, plain!: Page, slides!: Node, jumps!: Node
        const struck: Node[] = []
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            page = s.add(passage(V1, { width: 700 }).at(-350, -200))
            plain = passage(V2, { width: 700 }).at(-350, -200)
            s.play(page.mark('within 30 days'), { duration: 0.5 })
            struck.push(...page.find('30'), ...page.find('is refused.'))
            // In this change, "of" stays on its line, and "refundable." goes to the next line.
            slides = page.find('of delivery')[0]!
            jumps = page.find('refundable.')[0]!
            s.wait(0.5)
            // The same text is no change.
            s.play(page.diff(V1), { duration: 0.2 })
            expect(page.changes).toBe(0)
            s.wait(0.8)
            s.play(page.diff(V2), { duration: 1 })
            expect([page.text, page.changes, page.words.source]).toEqual([V2, 2, V2])
            // The span keeps its words: the word that replaces one of them is a part of it. The old word is no part of the text.
            expect(page.spans).toEqual([{ words: 'within 15 days', kind: 'mark' }])
            expect([page.kindOf('within 15 days'), page.find('30'), page.measure().words]).toEqual(['mark', [], 23])
            // A second change waits for accept(), and so does a cut.
            expect(() => s.play(page.diff(V1))).toThrow(/diff: the passage shows a change that waits\. Play accept\(\) first: it takes the old words away, and the text is then one version/)
            expect(() => s.play(page.cut({ size: 5 }))).toThrow(/cut: the passage shows a change that waits\. Play accept\(\) first/)
            s.wait(1)
            s.play(page.accept(), { duration: 1 })
            expect([page.text, page.changes]).toEqual([V2, 0])
            expect(page.spans).toEqual([{ words: 'within 15 days', kind: 'mark' }])
            s.wait(1)
            // With nothing to take, accept() changes nothing.
            s.play(page.accept(), { duration: 0.5 })
        }))
        // Both versions show: the old words are dim, with a bar through them and over them, and the new word is beside the old one on its line.
        const old = at(3.5, () => around(struck.slice(0, 2))), fresh = at(3.5, () => around(page.find('15')))
        expect(at(3.5, () => struck.every((glyph) => glyph.get('visible') && glyph.get('opacity') === 1 && JSON.stringify(glyph.get('fill')) === paint('dim')))).toBe(true)
        expect(fresh.x).toBeGreaterThan(old.right)
        expect(fresh.x - old.right).toBeLessThan(16)
        expect(fresh.y).toBeCloseTo(old.y, 0)
        const ops = paths(compiled, 3.5)
        const bar = ops.findIndex((op) => op.node?.data['key'] === undefined && op.fill !== null && JSON.stringify(op.fill) === paint('dim') && boxed(op).bottom - boxed(op).y < 6 && boxed(op).x <= old.x && boxed(op).right >= old.right)
        expect((boxed(ops[bar]!).y + boxed(ops[bar]!).bottom) / 2).toBeGreaterThan(old.y + 4)
        expect((boxed(ops[bar]!).y + boxed(ops[bar]!).bottom) / 2).toBeLessThan(old.bottom - 4)
        expect(bar).toBeGreaterThan(ops.findIndex((op) => op.node === struck[0]))
        // The words move from 2.2 s to 2.7 s. A word that stays on its line slides to its place.
        const place = (glyph: Node) => [glyph.get('x'), glyph.get('y')]
        const [slid, jumped] = [[at(1.9, () => place(slides)), at(3.5, () => place(slides))], [at(1.9, () => place(jumps)), at(3.5, () => place(jumps))]]
        expect([slid[1]![1], slid[1]![0]! > slid[0]![0]! + 10, jumped[1]![1]! > jumped[0]![1]! + 40]).toEqual([slid[0]![1], true, true])
        expect(at(2.45, () => [slides.get('opacity'), slides.get('x')])).toEqual([1, expect.closeTo((slid[0]![0]! + slid[1]![0]!) / 2, 0)])
        // A word that goes to another line fades out where it is and comes back at its place: it does not fly across the lines.
        expect(at(2.3, () => [place(jumps), jumps.get('opacity') < 1])).toEqual([jumped[0], true])
        expect(at(2.45, () => jumps.get('opacity'))).toBe(0)
        expect(at(2.6, () => [place(jumps), jumps.get('opacity') < 1])).toEqual([jumped[1], true])
        expect(at(2.8, () => jumps.get('opacity'))).toBe(1)
        // A new word is at its place when it starts to show, at 2.6 s: it does not fly in.
        expect(at(2.61, () => [place(page.find('15')[0]!), page.find('15')[0]!.get('opacity') > 0])).toEqual([at(3.5, () => place(page.find('15')[0]!)), true])
        expect(at(2.55, () => page.find('15')[0]!.get('opacity'))).toBe(0)
        // The new words have two lines under them.
        expect(paths(compiled, 3.5).filter((op) => op.fill !== null && JSON.stringify(op.fill) === paint('teal') && op.path.length === 2).length).toBeGreaterThanOrEqual(2)
        // The band of the span holds the old word and the new one.
        expect(filled(compiled, 3.5, 'blue').some((box) => covers(box, { ...old, right: fresh.right }))).toBe(true)
        // After accept, the old words do not show, and each letter is where a new passage of the next version has it. So is the frame.
        const placed = (made: Page) => made.words.chars.map((glyph) => [glyph.data['key'], Math.round(glyph.get('x') * 100), Math.round(glyph.get('y') * 100), glyph.get('visible'), glyph.get('opacity')])
        expect(at(5.5, () => placed(page))).toEqual(placed(plain))
        expect(at(5.5, () => struck.some((glyph) => glyph.get('visible')))).toBe(false)
        expect(at(5.5, () => page.frame!.bounds().height)).toBeCloseTo(plain.frame!.bounds().height, 6)
        expect(filled(compiled, 5.5, 'teal')).toEqual([])
        expect(filled(compiled, 5.5, 'blue').some((box) => covers(box, at(5.5, () => around(page.find('within 15 days')))))).toBe(true)
        expect(compiled.frame(6.4).ops).toHaveLength(compiled.frame(5.5).ops.length)
        expectPure(compiled, [0.9, 2.4, 3.5, 4.6, 5.5])
    })

    it('keeps the breaks of the next version, takes words away, and refuses a change that has no right picture', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            const placed = (made: Page) => made.words.chars.map((glyph) => [glyph.data['key'], Math.round(glyph.get('x') * 100), Math.round(glyph.get('y') * 100)])
            // Words go, a line break goes, and one comes. After accept, the text is laid out as the next version.
            for (const [before, after] of [['one two three four', 'one four'], ['old start of it\nsecond line', 'new start of it second line'], ['a b c d', 'a b\n\nnew c d'], ['first. second. third.', 'second. third.\nfourth.']] as const) {
                const made = s.add(passage(before, { width: 420 }))
                s.play(seq(made.diff(after), made.accept()), { duration: 0.4 })
                expect([made.text, made.changes]).toEqual([after, 0])
                expect(placed(made)).toEqual(placed(passage(after, { width: 420 })))
                s.remove(made)
            }
            // A new word stands beside the old word that it replaces, also where the old word started a line.
            const beside = s.add(passage('a b\nc d', { width: 420 }))
            const old = beside.find('c')[0]!
            s.play(beside.diff('a b\nx d'), { duration: 0.2 })
            expect(beside.lineCount).toBe(2)
            expect(beside.find('x')[0]!.bounds().x).toBeGreaterThan(right(old))
            expect(beside.find('x')[0]!.bounds().y).toBeCloseTo(old.bounds().y, 0)
            // When the old word leaves, the new word starts the line, as in the next version.
            s.play(beside.accept(), { duration: 0.2 })
            expect(placed(beside)).toEqual(placed(passage('a b\nx d', { width: 420 })))
            s.remove(beside)
            // Words that go with no word in their place are one change, and a span with no word left goes with them.
            const gone = s.add(passage('one two three four', { width: 420 }))
            s.play(gone.mark('two three', 'claim'), { duration: 0.1 })
            s.play(gone.diff('one four'), { duration: 0.2 })
            expect([gone.changes, gone.count()]).toEqual([1, 1])
            s.play(gone.accept(), { duration: 0.2 })
            expect([gone.text, gone.count()]).toEqual(['one four', 0])

            expect(() => gone.diff(' ')).toThrow(/diff takes the text of the next version/)
            expect(() => passage('alpha beta', { width: 300 }).diff('alpha incomprehensibilities-and-more')).toThrow(/diff: the word "incomprehensibilities-and-more" of the next version is \d+ px wide at size 32, and a width of 300 leaves \d+ px for the text\. Give the passage a width of \d+ or more, or a smaller size/)
            const cut = s.add(passage(POLICY))
            s.play(cut.cut({ size: 5 }), { duration: 0.1 })
            expect(() => s.play(cut.diff(V2))).toThrow(/diff: the passage is cut into chunks, and a chunk is a part of one version\. Take the chunks away first with cut\(null\), and cut the next version again/)
        }))
        // A frame with `lines` does not grow: a change that needs more lines says how many.
        await expect(compile((s) => {
            s.play(passage('alpha beta gamma', { lines: 1 }).diff('alpha beta gamma delta epsilon zeta eta theta'))
        })).rejects.toThrow(/diff: the two versions take \d lines side by side, and the passage has lines: 1\. Give lines: \d or more, or a larger width/)
        // The words move in one change at a time, and no band arrives while they move.
        await expect(compile((s) => {
            const made = s.add(passage(V1, { width: 700 }))
            s.play(made.diff(V2), made.accept(), { duration: 1 })
        })).rejects.toThrow(/accept\(\) plays from 0 s to 1 s, and diff\(\) plays from 0 s to 1 s\. The words move in one change at a time\. Play the two in a `seq`, or start accept\(\) at 1 s or later/)
        await expect(compile((s) => {
            const made = s.add(passage(V1, { width: 700 }))
            s.play(made.diff(V2), made.mark('Gift cards'), { duration: 1 })
        })).rejects.toThrow(/mark\(\) plays from 0 s to 1 s, while diff\(\) moves the words from 0 s to 1 s\. Play mark\(\) after it, or the two in a `seq`/)
    })

    it('resolves references in play order and measures the accepted text', async () => {
        let page!: Page
        await compile((s) => {
            page = s.add(passage('old text', { width: 420 }))
            s.wait(1)
            s.play(seq(page.cut({ size: 1 }), page.select({ chunk: 0 }), page.cut(null),
                page.diff('old text\na new line'), page.accept(), page.mark('new line'), page.select('new line')))
            expect(page.spans).toEqual([{ words: 'new line', kind: 'mark' }])
            expect(boxOf(page).height).toBeCloseTo(page.frame!.bounds().height)
            expect(page.lineCount).toBe(2)
            // The readout can be attached after the timeline has been written.
            expect(at(0, () => page.counter('words').value)).toBe(0)
            expect(page.counter('words').value).toBe(2)
        })
    })

    it('rejects overlapping edits in either order and leaves room for a shorter retry', async () => {
        await expect(compile((s) => {
            const page = s.add(passage('alpha beta', { width: 500 }))
            s.play(page.mark('beta'), page.diff('alpha gamma'))
        })).rejects.toThrow(/diff\(\) moves the words while mark\(\) plays/)
        await compile((s) => {
            const page = s.add(passage('one two', { width: 360, lines: 1 }))
            s.play(page.mark('two'))
            expect(() => s.play(page.diff('one\nthree\nfour'))).toThrow(/Give lines:/)
            expect(page.spans).toEqual([{ words: 'two', kind: 'mark' }])
            s.play(seq(page.diff('one six'), page.accept()))
            expect(page.span('six').words).toBe('six')
        })
    })

    it('uses the tokenizer on the whole candidate when cutting to a budget', async () => {
        await compile((s) => {
            // The pair "New York" has one token in this vocabulary.
            const tokens = (part: string) => part.replaceAll('New York', 'NY').match(/\w+|[^\w\s]/g)!.length
            const page = s.add(passage('New York costs $5. Paris costs $7.', { tokens }))
            s.play(page.cut({ tokens: 3 }))
            expect(page.chunks).toEqual(['New York costs', '$5.', 'Paris costs', '$7.'])
            expect(page.chunks.map((_, chunk) => page.measure({ chunk }).tokens)).toEqual([2, 3, 2, 3])
            expect(() => s.play(page.cut({ tokens: 2 }))).toThrow(/word "\$5\." exceeds the budget/)
            expect(() => s.play(passage('one two').cut({ tokens: 3 }))).toThrow(/tokens function/)
        })
    })

    it('drops ambiguous marks when one replacement crosses both of them', async () => {
        await compile((s) => {
            const page = s.add(passage('one two three four'))
            s.play(page.mark('two'), page.mark('three'))
            s.play(seq(page.diff('one six four'), page.accept()))
            expect(page.text).toBe('one six four')
            expect(page.spans).toEqual([])
        })
    })

    it('gives the places of its parts: a region, a point on a band, and the way of a line out of the passage', async () => {
        await compileFilm(film(() => {
            const page = passage(POLICY, { width: 700 }).at(100, 50)
            const words = around(page.find('within 14 days')), box = page.region('within 14 days')
            expect(covers({ x: box.left, y: box.top, right: box.right, bottom: box.bottom }, words)).toBe(true)
            expect(box.width).toBeLessThan(words.right - words.x + 8)
            expect(box.right).toBeLessThan(page.find('of delivery')[0]!.bounds().x)
            // The points on the band, in the coordinates of the object.
            expect(page.toWorld(...page.p('within 14 days'))).toEqual([expect.closeTo(box.cx, 6), expect.closeTo(box.bottom, 6)])
            expect(page.toWorld(...page.p('within 14 days', 'top'))).toEqual([expect.closeTo(box.cx, 6), expect.closeTo(box.top, 6)])
            expect(page.toWorld(...page.p('within 14 days', 'left'))).toEqual([expect.closeTo(box.left, 6), expect.closeTo(box.cy, 6)])
            expect(page.toWorld(...page.p('within 14 days', 'right'))).toEqual([expect.closeTo(box.right, 6), expect.closeTo(box.cy, 6)])
            expect(() => page.p('within 14 days', 'middle' as never)).toThrow(/the edge of p\(\) is 'top', 'bottom', 'left' or 'right', not "middle"/)
            // Without a part: the room of the text. A line is the row of its band.
            const all = page.region(), first = page.region({ line: 0 }), second = page.region({ line: 1 })
            expect([all.left, all.right]).toEqual([expect.closeTo(122.4, 6), expect.closeTo(777.6, 6)])
            expect(all.height).toBeCloseTo(page.lineCount * PITCH, 6)
            expect([second.left, second.width, second.top - first.top]).toEqual([expect.closeTo(all.left, 6), expect.closeTo(all.width, 6), expect.closeTo(PITCH, 6)])
            expect(second.top).toBeGreaterThan(first.bottom)
            expect(() => page.region({ line: 9 })).toThrow(/region: no line 9\. The text has \d lines, and the first is line 0/)
            // The way out: from under the end of the words, down into the room between two lines, and level to the side.
            const [start, turn, edge] = page.leader('within 14 days').map((point) => page.toWorld(...point))
            expect(start).toEqual([expect.closeTo(words.right, 6), expect.closeTo(box.bottom, 6)])
            expect(turn).toEqual([expect.closeTo(words.right, 6), expect.closeTo((box.bottom + second.top) / 2, 6)])
            expect(edge).toEqual([expect.closeTo(800, 6), expect.closeTo(turn![1], 6)])
            const left = page.leader('within 14 days', 'left').map((point) => page.toWorld(...point))
            expect([left[0]![0], left[2]![0]]).toEqual([expect.closeTo(words.x, 6), expect.closeTo(100, 6)])
            expect(() => page.leader('within 14 days', 'up' as never)).toThrow(/the side of leader\(\) is 'left' or 'right', not "up"/)
        }))
    })

    it('enters with its frame and its title, and then its words in the order of the text', async () => {
        let page!: Page
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            page = passage(POLICY, { width: 700, title: 'policy.md' })
            s.wait(1)
            s.play(page.enter(), { duration: 2, ease: linear })
            s.wait(0.5)
            expect(() => page.enter({ lag: 'slow' as never })).toThrow(/the lag of enter\(\) is "slow"\. It is a number, 0 or more/)
        }))
        expect(compiled.frame(0.5).ops).toHaveLength(0)
        const [first, middle, last] = [page.words.chars[0]!, page.find('date')[0]!, page.words.chars.at(-1)!]
        expect(at(1.4, () => [page.frame!.get('opacity'), page.title!.get('opacity')])).toEqual([expect.closeTo(0.4 / 0.7, 6), expect.closeTo(0.4 / 0.7, 6)])
        expect(at(1.4, () => [first, middle, last].map((glyph) => glyph.get('opacity')))).toEqual([expect.closeTo(0.67, 1), 0, 0])
        expect(at(2.2, () => [first, last].map((glyph) => glyph.get('opacity')))).toEqual([1, 0])
        expect(at(2.2, () => middle.get('opacity'))).toBeGreaterThan(0)
        expect(at(3.2, () => page.words.chars.every((glyph) => glyph.get('opacity') === 1))).toBe(true)
    })

    it('takes the font of the film for its words, its title and a slip, and a font of its own when it names one', async () => {
        await compile(() => {
            const letter = (font: 'sans' | 'text-serif' | 'mono', size: number) => text('R', { font, size }).chars[0]!.get('path')
            const page = passage(POLICY, { width: 700, title: 'Rules' })
            expect([page.words.chars[0]!.get('path'), page.title!.chars[0]!.get('path'), page.words.font]).toEqual([letter('text-serif', 32), letter('text-serif', 26), 'text-serif'])
            expect(page.slip('Refunds are accepted').words.chars[0]!.get('path')).toEqual(letter('text-serif', 32))
            const own = passage(POLICY, { width: 700, font: 'mono' })
            expect([own.words.chars[0]!.get('path'), own.slip('Refunds are accepted').words.chars[0]!.get('path')]).toEqual([letter('mono', 32), letter('mono', 32)])
            expect(letter('text-serif', 32)).not.toEqual(letter('sans', 32))
        }, { font: 'text-serif' })
    })

    it('passes the film check with its own layout, at a small text gap and at a large one', async () => {
        const definition = film({ fps: 20 }, (s) => {
            const kinds = s.add(passage('A plain mark, then a claim of the answer. One part is supported, one part is unsupported, and one is contradicted. This line came from outside. An old value and a new value.', { width: 880, title: 'answer.md' }).at(-900, -400))
            s.play(kinds.mark('plain mark', 'mark'), kinds.mark('a claim of the answer', 'claim'), kinds.mark('is supported', 'supported'), kinds.mark('is unsupported', 'unsupported'), kinds.mark('is contradicted', 'contradicted'),
                kinds.mark('This line came from outside.', 'external'), kinds.mark('old value', 'removed'), kinds.mark('new value', 'added'), { duration: 0.6 })
            const cut = s.add(passage(RUNBOOK, { width: 800, size: 26 }).at(60, -400))
            s.play(cut.cut({ size: 7, overlap: 2 }), cut.mark('within 15 minutes', 'supported'), { duration: 1 })
            s.play(cut.select('Then page the incident commander.'), { duration: 0.6 })
            const bare = s.add(passage('Refunds arrive within 14 days.', { panel: false, size: 48 }).at(-900, 200))
            s.play(bare.mark('within 14 days', 'claim'), { duration: 0.6 })
            s.wait(2)
        })
        // With 0.3 and 0.7, and with the most room that the rule asks for: 2% of the shorter side of the frame.
        for (const textGap of [0.3, 0.7, 3]) expect((await checkFilm(definition, { textGap, motion: true })).diagnostics.filter((finding) => finding.code !== 'film.text_brief')).toEqual([])
    })
})

export type { Vec, Vec3 }

describe('table', () => {
    type Board = ReturnType<typeof table>
    const words = (node: Node | null) => (node as unknown as { source: string }).source
    /** How much of a node a viewer gets: its opacity and that of each holder over it, and 0 when one of them is hidden. */
    const shows = (node: Node) => {
        let value = 1
        for (let holder: Node | null = node; holder; holder = holder.parent) {
            if (!holder.get('visible')) return 0
            value *= holder.get('opacity')
        }
        return value
    }
    const wide = (content: string, options: Parameters<typeof text>[1]) => text(content, options).get('px') * 2
    const right = (node: Node) => node.bounds().x + node.bounds().width
    /** The text node of a cell that the table was made with. */
    const first = (cell: TableCellNode) => cell.words.children[0] as TextNode
    /** The x of the anchor of the text of a cell, in the table: where a text at the left starts, and where a number ends. */
    const anchor = (cell: TableCellNode) => cell.get('x') + first(cell).get('x')
    /** The texts that a cell shows at a time. */
    const said = (cell: TableCellNode, time: number) => at(time, () => cell.words.children.filter((child) => shows(child) > 0.01).map(words))
    /** The marks that a cell shows at a time: the shape and the color of each. */
    const marksOf = (cell: TableCellNode, time: number) => at(time, () => cell.mark.children.filter((child) => shows(child) > 0.01).map((shape) => {
        const leaf = shape.leaves()[0]!
        return [shape.data['shape'], leaf.get('fill') ?? leaf.get('stroke')]
    }))
    /** Every row that the table has made, also those that left. */
    const made = (board: Board) => board.all().filter((node): node is TableRowNode => node instanceof TableRowNode && node.rowId !== null)
    /** The ids of the rows that a viewer sees at a time, from the top. */
    const seen = (board: Board, time: number) => at(time, () => made(board).filter((row) => shows(row.content) > 0.99).sort((a, b) => a.get('y') - b.get('y')).map((row) => row.rowId))
    /** What a cell of the total row says at a time: each text that shows. */
    const totals = (board: Board, column: number, time: number) => at(time, () => board.totals!.cells[column]!.all().filter((node) => node instanceof TextNode && shows(node) > 0.99).map(words))
    /** The middle and the size of the marker at a time, in the coordinates of the table. */
    const markerAt = (board: Board, time: number) => at(time, () => {
        const box = board.marker.bounds(), [x, y] = [board.get('x'), board.get('y')]
        return { left: box.x - x, right: box.x + box.width - x, top: box.y - y, bottom: box.y + box.height - y, y: box.y + box.height / 2 - y, shows: shows(board.marker), line: board.marker.get('strokeOpacity') }
    })

    // The column of the cases keeps room for a longer text than its first rows have: a row that comes later, or a new name.
    const COLS: TableColumn[] = [
        { key: 'case', sample: 'a longer case' },
        { key: 'score', total: 'sum' },
        { key: 'verdict', align: 'center', marks: true, total: (rows) => `${rows.filter((row) => row.states['verdict'] === 'pass').length} of ${rows.length}` },
    ]
    const ROWS: TableRow[] = [
        { id: 'a', case: 'first', score: 3, verdict: { state: 'pass' } },
        { id: 'b', case: 'second', score: 1, verdict: { state: 'fail' } },
        { id: 'c', case: 'third', score: 2, verdict: { state: 'pending' } },
    ]
    const D: TableRow = { id: 'd', case: 'fourth', score: 4, verdict: { state: 'fail' } }

    it('counts the changed value when a row enters after a faster cell update', async () => {
        let board!: Board
        await compile((s) => {
            board = s.add(table([{ key: 'score', total: 'sum' }], [], { maxRows: 1 }))
            s.play(board.append({ id: 'new', score: 2 }, { duration: 2 }), board.setCell('new', 'score', 9, { duration: 0.2 }))
            s.wait(1)
        })
        expect(totals(board, 0, 0.5)).toEqual(['0'])
        expect(totals(board, 0, 2)).toEqual(['9'])
        expect(board.totalOf('score')).toBe(9)
    })

    it('keeps the state of an id cell in a copy and uses it in the total', async () => {
        await compile((s) => {
            const board = s.add(table([{ key: 'id', marks: true, total: (rows) => rows.filter((row) => row.states.id === 'pass').length }], [{ id: 1 }]))
            s.play(board.setCell(1, 'id', { state: 'pass' }))
            const copy = board.clone()
            expect(copy.stateOf(1, 'id')).toBe('pass')
            expect(copy.totalOf('id')).toBe(1)
            s.play(copy.setCell(1, 'id', { state: 'fail' }))
            expect(board.totalOf('id')).toBe(1)
        })
    })

    it('preserves exact integer counts in the total row', async () => {
        await compile(() => {
            const board = table([{ key: 'tokens', total: 'sum' }], [{ id: 'a', tokens: 1_234_567_890_120 }, { id: 'b', tokens: 3 }])
            expect(board.totalOf('tokens')).toBe(1_234_567_890_123)
            expect(totals(board, 0, 0)).toEqual(['1234567890123'])
            const costs = table([{ key: 'cost', total: 'sum' }], [{ id: 'a', cost: 0.1 }, { id: 'b', cost: 0.2 }])
            expect(costs.totalOf('cost')).toBe(0.3)
            expect(totals(costs, 0, 0)).toEqual(['0.3'])
        })
    })

    it('edits the table inside a copied group independently', async () => {
        await compile((s) => {
            const original = table([{ key: 'n', total: 'sum' }], [{ id: 1, n: 1 }], { maxRows: 2 })
            const bar = rect(12, 4)
            original.cell(1, 'n').add(bar)
            const holder = s.add(Object.assign(group(original), { bar, heading: original.header('n') }))
            const second = s.add(holder.clone())
            const copy = second.children[0] as Table
            s.play(copy.setCell(1, 'n', 2))
            const third = s.add(second.clone())
            const latest = third.children[0] as Table
            s.play(latest.append({ id: 2, n: 3 }), latest.light(2))
            expect(third.heading).toBe(latest.header('n'))
            expect(third.bar.parent).toBe(latest.cell(1, 'n'))
            expect(third.bar).not.toBe(second.bar)
            expect([original, copy, latest].map((board) => totals(board, 0, 2))).toEqual([['1'], ['2'], ['5']])
            expect([original, copy, latest].map((board) => board.ids)).toEqual([[1], [1], [1, 2]])
            expect(markerAt(latest, 2).shows).toBe(1)
        })
    })

    it('hands the marker to the next row while removing the previous row', async () => {
        let board!: Board
        await compile((s) => {
            board = s.add(table(['id'], [{ id: 'a' }, { id: 'b' }]))
            s.play(board.light('a'), { duration: 0 })
            s.play(board.remove('a'), board.light('b'))
        })
        expect(board.lit).toEqual({ row: 'b', column: null })
        expect(markerAt(board, 1).shows).toBe(1)
    })

    it('rejects a backdated cell change even if its value matches a later change', async () => {
        await compile((s) => {
            const board = s.add(table(['n'], [{ id: 1, n: 1 }]))
            s.at(10, () => s.play(board.setCell(1, 'n', 2)))
            expect(() => s.at(1, () => s.play(board.setCell(1, 'n', 2)))).toThrow(/Call .* before it/)
        })
    })

    it('keeps a lit row visible when other rows exchange ranks around it', async () => {
        let board!: Board
        await compile((s) => {
            board = s.add(table(['n'], [{ id: 'a', n: 3 }, { id: 'b', n: 2 }, { id: 'c', n: 1 }]))
            s.play(board.light('b'), { duration: 0 })
            s.play(board.sort('n'), { duration: 1 })
        })
        expect(at(0.5, () => shows(board.row('b').content))).toBe(1)
        expect(markerAt(board, 0.5).shows).toBe(1)
    })

    it('keeps surviving rows apart when easing overshoots their final slots', async () => {
        let board!: Board
        await compile((s) => {
            board = s.add(table(['name'], Array.from({ length: 8 }, (_, id) => ({ id, name: 'Agjpqy' }))))
            s.play(board.remove([1, 2, 3, 4, 5, 6], { duration: 1, ease: overshoot() }))
        })
        expect(at(0.69, () => board.row(7).get('y') - board.row(0).get('y'))).toBeGreaterThanOrEqual(board.pitch - 1e-6)
    })

    it('keeps a delayed cell update with its original row when an id is reused', async () => {
        let board!: Board
        await compile((s) => {
            board = s.add(table([{ key: 'score', total: 'sum' }], [{ id: 1, score: 2 }]))
            s.play(board.setCell(1, 'score', 9, { duration: 4 }), seq(board.remove(1, { duration: 0.5 }), board.append({ id: 1, score: 3 }, { duration: 0.5 })))
        })
        expect(said(board.cell(1, 'score'), 4)).toEqual(['3'])
        expect(totals(board, 0, 4)).toEqual(['3'])
    })

    it('measures the full cell after a parent rotates it', async () => {
        await compile((s) => {
            const board = table(['score'], [{ id: 1, score: 2 }])
            const cell = board.region(1, 'score')
            s.add(group(board).rotate(Math.PI / 4))
            const rotated = board.region(1, 'score')
            const span = (cell.width + cell.height) / Math.sqrt(2)
            expect(rotated.width).toBeCloseTo(span)
            expect(rotated.height).toBeCloseTo(span)
        })
    })

    it('treats object property names as ordinary column keys in sparse records and copies', async () => {
        await compile(() => {
            const board = table(['constructor', '__proto__'], [{ id: 1, ['__proto__']: 'yes' }])
            const query = (row: TableRowView) => row.values['constructor'] === null && row.values['__proto__'] === 'yes'
            expect(board.find(query)).toEqual([1])
            expect(board.clone().find(query)).toEqual([1])
        })
    })

    it('centers the room of `maxRows` on its place, and draws the panel as high as its rows, with the header over them and the total row under them', async () => {
        await compileFilm(film(() => {
            const S = 20, P = S * 1.9
            const board = table(COLS, ROWS, { size: S, maxRows: 5 }).at(100, 50)
            // The room: the header, five rows and the total row, and 4 px over and under them. The layout measures it.
            const room = boxOf(board)
            expect([room.cx, room.cy, room.height]).toEqual([expect.closeTo(100, 6), expect.closeTo(50, 6), expect.closeTo(7 * P + 8, 6)])
            // The panel starts at the top of the room, and ends under the three rows that the table has and the total row.
            const frame = board.frame.bounds()
            expect([frame.x, frame.y, frame.width, frame.height]).toEqual([expect.closeTo(room.left, 6), expect.closeTo(room.top, 6), expect.closeTo(room.width, 6), expect.closeTo(5 * P + 8, 6)])
            expect(board.pitch).toBeCloseTo(P, 6)
            // From the top: the header, a line, the rows, a line, the total row. Each is one row high.
            const head = -(7 * P + 8) / 2 + 4 + P / 2
            expect(board.headers.map((header) => header.get('y'))).toEqual([head, head, head].map((y) => expect.closeTo(y, 6)))
            expect(board.rows.map((row) => row.get('y'))).toEqual([1, 2, 3].map((slot) => expect.closeTo(head + slot * P, 6)))
            expect(board.rules.map((rule) => rule.get('y'))).toEqual([expect.closeTo(head + P / 2, 6), expect.closeTo(head + 3.5 * P, 6)])
            expect(board.totals!.get('y')).toBeCloseTo(head + 4 * P, 6)
            expect(board.lines).toHaveLength(4)
            // A line between two rows shows when the table has the row under it: two lines for three rows.
            expect(board.lines.map((line) => line.get('opacity'))).toEqual([1, 1, 0, 0])
            // Without `maxRows`, the room is the room of the first rows. A table with no total has no total row and one line less.
            const plain = table(['case', 'score'], ROWS.map((row) => ({ id: row.id, case: row['case']!, score: row['score']! })), { size: S })
            expect(boxOf(plain).height).toBeCloseTo(4 * P + 8, 6)
            expect(plain.totals).toBeNull()
            expect(plain.rules).toHaveLength(1)
            // The defaults: a text size of 28, which is over the 26 px that a viewer of a film at 1080p needs, and rows of 1.9 of it.
            const usual = table(COLS, ROWS)
            expect([(usual.headers[0] as TextNode).size, first(usual.rows[0]!.cells[0]!).size, first(usual.rows[0]!.cells[1]!).size]).toEqual([28, 28, 28])
            expect(usual.pitch).toBeCloseTo(28 * 1.9, 6)
        }))
    })

    it('sets the columns once: texts start at one x, numbers end at one x in mono, and a larger width spreads the columns', async () => {
        await compileFilm(film(() => {
            const S = 20, pad = 0.7 * S
            const columns = [{ key: 'case' }, { key: 'units' }, { key: 'note' }]
            const rows = [{ id: 1, case: 'a', units: 5, note: 'x' }, { id: 2, case: 'a much longer case', units: 12345, note: 'y' }]
            const board = table(columns, rows, { size: S })
            const needs = [wide('a much longer case', { size: S }), Math.max(wide('units', { size: S, weight: 600 }), wide('12345', { size: S, font: 'mono' })), Math.max(wide('note', { size: S, weight: 600 }), wide('x', { size: S }))]
            const natural = needs.reduce((sum, need) => sum + need + pad * 2, 0)
            expect(board.frame.bounds().width).toBeCloseTo(natural, 6)
            const cells = (of: Board, column: number) => of.rows.map((row) => row.cells[column]!)
            // A text starts 0.7 of the size from the left border, under the start of its header.
            expect(cells(board, 0).map(anchor)).toEqual([-natural / 2 + pad, -natural / 2 + pad].map((x) => expect.closeTo(x, 6)))
            expect(board.header('case').get('x')).toBeCloseTo(-natural / 2 + pad, 6)
            // The numbers end at one x, under the end of their header, and they are in mono so that digits line up.
            const end = -natural / 2 + needs[0]! + pad * 2 + pad + needs[1]!
            expect(cells(board, 1).map(anchor)).toEqual([end, end].map((x) => expect.closeTo(x, 6)))
            expect(right(first(cells(board, 1)[1]!))).toBeCloseTo(right(first(cells(board, 1)[0]!)), 6)
            expect(board.header('units').get('x')).toBeCloseTo(end, 6)
            expect([first(cells(board, 0)[0]!).font, first(cells(board, 1)[0]!).font, (board.header('units') as TextNode).font]).toEqual(['sans', 'mono', 'sans'])
            // `mono: true` sets the texts of a column in mono, and `mono: false` sets its numbers in the font of the texts.
            const fonts = table([{ key: 'case', mono: true }, { key: 'units', mono: false }], rows.map((row) => ({ id: row.id, case: row.case, units: row.units })), { size: S })
            expect([first(fonts.rows[0]!.cells[0]!).font, first(fonts.rows[0]!.cells[1]!).font]).toEqual(['mono', 'sans'])
            // A width of 300 more gives each of the three columns 100 more. A text keeps the left of its column, and a number the right.
            const spread = table(columns, rows, { size: S, width: natural + 300 })
            expect(spread.frame.bounds().width).toBeCloseTo(natural + 300, 6)
            expect(anchor(cells(spread, 0)[0]!)).toBeCloseTo(-(natural + 300) / 2 + pad, 6)
            expect(anchor(cells(spread, 1)[0]!)).toBeCloseTo(-(natural + 300) / 2 + needs[0]! + pad * 2 + 100 + needs[1]! + pad * 2 + 100 - pad, 6)
            // All of the table is as wide as the region that the layout gives it.
            expect(boxOf(fitted(900, (width) => table(columns, rows, { size: S, width }))).width).toBeCloseTo(900, 6)
            expect(() => table(columns, rows, { size: S, width: 200 })).toThrow(new RegExp(`table: the columns need ${Math.ceil(natural)} px, and \`width\` is 200\\. Give a width of ${Math.ceil(natural)} or more, a smaller \`size\`, or shorter texts`))
            // The `width` of a column is the room of its content. A text that comes later must fit it.
            const fixed = table([{ key: 'case', width: 300 }, { key: 'units' }], rows.map((row) => ({ id: row.id, case: row.case, units: row.units })), { size: S })
            expect(anchor(cells(fixed, 1)[0]!) - anchor(cells(fixed, 0)[0]!)).toBeCloseTo(300 + pad * 2 + Math.max(wide('units', { size: S, weight: 600 }), wide('12345', { size: S, font: 'mono' })), 6)
        }))
    })

    it('draws a state as a color and a mark: before a text, after a number, and centered with the text of a centered column', async () => {
        await compileFilm(film(() => {
            const board = table([{ key: 'name', marks: true }, { key: 'value' }, { key: 'verdict', align: 'center' }, { key: 'only', align: 'center' }], [
                { id: 1, name: { value: 'alpha', state: 'pass' }, value: { value: 0.5, state: 'fail' }, verdict: { value: 'held', state: 'warn' }, only: { state: 'pending' } },
                { id: 2, name: 'beta', value: 0.25, verdict: 'kept', only: { state: 'skip' } },
            ], { size: 30 })
            const [one, two] = board.rows.map((row) => row.cells)
            const ink = (cell: TableCellNode) => ({ mark: cell.mark.bounds(), text: cell.words.bounds() })
            // The mark is at the outer side of the text, and near it.
            const [name, value, verdict, only] = one!.map(ink)
            expect(right(one![0]!.mark)).toBeLessThan(name!.text.x)
            expect(name!.text.x - right(one![0]!.mark)).toBeLessThan(30 * 0.6)
            expect(value!.mark.x).toBeGreaterThan(right(one![1]!.words))
            expect(value!.mark.x - right(one![1]!.words)).toBeLessThan(30 * 0.6)
            // In a centered column, the mark and the text are centered together, and a mark alone is in the middle.
            expect(Math.abs((verdict!.mark.x + right(one![2]!.words)) / 2 - one![2]!.get('x'))).toBeLessThan(3)
            expect(right(one![2]!.mark)).toBeLessThan(verdict!.text.x)
            expect(only!.mark.x + only!.mark.width / 2).toBeCloseTo(one![3]!.get('x'), 6)
            // A cell with no state keeps the room of the mark, so the texts of a column start at one x and the numbers end at one x.
            expect(anchor(two![0]!)).toBeCloseTo(anchor(one![0]!), 6)
            expect(anchor(two![1]!)).toBeCloseTo(anchor(one![1]!), 6)
            // A text with no mark is in the middle of a centered column.
            expect(anchor(two![2]!)).toBeCloseTo(two![2]!.get('x'), 6)
            // Each state has its color, on the mark and on the text, and its own shape.
            expect(one!.map((cell) => marksOf(cell, 0)[0])).toEqual([['check', parseColor('green')], ['cross', parseColor('red')], ['bang', parseColor('yellow')], ['ring', parseColor('dim')]])
            expect(marksOf(two![3]!, 0)).toEqual([['dash', parseColor('dim')]])
            expect([first(one![0]!), first(one![1]!), first(two![0]!)].map((made) => made.children[0]!.get('fill'))).toEqual([parseColor('green'), parseColor('red'), parseColor('ink')])
            // Color is never the only sign: no two of the states of the library share a mark.
            const shapes = Object.values(TABLE_STATES).map((state) => state.mark)
            expect(new Set(shapes).size).toBe(shapes.length)
            // A table takes its own states. A state with no mark has a dot.
            const own = table(['lane', { key: 'state', marks: true }], [{ id: 1, lane: 'A', state: { value: 'kept', state: 'kept' } }], { states: { kept: { color: 'teal' }, dropped: { color: 'red', mark: 'dash' } } })
            expect(marksOf(own.rows[0]!.cells[1]!, 0)).toEqual([['dot', parseColor('teal')]])
            expect(() => table(['lane', 'state'], [{ id: 1, lane: 'A', state: { state: 'pass' } }], { states: { kept: { color: 'teal' } } })).toThrow(/table: no state "pass"\. The states are kept/)
        }))
    })

    it('changes a cell in place: the old text and the old mark are gone before the new ones show, and a text that stays takes the new color', async () => {
        let board!: Board
        await compileFilm(film({ fps: 20 }, (s) => {
            board = s.add(table([{ key: 'case', sample: 'renamed' }, { key: 'score', format: (value) => value.toFixed(2) }, { key: 'verdict', marks: true }], [
                { id: 'a', case: 'first', score: 3, verdict: { value: 'ok', state: 'pass' } },
                { id: 'b', case: 'second', score: 1, verdict: { state: 'pending' } },
            ], { size: 30 }))
            s.wait(1)
            s.play(board.setCell('a', 'case', 'renamed'), { duration: 1 })
            expect(board.value('a', 'case')).toBe('renamed')
            // 2 to 3: a mark of another shape, with no text.
            s.play(board.setCell('b', 'verdict', { state: 'fail' }), { duration: 1 })
            expect([board.value('b', 'verdict'), board.stateOf('b', 'verdict')]).toEqual([null, 'fail'])
            // 3 to 4: the state changes and the text stays. A state alone keeps the value.
            s.play(board.setCell('a', 'verdict', { state: 'fail' }), { duration: 1 })
            expect([board.value('a', 'verdict'), board.stateOf('a', 'verdict')]).toEqual(['ok', 'fail'])
            // 4 to 5: a number, written as the column writes it. A value alone keeps the state.
            s.play(board.setCell('a', 'score', 7), board.setCell('a', 'verdict', 'bad'), { duration: 1 })
            expect([board.value('a', 'score'), board.value('a', 'verdict'), board.stateOf('a', 'verdict')]).toEqual([7, 'bad', 'fail'])
            // 5 to 6: the cell gets empty, and the state goes.
            s.play(board.setCell('a', 'verdict', { value: null, state: null }), { duration: 1 })
            expect([board.value('a', 'verdict'), board.stateOf('a', 'verdict')]).toEqual([null, null])
            // A change to the value that the cell has takes no time of the cell, so it plays with another change.
            s.play(board.setCell('a', 'case', 'renamed'), board.setCell('a', 'case', 'again'), { duration: 1 })
            s.wait(1)
        }))
        const name = board.cell('a', 'case'), verdict = board.cell('a', 'verdict'), mark = board.cell('b', 'verdict')
        expect(said(name, 0.5)).toEqual(['first'])
        expect([said(name, 1.25), said(name, 1.5), said(name, 1.75), said(name, 2)]).toEqual([['first'], [], ['renamed'], ['renamed']])
        // No moment of the film shows two texts in one cell, or two marks.
        for (let time = 0; time <= 8; time += 0.05) {
            for (const cell of [name, verdict, mark, board.cell('a', 'score')]) {
                expect(said(cell, time).length, `texts at ${time}`).toBeLessThanOrEqual(1)
                expect(marksOf(cell, time).length, `marks at ${time}`).toBeLessThanOrEqual(1)
            }
        }
        expect([marksOf(mark, 2), marksOf(mark, 2.5), marksOf(mark, 3)]).toEqual([[['ring', parseColor('dim')]], [], [['cross', parseColor('red')]]])
        // The text "ok" is one node from 3 to 4, and it goes from green to red with its mark.
        expect([said(verdict, 3), said(verdict, 3.5), said(verdict, 4)]).toEqual([['ok'], ['ok'], ['ok']])
        const ok = verdict.words.children[0]!.children[0]!
        expect([at(3, () => ok.get('fill')), at(4, () => ok.get('fill'))]).toEqual([parseColor('green'), parseColor('red')])
        expect(at(3.5, () => ok.get('fill'))).toEqual(mixColor(parseColor('green'), parseColor('red'), smooth(0.5)))
        expect([said(board.cell('a', 'score'), 3), said(board.cell('a', 'score'), 5)]).toEqual([['3.00'], ['7.00']])
        expect([said(verdict, 5), marksOf(verdict, 5)]).toEqual([['bad'], [['cross', parseColor('red')]]])
        expect([said(verdict, 6), marksOf(verdict, 6)]).toEqual([[], []])
        expect(said(name, 7)).toEqual(['again'])
    })

    it('writes the total row from the rows at every frame, in the order of time and not of the calls', async () => {
        let board!: Board, late!: Board
        await compileFilm(film({ fps: 20 }, (s) => {
            board = s.add(table(COLS, ROWS, { size: 30, maxRows: 4 }))
            late = s.add(table(COLS, ROWS, { size: 30 }))
            expect([board.totalOf('score'), board.totalOf('verdict')]).toEqual([6, '1 of 3'])
            s.wait(1)
            s.play(board.setCell('b', 'score', 10), { duration: 1 })
            // 2 to 3: two cells change in one play, and the total has one text at each time.
            s.play(board.setCell('c', 'verdict', { state: 'pass' }), board.setCell('b', 'verdict', { state: 'pass' }), { duration: 1 })
            s.play(board.append(D), { duration: 1 })
            s.play(board.remove('a'), { duration: 1 })
            expect([board.totalOf('score'), board.totalOf('verdict')]).toEqual([16, '2 of 3'])
            expect(() => board.totalOf('case')).toThrow(/table: the column "case" has no total\. Give it one where the table is made/)
            // A film may name a late change before an early one. The total at each time is of the rows at that time.
            s.at(6, () => s.play(late.setCell('a', 'score', 100), { duration: 1 }))
            s.at(2, () => s.play(late.setCell('b', 'score', 50), { duration: 1 }))
            s.wait(3)
            // A total that gets too wide for its column is an error where the film plays the change.
            const narrow = s.add(table([{ key: 'n', total: (rows) => 'x'.repeat(rows.length * 6) }], [{ id: 1, n: 1 }], { size: 30, maxRows: 3 }))
            expect(() => s.play(narrow.append({ id: 2, n: 2 }))).toThrow(/table: the text "x{12}" of the total of the column "n" is \d+ px wide, and the column has \d+ px for a text\. Give the column a `sample` where the table is made/)
        }))
        // The total changes when the new text of the cell comes: at the middle of the change.
        expect([1, 1.45, 1.55, 2].map((time) => totals(board, 1, time))).toEqual([['6'], ['6'], ['15'], ['15']])
        expect([2.45, 2.55].map((time) => totals(board, 2, time))).toEqual([['1 of 3'], ['3 of 3']])
        // A row counts when it is half there, and a row that leaves counts until it is gone.
        expect([3.45, 3.55].map((time) => [totals(board, 1, time), totals(board, 2, time)])).toEqual([[['15'], ['3 of 3']], [['19'], ['3 of 4']]])
        expect([4.4, 4.5].map((time) => [totals(board, 1, time), totals(board, 2, time)])).toEqual([[['19'], ['3 of 4']], [['16'], ['2 of 3']]])
        for (let time = 0; time <= 5; time += 0.05) expect([totals(board, 1, time).length, totals(board, 2, time).length], `at ${time}`).toEqual([1, 1])
        expect([1, 3, 7].map((time) => totals(late, 1, time))).toEqual([['6'], ['55'], ['152']])
        // The total row is under the last row at every frame: one row under it, or a little less for a row that still comes to its place.
        for (let time = 0; time <= 5; time += 0.05) {
            const last = at(time, () => Math.max(...made(board).filter((row) => shows(row) > 0.05).map((row) => row.get('y'))))
            expect(at(time, () => board.totals!.get('y')) - last, `at ${time}`).toBeGreaterThanOrEqual(board.pitch * 0.79)
        }
        expect(at(5, () => board.totals!.get('y'))).toBeCloseTo(at(5, () => board.row('d').get('y')) + board.pitch, 6)
    })

    it('moves one marker to a row, a cell or a column, and says what is lit', async () => {
        let board!: Board
        const S = 30, P = S * 1.9, inset = S * 0.2, gap = 3
        await compileFilm(film({ fps: 20 }, (s) => {
            // The table has three rows, and room for five.
            board = s.add(table(COLS, ROWS, { size: S, maxRows: 5 }).at(40, -20))
            expect(board.lit).toBeNull()
            s.wait(1)
            s.play(board.light('b'), { duration: 1 })
            expect(board.lit).toEqual({ row: 'b', column: null })
            s.play(board.light('c', 'score'), { duration: 1 })
            expect(board.lit).toEqual({ row: 'c', column: 'score' })
            s.play(board.light(null, 'verdict'), { duration: 1 })
            expect(board.lit).toEqual({ row: null, column: 'verdict' })
            s.play(board.light(null), { duration: 1 })
            expect(board.lit).toBeNull()
            s.wait(1)
        }))
        const half = at(0, () => board.frame.bounds().width / 2)
        const rowY = (id: string) => at(0, () => board.row(id).get('y'))
        expect(markerAt(board, 0.5).shows).toBe(0)
        // On a row: the marker is as wide as the panel less a little, and as high as the row less a little.
        expect(markerAt(board, 2)).toEqual({ left: expect.closeTo(-half + inset, 6), right: expect.closeTo(half - inset, 6), top: expect.closeTo(rowY('b') - P / 2 + gap, 6), bottom: expect.closeTo(rowY('b') + P / 2 - gap, 6), y: expect.closeTo(rowY('b'), 6), shows: 1, line: 1 })
        // It comes in at its row, and does not travel there.
        expect(markerAt(board, 1.5)).toMatchObject({ y: expect.closeTo(rowY('b'), 6), shows: expect.closeTo(smooth(0.5), 6), line: 1 })
        // On a cell: the room of the cell, less the same.
        const cell = board.cell('c', 'score'), [from, , to] = cell.box
        expect(markerAt(board, 3)).toMatchObject({ left: expect.closeTo(cell.get('x') + from + inset, 6), right: expect.closeTo(cell.get('x') + to - inset, 6), y: expect.closeTo(rowY('c'), 6), shows: 1, line: 1 })
        // On its way it is a faint fill with no line, so no line runs through the texts that it passes.
        expect(markerAt(board, 2.5)).toMatchObject({ shows: 1, line: 0 })
        expect(markerAt(board, 2.5).y).toBeGreaterThan(rowY('b'))
        expect(markerAt(board, 2.5).y).toBeLessThan(rowY('c'))
        expect([markerAt(board, 2.1).line, markerAt(board, 2.9).line]).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.5, 6)])
        // On a column: from the header to the last row that the table has, and not the total row or the room under it.
        const head = board.header('verdict').get('y'), column = board.cell('a', 'verdict')
        expect(markerAt(board, 4)).toMatchObject({ left: expect.closeTo(column.get('x') + column.box[0] + inset, 6), top: expect.closeTo(head - P / 2 + gap, 6), bottom: expect.closeTo(rowY('c') + P / 2 - gap, 6), shows: 1 })
        expect(markerAt(board, 5).shows).toBe(0)
        expect(at(5.5, () => board.marker.get('visible'))).toBe(false)
        // The line of the marker has clear room from the ink of the row: 0.15 of the text size or more, for any ASCII text.
        // In rows that are too low for that, the marker has no line, and its fill is stronger.
        const tall = 'Agjpqy(|$_Q'
        const looks: { leading: number; font: FontFamily; line: number; fill: number; room: number }[] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            // A film is built again when a font arrives, so the list starts empty at each build.
            looks.length = 0
            for (const font of ['sans', 'text-serif'] as const) {
                for (const leading of [1.4, 1.6, 1.9, 2.4]) {
                    const low = s.add(table(['name', 'value'], [{ id: 1, name: tall, value: 12345 }, { id: 2, name: tall, value: 67890 }], { size: S, leading, font }))
                    s.play(low.light(2), { duration: 0 })
                    const box = low.marker.bounds(), ink = low.row(2).cells.map((made) => made.words.bounds()), half = low.marker.get('strokeWidth') / 2
                    const room = Math.min(...ink.map((made) => Math.min(made.y - (box.y + half), box.y + box.height - half - (made.y + made.height))))
                    looks.push({ leading, font, line: low.marker.get('strokeOpacity'), fill: low.marker.get('fillOpacity'), room })
                }
            }
            s.wait(0.5)
        }))
        expect(looks.map((look) => [look.font, look.leading, look.line, look.fill])).toEqual([
            ['sans', 1.4, 0, 0.26], ['sans', 1.6, 0, 0.26], ['sans', 1.9, 1, 0.16], ['sans', 2.4, 1, 0.16],
            ['text-serif', 1.4, 0, 0.26], ['text-serif', 1.6, 0, 0.26], ['text-serif', 1.9, 1, 0.16], ['text-serif', 2.4, 1, 0.16],
        ])
        for (const look of looks.filter((made) => made.line === 1)) expect(look.room, `${look.font} at ${look.leading}`).toBeGreaterThanOrEqual(S * 0.15)
    })

    it('keeps the marker with its row: through a sort, in with a row that arrives, and out with a row that leaves', async () => {
        let board!: Board
        await compileFilm(film({ fps: 20 }, (s) => {
            board = s.add(table(COLS, ROWS, { size: 30, maxRows: 4 }))
            s.play(board.light('c'), { duration: 0 })
            s.wait(1)
            // 1 to 2: the row with the light goes up one place, and the first row passes it on its way to the bottom.
            s.play(board.sort('score'), { duration: 1 })
            // 2 to 3: the light goes to a row of the same play.
            s.play(board.append(D), board.light('d'), { duration: 1 })
            // 3 to 4: the row with the light leaves.
            s.play(board.remove('d'), { duration: 1 })
            expect(board.lit).toBeNull()
            s.wait(1)
        }))
        const c = board.row('c'), d = made(board).find((row) => row.rowId === 'd')!
        for (let time = 1; time <= 2; time += 0.05) {
            expect(markerAt(board, time).y, `at ${time}`).toBeCloseTo(at(time, () => c.get('y')), 6)
            // The row with the light is the top card of the sort, also when another row goes a longer way. So the
            // marker is never on a row that another one hides: the row shows whole at every frame.
            expect(markerAt(board, time), `at ${time}`).toMatchObject({ shows: 1, line: 1 })
            expect(at(time, () => shows(c.content)), `at ${time}`).toBe(1)
        }
        expect(at(2, () => c.get('y'))).toBeCloseTo(at(0, () => c.get('y')) - board.pitch, 6)
        expect(at(1.5, () => c.get('z'))).toBeGreaterThan(at(1.5, () => Math.max(board.row('a').get('z'), board.row('b').get('z'))))
        // The marker is at the new row when the move of the light ends, and it shows as much as the row does.
        expect(markerAt(board, 3)).toMatchObject({ y: expect.closeTo(at(3, () => d.get('y')), 6), shows: 1, line: 1 })
        for (const time of [3.1, 3.2, 3.3, 3.4]) {
            expect(markerAt(board, time).shows, `at ${time}`).toBeCloseTo(at(time, () => d.get('opacity')), 6)
            expect(markerAt(board, time).shows, `at ${time}`).toBeLessThan(1)
        }
        expect([markerAt(board, 3.5).shows, markerAt(board, 4).shows, markerAt(board, 5).shows]).toEqual([0, 0, 0])
    })

    it('brings rows under the last row, one after another, and makes room in the panel first', async () => {
        let board!: Board, group!: Board
        const S = 30, P = S * 1.9
        await compileFilm(film({ fps: 20 }, (s) => {
            board = s.add(table(COLS, ROWS.slice(0, 1), { size: S, maxRows: 4 }))
            group = s.add(table(COLS, ROWS.slice(0, 1), { size: S, maxRows: 4 }))
            s.wait(1)
            s.play(board.append(ROWS.slice(1)), group.append(ROWS.slice(1), { lag: 0 }), { duration: 2 })
            expect([board.ids, board.count]).toEqual([['a', 'b', 'c'], 3])
            // A value of a row of the same play can change in it, when the film names the `append` first.
            s.play(board.append(D), board.setCell('d', 'score', 9), { duration: 1 })
            expect(board.value('d', 'score')).toBe(9)
            expect(() => s.play(group.setCell('d', 'score', 9), group.append(D))).toThrow(/table: no row has the id "d"\. The table has the rows "a", "b", "c"\. When an `append` in the same play brings the row, name the `append` before this call/)
            // The panel has room for four rows.
            expect(() => s.play(board.append({ id: 'e', case: 'fifth' }))).toThrow(/table: append\(\["e"\]\) makes 5 rows, and the panel has room for 4\. Raise `maxRows` to 5 or more where the table is made, or remove a row first/)
            expect(() => s.play(board.append({ id: 'a', case: 'again' }))).toThrow(/table: the table already has a row with the id "a"\. Give each row its own id/)
            expect(() => board.append([{ id: 'x', case: 'one' }, { id: 'x', case: 'two' }])).toThrow(/table: two rows have the id "x"/)
            s.wait(1)
        }))
        // One row for each second: "b" from 1 to 2, and "c" from 2 to 3. With `lag: 0`, both take the whole time.
        expect([1, 2, 3].map((time) => seen(board, time))).toEqual([['a'], ['a', 'b'], ['a', 'b', 'c']])
        expect([1, 2.4, 3].map((time) => seen(group, time))).toEqual([['a'], ['a'], ['a', 'b', 'c']])
        const [together, other] = at(2.4, () => [shows(group.row('b')), shows(group.row('c'))])
        expect(together).toBeGreaterThan(0.1)
        expect(other).toBeCloseTo(together!, 6)
        // Each row is at its place, one row under the row before it.
        expect(at(4, () => board.rows.map((row) => row.get('y') - board.rows[0]!.get('y')))).toEqual([0, 1, 2, 3].map((slot) => expect.closeTo(slot * P, 6)))
        // The panel is as high as the header, the rows and the total row. It grows before the row comes, so a row that shows is inside it.
        expect([1, 2, 3, 4].map((time) => at(time, () => board.frame.bounds().height))).toEqual([3, 4, 5, 6].map((rows) => expect.closeTo(rows * P + 12, 6)))
        for (let time = 1; time <= 4; time += 0.05) {
            const [bottom, lowest] = at(time, () => [board.frame.bounds().y + board.frame.bounds().height, Math.max(...made(board).filter((row) => shows(row) > 0.01).map((row) => row.cells[0]!.words.bounds().y + row.cells[0]!.words.bounds().height))])
            expect(lowest!, `at ${time}`).toBeLessThan(bottom! - S * 0.2)
        }
        // The line over a row comes with the row.
        expect([1, 2, 3].map((time) => at(time, () => board.lines.map((line) => line.get('opacity'))))).toEqual([[0, 0, 0], [1, 0, 0], [1, 1, 0]])
    })

    it('takes rows away: they fade, the rows under them move up, and the panel gets lower', async () => {
        let board!: Board
        const S = 30, P = S * 1.9
        let old!: TableRowNode
        const nodes: Record<string, TableRowNode> = {}
        await compileFilm(film({ fps: 20 }, (s) => {
            board = s.add(table(COLS, [...ROWS, D], { size: S }))
            for (const id of board.ids) nodes[String(id)] = board.row(id)
            old = board.row('b')
            s.wait(1)
            s.play(board.remove('b'), { duration: 1 })
            expect([board.ids, board.count]).toEqual([['a', 'c', 'd'], 3])
            expect(() => board.row('b')).toThrow(/table: no row has the id "b"\. The table has the rows "a", "c", "d"/)
            // 2 to 3: a function picks the rows when the film plays the change, so it sees the rows that are left.
            s.play(board.remove((row) => (row.values['score'] as number) > 2), { duration: 1 })
            expect(board.ids).toEqual(['c'])
            expect(board.find((row) => row.index === 0)).toEqual(['c'])
            // 3 to 4: the id of a row that left is free again, and the new row has a node of its own.
            s.play(board.append({ id: 'b', case: 'again', score: 5 }), { duration: 1 })
            expect(board.row('b')).not.toBe(old)
            // A function that picks no row changes nothing, and takes no time of the table.
            s.play(board.remove(() => false), board.remove('c'), { duration: 1 })
            expect(board.ids).toEqual(['b'])
            s.wait(1)
            // In one sequence, a row leaves and a row with its id arrives: the id is free when the second change plays.
            s.play(seq(board.remove('b'), board.append({ id: 'b', case: 'a third' })), { duration: 1 })
            expect(board.ids).toEqual(['b'])
        }))
        expect([1, 2, 3, 4, 5].map((time) => seen(board, time))).toEqual([['a', 'b', 'c', 'd'], ['a', 'c', 'd'], ['c'], ['c', 'b'], ['b']])
        // The row that leaves is gone before a row comes to its place: at 45% of the time. It stays hidden.
        expect([1.2, 1.45, 3, 6].map((time) => at(time, () => shows(old) > 0))).toEqual([true, false, false, false])
        const top = at(0, () => nodes['a']!.get('y'))
        expect(at(2, () => ['a', 'c', 'd'].map((id) => nodes[id]!.get('y')))).toEqual([0, 1, 2].map((slot) => expect.closeTo(top + slot * P, 6)))
        // The rows under it wait until it is nearly gone.
        expect(at(1.3, () => nodes['c']!.get('y'))).toBeCloseTo(top + 2 * P, 6)
        expect([1, 2, 3, 4, 5].map((time) => at(time, () => board.frame.bounds().height))).toEqual([6, 5, 3, 4, 3].map((rows) => expect.closeTo(rows * P + 12, 6)))
        // The lines between the rows have fixed places. They are away while rows move, and back when the rows are at rest.
        expect([1, 1.7, 2].map((time) => at(time, () => board.lines.map((line) => line.get('opacity'))))).toEqual([[1, 1, 1], [0, 0, 0], [1, 1, 0]])
    })

    it('sorts and moves rows: each row keeps its node and goes to its new place', async () => {
        let board!: Board
        const nodes = new Map<number, TableRowNode>()
        const orders: unknown[] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            // A film is built again when a font arrives, so the list starts empty at each build.
            orders.length = 0
            board = s.add(table(['id', 'score', 'name'], [{ id: 1, score: 5, name: 'e' }, { id: 2, score: null, name: 'b' }, { id: 3, score: 2, name: 'd' }, { id: 4, score: 5, name: 'a' }, { id: 5, score: 9, name: 'c' }], { size: 30 }))
            for (const id of [1, 2, 3, 4, 5]) nodes.set(id, board.row(id))
            s.wait(1)
            for (const change of [board.sort('score'), board.sort('score', { descending: true }), board.sort('name'), board.sort((a, b) => Number(b.id) - Number(a.id)), board.moveRow(5, 4), board.moveRow(1, 0)]) {
                s.play(change, { duration: 1 })
                orders.push(board.ids)
            }
            // A sort that changes no place takes no time of the table, so it plays with another change.
            s.play(board.sort((a, b) => a.index - b.index), board.moveRow(1, 1), { duration: 1 })
            orders.push(board.ids)
            expect(() => board.sort('none')).toThrow(/table: no column "none"\. The columns are "id", "score", "name"/)
            expect(() => board.moveRow(1, 1.5)).toThrow(/table: moveRow\(1, 1\.5\): the place of a row is a whole number, 0 for the first row/)
            expect(() => s.play(board.moveRow(1, 5))).toThrow(/table: moveRow\(1, 5\): the table has 5 rows, so the last place is 4/)
            expect(() => s.play(board.sort(() => Number.NaN))).toThrow(/table: the function of sort\(\) returned NaN for the rows/)
            s.wait(1)
        }))
        // Numbers by size, equal rows in the order that they had, and an empty cell last in both directions. Texts by their letters.
        expect(orders).toEqual([[3, 1, 4, 5, 2], [5, 1, 4, 3, 2], [4, 2, 5, 3, 1], [5, 4, 3, 2, 1], [4, 3, 2, 1, 5], [1, 4, 3, 2, 5], [4, 1, 3, 2, 5]])
        // A row is one node through every change, and it is at the place of its rank after each one.
        expect([1, 2, 3, 4, 5].map((id) => board.row(id))).toEqual([1, 2, 3, 4, 5].map((id) => nodes.get(id)))
        const top = at(0, () => nodes.get(1)!.get('y'))
        orders.forEach((order, index) => {
            expect(seen(board, 2 + index), `after change ${index}`).toEqual(order)
            expect(at(2 + index, () => (order as number[]).map((id) => nodes.get(id)!.get('y'))), `after change ${index}`).toEqual([0, 1, 2, 3, 4].map((slot) => expect.closeTo(top + slot * board.pitch, 6)))
        })
        // The row shows its id in the column `id`, as a number: at the right, in mono.
        expect(first(nodes.get(1)!.cells[0]!).source).toBe('1')
    })

    it('shows a row that a sort moves as a card over the others, and hides a row while a card is at its text', async () => {
        let board!: Board
        const S = 30
        await compileFilm(film({ fps: 20 }, (s) => {
            board = s.add(table(['case', 'score'], [{ id: 'a', case: 'first', score: 3 }, { id: 'b', case: 'second', score: 2 }, { id: 'c', case: 'third', score: 1 }], { size: S }))
            s.wait(1)
            // The first row and the last row trade places, and both pass the row between them.
            s.play(board.sort('score'), { duration: 1 })
            s.wait(1)
        }))
        const rows = ['a', 'b', 'c'].map((id) => board.row(id))
        const card = (row: TableRowNode, time: number) => at(time, () => shows(row.backing!))
        // At rest a row has no card. A row that moves has one for the time of the move.
        expect(rows.map((row) => [card(row, 1), card(row, 1.2), card(row, 2)])).toEqual([[0, 1, 0], [0, 0, 0], [0, 1, 0]])
        // At the middle, the three rows are at one place, and one of them shows.
        expect(rows.map((row) => at(1.5, () => shows(row.content)))).toEqual([0, 0, 1])
        // At every frame, a row whose text a card of another row has reached does not show at all.
        const reach = board.pitch / 2 + S * 0.62
        for (let time = 1; time <= 2; time += 0.025) {
            at(time, () => {
                for (const lower of rows) {
                    for (const upper of rows) {
                        const over = upper.get('z') > lower.get('z') || (upper.get('z') === lower.get('z') && rows.indexOf(upper) > rows.indexOf(lower))
                        if (upper === lower || !over || shows(upper.backing!) < 0.5 || Math.abs(upper.get('y') - lower.get('y')) >= reach) continue
                        expect(shows(lower.content), `row ${lower.rowId} under ${upper.rowId} at ${time}`).toBeLessThan(0.02)
                    }
                }
            })
        }
        expect(seen(board, 2)).toEqual(['c', 'b', 'a'])
    })

    it('changes its rows one change at a time, and a cell one change at a time, and says how to play two', async () => {
        /** A film of its own for each case, so that the times in a message are known. */
        const scene = (build: (s: Stage, board: Board) => void) => compileFilm(film({ fps: 20 }, (s) => build(s, s.add(table(COLS, ROWS, { size: 30, maxRows: 5 })))))
        await scene((s, board) => {
            expect(() => s.play(board.remove('a'), board.sort('score', { descending: true }))).toThrow(/table: sort\("score"\) plays from 0 s to 1 s, and remove\(\["a"\]\) plays from 0 s to 0\.7 s\. The table changes its rows one change at a time: a change starts when the change before it is over\. Play the two in a `seq`: each then has its share of the time of the play/)
        })
        await scene((s, board) => {
            expect(() => s.play(board.append(D), board.append({ id: 'e', case: 'fifth' }))).toThrow(/Give one `append` all the rows\. With `lag: 0`, they arrive together/)
        })
        await scene((s, board) => {
            s.wait(1)
            s.play(board.sort('score'), { duration: 2 })
            expect(() => s.at(2, () => s.play(board.remove('a')))).toThrow(/table: remove\(\["a"\]\) plays from 2 s to 2\.7 s, and sort\("score"\) plays from 1 s to 3 s\..* sort\("score"\) takes 2 s, and remove\(\["a"\]\) starts 1 s after it\. Give sort\("score"\) a `duration` of 1 or less, or play the two in a `seq`/)
        })
        await scene((s, board) => {
            s.wait(1)
            s.play(board.sort('score'), { duration: 2 })
            // The end of one change is the start of the next.
            s.play(board.remove('a'), { duration: 1 })
            s.play(board.append({ id: 'a', case: 'again' }), { duration: 1 })
            expect(board.ids).toEqual(['b', 'c', 'a'])
            expect(() => s.at(0.5, () => s.play(board.moveRow('a', 0)))).toThrow(/The table takes the changes of its rows in the order of time, and the film calls append\(\["a"\]\) first\. Call moveRow\("a", 0\) before it/)
        })
        await scene((s, board) => {
            // A cell takes one change at a time.
            expect(() => s.play(board.setCell('b', 'score', 5), board.setCell('b', 'score', 6))).toThrow(/table: setCell\("b", "score"\) plays from 0 s to 0\.5 s, and setCell\("b", "score"\) plays from 0 s to 0\.5 s\. A cell takes one change at a time: a change starts when the change before it is over\. Play the two in a `seq`, or give the first one a shorter `duration`/)
        })
        await scene((s, board) => {
            // Two cells change together, and so do a cell, the rows and the light.
            s.play(board.setCell('b', 'score', 5), board.setCell('c', 'score', 6), board.setCell('b', 'verdict', { state: 'pass' }), board.sort('score'), board.light('b'), { duration: 1 })
            expect([board.value('b', 'score'), board.value('c', 'score'), board.ids]).toEqual([5, 6, ['a', 'b', 'c']])
            // Two moves of the light whose times overlap give one marker: the last one that starts takes it from where it is.
            s.play(board.light('a'), board.light('c'), { duration: 1 })
            expect(board.lit).toEqual({ row: 'c', column: null })
            expect(() => board.setCell('b', 'score', 5, { duration: -1 })).toThrow(/table: the duration of setCell\("b", "score"\) is -1\. Give a number, 0 or more/)
            expect(() => board.append(D, { lag: Number.NaN })).toThrow(/table: the lag of append\(\["d"\]\) is NaN\. Give a number, 0 or more/)
        })
    })

    it('names what is wrong with a column, a row, a cell or an option, and what to change', async () => {
        await compileFilm(film(() => {
            expect(() => table([])).toThrow(/table: give it at least one column, such as table\(\['case', 'score'\], rows\)/)
            expect(() => table(['a', 'a'])).toThrow(/table: two columns have the key "a"\. Give each column its own key/)
            expect(() => table([{ key: ' ' }])).toThrow(/table: column 0 has no key/)
            expect(() => table([{ key: 'a', align: 'middle' as 'center' }])).toThrow(/table: the align of the column "a" is "middle"\. It is 'left', 'right' or 'center'/)
            expect(() => table([{ key: 'a', total: 'mean' as 'sum' }])).toThrow(/table: the total of the column "a" is "mean"\. It is 'sum', or a function of the rows/)
            expect(() => table([{ key: 'long header', width: 20 }], [], { maxRows: 1, size: 20 })).toThrow(/table: the width of the column "long header" is 20, and its header "long header" is \d+ px wide\. Give a width of \d+ or more, or a shorter label/)
            expect(() => table(['a'], [{ id: 1, a: 'x' }, { id: '1', a: 'y' }])).toThrow(/table: two rows have the id "1"\. Give each row its own id/)
            expect(() => table(['a'], [{ id: Number.NaN, a: 'x' }])).toThrow(/table: row 0 has the id null\. Give each row an `id`, a number or a text: the table knows a row by it/)
            expect(() => table(['a'], [{ a: 'x' } as unknown as TableRow])).toThrow(/table: row 0 has the id undefined/)
            // A field that names no column would not show, and nobody would know.
            expect(() => table(['case', 'score'], [{ id: 1, case: 'x', scroe: 3 }])).toThrow(/table: row 1 has the field "scroe", and the table has no such column\. The columns are "case", "score"/)
            expect(() => table(['a'], [{ id: 1, a: 'two\nlines' }])).toThrow(/table: the text of row 1 in the column "a" has a line break or a tab\. A cell holds one line of text/)
            expect(() => table(['a'], [{ id: 1, a: true as unknown as string }])).toThrow(/table: the value of row 1 in the column "a" is true\. Give a text, a number, or null for an empty cell/)
            expect(() => table(['a'], [{ id: 1, a: Number.POSITIVE_INFINITY }])).toThrow(/table: the value of row 1 in the column "a" is Infinity\. A number of a cell is finite/)
            expect(() => table(['a'], [{ id: 1, a: { value: 'x', color: 'red' } as unknown as string }])).toThrow(/table: the cell of row 1 in the column "a" has the part "color"\. A cell is a value, or \{ value, state \}/)
            expect(() => table(['a'], [{ id: 1, a: { state: 'done' } }])).toThrow(/table: no state "done"\. The states are pass, fail, warn, pending, skip/)
            expect(() => table(['a'], [], { size: 0 })).toThrow(/table: size is a text size, more than 0/)
            expect(() => table(['a'], [], { maxRows: 1, leading: 1 })).toThrow(/table: leading is 1\. It is the height of a row as a part of the text size, 1\.4 or more/)
            expect(() => table(['a'], [])).toThrow(/table: maxRows is 0\. It is the most rows that the table holds, a whole number, 1 or more\. A table that starts with no row needs it/)
            expect(() => table(['a'], [{ id: 1, a: 'x' }, { id: 2, a: 'y' }], { maxRows: 1 })).toThrow(/table: the table starts with 2 rows, and maxRows is 1\. Raise `maxRows` to 2 or more/)
            expect(() => table(['a'], [], { maxRows: 1, states: {} })).toThrow(/table: give it at least one state/)
            expect(() => table(['a'], [], { maxRows: 1, states: { done: { color: 'green', mark: 'star' as 'dot' } } })).toThrow(/table: the mark of the state "done" is "star"\. A mark is 'check', 'cross', 'ring', 'dot', 'dash', 'bang'/)
            expect(() => table(['a'], [], { maxRows: 1, lightColor: 'no-such-color' })).toThrow(/table: lightColor is "no-such-color", which is not a color/)
            expect(() => table([{ key: 'a', total: () => ({ state: 'done' }) }], [{ id: 1, a: 'x' }])).toThrow(/table: no state "done"/)

            const board = table([{ key: 'case' }, { key: 'score' }, { key: 'verdict', marks: true }], [{ id: 'a', case: 'first', score: 3, verdict: 'ok' }], { size: 20, maxRows: 2 })
            expect(() => board.setCell('a', 'none', 1)).toThrow(/table: no column "none"\. The columns are "case", "score", "verdict"/)
            expect(() => board.setCell('a', 'verdict', { state: 'done' })).toThrow(/table: no state "done"\. The states are pass, fail, warn, pending, skip/)
            // A text shows whole in the room of its column, or the change is refused, and the message names the sample that works.
            expect(() => board.setCell('a', 'case', 'a text that is much too long for this column')).toThrow(/table: the text "a text that is much too long for this column" of row "a" in the column "case" is \d+ px wide, and the column has \d+ px for a text\. Give the column a `sample` where the table is made, the longest value that it gets, such as sample: "a text that is much too long for this column", or use a shorter text/)
            expect(() => board.append({ id: 'b', case: 'a text that is much too long for this column' })).toThrow(/table: the text "a text that is much too long for this column" of row "b" in the column "case" is \d+ px wide/)
            expect(() => board.setCell('a', 'score', 123456789)).toThrow(/Give the column a `sample` where the table is made, the longest value that it gets, such as sample: 123456789, or use a shorter text/)
            // With the sample, the column has the room from the start, at any text size.
            for (const size of [20, 44]) {
                const roomy = table([{ key: 'case', sample: 'a text that is much too long for this column' }, { key: 'score', sample: 123456789 }], [{ id: 'a', case: 'first', score: 3 }], { size })
                expect(() => [roomy.setCell('a', 'case', 'a text that is much too long for this column'), roomy.setCell('a', 'score', 123456789)]).not.toThrow()
            }
            // A column with a width in pixels names the width that works.
            const fixed = table([{ key: 'case', width: 100 }], [{ id: 'a', case: 'first' }], { size: 20 })
            expect(() => fixed.setCell('a', 'case', 'a text that is much too long for this column')).toThrow(/and the column has 100 px for a text\. Set the `width` of the column to (\d+) or more where the table is made, or use a shorter text/)
            // A text that is a few pixels wider than the column goes a little into the room between two columns: 0.35 of the text size, 7 px here.
            const base = wide('a text of the film', { size: 20 })
            expect(() => table([{ key: 'case', width: base - 6 }], [{ id: 'a', case: 'first' }], { size: 20 }).setCell('a', 'case', 'a text of the film')).not.toThrow()
            expect(() => table([{ key: 'case', width: base - 9 }], [{ id: 'a', case: 'first' }], { size: 20 }).setCell('a', 'case', 'a text of the film')).toThrow(/Set the `width` of the column/)
            // A count keeps room for its other digits: "1 of 3" is narrower than "2 of 8".
            const counts = table([{ key: 'count', label: 'n' }], [{ id: 'a', count: '1 of 1' }], { size: 20 })
            expect(wide('2 of 8', { size: 20 }) - wide('1 of 1', { size: 20 })).toBeGreaterThan(8)
            expect(() => counts.setCell('a', 'count', '2 of 8')).not.toThrow()
            expect(() => table([{ key: 'a', sample: { value: 'x', state: 'pass' } as unknown as string }], [], { maxRows: 1 })).toThrow(/table: the sample of the column "a" has a state\. A sample is a value/)
            // An empty text is an empty cell.
            expect(table(['a'], [{ id: 1, a: '' }]).value(1, 'a')).toBeNull()
            // A state needs a column that keeps room for a mark.
            expect(() => board.setCell('a', 'case', { state: 'pass' })).toThrow(/table: row "a" in the column "case" gets the state "pass", and the column has no room for the mark of a state\. Give the column `marks: true` where the table is made, or give one of its first cells a state/)
            expect(() => board.append({ id: 'b', case: { value: 'x', state: 'pass' } })).toThrow(/table: row "b" in the column "case" gets the state "pass", and the column has no room for the mark of a state/)
            expect(() => board.light('a', 'none')).toThrow(/table: no column "none"/)
            expect(() => board.p('a', null, 'middle' as 'center')).toThrow(/table: the side of p\(\) is "middle"\. It is 'left', 'right', 'top', 'bottom' or 'center'/)
            expect(() => board.value('z', 'case')).toThrow(/table: no row has the id "z"\. The table has the rows "a"/)
            // The column `id` shows the id of a row, which does not change.
            const ids = table(['id', 'case'], [{ id: 7, case: 'x' }])
            expect(() => ids.setCell(7, 'id', 8)).toThrow(/table: the column "id" shows the id of a row, and an id does not change/)
        }))
    })

    it('gives the places of a row, a column and a cell, and a cell holds a node of the film that moves with its row', async () => {
        let board!: Board
        const extra = rect(40, 10, { fill: 'teal', stroke: null })
        const S = 30, P = S * 1.9
        await compileFilm(film({ fps: 20 }, (s) => {
            board = s.add(table(COLS, ROWS, { size: S, maxRows: 4 }).at(200, 100))
            const half = board.frame.bounds().width / 2, high = (6 * P + 12) / 2
            const y = board.row('b').get('y'), cell = board.cell('b', 'score')
            const [from, top, to, bottom] = cell.box
            expect([top, bottom]).toEqual([-P / 2, P / 2])
            // In the coordinates of the table: a row goes from border to border, and a column from the top of the room to its bottom.
            expect(board.p('b')).toEqual([expect.closeTo(-half, 6), expect.closeTo(y, 6)])
            expect(board.p('b', null, 'right')).toEqual([expect.closeTo(half, 6), expect.closeTo(y, 6)])
            expect(board.p('b', 'score', 'center')).toEqual([expect.closeTo(cell.get('x'), 6), expect.closeTo(y, 6)])
            expect(board.p('b', 'score', 'top')).toEqual([expect.closeTo(cell.get('x'), 6), expect.closeTo(y - P / 2, 6)])
            expect(board.p(null, 'score', 'bottom')).toEqual([expect.closeTo(cell.get('x'), 6), expect.closeTo(high, 6)])
            // In stage pixels, for the layout: the room of the table, of a row, of a column and of a cell.
            const room = board.region(), one = board.region('b', 'score')
            expect([room.cx, room.cy, room.width, room.height]).toEqual([200, 100, half * 2, high * 2].map((value) => expect.closeTo(value, 6)))
            expect([one.left, one.right, one.cy, one.height]).toEqual([200 + cell.get('x') + from, 200 + cell.get('x') + to, 100 + y, P].map((value) => expect.closeTo(value, 6)))
            expect([board.region('b').left, board.region('b').right, board.region(null, 'score').top]).toEqual([200 - half, 200 + half, 100 - high].map((value) => expect.closeTo(value, 6)))
            // The row of an id and its cells are nodes: a connector can end on one, and a film can add a node of its own to a cell.
            expect([board.row('b').rowId, board.row('b').cells[1]]).toEqual(['b', cell])
            expect(board.header('score').get('y')).toBeLessThan(board.row('a').get('y'))
            cell.add(extra)
            s.wait(1)
            // The row "b" has the lowest score, so it goes from the middle to the top.
            s.play(board.sort('score'), { duration: 1 })
            // A place is of the row after the changes so far: the top row now.
            expect(board.p('b')[1]).toBeCloseTo(y - P, 6)
            expect(board.region('b').cy).toBeCloseTo(100 + y - P, 6)
            s.wait(1)
        }))
        const middle = (time: number) => at(time, () => extra.bounds().y + extra.bounds().height / 2)
        expect(middle(2) - middle(1)).toBeCloseTo(-P, 6)
        expect(middle(1.5)).toBeCloseTo(at(1.5, () => 100 + board.row('b').get('y')), 6)
        // The rows are in one holder. A light of the library that stays inside it dims the other rows, and not the panel, the header or the total row.
        let records!: Board
        await compileFilm(film({ fps: 20 }, (s) => {
            records = s.add(table(COLS, ROWS, { size: S }))
            s.wait(0.5)
            s.play(spotlight(records.find((row) => row.states['verdict'] !== 'fail').map((id) => records.row(id)), { within: records.body }), { duration: 0.5 })
            s.wait(0.5)
        }))
        expect(records.rows.every((row) => row.parent === records.body)).toBe(true)
        const dims = at(1.2, () => [records.row('a'), records.row('b'), records.row('c'), records.frame, records.headers[0]!, records.totals!, records.body].map((node) => node.get('dim')))
        expect(dims.map((dim) => dim === 1)).toEqual([true, false, true, true, true, true, true])
        expect(dims[1]).toBeLessThan(0.5)
    })

    it('enters with the panel and the header first and then the rows from the top, and keeps a row that arrives in the same play', async () => {
        let board!: Board
        await compileFilm(film({ fps: 20 }, (s) => {
            // The table is not on the stage: `enter()` brings it.
            board = table(COLS, ROWS, { size: 30, maxRows: 4 })
            s.wait(1)
            s.play(board.enter(), board.append(D), { duration: 2 })
            s.wait(1)
        }))
        expect(at(0.5, () => shows(board))).toBe(0)
        const parts = (time: number) => at(time, () => [shows(board.frame), shows(board.headers[0]!), ...['a', 'b', 'c'].map((id) => shows(board.row(id).content)), shows(board.totals!.content)])
        expect(parts(1)).toEqual([0, 0, 0, 0, 0, 0])
        // The panel and the header are there after four tenths of the time.
        expect(parts(1.8).slice(0, 2)).toEqual([1, 1])
        // Each row starts after the row over it, and the total row is the last.
        const order = parts(2.2).slice(2)
        expect(order[0]).toBeGreaterThan(order[1]!)
        expect(order[1]).toBeGreaterThan(order[2]!)
        expect(order[2]).toBeGreaterThan(order[3]!)
        expect(parts(3)).toEqual([1, 1, 1, 1, 1, 1].map((value) => expect.closeTo(value, 6)))
        // The row of the `append` in the same play is not lost.
        expect(seen(board, 3)).toEqual(['a', 'b', 'c', 'd'])
    })

    it('gives a copy with its own rows and its own bookkeeping, in the state that the table has', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            const board = s.add(table(COLS, ROWS, { size: 30, maxRows: 4, lightColor: 'blue' }).at(50, 60))
            s.play(board.setCell('a', 'score', 8), board.remove('b'), board.light('c', 'score'), { duration: 1 })
            const copy = board.clone()
            expect(copy).toBeInstanceOf(Table)
            expect([copy.ids, copy.value('a', 'score'), copy.stateOf('c', 'verdict'), copy.totalOf('score'), copy.lit]).toEqual([['a', 'c'], 8, 'pending', 10, { row: 'c', column: 'score' }])
            expect([copy.get('x'), copy.get('y'), copy.mounted]).toEqual([50, 60, false])
            expect(boxOf(copy).width).toBeCloseTo(boxOf(board).width, 6)
            expect(copy.row('a')).not.toBe(board.row('a'))
            // A change of the copy does not change the table.
            s.add(copy)
            s.play(copy.setCell('a', 'score', 1), copy.append(D), { duration: 1 })
            expect([copy.value('a', 'score'), copy.ids]).toEqual([1, ['a', 'c', 'd']])
            expect([board.value('a', 'score'), board.ids, board.totalOf('score')]).toEqual([8, ['a', 'c'], 10])
        }))
    })

    it.each([true, false])('clones the current cell values before future updates, with totals: %s', async (withTotal) => {
        let copy!: Board
        const movie = await compile((s) => {
            const board = s.add(table([{ key: 'n', total: withTotal ? 'sum' : undefined, marks: true, sample: 3 }], [{ id: 1, n: { value: 1, state: 'pending' } }]))
            s.at(10, () => s.play(board.setCell(1, 'n', { value: 2, state: 'pass' }), { duration: 1 }))
            copy = s.add(board.clone())
            expect(copy.value(1, 'n')).toBe(1)
            expect(copy.stateOf(1, 'n')).toBe('pending')
            if (withTotal) expect(copy.totalOf('n')).toBe(1)
            s.play(copy.setCell(1, 'n', { value: 3, state: 'fail' }), { duration: 1 })
            expect(board.value(1, 'n')).toBe(2)
        })
        expect(said(copy.cell(1, 'n'), 0)).toEqual(['1'])
        expect(said(copy.cell(1, 'n'), 1)).toEqual(['3'])
        expect(marksOf(copy.cell(1, 'n'), 1).map(([shape]) => shape)).toEqual(['cross'])
        if (withTotal) {
            const total = (time: number) => at(time, () => copy.totals!.cells[0]!.all().filter((node) => node instanceof TextNode && shows(node) > 0.01).map(words))
            expect(total(0)).toEqual(['1'])
            expect(total(1)).toEqual(['3'])
        }
        expectPure(movie, [0, 0.25, 0.75, 1, 10.5, 11])
    })

    it.each([true, false])('clones row membership, order, and light before future changes, with totals: %s', async (withTotal) => {
        await compile((s) => {
            const board = s.add(table([{ key: 'n', total: withTotal ? 'sum' : undefined, sample: 10 }], [{ id: 'a', n: 1 }, { id: 'b', n: 2 }], { maxRows: 3 }))
            s.play(board.light('a'), { duration: 0 })
            s.at(10, () => {
                s.play(board.append({ id: 'c', n: 3 }), { duration: 1 })
                s.play(board.sort('n', { descending: true }), { duration: 1 })
                s.play(board.remove('a'), board.light('c'), { duration: 1 })
            })
            const copy = s.add(board.clone())
            expect(copy.ids).toEqual(['a', 'b'])
            expect(copy.lit).toEqual({ row: 'a', column: null })
            if (withTotal) expect(copy.totalOf('n')).toBe(3)
            s.play(copy.append({ id: 'c', n: 4 }), copy.setCell('a', 'n', 5), { duration: 1 })
            expect(copy.ids).toEqual(['a', 'b', 'c'])
            expect(copy.value('a', 'n')).toBe(5)
            if (withTotal) expect(copy.totalOf('n')).toBe(11)
            expect(board.ids).toEqual(['c', 'b'])
        })
    })

    it('takes the font of the film for its header and its texts, keeps numbers in mono, and takes a font of its own', async () => {
        const fonts = (board: Board) => [board.headers[0]!, first(board.rows[0]!.cells[0]!), first(board.rows[0]!.cells[1]!), ...board.totals!.cells[2]!.all().filter((node) => node instanceof TextNode)].map((node) => (node as TextNode).font)
        let inFilm!: string[], own!: string[], late!: string
        await compileFilm(film({ font: 'text-serif' }, (s) => {
            const board = s.add(table(COLS, ROWS, { maxRows: 4 }))
            inFilm = fonts(board)
            own = fonts(table(COLS, ROWS, { font: 'sans' }))
            // A row that comes later, and a text that changes, have the font of the first rows.
            s.play(board.append(D), board.setCell('a', 'case', 'renamed'), { duration: 1 })
            late = [first(board.row('d').cells[0]!).font, (board.cell('a', 'case').words.children[1] as TextNode).font].join(' ')
        }))
        expect(inFilm).toEqual(['text-serif', 'text-serif', 'mono', 'text-serif'])
        expect(own).toEqual(['sans', 'sans', 'mono', 'sans'])
        expect(late).toBe('text-serif text-serif')
        // The total row is a summary: a label in a column of code is a text of the film, and a number is in mono.
        await compileFilm(film(() => {
            const ledger = table([{ key: 'key', mono: true, total: () => 'all' }, { key: 'units', total: 'sum' }, { key: 'plain', mono: false, total: 'sum' }], [{ id: 1, key: 'op-17', units: 3, plain: 3 }])
            const fontOf = (cell: TableCellNode) => (cell.all().find((node) => node instanceof TextNode) as TextNode).font
            expect(ledger.rows[0]!.cells.map(fontOf)).toEqual(['mono', 'mono', 'sans'])
            expect(ledger.totals!.cells.map(fontOf)).toEqual(['sans', 'mono', 'sans'])
        }))
    })

    it('keeps text off text and lines off text through every change, also for the rule of crowded text at 0.3 and at 0.7', async () => {
        const film_ = film({ fps: 15 }, (s) => {
            const board = s.add(table([{ key: 'case' }, { key: 'score', marks: true, format: (value) => value.toFixed(2), total: 'sum' }, { key: 'verdict', align: 'center', marks: true, total: (rows) => `${rows.filter((row) => row.states['verdict'] === 'pass').length} of ${rows.length}` }, { key: 'note', marks: true }], [
                { id: 'a', case: 'first page is due', score: 0.62, verdict: { value: 'pending', state: 'pending' }, note: 'kept' },
                { id: 'b', case: 'page is overdue', score: 0.4, verdict: { value: 'pass', state: 'pass' }, note: { value: 'checked', state: 'pass' } },
                { id: 'c', case: 'no P1 was declared', score: 0.93, verdict: { value: 'fail', state: 'fail' }, note: { value: 'held', state: 'warn' } },
            ], { size: 30, maxRows: 5 }))
            s.play(board.enter(), { duration: 1 })
            s.play(board.light('a', 'verdict'), board.setCell('a', 'verdict', { value: 'fail', state: 'fail' }), board.setCell('a', 'score', { value: 0.71, state: 'pass' }), { duration: 0.8 })
            s.play(board.light('c'), { duration: 0.8 })
            s.play(board.append([{ id: 'd', case: 'second incident', score: 0.88, verdict: { state: 'skip' }, note: 'new' }, { id: 'e', case: 'time is missing', score: 0.05, verdict: { value: 'fail', state: 'fail' }, note: 'new' }]), { duration: 1.6 })
            s.play(board.sort('score', { descending: true }), board.light(null, 'score'), { duration: 1.2 })
            s.play(board.moveRow('e', 0), board.light('e'), { duration: 1 })
            s.play(board.remove(['a', 'e']), { duration: 1 })
            s.play(board.sort('case'), board.light(null), { duration: 1 })
            s.wait(0.5)
        })
        for (const textGap of [0.3, 0.7]) expect((await checkFilm(film_, { motion: true, readingSpeed: 0, textGap })).diagnostics, `text gap ${textGap}`).toEqual([])
        // At rest, with the lowest rows and the longest texts that fit, and with the most room that the rule asks for.
        const tight = film({ fps: 12 }, (s) => {
            const rows = [{ id: 'a', name: 'Agjpqy(|', value: { value: 12345, state: 'pass' }, verdict: { value: 'Agjpqy', state: 'fail' } }, { id: 'b', name: 'Agjpqy(|', value: { value: 67890, state: 'warn' }, verdict: { state: 'pending' } }]
            const columns: TableColumn[] = [{ key: 'name', total: () => 'Agjpqy(|' }, { key: 'value', total: 'sum' }, { key: 'verdict', align: 'center' }]
            const low = s.add(table(columns, rows, { size: 26, leading: 1.4 }).at(-400, 0))
            const high = s.add(table(columns, rows, { size: 44 }).at(400, 0))
            s.play(low.light('a'), high.light('b', 'value'), { duration: 0 })
            s.wait(0.5)
        })
        for (const textGap of [0.3, 0.7, 3]) expect((await checkFilm(tight, { textGap })).diagnostics, `at rest, text gap ${textGap}`).toEqual([])
    })
})
