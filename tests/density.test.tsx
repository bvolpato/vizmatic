import React from 'react'
import { describe, expect, it } from 'vitest'
import {
    densityOf,
    densityTokens,
    FactRows,
    getThemeColors,
    GraphDiagram,
    parseDensity,
    renderToSvg,
    Scene,
    setDefaultDensity,
    SmallMultiples,
    Sparkline,
    StepCard,
    withDensity,
    type SatoriNode,
} from '../src'
import { analyzeRenderedLayout } from '../src/diagnostics'

const c = getThemeColors('dark')

function props(element: React.ReactElement): Record<string, any> {
    return element.props as Record<string, any>
}

function descendants(node: React.ReactNode): React.ReactElement[] {
    const result: React.ReactElement[] = []
    React.Children.forEach(node, (child) => {
        if (!React.isValidElement(child)) return
        result.push(child, ...descendants(props(child).children))
    })
    return result
}

const nodeBox = (graph: React.ReactElement, id: string) =>
    props(descendants(graph).find((element) => props(element)['data-vizmatic-graph-node-id'] === id)!).style as { left: number; top: number; width: number; height: number }

describe('density tokens', () => {
    it('orders type, spacing, and strokes from dense to presentation', () => {
        const [dense, compact, comfortable, presentation] = (['dense', 'compact', 'comfortable', 'presentation'] as const).map((name) => densityTokens(name))
        for (const pick of [(t: typeof dense) => t.type.body, (t: typeof dense) => t.space.md, (t: typeof dense) => t.stroke.line]) {
            expect(pick(dense!)).toBeLessThan(pick(compact!))
            expect(pick(compact!)).toBeLessThan(pick(comfortable!))
            expect(pick(comfortable!)).toBeLessThan(pick(presentation!))
        }
        expect(comfortable!.f(13)).toBe(13)
    })

    it('keeps small type legible but lets small geometry shrink', () => {
        const dense = densityTokens('dense')
        expect(dense.f(6)).toBeGreaterThanOrEqual(9)
        expect(dense.g(3)).toBeLessThan(3)
    })

    it('accepts numbers and rejects unknown names', () => {
        expect(densityTokens(1.25).f(16)).toBe(20)
        expect(parseDensity('compact')).toBe('compact')
        expect(parseDensity('1.5')).toBe(1.5)
        expect(() => parseDensity('huge')).toThrow('Unknown density')
        expect(() => parseDensity(0)).toThrow('Unknown density')
    })

    it('resolves the theme first, then the default', () => {
        setDefaultDensity('presentation')
        try {
            expect(densityOf(c).name).toBe('presentation')
            expect(densityOf(withDensity(c, 'compact')).name).toBe('compact')
        } finally {
            setDefaultDensity(undefined)
        }
        expect(densityOf(c).name).toBe('dense')
    })
})

describe('density in rendered primitives', () => {
    const fontSizes = async (element: React.ReactElement, options: { density?: 'presentation' } = {}) => {
        const nodes: SatoriNode[] = []
        await renderToSvg(element, 900, 500, { ...options, onNodeDetected: (node) => nodes.push(node) })
        const sizes = nodes.filter((node) => node.textContent).map((node) => Number((node.props.style as { fontSize?: number } | undefined)?.fontSize))
        return sizes.filter(Number.isFinite)
    }

    it('scales nested JSX through a scene density', async () => {
        const dense = await fontSizes(<Scene c={c}><StepCard c={c} title="Label" /></Scene>)
        const large = await fontSizes(<Scene c={c} density="presentation"><StepCard c={c} title="Label" /></Scene>)
        expect(Math.max(...large)).toBeGreaterThan(Math.max(...dense))
    })

    it('scales deferred primitives through a render option', async () => {
        const dense = await fontSizes(<StepCard c={c} title="Label" />)
        const large = await fontSizes(<StepCard c={c} title="Label" />, { density: 'presentation' })
        expect(Math.max(...large)).toBeGreaterThan(Math.max(...dense))
    })

    it('honors an explicit prop over density', async () => {
        const sizes = await fontSizes(<FactRows c={c} fontSize={21} rows={[{ key: 'p99', value: '41 ms' }]} />)
        expect(sizes).toContain(21)
    })
})

describe('information-dense graph nodes', () => {
    const rows = [{ key: 'traffic', value: '38k rps' }, { key: 'p99', value: '41 ms' }, { key: 'replicas', value: '48' }]
    const rich = (density?: 'presentation') => GraphDiagram({
        c, density,
        nodes: [
            { id: 'plain', label: 'Gateway' },
            { id: 'rich', label: 'Gateway', status: 'ok', rows, metrics: [{ label: 'err', value: '0.03', unit: '%' }], tags: ['go'], owner: 'edge', spark: [1, 3, 2, 5] },
        ],
        edges: [{ from: 'plain', to: 'rich', label: '38k rps' }],
    })

    it('grows a node to fit its rows, metrics, and tags', () => {
        const graph = rich()
        expect(nodeBox(graph, 'rich').height).toBeGreaterThan(nodeBox(graph, 'plain').height * 2)
    })

    it('grows the same diagram at presentation density', () => {
        expect(nodeBox(rich('presentation'), 'rich').width).toBeGreaterThan(nodeBox(rich(), 'rich').width)
    })

    it('renders without overflowing text at each density', async () => {
        for (const density of [undefined, 'presentation'] as const) {
            const nodes: SatoriNode[] = []
            await renderToSvg(rich(density), 1400, 700, { onNodeDetected: (node) => nodes.push(node) })
            const codes = analyzeRenderedLayout(nodes, 'dark').map((diagnostic) => diagnostic.code)
            expect(codes).not.toContain('layout.text_overflow')
            expect(codes).not.toContain('layout.text_overlap')
        }
    })

    it('anchors connectors to side centers instead of corners', () => {
        const graph = GraphDiagram({ c, nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] })
        const edge = descendants(graph).find((element) => props(element)['data-vizmatic-graph-edge-id'])!
        const start = /^M ([\d.]+) ([\d.]+)/.exec(String(props(edge).d))!
        const box = nodeBox(graph, 'a')
        expect(Number(start[1])).toBeCloseTo(box.left + box.width)
        expect(Number(start[2])).toBeCloseTo(box.top + box.height / 2)
    })

    it('fans connectors out along a shared side', () => {
        const graph = GraphDiagram({
            c,
            nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
            edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }],
        })
        const starts = descendants(graph).filter((element) => props(element)['data-vizmatic-graph-edge-id']).map((edge) => String(props(edge).d).split(' C')[0])
        expect(new Set(starts).size).toBe(2)
    })

    it('keeps grouped members inside a group sized to its content', () => {
        const graph = GraphDiagram({
            c,
            groups: [{ id: 'g', label: 'Group', summary: '3 nodes' }],
            nodes: [{ id: 'x', label: 'Outside' }, { id: 'a', label: 'A', group: 'g' }, { id: 'b', label: 'B', group: 'g' }],
            edges: [{ from: 'x', to: 'a' }, { from: 'a', to: 'b' }],
        })
        const group = props(descendants(graph).find((element) => props(element)['data-vizmatic-graph-group'] === 'g')!).style as { left: number; top: number; width: number; height: number }
        for (const id of ['a', 'b']) {
            const box = nodeBox(graph, id)
            expect(box.left).toBeGreaterThan(group.left)
            expect(box.top).toBeGreaterThan(group.top)
            expect(box.left + box.width).toBeLessThan(group.left + group.width)
            expect(box.top + box.height).toBeLessThan(group.top + group.height)
        }
        const outside = nodeBox(graph, 'x')
        expect(outside.left + outside.width).toBeLessThanOrEqual(group.left)
    })

    it('adds annotations and a legend without leaving the canvas', () => {
        const graph = GraphDiagram({
            c,
            nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
            edges: [{ from: 'a', to: 'b', kind: 'async' }],
            legend: true,
            annotations: [{ target: 'b', text: 'Lag rising', tone: 'warm' }],
        })
        const note = descendants(graph).find((element) => props(element)['data-vizmatic-graph-annotation'] === 'b')!
        const root = props(graph).style as { width: number; height: number }
        const style = props(note).style as { left: number; top: number; width: number }
        expect(style.left).toBeGreaterThanOrEqual(0)
        expect(style.top).toBeGreaterThanOrEqual(0)
        expect(style.left + style.width).toBeLessThanOrEqual(root.width)
        expect(() => GraphDiagram({ c, nodes: [{ id: 'a', label: 'A' }], edges: [], annotations: [{ target: 'nope', text: 'x' }] })).toThrow('missing node')
    })
})

describe('check diagnostics for dense layouts', () => {
    it('reports text that spills out of a graph node', () => {
        const nodes: SatoriNode[] = [
            { type: 'div', left: 0, top: 0, width: 120, height: 40, props: { 'data-vizmatic-graph-node-id': 'api' } },
            { type: 'span', left: 8, top: 8, width: 100, height: 60, props: { style: { fontSize: 12 } }, textContent: 'A very long label that wrapped' },
        ]
        expect(analyzeRenderedLayout(nodes, 'dark').map((diagnostic) => diagnostic.code)).toContain('layout.text_overflow')
    })

    it('allows a few crossings in a large map, up to its budget', () => {
        const graph = (crossings: number) => [{
            type: 'div', left: 0, top: 0, width: 400, height: 400,
            props: { 'data-vizmatic-connector-crossings': crossings, 'data-vizmatic-connector-crossing-budget': 4 },
        }] as SatoriNode[]
        const hasCongestion = (crossings: number) => analyzeRenderedLayout(graph(crossings), 'dark').some((diagnostic) => diagnostic.code === 'layout.connector_congestion')
        expect(hasCongestion(4)).toBe(false)
        expect(hasCongestion(5)).toBe(true)
    })

    it('does not compare a rotated axis title by its unrotated box', () => {
        const nodes: SatoriNode[] = [
            { type: 'div', left: 0, top: 0, width: 200, height: 80, props: {} },
            { type: 'span', left: 10, top: 10, width: 120, height: 20, props: { style: { fontSize: 12, transform: 'rotate(-90deg)' } }, textContent: 'share of evaluations' },
            { type: 'span', left: 10, top: 10, width: 40, height: 20, props: { style: { fontSize: 12 } }, textContent: '50%' },
        ]
        expect(analyzeRenderedLayout(nodes, 'dark').map((diagnostic) => diagnostic.code)).not.toContain('layout.text_overlap')
    })
})

describe('dense marks', () => {
    it('keeps sparkline geometry finite for flat and single-point series', async () => {
        for (const values of [[5, 5, 5], [7]]) {
            const svg = await renderToSvg(<Sparkline c={c} values={values} />, 120, 40)
            expect(svg).not.toContain('NaN')
        }
    })

    it('shares one y scale across small multiples on request', async () => {
        const svg = await renderToSvg(
            <SmallMultiples c={c} sharedScale columns={2} items={[
                { label: 'a', values: [1, 2, 3], reference: 2 },
                { label: 'b', values: [100, 200, 300], value: '300', unit: 'ms', status: 'warn' },
            ]} />,
            500, 200,
        )
        expect(svg).not.toContain('NaN')
    })
})
