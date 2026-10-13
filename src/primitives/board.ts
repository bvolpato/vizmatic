import React from 'react'
import type { ThemeColors } from '../theme'
import { CanvasChartFit, isCanvasChart } from '../canvas-chart-fit'

export const CANVAS_ITEM_COMPONENT = Symbol.for('vizmatic.canvas-item')

export interface BoardProps {
    children?: React.ReactNode
    c: ThemeColors
    width?: number
    height?: number
    background?: string
}

export interface CanvasItemProps {
    children?: React.ReactNode
    x: number
    y: number
    width?: number
    height?: number
}

function dimension(value: number | undefined, name: string): number | undefined {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0 || value > 8192)) {
        throw new Error(`${name} must be a finite number greater than 0 and at most 8192.`)
    }
    return value
}

/** A fixed canvas for freely positioned, composable visuals. */
export function Board({ children, c, width = 960, height = 540, background }: BoardProps): React.ReactElement {
    return React.createElement('div', { style: {
        display: 'flex', position: 'relative', width: dimension(width, 'Board width'),
        height: dimension(height, 'Board height'), overflow: 'hidden',
        backgroundColor: background ?? 'transparent', color: c.textPrimary,
    } }, children)
}

/** Positions an item in Board coordinates, sizing its child or fitting a complete chart. */
export function CanvasItem({ children, x, y, width, height }: CanvasItemProps): React.ReactElement {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('CanvasItem x and y must be finite numbers.')
    const sizedChildren = React.Children.map(children, (child) => {
        if (!React.isValidElement<Record<string, unknown>>(child)) return child
        if (width !== undefined && height !== undefined && isCanvasChart(child.type)) {
            const chart = React.cloneElement(child, { width: child.props.width ?? width, height: child.props.height ?? height })
            return React.createElement(CanvasChartFit, { width, height, __vizmaticTextScope: child.props.__vizmaticTextScope }, chart)
        }
        return React.cloneElement(child, { ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) })
    })
    return React.createElement('div', { style: {
        display: 'flex', position: 'absolute', left: x, top: y,
        width: dimension(width, 'CanvasItem width'), height: dimension(height, 'CanvasItem height'),
        alignItems: 'stretch',
    } }, sizedChildren)
}

Object.defineProperty(CanvasItem, CANVAS_ITEM_COMPONENT, { value: true })
