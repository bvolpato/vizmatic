import { defineAnimation, hold } from 'vizmatic'
import { photoBlurFrame, type PhotoBlurState } from '../catalog-photo-blur'

export const width = 1280
export const height = 720

export function create(theme: 'dark' | 'light' = 'dark') {
    return photoBlurFrame(theme)
}

export function createAnimation(theme: 'dark' | 'light' = 'dark') {
    return defineAnimation<PhotoBlurState>({
        initial: { layout: 0, reveal: 0, tap: 0, rows: 0 },
        timeline: [
            hold(1200, 'Begin with the actual CIFAR-10 frog photo'),
            { type: 'tween', to: { layout: 1 }, duration: 950, easing: 'ease-out', label: 'Move the photo into its comparison position' },
            { type: 'tween', to: { reveal: 1 }, duration: 500, easing: 'ease-out', label: 'Reveal the kernel after the photo settles' },
            hold(1450, 'The outlined window maps to output pixel thirteen, fourteen'),
            { type: 'tween', to: { tap: 8 }, duration: 3600, easing: 'linear', label: 'Multiply each red input value by its matching kernel weight' },
            hold(1250, 'The nine weighted terms form one output color value'),
            { type: 'tween', to: { rows: 30 }, duration: 7500, easing: 'linear', label: 'Reveal the precomputed valid-padding result, row by row' },
            hold(2600, 'Float RGB values are rounded to bytes only for the pixel display'),
        ],
        fps: 30,
        render: state => photoBlurFrame(theme, state),
    })
}
