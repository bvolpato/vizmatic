import React from 'react'
import {
    type ThemeColors,
    type ToneName,
} from '../theme'

import {
    GraphDiagram,
    type GraphDiagramEdge,
    type GraphDiagramGroup,
    type GraphDiagramNode,
    type GraphDiagramProps,
} from './diagrams'
import type { IconName } from './layout'

export type DataflowNodeKind = 'source' | 'transform' | 'store' | 'sink'
export type DataflowEdgeMode = 'batch' | 'stream'

export interface DataflowSchemaField {
    name: string
    type?: string
    required?: boolean
    description?: string
}

export interface DataflowSchemaDefinition {
    name?: string
    version?: string
    fields: DataflowSchemaField[]
}

export type DataflowSchema = string | DataflowSchemaDefinition

export interface DataflowNode {
    id: string
    label: React.ReactNode
    detail?: React.ReactNode
    kind: DataflowNodeKind
    schema?: DataflowSchema
    tone?: ToneName
    icon?: IconName
    muted?: boolean
    boundary?: string
    width?: number
    height?: number
}

export interface DataflowEdge {
    from: string
    to: string
    label?: string
    schema?: DataflowSchema
    mode?: DataflowEdgeMode
    tone?: ToneName
    muted?: boolean
}

export interface DataflowBoundary {
    id: string
    label: React.ReactNode
    detail?: React.ReactNode
    parent?: string
    tone?: ToneName
    muted?: boolean
}

interface DataflowSpec {
    nodes: DataflowNode[]
    edges: DataflowEdge[]
    boundaries?: DataflowBoundary[]
    ariaLabel?: string
}

export interface DataflowDiagramProps extends DataflowSpec {
    c: ThemeColors
    width?: number
    height?: number
    nodeWidth?: number
    nodeHeight?: number
    labelFontSize?: number
    detailFontSize?: number
    arrowSize?: number
    padding?: number
    direction?: GraphDiagramProps['direction']
    nodeGap?: number
    rankGap?: number
    edgeGap?: number
    sizing?: GraphDiagramProps['sizing']
    iconSize?: number
}

interface CompiledDataflow {
    nodes: GraphDiagramNode[]
    edges: GraphDiagramEdge[]
    groups: GraphDiagramGroup[]
    ariaLabel?: string
}

const nodeKinds: DataflowNodeKind[] = ['source', 'transform', 'store', 'sink']
const edgeModes: DataflowEdgeMode[] = ['batch', 'stream']

const defaultNodeTones: Record<DataflowNodeKind, ToneName> = {
    source: 'blue',
    transform: 'purple',
    store: 'green',
    sink: 'warm',
}

const defaultNodeIcons: Record<DataflowNodeKind, IconName> = {
    source: 'file',
    transform: 'tool',
    store: 'database',
    sink: 'bucket',
}

function nodeKind(node: DataflowNode): DataflowNodeKind {
    const kind = node.kind
    if (kind == null || !nodeKinds.includes(kind)) {
        throw new Error(`DataflowDiagram node "${node.id}" must define kind as "source", "transform", "store", or "sink".`)
    }
    return kind
}

function edgeMode(edge: DataflowEdge): DataflowEdgeMode {
    const mode = edge.mode ?? 'batch'
    if (!edgeModes.includes(mode)) {
        throw new Error(`DataflowDiagram edge "${edge.from}" -> "${edge.to}" must use mode "batch" or "stream".`)
    }
    return mode
}

function validateSchema(schema: DataflowSchema | undefined, owner: string): void {
    if (schema == null || typeof schema === 'string') return
    const fields = new Set<string>()
    const fieldList = Array.isArray(schema.fields)
        ? schema.fields
        : Object.entries(schema.fields).map(([name, type]) => ({ name, type, required: false }))
    for (const field of fieldList) {
        if (!field.name.trim()) throw new Error(`DataflowDiagram schema for "${owner}" contains an empty field name.`)
        if (fields.has(field.name)) throw new Error(`DataflowDiagram schema for "${owner}" contains duplicate field "${field.name}".`)
        fields.add(field.name)
    }
}

function schemaLabel(schema: DataflowSchema | undefined): string | undefined {
    if (schema == null) return undefined
    if (typeof schema === 'string') return schema
    const prefix = [schema.name, schema.version].filter(Boolean).join(' ')
    const fieldList = Array.isArray(schema.fields)
        ? schema.fields
        : Object.entries(schema.fields).map(([name, type]) => ({ name, type, required: false }))
    const fields = fieldList.map((field) => `${field.name}${field.type ? `: ${field.type}` : ''}${field.required ? ' *' : ''}`).join(', ')
    return [prefix, fields ? `{ ${fields} }` : undefined].filter(Boolean).join(' ')
}

function detailWithSchema(detail: React.ReactNode, schema: DataflowSchema | undefined): React.ReactNode {
    const renderedSchema = schemaLabel(schema)
    if (!renderedSchema) return detail
    if (detail == null) return renderedSchema
    if (typeof detail === 'string' || typeof detail === 'number') return `${detail} · ${renderedSchema}`
    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: 3,
            minWidth: 0,
        },
    },
        React.createElement('div', null, detail),
        React.createElement('div', {
            style: {
                fontFamily: 'inherit',
                fontSize: 'inherit',
                fontWeight: 'inherit',
            },
        }, renderedSchema),
    )
}

function validateDataflowSpec(spec: DataflowSpec): { boundaries: DataflowBoundary[] } {
    const boundaries = spec.boundaries ?? []
    const ids = new Set<string>()
    for (const node of spec.nodes) {
        if (!node.id.trim()) throw new Error('DataflowDiagram node ids must not be empty.')
        if (ids.has(node.id)) throw new Error(`DataflowDiagram received duplicate id "${node.id}".`)
        ids.add(node.id)
        nodeKind(node)
        validateSchema(node.schema, node.id)
    }
    for (const boundary of boundaries) {
        if (!boundary.id.trim()) throw new Error('DataflowDiagram boundary ids must not be empty.')
        if (ids.has(boundary.id)) throw new Error(`DataflowDiagram received duplicate id "${boundary.id}".`)
        ids.add(boundary.id)
    }
    const boundariesById = new Map(boundaries.map((boundary) => [boundary.id, boundary]))
    for (const boundary of boundaries) {
        if (boundary.parent != null && !boundariesById.has(boundary.parent)) {
            throw new Error(`DataflowDiagram boundary "${boundary.id}" references missing parent "${boundary.parent}".`)
        }
        const visited = new Set<string>([boundary.id])
        let parent = boundary.parent
        while (parent != null) {
            if (visited.has(parent)) throw new Error(`DataflowDiagram boundaries contain a parent cycle at "${parent}".`)
            visited.add(parent)
            parent = boundariesById.get(parent)?.parent
        }
    }
    for (const node of spec.nodes) {
        const boundary = node.boundary
        if (boundary != null && !boundariesById.has(boundary)) {
            throw new Error(`DataflowDiagram node "${node.id}" references missing boundary "${boundary}".`)
        }
    }
    for (const edge of spec.edges) {
        if (!ids.has(edge.from) || !ids.has(edge.to) || !spec.nodes.some((node) => node.id === edge.from) || !spec.nodes.some((node) => node.id === edge.to)) {
            throw new Error(`DataflowDiagram edge "${edge.from}" -> "${edge.to}" references a missing node.`)
        }
        edgeMode(edge)
        validateSchema(edge.schema, `${edge.from} -> ${edge.to}`)
    }

    const occupied = new Set<string>()
    for (const node of spec.nodes) {
        let boundary = node.boundary
        while (boundary != null) {
            occupied.add(boundary)
            boundary = boundariesById.get(boundary)?.parent
        }
    }
    for (const boundary of boundaries) {
        if (!occupied.has(boundary.id)) throw new Error(`DataflowDiagram boundary "${boundary.id}" contains no nodes.`)
    }
    return { boundaries }
}

/** Compile typed dataflow semantics into the shared GraphDiagram model. */
function compileDataflow(spec: DataflowSpec): CompiledDataflow {
    const { boundaries } = validateDataflowSpec(spec)
    const boundaryIds = new Set(boundaries.map((boundary) => boundary.id))
    const groups: GraphDiagramGroup[] = boundaries.map((boundary) => ({
        id: boundary.id,
        label: boundary.label,
        detail: boundary.detail,
        parent: boundary.parent,
        tone: boundary.tone,
        muted: boundary.muted,
    }))
    const nodes: GraphDiagramNode[] = spec.nodes.map((node) => {
        const kind = nodeKind(node)
        const boundary = node.boundary
        if (boundary != null && !boundaryIds.has(boundary)) {
            throw new Error(`DataflowDiagram node "${node.id}" references missing boundary "${boundary}".`)
        }
        return {
            id: node.id,
            label: node.label,
            detail: detailWithSchema(node.detail, node.schema),
            tone: node.tone ?? defaultNodeTones[kind],
            icon: node.icon ?? defaultNodeIcons[kind],
            muted: node.muted,
            group: boundary,
            width: node.width,
            height: node.height,
        }
    })
    const edges: GraphDiagramEdge[] = spec.edges.map((edge) => {
        const mode = edgeMode(edge)
        const schema = schemaLabel(edge.schema)
        return {
            from: edge.from,
            to: edge.to,
            label: edge.label ?? schema ?? mode,
            tone: edge.tone ?? (mode === 'stream' ? 'cyan' : 'blue'),
            muted: edge.muted,
            kind: mode === 'stream' ? 'async' : 'data',
            style: mode === 'stream' ? 'dashed' : 'solid',
            arrow: 'forward',
        }
    })
    return {
        nodes,
        edges,
        groups,
        ariaLabel: spec.ariaLabel ?? 'Dataflow diagram',
    }
}

/** Render typed dataflow nodes and edges through the existing GraphDiagram. */
export function DataflowDiagram({
    c,
    nodes,
    edges,
    boundaries,
    ariaLabel,
    width,
    height,
    nodeWidth = 158,
    nodeHeight = 70,
    labelFontSize,
    detailFontSize,
    arrowSize,
    padding,
    direction,
    nodeGap,
    rankGap,
    edgeGap,
    sizing,
    iconSize,
}: DataflowDiagramProps): React.ReactElement {
    const compiled = compileDataflow({ nodes, edges, boundaries, ariaLabel })
    return GraphDiagram({
        c,
        nodes: compiled.nodes,
        edges: compiled.edges,
        groups: compiled.groups,
        ariaLabel: compiled.ariaLabel,
        width,
        height,
        nodeWidth,
        nodeHeight,
        labelFontSize,
        detailFontSize,
        arrowSize,
        padding,
        direction,
        nodeGap,
        rankGap,
        edgeGap,
        sizing,
        iconSize,
    })
}
