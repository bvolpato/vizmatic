import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import {
    CODE_LANGUAGES, arrayCells, attentionMatrix, axes, axes3d, barChart, callout, card, codeBlock, compileFilm, complexPlane, applyComplex, connector, countUp,
    counter, curve3d, dashedGuides, donut, dotChart, draw, dynamic, epicycles, fadeIn, film, fourier, fourierPoint, frameToSvg, fromSvg, graph, group,
    heatmap, highlightSweep, histogram, infoBox, lagged, labeledDot, legend, line, lineChart, linear, matrix, mixColor, morph, morphCode, morphMatching,
    neuralNet, numberLine, PAGE_STATES, parseColor, parseSvgPath, pathBounds, pathLength, pathToD, pictogram, PICTOGRAMS, pie, point3d, points3d, rect, riemann, samplePath, scatter, scene3d, spin,
    seq, sphere, stateGrid, streamLines, surface, swap, tag, tagTrack, tex, text, tokens, tokenize, trail3d, traced, tree, typewriter, unitChart, vectorField, vector3d, wipe, write, zone,
    circle, tangentLine, secantLine, areaUnder, braceLabel, surroundingBox, angleMark, rightAngle, circlePath, to, type CompiledFilm,
    type FilmDefinition, type Node, type PathOp, type PictogramName, type Rgba, type Stage, type Vec, type Vec3,
} from '../src/stage/index'
import { fromComponent } from '../src/stage/export'
import { clock } from '../src/stage/track'
import type { Anim } from '../src/stage/anim'
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

describe('animations that bring their own object to the stage', () => {
    type Made = { nodes: Node[]; anim: Anim }
    const one = <T extends Node>(node: T, anim: (node: T) => Anim): Made => ({ nodes: [node], anim: anim(node) })
    /** Every animation that puts its object on the stage when the film did not. Each entry makes new nodes. */
    const entrances: Record<string, () => Made> = {
        'barChart.enter': () => one(barChart([{ label: 'a', value: 2 }, { label: 'b', value: 3 }], { width: 200, height: 100 }), (chart) => chart.enter()),
        'histogram.fillUp': () => one(histogram([1, 2, 2, 3, 3, 3], { bins: 3, range: [0, 4] }), (chart) => chart.fillUp()),
        'scatter.enter': () => one(scatter([{ x: 0, y: 0 }, { x: 1, y: 1 }]), (chart) => chart.enter()),
        'lineChart.enter': () => one(lineChart([{ name: 'a', values: [1, 2, 3] }]), (chart) => chart.enter()),
        'pie.enter': () => one(pie([{ label: 'a', value: 3 }, { label: 'b', value: 1 }], { radius: 100 }), (chart) => chart.enter()),
        'heatmap.enter': () => one(heatmap([[0, 1], [2, 3]], { cell: 40 }), (chart) => chart.enter()),
        'dotChart.enter': () => one(dotChart([{ label: 'a', value: 0.5 }], { domain: [0, 1] }), (chart) => chart.enter()),
        'unitChart.enter': () => one(unitChart([{ count: 6 }], { rows: 2 }), (chart) => chart.enter()),
        'graph.enter': () => one(graph([{ id: 'a', at: [-100, 0] }, { id: 'b', at: [100, 0] }], [{ from: 'a', to: 'b' }], { layout: 'manual' }), (made) => made.enter()),
        'tree.enter': () => one(tree({ id: 'r', label: 'r', children: [{ id: 'c', label: 'c' }] }), (made) => made.enter()),
        'arrayCells.enter': () => one(arrayCells([3, 1, 4]), (cells) => cells.enter()),
        'neuralNet.enter': () => one(neuralNet([2, 2]), (net) => net.enter()),
        'tokens.enter': () => one(tokens(['a', 'b']), (row) => row.enter()),
        'infoBox.enter': () => one(infoBox({ title: 'A', rows: [{ label: 'x', value: '1' }] }), (box) => box.enter()),
        // A connector draws between its two ends, so the ends are in the group with it.
        'connector.pulse': () => {
            const a = rect(40, 40).at(-100, 0), b = rect(40, 40).at(100, 0), link = connector(a, b)
            return { nodes: [a, b, link], anim: link.pulse() }
        },
        'callout.enter': () => one(callout([0, 0], 'A note', { side: 'right', width: 200 }), (note) => note.enter()),
        typewriter: () => one(text('abc', { font: 'mono', size: 30 }), (line) => typewriter(line)),
        wipe: () => one(text('abc', { font: 'mono', size: 30 }), (line) => wipe(line)),
        countUp: () => one(counter(7), (readout) => countUp(readout, 9)),
        spin: () => one(rect(100, 40), (box) => spin(box, 1)),
        swap: () => {
            const a = rect(40, 40).at(-100, 0), b = rect(40, 40).at(100, 0)
            return { nodes: [a, b], anim: swap(a, b) }
        },
    }
    const left = (f: CompiledFilm, time: number) => Math.min(...paths(f, time).flatMap((op) => pathBounds(op.path)?.x ?? []))
    const marks = () => unitChart([{ count: 6 }], { rows: 2 })

    it.each(Object.keys(entrances))('%s draws nothing of its object before its turn in a sequence', async (name) => {
        const compiled = await compile((s) => {
            s.wait(1)
            // Two parts of one second each: a small rectangle fades in, then the object arrives.
            s.play(seq(fadeIn(rect(10, 10).at(-900, -500), { duration: 1 }), { ...entrances[name]!().anim, duration: 1 }))
            s.wait(0.5)
        })
        // In the first second, the rectangle is the one mark that the film draws.
        for (const time of [1.3, 1.6, 1.99]) expect(compiled.frame(time).ops).toHaveLength(1)
        expect(compiled.frame(3.4).ops.length).toBeGreaterThan(1)
    })

    it.each(Object.keys(entrances))('%s keeps its object in a group that is not on the stage, at the place of the group', async (name) => {
        const lefts: number[] = []
        for (const shift of [0, 300]) {
            let nodes!: Node[], outer!: Node
            const compiled = await compile((s) => {
                const made = entrances[name]!()
                nodes = made.nodes
                outer = group(...nodes).at(shift, 0)
                s.play(made.anim, { duration: 1 })
                s.wait(0.5)
            })
            for (const node of nodes) expect(node.parent).toBe(outer)
            lefts.push(left(compiled, 1.4))
        }
        // The picture of the group that the film moved is the same picture, 300 to the right.
        expect(lefts[1]! - lefts[0]!).toBeCloseTo(300, 6)
    })

    it('leaves an object that shows alone, and shows a hidden object and a hidden parent at the start of the animation', async () => {
        let shown!: ReturnType<typeof marks>, hidden!: ReturnType<typeof marks>, inner!: ReturnType<typeof marks>, outer!: Node, root!: Node
        const compiled = await compile((s) => {
            root = s.root
            shown = s.add(marks())
            hidden = s.add(marks().at(0, 200).hide())
            inner = marks().at(0, 400)
            outer = s.add(group(inner).hide())
            s.wait(1)
            s.play(shown.enter(), hidden.enter(), inner.enter(), { duration: 1 })
            s.wait(0.5)
        })
        // Before the animations, the film draws the first chart and no other.
        expect(compiled.frame(0.5).ops).toHaveLength(6)
        expect(at(0.5, () => [shown, hidden, outer].map((node) => node.get('visible')))).toEqual([true, false, false])
        expect(at(1, () => [shown, hidden, inner, outer].map((node) => node.get('visible')))).toEqual([true, true, true, true])
        expect(compiled.frame(2.4).ops).toHaveLength(18)
        // No object changed its parent, and each one is on the stage once.
        expect(inner.parent).toBe(outer)
        expect(root.children.filter((child) => child === shown || child === hidden || child === outer)).toHaveLength(3)
    })

    it('brings the whole group with the object, once, when the film adds the group later', async () => {
        let chart!: ReturnType<typeof marks>, outer!: Node, root!: Node
        const compiled = await compile((s) => {
            root = s.root
            chart = marks()
            outer = group(chart, rect(10, 10).at(0, 300)).at(200, 0)
            s.wait(1)
            s.play(chart.enter(), { duration: 1 })
            s.wait(1)
            s.add(outer)
            s.wait(1)
        })
        expect(compiled.frame(0.5).ops).toHaveLength(0)
        // The other node of the group shows from the start of the animation, with the group.
        expect(compiled.frame(1.01).ops).toHaveLength(1)
        expect(compiled.frame(3.5).ops).toHaveLength(7)
        expect(chart.parent).toBe(outer)
        expect(root.children.filter((child) => child === outer || child === chart)).toEqual([outer])
    })

    it('enters a copy at its own turn, and enters one object twice in one sequence', async () => {
        let chart!: ReturnType<typeof marks>, copy!: ReturnType<typeof marks>, root!: Node
        const compiled = await compile((s) => {
            root = s.root
            chart = marks()
            copy = chart.clone().at(0, 200)
            s.wait(1)
            s.play(seq(chart.enter(), copy.enter(), chart.enter()), { duration: 3, ease: linear })
            s.wait(0.5)
        })
        const drawn = (time: number) => [chart, copy].map((made) => paths(compiled, time).filter((op) => made.marks.some((mark) => mark === op.node)).length)
        expect(compiled.frame(0.5).ops).toHaveLength(0)
        // The first second belongs to the chart, and the second one to its copy.
        expect(drawn(1.99)).toEqual([6, 0])
        expect(drawn(2.99)).toEqual([6, 6])
        // In the last second the chart starts again from nothing, column by column, and its copy stays.
        expect(drawn(3.1)).toEqual([2, 6])
        expect(drawn(4.4)).toEqual([6, 6])
        expect(root.children.filter((child) => child === chart || child === copy)).toEqual([chart, copy])
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
    const paint = (mark: Node) => JSON.stringify(mark.get('stroke') ?? mark.get('fill'))

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
        for (const name of PICTOGRAMS) {
            const plain = new Set(pictogram(name, { color: 'ink' }).children.map(paint))
            const accented = new Set(pictogram(name, { color: 'ink', accent: 'teal' }).children.map(paint))
            expect(plain.size, name).toBe(1)
            expect([...accented].some((value) => !plain.has(value)), name).toBe(true)
        }
        expect(new Set(pictogram('forecast', { color: 'ink', accent: 'teal' }).children.map(paint)).size).toBe(2)
    })

    it('puts the accent of ring, core, and syscall on the part that the picture is about', () => {
        const parts = (name: PictogramName) => {
            const plain = new Set(pictogram(name, { size: SIZE, color: 'ink' }).children.map(paint))
            return pictogram(name, { size: SIZE, color: 'ink', accent: 'teal' }).children.map((mark) => {
                const box = pathBounds(mark.get('path')!)!
                return { accent: !plain.has(paint(mark)), filled: !mark.get('stroke'), box, reach: Math.hypot(box.x + box.width / 2, box.y + box.height / 2) }
            })
        }
        // ring: the filled slots, which are a fill in the band and the two rims along it. The pointer outside the band, the dividers,
        // and the rims of the empty slots keep the color.
        const ring = parts('ring'), fills = ring.filter((part) => part.filled).sort((a, b) => a.reach - b.reach)
        expect(fills.map((fill) => fill.accent)).toEqual([true, false])
        expect(ring.filter((part) => part.accent && !part.filled)).toHaveLength(2)
        expect(ring.filter((part) => !part.accent && !part.filled)).toHaveLength(10)
        // core: one of the two lanes. The body and the legs keep the color.
        const core = parts('core')
        expect(core.filter((part) => part.filled).map((lane) => lane.accent).sort()).toEqual([false, true])
        expect(core.filter((part) => !part.filled).some((part) => part.accent)).toBe(false)
        // syscall: the arrow. The line that it crosses keeps the color.
        const syscall = parts('syscall')
        const line = syscall.filter((part) => part.box.height < 1e-6 && part.box.width > SIZE / 2)
        expect(line).toHaveLength(1)
        expect(syscall.filter((part) => !part.accent)).toEqual(line)
    })

    it('ends each leg of chip, core, and timer on the edge of the body', () => {
        for (const name of ['chip', 'core', 'timer'] as const) {
            const lines = pictogram(name, { size: SIZE }).children.filter((mark) => mark.get('stroke')).map((mark) => pathBounds(mark.get('path')!)!)
            const body = lines.reduce((largest, box) => (box.width * box.height > largest.width * largest.height ? box : largest))
            const legs = lines.filter((box) => box.width < 1e-6 || box.height < 1e-6)
            expect(legs, name).toHaveLength(12)
            for (const leg of legs) {
                const upright = leg.width < 1e-6
                const [from, to] = upright ? [leg.y, leg.y + leg.height] : [leg.x, leg.x + leg.width]
                const [near, far] = upright ? [body.y, body.y + body.height] : [body.x, body.x + body.width]
                // A leg stops on the near edge or starts on the far edge. So it touches the body and does not cross it.
                expect(Math.min(Math.abs(to - near), Math.abs(from - far)), name).toBeLessThan(1e-6)
            }
        }
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

    const spread = [{ label: 'small', value: 80 }, { label: 'large', value: 12_000_000 }]
    // The x of each line of the grid, from left to right. Only these parts of the axis are as tall as the plot.
    const gridLines = (chart: ReturnType<typeof dotChart>, height: number) => chart.axis.children.filter((node) => node.bounds().height > height * 0.9)
    const gridAt = (chart: ReturnType<typeof dotChart>, height: number) => gridLines(chart, height).map((node) => node.bounds().x).sort((a, b) => a - b)

    it('gives each power of ten the same room on a log axis', async () => {
        await compileFilm(film(() => {
            const items = [{ label: 'small', value: 80 }, { label: 'large', value: 1_200_000 }]
            const chart = dotChart(items, { scale: 'log', width: 1200, height: 200, domain: [10, 1e7] })
            expect(chart.domain).toEqual([10, 1e7])
            expect(chart.p(10, 0)[0]).toBeCloseTo(-600, 6)
            expect(chart.p(1e7, 0)[0]).toBeCloseTo(600, 6)
            // Six powers of ten share 1200 px. On a linear axis, 100 would be 0.01 px from 10.
            const powers = [10, 100, 1e3, 1e4, 1e5, 1e6, 1e7].map((value) => chart.p(value, 0)[0])
            powers.slice(1).forEach((x, index) => expect(x - powers[index]!).toBeCloseTo(200, 6))
            // The middle of the axis is the geometric middle of its two ends, also when no end is a power of ten.
            expect(chart.p(1e4, 0)[0]).toBeCloseTo(0, 6)
            const odd = dotChart([{ label: 'a', value: 40 }], { scale: 'log', width: 1200, domain: [2, 800] })
            expect(odd.p(40, 0)[0]).toBeCloseTo(0, 6)
            expect(middle(odd.dots[0]!)[0]).toBeCloseTo(0, 6)
            chart.dots.forEach((mark, row) => expect(middle(mark)[0]).toBeCloseTo(chart.p(items[row]!.value, row)[0], 6))
            // The rows are placed as on a linear axis.
            expect(chart.p(100, 1)[1]).toBeCloseTo(50, 6)
        }))
    })

    it('takes its default log axis from the powers of ten around the data', async () => {
        await compileFilm(film(() => {
            const wide = dotChart(spread, { scale: 'log' })
            expect(wide.domain).toEqual([10, 100_000_000])
            expect(words(wide)).toEqual(['10', '100', '1k', '10k', '100k', '1M', '10M', '100M'])
            // Data inside one power of ten: the two powers around it are the ends, and the only ticks.
            const narrow = dotChart([{ label: 'a', value: 2 }, { label: 'b', value: 8.5 }], { scale: 'log' })
            expect(narrow.domain).toEqual([1, 10])
            expect(words(narrow)).toEqual(['1', '10'])
            const below = dotChart([{ label: 'a', value: 0.004 }, { label: 'b', value: 0.5 }], { scale: 'log' })
            expect(below.domain).toEqual([0.001, 1])
            expect(words(below)).toEqual(['0.001', '0.01', '0.1', '1'])
            // A value on a power of ten is an end of the axis. One value alone still gets a whole power.
            expect(dotChart([{ label: 'a', value: 100 }, { label: 'b', value: 1000 }], { scale: 'log' }).domain).toEqual([100, 1000])
            expect(dotChart([{ label: 'a', value: 100 }], { scale: 'log' }).domain).toEqual([100, 1000])
            // An interval counts as data.
            expect(dotChart([{ label: 'a', value: 50, low: 5, high: 500 }], { scale: 'log' }).domain).toEqual([1, 1000])
            // A value next to a power of ten is inside the axis, though its logarithm rounds to a whole number.
            expect(dotChart([{ label: 'a', value: 999.9999999999999 }], { scale: 'log' }).domain).toEqual([100, 1000])
            expect(dotChart([{ label: 'a', value: 5 }, { label: 'b', value: 1000.0000000000001 }], { scale: 'log' }).domain).toEqual([1, 10_000])
        }))
    })

    it('names fewer powers of ten when there are more than eight, and keeps the two ends', async () => {
        await compileFilm(film(() => {
            const over = (most: number, options = {}) => words(dotChart([{ label: 'a', value: 3 }, { label: 'b', value: most }], { scale: 'log', ...options }))
            // Eight powers fit. With nine, every second one has a name.
            expect(over(7e6)).toEqual(['1', '10', '100', '1k', '10k', '100k', '1M', '10M'])
            expect(over(7e7)).toEqual(['1', '100', '10k', '1M', '100M'])
            expect(over(7e11)).toEqual(['1', '100', '10k', '1M', '100M', '10G', '1T'])
            // No step of two reaches both ends of nine powers. A step of three does.
            expect(over(7e8)).toEqual(['1', '1k', '1M', '1G'])
            // No step reaches both ends of eleven powers. The last end keeps its name, and 10G, one power
            // before it, has none.
            expect(over(7e10)).toEqual(['1', '100', '10k', '1M', '100M', '100G'])
            // With seventeen, every third one has a name. 1e15 is two powers before the end, so it keeps its name.
            expect(over(7e16)).toEqual(['1', '1k', '1M', '1G', '1T', '1e15', '1e17'])
            // A number asks for about that many.
            expect(over(7e11, { ticks: 4 })).toEqual(['1', '10k', '100M', '1T'])
            expect(over(7e5, { ticks: 4 })).toEqual(['1', '100', '10k', '1M'])
            expect(over(7e6, { ticks: 4 })).toEqual(['1', '100', '10k', '10M'])
            expect(over(7e5, { ticks: 2 })).toEqual(['1', '1M'])
        }))
    })

    it('writes the ticks of a log axis in a short form, or with the format of the film', async () => {
        await compileFilm(film(() => {
            const powers = [0.001, 0.01, 0.1, 1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]
            expect(words(dotChart(spread, { scale: 'log', ticks: powers }))).toEqual(['0.001', '0.01', '0.1', '1', '10', '100', '1k', '10k', '100k', '1M', '10M', '100M', '1G'])
            expect(words(dotChart(spread, { scale: 'log', ticks: [0.05, 2500, 1_500_000, 1e12, 1e-6] }))).toEqual(['0.05', '2.5k', '1.5M', '1T', '1e-6'])
            expect(words(dotChart(spread, { scale: 'log', ticks: [100, 1e6], format: (value) => `${value / 1000} µs` }))).toEqual(['0.1 µs', '1000 µs'])
            // A linear axis keeps its own form.
            expect(words(dotChart(spread, { ticks: [0, 6_000_000, 12_000_000] }))).toEqual(['0', '6,000,000', '12,000,000'])
        }))
    })

    it('draws an interval on a log axis from its low end to its high end, with the dot between them', async () => {
        await compileFilm(film(() => {
            const chart = dotChart([{ label: 'a', value: 100, low: 10, high: 10_000 }], { scale: 'log', width: 900, domain: [1, 1e6] })
            const interval = chart.intervals[0]!.bounds()
            // Each power of ten has 150 px. The dot is one power over the low end and two under the high end.
            expect(interval.x).toBeCloseTo(-300, 6)
            expect(interval.x + interval.width).toBeCloseTo(150, 6)
            expect(middle(chart.dots[0]!)[0]).toBeCloseTo(-150, 6)
        }))
    })

    it('uses a given domain and given ticks on a log axis as they are', async () => {
        await compileFilm(film(() => {
            const chart = dotChart(spread, { scale: 'log', width: 1000, height: 200, domain: [50, 20_000_000], ticks: [50, 200, 1000, 20_000_000] })
            expect(chart.domain).toEqual([50, 20_000_000])
            expect(words(chart)).toEqual(['50', '200', '1k', '20M'])
            // Each tick has a line of the grid at its place on the log axis.
            const places = gridAt(chart, 200)
            expect(places).toHaveLength(4)
            ;[50, 200, 1000, 20_000_000].forEach((tick, index) => expect(places[index]).toBeCloseTo(chart.p(tick, 0)[0], 6))
            expect(places[0]).toBeCloseTo(-500, 6)
            expect(places[3]).toBeCloseTo(500, 6)
            // With a domain and no ticks, the ticks are the powers of ten inside the domain.
            expect(words(dotChart(spread, { scale: 'log', domain: [50, 20_000_000] }))).toEqual(['100', '1k', '10k', '100k', '1M', '10M'])
            // With ticks and no domain, the axis runs from the first tick to the last, and holds the data.
            expect(dotChart(spread, { scale: 'log', ticks: [100, 1e4, 1e6] }).domain).toEqual([80, 12_000_000])
            // A domain with one power of ten inside it gets 1, 2 and 5 times each power.
            expect(words(dotChart([{ label: 'a', value: 3 }], { scale: 'log', domain: [2, 50] }))).toEqual(['2', '5', '10', '20', '50'])
            // A domain with none of those inside it gets round values, as a linear axis does.
            expect(words(dotChart([{ label: 'a', value: 33 }], { scale: 'log', domain: [30, 45] }))).toEqual(['30', '32', '34', '36', '38', '40', '42', '44'])
            expect(() => dotChart(spread, { scale: 'log', domain: [100, 1e9] })).toThrow(/80 is outside the domain 100 to 1000000000/)
            expect(() => dotChart(spread, { scale: 'log', domain: [10, 1e9], ticks: [1, 100] })).toThrow(/the tick 1 is outside the domain/)
        }))
    })

    it('draws fainter lines inside each power of ten, on a log axis that is short and wide enough', async () => {
        await compileFilm(film(() => {
            const one = [{ label: 'a', value: 2 }, { label: 'b', value: 8.5 }]
            const three = [{ label: 'a', value: 2 }, { label: 'b', value: 850 }]
            const chart = dotChart(one, { scale: 'log', width: 900, height: 200 })
            // One power of ten: a line at each of 1 to 10.
            const places = gridAt(chart, 200)
            expect(places).toHaveLength(10)
            places.forEach((x, index) => expect(x).toBeCloseTo(chart.p(index + 1, 0)[0], 6))
            // The lines at the two ticks are full. The eight between them are fainter.
            const strength = gridLines(chart, 200).map((node) => node.get('opacity')).sort()
            expect(strength.slice(8)).toEqual([1, 1])
            expect(Math.max(...strength.slice(0, 8))).toBeLessThan(0.8)
            // Three powers of ten on 900 px leave 13.7 px between the lines at 9 and 10 times a power.
            expect(gridAt(dotChart(three, { scale: 'log', width: 900, height: 200 }), 200)).toHaveLength(28)
            // On 700 px they would be 10.7 px apart, so only the ticks have a line. The same for four powers.
            expect(gridAt(dotChart(three, { scale: 'log', width: 700, height: 200 }), 200)).toHaveLength(4)
            expect(gridAt(dotChart([{ label: 'a', value: 2 }, { label: 'b', value: 8500 }], { scale: 'log', width: 4000, height: 200 }), 200)).toHaveLength(5)
            // A tick at 2 or 5 times a power keeps its full line, and gets no second one.
            const marked = dotChart(one, { scale: 'log', width: 900, height: 200, ticks: [1, 2, 5, 10] })
            expect(gridAt(marked, 200)).toHaveLength(10)
            expect(gridLines(marked, 200).filter((node) => node.get('opacity') === 1)).toHaveLength(4)
            // In a domain of 2 to 50, the lines stop at 50: none at 60 to 90.
            const cut = gridAt(dotChart([{ label: 'a', value: 3 }], { scale: 'log', width: 900, height: 200, domain: [2, 50] }), 200)
            expect(cut).toHaveLength(13)
            expect(cut[12]).toBeCloseTo(450, 6)
            expect(gridAt(dotChart(one, { scale: 'log', width: 900, height: 200, grid: false }), 200)).toHaveLength(0)
            // A linear axis has lines at its ticks only.
            expect(gridAt(dotChart(one, { width: 900, height: 200, domain: [1, 10], ticks: [1, 10] }), 200)).toHaveLength(2)
        }))
    })

    it('refuses a number that has no place on a log axis, and names it', async () => {
        await compileFilm(film(() => {
            expect(() => dotChart([{ label: 'idle', value: 0 }], { scale: 'log' })).toThrow(/the value of item 0 \("idle"\) is 0\. A log axis has no zero/)
            expect(() => dotChart([{ label: 'ok', value: 5 }, { label: 'wide', value: 5, low: -1, high: 10 }], { scale: 'log' })).toThrow(/the low end of item 1 \("wide"\) is -1\. A log axis has no zero/)
            expect(() => dotChart([{ label: 'a', value: 5 }], { scale: 'log', domain: [0, 100] })).toThrow(/the domain starts at 0\. A log axis has no zero/)
            expect(() => dotChart([{ label: 'a', value: 5 }], { scale: 'log', domain: [1, 100], ticks: [0, 10] })).toThrow(/the tick 0 is not on a log axis\. A log axis has no zero/)
            expect(() => dotChart([{ label: 'a', value: 5 }], { scale: 'log', domain: [1, 100], ticks: [-5, 10] })).toThrow(/the tick -5 is not on a log axis/)
            // Without a domain, a tick of 0 would be an end of the axis. The error still names the tick.
            expect(() => dotChart([{ label: 'a', value: 5 }], { scale: 'log', ticks: [0, 10] })).toThrow(/the tick 0 is not on a log axis/)
            // A tick that is not a number gets the error of a linear axis.
            expect(() => dotChart([{ label: 'a', value: 5 }], { scale: 'log', domain: [1, 100], ticks: [NaN, 10] })).toThrow(/the tick NaN is outside the domain 1 to 100/)
            // The same numbers are fine on a linear axis.
            expect(dotChart([{ label: 'idle', value: 0 }, { label: 'wide', value: 5, low: -1, high: 10 }], { ticks: [0, 10] }).domain).toEqual([-1, 10])
            const chart = dotChart([{ label: 'a', value: 5 }], { scale: 'log' })
            expect(() => chart.p(0, 0)).toThrow(/0 has no place on a log axis/)
            expect(() => dotChart([{ label: 'a', value: 5 }], { scale: 'logarithmic' as 'log' })).toThrow(/scale is 'linear' or 'log', not "logarithmic"/)
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

export type { Vec, Vec3 }
