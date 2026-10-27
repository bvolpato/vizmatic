/** Exact bytes from an actual CIFAR-10 image, not generated image data. */
import { defineAnimation, hold, tween, type ThemeMode } from 'vizmatic'
import { imageTensorFrame } from '../catalog-image-tensors'

export const width = 1280
export const height = 720

export function create(theme: ThemeMode = 'dark') { return imageTensorFrame(theme) }
export function createAnimation(theme: ThemeMode = 'dark') {
    return defineAnimation({
        initial: { reveal: 0, cursor: 0 },
        timeline: [
            hold(800, 'Start with the actual CIFAR image'),
            tween({ reveal: 1 }, { duration: 1200, easing: 'ease-in-out', label: 'Separate the three RGB channels' }),
            tween({ cursor: 15.999 }, { duration: 11000, easing: 'linear', label: 'Read a pixel and copy the same three bytes into its channel matrices' }),
            hold(1200, 'Inspect the completed numerical crop'),
        ],
        fps: 24,
        render: ({ reveal, cursor }) => imageTensorFrame(theme, cursor, reveal, true),
    })
}
export default create('dark')
