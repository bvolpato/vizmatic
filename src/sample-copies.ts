import type { CanvasPoint } from './canvas-components'

export interface SampleSource extends CanvasPoint {
    id: string
}

export interface SampleDestination extends CanvasPoint {
    sourceId: string
}

export interface SampleCopy extends SampleDestination {
    /** Zero-based position in the supplied draw sequence. */
    drawIndex: number
    /** How many times this source has appeared, including this draw. */
    occurrence: number
    /** Fraction of the path from the fixed source to this destination. */
    progress: number
}

/** Animate copies of named items along an explicit draw sequence. */
export function planSampleCopies(sources: readonly SampleSource[], destinations: readonly SampleDestination[]) {
    const positions = new Map<string, CanvasPoint>()
    const checkPoint = (point: CanvasPoint) => {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Sample coordinates must be finite')
    }
    for (const source of sources) {
        if (!source.id.trim() || positions.has(source.id)) throw new Error('Sample sources require unique, nonempty IDs')
        checkPoint(source)
        positions.set(source.id, { x: source.x, y: source.y })
    }
    const counts = new Map<string, number>()
    const draws = destinations.map(({ sourceId, x, y }) => {
        const source = positions.get(sourceId)
        if (!source) throw new Error(`Unknown sample source: ${sourceId}`)
        checkPoint({ x, y })
        const occurrence = (counts.get(sourceId) ?? 0) + 1
        counts.set(sourceId, occurrence)
        return { sourceId, source, x, y, occurrence }
    })

    return {
        /** At 1.5 draws, the first copy is in its slot and the next is halfway there. */
        at(drawCount: number): SampleCopy[] {
            if (!Number.isFinite(drawCount)) throw new Error('Sample draw count must be finite')
            const count = Math.max(0, Math.min(draws.length, drawCount))
            return draws.slice(0, Math.ceil(count)).map((draw, drawIndex) => {
                const progress = Math.min(1, count - drawIndex)
                return {
                    sourceId: draw.sourceId, drawIndex, occurrence: draw.occurrence, progress,
                    x: (1 - progress) * draw.source.x + progress * draw.x,
                    y: (1 - progress) * draw.source.y + progress * draw.y,
                }
            })
        },
    }
}
