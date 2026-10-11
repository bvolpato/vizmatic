import React from 'react'
import { describe, expect, it } from 'vitest'
import { getThemeColors, renderToBuffer, renderToSvg } from '../src'
import { ParetoBarChart, PieChart } from '../src/primitives/charts'

function findElements(
    value: unknown,
    predicate: (element: React.ReactElement) => boolean,
    found: React.ReactElement[] = [],
): React.ReactElement[] {
    if (Array.isArray(value)) {
        for (const child of value) findElements(child, predicate, found)
        return found
    }
    if (!React.isValidElement(value)) return found
    const element = value as React.ReactElement<Record<string, unknown> & { children?: unknown }>
    if (predicate(element)) found.push(element)
    findElements(element.props.children, predicate, found)
    return found
}

function props(element: React.ReactElement): Record<string, unknown> {
    return element.props as Record<string, unknown>
}

describe('categorical chart formats', () => {
    it('renders readable pie wedges and handles a single full-circle slice', async () => {
        const c = getThemeColors('light')
        const chart = PieChart({
            c,
            title: 'Requests',
            segments: [
                { label: 'Success', value: 7, color: 'positive' },
                { label: 'Retry', value: 2, color: 'warning' },
                { label: 'Failure', value: 1, color: 'critical' },
            ],
        })
        const paths = findElements(chart, (element) => element.type === 'path')
        expect(paths).toHaveLength(3)
        expect(paths.map((path) => Number(props(path)['data-pie-share']))).toEqual([0.7, 0.2, 0.1])
        expect(findElements(chart, (element) => element.type === 'span' && props(element).children === 'Success')).toHaveLength(1)

        const single = PieChart({ c, segments: [{ label: 'All', value: 10 }] })
        const singlePath = findElements(single, (element) => element.type === 'path')[0]
        expect(String(props(singlePath).d).match(/ A /g)).toHaveLength(2)

        const zeroTotal = PieChart({ c, segments: [{ label: 'Empty', value: 0 }] })
        expect(findElements(zeroTotal, (element) => element.type === 'path')).toHaveLength(0)
        expect(findElements(zeroTotal, (element) => element.type === 'circle')).toHaveLength(1)

        expect(() => PieChart({ c, segments: [{ label: 'Bad', value: -1 }] })).toThrow(RangeError)
        expect(() => PieChart({ c, segments: [{ label: 'Bad', value: Number.NaN }] })).toThrow('PieChart values must be finite, non-negative numbers.')
        expect(() => PieChart({ c, segments: [{ label: 'A', value: Number.MAX_VALUE }, { label: 'B', value: Number.MAX_VALUE }] }))
            .toThrow('PieChart total must be finite.')
    })

    it('sorts Pareto bars stably and ends positive totals at exactly 100 percent', () => {
        const chart = ParetoBarChart({
            c: getThemeColors('dark'),
            data: [
                { label: 'first tie', value: 5 },
                { label: 'small', value: 2 },
                { label: 'second tie', value: 5 },
            ],
        })
        const bars = findElements(chart, (element) => element.type === 'rect' && 'data-pareto-order' in props(element))
        expect(bars.map((bar) => props(bar)['data-pareto-bar'])).toEqual(['first tie', 'second tie', 'small'])
        expect(bars.map((bar) => Number(props(bar)['data-pareto-order']))).toEqual([0, 1, 2])
        const cumulativePoints = findElements(chart, (element) => element.type === 'circle' && 'data-pareto-cumulative-percent' in props(element))
        expect(cumulativePoints.map((point) => Number(props(point)['data-pareto-cumulative-percent']))).toEqual([
            100 / 12 * 5,
            100 / 12 * 10,
            100,
        ])
        expect(cumulativePoints.map((point) => Number(props(point)['data-pareto-source-index']))).toEqual([0, 2, 1])
        expect(props(cumulativePoints.at(-1)!)['data-pareto-category']).toBe('small')

        const zeroTotal = ParetoBarChart({ c: getThemeColors('light'), data: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }] })
        const zeroPoints = findElements(zeroTotal, (element) => element.type === 'circle' && 'data-pareto-cumulative-percent' in props(element))
        expect(zeroPoints.map((point) => Number(props(point)['data-pareto-cumulative-percent']))).toEqual([0, 0])
        expect(() => ParetoBarChart({ c: getThemeColors('light'), data: [{ label: 'bad', value: Number.POSITIVE_INFINITY }] }))
            .toThrow('ParetoBarChart values must be finite, non-negative numbers.')
        expect(() => ParetoBarChart({ c: getThemeColors('light'), data: [{ label: 'bad', value: -1 }] })).toThrow(RangeError)
        expect(() => ParetoBarChart({ c: getThemeColors('light'), data: [{ label: 'A', value: Number.MAX_VALUE }, { label: 'B', value: Number.MAX_VALUE }] }))
            .toThrow('ParetoBarChart total must be finite.')
    })

    it('renders pie and Pareto bar charts to SVG and PNG in both themes', async () => {
        for (const theme of ['dark', 'light'] as const) {
            const c = getThemeColors(theme)
            const pie = React.createElement(PieChart, {
                c,
                title: `${theme} pie`,
                segments: [
                    { label: 'Success', value: 3, color: 'primary' },
                    { label: 'Retry', value: 2, color: 'secondary' },
                ],
            })
            const pareto = React.createElement(ParetoBarChart, {
                c,
                title: `${theme} Pareto`,
                data: [
                    { label: 'Setup', value: 8, color: 'primary' },
                    { label: 'Authentication', value: 3, color: 'warning' },
                    { label: 'Other', value: 1, color: 'positive' },
                ],
            })
            const pieSvg = findElements(PieChart({
                c,
                title: `${theme} pie`,
                segments: [{ label: 'Success', value: 3 }, { label: 'Retry', value: 2 }],
            }), (element) => element.type === 'svg')[0]
            const paretoSvg = findElements(ParetoBarChart({
                c,
                title: `${theme} Pareto`,
                data: [{ label: 'Setup', value: 8 }, { label: 'Other', value: 2 }],
            }), (element) => element.type === 'svg')[0]
            expect(props(pieSvg)).toMatchObject({ role: 'img', 'aria-label': `${theme} pie` })
            expect(props(paretoSvg)).toMatchObject({ role: 'img', 'aria-label': `${theme} Pareto` })
            const svg = await renderToSvg(React.createElement(React.Fragment, {}, pie, pareto), 900, 420)
            expect(svg).toContain(`${theme} pie`)
            expect(svg).toContain('Success')
            expect(svg).toContain('Authentication')
            expect(svg).not.toContain('<title')
            expect(svg).toContain('data-pareto-cumulative-line')
            expect(svg).not.toContain('NaN')

            const png = await renderToBuffer(React.createElement(React.Fragment, {}, pie, pareto), 900, 420, { scale: 1 })
            expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
        }
    }, 30_000)
})
