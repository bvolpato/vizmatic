import type { CanvasBounds, CanvasPainter, CanvasPoint } from './canvas-components'

export interface TeachingFocusCue {
    id: string
    start: number
    targets: readonly string[]
    color: string
    active: boolean
    strength: number
    progress: number
    reveal: number
    phase: 'before' | 'during' | 'after'
}

export interface TeachingFocusPainter<Shape> extends CanvasPainter<Shape> {
    path(points: readonly CanvasPoint[], options?: { id?: string, color?: string, width?: number, clip?: CanvasBounds }): unknown
}

/** Join adjacent parts of one semantic subject, retaining spatially separate parts. */
export function mergeFocusRegions(parts: readonly CanvasBounds[], gap = 12): CanvasBounds[] {
    const regions: CanvasBounds[] = []
    for (const part of parts) {
        let current = { ...part }, index = 0
        while (index < regions.length) {
            const other = regions[index]
            if (current.x <= other.x + other.width + gap && other.x <= current.x + current.width + gap
                && current.y <= other.y + other.height + gap && other.y <= current.y + current.height + gap) {
                const x = Math.min(current.x, other.x), y = Math.min(current.y, other.y)
                current = { x, y, width: Math.max(current.x + current.width, other.x + other.width) - x,
                    height: Math.max(current.y + current.height, other.y + other.height) - y }
                regions.splice(index, 1); index = 0
            } else index++
        }
        regions.push(current)
    }
    return regions
}

/** A per-frame director. Host painters apply its opacity to each checked mark. */
export function createFocusDirector<Shape>(painter: CanvasPainter<Shape>, options: {
    cues?: Readonly<Record<string, TeachingFocusCue>>
    strict?: boolean
    contextOpacity?: number
    minimumContextAlpha?: number
} = {}) {
    const { cues, strict = false, contextOpacity = 0.52, minimumContextAlpha = 0 } = options
    if (!Number.isFinite(contextOpacity) || contextOpacity < 0 || contextOpacity > 1) throw new Error('Focus context opacity must be between zero and one')
    if (!Number.isFinite(minimumContextAlpha) || minimumContextAlpha < 0 || minimumContextAlpha > 1) throw new Error('Minimum context alpha must be between zero and one')
    const active = Object.values(cues ?? {}).filter(cue => cue.active && cue.strength > 0)
        .sort((a, b) => b.start - a.start || b.id.localeCompare(a.id))[0]
    const stack: string[] = []
    function cue(id: string) {
        const value = cues && Object.hasOwn(cues, id) ? cues[id] : undefined
        if (!value && strict) throw new Error(`Unknown narration cue: ${id}`)
        return value
    }
    function opacity<Result>(amount: number, draw: () => Result): Result {
        if (amount === 1) return draw()
        let result!: Result
        painter.opacity(amount, () => { result = draw() })
        return result
    }
    return {
        active,
        cue,
        progress(id: string, fallback = 0) { return cue(id)?.progress ?? fallback },
        visible(id: string) { return cue(id)?.phase !== 'before' },
        reveal<Result>(id: string, draw: () => Result): Result { return opacity(cue(id)?.reveal ?? 1, draw) },
        target<Result>(id: string, draw: () => Result): Result {
            stack.push(id)
            try { return draw() } finally { stack.pop() }
        },
        paint<Result>(draw: () => Result, originalAlpha = 1): Result {
            const focused = !active || stack.some(id => active.targets.includes(id))
            let amount = focused ? 1 : 1 - (1 - contextOpacity) * active.strength
            if (!focused && originalAlpha > 0) amount = Math.max(amount, Math.min(originalAlpha, minimumContextAlpha) / originalAlpha)
            return opacity(amount, draw)
        },
    }
}

export function createTeachingFocus<Shape>(painter: TeachingFocusPainter<Shape>) {
    function focusFrame(options: {
        bounds: CanvasBounds
        strength: number
        color?: string
        padding?: number
        clip?: CanvasBounds
        avoid?: readonly CanvasBounds[]
        id?: string
    }) {
        const { bounds, strength, color = '#63DEEC', padding = 8, clip } = options
        if (![bounds.x, bounds.y, bounds.width, bounds.height, strength, padding].every(Number.isFinite)
            || bounds.width <= 0 || bounds.height <= 0 || padding < 0 || strength < 0 || strength > 1) throw new Error('Invalid focus frame geometry or strength')
        if (strength === 0) return
        const corners = (offset: number) => {
            const x = bounds.x - offset, y = bounds.y - offset, w = bounds.width + offset * 2, h = bounds.height + offset * 2
            const corner = Math.min(24, w / 4, h / 4)
            return [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]
                .map(([cx, cy, sx, sy]) => [{ x: cx + sx * corner, y: cy }, { x: cx, y: cy }, { x: cx, y: cy + sy * corner }])
        }
        // Keep annotation ink clear of labels, including neighboring axis ticks.
        // If space is tight, brightness still provides focus without an outline.
        const clear = (points: CanvasPoint[]) => points.slice(1).every((point, index) => {
            const previous = points[index], x = Math.min(previous.x, point.x) - 2, y = Math.min(previous.y, point.y) - 2
            const right = Math.max(previous.x, point.x) + 2, bottom = Math.max(previous.y, point.y) + 2
            return (!clip || (x >= clip.x && y >= clip.y && right <= clip.x + clip.width && bottom <= clip.y + clip.height))
                && !(options.avoid ?? []).some(label => x < label.x + label.width && right > label.x && y < label.y + label.height && bottom > label.y)
        })
        let paths = corners(padding)
        if (!paths.every(clear)) {
            const alternatives = [padding + 6, padding + 12, padding + 20].map(corners)
            paths = alternatives.find(candidate => candidate.every(clear)) ?? paths.filter(clear)
        }
        if (paths.length < 2) return
        painter.opacity(strength * 0.7, () => {
            for (const [index, points] of paths.entries()) {
                painter.path(points, { id: options.id && `${options.id}:${index}`, color, width: 3, clip })
            }
        })
    }
    return { focusFrame }
}
