import type { CanvasBounds } from './canvas-components'
import type { TeachingPainter } from './teaching-canvas'

const COLORS = ['#63DEEC', '#79A6FF', '#D6A0FF', '#FFCE73']

export interface AllocationPart { id: string, label: string, value: number, color?: string, focusTarget?: string }
export interface AllocationLayoutOptions extends CanvasBounds { capacity: number, parts: readonly AllocationPart[] }
export interface AllocationLayout {
    bounds: CanvasBounds
    used: number
    remaining: number
    parts: { id: string, value: number, bounds: CanvasBounds }[]
    freeBounds: CanvasBounds
}
export interface TeachingAllocationOptions extends AllocationLayoutOptions {
    freeFocusTarget?: string
    fontSize?: number
    unit?: string
    format?: (value: number) => string
    color?: string
    trackColor?: string
}

/** Capacity-scaled partitions; unused capacity is preserved rather than normalized away. */
export function layoutAllocation(options: AllocationLayoutOptions): AllocationLayout {
    const { x, y, width, height, capacity, parts } = options
    if (![x, y, x + width, y + height, capacity].every(Number.isFinite) || width <= 0 || height <= 0 || capacity <= 0) throw new Error('Allocation needs finite positive bounds and capacity')
    const ids = new Set<string>()
    let used = 0
    for (const part of parts) {
        if (!part.id || ids.has(part.id)) throw new Error('Allocation part IDs must be nonempty and unique')
        ids.add(part.id)
        if (!Number.isFinite(part.value) || part.value < 0) throw new Error('Allocation values must be finite and nonnegative')
        used += part.value
    }
    if (!Number.isFinite(used) || used - capacity > Number.EPSILON * Math.max(used, capacity) * 8) throw new Error('Allocation exceeds capacity')
    used = Math.min(used, capacity)
    let offset = 0
    const segments = parts.map(part => {
        const start = Math.min(offset, capacity); offset += part.value
        return { id: part.id, value: part.value, bounds: { x: x + width * (start / capacity), y, width: width * ((Math.min(offset, capacity) - start) / capacity), height } }
    })
    const remaining = Math.max(0, capacity - used)
    return { bounds: { x, y, width, height }, used, remaining, parts: segments, freeBounds: { x: x + width * (used / capacity), y, width: width * (remaining / capacity), height } }
}

export function createTeachingAllocation<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>) {
    const target = <Result>(id: string | undefined, draw: () => Result): Result => id && painter.target ? painter.target(id, draw) : draw()
    return (options: TeachingAllocationOptions): AllocationLayout & { shapes: (Shape | null)[], shape: Shape } => {
        const { x, y, width, height, fontSize = 28, unit = '', format = String, color = '#8D9CB9', trackColor = '#18283B' } = options
        if (!Number.isFinite(fontSize) || fontSize <= 0) throw new Error('Allocation font size must be finite and positive')
        const header = fontSize * 1.7, barHeight = fontSize * 2, rowHeight = fontSize * 1.65, gap = fontSize * .6
        if (height < header + barHeight + gap + (options.parts.length + 1) * rowHeight || width <= 6 || width * .67 <= fontSize) throw new Error('Allocation bounds cannot fit the strip and ledger')
        const layout = layoutAllocation({ ...options, x: x + 3, y: y + header + 3, width: width - 6, height: barHeight - 6 })
        const suffix = unit ? ` ${unit}` : '', shapes: (Shape | null)[] = []
        let shape!: Shape
        painter.container({ x, y, width, height }, () => {
            painter.labelScope({ x, y, width, height: header }, () => painter.text(`Used ${format(layout.used)} / ${format(options.capacity)}${suffix}`, x, y + fontSize, fontSize, color, 'left'), { padding: 0 })
            const strip = { x: x + 1, y: y + header + 1, width: width - 2, height: barHeight - 2 }
            shape = painter.rect(strip.x, strip.y, strip.width, strip.height, trackColor, color, 0)
            painter.container(strip, () => {
                layout.parts.forEach((part, index) => shapes.push(part.bounds.width === 0 ? null : target(options.parts[index].focusTarget, () => painter.rect(part.bounds.x, part.bounds.y, part.bounds.width, part.bounds.height, options.parts[index].color ?? COLORS[index % COLORS.length], undefined, 0))))
            }, { padding: 0 })
            const rows = [...options.parts, { id: 'free', label: 'Free', value: layout.remaining, color, focusTarget: options.freeFocusTarget }]
            rows.forEach((part, index) => target(part.focusTarget, () => {
                const top = y + header + barHeight + gap + index * rowHeight, baseline = top + rowHeight / 2 + fontSize * .34
                painter.rect(x, top + (rowHeight - fontSize * .6) / 2, fontSize * .6, fontSize * .6, part.color ?? COLORS[index % COLORS.length], undefined, 0)
                painter.labelScope({ x: x + fontSize, y: top, width: width * .67 - fontSize, height: rowHeight }, () => painter.text(part.label, x + fontSize, baseline, fontSize, color, 'left'), { padding: 0 })
                painter.labelScope({ x: x + width * .7, y: top, width: width * .3, height: rowHeight }, () => painter.text(`${format(part.value)}${suffix}`, x + width, baseline, fontSize, color, 'right'), { padding: 0 })
            }))
        }, { padding: 0 })
        return { ...layout, shapes, shape }
    }
}
