import { encode } from 'fast-png'
import { describe, expect, it } from 'vitest'
import {
    cropRgbRaster,
    decodeRgbPng,
    encodeRgbPng,
    gaussianBlurRgb,
    type RgbRaster,
} from '../src/primitives/raster-image'

const uri = (bytes: Uint8Array) => 'data:image/png;base64,' + Buffer.from(bytes).toString('base64')
const bytes = (source: string) => Uint8Array.from(Buffer.from(source.split(',')[1], 'base64'))

function chunk(type: string, data: Uint8Array): Uint8Array {
    const output = new Uint8Array(data.length + 12)
    const view = new DataView(output.buffer)
    view.setUint32(0, data.length)
    output.set(Array.from(type, letter => letter.charCodeAt(0)), 4)
    output.set(data, 8)
    let crc = 0xffffffff
    for (const value of output.subarray(4, output.length - 4)) {
        crc ^= value
        for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1
    }
    view.setUint32(output.length - 4, (crc ^ 0xffffffff) >>> 0)
    return output
}

function addBeforeData(png: Uint8Array, type: string, data: Uint8Array): Uint8Array {
    let offset = 8
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    while (String.fromCharCode(...png.subarray(offset + 4, offset + 8)) !== 'IDAT') offset += view.getUint32(offset) + 12
    const inserted = chunk(type, data)
    return Uint8Array.from([...png.subarray(0, offset), ...inserted, ...png.subarray(offset)])
}

const image = (width: number, height: number): RgbRaster => ({
    width, height,
    data: Float64Array.from({ length: width * height * 3 }, (_, index) => (index * 37 + 19) % 256),
})

describe('portable PNG raster helpers', () => {
    it('round-trips RGB channels and rounds float channels only when encoding', () => {
        const original: RgbRaster = { width: 2, height: 1, data: new Float64Array([.49, 10.5, 255, 128.25, 64.75, 1.499]) }
        const before = [...original.data]
        const decoded = decodeRgbPng(encodeRgbPng(original))
        expect(decoded.width).toBe(2)
        expect(decoded.height).toBe(1)
        expect([...decoded.data]).toEqual([0, 11, 255, 128, 65, 1])
        expect([...original.data]).toEqual(before)
    })

    it('decodes palette and grayscale photos and removes only opaque alpha channels', () => {
        const palette = encode({ width: 2, height: 1, depth: 8, channels: 1,
            data: new Uint8Array([1, 0]), palette: [[10, 20, 30], [200, 210, 220]] })
        expect([...decodeRgbPng(uri(palette)).data]).toEqual([200, 210, 220, 10, 20, 30])
        const gray = encode({ width: 2, height: 1, depth: 8, channels: 1, data: new Uint8Array([12, 234]) })
        expect([...decodeRgbPng(uri(gray)).data]).toEqual([12, 12, 12, 234, 234, 234])
        const rgba = encode({ width: 1, height: 1, depth: 8, channels: 4, data: new Uint8Array([12, 34, 56, 255]) })
        expect([...decodeRgbPng(uri(rgba)).data]).toEqual([12, 34, 56])
        const grayAlpha = encode({ width: 1, height: 1, depth: 8, channels: 2, data: new Uint8Array([77, 255]) })
        expect([...decodeRgbPng(uri(grayAlpha)).data]).toEqual([77, 77, 77])
    })

    it('rejects actual transparency, including palette and keyed transparency', () => {
        const rgba = encode({ width: 1, height: 1, depth: 8, channels: 4, data: new Uint8Array([12, 34, 56, 254]) })
        expect(() => decodeRgbPng(uri(rgba))).toThrow('opaque')
        const unused = encode({ width: 1, height: 1, depth: 8, channels: 1,
            data: new Uint8Array([0]), palette: [[10, 20, 30], [200, 210, 220]] })
        expect([...decodeRgbPng(uri(addBeforeData(unused, 'tRNS', new Uint8Array([255, 0])))).data]).toEqual([10, 20, 30])
        const used = encode({ width: 1, height: 1, depth: 8, channels: 1,
            data: new Uint8Array([1]), palette: [[10, 20, 30], [200, 210, 220]] })
        expect(() => decodeRgbPng(uri(addBeforeData(used, 'tRNS', new Uint8Array([255, 0]))))).toThrow('opaque')
        const rgb = encode({ width: 3, height: 1, depth: 8, channels: 3, data: new Uint8Array([12, 34, 56, 1, 2, 3, 4, 5, 6]) })
        expect(() => decodeRgbPng(uri(addBeforeData(rgb, 'tRNS', new Uint8Array([0, 12, 0, 34, 0, 56]))))).toThrow('opaque')
        const gray = encode({ width: 1, height: 1, depth: 8, channels: 1, data: new Uint8Array([77]) })
        expect(() => decodeRgbPng(uri(addBeforeData(gray, 'tRNS', new Uint8Array([0, 77]))))).toThrow('opaque')
    })

    it('checks CRC, dimensions, depth, and inflated scanline size before returning pixels', () => {
        const valid = bytes(encodeRgbPng({ width: 2, height: 1, data: new Uint8Array([1, 2, 3, 4, 5, 6]) }))
        const corrupt = valid.slice()
        corrupt[corrupt.length - 1] ^= 1
        expect(() => decodeRgbPng(uri(corrupt))).toThrow(/CRC/)
        const header = valid.slice(16, 29)
        new DataView(header.buffer).setUint32(0, 1)
        const undersized = Uint8Array.from([...valid.subarray(0, 8), ...chunk('IHDR', header), ...valid.subarray(33)])
        expect(() => decodeRgbPng(uri(undersized))).toThrow('inflated data exceeds')
        new DataView(header.buffer).setUint32(0, 1_048_577)
        const oversized = Uint8Array.from([...valid.subarray(0, 8), ...chunk('IHDR', header), ...valid.subarray(33)])
        expect(() => decodeRgbPng(uri(oversized))).toThrow('at most 1048576 pixels')
        const sixteen = encode({ width: 1, height: 1, channels: 3, depth: 16, data: new Uint16Array([1, 2, 3]) })
        expect(() => decodeRgbPng(uri(sixteen))).toThrow('only 8-bit')
        const interlaced = encode({ width: 2, height: 1, channels: 3, depth: 8,
            data: new Uint8Array([1, 2, 3, 4, 5, 6]) }, { interlace: 'Adam7' })
        expect(() => decodeRgbPng(uri(interlaced))).toThrow('interlace')
        expect(() => decodeRgbPng(uri(addBeforeData(valid, 'iCCP', new Uint8Array([0]))))).toThrow('ICC')
        expect(() => decodeRgbPng(uri(addBeforeData(valid, 'acTL', new Uint8Array(8))))).toThrow('animated')
        expect(() => decodeRgbPng('https://example.com/photo.png')).toThrow('data:image/png')
        expect(() => decodeRgbPng('data:image/png;base64,!!!!')).toThrow('valid')
    })

    it('copies crops with exact channel alignment and floating precision', () => {
        const original: RgbRaster = { width: 3, height: 2, data: Float64Array.from({ length: 18 }, (_, index) => index + .125) }
        const cropped = cropRgbRaster(original, { row: 0, column: 1, rows: 2, columns: 2 })
        expect([cropped.width, cropped.height]).toEqual([2, 2])
        expect(cropped.data).toBeInstanceOf(Float64Array)
        expect([...cropped.data]).toEqual([3.125, 4.125, 5.125, 6.125, 7.125, 8.125, 12.125, 13.125, 14.125, 15.125, 16.125, 17.125])
        cropped.data[0] = 255
        expect(original.data[3]).toBe(3.125)
        const byteCrop = cropRgbRaster({ ...original, data: Uint8Array.from(original.data) }, { row: 1, column: 1, rows: 1, columns: 1 })
        expect(byteCrop.data).toBeInstanceOf(Uint8Array)
        expect([...byteCrop.data]).toEqual([12, 13, 14])
    })
})

describe('separable RGB Gaussian blur', () => {
    it('matches an independent full 2D weighted sum without mutating or rounding the input', () => {
        const original = image(7, 6), before = [...original.data]
        const sigma = 1.2, radius = 2
        const blurred = gaussianBlurRgb(original, { sigma, radius })
        expect([blurred.width, blurred.height]).toEqual([3, 2])
        expect(blurred.data).toBeInstanceOf(Float64Array)
        for (let row = 0; row < blurred.height; row++) for (let column = 0; column < blurred.width; column++) {
            for (let channel = 0; channel < 3; channel++) {
                let sum = 0, total = 0
                for (let y = -radius; y <= radius; y++) for (let x = -radius; x <= radius; x++) {
                    const weight = Math.exp(-(x * x + y * y) / (2 * sigma * sigma))
                    sum += weight * original.data[((row + y + radius) * original.width + column + x + radius) * 3 + channel]
                    total += weight
                }
                expect(blurred.data[(row * blurred.width + column) * 3 + channel]).toBeCloseTo(sum / total, 10)
            }
        }
        expect([...original.data]).toEqual(before)
        expect([...blurred.data].some(value => !Number.isInteger(value))).toBe(true)
    })

    it('uses zero sigma and zero radius as exact identities with the requested valid crop', () => {
        const original = image(5, 4)
        const identity = gaussianBlurRgb(original, { sigma: 0 })
        expect([...identity.data]).toEqual([...original.data])
        expect(identity.data).not.toBe(original.data)
        expect([...gaussianBlurRgb(original, { sigma: 0, radius: 1 }).data]).toEqual([
            ...cropRgbRaster(original, { row: 1, column: 1, rows: 2, columns: 3 }).data,
        ])
        expect([...gaussianBlurRgb(original, { sigma: 4, radius: 0 }).data]).toEqual([...original.data])
    })

    it('keeps constant whites unchanged and remains finite for extreme positive sigma', () => {
        const white: RgbRaster = { width: 9, height: 7, data: new Uint8Array(9 * 7 * 3).fill(255) }
        expect([...gaussianBlurRgb(white, { sigma: 1.1, radius: 3 }).data].every(value => value === 255)).toBe(true)
        const original = image(5, 5)
        expect([...gaussianBlurRgb(original, { sigma: 1e-200, radius: 1 }).data]).toEqual([
            ...cropRgbRaster(original, { row: 1, column: 1, rows: 3, columns: 3 }).data,
        ])
        expect([...gaussianBlurRgb(original, { sigma: 1e200, radius: 1 }).data].every(Number.isFinite)).toBe(true)
    })

    it('rejects malformed raster data, unsupported values, and kernels that do not fit', () => {
        const valid = image(3, 3)
        expect(() => gaussianBlurRgb(valid, { sigma: -1 })).toThrow('sigma')
        expect(() => gaussianBlurRgb(valid, { sigma: Infinity })).toThrow('sigma')
        expect(() => gaussianBlurRgb(valid, { sigma: 1, radius: .5 })).toThrow('radius')
        expect(() => gaussianBlurRgb(valid, { sigma: 1, radius: 65 })).toThrow('radius')
        expect(() => gaussianBlurRgb(valid, { sigma: 1, radius: 2 })).toThrow('fit')
        expect(() => encodeRgbPng({ ...valid, data: new Uint8Array(1) })).toThrow('exactly three')
        expect(() => encodeRgbPng({ ...valid, data: Float64Array.from(valid.data, () => NaN) })).toThrow('finite')
        expect(() => encodeRgbPng({ ...valid, data: Float64Array.from(valid.data, () => 256) })).toThrow('finite')
        expect(() => cropRgbRaster(valid, { row: 2, column: 0, rows: 2, columns: 1 })).toThrow('inside')
    })
})
