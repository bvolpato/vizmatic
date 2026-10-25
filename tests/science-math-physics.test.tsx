import React from 'react'
import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'
import { getThemeColors } from '../src/theme'
import { analyzeContrast } from '../src/diagnostics'
import { renderToSvg } from '../src/render'
import { SvgMathText } from '../src/primitives/layout'
import {
    FreeBodyDiagram,
    GeometryDiagram,
    geometryBounds,
    mapNumberLine,
    NumberLine,
    sampleWave,
    sumForces,
    waveValue,
    WaveDiagram,
} from '../src/primitives/science-math-physics'

function props(element: React.ReactElement): Record<string, any> {
    return element.props as Record<string, any>
}

function collect(
    node: React.ReactNode,
    matches: (element: React.ReactElement) => boolean,
): React.ReactElement[] {
    const found: React.ReactElement[] = []
    React.Children.forEach(node, (child) => {
        if (!React.isValidElement(child)) return
        const element = child as React.ReactElement
        if (matches(element)) found.push(element)
        found.push(...collect(props(element).children as React.ReactNode, matches))
    })
    return found
}

function labels(element: React.ReactElement): string[] {
    return collect(element, (child) => child.type === SvgMathText)
        .map((child) => String(props(child).text ?? ''))
}

describe('science, math, and physics primitives', () => {
    it('keeps number-line positions proportional and represents interval endpoint inclusion', () => {
        expect(mapNumberLine(0, 0, 10, 720)).toBe(56)
        expect(mapNumberLine(5, 0, 10, 720)).toBe(360)
        expect(mapNumberLine(10, 0, 10, 720)).toBe(664)

        const diagram = NumberLine({
            c: getThemeColors('light'),
            min: 0,
            max: 10,
            ticks: [{ value: 0 }, { value: 5, label: 'halfway' }, { value: 10 }],
            markers: [{ id: 'h', value: 2.5, label: 'h = 2.5' }],
            interval: { from: 2, to: 8, includeFrom: true, includeTo: false, label: '[2, 8)' },
        })
        const endpoints = collect(diagram, (element) => element.type === 'circle' && Number(props(element).cy) > 200 && props(element).stroke === '#0891b2')
        expect(endpoints.map((element) => props(element).fill)).toEqual(['#0891b2', '#f5f7fa'])
        expect(labels(diagram)).toContain('[2, 8)')
        expect(props(diagram).role).toBe('img')
    })

    it('rejects invalid or clipped number-line domains and supports compact marker guides', () => {
        expect(() => mapNumberLine(11, 0, 10, 720)).toThrow(RangeError)
        expect(() => NumberLine({ c: getThemeColors('dark'), min: 2, max: 2 })).toThrow('finite increasing domain')
        expect(() => NumberLine({
            c: getThemeColors('dark'), min: 0, max: 10,
            interval: { from: 8, to: 12 },
        })).toThrow('lie within its domain')
        expect(() => NumberLine({
            c: getThemeColors('dark'), min: 0, max: 10, height: 132,
            interval: { from: 2, to: 8, label: 'interval' },
        })).toThrow('at least 180 pixels')
        expect(() => NumberLine({
            c: getThemeColors('dark'), min: 0, max: 10, height: 200,
            interval: { from: 2, to: 8, label: 'interval' },
        })).toThrow('Labeled NumberLine intervals require at least 220 pixels')
        const compact = NumberLine({
            c: getThemeColors('dark'), min: 0, max: 1.8, height: 132,
            ticks: [{ value: 0 }, { value: 0.6 }, { value: 1.2 }, { value: 1.8 }],
            markers: [{ id: 'h', value: 0.9, label: 'h' }],
        })
        expect(props(compact).style.height).toBe(132)
        const compactInterval = NumberLine({
            c: getThemeColors('light'), min: 0, max: 1, height: 180,
            ticks: [{ value: 0.2 }, { value: 0.8 }],
            interval: { from: 0.2, to: 0.8 },
        })
        expect(props(compactInterval).style.height).toBe(180)
        const compactIntervalStroke = collect(compactInterval, (element) => element.type === 'line' && element.key === 'interval')[0]
        const compactTickLabels = collect(compactInterval, (element) => element.type === SvgMathText && ['0.2', '0.8'].includes(String(props(element).text)))
        expect(Number(props(compactIntervalStroke).y1) - 7).toBeGreaterThan(Math.max(...compactTickLabels.map((element) => Number(props(element).y))))
        const labeledInterval = NumberLine({
            c: getThemeColors('light'), min: 0, max: 1, height: 220,
            interval: { from: 0.2, to: 0.8, label: '[0.2, 0.8]' },
        })
        const labeledIntervalLabel = collect(labeledInterval, (element) => element.type === SvgMathText && props(element).text === '[0.2, 0.8]')[0]
        expect(Number(props(labeledIntervalLabel).y)).toBeLessThanOrEqual(Number(props(labeledInterval).style.height) - 15)
    })

    it('maps geometry with equal units and builds only explicitly referenced segments and angles', () => {
        expect(geometryBounds([
            { id: 'A', x: -2, y: 1 },
            { id: 'B', x: 2, y: 1 },
            { id: 'C', x: 2, y: 3 },
        ])).toEqual({ minX: -2, maxX: 2, minY: 1, maxY: 3, width: 4, height: 2 })
        const diagram = GeometryDiagram({
            c: getThemeColors('dark'),
            points: [
                { id: 'A', x: 0, y: 0, label: 'A' },
                { id: 'B', x: 4, y: 0, label: 'B' },
                { id: 'C', x: 4, y: 2, label: 'C' },
            ],
            segments: [{ from: 'A', to: 'B', label: 'AB' }, { from: 'B', to: 'C', label: 'BC' }],
            angles: [{ vertex: 'B', from: 'A', to: 'C', label: 'θ' }],
        })
        const circles = collect(diagram, (element) => element.type === 'circle' && Number(props(element).r) === 5.5)
        const [a, b, c] = circles.map((element) => ({ x: Number(props(element).cx), y: Number(props(element).cy) }))
        expect(Math.abs(b.x - a.x) / Math.abs(c.y - b.y)).toBeCloseTo(2)
        expect(collect(diagram, (element) => element.type === 'path')).toHaveLength(1)
        expect(collect(diagram, (element) => element.type === 'line')).toHaveLength(2)
    })

    it('rejects missing, degenerate, and excessive geometry references', () => {
        const c = getThemeColors('light')
        expect(() => GeometryDiagram({ c, points: [{ id: 'A', x: 0, y: 0 }, { id: 'A', x: 1, y: 1 }] })).toThrow('duplicate id')
        expect(() => GeometryDiagram({
            c,
            points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 1, y: 1 }],
            segments: [{ from: 'A', to: 'missing' }],
        })).toThrow('references a missing point')
        expect(() => GeometryDiagram({
            c,
            points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 1, y: 0 }],
            segments: Array.from({ length: 257 }, () => ({ from: 'A', to: 'B' })),
        })).toThrow('between 0 and 256')
        expect(() => GeometryDiagram({
            c,
            points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 1, y: 0 }, { id: 'C', x: 2, y: 0 }],
            angles: [{ vertex: 'A', from: 'B', to: 'C' }],
        })).toThrow('degenerate')
        expect(() => GeometryDiagram({
            c,
            points: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 1, y: 0 }, { id: 'C', x: 0, y: 1 }],
            angles: Array.from({ length: 65 }, () => ({ vertex: 'A', from: 'B', to: 'C' })),
        })).toThrow('between 0 and 64')
        expect(() => geometryBounds([{ id: 'A', x: 0, y: Number.NaN }])).toThrow('must be finite')
        expect(() => GeometryDiagram({ c, points: Array.from({ length: 129 }, (_, i) => ({ id: `p${i}`, x: i, y: i })) })).toThrow('between 1 and 128')
    })

    it('sums force components and maps positive physical y upward', () => {
        const forces = [
            { id: 'weight', label: 'weight', x: 0, y: -10 },
            { id: 'normal', label: 'normal', x: 0, y: 10 },
            { id: 'push', label: 'push', x: 6, y: 0 },
        ]
        expect(sumForces(forces)).toEqual({ x: 6, y: 0, magnitude: 6 })
        const diagram = FreeBodyDiagram({ c: getThemeColors('light'), forces, showComponents: true })
        const push = collect(diagram, (element) => element.type === 'g' && props(element)['data-vector-id'] === 'push')[0]
        const forceLine = React.Children.toArray(props(push).children).find((child) => React.isValidElement(child) && child.type === 'line') as React.ReactElement
        expect(Number(props(forceLine).x2)).toBeGreaterThan(Number(props(forceLine).x1))
        const normal = collect(diagram, (element) => element.type === 'g' && props(element)['data-vector-id'] === 'normal')[0]
        const normalLine = React.Children.toArray(props(normal).children).find((child) => React.isValidElement(child) && child.type === 'line') as React.ReactElement
        expect(Number(props(normalLine).y2)).toBeLessThan(Number(props(normalLine).y1))
        expect(collect(diagram, (element) => element.type === 'line' && props(element).strokeDasharray === '5 5')).toHaveLength(3)
    })

    it('does not draw a phantom arrow when the resultant is exactly zero', () => {
        const diagram = FreeBodyDiagram({
            c: getThemeColors('dark'),
            forces: [{ id: 'left', label: 'left', x: -4, y: 0 }, { id: 'right', label: 'right', x: 4, y: 0 }],
        })
        expect(collect(diagram, (element) => element.type === 'g' && props(element)['data-vector-role'] === 'force')).toHaveLength(2)
        expect(collect(diagram, (element) => element.type === 'g' && props(element)['data-vector-role'] === 'resultant')).toHaveLength(0)
        expect(labels(diagram)).toContain('R = 0')
        expect(() => sumForces([{ id: 'huge-a', label: 'a', x: Number.MAX_VALUE, y: 0 }, { id: 'huge-b', label: 'b', x: Number.MAX_VALUE, y: 0 }])).toThrow('must be finite')
        expect(() => FreeBodyDiagram({ c: getThemeColors('dark'), forces: [{ id: 'zero', label: 'zero', x: 0, y: 0 }] })).toThrow('non-zero magnitude')
        expect(() => FreeBodyDiagram({
            c: getThemeColors('dark'),
            forces: Array.from({ length: 33 }, (_, i) => ({ id: `f${i}`, label: `f${i}`, x: 1, y: 0 })),
        })).toThrow('between 1 and 32')
    })

    it('keeps a 10:1 force pair to scale and visibly draws the shorter arrow across the body marker', async () => {
        const c = getThemeColors('light')
        const forces = [
            { id: 'large', label: '100 N', x: 100, y: 0, color: '#e11d48' },
            { id: 'small', label: '10 N', x: 0, y: 10, color: '#00c853' },
        ]
        const diagram = FreeBodyDiagram({ c, forces, showResultant: false })
        const vectorLine = (id: string): React.ReactElement => {
            const group = collect(diagram, (element) => element.type === 'g' && props(element)['data-vector-id'] === id)[0]
            return React.Children.toArray(props(group).children).find((child) => React.isValidElement(child) && child.type === 'line') as React.ReactElement
        }
        const largeLine = props(vectorLine('large'))
        const smallLine = props(vectorLine('small'))
        const largeLength = Math.hypot(Number(largeLine.x2) - Number(largeLine.x1), Number(largeLine.y2) - Number(largeLine.y1))
        const smallLength = Math.hypot(Number(smallLine.x2) - Number(smallLine.x1), Number(smallLine.y2) - Number(smallLine.y1))
        expect(largeLength / smallLength).toBeCloseTo(10)

        const svg = await renderToSvg(diagram, Number(props(diagram).style.width), Number(props(diagram).style.height))
        const rendered = new Resvg(svg).render()
        const centerY = Number(props(diagram).style.height) * 0.56
        const scale = smallLength / 10
        const sampleX = Math.round(Number(props(diagram).style.width) / 2)
        const sampleY = Math.round(centerY - 7 * scale)
        const pixel = (sampleY * rendered.width + sampleX) * 4
        expect(rendered.pixels[pixel + 1]).toBeGreaterThan(rendered.pixels[pixel] + 80)
    })

    it('uses readable force-label text in both theme palettes', () => {
        for (const mode of ['dark', 'light'] as const) {
            const c = getThemeColors(mode)
            const diagram = FreeBodyDiagram({
                c,
                forces: [{ id: 'force', label: 'small force', x: 0, y: 1, color: c.secondary }],
                showResultant: false,
            })
            expect(analyzeContrast(diagram, mode, new Set(), c.bgSubtle)).not.toContainEqual(expect.objectContaining({
                code: 'accessibility.low_contrast',
            }))
        }
    })

    it('computes a traveling sinusoid and a signed pointwise sum', () => {
        const first = { amplitude: 2, wavelength: 4, phase: 0, speed: 1 }
        const opposite = { amplitude: 2, wavelength: 4, phase: Math.PI, speed: 1 }
        expect(waveValue(first, 1, 0)).toBeCloseTo(2)
        expect(waveValue(first, 1, 1)).toBeCloseTo(0)
        expect(waveValue(first, 1, 0) + waveValue(opposite, 1, 0)).toBeCloseTo(0)
        const points = sampleWave(first, 0, 4, 0)
        expect(points).toHaveLength(192)
        expect(points[0]).toEqual({ x: 0, y: 0 })
        expect(points.at(-1)?.x).toBe(4)
        expect(points.at(-1)?.y).toBeCloseTo(0)
        const diagram = WaveDiagram({ c: getThemeColors('dark'), waves: [first], time: 0.5, xMin: 0, xMax: 4 })
        expect(labels(diagram)).toContain('t = 0.5')
        expect(props(diagram)['aria-description']).toContain('φ=0, v=1')
    })

    it('rejects unclipped, invalid, and unbounded wave inputs', () => {
        const c = getThemeColors('light')
        const waves = [{ amplitude: 2, wavelength: 1, label: 'incident' }]
        expect(() => waveValue({ amplitude: 1, wavelength: 0 }, 0, 0)).toThrow('greater than zero')
        expect(() => sampleWave(waves[0], 0, 1, 0, 512)).toThrow('from 128 to 256')
        expect(() => WaveDiagram({ c, waves, time: 0, xMin: 1, xMax: 1 })).toThrow('increasing domain')
        expect(() => WaveDiagram({ c, waves, time: 0, xMin: 0, xMax: 1, yMin: -1, yMax: 1 })).toThrow('avoid clipping')
        expect(() => WaveDiagram({ c, waves: Array.from({ length: 9 }, () => ({ amplitude: 1, wavelength: 1 })), time: 0, xMin: 0, xMax: 1 })).toThrow('between 1 and 8')
        expect(() => WaveDiagram({ c, waves, time: 0, xMin: 0, xMax: 1, showSum: false, showComponents: false })).toThrow('must show')
    })

    it('renders every primitive as accessible SVG in dark and light themes', async () => {
        for (const mode of ['dark', 'light'] as const) {
            const c = getThemeColors(mode)
            const diagrams = [
                NumberLine({ c, min: -2, max: 2, markers: [{ id: 'zero', value: 0, label: 'origin' }] }),
                GeometryDiagram({ c, points: [{ id: 'A', x: 0, y: 0, label: 'A' }, { id: 'B', x: 3, y: 0, label: 'B' }, { id: 'C', x: 0, y: 2, label: 'C' }], segments: [{ from: 'A', to: 'B' }, { from: 'A', to: 'C' }], angles: [{ vertex: 'A', from: 'B', to: 'C', label: '90°' }] }),
                FreeBodyDiagram({ c, forces: [{ id: 'gravity', label: 'gravity', x: 0, y: -9.8 }, { id: 'normal', label: 'normal', x: 0, y: 9.8 }] }),
                WaveDiagram({ c, waves: [{ amplitude: 1, wavelength: 4, speed: 0.5, label: 'pulse' }], time: 0.5, xMin: -4, xMax: 4 }),
            ]
            for (const diagram of diagrams) {
                const svg = await renderToSvg(diagram, Number(props(diagram).style.width), Number(props(diagram).style.height))
                expect(svg).toContain('<svg')
                expect(svg).toContain('data:image/svg+xml')
                expect(collect(diagram, (child) => child.type === 'title')).toHaveLength(1)
                expect(collect(diagram, (child) => child.type === 'desc')).toHaveLength(1)
                expect(props(diagram).role).toBe('img')
                expect(props(diagram)['aria-label']).toBeDefined()
                expect(svg).toContain(encodeURIComponent(mode === 'dark' ? '#151620' : '#f5f7fa'))
            }
        }
    })
})
