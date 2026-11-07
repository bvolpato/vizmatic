import type { CanvasBounds } from 'vizmatic'
import type { TeachingPainter } from 'vizmatic'
import { createTeachingRoutedTransfer } from 'vizmatic'

/** A new parameter copy passes around three completed rank replicas. */
export function drawRoutedParameterBroadcast<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>, progress: number) {
    const cyan = '#63DEEC', blue = '#7FA8FF', ink = '#F2EFE6', panel = '#15171D'
    painter.text('Share B′ while completed replicas stay readable', 450, 45, 26, ink, 'center')
    const source = painter.rect(170, 90, 80, 70, panel, blue, 8)
    painter.text('B′', 210, 135, 28, blue, 'center')
    painter.text('Owner', 100, 135, 22, blue, 'center')
    const obstacles = [260, 370, 480].map((y, rank) => {
        const shape = painter.rect(170, y, 80, 70, panel, cyan, 8)
        painter.text('B′', 210, y + 45, 28, cyan, 'center')
        painter.text('Rank ' + rank, 95, y + 44, 22, ink, 'center')
        return { id: `settled-rank-${rank}-B`, bounds: shape }
    })
    const target = painter.rect(170, 600, 80, 70, panel, cyan, 8)
    painter.text('B′', 210, 645, 28, cyan, 'center')
    painter.text('Rank 3', 95, 645, 22, ink, 'center')
    const transfer = createTeachingRoutedTransfer(painter)({
        id: 'owner-B-to-rank-3', source: { id: 'owner-B', shape: source, opacity: 1, side: 'right' },
        target: { id: 'rank-3-B', shape: target, opacity: 1, side: 'right' },
        corridor: { x: 130, y: 65, width: 500, height: 630 }, obstacles,
        color: cyan, width: 4, margin: 6, progress,
        marker: { radius: 15, fill: blue, stroke: ink, strokeWidth: 2 },
    })
    painter.text('The complete marker clears each settled replica.', 460, 735, 23, ink, 'center')
    return transfer
}

export const routedParameterBroadcastExample = {
    width: 900, height: 780, durationSeconds: 4,
    draw: drawRoutedParameterBroadcast,
}
