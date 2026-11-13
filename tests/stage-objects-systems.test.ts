import { describe, expect, it } from 'vitest'
import { arrayCells, attentionMatrix, axes3d, barChart, boundary, callout, card, checkFilm, compileFilm, connector, crossThrough, bitField, quote, quotePair, counter, donut, dotChart, draw, dynamic, fadeIn, film, frameToSvg, fromSvg, graph, group, heatmap, highlightSweep, histogram, infoBox, lagged, labeledDot, legend, line, lineChart, linear, mixColor, morph, steps, fadeOut, indicate, neuralNet, parseColor, pathBounds, rect, samplePath, scatter, scene3d, seq, stateGrid, tag, terminal, tex, text, tokens, tree, typewriter, unitChart, write, zone, lanes, delay, par, retime, ringBuffer, appear, circumscribe, fade, flash, grow, image, linearGradient, paintFrame, pulse, ripple, spotlight, dateLine, boxOf, fitted, braceLabel, circlePath, to, type CompiledFilm, type Node, type Rgba, type Stage, decimal, label3d, TextNode, type FontFamily } from '../src/stage/index'
import { encode } from 'fast-png'
import { Resvg } from '@resvg/resvg-js'
import { clock } from '../src/stage/track'
import type { Anim } from '../src/stage/anim'
import { Suspend } from '../src/stage/stage'
import { at, compile, expectPure, paths, svgAt } from './helpers/stage-objects'

describe('terminal', () => {
    const lines = [
        { text: './one-byte', kind: 'command' as const },
        'mapped 1 GiB at 0xffff7c000000',
        'Rss before the write:      0 kB',
        'Rss after the write:       4 kB',
        'minor faults:              1',
    ]
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)
    /** The characters that a node draws, in the order of drawing. A space draws nothing. */
    const keys = (node: Node) => node.leaves().map((leaf) => leaf.data['key']).join('')
    const right = (node: Node) => node.bounds().x + node.bounds().width
    const bottom = (node: Node) => node.bounds().y + node.bounds().height
    const inside = (part: Node, whole: Node) => {
        const a = part.bounds(), b = whole.bounds()
        expect(a.x).toBeGreaterThanOrEqual(b.x - 1e-6)
        expect(a.y).toBeGreaterThanOrEqual(b.y - 1e-6)
        expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 1e-6)
        expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height + 1e-6)
    }

    it('centers the panel on its place, with the bar over the lines, the title at the left and the note at the right', async () => {
        await compileFilm(film(() => {
            const run = terminal(lines, { title: 'Host', note: 'Linux', columns: 40 }).at(100, 50)
            const frame = run.frame.bounds(), bar = run.bar.bounds()
            expect(frame.x + frame.width / 2).toBeCloseTo(100, 6)
            expect(frame.y + frame.height / 2).toBeCloseTo(50, 6)
            // The bar is at the top of the panel, inside the border, from one side to the other.
            inside(run.bar, run.frame)
            expect(bar.y - frame.y).toBeCloseTo(run.frame.get('strokeWidth') / 2, 6)
            expect(frame.width - bar.width).toBeCloseTo(run.frame.get('strokeWidth'), 6)
            // The top corners of the bar are round, with the center of the corners of the panel, so the bar
            // does not go out of the border there. Its bottom corners are square. `cut` is how far from the
            // left of a shape its outline starts at a height: the radius of a round corner, 0 for a square one.
            const large = terminal(['x'.repeat(20)], { size: 100 })
            const cut = (node: Node, height: 'top' | 'bottom') => {
                const box = pathBounds(node.get('path')!)!
                const level = height === 'top' ? box.y : box.y + box.height
                const points = samplePath(node.get('path')!, 2000).filter((point) => Math.abs(point[1] - level) < 1e-6)
                return Math.min(...points.map((point) => point[0])) - box.x
            }
            expect(cut(large.frame, 'top')).toBeGreaterThan(30)
            expect(Math.abs(cut(large.bar, 'top') - (cut(large.frame, 'top') - large.frame.get('strokeWidth') / 2))).toBeLessThan(3)
            expect(cut(large.bar, 'bottom')).toBeLessThan(3)
            for (const line of run.lines) {
                expect(line.bounds().y).toBeGreaterThan(bar.y + bar.height)
                inside(line, run.frame)
            }
            // The title and the note are in the bar, on one baseline. The title starts where the lines start,
            // and the note ends where column 40 ends.
            const title = run.title!.bounds(), note = run.note!.bounds()
            inside(run.title!, run.bar)
            inside(run.note!, run.bar)
            expect(title.y + title.height).toBeCloseTo(note.y + note.height, 0)
            expect(Math.abs(title.x - run.lines[1]!.bounds().x)).toBeLessThan(3)
            expect(Math.abs(right(run.note!) - run.toWorld(...terminal(['x'.repeat(40)]).p(0, 'right'))[0])).toBeLessThan(3)
            expect(title.x + title.width).toBeLessThan(note.x)
            // The middle of a capital letter of the bar is the middle of the bar.
            expect(title.y + title.height / 2).toBeCloseTo(bar.y + bar.height / 2, 0)
            const plain = terminal(lines)
            expect(plain.title).toBeNull()
            expect(plain.note).toBeNull()
        }))
    })

    it('puts the lines one under the other at one left edge, with the same room on all four sides', async () => {
        await compileFilm(film(() => {
            const run = terminal(['HHHHHHHHHH', 'HHHH', '', 'HHHHHHHHHH'], { size: 40 })
            const boxes = run.lines.map((line) => line.bounds())
            const frame = run.frame.bounds()
            expect(boxes[1]!.x).toBeCloseTo(boxes[0]!.x, 6)
            expect(boxes[3]!.x).toBeCloseTo(boxes[0]!.x, 6)
            // An empty line draws nothing and keeps its row.
            const step = boxes[1]!.y - boxes[0]!.y
            expect(step).toBeGreaterThan(boxes[0]!.height)
            expect(boxes[3]!.y - boxes[0]!.y).toBeCloseTo(3 * step, 6)
            // The room around the letters: a capital letter has the same space at its two sides, so the left
            // and the right are equal, and so are the top, under the bar, and the bottom, under the baseline.
            const room = { left: boxes[0]!.x - frame.x, right: frame.x + frame.width - right(run.lines[0]!), top: boxes[0]!.y - bottom(run.bar), bottom: frame.y + frame.height - bottom(run.lines[3]!) }
            expect(room.right).toBeCloseTo(room.left, 6)
            expect(room.bottom).toBeCloseTo(room.top, 6)
            // The sides have the space beside a letter more than the top: less than a tenth of the text size.
            expect(room.left - room.top).toBeGreaterThanOrEqual(0)
            expect(room.left - room.top).toBeLessThan(4)
            expect(room.top).toBeGreaterThan(20)
        }))
    })

    it('takes its width from the columns and its height from the number of lines', async () => {
        await compileFilm(film(() => {
            const glyphs = terminal(['HH']).lines[0]!.children
            const advance = glyphs[1]!.get('x') - glyphs[0]!.get('x')
            const width = (columns: number) => terminal(['x'], { columns }).frame.bounds().width
            expect(width(30) - width(20)).toBeCloseTo(10 * advance, 6)
            // Without `columns`, the panel is as wide as its longest line. The prompt is part of a command.
            expect(terminal(['x'.repeat(30), 'x']).frame.bounds().width).toBeCloseTo(width(30), 6)
            expect(terminal([{ text: 'x'.repeat(28), kind: 'command' }, 'x']).frame.bounds().width).toBeCloseTo(width(30), 6)
            const tall = terminal(['a', 'b', 'c', 'd', 'e']), short = terminal(['a', 'b'])
            const step = tall.lines[1]!.get('y') - tall.lines[0]!.get('y')
            expect(tall.frame.bounds().height - short.frame.bounds().height).toBeCloseTo(3 * step, 6)
            // The text size scales the panel and its border. The border is never thinner than 1.5, so it shows at a small size.
            expect(terminal(['x'], { columns: 30, size: 52 }).frame.bounds().width).toBeCloseTo(2 * width(30), 6)
            expect(terminal(['x'], { size: 100 }).frame.get('strokeWidth')).toBeCloseTo(7.5, 6)
            expect(terminal(['x'], { size: 10 }).frame.get('strokeWidth')).toBe(1.5)
        }))
    })

    it('draws each character in its own column, spaces included', async () => {
        await compileFilm(film(() => {
            const run = terminal(['ab', 'a  b', '   c', 'calls    errors'])
            const xs = (line: number) => run.lines[line]!.children.map((glyph) => glyph.get('x'))
            const advance = xs(0)[1]! - xs(0)[0]!
            expect(xs(1).map((x) => x / advance)).toEqual([0, 3])
            // Spaces at the start of a line keep their columns.
            expect(xs(2).map((x) => x / advance)).toEqual([3])
            expect(xs(3)[5]! / advance).toBeCloseTo(9, 6)
            expect(keys(run.lines[3]!)).toBe('callserrors')
        }))
    })

    it('draws the prompt before a command, and none before output', async () => {
        await compileFilm(film(() => {
            const run = terminal(lines, { prompt: '> ' })
            expect(run.prompts.map((prompt) => prompt !== null)).toEqual([true, false, false, false, false])
            expect(keys(run.prompts[0]!)).toBe('>')
            expect(keys(terminal(lines).prompts[0]!)).toBe('$')
            // The prompt is part of its line, at the left edge. The command starts two columns after it.
            expect(run.lines[0]!.children).toContain(run.prompts[0])
            expect(keys(run.lines[0]!)).toBe('>./one-byte')
            const output = run.lines[1]!.children
            const advance = output[1]!.get('x') - output[0]!.get('x')
            const command = run.lines[0]!.children.filter((child) => child !== run.prompts[0])
            expect(command[0]!.get('x')).toBeCloseTo(2 * advance, 6)
            expect(right(run.prompts[0]!)).toBeLessThan(command[0]!.bounds().x)
            expect(Math.abs(run.prompts[0]!.bounds().x - run.lines[1]!.bounds().x)).toBeLessThan(4)
            // The prompt is dim, and the command is not.
            expect(run.prompts[0]!.children[0]!.get('fill')).not.toEqual(command[0]!.get('fill'))
            expect(keys(run.lines[1]!)).toBe('mapped1GiBat0xffff7c000000')
        }))
    })

    it('gives a note line and the given color of a line their colors', async () => {
        await compileFilm(film(() => {
            const run = terminal(['plain', { text: '[...]', kind: 'note' }, { text: 'FAIL', color: 'red' }, { text: 'red', kind: 'command', color: 'red' }])
            const fill = (line: number, glyph = 0) => run.lines[line]!.children[glyph]!.get('fill')
            expect(fill(1)).not.toEqual(fill(0))
            expect(fill(2)).not.toEqual(fill(0))
            expect(fill(2)).not.toEqual(fill(1))
            // The color of a command is the color of its text. The prompt stays dim, as a note is.
            expect(fill(3, 1)).toEqual(fill(2))
            expect(run.prompts[3]!.children[0]!.get('fill')).toEqual(fill(1))
        }))
    })

    it('finds the glyphs of one occurrence of a text, as one node inside its line', async () => {
        await compileFilm(film(() => {
            const run = terminal(lines).at(200, -100)
            const first = run.find('kB'), second = run.find('kB', 1)
            expect(keys(first)).toBe('kB')
            expect(keys(second)).toBe('kB')
            inside(first, run.lines[2]!)
            inside(second, run.lines[3]!)
            expect(first.bounds().y).toBeLessThan(second.bounds().y)
            // The matches count from the first line to the last, and a match starts after the one before.
            inside(run.find('1'), run.lines[1]!)
            inside(run.find('1', 1), run.lines[4]!)
            const zeros = [0, 1, 2].map((occurrence) => run.find('00', occurrence).bounds().x)
            expect(zeros[1]! - zeros[0]!).toBeCloseTo(zeros[2]! - zeros[1]!, 6)
            expect(zeros[1]!).toBeGreaterThan(zeros[0]! + first.bounds().width * 0.9)
            expect(() => run.find('00', 3)).toThrow(/the text "00" is there 3 times, so it has no occurrence 3/)
            // It matches the exact characters, with their spaces. The node holds the glyphs, and a space has none.
            expect(keys(run.find('write:      0'))).toBe('write:0')
            expect(() => run.find('write: 0')).toThrow(/no line has the text "write: 0"/)
            // It finds the text of a command, and not its prompt.
            inside(run.find('./one-byte'), run.lines[0]!)
            expect(() => run.find('$')).toThrow(/no line has the text "\$"/)
        }))
    })

    it('gives the same node for the same part, and keeps a part inside a larger one', async () => {
        await compileFilm(film(() => {
            const run = terminal(lines)
            const unit = run.find('kB', 1)
            expect(run.find('kB', 1)).toBe(unit)
            // A space at an end of the text has no glyph, so the part is the same with it and without it.
            expect(run.find(' 1 ')).toBe(run.find('1'))
            // A larger part takes the smaller one in, and a smaller part is made inside the larger one.
            const number = run.find('4 kB')
            expect(unit.parent).toBe(number)
            expect(run.find('4').parent).toBe(number)
            expect(run.find('kB', 1)).toBe(unit)
            // A color on the part colors its glyphs, and no other glyph of the line.
            const ink = run.lines[3]!.children[0]!.get('fill')
            number.color('yellow')
            expect(number.leaves().every((leaf) => leaf.get('fill') !== ink)).toBe(true)
            expect(run.lines[3]!.leaves().filter((leaf) => leaf.get('fill') !== ink)).toHaveLength(3)
            // The line still draws its characters from left to right.
            expect(keys(run.lines[3]!)).toBe('Rssafterthewrite:4kB')
            const xs = run.lines[3]!.leaves().map((leaf) => leaf.bounds().x)
            expect([...xs].sort((a, b) => a - b)).toEqual(xs)
            // Two parts that share characters, where neither holds the other, cannot both be nodes.
            expect(() => run.find(':       4')).toThrow(/":       4" shares characters with "4 kB"/)
        }))
    })

    it('finds a part on a terminal that is on the stage, and does not hide it before that time', async () => {
        let part!: Node
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            const run = s.add(terminal(lines))
            s.wait(1)
            part = run.find('4 kB')
            part.color('yellow').opacity(0.5)
            s.wait(1)
        }))
        // A change of the part starts at the time of the change, as for every node on the stage.
        expect(at(0.5, () => shows(part))).toBe(1)
        expect(at(1.5, () => shows(part))).toBe(0.5)
        expect(paths(compiled, 0.5)).toHaveLength(paths(compiled, 1.5).length)
        const fill = (time: number) => at(time, () => part.leaves()[0]!.get('fill'))
        expect(fill(0.5)).not.toEqual(fill(1.5))
    })

    it('gives the start and the end of a line in the coordinates of the panel', async () => {
        await compileFilm(film(() => {
            const run = terminal([...lines, ''], { columns: 40, size: 40 }).at(300, 200)
            const [x0, y0] = run.p(2), [x1, y1] = run.p(2, 'right')
            expect(run.p(2, 'left')).toEqual([x0, y0])
            expect(y1).toBe(y0)
            // On the stage, the letters of the line are between the two points, and nearer than a sixth of the text size.
            const line = run.lines[2]!.bounds()
            const start = run.toWorld(x0, y0), end = run.toWorld(x1, y1)
            expect(line.x - start[0]).toBeGreaterThanOrEqual(0)
            expect(line.x - start[0]).toBeLessThan(40 / 6)
            expect(end[0] - (line.x + line.width)).toBeGreaterThanOrEqual(0)
            expect(end[0] - (line.x + line.width)).toBeLessThan(40 / 6)
            // The height is the middle of a capital letter. The "R" of this line is one.
            const capital = run.lines[2]!.children[0]!.bounds()
            expect(start[1]).toBeCloseTo(capital.y + capital.height / 2, 6)
            // Every line starts at one x, and a command starts at its prompt. The end follows the length.
            expect(run.p(0)[0]).toBe(x0)
            expect(run.p(4)[0]).toBe(x0)
            expect(run.p(4)[1] - run.p(3)[1]).toBeCloseTo(run.p(3)[1] - y0, 6)
            expect(run.toWorld(...run.p(0, 'right'))[0] - right(run.lines[0]!)).toBeGreaterThanOrEqual(0)
            expect(run.toWorld(...run.p(0, 'right'))[0] - right(run.lines[0]!)).toBeLessThan(40 / 6)
            expect(run.p(4, 'right')[0]).toBeLessThan(x1)
            expect(run.p(5, 'right')).toEqual(run.p(5))
            expect(() => run.p(6)).toThrow(/no line 6. The terminal has 6 lines/)
        }))
    })

    it('enters with its panel and its bar, and no line', async () => {
        let run!: ReturnType<typeof terminal>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            run = terminal(lines, { title: 'runs/01.txt', note: 'Linux 7.0' })
            s.wait(0.5)
            s.play(run.enter(), { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        expect(paths(compiled, 0.2)).toHaveLength(0)
        const parts = [run.frame, run.bar, run.title!, run.note!]
        expect(at(1, () => parts.map(shows))).toEqual([0.5, 0.5, 0.5, 0.5].map((value) => expect.closeTo(value, 6)))
        expect(at(1.8, () => parts.map(shows))).toEqual([1, 1, 1, 1])
        for (const time of [0.6, 1, 1.8]) expect(at(time, () => run.lines.map(shows))).toEqual([0, 0, 0, 0, 0])
        // The frame draws the panel, the bar, and the letters of the bar: "runs/01.txt" and "Linux7.0".
        expect(paths(compiled, 1.8)).toHaveLength(2 + 11 + 8)
    })

    it('types a command character by character after its prompt, and then prints from the next line', async () => {
        let run!: ReturnType<typeof terminal>
        await compileFilm(film({ fps: 20 }, (s) => {
            run = terminal(lines)
            s.play(run.enter(), { duration: 0.5 })
            // Ten characters in eleven steps of 0.1 s, at a steady rate: the prompt has the first step alone.
            s.play(run.type(0), { duration: 1.1 })
            s.play(run.print(), { duration: 1 })
        }))
        const command = run.lines[0]!.children.filter((child) => child !== run.prompts[0])
        const typed = (time: number) => at(time, () => (shows(run.lines[0]!) ? command.filter((glyph) => glyph.get('opacity') > 0).map((glyph) => glyph.data['key']).join('') : null))
        expect(typed(0.45)).toBeNull()
        expect(typed(0.55)).toBe('')
        expect(at(0.55, () => shows(run.prompts[0]!))).toBe(1)
        expect(typed(0.65)).toBe('.')
        expect(typed(1.05)).toBe('./one')
        expect(typed(1.45)).toBe('./one-byt')
        expect(typed(1.55)).toBe('./one-byte')
        expect(at(1.55, () => run.lines.map(shows))).toEqual([1, 0, 0, 0, 0])
        // The command is shown, so the print starts with line 1: four lines, a quarter of a second apart.
        expect(at(1.65, () => run.lines.map(shows))).toEqual([1, 1, 0, 0, 0])
        expect(at(2.2, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 0])
        expect(typed(2.7)).toBe('./one-byte')
    })

    it('prints the lines of a range one after another, in order, each at once', async () => {
        let run!: ReturnType<typeof terminal>
        await compileFilm(film({ fps: 20 }, (s) => {
            run = terminal(lines)
            s.play(run.enter(), { duration: 0.5 })
            s.play(run.print({ from: 0 }), { duration: 1 })
            s.wait(0.5)
        }))
        // Five lines, 0.2 s apart, at a steady rate. A line is not there, or it is there whole.
        expect(at(0.45, () => run.lines.map(shows))).toEqual([0, 0, 0, 0, 0])
        expect(at(0.55, () => run.lines.map(shows))).toEqual([1, 0, 0, 0, 0])
        expect(at(0.75, () => run.lines.map(shows))).toEqual([1, 1, 0, 0, 0])
        expect(at(1, () => run.lines.map(shows))).toEqual([1, 1, 1, 0, 0])
        expect(at(1.25, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 0])
        expect(at(1.4, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 1])
        // A command in the range is printed too. It comes whole, with its prompt.
        expect(at(0.55, () => run.lines[0]!.leaves().every((leaf) => leaf.get('opacity') === 1))).toBe(true)
    })

    it('prints a range of lines, and a second print in the same sequence goes on from the first', async () => {
        let run!: ReturnType<typeof terminal>
        await compileFilm(film({ fps: 20 }, (s) => {
            run = terminal(lines)
            s.play(run.enter(), { duration: 0.5 })
            s.play(run.type(0), { duration: 0.5 })
            s.play(seq(run.print({ from: 2, to: 3, duration: 1 }), run.print({ duration: 1 })), { duration: 2, ease: linear })
            s.wait(0.5)
        }))
        // The first print has one second for lines 2 and 3. The second has one second for the lines that are left, 1 and 4.
        expect(at(1.25, () => run.lines.map(shows))).toEqual([1, 0, 1, 0, 0])
        expect(at(1.75, () => run.lines.map(shows))).toEqual([1, 0, 1, 1, 0])
        expect(at(2.25, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 0])
        expect(at(2.6, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 1])
    })

    it('prints one block when it has no range: up to the next command, with its own command whole when the film did not type it', async () => {
        const session = [{ text: 'first', kind: 'command' as const }, 'a', 'b', { text: 'second', kind: 'command' as const }, { text: 'third', kind: 'command' as const }, 'c']
        let run!: ReturnType<typeof terminal>
        let ranged!: ReturnType<typeof terminal>
        await compileFilm(film({ fps: 20 }, (s) => {
            run = terminal(session)
            // A print with a range does not stop at a command: from line 1, it brings every line to the last.
            ranged = terminal(session).at(0, 400)
            s.play(run.enter(), ranged.print({ from: 1 }), { duration: 0.5 })
            // No command is typed. The first print brings the first command and its output: three lines.
            s.play(run.print(), { duration: 0.6 })
            // The second block is the second command alone: it has no output.
            s.play(run.print(), { duration: 0.4 })
            // The third command is typed, so the print after it brings its output only.
            s.play(run.type(4), { duration: 0.5 })
            s.play(run.print(), { duration: 0.5 })
            // Every line is shown now. There is nothing to print, and that is not an error.
            s.play(run.print(), { duration: 0.5 })
        }))
        expect(at(0.55, () => ranged.lines.map(shows))).toEqual([0, 1, 1, 1, 1, 1])
        expect(at(0.45, () => run.lines.map(shows))).toEqual([0, 0, 0, 0, 0, 0])
        expect(at(0.55, () => run.lines.map(shows))).toEqual([1, 0, 0, 0, 0, 0])
        // The command of the block comes whole, at once, as the output lines do.
        expect(at(0.55, () => run.lines[0]!.leaves().every((leaf) => leaf.get('opacity') === 1))).toBe(true)
        expect(at(0.75, () => run.lines.map(shows))).toEqual([1, 1, 0, 0, 0, 0])
        // The first print ends before the second command, and the second print before the third.
        expect(at(1.05, () => run.lines.map(shows))).toEqual([1, 1, 1, 0, 0, 0])
        expect(at(1.15, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 0, 0])
        expect(at(1.45, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 0, 0])
        expect(at(1.95, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 1, 0])
        expect(at(2.05, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 1, 1])
    })

    it('shows every line that is left, all together, and only once', async () => {
        let run!: ReturnType<typeof terminal>
        let fresh!: ReturnType<typeof terminal>
        await compileFilm(film({ fps: 20 }, (s) => {
            run = terminal(lines)
            s.play(run.enter(), { duration: 0.5 })
            s.play(run.type(0), { duration: 0.5 })
            s.play(run.showLines(), { duration: 1, ease: linear })
            s.wait(0.5)
            // The lines are shown now, so a second call has nothing to bring. A terminal that is not on
            // the stage comes with its panel at once, and its lines fade in.
            fresh = terminal(lines).at(0, 300)
            s.play(run.showLines(), fresh.showLines(), { duration: 1, ease: linear })
        }))
        expect(at(0.95, () => run.lines.map(shows))).toEqual([1, 0, 0, 0, 0])
        expect(at(1.5, () => run.lines.map(shows))).toEqual([1, 0.5, 0.5, 0.5, 0.5].map((value) => expect.closeTo(value, 6)))
        expect(at(2.1, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 1])
        expect(at(3, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 1])
        expect(at(3, () => [shows(fresh), shows(fresh.frame)])).toEqual([1, 1])
        expect(at(3, () => fresh.lines.map(shows))).toEqual([0.5, 0.5, 0.5, 0.5, 0.5].map((value) => expect.closeTo(value, 6)))
    })

    it('keeps a line that types or prints in the same play as the entry, in both orders', async () => {
        let first!: ReturnType<typeof terminal>
        let second!: ReturnType<typeof terminal>
        let printed!: ReturnType<typeof terminal>
        await compileFilm(film({ fps: 20 }, (s) => {
            first = terminal(lines).at(0, -300)
            second = terminal(lines)
            printed = terminal(lines).at(0, 300)
            s.wait(0.5)
            s.play(first.type(0), first.enter(), second.enter(), second.type(0), printed.print({ from: 0, to: 2 }), printed.enter(), { duration: 1 })
            s.wait(0.5)
            // A line that was shown before the entry leaves with it.
            s.play(first.enter(), { duration: 0.5 })
        }))
        const typed = (run: ReturnType<typeof terminal>) => run.lines[0]!.children.filter((child) => child !== run.prompts[0] && child.get('opacity') > 0).length
        for (const run of [first, second]) {
            expect(at(1, () => [shows(run.frame), typed(run)])).toEqual([expect.closeTo(0.5, 1), 5])
            expect(at(1.8, () => run.lines.map(shows))).toEqual([1, 0, 0, 0, 0])
            expect(at(1.8, () => typed(run))).toBe(10)
        }
        expect(at(1.8, () => printed.lines.map(shows))).toEqual([1, 1, 1, 0, 0])
        expect(at(2.4, () => first.lines.map(shows))).toEqual([0, 0, 0, 0, 0])
    })

    it('refuses to type a command that is already shown', async () => {
        await compileFilm(film({ fps: 20 }, (s) => {
            const whole = s.add(terminal(lines))
            expect(() => s.play(whole.type(0))).toThrow(/line 0 is already shown, so type\(\) cannot type it. Start the terminal with \{ shown: false \}, or play enter\(\) before type\(\)/)
            const run = terminal(lines).at(0, 300)
            s.play(run.enter(), { duration: 0.5 })
            s.play(run.type(0), { duration: 0.5 })
            expect(() => s.play(run.type(0))).toThrow(/line 0 is already shown/)
            // After a new entry the terminal is empty, so the command types again.
            s.play(run.enter(), { duration: 0.5 })
            s.play(run.type(0), { duration: 0.5 })
        }))
    })

    it('starts with no line when shown is false, so a film can add it in a group and then type and print', async () => {
        let run!: ReturnType<typeof terminal>
        await compileFilm(film({ fps: 20 }, (s) => {
            expect(terminal(lines).lines.map(shows)).toEqual([1, 1, 1, 1, 1])
            run = terminal(lines, { shown: false })
            s.add(group(run, text('a label', { size: 28 }).at(0, 200)).at(300, -100))
            s.wait(0.5)
            s.play(run.type(0), { duration: 0.5 })
            s.play(run.print(), { duration: 1 })
            s.wait(0.5)
        }))
        // The panel is there from the start, with no line.
        expect(at(0.2, () => [shows(run.frame), shows(run.bar), ...run.lines.map(shows)])).toEqual([1, 1, 0, 0, 0, 0, 0])
        expect(at(0.9, () => run.lines.map(shows))).toEqual([1, 0, 0, 0, 0])
        expect(at(1.05, () => run.lines.map(shows))).toEqual([1, 1, 0, 0, 0])
        expect(at(2.2, () => run.lines.map(shows))).toEqual([1, 1, 1, 1, 1])
    })

    it('stays in a group that is not on the stage when it enters, types or prints, at the place and the size that the group gives it', async () => {
        const made: { run: ReturnType<typeof terminal>; holder: Node; label: Node; x: number }[] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            made.length = 0
            for (const x of [-600, 0, 600]) {
                const run = terminal(lines), label = text('a label', { size: 28 }).at(0, 150)
                const holder = group(run, label).at(x, -200)
                holder.scale(0.5, [x, -200])
                made.push({ run, holder, label, x })
            }
            s.wait(0.5)
            s.play(made[0]!.run.enter(), made[1]!.run.type(0), made[2]!.run.print({ from: 1, to: 2 }), { duration: 0.5 })
            s.wait(0.5)
        }))
        const natural = terminal(lines).frame.bounds().width
        for (const { run, holder, label, x } of made) {
            expect(run.parent).toBe(holder)
            const frame = at(1.2, () => run.frame.bounds())
            expect(frame.x + frame.width / 2).toBeCloseTo(x, 6)
            expect(frame.width).toBeCloseTo(natural / 2, 6)
            // The group comes with it, at the time of the animation and not before.
            expect(at(0.2, () => shows(holder))).toBe(0)
            expect(at(1.2, () => [shows(holder), shows(label)])).toEqual([1, 1])
        }
        expect(at(1.2, () => made[0]!.run.lines.map(shows))).toEqual([0, 0, 0, 0, 0])
        expect(at(1.2, () => made[1]!.run.lines.map(shows))).toEqual([1, 0, 0, 0, 0])
        expect(at(1.2, () => made[2]!.run.lines.map(shows))).toEqual([0, 1, 1, 0, 0])
    })

    it('is whole when a film adds it, and comes empty when its first animation is a type or a print', async () => {
        let whole!: ReturnType<typeof terminal>
        let typed!: ReturnType<typeof terminal>
        let printed!: ReturnType<typeof terminal>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            whole = s.add(terminal(lines))
            // All lines of a terminal that the film added are shown, so there is nothing to print.
            s.play(whole.print(), { duration: 0.5 })
            s.remove(whole)
            typed = terminal(lines)
            printed = terminal(lines).at(0, 300)
            s.play(typed.type(0), printed.print({ from: 1, to: 2 }), { duration: 1 })
            s.wait(0.5)
        }))
        expect(at(0.1, () => whole.lines.map(shows))).toEqual([1, 1, 1, 1, 1])
        expect(at(0.4, () => whole.lines.map(shows))).toEqual([1, 1, 1, 1, 1])
        // The panel of a terminal that was not on the stage comes at once, with no line but those that the animation brings.
        expect(at(0.55, () => [shows(typed), shows(typed.frame)])).toEqual([1, 1])
        expect(at(1.8, () => typed.lines.map(shows))).toEqual([1, 0, 0, 0, 0])
        expect(at(1.8, () => printed.lines.map(shows))).toEqual([0, 1, 1, 0, 0])
        expect(paths(compiled, 0.55).length).toBeGreaterThan(0)
    })

    it('cuts a line that is too long with an ellipsis when clip is set, and refuses it without', async () => {
        await compileFilm(film(() => {
            const long = 'ffffbc1e0000-ffffbc368000 r-xp 00000000 fe:02 1318290 /usr/lib/libc.so.6'
            expect(() => terminal(['short', long], { columns: 30 })).toThrow(new RegExp(`line 1 has ${long.length} characters, and \`columns\` is 30. Raise \`columns\`, or set \`clip\``))
            const run = terminal(['short', long, 'x'.repeat(30)], { columns: 30, clip: true })
            // 29 characters of the line, then the ellipsis in column 30. The panel keeps its 30 columns.
            expect(keys(run.lines[1]!)).toBe(`${long.slice(0, 29).replace(/ /g, '')}…`)
            expect(run.p(1, 'right')).toEqual([run.p(2, 'right')[0], run.p(1)[1]])
            expect(run.frame.bounds().width).toBeCloseTo(terminal(['short'], { columns: 30 }).frame.bounds().width, 6)
            inside(run.lines[1]!, run.frame)
            // A line of exactly 30 characters is whole.
            expect(keys(run.lines[2]!)).toBe('x'.repeat(30))
            // The ellipsis is not a character of the program: it has the color of a note, not of the output.
            const cut = run.lines[1]!.children
            expect(cut[cut.length - 1]!.get('fill')).not.toEqual(cut[0]!.get('fill'))
            expect(run.find('…').parent).toBe(run.lines[1])
            // The prompt of a command counts.
            expect(() => terminal([{ text: 'x'.repeat(29), kind: 'command' }], { columns: 30 })).toThrow(/line 0 has 31 characters with its prompt, and `columns` is 30/)
            expect(keys(terminal([{ text: 'x'.repeat(29), kind: 'command' }], { columns: 30, clip: true }).lines[0]!)).toBe(`$${'x'.repeat(27)}…`)
            // With no room for the prompt and an ellipsis, clip cannot help.
            expect(() => terminal([{ text: 'ls', kind: 'command' }], { columns: 2, clip: true })).toThrow(/line 0 has 4 characters with its prompt, and `columns` is 2. Raise `columns`$/)
        }))
    })

    it('grows for a title and a note that need more room than the lines, and refuses them when the columns are given', async () => {
        await compileFilm(film(() => {
            const title = 'data/runs/01-one-byte.txt', note = 'Linux 7.0, arm64, 2026-11-08'
            const run = terminal(['x'], { title, note })
            // The two do not meet: there is room for more than two characters of the bar between them.
            inside(run.title!, run.bar)
            inside(run.note!, run.bar)
            const letter = run.title!.bounds().width / title.length
            expect(run.note!.bounds().x - right(run.title!)).toBeGreaterThan(2 * letter)
            expect(run.frame.bounds().width).toBeGreaterThan(terminal(['x']).frame.bounds().width * 5)
            // A panel of 60 columns has the room, and keeps its width.
            expect(terminal(['x'], { title, note, columns: 60 }).frame.bounds().width).toBeCloseTo(terminal(['x'], { columns: 60 }).frame.bounds().width, 6)
            expect(() => terminal(['x'], { title, note, columns: 30 })).toThrow(/the title and the note need \d+ columns in the bar, and `columns` is 30. Shorten the title or the note, or raise `columns`/)
            expect(() => terminal(['x'], { title, columns: 10 })).toThrow(/the title needs \d+ columns in the bar, and `columns` is 10. Shorten the title, or raise `columns`/)
            expect(() => terminal(['x'], { note, columns: 10 })).toThrow(/the note needs \d+ columns in the bar, and `columns` is 10. Shorten the note, or raise `columns`/)
        }))
    })

    it('makes the text of the bar readable on the color of the bar', async () => {
        await compileFilm(film(() => {
            const fill = (node: Node) => node.children[0]!.get('fill') as readonly number[]
            const light = (color: readonly number[]) => color[0]! + color[1]! + color[2]!
            // On the quiet bar of the dark default look the title is light. On a bright bar it is dark.
            const quiet = terminal(['x'], { title: 'host', note: 'now' }), bright = terminal(['x'], { title: 'host', note: 'now', color: 'yellow' })
            expect(light(fill(quiet.title!))).toBeGreaterThan(light(quiet.bar.get('fill') as readonly number[]) + 300)
            expect(light(fill(bright.title!))).toBeLessThan(light(bright.bar.get('fill') as readonly number[]) - 300)
            // The note is dimmer than the title: between the title and the bar.
            expect(light(fill(quiet.note!))).toBeLessThan(light(fill(quiet.title!)))
            expect(light(fill(quiet.note!))).toBeGreaterThan(light(quiet.bar.get('fill') as readonly number[]) + 150)
            expect(light(fill(bright.note!))).toBeGreaterThan(light(fill(bright.title!)))
            // The color is the color of the border and of the bar.
            expect(bright.frame.get('stroke')).toEqual(bright.bar.get('fill'))
            expect(bright.frame.get('fill')).toEqual(quiet.frame.get('fill'))
        }))
    })

    it('gives a copy its own glyphs and its own record of the lines that are shown', async () => {
        let copy!: ReturnType<typeof terminal>
        await compileFilm(film({ fps: 20 }, (s) => {
            const run = terminal(lines)
            copy = run.clone().at(0, 300)
            const part = copy.find('4 kB')
            expect(part.parent).toBe(copy.lines[3])
            expect(run.lines[3]!.children).toHaveLength(copy.lines[3]!.children.length + 2)
            s.add(copy)
            // The lines of the copy are shown. The entry of the first terminal does not change that.
            s.play(run.enter(), { duration: 0.5 })
            s.play(copy.showLines(), { duration: 1, ease: linear })
        }))
        expect(at(1, () => copy.lines.map(shows))).toEqual([1, 1, 1, 1, 1])
    })

    it('gives each line its text as a name for the film check, which reports a character that no font can draw', async () => {
        const report = await checkFilm(film((s) => {
            s.add(terminal([...lines, 'a\ue000b', '✓ ok'], { size: 40 }).at(700, 0))
            // The left half of this panel is off the frame, with its prompt.
            s.add(terminal([{ text: 'ls', kind: 'command' }], { size: 40 }).at(-960, 400))
            s.wait(1)
        }))
        const clipped = report.diagnostics.filter((entry) => entry.code === 'film.off_canvas').map((entry) => entry.text)
        expect(clipped).toContain('mapped 1 GiB at 0xffff7c000000')
        expect(clipped).not.toContain('./one-byte')
        expect(clipped).toContain('$ ')
        expect(clipped).not.toContain('ls')
        // The mono font has no check mark, and another font of the library has one. No font has U+E000.
        expect(report.diagnostics.filter((entry) => entry.code === 'film.missing_glyph').map((entry) => entry.text)).toEqual(['a\ue000b'])
    })

    it('does not count or draw the spaces at the end of a line, and keeps the other spaces', async () => {
        await compileFilm(film(() => {
            // A line of `perf stat` ends in many spaces.
            const perf = `             10070      context-switches${' '.repeat(54)}`
            const width = (list: Parameters<typeof terminal>[0], options?: Parameters<typeof terminal>[1]) => terminal(list, options).frame.bounds().width
            expect(width([perf])).toBeCloseTo(width([perf.trimEnd()]), 6)
            expect(width(['a   ', 'bb'])).toBeCloseTo(width(['a', 'bb']), 6)
            // Its text fits 60 columns, so it is not an error, and `clip` does not cut it.
            expect(perf.length).toBeGreaterThan(60)
            expect(keys(terminal([perf], { columns: 60 }).lines[0]!)).toBe('10070context-switches')
            expect(keys(terminal([perf], { columns: 60, clip: true }).lines[0]!)).toBe('10070context-switches')
            // A line that is too long says how long its text is, without the spaces.
            expect(() => terminal([`${'x'.repeat(10)}    `], { columns: 5 })).toThrow(/line 0 has 10 characters, and `columns` is 5/)
            // The end of a line is the end of its text. The spaces at the start and inside keep their columns.
            const run = terminal(['  a  b   ', '     ', { text: 'ls   ', kind: 'command' }, 'xxxxxxxxxx'])
            const advance = run.lines[3]!.children[1]!.get('x') - run.lines[3]!.children[0]!.get('x')
            const columns = (line: number) => (run.p(line, 'right')[0] - run.p(line)[0]) / advance
            expect(run.lines[0]!.children.map((glyph) => glyph.get('x') / advance)).toEqual([2, 5])
            expect(columns(0)).toBeCloseTo(6, 6)
            expect(columns(2)).toBeCloseTo(4, 6)
            // A line of spaces is an empty line.
            expect(run.lines[1]!.children).toHaveLength(0)
            expect(columns(1)).toBe(0)
            // A command with no text ends after the characters of its prompt.
            const bare = terminal([{ text: '', kind: 'command' }, 'xx'])
            expect((bare.p(0, 'right')[0] - bare.p(0)[0]) / advance).toBeCloseTo(1, 6)
            expect(width([{ text: '', kind: 'command' }])).toBeCloseTo(width(['x']), 6)
            // The spaces at the end are not there to find, and the error says so.
            expect(() => terminal([perf]).find('context-switches  ')).toThrow(/no line has the text "context-switches  ".*The spaces at the end of a line are not a part of the line/)
        }))
    })

    it('gives a character of another font one column, and refuses a glyph that is too wide for one', async () => {
        await compileFilm(film(() => {
            // The mono font has no check mark, no star and no vertical ellipsis. Another font of the library has them.
            const run = terminal(['x✓x★★x⋮x', 'xxxxxxxx'], { size: 100 })
            const glyphs = run.lines[0]!.children, plain = run.lines[1]!.children
            const advance = plain[1]!.get('x') - plain[0]!.get('x')
            const start = run.toWorld(...run.p(0))[0]
            for (const column of [1, 3, 4, 6]) {
                // The ink is in the middle of its column, and inside it.
                const ink = glyphs[column]!.bounds()
                expect(ink.x + ink.width / 2 - start).toBeCloseTo((column + 0.5) * advance, 6)
                expect(ink.x - start).toBeGreaterThan(column * advance)
                expect(ink.x + ink.width - start).toBeLessThan((column + 1) * advance)
            }
            // Two wide glyphs side by side do not touch.
            expect(glyphs[4]!.bounds().x).toBeGreaterThan(right(glyphs[3]!) + 1)
            // A glyph that is too wide for a column is drawn smaller, on the baseline of the line. A narrow one keeps its size.
            const natural = (char: string) => text(char, { font: 'mono', size: 100 }).bounds().width
            expect(glyphs[1]!.bounds().width).toBeLessThan(natural('✓') * 0.9)
            expect(Math.abs(bottom(glyphs[1]!) - bottom(glyphs[0]!))).toBeLessThan(2)
            expect(glyphs[6]!.bounds().width).toBeCloseTo(natural('⋮'), 6)
            // The glyphs of the mono font keep their places: a box drawing line goes past its column, to join the next.
            const box = terminal(['──'], { size: 100 }).lines[0]!.children
            expect(right(box[0]!)).toBeGreaterThan(box[1]!.bounds().x)
            // A glyph that is wider than 1.2 columns is refused, in a line and in the prompt, from any font.
            expect(() => terminal(['ok', 'a ⇒ b'])).toThrow(/line 1 has the character "⇒" \(U\+21D2\). Its glyph is 1.5 columns wide, so it would cover the next character. Replace it/)
            expect(() => terminal([{ text: 'ls', kind: 'command' }], { prompt: '⇒ ' })).toThrow(/the prompt has the character "⇒"/)
            expect(() => terminal(['a ⟶ b'])).toThrow(/line 0 has the character "⟶" \(U\+27F6\). Its glyph is 1.9 columns wide/)
        }))
    })

    it('is as tall as the guide says: a frame of 1080 holds 38 lines at size 18, 25 at 26 and 20 at 32', async () => {
        await compileFilm(film(() => {
            const height = (count: number, size: number) => terminal(Array.from({ length: count }, () => 'x'), { size }).frame.bounds().height
            for (const [size, count] of [[18, 38], [26, 25], [32, 20]] as const) {
                expect(height(count, size)).toBeLessThanOrEqual(1080)
                expect(height(count + 1, size)).toBeGreaterThan(1080)
            }
            expect(height(10, 20)).toBeCloseTo(20 * (1.5 * 10 + 2.7), 0)
        }))
    })

    it('says that clip cut a text off when find does not find it', async () => {
        await compileFilm(film(() => {
            const run = terminal([`start ${'x'.repeat(30)} needle`, `kB one kB ${'.'.repeat(30)} kB`, 'kB'], { columns: 30, clip: true })
            expect(() => run.find('needle')).toThrow(/no line has the text "needle". find\(\) matches the exact characters, spaces included. Line 0 has it in the part that `clip` cut off/)
            expect(() => run.find('kB', 3)).toThrow(/the text "kB" is there 3 times, so it has no occurrence 3. Occurrences count from 0. Line 1 has it in the part that `clip` cut off/)
            // A text that no line has, cut or not, gets no such hint.
            expect(() => run.find('nothing')).toThrow(/no line has the text "nothing". find\(\) matches the exact characters, spaces included$/)
            expect(() => terminal(['kB', 'kB']).find('kB', 2)).toThrow(/Occurrences count from 0$/)
        }))
    })

    it('takes its default times from the text: the characters of a command, and the lines of a print up to 3 s', async () => {
        await compileFilm(film(() => {
            const command = (length: number) => terminal([{ text: 'x'.repeat(length), kind: 'command' }])
            expect(command(20).type(0).duration).toBeCloseTo(1.2, 6)
            expect(command(2).type(0).duration).toBe(0.4)
            const steady = command(20).type(0)
            expect(steady.ease!(0.25)).toBe(0.25)
            // The options of a call replace the defaults.
            const eased = command(20).type(0, { duration: 2, ease: (value) => value * value })
            expect(eased.duration).toBe(2)
            expect(eased.ease!(0.5)).toBe(0.25)
            const dump = (count: number) => terminal(Array.from({ length: count }, () => 'x'))
            expect(dump(10).print().duration).toBeCloseTo(1.2, 6)
            expect(dump(1).print().duration).toBe(0.3)
            expect(dump(40).print().duration).toBe(3)
            expect(dump(40).print({ to: 4 }).duration).toBeCloseTo(0.6, 6)
            expect(dump(40).print({ duration: 5 }).duration).toBe(5)
            // With no range, a print brings one block: its time is that of the longest block, a command and five lines here.
            const first = { text: 'a', kind: 'command' as const }
            expect(terminal([first, '1', '2', first, '1', '2', '3', '4', '5']).print().duration).toBeCloseTo(0.72, 6)
            expect(dump(3).enter().duration).toBe(0.6)
            expect(dump(3).showLines().duration).toBe(0.5)
        }))
    })

    it('writes a glyph of a line as write() writes a glyph of a text: the two contours of a letter at one time', async () => {
        let glyph!: Node
        let letter!: Node
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            const run = terminal(['o'], { size: 100 }).at(-300, 0)
            const plain = text('o', { font: 'mono', size: 100 }).at(300, 0)
            glyph = run.lines[0]!.children[0]!
            letter = plain.chars[0]!
            s.add(run)
            s.play(write(run.lines[0]!), write(plain), { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        // A third of the way, the outline of the outer contour and of the inner contour are both under way.
        const outline = (node: Node) => paths(compiled, 0.3).find((op) => op.node === node)!.strokePath
        expect(outline(letter)).toHaveLength(2)
        expect(outline(glyph)).toHaveLength(2)
    })

    it('names each wrong input, and says what to do', async () => {
        await compileFilm(film(() => {
            expect(() => terminal([])).toThrow(/at least one line/)
            expect(terminal(Array.from({ length: 40 }, () => 'x')).lines).toHaveLength(40)
            expect(() => terminal(Array.from({ length: 41 }, () => 'x'))).toThrow(/41 lines are more than a frame can show.*Show 40 lines or fewer.*kind: 'note'/)
            expect(() => terminal(['a\tb'])).toThrow(/line 0 has a tab. Expand each tab to spaces/)
            expect(() => terminal(['ok', { text: 'a\nb' }])).toThrow(/line 1 has a line break. Give each line as its own item/)
            expect(() => terminal(['\u001b[31mred'])).toThrow(/line 0 has a control character \(U\+001B\)/)
            expect(() => terminal(['a\u007fb'])).toThrow(/line 0 has a control character \(U\+007F\)/)
            expect(() => terminal(['x'], { prompt: '\t$ ' })).toThrow(/the prompt has a tab/)
            expect(() => terminal(['x'], { title: 'a\nb' })).toThrow(/the title has a line break/)
            expect(() => terminal(['x'], { note: 'a\tb' })).toThrow(/the note has a tab/)
            expect(() => terminal(['x'], { size: 0 })).toThrow(/size is a text size, more than 0/)
            expect(() => terminal(['x'], { columns: 2.5 })).toThrow(/columns is a whole number of characters, 1 or more/)
            expect(() => terminal(['x'], { columns: 0 })).toThrow(/columns is a whole number of characters, 1 or more/)
            const run = terminal(lines)
            expect(() => run.find('')).toThrow(/find\(\) needs a text with a character to draw, and got ""/)
            expect(() => run.find('   ')).toThrow(/find\(\) needs a text with a character to draw/)
            expect(() => run.find('kB', 1.5)).toThrow(/occurrence is a whole number, 0 for the first match/)
            expect(() => run.find('kB', 2)).toThrow(/the text "kB" is there 2 times, so it has no occurrence 2/)
            expect(() => run.find('4 kB', 1)).toThrow(/the text "4 kB" is there 1 time, so/)
            expect(() => run.find('page-faults')).toThrow(/no line has the text "page-faults"/)
            expect(() => run.type(1)).toThrow(/line 1 is output, not a command/)
            expect(() => run.type(5)).toThrow(/no line 5. The terminal has 5 lines, and the first is line 0/)
            expect(() => terminal([{ text: '[...]', kind: 'note' }]).type(0)).toThrow(/line 0 is a note, not a command/)
            expect(() => run.print({ from: 3, to: 1 })).toThrow(/print from 3 to 1. `from` and `to` are lines from 0 to 4/)
            expect(() => run.print({ to: 5 })).toThrow(/print from 0 to 5/)
            expect(() => run.print({ from: -1 })).toThrow(/print from -1 to 4/)
            expect(() => run.print({ from: 0.5 })).toThrow(/print from 0.5 to 4/)
        }))
    })
})

describe('boundary', () => {
    type Boundary = ReturnType<typeof boundary>
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)
    /** The glyphs of the number of the tally at a time, from left to right. */
    const glyphs = (made: Boundary, time: number) => at(time, () => (made.tallyNode!.children[0]!.draw!(time) as Node).children)
    const tally = (made: Boundary, time: number) => glyphs(made, time).map((glyph) => (glyph as unknown as { source: string }).source).join('')
    const right = (box: { x: number; width: number }) => box.x + box.width
    const bottom = (box: { y: number; height: number }) => box.y + box.height
    /** The word of the tally at a time, as the tally draws it. */
    const word = (made: Boundary, time = 0) => at(time, () => made.tallyNode!.children[1]!.draw!(time) as Node)
    const said = (node: Node) => (node as unknown as { source: string }).source
    /** The line of a group or a zone, such as the copy of a line in the copy of its zone. */
    const lineIn = (holder: Node) => holder.all().find((node): node is Boundary => 'addCrossings' in node)!
    /** The ticks that are on screen at a time, by their places, from the left. */
    const ticksAt = (made: Boundary, time: number, list: readonly Node[] = made.ticks) => at(time, () => list.filter((tick) => shows(tick) > 0).map((tick) => tick.get('x')).sort((a, b) => a - b))

    it('centers the line on its place, with the names at its left end and the tally at its right end, and none of them on the line', async () => {
        await compileFilm(film(() => {
            const made = boundary({ width: 1000, label: 'system call line', above: 'user space', below: 'kernel', tally: 'system calls' }).at(100, 50)
            const line = made.line.bounds()
            expect([line.x, right(line), line.y]).toEqual([-400, 600, 50])
            const [above, below] = made.sides
            const label = made.labelNode!.bounds(), over = above!.bounds(), under = below!.bounds(), count = made.tallyNode!.bounds()
            // The ink of each name starts at the left end of the line, and the tally ends at its right end.
            for (const box of [label, over, under]) expect(box.x).toBeCloseTo(-400, 6)
            expect(right(count)).toBeCloseTo(600, 6)
            // The stroke is 3 wide. One side name and the tally are over it, the other side name is under it, with room.
            expect(bottom(over)).toBeLessThan(50 - 1.5 - 8)
            expect(bottom(count)).toBeLessThan(50 - 1.5 - 8)
            expect(under.y).toBeGreaterThan(50 + 1.5 + 8)
            // The label is over the side name, and the names end before the tally starts.
            expect(bottom(label)).toBeLessThan(over.y - 4)
            expect(Math.max(right(label), right(over))).toBeLessThan(count.x - 40)

            // With no side name over the line, the label takes the row next to the line.
            const named = boundary({ label: 'VM wall', below: 'host' })
            expect(named.labelNode!.get('y')).toBe(above!.get('y'))
            expect(named.sides[0]).toBeNull()
            expect(named.sides[1]).not.toBeNull()
            const bare = boundary()
            expect([bare.labelNode, bare.tallyNode, ...bare.sides]).toEqual([null, null, null, null])
            expect(bare.line.bounds().width).toBe(1600)
        }))
    })

    it('draws the line in its color and weight, a dashed line that ends in a full dash, and a tally with no word at the right end', async () => {
        await compileFilm(film(() => {
            const plain = boundary()
            expect(plain.line.get('stroke')).toEqual(line([0, 0], [1, 0], { stroke: 'yellow' }).get('stroke'))
            expect(plain.line.get('strokeWidth')).toBe(3)
            expect(plain.line.get('dash')).toBeNull()
            const wall = boundary({ width: 1000, color: 'red', weight: 6, dash: true, tally: true, label: 'VM wall' })
            expect(wall.line.get('stroke')).toEqual(line([0, 0], [1, 0], { stroke: 'red' }).get('stroke'))
            expect(wall.line.get('strokeWidth')).toBe(6)
            // The label has the color of the line.
            expect(wall.labelNode!.children[0]!.get('fill')).toEqual(wall.line.get('stroke'))
            // A whole number of dashes and gaps, less the last gap, is the length of the line.
            const [on, off] = wall.line.get('dash')!
            expect((1000 + off!) / (on! + off!)).toBeCloseTo(Math.round((1000 + off!) / (on! + off!)), 6)
            // With no word, the number itself ends at the right end of the line.
            expect(wall.tallyNode!.children).toHaveLength(1)
            expect(right(wall.tallyNode!.bounds())).toBeGreaterThan(500 - 4)
            expect(right(wall.tallyNode!.bounds())).toBeLessThanOrEqual(500)
            expect(boundary({ tally: false }).tallyNode).toBeNull()
        }))
    })

    it('sets every text in its size and its font, and draws a heavier tick on a heavier line', async () => {
        let thin!: Boundary, heavy!: Boundary, hair!: Boundary
        await compileFilm(film({ fps: 20 }, (s) => {
            const sizes = (made: Boundary, time: number) => [made.labelNode!, made.sides[0]!, made.sides[1]!, word(made, time), ...glyphs(made, time)].map((part) => part.data['size'])
            const names = { label: 'iii', above: 'iii', below: 'iii', tally: 'iii' }
            thin = s.add(boundary({ ...names, width: 1000 }).at(0, -200))
            heavy = s.add(boundary({ ...names, width: 1000, size: 40, weight: 8, font: 'mono' }).at(0, 200))
            expect(sizes(thin, 0)).toEqual(Array(5).fill(26))
            expect(sizes(heavy, 0)).toEqual(Array(5).fill(40))
            // In the mono font, an "i" and a digit are as wide as each other. In the default font they are not.
            // The text of a crossing is a little smaller than the names, in the font of the line. The mark follows the size too.
            const near = thin.cross(0, { label: 'iii' }), far = heavy.cross(0, { label: 'iii' })
            const widths = (made: Boundary, text: Node) => [made.labelNode!, made.sides[0]!, made.sides[1]!, word(made), text].map((part) => part.bounds().width / (part.data['size'] as number))
            for (const width of widths(heavy, far.labelNode!)) expect(width).toBeGreaterThan(1.4)
            for (const width of widths(thin, near.labelNode!)) expect(width).toBeLessThan(1)
            expect((glyphs(heavy, 0)[0] as Node).get('px') * 2 / 40).toBeCloseTo(0.6, 2)
            expect([near.labelNode!.data['size'], far.labelNode!.data['size']]).toEqual([26 * 0.85, 40 * 0.85])
            expect([near.mark.bounds().width, far.mark.bounds().width]).toEqual([expect.closeTo(26 * 0.54, 6), expect.closeTo(40 * 0.54, 6)])
            hair = s.add(boundary({ width: 600, weight: 1, tally: true }).at(0, 400))
            s.play(near, far, hair.cross(0), { duration: 1 })
            s.play(thin.addCrossings(99999), heavy.addCrossings(99999), hair.addCrossings(99999), { duration: 1 })
        }))
        // The note is smaller than the names, in the font of the line: in the mono font each of its characters is 0.6 of its size.
        const wide = (note: Node) => at(2, () => note.bounds().width) / (note.data['size'] as number) / said(note).length
        expect([thin.noteNode!.data['size'], heavy.noteNode!.data['size']]).toEqual([26 * 0.75, 40 * 0.75])
        expect(wide(heavy.noteNode!)).toBeGreaterThan(0.57)
        expect(wide(thin.noteNode!)).toBeLessThan(0.53)
        // The ticks of a heavy line are 6 wide, so they stand 12 apart at least. The ticks of a thin line stand 6 apart.
        const steps = (made: Boundary) => ticksAt(made, 2).slice(1).map((x, index, rest) => x - (index ? rest[index - 1]! : ticksAt(made, 2)[0]!))
        expect(Math.min(...steps(heavy))).toBeGreaterThanOrEqual(12)
        expect(Math.max(...steps(heavy))).toBeLessThan(14)
        for (const made of [thin, hair]) {
            expect(Math.min(...steps(made))).toBeGreaterThanOrEqual(6)
            expect(Math.max(...steps(made))).toBeLessThan(7)
        }
        const [light, strong] = [thin.ticks[0]!, heavy.ticks[0]!]
        expect(light.get('strokeWidth')).toBe(3)
        expect(strong.get('strokeWidth')).toBeGreaterThan(4)
        // The tick of a line that is thinner than 3 is as thin as the line.
        expect(hair.ticks[0]!.get('strokeWidth')).toBe(1)
        // The tick shows the same length on both sides of the stroke of its line.
        const out = (tick: Node, weight: number) => at(1, () => tick.bounds().height) / 2 - weight / 2
        expect(out(light, 3)).toBeCloseTo(26 * 0.3, 6)
        expect(out(strong, 8)).toBeCloseTo(40 * 0.3, 6)
    })

    it('starts a mark 70 over the line by default, and takes the length and the ease of each animation from its options', async () => {
        await compileFilm(film(() => {
            const made = boundary({ tally: true })
            const plain = made.cross(0)
            expect([plain.mark.get('x'), plain.mark.get('y')]).toEqual([0, -70])
            expect(made.cross(0, { direction: 'up', reach: 120 }).mark.get('y')).toBe(120)
            // The reach follows the text size: 2.7 sizes, as a whole number.
            expect(boundary({ size: 40 }).cross(0).mark.get('y')).toBe(-108)
            expect([plain.duration, made.cross(0, { direction: 'round' }).duration, made.addCrossings(5).duration, made.clear().duration, made.enter().duration]).toEqual([0.8, 1.4, 1.6, 0.6, 1.2])
            for (const anim of [made.cross(0, { duration: 3, ease: linear }), made.addCrossings(5, { duration: 3, ease: linear }), made.clear({ duration: 3, ease: linear }), made.enter({ duration: 3, ease: linear })]) {
                expect([anim.duration, anim.ease]).toEqual([3, linear])
            }
        }))
    })

    it('gives places along the line that are clear of the names and of a tally of six digits', async () => {
        let made!: Boundary
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, label: 'system call line', above: 'user space', below: 'kernel', tally: 'system calls' }))
            s.play(made.addCrossings(999999), { duration: 1 })
        }))
        const names = Math.max(right(made.labelNode!.bounds()), right(made.sides[0]!.bounds()), right(made.sides[1]!.bounds()))
        // The first place is farther from the names than the last place is from the tally: the text of a crossing goes to the right of its mark.
        expect(made.x(0)).toBeGreaterThan(names + 44)
        expect(made.x(0)).toBeLessThan(names + 60)
        expect(tally(made, compiled.duration)).toBe('999,999')
        const widest = at(compiled.duration, () => made.tallyNode!.bounds().x)
        expect(made.x(1)).toBeLessThan(widest - 24)
        expect(made.x(1)).toBeGreaterThan(widest - 48)
        expect(made.x(0.5)).toBeCloseTo((made.x(0) + made.x(1)) / 2, 6)
        // A line with no names and no tally keeps a small margin at each end.
        const bare = boundary({ width: 1000 })
        expect(bare.x(0)).toBeGreaterThan(-500 + 10)
        expect(bare.x(0)).toBeLessThan(-500 + 40)
        expect(bare.x(1)).toBeCloseTo(-bare.x(0), 6)
        expect(bare.x(0.5)).toBeCloseTo(0, 6)
    })

    it('sends a mark down through the line, lights the line there, leaves a tick, and counts when the mark is on the line', async () => {
        let made!: Boundary, crossing!: ReturnType<Boundary['cross']>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: 'crossings' }).at(0, 100))
            s.wait(1)
            crossing = made.cross(200, { reach: 80 })
            s.play(crossing, { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        const mark = crossing.mark
        // Over the line before, on it half way, under it after. The places are in the coordinates of the line.
        expect(at(1, () => [mark.get('x'), mark.get('y')])).toEqual([200, -80])
        expect(at(1.5, () => mark.get('y'))).toBeCloseTo(0, 6)
        expect(at(2, () => mark.get('y'))).toBeCloseTo(80, 6)
        // It fades in over the first fifth of its time and out over the last fifth, and is gone after.
        expect(at(0.9, () => shows(mark))).toBe(0)
        expect(at(1.1, () => shows(mark))).toBeCloseTo(0.5, 6)
        expect(at(1.5, () => shows(mark))).toBe(1)
        expect(at(1.9, () => shows(mark))).toBeCloseTo(0.5, 6)
        expect(at(2.1, () => shows(mark))).toBe(0)
        // The tick arrives when the mark is on the line, and stays. It is a short stroke across the line at x.
        expect(made.ticks).toHaveLength(1)
        const tick = made.ticks[0]!
        expect(at(1.45, () => shows(tick))).toBe(0)
        expect(at(2.4, () => shows(tick))).toBe(1)
        const box = at(2.4, () => tick.bounds())
        expect([box.x, box.width]).toEqual([200, 0])
        expect(box.y).toBeLessThan(100 - 6)
        expect(bottom(box)).toBeGreaterThan(100 + 6)
        expect(box.height).toBeLessThan(30)
        expect(tick.get('stroke')).toEqual(made.line.get('stroke'))
        // The tally goes up at that moment, and not before.
        expect([tally(made, 1.45), tally(made, 1.55), tally(made, 2.4)]).toEqual(['0', '1', '1'])
        expect(made.count).toBe(1)
        // The line lights around x while the mark passes: a wider piece of the line, which is gone after.
        const lit = (time: number) => paths(compiled, time).filter((op) => op.stroke && op.strokeWidth > 3)
        expect(lit(1.2)).toHaveLength(0)
        expect(lit(1.5)).toHaveLength(1)
        const piece = pathBounds(lit(1.5)[0]!.path)!
        expect(piece.x).toBeLessThan(960 + 200 - 20)
        expect(right(piece)).toBeGreaterThan(960 + 200 + 20)
        expect(piece.width).toBeLessThan(120)
        expect(piece.y).toBeCloseTo(540 + 100, 6)
        expect(lit(1.95)).toHaveLength(0)
        // The light comes up before the mark is on the line, and goes down after.
        expect(lit(1.44)[0]!.strokeAlpha).toBeCloseTo(0.5, 6)
        expect(lit(1.675)[0]!.strokeAlpha).toBeCloseTo(0.5, 6)
        // The mark is drawn over the tick, the tick over the light, and the light over the line.
        const order = paths(compiled, 1.6).map((op) => op.node)
        const drawn = [made.line, lit(1.6)[0]!.node, tick, mark].map((node) => order.indexOf(node as Node))
        expect(drawn[0]).toBe(0)
        expect(drawn).toEqual([...drawn].sort((a, b) => a - b))
        expect(drawn[3]).toBe(order.length - 1)
    })

    it('lights a dashed line in its dashes, in the color of the crossing', async () => {
        let made!: Boundary
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, dash: true, weight: 4 }))
            s.play(made.cross(123, { color: 'teal' }), { duration: 1, ease: linear })
        }))
        const piece = paths(compiled, 0.5).find((op) => op.strokeWidth > 4)!
        const [on, off] = made.line.get('dash')!
        expect(piece.dash).toEqual([on, off])
        // The piece starts part of the way into a dash or a gap. From there, its dashes are at the places of the dashes of the line.
        const start = pathBounds(piece.path)!.x - (960 - 500)
        const periods = (start - piece.dashOffset) / (on! + off!)
        expect(periods).toBeCloseTo(Math.round(periods), 6)
        expect(piece.stroke).toEqual(made.ticks[0]!.get('stroke'))
        expect(piece.stroke).not.toEqual(made.line.get('stroke'))
    })

    it('sends a mark up from under the line, and a round trip down and back to its start, which counts once', async () => {
        let made!: Boundary, up!: ReturnType<Boundary['cross']>, round!: ReturnType<Boundary['cross']>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: true }))
            up = made.cross(-100, { direction: 'up', reach: 60 })
            round = made.cross(100, { direction: 'round', reach: 60 })
            s.play(up, { duration: 1, ease: linear })
            s.play(round, { duration: 2, ease: linear })
            s.wait(0.5)
        }))
        expect(at(0, () => up.mark.get('y'))).toBe(60)
        expect(at(0.5, () => up.mark.get('y'))).toBeCloseTo(0, 6)
        expect(at(1, () => up.mark.get('y'))).toBeCloseTo(-60, 6)
        expect([tally(made, 0.45), tally(made, 0.55)]).toEqual(['0', '1'])
        // The round trip is on the line at 1.5 and at 2.5, and at the far side between them.
        expect(at(1, () => round.mark.get('y'))).toBe(-60)
        expect(at(1.5, () => round.mark.get('y'))).toBeCloseTo(0, 6)
        expect(at(2, () => round.mark.get('y'))).toBeCloseTo(60, 6)
        expect(at(2.5, () => round.mark.get('y'))).toBeCloseTo(0, 6)
        expect(at(3, () => round.mark.get('y'))).toBeCloseTo(-60, 6)
        expect([tally(made, 1.45), tally(made, 1.55), tally(made, 2.45), tally(made, 2.55), tally(made, 3.4)]).toEqual(['1', '2', '2', '2', '2'])
        expect(made.ticks.map((tick) => tick.get('x'))).toEqual([-100, 100])
        expect(at(1.55, () => shows(made.ticks[1]!))).toBeGreaterThan(0)
        // The line lights on the way down and on the way back.
        const lit = (time: number) => paths(compiled, time).filter((op) => op.stroke && op.strokeWidth > 3).length
        expect([lit(1.5), lit(2), lit(2.5)]).toEqual([1, 0, 1])
    })

    it('counts at the moment the mark is on the line when the ease is not symmetric', async () => {
        let made!: Boundary, crossing!: ReturnType<Boundary['cross']>
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: true }))
            crossing = made.cross(0)
            // With this ease the mark is half way after 0.7071 of the time.
            s.play(crossing, { duration: 1, ease: (t) => t * t })
        }))
        const pass = Math.SQRT1_2
        expect(at(pass, () => crossing.mark.get('y'))).toBeCloseTo(0, 4)
        expect([tally(made, pass - 0.01), tally(made, pass + 0.01)]).toEqual(['0', '1'])
        expect(at(pass - 0.01, () => shows(made.ticks[0]!))).toBe(0)
        expect(at(pass + 0.1, () => shows(made.ticks[0]!))).toBeGreaterThan(0)
    })

    it('counts a crossing by its `counts`, and gives the mark and the tick the color of the crossing', async () => {
        let made!: Boundary, batch!: ReturnType<Boundary['cross']>, free!: ReturnType<Boundary['cross']>
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: true }))
            batch = made.cross(-100, { counts: 32, color: 'teal' })
            free = made.cross(100, { counts: 0 })
            s.play(seq(batch, free), { duration: 2 })
        }))
        expect(made.count).toBe(32)
        expect([tally(made, 0.4), tally(made, 0.6), tally(made, 2)]).toEqual(['0', '32', '32'])
        // A crossing that counts 0 still leaves its tick.
        expect(made.ticks).toHaveLength(2)
        expect(made.ticks[0]!.get('stroke')).toEqual(batch.mark.get('fill'))
        expect(made.ticks[0]!.get('stroke')).not.toEqual(made.line.get('stroke'))
        expect(made.ticks[1]!.get('stroke')).toEqual(made.line.get('stroke'))
        expect(free.mark.get('fill')).not.toEqual(made.line.get('stroke'))
    })

    it('keeps the text of a crossing where the mark starts, on the side that is clear of the tally, and fades it with the mark', async () => {
        let made!: Boundary, near!: ReturnType<Boundary['cross']>, far!: ReturnType<Boundary['cross']>, bare!: ReturnType<Boundary['cross']>
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: 'system calls' }))
            near = made.cross(made.x(0.3), { label: 'read()', reach: 80 })
            far = made.cross(made.x(1), { label: 'read()', direction: 'up' })
            bare = made.cross(made.x(0.6))
            s.wait(1)
            s.play(near, far, bare, { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        expect(bare.labelNode).toBeNull()
        const text = near.labelNode!
        // At the start the text is beside the mark, at its height. It does not travel: the mark does.
        const start = at(1.2, () => text.bounds())
        expect(start.x).toBeGreaterThan(made.x(0.3) + 8)
        expect(start.x).toBeLessThan(made.x(0.3) + 30)
        expect(start.y + start.height / 2).toBeGreaterThan(-80 - 8)
        expect(start.y + start.height / 2).toBeLessThan(-80 + 8)
        expect(at(1.8, () => text.bounds())).toEqual(start)
        for (const time of [0.9, 1.1, 1.5, 1.9, 2.1]) expect(at(time, () => shows(text))).toBe(at(time, () => shows(near.mark)))
        // At the last place of the line, the text goes to the left of the mark, away from the tally. An 'up' crossing starts under the line.
        const left = at(1.5, () => far.labelNode!.bounds())
        expect(right(left)).toBeLessThan(made.x(1) - 8)
        expect(left.y).toBeGreaterThan(0)
        expect(right(left)).toBeLessThan(at(1.5, () => made.tallyNode!.bounds().x))
    })

    it('chains eight crossings in one lagged: eight ticks in order, and a tally of 8', async () => {
        let made!: Boundary
        const places = Array.from({ length: 8 }, (_, index) => -350 + index * 100)
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: 'system calls' }))
            s.wait(1)
            // To make a crossing counts nothing. The line counts it when the crossing is played.
            const crossings = places.map((x) => made.cross(x))
            expect([made.count, made.ticks.length]).toEqual([0, 0])
            // With a lag of 0.5, each crossing has 1 s and starts 0.5 s after the one before: the crossings overlap.
            s.play(lagged(crossings, { lag: 0.5 }), { duration: 4.5, ease: linear })
            s.wait(0.5)
        }))
        expect(made.ticks.map((tick) => tick.get('x'))).toEqual(places)
        expect(made.count).toBe(8)
        // Crossing k is on the line at 1.5 + 0.5 k. Just after that, k + 1 ticks show and the tally is k + 1.
        places.forEach((_, index) => {
            const time = 1.5 + index * 0.5 + 0.1
            expect(at(time, () => made.ticks.filter((tick) => shows(tick) > 0)).length, `ticks at ${time}`).toBe(index + 1)
            expect(tally(made, time), `tally at ${time}`).toBe(String(index + 1))
        })
        expect(tally(made, 1.4)).toBe('0')
        expectPure(compiled, [1.4, 2.05, 3.3, 4.6, 6])
    })

    it('runs the tally up through whole numbers to the exact number, with a separator, and keeps the word and the digits at their places', async () => {
        let made!: Boundary
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: 'system calls' }))
            s.wait(1)
            s.play(made.addCrossings(10000), { duration: 2, ease: linear })
            s.play(made.addCrossings(2345), { duration: 1, ease: linear })
        }))
        expect(made.count).toBe(12345)
        expect([tally(made, 1), tally(made, 2), tally(made, 3), tally(made, 4)]).toEqual(['0', '5,000', '10,000', '12,345'])
        let before = 0
        for (const time of [1.013, 1.37, 1.999, 2.5021, 2.9999, 3.3333]) {
            const shown = tally(made, time)
            expect(shown, `at ${time}`).toMatch(/^\d{1,3}(,\d{3})*$/)
            const value = Number(shown.replace(/,/g, ''))
            expect(value).toBeGreaterThan(before)
            before = value
        }
        // The word does not move while the number grows.
        const word = made.tallyNode!.children[1]!
        expect(at(4, () => word.bounds())).toEqual(at(1, () => word.bounds()))
        // The number ends at one x, just before the word, and grows to the left.
        const number = (time: number) => at(time, () => made.tallyNode!.children[0]!.bounds())
        expect(right(number(1))).toBeCloseTo(right(number(3)), 6)
        expect(right(number(1))).toBeLessThan(at(1, () => word.bounds().x) - 3)
        expect(number(3).x).toBeLessThan(number(2).x)
        expect(number(2).x).toBeLessThan(number(1).x)
        // Each digit keeps its place, whatever the digit is: 1,111 and 8,888 take the same room.
        const places = (time: number) => glyphs(made, time).map((glyph) => glyph.get('x')).reverse()
        expect(tally(made, 1.2222)).toBe('1,111')
        expect(tally(made, 2.7776)).toBe('8,888')
        expect(places(1.2222)).toEqual(places(2.7776))
        expect(places(4).slice(0, 5)).toEqual(places(1.2222))
        expect(places(1)[0]).toBe(places(4)[0])
    })

    it('never shows less than 0 or more than the count, with an ease that goes past its ends', async () => {
        let made!: Boundary
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: true }))
            s.play(made.addCrossings(100), { duration: 1, ease: (t) => 3 * t - 1 })
        }))
        expect([tally(made, 0.2), tally(made, 0.5), tally(made, 0.8), tally(made, 1)]).toEqual(['0', '50', '100', '100'])
    })

    it('clears the ticks and the tally, and counts the next round from 0', async () => {
        let made!: Boundary, old!: Node[]
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: 'crossings' }))
            s.play(lagged([-100, 0, 100].map((x) => made.cross(x))), { duration: 1 })
            s.play(made.addCrossings(40), { duration: 1 })
            old = [...made.ticks]
            expect(made.count).toBe(43)
            s.play(made.clear(), { duration: 1, ease: linear })
            expect(made.ticks).toHaveLength(0)
            expect(made.count).toBe(0)
            s.wait(0.5)
            s.play(made.cross(200), { duration: 1 })
            s.wait(0.5)
        }))
        expect(tally(made, 2)).toBe('43')
        // Half way through the clear, the ticks are half gone and the tally is a whole number on its way down.
        expect(old).toHaveLength(43)
        expect(at(2.5, () => old.map(shows))).toEqual(Array(43).fill(0.5))
        expect(tally(made, 2.5)).toBe('22')
        expect(at(3.2, () => old.map(shows))).toEqual(Array(43).fill(0))
        expect(tally(made, 3.2)).toBe('0')
        // The crossing after the clear starts from 0, and it is the only tick.
        expect(tally(made, 5)).toBe('1')
        expect(made.count).toBe(1)
        expect(made.ticks).toHaveLength(1)
        expect(made.ticks[0]!.get('x')).toBe(200)
        expect(at(5, () => [shows(made.ticks[0]!), ...old.map(shows)])).toEqual([1, ...Array(43).fill(0)])
        expectPure(compiled, [0.7, 1.5, 2.5, 3.2, 4.1, 5])
    })

    it('takes away a tick and a count that arrive after the end of a clear that was scheduled after their crossing', async () => {
        let made!: Boundary, lost!: Node
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: true }))
            // An earlier round, from 0 to 1 s: its tick arrived long before the clear of the next round.
            s.play(seq(made.cross(-200), made.clear()), { duration: 1, ease: linear })
            // The crossing is scheduled first, and its mark is on the line at 2 s. The clear is scheduled second, and ends at 1.5 s.
            const crossing = made.cross(0, { duration: 2 })
            s.play({ ...crossing, schedule: (ctx) => { crossing.schedule(ctx); lost = made.ticks[0]! } }, made.clear({ duration: 0.5 }), { ease: linear })
            expect([made.count, made.ticks.length]).toEqual([0, 0])
            // In the other order, the clear has nothing to take away, and the crossing counts.
            s.play(made.clear({ duration: 0.5 }), made.cross(100, { duration: 2 }), { ease: linear })
            s.wait(0.5)
        }))
        // The tick of the second round does not come back after the clear that took it away.
        expect(at(2.5, () => shows(lost))).toBe(0)
        expect(at(3, () => shows(lost))).toBe(0)
        expect([tally(made, 1.9), tally(made, 2.5), tally(made, 3.9)]).toEqual(['0', '0', '0'])
        expect([made.count, made.ticks.length]).toEqual([1, 1])
        expect(at(5, () => shows(made.ticks[0]!))).toBe(1)
        expect([tally(made, 4.1), tally(made, 5)]).toEqual(['1', '1'])
    })

    it('enters with the line first, from the left, then the names and the tally, and a line that waits its turn in a lagged does not show', async () => {
        let first!: Boundary, second!: Boundary
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            first = boundary({ width: 1000, label: 'system call line', above: 'user space', below: 'kernel', tally: 'system calls' }).at(0, -150)
            second = boundary({ width: 1000, label: 'VM wall', tally: 'VM exits' }).at(0, 150)
            s.wait(0.5)
            // With a lag of 1, each line has 1 s: the first from 0.5, the second from 1.5.
            s.play(lagged([first.enter(), second.enter()], { lag: 1 }), { duration: 2, ease: linear })
            s.wait(0.5)
        }))
        expect(compiled.frame(0.2).ops).toHaveLength(0)
        const parts = (made: Boundary) => [made.labelNode, ...made.sides, made.tallyNode].filter((part): part is Node => part !== null)
        // After 0.3 s the line is half drawn, from its left end, and no name shows. The other line is not on screen.
        const drawn = paths(compiled, 0.8)
        expect(drawn).toHaveLength(1)
        const stroke = pathBounds(drawn[0]!.strokePath)!
        expect(stroke.x).toBeCloseTo(960 - 500, 6)
        expect(stroke.width).toBeCloseTo(500, 6)
        expect(at(0.8, () => parts(first).map(shows))).toEqual([0, 0, 0, 0])
        // After 0.6 s the line is whole, and the names and the tally arrive.
        expect(at(1.1, () => first.line.get('trimTo'))).toBe(1)
        expect(at(1.3, () => parts(first).map(shows))).toEqual(Array(4).fill(expect.closeTo(0.5, 6)))
        expect(at(1.4, () => shows(second))).toBe(0)
        expect(at(1.6, () => shows(second))).toBe(1)
        expect(at(2.6, () => [...parts(first), ...parts(second)].map(shows))).toEqual(Array(6).fill(1))
        expect(at(2.6, () => second.line.get('trimTo'))).toBe(1)
    })

    it('comes on stage with its first crossing or its first count, at its turn in a lagged, with the group that holds it', async () => {
        let first!: Boundary, second!: Boundary, third!: Boundary, hidden!: Boundary, pair!: Node
        await compileFilm(film({ fps: 20 }, (s) => {
            first = boundary({ width: 600, tally: true }).at(0, -300)
            second = boundary({ width: 600, tally: true }).at(0, -100)
            third = boundary({ width: 600, tally: true }).at(0, 100)
            pair = group(third, rect(10, 10).at(0, 160))
            hidden = s.add(boundary({ width: 600 }).at(0, 300)).hide()
            s.wait(1)
            // With a lag of 1, each has 1 s: the first from 1, the second from 2, the third from 3, the last from 4.
            s.play(lagged([first.addCrossings(5), second.cross(0), third.addCrossings(5), hidden.enter()], { lag: 1 }), { duration: 4 })
        }))
        expect(at(1.5, () => [first, second, pair, hidden].map(shows))).toEqual([1, 0, 0, 0])
        expect(at(2.5, () => [first, second, pair, hidden].map(shows))).toEqual([1, 1, 0, 0])
        expect(at(3.5, () => [first, second, pair, hidden].map(shows))).toEqual([1, 1, 1, 0])
        expect(at(4.5, () => [first, second, pair, hidden].map(shows))).toEqual([1, 1, 1, 1])
        // The line stays in its group, and the group comes with it.
        expect(third.parent).toBe(pair)
        expect(pair.mounted).toBe(true)
    })

    it('gives a copy its own ticks and its own tally', async () => {
        let made!: Boundary, copy!: Boundary, fresh!: Boundary, twin!: Boundary
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: true }).at(0, -100))
            fresh = s.add(boundary({ width: 1000, tally: true }).at(0, 200))
            // The line has a clear in its past. The copy starts from the count after it.
            s.play(seq(made.cross(50), made.clear(), made.cross(0)), { duration: 1 })
            copy = s.add(made.clone().at(0, 100))
            twin = fresh.clone()
            expect(copy.count).toBe(1)
            expect(copy.ticks).toHaveLength(1)
            expect(copy.ticks[0]).not.toBe(made.ticks[0])
            expect(copy.children).toContain(copy.ticks[0])
            s.play(copy.addCrossings(5), copy.cross(100), twin.cross(0), { duration: 1 })
            // A copy of a line with no tick does not get the ticks that its source gets after.
            const shadow = fresh.clone()
            s.play(fresh.addCrossings(3), { duration: 1 })
            expect([fresh.ticks.length, shadow.ticks.length, shadow.count]).toEqual([3, 0, 0])
        }))
        expect([made.count, copy.count, fresh.count, twin.count]).toEqual([1, 7, 3, 1])
        // The copy has its first tick, five ticks for the five crossings with no mark, and the tick of its own crossing.
        expect([made.ticks.length, copy.ticks.length, fresh.ticks.length, twin.ticks.length]).toEqual([1, 7, 3, 1])
        expect([tally(made, compiled.duration), tally(copy, compiled.duration), tally(fresh, compiled.duration)]).toEqual(['1', '7', '3'])
    })

    it('gives a copy that is made with its group or its zone its own tally and its own ticks', async () => {
        for (const hold of [(inner: Boundary) => group(inner, rect(10, 10).at(0, 120)), (inner: Boundary) => zone(inner, { title: 'guest' })]) {
            let first!: Boundary, second!: Boundary, late!: Boundary
            await compileFilm(film({ fps: 20 }, (s) => {
                first = boundary({ width: 700, tally: true })
                const holder = s.add(hold(first).at(0, -300))
                // A copy of the holder, made before any crossing. Then only the first line is crossed.
                second = lineIn(s.add(holder.clone().at(0, 0)))
                expect(second).not.toBe(first)
                s.play(lagged([-100, 0].map((x) => first.cross(x))), { duration: 1 })
                expect([first.count, second.count, first.ticks.length, second.ticks.length]).toEqual([2, 0, 2, 0])
                s.play(second.cross(100), { duration: 1 })
                expect([first.count, second.count, first.ticks.length, second.ticks.length]).toEqual([2, 1, 2, 1])
                // A copy that is made later starts from what the first line shows then.
                late = lineIn(s.add(holder.clone().at(0, 300)))
                expect([late.count, late.ticks.length]).toEqual([2, 2])
                s.play(first.addCrossings(9998), { duration: 1 })
                s.play(first.clear(), { duration: 1 })
                expect([first.count, second.count, late.count]).toEqual([0, 1, 2])
                s.play(late.cross(200), { duration: 1 })
            }))
            // What each line shows is its own count, at each time.
            expect([tally(first, 2), tally(second, 2), tally(late, 2)]).toEqual(['2', '1', '2'])
            expect([tally(first, 3), tally(second, 3), tally(late, 3)]).toEqual(['10,000', '1', '2'])
            expect([tally(first, 5), tally(second, 5), tally(late, 5)]).toEqual(['0', '1', '3'])
            expect(ticksAt(second, 5)).toEqual([100])
            expect(ticksAt(late, 5)).toEqual([-100, 0, 200])
            expect(ticksAt(first, 5)).toEqual([])
        }
    })

    it('lets a copy clear its ticks after its source has cleared its own', async () => {
        let made!: Boundary, copy!: Boundary, kept!: readonly Node[]
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: true }).at(0, -100))
            s.play(lagged([-100, 0, 100].map((x) => made.cross(x))), { duration: 1 })
            copy = s.add(made.clone().at(0, 100))
            kept = copy.ticks
            s.play(made.clear(), { duration: 1 })
            s.play(copy.clear(), { duration: 1, ease: linear })
        }))
        // The copy keeps the arrival times of its own ticks, so its clear fades them as the clear of the source did.
        expect(kept).toHaveLength(3)
        expect(at(2, () => kept.map(shows))).toEqual([1, 1, 1])
        expect(at(2.5, () => kept.map(shows))).toEqual([0.5, 0.5, 0.5])
        expect(at(3, () => kept.map(shows))).toEqual([0, 0, 0])
        expect(tally(copy, 3)).toBe('0')
    })

    it('fills the line with one tick for each crossing that has no mark, from the left, while the number runs', async () => {
        let made!: Boundary, eased!: Boundary
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, below: 'kernel', tally: ['crossing', 'crossings'] }))
            eased = s.add(boundary({ width: 1000, tally: true }).at(0, 200))
            s.wait(1)
            // The other line gets the tick of a crossing at its left end, which is before its first place.
            s.play(made.addCrossings(40), eased.cross(-500, { counts: 0 }), { duration: 2, ease: linear })
            // From 3 to 5, with an ease that has done half of its way after 0.7071 of the time: at 4.4142.
            s.play(eased.addCrossings(40), { duration: 2, ease: (t) => t * t })
        }))
        // A tick arrives when the number has run its share: half of the ticks with half of the count.
        expect([ticksAt(eased, 4.42).length - 1, tally(eased, 4.42)]).toEqual([20, '20'])
        // The tick at the end of the line is not a place of the fill: the fill starts at the first place.
        expect(ticksAt(eased, 5).slice(0, 2)).toEqual([-500, expect.closeTo(eased.x(0), 6)])
        for (const tick of made.ticks) expect(tick.get('stroke')).toEqual(made.line.get('stroke'))
        const places = ticksAt(made, 3)
        expect(places).toHaveLength(40)
        // The ticks start at the first place and stand as near to each other as ticks can and still read as ticks.
        expect(places[0]).toBeCloseTo(made.x(0), 6)
        const steps = places.slice(1).map((x, index) => x - places[index]!)
        expect(Math.min(...steps)).toBeGreaterThanOrEqual(6)
        expect(Math.max(...steps)).toBeLessThan(7)
        // Half way, the left half of the ticks is on the line, and the tally is 20.
        expect(ticksAt(made, 2)).toEqual(places.slice(0, 20))
        expect(tally(made, 2)).toBe('20')
        expect(ticksAt(made, 1)).toEqual([])
        // One tick is one crossing, so no note says what a tick stands for.
        expect(made.noteNode).toBeNull()
    })

    it('fills the whole line for a count that is larger than the line, and says under the line what one tick stands for', async () => {
        let made!: Boundary, note!: Node, old!: readonly Node[]
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, label: 'system call line', above: 'user space', below: 'kernel', tally: ['system call', 'system calls'] }))
            s.play(lagged([0, 0.37, 1].map((part) => made.cross(made.x(part)))), { duration: 1 })
            expect(made.noteNode).toBeNull()
            s.play(made.addCrossings(9997), { duration: 2, ease: linear })
            note = made.noteNode!
            old = made.ticks
            s.wait(1)
            s.play(made.clear(), { duration: 1 })
            expect([made.ticks.length, made.noteNode]).toEqual([0, null])
            s.play(made.addCrossings(5), { duration: 1 })
            // The note needs room beside the name of the side under the line. The line measures that room in its own coordinates, wherever it is on the stage.
            const moved = s.add(boundary({ width: 560, above: 'user space', below: 'kernel', tally: 'system calls' }).at(680, -400))
            expect(() => s.play(moved.addCrossings(313))).not.toThrow()
            const tight = s.add(boundary({ width: 680, below: 'the kernel of the host, and its KVM module', tally: true, tallyDigits: 3 }).at(-600, 300))
            expect(() => s.play(tight.addCrossings(999))).toThrow(/a line of 680 has no room under it for the note "each tick: about 250" beside the name of the side. Make the line longer, or the name shorter/)
            // A free part of 3, which is less than the room of two ticks, has one place. So a large count is one tick, and the note says so.
            const names = { label: 'system call line', tally: 'system calls' }
            const probe = boundary({ ...names, width: 600 })
            const short = s.add(boundary({ ...names, width: 600 - (probe.x(1) - probe.x(0)) + 3 }).at(0, 450))
            expect(short.x(1) - short.x(0)).toBeCloseTo(3, 6)
            s.play(short.addCrossings(50))
            expect(short.ticks.map((tick) => tick.get('x'))).toEqual([short.x(0)])
            expect(said(short.noteNode!)).toBe('each tick: about 50')
        }))
        const places = ticksAt(made, 3, old)
        expect(places).toHaveLength(old.length)
        // The line is full: ticks from the first place to the last, none nearer than 6, and no break around the tick of a crossing.
        expect(places[0]).toBeCloseTo(made.x(0), 6)
        expect(places[places.length - 1]).toBeCloseTo(made.x(1), 6)
        expect(places).toContain(made.x(0.37))
        const steps = places.slice(1).map((x, index) => x - places[index]!)
        expect(Math.min(...steps)).toBeGreaterThanOrEqual(6)
        expect(Math.max(...steps)).toBeLessThan(7)
        // The note says what one tick stands for, and the ticks times that number is the count, within a twentieth.
        expect(said(note)).toMatch(/^each tick: about \d+$/)
        const each = Number(said(note).replace(/\D/g, ''))
        expect(Math.abs(each * places.length - 10000)).toBeLessThan(500)
        // It is small, under the line at its right end, and clear of the name of the side under the line.
        const box = at(3.5, () => note.bounds())
        expect(note.data['size']).toBeLessThan(26)
        expect(right(box)).toBeCloseTo(500, 6)
        expect(box.y).toBeGreaterThan(1.5 + 6)
        expect(box.x).toBeGreaterThan(right(made.sides[1]!.bounds()) + 15)
        // With the tally at the end of the line, the note is next to the line, on the row of the name under it.
        expect(bottom(box)).toBeCloseTo(bottom(made.sides[1]!.bounds()), 0)
        // It arrives in the first part of the run, from 1 to 1.6, so a viewer can read it while the number runs. A clear takes it away with the ticks.
        expect([1, 1.3, 1.6, 3, 5.1].map((time) => at(time, () => shows(note)))).toEqual([0, expect.closeTo(0.5, 6), 1, 1, 0])
        expect(ticksAt(made, 5.1, old)).toEqual([])
        // The next round has one tick for each crossing again, from the first place, and no note.
        expect(ticksAt(made, 6)).toHaveLength(5)
        expect(ticksAt(made, 6)[0]).toBeCloseTo(made.x(0), 6)
        expect(made.noteNode).toBeNull()
    })

    it('changes the note when the count of a full line grows, and the old note leaves before the new one comes', async () => {
        let made!: Boundary, first!: Node, second!: Node, third!: Node
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, below: 'kernel', tally: true }))
            s.play(made.addCrossings(10000), { duration: 1, ease: linear })
            first = made.noteNode!
            const ticks = made.ticks.length
            // With no tick of a crossing on the line, the ticks go from the first place to the last.
            expect([made.ticks[0]!.get('x'), made.ticks[ticks - 1]!.get('x')]).toEqual([expect.closeTo(made.x(0), 6), expect.closeTo(made.x(1), 6)])
            // The line is full. After the second run, from 1 to 2, the same ticks stand for two times as much.
            s.play(made.addCrossings(10000), { duration: 1, ease: linear })
            second = made.noteNode!
            expect(made.ticks).toHaveLength(ticks)
            // After a clear, the next full round has its note again.
            s.play(made.clear(), { duration: 1 })
            s.play(made.addCrossings(10000), { duration: 1, ease: linear })
            third = made.noteNode!
            // A count that is a little more than the places of the line has no note: "about 1" says nothing.
            const near = s.add(boundary({ width: 1000, below: 'kernel', tally: true }).at(0, 200))
            s.play(near.addCrossings(ticks + 5))
            expect([near.ticks.length, near.noteNode]).toEqual([ticks, null])
        }))
        expect(said(third)).toBe(said(first))
        expect(at(4, () => [shows(second), shows(third)])).toEqual([0, 1])
        expect(second).not.toBe(first)
        const each = (note: Node) => Number(said(note).replace(/\D/g, ''))
        expect(each(second) / each(first)).toBeCloseTo(2, 1)
        // The old note leaves in the first 0.3 s of the run, and the new one comes in the next 0.3 s. So the two are never on each other.
        expect([1, 1.15, 1.3, 1.45, 1.6].map((time) => at(time, () => [shows(first), shows(second)]))).toEqual([[1, 0], [expect.closeTo(0.5, 6), 0], [0, 0], [0, expect.closeTo(0.5, 6)], [0, 1]])
    })

    it('gives lines with one tickScale ticks that compare as their counts do', async () => {
        const shared = { width: 560, above: 'user space', below: 'kernel', tally: ['system call', 'system calls'], tallySide: 'over', tickScale: 200 } as const
        let lines!: Boundary[], low!: ReturnType<Boundary['cross']>, room!: { x: number; y: number; width: number; height: number }, early!: Node
        await compileFilm(film({ fps: 20 }, (s) => {
            lines = [boundary({ ...shared, label: 'read()' }).at(-620, 0), boundary({ ...shared, label: 'batches of 32' }).at(0, 0), boundary({ ...shared, label: 'polling' }).at(620, 0)]
            const [reads, batches, polling] = lines as [Boundary, Boundary, Boundary]
            s.add(reads, batches, polling)
            room = polling.bounds()
            low = polling.cross(polling.x(1), { direction: 'up', label: 'irq' })
            s.play(lagged([0, 0.5, 1].map((part) => reads.cross(reads.x(part)))), { duration: 1 })
            // With a scale of 200, three crossings are less than one tick more: the first leaves a tick, the next two do not.
            expect([reads.count, reads.ticks.length]).toEqual([3, 1])
            // One tick for three crossings: the note comes with the crossings, and the run that follows keeps it.
            early = reads.noteNode!
            expect(said(early)).toBe('each tick: about 200')
            s.play(reads.addCrossings(9997), seq(batches.cross(batches.x(0)), batches.cross(batches.x(1))), polling.cross(polling.x(0.5)), { duration: 1 })
            s.play(batches.addCrossings(311), { duration: 1 })
            // The rounds of one line compare the same way: 50 ticks for 10,000, then 2 ticks for 313 after a clear.
            const rounds = s.add(boundary({ ...shared }).at(0, 300))
            s.play(rounds.addCrossings(10000), { duration: 1 })
            expect(rounds.ticks).toHaveLength(50)
            s.play(rounds.clear(), { duration: 1 })
            s.play(rounds.addCrossings(313), { duration: 1 })
            expect([rounds.ticks.length, said(rounds.noteNode!)]).toEqual([2, 'each tick: about 200'])
            // A count that needs more ticks than the line has room for is an error that gives the least scale.
            const tight = s.add(boundary({ width: 560, tally: true, tickScale: 40, below: 'kernel' }).at(0, 300))
            expect(() => s.play(tight.addCrossings(10000))).toThrow(/with a tickScale of 40, a count of 10,000 is 250 ticks, and the line has room for \d+. Give a tickScale of \d+ or more, or a longer line/)
            expect(() => boundary({ tickScale: 0.5 })).toThrow(/tickScale is 0.5. Give the number of crossings that one tick stands for, 1 or more/)
        }))
        expect(lines.map((made) => made.count)).toEqual([10000, 313, 1])
        // 10,000, 313 and 1 crossings at 200 for each tick: 50 ticks, 2 ticks and 1 tick.
        expect(lines.map((made) => ticksAt(made, 3).length)).toEqual([50, 2, 1])
        // Where the ticks stand for more than they are, the note says so, with the same words on each line.
        expect(lines.map((made) => (made.noteNode ? said(made.noteNode) : null))).toEqual(['each tick: about 200', 'each tick: about 200', null])
        expect(lines.slice(0, 2).map((made) => at(3, () => shows(made.noteNode!)))).toEqual([1, 1])
        expect(lines[0]!.noteNode).toBe(early)
        // With the tally over the line, marks cross up to its right end. So the note is at that end, under the way of a mark and of its text.
        const note = at(3, () => lines[0]!.noteNode!.bounds())
        expect(right(note)).toBeCloseTo(-620 + 280, 6)
        expect(note.y).toBeGreaterThan(bottom(low.mark.bounds()) + 8)
        expect(note.y).toBeGreaterThan(bottom(low.labelNode!.bounds()) + 6)
        // A line of this kind keeps room for the note from the start, so a zone around it holds the note that comes later.
        expect(bottom(room)).toBeGreaterThanOrEqual(bottom(note))
        expect(bottom(room)).toBeLessThan(bottom(note) + 6)
    })

    it('says the word for one when the tally is 1, and the word for more for any other count', async () => {
        let made!: Boundary, runs!: Boundary, single!: Boundary
        const pairs: Boundary[] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: ['system call', 'system calls'] }))
            s.play(made.cross(0), { duration: 1, ease: linear })
            s.play(made.cross(100), { duration: 1, ease: linear })
            // From 2 to 3 the number runs from 0 to 313, and from 3 to 4 back to 0. From 4 to 5 it goes from 0 to 1, and from 5 to 6 back to 0.
            runs = s.add(boundary({ width: 1000, tally: ['system call', 'system calls'] }).at(0, 200))
            single = s.add(boundary({ width: 1000, tally: ['system call', 'system calls'] }).at(0, 400))
            s.play(runs.addCrossings(313), single.addCrossings(1), { duration: 1, ease: linear })
            s.play(runs.clear(), { duration: 1, ease: linear })
            s.play(runs.addCrossings(1), { duration: 1, ease: linear })
            s.play(runs.clear(), { duration: 1, ease: linear })
            // Two crossings on a new line, one after the other. Each mark is on the line at the middle of its time, so the tally is 1 for `seconds`.
            const twice = (words: readonly [string, string], seconds: number) => {
                const line = s.add(boundary({ width: 1000, tally: words }))
                s.play(line.cross(-100), { duration: seconds, ease: linear })
                s.play(line.cross(100), { duration: seconds, ease: linear })
                pairs.push(line)
            }
            // From 6: the tally is 1 from 6.2 to 6.6, then on the next lines from 7.06 to 7.58, and from 8.12 to 8.68.
            for (const seconds of [0.4, 0.52, 0.56]) twice(['system call', 'system calls'], seconds)
            // From 8.96, with a short word: the tally is 1 from 9.16 to 9.56, and on the last line from 10.02 to 10.54.
            for (const seconds of [0.4, 0.52]) twice(['hit', 'hits'], seconds)
            // One word is the word for every count. An empty word, or a pair of empty words, is the number alone, at the right end.
            expect([0.2, 0.8].map((time) => said(word(s.add(boundary({ tally: 'calls' })), time)))).toEqual(['calls', 'calls'])
            for (const empty of ['', '  ', ['', ''] as const]) {
                const alone = boundary({ width: 1000, tally: empty })
                expect(alone.tallyNode!.children).toHaveLength(1)
                expect(right(alone.tallyNode!.bounds())).toBeGreaterThan(500 - 4)
                expect(right(alone.tallyNode!.bounds())).toBeLessThanOrEqual(500)
            }
            expect(() => boundary({ tally: ['system call', ''] })).toThrow(/tally has a word for one count and none for the other/)
            expect(() => boundary({ tally: ['a', 'b', 'c'] as never })).toThrow(/tally is true, a word, or the word for one and the word for more/)
        }))
        expect([0.2, 0.8, 1.8].map((time) => said(word(made, time)))).toEqual(['system calls', 'system call', 'system calls'])
        expect([0.2, 0.8, 1.8].map((time) => tally(made, time))).toEqual(['0', '1', '2'])
        for (const time of [0.2, 0.8, 1.8]) {
            // The word ends at the right end of the line, and the number ends just before the word.
            const [number, words] = at(time, () => made.tallyNode!.children.map((part) => part.bounds()))
            expect(right(words!)).toBeCloseTo(500, 6)
            expect(right(number!)).toBeLessThan(words!.x - 3)
            expect(right(number!)).toBeGreaterThan(words!.x - 12)
        }
        // A number that runs shows 1 for a moment on its way. The word for one there would change the word for one frame, so the word for more stays.
        const reads = (time: number) => [tally(runs, time), said(word(runs, time))]
        expect([2.003, 3.997].map(reads)).toEqual([['1', 'system calls'], ['1', 'system calls']])
        // The last digit keeps its place before the word.
        const last = (time: number) => glyphs(runs, time).map((glyph) => glyph.get('x')).pop()
        expect(last(2.003)).toBe(last(2.5))
        expect(last(4.7)).toBeGreaterThan(last(2.5)! + 3)
        // Where the tally starts or ends at 1, the word changes when the number does.
        expect([4.3, 4.7, 5.3, 5.7].map(reads)).toEqual([['0', 'system calls'], ['1', 'system call'], ['1', 'system call'], ['0', 'system calls']])
        expect([2.3, 2.7, 6].map((time) => [tally(single, time), said(word(single, time))])).toEqual([['0', 'system calls'], ['1', 'system call'], ['1', 'system call']])
        // A viewer needs 0.55 s to read "system call": one second for 20 characters. Between two crossings that are nearer in time, the tally is 1 and keeps the word for more.
        const quick = (line: number, time: number) => [tally(pairs[line]!, time), said(word(pairs[line]!, time))]
        expect([quick(0, 6.4), quick(1, 7.1), quick(1, 7.32), quick(1, 7.55)]).toEqual(Array(4).fill(['1', 'system calls']))
        // With 0.56 s between the two, the word for one shows from the first moment of that time to the last, with no change between.
        expect([quick(2, 8.11), quick(2, 8.69)]).toEqual([['0', 'system calls'], ['2', 'system calls']])
        for (const time of [8.13, 8.2, 8.25, 8.3, 8.4, 8.5, 8.6, 8.67]) expect(quick(2, time), `at ${time}`).toEqual(['1', 'system call'])
        // A short word needs half a second, and no less.
        expect([quick(3, 9.36), quick(4, 10.28)]).toEqual([['1', 'hits'], ['1', 'hit']])
    })

    it("puts the tally on a row of its own with tallySide 'over', so that a narrow line keeps room for crossings", async () => {
        await compileFilm(film(() => {
            const names = { label: 'batches of 32', above: 'user space', below: 'kernel', tally: ['system call', 'system calls'] } as const
            // At the end of the line, the tally takes most of a line of 560. At size 38 no crossing has room.
            expect(() => boundary({ ...names, width: 560, size: 38 })).toThrow(/no room for a crossing.*or put the tally on a row of its own with tallySide: 'over'/)
            const end = boundary({ ...names, width: 560 }), over = boundary({ ...names, width: 560, tallySide: 'over' }), large = boundary({ ...names, width: 560, size: 38, tallySide: 'over' })
            expect(end.x(1) - end.x(0)).toBeLessThan(80)
            expect(over.x(1) - over.x(0)).toBeGreaterThan(300)
            expect(large.x(1) - large.x(0)).toBeGreaterThan(150)
            // The free part goes to the right end of the line, less a small margin.
            expect(over.x(1)).toBeGreaterThan(280 - 26)
            expect(over.x(1)).toBeLessThan(280)
            // The tally still ends at the right end. It is over the label and over a mark with the reach of the line, and its text.
            const box = over.tallyNode!.bounds(), under = over.cross(over.x(1), { label: 'read()' })
            expect(right(box)).toBeCloseTo(280, 6)
            expect(bottom(box)).toBeLessThan(under.mark.bounds().y - 6)
            expect(bottom(box)).toBeLessThan(under.labelNode!.bounds().y - 4)
            expect(bottom(box)).toBeLessThan(over.labelNode!.bounds().y)
            // A mark that starts higher, under the tally, would go into it. To the left of the tally it has room.
            expect(() => over.cross(over.x(1), { reach: 110 })).toThrow(/with a reach of 110, the mark at x = \d+ goes into the tally. Under the tally a mark has a reach of 70 at most: give a smaller reach, or a place before -?\d+/)
            expect(() => over.cross(over.x(0), { reach: 110 })).not.toThrow()
            expect(() => boundary({ width: 200, tally: ['system call', 'system calls'], tallySide: 'over' })).toThrow(/a line of 200 is too short for its tally, which needs \d+/)
            expect(() => boundary({ tally: true, tallySide: 'top' as never })).toThrow(/tallySide is "top". Use 'end' or 'over'/)
        }))
    })

    it('gives the tally its own size and its own color, with room for its digits at that size', async () => {
        let made!: Boundary
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, label: 'line', tally: 'system calls', tallySize: 48, tallyColor: 'teal' }))
            s.play(made.addCrossings(999999), { duration: 1 })
            expect(() => boundary({ tally: true, tallySize: 0 })).toThrow(/tallySize is a text size/)
        }))
        const digit = glyphs(made, 1)[0]!, words = word(made, 1)
        expect([digit.data['size'], words.data['size'], made.labelNode!.data['size']]).toEqual([48, 48, 26])
        // Each digit has a place as wide as a digit of that size, so the digits do not touch.
        expect(glyphs(made, 1)[1]!.get('x') - digit.get('x')).toBeGreaterThanOrEqual(digit.get('px') * 2)
        // The number has the color. The word stays dim.
        const teal = line([0, 0], [1, 0], { stroke: 'teal' }).get('stroke'), dim = line([0, 0], [1, 0], { stroke: 'dim' }).get('stroke')
        expect([digit.children[0]!.get('fill'), words.children[0]!.get('fill')]).toEqual([teal, dim])
        // The larger tally is still over the line, and the last place is clear of its six digits.
        const box = at(compiled.duration, () => made.tallyNode!.bounds())
        expect(bottom(box)).toBeLessThan(-1.5 - 8)
        expect(made.x(1)).toBeLessThan(box.x - 24)
    })

    it('refuses a count with more digits than the tally has room for, and keeps the last place clear with tallyDigits', async () => {
        let seven!: Boundary, six!: Boundary
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            six = s.add(boundary({ width: 1000, tally: 'calls' }).at(0, -100))
            seven = s.add(boundary({ width: 1000, tally: 'calls', tallyDigits: 7 }).at(0, 100))
            expect(() => s.play(six.addCrossings(1234567))).toThrow(/a tally of 1,234,567 has more than the 6 digits that the line keeps room for. Give the line tallyDigits: 7/)
            s.play(six.addCrossings(999999), seven.addCrossings(8888888), { duration: 1 })
            expect(() => s.play(six.cross(0))).toThrow(/a tally of 1,000,000 has more than the 6 digits/)
            expect(() => boundary({ tally: true, tallyDigits: 0 })).toThrow(/tallyDigits is 0/)
        }))
        expect(tally(seven, compiled.duration)).toBe('8,888,888')
        // The note of a large count keeps two digits that count, with the separator of the tally.
        expect(said(seven.noteNode!)).toMatch(/^each tick: about [1-9]\d?(0|,)*$/)
        expect(said(seven.noteNode!)).toContain(',')
        for (const made of [six, seven]) expect(made.x(1)).toBeLessThan(at(compiled.duration, () => made.tallyNode!.bounds().x) - 24)
        expect(seven.x(1)).toBeLessThan(six.x(1) - 10)
    })

    it('puts the text of a crossing where it touches no name and no tally, and refuses a text with no room on either side', async () => {
        await compileFilm(film(() => {
            const touches = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a)
            // At size 40 the mark starts 108 over the line, so its text is over the row of the tally at each place.
            const big = boundary({ width: 1200, size: 40, label: 'system call line', above: 'user space', below: 'kernel', tally: 'system calls' })
            for (const part of [0, 0.5, 1]) {
                for (const direction of ['down', 'up'] as const) {
                    const text = big.cross(big.x(part), { label: 'read()', direction }).labelNode!.bounds()
                    for (const fixed of [big.labelNode!, big.sides[0]!, big.sides[1]!, big.tallyNode!]) expect(touches(text, fixed.bounds()), `${direction} at ${part}`).toBe(false)
                    expect(text.x).toBeGreaterThanOrEqual(-600)
                    expect(right(text)).toBeLessThanOrEqual(600)
                }
            }
            // On a line of 560, a long text has no room: on the right it passes the end of the line, on the left it is on the names.
            const narrow = boundary({ width: 560, label: 'io_uring', above: 'user', below: 'kernel', tally: 'calls' })
            expect(() => narrow.cross(narrow.x(0.5), { label: 'io_uring_enter(to_submit=32)' })).toThrow(/the text "io_uring_enter\(to_submit=32\)" of the crossing at x = -?\d+ has no room beside its mark: it is \d+ wide.*Give a shorter text, another place, another reach, or a longer line/)
            expect(() => narrow.cross(narrow.x(0.5), { label: 'enter' })).not.toThrow()
            // With a small reach the text would be on the row of the tally, so it goes to the side that is clear of it.
            const low = narrow.cross(narrow.x(1), { label: 'enter', reach: 24 })
            expect(touches(low.labelNode!.bounds(), narrow.tallyNode!.bounds())).toBe(false)
            expect(right(low.labelNode!.bounds())).toBeLessThan(narrow.x(1))
            // A text that is too long for the free part takes a side where it touches no name and no tally. Over the row of the tally, that is the right.
            const middle = narrow.x(0.5)
            expect(narrow.cross(middle, { label: 'io_uring_en' }).labelNode!.bounds().x).toBeGreaterThan(middle)
            // On the row of the tally, the right is on the tally, so the text goes to the left.
            const beside = narrow.cross(middle, { label: 'io_uring_en', reach: 24 }).labelNode!.bounds()
            expect(right(beside)).toBeLessThan(middle)
            for (const fixed of [narrow.labelNode!, narrow.sides[0]!, narrow.tallyNode!]) expect(touches(beside, fixed.bounds())).toBe(false)
            // A longer text on that row is on the tally at the right and on the names at the left. Higher, it has room.
            expect(() => narrow.cross(middle, { label: 'io_uring_enter(32)', reach: 24 })).toThrow(/has no room beside its mark/)
            expect(() => narrow.cross(middle, { label: 'io_uring_enter(32)' })).not.toThrow()
        }))
    })

    it('has bounds that hold the way of a mark, so that a zone around the line leaves room for a crossing', async () => {
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            const made = boundary({ width: 760, label: 'system call line', above: 'guest user space', below: 'guest kernel', tally: 'system calls' })
            const box = made.bounds()
            expect([box.x, right(box)]).toEqual([expect.closeTo(-380, 6), expect.closeTo(380, 6)])
            expect(box.y).toBeLessThanOrEqual(-70 - 7)
            expect(bottom(box)).toBeGreaterThanOrEqual(70 + 7)
            const crossings = [made.cross(made.x(0), { label: 'read()' }), made.cross(made.x(1), { direction: 'up', label: 'irq' }), made.cross(made.x(0.5), { direction: 'round' })]
            const vm = s.add(zone(made, { title: 'microVM' }).at(-200, 100))
            const border = { x: vm.box.x + vm.get('x'), y: vm.box.y + vm.get('y'), width: vm.box.width, height: vm.box.height }
            // With the padding that a zone has by default, each mark and each text is inside the border, with room.
            for (const crossing of crossings) {
                for (const part of crossing.labelNode ? [crossing.mark, crossing.labelNode] : [crossing.mark]) {
                    made.add(part)
                    const own = part.bounds()
                    expect(own.x - border.x).toBeGreaterThan(20)
                    expect(right(border) - right(own)).toBeGreaterThan(20)
                    expect(own.y - border.y).toBeGreaterThan(20)
                    expect(bottom(border) - bottom(own)).toBeGreaterThan(20)
                }
            }
            const bare = s.add(boundary({ width: 400 }).at(0, -300))
            // A mark that starts farther than the bounds of the line, and its text, do not stay in the bounds after the crossing.
            const before = bare.bounds()
            s.play(bare.cross(0, { reach: 200, label: 'far' }), { duration: 1 })
            s.wait(0.5)
            expect(bare.bounds()).toEqual(before)
        }))
        // The shape that gives the bounds draws nothing: a bare line is one stroke, and the zone has its border and its title.
        expect(paths(compiled, 0).filter((op) => pathBounds(op.path)!.y < 540 - 250)).toHaveLength(1)
    })

    it('brings the ticks back after the line when a line with ticks enters again', async () => {
        let made!: Boundary
        await compileFilm(film({ fps: 20 }, (s) => {
            // Each crossing counts 10, at 10 for one tick: two ticks, and a note, because a tick stands for more than one.
            made = boundary({ width: 1000, above: 'user space', tally: true, tickScale: 10 })
            // The film dims a name. It stays dim when the line enters again.
            made.sides[0]!.opacity(0.4)
            s.add(made)
            s.play(lagged([-100, 100].map((x) => made.cross(x, { counts: 10 }))), { duration: 1 })
            s.play(fadeOut(made), { duration: 0.5 })
            s.wait(0.5)
            // From 2 to 3: the line draws until 2.6, then the name, the tally, the note and the ticks arrive.
            s.play(made.enter(), { duration: 1, ease: linear })
        }))
        const parts = () => [...made.ticks, made.tallyNode!, made.noteNode!, made.sides[0]!].map(shows)
        expect(made.ticks).toHaveLength(2)
        expect(at(2.3, () => [shows(made), made.line.get('trimTo'), ...parts()])).toEqual([1, expect.closeTo(0.5, 6), 0, 0, 0, 0, 0])
        expect(at(2.8, parts)).toEqual([...Array(4).fill(expect.closeTo(0.5, 6)), expect.closeTo(0.2, 6)])
        expect(at(3, parts)).toEqual([1, 1, 1, 1, expect.closeTo(0.4, 6)])
    })

    it('lets an emphasis tint the whole tally, the digits and the word', async () => {
        let made!: Boundary
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: 'system calls', tallyColor: 'teal' }))
            s.play(made.cross(0, { counts: 1234 }), { duration: 1 })
            // The emphasis is at its peak at 1.5, and back at 2.
            s.play(indicate(made.tallyNode!, { color: 'red' }), { duration: 1 })
            s.wait(0.5)
        }))
        const paint = (color: string) => line([0, 0], [1, 0], { stroke: color }).get('stroke')
        // Every glyph of this film is a glyph of the tally: five of the number, then eleven of the word.
        const fills = (time: number) => paths(compiled, time).filter((op) => op.fill).map((op) => op.fill)
        expect(fills(1)).toEqual([...Array(5).fill(paint('teal')), ...Array(11).fill(paint('dim'))])
        expect(fills(1.5)).toEqual(Array(16).fill(paint('red')))
        expect(fills(2.2)).toEqual(fills(1))
        // The number and the word grow as one, about the middle of the tally.
        const widthAt = (time: number) => at(time, () => made.tallyNode!.bounds().width)
        expect(widthAt(1.5)).toBeGreaterThan(widthAt(1) * 1.1)
    })

    it('sends one mark through two lines, and each line lights, keeps a tick and counts when the mark is on it', async () => {
        let calls!: Boundary, wall!: Boundary, down!: ReturnType<typeof crossThrough>, round!: ReturnType<typeof crossThrough>, up!: ReturnType<typeof crossThrough>, lone!: Boundary[]
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            calls = s.add(boundary({ width: 800, tally: true, label: 'calls' }).at(100, -150))
            // The second line is 40 to the right of the first, so a place on it has another x than on the first.
            wall = s.add(boundary({ width: 800, tally: true, weight: 6, color: 'red', label: 'wall' }).at(140, 190))
            s.wait(1)
            // From 1 to 3, the mark goes 500 down: from 80 over the first line to 80 under the second.
            down = crossThrough([calls, wall], 50, { reach: 80, label: 'write()' })
            s.play(down, { duration: 2, ease: linear })
            // From 3 to 7, a round trip: down until 5, then back.
            round = crossThrough([calls, wall], -100, { direction: 'round', reach: 80 })
            s.play(round, { duration: 4, ease: linear })
            // From 7 to 9, up from under the wall. The lines are in the order that the mark meets them.
            up = crossThrough([wall, calls], 0, { direction: 'up', reach: 80 })
            s.play(up, { duration: 2, ease: linear })
            // Without a length, a crossing through two lines takes two times the length of a crossing of one.
            expect([down.duration, round.duration]).toEqual([1.6, 2.8])
            expect(() => crossThrough([calls], 0)).toThrow(/give it two lines or more. For one line, use line.cross\(x\)/)
            expect(() => crossThrough([wall, calls], 0)).toThrow(/give the lines in the order that the mark meets them/)
            expect(() => crossThrough([calls, wall], 401)).toThrow(/x is 401, and the line runs from -400 to 400/)
            // The second line is 300 to the right here, so the mark would come down through its label.
            const shifted = boundary({ width: 800, label: 'a label', tally: true }).at(400, 400)
            expect(() => crossThrough([calls, shifted], -50)).toThrow(/the mark meets line 1 at x = -350 of that line, under its names or its tally. Its free part runs from -?\d+ to \d+/)
            // A tally that is over its line is in the way of a mark that comes from the line over it.
            const roofed = boundary({ width: 800, tally: true, tallySide: 'over' }).at(100, 400)
            expect(() => crossThrough([calls, roofed], 340)).toThrow(/the mark meets line 1 at x = 340 of that line, under its names or its tally/)
            expect(() => crossThrough([calls, roofed], 200)).not.toThrow()
            // From 9 to 11, with an ease that has done 0.16 of its way after 0.4 of the time, and 0.84 after 0.9165.
            s.play(crossThrough([calls, wall], 200, { reach: 80, counts: 5 }), { duration: 2, ease: (t) => t * t })
            // From 11 to 12, through two lines that are not on the stage: they come with the mark.
            lone = [boundary({ width: 300 }).at(-700, -300), boundary({ width: 300 }).at(-700, -200)]
            s.play(crossThrough(lone, 0, { reach: 40 }), { duration: 1 })
        }))
        const place = (crossing: typeof down, time: number) => at(time, () => [crossing.mark.get('x'), crossing.mark.get('y')])
        // The mark is on the stage, at the x of the place on the first line, and it moves at one speed.
        expect(place(down, 1)).toEqual([150, -230])
        expect(place(down, 2)).toEqual([150, expect.closeTo(20, 6)])
        expect(place(down, 3)).toEqual([150, expect.closeTo(270, 6)])
        expect(down.mark.parent).toBe(compiled.stage.root)
        expect(at(2, () => shows(down.mark))).toBe(1)
        expect(at(3.1, () => shows(down.mark))).toBe(0)
        // It is on the first line after 80 of 500 and on the second after 420 of 500. Each line counts at its moment.
        expect([tally(calls, 1.3), tally(calls, 1.34), tally(wall, 2.66), tally(wall, 2.7)]).toEqual(['0', '1', '0', '1'])
        // The light of a line is a piece with a glow, at the height of that line: 390 and 730 on the frame.
        const lit = (time: number, y: number) => paths(compiled, time).filter((op) => op.glow > 0 && Math.abs(pathBounds(op.path)!.y - y) < 1).length
        expect([lit(1.32, 390), lit(1.32, 730), lit(2.68, 390), lit(2.68, 730), lit(2, 390), lit(2, 730)]).toEqual([1, 0, 0, 1, 0, 0])
        // Each line has its tick at its own place under the mark: 150 on the stage is 50 on the first line and 10 on the second.
        expect([calls.ticks[0]!.get('x'), wall.ticks[0]!.get('x')]).toEqual([50, expect.closeTo(10, 6)])
        // The text is beside the start, in the first line, and it fades with the mark.
        expect(down.labelNode!.parent).toBe(calls)
        const text = at(1.5, () => down.labelNode!.bounds())
        expect(text.x).toBeGreaterThan(150 + 8)
        expect(text.y + text.height / 2).toBeCloseTo(-230, -1)
        expect([0.9, 2, 3.1].map((time) => at(time, () => shows(down.labelNode!)))).toEqual([0, 1, 0])
        // The round trip turns 80 under the second line, comes back to its start, and counts once on each line.
        expect([place(round, 3)[1], place(round, 5)[1], place(round, 7)[1]]).toEqual([-230, expect.closeTo(270, 6), expect.closeTo(-230, 6)])
        expect([tally(calls, 3.3), tally(calls, 3.34), tally(wall, 4.7), tally(calls, 6.9)]).toEqual(['1', '2', '2', '2'])
        expect([lit(3.32, 390), lit(4.68, 730), lit(5.32, 730), lit(6.68, 390)]).toEqual([1, 1, 1, 1])
        // Up: from 80 under the wall to 80 over the first line.
        expect([place(up, 7), place(up, 9)]).toEqual([[140, 270], [140, expect.closeTo(-230, 6)]])
        expect([tally(wall, 7.3), tally(wall, 7.34), tally(calls, 8.66), tally(calls, 8.7)]).toEqual(['2', '3', '2', '3'])
        // With an ease that is not linear, each line still counts at the moment the mark is on it: at 9.8 and at 10.833. This mark counts 5.
        expect([tally(calls, 9.78), tally(calls, 9.82), tally(wall, 10.81), tally(wall, 10.85)]).toEqual(['3', '8', '3', '8'])
        expect([calls.count, wall.count, calls.ticks.length, wall.ticks.length]).toEqual([8, 8, 4, 4])
        expect([10.9, 11.5].map((time) => at(time, () => lone.map(shows)))).toEqual([[0, 0], [1, 1]])
        expect(lone.map((made) => made.ticks.length)).toEqual([1, 1])
    })

    it('counts a round trip when the mark is on the line on its way down, whatever the ease, and shows the mark on its way back', async () => {
        let made!: Boundary, crossing!: ReturnType<Boundary['cross']>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: true }))
            crossing = made.cross(0, { direction: 'round' })
            // Each leg has 1 s. With this ease the mark is half way after 0.7071 of a leg.
            s.play(crossing, { duration: 2, ease: (t) => t * t })
        }))
        const pass = Math.SQRT1_2
        expect(at(pass, () => crossing.mark.get('y'))).toBeCloseTo(0, 4)
        expect(at(1 + pass, () => crossing.mark.get('y'))).toBeCloseTo(0, 4)
        expect([tally(made, pass - 0.02), tally(made, pass + 0.02), tally(made, 2)]).toEqual(['0', '1', '1'])
        const lit = (time: number) => paths(compiled, time).filter((op) => op.stroke && op.strokeWidth > 3).length
        expect([lit(0.5), lit(pass), lit(1.2), lit(1 + pass)]).toEqual([0, 1, 0, 1])
        // The mark stays on screen for the whole way back, and fades out at the end of it.
        expect([1.1, 1.5, 1.79].map((time) => at(time, () => shows(crossing.mark)))).toEqual([1, 1, 1])
        expect(at(2.05, () => shows(crossing.mark))).toBe(0)
    })

    it('keeps the light on the line at its ends, and gives it the color of the line when the crossing has none', async () => {
        let made!: Boundary
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, color: 'teal' }))
            s.play(made.cross(500), { duration: 1, ease: linear })
            s.play(made.cross(-500), { duration: 1, ease: linear })
        }))
        const [atRight, atLeft] = [0.5, 1.5].map((time) => paths(compiled, time).find((op) => op.stroke && op.strokeWidth > 3)!)
        // The line runs from 460 to 1460 on the frame. The light does not go past an end.
        expect(right(pathBounds(atRight!.path)!)).toBeCloseTo(1460, 6)
        expect(pathBounds(atRight!.path)!.width).toBeGreaterThan(20)
        expect(pathBounds(atLeft!.path)!.x).toBeCloseTo(460, 6)
        expect(atRight!.stroke).toEqual(made.line.get('stroke'))
    })

    it('starts a crossing again from its start when a film plays it a second time', async () => {
        let made!: Boundary, crossing!: ReturnType<Boundary['cross']>
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(boundary({ width: 1000, tally: true }))
            crossing = made.cross(0, { label: 'again' })
            s.play(crossing, { duration: 1, ease: linear })
            s.wait(0.5)
            s.play(crossing, { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        const y = (time: number) => at(time, () => crossing.mark.get('y'))
        // The first time ends under the line. The second time starts over it again, shows again, and counts again.
        expect([y(1), y(1.5), y(2), y(2.5)]).toEqual([expect.closeTo(70, 6), -70, expect.closeTo(0, 6), expect.closeTo(70, 6)])
        expect([1.2, 2, 2.6].map((time) => at(time, () => [shows(crossing.mark), shows(crossing.labelNode!)]))).toEqual([[0, 0], [1, 1], [0, 0]])
        expect([made.count, made.ticks.length, tally(made, 3)]).toEqual([2, 2, '2'])
    })

    it('names a wrong size, a line with no room, a place off the line, a wrong crossing, a full line, and a wrong count', async () => {
        await compileFilm(film((s) => {
            expect(() => boundary({ width: 0 })).toThrow(/width is the length of the line/)
            expect(() => boundary({ weight: -1 })).toThrow(/weight is the width of the stroke/)
            expect(() => boundary({ size: Number.NaN })).toThrow(/size is a text size/)
            expect(() => boundary({ width: 300, label: 'a long name of a line', tally: 'system calls' })).toThrow(/a line of 300 has no room for a crossing.*need \d+\. Make the line longer/)
            const made = s.add(boundary({ width: 1000, tally: true }))
            // A part is from 0 to 1. Outside it, the place would be on the names or on the tally.
            expect(() => made.x(-0.08)).toThrow(/x\(-0.08\) is not a place on the line. A part is from 0 to 1: 0 is the first place after the names, and 1 is the last place before the tally/)
            expect(() => made.x(1.15)).toThrow(/x\(1.15\) is not a place on the line/)
            expect(() => made.x(Number.NaN)).toThrow(/x\(NaN\) is not a place on the line/)
            expect([made.x(0), made.x(1)].every(Number.isFinite)).toBe(true)
            expect(() => made.cross(501)).toThrow(/x is 501, and the line runs from -500 to 500/)
            expect(() => made.cross(-500.5)).toThrow(/x is -500.5/)
            expect(() => made.cross(Number.NaN)).toThrow(/x is NaN/)
            expect(() => made.cross(0, { direction: 'left' as never })).toThrow(/direction is "left". Use 'down', 'up' or 'round'/)
            expect(() => made.cross(0, { reach: 0 })).toThrow(/reach is how far/)
            expect(() => made.cross(0, { counts: 1.5 })).toThrow(/counts is 1.5/)
            expect(() => made.cross(0, { counts: -1 })).toThrow(/counts is -1/)
            expect(() => made.addCrossings(2.5)).toThrow(/addCrossings\(2.5\) is not a count/)
            expect(() => made.addCrossings(-3)).toThrow(/addCrossings\(-3\) is not a count/)
            expect(() => boundary().addCrossings(10)).toThrow(/this line shows no tally/)
            // The two ends of the line are places on it.
            expect(() => [made.cross(-500), made.cross(500)]).not.toThrow()

            // A line holds 400 ticks. The crossings of one `lagged` are all made before any is scheduled, so the error comes from the play.
            const full = s.add(boundary({ width: 1000 }))
            expect(() => s.play(lagged(Array.from({ length: 401 }, (_, index) => full.cross(index - 200, { duration: 0.1 })), { lag: 0.1 }))).toThrow(/a line holds 400 ticks.*Use addCrossings\(count\)/)
            expect(full.ticks).toHaveLength(400)
            // On a full line, the error comes where the film names the crossing. After a clear there is room again.
            expect(() => full.cross(0)).toThrow(/Use addCrossings\(count\)/)
            s.play(full.clear())
            expect(() => s.play(full.cross(0))).not.toThrow()
            // The ticks of addCrossings stop at 400 too, on a line that has more places.
            const wide = s.add(boundary({ width: 3000, tally: true }))
            s.play(wide.addCrossings(100000))
            expect(wide.ticks).toHaveLength(400)
        }))
    })
})

// The request queue has its own import, so that its tests stay one block.
import { narrated, requestQueue } from '../src/stage/index'

describe('request queue', () => {
    type Queue = ReturnType<typeof requestQueue>
    type Rect = { x: number; y: number; width: number; height: number }
    const words = (node: Node | null) => (node as unknown as { source?: string } | null)?.source
    /** How much of a node a viewer gets: its opacity and that of each holder over it, and 0 when one of them is hidden. */
    const shows = (node: Node) => {
        let value = 1
        for (let holder: Node | null = node; holder; holder = holder.parent) {
            if (!holder.get('visible')) return 0
            value *= holder.get('opacity')
        }
        return value
    }
    /** The middle of an item at a time, in the coordinates of the queue. */
    const where = (made: Queue, id: string | number, time: number) => at(time, () => [made.item(id).parent!.get('x'), made.item(id).parent!.get('y')] as const)
    const seen = (made: Queue, id: string | number, time: number) => at(time, () => shows(made.item(id)))
    /** The parts of an item: its border, its bar, its id, the number of its work, and what is under it. */
    const parts = (made: Queue, id: string | number) => { const [body, bar, name, number, under] = made.item(id).children; return { body: body!, bar: bar!, name: name!, number: number!, under: under! } }
    /** The border of an item at a time, on the stage. */
    const box = (made: Queue, id: string | number, time: number): Rect => at(time, () => parts(made, id).body.bounds())
    const apart = (a: Rect, b: Rect, room = 0) => a.x + a.width + room <= b.x || b.x + b.width + room <= a.x || a.y + a.height + room <= b.y || b.y + b.height + room <= a.y
    /** The texts that a holder draws at a time: a count, the number of an item, or what is under it. A text that does not show is left out. */
    const said = (holder: Node, time: number): string[] => {
        const drawn = at(time, () => holder.draw!(time))
        const list = (drawn === null ? [] : Array.isArray(drawn) ? drawn : [drawn]) as Node[]
        return list.filter((node) => node.get('opacity') > 0.01).map((node) => words(node) ?? node.children.map(words).filter(Boolean).join(' '))
    }
    const paintOf = (color: string) => rect(1, 1, { fill: color }).get('fill')
    const abc = () => [{ id: 'A', work: 2 }, { id: 'B', work: 4 }, { id: 'C', work: 6 }]
    /** The sizes of a queue with the default text size: an item is 120 by 50, and the next place is 133 further. */
    const W = 120, H = 50, PITCH = 133

    it('is as wide as its width, with the lines at the left and the slots in one column at the right', async () => {
        await compileFilm(film(() => {
            const made = requestQueue(abc(), { slots: 3, width: 1400 }).at(100, 40)
            // The layout measures the whole object: the room where items arrive and leave is a part of it.
            const whole = boxOf(made)
            expect([whole.left, whole.right]).toEqual([-600, 800])
            expect(whole.cy).toBeCloseTo(40, 6)
            expect(made.bounds().width).toBeCloseTo(1400, 6)
            expect([made.slots, made.itemWidth]).toEqual([3, W])
            // The places of the line are one row, one pitch apart, with the head next to the slots.
            const places = Array.from({ length: made.places }, (_, place) => made.p({ line: 0, place }))
            expect(made.places).toBeGreaterThanOrEqual(3)
            places.forEach(([x, y], place) => {
                expect(x).toBeCloseTo(places[0]![0] - place * PITCH, 6)
                expect(y).toBeCloseTo(places[0]![1], 6)
            })
            // The slots are one column, and the line is at the height of the middle slot.
            const seats = [0, 1, 2].map((slot) => made.p({ slot }))
            expect(new Set(seats.map(([x]) => x)).size).toBe(1)
            expect(seats[1]![1]).toBeCloseTo(places[0]![1], 6)
            expect(seats[2]![1] - seats[1]![1]).toBeCloseTo(seats[1]![1] - seats[0]![1], 6)
            expect(seats[1]![1] - seats[0]![1]).toBeGreaterThan(H)
            // An item leaves its line by one place, and comes into its slot by one place: the room between
            // the head and the slots is more than two items wide.
            expect(seats[0]![0] - places[0]![0]).toBeGreaterThanOrEqual(2 * PITCH)
            // The room that an item needs to leave a slot is inside the object.
            expect(seats[0]![0] + W / 2 + PITCH).toBeLessThanOrEqual(700 + 1e-6)
            // The first place is clear of the left edge by the room of one item, where an item arrives.
            expect(places[made.places - 1]![0] - W / 2 - PITCH).toBeGreaterThanOrEqual(-700 - 1e-6)
            // With two lines or more, a line is at the height of a slot, or in the middle between two slots.
            const two = requestQueue([], { slots: 3, lines: ['a', 'b'] })
            expect([two.p({ line: 0, place: 0 })[1], two.p({ line: 1, place: 0 })[1]]).toEqual([two.p({ slot: 0 })[1], two.p({ slot: 2 })[1]])
            const three = requestQueue([], { slots: 2, lines: ['a', 'b', 'c'] })
            expect(three.p({ line: 1, place: 0 })[1]).toBeCloseTo((three.p({ slot: 0 })[1] + three.p({ slot: 1 })[1]) / 2, 6)
            expect(three.p({ slot: 1 })[1] - three.p({ slot: 0 })[1]).toBeCloseTo((three.p({ line: 1, place: 0 })[1] - three.p({ line: 0, place: 0 })[1]) / 2, 6)
            // The room that the places do not fill is at the far end of the lines: the head is as near to the slots at any width.
            const odd = requestQueue(abc(), { slots: 3, width: 1450 })
            expect(odd.places).toBe(made.places)
            expect(odd.p({ slot: 0 })[0] - odd.p({ line: 0, place: 0 })[0]).toBeCloseTo(seats[0]![0] - places[0]![0], 6)
            expect(odd.p({ line: 0, place: 0 })[0] + 725).toBeCloseTo(places[0]![0] + 700 + 50, 6)
            // A wider object has more places, and the same room at the slots.
            const wide = requestQueue(abc(), { slots: 3, width: 1800 })
            expect(wide.places).toBe(made.places + 3)
            expect(1800 / 2 - wide.p({ slot: 0 })[0]).toBeCloseTo(1400 / 2 - seats[0]![0], 6)
        }))
    })

    it('gets the width of a region from fitted, and gives a region of each part on the stage', async () => {
        await compileFilm(film(() => {
            const made = fitted(900, (width) => requestQueue(abc(), { slots: 2, width, pool: 4 })).at(-200, 100)
            expect(boxOf(made).width).toBeCloseTo(900, 6)
            const slot = made.region({ slot: 1 }), [x, y] = made.p({ slot: 1 })
            expect([slot.cx, slot.cy]).toEqual([x - 200, y + 100])
            expect([slot.width, slot.height]).toEqual([W, H])
            const line = made.region({ line: 0 })
            expect(line.width).toBeCloseTo(made.places * PITCH - 13, 6)
            expect(line.right).toBeCloseTo(made.p({ line: 0, place: 0 }, 'right')[0] - 200, 6)
            expect(made.region('slots').height).toBeCloseTo(made.p({ slot: 1 }, 'bottom')[1] - made.p({ slot: 0 }, 'top')[1], 6)
            // The pool is under the slots, and starts at their left edge.
            const pool = made.region('pool')
            expect(pool.left).toBeCloseTo(slot.left, 6)
            expect(pool.top).toBeGreaterThan(slot.bottom)
            expect(made.region({ block: 3 }).right).toBeCloseTo(pool.right, 6)
            const all = made.region()
            expect([all.left, all.right]).toEqual([-650, 250])
            // The edges of a part.
            expect(made.p({ slot: 0 }, 'left')[0]).toBeCloseTo(made.p({ slot: 0 })[0] - W / 2, 6)
            expect(made.p({ slot: 0 }, 'top')[1]).toBeCloseTo(made.p({ slot: 0 })[1] - H / 2, 6)
        }))
    })

    it('starts with the first items in their lines in order, and the running ones in the first slots', async () => {
        let made!: Queue
        const f = await compile((s) => {
            made = s.add(requestQueue([{ id: 'R1', running: true }, ...abc(), { id: 'R2', running: true }], { slots: 3, names: { slots: 'GPU batch' } }))
            s.wait(1)
        })
        expect(made.ids).toEqual(['R1', 'A', 'B', 'C', 'R2'])
        expect(made.find((item) => item.state === 'running')).toEqual(['R1', 'R2'])
        expect([made.stateOf('R1').slot, made.stateOf('R2').slot, made.freeSlots]).toEqual([0, 1, 1])
        expect(['A', 'B', 'C'].map((id) => made.stateOf(id).place)).toEqual([0, 1, 2])
        expect([made.count('waiting'), made.count('running'), made.count('done'), made.count('rejected')]).toEqual([3, 2, 0, 0])
        expect(made.stateOf('B')).toEqual({ id: 'B', state: 'waiting', line: 0, place: 1, slot: null, work: 4, left: 4, blocks: 0, wait: 0, late: false, status: undefined })
        // Each item is at the middle of its place or of its slot, and shows.
        for (const [id, part] of [['A', { line: 0, place: 0 }], ['B', { line: 0, place: 1 }], ['C', { line: 0, place: 2 }], ['R1', { slot: 0 }], ['R2', { slot: 1 }]] as const) {
            expect(where(made, id, 0.5)).toEqual(made.p(part))
            expect(seen(made, id, 0.5)).toBe(1)
        }
        // The counts say the same, and a count of 0 draws nothing.
        expect(said(made.captions[0]!, 0.5)).toEqual(['waiting 3'])
        expect(said(made.slotsCaption, 0.5)).toEqual(['GPU batch 2 / 3'])
        expect(said(made.doneTally!, 0.5)).toEqual([])
        expect(said(made.rejectedTally!, 0.5)).toEqual([])
        // An item with work shows the units that are left. An item with none has no number, and its id is in the middle.
        expect(said(parts(made, 'B').number, 0.5)).toEqual(['4'])
        expect(parts(made, 'R1').number.draw).toBeNull()
        at(0.5, () => {
            const id = parts(made, 'R1').name.bounds(), border = parts(made, 'R1').body.bounds()
            expect(id.x + id.width / 2).toBeCloseTo(border.x + border.width / 2, 0)
            // The outline of a slot shows while the slot is free.
            expect(made.seats.map((seat) => seat.children[0]!.get('opacity'))).toEqual([0, 0, 1])
        })
        expectPure(f, [0, 0.5, 1])
    })

    it('brings an item to the end of its line, from one place behind, and counts it when it is half there', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'A' }], { slots: 1 }))
            s.wait(1)
            s.play(made.arrive({ id: 'B', work: 3 }), { duration: 2, ease: linear })
            expect(made.ids).toEqual(['A', 'B'])
            expect(made.stateOf('B')).toMatchObject({ state: 'waiting', place: 1, left: 3 })
            expect(made.count('waiting')).toBe(2)
        })
        const [x, y] = made.p({ line: 0, place: 1 })
        expect(seen(made, 'B', 0.99)).toBe(0)
        expect(where(made, 'B', 1.5)).toEqual([x - PITCH * 0.75, y])
        // The item is all there at the middle of its way, so the line of its waiting line does not show through it.
        expect(seen(made, 'B', 1.5)).toBeCloseTo(0.5, 6)
        expect(seen(made, 'B', 2)).toBeCloseTo(1, 6)
        expect(where(made, 'B', 2)).toEqual([x - PITCH * 0.5, y])
        expect(where(made, 'B', 3)).toEqual([x, y])
        expect([1.9, 2.1].map((time) => said(made.captions[0]!, time))).toEqual([['waiting 1'], ['waiting 2']])
        // The item that was there does not move.
        expect([1, 2, 3].map((time) => where(made, 'A', time))).toEqual(Array(3).fill(made.p({ line: 0, place: 0 })))
    })

    it('brings the items of a list one after another, and no item is nearer to the item before it than one place', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([], { slots: 1 }))
            s.play(made.arrive([{ id: 1 }, { id: 2 }, { id: 3 }], { lag: 0.5 }), { duration: 2 })
            s.wait(0.5)
            // Two calls in one play: the second item is faster, and it still stays behind the first one.
            s.play(made.arrive({ id: 4 }, { duration: 1.5, ease: linear }), made.arrive({ id: 5 }, { duration: 1.5, ease: (share: number) => Math.sqrt(share) }))
        })
        expect(made.ids).toEqual([1, 2, 3, 4, 5])
        expect([1, 2, 3, 4, 5].map((id) => made.stateOf(id).place)).toEqual([0, 1, 2, 3, 4])
        // Each item of the list has half of the time, and starts a quarter later than the one before it.
        expect([0.01, 0.5, 0.99].map((time) => seen(made, 2, time) > 0)).toEqual([false, false, true])
        expect(where(made, 3, 2)).toEqual(made.p({ line: 0, place: 2 }))
        for (let time = 0; time <= 4.01; time += 0.05) {
            // An item has no place before it arrives, so the rule is for an item that shows.
            for (const id of [2, 3, 4, 5]) if (seen(made, id, time) > 0) expect(where(made, id - 1, time)[0] - where(made, id, time)[0]).toBeGreaterThanOrEqual(PITCH - 1e-6)
        }
        // Item 5 alone would be ahead: at a quarter of its time, its own ease has it half way.
        expect(where(made, 5, 2.5 + 1.5 / 4)[0]).toBeCloseTo(made.p({ line: 0, place: 4 })[0] - PITCH * 0.75, 6)
        expect(where(made, 5, 4)).toEqual(made.p({ line: 0, place: 4 }))
    })

    it('moves the head of the line into the first free slot, on a way that is clear of the other items', async () => {
        let made!: Queue
        const f = await compile((s) => {
            made = s.add(requestQueue([{ id: 'R1', running: true }, ...abc()], { slots: 3 }))
            s.wait(1)
            s.play(made.admit(), { duration: 2, ease: linear })
            expect(made.stateOf('A')).toMatchObject({ state: 'running', place: null, slot: 1 })
            expect(['B', 'C'].map((id) => made.stateOf(id).place)).toEqual([0, 1])
            expect([made.count('waiting'), made.count('running'), made.freeSlots]).toEqual([2, 2, 1])
            s.wait(1)
            s.play(made.admit('B'), { duration: 2, ease: linear })
            expect(made.stateOf('B').slot).toBe(2)
        })
        const head = made.p({ line: 0, place: 0 }), seat = made.p({ slot: 2 })
        expect(where(made, 'A', 1)).toEqual(head)
        expect(where(made, 'A', 3)).toEqual(made.p({ slot: 1 }))
        expect(where(made, 'B', 6)).toEqual(seat)
        // The line closes up with the item that leaves: half way, each item is half a place on.
        expect(where(made, 'B', 2)[0]).toBeCloseTo(head[0] - PITCH / 2, 6)
        expect(where(made, 'C', 2)[0]).toBeCloseTo(head[0] - PITCH * 1.5, 6)
        expect(where(made, 'C', 3)).toEqual(made.p({ line: 0, place: 1 }))
        // B goes to a slot at another height. It changes its height only between the lines and the slots:
        // near its line it is at the height of the line, and near the slots at the height of its slot.
        let across = 0
        for (let time = 4; time <= 6.001; time += 0.02) {
            const [x, y] = where(made, 'B', time)
            if (x < head[0] + PITCH - 1e-6) expect(y).toBeCloseTo(head[1], 6)
            else if (x > seat[0] - PITCH + 1e-6) expect(y).toBeCloseTo(seat[1], 6)
            else across += 1
            // It never meets an item in a slot, or the item that is now the head.
            for (const other of ['R1', 'A', 'C']) expect(apart(box(made, 'B', time), box(made, other, time))).toBe(true)
        }
        expect(across).toBeGreaterThan(5)
        // The counts change when the item is half way, and the outline of the slot goes when the item comes into it.
        expect([1.9, 2.1].map((time) => [said(made.captions[0]!, time), said(made.slotsCaption, time)])).toEqual([[['waiting 3'], ['running 1 / 3']], [['waiting 2'], ['running 2 / 3']]])
        expect([1, 2, 3].map((time) => at(time, () => made.seats[1]!.children[0]!.get('opacity')))).toEqual([1, 1, 0])
        expectPure(f, [0.5, 2, 2.9, 5, 6])
    })

    it('admits the items of a list one after another, and refuses two admissions at one time', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue(abc(), { slots: 3 }))
            expect(made.next(2)).toEqual(['A', 'B'])
            s.play(made.admit(made.next(made.freeSlots)), { duration: 3, ease: linear })
            expect(made.find((item) => item.state === 'running')).toEqual(['A', 'B', 'C'])
            expect(made.next()).toEqual([])
        })
        // Each item has a third of the time: B does not leave the line before A is in its slot.
        expect(where(made, 'A', 1)).toEqual(made.p({ slot: 0 }))
        expect(where(made, 'B', 1)).toEqual(made.p({ line: 0, place: 0 }))
        expect(where(made, 'B', 2)).toEqual(made.p({ slot: 1 }))
        expect(where(made, 'C', 2)).toEqual(made.p({ line: 0, place: 0 }))
        expect(where(made, 'C', 3)).toEqual(made.p({ slot: 2 }))
        for (let time = 0; time <= 3; time += 0.05) {
            expect(apart(box(made, 'A', time), box(made, 'B', time))).toBe(true)
            expect(apart(box(made, 'B', time), box(made, 'C', time))).toBe(true)
        }
        const two = (build: (made: Queue, s: Stage) => void) => compile((s) => build(s.add(requestQueue(abc(), { slots: 3 })), s))
        await expect(two((q, s) => s.play(q.admit(), q.admit()))).rejects.toThrow('requestQueue: admit() starts at 0 s, and admit() ends at 0.9 s. The slots take one item at a time, so that no two items cross. Give one `admit` all the items, as a list')
        await expect(two((q, s) => s.play(q.admit('B')))).rejects.toThrow('requestQueue: admit("B"): "B" is at place 1 of the line "waiting", behind "A". A line serves its head first. Admit "A" first, or reject the items before "B"')
        await expect(two((q, s) => s.play(q.admit(['A', 'A'])))).rejects.toThrow('admit names an item two times')
        await expect(two((q, s) => s.play(q.admit('Z')))).rejects.toThrow('requestQueue: admit("Z"): no item has the id "Z". The queue has "A", "B", "C". When an `arrive` in the same play brings the item, name the `arrive` before this call')
        await expect(compile((s) => { const q = s.add(requestQueue(abc())); s.play(q.admit()); s.play(q.admit()) })).rejects.toThrow('requestQueue: admit(): no slot is free for "B": 1 of 1 run. `finish` an item first')
        await expect(compile((s) => { s.play(s.add(requestQueue([])).admit()) })).rejects.toThrow('requestQueue: admit(): no item waits. `arrive` an item first')
        await expect(compile((s) => { s.play(s.add(requestQueue([{ id: 'R', running: true }], { slots: 2 })).admit('R')) })).rejects.toThrow('requestQueue: admit("R"): "R" is running. `admit` takes an item that waits')
        // An item that arrives in the same sequence can be admitted: the queue reads its state when the call is scheduled.
        await compile((s) => {
            const q = s.add(requestQueue([]))
            s.play(seq(q.arrive({ id: 'N' }), q.admit('N')))
            expect(q.stateOf('N').state).toBe('running')
        })
    })

    it('lets the items in the slots work: the bar grows, the number counts down, and no item does more than its work', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'A', work: 2, running: true }, { id: 'B', work: 4, running: true }, { id: 'N', running: true }, { id: 'W', work: 3 }], { slots: 3 }))
            s.wait(1)
            s.play(made.run(2), { duration: 2 })
            expect(['A', 'B', 'N', 'W'].map((id) => made.stateOf(id).left)).toEqual([0, 2, undefined, 3])
            s.play(made.run(3), { duration: 1 })
            expect(['A', 'B'].map((id) => made.stateOf(id).left)).toEqual([0, 0])
        })
        const width = (id: string, time: number) => at(time, () => (parts(made, id).bar.get('path')!.length === 0 ? 0 : parts(made, id).bar.bounds().width))
        // Work goes at one speed, with no ease: after a quarter of the time, a quarter of the units are done.
        expect([1, 1.5, 2, 3].map((time) => width('A', time))).toEqual([0, W / 4, W / 2, W])
        expect([1, 2, 3, 3.5, 4].map((time) => width('B', time))).toEqual([0, W / 4, W / 2, W * 0.75, W])
        expect([1, 1.9, 2.1, 3].map((time) => said(parts(made, 'A').number, time))).toEqual([['2'], ['2'], ['1'], ['0']])
        expect([3, 3.4, 3.6, 4].map((time) => said(parts(made, 'B').number, time))).toEqual([['2'], ['2'], ['1'], ['0']])
        // The bar starts at the left edge of the item, and has its height.
        at(2, () => {
            const bar = parts(made, 'B').bar.bounds(), border = parts(made, 'B').body.bounds()
            expect([bar.x, bar.y, bar.height]).toEqual([border.x, border.y, border.height])
        })
        // An item with no work, and an item that waits, do not change.
        expect([width('N', 4), width('W', 4)]).toEqual([0, 0])
        expect(said(parts(made, 'W').number, 4)).toEqual(['3'])
        await expect(compile((s) => { s.play(s.add(requestQueue([])).run(0)) })).rejects.toThrow('requestQueue: run takes the units of work, a whole number, 1 or more. It got 0')
    })

    it('drains the slots of the items that have done their work: each one goes out at the right and fades', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'A', work: 1, running: true }, { id: 'B', work: 4, running: true }, { id: 'N', running: true }], { slots: 3 }))
            s.play(made.run(1), { duration: 1 })
            s.play(made.finish(), { duration: 2, ease: linear })
            expect(made.stateOf('A')).toMatchObject({ state: 'done', slot: null })
            expect(made.find((item) => item.state === 'running')).toEqual(['B', 'N'])
            expect([made.count('done'), made.freeSlots]).toEqual([1, 1])
            s.wait(1)
            // An item with no work leaves when the film names it. A function picks among the items in the slots.
            s.play(made.finish((item) => item.work === undefined), { duration: 1 })
            expect(made.stateOf('N').state).toBe('done')
        })
        const [x, y] = made.p({ slot: 0 })
        expect(where(made, 'A', 1)).toEqual([x, y])
        expect(where(made, 'A', 2)).toEqual([x + PITCH / 2, y])
        expect(where(made, 'A', 3)).toEqual([x + PITCH, y])
        // The item is all there until it is half out of its slot, and gone at the end.
        expect([1, 1.8, 2.4, 3].map((time) => seen(made, 'A', time))).toEqual([1, 1, expect.closeTo(0.5, 6), 0])
        // The outline of the slot comes back at the end, when the id of the item is clear of it. The count follows at the middle.
        expect([1, 1.8, 2.4, 2.85, 3].map((time) => at(time, () => made.seats[0]!.children[0]!.get('opacity')))).toEqual([0, 0, 0, expect.closeTo(0.5, 6), 1])
        expect([1.9, 2.1].map((time) => [said(made.slotsCaption, time), said(made.doneTally!, time)])).toEqual([[['running 3 / 3'], []], [['running 2 / 3'], ['done 1']]])
        expect(said(made.doneTally!, 5)).toEqual(['done 2'])
        // The item stays inside the object on its way out.
        at(2.9, () => expect(box(made, 'A', 2.9).x + W).toBeLessThanOrEqual(made.bounds().x + made.bounds().width + 1e-6))
        const one = (build: (made: Queue, s: Stage) => void) => compile((s) => build(s.add(requestQueue([{ id: 'A', work: 2, running: true }, { id: 'W' }])), s))
        await expect(one((q, s) => s.play(q.finish()))).rejects.toThrow('requestQueue: finish(): no item in a slot has done its work. `run` first, or name the item')
        await expect(one((q, s) => s.play(q.finish('A')))).rejects.toThrow('requestQueue: finish("A"): "A" has 2 of 2 units of work left. Call run(2) first')
        await expect(one((q, s) => s.play(q.finish('W')))).rejects.toThrow('requestQueue: finish("W"): "W" is waiting. This call takes an item that is running')
    })

    it('refills a slot in one play: the new item comes in behind the one that leaves, and never meets it', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'A', work: 1, running: true }, { id: 'D', work: 3 }, { id: 'E' }], { slots: 1 }))
            s.play(made.run(1), { duration: 1 })
            // The new item is faster than the one that leaves, and it still waits for it.
            s.play(made.finish(), made.admit(undefined, { ease: (share: number) => Math.sqrt(share) }), { duration: 2 })
            expect(made.stateOf('D')).toMatchObject({ state: 'running', slot: 0 })
            expect([made.count('running'), made.count('done'), made.freeSlots]).toEqual([1, 1, 0])
        })
        expect(where(made, 'D', 3)).toEqual(made.p({ slot: 0 }))
        expect(seen(made, 'A', 3)).toBe(0)
        for (let time = 1; time <= 3.001; time += 0.02) {
            if (seen(made, 'A', time) > 0) expect(apart(box(made, 'A', time), box(made, 'D', time))).toBe(true)
            // The line closes up no faster than its head leaves.
            expect(where(made, 'D', time)[0] - where(made, 'E', time)[0]).toBeGreaterThanOrEqual(PITCH - 1e-6)
            // The outline of the slot does not come back between the two items.
            expect(at(time, () => made.seats[0]!.children[0]!.get('opacity'))).toBe(0)
        }
        // Alone, the ease of D has it at 0.71 of its way after half of the time. Behind A, it is half way, as A is.
        const alone = await (async () => { let q!: Queue; await compile((s) => { q = s.add(requestQueue([{ id: 'D' }])); s.wait(1); s.play(q.admit(undefined, { ease: (share: number) => Math.sqrt(share) }), { duration: 2 }) }); return where(q, 'D', 2)[0] })()
        expect(where(made, 'D', 2)[0]).toBeLessThan(alone - 20)
        // The count of the slots stays at 1: one item leaves and one comes in.
        expect([1.5, 2.5, 3].map((time) => said(made.slotsCaption, time))).toEqual(Array(3).fill(['running 1 / 1']))
        const full = (build: (made: Queue, s: Stage) => void) => compile((s) => build(s.add(requestQueue([{ id: 'A', running: true }, { id: 'D' }])), s))
        await expect(full((q, s) => s.play(q.admit(), q.finish('A')))).rejects.toThrow('no slot is free for "D": 1 of 1 run. `finish` an item first. When a `finish` in the same play frees the slot, name the `finish` before the `admit`')
        await expect(full((q, s) => s.play(par(q.finish('A', { duration: 2 }), q.admit(undefined, { duration: 1 }))))).rejects.toThrow('requestQueue: admit(): "D" is in slot 0 at 1 s, and the item before it leaves that slot until 2 s. Give the `finish` a duration that ends at 1 s or sooner')
    })

    it('sends a waiting item away with its status: it gets dashes, a cross and the status, it fades, and then the line closes up', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'R', running: true }], { slots: 1 }))
            s.wait(1)
            s.play(made.reject('B', '503'), { duration: 10, ease: linear })
            expect(made.stateOf('B')).toMatchObject({ state: 'rejected', place: null, status: '503' })
            expect(['A', 'C', 'D'].map((id) => made.stateOf(id).place)).toEqual([0, 1, 2])
            expect([made.count('waiting'), made.count('rejected')]).toEqual([3, 1])
            // A function picks among the items that wait, when the call is scheduled.
            s.play(made.reject((item) => item.place === 2, 'timeout'), { duration: 1 })
            expect(made.stateOf('D').status).toBe('timeout')
            expect(made.find((item) => item.state === 'rejected')).toEqual(['B', 'D'])
        })
        const place = (index: number) => made.p({ line: 0, place: index })
        const edge = (time: number) => at(time, () => [parts(made, 'B').body.get('stroke'), parts(made, 'B').body.get('dash') !== null])
        // The status arrives in the first fifth of the time, under the item, after a cross.
        expect(edge(1)).toEqual([paintOf('blue'), false])
        expect(edge(3)).toEqual([paintOf('red'), true])
        expect(said(parts(made, 'B').under, 1)).toEqual([])
        expect(said(parts(made, 'B').under, 3)).toEqual(['503'])
        at(3, () => {
            const status = (parts(made, 'B').under.draw!(3) as Node[])[0]!
            expect(status.children).toHaveLength(2)
            expect(status.children[0]!.get('stroke')).toEqual(paintOf('red'))
        })
        // The item stays in its place while the viewer reads the status, and fades from 0.6 to 0.8 of the time.
        expect([3, 7, 8, 9].map((time) => seen(made, 'B', time))).toEqual([1, 1, expect.closeTo(0.5, 6), 0])
        expect([1, 8, 9].map((time) => where(made, 'B', time))).toEqual(Array(3).fill(place(1)))
        // The line closes up in the last fifth, when the item is gone: no item moves into a place that still shows another.
        expect([1, 9].map((time) => where(made, 'C', time))).toEqual([place(2), place(2)])
        expect(where(made, 'C', 10)[0]).toBeCloseTo(place(2)[0] + PITCH / 2, 6)
        expect(where(made, 'C', 11)).toEqual(place(1))
        expect(where(made, 'D', 11)).toEqual(place(2))
        expect([1, 11].map((time) => where(made, 'A', time))).toEqual([place(0), place(0)])
        expect([7.9, 8.1].map((time) => [said(made.captions[0]!, time), said(made.rejectedTally!, time)])).toEqual([[['waiting 4'], []], [['waiting 3'], ['rejected 1']]])
        const some = (build: (made: Queue, s: Stage) => void) => compile((s) => build(s.add(requestQueue([{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'R', running: true }])), s))
        await expect(some((q, s) => s.play(q.reject('R', '503')))).rejects.toThrow('requestQueue: reject("R", "503"): "R" is running. This call takes an item that is waiting: an item in a slot leaves with `finish`')
        await expect(some((q, s) => s.play(q.reject('A', '503'), q.reject('B', '503')))).rejects.toThrow('requestQueue: reject("B", "503") starts at 0 s, and the line "waiting" closes up after reject("A", "503") until 1.4 s. A line takes one change of its order at a time')
        await expect(some((q) => q.reject('A', 'the queue is full now'))).rejects.toThrow('requestQueue: the status "the queue is full now" is')
        await expect(some((q) => q.reject('A', ''))).rejects.toThrow('requestQueue: the status of reject is empty')
        // An item with a wait: its number goes before its status comes, so no two texts show at one place.
        let timed!: Queue
        await compile((s) => {
            timed = s.add(requestQueue([{ id: 'A' }]))
            s.play(timed.wait('A', 7), { duration: 1 })
            s.play(timed.reject('A', '503'), { duration: 10, ease: linear })
        })
        expect([1, 1.5, 2.5, 3].map((time) => said(parts(timed, 'A').under, time))).toEqual([['7'], ['7'], ['503'], ['503']])
        expect([1.5, 2.5].map((time) => at(time, () => (parts(timed, 'A').under.draw!(time) as Node[])[0]!.get('opacity')))).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.5, 6)])
        // One call takes several items, and the items behind them close up by as many places.
        await some((q, s) => {
            s.play(q.reject(['A', 'B'], '429'))
            expect(q.stateOf('C').place).toBe(0)
            expect(where(q, 'C', 1.4)).toEqual(q.p({ line: 0, place: 0 }))
        })
    })

    it('runs the wait of an item as a number under it, and marks the item as late at the deadline', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'A' }, { id: 'B' }, { id: 'R', running: true }], { slots: 2, deadline: 250, format: (ms) => `${Math.round(ms)} ms` }))
            s.wait(1)
            s.play(made.wait('B', 200), { duration: 2 })
            expect(made.stateOf('B')).toMatchObject({ wait: 200, late: false })
            s.play(made.wait('B', 300), { duration: 2 })
            expect(made.stateOf('B')).toMatchObject({ wait: 300, late: true })
            expect(made.find((item) => item.late)).toEqual(['B'])
            s.wait(1)
            s.play(made.admit(['A']), { duration: 1 })
            s.play(made.wait('B', 320), { duration: 1 })
        })
        const under = (time: number) => said(parts(made, 'B').under, time)
        const edge = (time: number) => at(time, () => [parts(made, 'B').body.get('stroke'), parts(made, 'B').body.get('dash') !== null])
        // No number before the first wait. Then it runs at one speed.
        expect([0.9, 1, 1.5, 2, 3, 4, 5].map(under)).toEqual([[], ['0 ms'], ['50 ms'], ['100 ms'], ['200 ms'], ['250 ms'], ['300 ms']])
        // At the deadline the number is red, and the border of the item is red with dashes.
        const color = (time: number) => at(time, () => ((parts(made, 'B').under.draw!(time) as Node[])[0]!.children[0]!.get('fill')))
        // An item is late from the moment that its wait is the deadline: at 4 s it is 250 ms.
        expect([3.9, 4, 4.1].map(color)).toEqual([paintOf('dim'), paintOf('red'), paintOf('red')])
        expect([3.9, 4, 4.1].map(edge)).toEqual([[paintOf('blue'), false], [paintOf('red'), true], [paintOf('red'), true]])
        // The number is under its item, and follows it when the line closes up.
        at(7, () => {
            const number = (parts(made, 'B').under.draw!(7) as Node[])[0]!
            expect(parts(made, 'B').under.get('y')).toBeGreaterThan(H / 2)
            expect(Math.abs(number.get('x'))).toBeLessThan(1e-6)
        })
        expect(where(made, 'B', 7)).toEqual(made.p({ line: 0, place: 0 }))
        expect(under(8)).toEqual(['320 ms'])
        // An item that goes to a slot loses its number in the first part of its way, and is no longer late.
        let served!: Queue
        await compile((s) => {
            served = s.add(requestQueue([{ id: 'A' }], { deadline: 100 }))
            s.play(served.wait('A', 150), { duration: 1 })
            s.play(served.admit(), { duration: 2, ease: linear })
        })
        expect([1, 1.3, 1.7, 3].map((time) => said(parts(served, 'A').under, time))).toEqual([['150'], ['150'], [], []])
        expect([1, 1.01].map((time) => at(time, () => parts(served, 'A').body.get('dash') !== null))).toEqual([true, false])
        expect(served.stateOf('A')).toMatchObject({ wait: 150, late: false })
        expect(served.find((item) => item.late)).toEqual([])
        const one = (build: (made: Queue, s: Stage) => void, options = {}) => compile((s) => build(s.add(requestQueue([{ id: 'A' }, { id: 'R', running: true }], options)), s))
        await one((q, s) => {
            s.play(q.wait('A', 99))
            expect(q.stateOf('A').late).toBe(false)
            s.play(q.wait('A', 100))
            expect(q.stateOf('A').late).toBe(true)
        }, { deadline: 100 })
        await expect(one((q, s) => { s.play(q.wait('A', 100)); s.play(q.wait('A', 50)) })).rejects.toThrow('requestQueue: wait("A", 50): the wait of "A" is 100, and a wait does not go back. Give a value of 100 or more')
        await expect(one((q, s) => s.play(q.wait('R', 100)))).rejects.toThrow('"R" is running. This call takes an item that is waiting')
        await expect(one((q) => q.wait('A', 100), { format: (wait: number) => `${wait} milliseconds of wait` })).rejects.toThrow('requestQueue: the wait "100 milliseconds of wait" is')
        await expect(one((q) => q.wait('A', Number.NaN))).rejects.toThrow('requestQueue: wait takes the wait to reach, a number, 0 or more. It got NaN')
    })

    it('serves the first line first, and gives each item the color of its line', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'L1', line: 'batch' }, { id: 'H1', line: 'interactive' }, { id: 'L2', line: 1, color: 'purple' }], { slots: 3, lines: [{ name: 'interactive', color: 'orange' }, 'batch'], color: 'teal' }))
            expect(made.next(3)).toEqual(['H1', 'L1', 'L2'])
            expect([made.count('waiting', 'interactive'), made.count('waiting', 1)]).toEqual([1, 2])
            s.play(made.arrive({ id: 'H2', line: 'interactive' }), { duration: 1 })
            s.play(made.admit(), { duration: 1 })
            expect(made.stateOf('H1').state).toBe('running')
            // An item of the second line goes when the film names it: it is the head of its own line.
            s.play(made.admit('L1'), { duration: 1 })
            expect(made.find((item) => item.state === 'running')).toEqual(['L1', 'H1'])
            expect(made.next()).toEqual(['H2'])
        })
        const stroke = (id: string) => at(0, () => parts(made, id).body.get('stroke'))
        expect(['H1', 'L1', 'L2'].map(stroke)).toEqual([paintOf('orange'), paintOf('teal'), paintOf('purple')])
        // The lines are one under the other, each with its name and its count over its head.
        const high = made.p({ line: 'interactive', place: 0 }), low = made.p({ line: 'batch', place: 0 })
        expect(high[0]).toBe(low[0])
        expect(low[1] - high[1]).toBeGreaterThan(H * 2)
        expect(where(made, 'L2', 0)).toEqual(made.p({ line: 1, place: 1 }))
        expect([said(made.captions[0]!, 0.9), said(made.captions[1]!, 0.9)]).toEqual([['interactive 2'], ['batch 2']])
        at(0, () => expect(made.captions[1]!.get('y')).toBeLessThan(low[1] - H / 2))
        expect(where(made, 'L1', 3)).toEqual(made.p({ slot: 1 }))
        await expect(compile(() => { requestQueue([{ id: 'A', line: 'x' }]) })).rejects.toThrow('requestQueue: no line "x". The lines are 0 ("waiting")')
    })

    it('draws as many items as a line has places, and three dots for the others', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue(Array.from({ length: 6 }, (_, index) => ({ id: index + 1 })), { slots: 1, width: 1000 }))
            expect(made.places).toBe(3)
            s.wait(1)
            s.play(made.arrive({ id: 7 }), { duration: 1 })
            s.play(made.admit(), { duration: 2, ease: linear })
            expect(made.stateOf(4).place).toBe(2)
            s.play(made.finish(1), made.admit(), { duration: 1 })
            s.play(made.reject([3, 4, 5], '429'), { duration: 1 })
        })
        const dots = (time: number) => at(time, () => shows(made.more[0]!.children[0]!))
        // The count is of all the items, and the picture shows the first three.
        expect(said(made.captions[0]!, 0.5)).toEqual(['waiting 6'])
        expect([1, 2, 3, 4, 5, 6].map((id) => seen(made, id, 0.5))).toEqual([1, 1, 1, 0, 0, 0])
        expect(dots(0.5)).toBe(1)
        // An item with no place is not a part of the bounds: the object keeps its width.
        at(0.5, () => expect(made.bounds().width).toBeCloseTo(1000, 6))
        expect(seen(made, 7, 2)).toBe(0)
        expect(said(made.captions[0]!, 2)).toEqual(['waiting 7'])
        // When the head leaves, the next item comes into the last place. It shows on the second half of its
        // way, when it is clear of the dots.
        const last = made.p({ line: 0, place: 2 })
        expect([2, 3, 3.5, 4].map((time) => seen(made, 4, time))).toEqual([0, 0, expect.closeTo(0.5, 6), 1])
        expect(where(made, 4, 4)).toEqual(last)
        at(3.5, () => expect(box(made, 4, 3.5).x).toBeGreaterThan(made.more[0]!.bounds().x + made.more[0]!.bounds().width))
        // The dots go when every item that waits has a place: after the three rejections, 6 and 7 are left.
        expect([4, 5, 6.1].map(dots)).toEqual([1, 1, 0])
        expect([6, 7].map((id) => where(made, id, 6))).toEqual([made.p({ line: 0, place: 0 }), made.p({ line: 0, place: 1 })])
        expect([6, 7].map((id) => seen(made, id, 6))).toEqual([1, 1])
    })

    it('gives the blocks of the pool to an item that runs, takes them back when it finishes, and gives them to the next one', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'A', blocks: 3, running: true }, { id: 'B', blocks: 2, color: 'orange' }, { id: 'C', blocks: 4, color: 'green' }], { slots: 2, pool: { blocks: 6, name: 'KV pages', columns: 3 } }))
            expect([made.freeBlocks, made.stateOf('A').blocks, made.stateOf('B').blocks]).toEqual([3, 3, 2])
            s.wait(1)
            s.play(made.admit(), { duration: 2 })
            expect(made.freeBlocks).toBe(1)
            s.play(made.take('B', 1), { duration: 1 })
            expect([made.freeBlocks, made.stateOf('B').blocks]).toEqual([0, 3])
            s.wait(1)
            // A is the item that leaves: its three blocks are free again, and C takes them and one more... which the pool does not have.
            expect(() => s.play(made.finish('A'), made.admit())).toThrow('requestQueue: admit(): "C" needs 4 blocks, and the pool has 3 free of 6. `finish` an item first, to get its blocks back')
        })
        const look = (block: number, time: number) => at(time, () => [made.blocks[block]!.get('fill'), made.blocks[block]!.get('fillOpacity'), made.blocks[block]!.get('dash') !== null] as const)
        // The first free blocks, by index: A has 0 to 2, B takes 3 and 4 as it comes into its slot, and then 5.
        expect([0, 1, 2].map((block) => look(block, 0))).toEqual(Array(3).fill([paintOf('blue'), 0.7, false]))
        expect([3, 4, 5].map((block) => look(block, 1)[2])).toEqual([true, true, true])
        expect(look(3, 1)[1]).toBe(0)
        expect([3, 4].map((block) => look(block, 3))).toEqual(Array(2).fill([paintOf('orange'), 0.7, false]))
        expect(look(5, 3)[2]).toBe(true)
        expect(look(5, 4)).toEqual([paintOf('orange'), 0.7, false])
        // The blocks fill in the last part of the way of the item, one after another.
        expect([1.5, 2].map((time) => look(3, time)[1])).toEqual([0, 0])
        expect(look(3, 2.7)[1]).toBeGreaterThan(look(4, 2.7)[1])
        expect([0.5, 3, 4].map((time) => said(made.poolCaption!, time))).toEqual([['KV pages 3 / 6'], ['KV pages 5 / 6'], ['KV pages 6 / 6']])
        // The blocks are one grid, row by row, under the slots.
        const cells = made.blocks.map((cell) => at(0, () => [cell.get('x'), cell.get('y')]))
        expect(cells[3]![0]).toBe(cells[0]![0])
        expect(cells[3]![1]).toBeGreaterThan(cells[0]![1])
        expect(cells[1]![1]).toBe(cells[0]![1])
        expect(cells[0]).toEqual(made.p({ block: 0 }))
    })

    it('uses a block again when its owner is gone, in one play with the item that leaves', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'A', blocks: 2, running: true }, { id: 'D', blocks: 2, color: 'orange' }], { slots: 1, pool: 2 }))
            s.wait(1)
            s.play(made.finish('A'), made.admit(), { duration: 2 })
            expect([made.freeBlocks, made.stateOf('D').blocks, made.stateOf('A').blocks]).toEqual([0, 2, 0])
        })
        const look = (block: number, time: number) => at(time, () => [made.blocks[block]!.get('fill'), made.blocks[block]!.get('fillOpacity')] as const)
        expect([0, 1].map((block) => look(block, 1))).toEqual(Array(2).fill([paintOf('blue'), 0.7]))
        expect([0, 1].map((block) => look(block, 3))).toEqual(Array(2).fill([paintOf('orange'), 0.7]))
        // No block shows a look that is not on the way from the first owner to the second: the fill never goes over 0.7.
        for (let time = 1; time <= 3; time += 0.05) for (const block of [0, 1]) expect(look(block, time)[1]).toBeLessThanOrEqual(0.7 + 1e-9)
        expect(said(made.poolCaption!, 3)).toEqual(['blocks 2 / 2'])
        const pool = (build: (made: Queue, s: Stage) => void, options: Parameters<typeof requestQueue>[1] = { pool: 4 }) => compile((s) => build(s.add(requestQueue([{ id: 'A', running: true }, { id: 'W' }], options)), s))
        await expect(pool((q, s) => s.play(q.take('A', 5)))).rejects.toThrow('requestQueue: take("A", 5): "A" needs 5 blocks, and the pool has 4 free of 4. Raise `pool`')
        await expect(pool((q, s) => s.play(q.take('W', 1)))).rejects.toThrow('requestQueue: take("W", 1): "W" is waiting. An item holds blocks while it is in a slot')
        await expect(pool((q) => q.take('A', 1), {})).rejects.toThrow('requestQueue: take: the queue has no pool')
        await expect(compile(() => { requestQueue([{ id: 'A', blocks: 2 }]) })).rejects.toThrow('requestQueue: "A" has blocks, and the queue has no pool')
        await expect(compile(() => { requestQueue([{ id: 'A', running: true, blocks: 3 }, { id: 'B', running: true, blocks: 3 }], { slots: 2, pool: 4 }) })).rejects.toThrow('requestQueue: the first items: "B" runs at the start, and it needs 3 blocks, and the pool has 1 free of 4. Raise `pool`')
    })

    it('lets an item arrive while its line closes up, behind the items that move', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'A' }, { id: 'B' }], { slots: 2 }))
            s.wait(1)
            // The new item is in a hurry: its own ease would put it in its place before B has left it.
            s.play(made.admit(undefined, { ease: linear }), made.arrive({ id: 'C' }, { ease: (share: number) => Math.sqrt(share) }), { duration: 2 })
            expect(['B', 'C'].map((id) => made.stateOf(id).place)).toEqual([0, 1])
        })
        expect(where(made, 'C', 3)).toEqual(made.p({ line: 0, place: 1 }))
        for (let time = 1; time <= 3.001; time += 0.02) expect(where(made, 'B', time)[0] - where(made, 'C', time)[0]).toBeGreaterThanOrEqual(PITCH - 1e-6)
        const two = (build: (made: Queue, s: Stage) => void) => compile((s) => build(s.add(requestQueue([{ id: 'A' }, { id: 'B' }], { slots: 2 })), s))
        await expect(two((q, s) => s.play(par(q.admit(undefined, { duration: 2 }), q.arrive({ id: 'C' }, { duration: 0.5 }))))).rejects.toThrow('requestQueue: arrive("C"): "C" is in its place at 0.5 s, and admit() moves in the line "waiting" until 2 s. An item takes its place behind the items before it. Give this arrival a duration that ends at 2 s or later')
        await expect(compile((s) => { const q = s.add(requestQueue([])); s.play(q.arrive({ id: 'C' }), q.admit('C')) })).rejects.toThrow('requestQueue: admit("C") starts at 0 s, and arrive("C") moves "C" until 0.6 s. An item takes one change at a time')
        await expect(two((q, s) => s.play(q.arrive({ id: 'A' })))).rejects.toThrow('requestQueue: arrive("A"): the queue has an item with the id "A"')
        // The queue takes its changes in the order of time. A change that the film calls later and that starts sooner is an error that says so.
        await expect(two((q, s) => s.play(par(delay(q.admit(), 1), q.arrive({ id: 'C' }))))).rejects.toThrow('requestQueue: arrive("C") starts at 0 s, and the film called admit() before it, which starts at 1 s. The queue takes its changes in the order of time: each one starts from the state that the one before it left. Call arrive("C") before admit()')
        await two((q, s) => {
            s.play(par(q.arrive({ id: 'C' }), delay(q.admit(), 1)))
            expect(q.stateOf('A').state).toBe('running')
        })
        await expect(two((q) => q.arrive({ id: 'N', running: true }))).rejects.toThrow('requestQueue: arrive: "N" has `running`')
        await expect(two((q) => q.arrive({ id: 'request-1234567890' }))).rejects.toThrow('requestQueue: the id "request-1234567890" is 287 px wide at size 28, and an item is 120 px wide, with 92 px for its id. An id can be 0.6 of the size at the least. Use a shorter id, or an `itemWidth` of 201 or more')
    })

    it('draws the line of a waiting line with a gap under each item, and an arrow head at the side of the slots', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'A' }, { id: 'B' }], { slots: 1 }))
            s.wait(1)
            s.play(made.reject('B', '503'), { duration: 10, ease: linear })
            s.play(made.admit(), { duration: 2, ease: linear })
        })
        const rings = (time: number) => at(time, () => (made.rails[0]!.draw!(time) as Node).get('path')!.map((ring) => pathBounds([ring])!))
        /** The pieces of the line at a time, each from its left end to its right end, on the stage. */
        const pieces = (time: number) => rings(time).filter((ring) => ring.height < 0.5).map((ring) => [ring.x, ring.x + ring.width] as const)
        const drawn = (time: number, x: number) => pieces(time).some(([from, to]) => from <= x && x <= to)
        const [a, y] = made.p({ line: 0, place: 0 }), b = made.p({ line: 0, place: 1 })[0]
        // The line starts at the left edge of the object, is at the height of the items, and has no piece under an item.
        expect(Math.min(...pieces(0.5).map(([from]) => from))).toBeCloseTo(-800, 6)
        expect(rings(0.5).filter((ring) => ring.height < 0.5).every((ring) => Math.abs(ring.y - y) < 1e-6)).toBe(true)
        expect([a, b, b - 59, b + 59, a - 59, a + 59].map((x) => drawn(0.5, x))).toEqual(Array(6).fill(false))
        expect([b - 61, (a + b) / 2, a + 61].map((x) => drawn(0.5, x))).toEqual([true, true, true])
        // The arrow head is after the head of the line, and points at the slots.
        const head = rings(0.5).find((ring) => ring.height > 0.5)!
        expect(head.x).toBeGreaterThan(a + W / 2)
        expect(head.x + head.width).toBeLessThan(made.p({ slot: 0 }, 'left')[0] - W)
        expect(head.y + head.height / 2).toBeCloseTo(y, 6)
        expect(Math.max(...pieces(0.5).map(([, to]) => to))).toBeCloseTo(head.x + head.width, 6)
        // An item that fades still has its gap, so the line does not show through it. The line is whole when the item is gone.
        expect([8, 8.9].map((time) => drawn(time, b))).toEqual([false, false])
        expect(drawn(9.5, b)).toBe(true)
        // An item that leaves its line for a slot takes its gap with it, while it is at the height of the line.
        expect([11, 11.2].map((time) => drawn(time, where(made, 'A', time)[0]))).toEqual([false, false])
        expect(drawn(13, a)).toBe(true)
    })

    it.each(['admit', 'reject'] as const)('keeps an arrival behind a line that loses two items to %s', async (verb) => {
        let q!: Queue
        await compile((s) => {
            q = s.add(requestQueue([{ id: 'A' }, { id: 'B' }, { id: 'C' }], { slots: 2 }))
            s.play(verb === 'admit' ? q.admit(['A', 'B']) : q.reject(['A', 'B'], '429'), q.arrive({ id: 'D' }), { duration: 1, ease: linear })
        })
        for (let frame = 1; frame <= 30; frame++) {
            const time = frame / 30
            if (seen(q, 'D', time) > 0) expect(apart(box(q, 'C', time), box(q, 'D', time))).toBe(true)
        }
        expect(where(q, 'D', 1)).toEqual(q.p({ line: 0, place: 1 }))
    })

    it.each(['take', 'run'] as const)('finishes an item only after its %s animation ends', async (verb) => {
        await expect(compile((s) => {
            const q = s.add(requestQueue([{ id: 'A', running: true, work: verb === 'run' ? 1 : undefined }], { pool: 1 }))
            const activity = verb === 'run' ? q.run(1, { duration: 2 }) : q.take('A', 1, { duration: 2 })
            s.play(activity, q.finish('A', { duration: 0.5 }))
        })).rejects.toThrow(/finish.*A.*until 2 s/)
    })

    it.each(['take', 'run'] as const)('starts %s after an item reaches its slot', async (verb) => {
        await expect(compile((s) => {
            const q = s.add(requestQueue([{ id: 'A', work: 1 }], { pool: 1 }))
            s.play(q.admit(), verb === 'run' ? q.run(1) : q.take('A', 1))
        })).rejects.toThrow(/A.*reaches its slot/)
    })

    it('keeps the pool count in step with the block outlines during a handoff', async () => {
        let q!: Queue
        await compile((s) => {
            q = s.add(requestQueue([{ id: 'A', running: true, blocks: 1 }, { id: 'B', running: true }], { pool: 1, slots: 2 }))
            s.play(q.finish('A', { duration: 2 }), q.take('B', 1, { duration: 0.5 }))
        })
        for (const time of [0, 0.3, 0.5, 1, 1.5, 2]) {
            const used = at(time, () => q.blocks[0]!.get('dash') === null ? 1 : 0)
            expect(said(q.poolCaption!, time)).toEqual([`blocks ${used} / 1`])
        }
    })

    it('can retry a batch after a refused admission', async () => {
        await compile((s) => {
            const q = s.add(requestQueue([{ id: 'R', running: true }, { id: 'A' }, { id: 'B' }], { slots: 2 }))
            expect(() => s.play(q.admit(['A', 'B']))).toThrow(/no slot is free/)
            expect(q.next(2)).toEqual(['A', 'B'])
            s.play(q.finish('R'), q.admit(['A', 'B']))
            expect(q.count('running')).toBe(2)
        })
    })

    it('preserves every wait and the scheduling time when one requested wait goes backward', async () => {
        await compile((s) => {
            const q = s.add(requestQueue([{ id: 'A' }, { id: 'B' }]))
            s.play(q.wait('B', 10), { duration: 0 })
            s.at(5, () => {
                expect(() => s.play(q.wait(['A', 'B'], 8))).toThrow(/wait does not go back/)
            })
            expect(q.stateOf('A').wait).toBe(0)
            s.play(q.wait('A', 4))
            expect(q.stateOf('B').wait).toBe(10)
        })
    })

    it('animates the queue in a copied group independently', async () => {
        await compile((s) => {
            const original = requestQueue([{ id: 'A' }])
            const groupCopy = group(original).clone()
            const copy = groupCopy.children[0] as Queue
            s.add(groupCopy)
            s.play(copy.admit())
            expect(original.stateOf('A').state).toBe('waiting')
            expect(copy.stateOf('A').state).toBe('running')
            expect(where(copy, 'A', s.time)).toEqual(copy.p({ slot: 0 }))
            const secondGroup = groupCopy.clone()
            const second = secondGroup.children[0] as Queue
            s.add(secondGroup)
            s.play(second.finish('A'))
            expect(second.stateOf('A').state).toBe('done')
            expect(copy.stateOf('A').state).toBe('running')
            expect(original.stateOf('A').state).toBe('waiting')
        })
    })

    it('keeps its own bookkeeping in a copy, at rest in the state of the queue', async () => {
        await compile((s) => {
            const made = s.add(requestQueue([{ id: 'A', work: 2, blocks: 1 }, { id: 'B' }], { slots: 2, pool: 2, deadline: 10 }))
            s.play(made.admit(), { duration: 1 })
            s.play(made.run(1), made.wait('B', 20), { duration: 1 })
            const copy = made.clone()
            expect(copy.ids).toEqual(['A', 'B'])
            expect(copy.stateOf('A')).toEqual(made.stateOf('A'))
            expect(copy.stateOf('B')).toMatchObject({ wait: 20, late: true, place: 0 })
            expect(copy.item('A')).not.toBe(made.item('A'))
            // The copy is at rest: each item is where the queue has it, with its bar, its number and its wait.
            const outer = copy.item('A').parent!
            expect([outer.get('x'), outer.get('y')]).toEqual(copy.p({ slot: 0 }))
            expect(copy.item('A').children[1]!.bounds().width).toBeCloseTo(W / 2, 6)
            expect(said(copy.item('A').children[3]!, 0)).toEqual(['1'])
            expect(said(copy.item('B').children[4]!, 0)).toEqual(['20'])
            expect(said(copy.poolCaption!, 0)).toEqual(['blocks 1 / 2'])
            expect(said(copy.slotsCaption, 0)).toEqual(['running 1 / 2'])
            // A change of the copy does not change the queue, and the reverse.
            s.add(copy)
            s.play(copy.admit(), copy.arrive({ id: 'N' }), { duration: 1 })
            expect([copy.count('running'), made.count('running'), copy.ids.length, made.ids.length, made.chips.length]).toEqual([2, 1, 3, 2, 2])
            s.play(made.run(1), { duration: 1 })
            expect([made.stateOf('A').left, copy.stateOf('A').left]).toEqual([0, 1])
            // A copy of a queue with no item has its own lists.
            const empty = requestQueue([])
            const twin = empty.clone()
            s.play(twin.arrive({ id: 'X' }))
            expect([empty.chips.length, twin.chips.length, empty.ids]).toEqual([0, 1, []])
        })
    })

    it('comes to the stage with its first animation, and follows a group that moves it', async () => {
        let made!: Queue, grouped!: Queue
        const f = await compile((s) => {
            made = requestQueue([{ id: 'A' }], { slots: 1, width: 900 })
            s.wait(1)
            s.play(made.admit(), { duration: 1 })
            grouped = requestQueue([{ id: 'A' }], { slots: 1, width: 900 })
            const holder = s.add(group(grouped).at(100, 200))
            holder.scale(0.5, [100, 200])
            s.play(grouped.arrive({ id: 'B' }), { duration: 1 })
            const region = grouped.region({ slot: 0 }), [x, y] = grouped.p({ slot: 0 })
            expect([region.cx, region.cy]).toEqual([100 + x / 2, 200 + y / 2])
            expect(region.width).toBeCloseTo(W / 2, 6)
            // A queue in a zone keeps its size: the zone is around the whole object.
            const framed = requestQueue([{ id: 'A' }], { slots: 1, width: 900 })
            const around = zone([framed], { title: 'server' })
            expect(around.bounds().width).toBeGreaterThanOrEqual(900)
        })
        expect(at(0.5, () => made.mounted && made.get('visible'))).toBe(false)
        expect(at(1.5, () => made.get('visible'))).toBe(true)
        // The item of the queue in the group is at half of its place from the middle of the group.
        at(3, () => {
            const border = parts(grouped, 'B').body.bounds(), [x, y] = grouped.p({ line: 0, place: 1 })
            expect([border.x + border.width / 2, border.y + border.height / 2]).toEqual([100 + x / 2, 200 + y / 2])
            expect(border.width).toBeCloseTo(W / 2, 6)
        })
        expectPure(f, [0.5, 1.5, 2.5, 3])
    })

    it.each([false, true])('keeps a narrated queue across scenes after show uses enter: %s', async (enter) => {
        let first!: Queue, next!: Queue
        const f = await compileFilm(narrated({
            intro: false, fps: 10,
            timing: { lead: 1, gap: 0.5, tail: 0, scenes: [
                { id: 'queue', beats: [{ say: 'requests admit', duration: 3, hold: 0.5, words: [
                    { text: 'requests', start: 0, end: 0.3 }, { text: 'admit', start: 1, end: 1.3 },
                ] }] },
                { id: 'refill', beats: [{ say: 'work refill', duration: 3, hold: 1, words: [
                    { text: 'work', start: 0, end: 0.3 }, { text: 'refill', start: 1.5, end: 1.8 },
                ] }] },
            ] },
            scenes: {
                queue: (s, c) => {
                    first = requestQueue([{ id: 'A', work: 1 }, { id: 'B', work: 1 }])
                    c.show('requests', enter ? first.enter({ duration: 0.3 }) : first)
                    c.on('admit', () => {
                        s.play(first.admit(), { duration: 0.5 })
                        next = first.clone()
                    })
                    c.keep(first)
                },
                refill: (s, c) => {
                    c.take(next)
                    c.on('work', () => s.play(next.run(1), { duration: 0.5 }))
                    c.on('refill', () => s.play(next.finish(), next.admit(), { duration: 0.5 }))
                },
            },
        }))
        expect(first.stateOf('A').state).toBe('running')
        expect(next.stateOf('A').state).toBe('done')
        expect(next.stateOf('B').state).toBe('running')
        expect(seen(first, 'A', 4.6)).toBe(1)
        expect(seen(first, 'A', 4.8)).toBe(0)
        expect(seen(next, 'A', 4.6)).toBe(0)
        expect(seen(next, 'A', 4.8)).toBe(1)
        expect(where(first, 'A', 4.6)).toEqual(where(next, 'A', 4.8))
        expectPure(f, [0.5, 1.2, 2.5, 4.6, 4.8, 7.5])
    })

    it('measures every corner of a region through a rotated parent', async () => {
        await compile((s) => {
            const made = requestQueue([{ id: 'A' }], { width: 900, slots: 2, pool: 4 })
            s.add(group(made).at(120, -60).rotate(Math.PI / 4).scale([1.3, 0.8]))
            for (const part of [{ slot: 0 }, { line: 0 }, 'pool'] as const) {
                const [left] = made.p(part, 'left'), [right] = made.p(part, 'right')
                const [, top] = made.p(part, 'top'), [, bottom] = made.p(part, 'bottom')
                const corners = [[left, top], [right, top], [right, bottom], [left, bottom]].map(([x, y]) => made.toWorld(x!, y!))
                const region = made.region(part)
                expect([region.left, region.top, region.right, region.bottom]).toEqual([
                    Math.min(...corners.map(([x]) => x)), Math.min(...corners.map(([, y]) => y)),
                    Math.max(...corners.map(([x]) => x)), Math.max(...corners.map(([, y]) => y)),
                ])
            }
            expect(made.region().width).toBeCloseTo(boxOf(made).width, 6)
        })
    })

    it('ends an animation of no length in the state that it names', async () => {
        let made!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'A', work: 1 }, { id: 'B' }, { id: 'C' }], { slots: 1 }))
            s.wait(1)
            s.play(made.admit(), made.arrive({ id: 'D' }), { duration: 0 })
            s.play(made.run(1), { duration: 0 })
            s.play(made.finish(), { duration: 0 })
            s.play(made.reject('B', '503'), made.wait('C', 5), { duration: 0 })
            s.wait(1)
        })
        expect(['A', 'B', 'C', 'D'].map((id) => made.stateOf(id).state)).toEqual(['done', 'rejected', 'waiting', 'waiting'])
        expect(where(made, 'A', 0.5)).toEqual(made.p({ line: 0, place: 0 }))
        expect(['A', 'B', 'C', 'D'].map((id) => seen(made, id, 1.5))).toEqual([0, 0, 1, 1])
        expect(['C', 'D'].map((id) => where(made, id, 1.5))).toEqual([made.p({ line: 0, place: 0 }), made.p({ line: 0, place: 1 })])
        expect([said(made.captions[0]!, 1.5), said(made.slotsCaption, 1.5), said(made.doneTally!, 1.5), said(made.rejectedTally!, 1.5), said(parts(made, 'C').under, 1.5)]).toEqual([['waiting 2'], ['running 0 / 1'], ['done 1'], ['rejected 1'], ['5']])
        await expect(compile((s) => { const q = s.add(requestQueue([{ id: 'A' }])); s.play(q.admit(undefined, { duration: Number.NaN })) })).rejects.toThrow('requestQueue: the duration of admit() is NaN. Give a number, 0 or more')
        await expect(compile((s) => { const q = s.add(requestQueue([{ id: 'A' }])); s.play(q.admit(), { duration: Number.NaN }) })).rejects.toThrow('requestQueue: admit() plays from 0 to NaN')
    })

    it('never goes back with an ease that does, and enters with its lines, its slots and its items', async () => {
        let made!: Queue
        await compile((s) => {
            made = requestQueue([{ id: 'A' }, { id: 'B' }], { slots: 1 })
            s.play(made.enter(), { duration: 1, ease: linear })
            // An ease that goes there and back: the item stays in its slot, where the queue has it.
            s.play(made.admit(), { duration: 2, ease: (share: number) => Math.sin(share * Math.PI) })
            s.wait(1)
        })
        // The ease is at its end at 2 s, and back at 0.7 of the way at 2.5 s. The item is in its slot from 2 s on.
        expect([2, 2.5, 3].map((time) => where(made, 'A', time))).toEqual(Array(3).fill(made.p({ slot: 0 })))
        expect([2, 2.5, 3].map((time) => where(made, 'B', time))).toEqual(Array(3).fill(made.p({ line: 0, place: 0 })))
        // The line of the waiting line comes first, and the items come last.
        expect([0, 0.3, 0.6].map((time) => at(time, () => made.rails[0]!.get('opacity')))).toEqual([0, 0.5, 1])
        expect([0.01, 0.4, 0.7, 1].map((time) => seen(made, 'A', time))).toEqual([0, 0, expect.closeTo(0.5, 6), 1])
        expect([0.01, 1].map((time) => at(time, () => shows(made.captions[0]!)))).toEqual([0, 1])
        expect([0, 1].map((time) => at(time, () => shows(made.seats[0]!)))).toEqual([0, 1])
    })

    it('sets its texts at 26 px or more, in the font of the film, and sets an id that is too wide smaller', async () => {
        let made!: Queue, plain!: Queue
        await compile((s) => {
            made = s.add(requestQueue([{ id: 'R-1041', work: 12 }, { id: 'B' }], { slots: 1, deadline: 5, idFont: 'mono' }))
            plain = requestQueue([{ id: 'A', work: 1 }], { counts: false, names: { slots: 'workers', done: null }, itemWidth: 96 })
            s.play(made.wait('B', 9), made.reject('B', '503'), { duration: 2 })
        }, { font: 'text-serif' })
        const sizes = (holder: Node, time: number) => (at(time, () => holder.draw!(time)) as Node | Node[])
        const texts = (node: Node): TextNode[] => node.all().filter((part): part is TextNode => part instanceof TextNode)
        at(0.5, () => {
            const drawn = [made.captions[0]!, made.slotsCaption, parts(made, 'R-1041').number, parts(made, 'B').under].flatMap((holder) => [sizes(holder, 0.5)].flat().flatMap(texts))
            expect(drawn.length).toBeGreaterThanOrEqual(4)
            for (const node of drawn) {
                expect(node.size).toBeGreaterThanOrEqual(26)
                expect(node.font).toBe('text-serif')
            }
            const id = parts(made, 'R-1041').name as TextNode
            expect([id.size, id.font]).toEqual([28, 'mono'])
            // The first items set the width of an item: the longest id, its number, and the room at the two sides.
            expect(made.itemWidth).toBeGreaterThan(W)
            // The number ends at the place of its holder: a drawing has no parent, so its own bounds start from 0.
            const border = parts(made, 'R-1041').body.bounds(), ink = id.bounds(), end = parts(made, 'R-1041').number.toWorld(0, 0)[0]
            const start = end - (sizes(parts(made, 'R-1041').number, 0.5) as Node).bounds().width
            expect(ink.x - border.x).toBeGreaterThanOrEqual(12)
            expect(start - (ink.x + ink.width)).toBeGreaterThanOrEqual(8)
            expect(border.x + border.width - end).toBeGreaterThanOrEqual(12)
        })
        // Without counts, a name stands alone, and a count that the film turned off is not a part of the object.
        expect([said(plain.captions[0]!, 0), said(plain.slotsCaption, 0), plain.doneTally, plain.rejectedTally]).toEqual([['waiting'], ['workers'], null, null])
        expect(plain.itemWidth).toBe(96)
        // An id that is too wide for the item is set smaller, down to 0.6 of the size.
        await compile((s) => {
            const narrow = s.add(requestQueue([], { itemWidth: 110 }))
            s.play(narrow.arrive({ id: 'R-10412' }))
            const id = narrow.item('R-10412').children[2] as TextNode
            expect(id.size).toBeLessThan(28)
            expect(id.size).toBeGreaterThanOrEqual(28 * 0.6)
            expect(id.bounds().width).toBeLessThanOrEqual(110 - 28)
        })
        // The check of a film finds no crowded text in the layout of the object itself: with 0.3 and 0.7, with the
        // most room that the rule asks for, and at each frame of each animation.
        const busy = film({ font: 'text-serif' }, (s) => {
            const made = s.add(requestQueue([
                { id: 'A gjpqy', work: 12, blocks: 1, running: true }, { id: 'B', work: 4, line: 'batch' }, { id: 'C', line: 'batch' },
                ...Array.from({ length: 9 }, (_, index) => ({ id: `i${index}` })),
            ], { slots: 2, pool: 4, lines: ['interactive', 'batch'], deadline: 5, format: (ms) => `${Math.round(ms)} ms`, width: 1500 }))
            expect(made.data['object']).toBe('request queue')
            // An item that arrives later is a part of the object too: its id, its wait and its status.
            s.play(made.arrive({ id: 'N', work: 3, line: 'batch' }), { duration: 1 })
            s.play(made.wait(['B', 'N'], 9), { duration: 1 })
            s.play(made.run(12), made.reject(['B', 'N'], 'timeout'), { duration: 4 })
            s.play(made.finish(), made.admit(), { duration: 1 })
            s.wait(1)
        })
        for (const textGap of [0.3, 0.7, 3]) {
            // At 1.5 s the waits run, at 3.5 s the statuses show, and at 8 s the two counts of the items that left show.
            const still = await checkFilm(busy, { textGap, times: [0.5, 1.5, 2, 3.5, 5, 8] })
            expect(still.diagnostics.map((finding) => `${finding.code}: ${finding.message}`), `at ${textGap}`).toEqual([])
        }
        const moving = await checkFilm(busy, { textGap: 0.7, motion: true })
        expect(moving.diagnostics.map((finding) => `${finding.code}: ${finding.message}`)).toEqual([])
    })

    it('refuses a size, a width, a line or an item that it cannot draw, and says what to give', async () => {
        const bad = (build: () => unknown) => compile(() => { build() })
        await expect(bad(() => requestQueue([], { slots: 0 }))).rejects.toThrow('requestQueue: slots is 0. A queue has 1 to 12 slots, a whole number')
        await expect(bad(() => requestQueue([], { slots: 13 }))).rejects.toThrow('A queue has 1 to 12 slots')
        await expect(bad(() => requestQueue([], { width: 300 }))).rejects.toThrow('requestQueue: a width of 300 has no room for a place in the lines: the slots, the way to them and one place take 712 px. Give a width of 712 or more')
        await compile(() => { expect(requestQueue([], { width: 712 }).places).toBe(1) })
        await expect(bad(() => requestQueue([], { lines: [] }))).rejects.toThrow('requestQueue: lines has 0 lines. A queue has 1 to 4 waiting lines')
        await expect(bad(() => requestQueue([], { lines: ['a', 'a'] }))).rejects.toThrow('requestQueue: two lines have the name "a"')
        await expect(bad(() => requestQueue([], { lines: ['a line with a name that is far too long for the room over the places of one line'], width: 900 }))).rejects.toThrow('px wide, and the lines are')
        await expect(bad(() => requestQueue([], { color: 'nope' }))).rejects.toThrow('requestQueue: color is "nope", which is not a color')
        await expect(bad(() => requestQueue([{ id: 'A' }, { id: 'A' }]))).rejects.toThrow('requestQueue: two items have the id "A". Give each item its own id')
        // The queue knows an id by its text.
        await expect(bad(() => requestQueue([{ id: 7 }, { id: '7' }]))).rejects.toThrow('two items have the id "7"')
        await expect(bad(() => requestQueue([{ id: '' }]))).rejects.toThrow('requestQueue: an id is "". An id is a text of one line or a number')
        await expect(bad(() => requestQueue([{ id: 'A', work: 1.5 }]))).rejects.toThrow('requestQueue: the work of "A" is 1.5. It is a number of units, a whole number, 1 or more')
        await expect(bad(() => requestQueue([{ id: 'A', running: true }, { id: 'B', running: true }]))).rejects.toThrow('requestQueue: "B" is the item number 2 that runs at the start, and the queue has 1 slot. Raise `slots`, or leave out `running`')
        await expect(bad(() => requestQueue([], { pool: 0 }))).rejects.toThrow('requestQueue: the pool has 0 blocks. A pool has 1 to 256 blocks')
        await expect(bad(() => requestQueue([], { deadline: 0 }))).rejects.toThrow('requestQueue: deadline is 0. It is the wait from which an item is late, more than 0')
        await expect(bad(() => requestQueue([], { itemWidth: 10 }))).rejects.toThrow('requestQueue: itemWidth is 10. It is the width of an item, 56 or more at this text size')
        await expect(bad(() => requestQueue({} as never))).rejects.toThrow('requestQueue: the first argument is the list of the items that are there at the start')
        await expect(bad(() => requestQueue([]).p({ slot: 4 }))).rejects.toThrow('requestQueue: p: no slot 4. The queue has one slot, slot 0')
        await expect(bad(() => requestQueue([]).p('gate' as never))).rejects.toThrow("requestQueue: p: the part is \"gate\". A part is { line }, { line, place }, { slot }, { block }, 'slots' or 'pool'")
        await expect(bad(() => requestQueue([]).region('pool'))).rejects.toThrow('requestQueue: region: the queue has no pool')
        await expect(bad(() => requestQueue([{ id: 'A' }]).stateOf('B'))).rejects.toThrow('requestQueue: stateOf: no item has the id "B". The queue has "A"')
        await expect(bad(() => requestQueue([]).count('late' as never))).rejects.toThrow("requestQueue: no state \"late\". The states are 'waiting', 'running', 'done' and 'rejected'")
    })
})

describe('ring buffer', () => {
    type Made = ReturnType<typeof ringBuffer>
    type Box = { x: number; y: number; width: number; height: number }
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)
    const xy = (node: Node) => [node.get('x'), node.get('y')] as const
    const far = (place: readonly [number, number]) => Math.hypot(place[0], place[1])
    const corners = (box: Box) => [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]] as const
    const apart = (a: Box, b: Box, room = 0) => a.x + a.width + room <= b.x || b.x + b.width + room <= a.x || a.y + a.height + room <= b.y || b.y + b.height + room <= a.y
    const middle = (box: Box) => [box.x + box.width / 2, box.y + box.height / 2] as const
    const inside = (inner: Box, outer: Box) => Math.min(inner.x - outer.x, inner.y - outer.y, outer.x + outer.width - inner.x - inner.width, outer.y + outer.height - inner.y - inner.height)
    const paintOf = (color: string) => rect(1, 1, { fill: color }).get('fill')
    /** The labels of an entry that show now. */
    const words = (entry: Node) => entry.children.filter((child) => child.get('visible')).map((child) => (child as unknown as { source?: string }).source).filter((source) => source !== undefined)
    /** The two parts of a pointer: its arrow head, and the node that draws its name. The place of a pointer is its tip. */
    const parts = (pointer: Node) => ({ arrow: pointer.children[0]!, name: pointer.children[1]! })
    /** The text that is the name of a pointer now. */
    const nameText = (pointer: Node) => pointer.children[1]!.draw!(clock.now) as Node
    const nameOf = (pointer: Node) => (nameText(pointer) as unknown as { source: string }).source
    /** Two points are in one direction from the center of the ring. */
    const expectSameWay = (a: readonly [number, number], b: readonly [number, number], digits = 9) => {
        expect(a[0] / far(a)).toBeCloseTo(b[0] / far(b), digits)
        expect(a[1] / far(a)).toBeCloseTo(b[1] / far(b), digits)
    }
    /** A pointer is at a slot when its tip is in the direction of the middle of that slot, from the center of the ring. */
    const expectAtSlot = (made: Made, pointer: Node, slot: number) => expectSameWay(xy(pointer), made.p(slot))
    /** How far around the ring a pointer is, in slots from slot 0. */
    const turn = (made: Made, pointer: Node) => { const [x, y] = xy(pointer); return ((Math.atan2(y, x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / made.size) }

    it('puts slot 0 at the top and the slots clockwise, around the place of the ring', async () => {
        await compileFilm(film(() => {
            const made = ringBuffer(8, { radius: 200, thickness: 60 }).at(300, 100)
            expect(made.size).toBe(8)
            expect(made.slots).toHaveLength(8)
            expect(made.entries).toHaveLength(8)
            // The middle of the band is 170 from the center: slot 0 at the top, then the right, the bottom and the left.
            const quarter = [[0, -170], [170, 0], [0, 170], [-170, 0]]
            ;[0, 2, 4, 6].forEach((slot, index) => {
                expect(made.p(slot)[0]).toBeCloseTo(quarter[index]![0]!, 6)
                expect(made.p(slot)[1]).toBeCloseTo(quarter[index]![1]!, 6)
            })
            expect(made.p(1)[0]).toBeCloseTo(170 * Math.SQRT1_2, 6)
            expect(made.p(1)[1]).toBeCloseTo(-170 * Math.SQRT1_2, 6)
            // The slot wraps, in both directions.
            expect(made.p(8)).toEqual(made.p(0))
            expect(made.p(19)).toEqual(made.p(3))
            expect(made.p(-1)).toEqual(made.p(7))
            // Each outline is around the middle of its slot, and the band is centered on the place of the ring.
            const boxes = made.slots.map((slot) => slot.bounds())
            boxes.forEach((box, slot) => {
                const [x, y] = made.p(slot)
                expect(apart(box, { x: 300 + x, y: 100 + y, width: 0, height: 0 })).toBe(false)
            })
            expect(Math.min(...boxes.map((box) => box.x))).toBeCloseTo(100, 0)
            expect(Math.max(...boxes.map((box) => box.x + box.width))).toBeCloseTo(500, 0)
            expect(Math.min(...boxes.map((box) => box.y))).toBeCloseTo(-100, 0)
            expect(Math.max(...boxes.map((box) => box.y + box.height))).toBeCloseTo(300, 0)
            // Every slot starts empty.
            expect(made.entries.map(shows)).toEqual(Array(8).fill(0))
            expect([made.head, made.tail, made.length, made.pending]).toEqual([0, 0, 0, 0])
            // The fill of an entry is smaller than its slot on every side, so two entries side by side read as two.
            // The outline of a pending entry is inside the edge of the fill, so the entry keeps its size when it fills.
            for (const slot of [0, 2]) {
                const [fill, edge] = made.entries[slot]!.children.map((part) => part.bounds())
                expect(inside(fill!, boxes[slot]!)).toBeGreaterThan(2)
                expect(inside(edge!, fill!)).toBeGreaterThanOrEqual(made.entries[slot]!.children[1]!.get('strokeWidth') / 2 - 0.01)
            }
            // The default radius is 170, and a slot is 0.32 of the radius thick.
            const plain = ringBuffer(8)
            expect([plain.radius, plain.thickness]).toEqual([170, 170 * 0.32])
            expect(plain.p(0)[1]).toBeCloseTo(-(170 - 170 * 0.16), 6)
        }))
    })

    it('draws thinner outlines and keeps less room around a fill when the slots are narrow', async () => {
        await compileFilm(film(() => {
            // 64 slots on the default ring are 11.35 wide at the inner edge: 2 * 115.6 * sin(pi / 64).
            const chord = 2 * (170 - 170 * 0.32) * Math.sin(Math.PI / 64)
            const narrow = ringBuffer(64), wide = ringBuffer(8)
            // The outline is a fifth of that width. On 8 slots it is 0.0175 of the radius.
            expect(narrow.slots[0]!.get('strokeWidth')).toBeCloseTo(chord * 0.2, 6)
            expect(wide.slots[0]!.get('strokeWidth')).toBeCloseTo(170 * 0.0175, 6)
            // The fill is 0.22 of that width inside the slot. On 8 slots it is 3 inside the ink of the outline.
            const room = (made: Made) => { const fill = made.entries[0]!.children[0]!.bounds(), slot = made.slots[0]!.bounds(); return fill.y - slot.y }
            expect(room(narrow)).toBeCloseTo(chord * 0.22, 2)
            expect(room(wide)).toBeCloseTo(170 * 0.0175 / 2 + 3, 2)
            // The outline of a pending entry is dashed, and thinner than the outline of a slot.
            const dashed = wide.entries[0]!.children[1]!
            expect(dashed.get('dash')).not.toBeNull()
            expect(dashed.get('strokeWidth')).toBeCloseTo(170 * 0.0175 * 0.6, 6)
        }))
    })

    it('fills the slot at the tail and empties the slot at the head, then moves that pointer one slot on, along the band', async () => {
        let made!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(ringBuffer(8, { radius: 200, thickness: 60 }))
            s.wait(1)
            s.play(made.push(), { duration: 2, ease: linear })
            expect([made.head, made.tail, made.length]).toEqual([0, 1, 1])
            s.wait(1)
            s.play(made.pop(), { duration: 2, ease: linear })
            expect([made.head, made.tail, made.length]).toEqual([1, 1, 0])
        }))
        const entry = made.entries[0]!, tail = made.tailPointer!, head = made.headPointer!
        // The push is from 1 to 3. The slot fills in the first 0.45 of it, and the tail does not move yet.
        expect(at(1, () => shows(entry))).toBe(0)
        expect(at(1.45, () => shows(entry))).toBeCloseTo(0.5, 6)
        expect(at(1.9, () => shows(entry))).toBeCloseTo(1, 6)
        expect(at(1.9, () => [entry.children[0]!.get('fillOpacity'), entry.children[1]!.get('strokeOpacity')])).toEqual([1, 0])
        at(1.9, () => expectAtSlot(made, tail, 0))
        // Then the tail moves. Half way it is between the two slots, and as far from the center as at rest:
        // a straight line between the two slots would pass nearer to the center.
        at(2.45, () => expectAtSlot(made, tail, 0.5))
        expect(at(2.45, () => far(xy(tail)))).toBeCloseTo(at(1, () => far(xy(tail))), 6)
        at(3, () => expectAtSlot(made, tail, 1))
        at(3, () => expectAtSlot(made, head, 0))
        expect(at(3.5, () => shows(entry))).toBe(1)
        // The pop is from 4 to 6: the entry at the head empties, then the head moves.
        expect(at(4.45, () => shows(entry))).toBeCloseTo(0.5, 6)
        expect(at(4.9, () => shows(entry))).toBeCloseTo(0, 6)
        at(4.9, () => expectAtSlot(made, head, 0))
        at(5.45, () => expectAtSlot(made, head, 0.5))
        expect(at(5.45, () => far(xy(head)))).toBeCloseTo(at(4, () => far(xy(head))), 6)
        at(6, () => expectAtSlot(made, head, 1))
        at(6, () => expectAtSlot(made, tail, 1))
        expect(at(6, () => shows(entry))).toBe(0)
        // Without `counts`, a name is the name alone, before and after a move.
        expect([0, 6].map((time) => at(time, () => [nameOf(head), nameOf(tail)]))).toEqual([['head', 'tail'], ['head', 'tail']])
    })

    it('counts on past the last slot: after 9 pushes on 8 slots the tail is 9, at slot 1', async () => {
        let made!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(ringBuffer(8, { radius: 200, thickness: 60 }))
            for (let k = 0; k < 8; k++) s.play(made.push(), { duration: 0.5 })
            expect([made.head, made.tail, made.length]).toEqual([0, 8, 8])
            // The ring is full. In one sequence, the push finds the room that the two pops before it make.
            s.play(seq(made.pop(), made.pop(), made.push()), { duration: 1.5 })
            expect([made.head, made.tail, made.length]).toEqual([2, 9, 7])
        }))
        const tail = made.tailPointer!, head = made.headPointer!
        // After one turn, the tail is exactly where it started.
        expect(at(4, () => xy(tail))).toEqual(at(0, () => xy(tail)))
        expect(at(4, () => made.entries.map(shows))).toEqual(Array(8).fill(1))
        at(5.5, () => expectAtSlot(made, tail, 1))
        at(5.5, () => expectAtSlot(made, head, 2))
        expect(at(5.5, () => xy(tail))).toEqual(at(0.5, () => xy(tail)))
        // The ninth entry is in slot 0, and slot 1 is empty: its entry was read.
        expect(at(5.5, () => made.entries.map(shows))).toEqual([1, 0, 1, 1, 1, 1, 1, 1])
    })

    it('lets the entry that is read leave before the new entry of its slot arrives, when a pop and a push share one play', async () => {
        let made!: Made, pending!: Made
        let blue: unknown, green: unknown
        await compileFilm(film({ fps: 20 }, (s) => {
            blue = paintOf('blue')
            green = paintOf('green')
            made = s.add(ringBuffer(4, { radius: 200, thickness: 60 }))
            pending = s.add(ringBuffer(2, { radius: 200, thickness: 60 }))
            s.play(seq(made.push(), made.push(), made.push(), made.push()), seq(pending.push({ pending: true, label: 'A' }), pending.push({ pending: true })), { duration: 1 })
            // Both rings are full, so the push takes the slot that the pop reads, in the same second.
            s.play(made.pop(), made.push({ color: 'green' }), pending.publish(), pending.pop(), pending.push({ pending: true }), { duration: 1, ease: linear })
            expect([made.head, made.tail, made.length]).toEqual([1, 5, 4])
            expect([pending.length, pending.pending]).toEqual([2, 1])
        }))
        // The slot changes in the first 0.45 s: the old entry fades out in the first half of it, with its
        // own color, and the new one fades in in the second half.
        const cell = made.entries[0]!, fill = cell.children[0]!
        expect(at(1, () => [shows(cell), fill.get('fill')])).toEqual([1, blue])
        expect(at(1.1125, () => [shows(cell), fill.get('fill')])).toEqual([expect.closeTo(0.5, 6), blue])
        expect(at(1.3375, () => [shows(cell), fill.get('fill')])).toEqual([expect.closeTo(0.5, 6), green])
        expect(at(1.45, () => shows(cell))).toBeCloseTo(1, 6)
        expect(at(2, () => [shows(cell), fill.get('fill')])).toEqual([1, green])
        // A publish in the same play is of the old entry. It does not take the outline of the new pending
        // entry away, or fill it: the new entry shows as an outline, and has no label of the old one.
        const [inner, dashed] = pending.entries[0]!.children
        for (const time of [1.5, 2, 3]) expect(at(time, () => [shows(pending.entries[0]!), inner!.get('fillOpacity'), dashed!.get('strokeOpacity')])).toEqual([1, 0, 1])
        expect(at(2, () => words(pending.entries[0]!))).toEqual([])
        // The other entry was published, and is full.
        expect(at(2, () => [pending.entries[1]!.children[0]!.get('fillOpacity'), pending.entries[1]!.children[1]!.get('strokeOpacity')])).toEqual([1, 0])
    })

    it('fills eight slots in order from eight pushes in one lagged, and moves the tail on without a jump', async () => {
        let made!: Made, batch!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(ringBuffer(16, { radius: 200, thickness: 60, counts: true }))
            batch = s.add(ringBuffer(16, { radius: 200, thickness: 60 }))
            // With a lag of 0.25, each push has 1 s, and starts 0.25 s after the push before it.
            s.play(lagged(Array.from({ length: 8 }, () => made.push()), { lag: 0.25 }), batch.push(), batch.push(), batch.push(), { duration: 2.75, ease: linear })
            expect([made.tail, made.length, batch.tail]).toEqual([8, 8, 3])
        }))
        // Slot k fills from 0.25 k, in 0.45 s. So the slots fill in the order of the pushes.
        for (let slot = 0; slot < 8; slot++) {
            expect(at(0.25 * slot, () => shows(made.entries[slot]!))).toBe(0)
            expect(at(0.25 * slot + 0.225, () => shows(made.entries[slot]!))).toBeCloseTo(0.5, 6)
            expect(at(0.25 * slot + 0.45, () => shows(made.entries[slot]!))).toBeCloseTo(1, 6)
        }
        expect(at(2.75, () => made.entries.map(shows))).toEqual([...Array(8).fill(1), ...Array(8).fill(0)])
        // The moves of the tail share time, and they add up: the tail goes from slot 0 to slot 8 and never jumps.
        const tail = made.tailPointer!
        let last = at(0.4, () => turn(made, tail))
        for (let time = 0.41; time < 2.749; time += 0.01) {
            const now = at(time, () => turn(made, tail))
            expect(now - last).toBeGreaterThanOrEqual(-1e-9)
            expect(now - last).toBeLessThan(0.1)
            last = now
        }
        expect(at(0.4, () => turn(made, tail))).toBeCloseTo(0, 6)
        at(2.75, () => expectAtSlot(made, tail, 8))
        // The count beside the name is the number of whole slots that the tail has passed, also between two rests.
        expect([0.6, 0.9, 1.25, 2.75].map((time) => at(time, () => nameOf(tail)))).toEqual(['tail 0', 'tail 1', 'tail 2', 'tail 8'])
        for (const time of [0.6, 0.9, 1.25, 1.7, 2.3]) expect(at(time, () => nameOf(tail))).toBe(`tail ${Math.floor(at(time, () => turn(made, tail)))}`)
        // Three pushes at one moment: the tail goes over three slots in the time of one move, from 1.2375 to 2.75.
        at(1.2375, () => expectAtSlot(batch, batch.tailPointer!, 0))
        at((1.2375 + 2.75) / 2, () => expectAtSlot(batch, batch.tailPointer!, 1.5))
        at(2.75, () => expectAtSlot(batch, batch.tailPointer!, 3))
        expect(at(1.2375, () => batch.entries.map(shows).slice(0, 4))).toEqual([expect.closeTo(1, 6), expect.closeTo(1, 6), expect.closeTo(1, 6), 0])
    })

    it('keeps the name with its arrow head when two moves of one pointer overlap, whichever of them starts first', async () => {
        let slow!: Made, late!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            slow = s.add(ringBuffer(8, { radius: 200, thickness: 60, counts: true }))
            late = s.add(ringBuffer(8, { radius: 200, thickness: 60, counts: true }))
            s.play(seq(late.push(), late.push()), { duration: 0.5 })
            // The first push takes 2 s and the second 0.9 s, so the move of the second one starts first.
            // The same holds for the pop that waits 0.6 s and the pop after it.
            s.play(slow.push({}, { duration: 2 }), slow.push(), par(delay(late.pop(), 0.6), late.pop()), { ease: linear })
        }))
        for (const [made, pointer] of [[slow, slow.tailPointer!], [late, late.headPointer!]] as const) {
            let last = at(0.5, () => turn(made, pointer))
            for (let time = 0.5; time <= 2.5001; time += 0.02) {
                at(time, () => {
                    // The name is on the line from the center through the tip, at every frame.
                    expectSameWay(middle(parts(pointer).name.bounds()), xy(pointer), 6)
                    const now = turn(made, pointer)
                    expect(now - last).toBeGreaterThanOrEqual(-1e-9)
                    expect(now - last).toBeLessThan(0.08)
                    last = now
                })
            }
            at(2.5, () => expectAtSlot(made, pointer, 2))
            expect(at(2.5, () => nameOf(pointer))).toMatch(/ 2$/)
        }
        // The second push moves the tail from 0.905 to 1.4, before the move of the first push starts.
        at(1.1525, () => expectAtSlot(slow, slow.tailPointer!, 0.5))
    })

    it('keeps the color and the label of an entry until it is read, and gives the slot to the next entry', async () => {
        let made!: Made
        let orange: unknown, green: unknown, ground: unknown
        await compileFilm(film({ fps: 20 }, (s) => {
            orange = paintOf('orange')
            green = paintOf('green')
            ground = paintOf('bg')
            made = s.add(ringBuffer(4, { radius: 200, thickness: 60 }))
            s.play(made.push({ color: 'orange', label: 'A' }), { duration: 1 })
            s.play(made.push(), { duration: 1 })
            s.play(made.pop(), { duration: 1, ease: linear })
            s.play(seq(made.push(), made.push(), made.push({ color: 'green', label: 'E' })), { duration: 1 })
        }))
        const fill = (slot: number) => made.entries[slot]!.children[0]!.get('fill')
        expect(at(1.5, () => fill(0))).toEqual(orange)
        // An entry with no color has the color of the ring.
        expect(at(2, () => fill(1))).toEqual(made.slots[0]!.get('stroke'))
        expect(at(2, () => words(made.entries[1]!))).toEqual([])
        // The label is in the middle of its slot, in the color of the background.
        const label = made.entries[0]!.children[2]!
        expect(at(1.5, () => words(made.entries[0]!))).toEqual(['A'])
        expect(at(1.5, () => middle(label.bounds()))[0]).toBeCloseTo(made.p(0)[0], 6)
        expect(at(1.5, () => middle(label.bounds()))[1]).toBeCloseTo(made.p(0)[1], 6)
        expect(at(1.5, () => label.children[0]!.get('fill'))).toEqual(ground)
        // While the entry is read, it still has its color.
        expect(at(2.2, () => shows(made.entries[0]!))).toBeGreaterThan(0)
        expect(at(2.2, () => fill(0))).toEqual(orange)
        // The fifth entry takes slot 0: its color and its label, and no label of the first entry.
        expect(at(4, () => fill(0))).toEqual(green)
        expect(at(4, () => words(made.entries[0]!))).toEqual(['E'])
        expect(at(4, () => shows(made.entries[0]!))).toBe(1)
    })

    it('draws a pending entry as a dashed outline with no fill, fills it at publish(), and refuses to read it before', async () => {
        let made!: Made
        let orange: Rgba, ground: Rgba
        await compileFilm(film({ fps: 20 }, (s) => {
            orange = paintOf('orange') as Rgba
            ground = paintOf('bg') as Rgba
            made = s.add(ringBuffer(8, { radius: 200, thickness: 60 }))
            s.play(made.push({ pending: true, color: 'orange', label: 'A' }), { duration: 1 })
            s.play(made.push({ pending: true }), made.push(), { duration: 1 })
            // The tail moves for a pending entry too. The entry at the head is pending, so the consumer cannot read it.
            expect([made.tail, made.length, made.pending]).toEqual([3, 3, 2])
            const pop = made.pop()
            expect(() => s.play(pop)).toThrow(/the entry at the head is pending, so the consumer cannot see it. publish\(\) before pop\(\)/)
            expect(made.head).toBe(0)
            // With a lag of 1, the two pending entries fill one after the other, the older one first.
            s.play(made.publish({ lag: 1 }), { duration: 1, ease: linear })
            expect(made.pending).toBe(0)
            // With nothing pending, publish() changes nothing. Then the consumer can read.
            s.play(made.publish(), { duration: 0.5 })
            s.play(made.pop(), { duration: 0.5 })
            expect([made.head, made.length]).toEqual([1, 2])
        }))
        const [fill, edge, label] = made.entries[0]!.children
        const filled = (slot: number) => made.entries[slot]!.children[0]!.get('fillOpacity')
        const outlined = (slot: number) => made.entries[slot]!.children[1]!.get('strokeOpacity')
        // Pending: the entry shows, with a dashed outline in its color and no fill. Its label has its color too.
        expect(at(1, () => [shows(made.entries[0]!), filled(0)])).toEqual([1, 0])
        expect(at(1, () => [edge!.get('stroke'), edge!.get('strokeOpacity'), fill!.get('fill')])).toEqual([orange!, 1, orange!])
        expect(edge!.get('dash')).not.toBeNull()
        expect(at(1, () => label!.children[0]!.get('fill'))).toEqual(orange!)
        at(1, () => expectAtSlot(made, made.tailPointer!, 1))
        // An entry that is not pending is filled from its push, and shows no outline.
        expect(at(2, () => [0, 1, 2].map(filled))).toEqual([0, 0, 1])
        expect(at(2, () => [0, 1, 2].map(outlined))).toEqual([1, 1, 0])
        // publish() is from 2 to 3: slot 0 fills in the first half, and slot 1 in the second.
        expect(at(2.25, () => [filled(0), filled(1)])).toEqual([expect.closeTo(0.5, 6), 0])
        expect(at(2.75, () => [filled(0), filled(1)])).toEqual([1, expect.closeTo(0.5, 6)])
        expect(at(3, () => [0, 1, 2].map(filled))).toEqual([1, 1, 1])
        // The outline stays until its entry is full, then the fill replaces it.
        expect(at(2.4, () => outlined(0))).toBe(1)
        expect(at(3, () => [0, 1].map(outlined))).toEqual([0, 0])
        // The label stays readable through the change. It has the color of the entry, then at once the
        // color of the background. At each moment it is at least 0.45 as far from what is under it as at the ends.
        const surface = made.slots[0]!.get('fill') as Rgba
        const distance = (a: Rgba, b: Rgba) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
        for (let time = 2; time <= 2.5001; time += 0.01) {
            const [ink, share] = at(time, () => [label!.children[0]!.get('fill') as Rgba, filled(0)] as const)
            expect(distance(ink, mixColor(surface, orange!, share))).toBeGreaterThan(0.45 * distance(orange!, surface))
        }
        expect(at(2.2, () => label!.children[0]!.get('fill'))).toEqual(orange!)
        expect(at(2.3, () => label!.children[0]!.get('fill'))).toEqual(ground!)
        expect(at(4, () => shows(made.entries[0]!))).toBe(0)
    })

    it('publishes from the oldest entry when the pending entries wrap, and does not let a late publish fill a new entry', async () => {
        let wrapped!: Made, late!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            wrapped = s.add(ringBuffer(4, { radius: 200, thickness: 60 }))
            late = s.add(ringBuffer(2, { radius: 200, thickness: 60 }))
            // Three entries written and read, then two pending ones: in slot 3, and past the last slot in slot 0.
            s.play(seq(wrapped.push(), wrapped.push(), wrapped.push(), wrapped.pop(), wrapped.pop(), wrapped.pop(), wrapped.push({ pending: true }), wrapped.push({ pending: true })), seq(late.push({ pending: true }), late.push({ pending: true })), { duration: 1 })
            // From 1 to 2, with a lag of 1: the older entry, in slot 3, fills first.
            s.play(wrapped.publish({ lag: 1 }), { duration: 1, ease: linear })
            // From 2 to 4 the publish of the second ring fills slot 0, then slot 1 from 3. In the first
            // second, the two entries are read and two new pending ones are written.
            s.play(late.publish({ lag: 1, duration: 2 }), retime(seq(late.pop(), late.pop(), late.push({ pending: true }), late.push({ pending: true })), { duration: 1 }), { ease: linear })
        }))
        const state = (ring: Made, slot: number) => [ring.entries[slot]!.children[0]!.get('fillOpacity'), ring.entries[slot]!.children[1]!.get('strokeOpacity')]
        expect(at(1.25, () => [state(wrapped, 3)[0], state(wrapped, 0)[0]])).toEqual([expect.closeTo(0.5, 6), 0])
        expect(at(1.75, () => [state(wrapped, 3)[0], state(wrapped, 0)[0]])).toEqual([1, expect.closeTo(0.5, 6)])
        // The new entry of slot 1 is written before 3, when the publish of the old entry of that slot would
        // start. It stays an outline with no fill, during that time and after it.
        expect(late.pending).toBe(2)
        for (const time of [3.2, 3.6, 4, 5]) expect(at(time, () => [shows(late.entries[1]!), ...state(late, 1)])).toEqual([1, 0, 1])
        for (const time of [3.2, 4, 5]) expect(at(time, () => [shows(late.entries[0]!), ...state(late, 0)])).toEqual([1, 0, 1])
    })

    it('keeps a pending label as far from its outline as a label is from the edge of a fill', async () => {
        let made!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(ringBuffer(8, { radius: 200, thickness: 60, labelSize: 20 }))
            s.play(seq(made.push(), made.push(), made.push({ label: 'writev', pending: true }), made.push(), made.push(), made.push(), made.push({ label: 'writev' })), { duration: 1 })
        }))
        // Slots 2 and 6 are at the right and the left, where the band is 60 wide and the label is across it.
        const room = (slot: number) => at(1, () => {
            const [fill, edge, label] = made.entries[slot]!.children.map((part) => part.bounds())
            const ink = edge!.x + made.entries[slot]!.children[1]!.get('strokeWidth') / 2
            return { pending: Math.min(label!.x - ink, 2 * middle(edge!)[0] - ink - label!.x - label!.width), filled: label!.x - fill!.x, size: made.entries[slot]!.children[2]!.data['size'] }
        })
        // The pending label is 4 or more from the ink of its outline, as the filled label is from the edge
        // of its fill. So the pending label is the smaller of the two, by the outline on each side.
        expect(room(2).pending).toBeGreaterThan(4)
        expect(room(6).filled).toBeGreaterThan(4)
        expect(room(2).pending).toBeCloseTo(room(6).filled, 0)
        expect(room(2).size as number).toBeLessThan(room(6).size as number)
    })

    it('gives each pointer its color, or the color of the ring, and keeps the slots and the caption in the color of the ring', async () => {
        let made!: Made
        const colors: Record<string, unknown> = {}
        await compileFilm(film({ fps: 20 }, (s) => {
            for (const name of ['teal', 'orange', 'purple', 'blue', 'red']) colors[name] = paintOf(name)
            made = s.add(ringBuffer(8, { color: 'teal', headColor: 'orange', tailColor: 'purple', label: 'submission queue', counts: true }))
            const plain = ringBuffer(8)
            expect(plain.headPointer!.children[0]!.get('fill')).toEqual(colors['blue'])
            expect(plain.tailPointer!.children[0]!.get('fill')).toEqual(colors['blue'])
            expect(nameText(plain.tailPointer!).children[0]!.get('fill')).toEqual(colors['blue'])
            s.play(made.push(), { duration: 1 })
            // The film can recolor a pointer as one node. The name follows the arrow head.
            made.headPointer!.color('red')
            s.wait(1)
        }))
        const ink = (pointer: Node) => [pointer.children[0]!.get('fill'), nameText(pointer).children[0]!.get('fill')]
        expect(at(0, () => ink(made.headPointer!))).toEqual([colors['orange'], colors['orange']])
        expect(at(0, () => ink(made.tailPointer!))).toEqual([colors['purple'], colors['purple']])
        // The name with the next count has the color of its pointer too.
        expect(at(1, () => nameOf(made.tailPointer!))).toBe('tail 1')
        expect(at(1, () => ink(made.tailPointer!))).toEqual([colors['purple'], colors['purple']])
        expect(at(2, () => ink(made.headPointer!))).toEqual([colors['red'], colors['red']])
        expect(made.slots[0]!.get('stroke')).toEqual(colors['teal'])
        expect(made.caption!.children[0]!.get('fill')).toEqual(colors['teal'])
        expect(at(1, () => made.entries[0]!.children[0]!.get('fill'))).toEqual(colors['teal'])
    })

    it('grows a scaled pointer about its tip, which stays on the band at every move', async () => {
        let made!: Made, plain!: Made, bare!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(ringBuffer(8, { radius: 200, thickness: 60, counts: true }))
            plain = s.add(ringBuffer(8, { radius: 200, thickness: 60, counts: true }))
            bare = s.add(ringBuffer(8, { radius: 200, thickness: 60 }))
            // A scale moves the pivot of a node to the middle of its bounds. A scale of 1 must change nothing.
            s.play(to(made, (ring) => ring.scale(1)), to(made.tailPointer!, (pointer) => pointer.scale(1.5)), to(made.headPointer!, (pointer) => pointer.scale(1.5)), { duration: 0.5 })
            for (const ring of [made, plain]) s.play(seq(ring.push(), ring.push(), ring.push(), ring.push(), ring.pop(), ring.pop()), { duration: 3 })
            // With no counts, a pointer has one text for its name. A film that measures the ring inside to(),
            // after the pointer moved, must not hold that text in place.
            s.play(seq(bare.push(), bare.push()), { duration: 0.5 })
            s.play(to(bare, (ring) => ring.scale(1)), { duration: 0.25 })
            s.play(seq(bare.push(), bare.push()), { duration: 0.5 })
        }))
        for (const [time, slot] of [[7, 2], [7.25, 2], [7.75, 4]] as const) {
            at(time, () => expectSameWay(middle(parts(bare.tailPointer!).name.bounds()), bare.p(slot), 6))
        }
        const size = (box: Box) => Math.hypot(box.width, box.height)
        // Every half second a move ends, in the scaled ring until 3.5 and in the plain one from 3.5.
        for (let step = 0; step <= 6; step++) {
            const tailSlot = Math.min(step, 4), headSlot = Math.max(0, step - 4)
            for (const [pointer, other, slot, outside] of [[made.tailPointer!, plain.tailPointer!, tailSlot, false], [made.headPointer!, plain.headPointer!, headSlot, true]] as const) {
                const scaled = at(0.5 + step * 0.5, () => ({ tip: xy(pointer), arrow: parts(pointer).arrow.bounds(), name: parts(pointer).name.bounds() }))
                const normal = at(3.5 + step * 0.5, () => ({ tip: xy(other), arrow: parts(other).arrow.bounds(), name: parts(other).name.bounds() }))
                // The tip is where the tip of a pointer that was not scaled is: on the band, at the slot.
                expect(scaled.tip).toEqual(normal.tip)
                expectSameWay(scaled.tip, made.p(slot))
                // The arrow head and the name are 1.5 times as large, and on their side of the band.
                expect(size(scaled.arrow)).toBeCloseTo(size(normal.arrow) * 1.5, 6)
                expect(size(scaled.name)).toBeCloseTo(size(normal.name) * 1.5, 6)
                for (const corner of [...corners(scaled.arrow), ...corners(scaled.name)]) {
                    if (outside) expect(far(corner)).toBeGreaterThan(200)
                    else expect(far(corner)).toBeLessThan(140)
                }
                // The name is beyond the arrow head, on the line through the tip, 1.5 times as far from it.
                expectSameWay(middle(scaled.name), scaled.tip, 6)
                expect(Math.abs(far(middle(scaled.name)) - far(scaled.tip))).toBeCloseTo(Math.abs(far(middle(normal.name)) - far(normal.tip)) * 1.5, 6)
            }
        }
    })

    it('puts one pointer outside the band and one inside, so the two do not meet at one slot', async () => {
        let made!: Made, swapped!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(ringBuffer(8, { radius: 200, thickness: 60 }))
            swapped = s.add(ringBuffer(8, { radius: 200, thickness: 60, outside: 'tail' }))
            // Three entries written and read: an empty ring with both pointers at slot 3.
            for (const ring of [made, swapped]) s.play(seq(ring.push(), ring.push(), ring.push(), ring.pop(), ring.pop(), ring.pop()), { duration: 1 })
            // Eight more entries: a full ring, with both pointers at slot 3 again.
            for (const ring of [made, swapped]) s.play(seq(...Array.from({ length: 8 }, () => ring.push())), { duration: 1 })
        }))
        for (const [ring, outer, inner] of [[made, made.headPointer!, made.tailPointer!], [swapped, swapped.tailPointer!, swapped.headPointer!]] as const) {
            for (const time of [0, 1, 2, 3, 4]) {
                at(time, () => {
                    // Each pointer touches the band: the outside one at the outer edge, the inside one at the inner edge.
                    expect(far(xy(outer)) - 200).toBeGreaterThan(0)
                    expect(far(xy(outer)) - 200).toBeLessThan(3)
                    expect(140 - far(xy(inner))).toBeGreaterThan(0)
                    expect(140 - far(xy(inner))).toBeLessThan(3)
                    for (const corner of corners(parts(outer).arrow.bounds())) expect(far(corner)).toBeGreaterThan(200)
                    for (const corner of corners(parts(inner).arrow.bounds())) expect(far(corner)).toBeLessThan(140)
                    expect(apart(outer.bounds(), inner.bounds(), 30)).toBe(true)
                })
            }
            at(2, () => expectAtSlot(ring, outer, 3))
            at(2, () => expectAtSlot(ring, inner, 3))
            // Empty at 2, and full at 4: the length tells the two apart, and the pointers do not.
            expect(ring.length).toBe(ring.size)
            expect(at(4, () => xy(outer))).toEqual(at(2, () => xy(outer)))
        }
    })

    it('rests each pointer at the middle of its slot, with its name upright and clear of the band, the arrow heads, the caption and the other name', async () => {
        let made!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(ringBuffer(16, { radius: 200, thickness: 60, label: 'submission queue', captionGap: 96, counts: true, head: 'consumer head', tail: 'producer tail' }))
            for (let k = 0; k < 17; k++) {
                s.play(made.push(), { duration: 0.25 })
                s.play(made.pop(), { duration: 0.25 })
            }
        }))
        const head = made.headPointer!, tail = made.tailPointer!
        // Every quarter second a move ends. The tail is then at the same slot as the head, or one slot on.
        for (let step = 0; step <= 34; step++) {
            at(step * 0.25, () => {
                const headSlot = Math.floor(step / 2), tailSlot = Math.ceil(step / 2)
                expectAtSlot(made, head, headSlot)
                expectAtSlot(made, tail, tailSlot)
                const outside = parts(head), inner = parts(tail)
                const outer = outside.name.bounds(), within = inner.name.bounds(), caption = made.caption!.bounds()
                expect([nameText(head).get('rotation'), nameText(tail).get('rotation'), outside.name.get('rotation'), head.get('rotation')]).toEqual([0, 0, 0, 0])
                // No corner of a name is in the band. The inside name is long, so near the top it moves toward the center to fit.
                for (const corner of corners(outer)) expect(far(corner)).toBeGreaterThan(200 + 6)
                for (const corner of corners(within)) expect(far(corner)).toBeLessThan(140 - 6)
                expect(apart(outer, within, 6)).toBe(true)
                expect(apart(outer, caption, 6)).toBe(true)
                expect(apart(within, caption, 6)).toBe(true)
                // The name is beyond its arrow head, on the line from the center through its slot.
                expect(far(middle(outer))).toBeGreaterThan(far(middle(outside.arrow.bounds())))
                expect(far(middle(within))).toBeLessThan(far(middle(inner.arrow.bounds())))
                expectSameWay(middle(outer), made.p(headSlot), 6)
                expectSameWay(middle(within), made.p(tailSlot), 6)
                // Slots 0, 4, 8 and 12 of 16 are at the top, the right, the bottom and the left. An arrow head
                // is upright there, so its bounds are its shape, and the name must be clear of them.
                if (headSlot % 4 === 0) expect(apart(outer, outside.arrow.bounds(), 6)).toBe(true)
                if (tailSlot % 4 === 0) expect(apart(within, inner.arrow.bounds(), 6)).toBe(true)
            })
        }
        // The caption is under the ring, and centered on it.
        const caption = at(0, () => made.caption!.bounds())
        expect(caption.y).toBeGreaterThan(200)
        expect(Math.abs(middle(caption)[0])).toBeLessThan(2)
    })

    it('puts the caption at a distance that follows from the radius, the size and the numbers alone, or at captionGap', async () => {
        await compileFilm(film(() => {
            const line = (slots: number, options: Parameters<typeof ringBuffer>[1]) => ringBuffer(slots, { label: 'a queue', ...options }).caption!.get('y')
            const plain = line(8, {})
            // The names, the counts, the side of a pointer, a pointer that is not there, the number of slots
            // and the thickness do not move the caption. So the captions of two such rings are on one line.
            for (const options of [{ outside: 'tail' }, { counts: true }, { head: 'kernel', counts: true }, { head: 'consumer', tail: 'producer' }, { head: null }, { thickness: 30 }, { tailFollows: 'publish' }] as const) expect(line(8, options)).toBe(plain)
            expect(line(16, {})).toBe(plain)
            // With numbers the caption is lower, and at one place for 8 and for 16 slots, which have numbers of two digits.
            const numbered = line(8, { numbers: true })
            expect(numbered).toBeGreaterThan(plain + 20)
            expect(line(16, { numbers: true })).toBe(numbered)
            expect(line(16, { numbers: true, counts: true, head: 'kernel' })).toBe(numbered)
            // A larger text or a larger ring moves it.
            expect(line(8, { size: 32 })).toBeGreaterThan(plain + 10)
            expect(line(8, { radius: 230 })).toBeGreaterThan(plain + 50)
            // captionGap is the distance from the band to the top of the capital letters of the caption.
            const made = ringBuffer(8, { radius: 200, label: 'ABC', captionGap: 100 })
            expect(made.caption!.bounds().y).toBeCloseTo(300, 0)
            expect(line(8, { numbers: true, captionGap: 100 })).toBe(line(16, { captionGap: 100 }))
            // A name that can reach the caption is an error, which gives a distance that has the room.
            const long = { head: 'the head of the consumer', counts: true }
            let need = 0
            try { ringBuffer(8, { label: 'a queue', ...long }) } catch (error) { need = Number(/can reach the caption under the ring.*"88" stands for it. Set captionGap to (\d+) or more/.exec((error as Error).message)?.[1]) }
            expect(need).toBeGreaterThan(80)
            expect(ringBuffer(8, { label: 'a queue', ...long, captionGap: need }).caption).not.toBeNull()
            expect(() => ringBuffer(8, { label: 'a queue', ...long, captionGap: need - 8 })).toThrow(/can reach the caption/)
            expect(() => ringBuffer(8, { label: 'a queue', captionGap: -1 })).toThrow(/captionGap is the distance/)
            // With no caption, a long name is no error. The names and the caption have the text size of the ring.
            expect(ringBuffer(8, long).caption).toBeNull()
            const small = ringBuffer(8, { label: 'a queue', size: 16 })
            expect([small.caption!.data['size'], nameText(small.headPointer!).data['size'], nameText(small.tailPointer!).data['size']]).toEqual([16, 16, 16])
        }))
    })

    it('has bounds that hold the outside name at every slot, so a zone around a ring has room for it', async () => {
        let made!: Made, around!: ReturnType<typeof zone>
        let first!: Box
        await compileFilm(film({ fps: 20 }, (s) => {
            made = ringBuffer(8, { radius: 200, thickness: 60, counts: true, label: 'submission queue' })
            first = made.bounds()
            around = s.add(zone(made, { title: 'shared memory' }))
            for (let k = 0; k < 8; k++) s.play(seq(made.push(), made.pop()), { duration: 0.5 })
        }))
        // At the start the name is at the top. The bounds reach as far to the sides as to the top.
        expect(first.x).toBeCloseTo(-(first.x + first.width), 6)
        expect(first.width).toBeGreaterThan(400 + 2 * 60)
        let right = 0
        for (let time = 0; time <= 4.0001; time += 0.05) {
            const name = at(time, () => parts(made.headPointer!).name.bounds())
            expect(inside(name, first)).toBeGreaterThanOrEqual(-0.01)
            expect(inside(name, at(time, () => around.frame.bounds()))).toBeGreaterThan(8)
            right = Math.max(right, name.x + name.width)
        }
        // The bounds have the room of a count of two digits, and no more: one digit of slack at the side.
        expect(first.x + first.width - right).toBeLessThan(26 * 0.7)
        // A ring with no pointer outside has the bounds of its band.
        expect(ringBuffer(8, { radius: 200, head: null }).bounds().width).toBeCloseTo(400, 0)
    })

    it('shows the running count beside each name, not the slot, and changes it when the pointer arrives', async () => {
        let made!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(ringBuffer(8, { radius: 200, thickness: 60, counts: true }))
            for (let k = 0; k < 8; k++) s.play(made.push(), { duration: 0.5 })
            s.play(made.pop(), { duration: 0.5 })
            s.play(made.push(), { duration: 1, ease: linear })
        }))
        const head = made.headPointer!, tail = made.tailPointer!
        expect(at(0, () => [nameOf(head), nameOf(tail)])).toEqual(['head 0', 'tail 0'])
        expect(at(4, () => [nameOf(head), nameOf(tail)])).toEqual(['head 0', 'tail 8'])
        expect(at(4.5, () => nameOf(head))).toBe('head 1')
        // The ninth push is from 4.5 to 5.5. The count changes at the end of the move, not before.
        expect(at(5.4, () => nameOf(tail))).toBe('tail 8')
        expect(at(5.5, () => nameOf(tail))).toBe('tail 9')
        at(5.5, () => expectAtSlot(made, tail, 1))
    })

    it('keeps the tail behind the pending entries until publish() with tailFollows, and marks where the producer writes', async () => {
        let made!: Made, plain!: Made
        let blue: unknown
        await compileFilm(film({ fps: 20 }, (s) => {
            blue = paintOf('blue')
            made = s.add(ringBuffer(8, { radius: 200, thickness: 60, counts: true, tailFollows: 'publish', tailColor: 'blue', color: 'dim', outside: 'tail' }))
            plain = s.add(ringBuffer(8, { radius: 200, thickness: 60, counts: true }))
            s.play(made.push(), plain.push({ pending: true }), { duration: 1 })
            // Three pending entries: the producer writes, and the consumer does not see them yet.
            s.play(seq(made.push({ pending: true }), made.push({ pending: true }), made.push({ pending: true })), { duration: 1 })
            expect([made.tail, made.length, made.pending]).toEqual([4, 4, 3])
            s.play(made.publish(), { duration: 1, ease: linear })
            expect(made.pending).toBe(0)
            // With a lag, the tail goes over each entry in the time in which that entry fills.
            s.play(seq(made.push({ pending: true }), made.push({ pending: true }), made.push({ pending: true })), { duration: 2 })
            s.play(made.publish({ lag: 0.5 }), { duration: 1, ease: linear })
        }))
        const tail = made.tailPointer!, marker = made.writeMarker!
        // The default is 'push': the tail moves for a pending entry, and there is no mark of the writer.
        expect(plain.writeMarker).toBeNull()
        at(1, () => expectAtSlot(plain, plain.tailPointer!, 1))
        // The mark is an arrow head with no name, in the color of the tail, dim, on the side of the tail.
        expect(marker.children).toHaveLength(1)
        expect([marker.children[0]!.get('fill'), marker.get('opacity')]).toEqual([blue, 0.5])
        expect(at(0, () => far(xy(marker)))).toBeGreaterThan(200)
        // An entry that is not pending moves both: the tail and the mark are at one place.
        expect(at(1, () => xy(marker))).toEqual(at(1, () => xy(tail)))
        expect(at(1, () => nameOf(tail))).toBe('tail 1')
        // Pending entries move the mark alone. The tail and its count stay.
        at(2, () => expectAtSlot(made, marker, 4))
        at(2, () => expectAtSlot(made, tail, 1))
        expect(at(2, () => nameOf(tail))).toBe('tail 1')
        // publish() is from 2 to 3. The tail goes over the three entries, and counts as it passes each slot.
        at(2.5, () => expectAtSlot(made, tail, 2.5))
        expect(at(2.5, () => nameOf(tail))).toBe('tail 2')
        at(3, () => expectAtSlot(made, tail, 4))
        expect(at(3, () => [nameOf(tail), xy(marker)])).toEqual(['tail 4', at(3, () => xy(tail))])
        // Three entries published with a lag of 0.5, from 5 to 6: each fills in 0.5 s, and starts 0.25 s
        // after the one before it. The tail is half over an entry when that entry is half full.
        at(5.25, () => expectAtSlot(made, tail, 4.5))
        expect(at(5.25, () => made.entries[4]!.children[0]!.get('fillOpacity'))).toBeCloseTo(0.5, 6)
        at(5.5, () => expectAtSlot(made, tail, 5.5))
        at(5.75, () => expectAtSlot(made, tail, 6.5))
        at(6, () => expectAtSlot(made, tail, 7))
        expect(made.tail).toBe(7)
    })

    it('draws no pointer for a name that is null, and the slot then changes over the whole time', async () => {
        let noHead!: Made, noTail!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            noHead = s.add(ringBuffer(8, { head: null, tailFollows: 'publish' }))
            noTail = s.add(ringBuffer(8, { tail: null, tailFollows: 'publish' }))
            s.play(noHead.push(), noTail.push(), { duration: 1, ease: linear })
            s.play(noHead.pop(), noTail.pop(), { duration: 1, ease: linear })
        }))
        expect(noHead.headPointer).toBeNull()
        expect(noHead.tailPointer).not.toBeNull()
        expect(noTail.tailPointer).toBeNull()
        expect(noTail.headPointer).not.toBeNull()
        // With no tail pointer, there is no mark of the writer.
        expect([noHead.writeMarker === null, noTail.writeMarker === null]).toEqual([false, true])
        // With a tail pointer the slot is full at 0.45 of the push. With none, it fills until the end.
        expect(at(0.45, () => shows(noHead.entries[0]!))).toBeCloseTo(1, 6)
        expect(at(0.45, () => shows(noTail.entries[0]!))).toBeCloseTo(0.45, 6)
        expect(at(1.45, () => shows(noHead.entries[0]!))).toBeCloseTo(0.55, 6)
        expect(at(1.45, () => shows(noTail.entries[0]!))).toBeCloseTo(0, 6)
        expect([noHead.head, noHead.tail, noTail.head, noTail.tail]).toEqual([1, 1, 1, 1])
    })

    it('writes the number of each slot beside it, beyond the arrow head of the outside pointer, and apart from the name', async () => {
        await compileFilm(film(() => {
            const made = ringBuffer(8, { radius: 200, thickness: 60, numbers: true, counts: true })
            expect(made.numbers.map((number) => (number as unknown as { source: string }).source)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])
            // A number is 0.7 of the text size, and dim.
            expect(made.numbers.map((number) => number.data['size'])).toEqual(Array(8).fill(26 * 0.7))
            expect(made.numbers[3]!.children[0]!.get('fill')).toEqual(paintOf('dim'))
            const arrow = parts(made.headPointer!).arrow.bounds(), name = parts(made.headPointer!).name.bounds()
            made.numbers.forEach((number, slot) => {
                const box = number.bounds()
                // The number is outside the band, in the direction of its slot.
                expectSameWay(middle(box), made.p(slot), 6)
                for (const corner of corners(box)) expect(far(corner)).toBeGreaterThan(200 + 6)
            })
            // At slot 0, from the band upward: the arrow head, the number, then the name. The name is three
            // gaps from the number, so that "head 0" and the number of the slot do not read as one phrase.
            const zero = made.numbers[0]!.bounds()
            expect(zero.y + zero.height).toBeLessThan(arrow.y - 4)
            expect(zero.y - name.y - name.height).toBeGreaterThanOrEqual(26 * 0.3 * 3 - 0.01)
            expect(zero.y - name.y - name.height).toBeLessThan(26 * 0.3 * 3 + 6)
            // With no numbers, the name is one gap from the arrow head.
            const bare = ringBuffer(8, { radius: 200, thickness: 60, counts: true })
            const [tip, word] = [parts(bare.headPointer!).arrow.bounds(), parts(bare.headPointer!).name.bounds()]
            expect(tip.y - word.y - word.height).toBeCloseTo(26 * 0.3, 1)
            // With no pointer outside, the numbers are nearer to the band.
            const alone = ringBuffer(8, { radius: 200, thickness: 60, numbers: true, head: null })
            expect(alone.numbers[0]!.bounds().y).toBeGreaterThan(zero.y + 8)
            expect(ringBuffer(8).numbers).toEqual([])
        }))
    })

    it('enters with the band first, slot after slot, then the pointers and the caption', async () => {
        let made!: Made, plain!: Made
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            made = ringBuffer(8, { label: 'submission queue', numbers: true })
            plain = ringBuffer(8, { label: 'a dim caption' })
            // The film made the caption dim. enter() brings it back to that, not to 1.
            plain.caption!.opacity(0.4)
            s.play(seq(made.push(), made.push()), { duration: 0 })
            s.wait(0.5)
            s.play(made.enter({ lag: 1 }), plain.enter(), { duration: 2, ease: linear })
            s.wait(0.5)
        }))
        expect((await compiled.frame(0.2)).ops).toHaveLength(0)
        expect((await compiled.frame(0.5)).ops).toHaveLength(0)
        const drawn = (ring: Made, slot: number) => ring.slots[slot]!.get('trimTo')
        const late = [made.headPointer!, made.tailPointer!, made.caption!]
        // The band has 0.7 of the time, from 0.5 to 1.9. With a lag of 1, each of the 8 slots has 0.175 s.
        expect(at(0.5 + 0.175 / 2, () => [drawn(made, 0), drawn(made, 1), drawn(made, 7)])).toEqual([expect.closeTo(0.5, 6), 0, 0])
        expect(at(1.7, () => [drawn(made, 0), drawn(made, 5), drawn(made, 7)])).toEqual([1, 1, 0])
        expect(at(1.7, () => late.map(shows))).toEqual([0, 0, 0])
        // The default lag is 0.5: a slot has 1.4 / 4.5 s, and starts when the slot before it is half drawn.
        const each = 1.4 / 4.5
        expect(at(0.5 + each / 2, () => [drawn(plain, 0), drawn(plain, 1)])).toEqual([expect.closeTo(0.5, 6), 0])
        expect(at(0.5 + each, () => [drawn(plain, 0), drawn(plain, 1), drawn(plain, 2)])).toEqual([1, expect.closeTo(0.5, 6), 0])
        // The fill of a slot comes in the second half of its time, and is whole at the end.
        const fillOf = (slot: number) => made.slots[slot]!.get('fillOpacity')
        expect(at(0.5, () => fillOf(0))).toBe(0)
        expect(at(0.5 + 0.175 / 2, () => fillOf(0))).toBe(0)
        expect(at(0.5 + 0.175 * 0.75, () => fillOf(0))).toBeCloseTo(0.5, 6)
        expect(at(2.6, () => made.slots.map((_, slot) => fillOf(slot)))).toEqual(Array(8).fill(1))
        // An entry that is in the ring and the number of a slot arrive with that slot.
        expect(at(0.5 + 0.175 / 2, () => [shows(made.numbers[0]!), shows(made.numbers[1]!)])).toEqual([expect.closeTo(0.5, 6), 0])
        expect(at(0.5 + 0.175, () => shows(made.entries[0]!))).toBeCloseTo(1, 6)
        expect(at(0.5 + 0.175, () => shows(made.entries[1]!))).toBe(0)
        // The pointers and the caption come last, from 0.65 of the time.
        expect(at(2.15, () => late.map(shows))).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.5, 6), expect.closeTo(0.5, 6)])
        expect(at(2.6, () => [...late, ...made.numbers, ...made.entries].map(shows))).toEqual([1, 1, 1, ...Array(8).fill(1), 1, 1, 0, 0, 0, 0, 0, 0])
        expect(at(2.6, () => made.slots.map((_, slot) => drawn(made, slot)))).toEqual(Array(8).fill(1))
        expect([2.15, 2.6].map((time) => at(time, () => shows(plain.caption!)))).toEqual([expect.closeTo(0.2, 6), 0.4])
        // enter() puts the ring on the stage: the film draws the 8 slots, the 2 entries, the 2 arrow heads and the texts.
        expect((await compiled.frame(2.6)).ops.length).toBeGreaterThan(8 + 2 + 2)
        // The setup pushes took no time, and the tail is at slot 2 from the start.
        at(0, () => expectAtSlot(made, made.tailPointer!, 2))
    })

    it('sets a label that is too wide smaller, inside its slot, and keeps a short label at its size', async () => {
        let made!: Made, plain!: Made, small!: Made
        await compileFilm(film({ fps: 20 }, (s) => {
            made = s.add(ringBuffer(8, { radius: 200, thickness: 60, labelSize: 20 }))
            plain = s.add(ringBuffer(8, { radius: 200, thickness: 60 }))
            small = s.add(ringBuffer(8, { radius: 200, thickness: 60, size: 12 }))
            s.play(seq(made.push({ label: 'A' }), made.push({ label: 'B' }), made.push({ label: 'writev' })), plain.push({ label: 'A' }), small.push({ label: 'A' }), { duration: 1 })
        }))
        const [short, , long] = [0, 1, 2].map((slot) => made.entries[slot]!.children[2]!)
        expect(short!.data['size']).toBe(20)
        expect(long!.data['size'] as number).toBeLessThan(20)
        expect(long!.data['size'] as number).toBeGreaterThanOrEqual(12)
        // Slot 2 is at the right, so the band is 60 wide there, from 140 to 200. The label is inside the fill.
        const box = at(1, () => long!.bounds())
        expect(box.x).toBeGreaterThan(140 + 6)
        expect(box.x + box.width).toBeLessThan(200 - 6)
        expect(middle(box)[1]).toBeCloseTo(0, 6)
        // The default size is 0.28 of the thickness, and the size of the names at the most.
        expect(plain.entries[0]!.children[2]!.data['size']).toBeCloseTo(16.8, 6)
        expect(small.entries[0]!.children[2]!.data['size']).toBe(12)
    })

    it('says what fits when a label does not: a label size, a number of slots, a radius', async () => {
        await compileFilm(film((s) => {
            // 'read' does not fit in a slot of a ring of 32. More thickness makes a slot narrower, so the
            // message does not name it.
            let message = ''
            try { ringBuffer(32).push({ label: 'read' }) } catch (error) { message = (error as Error).message }
            expect(message).toMatch(/the label "read" does not fit in a slot. At [\d.]+ px, its smallest size, it is \d+ px wide, and a slot has room for \d+ px. It fits with labelSize: \d+, or with \d+ slots, or with radius: \d+, or as a shorter label/)
            expect(message).not.toMatch(/thickness/)
            const [labelSize, slots, radius] = [/labelSize: (\d+)/, /with (\d+) slots/, /radius: (\d+)/].map((part) => Number(part.exec(message)![1]))
            // Each way works, and is the first that does: one more slot, or 10 less of radius, does not fit.
            const tried = (count: number, options: Parameters<typeof ringBuffer>[1]) => () => ringBuffer(count, options).push({ label: 'read' })
            expect(tried(32, { labelSize: labelSize! })).not.toThrow()
            expect(tried(slots!, {})).not.toThrow()
            expect(tried(32, { radius: radius! })).not.toThrow()
            expect(tried(slots! + 1, {})).toThrow(/does not fit in a slot/)
            expect(tried(32, { radius: radius! - 10 })).toThrow(/does not fit in a slot/)
            // The label size of the message is the largest at which the label keeps its size: one more, and it is set smaller.
            const drawn = (size: number) => {
                const made = s.add(ringBuffer(32, { labelSize: size }))
                s.play(made.push({ label: 'read' }), { duration: 0 })
                return made.entries[0]!.children[2]!.data['size'] as number
            }
            expect(drawn(labelSize!)).toBe(labelSize!)
            expect(drawn(labelSize! + 1)).toBeLessThan(labelSize! + 1)
            // A ring that the film gave a thickness keeps it in the advice. Where no number of slots helps, the message leaves it out.
            expect(() => ringBuffer(8, { radius: 200, thickness: 60 }).push({ label: 'submission' })).toThrow(/It fits with labelSize: \d+, or as a shorter label/)
        }))
    })

    it('names what is wrong: the number of slots, a full or an empty ring, a name that has no room', async () => {
        await compileFilm(film((s) => {
            expect(() => ringBuffer(1)).toThrow(/a ring has 2 to 64 slots, a whole number. It got 1/)
            expect(() => ringBuffer(65)).toThrow(/2 to 64 slots/)
            expect(() => ringBuffer(2.5)).toThrow(/2 to 64 slots/)
            expect(ringBuffer(2).size).toBe(2)
            expect(ringBuffer(64).size).toBe(64)
            expect(() => ringBuffer(8, { radius: 0 })).toThrow(/radius is the outer radius/)
            expect(() => ringBuffer(8, { radius: 100, thickness: 100 })).toThrow(/thickness is the radial size of a slot, more than 0 and less than the radius of 100/)
            expect(() => ringBuffer(8, { thickness: 0 })).toThrow(/thickness is the radial size/)
            expect(() => ringBuffer(8, { size: 0 })).toThrow(/size is a text size/)
            expect(() => ringBuffer(8, { labelSize: -1 })).toThrow(/labelSize is a text size/)
            expect(() => ringBuffer(8).p(Number.NaN)).toThrow(/names no slot/)

            // The fill state is known when a change is scheduled, so that is where a full or an empty ring is found.
            const made = s.add(ringBuffer(8, { radius: 200, thickness: 60 }))
            const pop = made.pop()
            expect(() => s.play(pop)).toThrow(/the ring is empty. push\(\) before the next pop\(\)/)
            s.play(seq(...Array.from({ length: 8 }, () => made.push())), { duration: 1 })
            const push = made.push()
            expect(() => s.play(push)).toThrow(/the ring is full, 8 of 8 slots. pop\(\) before the next push\(\)/)
            expect([made.head, made.tail]).toEqual([0, 8])

            // A label is checked when the film calls push(), full ring or not.
            expect(() => made.push({ label: 'submission' })).toThrow(/the label "submission" does not fit in a slot/)
            expect(() => made.push({ color: 'no such color' })).toThrow(/Unknown color/)

            // The inside name must fit inside the ring: its diagonal, across the inside, less one arrow head.
            // On this ring that is 2 * (140 - 1.75 - 7.8) - 16.12. The message gives a radius that has the room.
            const name = 'the tail of the producer and more'
            const ink = text(name, { size: 26 }).bounds()
            let message = ''
            try { ringBuffer(8, { radius: 200, thickness: 60, tail: name }) } catch (error) { message = (error as Error).message }
            const [, wide, room, radius] = /the name "the tail of the producer and more" is (\d+) px wide, and the inside of the ring has room for (\d+) px. Raise radius to (\d+), or put this pointer outside with outside: 'tail'/.exec(message)!.map(Number)
            expect(wide).toBe(Math.ceil(ink.width))
            expect(room).toBe(Math.floor(Math.sqrt((2 * (140 - 1.75 - 26 * 0.3) - 26 * 0.62) ** 2 - ink.height ** 2)))
            expect(ringBuffer(8, { radius: radius!, thickness: 60, tail: name }).tailPointer).not.toBeNull()
            expect(() => ringBuffer(8, { radius: radius! - 10, thickness: 60, tail: name })).toThrow(/has room for/)
            expect(() => ringBuffer(8, { head: name, outside: 'tail' })).toThrow(/put this pointer outside with outside: 'head'/)
            expect(ringBuffer(8, { tail: name, outside: 'tail' }).tailPointer).not.toBeNull()

            // 64 numbers do not fit around the default ring. They fit around a larger one.
            expect(() => ringBuffer(64, { numbers: true })).toThrow(/the numbers of 64 slots touch each other around a ring of radius 170. Raise radius/)
            expect(ringBuffer(64, { numbers: true, radius: 340 }).numbers).toHaveLength(64)
        }))
    })

    it('asks for the room of a count of two digits at the start, and checks a third digit when a pointer reaches it', async () => {
        await compileFilm(film((s) => {
            // Without counts the name fits. With counts it must fit with two digits, from the start.
            const options = { thickness: 30, tail: 'the writer' } as const
            const fails = (radius: number) => { try { ringBuffer(8, { ...options, radius, counts: true }); return false } catch { return true } }
            let tight = 100
            while (tight < 300 && fails(tight)) tight += 2
            expect(tight).toBeGreaterThan(104)
            expect(tight).toBeLessThan(300)
            expect(ringBuffer(8, { ...options, radius: tight - 2 }).tailPointer).not.toBeNull()
            expect(() => ringBuffer(8, { ...options, radius: tight - 2, counts: true })).toThrow(/the name "the writer 88" is \d+ px wide, and the inside of the ring has room for \d+ px. With counts, a name needs the room of a count of two digits, and "88" stands for it. Raise radius to \d+, or put this pointer outside/)
            // At the first radius with room for two digits, 99 pushes pass. The hundredth has no room.
            const made = s.add(ringBuffer(8, { ...options, radius: tight, counts: true }))
            for (let k = 0; k < 99; k++) s.play(seq(made.push(), made.pop()), { duration: 0 })
            expect(made.tail).toBe(99)
            const push = made.push()
            expect(() => s.play(push)).toThrow(/the name "the writer 100" is \d+ px wide, and the inside of the ring has room for \d+ px. Raise radius to \d+/)
        }))
    })

    it('gives a copy its own entries and pointers, at rest in the state of the ring', async () => {
        await compileFilm(film((s) => {
            const made = s.add(ringBuffer(8, { counts: true, label: 'submission queue', tailFollows: 'publish' }))
            s.play(seq(made.push({ label: 'A' }), made.push({ pending: true })), { duration: 0.5 })
            const copy = made.clone()
            expect(copy.entries[0]).not.toBe(made.entries[0])
            expect(copy.children).toContain(copy.entries[0])
            expect(copy.children).toContain(copy.tailPointer)
            expect(copy.children).toContain(copy.writeMarker)
            expect(copy.tailPointer).not.toBe(made.tailPointer)
            expect(copy.caption).not.toBe(made.caption)
            expect([copy.head, copy.tail, copy.length, copy.pending]).toEqual([0, 2, 2, 1])
            expect(copy.entries.map(shows)).toEqual([1, 1, 0, 0, 0, 0, 0, 0])
            // The tail of the copy is where the tail of the ring is: behind the pending entry. So is its mark of the writer.
            expect(nameOf(copy.tailPointer!)).toBe('tail 1')
            expect(xy(copy.tailPointer!)).toEqual(xy(made.tailPointer!))
            expect(xy(copy.writeMarker!)).toEqual(xy(made.writeMarker!))
            // A change of the copy is not a change of the ring: its count, its pending entry, its pointer, its name.
            s.play(copy.publish(), { duration: 0.5 })
            s.play(copy.push(), { duration: 0.5 })
            expect([copy.tail, made.tail, copy.pending, made.pending]).toEqual([3, 2, 0, 1])
            expect(shows(made.entries[2]!)).toBe(0)
            expect([nameOf(copy.tailPointer!), nameOf(made.tailPointer!)]).toEqual(['tail 3', 'tail 1'])
            expectAtSlot(copy, copy.tailPointer!, 3)
            expectAtSlot(made, made.tailPointer!, 1)
            expectAtSlot(made, made.writeMarker!, 2)
        }))
    })
})

describe('spotlight', () => {
    // The films here have the midnight look. These are its background and the blue of the boxes.
    const BACK = parseColor('#0b0c10'), BLUE = parseColor('#5cc4f0')
    const box = (x: number, y = 0) => rect(120, 120, { fill: 'blue', stroke: null }).at(x, y)
    const round = (value: number) => Math.round(value * 1e4) / 1e4
    const mark = (f: CompiledFilm, time: number, node: Node) => paths(f, time).find((op) => op.node === node)
    /** A color between the background and another color: the look of a paint at a `dim`. */
    const toward = (color: Rgba, dim: number, back: Rgba = BACK) => [0, 1, 2].map((i) => round(back[i]! + (color[i]! - back[i]!) * dim))
    const rgb = (color: unknown) => (color as Rgba).slice(0, 3).map(round)
    /**
     * How much of its own color the film draws each box with at a time: 1 is its blue, 0 is the color of the
     * background, and null is a box that the frame does not draw.
     */
    const lit = (f: CompiledFilm, time: number, ...nodes: Node[]) => nodes.map((node) => {
        const fill = mark(f, time, node)?.fill as Rgba | undefined
        return fill ? round((fill[0] - BACK[0]) / (BLUE[0] - BACK[0])) : null
    })
    /** The alpha that the film draws each box with, which a light must leave as it is. */
    const alphas = (f: CompiledFilm, time: number, ...nodes: Node[]) => nodes.map((node) => round(mark(f, time, node)?.fillAlpha ?? 0))
    const dims = (time: number, ...nodes: Node[]) => at(time, () => nodes.map((node) => node.get('dim')))

    it('dims a sibling and a node of another group, and keeps the target, what is in it, and its ancestors, before, in the middle and after', async () => {
        let ancestor!: Node, target!: Node, part!: Node, sibling!: Node, cousin!: Node, far!: Node, other!: Node
        const f = await compile((s) => {
            // The target and its ancestor draw a shape of their own, so that the frame shows what each one keeps.
            part = box(0)
            target = box(-300).add(part)
            sibling = box(-100)
            ancestor = box(-500).opacity(0.8).add(target, sibling)
            // One more level: the group of the ancestor is an ancestor too, and its other child dims.
            cousin = box(-500, 300)
            s.add(group(ancestor, cousin))
            other = box(400)
            far = s.add(group(other))
            s.wait(1)
            s.play(spotlight(target, { duration: 1, ease: linear }))
            s.wait(1)
        })
        const all = [ancestor, target, part, sibling, cousin, other] as const
        expect(lit(f, 0.5, ...all)).toEqual([1, 1, 1, 1, 1, 1])
        expect(lit(f, 1.5, ...all)).toEqual([1, 1, 1, 0.65, 0.65, 0.65])
        expect(lit(f, 2.5, ...all)).toEqual([1, 1, 1, 0.3, 0.3, 0.3])
        // The light wrote no opacity, and no alpha changed: each node has the opacity that the film gave it.
        for (const time of [0.5, 1.5, 2.5]) expect(alphas(f, time, ...all)).toEqual([0.8, 0.8, 0.8, 0.8, 1, 1])
        expect(at(2.5, () => [...all, far].map((node) => node.get('opacity')))).toEqual([0.8, 1, 1, 1, 1, 1, 1])
        // One `dim` on the other group dims what is in it.
        expect(dims(2.5, ancestor, target, part, sibling, cousin, far, other)).toEqual([1, 1, 1, 0.3, 0.3, 0.3, 1])
    })

    it('takes each paint of a dim node toward the background and leaves every alpha: a fill, a stroke, a glow, and each stop of a gradient', async () => {
        const YELLOW = parseColor('#ffd75e'), RED = parseColor('#ff6b6b'), CLEAR: Rgba = [255, 107, 107, 0.4]
        let solid!: Node, shaded!: Node
        const f = await compile((s) => {
            const lit = s.add(box(-500))
            solid = s.add(rect(120, 120, { fill: 'blue', stroke: 'yellow', width: 6 }).at(-200, 0).opacity(0.5).glow(12, 'red'))
            solid.set('fillOpacity', 0.8)
            shaded = s.add(rect(120, 120, { stroke: null }).at(100, 0).fill(linearGradient([-60, 0], [60, 0], ['blue', CLEAR])))
            s.play(spotlight(lit, { dim: 0.25, duration: 1 }))
        })
        const before = mark(f, 0, solid)!, after = mark(f, 1, solid)!
        expect([rgb(before.fill), rgb(before.stroke), rgb(before.glowColor)]).toEqual([rgb(BLUE), rgb(YELLOW), rgb(RED)])
        expect([rgb(after.fill), rgb(after.stroke), rgb(after.glowColor)]).toEqual([toward(BLUE, 0.25), toward(YELLOW, 0.25), toward(RED, 0.25)])
        // The opacity of the node, 0.5, times the opacity of its fill, 0.8. The light is not in it.
        expect([after.fillAlpha, after.strokeAlpha]).toEqual([before.fillAlpha, before.strokeAlpha])
        expect([after.fillAlpha, after.strokeAlpha]).toEqual([0.4, 0.5])
        const stops = (mark(f, 1, shaded)!.fill as unknown as { stops: [number, Rgba][] }).stops
        expect(stops.map(([, color]) => rgb(color))).toEqual([toward(BLUE, 0.25), toward(CLEAR, 0.25)])
        // A stop keeps its own alpha too.
        expect(stops.map(([, color]) => color[3])).toEqual([1, 0.4])
    })

    it('keeps a dim node opaque, so a dim label still hides the line behind it and the film check finds no line through a text', async () => {
        const report = await checkFilm(film({ fps: 20 }, (s) => {
            const node = (name: string, x: number) => s.add(group(rect(260, 140, { radius: 14, stroke: 'blue', width: 5 }), text(name, { size: 44 })).at(x, -150))
            const [client, server, cache] = [node('client', -600), node('server', 0), node('cache', 600)]
            // The label of a connector sits on its line, on a plate in the background color.
            s.add(connector(client, server, { label: 'request', labelSize: 30, color: 'ink', width: 4, route: 'straight' }))
            s.add(connector(server, cache, { label: 'lookup', labelSize: 30, color: 'yellow', width: 4, route: 'straight' }))
            s.wait(0.5)
            s.play(spotlight(cache))
            s.wait(1)
            s.play(spotlight(null))
            s.wait(0.5)
        }), { motion: true })
        expect(report.diagnostics).toEqual([])
    })

    it('goes toward the background of the film, which can be its own color, and toward the background of the look for a film with none', async () => {
        const backs: Record<string, Rgba> = {}
        let rest!: Node
        const build = (s: Stage) => {
            const target = s.add(box(-300))
            rest = s.add(box(0))
            s.play(spotlight(target, { dim: 0, duration: 0 }))
            s.wait(1)
        }
        // The token comes after a film in another look: it must be the `surface` of paper, not of the film before.
        for (const [name, options] of [['a color', { background: '#804020' }], ['none', { background: null }], ['a token', { look: 'paper', background: 'surface' }], ['paper', { look: 'paper' }]] as const) {
            const f = await compile(build, options)
            backs[name] = mark(f, 0.5, rest)!.fill as Rgba
            // At a dim of 0 the node has the color of the background, and it is still drawn, with its alpha.
            expect(mark(f, 0.5, rest)!.fillAlpha, name).toBe(1)
        }
        // A background that the compile call gives, as `--background` of the command line does.
        const given = await compileFilm(film(build), { background: '#203040' })
        expect(rgb(mark(given, 0.5, rest)!.fill)).toEqual([32, 48, 64])
        expect(rgb(backs['a color'])).toEqual([128, 64, 32])
        expect(rgb(backs['none'])).toEqual(rgb(BACK))
        expect(rgb(backs['a token'])).toEqual(rgb(parseColor('#efe9db')))
        expect(rgb(backs['paper'])).toEqual(rgb(parseColor('#f7f3ea')))
    })

    it('takes the rest to the dim that the film names, lights a list of targets, and is less dim by default on a light look', async () => {
        let a!: Node, b!: Node, c!: Node
        const f = await compile((s) => {
            ;[a, b, c] = [s.add(box(-300)), s.add(box(0)), s.add(box(300))]
            s.play(spotlight([a, c], { dim: 0.25, duration: 1 }))
            s.wait(1)
            // A duration of 0 changes the light at once.
            s.play(spotlight(b, { dim: 0, duration: 0 }))
            s.wait(1)
        })
        expect(lit(f, 1.999, a, b, c)).toEqual([1, 0.25, 1])
        expect(lit(f, 2, a, b, c)).toEqual([0, 1, 0])
        // With no duration, the light takes half a second.
        expect(spotlight(a).duration).toBe(0.5)
        // The default leaves ink text at a contrast of about 2.4 on the dark looks, and 0.4 does the same on paper.
        for (const [look, dim] of [['midnight', 0.3], ['blueprint', 0.3], ['paper', 0.4]] as const) {
            let rest!: Node
            await compile((s) => {
                const target = s.add(box(-300))
                rest = s.add(box(0))
                s.play(spotlight(target, { duration: 1 }))
            }, { look })
            expect(dims(1, rest), look).toEqual([dim])
        }
    })

    it('follows the ease that the film gives', async () => {
        let rest!: Node
        const f = await compile((s) => {
            const target = s.add(box(-300))
            rest = s.add(box(0))
            s.play(spotlight(target, { duration: 1, ease: (t) => t * t }))
        })
        // At half of the time, this ease is at a quarter of the way from 1 to 0.3.
        expect(lit(f, 0.5, rest)).toEqual([0.825])
    })

    it('dims only inside `within`, leaves the light of another node as it is, and turns the light off there alone', async () => {
        let left!: Node[], right!: Node[], leftChart!: Node, rightChart!: Node, alone!: Node
        const f = await compile((s) => {
            left = [box(-500), box(-350), box(-200)]
            right = [box(200), box(350)]
            leftChart = s.add(group(...left))
            rightChart = s.add(group(...right))
            alone = s.add(box(0, 300))
            s.play(spotlight(left[1]!, { within: leftChart, duration: 1 }))
            // A second light, in the other chart, with its own dim. The first one stays as it is.
            s.play(spotlight(right[0]!, { within: rightChart, dim: 0.5, duration: 1 }))
            s.play(spotlight(null, { within: leftChart, duration: 1 }))
            // A light on the whole stage takes the place of every light. Then the light of the right chart off: the chart itself is still dim.
            s.play(spotlight(alone, { duration: 1 }))
            s.play(spotlight(null, { within: rightChart, duration: 1 }))
            s.play(spotlight(null, { duration: 1 }))
        })
        const all = (time: number) => lit(f, time, ...left, ...right, alone)
        expect(all(1)).toEqual([0.3, 1, 0.3, 1, 1, 1])
        expect(all(2)).toEqual([0.3, 1, 0.3, 1, 0.5, 1])
        expect(all(3)).toEqual([1, 1, 1, 1, 0.5, 1])
        expect(all(4)).toEqual([0.3, 0.3, 0.3, 0.3, 0.3, 1])
        expect(dims(5, ...right, rightChart)).toEqual([1, 1, 0.3])
        expect(all(5)).toEqual([0.3, 0.3, 0.3, 0.3, 0.3, 1])
        expect(all(6)).toEqual([1, 1, 1, 1, 1, 1])
    })

    it('lets a light in a node decide there again, after a light of the whole stage dimmed parts of that node', async () => {
        let bars!: Node[], other!: Node
        const f = await compile((s) => {
            bars = [box(-450), box(-300), box(-150)]
            const chart = s.add(group(...bars))
            other = s.add(box(300))
            // The light of the stage is on one bar, so the chart holds it and does not dim as a whole.
            s.play(spotlight(bars[0]!, { duration: 1 }))
            s.play(spotlight(bars[2]!, { within: chart, duration: 1 }))
        })
        expect(lit(f, 1, ...bars, other)).toEqual([1, 0.3, 0.3, 0.3])
        // Inside the chart the later light decides. Outside it, the light of the stage still does.
        expect(lit(f, 2, ...bars, other)).toEqual([0.3, 0.3, 1, 0.3])
    })

    it('keeps the nodes in `keep` and the pinned nodes bright, with what is in them, and dims what is beside them', async () => {
        let target!: Node, rest!: Node, heading!: Node, source!: Node, pinned!: Node, inPinned!: Node, deepPinned!: Node, beside!: Node, kept!: Node, notKept!: Node
        const f = await compile((s) => {
            target = s.add(box(-300))
            rest = s.add(box(0))
            heading = s.add(box(0, -300))
            source = box(0, 300)
            const footer = s.add(group(source))
            inPinned = box(0)
            pinned = s.add(box(600, -300).add(inPinned).pin())
            // A pinned node in a group: the group cannot dim as a whole, and its other child dims.
            deepPinned = box(600, 300).pin()
            beside = box(450, 300)
            s.add(group(deepPinned, beside))
            // The same for a node in `keep` that is one child of a group.
            kept = box(-600, 300)
            notKept = box(-450, 300)
            s.add(group(kept, notKept))
            s.play(spotlight(target, { keep: [heading, footer, kept], duration: 1 }))
            // `keep` belongs to one call. The next call names one node, with no list, and the others dim.
            s.play(spotlight(target, { keep: heading, duration: 1 }))
        })
        expect(lit(f, 1, target, rest, heading, source, pinned, inPinned, deepPinned, beside, kept, notKept)).toEqual([1, 0.3, 1, 1, 1, 1, 1, 0.3, 1, 0.3])
        expect(lit(f, 2, target, rest, heading, source, pinned, deepPinned, kept)).toEqual([1, 0.3, 1, 0.3, 1, 1, 0.3])
    })

    it('lights the name and the readout of a bar with the bar, also in a copy of the chart', async () => {
        const make = () => barChart([{ label: 'parse', value: 3 }, { label: 'plan', value: 7 }, { label: 'run', value: 12 }], { width: 400, height: 240 })
        let chart!: ReturnType<typeof make>, copy!: ReturnType<typeof make>
        await compile((s) => {
            chart = s.add(make().at(-400, 0))
            copy = s.add(chart.clone().at(400, 0))
            s.play(spotlight([chart.bar(1), copy.bar(2)], { duration: 1 }))
        })
        for (const [made, index] of [[chart, 1], [copy, 2]] as const) {
            const shown = (nodes: readonly Node[]) => dims(1, ...nodes).map((dim) => dim === 1)
            expect(shown(made.bars)).toEqual([0, 1, 2].map((i) => i === index))
            expect(shown(made.labels)).toEqual([0, 1, 2].map((i) => i === index))
            expect(shown(made.readouts)).toEqual([0, 1, 2].map((i) => i === index))
            // The base line belongs to no bar, and the chart holds the bar.
            expect(dims(1, made.baseline, made)).toEqual([0.3, 1])
        }
    })

    it('moves the light from one target to another, and gives every node its first look when the light goes off', async () => {
        let items!: Node[]
        const first = [1, 0.9, 0.6, 1]
        const f = await compile((s) => {
            items = first.map((opacity, index) => s.add(box(-450 + index * 300).opacity(opacity)))
            s.wait(1)
            s.play(spotlight(items[0]!, { duration: 1, ease: linear }))
            s.play(spotlight(items[1]!, { duration: 1, ease: linear }))
            s.play(spotlight(items[2]!, { duration: 1, ease: linear }))
            s.play(spotlight(null, { duration: 1, ease: linear }))
            s.wait(1)
        })
        expect(lit(f, 0.5, ...items)).toEqual([1, 1, 1, 1])
        expect(lit(f, 2, ...items)).toEqual([1, 0.3, 0.3, 0.3])
        // In the middle of the move, the old target is on its way down and the new one on its way up.
        expect(lit(f, 2.5, ...items)).toEqual([0.65, 0.65, 0.3, 0.3])
        expect(lit(f, 3, ...items)).toEqual([0.3, 1, 0.3, 0.3])
        expect(lit(f, 4, ...items)).toEqual([0.3, 0.3, 1, 0.3])
        expect(lit(f, 4.5, ...items)).toEqual([0.65, 0.65, 1, 0.65])
        expect(lit(f, 5.5, ...items)).toEqual([1, 1, 1, 1])
        expect(dims(5.5, ...items)).toEqual([1, 1, 1, 1])
        for (const time of [0.5, 2.5, 4, 5.5]) expect(alphas(f, time, ...items)).toEqual(first)
    })

    it('keeps a dim node exactly as dim as it is while the light moves between a group and one of its parts', async () => {
        let parts!: Node[], solo!: Node, whole!: Node
        const f = await compile((s) => {
            parts = [box(-450), box(-300), box(-150)]
            whole = s.add(group(...parts))
            solo = s.add(box(300))
            // The first light dims two parts of the group, each by itself.
            s.play(spotlight(parts[0]!, { duration: 1 }))
            // The light leaves the group, which dims as a whole. Its two dim parts must not get dimmer.
            s.play(spotlight(solo, { duration: 1 }))
            // The light comes back to another part, and the group comes back. The parts that stay dim must not get brighter.
            s.play(spotlight(parts[1]!, { duration: 1 }))
            // A light with another dim takes the rest there in one direction.
            s.play(spotlight(solo, { dim: 0.5, duration: 1, ease: linear }))
            // The light on the whole group brings back the parts that were dim by themselves.
            s.play(spotlight(whole, { duration: 1 }))
        })
        const during = [0.1, 0.25, 0.5, 0.75, 0.9]
        for (const part of during) {
            expect(lit(f, 1 + part, parts[1]!, parts[2]!), `the group dims, at ${part}`).toEqual([0.3, 0.3])
            expect(lit(f, 2 + part, parts[0]!, parts[2]!), `the group comes back, at ${part}`).toEqual([0.3, 0.3])
            expect(lit(f, 3 + part, parts[0]!, parts[2]!), `the dim changes, at ${part}`).toEqual([round(0.3 + 0.2 * part), round(0.3 + 0.2 * part)])
        }
        expect(lit(f, 2, ...parts, solo)).toEqual([0.3, 0.3, 0.3, 1])
        expect(lit(f, 3, ...parts, solo)).toEqual([0.3, 1, 0.3, 0.3])
        expect(lit(f, 4, ...parts, solo)).toEqual([0.5, 0.5, 0.5, 1])
        expect(lit(f, 5, ...parts, solo)).toEqual([1, 1, 1, 0.3])
    })

    it('leaves the opacity of a node to the film: a fade under the light is still there when the light goes off', async () => {
        let target!: Node, dimmed!: Node, gone!: Node
        const f = await compile((s) => {
            ;[target, dimmed, gone] = [s.add(box(-300)), s.add(box(0)), s.add(box(300))]
            s.play(spotlight(target, { duration: 1 }))
            s.play(fade(target, 0.8), fade(dimmed, 0.5), fadeOut(gone), { duration: 1 })
            // A dim node that the film takes away and brings back under the same light is still dim.
            s.play(fadeIn(gone), { duration: 1 })
            s.play(spotlight(null, { duration: 1 }))
        })
        expect(alphas(f, 2, target, dimmed, gone)).toEqual([0.8, 0.5, 0])
        expect(lit(f, 2, target, dimmed)).toEqual([1, 0.3])
        expect([alphas(f, 3, target, dimmed, gone), lit(f, 3, target, dimmed, gone)]).toEqual([[0.8, 0.5, 1], [1, 0.3, 0.3]])
        expect([alphas(f, 4, target, dimmed, gone), lit(f, 4, target, dimmed, gone)]).toEqual([[0.8, 0.5, 1], [1, 1, 1]])
    })

    it('does not dim a node that comes to the stage while the light is on, and dims it when the light moves', async () => {
        let target!: Node, added!: Node, faded!: Node, hidden!: Node, clear!: Node, group_!: Node, joined!: Node
        const f = await compile((s) => {
            target = s.add(box(-600))
            group_ = s.add(group(box(-450)))
            // These two are on the stage, and nobody can see them when the light starts.
            hidden = s.add(box(-150).hide())
            clear = s.add(box(0).opacity(0))
            s.play(spotlight(target, { duration: 1 }))
            added = s.add(box(150))
            faded = box(300)
            hidden.show()
            // A node that joins a dim group is dim with its group.
            joined = box(-450, 200)
            group_.add(joined)
            s.play(fadeIn(faded), fade(clear, 1), { duration: 1 })
            s.play(spotlight(added, { duration: 1 }))
            s.play(spotlight(null, { duration: 1 }))
        })
        expect(lit(f, 2, target, added, faded, hidden, clear, joined)).toEqual([1, 1, 1, 1, 1, 0.3])
        expect(lit(f, 3, target, added, faded, hidden, clear, joined)).toEqual([0.3, 1, 0.3, 0.3, 0.3, 0.3])
        expect(lit(f, 4, target, added, faded, hidden, clear, joined)).toEqual([1, 1, 1, 1, 1, 1])
    })

    it('does not dim a node whose group is hidden, or at opacity 0, when the light starts', async () => {
        for (const how of ['hidden', 'clear'] as const) {
            let target!: Node, inner!: Node, tucked!: Node
            const f = await compile((s) => {
                target = s.add(box(-300))
                inner = box(0)
                tucked = box(150)
                // The group holds a node in `keep`, so the light looks at its children one by one. Nobody can see them yet.
                const holder = s.add(group(inner, tucked))
                if (how === 'hidden') holder.hide()
                else holder.opacity(0)
                s.play(spotlight(target, { keep: [inner], duration: 1 }))
                if (how === 'hidden') holder.show()
                else holder.opacity(1)
                s.wait(1)
            })
            expect(lit(f, 1.5, target, inner, tucked), how).toEqual([1, 1, 1])
        }
    })

    it('forgets a node that is hidden when the light moves: it comes back with its own look', async () => {
        let a!: Node, b!: Node, c!: Node
        const f = await compile((s) => {
            ;[a, b, c] = [s.add(box(-300)), s.add(box(0)), s.add(box(300))]
            s.play(spotlight(a, { duration: 1 }))
            // b is dim, and the film hides it. The next light starts with b away, so it does not act on b.
            b.hide()
            s.play(spotlight(c, { duration: 1 }))
            b.show()
            s.wait(1)
            // The same after the light goes off: a was dim, and it is hidden when the next light starts.
            s.play(spotlight(null, { duration: 1 }))
            a.hide()
            s.play(spotlight(c, { duration: 1 }))
            a.show()
            s.wait(1)
        })
        expect(lit(f, 2.5, a, b, c)).toEqual([0.3, 1, 1])
        expect(lit(f, 5.5, a, b, c)).toEqual([1, 0.3, 1])
    })

    describe('a node that enters at the very time that a light starts arrives with its own look', () => {
        const entrances: Record<string, (node: Node, from: Node) => Anim> = {
            fadeIn: (node) => fadeIn(node), write: (node) => write(node), draw: (node) => draw(node), grow: (node) => grow(node),
            appear: (node) => appear(node), morph: (node, from) => morph(from, node),
        }
        const cases = Object.keys(entrances).flatMap((verb) => [0, 2].map((start) => [verb, start] as const))

        it.each(cases)('%s at %d s, whichever of the two the film names first', async (verb, start) => {
            const pictures: string[][] = []
            for (const lightFirst of [true, false]) {
                let target!: Node, rest!: Node, entering!: Node
                const f = await compile((s) => {
                    ;[target, rest] = [s.add(box(-300)), s.add(box(0))]
                    // A morph starts from a node that is there. The light is on it too, so it is not a part of the rest.
                    const from = s.add(box(300, 300))
                    entering = box(300)
                    s.wait(start)
                    const anims = [spotlight([target, from], { duration: 1 }), { ...entrances[verb]!(entering, from), duration: 1 }]
                    s.play(...(lightFirst ? anims : anims.reverse()))
                    s.wait(1)
                })
                expect(lit(f, start + 1.5, target, rest, entering), lightFirst ? 'the light first' : 'the light last').toEqual([1, 0.3, 1])
                expect(dims(start + 1.5, entering)).toEqual([1])
                pictures.push([0, 0.3, 0.6, 1, 1.5].map((time) => svgAt(f, start + time)))
            }
            // The two orders give one film, frame for frame.
            expect(pictures[1]).toEqual(pictures[0])
        })

        it('the same for the other children of a group that a verb brings with a light on one child, at 0 s and later', async () => {
            for (const start of [0, 2]) {
                let rest!: Node, child!: Node, sibling!: Node
                const f = await compile((s) => {
                    rest = s.add(box(-300))
                    s.wait(start)
                    ;[child, sibling] = [box(0), box(300)]
                    s.play(appear(group(child, sibling)), spotlight(child, { duration: 1 }))
                })
                expect(lit(f, start + 1, rest, child, sibling), `at ${start} s`).toEqual([0.3, 1, 1])
            }
        })

        it('the same for a node that the film adds at that time, and not for the nodes that the film starts with', async () => {
            let target!: Node, early!: Node, late!: Node
            const f = await compile((s) => {
                ;[target, early] = [s.add(box(-300)), s.add(box(0))]
                s.play(spotlight(target, { duration: 1 }))
                s.wait(1)
                // The light is off, and the next one starts at the time of this `s.add`.
                s.play(spotlight(null, { duration: 0 }))
                s.wait(1)
                late = s.add(box(300))
                s.play(spotlight(target, { duration: 1 }))
            })
            // At time 0 there is no time before: the nodes that the film starts with are there.
            expect(lit(f, 1, target, early)).toEqual([1, 0.3])
            expect(lit(f, 4, target, early, late)).toEqual([1, 0.3, 1])
        })
    })

    describe('follows the time of the film, not the order of its code', () => {
        it('gives one film for lights that the code names in any order', async () => {
            const cues: [number, (nodes: Node[]) => Anim][] = [
                [0, (nodes) => spotlight(nodes[0]!, { duration: 0.5 })],
                [2, (nodes) => spotlight(nodes[1]!, { duration: 0.5 })],
                [3, (nodes) => spotlight([nodes[1]!, nodes[2]!], { dim: 0.5, duration: 0.5 })],
                [5.5, () => spotlight(null, { duration: 0.5 })],
            ]
            const times = [0.25, 1, 2.25, 2.75, 3.25, 4, 5.75, 6.5]
            const make = async (order: number[]) => {
                let nodes!: Node[]
                const f = await compile((s) => {
                    nodes = [s.add(box(-300)), s.add(box(0)), s.add(box(300))]
                    for (const index of order) s.at(cues[index]![0], () => s.play(cues[index]![1](nodes)))
                    s.wait(7)
                })
                return times.map((time) => lit(f, time, ...nodes))
            }
            const inOrder = await make([0, 1, 2, 3])
            expect(inOrder[1]).toEqual([1, 0.3, 0.3])
            expect(inOrder[3]).toEqual([0.3, 1, 0.3])
            expect(inOrder[5]).toEqual([0.5, 1, 1])
            expect(inOrder[7]).toEqual([1, 1, 1])
            for (const order of [[3, 2, 1, 0], [0, 3, 1, 2], [2, 0, 3, 1]]) expect(await make(order), `the cues in the order ${order.join(' ')}`).toEqual(inOrder)
        })

        it('dims a node that is on the stage before the light, when the code brings it after the light', async () => {
            let a!: Node, b!: Node, c!: Node, d!: Node
            const f = await compile((s) => {
                ;[a, b] = [s.add(box(-450)), s.add(box(-150))]
                s.at(3, () => s.play(spotlight(a, { duration: 0.5 })))
                // The code names these after the light. On the timeline, c enters before the light and d after it.
                c = box(150)
                s.at(1, () => s.play(fadeIn(c, { duration: 0.5 })))
                d = box(450)
                s.at(4, () => s.play(fadeIn(d, { duration: 0.5 })))
                s.wait(5)
            })
            expect(lit(f, 2, a, b, c)).toEqual([1, 1, 1])
            expect(lit(f, 5, a, b, c, d)).toEqual([1, 0.3, 0.3, 1])
        })

        it('takes two times that differ in the last digit as one time: 0.1 + 0.2 and 0.3', async () => {
            const a = 0.1 + 0.2, b = 0.3
            expect(a).not.toBe(b)
            for (const [enters, light] of [[a, b], [b, a]] as const) {
                // A target that enters at the time of its light, and a node that enters then and is not a target.
                let rest!: Node, target!: Node, other!: Node
                const f = await compile((s) => {
                    rest = s.add(box(-300))
                    target = box(0)
                    other = box(300)
                    s.at(enters, () => s.play(fadeIn(target, { duration: 0.2 }), fadeIn(other, { duration: 0.2 })))
                    s.at(light, () => s.play(spotlight(target, { duration: 0.2 })))
                    s.wait(2)
                })
                expect(lit(f, 1.5, rest, target, other), `the node enters at ${enters}, and the light starts at ${light}`).toEqual([0.3, 1, 1])
            }
            // Two lights of the stage at these two times are two lights at one time.
            const twice = compile((s) => {
                const nodes = [s.add(box(-300)), s.add(box(0))]
                s.at(a, () => s.play(spotlight(nodes[0]!)))
                s.at(b, () => s.play(spotlight(nodes[1]!)))
                s.wait(2)
            })
            await expect(twice).rejects.toThrow(/two lights start at 0.3 s on the stage/)
            // A light of the stage and a light in a node, at these two times, in the two orders: the one of the stage is first.
            for (const [stage, inner] of [[a, b], [b, a]] as const) {
                let parts!: Node[], other!: Node
                const f = await compile((s) => {
                    parts = [box(-300), box(0)]
                    const holder = s.add(group(...parts))
                    other = s.add(box(300))
                    s.at(inner, () => s.play(spotlight(parts[1]!, { within: holder, dim: 0.5, duration: 0.2 })))
                    s.at(stage, () => s.play(spotlight(holder, { duration: 0.2 })))
                    s.wait(2)
                })
                expect(lit(f, 1.5, ...parts, other), `the light of the stage at ${stage}`).toEqual([0.5, 1, 0.3])
            }
        })

        it('refuses two lights that start at one time in one place, because they have no order', async () => {
            const twice = (within: boolean) => compile((s) => {
                const parts = [box(-300), box(0)]
                const holder = s.add(group(...parts))
                const options = within ? { within: holder } : {}
                s.wait(2)
                s.play(spotlight(parts[0]!, options), spotlight(parts[1]!, options))
            })
            await expect(twice(false)).rejects.toThrow(/two lights start at 2 s on the stage, and only one can decide what is dim. Give one light all the targets, or start one of them later/)
            await expect(twice(true)).rejects.toThrow(/two lights start at 2 s in the same node/)
            // A light of the stage and a light in a node can start together: the one of the stage is first.
            let parts!: Node[], other!: Node
            const f = await compile((s) => {
                parts = [box(-300), box(0)]
                const holder = s.add(group(...parts))
                other = s.add(box(300))
                s.play(spotlight(parts[1]!, { within: holder, dim: 0.5, duration: 1 }), spotlight(holder, { duration: 1 }))
            })
            expect(lit(f, 1, ...parts, other)).toEqual([0.5, 1, 0.3])
        })
    })

    it('chains two spotlights in one seq, and runs in a par with a fade of its target', async () => {
        let a!: Node, b!: Node, c!: Node
        const f = await compile((s) => {
            ;[a, b, c] = [s.add(box(-300)), s.add(box(0)), s.add(box(300))]
            s.play(seq(spotlight(a), spotlight(b)), { duration: 2, ease: linear })
            s.play(par(spotlight(c, { duration: 1 }), fade(c, 0.6, { duration: 1 })), { ease: linear })
        })
        // The second light starts from what the first one left.
        expect(lit(f, 1, a, b, c)).toEqual([1, 0.3, 0.3])
        expect(lit(f, 1.5, a, b, c)).toEqual([0.65, 0.65, 0.3])
        expect(lit(f, 2, a, b, c)).toEqual([0.3, 1, 0.3])
        // The light and the fade write two values of the target, so both arrive.
        expect([lit(f, 2.5, a, b, c), alphas(f, 2.5, c)]).toEqual([[0.3, 0.65, 0.65], [0.8]])
        expect([lit(f, 3, a, b, c), alphas(f, 3, c)]).toEqual([[0.3, 0.3, 1], [0.6]])
    })

    it('gives a copy of a dim node its own look, with the light on and after it, also for a dim node in the copy', async () => {
        let target!: Node, dimmed!: Node, copy!: Node, held!: Node, heldCopy!: Node, twinPart!: Node
        const f = await compile((s) => {
            target = box(-450)
            const part = box(-450, 200)
            // The family holds the target, so the light dims its other child by itself.
            const family = s.add(group(target, part))
            dimmed = s.add(box(-150).opacity(0.9))
            held = box(150)
            const holder = s.add(group(held))
            s.play(spotlight(target, { duration: 1 }))
            copy = s.add(dimmed.clone().at(-150, 300))
            heldCopy = s.add(holder.clone().shift(0, 300)).children[0]!
            // In this copy the dim node is below the top.
            twinPart = s.add(family.clone().shift(900, 0)).children[1]!
            s.wait(1)
            s.play(spotlight(null, { duration: 1 }))
        })
        expect(lit(f, 2, dimmed, copy, held, heldCopy, twinPart)).toEqual([0.3, 1, 0.3, 1, 1])
        expect(alphas(f, 2, dimmed, copy)).toEqual([0.9, 0.9])
        expect(lit(f, 3, dimmed, copy, held, heldCopy, twinPart)).toEqual([1, 1, 1, 1, 1])
    })

    it('draws with the least dim of a branch, for a shape, a drawing that is rebuilt, a picture, and the marks that a node makes itself', async () => {
        const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP4z8DwH4YZkDkAm34L9XKwuTwAAAAASUVORK5CYII='
        let twice!: Node, under!: Node, built!: Node, own!: Node
        const f = await compile((s) => {
            // Opacities multiply, and dims do not: the least of 0.4 and 0.6, and the least of 0.9 and 0.6.
            twice = box(-450).set('dim', 0.4)
            under = box(-300).set('dim', 0.9)
            s.add(group(twice, under).opacity(0.5).set('dim', 0.6))
            built = box(0)
            const drawing = s.add(dynamic(() => built).set('dim', 0.5))
            s.add(image(PNG, { width: 60 }).at(300, 0).opacity(0.8).set('dim', 0.25))
            own = s.add(group().set('dim', 0.5))
            own.rawOps = (_matrix, alpha, ops) => {
                ops.push({ kind: 'path', path: circlePath(0, 0, 10), strokePath: [], fill: BLUE, fillAlpha: alpha, stroke: null, strokeAlpha: 0, strokeWidth: 0,
                    cap: 'round', join: 'round', dash: null, dashOffset: 0, glow: 0, glowColor: null, blend: 'normal', node: own })
            }
            s.wait(1)
            // `dim` is a number, so a change of it passes through the values between.
            s.play(to(drawing, (node) => node.set('dim', 1)), { duration: 1, ease: linear })
        })
        expect(lit(f, 0.5, twice, under, built, own)).toEqual([0.4, 0.6, 0.5, 0.5])
        expect(alphas(f, 0.5, twice, under, built, own)).toEqual([0.5, 0.5, 1, 1])
        expect(lit(f, 1.5, built)).toEqual([0.75])
        // A picture keeps its alpha, and the draw list has no mark over it: the painter mixes its pixels.
        const ops = f.frame(0.5).ops, pictures = ops.filter((op) => op.kind === 'image')
        expect(pictures.map((op) => [op.alpha, op.dim, rgb(op.backdrop)])).toEqual([[0.8, 0.25, rgb(BACK)]])
        expect(ops.filter((op) => op.kind === 'path' && op.node === pictures[0]!.node)).toEqual([])
    })

    it('paints the same colors and alphas on the canvas as in the SVG, for a dim shape and a dim picture', async () => {
        const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP4z8DwH4YZkDkAm34L9XKwuTwAAAAASUVORK5CYII='
        const f = await compile((s) => {
            const target = s.add(box(-300))
            s.add(rect(120, 120, { fill: 'blue', stroke: 'yellow', width: 6 }).opacity(0.5))
            s.add(image(PNG, { width: 60 }).at(300, 0).opacity(0.8))
            s.play(spotlight(target, { duration: 0 }))
            s.wait(1)
        })
        const frame = f.frame(0.5)
        // A context that keeps the color and the alpha of each mark that a painter draws.
        const recorder = (painted: string[]) => {
            const state: Record<string, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' }
            const record = (kind: string, color: () => unknown) => () => { painted.push(`${kind} ${String(color())} ${round(state['globalAlpha'] as number)} ${String(state['globalCompositeOperation'] ?? '')}`.trim()) }
            const calls: Record<string, () => void> = {
                fill: record('fill', () => state['fillStyle']), stroke: record('stroke', () => state['strokeStyle']),
                drawImage: record('image', () => ''), fillRect: record('rect', () => state['fillStyle']),
            }
            return new Proxy(state, { get: (target, name: string) => calls[name] ?? (name in target ? target[name] : () => undefined) })
        }
        const painted: string[] = [], copy: string[] = []
        const scope = globalThis as { Path2D?: unknown; OffscreenCanvas?: unknown }, saved = [scope.Path2D, scope.OffscreenCanvas]
        scope.Path2D = class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} }
        scope.OffscreenCanvas = class { getContext() { return recorder(copy) } }
        try {
            paintFrame(recorder(painted) as never, frame, 1, () => ({}) as never)
        } finally {
            ;[scope.Path2D, scope.OffscreenCanvas] = saved
        }
        // The same marks from the SVG text, in order. The first `rect` of the canvas is its background.
        const svg = frameToSvg(frame)
        const drawn = [...svg.matchAll(/<(path|g)\b[^>]*>/g)].flatMap(([tag, kind]) => {
            if (kind === 'g') return [`image  ${tag!.match(/ opacity="([^"]*)"/)?.[1] ?? 1} source-over`]
            const part = (name: string) => {
                const color = tag!.match(new RegExp(` ${name}="(rgb[^"]*)"`))?.[1]
                return color ? [`${name} ${color} ${tag!.match(new RegExp(` ${name}-opacity="([^"]*)"`))?.[1] ?? 1} source-over`] : []
            }
            return [...part('fill'), ...part('stroke')]
        })
        expect(painted.slice(1)).toEqual(drawn)
        // The lit box, the dim box with its fill and its stroke, and the picture.
        expect(painted.slice(1)).toHaveLength(4)
        expect(painted[2]).toBe(`fill rgb(${toward(BLUE, 0.3).map(Math.round).join(',')}) 0.5 source-over`)
        // The picture dims by its own pixels, with one rule in both painters: each color is 0.3 of the pixel and 0.7 of
        // the background, and the alpha of the pixel stays. The canvas paints the background over a copy, where the copy has ink.
        expect(copy).toEqual(['image  1 source-over', `rect rgb(${rgb(BACK).join(',')}) 0.7 source-atop`])
        const matrix = svg.match(/<filter id="d0" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="([^"]*)"\/>/)![1]!.split(' ').map(Number)
        const offsets = rgb(BACK).map((channel) => round(0.7 * channel / 255))
        expect(matrix.map(round)).toEqual([0.3, 0, 0, 0, offsets[0], 0, 0.3, 0, 0, offsets[1], 0, 0, 0.3, 0, offsets[2], 0, 0, 0, 1, 0])
        expect(svg).toMatch(/<g transform="[^"]*" opacity="0.8" filter="url\(#d0\)">/)
    })

    it('makes the dim copy of a picture once for the frames of a still light, and again when the dim changes', async () => {
        const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP4z8DwH4YZkDkAm34L9XKwuTwAAAAASUVORK5CYII='
        const f = await compile((s) => {
            const target = s.add(box(-300))
            s.add(image(PNG, { width: 60 }).at(300, 0))
            s.play(spotlight(target, { duration: 1, ease: linear }))
            s.wait(1)
        })
        const pen = new Proxy({} as Record<string, unknown>, { get: (target, name: string) => (name in target ? target[name] : () => undefined) })
        const scope = globalThis as { Path2D?: unknown; OffscreenCanvas?: unknown }, saved = [scope.Path2D, scope.OffscreenCanvas]
        let copies = 0
        scope.Path2D = class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} }
        scope.OffscreenCanvas = class { constructor() { copies++ } getContext() { return pen } }
        try {
            // One source for every frame, as the player has: the copy belongs to it.
            const source = {} as never
            for (const time of [1.2, 1.5, 1.8]) paintFrame(pen as never, f.frame(time), 1, () => source)
            expect(copies).toBe(1)
            // While the light changes, each frame has another dim.
            for (const time of [0.25, 0.5]) paintFrame(pen as never, f.frame(time), 1, () => source)
            expect(copies).toBe(3)
        } finally {
            ;[scope.Path2D, scope.OffscreenCanvas] = saved
        }
    })

    it('keeps the clear parts of a dim picture clear: the card behind it shows there with its own color', async () => {
        // Four pixels in a row: two of opaque red, and two that are clear.
        const data = encode({ width: 4, height: 1, depth: 8, channels: 4, data: new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]) })
        const png = 'data:image/png;base64,' + Buffer.from(data).toString('base64')
        const f = await compile((s) => {
            // The card is green and is a target, so it stays as it is behind the dim picture.
            const cardBehind = s.add(rect(64, 64, { fill: '#00ff00', stroke: null }))
            s.add(image(png, { width: 64, height: 64 }))
            s.play(spotlight(cardBehind, { dim: 0.25, duration: 0 }))
            s.wait(1)
        }, { width: 64, height: 64, background: '#000000', bloom: 0 })
        const pixels = new Resvg(f.svg(0.5), { font: { loadSystemFonts: false } }).render().pixels
        const pixel = (x: number, y: number) => Array.from(pixels.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 3))
        // Left, the red ink at a quarter of its color, toward the black background. Right, the green card and no box.
        const [red, green, blue] = pixel(16, 32)
        expect([Math.round(red! / 255 * 100) / 100, green, blue]).toEqual([0.25, 0, 0])
        expect(pixel(48, 32)).toEqual([0, 255, 0])
    })

    describe('a morph', () => {
        const shapes = (f: CompiledFilm, time: number, known: Node[]) => paths(f, time).filter((op) => !known.includes(op.node!)).map((op) => round(((op.fill as Rgba)[0] - BACK[0]) / (BLUE[0] - BACK[0])))

        it('keeps its own look from its source to its result, with no jump, when the light is on its source', async () => {
            let other!: Node, source!: Node, result!: Node
            const f = await compile((s) => {
                ;[other, source] = [s.add(box(-300)), s.add(box(0))]
                result = box(300)
                s.play(spotlight(source, { duration: 0.5 }))
                s.wait(0.5)
                s.play(morph(source, result), { duration: 1, ease: linear })
                s.wait(0.5)
                // The light goes off while the next morph is under way. Nothing in the morph is dim, so nothing jumps.
                s.play(morph(result, box(300, 300)), spotlight(null), { duration: 1, ease: linear })
            })
            expect(lit(f, 0.9, other, source)).toEqual([0.3, 1])
            // The shape that travels, at the start, in the middle and at the end, and the result after it.
            for (const time of [1, 1.001, 1.5, 1.999]) expect(shapes(f, time, [other, source, result]), `at ${time}`).toEqual([1])
            expect(lit(f, 2.2, other, result)).toEqual([0.3, 1])
            for (const time of [2.5, 2.501, 3, 3.499, 3.5]) expect(shapes(f, time, [other, source, result]), `at ${time}`).toEqual([1])
        })

        it('is refused when a light dims its source, also when the code names the light after the morph', async () => {
            const dimSource = (order: 'time' | 'code') => compile((s) => {
                const lit_ = s.add(box(-300)), source = s.add(box(0)), result = box(300)
                const light = () => s.play(spotlight(lit_, { duration: 0.5 })), change = () => s.play(morph(source, result), { duration: 1 })
                if (order === 'time') { s.at(1, light); s.at(2, change) } else { s.at(2, change); s.at(1, light) }
                s.wait(4)
            })
            for (const order of ['time', 'code'] as const) {
                await expect(dimSource(order), order).rejects.toThrow(/the light at 1 s dims a node while it morphs, from 2 s to 3 s. A dim morph would jump in brightness. Make the node that the morph starts from a target or a keep of that light, or turn the light off before the morph/)
            }
            // The same morph with its source in `keep` is a film.
            const kept = await compile((s) => {
                const lit_ = s.add(box(-300)), source = s.add(box(0))
                s.play(spotlight(lit_, { keep: source, duration: 0.5 }))
                s.play(morph(source, box(300)), { duration: 1 })
            })
            expect(kept.duration).toBe(1.5)
        })

        it('is refused when a light starts while it is under way and dims its shapes, or when it ends in a dim group', async () => {
            const during = compile((s) => {
                const source = s.add(box(0)), other = s.add(box(-300))
                // The first light is on the source too, so the morph starts bright. The error names the light that dims it.
                s.play(spotlight([source, other], { duration: 0.2 }))
                s.wait(0.8)
                s.play(morph(source, box(300)), { duration: 1 })
                s.at(1.5, () => s.play(spotlight(other, { duration: 0.3 })))
            })
            await expect(during).rejects.toThrow(/the light at 1.5 s dims a node while it morphs, from 1 s to 2 s/)
            const intoDim = compile((s) => {
                const lit_ = s.add(box(-300)), result = box(300).hide()
                s.add(group(box(300, 200), result))
                s.play(spotlight(lit_, { duration: 0.5 }))
                s.play(morph(lit_, result), { duration: 1 })
            })
            await expect(intoDim).rejects.toThrow(/the light at 0 s dims a node while it morphs, from 0.5 s to 1.5 s/)
        })

        it('does not make the lights settle again: 60 morphs under 60 lights on 2,000 nodes compile in the time of the lights alone', async () => {
            const build = (morphs: boolean) => async () => {
                const started = performance.now()
                await compile((s) => {
                    const nodes = Array.from({ length: 2000 }, (_, i) => s.add(rect(10, 10, { fill: 'blue', stroke: null }).at(-900 + (i % 100) * 18, -400 + Math.floor(i / 100) * 18)))
                    for (let i = 0; i < 60; i++) {
                        // The light is also on the node that morphs next, because a morph cannot be dim.
                        s.play(spotlight([nodes[i * 7]!, nodes[1000 + i]!], { duration: 0.2 }))
                        if (morphs) s.play(morph(nodes[1000 + i]!, rect(10, 10, { fill: 'red', stroke: null }).at(-900 + i * 18, 450)), { duration: 0.2 })
                        else s.wait(0.2)
                    }
                })
                return performance.now() - started
            }
            const alone = Math.min(await build(false)(), await build(false)()), withMorphs = Math.min(await build(true)(), await build(true)())
            // When each morph made every light settle again, this film took more than ten times the film with no morph.
            // The limit is wide: three times the lights alone, and half a second for a loaded machine.
            expect(withMorphs).toBeLessThan(alone * 3 + 500)
        })
    })

    it('keeps the lights of a film on its stage, so a second film compiles and does not change the first', async () => {
        let rest!: Node
        const build = (s: Stage) => {
            const target = s.add(box(-300))
            rest = s.add(box(0))
            s.play(spotlight(target, { duration: 1 }))
            s.wait(3)
        }
        const first = await compile(build), firstRest = rest
        // With one list for every stage, this film would get the light of the first, and its target is not here.
        await compile((s) => {
            build(s)
            s.play(spotlight(null, { duration: 1 }))
        })
        expect(lit(first, 3.5, firstRest)).toEqual([0.3])
    })

    it('leaves dim text as text for the film check, which has no new finding and still reports a dim text on another text', async () => {
        for (const dim of [undefined, 0.1]) {
            const page = film({ fps: 20 }, (s) => {
                s.wait(0.5)
                const lines = ['The first sentence of a page of text.', 'The second sentence, which the light is on.'].map((line, index) => s.add(text(line, { font: 'text-serif', size: 44 }).at(0, -60 + index * 120)))
                // The first sentence is bright for half a second, which is too short to read it. It stays up, dim.
                s.wait(0.5)
                s.play(spotlight(lines[1]!, dim === undefined ? {} : { dim }))
                s.wait(3)
            })
            // A dim text keeps its alpha, and the check has no rule for the contrast of a text.
            expect((await checkFilm(page, { motion: true })).diagnostics, `dim ${dim}`).toEqual([])
        }
        const crossed = await checkFilm(film({ fps: 20 }, (s) => {
            s.add(text('one text', { size: 60 }))
            const over = s.add(text('one more', { size: 60 }).at(20, 10))
            s.play(spotlight(over))
            s.wait(1)
        }))
        expect(crossed.diagnostics.map((entry) => entry.code)).toEqual(['film.text_overlap'])
    })

    it('stops the build for a light that would show nothing, and says what to do', async () => {
        const failure = (build: (s: Stage, a: Node, b: Node) => void, start = 3) => compile((s) => {
            const a = s.add(box(-300)), b = s.add(box(0))
            s.wait(start)
            build(s, a, b)
            s.wait(1)
        })
        // A target that the film never added, one that it adds later, and one that is hidden: at 3 s, and at 0 s.
        await expect(failure((s) => s.play(spotlight(box(300))))).rejects.toThrow(/the target of the light at 3 s is not on the stage. So the light would show nothing. Show the node before the light, or bring it at the time that the light starts/)
        await expect(failure((s, a) => { const late = box(300); s.play(spotlight([a, late])); s.play(fadeIn(late)) })).rejects.toThrow(/target 2 of 2 of the light at 3 s does not show at that time: it is hidden, or it comes to the stage later/)
        for (const start of [3, 0]) {
            await expect(failure((s) => s.play(spotlight(s.add(box(300).hide()))), start), `at ${start}`).rejects.toThrow(new RegExp(`the target of the light at ${start} s does not show at that time`))
            await expect(failure((s, a) => { a.hide(); s.play(spotlight(a)) }, start), `at ${start}`).rejects.toThrow(new RegExp(`the target of the light at ${start} s does not show at that time`))
        }
        // A target that left just before the light is hidden too, and so is the source of a morph that is over.
        await expect(failure((s, a) => { s.play(fadeOut(a)); s.play(spotlight(a)) })).rejects.toThrow(/the target of the light at 3.6 s does not show at that time/)
        await expect(failure((s, a) => { s.play(morph(a, box(300)), { duration: 1 }); s.play(spotlight(a)) })).rejects.toThrow(/the target of the light at 4 s does not show at that time/)
        await expect(failure((s) => s.play(spotlight(s.camera)))).rejects.toThrow(/a target is the camera, which is not a part of the picture. Give it a node that the film draws/)
        await expect(failure((s) => s.play(spotlight(s.root)))).rejects.toThrow(/a target is the root of the stage, which holds every node, so nothing would dim/)
        // A light in a node that another light dimmed as a whole, and in a node whose group is dim.
        const inDim = (order: 'time' | 'code', deep: boolean) => compile((s) => {
            const bars = [box(-450), box(-300)]
            const chart = group(...bars)
            s.add(deep ? group(chart, box(-450, 300)) : chart)
            const other = s.add(box(300))
            const stage = () => s.play(spotlight(other, { duration: 1 })), inner = () => s.play(spotlight(bars[1]!, { within: chart, duration: 1 }))
            if (order === 'time') { s.at(1, stage); s.at(2, inner) } else { s.at(2, inner); s.at(1, stage) }
            s.wait(4)
        })
        for (const order of ['time', 'code'] as const) for (const deep of [false, true]) {
            await expect(inDim(order, deep), `${order}, ${deep ? 'in a dim group' : 'dim itself'}`).rejects.toThrow(/the node for within is dim at 2 s, because another light is on something else then. So the light in it would show nothing. Make that node a target of the other light, or turn the other light off first/)
        }
    })

    it('takes as a target a node that enters with the light, a part of a thing that enters with it, and the source of a morph that starts with it', async () => {
        const film_ = (build: (s: Stage) => Node[], start: number) => {
            let nodes!: Node[], rest!: Node
            return compile((s) => {
                rest = s.add(box(-600))
                s.wait(start)
                nodes = build(s)
                s.wait(1)
            }).then((f) => [lit(f, f.duration, rest), nodes.map((node) => at(f.duration, () => node.get('dim')))])
        }
        for (const start of [0, 2]) {
            const entrances: Record<string, (s: Stage) => Node[]> = {
                'fadeIn and the light, in the two orders': (s) => {
                    const first = box(-300), second = box(-150)
                    s.play(spotlight([first, second], { duration: 0.5 }), fadeIn(first, { duration: 0.5 }))
                    s.at(s.time - 0.5, () => s.play(fadeIn(second, { duration: 0.5 })))
                    return [first, second]
                },
                // `write` keeps each glyph hidden until its turn, so the last glyphs are hidden when the light starts.
                'one term of an equation that write brings': (s) => { const eq = tex('a^2 + b^2 = c^2', { size: 90 }); s.play(write(eq), spotlight(eq.part('c^2'))); return eq.part('c^2') },
                'the last child of a group that fades in child by child': (s) => { const rows = [0, 1, 2].map((i) => box(-300 + i * 150, 200)); s.play(fadeIn(group(...rows), { lag: 0.5 }), spotlight(rows[2]!)); return [rows[2]!] },
                'one bar of a chart that enters': (s) => { const chart = barChart([{ label: 'a', value: 3 }, { label: 'b', value: 7 }], { width: 400, height: 240 }); s.play(chart.enter(), spotlight(chart.bar(1))); return [chart.bar(1)] },
                'the source of a morph': (s) => { const source = s.add(box(0)); s.wait(start === 0 ? 0 : 0.5); s.play(spotlight(source, { duration: 0.5 }), morph(source, box(300), { duration: 0.5 })); return [source] },
            }
            for (const [name, build] of Object.entries(entrances)) {
                const [rest, dims_] = await film_(build, start)
                expect([rest, [...new Set(dims_)]], `${name}, at ${start} s`).toEqual([[0.3], [1]])
            }
        }
    })

    it('refuses a target that is not a node, an empty list, a dim that is not a number from 0 to 1, a duration under 0, and a target outside `within`', async () => {
        await compileFilm(film(() => {
            const a = box(0), inner = box(100), outer = group(inner)
            expect(() => spotlight([])).toThrow(/list of targets is empty.*or null to turn the light off/)
            expect(() => spotlight(undefined as never)).toThrow(/a target is undefined, not a node/)
            expect(() => spotlight([a, [inner][1]!])).toThrow(/a target is undefined, not a node/)
            expect(() => spotlight(a, { keep: [null as never] })).toThrow(/a node in keep is null, not a node/)
            expect(() => spotlight(a, { keep: 'heading' as never })).toThrow(/a node in keep is string, not a node/)
            expect(() => spotlight(inner, { within: 'chart' as never })).toThrow(/the node for within is string, not a node/)
            for (const dim of [-0.1, 1.5, NaN, Infinity]) expect(() => spotlight(a, { dim })).toThrow(new RegExp(`dim is ${dim}. It is the part of its color that the rest keeps, a number from 0 to 1`))
            expect(() => spotlight(a, { dim: '0.3' as never })).toThrow(/dim is "0.3"/)
            for (const duration of [-1, NaN, Infinity]) expect(() => spotlight(a, { duration })).toThrow(new RegExp(`duration is ${duration}. It is the time that the light takes to change, in seconds, 0 or more`))
            expect(() => spotlight(a, { within: outer })).toThrow(/a target is not inside the node for within/)
            expect(() => spotlight(outer, { within: outer })).toThrow(/a target is not inside the node for within/)
            // The ends of the range, a target in `within`, the light off in `within`, and one node for `keep` are all valid.
            for (const dim of [0, 1]) expect(spotlight(a, { dim }).label).toBe('spotlight')
            expect(spotlight(inner, { within: outer }).label).toBe('spotlight')
            expect(spotlight(null, { within: outer }).label).toBe('spotlight')
            expect(spotlight(a, { keep: inner, duration: 0 }).label).toBe('spotlight')
            // Two nodes as two arguments: the second one would be lost as the options.
            expect(() => spotlight(a, inner as never)).toThrow(/the second argument is a node, and it must be the options. To light more than one node, give them as one list: spotlight\(\[a, b\]\)/)
            expect(() => spotlight(a, [inner] as never)).toThrow(/the second argument is a node/)
        }))
    })

    describe('changes nothing in a film with no light', () => {
        const shown = (f: CompiledFilm, time: number, node: Node) => f.frame(time).ops.some((op) => op.node === node)

        it('keeps the timeline of a node that a verb brings at 0 s: a group that takes the node in later still hides it before', async () => {
            let brought!: Node, added!: Node
            const f = await compile((s) => {
                const holder = s.add(group())
                brought = box(0)
                s.play(fadeIn(brought, { duration: 0.4 }))
                added = s.add(box(200))
                s.wait(1.1)
                // At 1.5 s a group on the stage takes the two nodes in. The stage mounts them again then, as it did before.
                holder.add(brought, added)
                s.wait(1)
            })
            expect(brought.tracks?.get('dim')).toBeUndefined()
            expect([shown(f, 0.2, brought), shown(f, 1, brought), shown(f, 2, brought)]).toEqual([false, false, true])
            expect([shown(f, 0.2, added), shown(f, 1, added), shown(f, 2, added)]).toEqual([false, true, true])
        })

        it('keeps a node hidden that the film removes before it mounts the node at 0 s', async () => {
            let removed!: Node, after!: Node, alone!: Node
            const f = await compile((s) => {
                removed = box(-300)
                s.remove(removed)
                s.mountAt(removed, 0)
                after = box(0)
                s.mountAt(after, 0)
                s.remove(after)
                alone = box(300)
                s.mountAt(alone, 0)
                s.wait(1)
            })
            expect([removed, after, alone].map((node) => shown(f, 0.5, node))).toEqual([false, false, true])
            // A mount at 0 s writes no key: the node shows from the start by its own `visible`.
            expect(alone.tracks?.get('visible')).toBeUndefined()
        })
    })

    describe('a mark that a verb adds for a node is as bright as that node, at 0 s and later', () => {
        const YELLOW = parseColor('#ffd75e')
        const verbs: Record<string, (a: Node, wire: Node, word: Node) => Anim> = {
            circumscribe: (a) => circumscribe(a, { duration: 1 }),
            flash: (a) => flash(a, { duration: 1 }),
            ripple: (a) => ripple(a, { color: 'yellow', duration: 1 }),
            pulse: (_a, wire) => pulse(wire, { duration: 1 }),
            highlightSweep: (_a, _wire, word) => highlightSweep(word, { duration: 1 }),
            typewriter: (_a, _wire, word) => typewriter(word, { cursor: true, cursorColor: 'yellow', duration: 1 }),
        }
        const cases = Object.keys(verbs).flatMap((verb) => [0, 2].map((start) => [verb, start] as const))

        it.each(cases)('%s at %d s: bright with a light on its node, and as dim as its node with the light on another node', async (verb, start) => {
            for (const lit_ of [true, false]) {
                let known!: Set<Node | undefined>
                const f = await compile((s) => {
                    const a = s.add(box(-300)), b = s.add(box(300))
                    const wire = s.add(line([-200, 200], [200, 200], { stroke: 'blue', width: 4 }))
                    const word = s.add(text('word', { size: 60 }).at(0, -250))
                    known = new Set([a, b, wire, ...word.all()])
                    s.wait(start)
                    s.play(spotlight(lit_ ? [a, wire, word] : b, { duration: 0.2 }), verbs[verb]!(a, wire, word))
                })
                // Each mark is yellow. Read its red channel as a part of the way from the background to yellow.
                const marks = paths(f, start + 0.5).filter((op) => !known.has(op.node))
                const parts = [...new Set(marks.map((op) => round((((op.stroke ?? op.fill) as Rgba)[0] - BACK[0]) / (YELLOW[0] - BACK[0]))))]
                expect(marks.length).toBeGreaterThan(0)
                expect(parts, lit_ ? 'the light is on its node' : 'the light is on another node').toEqual([lit_ ? 1 : 0.3])
            }
        })

        it('leaves a mark at a point, which belongs to no node, with its own look', async () => {
            for (const start of [0, 2]) {
                let known!: Set<Node | undefined>
                const f = await compile((s) => {
                    const a = s.add(box(-300)), b = s.add(box(300))
                    known = new Set([a, b])
                    s.wait(start)
                    s.play(spotlight(a, { duration: 0.2 }), flash([0, 0], { duration: 1 }), ripple([0, 200], { color: 'yellow', duration: 1 }))
                })
                const marks = paths(f, start + 0.5).filter((op) => !known.has(op.node))
                expect([...new Set(marks.map((op) => round((((op.stroke ?? op.fill) as Rgba)[0] - BACK[0]) / (YELLOW[0] - BACK[0]))))], `at ${start} s`).toEqual([1])
            }
        })
    })

    it('lights the label of a span of `lanes` with its bar, and the row of a dot chart with its dot', async () => {
        const flow = () => lanes(['guest', 'monitor'], [{ lane: 'guest', start: 0, end: 30, label: 'runs' }, { lane: 'monitor', start: 30, end: 70, label: 'emulates the device' }], { width: 900 })
        const dots = () => dotChart([{ label: 'blocks', value: 0.89, low: 0.87, high: 0.91 }, { label: 'tall CSV', value: 0.57, low: 0.54, high: 0.6 }], { width: 500, domain: [0, 1] })
        let made!: ReturnType<typeof flow>, chart!: ReturnType<typeof dots>
        await compile((s) => {
            made = s.add(flow().at(0, -200))
            chart = s.add(dots().at(0, 250))
            s.play(made.showAll(), { duration: 0.5 })
            // The bar of the second span, and the dot of the first row. The chart is two levels over the dot: its row is between.
            s.play(spotlight(made.spans[1]!.shape, { within: made, duration: 0.5 }), spotlight(chart.dots[0]!, { within: chart, duration: 0.5 }))
        })
        const bright = (...nodes: (Node | null)[]) => dims(1, ...nodes.map((node) => node!)).map((dim) => dim === 1)
        expect(bright(made.spans[1]!.shape, made.spans[1]!.text, made.spans[0]!, made.names[1]!)).toEqual([true, true, false, false])
        expect(chart.dots[0]!.parent).not.toBe(chart)
        expect(bright(chart.dots[0]!, chart.labels[0]!, chart.intervals[0]!, chart.rows[1]!, chart.axis)).toEqual([true, true, true, false, false])
    })
})

describe('film font', () => {
    /** The fonts of the texts that the frames at these times draw, by the words of each text. Each font is the one that the text node reports. */
    function fontsIn(f: CompiledFilm, ...times: number[]): Map<string, string[]> {
        const found = new Map<string, Set<string>>()
        for (const t of times) {
            for (const op of paths(f, t)) {
                const block = op.node?.parent
                if (block instanceof TextNode) found.set(block.source, (found.get(block.source) ?? new Set<string>()).add(block.font))
            }
        }
        return new Map([...found].map(([words, fonts]) => [words, [...fonts].sort()]))
    }

    const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80"><text x="0" y="30" font-size="20">svg words</text>'
        + '<g font-family="ui-monospace, Menlo, monospace"><text x="0" y="70" font-size="20">svg code</text></g></svg>'

    /**
     * One object of each kind that draws a label, with words that no other text has. `own` goes to each
     * object as its `font`, to the note of the tag, to the edge labels of the graph, and to the plain text.
     * The objects that set data in mono by default (array cells, tokens, a counter, a decimal) do not get it,
     * and the quotes do not: they have a font of their own.
     */
    function everyObject(s: Stage, own?: FontFamily): void {
        const font = own
        s.add(text('plain note', { font }), text('0x7ffd', { font: 'mono' }))
        s.add(card({ title: 'card title', caption: 'card caption', font }))
        s.add(zone(rect(120, 60), { title: 'zone title', font }))
        s.add(tag('TAGWORD', { note: 'tag note', noteFont: font }))
        s.add(dotChart([{ label: 'dot label', value: 0.5 }], { domain: [0, 1], ticks: [0, 1], format: (value) => `dot tick ${value}`, xLabel: 'dot axis', font }))
        const flow = s.add(lanes(['lane one', 'lane two'], [
            { lane: 0, start: 0, end: 40, label: 'lane span' },
            { from: 0, to: 1, at: 40, label: 'lane handoff' },
            { from: 1, to: 0, at: 80 },
        ], { domain: [0, 100], ticks: [0, 100], format: (time) => `lane tick ${time}`, axisLabel: 'lane axis', boundaries: [{ between: [0, 1], label: 'lane wall', count: true }], font }))
        s.add(bitField([{ bits: 4, label: 'bit under', value: '0xf' }, { bits: 8, label: 'bit inside' }], { font }))
        s.add(terminal(['a line of output'], { title: 'run title', note: 'run note' }))
        s.add(stateGrid({ columns: 2, rows: 1 }).legend([['present', 'grid key']], { font }))
        s.add(barChart([{ label: 'bar label', value: 412 }], { font }))
        s.add(unitChart([{ count: 4, label: 'unit label' }, { count: 2, color: 'green', label: 'unit other' }], { rows: 2, split: true, font }))
        s.add(infoBox({ title: 'info title', subtitle: 'info subtitle', badge: 'info badge', rows: [{ label: 'info row', value: 'info value' }], tags: ['info tag'], font }))
        s.add(callout([0, 0], 'callout body', { title: 'callout title', font }))
        s.add(legend([{ label: 'key label' }], { font }))
        s.add(graph([{ id: 'a', label: 'graph node' }, { id: 'b', label: 'graph other' }], [{ from: 'a', to: 'b', label: 'edge label' }], { font, edgeFont: font }))
        s.add(tree({ label: 'tree root', children: [{ label: 'tree leaf' }] }, { font }))
        s.add(neuralNet([2, 2], { layerLabels: ['layer in', 'layer out'], font }))
        s.add(heatmap([[0.1, 0.9]], { values: true, format: (value) => `cell ${value}`, rowLabels: ['heat row'], columnLabels: ['heat column', 'heat other'], font }))
        s.add(attentionMatrix(['attend row'], ['attend column'], [[1]], { font }))
        s.add(lineChart([{ name: 'line name', values: [1, 2] }], { xLabel: 'line x', yLabel: 'line y', xFormat: (x) => `line x tick ${x}`, yFormat: (y) => `line y tick ${y}`, font }))
        s.add(scatter([{ x: 1, y: 1, group: 'scatter group' }, { x: 2, y: 2, group: 'scatter group' }], { xLabel: 'scatter x', yLabel: 'scatter y', font }))
        s.add(histogram([10, 20, 20, 30], { bins: 3, ticks: 2, font }))
        s.add(donut([{ label: 'pie label', value: 1 }], { percent: false, centerLabel: 'pie center', font }))
        s.add(braceLabel(rect(100, 40), 'brace label', { plain: true, font }))
        s.add(labeledDot('dot name', { plain: true, font }))
        const view = s.add(scene3d())
        view.add(axes3d({ x: [0, 9], y: [0, 9], z: [0, 9], step: 9, numbers: true, font }), label3d('space label', [1, 1, 1], { math: false, font }))
        s.add(fromSvg(SVG, { font }))
        s.add(connector([0, 0], [300, 0], { label: 'wire label', font }))
        s.add(arrayCells(['cell value']), tokens([{ text: 'token', sub: 'token sub' }]), counter(1234), decimal(() => 0.25, { prefix: 'm = ' }))
        // A drawing that is rebuilt on each frame makes its text while the frame is drawn, not in the callback.
        s.add(dynamic(() => text('made each frame', { font })))
        const strip = s.add(steps([{ label: 'step label', note: 'step note' }, { label: 'step other' }], { numbered: true, current: 0, font }))
        const wall = s.add(boundary({ width: 900, label: 'wall label', above: 'wall above', below: 'wall below', tally: ['wall call', 'wall calls'], tallySide: 'over', tickScale: 250, font }))
        const ring = s.add(ringBuffer(4, { radius: 320, label: 'ring caption', counts: true, numbers: true, font }))
        s.add(quote('quoted words', { by: 'quote source', width: 600 }))
        s.add(quotePair({ words: 'pair first' }, { words: 'pair second' }, { width: 1200, versus: 'pair but' }))
        const dates = s.add(dateLine([{ at: '2021-03', label: 'date label', note: 'date note' }, { at: '2024' }], { width: 900, from: 2020, to: 2026, font }))
        s.play(flow.enter(), ring.enter(), wall.enter(), strip.enter(), dates.enter(), { duration: 0.1 })
        s.play(flow.showAll(), ring.push({ label: 'ringed' }), dates.showAll(), { duration: 0.2 })
        // The label of a crossing is on screen while its mark crosses: from 0.3 to 0.7.
        s.play(wall.cross(wall.x(0.2), { direction: 'round', label: 'wall mark' }), { duration: 0.4 })
        s.play(wall.addCrossings(9999), { duration: 0.2 })
        s.wait(0.5)
    }
    const CROSSING = 0.5, END = 1.35

    // Labels, titles, notes, captions and the numbers of an axis. "2" is the count of a boundary of the lanes,
    // "20" is a tick of the histogram, "9" is a number of the 3D axes, "," is in the tally of the boundary,
    // "3" is the number of a slot of the ring, and "2023" is a year of the date line.
    const LABELS = [
        'plain note', 'card title', 'card caption', 'zone title', 'tag note', 'dot label', 'dot tick 0', 'dot axis',
        'lane one', 'lane span', 'lane handoff', 'lane tick 100', 'lane axis', 'lane wall', '2', 'bit under', 'bit inside', 'grid key',
        'bar label', 'unit label', 'info title', 'info row', 'callout title', 'callout body', 'key label', 'graph node', 'tree leaf',
        'layer in', 'heat row', 'heat column', 'attend row', 'attend column', 'line name', 'line x', 'line y', 'line x tick 1', 'line y tick 1',
        'scatter group', 'scatter x', 'scatter y', '20', 'pie label', 'brace label', 'dot name', '9', 'space label', 'svg words', 'made each frame',
        '1 step label', 'step note', 'wall label', 'wall above', 'wall below', 'wall calls', ',', 'wall mark', 'each tick: about 250',
        'ring caption', 'ringed', 'head 0', 'tail 1', '3', 'date label', 'date note', '2023',
    ]
    // Code, values, addresses and ids. "11" is a bit number of the bit field, "412" is the value over a bar, and "1,234" is the counter.
    const MONO = [
        '0x7ffd', 'TAGWORD', 'run title', 'run note', '0xf', '11', '412', 'info subtitle', 'info badge', 'info value', 'info tag',
        'cell value', 'token', 'token sub', '1,234', 'm = 0.25', 'cell 0.1',
    ]
    // The label on a line: of a connector, and of an edge of a graph. It was mono before films had a font.
    const ON_LINES = ['wire label', 'edge label']
    // A quote sets its words and its source line in the serif text font, by its own rule.
    const QUOTED = ['“quoted words”', 'quote source', '“pair first”', 'pair but']
    /** The font of each of the words, as pairs, so that a failure names the text. */
    const pairs = (fonts: Map<string, string[]>, words: readonly string[]) => words.map((text) => [text, fonts.get(text)?.join(' and ')])
    const all = (words: readonly string[], font: string) => words.map((text) => [text, font])
    const every = async (options: { font?: FontFamily }, own?: FontFamily) => fontsIn(await compile((s) => everyObject(s, own), options), CROSSING, END)

    it('sets the labels of every kind of object in the font of the film, and keeps code and values in mono', async () => {
        const fonts = await every({ font: 'text-serif' })
        expect(pairs(fonts, LABELS)).toEqual(all(LABELS, 'text-serif'))
        expect(pairs(fonts, MONO)).toEqual(all(MONO, 'mono'))
        expect(pairs(fonts, ON_LINES)).toEqual(all(ON_LINES, 'text-serif'))
        expect(pairs(fonts, QUOTED)).toEqual(all(QUOTED, 'text-serif'))
        // The middle of a donut is a display title, in the display serif. Text that an SVG sets in a monospace family is code.
        expect(pairs(fonts, ['pie center', 'svg code'])).toEqual([['pie center', 'serif'], ['svg code', 'mono']])
        // The rule of the film: no text is in the sans font.
        expect([...fonts].filter(([, own]) => own.includes('sans'))).toEqual([])
    })

    it('keeps the font that an object or a text names, also when it is the library default', async () => {
        const fonts = await every({ font: 'text-serif' }, 'sans')
        expect(pairs(fonts, LABELS)).toEqual(all(LABELS, 'sans'))
        expect(pairs(fonts, MONO)).toEqual(all(MONO, 'mono'))
        expect(pairs(fonts, ON_LINES)).toEqual(all(ON_LINES, 'sans'))
        // The font of an object is the font of its labels: the code of an SVG stays mono, and a quote that got no font keeps its own.
        expect(pairs(fonts, ['svg code', ...QUOTED])).toEqual([['svg code', 'mono'], ...all(QUOTED, 'text-serif')])
    })

    it('keeps a film with no font as it was: sans labels, mono on the lines, and all the text of an SVG in sans', async () => {
        const none = await compile((s) => everyObject(s)), serif = await compile((s) => everyObject(s), { font: 'text-serif' })
        const fonts = fontsIn(none, CROSSING, END)
        expect(pairs(fonts, LABELS)).toEqual(all(LABELS, 'sans'))
        expect(pairs(fonts, MONO)).toEqual(all(MONO, 'mono'))
        expect(pairs(fonts, ON_LINES)).toEqual(all(ON_LINES, 'mono'))
        expect(pairs(fonts, ['svg code', ...QUOTED])).toEqual([['svg code', 'sans'], ...all(QUOTED, 'text-serif')])
        expect(none.stage.font).toBeNull()
        expect(serif.stage.font).toBe('text-serif')
        expect(svgAt(serif, END)).not.toBe(svgAt(none, END))
    })

    it('takes sans as a font that the film names: the labels on the lines follow it, and a quote keeps the serif text font', async () => {
        const fonts = await every({ font: 'sans' })
        expect(pairs(fonts, LABELS)).toEqual(all(LABELS, 'sans'))
        expect(pairs(fonts, MONO)).toEqual(all(MONO, 'mono'))
        expect(pairs(fonts, ON_LINES)).toEqual(all(ON_LINES, 'sans'))
        expect(pairs(fonts, ['svg code', ...QUOTED])).toEqual([['svg code', 'mono'], ...all(QUOTED, 'text-serif')])
    })

    it('gives the label of a connector and of a graph edge their own font in a film with none', async () => {
        const fonts = await every({}, 'text-serif')
        expect(pairs(fonts, ON_LINES)).toEqual(all(ON_LINES, 'text-serif'))
        expect(pairs(fonts, ['svg words', 'svg code'])).toEqual([['svg words', 'text-serif'], ['svg code', 'mono']])
    })

    it('lays out an object with the measures of the font of the film', async () => {
        const words = 'one line for each event sent'
        const build = async (font?: FontFamily) => {
            let made!: ReturnType<typeof card>
            const wide = { sans: 0, serif: 0 }
            await compile(() => {
                made = card({ title: 'Logs', caption: words })
                // The caption of a card with these defaults has a size of 28.8, and 364 px for a line.
                wide.sans = text(words, { size: 28.8, font: 'sans' }).bounds().width
                wide.serif = text(words, { size: 28.8, font: 'text-serif' }).bounds().width
            }, font ? { font } : {})
            return { made, wide }
        }
        const serif = await build('text-serif'), plain = await build()
        expect(plain.wide.sans).toBeGreaterThan(364)
        expect(serif.wide.serif).toBeLessThan(364)
        // In the serif text font the caption fits in one line, and it is as wide as that text. In sans it takes two lines.
        expect(serif.made.caption!.bounds().width).toBeCloseTo(serif.wide.serif, 6)
        expect(plain.made.caption!.bounds().width).toBeLessThan(plain.wide.sans - 40)
        expect(plain.made.frame.bounds().height - serif.made.frame.bounds().height).toBeCloseTo(1.25 * 28.8, 6)
    })

    it('sets weight 600 of the serif text font in its semibold, so a title differs from its body in a serif film', async () => {
        let regular = 0, semibold = 0, title = 0, body = 0, count = 0, plainCount = 0
        await compile(() => {
            regular = text('Why it is fast', { size: 40, font: 'text-serif' }).bounds().width
            semibold = text('Why it is fast', { size: 40, font: 'text-serif', weight: 600 }).bounds().width
            const note = callout([0, 0], 'Why it is fast', { title: 'Why it is fast', size: 40, width: 2000 })
            title = note.titleNode!.bounds().width
            // The body of a callout is 0.94 of the size of its title.
            body = note.body.bounds().width / 0.94
            const flow = lanes(['one', 'two'], [{ from: 0, to: 1, at: 5 }], { domain: [0, 10], size: 40, boundaries: [{ between: [0, 1], count: true }] })
            count = flow.counters[0]!.children[1]!.bounds().width
            plainCount = text('1', { size: 40, font: 'text-serif' }).bounds().width
        }, { font: 'text-serif' })
        // The strokes of the semibold are heavier, so its letters are wider.
        expect(semibold).toBeGreaterThan(regular * 1.01)
        expect(title).toBeCloseTo(semibold, 6)
        expect(body).toBeCloseTo(regular, 6)
        expect(count).toBeGreaterThan(plainCount * 1.01)
    })

    it('keeps the font of one film away from another film in the same process', async () => {
        const made: Record<string, TextNode> = {}
        const build = (name: string) => (s: Stage) => {
            made[name] = s.add(text(`${name} text`))
            s.add(dynamic(() => text(`${name} drawn`)))
            s.wait(1)
        }
        const serif = await compile(build('serif'), { font: 'text-serif' })
        const plain = await compile(build('plain'))
        expect(clock.font).toBeNull()
        expect(made['serif']!.font).toBe('text-serif')
        expect(made['plain']!.font).toBe('sans')
        // The frames of the two films in mixed order: a drawing that is rebuilt on each frame makes its text then.
        for (const [f, name, font] of [[serif, 'serif', 'text-serif'], [plain, 'plain', 'sans'], [serif, 'serif', 'text-serif']] as const) {
            expect(fontsIn(f, 0.5).get(`${name} drawn`)).toEqual([font])
            expect(clock.font).toBeNull()
        }
    })

    /** The font of each text of a film, in the order of the film. */
    const fontsOf = (f: CompiledFilm) => f.stage.root.all().flatMap((node) => (node instanceof TextNode ? [`${node.source}: ${node.font}`] : []))
    const turn = () => Promise.resolve()
    const timer = (ms: number) => () => new Promise<void>((resolve) => setTimeout(resolve, ms))
    /**
     * A film of two texts. With `wait`, its callback awaits between them. With `call`, the callback makes that
     * call on its stage after the await, before it makes the second text.
     */
    const twoTexts = (name: string, font: FontFamily | undefined, wait?: () => Promise<void>, call?: (s: Stage) => void) => film(font ? { fps: 10, font } : { fps: 10 }, wait
        ? async (s) => {
            s.add(text(`${name} one`).at(0, -100))
            await wait()
            call?.(s)
            s.add(text(`${name} two`).at(0, 100))
            s.wait(1)
        }
        : (s) => {
            s.add(text(`${name} one`).at(0, -100))
            s.add(text(`${name} two`).at(0, 100))
            s.wait(1)
        })
    /** What is left after the films: the mode and the font of the clock, and the font of a text that is made outside a film. */
    const after = () => [clock.mode, clock.font, text('made outside').font]

    it('gives two films that compile at the same time their own fonts and the picture that each has alone, when one callback awaits or none', async () => {
        const waits: [string, (() => Promise<void>) | undefined, (() => Promise<void>) | undefined][] = [
            ['no await', undefined, undefined], ['the plain film awaits a ready value', undefined, turn], ['the plain film awaits a timer', undefined, timer(10)],
            ['the serif film awaits a ready value', turn, undefined], ['the serif film awaits a timer', timer(10), undefined],
        ]
        for (const [name, serifWait, plainWait] of waits) {
            const serif = () => twoTexts('serif', 'text-serif', serifWait), plain = () => twoTexts('plain', undefined, plainWait)
            const alone = [(await compileFilm(serif())).svg(0.5), (await compileFilm(plain())).svg(0.5)]
            for (const first of ['serif', 'plain']) {
                const both = await Promise.all(first === 'serif' ? [compileFilm(serif()), compileFilm(plain())] : [compileFilm(plain()), compileFilm(serif())])
                const [a, b] = first === 'serif' ? both : [both[1]!, both[0]!]
                const label = `${name}, the ${first} film starts first`
                expect([label, fontsOf(a!), fontsOf(b!)]).toEqual([label, ['serif one: text-serif', 'serif two: text-serif'], ['plain one: sans', 'plain two: sans']])
                expect([label, a!.svg(0.5) === alone[0], b!.svg(0.5) === alone[1]]).toEqual([label, true, true])
                expect([label, ...after()]).toEqual([label, 'free', null, 'sans'])
            }
        }
    })

    it('does not wait for a callback that is not async, also when it returns a value', async () => {
        // An arrow function with no braces returns its node. The film is still done when the callback returns.
        const short = film({ font: 'text-serif' }, (s) => s.add(text('short one')) as unknown as void)
        const [a, b] = await Promise.all([compileFilm(twoTexts('plain', undefined, turn)), compileFilm(short)])
        expect([fontsOf(a), fontsOf(b)]).toEqual([['plain one: sans', 'plain two: sans'], ['short one: text-serif']])
        expect(after()).toEqual(['free', null, 'sans'])
    })

    it('gives two films whose callbacks both await their own fonts, when each calls its stage after its await, whatever the call', async () => {
        // Each call that a callback can make on its stage takes the clock for its film.
        const calls: Record<string, (s: Stage) => void> = {
            add: (s) => s.add(group()), mountAt: (s) => s.mountAt(group(), 0), remove: (s) => s.remove(), play: (s) => s.play(), wait: (s) => s.wait(0),
            at: (s) => s.at(0, () => {}), chapter: (s) => s.chapter('two'), caption: (s) => s.caption('two', 0.1), value: (s) => s.value(), update: (s) => s.update(group(), () => {}),
        }
        for (const [name, call] of Object.entries(calls)) {
            // The film that starts first also goes on first, so the clock has the font of the other film when it does.
            for (const first of ['serif', 'plain']) {
                const serif = twoTexts('serif', 'text-serif', timer(first === 'serif' ? 5 : 20), call), plain = twoTexts('plain', undefined, timer(first === 'serif' ? 20 : 5), call)
                const both = await Promise.all(first === 'serif' ? [compileFilm(serif), compileFilm(plain)] : [compileFilm(plain), compileFilm(serif)])
                const [a, b] = first === 'serif' ? both : [both[1]!, both[0]!]
                const label = `s.${name}(), the ${first} film starts first`
                expect([label, fontsOf(a!), fontsOf(b!)]).toEqual([label, ['serif one: text-serif', 'serif two: text-serif'], ['plain one: sans', 'plain two: sans']])
                expect([label, ...after()]).toEqual([label, 'free', null, 'sans'])
            }
        }
    })

    it('puts the clock back after any mix of films, and gives the film that goes on last its own font', async () => {
        // Here each callback makes its second text after its await, before any call to its stage. The film that
        // goes on first can then get the font of the other film: the guide says so. The film that goes on last
        // is alone by then, and the clock is as it was after all of them.
        for (const [serifMs, plainMs] of [[5, 20], [20, 5]]) {
            for (const first of ['serif', 'plain']) {
                const serif = twoTexts('serif', 'text-serif', timer(serifMs!)), plain = twoTexts('plain', undefined, timer(plainMs!)), mono = twoTexts('mono', 'mono')
                const made = await Promise.all(first === 'serif' ? [compileFilm(serif), compileFilm(plain), compileFilm(mono)] : [compileFilm(plain), compileFilm(mono), compileFilm(serif)])
                const label = `the serif film waits ${serifMs} ms and the plain film ${plainMs} ms, the ${first} film starts first`
                const last = serifMs! > plainMs! ? fontsOf(made[first === 'serif' ? 0 : 2]!) : fontsOf(made[first === 'serif' ? 1 : 0]!)
                expect([label, last]).toEqual([label, serifMs! > plainMs! ? ['serif one: text-serif', 'serif two: text-serif'] : ['plain one: sans', 'plain two: sans']])
                expect([label, fontsOf(made[first === 'serif' ? 2 : 1]!)]).toEqual([label, ['mono one: mono', 'mono two: mono']])
                expect([label, ...after()]).toEqual([label, 'free', null, 'sans'])
            }
        }
    })

    it('gives a film that is compiled inside the callback of another film its own font, then goes on with the first', async () => {
        const made: TextNode[] = []
        await compile(async (s) => {
            made.push(s.add(text('before')))
            await compile((inner) => {
                made.push(inner.add(text('inside')))
            })
            made.push(s.add(text('after')))
        }, { font: 'text-serif' })
        expect(made.map((node) => [node.source, node.font])).toEqual([['before', 'text-serif'], ['inside', 'sans'], ['after', 'text-serif']])
        expect(after()).toEqual(['free', null, 'sans'])
    })

    it('reaches a scene in its own function, and the part of a callback after an await', async () => {
        const made: TextNode[] = []
        const scene = (s: Stage) => {
            made.push(s.add(text('in a scene')))
        }
        await compile(async (s) => {
            scene(s)
            await Promise.resolve()
            made.push(s.add(text('after an await')))
        }, { font: 'serif' })
        expect(made.map((node) => node.font)).toEqual(['serif', 'serif'])
    })

    it('gives a text that an updater makes on a frame the font of the film', async () => {
        const seen: string[] = []
        const f = await compile((s) => {
            s.update(s.add(group()), () => {
                seen.push(text('from an updater').font)
            })
            s.wait(1)
        }, { font: 'text-serif' })
        seen.length = 0
        f.frame(0.5)
        expect(seen).toEqual(['text-serif'])
        expect(clock.font).toBeNull()
    })

    it('keeps the new value of an info box in mono', async () => {
        let box!: ReturnType<typeof infoBox>
        await compile((s) => {
            box = s.add(infoBox({ title: 'checkout', rows: [{ label: 'rate', value: 'old value' }] }))
            s.play(box.setValue(0, 'new value'))
        }, { font: 'text-serif' })
        const value = box.rowValues[0] as TextNode
        expect([value.source, value.font]).toEqual(['new value', 'mono'])
    })

    it('puts the library font back when a callback or a frame throws, and leaves a text from outside a callback in it', async () => {
        await expect(compile((s) => {
            s.add(text('made'))
            throw new Error('the scene broke')
        }, { font: 'text-serif' })).rejects.toThrow('the scene broke')
        expect(after()).toEqual(['free', null, 'sans'])
        await expect(compile(async (s) => {
            s.add(text('made'))
            await Promise.resolve()
            throw new Error('the scene broke later')
        }, { font: 'text-serif' })).rejects.toThrow('the scene broke later')
        expect(after()).toEqual(['free', null, 'sans'])

        let broken = false
        const f = await compile((s) => {
            s.add(dynamic(() => {
                if (broken) throw new Error('the drawing broke')
                return text('drawn')
            }))
            s.wait(1)
        }, { font: 'text-serif' })
        broken = true
        expect(() => f.frame(0.5)).toThrow('the drawing broke')
        expect(after()).toEqual(['free', null, 'sans'])

        // A text measures its glyphs when it is made. This one is made before the film starts, so the film cannot change it.
        const outside = text('made outside')
        await compile((s) => {
            s.add(outside)
        }, { font: 'text-serif' })
        expect(outside.font).toBe('sans')
        // The stage of a film that is done does not take the clock when a tool calls it.
        f.stage.add(group())
        f.stage.wait(1)
        expect(after()).toEqual(['free', null, 'sans'])
    })

    it('refuses a font that the library does not have, and names the fonts that it has', async () => {
        await expect(compile(() => {}, { font: 'comic' })).rejects.toThrow(`film: font is 'sans', 'serif', 'text-serif', 'mono' or 'noto', not "comic"`)
        expect(clock.font).toBeNull()
    })

    it('says what is wrong and what to do when a text is made before its font is loaded, outside a callback', () => {
        // A text at the top of a film file throws this. A tool that does not know it prints it as a string.
        const thrown = new Suspend(Promise.resolve())
        expect(String(thrown)).toMatch(/not loaded yet.*inside the callback of film\(\), not at the top of a file/s)
        expect(String(thrown)).toMatch(/two copies of vizmatic.*package\.json with "type": "module"/s)
        expect(thrown.message).toBe(String(thrown))
    })

    it('gives the film check nothing new to report when a film only adds the font', async () => {
        // The labels have characters that the serif fonts do not have, so they come from the fonts behind them.
        const scene = (s: Stage) => {
            s.add(card({ title: 'the CPU', caption: 'one core → one thread', width: 400 }).at(-640, -260))
            s.add(zone(text('a write ≤ 4 kB', { size: 40 }), { title: 'guest memory', dash: true }).at(-60, -300))
            s.add(tag('MEASURED', { note: 'run 03, Linux 7.0' }).at(300, -400))
            s.add(dotChart([{ label: 'page cache', value: 0.8, low: 0.7, high: 0.9 }, { label: 'huge pages', value: 0.3 }], { width: 700, domain: [0, 1], labelSize: 28, xLabel: 'share of faults' }).at(120, -40))
            s.add(bitField([{ bits: 9, label: 'directory', value: '0x1ff' }, { bits: 9, label: 'table' }, { bits: 12, label: 'offset in the page' }], { width: 1400 }).at(0, 320))
            s.wait(2)
        }
        for (const font of [undefined, 'text-serif', 'serif'] as const) {
            const report = await checkFilm(film(font ? { font } : {}, scene), { motion: true })
            expect([font, report.diagnostics.map((found) => `${found.code}: ${found.message}`)]).toEqual([font, []])
        }
    })
})
