import parseCssColor from 'parse-css-color'
import { Children, isValidElement, type ReactNode } from 'react'
import type { SatoriNode } from './satori'
import type { ThemeMode } from './theme'
import type { CropRegion } from './autocrop'

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface CheckDiagnostic {
    code: 'accessibility.low_contrast' | 'api.unsupported_prop' | 'asset.warning' | 'frame.load_error' | 'frame.unknown_preset' | 'layout.auto_size' | 'layout.connector_congestion' | 'layout.overflow' | 'layout.text_overlap' | 'layout.whitespace_imbalance' | 'readability.small_text' | 'render.error' | 'render.warning' | 'style.unsupported'
    severity: DiagnosticSeverity
    message: string
    theme?: ThemeMode
    edges?: Array<'top' | 'right' | 'bottom' | 'left'>
    suggestion?: string
    suggestedDimensions?: {
        width: number
        height: number
    }
}

interface RgbaColor {
    r: number
    g: number
    b: number
    alpha: number
}

interface ContrastContext {
    background?: RgbaColor
    color?: RgbaColor
    fontSize?: number
    fontWeight?: number
}

const MAX_CONTRAST_NODES = 5_000
const MAX_DIAGNOSTICS_PER_RULE = 12
const MIN_TEXT_SIZE = 11

function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
    const h = ((hue % 360) + 360) % 360
    const s = saturation / 100
    const l = lightness / 100
    const chroma = (1 - Math.abs(2 * l - 1)) * s
    const segment = h / 60
    const intermediate = chroma * (1 - Math.abs((segment % 2) - 1))
    let channels: [number, number, number]
    if (segment < 1) channels = [chroma, intermediate, 0]
    else if (segment < 2) channels = [intermediate, chroma, 0]
    else if (segment < 3) channels = [0, chroma, intermediate]
    else if (segment < 4) channels = [0, intermediate, chroma]
    else if (segment < 5) channels = [intermediate, 0, chroma]
    else channels = [chroma, 0, intermediate]
    const offset = l - chroma / 2
    return channels.map((channel) => Math.round((channel + offset) * 255)) as [number, number, number]
}

function colorFromCss(value: unknown): RgbaColor | undefined {
    if (typeof value !== 'string') return undefined
    const parsed = parseCssColor(value)
    if (!parsed || parsed.values.length < 3 || parsed.alpha < 0.95) return undefined
    const [r, g, b] = parsed.type === 'hsl'
        ? hslToRgb(parsed.values[0] ?? 0, parsed.values[1] ?? 0, parsed.values[2] ?? 0)
        : [parsed.values[0] ?? 0, parsed.values[1] ?? 0, parsed.values[2] ?? 0]
    return {
        r,
        g,
        b,
        alpha: parsed.alpha,
    }
}

function channelLuminance(value: number): number {
    const normalized = value / 255
    return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(color: RgbaColor): number {
    return 0.2126 * channelLuminance(color.r)
        + 0.7152 * channelLuminance(color.g)
        + 0.0722 * channelLuminance(color.b)
}

function contrastRatio(foreground: RgbaColor, background: RgbaColor): number {
    const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
    const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
    return (lighter + 0.05) / (darker + 0.05)
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

function resolveFunctionComponent(node: ReactNode, trustedComponents: ReadonlySet<unknown>): ReactNode | undefined {
    if (!isValidElement(node) || typeof node.type !== 'function' || trustedComponents.has(node.type)) return undefined
    const component = node.type as ((props: unknown) => ReactNode) & {
        __vizmaticPrimitive?: boolean
        prototype?: { isReactComponent?: boolean }
    }
    if (component.__vizmaticPrimitive) return undefined
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
    const diagnostics: CheckDiagnostic[] = []
    const seen = new Set<string>()
    let visited = 0

    function visit(node: ReactNode, inherited: ContrastContext, path: string) {
        if (visited++ >= MAX_CONTRAST_NODES || !isValidElement(node)) return

        const resolved = resolveFunctionComponent(node, trustedComponents)
        if (resolved !== undefined) {
            visit(resolved, inherited, path)
            return
        }

        const props = node.props as Record<string, unknown>
        const style = typeof node.type === 'string' ? styleRecord(props.style) : {}
        const backgroundImage = typeof style.backgroundImage === 'string'
            ? style.backgroundImage.trim().toLowerCase()
            : ''
        const hasUnresolvedBackground = (backgroundImage !== '' && backgroundImage !== 'none')
            || (typeof style.background === 'string' && style.background.includes('gradient('))
        const background = hasUnresolvedBackground
            ? undefined
            : colorFromCss(style.backgroundColor) ?? colorFromCss(style.background) ?? inherited.background
        const color = colorFromCss(style.color) ?? inherited.color
        const fontSize = fontSizePixels(style.fontSize, inherited.fontSize)
        const fontWeight = numericFontWeight(style.fontWeight) ?? inherited.fontWeight
        const context = { background, color, fontSize, fontWeight }

        if (typeof node.type === 'string' && hasDirectText(props.children as ReactNode) && color && background) {
            const ratio = contrastRatio(color, background)
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
                    })
                }
            }
        }

        Children.forEach(props.children as ReactNode, (child, index) => visit(child, context, `${path}.${index}`))
    }

    visit(element, { background: colorFromCss(rootBackground) }, 'root')
    return diagnostics
}

interface TextLayoutNode {
    text: string
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

function textUnits(text: string): number {
    return Array.from(text.normalize('NFC')).reduce((sum, character) =>
        sum + ((character.codePointAt(0) ?? 0) > 0xff ? 1.7 : 1), 0)
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
        const text = node.textContent?.trim()

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
        })
    }

    const maxDataNumber = (attribute: string) => Math.max(0, ...nodes.map((node) => {
        const value = node.props[attribute]
        return typeof value === 'number' ? value : Number(value) || 0
    }))
    const connectorCrossings = maxDataNumber('data-vizmatic-connector-crossings')
    if (connectorCrossings > 0) {
        diagnostics.push({
            code: 'layout.connector_congestion',
            severity: 'warning',
            theme,
            message: `${connectorCrossings} connector crossing${connectorCrossings === 1 ? '' : 's'} detected.`,
            suggestion: 'Use automatic layout, change graph direction, or simplify the edge set.',
        })
    }
    const labelCollisions = maxDataNumber('data-vizmatic-connector-label-collisions')
    if (labelCollisions > 0) {
        diagnostics.push({
            code: 'layout.connector_congestion',
            severity: 'warning',
            theme,
            message: `${labelCollisions} connector label collision${labelCollisions === 1 ? '' : 's'} detected.`,
            suggestion: 'Change graph direction or spacing, shorten edge labels, or remove nonessential labels.',
        })
    }
    const crowdedEndpoints = maxDataNumber('data-vizmatic-crowded-connector-endpoints')
    if (crowdedEndpoints > 0) {
        diagnostics.push({
            code: 'layout.connector_congestion',
            severity: 'warning',
            theme,
            message: `${crowdedEndpoints} node${crowdedEndpoints === 1 ? '' : 's'} connect more than four edges.`,
            suggestion: 'Group related branches, add an intermediate hub, or change graph direction.',
        })
    }
    const parallelGroups = maxDataNumber('data-vizmatic-parallel-connector-groups')
    if (parallelGroups > 0) {
        diagnostics.push({
            code: 'layout.connector_congestion',
            severity: 'warning',
            theme,
            message: `${parallelGroups} connector route${parallelGroups === 1 ? '' : 's'} contain parallel edges.`,
            suggestion: 'Merge duplicate relationships, label one combined edge, or separate the routes.',
        })
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
        })
    }
    if (verticalDifference > 48 && verticalDifference / height > 0.12) {
        diagnostics.push({
            code: 'layout.whitespace_imbalance',
            severity: 'warning',
            theme,
            message: `Vertical gutters differ by ${Math.round(verticalDifference)}px (${Math.round(gutters.top)}px top, ${Math.round(gutters.bottom)}px bottom).`,
            suggestion: 'Recenter the composition, crop the canvas, or use the open space intentionally.',
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
