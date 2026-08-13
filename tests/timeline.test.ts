import { describe, expect, it } from 'vitest'
import {
    defineAnimation,
    hold,
    keyframe,
    parallel,
    sampleAnimation,
    sampleAnimationFrames,
    tween,
    type AnimationTimelineStep,
} from '../src/timeline'

describe('animation timeline', () => {
    it('samples holds, tweens, keyframes, and exact final state', () => {
        const animation = defineAnimation({
            initial: { x: 0, opacity: 0, phase: 'idle' },
            timeline: [
                hold(100, 'ready'),
                tween({ x: 10, opacity: 1 }, { duration: 200, easing: 'linear', label: 'move' }),
                keyframe({ phase: 'done' }),
                hold(100, 'complete'),
            ],
            render: () => null,
        })

        expect(sampleAnimation(animation, 50)).toEqual({ x: 0, opacity: 0, phase: 'idle' })
        expect(sampleAnimation(animation, 150)).toEqual({ x: 2.5, opacity: 0.25, phase: 'idle' })
        expect(sampleAnimation(animation, 300)).toEqual({ x: 10, opacity: 1, phase: 'done' })
        expect(sampleAnimation(animation, 900)).toEqual({ x: 10, opacity: 1, phase: 'done' })
    })

    it('runs staggered property tracks in parallel', () => {
        type State = { x: number; y: number }
        const animation = defineAnimation<State>({
            initial: { x: 0, y: 0 },
            timeline: [
                parallel<State>({
                    x: [tween(10, { duration: 100 }), hold(100)],
                    y: [hold(50), tween(30, { duration: 150, easing: 'linear' })],
                }, 'stagger'),
            ],
            render: () => null,
        })

        expect(sampleAnimation(animation, 75)).toEqual({ x: 7.5, y: 5 })
        expect(sampleAnimation(animation, 150)).toEqual({ x: 10, y: 20 })
        expect(sampleAnimation(animation, 200)).toEqual({ x: 10, y: 30 })
    })

    it('ignores optional parallel tracks that are undefined', () => {
        const animation = defineAnimation({
            initial: { x: 0, y: 0 },
            timeline: [parallel({
                x: [tween(10, { duration: 100 })],
                y: undefined,
            })],
            render: () => null,
        })

        expect(sampleAnimation(animation, 50)).toEqual({ x: 5, y: 0 })
    })

    it('produces deterministic GIF-friendly frame timing', () => {
        const animation = defineAnimation({
            initial: { progress: 0 },
            timeline: [tween({ progress: 1 }, { duration: 425, easing: 'ease-in-out' })],
            fps: 20,
            render: () => null,
        })

        const first = sampleAnimationFrames(animation)
        const second = sampleAnimationFrames(animation)
        expect(first).toEqual(second)
        expect(first).toHaveLength(8)
        expect(first.reduce((total, item) => total + item.frame.delay, 0)).toBe(430)
        expect(first.every((item) => item.frame.delay >= 20)).toBe(true)
        expect(first[0]?.state).toEqual({ progress: 0 })
        expect(first[0]?.frame.progress).toBe(0)
        expect(first.at(-1)?.state).toEqual({ progress: 1 })
        expect(first.at(-1)?.frame.progress).toBe(1)
    })

    it('validates timing and interpolation contracts at definition time', () => {
        expect(() => defineAnimation({
            initial: { x: 0 },
            timeline: [hold(0)],
            render: () => null,
        })).toThrow('duration must be a positive finite number')

        expect(() => defineAnimation({
            initial: { phase: 'idle' },
            timeline: [tween({ phase: 'done' }, { duration: 100 })],
            render: () => null,
        })).toThrow('finite numeric values or a custom interpolate function')

        expect(() => defineAnimation({
            initial: { x: 0 },
            timeline: [] as AnimationTimelineStep<{ x: number }>[],
            render: () => null,
        })).toThrow('requires at least one step')

        expect(() => defineAnimation({
            initial: { x: 0 },
            timeline: [tween({ x: 1 }, { duration: 100, easing: 'elastic' as never })],
            render: () => null,
        })).toThrow('Unknown animation easing')
    })
})
