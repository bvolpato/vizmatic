import { transform } from 'sucrase'
import { describe, expect, it } from 'vitest'
import * as stage from '../src/stage/index'
import { compileFilm, frameToSvg, isFilm, type CompiledFilm, type FilmDefinition } from '../src/stage/index'
import { projectToSource } from '../src/studio/codegen'
import { compileProject, hiddenAtStart } from '../src/studio/compile'
import { BEATS, naturalEntrance } from '../src/studio/beats'
import { defaultProps, KINDS, PALETTE } from '../src/studio/catalog'
import { emptyProject, projectDuration, VALUE_TRACK, type Beat, type StudioObject, type StudioProject } from '../src/studio/model'

function object(id: string, kind: string, overrides: Partial<StudioObject> & { props?: Record<string, string | number | boolean | null> } = {}): StudioObject {
    const { props, ...rest } = overrides
    return { id, kind, name: id, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, hidden: false, locked: false, props: defaultProps(kind, props), ...rest }
}

function beat(id: string, target: string, kind: string, start: number, duration: number, params: Beat['params'] = {}, ease = 'smooth'): Beat {
    return { id, target, kind, start, duration, ease, params }
}

function sample(): StudioProject {
    return {
        ...emptyProject('Sample film'),
        fps: 30,
        variables: [{ name: 'a', value: 1 }],
        objects: [
            object('grid', 'plane', { props: { unit: 160, color: 'blue' } }),
            object('curve', 'graph', { x: -200, y: 60, props: { expr: 'a * sin(2x)', plotWidth: 800, plotHeight: 360 } }),
            object('title', 'text', { y: -420, props: { content: "It's a title", font: 'serif', size: 80 } }),
            object('eq', 'tex', { x: 560, y: -160, props: { source: 'a^2 + b^2 = c^2' } }),
            object('eq2', 'tex', { x: 560, y: -160, props: { source: 'c = \\sqrt{a^2 + b^2}' } }),
            object('box', 'rect', { x: 400, y: 300, rotation: 15, scale: 1.2, opacity: 0.8, props: { radius: 18, fill: 'surface', stroke: 'teal', dash: 'dashed' } }),
            object('pointer', 'arrow', { x: 300, y: -300, props: { stroke: 'yellow', bend: 40 } }),
            object('read', 'readout', { x: 700, y: 200, props: { expr: '2 * a', prefix: 'v = ' } }),
        ],
        beats: [
            beat('b1', 'title', 'write', 0, 1.2),
            beat('b2', 'curve', 'draw', 0.4, 1.4, {}, 'easeOutCubic'),
            beat('b3', 'eq', 'fadeIn', 1, 0.8, { direction: 'up', distance: 40 }),
            beat('b4', 'eq', 'morph', 2.2, 1.2, { into: 'eq2', matching: true }),
            beat('b5', 'box', 'move', 2.4, 1, { x: 200, y: 280 }, 'overshoot'),
            beat('b6', 'box', 'recolor', 3.4, 0.6, { color: 'red' }),
            beat('b7', VALUE_TRACK, 'value', 2, 2.5, { variable: 'a', to: 1.8 }, 'linear'),
            beat('b8', 'pointer', 'indicate', 3, 0.9, { color: 'red', amount: 1.3 }),
            beat('b9', 'grid', 'applyMatrix', 3.5, 1.5, { a: 1, b: 0.5, c: 0, d: 1 }),
            beat('b10', 'title', 'fadeOut', 4.6, 0.6, { direction: 'none', distance: 20 }),
        ],
        markers: [{ id: 'm1', time: 2, title: 'Second part' }],
        hold: 0.5,
    }
}

async function runSource(source: string): Promise<CompiledFilm> {
    const { code } = transform(source, { transforms: ['typescript', 'imports'], production: true })
    const module = { exports: {} as { default?: FilmDefinition } }
    const require = (name: string) => {
        if (name === 'vizmatic/stage') return stage
        throw new Error(`Unexpected import: ${name}`)
    }
    new Function('require', 'exports', 'module', code)(require, module.exports, module)
    if (!isFilm(module.exports.default)) throw new Error('Generated source must export a film.')
    return compileFilm(module.exports.default)
}

describe('project to film', () => {
    it('sets the duration from the last beat plus the hold', async () => {
        const project = sample()
        const { film } = await compileProject(project)
        expect(projectDuration(project)).toBeCloseTo(5.7, 3)
        expect(film.duration).toBeCloseTo(5.7, 3)
        expect(film.chapters.map((chapter) => chapter.title)).toEqual(['Second part'])
    })

    it('keeps objects hidden until their entrance beat', async () => {
        const project = sample()
        expect([...hiddenAtStart(project)].sort()).toEqual(['curve', 'eq', 'eq2', 'title'])
        const { film, nodes } = await compileProject(project)
        film.frame(0)
        expect(nodes.get('grid')!.get('visible')).toBe(true)
        const inkNear = (time: number) => film.frame(time).ops.length
        expect(inkNear(0.8)).toBeGreaterThan(inkNear(0))
    })

    it('reports a broken object without losing the rest of the film', async () => {
        const project: StudioProject = {
            ...emptyProject('Bad'),
            objects: [
                object('ok', 'text', { props: { content: 'Fine' } }),
                object('bad', 'tex', { props: { source: '\\frac{' } }),
                object('badexpr', 'graph', { props: { expr: 'sin(' } }),
            ],
        }
        const { objectErrors, film } = await compileProject(project)
        expect(objectErrors.get('bad')).toMatch(/TeX/)
        expect(objectErrors.get('badexpr')).toMatch(/expression|Missing|ends/)
        expect(film.frame(0).ops.length).toBeGreaterThan(3)
    })

    it('reports a beat that names a missing target', async () => {
        const project: StudioProject = {
            ...emptyProject('Bad beat'),
            objects: [object('a', 'text')],
            beats: [beat('b', 'a', 'morph', 0, 1, { into: 'gone', matching: true })],
        }
        const { beatErrors } = await compileProject(project)
        expect(beatErrors.get('b')).toMatch(/morph/)
    })
})

describe('catalog', () => {
    it('gives every palette entry a kind, and every beat a real definition', () => {
        for (const entry of PALETTE) expect(KINDS[entry.kind], entry.id).toBeDefined()
        for (const kind of Object.keys(KINDS)) expect(BEATS[naturalEntrance(kind)], kind).toBeDefined()
    })
})

describe('generated source', () => {
    it('renders the same frames as the live project', async () => {
        const project = sample()
        const live = await compileProject(project)
        const generated = await runSource(projectToSource(project))
        expect(generated.duration).toBeCloseTo(live.film.duration, 6)
        for (const time of [0, 0.5, 1.1, 2.6, 3.2, 3.9, 4.4, 5.2, live.film.duration]) {
            expect(frameToSvg(generated.frame(time)), `frame at ${time}`).toBe(frameToSvg(live.film.frame(time)))
        }
    })

    it.each(Object.keys(KINDS))('matches the live film for %s', async (kind) => {
        const project: StudioProject = {
            ...emptyProject(`Kind ${kind}`), fps: 24, hold: 0.25,
            objects: [object('item', kind, { x: 120, y: -80 })],
            beats: [beat('in', 'item', naturalEntrance(kind), 0.2, 0.8)],
        }
        const live = await compileProject(project)
        expect(live.objectErrors.get('item')).toBeUndefined()
        expect(live.beatErrors.get('in')).toBeUndefined()
        const generated = await runSource(projectToSource(project))
        for (const time of [0.1, 0.6, 1.0, 1.25]) {
            expect(frameToSvg(generated.frame(time)), `frame at ${time}`).toBe(frameToSvg(live.film.frame(time)))
        }
    })

    it('covers beats that only some kinds offer', async () => {
        const project: StudioProject = {
            ...emptyProject('Special beats'), fps: 24, hold: 0.2,
            objects: [
                object('bars', 'bars'),
                object('net', 'neural', { x: 400 }),
                object('spin', 'surface3d', { x: -500 }),
                object('src', 'code', { y: 300 }),
                object('src2', 'code', { y: 300, props: { source: 'function area(r: number) {\n    return 3.14 * r * r\n}' } }),
            ],
            beats: [
                beat('a', 'bars', 'update', 0, 0.6, { data: '10 20 30 40' }),
                beat('b', 'net', 'forward', 0, 0.8, { color: 'red' }),
                beat('c', 'spin', 'orbit', 0, 0.6, { theta: 10, phi: 40 }),
                beat('d', 'src', 'focus', 0, 0.3, { lines: '2' }),
                beat('e', 'src', 'morph', 0.4, 0.4, { into: 'src2', matching: true }),
            ],
        }
        const live = await compileProject(project)
        expect([...live.beatErrors]).toEqual([])
        const generated = await runSource(projectToSource(project))
        for (const time of [0.25, 0.5, 0.75, 1]) {
            expect(frameToSvg(generated.frame(time)), `frame at ${time}`).toBe(frameToSvg(live.film.frame(time)))
        }
    })

    it('escapes text so it cannot break out of a string', async () => {
        const project: StudioProject = {
            ...emptyProject("A 'quoted' \\ name"),
            objects: [object('hello', 'text', { name: "weird name' + alert(1) + '", props: { content: "x'); throw new Error('no'); ('\nline two" } })],
        }
        const film = await runSource(projectToSource(project))
        expect(film.frame(0).ops.length).toBeGreaterThan(0)
    })

    it('imports only what it uses', () => {
        const source = projectToSource({ ...emptyProject('Small'), objects: [object('t', 'text')], beats: [beat('b', 't', 'write', 0, 1)] })
        const head = source.slice(0, source.indexOf("from 'vizmatic/stage'"))
        expect(head).toContain('write')
        expect(head).not.toContain('morph')
        expect(head).not.toContain('axes')
    })
})
