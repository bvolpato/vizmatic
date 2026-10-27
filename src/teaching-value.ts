import type { CanvasBounds, CanvasPainter } from './canvas-components'

export interface ValueChangeOptions {
    from: number
    to: number
    progress: number
    /** Override the envelope while an accelerated sequence remains in motion. */
    emphasis?: number
}

export interface ValueChangeState {
    value: number
    previous: number
    target: number
    delta: number
    changed: boolean
    emphasis: number
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => value * value * (3 - 2 * value)

/** Sample an update without retaining state from a previously rendered frame. */
export function valueChangeState(options: ValueChangeOptions): ValueChangeState {
    for (const name of ['from', 'to', 'progress'] as const) {
        if (!Number.isFinite(options[name])) throw new Error(`Value change ${name} must be finite`)
    }
    if (options.emphasis !== undefined && !Number.isFinite(options.emphasis)) throw new Error('Value change emphasis must be finite')
    const { from, to } = options
    const progress = clamp(options.progress)
    const changed = from !== to
    const emphasis = changed ? clamp(options.emphasis ?? (
        smooth(clamp(progress / 0.12)) * (1 - smooth(clamp((progress - 0.65) / 0.35)))
    )) : 0
    const value = from * (1 - progress) + to * progress
    const delta = to - from
    if (!Number.isFinite(value) || !Number.isFinite(delta)) throw new Error('Value change result must be finite')
    return { value, previous: from, target: to, delta, changed, emphasis }
}

export interface TeachingChangeCueOptions extends CanvasBounds, ValueChangeOptions {
    color?: string
    restColor?: string
    fill?: string
}

export interface TeachingValueChangeOptions extends TeachingChangeCueOptions {
    label?: string
    format?: (value: number) => string
    fontSize?: number
    showDelta?: boolean
}

export function createTeachingValueChange<Shape>(painter: CanvasPainter<Shape>) {
    function changeCue(options: TeachingChangeCueOptions, draw?: (state: ValueChangeState & { color: string }) => void) {
        const { x, y, width, height, color = '#F4D477', restColor = '#E9EFFF', fill = color, radius = 10 } = options
        if (![x, y, width, height, radius].every(Number.isFinite) || width <= 0 || height <= 0 || radius < 0) {
            throw new Error('Value change bounds must be finite with positive dimensions and nonnegative radius')
        }
        const state = valueChangeState({ from: options.from, to: options.to, progress: options.progress, ...(options.emphasis === undefined ? {} : { emphasis: options.emphasis }) })
        if (state.emphasis > 0) {
            painter.opacity(state.emphasis * 0.12, () => painter.rect(x, y, width, height, fill, undefined, radius))
            painter.opacity(state.emphasis, () => painter.rect(x, y, width, height, 'transparent', color, radius))
        }
        const result = { ...state, color: state.emphasis > 0 ? color : restColor }
        draw?.(result)
        return result
    }

    function valueChange(options: TeachingValueChangeOptions) {
        const { x, y, width, height, label, format = (value: number) => value.toFixed(1), fontSize = 36, showDelta = true } = options
        if (!Number.isFinite(fontSize) || fontSize <= 0) throw new Error('Value change font size must be positive')
        const lines = 1 + Number(Boolean(label)) + Number(showDelta)
        if (height < fontSize * (lines === 1 ? 1.4 : lines === 2 ? 2.3 : 3)) throw new Error('Value change height must contain its label and delta')
        return changeCue(options, (state) => painter.labelScope({x, y, width, height}, () => {
            const center = x + width / 2
            if (label) painter.text(label, center, y + fontSize * 0.7, fontSize * 0.55, options.restColor ?? '#E9EFFF', 'center')
            const baseline = label
                ? y + height * (showDelta ? 0.5 : 0.65) + fontSize * 0.2
                : showDelta ? y + fontSize * 1.05 : y + height / 2 + fontSize * 0.34
            painter.text(format(state.value), center, baseline, fontSize, state.color, 'center', 'mono')
            if (showDelta) {
                const sign = state.delta > 0 ? '+' : ''
                painter.text(`${format(state.previous)} → ${format(state.target)}  ·  Δ ${sign}${format(state.delta)}`,
                    center, y + height - fontSize * 0.3, fontSize * 0.46, options.restColor ?? '#E9EFFF', 'center', 'mono')
            }
        }, {padding: 4}))
    }

    return { changeCue, valueChange }
}
