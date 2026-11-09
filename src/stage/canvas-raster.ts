/**
 * Node export on a canvas. The painter of the browser player draws each frame on a canvas of
 * `skia-canvas`, and the bloom of the player adds the glow. So an exported movie shows what the
 * preview shows. The canvas uses the GPU when the machine has one, and the CPU when it has none.
 *
 * This is a prototype. `VIZMATIC_RENDERER=canvas` turns it on.
 */
import { createRequire } from 'node:module'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { applyBloom, createBloomLayers, type BloomLayer } from './bloom'
import { parseColor } from './color'
import { paintFrame, usePath2D, type Canvas2D, type Frame } from './display'
import { sameFrame } from './frame-equal'
import type { StageImage } from './node'

/** Turns draw lists into RGBA pixels. The SVG renderer and the canvas renderer both fit. */
export interface FrameRenderer {
    /** How many frames the renderer works on at one time. */
    readonly size: number
    /** A short name for reports, such as `canvas (GPU, Metal)`. */
    readonly label: string
    /**
     * Rasterize one frame. More than one draw list is one frame with motion blur: the result is
     * their average. With `reuse`, a frame that repeats the frame before returns the same array,
     * so the caller must not change the pixels.
     */
    render(frames: readonly Frame[], width: number, height: number, options?: { reuse?: boolean }): Promise<Uint8Array>
    close(): Promise<void>
    /** Counters and times in milliseconds, for a report of where a render spends its time. */
    readonly stats?: Record<string, number>
}

/** The part of `skia-canvas` that this file uses. Each call but the last four is standard Canvas 2D. */
interface NodeCanvas {
    width: number
    height: number
    getContext(kind: '2d'): Canvas2D & { reset?: () => void }
    /** Not standard: start a read of the pixels on a thread of the library, from the picture as it is now. */
    toBuffer(format: 'raw', options: { premultiplied?: boolean; msaa?: boolean | number }): Promise<Uint8Array>
    /** Not standard: read the pixels now. */
    toBufferSync(format: 'raw', options: { premultiplied?: boolean; msaa?: boolean | number }): Uint8Array
    /** Not standard: which renderer the canvas uses. */
    readonly engine: { renderer: 'CPU' | 'GPU'; api: string | null; device: string; threads: number; error?: string | null }
    /** Not standard: free the native memory now. */
    dispose?: () => void
}

interface CanvasLibrary {
    Canvas: new (width: number, height: number, options?: { gpu?: boolean }) => NodeCanvas
    Path2D: typeof Path2D
    /** Not standard: decode a picture from a data URI. */
    loadImage(source: string): Promise<CanvasImageSource>
}

const PACKAGE = 'skia-canvas'

function loadLibrary(): CanvasLibrary {
    const here = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
    try {
        return createRequire(here)(PACKAGE) as CanvasLibrary
    } catch (error) {
        const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
        throw new Error(
            `VIZMATIC_RENDERER=canvas needs the package ${PACKAGE}, and Node could not load it (${reason}). `
            + `Install it beside vizmatic with "npm install ${PACKAGE}". It has a compiled part for macOS, Linux and Windows on x64 and arm64. `
            + 'To use the default renderer, remove VIZMATIC_RENDERER from the environment.',
            { cause: error },
        )
    }
}

/**
 * How much wider the library must be asked to blur, so that a picture drawn through `filter: blur()`
 * gets the width that a browser gives.
 *
 * A browser blurs `blur(8px)` with a standard deviation of 8 pixels. skia-canvas 4.0 blurs a shape
 * at that width, and a picture drawn with `drawImage` at half of it. The bloom blurs pictures, so
 * its glow would be too narrow. This measures the width one time, on the CPU, so that the answer is
 * the same on each machine and stays right when the library changes.
 */
function blurScaleOf(library: CanvasLibrary): number {
    const width = 128, height = 64, asked = 8
    const line = new library.Canvas(width, height, { gpu: false })
    const lineCtx = line.getContext('2d')
    lineCtx.fillStyle = '#000'
    lineCtx.fillRect(0, 0, width, height)
    lineCtx.fillStyle = '#fff'
    lineCtx.fillRect(width / 2 - 1, 0, 2, height)
    const blurred = new library.Canvas(width, height, { gpu: false })
    const ctx = blurred.getContext('2d')
    ctx.filter = `blur(${asked}px)`
    ctx.drawImage(line as unknown as CanvasImageSource, 0, 0)
    const pixels = blurred.toBufferSync('raw', { premultiplied: true, msaa: false })
    line.dispose?.()
    blurred.dispose?.()
    // The spread of the middle row is the standard deviation of the blur.
    let sum = 0, mean = 0, variance = 0
    const at = (x: number) => pixels[((height / 2) * width + x) * 4]!
    for (let x = 0; x < width; x++) {
        sum += at(x)
        mean += at(x) * x
    }
    if (sum === 0) return 1
    mean /= sum
    for (let x = 0; x < width; x++) variance += at(x) * (x - mean) ** 2
    const measured = Math.sqrt(variance / sum)
    // The blur of a library is an approximation, so it is a little narrower than asked. Half is the known defect.
    return measured < asked * 0.72 ? 2 : 1
}

interface Surface {
    readonly canvas: NodeCanvas
    readonly ctx: Canvas2D & { reset?: () => void }
    /** A second canvas of the same size, for the sub-frames of motion blur. */
    scratch: { canvas: NodeCanvas; ctx: Canvas2D & { reset?: () => void } } | null
    layers: BloomLayer[] | null
}

/** Frames in flight on a GPU. More than this did not raise the speed on an Apple GPU, because one device does the work. */
const GPU_DEPTH = 3

export class CanvasRenderer implements FrameRenderer {
    readonly size: number
    readonly label: string
    readonly gpu: boolean
    readonly stats = { frames: 0, painted: 0, reused: 0, subframes: 0, compareMs: 0, paintMs: 0 }
    private readonly library: CanvasLibrary
    private readonly blurScale: number
    private readonly surfaces = new Map<string, Surface>()
    private readonly images = new Map<object | string, CanvasImageSource>()
    private last: { frames: readonly Frame[]; width: number; height: number; pixels: Promise<Uint8Array> } | null = null
    /** Paints run one after the other, because they share the canvases. The reads of the pixels overlap. */
    private turn: Promise<void> = Promise.resolve()

    constructor(requested?: number) {
        this.library = loadLibrary()
        usePath2D(this.library.Path2D)
        this.blurScale = blurScaleOf(this.library)
        // A canvas says which renderer it got. Without a usable GPU, the library falls back to the CPU by itself.
        const wantGpu = !['0', 'false', 'off'].includes((process.env.VIZMATIC_CANVAS_GPU ?? '1').trim().toLowerCase())
        const probe = new this.library.Canvas(2, 2, { gpu: wantGpu })
        const engine = probe.engine
        probe.dispose?.()
        this.gpu = engine.renderer === 'GPU'
        this.label = this.gpu ? `canvas (GPU, ${engine.api})` : `canvas (CPU${wantGpu && engine.error ? `, no GPU: ${engine.error}` : ''})`
        // On the CPU, each frame in flight uses one thread of the library, so more of them use more cores.
        const most = this.gpu ? GPU_DEPTH : Math.max(1, Math.min(12, cpus().length - 2, engine.threads))
        const forced = Number(process.env.VIZMATIC_CANVAS_DEPTH)
        this.size = Number.isInteger(forced) && forced > 0 ? forced : Math.max(1, Math.min(most, Math.floor(requested ?? most)))
    }

    render(frames: readonly Frame[], width: number, height: number, options: { reuse?: boolean } = {}): Promise<Uint8Array> {
        const started = this.turn.then(() => this.start(frames, width, height, options.reuse === true))
        this.turn = started.then(() => undefined, () => undefined)
        return started.then((job) => job.pixels)
    }

    /** Paint a frame and start the read of its pixels. The result is in an object, so that the next paint does not wait for the read. */
    private async start(frames: readonly Frame[], width: number, height: number, reuse: boolean): Promise<{ pixels: Promise<Uint8Array> }> {
        const first = frames[0]
        if (!first) throw new Error('A frame needs at least one draw list.')
        this.stats.frames++
        let t0 = performance.now()
        const last = this.last
        // VIZMATIC_CANVAS_REUSE=0 is for measurements only: it paints each frame, also one that repeats.
        if (process.env.VIZMATIC_CANVAS_REUSE === '0') reuse = false
        const repeats = reuse && last !== null && last.width === width && last.height === height
            && last.frames.length === frames.length && frames.every((frame, index) => sameFrame(last.frames[index]!, frame))
        // A picture that holds through the shutter needs one paint and no blur.
        const moving = !repeats && frames.length > 1 && !frames.every((frame) => sameFrame(first, frame))
        this.stats.compareMs += performance.now() - t0
        if (repeats) {
            this.stats.reused++
            return { pixels: last!.pixels }
        }
        await this.prepareImages(frames)
        t0 = performance.now()
        const surface = this.surface(width, height)
        const opaque = first.background !== null && parseColor(first.background)[3] === 1
        let pixels: Promise<Uint8Array>
        if (!moving) {
            this.paint(surface, first, width, height)
            this.bloom(surface, first, width, height)
            pixels = this.read(surface.canvas, opaque)
            this.stats.subframes++
        } else if (opaque) {
            // Motion blur as a running average on the canvas: sub-frame k goes over the sum with
            // alpha 1/(k+1). A part of the picture that does not move keeps its exact value, so the
            // blur adds no bands there. Measured on a soft light that moves: on the GPU, the part
            // that moves is within 2 of 255 of the exact average, and not darker on average. On the
            // CPU, it is 1 to 3 darker with 4 sub-frames, and 2 to 4 with 8. This needs an opaque
            // picture: over a transparent one, the same blend keeps too much of the sum.
            const scratch = surface.scratch ??= this.blank(width, height)
            const ctx = surface.ctx
            ctx.reset?.()
            frames.forEach((frame, index) => {
                this.paint(scratch, frame, width, height)
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.globalCompositeOperation = 'source-over'
                ctx.globalAlpha = 1 / (index + 1)
                ctx.drawImage(scratch.canvas as unknown as CanvasImageSource, 0, 0)
            })
            ctx.globalAlpha = 1
            this.bloom(surface, first, width, height)
            pixels = this.read(surface.canvas, true)
            this.stats.subframes += frames.length
        } else {
            // This way reads the canvas several times, so the next paint waits until it ends.
            pixels = Promise.resolve(await this.averageInJavaScript(surface, frames, width, height))
            this.stats.subframes += frames.length
        }
        this.stats.painted++
        this.stats.paintMs += performance.now() - t0
        // A failed read reports to the caller that awaits it. Without this, Node reports it a second time.
        pixels.catch(() => {})
        this.last = reuse ? { frames, width, height, pixels } : null
        return { pixels }
    }

    /**
     * Motion blur over a transparent background: read each sub-frame and average the bytes, as the
     * SVG renderer does. It is the slow way, and it is exact.
     */
    private async averageInJavaScript(surface: Surface, frames: readonly Frame[], width: number, height: number): Promise<Uint8Array> {
        const sum = new Uint16Array(width * height * 4)
        for (const frame of frames) {
            this.paint(surface, frame, width, height)
            const pixels = await this.read(surface.canvas, false)
            for (let i = 0; i < sum.length; i++) sum[i]! += pixels[i]!
        }
        const count = frames.length
        const average = new Uint8ClampedArray(sum.length)
        for (let i = 0; i < sum.length; i++) average[i] = sum[i]! / count
        const first = frames[0]!
        if (!(first.dark && first.bloom > 0)) return new Uint8Array(average.buffer)
        const ctx = surface.ctx
        ctx.reset?.()
        const data = ctx.createImageData(width, height)
        data.data.set(average)
        ctx.putImageData(data, 0, 0)
        this.bloom(surface, first, width, height)
        return this.read(surface.canvas, false)
    }

    private paint(target: { canvas: NodeCanvas; ctx: Canvas2D & { reset?: () => void } }, frame: Frame, width: number, height: number): void {
        const { ctx } = target
        // The canvas keeps a list of what was drawn. A reset empties the list, so it does not grow with each frame.
        ctx.reset?.()
        const scale = width / frame.width
        // An MP4 needs an even height, so the canvas can be one row taller than the picture.
        if (frame.background && height > frame.height * scale) {
            ctx.fillStyle = frame.background
            ctx.fillRect(0, 0, width, height)
        }
        paintFrame(ctx, frame, scale, this.lookup)
    }

    private bloom(surface: Surface, frame: Frame, width: number, height: number): void {
        if (!(frame.dark && frame.bloom > 0)) return
        surface.layers ??= createBloomLayers(width, height, (layerWidth, layerHeight) => new this.library.Canvas(layerWidth, layerHeight, { gpu: this.gpu }))
        applyBloom(surface.ctx, surface.canvas as unknown as CanvasImageSource, width, height, frame, surface.layers, this.blurScale)
    }

    private read(canvas: NodeCanvas, opaque: boolean): Promise<Uint8Array> {
        // An opaque picture has the same bytes with and without premultiplied alpha, and the library skips one pass.
        // `msaa: false` asks the GPU for the antialiasing of the shaders. It is the one that a canvas drawn
        // on another canvas gets, so a frame with motion blur and a frame without it have the same edges.
        // VIZMATIC_CANVAS_MSAA is for measurements only: it asks the GPU for that many samples for each pixel.
        const samples = Number(process.env.VIZMATIC_CANVAS_MSAA)
        return canvas.toBuffer('raw', { premultiplied: opaque, msaa: this.gpu && Number.isInteger(samples) && samples > 0 ? samples : false })
    }

    private blank(width: number, height: number): { canvas: NodeCanvas; ctx: Canvas2D & { reset?: () => void } } {
        const canvas = new this.library.Canvas(width, height, { gpu: this.gpu })
        return { canvas, ctx: canvas.getContext('2d') }
    }

    private surface(width: number, height: number): Surface {
        const key = `${width}x${height}`
        let surface = this.surfaces.get(key)
        if (!surface) {
            surface = { ...this.blank(width, height), scratch: null, layers: null }
            this.surfaces.set(key, surface)
        }
        return surface
    }

    private readonly lookup = (image: StageImage): CanvasImageSource | null => this.images.get(image.asset ?? image.src) ?? null

    private async prepareImages(frames: readonly Frame[]): Promise<void> {
        for (const frame of frames) {
            for (const op of frame.ops) {
                if (op.kind !== 'image') continue
                const key = op.image.asset ?? op.image.src
                if (this.images.has(key)) continue
                try {
                    this.images.set(key, await this.library.loadImage(op.image.asset?.src ?? op.image.src))
                } catch (error) {
                    throw new Error(`The canvas renderer could not decode an image of the film: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
                }
            }
        }
    }

    async close(): Promise<void> {
        // A read that is still in flight keeps its own copy of the picture, so the canvases can go now.
        await this.turn
        for (const surface of this.surfaces.values()) {
            surface.canvas.dispose?.()
            surface.scratch?.canvas.dispose?.()
            for (const layer of surface.layers ?? []) (layer.canvas as NodeCanvas).dispose?.()
        }
        this.surfaces.clear()
        this.images.clear()
        this.last = null
    }
}
