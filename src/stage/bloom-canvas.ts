import { createBloom, type Bloom } from './bloom-kernel.mjs'
import { paintWebGLBloom } from './bloom-webgl'
import { parseColor } from './color'

export interface CanvasBloom {
    background: string | null
    color: readonly number[]
    paint: Bloom
}

/**
 * Keep soft light in floating point until the final, dithered write, as in video export.
 * Private player/export helper: paintFrame must have restored all clips on main.
 */
export function paintCanvasBloom(
    target: HTMLCanvasElement,
    main: CanvasRenderingContext2D,
    bloom: number,
    background: string | null,
    existing: CanvasBloom | null = null,
): CanvasBloom {
    const state = existing ?? { background, color: parseColor(background ?? '#000000'), paint: createBloom() }
    if (state.background !== background) {
        state.background = background
        state.color = parseColor(background ?? '#000000')
    }
    if (paintWebGLBloom(target, main, bloom, state.color)) return state
    const { width, height } = target
    const image = main.getImageData(0, 0, width, height)
    // ImageData uses clamped bytes, which round. The shared kernel needs truncating bytes for its dither.
    const pixels = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)
    state.paint(pixels, width, height, bloom, state.color, true)
    main.putImageData(image, 0, 0)
    return state
}
