import { Node } from './node'
import { parseSvgPath, pathBounds, rectPath, transformPath, type Mat, type Path, mul } from './geometry'
import { toPaint, type ColorInput } from './color'
import { Suspend } from './stage'

export interface TexOptions {
    size?: number
    color?: ColorInput
    display?: boolean
}

/** Typeset equation as glyph nodes. Ordinary characters keep their identity for morphs. */
export class TexNode extends Node {
    readonly glyphs: Node[] = []
    source = ''

    /** Glyphs matching a TeX fragment, such as eq.part('b^2'). Use it to color or morph a term. */
    part(fragment: string): Node[] {
        const keys = texKeys(fragment)
        const own = this.glyphs.map((glyph) => glyph.data['key'])
        for (let start = 0; start + keys.length <= own.length; start++) {
            if (keys.every((key, i) => key === own[start + i])) return this.glyphs.slice(start, start + keys.length)
        }
        return []
    }

    /** Every occurrence of a fragment, in order. */
    parts(fragment: string): Node[][] {
        const keys = texKeys(fragment)
        const own = this.glyphs.map((glyph) => glyph.data['key'])
        const out: Node[][] = []
        for (let start = 0; start + keys.length <= own.length; start++) {
            if (keys.every((key, i) => key === own[start + i])) {
                out.push(this.glyphs.slice(start, start + keys.length))
                start += keys.length - 1
            }
        }
        return out
    }
}

interface RawGlyph {
    path: Path
    key: string
}

type MathEngine = (tex: string, display: boolean) => string

let engine: MathEngine | null = null
let loading: Promise<void> | null = null
const layouts = new Map<string, RawGlyph[]>()

function requireEngine(): MathEngine {
    if (engine) return engine
    loading ??= import('../math').then((module) => {
        engine = (tex, display) => module.renderMathSvg(tex, { fontSize: 1000, display, color: '#000000' }).svg
    })
    throw new Suspend(loading)
}

/** Read MathJax's SVG: nested groups with transforms around glyph paths and rule rectangles. */
function layoutTex(tex: string, display: boolean): RawGlyph[] {
    const cacheKey = `${display ? 'D' : 'I'}${tex}`
    const cached = layouts.get(cacheKey)
    if (cached) return cached
    const svg = requireEngine()(tex, display)
    const out: RawGlyph[] = []
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
            if (name === 'g') current = stack.pop() ?? current
            continue
        }
        const transform = attr('transform')
        const local = transform ? parseTransform(transform) : ([1, 0, 0, 1, 0, 0] as Mat)
        if (name === 'g') {
            if (!selfClosing) {
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
            out.push({
                path: transformPath(clip ? clampPath(placed, clip) : placed, current),
                key: code ? String.fromCodePoint(parseInt(code, 16)) : '?',
            })
        } else if (name === 'rect') {
            const x = Number(attr('x') ?? 0), y = Number(attr('y') ?? 0)
            const w = Number(attr('width') ?? 0), h = Number(attr('height') ?? 0)
            if (w > 0 && h > 0) out.push({ path: transformPath(rectPath(x, y, w, h), mul(current, local)), key: 'rule' })
        }
    }
    const scaled = out.map((glyph) => ({ key: glyph.key, path: transformPath(glyph.path, [unit, 0, 0, unit, 0, 0]) }))
    layouts.set(cacheKey, scaled)
    return scaled
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

function texKeys(fragment: string): string[] {
    return layoutTex(fragment, false).map((glyph) => glyph.key)
}

/** Typeset TeX with real math glyphs. `tex.part('x^2')` selects a term for color or morphing. */
export function tex(source: string, options: TexOptions = {}): TexNode {
    const size = options.size ?? 56
    const display = options.display ?? true
    const glyphs = layoutTex(source, display)
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
        node.glyphs.push(leaf)
        node.children.push(leaf)
        leaf.parent = node
    }
    if (minX !== Infinity) {
        node.base.px = (minX + maxX) / 2
        node.base.py = (minY + maxY) / 2
    }
    return node
}
