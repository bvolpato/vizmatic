import React from 'react'
import { expect, it } from 'vitest'
import {
    AxisPlot, BarChart, Board, CanvasItem, ChartFrame, DonutChart, GraphDiagram, Heatmap, IntervalPlot, LineChart, Matrix, MiniBarChart,
    ParetoBarChart, ParetoChart, PieChart, QuadrantChart, ScatterPlot, Sparkline, StackedBar,
    TiledMatrix, getThemeColors, renderToBuffer, renderToSvg, type ThemeColors,
} from '../src'

it('exports a chart title and data summary through a user component', async () => {
    const Chart = () => React.createElement(PieChart, {
        c: getThemeColors('light'),
        title: 'Requests & retries',
        segments: [{ label: 'Success', value: 3 }, { label: 'Retry', value: 1 }],
    })
    const svg = await renderToSvg(React.createElement(Chart), 480, 300)
    expect(svg).toContain('<title id="vizmatic-svg-title">Requests &amp; retries</title>')
    expect(svg).toContain('Success: 3')
    expect(svg).toContain('Retry: 1')
    expect(svg).toContain('aria-describedby="vizmatic-svg-description"')
})

const context = { id: 'chart / π', ariaLabel: 'Accessible title', description: 'Read <unsafe> & "quoted".' }
const segments = [{ label: 'Success', value: 3 }, { label: 'Retry', value: 1 }]
const point = [{ label: 'Sample', x: 3, y: 4 }]
const cases: Array<[string, (c: ThemeColors) => React.ReactElement, string]> = [
    ['ChartFrame', (c) => <ChartFrame c={c} {...context}><div>Data</div></ChartFrame>, 'Read &lt;unsafe&gt;'],
    ['PieChart', (c) => <PieChart c={c} {...context} segments={segments} showLegend={false} />, 'Success: 3'],
    ['DonutChart', (c) => <DonutChart c={c} {...context} segments={segments} showLegend={false} />, 'Success: 3'],
    ['StackedBar', (c) => <StackedBar c={c} {...context} segments={segments} showLegend={false} />, 'Success: 3'],
    ['BarChart', (c) => <BarChart c={c} {...context} data={segments} showValues={false} />, 'Success: 3'],
    ['MiniBarChart', (c) => <MiniBarChart c={c} {...context} data={segments} />, 'Success: 3'],
    ['AxisPlot', (c) => <AxisPlot c={c} {...context} width={360} height={240} points={[{ x: 0.2, y: 0.5 }]} />, 'Point 1: x 0.2, y 0.5'],
    ['AxisPlot with labels', (c) => <AxisPlot c={c} {...context} width={360} height={240} xAxisLabel="Cost" />, 'Cost range -1 to 1'],
    ['ParetoBarChart', (c) => <ParetoBarChart c={c} {...context} data={segments} showValues={false} />, 'Retry: 1, cumulative 100%'],
    ['LineChart', (c) => <LineChart c={c} {...context} series={[{ name: 'Flow', points: [3, 4] }]} labels={['Mon', 'Tue']} />, 'Flow: Mon: 3, Tue: 4'],
    ['ScatterPlot', (c) => <ScatterPlot c={c} {...context} points={point} />, 'Sample: x 3, y 4'],
    ['ParetoChart', (c) => <ParetoChart c={c} {...context} points={point} />, 'minimize x, maximize y'],
    ['QuadrantChart', (c) => <QuadrantChart c={c} {...context} points={[]} regions={{
        topLeft: { label: 'Grow' }, topRight: { label: 'Hold' }, bottomLeft: { label: 'Retire' }, bottomRight: { label: 'Fix' },
    }} />, 'top-left: Grow'],
    ['IntervalPlot', (c) => <IntervalPlot c={c} {...context} data={[{ label: 'Range', low: 1, mid: 2, high: 3 }]} />, 'Range: low 1, midpoint 2, high 3'],
    ['Matrix', (c) => <Matrix c={c} {...context} data={[[0.5]]} rowLabels={['Row']} colLabels={['Column']} />, 'Row, Column: 0.50'],
    ['Heatmap', (c) => <Heatmap c={c} {...context} data={[[0.5]]} yLabels={['Row']} xLabels={['Column']} />, 'Row, Column: 0.50'],
    ['TiledMatrix', (c) => <TiledMatrix c={c} {...context} rows={2} cols={3} />, '2 rows by 3 columns'],
    ['Sparkline', (c) => <Sparkline c={c} {...context} values={[3, 4]} />, 'Point 1: 3'],
]

it.each(cases)('exports %s metadata and data in both themes', async (_name, create, summary) => {
    for (const theme of ['dark', 'light'] as const) {
        const svg = await renderToSvg(create(getThemeColors(theme)), 800, 460)
        expect(svg).toContain('<title id="vizmatic-svg-title">Accessible title</title>')
        expect(svg).toContain('id="vizmatic-chart-id-chart_u20__u2f__u20__u3c0_"')
        expect(svg).toContain('Read &lt;unsafe&gt; &amp; &quot;quoted&quot;.')
        expect(svg).toContain(summary)
        expect(svg).not.toContain('<unsafe>')
    }
})

it('keeps chart metadata distinct from graph metadata and rejects duplicate chart IDs', async () => {
    const c = getThemeColors('light')
    const svg = await renderToSvg(<div style={{ display: 'flex', flexDirection: 'column' }}>
        <BarChart c={c} id="shared" title="Requests" data={segments} />
        <GraphDiagram c={c} id="shared" title="Services" width={600} height={180}
            nodes={[{ id: 'api', label: 'API', href: '/api' }]} edges={[]} />
    </div>, 800, 700)
    expect(svg).toContain('id="vizmatic-chart-id-shared"')
    expect(svg).toContain('id="vizmatic-graph-id-shared"')
    expect(svg).toContain('href="/api"')
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    await expect(renderToSvg(<div style={{ display: 'flex' }}>
        <BarChart c={c} id="duplicate" data={segments} />
        <BarChart c={c} id="duplicate" data={segments} />
    </div>, 800, 400)).rejects.toThrow('Chart SVG id "duplicate" must be unique')
})

it('describes empty data and keeps semantic-only changes out of raster output', async () => {
    const c = getThemeColors('light')
    const empty = await renderToSvg(<BarChart c={c} data={[]} />, 400, 300)
    expect(empty).toContain('No data.')
    const image = (description: string) => renderToBuffer(<BarChart c={c} description={description} data={segments} />, 400, 300, { scale: 1 })
    expect(await image('First description')).toEqual(await image('Second description'))
    const decorative = await renderToSvg(<Sparkline c={c} values={[3, 4]} />, 100, 40)
    expect(decorative).not.toContain('vizmatic-chart-')
})

it('exports one chart summary after canvas fitting and isolates concurrent renders', async () => {
    const c = getThemeColors('dark')
    const fitted = await renderToSvg(<Board c={c} width={640} height={360}>
        <CanvasItem x={20} y={20} width={480} height={300}>
            <BarChart c={c} id="fitted" data={segments} />
        </CanvasItem>
    </Board>, 640, 360)
    expect(fitted.match(/id="vizmatic-chart-id-fitted"/g)).toHaveLength(1)
    const [first, second] = await Promise.all([
        renderToSvg(<BarChart c={c} title="First" data={[{ label: 'Only first', value: 1 }]} />, 400, 300),
        renderToSvg(<BarChart c={c} title="Second" data={[{ label: 'Only second', value: 2 }]} />, 400, 300),
    ])
    expect(first).toContain('Only first: 1')
    expect(first).not.toContain('Only second')
    expect(second).toContain('Only second: 2')
    expect(second).not.toContain('Only first')
})

it('filters invalid Pareto points from exported summaries and preserves source labels and indices', async () => {
    for (const theme of ['dark', 'light'] as const) {
        const c = getThemeColors(theme)
        const svg = await renderToSvg(<ParetoChart c={c} xScale="log" xMin={1} xMax={100} points={[
            { x: 0, y: 3, label: 'zero omitted' },
            { x: 10, y: 5 },
            { x: Number.NaN, y: 10, label: 'invalid x omitted' },
            { x: 20, y: 4, label: 'Kept & dominated' },
            { x: 10, y: Number.POSITIVE_INFINITY, label: 'invalid y omitted' },
            { x: -1, y: 5, label: 'negative omitted' },
            { x: 100, y: 6, label: 'More quality' },
        ]} />, 800, 460)
        const summary = svg.match(/<desc id="vizmatic-svg-description">([^<]*)<\/desc>/)?.[1]
        expect(summary).toContain('Point 2: x 10, y 5, on the Pareto frontier')
        expect(summary).toContain('Kept &amp; dominated: x 20, y 4, dominated')
        expect(summary).toContain('More quality: x 100, y 6, on the Pareto frontier')
        expect(summary).not.toMatch(/omitted|NaN|Infinity/)

        const empty = await renderToSvg(<ParetoChart c={c} xScale="log" points={[
            { x: -1, y: 2 }, { x: 1, y: Number.NaN },
        ]} />, 800, 460)
        expect(empty).toContain('No points.')
    }
})
