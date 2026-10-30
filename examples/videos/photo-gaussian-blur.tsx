import { defineAnimation, hold } from 'vizmatic'
import { photoBlurFrame, photoBlurOptions, type PhotoBlurState } from '../catalog-photo-blur'

export const width = 1280
export const height = 720

export function create(theme: 'dark' | 'light' = 'dark') {
    return photoBlurFrame(theme)
}

export function createAnimation(theme: 'dark' | 'light' = 'dark') {
    const blurSteps = Array.from(
        { length: photoBlurOptions.maxSigma / photoBlurOptions.sigmaStep },
        (_, index) => index + 1,
    )
    const timeline = [
        hold(1300, 'Start with the unblurred coffee photograph'),
        { type: 'tween' as const, to: { layout: 1 }, duration: 1200, easing: 'ease-out' as const, label: 'Move the sharp photo into the comparison layout' },
        hold(300, 'Let the photograph settle before the comparison appears'),
        { type: 'tween' as const, to: { reveal: 1 }, duration: 500, easing: 'ease-out' as const, label: 'Reveal the Gaussian coefficient matrix excerpt and matching crop' },
        hold(2000, 'Before blurring, sigma zero reproduces the sharp input; all kernel weights together sum to one'),
        ...blurSteps.flatMap(level => {
            const sigma = level * photoBlurOptions.sigmaStep
            return [
                { type: 'keyframe' as const, value: { level }, label: `Compute the actual photo at sigma ${sigma.toFixed(1)} pixels` },
                hold(1150, `Compare the new Gaussian result at sigma ${sigma.toFixed(1)} pixels`),
            ]
        }),
        hold(1100, 'A larger sigma spreads edge details over a wider neighborhood'),
        hold(4800, 'The final image uses the computed 25 by 25 Gaussian blur at sigma 4 pixels'),
    ]

    return defineAnimation<PhotoBlurState>({
        initial: { layout: 0, reveal: 0, level: 0 },
        timeline,
        fps: 30,
        render: state => photoBlurFrame(theme, state),
    })
}
