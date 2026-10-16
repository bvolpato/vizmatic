import React, { isValidElement, type ReactNode } from 'react'
import type { SatoriNode, SatoriOptions } from 'satori'

export const CANVAS_CHART_COMPONENT = Symbol.for('vizmatic.canvasChartComponent')
export const CHART_FRAME_COMPONENT = Symbol.for('vizmatic.chartFrameComponent')
const FIT_PROP = '__vizmaticCanvasChartFit'
const SCOPE_PROP = 'data-vizmatic-chart-fit-scope'
const VIEWPORT_PROP = 'data-vizmatic-chart-fit-viewport'

interface FitSize { width: number; height: number }
interface FitGeometry extends FitSize { left: number; top: number; scale: number }
interface Bounds { left: number; top: number; right: number; bottom: number }
type Renderer = (element: ReactNode, options: SatoriOptions) => Promise<string>

export function isCanvasChart(component: unknown): boolean {
    return typeof component === 'function' && Boolean((component as unknown as Record<symbol, unknown>)[CANVAS_CHART_COMPONENT])
}

/** Keeps the chart's labels and plotting layer together while fitting the complete visual. */
export function CanvasChartFit({ children, width, height }: { children?: ReactNode; width: number; height: number; __vizmaticTextScope?: unknown }): React.ReactElement {
    let chart = children
    for (let depth = 0; isValidElement<Record<string, unknown>>(chart) && typeof chart.type === 'function' && depth < 16; depth += 1) {
        if ((chart.type as unknown as Record<symbol, unknown>)[CHART_FRAME_COMPONENT]) {
            const props = chart.props as Record<string, unknown>
            const padding = typeof props.padding === 'number' ? props.padding : 16
            chart = React.cloneElement(chart, {
                ...props,
                width: typeof props.width === 'number' ? props.width + 2 * (padding + 1) : props.width,
                height: undefined,
            })
            break
        }
        chart = (chart.type as (props: Record<string, unknown>) => ReactNode)(chart.props as Record<string, unknown>)
    }
    return React.createElement('div', {
        [FIT_PROP]: { width, height },
        style: { position: 'relative', display: 'flex', width, height, flexShrink: 0 },
    }, React.createElement('div', {
        style: { position: 'absolute', left: 0, top: 0, display: 'flex', alignItems: 'flex-start' },
    }, chart))
}

function prepareChartFits(element: ReactNode): { element: ReactNode; sizes: Map<string, FitSize> } {
    const sizes = new Map<string, FitSize>()
    const hasText = (node: ReactNode): boolean => {
        if (typeof node === 'string' || typeof node === 'number' || typeof node === 'bigint') return true
        if (Array.isArray(node)) return node.some(hasText)
        return isValidElement<{ children?: ReactNode }>(node) && node.type === React.Fragment && hasText(node.props.children)
    }
    const visit = (node: ReactNode, scope?: string): ReactNode => {
        if (Array.isArray(node)) return node.map((child) => visit(child, scope))
        if (!isValidElement<Record<string, unknown>>(node)) return node
        type RenderComponent = (props: Record<string, unknown>) => ReactNode
        const forwarded = node.type as unknown as { $$typeof?: symbol; render?: RenderComponent } | null
        const render = typeof node.type === 'function'
            ? node.type as RenderComponent
            : forwarded?.$$typeof === Symbol.for('react.forward_ref') ? forwarded.render : undefined
        if (render) {
            const resolved = visit(render(node.props), scope)
            return node.key != null && isValidElement(resolved) ? React.cloneElement(resolved, { key: node.key }) : resolved
        }
        const size = node.props[FIT_PROP] as FitSize | undefined
        const props = { ...node.props }
        delete props[FIT_PROP]
        let childScope = scope
        if (size) {
            const id = String(sizes.size)
            sizes.set(id, size)
            props[VIEWPORT_PROP] = id
            childScope = id
        } else if (scope !== undefined && typeof node.type === 'string') {
            props[SCOPE_PROP] = scope
        }
        const children = node.props.children as ReactNode
        const preparedChildren = children === undefined ? undefined : visit(children, childScope)
        if (typeof node.type === 'string') {
            const style = node.props.style as React.CSSProperties | undefined
            // Preserve the diagram layout defaults used before Satori's browser layout engine.
            props.style = {
                minWidth: 0, minHeight: 0,
                ...(style?.flex === undefined ? { flexShrink: hasText(preparedChildren) ? 1 : 0 } : {}),
                ...style,
            }
        }
        return children === undefined ? React.cloneElement(node, props) : React.cloneElement(node, props, preparedChildren)
    }
    return { element: visit(element), sizes }
}

function fittedTree(element: ReactNode, geometry: Map<string, FitGeometry>): ReactNode {
    if (Array.isArray(element)) return element.map((child) => fittedTree(child, geometry))
    if (!isValidElement<Record<string, unknown>>(element)) return element
    const id = element.props[VIEWPORT_PROP]
    const children = element.props.children as ReactNode
    if (typeof id === 'string') {
        const fit = geometry.get(id)!
        const content = React.Children.only(children) as React.ReactElement<{ style: React.CSSProperties }>
        return React.cloneElement(element, {}, React.cloneElement(content, { style: {
            ...content.props.style, left: fit.left, top: fit.top,
            transform: `scale(${fit.scale})`, transformOrigin: 'top left',
        } }))
    }
    return children === undefined ? element : React.cloneElement(element, {}, fittedTree(children, geometry))
}

/** Measure wrapped chart text with the renderer's fonts, then fit without cropping any layer. */
export async function renderWithCanvasChartFit(render: Renderer, element: ReactNode, options: SatoriOptions): Promise<string> {
    const prepared = prepareChartFits(element)
    if (!prepared.sizes.size) return render(prepared.element, options)
    const viewports = new Map<string, SatoriNode>()
    const bounds = new Map<string, Bounds>()
    await render(prepared.element, { ...options, onNodeDetected(node) {
        const viewport = node.props[VIEWPORT_PROP]
        if (typeof viewport === 'string') viewports.set(viewport, node)
        const id = node.props[SCOPE_PROP]
        if (typeof id !== 'string' || node.width < 0 || node.height < 0) return
        const prior = bounds.get(id)
        bounds.set(id, {
            left: Math.min(prior?.left ?? Infinity, node.left), top: Math.min(prior?.top ?? Infinity, node.top),
            right: Math.max(prior?.right ?? -Infinity, node.left + node.width),
            bottom: Math.max(prior?.bottom ?? -Infinity, node.top + node.height),
        })
    } })
    const geometry = new Map<string, FitGeometry>()
    for (const [id, size] of prepared.sizes) {
        const viewport = viewports.get(id)
        const measured = bounds.get(id)
        if (!viewport || !measured) throw new Error('Could not measure the chart inside CanvasItem.')
        const width = measured.right - measured.left, height = measured.bottom - measured.top
        const scale = Math.min(size.width / width, size.height / height)
        if (!Number.isFinite(scale) || scale <= 0) throw new Error('CanvasItem charts require positive, finite dimensions.')
        geometry.set(id, { ...size, scale,
            left: (size.width - width * scale) / 2 - (measured.left - viewport.left) * scale,
            top: (size.height - height * scale) / 2 - (measured.top - viewport.top) * scale,
        })
    }
    const finalViewports = new Map<string, SatoriNode>()
    return render(fittedTree(prepared.element, geometry), { ...options, onNodeDetected(node) {
        const viewport = node.props[VIEWPORT_PROP]
        if (typeof viewport === 'string') finalViewports.set(viewport, node)
        const id = node.props[SCOPE_PROP]
        const fit = typeof id === 'string' ? geometry.get(id) : undefined
        const origin = typeof id === 'string' ? finalViewports.get(id) : undefined
        if (fit && origin) {
            const left = origin.left + fit.left, top = origin.top + fit.top
            const style = node.props.style ?? {}
            options.onNodeDetected?.({ ...node,
                left: left + (node.left - left) * fit.scale, top: top + (node.top - top) * fit.scale,
                width: node.width * fit.scale, height: node.height * fit.scale,
                props: { ...node.props, style: { ...style, ...(typeof style.fontSize === 'number' ? { fontSize: style.fontSize * fit.scale } : {}) } },
            })
        } else options.onNodeDetected?.(node)
    } })
}
