import React from 'react'
import type { ThemeColors } from '../theme'
import { SvgMathText } from './layout'
import { SvgFrame } from './svg'

const MAX_SVG_SIZE = 4096
const FONT_SIZE = 13

function finite(value: number, name: string): number {
    if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite.`)
    return value
}

function positive(value: number, name: string): number {
    finite(value, name)
    if (value <= 0) throw new RangeError(`${name} must be greater than zero.`)
    return value
}

function increasing(min: number, max: number, name: string): number {
    finite(min, `${name} minimum`)
    finite(max, `${name} maximum`)
    const range = max - min
    if (!Number.isFinite(range) || range <= 0) throw new RangeError(`${name} must have a finite increasing domain.`)
    return range
}

function dimensions(width: number, height: number, name: string, minimumHeight = 360): void {
    finite(width, `${name} width`)
    finite(height, `${name} height`)
    if (width < 600 || height < minimumHeight) throw new RangeError(`${name} width must be at least 600 pixels and height at least ${minimumHeight} pixels.`)
    if (width > MAX_SVG_SIZE || height > MAX_SVG_SIZE) throw new RangeError(`${name} dimensions cannot exceed ${MAX_SVG_SIZE} pixels.`)
}

function bounded<T>(items: readonly T[], maximum: number, name: string, minimum = 0): void {
    if (!Array.isArray(items)) throw new TypeError(`${name} must be an array.`)
    if (items.length < minimum || items.length > maximum) {
        throw new RangeError(`${name} must contain between ${minimum} and ${maximum} items.`)
    }
}

function labelText(value: string, name: string, maxLength = 80): string {
    if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${name} must be a non-empty string.`)
    if (value.length > maxLength) throw new RangeError(`${name} cannot exceed ${maxLength} characters.`)
    return value
}

function idValue(value: string, name: string): string {
    labelText(value, name, 64)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new TypeError(`${name} must use letters, numbers, dots, underscores, colons, or hyphens.`)
    return value
}

function uniqueIds(values: readonly string[], name: string): void {
    const ids = new Set<string>()
    for (const id of values) {
        if (ids.has(id)) throw new TypeError(`${name} contains duplicate id "${id}".`)
        ids.add(id)
    }
}

function colorValue(value: string | undefined, fallback: string, name: string): string {
    if (value === undefined) return fallback
    if (typeof value !== 'string' || value.length > 64 || !/^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|[a-z]{3,24}|rgba?\([0-9.,%\s]+\)|hsla?\([0-9.,%\s]+\))$/i.test(value)) {
        throw new TypeError(`${name} must be a CSS color value.`)
    }
    return value
}

function textWidth(text: string, size = FONT_SIZE): number {
    return Math.max(size * 1.6, text.length * size * 0.62)
}

function boundedTextX(preferred: number, width: number, text: string, anchor: 'start' | 'middle' | 'end', margin = 18, size = FONT_SIZE): number {
    const measured = textWidth(text, size)
    if (anchor === 'start') return clamp(preferred, margin, width - margin - measured)
    if (anchor === 'end') return clamp(preferred, margin + measured, width - margin)
    return clamp(preferred, margin + measured / 2, width - margin - measured / 2)
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

interface SvgShellProps {
    c: ThemeColors
    width: number
    height: number
    title: string
    ariaLabel?: string
    description: string
    children: React.ReactNode[]
}

function svgShell({ c, width, height, title, ariaLabel, description, children }: SvgShellProps): React.ReactElement {
    const overlays: React.ReactElement[] = []
    const svgChildren: React.ReactNode[] = [
        React.createElement('title', { key: 'title' }, title),
        React.createElement('desc', { key: 'description' }, description),
        SvgFrame({ key: 'frame', x: 8, y: 8, width: width - 16, height: height - 16, rx: 12, c }),
    ]
    for (const [index, child] of children.entries()) {
        if (React.isValidElement(child) && child.type === 'text') {
            const textProps = child.props as {
                x: number
                y: number
                fill?: string
                fontFamily?: string
                fontSize?: number
                fontWeight?: number
                textAnchor?: 'start' | 'middle' | 'end'
                children?: React.ReactNode
            }
            const text = React.Children.toArray(textProps.children).map((part) => String(part)).join('')
            overlays.push(React.createElement(SvgMathText, {
                key: `label-${index}`,
                text,
                x: textProps.x,
                y: textProps.y,
                fill: textProps.fill ?? c.textPrimary,
                fontFamily: textProps.fontFamily ?? c.fontSans,
                fontSize: textProps.fontSize ?? FONT_SIZE,
                fontWeight: textProps.fontWeight ?? 500,
                textAnchor: textProps.textAnchor ?? 'start',
                dominantBaseline: 'auto',
            }))
        } else {
            svgChildren.push(child)
        }
    }
    overlays.unshift(React.createElement(SvgMathText, {
        key: 'diagram-title',
        text: title,
        x: width / 2,
        y: 36,
        fill: c.textPrimary,
        fontFamily: c.fontSans,
        fontSize: 18,
        fontWeight: 700,
        textAnchor: 'middle',
        dominantBaseline: 'auto',
    }))
    return React.createElement('div', {
        role: 'img',
        'aria-label': ariaLabel ?? title,
        'aria-description': description,
        style: { position: 'relative' as const, width, height, display: 'flex', flexShrink: 0 },
    },
    React.createElement('svg', {
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        'aria-hidden': true,
        style: { position: 'absolute' as const, inset: 0 },
    }, ...svgChildren),
    ...overlays)
}

function formatNumber(value: number): string {
    if (Object.is(value, -0) || value === 0) return '0'
    if (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3) return value.toExponential(2)
    return Number(value.toPrecision(4)).toString()
}

export interface NumberLineTick {
    value: number
    label?: string
}

export interface NumberLineMarker {
    id: string
    value: number
    label: string
    color?: string
}

export interface NumberLineInterval {
    from: number
    to: number
    includeFrom?: boolean
    includeTo?: boolean
    label?: string
    color?: string
}

export interface NumberLineProps {
    c: ThemeColors
    min: number
    max: number
    ticks?: NumberLineTick[]
    markers?: NumberLineMarker[]
    interval?: NumberLineInterval
    title?: string
    ariaLabel?: string
    width?: number
    height?: number
}

export function mapNumberLine(value: number, min: number, max: number, width: number, padding = 56): number {
    finite(value, 'NumberLine value')
    const range = increasing(min, max, 'NumberLine')
    finite(width, 'NumberLine width')
    finite(padding, 'NumberLine padding')
    if (padding < 0) throw new RangeError('NumberLine padding cannot be negative.')
    positive(width - padding * 2, 'NumberLine drawable width')
    if (value < min || value > max) throw new RangeError('NumberLine value must lie within its domain.')
    return padding + ((value - min) / range) * (width - padding * 2)
}

export function NumberLine({
    c,
    min,
    max,
    ticks,
    markers = [],
    interval,
    title = 'Number line',
    ariaLabel,
    width = 720,
    height = 400,
}: NumberLineProps): React.ReactElement {
    const range = increasing(min, max, 'NumberLine')
    dimensions(width, height, 'NumberLine', 120)
    labelText(title, 'NumberLine title', 32)
    bounded(markers, 128, 'NumberLine markers')
    const resolvedTicks: NumberLineTick[] = ticks ?? [min, min + range / 2, max].filter((value, index, all) => all.indexOf(value) === index).map((value) => ({ value }))
    bounded(resolvedTicks, 128, 'NumberLine ticks')
    const tickValues = resolvedTicks.map((tick, index) => {
        finite(tick.value, `NumberLine tick ${index} value`)
        if (tick.value < min || tick.value > max) throw new RangeError(`NumberLine tick ${index} must lie within its domain.`)
        if (tick.label !== undefined) labelText(tick.label, `NumberLine tick ${index} label`, 32)
        return tick.value
    })
    if (new Set(tickValues).size !== tickValues.length) throw new TypeError('NumberLine ticks cannot repeat values.')
    uniqueIds(markers.map((marker) => idValue(marker.id, 'NumberLine marker id')), 'NumberLine markers')
    markers.forEach((marker, index) => {
        finite(marker.value, `NumberLine marker ${index} value`)
        if (marker.value < min || marker.value > max) throw new RangeError(`NumberLine marker "${marker.id}" must lie within its domain.`)
        labelText(marker.label, `NumberLine marker "${marker.id}" label`, 32)
        colorValue(marker.color, c.accent, `NumberLine marker "${marker.id}" color`)
    })
    if (interval) {
        if (height < 180) throw new RangeError('NumberLine intervals require at least 180 pixels of height.')
        if (interval.label && height < 220) throw new RangeError('Labeled NumberLine intervals require at least 220 pixels of height.')
        finite(interval.from, 'NumberLine interval start')
        finite(interval.to, 'NumberLine interval end')
        if (interval.from < min || interval.from > max || interval.to < min || interval.to > max || interval.from > interval.to) {
            throw new RangeError('NumberLine interval must be ordered and lie within its domain.')
        }
        if (interval.from === interval.to && (interval.includeFrom === false || interval.includeTo === false)) {
            throw new RangeError('A zero-width NumberLine interval must include both endpoints.')
        }
        if (interval.label !== undefined) labelText(interval.label, 'NumberLine interval label', 32)
        colorValue(interval.color, c.info, 'NumberLine interval color')
    }

    const x = (value: number) => mapNumberLine(value, min, max, width)
    const axisY = Math.round(height * (interval && height < 220 ? 0.45 : 0.56))
    const elements: React.ReactNode[] = [
        React.createElement('line', { key: 'axis', x1: 56, y1: axisY, x2: width - 56, y2: axisY, stroke: c.textSecondary, strokeWidth: 2 }),
        React.createElement('path', { key: 'left-arrow', d: `M 56 ${axisY} l 9 -5 v 10 z`, fill: c.textSecondary }),
        React.createElement('path', { key: 'right-arrow', d: `M ${width - 56} ${axisY} l -9 -5 v 10 z`, fill: c.textSecondary }),
    ]
    if (interval) {
        const fromX = x(interval.from)
        const toX = x(interval.to)
        const color = colorValue(interval.color, c.info, 'NumberLine interval color')
        const includeFrom = interval.includeFrom !== false
        const includeTo = interval.includeTo !== false
        const intervalY = axisY + 52
        elements.push(
            React.createElement('line', { key: 'interval', x1: fromX, y1: intervalY, x2: toX, y2: intervalY, stroke: color, strokeWidth: 8, strokeLinecap: 'round', opacity: 0.62 }),
            React.createElement('circle', { key: 'interval-from', cx: fromX, cy: intervalY, r: 7, fill: includeFrom ? color : c.bgSubtle, stroke: color, strokeWidth: 3 }),
            React.createElement('circle', { key: 'interval-to', cx: toX, cy: intervalY, r: 7, fill: includeTo ? color : c.bgSubtle, stroke: color, strokeWidth: 3 }),
        )
        if (interval.label) {
            const label = interval.label
            const labelX = clamp((fromX + toX) / 2, 56 + textWidth(label) / 2, width - 56 - textWidth(label) / 2)
            elements.push(React.createElement('text', { key: 'interval-label', x: labelX, y: axisY + 82, textAnchor: 'middle', fill: c.textSecondary, fontFamily: c.fontSans, fontSize: FONT_SIZE }, label))
        }
    }
    for (const [index, tick] of resolvedTicks.entries()) {
        const tickX = x(tick.value)
        elements.push(
            React.createElement('line', { key: `tick-${index}`, x1: tickX, y1: axisY - 9, x2: tickX, y2: axisY + 9, stroke: c.textSecondary, strokeWidth: 2 }),
            React.createElement('text', { key: `tick-label-${index}`, x: tickX, y: axisY + 34, textAnchor: 'middle', fill: c.textSecondary, fontFamily: c.fontMono, fontSize: 12 }, tick.label ?? formatNumber(tick.value)),
        )
    }
    markers.forEach((marker, index) => {
        const markerX = x(marker.value)
        const color = colorValue(marker.color, c.accent, `NumberLine marker "${marker.id}" color`)
        const lane = index % 4
        const labelY = Math.max(66, axisY - 54 - lane * 30)
        const labelX = clamp(markerX, 56 + textWidth(marker.label, 12) / 2, width - 56 - textWidth(marker.label, 12) / 2)
        elements.push(
            React.createElement('line', { key: `marker-line-${marker.id}`, x1: markerX, y1: axisY - 4, x2: markerX, y2: labelY + 7, stroke: color, strokeWidth: 1.5, strokeDasharray: '4 4', opacity: 0.8 }),
            React.createElement('circle', { key: `marker-point-${marker.id}`, cx: markerX, cy: axisY, r: 7, fill: color, stroke: c.bgCard, strokeWidth: 2 }),
            React.createElement('text', { key: `marker-label-${marker.id}`, x: labelX, y: labelY, textAnchor: 'middle', fill: color, fontFamily: c.fontSans, fontSize: 12, fontWeight: 650 }, marker.label),
        )
    })
    const intervalDescription = interval
        ? ` The highlighted interval is ${interval.includeFrom === false ? '(' : '['}${formatNumber(interval.from)}, ${formatNumber(interval.to)}${interval.includeTo === false ? ')' : ']'}${interval.label ? `, labeled ${interval.label}` : ''}.`
        : ''
    return svgShell({ c, width, height, title, ariaLabel, description: `A numeric axis from ${formatNumber(min)} to ${formatNumber(max)} with ${resolvedTicks.length} explicit ticks and ${markers.length} labeled markers.${intervalDescription}`, children: elements })
}

export interface GeometryPoint {
    id: string
    x: number
    y: number
    label?: string
}

export interface GeometrySegment {
    from: string
    to: string
    label?: string
    color?: string
    dashed?: boolean
}

export interface GeometryAngle {
    vertex: string
    from: string
    to: string
    label?: string
    radius?: number
    color?: string
}

export interface GeometryBounds {
    minX: number
    maxX: number
    minY: number
    maxY: number
    width: number
    height: number
}

export interface GeometryDiagramProps {
    c: ThemeColors
    points: GeometryPoint[]
    segments?: GeometrySegment[]
    angles?: GeometryAngle[]
    title?: string
    ariaLabel?: string
    width?: number
    height?: number
}

export function geometryBounds(points: readonly GeometryPoint[]): GeometryBounds {
    bounded(points, 128, 'GeometryDiagram points', 1)
    points.forEach((point, index) => {
        finite(point.x, `GeometryDiagram point ${index} x`)
        finite(point.y, `GeometryDiagram point ${index} y`)
    })
    const xs = points.map(({ x }) => x)
    const ys = points.map(({ y }) => y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const width = maxX - minX
    const height = maxY - minY
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new RangeError('GeometryDiagram point bounds must be finite.')
    return { minX, maxX, minY, maxY, width, height }
}

export function GeometryDiagram({
    c,
    points,
    segments = [],
    angles = [],
    title = 'Geometry diagram',
    ariaLabel,
    width = 720,
    height = 440,
}: GeometryDiagramProps): React.ReactElement {
    const bounds = geometryBounds(points)
    dimensions(width, height, 'GeometryDiagram')
    labelText(title, 'GeometryDiagram title', 32)
    bounded(segments, 256, 'GeometryDiagram segments')
    bounded(angles, 64, 'GeometryDiagram angles')
    uniqueIds(points.map((point) => idValue(point.id, 'GeometryDiagram point id')), 'GeometryDiagram points')
    const pointById = new Map(points.map((point) => [point.id, point]))
    points.forEach((point) => {
        if (point.label !== undefined) labelText(point.label, `GeometryDiagram point "${point.id}" label`, 32)
    })
    segments.forEach((segment, index) => {
        idValue(segment.from, `GeometryDiagram segment ${index} start`)
        idValue(segment.to, `GeometryDiagram segment ${index} end`)
        if (segment.from === segment.to) throw new RangeError(`GeometryDiagram segment ${index} must connect two different points.`)
        const from = pointById.get(segment.from)
        const to = pointById.get(segment.to)
        if (!from || !to) throw new TypeError(`GeometryDiagram segment ${index} references a missing point.`)
        if (from.x === to.x && from.y === to.y) throw new RangeError(`GeometryDiagram segment ${index} has zero length.`)
        if (segment.label !== undefined) labelText(segment.label, `GeometryDiagram segment ${index} label`, 32)
        colorValue(segment.color, c.secondary, `GeometryDiagram segment ${index} color`)
    })
    angles.forEach((angle, index) => {
        const vertex = pointById.get(idValue(angle.vertex, `GeometryDiagram angle ${index} vertex`))
        const from = pointById.get(idValue(angle.from, `GeometryDiagram angle ${index} first ray`))
        const to = pointById.get(idValue(angle.to, `GeometryDiagram angle ${index} second ray`))
        if (!vertex || !from || !to) throw new TypeError(`GeometryDiagram angle ${index} references a missing point.`)
        if (angle.from === angle.to || angle.from === angle.vertex || angle.to === angle.vertex) {
            throw new RangeError(`GeometryDiagram angle ${index} must use three distinct point ids.`)
        }
        const ax = from.x - vertex.x
        const ay = from.y - vertex.y
        const bx = to.x - vertex.x
        const by = to.y - vertex.y
        const lengths = Math.hypot(ax, ay) * Math.hypot(bx, by)
        if (!Number.isFinite(lengths) || lengths === 0) throw new RangeError(`GeometryDiagram angle ${index} has a zero-length ray.`)
        const cross = ax * by - ay * bx
        const dot = ax * bx + ay * by
        if (!Number.isFinite(cross) || !Number.isFinite(dot) || (Math.abs(cross) <= lengths * 1e-12 && dot > 0)) {
            throw new RangeError(`GeometryDiagram angle ${index} is degenerate.`)
        }
        if (angle.label !== undefined) labelText(angle.label, `GeometryDiagram angle ${index} label`, 32)
        if (angle.radius !== undefined) {
            positive(angle.radius, `GeometryDiagram angle ${index} radius`)
            if (angle.radius > 120) throw new RangeError(`GeometryDiagram angle ${index} radius cannot exceed 120 pixels.`)
        }
        colorValue(angle.color, c.accent, `GeometryDiagram angle ${index} color`)
    })

    const padding = 80
    const maxRange = Math.max(bounds.width, bounds.height)
    const scale = maxRange === 0
        ? Math.min(width - padding * 2, height - padding * 2)
        : Math.min((width - padding * 2) / maxRange, (height - padding * 2) / maxRange)
    const centerX = bounds.minX / 2 + bounds.maxX / 2
    const centerY = bounds.minY / 2 + bounds.maxY / 2
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY) || !Number.isFinite(scale) || scale <= 0) {
        throw new RangeError('GeometryDiagram coordinates cannot be mapped into the viewport.')
    }
    const map = (point: GeometryPoint) => ({ x: width / 2 + (point.x - centerX) * scale, y: height / 2 - (point.y - centerY) * scale })
    angles.forEach((angle, index) => {
        const vertex = map(pointById.get(angle.vertex)!)
        const radius = angle.radius ?? 32
        if (vertex.x - radius < 22 || vertex.x + radius > width - 22 || vertex.y - radius < 40 || vertex.y + radius > height - 22) {
            throw new RangeError(`GeometryDiagram angle ${index} arc would clip the viewport.`)
        }
    })
    const elements: React.ReactNode[] = []
    segments.forEach((segment, index) => {
        const from = map(pointById.get(segment.from)!)
        const to = map(pointById.get(segment.to)!)
        const color = colorValue(segment.color, c.secondary, `GeometryDiagram segment ${index} color`)
        elements.push(React.createElement('line', {
            key: `segment-${index}`,
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            stroke: color,
            strokeWidth: 3,
            strokeDasharray: segment.dashed ? '7 6' : undefined,
            strokeLinecap: 'round',
        }))
        if (segment.label) {
            const labelX = clamp((from.x + to.x) / 2, 24 + textWidth(segment.label) / 2, width - 24 - textWidth(segment.label) / 2)
            const labelY = clamp((from.y + to.y) / 2 - 9, 58, height - 22)
            elements.push(React.createElement('text', { key: `segment-label-${index}`, x: labelX, y: labelY, textAnchor: 'middle', fill: c.textSecondary, fontFamily: c.fontSans, fontSize: FONT_SIZE }, segment.label))
        }
    })
    angles.forEach((angle, index) => {
        const vertex = pointById.get(angle.vertex)!
        const from = pointById.get(angle.from)!
        const to = pointById.get(angle.to)!
        const v = map(vertex)
        const a1 = Math.atan2(from.y - vertex.y, from.x - vertex.x)
        let delta = Math.atan2((from.x - vertex.x) * (to.y - vertex.y) - (from.y - vertex.y) * (to.x - vertex.x), (from.x - vertex.x) * (to.x - vertex.x) + (from.y - vertex.y) * (to.y - vertex.y))
        if (!Number.isFinite(delta)) throw new RangeError(`GeometryDiagram angle ${index} cannot be rendered.`)
        const radius = angle.radius ?? 32
        const samples = 18
        const arc = Array.from({ length: samples + 1 }, (_, sample) => {
            const theta = a1 + delta * sample / samples
            return { x: v.x + radius * Math.cos(theta), y: v.y - radius * Math.sin(theta) }
        })
        const path = arc.map((point, part) => `${part === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
        const color = colorValue(angle.color, c.accent, `GeometryDiagram angle ${index} color`)
        elements.push(React.createElement('path', { key: `angle-${index}`, d: path, fill: 'none', stroke: color, strokeWidth: 2.5, strokeLinecap: 'round' }))
        if (angle.label) {
            const middle = a1 + delta / 2
            const labelX = clamp(v.x + (radius + 18) * Math.cos(middle), 28 + textWidth(angle.label) / 2, width - 28 - textWidth(angle.label) / 2)
            const labelY = clamp(v.y - (radius + 18) * Math.sin(middle) + 4, 58, height - 20)
            elements.push(React.createElement('text', { key: `angle-label-${index}`, x: labelX, y: labelY, textAnchor: 'middle', fill: color, fontFamily: c.fontSans, fontSize: FONT_SIZE, fontWeight: 650 }, angle.label))
        }
    })
    points.forEach((point) => {
        const position = map(point)
        elements.push(React.createElement('circle', { key: `point-${point.id}`, cx: position.x, cy: position.y, r: 5.5, fill: c.primary, stroke: c.bgCard, strokeWidth: 2 }))
        if (point.label) {
            const label = point.label
            const labelWidth = textWidth(label)
            const placeRight = position.x + 12 + labelWidth < width - 16
            const baseX = position.x + (placeRight ? 12 : -12)
            const labelX = boundedTextX(baseX, width, label, placeRight ? 'start' : 'end')
            const labelY = clamp(position.y - 11, 58, height - 20)
            elements.push(React.createElement('text', {
                key: `point-label-${point.id}`,
                x: labelX,
                y: labelY,
                textAnchor: placeRight ? 'start' : 'end',
                fill: c.textPrimary,
                fontFamily: c.fontSans,
                fontSize: FONT_SIZE,
                fontWeight: 650,
            }, label))
        }
    })
    return svgShell({ c, width, height, title, ariaLabel, description: `${points.length} explicitly defined points, ${segments.length} segments, and ${angles.length} angle arcs. Coordinates use one equal-unit scale; no geometric properties are inferred.`, children: elements })
}

export interface ForceVector {
    id: string
    label: string
    x: number
    y: number
    color?: string
}

export interface ForceResultant {
    x: number
    y: number
    magnitude: number
}

export interface FreeBodyDiagramProps {
    c: ThemeColors
    forces: ForceVector[]
    showResultant?: boolean
    showComponents?: boolean
    title?: string
    ariaLabel?: string
    width?: number
    height?: number
}

export function sumForces(forces: readonly ForceVector[]): ForceResultant {
    bounded(forces, 32, 'FreeBodyDiagram forces', 1)
    let x = 0
    let y = 0
    for (const [index, force] of forces.entries()) {
        finite(force.x, `FreeBodyDiagram force ${index} x component`)
        finite(force.y, `FreeBodyDiagram force ${index} y component`)
        x += force.x
        y += force.y
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('FreeBodyDiagram resultant components must be finite.')
    }
    const magnitude = Math.hypot(x, y)
    if (!Number.isFinite(magnitude)) throw new RangeError('FreeBodyDiagram resultant magnitude must be finite.')
    return { x, y, magnitude }
}

export function FreeBodyDiagram({
    c,
    forces,
    showResultant = true,
    showComponents = false,
    title = 'Free-body diagram',
    ariaLabel,
    width = 720,
    height = 440,
}: FreeBodyDiagramProps): React.ReactElement {
    dimensions(width, height, 'FreeBodyDiagram')
    labelText(title, 'FreeBodyDiagram title', 32)
    bounded(forces, 32, 'FreeBodyDiagram forces', 1)
    uniqueIds(forces.map((force) => idValue(force.id, 'FreeBodyDiagram force id')), 'FreeBodyDiagram forces')
    forces.forEach((force, index) => {
        labelText(force.label, `FreeBodyDiagram force "${force.id}" label`, 32)
        finite(force.x, `FreeBodyDiagram force ${index} x component`)
        finite(force.y, `FreeBodyDiagram force ${index} y component`)
        const magnitude = Math.hypot(force.x, force.y)
        if (!Number.isFinite(magnitude) || magnitude === 0) throw new RangeError(`FreeBodyDiagram force "${force.id}" must have a finite, non-zero magnitude.`)
        colorValue(force.color, c.secondary, `FreeBodyDiagram force "${force.id}" color`)
    })
    const resultant = sumForces(forces)
    const largestMagnitude = Math.max(resultant.magnitude, ...forces.map((force) => Math.hypot(force.x, force.y)))
    if (!Number.isFinite(largestMagnitude) || largestMagnitude <= 0) throw new RangeError('FreeBodyDiagram must have a non-zero finite vector scale.')
    const center = { x: width / 2, y: height * 0.56 }
    const available = Math.min(width * 0.29, height * 0.31)
    const scale = available / largestMagnitude
    if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('FreeBodyDiagram vector magnitudes cannot be mapped into the viewport.')
    const mapVector = (x: number, y: number) => ({ x: center.x + x * scale, y: center.y - y * scale })
    const elements: React.ReactNode[] = [
        React.createElement('line', { key: 'x-axis', x1: center.x - available - 28, y1: center.y, x2: center.x + available + 28, y2: center.y, stroke: c.borderSubtle, strokeWidth: 1.3 }),
        React.createElement('line', { key: 'y-axis', x1: center.x, y1: center.y - available - 28, x2: center.x, y2: center.y + available + 28, stroke: c.borderSubtle, strokeWidth: 1.3 }),
        React.createElement('circle', { key: 'body', cx: center.x, cy: center.y, r: 6, fill: c.bgCard, stroke: c.textPrimary, strokeWidth: 2 }),
    ]
    forces.forEach((force, index) => {
        const color = colorValue(force.color, c.secondary, `FreeBodyDiagram force "${force.id}" color`)
        const end = mapVector(force.x, force.y)
        if (showComponents) {
            const xEnd = mapVector(force.x, 0)
            const yStart = mapVector(force.x, 0)
            if (force.x !== 0) elements.push(React.createElement('line', { key: `component-x-${force.id}`, x1: center.x, y1: center.y, x2: xEnd.x, y2: xEnd.y, stroke: color, strokeWidth: 1.6, strokeDasharray: '5 5', opacity: 0.56 }))
            if (force.y !== 0) elements.push(React.createElement('line', { key: `component-y-${force.id}`, x1: yStart.x, y1: yStart.y, x2: end.x, y2: end.y, stroke: color, strokeWidth: 1.6, strokeDasharray: '5 5', opacity: 0.56 }))
        }
        elements.push(arrow(center, end, color, `force-${force.id}`, 3))
        const direction = Math.sign(end.x - center.x) || (index % 2 === 0 ? 1 : -1)
        const anchor = direction > 0 ? 'start' : 'end'
        const labelX = boundedTextX(end.x + direction * 12, width, force.label, anchor, 20)
        const labelY = clamp(end.y - 11, 60, height - 20)
        elements.push(React.createElement('text', { key: `force-label-${force.id}`, x: labelX, y: labelY, textAnchor: anchor, fill: c.textPrimary, fontFamily: c.fontSans, fontSize: FONT_SIZE, fontWeight: 650 }, force.label))
    })
    if (showResultant && (resultant.x !== 0 || resultant.y !== 0)) {
        const end = mapVector(resultant.x, resultant.y)
        elements.push(arrow(center, end, c.positive, 'resultant', 4))
        const label = `R = ${formatNumber(resultant.magnitude)}`
        const direction = Math.sign(end.x - center.x) || 1
        const anchor = direction > 0 ? 'start' : 'end'
        elements.push(React.createElement('text', {
            key: 'resultant-label',
            x: boundedTextX(end.x + direction * 12, width, label, anchor, 20),
            y: clamp(end.y + 20, 60, height - 20),
            textAnchor: anchor,
            fill: c.positive,
            fontFamily: c.fontSans,
            fontSize: FONT_SIZE,
            fontWeight: 700,
        }, label))
    } else if (showResultant) {
        elements.push(React.createElement('text', { key: 'zero-resultant', x: center.x + 38, y: center.y + 38, fill: c.positive, fontFamily: c.fontSans, fontSize: FONT_SIZE, fontWeight: 700 }, 'R = 0'))
    }
    elements.push(
        React.createElement('text', { key: 'positive-x', x: width - 42, y: center.y - 8, textAnchor: 'end', fill: c.textMuted, fontFamily: c.fontMono, fontSize: 12 }, '+x'),
        React.createElement('text', { key: 'positive-y', x: center.x + 8, y: 72, fill: c.textMuted, fontFamily: c.fontMono, fontSize: 12 }, '+y'),
    )
    return svgShell({ c, width, height, title, ariaLabel, description: `${forces.length} physical force vectors use one scale. The resultant is the vector sum ${formatNumber(resultant.x)} x plus ${formatNumber(resultant.y)} y. The vertical axis points upward in physical coordinates.`, children: elements })
}

function arrow(start: { x: number; y: number }, end: { x: number; y: number }, color: string, key: string, strokeWidth: number): React.ReactElement {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    const head = Math.min(13, Math.max(6, length * 0.24))
    const angle = Math.atan2(dy, dx)
    const left = { x: end.x - head * Math.cos(angle - Math.PI / 6), y: end.y - head * Math.sin(angle - Math.PI / 6) }
    const right = { x: end.x - head * Math.cos(angle + Math.PI / 6), y: end.y - head * Math.sin(angle + Math.PI / 6) }
    return React.createElement('g', {
        key,
        'data-vector-role': key === 'resultant' ? 'resultant' : 'force',
        'data-vector-id': key.startsWith('force-') ? key.slice('force-'.length) : undefined,
    },
        React.createElement('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, stroke: color, strokeWidth, strokeLinecap: 'round' }),
        React.createElement('path', { d: `M ${left.x} ${left.y} L ${end.x} ${end.y} L ${right.x} ${right.y}`, fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    )
}

export interface Wave {
    amplitude: number
    wavelength: number
    phase?: number
    speed?: number
    color?: string
    label?: string
}

export interface WaveSample {
    x: number
    y: number
}

export interface WaveDiagramProps {
    c: ThemeColors
    waves: Wave[]
    time: number
    xMin: number
    xMax: number
    yMin?: number
    yMax?: number
    showComponents?: boolean
    showSum?: boolean
    probeX?: number
    sampleCount?: number
    title?: string
    ariaLabel?: string
    width?: number
    height?: number
}

function validateWave(wave: Wave, index: number, c?: ThemeColors): void {
    positive(wave.amplitude, `WaveDiagram wave ${index} amplitude`)
    positive(wave.wavelength, `WaveDiagram wave ${index} wavelength`)
    finite(wave.phase ?? 0, `WaveDiagram wave ${index} phase`)
    finite(wave.speed ?? 0, `WaveDiagram wave ${index} speed`)
    if (wave.label !== undefined) labelText(wave.label, `WaveDiagram wave ${index} label`, 22)
    if (c) colorValue(wave.color, c.secondary, `WaveDiagram wave ${index} color`)
}

export function waveValue(wave: Wave, x: number, time: number): number {
    validateWave(wave, 0)
    finite(x, 'WaveDiagram position')
    finite(time, 'WaveDiagram time')
    const phase = (2 * Math.PI * (x - (wave.speed ?? 0) * time)) / wave.wavelength + (wave.phase ?? 0)
    if (!Number.isFinite(phase)) throw new RangeError('WaveDiagram phase must remain finite.')
    const value = wave.amplitude * Math.sin(phase)
    if (!Number.isFinite(value)) throw new RangeError('WaveDiagram displacement must remain finite.')
    return value
}

export function sampleWave(wave: Wave, xMin: number, xMax: number, time: number, sampleCount = 192): WaveSample[] {
    const range = increasing(xMin, xMax, 'WaveDiagram x domain')
    finite(time, 'WaveDiagram time')
    if (!Number.isInteger(sampleCount) || sampleCount < 128 || sampleCount > 256) {
        throw new RangeError('WaveDiagram sample count must be an integer from 128 to 256.')
    }
    validateWave(wave, 0)
    return Array.from({ length: sampleCount }, (_, index) => {
        const x = xMin + range * index / (sampleCount - 1)
        return { x, y: waveValue(wave, x, time) }
    })
}

export function WaveDiagram({
    c,
    waves,
    time,
    xMin,
    xMax,
    yMin,
    yMax,
    showComponents = true,
    showSum = true,
    probeX,
    sampleCount = 192,
    title = 'Wave superposition',
    ariaLabel,
    width = 800,
    height = 440,
}: WaveDiagramProps): React.ReactElement {
    const xRange = increasing(xMin, xMax, 'WaveDiagram x domain')
    finite(time, 'WaveDiagram time')
    dimensions(width, height, 'WaveDiagram')
    labelText(title, 'WaveDiagram title', 32)
    bounded(waves, 8, 'WaveDiagram waves', 1)
    if (!Number.isInteger(sampleCount) || sampleCount < 128 || sampleCount > 256) {
        throw new RangeError('WaveDiagram sample count must be an integer from 128 to 256.')
    }
    if (!showComponents && !showSum) throw new RangeError('WaveDiagram must show component waves, their sum, or both.')
    waves.forEach((wave, index) => validateWave(wave, index, c))
    const componentBound = Math.max(...waves.map((wave) => wave.amplitude))
    const sumBound = waves.reduce((sum, wave) => sum + wave.amplitude, 0)
    if (!Number.isFinite(sumBound) || sumBound <= 0) throw new RangeError('WaveDiagram amplitude bound must be finite and positive.')
    const cycles = xRange / Math.min(...waves.map((wave) => wave.wavelength))
    if (!Number.isFinite(cycles) || cycles * 12 > sampleCount - 1) {
        throw new RangeError('WaveDiagram sample count must provide at least 12 samples per shortest wavelength.')
    }
    const requiredBound = showSum ? sumBound : showComponents ? componentBound : 0
    const resolvedYMin = yMin ?? -Math.max(1, requiredBound) * 1.08
    const resolvedYMax = yMax ?? Math.max(1, requiredBound) * 1.08
    const yRange = increasing(resolvedYMin, resolvedYMax, 'WaveDiagram y scale')
    if (showSum && (resolvedYMin > -sumBound || resolvedYMax < sumBound)) {
        throw new RangeError('WaveDiagram y scale must include the full possible sum amplitude to avoid clipping.')
    }
    if (showComponents && (resolvedYMin > -componentBound || resolvedYMax < componentBound)) {
        throw new RangeError('WaveDiagram y scale must include each full component amplitude to avoid clipping.')
    }
    if (probeX !== undefined) {
        finite(probeX, 'WaveDiagram probe position')
        if (probeX < xMin || probeX > xMax) throw new RangeError('WaveDiagram probe must lie within the x domain.')
        if (!showSum) throw new RangeError('WaveDiagram probe requires the summed curve to be visible.')
    }
    const samples = waves.map((wave) => sampleWave(wave, xMin, xMax, time, sampleCount))
    const sumSamples = Array.from({ length: sampleCount }, (_, index) => {
        const x = xMin + xRange * index / (sampleCount - 1)
        const y = waves.reduce((sum, wave) => sum + waveValue(wave, x, time), 0)
        if (!Number.isFinite(y) || y < resolvedYMin || y > resolvedYMax) throw new RangeError('WaveDiagram summed curve falls outside its y scale.')
        return { x, y }
    })
    const plot = { left: 70, right: width - 34, top: 136, bottom: height - 56 }
    const sx = (x: number) => plot.left + ((x - xMin) / xRange) * (plot.right - plot.left)
    const sy = (y: number) => plot.bottom - ((y - resolvedYMin) / yRange) * (plot.bottom - plot.top)
    const elements: React.ReactNode[] = []
    const gridCount = 4
    for (let index = 0; index <= gridCount; index++) {
        const xValue = xMin + xRange * index / gridCount
        const yValue = resolvedYMin + yRange * index / gridCount
        const gridX = sx(xValue)
        const gridY = sy(yValue)
        elements.push(
            React.createElement('line', { key: `grid-x-${index}`, x1: gridX, y1: plot.top, x2: gridX, y2: plot.bottom, stroke: c.borderSubtle, strokeWidth: 1 }),
            React.createElement('line', { key: `grid-y-${index}`, x1: plot.left, y1: gridY, x2: plot.right, y2: gridY, stroke: c.borderSubtle, strokeWidth: 1 }),
            React.createElement('text', { key: `x-label-${index}`, x: gridX, y: plot.bottom + 22, textAnchor: 'middle', fill: c.textMuted, fontFamily: c.fontMono, fontSize: 11 }, formatNumber(xValue)),
            React.createElement('text', { key: `y-label-${index}`, x: plot.left - 10, y: gridY + 4, textAnchor: 'end', fill: c.textMuted, fontFamily: c.fontMono, fontSize: 11 }, formatNumber(yValue)),
        )
    }
    elements.push(
        React.createElement('line', { key: 'x-axis', x1: plot.left, y1: sy(0), x2: plot.right, y2: sy(0), stroke: c.textSecondary, strokeWidth: 1.7 }),
        React.createElement('line', { key: 'y-axis', x1: plot.left, y1: plot.top, x2: plot.left, y2: plot.bottom, stroke: c.textSecondary, strokeWidth: 1.7 }),
        React.createElement('text', { key: 'axis-x-label', x: plot.right, y: height - 18, textAnchor: 'end', fill: c.textSecondary, fontFamily: c.fontSans, fontSize: 12 }, 'position x'),
        React.createElement('text', { key: 'axis-y-label', x: plot.left + 8, y: plot.top - 9, fill: c.textSecondary, fontFamily: c.fontSans, fontSize: 12 }, 'displacement y'),
        React.createElement('text', { key: 'time-label', x: 24, y: 60, fill: c.textSecondary, fontFamily: c.fontMono, fontSize: 12 }, `t = ${formatNumber(time)}`),
    )
    const pathFor = (points: readonly WaveSample[]) => points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${sx(point.x).toFixed(2)} ${sy(point.y).toFixed(2)}`).join(' ')
    if (showComponents) {
        samples.forEach((waveSamples, index) => {
            const wave = waves[index]
            const color = colorValue(wave.color, c.secondary, `WaveDiagram wave ${index} color`)
            elements.push(React.createElement('path', { key: `component-${index}`, d: pathFor(waveSamples), fill: 'none', stroke: color, strokeWidth: 2, opacity: showSum ? 0.68 : 1, strokeLinecap: 'round', strokeLinejoin: 'round' }))
        })
    }
    if (showSum) elements.push(React.createElement('path', { key: 'sum', d: pathFor(sumSamples), fill: 'none', stroke: c.textPrimary, strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    waves.forEach((wave, index) => {
        const label = wave.label ?? `wave ${index + 1}`
        const color = colorValue(wave.color, c.secondary, `WaveDiagram wave ${index} color`)
        const column = Math.floor(index / 4)
        const row = index % 4
        const legendX = plot.left + column * (plot.right - plot.left) / 2
        const legendY = plot.top - 58 + row * 14
        elements.push(React.createElement('text', {
            key: `legend-${index}`,
            x: boundedTextX(legendX, width, label, 'start', 20, 11),
            y: legendY,
            fill: color,
            fontFamily: c.fontSans,
            fontSize: 11,
            fontWeight: 650,
        }, label))
    })
    if (showSum) elements.push(React.createElement('text', { key: 'sum-legend', x: width - 24, y: 60, textAnchor: 'end', fill: c.textPrimary, fontFamily: c.fontSans, fontSize: 12, fontWeight: 750 }, 'sum'))
    if (probeX !== undefined) {
        const probeY = waves.reduce((sum, wave) => sum + waveValue(wave, probeX, time), 0)
        const probePosition = { x: sx(probeX), y: sy(probeY) }
        const label = `Σy = ${formatNumber(probeY)}`
        elements.push(
            React.createElement('line', { key: 'probe-line', x1: probePosition.x, y1: plot.top, x2: probePosition.x, y2: plot.bottom, stroke: c.warning, strokeWidth: 1.5, strokeDasharray: '5 5' }),
            React.createElement('circle', { key: 'probe-point', cx: probePosition.x, cy: probePosition.y, r: 6, fill: c.warning, stroke: c.bgCard, strokeWidth: 2 }),
            React.createElement('text', { key: 'probe-label', x: clamp(probePosition.x + 10, plot.left + 8, plot.right - textWidth(label)), y: clamp(probePosition.y - 12, plot.top + 40, plot.bottom - 10), fill: c.warning, fontFamily: c.fontSans, fontSize: 12, fontWeight: 650 }, label),
        )
    }
    const summary = waves.map((wave, index) => `${wave.label ?? `wave ${index + 1}`} (A=${formatNumber(wave.amplitude)}, λ=${formatNumber(wave.wavelength)}, φ=${formatNumber(wave.phase ?? 0)}, v=${formatNumber(wave.speed ?? 0)})`).join('; ')
    return svgShell({ c, width, height, title, ariaLabel, description: `At time ${formatNumber(time)}, each displacement follows y = A sin(2π(x − vt)/λ + φ). Signed component waves are ${summary}; their summed displacement is the pointwise sum. The fixed y scale is ${formatNumber(resolvedYMin)} to ${formatNumber(resolvedYMax)}.`, children: elements })
}
