import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { cifar10Pixels, cropRegion } from '../examples/catalog-image-tensors'
import { cropRgbImage, flattenRgbImage, rgbChannel } from '../src/primitives/image-tensor'

it('round-trips every original CIFAR byte through the RGB image and channel matrices', () => {
    const record = Buffer.from([6, ...flattenRgbImage(cifar10Pixels, 'CHW')])
    expect(record.length).toBe(3073)
    expect(createHash('sha256').update(record).digest('hex')).toBe('945dc5584f8efcf7dc58367c3b072c0a23dacc05ae824d7c77a33874a8ec83c7')
    const crop = cropRgbImage(cifar10Pixels, cropRegion)
    for (const [index, channel] of (['red', 'green', 'blue'] as const).entries()) {
        const matrix = rgbChannel(crop, channel)
        for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
            expect(matrix[row][col]).toBe(record[1 + index * 1024 + (row + 12) * 32 + col + 14])
        }
    }
})
