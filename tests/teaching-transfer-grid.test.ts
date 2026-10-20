import { describe, expect, it } from 'vitest'
import { createTeachingCanvas, type TeachingPainter } from '../src/teaching-canvas'
import { layoutCellGrid } from '../src/teaching-grid'
import type { CanvasBounds } from '../src/canvas-components'

interface Shape extends CanvasBounds { auditId: number }

function hostPainter() {
    const events: { kind: string, alpha: number, [key: string]: unknown }[] = []
    let alpha = 1, count = 0
    // Analytic ray/circle intersection independently models rounded-card anchors.
    const anchor = (shape: CanvasBounds, toward: CanvasBounds, gap: number) => {
        const x = shape.x + shape.width / 2, y = shape.y + shape.height / 2
        const dx = toward.x + toward.width / 2 - x, dy = toward.y + toward.height / 2 - y
        const length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length
        const halfWidth = shape.width / 2, halfHeight = shape.height / 2
        let distance = Math.min(ux === 0 ? Infinity : halfWidth / Math.abs(ux), uy === 0 ? Infinity : halfHeight / Math.abs(uy))
        const radius = Math.min(shape.radius ?? 0, halfWidth, halfHeight)
        if (radius > 0 && Math.hypot(Math.max(0, Math.abs(ux * distance) - halfWidth + radius), Math.max(0, Math.abs(uy * distance) - halfHeight + radius)) > radius) {
            const cx = Math.sign(ux) * (halfWidth - radius), cy = Math.sign(uy) * (halfHeight - radius)
            const dot = ux * cx + uy * cy
            distance = dot + Math.sqrt(dot * dot - cx * cx - cy * cy + radius * radius)
        }
        return { x: x + ux * (distance + gap), y: y + uy * (distance + gap) }
    }
    const painter: TeachingPainter<Shape> = {
        rect(x, y, width, height, fill, stroke, radius) {
            const shape = { x, y, width, height, radius, auditId: count++ }
            events.push({ kind: 'rect', alpha, shape, fill, stroke })
            return shape
        },
        text(value, x, y, size, color, align) { events.push({ kind: 'text', alpha, value, x, y, size, color, align }) },
        math() {}, line() {}, arrow() {},
        path(points, options) { events.push({ kind: 'path', alpha, points, options }) },
        circle(x, y, radius, fill, stroke, width) { events.push({ kind: 'circle', alpha, x, y, radius, fill, stroke, width }) },
        connect(source, target, options = {}) {
            events.push({ kind: 'connect', alpha, source, target, options })
            return { from: anchor(source, target, options.fromGap ?? options.gap ?? 0), to: anchor(target, source, options.toGap ?? options.gap ?? 0) }
        },
        container(bounds, draw, options) { events.push({ kind: 'container', alpha, bounds, options }); draw() },
        labelScope(bounds, draw, options) { events.push({ kind: 'labelScope', alpha, bounds, options }); draw() },
        opacity(amount, draw) { const previous = alpha; alpha *= amount; try { draw() } finally { alpha = previous } },
    }
    return { painter, events, alpha: () => alpha }
}

describe('coordinated checked transfers', () => {
    it('uses the same endpoint-limited alpha for connector and marker and preserves live host references', () => {
        const host = hostPainter(), teaching = createTeachingCanvas(host.painter)
        const source = { x: 0, y: 0, width: 100, height: 60, auditId: 41 }
        const target = { x: 300, y: 0, width: 100, height: 60, auditId: 42 }
        host.painter.opacity(0.8, () => teaching.transfer({
            source: { shape: source, opacity: 1 }, target: { shape: target, opacity: 0.247 },
            opacity: 0.9, progress: 0.5, color: '#abc', particle: { radius: 10, fill: '#fed' },
        }))
        const [line, marker] = host.events
        expect(line.source).toBe(source)
        expect(line.target).toBe(target)
        expect(line.alpha).toBeCloseTo(0.8 * 0.247)
        expect(marker.alpha).toBe(line.alpha)
        expect(marker).toMatchObject({ kind: 'circle', x: 200, y: 30, radius: 10, fill: '#fed' })
        expect(line.options).toMatchObject({ fromGap: 12, toGap: 12 })
        expect(host.alpha()).toBe(1)
        host.events.length = 0
        expect(teaching.transfer({ source: { shape: source, opacity: 1 }, target: { shape: target, opacity: 0 }, progress: 0.5 })).toBeNull()
        expect(host.events).toEqual([])
    })

    it('keeps complete stroked particles clear of diagonal rounded-card bounds, including near endpoints', () => {
        const host = hostPainter(), transfer = createTeachingCanvas(host.painter).transfer
        const source = { x: 0, y: 0, width: 100, height: 60, radius: 24 }
        const target = { x: 320, y: 210, width: 120, height: 90, radius: 30 }
        const distanceToBox = (x: number, y: number, box: CanvasBounds) => Math.hypot(
            Math.max(box.x - x, 0, x - box.x - box.width), Math.max(box.y - y, 0, y - box.y - box.height),
        )
        for (const progress of [0.000001, 0.25, 0.5, 0.75, 0.999999]) {
            transfer({ source: { shape: source, opacity: 1 }, target: { shape: target, opacity: 1 },
                progress, gap: 0, particle: { radius: 11, stroke: '#fff', strokeWidth: 4 } })
            const marker = host.events.at(-1)!
            for (const box of [source, target]) expect(distanceToBox(marker.x as number, marker.y as number, box)).toBeGreaterThan(14.99)
        }
        host.events.length = 0
        const route = transfer({ source: { shape: source, opacity: 1 }, target: { shape: target, opacity: 1 }, progress: 1, fromGap: 40 })
        expect(route).not.toBeNull()
        expect(host.events).toHaveLength(1)
        expect(host.events[0].options).toMatchObject({ fromGap: 40 })
    })

    it('rejects impossible spacing and invalid options without painting', () => {
        const host = hostPainter(), transfer = createTeachingCanvas(host.painter).transfer
        const source = { shape: { x: 0, y: 0, width: 100, height: 60 }, opacity: 1 }
        const target = { shape: { x: 110, y: 0, width: 100, height: 60 }, opacity: 1 }
        expect(() => transfer({ source, target, progress: 0.5, particle: { radius: 10 } })).toThrow('no room')
        expect(() => transfer({ source, target, gap: -1 })).toThrow('nonnegative')
        expect(() => transfer({ source, target, progress: NaN })).toThrow('finite')
        expect(() => transfer({ source, target, particle: {} })).toThrow('requires progress')
        expect(() => transfer({ source: { ...source, opacity: NaN }, target })).toThrow('finite')
        expect(host.events).toEqual([])
    })
})

describe('bounded dense teaching grids', () => {
    it('represents a 28 by 28 patch grid with one real panel and 54 structural paths', () => {
        const host = hostPainter()
        const grid = createTeachingCanvas(host.painter).grid({ x: 100, y: 200, width: 350, height: 350, rows: 28, columns: 28 })
        expect(host.events.filter(x => x.kind === 'rect')).toHaveLength(1)
        expect(host.events.filter(x => x.kind === 'path')).toHaveLength(54)
        expect(grid.shape).toBe(host.events[0].shape)
        expect(grid.cell(27, 27)).toEqual({ x: 437.5, y: 537.5, width: 12.5, height: 12.5 })
        expect(grid.cell(0, 0)).toBe(grid.cells[0][0])
        for (const event of host.events.filter(x => x.kind === 'path')) {
            for (const point of event.points as { x: number, y: number }[]) {
                expect(point.x).toBeGreaterThanOrEqual(100.5)
                expect(point.x).toBeLessThanOrEqual(449.5)
                expect(point.y).toBeGreaterThanOrEqual(200.5)
                expect(point.y).toBeLessThanOrEqual(549.5)
            }
        }
    })

    it('shares exact cell geometry with scoped labels and sparse checked highlights', () => {
        const host = hostPainter()
        const grid = createTeachingCanvas(host.painter).grid({
            x: 10, y: 20, width: 400, height: 200, rows: 2, columns: 2,
            labels: [['Birds', 'sing'], ['Two\nlines', 4]],
            highlights: [{ row: 0, column: 1, fill: '#fc0', opacity: 0.4 }],
            fontSize: 24, padding: 8,
        })
        const highlight = host.events.filter(x => x.kind === 'rect')[1]
        expect(highlight).toMatchObject({ alpha: 0.4, fill: '#fc0', shape: { x: 212, y: 22, width: 196, height: 96 } })
        expect(host.events.filter(x => x.kind === 'labelScope').map(x => x.bounds)).toEqual(grid.cells.flat())
        expect(host.events.filter(x => x.kind === 'text').map(x => x.value)).toEqual(['Birds', 'sing', 'Two\nlines', '4'])
        expect(host.events.find(x => x.value === 'Two\nlines')).toMatchObject({ x: 110, y: 161.36 })
        expect(layoutCellGrid({ x: 10, y: 20, width: 400, height: 200, rows: 2, columns: 2 }).cells).toEqual(grid.cells)
    })

    it('preflights label dimensions, cell indices and invalid geometry before painting', () => {
        const host = hostPainter(), grid = createTeachingCanvas(host.painter).grid
        const options = { x: 0, y: 0, width: 100, height: 100, rows: 2, columns: 2 }
        expect(() => grid({ ...options, labels: [['one']] })).toThrow('match rows and columns')
        expect(() => grid({ ...options, highlights: [{ row: 2, column: 0, fill: '#fff' }] })).toThrow('outside')
        expect(() => grid({ ...options, lineWidth: 50 })).toThrow('smaller than a cell')
        expect(() => grid({ ...options, rows: 0 })).toThrow('positive safe integers')
        expect(() => grid({ ...options, x: Infinity })).toThrow('finite')
        expect(host.events).toEqual([])
        expect(() => layoutCellGrid(options).cell(0, 0.5)).toThrow('outside')
    })
})
