import { describe, expect, it } from 'vitest'
import { CODE_LANGUAGES, arrayCells, axes, axes3d, barChart, checkFilm, codeBlock, compileFilm, complexPlane, applyComplex, dashedGuides, draw, epicycles, film, fourier, fourierPoint, graph, group, linear, matrix, morph, morphCode, morphMatching, parseColor, pathBounds, pathToD, rect, riemann, samplePath, scene3d, seq, streamLines, surface, tex, tokenize, trail3d, traced, tree, vectorField, boxOf, fitted, circle, tangentLine, secantLine, areaUnder, band, valueAt, circlePath, type FilmDefinition, type Node, type Rgba, type Stage, type Vec, TextNode } from '../src/stage/index'
import { pointAt } from '../src/stage/geometry'
import { at, compile, expectPure, paths } from './helpers/stage-objects'

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

    it('colors the keys of JSON and YAML apart from their values', async () => {
        const kinds = (source: string, language: string) => tokenize(source, language).filter((t) => t.kind !== 'space').map((t) => [t.text, t.role ?? t.kind])
        // JSON: a string before a colon is a key, and true, false and null are keywords.
        expect(kinds('{"name": "get_weather", "days": 3, "metric": true, "note": null}', 'json')).toEqual([
            ['{', 'punctuation'], ['"name"', 'key'], [':', 'punctuation'], ['"get_weather"', 'string'], [',', 'punctuation'],
            ['"days"', 'key'], [':', 'punctuation'], ['3', 'number'], [',', 'punctuation'],
            ['"metric"', 'key'], [':', 'punctuation'], ['true', 'keyword'], [',', 'punctuation'],
            ['"note"', 'key'], [':', 'punctuation'], ['null', 'keyword'], ['}', 'punctuation'],
        ])
        // YAML: a colon ends a key when a space or the end of the line follows it, and `#` starts a comment.
        expect(kinds('image: nginx:1.27 # the server', 'yaml')).toEqual([['image', 'key'], [':', 'punctuation'], ['nginx', 'plain'], [':', 'punctuation'], ['1.27', 'number'], ['# the server', 'comment']])
        // A key can be a word that is a keyword as a value. A value with a capital is not a type, and a quoted value with a colon is one string.
        expect(kinds('- on: push\n  enabled: Yes\n  kind: Deployment\n  label: "a: b"\n  steps:', 'yml')).toEqual([
            ['-', 'punctuation'], ['on', 'key'], [':', 'punctuation'], ['push', 'plain'],
            ['enabled', 'key'], [':', 'punctuation'], ['Yes', 'keyword'],
            ['kind', 'key'], [':', 'punctuation'], ['Deployment', 'plain'],
            ['label', 'key'], [':', 'punctuation'], ['"a: b"', 'string'],
            ['steps', 'key'], [':', 'punctuation'],
        ])
        expect(CODE_LANGUAGES).toEqual(expect.arrayContaining(['json', 'yaml']))
        // In another language, a string before a colon stays a string.
        expect(kinds('{ "a": 1 }', 'ts')[1]).toEqual(['"a"', 'string'])
        // A code block draws a key in the color of keys, which a film can change.
        await compileFilm(film(() => {
            const paint = (color: string) => rect(1, 1, { fill: color, stroke: null }).get('fill')
            const block = codeBlock('{"city": "Paris"}', { language: 'json' })
            expect([block.find('"city"')[0]!.get('fill'), block.find('"Paris"')[0]!.get('fill')]).toEqual([paint('blue'), paint('green')])
            expect(codeBlock('city: Paris', { language: 'yaml', colors: { key: 'teal' } }).find('city')[0]!.get('fill')).toEqual(paint('teal'))
        }))
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

describe('graph and tree that change', () => {
    type G = ReturnType<typeof graph>
    type T = ReturnType<typeof tree>
    const rgb = (paint: unknown) => (paint as Rgba).slice(0, 3)
    const color = (name: string) => parseColor(name).slice(0, 3)
    const fails = async (build: (s: Stage) => void): Promise<string> => {
        try {
            await compile(build)
        } catch (error) {
            return (error as Error).message
        }
        return 'no error'
    }
    /** Three nodes in a row with an arrow from a to b and from b to c. */
    const chain = (options: Parameters<typeof graph>[2] = {}) => graph(
        [{ id: 'a', label: 'a', at: [-300, 0] }, { id: 'b', label: 'b', at: [0, 0] }, { id: 'c', label: 'c', at: [300, 0] }],
        [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }], { layout: 'manual', ...options })
    /** The words after "The dog", with the weights of the lesson on decoding. */
    const words = (options: Parameters<typeof tree>[1] = {}) => tree({ id: 'the', label: 'The dog', children: [
        { id: 'ran', label: 'ran', weight: 0.6, children: [{ id: 'home', label: 'home', weight: 0.35 }, { id: 'away', label: 'away', weight: 0.33 }] },
        { id: 'slept', label: 'slept', weight: 0.4, children: [{ id: 'soundly', label: 'soundly', weight: 0.9 }, { id: 'late', label: 'late', weight: 0.1 }] },
    ] }, { score: 'product', ...options })
    /** The node that a light of `send` or of `path` added to an edge: the last line that is not the shaft. */
    const lightOf = (edge: ReturnType<G['edge']>) => edge.children.filter((child) => child !== edge.shaft && child !== edge.tip && child !== edge.caption).at(-1)!

    it('builds no new part in a graph and a tree that use no new option, so their frames stay as they were', async () => {
        let g!: G, t!: T
        await compile((s) => {
            g = s.add(graph([{ id: 'a', label: 'a' }, { id: 'b', label: 'b', width: 120 }], [{ from: 'a', to: 'b', label: 'x' }]))
            t = s.add(tree({ id: 'r', label: 'r', children: [{ id: 'c', label: 'c' }] }))
        })
        expect(g.node('a').children).toEqual([g.node('a').shape, g.node('a').caption])
        expect(g.edge('a', 'b').children).toEqual([g.edge('a', 'b').shaft, g.edge('a', 'b').tip, g.edge('a', 'b').caption])
        expect(g.children).toEqual([g.edgeLayer, g.nodeLayer])
        expect(t.node('c').children).toEqual([t.node('c').shape, t.node('c').caption])
        expect(t.edge('r', 'c').children).toEqual([t.edge('r', 'c').shaft])
        expect(t.node('c').round).toBe(true)
        expect(g.current).toBeNull()
        expect(g.stateOf('a')).toBe('idle')
    })

    it('setState gives a node the color of its state and a second sign: a wide border, a check, a cross, or dashes', async () => {
        let g!: G
        await compile((s) => {
            g = s.add(chain())
            s.play(g.setState('a', 'active'), g.setState('b', 'done'), g.setState('c', 'off'), { duration: 1 })
            s.play(g.setState('b', 'failed'), g.setState('c', 'idle'), { duration: 1 })
        })
        expect([g.stateOf('a'), g.stateOf('b'), g.stateOf('c')]).toEqual(['active', 'failed', 'idle'])
        const a = g.node('a'), b = g.node('b'), c = g.node('c')
        // Before the play, each node has the look that it was built with.
        expect(at(0, () => [rgb(a.shape.get('stroke')), a.shape.get('strokeWidth'), a.badge])).toEqual([color('blue'), 2.5, null])
        at(1, () => {
            expect([rgb(a.shape.get('stroke')), a.shape.get('strokeWidth')]).toEqual([color('yellow'), 5])
            expect([rgb(b.shape.get('stroke')), b.shape.get('strokeWidth'), b.badge!.get('visible'), b.badge!.get('opacity')]).toEqual([color('green'), 2.5, true, 1])
            expect(c.shape.get('dash')).not.toBeNull()
            expect(rgb(c.caption!.leaves()[0]!.get('fill'))).toEqual(color('dim'))
        })
        // The mark of a badge is a check for done and a cross for failed: two lines, not one.
        const sign = b.badge!.children[1]!
        expect(at(1, () => sign.get('path')!.length)).toBe(1)
        expect(at(2, () => sign.get('path')!.length)).toBe(2)
        at(2, () => {
            expect(rgb(b.shape.get('stroke'))).toEqual(color('red'))
            // Idle gives the node the look that it was built with: its own color, a line with no dashes, text in ink.
            expect([rgb(c.shape.get('stroke')), c.shape.get('dash'), rgb(c.caption!.leaves()[0]!.get('fill'))]).toEqual([color('blue'), null, color('ink')])
        })
        // The badge is at the top right corner of the node, outside its label.
        const label = at(2, () => b.caption!.bounds()), badge = at(2, () => b.badge!.bounds())
        expect(badge.x).toBeGreaterThan(label.x + label.width)
        expect(badge.y + badge.height / 2).toBeLessThan(at(2, () => b.bounds().y + b.bounds().height / 2))
    })

    it('a state in the spec of a node is its look from the first frame, with its sign', async () => {
        let g!: G
        const f = await compile((s) => {
            g = s.add(graph([{ id: 'a', label: 'a', state: 'done', at: [0, 0] }, { id: 'b', label: 'b', state: 'off', at: [200, 0] }], [], { layout: 'manual' }))
            s.wait(0.5)
        })
        expect(g.stateOf('a')).toBe('done')
        expect(at(0, () => [rgb(g.node('a').shape.get('stroke')), g.node('a').badge!.get('opacity'), g.node('b').shape.get('dash') !== null])).toEqual([color('green'), 1, true])
        expect(f.duration).toBeCloseTo(0.5)
        expect(await fails((s) => { s.add(graph([{ id: 'a', state: 'ready' as 'done' }], [])) })).toMatch(/the state of the node "a" is "ready". The states are idle, active, done, failed, off/)
    })

    it('setState in a sequence chains, and two changes of one node at one time are an error that names both', async () => {
        let g!: G
        await compile((s) => {
            g = s.add(chain())
            s.play(seq(g.setState('a', 'active'), g.setState('a', 'done')), { duration: 2 })
        })
        expect(at(1, () => g.node('a').shape.get('strokeWidth'))).toBe(5)
        expect(at(2, () => [g.node('a').shape.get('strokeWidth'), g.node('a').badge!.get('opacity')])).toEqual([2.5, 1])
        expect(g.stateOf('a')).toBe('done')
        const message = await fails((s) => {
            const made = s.add(chain())
            s.play(made.setState('a', 'active'), made.setState('a', 'done'))
        })
        expect(message).toMatch(/graph: setState\("a", "done"\) plays from 0 s to 0.5 s, and setState\("a", "active"\) plays from 0 s to 0.5 s. Both change the look of the node "a"/)
        expect(message).toMatch(/Play the two in a `seq`/)
        expect(await fails((s) => { s.play(s.add(chain()).setState('a', 'ready' as 'done')) })).toMatch(/setState: no state "ready". The states are idle, active, done, failed, off/)
        expect(await fails((s) => { s.play(s.add(chain()).setState('z', 'done')) })).toMatch(/graph: setState: no node "z". The nodes are "a", "b", "c"/)
    })

    it('a node with a value is a box that holds its label over its value, and a note is under the box', async () => {
        let g!: G
        await compile((s) => {
            g = s.add(graph([{ id: 'w', label: 'weight', value: '3.25', note: 'grad 4' }, { id: 'x', label: 'x', value: '2' }], [{ from: 'w', to: 'x' }]))
        })
        const w = g.node('w')
        expect(w.round).toBe(false)
        const box = w.shape.bounds(), label = w.caption!.bounds(), value = w.value!.bounds(), note = w.note!.bounds()
        for (const part of [label, value]) {
            expect(part.x).toBeGreaterThan(box.x)
            expect(part.x + part.width).toBeLessThan(box.x + box.width)
            expect(part.y).toBeGreaterThan(box.y)
            expect(part.y + part.height).toBeLessThan(box.y + box.height)
        }
        expect(label.y + label.height).toBeLessThan(value.y)
        expect(note.y).toBeGreaterThan(box.y + box.height)
        // The texts are centered on the box.
        expect(value.x + value.width / 2).toBeCloseTo(box.x + box.width / 2, 0)
        expect(note.x + note.width / 2).toBeCloseTo(box.x + box.width / 2, 0)
        expect([g.valueOf('w'), g.noteOf('w'), g.noteOf('x')]).toEqual(['3.25', 'grad 4', null])
        // The bottom point of a node with a note is under the note.
        expect(g.p('w')[1]).toBeGreaterThan(g.p('x')[1])
        expect(g.toWorld(...g.p('w'))[1]).toBeGreaterThanOrEqual(note.y + note.height)
        expect(g.p('x', 'left')).toEqual([g.node('x').get('x') - g.node('x').halfWidth, g.node('x').get('y')])
        expect(await fails((s) => { s.add(graph([{ id: 'a', label: 'a', value: 'a long value for a box', width: 100 }], [])) })).toMatch(/graph: the texts of the node "a" are \d+ px wide, and its box is 100 px wide.*Give the node a width of \d+ or more, or shorter texts/)
        expect(await fails((s) => { s.add(graph([{ id: 'a', value: 3 as unknown as string }], [])) })).toMatch(/the value of the node "a" is 3. A value is a text, such as "3"/)
    })

    it('lets a clone continue a tree search independently after the original tree has changed', async () => {
        let source!: T, copy!: T, next!: T
        await compile((s) => {
            source = words({ shown: 1, token: 'the' })
            const holder = s.add(group(source))
            s.play(source.go('ran'), source.setValue('ran', '0.59'))
            s.play(source.path('ran'))
            const other = s.add(holder.clone().at(0, 250))
            copy = other.children[0] as T
            s.play(copy.grow('home'))
            s.play(copy.go('home'), copy.setValue('ran', '0.58'))
            s.play(copy.prune('slept'))
            s.play(copy.path('home'))
            next = s.add(copy.clone())
            s.play(next.go('ran'), next.setValue('ran', '0.57'))
            s.play(next.path('ran'))
        })
        expect([next.current, next.valueOf('ran'), next.litPath]).toEqual(['ran', '0.57', ['the', 'ran']])
        expect(next.node('ran')).not.toBe(copy.node('ran'))
        expect(copy.node('ran')).not.toBe(source.node('ran'))
        expect(copy.nodeLayer.children).toContain(copy.node('ran'))
        expect([source.current, copy.current]).toEqual(['ran', 'home'])
        expect([source.valueOf('ran'), copy.valueOf('ran')]).toEqual(['0.59', '0.58'])
        expect([source.isShown('home'), copy.isShown('home')]).toEqual([false, true])
        expect([source.stateOf('slept'), copy.stateOf('slept')]).toEqual(['idle', 'off'])
        expect([source.litPath, copy.litPath]).toEqual([['the', 'ran'], ['the', 'ran', 'home']])
    })

    it('setValue and setNote change a text in place, and no moment shows two texts', async () => {
        let g!: G, old!: Node
        const f = await compile((s) => {
            g = s.add(graph([{ id: 'w', label: 'weight', value: '3', note: '', width: 160 }], []))
            old = g.node('w').value!
            s.play(seq(g.setValue('w', '2.6'), g.setValue('w', '2.2')), g.setNote('w', 'grad 4'), { duration: 2 })
        })
        expect([g.valueOf('w'), g.noteOf('w')]).toEqual(['2.2', 'grad 4'])
        const last = g.node('w').value!
        expect((last as TextNode).source).toBe('2.2')
        const shows = (node: Node, time: number) => at(time, () => node.get('visible') && node.get('opacity') > 0.001)
        for (const time of [0.05, 0.3, 0.5, 0.7, 0.95, 1.2, 1.5, 1.8, 2]) {
            const texts = g.node('w').children.filter((child) => child instanceof TextNode && ['3', '2.6', '2.2'].includes(child.source))
            expect(texts.filter((node) => shows(node, time)).length).toBeLessThanOrEqual(1)
        }
        expect(shows(old, 0.1)).toBe(true)
        expect(shows(old, 2)).toBe(false)
        expect(shows(last, 2)).toBe(true)
        // The new value is at the place of the old one.
        expect(at(2, () => last.bounds().y)).toBeCloseTo(at(0, () => old.bounds().y), 0)
        // The patch under the note has the size of the new note, so a line passes behind the text.
        const plate = g.node('w').notePlate!, note = at(2, () => g.node('w').note!.bounds())
        expect(at(0, () => plate.get('path')!.length)).toBe(0)
        expect(at(2, () => plate.bounds().width)).toBeGreaterThan(note.width)
        expect(f.duration).toBeCloseTo(2)
        // Two changes of one value at one time: the node ends on the last one, and the text of the first does not show under it.
        let twice!: G
        await compile((s) => {
            twice = s.add(graph([{ id: 'w', label: 'weight', value: '3', width: 160 }], []))
            s.play(twice.setValue('w', '4'), twice.setValue('w', '5'), { duration: 1 })
        })
        expect(twice.valueOf('w')).toBe('5')
        const left = twice.node('w').children.filter((child): child is TextNode => child instanceof TextNode && ['3', '4', '5'].includes(child.source))
        for (const time of [0.2, 0.5, 0.8, 1]) expect(left.filter((node) => shows(node, time)).map((node) => node.source).filter((source) => source !== (time < 0.5 ? '3' : '5'))).toEqual([])
        expect(left.filter((node) => shows(node, 1)).map((node) => node.source)).toEqual(['5'])
        expect(await fails((s) => { s.play(s.add(chain()).setValue('a', '1')) })).toMatch(/graph: setValue: the node "a" was built with no value, so it has no room for one. Give the node a value when you build the graph, such as value: ''/)
        const wide = await fails((s) => { s.play(s.add(graph([{ id: 'a', label: 'a', value: '' }], [])).setValue('a', '1,234,567')) })
        expect(wide).toMatch(/setValue: the value "1,234,567" of the node "a" is \d+ px wide, and its box has \d+ px for a text. Give the node a width of (\d+) or more/)
        const least = Number(/a width of (\d+) or more/.exec(wide)![1])
        expect(await fails((s) => { s.play(s.add(graph([{ id: 'a', label: 'a', value: '', width: least }], [])).setValue('a', '1,234,567')) })).toBe('no error')
        expect(await fails((s) => { s.play(s.add(graph([{ id: 'a', label: 'a', value: '' }], [])).setNote('a', 'x')) })).toMatch(/setNote: the node "a" was built with no note/)
    })

    it('send runs a light in the direction that the call names, and the node at the end takes its value when the light arrives', async () => {
        let g!: G
        await compile((s) => {
            g = s.add(graph([{ id: 'a', label: 'a', value: '1', note: '', at: [-300, 0] }, { id: 'b', label: 'b', value: '', note: '', at: [300, 0] }], [{ from: 'a', to: 'b' }], { layout: 'manual' }))
            s.play(g.send('a', 'b', { value: '2' }), { duration: 1 })
            s.play(g.send('b', 'a', { note: 'grad 2', color: 'pink' }), { duration: 1 })
        })
        const edge = g.edge('a', 'b'), path = edge.shaft.get('path')!
        const [forward, back] = edge.children.filter((child) => child !== edge.shaft && child !== edge.tip)
        const middle = (light: Node, time: number) => at(time, () => pointAt(path, (light.get('trimFrom') + light.get('trimTo')) / 2)[0])
        // Forward: the light starts near a, at the left, and goes right.
        expect(middle(forward!, 0.15)).toBeLessThan(-100)
        expect(middle(forward!, 0.6)).toBeGreaterThan(100)
        // Back: on the same edge, the light starts near b and goes left.
        expect(middle(back!, 1.15)).toBeGreaterThan(100)
        expect(middle(back!, 1.6)).toBeLessThan(-100)
        expect(rgb(at(1.3, () => back!.get('stroke')))).toEqual(color('pink'))
        // A light shows only while it runs.
        expect([at(0.5, () => forward!.get('visible')), at(1.01, () => forward!.get('visible')), at(0.5, () => back!.get('visible'))]).toEqual([true, false, false])
        expect([g.valueOf('b'), g.noteOf('a'), g.noteOf('b')]).toEqual(['2', 'grad 2', ''])
        // The value changes when the light arrives, not when it starts.
        const value = g.node('b').value!
        expect(at(0.65, () => value.get('visible') && value.get('opacity') > 0)).toBeFalsy()
        expect(at(1, () => [value.get('visible'), value.get('opacity')])).toEqual([true, 1])
        expect(lightOf(edge)).toBe(back)
        // In a default layout, the edge between two nodes with notes is a level line: the notes lift both nodes by the same room.
        let level!: G
        await compile((s) => {
            level = s.add(graph([{ id: 'a', label: 'a', value: '1', note: 'one' }, { id: 'b', label: 'b', value: '2', note: 'two' }], [{ from: 'a', to: 'b', label: 'times 2' }]))
            s.play(level.send('a', 'b'))
        })
        const line = level.edge('a', 'b')
        expect(pathBounds(line.shaft.get('path')!)!.height).toBeLessThan(0.01)
        expect(line.shaft.bounds().y).toBeCloseTo(level.node('a').shape.bounds().y + level.node('a').shape.bounds().height / 2, 3)
        // The light is a part of the edge, under its label: it passes behind the label, as the line does.
        const light = line.children.find((child) => child !== line.shaft && child !== line.tip && child !== line.caption)!
        expect(line.children.indexOf(light)).toBeLessThan(line.children.indexOf(line.caption!))
        expect(line.children.indexOf(light)).toBeGreaterThan(line.children.indexOf(line.shaft))
        expect(await fails((s) => { s.play(s.add(chain()).send('a', 'c')) })).toMatch(/graph: send: no edge joins "a" and "c". The edges of "a" join it to "b"/)
    })

    it('replaces a value and note by arrival time when parallel signals reach the same node', async () => {
        for (const longFirst of [true, false]) {
            for (const final of ['late', 'start']) {
                let g!: G
                await compile((s) => {
                    g = s.add(graph([{ id: 'a' }, { id: 'b' }, { id: 'c', value: 'start', note: 'start note', width: 160 }], [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }]))
                    const slow = g.send('a', 'c', { duration: 2, value: final, note: final + ' note' })
                    const fast = g.send('b', 'c', { duration: 1, value: 'early', note: 'early note' })
                    s.play(...(longFirst ? [slow, fast] : [fast, slow]))
                })
                const visible = (time: number) => at(time, () => g.node('c').children
                    .filter((n): n is TextNode => n instanceof TextNode && n.get('visible') && n.get('opacity') > 0.001)
                    .map((n) => n.source).sort())
                expect(visible(0.9)).toEqual(['start', 'start note'])
                expect(visible(1.6)).toEqual(['early', 'early note'])
                expect(visible(2.5)).toEqual([final, final + ' note'])
                expect([g.valueOf('c'), g.noteOf('c')]).toEqual([final, final + ' note'])
                for (const time of [1.1, 1.25, 1.4, 2.1, 2.25, 2.4]) expect(visible(time).length).toBeLessThanOrEqual(2)
            }
        }
    })

    it('refuses partially overlapping replacements of one field in either call order', async () => {
        for (const longFirst of [true, false]) {
            expect(await fails((s) => {
                const g = s.add(graph([{ id: 'a' }, { id: 'c', value: '0', width: 160 }], [{ from: 'a', to: 'c' }]))
                const first = g.send('a', 'c', { duration: 1, value: '1' })
                const second = g.send('a', 'c', { duration: 1.25, value: '2' })
                s.play(...(longFirst ? [second, first] : [first, second]))
            })).toMatch(/two changes to the value of node "c" overlap/)
        }
    })

    it('send uses duration for travel and changes a value only after arrival', async () => {
        let g!: G
        const f = await compile((s) => {
            g = s.add(graph([{ id: 'a', value: '1', width: 120 }, { id: 'b', value: '', width: 120 }], [{ from: 'a', to: 'b' }]))
            s.play(g.send('a', 'b', { duration: 2, value: '2' }))
        })
        expect(f.duration).toBe(2.5)
        const light = lightOf(g.edge('a', 'b'))
        expect(at(1.9, () => light.get('visible'))).toBe(true)
        expect(at(2.01, () => light.get('visible'))).toBe(false)
        expect(at(1.99, () => g.node('b').value!.get('visible'))).toBe(false)
        expect(at(2.5, () => g.node('b').value!.get('opacity'))).toBe(1)
        for (const duration of [0, -1, NaN, Infinity]) {
            expect(await fails((s) => { s.add(chain()).send('a', 'b', { duration }) })).toMatch(/send: duration is the travel time/)
        }
        for (const length of [0, -1, 1.1, NaN, Infinity]) {
            expect(await fails((s) => { s.add(chain()).send('a', 'b', { length }) })).toMatch(/send: length is the share of the edge/)
        }
    })

    it('go moves the token along an edge, and current is the new node', async () => {
        let g!: G
        const f = await compile((s) => {
            g = s.add(chain({ token: 'a' }))
            s.wait(0.5)
            s.play(seq(g.go('b'), g.go('c')), { duration: 2 })
        })
        expect(g.current).toBe('c')
        const ring = (id: string, time: number) => at(time, () => g.node(id).ring!.get('opacity'))
        expect([ring('a', 0), ring('b', 0), ring('c', 0)]).toEqual([1, 0, 0])
        expect([ring('a', 1.5), ring('b', 1.5), ring('c', 1.5)]).toEqual([0, 1, 0])
        expect([ring('a', f.duration), ring('b', f.duration), ring('c', f.duration)]).toEqual([0, 0, 1])
        // The dot is on the edge while it moves, between the two nodes, and it does not show at rest.
        const dot = g.edge('a', 'b').token!
        const [x, y, opacity] = at(1, () => [dot.get('x'), dot.get('y'), dot.get('opacity')])
        expect(x).toBeGreaterThan(-300 + 30)
        expect(x).toBeLessThan(-30)
        expect(y).toBeCloseTo(0, 6)
        expect(opacity).toBe(1)
        expect([at(0.25, () => dot.get('opacity')), at(1.5, () => dot.get('opacity')), at(f.duration, () => dot.get('opacity'))]).toEqual([0, 0, 0])
        // The second move starts where the first one ended.
        expect(at(2, () => g.edge('b', 'c').token!.get('x'))).toBeGreaterThan(30)
    })

    it('keeps the token on a moving edge and its label above the token', async () => {
        for (const moveFirst of [true, false]) {
            let g!: G
            await compile((s) => {
                g = s.add(graph([{ id: 'a', at: [-250, 0] }, { id: 'b', at: [250, 0] }], [{ from: 'a', to: 'b', label: 'step' }], { layout: 'manual', token: 'a' }))
                const travel = g.go('b'), move = g.moveNode('b', [250, 300])
                s.play(...(moveFirst ? [move, travel] : [travel, move]), { duration: 1, ease: linear })
            })
            const edge = g.edge('a', 'b')
            const position = at(0.5, () => pointAt(edge.shaft.get('path')!, 0.5))
            expect(position[1]).toBeGreaterThan(30)
            expect(at(0.5, () => [edge.token!.get('x'), edge.token!.get('y')])).toEqual(position)
            expect(edge.children.indexOf(edge.caption!)).toBeGreaterThan(edge.children.indexOf(edge.token!))
            expect(at(0.5, () => edge.caption!.get('y'))).toBeGreaterThan(30)
            expect(at(1, () => g.node('b').ring!.get('opacity'))).toBe(1)
        }
    })

    it('gives an arriving value the state color in either scheduling order', async () => {
        for (const sendFirst of [true, false]) {
            let g!: G
            await compile((s) => {
                g = s.add(graph([{ id: 'a' }, { id: 'b', value: '', width: 120 }], [{ from: 'a', to: 'b' }]))
                const send = g.send('a', 'b', { value: '2' }), off = g.setState('b', 'off')
                s.play(...(sendFirst ? [send, off] : [off, send]), { duration: 1 })
            })
            expect(g.stateOf('b')).toBe('off')
            const value = g.node('b').value!
            expect(rgb(at(1, () => value.leaves()[0]!.get('fill')))).toEqual(color('dim'))
        }
    })

    it('explains the order when a later state change was already scheduled', async () => {
        expect(await fails((s) => {
            const g = s.add(chain())
            s.at(2, () => s.play(g.setState('a', 'done')))
            s.at(0, () => s.play(g.setState('a', 'active')))
        })).toMatch(/schedule changes to the look of node "a" in time order/)
    })

    it('keeps parent links acyclic when a tree mixes named and unnamed nodes', async () => {
        let t!: T
        await compile((s) => {
            t = s.add(tree({ id: 'n0', children: [{ label: 'leaf' }] }))
            s.play(t.path('n1'))
        })
        expect(t.litPath).toEqual(['n0', 'n1'])
        expect(await fails((s) => { s.add(tree({ id: 'r', children: [{ id: 'r' }] })) })).toMatch(/two nodes have the id "r"/)
    })

    it('keeps a hidden pruned branch off when a later call tries to reopen it', async () => {
        expect(await fails((s) => {
            const t = s.add(words({ shown: 0 }))
            s.play(t.prune('ran'))
            s.play(t.setState('home', 'idle'))
        })).toMatch(/"home" is in a pruned branch/)
    })

    it('go follows the arrows: a step with no edge is an error that names the steps that work', async () => {
        const back = await fails((s) => {
            const g = s.add(chain({ token: 'b' }))
            s.play(g.go('a'))
        })
        expect(back).toMatch(/graph: go: no edge goes from "b", where the token is, to "a". From "b", the token can go to "c". For a step that the machine refuses, play refuse\("a"\)/)
        // A line with no arrow takes the token both ways.
        let g!: G
        await compile((s) => {
            g = s.add(chain({ token: 'b', directed: false }))
            s.play(g.go('a'))
        })
        expect(g.current).toBe('a')
        expect(await fails((s) => { s.play(s.add(chain()).go('b')) })).toMatch(/graph: go: this graph has no token. Give the option token the id of the node where the token starts/)
        expect(await fails((s) => { s.add(chain({ token: 'z' })) })).toMatch(/graph: token: no node "z". The nodes are "a", "b", "c"/)
        const twice = await fails((s) => {
            const made = s.add(chain({ token: 'a' }))
            s.play(made.go('b'), made.go('c'))
        })
        expect(twice).toMatch(/graph: go\("c"\) plays from 0 s to 0.9 s, and go\("b"\) plays from 0 s to 0.9 s. The token makes one move at a time. Play the two in a `seq`/)
    })

    it('a tree takes a token, which goes down an edge and up again', async () => {
        let t!: T
        await compile((s) => {
            t = s.add(words({ token: 'the' }))
            s.play(seq(t.go('ran'), t.go('home'), t.go('ran')), { duration: 3 })
        })
        expect(t.current).toBe('ran')
        expect(at(3, () => [t.node('ran').ring!.get('opacity'), t.node('home').ring!.get('opacity'), t.node('the').ring!.get('opacity')])).toEqual([1, 0, 0])
        expect(await fails((s) => { s.play(s.add(words({ token: 'the' })).go('home')) })).toMatch(/tree: go: no edge goes from "the", where the token is, to "home". From "the", the token can go to "ran", "slept"/)
    })

    it('refuse sends the token a part of the way and back, with a red ring, and current does not change', async () => {
        let g!: G
        await compile((s) => {
            g = s.add(chain({ token: 'a' }))
            s.play(g.refuse('b'), { duration: 1 })
            // No edge joins a and c: the token tries the straight line.
            s.play(g.refuse('c'), { duration: 1 })
        })
        expect(g.current).toBe('a')
        const ring = g.node('a').ring!, dot = g.edge('a', 'b').token!
        expect(at(2, () => ring.get('opacity'))).toBe(1)
        expect(rgb(at(0.6, () => ring.get('stroke')))).toEqual(color('red'))
        expect(rgb(at(1, () => ring.get('stroke')))).toEqual(color('yellow'))
        const start = at(0.11, () => dot.get('x')), far = at(0.5, () => dot.get('x')), end = at(0.9, () => dot.get('x'))
        expect(far).toBeGreaterThan(start + 40)
        // The dot turns before the middle of the edge, and comes back to where it started.
        expect(far).toBeLessThan(-150)
        expect(end).toBeCloseTo(start, 0)
        expect(at(1.5, () => g.children.at(-1)!.get('x'))).toBeGreaterThan(start + 40)
        expect(await fails((s) => { s.play(s.add(chain({ token: 'a' })).refuse('a')) })).toMatch(/refuse: the token is at "a". Name the node that the machine does not let it go to/)
        // The dot turns before the label of the edge, so that it does not stop on the text.
        let named!: G
        await compile((s) => {
            named = s.add(graph([{ id: 'a', label: 'a', at: [-200, 0] }, { id: 'b', label: 'b', at: [200, 0] }], [{ from: 'a', to: 'b', label: 'slow', labelAt: 0.34 }], { layout: 'manual', token: 'a' }))
            s.play(named.refuse('b'), { duration: 1 })
        })
        const plate = named.edge('a', 'b').caption!.children[0]!.bounds(), token = named.edge('a', 'b').token!
        const reach = Math.max(...[0.3, 0.4, 0.5, 0.6, 0.7].map((time) => at(time, () => token.bounds().x + token.bounds().width)))
        expect(reach).toBeLessThan(plate.x)
        expect(reach).toBeGreaterThan(named.node('a').shape.bounds().x + named.node('a').shape.bounds().width)
    })

    it('shown keeps nodes and their edges off the stage, and grow brings a node after the edge that leads to it', async () => {
        let g!: G
        const f = await compile((s) => {
            g = s.add(chain({ shown: ['a'] }))
            s.wait(0.5)
            s.play(g.grow('b'), { duration: 1 })
            s.play(g.grow(['a', 'c']), { duration: 1 })
        })
        expect([g.isShown('a'), g.isShown('b'), g.isShown('c')]).toEqual([true, true, true])
        const b = g.node('b'), ab = g.edge('a', 'b'), bc = g.edge('b', 'c')
        expect(at(0.4, () => [g.node('a').get('visible'), b.get('visible'), ab.get('visible'), bc.get('visible')])).toEqual([true, false, false, false])
        // The edge from a draws first, and b pops in at its end.
        expect(at(0.8, () => ab.shaft.get('trimTo'))).toBeGreaterThan(0.3)
        expect(at(0.8, () => b.get('sx'))).toBeLessThan(0.01)
        expect(at(1.5, () => [b.get('visible'), b.get('sx'), ab.get('visible'), ab.shaft.get('trimTo')])).toEqual([true, 1, true, 1])
        expect(at(1.4, () => [g.node('c').get('visible'), bc.get('visible')])).toEqual([false, false])
        expect(at(f.duration, () => [g.node('c').get('visible'), g.node('c').get('sx'), bc.get('visible'), bc.shaft.get('trimTo')])).toEqual([true, 1, true, 1])
        // A node that shows already takes no part of the time and does not arrive again: c has the whole second, so its edge draws from the start of it.
        const drawn = at(1.7, () => (bc.get('visible') ? bc.shaft.get('trimTo') : -1))
        expect(drawn).toBeGreaterThan(0.05)
        expect(drawn).toBeLessThan(1)
        expect(at(1.6, () => g.node('a').get('sx'))).toBe(1)
        expect(await fails((s) => { s.add(chain({ shown: ['z'] })) })).toMatch(/graph: shown: no node "z"/)
        expect(await fails((s) => { s.play(s.add(chain()).grow('z')) })).toMatch(/graph: grow: no node "z"/)
        // The token cannot start on a node that waits, and it cannot take an edge that waits.
        expect(await fails((s) => { s.add(chain({ shown: ['a'], token: 'b' })) })).toMatch(/the token starts at the node "b", which does not show at the start/)
        expect(await fails((s) => { s.play(s.add(chain({ shown: ['a'], token: 'a' })).go('b')) })).toMatch(/no edge goes from "a".*No edge leaves "a"/)
    })

    it('enter of a graph with nodes that wait leaves them for their grow, at full size', async () => {
        let g!: G, t!: T
        await compile((s) => {
            g = s.add(chain({ shown: ['a'] }))
            t = s.add(words({ shown: 0 }))
            s.play(g.enter(), t.enter(), { duration: 1 })
            s.play(g.grow('b'), t.grow('ran'), { duration: 0.5 })
        })
        expect(at(0.95, () => [g.node('b').get('visible'), t.node('ran').get('visible')])).toEqual([false, false])
        expect(at(1.5, () => [g.node('b').get('sx'), t.node('ran').get('sx'), t.node('ran').get('visible')])).toEqual([1, 1, true])
        expect(at(1, () => t.node('the').get('sx'))).toBe(1)
        // A node that waits takes no turn: with b off the stage, c is the second of two nodes, not the third of three.
        let two!: G, three!: G
        await compile((s) => {
            two = s.add(chain({ shown: ['a', 'c'] }))
            three = s.add(chain())
            s.play(two.enter(), three.enter(), { duration: 1 })
        })
        expect(at(0.14, () => two.node('c').get('sx'))).toBeGreaterThan(0.001)
        expect(at(0.14, () => three.node('c').get('sx'))).toBeCloseTo(0.001, 6)
    })

    it('keeps the default graph layout when old films pass width and height without fit', async () => {
        let plain!: G, sized!: G
        const nodes = [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }]
        const links = [{ from: 'a', to: 'b', label: 'x' }]
        await compile((s) => {
            plain = s.add(graph(nodes, links))
            sized = s.add(graph(nodes, links, { width: 10, height: 10 }))
        })
        for (const id of ['a', 'b']) expect(sized.p(id)).toEqual(plain.p(id))
        expect(sized.edge('a', 'b').shaft.get('path')).toEqual(plain.edge('a', 'b').shaft.get('path'))
    })

    it('fit spreads the default graph layout to its width and height, and a size with no room names the size that works', async () => {
        const nodes = [{ id: 'a', label: 'plan', width: 160 }, { id: 'b', label: 'act', width: 160 }, { id: 'c', label: 'observe', width: 160 }, { id: 'd', label: 'answer', width: 160 }]
        const links = [{ from: 'a', to: 'b', label: 'tool call' }, { from: 'b', to: 'c' }, { from: 'a', to: 'd' }]
        const size = (g: G) => {
            const boxes = [...g.nodes.values()].map((node) => node.shape.bounds())
            return [Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x)), Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y))]
        }
        let plain!: G, wide!: G, both!: G, fit!: G
        await compile((s) => {
            plain = s.add(graph(nodes, links))
            wide = s.add(graph(nodes, links, { fit: true, width: 1400 }))
            both = s.add(graph(nodes, links, { fit: true, width: 1000, height: 500 }))
            fit = s.add(fitted(1200, (width) => graph(nodes, links, { fit: true, width })))
        })
        expect(size(wide)[0]).toBeCloseTo(1400, 3)
        expect(size(wide)[1]).toBeCloseTo(size(plain)[1], 3)
        expect(size(both)[0]).toBeCloseTo(1000, 3)
        expect(size(both)[1]).toBeCloseTo(500, 3)
        expect(boxOf(fit).width).toBeCloseTo(1200, 0)
        // The order of the layout stays: the nodes keep their order from left to right.
        const order = (g: G) => ['a', 'b', 'c', 'd'].sort((p, q) => g.node(p).get('x') - g.node(q).get('x') || g.node(p).get('y') - g.node(q).get('y'))
        expect(order(wide)).toEqual(order(plain))
        // The graph is centered on its place, also when its first node is wider than its last one.
        const left = Math.min(...[...wide.nodes.values()].map((node) => node.shape.bounds().x))
        expect(left).toBeCloseTo(-700, 3)
        let uneven!: G
        await compile((s) => {
            uneven = s.add(graph([{ id: 'a', label: 'a wide first node', width: 400 }, { id: 'b', label: 'b', width: 80 }], [{ from: 'a', to: 'b' }], { fit: true, width: 1000 }))
        })
        expect([uneven.node('a').shape.bounds().x, uneven.node('b').shape.bounds().x + 80].map((x) => Math.round(x * 1000) / 1000)).toEqual([-500, 500])
        const narrow = await fails((s) => { s.add(graph(nodes, links, { fit: true, width: 620 })) })
        expect(narrow).toMatch(/graph: a width of 620 leaves no room between the nodes "a" and "b". Give a width of (\d+) or more, shorter labels, or fewer nodes side by side/)
        const least = Number(/a width of (\d+) or more/.exec(narrow)![1])
        expect(await fails((s) => { s.add(graph(nodes, links, { fit: true, width: least })) })).toBe('no error')
        expect(await fails((s) => { s.add(graph(nodes, links, { fit: true, width: least - 2 })) })).toMatch(/leaves no room/)
        expect(await fails((s) => { s.add(graph(nodes, links, { fit: true, width: 100 })) })).toMatch(/graph: a width of 100 is less than the width of the largest node, which is 160/)
    })

    it('a tree with a value has boxes of one size, with text sizes that a viewer reads', async () => {
        let t!: T
        await compile((s) => {
            t = s.add(words())
        })
        const sizes = [...t.nodes.values()].map((node) => [node.halfWidth, node.halfHeight, node.round])
        expect(new Set(sizes.map((size) => size.join())).size).toBe(1)
        expect(sizes[0]![2]).toBe(false)
        for (const node of t.nodes.values()) {
            const box = node.shape.bounds()
            for (const part of [node.caption!.bounds(), node.value!.bounds()]) {
                expect(part.x).toBeGreaterThan(box.x)
                expect(part.x + part.width).toBeLessThan(box.x + box.width)
                expect(part.y).toBeGreaterThan(box.y)
                expect(part.y + part.height).toBeLessThan(box.y + box.height)
            }
        }
        expect([(t.node('ran').caption as TextNode).size, (t.node('ran').value as TextNode).size, (t.edge('the', 'ran').caption!.children[1] as TextNode).size]).toEqual([28, 26, 26])
        // A tree of circles keeps the sizes that it had.
        let circles!: T
        await compile((s) => {
            circles = s.add(tree({ id: 'r', label: 'r', children: [{ id: 'c', label: 'c' }] }))
        })
        expect([(circles.node('r').caption as TextNode).size, circles.node('r').halfWidth]).toEqual([24, 28])
        expect(await fails((s) => { s.add(words({ shape: 'circle' })) })).toMatch(/tree: a circle has no room for a value. Give shape: 'box'/)
        const narrow = await fails((s) => { s.add(words({ nodeWidth: 90 })) })
        expect(narrow).toMatch(/tree: a nodeWidth of 90 has no room for the texts of the node "[^"]+", which are \d+ px wide. Give a nodeWidth of (\d+) or more/)
        expect(await fails((s) => { s.add(words({ nodeWidth: Number(/nodeWidth of (\d+) or more/.exec(narrow)![1]) })) })).toBe('no error')
    })

    it('the score of a tree is the product or the sum of the weights on the way, and each node shows it', async () => {
        let t!: T, sum!: T
        await compile((s) => {
            t = s.add(words({ format: (value) => value.toFixed(3) }))
            sum = s.add(words({ score: 'sum' }))
        })
        expect(t.score('the')).toBe(1)
        expect(t.score('soundly')).toBeCloseTo(0.36, 12)
        expect(t.score('home')).toBeCloseTo(0.21, 12)
        expect([t.valueOf('the'), t.valueOf('soundly'), t.valueOf('home')]).toEqual(['1.000', '0.360', '0.210'])
        expect((t.node('soundly').value as TextNode).source).toBe('0.360')
        expect((t.edge('slept', 'soundly').caption!.children[1] as TextNode).source).toBe('0.900')
        expect([sum.score('the'), sum.valueOf('the'), sum.valueOf('soundly')]).toEqual([0, '0', '1.30'])
        expect(await fails((s) => { s.add(tree({ id: 'r', label: 'r', children: [{ id: 'a', label: 'a' }] }, { score: 'product' })) })).toMatch(/tree: with score: 'product', each node under the root has a weight, and the node "a" has none. Give it a weight, such as weight: 0.5/)
        expect(await fails((s) => { s.add(tree({ id: 'r', label: 'r', children: [{ id: 'a', label: 'a' }] })).score('a') })).toMatch(/tree: score: this tree has no score. Give the option score: 'product' or 'sum'/)
    })

    it('the label of an edge of a tree is on its line, nearer to the child, and labels that meet are an error', async () => {
        let t!: T
        await compile((s) => {
            t = s.add(tree({ id: 'r', label: 'root', value: '8', children: [{ id: 'a', label: 'left', value: '5', edge: 'at most 3.35' }, { id: 'b', label: 'right', value: '3', edge: 'more' }] }, { width: 1000 }))
        })
        const plate = t.edge('r', 'a').caption!.children[0]!.bounds(), parent = t.node('r').shape.bounds(), child = t.node('a').shape.bounds()
        const [cx, cy] = [plate.x + plate.width / 2, plate.y + plate.height / 2]
        // On the line from the middle of the bottom of the parent to the middle of the top of the child.
        const from = [parent.x + parent.width / 2, parent.y + parent.height], to = [child.x + child.width / 2, child.y]
        const share = (cy - from[1]!) / (to[1]! - from[1]!)
        expect(cx).toBeCloseTo(from[0]! + (to[0]! - from[0]!) * share, -1)
        expect(share).toBeGreaterThan(0.5)
        expect(share).toBeLessThan(0.7)
        // Clear of both boxes.
        expect(plate.y).toBeGreaterThan(parent.y + parent.height)
        expect(plate.y + plate.height).toBeLessThan(child.y)
        expect((t.edge('r', 'a').caption!.children[1] as TextNode).source).toBe('at most 3.35')
        const close = await fails((s) => { s.add(tree({ id: 'r', label: 'r', value: '', children: [{ id: 'a', label: 'a', value: '', edge: 'a long condition' }, { id: 'b', label: 'b', value: '', edge: 'another long one' }] })) })
        expect(close).toMatch(/tree: the labels of the edges to "a" and "b" meet. Give a larger siblingGap or width \(the siblingGap is \d+ now\), shorter labels, or a smaller edgeLabelSize/)
        const low = await fails((s) => { s.add(tree({ id: 'r', label: 'r', value: '', children: [{ id: 'a', label: 'a', value: '', edge: 'yes' }] }, { levelGap: 110 })) })
        expect(low).toMatch(/tree: the label of the edge to "a" has no room between the levels: it meets the node "(r|a)". Give a larger levelGap \(the levelGap is 110 now\)/)
    })

    it('a tree grows one node at a time, each after its parent', async () => {
        let t!: T
        const f = await compile((s) => {
            t = s.add(words({ shown: 0 }))
            s.wait(0.5)
            s.play(t.grow(['ran', 'slept']), { duration: 1 })
            s.play(t.grow(['home']), { duration: 0.5 })
        })
        expect(['the', 'ran', 'slept', 'home', 'away'].map((id) => t.isShown(id))).toEqual([true, true, true, true, false])
        expect(at(0.4, () => ['the', 'ran', 'slept'].map((id) => t.node(id).get('visible')))).toEqual([true, false, false])
        // One node after another: ran is there before slept.
        expect(at(1, () => [t.node('ran').get('sx') > 0.5, t.node('slept').get('sx') < 0.5])).toEqual([true, true])
        expect(at(f.duration, () => ['ran', 'slept', 'home', 'away'].map((id) => t.node(id).get('visible')))).toEqual([true, true, true, false])
        expect(at(f.duration, () => [t.edge('ran', 'home').get('visible'), t.edge('ran', 'home').shaft.get('trimTo'), t.edge('ran', 'away').get('visible')])).toEqual([true, 1, false])
        // While the line of an edge draws, the patch of its label is there and its words are not: no line crosses the words.
        const label = t.edge('the', 'ran').caption!
        expect(at(0.7, () => [label.get('opacity'), label.children[0]!.get('opacity'), label.children[1]!.get('opacity'), t.edge('the', 'ran').shaft.get('trimTo') > 0.2])).toEqual([1, 1, 0, true])
        expect(at(f.duration, () => label.children[1]!.get('opacity'))).toBe(1)
        expect(await fails((s) => { s.play(s.add(words({ shown: 0 })).grow('home')) })).toMatch(/tree: grow: the parent of "home" is "ran", which does not show yet. Grow "ran" first, or name it before "home" in the same call/)
        expect(await fails((s) => { s.play(s.add(words({ shown: 0 })).grow(['ran', 'home'])) })).toBe('no error')
        // A list of ids shows each node with the nodes over it.
        let some!: T
        await compile((s) => {
            some = s.add(words({ shown: ['home'] }))
        })
        expect(['the', 'ran', 'home', 'away', 'slept'].map((id) => some.isShown(id))).toEqual([true, true, true, false, false])
        expect(await fails((s) => { s.add(words({ shown: 1.5 })) })).toMatch(/tree: shown is 1.5. Give a depth, where 0 is the root alone, or a list of ids/)
    })

    it('path lights the way from the root, a second path moves the light, and add keeps both', async () => {
        let t!: T
        await compile((s) => {
            t = s.add(words())
            s.play(t.path('home'), { duration: 1 })
            s.play(t.path('soundly', { color: 'green' }), { duration: 1 })
            s.play(t.path('home', { add: true }), { duration: 1 })
            s.play(t.path(null), { duration: 1 })
        })
        const width = (from: string, to: string, time: number) => at(time, () => t.edge(from, to).shaft.get('strokeWidth'))
        const stroke = (from: string, to: string, time: number) => rgb(at(time, () => t.edge(from, to).shaft.get('stroke')))
        const border = (id: string, time: number) => at(time, () => t.node(id).shape.get('strokeWidth'))
        // The first path: the edges of the way are wider and in the color of the light, and its nodes are active.
        expect([width('the', 'ran', 1), width('ran', 'home', 1), width('the', 'slept', 1), width('ran', 'away', 1)]).toEqual([4.4, 4.4, 2.2, 2.2])
        expect(stroke('ran', 'home', 1)).toEqual(color('yellow'))
        expect([border('the', 1), border('ran', 1), border('home', 1), border('away', 1)]).toEqual([5, 5, 5, 2.5])
        // The light runs from the root down: the first edge is lit before the second.
        expect([width('the', 'ran', 0.62), width('ran', 'home', 0.62)]).toEqual([4.4, 2.2])
        // The second path moves the light: the old way is plain again, and the new one has the new color.
        expect([width('the', 'ran', 2), width('ran', 'home', 2), width('the', 'slept', 2), width('slept', 'soundly', 2)]).toEqual([2.2, 2.2, 4.4, 4.4])
        expect(stroke('ran', 'home', 2)).toEqual(color('dim'))
        expect(stroke('slept', 'soundly', 2)).toEqual(color('green'))
        expect([border('ran', 2), border('home', 2), border('soundly', 2)]).toEqual([2.5, 2.5, 5])
        expect(rgb(at(2, () => t.node('the').shape.get('stroke')))).toEqual(color('green'))
        // With add, both ways are lit, each in its color.
        expect([width('ran', 'home', 3), width('slept', 'soundly', 3)]).toEqual([4.4, 4.4])
        expect([stroke('ran', 'home', 3), stroke('slept', 'soundly', 3)]).toEqual([color('yellow'), color('green')])
        // The root is on both ways. It was lit first, in green, and it keeps that color.
        expect(rgb(at(3, () => t.node('the').shape.get('stroke')))).toEqual(color('green'))
        // Null turns the light off.
        expect([width('ran', 'home', 4), width('slept', 'soundly', 4), border('the', 4)]).toEqual([2.2, 2.2, 2.5])
        expect(t.litPath).toEqual([])
        expect(t.stateOf('the')).toBe('idle')
    })

    it('path reads the tree when it plays: a node that waits or a pruned branch is an error, and a done node keeps its state', async () => {
        let t!: T
        await compile((s) => {
            t = s.add(words())
            s.play(t.setState('soundly', 'done'))
            s.play(t.path('soundly'))
        })
        expect(t.litPath).toEqual(['the', 'slept', 'soundly'])
        expect([t.stateOf('the'), t.stateOf('slept'), t.stateOf('soundly')]).toEqual(['active', 'active', 'done'])
        expect(await fails((s) => { s.play(s.add(words({ shown: 1 })).path('home')) })).toMatch(/tree: path: the node "home" does not show yet. Grow it first/)
        expect(await fails((s) => {
            const made = s.add(words())
            s.play(made.prune('ran'))
            s.play(made.path('home'))
        })).toMatch(/tree: path: the node "home" is off. A light does not go through a pruned branch/)
        // A grow and a path of the same node in one sequence work: the path reads the tree when it plays.
        expect(await fails((s) => {
            const made = s.add(words({ shown: 0 }))
            s.play(seq(made.grow(['ran', 'home']), made.path('home')))
        })).toBe('no error')
        expect(await fails((s) => {
            const made = s.add(words())
            s.play(made.path('home'), made.setState('home', 'done'))
        })).toMatch(/tree: setState\("home", "done"\) plays from 0 s to 0.5 s, and path\("home"\) plays from 0 s to 1.2 s. Both change the look of the node "home"/)
    })

    it('prune turns a branch off, with the nodes that wait, and a pruned branch does not grow', async () => {
        let t!: T
        await compile((s) => {
            t = s.add(words({ shown: ['ran', 'slept', 'home'] }))
            s.play(t.path('home'), { duration: 0.5 })
            s.play(t.prune('ran'), { duration: 1 })
        })
        expect(['the', 'ran', 'home', 'away', 'slept'].map((id) => t.stateOf(id))).toEqual(['active', 'off', 'off', 'off', 'idle'])
        expect(t.litPath).toEqual(['the'])
        at(1.5, () => {
            for (const id of ['ran', 'home']) {
                expect(t.node(id).shape.get('dash')).not.toBeNull()
                expect(rgb(t.node(id).shape.get('stroke'))).toEqual(color('faint'))
                expect(rgb(t.node(id).value!.leaves()[0]!.get('fill'))).toEqual(color('dim'))
            }
            // The edges of the branch are lines of dashes, at their first width, and the label of an edge is dim.
            expect([t.edge('the', 'ran').shaft.get('dash') !== null, t.edge('the', 'ran').shaft.get('strokeWidth'), t.edge('ran', 'home').shaft.get('dash') !== null]).toEqual([true, 2.2, true])
            expect(rgb(t.edge('the', 'ran').caption!.children[1]!.leaves()[0]!.get('fill'))).toEqual(color('dim'))
            expect(t.edge('the', 'slept').shaft.get('dash')).toBeNull()
        })
        // From the top down: the top of the branch changes before the node under it.
        expect(at(0.9, () => t.node('ran').shape.get('fillOpacity'))).toBeLessThan(at(0.9, () => t.node('home').shape.get('fillOpacity')))
        expect(await fails((s) => {
            const made = s.add(words({ shown: 1 }))
            s.play(made.prune('ran'))
            s.play(made.grow('home'))
        })).toMatch(/tree: grow: "home" is in the branch of "ran", which is pruned. A branch that is off does not grow/)
        expect(await fails((s) => { s.play(s.add(words()).prune('the')) })).toMatch(/tree: prune: "the" is the root/)
        expect(await fails((s) => {
            const made = s.add(words())
            s.play(made.prune('ran'))
            s.play(made.setState('home', 'done'))
        })).toMatch(/tree: setState: "home" is in a pruned branch, and a pruned branch stays off/)
    })

    it('keep is one step of a beam search: it lights the kept paths and prunes the rest of the frontier', async () => {
        let t!: T
        const frontiers: string[][] = []
        await compile((s) => {
            t = s.add(words({ shown: 0 }))
            frontiers.push(t.frontier)
            s.play(t.grow(['ran', 'slept']))
            frontiers.push(t.frontier)
            s.play(t.keep(['ran', 'slept']))
            s.play(t.grow(['home', 'away', 'soundly', 'late']))
            frontiers.push(t.frontier)
            // The best two of the four: both children of "ran" lose, so "ran" has no open node under it, and is pruned too.
            s.play(t.keep(['soundly', 'late']))
            frontiers.push(t.frontier)
        })
        expect(frontiers).toEqual([['the'], ['ran', 'slept'], ['home', 'away', 'soundly', 'late'], ['soundly', 'late']])
        expect(['the', 'ran', 'home', 'away', 'slept', 'soundly', 'late'].map((id) => t.stateOf(id))).toEqual(['active', 'off', 'off', 'off', 'active', 'active', 'active'])
        expect(t.litPath).toEqual(['the', 'slept', 'soundly', 'late'])
        const end = 0.7 * 1.5 + 1 + 0.7 * 2.5 + 1
        at(end, () => {
            expect(t.edge('slept', 'soundly').shaft.get('strokeWidth')).toBe(4.4)
            expect(t.edge('the', 'ran').shaft.get('strokeWidth')).toBe(2.2)
            expect(t.edge('the', 'ran').shaft.get('dash')).not.toBeNull()
            expect(t.node('ran').shape.get('strokeWidth')).toBe(2.5)
        })
        const wrong = await fails((s) => {
            const made = s.add(words({ shown: 1 }))
            s.play(made.keep('home'))
        })
        expect(wrong).toMatch(/tree: keep: no node "home"|tree: keep: "home" is not in the frontier. The frontier is "ran", "slept"/)
        expect(await fails((s) => { s.play(s.add(words()).keep('ran')) })).toMatch(/tree: keep: "ran" is not in the frontier. The frontier is "home", "away", "soundly", "late": the open nodes that show and have no child that shows/)
    })

    it('keep leaves a done leaf and the way to it as they are', async () => {
        let t!: T
        await compile((s) => {
            t = s.add(words())
            s.play(t.setState('home', 'done'))
            s.play(t.keep('soundly'))
        })
        // "away" and "late" are pruned. "ran" still has the done leaf "home" under it, so it stays.
        expect(['ran', 'home', 'away', 'slept', 'soundly', 'late'].map((id) => t.stateOf(id))).toEqual(['idle', 'done', 'off', 'active', 'active', 'off'])
        expect(t.frontier).toEqual(['soundly'])
    })

    it('a width sets the room between the leaves of a tree, and a width with no room is an error with the width that works', async () => {
        const size = (t: T) => {
            const boxes = [...t.nodes.values()].map((node) => node.shape.bounds())
            return Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x))
        }
        let wide!: T, side!: T, fit!: T
        await compile((s) => {
            wide = s.add(words({ width: 1500 }))
            side = s.add(words({ width: 1300, direction: 'right' }))
            fit = s.add(fitted(1250, (width) => words({ width })))
        })
        expect(size(wide)).toBeCloseTo(1500, 3)
        expect(size(side)).toBeCloseTo(1300, 3)
        expect(boxOf(fit).width).toBeCloseTo(1250, 0)
        // To the right, the levels share the width: three levels, at equal steps.
        expect(side.node('ran').get('x') - side.node('the').get('x')).toBeCloseTo(side.node('home').get('x') - side.node('ran').get('x'), 6)
        const narrow = await fails((s) => { s.add(words({ width: 500 })) })
        expect(narrow).toMatch(/tree: a width of 500 gives each of the 4 leaves \d+ px, and a node needs \d+. Give a width of (\d+) or more, shorter texts, a smaller labelSize, or fewer leaves/)
        const least = Number(/a width of (\d+) or more/.exec(narrow)![1])
        expect(await fails((s) => { s.add(words({ width: least })) })).toBe('no error')
        expect(await fails((s) => { s.add(words({ width: least - 3 })) })).toMatch(/gives each of the 4 leaves/)
        expect(await fails((s) => { s.add(words({ width: 1500, siblingGap: 200 })) })).toMatch(/tree: width and siblingGap both set the room between the leaves. Give one of the two/)
    })

    it('renders the same frame in any order, and the film check finds nothing in the labels that the objects place', async () => {
        const build = (s: Stage) => {
            const t = s.add(words({ shown: 0, width: 1500, levelGap: 220 }).at(0, -200))
            const g = s.add(graph([{ id: 'w', label: 'w', value: '3', note: '' }, { id: 'y', label: 'w · x', value: '', note: '', width: 150 }, { id: 'z', label: 'loss', value: '', width: 150, state: 'done' }],
                [{ from: 'w', to: 'y', label: '× 2' }, { from: 'y', to: 'z' }], { width: 1300, token: 'w', edgeLabelSize: 26 }).at(0, 330))
            s.play(t.grow(['ran', 'slept', 'home', 'away', 'soundly', 'late']), g.send('w', 'y', { value: '6' }), { duration: 1.5 })
            s.play(t.keep(['soundly', 'home']), seq(g.go('y'), g.refuse('w')), g.send('y', 'w', { note: 'grad 2', color: 'pink' }), { duration: 1.5 })
            s.play(t.path('soundly', { color: 'green' }), g.setState('y', 'failed'), g.setValue('y', '7'), { duration: 1 })
            s.wait(0.5)
        }
        const f = await compile(build)
        expectPure(f, [0, 0.4, 1.1, 1.5, 1.9, 2.6, 3, 3.4, 4, f.duration])
        // A gap of 0.7 of the text size asks for more room than 0.3 does, so one scan covers both.
        const report = await checkFilm(film(build) as FilmDefinition, { textGap: 0.7, motion: true })
        expect(report.diagnostics.map((finding) => `${finding.code}: ${finding.message}`)).toEqual([])
    }, 60_000)
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

describe('axes', () => {
    /** The nodes that a part of moving axes draws at a time. */
    const drawn = (node: Node, time: number): Node[] => at(time, () => [node.draw!(time)].flat().filter((made): made is Node => made !== null))
    const number = (made: Node) => ({ source: (made as Node & { source: string }).source, x: Math.round(made.center[0]), opacity: made.get('opacity') })
    /** The bounds of a path as left, top, width and height, with no error of the last digits. */
    const box = (path: Node) => { const b = pathBounds(path.get('path')!)!; return [b.x, b.y, b.width, b.height].map((value) => Math.round(value * 1e6) / 1e6 + 0) }
    /** A point with no error of the last digits. */
    const near = ([x, y]: readonly [number, number]): [number, number] => [Math.round(x * 1e6) / 1e6 + 0, Math.round(y * 1e6) / 1e6 + 0]
    /** The corners of a path of straight lines: its start, and the end of each line. */
    const corners = (path: Node, ringIndex = 0): [number, number][] => {
        const p = path.get('path')![ringIndex]!.p
        return Array.from({ length: (p.length - 2) / 6 + 1 }, (_, i) => near([p[i * 6]!, p[i * 6 + 1]!]))
    }
    const series = (values: readonly number[], first = 0): Vec[] => values.map((y, i) => [first + i, y])

    it('keeps the numbers of fixed axes at one place at every size, and moves a number only as far as it must to clear its tick', async () => {
        const SIZES = [20, 26, 30, 36, 40, 60]
        const planes: ReturnType<typeof axes>[] = []
        await compile((s) => {
            // Numbers 1, 2, 3 under the x axis, and -1, 1, 2 beside the y axis. The origin is at the left end of the x axis.
            for (const labelSize of SIZES) planes.push(s.add(axes({ x: [0, 3.4], y: [-1.4, 2.4], width: 340, height: 380, xStep: 1, yStep: 1, labelSize, tips: false })))
        })
        const places = planes.map((plane) => {
            expect(plane.moving).toBe(false)
            expect(plane.numbers.draw).toBeNull()
            const [ox, oy] = plane.p(0, 0)
            const [x1, , , low, y1] = plane.numbers.children.map((number) => number.bounds())
            return {
                // The middle of the number 1 of each axis from its axis, and the room between a number and the end of its tick, which is 6 from the axis.
                under: (x1!.y + x1!.height / 2) - oy, xRoom: x1!.y - oy - 6,
                beside: ox - (y1!.x + y1!.width / 2), yRoom: ox - 6 - (y1!.x + y1!.width),
                wide: ox - (low!.x + low!.width / 2), wideRoom: ox - 6 - (low!.x + low!.width), width: low!.width,
            }
        })
        const [at20, at26, at30, at36, at40, at60] = places
        // A film places what is beside its axes by these numbers: 26 under the x axis and 28 beside the y axis, at every size.
        for (const place of [at20!, at26!, at30!, at36!, at40!]) {
            expect(place.under).toBeCloseTo(26, 6)
            expect(place.beside).toBeCloseTo(28, 6)
            expect(place.xRoom).toBeGreaterThan(4)
            expect(place.yRoom).toBeGreaterThan(4)
        }
        // The number -1 is wide. Up to size 26 it is clear of its tick at 28 from the axis.
        expect(at20!.wide).toBeCloseTo(28, 6)
        expect(at26!.wide).toBeCloseTo(28, 6)
        expect(at26!.wideRoom).toBeGreaterThan(4)
        // From size 30 it would be nearer to its tick than 4 pixels, or on it. It moves away to 4 pixels, and no further.
        for (const place of [at30!, at36!, at40!, at60!]) {
            expect(28 + place.width / 2 - 6).toBeGreaterThan(18)
            expect(place.wideRoom).toBeCloseTo(4, 6)
            expect(place.wide).toBeCloseTo(10 + place.width / 2, 6)
        }
        expect(at36!.wide - 28).toBeGreaterThan(4)
        expect(at36!.wide - 28).toBeLessThan(6)
        // At size 60 a number under the x axis is so high that it would touch its tick too: it has the same 4 pixels.
        expect(at60!.xRoom).toBeCloseTo(4, 6)
        expect(at60!.under).toBeGreaterThan(26)
    })

    it('gives the numbers of axes with a range that moves a room that grows with their size', async () => {
        let small!: ReturnType<typeof axes>, large!: ReturnType<typeof axes>
        await compile((s) => {
            small = s.add(axes({ x: () => [0, 4], y: [0, 4], width: 400, height: 400, xStep: 1, yStep: 1 }))
            large = s.add(axes({ x: () => [0, 4], y: [0, 4], width: 400, height: 400, xStep: 1, yStep: 1, labelSize: 30 }))
        })
        // The number 2 of the x axis, and the number 2 of the y axis: 26 and 28 from the axes at the default size of 20, and 1.5 times that at size 30.
        const middles = (made: ReturnType<typeof axes>) => drawn(made.numbers, 0).filter((mark) => (mark as Node & { source: string }).source === '2').map((mark) => mark.center)
        expect(middles(small)[0]![1]).toBeCloseTo(200 + 26, 6)
        expect(middles(small)[1]![0]).toBeCloseTo(-200 - 28, 6)
        expect(middles(large)[0]![1]).toBeCloseTo(200 + 39, 6)
        expect(middles(large)[1]![0]).toBeCloseTo(-200 - 42, 6)
    })

    it('follows a range that moves: a point scrolls, and a number fades before it passes an end of its axis', async () => {
        let made!: ReturnType<typeof axes>
        const f = await compile((s) => {
            const now = s.value(10)
            made = s.add(axes({ x: () => [now.value - 10, now.value], y: [0, 4], width: 1000, height: 400, xStep: 5, yStep: 2, tips: false }))
            s.play(now.to(20, { duration: 10, ease: linear }))
        })
        expect(made.moving).toBe(true)
        expect(at(0, () => made.xRange)).toEqual([0, 10])
        expect(at(10, () => made.xRange)).toEqual([10, 20])
        // x = 10 is at the right end of the plot at the start, and in its middle 5 seconds later.
        expect(at(0, () => made.p(10, 0))).toEqual([500, 200])
        expect(at(5, () => made.p(10, 0))[0]).toBeCloseTo(0, 6)
        const numbers = (time: number) => drawn(made.numbers, time).map(number)
        // At 2.2 s the window is 2.2 to 12.2: 5 and 10 are far from both ends. The y axis does not move: its number at its end keeps its place.
        expect(numbers(2.2)).toEqual([{ source: '5', x: -220, opacity: 1 }, { source: '10', x: 280, opacity: 1 }, { source: '2', x: -528, opacity: 1 }, { source: '4', x: -528, opacity: 1 }])
        // At 0.2 s, 10 is 20 px from the right end. Its tick is at half. Its number is 20 px wide, so it is 10 px from the end, and at a quarter.
        const tickAt = (time: number, x: number) => drawn(made.lines, time).filter((mark) => Math.abs(mark.center[0] - x) < 0.5 && mark.bounds().height < 20).map((mark) => mark.get('opacity'))
        const width = at(0.2, () => drawn(made.numbers, 0.2)[1]!.width)
        expect(width).toBeGreaterThan(12)
        expect(numbers(0.2).slice(0, 2)).toEqual([{ source: '5', x: -20, opacity: 1 }, { source: '10', x: 480, opacity: expect.closeTo((20 - width / 2) / 40, 6) }])
        expect(tickAt(0.2, 480)).toEqual([expect.closeTo(0.5, 6)])
        // The left end is the same: at 4.8 s, 5 is 20 px from it.
        const left = numbers(4.8)[0]!, leftWidth = at(4.8, () => drawn(made.numbers, 4.8)[0]!.width)
        expect(left).toEqual({ source: '5', x: -480, opacity: expect.closeTo((20 - leftWidth / 2) / 40, 6) })
        expect(tickAt(4.8, -480)).toEqual([expect.closeTo(0.5, 6)])
        // At an end itself the number is gone. The numbers and the ticks of the y axis, also the ones at its end, show in full at every time.
        expect(numbers(0).map((entry) => entry.source)).toEqual(['5', '2', '4'])
        for (const time of [0, 0.2, 4.8]) {
            expect(numbers(time).filter((entry) => entry.x === -528)).toEqual([{ source: '2', x: -528, opacity: 1 }, { source: '4', x: -528, opacity: 1 }])
            expect(drawn(made.lines, time).filter((mark) => mark.bounds().width < 20 && mark.bounds().height < 1).map((mark) => mark.get('opacity'))).toEqual([1, 1])
        }
        // Every frame is a function of its time.
        expectPure(f, [0, 0.2, 2.2, 7, 10])
    })

    it('draws the grid of a range that moves again on every frame, with lines that fade at the ends', async () => {
        let made!: ReturnType<typeof axes>
        await compile((s) => {
            const now = s.value(10)
            made = s.add(axes({ x: () => [now.value - 10, now.value], y: [0, 4], width: 1000, height: 400, xStep: 5, yStep: 2, grid: true, tips: false }))
            s.play(now.to(20, { duration: 10, ease: linear }))
        })
        // Window 2.2 to 12.2: the lines of x = 5 and x = 10, and the three level lines of the y axis.
        const lines = (time: number) => drawn(made.grid, time).map((mark) => [...box(mark), mark.get('opacity')])
        expect(lines(2.2)).toEqual([[-220, -200, 0, 400, 1], [280, -200, 0, 400, 1], [-500, 200, 1000, 0, 1], [-500, 0, 1000, 0, 1], [-500, -200, 1000, 0, 1]])
        expect(lines(0.2).slice(0, 2)).toEqual([[-20, -200, 0, 400, 1], [480, -200, 0, 400, expect.closeTo(0.5, 6)]])
        // Axes with no grid draw none.
        expect(axes({ x: () => [0, 10] }).grid.draw).toBeNull()
    })

    it('draws a series as straight lines through its points, up to a value and from a value', async () => {
        const points = series([2, 8, 3, 7, 4, 6, 5, 9, 1, 8, 2])
        let made!: ReturnType<typeof axes>, curve!: Node, fixed!: Node, tail!: Node, uneven!: Node
        await compile((s) => {
            const end = s.value(0)
            made = s.add(axes({ x: [0, 10], y: [0, 10], width: 1000, height: 500 }))
            curve = made.plot(points, { to: () => end.value, stroke: 'yellow' })
            fixed = made.plot(points)
            tail = made.plot(points, { from: () => end.value })
            // Points at any x: the line goes through each of them.
            uneven = made.plot([[0.5, 2], [1.5, 8], [4, 3], [4.2, 7], [9.5, 2]])
            s.play(end.to(10, { duration: 10, ease: linear }))
        })
        // A curve with two ends that are numbers is one path, as before. A series has one straight line between two points.
        expect(fixed.draw).toBeNull()
        expect(corners(fixed)).toEqual(points.map(([x, y]) => near(made.p(x, y))))
        // The lines are straight: the first one goes a third of its way, and two thirds, on the line from its start to its end.
        const first = fixed.get('path')![0]!.p
        expect(near([first[2]!, first[3]!])).toEqual(near([-500 + 100 / 3, 150 - 300 / 3]))
        expect(near([first[4]!, first[5]!])).toEqual(near([-500 + 200 / 3, 150 - 600 / 3]))
        expect(corners(uneven)).toEqual([[-450, 150], [-350, -150], [-100, 100], [-80, -100], [450, 150]])
        const cornersAt = (node: Node, time: number) => { const made = drawn(node, time)[0]; return made ? corners(made) : null }
        expect(cornersAt(curve, 0)).toBeNull()
        // At 4.5 the line has the points of x = 0 to 4, and it ends between two points of the series.
        expect(cornersAt(curve, 4.5)).toEqual([...points.slice(0, 5).map(([x, y]) => made.p(x, y)), made.p(4.5, 5)].map(near))
        // The points stay the same when the end moves on: the line does not change its shape while it grows.
        expect(cornersAt(curve, 4.6)!.slice(0, 5)).toEqual(cornersAt(curve, 4.5)!.slice(0, 5))
        // A start that is a function: at 4.5 the line starts between two points, and has the points of x = 5 to 10.
        expect(cornersAt(tail, 4.5)).toEqual([made.p(4.5, 5), ...points.slice(5).map(([x, y]) => made.p(x, y))].map(near))
        expect(cornersAt(tail, 10)).toBeNull()
        // A function is a smooth curve through even samples, as before.
        const smooth = made.plot((x) => x, { samples: 8 })
        expect((smooth.get('path')![0]!.p.length - 2) / 6).toBe(8)
    })

    it('keeps the samples of a series at its points while the window scrolls, and cuts a curve and a band at the ends of the range', async () => {
        const points = series([5, 6, 4, 7, 3, 6, 5, 4, 6, 5, 7, 3, 5, 6, 4, 5, 6])
        let made!: ReturnType<typeof axes>, curve!: Node, smooth!: Node, area!: Node
        await compile((s) => {
            const now = s.value(4)
            made = s.add(axes({ x: () => [now.value - 4, now.value], y: [0, 10], width: 800, height: 400 }))
            curve = made.plot(points)
            smooth = made.plot((x) => 5 + Math.sin(x), { from: 0, to: 20 })
            area = band(made, (x) => 4 + Math.sin(x), (x) => 6 + Math.sin(x), { from: 6, to: 20 })
            s.play(now.to(12, { duration: 8, ease: linear }))
        })
        // At 2.3 s the window is 2.3 to 6.3. The line starts at the left end, has the points of x = 3 to 6, and ends at the right end.
        const line23 = at(2.3, () => corners(drawn(curve, 2.3)[0]!))
        expect(line23).toEqual(at(2.3, () => [made.p(2.3, valueAt(points, 2.3)), ...[3, 4, 5, 6].map((x) => made.p(x, points[x]![1])), made.p(6.3, valueAt(points, 6.3))].map(near)))
        expect([line23[0]![0], line23[5]![0]]).toEqual([-400, 400])
        // 0.05 s later the same points of the series are 10 px more to the left.
        const line235 = at(2.35, () => corners(drawn(curve, 2.35)[0]!))
        expect(line235.slice(1, 5)).toEqual(line23.slice(1, 5).map(([x, y]) => near([x - 10, y])))
        for (const time of [0, 2.3, 5, 8]) {
            const cut = pathBounds(drawn(smooth, time)[0]!.get('path')!)!
            expect(cut.x).toBeCloseTo(-400, 6)
            expect(cut.x + cut.width).toBeCloseTo(400, 6)
        }
        // The band starts at x = 6. The window reaches it at 2 s, and holds a part of it one second later.
        expect(drawn(area, 1)).toEqual([])
        const part = pathBounds(drawn(area, 3)[0]!.get('path')!)!
        expect(at(3, () => made.p(6, 0)[0])).toBeCloseTo(200, 6)
        expect(part.x).toBeCloseTo(200, 6)
        expect(part.x + part.width).toBeCloseTo(400, 6)
    })

    it('fills the band between two curves, opens it up to a value, and keeps it inside the y range', async () => {
        let made!: ReturnType<typeof axes>, between!: Node, named!: Node, open!: Node, tall!: Node, under!: Node, swapped!: Node, gap!: Node
        await compile((s) => {
            const end = s.value(2)
            made = s.add(axes({ x: [0, 10], y: [0, 10], width: 1000, height: 500 }))
            between = areaUnder(made, () => 6, { over: () => 4, from: 2, to: 8, fill: 'teal', opacity: 0.4 })
            named = band(made, () => 4, () => 6, { from: 2, to: 8, fill: 'teal', opacity: 0.4 })
            // The two edges are series with a point at each whole x: the band has its corners at those points.
            open = band(made, series([4, 3.9, 3.8, 3.7, 3.6, 3.5, 3.4, 3.3, 3.2]), series([6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8]), { from: 2, to: () => end.value })
            tall = band(made, () => -5, () => 20)
            under = areaUnder(made, () => 6, { from: 2, to: 8 })
            // The low curve over the high one: the band is between the two, as before.
            swapped = band(made, () => 6, () => 4, { from: 2, to: 8 })
            // A series with no value at x = 5: the band has a gap from 4 to 6.
            gap = band(made, () => 4, series([7, 7, 7, 7, 7, NaN, 7, 7, 7, 7, 7]))
            s.play(end.to(8, { duration: 6, ease: linear }))
        })
        expect(box(between)).toEqual([-300, -50, 600, 100])
        expect(between.get('fill')).toEqual(parseColor('teal'))
        expect(between.get('fillOpacity')).toBe(0.4)
        expect(between.data['object']).toBe('band between two curves')
        // `band` is the same shape by its name, with the low curve first.
        expect(pathToD(named.get('path')!)).toBe(pathToD(between.get('path')!))
        expect(named.get('fillOpacity')).toBe(0.4)
        expect(named.data['object']).toBe('band between two curves')
        expect(pathToD(swapped.get('path')!)).toBe(pathToD(named.get('path')!))
        // Without `over`, the area goes down to the x axis, as before.
        expect(box(under)).toEqual([-300, -50, 600, 300])
        expect(under.data['object']).toBe('area under a curve')
        expect(box(tall)).toEqual([-500, -250, 1000, 500])
        // The band opens from x = 2: nothing at the start. At 3.5 s it ends at x = 5.5, with a corner at each point of the series on the way.
        expect(drawn(open, 0)).toEqual([])
        const shape = drawn(open, 3.5)[0]!
        const high = (x: number) => made.p(x, 6 + x / 10), low = (x: number) => made.p(x, 4 - x / 10)
        expect(corners(shape)).toEqual([high(2), high(3), high(4), high(5), high(5.5), low(5.5), low(5), low(4), low(3), low(2), high(2)].map(near))
        // A value that is not a number leaves a gap: two shapes, up to x = 4 and from x = 6.
        expect(gap.get('path')!.map((ring) => { const b = pathBounds([ring])!; return [...near([b.x, b.y]), ...near([b.width, b.height])] })).toEqual([[-500, -100, 400, 150], [100, -100, 400, 150]])
    })

    it('marks a value of x or of y with a line across the plot and a label at its end', async () => {
        let made!: ReturnType<typeof axes>, limit!: Node, live!: Node, thick!: Node
        const f = await compile((s) => {
            const now = s.value(2)
            made = s.add(axes({ x: [0, 10], y: [0, 10], width: 1000, height: 500 }))
            limit = made.marker({ y: 8, label: 'limit', color: 'red', labelSize: 30, dash: null })
            live = made.marker({ x: () => now.value, label: 'now', labelSize: 30 })
            thick = made.marker({ x: 5, width: 6, glow: 9 })
            made.plot((x) => x, { stroke: 'blue' })
            s.play(now.to(12, { duration: 10, ease: linear }))
        })
        // A level line from the left edge of the plot to the right edge, and its label at the right of the plot, in the color of the line.
        const [rule, name] = limit.children
        expect(box(rule!)).toEqual([-500, -150, 1000, 0])
        expect(rule!.get('dash')).toBeNull()
        expect(rule!.get('stroke')).toEqual(parseColor('red'))
        expect((name as TextNode).chars[0]!.get('fill')).toEqual(parseColor('red'))
        expect(name!.bounds().x).toBeCloseTo(500 + 0.4 * 30, 6)
        expect(name!.center[1]).toBeCloseTo(-150, 6)
        // A vertical line that follows a value, with its label over the plot. Past the end of the axis it does not show.
        const [line3, name3] = drawn(live, 1)
        expect(box(line3!)).toEqual([-200, -250, 0, 500])
        expect(line3!.get('dash')).toEqual([8, 8])
        expect(line3!.get('strokeWidth')).toBe(2.5)
        expect(line3!.get('glow')).toBe(0)
        expect((name3 as TextNode).chars[0]!.get('fill')).toEqual(parseColor('yellow'))
        expect(name3!.center[0]).toBeCloseTo(-200, 6)
        expect(name3!.bounds().y + name3!.bounds().height).toBeCloseTo(-250 - 0.4 * 30, 6)
        expect(drawn(live, 9)).toEqual([])
        // A marker with no label is its line, with the width and the glow that it was given.
        expect(thick.children).toHaveLength(1)
        expect(thick.children[0]!.get('strokeWidth')).toBe(6)
        expect(thick.children[0]!.get('glow')).toBe(9)
        // The labels are labels of the plot: the check judges neither against the line of its marker, nor against the curve that passes it.
        const report = await checkFilm(f, { textGap: 0.3, times: [0.5, 5.5] })
        expect(report.diagnostics).toEqual([])
    })

    it('keeps the label of a marker beside the plot at an end of the plot, and moves a marker with the window', async () => {
        let fixed!: ReturnType<typeof axes>, moving!: ReturnType<typeof axes>, deploy!: Node
        await compile((s) => {
            const now = s.value(8)
            fixed = s.add(axes({ x: [0, 10], y: [0, 10], width: 800, height: 400 }).at(0, -260))
            fixed.marker({ x: 10, label: 'the forecast was made here', labelSize: 30 })
            fixed.marker({ x: 0, label: 'the start of the record', labelSize: 30 })
            fixed.marker({ y: 10, label: 'limit', labelSize: 30 })
            moving = s.add(axes({ x: () => [now.value - 8, now.value + 4], y: [0, 10], width: 1200, height: 300 }).at(0, 300))
            // A marker at a number on axes with a range that moves: it scrolls with the window.
            deploy = moving.marker({ x: 12, label: 'deploy', labelSize: 30 })
            s.play(now.to(24, { duration: 8, ease: linear }))
        })
        // At the right end, the label ends at the end of the plot. At the left end, it starts there. Its line stays at its value.
        const [end, start, top] = fixed.children.slice(-3)
        expect(box(end!.children[0]!)).toEqual([400, -200, 0, 400])
        expect(end!.children[1]!.bounds().x + end!.children[1]!.bounds().width).toBeCloseTo(400, 6)
        expect(start!.children[1]!.bounds().x).toBeCloseTo(-400, 6)
        // A level marker at the top of the plot: its label does not pass the top. The axes are 260 over the middle of the stage.
        expect(top!.children[1]!.bounds().y).toBeCloseTo(-260 - 200, 6)
        // At the start the window is 0 to 12: the marker of x = 12 is at the right end, and its label is inside the plot.
        const [line0, name0] = drawn(deploy, 0)
        expect(box(line0!)).toEqual([600, -150, 0, 300])
        expect(at(0, () => name0!.bounds().x + name0!.bounds().width)).toBeCloseTo(600, 6)
        // Two seconds later the window is 4 to 16: the marker is at two thirds, with its label over it. At 8 s it is out of the window.
        const [line2, name2] = drawn(deploy, 2)
        expect(box(line2!)).toEqual([200, -150, 0, 300])
        expect(at(2, () => name2!.center[0])).toBeCloseTo(200, 6)
        expect(drawn(deploy, 8)).toEqual([])
    })

    it('moves the marks of the older helpers with a range that moves, and hides a mark while its point is outside', async () => {
        const f = (x: number) => 5 + 3 * Math.sin(x / 2)
        let made!: ReturnType<typeof axes>, point!: Node, lines!: Node, sum!: Node, tangent!: Node, secant!: Node, guides!: Node
        const film = await compile((s) => {
            const now = s.value(8)
            made = s.add(axes({ x: () => [now.value - 8, now.value + 4], y: [0, 10], width: 1200, height: 500, xStep: 2, xLabel: 'x', yLabel: 'y' }))
            point = made.dotAt(6, f(6))
            lines = made.guides(4, f(4))
            sum = riemann(made, f, { from: 1, to: 5, n: 4 })
            tangent = tangentLine(made, f, 7)
            secant = secantLine(made, f, 7, 9)
            guides = dashedGuides(made, 9, f(9))
            s.play(now.to(16, { duration: 8, ease: linear }))
        })
        // The window is 0 to 12 at the start, and 100 px for each unit of x.
        expect(drawn(point, 0)[0]!.get('x')).toBeCloseTo(0, 6)
        expect(drawn(point, 2)[0]!.get('x')).toBeCloseTo(-200, 6)
        expect(at(2, () => [drawn(point, 2)[0]!.get('x'), drawn(point, 2)[0]!.get('y')])).toEqual(at(2, () => made.p(6, f(6))))
        // At 5 s the window is 5 to 17: the point of x = 6 is still inside, and the points of x = 4 and of the sum are not.
        expect(drawn(point, 5)).toHaveLength(1)
        expect(drawn(point, 7)).toEqual([])
        expect(drawn(lines, 0)).toHaveLength(2)
        expect(box(drawn(lines, 2)[0]!)[0]).toBeCloseTo(-400, 6)
        expect(drawn(lines, 5)).toEqual([])
        // The four rectangles of the sum from x = 1 to 5. At 2 s the window starts at 2, so the first one is gone. At 2.5 s the second one is cut in half.
        expect(drawn(sum, 0).map((leaf) => leaf.bounds().width)).toEqual([100, 100, 100, 100].map((width) => expect.closeTo(width, 6)))
        expect(drawn(sum, 2)).toHaveLength(3)
        expect(drawn(sum, 2.5).map((leaf) => leaf.bounds().width)).toEqual([50, 100, 100].map((width) => expect.closeTo(width, 6)))
        expect(at(2.5, () => drawn(sum, 2.5)[0]!.bounds().x)).toBeCloseTo(-600, 6)
        expect(drawn(sum, 5.5)).toEqual([])
        // The tangent, the secant and the guides follow their points, and do not show while a point is outside.
        expect(drawn(tangent, 2).map((mark) => Math.round(mark.center[0]))).toEqual([-100, -100])
        expect(drawn(tangent, 7.5)).toEqual([])
        expect(drawn(secant, 2).slice(-2).map((mark) => Math.round(mark.center[0]))).toEqual([-100, 100])
        expect(drawn(secant, 7.5)).toEqual([])
        expect(box(drawn(guides, 2)[0]!)[0]).toBeCloseTo(100, 6)
        expect(drawn(guides, 7.5)).toHaveLength(2)
        expect(drawn(guides, 8)).toHaveLength(2)
        // The names of the axes stay at the ends of the axis lines: the y axis moves with x = 0 until the window passes it.
        const names = (time: number) => at(time, () => drawn(made.children[3]!, time).map((name) => name.center.map(Math.round)))
        expect(names(0)).toEqual([[604, 224], [-600 + 16 + Math.round(drawn(made.children[3]!, 0)[1]!.width / 2), -246]])
        expect(names(4)[1]![0]).toBe(names(0)[1]![0])
        expect(at(-0, () => made.p(0, 0)[0])).toBeCloseTo(-600, 6)
        expectPure(film, [0, 2, 5, 8])
    })

    it('follows a y range that moves too', async () => {
        let made!: ReturnType<typeof axes>, limit!: Node
        await compile((s) => {
            const level = s.value(10)
            made = s.add(axes({ x: [0, 10], y: () => [level.value - 10, level.value + 10], width: 1000, height: 400, yStep: 5, xLabel: 'x', yLabel: 'y' }))
            limit = made.marker({ y: 20, label: 'limit' })
            s.play(level.to(30, { duration: 10, ease: linear }))
        })
        // The range is 0 to 20 at the start: the limit is at the top. Five seconds later it is in the middle, and at the end it is at the bottom.
        expect(box(drawn(limit, 0)[0]!)).toEqual([-500, -200, 1000, 0])
        expect(box(drawn(limit, 5)[0]!)).toEqual([-500, 0, 1000, 0])
        expect(box(drawn(limit, 10)[0]!)).toEqual([-500, 200, 1000, 0])
        // The x axis is at y = 0 while 0 is in the range, and at the bottom of the plot after that. Its name goes with it.
        const xAxis = (time: number) => at(time, () => box(drawn(made.lines, time)[0]!.children[0] ?? drawn(made.lines, time)[0]!)[1])
        expect(xAxis(0)).toBeCloseTo(200, 6)
        const name = (time: number) => at(time, () => drawn(made.children[3]!, time)[0]!.center[1])
        expect(name(0)).toBeCloseTo(200 - 26, 0)
        expect(name(10)).toBeCloseTo(200 - 26, 0)
        expect(at(4, () => made.p(0, 10)[1])).toBeCloseTo(at(4, () => made.p(0, 14)[1]) + 80, 6)
    })

    it('says what to give for each wrong argument of a curve, a band, a marker and a range', () => {
        const made = () => axes({ x: [0, 10], y: [0, 10], width: 1000, height: 500 })
        const any = (value: unknown) => value as never
        // A curve.
        expect(() => made().plot(any(4))).toThrow('plot: the curve is a function of x, such as (x) => x * x, or the points of a series, such as [[0, 2], [1, 5]], and it is the value 4')
        expect(() => made().plot([[0, 1], any([1])])).toThrow('plot: point 1 of the curve is the list [1]. A point of a series is [x, y], and its x is a number')
        expect(() => made().plot([[0, 1], [2, 1], [2, 3]])).toThrow('plot: point 2 of the curve has the x 2, and the point before it has the x 2. The points of a series have their x in rising order')
        expect(() => made().plot((x) => x, { to: any('5') })).toThrow('plot: to is a number, or a function that gives the number now, such as () => now.value, and it is the string "5"')
        expect(() => made().plot((x) => x, { from: NaN })).toThrow('plot: from is a number, or a function that gives the number now, such as () => now.value, and it is the value NaN')
        // A band.
        expect(() => areaUnder(made(), (x) => x, { over: any(4) })).toThrow('areaUnder: over is a function of x, such as (x) => x * x, or the points of a series, such as [[0, 2], [1, 5]], and it is the value 4')
        expect(() => band(made(), any('low'), (x) => x)).toThrow('band: the low curve is a function of x, such as (x) => x * x, or the points of a series, such as [[0, 2], [1, 5]], and it is the string "low"')
        expect(() => band(made(), (x) => x, any(undefined))).toThrow('band: the high curve is a function of x')
        expect(() => band(made(), (x) => x, (x) => x + 1, { to: any(null) })).toThrow('band: to is a number, or a function that gives the number now, such as () => now.value, and it is null')
        expect(() => band(any(rect(10, 10)), (x) => x, (x) => x + 1)).toThrow('band: the first argument is a node of another kind. Give a pair of axes, such as axes()')
        // A marker.
        expect(() => made().marker({ label: 'now' })).toThrow("axes.marker: give x for a vertical line or y for a level line, and one of the two only, such as marker({ x: 3, label: 'now' })")
        expect(() => made().marker({ x: 1, y: 2 })).toThrow('axes.marker: give x for a vertical line or y for a level line')
        expect(() => made().marker(any(3))).toThrow("axes.marker: the options are an object such as { x: 3, label: 'now' }, and the argument is the value 3")
        expect(() => made().marker({ x: 12 })).toThrow('axes.marker: x is 12, and the x range is 0 to 10. Give a value inside the range')
        expect(() => made().marker({ x: NaN })).toThrow('axes.marker: x is a number, or a function that gives the number now, such as () => now.value, and it is the value NaN')
        expect(() => made().marker({ y: any('high') })).toThrow('axes.marker: y is a number, or a function that gives the number now, such as () => now.value, and it is the string "high"')
        expect(() => made().marker({ x: 3, label: any(42) })).toThrow('axes.marker: label is the text at the end of the line, and it is the value 42')
        expect(() => made().marker({ x: 3, label: 'a', labelSize: 0 })).toThrow('axes.marker: labelSize is the size of the label in pixels, more than 0, and it is the value 0')
        expect(() => axes({ width: 200 }).marker({ x: 1, label: 'a label that is wider than the plot of these axes' })).toThrow(/^axes\.marker: the label "a label that is wider than the plot of these axes" is \d+ wide, and the plot is 200 wide\. Use a shorter label, or a smaller labelSize$/)
        // A function that gives no number stops the frame, and the message names the call.
        expect(() => made().plot((x) => x, { to: () => NaN }).draw!(0)).toThrow('plot: the function of to gave the value NaN. It gives the number now, such as () => now.value')
        expect(() => band(made(), (x) => x, (x) => x + 1, { from: any(() => 'start') }).draw!(0)).toThrow('band: the function of from gave the string "start". It gives the number now, such as () => now.value')
        expect(() => made().marker({ x: () => NaN, label: 'now' }).draw!(0)).toThrow('axes.marker: the function of x gave the value NaN. It gives the number now, such as () => now.value')
        // A range.
        expect(() => axes({ x: any(5) })).toThrow('axes: x is the range of the x axis: its two ends, such as [0, 10], or a function that gives them now, and it is the value 5')
        expect(() => axes({ x: any(() => 5) })).toThrow('axes: the function of the x range gave the value 5. It gives the two ends of the range now, the first one under the second, such as () => [now.value - 8, now.value + 4]')
        expect(() => axes({ y: () => [3, 3] })).toThrow('axes: the function of the y range gave the list [3, 3]. It gives the two ends of the range now, the first one under the second')
        expect(() => axes({ x: () => [9, 4] })).toThrow('axes: the function of the x range gave the list [9, 4]')
        expect(() => axes({ x: () => [NaN, 4] })).toThrow('axes: the function of the x range gave the list [NaN, 4]')
        expect(() => axes({ x: () => [0, 200000], xStep: 1 })).toThrow('axes: the x range 0 to 200000 has 200000 ticks at a step of 1, and axes with a range that moves draw each tick again on every frame. Give a larger xStep')
    })
})
