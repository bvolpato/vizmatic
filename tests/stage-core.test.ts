import { describe, expect, it } from 'vitest'
import {
    applyMatrix, arcPath, arrow, checkFilm, circle, circlePath, compileFilm, curveThrough, dot, draw, dynamic, fadeIn, fadeOut, film, fontFor, group, lagged,
    line, linePath, mixColor, morph, morphMatching, Node, parseColor, parseSvgPath, pathBounds, pathLength,
    plane, pointAt, rect, rotate, scaleBy, seq, tex, text, to, trimPath, write, smooth, spring, thereAndBack, type PathOp,
} from '../src/stage/index'
import { alignPaths, matchSequence, pathMixer } from '../src/stage/morph'
import { renderFilmFrame } from '../src/stage/export'
import { RasterPool, framesToJob } from '../src/stage/raster'
import { decode } from 'fast-png'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function paths(film: { frame(t: number): { ops: readonly unknown[] } }, time: number): PathOp[] {
    return film.frame(time).ops.filter((op) => (op as PathOp).kind === 'path') as PathOp[]
}

describe('geometry', () => {
    it('measures a circle close to its true circumference', () => {
        expect(pathLength(circlePath(0, 0, 100))).toBeCloseTo(2 * Math.PI * 100, 0)
    })

    it('finds tight bounds of curves, not of their control points', () => {
        const b = pathBounds(circlePath(10, 20, 50))!
        expect(b.x).toBeCloseTo(-40, 3)
        expect(b.width).toBeCloseTo(100, 3)
    })

    it('parses relative commands and arcs so that closed shapes return to their start', () => {
        const [square] = parseSvgPath('m10 10h20v20h-20z')
        expect(square!.closed).toBe(true)
        expect([square!.p[0], square!.p[1]]).toEqual([10, 10])
        expect([square!.p[square!.p.length - 2], square!.p[square!.p.length - 1]]).toEqual([10, 10])
        const arc = parseSvgPath('M0 0A50 50 0 0 1 100 0')
        expect(pathLength(arc)).toBeCloseTo(Math.PI * 50, 0)
    })

    it('reads arc flags that run into the next number', () => {
        const arc = parseSvgPath('M0 0a50 50 0 01100 0')
        expect(pointAt(arc, 1)[0]).toBeCloseTo(100, 6)
    })

    it('trims by arc length, not by parameter', () => {
        const half = trimPath(linePath([0, 0], [100, 0]), 0, 0.5)
        expect(pathLength(half)).toBeCloseTo(50, 6)
        const middle = trimPath(arcPath(0, 0, 10, 10, 0, Math.PI), 0.25, 0.75)
        expect(pathLength(middle)).toBeCloseTo(Math.PI * 5, 1)
    })

    it('leaves a gap at a pole instead of drawing across it', () => {
        const path = curveThrough([[0, 0], [1, 1], [2, 2], [NaN, NaN], [3, 3], [4, 4]])
        expect(path).toHaveLength(2)
    })
})

describe('morphing', () => {
    it('keeps finished pieces on screen until a lagged morph ends', async () => {
        const row = (y: number) => [-150, -50, 50, 150].map((x) => circle(20, { fill: 'blue' }).at(x, y))
        const compiled = await compileFilm(film((s) => {
            const from = row(-100)
            for (const node of from) s.add(node)
            s.play(morph(from, row(100), { lag: 0.5 }), { duration: 1 })
            s.wait(0.1)
        }))
        // The pieces finish at 0.4, 0.6, 0.8, and 1.0 seconds. The first three must not vanish.
        for (const time of [0.1, 0.5, 0.7, 0.9, 1.05]) expect(paths(compiled, time).length).toBe(4)
    })

    it('returns the exact source and target at the endpoints', () => {
        const from = circlePath(0, 0, 10), to = linePath([0, 0], [50, 50])
        const mix = pathMixer(from, to)
        expect(mix(0)).toBe(from)
        expect(mix(1)).toBe(to)
    })

    it('gives shapes with different ring counts matching structure', () => {
        const donut = [...circlePath(0, 0, 50), ...circlePath(0, 0, 20)]
        const aligned = alignPaths(circlePath(0, 0, 30), donut)
        expect(aligned.from).toHaveLength(2)
        expect(aligned.from[0]!.length).toBe(aligned.to[0]!.length)
        expect(aligned.from[1]!.length).toBe(aligned.to[1]!.length)
    })

    it('matches a common subsequence in order', () => {
        expect(matchSequence(['a', 'b', 'c', 'd'], ['b', 'x', 'd'])).toEqual([[1, 0], [3, 2]])
    })
})

describe('timeline', () => {
    it('renders each time the same way whatever the seek order', async () => {
        const compiled = await compileFilm(film((s) => {
            const a = s.add(circle(40, { stroke: 'blue' }).at(-200, 0))
            s.play(draw(a))
            s.play(to(a, (n) => n.moveTo([200, 100]).color('yellow').scale(2)))
            s.wait(0.5)
        }))
        const forward = [0.3, 0.9, 1.5, 2.2, 3].map((t) => compiled.svg(t))
        const backward = [3, 2.2, 1.5, 0.9, 0.3].map((t) => compiled.svg(t)).reverse()
        expect(backward).toEqual(forward)
        expect(new Set(forward).size).toBe(forward.length)
    })

    it('advances by the longest animation and honors an explicit duration', async () => {
        let times: number[] = []
        await compileFilm(film((s) => {
            const a = s.add(circle(10)), b = s.add(circle(10))
            s.play(fadeOut(a, { duration: 1 }), fadeOut(b, { duration: 3 }))
            times.push(s.time)
            s.play(fadeIn(a), { duration: 2 })
            times.push(s.time)
            s.wait(0.5)
            times.push(s.time)
            s.play(seq(fadeOut(a, { duration: 1 }), fadeIn(a, { duration: 1 })))
            times.push(s.time)
        }))
        times = times.map((t) => Math.round(t * 1000) / 1000)
        expect(times).toEqual([3, 5, 5.5, 7.5])
    })

    it('keeps staggered items hidden until their own turn', async () => {
        const items = [circle(10).at(-100, 0), circle(10).at(0, 0), circle(10).at(100, 0)]
        const compiled = await compileFilm(film((s) => {
            s.wait(1)
            s.play(lagged(items.map((item) => fadeIn(item, { duration: 1 })), { lag: 1 }))
        }))
        expect(paths(compiled, 0.5)).toHaveLength(0)
        expect(paths(compiled, 1.5)).toHaveLength(1)
        expect(paths(compiled, 2.5)).toHaveLength(2)
        expect(paths(compiled, 3.5)).toHaveLength(3)
    })

    it('writes glyphs one at a time and leaves no outline behind', async () => {
        const compiled = await compileFilm(film((s) => {
            s.play(write(text('Hi there', { size: 80 })), { duration: 2 })
            s.wait(0.5)
        }))
        const early = paths(compiled, 0.2).filter((op) => op.fill || op.stroke).length
        const final = paths(compiled, 2.4)
        expect(early).toBeLessThan(final.length)
        expect(final.length).toBe('Hithere'.length)
        for (const op of final) {
            expect(op.stroke).toBeNull()
            expect(op.fillAlpha).toBeCloseTo(1, 5)
        }
    })

    it('rotates and scales around the center, so the center never drifts mid-animation', async () => {
        const box = rect(200, 100, { stroke: 'ink' }).at(300, 120)
        let compiledCenter: [number, number] = [0, 0]
        const compiled = await compileFilm(film((s) => {
            s.add(box)
            compiledCenter = box.center
            s.play(rotate(box, Math.PI / 3, { duration: 1 }))
            s.play(scaleBy(box, 2, { duration: 1 }))
        }))
        for (const t of [0.5, 1.25, 1.75]) {
            const [op] = paths(compiled, t)
            const b = pathBounds(op!.path)!
            expect(b.x + b.width / 2 - compiled.width / 2).toBeCloseTo(compiledCenter[0], 1)
            expect(b.y + b.height / 2 - compiled.height / 2).toBeCloseTo(compiledCenter[1], 1)
        }
    })

    it('leaves the target on stage after a morph and hides the source', async () => {
        const a = circle(50, { stroke: 'blue' })
        const b = rect(80, 80, { stroke: 'red' }).at(200, 0)
        const compiled = await compileFilm(film((s) => {
            s.add(a)
            s.play(morph(a, b), { duration: 1 })
            s.wait(1)
        }))
        expect(paths(compiled, 0)).toHaveLength(1)
        const mid = paths(compiled, 0.5)
        expect(mid).toHaveLength(1)
        expect(pathBounds(mid[0]!.path)!.x + pathBounds(mid[0]!.path)!.width / 2 - compiled.width / 2).toBeGreaterThan(50)
        const end = paths(compiled, 1.5)
        expect(end).toHaveLength(1)
        expect(end[0]!.stroke).toEqual(parseColor('red'))
        expect(pathBounds(end[0]!.path)!.width).toBeCloseTo(80, 3)
    })

    it('restores a faded node, so it can return later', async () => {
        const a = circle(20, { stroke: 'blue' })
        const compiled = await compileFilm(film((s) => {
            s.add(a)
            s.play(fadeOut(a), { duration: 1 })
            s.wait(1)
            s.play(fadeIn(a), { duration: 1 })
        }))
        expect(paths(compiled, 1.5)).toHaveLength(0)
        expect(paths(compiled, 3)[0]!.strokeAlpha).toBeCloseTo(1, 5)
    })

    it('drives drawings from values through dynamic nodes', async () => {
        const compiled = await compileFilm(film((s) => {
            const x = s.value(0)
            s.add(dynamic(() => dot(10, 'yellow').at(x.value, 0)))
            s.play(x.to(100, { duration: 1 }))
        }))
        const center = (t: number) => {
            const b = pathBounds(paths(compiled, t)[0]!.path)!
            return b.x + b.width / 2 - compiled.width / 2
        }
        expect(center(0)).toBeCloseTo(0, 3)
        expect(center(1)).toBeCloseTo(100, 3)
        expect(center(0.5)).toBeCloseTo(50, 1)
    })

    it('runs updaters without leaking state between frames', async () => {
        const target = dot(5, 'red')
        const follower = dot(5, 'blue')
        const compiled = await compileFilm(film((s) => {
            s.add(target, follower)
            s.update(follower, (n) => n.at(target.get('x') + 20, 0))
            s.play(to(target, (n) => n.at(100, 0)), { duration: 1 })
        }))
        const x = (t: number) => {
            const ops = paths(compiled, t)
            const b = pathBounds(ops[1]!.path)!
            return b.x + b.width / 2 - compiled.width / 2
        }
        expect(x(1)).toBeCloseTo(120, 3)
        expect(x(0)).toBeCloseTo(20, 3)
    })

    it('warps every line of a grid through a matrix, with y up', async () => {
        const grid = plane({ unit: 100, x: [-2, 2], y: [-2, 2] })
        const probe = group(line([100, 0], [100, 0.001], { stroke: 'red' }))
        const compiled = await compileFilm(film((s) => {
            s.add(grid)
            s.add(probe)
            s.play(applyMatrix(probe, [[2, 0], [0, 1]]), { duration: 1 })
        }))
        const [op] = paths(compiled, 1).slice(-1)
        expect(pathBounds(op!.path)!.x - compiled.width / 2).toBeCloseTo(200, 3)
    })
})

describe('easing', () => {
    it('starts at 0 and lands exactly on 1', () => {
        for (const ease of [smooth, spring()]) {
            expect(ease(0)).toBeCloseTo(0, 6)
            expect(ease(1)).toBe(1)
        }
    })

    it('there-and-back ends where it started', () => {
        expect(thereAndBack(1)).toBeCloseTo(0, 6)
        expect(thereAndBack(0.5)).toBeCloseTo(1, 6)
    })
})

describe('color', () => {
    it('blends in OKLab with exact endpoints', () => {
        const a = parseColor('#ff0000'), b = parseColor('#00ff00')
        expect(mixColor(a, b, 0)).toBe(a)
        expect(mixColor(a, b, 1)).toBe(b)
        const mid = mixColor(a, b, 0.5)
        // An sRGB midpoint is a dark olive at (128, 128, 0). OKLab keeps the blend bright.
        expect(mid[0] + mid[1]).toBeGreaterThan(256)
    })

    it('re-themes a whole film from the same source when the look changes', async () => {
        const definition = film((s) => {
            s.add(circle(30, { stroke: 'blue' }))
            s.wait(1)
        })
        const midnight = await compileFilm(definition)
        const paper = await compileFilm(definition, { look: 'paper' })
        expect(midnight.background).toBe('#0b0c10')
        expect(paper.background).toBe('#f7f3ea')
        expect(paths(midnight, 0)[0]!.stroke).not.toEqual(paths(paper, 0)[0]!.stroke)
    })
})

describe('text and math', () => {
    it('applies kerning, so "AV" sets tighter than its advances alone', async () => {
        await compileFilm(film(() => {
            const font = fontFor('sans', 400)
            const a = font.glyphFor(65), v = font.glyphFor(86)
            const kern = font.kern(a, v)
            expect(kern).toBeLessThan(0)
            const size = 100
            const pair = text('AV', { size })
            const single = text('A', { size })
            const pairV = pair.chars[1]!.bounds()
            const pairA = pair.chars[0]!.bounds()
            const gap = pairV.x - (pairA.x + pairA.width)
            const noKern = (font.advance(a) / font.unitsPerEm) * size - single.chars[0]!.bounds().width
            // The ink gap closes by the kerning amount, compared with setting both glyphs by advance.
            expect(gap).toBeLessThan(noKern)
        }))
    })

    it('draws a character the chosen font lacks with the next bundled font', async () => {
        await compileFilm(film(() => {
            // Instrument Serif has no arrows or Greek, and Source Serif 4 has both.
            for (const char of ['\u2192', '\u03B1']) {
                const borrowed = text(char, { font: 'serif', size: 100 }).chars[0]!
                const direct = text(char, { font: 'text-serif', size: 100 }).chars[0]!
                expect(borrowed.data['missingGlyph']).toBeUndefined()
                expect(borrowed.bounds().width).toBeCloseTo(direct.bounds().width, 3)
                expect(borrowed.bounds().height).toBeCloseTo(direct.bounds().height, 3)
            }
            // Source Serif 4 has no element-of sign, so Noto Sans Math draws it.
            expect(text('\u2208', { font: 'text-serif', size: 100 }).chars[0]!.data['missingGlyph']).toBeUndefined()
        }))
    })

    it('reports a character that no bundled font can draw', async () => {
        const report = await checkFilm(film((s) => {
            s.add(text('a\u{10FFFD}b', { font: 'text-serif', size: 100 }))
            s.wait(0.5)
        }))
        expect(report.ok).toBe(false)
        expect(report.diagnostics.map((entry) => entry.code)).toContain('film.missing_glyph')
        expect(report.diagnostics.find((entry) => entry.code === 'film.missing_glyph')?.message).toContain('U+10FFFD')
    })

    it('centers a text block on its position', async () => {
        await compileFilm(film(() => {
            const [x] = text('Balanced', { size: 60 }).at(100, 0).center
            expect(x).toBeCloseTo(100, 0)
        }))
    })

    it('places the left or the right edge of a text block when it has an anchor', async () => {
        await compileFilm(film(() => {
            const middle = text('Balanced', { size: 60 }).at(100, 40)
            const left = text('Balanced', { size: 60, anchor: 'left' }).at(100, 40)
            const right = text('Balanced', { size: 60, anchor: 'right' }).at(100, 40)
            // Bounds are tight to the ink, and the anchor is the edge of the advance width. One side bearing is the difference.
            expect(left.left[0]).toBeGreaterThan(100 - 1)
            expect(left.left[0]).toBeLessThan(100 + 6)
            expect(right.right[0]).toBeLessThan(100 + 1)
            expect(right.right[0]).toBeGreaterThan(100 - 6)
            // The block moves by half of its advance width, and nothing else changes.
            expect(left.center[0] - middle.center[0]).toBeCloseTo(middle.get('px'), 6)
            expect(middle.center[0] - right.center[0]).toBeCloseTo(middle.get('px'), 6)
            expect(left.width).toBeCloseTo(middle.width, 6)
            // The three share a baseline, whatever the anchor is.
            expect(left.center[1]).toBeCloseTo(middle.center[1], 6)
            expect(right.center[1]).toBeCloseTo(middle.center[1], 6)
        }))
    })

    it('anchors a wrapped block by the width of its longest line', async () => {
        await compileFilm(film(() => {
            const block = text('one long line of words\nshort', { size: 40, anchor: 'right', align: 'right' }).at(300, 0)
            expect(block.right[0]).toBeLessThan(300 + 1)
            expect(block.right[0]).toBeGreaterThan(300 - 6)
        }))
    })

    it('finds a term in an equation by TeX fragment', async () => {
        await compileFilm(film(() => {
            const eq = tex('a^2 + b^2 = c^2')
            const term = eq.part('b^2')
            expect(term.map((glyph) => glyph.data['key'])).toEqual(['\u{1D44F}', '2'])
            expect(eq.parts('2')).toHaveLength(3)
        }))
    })

    it('keeps matching glyphs through an equation morph', async () => {
        const compiled = await compileFilm(film((s) => {
            const from = s.add(tex('a + b'))
            s.wait(0.1)
            s.play(morphMatching(from, tex('b + a + c')), { duration: 1 })
        }))
        expect(paths(compiled, 0).length).toBe(3)
        expect(paths(compiled, 1.2).length).toBe(5)
    })
})

describe('arrow', () => {
    it('lands its tip exactly on the target', () => {
        const a = arrow([0, 0], [200, 0], { tip: 20 })
        const tip = a.children[1] as Node
        const b = pathBounds(tip.get('path')!)!
        expect(b.x + b.width).toBeCloseTo(200, 6)
    })

    it('stops the shaft at the base of the tip so a thick line cannot poke through', () => {
        const a = arrow([0, 0], [200, 0], { tip: 20, width: 8 })
        const shaft = a.children[0] as Node
        expect(pathBounds(shaft.get('path')!)!.width).toBeCloseTo(180, 6)
    })
})

describe('raster', () => {
    it('renders identical bytes for the same frame', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'stage-core-'))
        try {
            const definition = film((s) => {
                s.add(circle(200, { stroke: 'yellow', width: 8 }))
                s.wait(1)
            })
            await renderFilmFrame(definition, 0.5, join(directory, 'a.png'), { width: 480 })
            await renderFilmFrame(definition, 0.5, join(directory, 'b.png'), { width: 480 })
            expect(await readFile(join(directory, 'a.png'))).toEqual(await readFile(join(directory, 'b.png')))
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('blooms near bright marks without lifting the background', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'stage-core-'))
        try {
            const definition = film((s) => {
                s.add(circle(200, { stroke: 'yellow', width: 10 }))
                s.wait(1)
            })
            const render = async (bloom: number, name: string) => {
                const path = join(directory, name)
                await renderFilmFrame(definition, 0.5, path, { width: 480, bloom })
                return decode(await readFile(path))
            }
            const off = await render(0, 'off.png'), on = await render(0.6, 'on.png')
            const pixel = (image: typeof off, x: number, y: number) => {
                const o = (y * image.width + x) * 4
                return [image.data[o]!, image.data[o + 1]!, image.data[o + 2]!]
            }
            // The far corner stays the exact background color.
            expect(pixel(on, 2, 2)).toEqual(pixel(off, 2, 2))
            // Just outside the ring (radius 50 px at this scale), light spills.
            const offNear = pixel(off, 240 + 58, 135), onNear = pixel(on, 240 + 58, 135)
            expect(onNear[0]!).toBeGreaterThan(offNear[0]! + 4)
        } finally {
            await rm(directory, { recursive: true, force: true })
        }
    })

    it('blooms to the last row and column of a frame whose size is not a multiple of the bloom layers', async () => {
        const compiled = await compileFilm(film({ bloom: 0.6 }, (s) => {
            s.add(circle(200, { stroke: 'yellow', width: 10 }))
            s.wait(1)
        }))
        const pool = new RasterPool(1)
        try {
            const frame = await compiled.frame(0.5)
            // The page is (11, 12, 16), and light only adds to it, so no pixel is black. At these sizes the
            // layers of the bloom are a few pixels smaller than the frame, at its bottom or at its right.
            for (const [width, height] of [[1000, 563], [1283, 722], [2560, 1440]] as const) {
                const pixels = await pool.run(framesToJob([frame], width, () => [11, 12, 16] as const, height))
                let black = 0
                for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0) black++
                expect([width, height, black]).toEqual([width, height, 0])
            }
        } finally {
            await pool.close()
        }
    })

    it('reports a failed frame without hanging', async () => {
        const pool = new RasterPool(1)
        try {
            await expect(pool.run({ svgs: ['<not svg>'], width: 16, height: 16, bloom: 0, background: [0, 0, 0] })).rejects.toThrow(/rasterization failed/)
        } finally {
            await pool.close()
        }
    })
})
