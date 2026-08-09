import React from 'react'
import dagre, { type Point } from '@dagrejs/dagre'
import {
    typography,
    type ThemeColors,
    type ColorName,
    type ToneName,
    getReadableToneColor,
    getReadableTextColor,
    getToneColor,
    getToneFill,
    getToneGradient,
} from '../theme'

import { clamp, compactChildren, formatMathText, Icon, textFitStyle, ToneStrip, type IconName } from './layout'
import { Arrow, ArrowMarkerDef, Box } from './svg'
import { renderMaybeMath } from './surfaces'

// ─── LayeredNetwork — Dense neural-network diagram without local coordinate code ─

export interface LayeredNetworkLayer {
    title: string
    nodes: string[]
    tone?: ToneName
}

interface LayeredNetworkProps {
    c: ThemeColors
    layers: LayeredNetworkLayer[]
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
        fontSize = 13,
        fontWeight = 800,
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
                        backgroundColor: `${c.warningLight}2e`,
                        border: `4px solid ${c.warningLight}`,
                        boxSizing: 'border-box' as const,
                        boxShadow: `0 0 18px ${c.warningLight}66`,
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
                        boxShadow: active ? `0 0 16px ${c.warningLight}70` : `0 8px 14px ${c.shadow}`,
                        fontFamily: 'JetBrains Mono',
                        fontSize: 16,
                        fontWeight: 900,
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
                borderRadius: 10,
                border: `1px solid ${c.borderSubtle}`,
                backgroundColor: c.bgCard,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize: 15,
                fontWeight: 850,
                boxShadow: `0 8px 18px ${c.shadow}`,
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
                gap: 14,
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: 12,
                fontWeight: 800,
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
    x?: number
    y?: number
    tone?: ToneName
    muted?: boolean
    width?: number
    height?: number
    group?: string
    icon?: IconName | DiagramIconDefinition | React.ReactElement
    iconSize?: number
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
}

export type GraphDiagramEdgeKind = 'sync' | 'async' | 'event' | 'data' | 'dependency' | 'association'
export type GraphDiagramEdgeStyle = 'solid' | 'dashed' | 'dotted'
export type GraphDiagramEdgeArrow = 'forward' | 'backward' | 'both' | 'none'

export interface GraphDiagramEdge {
    from: string
    to: string
    tone?: ToneName
    muted?: boolean
    dashed?: boolean
    label?: string
    kind?: GraphDiagramEdgeKind
    style?: GraphDiagramEdgeStyle
    arrow?: GraphDiagramEdgeArrow
}

export interface GraphDiagramProps {
    nodes: GraphDiagramNode[]
    edges: GraphDiagramEdge[]
    groups?: GraphDiagramGroup[]
    c: ThemeColors
    width?: number
    height?: number
    nodeWidth?: number
    nodeHeight?: number
    labelFontSize?: number
    detailFontSize?: number
    arrowSize?: number
    padding?: number
    layout?: 'auto' | 'manual'
    direction?: 'LR' | 'RL' | 'TB' | 'BT'
    nodeGap?: number
    rankGap?: number
    edgeGap?: number
    sizing?: 'content' | 'fixed'
    iconSize?: number
    ariaLabel?: string
}

type PositionedGraphNode = GraphDiagramNode & {
    width: number
    height: number
    cx: number
    cy: number
}

type PositionedGraphEdge = GraphDiagramEdge & {
    index: number
    color: string
    markerId: string
    points: Point[]
    labelX: number
    labelY: number
}

type PositionedGraphGroup = GraphDiagramGroup & {
    width: number
    height: number
    cx: number
    cy: number
    depth: number
}

function manualGraphLayout(
    nodes: GraphDiagramNode[],
    width: number,
    height: number,
    nodeWidth: number,
    nodeHeight: number,
    padding: number,
): Map<string, PositionedGraphNode> {
    return new Map(nodes.map((node) => {
        const resolvedWidth = node.width ?? nodeWidth
        const resolvedHeight = node.height ?? nodeHeight
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
    return d1 * d2 < -epsilon && d3 * d4 < -epsilon
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

function connectorLabelCollisions(
    edges: PositionedGraphEdge[],
    nodes: Map<string, PositionedGraphNode>,
    groups: PositionedGraphGroup[] = [],
): number {
    const labels = edges.flatMap((edge) => edge.label ? [{
        bounds: {
            left: edge.labelX - estimatedEdgeLabelWidth(edge.label) / 2,
            right: edge.labelX + estimatedEdgeLabelWidth(edge.label) / 2,
            top: edge.labelY - 10,
            bottom: edge.labelY + 10,
        },
    }] : [])
    let collisions = 0

    for (let index = 0; index < labels.length; index += 1) {
        for (let otherIndex = index + 1; otherIndex < labels.length; otherIndex += 1) {
            if (rectanglesOverlap(labels[index].bounds, labels[otherIndex].bounds, 4)) collisions += 1
        }
        for (const node of nodes.values()) {
            const bounds = {
                left: node.cx - node.width / 2,
                right: node.cx + node.width / 2,
                top: node.cy - node.height / 2,
                bottom: node.cy + node.height / 2,
            }
            if (rectanglesOverlap(labels[index].bounds, bounds)) collisions += 1
        }
        for (const group of groups) {
            const headerBounds = {
                left: group.cx - group.width / 2,
                right: group.cx + group.width / 2,
                top: group.cy - group.height / 2,
                bottom: group.cy - group.height / 2 + 26,
            }
            if (rectanglesOverlap(labels[index].bounds, headerBounds)) collisions += 1
        }
    }

    return collisions
}

function crowdedConnectorEndpoints(edges: PositionedGraphEdge[]): number {
    const degrees = new Map<string, number>()
    for (const edge of edges) {
        degrees.set(edge.from, (degrees.get(edge.from) ?? 0) + 1)
        degrees.set(edge.to, (degrees.get(edge.to) ?? 0) + 1)
    }
    return Array.from(degrees.values()).filter((degree) => degree > 4).length
}

function parallelConnectorGroups(edges: PositionedGraphEdge[]): number {
    const routes = new Map<string, number>()
    for (const edge of edges) {
        const key = [edge.from, edge.to].sort().join('\u0000')
        routes.set(key, (routes.get(key) ?? 0) + 1)
    }
    return Array.from(routes.values()).filter((count) => count > 1).length
}

function edgePath(points: Point[]): string {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function estimatedEdgeLabelWidth(label: string): number {
    const units = Array.from(label.normalize('NFC')).reduce((sum, character) =>
        sum + ((character.codePointAt(0) ?? 0) > 0xff ? 1.7 : 1), 0)
    return Math.max(28, Math.ceil(units * 6 + 14))
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

    for (const edge of edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
            throw new Error(`GraphDiagram edge "${edge.from}" -> "${edge.to}" references a missing node.`)
        }
    }

    if (groups.length > 0 && layoutMode === 'manual') {
        throw new Error('GraphDiagram groups require automatic layout; omit node coordinates and layout="manual".')
    }
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

export function GraphDiagram({
    nodes,
    edges,
    groups = [],
    c,
    width,
    height,
    nodeWidth = 150,
    nodeHeight = 66,
    labelFontSize = 14,
    detailFontSize = 11,
    arrowSize = 5,
    padding = 28,
    layout: requestedLayout,
    direction = 'LR',
    nodeGap = 34,
    rankGap = 64,
    edgeGap = 14,
    sizing = 'content',
    iconSize = 20,
    ariaLabel,
}: GraphDiagramProps): React.ReactElement {
    const fullyPositioned = nodes.filter((node) => node.x != null && node.y != null).length
    const partiallyPositioned = nodes.some((node) => (node.x == null) !== (node.y == null))
    if (partiallyPositioned || (fullyPositioned > 0 && fullyPositioned < nodes.length)) {
        throw new Error('GraphDiagram nodes must either all define both x and y, or all omit coordinates for automatic layout.')
    }
    const layoutMode = requestedLayout ?? (fullyPositioned === nodes.length ? 'manual' : 'auto')
    if (layoutMode === 'manual' && fullyPositioned !== nodes.length) {
        throw new Error('GraphDiagram layout="manual" requires x and y on every node.')
    }
    validateGraphDiagramSpec(nodes, edges, groups, layoutMode)
    let resolvedWidth = width ?? 520
    let resolvedHeight = height ?? 420
    let layout: Map<string, PositionedGraphNode>
    let groupLayout: PositionedGraphGroup[] = []
    let autoEdgePoints = new Map<number, { points: Point[]; labelX: number; labelY: number }>()

    if (layoutMode === 'auto') {
        const compoundGap = groups.length > 0 ? 34 : 0
        const graph = new dagre.graphlib.Graph({ multigraph: true, compound: groups.length > 0 })
            .setGraph({
                rankdir: direction,
                nodesep: Math.max(nodeGap, compoundGap),
                ranksep: Math.max(rankGap, compoundGap),
                edgesep: edgeGap,
                marginx: padding,
                marginy: padding,
            })
            .setDefaultEdgeLabel(() => ({}))
        for (const group of groups) graph.setNode(group.id, { width: 0, height: 0 })
        for (const node of nodes) {
            graph.setNode(node.id, { width: node.width ?? nodeWidth, height: node.height ?? nodeHeight })
        }
        for (const group of groups) {
            if (group.parent != null) graph.setParent(group.id, group.parent)
        }
        for (const node of nodes) {
            if (node.group != null) graph.setParent(node.id, node.group)
        }
        edges.forEach((edge, index) => {
            const labelWidth = edge.label ? estimatedEdgeLabelWidth(edge.label) : 0
            graph.setEdge(edge.from, edge.to, { width: labelWidth, height: edge.label ? 18 : 0 }, `edge-${index}`)
        })
        dagre.layout(graph)

        const graphSize = graph.graph()
        if (sizing === 'content') {
            resolvedWidth = Math.max(width ?? 520, Math.ceil(graphSize.width ?? 0))
            resolvedHeight = Math.max(height ?? 420, Math.ceil(graphSize.height ?? 0))
        }
        const offsetX = (resolvedWidth - (graphSize.width ?? resolvedWidth)) / 2
        const offsetY = (resolvedHeight - (graphSize.height ?? resolvedHeight)) / 2
        layout = new Map(nodes.map((node) => {
            const position = graph.node(node.id)
            return [node.id, {
                ...node,
                width: node.width ?? nodeWidth,
                height: node.height ?? nodeHeight,
                cx: (position?.x ?? resolvedWidth / 2) + offsetX,
                cy: (position?.y ?? resolvedHeight / 2) + offsetY,
            }]
        }))
        const groupsById = new Map(groups.map((group) => [group.id, group]))
        groupLayout = groups.map((group) => {
            const position = graph.node(group.id)
            return {
                ...group,
                width: position?.width ?? 0,
                height: position?.height ?? 0,
                cx: (position?.x ?? resolvedWidth / 2) + offsetX,
                cy: (position?.y ?? resolvedHeight / 2) + offsetY,
                depth: graphGroupDepth(group, groupsById),
            }
        }).sort((left, right) => left.depth - right.depth)
        autoEdgePoints = new Map(edges.map((edge, index) => {
            const placed = graph.edge({ v: edge.from, w: edge.to, name: `edge-${index}` })
            const points = (placed?.points ?? []).map((point: Point) => ({ x: point.x + offsetX, y: point.y + offsetY }))
            return [index, {
                points,
                labelX: placed?.x != null ? placed.x + offsetX : (points[Math.floor(points.length / 2)]?.x ?? resolvedWidth / 2),
                labelY: placed?.y != null ? placed.y + offsetY : (points[Math.floor(points.length / 2)]?.y ?? resolvedHeight / 2),
            }]
        }))
    } else {
        layout = manualGraphLayout(nodes, resolvedWidth, resolvedHeight, nodeWidth, nodeHeight, padding)
    }

    const edgeLayouts: PositionedGraphEdge[] = edges.flatMap((edge, index) => {
        const from = layout.get(edge.from)
        const to = layout.get(edge.to)
        if (!from || !to) return []
        const automatic = autoEdgePoints.get(index)
        const selfLoop = edge.from === edge.to
        if (!selfLoop && from.cx === to.cx && from.cy === to.cy && !automatic?.points.length) return []

        const dx = to.cx - from.cx
        const dy = to.cy - from.cy
        const absDx = Math.abs(dx)
        const absDy = Math.abs(dy)
        const fromScale = Math.min(
            absDx > 0 ? (from.width / 2) / absDx : Infinity,
            absDy > 0 ? (from.height / 2) / absDy : Infinity,
        )
        const toScale = Math.min(
            absDx > 0 ? (to.width / 2) / absDx : Infinity,
            absDy > 0 ? (to.height / 2) / absDy : Infinity,
        )
        const color = edge.muted
            ? c.textMuted
            : c.preset === 'engineering' && edge.tone == null
                ? c.textSecondary
                : getToneColor(edge.tone ?? 'blue', c)
        const markerId = `graph-arrow-${edge.from}-${edge.to}-${index}-${arrowSize}-${color}`.replace(/[^a-zA-Z0-9_-]/g, '-')

        const loopClearance = Math.max(24, arrowSize * 5)
        const manualLoopPoints = selfLoop ? [
            { x: from.cx + from.width / 2, y: from.cy - 8 },
            { x: from.cx + from.width / 2 + loopClearance, y: from.cy - 8 },
            { x: from.cx + from.width / 2 + loopClearance, y: from.cy - from.height / 2 - loopClearance },
            { x: from.cx + 10, y: from.cy - from.height / 2 - loopClearance },
            { x: from.cx + 10, y: from.cy - from.height / 2 },
        ] : undefined
        const points = automatic?.points.length ? automatic.points : manualLoopPoints ?? [
            { x: from.cx + dx * fromScale, y: from.cy + dy * fromScale },
            { x: to.cx - dx * toScale, y: to.cy - dy * toScale },
        ]
        const manualLoopLabel = manualLoopPoints ? {
            x: from.cx + from.width / 2 + loopClearance,
            y: from.cy - from.height / 2 - loopClearance / 2,
        } : undefined

        return [{
            ...edge,
            index,
            color,
            markerId,
            points,
            labelX: automatic?.labelX ?? manualLoopLabel?.x ?? (points[0].x + points[points.length - 1].x) / 2,
            labelY: automatic?.labelY ?? manualLoopLabel?.y ?? (points[0].y + points[points.length - 1].y) / 2,
        }]
    })

    const crossings = connectorCrossings(edgeLayouts)
    const labelCollisions = connectorLabelCollisions(edgeLayouts, layout, groupLayout)
    const crowdedEndpoints = crowdedConnectorEndpoints(edgeLayouts)
    const parallelGroups = parallelConnectorGroups(edgeLayouts)

    const groupElements = groupLayout.map((group) => {
        const accent = group.muted ? c.textMuted : getToneColor(group.tone ?? 'blue', c)
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
                borderRadius: c.preset === 'engineering' ? 6 : 12,
                border: `${c.preset === 'engineering' ? 1.25 : 1.5}px ${group.muted ? 'dashed' : 'solid'} ${accent}${group.muted ? '55' : '77'}`,
                backgroundColor: `${accent}${c.preset === 'engineering' ? '08' : '0d'}`,
                opacity: group.muted ? 0.68 : 1,
            },
        }, React.createElement('div', {
            style: {
                position: 'absolute' as const,
                left: 10,
                top: 5,
                display: 'flex',
                alignItems: 'baseline',
                gap: 7,
                width: Math.max(0, group.width - 20),
                overflow: 'hidden',
                color: group.muted ? c.textMuted : getReadableToneColor(group.tone ?? 'blue', c),
                fontFamily: c.fontSans,
                lineHeight: 1,
                whiteSpace: 'nowrap' as const,
            },
        },
            React.createElement('div', {
                style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12, fontWeight: 800 },
            }, group.label),
            group.detail && React.createElement('div', {
                style: {
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: c.textMuted,
                    fontFamily: c.fontMono,
                    fontSize: 11,
                    fontWeight: 500,
                },
            }, group.detail),
        ))
    })

    return React.createElement('div', {
        role: 'img',
        'aria-label': ariaLabel,
        'data-vizmatic-connector-crossings': crossings,
        'data-vizmatic-connector-label-collisions': labelCollisions,
        'data-vizmatic-crowded-connector-endpoints': crowdedEndpoints,
        'data-vizmatic-parallel-connector-groups': parallelGroups,
        style: {
            position: 'relative' as const,
            display: 'flex',
            width: resolvedWidth,
            height: resolvedHeight,
            maxWidth: '100%',
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
                ...edgeLayouts.map((edge) => ArrowMarkerDef({
                    id: edge.markerId,
                    color: edge.color,
                    size: arrowSize,
                }))
            ),
            ...edgeLayouts.map((edge) => React.createElement('path', {
                key: `graph-edge-${edge.index}`,
                d: edgePath(edge.points),
                fill: 'none',
                stroke: edge.color,
                strokeWidth: edge.muted ? 1.4 : (c.preset === 'engineering' ? 1.7 : 2.8),
                strokeDasharray: resolvedGraphEdgeStyle(edge) === 'dashed'
                    ? '7 6'
                    : resolvedGraphEdgeStyle(edge) === 'dotted'
                        ? '2 6'
                        : undefined,
                strokeLinecap: 'round',
                opacity: edge.muted ? 0.48 : 0.9,
                markerStart: resolvedGraphEdgeArrow(edge) === 'backward' || resolvedGraphEdgeArrow(edge) === 'both'
                    ? `url(#${edge.markerId})`
                    : undefined,
                markerEnd: resolvedGraphEdgeArrow(edge) === 'forward' || resolvedGraphEdgeArrow(edge) === 'both'
                    ? `url(#${edge.markerId})`
                    : undefined,
            })),
        ),
        ...edgeLayouts.flatMap((edge) => edge.label ? [
            React.createElement('div', {
                key: `graph-edge-label-${edge.index}`,
                style: {
                    position: 'absolute' as const,
                    left: edge.labelX,
                    top: edge.labelY,
                    transform: 'translate(-50%, -50%)',
                    padding: c.preset === 'engineering' ? '3px 5px' : '3px 7px',
                    borderRadius: c.preset === 'engineering' ? 0 : 999,
                    backgroundColor: c.preset === 'engineering' ? c.bg : c.bgCard,
                    border: c.preset === 'engineering' ? 'none' : `1px solid ${c.borderSubtle}`,
                    color: edge.muted ? c.textMuted : (c.preset === 'engineering' ? c.textSecondary : getReadableToneColor(edge.tone ?? 'blue', c)),
                    fontFamily: c.fontMono,
                    fontSize: 11,
                    fontWeight: c.preset === 'engineering' ? 400 : 800,
                    lineHeight: 1,
                    ...(c.preset === 'engineering' ? {
                        textTransform: 'uppercase' as const,
                        letterSpacing: '0.02em',
                    } : {}),
                    whiteSpace: 'nowrap' as const,
                }
            }, edge.label),
        ] : []),
        ...Array.from(layout.values()).map((node) => {
            const accent = node.muted ? c.textMuted : getToneColor(node.tone ?? 'blue', c)
            const accentText = node.muted ? c.textMuted : getReadableToneColor(node.tone ?? 'blue', c)
            const resolvedIconSize = clamp(
                node.iconSize ?? iconSize,
                8,
                Math.max(8, Math.min(node.width, node.height) - 16),
            )
            const iconLabel = typeof node.label === 'string' ? `${node.label} icon` : undefined
            const iconElement = typeof node.icon === 'string'
                ? Icon({ c, name: node.icon, color: accent, size: resolvedIconSize, label: iconLabel, muted: node.muted })
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
            return React.createElement('div', {
                key: `graph-node-${node.id}`,
                style: {
                    position: 'absolute' as const,
                    left: node.cx - node.width / 2,
                    top: node.cy - node.height / 2,
                    width: node.width,
                    height: node.height,
                    display: 'flex',
                    flexDirection: icon ? 'row' as const : 'column' as const,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: icon ? 9 : node.detail ? 5 : 0,
                    padding: '8px 10px',
                    boxSizing: 'border-box' as const,
                    borderRadius: c.preset === 'engineering' ? 5 : 10,
                    backgroundColor: node.muted ? c.bgSubtle : getToneFill(node.tone ?? 'blue', c),
                    border: `${c.preset === 'engineering' ? 1.25 : 1.5}px solid ${node.muted ? c.borderLight : `${accent}${c.preset === 'engineering' ? '' : '88'}`}`,
                    ...(!node.muted && c.preset !== 'engineering' ? { boxShadow: `0 8px 18px ${c.shadow}` } : {}),
                    opacity: node.muted ? 0.62 : 1,
                    color: c.preset === 'engineering' ? c.textPrimary : accentText,
                    textAlign: icon ? 'left' as const : 'center' as const,
                }
            },
                icon,
                React.createElement('div', {
                    style: {
                        display: 'flex',
                        flexDirection: 'column' as const,
                        alignItems: icon ? 'flex-start' : 'center',
                        gap: node.detail ? 5 : 0,
                        minWidth: 0,
                    }
                },
                    React.createElement('div', {
                        style: {
                            fontFamily: c.fontSans,
                            fontSize: labelFontSize,
                            fontWeight: c.preset === 'engineering' ? 700 : 900,
                            lineHeight: 1.15,
                        }
                    }, node.label),
                    node.detail && React.createElement('div', {
                        style: {
                            color: c.textMuted,
                            fontFamily: c.fontMono,
                            fontSize: detailFontSize,
                            fontWeight: c.preset === 'engineering' ? 400 : 650,
                            lineHeight: 1.2,
                        }
                    }, node.detail),
                ),
            )
        }),
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
    title,
    subtitle,
    width,
    height,
    nodeWidth = 156,
    nodeHeight = 64,
    levelGap = 58,
    siblingGap = 24,
    padding = 28,
    math = false,
}: TreeDiagramProps): React.ReactElement {
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
                gap: 8,
                color: c.textPrimary,
                fontFamily: 'Inter',
                fontSize: 16,
                fontWeight: 900,
                lineHeight: 1.2,
            }
        }, ToneStrip({ tone: root.tone ?? 'blue' }), renderMaybeMath(title, math)),
        subtitle != null && React.createElement('div', {
            style: {
                display: 'flex',
                color: c.textSecondary,
                fontFamily: 'Inter',
                fontSize: 11,
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
            gap: header ? 10 : 0,
            width: resolvedWidth,
            maxWidth: '100%',
        }
    },
        ...compactChildren([
        header,
        React.createElement('div', {
            role: 'img',
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
                const tone = edge.to.muted ? 'neutral' : (edge.to.tone ?? edge.from.tone ?? 'blue')
                const color = edge.to.muted ? c.textMuted : getToneColor(tone, c)
                const startY = edge.from.cy + nodeHeight / 2
                const endY = edge.to.cy - nodeHeight / 2
                const midY = startY + (endY - startY) / 2
                return React.createElement('path', {
                    key: `tree-edge-${edge.key}`,
                    d: `M ${edge.from.cx} ${startY} C ${edge.from.cx} ${midY}, ${edge.to.cx} ${midY}, ${edge.to.cx} ${endY}`,
                    fill: 'none',
                    stroke: color,
                    strokeWidth: edge.to.muted ? 1.4 : 2.4,
                    strokeLinecap: 'round',
                    opacity: edge.to.muted ? 0.4 : 0.74,
                })
            })),
            ...positioned.map((node) => {
                const accent = node.muted ? c.textMuted : getToneColor(node.tone ?? 'blue', c)
                const accentText = node.muted ? c.textMuted : getReadableToneColor(node.tone ?? 'blue', c)
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
                        gap: node.detail ? 4 : 0,
                        padding: '8px 10px',
                        boxSizing: 'border-box' as const,
                        borderRadius: 8,
                        backgroundColor: node.muted ? c.bgSubtle : c.bgCard,
                        border: `1.5px solid ${node.muted ? c.borderLight : `${accent}88`}`,
                        ...(!node.muted ? { boxShadow: `0 8px 18px ${c.shadow}` } : {}),
                        opacity: node.muted ? 0.62 : 1,
                        color: accentText,
                        textAlign: 'center' as const,
                    }
                },
                    React.createElement('div', {
                        style: {
                            color: accentText,
                            fontFamily: 'Inter',
                            fontSize: 13,
                            fontWeight: 900,
                            lineHeight: 1.15,
                            ...textFitStyle('center'),
                        }
                    }, renderMaybeMath(node.label, math)),
                    node.detail != null && React.createElement('div', {
                        style: {
                            color: c.textMuted,
                            fontFamily: 'JetBrains Mono',
                            fontSize: 11,
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
    padding = 12,
    titleFontSize,
    detailFontSize,
    filled = true,
    align = 'center',
}: CalloutCardProps): React.ReactElement {
    const accent = getToneColor(tone, c)
    const accentText = getReadableToneColor(tone, c)
    const engineering = c.preset === 'engineering'
    const textAlign = align

    return React.createElement('div', {
        style: {
            ...(width != null ? { width } : {}),
            ...(minHeight != null ? { minHeight } : {}),
            padding,
            borderRadius: engineering ? 5 : 10,
            boxSizing: 'border-box' as const,
            ...(engineering
                ? { backgroundColor: getToneFill(tone, c), color: c.textPrimary, border: `1px solid ${accent}` }
                : filled
                ? { backgroundImage: getToneGradient(tone), color: c.textOnColor, border: `1px solid ${accent}00` }
                : { backgroundColor: c.bgCard, color: c.textPrimary, border: `1px solid ${accent}66` }),
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: align === 'center' ? 'center' : 'flex-start',
            justifyContent: 'center',
            gap: detail ? 5 : 0,
            ...(!engineering ? { boxShadow: `0 10px 24px ${c.shadow}` } : {}),
            textAlign,
        }
    },
        ...compactChildren([
        title && React.createElement('div', {
            style: {
                ...typography.small,
                ...(titleFontSize != null ? { fontSize: titleFontSize } : {}),
                color: engineering ? c.textPrimary : filled ? c.textOnColor : accentText,
                fontFamily: c.fontSans,
                fontWeight: 900,
                lineHeight: 1.2,
                textAlign,
            }
        }, title),
        detail && React.createElement('div', {
            style: {
                ...typography.tiny,
                ...(detailFontSize != null ? { fontSize: detailFontSize } : {}),
                color: engineering ? c.textSecondary : filled ? 'rgba(255,255,255,0.84)' : c.textSecondary,
                fontFamily: engineering ? c.fontMono : typography.tiny.fontFamily,
                lineHeight: 1.3,
                textAlign,
            }
        }, detail),
        children && React.createElement('div', {
            style: {
                display: 'flex',
                flexDirection: 'column' as const,
                alignItems: align === 'center' ? 'center' : 'flex-start',
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1.3,
                textAlign,
            }
        }, children),
        ])
    )
}

// ─── Pipeline — Horizontal flow with arrows between stages ──────────────────

interface PipelineStage {
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
            gap: 20,
        }
    },
        title && React.createElement('div', {
            style: { ...typography.label, color: c.textPrimary }
        }, title),

        React.createElement('div', {
            style: {
                display: 'flex',
                alignItems: 'center',
                gap: 0,
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
                        fontSize: 13,
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
