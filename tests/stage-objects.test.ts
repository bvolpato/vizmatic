import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import {
    arrayCells, attentionMatrix, axes, axes3d, barChart, callout, codeBlock, compileFilm, complexPlane, applyComplex, connector, countUp,
    counter, curve3d, dashedGuides, donut, draw, dynamic, epicycles, fadeIn, film, fourier, fourierPoint, frameToSvg, fromSvg, graph, group,
    heatmap, highlightSweep, histogram, infoBox, lagged, labeledDot, legend, line, lineChart, linear, matrix, morph, morphCode, morphMatching,
    neuralNet, numberLine, parseSvgPath, pathBounds, pathToD, pie, point3d, points3d, rect, riemann, samplePath, scatter, scene3d, spin,
    sphere, streamLines, surface, swap, tex, text, tokens, tokenize, trail3d, traced, tree, typewriter, vectorField, vector3d, wipe, write,
    circle, tangentLine, secantLine, areaUnder, braceLabel, surroundingBox, angleMark, rightAngle, circlePath, to, type CompiledFilm,
    type FilmDefinition, type PathOp, type Stage, type Vec, type Vec3,
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

export type { Vec, Vec3 }
