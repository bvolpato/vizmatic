import { pathBounds, type Path, type Ring } from './geometry'
import { css, isGradient, sampleStops, type Paint, type Rgba } from './color'
import type { BlendMode, StageImage } from './node'
import { browserImageSource, ImageAssetError } from './image'
import { pixelCanvas } from './pixels'
import { glowBounds, glowOf, glowProfile, type Frame } from './display'

// ── Canvas backend ──────────────────────────────────────────────────────────

export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const path2dCache = new WeakMap<Path & object, Path2D>()

function ringsToPath2D(path: Path): Path2D {
    let cached = path2dCache.get(path as Path & object)
    if (cached) return cached
    cached = new Path2D()
    for (const r of path as readonly Ring[]) {
        const p = r.p
        if (p.length < 2) continue
        cached.moveTo(p[0]!, p[1]!)
        if (r.straight) for (let o = 2; o + 5 < p.length; o += 6) cached.lineTo(p[o + 4]!, p[o + 5]!)
        else for (let o = 2; o + 5 < p.length; o += 6) cached.bezierCurveTo(p[o]!, p[o + 1]!, p[o + 2]!, p[o + 3]!, p[o + 4]!, p[o + 5]!)
        if (r.closed) cached.closePath()
    }
    path2dCache.set(path as Path & object, cached)
    return cached
}

function canvasPaint(ctx: Canvas2D, paint: Paint): string | CanvasGradient {
    if (!isGradient(paint)) return css(paint as Rgba)
    const gradient = paint.type === 'linear'
        ? ctx.createLinearGradient(paint.from[0], paint.from[1], paint.to[0], paint.to[1])
        : paint.type === 'radial'
            ? ctx.createRadialGradient(paint.center[0], paint.center[1], 0, paint.center[0], paint.center[1], paint.radius)
            : null
    if (!gradient) return css(sampleStops(paint.stops, 0.5))
    for (const [at, color] of paint.stops) gradient.addColorStop(at, css(color))
    return gradient
}

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
    normal: 'source-over', screen: 'screen', multiply: 'multiply', overlay: 'overlay',
}

export interface ImageLookup {
    (image: StageImage): CanvasImageSource | null
}

/** The last dim copy of each picture. A light is still for most frames, so the next frame asks for the same copy. */
const dimCopies = new WeakMap<object, { key: string; copy: CanvasImageSource }>()

/**
 * A copy of a picture, or of its crop, with each pixel mixed toward the backdrop. It paints the backdrop
 * over the picture and keeps the alpha of the picture, which is what the color matrix of the SVG does.
 */
function dimCopy(source: CanvasImageSource, image: StageImage, dim: number, backdrop: Rgba): CanvasImageSource {
    const crop = image.crop
    const width = Math.max(1, Math.ceil(crop?.width ?? image.asset?.width ?? image.width)), height = Math.max(1, Math.ceil(crop?.height ?? image.asset?.height ?? image.height))
    const key = [dim, backdrop[0], backdrop[1], backdrop[2], crop?.x, crop?.y, width, height].join(' ')
    const kept = dimCopies.get(source)
    if (kept?.key === key) return kept.copy
    const copy = typeof OffscreenCanvas === 'undefined' ? Object.assign(document.createElement('canvas'), { width, height }) : new OffscreenCanvas(width, height)
    const pen = copy.getContext('2d') as Canvas2D
    if (crop) pen.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
    else pen.drawImage(source, 0, 0, width, height)
    pen.globalCompositeOperation = 'source-atop'
    pen.globalAlpha = 1 - dim
    pen.fillStyle = css([backdrop[0], backdrop[1], backdrop[2], 1])
    pen.fillRect(0, 0, width, height)
    dimCopies.set(source, { key, copy })
    return copy
}

/** Paint a frame to a 2D context at a device scale. Same result as the SVG backend. */
export function paintFrame(ctx: Canvas2D, frame: Frame, scale = 1, images?: ImageLookup): void {
    // Isolate retained paint state so earlier gradients cannot alter later glows.
    ctx.save()
    try {
        paintFrameContents(ctx, frame, scale, images)
    } finally {
        ctx.restore()
    }
}

function paintFrameContents(ctx: Canvas2D, frame: Frame, scale: number, images?: ImageLookup): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, frame.width * scale, frame.height * scale)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    if (frame.background) {
        ctx.fillStyle = frame.background
        ctx.fillRect(0, 0, frame.width, frame.height)
    }
    // Adjacent marks from a clipped group share its paths, even when their clip arrays differ.
    let activeClips: readonly Path[] | undefined
    try {
        for (const op of frame.ops) {
            const clips = op.clips?.length ? op.clips : undefined
            if (clips !== activeClips && (clips?.length !== activeClips?.length || clips?.some((clip, i) => clip !== activeClips?.[i]))) {
                if (activeClips) ctx.restore()
                activeClips = clips
                if (clips) {
                    ctx.save()
                    for (const clip of clips) ctx.clip(ringsToPath2D(clip))
                }
            }
            if (op.kind === 'image') {
                const source = op.image.pixels ? pixelCanvas(op.image.pixels, op.dim !== undefined && op.dim < 1 ? undefined : op.node) : images?.(op.image) ?? browserImageSource(op.image.asset)
                if (!source) throw new ImageAssetError('Image pixels are unavailable. Await image preparation and provide an ImageLookup outside the browser.')
                const m = op.matrix
                ctx.save()
                ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
                ctx.globalAlpha = op.alpha
                ctx.globalCompositeOperation = BLEND[op.blend ?? 'normal']
                const crop = op.image.crop
                if (op.dim !== undefined && op.dim < 1 && op.backdrop) ctx.drawImage(dimCopy(source, op.image, op.dim, op.backdrop), 0, 0, op.image.width, op.image.height)
                else if (crop) ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, op.image.width, op.image.height)
                else ctx.drawImage(source, 0, 0, op.image.width, op.image.height)
                ctx.restore()
                continue
            }
            ctx.globalCompositeOperation = BLEND[op.blend]
            if (op.glow > 0) {
                const color = glowOf(op)
                const path = op.strokePath.length ? op.strokePath : op.path
                const profile = glowProfile(op)
                const rawBounds = pathBounds(path)
                const bounds = rawBounds ? glowBounds(path, profile.width, profile.sigma, frame) : null
                if (color && rawBounds && bounds) {
                    const base = Math.max(op.fillAlpha, op.strokeAlpha) * color[3] * (frame.dark ? 1 : 0.22)
                    ctx.save()
                    // Bound the filter's intermediate surface, especially on CPU-backed canvases.
                    ctx.beginPath()
                    ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height)
                    ctx.clip()
                    ctx.globalCompositeOperation = frame.dark ? 'screen' : 'source-over'
                    ctx.globalAlpha = profile.alpha * base
                    ctx.strokeStyle = css([color[0], color[1], color[2], 1])
                    ctx.lineCap = 'round'
                    ctx.lineJoin = 'round'
                    ctx.lineWidth = profile.width
                    ctx.setLineDash([])
                    // shadowBlur uses sigma = blur / 2 in device pixels, unaffected by setTransform.
                    // Drawing only the shadow is faster than ctx.filter on CPU canvases and also works without filter support.
                    const offset = (frame.width - rawBounds.x + profile.width / 2 + 4 * profile.sigma) * scale
                    ctx.setTransform(scale, 0, 0, scale, offset, 0)
                    ctx.shadowColor = ctx.strokeStyle
                    ctx.shadowBlur = 2 * profile.sigma * scale
                    ctx.shadowOffsetX = -offset
                    ctx.shadowOffsetY = 0
                    ctx.stroke(ringsToPath2D(path))
                    ctx.restore()
                }
            }
            if (op.fill) {
                ctx.globalAlpha = op.fillAlpha
                ctx.fillStyle = canvasPaint(ctx, op.fill)
                ctx.fill(ringsToPath2D(op.path))
            }
            if (op.stroke && op.strokePath.length) {
                ctx.globalAlpha = op.strokeAlpha
                ctx.strokeStyle = canvasPaint(ctx, op.stroke)
                ctx.lineWidth = op.strokeWidth
                ctx.lineCap = op.cap
                ctx.lineJoin = op.join
                ctx.setLineDash(op.dash ? [...op.dash] : [])
                ctx.lineDashOffset = op.dashOffset
                ctx.stroke(ringsToPath2D(op.strokePath))
            }
        }
    } finally {
        if (activeClips) ctx.restore()
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
}
