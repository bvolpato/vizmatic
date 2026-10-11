import React from 'react'
import { describe, expect, it } from 'vitest'
import { DataflowDiagram, DeploymentDiagram, GraphDiagram, getThemeColors, renderToSvg, type GraphDiagramProps, type SatoriNode } from '../src'
import { analyzeRenderedLayout } from '../src/diagnostics'
import { routeOrthogonalGraph, routingSegmentBlocked, type RoutingNode, type RoutingPoint } from '../src/graph-routing'

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

function edges(graph: React.ReactElement): React.ReactElement[] {
    return descendants(graph).filter((element) => props(element)['data-vizmatic-graph-edge-id'] != null)
}

function pathPoints(edge: React.ReactElement): RoutingPoint[] {
    return [...String(props(edge).d).matchAll(/[ML] ([\d.e+-]+) ([\d.e+-]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
}

const routeNodes: RoutingNode[] = [
    { id: 'left', cx: 75, cy: 150, width: 100, height: 60 },
    { id: 'obstacle', cx: 300, cy: 150, width: 140, height: 120 },
    { id: 'right', cx: 525, cy: 150, width: 100, height: 60 },
]

function fixture(theme: 'dark' | 'light' = 'light', overrides: Partial<GraphDiagramProps> = {}): GraphDiagramProps {
    return {
        c: getThemeColors(theme), width: 600, height: 320, nodeWidth: 100, nodeHeight: 60,
        nodes: [
            { id: 'left', label: 'Input', x: 0.1, y: 0.5, ports: [{ id: 'out', side: 'right', offset: 0.25 }] },
            { id: 'obstacle', label: 'Firewall', x: 0.5, y: 0.5, width: 140, height: 120 },
            { id: 'right', label: 'Output', x: 0.9, y: 0.5, ports: [{ id: 'in', side: 'left', offset: 0.75 }] },
        ],
        edges: [{ id: 'request', from: 'left', to: 'right', fromPort: 'out', toPort: 'in', href: '/request', label: 'request' }],
        routing: 'orthogonal', ...overrides,
    }
}

describe('graph connector routing', () => {
    it('routes around an intervening node with clearance and stable orthogonal geometry', () => {
        const run = () => routeOrthogonalGraph(routeNodes, [{ from: 'left', to: 'right' }], 600, 300)
        const first = run()
        expect(first.failures).toEqual([])
        expect([...first.routes]).toEqual([...run().routes])
        const points = first.routes.get(0)!
        expect(points.length).toBeGreaterThan(2)
        const obstacle = { left: 218, top: 78, right: 382, bottom: 222 }
        for (let i = 1; i < points.length; i++) {
            expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true)
            expect(routingSegmentBlocked(points[i - 1], points[i], obstacle)).toBe(false)
        }
        expect(points[0]).toEqual({ x: 125, y: 150 })
        expect(points.at(-1)).toEqual({ x: 475, y: 150 })
    })

    it('separates parallel and reverse routes while preserving named port anchors', () => {
        const nodes = routeNodes.map((node) => ({ ...node, ports: [{ id: 'port', side: node.id === 'right' ? 'left' as const : 'right' as const }] }))
        const routed = routeOrthogonalGraph(nodes, [
            { from: 'left', to: 'right', fromPort: 'port', toPort: 'port' },
            { from: 'left', to: 'right', fromPort: 'port', toPort: 'port' },
            { from: 'right', to: 'left', fromPort: 'port', toPort: 'port' },
        ], 600, 300)
        expect(routed.failures).toEqual([])
        expect(new Set([...routed.routes.values()].map((points) => JSON.stringify(points)))).toHaveProperty('size', 3)
        const first = routed.routes.get(0)!
        const second = routed.routes.get(1)!
        expect(first[0]).toEqual(second[0])
        expect(first.at(-1)).toEqual(second.at(-1))
        expect(second.slice(1, -1)).not.toEqual(first.slice(1, -1))
        expect([...routed.routes.get(2)!].reverse()).not.toEqual(first)
    })

    it('keeps orthogonal self-loops outside the node and reports a same-port loop as unsupported', () => {
        const node = { id: 'retry', cx: 200, cy: 150, width: 100, height: 60, ports: [{ id: 'out', side: 'right' as const }] }
        const result = routeOrthogonalGraph([node], [{ from: 'retry', to: 'retry' }], 400, 300)
        expect(result.failures).toEqual([])
        const points = result.routes.get(0)!
        expect(points.length).toBeGreaterThan(3)
        for (let i = 1; i < points.length; i++) expect(routingSegmentBlocked(points[i - 1], points[i], {
            left: 150, top: 120, right: 250, bottom: 180,
        })).toBe(false)
        expect(routeOrthogonalGraph([node], [{ from: 'retry', to: 'retry', fromPort: 'out', toPort: 'out' }], 400, 300).failures)
            .toEqual([{ index: 0, reason: 'a self-loop requires distinct endpoint anchors' }])
    })

    it('reports coincident parallel routes when a narrow corridor has no separate lane', () => {
        const nodes = routeNodes.filter((node) => node.id !== 'obstacle').map((node) => ({
            ...node, ports: [{ id: 'port', side: node.id === 'left' ? 'right' as const : 'left' as const }],
        }))
        const result = routeOrthogonalGraph(nodes, [
            { from: 'left', to: 'right', fromPort: 'port', toPort: 'port' },
            { from: 'left', to: 'right', fromPort: 'port', toPort: 'port' },
        ], 600, 300, 12, 14, [{ left: 0, top: 0, right: 600, bottom: 138 }, { left: 0, top: 162, right: 600, bottom: 300 }])
        expect(result.routes.size).toBe(1)
        expect(result.failures).toEqual([{ index: 1, reason: 'parallel connectors have no separate lane at the requested clearance' }])
    })

    it('reports a blocked canvas instead of falling back to a connector through the obstacle', () => {
        const result = routeOrthogonalGraph([
            routeNodes[0], { ...routeNodes[1], height: 300 }, routeNodes[2],
        ], [{ from: 'left', to: 'right' }], 600, 300)
        expect(result.routes.size).toBe(0)
        expect(result.failures).toEqual([{ index: 0, reason: 'no obstacle-free route exists inside the canvas' }])
    })

    it('caps routing work for oversized graphs with explicit failures', () => {
        const nodes = Array.from({ length: 65 }, (_, index) => ({ id: String(index), cx: 50 + index * 10, cy: 150, width: 5, height: 5 }))
        const oversized = routeOrthogonalGraph(nodes, [{ from: '0', to: '64' }], 800, 300)
        expect(oversized.routes.size).toBe(0)
        expect(oversized.failures[0].reason).toContain('at most 64 node and header obstacles')
        const tooManyEdges = routeOrthogonalGraph(routeNodes.map((node) => node.id === 'obstacle' ? { ...node, height: 300 } : node),
            Array.from({ length: 257 }, () => ({ from: 'left', to: 'right' })), 600, 300)
        expect(tooManyEdges.failures.find(({ index }) => index === 256)?.reason).toContain('at most 256 edges')
    })

    it('anchors GraphDiagram paths to the declared boundary offsets and separates parallel diagnostics', () => {
        const graph = GraphDiagram(fixture('light', {
            edges: [{ from: 'left', to: 'right' }, { from: 'left', to: 'right' }],
        }))
        expect(props(graph)['data-vizmatic-parallel-connector-groups']).toBe(0)
        expect(new Set(edges(graph).map((edge) => props(edge).d)).size).toBe(2)
        const anchoredGraph = GraphDiagram(fixture())
        const points = pathPoints(edges(anchoredGraph)[0])
        expect(points[0]).toEqual({ x: 132.4, y: 145 })
        expect(points.at(-1)?.x).toBeCloseTo(467.6)
        expect(points.at(-1)?.y).toBe(175)
    })

    it('preserves default Dagre routes and explicitly supports straight routing', () => {
        const base = fixture('light', { edges: [{ from: 'left', to: 'right' }] })
        const { routing: _routing, ...original } = base
        expect(edges(GraphDiagram(original)).map((edge) => props(edge).d)).toEqual(edges(GraphDiagram({ ...original, routing: 'dagre' })).map((edge) => props(edge).d))
        expect(pathPoints(edges(GraphDiagram({ ...base, routing: 'straight' }))[0])).toHaveLength(2)
        const straightPorts = pathPoints(edges(GraphDiagram(fixture('light', { routing: 'straight' })))[0])
        expect(straightPorts[0].y).toBe(145)
        expect(straightPorts.at(-1)?.y).toBe(175)
    })

    it('routes automatic compound layouts outside node interiors and group headers', () => {
        const graph = GraphDiagram({
            c: getThemeColors('light'), routing: 'orthogonal',
            groups: [{ id: 'cloud', label: 'Cloud' }, { id: 'data', label: 'Data', parent: 'cloud' }],
            nodes: [{ id: 'client', label: 'Client' }, { id: 'api', label: 'API', group: 'cloud' }, { id: 'db', label: 'DB', group: 'data' }],
            edges: [{ from: 'client', to: 'api' }, { from: 'api', to: 'db' }],
        })
        expect(props(graph)['data-vizmatic-unrouted-connectors']).toBe(0)
        const obstacles = descendants(graph).filter((element) => props(element)['data-vizmatic-graph-node-id'] || props(element)['data-vizmatic-graph-group'])
            .map((element) => {
                const style = props(element).style as { left: number; top: number; width: number; height: number }
                return { left: style.left, right: style.left + style.width, top: style.top,
                    bottom: style.top + (props(element)['data-vizmatic-graph-group'] ? 26 : style.height) }
            })
        for (const edge of edges(graph)) {
            const points = pathPoints(edge)
            for (let i = 1; i < points.length; i++) for (const obstacle of obstacles) {
                expect(routingSegmentBlocked(points[i - 1], points[i], obstacle)).toBe(false)
            }
        }
    })

    it('validates missing references, duplicate ports, offset range and conflicting anchors', () => {
        expect(() => GraphDiagram(fixture('light', { edges: [{ from: 'left', to: 'right', fromPort: 'missing' }] }))).toThrow('references missing from port "missing"')
        expect(() => GraphDiagram(fixture('light', { edges: [{ from: 'left', to: 'right', fromPort: 'out', fromSide: 'top' }] }))).toThrow('cannot combine fromPort and fromSide')
        expect(() => GraphDiagram(fixture('light', { nodes: [{ id: 'x', label: 'X', ports: [{ id: 'p', side: 'left', offset: 1.1 }] }], edges: [] }))).toThrow('offset must be between 0 and 1')
        expect(() => GraphDiagram(fixture('light', { nodes: [{ id: 'x', label: 'X', ports: [{ id: 'p', side: 'left' }, { id: 'p', side: 'right' }] }], edges: [] }))).toThrow('duplicate port "p"')
        expect(() => GraphDiagram(fixture('light', { routingClearance: NaN }))).toThrow('routingClearance must be a finite positive number')
    })

    it('turns omitted routes into checker errors using the rendered metadata', async () => {
        const nodes: SatoriNode[] = []
        const graph = GraphDiagram(fixture('light', {
            nodes: [
                { id: 'left', label: 'Input', x: 0.1, y: 0.5 },
                { id: 'wall', label: 'Wall', x: 0.5, y: 0.5, width: 140, height: 320 },
                { id: 'right', label: 'Output', x: 0.9, y: 0.5 },
            ], edges: [{ from: 'left', to: 'right' }],
        }))
        expect(edges(graph)).toHaveLength(0)
        await renderToSvg(graph, 600, 320, { onNodeDetected: (node) => nodes.push(node) })
        expect(analyzeRenderedLayout(nodes, 'light')).toContainEqual(expect.objectContaining({
            code: 'layout.connector_unroutable', severity: 'error',
            message: 'Connector "left" -> "right" was not drawn: no obstacle-free route exists inside the canvas.',
        }))
    })

    it('maps declared deployment ports to geometry only when explicit routing is selected', () => {
        const base = {
            c: getThemeColors('light'), width: 600, height: 320,
            nodes: [
                { id: 'client', label: 'Client', kind: 'client' as const, x: 0.1, y: 0.5, ports: [{ id: 'out', side: 'right' as const, offset: 0.25 }] },
                { id: 'api', label: 'API', kind: 'api' as const, x: 0.9, y: 0.5, ports: [{ id: 'https', side: 'left' as const, offset: 0.75 }] },
            ], connections: [{ from: 'client', to: 'api', fromPort: 'out', toPort: 'https' }],
        }
        const points = pathPoints(edges(DeploymentDiagram({ ...base, routing: 'orthogonal' }))[0])
        expect(points[0].y).toBe(143.5)
        expect(points.at(-1)?.y).toBe(176.5)
        expect(() => DeploymentDiagram({ ...base, routing: 'orthogonal', nodes: base.nodes.map((node) => ({ ...node, ports: [] })) })).toThrow('references missing from port "out"')
        expect(() => DeploymentDiagram({ ...base, nodes: base.nodes.map((node) => ({ ...node, ports: [] })) })).not.toThrow()
    })

    it('forwards dataflow routing mode and clearance to the graph renderer', () => {
        const base = {
            c: getThemeColors('light'), direction: 'LR' as const,
            nodes: [
                { id: 'source', label: 'Events', kind: 'source' as const },
                { id: 'transform', label: 'Validate', kind: 'transform' as const },
                { id: 'sink', label: 'Warehouse', kind: 'store' as const },
            ],
            edges: [{ from: 'source', to: 'transform' }, { from: 'transform', to: 'sink' }],
        }
        expect(() => DataflowDiagram({ ...base, routing: 'orthogonal', routingClearance: 0 }))
            .toThrow('routingClearance must be a finite positive number')
        const graph = DataflowDiagram({ ...base, routing: 'orthogonal', routingClearance: 16 })
        expect(props(graph)['data-vizmatic-unrouted-connectors']).toBe(0)
        for (const edge of edges(graph)) {
            const points = pathPoints(edge)
            for (let i = 1; i < points.length; i++) {
                expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true)
            }
        }
    })

    it('exports routed paths, edge links and valid SVG in both themes', async () => {
        for (const theme of ['dark', 'light'] as const) {
            const graph = GraphDiagram(fixture(theme))
            expect(props(graph)['data-vizmatic-unrouted-connectors']).toBe(0)
            const svg = await renderToSvg(graph, 600, 320)
            expect(svg).toContain('href="/request"')
            expect(svg).toContain('edge-custom-request')
            expect(svg).not.toMatch(/NaN|Infinity/)
        }
    })
})
