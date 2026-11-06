import { describe, expect, it } from 'vitest'
import { categoricalSampling, createTeachingCategoricalSampling } from '../src/teaching-categorical-sampling'
import type { TeachingPainter } from '../src/teaching-canvas'
import type { CanvasBounds } from '../src/canvas-components'

const categories = [{ id: 'common', label: 'Common', mass: .95 }, { id: 'rare', label: 'Rare', mass: .05 }]
const draws = [.1, .3, .5, .7, .9, .2, .4, .8].map((uniform, i) => ({ id: `s${i + 1}`, uniform }))
const fixture = { categories, draws, normalization: 'probabilities' as const }
function host() {
    const events: { kind: string, [key: string]: unknown }[] = []
    let labelBounds: CanvasBounds | undefined
    const painter: TeachingPainter<CanvasBounds> = {
        rect(x, y, width, height, fill, stroke) { const shape = { x, y, width, height }; events.push({ kind: 'rect', shape, fill, stroke }); return shape },
        text(value, x, y, size) { events.push({ kind: 'text', value, x, y, size, bounds: labelBounds }) },
        circle(x, y, radius, fill) { events.push({ kind: 'circle', x, y, radius, fill }) },
        math() {}, line() {}, arrow() {}, path() {}, connect() { throw new Error('No fabricated connector') },
        container(_bounds, draw) { draw() }, labelScope(bounds, draw) { const previous = labelBounds; labelBounds = bounds; try { draw() } finally { labelBounds = previous } }, opacity(_alpha, draw) { draw() },
    }
    return { painter, events }
}

describe('explicit categorical sampling', () => {
    it('keeps original probability distinct from an all-common empirical replacement', () => {
        const original = JSON.stringify(fixture), model = categoricalSampling(fixture)
        expect(model.categories.map(category => category.probability)).toEqual([.95, .05])
        expect(model.categories.map(category => category.count)).toEqual([8, 0])
        expect(model.categories.map(category => category.empiricalProbability)).toEqual([1, 0])
        expect(model.draws.map(draw => draw.id)).toEqual(draws.map(draw => draw.id))
        const replacement = categoricalSampling({ ...fixture, categories: model.categories.map(category => ({ ...category, mass: category.empiricalProbability! })), draws: [{ id: 'next', uniform: .99999 }] })
        expect(replacement.draws[0].categoryId).toBe('common')
        expect(.95 ** 8).toBeCloseTo(.6634204312890623)
        expect(JSON.stringify(fixture)).toBe(original)
    })

    it('normalizes only under the explicit contract and assigns exact boundaries to the next positive interval', () => {
        const model = categoricalSampling({ normalization: 'weights', categories: [{ id: 'zero', label: 'Zero', mass: 0 }, { id: 'a', label: 'A', mass: 1 }, { id: 'empty', label: 'Empty', mass: 0 }, { id: 'b', label: 'B', mass: 3 }, { id: 'tail', label: 'Tail', mass: 0 }], draws: [{ id: 'left', uniform: 0 }, { id: 'below', uniform: .24999 }, { id: 'edge', uniform: .25 }, { id: 'right', uniform: 1 - Number.EPSILON }] })
        expect(model.inputTotal).toBe(4)
        expect(model.draws.map(draw => draw.categoryId)).toEqual(['a', 'a', 'b', 'b'])
        expect(model.categories.map(category => category.probability)).toEqual([0, .25, 0, .75, 0])
        expect(() => categoricalSampling({ ...fixture, categories: [{ id: 'bad', label: 'Bad', mass: 2 }] })).toThrow('sum to one')
    })

    it('rejects invalid masses, duplicate identities and unsupported draws rather than inventing randomness', () => {
        for (const mass of [-1, NaN, Infinity]) expect(() => categoricalSampling({ ...fixture, categories: [{ id: 'bad', label: 'Bad', mass }] })).toThrow('finite and nonnegative')
        expect(() => categoricalSampling({ ...fixture, categories: [{ id: 'zero', label: 'Zero', mass: 0 }] })).toThrow('positive')
        expect(() => categoricalSampling({ ...fixture, categories: [categories[0], categories[0]] })).toThrow('unique')
        expect(() => categoricalSampling({ ...fixture, draws: [draws[0], draws[0]] })).toThrow('unique')
        for (const uniform of [-.1, 1, NaN, Infinity]) expect(() => categoricalSampling({ ...fixture, draws: [{ id: 'bad', uniform }] })).toThrow('[0, 1)')
        expect(() => categoricalSampling({ ...fixture, categories: [{ id: 'a', label: 'A', mass: 1 }, { id: 'tiny', label: 'Tiny', mass: 1e-30 }] })).toThrow('cumulative floating-point precision')
        expect(categoricalSampling({ ...fixture, draws: [] }).categories.map(category => category.empiricalProbability)).toEqual([null, null])
    })
})

describe('causal sampling painter', () => {
    const bounds = { x: 20, y: 40, width: 1200, height: 650, fontSize: 28 }
    it('conceals all sample identities and empirical results until explicitly revealed', () => {
        const h = host(), draw = createTeachingCategoricalSampling(h.painter)
        draw({ ...fixture, ...bounds })
        expect(h.events.filter(event => event.kind === 'circle')).toEqual([])
        expect(h.events.filter(event => event.kind === 'text').map(event => event.value)).not.toContain('s1')
        expect(h.events.some(event => String(event.value).includes('Empirical'))).toBe(false)
        h.events.length = 0
        const settled = draw({ ...fixture, ...bounds, visibleDraws: 8, showEmpirical: true })
        expect(settled.shapes).toHaveLength(8)
        expect(settled.sampleBounds.every(shape => shape.x - 1 >= bounds.x && shape.x + shape.width + 1 <= bounds.x + bounds.width)).toBe(true)
        expect(h.events.filter(event => event.kind === 'text').map(event => event.value)).toContain('Common: 8/8 · Rare: 0/8')
        expect(h.events.filter(event => event.kind === 'rect').every(event => (event.shape as CanvasBounds).width > 0)).toBe(true)
    })

    it('moves the same supplied sample from its uniform position to its own stable slot', () => {
        const h = host(), draw = createTeachingCategoricalSampling(h.painter)
        const landed = draw({ ...fixture, ...bounds, drawProgress: .4 })
        expect(h.events.find(event => event.kind === 'circle')).toMatchObject({ x: landed.point(.1), fill: '#79A6FF' })
        h.events.length = 0
        const copied = draw({ ...fixture, ...bounds, drawProgress: 1 })
        expect(h.events.find(event => event.kind === 'circle')).toMatchObject({ x: copied.sampleBounds[0].x + copied.sampleBounds[0].width / 2, y: copied.sampleBounds[0].y + copied.sampleBounds[0].height / 2 })
        h.events.length = 0
        draw({ ...fixture, ...bounds, visibleDraws: 1 })
        expect(h.events.filter(event => event.kind === 'text').map(event => event.value)).toContain('s1')
        expect(h.events.filter(event => event.kind === 'text').map(event => event.value)).not.toContain('s2')
    })

    it('preflights future-result leaks, motion bounds and insufficient layout without painting', () => {
        const h = host(), draw = createTeachingCategoricalSampling(h.painter)
        expect(() => draw({ ...fixture, ...bounds, visibleDraws: 4, showEmpirical: true })).toThrow('every supplied sample')
        expect(() => draw({ ...fixture, ...bounds, visibleDraws: 9 })).toThrow('integer')
        expect(() => draw({ ...fixture, ...bounds, drawProgress: 1.1 })).toThrow('progress')
        expect(() => draw({ ...fixture, ...bounds, height: 100 })).toThrow('cannot fit')
        expect(h.events).toEqual([])
    })
    it('routes every moving sample around all visible label scopes and retained cells', () => {
        const h=host(), draw=createTeachingCategoricalSampling(h.painter)
        for(let retained=0;retained<draws.length;retained++)for(let step=1;step<=100;step++){
            h.events.length=0
            const result=draw({...fixture,...bounds,visibleDraws:retained,drawProgress:step/100})
            const marker=h.events.find(event=>event.kind==='circle')!, px=Number(marker.x),py=Number(marker.y),radius=Number(marker.radius)+1.5
            const intersects=(box:CanvasBounds)=>Math.hypot(px-Math.max(box.x,Math.min(px,box.x+box.width)),py-Math.max(box.y,Math.min(py,box.y+box.height)))<radius
            expect(h.events.filter(event=>event.kind==='text').some(event=>intersects(event.bounds as CanvasBounds)), 'marker crossed a visible label').toBe(false)
            expect(result.sampleBounds.slice(0,retained).some(intersects),'marker crossed a retained sample').toBe(false)
        }
    })

})
