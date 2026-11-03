import { describe, expect, it } from 'vitest'
import { exprProblem, parseExpr } from '../src/studio/expr'
import { parseInfoRows, parseLabeled, parseNetwork, parseNumbers, parseRows } from '../src/studio/catalog'
import { emptyProject, laneOf, projectDuration, VALUE_TRACK, type Beat } from '../src/studio/model'
import { decodeShare, encodeShare, normalizeProject } from '../src/studio/project'
import { TEMPLATES } from '../src/studio/templates'
import { compileProject } from '../src/studio/compile'
import { Store } from '../src/studio/store'

describe('expressions', () => {
    const run = (source: string, env: Record<string, number> = {}) => parseExpr(source, Object.keys(env)).run(env)

    it('follows math precedence', () => {
        expect(run('1 + 2 * 3')).toBe(7)
        expect(run('2 ^ 3 ^ 2')).toBe(512)
        expect(run('-2 ^ 2')).toBe(-4)
        expect(run('2x + 1', { x: 3 })).toBe(7)
        expect(run('(x + 1)(x - 1)', { x: 3 })).toBe(8)
        expect(run('3 sin(0) + cos(0)')).toBe(1)
        expect(run('2pi')).toBeCloseTo(Math.PI * 2)
    })

    it('writes the same math as JavaScript', () => {
        const samples = ['a * sin(2x)', '-x ^ 2 + 1', '(x + 1) / (x - 1)', 'x - (x - 1)', '2 ^ -x', 'max(x, 1, 2) % 3', 'sqrt(x) + e + tau + pi']
        for (const source of samples) {
            const expr = parseExpr(source, ['x', 'a'])
            const fn = new Function('x', 'a', `return ${expr.js()}`) as (x: number, a: number) => number
            for (const x of [0.5, 2.25, 7]) expect(fn(x, 3), `${source} at ${x}`).toBeCloseTo(expr.run({ x, a: 3 }), 9)
        }
    })

    it('rejects anything outside the small language', () => {
        for (const bad of ['constructor', 'x.constructor', 'alert(1)', 'sin', 'sin(', '1 +', '__proto__', 'this', 'x;y', '`x`', "x['a']", 'hasOwnProperty(x)']) {
            expect(exprProblem(bad, ['x']), bad).not.toBeNull()
        }
        expect(exprProblem('sin(x)', ['x'])).toBeNull()
    })
})

describe('text data', () => {
    it('reads rows, numbers, and labels', () => {
        expect(parseRows('1 2; 3 4')).toEqual([['1', '2'], ['3', '4']])
        expect(parseNumbers('1, 2 x 3')).toEqual([1, 2, 3])
        expect(parseLabeled('Q1: 42\nQ2: 58: yellow\nnope')).toEqual([{ label: 'Q1', value: 42 }, { label: 'Q2', value: 58, color: 'yellow' }])
        expect(parseInfoRows('Latency: 428 ms\nHealthy')).toEqual([{ label: 'Latency', value: '428 ms' }, { label: 'Healthy' }])
    })

    it('reads edges and collects their nodes', () => {
        const { nodes, edges } = parseNetwork('A -> B: first\nB -> C -> D\nLone')
        expect(nodes.map((node) => node.id)).toEqual(['A', 'B', 'C', 'D', 'Lone'])
        expect(edges).toEqual([{ from: 'A', to: 'B', label: 'first' }, { from: 'B', to: 'C' }, { from: 'C', to: 'D' }])
    })
})

describe('normalizeProject', () => {
    it('drops unknown kinds, broken references, and hostile keys', () => {
        const hostile = JSON.parse(`{
            "name": "Bad", "look": "nope", "fps": 7777, "aspect": "2:9", "hold": -4,
            "objects": [
                {"id": "a", "kind": "text", "x": "12", "props": {"content": "Hi", "size": "huge", "__proto__": {"polluted": 1}, "extra": 3}},
                {"id": "a", "kind": "rect", "x": 1e99},
                {"id": "z", "kind": "evil"},
                "junk"
            ],
            "beats": [
                {"id": "b1", "target": "a", "kind": "write", "start": -3, "duration": 1e9},
                {"id": "b2", "target": "gone", "kind": "write"},
                {"id": "b3", "target": "a", "kind": "eval"},
                {"id": "b4", "target": "a", "kind": "morph", "params": {"into": "gone"}},
                {"id": "b5", "target": "@values", "kind": "value", "params": {"variable": "h", "to": 2}, "ease": "nope"}
            ],
            "variables": [{"name": "h", "value": 1}, {"name": "__proto__", "value": 1}, {"name": "x", "value": 1}, {"name": "h", "value": 2}],
            "loop": {"from": 5, "to": 1}
        }`)
        const project = normalizeProject(hostile)
        expect(project.look).toBe('midnight')
        expect(project.fps).toBe(60)
        expect(project.aspect).toBe('16:9')
        expect(project.hold).toBe(0)
        expect(project.objects.map((object) => object.kind)).toEqual(['text', 'rect'])
        expect(new Set(project.objects.map((object) => object.id)).size).toBe(2)
        expect(project.objects[0]!.x).toBe(0)
        expect(project.objects[0]!.props['size']).toBe(44)
        expect(project.objects[0]!.props['extra']).toBeUndefined()
        expect(project.objects[1]!.x).toBe(1e7)
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
        expect(project.beats.map((beat) => beat.id)).toEqual(['b1', 'b4', 'b5'])
        expect(project.beats[0]!.start).toBe(0)
        expect(project.beats[0]!.duration).toBe(3600)
        expect(project.beats[1]!.params['into']).toBe('')
        expect(project.beats[2]!.ease).toBe('smooth')
        expect(project.variables).toEqual([{ name: 'h', value: 1 }])
        expect(project.loop).toBeNull()
    })

    it('rejects input that is not a project', () => {
        expect(() => normalizeProject([])).toThrow(/not a Vizmatic project/)
        expect(() => normalizeProject('text')).toThrow(/not a Vizmatic project/)
    })
})

describe('share links', () => {
    it('round-trips every template', () => {
        for (const template of TEMPLATES) {
            const project = normalizeProject(template.project())
            expect(decodeShare(encodeShare(project))).toEqual(project)
        }
    })

    it('reports damage instead of throwing a raw error', () => {
        expect(() => decodeShare('not*a*real*link')).toThrow(/damaged/)
        expect(() => decodeShare('AAAA')).toThrow(/damaged/)
    })
})

describe('templates', () => {
    it.each(TEMPLATES.map((template) => [template.id, template] as const))('%s compiles without problems', async (_, template) => {
        const project = normalizeProject(template.project())
        // Normalizing must not lose anything a template relies on.
        expect(project.beats.length).toBe(template.project().beats.length)
        expect(project.objects.length).toBe(template.project().objects.length)
        const { film, objectErrors, beatErrors } = await compileProject(project)
        expect([...objectErrors]).toEqual([])
        expect([...beatErrors]).toEqual([])
        expect(film.frame(template.thumb).ops.length).toBeGreaterThan(0)
    })
})

describe('store', () => {
    it('undoes and redoes whole documents, merging gestures', () => {
        const store = new Store()
        store.load(emptyProject('First'))
        store.commit((draft) => { draft.name = 'A' }, { merge: 'drag' })
        store.commit((draft) => { draft.name = 'B' }, { merge: 'drag' })
        store.settle()
        store.commit((draft) => { draft.name = 'C' }, { merge: 'drag' })
        expect(store.project.name).toBe('C')
        store.undo()
        expect(store.project.name).toBe('B')
        store.undo()
        expect(store.project.name).toBe('First')
        expect(store.canUndo).toBe(false)
        store.redo()
        expect(store.project.name).toBe('B')
        store.commit((draft) => { draft.name = 'D' })
        expect(store.canRedo).toBe(false)
    })

    it('drops selection of objects that an undo removes', () => {
        const store = new Store()
        store.load(emptyProject())
        store.commit((draft) => {
            draft.objects.push({ id: 'x', kind: 'dot', name: 'Dot', x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, hidden: false, locked: false, props: {} })
        })
        store.select(['x'])
        store.undo()
        expect(store.selection).toEqual([])
    })
})

describe('timing helpers', () => {
    const beat = (id: string, start: number, duration: number): Beat => ({ id, target: 'a', kind: 'write', start, duration, ease: 'smooth', params: {} })

    it('stacks overlapping beats on separate lanes', () => {
        const lanes = laneOf([beat('a', 0, 2), beat('b', 1, 2), beat('c', 2, 1), beat('d', 3.5, 1)])
        expect([lanes.get('a'), lanes.get('b'), lanes.get('c'), lanes.get('d')]).toEqual([0, 1, 0, 0])
    })

    it('counts only beats that can play', () => {
        const project = { ...emptyProject(), hold: 1, beats: [{ ...beat('a', 2, 1), target: VALUE_TRACK }, { ...beat('b', 50, 1), target: 'missing' }] }
        expect(projectDuration(project)).toBe(4)
    })
})
