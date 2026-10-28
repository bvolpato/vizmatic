import { defineAnimation, hold, keyframe, tween, type AnimationTimelineStep, type ThemeMode } from 'vizmatic'
import { convolutionFrame, type KernelLessonState } from '../catalog-convolution-kernel'
export { width, height } from '../catalog-convolution-kernel'

export function create(theme: ThemeMode = 'dark') {
    return convolutionFrame(theme, { cell: 0, term: 0, filled: 0, windowRow: 0, windowCol: 0, moving: 0, reveal: 0 })
}

export function createAnimation(theme: ThemeMode = 'dark') {
    const timeline: AnimationTimelineStep<KernelLessonState>[] = [
        hold(1100, 'Start with the actual synthetic pixel image'),
        tween<Partial<KernelLessonState>>({ reveal: 1 }, { duration: 650, easing: 'ease-in-out', label: 'Reveal pixel values and the kernel' }),
        hold(600, 'Select the first 3 by 3 patch'),
    ]
    for (let term = 1; term < 9; term++) {
        timeline.push(keyframe<Partial<KernelLessonState>>({ term }, `Multiply pixel ${term + 1} by its kernel weight`), hold(230))
    }
    timeline.push(keyframe<Partial<KernelLessonState>>({ filled: 1 }), hold(650, 'Write the first sum and its ReLU'))
    for (let cell = 1; cell < 16; cell++) {
        timeline.push(
            keyframe<Partial<KernelLessonState>>({ moving: 1 }),
            tween<Partial<KernelLessonState>>({ windowRow: Math.floor(cell / 4), windowCol: cell % 4 }, { duration: 230, easing: 'ease-in-out', label: 'Slide the same weights to the next patch' }),
            keyframe<Partial<KernelLessonState>>({ cell, term: cell % 4 < 2 ? 2 : 0, moving: 0, filled: cell + 1 }),
            hold(cell === 2 ? 1150 : 360, cell === 2 ? 'The opposite edge gives a negative sum, which ReLU sets to zero' : 'Write the response and activation'),
        )
    }
    timeline.push(hold(2200, 'Read the completed signed response and activation maps'))
    return defineAnimation<KernelLessonState>({
        initial: { cell: 0, term: 0, filled: 0, windowRow: 0, windowCol: 0, moving: 0, reveal: 0 },
        timeline, fps: 24,
        render: state => convolutionFrame(theme, state),
    })
}
export default create('dark')
