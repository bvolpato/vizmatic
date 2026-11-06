import type { CanvasPainter } from '../../src/canvas-components'
import { createTeachingTokenHistory, type TokenHistoryPhase } from '../../src/teaching-token-history'

// Vocabulary IDs can repeat; these IDs identify their immutable occurrences.
const prompt = [101, 102, 103].map((token, i) => ({ id: `prompt-${i}`, token }))
const accepted = [201, 202].map((token, i) => ({ id: `answer-${i}`, token }))
const retained = { prompt, accepted, processed: [...prompt, accepted[0]], emitted: accepted }

export function tokenHistoryExampleState(seconds: number) {
    if (!Number.isFinite(seconds)) throw new Error('Example time must be finite')
    const phase: TokenHistoryPhase = seconds < 3 ? 'resident' : seconds < 4 ? 'dropped' : seconds < 8 ? 'replay' : 'resident'
    return { phase, replayProgress: Math.max(0, Math.min(1, (seconds - 4) / 4)) }
}

/** Retire KV, rebuild four processed positions, and preserve both already delivered outputs. */
export function drawTokenHistoryExample<Shape>(painter: CanvasPainter<Shape>, seconds: number) {
    const state = tokenHistoryExampleState(seconds)
    painter.text('What survives when this request loses its KV cache?', 100, 135, 42, '#F2EFE6')
    painter.text('Outputs 201 and 202 were accepted and delivered; 202 has not yet been consumed.', 100, 230, 29, '#8D9CB9')
    const result = createTeachingTokenHistory(painter)({ ...retained, ...state,
        x: 100, y: 310, width: 1700, height: 620, fontSize: 30, focusPrefix: 'request-B' })
    painter.text(seconds >= 8
        ? 'Next ordinary input is 202. Replaying does not resample or resend 201 or 202.'
        : state.phase === 'replay' ? 'Rebuild 101, 102, 103, 201 in order; keep accepted history fixed.'
            : state.phase === 'dropped' ? 'The KV row is empty. The answer history is still present.'
                : 'Predict which ledger may be discarded, and which ones must be retained.',
    100, 1040, 30, '#FFD75E')
    return result
}
