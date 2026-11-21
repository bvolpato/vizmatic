import { encode } from 'fast-png'

/** Immutable after a frame is returned. Each sampled field owns its pixel buffer. */
export interface PixelImage {
    readonly width: number
    readonly height: number
    readonly data: Uint8ClampedArray
}

const encoded = new WeakMap<PixelImage, string>()
const canvases = new WeakMap<PixelImage, CanvasImageSource>()
// Reuse one scratch canvas + ImageData per owning node so animated scalarFields do not allocate 60 GPU textures/sec.
const nodeCanvases = new WeakMap<object, { width: number; height: number; canvas: CanvasImageSource; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D; image: ImageData; last: PixelImage | null }>()

export function validatePixels(pixels: PixelImage): void {
    const { width, height, data } = pixels
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || width * height > 16_777_216 || !(data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
        throw new Error('Generated image needs positive integer dimensions and one RGBA byte quadruple per pixel (at most 16 megapixels).')
    }
}

export function pixelDataUri(pixels: PixelImage): string {
    const cached = encoded.get(pixels)
    if (cached) return cached
    validatePixels(pixels)
    // Level 1 deflate avoids slow level-6 search on ephemeral per-frame scalar fields while keeping compact payloads.
    const bytes = encode({ width: pixels.width, height: pixels.height, data: pixels.data, channels: 4, depth: 8 }, { zlib: { level: 1 } })
    let base64: string
    if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
    } else {
        const chunks: string[] = []
        for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)))
        base64 = btoa(chunks.join(''))
    }
    const uri = `data:image/png;base64,${base64}`
    encoded.set(pixels, uri)
    return uri
}

export function pixelCanvas(pixels: PixelImage, owner?: object): CanvasImageSource {
    if (owner) {
        validatePixels(pixels)
        let entry = nodeCanvases.get(owner)
        if (!entry || entry.width !== pixels.width || entry.height !== pixels.height) {
            const canvas = typeof OffscreenCanvas === 'undefined'
                ? Object.assign(document.createElement('canvas'), { width: pixels.width, height: pixels.height })
                : new OffscreenCanvas(pixels.width, pixels.height)
            const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
            const image = ctx.createImageData(pixels.width, pixels.height)
            entry = { width: pixels.width, height: pixels.height, canvas, ctx, image, last: null }
            nodeCanvases.set(owner, entry)
        }
        if (entry.last !== pixels) {
            entry.image.data.set(pixels.data)
            entry.ctx.putImageData(entry.image, 0, 0)
            entry.last = pixels
        }
        return entry.canvas
    }
    const cached = canvases.get(pixels)
    if (cached) return cached
    validatePixels(pixels)
    const canvas = typeof OffscreenCanvas === 'undefined'
        ? Object.assign(document.createElement('canvas'), { width: pixels.width, height: pixels.height })
        : new OffscreenCanvas(pixels.width, pixels.height)
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    const image = ctx.createImageData(pixels.width, pixels.height)
    image.data.set(pixels.data)
    ctx.putImageData(image, 0, 0)
    canvases.set(pixels, canvas)
    return canvas
}
