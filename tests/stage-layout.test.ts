import { describe, expect, it } from 'vitest'
import * as V from '../src/stage/index'
import { ownLabels } from '../src/stage/node'
import {
    Block, Box, GAP, barChart, beside, between, boxOf, checkFilm, chip, circle, column, compileFilm, eventLog, fadeIn, film, fitted, grid, group, grow, lanes, narrated, narration, pictogram,
    place, rect, row, text, to,
    type Node, type PathOp, type SceneClock, type Stage, type TextNode, type TimingFile,
} from '../src/stage/index'

const edges = (box: Box) => [box.left, box.top, box.right, box.bottom].map((value) => Math.round(value * 10) / 10)
/** Run a body inside a film, because a text needs a font, and the compiler of a film waits for it. */
const inFilm = (body: () => void) => compileFilm(film({ fps: 10 }, () => body()))

describe('layout: regions', () => {
    it('gives the edges, the middle and the size of a region, and a point of it', () => {
        const area = new Box(-900, -400, 900, 440)
        expect(area).toEqual({ left: -900, top: -400, right: 900, bottom: 440, cx: 0, cy: 20, width: 1800, height: 840 })
        expect([area.point(), area.point('top right'), area.point('left')]).toEqual([[0, 20], [900, -400], [-900, 20]])
        expect(() => area.point('middle' as 'center')).toThrow('point: no place "middle". A place is center, an edge such as top, or a corner such as top left')
    })

    it('cuts a region into columns and rows by a count or by shares, with a gap between them', () => {
        const area = new Box(-900, -400, 900, 400)
        expect(area.columns(2).map(edges)).toEqual([[-900, -400, -24, 400], [24, -400, 900, 400]])
        expect(area.columns([2, 1], 'none').map((box) => box.width)).toEqual([1200, 600])
        expect(area.rows([3, 1], 'none').map(edges)).toEqual([[-900, -400, 900, 200], [-900, 200, 900, 400]])
        expect(area.rows(3, 20).map((box) => Math.round(box.height))).toEqual([253, 253, 253])
        expect(edges(area.inset('normal'))).toEqual([-876, -376, 876, 376])
        expect(edges(area.inset('loose', 'none'))).toEqual([-828, -400, 828, 400])
        expect(edges(area.grow('tight'))).toEqual([-912, -412, 912, 412])
        expect(edges(area.grow('tight', 'none'))).toEqual([-912, -400, 912, 400])
        // The gap between two rows is wide when the call names none, as it is between two columns.
        expect(area.rows(2).map(edges)).toEqual([[-900, -400, 900, -24], [-900, 24, 900, 400]])
    })

    it('stops when a cut cannot be made, and says which changes work', () => {
        const small = new Box(0, 0, 100, 100)
        expect(() => small.columns(4)).toThrow('columns: 4 columns with a gap of 48 need more than 144 pixels, and the region has 100. Use fewer columns, a smaller gap, or a wider region')
        expect(() => small.rows([1, 0])).toThrow('rows: give a count such as 2, or the share of each part such as [2, 1], and it is [1,0]')
        expect(() => small.columns(2.5)).toThrow('columns: give a count such as 2')
        expect(() => small.inset('wide', 'loose')).toThrow('inset: a margin of 48 by 72 leaves nothing of a region that is 100 wide and 100 high. Use a smaller gap, or a larger region')
        expect(() => small.inset('big' as 'wide')).toThrow('inset: no gap "big". A gap is none, tight, normal, wide or loose, or a number of pixels')
    })

    it('gives the room on one side of a thing, and the room between two things', () => {
        const area = new Box(0, 0, 1000, 600), picture = rect(400, 300).at(200, 150)
        expect(edges(area.beside(picture, 'right', 'wide'))).toEqual([448, 0, 1000, 600])
        expect(edges(area.beside(picture, 'under', 'none'))).toEqual([0, 300, 1000, 600])
        expect(edges(area.beside(picture, 'under'))).toEqual([0, 324, 1000, 600])
        expect(edges(between(rect(100, 40).at(0, 0), rect(60, 40).at(0, 200)))).toEqual([-50, 20, 50, 180])
        expect(edges(between(rect(40, 100).at(300, 0), rect(40, 60).at(0, 0)))).toEqual([20, -50, 280, 50])
        expect(edges(between(rect(40, 60).at(0, 0), rect(40, 100).at(300, 0)))).toEqual([20, -50, 280, 50])
        // The message names a smaller gap only when a smaller gap works.
        expect(() => area.beside(rect(1000, 590).at(500, 295), 'under')).toThrow('beside: the region has no room under the item at (500, 295), 1000 wide and 590 high: with a gap of 24, 14 pixels are missing. Use a gap under 10, make the thing smaller, or move it away from that edge')
        expect(() => area.beside(rect(1000, 600).at(500, 300), 'under')).toThrow('with a gap of 24, 24 pixels are missing. Make the thing smaller, or move it away from that edge')
        expect(() => between(rect(100, 100), rect(50, 50))).toThrow('overlap, so there is no room between them')
    })

    it('keeps the room beside a thing inside the region, when the thing is outside it', () => {
        const area = new Box(-900, -400, 900, 440), heading = rect(600, 60).at(-600, -470)
        // The heading is over the area, so the whole area is under it.
        expect(edges(area.beside(heading, 'under'))).toEqual([-900, -400, 900, 440])
        expect(edges(area.beside(rect(100, 100).at(-1200, 0), 'right'))).toEqual([-900, -400, 900, 440])
        expect(edges(area.beside(rect(100, 100).at(1200, 0), 'left', 'none'))).toEqual([-900, -400, 900, 440])
        expect(edges(area.beside(rect(100, 100).at(0, 700), 'above'))).toEqual([-900, -400, 900, 440])
    })

    it('refuses an edge, a point and a place of a node that is not a number', () => {
        expect(() => new Box(0, 0, 0 / 0, 100)).toThrow('Box: the edges are left 0, top 0, right NaN and bottom 100. Each edge is a finite number of stage pixels')
        expect(() => new Box(100, 0, -100, 100)).toThrow('Box: the edges are left 100, top 0, right -100 and bottom 100. A box has its right edge at or after its left edge')
        expect(() => beside(rect(10, 10), [100 * (0 / 0), 0], 'right')).toThrow('beside: the other thing is the point [NaN, 0], which is not a place. Each number of a point is finite')
        const lost = rect(10, 10).at(0 / 0, 0)
        lost.label = 'lost'
        expect(() => place(lost, new Box(0, 0, 100, 100))).toThrow('place: the item "lost" has a place or a size that is not a number, so it has no measure. Look at the values of its .at(), .shift() and .scale()')
        expect(() => new Box(0, 0, 100, 100).grow(-60)).toThrow('grow: a margin of 60 by 60 leaves nothing of a region that is 100 wide and 100 high')
    })
})

describe('layout: containers', () => {
    it('lays a row out by the measure of each item, with the middles on one line', () => {
        const a = rect(100, 40), b = rect(60, 80), c = rect(20, 20)
        const made = row([a, b, c], { gap: 'tight' })
        expect(edges(boxOf(a))).toEqual([-102, -20, -2, 20])
        expect(edges(boxOf(b))).toEqual([10, -40, 70, 40])
        expect(edges(boxOf(c))).toEqual([82, -10, 102, 10])
        expect(made).toBeInstanceOf(Block)
        expect(made.nodes).toEqual([a, b, c])
        expect(made.box.width).toBe(204)
        expect(edges(row([rect(10, 10), rect(10, 30)], { gap: 'none', align: 'top' }).box)).toEqual([-10, -15, 10, 15])
    })

    it('puts the left edges of a column on one line, and skips an item that is not there', () => {
        const a = rect(100, 40), b = rect(60, 20)
        column([a, false, b, null], { gap: 12 })
        expect(edges(boxOf(a))).toEqual([-50, -36, 50, 4])
        expect(edges(boxOf(b))).toEqual([-50, 16, 10, 36])
        const right = rect(60, 20)
        column([rect(100, 40), right], { gap: 'none', align: 'right' })
        expect(boxOf(right).right).toBe(50)
    })

    it('has four named gaps, and normal between two items when a container names none', () => {
        expect(GAP).toEqual({ none: 0, tight: 12, normal: 24, wide: 48, loose: 72 })
        const a = rect(10, 10), b = rect(10, 10)
        row([a, b])
        expect(boxOf(b).left - boxOf(a).right).toBe(24)
        column([a, b])
        expect(boxOf(b).top - boxOf(a).bottom).toBe(24)
        column([a, b], { gap: 'loose' })
        expect(boxOf(b).top - boxOf(a).bottom).toBe(72)
    })

    it('leaves each node where it is in the tree, so a film still shows each one by itself', async () => {
        const a = rect(40, 40, { fill: 'blue' }), b = rect(40, 40, { fill: 'red' })
        row([a, b])
        expect([a.parent, b.parent]).toEqual([null, null])
        const compiled = await compileFilm(film({ fps: 10 }, (s) => { s.add(a); s.wait(1) }))
        const drawn = (compiled.frame(0.5).ops as PathOp[]).map((op) => op.node)
        expect(drawn.includes(a)).toBe(true)
        expect(drawn.includes(b)).toBe(false)
    })

    it('measures a text by its line box, 1.2 text sizes for each line, whatever letters it holds', async () => {
        await inFilm(() => {
            const low = text('moon', { size: 40 }), high = text('Kilo', { size: 40, anchor: 'left' })
            // The ink of the two words differs, and the line boxes do not: each is 1.2 text sizes high.
            expect(boxOf(low).height).toBeCloseTo(48, 6)
            expect(boxOf(high).height).toBeCloseTo(48, 6)
            expect(Math.abs(low.bounds().height - high.bounds().height)).toBeGreaterThan(2)
            // A block of two lines is one more line high.
            const two = text('one\ntwo', { size: 40, leading: 1.5 })
            expect(boxOf(two).height).toBeCloseTo(108, 6)
            // The box is a typed field of the node, and a copy of the node keeps it.
            expect(low.layoutBox).toHaveLength(4)
            expect(edges(boxOf(low.clone()))).toEqual(edges(boxOf(low)))
            expect(rect(10, 10).layoutBox).toBeNull()
        })
    })

    it('puts the texts of a row on one base line, for two sizes and for two fonts, and `align` says another line', async () => {
        await inFilm(() => {
            // The base line of a text is at the y of its origin row, 0 in its own coordinates.
            const base = (node: TextNode) => node.worldMatrix()[5]
            const large = text('Requests', { size: 44 }), small = text('per second', { size: 32 }), mono = text('kvm_run', { size: 44, font: 'mono' }), display = text('160', { size: 78 })
            const mark = rect(30, 30)
            row([large, small, mono, mark, display])
            for (const node of [small, mono, display]) expect(base(node)).toBeCloseTo(base(large), 6)
            // Capital letters with no part under the line have their ink on that line, in each size.
            const caps = [44, 32, 78].map((size) => text('HELLO', { size }))
            row(caps)
            const bottoms = caps.map((node) => node.bounds().y + node.bounds().height)
            expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1)
            // The mark has its middle on the middle of the highest text.
            expect(boxOf(mark).cy).toBeCloseTo(boxOf(display).cy, 6)
            // Beside a mark that is higher than the texts, the highest text has its middle on the middle of the mark.
            const tall = rect(30, 300), head = text('Head', { size: 60 }), foot = text('foot', { size: 30 })
            row([tall, head, foot])
            expect(boxOf(head).cy).toBeCloseTo(boxOf(tall).cy, 6)
            expect(base(foot)).toBeCloseTo(base(head), 6)
            // Two lines beside one line: the one line is on the first base line.
            const lines = text('one\ntwo', { size: 40 }), term = text('term', { size: 40 })
            row([term, lines])
            expect(base(term)).toBeCloseTo(base(lines), 6)
            // A row inside a row keeps the line of its text.
            const name = text('name', { size: 32 }), value = text('12', { size: 64 })
            row([row([rect(20, 20), name]), value])
            expect(base(name)).toBeCloseTo(base(value), 6)
            // The rows of a grid do the same.
            const key = text('key', { size: 30 }), amount = text('42', { size: 60 })
            grid([key, amount], { columns: 2 })
            expect(base(key)).toBeCloseTo(base(amount), 6)
            // A text that is turned has no base line across the row: its box has its middle on the line of the middles.
            const upright = text('Requests', { size: 44 }), turned = text('axis', { size: 30 }).rotate(-Math.PI / 2), flat = text('axis', { size: 30 })
            row([upright, turned, flat])
            expect(boxOf(turned).cy).toBeCloseTo(boxOf(upright).cy, 6)
            expect(base(flat)).toBeCloseTo(base(upright), 6)
            expect(boxOf(flat).cy).toBeGreaterThan(boxOf(upright).cy + 2)
            // `center` lines up the middles of the boxes, and `top` and `bottom` one edge.
            row([large, small], { align: 'center' })
            expect(boxOf(small).cy).toBeCloseTo(boxOf(large).cy, 6)
            expect(base(small)).toBeLessThan(base(large) - 3)
            row([large, small], { align: 'bottom' })
            expect(boxOf(small).bottom).toBeCloseTo(boxOf(large).bottom, 6)
            row([large, small], { align: 'top' })
            expect(boxOf(small).top).toBeCloseTo(boxOf(large).top, 6)
        })
    })

    /**
     * The room between a text and the edge that a mark draws, with half of the width of its line. The room of
     * a text is from its line box at its sides, and from the letters of its font over it and under it.
     */
    const room = (words: TextNode, mark: Node, side: 'right' | 'under' | 'left'): number => {
        const m = words.worldMatrix(), own = boxOf(words), box = boxOf(mark), line = mark.get('stroke') ? mark.get('strokeWidth') / 2 : 0
        return side === 'right' ? box.left - line - own.right : side === 'left' ? own.left - (box.right + line) : box.top - line - (m[5] + words.letters[1] * m[3])
    }

    it('keeps a named gap beside a text over the room that the film check asks for, 0.3 of the text size', async () => {
        await inFilm(() => {
            const large = text('Kilo', { size: 64 }), mark = rect(40, 40)
            row([large, mark], { gap: 'tight' })
            // From the text to the line of the mark: 0.3 of 64, and half a pixel.
            expect(room(large, mark, 'right')).toBeCloseTo(19.7, 6)
            // A wider gap stays as it is.
            row([large, mark])
            expect(boxOf(mark).left - boxOf(large).right).toBeCloseTo(24, 6)
            // Two texts are words of one line.
            const next = text('watt', { size: 64 })
            row([large, next], { gap: 'tight' })
            expect(boxOf(next).left - boxOf(large).right).toBeCloseTo(12, 6)
            // Under a text, the room is from the lowest letter of the font. `beside`, a column and a grid keep the same room.
            const deep = text('gypsy', { size: 64 })
            beside(mark, deep, 'under', 'tight')
            expect(room(deep, mark, 'under')).toBeCloseTo(19.7, 6)
            grid([mark, large], { columns: 2, gap: 'tight' })
            expect(room(large, mark, 'left')).toBeCloseTo(19.7, 6)
            column([deep, mark], { gap: 'tight' })
            expect(room(deep, mark, 'under')).toBeCloseTo(19.7, 6)
            grid([deep, mark], { columns: 1, gap: 'tight' })
            expect(room(deep, mark, 'under')).toBeCloseTo(19.7, 6)
            // The room holds the ink, which is what the film check measures.
            expect(boxOf(mark).top - (deep.bounds().y + deep.bounds().height)).toBeGreaterThanOrEqual(0.3 * 64)
            // Over a text, the room is from the highest letter or sign of the font.
            column([mark, large], { gap: 'tight' })
            expect(large.worldMatrix()[5] + large.letters[0] - boxOf(mark).bottom - mark.get('strokeWidth') / 2).toBeCloseTo(19.7, 6)
            // A text that is scaled has the room of the size that a viewer sees.
            const scaled = text('Kilo', { size: 32 }).scale(2)
            row([scaled, mark], { gap: 'tight' })
            expect(room(scaled, mark, 'right')).toBeCloseTo(19.7, 6)
        })
    })

    it('gives texts of one font and one size the same room, whatever their letters: rows are even', async () => {
        await inFilm(() => {
            // A text with no part under the base line, one with tails, and one with a tail and a capital.
            for (const size of [78, 44]) {
                const bars = ['160 ms', 'Egypt', 'query'].map((words) => { const bar = rect(300, 60, { stroke: 'teal', fill: null }); const made = column([text(words, { size }), bar], { gap: 'tight' }); return { bar, top: made.box.top } })
                const gaps = bars.map(({ bar, top }) => boxOf(bar).top - top)
                expect(Math.max(...gaps) - Math.min(...gaps), `size ${size}`).toBeLessThan(1e-6)
            }
            // Over a text too: small letters, capitals, and a sign that is higher than both.
            const over = ['moon', 'Kilo', '(x)'].map((letters) => { const bar = rect(60, 60), words = text(letters, { size: 78 }); column([bar, words], { gap: 'tight' }); return boxOf(words).top - boxOf(bar).bottom })
            expect(Math.max(...over) - Math.min(...over)).toBeLessThan(1e-6)
            // At the sides too: a last letter that leans, and one that does not.
            const sides = ['off', 'old', 'A.'].map((letters) => { const bar = rect(60, 60), words = text(letters, { size: 78 }); row([words, bar], { gap: 'tight' }); return boxOf(bar).left - boxOf(words).right })
            expect(Math.max(...sides) - Math.min(...sides)).toBeLessThan(1e-6)
            // The two lines are of the font and the size, not of the letters.
            expect(text('160', { size: 78 }).letters).toEqual(text('gypsy', { size: 78 }).letters)
            expect(text('160', { size: 78 }).letters[1]).toBeCloseTo(text('160', { size: 39 }).letters[1] * 2, 6)
            // A sign that passes the lines of the font, such as a capital with an accent, still has its room from its ink.
            // In this font, the accent is some 9 pixels over the highest letter of the font.
            const accent = text('ÉCOLE', { size: 78, font: 'text-serif' }), plain = text('ECOLE', { size: 78, font: 'text-serif' }), lid = rect(300, 60)
            column([lid, accent], { gap: 'tight' })
            expect(accent.bounds().y - boxOf(lid).bottom).toBeGreaterThanOrEqual(0.3 * 78)
            expect(accent.bounds().y).toBeLessThan(accent.worldMatrix()[5] + accent.letters[0] - 5)
            expect(plain.bounds().y).toBeGreaterThan(plain.worldMatrix()[5] + plain.letters[0])
            // A text of two lines has its room under the last line, with or without a tail there.
            const lines = ['one\ntwo', 'one\ngyp'].map((letters) => { const bar = rect(60, 60), words = text(letters, { size: 78 }); column([words, bar], { gap: 'tight' }); return boxOf(bar).top - boxOf(words).bottom })
            expect(Math.max(...lines) - Math.min(...lines)).toBeLessThan(1e-6)
            expect(text('one\ntwo', { size: 78, leading: 1.5 }).letters[1]).toBeCloseTo(text('one', { size: 78 }).letters[1] + 117, 6)
        })
    })

    it('keeps that room for a text that is inside a block or a list, at any depth', async () => {
        await inFilm(() => {
            const mark = rect(300, 60, { stroke: 'teal', fill: null })
            // The text is the last item of a row that is an item of the row.
            const nested = text('160', { size: 78 })
            row([row([pictogram('stopwatch', { size: 60 }), nested], { gap: 'tight' }), mark], { gap: 'tight' })
            expect(room(nested, mark, 'right')).toBeCloseTo(23.9, 6)
            // The text is in a list, and two blocks deep.
            const listed = text('160', { size: 78 })
            row([[listed], mark], { gap: 'tight' })
            expect(room(listed, mark, 'right')).toBeCloseTo(23.9, 6)
            const deep = text('160', { size: 78 })
            row([mark, column([row([deep, rect(10, 10)])])], { gap: 'tight' })
            expect(room(deep, mark, 'left')).toBeCloseTo(23.9, 6)
            // A row of two texts over a mark: each text has its own room, by its own size.
            const big = text('requests', { size: 44 }), little = text('per second', { size: 32 })
            column([row([big, little]), mark], { gap: 'tight' })
            expect(room(big, mark, 'under')).toBeCloseTo(13.7, 6)
            expect(room(little, mark, 'under')).toBeGreaterThanOrEqual(10.1)
            // A text that a mark of its own block is in front of needs no room: the mark is at the edge.
            const hidden = text('160', { size: 78 }), front = rect(20, 20)
            row([row([hidden, front], { gap: 'wide' }), mark], { gap: 'tight' })
            expect(boxOf(mark).left - boxOf(front).right).toBeCloseTo(12, 6)
        })
    })

    it('gives a film of named gaps beside texts no finding of the film check', async () => {
        const made = film({ fps: 10, font: 'text-serif' }, (s) => {
            const bar = () => rect(300, 60, { stroke: 'teal', fill: null })
            const direct = row([text('160', { size: 78 }), bar()], { gap: 'tight' })
            const nested = row([row([pictogram('stopwatch', { size: 60 }), text('160', { size: 78 })], { gap: 'tight' }), bar()], { gap: 'tight' })
            const listed = row([[text('160', { size: 78 })], bar()], { gap: 'tight' })
            const stacked = column([row([text('requests', { size: 44 }), text('per second', { size: 32, color: 'dim' })]), bar()], { gap: 'tight' })
            s.add(place(column([direct, nested, listed, stacked], { gap: 'loose' }), new Box(-900, -400, 900, 440)))
            s.wait(1)
        })
        expect((await checkFilm(made, { textGap: 0.3 })).diagnostics).toEqual([])
    })

    it('takes `none` and a number as they are, also beside a text', async () => {
        await inFilm(() => {
            const large = text('Kilo', { size: 78 }), mark = rect(40, 40)
            row([large, mark], { gap: 'none' })
            expect(boxOf(mark).left - boxOf(large).right).toBeCloseTo(0, 6)
            column([large, mark], { gap: 'none' })
            expect(boxOf(mark).top - boxOf(large).bottom).toBeCloseTo(0, 6)
            row([large, mark], { gap: 4 })
            expect(boxOf(mark).left - boxOf(large).right).toBeCloseTo(4, 6)
            beside(mark, large, 'right', 0)
            expect(boxOf(mark).left - boxOf(large).right).toBeCloseTo(0, 6)
            // The four names from tight to loose keep the room.
            row([large, mark], { gap: 'tight' })
            expect(boxOf(mark).left - boxOf(large).right).toBeGreaterThan(20)
        })
    })

    it('measures a pictogram by the square of its grid, and a hidden part as a part', () => {
        const picture = pictogram('check', { size: 48 })
        expect(edges(boxOf(picture))).toEqual([-24, -24, 24, 24])
        // The example of the guide: a hidden part counts in the measure, and not in `bounds()`.
        const holder = group(rect(100, 60), rect(300, 300).hide())
        expect([holder.bounds().width, holder.bounds().height]).toEqual([100, 60])
        expect([boxOf(holder).width, boxOf(holder).height]).toEqual([300, 300])
    })

    it('stops when one node is in a container two times, or as a group and a part of it', () => {
        const a = rect(100, 60), e = rect(100, 60)
        a.label = 'first'
        expect(() => row([a, a, e])).toThrow('row: the item "first" is in the row two times. A node has one place. Give it one time, or give a copy of it: node.clone()')
        // A node in a row, and in the column around that row.
        const b = rect(100, 60), c = rect(100, 60)
        b.label = 'second'
        expect(() => column([row([b, c]), b])).toThrow('column: the item "second" is in the column two times')
        expect(() => grid([c, e, c], { columns: 2 })).toThrow('grid: the item at ')
        // A group and its child: the group moves the child, so the layout would move the child two times.
        const child = rect(100, 60), holder = group(child, rect(100, 60).at(200, 0))
        child.label = 'child'
        holder.label = 'holder'
        expect(() => place([holder, child], new Box(0, 0, 1000, 600))).toThrow('place: the item "child" is a part of the item "holder", and the list has both. A group moves its parts, so the part would move two times. Give the group, or the part')
        expect(() => beside([child, holder], [0, 0], 'right')).toThrow('beside: the item "child" is a part of the item "holder"')
        expect(() => row([holder, child])).toThrow('row: the item "child" is a part of the item "holder", and the row has both')
        // No node moved: each error comes before the layout.
        expect(edges(boxOf(a))).toEqual([-50, -30, 50, 30])
        // A copy is a second node.
        expect(row([a, a.clone()], { gap: 'none' }).box.width).toBe(200)
    })

    it('nests: a container moves the block inside it as one item, and a list of nodes as one item', () => {
        const a = rect(40, 40), b = rect(40, 40), c = rect(100, 20)
        column([row([a, b], { gap: 'none' }), c], { gap: 'none', align: 'center' })
        expect(edges(boxOf(a))).toEqual([-40, -30, 0, 10])
        expect(edges(boxOf(b))).toEqual([0, -30, 40, 10])
        expect(edges(boxOf(c))).toEqual([-50, 10, 50, 30])
        // The two nodes of a list keep their places to each other.
        const frame = rect(100, 40).at(500, 500), name = rect(20, 10).at(530, 500)
        row([rect(10, 10), [frame, name]], { gap: 'none' })
        expect(boxOf(name).cx - boxOf(frame).cx).toBe(30)
        expect(edges(boxOf(frame))).toEqual([-45, -20, 55, 20])
    })

    it('lays a grid out by its widest column and its highest row, and keeps an empty cell empty', () => {
        const icon = rect(30, 30), name = rect(200, 20), note = rect(120, 20)
        const made = grid([icon, name, null, note], { columns: 2, gap: 'tight' })
        expect(edges(boxOf(icon))).toEqual([-121, -31, -91, -1])
        expect(edges(boxOf(name))).toEqual([-79, -26, 121, -6])
        expect(edges(boxOf(note))).toEqual([-79, 11, 41, 31])
        expect(made.nodes).toEqual([icon, name, note])
        const rows = [rect(10, 40), rect(10, 10), rect(10, 10)]
        grid(rows, { columns: 1, gap: 'none', even: true })
        expect(rows.map((node) => node.get('y'))).toEqual([-40, 0, 40])
        const value = rect(20, 10)
        grid([rect(60, 10), rect(10, 10), value, rect(10, 10)], { columns: 2, gap: ['wide', 'none'], align: ['right', 'left'] })
        expect(boxOf(value).right).toBe(1)
        // Each column has its own align: the three columns are 100 wide, at -150, -50 and 50.
        const cells = [rect(100, 10), rect(100, 10), rect(100, 10), rect(20, 10), rect(20, 10), rect(20, 10)]
        grid(cells, { columns: 3, gap: 'none', align: ['left', 'center', 'right'] })
        expect(cells.slice(3).map((cell) => boxOf(cell).left)).toEqual([-150, -10, 130])
        grid(cells, { columns: 3, gap: 'none', align: 'right' })
        expect(cells.slice(3).map((cell) => boxOf(cell).left)).toEqual([-70, 30, 130])
        expect(() => grid(cells, { columns: 3, align: ['right'] })).toThrow('grid: align is a list of 1, and the grid has 3 columns. Give one value for all columns, or a list with one value for each column')
    })

    it('stops on a container that it cannot make', () => {
        expect(() => row([])).toThrow('row: give it at least one item')
        expect(() => column([rect(1, 1)], { align: 'top' as 'left' })).toThrow('column: align is left, center or right, and it is "top"')
        expect(() => row([rect(1, 1)], { align: 'left' as 'top' })).toThrow('row: align is baseline, top, center or bottom, and it is "left"')
        expect(() => row([rect(1, 1)], { gap: 'huge' as 'wide' })).toThrow('row: no gap "huge". A gap is none, tight, normal, wide or loose, or a number of pixels')
        expect(() => grid([rect(1, 1)], { columns: 0 })).toThrow('grid: columns is the count of columns, a whole number of 1 or more, and it is 0')
        expect(() => grid([null], { columns: 2 })).toThrow('grid: give it at least one item')
    })

    it('says what to give when a call gets a value of the wrong kind, with no raw error', () => {
        const a = rect(10, 10), b = rect(10, 10), region = new Box(0, 0, 100, 100)
        const call = (run: (...values: never[]) => unknown, ...values: unknown[]) => () => run(...values as never[])
        // The items are one list.
        expect(call(row, a, b)).toThrow('row: the items are one list, such as row([a, b]), and the first argument is a node')
        expect(call(column, a, b)).toThrow('column: the items are one list, such as column([a, b]), and the first argument is a node')
        expect(call(grid, a, { columns: 2 })).toThrow('grid: the items are one list, such as grid([a, b, c, d], { columns: 2 }), and the first argument is a node')
        // An item is a node, a block or a list.
        expect(call(row, ['title', a])).toThrow('row: item 0 is the string "title". An item is a node, a block that a container returned, or a list of them. Make a node from the words, with `label` of the kit or with `text`')
        expect(call(column, [a, 5])).toThrow('column: item 1 is the value 5. An item is a node, a block that a container returned, or a list of them')
        expect(call(row, [a, [b, region]])).toThrow('row: item 1[1] is a region. An item is a node, a block that a container returned, or a list of them. A region and a point have no place to change: put a node there with `place` or `beside`')
        expect(call(place, region, region)).toThrow('place: the item is a region. An item is a node')
        expect(call(place, [10, 10], region)).toThrow('place: the item is the point [10, 10]. An item is a node')
        expect(call(place, undefined, region)).toThrow('place: the item is undefined. An item is a node')
        expect(call(place, [], region)).toThrow('place: the item is an empty list. Give it at least one node')
        expect(call(beside, 'note', a, 'right')).toThrow('beside: the item is the string "note"')
        // A region is a box, or a thing with a measure.
        expect(call(place, a, undefined)).toThrow('place: the region is undefined. A region is a `Box` such as the `area` of the kit, or a thing whose measure is the region: a node, a block or a list')
        expect(call(place, a, [10, 10])).toThrow('place: the region is the point [10, 10], and a point has no room for an item. To put an item at a point, use beside(item, [x, y], side), or give a region')
        expect(call(place, a, 'area')).toThrow('place: the region is the string "area", which has no measure. Give a node, a block, a region, a point [x, y], or a list of them')
        expect(call(beside, a, undefined, 'right')).toThrow('beside: the other thing is undefined. Give a node, a block, a region, or a point [x, y]')
        expect(call(boxOf, 'title')).toThrow('boxOf: the thing is the string "title", which has no measure')
        expect(call(between, a, 7)).toThrow('between: the second thing is the value 7, which has no measure')
        // A node is a region too: its measure. So a node where a region is expected works.
        expect(edges(boxOf(place(a, rect(100, 100).at(50, 50), 'top left')))).toEqual([0, 0, 10, 10])
        expect(boxOf(fitted(rect(200, 10), (width) => rect(width, 10))).width).toBe(200)
        // The parts beside the plot can change with the width: more passes bring the object to the width of the region.
        expect(boxOf(fitted(500, (width) => rect(width * 1.1 + 100, 10))).width).toBeCloseTo(500, 0)
        // A gap, a place, a side and an align are words of a short list.
        expect(call(beside, a, b, 'right', 'big')).toThrow('beside: no gap "big". A gap is none, tight, normal, wide or loose, or a number of pixels')
        expect(call(region.columns.bind(region), 2, { gap: 'tight' })).toThrow('columns: no gap an object that is not a node. A gap is none, tight, normal, wide or loose, or a number of pixels')
        expect(call(place, a, region, 'middle')).toThrow('place: no place "middle". A place is center, an edge such as top, or a corner such as top left')
        expect(call(place, a, region, 'top top')).toThrow('place: no place "top top"')
        expect(call(beside, a, b, 'below')).toThrow('beside: the side is left, right, above or under, and it is "below"')
        // The options are an object, with the names that the call has.
        expect(call(row, [a], 'tight')).toThrow("row: the options are an object such as { gap: 'tight' }, and the second argument is the string \"tight\"")
        expect(call(row, [a], { gaps: 'tight' })).toThrow('row has no option "gaps". Its options are: gap, align')
        expect(call(grid, [a], { columns: 1, column: 2 })).toThrow('grid has no option "column". Its options are: columns, gap, align, even')
        expect(call(fitted, region, a)).toThrow('fitted: the second argument is a function that builds the object from a width, such as (width) => lanes(names, events, { width }), and it is a node')
        expect(call(fitted, region, () => 'object')).toThrow('fitted: the function returned the string "object". It returns the object that it builds, which is a node')
        expect(() => fitted(200, () => rect(500, 40))).toThrow('fitted: the object is 500 wide for each width that the function gets, and the region is 200 wide. Give the width to the object')
    })

    it('takes a block where a film gives nodes: on the stage, and in an animation', async () => {
        const a = rect(40, 40, { fill: 'blue' }), b = rect(40, 40, { fill: 'red' }), c = rect(40, 40, { fill: 'green' }), d = rect(40, 40, { fill: 'teal' })
        const compiled = await compileFilm(film({ fps: 10 }, (s) => {
            // A block on the stage is its nodes.
            expect(s.add(row([a, b]))).toBeInstanceOf(Block)
            s.play(fadeIn(row([c, d]), { duration: 1 }))
            s.remove(row([a]))
            s.wait(1)
            // A list that the layout placed is its nodes too: `place` gives back what it got.
            expect(s.add(place([rect(5, 5), row([rect(5, 5)])], new Box(0, 0, 100, 100)))).toHaveLength(2)
            expect(() => s.add(undefined as unknown as Node)).toThrow('s.add: argument 0 is undefined. Give a node, a block of the layout, or a list of them')
            expect(() => s.add(a, 'title' as unknown as Node)).toThrow('s.add: argument 1 is the string "title". Give a node, a block of the layout, or a list of them')
            expect(() => s.remove(5 as unknown as Node)).toThrow('s.remove: argument 0 is the value 5. Give a node, a block of the layout, or a list of them')
        }))
        const drawn = (time: number) => (compiled.frame(time).ops as PathOp[]).map((op) => op.node)
        expect([a, b, c, d].map((node) => drawn(0.5).includes(node))).toEqual([true, true, true, true])
        expect([a, b].map((node) => drawn(1.5).includes(node))).toEqual([false, true])
    })
})

describe('layout: place and beside', () => {
    it('places an item at the middle, an edge or a corner of a region', () => {
        const region = new Box(0, 0, 400, 300), item = rect(100, 50)
        expect(edges(boxOf(place(item, region)))).toEqual([150, 125, 250, 175])
        expect(edges(boxOf(place(item, region, 'top left')))).toEqual([0, 0, 100, 50])
        expect(edges(boxOf(place(item, region, 'bottom')))).toEqual([150, 250, 250, 300])
        expect(edges(boxOf(place(item, rect(200, 100).at(1000, 0), 'right')))).toEqual([1000, -25, 1100, 25])
    })

    it('stops the build when the item does not fit, and says by how much', () => {
        const region = new Box(0, 0, 400, 300)
        expect(() => place(rect(500, 400), region)).toThrow('place: the item at (0, 0), 500 wide and 400 high is 100 too wide (500 in 400) and 100 too high (400 in 300) for its region. What works for the width: a width of 400 or less, or a region that is 500 wide or more. What works for the height: a height of 300 or less, or a region that is 400 high or more')
        // The rounding of a measure is not an overflow: half a pixel passes, and more does not.
        expect(boxOf(place(rect(400.4, 300.4), region)).width).toBeCloseTo(400.4, 6)
        expect(() => place(rect(400.6, 10), region)).toThrow('0.6 too wide (400.6 in 400)')
        expect(() => place(rect(10, 300.6), region)).toThrow('0.6 too high (300.6 in 300)')
    })

    it('names only the changes that work for the call', async () => {
        const region = new Box(0, 0, 400, 300)
        const five = () => [1, 2, 3, 4, 5].map(() => rect(100, 40))
        // A row of five: the gaps take 96 of the 196 that are too much, so a smaller gap does not work, and fewer items do.
        expect(() => place(row(five()), region)).toThrow('place: the row at (0, 0), 596 wide and 40 high is 196 too wide (596 in 400) for its region. What works: fewer items in the row, or a region that is 596 wide or more')
        // A row of four: the gaps take 72 of the 72 that are too much. The row fits with no gap, as the message says.
        expect(() => place(row(five().slice(0, 4)), region)).toThrow('What works: a smaller gap (the gaps take 72 of the 472), fewer items in the row, or a region that is 472 wide or more')
        expect(place(row(five().slice(0, 4), { gap: 'none' }), region).box.width).toBe(400)
        // A row of one item, and a column: no change of the container works, so the message is about the item.
        expect(() => place(row([rect(500, 40)]), region)).toThrow('place: the row at (0, 0), 500 wide and 40 high is 100 too wide (500 in 400) for its region. The item at (0, 0), 500 wide and 40 high alone is 500 wide. What works: a width of 400 or less, or a region that is 500 wide or more')
        expect(() => place(column([rect(500, 40), rect(10, 10)]), region)).toThrow('alone is 500 wide. What works: a width of 400 or less, or a region that is 500 wide or more')
        // A grid: the count of columns that fits, when one fits.
        expect(() => place(grid(five(), { columns: 5 }), region)).toThrow('is 196 too wide (596 in 400) for its region. What works: fewer columns (`columns: 3` fits), or a region that is 596 wide or more')
        expect(() => place(grid(five().concat(five()), { columns: 1 }), region)).toThrow('too high (616 in 300) for its region. What works: more columns (`columns: 2` fits), or a region that is 616 high or more')
        expect(place(grid(five().concat(five()), { columns: 2 }), region).box.height).toBe(296)
        expect(() => place(grid([rect(500, 40), rect(10, 10)], { columns: 1 }), region)).toThrow('alone is 500 wide. What works: a width of 400 or less, or a region that is 500 wide or more')
        await inFilm(() => {
            // The first text of a film loads its font: the film stops there, and starts again with the font.
            text('font')
            // One line of text that is too high: the message says how a text measures, and has no "fewer lines".
            expect(() => place(text('800 ms', { size: 44 }), new Box(0, 0, 400, 48))).toThrow(
                'place: the text "800 ms" is 4.8 too high (52.8 in 48) for its region. A text measures 1.2 of its size for each line: one line of size 44 is 52.8 high. What works: a text size of 40 or less (it is 44), or a region that is 52.8 high or more')
            expect(boxOf(place(text('800 ms', { size: 40 }), new Box(0, 0, 400, 48))).height).toBeCloseTo(48, 6)
            // Two lines that are too high: fewer lines work when one line fits.
            expect(() => place(text('one\ntwo', { size: 40 }), new Box(0, 0, 400, 60))).toThrow('What works: fewer lines (fewer words, or a larger `maxWidth`), a text size of 24 or less (it is 40), or a region that is 100 high or more')
            // A line that is too wide: it can wrap when the region has the height, and each size that the message names fits.
            const long = 'a line that is much too long for its region'
            const wide = /^place: the text "a line that is much too long for its region" is [\d.]+ too wide \([\d.]+ in 400\) for its region\. What works: lines that wrap at 400 or less \(`maxWidth` of `text`, or the width of `para`\), fewer words, a text size of (\d+) or less \(it is 40\), or a region that is [\d.]+ wide or more$/
            expect(() => place(text(long, { size: 40 }), region)).toThrow(wide)
            let size = 0
            try { place(text(long, { size: 40 }), region) } catch (error) { size = Number(wide.exec((error as Error).message)![1]) }
            expect(boxOf(place(text(long, { size }), region)).width).toBeLessThanOrEqual(400)
            expect(boxOf(place(text(long, { size: 40, maxWidth: 400 }), region)).width).toBeLessThanOrEqual(400)
            // In a region that is low, the lines do not have the height, and the message does not name them. One word does not wrap.
            expect(() => place(text(long, { size: 40 }), new Box(0, 0, 400, 60))).toThrow(/What works: fewer words, a text size of \d+ or less/)
            expect(() => place(text('Supercalifragilistic', { size: 80 }), region)).toThrow(/What works: a text size of \d+ or less \(it is 80\), or a region/)
            // A row of one text: the changes of the text.
            expect(() => place(row([text(long, { size: 40 })]), region)).toThrow(/^place: the row with the text "a line[^"]+" is [\d.]+ too wide \([\d.]+ in 400\) for its region\. The text "a line[^"]+" alone is [\d.]+ wide\. What works: lines that wrap/)
        })
    })

    it('puts an item beside another thing by their measures, and lines up an edge', () => {
        const anchor = rect(200, 100).at(0, 0), note = rect(60, 20)
        expect(edges(boxOf(beside(note, anchor, 'right', 'tight')))).toEqual([112, -10, 172, 10])
        expect(edges(boxOf(beside(note, anchor, 'left')))).toEqual([-184, -10, -124, 10])
        expect(edges(boxOf(beside(note, anchor, 'under', 'none', 'left')))).toEqual([-100, 50, -40, 70])
        expect(edges(boxOf(beside(note, [300, 300], 'above', 'none', 'right')))).toEqual([240, 280, 300, 300])
        expect(edges(boxOf(beside(note, new Box(0, 0, 100, 100), 'right', 'none', 'bottom')))).toEqual([100, 80, 160, 100])
        expect(() => beside(note, anchor, 'right', 'tight', 'left')).toThrow('beside: for the side right, align is center, top or bottom, or a part of the other thing that the item lines up with, and it is "left"')
        expect(() => beside(note, anchor, 'below' as 'under')).toThrow('beside: the side is left, right, above or under, and it is "below"')
    })

    it('puts a note beside a whole object, at the height or at the x of one part of it', async () => {
        await inFilm(() => {
            const log = eventLog([{ id: 1, name: 'OrderPlaced', detail: 'two books' }, { id: 2, name: 'OrderPlaced', detail: 'a lamp' }, { id: 3, name: 'OrderPlaced', detail: 'a chair' }], { width: 800, visible: 5 })
            const note = text('this one waits', { size: 28 })
            // The object, and then the part: beside the whole log, at the height of its third row.
            beside(note, log, 'right', 'wide', log.row(3))
            expect(boxOf(note).left).toBeGreaterThanOrEqual(boxOf(log).right + 48)
            expect(boxOf(note).cy).toBeCloseTo(boxOf(log.row(3)).cy, 6)
            expect(boxOf(note).cy).toBeGreaterThan(boxOf(log.row(1)).cy + 20)
            // The part alone as the other thing would put the note on the panel: that stops the build, and the message has the way.
            expect(() => beside(note, log.row(3), 'right', 'wide')).toThrow(
                "beside: the text \"this one waits\" would lie on the event log that the other thing is a part of. To put it beside the whole event log, at the height of the part, give the object and then the part: beside(item, object, 'right', gap, part). To put it on the object on purpose, give boxOf(part)")
            // Over a part, with room to be over the whole log: the note is not on the object, so it is fine.
            const titled = eventLog([{ id: 1, name: 'OrderPlaced' }], { width: 800, title: 'orders' })
            expect(boxOf(beside(note, titled.title!, 'above', 'loose')).bottom).toBeLessThan(boxOf(titled).top)
            expect(() => beside(note, titled.title!, 'right', 'tight')).toThrow('would lie on the event log')
            // A region is not a part: this is the way to put a thing on the object on purpose.
            expect(boxOf(beside(note, boxOf(log.row(3)), 'right', 'wide')).left).toBeLessThan(boxOf(log).right)
            // A chart: over the whole chart, at the x of one bar. A chart is a plot, so a value at a bar is fine too.
            const chart = barChart([{ label: 'a', value: 3 }, { label: 'b', value: 5 }, { label: 'c', value: 2 }], { width: 600, height: 300 })
            const slow = text('the slow one', { size: 28 })
            beside(slow, chart, 'above', 'tight', chart.bar(1))
            expect(boxOf(slow).bottom).toBeLessThanOrEqual(boxOf(chart).top - 12)
            expect(boxOf(slow).cx).toBeCloseTo(boxOf(chart.bar(1)).cx, 6)
            expect(boxOf(beside(text('5', { size: 24 }), chart.bar(1), 'above', 'tight')).cx).toBeCloseTo(boxOf(chart.bar(1)).cx, 6)
            // Over a short bar, a value is inside the box of the chart: a chart is a plot, so the film may draw on it.
            const inside = beside(text('3', { size: 24 }), chart.bar(0), 'above', 'tight')
            expect(boxOf(inside).top).toBeGreaterThan(boxOf(chart).top)
            expect(boxOf(inside).bottom).toBeLessThan(boxOf(chart.bar(0)).top)
            // A part of an object goes beside another part of the same object: it is the object that lays itself out.
            const first = rect(60, 40), second = rect(60, 40).at(200, 0), holder = ownLabels(group(first, second, rect(600, 200)), { name: 'holder' })
            expect(boxOf(beside(first, second, 'left', 'tight')).right).toBe(158)
            expect(() => beside(rect(20, 20), second, 'left', 'tight')).toThrow('beside: the item at (0, 0), 20 wide and 20 high would lie on the holder that the other thing is a part of')
            expect(holder.children).toHaveLength(3)
            expect(() => beside(slow, chart, 'above', 'tight', 'bar' as 'left')).toThrow('beside: for the side above, align is center, left or right, or a part of the other thing that the item lines up with, and it is "bar"')
        })
    })

    it('stops when it puts a node of the film off the frame, and says by how much', async () => {
        // The frame of these films is 1920 by 1080: from -960 to 960, and from -540 to 540.
        const built = (build: (s: Stage) => void, options: { aspect?: '9:16' } = {}) => compileFilm(film({ fps: 10, ...options }, build))
        const note = () => { const made = rect(300, 80); made.label = 'note'; return made }
        const along = 'The frame is 1920 by 1080, with its middle at [0, 0]. Put it at another side of the other thing, use a smaller gap, or move the other thing away from that edge of the frame'
        // A note over a bar that is near the top of the frame.
        await expect(built((s) => { const bar = rect(200, 60).at(0, -500); s.add(bar, beside(note(), bar, 'above', 'tight')) })).rejects.toThrow(`beside: the item "note" is 82 off the frame at the top. ${along}`)
        // Each change that the message names works.
        await built((s) => { const bar = rect(200, 60).at(0, -500); s.add(bar, beside(note(), bar, 'under', 'tight')) })
        await built((s) => { const bar = rect(200, 60).at(0, -300); s.add(bar, beside(note(), bar, 'above', 'tight')) })
        await built((s) => { const bar = rect(200, 60).at(0, -430); s.add(bar, beside(note(), bar, 'above', 'none')) })
        // At the left and at the bottom. Half a pixel is not off the frame.
        await expect(built((s) => { s.add(beside(note(), rect(100, 100).at(-800, 480), 'left', 'none')) })).rejects.toThrow('beside: the item "note" is 190 off the frame at the left. ')
        await expect(built((s) => { s.add(beside(note(), rect(100, 100).at(700, 480), 'under', 'tight')) })).rejects.toThrow('beside: the item "note" is 82 off the frame at the bottom. ')
        await built((s) => { s.add(beside(note(), [960.4 - 300, 0], 'right', 'none')) })
        // Off the frame across the side: a note over a thing at the left edge, with its middle on the middle of the thing.
        await expect(built((s) => { s.add(beside(note(), rect(100, 60).at(-900, 0), 'above', 'tight')) })).rejects.toThrow(
            "beside: the item \"note\" is 90 off the frame at the left. The frame is 1920 by 1080, with its middle at [0, 0]. Line up an edge in place of the middle, with 'left' or 'right' as the last argument, make the item smaller, or move the other thing away from that edge of the frame")
        await built((s) => { s.add(beside(note(), rect(100, 60).at(-900, 0), 'above', 'tight', 'left')) })
        // A region that reaches over the frame.
        await expect(built((s) => { s.add(place(note(), new Box(700, -100, 1200, 100), 'right')) })).rejects.toThrow(
            'place: the item "note" is 240 off the frame at the right. The frame is 1920 by 1080, with its middle at [0, 0]. The region reaches over the frame there: use a region that is inside the frame')
        await built((s) => { s.add(place(note(), new Box(600, -100, 1200, 100), 'left')) })
        // A scene builds a picture in steps. Here the note is off the frame until the scene places the whole picture.
        await built((s) => {
            const cells = row([rect(800, 60), rect(800, 60)], { gap: 'none' }), name = beside(note(), cells, 'left', 'tight')
            expect(boxOf(name).left).toBe(-1112)
            s.add(place([cells, name], new Box(-960, -300, 960, 300)))
            expect(boxOf(name).left).toBe(-956)
        })
        // A node that the film does not show is not in the picture.
        await built(() => { beside(note(), rect(200, 60).at(0, -500), 'above', 'tight') })
        // A node that arrives later is checked at the place that it has then.
        await expect(built((s) => { const bar = rect(200, 60).at(0, -500), late = beside(note(), bar, 'above', 'tight'); s.add(bar); s.wait(2); s.play(fadeIn(late)) })).rejects.toThrow('beside: the item "note" is 82 off the frame at the top.')
        await built((s) => { const bar = rect(200, 60).at(0, -500), late = beside(note(), bar, 'above', 'tight'); s.add(bar); late.shift(0, 100); s.wait(2); s.play(fadeIn(late)) })
        // A node that is on the stage and hidden: it moves into the frame before it arrives, so it is in the frame when a viewer sees it.
        await built((s) => { const bar = rect(200, 60).at(0, -500), hidden = note().hide(); s.add(bar, hidden); beside(hidden, bar, 'above', 'tight'); s.wait(2); hidden.shift(0, 100); s.play(fadeIn(hidden)) })
        await expect(built((s) => { const bar = rect(200, 60).at(0, -500), hidden = note().hide(); s.add(bar, hidden); beside(hidden, bar, 'above', 'tight'); s.wait(2); s.play(fadeIn(hidden)) })).rejects.toThrow('beside: the item "note" is 82 off the frame at the top.')
        // Inside `to`, the node is on the stage: the check is at once.
        await expect(built((s) => { const bar = rect(200, 60).at(0, -500), made = note(); s.add(bar, made); s.play(to(made, () => beside(made, bar, 'above', 'tight'))) })).rejects.toThrow(`beside: the item "note" would be 82 off the frame at the top. ${along}`)
        // A film whose camera moves has pictures that are all off the first frame. The layout works there with no error.
        await built((s) => { const far = rect(200, 60).at(3000, 0); s.add(far, beside(note(), far, 'right', 'tight'), place(note(), new Box(2000, 1000, 2600, 1400))) })
        // A film of another size has another frame.
        await expect(built((s) => { s.add(beside(note(), rect(100, 100).at(450, 0), 'right', 'tight')) }, { aspect: '9:16' })).rejects.toThrow('is 272 off the frame at the right. The frame is 1080 by 1920')
        await built((s) => { s.add(beside(note(), rect(100, 100).at(0, 800), 'under', 'tight')) }, { aspect: '9:16' })
        // Outside a film, no frame is known.
        expect(boxOf(beside(note(), rect(100, 100).at(900, 0), 'right', 'tight')).left).toBe(962)
    })

    it('moves a node that is inside a scaled group by a stage distance', () => {
        const inner = rect(40, 40), holder = group(inner).at(500, 0)
        holder.scale(2)
        place(inner, new Box(0, 0, 100, 100))
        expect(edges(boxOf(inner))).toEqual([10, 10, 90, 90])
    })

    it('measures an object of the library, such as a chip, by its border', async () => {
        await inFilm(() => {
            const made = chip('virtio')
            expect(boxOf(made).width).toBeCloseTo(made.box.width, 0)
            expect(boxOf(made).height).toBeCloseTo(made.box.height, 0)
        })
    })

    it('gives the box of a lane of a lanes object, and builds the object to the width of a region', async () => {
        await inFilm(() => {
            const region = new Box(-500, -300, 500, 300)
            const build = (width: number) => lanes(['a', 'long name'], [{ lane: 'a', start: 0, end: 4 }, { from: 'a', to: 'long name', at: 4 }, { lane: 'long name', start: 4, end: 10 }], { width, barHeight: 40 })
            const flow = place(fitted(region, build), region, 'top')
            // All of the object is as wide as the region: its names are in that width.
            expect(boxOf(flow).width).toBeCloseTo(1000, 0)
            expect(boxOf(build(1000)).width).toBeGreaterThan(1100)
            expect(boxOf(flow).top).toBeCloseTo(-300, 6)
            const lane = flow.region({ lane: 'long name', from: 4, to: 10 })
            expect(lane.height).toBeCloseTo(40, 6)
            expect(lane.width).toBeCloseTo(flow.region().width * 0.6, 6)
            expect(flow.region({ between: ['a', 'long name'] }).top).toBeCloseTo(flow.region({ lane: 'a' }).bottom, 6)
            expect(flow.region({ lane: 0, at: 4 }).width).toBe(0)
            // The box follows the object.
            const before = flow.region({ lane: 'a' }).top
            flow.shift(0, 100)
            expect(flow.region({ lane: 'a' }).top).toBeCloseTo(before + 100, 6)
            expect(() => flow.region({ lane: 'b' })).toThrow('lanes: no lane "b"')
            expect(() => flow.region({ lane: 'a', between: ['a', 'long name'] })).toThrow('lanes: region takes `lane` or `between`, not both')
            expect(() => fitted(new Box(0, 0, 60, 100), build)).toThrow(/^fitted: the parts beside the plot are ([\d.]+) wide, and the region is 60 wide, so no width is left for the plot\. Give a region that is wider than \1, or make the parts beside the plot narrower, such as shorter names$/)
            // A time that the lanes do not have is outside the object, and so is a part with a name that the call does not have.
            expect(() => flow.region({ at: 500 })).toThrow('lanes: region: a time is 500. `from`, `to` and `at` are times of the domain, 0 to 10')
            expect(() => flow.region({ from: 8, to: 2 })).toThrow('lanes: region: `from` is 8 and `to` is 2. Give a `from` that is not after `to`')
            expect(() => flow.region({ lanes: 'a' } as object)).toThrow('lanes: region has no part "lanes". Its parts are: lane, between, from, to, at, event')
            expect(() => flow.region({ at: 4, to: 6 })).toThrow('lanes: region takes `at` for one time, or `from` and `to` for a stretch of time, not both')
        })
    })

    it('animates a block that is placed again inside `to`', async () => {
        const a = rect(40, 40, { fill: 'blue' }), b = rect(40, 40, { fill: 'red' })
        const made = row([a, b], { gap: 'none' })
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            s.add(a, b)
            s.play(to(a, () => place(made, new Box(100, 100, 300, 300), 'top left'), { duration: 1 }))
        }))
        const left = (time: number, node: unknown) => { const op = (compiled.frame(time).ops as PathOp[]).find((item) => item.node === node)!; return Math.min(...Array.from(op.path[0]!.p).filter((_, i) => i % 2 === 0)) }
        expect(left(0, a)).toBeCloseTo(920, 0)
        expect(left(1, a)).toBeCloseTo(1060, 0)
        expect(left(1, b)).toBeCloseTo(1100, 0)
    })
})

describe('a block of the layout where a call takes a node', () => {
    // The exported functions of `vizmatic/stage` whose parameters take a node, a list of nodes or a target, as
    // the type checker lists them, with `to` and `card`. Each one is in one of the two tables below.
    const TAKES_A_NODE = ['group', 'buildOps', 'boxOf', 'place', 'beside', 'between', 'fitted', 'draw', 'write', 'erase', 'fadeIn', 'fadeOut', 'grow', 'appear', 'vanish', 'to', 'moveTo', 'shift', 'scaleBy',
        'rotate', 'recolor', 'fade', 'along', 'warp', 'applyMatrix', 'morph', 'morphMatching', 'indicate', 'shake', 'circumscribe', 'flash', 'ripple', 'pulse', 'applyComplex', 'riemann', 'areaUnder', 'tangentLine',
        'secantLine', 'dashedGuides', 'braceLabel', 'surroundingBox', 'morphCode', 'connector', 'callout', 'typewriter', 'wipe', 'countUp', 'spin', 'swap', 'highlightSweep', 'spotlight', 'zone', 'label3d', 'card']
    const region = new Box(-300, -200, 300, 200), upper = new Box(-300, -500, 300, -300)
    const made = () => place(row([rect(60, 60, { fill: 'blue' }), rect(60, 60, { fill: 'red' })], { gap: 'none' }), region)
    const any = (value: unknown) => value as never

    /** A call with a block that works: the block stands for its nodes. Each call gets its own block, on its own stage. */
    const WORKS: Record<string, (s: Stage) => unknown> = {
        group: () => expect(group(made()).children).toHaveLength(2),
        boxOf: () => expect(boxOf(made()).width).toBe(120),
        place: () => expect(place(made(), upper).box.cy).toBe(-400),
        beside: () => expect(beside(made(), [0, 0], 'right', 'none').box.left).toBe(0),
        between: () => expect(between(made(), place(made(), upper)).height).toBe(340),
        fitted: () => expect(boxOf(fitted(made(), (width) => rect(width, 10))).width).toBe(120),
        // An end of a connector can be a block: the line meets the middle of the edge of its box that faces the other end.
        // The block is 120 by 60 around the middle of the stage, and the node is 400 to its right.
        connector: () => {
            const block = made()
            const line = V.connector(block, rect(60, 60).at(400, 0), { route: 'straight', gap: 0 })
            expect(line.pointNow(0)).toEqual([60, 0])
            expect(line.pointNow(1)).toEqual([370, 0])
            // The line follows the block when the layout moves it.
            V.place(block, new V.Box(-400, -300, 400, 300), 'left')
            expect(line.pointNow(0)).toEqual([-280, 0])
        },
        'connector, the second end': () => {
            const line = V.connector(rect(60, 60).at(0, -400), made(), { route: 'straight', gap: 4 })
            expect(line.pointNow(1)).toEqual([0, -34])
            // The line is tied to each node of the block, so the film check does not judge their text against it.
            expect(line.data['attached']).toHaveLength(3)
        },
        draw: (s) => s.play(V.draw(any(made()))),
        write: (s) => s.play(V.write(any(made()))),
        erase: (s) => { const b = made(); s.add(b); s.play(V.erase(any(b))) },
        fadeIn: (s) => s.play(V.fadeIn(made())),
        fadeOut: (s) => { const b = made(); s.add(b); s.play(V.fadeOut(b)) },
        grow: (s) => s.play(V.grow(made())),
        appear: (s) => s.play(V.appear(made())),
        vanish: (s) => { const b = made(); s.add(b); s.play(V.vanish(b)) },
        warp: (s) => s.play(V.warp(made(), (x, y) => [x, y + 10])),
        applyMatrix: (s) => s.play(V.applyMatrix(made(), [[1, 0], [0, 2]])),
        morph: (s) => { const b = made(); s.add(b); s.play(V.morph(b, place(made(), upper))) },
        indicate: (s) => { const b = made(); s.add(b); s.play(V.indicate(b)) },
        typewriter: (s) => s.play(V.typewriter(row([text('ab'), text('cd')]))),
        wipe: (s) => s.play(V.wipe(made())),
        highlightSweep: (s) => { const b = row([text('ab'), text('cd')]); s.add(b); s.play(V.highlightSweep(b)) },
        spotlight: (s) => { const b = made(), rest = rect(10, 10).at(500, 0); s.add(b, rest); s.play(V.spotlight(b, { keep: made() })) },
        braceLabel: () => expect(V.braceLabel(made(), 'x').bounds().width).toBeGreaterThan(100),
        surroundingBox: () => expect(V.surroundingBox(made(), { pad: 10 }).bounds().width).toBeCloseTo(140, 0),
        zone: (s) => { const z = V.zone(made(), { title: 'zone' }); s.add(z); expect(z.bounds().width).toBeGreaterThan(120) },
        // The guide writes this call: a block that is placed again inside `to` moves each of its nodes.
        to: (s) => { const b = made(); s.add(b); s.play(to(b, (same) => place(same, upper))); expect([b.box.cy, b.box.width]).toEqual([-400, 120]) },
        moveTo: (s) => {
            const b = made(), dot = rect(10, 10)
            s.add(b, dot)
            s.play(V.moveTo(b, [100, 50]))
            expect([b.box.cx, b.box.cy, b.box.width]).toEqual([100, 50, 120])
            s.play(V.moveTo(dot, b))
            expect(boxOf(dot).cx).toBeCloseTo(100, 6)
            s.play(V.moveTo(b, place(made(), upper)))
            expect(b.box.cy).toBeCloseTo(-400, 6)
        },
        shift: (s) => { const b = made(); s.add(b); s.play(V.shift(b, 20, 5)); expect([b.box.left, b.box.top]).toEqual([-40, -25]) },
        // A block scales and turns as one thing, about its middle.
        scaleBy: (s) => { const b = made(); s.add(b); s.play(V.scaleBy(b, 2)); expect([b.box.left, b.box.right, b.box.top]).toEqual([-120, 120, -60]) },
        rotate: (s) => { const b = made(), first = b.nodes[0]!; s.add(b); s.play(V.rotate(b, Math.PI)); expect(boxOf(first).cx).toBeCloseTo(30, 6); expect(b.box.width).toBeCloseTo(120, 6) },
        recolor: (s) => { const b = made(); s.add(b); s.play(V.recolor(b, 'green')); expect(b.nodes[0]!.get('fill')).toEqual(b.nodes[1]!.get('fill')) },
        fade: (s) => { const b = made(); s.add(b); s.play(V.fade(b, 0.5)); expect(b.nodes.map((node) => node.get('opacity'))).toEqual([0.5, 0.5]) },
    }

    /** A call that takes one node, or one object of a kind: with a block it stops, and the message says what to give. */
    const STOPS: Record<string, (s: Stage) => unknown> = {
        along: () => { V.along(any(made()), [[0, 0], [100, 0]] as never); },
        'along, the track': () => V.along(rect(10, 10), any(made())),
        morphMatching: () => V.morphMatching(any(made()), rect(10, 10)),
        'morphMatching, the second': () => V.morphMatching(rect(10, 10), any(made())),
        shake: () => V.shake(any(made())),
        circumscribe: () => V.circumscribe(any(made())),
        flash: () => V.flash(any(made())),
        ripple: () => V.ripple(any(made())),
        pulse: () => V.pulse(any(made())),
        spin: () => V.spin(any(made()), 1),
        swap: () => V.swap(any(made()), rect(10, 10)),
        'swap, the second': () => V.swap(rect(10, 10), any(made())),
        callout: () => V.callout(any(made()), 'words'),
        label3d: () => V.label3d(any(made()), [0, 0, 0]),
        card: () => V.card({ title: 'card', figure: any(made()) }),
        riemann: () => V.riemann(any(made()), (x) => x),
        areaUnder: () => V.areaUnder(any(made()), (x) => x),
        tangentLine: () => V.tangentLine(any(made()), (x) => x, 1),
        secantLine: () => V.secantLine(any(made()), (x) => x, 0, 1),
        dashedGuides: () => V.dashedGuides(any(made()), 1, 1),
        applyComplex: () => V.applyComplex(any(made()), (re, im) => [re, im]),
        morphCode: () => V.morphCode(any(made()), any(made())),
        countUp: () => V.countUp(any(made()), 3),
        buildOps: () => V.buildOps(any(made()), { x: 0, y: 0, zoom: 1, rotation: 0 }, 100, 100),
        's.play': (s) => s.play(any(made())),
        's.update': (s) => s.update(any(made()), () => {}),
        's.mountAt': (s) => s.mountAt(any(made()), 0),
    }

    it('works where a film gives a node or a list of nodes: the block stands for its nodes', async () => {
        for (const [name, call] of Object.entries(WORKS)) {
            await compileFilm(film({ fps: 10 }, (s) => {
                // The first text of a film loads its font: the film stops there, and starts again with the font.
                text('font')
                try { call(s) } catch (error) { if ((error as { isVizmaticSuspend?: boolean }).isVizmaticSuspend) throw error; throw new Error(`${name} with a block: ${(error as Error).message}`) }
            }))
        }
    })

    it('stops where a call takes one node or one object, and says what to give', async () => {
        await compileFilm(film({ fps: 10 }, (s) => {
            for (const [name, call] of Object.entries(STOPS)) {
                expect(() => call(s), name).toThrow(name === 'buildOps' ? 'buildOps: the root is not a node. Give one node' : /^[a-zA-Z.3]+: [a-z0-9 ]+ is a block of the layout[,.]/)
            }
            // The message names the call, the argument, and what to give.
            // An end of a connector is a node, a block or a point, and another value has a message.
            expect(() => V.connector(any('title'), rect(10, 10))).toThrow('connector: the first end is the string "title". Give a node, a block of the layout, or a point [x, y] of the stage')
            expect(() => V.spin(any(made()), 1)).toThrow('spin: the first argument is a block of the layout, and here spin takes one node. Give one node of the block, such as block.nodes[0], or the block as one group: group(block)')
            expect(() => V.riemann(any(made()), (x) => x)).toThrow('riemann: the first argument is a block of the layout. Give a pair of axes, such as axes()')
            expect(() => s.play(any(made()))).toThrow('s.play: argument 0 is a block of the layout, and play takes animations. Give an animation of it, such as fadeIn(block), or put it on the stage with s.add')
            // A value that is not a node and not a block has a message too.
            expect(() => V.fadeIn(any(undefined))).toThrow('an animation: the target is undefined. Give a node, a block of the layout, or a list of them')
            expect(() => to(any('title'), () => {})).toThrow('to: the first argument is the string "title". Give a node, a block of the layout, or a list of them')
            expect(() => V.zone(any([rect(10, 10), 5]))).toThrow('zone: the content[1] is the value 5. Give a node, a block of the layout, or a list of them')
        }))
    })

    it('has every export that takes a node in one of the two tables', () => {
        const tested = new Set([...Object.keys(WORKS), ...Object.keys(STOPS)].map((name) => name.split(',')[0]))
        expect(TAKES_A_NODE.filter((name) => !tested.has(name))).toEqual([])
        // Each name is an export of the stage.
        expect(TAKES_A_NODE.filter((name) => typeof (V as Record<string, unknown>)[name] !== 'function')).toEqual([])
    })

    it('lets a node take a block where it takes another node', () => {
        const b = made(), dot = rect(10, 10)
        expect(boxOf(dot.moveTo(b)).cx).toBe(0)
        expect(boxOf(dot.nextTo(b, 'right', 10)).left).toBe(70)
        expect(boxOf(dot.alignTo(b, 'top')).top).toBe(-30)
        const holder = rect(1, 1).add(made(), rect(5, 5))
        expect(holder.children).toHaveLength(3)
        expect(() => dot.moveTo(any('middle'))).toThrow('moveTo: the target is "middle". Give a node, a block of the layout, or a point [x, y] of the stage')
        expect(() => dot.nextTo(any([0 / 0, 0]))).toThrow('nextTo: the target is the point [NaN, 0], which is not a place')
        expect(() => group(any(5))).toThrow('add: a child is 5. Give nodes, or blocks of the layout')
    })
})

const word = (said: string, start: number) => ({ text: said, start, end: start + 0.3 })
// Scene one is from 1 to 6: beat 0 from 1 to 4, and beat 1 from 4 to 6. Scene two is from 6.4 to 8.4.
const timing: TimingFile = {
    intro: 0.5, lead: 1, gap: 0.4, tail: 0.5,
    scenes: [
        { id: 'one', beats: [{ say: 'Latency climbs. Should we page?', duration: 3, words: [word('Latency', 0.2), word('climbs.', 0.7), word('Should', 1.8), word('we', 2.1), word('page?', 2.2)] }, { say: 'One pass.', duration: 2, words: [word('One', 0.1), word('pass.', 0.4)] }] },
        { id: 'two', beats: [{ say: 'One pass.', duration: 2, words: [word('One', 0.1), word('pass.', 0.4)] }] },
    ],
}
// The voice says "the page" two times in beat 0, and "is" in beat 0 and in beat 1. The scene is from 1 to 7.
const twice: TimingFile = {
    intro: 0.5, lead: 1, gap: 0.4, tail: 0.5,
    scenes: [{
        id: 'one', beats: [
            { say: 'The page is slow. Keep the page.', duration: 3, words: [word('The', 0.1), word('page', 0.4), word('is', 0.7), word('slow.', 1.0), word('Keep', 1.6), word('the', 1.9), word('page.', 2.2)] },
            { say: 'The cache is fast.', duration: 2, hold: 1, words: [word('The', 0.1), word('cache', 0.4), word('is', 0.7), word('fast.', 1.0)] },
        ],
    }],
}

/** The opacity that a frame draws a node with, or 0 when the frame does not draw it. */
function shown(frame: { ops: readonly unknown[] }, node: unknown): number {
    const op = (frame.ops as PathOp[]).find((item) => item.kind === 'path' && item.node === node)
    return op ? Math.max(op.fillAlpha, op.strokeAlpha) : 0
}
/** A dot, with a name for the messages. */
const dot = (color: string, name = '') => { const made = circle(10, { fill: color }); made.label = name; return made }
const onClockOf = (voice: TimingFile) => (build: (c: SceneClock, s: Stage) => void) => compileFilm(film({ fps: 20 }, (s) => build(narration(s, voice).scene('one'), s)))
const onClock = onClockOf(timing)

describe('the clock of a scene: show, hide and swap', () => {
    it('shows a node 0.1 seconds before its phrase, with a fade of 0.3 seconds', async () => {
        const mark = dot('blue')
        const compiled = await onClock((c) => { c.show('should we page', mark) })
        // The phrase starts at 1 + 1.8. The fade runs from 2.7 to 3.0.
        expect(compiled.clips.some((clip) => Math.abs(clip.t0 - 2.7) < 1e-9 && Math.abs(clip.t1 - 3.0) < 1e-9)).toBe(true)
        expect(shown(compiled.frame(2.65), mark)).toBe(0)
        expect(shown(compiled.frame(2.85), mark)).toBeGreaterThan(0)
        expect(shown(compiled.frame(3.05), mark)).toBeCloseTo(1, 6)
    })

    it('takes a lead and a fade for the one cue that differs', async () => {
        const early = dot('blue')
        const compiled = await onClock((c) => { c.show('should we page', early, { lead: 0.5, fade: 1 }) })
        expect(shown(compiled.frame(2.25), early)).toBe(0)
        expect(shown(compiled.frame(2.8), early)).toBeGreaterThan(0)
        expect(shown(compiled.frame(2.8), early)).toBeLessThan(1)
        expect(shown(compiled.frame(3.35), early)).toBeCloseTo(1, 6)
    })

    it('stops on a phrase that the voice says two times, names the beats, and takes a longer phrase or the beat', async () => {
        const mark = dot('blue')
        const on = onClockOf(twice)
        // Two times in one beat: a longer phrase picks one.
        // The first place has words after it: the longer phrase starts at the same word. The second place is the end of
        // its beat: the longer phrase has a word before it, and the message says how much earlier it starts.
        const inOneBeat = 'narration: scene "one": the voice says "the page" 2 times: in beat 0 at 1.1 s and in beat 0 at 2.9 s. Use a longer phrase: "the page is" for the one at 1.1 s; "keep the page" for the one at 2.9 s, which starts 0.3 s earlier'
        await expect(on((c) => { c.show('the page', mark) })).rejects.toThrow(new RegExp(`^${inOneBeat}$`))
        await expect(on((c) => { c.show('the page', mark, { beat: 0 }) })).rejects.toThrow(new RegExp(`^${inOneBeat}$`))
        // In two beats: a longer phrase, or the beat.
        const inTwoBeats = 'narration: scene "one": the voice says "is" 2 times: in beat 0 at 1.7 s and in beat 1 at 4.7 s. Use a longer phrase: "is slow" for the one at 1.7 s; "is fast" for the one at 4.7 s. Or name the beat: the option `beat` of show, hide and swap, and the last argument of on and after'
        await expect(on((c) => { c.show('is', mark) })).rejects.toThrow(inTwoBeats)
        await expect(on((c) => { c.hide('is', mark) })).rejects.toThrow(inTwoBeats)
        // `on`, `after` and `cue` agree with `show`.
        await expect(on((c) => { c.on('is', () => {}) })).rejects.toThrow(inTwoBeats)
        await expect(on((c) => { c.after('is', () => {}) })).rejects.toThrow(inTwoBeats)
        await expect(on((c) => { c.cue('the') })).rejects.toThrow('the voice says "the" 3 times: in beat 0 at 1.1 s, in beat 0 at 2.9 s and in beat 1 at 4.1 s. Use a longer phrase: "the page is" for the one at 1.1 s; "keep the" for the one at 2.9 s, which starts 0.3 s earlier; "the cache" for the one at 4.1 s')
        // One more word before the words is not enough here: the voice says "the page" two times, so the phrase has two.
        await expect(on((c) => { c.show('page', mark) })).rejects.toThrow('the voice says "page" 2 times: in beat 0 at 1.4 s and in beat 0 at 3.2 s. Use a longer phrase: "page is" for the one at 1.4 s; "keep the page" for the one at 3.2 s, which starts 0.6 s earlier')
        // Each phrase of the message is said one time, and the first one keeps the time of the cue.
        await on((c) => { expect([c.cue('the page is').start, c.cue('keep the page').start, c.cue('keep the').start]).toEqual([1.1, 2.6, 2.6]) })
        // A phrase that is the whole of two beats has no longer phrase: the beat picks one.
        const same = { ...twice, scenes: [{ id: 'one', beats: [{ say: 'One pass.', duration: 2, words: [word('One', 0.1), word('pass.', 0.4)] }, { say: 'One pass.', duration: 2, words: [word('One', 0.1), word('pass.', 0.4)] }] }] }
        await expect(onClockOf(same)((c) => { c.show('one pass', mark) })).rejects.toThrow('the voice says "one pass" 2 times: in beat 0 at 1.1 s and in beat 1 at 3.1 s. No longer phrase picks one of them. Name the beat: the option `beat` of show, hide and swap, and the last argument of on and after')
        // One of two beats has one more word: a longer phrase picks that one, and no longer phrase picks the other.
        const more = { ...twice, scenes: [{ id: 'one', beats: [{ say: 'One pass.', duration: 2, words: [word('One', 0.1), word('pass.', 0.4)] }, { say: 'One pass more.', duration: 2, words: [word('One', 0.1), word('pass', 0.4), word('more.', 0.7)] }] }] }
        await expect(onClockOf(more)((c) => { c.show('one pass', mark) })).rejects.toThrow('Use a longer phrase: "one pass more" for the one at 3.1 s. No longer phrase picks the one at 1.1 s. Or name the beat: the option `beat` of show, hide and swap, and the last argument of on and after')
        // The beat picks the phrase of that beat: "is" starts at 4.7 in beat 1, and at 1.7 in beat 0.
        const late = dot('blue'), early = dot('red'), long = dot('green'), built: number[] = []
        const compiled = await on((c, s) => {
            c.show('is', late, { beat: 1 })
            c.show('is', early, { beat: 0 })
            c.show('keep the page', long)
            c.on('is', () => built.push(s.time), 0, 1)
            // `after` runs at the end of the phrase in its beat: "is" ends at 5 in beat 1, and at 2 in beat 0.
            c.after('is', () => built.push(s.time), 0, 1)
            c.after('is', () => built.push(s.time), 0, 0)
            expect(c.cue('is', 1).start).toBeCloseTo(4.7, 6)
        })
        expect(built.slice(1).map((time) => Math.round(time * 100) / 100)).toEqual([5, 2])
        expect([shown(compiled.frame(4.55), late), shown(compiled.frame(4.95), late)]).toEqual([0, 1])
        expect([shown(compiled.frame(1.55), early), shown(compiled.frame(1.95), early)]).toEqual([0, 1])
        expect([shown(compiled.frame(2.45), long), shown(compiled.frame(2.85), long)]).toEqual([0, 1])
        expect(built[0]).toBeCloseTo(4.7, 6)
        // The beat is for a phrase. With a beat as the cue, it has no job.
        await expect(on((c) => { c.show(1, mark, { beat: 1 }) })).rejects.toThrow('show: the cue is the beat 1, so the option `beat` has no job. It picks the beat of a spoken phrase')
    })

    it('staggers a list, and brings a list inside the list and a block of the layout as one item', async () => {
        const a = dot('blue'), b = dot('red'), c1 = dot('green'), c2 = dot('teal'), d1 = dot('orange'), d2 = dot('purple')
        const compiled = await onClock((c) => { c.show('Latency', [a, b, [c1, c2], row([d1, d2])], { stagger: true }) })
        // 'Latency' starts at 1.2, so the items start at 1.1, 1.4, 1.7 and 2.0.
        expect([a, b, c1, c2, d1, d2].map((node) => shown(compiled.frame(1.3), node) > 0)).toEqual([true, false, false, false, false, false])
        expect([a, b, c1, c2, d1, d2].map((node) => shown(compiled.frame(1.9), node) > 0)).toEqual([true, true, true, true, false, false])
        expect([d1, d2].map((node) => shown(compiled.frame(2.35), node))).toEqual([1, 1])
        const slow = dot('blue'), last = dot('red')
        const other = await onClock((c) => { c.show('Latency', [slow, last], { stagger: 1 }) })
        expect(shown(other.frame(2.05), last)).toBe(0)
        expect(shown(other.frame(2.45), last)).toBeCloseTo(1, 6)
        // A block that is not in a list is one item: its nodes arrive at one moment.
        const e1 = dot('blue'), e2 = dot('red')
        const block = await onClock((c) => { c.show('Latency', row([e1, e2]), { stagger: true }) })
        expect([shown(block.frame(1.45), e1), shown(block.frame(1.45), e2)]).toEqual([1, 1])
    })

    it('fits a staggered list before its scene starts to leave: the step shrinks, and a list that cannot fit stops the build', async () => {
        const dots = (count: number) => Array.from({ length: count }, () => dot('blue'))
        // 'One pass' starts at 4.1, so the list starts at 4.0. The scene starts to leave at 5.76: 1.76 seconds later.
        // The last item has its fade of 0.3 and 0.5 seconds on the screen, so the steps have 0.96 seconds.
        const four = dots(4), five = dots(5), ten = dots(10)
        const compiled = await onClock((c) => { c.show('One pass', four, { stagger: true }) })
        // Four items fit with the step of 0.3: the last one starts at 4.9.
        expect([shown(compiled.frame(4.85), four[3]), shown(compiled.frame(5.25), four[3])]).toEqual([0, 1])
        // Five items do not. The step is 0.24: they start at 4.0, 4.24, 4.48, 4.72 and 4.96.
        const fitted = await onClock((c) => { c.show('One pass', five, { stagger: true }) })
        expect(five.map((node) => shown(fitted.frame(4.6), node) > 0)).toEqual([true, true, true, false, false])
        expect(shown(fitted.frame(4.95), five[4])).toBe(0)
        expect(shown(fitted.frame(5.0), five[4])).toBeGreaterThan(0)
        // The last item is there in full half a second before the scene starts to leave.
        expect(shown(fitted.frame(5.27), five[4])).toBeCloseTo(1, 6)
        // Ten items fit with a step just over the least, 0.1 seconds. Eleven do not fit.
        const most = await onClock((c) => { c.show('One pass', ten, { stagger: true }) })
        expect(shown(most.frame(5.27), ten[9])).toBeCloseTo(1, 6)
        await expect(onClock((c) => { c.show('One pass', dots(11), { stagger: true }) })).rejects.toThrow(
            'narration: scene "one": show: 11 items one after another do not fit between "One pass" and the end of the scene. The picture of the scene starts to leave 1.76 seconds after the cue, and the list needs 1.8 at least: 0.1 for each step, 0.3 for the fade of the last item, and 0.5 to see it. Show 10 items or fewer, use an earlier phrase, or use stagger: false')
        // Each change that the message names works.
        await onClock((c) => { c.show('One pass', dots(11), { stagger: false }) })
        await onClock((c) => { c.show('Latency', dots(11), { stagger: true }) })
        // A step that the scene typed is exact: it fits, or it stops the build.
        await expect(onClock((c) => { c.show('One pass', dots(3), { stagger: 0.5 }) })).rejects.toThrow(
            'show: a stagger of 0.5 needs 1.8 seconds for 3 items, with the fade of the last item and 0.5 to see it, and the picture of the scene starts to leave 1.76 seconds after "One pass". The largest stagger that fits is 0.48. Or use stagger: true, which fits the list to the time, or an earlier phrase')
        const typed = dots(3)
        const exact = await onClock((c) => { c.show('One pass', typed, { stagger: 0.48 }) })
        expect([shown(exact.frame(4.95), typed[2]), shown(exact.frame(4.97), typed[2]) > 0]).toEqual([0, true])
        // The new items of a swap fit in the same way: they start 0.2 seconds later, so the steps have 0.76 seconds.
        const old = dot('red'), next = dots(5)
        const swapped = await onClock((c, s) => { s.add(old); c.swap('One pass', old, next, { stagger: true }) })
        expect([shown(swapped.frame(4.95), next[4]), shown(swapped.frame(4.97), next[4]) > 0]).toEqual([0, true])
    })

    it('stops on a node that would arrive when its scene leaves, and on a lead that is before the scene', async () => {
        const mark = dot('blue')
        // 'pass' starts at 4.4, and the scene starts to leave at 5.76.
        await expect(onClock((c) => { c.show('pass', mark, { lead: -1.7 }) })).rejects.toThrow(
            'narration: scene "one": show: the change at "pass" starts at 6.1 s, and its fade of 0.3 seconds ends at 6.4 s. The picture of the scene starts to leave at 5.76 s, so what arrives would never be there in full. Use an earlier phrase, or give the last beat of the scene a hold')
        // One item is a list of one: its fade fits before the scene starts to leave, or the build stops. Here it starts
        // 0.16 seconds before, so it would never be there in full.
        await expect(onClock((c) => { c.show('pass', dot('blue'), { lead: -1.2 }) })).rejects.toThrow(
            'show: the change at "pass" starts at 5.6 s, and its fade of 0.3 seconds ends at 5.9 s. The picture of the scene starts to leave at 5.76 s, so what arrives would never be there in full. Use an earlier phrase, a fade of 0.16 or less, or give the last beat of the scene a hold')
        await expect(onClock((c) => { c.show('pass', [dot('blue'), dot('red')], { lead: -1.2 }) })).rejects.toThrow('and its fade of 0.3 seconds ends at 5.9 s')
        await expect(onClock((c) => { c.show('pass', dot('blue'), { lead: -1.2, stagger: true }) })).rejects.toThrow('and its fade of 0.3 seconds ends at 5.9 s')
        // Each change that the message names works, and the item is there in full when the scene starts to leave.
        const short = dot('blue'), early = dot('red')
        const fits = await onClock((c) => { c.show('pass', short, { lead: -1.2, fade: 0.16 }); c.show('pass', early, { lead: -1.06 }) })
        expect([shown(fits.frame(5.76), short), shown(fits.frame(5.76), early)].map((value) => Math.round(value * 1e6) / 1e6)).toEqual([1, 1])
        await expect(onClock((c, s) => { s.add(mark); c.swap('pass', mark, dot('red'), { lead: -1.2 }) })).rejects.toThrow('swap: the change at "pass" starts at 5.8 s')
        // A node that leaves late does no harm.
        await onClock((c, s) => { s.add(mark); c.hide('pass', mark, { lead: -1.7 }) })
        // With no shell, a scene after the first opens when the scene before it ends: scene two at 6, and 'One' starts at 6.5 there.
        await expect(compileFilm(film({ fps: 20 }, (s) => { narration(s, timing).scene('two').show('One', dot('blue'), { lead: 3 }) }))).rejects.toThrow(
            'narration: scene "two": show: with a lead of 3, the change at "One" starts at 3.5 s, and the picture of the scene opens at 6 s. The most lead that fits is 0.5')
        // 'Latency' starts at 1.2, and the scene opens at 0.
        await expect(onClock((c) => { c.show('Latency', dot('blue'), { lead: 50 }) })).rejects.toThrow(
            'narration: scene "one": show: with a lead of 50, the change at "Latency" starts at -48.8 s, and the picture of the scene opens at 0 s. The most lead that fits is 1.2')
    })

    it('plays an animation of the list as it is, at the moment of the cue', async () => {
        const bar = rect(200, 20, { fill: 'blue' }), name = dot('red')
        const compiled = await onClock((c) => { c.show('should we page', [grow(bar, { duration: 1 }), name]) })
        const width = (time: number) => { const op = (compiled.frame(time).ops as PathOp[]).find((item) => item.node === bar); const xs = op ? Array.from(op.path[0]!.p).filter((_, i) => i % 2 === 0) : [0]; return Math.max(...xs) - Math.min(...xs) }
        expect(width(2.65)).toBe(0)
        expect(width(3.2)).toBeGreaterThan(20)
        expect(width(3.2)).toBeLessThan(200)
        expect(width(3.75)).toBeCloseTo(200, 0)
        expect(shown(compiled.frame(3.05), name)).toBeCloseTo(1, 6)
    })

    it('hides a node at its phrase, and takes the index of a beat as a cue', async () => {
        const mark = dot('blue')
        const compiled = await onClock((c, s) => {
            s.add(mark)
            c.hide(1, mark)
        })
        // Beat 1 starts at 4. The fade runs from 3.9 to 4.2.
        expect(shown(compiled.frame(3.85), mark)).toBeCloseTo(1, 6)
        expect(shown(compiled.frame(4.05), mark)).toBeLessThan(1)
        expect(shown(compiled.frame(4.05), mark)).toBeGreaterThan(0)
        expect(shown(compiled.frame(4.25), mark)).toBe(0)
    })

    it('gives a hide and a swap the fade and the stagger of their options', async () => {
        const between = (value: number) => value > 0.05 && value < 0.95
        // A hide at beat 1 starts at 3.9. With a fade of 1 and a stagger of 0.5, the second node leaves from 4.4 to 5.4.
        const a = dot('blue'), b = dot('red')
        const hidden = await onClock((c, s) => { s.add(a, b); c.hide(1, [a, b], { fade: 1, stagger: 0.5 }) })
        expect(between(shown(hidden.frame(4.4), a))).toBe(true)
        expect(shown(hidden.frame(4.35), b)).toBeCloseTo(1, 6)
        expect(between(shown(hidden.frame(4.9), b))).toBe(true)
        expect([shown(hidden.frame(4.95), a), shown(hidden.frame(5.45), b)]).toEqual([0, 0])
        // `stagger: true` is 0.3 seconds from one node to the next.
        const c1 = dot('blue'), c2 = dot('red')
        const stepped = await onClock((c, s) => { s.add(c1, c2); c.hide(1, [c1, c2], { stagger: true }) })
        expect(shown(stepped.frame(4.15), c2)).toBeCloseTo(1, 6)
        expect(between(shown(stepped.frame(4.35), c2))).toBe(true)
        // A swap at beat 1 starts at 3.9: the old node leaves from 3.9 to 4.9. The new ones start at 4.1 and at 4.6, each with a fade of 1.
        const old = dot('blue'), n1 = dot('red'), n2 = dot('green')
        const swapped = await onClockOf(twice)((c, s) => { s.add(old); c.swap(1, old, [n1, n2], { fade: 1, stagger: 0.5 }) })
        expect(between(shown(swapped.frame(4.4), old))).toBe(true)
        expect(shown(swapped.frame(4.95), old)).toBe(0)
        expect(between(shown(swapped.frame(4.6), n1))).toBe(true)
        expect(shown(swapped.frame(5.15), n1)).toBeCloseTo(1, 6)
        expect(shown(swapped.frame(4.55), n2)).toBe(0)
        expect(between(shown(swapped.frame(5.1), n2))).toBe(true)
        expect(shown(swapped.frame(5.65), n2)).toBeCloseTo(1, 6)
    })

    it('shows again a node that a cue hid', async () => {
        const mark = dot('blue')
        const compiled = await onClock((c, s) => {
            s.add(mark)
            c.hide('Latency', mark)
            c.show(1, mark)
        })
        expect(shown(compiled.frame(2), mark)).toBe(0)
        // Beat 1 starts at 4. The node is back in full 0.2 seconds after it.
        expect(shown(compiled.frame(4.25), mark)).toBeCloseTo(1, 6)
    })

    it('swaps two pictures: the old one is nearly gone when the new one starts', async () => {
        const old = dot('blue'), next = dot('green')
        const compiled = await onClock((c, s) => {
            s.add(old)
            c.swap(1, old, next)
        })
        // The old node fades from 3.9 to 4.2, and the new one from 4.1 to 4.4.
        expect(shown(compiled.frame(4.05), old)).toBeGreaterThan(0)
        expect(shown(compiled.frame(4.05), next)).toBe(0)
        expect(shown(compiled.frame(4.25), old)).toBe(0)
        expect(shown(compiled.frame(4.45), next)).toBeCloseTo(1, 6)
        // At no frame are both more than a quarter visible, and at no frame are both under a quarter.
        for (let time = 3.9; time <= 4.4; time += 0.05) {
            const both = [shown(compiled.frame(time), old), shown(compiled.frame(time), next)]
            expect(Math.min(...both), `both at ${time}`).toBeLessThan(0.25)
        }
        // The first picture comes back at a later cue, in full.
        const first = dot('blue'), second = dot('green')
        const back = await onClock((c, s) => { s.add(first); c.swap('climbs', first, second); c.swap(1, second, first) })
        expect([shown(back.frame(3), first), shown(back.frame(3), second)]).toEqual([0, 1])
        expect([shown(back.frame(4.45), first), shown(back.frame(4.45), second)]).toEqual([1, 0])
    })

    it('shows a node one time: a node in two lists, in a block and alone, or of the first picture stops the build', async () => {
        // Each film has its own nodes: a node is on one stage.
        let a = dot('blue', 'A'), b = dot('red', 'B'), d = dot('green', 'D')
        const onClock = (build: (c: SceneClock, s: Stage) => void) => { a = dot('blue', 'A'); b = dot('red', 'B'); d = dot('green', 'D'); return onClockOf(timing)(build) }
        const twoCues = (first: string, second: string) => `narration: scene "one": show: the item "B" comes with ${first} and with ${second}. A node shows one time. Leave it out of one of the two lists, or hide it between the two cues with c.hide. To bring the rest of a list and skip the nodes that show already, pass { skipShown: true }`
        // Two lists of one cue that share a node.
        await expect(onClock((c) => { c.show('Latency', [a, b]); c.show('Latency', [b, d]) })).rejects.toThrow(twoCues('"Latency"', '"Latency"'))
        // A block, and one node of it alone. The order of the two calls does not count.
        await expect(onClock((c) => { c.show('climbs', row([a, b])); c.show('should we page', b) })).rejects.toThrow(twoCues('"climbs"', '"should we page"'))
        await expect(onClock((c) => { c.show('should we page', b); c.show('climbs', row([a, b])) })).rejects.toThrow(twoCues('"should we page"', '"climbs"'))
        await expect(onClock((c) => { c.show(1, [a, b, b]) })).rejects.toThrow(twoCues('beat 1', 'beat 1'))
        await expect(onClock((c, s) => { s.add(d); c.swap(1, d, b); c.show('climbs', b) })).rejects.toThrow('show: the item "B" comes with beat 1 and with "climbs"')
        // A node of the first picture.
        await expect(onClock((c, s) => { s.add(a); c.show('climbs', row([a, b])) })).rejects.toThrow(
            'narration: scene "one": show: the item "A" shows already at "climbs": the scene put it on the stage before, with s.add or with a play of its own. A node shows one time. Leave it out of the list. To bring the rest of a list and skip the nodes that show already, pass { skipShown: true }')
        // The scene adds the node after the call. The check at the end of the build sees it.
        await expect(onClock((c, s) => { c.show('climbs', row([a, b])); s.add(a) })).rejects.toThrow(
            'narration: scene "one": show: the item "A" shows already at "climbs": the scene puts it on the stage, with s.add or with a play of its own. A node shows one time. Leave it out of the list, or out of s.add. With { skipShown: true }, call s.add before the cue')
    })

    it('brings the rest of a block with skipShown, and leaves a node that shows already as it is, with no blink', async () => {
        const title = dot('blue', 'title'), x = dot('red', 'x'), y = dot('green', 'y'), early = dot('teal', 'early')
        const compiled = await onClock((c, s) => {
            s.add(title)
            c.show('Latency', early)
            // 'climbs' starts at 1.7: the rest of the block arrives from 1.6 to 1.9.
            c.show('climbs', row([title, early, x, y]), { skipShown: true })
        })
        for (const time of [1.5, 1.6, 1.61, 1.65, 1.75, 1.9, 2]) {
            expect(shown(compiled.frame(time), title), `the title at ${time}`).toBeCloseTo(1, 6)
            expect(shown(compiled.frame(time), early), `the early node at ${time}`).toBeCloseTo(1, 6)
        }
        expect([x, y].map((node) => shown(compiled.frame(1.55), node))).toEqual([0, 0])
        expect([x, y].map((node) => shown(compiled.frame(1.95), node))).toEqual([1, 1])
        // A list with nothing left to bring is a mistake.
        await expect(onClock((c, s) => { s.add(title); c.show('climbs', [title], { skipShown: true }) })).rejects.toThrow('show: every node of the list shows already at "climbs", so the call has nothing to bring. Remove the call, or use an earlier phrase')
        await expect(onClock((c, s) => { s.add(title); c.hide('climbs', title, { skipShown: true } as object) })).rejects.toThrow('hide has no option "skipShown". Its options are: beat, lead, fade, stagger')
    })

    it('stops on a hide of a node that is not on the screen, and on a fade that meets another fade of the node', async () => {
        const a = dot('blue', 'A')
        await expect(onClock((c) => { c.hide('climbs', a) })).rejects.toThrow('narration: scene "one": hide: the item "A" is not on the screen at "climbs". Put it on the stage before the cue, with s.add or with c.show, or leave it out of the list')
        await expect(onClock((c, s) => { s.add(a); c.hide('Latency', a); c.hide('climbs', a) })).rejects.toThrow('hide: the item "A" is not on the screen at "climbs": "Latency" hides it before. Leave it out of one of the two lists')
        // The scene may add the node after the call: the check runs when the scene is built.
        const late = dot('red')
        const compiled = await onClock((c, s) => { c.hide('climbs', late); s.add(late) })
        expect([shown(compiled.frame(1.55), late), shown(compiled.frame(1.95), late)]).toEqual([1, 0])
        // A hide 0.1 seconds after the show of the node, and a show 0.1 seconds after its hide: a viewer would see a blink.
        await expect(onClock((c) => { c.show('climbs', a); c.hide('climbs', a, { lead: 0 }) })).rejects.toThrow(
            'narration: scene "one": hide: the item "A" leaves with "climbs" at 1.7 s, and it fades in until 1.9 s: "climbs" brings it. A viewer would see it blink. Use a later phrase for "climbs", or leave the node out of "climbs"')
        await expect(onClock((c, s) => { s.add(a); c.hide('climbs', a); c.show('climbs', a, { lead: 0 }) })).rejects.toThrow(
            'narration: scene "one": show: the item "A" comes back with "climbs" at 1.7 s, and it fades out until 1.9 s: "climbs" hides it. A viewer would see it blink. Use a later phrase for "climbs"')
        await expect(onClock((c, s) => { s.add(a); c.show('should we page', a); c.hide('climbs', a, { fade: 2 }) })).rejects.toThrow('hide: the item "A" leaves with "climbs" at 1.6 s, and "should we page" brings it back at 2.7 s, before its fade ends')
        // The order of the two calls does not count.
        await expect(onClock((c) => { c.hide('climbs', a, { lead: 0 }); c.show('climbs', a) })).rejects.toThrow('show: the item "A" comes with "climbs" at 1.6 s, and "climbs" hides it at 1.7 s, before its fade ends. A viewer would see it blink')
        await expect(onClock((c, s) => { s.add(a); c.hide('climbs', a); c.hide('Latency', a) })).rejects.toThrow('hide: the item "A" leaves with "Latency", and "climbs" hides it again later. Leave it out of one of the two lists')
    })

    it('stops on a cue that it cannot place, and says what to give', async () => {
        const mark = dot('blue')
        await expect(onClock((c) => { c.show('we roll back', mark) })).rejects.toThrow('scene "one": the voice never says "we roll back"')
        await expect(onClock((c) => { c.show(7, mark) })).rejects.toThrow('scene "one" has no beat 7. A cue is a spoken phrase, or the index of a beat from 0 to 1')
        await expect(onClock((c) => { c.show('Latency', [mark, undefined as unknown as Node]) })).rejects.toThrow('scene "one": show: item 1 is undefined. Give a node, a block of the layout, an animation, or a list of them')
        await expect(onClock((c) => { c.hide('Latency', []) })).rejects.toThrow('scene "one": hide has nothing to change. Give it at least one node')
        await expect(onClock((c) => { c.show('Latency', mark, { delay: 1 } as object) })).rejects.toThrow('scene "one": show has no option "delay". Its options are: beat, lead, fade, stagger, skipShown, after. For another change at a phrase, use on')
        await expect(onClock((c) => { c.swap('Latency', mark, mark, { fade: 0 }) })).rejects.toThrow('scene "one": swap: fade is 0, and it is the seconds of the fade, more than 0')
        await expect(onClock((c) => { c.show('Latency', mark, { stagger: -1 }) })).rejects.toThrow('stagger is -1, and it is true, or the seconds between two items')
        // The cue comes first.
        await expect(onClock((c) => { c.show(mark as unknown as string, 'Latency' as unknown as Node) })).rejects.toThrow("scene \"one\": show: the cue is a node or a list. The cue comes first: a spoken phrase, or the index of a beat, such as c.show('a phrase', nodes)")
        await expect(onClock((c) => { c.hide(undefined as unknown as string, mark) })).rejects.toThrow('scene "one": hide: the cue is undefined. The cue comes first')
    })

    const shell = (one: (s: Stage, c: SceneClock) => void, two: (s: Stage, c: SceneClock) => void = () => {}, voice = timing) => compileFilm(narrated({ fps: 20, timing: voice, intro: false, scenes: { one, two } }))

    it('works in the shell of a narrated film: the shell fades out what a cue showed, and leaves out what a cue hid', async () => {
        const first = dot('blue'), late = dot('red'), gone = dot('green'), second = dot('teal')
        const compiled = await shell((s, c) => {
            s.add(first)
            c.show('climbs', gone)
            c.hide('should we page', gone)
            c.show('One pass', late)
        }, (s) => { s.add(second) })
        // Scene one ends at 6. The shell fades its nodes out from 5.76 to 6.02.
        expect(shown(compiled.frame(5.7), late)).toBeCloseTo(1, 6)
        expect(shown(compiled.frame(5.7), first)).toBeCloseTo(1, 6)
        expect(shown(compiled.frame(6.05), late)).toBe(0)
        // The node that left at its phrase does not come back for a moment when the scene ends.
        for (const time of [3.5, 5.7, 5.8, 5.9, 6.0]) expect(shown(compiled.frame(time), gone)).toBe(0)
        expect(shown(compiled.frame(6.4), second)).toBeCloseTo(1, 6)
    })

    it('keeps a staggered list in its scene: no item is over the next scene', async () => {
        // Eight items on the last phrase of scene one. At 0.3 seconds each, the last two would arrive after the scene started to leave.
        const list = Array.from({ length: 8 }, () => dot('blue'))
        const compiled = await shell((_s, c) => { c.show('One pass', list, { stagger: true }) })
        expect(list.map((node) => shown(compiled.frame(5.7), node))).toEqual(list.map(() => 1))
        for (const time of [6.1, 6.5, 7, 8, 9]) expect(list.map((node) => shown(compiled.frame(time), node)), `at ${time}`).toEqual(list.map(() => 0))
    })

    it('stops in the shell when a node of a scene arrives after the scene started to leave', async () => {
        const late = dot('red', 'late')
        // A play of the scene's own, 1.9 seconds after 'One pass': at 6.0. The scene starts to leave at 5.76.
        await expect(shell((s, c) => { c.on('One pass', () => s.play(fadeIn(late, { duration: 0.2 })), 1.9) })).rejects.toThrow(
            'narrated: scene "one": the item "late" arrives at 6 seconds, and the picture of the scene starts to leave at 5.76. It would stay over the next scene. Bring it on an earlier phrase, or hold it for the next scene with c.keep')
        // Scene two opens at 5.95, and 'One' starts at 6.5 there.
        await expect(shell(() => {}, (_s, c) => { c.show('One', late, { lead: 3 }) })).rejects.toThrow(
            'narration: scene "two": show: with a lead of 3, the change at "One" starts at 3.5 s, and the picture of the scene opens at 5.95 s. The most lead that fits is 0.55')
        // The last picture stays while the sound fades, to 8.9. A node may arrive in that time.
        const tail = dot('blue')
        const compiled = await shell(() => {}, (_s, c) => { c.show('pass', tail, { lead: -1.7 }) })
        expect([shown(compiled.frame(8.45), tail), shown(compiled.frame(8.85), tail)]).toEqual([0, 1])
    })

    it('starts a change with the lead of the library when the scene opens, at the earliest', async () => {
        // With no gap, scene two opens at 5.95, and its first beat starts at 6: the lead of 0.1 would be before the scene.
        const first = dot('blue')
        const compiled = await shell(() => {}, (_s, c) => { c.show(0, first) }, { ...timing, gap: 0 })
        expect(shown(compiled.frame(5.94), first)).toBe(0)
        expect(shown(compiled.frame(6), first)).toBeGreaterThan(0)
        expect(shown(compiled.frame(6.3), first)).toBeCloseTo(1, 6)
    })

    it('keeps and takes the nodes of a block', async () => {
        const a = dot('blue'), b = dot('red'), a2 = dot('blue'), b2 = dot('red')
        const compiled = await shell((s, c) => { s.add(row([a, b])); c.keep(row([a, b])); expect([...c.kept]).toEqual([a, b]) }, (_s, c) => { row([a2, b2]); c.take(row([a2, b2])) })
        // The copies change places 0.3 seconds before the first word of scene two, at 6.1, with no fade.
        expect([shown(compiled.frame(6.05), a), shown(compiled.frame(6.05), b)]).toEqual([1, 1])
        expect([shown(compiled.frame(6.15), a2), shown(compiled.frame(6.15), b2)]).toEqual([1, 1])
        await expect(shell((_s, c) => { c.keep(undefined as unknown as Node) })).rejects.toThrow('narration: keep takes a node, a block of the layout, or a list of them')
        // `clear` fades the nodes of a block out just before the end of the scene, at 6.
        const c1 = dot('blue'), c2 = dot('red')
        const cleared = await onClock((c, s) => { s.add(row([c1, c2])); c.clear([row([c1, c2])]) })
        expect([shown(cleared.frame(5.7), c1), shown(cleared.frame(5.7), c2)]).toEqual([1, 1])
        expect(shown(cleared.frame(5.9), c2)).toBeLessThan(0.6)
        expect([shown(cleared.frame(6.05), c1), shown(cleared.frame(6.05), c2)]).toEqual([0, 0])
        await expect(onClock((c) => { c.clear([undefined as unknown as Node]) })).rejects.toThrow('narration: scene "one": clear: item 0 is undefined. Give nodes, blocks of the layout, and values')
    })
})
