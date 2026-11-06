import { describe, expect, it } from 'vitest'
import { createTeachingVectorAccumulation, weightedVectorState, type WeightedVectorTerm } from '../src/teaching-vector'
import type { TeachingPainter, TeachingPlot } from '../src/teaching-canvas'
import type { CanvasBounds } from '../src/canvas-components'

function host() {
    const events: { kind: string, alpha: number, [key: string]: unknown }[] = []
    let alpha = 1
    const painter: TeachingPainter<CanvasBounds> = {
        rect: (x, y, width, height) => ({ x, y, width, height }),
        text(value, x, y) { events.push({ kind: 'text', value, x, y, alpha }) },
        arrow(x1, y1, x2, y2) { events.push({ kind: 'arrow', x1, y1, x2, y2, alpha }) },
        circle(x, y, radius) { events.push({ kind: 'circle', x, y, radius, alpha }) },
        opacity(amount, draw) { const prior = alpha; alpha *= amount; try { draw() } finally { alpha = prior } },
        target(_id, draw) { return draw() },
        labelScope(_bounds, draw) { draw() }, container(_bounds, draw) { draw() },
        math() {}, line() {}, path() {},
        connect() { throw new Error('This composition does not use connectors') },
    }
    return { painter, events }
}

const plot: TeachingPlot = {
    bounds: { x: 100, y: 100, width: 400, height: 400 }, xDomain: [-10, 10], yDomain: [-10, 10],
    point: (x, y) => ({ x: 300 + 20 * x, y: 300 - 20 * y }),
}
const ledger = { x: 600, y: 100, width: 900, height: 500 }
const terms: WeightedVectorTerm[] = [
    { id: 'carry', label: 'Retained memory', weight: 0.5, values: [2, -4] },
    { id: 'incoming', label: 'Incoming gradient', weight: 2, values: [-3, 2] },
    { id: 'zero-weight', weight: 0, values: [9, 9] },
]

describe('weighted vector state', () => {
    it('retains named signed terms and separates completed, applied and final sums', () => {
        const state = weightedVectorState({ terms, progress: 0.5 })
        expect(state.terms.map(term => term.id)).toEqual(['carry', 'incoming', 'zero-weight'])
        expect(state.terms.map(term => term.status)).toEqual(['completed', 'current', 'pending'])
        expect(state.completedSum).toEqual([1, -2])
        expect(state.current?.contribution).toEqual([-6, 4])
        expect(state.current?.applied).toEqual([-3, 2])
        expect(state.sum).toEqual([-2, 0])
        expect(state.total).toEqual([-5, 2])
        expect(state.terms[2].zero).toBe(true)
    })

    it('gives every zero contribution an interval and deterministic endpoint semantics', () => {
        for (const [progress, completed, current] of [[0, 0, 'carry'], [1 / 3, 1, 'incoming'], [2 / 3, 2, 'zero-weight']] as const) {
            const state = weightedVectorState({ terms, progress })
            expect(state.completedCount).toBe(completed)
            expect(state.current?.id).toBe(current)
            expect(state.current?.progress).toBe(0)
        }
        const finished = weightedVectorState({ terms, progress: 1 })
        expect(finished.completedCount).toBe(3)
        expect(finished.current).toBeNull()
        expect(finished.sum).toEqual([-5, 2])
        expect(finished.terms.every(term => term.status === 'completed')).toBe(true)
        expect(weightedVectorState({ terms, progress: -2 })).toEqual(weightedVectorState({ terms, progress: 0 }))
        expect(weightedVectorState({ terms, progress: 9 })).toEqual(finished)
    })

    it('samples arbitrary times without mutating inputs or retaining a previous result', () => {
        const before = JSON.stringify(terms)
        const samples = [0.8, 0.2, 1, 0, 0.6].map(progress => weightedVectorState({ terms, progress }))
        samples[0].terms[0].values[0] = 999
        samples[0].sum[0] = 999
        expect(JSON.stringify(terms)).toBe(before)
        for (const [index, progress] of [0.8, 0.2, 1, 0, 0.6].entries()) {
            if (index > 0) expect(weightedVectorState({ terms, progress })).toEqual(samples[index])
        }
        expect(weightedVectorState({ terms, progress: 0.8 }).sum[0]).not.toBe(999)
    })

    it('supports arbitrary dimensions, an initial value and a declared empty sum', () => {
        expect(weightedVectorState({ terms: [{ id: 'three', weight: -2, values: [1, 0, -3] }],
            initial: [4, 5, 6], progress: 0.5 }).sum).toEqual([3, 5, 9])
        expect(weightedVectorState({ terms: [], initial: [2, -1], progress: 0.3 }).sum).toEqual([2, -1])
        expect(() => weightedVectorState({ terms: [], progress: 0 })).toThrow('initial vector')
    })

    it('rejects dimensional, identity and arithmetic failures including overflow', () => {
        expect(() => weightedVectorState({ terms, progress: NaN })).toThrow('finite')
        expect(() => weightedVectorState({ terms: [...terms, terms[0]], progress: 0 })).toThrow('distinct')
        expect(() => weightedVectorState({ terms: [{ id: ' ', weight: 1, values: [1] }], progress: 0 })).toThrow('IDs')
        expect(() => weightedVectorState({ terms, initial: [1], progress: 0 })).toThrow('coordinates')
        expect(() => weightedVectorState({ terms: [{ id: 'x', weight: Infinity, values: [1] }], progress: 0 })).toThrow('finite')
        expect(() => weightedVectorState({ terms: [{ id: 'x', weight: 1, values: [NaN] }], progress: 0 })).toThrow('finite')
        expect(() => weightedVectorState({ terms: [{ id: 'x', weight: 2, values: [1e308] }], progress: 0 })).toThrow('contribution')
        expect(() => weightedVectorState({ terms: [{ id: 'x', weight: 1, values: [1e308] },
            { id: 'y', weight: 1, values: [1e308] }], progress: 0 })).toThrow('sum')
    })
})

describe('checked weighted vector drawing', () => {
    it('rejects a distorted plot mapping before drawing any contribution', () => {
        const { painter, events } = host()
        const distorted: TeachingPlot = { ...plot, point: (x, y) => ({ x: 300 + 20 * x, y: 300 - 10 * y }) }
        expect(() => createTeachingVectorAccumulation(painter)({
            terms: [{ id: 'diagonal', weight: 1, values: [2, 2] }],
            progress: 1, plot: distorted, ledger,
        })).toThrow('declared equal-unit transform')
        expect(events).toEqual([])
    })

    it('holds future result geometry while exposing term identities and weights', () => {
        const { painter, events } = host()
        const result = createTeachingVectorAccumulation(painter)({ terms, progress: 0, plot, ledger })
        expect(result.segments.map(segment => segment.id)).toEqual(['carry'])
        expect(events.filter(event => event.kind === 'arrow')).toHaveLength(0)
        expect(events.filter(event => event.kind === 'circle')).toEqual([{ kind: 'circle', alpha: 1, x: 300, y: 300, radius: 5 }])
        expect(events.some(event => event.value === 'Retained memory: 0.5 × (2, -4)')).toBe(true)
        expect(events.some(event => event.value === 'Incoming gradient: 2 × (-3, 2)')).toBe(true)
        expect(events.some(event => event.value === 'Accumulated vector: ?')).toBe(true)
        expect(events.some(event => event.x === 200 && event.y === 260)).toBe(false)
    })

    it('draws the current partial endpoint and quieter completed contribution at actual equal-unit coordinates', () => {
        const { painter, events } = host()
        const result = createTeachingVectorAccumulation(painter)({ terms, progress: 0.5, plot, ledger })
        expect(result.endpoint).toEqual({ x: 260, y: 300 })
        expect(events.filter(event => event.kind === 'arrow')).toEqual([
            { kind: 'arrow', alpha: 0.45, x1: 300, y1: 300, x2: 320, y2: 340 },
            { kind: 'arrow', alpha: 1, x1: 320, y1: 340, x2: 260, y2: 300 },
        ])
        expect(events.some(event => event.value === 'current: (-3, 2)')).toBe(true)
        expect(events.some(event => event.value === 'Accumulated vector: (-5, 2)')).toBe(false)
        events.length = 0
        createTeachingVectorAccumulation(painter)({ terms, progress: 1, plot, ledger, revealTotal: true })
        expect(events.some(event => event.value === 'Accumulated vector: (-5, 2)')).toBe(true)
        expect(events.some(event => event.kind === 'circle' && event.x === 200 && event.y === 260 && event.radius === 7.5)).toBe(true)
    })

    it('keeps both zero-vector and zero-weight identities without inventing arrows', () => {
        const { painter, events } = host()
        const zeroTerms = [{ id: 'zero-vector', weight: -3, values: [0, 0] }, { id: 'zero-weight', weight: 0, values: [5, -8] }]
        const result = createTeachingVectorAccumulation(painter)({ terms: zeroTerms, progress: 1, plot, ledger })
        expect(result.state.completedCount).toBe(2)
        expect(result.segments.map(segment => segment.id)).toEqual(['zero-vector', 'zero-weight'])
        expect(events.filter(event => event.kind === 'arrow')).toEqual([])
        expect(events.filter(event => event.kind === 'circle')).toHaveLength(2)
        expect(events.some(event => String(event.value).includes('zero-vector: -3'))).toBe(true)
        expect(events.some(event => String(event.value).includes('zero-weight: 0'))).toBe(true)
    })

    it('requires a visible declared projection for higher dimensions and validates before painting', () => {
        const { painter, events } = host(), draw = createTeachingVectorAccumulation(painter)
        const options = { terms: [{ id: 'three', weight: 0.5, values: [2, -2, 4] }], progress: 1, plot, ledger }
        expect(() => draw(options)).toThrow('explicit projection')
        expect(events).toEqual([])
        const result = draw({ ...options, projection: { label: '(x + z, y)', point: v => [v[0] + v[2], v[1]] } })
        expect(result.endpoint).toEqual({ x: 360, y: 320 })
        expect(events.some(event => event.value === 'Projection: (x + z, y)')).toBe(true)
        events.length = 0
        expect(() => draw({ ...options, projection: { label: 'bad', point: () => [Infinity, 0] } })).toThrow('finite')
        expect(events).toEqual([])
        expect(() => draw({ terms, progress: 0, plot: { ...plot, bounds: { ...plot.bounds, width: 800 } }, ledger })).toThrow('equal-unit')
        expect(() => draw({ terms: [{ id: 'far', weight: 1, values: [11, 0] }], progress: 0, plot, ledger })).toThrow('domains')
        expect(events).toEqual([])
    })
})
