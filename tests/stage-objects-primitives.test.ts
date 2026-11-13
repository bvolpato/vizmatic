import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { arrayCells, attentionMatrix, axes3d, barChart, callout, card, checkFilm, compileFilm, connector, countUp, quote, quotePair, readingSeconds, counter, curve3d, donut, dotChart, draw, dynamic, fadeIn, film, fromSvg, graph, group, heatmap, highlightSweep, histogram, infoBox, lagged, labeledDot, legend, line, lineChart, linear, mixColor, steps, indicate, neuralNet, numberLine, parseColor, parseSvgPath, pathBounds, pictogram, PICTOGRAMS, pie, point3d, points3d, rect, scatter, scene3d, spin, seq, sphere, stateGrid, surface, swap, tag, tagTrack, tex, text, tokens, tree, typewriter, unitChart, vector3d, wipe, write, zone, row, par, linearGradient, moveTo, polygon, circle, braceLabel, surroundingBox, angleMark, rightAngle, to, type CompiledFilm, type Node, type PathOp, type PictogramName, type Rgba, type Stage } from '../src/stage/index'
import { fromComponent } from '../src/stage/export'
import { clock } from '../src/stage/track'
import type { Anim } from '../src/stage/anim'
import { Suspend } from '../src/stage/stage'
import { CalloutCard, getThemeColors, Row, StepCard } from '../src/index'
import { at, compile, expectPure, paths, svgAt } from './helpers/stage-objects'

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

    describe('connector.send', () => {
        // Two boxes with their near edges at -400 and 400, and a straight line between them, which ends 3 from each box.
        const wire = (s: Stage) => {
            const a = s.add(rect(100, 100, { stroke: 'ink' }).at(-450, 0)), b = s.add(rect(100, 100, { stroke: 'ink' }).at(450, 0))
            return s.add(connector(a, b, { route: 'straight', tip: false }))
        }
        // A mark that is 60 wide and 40 high. With the room of 8 at each end, its middle goes from -359 to 359.
        const message = () => rect(60, 40, { fill: 'teal', stroke: null })
        const middle = (node: Node, time: number) => at(time, () => node.center.map((value) => Math.round(value * 10) / 10))
        /** The middle of the red cross in a frame, or null when the frame has none. */
        const crossAt = (f: CompiledFilm, time: number) => {
            const red = parseColor('red')
            const boxes = paths(f, time).filter((op) => op.stroke && (op.stroke as Rgba).every((value, index) => value === red[index])).map((op) => pathBounds(op.path)!)
            if (boxes.length === 0) return null
            const left = Math.min(...boxes.map((b) => b.x)), right = Math.max(...boxes.map((b) => b.x + b.width))
            return Math.round(((left + right) / 2 - f.width / 2) * 10) / 10
        }

        it('carries a mark from the first node to the second at one speed, clear of both, and takes it away', async () => {
            const mark = message()
            const f = await compile((s) => {
                const link = wire(s)
                s.wait(1)
                s.play(link.send(mark, { duration: 2 }))
                expect(s.time).toBeCloseTo(3.12, 6)
                s.wait(0.5)
            })
            // Before its turn the mark is not in the picture: the two boxes and the line are.
            expect(paths(f, 0.5)).toHaveLength(3)
            expect([1.5, 2, 2.5, 3].map((time) => middle(mark, time))).toEqual([[-179.5, 0], [0, 0], [179.5, 0], [359, 0]])
            // It grows in at the start, and it has its size on the way.
            expect(at(1.01, () => mark.bounds().width)).toBeLessThan(10)
            expect(at(2, () => mark.bounds().width)).toBeCloseTo(60, 6)
            // It never fades, so a line under it does not show through.
            expect([1.05, 2, 3.05].map((time) => at(time, () => mark.get('opacity')))).toEqual([1, 1, 1])
            // It goes into the node at the end: it shrinks there, and it is gone after that with its own size again.
            expect(at(3.08, () => mark.bounds().width)).toBeLessThan(40)
            expect(at(3.2, () => [mark.get('visible'), mark.get('sx')])).toEqual([false, 1])
            expect(crossAt(f, 3.05)).toBeNull()
            expectPure(f, [0.5, 1.2, 2, 3.05, 3.4])
        })

        it('sends an answer from the second node to the first', async () => {
            const mark = message()
            await compile((s) => {
                const link = wire(s)
                s.play(link.send(mark, { duration: 2, reverse: true }))
            })
            expect([0.5, 1, 2].map((time) => middle(mark, time))).toEqual([[179.5, 0], [0, 0], [-359, 0]])
        })

        it('stops a lost message on the way, with a cross ahead of it, and holds both', async () => {
            const mark = message()
            const f = await compile((s) => {
                const link = wire(s)
                s.play(link.send(mark, { duration: 2, lost: 0.4, hold: 1 }))
                expect(s.time).toBeCloseTo(3.12, 6)
                s.wait(0.5)
            })
            // The way of a message that stops goes from -359 to 314, where a refused one stops. The time is the time to 0.4 of it.
            expect([1, 2, 2.9].map((time) => middle(mark, time))).toEqual([[-224.4, 0], [-89.8, 0], [-89.8, 0]])
            // The cross is 37 wide, and it is ahead of the mark by the room of 8.
            expect([1.9, 2.5, 2.9, 3.2].map((time) => crossAt(f, time))).toEqual([null, -33.3, -33.3, null])
            expect(at(3.2, () => mark.get('visible'))).toBe(false)
        })

        it.each([[1, false], [1, true], [0.97, false], [0.97, true], [0, false]] as const)('keeps the cross of a message that is lost at %s of its way clear of the node and of the mark (reverse: %s)', async (lost, reverse) => {
            const mark = message()
            const f = await compile((s) => {
                const link = wire(s)
                s.play(link.send(mark, { duration: 1, lost, reverse }))
            })
            // Along the way of the message: the line ends at 397, the mark is 60 wide, the cross is 37 wide, and the room is 8.
            const way = reverse ? -1 : 1
            const markAt = middle(mark, 1.5)[0]! * way, cross = crossAt(f, 1.5)! * way
            expect(cross + 18.5).toBeLessThanOrEqual(397 - 8 + 0.05)
            expect(cross - 18.5).toBeGreaterThanOrEqual(markAt + 30 + 8 - 0.05)
            // At the end of its way, it stops where a refused message stops.
            if (lost === 1) expect([markAt, cross]).toEqual([314, 370.5])
        })

        it('stops a refused message before the node, with the cross between the two', async () => {
            const mark = message()
            const f = await compile((s) => {
                const link = wire(s)
                s.play(link.send(mark, { duration: 2, refused: true, stopColor: 'red' }))
                s.wait(0.5)
            })
            // The cross ends 8 before the end of the line, and the mark ends 8 before the cross.
            expect(middle(mark, 2.5)).toEqual([314, 0])
            expect(crossAt(f, 2.5)).toBe(370.5)
            // An answer that is refused stops before the first node.
            const back = message()
            const g = await compile((s) => {
                const link = wire(s)
                s.play(link.send(back, { duration: 2, refused: true, reverse: true }))
            })
            expect(middle(back, 2.5)).toEqual([-314, 0])
            expect(crossAt(g, 2.5)).toBe(-370.5)
        })

        it('keeps the place of the mark with a mark that is in a group, and with a stretched play', async () => {
            const mark = message()
            await compile((s) => {
                const link = wire(s)
                s.add(group(mark).at(0, 200))
                // The whole animation is 0.9 + 0.12 long, and the play gives it twice that.
                s.play(link.send(mark), { duration: 2.04 })
            })
            expect(middle(mark, 0.9)).toEqual([0, 0])
            expect(middle(mark, 1.8)).toEqual([359, 0])
        })

        it('refuses a time and a room that are not numbers, or that are under 0', async () => {
            const sent = (options: Parameters<ReturnType<typeof connector>['send']>[1]) => compile((s) => { s.play(wire(s).send(message(), options)) })
            for (const duration of [NaN, -1, 0, Infinity]) {
                await expect(sent({ duration })).rejects.toThrow(`connector.send: duration is the time of the message on its way, in seconds, more than 0, and it is ${duration}`)
            }
            for (const hold of [NaN, -0.5, Infinity]) {
                await expect(sent({ lost: 0.5, hold })).rejects.toThrow(`connector.send: hold is how long a message that is lost or refused stays with its cross, in seconds, 0 or more, and it is ${hold}`)
            }
            for (const gap of [NaN, -8]) await expect(sent({ gap })).rejects.toThrow(`connector.send: gap is the room between the mark and a node, in pixels, 0 or more, and it is ${gap}`)
            // A hold of 0 is a message that goes at once.
            await expect(sent({ refused: true, hold: 0 })).resolves.toBeDefined()
        })

        it('stops a film that sends one mark two times at once, and sends a mark again when it has arrived', async () => {
            const twice = compile((s) => {
                const link = wire(s), mark = message()
                s.play(link.send(mark, { duration: 1 }), link.send(mark, { duration: 2, reverse: true }))
            })
            await expect(twice).rejects.toThrow('connector.send: the mark is on its way from 0 s to 1.12 s, and this message is from 0 s to 2.12 s. One mark is at one place at a time. Send a copy of it, such as link.send(mark.clone()), or a new mark for each message')
            // Two messages whose times overlap in part, on two lines.
            const later = compile((s) => {
                const link = wire(s), other = wire(s), mark = message()
                s.at(0.5, () => s.play(other.send(mark, { duration: 1 })))
                s.play(link.send(mark, { duration: 1 }))
            })
            await expect(later).rejects.toThrow(/the mark is on its way from 0.5 s to 1.62 s, and this message is from 0 s to 1.12 s/)
            // A copy of the mark travels at the same time.
            const mark = message(), copy = mark.clone()
            await compile((s) => {
                const link = wire(s)
                s.play(link.send(mark, { duration: 1 }), link.send(copy, { duration: 1, reverse: true }))
                // The mark has arrived, so it can be the answer.
                s.play(link.send(mark, { duration: 1, reverse: true }))
            })
            expect([middle(mark, 0.25), middle(copy, 0.25)]).toEqual([[-179.5, 0], [179.5, 0]])
            expect(at(1.37, () => [mark.get('visible'), mark.get('sx'), ...mark.center.map((value) => Math.round(value * 10) / 10)])).toEqual([true, 1, 179.5, 0])
            expect(middle(mark, 2.12)).toEqual([-359, 0])
        })

        it('says what is wrong with a message that cannot be sent', async () => {
            const sent = (options: Parameters<ReturnType<typeof connector>['send']>[1], mark = message()) => compile((s) => { s.play(wire(s).send(mark, options)) })
            await expect(sent({ lost: 1.5 })).rejects.toThrow(/lost is the part of the way where the message is lost, from 0 to 1, and it is 1.5/)
            await expect(sent({ lost: 0.5, refused: true })).rejects.toThrow(/lost on the way or refused at the end/)
            await expect(sent({}, rect(900, 40))).rejects.toThrow(/the line is 794 long, and a mark that is 900 by 40 needs more to travel/)
            await expect(compile((s) => { s.play(wire(s).send(row([message()]) as never)) })).rejects.toThrow(/connector.send: the mark is a block/)
        })
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
    it('keeps a part on a fill readable in indicate: the tint goes to the fill or to the part, never to both', async () => {
        const paint = (color: string) => line([0, 0], [1, 0], { stroke: color }).get('stroke')
        const colors = (f: CompiledFilm, time: number) => paths(f, time).map((op) => [op.stroke ?? null, op.fill ?? null])
        // The emphasis is at its peak at 0.5, and back at 1.
        const build = (shape: () => Node, label: string, labelColor: string, options: { fill?: boolean } = {}) => compileFilm(film({ fps: 20 }, (s) => {
            const both = s.add(group(shape(), text(label, { size: 48, color: labelColor })))
            s.play(indicate(both, { color: 'yellow', ...options }), { duration: 1 })
            s.wait(0.5)
        }))
        // A ring on a dark panel: the shape is the first path, and the glyph of the number is the second.
        const ring = () => circle(50, { stroke: 'ink', fill: 'surface', width: 4 })
        const dark = await build(ring, '2', 'ink')
        expect(colors(dark, 0)).toEqual([[paint('ink'), paint('surface')], [null, paint('ink')]])
        // Yellow on the dark panel has more contrast than the light number on a yellow disc: the panel keeps its color.
        expect(colors(dark, 0.5)).toEqual([[paint('yellow'), paint('surface')], [null, paint('yellow')]])
        expect(colors(dark, 1.2)).toEqual(colors(dark, 0))
        // A light badge under a dark number: the dark number on a yellow disc has more contrast, so the number keeps its color.
        const badge = await build(() => circle(50, { stroke: null, fill: 'blue' }), '3', 'bg')
        expect(colors(badge, 0.5)).toEqual([[null, paint('yellow')], [null, paint('bg')]])
        expect(colors(badge, 1.2)).toEqual(colors(badge, 0))
        // With `fill: true`, every paint takes the tint, so the number is the color of its ring.
        const filled = await build(ring, '2', 'ink', { fill: true })
        expect(colors(filled, 0.5)).toEqual([[paint('yellow'), paint('yellow')], [null, paint('yellow')]])
        // A shape with nothing on it takes the tint in full, as before.
        const alone = await compileFilm(film({ fps: 20 }, (s) => {
            const bar = s.add(rect(300, 56, { stroke: 'teal', fill: 'teal', width: 2 }))
            s.play(indicate(bar, { color: 'yellow' }), { duration: 1 })
        }))
        expect(colors(alone, 0.5)).toEqual([[paint('yellow'), paint('yellow')]])
        // The ring and its number as a list of two targets, not one group: the same result.
        const listed = await compileFilm(film({ fps: 20 }, (s) => {
            const shape = s.add(ring()), number = s.add(text('2', { size: 48 }))
            s.play(indicate([shape, number], { color: 'yellow' }), { duration: 1 })
        }))
        expect(colors(listed, 0.5)).toEqual([[paint('yellow'), paint('surface')], [null, paint('yellow')]])
    })

    // ── indicate: the rule of a part on a fill ─────────────────────────────────────────────────────────────
    const paintOf = (color: string) => line([0, 0], [1, 0], { stroke: color }).get('stroke') as Rgba
    const dark = '#101014'
    /** The fills and the lines that a frame draws for a node and its parts. A part that has both gives both. */
    const paintsOf = (f: CompiledFilm, time: number, node: Node) => paths(f, time).filter((op) => op.node && node.all().includes(op.node)).flatMap((op) => [op.stroke, op.fill].filter((paint) => paint !== null))
    const fillOf = (f: CompiledFilm, time: number, node: Node) => paths(f, time).find((op) => op.node === node)?.fill ?? null
    const strokeOf = (f: CompiledFilm, time: number, node: Node) => paths(f, time).find((op) => op.node === node)?.stroke ?? null
    /** A film that builds parts, plays one `indicate` of what `build` returns for one second, and waits. The peak is at 0.5. */
    const atPeak = (build: (s: Stage) => Node | Node[], options: { color?: string; fill?: boolean } = {}) => compileFilm(film({ fps: 20 }, (s) => {
        s.play(indicate(build(s), { color: 'yellow', ...options }), { duration: 1 })
        s.wait(0.5)
    }))
    const ringShape = () => circle(50, { stroke: 'ink', fill: 'surface', width: 4 })
    const badge = () => circle(50, { stroke: null, fill: 'blue' })

    it('indicate gives the glyphs of one text or one formula the tint together: no glyph is the backing of the next', async () => {
        const yellow = paintOf('yellow')
        for (const make of [() => tex('\\int_0^1 f(x)\\,dx', { size: 64 }), () => tex('V_i + T_1', { size: 72 }), () => tex('\\frac{a}{b}+\\sqrt{x}', { size: 52 }), () => text('7. V. fi', { size: 64, font: 'serif', italic: true })]) {
            let made!: Node
            const f = await atPeak((s) => made = s.add(make()))
            expect(paintsOf(f, 0, made).length).toBeGreaterThan(3)
            expect(paintsOf(f, 0.5, made).every((paint) => paint === yellow), (made as unknown as { source: string }).source).toBe(true)
            expect(paintsOf(f, 1.2, made)).toEqual(paintsOf(f, 0, made))
        }
        // In a box, the formula is one part on the panel: the border and every glyph take the tint, and the panel keeps its color.
        let panel!: Node, formula!: Node
        const boxed = await atPeak((s) => s.add(group(panel = rect(290, 150, { radius: 12, stroke: 'ink', fill: 'surface' }), formula = tex('\\int_0^1 f\\,dx', { size: 56 }))))
        expect([strokeOf(boxed, 0.5, panel), fillOf(boxed, 0.5, panel)]).toEqual([yellow, paintOf('surface')])
        expect(paintsOf(boxed, 0.5, formula).every((paint) => paint === yellow)).toBe(true)
        // Some glyphs of a formula as the targets: each one takes the tint, and the other glyphs keep their color.
        let eq!: ReturnType<typeof tex>
        const some = await atPeak((s) => { eq = s.add(tex('a^2 + b^2 = c^2', { size: 72 })); return eq.part('c^2') })
        expect(eq.part('c^2').map((glyph) => fillOf(some, 0.5, glyph))).toEqual(eq.part('c^2').map(() => yellow))
        expect(eq.part('a^2').map((glyph) => fillOf(some, 0.5, glyph))).toEqual(eq.part('a^2').map(() => paintOf('ink')))
    })

    it('indicate takes a part as on a fill by the shape of the fill, not by its box', async () => {
        const yellow = paintOf('yellow'), blue = paintOf('blue')
        // The label is in the box of the triangle and outside its shape: it is beside the fill, so both take the tint in full.
        const triangle = () => polygon([[-120, 80], [120, 80], [120, -80]], { stroke: null, fill: 'blue' })
        let shape!: Node, label!: Node
        const beside = await atPeak((s) => s.add(group(shape = triangle(), label = text('c', { size: 44, color: dark }).at(-40, -40))))
        expect(fillOf(beside, 0.5, shape)).toBe(yellow)
        expect(paintsOf(beside, 0.5, label)).toEqual([yellow])
        // The same label inside the shape is on the fill: the fill takes the tint, and the dark label keeps its color on it.
        const inside = await atPeak((s) => s.add(group(shape = triangle(), label = text('c', { size: 44, color: dark }).at(60, 30))))
        expect(fillOf(inside, 0.5, shape)).toBe(yellow)
        expect(paintsOf(inside, 0.5, label)).toEqual([paintOf(dark)])
        expect(fillOf(inside, 0, shape)).toBe(blue)
        // A number in the hole of a donut is on no wedge: every wedge takes the tint, and not one of them alone.
        let ring!: Node
        const hole = await atPeak((s) => ring = s.add(donut([{ label: 'a', value: 3 }, { label: 'b', value: 1 }], { radius: 110, labels: false, centerLabel: '75%' })))
        const before = paintsOf(hole, 0, ring), peak = paintsOf(hole, 0.5, ring)
        expect(new Set(before).size).toBeGreaterThan(1)
        expect(peak.every((paint) => paint === yellow)).toBe(true)
        // A part that is larger than a fill is not on it: a wide outline around a dot. Both take the tint in full.
        let dot!: Node, outline!: Node
        const around = await atPeak((s) => s.add(group(dot = circle(20, { stroke: null, fill: 'blue' }), outline = circle(100, { stroke: 'ink', fill: null }))))
        expect([fillOf(around, 0.5, dot), strokeOf(around, 0.5, outline)]).toEqual([yellow, yellow])
        // A part of the size of the fill is its border, and not a thing on it: a separate border takes the tint, where the dark
        // word on the light fill keeps its color.
        let fillOnly!: Node, border!: Node, title!: Node
        const twin = await atPeak((s) => s.add(group(fillOnly = rect(220, 100, { radius: 18, stroke: null, fill: 'blue' }), border = rect(220, 100, { radius: 18, stroke: dark, fill: null, width: 4 }), title = text('review', { size: 44, color: dark }))))
        expect([fillOf(twin, 0.5, fillOnly), strokeOf(twin, 0.5, border)]).toEqual([yellow, yellow])
        expect(paintsOf(twin, 0.5, title).every((paint) => paint === paintOf(dark))).toBe(true)
        // The glyphs of a text as the targets: a dot that lies on the stem of a letter is not on a fill, so both take the tint.
        let letters!: ReturnType<typeof text>
        const glyphs = await atPeak((s) => { letters = s.add(text('l.', { size: 200 })); letters.chars[1]!.moveTo(letters.chars[0]!.center); return letters.chars })
        expect(letters.chars.map((glyph) => fillOf(glyphs, 0.5, glyph))).toEqual([yellow, yellow])
        // A group that is turned and scaled: the test is on the shape as the stage draws it.
        let panel!: Node, word!: Node
        const turned = await atPeak((s) => s.add(group(panel = rect(200, 90, { radius: 12, stroke: 'ink', fill: 'surface', width: 3 }), word = text('turn', { size: 40 })).rotate(0.6).scale(1.2)))
        expect([strokeOf(turned, 0.5, panel), fillOf(turned, 0.5, panel)]).toEqual([yellow, paintOf('surface')])
        expect(paintsOf(turned, 0.5, word).every((paint) => paint === yellow)).toBe(true)
    })

    it('indicate calls the color() of an object that has its own, and `fill: true` is the old call', async () => {
        const yellow = paintOf('yellow')
        const made = () => tag('MEASURED', { note: 'June 2026', color: 'green', anchor: 'center' })
        let label!: ReturnType<typeof tag>
        const own = await atPeak((s) => label = s.add(made()))
        // The border of the pill and the word take the tint. The fill of the pill and the note keep their colors.
        const look = (f: CompiledFilm, time: number) => ({ border: strokeOf(f, time, label.pill), pill: fillOf(f, time, label.pill), word: paintsOf(f, time, label.word), note: paintsOf(f, time, label.note!) })
        const rest = look(own, 0), peak = look(own, 0.5)
        expect(peak.border).toBe(yellow)
        expect(peak.word.every((paint) => paint === yellow)).toBe(true)
        expect([peak.pill, peak.note]).toEqual([rest.pill, rest.note])
        // The same picture as the call of the object, with no rule between them.
        const called = await compileFilm(film({ fps: 20 }, (s) => { label = s.add(made()); s.play(to(label, (t) => t.scale(1.14).color('yellow'), { restore: true, ease: (x) => 4 * x * (1 - x) }), { duration: 1 }); s.wait(0.5) }))
        expect(look(called, 0.5)).toEqual(peak)
        // `fill: true` is `node.color(color)`: for a tag, that is its own color() too.
        const filled = await atPeak((s) => label = s.add(made()), { fill: true })
        expect(look(filled, 0.5)).toEqual(peak)
        // A tag in a group, on a panel: the tag still has its own emphasis.
        const grouped = await atPeak((s) => s.add(group(rect(600, 200, { stroke: 'ink', fill: 'surface' }), label = made())))
        expect([look(grouped, 0.5).pill, look(grouped, 0.5).note]).toEqual([rest.pill, rest.note])
        expect(look(grouped, 0.5).border).toBe(yellow)
        // `fill: true` on a plain shape with a number is the old picture: one color for the disc, its border and its number.
        let both!: Node
        const flat = await atPeak((s) => both = s.add(group(ringShape(), text('2', { size: 48 }))), { fill: true })
        expect(paintsOf(flat, 0.5, both).every((paint) => paint === yellow)).toBe(true)
    })

    it('indicate makes its choice when the animation starts, from the places and the colors that the parts have then', async () => {
        const yellow = paintOf('yellow')
        // The number moves onto its ring, and then both are indicated, in one sequence: the number is on the ring when the tint starts.
        let shape!: Node, number!: Node
        const moved = await compileFilm(film({ fps: 20 }, (s) => {
            shape = s.add(ringShape().at(-200, 0))
            number = s.add(text('2', { size: 48 }).at(200, 0))
            s.play(seq(moveTo(number, shape, { duration: 0.5 }), indicate([shape, number], { color: 'yellow', duration: 1 })))
            s.wait(0.5)
        }))
        expect([strokeOf(moved, 1, shape), fillOf(moved, 1, shape)]).toEqual([yellow, paintOf('surface')])
        expect(paintsOf(moved, 1, number)).toEqual([yellow])
        // The disc turns blue and its number dark, and then both are indicated: the choice is for the new colors.
        const recolored = await compileFilm(film({ fps: 20 }, (s) => {
            shape = ringShape()
            number = text('3', { size: 48 })
            const both = s.add(group(shape, number))
            s.play(seq(par(to(shape, (d) => d.fill('blue').stroke(null), { duration: 0.5 }), to(number, (n) => n.color(dark), { duration: 0.5 })), indicate(both, { color: 'yellow', duration: 1 })))
            s.wait(0.5)
        }))
        expect(fillOf(recolored, 1, shape)).toBe(yellow)
        expect(paintsOf(recolored, 1, number)).toEqual([paintOf(dark)])
        // One animation that a film plays two times makes its choice two times.
        const twice = await compileFilm(film({ fps: 20 }, (s) => {
            shape = s.add(ringShape())
            number = text('2', { size: 48 }).at(300, 0)
            s.add(number)
            const pulse = indicate([shape, number], { color: 'yellow', duration: 1 })
            s.play(pulse)
            number.at(0, 0)
            s.play(pulse)
        }))
        expect(fillOf(twice, 0.5, shape)).toBe(yellow)
        expect(fillOf(twice, 1.5, shape)).toBe(paintOf('surface'))
    })

    it('indicate follows the draw order of the stage, and leaves out a part that does not show', async () => {
        const yellow = paintOf('yellow'), surface = paintOf('surface')
        let shape!: Node, number!: Node
        // The list names the number before its ring. The stage draws the ring first.
        const listed = await atPeak((s) => { shape = s.add(ringShape()); number = s.add(text('2', { size: 48 })); return [number, shape] })
        expect([strokeOf(listed, 0.5, shape), fillOf(listed, 0.5, shape)]).toEqual([yellow, surface])
        expect(paintsOf(listed, 0.5, number)).toEqual([yellow])
        // A panel that is added after its number and sent behind it with z.
        const behind = await atPeak((s) => s.add(group(number = text('2', { size: 48 }), shape = ringShape().zIndex(-1))))
        expect([strokeOf(behind, 0.5, shape), fillOf(behind, 0.5, shape)]).toEqual([yellow, surface])
        expect(paintsOf(behind, 0.5, number)).toEqual([yellow])
        // The same group when it is not on the stage yet: `indicate` brings it, and then looks at the order.
        const brought = await atPeak(() => group(number = text('2', { size: 48 }), shape = ringShape().zIndex(-1)))
        expect([strokeOf(brought, 0.5, shape), fillOf(brought, 0.5, shape)]).toEqual([yellow, surface])
        expect(paintsOf(brought, 0.5, number)).toEqual([yellow])
        // A number that the stage draws under its disc is not on the disc: both take the tint in full, as a disc alone does.
        const under = await atPeak((s) => s.add(group(number = text('2', { size: 48 }), shape = ringShape())))
        expect(fillOf(under, 0.5, shape)).toBe(yellow)
        // A white part on a light badge that does not show is no content: the badge takes the tint under its dark number.
        for (const gone of [(part: Node) => part.opacity(0), (part: Node) => part.set('visible', false)]) {
            const hidden = await atPeak((s) => s.add(group(shape = badge(), number = text('3', { size: 48, color: dark }), gone(text('ok', { size: 40, color: '#ffffff' })))))
            expect(fillOf(hidden, 0.5, shape)).toBe(yellow)
            expect(paintsOf(hidden, 0.5, number)).toEqual([paintOf(dark)])
        }
        // With a dark tint, a part that does not show would look as dark as the film behind it. It is not counted: the badge
        // takes the tint under its white number.
        const night = await atPeak((s) => s.add(group(shape = badge(), number = text('3', { size: 48, color: '#ffffff' }), text('ok', { size: 40, color: '#ffffff' }).opacity(0))), { color: dark })
        expect(fillOf(night, 0.5, shape)).toEqual(paintOf(dark))
        expect(paintsOf(night, 0.5, number)).toEqual([paintOf('#ffffff')])
        // A fill that does not show is no backing: its number takes the tint.
        const clear = await atPeak((s) => s.add(group(shape = badge().opacity(0), number = text('3', { size: 48, color: dark }))))
        expect(paintsOf(clear, 0.5, number)).toEqual([yellow])
    })

    it('indicate chooses by the least readable part, by the line or the fill that shows a part, and keeps a pair that no tint keeps readable', async () => {
        const yellow = paintOf('yellow'), blue = paintOf('blue')
        let shape!: Node, number!: Node, other!: Node
        // A dark number and a white word on one light badge. A yellow badge would hide the white word, and a yellow word is
        // hard to read on the badge: the pair is easier to read as it is, so the badge and both texts keep their colors.
        const two = await atPeak((s) => s.add(group(shape = badge(), number = text('3', { size: 48, color: dark }).at(-18, 0), other = text('ok', { size: 28, color: '#ffffff' }).at(24, 0))))
        expect(fillOf(two, 0.5, shape)).toBe(blue)
        expect([paintsOf(two, 0.5, number), paintsOf(two, 0.5, other)]).toEqual([[paintOf(dark)], [paintOf('#ffffff'), paintOf('#ffffff')]])
        // The same for one light number on a light badge. It still swells.
        const light = await atPeak((s) => s.add(group(shape = badge(), number = text('3', { size: 48, color: '#ffffff' }))))
        expect([fillOf(light, 0.5, shape), paintsOf(light, 0.5, number)]).toEqual([blue, [paintOf('#ffffff')]])
        expect(at(0.5, () => shape.parent!.get('sx'))).toBeCloseTo(1.14, 6)
        // A text of two colors is as readable as its least readable glyph: a dark letter and a white letter on the light badge
        // keep their colors, and so does the badge.
        let pair!: ReturnType<typeof text>
        const mixed = await atPeak((s) => { const both = s.add(group(shape = badge(), pair = text('ab', { size: 48 }))); pair.chars[0]!.color(dark); pair.chars[1]!.color('#ffffff'); return both })
        expect(fillOf(mixed, 0.5, shape)).toBe(blue)
        expect(paintsOf(mixed, 0.5, pair)).toEqual([paintOf(dark), paintOf('#ffffff')])
        // A pair that is hard to read as it is takes the tint where it helps: a light word on a white panel turns yellow.
        const pale = await atPeak((s) => s.add(group(shape = rect(200, 100, { stroke: null, fill: '#ffffff' }), other = text('pale', { size: 48 }))))
        expect(fillOf(pale, 0.5, shape)).toEqual(paintOf('#ffffff'))
        expect(paintsOf(pale, 0.5, other).every((paint) => paint === yellow)).toBe(true)
        // "Readable" is a contrast of 3 to 1. A gold badge under this gray number has 2 to 1, and the pair has 3.2 as it is:
        // both keep their colors.
        const gold = await atPeak((s) => s.add(group(shape = circle(50, { stroke: null, fill: '#1e6fb4' }), number = text('3', { size: 48, color: '#cccccc' }))), { color: '#b8860b' })
        expect([fillOf(gold, 0.5, shape), paintsOf(gold, 0.5, number)]).toEqual([paintOf('#1e6fb4'), [paintOf('#cccccc')]])
        // A drawing that a tint cannot reach decides with the texts: white digits on the light badge are hard to read, so a dark
        // tint goes to the badge, where the digits and the gray word are readable.
        const digits = await atPeak((s) => s.add(group(shape = badge(), counter(7, { size: 40, digits: 0, color: '#ffffff' }).at(-20, 0), other = text('x', { size: 40, color: '#888888' }).at(22, 0))), { color: dark })
        expect(fillOf(digits, 0.5, shape)).toEqual(paintOf(dark))
        expect(paintsOf(digits, 0.5, other)).toEqual([paintOf('#888888')])
        // A small box with a light border and a dark fill on a light badge: its dark fill shows it on a yellow badge, so the badge takes the tint.
        const boxed = await atPeak((s) => s.add(group(shape = badge(), other = circle(24, { stroke: 'ink', fill: 'surface', width: 3 }))))
        expect(fillOf(boxed, 0.5, shape)).toBe(yellow)
        expect([strokeOf(boxed, 0.5, other), fillOf(boxed, 0.5, other)]).toEqual([paintOf('ink'), paintOf('surface')])
        // A small box with a dark border and a light fill: its border shows it.
        const lined = await atPeak((s) => s.add(group(shape = badge(), other = circle(24, { stroke: dark, fill: 'ink', width: 3 }))))
        expect(fillOf(lined, 0.5, shape)).toBe(yellow)
        expect([strokeOf(lined, 0.5, other), fillOf(lined, 0.5, other)]).toEqual([paintOf(dark), paintOf('ink')])
        // A ring in a badge in a ring: each part has one backing, the last fill that is drawn under it.
        let outer!: Node, middle!: Node, inner!: Node
        const nested = await atPeak((s) => s.add(group(outer = circle(120, { stroke: 'ink', fill: 'surface', width: 3 }), middle = circle(84, { stroke: null, fill: 'blue' }), inner = circle(46, { stroke: 'ink', fill: 'surface', width: 3 }), number = text('1', { size: 44 }))))
        expect([strokeOf(nested, 0.5, outer), fillOf(nested, 0.5, outer)]).toEqual([yellow, paintOf('surface')])
        expect(fillOf(nested, 0.5, middle)).toBe(yellow)
        expect([strokeOf(nested, 0.5, inner), fillOf(nested, 0.5, inner)]).toEqual([paintOf('ink'), paintOf('surface')])
        expect(paintsOf(nested, 0.5, number)).toEqual([yellow])
    })

    it('indicate keeps the alpha of a wash, reads a gradient by its middle, and leaves a drawing that a function makes', async () => {
        const yellow = paintOf('yellow')
        let shape!: Node, word!: Node
        // A fill that is not opaque keeps its alpha under the tint. `fill: true` is the old call, which makes it opaque.
        const wash = await atPeak((s) => shape = s.add(rect(240, 100, { stroke: null, fill: 'rgba(92, 196, 240, 0.2)' })))
        expect(fillOf(wash, 0.5, shape)).toEqual([yellow[0], yellow[1], yellow[2], 0.2])
        const opaque = await atPeak((s) => shape = s.add(rect(240, 100, { stroke: null, fill: 'rgba(92, 196, 240, 0.2)' })), { fill: true })
        expect(fillOf(opaque, 0.5, shape)).toBe(yellow)
        // A wash on a dark film is a dark panel: the border and the text light up, and the wash stays.
        const panel = await atPeak((s) => s.add(group(shape = rect(240, 100, { radius: 14, stroke: 'faint', width: 2 }).fill('ink', 0.12), word = text('wash', { size: 48 }))))
        expect([strokeOf(panel, 0.5, shape), fillOf(panel, 0.5, shape)]).toEqual([yellow, paintOf('ink')])
        expect(paintsOf(panel, 0.5, word).every((paint) => paint === yellow)).toBe(true)
        // A warm gradient under a dark word is a light panel: it takes the tint as one color, and the word keeps its color.
        const warm = await atPeak((s) => s.add(group(shape = rect(240, 100, { stroke: null, fill: linearGradient([-120, 0], [120, 0], ['yellow', 'orange']) }), word = text('warm', { size: 48, color: dark }))))
        expect(fillOf(warm, 0.5, shape)).toBe(yellow)
        expect(paintsOf(warm, 0.5, word).every((paint) => paint === paintOf(dark))).toBe(true)
        // A dark gradient under a light word is a dark panel: the gradient stays, and the word lights up.
        const night = await atPeak((s) => s.add(group(shape = rect(240, 100, { stroke: null, fill: linearGradient([-120, 0], [120, 0], ['#101014', '#202030']) }), word = text('night', { size: 48 }))))
        expect((fillOf(night, 0.5, shape) as { stops?: unknown }).stops).toEqual((fillOf(night, 0, shape) as { stops?: unknown }).stops)
        expect(fillOf(night, 0.5, shape)).toHaveProperty('stops')
        expect(paintsOf(night, 0.5, word).every((paint) => paint === yellow)).toBe(true)
        // A gradient from white to black is a gray panel, by its middle: a light blue word takes the tint on it.
        const gray = await atPeak((s) => s.add(group(shape = rect(240, 100, { stroke: null, fill: linearGradient([-120, 0], [120, 0], ['#ffffff', '#000000']) }), word = text('gray', { size: 48, color: 'blue' }))))
        expect(fillOf(gray, 0.5, shape)).toHaveProperty('stops')
        expect(paintsOf(gray, 0.5, word).every((paint) => paint === yellow)).toBe(true)
        // A dark word on a wash is on a dark panel, by what a viewer sees through the wash: the word takes the tint.
        const faint = await atPeak((s) => s.add(group(shape = rect(240, 100, { stroke: null }).fill('ink', 0.12), word = text('dark', { size: 48, color: dark }))))
        expect(fillOf(faint, 0.5, shape)).toBe(paintOf('ink'))
        expect(paintsOf(faint, 0.5, word).every((paint) => paint === yellow)).toBe(true)
        // A pale wash under a dark word: yellow is hard to read on it, so the wash takes the tint, at its own opacity.
        const pale = await atPeak((s) => s.add(group(shape = rect(240, 100, { stroke: null }).fill('#ffffff', 0.8), word = text('pale', { size: 48, color: dark }))))
        expect(fillOf(pale, 0.5, shape)).toBe(yellow)
        expect(paths(pale, 0.5).find((op) => op.node === shape)!.fillAlpha).toBeCloseTo(0.8, 6)
        expect(paintsOf(pale, 0.5, word).every((paint) => paint === paintOf(dark))).toBe(true)
        // An opaque white panel under a dark word, with a gold tint that is readable on it: the panel takes the tint, because the
        // dark word on gold has more contrast. Only a wash gives its content the tint first.
        const solid = await atPeak((s) => s.add(group(shape = rect(240, 100, { stroke: null, fill: '#ffffff' }), word = text('solid', { size: 48, color: dark }))), { color: '#b8860b' })
        expect(fillOf(solid, 0.5, shape)).toEqual(paintOf('#b8860b'))
        expect(paintsOf(solid, 0.5, word).every((paint) => paint === paintOf(dark))).toBe(true)
        // A counter draws its digits again on each frame, so a tint cannot reach it. On a ring it is one part: the disc keeps its
        // color under the light digits, and the border takes the tint.
        const counted = await atPeak((s) => s.add(group(shape = ringShape(), counter(7, { size: 48, digits: 0 }))))
        expect([strokeOf(counted, 0.5, shape), fillOf(counted, 0.5, shape)]).toEqual([yellow, paintOf('surface')])
        // Dark digits on a light badge: the badge takes the tint under them.
        const dial = await atPeak((s) => s.add(group(shape = badge(), counter(7, { size: 48, digits: 0, color: dark }))))
        expect(fillOf(dial, 0.5, shape)).toBe(yellow)
        // A glow takes the tint with its shape, and the glow of a part that keeps its colors stays.
        let glowing!: Node
        const lit = await atPeak((s) => s.add(group(shape = badge().glow(8, 'blue'), glowing = text('3', { size: 48, color: dark }).glow(4, 'red'))))
        expect(paths(lit, 0.5).find((op) => op.node === shape)!.glowColor).toBe(yellow)
        expect(at(0.5, () => glowing.get('glowColor'))).toEqual(paintOf('red'))
        // The tint `ink` on an ink target changes no color: the target only swells.
        let plain!: Node
        const same = await atPeak((s) => plain = s.add(text('ink', { size: 48 })), { color: 'ink' })
        expect(paintsOf(same, 0.5, plain)).toEqual(paintsOf(same, 0, plain))
    })

    it('indicate gives the marks of one pictogram the tint together: a soft fill of it is not the backing of its lines', async () => {
        const yellow = paintOf('yellow')
        // Each of these pictures has lines of one color on a soft fill of its other color.
        for (const name of ['ring', 'pagetable', 'forecast'] as const) {
            let picture!: Node
            const f = await atPeak((s) => picture = s.add(pictogram(name, { size: 96, accent: 'teal' })))
            expect(new Set(paintsOf(f, 0, picture)).size, name).toBeGreaterThan(1)
            expect(paintsOf(f, 0.5, picture).every((paint) => paint === yellow), name).toBe(true)
            expect(paintsOf(f, 1.2, picture)).toEqual(paintsOf(f, 0, picture))
        }
    })

    it('indicate reads the tint on a wash at the opacity of the wash', async () => {
        const yellow = paintOf('yellow'), gray = '#585858'
        let shape!: Node, word!: Node
        // A gray word on a pale wash, on a dark film. The wash shows a tint at its own opacity: yellow is a dim yellow there,
        // and the word has 2 to 1 on it, less than the 2.6 that it has now. A yellow word has less too. The pair keeps its colors.
        const wash = await atPeak((s) => s.add(group(shape = rect(240, 100, { stroke: null }).fill('#ffffff', 0.6), word = text('gray', { size: 48, color: gray }))))
        expect(fillOf(wash, 0.5, shape)).toEqual(paintOf('#ffffff'))
        expect(paintsOf(wash, 0.5, word).every((paint) => paint === paintOf(gray))).toBe(true)
        // An opaque panel of the color that the wash shows: the word has 5 to 1 on a yellow panel, so the panel takes the tint.
        const solid = await atPeak((s) => s.add(group(shape = rect(240, 100, { stroke: null, fill: '#9d9e9f' }), word = text('gray', { size: 48, color: gray }))))
        expect(fillOf(solid, 0.5, shape)).toBe(yellow)
        expect(paintsOf(solid, 0.5, word).every((paint) => paint === paintOf(gray))).toBe(true)
    })

    it('indicate takes 3 to 1 as the limit of a readable pair', async () => {
        // The blue, the yellow and the page color of the look `paper`. A white number has 3.3 to 1 on a yellow badge: the badge
        // takes the tint. A number in the page color looks the same and has a little less than 3 to 1 there, where it has 4.8
        // on the blue: that pair keeps its colors. The limit is a line.
        const navy = '#1f6fb2', amber = '#b98500', page = '#f7f3ea'
        let shape!: Node, number!: Node
        const white = await atPeak((s) => s.add(group(shape = circle(50, { stroke: null, fill: navy }), number = text('3', { size: 48, color: '#ffffff' }))), { color: amber })
        expect([fillOf(white, 0.5, shape), paintsOf(white, 0.5, number)]).toEqual([paintOf(amber), [paintOf('#ffffff')]])
        const offWhite = await atPeak((s) => s.add(group(shape = circle(50, { stroke: null, fill: navy }), number = text('3', { size: 48, color: page }))), { color: amber })
        expect([fillOf(offWhite, 0.5, shape), paintsOf(offWhite, 0.5, number)]).toEqual([paintOf(navy), [paintOf(page)]])
    })

    it('indicate finds the backing of each part of a large target', async () => {
        // A grid of 60 by 50 cells on a panel. Each cell is on the panel, and no cell is on another cell: the panel keeps its
        // color, and each cell takes the tint. The parts look for their backing in a grid of cells, and not at every other part.
        let grid!: ReturnType<typeof stateGrid>, panel!: Node
        const f = await compileFilm(film({ fps: 20 }, (s) => {
            panel = s.add(rect(1400, 1000, { stroke: 'ink', fill: 'surface' }))
            grid = s.add(stateGrid({ columns: 60, rows: 50, cell: 8, gap: 2, initial: 'present' }))
            s.play(indicate([panel, grid], { color: 'yellow' }), { duration: 1 })
        }))
        expect(grid.cells).toHaveLength(3000)
        expect(fillOf(f, 0.5, panel)).toBe(paintOf('surface'))
        expect(strokeOf(f, 0.5, panel)).toBe(paintOf('yellow'))
        const tinted = paths(f, 0.5).filter((op) => op.node !== panel && op.fill === paintOf('yellow')).length
        expect(tinted).toBeGreaterThanOrEqual(3000)
    })

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
        'graph.setState': () => one(graph([{ id: 'a', at: [-100, 0] }, { id: 'b', at: [100, 0] }], [{ from: 'a', to: 'b' }], { layout: 'manual' }), (made) => made.setState('a', 'done')),
        'graph.send': () => one(graph([{ id: 'a', value: '1', at: [-100, 0] }, { id: 'b', value: '', at: [100, 0] }], [{ from: 'a', to: 'b', label: 'x' }], { layout: 'manual' }), (made) => made.send('b', 'a', { value: '2' })),
        'graph.go': () => one(graph([{ id: 'a', at: [-100, 0] }, { id: 'b', at: [100, 0] }], [{ from: 'a', to: 'b' }], { layout: 'manual', token: 'a' }), (made) => made.go('b')),
        'graph.grow': () => one(graph([{ id: 'a', at: [-100, 0] }, { id: 'b', at: [100, 0] }], [{ from: 'a', to: 'b' }], { layout: 'manual', shown: ['a'] }), (made) => made.grow('b')),
        'tree.path': () => one(tree({ id: 'r', label: 'r', value: '1', children: [{ id: 'c', label: 'c', value: '2', edge: 'yes' }] }), (made) => made.path('c')),
        'tree.keep': () => one(tree({ id: 'r', label: 'r', children: [{ id: 'c', label: 'c' }, { id: 'd', label: 'd' }] }), (made) => made.keep('c')),
        'arrayCells.enter': () => one(arrayCells([3, 1, 4]), (cells) => cells.enter()),
        'neuralNet.enter': () => one(neuralNet([2, 2]), (net) => net.enter()),
        'tokens.enter': () => one(tokens(['a', 'b']), (row) => row.enter()),
        'infoBox.enter': () => one(infoBox({ title: 'A', rows: [{ label: 'x', value: '1' }] }), (box) => box.enter()),
        // A connector draws between its two ends, so the ends are in the group with it.
        'connector.pulse': () => {
            const a = rect(40, 40).at(-100, 0), b = rect(40, 40).at(100, 0), link = connector(a, b)
            return { nodes: [a, b, link], anim: link.pulse() }
        },
        'connector.send': () => {
            const a = rect(40, 40).at(-200, 0), b = rect(40, 40).at(200, 0), link = connector(a, b)
            return { nodes: [a, b, link, rect(30, 30)], anim: link.send(rect(30, 30), { refused: true }) }
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

    it('puts the accent of a picture in the place of the part that it is about', () => {
        // For each picture: the number of accent marks, and the box that holds them on the 24-unit grid, as [left, top, right, bottom].
        const places: [PictogramName, number, [number, number, number, number]][] = [
            ['issue', 2, [5, 7, 11, 13.2]], // the circle and its dot
            ['checklist', 2, [3.5, 3, 9, 13.6]], // the two checks
            ['desktop', 1, [8.5, 6, 15.5, 15.5]], // the pointer
            ['recording', 1, [8, 8, 16, 16]], // the dot
            ['approval', 1, [14.5, 5.5, 21.5, 11]], // the check
            ['proxy', 1, [8, 4, 16, 20]], // the gate
            ['certificate', 2, [13.5, 10.5, 20.5, 22]], // the seal and its ribbon
            ['sleep', 1, [12, 8.5, 19.2, 15.6]], // the moon
            ['shard', 1, [13.4, 2.5, 20.4, 10.4]], // the piece
            ['worker', 2, [10, 3, 21, 14.5]], // the arrow and its head
            ['workflow', 1, [2, 6.5, 8, 13]], // the ribbon
            ['activity', 2, [7, 10.5, 22, 13.5]], // the arrow and its head
            ['creditCard', 1, [2, 8.2, 22, 12]], // the stripe
            ['forum', 1, [13.5, 2.5, 21.7, 10.4]], // the badge
            ['paywall', 2, [4, 9.4, 20, 22]], // the lock and its shackle
            // The brief of these pictures does not name the accent. The picture says which part carries the meaning.
            ['pullRequest', 3, [10.5, 3.5, 20.5, 21.5]], // the branch that asks to join, with its arrow head
            ['repository', 5, [7, 9.3, 16.8, 18]], // the branch mark
            ['browser', 1, [8, 5, 19.5, 8.2]], // the address line
            ['server', 2, [4.5, 10.5, 11, 13.5]], // the two lights
            ['laptop', 1, [1.5, 16.5, 22.5, 20]], // the deck
            ['signal', 2, [2, 10.5, 13.2, 13.5]], // the arrow to the box
            ['query', 2, [2, 13.9, 12, 16.9]], // the answer, which is the arrow back
            ['update', 2, [2, 7.1, 13.2, 10.1]], // the write, which is the arrow to the box
            ['warehouse', 3, [8, 14, 16, 21]], // the boxes behind the door
            ['truck', 1, [2, 5, 14, 17]], // the load
            ['microphone', 1, [8.5, 2.5, 15.5, 14]], // the capsule
        ]
        for (const [name, count, [left, top, right, bottom]] of places) {
            // At a size of 24, one pixel is one unit of the grid, and the middle of the grid is at 0.
            const plain = new Set(pictogram(name, { size: 24, color: 'ink' }).children.map(paint))
            const accent = pictogram(name, { size: 24, color: 'ink', accent: 'teal' }).children.filter((mark) => !plain.has(paint(mark)))
            expect(accent, name).toHaveLength(count)
            for (const mark of accent) {
                const box = pathBounds(mark.get('path')!)!
                expect([box.x + 12 >= left, box.y + 12 >= top, box.x + box.width + 12 <= right, box.y + box.height + 12 <= bottom], name).toEqual([true, true, true, true])
            }
        }
    })

    it('tells signal, query, and update apart by the arrow back from the box: none, dashed, solid', () => {
        // The arrow back is a line and a head, left of the box and under the middle of the grid. The box starts 1.5 units right of the middle.
        const back = (name: PictogramName) => pictogram(name, { size: 24 }).children.filter((mark) => {
            const box = pathBounds(mark.get('path')!)!
            return box.x + box.width < 1.5 && box.y > 1
        }).map((mark) => Boolean(mark.get('dash')))
        expect(back('signal')).toEqual([])
        expect(back('query')).toEqual([true, false])
        expect(back('update')).toEqual([false, false])
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

describe('steps', () => {
    const NAMES = ['batching', 'SQPOLL', 'register', 'I/O polling']
    type Strip = ReturnType<typeof steps>
    // Four boxes of 235 in a row of 1000, with 20 between them.
    const sized = { width: 1000, gap: 20, height: 60, size: 30 }
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)
    const paint = (color: string) => rect(1, 1, { fill: color, stroke: null }).get('fill')
    const edges = (node: Node) => { const box = node.bounds(); return [box.x, box.y, box.x + box.width, box.y + box.height] }
    const middle = (node: Node) => { const box = node.bounds(); return [box.x + box.width / 2, box.y + box.height / 2] as const }
    const sourceOf = (node: Node | null) => (node as unknown as { source: string } | null)?.source
    /** The colors of each step: the border of its box, its label, and its note. */
    const looks = (strip: Strip) => strip.boxes.map((box, index) => [box.get('stroke'), strip.labels[index]!.chars[0]!.get('fill'), strip.notes[index]?.chars[0]!.get('fill')])
    /** The text of a step that is ahead: faint with 0.4 of dim in it. */
    const aheadText = () => mixColor(parseColor('faint'), parseColor('dim'), 0.4)
    const look = (state: 'current' | 'done' | 'ahead', color = 'ink', noted = false) => {
        if (state === 'ahead') return [paint('grid'), aheadText(), noted ? aheadText() : undefined]
        const [stroke, words] = state === 'current' ? [color, 'ink'] : ['gridStrong', 'dim']
        return [paint(stroke), paint(words), noted ? paint(words) : undefined]
    }

    it('puts one box per step in a row of its width, with one width and one gap, and each label in the middle of its box', async () => {
        await compileFilm(film(() => {
            const strip = steps(NAMES, { ...sized, numbered: true, current: 1 }).at(100, 50)
            // `.at()` places the middle of the row of boxes. The row is 1000 wide: from -400 to 600.
            expect(strip.boxes.map(edges)).toEqual([[-400, 20, -165, 80], [-145, 20, 90, 80], [110, 20, 345, 80], [365, 20, 600, 80]])
            expect(strip.labels.map(sourceOf)).toEqual(['1 batching', '2 SQPOLL', '3 register', '4 I/O polling'])
            strip.labels.forEach((label, index) => {
                const [x, y] = middle(label), [boxX, boxY] = middle(strip.boxes[index]!)
                expect(Math.abs(x - boxX)).toBeLessThan(2)
                // A word with a tail, such as "polling", has its middle a little under the middle of its capital letters.
                expect(Math.abs(y - boxY)).toBeLessThan(6)
                expect(label.data['size']).toBe(30)
            })
            // One node per step holds its box and its label, and the object holds these nodes in order.
            expect(strip.items.map((item) => item.children)).toEqual(strip.boxes.map((box, index) => [box, strip.labels[index]]))
            expect(strip.children).toEqual(strip.items)
            expect(strip.notes).toEqual([null, null, null, null])
            // Without `numbered`, a label is the name of its step.
            expect(steps(NAMES, sized).labels.map(sourceOf)).toEqual(NAMES)
            // The defaults: a row of 1600, a text size of 28, a box of 62, and 17 between two boxes.
            const plain = steps(['a', 'b'])
            expect(plain.boxes.map(edges)).toEqual([[-800, -31, -8.5, 31], [8.5, -31, 800, 31]])
            expect(plain.labels[0]!.data['size']).toBe(28)
            // One step takes the whole width.
            expect(edges(steps(['alone'], sized).boxes[0]!)).toEqual([-500, -30, 500, 30])
        }))
    })

    it('puts the note of a step under its box, and gives the points of the edges of a box for a line to a picture', async () => {
        await compileFilm(film(() => {
            const strip = steps([{ label: 'a', note: 'price: none' }, 'b', { label: 'c', note: 'price: a CPU' }, { label: 'd', note: ' ' }], { ...sized, current: 0 })
            expect(strip.notes.map(sourceOf)).toEqual(['price: none', undefined, 'price: a CPU', undefined])
            expect(strip.notes[1]).toBeNull()
            expect(strip.items.map((item) => item.children.length)).toEqual([3, 2, 3, 2])
            for (const index of [0, 2]) {
                const note = strip.notes[index]!.bounds(), box = strip.boxes[index]!.bounds()
                // Under the box, with room, in the middle, and smaller than the label: 0.9 of the size.
                expect(note.y).toBeGreaterThan(box.y + box.height + 8)
                expect(note.y).toBeLessThan(box.y + box.height + 20)
                expect(Math.abs(note.x + note.width / 2 - (box.x + box.width / 2))).toBeLessThan(2)
                expect(strip.notes[index]!.data['size']).toBe(27)
                // The bottom point of a step with a note is under its note, so a line from it does not touch the note.
                const [x, y] = strip.p(index)
                expect(x).toBe(box.x + box.width / 2)
                expect(y).toBeGreaterThan(note.y + note.height + 8)
                expect(y).toBeLessThan(note.y + note.height + 10)
            }
            // The points are in the coordinates of the object: the middle of an edge of the box.
            expect(strip.p(1)).toEqual([-127.5, 30])
            expect(strip.p(1, 'bottom')).toEqual([-127.5, 30])
            expect(strip.p(1, 'top')).toEqual([-127.5, -30])
            expect(strip.p(0, 'top')).toEqual([-382.5, -30])
            expect(strip.p(1, 'left')).toEqual([-245, 0])
            expect(strip.p(1, 'right')).toEqual([-10, 0])
            // They do not move with the object: `toWorld` gives the place on the stage.
            const moved = steps(NAMES, sized).at(100, 50)
            expect(moved.p(1)).toEqual([-127.5, 30])
            expect(moved.toWorld(...moved.p(1))).toEqual([-27.5, 80])
            expect(steps(NAMES, { ...sized, noteSize: 20 }).notes).toEqual([null, null, null, null])
            expect(steps([{ label: 'a', note: 'b' }], { ...sized, noteSize: 20 }).notes[0]!.data['size']).toBe(20)
        }))
    })

    it('gives a bottom point with clear room under the tails of a note, 0.3 of the note size, in the default font and in the serif text font', async () => {
        await compileFilm(film(() => {
            for (const font of [undefined, 'text-serif'] as const) {
                for (const size of [28, 40]) {
                    const strip = steps([{ label: 'register', note: 'gjpqy tails' }, { label: 'b', note: 'two\nlines gjpqy' }, 'c'], { width: 900, size, font })
                    const noteSize = Math.round(size * 0.9)
                    for (const index of [0, 1]) {
                        const note = strip.notes[index]!.bounds()
                        const under = strip.p(index)[1] - (note.y + note.height)
                        expect(under).toBeGreaterThanOrEqual(noteSize * 0.3 - 1e-6)
                        expect(under).toBeLessThan(noteSize * 0.3 + 1)
                    }
                    // A step with no note has its bottom point on its box.
                    expect(strip.p(2)[1]).toBe(Math.round(size * 2.2) / 2)
                }
            }
        }))
    })

    it('gives a note one line or two, each line in the middle under the box, and gives a column the room of its longest note', async () => {
        await compileFilm(film(() => {
            const strip = steps([{ label: 'a', note: 'first line\nsecond' }, { label: 'b', note: 'one' }], { ...sized, width: 600, current: 0 })
            expect(strip.notes.map(sourceOf)).toEqual(['first line\nsecond', 'one'])
            const [two, one] = strip.notes.map((note) => note!.bounds())
            // The two notes start at one height under their boxes. The second line is one line of 1.25 of the note size lower.
            expect(two!.y).toBeLessThan(one!.y + 8)
            expect(two!.y).toBeGreaterThan(30 + 8)
            const [upper, lower] = [strip.notes[0]!.chars[0]!.bounds(), strip.notes[0]!.chars[9]!.bounds()]
            expect(lower.y - upper.y).toBeGreaterThan(27)
            expect(two!.height).toBeGreaterThan(one!.height + 27)
            // Each line is in the middle under its box: the first line has 9 letters, and the shorter second line starts further right.
            const span = (glyphs: Node[]) => { const boxes = glyphs.map((glyph) => glyph.bounds()); return [Math.min(...boxes.map((box) => box.x)), Math.max(...boxes.map((box) => box.x + box.width))] as const }
            const lines = [span(strip.notes[0]!.chars.slice(0, 9)), span(strip.notes[0]!.chars.slice(9))]
            for (const [from, to] of lines) expect(Math.abs((from + to) / 2 - middle(strip.boxes[0]!)[0])).toBeLessThan(2)
            expect(lines[1]![0]).toBeGreaterThan(lines[0]![0] + 3)
            // The bottom point of each step is under its own note.
            expect(strip.p(0)[1] - strip.p(1)[1]).toBeCloseTo(1.25 * 27, 6)
            // A space around a line does not count, and a third line is an error.
            expect(sourceOf(steps([{ label: 'a', note: ' first \n second ' }], sized).notes[0]!)).toBe('first\nsecond')
            expect(() => steps(['a', { label: 'b', note: 'x\ny\nz' }])).toThrow(/steps: the note of step 1 has 3 lines\. A note has two lines at the most/)
            // In a column, the lines start at one x, and every box is the room of the longest note further from the next.
            const list = steps([{ label: 'a', note: 'first line\nfinal' }, { label: 'b', note: 'one' }, 'c'], { direction: 'column', width: 300, gap: 20, height: 60, size: 30 })
            const boxes = list.boxes.map(edges), notes = list.notes.map((note) => note && edges(note))
            // Both lines start with the same letter, so they start at the same pixel.
            expect(list.notes[0]!.chars[9]!.bounds().x).toBeCloseTo(list.notes[0]!.chars[0]!.bounds().x, 6)
            expect(list.notes[0]!.chars[9]!.bounds().y).toBeGreaterThan(list.notes[0]!.chars[0]!.bounds().y + 27)
            expect(boxes[1]![1]! - boxes[0]![3]!).toBeCloseTo(boxes[2]![1]! - boxes[1]![3]!, 6)
            // The room of the longest note ends at its bottom point, 0.3 of the note size or more under its letters. The next box is the gap under it.
            expect(boxes[1]![1]! - list.p(0, 'bottom')[1]).toBeCloseTo(20, 6)
            expect(list.p(0, 'bottom')[1] - notes[0]![3]!).toBeGreaterThanOrEqual(27 * 0.3 - 1e-6)
            expect(list.p(1, 'bottom')[1]).toBeLessThan(list.p(1, 'top')[1] + 60 + 27 * 2)
        }))
    })

    it('lights the current step, keeps the steps before it in dim, and gives the steps after it a weaker text that is still readable', async () => {
        await compileFilm(film(() => {
            const strip = steps(NAMES, { ...sized, current: 1 })
            expect(looks(strip)).toEqual([look('done'), look('current'), look('ahead'), look('ahead')])
            expect(NAMES.map((_, index) => strip.stateOf(index))).toEqual(['done', 'current', 'ahead', 'ahead'])
            expect(strip.current).toBe(1)
            // The border of the lit box is wider than the others.
            const weights = strip.boxes.map((box) => box.get('strokeWidth'))
            expect(weights[1]).toBeGreaterThan(weights[0]! + 0.5)
            expect([weights[2], weights[3]]).toEqual([weights[0], weights[0]])
            // Every box has the fill of a surface, so the border and the text say the state.
            expect(strip.boxes.map((box) => box.get('fill'))).toEqual(NAMES.map(() => paint('surface')))
            // `color` is the border of the lit step. Its label stays in ink.
            expect(looks(steps(NAMES, { ...sized, current: 3, color: 'orange' }))).toEqual([look('done'), look('done'), look('done'), look('current', 'orange')])
            expect(looks(steps(NAMES, { ...sized, current: 0 }))).toEqual([look('current'), look('ahead'), look('ahead'), look('ahead')])
            // With no lit step, which is the default, every step is readable.
            for (const none of [steps(NAMES, sized), steps(NAMES, { ...sized, current: null })]) {
                expect(none.current).toBeNull()
                expect(looks(none)).toEqual(NAMES.map(() => look('done')))
                expect(none.stateOf(3)).toBe('done')
            }
            // A note has the state of its step: in ink under the lit step, in dim under a done one, and as weak as its label under a step ahead.
            const noted = steps(NAMES.map((label) => ({ label, note: 'a note' })), { ...sized, current: 1 })
            expect(looks(noted).map((one) => one[2])).toEqual([paint('dim'), paint('ink'), aheadText(), aheadText()])
            expect(looks(noted)).toEqual([look('done', 'ink', true), look('current', 'ink', true), look('ahead', 'ink', true), look('ahead', 'ink', true)])
        }))
    })

    it('keeps the text of a step ahead at a contrast of 3 or more on its box in the dark look and in the light one, with a done step clearly stronger', async () => {
        const channel = (value: number) => { const x = value / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
        const light = (color: Rgba) => 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2])
        const contrast = (a: Rgba, b: Rgba) => { const [high, low] = [light(a), light(b)].sort((x, y) => y - x); return (high! + 0.05) / (low! + 0.05) }
        const seen: Record<string, number[]> = {}
        for (const name of ['midnight', 'paper'] as const) {
            await compileFilm(film({ look: name }, () => {
                const strip = steps(['a', 'b', 'c'].map((label) => ({ label, note: 'a note' })), { ...sized, current: 1 })
                const fill = (node: Node) => node.get('fill') as Rgba
                const surface = fill(strip.boxes[0]!), ground = parseColor('bg')
                // The label of the step ahead and of the done step on their boxes, and the note of the step ahead on the background.
                seen[name] = [contrast(fill(strip.labels[2]!.chars[0]!), surface), contrast(fill(strip.labels[0]!.chars[0]!), surface), contrast(fill(strip.notes[2]!.chars[0]!), ground)]
            }))
        }
        expect(seen['midnight']).toEqual([expect.closeTo(4.23, 2), expect.closeTo(7.45, 2), expect.closeTo(4.62, 2)])
        expect(seen['paper']).toEqual([expect.closeTo(3.21, 2), expect.closeTo(5.68, 2), expect.closeTo(3.51, 2)])
        for (const [ahead, done, note] of Object.values(seen)) {
            expect(ahead).toBeGreaterThanOrEqual(3)
            expect(note).toBeGreaterThanOrEqual(3)
            expect(done! / ahead!).toBeGreaterThan(1.5)
        }
    })

    it('moves the light with go, and the states of the other steps follow, one move after another in a sequence', async () => {
        let strip!: Strip, copy!: Strip, still!: Strip, plain!: Strip
        const seen: (number | null)[] = []
        await compileFilm(film({ fps: 20 }, (s) => {
            strip = s.add(steps(NAMES.map((label) => ({ label, note: 'a note' })), { ...sized, current: 0 }))
            copy = s.add(strip.clone().at(0, 200))
            still = s.add(steps(NAMES, { ...sized, current: 2 }).at(0, 400))
            // A strip with no note, and one with a note on one step only.
            plain = s.add(steps(['a', { label: 'b', note: 'a note' }, 'c', 'd'], { ...sized, current: 0 }).at(0, -200))
            s.wait(1)
            // The check of the index is at the call. The light moves when the animation is scheduled.
            const moves = seq(strip.go(1), strip.go(3))
            seen.push(strip.current)
            s.play(moves, still.go(2), plain.go(2), { duration: 2, ease: linear })
            seen.push(strip.current)
            s.wait(1)
            s.play(strip.go(null), copy.go(2), { duration: 1, ease: linear })
            seen.push(strip.current, copy.current)
            s.wait(0.5)
        }))
        expect(seen).toEqual([0, 3, null, 2])
        const at1 = (state: 'current' | 'done' | 'ahead') => look(state, 'ink', true)
        expect(at(0.9, () => looks(strip))).toEqual([at1('current'), at1('ahead'), at1('ahead'), at1('ahead')])
        // The first move takes the first second, and the second move starts from its end.
        expect(at(2, () => looks(strip))).toEqual([at1('done'), at1('current'), at1('ahead'), at1('ahead')])
        expect(at(3, () => looks(strip))).toEqual([at1('done'), at1('done'), at1('done'), at1('current')])
        // The wide border goes with the light. Half way, a border is between its two weights.
        const weight = (time: number, index: number) => at(time, () => strip.boxes[index]!.get('strokeWidth'))
        const [lit, rest] = [weight(0.9, 0), weight(0.9, 1)]
        expect(lit).toBeGreaterThan(rest + 0.5)
        expect(NAMES.map((_, index) => weight(2, index))).toEqual([rest, lit, rest, rest])
        expect(NAMES.map((_, index) => weight(3, index))).toEqual([rest, rest, rest, lit])
        expect(NAMES.map((_, index) => weight(5.4, index))).toEqual([rest, rest, rest, rest])
        expect([weight(1.5, 0), weight(1.5, 1)]).toEqual([expect.closeTo((lit + rest) / 2, 6), expect.closeTo((lit + rest) / 2, 6)])
        expect(at(1.5, () => looks(strip).slice(2))).toEqual([at1('ahead'), at1('ahead')])
        expect(at(1.5, () => looks(strip)[0])).not.toEqual(at1('current'))
        expect(at(1.5, () => looks(strip)[0])).not.toEqual(at1('done'))
        // With null the light goes off, and every step is readable.
        expect(at(5.4, () => looks(strip))).toEqual(NAMES.map(() => at1('done')))
        // A copy has its own boxes and its own light: it keeps the first step lit until its own move.
        expect(at(3.9, () => looks(copy))).toEqual([at1('current'), at1('ahead'), at1('ahead'), at1('ahead')])
        expect(at(5.4, () => looks(copy))).toEqual([at1('done'), at1('done'), at1('current'), at1('ahead')])
        expect(copy.boxes[0]).not.toBe(strip.boxes[0])
        // A move to the lit step changes nothing.
        for (const time of [0.5, 1.5, 2.5, 5.4]) expect(at(time, () => looks(still))).toEqual([look('done'), look('done'), look('current'), look('ahead')])
        // The steps of a strip change with a note or with none: the first, the third and the last have no note here.
        expect(at(0.9, () => looks(plain))).toEqual([look('current'), at1('ahead'), look('ahead'), look('ahead')])
        expect(at(3, () => looks(plain))).toEqual([look('done'), at1('done'), look('current'), look('ahead')])
        // A move takes 0.4 s, and an entrance 1.2 s, when the film gives no duration.
        expect([plain.go(1).duration, plain.enter().duration, plain.go(1, { duration: 2 }).duration]).toEqual([0.4, 1.2, 2])
    })

    it('brings a strip that is not on the stage with go, in the state before the move, and draws nothing of it before its turn', async () => {
        let strip!: Strip
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            strip = steps(NAMES, { ...sized, current: 0 })
            s.wait(1)
            s.play(strip.go(2), { duration: 1, ease: linear })
            s.wait(0.5)
        }))
        expect(compiled.frame(0.5).ops).toHaveLength(0)
        // Four boxes, and the 32 letters of the four names.
        expect(compiled.frame(1).ops).toHaveLength(4 + 32)
        expect(at(1, () => looks(strip))).toEqual([look('current'), look('ahead'), look('ahead'), look('ahead')])
        expect(at(2, () => looks(strip))).toEqual([look('done'), look('done'), look('current'), look('ahead')])
        const turn = await compile((s) => {
            s.wait(1)
            s.play(seq(fadeIn(rect(10, 10).at(-900, -500), { duration: 1 }), { ...steps(['a', 'b'], { ...sized, current: 0 }).go(1), duration: 1 }))
            s.wait(0.5)
        })
        // In the first second, the rectangle is the one mark that the film draws. Then: two boxes and two letters more.
        for (const time of [1.3, 1.99]) expect(turn.frame(time).ops).toHaveLength(1)
        expect(turn.frame(2.5).ops).toHaveLength(5)
    })

    it('makes all labels smaller when one is too wide for its box, down to 0.7 of the size, and then refuses with the width that is enough', async () => {
        await compileFilm(film(() => {
            const names = ['a label that is too long for its box', 'b']
            // The long label is 460 px wide at size 30. A box has 22.5 px at each side of its label.
            expect(steps(names, { ...sized, width: 1100 }).labels.map((label) => label.data['size'])).toEqual([30, 30])
            const smaller = steps(names, { ...sized, width: 1000 })
            const [size, other] = smaller.labels.map((label) => label.data['size'] as number)
            expect(size).toBeCloseTo(30 * (490 - 45) / 459.9609375, 6)
            expect(other).toBe(size)
            const [left, , right] = edges(smaller.labels[0]!), [boxLeft, , boxRight] = edges(smaller.boxes[0]!)
            expect(left).toBeGreaterThan(boxLeft + 22)
            expect(right).toBeLessThan(boxRight - 22)
            // 754 gives a box of 367, where the label is in at 0.7 of the size. One pixel less is too narrow.
            expect(steps(names, { ...sized, width: 754 }).labels[0]!.data['size']).toBeCloseTo(21, 1)
            expect(() => steps(names, { ...sized, width: 753 })).toThrow(/the label "a label that is too long for its box" is 460 px wide at size 30, and a box is 366 px wide, with 321 px for its label\. A label can be 0\.7 of the size at the least\. Use a shorter label, or a width of 754 or more, or fewer steps/)
            // A note has the width of its box less 15 px, so the notes of two steps that are neighbors do not read as one.
            const noted = [{ label: 'a', note: 'a note that is too long for its box' }, { label: 'b', note: 'short' }]
            const notes = steps(noted, { ...sized, width: 700 })
            expect(new Set(notes.notes.map((note) => note!.data['size'])).size).toBe(1)
            expect(notes.notes[0]!.data['size']).toBeLessThan(27)
            expect(edges(notes.notes[0]!)[0]).toBeGreaterThan(edges(notes.boxes[0]!)[0]! + 6)
            expect(edges(notes.notes[0]!)[2]).toBeLessThan(edges(notes.boxes[0]!)[2]! - 6)
            expect(steps(noted, { ...sized, width: 624 }).notes[0]!.data['size']).toBeCloseTo(27 * 0.7, 1)
            expect(() => steps(noted, { ...sized, width: 623 })).toThrow(/the note "a note that is too long for its box" is 410 px wide at size 27, and a box is 301 px wide, with 286 px for its note\. A note can be 0\.7 of the size at the least\. Use a shorter note, or a width of 624 or more, or fewer steps/)
            // The longer line of a note of two lines is the one that counts.
            expect(steps([{ label: 'a', note: 'short\na note that is too long for its box' }, 'b'], { ...sized, width: 624 }).notes[0]!.data['size']).toBeCloseTo(27 * 0.7, 1)
            // In a column, the width is the width of a box, and the message says so.
            expect(() => steps(names, { direction: 'column', width: 366, size: 30 })).toThrow(/a box is 366 px wide, with 321 px for its label\. A label can be 0\.7 of the size at the least\. Use a shorter label, or a width of 367 or more$/)
            expect(() => steps(names, { direction: 'column', width: 367, size: 30 })).not.toThrow()
            // A note of a column starts where the labels start, 22.5 px inside the box, and ends inside the box.
            const list = steps(noted, { direction: 'column', width: 310, size: 30 })
            expect(list.notes[0]!.data['size']).toBeCloseTo(27 * 0.7, 1)
            expect(edges(list.notes[0]!)[2]).toBeLessThanOrEqual(edges(list.boxes[0]!)[2]!)
            expect(() => steps(noted, { direction: 'column', width: 309, size: 30 })).toThrow(/a box is 309 px wide, with 286 px for its note\. A note can be 0\.7 of the size at the least\. Use a shorter note, or a width of 310 or more$/)
        }))
    })

    it('puts the steps one under the other in a column, with the numbers in a column of their own and each note under its box', async () => {
        await compileFilm(film(() => {
            const list = steps([{ label: 'plan', note: 'a week' }, 'build', 'measure'], { direction: 'column', width: 300, gap: 20, height: 60, size: 30, numbered: true, current: 1 }).at(100, 50)
            // The width is the width of each box. A note is between its box and the next one, so the boxes are 20 and the room of a note apart.
            const boxes = list.boxes.map(edges)
            expect(boxes.map((box) => [box[0], box[2]])).toEqual([[-50, 250], [-50, 250], [-50, 250]])
            expect(boxes.map((box) => box[3]! - box[1]!)).toEqual([expect.closeTo(60, 6), 60, expect.closeTo(60, 6)])
            expect(boxes[1]![1]! - boxes[0]![3]!).toBeCloseTo(boxes[2]![1]! - boxes[1]![3]!, 6)
            expect(boxes[1]![1]! - boxes[0]![3]!).toBeGreaterThan(20 + 27)
            // `.at()` places the middle of the column of boxes.
            expect([(boxes[0]![1]! + boxes[2]![3]!) / 2, boxes[1]![1]]).toEqual([expect.closeTo(50, 6), 20])
            // The labels are at the left of their boxes, 22.5 px inside, and at the height of the middle of their boxes.
            const starts = list.labels.map((label) => label.bounds().x)
            expect(Math.min(...starts)).toBeGreaterThan(-50 + 20)
            expect(Math.max(...starts)).toBeLessThan(-50 + 32)
            list.labels.forEach((label, index) => expect(Math.abs(middle(label)[1] - middle(list.boxes[index]!)[1])).toBeLessThan(6))
            // The note starts where the labels start, under its box and over the next one.
            const note = list.notes[0]!.bounds()
            expect(Math.abs(note.x - (-50 + 22.5))).toBeLessThan(3)
            expect(note.y).toBeGreaterThan(boxes[0]![3]! + 8)
            expect(note.y + note.height).toBeLessThan(boxes[1]![1]! - 8)
            // Without an edge, the point is at the right side of the box, for a picture at the right of the column.
            expect(list.p(1)).toEqual([150, 0])
            expect(list.p(1, 'bottom')).toEqual([0, 30])
            expect(list.toWorld(...list.p(0, 'bottom'))[1]).toBeGreaterThan(note.y + note.height)
            expect(looks(list).map((one) => one.slice(0, 2))).toEqual([look('done').slice(0, 2), look('current').slice(0, 2), look('ahead').slice(0, 2)])
            // Without notes, the boxes are the gap apart. The default width of a column is 360.
            const plain = steps(['a', 'b'], { direction: 'column', gap: 20, height: 60 })
            expect(plain.boxes.map(edges)).toEqual([[-180, -70, 180, -10], [-180, 10, 180, 70]])
            // Eleven numbered steps: the numbers end at one x and the names start at one x, from "9" to "10" too.
            const many = steps(Array.from({ length: 11 }, (_, index) => `step ${index + 1}`), { direction: 'column', width: 300, numbered: true, size: 30, height: 60, current: 9 })
            const digits = (index: number) => String(index + 1).length
            const names = many.labels.map((label, index) => label.chars[digits(index)]!.bounds().x)
            expect(Math.max(...names) - Math.min(...names)).toBeLessThan(1e-6)
            const ends = many.labels.map((label, index) => { const last = label.chars[digits(index) - 1]!.bounds(); return last.x + last.width })
            // "1" and "11" end with the same digit, so they end at the same pixel. Two other digits differ by the room at their sides.
            expect(ends[10]).toBeCloseTo(ends[0]!, 6)
            expect(Math.max(...ends) - Math.min(...ends)).toBeLessThan(1.5)
            expect(names[0]! - Math.max(...ends)).toBeGreaterThan(6)
            expect(many.labels.map(sourceOf).slice(8)).toEqual(['9 step 9', '10 step 10', '11 step 11'])
            // The room of the widest number counts when the labels must be smaller: the long label of step 1 starts
            // after that room, and still ends 22.5 px inside its box.
            const long = steps(['a label that is too long for its box', ...Array.from({ length: 10 }, () => 'b')], { direction: 'column', width: 440, numbered: true, size: 30, height: 60 })
            expect(long.labels[0]!.data['size']).toBeLessThan(30)
            expect(long.labels[0]!.data['size']).toBeGreaterThan(21)
            expect(new Set(long.labels.map((label) => label.data['size'])).size).toBe(1)
            expect(edges(long.labels[0]!)[2]).toBeLessThanOrEqual(edges(long.boxes[0]!)[2]! - 22.5 + 0.01)
            expect(edges(long.labels[0]!)[2]).toBeGreaterThan(edges(long.boxes[0]!)[2]! - 22.5 - 3)
            // Without numbers, the labels start at one x.
            const bare = steps(['step a', 'step b'], { direction: 'column', width: 300 })
            expect(bare.labels[1]!.bounds().x).toBeCloseTo(bare.labels[0]!.bounds().x, 6)
        }))
    })

    it('enters from the first step to the last, each one with the look of its state, and draws nothing before its turn', async () => {
        let strip!: Strip, usual!: Strip
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            strip = steps(NAMES, { ...sized, current: 1 })
            usual = steps(NAMES, sized).at(0, 200)
            s.wait(1)
            s.play(strip.enter({ lag: 1 }), { duration: 2, ease: linear })
            s.wait(0.5)
            // Without a lag from the film, each step starts when the one before it is half way.
            s.play(usual.enter(), { duration: 2.5, ease: linear })
            s.wait(0.5)
        }))
        expect(compiled.frame(0.5).ops).toHaveLength(0)
        // Four steps with a lag of 1: each one has a quarter of the time, one after the other.
        const state = (time: number) => at(time, () => strip.items.map(shows))
        expect(state(1.25)).toEqual([expect.closeTo(0.5, 6), 0, 0, 0])
        expect(state(2.25)).toEqual([1, 1, expect.closeTo(0.5, 6), 0])
        expect(state(3.2)).toEqual([1, 1, 1, 1])
        expect(at(3.2, () => looks(strip))).toEqual([look('done'), look('current'), look('ahead'), look('ahead')])
        // The entrance without a lag starts at 3.5 s: each step takes 1 s, and starts 0.5 s after the one before it.
        expect(at(4.25, () => usual.items.map(shows))).toEqual([expect.closeTo(0.75, 6), expect.closeTo(0.25, 6), 0, 0])
        expect(at(5.25, () => usual.items.map(shows))).toEqual([1, 1, expect.closeTo(0.75, 6), expect.closeTo(0.25, 6)])
        const turn = await compile((s) => {
            s.wait(1)
            s.play(seq(fadeIn(rect(10, 10).at(-900, -500), { duration: 1 }), { ...steps(['a', 'b'], sized).enter(), duration: 1 }))
            s.wait(0.5)
        })
        // In the first second, the rectangle is the one mark that the film draws. At the end: two boxes and two letters more.
        for (const time of [1.3, 1.99]) expect(turn.frame(time).ops).toHaveLength(1)
        expect(turn.frame(3.4).ops).toHaveLength(5)
        const lefts: number[] = []
        for (const shift of [0, 300]) {
            const moved = await compile((s) => {
                const made = steps(['a', 'b'], sized)
                group(made).at(shift, 0)
                s.play(made.enter(), { duration: 1 })
                s.wait(0.5)
            })
            lefts.push(Math.min(...paths(moved, 1.4).flatMap((op) => pathBounds(op.path)?.x ?? [])))
        }
        // The strip of a group that the film moved is the same picture, 300 to the right.
        expect(lefts[1]! - lefts[0]!).toBeCloseTo(300, 6)
    })

    it('sets its labels and its notes in the font that the film gives', async () => {
        await compileFilm(film(() => {
            const letter = (words: string, size: number, font?: 'text-serif') => text(words, { size, font }).chars[0]!.get('path')
            const serif = steps([{ label: 'batching', note: 'price' }], { ...sized, font: 'text-serif' })
            expect(serif.labels[0]!.chars[0]!.get('path')).toEqual(letter('batching', 30, 'text-serif'))
            expect(serif.notes[0]!.chars[0]!.get('path')).toEqual(letter('price', 27, 'text-serif'))
            // Without a font, the texts have the font of `text()`, as the texts of a card or a zone have.
            const usual = steps([{ label: 'batching', note: 'price' }], sized)
            expect(usual.labels[0]!.chars[0]!.get('path')).toEqual(letter('batching', 30))
            expect(usual.notes[0]!.chars[0]!.get('path')).toEqual(letter('price', 27))
            expect(letter('batching', 30, 'text-serif')).not.toEqual(letter('batching', 30))
        }))
    })

    it('refuses a label of two lines and a height with no room for a label, with the smallest height that works', async () => {
        await compileFilm(film(() => {
            expect(() => steps(['two\nlines', 'b'])).toThrow(/steps: the label of step 0 \("two\\nlines"\) has a line break\. A label is one line\. Give the step a note for a second line/)
            expect(() => steps(['a', { label: 'b\r\nc' }])).toThrow(/the label of step 1 .* has a line break/)
            // A line break at an end of a label is space, and does not count.
            expect(sourceOf(steps(['plan\n']).labels[0]!)).toBe('plan')
            // The box holds the highest and the lowest letters of the font, with the wide border of the lit step.
            expect(() => steps(NAMES, { ...sized, height: 43 })).toThrow(/steps: a height of 43 has no room for a label of size 30: a letter with a tail would touch the border\. Give a height of 44 or more/)
            expect(() => steps(NAMES, { ...sized, height: 45, font: 'text-serif' })).toThrow(/Give a height of 46 or more/)
            expect(() => steps(NAMES, { height: 20 })).toThrow(/a height of 20 has no room for a label of size 28.*Give a height of 41 or more/)
            expect(() => steps(NAMES, { height: 0 })).toThrow(/a height of 0 has no room for a label/)
            expect(() => steps(NAMES, { height: Number.NaN })).toThrow(/a height of NaN has no room for a label/)
            for (const [font, height] of [[undefined, 44], ['text-serif', 46]] as const) {
                const tight = steps(['Typing', 'gjpqy (Á)'], { width: 600, size: 30, height, font, current: 1 })
                tight.labels.forEach((label, index) => {
                    const [, top, , bottom] = edges(label), [, boxTop, , boxBottom] = edges(tight.boxes[index]!)
                    // The letters are inside the border of the lit box, which is 3.3 px wide.
                    expect(top).toBeGreaterThan(boxTop! + 1.65)
                    expect(bottom).toBeLessThan(boxBottom! - 1.65)
                })
            }
        }))
    })

    it('refuses a list with no step, a step with no label, a width with no room for a label, a color that is none, and a step that the strip does not have', async () => {
        await compileFilm(film(() => {
            expect(() => steps([])).toThrow(/give it at least one step/)
            expect(() => steps(['a', { label: ' ' }])).toThrow(/step 1 has no label/)
            expect(() => steps(NAMES, { direction: 'stack' as never })).toThrow(/direction is 'row' or 'column', not "stack"/)
            expect(() => steps(NAMES, { size: 0 })).toThrow(/size is the text size of the labels/)
            expect(() => steps(NAMES, { noteSize: -1 })).toThrow(/noteSize is the text size of the notes/)
            expect(() => steps(NAMES, { gap: -1 })).toThrow(/gap is the room between two boxes/)
            // Three boxes in 100 px, with 17 between them, are 22 px wide. A label needs more than 21 px at each side.
            expect(() => steps(['a', 'b', 'c'], { width: 100 })).toThrow(/a width of 100 gives each of the 3 boxes 22 px, with no room for a label\. Give a width of more than 160, a smaller gap, or fewer steps/)
            expect(() => steps(['a', 'b', 'c'], { direction: 'column', width: 30, size: 30 })).toThrow(/a width of 30 gives the boxes 30 px, with no room for a label\. Give a width of more than 45$/)
            // A color that is none is an error when the strip is made, with a lit step or with none.
            expect(() => steps(NAMES, { color: 'nope' })).toThrow(/steps: color is "nope", which is not a color\. Use a color of the look, such as 'orange', or a CSS color/)
            expect(() => steps(NAMES, { color: 'nope', current: 0 })).toThrow(/steps: color is "nope", which is not a color/)
            expect(() => steps(NAMES, { color: '#ff8800', current: 0 })).not.toThrow()
            const known = 'The steps are 0 \\("a"\\), 1 \\("b"\\), 2 \\("c"\\)'
            expect(() => steps(['a', 'b', 'c'], { current: 3 })).toThrow(new RegExp(`no step 3\\. ${known}\\. Use null for no lit step`))
            expect(() => steps(['a', 'b', 'c'], { current: -1 })).toThrow(/no step -1/)
            expect(() => steps(['a', 'b', 'c'], { current: Number.NaN })).toThrow(/NaN is not a number/)
            const strip = steps(['a', 'b', 'c'], { numbered: true })
            // A wrong index is an error where the film writes the move, before anything plays.
            expect(() => strip.go(3)).toThrow(/no step 3\. The steps are 0 \("1 a"\), 1 \("2 b"\), 2 \("3 c"\)/)
            expect(() => strip.go(1.5)).toThrow(/no step 1\.5/)
            expect(() => strip.go(Infinity)).toThrow(/no step Infinity/)
            // An index that is not a number says so, and does not print "null".
            expect(() => strip.go(Number.NaN)).toThrow(/steps: the index of a step is a whole number, and NaN is not a number\. The steps are 0 \("1 a"\), 1 \("2 b"\), 2 \("3 c"\)\. Use null for no lit step/)
            expect(() => strip.go(undefined as never)).toThrow(/undefined is not a number/)
            expect(() => strip.go('1' as never)).toThrow(/"1" is not a number/)
            expect(() => strip.p(3)).toThrow(/no step 3/)
            expect(() => strip.p(Number.NaN)).toThrow(/NaN is not a number/)
            expect(() => strip.stateOf(-1)).toThrow(/no step -1/)
            expect(() => strip.p(0, 'middle' as never)).toThrow(/edge is 'top', 'bottom', 'left' or 'right', not "middle"/)
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

describe('quote', () => {
    const WORDS = 'the agent loop lives in Temporal rather than on the VM itself'
    type Quote = ReturnType<typeof quote>
    const shows = (node: Node) => (node.get('visible') ? node.get('opacity') : 0)
    const paint = (color: string) => rect(1, 1, { fill: color, stroke: null }).get('fill')
    const right = (node: Node) => { const box = node.bounds(); return box.x + box.width }
    const bottom = (node: Node) => { const box = node.bounds(); return box.y + box.height }
    const keys = (glyphs: readonly Node[]) => glyphs.map((glyph) => glyph.data['key']).join('')
    /** The letters of the words that have a color, in order. */
    const colored = (made: Quote, color: string) => keys(made.words.chars.filter((glyph) => JSON.stringify(glyph.get('fill')) === JSON.stringify(paint(color))))

    it('starts at the place it is given: the rule from the top to the bottom, the words after the rule, and the source line under the words', async () => {
        await compileFilm(film(() => {
            const said = quote(WORDS, { by: 'Cursor', when: '2026-06-02', where: 'a post', width: 600, size: 40 }).at(100, 50)
            const rule = said.rule.bounds(), words = said.words.bounds(), source = said.source!.bounds()
            // `.at()` places the top end of the rule. Nothing of the object is over the rule, under it, or at its left.
            expect([rule.x, rule.y, rule.width]).toEqual([100, 50, 6])
            const all = said.bounds()
            expect([all.x, all.y]).toEqual([100, 50])
            expect(all.y + all.height).toBeCloseTo(bottom(said.rule), 6)
            expect(said.height).toBeCloseTo(rule.height, 6)
            // The words and the source line start at one x, after the rule and the room at its right.
            expect(words.x).toBeGreaterThan(rule.x + rule.width + 20)
            expect(Math.abs(words.x - source.x)).toBeLessThan(4)
            expect(source.y).toBeGreaterThan(words.y + words.height + 12)
            // The words are between their quotation marks, and the first line stands on `baseline`.
            expect(said.words.source).toBe(`“${WORDS}”`)
            expect(said.baseline).toBeCloseTo(30, 0)
            expect(bottom(said.find('T')[0]!)).toBeCloseTo(50 + said.baseline, 0)
            // The speaker, the date, and the place, in that order. Each one is optional.
            expect(said.source!.source).toBe('Cursor, 2026-06-02, a post')
            expect(quote(WORDS, { where: 'a post', by: 'Cursor' }).source!.source).toBe('Cursor, a post')
            expect(quote(WORDS, { when: '2026', by: ' ' }).source!.source).toBe('2026')
            // The source line is smaller than the words, and not under 24 unless the words are.
            expect([40, 24, 18].map((size) => quote(WORDS, { by: 'Cursor', size }).source!.data['size'])).toEqual([31, 24, 18])
            expect(quote(WORDS, { by: 'Cursor', sourceSize: 36 }).source!.data['size']).toBe(36)
            // The source line is in the font of the words: the serif text font, or the font that the film gives.
            const letter = (font: 'sans' | 'text-serif') => text('C', { font, size: 25 }).chars[0]!.get('path')
            expect(quote(WORDS, { by: 'Cursor' }).source!.chars[0]!.get('path')).toEqual(letter('text-serif'))
            expect(quote(WORDS, { by: 'Cursor', font: 'sans' }).source!.chars[0]!.get('path')).toEqual(letter('sans'))
            expect(letter('sans')).not.toEqual(letter('text-serif'))
            // Space around the words does not count.
            expect(quote('  yes \n').words.source).toBe('\u201cyes\u201d')
            // With none of them, the object has no source line, and the rule ends under the words.
            const bare = quote(WORDS, { width: 600, size: 40 }).at(100, 50)
            expect(bare.source).toBeNull()
            expect(bare.children).toEqual([bare.rule, bare.words])
            expect(bottom(bare.rule)).toBeGreaterThan(bottom(bare.words) - 0.01)
            expect(bottom(bare.rule)).toBeLessThan(bottom(bare.words) + 12)
            expect(bottom(said.rule) - bottom(bare.rule)).toBeGreaterThan(40)
            // A quote with more words starts at the same corner, and its first line is on the same line.
            const long = quote(`${WORDS}, and ${WORDS}`, { width: 600, size: 40 }).at(100, 50)
            expect([long.rule.bounds().x, long.rule.bounds().y]).toEqual([100, 50])
            expect(long.words.chars[0]!.bounds()).toEqual(bare.words.chars[0]!.bounds())
            expect(long.height).toBeGreaterThan(bare.height + 100)
            // The two places that a film needs. Beside a picture with its middle at y 200: the middle of the quote at that y.
            const beside = quote(WORDS, { by: 'Cursor', width: 600, size: 40 })
            beside.at(40, 200 - beside.height / 2)
            expect([beside.left[0], beside.center[1]]).toEqual([40, expect.closeTo(200, 6)])
            // Centered on a point: `moveTo` puts the middle of the rule and the words there.
            const centered = quote(WORDS, { by: 'Cursor', width: 600, size: 40 }).moveTo([300, 200])
            expect(centered.center).toEqual([expect.closeTo(300, 6), expect.closeTo(200, 6)])
            expect(centered.rule.bounds().x).toBeCloseTo(300 - centered.width / 2, 6)
            // `lineEnd` is the x of the end of the ink of a line, in the coordinates of the object.
            const broken = quote('first\nfinal line', { size: 40 }).at(100, 50)
            expect(broken.lineEnd()).toBeCloseTo(right(broken.find('first')[4]!) - 100, 6)
            expect(broken.lineEnd(1)).toBeCloseTo(right(broken.words.chars.at(-1)!) - 100, 6)
            expect(broken.lineEnd(1)).toBeGreaterThan(broken.lineEnd(0) + 40)
            expect(() => broken.lineEnd(2)).toThrow(/quote: no line 2\. The words have 2 lines/)
        }))
    })

    it('wraps the words at its width, keeps a break that the film wrote, and is as high as its lines', async () => {
        await compileFilm(film(() => {
            // One line, two lines, and four lines. A line is 1.3 of the size: 52 px.
            const widths = [1400, 600, 380]
            const made = widths.map((width) => quote(WORDS, { width, size: 40 }))
            made.forEach((one, index) => expect(right(one.words)).toBeLessThanOrEqual(widths[index]!))
            // A line has the room of its ink, and an italic f leans over the place after it. So no letter passes the width, at any width.
            for (let width = 240; width <= 440; width++) expect(right(quote('half of the staff left off the shelf', { width, size: 40 }))).toBeLessThanOrEqual(width)
            // At 303, the advance of "staff" has room on the first line, and its last letter has not: the word goes to the next line.
            const starts = (width: number) => { const one = quote('half of the staff left off', { width, size: 40 }); return one.find('staff')[0]!.bounds().y - one.find('half')[1]!.bounds().y }
            expect(starts(303)).toBeGreaterThan(40)
            expect(starts(304)).toBeLessThan(5)
            expect(made[1]!.height - made[0]!.height).toBeCloseTo(52, 6)
            expect(made[2]!.height - made[0]!.height).toBeCloseTo(52 * 3, 6)
            // The words have the width less the 30 px of the rule and the room after it: one pixel less, and the line breaks.
            const need = Math.ceil(text(`\u201c${WORDS}\u201d`, { font: 'text-serif', size: 40, italic: true }).get('px') * 2)
            expect(quote(WORDS, { width: need + 30, size: 40 }).height).toBeCloseTo(made[0]!.height, 6)
            expect(quote(WORDS, { width: need + 29, size: 40 }).height - made[0]!.height).toBeCloseTo(52, 6)
            // The default width is 900, and the default size is 32, where the rule and the room after it take 23 px.
            expect(() => quote('a'.repeat(200))).toThrow(/at size 32, and a width of 900 leaves 877 px for the words/)
            // `leading` sets the height of a line.
            expect(quote(WORDS, { width: 600, size: 40, leading: 2 }).height - made[0]!.height).toBeCloseTo(80, 6)
            // A break in the words starts a line, at any width. The second line starts at the left edge of the words.
            const broken = quote('first\nfinal', { width: 1400, size: 40 })
            expect(broken.height - made[0]!.height).toBeCloseTo(52, 6)
            const [first, final] = [broken.find('first')[0]!.bounds(), broken.find('final')[0]!.bounds()]
            expect(final.y - first.y).toBeCloseTo(52, 6)
            expect(final.x).toBeLessThan(first.x)
            // A source line that is wider than the object wraps too, and the rule goes down with it.
            const cited = quote('yes', { by: 'a speaker with a name of many words', where: 'a document with a title of many words', width: 380, size: 40 })
            expect(right(cited.source!)).toBeLessThanOrEqual(381)
            expect(cited.source!.bounds().height).toBeGreaterThan(60)
            expect(bottom(cited.rule)).toBeGreaterThan(bottom(cited.source!) - 0.01)
        }))
    })

    it('keeps a part that cannot break inside its width, or refuses it: words that no-break spaces join, and a web address in the source line', async () => {
        await compileFilm(film(() => {
            // A no-break space joins two words, so "4 of 10" stays on one line. The line breaks at a plain space.
            const joined = quote('requests were slower in 4\u00a0of\u00a010 runs', { width: 460, size: 40 })
            expect(right(joined)).toBeLessThanOrEqual(460)
            expect(joined.find('4')[0]!.bounds().y - joined.find('in')[0]!.bounds().y).toBeGreaterThan(40)
            expect(joined.find('10')[0]!.bounds().y).toBeCloseTo(joined.find('4')[0]!.bounds().y, 0)
            // With plain spaces at the same width, the first line ends after the "4".
            const plain = quote('requests were slower in 4 of 10 runs', { width: 460, size: 40 })
            expect(plain.find('4')[0]!.bounds().y - plain.find('in')[0]!.bounds().y).toBeLessThan(5)
            expect(plain.find('10')[0]!.bounds().y - plain.find('4')[0]!.bounds().y).toBeGreaterThan(40)
            // Joined words that are wider than the object are an error, and the width that it names is enough.
            const stuck = (width: number) => () => quote('4\u00a0of\u00a010\u00a0requests\u00a0were\u00a0slower', { width, size: 40 })
            expect(stuck(420)).toThrow(/quote: no line can break in "“4\u00a0of\u00a010\u00a0requests\u00a0were\u00a0slower”", because no-break spaces join its words\. It is 489 px wide at size 40, and a width of 420 leaves 390 px for the words\. Give a width of 519 or more, a smaller size, or a plain space where a line may break/)
            expect(stuck(518)).toThrow(/no line can break/)
            expect(stuck(519)).not.toThrow()

            // A web address has no space. A line of the source also breaks after a "/", so the address stays inside the width.
            const cited = quote('yes', { where: 'https://example.com/load-test/2026-06-11', width: 420, size: 40 })
            expect(right(cited.source!)).toBeLessThanOrEqual(420)
            // "https://example.com/" has 20 characters, and the next line starts at the left edge.
            const [first, next] = [cited.source!.chars[0]!, cited.source!.chars[20]!]
            expect(next.data['key']).toBe('l')
            expect(next.bounds().y - first.bounds().y).toBeCloseTo(1.25 * 31, 0)
            expect(Math.abs(next.bounds().x - first.bounds().x)).toBeLessThan(3)
            expect(bottom(cited.rule)).toBeGreaterThan(bottom(cited.source!) - 0.01)
            // The film check reads the line as the film gave it.
            expect(cited.source!.source).toBe('https://example.com/load-test/2026-06-11')
            // A part of the source line with no space and no "/" that is wider than the object is an error. It names the option, and the width that is enough.
            const address = 'https://cursor.com/blog/what-we-have-learned-building-cloud-agents'
            expect(() => quote('yes', { by: 'Cursor', where: address, width: 578, size: 36 })).toThrow(/quote: the part "what-we-have-learned-building-cloud-agents" of `where` is 552 px wide at size 28, and a width of 578 leaves 551 px for the source line\. A line of the source breaks at a space and after a "\/"\. Give a shorter `where`, or a width of 579 or more/)
            expect(() => quote('yes', { by: 'Cursor', where: address, width: 579, size: 36 })).not.toThrow()
            expect(() => quote('yes', { by: 'Supercalifragilisticexpialidocious', when: '2026', width: 200, size: 40 })).toThrow(/the part "Supercalifragilisticexpialidocious" of `by` is 457 px wide at size 31, and a width of 200 leaves 170 px for the source line\..* Give a shorter `by`, or a width of 487 or more/)

            // In a pair, the source line of the first quote stays in the half of that quote.
            const pair = quotePair({ words: 'the agent loop lives in Temporal', by: 'Cursor', where: address }, { words: 'the harness runs inside the sandbox', by: 'a lab' }, { width: 1500, size: 36 })
            expect(right(pair.quotes[0])).toBeLessThanOrEqual((1500 - 108) / 2)
            // An error of a pair names the quote, and the width of the pair.
            expect(() => quotePair({ words: 'yes', where: address }, { words: 'no' }, { width: 700, size: 36 })).toThrow(/quotePair: the part "what-we-have-learned-building-cloud-agents" of `where` of quote 0 is 552 px wide at size 28, and a width of 700 with a gap of 108 leaves 269 px for the source line of each quote\. A line of the source breaks at a space and after a "\/"\. Give a shorter `where`, a width of 1266 or more, or a smaller gap/)
            expect(() => quotePair({ words: 'yes', where: address }, { words: 'no' }, { width: 1266, size: 36 })).not.toThrow()
            expect(() => quotePair({ words: 'yes' }, { words: 'requests\u00a0were\u00a0slower\u00a0with\u00a0the\u00a0cache' }, { width: 700, size: 36 })).toThrow(/quotePair: no line can break in "“requests\u00a0were\u00a0slower\u00a0with\u00a0the\u00a0cache”" of quote 1, because no-break spaces join its words\. It is 553 px wide at size 36, and a width of 700 with a gap of 108 leaves 269 px for the words of each quote\. Give a width of 1267 or more, a smaller gap, a smaller size, or a plain space where a line may break/)
        }))
    })

    it('sets each marked part in the color of the rule or in a color of its own, over a line end too, and each [...] of a cut quote in dim', async () => {
        await compileFilm(film(() => {
            const said = quote(WORDS, { mark: 'lives in Temporal', color: 'orange', width: 600, size: 40 })
            expect(said.rule.get('fill')).toEqual(paint('orange'))
            expect(colored(said, 'orange')).toBe('livesinTemporal')
            expect(colored(said, 'ink')).toBe('“theagentloopratherthanontheVMitself”')
            // The first line ends after "Temporal", so this mark is on two lines.
            const over = quote(WORDS, { mark: 'Temporal rather', color: 'orange', width: 600, size: 40 })
            expect(colored(over, 'orange')).toBe('Temporalrather')
            expect(over.find('rather')[0]!.bounds().y - over.find('Temporal')[0]!.bounds().y).toBeGreaterThan(40)
            // Several marks, in a color that is not the color of the rule.
            const two = quote(WORDS, { mark: ['agent loop', 'VM'], markColor: 'yellow', color: 'teal' })
            expect(two.rule.get('fill')).toEqual(paint('teal'))
            expect(colored(two, 'yellow')).toBe('agentloopVM')
            expect(colored(two, 'teal')).toBe('')
            // A mark starts and ends at the borders of words: "not" is the word, and not the first letters of "nothing" and "notes".
            expect(colored(quote('it is not safe, and nothing in the notes says another thing', { mark: 'not', color: 'orange' }), 'orange')).toBe('not')
            // A part that is in the words more than once is marked at all its places. A comma, a period, and a quotation mark are borders.
            expect(colored(quote('the loop and the lock, the last', { mark: 'the', color: 'orange' }), 'orange')).toBe('thethethe')
            expect(colored(quote('it is safe, and version 5.1 is "safe"', { mark: ['safe', '5.1'], color: 'orange' }), 'orange')).toBe('safe5.1safe')
            // The default color is blue.
            const plain = quote(WORDS, { mark: 'VM' })
            expect(plain.rule.get('fill')).toEqual(paint('blue'))
            expect(colored(plain, 'blue')).toBe('VM')
            // A cut quote shows each [...] in dim. Without `cut`, the same signs are words as the others are.
            const cut = 'an emulator [...] and a virtualizer [...]'
            expect(colored(quote(cut, { cut: true }), 'dim')).toBe('[...][...]')
            expect(colored(quote(cut), 'dim')).toBe('')
            expect(quote(cut, { cut: true }).words.source).toBe(`“${cut}”`)
            // The source line is in dim.
            const cited = quote(WORDS, { by: 'Cursor' })
            expect(cited.source!.chars[0]!.get('fill')).toEqual(paint('dim'))
            // The words are in the italic of the serif text font, or upright with `italic: false`.
            const letter = (italic: boolean) => text('g', { font: 'text-serif', size: 32, italic }).chars[0]!.get('path')
            expect(quote(WORDS).find('g')[0]!.get('path')).toEqual(letter(true))
            expect(quote(WORDS, { italic: false }).find('g')[0]!.get('path')).toEqual(letter(false))
            expect(letter(true)).not.toEqual(letter(false))
        }))
    })

    it('finds the glyphs of a part of the words at every place, with spaces that do not count, in a copy too', async () => {
        await compileFilm(film(() => {
            const said = quote('the loop and the lock', { width: 300, size: 40 })
            expect(keys(said.find('the'))).toBe('thethe')
            // The first glyph is the opening quotation mark.
            expect(said.find('the loop')).toEqual(said.words.chars.slice(1, 8))
            expect(said.find('theloop')).toEqual(said.find('the  loop'))
            expect(said.find('the lo')).toHaveLength(10)
            expect(said.find('look')).toEqual([])
            expect(said.find(' ')).toEqual([])
            // The places at the borders of words come first: the word "not" and the word "thing", and not the letters in "nothing".
            const short = quote('it is not safe, and nothing in the notes says another thing')
            expect(short.find('not')).toEqual(short.words.chars.slice(5, 8))
            expect(short.find('thing')).toEqual(short.words.chars.slice(-6, -1))
            // A part that is only inside longer words gives those places: "noth" is in "nothing" and in "another".
            expect(keys(short.find('noth'))).toBe('nothnoth')
            expect(keys(short.find('nothi'))).toBe('nothi')
            // A match starts after the one before it, so no glyph comes two times.
            const run = quote('aaaaa').find('aa')
            expect(run).toHaveLength(4)
            expect(new Set(run).size).toBe(4)
            // A copy has its own glyphs, and its own lines for `enter()`.
            const copy = said.clone()
            expect(keys(copy.find('lock'))).toBe('lock')
            expect(copy.find('lock')[0]).not.toBe(said.find('lock')[0])
            expect(copy.find('lock')[0]!.parent).toBe(copy.words)
        }))
    })

    it('enters with the rule first, then the words line by line, then the source line', async () => {
        let said!: Quote, bare!: Quote
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            said = quote(WORDS, { by: 'Cursor', width: 600, size: 40 }).at(-300, -200)
            bare = quote(WORDS, { width: 600, size: 40 }).at(-300, 100)
            s.wait(1)
            s.play(said.enter({ lag: 1 }), bare.enter({ lag: 1 }), { duration: 2, ease: linear })
            s.wait(0.5)
        }))
        expect(compiled.frame(0.5).ops).toHaveLength(0)
        // The first line has 28 glyphs: the quotation mark and "the agent loop lives in Temporal".
        const lines = (one: Quote) => [one.words.chars.slice(0, 28), one.words.chars.slice(28)].map((line) => [...new Set(line.map(shows))])
        const state = (time: number) => at(time, () => [said.rule.get('sy'), ...lines(said), shows(said.source!)])
        // The rule grows over the first 0.7 s. The two lines have 0.65 s each, from 1.3 s, and the source line the last 0.6 s.
        expect(state(1.2)).toEqual([expect.closeTo(0.2 / 0.7, 6), [0], [0], 0])
        expect(state(1.35)).toEqual([expect.closeTo(0.5, 6), [expect.closeTo(0.05 / 0.65, 6)], [0], 0])
        expect(state(1.625)).toEqual([expect.closeTo(0.625 / 0.7, 6), [expect.closeTo(0.5, 6)], [0], 0])
        expect(state(2.275)).toEqual([1, [1], [expect.closeTo(0.5, 6)], 0])
        expect(state(2.7)).toEqual([1, [1], [1], expect.closeTo(0.5, 6)])
        expect(state(3.2)).toEqual([1, [1], [1], 1])
        // The rule grows down from its top end, which stays in place.
        expect(at(1.35, () => said.rule.bounds())).toEqual({ x: -300, y: -200, width: 6, height: expect.closeTo(at(3.2, () => said.rule.bounds().height) / 2, 6) })
        // Without a source line, the words have the time to the end: 0.85 s for each line.
        expect(at(2.575, () => lines(bare))).toEqual([[1], [expect.closeTo(0.5, 6)]])
        expect(at(3, () => lines(bare))).toEqual([[1], [1]])
    })

    it('draws nothing before its turn in a sequence, and keeps the place of a group that is not on the stage', async () => {
        const compiled = await compile((s) => {
            s.wait(1)
            s.play(seq(fadeIn(rect(10, 10).at(-900, -500), { duration: 1 }), { ...quote('a b', { by: 'c' }).enter(), duration: 1 }))
            s.wait(0.5)
        })
        // In the first second, the rectangle is the one mark that the film draws. At the end: the rule, four glyphs of the words, and the source.
        for (const time of [1.3, 1.99]) expect(compiled.frame(time).ops).toHaveLength(1)
        expect(compiled.frame(3.4).ops).toHaveLength(7)
        const lefts: number[] = []
        for (const shift of [0, 300]) {
            let said!: Quote, outer!: Node
            const moved = await compile((s) => {
                said = quote('a b', { by: 'c' })
                outer = group(said).at(shift, 0)
                s.play(said.enter(), { duration: 1 })
                s.wait(0.5)
            })
            expect(said.parent).toBe(outer)
            lefts.push(Math.min(...paths(moved, 1.4).flatMap((op) => pathBounds(op.path)?.x ?? [])))
        }
        expect(lefts[1]! - lefts[0]!).toBeCloseTo(300, 6)
    })

    it('is one text for the film check, which asks for the time to read all of its words', async () => {
        const report = await checkFilm(film({ fps: 10 }, (s) => {
            s.wait(0.5)
            const said = s.add(quote(WORDS, { width: 600 }))
            s.wait(1)
            said.hide()
            s.wait(1.5)
        }), { motion: true })
        const brief = report.diagnostics.filter((finding) => finding.code === 'film.text_brief')
        // 63 characters at 20 in one second.
        expect(brief.map((finding) => finding.text)).toEqual([`“${WORDS}”`])
        expect(brief[0]!.message).toMatch(/needs about 3\.15 s for its 63 characters/)
        // The source line is a text of its own for the check, with its own time: 26 characters.
        const source = 'Cursor, 2026-06-02, a post'
        let reading = ''
        const cited = await checkFilm(film({ fps: 10 }, (s) => {
            s.wait(0.5)
            const said = s.add(quote(WORDS, { by: 'Cursor', when: '2026-06-02', where: 'a post', width: 600 }))
            reading = said.reading
            s.wait(1)
            said.hide()
            s.wait(1.5)
        }), { motion: true })
        const texts = cited.diagnostics.filter((finding) => finding.code === 'film.text_brief').map((finding) => [finding.text, /needs about [\d.]+ s for its \d+ characters/.exec(finding.message)?.[0]])
        expect(texts).toEqual([[`“${WORDS}”`, 'needs about 3.15 s for its 63 characters'], [source, 'needs about 1.3 s for its 26 characters']])
        // A viewer reads both. So a quote stays up for the time of its words and its source line together: `reading` is the two as one text.
        expect(reading).toBe(`“${WORDS}” ${source}`)
        expect(readingSeconds(reading)).toBeCloseTo(3.15 + 0.05 + 1.3, 6)
        await compileFilm(film(() => expect(quote('yes').reading).toBe('“yes”')))
    })

    it('stands in a zone as a panel: the plate has the padding at each side of the quote, and the quote enters inside it', async () => {
        let said!: Quote, panel!: ReturnType<typeof zone>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            said = quote(WORDS, { by: 'Cursor', width: 600, size: 40 })
            panel = zone(said, { color: 'grid', fill: 'surface', fillOpacity: 1, padding: 40 }).at(100, 50)
            s.wait(1)
            s.play(fadeIn(panel), said.enter(), { duration: 2, ease: linear })
            s.wait(0.5)
        }))
        // The plate is the quote, from its rule to the end of its ink, with 40 px at each side. `.at()` of a zone places its middle.
        const inner = said.bounds(), plate = panel.backdrop!.bounds()
        expect([inner.x - plate.x, inner.y - plate.y, right(panel.backdrop!) - right(said), bottom(panel.backdrop!) - bottom(said)]).toEqual([40, 40, 40, 40].map((room) => expect.closeTo(room, 6)))
        expect(panel.center).toEqual([expect.closeTo(100, 6), expect.closeTo(50, 6)])
        // Nothing before the entrance. Then the plate fades in while the rule grows, and the source line comes last.
        expect(compiled.frame(0.5).ops).toHaveLength(0)
        expect(at(1.35, () => [shows(panel), said.rule.get('sy'), shows(said.source!)])).toEqual([expect.closeTo(0.175, 6), expect.closeTo(0.5, 6), 0])
        expect(at(3.2, () => [shows(panel), said.rule.get('sy'), ...new Set(said.words.chars.map(shows)), shows(said.source!)])).toEqual([1, 1, 1, 1])
    })

    it('puts two quotes side by side with one width and one top line, and a word between them with the same room at both sides', async () => {
        await compileFilm(film(() => {
            const pair = quotePair(
                { words: WORDS, by: 'Cursor', color: 'orange' },
                { words: 'the harness runs inside the sandbox', by: 'a lab', when: '2026', color: 'red', mark: 'sandbox' },
                { width: 1300, gap: 300, versus: 'but', size: 40 },
            ).at(-650, -100)
            const [first, second] = pair.quotes
            // Each quote is (1300 - 300) / 2 wide, so the second rule is 800 after the first one, at the same top.
            expect([first.rule.bounds().x, first.rule.bounds().y]).toEqual([-650, -100])
            expect([second.rule.bounds().x, second.rule.bounds().y]).toEqual([150, -100])
            expect(first.baseline).toBe(second.baseline)
            // Each one has the lines of a quote of that width, and its own color, mark, and source.
            const alone = quote(WORDS, { by: 'Cursor', width: 500, size: 40 })
            expect([first.words.bounds().width, first.height]).toEqual([expect.closeTo(alone.words.bounds().width, 6), expect.closeTo(alone.height, 6)])
            expect(right(second.words)).toBeLessThanOrEqual(651)
            expect([first.rule.get('fill'), second.rule.get('fill')]).toEqual([paint('orange'), paint('red')])
            expect(colored(second, 'red')).toBe('sandbox')
            expect(second.source!.source).toBe('a lab, 2026')
            // The word is in dim, in the font of the quotes, on the base line of the first lines.
            const word = pair.versus!.bounds()
            const letter = (font: 'sans' | 'text-serif') => text('b', { font, size: 40 }).chars[0]!.get('path')
            expect(pair.versus!.source).toBe('but')
            expect([pair.versus!.data['size'], pair.versus!.chars[0]!.get('fill'), pair.versus!.chars[0]!.get('path')]).toEqual([40, paint('dim'), letter('text-serif')])
            expect(quotePair({ words: 'yes' }, { words: 'no' }, { versus: 'but', size: 40, font: 'sans' }).versus!.chars[0]!.get('path')).toEqual(letter('sans'))
            // A round letter goes a little under the base line.
            expect(Math.abs(word.y + word.height - (-100 + first.baseline))).toBeLessThan(1)
            // It has the same room at both sides: from the end of the ink of the first line of the first quote, and to the rule of the second quote.
            const rooms = (one: ReturnType<typeof quotePair>) => { const box = one.versus!.bounds(), start = one.quotes[0].rule.bounds().x; return [box.x - (start + one.quotes[0].lineEnd()), one.quotes[1].rule.bounds().x - (box.x + box.width)] }
            expect(rooms(pair)[0]).toBeCloseTo(rooms(pair)[1]!, 6)
            expect(rooms(pair)[0]).toBeGreaterThan(text('H', { font: 'text-serif', size: 40 }).bounds().height)
            // Beside a short first quote, the middle of the gap is far from the first quote and near the second one. The word is not there: it is at the left of the gap, which starts 500 after the first rule.
            const short = quotePair({ words: 'yes' }, { words: 'no' }, { width: 1300, gap: 300, versus: 'but', size: 40 })
            expect(rooms(short)[0]).toBeCloseTo(rooms(short)[1]!, 6)
            expect(right(short.versus!)).toBeLessThan(500)
            expect(pair.children).toEqual([first, pair.versus, second])
            // With two sizes, the word has the smaller one, and stands on the first base line of the quote with that size. Nothing of the pair is over its top line.
            for (const sizes of [[32, 56], [56, 32]] as const) {
                const mixed = quotePair({ words: 'the cache makes every request faster', size: sizes[0] }, { words: 'with the cache, 4 of 10 requests were slower', size: sizes[1] }, { versus: 'but' }).at(-850, -160)
                const smaller = mixed.quotes[sizes[0] === 32 ? 0 : 1]
                expect(mixed.versus!.data['size']).toBe(32)
                expect(mixed.bounds().y).toBe(-160)
                expect(mixed.versus!.bounds().y).toBeGreaterThanOrEqual(-160)
                expect(Math.abs(bottom(mixed.versus!) - (-160 + smaller.baseline))).toBeLessThan(1)
                expect(rooms(mixed)[0]).toBeCloseTo(rooms(mixed)[1]!, 6)
                // The default gap is 3 times the larger size: 168. Each quote has half of the rest.
                expect(mixed.quotes[1].rule.bounds().x).toBeCloseTo(-850 + (1700 - 168) / 2 + 168, 6)
            }
            // Without a word, the pair has its two quotes only. The default gap is 3 times the size, in a width of 1700.
            const plain = quotePair({ words: 'yes' }, { words: 'no', size: 20 })
            expect(plain.versus).toBeNull()
            expect(plain.quotes[1].rule.bounds().x).toBe(802 + 96)
            // A quote of the pair can have its own size. An option of the pair is for both.
            expect(plain.quotes.map((one) => one.words.data['size'])).toEqual([32, 20])
            expect(quotePair({ words: 'yes', color: 'red' }, { words: 'no' }, { size: 50, color: 'green' }).quotes.map((one) => [one.words.data['size'], one.rule.get('fill')])).toEqual([[50, paint('red')], [50, paint('green')]])
        }))
    })

    it('enters a pair with the first quote, then the word, then the second quote, which draws nothing before its turn', async () => {
        let pair!: ReturnType<typeof quotePair>
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            pair = quotePair({ words: 'yes', by: 'A' }, { words: 'no', by: 'B' }, { width: 1300, gap: 300, versus: 'but', size: 40 }).at(-650, -100)
            s.wait(1)
            s.play(pair.enter(), { duration: 5, ease: linear })
            s.wait(0.5)
        }))
        const [first, second] = pair.quotes
        const drawn = (time: number, one: Node) => paths(compiled, time).filter((op) => one.all().includes(op.node!)).length
        const arrived = (one: Quote) => [one.rule.get('sy'), ...new Set(one.words.chars.map(shows)), shows(one.source!)]
        expect(compiled.frame(0.5).ops).toHaveLength(0)
        // The first quote has the time to 3.3 s, the word comes from 3.1 s to 3.9 s, and the second quote has the time from 3.7 s.
        expect(drawn(1.5, first)).toBeGreaterThan(0)
        expect([drawn(1.5, pair.versus!), drawn(1.5, second)]).toEqual([0, 0])
        expect(at(3.3, () => arrived(first))).toEqual([1, 1, expect.closeTo(1, 6)])
        expect(at(3.5, () => shows(pair.versus!))).toBeCloseTo(0.5, 6)
        expect(drawn(3.65, second)).toBe(0)
        expect(at(3.75, () => second.rule.get('sy'))).toBeGreaterThan(0)
        expect(at(3.75, () => second.rule.get('sy'))).toBeLessThan(0.2)
        expect(at(3.75, () => shows(second.source!))).toBe(0)
        expect(at(6, () => [shows(second), ...arrived(second)])).toEqual([1, 1, 1, 1])
        // 2 rules, 5 and 4 glyphs of the words, 3 glyphs of the word between, and 2 of the sources.
        expect(compiled.frame(6.4).ops).toHaveLength(16)
    })

    it('draws a double mark inside the words as a single curved mark, and finds a part as the film wrote it', async () => {
        await compileFilm(film(() => {
            const drawn = (words: string) => keys(quote(words).words.chars)
            // The object puts the double marks around the words. A double mark inside them opens at the start of a word, and closes at any other place.
            expect(drawn('"x"')).toBe('“‘x’”')
            expect(drawn('he said "it is safe" and left')).toBe('“hesaid‘itissafe’andleft”')
            expect(drawn('they call it "safe"')).toBe('“theycallit‘safe’”')
            expect(drawn('a “curved” one ("x")')).toBe('“a‘curved’one(‘x’)”')
            // After a digit, with no quotation open, a straight mark is the sign for inches, and it stays. An apostrophe stays too.
            expect(drawn('it\'s a 5" disk')).toBe('“it\'sa5"disk”')
            expect(drawn('"a 5" one')).toBe('“‘a5’one”')
            // The film check reads what is on the screen.
            expect(quote('he said "it is safe"').words.source).toBe('“he said ‘it is safe’”')
            // `find` and `mark` take the words as the film wrote them, with the straight marks.
            const said = quote('he said "it is safe" and left', { mark: '"it is safe"', color: 'orange' })
            expect(colored(said, 'orange')).toBe('‘itissafe’')
            expect(keys(said.find('"it'))).toBe('‘it')
            expect(said.find('‘it')).toEqual([])
        }))
    })

    it('takes 1.4 s to enter and 2.6 s for a pair by default, with half the time of a line between two lines, and a pair gives its lag to its quotes', async () => {
        expect([quote('yes').enter().duration, quote('yes').enter({ duration: 3 }).duration]).toEqual([1.4, 3])
        expect([quotePair({ words: 'yes' }, { words: 'no' }).enter().duration, quotePair({ words: 'yes' }, { words: 'no' }).enter({ duration: 4 }).duration]).toEqual([2.6, 4])
        let said!: Quote, pair!: ReturnType<typeof quotePair>, slow!: ReturnType<typeof quotePair>
        await compileFilm(film({ fps: 20 }, (s) => {
            // Two lines of six glyphs each, and no source line.
            said = quote('first\nfinal', { size: 40 }).at(-800, -400)
            pair = quotePair({ words: 'first\nfinal' }, { words: 'no' }, { size: 40 }).at(-800, -100)
            slow = quotePair({ words: 'first\nfinal' }, { words: 'no' }, { size: 40 }).at(-800, 200)
            s.wait(1)
            s.play(said.enter(), pair.enter(), slow.enter({ lag: 1 }), { duration: 3, ease: linear })
        }))
        const lines = (one: Quote) => [one.words.chars.slice(0, 6), one.words.chars.slice(6)].map((line) => [...new Set(line.map(shows))])
        // The words have the time from 1.45 s to 4 s. With a lag of 0.5, a line takes 1.7 s, and the second one starts 0.85 s after the first one.
        expect(at(1.45 + 0.85, () => lines(said))).toEqual([[expect.closeTo(0.5, 6)], [0]])
        expect(at(1.45 + 1.7, () => lines(said))).toEqual([[expect.closeTo(1, 6)], [expect.closeTo(0.5, 6)]])
        // The first quote of a pair has the time from 1 s to 2.38 s, and its words from 1.207 s: 0.782 s for a line.
        expect(at(1.207 + 0.782, () => lines(pair.quotes[0]))).toEqual([[expect.closeTo(1, 6)], [expect.closeTo(0.5, 6)]])
        // With a lag of 1, the second line starts when the first one ends: 0.5865 s for a line.
        expect(at(1.207 + 0.5865, () => lines(slow.quotes[0]))).toEqual([[expect.closeTo(1, 6)], [expect.closeTo(0, 6)]])
        expect(at(1.207 + 0.5865 * 1.5, () => lines(slow.quotes[0]))).toEqual([[1], [expect.closeTo(0.5, 6)]])
    })

    it('refuses empty words, a width that cannot hold the longest word, a mark that is not in the words, a cut with no sign of it, and a time that is not a number', async () => {
        await compileFilm(film(() => {
            expect(() => quote(' ')).toThrow(/quote: give it the words of the source/)
            // The longest word needs 156 px, and the rule with its room takes 30.
            expect(() => quote(WORDS, { width: 185, size: 40 })).toThrow(/the word "Temporal" is 156 px wide at size 40, and a width of 185 leaves 155 px for the words\. Give a width of 186 or more, or a smaller size/)
            expect(() => quote(WORDS, { width: 186, size: 40 })).not.toThrow()
            expect(() => quote(WORDS, { width: 20 })).toThrow(/width is the width of the object\. Give more than 23/)
            expect(() => quote(WORDS, { mark: 'temporal' })).toThrow(/the mark "temporal" is not in the words/)
            expect(() => quote(WORDS, { mark: ['VM', 'the cloud'] })).toThrow(/the mark "the cloud" is not in the words/)
            expect(() => quote(WORDS, { mark: '' })).toThrow(/the mark "" is not in the words/)
            expect(() => quote(WORDS, { cut: true })).toThrow(/cut is true, and the words have no \[\.\.\.\]\. Write \[\.\.\.\] at each place/)
            expect(() => quote(WORDS, { size: 0 })).toThrow(/size is the text size of the words/)
            expect(() => quote(WORDS, { leading: 0 })).toThrow(/leading is the line height/)
            expect(() => quote(WORDS, { by: 'A', sourceSize: -1 })).toThrow(/sourceSize is the text size of the source line/)
            // A pair names the quote and the width of the pair, which is the width that the film gave.
            expect(() => quotePair({ words: WORDS }, { words: ' ' })).toThrow(/quotePair: quote 1: give it the words of the source/)
            expect(() => quotePair({ words: 'no' }, { words: WORDS }, { width: 431, gap: 60, size: 40 })).toThrow(/the word "Temporal" of quote 1 is 156 px wide at size 40, and a width of 431 with a gap of 60 leaves 155 px for the words of each quote\. Give a width of 432 or more, a smaller gap, or a smaller size/)
            expect(() => quotePair({ words: 'no' }, { words: WORDS }, { width: 432, gap: 60, size: 40 })).not.toThrow()
            expect(() => quotePair({ words: 'yes' }, { words: 'no' }, { width: 40, gap: 60 })).toThrow(/a width of 40 leaves no room for two quotes with a gap of 60/)
            expect(() => quotePair({ words: 'yes' }, { words: 'no' }, { gap: -1 })).toThrow(/gap is the room between the two quotes/)
            // The word between has the height of its letters as room at each side, at the least. A larger gap adds a quarter of what it grows to each side.
            const narrow = (gap: number) => () => quotePair({ words: WORDS }, { words: 'no' }, { width: 1100, gap, versus: 'against', size: 40 })
            expect(narrow(40)).toThrow(/quotePair: the word "against" has 21 px at each side, between the first line of quote 0 and the rule of quote 1\. It needs 27 px, the height of its letters\. Give a gap of 63 or more, or a shorter word/)
            expect(narrow(62)).toThrow(/has 26 px at each side/)
            expect(narrow(63)).not.toThrow()
            // A mark that is in the words, and only inside longer words.
            expect(() => quote('it is not safe, and nothing', { mark: 'noth' })).toThrow(/quote: the mark "noth" is not in the words as whole words: it is a part of "nothing"\. A mark starts and ends at the borders of words/)
            expect(() => quote('it is not safe', { mark: 'ot sa' })).toThrow(/the mark "ot sa" is not in the words as whole words: it is a part of "not safe"\./)
            // A lag or a duration that is not a number would leave the words hidden, with no error.
            const said = quote(WORDS), pair = quotePair({ words: 'yes' }, { words: 'no' })
            expect(() => said.enter({ lag: NaN })).toThrow(/quote: lag is NaN\. It is the part of the time of one line that passes before the next line starts: a number, 0 or more/)
            expect(() => said.enter({ duration: NaN })).toThrow(/quote: duration is NaN\. It is a number of seconds, 0 or more/)
            expect(() => said.enter({ lag: -1 })).toThrow(/quote: lag is -1\./)
            expect(() => said.enter({ duration: '2' as never })).toThrow(/quote: duration is "2"\./)
            expect(() => pair.enter({ lag: NaN })).toThrow(/quotePair: lag is NaN\./)
            expect(() => pair.enter({ duration: Infinity })).toThrow(/quotePair: duration is Infinity\./)
            expect(() => said.enter({ lag: 0, duration: 0 })).not.toThrow()
        }))
    })
})
