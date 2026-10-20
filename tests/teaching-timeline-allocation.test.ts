import { describe, expect, it } from 'vitest'
import { createTeachingCanvas, type TeachingPainter } from '../src/teaching-canvas'
import { layoutAllocation } from '../src/teaching-allocation'
import type { CanvasBounds } from '../src/canvas-components'

interface Shape extends CanvasBounds { auditId: number }
function host() {
    const events: { kind: string, alpha: number, [key: string]: unknown }[] = []
    let alpha = 1, id = 0
    let scope: CanvasBounds | undefined
    const painter: TeachingPainter<Shape> = {
        rect(x, y, width, height, fill, stroke, radius) {
            const shape = { x, y, width, height, radius, auditId: id++ }
            events.push({ kind: 'rect', alpha, shape, fill, stroke }); return shape
        },
        text(value, x, y, size, color, align) { events.push({ kind: 'text', alpha, value, x, y, size, color, align, scope }) },
        line(x1, y1, x2, y2, color, width) { events.push({ kind: 'line', alpha, x1, y1, x2, y2, color, width }) },
        math() {}, arrow() {}, path() {}, circle() {},
        connect() { throw new Error('These displays do not fabricate connector anchors') },
        container(bounds, draw, options) { events.push({ kind: 'container', alpha, bounds, options }); draw() },
        labelScope(bounds, draw, options) { events.push({ kind: 'labelScope', alpha, bounds, options }); const old = scope; scope = bounds; try { draw() } finally { scope = old } },
        opacity(value, draw) { const old = alpha; alpha *= value; try { draw() } finally { alpha = old } },
    }
    return { painter, events }
}
const timing = {
    x: 100, y: 200, width: 1000, height: 400, domain: [0, 100] as const,
    lanes: [{ id: 'cpu', label: 'CPU' }, { id: 'gpu', label: 'GPU' }],
    intervals: [{ id: 'submit', lane: 'cpu', start: 0, end: 20, label: 'Submit' }, { id: 'kernel', lane: 'gpu', start: 20, end: 80, label: 'Kernel', opacity: .4 }],
}

describe('checked lane timelines', () => {
    it('uses one held time for partial geometry, elapsed values, completion and the cursor', () => {
        const h = host(), t = createTeachingCanvas(h.painter)
        const initial = t.timeline({ ...timing, time: 0 })
        expect(Object.values(initial.intervals).map(row => row.shape)).toEqual([null, null])
        expect(h.events.filter(e => e.kind === 'text').map(e => e.value)).not.toContain('Kernel')
        h.events.length = 0
        const partial = t.timeline({ ...timing, time: 50 })
        expect(partial.intervals.submit).toMatchObject({ elapsed: 20, complete: true, opacity: 1 })
        expect(partial.intervals.kernel).toMatchObject({ elapsed: 30, complete: false, opacity: .4 })
        expect(partial.intervals.kernel.bounds.width).toBeCloseTo(partial.point(50) - partial.point(20))
        expect(Object.values(partial.lanes).every(lane => lane.bounds.x + lane.bounds.width + 1 <= timing.x + timing.width)).toBe(true)
        expect(partial.intervals.kernel.shape).toBe(h.events.find(e => e.kind === 'rect' && (e.shape as Shape).auditId === partial.intervals.kernel.shape!.auditId)!.shape)
        expect(h.events.filter(e => e.kind === 'line').at(-1)).toMatchObject({ x1: partial.point(50), x2: partial.point(50) })
        expect(t.timeline({ ...timing, time: 80 }).intervals.kernel.complete).toBe(true)
        expect(() => partial.point(101)).toThrow('inside the domain')
    })

    it('does not paint a future interval at its start, and composes interval alpha once with host alpha', () => {
        const h = host(), t = createTeachingCanvas(h.painter)
        expect(t.timeline({ ...timing, time: 20 }).intervals.kernel.shape).toBeNull()
        h.events.length = 0
        h.painter.opacity(.5, () => t.timeline({ ...timing, time: 20.000001 }))
        const painted = h.events.find(e => e.kind === 'rect' && e.fill === '#63DEEC' && e.alpha === .2)
        expect(painted).toBeDefined()
        expect(h.events.find(e => e.kind === 'text' && e.value === 'Kernel')).toMatchObject({ alpha: .2 })
        expect(h.events.filter(e => e.kind === 'text').every(event => event.scope !== undefined)).toBe(true)
        const hidden = t.timeline({ ...timing, time: 100, intervals: [{ ...timing.intervals[1], opacity: 0 }] })
        expect(hidden.intervals.kernel.shape).toBeNull()
    })

    it('preflights overlap, lane identity, finite time and vertical space before painting', () => {
        const h = host(), t = createTeachingCanvas(h.painter)
        expect(() => t.timeline({ ...timing, intervals: [...timing.intervals, { id: 'race', lane: 'gpu', start: 30, end: 90 }] })).toThrow('overlap')
        expect(() => t.timeline({ ...timing, intervals: [{ id: 'bad', lane: 'missing', start: 1, end: 2 }] })).toThrow('existing lane')
        expect(() => t.timeline({ ...timing, time: NaN })).toThrow('finite')
        expect(() => t.timeline({ ...timing, height: 50 })).toThrow('cannot fit')
        expect(() => t.timeline({ ...timing, labelWidth: 10 })).toThrow('label space')
        expect(() => t.timeline({ ...timing, ticks: [101] })).toThrow('inside the domain')
        expect(h.events).toEqual([])
        const adjacent = t.timeline({ ...timing, intervals: [{ id: 'one', lane: 'cpu', start: 0, end: 20 }, { id: 'two', lane: 'cpu', start: 20, end: 30 }] })
        expect(adjacent.intervals.one.bounds.x + adjacent.intervals.one.bounds.width).toBe(adjacent.intervals.two.bounds.x)
    })
})

const allocation = { x: 10, y: 20, width: 800, height: 80, capacity: 100, parts: [{ id: 'weights', label: 'Weights', value: 20 }, { id: 'padding', label: 'Padding', value: 30 }, { id: 'empty', label: 'Empty', value: 0 }] }
describe('capacity-scaled allocation ledgers', () => {
    it('preserves free capacity and exact ordered partition geometry instead of normalizing the parts', () => {
        const layout = layoutAllocation(allocation)
        expect(layout.used).toBe(50); expect(layout.remaining).toBe(50)
        expect(layout.parts.map(part => part.bounds.width)).toEqual([160, 240, 0])
        expect(layout.freeBounds).toEqual({ x: 410, y: 20, width: 400, height: 80 })
        expect(allocation.parts.map(part => part.value)).toEqual([20, 30, 0])
        expect(layoutAllocation({ ...allocation, parts: [] }).freeBounds).toEqual(layout.bounds)
    })

    it('keeps labels and numeric totals scoped, retains real segment references, and paints no zero-area marks', () => {
        const h = host(), result = createTeachingCanvas(h.painter).allocation({ ...allocation, height: 400, unit: 'GB' })
        expect(result.shapes[2]).toBeNull()
        expect(result.shape.x - 1).toBeGreaterThanOrEqual(allocation.x)
        expect(result.shape.x + result.shape.width + 1).toBeLessThanOrEqual(allocation.x + allocation.width)
        expect(result.shape).toBe(h.events.find(e => e.kind === 'rect')!.shape)
        for (const shape of result.shapes.filter(Boolean)) expect(h.events.some(e => e.shape === shape)).toBe(true)
        const segmentColors = result.shapes.filter(Boolean).map(shape => h.events.find(event => event.shape === shape)!.fill)
        expect(new Set(segmentColors).size).toBe(2)
        expect(h.events.filter(e => e.kind === 'text').map(e => e.value)).toEqual(['Used 50 / 100 GB', 'Weights', '20 GB', 'Padding', '30 GB', 'Empty', '0 GB', 'Free', '50 GB'])
        expect(h.events.filter(e => e.kind === 'labelScope')).toHaveLength(9)
        expect(h.events.filter(e => e.kind === 'rect').every(e => (e.shape as Shape).width > 0 && (e.shape as Shape).height > 0)).toBe(true)
    })

    it('handles decimal roundoff without overshooting capacity, and rejects real over-allocation before painting', () => {
        const decimals = layoutAllocation({ ...allocation, capacity: .3, parts: [{ id: 'a', label: 'A', value: .1 }, { id: 'b', label: 'B', value: .2 }, { id: 'c', label: 'C', value: 0 }] })
        expect(decimals.used).toBe(.3); expect(decimals.remaining).toBe(0)
        const huge = layoutAllocation({ ...allocation, capacity: 1e308, parts: [{ id: 'huge', label: 'Huge', value: 1e308 }] })
        expect(huge.parts[0].bounds.width).toBe(allocation.width)
        expect(decimals.parts.every(part => part.bounds.width >= 0)).toBe(true)
        expect(decimals.parts.at(-1)!.bounds.x).toBeLessThanOrEqual(allocation.x + allocation.width)
        const h = host(), draw = createTeachingCanvas(h.painter).allocation
        expect(() => draw({ ...allocation, height: 400, capacity: 49 })).toThrow('exceeds capacity')
        expect(() => draw({ ...allocation, height: 400, parts: [{ id: 'bad', label: 'Bad', value: NaN }] })).toThrow('finite and nonnegative')
        expect(() => draw({ ...allocation, height: 100 })).toThrow('cannot fit')
        expect(() => draw({ ...allocation, width: 20, height: 400 })).toThrow('cannot fit')
        expect(h.events).toEqual([])
    })
})
