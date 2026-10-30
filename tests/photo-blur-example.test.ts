import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { decodeRgbPng, type RgbRaster } from '../src/primitives/raster-image'
import {
    getPhotoBlurLevel,
    photoBlurOptions,
    photoBlurTarget,
    photoPngDataUri,
    photoSourceCrop,
    photoSourceRaster,
} from '../examples/catalog-photo-blur'

function referenceGaussianPixel(row: number, column: number): number[] {
    const rgb = [0, 0, 0]
    const { radius, maxSigma } = photoBlurOptions
    let total = 0
    for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
        const weight = Math.exp(-(x * x + y * y) / (2 * maxSigma * maxSigma))
        const at = ((row + radius + y) * photoSourceRaster.width + column + radius + x) * 3
        for (let channel = 0; channel < 3; channel++) rgb[channel] += weight * photoSourceRaster.data[at + channel]
        total += weight
    }
    return rgb.map(value => value / total)
}

function gradientEnergy(image: RgbRaster): number {
    let energy = 0
    for (let row = 0; row < image.height; row++) for (let column = 0; column < image.width; column++) {
        const at = (row * image.width + column) * 3
        for (let channel = 0; channel < 3; channel++) {
            if (column + 1 < image.width) energy += Math.abs(image.data[at + channel + 3] - image.data[at + channel])
            if (row + 1 < image.height) energy += Math.abs(image.data[at + channel + image.width * 3] - image.data[at + channel])
        }
    }
    return energy
}

it('uses the sharp prepared photograph and exactly matches the valid output framing', () => {
    const png = Buffer.from(photoPngDataUri.split(',')[1], 'base64')
    expect(createHash('sha256').update(png).digest('hex')).toBe('7ce98fef02b2bb5d6a073502c70e7ca5203187a4133973f8729e2d2be3ff7ba4')
    expect([photoSourceRaster.width, photoSourceRaster.height]).toEqual([384, 256])
    expect([photoSourceCrop.width, photoSourceCrop.height]).toEqual([360, 232])
    const expected = new Uint8Array(360 * 232 * 3)
    for (let row = 0; row < 232; row++) {
        const start = ((row + 12) * 384 + 12) * 3
        expected.set(photoSourceRaster.data.subarray(start, start + 360 * 3), row * 360 * 3)
    }
    expect(photoSourceCrop.data).toEqual(expected)
    const zero = getPhotoBlurLevel(0)
    expect(zero.sigma).toBe(0)
    expect([zero.raster.width, zero.raster.height]).toEqual([360, 232])
    expect(zero.raster.data).toEqual(Float64Array.from(expected))
})

it('computes the final photo and selected-pixel readout with the actual 25 by 25 Gaussian', () => {
    const final = getPhotoBlurLevel(8)
    expect(final.sigma).toBe(4)
    expect(photoBlurOptions.sigmaStep).toBe(0.5)
    expect(photoBlurOptions.radius).toBe(12)
    expect(photoBlurOptions.kernelSize).toBe(25)
    expect(final.kernelSum).toBeCloseTo(1, 12)
    expect(final.raster.data).toBeInstanceOf(Float64Array)
    const points = [[0, 0], [0, 359], [231, 0], [231, 359], [116, 180], [photoBlurTarget.row, photoBlurTarget.column]]
    for (const [row, column] of points) {
        const expected = referenceGaussianPixel(row, column)
        const at = (row * final.raster.width + column) * 3
        for (let channel = 0; channel < 3; channel++) {
            expect(final.raster.data[at + channel]).toBeCloseTo(expected[channel], 10)
        }
    }
    const target = referenceGaussianPixel(photoBlurTarget.row, photoBlurTarget.column)
    for (let channel = 0; channel < 3; channel++) {
        expect(final.targetFloatRgb[channel]).toBeCloseTo(target[channel], 10)
        expect(final.targetByteRgb[channel]).toBe(Math.round(target[channel]))
    }
})

it('encodes the displayed final PNG from the computed floating-point pixels', () => {
    const final = getPhotoBlurLevel(8)
    const displayed = decodeRgbPng(final.pngDataUri)
    expect([displayed.width, displayed.height]).toEqual([360, 232])
    expect(displayed.data).toEqual(Uint8Array.from(final.raster.data, value => Math.round(value)))
})

it('removes substantial edge detail from a sharp source instead of barely changing a blurry sample', () => {
    const inputEnergy = gradientEnergy(photoSourceCrop)
    const outputEnergy = gradientEnergy(getPhotoBlurLevel(8).raster)
    const adjacentChannels = ((360 - 1) * 232 + 360 * (232 - 1)) * 3
    expect(inputEnergy / adjacentChannels).toBeGreaterThan(6)
    expect(outputEnergy / inputEnergy).toBeLessThan(0.35)
})
