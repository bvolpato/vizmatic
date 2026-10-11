import * as gifenc from 'gifenc'
import { mattePlaygroundPixels } from './playground-animation'

const gifApi = typeof gifenc.GIFEncoder === 'function' ? gifenc : gifenc.default

/** Encode each frame immediately so completed WASM images can be freed. */
export function createPlaygroundGif(width: number, height: number, matte: string) {
    const gif = gifApi.GIFEncoder()
    return {
        writeFrame(pixels: Uint8Array, delay: number): void {
            if (pixels.length !== width * height * 4) throw new Error('GIF frame pixels do not match the canvas dimensions.')
            const opaque = mattePlaygroundPixels(pixels, matte)
            const palette = gifApi.quantize(opaque, 256, { format: 'rgb565' })
            const indexed = gifApi.applyPalette(opaque, palette, 'rgb565')
            gif.writeFrame(indexed, width, height, { palette, delay, repeat: 0, dispose: 1 })
        },
        finish(): ArrayBuffer {
            gif.finish()
            return gif.bytes().slice().buffer as ArrayBuffer
        },
    }
}
