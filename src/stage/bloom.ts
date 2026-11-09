import type { Canvas2D, Frame } from './display'

/**
 * A canvas that the bloom can draw on and read from. A browser canvas fits, and so does a
 * canvas of a Node library with the same API.
 */
export interface BloomCanvas {
    width: number
    height: number
    getContext(kind: '2d'): unknown
}

export interface BloomLayer {
    readonly canvas: BloomCanvas
    readonly ctx: Canvas2D
    readonly factor: number
    readonly weight: number
}

/** The size divisor and the weight of each layer, from the tightest glow to the widest. */
const LAYERS = [[4, 0.55], [8, 0.3], [16, 0.15]] as const

/** The blur of each layer in its own pixels, for an output that is 1920 wide. */
const SIGMAS = [2.83, 3.65, 3.65]

/** Make the small canvases that hold the glow of a picture of this size. Make them again when the size changes. */
export function createBloomLayers(width: number, height: number, makeCanvas: (width: number, height: number) => BloomCanvas): BloomLayer[] {
    return LAYERS.map(([factor, weight]) => {
        const canvas = makeCanvas(Math.max(1, Math.round(width / factor)), Math.max(1, Math.round(height / factor)))
        const ctx = canvas.getContext('2d') as Canvas2D | null
        if (!ctx) throw new Error('The bloom could not create a 2D canvas for a layer.')
        return { canvas, ctx, factor, weight }
    })
}

/**
 * Bright marks spill soft light. The layers hold marks only, so the background never lifts.
 *
 * `main` is the context of the finished picture, `source` is its canvas, and `width` and `height`
 * are the size of that canvas in pixels. The browser player and the Node export both call this
 * function, so a preview and an exported movie show the same glow.
 *
 * `blurScale` corrects a canvas library that draws `filter: blur()` at another width than a
 * browser does. A browser needs none, so the player does not give it.
 */
export function applyBloom(
    main: Canvas2D,
    source: CanvasImageSource,
    width: number,
    height: number,
    frame: Pick<Frame, 'bloom' | 'background'>,
    layers: readonly BloomLayer[],
    blurScale = 1,
): void {
    const hasFilter = 'filter' in main
    // The first layer copies the finished picture and subtracts the background, so busy
    // frames are not painted twice. Blurring small layers is far cheaper than blurring
    // the full canvas. The blur follows the output width, so a small preview and a 4K master
    // spread the light alike.
    let from: CanvasImageSource = source
    layers.forEach((layer, index) => {
        const { ctx, canvas } = layer
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'medium'
        if (hasFilter) ctx.filter = `blur(${(SIGMAS[index]! * width / 1920 * blurScale).toFixed(2)}px)`
        ctx.drawImage(from, 0, 0, canvas.width, canvas.height)
        if (hasFilter) ctx.filter = 'none'
        if (index === 0 && frame.background) {
            ctx.globalCompositeOperation = 'difference'
            ctx.fillStyle = frame.background
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.globalCompositeOperation = 'source-over'
        }
        from = canvas as unknown as CanvasImageSource
    })
    main.setTransform(1, 0, 0, 1, 0, 0)
    main.globalCompositeOperation = 'screen'
    main.imageSmoothingEnabled = true
    main.imageSmoothingQuality = 'high'
    for (const layer of layers) {
        main.globalAlpha = Math.min(1, frame.bloom * layer.weight * 2.4)
        main.drawImage(layer.canvas as unknown as CanvasImageSource, 0, 0, width, height)
    }
    main.globalAlpha = 1
    main.globalCompositeOperation = 'source-over'
}
