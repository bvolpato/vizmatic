import { defineAnimation, hold } from 'vizmatic'
import { gaussianOutputTargets, blurFrame, type GaussianBlurState } from '../catalog-gaussian-blur'

export const width = 1280
export const height = 720

export function create(theme: 'dark' | 'light' = 'dark') {
    return blurFrame(theme)
}

export function createAnimation(theme: 'dark' | 'light' = 'dark') {
    const timeline = [
        hold(1000, 'Look at the single bright pixel'),
        { type: 'tween' as const, to: { stage: 1 }, duration: 1300, easing: 'ease-out' as const, label: 'Reveal the image, kernel, and output' },
        { type: 'hold' as const, duration: 650, label: 'The center point is brighter than its neighbors' },
        ...Array.from({ length: gaussianOutputTargets.length }, (_, index) => [
            ...(index > 0 ? [{ type: 'keyframe' as const, value: { target: index, tap: 0 }, label: `Move the window to output row ${gaussianOutputTargets[index].row}, column ${gaussianOutputTargets[index].column}` }] : []),
            { type: 'tween' as const, to: { tap: 8 }, duration: 800, easing: 'linear' as const, label: 'Accumulate nine weighted pixel taps' },
            { type: 'hold' as const, duration: 250, label: 'Read the weighted output value' },
        ]).flat(),
        { type: 'keyframe' as const, value: { target: gaussianOutputTargets.length, tap: 8 }, label: 'Reveal the completed blur' },
        { type: 'tween' as const, to: { tap: 4 }, duration: 350, easing: 'ease-in-out' as const, label: 'Return focus to the bright center pixel and its weight' },
        { type: 'hold' as const, duration: 2600, label: 'The point has spread across the neighborhood' },
    ]

    return defineAnimation<GaussianBlurState>({
        initial: { stage: 0, target: 0, tap: 0 },
        timeline,
        fps: 30,
        render: state => blurFrame(theme, state),
    })
}
