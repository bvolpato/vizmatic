import { Node } from './node'
import { parseSvgPath, pathBounds, rectPath, transformPath, type Mat, type Path, mul } from './geometry'
import { toPaint, type ColorInput } from './color'
import { Suspend } from './stage'
import { fallbackGlyph, fontFor, glyphPath, type FontFamily } from './font'

export interface TexOptions {
    size?: number
    color?: ColorInput
    display?: boolean
}

/** Typeset equation as glyph nodes. Ordinary characters keep their identity for morphs. */
export class TexNode extends Node {
    readonly glyphs: Node[] = []
    source = ''
    /** The formula's baseline in local coordinates, before its centered pivot and transforms. */
    readonly baseline = 0

    /** Glyphs matching a TeX fragment's structure, using this equation's macros and display mode. */
    part(fragment: string): Node[] {
        return this.parts(fragment)[0] ?? []
    }

    /** Every non-overlapping occurrence in reading order. Fragments without visible glyphs return []. */
    parts(fragment: string): Node[][] {
        if (!fragment.trim()) return []
        const display = this.data['texDisplay'] !== false
        const target = layoutTex(fragment, display, this.source).structure
        if (!target || target.glyphs.length === 0) return []
        const own = layoutTex(this.source, display).structure
        if (!own) return []
        const out: Node[][] = []
        const needle = target.kind === 'row' ? target.children : [target]
        const visit = (part: Part): void => {
            if (part.signature === target.signature) {
                out.push(part.glyphs.map((i) => this.glyphs[i]!))
                return
            }
            for (let i = 0; i < part.children.length; i++) {
                // Only siblings in a row form a sequence. Script and fraction arguments are distinct slots.
                if (part.kind === 'row' && needle.every((item, j) => item.signature === part.children[i + j]?.signature)) {
                    out.push(part.children.slice(i, i + needle.length).flatMap((item) => item.glyphs.map((j) => this.glyphs[j]!)))
                    i += needle.length - 1
                } else visit(part.children[i]!)
            }
        }
        visit(own)
        return out
    }
}

interface RawGlyph {
    path: Path
    key: string
}

interface Part {
    kind: string
    signature: string
    children: Part[]
    glyphs: number[]
}

interface RawPart {
    kind: string
    children: RawPart[]
    glyph?: number
    slot?: number
}

interface Layout {
    glyphs: RawGlyph[]
    structure: Part | null
}

type MathEngine = (tex: string, display: boolean, context?: string) => string

let engine: MathEngine | null = null
let loading: Promise<void> | null = null
const layouts = new Map<string, Layout>()
const LAYOUT_CACHE_LIMIT = 128

function requireEngine(): MathEngine {
    if (engine) return engine
    loading ??= import('../math').then((module) => {
        engine = (tex, display, context) => {
            const options = { fontSize: 1000, display, color: '#000000' }
            return (context === undefined ? module.renderMathSvg(tex, options) : module.renderMathFragmentSvg(context, tex, options)).svg
        }
    }).catch((error) => {
        loading = null
        throw error
    })
    throw new Suspend(loading)
}

/** Read MathJax's SVG: nested groups with transforms around glyph paths and rule rectangles. */
function layoutTex(tex: string, display: boolean, context?: string): Layout {
    const cacheKey = JSON.stringify([display, tex, context])
    const cached = layouts.get(cacheKey)
    if (cached) {
        layouts.delete(cacheKey)
        layouts.set(cacheKey, cached)
        return cached
    }
    const svg = requireEngine()(tex, display, context)
    const out: RawGlyph[] = []
    const root: RawPart = { kind: '', children: [] }
    const groups = [root]
    const add = (path: Path, key: string): void => {
        if (!pathBounds(path)) return
        groups[groups.length - 1]!.children.push({ kind: 'glyph', children: [], glyph: out.length })
        out.push({ path, key })
    }
    const stack: Mat[] = []
    let current: Mat = [1, 0, 0, 1, 0, 0]
    const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1]?.trim().split(/[ ,]+/).map(Number) ?? [0, 0, 1000, 1000]
    const widthPx = Number(/\swidth="([\d.]+)px"/.exec(svg)?.[1] ?? 1000)
    const unit = widthPx / viewBox[2]! / 1000
    const tag = /<(\/?)([a-zA-Z]+)((?:\s+[-\w:]+="[^"]*")*)\s*(\/?)>/g
    // MathJax draws the middle of a tall delimiter inside a nested svg with its own
    // viewBox, which also clips the piece. Only the outermost svg is a plain wrapper.
    let svgDepth = 0
    let clip: readonly [number, number, number, number] | null = null
    const clips: (readonly [number, number, number, number] | null)[] = []
    for (let match = tag.exec(svg); match; match = tag.exec(svg)) {
        const [, closing, name, attributes = '', selfClosing] = match
        const attr = (key: string) => new RegExp(`\\s${key}="([^"]*)"`).exec(attributes)?.[1]
        if (name === 'svg') {
            if (closing) {
                svgDepth--
                if (svgDepth >= 1) {
                    current = stack.pop() ?? current
                    clip = clips.pop() ?? null
                }
                continue
            }
            svgDepth++
            if (svgDepth > 1) {
                const box = (attr('viewBox') ?? '0 0 1 1').trim().split(/[ ,]+/).map(Number)
                const w = Number(attr('width') ?? box[2]), h = Number(attr('height') ?? box[3])
                const mapping: Mat = mul(
                    [w / (box[2] || 1), 0, 0, h / (box[3] || 1), Number(attr('x') ?? 0), Number(attr('y') ?? 0)],
                    [1, 0, 0, 1, -box[0]!, -box[1]!],
                )
                stack.push(current)
                clips.push(clip)
                current = mul(current, mapping)
                clip = [box[0]!, box[1]!, box[0]! + box[2]!, box[1]! + box[3]!]
            }
            continue
        }
        if (closing) {
            if (name === 'g') {
                current = stack.pop() ?? current
                groups.pop()
            }
            continue
        }
        const transform = attr('transform')
        const local = transform ? parseTransform(transform) : ([1, 0, 0, 1, 0, 0] as Mat)
        if (name === 'g') {
            const part: RawPart = {
                kind: attr('data-vizmatic-kind') ?? attr('data-mml-node') ?? '', children: [],
                slot: Number(attr('data-vizmatic-slot') ?? 0),
            }
            groups[groups.length - 1]!.children.push(part)
            if (!selfClosing) {
                groups.push(part)
                stack.push(current)
                current = mul(current, local)
            }
            continue
        }
        if (name === 'path') {
            const d = attr('d')
            if (!d) continue
            const code = attr('data-c')
            const placed = transformPath(parseSvgPath(d), local)
            add(transformPath(clip ? clampPath(placed, clip) : placed, current), code ? String.fromCodePoint(parseInt(code, 16)) : '?')
        } else if (name === 'rect') {
            const x = Number(attr('x') ?? 0), y = Number(attr('y') ?? 0)
            const w = Number(attr('width') ?? 0), h = Number(attr('height') ?? 0)
            if (w > 0 && h > 0) add(transformPath(rectPath(x, y, w, h), mul(current, local)), 'rule')
        } else if (name === 'text' && !selfClosing) {
            const end = svg.indexOf('</text>', tag.lastIndex)
            if (end < 0) throw new Error('MathJax returned an unclosed text element')
            const content = decodeXml(svg.slice(tag.lastIndex, end))
            const size = Number.parseFloat(attr('font-size') ?? '1000')
            const family: FontFamily = attr('font-family') === 'monospace' ? 'mono' : attr('font-family') === 'sans-serif' ? 'sans' : 'text-serif'
            const variant = attr('data-variant') ?? ''
            const weight = variant.includes('bold') ? 700 : 400
            const italic = variant.includes('italic')
            const font = fontFor(family, weight, italic)
            let x = Number(attr('x') ?? 0)
            const y = Number(attr('y') ?? 0)
            for (const char of content) {
                const code = char.codePointAt(0)!
                const glyph = font.glyphFor(code)
                const found = glyph ? { font, glyph } : fallbackGlyph(family, code, weight, italic)
                if (!found) throw new Error(`TeX text has no bundled outline for U+${code.toString(16).toUpperCase()} (${char})`)
                const path = glyphPath(found.font, found.glyph, size)
                if (!path.length && !/\s/u.test(char)) throw new Error(`TeX text has no bundled outline for U+${code.toString(16).toUpperCase()} (${char})`)
                add(transformPath(path, mul(mul(current, local), [1, 0, 0, 1, x, y])), char)
                x += found.font.advance(found.glyph) * size / found.font.unitsPerEm
            }
            tag.lastIndex = end + '</text>'.length
        }
    }
    const scaled = out.map((glyph) => ({ key: glyph.key, path: transformPath(glyph.path, [unit, 0, 0, unit, 0, 0]) }))
    const layout = { glyphs: scaled, structure: structure(root, scaled) }
    // Store only completed layouts. Loading fallback fonts suspends and retries the film.
    layouts.set(cacheKey, layout)
    if (layouts.size > LAYOUT_CACHE_LIMIT) layouts.delete(layouts.keys().next().value!)
    return layout
}

function decodeXml(value: string): string {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) =>
        entity[0] === '#' ? String.fromCodePoint(Number.parseInt(entity.slice(entity[1] === 'x' ? 2 : 1), entity[1] === 'x' ? 16 : 10)) : named[entity]!)
}

/** Keep argument boundaries, but ignore typography and redundant one-child TeX groups. */
function structure(raw: RawPart, glyphs: readonly RawGlyph[]): Part | null {
    if (raw.glyph !== undefined) return { kind: 'glyph', signature: JSON.stringify(glyphs[raw.glyph]!.key), children: [], glyphs: [raw.glyph] }
    const children = [...raw.children].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)).flatMap((child) => {
        const part = structure(child, glyphs)
        return part ? [part] : []
    })
    if (!children.length) return null
    const row = ['', 'math', 'mrow', 'TeXAtom', 'mstyle', 'mi', 'mn', 'mo', 'mtext', 'text'].includes(raw.kind)
    if (row && children.length === 1) return children[0]!
    const kind = row ? 'row' : raw.kind
    return { kind, children, glyphs: children.flatMap((part) => part.glyphs).sort((a, b) => a - b), signature: `${kind}(${children.map((part) => part.signature).join(',')})` }
}

/** Delimiter extenders are straight bars, so clamping their points equals clipping them. */
function clampPath(path: Path, box: readonly [number, number, number, number]): Path {
    return path.map((r) => {
        const out = new Float64Array(r.p.length)
        for (let i = 0; i < out.length; i += 2) {
            out[i] = Math.max(box[0], Math.min(box[2], r.p[i]!))
            out[i + 1] = Math.max(box[1], Math.min(box[3], r.p[i + 1]!))
        }
        return { p: out, closed: r.closed }
    })
}

function parseTransform(value: string): Mat {
    let m: Mat = [1, 0, 0, 1, 0, 0]
    for (const match of value.matchAll(/(translate|scale|matrix)\(([^)]*)\)/g)) {
        const args = match[2]!.trim().split(/[ ,]+/).map(Number)
        if (match[1] === 'translate') m = mul(m, [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0])
        else if (match[1] === 'scale') m = mul(m, [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0])
        else if (args.length === 6) m = mul(m, args as unknown as Mat)
    }
    return m
}

/** Typeset TeX with real math glyphs. `tex.part('x^2')` selects a term for color or morphing. */
export function tex(source: string, options: TexOptions = {}): TexNode {
    const size = options.size ?? 56
    const display = options.display ?? true
    const { glyphs } = layoutTex(source, display)
    const paint = toPaint(options.color ?? 'ink')
    const node = new TexNode()
    node.source = source
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const glyph of glyphs) {
        const path = transformPath(glyph.path, [size, 0, 0, size, 0, 0])
        const b = pathBounds(path)
        if (!b) continue
        minX = Math.min(minX, b.x)
        minY = Math.min(minY, b.y)
        maxX = Math.max(maxX, b.x + b.width)
        maxY = Math.max(maxY, b.y + b.height)
        const cx = b.x + b.width / 2, cy = b.y + b.height / 2
        const leaf = new Node(transformPath(path, [1, 0, 0, 1, -cx, -cy])).at(cx, cy)
        leaf.base.fill = paint
        leaf.base.trimEach = true
        leaf.data['key'] = glyph.key
        // The base line of the formula, for the film check. The outline has its middle at the origin.
        leaf.data['base'] = -cy
        node.glyphs.push(leaf)
        node.children.push(leaf)
        leaf.parent = node
    }
    if (minX !== Infinity) {
        node.base.px = (minX + maxX) / 2
        node.base.py = (minY + maxY) / 2
    }
    node.data['size'] = size
    node.data['texDisplay'] = display
    return node
}
