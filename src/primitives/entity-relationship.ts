import React from 'react'
import dagre from '@dagrejs/dagre'
import { densityOf, getReadableToneColor, withDensity, type Density, type ThemeColors, type ToneName } from '../theme'
import { roundedPolylinePath, routeOrthogonalGraph, samplesHitBox, type GraphPortSide, type RoutingNode, type RoutingPoint } from '../graph-routing'
import { SVG_ACCESSIBILITY_COMPONENT } from '../svg-accessibility'
import { estimateTextWidth } from './dense'

/** Multiplicity at this endpoint, per one entity at the opposite endpoint. */
export type EntityRelationshipCardinality = 'one' | 'zero-or-one' | 'one-or-many' | 'zero-or-many'

export interface EntityRelationshipAttribute {
    /** Unique within this entity. Also used by relationship endpoints. */
    name: string
    type: string
    /** Multiple marked attributes form one composite primary key. */
    primaryKey?: boolean
    foreignKey?: boolean
    unique?: boolean
    nullable?: boolean
}

export interface EntityRelationshipEntity {
    id: string
    label?: string
    tone?: ToneName
    attributes: readonly EntityRelationshipAttribute[]
}

export interface EntityRelationshipEndpoint {
    entity: string
    /** An attribute name, or an ordered list for a composite relationship. */
    attribute?: string | readonly string[]
    cardinality: EntityRelationshipCardinality
}

export interface EntityRelationship {
    id: string
    from: EntityRelationshipEndpoint
    to: EntityRelationshipEndpoint
    label?: string
    /** Solid for identifying relationships; dashed for non-identifying relationships. */
    identifying?: boolean
}

export interface EntityRelationshipDiagramProps {
    c: ThemeColors
    entities: readonly EntityRelationshipEntity[]
    relationships?: readonly EntityRelationship[]
    title?: string
    description?: string
    id?: string
    direction?: 'LR' | 'RL' | 'TB' | 'BT'
    /** Canvas width. A smaller canvas raises an error instead of shrinking the text. */
    width?: number
    /** Canvas height. A smaller canvas raises an error instead of shrinking the text. */
    height?: number
    /** Minimum entity table width. Long names expand it. */
    entityWidth?: number
    fontSize?: number
    padding?: number
    /** Minimum space between connected entity tables. */
    gap?: number
    showLegend?: boolean
    density?: Density
}

const cardinalityWords: Record<EntityRelationshipCardinality, string> = {
    one: 'exactly one', 'zero-or-one': 'zero or one', 'one-or-many': 'one or more', 'zero-or-many': 'zero or more',
}

const legendLines = [
    'PK primary key · FK foreign key · UQ unique · ? nullable',
    '|| one · o| zero or one · |< one or more · o< zero or more',
] as const

function requiredText(value: string, label: string): void {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`EntityRelationshipDiagram ${label} must be a non-empty string.`)
}

function positive(value: number, label: string, allowZero = false): void {
    if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
        throw new RangeError(`EntityRelationshipDiagram ${label} must be a finite ${allowZero ? 'non-negative' : 'positive'} number.`)
    }
}

function endpointAttributes(endpoint: EntityRelationshipEndpoint): readonly string[] {
    return endpoint.attribute === undefined ? [] : typeof endpoint.attribute === 'string' ? [endpoint.attribute] : endpoint.attribute
}

function attributeDescription(attribute: EntityRelationshipAttribute): string {
    const constraints = [attribute.primaryKey && 'primary key', attribute.foreignKey && 'foreign key', attribute.unique && 'unique', attribute.nullable ? 'nullable' : 'not null'].filter(Boolean)
    return `${attribute.name} (${attribute.type}, ${constraints.join(', ')})`
}

function endpointDescription(endpoint: EntityRelationshipEndpoint, entities: Map<string, EntityRelationshipEntity>): string {
    const entity = entities.get(endpoint.entity)!
    const attributes = endpointAttributes(endpoint)
    return `${entity.label ?? entity.id}${attributes.length ? ` [${attributes.join(', ')}]` : ''}`
}

function validate(entities: readonly EntityRelationshipEntity[], relationships: readonly EntityRelationship[]): Map<string, EntityRelationshipEntity> {
    if (!entities.length) throw new Error('EntityRelationshipDiagram requires at least one entity.')
    const byId = new Map<string, EntityRelationshipEntity>()
    for (const entity of entities) {
        requiredText(entity.id, 'entity id')
        if (byId.has(entity.id)) throw new Error(`EntityRelationshipDiagram has duplicate entity id "${entity.id}".`)
        if (entity.label !== undefined) requiredText(entity.label, `entity "${entity.id}" label`)
        const names = new Set<string>()
        for (const attribute of entity.attributes) {
            requiredText(attribute.name, `entity "${entity.id}" attribute name`)
            requiredText(attribute.type, `attribute "${entity.id}.${attribute.name}" type`)
            if (names.has(attribute.name)) throw new Error(`EntityRelationshipDiagram has duplicate attribute "${entity.id}.${attribute.name}".`)
            if (attribute.primaryKey && attribute.nullable) throw new Error(`EntityRelationshipDiagram primary key "${entity.id}.${attribute.name}" cannot be nullable.`)
            names.add(attribute.name)
        }
        byId.set(entity.id, entity)
    }
    const ids = new Set<string>()
    for (const relationship of relationships) {
        requiredText(relationship.id, 'relationship id')
        if (ids.has(relationship.id)) throw new Error(`EntityRelationshipDiagram has duplicate relationship id "${relationship.id}".`)
        ids.add(relationship.id)
        for (const endpoint of [relationship.from, relationship.to]) {
            const entity = byId.get(endpoint.entity)
            if (!entity) throw new Error(`EntityRelationshipDiagram relationship "${relationship.id}" references missing entity "${endpoint.entity}".`)
            if (!Object.hasOwn(cardinalityWords, endpoint.cardinality)) throw new Error(`EntityRelationshipDiagram relationship "${relationship.id}" has invalid cardinality "${endpoint.cardinality}".`)
            const attributes = endpointAttributes(endpoint)
            if (endpoint.attribute !== undefined && attributes.length === 0) throw new Error(`EntityRelationshipDiagram relationship "${relationship.id}" needs at least one endpoint attribute.`)
            if (new Set(attributes).size !== attributes.length) throw new Error(`EntityRelationshipDiagram relationship "${relationship.id}" repeats an endpoint attribute.`)
            for (const name of attributes) {
                if (!entity.attributes.some((attribute) => attribute.name === name)) throw new Error(`EntityRelationshipDiagram relationship "${relationship.id}" references missing attribute "${entity.id}.${name}".`)
            }
        }
        const from = endpointAttributes(relationship.from), to = endpointAttributes(relationship.to)
        if (from.length && to.length && from.length !== to.length) throw new Error(`EntityRelationshipDiagram relationship "${relationship.id}" has mismatched composite attribute counts.`)
    }
    return byId
}

function cardinalitySize(cardinality: EntityRelationshipCardinality, scale: number) {
    const many = cardinality.endsWith('many'), optional = cardinality.startsWith('zero')
    return { length: ((optional ? many ? 25 : 19 : many ? 20 : 12) + 0.75) * scale, halfWidth: ((many ? 6 : 5) + 0.75) * scale }
}

function cardinalityBounds(cardinality: EntityRelationshipCardinality, point: RoutingPoint, toward: RoutingPoint, scale: number) {
    const size = cardinalitySize(cardinality, scale)
    const horizontal = point.y === toward.y
    const end = { x: point.x + Math.sign(toward.x - point.x) * size.length, y: point.y + Math.sign(toward.y - point.y) * size.length }
    return {
        left: Math.min(point.x, end.x) - (horizontal ? 0.75 * scale : size.halfWidth),
        right: Math.max(point.x, end.x) + (horizontal ? 0.75 * scale : size.halfWidth),
        top: Math.min(point.y, end.y) - (horizontal ? size.halfWidth : 0.75 * scale),
        bottom: Math.max(point.y, end.y) + (horizontal ? size.halfWidth : 0.75 * scale),
    }
}

function cardinalityGlyph(cardinality: EntityRelationshipCardinality, point: RoutingPoint, toward: RoutingPoint, color: string, background: string, scale: number, key: string): React.ReactElement {
    const length = Math.hypot(toward.x - point.x, toward.y - point.y)
    const ux = (toward.x - point.x) / length, uy = (toward.y - point.y) / length
    const at = (along: number, across = 0) => ({ x: point.x + (ux * along - uy * across) * scale, y: point.y + (uy * along + ux * across) * scale })
    const bar = (along: number) => {
        const a = at(along, -5), b = at(along, 5)
        return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
    }
    const many = cardinality.endsWith('many')
    const optional = cardinality.startsWith('zero')
    const middle = at(13), top = at(0, -6), bottom = at(0, 6)
    const path = many ? `M ${top.x} ${top.y} L ${middle.x} ${middle.y} L ${bottom.x} ${bottom.y} M ${point.x} ${point.y} L ${middle.x} ${middle.y}` : bar(5)
    const circle = at(many ? 21 : 15)
    return React.createElement('g', { key, 'data-er-cardinality': cardinality },
        React.createElement('path', { d: `${path}${optional ? '' : ` ${bar(many ? 20 : 12)}`}`, fill: 'none', stroke: color, strokeWidth: 1.5 * scale }),
        optional && React.createElement('circle', { cx: circle.x, cy: circle.y, r: 4 * scale, fill: background, stroke: color, strokeWidth: 1.5 * scale }),
    )
}

/** Typed relational schemas with attribute tables, composite keys, and crow-foot multiplicity. */
export function EntityRelationshipDiagram({
    c: baseTheme, entities, relationships = [], title, description, id, direction = 'LR', width, height,
    entityWidth, fontSize, padding: paddingProp, gap: gapProp, showLegend = true, density,
}: EntityRelationshipDiagramProps): React.ReactElement {
    const c = density === undefined ? baseTheme : withDensity(baseTheme, density)
    const d = densityOf(c)
    const visibleTitle = title?.trim()
    const svgTitle = visibleTitle || 'Entity relationship diagram'
    const textSize = fontSize ?? d.type.small
    const headerSize = Math.max(textSize, d.type.label)
    const padding = paddingProp ?? d.s(32)
    const gap = gapProp ?? d.s(100)
    positive(textSize, 'fontSize'); positive(padding, 'padding', true); positive(gap, 'gap')
    if (width !== undefined) positive(width, 'width')
    if (height !== undefined) positive(height, 'height')
    if (entityWidth !== undefined) positive(entityWidth, 'entityWidth')
    if (id !== undefined) requiredText(id, 'id')
    if (!['LR', 'RL', 'TB', 'BT'].includes(direction)) throw new Error('EntityRelationshipDiagram direction must be LR, RL, TB, or BT.')
    const byId = validate(entities, relationships)
    const lineScale = Math.max(0.8, textSize / 12)
    const markerSizes = relationships.flatMap((relationship) => [cardinalitySize(relationship.from.cardinality, lineScale), cardinalitySize(relationship.to.cardinality, lineScale)])
    const markerLength = Math.max(0, ...markerSizes.map((size) => size.length))
    const markerPitch = Math.max(0, ...markerSizes.map((size) => size.halfWidth * 2)) + Math.max(d.s(4), lineScale * 1.5)
    const baseClearance = Math.max(28, d.s(28))
    const routingClearance = Math.max(baseClearance, markerLength + d.s(4) + Math.max(2, d.s(2)))
    const enlargedMarkers = routingClearance > baseClearance
    const bodyPadding = enlargedMarkers && relationships.some((relationship) => relationship.from.entity === relationship.to.entity)
        ? Math.max(padding, routingClearance + d.s(4)) : padding
    const anchorRow = (endpoint: EntityRelationshipEndpoint) => {
        const entity = byId.get(endpoint.entity)!, names = endpointAttributes(endpoint)
        return names.length ? Math.round(names.reduce((sum, name) => sum + entity.attributes.findIndex((attribute) => attribute.name === name), 0) / names.length) : Math.floor(Math.max(0, entity.attributes.length - 1) / 2)
    }
    const rowEndpointCounts = new Map(entities.map((entity) => [entity.id, new Map<number, number>()]))
    const entityEndpointCounts = new Map<string, number>()
    for (const relationship of relationships) for (const endpoint of [relationship.from, relationship.to]) {
        const counts = rowEndpointCounts.get(endpoint.entity)!, row = anchorRow(endpoint)
        counts.set(row, (counts.get(row) ?? 0) + 1)
        entityEndpointCounts.set(endpoint.entity, (entityEndpointCounts.get(endpoint.entity) ?? 0) + 1)
    }
    const rowHeight = Math.ceil(Math.max(d.s(25), textSize * 1.7))
    const headerHeight = Math.ceil(Math.max(d.s(35), headerSize * 2))
    const inset = d.s(12)
    const keyWidth = Math.ceil(estimateTextWidth('PK FK UQ', textSize, { mono: true })) + inset
    const titleHeight = visibleTitle ? Math.ceil(d.type.heading * 1.5 + d.s(12)) : 0
    const legendHeight = showLegend ? Math.ceil(textSize * 3.2 + d.s(12)) : 0
    const legendWidth = showLegend ? Math.max(480, ...legendLines.map((line) => estimateTextWidth(line, textSize) + padding * 2)) : 0
    const labelPadding = relationships.some((relationship) => relationship.label) ? Math.ceil(textSize * 2 + d.s(8)) : 0
    const graph = new dagre.graphlib.Graph({ multigraph: true })
        .setGraph({ rankdir: direction,
            nodesep: enlargedMarkers ? Math.max(gap * 0.75, routingClearance * 2 + markerPitch) : gap * 0.75,
            ranksep: Math.max(gap, 74, routingClearance * 2 + markerPitch), edgesep: d.s(26), marginx: 0, marginy: 0 })
        .setDefaultEdgeLabel(() => ({}))
    const measures = new Map(entities.map((entity) => {
        const nameWidth = Math.max(30, ...entity.attributes.map((attribute) => estimateTextWidth(attribute.name, textSize, { mono: true })))
        const typeWidth = Math.max(24, ...entity.attributes.map((attribute) => estimateTextWidth(attribute.type + (attribute.nullable ? '?' : ''), textSize, { mono: true })))
        const rowHeights = Array.from({ length: Math.max(1, entity.attributes.length) }, (_, index) => Math.max(rowHeight, Math.ceil((rowEndpointCounts.get(entity.id)!.get(index) ?? 0) * markerPitch)))
        let rowY = headerHeight
        const rowCenters = rowHeights.map((height) => { const center = rowY + height / 2; rowY += height; return center })
        const measured = {
            width: Math.ceil(Math.max(entityWidth ?? d.s(210), estimateTextWidth(entity.label ?? entity.id, headerSize, { weight: 600 }) + inset * 2, keyWidth + nameWidth + typeWidth + inset * 4,
                direction === 'TB' || direction === 'BT' ? markerPitch * ((entityEndpointCounts.get(entity.id) ?? 0) + 1) : 0)),
            height: rowY, rowHeights, rowCenters,
            typeWidth: Math.ceil(typeWidth),
        }
        graph.setNode(entity.id, { width: measured.width, height: measured.height })
        return [entity.id, measured] as const
    }))
    for (const relationship of relationships) graph.setEdge(relationship.from.entity, relationship.to.entity, {
        width: relationship.label ? estimateTextWidth(relationship.label, textSize) + d.s(64) : 0,
        height: relationship.label ? textSize * 2 : 0,
        labelpos: 'c',
    }, relationship.id)
    dagre.layout(graph)
    const graphWidth = graph.graph().width ?? 0, graphHeight = graph.graph().height ?? 0
    const minWidth = Math.ceil(Math.max(graphWidth + (bodyPadding + labelPadding) * 2, legendWidth, visibleTitle ? estimateTextWidth(visibleTitle, d.type.heading, { weight: 600 }) + padding * 2 : 0))
    const minHeight = Math.ceil(graphHeight + (bodyPadding + labelPadding) * 2 + titleHeight + legendHeight)
    if (width !== undefined && width < minWidth) throw new RangeError(`EntityRelationshipDiagram width needs at least ${minWidth}px to keep entity text readable.`)
    if (height !== undefined && height < minHeight) throw new RangeError(`EntityRelationshipDiagram height needs at least ${minHeight}px to keep entity text readable.`)
    const resolvedWidth = width ?? minWidth, resolvedHeight = height ?? minHeight
    const offsetX = (resolvedWidth - graphWidth) / 2
    const offsetY = bodyPadding + titleHeight + labelPadding + (resolvedHeight - minHeight) / 2
    const nodes: RoutingNode[] = entities.map((entity) => {
        const node = graph.node(entity.id), measure = measures.get(entity.id)!
        return { id: entity.id, cx: node.x + offsetX, cy: node.y + offsetY, width: measure.width, height: measure.height, ports: [] }
    })
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const portRequests: Array<{ node: RoutingNode; id: string; side: GraphPortSide; desired: number }> = []
    const endpointPort = (endpoint: EntityRelationshipEndpoint, other: EntityRelationshipEndpoint, port: string) => {
        const node = nodeById.get(endpoint.entity)!, target = nodeById.get(other.entity)!
        const horizontal = direction === 'LR' || direction === 'RL'
        const side: GraphPortSide = node === target ? 'right' : horizontal ? target.cx >= node.cx ? 'right' : 'left' : target.cy >= node.cy ? 'bottom' : 'top'
        const desired = side === 'top' || side === 'bottom' ? node.width / 2 : measures.get(node.id)!.rowCenters[anchorRow(endpoint)]
        portRequests.push({ node, id: port, side, desired })
    }
    const edges = relationships.map((relationship, index) => {
        const fromPort = `from-${index}`, toPort = `to-${index}`
        endpointPort(relationship.from, relationship.to, fromPort)
        endpointPort(relationship.to, relationship.from, toPort)
        return { from: relationship.from.entity, to: relationship.to.entity, fromPort, toPort }
    })
    for (const node of nodes) for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        const requests = portRequests.filter((request) => request.node === node && request.side === side).sort((a, b) => a.desired - b.desired)
        const extent = side === 'left' || side === 'right' ? node.height : node.width
        const positions: number[] = []
        for (let start = 0; start < requests.length;) {
            let end = start + 1
            while (end < requests.length && requests[end].desired === requests[start].desired) end++
            for (let index = start; index < end; index++) positions[index] = requests[index].desired + (index - start - (end - start - 1) / 2) * markerPitch
            start = end
        }
        for (let index = 0; index < positions.length; index++) positions[index] = Math.max(positions[index], index ? positions[index - 1] + markerPitch : markerPitch / 2)
        for (let index = positions.length - 1; index >= 0; index--) positions[index] = Math.min(positions[index], index === positions.length - 1 ? extent - markerPitch / 2 : positions[index + 1] - markerPitch)
        requests.forEach((request, index) => node.ports!.push({ id: request.id, side, offset: positions[index] / extent }))
    }
    const routed = routeOrthogonalGraph(nodes, edges, resolvedWidth, resolvedHeight - legendHeight, routingClearance, Math.max(d.s(18), markerPitch))
    if (routed.failures.length) throw new Error(`EntityRelationshipDiagram could not route relationship "${relationships[routed.failures[0].index].id}": ${routed.failures[0].reason}`)
    const relationshipText = (relationship: EntityRelationship) => `${endpointDescription(relationship.from, byId)} (${cardinalityWords[relationship.from.cardinality]}) to ${endpointDescription(relationship.to, byId)} (${cardinalityWords[relationship.to.cardinality]})${relationship.label ? `: ${relationship.label}` : ''}${relationship.identifying ? ', identifying relationship' : ', non-identifying relationship'}.`
    const schemaSummary = `${entities.length} entities and ${relationships.length} relationships. ${entities.map((entity) => `${entity.label ?? entity.id}: ${entity.attributes.map(attributeDescription).join('; ') || 'no attributes shown'}.`).join(' ')} ${relationships.map(relationshipText).join(' ')}`
    const lineColor = c.textSecondary
    const labels: React.ReactElement[] = []
    const placedLabels: Array<{ left: number; top: number; right: number; bottom: number }> = []
    const markerBoxes = relationships.flatMap((relationship, index) => {
        const points = routed.routes.get(index)!
        return [cardinalityBounds(relationship.from.cardinality, points[0], points[1], lineScale), cardinalityBounds(relationship.to.cardinality, points.at(-1)!, points.at(-2)!, lineScale)]
    })
    const occupied = nodes.map((node) => ({ left: node.cx - node.width / 2 - 3, right: node.cx + node.width / 2 + 3, top: node.cy - node.height / 2 - 3, bottom: node.cy + node.height / 2 + 3 }))
    const paths = relationships.flatMap((relationship, index) => {
        const points = routed.routes.get(index)!
        const path = roundedPolylinePath(points, d.s(4)).d
        if (relationship.label) {
            const segments = points.slice(1).map((point, at) => ({ a: points[at], b: point, length: Math.hypot(point.x - points[at].x, point.y - points[at].y) }))
            const labelWidth = Math.ceil(estimateTextWidth(relationship.label, textSize)) + d.s(10)
            const labelHeight = Math.ceil(textSize * 1.4) + 4
            const candidates = segments.sort((a, b) => b.length - a.length).flatMap((segment) => {
                return [0.5, 0.25, 0.75].flatMap((fraction) => [1, 2, 3].flatMap((distance) => [-1, 1].map((side) => {
                    const x = segment.a.x + (segment.b.x - segment.a.x) * fraction
                    const y = segment.a.y + (segment.b.y - segment.a.y) * fraction
                    const horizontal = segment.a.y === segment.b.y
                    const cx = x + (horizontal ? 0 : side * (labelWidth / 2 + d.s(6)) * distance)
                    const cy = y + (horizontal ? side * (labelHeight / 2 + d.s(6)) * distance : 0)
                    return { left: cx - labelWidth / 2, right: cx + labelWidth / 2, top: cy - labelHeight / 2, bottom: cy + labelHeight / 2 }
                })))
            })
            const label = candidates.find((box) => box.left >= 0 && box.right <= resolvedWidth && box.top >= padding + titleHeight && box.bottom <= resolvedHeight - padding - legendHeight
                && ![...occupied, ...markerBoxes, ...placedLabels].some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)
                && ![...routed.routes.values()].some((route) => samplesHitBox(route, box)))
            if (!label) throw new Error(`EntityRelationshipDiagram could not place label for relationship "${relationship.id}" without covering the schema. Increase gap or canvas size.`)
            placedLabels.push(label)
            labels.push(React.createElement('div', { key: `label-${relationship.id}`, style: {
                position: 'absolute', left: label.left, top: label.top, width: labelWidth, height: labelHeight,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: c.bg, color: c.textSecondary, fontSize: textSize, fontFamily: c.fontSans, whiteSpace: 'nowrap',
            } }, relationship.label))
        }
        return [React.createElement('path', {
            key: `path-${relationship.id}`, d: path, fill: 'none', stroke: lineColor, strokeWidth: d.w(1.5),
            strokeDasharray: relationship.identifying ? undefined : `${d.s(5)} ${d.s(4)}`,
            'data-vizmatic-graph-edge-id': encodeURIComponent(relationship.id),
            'data-vizmatic-graph-edge-from': encodeURIComponent(relationship.from.entity),
            'data-vizmatic-graph-edge-to': encodeURIComponent(relationship.to.entity),
            'data-vizmatic-graph-edge-label': encodeURIComponent(relationship.label ?? ''),
            'data-vizmatic-graph-edge-title': encodeURIComponent(relationshipText(relationship)),
        }), cardinalityGlyph(relationship.from.cardinality, points[0], points[1], lineColor, c.bg, lineScale, `from-${relationship.id}`),
        cardinalityGlyph(relationship.to.cardinality, points.at(-1)!, points.at(-2)!, lineColor, c.bg, lineScale, `to-${relationship.id}`)]
    })
    return React.createElement('div', {
        role: 'img', 'aria-label': svgTitle,
        'data-vizmatic-svg-id': id, 'data-vizmatic-svg-title': svgTitle,
        'data-vizmatic-svg-description': [description, schemaSummary].filter(Boolean).join(' '),
        style: { display: 'flex', position: 'relative', flexShrink: 0, width: resolvedWidth, height: resolvedHeight },
    },
    visibleTitle && React.createElement('div', { style: { position: 'absolute', left: padding, top: padding, fontFamily: c.fontSans, fontSize: d.type.heading, fontWeight: 600, color: c.textPrimary } }, visibleTitle),
    React.createElement('svg', { width: resolvedWidth, height: resolvedHeight, viewBox: `0 0 ${resolvedWidth} ${resolvedHeight}`, style: { position: 'absolute', left: 0, top: 0 } }, ...paths),
    ...labels,
    ...entities.map((entity) => {
        const node = nodeById.get(entity.id)!, measure = measures.get(entity.id)!
        const keyColor = getReadableToneColor(entity.tone ?? 'blue', c, c.bgCard, c.bgCard)
        return React.createElement('div', {
            key: entity.id, 'data-vizmatic-graph-node-id': entity.id, 'data-vizmatic-graph-node-label': entity.label ?? entity.id,
            'data-vizmatic-graph-node-detail': entity.attributes.map(attributeDescription).join('; '),
            style: { position: 'absolute', left: node.cx - node.width / 2, top: node.cy - node.height / 2, display: 'flex', flexDirection: 'column',
                width: node.width, height: node.height, border: `1px solid ${c.borderLight}`, borderRadius: d.r(4), backgroundColor: c.bgCard, overflow: 'hidden' },
        }, React.createElement('div', { style: { display: 'flex', alignItems: 'center', height: headerHeight, flexShrink: 0, padding: `0 ${inset}px`, fontFamily: c.fontSans,
            fontSize: headerSize, fontWeight: 600, color: keyColor, backgroundColor: c.bgCardAlt, borderBottom: `1px solid ${c.borderLight}` } }, entity.label ?? entity.id),
        ...entity.attributes.map((attribute, index) => React.createElement('div', { key: attribute.name, style: {
            display: 'flex', alignItems: 'center', height: measure.rowHeights[index], flexShrink: 0, padding: `0 ${inset}px`, gap: inset,
            fontFamily: c.fontMono, fontSize: textSize, color: c.textPrimary,
        } }, React.createElement('span', { style: { width: keyWidth - inset, flexShrink: 0, color: keyColor } }, [attribute.primaryKey && 'PK', attribute.foreignKey && 'FK', attribute.unique && 'UQ'].filter(Boolean).join(' ')),
        React.createElement('span', { style: { flexGrow: 1, whiteSpace: 'nowrap' } }, attribute.name),
        React.createElement('span', { style: { width: measure.typeWidth, flexShrink: 0, textAlign: 'right', color: c.textSecondary } }, attribute.type + (attribute.nullable ? '?' : '')))),
        !entity.attributes.length && React.createElement('div', { style: { display: 'flex', alignItems: 'center', padding: `0 ${inset}px`, height: measure.rowHeights[0], fontSize: textSize, color: c.textSecondary, fontFamily: c.fontSans } }, 'No attributes shown'))
    }),
    showLegend && React.createElement('div', { style: { position: 'absolute', left: padding, right: padding, bottom: padding, display: 'flex', flexDirection: 'column', gap: d.s(5), fontSize: textSize, lineHeight: 1.3, fontFamily: c.fontSans, color: c.textSecondary } },
        ...legendLines.map((line) => React.createElement('div', { key: line, style: { display: 'flex', whiteSpace: 'nowrap', flexShrink: 0 } }, line))),
    )
}

Object.defineProperty(EntityRelationshipDiagram, SVG_ACCESSIBILITY_COMPONENT, { value: true })
