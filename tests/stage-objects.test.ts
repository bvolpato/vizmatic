import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import {
    CODE_LANGUAGES, arrayCells, attentionMatrix, axes, axes3d, barChart, callout, card, checkFilm, codeBlock, compileFilm, complexPlane, applyComplex, connector, countUp,
    counter, curve3d, dashedGuides, donut, dotChart, draw, dynamic, epicycles, fadeIn, film, fourier, fourierPoint, frameToSvg, fromSvg, graph, group,
    heatmap, highlightSweep, histogram, infoBox, lagged, labeledDot, lanes, legend, line, lineChart, linear, matrix, morph, morphCode, morphMatching,
    neuralNet, numberLine, parseSvgPath, pathBounds, pathToD, pictogram, PICTOGRAMS, pie, point3d, points3d, rect, riemann, samplePath, scatter, scene3d, smooth, spin,
    seq, sphere, streamLines, surface, swap, tag, tagTrack, tex, text, tokens, tokenize, trail3d, traced, tree, typewriter, unitChart, vectorField, vector3d, wipe, write, zone,
    circle, tangentLine, secantLine, areaUnder, braceLabel, surroundingBox, angleMark, rightAngle, circlePath, to, type CompiledFilm,
    type FilmDefinition, type LaneEvent, type Node, type PathOp, type Stage, type Vec, type Vec3,
} from '../src/stage/index'
import { fromComponent } from '../src/stage/export'
import { clock } from '../src/stage/track'
import { Suspend } from '../src/stage/stage'
import { CalloutCard, getThemeColors, Row, StepCard } from '../src/index'

async function compile(build: (s: Stage) => void | Promise<void>, options: Parameters<typeof film>[0] extends never ? never : Record<string, unknown> = {}): Promise<CompiledFilm> {
    return compileFilm(film(options as never, build) as FilmDefinition)
}

const paths = (f: CompiledFilm, t: number) => f.frame(t).ops.filter((op): op is PathOp => op.kind === 'path')
const svgAt = (f: CompiledFilm, t: number) => frameToSvg(f.frame(t))

/** Run code that reads node state as of a time. */
function at<T>(time: number, read: () => T): T {
    const saved = clock.now
    clock.now = time
    try {
        return read()
    } finally {
        clock.now = saved
    }
}

function expectPure(f: CompiledFilm, times: readonly number[]): void {
    const forward = times.map((t) => svgAt(f, t))
    const backward = [...times].reverse().map((t) => svgAt(f, t)).reverse()
    expect(backward).toEqual(forward)
    expect(times.map((t) => svgAt(f, t))).toEqual(forward)
}

describe('determinism across object families', () => {
    it('renders the same frame on repeat and out of order', async () => {
        const f = await compile((s) => {
            const ax = s.add(axes({ x: [-1, 4], y: [-1, 9], width: 700, height: 400 }).at(-400, 100))
            const curve = ax.plot((x) => x * x, { stroke: 'blue' })
            const h = s.value(1.5)
            secantLine(ax, (x) => x * x, 1, () => 1 + h.value, { legs: true })
            tangentLine(ax, (x) => x * x, () => 1 + h.value)
            areaUnder(ax, (x) => x * x, { from: 0, to: () => 1 + h.value })
            dashedGuides(ax, () => 1 + h.value, () => (1 + h.value) ** 2)
            riemann(ax, (x) => x * x, { from: 0, to: 2, n: 6 })
            s.add(streamLines((x, y) => [-y, x], { spacing: 1.2, steps: 40, x: [-4, 4], y: [-3, 3] }))
            s.add(vectorField((x, y, t) => [Math.sin(y + t), Math.cos(x)], { step: 1.5, animate: true }))
            const u = s.value(0)
            s.add(traced(() => [u.value * 100, Math.sin(u.value) * 100], 0, 10, { tail: 2 }))
            s.add(epicycles(fourier(samplePath(circlePath(0, 0, 100), 64), { terms: 8 }), { u: () => u.value / 6, tail: 0.5 }).at(300, 0))
            const scene = s.add(scene3d({ phi: 1, theta: 0.4, unit: 40 }).at(500, 200))
            scene.add(surface((x, y, t) => Math.sin(x + t) * Math.cos(y), { resolution: 10, animate: true }))
            scene.add(axes3d())
            scene.add(trail3d(() => [u.value, 0, 1], 0, 10, { tail: 2 }))
            scene.spin(0.3)
            s.add(barChart([{ label: 'a', value: 2 }, { label: 'b', value: 3 }], { width: 200, height: 100 }).at(-500, -300))
            s.play(draw(curve), h.to(0.1, { duration: 2 }), u.to(6, { duration: 3, ease: linear }))
            s.wait(0.5)
        })
        expectPure(f, [0, 0.4, 1, 1.7, 2.2, 3, f.duration])
    })
})

describe('morphs land exactly on their targets', () => {
    it('morph ends on the target geometry and hides the source', async () => {
        const a = circle(50, { stroke: 'blue' }).at(-200, 0)
        const b = rect(120, 80, { stroke: 'red' }).at(200, 100)
        const f = await compile((s) => {
            s.add(a)
            s.wait(0.5)
            s.play(morph(a, b), { duration: 1 })
            s.wait(0.5)
        })
        const start = paths(f, 0.25)
        expect(start).toHaveLength(1)
        const startBox = pathBounds(start[0]!.path)!
        expect(startBox.width).toBeCloseTo(100, 3)
        const end = paths(f, 1.75)
        expect(end).toHaveLength(1)
        const box = pathBounds(end[0]!.path)!
        expect(box.width).toBeCloseTo(120, 3)
        expect(box.height).toBeCloseTo(80, 3)
        expect(box.x + box.width / 2).toBeCloseTo(960 + 200, 3)
        // The last moment of the morph and the first moment after it draw the same shape.
        const before = paths(f, 1.5 - 1e-4)[0]!, after = paths(f, 1.5)[0]!
        expect(pathBounds(before.path)!.width).toBeCloseTo(pathBounds(after.path)!.width, 1)
    })

    it('morphMatching moves shared glyphs and ends on the target equation', async () => {
        let eq1!: ReturnType<typeof tex>, eq2!: ReturnType<typeof tex>
        const f = await compile((s) => {
            eq1 = s.add(tex('a^2 + b^2', { size: 60 }).at(0, 0))
            eq2 = tex('a^2 + b^2 = c^2', { size: 60 }).at(0, 0)
            s.play(morphMatching(eq1, eq2), { duration: 1 })
            s.wait(0.2)
        })
        expect(eq2.part('c^2')).toHaveLength(2)
        const final = paths(f, 1.1)
        expect(final).toHaveLength(eq2.glyphs.length)
        // Mid-morph, glyphs from both sides coexist, and nothing has vanished.
        expect(paths(f, 0.5).length).toBeGreaterThanOrEqual(eq1.glyphs.length)
    })

    it('warp reaches the exact image of each point, through straight motion', async () => {
        let plane!: ReturnType<typeof complexPlane>
        const f = await compile((s) => {
            plane = s.add(complexPlane({ unit: 100, x: [-2, 2], y: [-2, 2], labelRange: 1 }))
            s.play(applyComplex(plane, (re, im) => [re * 2, im * 2]), { duration: 1 })
        })
        const box = (t: number) => {
            let maxX = -Infinity
            for (const op of paths(f, t)) maxX = Math.max(maxX, pathBounds(op.path)!.x + pathBounds(op.path)!.width)
            return maxX - 960
        }
        expect(box(0)).toBeCloseTo(200, 0)
        expect(box(1)).toBeGreaterThan(395)
        expect(box(1)).toBeLessThan(405)
        // Doubling is linear, so grid lines stay straight the whole way through.
        const mid = paths(f, 0.5)[0]!.path[0]!.p
        const dx = mid[mid.length - 2]! - mid[0]!, dy = mid[mid.length - 1]! - mid[1]!
        const crossMid = (mid[12]! - mid[0]!) * dy - (mid[13]! - mid[1]!) * dx
        expect(Math.abs(crossMid)).toBeLessThan(1e-3)
    })

    it('finds code by token, by a fragment across tokens, and on one line', () => {
        const block = codeBlock('const mid = (lo + hi) / 2\nlo = mid + 1')
        const keys = (glyphs: { data: Record<string, unknown> }[]) => glyphs.map((glyph) => glyph.data['key']).join('')
        // One token matches every token with that text.
        expect(keys(block.find('lo'))).toBe('lolo')
        expect(keys(block.find('lo', 1))).toBe('lo')
        // A fragment that spans tokens matches inside a line, and spaces do not count.
        expect(keys(block.find('lo + hi'))).toBe('lo+hi')
        expect(keys(block.find('(lo+hi) / 2', 0))).toBe('(lo+hi)/2')
        expect(block.find('lo + hi', 1)).toEqual([])
        // A string and a comment hold spaces of their own. They do not count either, and a character outside the basic plane is one glyph.
        const quoted = codeBlock('print("a b") // 𝔹 or not')
        expect(keys(quoted.find('("a b")'))).toBe('("ab")')
        expect(keys(quoted.find('// 𝔹 or'))).toBe('//𝔹or')
        // A fragment does not match across two lines.
        expect(block.find('2 lo')).toEqual([])
        expect(block.find('  ')).toEqual([])
        expect(() => block.find('lo', 2)).toThrow('Code has no line 2.')
    })

    it('morphCode pairs tokens that survive an edit', async () => {
        let one!: ReturnType<typeof codeBlock>, two!: ReturnType<typeof codeBlock>
        const f = await compile((s) => {
            one = s.add(codeBlock('const a = 1\nreturn a', { size: 24 }))
            two = codeBlock('const a = 2\nconst b = a\nreturn b', { size: 24 })
            s.play(morphCode(one, two), { duration: 1 })
            s.wait(0.2)
        })
        expect(tokenize('const x = "s" // note').map((t) => t.kind).filter((k) => k !== 'space')).toEqual(['keyword', 'plain', 'punctuation', 'string', 'comment'])
        expect(paths(f, 1.1).length).toBe(two.chars.length + 1)
    })

    it('colors specification and proof languages, where a prime is not a quote', () => {
        const kinds = (source: string, language: string) => tokenize(source, language).filter((t) => t.kind !== 'space').map((t) => [t.text, t.kind])
        // TLA+: a prime marks the next state, `\in` is an operator word, and `\*` starts a comment.
        expect(kinds("Expire == /\\ lease' = \"free\" \\* any time", 'tla')).toEqual([
            ['Expire', 'type'], ['=', 'punctuation'], ['=', 'punctuation'], ['/', 'punctuation'], ['\\', 'punctuation'],
            ['lease', 'plain'], ["'", 'punctuation'], ['=', 'punctuation'], ['"free"', 'string'], ['\\* any time', 'comment'],
        ])
        expect(kinds('\\E c \\in Clients : UNCHANGED vars', 'tla+').filter(([, kind]) => kind === 'keyword').map(([text]) => text)).toEqual(['\\E', '\\in', 'UNCHANGED'])
        // A fairness prefix is a keyword, and the subscript after it is a name of its own.
        expect(kinds('WF_vars(Next)', 'tla').slice(0, 2)).toEqual([['WF_', 'keyword'], ['vars', 'function']])
        // A TLA+ block comment can end on a later line.
        expect(tokenize('(* a note\nmore *) x', 'tla').filter((t) => t.kind !== 'space').map((t) => [t.kind, t.line])).toEqual([['comment', 0], ['comment', 1], ['plain', 1]])
        // Dafny: contract words are keywords, and a character literal is a string.
        expect(kinds("invariant 0 <= lo // c == 'a'", 'dafny').map(([, kind]) => kind)).toEqual(['keyword', 'number', 'punctuation', 'punctuation', 'plain', 'comment'])
        expect(kinds("var c := 'a';", 'dafny')[4]).toEqual(["'a'", 'string'])
        // Lean: a prime is part of a name, `--` starts a comment, and a command starts with `#`.
        expect(kinds("theorem t (h' : a ≤ b) : True := by omega -- done", 'lean').filter(([, kind]) => kind !== 'punctuation')).toEqual([
            ['theorem', 'keyword'], ['t', 'function'], ["h'", 'plain'], ['a', 'plain'], ['b', 'plain'], ['True', 'type'], ['by', 'keyword'], ['omega', 'keyword'], ['-- done', 'comment'],
        ])
        expect(kinds('#print axioms t', 'lean4')[0]).toEqual(['#print', 'keyword'])
        // SMT-LIB: names hold hyphens, the head of a list is a function, and `#x` starts a number.
        expect(kinds('(assert (bvsle #x00000000 lo)) ; lower bound', 'smt2')).toEqual([
            ['(', 'punctuation'], ['assert', 'keyword'], ['(', 'punctuation'], ['bvsle', 'function'], ['#x00000000', 'number'], ['lo', 'plain'], [')', 'punctuation'], [')', 'punctuation'], ['; lower bound', 'comment'],
        ])
        expect(kinds('(declare-const lo (_ BitVec 32))', 'smt')[1]).toEqual(['declare-const', 'keyword'])
    })

    it('keeps a Rust lifetime out of a string, and reads block comments', () => {
        const kinds = (source: string, language: string) => tokenize(source, language).filter((t) => t.kind !== 'space').map((t) => [t.text, t.kind])
        expect(kinds("fn f<'a>(x: &'a str) -> char { 'x' }", 'rust').filter(([, kind]) => kind === 'string')).toEqual([["'x'", 'string']])
        expect(kinds('int mid = (low + high) / 2; /* overflows */', 'java').map(([, kind]) => kind)).toEqual(['keyword', 'plain', 'punctuation', 'punctuation', 'plain', 'punctuation', 'plain', 'punctuation', 'punctuation', 'number', 'punctuation', 'comment'])
        expect(CODE_LANGUAGES).toEqual(expect.arrayContaining(['ts', 'python', 'rust', 'go', 'java', 'c', 'sql', 'bash', 'tla', 'dafny', 'lean', 'smt', 'plain']))
        // An unknown language still falls back to TypeScript.
        expect(kinds('const x = 1', 'unknown')[0]).toEqual(['const', 'keyword'])
    })
})

describe('matrix', () => {
    it('looks up cells, rows, and columns and rejects bad indices', async () => {
        let m!: ReturnType<typeof matrix>
        await compile((s) => {
            m = s.add(matrix([[1, 2, 3], [4, 5, 6]], { size: 40 }))
        })
        expect(m.cell(1, 2).source).toBe('6')
        expect(m.row(0).map((c) => c.source)).toEqual(['1', '2', '3'])
        expect(m.col(1).map((c) => c.source)).toEqual(['2', '5'])
        expect(() => m.cell(5, 0)).toThrow(/2 by 3/)
    })

    it('stretches real brackets to about the height of the entries, with no gap in the bar', async () => {
        let m!: ReturnType<typeof matrix>
        await compile((s) => {
            m = s.add(matrix([[1], [2], [3], [4]], { size: 40 }))
        })
        const entries = m.entries.bounds()
        const bracket = m.brackets.children[0]!
        const box = bracket.bounds()
        expect(box.height).toBeGreaterThan(entries.height)
        expect(box.height).toBeLessThan(entries.height * 1.5)
        // Top, extender, and bottom pieces must overlap or touch along the height.
        const pieces = bracket.children.map((piece) => piece.bounds()).sort((a, b) => a.y - b.y)
        expect(pieces.length).toBeGreaterThanOrEqual(3)
        for (let i = 1; i < pieces.length; i++) {
            expect(pieces[i]!.y).toBeLessThanOrEqual(pieces[i - 1]!.y + pieces[i - 1]!.height + 0.5)
        }
    })

    it('setCell swaps in a new entry that later lookups return', async () => {
        let m!: ReturnType<typeof matrix>
        await compile((s) => {
            m = s.add(matrix([[1, 2]], { size: 40 }))
            s.play(m.setCell(0, 1, 9))
        })
        expect(m.cell(0, 1).source).toBe('9')
    })
})

describe('graph and tree layout', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id }))
    const links = [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }]
    const place = (g: ReturnType<typeof graph>) => nodes.map(({ id }) => [g.node(id).get('x'), g.node(id).get('y')])

    it('gives the same layout on every build', async () => {
        const results: number[][][] = []
        for (let i = 0; i < 2; i++) {
            await compile((s) => {
                const g = s.add(graph(nodes, links))
                results[i] = place(g)
            })
        }
        expect(results[0]).toEqual(results[1])
    })

    it('force layout repeats for a seed and changes with it', async () => {
        const run = async (seed: number) => {
            let out: number[][] = []
            await compile((s) => {
                out = place(s.add(graph(nodes, links, { layout: 'force', seed })))
            })
            return out
        }
        expect(await run(4)).toEqual(await run(4))
        expect(await run(4)).not.toEqual(await run(5))
    })

    it('centers tree parents over their children, and subtrees do not overlap', async () => {
        let t!: ReturnType<typeof tree>
        await compile((s) => {
            t = s.add(tree({ id: 'r', label: 'r', children: [
                { id: 'l', label: 'l', children: [{ id: 'l1' }, { id: 'l2' }] },
                { id: 'x', label: 'x', children: [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }] },
            ] }))
        })
        const x = (id: string) => t.node(id).get('x')
        expect(x('l')).toBeCloseTo((x('l1') + x('l2')) / 2, 6)
        expect(x('x')).toBeCloseTo(x('x2'), 6)
        expect(x('r')).toBeCloseTo((x('l') + x('x')) / 2, 6)
        expect(x('l2')).toBeLessThan(x('x1'))
    })

    it('rejects an edge to a missing node', async () => {
        await expect(compile((s) => {
            s.add(graph([{ id: 'a' }], [{ from: 'a', to: 'nope' }]))
        })).rejects.toThrow(/does not exist/)
    })

    it('moveNode re-routes attached edges to the new position', async () => {
        let g!: ReturnType<typeof graph>
        const f = await compile((s) => {
            g = s.add(graph([{ id: 'a', at: [-100, 0] }, { id: 'b', at: [100, 0] }], [{ from: 'a', to: 'b' }], { layout: 'manual' }))
            s.play(g.moveNode('b', [100, 200]), { duration: 1 })
        })
        const shaft = g.edge('a', 'b').shaft
        const end = at(1, () => pathBounds(shaft.get('path')!)!)
        expect(end.height).toBeGreaterThan(100)
        expect(f.duration).toBeCloseTo(1)
    })
})

describe('array cells', () => {
    it('follows items through swaps and lands them on the right slots', async () => {
        let arr!: ReturnType<typeof arrayCells>
        let first!: ReturnType<typeof arr.cell>
        const f = await compile((s) => {
            arr = s.add(arrayCells([1, 2, 3]))
            first = arr.cell(0)
            s.play(arr.swap(0, 2), { duration: 1 })
        })
        expect(arr.cell(2)).toBe(first)
        expect(at(f.duration, () => first.get('x'))).toBeCloseTo(arr.slotAt(2)[0], 6)
        // Halfway through, the item is lifted off the row on an arc.
        expect(at(0.5, () => first.get('y'))).toBeLessThan(-20)
    })
})

describe('calculus and series helpers', () => {
    it('riemann rectangles sum toward the integral as n grows', async () => {
        const area = (n: number) => {
            let total = 0
            const dx = 2 / n
            for (let i = 0; i < n; i++) total += ((i + 0.5) * dx) ** 2 * dx
            return total
        }
        let leafCount = 0
        await compile((s) => {
            const ax = s.add(axes({ x: [0, 2], y: [0, 4] }))
            leafCount = riemann(ax, (x) => x * x, { from: 0, to: 2, n: 8 }).children.length
        })
        expect(leafCount).toBe(8)
        expect(area(200)).toBeCloseTo(8 / 3, 3)
    })

    it('fourier reconstructs a closed outline', () => {
        const outline = samplePath(circlePath(30, -10, 100), 128)
        const terms = fourier(outline)
        for (const u of [0, 0.25, 0.61]) {
            const [x, y] = fourierPoint(terms, u)
            const expected = outline[Math.round(u * 128)]!
            expect(Math.hypot(x - expected[0], y - expected[1])).toBeLessThan(1)
        }
        // A circle is almost all one term, plus its center.
        const strongest = fourier(outline, { terms: 2 }).map((term) => term.freq).sort((a, b) => a - b)
        expect(strongest).toEqual([0, 1])
    })

    it('traced scrubs the same in both directions and respects its tail', async () => {
        const f = await compile((s) => {
            const u = s.value(0)
            s.add(traced(() => [u.value * 100, 0], 0, 10, { tail: 1, fade: 1 }))
            s.play(u.to(5, { duration: 5, ease: linear }))
        })
        const later = paths(f, 4)
        const early = paths(f, 2)
        const again = paths(f, 4)
        expect(pathToD(again[0]!.path)).toBe(pathToD(later[0]!.path))
        const width = pathBounds(later[0]!.path)!.width
        expect(width).toBeGreaterThan(95)
        expect(width).toBeLessThan(105)
        expect(pathBounds(early[0]!.path)!.x).toBeLessThan(pathBounds(later[0]!.path)!.x)
    })
})

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

describe('system objects', () => {
    it('connector re-routes while a node moves, and draws through the standard verb', async () => {
        let box!: ReturnType<typeof infoBox>
        let link!: ReturnType<typeof connector>
        const f = await compile((s) => {
            const a = s.add(infoBox({ title: 'A', rows: [{ label: 'x', value: '1' }] }).at(-300, 0))
            box = s.add(infoBox({ title: 'B' }).at(300, 0))
            link = s.add(connector(a, box))
            s.play(draw(link), { duration: 1 })
            s.play(to(box, (b) => b.shift(0, 200)), { duration: 1 })
        })
        const endY = (t: number) => at(t, () => link.pointNow(1)[1])
        expect(Math.abs(endY(2) - endY(1))).toBeGreaterThan(190)
        // The first moment of drawing shows no shaft yet, and the end shows all of it.
        const inkWidth = (t: number) => Math.max(0, ...paths(f, t).filter((op) => op.stroke && !op.fill).map((op) => pathBounds(op.path)?.width ?? 0))
        expect(inkWidth(0)).toBeLessThan(100)
        expect(inkWidth(1)).toBeGreaterThan(300)
    })

    it('connector label keeps a plate under the text, so the line does not cross it', async () => {
        const f = await compile((s) => {
            const a = s.add(rect(100, 60, { stroke: 'ink' }).at(-300, 0))
            const b = s.add(rect(100, 60, { stroke: 'ink' }).at(300, 0))
            s.add(connector(a, b, { label: 'publish', labelBackground: '#112233' }))
        })
        const ops = paths(f, 0)
        const plateIndex = ops.findIndex((op) => op.fill && (op.fill as readonly number[])[0] === 0x11)
        expect(plateIndex).toBeGreaterThan(-1)
        const lineIndex = ops.findIndex((op) => op.stroke && !op.fill && (pathBounds(op.path)?.width ?? 0) > 100)
        expect(lineIndex).toBeLessThan(plateIndex)
    })

    it('infoBox grows to fit its text and exposes ports on its edges', async () => {
        let box!: ReturnType<typeof infoBox>
        await compile((s) => {
            box = s.add(infoBox({ title: 'A very long service name that needs room', rows: [{ label: 'k', value: 'v', meter: 0.5, spark: [1, 2, 3] }], tags: ['one'], size: 14 }).at(100, 100))
        })
        expect(box.boxWidth).toBeGreaterThan(250)
        const right = box.port('right')
        expect(right[0]).toBeCloseTo(100 + box.boxWidth / 2, 3)
        const bounds = box.bounds()
        for (const label of [box.titleNode, ...box.rowLabels]) {
            const b = label.bounds()
            expect(b.x).toBeGreaterThanOrEqual(bounds.x)
            expect(b.x + b.width).toBeLessThanOrEqual(bounds.x + bounds.width)
        }
    })

    it('callout leader stops at the text block and never runs through it', async () => {
        let note!: ReturnType<typeof callout>
        await compile((s) => {
            note = s.add(callout([0, 0], 'A note about something with enough words to wrap across more than one line.', { title: 'Note', side: 'right', width: 200 }))
        })
        const leader = note.leader.bounds(), body = note.body.bounds()
        expect(leader.x + leader.width).toBeLessThanOrEqual(body.x)
    })

    it('legend lays items in a row without overlap', async () => {
        const made: { items: ReturnType<typeof legend> } = { items: null as never }
        await compile((s) => {
            made.items = s.add(legend([{ label: 'one' }, { label: 'two', kind: 'line' }, { label: 'three', kind: 'dot' }]))
        })
        const boxes = made.items.children.map((child) => child.bounds())
        for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.x).toBeGreaterThan(boxes[i - 1]!.x + boxes[i - 1]!.width)
    })
})

describe('3D', () => {
    it('draws far faces before near ones', async () => {
        const f = await compile((s) => {
            const scene = s.add(scene3d({ phi: Math.PI / 2, theta: 0, perspective: false, unit: 100, fog: 0 }))
            scene.add(point3d([-3, 0, 0], { color: '#ff0000', radius: 20 }))
            scene.add(point3d([3, 0, 0], { color: '#00ff00', radius: 20 }))
        })
        const fills = paths(f, 0).map((op) => (op.fill as readonly number[])[0])
        // The camera sits on +x, so the point at x = 3 is nearest and draws last.
        expect(fills).toEqual([255, 0])
    })

    it('culls the far side of a sphere from any angle', async () => {
        const count = async (theta: number) => {
            const f = await compile((s) => {
                const scene = s.add(scene3d({ phi: 1.1, theta, unit: 100 }))
                scene.add(sphere(2, { resolution: [32, 16], color: 'blue' }))
            })
            return paths(f, 0).length
        }
        const total = 32 * 16
        for (const theta of [0, 1.3, 2.9]) {
            const shown = await count(theta)
            expect(shown).toBeGreaterThan(total * 0.3)
            expect(shown).toBeLessThan(total * 0.7)
        }
    })

    it('animates the camera on the timeline and spins from where it is told', async () => {
        const f = await compile((s) => {
            const scene = s.add(scene3d({ phi: 1, theta: 0, unit: 100, fog: 0 }))
            scene.add(points3d([[1, 0, 0]], { color: '#ffffff' }))
            s.wait(1)
            scene.spin(1)
            s.wait(1)
            scene.stopSpin()
            s.wait(1)
        })
        const box = (t: number) => pathBounds(paths(f, t)[0]!.path)!
        expect(box(0).x).toBeCloseTo(box(1).x, 6)
        expect(box(2).x).not.toBeCloseTo(box(1).x, 1)
        expect(box(3).x).toBeCloseTo(box(2).x, 6)
    })

    it('reveals a mesh row by row through the standard draw verb', async () => {
        const f = await compile((s) => {
            const scene = s.add(scene3d({ unit: 50 }))
            const mesh = scene.add(surface((x, y) => x * y * 0.1, { resolution: 10, colors: ['blue', 'yellow'] }))
            s.play(draw(mesh), { duration: 1, ease: linear })
        })
        expect(paths(f, 0).length).toBe(0)
        expect(paths(f, 0.5).length).toBeGreaterThan(30)
        expect(paths(f, 1).length).toBe(100)
    })

    it('draws 2500 faces cheaply', async () => {
        const f = await compile((s) => {
            const scene = s.add(scene3d({ unit: 80 }))
            scene.add(surface((x, y, t) => Math.sin(x + t) * Math.cos(y), { resolution: 50, animate: true }))
            scene.add(axes3d())
            scene.add(curve3d((t) => [Math.cos(t), Math.sin(t), t / 4], 0, 12, { color: 'red' }))
            scene.add(vector3d([0, 0, 0], [1, 1, 1]))
            s.wait(2)
        })
        expect(paths(f, 1).length).toBeGreaterThanOrEqual(2500)
        const start = performance.now()
        for (let i = 0; i < 20; i++) f.frame(i / 10)
        // Well under one frame at 60 fps even on a busy machine: this is draw-list building only.
        expect((performance.now() - start) / 20).toBeLessThan(16)
    })
})

describe('fromSvg', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#ff0000"/><stop offset="100%" stop-color="#0000ff"/></linearGradient>
      <clipPath id="c"><rect width="1" height="1"/></clipPath></defs>
      <style>.k { stroke: #00ff00; stroke-width: 4; fill: none }</style>
      <rect width="200" height="100" fill="#123456"/>
      <g id="group" transform="translate(50 50)" opacity="0.5">
        <circle id="dot" r="10" fill="url(#g)"/>
        <rect id="box" x="20" y="-5" width="30" height="10" class="k"/>
        <path id="stroked" d="M0 0 L10 0" stroke="#ffffff" stroke-width="2"/>
      </g>
      <polygon id="tri" points="0,0 10,0 5,10" fill="rgba(255,0,0,0.5)"/>
      <line id="ln" x1="0" y1="90" x2="100" y2="90" stroke="#fff" stroke-dasharray="4 2"/>
    </svg>`

    const load = async () => {
        let out!: ReturnType<typeof fromSvg>
        const f = await compile((s) => {
            out = s.add(fromSvg(svg))
        })
        return { out, f }
    }

    it('applies transforms, centers on the viewBox, and drops the backdrop', async () => {
        const { out } = await load()
        const dot = out.find('dot').bounds()
        // The circle sits at (50, 50) in a 200 by 100 box, so it lands 50 left of center.
        expect(dot.x + dot.width / 2).toBeCloseTo(-50, 6)
        expect(dot.y + dot.height / 2).toBeCloseTo(0, 6)
        expect(dot.width).toBeCloseTo(20, 6)
        const count = out.leaves().length
        expect(count).toBe(5)
    })

    it('reads classes, gradients, opacity, and dashes', async () => {
        const { out } = await load()
        expect(out.find('box').get('strokeWidth')).toBe(4)
        expect(out.find('box').get('fill')).toBeNull()
        const gradient = out.find('dot').get('fill') as unknown as { type: string; stops: unknown[] }
        expect(gradient.type).toBe('linear')
        expect(gradient.stops).toHaveLength(2)
        expect(out.find('group').get('opacity')).toBe(0.5)
        expect(out.find('ln').get('dash')).toEqual([4, 2])
        expect(() => out.find('nope')).toThrow(/no element/)
    })

    it('fits to a requested size', async () => {
        let out!: ReturnType<typeof fromSvg>
        await compile((s) => {
            out = s.add(fromSvg(svg, { width: 400 }))
        })
        expect(out.pictureWidth).toBe(400)
        expect(out.pictureHeight).toBe(200)
        expect(out.find('dot').bounds().width).toBeCloseTo(40, 6)
    })

    it('splits compound outlines into glyphs and keeps holes with their letter', () => {
        const outer = 'M0 0H10V10H0Z M3 3H7V7H3Z'
        const separate = 'M20 0H30V10H20Z'
        const out = fromSvg(`<svg viewBox="0 0 40 10" width="40" height="10"><path id="t" d="${outer} ${separate}" fill="#fff"/></svg>`)
        const leaves = out.leaves()
        expect(leaves).toHaveLength(2)
        expect(leaves[0]!.get('path')!).toHaveLength(2)
        expect(leaves[1]!.get('path')!).toHaveLength(1)
    })

    it('throws a clear error for input without an svg element', () => {
        expect(() => fromSvg('<div/>')).toThrow(/<svg>/)
    })
})

describe('fromComponent', () => {
    it('turns a TSX component into vector nodes that animate like anything else', async () => {
        const c = getThemeColors('dark')
        const element = createElement(Row, { c, gap: 16 } as never,
            createElement(StepCard, { c, title: 'Parse', subtitle: 'tokens', tone: 'blue' } as never),
            createElement(CalloutCard, { c, title: 'Note', detail: 'detail' } as never))
        const node = await fromComponent(element, { width: 700, height: 160 })
        const leaves = node.leaves()
        expect(leaves.length).toBeGreaterThan(5)
        const f = await compile((s) => {
            s.play(write(node), { duration: 1 })
        })
        expect(paths(f, 1).length).toBeGreaterThan(5)
        expect(svgAt(f, 0.5)).not.toBe(svgAt(f, 1))
    })
})

describe('extra verbs', () => {
    it('typewriter reveals one glyph at a time', async () => {
        const f = await compile((s) => {
            const line = s.add(text('abcd', { font: 'mono', size: 30 }))
            s.play(typewriter(line, { duration: 1, ease: linear }))
        })
        expect(paths(f, 0).length).toBeLessThanOrEqual(1)
        expect(paths(f, 0.3).length).toBe(2)
        expect(paths(f, 1).length).toBe(4)
    })

    it('wipe reveals along the requested direction', async () => {
        let row!: ReturnType<typeof group>
        const f = await compile((s) => {
            row = s.add(group(rect(10, 10, { fill: 'red', stroke: null }).at(-200, 0), rect(10, 10, { fill: 'red', stroke: null }).at(200, 0)))
            s.play(wipe(row, { from: 'left', soft: 0.2 }), { duration: 1, ease: linear })
        })
        const shown = (t: number) => paths(f, t).map((op) => pathBounds(op.path)!.x)
        expect(shown(0.1).length).toBe(1)
        expect(shown(0.1)[0]!).toBeLessThan(960)
        expect(shown(1).length).toBe(2)
    })

    it('countUp ends exactly on the target', async () => {
        let readout!: ReturnType<typeof counter>
        const f = await compile((s) => {
            readout = s.add(counter(0))
            s.play(countUp(readout, 1234), { duration: 1 })
        })
        expect(at(f.duration, () => readout.value.value)).toBe(1234)
    })

    it('spin turns at the given rate, around the center', async () => {
        let box!: ReturnType<typeof rect>
        await compile((s) => {
            box = s.add(rect(100, 40, { stroke: 'ink' }).at(50, 50))
            s.play(spin(box, Math.PI, { duration: 2 }))
        })
        expect(at(2, () => box.get('rotation'))).toBeCloseTo(Math.PI * 2, 6)
        const center = at(1, () => box.center)
        expect(center[0]).toBeCloseTo(50, 3)
        expect(center[1]).toBeCloseTo(50, 3)
    })

    it('swap exchanges centers', async () => {
        let a!: ReturnType<typeof rect>, b!: ReturnType<typeof rect>
        await compile((s) => {
            a = s.add(rect(40, 40, { stroke: 'ink' }).at(-100, 10))
            b = s.add(rect(40, 40, { stroke: 'ink' }).at(100, -10))
            s.play(swap(a, b), { duration: 1 })
        })
        expect(at(1, () => a.center)[0]).toBeCloseTo(100, 6)
        expect(at(1, () => b.center)[1]).toBeCloseTo(10, 6)
    })

    it('highlightSweep paints behind its target and widens over time', async () => {
        let mark!: ReturnType<typeof rect>
        const f = await compile((s) => {
            const label = s.add(text('note', { size: 40 }))
            const sweep = highlightSweep(label, { duration: 1 })
            mark = sweep.mark
            s.play(sweep, { ease: linear })
        })
        const first = paths(f, 1)[0]!
        expect(first.fill).toBeTruthy()
        expect(pathBounds(mark.get('path') ?? [])).toBeTruthy()
        const widthAt = (t: number) => pathBounds(paths(f, t)[0]!.path)!.width
        expect(widthAt(0.5)).toBeLessThan(widthAt(1))
    })
})

describe('marks and small objects', () => {
    it('labels and brace sit beside their targets, not on them', async () => {
        let target!: ReturnType<typeof rect>, brace!: ReturnType<typeof braceLabel>
        await compile((s) => {
            target = s.add(rect(200, 100, { stroke: 'ink' }))
            brace = s.add(braceLabel(target, 'w', { side: 'bottom' }))
        })
        expect(brace.bounds().y).toBeGreaterThan(target.bounds().y + target.bounds().height)
    })

    it('surroundingBox wraps several nodes with padding', async () => {
        let box!: ReturnType<typeof rect>
        await compile((s) => {
            const a = s.add(rect(10, 10, { stroke: 'ink' }).at(-100, 0)), b = s.add(rect(10, 10, { stroke: 'ink' }).at(100, 0))
            box = s.add(surroundingBox([a, b], { pad: 20 }))
        })
        expect(box.bounds().width).toBeCloseTo(250, 6)
    })

    it('angleMark takes the short way by default, and the long way when asked', async () => {
        const size = async (reflex: boolean) => {
            let mark!: ReturnType<typeof angleMark>
            await compile((s) => {
                mark = s.add(angleMark([0, 0], [100, 0], [0, 100], { radius: 50, reflex }))
            })
            return mark.bounds()
        }
        const short = await size(false)
        expect(short.width).toBeCloseTo(50, 3)
        const long = await size(true)
        expect(long.width).toBeCloseTo(100, 3)
    })

    it('rightAngle, labeledDot, numberLine, and tokens build with their parts', async () => {
        await compile((s) => {
            s.add(rightAngle([0, 0], [10, 0], [0, 10]))
            const d = s.add(labeledDot('A').at(10, 10))
            expect(d.mark.center[0]).toBeCloseTo(10, 6)
            const nl = s.add(numberLine({ range: [0, 10], length: 500 }))
            expect(nl.p(5)[0]).toBe(0)
            expect(nl.p(10)[0]).toBe(250)
            const row = s.add(tokens(['a', { text: 'b', sub: '12' }], { maxWidth: 400 }))
            expect(row.token(1).bounds().x).toBeGreaterThan(row.token(0).bounds().x)
            expect(() => row.token(9)).toThrow(/no token/)
            const att = s.add(attentionMatrix(['a', 'b'], ['c', 'd'], [[0.5, 0.5], [0, 1]]))
            expect(att.rowLabels).toHaveLength(2)
            const net = s.add(neuralNet([2, 20, 2], { collapse: 6 }))
            expect(net.layer(1)).toHaveLength(6)
            const chart = s.add(lineChart([{ name: 'a', values: [1, 2, 3] }]))
            expect(() => chart.series('nope')).toThrow(/No series/)
            const points = s.add(scatter([{ x: 0, y: 0, group: 'g' }, { x: 1, y: 1, group: 'g' }]))
            expect(points.groupLabels).toHaveLength(1)
            s.add(donut([{ label: 'a', value: 1 }]))
            s.play(lagged([fadeIn(d)], { lag: 0 }))
        })
    })

    it('needs a compile to load assets, and says so through Suspend', () => {
        // Fonts or layout may already be loaded by earlier tests, so accept either result.
        try {
            text('x')
        } catch (error) {
            expect(error).toBeInstanceOf(Suspend)
        }
        expect(parseSvgPath('M0 0L10 0').length).toBe(1)
        expect(dynamic(() => null).draw).toBeTruthy()
        expect(line([0, 0], [1, 1]).get('path')).toBeTruthy()
    })
})

describe('clone', () => {
    it('gives the copy of an object its own parts', async () => {
        await compileFilm(film(() => {
            const word = text('ab', { size: 60 })
            const copy = word.clone()
            expect(copy.chars).toHaveLength(2)
            expect(copy.chars[0]).not.toBe(word.chars[0])
            expect(copy.chars[0]!.parent).toBe(copy)
            const box = card({ title: 'Logs', figure: rect(80, 80), caption: 'one line per event' })
            const twin = box.clone()
            for (const part of ['frame', 'title', 'figure', 'caption'] as const) {
                expect(twin[part], part).not.toBe(box[part])
                expect(twin.children).toContain(twin[part])
            }
            // A field that points outside the object keeps its target.
            const outside = rect(10, 10), holder = group(rect(20, 20)) as Node & { friend?: Node }
            holder.friend = outside
            expect((holder.clone() as typeof holder).friend).toBe(outside)
        }))
    })
})

describe('pictograms', () => {
    const SIZE = 96

    it('keeps every mark of every picture inside its square', () => {
        expect(PICTOGRAMS.length).toBeGreaterThan(40)
        for (const name of PICTOGRAMS) {
            const picture = pictogram(name, { size: SIZE })
            expect(picture.children.length, name).toBeGreaterThan(0)
            for (const mark of picture.children) {
                const reach = mark.get('stroke') ? mark.get('strokeWidth') / 2 : 0
                const box = pathBounds(mark.get('path')!)!
                expect(Math.min(box.x, box.y) - reach, name).toBeGreaterThanOrEqual(-SIZE / 2)
                expect(Math.max(box.x + box.width, box.y + box.height) + reach, name).toBeLessThanOrEqual(SIZE / 2)
            }
        }
    })

    it('paints the accent in every picture, and leaves the other lines in the color when there are some', () => {
        const paint = (mark: Node) => JSON.stringify(mark.get('stroke') ?? mark.get('fill'))
        for (const name of PICTOGRAMS) {
            const plain = new Set(pictogram(name, { color: 'ink' }).children.map(paint))
            const accented = new Set(pictogram(name, { color: 'ink', accent: 'teal' }).children.map(paint))
            expect(plain.size, name).toBe(1)
            expect([...accented].some((value) => !plain.has(value)), name).toBe(true)
        }
        expect(new Set(pictogram('forecast', { color: 'ink', accent: 'teal' }).children.map(paint)).size).toBe(2)
    })

    it('rejects a name it does not know, also when an object has a property of that name', () => {
        expect(() => pictogram('unicorn' as never)).toThrow(/unknown name "unicorn"/)
        expect(() => pictogram('toString' as never)).toThrow(/unknown name "toString"/)
    })
})

describe('card', () => {
    const middle = (node: Node) => { const box = node.bounds(); return [box.x + box.width / 2, box.y + box.height / 2] as const }

    it('scales a large figure into the space between the title and the caption, and leaves a small one alone', async () => {
        await compileFilm(film(() => {
            const made = card({ title: 'Logs', figure: rect(900, 600), caption: 'one line per event', width: 400, height: 360 })
            const area = made.figureBox, drawn = made.figure!.bounds()
            expect(drawn.height).toBeCloseTo(area.height, 3)
            expect(drawn.width).toBeLessThan(area.width)
            expect(drawn.width / drawn.height).toBeCloseTo(900 / 600, 6)
            expect(middle(made.figure!)[0]).toBeCloseTo(0, 3)
            expect(middle(made.figure!)[1]).toBeCloseTo(area.y + area.height / 2, 3)
            const title = made.title!.bounds(), caption = made.caption!.bounds()
            expect(area.y - (title.y + title.height)).toBeGreaterThan(14)
            expect(caption.y - (area.y + area.height)).toBeGreaterThan(14)
            expect(card({ figure: rect(50, 30), width: 400, height: 360 }).figure!.bounds()).toMatchObject({ width: 50, height: 30 })
        }))
    })

    it('fits and centers a figure that has no height, or that was built away from the origin', async () => {
        await compileFilm(film(() => {
            const flat = card({ figure: line([-450, 0], [450, 0]), width: 400, height: 300 })
            expect(flat.figure!.bounds().width).toBeCloseTo(flat.figureBox.width, 3)
            expect(middle(flat.figure!)[0]).toBeCloseTo(0, 3)
            const far = card({ title: 'Far', figure: circle(40).at(700, -300), width: 400, height: 300 })
            expect(middle(far.figure!)[0]).toBeCloseTo(0, 3)
            expect(middle(far.figure!)[1]).toBeCloseTo(far.figureBox.y + far.figureBox.height / 2, 3)
        }))
    })

    it('gives the cards of a row one layout, also when one caption has more lines', async () => {
        await compileFilm(film(() => {
            const row = { width: 420, height: 400, captionLines: 2 }
            const a = card({ title: 'DATA', figure: rect(300, 90), caption: 'every type', ...row })
            const b = card({ title: 'Feedback loop', figure: circle(70), caption: 'the path of one request through the services', ...row })
            expect(b.caption!.bounds().height).toBeGreaterThan(a.caption!.bounds().height * 1.5)
            expect(b.title!.get('y')).toBe(a.title!.get('y'))
            expect(b.figureBox).toEqual(a.figureBox)
            expect(middle(b.figure!)[1]).toBeCloseTo(middle(a.figure!)[1], 3)
            // The first line of both captions is at one height. A block is placed by the middle of its lines.
            const lineHeight = 1.25 * 40 * 0.72
            expect(b.caption!.get('y') - lineHeight / 2).toBeCloseTo(a.caption!.get('y'), 6)
        }))
    })

    it('wraps a long caption, sets a wide title smaller, and grows to hold both', async () => {
        await compileFilm(film(() => {
            const made = card({ title: 'A title a bit long', caption: 'a caption that is long enough to wrap onto more lines', figure: rect(100, 100), width: 300 })
            const frame = made.frame.bounds()
            expect(frame.width).toBe(300)
            for (const part of [made.title!, made.caption!, made.figure!]) {
                const box = part.bounds()
                expect(box.x).toBeGreaterThan(frame.x + 20)
                expect(box.x + box.width).toBeLessThan(frame.x + frame.width - 20)
                expect(box.y).toBeGreaterThan(frame.y + 20)
                expect(box.y + box.height).toBeLessThan(frame.y + frame.height - 14)
            }
            expect(made.caption!.bounds().height).toBeGreaterThan(60)
            expect(made.figure!.bounds().width).toBeCloseTo(100, 6)
            expect(made.title!.data['size']).toBeLessThan(40)
            expect(made.title!.data['size']).toBeGreaterThanOrEqual(24)
        }))
    })

    it('refuses content that cannot fit, and a figure that is in use', async () => {
        await compileFilm(film((s) => {
            expect(() => card({ title: 'Logs', figure: rect(100, 100), caption: 'one line per event', height: 150 })).toThrow(/no room for the figure/)
            expect(() => card({ title: 'Logs', caption: 'one line per event', height: 70 })).toThrow(/no room for the title and the caption/)
            expect(() => card({ title: 'A title that is far too long for a card this narrow', width: 240 })).toThrow(/title .* is too long/)
            expect(() => card({ caption: 'Pneumonoultramicroscopicsilicovolcanoconiosis', width: 240 })).toThrow(/a word of the caption/)
            const used = s.add(rect(100, 100))
            expect(() => card({ figure: used })).toThrow(/already on the stage or in a group/)
        }))
    })
})

describe('zone', () => {
    type Box = { x: number; y: number; width: number; height: number }
    const inside = (outer: Box, inner: Box, room: number) =>
        inner.x - outer.x >= room && inner.y - outer.y >= room
        && outer.x + outer.width - inner.x - inner.width >= room && outer.y + outer.height - inner.y - inner.height >= room
    /** The border in stage coordinates. `box` is in the coordinates of the zone, and a new zone is not scaled. */
    const border = (made: ReturnType<typeof zone>): Box => ({ ...made.box, x: made.box.x + made.get('x'), y: made.box.y + made.get('y') })

    it('puts a border around its content where the content was built, and around a zone inside it with that title', async () => {
        await compileFilm(film(() => {
            const a = rect(200, 80).at(300, -100), b = circle(40).at(520, 60)
            const before = a.bounds()
            const inner = zone([a, b], { title: 'inner', padding: 30 })
            expect(a.bounds().x).toBeCloseTo(before.x, 6)
            expect(a.bounds().y).toBeCloseTo(before.y, 6)
            expect(inside(border(inner), a.bounds(), 30)).toBe(true)
            expect(inside(border(inner), b.bounds(), 30)).toBe(true)
            // The title straddles the top border, so the zone is taller than its border.
            expect(inner.bounds().y).toBeLessThan(border(inner).y)
            const outer = zone(inner, { title: 'outer', padding: 24 })
            expect(inside(border(outer), inner.bounds(), 24)).toBe(true)
            // An empty group has no place, so it does not pull the border toward the origin.
            expect(border(zone([rect(200, 80).at(500, 300), group()], { padding: 32 })).x).toBeCloseTo(368, 6)
        }))
    })

    it('leaves a gap in the border for the title, and no line crosses the title', async () => {
        await compileFilm(film(() => {
            for (const titleAlign of ['left', 'center', 'right'] as const) {
                const made = zone(rect(500, 200), { title: 'the title', titleAlign })
                const title = made.title!.bounds(), top = border(made).y
                expect(title.y).toBeLessThan(top)
                expect(title.y + title.height).toBeGreaterThan(top)
                // The top border is the only part of the frame at that height. Its ends are on both sides of the title.
                const points = made.frame.get('path')![0]!.p
                const start = points[0]! + made.get('x'), end = points[points.length - 2]! + made.get('x')
                expect(end).toBeLessThan(title.x - 4)
                expect(start).toBeGreaterThan(title.x + title.width + 4)
            }
        }))
    })

    it('places its middle with at, grows for a long title, keeps a least size, and survives a large radius', async () => {
        await compileFilm(film(() => {
            const made = zone(circle(20), { title: 'a title much longer than a dot', minHeight: 300 })
            const title = made.title!.bounds()
            expect(title.x).toBeGreaterThan(border(made).x + 16)
            expect(title.x + title.width).toBeLessThan(border(made).x + made.box.width - 16)
            expect(made.box.height).toBe(300)
            made.at(400, -200)
            expect(border(made).x + made.box.width / 2).toBeCloseTo(400, 6)
            expect(border(made).y + made.box.height / 2).toBeCloseTo(-200, 6)
            expect(zone(rect(200, 80), { title: 'a', radius: 999 }).box.width).toBeLessThan(400)
        }))
    })

    it('refuses no content, and content that is in use', async () => {
        await compileFilm(film((s) => {
            expect(() => zone([])).toThrow(/at least one node/)
            const used = s.add(rect(100, 100))
            expect(() => zone([rect(10, 10), used])).toThrow(/node 1 of the content is already on the stage or in a group/)
        }))
    })
})

describe('dot chart', () => {
    const data = [
        { label: 'blocks', value: 0.89, low: 0.87, high: 0.91 },
        { label: 'a much longer label', value: 0.57, low: 0.54, high: 0.6 },
        { label: 'ring', value: 0.25, hollow: true },
    ]
    const middle = (node: Node) => { const box = node.bounds(); return [box.x + box.width / 2, box.y + box.height / 2] as const }
    const words = (chart: ReturnType<typeof dotChart>) => chart.axis.children.map((node) => (node as unknown as { source?: string }).source).filter(Boolean)

    it('puts each dot at its value on an axis that need not start at zero, with its interval around it', async () => {
        await compileFilm(film(() => {
            const chart = dotChart(data, { width: 1000, height: 300, domain: [0.2, 1], ticks: [0.2, 0.6, 1] })
            // The plot is centered: the two ends of the domain are the two ends of the width.
            expect(chart.p(0.2, 0)[0]).toBeCloseTo(-500, 6)
            expect(chart.p(1, 0)[0]).toBeCloseTo(500, 6)
            expect(chart.p(0.6, 1)[0]).toBeCloseTo(0, 6)
            expect(chart.p(0.6, 1)[1]).toBeCloseTo(0, 6)
            chart.dots.forEach((mark, row) => {
                expect(middle(mark)[0]).toBeCloseTo(chart.p(data[row]!.value, row)[0], 6)
                expect(middle(mark)[1]).toBeCloseTo(chart.p(0, row)[1], 6)
            })
            const interval = chart.intervals[0]!.bounds()
            expect(interval.x).toBeCloseTo(chart.p(0.87, 0)[0], 6)
            expect(interval.x + interval.width).toBeCloseTo(chart.p(0.91, 0)[0], 6)
            // The caps are taller than the dot, so a narrow interval is not hidden by it.
            expect(interval.height).toBeGreaterThan(chart.dots[0]!.bounds().height * 1.3)
            expect(chart.intervals[2]).toBeNull()
            // Labels end at one x, before the axis starts.
            const ends = chart.labels.map((label) => label.bounds().x + label.bounds().width)
            expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(6)
            expect(Math.max(...ends)).toBeLessThan(-500 - 8)
            // A ring keeps the background inside it. A dot is filled with its color.
            expect(chart.dots[2]!.get('stroke')).not.toBeNull()
            expect(chart.dots[2]!.get('fill')).not.toEqual(chart.dots[2]!.get('stroke'))
            expect(chart.dots[0]!.get('stroke')).toBeNull()
        }))
    })

    it('takes its default axis from the data, and its ticks from the domain', async () => {
        await compileFilm(film(() => {
            // The range of the data is 0.25 to 0.91. The axis covers a round range around it.
            const plain = dotChart(data)
            expect(plain.domain).toEqual([0.2, 1])
            expect(words(plain)).toEqual(['0.2', '0.4', '0.6', '0.8', '1.0'])
            // Ticks come from the domain, not from the data, and none is past an end of the axis.
            const one = dotChart([{ label: 'a', value: 0.5 }], { domain: [0, 1], width: 1000 })
            expect(words(one)).toEqual(['0.0', '0.2', '0.4', '0.6', '0.8', '1.0'])
            expect(one.bounds().x + one.bounds().width).toBeLessThan(500 + 30)
            expect(words(dotChart(data, { domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1] }))).toEqual(['0.00', '0.25', '0.50', '0.75', '1.00'])
            expect(words(dotChart([{ label: 'a', value: 30 }, { label: 'b', value: 70 }], { ticks: [0, 50, 100] }))).toEqual(['0', '50', '100'])
        }))
    })

    it('enters with nothing on screen at the start, and all rows at the end', async () => {
        let chart!: ReturnType<typeof dotChart>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            chart = dotChart(data, { domain: [0, 1] })
            s.wait(0.5)
            s.play(chart.enter(), { duration: 1 })
            s.wait(0.5)
        }))
        const opacity = (time: number, node: Node) => { clock.now = time; return node.get('opacity') * (node.get('visible') ? 1 : 0) }
        expect((await compiled.frame(0.2)).ops).toHaveLength(0)
        expect(opacity(0.55, chart.rows[2]!)).toBe(0)
        for (const row of chart.rows) expect(opacity(1.9, row)).toBe(1)
        expect(opacity(1.9, chart.axis)).toBe(1)
    })

    it('copies its intervals with the gaps when it is cloned', async () => {
        await compileFilm(film(() => {
            const chart = dotChart(data, { domain: [0, 1] }), copy = chart.clone()
            expect(copy.intervals).not.toBe(chart.intervals)
            expect(copy.intervals[2]).toBeNull()
            expect(copy.intervals[0]).not.toBe(chart.intervals[0])
            expect(copy.rows[0]!.children).toContain(copy.intervals[0])
        }))
    })

    it('refuses data that it cannot draw truly', async () => {
        await compileFilm(film(() => {
            expect(() => dotChart([])).toThrow(/at least one item/)
            expect(() => dotChart([{ label: 'a', value: 2 }], { domain: [0, 1] })).toThrow(/2 is outside the domain 0 to 1/)
            expect(() => dotChart([{ label: 'a', value: NaN }], { domain: [0, 1] })).toThrow(/not a number/)
            expect(() => dotChart([{ label: 'a', value: 0.5, low: 0.4 }])).toThrow(/one end of an interval/)
            expect(() => dotChart([{ label: 'a', value: 0.5, low: 0.6, high: 0.7 }])).toThrow(/outside its interval/)
            expect(() => dotChart([{ label: 'a', value: 0.5 }], { domain: [0, 1], ticks: [0, 2] })).toThrow(/the tick 2 is outside the domain/)
            expect(() => dotChart([{ label: 'a', value: 0.5 }], { domain: [1, 0] })).toThrow(/two different ends/)
        }))
    })
})

describe('unit chart', () => {
    const groups = [{ count: 20, label: 'no effect' }, { count: 7, color: 'green', label: 'better' }, { count: 3, color: 'red', label: 'worse' }]
    const middle = (node: Node) => { const box = node.bounds(); return [box.x + box.width / 2, box.y + box.height / 2] as const }
    const key = (place: readonly [number, number]) => `${place[0].toFixed(3)},${place[1].toFixed(3)}`
    const at = <T,>(time: number, read: () => T): T => { clock.now = time; return read() }
    const xy = (node: Node) => [node.get('x'), node.get('y')]
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)

    it('draws one mark for each unit, fills by column or by row, and stays centered', async () => {
        await compileFilm(film(() => {
            const byColumn = unitChart(groups, { rows: 5, cell: 10, gap: 10 })
            expect(byColumn.marks).toHaveLength(30)
            expect(byColumn.groups.map((own) => own.length)).toEqual([20, 7, 3])
            // 30 marks in columns of 5: six columns, 20 px apart. The first column goes down from the top left.
            expect(middle(byColumn.marks[0]!)).toEqual([-50, -40])
            expect(middle(byColumn.marks[4]!)).toEqual([-50, 40])
            expect(middle(byColumn.marks[5]!)).toEqual([-30, -40])
            expect(byColumn.p(29)).toEqual([50, 40])
            // The groups follow each other, so a group is one run of the grid. The labels are not part of the
            // chart yet: the chart holds its marks and nothing else.
            expect(byColumn.groups[1]![0]).toBe(byColumn.marks[20])
            expect(byColumn.children).toHaveLength(30)

            const byRow = unitChart(groups, { columns: 10, cell: 10, gap: 10 })
            expect(middle(byRow.marks[0]!)).toEqual([-90, -20])
            expect(middle(byRow.marks[9]!)).toEqual([90, -20])
            expect(middle(byRow.marks[10]!)).toEqual([-90, 0])
            // The default gap is 0.6 of the cell.
            const close = unitChart([{ count: 2 }], { rows: 1, cell: 10 })
            expect(close.p(1)[0] - close.p(0)[0]).toBe(16)
        }))
    })

    it('gives each group its own block when split, with its label over it and no two labels touching', async () => {
        await compileFilm(film(() => {
            const chart = unitChart([{ count: 20, label: 'no effect' }, { count: 2, color: 'green', label: 'a label much wider than two marks' }, { count: 3, color: 'red', label: 'worse' }], { rows: 5, split: true, cell: 10, gap: 10 })
            const boxes = chart.groups.map((own) => own.map((mark) => mark.bounds()))
            const span = (list: { x: number; width: number }[]) => [Math.min(...list.map((b) => b.x)), Math.max(...list.map((b) => b.x + b.width))] as const
            const spans = boxes.map(span)
            // Blocks stand left to right and do not share a column.
            expect(spans[0]![1]).toBeLessThan(spans[1]![0])
            expect(spans[1]![1]).toBeLessThan(spans[2]![0])
            // All blocks start at one top line, and each label is over its block and centered on it.
            const tops = boxes.map((list) => Math.min(...list.map((b) => b.y)))
            expect(Math.max(...tops) - Math.min(...tops)).toBeCloseTo(0, 6)
            chart.labels.forEach((label, index) => {
                const box = label!.bounds()
                expect(label!.parent).toBe(chart)
                expect(box.y + box.height).toBeLessThan(tops[index]!)
                // A block starts on a whole pixel, and the ink of a word is not exactly centered: allow 2 px.
                expect(Math.abs(box.x + box.width / 2 - (spans[index]![0] + spans[index]![1]) / 2)).toBeLessThan(2)
            })
            const labels = chart.labels.map((label) => label!.bounds())
            expect(labels[0]!.x + labels[0]!.width).toBeLessThan(labels[1]!.x)
            expect(labels[1]!.x + labels[1]!.width).toBeLessThan(labels[2]!.x)
            // The edges of the marks are on whole pixels, so a square is sharp.
            for (const box of boxes.flat()) expect(box.x).toBe(Math.round(box.x))
        }))
    })

    it('gives an empty group no room, or the room of its label', async () => {
        await compileFilm(film(() => {
            const two = unitChart([{ count: 10 }, { count: 5 }], { rows: 5, split: true, cell: 10, gap: 10 })
            for (const where of [0, 1, 2]) {
                const list = [{ count: 10 }, { count: 5 }]
                list.splice(where, 0, { count: 0 })
                const chart = unitChart(list, { rows: 5, split: true, cell: 10, gap: 10 })
                expect(chart.marks.map((_, index) => chart.p(index))).toEqual(two.marks.map((_, index) => two.p(index)))
            }
            // With a label, an empty group keeps a place between its neighbours: "0 failed" over no marks.
            const named = unitChart([{ count: 10, label: 'passed' }, { count: 0, label: '0 failed' }, { count: 5, label: 'flaky' }], { rows: 5, split: true, cell: 10, gap: 10 })
            const [passed, failed, flaky] = named.labels.map((label) => label!.bounds())
            expect(passed!.x + passed!.width).toBeLessThan(failed!.x)
            expect(failed!.x + failed!.width).toBeLessThan(flaky!.x)
            expect(named.p(10)[0] - named.p(9)[0]).toBeGreaterThan(two.p(10)[0] - two.p(9)[0] + failed!.width)
        }))
    })

    it('mixes the groups over the cells of the same grid, the same way for the same seed', async () => {
        await compileFilm(film(() => {
            const plain = unitChart(groups, { rows: 5, cell: 10, gap: 10 })
            const mixed = unitChart(groups, { rows: 5, cell: 10, gap: 10, mixed: true, seed: 7 })
            const again = unitChart(groups, { rows: 5, cell: 10, gap: 10, mixed: true, seed: 7 })
            const other = unitChart(groups, { rows: 5, cell: 10, gap: 10, mixed: true, seed: 8 })
            const places = (chart: ReturnType<typeof unitChart>) => chart.marks.map((_, index) => key(chart.p(index)))
            expect([...places(mixed)].sort()).toEqual([...places(plain)].sort())
            expect(places(mixed)).not.toEqual(places(plain))
            expect(places(again)).toEqual(places(mixed))
            expect(places(other)).not.toEqual(places(mixed))
        }))
    })

    it('enters line by line, and the label of a block arrives with its first line', async () => {
        let chart!: ReturnType<typeof unitChart>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            chart = unitChart([{ count: 10, label: 'passed' }, { count: 0, label: '0 failed' }, { count: 10, label: 'flaky' }], { rows: 5, split: true, cell: 10, gap: 10 })
            s.wait(0.5)
            s.play(chart.enter({ lag: 1 }), { duration: 2, ease: linear })
            s.wait(0.5)
        }))
        expect((await compiled.frame(0.2)).ops).toHaveLength(0)
        // Four lines with a lag of 1: each line has a quarter of the time, one after the other.
        const [first, second, third, last] = [chart.marks[0]!, chart.marks[5]!, chart.marks[10]!, chart.marks[15]!]
        expect(at(0.9, () => [first, second, third, last].map(shows))).toEqual([expect.closeTo(0.8, 6), 0, 0, 0])
        expect(at(1.9, () => [first, second, third, last].map(shows))).toEqual([1, 1, expect.closeTo(0.8, 6), 0])
        // A mark of a line is as far as the first mark of that line.
        expect(at(0.9, () => shows(chart.marks[4]!))).toBeCloseTo(0.8, 6)
        // The label of the first block comes at once. The other two come with the third line, where the
        // last block starts: the empty block has no line of its own.
        const [passed, failed, flaky] = chart.labels as Node[]
        expect(at(0.9, () => shows(passed!))).toBeGreaterThan(0)
        expect(at(1.4, () => [shows(failed!), shows(flaky!)])).toEqual([0, 0])
        expect(at(1.9, () => shows(failed!))).toBeGreaterThan(0)
        expect(at(1.9, () => shows(failed!))).toBe(at(1.9, () => shows(flaky!)))
        expect(at(2.6, () => chart.marks.map(shows).concat(chart.labels.map((label) => shows(label!))))).toEqual(Array(23).fill(1))
    })

    it('starts plain, paints each group and its label, and moves the marks into blocks', async () => {
        let chart!: ReturnType<typeof unitChart>
        let target!: ReturnType<typeof unitChart>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            chart = unitChart(groups, { rows: 5, cell: 10, gap: 10, mixed: true, plain: true, plainColor: 'faint' })
            target = unitChart(groups, { rows: 5, cell: 10, gap: 10, split: true })
            s.wait(0.5)
            s.play(chart.enter(), { duration: 1 })
            s.play(chart.paint(), { duration: 0.5 })
            s.play(chart.rearrange({ split: true }), { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        const green = chart.groups[1]![0]!, grey = chart.groups[0]![0]!
        const ink = (label: Node) => label.all().find((part) => part.get('fill'))!.get('fill')
        // Before the paint, a mark of the green group has the color of every other mark. So has its label.
        expect(at(1.5, () => green.get('fill'))).toEqual(at(1.5, () => grey.get('fill')))
        expect(at(1.5, () => ink(chart.labels[1]!))).toEqual(at(1.5, () => grey.get('fill')))
        expect(at(2.0, () => green.get('fill'))).toEqual(target.groups[1]![0]!.get('fill'))
        expect(at(2.0, () => grey.get('fill'))).toEqual(target.groups[0]![0]!.get('fill'))
        expect(at(2.0, () => ink(chart.labels[1]!))).toEqual(ink(target.labels[1]!))
        // While the groups are mixed, the film draws the 30 marks and no label.
        expect((await compiled.frame(1.9)).ops).toHaveLength(30)
        // No label leaves, so the marks start at once: a tenth into the move, the first mark of each group is on its way.
        for (const own of chart.groups) expect(at(2.1, () => xy(own[0]!))).not.toEqual(at(2.0, () => xy(own[0]!)))
        // After the move, each mark and each label is where a chart that was built split has it.
        chart.marks.forEach((mark, index) => {
            expect(at(3.2, () => xy(mark))).toEqual(target.p(index))
            expect(chart.p(index)).toEqual(target.p(index))
        })
        chart.labels.forEach((label, index) => {
            expect(at(3.2, () => shows(label!))).toBe(1)
            expect(at(3.2, () => xy(label!))).toEqual(xy(target.labels[index]!))
        })
    })

    it('takes the labels away before a move, and moves a label only while it is hidden', async () => {
        let chart!: ReturnType<typeof unitChart>
        let still!: ReturnType<typeof unitChart>
        await compileFilm(film({ fps: 20 }, (s) => {
            chart = s.add(unitChart(groups, { rows: 5, cell: 10, gap: 10, split: true }))
            still = s.add(unitChart(groups, { rows: 5, cell: 10, gap: 10, split: true }))
            s.play(chart.rearrange({ rows: 3 }), { duration: 1, ease: linear })
            s.play(still.rearrange({ split: true }), { duration: 1, ease: linear })
        }))
        // Each group moves over the whole time: its first mark leaves first, and its last mark arrives last.
        const label = chart.labels[2]!, mark = chart.marks[20]!, last = chart.marks[29]!
        const start = at(0, () => xy(label)), end = at(1, () => xy(label))
        expect(end).not.toEqual(start)
        // For the first fifth of the move, the label fades out and no mark moves.
        expect(at(0.1, () => shows(label))).toBeCloseTo(0.5, 6)
        expect(at(0.19, () => xy(mark))).toEqual(at(0, () => xy(mark)))
        expect(at(0.1, () => xy(label))).toEqual(start)
        // Then the marks move, and the label waits at its new place with opacity 0.
        expect(at(0.5, () => shows(label))).toBe(0)
        expect(at(0.5, () => xy(label))).toEqual(end)
        expect(at(0.5, () => xy(mark))).not.toEqual(at(0, () => xy(mark)))
        expect(at(0.7, () => xy(last))).not.toEqual(at(1, () => xy(last)))
        expect(at(0.76, () => xy(last))).toEqual(at(1, () => xy(last)))
        expect(at(1, () => shows(label))).toBe(1)
        // A move to the arrangement that the chart already has changes nothing: the labels do not blink.
        for (const time of [1.1, 1.5, 1.9]) expect(at(time, () => still.labels.map((item) => shows(item!)))).toEqual([1, 1, 1])
    })

    it('chains two moves in one sequence, and takes the labels away when the groups join', async () => {
        let chart!: ReturnType<typeof unitChart>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            chart = s.add(unitChart(groups, { rows: 5, cell: 10, gap: 10, split: true }))
            s.play(seq(chart.rearrange({ columns: 10 }), chart.rearrange({ mixed: true, seed: 3 })), { duration: 2 })
        }))
        // The second move starts from the first: it keeps the 10 columns, and `mixed` turns `split` off.
        const cells = at(2, () => chart.marks.map((mark) => key(xy(mark) as [number, number]))).sort()
        const grid = unitChart(groups, { columns: 10, cell: 10, gap: 10 })
        expect(cells).toEqual(grid.marks.map((_, index) => key(grid.p(index))).sort())
        expect(at(2, () => key(xy(chart.marks[0]!) as [number, number]))).not.toBe(key(grid.p(0)))
        expect((await compiled.frame(0)).ops.length).toBeGreaterThan(30)
        expect((await compiled.frame(2)).ops).toHaveLength(30)
    })

    it('shows no label when the film fades in the marks of a joined chart one by one', async () => {
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            s.play(fadeIn(unitChart(groups, { rows: 5 }), { lag: 0.1 }), { duration: 1 })
            s.wait(0.5)
        }))
        expect((await compiled.frame(1.4)).ops).toHaveLength(30)
    })

    it('gives a copy its own marks and labels', async () => {
        await compileFilm(film(() => {
            const split = unitChart(groups, { rows: 5, split: true }), copy = split.clone()
            expect(copy.marks[0]).not.toBe(split.marks[0])
            expect(copy.children).toContain(copy.groups[1]![0])
            expect(copy.children).toContain(copy.labels[2])
            // A label that is not yet part of the chart is copied too, so the copy does not take it from the chart.
            const joined = unitChart(groups, { rows: 5 }), other = joined.clone()
            expect(other.labels[0]).not.toBe(joined.labels[0])
            expect(other.labels[0]!.bounds().width).toBeCloseTo(joined.labels[0]!.bounds().width, 6)
        }))
    })

    it('names a wrong count, size or arrangement', async () => {
        await compileFilm(film(() => {
            expect(() => unitChart([])).toThrow(/at least one group/)
            expect(() => unitChart([{ count: 0 }])).toThrow(/at least one mark/)
            expect(() => unitChart([{ count: 2.5 }])).toThrow(/whole number/)
            expect(() => unitChart([{ count: -1 }])).toThrow(/whole number/)
            expect(() => unitChart([{ count: 30000 }])).toThrow(/more than a frame can show/)
            expect(() => unitChart(groups, { cell: 0 })).toThrow(/cell is the side/)
            expect(() => unitChart(groups, { gap: Number.NaN })).toThrow(/gap is the room/)
            expect(() => unitChart(groups, { blockGap: -1 })).toThrow(/blockGap is the room/)
            expect(() => unitChart(groups, { rows: 5, columns: 6 })).toThrow(/rows or columns/)
            expect(() => unitChart(groups, { rows: 0 })).toThrow(/1 or more/)
            expect(() => unitChart(groups, { seed: 0.5 })).toThrow(/seed is a whole number/)
            expect(() => unitChart(groups, { split: true, mixed: true })).toThrow(/Use one of them/)
            expect(() => unitChart(groups).rearrange({ columns: 1.5 })).toThrow(/1 or more/)
            expect(() => unitChart(groups).p(30)).toThrow(/no mark 30/)
        }))
    })
})

describe('tag', () => {
    it('starts its pill at the place it is given, with the word in the middle and the note after it', async () => {
        await compileFilm(film(() => {
            const short = tag('OK', { note: 'a note' }).at(100, 50), long = tag('RECOMMENDATION').at(100, 150)
            expect(short.pill.bounds().x).toBeCloseTo(100, 6)
            expect(long.pill.bounds().x).toBeCloseTo(100, 6)
            for (const made of [short, long]) {
                const pill = made.pill.bounds(), word = made.word.bounds()
                expect(word.x - pill.x).toBeCloseTo(pill.x + pill.width - word.x - word.width, 6)
                expect(word.x - pill.x).toBeGreaterThan(12)
                expect(word.y).toBeGreaterThan(pill.y)
                expect(word.y + word.height).toBeLessThan(pill.y + pill.height)
            }
            expect(short.note!.bounds().x).toBeGreaterThan(short.pill.bounds().x + short.pill.bounds().width + 8)
            expect(long.note).toBeNull()
            expect(() => tag(' ')).toThrow(/give it a word/)
        }))
    })

    it('recolors its border and its word, and keeps the fill of the pill', async () => {
        await compileFilm(film(() => {
            const made = tag('OK', { color: 'blue', note: 'a note' })
            const fill = made.pill.get('fill'), note = made.note!.children[0]!.get('fill')
            made.color('green')
            expect(made.pill.get('fill')).toEqual(fill)
            expect(made.pill.get('stroke')).not.toEqual(fill)
            expect(made.word.children[0]!.get('fill')).toEqual(made.pill.get('stroke'))
            expect(made.note!.children[0]!.get('fill')).toEqual(note)
        }))
    })

    it('shows one state at a time with its own options, fades it in, and shows nothing before the first or after the last', async () => {
        await compileFilm(film(() => {
            const track = tagTrack([{ at: 1, word: 'PLAN', color: 'blue' }, { at: 3, word: 'MEASURED', note: 'June', size: 40 }], { until: 5, size: 30, fadeIn: 0.2, fadeOut: 0.2 })
            const at = (time: number) => track.draw!(time) as ReturnType<typeof tag> | null
            const word = (time: number) => (at(time)?.word as unknown as { source: string } | undefined)?.source
            expect(at(0.5)).toBeNull()
            expect(word(2)).toBe('PLAN')
            expect(at(2)!.get('opacity')).toBe(1)
            expect(at(1.1)!.get('opacity')).toBeCloseTo(0.5, 6)
            expect(at(2.9)!.get('opacity')).toBeCloseTo(0.5, 6)
            expect(word(2.9)).toBe('PLAN')
            expect(word(3.1)).toBe('MEASURED')
            expect(at(3.1)!.note).not.toBeNull()
            expect(at(5)).toBeNull()
            // The shared size is the default, and a state can set its own.
            expect(at(2)!.word.data['size']).toBe(30)
            expect(at(4)!.word.data['size']).toBe(40)
            expect(at(2)!.pill.get('stroke')).not.toEqual(at(4)!.pill.get('stroke'))
            expect(track.get('fixed')).toBe(true)
        }))
    })

    it('draws at the place of the track, not at a place of its own', async () => {
        const compiled = await compileFilm(film({ fps: 10 }, (s) => {
            s.add(tagTrack([{ at: 0, word: 'PLAN' }], { until: 2 }).at(-800, -400))
            s.wait(2)
        }))
        const frame = await compiled.frame(1)
        const pill = pathBounds((frame.ops[0] as PathOp).path)!
        // The frame is 1920 by 1080 with the origin in the middle, so the left end of the pill is at x = 160.
        expect(pill.x).toBeCloseTo(160, 0)
        expect(pill.y + pill.height / 2).toBeCloseTo(140, 0)
    })

    it('refuses states that are out of order or too near for the fades, and accepts states that just fit', () => {
        expect(() => tagTrack([], { until: 5 })).toThrow(/at least one state/)
        expect(() => tagTrack([{ at: 2, word: 'A' }, { at: 1, word: 'B' }], { until: 5 })).toThrow(/state 0 \("A"\) starts at 2 and state 1 \("B"\) starts at 1/)
        expect(() => tagTrack([{ at: 1, word: 'A' }, { at: 1.2, word: 'B' }], { until: 5 })).toThrow(/needs 0.43 s/)
        expect(() => tagTrack([{ at: 1, word: 'A' }, { at: 1.2, word: 'B' }], { until: 5, fadeIn: 0.1, fadeOut: 0.2 })).toThrow(/needs 0.3 s/)
        expect(() => tagTrack([{ at: 1, word: 'A' }], { until: 1.1 })).toThrow(/the tag leaves at 1.1/)
        expect(() => tagTrack([{ at: 1, word: 'A' }], {} as never)).toThrow(/until is the time/)
        expect(() => tagTrack([{ at: 1, word: 'A' }], { until: 5, fadeIn: -1 })).toThrow(/0 or more/)
    })

    it('accepts states that are exactly the two fades apart, and fades of zero', async () => {
        await compileFilm(film(() => {
            const tight = tagTrack([{ at: 1, word: 'A' }, { at: 1.43, word: 'B' }], { until: 5 })
            expect(tight.draw!(1.2)).not.toBeNull()
            const sharp = tagTrack([{ at: 1, word: 'A' }], { until: 2, fadeIn: 0, fadeOut: 0 })
            expect((sharp.draw!(1) as Node).get('opacity')).toBe(1)
            expect(sharp.draw!(2)).toBeNull()
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
            const flow = lanes(names, events, sized)
            expect([flow.x(0), flow.x(50), flow.x(100)]).toEqual([-500, 0, 500])
            expect([flow.y('guest'), flow.y('KVM'), flow.y(2)]).toEqual([-100, 0, 100])
            expect(flow.domain).toEqual([0, 100])
            // One node per event, in the order given, and the same nodes by kind.
            expect(flow.events.map((event) => event.kind)).toEqual(['span', 'handoff', 'span', 'handoff', 'span', 'handoff', 'span', 'handoff', 'span'])
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>, copy!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
            let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>, plain!: ReturnType<typeof lanes>
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
            let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
        let flow!: ReturnType<typeof lanes>
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
})

export type { Vec, Vec3 }
