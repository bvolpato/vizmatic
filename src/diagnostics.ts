import parseCssColor from 'parse-css-color'
import { Children, isValidElement, type ReactNode } from 'react'
import type { ThemeMode } from './theme'

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface CheckDiagnostic {
    code: 'accessibility.low_contrast' | 'api.unsupported_prop' | 'asset.warning' | 'frame.load_error' | 'frame.unknown_preset' | 'layout.auto_size' | 'layout.overflow' | 'render.error' | 'render.warning' | 'style.unsupported'
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
        const background = colorFromCss(style.backgroundColor)
            ?? colorFromCss(style.background)
            ?? inherited.background
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
