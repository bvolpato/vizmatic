import React from 'react'
import dagre, { type Point } from '@dagrejs/dagre'
import {
    type ThemeColors,
    type ColorName,
    type ToneName,
    getReadableToneColor,
    getReadableTextColor,
    getToneColor,
    getToneFill,
    withColorAlpha,
    withDensity,
    type Density,
    type DensityTokens,
    densityOf,
    typeOf,
    hasShadow,
} from '../theme'

import { clamp, compactChildren, formatMathText, Icon, textFitStyle, ToneStrip, type IconName } from './layout'
import { Arrow, ArrowMarkerDef, Box } from './svg'
import { renderMaybeMath } from './surfaces'
import {
    DiagramLegend,
    estimateTextWidth,
    FactRows,
    MetricStrip,
    Sparkline,
    StatusDot,
    TagList,
    type DiagramLegendItem,
    type DiagramStatus,
    type FactRow,
    type StripMetric,
} from './dense'
import { SVG_ACCESSIBILITY_COMPONENT } from '../svg-accessibility'
import {
    pointAlongSamples,
    roundedPolylinePath,
    routeOrthogonalGraph,
    samplesHitBox,
    smoothConnector,
    straightGraphRoute,
    type GraphPortSide,
    type GraphRouting,
} from '../graph-routing'

export type { GraphPortSide, GraphRouting } from '../graph-routing'

// ─── LayeredNetwork — Dense neural-network diagram without local coordinate code ─

export interface LayeredNetworkLayer {
    title: string
    nodes: string[]
    tone?: ToneName
}

interface LayeredNetworkProps {
    c: ThemeColors
    layers: LayeredNetworkLayer[]
    ariaLabel?: string
    activePath?: number[]
    annotations?: string[]
    formula?: string
    legend?: string
    width?: number
    height?: number
    nodeSize?: number
    showFormula?: boolean
}

function distributeValues(count: number, start: number, end: number): number[] {
    if (count <= 0) return []
    if (count === 1) return [(start + end) / 2]
    const step = (end - start) / (count - 1)
    return Array.from({ length: count }, (_, index) => start + index * step)
}

export function LayeredNetwork({
    c,
    layers,
    ariaLabel = 'Layered network diagram',
    activePath = [],
    annotations = [],
    formula,
    legend = 'highlighted path',
    width = 900,
    height = 400,
    nodeSize = 56,
    showFormula = true,
}: LayeredNetworkProps): React.ReactElement {
    const radius = nodeSize / 2
    const top = 82
    const bottom = showFormula || formula ? height - 118 : height - 42
    const layerXs = distributeValues(layers.length, 82, width - 82)
    const nodeLayout = layers.map((layer, layerIndex) => ({
        ...layer,
        x: layerXs[layerIndex],
        ys: distributeValues(layer.nodes.length, top, bottom),
        tone: layer.tone ?? 'purple',
    }))

    const connectionElements = nodeLayout.slice(0, -1).flatMap((from, layerIndex) => {
        const to = nodeLayout[layerIndex + 1]
        return from.ys.flatMap((fromY, fromIndex) =>
            to.ys.map((toY, toIndex) => {
                const active = activePath[layerIndex] === fromIndex && activePath[layerIndex + 1] === toIndex
                return React.createElement('line', {
                    key: `connection-${layerIndex}-${fromIndex}-${toIndex}`,
                    x1: from.x + radius + 4,
                    y1: fromY,
                    x2: to.x - radius - 4,
                    y2: toY,
                    stroke: active ? c.warningLight : c.borderLight,
                    strokeWidth: active ? 3.6 : 1.2,
                    strokeOpacity: active ? 0.98 : 0.42,
                    strokeLinecap: 'round',
                })
            })
        )
    })

    const label = (
        key: string,
        text: string,
        x: number,
        y: number,
        labelWidth: number,
        color: string,
        fontSize = densityOf(c).f(13),
        fontWeight = 600,
        fontFamily = 'Inter',
    ) => React.createElement('div', {
        key,
        style: {
            position: 'absolute' as const,
            left: x - labelWidth / 2,
            top: y,
            width: labelWidth,
            display: 'flex',
            justifyContent: 'center',
            color,
            fontSize,
            fontWeight,
            fontFamily,
            lineHeight: 1.15,
            textAlign: 'center' as const,
        },
    }, formatMathText(text))

    const titleElements = nodeLayout.map((layer) =>
        label(`title-${layer.title}`, layer.title, layer.x, 20, 120, getReadableToneColor(layer.tone, c), 16, 900)
    )

    const nodeElements = nodeLayout.flatMap((layer, layerIndex) =>
        layer.ys.flatMap((y, nodeIndex) => {
            const active = activePath[layerIndex] === nodeIndex
            const color = getToneColor(layer.tone, c)
            return [
                active && React.createElement('div', {
                    key: `halo-${layerIndex}-${nodeIndex}`,
                    style: {
                        position: 'absolute' as const,
                        left: layer.x - radius - 14,
                        top: y - radius - 14,
                        width: nodeSize + 28,
                        height: nodeSize + 28,
                        borderRadius: 999,
                        backgroundColor: withColorAlpha(c.warningLight, 0x2e / 0xff),
                        border: `4px solid ${c.warningLight}`,
                        boxSizing: 'border-box' as const,
                        boxShadow: `0 0 18px ${withColorAlpha(c.warningLight, 0x66 / 0xff)}`,
                    },
                }),
                React.createElement('div', {
                    key: `node-${layerIndex}-${nodeIndex}`,
                    style: {
                        position: 'absolute' as const,
                        left: layer.x - radius,
                        top: y - radius,
                        width: nodeSize,
                        height: nodeSize,
                        borderRadius: 999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: color,
                        color: getReadableTextColor(color, c),
                        border: active ? `3px solid ${c.warningLight}` : `1.5px solid ${color}`,
                        boxSizing: 'border-box' as const,
                        boxShadow: active ? `0 0 16px ${withColorAlpha(c.warningLight, 0x70 / 0xff)}` : `0 8px 14px ${c.shadow}`,
                        fontFamily: 'JetBrains Mono',
                        fontSize: densityOf(c).f(16),
                        fontWeight: 600,
                        lineHeight: 1,
                    },
                }, formatMathText(layer.nodes[nodeIndex])),
            ]
        }).filter(Boolean) as React.ReactElement[]
    )

    const annotationY = showFormula || formula ? height - 84 : height - 26
    const annotationElements = annotations.slice(0, Math.max(0, layerXs.length - 1)).map((annotation, index) =>
        label(
            `annotation-${index}`,
            annotation,
            (layerXs[index] + layerXs[index + 1]) / 2,
            annotationY,
            132,
            c.textMuted,
            13,
            800,
            'JetBrains Mono'
        )
    )

    const formulaElement = (showFormula || formula) && formula
        ? React.createElement('div', {
            key: 'formula-wrap',
            style: {
                position: 'absolute' as const,
                left: width / 2 - 244,
                top: height - 52,
                width: 488,
                height: 44,
                borderRadius: densityOf(c).r(10),
                border: `1px solid ${c.borderSubtle}`,
                backgroundColor: c.bgCard,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize: densityOf(c).f(15),
                fontWeight: 600,
                ...(hasShadow(c) ? { boxShadow: `0 8px 18px ${c.shadow}` } : {}),
            },
        }, formatMathText(formula))
        : null

    const legendElement = (showFormula || formula) && formula
        ? React.createElement('div', {
            key: 'legend-wrap',
            style: {
                position: 'absolute' as const,
                left: width - 184,
                top: height - 43,
                width: 160,
                display: 'flex',
                alignItems: 'center',
                gap: densityOf(c).s(14),
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: densityOf(c).f(12),
                fontWeight: 600,
            },
        },
            React.createElement('div', {
                style: {
                    width: 42,
                    height: 5,
                    borderRadius: 999,
                    backgroundColor: c.warningLight,
                },
            }),
            legend,
        )
        : null

    return React.createElement('div', {
        role: 'img',
        'aria-label': ariaLabel,
        style: {
            width,
            height,
            maxWidth: '100%',
            position: 'relative' as const,
            display: 'flex',
            alignSelf: 'center',
            flexShrink: 0,
        },
    },
        React.createElement('svg', {
            width,
            height,
            viewBox: `0 0 ${width} ${height}`,
            style: {
                position: 'absolute' as const,
                inset: 0,
                overflow: 'visible',
            },
        }, ...connectionElements),
        ...titleElements,
        ...nodeElements,
        ...annotationElements,
        formulaElement,
        legendElement,
    )
}

export interface GraphDiagramNode {
    id: string
    label: React.ReactNode
    detail?: React.ReactNode
    href?: string
    title?: string
    x?: number
    y?: number
    /** Names a category. It colors the icon and the border, and leaves text in ink. */
    tone?: ToneName
    muted?: boolean
    width?: number
    height?: number
    group?: string
    icon?: IconName | DiagramIconDefinition | React.ReactElement
    iconSize?: number
    ports?: GraphDiagramPort[]
    /** Health shown as a dot beside the title. */
    status?: DiagramStatus
    /** Key and value rows, such as region, replicas, or capacity. */
    rows?: FactRow[]
    /** Numbers with units, optionally with a sparkline or capacity bar. */
    metrics?: StripMetric[]
    /** Small labels such as runtime or tier. */
    tags?: React.ReactNode[]
    version?: string
    owner?: string
    footer?: React.ReactNode
    /** A trend across the width of the node. */
    spark?: readonly number[]
}

/** A fixed geometric connector anchor on a node boundary. Offset runs left to right or top to bottom. */
export interface GraphDiagramPort {
    id: string
    side: GraphPortSide
    offset?: number
}

export interface DiagramIconRenderProps {
    c: ThemeColors
    color: string
    size: number
    label?: string
}

export interface DiagramIconDefinition {
    readonly id: string
    readonly render: (props: DiagramIconRenderProps) => React.ReactElement
}

export function defineDiagramIcon(
    id: string,
    render: DiagramIconDefinition['render'],
): DiagramIconDefinition {
    return { id, render }
}

export function defineIconRegistry<const T extends Record<string, DiagramIconDefinition>>(icons: T): T {
    return icons
}

export interface GraphDiagramGroup {
    id: string
    label: React.ReactNode
    detail?: React.ReactNode
    parent?: string
    tone?: ToneName
    muted?: boolean
    /** Totals for the whole group, shown at the right of its header. */
    summary?: React.ReactNode
}

export type GraphDiagramEdgeKind = 'sync' | 'async' | 'event' | 'data' | 'dependency' | 'association'
export type GraphDiagramEdgeStyle = 'solid' | 'dashed' | 'dotted'
export type GraphDiagramEdgeArrow = 'forward' | 'backward' | 'both' | 'none'

export interface GraphDiagramEdge {
    id?: string
    from: string
    to: string
    tone?: ToneName
    muted?: boolean
    dashed?: boolean
    label?: string
    kind?: GraphDiagramEdgeKind
    style?: GraphDiagramEdgeStyle
    arrow?: GraphDiagramEdgeArrow
    href?: string
    title?: string
    fromPort?: string
    toPort?: string
    fromSide?: GraphPortSide
    toSide?: GraphPortSide
    /** Make this connector heavier, to show traffic or importance. */
    emphasis?: boolean
}

export interface GraphDiagramAnnotation {
    /** The node this note refers to. */
    target: string
    text: React.ReactNode
    side?: GraphPortSide
    tone?: ToneName
    width?: number
}

export interface GraphDiagramProps {
    nodes: GraphDiagramNode[]
    edges: GraphDiagramEdge[]
    groups?: GraphDiagramGroup[]
    c: ThemeColors
    width?: number
    height?: number
    /** Fixed node width. Omit it to size each node to its content. */
    nodeWidth?: number
    /** Minimum node height. Nodes grow when their content needs more. */
    nodeHeight?: number
    labelFontSize?: number
    detailFontSize?: number
    arrowSize?: number
    padding?: number
    layout?: 'auto' | 'manual'
    direction?: 'LR' | 'RL' | 'TB' | 'BT'
    /** Flow inside each group. Stack tiers top to bottom and read each tier left to right with direction="TB" and groupDirection="LR". */
    groupDirection?: 'LR' | 'RL' | 'TB' | 'BT'
    nodeGap?: number
    rankGap?: number
    edgeGap?: number
    /** Dagre draws smooth curves. Orthogonal routes avoid node boxes and group headers. */
    routing?: GraphRouting
    /** Minimum node clearance in logical pixels for orthogonal routing. */
    routingClearance?: number
    sizing?: 'content' | 'fixed'
    iconSize?: number
    id?: string
    ariaLabel?: string
    title?: string
    description?: string
    /** A key below the diagram. Pass true to build one from the relationship kinds in use. */
    legend?: boolean | DiagramLegendItem[]
    /** Notes with leader lines, pointing at nodes. */
    annotations?: GraphDiagramAnnotation[]
    /** Type, spacing, and stroke scale for this diagram. */
    density?: Density
    /** Crossings a large map accepts before `vizmatic check` warns. Defaults to one for every six edges. */
    crossingBudget?: number
}

type PositionedGraphNode = GraphDiagramNode & {
    width: number
    height: number
    cx: number
    cy: number
}

type PositionedGraphEdge = GraphDiagramEdge & {
    index: number
    stableId: string
    color: string
    markerStartId: string
    markerEndId: string
    /** Polyline approximation, used for collisions and label placement. */
    points: Point[]
    /** Corner points of an orthogonal route, or the sampled curve. */
    route: Point[]
    path: string
    labelX: number
    labelY: number
    labelWidth: number
    labelHeight: number
}

type PositionedGraphGroup = GraphDiagramGroup & {
    width: number
    height: number
    cx: number
    cy: number
    depth: number
    headerX: number
    headerY: number
    headerFlipped?: boolean
}

function manualGraphLayout(
    nodes: GraphDiagramNode[],
    sizes: Map<string, { width: number; height: number }>,
    width: number,
    height: number,
    padding: number,
): Map<string, PositionedGraphNode> {
    return new Map(nodes.map((node) => {
        const { width: resolvedWidth, height: resolvedHeight } = sizes.get(node.id)!
        const minCx = resolvedWidth / 2
        const maxCx = width - resolvedWidth / 2
        const minCy = resolvedHeight / 2
        const maxCy = height - resolvedHeight / 2
        const requestedCx = padding + clamp(node.x ?? 0.5, 0, 1) * (width - padding * 2)
        const requestedCy = padding + clamp(node.y ?? 0.5, 0, 1) * (height - padding * 2)
        return [node.id, {
            ...node,
            width: resolvedWidth,
            height: resolvedHeight,
            cx: minCx <= maxCx ? clamp(requestedCx, minCx, maxCx) : width / 2,
            cy: minCy <= maxCy ? clamp(requestedCy, minCy, maxCy) : height / 2,
        }]
    }))
}

function segmentCrosses(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
    const cross = (origin: Point, first: Point, second: Point) =>
        (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x)
    const d1 = cross(a1, a2, b1)
    const d2 = cross(a1, a2, b2)
    const d3 = cross(b1, b2, a1)
    const d4 = cross(b1, b2, a2)
    const epsilon = 0.01
    // Sampled curves can meet exactly on a shared sample, so a touch counts unless the segments are collinear.
    if (Math.abs(d1) < epsilon && Math.abs(d2) < epsilon) return false
    return d1 * d2 <= epsilon && d3 * d4 <= epsilon && (d1 * d2 < -epsilon || d3 * d4 < -epsilon || (Math.abs(d1 * d2) <= epsilon && Math.abs(d3 * d4) <= epsilon))
}

function connectorCrossings(edges: PositionedGraphEdge[]): number {
    let crossings = 0
    for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
        const left = edges[leftIndex]
        for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
            const right = edges[rightIndex]
            if (left.from === right.from || left.from === right.to || left.to === right.from || left.to === right.to) continue
            let crosses = false
            for (let leftSegment = 0; leftSegment < left.points.length - 1 && !crosses; leftSegment += 1) {
                for (let rightSegment = 0; rightSegment < right.points.length - 1; rightSegment += 1) {
                    if (segmentCrosses(
                        left.points[leftSegment],
                        left.points[leftSegment + 1],
                        right.points[rightSegment],
                        right.points[rightSegment + 1],
                    )) {
                        crosses = true
                        break
                    }
                }
            }
            if (crosses) crossings += 1
        }
    }
    return crossings
}

interface Rectangle {
    left: number
    top: number
    right: number
    bottom: number
}

function rectanglesOverlap(left: Rectangle, right: Rectangle, padding = 0): boolean {
    return left.left < right.right + padding
        && left.right > right.left - padding
        && left.top < right.bottom + padding
        && left.bottom > right.top - padding
}

function labelRect(edge: Pick<PositionedGraphEdge, 'labelX' | 'labelY' | 'labelWidth' | 'labelHeight'>): Rectangle {
    return {
        left: edge.labelX - edge.labelWidth / 2,
        right: edge.labelX + edge.labelWidth / 2,
        top: edge.labelY - edge.labelHeight / 2,
        bottom: edge.labelY + edge.labelHeight / 2,
    }
}

function nodeRect(node: { cx: number; cy: number; width: number; height: number }): Rectangle {
    return { left: node.cx - node.width / 2, right: node.cx + node.width / 2, top: node.cy - node.height / 2, bottom: node.cy + node.height / 2 }
}

function connectorLabelCollisions(
    edges: PositionedGraphEdge[],
    nodes: Map<string, PositionedGraphNode>,
    headers: Rectangle[] = [],
): number {
    const labels = edges.filter((edge) => edge.label).map(labelRect)
    let collisions = 0

    for (let index = 0; index < labels.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < labels.length; otherIndex += 1) {
            if (rectanglesOverlap(labels[index], labels[otherIndex], 2)) collisions += 1
        }
        for (const node of nodes.values()) {
            if (rectanglesOverlap(labels[index], nodeRect(node))) collisions += 1
        }
        for (const header of headers) {
            if (rectanglesOverlap(labels[index], header)) collisions += 1
        }
    }

    return collisions
}

/** Connectors that pass behind another relationship's label, or behind a group title. */
function labelCrossings(edges: PositionedGraphEdge[], headers: Rectangle[]): number {
    let crossings = 0
    for (const edge of edges) {
        for (const other of edges) {
            if (other === edge || !other.label) continue
            if (samplesHitBox(edge.points, labelRect(other))) crossings += 1
        }
        for (const header of headers) {
            if (samplesHitBox(edge.points, header)) crossings += 1
        }
    }
    return crossings
}

function crowdedConnectorEndpoints(edges: PositionedGraphEdge[]): number {
    const degrees = new Map<string, number>()
    for (const edge of edges) {
        degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1)
        degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1)
    }
    // Dense diagrams separate many connectors along a side, so hubs are normal here.
    return Array.from(degrees.values()).filter((degree) => degree > 8).length
}

function parallelConnectorGroups(edges: PositionedGraphEdge[]): number {
    const routes = new Map<string, number>()
    for (const edge of edges) {
        const key = `${edge.from}\u0000${edge.to}`
        routes.set(key, (routes.get(key) ?? 0) + 1)
    }
    return Array.from(routes.values()).filter((count) => count > 1).length
}

function validateGraphDiagramSpec(
    nodes: GraphDiagramNode[],
    edges: GraphDiagramEdge[],
    groups: GraphDiagramGroup[],
    layoutMode: 'auto' | 'manual',
): void {
    const nodeIds = new Set<string>()
    for (const node of nodes) {
        if (nodeIds.has(node.id)) throw new Error(`GraphDiagram received duplicate node id "${node.id}".`)
        nodeIds.add(node.id)
        const portIds = new Set<string>()
        for (const port of node.ports ?? []) {
            if (typeof port.id !== 'string' || port.id.trim().length === 0) {
                throw new Error(`GraphDiagram node "${node.id}" port id must be a non-empty string.`)
            }
            if (portIds.has(port.id)) throw new Error(`GraphDiagram node "${node.id}" received duplicate port "${port.id}".`)
            portIds.add(port.id)
            if (!['top', 'right', 'bottom', 'left'].includes(port.side)) {
                throw new Error(`GraphDiagram node "${node.id}" port "${port.id}" must use side "top", "right", "bottom", or "left".`)
            }
            if (port.offset != null && (!Number.isFinite(port.offset) || port.offset < 0 || port.offset > 1)) {
                throw new Error(`GraphDiagram node "${node.id}" port "${port.id}" offset must be between 0 and 1.`)
            }
        }
    }

    const groupsById = new Map<string, GraphDiagramGroup>()
    for (const group of groups) {
        if (nodeIds.has(group.id) || groupsById.has(group.id)) {
            throw new Error(`GraphDiagram node and group ids must be unique; received duplicate id "${group.id}".`)
        }
        groupsById.set(group.id, group)
    }

    for (const group of groups) {
        if (group.parent != null && !groupsById.has(group.parent)) {
            throw new Error(`GraphDiagram group "${group.id}" references missing parent group "${group.parent}".`)
        }
        const visited = new Set<string>([group.id])
        let parent = group.parent
        while (parent != null) {
            if (visited.has(parent)) throw new Error(`GraphDiagram groups contain a parent cycle at "${parent}".`)
            visited.add(parent)
            parent = groupsById.get(parent)?.parent
        }
    }

    const occupiedGroups = new Set<string>()
    for (const node of nodes) {
        if (node.group != null && !groupsById.has(node.group)) {
            throw new Error(`GraphDiagram node "${node.id}" references missing group "${node.group}".`)
        }
        let groupId = node.group
        while (groupId != null) {
            occupiedGroups.add(groupId)
            groupId = groupsById.get(groupId)?.parent
        }
    }
    for (const group of groups) {
        if (!occupiedGroups.has(group.id)) throw new Error(`GraphDiagram group "${group.id}" contains no nodes.`)
    }

    const edgeIds = new Set<string>()
    for (const edge of edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
            throw new Error(`GraphDiagram edge "${edge.from}" -> "${edge.to}" references a missing node.`)
        }
        if (edge.id != null) {
            if (edgeIds.has(edge.id)) throw new Error(`GraphDiagram received duplicate edge id "${edge.id}".`)
            edgeIds.add(edge.id)
        }
        for (const side of ['from', 'to'] as const) {
            const reference = side === 'from' ? edge.fromPort : edge.toPort
            const endpointSide = side === 'from' ? edge.fromSide : edge.toSide
            const node = nodes.find((candidate) => candidate.id === edge[side])!
            if (reference != null && !node.ports?.some((port) => port.id === reference)) {
                throw new Error(`GraphDiagram edge "${edge.from}" -> "${edge.to}" references missing ${side} port "${reference}" on node "${node.id}".`)
            }
            if (endpointSide != null && !['top', 'right', 'bottom', 'left'].includes(endpointSide)) {
                throw new Error(`GraphDiagram edge "${edge.from}" -> "${edge.to}" ${side}Side must be "top", "right", "bottom", or "left".`)
            }
            if (reference != null && endpointSide != null) {
                throw new Error(`GraphDiagram edge "${edge.from}" -> "${edge.to}" cannot combine ${side}Port and ${side}Side.`)
            }
        }
        validateDiagramHref(edge.href, `edge "${edge.id ?? `${edge.from}" -> "${edge.to}`}"`)
    }
    for (const node of nodes) {
        validateDiagramHref(node.href, `node "${node.id}"`)
    }

    if (groups.length > 0 && layoutMode === 'manual') {
        throw new Error('GraphDiagram groups require automatic layout; omit node coordinates and layout="manual".')
    }
}

function validateDiagramHref(href: string | undefined, owner: string): void {
    if (href == null) return
    const normalized = href.trim().replace(/[\u0000- \u007f]/g, '')
    const scheme = /^([a-z][a-z\d+.-]*):/i.exec(normalized)?.[1]?.toLowerCase()
    if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme)) {
        throw new Error(`GraphDiagram ${owner} has an unsupported link scheme "${scheme}:".`)
    }
}

function graphAccessibleText(value: React.ReactNode): string {
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
    if (Array.isArray(value)) return value.map(graphAccessibleText).filter(Boolean).join(' ')
    if (React.isValidElement(value)) {
        const props = value.props as { children?: React.ReactNode }
        return graphAccessibleText(props.children)
    }
    return ''
}

function graphDescription(
    nodes: GraphDiagramNode[],
    edges: GraphDiagramEdge[],
): string {
    const labels = new Map(nodes.map((node) => [node.id, graphAccessibleText(node.label) || node.id]))
    const parts = [`${nodes.length} nodes and ${edges.length} relationships.`]
    const relationships = edges.slice(0, 8).map((edge) => {
        const from = labels.get(edge.from) ?? edge.from
        const to = labels.get(edge.to) ?? edge.to
        return edge.label ? `${from} ${edge.label} ${to}` : `${from} to ${to}`
    })
    if (relationships.length) parts.push(relationships.join('; '))
    if (edges.length > relationships.length) parts.push(`${edges.length - relationships.length} more relationships`)
    return parts.join(' ')
}

function graphGroupDepth(group: GraphDiagramGroup, groupsById: Map<string, GraphDiagramGroup>): number {
    let depth = 0
    let parent = group.parent
    while (parent != null) {
        depth += 1
        parent = groupsById.get(parent)?.parent
    }
    return depth
}

function resolvedGraphEdgeStyle(edge: GraphDiagramEdge): GraphDiagramEdgeStyle {
    if (edge.style) return edge.style
    if (edge.dashed) return 'dashed'
    if (edge.kind === 'async' || edge.kind === 'dependency') return 'dashed'
    if (edge.kind === 'event') return 'dotted'
    return 'solid'
}

function resolvedGraphEdgeArrow(edge: GraphDiagramEdge): GraphDiagramEdgeArrow {
    return edge.arrow ?? (edge.kind === 'association' ? 'none' : 'forward')
}

interface GraphNodeMetrics {
    labelSize: number
    detailSize: number
    iconSize: number
    padX: number
    padY: number
    gap: number
    lineHeight: number
    microLine: number
    micro: number
}

function lineCount(text: string, size: number, available: number, weight = 400): number {
    if (!text) return 0
    const words = text.split(/\s+/)
    let lines = 1, current = 0
    const space = estimateTextWidth(' ', size, { weight })
    for (const word of words) {
        const width = estimateTextWidth(word, size, { weight })
        if (current > 0 && current + space + width > available) {
            lines += 1
            current = width
        } else {
            current += (current > 0 ? space : 0) + width
        }
    }
    return lines
}

/** Width and height a node needs, from its content. Layout runs on these numbers. */
function measureGraphNode(node: GraphDiagramNode, fixedWidth: number | undefined, minHeight: number | undefined, m: GraphNodeMetrics, d: DensityTokens): { width: number; height: number } {
    const label = graphAccessibleText(node.label) || node.id
    const detail = graphAccessibleText(node.detail)
    const hasIcon = node.icon != null
    // An oversized icon must not stretch its node. Rendering clamps it to the box.
    const measuredIcon = Math.min(node.iconSize ?? m.iconSize, d.f(48))
    const iconSpace = hasIcon ? measuredIcon + d.s(9) : 0
    const statusSpace = node.status ? d.g(8) + d.s(6) : 0
    const versionWidth = node.version ? estimateTextWidth(node.version, m.micro, { mono: true }) + d.s(8) : 0
    const rowsWidth = Math.max(0, ...(node.rows ?? []).map((row) =>
        estimateTextWidth(graphAccessibleText(row.key), m.micro) + d.s(10) + estimateTextWidth(graphAccessibleText(row.value), m.micro, { mono: true })))
    const metricCells = (node.metrics ?? []).map((metric) => Math.max(
        estimateTextWidth(graphAccessibleText(metric.value), d.f(14), { mono: true }) + (metric.unit != null ? estimateTextWidth(graphAccessibleText(metric.unit), m.micro) + d.s(3) : 0),
        estimateTextWidth(graphAccessibleText(metric.label), m.micro),
    ))
    const metricsWidth = metricCells.length ? Math.max(...metricCells) * metricCells.length + d.s(14) * (metricCells.length - 1) : 0
    const footerText = [node.owner, graphAccessibleText(node.footer)].filter(Boolean).join(' · ')
    const footerWidth = estimateTextWidth(footerText, m.micro)
    const headerWidth = iconSpace + statusSpace + versionWidth + Math.max(
        estimateTextWidth(label, m.labelSize, { weight: 600 }),
        estimateTextWidth(detail, m.detailSize),
    )
    // A little slack absorbs kerning and font-hinting differences, so one-line labels stay on one line.
    const natural = Math.ceil(Math.max(headerWidth, rowsWidth, metricsWidth, footerWidth) * 1.04) + m.padX * 2 + 4
    const minimum = d.f(92)
    const maximum = d.f(300)
    const width = node.width ?? fixedWidth ?? clamp(natural, minimum, maximum)

    const inner = width - m.padX * 2 - 2 - iconSpace - statusSpace - versionWidth
    const labelLines = lineCount(label, m.labelSize, inner, 600)
    const detailLines = lineCount(detail, m.detailSize, inner)
    const rich = Boolean(node.rows?.length || node.metrics?.length || node.tags?.length || node.footer || node.owner || node.spark)
    let content = labelLines * m.labelSize * 1.2
    if (detailLines) content += d.s(3) + detailLines * m.detailSize * 1.25
    if (hasIcon) content = Math.max(content, measuredIcon)
    // Each row block sits under a rule, with the node's gap above and below that rule.
    if (node.rows?.length) content += m.gap * 2 + 1 + node.rows.length * m.microLine + (node.rows.length - 1) * d.s(2) + node.rows.filter((row) => row.bar != null).length * (Math.max(2, d.g(3)) + 1)
    if (node.metrics?.length) {
        const hasSpark = node.metrics.some((metric) => metric.spark)
        const hasBar = node.metrics.some((metric) => metric.bar != null)
        content += m.gap + d.f(14) * 1.1 + d.s(1) + m.micro * 1.2 + (hasSpark ? d.f(14) + d.s(1) : 0) + (hasBar ? Math.max(2, d.g(3)) + d.s(1) : 0)
    }
    if (node.spark) content += m.gap + d.f(18)
    if (node.tags?.length) {
        const tagWidths = node.tags.map((tag) => estimateTextWidth(graphAccessibleText(tag), m.micro) + d.s(10) + 2)
        let tagLines = 1, current = 0
        for (const tagWidth of tagWidths) {
            if (current > 0 && current + d.s(3) + tagWidth > width - m.padX * 2 - 2) {
                tagLines += 1
                current = tagWidth
            } else current += (current > 0 ? d.s(3) : 0) + tagWidth
        }
        content += m.gap + tagLines * (m.micro * 1.1 + Math.max(1, d.s(1.5)) * 2 + 2) + (tagLines - 1) * d.s(3)
    }
    if (footerText) content += m.gap + m.microLine
    const natural_height = Math.ceil(content) + m.padY * 2 + 2 + (rich ? d.s(2) : 0)
    const floor = minHeight ?? d.f(rich ? 0 : 38)
    return { width, height: node.height ?? Math.max(floor, natural_height) }
}

interface ScopePlacement {
    width: number
    height: number
    nodes: Map<string, { x: number; y: number }>
    groups: Map<string, Rectangle>
}

interface GroupedLayoutOptions {
    direction: 'LR' | 'RL' | 'TB' | 'BT'
    groupDirection: 'LR' | 'RL' | 'TB' | 'BT'
    nodeGap: number
    rankGap: number
    edgeGap: number
    groupPad: number
    headerHeight: number
    /** Largest stack of unconnected siblings before they wrap into another column. */
    wrapAt: number
    measureLabel: (label: string) => { width: number; height: number }
}

/**
 * Lays out each group on its own, then lays the groups out as blocks. Each group
 * stays a compact unit, and links between groups cannot stretch one apart.
 */
function layoutGroupedGraph(
    nodes: GraphDiagramNode[],
    edges: GraphDiagramEdge[],
    groups: GraphDiagramGroup[],
    sizes: Map<string, { width: number; height: number }>,
    options: GroupedLayoutOptions,
): { positions: Map<string, { x: number; y: number }>; rects: Map<string, Rectangle> } {
    const groupById = new Map(groups.map((group) => [group.id, group]))
    const chain = (nodeId: string): string[] => {
        const node = nodes.find((entry) => entry.id === nodeId)
        const out: string[] = []
        for (let group = node?.group; group != null; group = groupById.get(group)?.parent) out.push(group)
        return out
    }
    const chains = new Map(nodes.map((node) => [node.id, chain(node.id)]))
    const isHorizontal = (direction: GroupedLayoutOptions['direction']) => direction === 'LR' || direction === 'RL'

    const childIn = (nodeId: string, scope: string | null): string | undefined => {
        const ancestors = chains.get(nodeId) ?? []
        if (scope === null) return ancestors.length ? ancestors[ancestors.length - 1] : nodeId
        const index = ancestors.indexOf(scope)
        if (index < 0) return undefined
        return index === 0 ? nodeId : ancestors[index - 1]
    }

    const place = (scope: string | null, order: Map<string, number>): ScopePlacement => {
        const direction = scope === null ? options.direction : options.groupDirection
        const horizontal = isHorizontal(direction)
        const nodeChildren = nodes.filter((node) => (node.group ?? null) === scope).map((node) => node.id)
        const groupChildren = groups.filter((group) => (group.parent ?? null) === scope).map((group) => group.id)
        const childIds = [...groupChildren, ...nodeChildren]
            .map((id, index) => ({ id, index, key: order.get(id) ?? index }))
            .sort((left, right) => left.key - right.key || left.index - right.index)
            .map((entry) => entry.id)
        const inner = new Map(groupChildren.map((id) => [id, place(id, order)]))
        const sizeOf = (id: string) => inner.get(id) ?? sizes.get(id)!

        const links = new Map<string, { from: string; to: string; label?: string }>()
        for (const edge of edges) {
            const from = childIn(edge.from, scope), to = childIn(edge.to, scope)
            if (!from || !to || from === to) continue
            const key = `${from}\u0000${to}`
            const previous = links.get(key)
            const label = edge.label && (!previous?.label || edge.label.length > previous.label.length) ? edge.label : previous?.label
            links.set(key, { from, to, ...(label ? { label } : {}) })
        }

        const centers = new Map<string, { x: number; y: number }>()
        if (links.size === 0 && childIds.length > options.wrapAt) {
            // Unconnected siblings stack in columns rather than one very tall run.
            const lines = Math.ceil(childIds.length / options.wrapAt)
            const perLine = Math.ceil(childIds.length / lines)
            let offset = 0
            for (let line = 0; line < lines; line += 1) {
                const members = childIds.slice(line * perLine, (line + 1) * perLine)
                const across = Math.max(...members.map((id) => horizontal ? sizeOf(id).width : sizeOf(id).height))
                let along = 0
                for (const id of members) {
                    const size = sizeOf(id)
                    const span = horizontal ? size.height : size.width
                    centers.set(id, horizontal ? { x: offset + across / 2, y: along + span / 2 } : { x: along + span / 2, y: offset + across / 2 })
                    along += span + options.nodeGap
                }
                offset += across + options.nodeGap
            }
        } else {
            const graph = new dagre.graphlib.Graph({ multigraph: false })
                .setGraph({ rankdir: direction, nodesep: options.nodeGap, ranksep: options.rankGap, edgesep: options.edgeGap, marginx: 0, marginy: 0 })
                .setDefaultEdgeLabel(() => ({}))
            for (const id of childIds) graph.setNode(id, { width: sizeOf(id).width, height: sizeOf(id).height })
            for (const link of links.values()) {
                const size = link.label ? options.measureLabel(link.label) : { width: 0, height: 0 }
                graph.setEdge(link.from, link.to, { width: size.width, height: size.height })
            }
            dagre.layout(graph)
            for (const id of childIds) {
                const position = graph.node(id)
                centers.set(id, { x: position?.x ?? 0, y: position?.y ?? 0 })
            }
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const id of childIds) {
            const size = sizeOf(id), center = centers.get(id)!
            minX = Math.min(minX, center.x - size.width / 2)
            minY = Math.min(minY, center.y - size.height / 2)
            maxX = Math.max(maxX, center.x + size.width / 2)
            maxY = Math.max(maxY, center.y + size.height / 2)
        }
        if (minX === Infinity) {
            minX = 0
            minY = 0
            maxX = 0
            maxY = 0
        }
        const framed = scope !== null
        const pad = framed ? options.groupPad : 0
        const header = framed ? options.headerHeight : 0
        const originX = pad - minX
        const originY = pad + header - minY
        const placedNodes = new Map<string, { x: number; y: number }>()
        const placedGroups = new Map<string, Rectangle>()
        for (const id of childIds) {
            const center = centers.get(id)!, size = sizeOf(id)
            const left = center.x - size.width / 2 + originX
            const top = center.y - size.height / 2 + originY
            const child = inner.get(id)
            if (child) {
                placedGroups.set(id, { left, top, right: left + size.width, bottom: top + size.height })
                for (const [nodeId, point] of child.nodes) placedNodes.set(nodeId, { x: point.x + left, y: point.y + top })
                for (const [groupId, rect] of child.groups) {
                    placedGroups.set(groupId, { left: rect.left + left, right: rect.right + left, top: rect.top + top, bottom: rect.bottom + top })
                }
            } else {
                placedNodes.set(id, { x: center.x + originX, y: center.y + originY })
            }
        }
        return { width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 + header, nodes: placedNodes, groups: placedGroups }
    }

    // The second pass reorders siblings toward their neighbors, which removes most avoidable crossings.
    const first = place(null, new Map())
    const perpendicular = (id: string) => {
        const point = first.nodes.get(id)
        return point ? (isHorizontal(options.direction) ? point.y : point.x) : 0
    }
    const pull = new Map<string, number[]>()
    for (const edge of edges) {
        ;(pull.get(edge.from) ?? pull.set(edge.from, []).get(edge.from)!).push(perpendicular(edge.to))
        ;(pull.get(edge.to) ?? pull.set(edge.to, []).get(edge.to)!).push(perpendicular(edge.from))
    }
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    const order = new Map<string, number>()
    for (const node of nodes) {
        const values = pull.get(node.id)
        order.set(node.id, values?.length ? mean(values) : perpendicular(node.id))
    }
    for (const group of [...groups].sort((left, right) => graphGroupDepth(right, groupById) - graphGroupDepth(left, groupById))) {
        const members = nodes.filter((node) => chains.get(node.id)?.includes(group.id)).map((node) => order.get(node.id) ?? 0)
        order.set(group.id, members.length ? mean(members) : 0)
    }
    const second = place(null, order)
    return { positions: second.nodes, rects: second.groups }
}

type RoutedSide = GraphPortSide

const OPPOSITE: Record<RoutedSide, RoutedSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }

/** Which sides a connector should use. Primary flow leaves the far side and enters the near side. */
function chooseSides(from: PositionedGraphNode, to: PositionedGraphNode, horizontal: boolean): [RoutedSide, RoutedSide] {
    const dx = to.cx - from.cx, dy = to.cy - from.cy
    const separatedX = Math.abs(dx) > (from.width + to.width) / 2 + 4
    const separatedY = Math.abs(dy) > (from.height + to.height) / 2 + 4
    const useX = horizontal ? separatedX || !separatedY : separatedX && !separatedY
    if (useX) {
        const side: RoutedSide = dx >= 0 ? 'right' : 'left'
        return [side, OPPOSITE[side]]
    }
    const side: RoutedSide = dy >= 0 ? 'bottom' : 'top'
    return [side, OPPOSITE[side]]
}

export function GraphDiagram({
    nodes,
    edges,
    groups = [],
    c: baseTheme,
    width,
    height,
    nodeWidth,
    nodeHeight,
    labelFontSize,
    detailFontSize,
    arrowSize,
    padding: paddingProp,
    layout: requestedLayout,
    direction = 'LR',
    groupDirection,
    nodeGap: nodeGapProp,
    rankGap: rankGapProp,
    edgeGap: edgeGapProp,
    routing = 'dagre',
    routingClearance: routingClearanceProp,
    sizing = 'content',
    iconSize: iconSizeProp,
    id,
    ariaLabel,
    title,
    description,
    legend,
    annotations = [],
    density,
    crossingBudget,
}: GraphDiagramProps): React.ReactElement {
    const c = density !== undefined ? withDensity(baseTheme, density) : baseTheme
    const d = densityOf(c)
    const padding = paddingProp ?? d.s(28)
    const nodeGap = nodeGapProp ?? d.s(40)
    const rankGap = rankGapProp ?? d.s(72)
    const edgeGap = edgeGapProp ?? d.s(14)
    const routingClearance = routingClearanceProp ?? d.s(12)
    const iconSize = iconSizeProp ?? d.f(20)
    const engineering = c.preset === 'engineering'
    if (id != null && id.trim().length === 0) throw new Error('GraphDiagram id must not be empty.')
    if (!['dagre', 'straight', 'orthogonal'].includes(routing)) throw new Error('GraphDiagram routing must be "dagre", "straight", or "orthogonal".')
    if (!Number.isFinite(routingClearance) || routingClearance <= 0) throw new Error('GraphDiagram routingClearance must be a finite positive number.')
    const fullyPositioned = nodes.filter((node) => node.x != null && node.y != null).length
    const partiallyPositioned = nodes.some((node) => (node.x == null) !== (node.y == null))
    if (partiallyPositioned || (fullyPositioned > 0 && fullyPositioned < nodes.length)) {
        throw new Error('GraphDiagram nodes must either all define both x and y, or all omit coordinates for automatic layout.')
    }
    const layoutMode = requestedLayout ?? (fullyPositioned === nodes.length && nodes.length > 0 ? 'manual' : 'auto')
    if (layoutMode === 'manual' && fullyPositioned !== nodes.length) {
        throw new Error('GraphDiagram layout="manual" requires x and y on every node.')
    }
    validateGraphDiagramSpec(nodes, edges, groups, layoutMode)
    const edgeOccurrences = new Map<string, number>()
    const stableEdgeIds = edges.map((edge) => {
        if (edge.id != null) return `custom-${edge.id}`
        const route = `${edge.from}\u0000${edge.to}`
        const occurrence = edgeOccurrences.get(route) ?? 0
        edgeOccurrences.set(route, occurrence + 1)
        return `route-${edge.from}-to-${edge.to}-${occurrence}`
    })
    if (new Set(stableEdgeIds).size !== stableEdgeIds.length) {
        throw new Error('GraphDiagram edge ids must not collide with generated relationship ids.')
    }
    const svgTitle = title?.trim() || ariaLabel?.trim() || 'Graph diagram'
    const svgDescription = description ?? graphDescription(nodes, edges)

    const metrics: GraphNodeMetrics = {
        labelSize: labelFontSize ?? d.type.label,
        detailSize: detailFontSize ?? d.type.small,
        iconSize,
        padX: d.s(11),
        padY: d.s(8),
        gap: d.s(7),
        lineHeight: 1.2,
        micro: d.type.micro,
        microLine: d.type.micro * 1.25,
    }
    const sizes = new Map(nodes.map((node) => [node.id, measureGraphNode(node, nodeWidth, nodeHeight, metrics, d)]))
    const edgeLabelSize = d.type.micro
    const edgeLabelPad = { x: d.s(5), y: Math.max(1, d.s(2)) }
    const measureEdgeLabel = (label: string) => ({
        width: Math.ceil(estimateTextWidth(label, edgeLabelSize, { mono: engineering })) + edgeLabelPad.x * 2 + 2,
        height: Math.ceil(edgeLabelSize * 1.15) + edgeLabelPad.y * 2,
    })

    let resolvedWidth = width ?? 0
    let resolvedHeight = height ?? 0
    let layout: Map<string, PositionedGraphNode>
    let groupLayout: PositionedGraphGroup[] = []
    let autoEdgePoints = new Map<number, Point[]>()
    const groupHeaderHeight = d.type.small * 1.25 + d.s(8)
    const groupPad = d.s(12)

    if (layoutMode === 'auto') {
        const boxes = new Map<string, Rectangle>()
        const groupsById = new Map(groups.map((group) => [group.id, group]))
        if (groups.length > 0) {
            const grouped = layoutGroupedGraph(nodes, edges, groups, sizes, {
                direction,
                groupDirection: groupDirection ?? direction,
                nodeGap,
                rankGap,
                edgeGap,
                groupPad,
                headerHeight: groupHeaderHeight,
                wrapAt: 5,
                measureLabel: measureEdgeLabel,
            })
            layout = new Map(nodes.map((node) => {
                const point = grouped.positions.get(node.id) ?? { x: 0, y: 0 }
                return [node.id, { ...node, width: sizes.get(node.id)!.width, height: sizes.get(node.id)!.height, cx: point.x, cy: point.y }]
            }))
            for (const [id, rect] of grouped.rects) boxes.set(id, rect)
        } else {
            const graph = new dagre.graphlib.Graph({ multigraph: true })
                .setGraph({
                    rankdir: direction,
                    nodesep: nodeGap,
                    ranksep: rankGap,
                    edgesep: edgeGap,
                    marginx: padding,
                    marginy: padding,
                })
                .setDefaultEdgeLabel(() => ({}))
            for (const node of nodes) {
                graph.setNode(node.id, { width: sizes.get(node.id)!.width, height: sizes.get(node.id)!.height })
            }
            edges.forEach((edge, index) => {
                const size = edge.label ? measureEdgeLabel(edge.label) : { width: 0, height: 0 }
                graph.setEdge(edge.from, edge.to, { width: size.width, height: size.height }, `edge-${index}`)
            })
            dagre.layout(graph)
            layout = new Map(nodes.map((node) => {
                const position = graph.node(node.id)
                return [node.id, {
                    ...node,
                    width: sizes.get(node.id)!.width,
                    height: sizes.get(node.id)!.height,
                    cx: position?.x ?? 0,
                    cy: position?.y ?? 0,
                }]
            }))
            autoEdgePoints = new Map(edges.map((edge, index) => {
                const placed = graph.edge({ v: edge.from, w: edge.to, name: `edge-${index}` })
                return [index, (placed?.points ?? []).map((point: Point) => ({ x: point.x, y: point.y }))]
            }))
        }
        groupLayout = groups.map((group) => {
            const rect = boxes.get(group.id) ?? { left: 0, right: 0, top: 0, bottom: 0 }
            return {
                ...group,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top,
                cx: (rect.left + rect.right) / 2,
                cy: (rect.top + rect.bottom) / 2,
                depth: graphGroupDepth(group, groupsById),
                headerX: rect.left + d.s(8),
                headerY: rect.top + d.s(4),
            }
        }).sort((left, right) => left.depth - right.depth)

        // Fit the canvas to the real extents, then center inside any requested size.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        const extend = (rect: Rectangle) => {
            minX = Math.min(minX, rect.left)
            minY = Math.min(minY, rect.top)
            maxX = Math.max(maxX, rect.right)
            maxY = Math.max(maxY, rect.bottom)
        }
        for (const node of layout.values()) extend(nodeRect(node))
        for (const rect of boxes.values()) extend(rect)
        for (const points of autoEdgePoints.values()) for (const point of points) extend({ left: point.x, right: point.x, top: point.y, bottom: point.y })
        if (minX === Infinity) {
            minX = 0
            minY = 0
            maxX = 0
            maxY = 0
        }
        // Notes hang outside the nodes they point at, so reserve a margin for them.
        const notes = annotations.length ? d.s(26) + d.type.micro * 1.3 * 3 + 4 : 0
        const contentWidth = Math.ceil(maxX - minX + padding * 2)
        const contentHeight = Math.ceil(maxY - minY + padding * 2 + notes * 2)
        if (sizing === 'content') {
            resolvedWidth = Math.max(width ?? 0, contentWidth)
            resolvedHeight = Math.max(height ?? 0, contentHeight)
        } else {
            resolvedWidth = width ?? contentWidth
            resolvedHeight = height ?? contentHeight
        }
        const offsetX = (resolvedWidth - (maxX - minX)) / 2 - minX
        const offsetY = (resolvedHeight - (maxY - minY)) / 2 - minY
        for (const node of layout.values()) {
            node.cx += offsetX
            node.cy += offsetY
        }
        for (const group of groupLayout) {
            group.cx += offsetX
            group.cy += offsetY
            group.headerX += offsetX
            group.headerY += offsetY
        }
        for (const points of autoEdgePoints.values()) {
            for (const point of points) {
                point.x += offsetX
                point.y += offsetY
            }
        }
    } else {
        resolvedWidth = width ?? 520
        resolvedHeight = height ?? 420
        layout = manualGraphLayout(nodes, sizes, resolvedWidth, resolvedHeight, padding)
    }

    const anchored = (edge: GraphDiagramEdge) => edge.fromPort != null || edge.toPort != null || edge.fromSide != null || edge.toSide != null
    const groupOf = new Map(nodes.map((node) => [node.id, node.group]))
    const flowIsHorizontal = (edge: GraphDiagramEdge) => {
        const sameGroup = groupOf.get(edge.from) != null && groupOf.get(edge.from) === groupOf.get(edge.to)
        const flow = sameGroup ? groupDirection ?? direction : direction
        return flow === 'LR' || flow === 'RL'
    }
    const headerRects = new Map(groupLayout.map((group) => [group.id, {
        left: group.headerX,
        right: Math.min(group.cx + group.width / 2 - d.s(6), group.headerX + groupHeaderWidth(group, d)),
        top: group.headerY,
        bottom: group.headerY + groupHeaderHeight - d.s(4),
    }]))

    // Explicit anchors opt into obstacle-aware geometry even while Dagre remains the layout engine.
    const orthogonalEdges = edges.flatMap((edge, index) => routing === 'orthogonal' || (routing === 'dagre' && anchored(edge))
        || (routing === 'straight' && edge.from === edge.to) ? [{ edge, index }] : [])
    const routeWith = (subset: { edge: GraphDiagramEdge; index: number }[]) => routeOrthogonalGraph(
        Array.from(layout.values()), subset.map(({ edge }) => edge), resolvedWidth, resolvedHeight,
        routingClearance, edgeGap,
        Array.from(headerRects.values()),
    )
    const routed = routeWith(orthogonalEdges)
    const orthogonalPoints = new Map(Array.from(routed.routes, ([index, points]) => [orthogonalEdges[index]!.index, points]))
    const failedIndexes = new Set(routed.failures.map((failure) => orthogonalEdges[failure.index]!.index))
    const routingFailures = routed.failures.map((failure) => {
        const { edge } = orthogonalEdges[failure.index]!
        return `Connector "${edge.from}" -> "${edge.to}" was not drawn: ${failure.reason}.`
    })

    // Connectors share a node side in the order of what they connect to, so they fan out without crossing.
    const slotOffsets = new Map<string, number>()
    if (routing === 'dagre') {
        const sideUsers = new Map<string, { key: string; other: number; length: number }[]>()
        edges.forEach((edge, index) => {
            if (edge.from === edge.to || orthogonalPoints.has(index) || failedIndexes.has(index)) return
            const from = layout.get(edge.from), to = layout.get(edge.to)
            if (!from || !to) return
            const [fromSide, toSide] = chooseSides(from, to, flowIsHorizontal(edge))
            const coordinate = (node: PositionedGraphNode, side: RoutedSide) => side === 'left' || side === 'right' ? node.cy : node.cx
            const add = (node: PositionedGraphNode, side: RoutedSide, other: PositionedGraphNode, end: 'from' | 'to') => {
                const key = `${node.id}\u0000${side}`
                const list = sideUsers.get(key) ?? []
                list.push({ key: `${index}\u0000${end}`, other: coordinate(other, side) + index * 0.001, length: side === 'left' || side === 'right' ? node.height : node.width })
                sideUsers.set(key, list)
            }
            add(from, fromSide, to, 'from')
            add(to, toSide, from, 'to')
        })
        for (const users of sideUsers.values()) {
            users.sort((left, right) => left.other - right.other)
            const length = users[0]!.length
            const spacing = users.length > 1 ? Math.min(d.s(12) + edgeLabelSize * 0.2, (length * 0.78) / (users.length - 1)) : 0
            users.forEach((user, position) => slotOffsets.set(user.key, (position - (users.length - 1) / 2) * spacing))
        }
    }

    const sideAnchor = (node: PositionedGraphNode, side: RoutedSide, offset: number): Point => {
        if (side === 'left') return { x: node.cx - node.width / 2, y: node.cy + offset }
        if (side === 'right') return { x: node.cx + node.width / 2, y: node.cy + offset }
        if (side === 'top') return { x: node.cx + offset, y: node.cy - node.height / 2 }
        return { x: node.cx + offset, y: node.cy + node.height / 2 }
    }

    const placedLabels: Rectangle[] = []
    const nodeRects = Array.from(layout.values()).map((node) => ({ id: node.id, rect: nodeRect(node) }))
    const rawEdgeLayouts: Omit<PositionedGraphEdge, 'labelX' | 'labelY'>[] = edges.flatMap((edge, index) => {
        if (failedIndexes.has(index)) return []
        const from = layout.get(edge.from)
        const to = layout.get(edge.to)
        if (!from || !to) return []
        const automatic = autoEdgePoints.get(index)
        const selfLoop = edge.from === edge.to
        if (!selfLoop && from.cx === to.cx && from.cy === to.cy && !automatic?.length) return []

        const color = edge.muted
            ? c.textMuted
            : edge.tone != null
                ? getToneColor(edge.tone, c)
                : engineering ? c.textSecondary : c.textMuted
        const markerBaseId = `graph-arrow-${edge.from}-${edge.to}-${index}-${arrowSize ?? d.arrow}-${color}`.replace(/[^a-zA-Z0-9_-]/g, '-')

        const loopClearance = Math.max(d.s(24), d.arrow * 3)
        const routedPoints = orthogonalPoints.get(index)
        let path: string
        let samples: Point[]
        let route: Point[]
        if (routedPoints) {
            const rounded = roundedPolylinePath(routedPoints, d.s(8))
            path = rounded.d
            samples = rounded.samples
            route = routedPoints
        } else if (routing === 'straight') {
            route = straightGraphRoute(from, to, edge)
            path = route.map((point, position) => `${position === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
            samples = route
        } else if (selfLoop) {
            const right = from.cx + from.width / 2, top = from.cy - from.height / 2
            const start = { x: right, y: from.cy - d.s(8) }
            const corner1 = { x: right + loopClearance, y: from.cy - d.s(8) }
            const corner2 = { x: right + loopClearance, y: top - loopClearance }
            const corner3 = { x: from.cx + d.s(10), y: top - loopClearance }
            const end = { x: from.cx + d.s(10), y: top }
            const rounded = roundedPolylinePath([start, corner1, corner2, corner3, end], d.s(8))
            path = rounded.d
            samples = rounded.samples
            route = [start, corner1, corner2, corner3, end]
        } else {
            const [fromSide, toSide] = chooseSides(from, to, flowIsHorizontal(edge))
            const start = sideAnchor(from, fromSide, slotOffsets.get(`${index}\u0000from`) ?? 0)
            const end = sideAnchor(to, toSide, slotOffsets.get(`${index}\u0000to`) ?? 0)
            // A direct curve reads best. Dagre's waypoints only help when that curve clips a node.
            let smooth = smoothConnector(start, end, fromSide, toSide)
            let hit = false
            const clearance = 2
            const hitsAnything = (candidate: { samples: Point[] }) => nodeRects.some(({ id: nodeId, rect }) =>
                nodeId !== edge.from && nodeId !== edge.to && samplesHitBox(candidate.samples, {
                    left: rect.left - clearance, right: rect.right + clearance, top: rect.top - clearance, bottom: rect.bottom + clearance,
                }))
            if (hitsAnything(smooth)) {
                const interior = automatic && automatic.length > 2 ? automatic.slice(1, -1).filter((point) => {
                    const clearOf = (rect: Rectangle) => !(point.x > rect.left - 6 && point.x < rect.right + 6 && point.y > rect.top - 6 && point.y < rect.bottom + 6)
                    return clearOf(nodeRect(from)) && clearOf(nodeRect(to))
                }) : []
                const guided = smoothConnector(start, end, fromSide, toSide, interior)
                if (interior.length > 0 && !hitsAnything(guided)) smooth = guided
                else hit = true
            }
            if (hit) {
                const detour = routeOrthogonalGraph(Array.from(layout.values()), [{ ...edge, fromSide, toSide }], resolvedWidth, resolvedHeight, Math.min(routingClearance, d.s(8)), edgeGap, [])
                const points = detour.routes.get(0)
                if (points) {
                    const rounded = roundedPolylinePath(points, d.s(8))
                    path = rounded.d
                    samples = rounded.samples
                    route = points
                } else {
                    path = smooth.d
                    samples = smooth.samples
                    route = smooth.samples
                }
            } else {
                path = smooth.d
                samples = smooth.samples
                route = smooth.samples
            }
        }

        const labelSize = edge.label ? measureEdgeLabel(edge.label) : { width: 0, height: 0 }
        return [{
            ...edge,
            index,
            stableId: stableEdgeIds[index]!,
            color,
            markerStartId: `${markerBaseId}-start`,
            markerEndId: `${markerBaseId}-end`,
            points: samples,
            route,
            path,
            labelWidth: labelSize.width,
            labelHeight: labelSize.height,
        }]
    })

    // Place each label on its own line at the clearest spot, away from boxes, titles, and other wires.
    const headerList = Array.from(headerRects.values())
    const edgeLayouts: PositionedGraphEdge[] = rawEdgeLayouts.map((edge) => {
        if (!edge.label) {
            const mid = pointAlongSamples(edge.points, 0.5)
            return { ...edge, labelX: mid.x, labelY: mid.y }
        }
        const candidates = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]
        let best = { x: 0, y: 0, score: Infinity }
        candidates.forEach((fraction, order) => {
            const point = pointAlongSamples(edge.points, fraction)
            const rect = { left: point.x - edge.labelWidth / 2, right: point.x + edge.labelWidth / 2, top: point.y - edge.labelHeight / 2, bottom: point.y + edge.labelHeight / 2 }
            let score = order * 0.2
            for (const { rect: box } of nodeRects) if (rectanglesOverlap(rect, box, 1)) score += 40
            for (const header of headerList) if (rectanglesOverlap(rect, header, 1)) score += 20
            for (const placed of placedLabels) if (rectanglesOverlap(rect, placed, 2)) score += 30
            for (const other of rawEdgeLayouts) if (other !== edge && samplesHitBox(other.points, rect)) score += 8
            if (rect.left < 0 || rect.right > resolvedWidth || rect.top < 0 || rect.bottom > resolvedHeight) score += 15
            if (score < best.score) best = { x: point.x, y: point.y, score }
        })
        placedLabels.push({ left: best.x - edge.labelWidth / 2, right: best.x + edge.labelWidth / 2, top: best.y - edge.labelHeight / 2, bottom: best.y + edge.labelHeight / 2 })
        return { ...edge, labelX: best.x, labelY: best.y }
    })

    // A group title moves to a free corner when connectors run through its usual spot.
    for (const group of groupLayout) {
        const rect = headerRects.get(group.id)
        if (!rect) continue
        const width = rect.right - rect.left, headerHeight = rect.bottom - rect.top
        const left = group.cx - group.width / 2, right = group.cx + group.width / 2
        const top = group.cy - group.height / 2
        const options = [
            { x: left + d.s(8), y: top + d.s(4) },
            { x: right - width - d.s(8), y: top + d.s(4) },
        ]
        const clear = options.find((option) => !edgeLayouts.some((edge) => samplesHitBox(edge.points, {
            left: option.x, right: option.x + width, top: option.y, bottom: option.y + headerHeight,
        })))
        const chosen = clear ?? options[0]!
        group.headerX = chosen.x
        group.headerY = chosen.y
        group.headerFlipped = chosen === options[1]
        headerRects.set(group.id, { left: chosen.x, right: chosen.x + width, top: chosen.y, bottom: chosen.y + headerHeight })
    }
    const finalHeaders = Array.from(headerRects.values())

    const crossings = connectorCrossings(edgeLayouts)
    const labelCollisions = connectorLabelCollisions(edgeLayouts, layout, finalHeaders)
    const crossedLabels = labelCrossings(edgeLayouts, finalHeaders)
    const crowdedEndpoints = crowdedConnectorEndpoints(edgeLayouts)
    const parallelGroups = parallelConnectorGroups(edgeLayouts.filter((edge) => !orthogonalPoints.has(edge.index)))

    const groupElements = groupLayout.map((group) => {
        const accent = group.muted ? c.textMuted : getToneColor(group.tone ?? 'neutral', c)
        return React.createElement('div', {
            key: `graph-group-${group.id}`,
            'data-vizmatic-graph-group': group.id,
            style: {
                position: 'absolute' as const,
                left: group.cx - group.width / 2,
                top: group.cy - group.height / 2,
                width: group.width,
                height: group.height,
                display: 'flex',
                boxSizing: 'border-box' as const,
                borderRadius: engineering ? 6 : d.r(10),
                border: `1px ${group.muted ? 'dashed' : 'solid'} ${group.tone ? withColorAlpha(accent, (group.muted ? 0x55 : 0x77) / 0xff) : c.border}`,
                backgroundColor: group.tone ? withColorAlpha(accent, (engineering ? 0x08 : 0x07) / 0xff) : withColorAlpha(c.textPrimary, 0.012),
                opacity: group.muted ? 0.68 : 1,
            },
        })
    })

    // Titles sit above the connectors with a solid backing, so nothing strikes through them.
    const groupHeaderElements = groupLayout.map((group) => {
        const rect = headerRects.get(group.id)!
        const outerLeft = group.cx - group.width / 2 + d.s(8)
        const outerRight = group.cx + group.width / 2 - d.s(8)
        const spansGroup = group.summary != null
        return React.createElement('div', {
            key: `graph-group-header-${group.id}`,
            'data-vizmatic-graph-group-header': group.id,
            style: {
                position: 'absolute' as const,
                left: spansGroup ? outerLeft : group.headerX,
                top: group.headerY,
                width: Math.max(0, spansGroup ? outerRight - outerLeft : rect.right - rect.left),
                height: rect.bottom - rect.top,
                display: 'flex',
                // A title moved aside by connectors trades places with the group's summary.
                flexDirection: group.headerFlipped && spansGroup ? 'row-reverse' as const : 'row' as const,
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: d.s(10),
                color: group.muted ? c.textMuted : c.textPrimary,
                fontFamily: c.fontSans,
                lineHeight: 1.25,
                whiteSpace: 'nowrap' as const,
                opacity: group.muted ? 0.75 : 1,
            },
        },
            React.createElement('div', {
                style: {
                    display: 'flex', alignItems: 'baseline', gap: d.s(7), minWidth: 0, overflow: 'hidden',
                    backgroundColor: c.bg, padding: `0 ${d.s(3)}px`,
                },
            },
                React.createElement('div', {
                    style: {
                        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: d.type.small, fontWeight: 600,
                        color: group.tone && !group.muted ? getReadableToneColor(group.tone, c) : undefined,
                    },
                }, group.label),
                group.detail && React.createElement('div', {
                    style: {
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: c.textMuted,
                        fontFamily: c.fontSans,
                        fontSize: d.type.micro,
                        fontWeight: 400,
                    },
                }, group.detail),
            ),
            group.summary != null && React.createElement('div', {
                style: {
                    display: 'flex', flexShrink: 0, color: c.textSecondary, fontFamily: c.fontMono, fontSize: d.type.micro,
                    backgroundColor: c.bg, padding: `0 ${d.s(3)}px`,
                },
            }, group.summary),
        )
    })

    // Notes point at nodes from outside, along short leader lines.
    const annotationElements: React.ReactElement[] = []
    const leaderLines: React.ReactElement[] = []
    const annotationSize = d.type.micro
    annotations.forEach((annotation, index) => {
        const node = layout.get(annotation.target)
        if (!node) throw new Error(`GraphDiagram annotation references missing node "${annotation.target}".`)
        const text = graphAccessibleText(annotation.text)
        const boxWidth = annotation.width ?? Math.min(d.f(190), Math.ceil(estimateTextWidth(text, annotationSize)) + 4)
        const lines = lineCount(text, annotationSize, boxWidth)
        const boxHeight = Math.ceil(lines * annotationSize * 1.3) + 2
        const reach = d.s(26)
        // Each side is scored by what it would cover, so a crowded spot takes the least bad option.
        const cost = (rect: Rectangle) => {
            let score = 0
            for (const { rect: box } of nodeRects) if (rectanglesOverlap(rect, box, 3)) score += 40
            for (const box of finalHeaders) if (rectanglesOverlap(rect, box, 3)) score += 20
            for (const box of placedLabels) if (rectanglesOverlap(rect, box, 2)) score += 20
            for (const edge of edgeLayouts) if (samplesHitBox(edge.points, rect)) score += 6
            // The note's backing is opaque, so straddling a group's edge would cut a gap in its border.
            for (const group of groupLayout) {
                const box = {
                    left: group.cx - group.width / 2, right: group.cx + group.width / 2,
                    top: group.cy - group.height / 2, bottom: group.cy + group.height / 2,
                }
                const inside = rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom
                if (!inside && rectanglesOverlap(rect, box, 0)) score += 8
            }
            if (rect.left < 0 || rect.top < 0 || rect.right > resolvedWidth || rect.bottom > resolvedHeight) score += 60
            return score
        }
        const rectFor = (side: RoutedSide, out: number, along: number): Rectangle => {
            const distance = reach * out
            if (side === 'top' || side === 'bottom') {
                const left = node.cx - boxWidth / 2 + along * boxWidth
                const top = side === 'top' ? node.cy - node.height / 2 - distance - boxHeight : node.cy + node.height / 2 + distance
                return { left, right: left + boxWidth, top, bottom: top + boxHeight }
            }
            const top = node.cy - boxHeight / 2 + along * boxHeight
            const left = side === 'right' ? node.cx + node.width / 2 + distance : node.cx - node.width / 2 - distance - boxWidth
            return { left, right: left + boxWidth, top, bottom: top + boxHeight }
        }
        // Near and centered wins when it is clear. Otherwise the note moves out or along its side.
        const sides: RoutedSide[] = annotation.side ? [annotation.side] : ['top', 'bottom', 'right', 'left']
        const options: { side: RoutedSide; rect: Rectangle; score: number }[] = []
        for (const side of sides) {
            for (const out of [1, 1.7, 2.6]) {
                for (const along of [0, 0.42, -0.42]) {
                    const rect = rectFor(side, out, along)
                    options.push({ side, rect, score: cost(rect) + (out - 1) * 2 + Math.abs(along) * 2 })
                }
            }
        }
        const placed = options.reduce((best, option) => option.score < best.score ? option : best)
        placedLabels.push(placed.rect)
        const color = annotation.tone ? getToneColor(annotation.tone, c) : c.textMuted
        const anchor = sideAnchor(node, placed.side, 0)
        const clampTo = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
        const tipX = clampTo(node.cx, placed.rect.left + 2, placed.rect.right - 2)
        const tipY = clampTo(node.cy, placed.rect.top + 2, placed.rect.bottom - 2)
        const tip = placed.side === 'top' ? { x: tipX, y: placed.rect.bottom }
            : placed.side === 'bottom' ? { x: tipX, y: placed.rect.top }
                : placed.side === 'right' ? { x: placed.rect.left, y: tipY } : { x: placed.rect.right, y: tipY }
        leaderLines.push(
            React.createElement('line', {
                key: `leader-${index}`, x1: anchor.x, y1: anchor.y, x2: tip.x, y2: tip.y, stroke: color, strokeWidth: d.stroke.hair,
            }),
            React.createElement('circle', { key: `leader-dot-${index}`, cx: anchor.x, cy: anchor.y, r: d.g(2), fill: color }),
        )
        annotationElements.push(React.createElement('div', {
            key: `graph-annotation-${index}`,
            'data-vizmatic-graph-annotation': annotation.target,
            style: {
                position: 'absolute' as const,
                left: placed.rect.left,
                top: placed.rect.top,
                width: boxWidth,
                display: 'flex',
                color: annotation.tone ? getReadableToneColor(annotation.tone, c) : c.textSecondary,
                backgroundColor: c.bg,
                fontFamily: c.fontSans,
                fontSize: annotationSize,
                fontStyle: 'italic' as const,
                lineHeight: 1.3,
                ...textFitStyle(),
            },
        }, annotation.text))
    })

    const kindLabels: Record<GraphDiagramEdgeKind, string> = {
        sync: 'synchronous', async: 'asynchronous', event: 'event', data: 'data', dependency: 'dependency', association: 'association',
    }
    const legendItems: DiagramLegendItem[] = legend === true
        ? [...new Set(edges.map((edge) => edge.kind).filter((kind): kind is GraphDiagramEdgeKind => kind != null))].map((kind) => ({
            label: kindLabels[kind],
            style: resolvedGraphEdgeStyle({ from: '', to: '', kind }),
        }))
        : Array.isArray(legend) ? legend : []
    const legendHeight = legendItems.length ? d.type.micro * 1.4 + d.s(8) : 0

    const strokeFor = (edge: PositionedGraphEdge) => {
        if (edge.muted) return d.w(1.25)
        if (edge.emphasis) return d.w(2.5)
        return engineering ? 1.7 : d.w(2)
    }

    const graphElement = React.createElement('div', {
        key: 'vizmatic-graph-root',
        role: 'img',
        'aria-label': ariaLabel ?? svgTitle,
        'data-vizmatic-svg-title': svgTitle,
        'data-vizmatic-svg-description': svgDescription,
        'data-vizmatic-svg-id': id,
        'data-vizmatic-connector-crossings': crossings,
        // Large maps always have a few crossings. Only more than this reads as congestion.
        'data-vizmatic-connector-crossing-budget': crossingBudget ?? Math.floor(edges.length / 6),
        'data-vizmatic-connector-label-collisions': labelCollisions,
        'data-vizmatic-connector-label-crossings': crossedLabels,
        'data-vizmatic-crowded-connector-endpoints': crowdedEndpoints,
        'data-vizmatic-parallel-connector-groups': parallelGroups,
        'data-vizmatic-unrouted-connectors': routingFailures.length,
        'data-vizmatic-routing-failures': routingFailures.length ? JSON.stringify(routingFailures) : undefined,
        style: {
            position: 'relative' as const,
            display: 'flex',
            width: resolvedWidth,
            height: resolvedHeight + legendHeight,
            // Content sizing must report overflow to the canvas, so it never shrinks to fit a parent.
            ...(sizing === 'content' ? {} : { maxWidth: '100%' }),
            flexShrink: 0,
        }
    },
        ...groupElements,
        React.createElement('svg', {
            width: resolvedWidth,
            height: resolvedHeight,
            viewBox: `0 0 ${resolvedWidth} ${resolvedHeight}`,
            style: { position: 'absolute' as const, inset: 0, overflow: 'visible' },
        },
            React.createElement('defs', {},
                ...edgeLayouts.flatMap((edge) => {
                    const arrow = resolvedGraphEdgeArrow(edge)
                    return [
                        ...(arrow === 'backward' || arrow === 'both' ? [ArrowMarkerDef({
                            id: edge.markerStartId,
                            color: edge.color,
                            size: arrowSize ?? d.arrow,
                            direction: 'start',
                        })] : []),
                        ...(arrow === 'forward' || arrow === 'both' ? [ArrowMarkerDef({
                            id: edge.markerEndId,
                            color: edge.color,
                            size: arrowSize ?? d.arrow,
                        })] : []),
                    ]
                })
            ),
            ...edgeLayouts.map((edge) => React.createElement('path', {
                key: `graph-edge-${edge.index}`,
                'data-vizmatic-graph-edge-id': encodeURIComponent(edge.stableId),
                'data-vizmatic-graph-edge-from': encodeURIComponent(edge.from),
                'data-vizmatic-graph-edge-to': encodeURIComponent(edge.to),
                'data-vizmatic-graph-edge-label': encodeURIComponent(edge.label ?? ''),
                'data-vizmatic-graph-edge-title': encodeURIComponent(edge.title ?? ''),
                'data-vizmatic-graph-edge-href': edge.href == null ? undefined : encodeURIComponent(edge.href),
                'data-vizmatic-graph-edge-route': JSON.stringify(edge.route.length <= 24 ? edge.route : []),
                d: edge.path,
                fill: 'none',
                stroke: edge.color,
                strokeWidth: strokeFor(edge),
                strokeDasharray: resolvedGraphEdgeStyle(edge) === 'dashed'
                    ? `${d.s(7)} ${d.s(6)}`
                    : resolvedGraphEdgeStyle(edge) === 'dotted'
                        ? `${d.w(2)} ${d.s(6)}`
                        : undefined,
                strokeLinecap: resolvedGraphEdgeStyle(edge) === 'dotted' ? 'round' : 'butt',
                opacity: edge.muted ? 0.6 : 1,
                markerStart: resolvedGraphEdgeArrow(edge) === 'backward' || resolvedGraphEdgeArrow(edge) === 'both'
                    ? `url(#${edge.markerStartId})`
                    : undefined,
                markerEnd: resolvedGraphEdgeArrow(edge) === 'forward' || resolvedGraphEdgeArrow(edge) === 'both'
                    ? `url(#${edge.markerEndId})`
                    : undefined,
            })),
            ...leaderLines,
        ),
        ...edgeLayouts.flatMap((edge) => edge.label ? [
            React.createElement('div', {
                key: `graph-edge-label-${edge.index}`,
                style: {
                    position: 'absolute' as const,
                    left: edge.labelX,
                    top: edge.labelY,
                    transform: 'translate(-50%, -50%)',
                    padding: `${edgeLabelPad.y}px ${edgeLabelPad.x}px`,
                    borderRadius: engineering ? 0 : d.r(3),
                    backgroundColor: c.bg,
                    color: edge.muted ? c.textMuted : (edge.tone && !engineering ? getReadableToneColor(edge.tone, c, c.bg, c.bg) : c.textSecondary),
                    fontFamily: engineering ? c.fontMono : c.fontSans,
                    fontSize: edgeLabelSize,
                    fontWeight: 400,
                    lineHeight: 1.15,
                    ...(engineering ? {
                        textTransform: 'uppercase' as const,
                        letterSpacing: '0.02em',
                    } : {}),
                    whiteSpace: 'nowrap' as const,
                }
            }, edge.label),
        ] : []),
        ...groupHeaderElements,
        ...annotationElements,
        ...Array.from(layout.values()).map((node) => renderGraphNode(node, { c, d, metrics, labelFontSize, detailFontSize, iconSize, engineering })),
        ...(legendItems.length ? [React.createElement('div', {
            key: 'graph-legend',
            style: { position: 'absolute' as const, left: padding, top: resolvedHeight + d.s(4), display: 'flex' },
        }, DiagramLegend({ items: legendItems, c }))] : []),
    )
    return graphElement
}

Object.defineProperty(GraphDiagram, SVG_ACCESSIBILITY_COMPONENT, { value: true })

function groupHeaderWidth(group: GraphDiagramGroup, d: DensityTokens): number {
    const label = graphAccessibleText(group.label)
    const detail = graphAccessibleText(group.detail)
    return Math.ceil(estimateTextWidth(label, d.type.small, { weight: 600 })
        + (detail ? d.s(7) + estimateTextWidth(detail, d.type.micro) : 0)) + d.s(6) + 2
}

interface GraphNodeContext {
    c: ThemeColors
    d: DensityTokens
    metrics: GraphNodeMetrics
    labelFontSize?: number
    detailFontSize?: number
    iconSize: number
    engineering: boolean
}

function renderGraphNode(node: PositionedGraphNode, { c, d, metrics, labelFontSize, detailFontSize, iconSize, engineering }: GraphNodeContext): React.ReactElement {
    const toned = node.tone != null
    const tone = node.tone ?? 'neutral'
    const accent = node.muted ? c.textMuted : getToneColor(tone, c)
    const fill = getToneFill(tone, c)
    const resolvedIconSize = clamp(
        node.iconSize ?? iconSize,
        8,
        Math.max(8, Math.min(node.width, node.height) - metrics.padY * 2 - 2),
    )
    const iconLabel = typeof node.label === 'string' ? `${node.label} icon` : undefined
    const iconElement = typeof node.icon === 'string'
        ? Icon({ c, name: node.icon, color: toned ? accent : c.textSecondary, size: resolvedIconSize, label: iconLabel, muted: node.muted })
        : React.isValidElement(node.icon)
            ? node.icon
            : node.icon?.render({ c, color: accent, size: resolvedIconSize, label: iconLabel })
    const icon = iconElement && React.createElement('div', {
        'data-vizmatic-graph-icon': node.id,
        style: {
            width: resolvedIconSize,
            height: resolvedIconSize,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: `0 0 ${resolvedIconSize}px`,
            overflow: 'hidden',
        },
    }, iconElement)
    const hasBody = Boolean(node.rows?.length || node.metrics?.length || node.tags?.length || node.footer || node.owner || node.spark)
    const leftAligned = Boolean(icon) || hasBody || Boolean(node.status) || Boolean(node.version)
    const title = React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: leftAligned ? 'flex-start' : 'center',
            gap: node.detail ? d.s(3) : 0,
            minWidth: 0,
            flex: 1,
        }
    },
        React.createElement('div', {
            style: {
                fontFamily: c.fontSans,
                fontSize: labelFontSize ?? metrics.labelSize,
                fontWeight: 600,
                lineHeight: 1.2,
                color: node.muted ? c.textMuted : c.textPrimary,
                ...textFitStyle(leftAligned ? 'left' : 'center'),
            }
        }, node.label),
        node.detail && React.createElement('div', {
            style: {
                color: engineering ? c.textMuted : c.textSecondary,
                fontFamily: engineering ? c.fontMono : c.fontSans,
                fontSize: detailFontSize ?? metrics.detailSize,
                fontWeight: 400,
                lineHeight: 1.25,
                ...textFitStyle(leftAligned ? 'left' : 'center'),
            }
        }, node.detail),
    )
    const trailing = compactChildren([
        node.version && React.createElement('div', {
            key: 'version',
            style: { display: 'flex', flexShrink: 0, color: c.textMuted, fontFamily: c.fontMono, fontSize: metrics.micro, lineHeight: 1.2 },
        }, node.version),
        node.status && React.createElement(React.Fragment, { key: 'status' }, StatusDot({ status: node.status, c })),
    ])
    const divider = () => React.createElement('div', {
        style: { display: 'flex', width: '100%', height: 1, backgroundColor: c.borderSubtle, flexShrink: 0 },
    })
    const footerParts = compactChildren([node.owner, node.footer])
    return React.createElement('div', {
        key: `graph-node-${node.id}`,
        'data-vizmatic-graph-node-id': node.id,
        'data-vizmatic-graph-node-label': graphAccessibleText(node.label) || node.id,
        'data-vizmatic-graph-node-detail': graphAccessibleText(node.detail),
        'data-vizmatic-graph-node-title': node.title ?? '',
        'data-vizmatic-graph-node-href': node.href,
        style: {
            position: 'absolute' as const,
            left: node.cx - node.width / 2,
            top: node.cy - node.height / 2,
            width: node.width,
            height: node.height,
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'stretch',
            justifyContent: hasBody ? 'flex-start' : 'center',
            gap: metrics.gap,
            padding: `${metrics.padY}px ${metrics.padX}px`,
            boxSizing: 'border-box' as const,
            borderRadius: engineering ? 5 : d.r(8),
            backgroundColor: node.muted ? c.bgSubtle : engineering ? fill : c.bgCard,
            border: `1px solid ${node.muted ? c.borderLight : engineering ? accent : toned ? withColorAlpha(accent, 0.55) : c.borderLight}`,
            opacity: node.muted ? 0.62 : 1,
            color: c.textPrimary,
        }
    },
        React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: leftAligned && !node.detail ? 'center' : leftAligned ? 'flex-start' : 'center',
                justifyContent: leftAligned ? 'flex-start' : 'center',
                gap: d.s(9),
                width: '100%',
            },
        }, ...compactChildren([icon, title, ...trailing])),
        ...compactChildren([
            node.rows?.length ? React.createElement(React.Fragment, { key: 'rows' }, divider(), FactRows({ rows: node.rows, c })) : undefined,
            node.metrics?.length ? React.createElement(React.Fragment, { key: 'metrics' }, MetricStrip({ metrics: node.metrics, c })) : undefined,
            node.spark ? React.createElement(React.Fragment, { key: 'spark' }, Sparkline({ values: node.spark, c, tone: node.tone, width: node.width - metrics.padX * 2 - 2, height: d.f(18), area: true })) : undefined,
            node.tags?.length ? React.createElement(React.Fragment, { key: 'tags' }, TagList({ tags: node.tags, c })) : undefined,
            footerParts.length ? React.createElement('div', {
                key: 'footer',
                style: { display: 'flex', gap: d.s(6), color: c.textMuted, fontFamily: c.fontSans, fontSize: metrics.micro, lineHeight: 1.25, whiteSpace: 'nowrap' as const, overflow: 'hidden' },
            }, ...footerParts.map((part, index) => React.createElement('div', { key: `footer-${index}`, style: { display: 'flex' } }, part))) : undefined,
        ]),
    )
}

// ─── TreeDiagram — Auto-laid hierarchy for orgs, routes, and decisions ──────

export interface TreeNodeSpec {
    label: React.ReactNode
    id?: string
    detail?: React.ReactNode
    tone?: ToneName
    muted?: boolean
    children?: TreeNodeSpec[]
}

interface TreeDiagramProps {
    root: TreeNodeSpec
    c: ThemeColors
    ariaLabel?: string
    title?: React.ReactNode
    subtitle?: React.ReactNode
    width?: number
    height?: number
    nodeWidth?: number
    nodeHeight?: number
    levelGap?: number
    siblingGap?: number
    padding?: number
    math?: boolean
}

type PositionedTreeNode = TreeNodeSpec & {
    key: string
    depth: number
    cx: number
    cy: number
}

type TreeEdgeLayout = {
    key: string
    from: PositionedTreeNode
    to: PositionedTreeNode
}

function countTreeLeaves(node: TreeNodeSpec): number {
    if (!node.children?.length) return 1
    return node.children.reduce((sum, child) => sum + countTreeLeaves(child), 0)
}

function maxTreeDepth(node: TreeNodeSpec): number {
    if (!node.children?.length) return 0
    return 1 + Math.max(...node.children.map(maxTreeDepth))
}

export function TreeDiagram({
    root,
    c,
    ariaLabel,
    title,
    subtitle,
    width,
    height,
    nodeWidth: nodeWidthProp,
    nodeHeight: nodeHeightProp,
    levelGap: levelGapProp,
    siblingGap: siblingGapProp,
    padding: paddingProp,
    math = false,
}: TreeDiagramProps): React.ReactElement {
    const nodeWidth = nodeWidthProp ?? densityOf(c).f(150)
    const nodeHeight = nodeHeightProp ?? densityOf(c).f(50)
    const levelGap = levelGapProp ?? densityOf(c).s(58)
    const siblingGap = siblingGapProp ?? densityOf(c).s(20)
    const padding = paddingProp ?? densityOf(c).s(28)
    const explicitIds = new Set<string>()
    const validateIds = (node: TreeNodeSpec): void => {
        if (node.id) {
            if (explicitIds.has(node.id)) throw new Error(`TreeDiagram received duplicate node id "${node.id}".`)
            explicitIds.add(node.id)
        }
        node.children?.forEach(validateIds)
    }
    validateIds(root)

    const leafCount = Math.max(1, countTreeLeaves(root))
    const depthCount = maxTreeDepth(root)
    const resolvedWidth = width ?? Math.max(520, padding * 2 + leafCount * nodeWidth + Math.max(0, leafCount - 1) * siblingGap)
    const resolvedHeight = height ?? padding * 2 + (depthCount + 1) * nodeHeight + depthCount * levelGap
    const levelStep = depthCount === 0
        ? 0
        : Math.max(nodeHeight + 18, (resolvedHeight - padding * 2 - nodeHeight) / depthCount)
    const usableWidth = Math.max(0, resolvedWidth - padding * 2 - nodeWidth)
    const leafStep = leafCount <= 1 ? 0 : usableWidth / (leafCount - 1)
    const positioned: PositionedTreeNode[] = []
    const edges: TreeEdgeLayout[] = []
    let nextLeaf = 0

    const placeWithEdges = (node: TreeNodeSpec, depth: number, path: string): number => {
        const children = node.children ?? []
        let centerIndex: number
        const childPlacements: Array<{ node: TreeNodeSpec; index: number; center: number }> = []

        if (!children.length) {
            centerIndex = nextLeaf
            nextLeaf += 1
        } else {
            for (let index = 0; index < children.length; index += 1) {
                const child = children[index]
                childPlacements.push({
                    node: child,
                    index,
                    center: placeWithEdges(child, depth + 1, `${path}-${index}`),
                })
            }
            centerIndex = childPlacements.reduce((sum, child) => sum + child.center, 0) / childPlacements.length
        }

        const placed: PositionedTreeNode = {
            ...node,
            key: node.id ?? path,
            depth,
            cx: leafCount <= 1 ? resolvedWidth / 2 : padding + nodeWidth / 2 + centerIndex * leafStep,
            cy: padding + nodeHeight / 2 + depth * levelStep,
        }
        positioned.push(placed)

        for (const childPlacement of childPlacements) {
            const childKey = childPlacement.node.id ?? `${path}-${childPlacement.index}`
            const childNode = positioned.find((candidate) => candidate.key === childKey)
            if (childNode) edges.push({ key: `${placed.key}-${childNode.key}`, from: placed, to: childNode })
        }

        return centerIndex
    }

    placeWithEdges(root, 0, 'root')

    const header = (title != null || subtitle != null) && React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: subtitle != null ? 4 : 0,
            width: resolvedWidth,
            maxWidth: '100%',
        }
    },
        ...compactChildren([
        title != null && React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: densityOf(c).s(8),
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize: densityOf(c).f(16),
                fontWeight: 600,
                lineHeight: 1.2,
            }
        }, ...compactChildren([root.tone && ToneStrip({ tone: root.tone }), renderMaybeMath(title, math)])),
        subtitle != null && React.createElement('div', {
            style: {
                display: 'flex',
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: densityOf(c).f(11),
                fontWeight: 500,
                lineHeight: 1.35,
            }
        }, renderMaybeMath(subtitle, math)),
        ])
    )

    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: densityOf(c).s(header ? 10 : 0),
            width: resolvedWidth,
            maxWidth: '100%',
        }
    },
        ...compactChildren([
        header,
        React.createElement('div', {
            role: 'img',
            'aria-label': ariaLabel ?? (typeof title === 'string' ? title : 'Tree diagram'),
            style: {
                position: 'relative' as const,
                display: 'flex',
                width: resolvedWidth,
                height: resolvedHeight,
                maxWidth: '100%',
                flexShrink: 0,
            }
        },
            React.createElement('svg', {
                width: resolvedWidth,
                height: resolvedHeight,
                viewBox: `0 0 ${resolvedWidth} ${resolvedHeight}`,
                style: { position: 'absolute' as const, inset: 0, overflow: 'visible' },
            }, ...edges.map((edge) => {
                const color = c.borderLight
                const startY = edge.from.cy + nodeHeight / 2
                const endY = edge.to.cy - nodeHeight / 2
                const midY = startY + (endY - startY) / 2
                return React.createElement('path', {
                    key: `tree-edge-${edge.key}`,
                    d: `M ${edge.from.cx} ${startY} C ${edge.from.cx} ${midY}, ${edge.to.cx} ${midY}, ${edge.to.cx} ${endY}`,
                    fill: 'none',
                    stroke: color,
                    strokeWidth: densityOf(c).w(edge.to.muted ? 1.5 : 2),
                    strokeLinecap: 'round',
                    opacity: edge.to.muted ? 0.5 : 1,
                })
            })),
            ...positioned.map((node) => {
                const accent = node.muted ? c.textMuted : getToneColor(node.tone ?? 'neutral', c)
                const accentText = node.muted ? c.textMuted : c.textPrimary
                return React.createElement('div', {
                    key: `tree-node-${node.key}`,
                    style: {
                        position: 'absolute' as const,
                        left: node.cx - nodeWidth / 2,
                        top: node.cy - nodeHeight / 2,
                        width: nodeWidth,
                        height: nodeHeight,
                        display: 'flex',
                        flexDirection: 'column' as const,
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: densityOf(c).s(node.detail ? 4 : 0),
                        padding: `${densityOf(c).s(8)}px ${densityOf(c).s(10)}px`,
                        boxSizing: 'border-box' as const,
                        borderRadius: densityOf(c).r(8),
                        backgroundColor: node.muted ? c.bgSubtle : c.bgCard,
                        border: `1px solid ${node.muted ? c.borderLight : node.tone ? withColorAlpha(accent, 0.55) : c.borderLight}`,
                        ...(!node.muted && hasShadow(c) ? { boxShadow: `0 8px 18px ${c.shadow}` } : {}),
                        opacity: node.muted ? 0.62 : 1,
                        color: accentText,
                        textAlign: 'center' as const,
                    }
                },
                    React.createElement('div', {
                        style: {
                            color: accentText,
                            fontFamily: 'Inter',
                            fontSize: densityOf(c).f(13),
                            fontWeight: 600,
                            lineHeight: 1.15,
                            ...textFitStyle('center'),
                        }
                    }, renderMaybeMath(node.label, math)),
                    node.detail != null && React.createElement('div', {
                        style: {
                            color: c.textMuted,
                            fontFamily: 'JetBrains Mono',
                            fontSize: densityOf(c).f(11),
                            fontWeight: 650,
                            lineHeight: 1.2,
                            ...textFitStyle('center'),
                        }
                    }, renderMaybeMath(node.detail, math)),
                )
            }),
        ),
        ])
    )
}

// ─── CalloutCard — Small highlighted takeaway block ────────────────────────

interface CalloutCardProps {
    c: ThemeColors
    children?: React.ReactNode
    title?: React.ReactNode
    detail?: React.ReactNode
    tone?: ToneName
    width?: number | string
    minHeight?: number | string
    padding?: number | string
    titleFontSize?: number
    detailFontSize?: number
    filled?: boolean
    align?: 'left' | 'center'
}

export function CalloutCard({
    c,
    children,
    title,
    detail,
    tone = 'blue',
    width,
    minHeight,
    padding: paddingProp,
    titleFontSize,
    detailFontSize,
    filled = true,
    align = 'left',
}: CalloutCardProps): React.ReactElement {
    const d = densityOf(c)
    const padding = paddingProp ?? `${d.s(9)}px ${d.s(13)}px`
    const accent = getToneColor(tone, c)
    const engineering = c.preset === 'engineering'
    const textAlign = align

    return React.createElement('div', {
        style: {
            ...(width != null ? { width } : {}),
            ...(minHeight != null ? { minHeight } : {}),
            padding,
            borderRadius: engineering ? 5 : d.r(8),
            boxSizing: 'border-box' as const,
            // A filled callout is a quiet tint with a colored rule. Solid banners read as slides.
            ...(engineering
                ? { backgroundColor: getToneFill(tone, c), color: c.textPrimary, border: `1px solid ${accent}` }
                : filled
                    ? { backgroundColor: withColorAlpha(accent, 0x12 / 0xff), color: c.textPrimary, border: `1px solid ${withColorAlpha(accent, 0.4)}` }
                    : { backgroundColor: c.bgCard, color: c.textPrimary, border: `1px solid ${c.border}` }),
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: align === 'center' ? 'center' : 'flex-start',
            justifyContent: 'center',
            gap: detail ? d.s(3) : 0,
            textAlign,
        }
    },
        ...compactChildren([
        title && React.createElement('div', {
            style: {
                fontSize: titleFontSize ?? d.type.body,
                color: c.textPrimary,
                fontFamily: c.fontSans,
                fontWeight: 600,
                lineHeight: 1.2,
                textAlign,
            }
        }, title),
        detail && React.createElement('div', {
            style: {
                fontSize: detailFontSize ?? d.type.small,
                color: c.textSecondary,
                fontFamily: engineering ? c.fontMono : c.fontSans,
                lineHeight: 1.3,
                textAlign,
            }
        }, detail),
        children && React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                alignItems: align === 'center' ? 'center' : 'flex-start',
                fontSize: d.type.small,
                fontWeight: 400,
                lineHeight: 1.3,
                textAlign,
            }
        }, children),
        ])
    )
}

// ─── Pipeline — Horizontal flow with arrows between stages ──────────────────

export interface PipelineStage {
    label: string
    sublabel?: string
    icon?: string
    color?: ColorName
}

interface PipelineProps {
    stages: PipelineStage[]
    c: ThemeColors
    title?: string
}

export function Pipeline({ stages, c, title }: PipelineProps): React.ReactElement {
    return React.createElement('div', {
        style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            gap: densityOf(c).s(20),
        }
    },
        title && React.createElement('div', {
            style: { ...typeOf(c, 'label'), color: c.textPrimary }
        }, title),

        React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: densityOf(c).s(0),
            }
        },
            ...stages.flatMap((stage, i) => {
                const elements: React.ReactElement[] = []

                elements.push(
                    Box({
                        label: stage.label,
                        sublabel: stage.sublabel,
                        icon: stage.icon,
                        color: stage.color || 'primary',
                        gradient: true,
                        c,
                        fontSize: densityOf(c).f(13),
                    })
                )

                if (i < stages.length - 1) {
                    elements.push(
                        Arrow({ direction: 'right', length: 36, c })
                    )
                }

                return elements
            }),
        ),
    )
}
