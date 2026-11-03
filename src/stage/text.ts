import { fallbackGlyph, fontFor, glyphPath, type FontFamily, type FontWeight, type LoadedFont } from './font'
import { Node } from './node'
import { pathBounds, transformPath, type Path } from './geometry'
import { toPaint, type ColorInput } from './color'

export interface TextOptions {
    size?: number
    font?: FontFamily
    weight?: FontWeight
    italic?: boolean
    color?: ColorInput
    /** Line alignment inside the block. */
    align?: 'left' | 'center' | 'right'
    /** Wrap to this width, in stage pixels. */
    maxWidth?: number
    /** Line height as a multiple of size. */
    leading?: number
    /** Extra space between letters, as a fraction of size. */
    tracking?: number
    uppercase?: boolean
}

/**
 * A line or block of text as real vector glyphs. Each glyph is its own child, so
 * text can be handwritten, staggered, or morphed. `.chars` lists them in order.
 */
export class TextNode extends Node {
    readonly chars: Node[] = []
    source = ''

    /** Glyph nodes whose characters match, such as every "x". */
    find(fragment: string): Node[] {
        const out: Node[] = []
        const keys = this.chars.map((glyph) => glyph.data['key'] as string).join('')
        const needle = fragment.replace(/\s/g, '')
        for (let at = keys.indexOf(needle); at >= 0; at = keys.indexOf(needle, at + 1)) {
            out.push(...this.chars.slice(at, at + needle.length))
        }
        return out
    }
}

/** Glyphs center on their own origin, so each one scales and rotates about itself. */
function centered(path: Path): { path: Path; x: number; y: number } {
    const b = pathBounds(path)
    if (!b) return { path, x: 0, y: 0 }
    const x = b.x + b.width / 2, y = b.y + b.height / 2
    return { path: transformPath(path, [1, 0, 0, 1, -x, -y]), x, y }
}

export function text(content: string, options: TextOptions = {}): TextNode {
    const size = options.size ?? 40
    const family = options.font ?? 'sans'
    const weight = options.weight ?? 400
    const italic = options.italic ?? false
    const font = fontFor(family, weight, italic)
    const scale = size / font.unitsPerEm
    const tracking = (options.tracking ?? 0) * size
    const leading = (options.leading ?? 1.3) * size
    const paint = toPaint(options.color ?? 'ink')
    const source = options.uppercase ? content.toUpperCase() : content

    type Placed = { font: LoadedFont; glyph: number; x: number; char: string }
    const measureWord = (word: string): { glyphs: Placed[]; width: number } => {
        const glyphs: Placed[] = []
        let x = 0, previous = 0, previousFont: LoadedFont | null = null
        for (const char of word) {
            const code = char.codePointAt(0)!
            let owner = font, glyph = font.glyphFor(code)
            if (glyph === 0) {
                const found = fallbackGlyph(family, code, weight, italic)
                if (found) {
                    owner = found.font
                    glyph = found.glyph
                }
            }
            const ownerScale = size / owner.unitsPerEm
            // Kerning pairs exist only inside one font.
            if (previous && previousFont === owner) x += owner.kern(previous, glyph) * ownerScale
            glyphs.push({ font: owner, glyph, x, char })
            x += owner.advance(glyph) * ownerScale + tracking
            previous = glyph
            previousFont = owner
        }
        return { glyphs, width: x }
    }

    const lines: { glyphs: Placed[]; width: number }[] = []
    const space = font.advance(font.glyphFor(32)) * scale + tracking
    for (const paragraph of source.split('\n')) {
        let line: Placed[] = []
        let width = 0
        for (const word of paragraph.split(' ')) {
            const measured = measureWord(word)
            const gap = line.length > 0 ? space : 0
            if (options.maxWidth !== undefined && line.length > 0 && width + gap + measured.width > options.maxWidth) {
                lines.push({ glyphs: line, width })
                line = []
                width = 0
            }
            const offset = width + (line.length > 0 ? space : 0)
            for (const glyph of measured.glyphs) line.push({ ...glyph, x: glyph.x + offset })
            width = offset + measured.width
        }
        lines.push({ glyphs: line, width })
    }

    const blockWidth = Math.max(0, ...lines.map((line) => line.width))
    const align = options.align ?? 'left'
    const node = new TextNode()
    node.source = content
    lines.forEach((line, row) => {
        const start = align === 'left' ? 0 : align === 'center' ? (blockWidth - line.width) / 2 : blockWidth - line.width
        for (const placed of line.glyphs) {
            const path = glyphPath(placed.font, placed.glyph, size)
            if (path.length === 0) continue
            const shape = centered(path)
            const leaf = new Node(shape.path).at(start + placed.x + shape.x, row * leading + shape.y)
            leaf.base.fill = paint
            leaf.base.trimEach = true
            leaf.data['key'] = placed.char
            // Glyph 0 draws the font's empty box. The film check reports it.
            if (placed.glyph === 0) leaf.data['missingGlyph'] = true
            node.chars.push(leaf)
            node.children.push(leaf)
            leaf.parent = node
        }
    })
    // Center the block on the node's origin, so `.at(x, y)` places its middle.
    const ascent = font.ascent * scale
    const height = (lines.length - 1) * leading
    node.base.px = blockWidth / 2
    node.base.py = height / 2 - ascent * 0.36
    node.data['size'] = size
    return node
}
