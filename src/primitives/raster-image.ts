import { convertIndexedToRgb, decode, encode } from 'fast-png'
import { Unzlib } from 'fflate'
import type { PixelRegion } from './image-tensor'

export interface RgbRaster {
    width: number
    height: number
    /** Flat, row-major RGB channels. Floating-point values are retained until PNG encoding. */
    data: Uint8Array | Float64Array
}

export interface GaussianBlurRgbOptions {
    sigma: number
    radius?: number
}

const MAX_PIXELS = 1_048_576
const MAX_PNG_BYTES = 2 * 1_024 * 1_024
const PNG_PREFIX = 'data:image/png;base64,'
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function validateDimensions(width: number, height: number): number {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
        || width * height > MAX_PIXELS) {
        throw new Error(`RGB raster dimensions must be positive integers containing at most ${MAX_PIXELS} pixels`)
    }
    return width * height
}

function validateRaster(image: RgbRaster): number {
    if (!image || typeof image !== 'object') throw new Error('An RGB raster is required')
    const pixels = validateDimensions(image.width, image.height)
    if (!(image.data instanceof Uint8Array || image.data instanceof Float64Array) || image.data.length !== pixels * 3) {
        throw new Error('RGB raster data must contain exactly three channels per pixel in a Uint8Array or Float64Array')
    }
    if (image.data instanceof Float64Array) {
        for (const value of image.data) {
            if (!Number.isFinite(value) || value < 0 || value > 255) {
                throw new Error('RGB raster channels must be finite numbers from 0 to 255')
            }
        }
    }
    return pixels
}

function base64Bytes(source: string): Uint8Array {
    if (typeof source !== 'string' || !source.startsWith(PNG_PREFIX)) {
        throw new Error('PNG input must be a data:image/png;base64 URI')
    }
    const encoded = source.slice(PNG_PREFIX.length)
    if (!encoded.length || encoded.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 || encoded.length % 4
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error(`PNG base64 data must be valid and contain at most ${MAX_PNG_BYTES} bytes`)
    }
    const binary = atob(encoded)
    if (binary.length > MAX_PNG_BYTES) throw new Error(`PNG input exceeds ${MAX_PNG_BYTES} bytes`)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function pngDataUri(bytes: Uint8Array): string {
    const parts: string[] = []
    for (let index = 0; index < bytes.length; index += 8192) {
        parts.push(String.fromCharCode(...bytes.subarray(index, index + 8192)))
    }
    return PNG_PREFIX + btoa(parts.join(''))
}

/** Bound decoded scanline storage before handing the PNG to the general decoder. */
function inspectPng(bytes: Uint8Array): { width: number; height: number; colorType: number } {
    if (bytes.length < 33 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
        throw new Error('Invalid PNG signature or header')
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const chunkName = (offset: number) => String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (view.getUint32(8) !== 13 || chunkName(8) !== 'IHDR') throw new Error('PNG must start with one IHDR chunk')
    const width = view.getUint32(16), height = view.getUint32(20)
    validateDimensions(width, height)
    if (bytes[24] !== 8) throw new Error('RGB raster decoding supports only 8-bit PNG images')
    const colorType = bytes[25]
    const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0
    if (!channels || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) {
        throw new Error('Unsupported PNG color, compression, filter, or interlace format')
    }
    const expectedBytes = height * (1 + width * channels)
    let inflatedBytes = 0, hasData = false, dataEnded = false, hasPalette = false, ended = false
    const inflater = new Unzlib(chunk => {
        inflatedBytes += chunk.length
        if (inflatedBytes > expectedBytes) throw new Error('PNG inflated data exceeds its image dimensions')
    })
    let offset = 8
    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset), type = chunkName(offset)
        const end = offset + length + 12
        if (end > bytes.length) throw new Error('PNG chunk exceeds the input length')
        if (type === 'IHDR' && offset !== 8) throw new Error('PNG must contain only one IHDR chunk')
        if (['iCCP', 'acTL', 'fcTL', 'fdAT'].includes(type)) {
            throw new Error('Compressed ICC profiles and animated PNG images are not supported')
        }
        if (type === 'PLTE') {
            if (hasData || hasPalette || length < 3 || length > 768 || length % 3) throw new Error('Invalid PNG palette chunk')
            hasPalette = true
        }
        if (type === 'IDAT') {
            if (dataEnded || colorType === 3 && !hasPalette) throw new Error('Invalid PNG image data order')
            hasData = true
            for (let cursor = offset + 8; cursor < end - 4; cursor += 1024) {
                inflater.push(bytes.subarray(cursor, Math.min(cursor + 1024, end - 4)), false)
            }
        } else if (hasData) {
            dataEnded = true
        }
        if (type === 'IEND') {
            if (length !== 0 || end !== bytes.length) throw new Error('Invalid PNG end chunk')
            ended = true
            break
        }
        if (type !== 'IHDR' && type !== 'PLTE' && type !== 'IDAT' && type[0] >= 'A' && type[0] <= 'Z') {
            throw new Error(`Unsupported critical PNG chunk: ${type}`)
        }
        offset = end
    }
    if (!ended || !hasData) throw new Error('PNG image data or end chunk is missing')
    inflater.push(new Uint8Array(0), true)
    if (inflatedBytes !== expectedBytes) throw new Error('PNG inflated data does not match its image dimensions')
    return { width, height, colorType }
}

/** Decode an opaque, noninterlaced 8-bit PNG into a copied flat RGB buffer. */
export function decodeRgbPng(source: string): RgbRaster {
    const bytes = base64Bytes(source)
    const { width, height, colorType } = inspectPng(bytes)
    const decoded = decode(bytes, { checkCrc: true })
    const pixels = width * height
    const indexed = colorType === 3
    const channels = indexed ? decoded.palette![0].length : decoded.channels
    const input = indexed ? convertIndexedToRgb(decoded) : decoded.data
    if (input.length !== pixels * channels) throw new Error('PNG decoded data does not match its image dimensions')
    const data = new Uint8Array(pixels * 3)
    const transparent = decoded.transparency
    for (let pixel = 0; pixel < pixels; pixel += 1) {
        const at = pixel * channels
        const gray = channels < 3
        const red = input[at], green = gray ? red : input[at + 1], blue = gray ? red : input[at + 2]
        if ((channels === 2 || channels === 4) && input[at + channels - 1] !== 255
            || !indexed && transparent?.length && (gray
                ? red === transparent[0]
                : red === transparent[0] && green === transparent[1] && blue === transparent[2])) {
            throw new Error('RGB raster decoding requires opaque PNG pixels')
        }
        data[pixel * 3] = red
        data[pixel * 3 + 1] = green
        data[pixel * 3 + 2] = blue
    }
    return { width, height, data }
}

/** Encode RGB channels as a lossless PNG; round floating values only at this boundary. */
export function encodeRgbPng(image: RgbRaster): string {
    validateRaster(image)
    const data = Uint8Array.from(image.data, value => Math.round(value))
    return pngDataUri(encode({ width: image.width, height: image.height, data, depth: 8, channels: 3 }))
}

/** Copy a rectangular pixel region without changing channel precision. */
export function cropRgbRaster(image: RgbRaster, region: PixelRegion): RgbRaster {
    validateRaster(image)
    if (!region || ![region.row, region.column, region.rows, region.columns].every(Number.isSafeInteger)
        || region.row < 0 || region.column < 0 || region.rows < 1 || region.columns < 1
        || region.row + region.rows > image.height || region.column + region.columns > image.width) {
        throw new Error('RGB raster crop must be a nonempty integer region inside the image')
    }
    const count = region.rows * region.columns * 3
    const data = image.data instanceof Float64Array ? new Float64Array(count) : new Uint8Array(count)
    for (let row = 0; row < region.rows; row += 1) {
        const start = ((region.row + row) * image.width + region.column) * 3
        data.set(image.data.subarray(start, start + region.columns * 3), row * region.columns * 3)
    }
    return { width: region.columns, height: region.rows, data }
}

/** Apply a separable Gaussian over valid windows, returning unrounded RGB values. */
export function gaussianBlurRgb(image: RgbRaster, options: GaussianBlurRgbOptions): RgbRaster {
    validateRaster(image)
    const { sigma, radius = Math.ceil(3 * sigma) } = options
    if (!Number.isFinite(sigma) || sigma < 0) throw new Error('Gaussian sigma must be a nonnegative finite number')
    if (!Number.isSafeInteger(radius) || radius < 0 || radius > 64) throw new Error('Gaussian radius must be an integer from 0 to 64')
    const width = image.width - 2 * radius, height = image.height - 2 * radius
    if (width < 1 || height < 1) throw new Error('Gaussian kernel must fit inside the RGB image')
    const weights = Float64Array.from({ length: 2 * radius + 1 }, (_, index) => {
        const distance = index - radius
        return sigma === 0 ? Number(distance === 0) : Math.exp(-.5 * (distance / sigma) ** 2)
    })
    const total = weights.reduce((sum, value) => sum + value, 0)
    const horizontal = new Float64Array(width * image.height * 3)
    for (let row = 0; row < image.height; row += 1) for (let column = 0; column < width; column += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
            const base = image.data[(row * image.width + column + radius) * 3 + channel]
            let difference = 0
            for (let tap = 0; tap < weights.length; tap += 1) {
                difference += weights[tap] * (image.data[(row * image.width + column + tap) * 3 + channel] - base)
            }
            horizontal[(row * width + column) * 3 + channel] = base + difference / total
        }
    }
    const data = new Float64Array(width * height * 3)
    for (let row = 0; row < height; row += 1) for (let column = 0; column < width; column += 1) {
        for (let channel = 0; channel < 3; channel += 1) {
            const base = horizontal[((row + radius) * width + column) * 3 + channel]
            let difference = 0
            for (let tap = 0; tap < weights.length; tap += 1) {
                difference += weights[tap] * (horizontal[((row + tap) * width + column) * 3 + channel] - base)
            }
            data[(row * width + column) * 3 + channel] = Math.min(255, Math.max(0, base + difference / total))
        }
    }
    return { width, height, data }
}
