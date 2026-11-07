import type { CanvasBounds, CanvasPainter } from './canvas-components'

/** id identifies an occurrence; token is its vocabulary ID or displayed text. */
export interface HistoryToken {
    id: string
    token: string | number
}

export interface TokenHistorySnapshot {
    prompt: readonly HistoryToken[]
    accepted: readonly HistoryToken[]
    processed: readonly HistoryToken[]
    emitted: readonly HistoryToken[]
}

export type TokenHistoryPhase = 'resident' | 'dropped' | 'replay'

export interface TokenHistoryOptions extends TokenHistorySnapshot {
    phase?: TokenHistoryPhase
    /** Fraction of the retained processed prefix rebuilt, including a moving copy. */
    replayProgress?: number
}

export interface TokenHistoryState extends TokenHistorySnapshot {
    phase: TokenHistoryPhase
    replayProgress: number
    history: readonly HistoryToken[]
    kv: readonly HistoryToken[]
    pendingAccepted: readonly HistoryToken[]
    moving: { token: HistoryToken, position: number, progress: number } | null
}

function tokens(input: readonly HistoryToken[], name: string): readonly HistoryToken[] {
    if (!Array.isArray(input)) throw new Error(`Token history ${name} must be an array`)
    return Object.freeze(input.map(item => {
        if (!item || typeof item.id !== 'string' || !item.id.trim() || item.id !== item.id.trim()) {
            throw new Error('Token occurrence IDs must be nonempty without surrounding whitespace')
        }
        if (!(typeof item.token === 'string' && item.token.trim()) &&
            !(typeof item.token === 'number' && Number.isSafeInteger(item.token) && item.token >= 0)) {
            throw new Error('History tokens require nonempty text or a nonnegative safe integer vocabulary ID')
        }
        return Object.freeze({ id: item.id, token: item.token })
    }))
}

function equal(left: HistoryToken, right: HistoryToken): boolean {
    return left.id === right.id && left.token === right.token
}

function prefix(part: readonly HistoryToken[], whole: readonly HistoryToken[], name: string): void {
    if (part.length > whole.length || part.some((token, index) => !equal(token, whole[index]))) {
        throw new Error(`Token history ${name} must preserve the exact ordered occurrence prefix`)
    }
}

/** Ordinary autoregressive decoding: at most one accepted token awaits processing.
 * Pure frame sampling never creates accepted or emitted tokens; speculative verification needs a different contract. */
export function tokenHistoryState(options: TokenHistoryOptions): TokenHistoryState {
    const prompt = tokens(options.prompt, 'prompt'), accepted = tokens(options.accepted, 'accepted')
    const processed = tokens(options.processed, 'processed'), emitted = tokens(options.emitted, 'emitted')
    const history = Object.freeze([...prompt, ...accepted])
    if (new Set(history.map(token => token.id)).size !== history.length) {
        throw new Error('Token history requires distinct occurrence IDs, including repeated vocabulary tokens')
    }
    prefix(processed, history, 'processed')
    prefix(emitted, accepted, 'emitted')
    if (accepted.length && processed.length < prompt.length) throw new Error('Accepted output requires the complete processed prompt')
    if (accepted.length && processed.length < prompt.length + accepted.length - 1) {
        throw new Error('Ordinary decoding permits at most one accepted token awaiting processing')
    }
    const phase = options.phase ?? 'resident'
    if (!['resident', 'dropped', 'replay'].includes(phase)) throw new Error('Unknown token history phase')
    if (phase === 'replay' && options.replayProgress === undefined) throw new Error('Replay requires explicit progress')
    const replayProgress = options.replayProgress ?? 0
    if (!Number.isFinite(replayProgress) || replayProgress < 0 || replayProgress > 1) {
        throw new Error('Replay progress must be finite between zero and one')
    }
    const position = replayProgress * processed.length
    const completed = phase === 'resident' ? processed.length : phase === 'dropped' ? 0 : Math.floor(position)
    const fraction = position - Math.floor(position)
    const moving = phase === 'replay' && fraction > 0 && completed < processed.length
        ? Object.freeze({ token: processed[completed], position: completed, progress: fraction }) : null
    return Object.freeze({ prompt, accepted, processed, emitted, history, phase, replayProgress,
        kv: Object.freeze(processed.slice(0, completed)),
        pendingAccepted: Object.freeze(accepted.filter((_, index) => prompt.length + index >= processed.length)), moving })
}

/** Check authored transitions without introducing mutable render-time history. */
export function assertTokenHistoryTransition(before: TokenHistoryState, after: TokenHistoryState): void {
    before = tokenHistoryState(before)
    after = tokenHistoryState(after)
    prefix(before.prompt, after.prompt, 'prompt transition')
    if (before.prompt.length !== after.prompt.length) throw new Error('A request prompt cannot change during its history')
    prefix(before.accepted, after.accepted, 'accepted transition')
    prefix(before.emitted, after.emitted, 'emitted transition')
    if (before.phase !== 'resident' || after.phase !== 'resident') {
        if (before.accepted.length !== after.accepted.length || before.emitted.length !== after.emitted.length) {
            throw new Error('Drop and replay transitions cannot sample or emit new output')
        }
        prefix(before.processed, after.processed, 'replay target')
        if (before.processed.length !== after.processed.length) throw new Error('Replay must rebuild the retained processed prefix')
    } else if (after.processed.length < before.processed.length) {
        throw new Error('Resident processed history cannot shrink without an explicit drop or replay')
    }
}

export type TokenHistoryLane = 'prompt' | 'accepted' | 'processed' | 'kv' | 'emitted'

export interface TeachingTokenHistoryOptions extends TokenHistoryOptions, CanvasBounds {
    labelWidth?: number
    fontSize?: number
    gap?: number
    focusPrefix?: string
    colors?: Partial<Record<TokenHistoryLane | 'pending' | 'empty' | 'text' | 'fill', string>>
}

/** Synchronized occurrence columns preserve identity while a copy moves from processed history into KV. */
export function createTeachingTokenHistory<Shape>(painter: CanvasPainter<Shape>) {
    return (options: TeachingTokenHistoryOptions): TokenHistoryState => {
        const state = tokenHistoryState(options)
        const { x, y, width, height, fontSize = 28, gap = 8, labelWidth = 245, focusPrefix } = options
        if (![x, y, x + width, y + height, width, height, fontSize, gap, labelWidth].every(Number.isFinite) ||
            width <= 0 || height <= 0 || fontSize <= 0 || gap < 0 || labelWidth <= 0) {
            throw new Error('Token history drawing bounds and sizes must be finite and positive')
        }
        const columns = Math.max(1, state.history.length), top = fontSize * 1.9, bottom = fontSize * 2
        const cellWidth = (width - labelWidth - gap * (columns - 1) - 4) / columns
        const laneHeight = (height - top - bottom) / 5, cellHeight = laneHeight - gap
        if (cellWidth < fontSize * 2.2 || cellHeight < fontSize * 1.6 || labelWidth < fontSize * 5) {
            throw new Error('Token history bounds must fit its occurrence columns and five readable lanes')
        }
        const color = { prompt: '#7FA7FF', accepted: '#92E28C', processed: '#63DEEC', kv: '#63DEEC',
            emitted: '#92E28C', pending: '#FFD75E', empty: '#586278', text: '#F2EFE6', fill: '#141820', ...options.colors }
        const lanes: { id: TokenHistoryLane, label: string, tokens: readonly HistoryToken[], offset: number }[] = [
            { id: 'prompt', label: 'Prompt', tokens: state.prompt, offset: 0 },
            { id: 'accepted', label: 'Accepted output', tokens: state.accepted, offset: state.prompt.length },
            { id: 'processed', label: 'Processed prefix', tokens: state.processed, offset: 0 },
            { id: 'kv', label: 'Resident KV', tokens: state.kv, offset: 0 },
            { id: 'emitted', label: 'Already delivered', tokens: state.emitted, offset: state.prompt.length },
        ]
        const pending = new Set(state.pendingAccepted.map(token => token.id))
        const bounds = { x, y, width, height }
        const target = (id: string | undefined, draw: () => void) => {
            if (id && painter.target) painter.target(id, draw)
            else draw()
        }
        const cell = (position: number, row: number): CanvasBounds => ({
            x: x + labelWidth + 1 + position * (cellWidth + gap), y: y + top + row * laneHeight,
            width: cellWidth, height: cellHeight,
        })
        const paintToken = (token: HistoryToken, shape: CanvasBounds, stroke: string, fill = color.fill) => {
            painter.rect(shape.x, shape.y, shape.width, shape.height, fill, stroke, 7)
            painter.labelScope(shape, () => painter.text(String(token.token), shape.x + shape.width / 2,
                shape.y + shape.height / 2 + fontSize * 0.34, fontSize, color.text, 'center', 'mono'), { padding: 5 })
        }
        painter.container(bounds, () => {
            for (let position = 0; position < state.history.length; position += 1) {
                const shape = cell(position, 0)
                painter.labelScope({ ...shape, y, height: top }, () => painter.text(`position ${position}`,
                    shape.x + shape.width / 2, y + fontSize, fontSize * 0.7, color.empty, 'center'), { padding: 3 })
            }
            lanes.forEach((lane, row) => target(focusPrefix ? `${focusPrefix}-${lane.id}` : undefined, () => {
                const labelBounds = { x, y: y + top + row * laneHeight, width: labelWidth - gap, height: cellHeight }
                painter.labelScope(labelBounds, () => painter.text(lane.label, x + 5,
                    labelBounds.y + cellHeight / 2 + fontSize * 0.34, fontSize * 0.82, color[lane.id]), { padding: 3 })
                for (let position = 0; position < columns; position += 1) {
                    const shape = cell(position, row), token = lane.tokens[position - lane.offset]
                    if (token) {
                        const isPending = lane.id === 'accepted' && pending.has(token.id)
                        target(isPending && focusPrefix ? `${focusPrefix}-pending` : undefined,
                            () => paintToken(token, shape, isPending ? color.pending : color[lane.id], lane.id === 'processed' ? 'transparent' : color.fill))
                    } else painter.rect(shape.x, shape.y, shape.width, shape.height, 'transparent', color.empty, 7)
                }
            }))
            if (state.moving) {
                const from = cell(state.moving.position, 2), to = cell(state.moving.position, 3)
                const progress = state.moving.progress
                const settle = Math.max(0, (progress - 0.65) / 0.35)
                const grow = Math.max(0, (progress - 0.8) / 0.2)
                const measuredWidth = painter.measureText?.(String(state.moving.token.token), fontSize, 'mono')
                if (measuredWidth !== undefined && (!Number.isFinite(measuredWidth) || measuredWidth < 0)) {
                    throw new Error('Token history measured text width must be finite and nonnegative')
                }
                const copyWidth = Math.min(from.width, Math.max(fontSize * 3,
                    measuredWidth === undefined ? from.width : measuredWidth + 10))
                const copyHeight = Math.min(from.height, fontSize * 1.8)
                const movingWidth = copyWidth + (from.width - copyWidth) * grow
                const movingHeight = copyHeight + (from.height - copyHeight) * grow
                const startInset = Math.min(7, from.width - copyWidth)
                const startCenterX = from.x + startInset + copyWidth / 2
                const centerX = startCenterX + (from.x + from.width / 2 - startCenterX) * settle
                const centerY = from.y + from.height / 2 + (to.y - from.y) * progress
                const moving = { x: centerX - movingWidth / 2, y: centerY - movingHeight / 2, width: movingWidth, height: movingHeight }
                target(focusPrefix ? `${focusPrefix}-replay` : undefined, () => paintToken(state.moving!.token, moving, color.kv))
            }
            const pendingText = state.pendingAccepted.map(token => String(token.token)).join(', ')
            const message = state.phase === 'replay' ? 'Replay rebuilds KV; no sampling or delivery'
                : state.phase === 'dropped' ? 'KV released; accepted and delivered history retained'
                    : pendingText ? `Accepted but unprocessed: ${pendingText}` : 'All accepted positions are processed'
            painter.labelScope({ x, y: y + height - bottom, width, height: bottom }, () => painter.text(message,
                x + width / 2, y + height - fontSize * 0.6, fontSize * 0.82,
                state.phase === 'replay' ? color.kv : color.pending, 'center'), { padding: 3 })
        }, { padding: 0 })
        return state
    }
}
