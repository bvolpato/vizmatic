import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import type { SatoriNode } from './satori'

export const SVG_ACCESSIBILITY_COMPONENT = Symbol.for('vizmatic.svgAccessibilityComponent')

interface AccessibleNode {
    id: string
    label: string
    detail: string
    title: string
    href?: string
}

interface AccessibleEdge {
    id: string
    from: string
    to: string
    label: string
    title: string
    path: string
    href?: string
}

interface AccessibleGraph {
    index: number
    token: string
    detectionKey: string
    title: string
    description: string
    nodes: AccessibleNode[]
    edges: AccessibleEdge[]
}

export interface PreparedAccessibleSvg {
    element: ReactNode
    graphs: AccessibleGraph[]
}

function componentHasSvgMetadata(type: unknown): type is (props: Record<string, unknown>) => ReactNode {
    return typeof type === 'function'
        && (type as { [SVG_ACCESSIBILITY_COMPONENT]?: boolean })[SVG_ACCESSIBILITY_COMPONENT] === true
}

function svgToken(value: string): string {
    if (value.length === 0) return 'empty'
    return Array.from(value, (character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return /^[A-Za-z0-9.-]$/.test(character)
            ? character
            : `_u${codePoint.toString(16)}_`
    }).join('')
}

function textProperty(props: Record<string, unknown>, name: string): string {
    const value = props[name]
    return typeof value === 'string' ? value : ''
}

function encodedTextProperty(props: Record<string, unknown>, name: string): string {
    const value = textProperty(props, name)
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

/** Resolve GraphDiagram JSX elements so renderer metadata survives Satori's SVG flattening. */
export function prepareAccessibleSvg(element: ReactNode): PreparedAccessibleSvg {
    const graphs: AccessibleGraph[] = []
    const explicitIds = new Set<string>()

    const visit = (node: ReactNode, graph?: AccessibleGraph): ReactNode => {
        if (Array.isArray(node)) return node.map((child) => visit(child, graph))
        if (!isValidElement(node)) return node

        const component = node.type
        if (componentHasSvgMetadata(component)) {
            return visit(component(node.props as Record<string, unknown>), graph)
        }

        const props = node.props as Record<string, unknown>
        const title = textProperty(props, 'data-vizmatic-svg-title')
        const isGraphRoot = title.length > 0
        let activeGraph = graph
        let elementKey = node.key

        if (isGraphRoot) {
            const explicitId = textProperty(props, 'data-vizmatic-svg-id')
            if (explicitId) {
                if (explicitIds.has(explicitId)) {
                    throw new Error(`GraphDiagram SVG id "${explicitId}" must be unique in one exported SVG.`)
                }
                explicitIds.add(explicitId)
            }
            const index = graphs.length
            const token = explicitId ? `id-${svgToken(explicitId)}` : `index-${index}`
            activeGraph = {
                index,
                token,
                detectionKey: `vizmatic-graph-${index}`,
                title,
                description: textProperty(props, 'data-vizmatic-svg-description'),
                nodes: [],
                edges: [],
            }
            graphs.push(activeGraph)
            elementKey = activeGraph.detectionKey
        }

        let nextProps: Record<string, unknown>
        if (activeGraph && Object.hasOwn(props, 'data-vizmatic-graph-node-id')) {
            const id = textProperty(props, 'data-vizmatic-graph-node-id')
            const label = textProperty(props, 'data-vizmatic-graph-node-label') || id
            const detail = textProperty(props, 'data-vizmatic-graph-node-detail')
            activeGraph.nodes.push({
                id,
                label,
                detail,
                title: textProperty(props, 'data-vizmatic-graph-node-title') || label,
                href: textProperty(props, 'data-vizmatic-graph-node-href') || undefined,
            })
            elementKey = `${activeGraph.detectionKey}-node-${svgToken(id)}`
        } else if (activeGraph && textProperty(props, 'data-vizmatic-graph-edge-id')) {
            const id = encodedTextProperty(props, 'data-vizmatic-graph-edge-id')
            activeGraph.edges.push({
                id,
                from: encodedTextProperty(props, 'data-vizmatic-graph-edge-from'),
                to: encodedTextProperty(props, 'data-vizmatic-graph-edge-to'),
                label: encodedTextProperty(props, 'data-vizmatic-graph-edge-label'),
                title: encodedTextProperty(props, 'data-vizmatic-graph-edge-title'),
                path: textProperty(props, 'd'),
                href: encodedTextProperty(props, 'data-vizmatic-graph-edge-href') || undefined,
            })
            elementKey = `${activeGraph.detectionKey}-edge-${svgToken(id)}`
        }

        const children = props.children as ReactNode
        if (children === undefined) {
            if (isGraphRoot) {
                nextProps = { ...props, 'data-vizmatic-svg-instance': activeGraph?.token }
                return cloneElement(node as ReactElement<Record<string, unknown>>, { ...nextProps, key: elementKey })
            }
            return node
        }

        const preparedChildren = visit(children, activeGraph)
        nextProps = isGraphRoot
            ? { ...props, 'data-vizmatic-svg-instance': activeGraph?.token }
            : { ...props }
        return cloneElement(
            node as ReactElement<Record<string, unknown>>,
            { ...nextProps, key: elementKey },
            preparedChildren,
        )
    }

    return { element: visit(element), graphs }
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

function attribute(name: string, value: string): string {
    return `${name}="${escapeXml(value)}"`
}

function graphBaseId(graph: AccessibleGraph): string {
    return `vizmatic-graph-${graph.token}`
}

function nodeId(graph: AccessibleGraph, node: AccessibleNode): string {
    return `${graphBaseId(graph)}-node-${svgToken(node.id)}`
}

function edgeId(graph: AccessibleGraph, edge: AccessibleEdge): string {
    return `${graphBaseId(graph)}-edge-${svgToken(edge.id)}`
}

function labelForEdge(graph: AccessibleGraph, edge: AccessibleEdge): string {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node.label]))
    const from = nodes.get(edge.from) ?? edge.from
    const to = nodes.get(edge.to) ?? edge.to
    return edge.title || (edge.label ? `${from} to ${to}: ${edge.label}` : `${from} to ${to}`)
}

function descriptionForEdge(graph: AccessibleGraph, edge: AccessibleEdge): string {
    const nodes = new Map(graph.nodes.map((node) => [node.id, node.label]))
    const from = nodes.get(edge.from) ?? edge.from
    const to = nodes.get(edge.to) ?? edge.to
    return `Relationship from ${from} to ${to}${edge.label ? `, labeled ${edge.label}` : ''}.`
}

function nodeGroup(
    graph: AccessibleGraph,
    node: AccessibleNode,
    layout: SatoriNode | undefined,
): string {
    const id = nodeId(graph, node)
    const label = node.detail ? `${node.label}: ${node.detail}` : node.label
    const description = node.detail || node.label
    const titleId = `${id}-title`
    const descriptionId = `${id}-description`
    const accessible = `<g ${attribute('id', id)} role="group" aria-labelledby="${titleId}" aria-describedby="${descriptionId}"><title id="${titleId}">${escapeXml(node.title || node.label)}</title><desc id="${descriptionId}">${escapeXml(description)}</desc>`
    if (!layout) return `${accessible}</g>`

    const rect = `<rect x="${layout.left}" y="${layout.top}" width="${layout.width}" height="${layout.height}" fill="transparent" pointer-events="all"/>`
    const hitTarget = node.href
        ? `<a ${attribute('href', node.href)} role="link" tabindex="0" ${attribute('aria-label', label)}>${rect}</a>`
        : rect
    return `${accessible}${hitTarget}</g>`
}

function edgeGroup(
    graph: AccessibleGraph,
    edge: AccessibleEdge,
    root: SatoriNode | undefined,
): string {
    const id = edgeId(graph, edge)
    const title = labelForEdge(graph, edge)
    const titleId = `${id}-title`
    const descriptionId = `${id}-description`
    const accessible = `<g ${attribute('id', id)} role="group" aria-labelledby="${titleId}" aria-describedby="${descriptionId}"><title id="${titleId}">${escapeXml(title)}</title><desc id="${descriptionId}">${escapeXml(descriptionForEdge(graph, edge))}</desc>`
    if (!root || !edge.path) return `${accessible}</g>`

    const path = `<path d="${escapeXml(edge.path)}" transform="translate(${root.left} ${root.top})" fill="none" stroke="transparent" stroke-width="14" stroke-linecap="round" pointer-events="stroke"/>`
    const hitTarget = edge.href
        ? `<a ${attribute('href', edge.href)} role="link" tabindex="0" ${attribute('aria-label', title)}>${path}</a>`
        : path
    return `${accessible}${hitTarget}</g>`
}

/** Add document semantics and accessible hit targets to the SVG Satori actually emitted. */
export function addSvgAccessibility(
    svg: string,
    graphs: AccessibleGraph[],
    layoutNodes: SatoriNode[],
): string {
    if (graphs.length === 0) return svg

    const title = graphs.map((graph) => graph.title).join('. ')
    const description = graphs.map((graph) => `${graph.title}. ${graph.description}`).join(' ')
    const hasLinks = graphs.some((graph) =>
        graph.nodes.some((node) => node.href) || graph.edges.some((edge) => edge.href),
    )
    const rootTitleId = 'vizmatic-svg-title'
    const rootDescriptionId = 'vizmatic-svg-description'
    const groupMarkup = graphs.map((graph) => {
        const baseId = graphBaseId(graph)
        const titleId = `${baseId}-title`
        const descriptionId = `${baseId}-description`
        const root = layoutNodes.find((node) => node.key === graph.detectionKey)
        const nodes = graph.nodes.map((item) => {
            const layout = layoutNodes.find((node) => node.key === `${graph.detectionKey}-node-${svgToken(item.id)}`)
            if (item.href && !layout) {
                throw new Error(`Could not resolve GraphDiagram node "${item.id}" bounds for SVG link export.`)
            }
            return nodeGroup(graph, item, layout)
        }).join('')
        const edges = graph.edges.map((item) => {
            if (item.href && !root) {
                throw new Error(`Could not resolve GraphDiagram bounds for SVG edge link export: "${item.id}".`)
            }
            return edgeGroup(graph, item, root)
        }).join('')
        return `<g ${attribute('id', baseId)} role="group" aria-labelledby="${titleId}" aria-describedby="${descriptionId}"><title id="${titleId}">${escapeXml(graph.title)}</title><desc id="${descriptionId}">${escapeXml(graph.description)}</desc>${nodes}${edges}</g>`
    }).join('')

    const metadata = `<title id="${rootTitleId}">${escapeXml(title)}</title><desc id="${rootDescriptionId}">${escapeXml(description)}</desc>`
    return svg.replace(/^<svg\b([^>]*)>/, (_match, attrs: string) =>
        `<svg${attrs} role="${hasLinks ? 'group' : 'img'}" aria-labelledby="${rootTitleId}" aria-describedby="${rootDescriptionId}">${metadata}`,
    ).replace(/<\/svg>\s*$/, `${groupMarkup}</svg>`)
}
