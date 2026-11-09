import { arcPath, circlePath, curveThrough, linePath, parametricPath, parseSvgPath, polyPath, rectPath, smoothPath, transformPath, type Path, type Vec } from './geometry'
import { toPaint, type ColorInput } from './color'
import { Node, objectName } from './node'
import { imageFromAsset, type ImageAsset, type ImageFitOptions } from './image'

export interface ShapeStyle {
    fill?: ColorInput | null
    stroke?: ColorInput | null
    width?: number
    opacity?: number
    glow?: number
    dash?: readonly number[]
    z?: number
}

function styled<T extends Node>(node: T, style: ShapeStyle, defaults: ShapeStyle): T {
    const fill = style.fill !== undefined ? style.fill : defaults.fill
    const stroke = style.stroke !== undefined ? style.stroke : defaults.stroke
    if (fill) node.fill(fill)
    if (stroke) node.stroke(stroke, style.width ?? defaults.width ?? 3)
    if (style.opacity !== undefined) node.opacity(style.opacity)
    if (style.glow) node.glow(style.glow)
    if (style.dash) node.dash(style.dash)
    if (style.z !== undefined) node.zIndex(style.z)
    return node
}

/** Wrap any path as a stroked shape in the default ink. */
export function shape(path: Path, style: ShapeStyle = {}): Node {
    return styled(new Node(path), style, { stroke: 'ink' })
}

export function svgPath(d: string, style: ShapeStyle = {}): Node {
    return shape(parseSvgPath(d), style)
}

export function line(a: Vec, b: Vec, style: ShapeStyle = {}): Node {
    return styled(new Node(linePath(a, b)), style, { stroke: 'ink' })
}

export function polyline(points: readonly Vec[], style: ShapeStyle & { closed?: boolean } = {}): Node {
    return styled(new Node(polyPath(points, style.closed)), style, { stroke: 'ink' })
}

/** A smooth curve through points. Non-finite points leave gaps. */
export function curve(points: readonly Vec[], style: ShapeStyle & { closed?: boolean } = {}): Node {
    return styled(new Node(style.closed ? smoothPath(points, true) : curveThrough(points)), style, { stroke: 'ink' })
}

export function parametric(f: (t: number) => Vec, from: number, to: number, style: ShapeStyle & { samples?: number } = {}): Node {
    return styled(new Node(parametricPath(f, from, to, style.samples ?? 96)), style, { stroke: 'ink' })
}

export function circle(radius: number, style: ShapeStyle = {}): Node {
    return styled(new Node(circlePath(0, 0, radius)), style, { stroke: 'ink' })
}

export function ellipse(rx: number, ry: number, style: ShapeStyle = {}): Node {
    return styled(new Node(arcPath(0, 0, rx, ry, 0, Math.PI * 2)), style, { stroke: 'ink' })
}

export function arc(radius: number, from: number, to: number, style: ShapeStyle = {}): Node {
    return styled(new Node(arcPath(0, 0, radius, radius, from, to)), style, { stroke: 'ink' })
}

export function rect(width: number, height: number, style: ShapeStyle & { radius?: number } = {}): Node {
    return styled(new Node(rectPath(-width / 2, -height / 2, width, height, style.radius ?? 0)), style, { stroke: 'ink' })
}

export function polygon(points: readonly Vec[], style: ShapeStyle = {}): Node {
    return styled(new Node(polyPath(points, true)), style, { stroke: 'ink' })
}

export function regularPolygon(sides: number, radius: number, style: ShapeStyle = {}): Node {
    const points: Vec[] = []
    for (let i = 0; i < sides; i++) {
        const angle = -Math.PI / 2 + (i / sides) * Math.PI * 2
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
    }
    return polygon(points, style)
}

export interface ImageOptions extends ImageFitOptions {
    /** Width on the stage. With only one of width and height, the other keeps the picture's proportions. */
    width?: number
    height?: number
    opacity?: number
}

/** Pixel size of a PNG, GIF, or JPEG held in a base64 data URL. Other sources return null. */
function intrinsicSize(src: string): [number, number] | null {
    const match = /^data:image\/(png|gif|jpeg|jpg);base64,/.exec(src)
    if (!match || typeof atob !== 'function') return null
    // Sizes sit near the start of PNG and GIF files. A JPEG may carry metadata first.
    // A slice of base64 that starts at the data and has a length divisible by four decodes on its own.
    let head: string
    try {
        head = atob(src.slice(match[0].length, match[0].length + (match[1] === 'jpeg' || match[1] === 'jpg' ? 87384 : 44)))
    } catch {
        return null
    }
    const byte = (i: number) => head.charCodeAt(i)
    if (match[1] === 'png') return head.length >= 24 ? [byte(16) * 16777216 + byte(17) * 65536 + byte(18) * 256 + byte(19), byte(20) * 16777216 + byte(21) * 65536 + byte(22) * 256 + byte(23)] : null
    if (match[1] === 'gif') return head.length >= 10 ? [byte(6) + byte(7) * 256, byte(8) + byte(9) * 256] : null
    for (let i = 2; i + 9 < head.length;) {
        if (byte(i) !== 0xff) return null
        const marker = byte(i + 1)
        // A start-of-frame segment holds the height, then the width.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [byte(i + 7) * 256 + byte(i + 8), byte(i + 5) * 256 + byte(i + 6)]
        i += 2 + byte(i + 2) * 256 + byte(i + 3)
    }
    return null
}

/**
 * A raster picture, such as a logo or a photo, centered on its origin. `src` is a URL or a
 * data URL. A data URL keeps a film in one file and renders the same in every tool.
 * It fades, moves, and scales like any node. Give `width`, `height`, or both.
 */
export function image(src: string | ImageAsset, options: ImageOptions = {}): Node {
    if (typeof src !== 'string') {
        const node = imageFromAsset(src, options)
        if (options.opacity !== undefined) node.opacity(options.opacity)
        return node
    }
    if (options.crop !== undefined || options.fit !== undefined) throw new Error('Await resolveImageAsset before using image fit or crop options.')
    const natural = intrinsicSize(src)
    let width = options.width, height = options.height
    if (width === undefined && height === undefined) {
        if (!natural) throw new Error('image() needs a width or a height when the picture is not a PNG, GIF, or JPEG data URL.')
        ;[width, height] = natural
    } else if (width === undefined || height === undefined) {
        if (!natural) throw new Error('image() needs both width and height when the picture is not a PNG, GIF, or JPEG data URL.')
        if (width === undefined) width = height! * natural[0] / natural[1]
        else height = width * natural[1] / natural[0]
    }
    if (!(width! > 0) || !(height! > 0)) throw new Error('image() needs a positive width and height.')
    const picture = new Node().at(-width! / 2, -height! / 2)
    picture.base.image = { src, width: width!, height: height! }
    const out = new Node()
    out.add(picture)
    if (options.opacity !== undefined) out.opacity(options.opacity)
    return out
}

/** A filled point. */
export function dot(radius = 9, color: ColorInput = 'ink', style: ShapeStyle = {}): Node {
    return styled(new Node(circlePath(0, 0, radius)), style, { fill: color })
}

export interface ArrowStyle extends ShapeStyle {
    /** Tip length in pixels. */
    tip?: number
    /** Tip width relative to its length. */
    tipRatio?: number
    /** Curve the shaft: positive bends left of the direction of travel. */
    bend?: number
    /** Space left at each end, so arrows stop short of what they point at. */
    pad?: number
    both?: boolean
}

/**
 * A shaft and a clean tip as one group. The shaft ends at the tip's base, so a
 * thick line never pokes through the point.
 */
export function arrow(from: Vec, to: Vec, style: ArrowStyle = {}): Node {
    const color = style.stroke ?? 'ink'
    const width = style.width ?? 3
    const tip = style.tip ?? Math.max(13, width * 4.2)
    const ratio = style.tipRatio ?? 0.72
    const pad = style.pad ?? 0
    let dx = to[0] - from[0], dy = to[1] - from[1]
    const length = Math.hypot(dx, dy) || 1
    dx /= length
    dy /= length
    const start: Vec = [from[0] + dx * pad, from[1] + dy * pad]
    const end: Vec = [to[0] - dx * pad, to[1] - dy * pad]
    const span = Math.max(0, length - pad * 2)
    const usableTip = Math.min(tip, span * 0.45)
    const group = new Node()
    const bend = style.bend ?? 0
    const normal: Vec = [-dy, dx]
    const control: Vec = [(start[0] + end[0]) / 2 + normal[0] * bend, (start[1] + end[1]) / 2 + normal[1] * bend]
    // The tip points along the curve's direction at its end.
    let tx = end[0] - control[0], ty = end[1] - control[1]
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl
    ty /= tl
    const baseX = end[0] - tx * usableTip, baseY = end[1] - ty * usableTip
    const shaftPath: Path = bend === 0
        ? linePath(style.both ? [start[0] + dx * usableTip, start[1] + dy * usableTip] : start, [baseX, baseY])
        : parseSvgPath(`M${start[0]} ${start[1]}Q${control[0]} ${control[1]} ${baseX} ${baseY}`)
    const shaft = new Node(shaftPath).stroke(color, width)
    if (style.dash) shaft.dash(style.dash)
    const half = usableTip * ratio / 2
    const head = (x: number, y: number, ux: number, uy: number) => new Node(polyPath([
        [x, y],
        [x - ux * usableTip - uy * half, y - uy * usableTip + ux * half],
        [x - ux * usableTip + uy * half, y - uy * usableTip - ux * half],
    ], true)).fill(color)
    group.add(shaft, head(end[0], end[1], tx, ty))
    if (style.both) group.add(head(start[0], start[1], -dx, -dy))
    if (style.opacity !== undefined) group.opacity(style.opacity)
    if (style.glow) {
        shaft.glow(style.glow)
    }
    group.data['shaft'] = shaft
    // The head is a filled shape, and the arrow is a line: it may pass a label of a plot, as a curve does.
    group.data['line'] = true
    return objectName(group, 'arrow')
}

/** Curly brace beside a span of two points, pointing out to one side. */
export function brace(from: Vec, to: Vec, style: ShapeStyle & { depth?: number } = {}): Node {
    const dx = to[0] - from[0], dy = to[1] - from[1]
    const length = Math.hypot(dx, dy) || 1
    const depth = style.depth ?? Math.min(26, 10 + length * 0.05)
    // A filled silhouette, thick in the middle and fine at the tips.
    const l = length, d = depth, t = 1.6
    const c = Math.min(d, l / 4)
    const data = `M0 0C0 ${d * 0.5} ${c * 0.4} ${d * 0.5} ${c} ${d * 0.5}L${l / 2 - c} ${d * 0.5}C${l / 2 - c * 0.3} ${d * 0.5} ${l / 2} ${d * 0.72} ${l / 2} ${d}`
        + `C${l / 2} ${d * 0.72} ${l / 2 + c * 0.3} ${d * 0.5} ${l / 2 + c} ${d * 0.5}L${l - c} ${d * 0.5}C${l - c * 0.4} ${d * 0.5} ${l} ${d * 0.5} ${l} 0`
        + `L${l - t * 0.2} ${t * 0.2}C${l - t * 0.4} ${d * 0.5 - t} ${l - c * 0.4} ${d * 0.5 - t} ${l - c} ${d * 0.5 - t}L${l / 2 + c} ${d * 0.5 - t}C${l / 2 + c * 0.3} ${d * 0.5 - t} ${l / 2 + t * 0.4} ${d * 0.6} ${l / 2} ${d * 0.82}`
        + `C${l / 2 - t * 0.4} ${d * 0.6} ${l / 2 - c * 0.3} ${d * 0.5 - t} ${l / 2 - c} ${d * 0.5 - t}L${c} ${d * 0.5 - t}C${c * 0.4} ${d * 0.5 - t} ${t * 0.4} ${d * 0.5 - t} ${t * 0.2} ${t * 0.2}Z`
    const cos = dx / length, sin = dy / length
    const path = transformPath(parseSvgPath(data), [cos, sin, -sin, cos, from[0], from[1]])
    const node = styled(new Node(path), { ...style, width: undefined }, { fill: style.stroke ?? style.fill ?? 'ink' })
    node.data['tip'] = [(from[0] + to[0]) / 2 - sin * depth, (from[1] + to[1]) / 2 + cos * depth]
    // A brace is a line that is drawn as a filled shape. The film check takes it as a line.
    node.data['line'] = true
    return objectName(node, 'brace')
}

export { toPaint }
