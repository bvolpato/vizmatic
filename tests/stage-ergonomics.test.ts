import { describe, expect, it } from 'vitest'
import {
    breathe, checkFilm, circle, compileFilm, connector, crossfade, dot, film, float, flowStream,
    metricTile, namedBox, orbit, place, popIn, popOut, row, sceneArea, slideIn, slideOut, stagger, titleCard,
} from '../src/stage/index'
import { FILM_TEMPLATES } from '../src/stage/templates'

describe('effortless animation and storytelling ergonomics', () => {
    it('staggers spring popIn/popOut and directional slideIn/slideOut cleanly', async () => {
        const compiled = await compileFilm(film({ fps: 30 }, (s) => {
            const dots = [dot(20, 'blue').at(-200, 0), dot(20, 'teal').at(0, 0), dot(20, 'yellow').at(200, 0)]
            s.stagger(dots, (d) => popIn(d, { duration: 0.4 }), { lag: 0.25 })
            s.wait(0.2)
            s.play(slideOut(dots[0]!, { to: 'left', distance: 60, duration: 0.4 }), popOut(dots[1]!, { duration: 0.4 }))
            s.play(slideIn(dots[0]!, { from: 'right', distance: 60, duration: 0.4 }))
        }))
        expect(compiled.duration).toBeGreaterThan(1.3)
        expect(compiled.frame(0.05).ops.length).toBeGreaterThan(0)
        expect(compiled.frame(0.65).ops.length).toBe(3)
        expect(compiled.frame(compiled.duration - 0.05).ops.length).toBeGreaterThanOrEqual(2)
    })

    it('supports seamless float, breathe, orbit, crossfade, and flowStream', async () => {
        let orbiterStartY = 0
        let orbiterMidX = 0
        let orbiterEndY = 0
        const compiled = await compileFilm(film({ fps: 30 }, (s) => {
            const a = s.add(namedBox('Source', { width: 220, height: 90, color: 'blue' }).at(-260, 0))
            const b = s.add(namedBox('Sink', { width: 220, height: 90, color: 'teal' }).at(260, 0))
            const link = s.add(connector(a, b))
            const sat = s.add(circle(18, { fill: 'yellow' }).at(100, 0))
            s.play(
                float(a, { amplitude: 16, cycles: 1, duration: 1.0 }),
                breathe(b, { scale: 1.08, cycles: 1, duration: 1.0 }),
                orbit(sat, [0, 0], { angle: Math.PI, duration: 1.0 }),
                flowStream(link, { count: 3, color: 'teal', duration: 0.6 }),
            )
            const next = namedBox('Next Act', { width: 280, height: 100, color: 'yellow' }).at(0, 0)
            s.play(crossfade([a, b, link, sat], next, { duration: 0.8, shift: [0, -20] }))
            s.wait(0.2)
            // Capture coordinates directly from tracks after scheduling.
            orbiterStartY = sat.track('y').sample(0)
            orbiterMidX = sat.track('x').sample(1.0)
            orbiterEndY = sat.track('y').sample(1.0)
        }))
        expect(orbiterStartY).toBeCloseTo(0, 5)
        // Rotating (100, 0) by pi around (0, 0) moves x by -200 to (-100, 0).
        expect(orbiterMidX).toBeCloseTo(-100, 3)
        expect(orbiterEndY).toBeCloseTo(0, 3)
        expect(compiled.frame(0.5).ops.length).toBeGreaterThan(4)
        expect(compiled.frame(compiled.duration - 0.05).ops.length).toBeGreaterThan(0)
    })

    it('provides fluent Stage camera focus, resetView, and clear({ keep })', async () => {
        let keptVisibleAfterClear = false
        let clearedVisibleAfterClear = true
        const compiled = await compileFilm(film({ fps: 30 }, (s) => {
            const header = s.add(namedBox('Header', { width: 280, height: 70, color: 'blue' }).at(0, -340))
            const hero = s.add(namedBox('Hero', { width: 320, height: 140, color: 'teal' }).at(240, 40))
            s.focus(hero, { zoom: 1.8, duration: 0.5 })
            s.resetView({ duration: 0.5 })
            s.clear({ keep: header, duration: 0.4 })
            s.wait(0.1)
            keptVisibleAfterClear = header.track('visible').sample(1.45)
            clearedVisibleAfterClear = hero.track('visible').sample(1.45)
        }))
        expect(keptVisibleAfterClear).toBe(true)
        expect(clearedVisibleAfterClear).toBe(false)
        expect(compiled.stage.camera.track('sx').sample(0.5)).toBeCloseTo(1.8, 3)
        expect(compiled.stage.camera.track('sx').sample(1.0)).toBeCloseTo(1, 3)
    })

    it('builds and animates titleCard and metricTile with zero film-check issues', async () => {
        const compiled = await compileFilm(film({ title: 'Ergonomics Check', fps: 30 }, (s) => {
            const card = titleCard('Effortless Motion', {
                eyebrow: 'Vizmatic',
                subtitle: 'One call for title cards and animated metrics',
                accent: 'teal',
            })
            s.play(card.enter({ duration: 0.8 }))
            s.wait(0.5)
            s.play(card.exit({ duration: 0.4 }))

            const tiles = [
                metricTile({ label: 'Speedup', value: 3.2, digits: 1, suffix: 'x', delta: 'Apple VideoToolbox', color: 'teal' }),
                metricTile({ label: 'Frame Rate', value: 60, suffix: ' fps', delta: 'Direct WebGL2', color: 'yellow' }),
            ]
            place(row(tiles, { gap: 80 }), sceneArea())
            s.play(stagger(tiles, (t) => t.enter({ duration: 0.7 }), { lag: 0.2 }))
            s.play(tiles[0]!.countTo(4.5, { duration: 0.5 }))
            s.wait(0.5)
        }))
        const report = await checkFilm(compiled)
        expect(report.ok, JSON.stringify(report.diagnostics)).toBe(true)
        expect(report.diagnostics).toEqual([])
    })

    it('includes the story starter template in FILM_TEMPLATES', () => {
        const story = FILM_TEMPLATES.find((entry) => entry.name === 'story')
        expect(story?.source).toContain('titleCard(')
        expect(story?.source).toContain('metricTile(')
        expect(story?.source).toContain('flowStream(')
    })
})
