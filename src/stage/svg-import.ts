import { apply, IDENTITY, matScale, mul, parseSvgPath, pathBounds, rectPath, arcPath, polyPath, transformPath, type Mat, type Path, type Ring } from './geometry'
import { Node, type StageImage } from './node'
import { parseColor, type Paint, type Rgba } from './color'
import { text } from './text'

interface XmlElement {
    name: string
    attrs: Record<string, string>
    children: XmlElement[]
    text: string
}

function decode(value: string): string {
    return value
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
        .replace(/&#x([\da-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&amp;/g, '&')
}

/** A small XML reader, enough for SVG. It has no DOM dependency, so it runs anywhere. */
function parseXml(source: string): XmlElement {
    const root: XmlElement = { name: '#root', attrs: {}, children: [], text: '' }
    const stack = [root]
    const token = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
    for (let match = token.exec(source); match; match = token.exec(source)) {
        const top = stack[stack.length - 1]!
        const [, cdata, closing, opening, attributes, selfClosing, content] = match
        if (cdata !== undefined) {
            top.text += cdata
        } else if (closing) {
            if (stack.length > 1) stack.pop()
        } else if (opening) {
            const element: XmlElement = { name: opening.replace(/^.*:/, ''), attrs: {}, children: [], text: '' }
            for (const attr of (attributes ?? '').matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
                element.attrs[attr[1]!] = decode(attr[2] ?? attr[3] ?? '')
            }
            top.children.push(element)
            if (!selfClosing) stack.push(element)
        } else if (content) {
            top.text += decode(content)
        }
    }
    return root
}

function parseTransform(value: string | undefined): Mat {
    if (!value) return IDENTITY
    let m: Mat = IDENTITY
    for (const match of value.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
        const a = match[2]!.trim().split(/[\s,]+/).filter(Boolean).map(Number)
        const name = match[1]
        if (name === 'matrix' && a.length === 6) m = mul(m, a as unknown as Mat)
        else if (name === 'translate') m = mul(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0])
        else if (name === 'scale') m = mul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0])
        else if (name === 'rotate') {
            const r = (a[0] ?? 0) * Math.PI / 180
            const c = Math.cos(r), s = Math.sin(r)
            const cx = a[1] ?? 0, cy = a[2] ?? 0
            m = mul(m, [1, 0, 0, 1, cx, cy])
            m = mul(m, [c, s, -s, c, 0, 0])
            m = mul(m, [1, 0, 0, 1, -cx, -cy])
        } else if (name === 'skewX') m = mul(m, [1, 0, Math.tan((a[0] ?? 0) * Math.PI / 180), 1, 0, 0])
        else if (name === 'skewY') m = mul(m, [1, Math.tan((a[0] ?? 0) * Math.PI / 180), 0, 1, 0, 0])
    }
    return m
}

interface InheritedStyle {
    fill: string | null
    stroke: string | null
    strokeWidth: number
    fillOpacity: number
    strokeOpacity: number
    cap: 'round' | 'butt' | 'square'
    join: 'round' | 'miter' | 'bevel'
    dash: readonly number[] | null
    dashOffset: number
    color: string
    fontSize: number
    anchor: string
}

const NOT_DRAWN = new Set(['defs', 'clipPath', 'mask', 'pattern', 'filter', 'symbol', 'marker', 'linearGradient', 'radialGradient', 'title', 'desc', 'metadata', 'style', 'script'])

export interface FromSvgOptions {
    /** Fit into this box, keeping proportions. Defaults to the SVG's own size. */
    width?: number
    height?: number
    /** Center the picture on the node's origin. On by default. */
    center?: boolean
    /** Keep a full-canvas background rectangle. Films have their own, so it is dropped by default. */
    background?: boolean
    /** Split filled multi-glyph outlines into one node per glyph, so text writes letter by letter. */
    splitGlyphs?: boolean
}

/** An imported picture. It is a regular node tree, so every verb works on it. */
export class SvgNode extends Node {
    readonly byId = new Map<string, Node>()
    pictureWidth = 0
    pictureHeight = 0

    /** Find an element by its SVG id. */
    find(id: string): Node {
        const found = this.byId.get(id)
        if (!found) throw new Error(`The SVG has no element with id ${JSON.stringify(id)}.`)
        return found
    }
}

function parseCssRules(root: XmlElement): Map<string, Record<string, string>> {
    const rules = new Map<string, Record<string, string>>()
    const visit = (element: XmlElement) => {
        if (element.name === 'style') {
            for (const rule of element.text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                const body = parseStyle(rule[2]!)
                for (const selector of rule[1]!.split(',')) {
                    const key = selector.trim()
                    rules.set(key, { ...rules.get(key), ...body })
                }
            }
        }
        element.children.forEach(visit)
    }
    visit(root)
    return rules
}

function parseStyle(value: string | undefined): Record<string, string> {
    const out: Record<string, string> = {}
    if (!value) return out
    for (const part of value.split(';')) {
        const index = part.indexOf(':')
        if (index > 0) out[part.slice(0, index).trim()] = part.slice(index + 1).trim()
    }
    return out
}

function safeColor(value: string | null | undefined): Rgba | null {
    if (!value || value === 'none' || value === 'transparent') return null
    try {
        return parseColor(value)
    } catch {
        return null
    }
}

/** Group a compound outline's rings into glyphs: a ring inside another belongs with it. */
function splitIntoGlyphs(path: Path): Path[] {
    const items = path.map((r) => {
        const b = pathBounds([r])!
        return { ring: r, b, area: b.width * b.height, owner: -1 }
    })
    const order = items.map((_, i) => i).sort((a, b) => items[b]!.area - items[a]!.area)
    for (let k = 0; k < order.length; k++) {
        const inner = items[order[k]!]!
        for (let j = k - 1; j >= 0; j--) {
            const outer = items[order[j]!]!
            if (outer.owner !== -1) continue
            const inside = inner.b.x >= outer.b.x - 0.01 && inner.b.y >= outer.b.y - 0.01
                && inner.b.x + inner.b.width <= outer.b.x + outer.b.width + 0.01
                && inner.b.y + inner.b.height <= outer.b.y + outer.b.height + 0.01
            if (inside) {
                inner.owner = order[j]!
                break
            }
        }
    }
    const glyphs: { x: number; rings: Ring[] }[] = []
    const ownerToGlyph = new Map<number, { x: number; rings: Ring[] }>()
    items.forEach((item, i) => {
        if (item.owner !== -1) return
        const glyph = { x: item.b.x, rings: [item.ring] }
        ownerToGlyph.set(i, glyph)
        glyphs.push(glyph)
    })
    items.forEach((item) => {
        if (item.owner !== -1) ownerToGlyph.get(item.owner)?.rings.push(item.ring)
    })
    return glyphs.sort((a, b) => a.x - b.x).map((glyph) => glyph.rings)
}

/**
 * Turn SVG markup into stage nodes. Each shape becomes a leaf whose origin is its
 * center, so it can be drawn, faded, scaled, and morphed like anything else.
 * Filters and masks are skipped, because shapes draw without them.
 */
export function fromSvg(source: string, options: FromSvgOptions = {}): SvgNode {
    const root = parseXml(source)
    const svg = root.children.find((child) => child.name === 'svg')
    if (!svg) throw new Error('fromSvg needs markup with an <svg> element.')
    const rules = parseCssRules(svg)
    const defs = new Map<string, XmlElement>()
    const index = (element: XmlElement) => {
        if (element.attrs['id']) defs.set(element.attrs['id'], element)
        element.children.forEach(index)
    }
    index(svg)
    const box = (svg.attrs['viewBox'] ?? '').trim().split(/[\s,]+/).map(Number)
    const declaredW = parseFloat(svg.attrs['width'] ?? ''), declaredH = parseFloat(svg.attrs['height'] ?? '')
    const viewW = box.length === 4 && box[2] ? box[2]! : declaredW || 300
    const viewH = box.length === 4 && box[3] ? box[3]! : declaredH || 150
    const viewX = box.length === 4 ? box[0]! : 0, viewY = box.length === 4 ? box[1]! : 0
    const naturalW = Number.isFinite(declaredW) && declaredW > 0 ? declaredW : viewW
    const naturalH = Number.isFinite(declaredH) && declaredH > 0 ? declaredH : viewH
    let scale = 1
    if (options.width !== undefined || options.height !== undefined) {
        const sx = options.width !== undefined ? options.width / viewW : Infinity
        const sy = options.height !== undefined ? options.height / viewH : Infinity
        scale = Math.min(sx, sy)
    } else {
        scale = Math.min(naturalW / viewW, naturalH / viewH)
    }
    const center = options.center ?? true
    const offsetX = center ? -(viewX + viewW / 2) * scale : -viewX * scale
    const offsetY = center ? -(viewY + viewH / 2) * scale : -viewY * scale
    const base: Mat = [scale, 0, 0, scale, offsetX, offsetY]
    const out = new SvgNode()
    out.pictureWidth = viewW * scale
    out.pictureHeight = viewH * scale
    const splitting = options.splitGlyphs ?? true
    const keepBackground = options.background ?? false
    let firstShape = true

    const gradientOf = (id: string, m: Mat, path: Path): Paint | null => {
        const element = defs.get(id)
        if (!element) return null
        if (element.name === 'pattern') {
            // Satori wraps gradients in a pattern: the fill spans the shape's own box.
            const inner = element.children.find((child) => child.name === 'linearGradient')
            if (inner) return linear(inner, m, path, true)
            const fill = element.children.find((child) => child.attrs['fill']?.startsWith('url(#'))
            const nested = fill?.attrs['fill']?.match(/url\(#([^)]+)\)/)?.[1]
            return nested ? gradientOf(nested, m, path) : null
        }
        if (element.name === 'linearGradient') return linear(element, m, path, element.attrs['gradientUnits'] !== 'userSpaceOnUse')
        if (element.name === 'radialGradient') {
            const stops = stopsOf(element)
            return stops.length ? stops[stops.length - 1]![1] : null
        }
        return null
    }

    const stopsOf = (element: XmlElement): (readonly [number, Rgba])[] => {
        const inherited = element.attrs['href'] ?? element.attrs['xlink:href']
        const source = element.children.some((child) => child.name === 'stop') || !inherited ? element : defs.get(inherited.replace(/^#/, '')) ?? element
        return source.children.filter((child) => child.name === 'stop').map((stop) => {
            const style = parseStyle(stop.attrs['style'])
            const offsetRaw = stop.attrs['offset'] ?? '0'
            const offset = offsetRaw.endsWith('%') ? parseFloat(offsetRaw) / 100 : parseFloat(offsetRaw)
            const color = safeColor(style['stop-color'] ?? stop.attrs['stop-color'] ?? '#000000') ?? [0, 0, 0, 1] as Rgba
            const alpha = parseFloat(style['stop-opacity'] ?? stop.attrs['stop-opacity'] ?? '1')
            return [offset, [color[0], color[1], color[2], color[3] * alpha] as Rgba] as const
        })
    }

    const linear = (element: XmlElement, m: Mat, path: Path, objectBox: boolean): Paint | null => {
        const stops = stopsOf(element)
        if (stops.length === 0) return null
        const coordinate = (value: string | undefined, fallback: number) => {
            if (value === undefined) return fallback
            return value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value)
        }
        const x1 = coordinate(element.attrs['x1'], 0), y1 = coordinate(element.attrs['y1'], 0)
        const x2 = coordinate(element.attrs['x2'], 1), y2 = coordinate(element.attrs['y2'], 0)
        let from: readonly [number, number], to: readonly [number, number]
        if (objectBox) {
            const b = pathBounds(path) ?? { x: 0, y: 0, width: 1, height: 1 }
            from = [b.x + x1 * b.width, b.y + y1 * b.height]
            to = [b.x + x2 * b.width, b.y + y2 * b.height]
        } else {
            from = apply(m, x1, y1)
            to = apply(m, x2, y2)
        }
        return { type: 'linear', from, to, stops }
    }

    const shapePath = (element: XmlElement): Path | null => {
        const a = element.attrs
        const num = (key: string, fallback = 0) => {
            const value = parseFloat(a[key] ?? '')
            return Number.isFinite(value) ? value : fallback
        }
        switch (element.name) {
            case 'path': return a['d'] ? parseSvgPath(a['d']) : null
            case 'rect': {
                const w = num('width'), h = num('height')
                if (w <= 0 || h <= 0) return null
                return rectPath(num('x'), num('y'), w, h, num('rx', num('ry')))
            }
            case 'circle': return num('r') > 0 ? arcPath(num('cx'), num('cy'), num('r'), num('r'), 0, Math.PI * 2) : null
            case 'ellipse': return num('rx') > 0 && num('ry') > 0 ? arcPath(num('cx'), num('cy'), num('rx'), num('ry'), 0, Math.PI * 2) : null
            case 'line': return polyPath([[num('x1'), num('y1')], [num('x2'), num('y2')]])
            case 'polyline':
            case 'polygon': {
                const values = (a['points'] ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number)
                const points: [number, number][] = []
                for (let i = 0; i + 1 < values.length; i += 2) points.push([values[i]!, values[i + 1]!])
                return points.length >= 2 ? polyPath(points, element.name === 'polygon') : null
            }
            default: return null
        }
    }

    const styleOf = (element: XmlElement, inherited: InheritedStyle): { style: InheritedStyle; opacity: number } => {
        const a = element.attrs
        const cls = (a['class'] ?? '').split(/\s+/).filter(Boolean)
        const merged: Record<string, string> = { ...rules.get(element.name) }
        for (const name of cls) Object.assign(merged, rules.get(`.${name}`))
        if (a['id']) Object.assign(merged, rules.get(`#${a['id']}`))
        const pick = (key: string): string | undefined => parseStyle(a['style'])[key] ?? a[key] ?? merged[key]
        const style: InheritedStyle = { ...inherited }
        const color = pick('color')
        if (color) style.color = color
        const fill = pick('fill')
        if (fill) style.fill = fill === 'currentColor' ? style.color : fill
        const stroke = pick('stroke')
        if (stroke) style.stroke = stroke === 'currentColor' ? style.color : stroke
        const width = pick('stroke-width')
        if (width !== undefined) style.strokeWidth = parseFloat(width) || 0
        const fo = pick('fill-opacity')
        if (fo !== undefined) style.fillOpacity = parseFloat(fo)
        const so = pick('stroke-opacity')
        if (so !== undefined) style.strokeOpacity = parseFloat(so)
        const cap = pick('stroke-linecap')
        if (cap === 'round' || cap === 'butt' || cap === 'square') style.cap = cap
        const join = pick('stroke-linejoin')
        if (join === 'round' || join === 'miter' || join === 'bevel') style.join = join
        const dash = pick('stroke-dasharray')
        if (dash !== undefined) style.dash = dash === 'none' ? null : dash.trim().split(/[\s,]+/).map(Number)
        const dashOffset = pick('stroke-dashoffset')
        if (dashOffset !== undefined) style.dashOffset = parseFloat(dashOffset) || 0
        const size = pick('font-size')
        if (size !== undefined) style.fontSize = parseFloat(size) || style.fontSize
        const anchor = pick('text-anchor')
        if (anchor) style.anchor = anchor
        return { style, opacity: parseFloat(pick('opacity') ?? '1') }
    }

    const leafFrom = (path: Path, m: Mat, element: XmlElement, style: InheritedStyle): Node[] => {
        const world = transformPath(path, m)
        const scaleOf = matScale(m)
        const url = (value: string | null) => value?.match(/^url\(#([^)]+)\)/)?.[1]
        const fillId = url(style.fill), strokeId = url(style.stroke)
        const fill: Paint | null = fillId ? gradientOf(fillId, m, world) : safeColor(style.fill)
        const stroke: Paint | null = strokeId ? gradientOf(strokeId, m, world) : safeColor(style.stroke)
        const visibleFill = fill && style.fillOpacity > 0 && !(Array.isArray(fill) && (fill as unknown as Rgba)[3] === 0)
        const visibleStroke = stroke && style.strokeOpacity > 0 && style.strokeWidth > 0 && !(Array.isArray(stroke) && (stroke as unknown as Rgba)[3] === 0)
        if (!visibleFill && !visibleStroke) return []
        // A stroke clipped to its own outline shows only its inner half.
        const clippedStroke = element.attrs['clip-path'] ? 0.5 : 1
        const pieces = splitting && visibleFill && !visibleStroke && world.length > 1 ? splitIntoGlyphs(world) : [world]
        return pieces.map((piece) => {
            const b = pathBounds(piece) ?? { x: 0, y: 0, width: 0, height: 0 }
            const cx = b.x + b.width / 2, cy = b.y + b.height / 2
            const leaf = new Node(transformPath(piece, [1, 0, 0, 1, -cx, -cy])).at(cx, cy)
            if (visibleFill) {
                leaf.base.fill = shiftPaint(fill!, -cx, -cy)
                leaf.base.fillOpacity = style.fillOpacity
            }
            if (visibleStroke) {
                leaf.base.stroke = shiftPaint(stroke!, -cx, -cy)
                leaf.base.strokeWidth = style.strokeWidth * scaleOf * clippedStroke
                leaf.base.strokeOpacity = style.strokeOpacity
                leaf.base.cap = style.cap
                leaf.base.join = style.join
                if (style.dash) leaf.base.dash = style.dash.map((value) => value * scaleOf)
                leaf.base.dashOffset = style.dashOffset * scaleOf
            }
            leaf.base.trimEach = true
            return leaf
        })
    }

    const walk = (element: XmlElement, parent: Node, inherited: InheritedStyle, parentMatrix: Mat): void => {
        if (NOT_DRAWN.has(element.name)) return
        // Filter groups in Satori output hold soft shadows that need a blur to look right.
        if (element.attrs['filter']) return
        const { style, opacity } = styleOf(element, inherited)
        const m = mul(parentMatrix, parseTransform(element.attrs['transform']))
        const register = (node: Node) => {
            if (element.attrs['id']) out.byId.set(element.attrs['id'], node)
        }
        if (element.name === 'g' || element.name === 'svg' || element.name === 'a') {
            const group = new Node()
            if (opacity < 1) group.base.opacity = opacity
            register(group)
            parent.add(group)
            for (const child of element.children) walk(child, group, style, m)
            return
        }
        if (element.name === 'use') {
            const href = (element.attrs['href'] ?? element.attrs['xlink:href'] ?? '').replace(/^#/, '')
            const referenced = defs.get(href)
            if (!referenced) return
            const placed = mul(m, [1, 0, 0, 1, parseFloat(element.attrs['x'] ?? '0') || 0, parseFloat(element.attrs['y'] ?? '0') || 0])
            const group = new Node()
            if (opacity < 1) group.base.opacity = opacity
            parent.add(group)
            if (referenced.name === 'symbol') for (const child of referenced.children) walk(child, group, style, placed)
            else walk(referenced, group, style, placed)
            return
        }
        if (element.name === 'image') {
            const href = element.attrs['href'] ?? element.attrs['xlink:href']
            if (!href) return
            const width = parseFloat(element.attrs['width'] ?? '0'), height = parseFloat(element.attrs['height'] ?? '0')
            const [x, y] = apply(m, parseFloat(element.attrs['x'] ?? '0') || 0, parseFloat(element.attrs['y'] ?? '0') || 0)
            const unit = matScale(m)
            const image: StageImage = { src: href, width, height }
            const node = new Node().at(x, y)
            node.base.image = image
            node.base.sx = unit
            node.base.sy = unit
            if (opacity < 1) node.base.opacity = opacity
            register(node)
            parent.add(node)
            return
        }
        if (element.name === 'text') {
            const body = (element.text + element.children.map((child) => child.text).join('')).trim()
            if (!body) return
            const color = safeColor(style.fill) ?? [0, 0, 0, 1] as Rgba
            const size = style.fontSize * matScale(m)
            const label = text(body, { size, color })
            const [x, y] = apply(m, parseFloat(element.attrs['x'] ?? '0') || 0, parseFloat(element.attrs['y'] ?? '0') || 0)
            const half = label.get('px')
            label.at(style.anchor === 'middle' ? x : style.anchor === 'end' ? x - half : x + half, y - size * 0.34)
            if (opacity < 1) label.base.opacity = opacity
            register(label)
            parent.add(label)
            return
        }
        const path = shapePath(element)
        if (!path || path.length === 0) return
        const isBackground = firstShape && element.name === 'rect' && !keepBackground
            && parseFloat(element.attrs['width'] ?? '0') >= viewW - 0.5 && parseFloat(element.attrs['height'] ?? '0') >= viewH - 0.5
        firstShape = false
        if (isBackground) return
        const leaves = leafFrom(path, m, element, style)
        if (leaves.length === 0) return
        if (leaves.length === 1) {
            if (opacity < 1) leaves[0]!.base.opacity = opacity
            register(leaves[0]!)
            parent.add(leaves[0]!)
            return
        }
        const group = new Node()
        if (opacity < 1) group.base.opacity = opacity
        group.add(...leaves)
        register(group)
        parent.add(group)
    }

    const initial: InheritedStyle = {
        fill: '#000000', stroke: null, strokeWidth: 1, fillOpacity: 1, strokeOpacity: 1,
        cap: 'butt', join: 'miter', dash: null, dashOffset: 0, color: '#000000', fontSize: 16, anchor: 'start',
    }
    const { style } = styleOf(svg, initial)
    for (const child of svg.children) walk(child, out, style, base)
    return out
}

function shiftPaint(paint: Paint, dx: number, dy: number): Paint {
    if (Array.isArray(paint)) return paint
    const gradient = paint as Exclude<Paint, Rgba>
    if (gradient.type === 'linear') {
        return { ...gradient, from: [gradient.from[0] + dx, gradient.from[1] + dy], to: [gradient.to[0] + dx, gradient.to[1] + dy] }
    }
    if (gradient.type === 'radial') return { ...gradient, center: [gradient.center[0] + dx, gradient.center[1] + dy] }
    return gradient
}
