import { Children, isValidElement, type ReactNode } from 'react'
import {
    compositeRgba,
    contrastRatioLuminance,
    parseCssRgba,
    relativeLuminanceRgb,
    type RgbaColor,
} from './color-utils'
import type { SatoriNode } from './satori'
import type { ThemeMode } from './theme'
import type { CropRegion } from './autocrop'

export const VIZMATIC_PRIMITIVE_SYMBOL = Symbol.for('vizmatic.primitive')
export const VIZMATIC_SVG_SHAPE_SYMBOL = Symbol.for('vizmatic.svgShape')
export const VIZMATIC_SVG_CHILDREN_SYMBOL = Symbol.for('vizmatic.svgChildren')

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

/** Stable identifiers emitted by the visual checker. Add codes without changing existing meanings. */
export const CHECK_DIAGNOSTIC_CODES = [
    'accessibility.low_contrast',
    'api.unsupported_prop',
    'asset.warning',
    'frame.load_error',
    'frame.unknown_preset',
    'layout.auto_size',
    'layout.connector_congestion',
    'layout.connector_unroutable',
    'layout.overflow',
    'layout.text_overlap',
    'layout.text_overflow',
    'layout.whitespace_imbalance',
    'readability.small_text',
    'render.error',
    'render.svg_context',
    'render.warning',
    'style.unsupported',
] as const

export type CheckDiagnosticCode = typeof CHECK_DIAGNOSTIC_CODES[number]

export interface CheckDiagnosticLocation {
    /** React element path for diagnostics collected before layout. */
    path?: string
    /** Rendered logical-pixel bounds when layout data is available. */
    x?: number
    y?: number
    width?: number
    height?: number
}

export interface CheckDiagnostic {
    code: CheckDiagnosticCode
    severity: DiagnosticSeverity
    message: string
    theme?: ThemeMode
    elementId?: string
    relatedElementIds?: string[]
    location?: CheckDiagnosticLocation
    edges?: Array<'top' | 'right' | 'bottom' | 'left'>
    suggestion?: string
    suggestedDimensions?: {
        width: number
        height: number
    }
}

interface ContrastContext {
    background?: RgbaColor
    color?: RgbaColor
    fontSize?: number
    fontWeight?: number
}

const MAX_CONTRAST_NODES = 5_000
const MAX_DIAGNOSTICS_PER_RULE = 12
// Dense figures set small type near 9 to 11 px and render it at 2x, where it stays legible.
// Charts fitted into smaller boxes can land a little under that, so the floor sits at 8.5.
const MIN_TEXT_SIZE = 8.5
const SVG_ONLY_ELEMENTS = new Set([
    'circle', 'clipPath', 'defs', 'ellipse', 'foreignObject', 'g', 'image',
    'line', 'linearGradient', 'marker', 'mask', 'path', 'pattern', 'polygon',
    'polyline', 'radialGradient', 'rect', 'stop', 'symbol', 'text', 'textPath', 'tspan', 'use',
])

export interface SvgContextComponents {
    shapes: ReadonlyMap<unknown, string>
    children: ReadonlyMap<unknown, 'html' | 'svg'>
}

function isUnresolvedColor(value: unknown): boolean {
    if (typeof value !== 'string' || value.trim() === '' || parseCssRgba(value)) return false
    return !['inherit', 'initial', 'revert', 'unset'].includes(value.trim().toLowerCase())
}

function contrastRatio(foreground: RgbaColor, background: RgbaColor): number {
    return contrastRatioLuminance(
        relativeLuminanceRgb(foreground.r, foreground.g, foreground.b),
        relativeLuminanceRgb(background.r, background.g, background.b),
    )
}

function numericFontWeight(value: unknown): number | undefined {
    if (typeof value === 'number') return value
    if (value === 'bold') return 700
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
    return undefined
}

function fontSizePixels(value: unknown, inherited: number | undefined): number | undefined {
    if (typeof value === 'number') return value
    if (typeof value !== 'string') return inherited
    const match = value.trim().match(/^(\d+(?:\.\d+)?|\.\d+)(px|pt|rem|em|%)?$/)
    if (!match?.[1]) return inherited

    const amount = Number(match[1])
    const unit = match[2] ?? 'px'
    if (unit === 'pt') return amount * 4 / 3
    if (unit === 'rem') return amount * 16
    if (unit === 'em') return amount * (inherited ?? 16)
    if (unit === '%') return amount / 100 * (inherited ?? 16)
    return amount
}

function requiredContrast(context: ContrastContext): number {
    const large = (context.fontSize ?? 16) >= 24
        || ((context.fontSize ?? 16) >= 18.66 && (context.fontWeight ?? 400) >= 700)
    return large ? 3 : 4.5
}

function styleRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

function hasDirectText(children: ReactNode): boolean {
    return Children.toArray(children).some((child) => typeof child === 'string' || typeof child === 'number')
}

function elementId(props: Record<string, unknown>): string | undefined {
    const value = props.id ?? props['data-vizmatic-id']
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function isTrustedPrimitive(component: unknown, trustedComponents: ReadonlySet<unknown>): boolean {
    if (trustedComponents.has(component)) return true
    if (typeof component !== 'function') return false
    const tagged = component as unknown as { __vizmaticPrimitive?: boolean } & Record<symbol, unknown>
    return Boolean(tagged.__vizmaticPrimitive || tagged[VIZMATIC_PRIMITIVE_SYMBOL])
}

function resolveFunctionComponent(node: ReactNode, trustedComponents: ReadonlySet<unknown>): ReactNode | undefined {
    if (!isValidElement(node) || typeof node.type !== 'function' || isTrustedPrimitive(node.type, trustedComponents)) return undefined
    const component = node.type as ((props: unknown) => ReactNode) & {
        prototype?: { isReactComponent?: boolean }
    }
    if (component.prototype?.isReactComponent) return undefined
    try {
        return component(node.props)
    } catch {
        return undefined
    }
}

export function analyzeContrast(
    element: ReactNode,
    theme: ThemeMode,
    trustedComponents: ReadonlySet<unknown> = new Set(),
    rootBackground?: string,
): CheckDiagnostic[] {
    return analyzeScene(element, theme, trustedComponents, rootBackground)
}

export function analyzeScene(
    element: ReactNode,
    theme: ThemeMode,
    trustedComponents: ReadonlySet<unknown>,
    rootBackground?: string,
    svgComponents?: SvgContextComponents,
): CheckDiagnostic[] {
    const diagnostics: CheckDiagnostic[] = []
    const seen = new Set<string>()
    let visited = 0

    function visit(node: ReactNode, inherited: ContrastContext, path: string, namespace: 'html' | 'svg' | undefined) {
        if (visited++ >= MAX_CONTRAST_NODES || !isValidElement(node)) return

        const resolved = resolveFunctionComponent(node, trustedComponents)
        if (resolved !== undefined) {
            visit(resolved, inherited, path, namespace)
            return
        }

        const props = node.props as Record<string, unknown>
        const taggedType = typeof node.type === 'function' ? node.type as unknown as Record<symbol, unknown> : undefined
        const svgShape = svgComponents?.shapes.get(node.type)
            ?? (svgComponents && typeof taggedType?.[VIZMATIC_SVG_SHAPE_SYMBOL] === 'string'
                ? taggedType[VIZMATIC_SVG_SHAPE_SYMBOL] as string
                : undefined)
            ?? (svgComponents && typeof node.type === 'string' && SVG_ONLY_ELEMENTS.has(node.type) ? `<${node.type}>` : undefined)
        if (namespace === 'html' && svgShape) {
            diagnostics.push({
                code: 'render.svg_context',
                severity: 'error',
                theme,
                message: `${svgShape} requires an <svg> ancestor at ${path}; its SVG geometry will not render in an HTML layout.`,
                suggestion: 'Place the element inside a native <svg> or an SVG container such as AxisPlot.',
                elementId: elementId(props),
                location: { path },
            })
        }
        // Opaque components may place children in a different namespace. Only
        // known contracts and resolved native elements establish that context.
        const taggedChildren = taggedType?.[VIZMATIC_SVG_CHILDREN_SYMBOL]
        const childNamespace = typeof node.type === 'string'
            ? node.type === 'svg' ? 'svg' : node.type === 'foreignObject' ? 'html' : namespace
            : typeof node.type === 'function'
                ? svgComponents?.children.get(node.type)
                    ?? (svgComponents && (taggedChildren === 'html' || taggedChildren === 'svg') ? taggedChildren : undefined)
                : namespace
        const style = typeof node.type === 'string' ? styleRecord(props.style) : {}
        const backgroundImage = typeof style.backgroundImage === 'string'
            ? style.backgroundImage.trim().toLowerCase()
            : ''
        const backgroundShorthand = typeof style.background === 'string' ? style.background.trim() : ''
        const isBackgroundWrapper = typeof node.type === 'function'
            && isTrustedPrimitive(node.type, trustedComponents)
        const wrapperBackground = isBackgroundWrapper ? props.background : undefined
        const hasUnresolvedBackground = (backgroundImage !== '' && backgroundImage !== 'none')
            || isUnresolvedColor(style.backgroundColor)
            || (backgroundShorthand !== '' && backgroundShorthand.toLowerCase() !== 'none' && !parseCssRgba(backgroundShorthand))
            || isUnresolvedColor(wrapperBackground)
        const ownBackground = parseCssRgba(style.backgroundColor)
            ?? parseCssRgba(style.background)
            ?? parseCssRgba(wrapperBackground)
        const baseBackground = path === 'root' && isBackgroundWrapper && parseCssRgba(wrapperBackground)
            ? undefined
            : inherited.background
        const background = hasUnresolvedBackground
            ? undefined
            : ownBackground
                ? compositeRgba(ownBackground, baseBackground)
                : baseBackground
        const color = typeof style.color === 'string' && style.color.trim().toLowerCase() === 'currentcolor'
            ? inherited.color
            : isUnresolvedColor(style.color)
                ? undefined
                : parseCssRgba(style.color) ?? inherited.color
        const fontSize = fontSizePixels(style.fontSize, inherited.fontSize)
        const fontWeight = numericFontWeight(style.fontWeight) ?? inherited.fontWeight
        const context = { background, color, fontSize, fontWeight }

        if (typeof node.type === 'string'
            && hasDirectText(props.children as ReactNode)
            && color
            && background !== undefined
            && background.alpha >= 1) {
            const renderedColor = compositeRgba(color, background)
            const ratio = contrastRatio(renderedColor, background)
            const required = requiredContrast(context)
            if (ratio < required) {
                const rounded = Math.round(ratio * 100) / 100
                const key = `${rounded}:${required}:${path}`
                if (!seen.has(key)) {
                    seen.add(key)
                    diagnostics.push({
                        code: 'accessibility.low_contrast',
                        severity: 'warning',
                        theme,
                        message: `Text contrast is ${rounded}:1 at ${path}; ${required}:1 is recommended.`,
                        suggestion: 'Use a stronger text or background color token.',
                        elementId: elementId(props),
                        location: { path },
                    })
                }
            }
        }

        Children.forEach(props.children as ReactNode, (child, index) => visit(child, context, `${path}.${index}`, childNamespace))
    }

    visit(element, { background: parseCssRgba(rootBackground) }, 'root', 'html')
    return diagnostics
}

interface TextLayoutNode {
    text: string
    elementId?: string
    left: number
    top: number
    width: number
    height: number
    paintLeft: number
    paintTop: number
    paintWidth: number
    paintHeight: number
    fontSize: number
}

interface LayoutContext {
    node: SatoriNode
    fontSize: number
    textAlign: string
}

function containsLayoutNode(parent: SatoriNode, child: SatoriNode): boolean {
    const epsilon = 0.5
    return child.left >= parent.left - epsilon
        && child.top >= parent.top - epsilon
        && child.left + child.width <= parent.left + parent.width + epsilon
        && child.top + child.height <= parent.top + parent.height + epsilon
}

function isWideCharacter(code: number): boolean {
    return (code >= 0x1100 && code <= 0x115f)
        || (code >= 0x2e80 && code <= 0xa4cf)
        || (code >= 0xac00 && code <= 0xd7a3)
        || (code >= 0xf900 && code <= 0xfaff)
        || (code >= 0xfe10 && code <= 0xfe6f)
        || (code >= 0xff00 && code <= 0xff60)
        || (code >= 0xffe0 && code <= 0xffe6)
        || code >= 0x1f000
}

function textUnits(text: string): number {
    return Array.from(text.normalize('NFC')).reduce((sum, character) =>
        sum + (isWideCharacter(character.codePointAt(0) ?? 0) ? 1.7 : 1), 0)
}

function renderedTextNodes(nodes: SatoriNode[]): TextLayoutNode[] {
    const textNodes: TextLayoutNode[] = []
    const ancestors: LayoutContext[] = []

    for (const node of nodes) {
        while (ancestors.length > 0 && !containsLayoutNode(ancestors[ancestors.length - 1].node, node)) {
            ancestors.pop()
        }

        const inherited = ancestors[ancestors.length - 1]
        const style = styleRecord(node.props.style)
        const fontSize = fontSizePixels(style.fontSize, inherited?.fontSize) ?? 16
        const textAlign = typeof style.textAlign === 'string' ? style.textAlign : (inherited?.textAlign ?? 'left')
        const text = String(node.textContent ?? '').trim()
        // Layout boxes ignore rotation, so a rotated axis title cannot be compared by its box.
        if (text && typeof style.transform === 'string' && style.transform.includes('rotate')) continue

        if (text && node.width > 0 && node.height > 0) {
            const estimatedLines = Math.max(1, Math.round(node.height / Math.max(fontSize * 1.5, 1)))
            const paintHeight = Math.min(
                node.height,
                fontSize * 0.9 + (estimatedLines - 1) * fontSize * 1.25,
            )
            const unwrappedWidth = textUnits(text) * fontSize * 0.56
            const paintWidth = Math.min(node.width, unwrappedWidth)
            const horizontalInset = textAlign === 'center'
                ? (node.width - paintWidth) / 2
                : textAlign === 'right' || textAlign === 'end'
                    ? node.width - paintWidth
                    : 0

            textNodes.push({
                text,
                elementId: elementId(node.props),
                left: node.left,
                top: node.top,
                width: node.width,
                height: node.height,
                paintLeft: node.left + horizontalInset,
                paintTop: node.top + (node.height - paintHeight) / 2,
                paintWidth,
                paintHeight,
                fontSize,
            })
        } else if (node.width > 0 && node.height > 0) {
            ancestors.push({ node, fontSize, textAlign })
        }
    }

    return textNodes
}

function textExcerpt(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim()
    return normalized.length > 40 ? `${normalized.slice(0, 37)}...` : normalized
}

function meaningfulOverlap(a: TextLayoutNode, b: TextLayoutNode): boolean {
    const width = Math.min(a.paintLeft + a.paintWidth, b.paintLeft + b.paintWidth) - Math.max(a.paintLeft, b.paintLeft)
    const height = Math.min(a.paintTop + a.paintHeight, b.paintTop + b.paintHeight) - Math.max(a.paintTop, b.paintTop)
    if (width < 2 || height < 2) return false
    if (a.text === b.text && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height) return false
    const overlapArea = width * height
    const smallerArea = Math.min(a.paintWidth * a.paintHeight, b.paintWidth * b.paintHeight)
    return overlapArea / smallerArea >= 0.08
}

function overlapCandidates(nodes: TextLayoutNode[]): Array<[TextLayoutNode, TextLayoutNode]> {
    const cellSize = 96
    const buckets = new Map<string, number[]>()
    const pairs: Array<[TextLayoutNode, TextLayoutNode]> = []

    for (let index = 0; index < nodes.length && pairs.length < MAX_DIAGNOSTICS_PER_RULE; index += 1) {
        const node = nodes[index]
        const minX = Math.floor(node.paintLeft / cellSize)
        const maxX = Math.floor((node.paintLeft + node.paintWidth) / cellSize)
        const minY = Math.floor(node.paintTop / cellSize)
        const maxY = Math.floor((node.paintTop + node.paintHeight) / cellSize)
        const candidates = new Set<number>()

        for (let x = minX; x <= maxX; x += 1) {
            for (let y = minY; y <= maxY; y += 1) {
                const bucket = buckets.get(`${x}:${y}`)
                bucket?.forEach((candidate) => candidates.add(candidate))
            }
        }

        for (const candidate of candidates) {
            if (meaningfulOverlap(nodes[candidate], node)) pairs.push([nodes[candidate], node])
            if (pairs.length >= MAX_DIAGNOSTICS_PER_RULE) break
        }

        for (let x = minX; x <= maxX; x += 1) {
            for (let y = minY; y <= maxY; y += 1) {
                const key = `${x}:${y}`
                const bucket = buckets.get(key) ?? []
                bucket.push(index)
                buckets.set(key, bucket)
            }
        }
    }

    return pairs
}

export function analyzeRenderedLayout(nodes: SatoriNode[], theme: ThemeMode): CheckDiagnostic[] {
    const diagnostics: CheckDiagnostic[] = []
    const textNodes = renderedTextNodes(nodes)

    const seenSmallText = new Set<string>()
    let smallTextCount = 0
    for (const node of textNodes) {
        if (node.fontSize >= MIN_TEXT_SIZE) continue
        const excerpt = textExcerpt(node.text)
        const key = `${excerpt}:${node.fontSize}`
        if (seenSmallText.has(key)) continue
        seenSmallText.add(key)
        diagnostics.push({
            code: 'readability.small_text',
            severity: 'warning',
            theme,
            message: `Text "${excerpt}" renders at ${node.fontSize}px.`,
            suggestion: `Use at least ${MIN_TEXT_SIZE}px for details that must remain readable when embedded.`,
            elementId: node.elementId,
            location: { x: node.left, y: node.top, width: node.width, height: node.height },
        })
        smallTextCount += 1
        if (smallTextCount >= MAX_DIAGNOSTICS_PER_RULE) break
    }

    for (const [left, right] of overlapCandidates(textNodes)) {
        diagnostics.push({
            code: 'layout.text_overlap',
            severity: 'warning',
            theme,
            message: `Text "${textExcerpt(left.text)}" overlaps "${textExcerpt(right.text)}".`,
            suggestion: 'Increase spacing or canvas size, shorten labels, or move one label.',
            elementId: left.elementId,
            relatedElementIds: right.elementId ? [right.elementId] : undefined,
            location: { x: left.left, y: left.top, width: left.width, height: left.height },
        })
    }

    for (const source of nodes.filter((node) => Number(node.props['data-vizmatic-unrouted-connectors']) > 0)) {
        const rawFailures = source.props['data-vizmatic-routing-failures']
        let messages: string[]
        try {
            const parsed = JSON.parse(String(rawFailures ?? '[]'))
            messages = Array.isArray(parsed) ? parsed.map(String) : [String(rawFailures ?? 'Connector could not be routed.')]
        } catch {
            messages = [String(rawFailures ?? 'Connector could not be routed.')]
        }
        for (const message of messages.slice(0, MAX_DIAGNOSTICS_PER_RULE)) diagnostics.push({
            code: 'layout.connector_unroutable',
            severity: 'error',
            theme,
            message,
            suggestion: 'Increase canvas size or spacing, reduce routingClearance, or choose a different endpoint side or port.',
            elementId: elementId(source.props),
            location: { x: source.left, y: source.top, width: source.width, height: source.height },
        })
    }
    const crossingSources = nodes.filter((node) =>
        Number(node.props['data-vizmatic-connector-crossings']) > Number(node.props['data-vizmatic-connector-crossing-budget'] ?? 0),
    )
    for (const source of crossingSources.slice(0, MAX_DIAGNOSTICS_PER_RULE)) {
        const connectorCrossings = Number(source.props['data-vizmatic-connector-crossings'])
        diagnostics.push({
            code: 'layout.connector_congestion',
            severity: 'warning',
            theme,
            message: `${connectorCrossings} connector crossing${connectorCrossings === 1 ? '' : 's'} detected.`,
            suggestion: 'Use automatic layout, change graph direction, or simplify the edge set.',
            elementId: elementId(source.props),
            location: { x: source.left, y: source.top, width: source.width, height: source.height },
        })
    }
    const labelCollisionSources = nodes.filter((node) => Number(node.props['data-vizmatic-connector-label-collisions']) > 0)
    for (const source of labelCollisionSources.slice(0, MAX_DIAGNOSTICS_PER_RULE)) {
        const labelCollisions = Number(source.props['data-vizmatic-connector-label-collisions'])
        diagnostics.push({
            code: 'layout.connector_congestion',
            severity: 'warning',
            theme,
            message: `${labelCollisions} connector label collision${labelCollisions === 1 ? '' : 's'} detected.`,
            suggestion: 'Change graph direction or spacing, shorten edge labels, or remove nonessential labels.',
            elementId: elementId(source.props),
            location: { x: source.left, y: source.top, width: source.width, height: source.height },
        })
    }
    for (const source of nodes.filter((node) => Number(node.props['data-vizmatic-connector-label-crossings']) > 0).slice(0, MAX_DIAGNOSTICS_PER_RULE)) {
        const crossedLabels = Number(source.props['data-vizmatic-connector-label-crossings'])
        diagnostics.push({
            code: 'layout.connector_congestion',
            severity: 'info',
            theme,
            message: `${crossedLabels} connector${crossedLabels === 1 ? ' passes' : 's pass'} behind a label or group title. The label masks it, but the line appears broken.`,
            suggestion: 'Shorten or move the label, change graph direction, or route the connector with routing="orthogonal".',
            elementId: elementId(source.props),
            location: { x: source.left, y: source.top, width: source.width, height: source.height },
        })
    }
    for (const source of nodes.filter((node) => Number(node.props['data-vizmatic-crowded-connector-endpoints']) > 0).slice(0, MAX_DIAGNOSTICS_PER_RULE)) {
        const crowdedEndpoints = Number(source.props['data-vizmatic-crowded-connector-endpoints'])
        diagnostics.push({
            code: 'layout.connector_congestion',
            severity: 'warning',
            theme,
            message: `${crowdedEndpoints} node${crowdedEndpoints === 1 ? '' : 's'} connect more than eight edges.`,
            suggestion: 'Group related branches, add an intermediate hub, or change graph direction.',
            elementId: elementId(source.props),
            location: { x: source.left, y: source.top, width: source.width, height: source.height },
        })
    }
    for (const source of nodes.filter((node) => Number(node.props['data-vizmatic-parallel-connector-groups']) > 0).slice(0, MAX_DIAGNOSTICS_PER_RULE)) {
        const parallelGroups = Number(source.props['data-vizmatic-parallel-connector-groups'])
        diagnostics.push({
            code: 'layout.connector_congestion',
            severity: 'warning',
            theme,
            message: `${parallelGroups} connector route${parallelGroups === 1 ? '' : 's'} contain parallel edges.`,
            suggestion: 'Merge duplicate relationships, label one combined edge, or separate the routes.',
            elementId: elementId(source.props),
            location: { x: source.left, y: source.top, width: source.width, height: source.height },
        })
    }

    // Text that spills out of a graph node's box.
    let overflowCount = 0
    const graphNodes = nodes.filter((node) => typeof node.props['data-vizmatic-graph-node-id'] === 'string')
    for (const box of graphNodes) {
        for (const text of nodes) {
            if (overflowCount >= MAX_DIAGNOSTICS_PER_RULE) break
            if (!String(text.textContent ?? '').trim() || text === box) continue
            const startsInside = text.left >= box.left - 1 && text.left < box.left + box.width && text.top >= box.top - 1 && text.top < box.top + box.height
            if (!startsInside) continue
            const spillsRight = text.left + text.width > box.left + box.width + 1
            const spillsDown = text.top + text.height > box.top + box.height + 1
            if (!spillsRight && !spillsDown) continue
            diagnostics.push({
                code: 'layout.text_overflow',
                severity: 'warning',
                theme,
                message: `Text "${textExcerpt(String(text.textContent))}" spills out of node "${String(box.props['data-vizmatic-graph-node-id'])}".`,
                suggestion: 'Omit the fixed node width and height so the node sizes to its content, or shorten the text.',
                elementId: elementId(box.props),
                location: { x: text.left, y: text.top, width: text.width, height: text.height },
            })
            overflowCount += 1
            break
        }
    }

    let whitespaceCount = 0
    for (const container of nodes.filter((node) => node.props['data-vizmatic-layout-container'] === 'panel')) {
        const contentNodes = nodes.filter((node) =>
            node.props['data-vizmatic-layout-content'] === 'panel'
            && node.width > 0
            && node.height > 0
            && node.left >= container.left
            && node.top >= container.top
            && node.left + node.width <= container.left + container.width
            && node.top + node.height <= container.top + container.height
        )
        if (contentNodes.length === 0) continue
        const contentTop = Math.min(...contentNodes.map((node) => node.top))
        const contentBottom = Math.max(...contentNodes.map((node) => node.top + node.height))
        const topGutter = contentTop - container.top
        const bottomGutter = container.top + container.height - contentBottom
        const difference = Math.abs(bottomGutter - topGutter)
        if (difference <= 48 || difference / container.height <= 0.18) continue
        const largerSide = bottomGutter > topGutter ? 'below' : 'above'
        const smallerSide = largerSide === 'below' ? 'above' : 'below'
        diagnostics.push({
            code: 'layout.whitespace_imbalance',
            severity: 'warning',
            theme,
            message: `Panel has ${Math.round(difference)}px more whitespace ${largerSide} its content than ${smallerSide} it.`,
            suggestion: 'Reduce the panel height, distribute its contents, or avoid stretching it beside taller content.',
            elementId: elementId(container.props),
            location: { x: container.left, y: container.top, width: container.width, height: container.height },
        })
        whitespaceCount += 1
        if (whitespaceCount >= MAX_DIAGNOSTICS_PER_RULE) break
    }

    return diagnostics
}

export function analyzeWhitespaceBalance(
    bounds: CropRegion,
    width: number,
    height: number,
    theme: ThemeMode,
): CheckDiagnostic[] {
    const gutters = {
        left: bounds.x,
        right: width - bounds.x - bounds.width,
        top: bounds.y,
        bottom: height - bounds.y - bounds.height,
    }
    const diagnostics: CheckDiagnostic[] = []
    const horizontalDifference = Math.abs(gutters.left - gutters.right)
    const verticalDifference = Math.abs(gutters.top - gutters.bottom)

    if (horizontalDifference > 48 && horizontalDifference / width > 0.12) {
        diagnostics.push({
            code: 'layout.whitespace_imbalance',
            severity: 'warning',
            theme,
            message: `Horizontal gutters differ by ${Math.round(horizontalDifference)}px (${Math.round(gutters.left)}px left, ${Math.round(gutters.right)}px right).`,
            suggestion: 'Recenter the composition, crop the canvas, or use the open space intentionally.',
            location: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        })
    }
    if (verticalDifference > 48 && verticalDifference / height > 0.12) {
        diagnostics.push({
            code: 'layout.whitespace_imbalance',
            severity: 'warning',
            theme,
            message: `Vertical gutters differ by ${Math.round(verticalDifference)}px (${Math.round(gutters.top)}px top, ${Math.round(gutters.bottom)}px bottom).`,
            suggestion: 'Recenter the composition, crop the canvas, or use the open space intentionally.',
            location: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        })
    }

    return diagnostics
}

export function diagnosticFromMessage(message: string, severity: Exclude<DiagnosticSeverity, 'info'>, theme?: ThemeMode): CheckDiagnostic {
    if (/unknown preset/i.test(message)) {
        return {
            code: 'frame.unknown_preset',
            severity,
            theme,
            message,
            suggestion: 'Use "default" or "engineering".',
        }
    }

    if (/unsupported prop|unknown prop|does not recognize (?:the )?.* prop/i.test(message)) {
        return {
            code: 'api.unsupported_prop',
            severity,
            theme,
            message,
            suggestion: 'Remove the prop or use one documented for this Vizmatic primitive.',
        }
    }

    if (/invalid value for css property|unsupported (?:css|style)|not supported.*css/i.test(message)) {
        return {
            code: 'style.unsupported',
            severity,
            theme,
            message,
            suggestion: 'Use CSS supported by Satori or a Vizmatic primitive.',
        }
    }

    if (/font|emoji|image asset|failed to (?:download|fetch)|asset .*not found/i.test(message)) {
        return {
            code: 'asset.warning',
            severity,
            theme,
            message,
            suggestion: 'Use a reachable asset or install it locally before rendering offline.',
        }
    }

    return {
        code: severity === 'error' ? 'render.error' : 'render.warning',
        severity,
        theme,
        message,
    }
}
