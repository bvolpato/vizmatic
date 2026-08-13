import type { ReactNode } from 'react'

export type AnimationEasingName = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
export type AnimationEasing = AnimationEasingName | ((progress: number) => number)
export type AnimationInterpolator<T> = {
    bivarianceHack(from: T, to: T, progress: number): T
}['bivarianceHack']

export interface AnimationHoldStep {
    type: 'hold'
    duration: number
    label?: string
}

export interface AnimationKeyframeStep<T> {
    type: 'keyframe'
    value: T
    label?: string
}

export interface AnimationTweenStep<T> {
    type: 'tween'
    to: T
    duration: number
    easing?: AnimationEasing
    interpolate?: AnimationInterpolator<T>
    label?: string
}

export type AnimationPropertyStep<T> =
    | AnimationHoldStep
    | AnimationKeyframeStep<T>
    | AnimationTweenStep<T>

export type AnimationParallelTracks<S extends object> = {
    [K in keyof S]?: readonly AnimationPropertyStep<S[K]>[]
}

export interface AnimationParallelStep<S extends object> {
    type: 'parallel'
    tracks: AnimationParallelTracks<S>
    label?: string
}

export type AnimationTimelineStep<S extends object> =
    | AnimationHoldStep
    | AnimationKeyframeStep<Partial<S>>
    | AnimationTweenStep<Partial<S>>
    | AnimationParallelStep<S>

export interface AnimationFrameContext {
    index: number
    count: number
    time: number
    duration: number
    delay: number
    progress: number
    step: number
    stepProgress: number
    label?: string
    fps: number
}

export interface AnimationDefinition<S extends object> {
    initial: S
    timeline: readonly AnimationTimelineStep<S>[]
    render: (state: Readonly<S>, frame: Readonly<AnimationFrameContext>) => ReactNode
    fps?: number
}

export interface DefinedAnimation<S extends object> extends AnimationDefinition<S> {
    readonly kind: 'vizmatic.animation'
    readonly duration: number
    readonly fps: number
}

export interface SampleAnimationOptions {
    fps?: number
}

export interface SampledAnimationFrame<S extends object> {
    state: Readonly<S>
    frame: Readonly<AnimationFrameContext>
}

export interface AnimationCadenceAnalysis {
    fps: number
    duration: number
    frameCount: number
    encodedDuration: number
    targetInterval: number
    minDelay: number
    maxDelay: number
}

interface EvaluatedAnimationState<S extends object> {
    state: S
    step: number
    stepProgress: number
    label?: string
}

const MIN_FPS = 1
const MAX_FPS = 50
const DEFAULT_FPS = 20

function assertDuration(duration: number, context: string): void {
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`${context} duration must be a positive finite number`)
    }
}

function assertFps(fps: number): void {
    if (!Number.isFinite(fps) || !Number.isInteger(fps) || fps < MIN_FPS || fps > MAX_FPS) {
        throw new Error(`Animation fps must be an integer from ${MIN_FPS} to ${MAX_FPS}`)
    }
}

function clampProgress(progress: number): number {
    return Math.max(0, Math.min(1, progress))
}

function easingValue(easing: AnimationEasing = 'linear', progress: number): number {
    const amount = clampProgress(progress)
    let result: number

    if (typeof easing === 'function') {
        result = easing(amount)
    } else if (easing === 'ease-in') {
        result = amount * amount * amount
    } else if (easing === 'ease-out') {
        result = 1 - (1 - amount) ** 3
    } else if (easing === 'ease-in-out') {
        result = amount < 0.5
            ? 4 * amount * amount * amount
            : 1 - ((-2 * amount + 2) ** 3) / 2
    } else if (easing === 'linear') {
        result = amount
    } else {
        throw new Error(`Unknown animation easing: ${String(easing)}`)
    }

    if (!Number.isFinite(result)) throw new Error('Animation easing must return a finite number')
    return clampProgress(result)
}

export function hold(duration: number, label?: string): AnimationHoldStep {
    return { type: 'hold', duration, label }
}

export function keyframe<T>(value: T, label?: string): AnimationKeyframeStep<T> {
    return { type: 'keyframe', value, label }
}

export function tween<T>(
    to: T,
    options: Omit<AnimationTweenStep<T>, 'type' | 'to'>,
): AnimationTweenStep<T> {
    return { type: 'tween', to, ...options }
}

export function parallel<S extends object>(
    tracks: AnimationParallelTracks<S>,
    label?: string,
): AnimationParallelStep<S> {
    return { type: 'parallel', tracks, label }
}

function propertyStepDuration<T>(step: AnimationPropertyStep<T>): number {
    return step.type === 'keyframe' ? 0 : step.duration
}

function parallelDuration<S extends object>(step: AnimationParallelStep<S>): number {
    return Math.max(0, ...Object.values(step.tracks).map((track) =>
        (track as readonly AnimationPropertyStep<unknown>[] | undefined)
            ?.reduce((total, item) => total + propertyStepDuration(item), 0) ?? 0))
}

function timelineStepDuration<S extends object>(step: AnimationTimelineStep<S>): number {
    if (step.type === 'keyframe') return 0
    if (step.type === 'parallel') return parallelDuration(step)
    return step.duration
}

function validatePropertySteps<T>(steps: readonly AnimationPropertyStep<T>[], context: string): void {
    for (const step of steps) {
        if (step.type !== 'keyframe') assertDuration(step.duration, context)
        if (step.type === 'tween') easingValue(step.easing, 0.5)
    }
}

function validateTimeline<S extends object>(timeline: readonly AnimationTimelineStep<S>[]): number {
    if (timeline.length === 0) throw new Error('Animation timeline requires at least one step')

    let duration = 0
    timeline.forEach((step, index) => {
        if (step.type === 'parallel') {
            const tracks = Object.entries(step.tracks)
            if (tracks.length === 0) throw new Error(`Animation parallel step ${index} requires at least one track`)
            tracks.forEach(([name, track]) => {
                if (!track) return
                validatePropertySteps(
                    track as readonly AnimationPropertyStep<unknown>[],
                    `Animation parallel track ${JSON.stringify(name)}`,
                )
            })
            assertDuration(parallelDuration(step), `Animation parallel step ${index}`)
        } else if (step.type !== 'keyframe') {
            assertDuration(step.duration, `Animation step ${index}`)
            if (step.type === 'tween') easingValue(step.easing, 0.5)
        }
        duration += timelineStepDuration(step)
    })

    if (duration <= 0) throw new Error('Animation timeline requires at least one timed step')
    return duration
}

export function defineAnimation<S extends object>(definition: AnimationDefinition<S>): DefinedAnimation<S> {
    const fps = definition.fps ?? DEFAULT_FPS
    assertFps(fps)
    const duration = validateTimeline(definition.timeline)
    validateAnimationValues(definition.initial, definition.timeline)

    return {
        ...definition,
        kind: 'vizmatic.animation',
        duration,
        fps,
    }
}

function interpolateValue<T>(
    from: T,
    to: T,
    progress: number,
    interpolate?: AnimationInterpolator<T>,
): T {
    if (interpolate) return interpolate(from, to, progress)
    if (typeof from === 'number' && typeof to === 'number' && Number.isFinite(from) && Number.isFinite(to)) {
        return (from + (to - from) * progress) as T
    }
    throw new Error('Animation tweens require finite numeric values or a custom interpolate function')
}

function validatePropertyInterpolation<T>(initial: T, steps: readonly AnimationPropertyStep<T>[]): T {
    let value = initial
    for (const step of steps) {
        if (step.type === 'keyframe') value = step.value
        if (step.type === 'tween') {
            interpolateValue(value, step.to, 0.5, step.interpolate)
            value = step.to
        }
    }
    return value
}

function validateAnimationValues<S extends object>(initial: S, timeline: readonly AnimationTimelineStep<S>[]): void {
    let state = { ...initial }
    for (const step of timeline) {
        if (step.type === 'keyframe') {
            state = { ...state, ...step.value }
        } else if (step.type === 'tween') {
            interpolateState(state, step, 0.5)
            state = { ...state, ...step.to }
        } else if (step.type === 'parallel') {
            const result = { ...state }
            for (const key of Object.keys(step.tracks) as Array<keyof S>) {
                const track = step.tracks[key]
                if (track) result[key] = validatePropertyInterpolation(state[key], track)
            }
            state = result
        }
    }
}

function interpolateState<S extends object>(
    from: S,
    step: AnimationTweenStep<Partial<S>>,
    progress: number,
): S {
    if (step.interpolate) {
        const fromPatch = Object.fromEntries(Object.keys(step.to).map((key) => [key, from[key as keyof S]])) as Partial<S>
        return { ...from, ...step.interpolate(fromPatch, step.to, progress) }
    }

    const patch: Partial<S> = {}
    for (const key of Object.keys(step.to) as Array<keyof S>) {
        const target = step.to[key]
        if (target === undefined) continue
        patch[key] = interpolateValue(from[key], target, progress)
    }
    return { ...from, ...patch }
}

function finalState<S extends object>(state: S, step: AnimationTimelineStep<S>): S {
    if (step.type === 'keyframe') return { ...state, ...step.value }
    if (step.type === 'tween') return { ...state, ...step.to }
    if (step.type !== 'parallel') return state

    const result = { ...state }
    for (const key of Object.keys(step.tracks) as Array<keyof S>) {
        const track = step.tracks[key]
        if (!track) continue
        let value = state[key]
        for (const item of track) {
            if (item.type === 'keyframe' || item.type === 'tween') value = item.type === 'keyframe' ? item.value : item.to
        }
        result[key] = value
    }
    return result
}

function evaluatePropertyTrack<T>(initial: T, steps: readonly AnimationPropertyStep<T>[], time: number): T {
    let value = initial
    let cursor = 0

    for (const step of steps) {
        if (step.type === 'keyframe') {
            value = step.value
            continue
        }

        const end = cursor + step.duration
        if (time < end) {
            if (step.type === 'hold') return value
            const progress = easingValue(step.easing, (time - cursor) / step.duration)
            return interpolateValue(value, step.to, progress, step.interpolate)
        }

        if (step.type === 'tween') value = step.to
        cursor = end
    }

    return value
}

function evaluateAnimation<S extends object>(animation: DefinedAnimation<S>, requestedTime: number): EvaluatedAnimationState<S> {
    const time = Math.max(0, Math.min(animation.duration, requestedTime))
    let state = { ...animation.initial }
    let cursor = 0

    for (let index = 0; index < animation.timeline.length; index += 1) {
        const step = animation.timeline[index]

        if (step.type === 'keyframe') {
            state = { ...state, ...step.value }
            continue
        }

        const duration = timelineStepDuration(step)
        const end = cursor + duration
        if (time < end) {
            const rawProgress = (time - cursor) / duration
            if (step.type === 'hold') {
                return { state, step: index, stepProgress: rawProgress, label: step.label }
            }
            if (step.type === 'tween') {
                const progress = easingValue(step.easing, rawProgress)
                return {
                    state: interpolateState(state, step, progress),
                    step: index,
                    stepProgress: rawProgress,
                    label: step.label,
                }
            }

            const parallelState = { ...state }
            for (const key of Object.keys(step.tracks) as Array<keyof S>) {
                const track = step.tracks[key]
                if (track) parallelState[key] = evaluatePropertyTrack(state[key], track, time - cursor)
            }
            return {
                state: parallelState,
                step: index,
                stepProgress: rawProgress,
                label: step.label,
            }
        }

        state = finalState(state, step)
        cursor = end
    }

    const lastIndex = animation.timeline.length - 1
    return {
        state,
        step: lastIndex,
        stepProgress: 1,
        label: animation.timeline[lastIndex]?.label,
    }
}

export function sampleAnimation<S extends object>(animation: DefinedAnimation<S>, time: number): Readonly<S> {
    if (!Number.isFinite(time)) throw new Error('Animation sample time must be finite')
    return evaluateAnimation(animation, time).state
}

interface AnimationCadenceSchedule {
    times: number[]
    delays: number[]
}

function animationCadence(duration: number, fps: number): AnimationCadenceSchedule {
    const interval = 1000 / fps
    const times = [0]
    for (let time = interval; time < duration; time += interval) times.push(time)
    if (times.at(-1) !== duration) times.push(duration)

    const boundaries = times.map((time) => Math.round(time / 10) * 10)
    const delays = times.map((_, index) => index === times.length - 1
        ? 20
        : Math.max(20, boundaries[index + 1] - boundaries[index]))
    const targetDuration = Math.max(
        Math.round(duration / 10) * 10,
        delays.length * 20,
    )
    let excess = delays.reduce((total, delay) => total + delay, 0) - targetDuration
    for (let index = delays.length - 2; index >= 0 && excess > 0; index -= 1) {
        const reduction = Math.min(excess, delays[index] - 20)
        delays[index] -= reduction
        excess -= reduction
    }
    return { times, delays }
}

export function analyzeAnimationCadence<S extends object>(
    animation: DefinedAnimation<S>,
    options: SampleAnimationOptions = {},
): AnimationCadenceAnalysis {
    const fps = options.fps ?? animation.fps
    assertFps(fps)
    const cadence = animationCadence(animation.duration, fps)
    return {
        fps,
        duration: animation.duration,
        frameCount: cadence.times.length,
        encodedDuration: cadence.delays.reduce((total, delay) => total + delay, 0),
        targetInterval: 1000 / fps,
        minDelay: Math.min(...cadence.delays),
        maxDelay: Math.max(...cadence.delays),
    }
}

export function sampleAnimationFrames<S extends object>(
    animation: DefinedAnimation<S>,
    options: SampleAnimationOptions = {},
): readonly SampledAnimationFrame<S>[] {
    const fps = options.fps ?? animation.fps
    assertFps(fps)
    const cadence = animationCadence(animation.duration, fps)
    const count = cadence.times.length

    return cadence.times.map((time, index) => {
        const evaluated = evaluateAnimation(animation, time)
        return {
            state: evaluated.state,
            frame: {
                index,
                count,
                time,
                duration: animation.duration,
                delay: cadence.delays[index],
                progress: time / animation.duration,
                step: evaluated.step,
                stepProgress: evaluated.stepProgress,
                label: evaluated.label,
                fps,
            },
        }
    })
}
