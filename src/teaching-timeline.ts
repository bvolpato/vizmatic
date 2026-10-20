import type { CanvasBounds } from './canvas-components'
import type { TeachingPainter } from './teaching-canvas'

export interface TeachingTimeLane { id: string, label: string }
export interface TeachingTimeInterval {
    id: string
    lane: string
    start: number
    end: number
    label?: string
    color?: string
    opacity?: number
}
export interface TeachingTimelineOptions extends CanvasBounds {
    domain: readonly [number, number]
    lanes: readonly TeachingTimeLane[]
    intervals: readonly TeachingTimeInterval[]
    time?: number
    ticks?: readonly number[]
    formatTime?: (value: number) => string
    labelWidth?: number
    laneGap?: number
    fontSize?: number
    color?: string
    trackColor?: string
    cursorColor?: string
}
export interface TeachingTimelineInterval<Shape> {
    id: string
    shape: Shape | null
    bounds: CanvasBounds
    elapsed: number
    opacity: number
    complete: boolean
}
export interface TeachingTimelineResult<Shape> {
    bounds: CanvasBounds
    time: number
    point(time: number): number
    lanes: Record<string, { shape: Shape, bounds: CanvasBounds }>
    intervals: Record<string, TeachingTimelineInterval<Shape>>
}

/** A supplied event trace; a single current time governs all interval lengths. */
export function createTeachingTimeline<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>) {
    return (options: TeachingTimelineOptions): TeachingTimelineResult<Shape> => {
        const { x, y, width, height, domain: [lo, hi], lanes, intervals,
            time = hi, ticks = [lo, hi], formatTime = String, labelWidth = 180, laneGap = 18,
            fontSize = 28, color = '#8D9CB9', trackColor = '#18283B', cursorColor = '#FFCE73' } = options
        if (![x, y, x + width, y + height, lo, hi, hi - lo, time, labelWidth, laneGap, fontSize].every(Number.isFinite)) throw new Error('Timeline values must be finite')
        if (width <= 0 || height <= 0 || hi <= lo || time < lo || time > hi) throw new Error('Timeline needs positive bounds and a current time inside its increasing domain')
        if (fontSize <= 0 || labelWidth <= 12 || labelWidth >= width - 6 || laneGap < 0 || !lanes.length) throw new Error('Timeline needs positive label space, font size, and at least one lane')
        const ids = new Set(lanes.map(lane => lane.id))
        if (ids.size !== lanes.length || lanes.some(lane => !lane.id)) throw new Error('Timeline lane IDs must be nonempty and unique')
        const intervalIds = new Set<string>()
        for (const interval of intervals) {
            if (!interval.id || intervalIds.has(interval.id) || !ids.has(interval.lane)) throw new Error('Timeline intervals need unique IDs and an existing lane')
            intervalIds.add(interval.id)
            if (![interval.start, interval.end, interval.opacity ?? 1].every(Number.isFinite) || interval.start < lo || interval.end > hi || interval.end <= interval.start) throw new Error('Timeline intervals must have finite positive durations inside the domain')
        }
        for (const lane of lanes) {
            const ordered = intervals.filter(interval => interval.lane === lane.id).sort((a, b) => a.start - b.start)
            if (ordered.some((interval, i) => i > 0 && interval.start < ordered[i - 1].end)) throw new Error(`Timeline intervals overlap in lane ${lane.id}; use separate lanes for concurrent work`)
        }
        if (ticks.some(tick => !Number.isFinite(tick) || tick < lo || tick > hi)) throw new Error('Timeline ticks must lie inside the domain')
        const axisHeight = Math.max(36, fontSize * 2 + 18)
        const laneHeight = (height - axisHeight - (lanes.length - 1) * laneGap) / lanes.length
        const labelHeight = fontSize * 1.5, barHeight = laneHeight - labelHeight
        if (barHeight < 12) throw new Error('Timeline height cannot fit lane labels and interval bars')
        const left = x + labelWidth + 3, plotWidth = width - labelWidth - 6
        const point = (value: number) => {
            if (!Number.isFinite(value) || value < lo || value > hi) throw new Error('Timeline point must lie inside the domain')
            return left + (value - lo) / (hi - lo) * plotWidth
        }
        const bounds = { x, y, width, height }
        const result: TeachingTimelineResult<Shape> = { bounds, time, point, lanes: Object.create(null), intervals: Object.create(null) }
        painter.container(bounds, () => {
            lanes.forEach((lane, index) => {
                const top = y + index * (laneHeight + laneGap)
                const track = { x: left - 2, y: top + labelHeight, width: plotWidth + 4, height: barHeight }
                const shape = painter.rect(track.x, track.y, track.width, track.height, trackColor, color, 0)
                result.lanes[lane.id] = { shape, bounds: track }
                painter.labelScope({ x, y: top, width: labelWidth - 12, height: laneHeight }, () => {
                    painter.text(lane.label, x, top + laneHeight / 2 + fontSize * .34, fontSize, color, 'left')
                }, { padding: 0 })
                for (const interval of intervals.filter(item => item.lane === lane.id)) {
                    const visibleEnd = Math.max(interval.start, Math.min(time, interval.end))
                    const elapsed = visibleEnd - interval.start
                    const bar = { x: point(interval.start), y: track.y + 2, width: point(visibleEnd) - point(interval.start), height: barHeight - 4 }
                    const opacity = Math.max(0, Math.min(1, interval.opacity ?? 1))
                    const item: TeachingTimelineInterval<Shape> = { id: interval.id, shape: null, bounds: bar, elapsed, opacity, complete: time >= interval.end }
                    result.intervals[interval.id] = item
                    if (elapsed === 0 || opacity === 0) continue
                    painter.opacity(opacity, () => {
                        painter.container(track, () => { item.shape = painter.rect(bar.x, bar.y, bar.width, bar.height, interval.color ?? '#63DEEC', undefined, 0) }, { padding: 0 })
                        if (interval.label) {
                            const labelBounds = { x: point(interval.start), y: top, width: point(interval.end) - point(interval.start), height: labelHeight }
                            painter.labelScope(labelBounds, () => painter.text(interval.label!, labelBounds.x + labelBounds.width / 2, top + fontSize, fontSize, interval.color ?? '#63DEEC', 'center'), { padding: 2 })
                        }
                    })
                }
            })
            const axisY = y + height - axisHeight + Math.max(10, fontSize * .5)
            painter.line(left, axisY, left + plotWidth, axisY, color, 2)
            for (const tick of ticks) {
                const px = point(tick)
                painter.line(px, axisY, px, axisY + 6, color, 2)
                painter.labelScope({ x: left - labelWidth, y: axisY + 8, width: plotWidth + labelWidth, height: fontSize * 1.5 }, () => {
                    painter.text(formatTime(tick), px, axisY + fontSize * 1.4, fontSize, color, tick === hi ? 'right' : tick === lo ? 'left' : 'center')
                }, { padding: 0 })
            }
            painter.line(point(time), axisY - 8, point(time), axisY + 8, cursorColor, 3)
        }, { padding: 0 })
        return result
    }
}
