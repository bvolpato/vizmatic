import React from 'react'
import { transform } from 'sucrase'
import { describe, expect, it } from 'vitest'
import {
    Board, CanvasItem, BarChart, LineChart, ScatterPlot, ParetoChart, ParetoBarChart,
    IntervalPlot, QuadrantChart, PieChart, DonutChart, StackedBar, getThemeColors, renderToSvg, type SatoriNode,
} from '../src'
import { createPlaygroundApi } from '../src/playground-api'
import { mapPlaygroundText, prepareEditableText, editableCanvasItems, editableTextTargets } from '../src/playground-text-mapping'
import { preparePlaygroundSource } from '../src/playground-source'

const c = getThemeColors('dark')
const heading = {
    c, title: 'Requests across services', subtitle: 'Successes, retries, and failures in production', footer: 'Source: service telemetry',
}
const values = [{ label: 'Successful', value: 820 }, { label: 'Retried', value: 280 }, { label: 'Failed', value: 140 }]
const points = [{ label: 'A', x: 0.2, y: 0.7 }, { label: 'B', x: 0.6, y: 0.3 }]
const charts = [
    ['BarChart', <BarChart {...heading} data={values} />],
    ['LineChart', <LineChart {...heading} labels={['Jan', 'Feb', 'Mar']} series={[{ name: 'Requests', points: [4, 6, 5] }]} />],
    ['ScatterPlot', <ScatterPlot {...heading} points={points} />],
    ['ParetoChart', <ParetoChart {...heading} points={points} />],
    ['ParetoBarChart', <ParetoBarChart {...heading} data={values} />],
    ['IntervalPlot', <IntervalPlot {...heading} data={[{ label: 'Latency', low: 20, mid: 50, high: 80 }]} />],
    ['QuadrantChart', <QuadrantChart {...heading} points={points} regions={{ topLeft: { label: 'Explore' }, topRight: { label: 'Scale' }, bottomLeft: { label: 'Maintain' }, bottomRight: { label: 'Repair' } }} />],
    ['PieChart', <PieChart {...heading} segments={values} />],
    ['DonutChart', <DonutChart {...heading} segments={values} centerLabel="Total" />],
    ['StackedBar', <StackedBar c={c} title={heading.title} subtitle={heading.subtitle} segments={values} />],
] as const

function expectInside(nodes: SatoriNode[], x: number, y: number, width: number, height: number) {
    const fitted = nodes.filter((node) => node.props['data-vizmatic-chart-fit-scope'] !== undefined)
    expect(fitted.length).toBeGreaterThan(0)
    for (const node of fitted) {
        // Yoga rounds the position of the scaled wrapper to a physical pixel.
        expect(node.left).toBeGreaterThanOrEqual(x - 1)
        expect(node.top).toBeGreaterThanOrEqual(y - 1)
        expect(node.left + node.width).toBeLessThanOrEqual(x + width + 1)
        expect(node.top + node.height).toBeLessThanOrEqual(y + height + 1)
    }
}

describe('CanvasItem chart fitting', () => {
    it.each(charts)('contains %s plotting layers, headings, and legends at both canvas sizes', async (_name, chart) => {
        for (const [width, height] of [[650, 400], [180, 120]]) {
            const nodes: SatoriNode[] = []
            const svg = await renderToSvg(<Board c={c} width={900} height={600}>
                <CanvasItem x={40} y={32} width={width} height={height}>{chart}</CanvasItem>
            </Board>, 900, 600, { onNodeDetected: (node) => nodes.push(node) })
            expectInside(nodes, 40, 32, width, height)
            expect(svg).not.toMatch(/NaN|Infinity/)
        }
    })

    it('discovers charts returned by a custom function and measures wrapped headings and long legends', async () => {
        const nodes: SatoriNode[] = []
        function Dashboard() {
            return <Board c={c} width={640} height={360}>
                <CanvasItem x={16} y={24} width={300} height={220}>
                    <LineChart c={c} title={'A long heading that wraps across several lines '.repeat(4)}
                        subtitle="The rendered font metrics determine the height" footer="A footer remains in the fitted chart"
                        series={Array.from({ length: 8 }, (_, index) => ({ name: `Long legend entry ${index + 1}`, points: [1, 2, 3] }))} />
                </CanvasItem>
            </Board>
        }
        await renderToSvg(<Dashboard />, 640, 360, { onNodeDetected: (node) => nodes.push(node) })
        expectInside(nodes, 16, 24, 300, 220)
    })

    it('preserves themed source references and reports text hit targets inside the fitted chart', async () => {
        const source = `width = 640
height = 360
<Board width={640} height={360}>
 <CanvasItem x={24} y={40} width={320} height={220}>
  <BarChart title="Editable requests" subtitle="By outcome" footer="Source: telemetry" data={[{label: "Successful", value: 820}, {label: "Failed", value: 140}]} />
 </CanvasItem>
</Board>`
        const mapping = mapPlaygroundText(source)
        const prepared = preparePlaygroundSource(mapping.source)
        const api = createPlaygroundApi(c)
        const code = transform(`const render = () => {\n${prepared.setup}\nreturn (${prepared.jsx});\n};`, { transforms: ['typescript', 'jsx'], production: true }).code
        const element = Function('React', 'c', ...Object.keys(api), `${code}\nreturn render();`)(React, c, ...Object.values(api)) as React.ReactNode
        const editable = prepareEditableText(element, mapping)
        const nodes: SatoriNode[] = []
        await renderToSvg(editable.element, 640, 360, { onNodeDetected: (node) => nodes.push(node) })
        expectInside(nodes, 24, 40, 320, 220)
        expect(editableCanvasItems(nodes, editable.canvasItems)).toContainEqual(expect.objectContaining({ x: 24, y: 40, left: 24, top: 40, width: 320, height: 220 }))
        const targets = editableTextTargets(nodes, editable.references)
        for (const text of ['Editable requests', 'By outcome', 'Source: telemetry', 'Successful', 'Failed']) {
            const target = targets.find((entry) => entry.value === text)
            expect(target, text).toBeDefined()
            expect(source.slice(target!.start, target!.end)).toBe(target!.original)
            expect(target!.left).toBeGreaterThanOrEqual(24)
            expect(target!.top).toBeGreaterThanOrEqual(40)
            expect(target!.left + target!.width).toBeLessThanOrEqual(345)
            expect(target!.top + target!.height).toBeLessThanOrEqual(261)
        }
    })

    it('retains normal chart dimensions and invokes custom components once without a fitted canvas', async () => {
        let calls = 0
        const nodes: SatoriNode[] = []
        function Chart() { calls += 1; return <BarChart c={c} width={320} height={220} data={values} /> }
        await renderToSvg(<Chart />, 640, 360, { onNodeDetected: (node) => nodes.push(node) })
        expect(calls).toBe(1)
        const plot = nodes.find((node) => node.type === 'svg')
        expect(plot).toMatchObject({ width: 320, height: 220 })
        expect(nodes.some((node) => node.props['data-vizmatic-chart-fit-scope'] !== undefined)).toBe(false)
    })
})
