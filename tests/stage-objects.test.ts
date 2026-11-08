import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import {
    CODE_LANGUAGES, arrayCells, attentionMatrix, axes, axes3d, barChart, bitField, callout, card, codeBlock, compileFilm, complexPlane, applyComplex, connector, countUp,
    counter, curve3d, dashedGuides, donut, dotChart, draw, dynamic, epicycles, fadeIn, film, fourier, fourierPoint, frameToSvg, fromSvg, graph, group,
    heatmap, highlightSweep, histogram, infoBox, lagged, labeledDot, legend, line, lineChart, linear, matrix, morph, morphCode, morphMatching,
    neuralNet, numberLine, parseSvgPath, pathBounds, pathToD, pictogram, PICTOGRAMS, pie, point3d, points3d, rect, riemann, samplePath, scatter, scene3d, spin,
    seq, sphere, streamLines, surface, swap, tag, tagTrack, tex, text, tokens, tokenize, trail3d, traced, tree, typewriter, unitChart, vectorField, vector3d, wipe, write, zone,
    circle, tangentLine, secantLine, areaUnder, braceLabel, surroundingBox, angleMark, rightAngle, circlePath, to, type CompiledFilm,
    type FilmDefinition, type Node, type PathOp, type Stage, type Vec, type Vec3,
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

export type { Vec, Vec3 }
