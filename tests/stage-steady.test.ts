import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    barChart, boundary, circle, compileFilm, connector, dynamic, film, frameToSvg, linear, rect, ringBuffer, scatter, scene3d, seq, shift, sphere,
    spotlight, surface, tagTrack, text, to, trail3d, typewriter, type CompiledFilm, type FilmDefinition, type Frame,
} from '../src/stage/index'
import { renderFilmVideo } from '../src/stage/export'
import { drawNow, type Node } from '../src/stage/node'
import { onExportStats, type ExportStats } from '../src/stage/raster'
import { STEADY, Track, clock } from '../src/stage/track'

/** The time before which the film proves that a frame stays as it is. */
const steadyTime = (frame: Frame) => (frame as unknown as Record<symbol, number>)[STEADY]!
const steadyAt = (compiled: CompiledFilm, time: number) => steadyTime(compiled.frame(time))

/**
 * Walk a film as the export does, and return the frames that the export would not draw. Each of them is
 * drawn here, and it must be equal to the last frame that the export did draw.
 */
function undrawn(compiled: CompiledFilm, fps: number, subframes = 1): number[] {
    const out: number[] = []
    let drawn: { svgs: string[]; steady: number[] } | null = null
    for (let index = 0; index < Math.round(compiled.duration * fps); index++) {
        const times = Array.from({ length: subframes }, (_, sub) => index / fps + (sub / subframes) * 0.5 / fps)
        const frames = times.map((time) => compiled.frame(time))
        const svgs = frames.map((frame) => frameToSvg(frame))
        const kept = drawn
        if (kept && times.every((time, sub) => time < kept.steady[sub]!)) {
            expect([index, svgs.map((svg, sub) => svg === kept.svgs[sub])]).toEqual([index, svgs.map(() => true)])
            out.push(index)
        } else {
            drawn = { svgs, steady: frames.map(steadyTime) }
        }
    }
    return out
}

/** The steady time that the drawing of one node leaves, when it runs alone for a frame at a time. */
function steadyOfDrawing(node: Node, time: number): number {
    const saved = { ...clock }
    Object.assign(clock, { mode: 'render', now: time, at: time, steady: Infinity })
    try {
        drawNow(node)
        return clock.steady
    } finally {
        Object.assign(clock, saved)
    }
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const ascending = (values: number[]) => [...values].sort((a, b) => a - b)
const small = { width: 320, height: 180, fps: 10 }
const mark = () => circle(20, { fill: 'blue' })

describe('the time before which a frame stays the same', () => {
    it('ends where an updater starts, and there is none while the updater runs', async () => {
        const compiled = await compileFilm(film(small, (s) => {
            const dot = s.add(mark())
            s.update(dot, (node, time) => { node.at(time * 100, 0) }, { from: 1, to: 2 })
            s.wait(3)
        }))
        expect(steadyAt(compiled, 0.5)).toBe(1)
        expect(steadyAt(compiled, 1.5)).toBe(-Infinity)
        expect(steadyAt(compiled, 2.5)).toBe(Infinity)
        expect(undrawn(compiled, 10)).toEqual([...range(1, 9), ...range(22, 29)])
    })

    it('follows the values that a dynamic drawing reads', async () => {
        const compiled = await compileFilm(film(small, (s) => {
            const value = s.value(0)
            s.add(dynamic(() => mark().at(value.value * 100, 0)))
            s.wait(1)
            s.play(value.to(1), { duration: 1, ease: linear })
            s.wait(1)
        }))
        expect(steadyAt(compiled, 0.5)).toBe(1)
        expect(steadyAt(compiled, 1.5)).toBe(-Infinity)
        expect(steadyAt(compiled, 2.5)).toBe(Infinity)
        expect(undrawn(compiled, 10)).toEqual([...range(1, 9), ...range(21, 29)])
    })

    it.each(['group', 'neighbors'] as const)('redraws when a hidden scatter changes its %s', async (query) => {
        const compiled = await compileFilm(film(small, (s) => {
            const chart = s.add(scatter([{ x: 0, y: 0 }, { x: 1, y: 1 }], { groups: { selected: 'blue' } }).opacity(0))
            s.add(dynamic(() => {
                const selected = query === 'group' ? chart.groupOf(0) === 'selected' : chart.neighbors.includes(1)
                return mark().at(selected ? 50 : 0, 0)
            }))
            s.wait(1)
            s.play(query === 'group' ? chart.assign(0, 'selected') : chart.nearest(0, 1), { duration: 0 })
            s.wait(1)
        }))
        expect(frameToSvg(compiled.frame(0))).not.toBe(frameToSvg(compiled.frame(1)))
        expect(undrawn(compiled, 10)).not.toContain(10)
    })

    it('redraws a chart clone whose readout uses the frame time', async () => {
        const compiled = await compileFilm(film(small, (s) => {
            const chart = barChart([{ label: 'A', value: 1 }], { max: 1, ticks: 1 })
            chart.readouts[0]!.draw = (time) => mark().at(time * 100, 0)
            s.add(dynamic(() => chart.clone()))
            s.wait(1)
        }))
        expect(frameToSvg(compiled.frame(0))).not.toBe(frameToSvg(compiled.frame(0.5)))
        expect(undrawn(compiled, 10)).toEqual([])
    })

    it.each([
        ['a parameter', dynamic((time) => mark().at(time * 100, 0))],
        ['a parameter with a default', dynamic((time = 0) => mark().at(time * 100, 0))],
        ['a rest parameter', dynamic((...all: number[]) => mark().at(all[0]! * 100, 0))],
        // eslint-disable-next-line prefer-rest-params
        ['the arguments object', dynamic(function () { return mark().at((arguments[0] as number) * 100, 0) })],
        // A bound function has no parameter in its length, and its text is not its own.
        // eslint-disable-next-line prefer-rest-params
        ['a bound function', dynamic((function () { return mark().at((arguments[0] as number) * 100, 0) }).bind(null))],
    ])('has none while a dynamic drawing takes the time through %s', async (_name, drawing) => {
        const compiled = await compileFilm(film(small, (s) => {
            s.add(drawing)
            s.wait(1)
        }))
        expect(steadyAt(compiled, 0.5)).toBe(-Infinity)
        expect(undrawn(compiled, 10)).toEqual([])
    })

    it('has none when a drawing reads a value at another time than the time of the frame', async () => {
        const compiled = await compileFilm(film(small, (s) => {
            const value = s.value(0)
            // A drawing of the library can read the past, as a trace does. The clock is not public.
            s.add(dynamic(() => {
                const now = clock.now
                clock.now = Math.max(0, now - 0.5)
                const x = value.value * 100
                clock.now = now
                return mark().at(x, 0)
            }))
            s.play(value.to(1), { duration: 1, ease: linear })
            s.wait(1)
        }))
        // At 1.2 s the value is at rest, and the drawing still shows its move of half a second before.
        expect(steadyAt(compiled, 1.2)).toBe(-Infinity)
        expect(undrawn(compiled, 10)).toEqual([])
    })

    it('has none in a frame that draws a frame of another film', async () => {
        const other = await compileFilm(film(small, (s) => { s.add(mark()); s.wait(1) }))
        const compiled = await compileFilm(film(small, (s) => {
            s.add(dynamic(() => { other.frame(0.25); return mark() }))
            s.wait(1)
        }))
        expect(steadyAt(compiled, 0.5)).toBe(-Infinity)
        // The other film is still proven on its own.
        expect(steadyAt(other, 0.5)).toBe(Infinity)
    })

    it('ends at a move of the camera', async () => {
        const compiled = await compileFilm(film(small, (s) => {
            s.add(mark())
            s.wait(1)
            s.play(to(s.camera, (camera) => camera.set('x', 100)), { duration: 1, ease: linear })
            s.wait(1)
        }))
        expect(steadyAt(compiled, 0.5)).toBe(1)
        expect(steadyAt(compiled, 1.5)).toBe(-Infinity)
        expect(undrawn(compiled, 10)).toEqual([...range(1, 9), ...range(21, 29)])
    })

    it('ends at a light', async () => {
        const compiled = await compileFilm(film(small, (s) => {
            const lit = s.add(mark().at(-60, 0))
            s.add(rect(40, 40, { fill: 'green' }).at(60, 0))
            s.wait(1)
            s.play(spotlight(lit, { duration: 0.5 }))
            s.wait(1)
        }))
        expect(steadyAt(compiled, 0.5)).toBe(1)
        expect(steadyAt(compiled, 1.2)).toBe(-Infinity)
        expect(undrawn(compiled, 10)).toEqual([...range(1, 9), ...range(16, 24)])
    })

    it('ends where a node enters with no animation', async () => {
        const compiled = await compileFilm(film(small, (s) => {
            s.add(mark().at(-60, 0))
            s.wait(1)
            s.add(rect(40, 40, { fill: 'green' }).at(60, 0))
            s.wait(1)
        }))
        expect(steadyAt(compiled, 0.5)).toBe(1)
        expect(undrawn(compiled, 10)).toEqual([...range(1, 9), ...range(11, 19)])
    })

    it('ends at each letter of a typewriter', async () => {
        const compiled = await compileFilm(film({ ...small, fps: 20 }, (s) => {
            const label = text('abcdefghij', { size: 40 })
            s.wait(1)
            s.play(typewriter(label), { duration: 1, ease: linear })
            s.wait(1)
        }))
        // Ten letters in one second: the second letter comes at 1.1 s.
        expect(steadyAt(compiled, 1.02)).toBeCloseTo(1.1, 9)
        const frames = undrawn(compiled, 20)
        // Each letter makes one new frame, and the frame after it is not drawn.
        expect(frames).toEqual([...range(1, 19), ...range(0, 9).map((letter) => 21 + letter * 2), ...range(40, 59)])
    })

    it('ends at a spin of a 3D scene, and there is none while a surface moves with the time', async () => {
        const compiled = await compileFilm(film(small, (s) => {
            const scene = s.add(scene3d({ perspective: false }))
            scene.add(sphere(1.5))
            s.wait(1)
            scene.spin(0.5)
            s.wait(1)
            scene.stopSpin()
            s.wait(1)
        }))
        expect(steadyAt(compiled, 0.5)).toBe(1)
        expect(steadyAt(compiled, 1.5)).toBe(-Infinity)
        expect(steadyAt(compiled, 2.5)).toBe(Infinity)
        expect(undrawn(compiled, 10)).toEqual([...range(1, 9), ...range(21, 29)])
        const moving = await compileFilm(film(small, (s) => {
            s.add(scene3d({ perspective: false })).add(surface((x, y, time) => Math.sin(x + time) * Math.cos(y), { animate: true, resolution: [8, 8] }))
            s.wait(1)
        }))
        expect(steadyAt(moving, 0.5)).toBe(-Infinity)
        expect(undrawn(moving, 10)).toEqual([])
    })

    it('ends where a 3D trace starts, and there is none while the trace grows', async () => {
        const compiled = await compileFilm(film(small, (s) => {
            const along = s.value(0)
            s.add(scene3d({ perspective: false })).add(trail3d(() => [along.value, 0, 0], 1, 2))
            s.wait(1)
            s.play(along.to(2), { duration: 1, ease: linear })
            s.wait(1)
        }))
        expect(steadyAt(compiled, 0.5)).toBe(1)
        expect(steadyAt(compiled, 1.5)).toBe(-Infinity)
        // After its end the trace is whole, and it reads the points that it kept.
        expect(undrawn(compiled, 10)).toEqual([...range(1, 9), ...range(21, 29)])
    })

    it('ends at a pulse of a connector, and there is none while a connector flows', async () => {
        const build = (flow?: number) => compileFilm(film(small, (s) => {
            const a = s.add(rect(40, 40, { fill: 'blue' }).at(-100, 0)), b = s.add(rect(40, 40, { fill: 'green' }).at(100, 0))
            const wire = s.add(connector(a, b, flow ? { flow, dash: [6, 6] } : {}))
            s.wait(1)
            s.play(wire.pulse({ duration: 0.5 }))
            s.wait(1)
        }))
        const pulsed = await build()
        expect(steadyAt(pulsed, 0.5)).toBe(1)
        expect(steadyAt(pulsed, 1.2)).toBe(-Infinity)
        expect(steadyAt(pulsed, 2)).toBe(Infinity)
        expect(undrawn(pulsed, 10)).toEqual([...range(1, 9), ...range(16, 24)])
        const flowing = await build(40)
        expect(steadyAt(flowing, 0.5)).toBe(-Infinity)
        expect(undrawn(flowing, 10)).toEqual([])
    })

    it('ends at each fade of a tag track', async () => {
        const compiled = await compileFilm(film(small, (s) => {
            s.add(tagTrack([{ at: 1, word: 'ONE' }, { at: 2, word: 'TWO' }], { until: 3, fadeIn: 0.25, fadeOut: 0.2 }))
            s.wait(4)
        }))
        expect(steadyAt(compiled, 0.5)).toBe(1)
        expect(steadyAt(compiled, 1.1)).toBe(-Infinity)
        expect(steadyAt(compiled, 1.5)).toBe(1.8)
        expect(steadyAt(compiled, 1.9)).toBe(-Infinity)
        expect(steadyAt(compiled, 3.5)).toBe(Infinity)
        undrawn(compiled, 20)
    })

    it('ends at the end of a key that rests, also when the key names no change', () => {
        const track = new Track(0)
        track.add({ t0: 0, t1: 1, ease: null, to: 2, at: () => 1, until: () => Infinity })
        const saved = { ...clock }
        Object.assign(clock, { at: 0.5, steady: Infinity })
        try {
            // After its end a key gives `to`, which can be another value than its last one.
            expect(track.sample(0.5)).toBe(1)
            expect(clock.steady).toBe(1)
        } finally {
            Object.assign(clock, saved)
        }
    })

    it('holds for the pointers and the names of a ring buffer, between its moves', async () => {
        let ring!: ReturnType<typeof ringBuffer>
        const compiled = await compileFilm(film({ width: 800, height: 600, fps: 20 }, (s) => {
            ring = s.add(ringBuffer(8, { radius: 160, thickness: 50, counts: true }))
            s.wait(1)
            s.play(seq(ring.push(), ring.push()), { duration: 1, ease: linear })
            s.wait(0.5)
            s.play(ring.pop(), { duration: 0.5, ease: linear })
            s.wait(1)
        }))
        const frames = undrawn(compiled, 20)
        // Before the first move, between the two plays, and after the last move.
        expect(frames).toEqual(expect.arrayContaining([...range(1, 19), ...range(42, 49), ...range(62, 79)]))
        expect(frames.some((index) => index >= 21 && index <= 39)).toBe(false)
        // A push fills its slot, and then its pointer moves. The tail moves from 1.225 s to 1.5 s and from
        // 1.725 s to 2 s, and the head from 2.725 s to 3 s. Each pointer has one key for all of its moves, and
        // a name that is drawn for each frame. In a film other marks move with a pointer, so ask each alone.
        const names = ring.all().filter((node) => node.draw !== null)
        const keys = ring.all().flatMap((node) => [...(node.tracks?.values() ?? [])]).flatMap((track) => track.keys).filter((key) => key.until)
        expect([names.length, keys.length]).toEqual([2, 6])
        const ofNames = (time: number) => ascending(names.map((name) => steadyOfDrawing(name, time)))
        const ofKeys = (time: number) => ascending([...new Set(keys.map((key) => key.until!(time)))])
        const close = (values: number[]) => values.map((value) => Number.isFinite(value) ? expect.closeTo(value, 9) : value)
        for (const [time, expected] of [
            [0.5, [1.225, 2.725]], [1.3, [-Infinity, 2.725]], [1.6, [1.725, 2.725]], [1.8, [-Infinity, 2.725]],
            [2.2, [2.725, Infinity]], [2.8, [-Infinity, Infinity]], [3.5, [Infinity, Infinity]],
        ] as const) {
            expect([time, ofNames(time)]).toEqual([time, close([...expected])])
            expect([time, ofKeys(time)]).toEqual([time, close([...new Set(expected)])])
        }
    })

    it('holds for the tally of a boundary, which looks before and after its changes', async () => {
        let wall!: ReturnType<typeof boundary>
        const compiled = await compileFilm(film({ width: 1200, height: 400, fps: 20 }, (s) => {
            wall = s.add(boundary({ width: 1000, label: 'line', tally: ['call', 'calls'] }))
            s.wait(1)
            s.play(wall.cross(0), { duration: 0.5 })
            s.wait(1.5)
            s.play(wall.cross(40), wall.cross(80), { duration: 0.5 })
            s.wait(2)
        }))
        const frames = undrawn(compiled, 20)
        expect(frames.length).toBeGreaterThan(20)
        expect(frames).toEqual(expect.arrayContaining(range(100, 109)))
        // The tally changes at 1.25 s and at 3.25 s, when a mark is on the line. Its word looks half a second
        // each way. The number and the word are drawn for each frame: ask each alone.
        const parts = wall.all().filter((node) => node.draw !== null)
        expect(parts).toHaveLength(2)
        for (const [time, expected] of [
            [0.6, 0.75], [0.9, -Infinity], [1.2, -Infinity], [1.6, -Infinity], [1.9, 2.75], [2.9, -Infinity], [3.6, -Infinity], [4, Infinity],
        ] as const) {
            const each = Number.isFinite(expected) ? expect.closeTo(expected, 6) : expected
            expect([time, parts.map((part) => steadyOfDrawing(part, time))]).toEqual([time, [each, each]])
        }
    })
})

describe('an export that does not draw a steady frame', () => {
    let directory: string
    let stats: ExportStats | undefined
    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), 'vizmatic-steady-'))
        // A stand-in for FFmpeg: it copies its input to its last argument, which is the output path.
        await writeFile(join(directory, 'copy.sh'), '#!/bin/sh\nfor last; do :; done\nexec cat > "$last"\n', { mode: 0o755 })
        onExportStats((value) => { stats = value })
    })
    afterAll(async () => {
        onExportStats(undefined)
        await rm(directory, { recursive: true, force: true })
    })
    afterEach(() => { delete process.env.VIZMATIC_VERIFY_STEADY })

    /** Render with the test switch, which draws every frame, and without it. The two give the same bytes and the same counts. */
    async function renderBoth(definition: FilmDefinition, motionBlur: number): Promise<{ skipped: number; drawn: number }> {
        const compiled = await compileFilm(definition)
        const options = { workers: 2, motionBlur, ffmpegPath: join(directory, 'copy.sh') }
        process.env.VIZMATIC_VERIFY_STEADY = '1'
        const checked = await renderFilmVideo(compiled, join(directory, 'checked.raw'), options)
        const whole = stats!
        delete process.env.VIZMATIC_VERIFY_STEADY
        const quick = await renderFilmVideo(compiled, join(directory, 'quick.raw'), options)
        const fast = stats!
        expect(Buffer.compare(await readFile(quick.outputPath), await readFile(checked.outputPath))).toBe(0)
        expect(fast.skipped).toBe(whole.skipped)
        expect(fast.computed).toBe(whole.computed)
        return { skipped: fast.skipped, drawn: quick.frameCount - fast.skipped }
    }

    const moves = (start: number, length: number) => film(small, (s) => {
        const dot = s.add(mark())
        s.wait(start)
        s.play(shift(dot, 100, 0), { duration: length, ease: linear })
        s.wait(2 - start - length)
    })

    it.skipIf(process.platform === 'win32')('skips each frame of a still stretch, and draws the frames of a move', async () => {
        // A move from 0.5 s to 1 s, at 10 frames a second: frames 5 to 10 are new, and frame 11 is the first to repeat.
        expect(await renderBoth(moves(0.5, 0.5), 1)).toEqual({ skipped: 4 + 9, drawn: 7 })
    })

    it.skipIf(process.platform === 'win32')('draws a frame whose last shutter sample is in a move', async () => {
        // The move starts at 1.03 s. Frame 10 opens its shutter at 1 s, and its last sample is at 1.0375 s.
        const result = await renderBoth(moves(1.03, 0.47), 4)
        // Frames 1 to 9 are steady. Frame 10 is not, though its first three samples are.
        expect(result.skipped).toBe(9 + 4)
        const compiled = await compileFilm(moves(1.03, 0.47))
        expect(undrawn(compiled, 10, 4)).toEqual([...range(1, 9), ...range(16, 19)])
    })

    it.skipIf(process.platform === 'win32')('draws the first frame of a still stretch that begins inside the frame before', async () => {
        // The move ends at 1.03 s, inside the shutter of frame 10. Frame 11 is still, and it is not frame 10.
        const compiled = await compileFilm(moves(0.5, 0.53))
        expect(undrawn(compiled, 10, 4)).toEqual([...range(1, 4), ...range(12, 19)])
        expect(await renderBoth(moves(0.5, 0.53), 4)).toEqual({ skipped: 4 + 8, drawn: 8 })
    })

    it.skipIf(process.platform === 'win32')('fails with the test switch when a film says that a frame is steady and it is not', async () => {
        // A film that gives a wrong steady time: its picture moves, and each frame says that it stays for ever.
        const compiled = await compileFilm(moves(0.5, 0.5))
        const wrong = Object.create(compiled, {
            frame: { value: (time: number) => Object.defineProperty({ ...compiled.frame(time) }, STEADY, { value: Infinity }) },
        }) as CompiledFilm
        process.env.VIZMATIC_VERIFY_STEADY = '1'
        await expect(renderFilmVideo(wrong, join(directory, 'wrong.raw'), { workers: 2, ffmpegPath: join(directory, 'copy.sh') }))
            .rejects.toThrow(/differs from the frame before it/)
    })
})
