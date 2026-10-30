import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { flattenRgbImage } from '../src/primitives/image-tensor'
import {
    cifar10Pixels,
    photoBlurSourceCrop,
    photoBlurOutputFloats,
    photoBlurredPixels,
    photoBlurTarget,
    photoBlurRedPatch,
} from '../examples/catalog-photo-blur'

it('uses the original photographic sample and aligns the before/after fields of view', () => {
    const record = Buffer.from([6, ...flattenRgbImage(cifar10Pixels, 'CHW')])
    expect(createHash('sha256').update(record).digest('hex')).toBe('945dc5584f8efcf7dc58367c3b072c0a23dacc05ae824d7c77a33874a8ec83c7')
    expect(photoBlurSourceCrop).toHaveLength(30)
    expect(photoBlurredPixels).toHaveLength(30)
    for (let row = 0; row < 30; row++) {
        expect(photoBlurSourceCrop[row]).toHaveLength(30)
        expect(photoBlurredPixels[row]).toHaveLength(30)
        for (let column = 0; column < 30; column++) {
            expect(photoBlurSourceCrop[row][column]).toEqual(cifar10Pixels[row + 1][column + 1])
        }
    }
})

it('reconstructs every filtered RGB byte using independent separable passes', () => {
    const axis = [1, 2, 1]
    for (let row = 0; row < 30; row++) for (let column = 0; column < 30; column++) {
        for (let channel = 0; channel < 3; channel++) {
            const horizontal = axis.map((_, dy) => axis.reduce((sum, weight, dx) =>
                sum + weight * cifar10Pixels[row + dy][column + dx][channel], 0) / 4)
            const expected = (horizontal[0] + 2 * horizontal[1] + horizontal[2]) / 4
            expect(photoBlurOutputFloats[row][column][channel]).toBe(expected)
            expect(photoBlurredPixels[row][column][channel]).toBe(Math.round(expected))
        }
    }
    expect(photoBlurOutputFloats.flat(2).some(value => !Number.isInteger(value))).toBe(true)
})

it('shows the exact source neighborhood that produces the selected output pixel', () => {
    for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
        expect(photoBlurRedPatch[row][column]).toBe(
            cifar10Pixels[photoBlurTarget.row + row][photoBlurTarget.column + column][0],
        )
    }
})
