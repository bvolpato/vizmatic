export interface BloomLayer {
    canvas: HTMLCanvasElement
    ctx: CanvasRenderingContext2D
    factor: number
    weight: number
}

/**
 * Paint multi-layer bloom onto `target` in place. Layers hold marks above the background
 * only (`max(0, pixel - background)` via `lighten` + `difference`), so dark marks on
 * non-black dark looks such as blueprint (`#0b1526`) never glow positive.
 */
export function paintCanvasBloom(
    target: HTMLCanvasElement,
    main: CanvasRenderingContext2D,
    bloom: number,
    background: string | null,
    existingLayers: BloomLayer[],
    createCanvas: (width: number, height: number) => HTMLCanvasElement = (w, h) => {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        return canvas
    },
): BloomLayer[] {
    const { width, height } = target
    const layers = existingLayers.length > 0 && existingLayers[0]!.canvas.width === Math.max(1, Math.round(width / 4))
        && existingLayers[0]!.canvas.height === Math.max(1, Math.round(height / 4))
        ? existingLayers
        : ([[4, 0.55], [8, 0.3], [16, 0.15]] as const).map(([factor, weight]) => {
            const canvas = createCanvas(Math.max(1, Math.round(width / factor)), Math.max(1, Math.round(height / factor)))
            return { canvas, ctx: canvas.getContext('2d')!, factor, weight }
        })
    const hasFilter = 'filter' in main
    // The first layer copies the finished picture and subtracts the background, so busy
    // frames are not painted twice. Blurring small layers is far cheaper than blurring
    // the full canvas. The widths match the exporter's blur at the same output size.
    const sigmas = [2.83, 3.65, 3.65]
    let source: HTMLCanvasElement = target
    layers.forEach((layer, index) => {
        const { ctx, canvas } = layer
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'medium'
        if (hasFilter) ctx.filter = `blur(${(sigmas[index]! * width / 1920).toFixed(2)}px)`
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
        if (hasFilter) ctx.filter = 'none'
        if (index === 0 && background) {
            ctx.globalCompositeOperation = 'lighten'
            ctx.fillStyle = background
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.globalCompositeOperation = 'difference'
            ctx.fillStyle = background
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.globalCompositeOperation = 'source-over'
        }
        source = canvas
    })
    main.setTransform(1, 0, 0, 1, 0, 0)
    main.globalCompositeOperation = 'screen'
    main.imageSmoothingEnabled = true
    main.imageSmoothingQuality = 'high'
    for (const layer of layers) {
        main.globalAlpha = Math.min(1, bloom * layer.weight * 2.4)
        main.drawImage(layer.canvas, 0, 0, width, height)
    }
    main.globalAlpha = 1
    main.globalCompositeOperation = 'source-over'
    return layers
}
