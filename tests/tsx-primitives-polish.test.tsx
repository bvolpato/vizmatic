import { readFileSync } from 'fs'
import React from 'react'
import { transform } from 'sucrase'
import { describe, expect, it } from 'vitest'
import {
    AxisPlot,
    BadgePill,
    Box,
    checkFrame,
    Column,
    DataflowDiagram,
    densityOf,
    getGradient,
    getThemeColors,
    getToneGradient,
    gradients,
    ParetoChart,
    QuadrantChart,
    renderToSvg,
    Row,
    ScatterPlot,
    Stack,
    SvgMathText,
    Timeline,
    toneGradients,
    typeOf,
    withDensity,
    type SatoriNode,
} from '../src'
import { niceChartScale } from '../src/primitives/charts'
import { createPlaygroundApi } from '../src/playground-api'
import { preparePlaygroundSource } from '../src/playground-source'
import * as physicsCatalog from '../examples/catalog-science-physics'

function collectElements(
    node: unknown,
    predicate: (element: React.ReactElement) => boolean,
    found: React.ReactElement[] = [],
): React.ReactElement[] {
    if (Array.isArray(node)) {
        for (const child of node) collectElements(child, predicate, found)
        return found
    }
    if (!React.isValidElement(node)) return found
    const element = node as React.ReactElement<Record<string, unknown> & { children?: unknown }>
    if (predicate(element)) found.push(element)
    collectElements(element.props.children, predicate, found)
    return found
}

function propsOf(element: React.ReactElement): Record<string, any> {
    return element.props as Record<string, any>
}

describe('theme gradients and typography weights', () => {
    it('provides distinct crimson gradients for red and critical tones instead of warm gold', async () => {
        expect(gradients.red).toContain('#b83232')
        expect(gradients.critical).toContain('#b83232')
        expect(gradients.red).not.toBe(gradients.warm)
        expect(gradients.critical).not.toBe(gradients.warm)
        expect(toneGradients.red).toBe(gradients.red)
        expect(toneGradients.critical).toBe(gradients.critical)
        expect(getToneGradient('red')).toBe(gradients.red)
        expect(getToneGradient('critical')).toBe(gradients.critical)
        expect(getGradient('critical')).toBe(gradients.critical)

        for (const [mode, preset] of [['dark', 'default'], ['light', 'default'], ['light', 'engineering']] as const) {
            const c = getThemeColors(mode, preset)
            const pill = BadgePill({ c, text: 'critical', tone: 'red', filled: true })
            const box = Box({ c, label: 'Alert', sublabel: 'p99', color: 'critical', gradient: true })
            if (preset !== 'engineering') {
                expect(propsOf(pill).style.backgroundImage).toBe(gradients.red)
            }
            expect(propsOf(box).style.backgroundImage).toBe(gradients.critical)
        }

        const report = await checkFrame({
            width: 420,
            height: 220,
            create(theme) {
                const c = getThemeColors(theme)
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24, backgroundColor: c.bg, width: '100%', height: '100%' }}>
                        <BadgePill c={c} text="incident" tone="red" filled />
                        <Box c={c} label="Critical path" sublabel="latency breach" color="critical" gradient width={200} />
                    </div>
                )
            },
        }, { themes: ['dark', 'light'], failOn: 'warning' })
        expect(report.summary.errors).toBe(0)
        expect(report.summary.warnings).toBe(0)
    })

    it('preserves fontWeight 700 on title typography in typeOf()', () => {
        for (const [mode, preset] of [['dark', 'default'], ['light', 'default'], ['light', 'engineering']] as const) {
            const c = getThemeColors(mode, preset)
            expect(typeOf(c, 'title').fontWeight).toBe(700)
            expect(typeOf(c, 'subtitle').fontWeight).toBe(600)
        }
    })
})

describe('horizontal Timeline dot alignment', () => {
    it('left-aligns each event marker dot directly above its card text and hides trailing rule on last event', async () => {
        const c = getThemeColors('dark')
        const timeline = Timeline({
            c,
            title: 'Milestones',
            direction: 'horizontal',
            width: 600,
            events: [
                { time: '09:12', title: 'Draft', detail: 'name stages', tone: 'blue' },
                { time: '09:18', title: 'Check', detail: 'inspect themes', tone: 'purple' },
                { time: '09:24', title: 'Render', detail: 'publish poster', tone: 'green' },
            ],
        })
        const nodes: SatoriNode[] = []
        await renderToSvg(timeline, 640, 220, { onNodeDetected: (node) => nodes.push(node) })

        const dots = nodes.filter((node) => node.props.style?.borderRadius === 999 && node.width > 0)
        expect(dots).toHaveLength(3)
        for (const [index, title] of ['Draft', 'Check', 'Render'].entries()) {
            const titleNode = nodes.find((node) => node.textContent === title)!
            expect(titleNode).toBeDefined()
            expect(Math.abs(dots[index].left - titleNode.left)).toBeLessThanOrEqual(1)
        }

        const rules = collectElements(timeline, (el) => el.type === 'div' && propsOf(el).style?.height === 1 && propsOf(el).style?.flex === 1)
        expect(rules).toHaveLength(3)
        expect(propsOf(rules[0]).style.opacity).toBe(1)
        expect(propsOf(rules[1]).style.opacity).toBe(1)
        expect(propsOf(rules[2]).style.opacity).toBe(0)
    })
})

describe('QuadrantChart, ScatterPlot, ParetoChart, and AxisPlot polish', () => {
    it('anchors QuadrantChart region headers and details to the four outer corners', () => {
        const c = getThemeColors('dark')
        const width = 520
        const height = 244
        const chart = QuadrantChart({
            c,
            width,
            height,
            xAxisLabel: 'effort',
            yAxisLabel: 'value',
            regions: {
                topLeft: { label: 'quick wins', detail: 'prioritize', color: 'positive', emphasis: true },
                topRight: { label: 'big bets', detail: 'stage work', color: 'primary' },
                bottomLeft: { label: 'defer', detail: 'low return', color: 'neutral' },
                bottomRight: { label: 'avoid', color: 'warning' },
            },
            points: [{ x: 0.22, y: 0.79, label: 'A', color: 'positive' }],
        })
        const borderRect = propsOf(collectElements(chart, (el) => el.type === 'rect' && propsOf(el).fill === 'transparent')[0])
        const plot = {
            x: Number(borderRect.x),
            y: Number(borderRect.y),
            right: Number(borderRect.x) + Number(borderRect.width),
            bottom: Number(borderRect.y) + Number(borderRect.height),
        }
        const byKey = (key: string) => collectElements(chart, (el) => el.key === key)[0]

        const tl = propsOf(byKey('quadrant-label-top-left')).style
        const tlDetail = propsOf(byKey('quadrant-detail-top-left')).style
        expect(tl).toMatchObject({ left: plot.x + 12, top: plot.y + 16, justifyContent: 'flex-start', transform: 'translate(0, -50%)' })
        expect(tlDetail.left).toBe(plot.x + 12)
        expect(tlDetail.top).toBeGreaterThan(tl.top)

        const tr = propsOf(byKey('quadrant-label-top-right')).style
        expect(tr).toMatchObject({ left: plot.right - 12, top: plot.y + 16, justifyContent: 'flex-end', transform: 'translate(-100%, -50%)' })

        const bl = propsOf(byKey('quadrant-label-bottom-left')).style
        const blDetail = propsOf(byKey('quadrant-detail-bottom-left')).style
        expect(bl.left).toBe(plot.x + 12)
        expect(bl.justifyContent).toBe('flex-start')
        expect(blDetail.top).toBe(plot.bottom - 16)
        expect(bl.top).toBeLessThan(blDetail.top)

        const br = propsOf(byKey('quadrant-label-bottom-right')).style
        expect(byKey('quadrant-detail-bottom-right')).toBeUndefined()
        expect(br).toMatchObject({ left: plot.right - 12, top: plot.bottom - 16, justifyContent: 'flex-end', transform: 'translate(-100%, -50%)' })
    })

    it('produces clean human ticks in ScatterPlot and ParetoChart via niceChartScale', () => {
        expect(niceChartScale([], 0, 10, 5).ticks).toEqual([0, 2, 4, 6, 8, 10])
        expect(niceChartScale([], 0, 1, 5).ticks).toEqual([0, 0.25, 0.5, 0.75, 1])

        const c = getThemeColors('dark')
        const scatter = ScatterPlot({
            c,
            xMin: 0,
            xMax: 10,
            yMin: 0,
            yMax: 10,
            points: [{ x: 2, y: 7.8, label: 'fast' }, { x: 7.8, y: 9.4, label: 'deep' }],
        })
        const scatterTexts = collectElements(scatter, (el) => el.type === 'div')
            .map((el) => String(propsOf(el).children))
        expect(scatterTexts).toEqual(expect.arrayContaining(['0', '2', '4', '6', '8', '10']))
        expect(scatterTexts).not.toContain('3.33')
        expect(scatterTexts).not.toContain('6.67')

        const pareto = ParetoChart({
            c,
            xMin: 0,
            xMax: 10,
            yMin: 0,
            yMax: 10,
            points: [{ x: 1.4, y: 4 }, { x: 3.8, y: 6.8 }, { x: 7, y: 9.2 }],
        })
        const paretoTexts = collectElements(pareto, (el) => el.type === 'div' && String(el.key).startsWith('pareto-x-tick-'))
            .map((el) => String(propsOf(el).children))
        expect(paretoTexts).toEqual(['0', '2', '4', '6', '8', '10'])
    })

    it('reserves non-overlapping gutters for AxisPlot xAxisLabel and yAxisLabel', () => {
        const c = getThemeColors('dark')
        const unlabeled = AxisPlot({ c, width: 254, height: 196 })
        const unlabeledFrame = collectElements(unlabeled, (el) => el.type === 'rect')[0]
        const pad = densityOf(c).s(18)
        expect(Number(propsOf(unlabeledFrame).x)).toBe(pad / 2)

        const labeled = AxisPlot({ c, width: 254, height: 196, xAxisLabel: 'x axis', yAxisLabel: 'y axis' })
        const labeledFrame = collectElements(labeled, (el) => el.type === 'rect')[0]
        const xLabel = collectElements(labeled, (el) => el.key === 'axis-x-label')[0]
        const yLabel = collectElements(labeled, (el) => el.key === 'axis-y-label')[0]
        const frameLeft = Number(propsOf(labeledFrame).x)
        const frameBottom = Number(propsOf(labeledFrame).y) + Number(propsOf(labeledFrame).height)

        expect(frameLeft).toBeGreaterThan(Number(propsOf(yLabel).style.left) + 6)
        expect(Number(propsOf(xLabel).style.top)).toBeGreaterThan(frameBottom + 6)
        expect(String(propsOf(yLabel).style.transform)).toContain('rotate(-90deg)')
    })
})

describe('density propagation across layout, surfaces, and dataflow', () => {
    it('propagates c density to Row, Column, Stack, SvgMathText, and DataflowDiagram', () => {
        const denseTheme = withDensity(getThemeColors('dark'), 'dense')
        const presTheme = withDensity(getThemeColors('dark'), 'presentation')

        expect(propsOf(Row({ c: presTheme, children: 'a' })).style.gap)
            .toBeGreaterThan(propsOf(Row({ c: denseTheme, children: 'a' })).style.gap)
        expect(propsOf(Column({ c: presTheme, children: 'a' })).style.gap)
            .toBeGreaterThan(propsOf(Column({ c: denseTheme, children: 'a' })).style.gap)
        expect(propsOf(Stack({ c: presTheme, children: 'a' })).style.gap)
            .toBeGreaterThan(propsOf(Stack({ c: denseTheme, children: 'a' })).style.gap)
        expect(propsOf(SvgMathText({ c: presTheme, text: 'x_1', x: 10, y: 10, fill: '#fff' })).style.fontSize)
            .toBeGreaterThan(propsOf(SvgMathText({ c: denseTheme, text: 'x_1', x: 10, y: 10, fill: '#fff' })).style.fontSize)

        const makeFlow = (theme: typeof denseTheme) => DataflowDiagram({
            c: theme,
            nodes: [
                { id: 'src', kind: 'source', label: 'Ingest', detail: <span>raw</span>, schema: { name: 'Event', fields: [{ name: 'id', type: 'string' }] } },
                { id: 'sink', kind: 'sink', label: 'Store' },
            ],
            edges: [{ from: 'src', to: 'sink', mode: 'stream' }],
        })
        const denseDetail = collectElements(makeFlow(denseTheme), (el) => el.type === 'div' && typeof propsOf(el).style?.gap === 'number' && propsOf(el).style?.minWidth === 0)
        const presDetail = collectElements(makeFlow(presTheme), (el) => el.type === 'div' && typeof propsOf(el).style?.gap === 'number' && propsOf(el).style?.minWidth === 0)
        expect(propsOf(presDetail[0]).style.gap).toBeGreaterThan(propsOf(denseDetail[0]).style.gap)
    })
})

describe('upgraded hero and physics catalog examples', () => {
    it('renders vizmatic-hero.tsx and catalog-science-physics.tsx cleanly in dark and light themes', async () => {
        const heroSource = readFileSync('examples/vizmatic-hero.tsx', 'utf8')
        const prepared = preparePlaygroundSource(heroSource)
        const compiled = transform(`${prepared.setup}\nreturn (${prepared.jsx});`, {
            transforms: ['typescript', 'jsx'],
            jsxPragma: 'React.createElement',
            production: true,
        }).code

        const heroReport = await checkFrame({
            width: prepared.metadata.width,
            height: prepared.metadata.height,
            create(theme) {
                const c = getThemeColors(theme)
                const api = createPlaygroundApi(c)
                const render = Function('React', 'c', ...Object.keys(api), compiled) as (...args: unknown[]) => React.ReactNode
                return render(React, c, ...Object.values(api))
            },
        }, { themes: ['dark', 'light'], failOn: 'warning' })
        expect(heroReport.summary.errors).toBe(0)
        expect(heroReport.summary.warnings).toBe(0)

        const physicsReport = await checkFrame({
            width: physicsCatalog.width,
            height: physicsCatalog.height,
            create: physicsCatalog.create,
        }, { themes: ['dark', 'light'], failOn: 'warning' })
        expect(physicsReport.summary.errors).toBe(0)
        expect(physicsReport.summary.warnings).toBe(0)
    })
})
