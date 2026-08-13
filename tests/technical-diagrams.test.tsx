import React from 'react'
import { describe, expect, it } from 'vitest'
import {
    DataflowDiagram,
    DeploymentDiagram,
    formatTensorShape,
    getThemeColors,
    renderToSvg,
    SequenceDiagram,
    TransformerTopology,
    type SatoriNode,
} from '../src'

function reactProps(element: React.ReactElement): Record<string, any> {
    return element.props as Record<string, any>
}

function collectElements(
    node: React.ReactNode,
    matches: (element: React.ReactElement) => boolean,
): React.ReactElement[] {
    const elements: React.ReactElement[] = []

    React.Children.forEach(node, (child) => {
        if (!React.isValidElement(child)) return
        const element = child as React.ReactElement
        if (matches(element)) elements.push(element)
        elements.push(...collectElements(reactProps(element).children as React.ReactNode, matches))
    })

    return elements
}

function renderedText(node: React.ReactNode): string {
    let text = ''
    React.Children.forEach(node, (child) => {
        if (typeof child === 'string' || typeof child === 'number') {
            text += String(child)
        } else if (React.isValidElement(child)) {
            text += renderedText(reactProps(child).children as React.ReactNode)
        }
    })
    return text
}

function sequenceFixture(theme: 'dark' | 'light'): React.ReactElement {
    return SequenceDiagram({
        c: getThemeColors(theme),
        width: 820,
        height: 760,
        ariaLabel: 'Request lifecycle',
        title: 'Request lifecycle',
        participants: [
            { id: 'client', label: 'Client', kind: 'actor', icon: 'user' },
            { id: 'api', label: 'API', kind: 'boundary', detail: 'gateway' },
            { id: 'db', label: 'Database', kind: 'database', icon: 'database' },
        ],
        items: [
            { id: 'request', from: 'client', to: 'api', label: 'GET /items', kind: 'sync' },
            { id: 'query', from: 'api', to: 'db', label: 'SQL', kind: 'async' },
            { id: 'result', from: 'db', to: 'api', label: 'rows', kind: 'return' },
            { id: 'active-api', type: 'activation', participant: 'api', start: 'request', end: 'result', depth: 1 },
            { id: 'cache-note', type: 'note', text: 'cache hit', over: ['api', 'db'], tone: 'green' },
            {
                id: 'retry-loop',
                kind: 'loop',
                label: 'retry',
                items: [{ id: 'retry', from: 'api', to: 'api', label: 'retry', kind: 'sync' }],
            },
            {
                id: 'auth-alt',
                kind: 'alt',
                label: 'authorized?',
                branches: [
                    { id: 'allow', label: 'yes', items: [{ id: 'ok', from: 'api', to: 'client', label: '200' }] },
                    { id: 'deny', label: 'no', items: [{ id: 'denied', from: 'api', to: 'client', label: '403' }] },
                ],
            },
        ],
    })
}

function dataflowFixture(theme: 'dark' | 'light'): React.ReactElement {
    return DataflowDiagram({
        c: getThemeColors(theme),
        width: 1100,
        height: 380,
        sizing: 'fixed',
        ariaLabel: 'Events pipeline',
        boundaries: [{ id: 'platform', label: 'Platform', detail: 'data plane', tone: 'green' }],
        nodes: [
            {
                id: 'source',
                label: 'Event bus',
                detail: 'ingest',
                kind: 'source',
                boundary: 'platform',
                schema: {
                    name: 'Event',
                    version: 'v1',
                    fields: [
                        { name: 'id', type: 'uuid', required: true },
                        { name: 'kind', type: 'string' },
                    ],
                },
            },
            { id: 'transform', label: 'Normalize', detail: 'clean fields', kind: 'transform', boundary: 'platform' },
            { id: 'store', label: 'Warehouse', kind: 'store', boundary: 'platform' },
            { id: 'sink', label: 'Dashboard', detail: 'read model', kind: 'sink' },
        ],
        edges: [
            { from: 'source', to: 'transform', label: 'events', mode: 'stream' },
            { from: 'transform', to: 'store', schema: 'rows', mode: 'batch' },
            { from: 'store', to: 'sink', label: 'updates', mode: 'stream' },
        ],
    })
}

function deploymentFixture(theme: 'dark' | 'light'): React.ReactElement {
    return DeploymentDiagram({
        c: getThemeColors(theme),
        width: 900,
        height: 430,
        sizing: 'fixed',
        ariaLabel: 'Production deployment',
        boundaries: [
            { id: 'trust', label: 'Production', kind: 'trust', detail: 'trusted runtime', tone: 'purple' },
            { id: 'zone', label: 'App zone', kind: 'zone', parent: 'trust', tone: 'blue' },
        ],
        nodes: [
            { id: 'client', label: 'Client', kind: 'client' },
            {
                id: 'api',
                label: 'API',
                kind: 'service',
                boundary: 'zone',
                ports: [
                    { id: 'https', port: 443, protocol: 'HTTPS', direction: 'ingress' },
                    { id: 'metrics', port: 9090, protocol: 'TCP' },
                ],
            },
            {
                id: 'db',
                label: 'Database',
                kind: 'database',
                boundary: 'zone',
                ports: [{ id: 'postgres', port: 5432, protocol: 'TCP' }],
            },
        ],
        connections: [
            { id: 'request', from: 'client', to: 'api', kind: 'ingress', protocol: 'HTTPS', toPort: 'https' },
            { id: 'query', from: 'api', to: 'db', kind: 'internal', port: { id: 'postgres', port: 5432, protocol: 'TCP' } },
            { id: 'audit', from: 'db', to: 'client', kind: 'egress', protocol: 'HTTPS' },
            { id: 'cross', from: 'client', to: 'api', kind: 'cross-boundary', protocol: 'TLS' },
        ],
    })
}

function transformerFixture(theme: 'dark' | 'light'): React.ReactElement {
    return TransformerTopology({
        c: getThemeColors(theme),
        width: 1320,
        height: 450,
        sizing: 'fixed',
        expandRepeats: true,
        ariaLabel: 'Decoder topology',
        blocks: [
            {
                id: 'embedding',
                kind: 'embedding',
                label: 'Embedding',
                outputShape: { dims: ['B', 'T', 'D'], dtype: 'bf16' },
            },
            {
                id: 'attention',
                kind: 'attention',
                label: 'Self attention',
                repeat: 2,
                inputShape: { dims: ['B', 'T', 'D'], dtype: 'bf16' },
                outputShape: { dims: ['B', 'T', 'D'], dtype: 'bf16' },
            },
            {
                id: 'router',
                kind: 'router',
                label: 'MoE router',
                repeat: 3,
                shape: { dims: ['B', 'T', 'Dff'], dtype: 'fp8', layout: 'row-major' },
            },
            {
                id: 'output',
                kind: 'output',
                label: 'Logits',
                shape: { dims: ['B', 'T', 'V'], dtype: 'fp16' },
            },
        ],
        routes: [
            { from: 'embedding', to: 'attention', kind: 'activation', shape: ['B', 'T', 'D'] },
            { from: 'attention', to: 'attention', kind: 'residual', label: 'skip' },
            { from: 'attention', to: 'router', kind: 'kv-cache', shape: { dims: ['B', 'H', 'T', 'D'], dtype: 'bf16' } },
            { from: 'attention', to: 'router', kind: 'expert', expert: 4 },
            { from: 'router', to: 'output', kind: 'collective', collective: 'all-reduce' },
        ],
    })
}

describe('technical diagram primitives', () => {
    it('renders typed sequence semantics and accessible markers', () => {
        const diagram = sequenceFixture('light')
        const props = reactProps(diagram)
        const paths = collectElements(diagram, (element) => element.type === 'path' && Boolean(reactProps(element).markerEnd))

        expect(props.role).toBe('img')
        expect(props['aria-label']).toBe('Request lifecycle')
        expect(collectElements(diagram, (element) => Boolean(reactProps(element)['data-vizmatic-sequence-participant']))).toHaveLength(3)
        expect(collectElements(diagram, (element) => Boolean(reactProps(element)['data-vizmatic-sequence-activation']))).toHaveLength(1)
        expect(collectElements(diagram, (element) => Boolean(reactProps(element)['data-vizmatic-sequence-note']))).toHaveLength(1)
        expect(collectElements(diagram, (element) => Boolean(reactProps(element)['data-vizmatic-sequence-fragment']))
            .map((element) => reactProps(element)['data-vizmatic-sequence-fragment']))
            .toEqual(expect.arrayContaining(['retry-loop', 'auth-alt']))
        expect(paths.map((path) => reactProps(path).strokeDasharray)).toContain('7 5')
        expect(paths.map((path) => reactProps(path).strokeDasharray)).toContain(undefined)

        const text = renderedText(diagram)
        expect(text).toContain('GET /items')
        expect(text).toContain('cache hit')
        expect(text).toContain('authorized?')
        expect(text).toContain('yes')
    })

    it('rejects duplicate participants and missing sequence references', () => {
        const c = getThemeColors('light')
        expect(() => SequenceDiagram({
            c,
            participants: [{ id: 'client', label: 'Client' }, { id: 'client', label: 'Duplicate' }],
        })).toThrow('duplicate participant id "client"')
        expect(() => SequenceDiagram({
            c,
            participants: [{ id: 'client', label: 'Client' }],
            messages: [{ from: 'client', to: 'missing', label: 'request' }],
        })).toThrow('references a missing participant')
        expect(() => SequenceDiagram({
            c,
            height: 80,
            participants: [{ id: 'client', label: 'Client' }],
            messages: [{ from: 'client', to: 'client', label: 'request' }],
        })).toThrow('height 80 is too small')
    })

    it('compiles dataflow schemas and batch or stream edge styles', () => {
        const diagram = dataflowFixture('light')
        const paths = collectElements(diagram, (element) => element.type === 'path' && Boolean(reactProps(element).markerEnd))
        const text = renderedText(diagram)

        expect(reactProps(diagram)['aria-label']).toBe('Events pipeline')
        expect(collectElements(diagram, (element) => Boolean(reactProps(element)['data-vizmatic-graph-group']))).toHaveLength(1)
        expect(paths).toHaveLength(3)
        expect(reactProps(paths[0]).strokeDasharray).toBe('7 6')
        expect(reactProps(paths[1]).strokeDasharray).toBeUndefined()
        expect(reactProps(paths[2]).strokeDasharray).toBe('7 6')
        expect(text).toContain('Event v1 { id: uuid *, kind: string }')
        expect(text).toContain('events')
        expect(text).toContain('rows')
        expect(text).toContain('updates')
    })

    it('rejects duplicate dataflow ids and missing node or boundary references', () => {
        const c = getThemeColors('light')
        expect(() => DataflowDiagram({
            c,
            nodes: [{ id: 'source', label: 'One', kind: 'source' }, { id: 'source', label: 'Two', kind: 'sink' }],
            edges: [],
        })).toThrow('duplicate id "source"')
        expect(() => DataflowDiagram({
            c,
            nodes: [{ id: 'source', label: 'Source', kind: 'source', boundary: 'missing' }],
            edges: [],
            boundaries: [],
        })).toThrow('references missing boundary "missing"')
        expect(() => DataflowDiagram({
            c,
            nodes: [{ id: 'source', label: 'Source', kind: 'source' }],
            edges: [{ from: 'source', to: 'missing' }],
        })).toThrow('references a missing node')
    })

    it('renders deployment trust boundaries, ports, protocols, and relationship styles', () => {
        const diagram = deploymentFixture('light')
        const paths = collectElements(diagram, (element) => element.type === 'path' && Boolean(reactProps(element).markerEnd))
        const text = renderedText(diagram)

        expect(reactProps(diagram)['aria-label']).toBe('Production deployment')
        expect(collectElements(diagram, (element) => Boolean(reactProps(element)['data-vizmatic-graph-group']))).toHaveLength(2)
        expect(paths).toHaveLength(4)
        expect(paths.map((path) => reactProps(path).strokeDasharray)).toEqual([
            undefined,
            undefined,
            '7 6',
            '2 6',
        ])
        expect(text).toContain('Production')
        expect(text).toContain('trusted runtime')
        expect(text).toContain('ports: HTTPS/443, TCP/9090')
        expect(text).toContain('TCP/5432')
        expect(text).toContain('HTTPS')
        expect(text).toContain('TLS')
    })

    it('rejects duplicate deployment ids and missing boundaries, nodes, or ports', () => {
        const c = getThemeColors('light')
        expect(() => DeploymentDiagram({
            c,
            nodes: [{ id: 'api', label: 'One', kind: 'service' }, { id: 'api', label: 'Two', kind: 'service' }],
        })).toThrow('duplicate node id "api"')
        expect(() => DeploymentDiagram({
            c,
            nodes: [{ id: 'api', label: 'API', kind: 'service', boundary: 'missing' }],
        })).toThrow('references missing boundary "missing"')
        expect(() => DeploymentDiagram({
            c,
            nodes: [{ id: 'api', label: 'API', kind: 'service' }],
            connections: [{ from: 'api', to: 'missing' }],
        })).toThrow('references a missing node')
        expect(() => DeploymentDiagram({
            c,
            nodes: [
                { id: 'api', label: 'API', kind: 'service', ports: [{ id: 'https', port: 443 }] },
                { id: 'client', label: 'Client', kind: 'client' },
            ],
            connections: [{ from: 'api', to: 'client', fromPort: 'missing' }],
        })).toThrow('references missing from port "missing"')
    })

    it('formats tensor shapes and expands transformer repeats with typed routes', () => {
        expect(formatTensorShape([2, 'T', 'd_model'])).toBe('[2 × T × d_model]')
        expect(formatTensorShape({ dims: ['B', 'T', 'D'], dtype: 'bf16', layout: 'row-major' }))
            .toBe('[B × T × D] · bf16 · row-major')
        expect(formatTensorShape({ label: 'hidden states', dtype: 'fp16' })).toBe('hidden states · fp16')
        expect(formatTensorShape({ label: 'QKV' })).toBe('QKV')
        expect(formatTensorShape('tokens')).toBe('tokens')
        expect(formatTensorShape(undefined)).toBeUndefined()

        const diagram = transformerFixture('light')
        const icons = collectElements(diagram, (element) => Boolean(reactProps(element)['data-vizmatic-graph-icon']))
        const paths = collectElements(diagram, (element) => element.type === 'path' && Boolean(reactProps(element).markerEnd))
        const text = renderedText(diagram)

        expect(reactProps(diagram)['aria-label']).toBe('Decoder topology')
        expect(icons).toHaveLength(7)
        expect(paths).toHaveLength(5)
        expect(reactProps(paths[0]).strokeDasharray).toBeUndefined()
        expect(reactProps(paths[1]).strokeDasharray).toBe('7 6')
        expect(reactProps(paths[2]).strokeDasharray).toBe('2 6')
        expect(reactProps(paths[4]).strokeDasharray).toBe('7 6')
        expect(text).toContain('1/2')
        expect(text).toContain('2/2')
        expect(text).toContain('1/3')
        expect(text).toContain('3/3')
        expect(text).toContain('KV cache')
        expect(text).toContain('expert 4')
        expect(text).toContain('all-reduce')
        expect(text).toContain('[B × T × D] · bf16')
    })

    it('rejects duplicate or missing transformer references and invalid repeats', () => {
        const c = getThemeColors('light')
        expect(() => TransformerTopology({
            c,
            blocks: [{ id: 'block', kind: 'norm' }, { id: 'block', kind: 'mlp' }],
        })).toThrow('duplicate block id "block"')
        expect(() => TransformerTopology({
            c,
            blocks: [{ id: 'block', kind: 'norm' }],
            routes: [{ from: 'block', to: 'missing' }],
        })).toThrow('references a missing block')
        expect(() => TransformerTopology({
            c,
            blocks: [{ id: 'block', kind: 'norm', repeat: 0 }],
        })).toThrow('repeat must be a positive integer')
    })

    it('renders every technical diagram in both themes without layout overflow', async () => {
        const fixtures: Array<[string, (theme: 'dark' | 'light') => React.ReactElement, number, number]> = [
            ['sequence', sequenceFixture, 820, 760],
            ['dataflow', dataflowFixture, 1100, 380],
            ['deployment', deploymentFixture, 900, 430],
            ['transformer', transformerFixture, 1320, 450],
        ]

        for (const theme of ['dark', 'light'] as const) {
            for (const [name, create, width, height] of fixtures) {
                const layoutNodes: SatoriNode[] = []
                const svg = await renderToSvg(create(theme), width, height, {
                    theme,
                    onNodeDetected: (node) => layoutNodes.push(node),
                })

                expect(svg, `${name} ${theme}`).toMatch(/^<svg\b/)
                expect(svg, `${name} ${theme}`).not.toContain('NaN')
                expect(layoutNodes.length, `${name} ${theme} layout nodes`).toBeGreaterThan(0)
                const finiteLayout = layoutNodes.every((node) => (
                    Number.isFinite(node.left)
                    && Number.isFinite(node.top)
                    && Number.isFinite(node.width)
                    && Number.isFinite(node.height)
                ))
                expect(finiteLayout, `${name} ${theme} non-finite layout`).toBe(true)

                expect(layoutNodes.every((node) => (
                    node.left >= -1
                    && node.top >= -1
                    && node.left + node.width <= width + 1
                    && node.top + node.height <= height + 1
                )), `${name} ${theme} overflow`).toBe(true)
            }
        }
    }, 30_000)
})
