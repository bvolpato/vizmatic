import { createTeachingCanvas, type TeachingPainter } from '../../src/teaching-canvas'
import { createTeachingVectorAccumulation, type WeightedVectorTerm } from '../../src/teaching-vector'
import type { CanvasBounds } from '../../src/canvas-components'

// A supplied two-coordinate EMA example, with beta=0.75.
const terms: readonly WeightedVectorTerm[] = [
    { id: 'retained-memory', label: 'Previous buffer', weight: 0.75,
        values: [8, 4], color: '#FFD75E' },
    { id: 'opposing-gradient', label: 'Current gradient', weight: 0.25,
        values: [-8, 8], color: '#FF8FC0' },
]

export function momentumAccumulationExampleState(seconds: number) {
    if (!Number.isFinite(seconds)) throw new Error('Example time must be finite')
    const phase = (start: number, end: number) => Math.max(0, Math.min(1, (seconds - start) / (end - start)))
    return {
        progress: 0.5 * phase(3, 6) + 0.5 * phase(8, 10),
        revealTotal: seconds >= 11,
        prediction: seconds < 8,
    }
}

/** Twelve seconds: predict, retain memory, hold, add the opposing gradient, then reveal. */
export function drawMomentumAccumulationExample<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>, seconds: number) {
    const state = momentumAccumulationExampleState(seconds)
    const teaching = createTeachingCanvas(painter)
    painter.text('Will a leftward gradient reverse the stored horizontal direction?', 100, 135, 40, '#F2EFE6')
    painter.text('A supplied EMA update: retain three quarters, then add one quarter of the new input.', 100, 225, 29, '#8D9CB9')
    const plot = teaching.axes({ x: 120, y: 315, width: 650, height: 650,
        xDomain: [-1, 9], yDomain: [-1, 9], equalUnits: true,
        xTicks: [0, 2, 4, 6, 8], yTicks: [0, 2, 4, 6, 8],
        xLabel: 'horizontal component', yLabel: 'vertical component',
        color: '#8D9CB9', fontSize: 24 })
    const accumulation = createTeachingVectorAccumulation(painter)({ terms, progress: state.progress, plot,
        ledger: { x: 970, y: 355, width: 820, height: 300 }, fontSize: 28,
        totalLabel: 'New EMA buffer', totalTarget: 'buffer-result', revealTotal: state.revealTotal,
        format: value => Number(value.toFixed(2)).toString() })
    const [retainedX, retainedY] = accumulation.state.terms[0].currentEnd
    const [incomingX, incomingY] = accumulation.state.terms[1].currentEnd
    const retainedTip = plot.point(retainedX, retainedY)
    const incomingTip = plot.point(incomingX, incomingY)
    if (state.progress > 0) painter.text('0.75 × (8, 4)', retainedTip.x + 25, retainedTip.y + 45, 30, '#FFD75E')
    if (seconds >= 8) painter.text('0.25 × (−8, 8)', incomingTip.x + 25, incomingTip.y - 45, 30, '#FF8FC0')
    if (state.revealTotal) {
        const origin = plot.point(0, 0)
        painter.arrow(origin.x, origin.y, accumulation.endpoint.x, accumulation.endpoint.y, '#63DEEC', 3)
        painter.text('The new horizontal component is +4.', 970, 750, 32, '#63DEEC')
        painter.text('The leftward input reduced +6 to +4.', 970, 815, 28, '#FF8FC0')
        painter.text('Stored direction persists while the path turns upward.', 970, 905, 28, '#F2EFE6')
    } else {
        painter.text(state.prediction ? 'Predict the sign before adding the incoming contribution.' : 'Check your predicted sign before we reveal the new buffer.',
            970, 800, 28, '#FFD75E')
    }
    return accumulation
}
