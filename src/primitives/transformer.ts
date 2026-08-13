import React from 'react'

import {
    GraphDiagram,
    type GraphDiagramEdge,
    type GraphDiagramNode,
    type GraphDiagramProps,
    type DiagramIconDefinition,
} from './diagrams'
import type { ThemeColors, ToneName } from '../theme'
import type { IconName } from './layout'

/** Supported transformer computation block kinds. */
export type TransformerBlockKind =
    | 'embedding'
    | 'attention'
    | 'norm'
    | 'mlp'
    | 'residual'
    | 'router'
    | 'output'
    | 'custom'

/** A tensor dimension may be symbolic (for example, `T` or `d_model`). */
export type TensorDimension = number | string

/** Structured tensor shape metadata. */
export interface TensorShapeObject {
    dims?: readonly TensorDimension[]
    dtype?: string
    layout?: string
    label?: string
}

/** Tensor shape accepted by transformer blocks and routes. */
export type TensorShape = readonly TensorDimension[] | TensorShapeObject | string

/** A typed transformer block with optional tensor and repetition metadata. */
export interface TransformerBlock extends Omit<GraphDiagramNode, 'label' | 'detail' | 'icon'> {
    id: string
    kind: TransformerBlockKind
    label?: React.ReactNode
    detail?: React.ReactNode
    shape?: TensorShape
    inputShape?: TensorShape
    outputShape?: TensorShape
    /** Render repeated layers as one deterministic compact block by default. */
    repeat?: number
    icon?: IconName | DiagramIconDefinition | React.ReactElement
}

export type TransformerRouteKind = 'activation' | 'residual' | 'kv-cache' | 'expert' | 'collective'

/** A typed activation, residual, cache, expert, or collective route. */
export interface TransformerRoute extends Omit<GraphDiagramEdge, 'from' | 'to' | 'label' | 'kind' | 'style' | 'arrow'> {
    id?: string
    from: string
    to: string
    kind?: TransformerRouteKind
    label?: string
    shape?: TensorShape
    expert?: string | number
    collective?: string
    style?: GraphDiagramEdge['style']
    arrow?: GraphDiagramEdge['arrow']
}

/** Props for a deterministic transformer topology view. */
export interface TransformerTopologyProps extends Omit<GraphDiagramProps, 'nodes' | 'edges' | 'groups' | 'c' | 'ariaLabel'> {
    c: ThemeColors
    blocks: TransformerBlock[]
    routes?: TransformerRoute[]
    /** Expand repeat counts into individually addressable graph nodes. */
    expandRepeats?: boolean
    ariaLabel?: string
}

interface TransformerSpec {
    blocks: TransformerBlock[]
    routes?: TransformerRoute[]
    expandRepeats?: boolean
    ariaLabel?: string
}

interface CompiledTransformer {
    nodes: GraphDiagramNode[]
    edges: GraphDiagramEdge[]
    ariaLabel?: string
}

const blockLabels: Record<TransformerBlockKind, string> = {
    embedding: 'Embedding',
    attention: 'Attention',
    norm: 'Norm',
    mlp: 'MLP',
    residual: 'Residual',
    router: 'Router',
    output: 'Output',
    custom: 'Block',
}

const blockTones: Record<TransformerBlockKind, ToneName> = {
    embedding: 'cyan',
    attention: 'purple',
    norm: 'neutral',
    mlp: 'blue',
    residual: 'warm',
    router: 'pink',
    output: 'green',
    custom: 'ocean',
}

const blockIcons: Record<TransformerBlockKind, IconName> = {
    embedding: 'layers',
    attention: 'network',
    norm: 'tool',
    mlp: 'code',
    residual: 'git',
    router: 'gateway',
    output: 'check',
    custom: 'spark',
}

const routeTones: Record<TransformerRouteKind, ToneName> = {
    activation: 'blue',
    residual: 'warm',
    'kv-cache': 'cyan',
    expert: 'pink',
    collective: 'purple',
}

const blockKinds: TransformerBlockKind[] = ['embedding', 'attention', 'norm', 'mlp', 'residual', 'router', 'output', 'custom']
const routeKinds: TransformerRouteKind[] = ['activation', 'residual', 'kv-cache', 'expert', 'collective']

function assertIdentifier(id: string, what: string): void {
    if (typeof id !== 'string' || id.trim().length === 0) {
        throw new Error(`TransformerTopology ${what} id must be a non-empty string.`)
    }
}

function assertUniqueIdentifier(id: string, seen: Set<string>, what: string): void {
    assertIdentifier(id, what)
    if (seen.has(id)) throw new Error(`TransformerTopology received duplicate ${what} id "${id}".`)
    seen.add(id)
}

function isTensorShapeArray(shape: TensorShape): shape is readonly TensorDimension[] {
    return Array.isArray(shape)
}

/** Format tensor metadata for compact graph labels. */
export function formatTensorShape(shape: TensorShape | undefined): string | undefined {
    if (shape == null) return undefined
    if (typeof shape === 'string') return shape
    const dimensions = isTensorShapeArray(shape) ? shape : shape.dims
    const label = isTensorShapeArray(shape) ? undefined : shape.label
    const formatted = dimensions?.length ? `[${dimensions.join(' × ')}]` : undefined
    const base = label ?? formatted
    if (!base) return undefined
    const metadata = !isTensorShapeArray(shape)
        ? [shape.dtype, shape.layout].filter(Boolean).join(' · ')
        : ''
    return metadata ? `${base} · ${metadata}` : base
}

function resolveBlockKind(block: TransformerBlock): TransformerBlockKind {
    const kind = block.kind
    if (kind == null || !blockKinds.includes(kind)) {
        throw new Error(`TransformerTopology block "${block.id}" must define kind as "embedding", "attention", "norm", "mlp", "residual", "router", "output", or "custom".`)
    }
    return kind
}

function resolveRouteKind(route: TransformerRoute): TransformerRouteKind {
    const kind = route.kind ?? 'activation'
    if (!routeKinds.includes(kind)) {
        throw new Error(`TransformerTopology route "${route.from}" -> "${route.to}" must use kind "activation", "residual", "kv-cache", "expert", or "collective".`)
    }
    return kind
}

function resolveRepeat(block: TransformerBlock): number {
    const repeat = block.repeat ?? 1
    if (!Number.isInteger(repeat) || repeat < 1) {
        throw new Error(`TransformerTopology block "${block.id}" repeat must be a positive integer.`)
    }
    return repeat
}

function blockShapeText(block: TransformerBlock): string | undefined {
    const shape = block.shape
    const input = formatTensorShape(block.inputShape)
    const output = formatTensorShape(block.outputShape)
    const primary = formatTensorShape(shape)
    if (input || output) {
        return [input, output && input ? `→ ${output}` : output].filter(Boolean).join(' ')
    }
    return primary
}

function blockDetail(block: TransformerBlock, kind: TransformerBlockKind, repeat: number): React.ReactNode {
    const shape = blockShapeText(block)
    const repetition = repeat > 1 ? `×${repeat}` : undefined
    if (block.detail != null) {
        if (typeof block.detail === 'string') {
            return [block.detail, repetition, shape].filter(Boolean).join(' · ')
        }
        return block.detail
    }
    return [repetition, shape, repeat === 1 ? blockLabels[kind].toUpperCase() : undefined].filter(Boolean).join(' · ') || undefined
}

function routeShapeText(route: TransformerRoute): string | undefined {
    return formatTensorShape(route.shape)
}

function routeLabel(route: TransformerRoute, kind: TransformerRouteKind): string | undefined {
    if (route.label != null) return route.label
    const kindLabel = kind === 'kv-cache' ? 'KV cache' : kind
    const qualifiers = [
        kindLabel,
        route.expert == null ? undefined : `expert ${route.expert}`,
        route.collective,
        routeShapeText(route),
    ].filter(Boolean)
    return qualifiers.join(' · ')
}

function graphRouteKind(kind: TransformerRouteKind): GraphDiagramEdge['kind'] {
    if (kind === 'activation' || kind === 'expert') return 'data'
    if (kind === 'kv-cache') return 'event'
    return 'dependency'
}

function graphRouteStyle(kind: TransformerRouteKind): GraphDiagramEdge['style'] {
    if (kind === 'kv-cache') return 'dotted'
    if (kind === 'residual' || kind === 'collective') return 'dashed'
    return 'solid'
}

function validateTransformerSpec(blocks: TransformerBlock[], routes: TransformerRoute[], expandRepeats: boolean): Map<string, number> {
    const blockIds = new Set<string>()
    const repeatCounts = new Map<string, number>()
    for (const block of blocks) {
        assertUniqueIdentifier(block.id, blockIds, 'block')
        resolveBlockKind(block)
        repeatCounts.set(block.id, resolveRepeat(block))
    }

    const routeIds = new Set<string>()
    const graphIds = new Set<string>(blockIds)
    if (expandRepeats) {
        for (const block of blocks) {
            const repeat = repeatCounts.get(block.id) ?? 1
            if (repeat === 1) continue
            for (let index = 1; index <= repeat; index += 1) {
                const expandedId = `${block.id}-${index}`
                if (graphIds.has(expandedId)) {
                    throw new Error(`TransformerTopology repeated block "${block.id}" generates duplicate node id "${expandedId}".`)
                }
                graphIds.add(expandedId)
            }
        }
    }

    for (const route of routes) {
        if (route.id != null) assertUniqueIdentifier(route.id, routeIds, 'route')
        if (!blockIds.has(route.from) || !blockIds.has(route.to)) {
            throw new Error(`TransformerTopology route "${route.from}" -> "${route.to}" references a missing block.`)
        }
        resolveRouteKind(route)
    }
    return repeatCounts
}

function expandedNodeId(id: string, repeat: number, index: number): string {
    return repeat > 1 ? `${id}-${index + 1}` : id
}

function expandedRouteEndpoints(
    route: TransformerRoute,
    repeatCounts: Map<string, number>,
    expandRepeats: boolean,
): Array<{ from: string; to: string }> {
    if (!expandRepeats) return [{ from: route.from, to: route.to }]
    const fromRepeat = repeatCounts.get(route.from) ?? 1
    const toRepeat = repeatCounts.get(route.to) ?? 1
    if (route.from === route.to && fromRepeat > 1) {
        return Array.from({ length: fromRepeat - 1 }, (_, index) => ({
            from: expandedNodeId(route.from, fromRepeat, index),
            to: expandedNodeId(route.to, toRepeat, index + 1),
        }))
    }
    return [{
        from: expandedNodeId(route.from, fromRepeat, fromRepeat - 1),
        to: expandedNodeId(route.to, toRepeat, 0),
    }]
}

/** Compile typed transformer semantics into the shared GraphDiagram model. */
function compileTransformer(spec: TransformerSpec): CompiledTransformer {
    const routes = spec.routes ?? []
    const expandRepeats = spec.expandRepeats ?? false
    const repeatCounts = validateTransformerSpec(spec.blocks, routes, expandRepeats)

    const nodes: GraphDiagramNode[] = []
    for (const block of spec.blocks) {
        const kind = resolveBlockKind(block)
        const repeat = repeatCounts.get(block.id) ?? 1
        const count = expandRepeats ? repeat : 1
        for (let index = 0; index < count; index += 1) {
            const id = expandRepeats ? expandedNodeId(block.id, repeat, index) : block.id
            const label = block.label ?? blockLabels[kind]
            const repetitionDetail = expandRepeats && repeat > 1
                ? [blockDetail(block, kind, repeat), `${index + 1}/${repeat}`].filter(Boolean).join(' · ')
                : blockDetail(block, kind, repeat)
            nodes.push({
                id,
                label,
                detail: repetitionDetail,
                x: block.x,
                y: block.y,
                tone: block.tone ?? blockTones[kind],
                muted: block.muted,
                width: block.width,
                height: block.height,
                icon: block.icon ?? blockIcons[kind],
                iconSize: block.iconSize,
            })
        }
    }

    const edges: GraphDiagramEdge[] = []
    for (const route of routes) {
        const kind = resolveRouteKind(route)
        for (const endpoint of expandedRouteEndpoints(route, repeatCounts, expandRepeats)) {
            edges.push({
                from: endpoint.from,
                to: endpoint.to,
                tone: route.tone ?? routeTones[kind],
                muted: route.muted,
                kind: graphRouteKind(kind),
                style: route.style ?? graphRouteStyle(kind),
                arrow: route.arrow ?? (kind === 'residual' ? 'both' : 'forward'),
                label: routeLabel(route, kind),
            })
        }
    }

    return {
        nodes,
        edges,
        ariaLabel: spec.ariaLabel ?? 'Transformer topology diagram',
    }
}

/**
 * Render typed transformer blocks and routes through GraphDiagram.
 *
 * Repeat counts stay compact by default (`repeat: 12` becomes one node with
 * `×12`). Set `expandRepeats` when each repeated block needs its own node.
 */
export function TransformerTopology({
    c,
    blocks,
    routes,
    expandRepeats = false,
    ariaLabel = 'Transformer topology diagram',
    ...graphProps
}: TransformerTopologyProps): React.ReactElement {
    const compiled = compileTransformer({
        blocks,
        routes,
        expandRepeats,
        ariaLabel,
    })
    return GraphDiagram({
        ...graphProps,
        c,
        nodes: compiled.nodes,
        edges: compiled.edges,
        ariaLabel: compiled.ariaLabel,
    })
}
