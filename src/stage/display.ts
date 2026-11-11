import {
    apply, compose, matScale, mul, pathBounds, pathLength, pathToD, transformPath, trimPath,
    type Mat, type Path, type Ring,
} from './geometry'
import { css, dimPaint, isGradient, sampleStops, type Gradient, type Paint, type Rgba } from './color'
import { drawNow, type BlendMode, type Node, type StageImage } from './node'
import { browserImageSource, imageHasVisiblePixels, ImageAssetError } from './image'
import { drawnDim } from './light'


export interface PathOp {
    readonly kind: 'path'
    readonly path: Path
    /** Stroke geometry when it differs from the fill, such as during a partial draw. */
    readonly strokePath: Path
    readonly fill: Paint | null
    readonly fillAlpha: number
    readonly stroke: Paint | null
    readonly strokeAlpha: number
    readonly strokeWidth: number
    readonly cap: 'round' | 'butt' | 'square'
    readonly join: 'round' | 'miter' | 'bevel'
    readonly dash: readonly number[] | null
    readonly dashOffset: number
    readonly glow: number
    readonly glowColor: Rgba | null
    readonly blend: BlendMode
    /** The node that produced this mark, for checks and tools. */
    readonly node?: Node
}

export interface ImageOp {
    readonly kind: 'image'
    readonly image: StageImage
    readonly matrix: Mat
    readonly alpha: number
    readonly node?: Node
    /**
     * A dim picture: each pixel keeps this part of its color, and the rest of it is `backdrop`. The alpha of
     * each pixel stays, so the clear parts of the picture stay clear.
     */
    readonly dim?: number
    readonly backdrop?: Rgba
}

export type DrawOp = PathOp | ImageOp

export interface Frame {
    readonly width: number
    readonly height: number
    readonly background: string | null
    readonly bloom: number
    readonly ops: readonly DrawOp[]
    readonly dark: boolean
}

export interface CameraState {
    readonly x: number
    readonly y: number
    readonly zoom: number
    readonly rotation: number
}

const ALONG_PIECE_LENGTH = 14
const MAX_ALONG_PIECES = 96

function worldPaint(paint: Paint | null, m: Mat): Paint | null {
    if (!paint || !isGradient(paint)) return paint
    if (paint.type === 'linear') {
        return { ...paint, from: apply(m, paint.from[0], paint.from[1]), to: apply(m, paint.to[0], paint.to[1]) }
    }
    if (paint.type === 'radial') {
        return { ...paint, center: apply(m, paint.center[0], paint.center[1]), radius: paint.radius * matScale(m) }
    }
    return paint
}

function sameMatrix(a: Mat, b: Mat): boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5]
}

interface WorldCache {
    path: Path
    matrix: Mat
    world: Path
}

const worldCache = new WeakMap<Node, WorldCache>()

function toWorld(node: Node, path: Path, m: Mat): Path {
    const cached = worldCache.get(node)
    if (cached && cached.path === path && sameMatrix(cached.matrix, m)) return cached.world
    const world = transformPath(path, m)
    worldCache.set(node, { path, matrix: m, world })
    return world
}

function emit(node: Node, path: Path, m: Mat, alpha: number, ops: DrawOp[]): void {
    const fill = node.get('fill')
    const stroke = node.get('stroke')
    const fillAlpha = fill ? alpha * node.get('fillOpacity') : 0
    const strokeAlpha = stroke ? alpha * node.get('strokeOpacity') : 0
    const glow = node.get('glow')
    if (fillAlpha <= 0.002 && strokeAlpha <= 0.002 && glow <= 0) return
    const world = toWorld(node, path, m)
    const scale = matScale(m)
    const trimFrom = node.get('trimFrom'), trimTo = node.get('trimTo')
    let strokePath = world
    if (trimFrom > 0 || trimTo < 1) strokePath = trimPath(world, trimFrom, trimTo, node.get('trimEach'))
    if (strokePath.length === 0 && fillAlpha <= 0.002) return
    const dash = node.get('dash')
    const op: PathOp = {
        kind: 'path',
        path: world,
        strokePath,
        fill: fillAlpha > 0.002 ? worldPaint(fill, m) : null,
        fillAlpha,
        stroke: strokeAlpha > 0.002 ? worldPaint(stroke, m) : null,
        strokeAlpha,
        strokeWidth: node.get('strokeWidth') * scale,
        cap: node.get('cap'),
        join: node.get('join'),
        dash: dash ? dash.map((value) => value * scale) : null,
        dashOffset: node.get('dashOffset') * scale,
        glow: glow * scale,
        glowColor: node.get('glowColor'),
        blend: node.get('blend'),
        node,
    }
    if (op.stroke && isGradient(op.stroke) && op.stroke.type === 'along') splitAlong(op, op.stroke, ops)
    else ops.push(op)
}

/** A stroke whose color changes along its length draws as short solid pieces. */
function splitAlong(op: PathOp, paint: Gradient, ops: DrawOp[]): void {
    ops.push({ ...op, stroke: null, strokeAlpha: 0 })
    const glowless = { ...op, fill: null, fillAlpha: 0, glow: 0 }
    const length = pathLength(op.strokePath)
    const full = pathLength(op.path)
    if (length === 0) return
    const fraction = full > 0 ? Math.min(1, length / full) : 1
    const pieces = Math.min(MAX_ALONG_PIECES, Math.max(2, Math.ceil(length / ALONG_PIECE_LENGTH)))
    const overlap = 0.6 / pieces
    for (let i = 0; i < pieces; i++) {
        const from = i / pieces, to = Math.min(1, (i + 1) / pieces + overlap)
        const piece = trimPath(op.strokePath, from, to)
        if (piece.length === 0) continue
        ops.push({
            ...glowless,
            strokePath: piece,
            path: piece,
            stroke: sampleStops(paint.stops, ((i + 0.5) / pieces) * fraction),
            cap: i === 0 || i === pieces - 1 ? op.cap : 'butt',
        })
    }
}

/** What is the same for every node of one frame. */
interface Pass {
    readonly screen: Mat
    /** The color that a dim node goes toward: the background of the film. */
    readonly backdrop: Rgba
    /** The node that each mark of a verb belongs to, in a film with a light. */
    readonly marks: ReadonlyMap<Node, Node> | null
    readonly ops: DrawOp[]
}

/**
 * Dim the marks that one node drew, which are `ops` from `first` on. Each paint goes toward the backdrop and
 * no alpha changes, so a dim plate still hides the line behind it. A picture has no paint to mix: the
 * painter mixes its pixels.
 */
function dimOps(ops: DrawOp[], first: number, dim: number, backdrop: Rgba): void {
    for (let i = first; i < ops.length; i++) {
        const op = ops[i]!
        ops[i] = op.kind === 'image' ? { ...op, dim, backdrop } : {
            ...op,
            fill: op.fill && dimPaint(op.fill, dim, backdrop),
            stroke: op.stroke && dimPaint(op.stroke, dim, backdrop),
            // A glow with no color of its own takes the dim color of the stroke or the fill.
            glowColor: op.glowColor && dimPaint(op.glowColor, dim, backdrop) as Rgba,
        }
    }
}

/** The `dim` that a mark of a verb takes from the node that it belongs to, so that it is as bright as that node. */
function markDim(node: Node, marks: ReadonlyMap<Node, Node>): number {
    const target = marks.get(node)
    return target ? Math.min(drawnDim(target), markDim(target, marks)) : 1
}

/**
 * `alpha` is the product of the opacities above the node. `dim` is the least `dim` above it: opacities
 * multiply along a branch, and a node in a dim group is not dimmed a second time.
 */
function walk(node: Node, parent: Mat, alpha: number, dim: number, pass: Pass): void {
    if (!node.get('visible')) return
    const opacity = node.get('opacity') * alpha
    if (opacity <= 0.002) return
    const { screen, ops, marks } = pass
    const least = Math.min(node.get('dim'), dim, marks ? markDim(node, marks) : 1)
    const base = node.get('fixed') ? screen : parent
    const m = mul(base, node.localMatrix())
    const first = ops.length
    const path = node.get('path')
    if (path && path.length > 0) emit(node, path, m, opacity, ops)
    const image = node.get('image')
    if (image) ops.push({ kind: 'image', image, matrix: m, alpha: opacity, node })
    if (node.rawOps) node.rawOps(m, opacity, ops)
    if (least < 1) dimOps(ops, first, least, pass.backdrop)
    if (node.draw) {
        const built = drawNow(node)
        if (built) {
            const list: readonly Node[] = Array.isArray(built) ? built as readonly Node[] : [built as Node]
            for (const child of list) {
                child.drawer = node
                walk(child, m, opacity, least, pass)
            }
        }
    }
    const children = node.children
    if (children.length === 0) return
    let sorted = false
    for (let i = 0; i < children.length; i++) {
        if (children[i]!.get('z') !== 0) {
            sorted = true
            break
        }
    }
    const ordered = sorted ? children.map((child, index) => ({ child, index, z: child.get('z') }))
        .sort((a, b) => a.z - b.z || a.index - b.index).map((entry) => entry.child) : children
    for (const child of ordered) walk(child, m, opacity, least, pass)
}

/**
 * The draw list of a tree. `backdrop` is the color that a dim node goes toward, and `marks` gives the node
 * that each mark of a verb is as bright as. They have an effect only in a film with a light, where
 * `spotlight` gives nodes a `dim` under 1.
 */
export function buildOps(root: Node, camera: CameraState, width: number, height: number, backdrop: Rgba = [0, 0, 0, 1], marks: ReadonlyMap<Node, Node> | null = null): DrawOp[] {
    // The root is one node, such as the root of a stage. A block of the layout and a list are not.
    if (typeof (root as { localMatrix?: unknown } | null)?.localMatrix !== 'function') throw new Error('buildOps: the root is not a node. Give one node, such as the root of a stage, or a group of the nodes: group(block)')
    const screen: Mat = [1, 0, 0, 1, width / 2, height / 2]
    const view = mul(screen, compose(0, 0, -camera.rotation, camera.zoom, camera.zoom, camera.x, camera.y))
    const ops: DrawOp[] = []
    walk(root, view, 1, 1, { screen, backdrop, marks, ops })
    return ops
}

// ── Glow ────────────────────────────────────────────────────────────────────

const GLOW_PASSES = 7

/** Passes of a soft glow, from widest to narrowest, with weights that sum to a gentle core. */
function glowPasses(glow: number, width: number): { width: number; alpha: number }[] {
    const out: { width: number; alpha: number }[] = []
    for (let i = GLOW_PASSES; i >= 1; i--) {
        const k = i / GLOW_PASSES
        out.push({ width: width + glow * 2 * k, alpha: 0.16 * (1 - k) * (1 - k) + 0.018 })
    }
    return out
}

function glowOf(op: PathOp): Rgba | null {
    if (op.glowColor) return op.glowColor
    const paint = op.stroke ?? op.fill
    if (!paint) return null
    return isGradient(paint) ? sampleStops(paint.stops, 0.5) : paint as Rgba
}

// ── SVG backend ─────────────────────────────────────────────────────────────

const dCache = new WeakMap<Path & object, string>()

function pathData(path: Path): string {
    let d = dCache.get(path as Path & object)
    if (d === undefined) {
        d = pathToD(path)
        dCache.set(path as Path & object, d)
    }
    return d
}

function fmt(value: number): string {
    return String(Math.round(value * 1000) / 1000)
}

/** A number for a color matrix, where a thousandth is more than one step of a color. */
function exact(value: number): string {
    return String(Math.round(value * 1e6) / 1e6)
}

function gradientDef(id: string, paint: Gradient): string {
    const stops = paint.stops.map(([at, color]) =>
        `<stop offset="${fmt(at)}" stop-color="${css([color[0], color[1], color[2], 1])}"${color[3] < 1 ? ` stop-opacity="${fmt(color[3])}"` : ''}/>`).join('')
    if (paint.type === 'linear') {
        return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(paint.from[0])}" y1="${fmt(paint.from[1])}" x2="${fmt(paint.to[0])}" y2="${fmt(paint.to[1])}">${stops}</linearGradient>`
    }
    if (paint.type === 'radial') {
        return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(paint.center[0])}" cy="${fmt(paint.center[1])}" r="${fmt(paint.radius)}">${stops}</radialGradient>`
    }
    return ''
}

function strokeAttrs(op: PathOp): string {
    let attrs = ` stroke-linecap="${op.cap}" stroke-linejoin="${op.join}"`
    if (op.dash) attrs += ` stroke-dasharray="${op.dash.map(fmt).join(' ')}" stroke-dashoffset="${fmt(op.dashOffset)}"`
    return attrs
}

function escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Serialize a frame to standalone SVG. Text is already outlines, so no fonts are needed. */
export function frameToSvg(frame: Frame, options: { scale?: number; transparent?: boolean } = {}): string {
    const scale = options.scale ?? 1
    const w = frame.width, h = frame.height
    const defs: string[] = []
    const body: string[] = []
    let gradientCount = 0, dimCount = 0
    const paintAttr = (paint: Paint, attr: 'fill' | 'stroke', alpha: number): string => {
        if (isGradient(paint)) {
            const id = `g${gradientCount++}`
            defs.push(gradientDef(id, paint))
            return `${attr}="url(#${id})"${alpha < 1 ? ` ${attr}-opacity="${fmt(alpha)}"` : ''}`
        }
        const rgba = paint as Rgba
        const a = rgba[3] * alpha
        return `${attr}="${css([rgba[0], rgba[1], rgba[2], 1])}"${a < 1 ? ` ${attr}-opacity="${fmt(a)}"` : ''}`
    }
    if (frame.background && !options.transparent) body.push(`<rect width="${w}" height="${h}" fill="${frame.background}"/>`)
    for (const op of frame.ops) {
        if (op.kind === 'image') {
            const m = op.matrix
            const { image } = op, crop = image.crop
            if (crop && !image.asset) throw new ImageAssetError('Cropped image SVG needs a prepared image asset.')
            const picture = `<image href="${escapeAttr(image.src)}" width="${crop ? image.asset!.width : image.width}" height="${crop ? image.asset!.height : image.height}" preserveAspectRatio="none"/>`
            const content = crop
                ? `<svg width="${fmt(image.width)}" height="${fmt(image.height)}" viewBox="${[crop.x, crop.y, crop.width, crop.height].map(fmt).join(' ')}" preserveAspectRatio="none" overflow="hidden">${picture}</svg>`
                : picture
            let filter = ''
            if (op.dim !== undefined && op.dim < 1 && op.backdrop) {
                // Each color is `dim` of the pixel and the rest of the backdrop. The alpha row is as it is, so clear pixels stay clear.
                const id = `d${dimCount++}`, keep = exact(op.dim)
                const [r, g, b] = [0, 1, 2].map((i) => exact((1 - op.dim!) * op.backdrop![i]! / 255))
                defs.push(`<filter id="${id}" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${keep} 0 0 0 ${r} 0 ${keep} 0 0 ${g} 0 0 ${keep} 0 ${b} 0 0 0 1 0"/></filter>`)
                filter = ` filter="url(#${id})"`
            }
            body.push(`<g transform="matrix(${m.map(fmt).join(' ')})"${op.alpha < 1 ? ` opacity="${fmt(op.alpha)}"` : ''}${filter}>${content}</g>`)
            continue
        }
        const style = op.blend !== 'normal' ? ` style="mix-blend-mode:${op.blend}"` : ''
        if (op.glow > 0) {
            const color = glowOf(op)
            const glowD = pathData(op.strokePath.length ? op.strokePath : op.path)
            if (color && glowD) {
                const base = Math.max(op.fillAlpha, op.strokeAlpha)
                const mode = frame.dark ? ' style="mix-blend-mode:screen"' : ''
                const passes = glowPasses(op.glow, op.stroke ? op.strokeWidth : 0)
                    .map((pass) => `<path d="${glowD}" fill="none" stroke="${css([color[0], color[1], color[2], 1])}" stroke-opacity="${fmt(pass.alpha * base)}" stroke-width="${fmt(pass.width)}" stroke-linecap="round" stroke-linejoin="round"/>`)
                    .join('')
                body.push(`<g${mode}>${passes}</g>`)
            }
        }
        if (op.fill && op.stroke && op.strokePath === op.path) {
            body.push(`<path d="${pathData(op.path)}" ${paintAttr(op.fill, 'fill', op.fillAlpha)} ${paintAttr(op.stroke, 'stroke', op.strokeAlpha)} stroke-width="${fmt(op.strokeWidth)}"${strokeAttrs(op)}${style}/>`)
            continue
        }
        if (op.fill) body.push(`<path d="${pathData(op.path)}" ${paintAttr(op.fill, 'fill', op.fillAlpha)}${style}/>`)
        if (op.stroke && op.strokePath.length) {
            body.push(`<path d="${pathData(op.strokePath)}" fill="none" ${paintAttr(op.stroke, 'stroke', op.strokeAlpha)} stroke-width="${fmt(op.strokeWidth)}"${strokeAttrs(op)}${style}/>`)
        }
    }
    const defsBlock = defs.length ? `<defs>${defs.join('')}</defs>` : ''
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">${defsBlock}${body.join('')}</svg>`
}

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
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, frame.width * scale, frame.height * scale)
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    if (frame.background) {
        ctx.fillStyle = frame.background
        ctx.fillRect(0, 0, frame.width, frame.height)
    }
    for (const op of frame.ops) {
        if (op.kind === 'image') {
            const source = images?.(op.image) ?? browserImageSource(op.image.asset)
            if (!source) throw new ImageAssetError('Image pixels are unavailable. Await image preparation and provide an ImageLookup outside the browser.')
            const m = op.matrix
            ctx.save()
            ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
            ctx.globalAlpha = op.alpha
            ctx.globalCompositeOperation = 'source-over'
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
            if (color) {
                const base = Math.max(op.fillAlpha, op.strokeAlpha)
                const previous = ctx.globalCompositeOperation
                if (frame.dark) ctx.globalCompositeOperation = 'screen'
                ctx.strokeStyle = css([color[0], color[1], color[2], 1])
                ctx.lineCap = 'round'
                ctx.lineJoin = 'round'
                ctx.setLineDash([])
                const glowPath = ringsToPath2D(op.strokePath.length ? op.strokePath : op.path)
                for (const pass of glowPasses(op.glow, op.stroke ? op.strokeWidth : 0)) {
                    ctx.globalAlpha = pass.alpha * base
                    ctx.lineWidth = pass.width
                    ctx.stroke(glowPath)
                }
                ctx.globalCompositeOperation = previous
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
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
}

/** Pixel-space bounds of a frame's ink, used by checks for off-canvas marks. */
export function frameInkBounds(frame: Frame): { x: number; y: number; width: number; height: number } | null {
    let result: { x: number; y: number; width: number; height: number } | null = null
    for (const op of frame.ops) {
        if (op.kind === 'image' && !imageHasVisiblePixels(op.image.asset, op.image.crop)) continue
        const b = op.kind === 'image' ? imageOpBounds(op) : pathBounds(op.path)
        if (!b) continue
        const pad = op.kind === 'path' && op.stroke ? op.strokeWidth / 2 : 0
        const next = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 }
        if (!result) result = next
        else {
            const x = Math.min(result.x, next.x), y = Math.min(result.y, next.y)
            result = { x, y, width: Math.max(result.x + result.width, next.x + next.width) - x, height: Math.max(result.y + result.height, next.y + next.height) - y }
        }
    }
    return result
}

/** Destination bounds after the node and camera transforms, in frame pixels. */
export function imageOpBounds(op: ImageOp): { x: number; y: number; width: number; height: number } {
    const { width, height } = op.image
    const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => apply(op.matrix, x, y))
    const xs = corners.map(p => p[0]), ys = corners.map(p => p[1])
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

