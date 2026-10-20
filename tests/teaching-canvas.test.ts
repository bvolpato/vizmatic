import { describe, expect, it } from 'vitest'
import { createTeachingCanvas, type TeachingPainter, type TeachingPathOptions } from '../src/teaching-canvas'
import type { CanvasBounds } from '../src/canvas-components'

const PROOF = Symbol('hostPaintedGeometry')
interface Shape extends CanvasBounds { auditId: number, [PROOF]: boolean }

function recordingPainter() {
    const events: { kind: string, [key: string]: unknown }[] = []
    let alpha = 1
    let count = 0
    const painter: TeachingPainter<Shape> = {
        rect(x, y, width, height, fill, stroke, radius) {
            const shape = { x, y, width, height, radius, auditId: count++, [PROOF]: true }
            events.push({ kind: 'rect', shape, fill, stroke, alpha })
            return shape
        },
        text(value, x, y, size, color, align) { events.push({ kind: 'text', value, x, y, size, color, align, alpha }) },
        math(value, x, y, size, color, align) { events.push({ kind: 'math', value, x, y, size, color, align, alpha }) },
        line(x1, y1, x2, y2, color, width) { events.push({ kind: 'line', x1, y1, x2, y2, color, width }) },
        arrow(x1, y1, x2, y2, color, width) { events.push({ kind: 'arrow', x1, y1, x2, y2, color, width }) },
        path(points, options) { events.push({ kind: 'path', points, options }) },
        circle(x, y, radius, fill) {
            const shape = { x, y, radius }
            events.push({ kind: 'circle', shape, fill, alpha })
            return shape
        },
        connect(source, target, options) {
            events.push({ kind: 'connect', source, target, options })
            return { from: { x: source.x + source.width, y: source.y + source.height / 2 }, to: { x: target.x, y: target.y + target.height / 2 } }
        },
        container(bounds, draw, options) {
            events.push({ kind: 'container', bounds, options })
            draw()
        },
        labelScope(bounds, draw, options) {
            events.push({ kind: 'labelScope', bounds, options })
            draw()
        },
        opacity(value, draw) {
            const previous = alpha
            alpha *= value
            try { draw() } finally { alpha = previous }
        },
    }
    return { painter, events, alpha: () => alpha }
}

describe('checked teaching Canvas compositions', () => {
    it('maps data coordinates and keeps axis labels outside the plotting rectangle', () => {
        const host = recordingPainter()
        const plot = createTeachingCanvas(host.painter).axes({
            x: 200, y: 100, width: 600, height: 300,
            xDomain: [-2, 4], yDomain: [0, 10], xTicks: [-3, -2, 1, 4], yTicks: [0, 5, 10, 11],
            xLabel: 'Time', yLabel: 'Loss', gridColor: '#222', formatY: (value) => `${value}%`,
        })
        expect(plot.point(-2, 0)).toEqual({ x: 200, y: 400 })
        expect(plot.point(4, 10)).toEqual({ x: 800, y: 100 })
        expect(plot.point(1, 5)).toEqual({ x: 500, y: 250 })
        expect(host.events.filter(({ kind }) => kind === 'path')).toHaveLength(6)
        expect(host.events.filter(({ kind }) => kind === 'path').every(({ options }) => (options as TeachingPathOptions).clip === plot.bounds)).toBe(true)
        const labels = host.events.filter(({ kind }) => kind === 'text')
        expect(labels.map(({ value }) => value)).toEqual(['-2', '1', '4', '0%', '5%', '10%', 'Time', 'Loss'])
        expect(labels.at(-2)).toMatchObject({ x: 500, y: 472, size: 30, align: 'center' })
        expect(labels.at(-1)).toMatchObject({ x: 200, y: 74, size: 30, align: 'left' })
        expect(() => plot.point(NaN, 1)).toThrow('finite')
    })

    it('traces curves by screen distance and delegates plot clipping to the host', () => {
        const host = recordingPainter()
        const scene = createTeachingCanvas(host.painter)
        const plot = scene.axes({ x: 100, y: 100, width: 300, height: 400, xDomain: [0, 3], yDomain: [0, 4] })
        host.events.length = 0
        const visible = scene.curve({ plot, points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }], progress: 0.5, color: '#fc0' })
        expect(visible).toEqual([{ x: 100, y: 500 }, { x: 400, y: 500 }, { x: 400, y: 450 }])
        expect(host.events).toEqual([{ kind: 'path', points: visible, options: { color: '#fc0', width: 4, clip: plot.bounds } }])
        expect(scene.curve({ plot, points: [], color: '#fc0' })).toEqual([])
        expect(scene.curve({ plot, points: [{ x: 1, y: 1 }], progress: 0, color: '#fc0' })).toEqual([{ x: 200, y: 400 }])
        expect(host.events).toHaveLength(1)
    })

    it('fits equal data units into a centered square and uses it for axes, labels, and curve clipping', () => {
        const host = recordingPainter()
        const scene = createTeachingCanvas(host.painter)
        const plot = scene.axes({
            x: 100, y: 200, width: 800, height: 450,
            xDomain: [-2, 2], yDomain: [-2, 2], equalUnits: true,
            xTicks: [-2, 0, 2], yTicks: [-2, 0, 2], gridColor: '#222', xLabel: 'x', yLabel: 'y',
        })
        expect(plot.bounds).toEqual({ x: 275, y: 200, width: 450, height: 450 })
        expect(plot.point(0, 0)).toEqual({ x: 500, y: 425 })
        const origin = plot.point(0, 0)
        const horizontal = plot.point(1, 0)
        const vertical = plot.point(0, 1)
        expect(Math.hypot(horizontal.x - origin.x, horizontal.y - origin.y)).toBe(112.5)
        expect(Math.hypot(vertical.x - origin.x, vertical.y - origin.y)).toBe(112.5)
        expect(host.events.filter(({ kind }) => kind === 'line').slice(-2)).toEqual([
            { kind: 'line', x1: 275, y1: 650, x2: 725, y2: 650, color: '#8D9CB9', width: 2 },
            { kind: 'line', x1: 275, y1: 200, x2: 275, y2: 650, color: '#8D9CB9', width: 2 },
        ])
        const labels = host.events.filter(({ kind }) => kind === 'text')
        expect(labels[0]).toMatchObject({ value: '-2', x: 275, y: 686 })
        expect(labels[3]).toMatchObject({ value: '-2', x: 257, y: 659 })
        expect(labels.at(-2)).toMatchObject({ value: 'x', x: 500, y: 722 })
        expect(labels.at(-1)).toMatchObject({ value: 'y', x: 275, y: 174 })
        const points = [{ x: -2, y: 0 }, { x: 2, y: 0 }]
        scene.curve({ plot, points, color: '#fc0' })
        expect(host.events.filter(({ kind }) => kind === 'path').every(({ options }) => (options as TeachingPathOptions).clip === plot.bounds)).toBe(true)
        expect(host.events.at(-1)).toMatchObject({
            kind: 'path', points: [{ x: 275, y: 425 }, { x: 725, y: 425 }],
        })
    })

    it('fits unequal domain spans with equal pixel distances and vertical centering', () => {
        const host = recordingPainter()
        const plot = createTeachingCanvas(host.painter).axes({
            x: 100, y: 200, width: 800, height: 450,
            xDomain: [-4, 4], yDomain: [-1, 1], equalUnits: true,
        })
        expect(plot.bounds).toEqual({ x: 100, y: 325, width: 800, height: 200 })
        expect(plot.point(-4, -1)).toEqual({ x: 100, y: 525 })
        expect(plot.point(4, 1)).toEqual({ x: 900, y: 325 })
        const origin = plot.point(0, 0)
        const horizontal = plot.point(1, 0)
        const vertical = plot.point(0, 1)
        expect(Math.hypot(horizontal.x - origin.x, horizontal.y - origin.y)).toBe(100)
        expect(Math.hypot(vertical.x - origin.x, vertical.y - origin.y)).toBe(100)
    })

    it('preserves the original stretched plot output unless equal units is enabled', () => {
        const implicit = recordingPainter()
        const explicit = recordingPainter()
        const options = {
            x: 100, y: 200, width: 800, height: 450,
            xDomain: [-2, 2] as const, yDomain: [-2, 2] as const,
            xTicks: [-2, 0, 2], yTicks: [-2, 0, 2], gridColor: '#222', xLabel: 'x', yLabel: 'y',
        }
        const original = createTeachingCanvas(implicit.painter).axes(options)
        const unchanged = createTeachingCanvas(explicit.painter).axes({ ...options, equalUnits: false })
        expect(original.bounds).toEqual({ x: 100, y: 200, width: 800, height: 450 })
        expect(unchanged.bounds).toEqual(original.bounds)
        expect(original.point(1, 0)).toEqual({ x: 700, y: 425 })
        expect(original.point(0, 1)).toEqual({ x: 500, y: 312.5 })
        expect(unchanged.point(1, 0)).toEqual(original.point(1, 0))
        expect(explicit.events).toEqual(implicit.events)
    })

    it.each([undefined, false, true])('keeps domain and nonfinite input validation with equalUnits=%s', (equalUnits) => {
        const host = recordingPainter()
        const scene = createTeachingCanvas(host.painter)
        const options = { x: 100, y: 200, width: 800, height: 450, xDomain: [-2, 2] as const, yDomain: [-2, 2] as const, equalUnits }
        expect(() => scene.axes({ ...options, x: NaN })).toThrow('Teaching x must be finite')
        expect(() => scene.axes({ ...options, width: Infinity })).toThrow('Teaching width must be finite')
        expect(() => scene.axes({ ...options, xDomain: [-2, Infinity] })).toThrow('Plot x domain end must be finite')
        expect(() => scene.axes({ ...options, yDomain: [1, 1] })).toThrow('Plot y domain must have a finite positive span')
        expect(() => scene.axes({ ...options, xDomain: [2, -2] })).toThrow('Plot x domain must have a finite positive span')
        expect(host.events).toEqual([])
    })

    it('keeps in-domain scatter marks visible and composes checked opacity', () => {
        const host = recordingPainter()
        const scene = createTeachingCanvas(host.painter)
        const plot = scene.axes({ x: 100, y: 100, width: 200, height: 200, xDomain: [0, 10], yDomain: [0, 10] })
        host.events.length = 0
        const result = scene.scatter({ plot, opacity: 0.4, color: '#0ff', points: [
            { x: 5, y: 5 }, { x: 6, y: 4, radius: 11, color: '#f80' }, { x: -1, y: 3 }, { x: 0, y: 1 },
        ] })
        expect(result).toEqual([{ x: 200, y: 200, radius: 7 }, { x: 220, y: 220, radius: 11 }, { x: 100, y: 280, radius: 7 }])
        expect(host.events).toEqual([
            { kind: 'circle', shape: result[0], fill: '#0ff', alpha: 0.4 },
            { kind: 'circle', shape: result[1], fill: '#f80', alpha: 0.4 },
            { kind: 'circle', shape: result[2], fill: '#0ff', alpha: 0.4 },
        ])
        expect(host.alpha()).toBe(1)
        expect(scene.scatter({ plot, points: [{ x: 1, y: 1 }], opacity: 0 })).toEqual([])
    })

    it('paints complete markers on every domain edge and corner without moving their centers', () => {
        const host = recordingPainter()
        const scene = createTeachingCanvas(host.painter)
        const plot = scene.axes({ x: 100, y: 100, width: 200, height: 200, xDomain: [0, 10], yDomain: [0, 10] })
        host.events.length = 0
        const points = [
            { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 0 }, { x: 10, y: 10 },
            { x: 0, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 0 }, { x: 5, y: 10 },
            { x: 0.1, y: 5, radius: 20 },
        ]
        const marks = scene.scatter({ plot, points })
        expect(marks).toEqual(points.map(({ x, y, radius = 7 }) => ({ ...plot.point(x, y), radius })))
        expect(host.events.map(({ kind }) => kind)).toEqual(points.map(() => 'circle'))
        expect(scene.scatter({ plot, points: [{ x: -0.1, y: 5 }, { x: 10.1, y: 5 }, { x: 5, y: -0.1 }, { x: 5, y: 10.1 }] })).toEqual([])
    })

    it('admits endpoints in data coordinates despite fractional pixel roundoff', () => {
        const host = recordingPainter()
        const scene = createTeachingCanvas(host.painter)
        const plot = scene.axes({ x: 0.3, y: 0.3, width: 0.6, height: 0.6, xDomain: [0, 1], yDomain: [0, 1] })
        expect(plot.point(0, 1).y).toBeLessThan(plot.bounds.y)
        expect(scene.scatter({ plot, points: [{ x: 0, y: 1 }] })).toEqual([{ ...plot.point(0, 1), radius: 7 }])
    })

    it('animates positive bars from a shared baseline and retains zero-value indices', () => {
        const host = recordingPainter()
        const result = createTeachingCanvas(host.painter).bars({
            x: 100, y: 200, width: 340, height: 200, values: [0, 2, 4], labels: ['a', 'b', 'c'],
            colors: ['#f00', '#0f0', '#00f'], max: 4, progress: 0.5, showValues: true, format: (value) => `${value}%`,
        })
        expect(result.bounds).toEqual({ x: 100, y: 200, width: 340, height: 200 })
        expect(result.bars[0]).toBeNull()
        expect(result.bars[1]).toMatchObject({ x: 220, y: 350, width: 100, height: 50 })
        expect(result.bars[2]).toMatchObject({ x: 340, y: 300, width: 100, height: 100 })
        expect(result.slots).toEqual([
            { x: 100, y: 200, width: 100, height: 200 }, { x: 220, y: 200, width: 100, height: 200 }, { x: 340, y: 200, width: 100, height: 200 },
        ])
        expect(host.events.filter(({ kind }) => kind === 'text').map(({ value, y }) => [value, y])).toEqual([
            ['a', 438], ['0%', 386], ['b', 438], ['2%', 336], ['c', 438], ['4%', 286],
        ])
        expect(host.events.filter(({ kind }) => kind === 'rect').map(({ fill }) => fill)).toEqual(['#0f0', '#00f'])
    })

    it('rejects impossible bar layouts and invalid domains before painting', () => {
        const host = recordingPainter()
        const scene = createTeachingCanvas(host.painter)
        const bounds = { x: 0, y: 0, width: 100, height: 100 }
        expect(() => scene.bars({ ...bounds, values: [-1] })).toThrow('nonnegative')
        expect(() => scene.bars({ ...bounds, values: [1, 2], labels: ['one'] })).toThrow('labels must match')
        expect(() => scene.bars({ ...bounds, values: [2], max: 1 })).toThrow('contain every value')
        expect(() => scene.bars({ ...bounds, values: [1, 2], gap: 100 })).toThrow('Bar width')
        expect(() => scene.axes({ ...bounds, xDomain: [1, 1], yDomain: [0, 1] })).toThrow('positive span')
        expect(host.events).toEqual([])
        expect(scene.bars({ ...bounds, values: [] }).bars).toEqual([])
    })

    it('draws connections behind nodes while retaining host geometry proof on connector references', () => {
        const host = recordingPainter()
        const result = createTeachingCanvas(host.painter).flowGraph({
            nodes: [
                { id: 'a', label: 'prompt', x: 20, y: 100, width: 140, height: 70 },
                { id: 'b', label: 'model', x: 300, y: 100, width: 140, height: 70, color: '#f80' },
            ],
            edges: [{ from: 'a', to: 'b', progress: 0.5 }],
        })
        expect(host.events[0]).toMatchObject({ kind: 'connect', source: result.nodes.a, target: result.nodes.b })
        expect(host.events[1]).toMatchObject({ kind: 'circle', shape: { x: 230, y: 135, radius: 7 } })
        expect(host.events[2].kind).toBe('rect')
        expect(result.nodes.a).toMatchObject({ x: 20, y: 100, width: 140, height: 70, auditId: 0 })
        expect(result.nodes.b.auditId).toBe(1)
        expect(result.nodes.a[PROOF]).toBe(true)
        expect(result.routes).toEqual([{ from: { x: 160, y: 135 }, to: { x: 300, y: 135 } }])
        const connection = host.events[0]
        expect(connection.source).toBe(result.nodes.a)
        expect((connection.source as Shape)[PROOF]).toBe(true)
        expect(host.events.filter(({ kind }) => kind === 'container')).toHaveLength(2)
    })

    it('preflights graph identities and edges before invoking the painter', () => {
        const host = recordingPainter()
        const scene = createTeachingCanvas(host.painter)
        const node = { id: 'a', label: 'A', x: 0, y: 0, width: 100, height: 60 }
        expect(() => scene.flowGraph({ nodes: [node, node], edges: [] })).toThrow('unique')
        expect(() => scene.flowGraph({ nodes: [node], edges: [{ from: 'a', to: 'b' }] })).toThrow('existing nodes')
        expect(() => scene.flowGraph({ nodes: [node], edges: [{ from: 'a', to: 'a' }] })).toThrow('distinct nodes')
        expect(() => scene.flowGraph({ nodes: [{ ...node, radius: -1 }], edges: [] })).toThrow('nonnegative')
        const second = { ...node, id: 'b', x: 200 }
        expect(() => scene.flowGraph({ nodes: [node, second], edges: [{ from: 'a', to: 'b', gap: Infinity }] })).toThrow('finite')
        expect(host.events).toEqual([])
    })
})
