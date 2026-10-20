import { describe, expect, it } from 'vitest'
import { createCanvasComponents, layoutTokenRow, type CanvasBounds, type CanvasPainter } from '../src/canvas-components'

interface RecordedShape extends CanvasBounds {
    fill?: string
    stroke?: string
    alpha: number
    auditId: number
}

function recordingPainter() {
    let alpha = 1
    const events: unknown[][] = []
    const shapes: RecordedShape[] = []
    const labels: { value: string, x: number, y: number, size: number, alpha: number, color?: string, align?: string, font?: string }[] = []
    const painter: CanvasPainter<RecordedShape> = {
        rect(x, y, width, height, fill, stroke, radius) {
            const shape = { x, y, width, height, radius, fill, stroke, alpha, auditId: shapes.length }
            shapes.push(shape)
            events.push(['rect', shape])
            return shape
        },
        text(value, x, y, size, color, align, font) {
            const label = { value, x, y, size, color, align, font, alpha }
            labels.push(label)
            events.push(['text', label])
        },
        container(bounds, draw, options) {
            events.push(['container:start', bounds, options])
            try { draw() } finally { events.push(['container:end']) }
        },
        labelScope(bounds, draw, options) {
            events.push(['label:start', bounds, options])
            try { draw() } finally { events.push(['label:end']) }
        },
        opacity(amount, draw) {
            const previous = alpha
            alpha *= amount
            events.push(['opacity:start', amount])
            try { draw() } finally {
                alpha = previous
                events.push(['opacity:end'])
            }
        },
        circle(x, y, radius, fill, stroke, width) {
            events.push(['circle', x, y, radius, fill, stroke, width, alpha])
        },
    }
    return { painter, events, shapes, labels, alpha: () => alpha }
}

describe('injected Canvas components', () => {
    it('returns host geometry and runs panel content inside the selected checked scope', () => {
        const host = recordingPainter()
        const components = createCanvasComponents(host.painter)
        const shape = components.panel({ x: 10, y: 20, width: 200, height: 80, id: 'node', padding: 8 }, () => {
            host.events.push(['content'])
        })

        expect(shape).toBe(host.shapes[0])
        expect(shape).toMatchObject({ x: 10, y: 20, width: 200, height: 80, radius: 14, alpha: 1, auditId: 0 })
        expect(host.events.map(([event]) => event)).toEqual([
            'opacity:start', 'rect', 'container:start', 'content', 'container:end', 'opacity:end',
        ])
        expect(host.events[2]).toEqual([
            'container:start', { x: 10, y: 20, width: 200, height: 80, radius: 14 }, { padding: 8, id: 'node' },
        ])

        host.events.length = 0
        components.panel({ x: 0, y: 0, width: 50, height: 50 })
        expect(host.events.map(([event]) => event)).toEqual(['opacity:start', 'rect', 'opacity:end'])
    })

    it('fades labels independently while preserving frame opacity, alignment, and label scopes', () => {
        const host = recordingPainter()
        const components = createCanvasComponents(host.painter)
        const shape = components.card({
            x: 100, y: 50, width: 104, height: 60, label: 42,
            fontSize: 26, baselineOffset: 9, font: 'mono', textColor: '#fff',
            opacity: 0.4, labelOpacity: 0.25, scope: 'label',
        })

        expect(shape.alpha).toBe(0.4)
        expect(host.labels).toEqual([{
            value: '42', x: 152, y: 89, size: 26, font: 'mono', color: '#fff', align: 'center', alpha: 0.1,
        }])
        expect(host.events.some(([event]) => event === 'label:start')).toBe(true)
        expect(host.events.some(([event]) => event === 'container:start')).toBe(false)
        components.card({ x: 0, y: 0, width: 100, height: 50, label: 'hidden', labelOpacity: 0 })
        expect(host.shapes[1].alpha).toBe(1)
        expect(host.labels).toHaveLength(1)
    })

    it('keeps zero-opacity card geometry available for connector anchors', () => {
        const host = recordingPainter()
        const shape = createCanvasComponents(host.painter).card({
            x: 80, y: 40, width: 120, height: 70, label: 'later', opacity: 0,
        })
        expect(shape).toBe(host.shapes[0])
        expect(shape.alpha).toBe(0)
        expect(shape.x + shape.width / 2).toBe(140)
        expect(host.labels[0].alpha).toBe(0)
    })

    it('normalizes finite opacity before delegating paint and composing token reveals', () => {
        const host = recordingPainter()
        const components = createCanvasComponents(host.painter)
        const hidden = components.card({ x: 0, y: 0, width: 100, height: 50, label: 'hidden', opacity: -1 })
        expect(hidden).toBe(host.shapes[0])
        expect(hidden.alpha).toBe(0)
        expect(host.labels[0].alpha).toBe(0)
        const opaque = components.card({
            x: 0, y: 0, width: 100, height: 50, label: 'visible', opacity: 2, labelOpacity: 2,
        })
        expect(opaque.alpha).toBe(1)
        expect(host.labels[1].alpha).toBe(1)
        components.card({ x: 0, y: 0, width: 100, height: 50, label: 'later', labelOpacity: -1 })
        expect(host.labels).toHaveLength(2)

        components.fade(2, () => host.painter.rect(0, 0, 10, 10))
        expect(host.shapes.at(-1)?.alpha).toBe(1)
        const row = components.tokenRow({ values: ['first', 'second'], y: 100, opacity: 2, reveal: 0.25 })
        expect(row.map(({ alpha }) => alpha)).toEqual([0.5])
        expect(components.tokenRow({ values: ['hidden'], y: 100, opacity: -1 })).toEqual([])
        const matrix = components.matrix({
            values: [[-1, 2]], x: 0, y: 200,
            cellStyle: (value) => ({ opacity: value, labelOpacity: 2 }),
        })
        expect(matrix.map(({ alpha }) => alpha)).toEqual([1])
        expect(host.labels.at(-1)?.alpha).toBe(1)
        expect(host.events.filter(([event]) => event === 'opacity:start').every(([, amount]) =>
            typeof amount === 'number' && amount >= 0 && amount <= 1,
        )).toBe(true)
    })

    it('positions rectangular matrix cells and applies per-cell reveal and formatting', () => {
        const host = recordingPainter()
        const visits: [number, number, number][] = []
        const result = createCanvasComponents(host.painter).matrix({
            values: [[1, -2], [3, 4]], x: 50, y: 80, cellSize: 100, gap: 10, inset: 4,
            style: { fill: '#222', fontSize: 20, labelOpacity: 0.5 },
            cellStyle: (value, row, column) => {
                visits.push([value, row, column])
                return value === -2 ? { opacity: 0 } : { opacity: value / 4, fill: value === 4 ? '#f80' : '#222' }
            },
            format: (value, row, column) => `${row}:${column}=${value}`,
        })

        expect(visits).toEqual([[1, 0, 0], [-2, 0, 1], [3, 1, 0], [4, 1, 1]])
        expect(result).toEqual(host.shapes)
        expect(result.map(({ x, y, width, height, alpha, fill }) => ({ x, y, width, height, alpha, fill }))).toEqual([
            { x: 54, y: 84, width: 90, height: 90, alpha: 0.25, fill: '#222' },
            { x: 54, y: 184, width: 90, height: 90, alpha: 0.75, fill: '#222' },
            { x: 154, y: 184, width: 90, height: 90, alpha: 1, fill: '#f80' },
        ])
        expect(host.labels.map(({ value, alpha }) => ({ value, alpha }))).toEqual([
            { value: '0:0=1', alpha: 0.125 }, { value: '1:0=3', alpha: 0.375 }, { value: '1:1=4', alpha: 0.5 },
        ])
    })

    it('rejects ragged matrices before painting and permits empty matrices', () => {
        const host = recordingPainter()
        const components = createCanvasComponents(host.painter)
        expect(() => components.matrix({ values: [[1], [2, 3]], x: 0, y: 0 })).toThrow('rows must be rectangular')
        expect(host.events).toEqual([])
        expect(components.matrix({ values: [], x: 0, y: 0 })).toEqual([])
        expect(components.matrix({ values: [[], []], x: 0, y: 0 })).toEqual([])
    })

    it('lays out literal spelling and fixed widths without changing input values', () => {
        const values = ['a', 'hello', 42] as const
        expect(layoutTokenRow(values, { centerX: 500 })).toEqual([
            { text: 'a', x: 334, width: 64 },
            { text: 'hello', x: 414, width: 154 },
            { text: '42', x: 584, width: 82 },
        ])
        expect(layoutTokenRow(['dogs', 'chase', 'cats'], { x: 10, centerX: 999, width: 104, gap: 12 })).toEqual([
            { text: 'dogs', x: 10, width: 104 },
            { text: 'chase', x: 126, width: 104 },
            { text: 'cats', x: 242, width: 104 },
        ])
        expect(values).toEqual(['a', 'hello', 42])
        expect(layoutTokenRow([], { centerX: 200 })).toEqual([])
    })

    it('reveals token rows by item and composes the requested fixed card style', () => {
        const host = recordingPainter()
        const result = createCanvasComponents(host.painter).tokenRow({
            values: ['dogs', 'chase', 'cats'], x: 20, y: 100,
            width: 104, height: 60, gap: 12, fontSize: 26, baselineOffset: 9,
            scope: 'label', reveal: 0.5, opacity: 0.8,
        })
        expect(result).toHaveLength(2)
        expect(result.map(({ x, y, width, height, alpha }) => ({ x, y, width, height, alpha }))).toEqual([
            { x: 20, y: 100, width: 104, height: 60, alpha: 0.8 },
            { x: 136, y: 100, width: 104, height: 60, alpha: 0.4 },
        ])
        expect(host.labels.map(({ value, x, y }) => ({ value, x, y }))).toEqual([
            { value: 'dogs', x: 72, y: 139 }, { value: 'chase', x: 188, y: 139 },
        ])
        expect(host.events.filter(([event]) => event === 'label:start')).toHaveLength(2)
    })

    it('moves particles by route length and leaves the endpoints unpainted', () => {
        const host = recordingPainter()
        const components = createCanvasComponents(host.painter)
        const points = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]
        expect(components.particle({ points, progress: 0.5, fill: '#fc0' })).toEqual({ x: 3, y: 0.5 })
        expect(host.events).toEqual([['circle', 3, 0.5, 9, '#fc0', undefined, 3, 1]])
        expect(components.particle({ points, progress: 0, fill: '#fc0' })).toBeNull()
        expect(components.particle({ points, progress: 1, fill: '#fc0' })).toBeNull()
        expect(host.events).toHaveLength(1)
        expect(() => components.particle({ points: [], progress: 0.5, fill: '#fc0' })).toThrow('empty path')
    })

    it('delegates opacity cleanup on exceptions and skips invisible fade callbacks', () => {
        const host = recordingPainter()
        const components = createCanvasComponents(host.painter)
        const failure = new Error('checked draw failed')
        expect(() => components.fade(0.4, () => {
            components.panel({ x: 0, y: 0, width: 100, height: 50, opacity: 0.5 }, () => { throw failure })
        })).toThrow(failure)
        expect(host.alpha()).toBe(1)
        expect(host.events.at(-1)).toEqual(['opacity:end'])
        const count = host.events.length
        components.fade(0, () => { throw failure })
        components.fade(-1, () => { throw failure })
        expect(host.events).toHaveLength(count)
    })

    it('rejects invalid geometry and opacity before delegating paint', () => {
        const host = recordingPainter()
        const components = createCanvasComponents(host.painter)
        expect(() => components.panel({ x: NaN, y: 0, width: 1, height: 1 })).toThrow('Canvas x must be finite')
        expect(() => components.card({ x: 0, y: 0, width: -1, height: 1, label: 'a' })).toThrow('Canvas width must be positive')
        expect(() => components.matrix({ values: [[1]], x: 0, y: 0, cellSize: 10, gap: 10 })).toThrow('gap must be smaller')
        expect(() => components.fade(Infinity, () => {})).toThrow('Canvas opacity must be finite')
        expect(() => layoutTokenRow(['a'], { width: 0 })).toThrow('Token width must be positive')
        expect(() => components.particle({ points: [{ x: 0, y: 0 }], progress: NaN, fill: '#fff' })).toThrow('Particle progress must be finite')
        expect(host.events).toEqual([])
    })
})
