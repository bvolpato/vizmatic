import { curveFree, type GlyphOutline, type LoadedFont } from './font-types'
import { ring, type Path } from './geometry'
import { loadBinaryAsset } from './assets'
import { Suspend } from './stage'

export type { LoadedFont, GlyphOutline } from './font-types'

/**
 * A small TrueType reader. Text on stage is outlines, not font rendering, so the
 * browser and the video exporter draw identical shapes, and every glyph can be
 * traced, morphed, and staggered like any other path.
 */
class Reader {
    private readonly view: DataView
    constructor(readonly bytes: ArrayBuffer, private offset = 0) {
        this.view = new DataView(bytes)
    }
    seek(offset: number): this {
        this.offset = offset
        return this
    }
    get position(): number {
        return this.offset
    }
    u8(): number {
        return this.view.getUint8(this.offset++)
    }
    i8(): number {
        return this.view.getInt8(this.offset++)
    }
    u16(): number {
        const v = this.view.getUint16(this.offset)
        this.offset += 2
        return v
    }
    i16(): number {
        const v = this.view.getInt16(this.offset)
        this.offset += 2
        return v
    }
    u32(): number {
        const v = this.view.getUint32(this.offset)
        this.offset += 4
        return v
    }
    tag(): string {
        let out = ''
        for (let i = 0; i < 4; i++) out += String.fromCharCode(this.u8())
        return out
    }
}

interface Table {
    offset: number
    length: number
}

export function parseFont(bytes: ArrayBuffer): LoadedFont {
    const r = new Reader(bytes)
    const version = r.u32()
    if (version !== 0x00010000 && version !== 0x74727565) {
        throw new Error('Stage text needs a TrueType (.ttf) font with glyf outlines.')
    }
    const tableCount = r.u16()
    r.seek(12)
    const tables = new Map<string, Table>()
    for (let i = 0; i < tableCount; i++) {
        const tag = r.tag()
        r.u32()
        tables.set(tag, { offset: r.u32(), length: r.u32() })
    }
    const need = (tag: string): Table => {
        const table = tables.get(tag)
        if (!table) throw new Error(`Font is missing its ${tag} table.`)
        return table
    }
    const head = need('head')
    r.seek(head.offset + 18)
    const unitsPerEm = r.u16()
    r.seek(head.offset + 50)
    const longLoca = r.i16() === 1
    const hhea = need('hhea')
    r.seek(hhea.offset + 4)
    const ascent = r.i16()
    const descent = r.i16()
    const lineGap = r.i16()
    r.seek(hhea.offset + 34)
    const hMetrics = r.u16()
    r.seek(need('maxp').offset + 4)
    const glyphCount = r.u16()

    const hmtx = need('hmtx')
    const loca = need('loca')
    const glyf = need('glyf')
    const cmap = parseCmap(r, need('cmap').offset)
    const kerning = tables.has('GPOS') ? parseKerning(r, tables.get('GPOS')!.offset) : () => 0

    const advance = (glyph: number): number => {
        const index = Math.min(glyph, hMetrics - 1)
        r.seek(hmtx.offset + index * 4)
        return r.u16()
    }
    const outlines = new Map<number, GlyphOutline | null>()

    const contours = (glyph: number, depth: number): number[][] => {
        if (glyph >= glyphCount || depth > 6) return []
        r.seek(loca.offset + (longLoca ? glyph * 4 : glyph * 2))
        const start = longLoca ? r.u32() : r.u16() * 2
        const end = longLoca ? r.u32() : r.u16() * 2
        if (start === end) return []
        r.seek(glyf.offset + start)
        const count = r.i16()
        r.seek(r.position + 8)
        if (count < 0) return composite(glyph, depth)
        const ends: number[] = []
        for (let i = 0; i < count; i++) ends.push(r.u16())
        const instructionLength = r.u16()
        r.seek(r.position + instructionLength)
        const total = (ends[ends.length - 1] ?? -1) + 1
        const flags: number[] = []
        while (flags.length < total) {
            const flag = r.u8()
            flags.push(flag)
            if (flag & 8) {
                let repeat = r.u8()
                while (repeat-- > 0) flags.push(flag)
            }
        }
        const xs: number[] = new Array(total)
        let x = 0
        for (let i = 0; i < total; i++) {
            const flag = flags[i]!
            if (flag & 2) {
                const dx = r.u8()
                x += flag & 16 ? dx : -dx
            } else if (!(flag & 16)) {
                x += r.i16()
            }
            xs[i] = x
        }
        const ys: number[] = new Array(total)
        let y = 0
        for (let i = 0; i < total; i++) {
            const flag = flags[i]!
            if (flag & 4) {
                const dy = r.u8()
                y += flag & 32 ? dy : -dy
            } else if (!(flag & 32)) {
                y += r.i16()
            }
            ys[i] = y
        }
        const out: number[][] = []
        let first = 0
        for (const last of ends) {
            out.push(contourToCubics(xs, ys, flags, first, last))
            first = last + 1
        }
        return out
    }

    function composite(_glyph: number, depth: number): number[][] {
        const parts: { glyph: number; m: [number, number, number, number, number, number] }[] = []
        let more = true
        while (more) {
            const flags = r.u16()
            const glyph = r.u16()
            const words = (flags & 1) !== 0
            const xy = (flags & 2) !== 0
            let dx = 0, dy = 0
            if (words) {
                dx = r.i16()
                dy = r.i16()
            } else {
                dx = r.i8()
                dy = r.i8()
            }
            if (!xy) {
                dx = 0
                dy = 0
            }
            let a = 1, b = 0, c = 0, d = 1
            const f2 = () => r.i16() / 16384
            if (flags & 8) {
                a = d = f2()
            } else if (flags & 0x40) {
                a = f2()
                d = f2()
            } else if (flags & 0x80) {
                a = f2()
                b = f2()
                c = f2()
                d = f2()
            }
            parts.push({ glyph, m: [a, b, c, d, dx, dy] })
            more = (flags & 0x20) !== 0
        }
        const out: number[][] = []
        for (const part of parts) {
            for (const contour of contours(part.glyph, depth + 1)) {
                const moved = new Array<number>(contour.length)
                const [a, b, c, d, e, f] = part.m
                for (let i = 0; i < contour.length; i += 2) {
                    moved[i] = a * contour[i]! + c * contour[i + 1]! + e
                    moved[i + 1] = b * contour[i]! + d * contour[i + 1]! + f
                }
                out.push(moved)
            }
        }
        return out
    }

    return {
        unitsPerEm, ascent, descent, lineGap,
        glyphFor(code: number): number {
            return cmap(code)
        },
        advance,
        kern(left: number, right: number): number {
            return kerning(left, right)
        },
        outline(glyph: number): GlyphOutline | null {
            if (outlines.has(glyph)) return outlines.get(glyph)!
            const raw = contours(glyph, 0)
            const result = raw.length ? curveFree(raw) : null
            outlines.set(glyph, result)
            return result
        },
    }
}

/** A TrueType contour mixes on-curve and off-curve points. Quadratics rise to cubics. */
function contourToCubics(xs: readonly number[], ys: readonly number[], flags: readonly number[], first: number, last: number): number[] {
    const count = last - first + 1
    if (count < 2) return []
    const at = (i: number) => first + ((i % count) + count) % count
    const on = (i: number) => (flags[at(i)]! & 1) !== 0
    let startIndex = 0
    while (startIndex < count && !on(startIndex)) startIndex++
    let sx: number, sy: number
    if (startIndex === count) {
        // Every point is off-curve. The contour starts between the first two.
        sx = (xs[at(0)]! + xs[at(count - 1)]!) / 2
        sy = (ys[at(0)]! + ys[at(count - 1)]!) / 2
        startIndex = 0
    } else {
        sx = xs[at(startIndex)]!
        sy = ys[at(startIndex)]!
        startIndex += 1
    }
    const out = [sx, sy]
    let cx = sx, cy = sy
    let controlX = 0, controlY = 0, hasControl = false
    const quad = (qx: number, qy: number, ex: number, ey: number) => {
        out.push(cx + (qx - cx) * 2 / 3, cy + (qy - cy) * 2 / 3, ex + (qx - ex) * 2 / 3, ey + (qy - ey) * 2 / 3, ex, ey)
        cx = ex
        cy = ey
    }
    const line = (ex: number, ey: number) => {
        out.push(cx + (ex - cx) / 3, cy + (ey - cy) / 3, cx + (ex - cx) * 2 / 3, cy + (ey - cy) * 2 / 3, ex, ey)
        cx = ex
        cy = ey
    }
    for (let k = 0; k < count; k++) {
        const i = startIndex + k
        const x = xs[at(i)]!, y = ys[at(i)]!
        if (on(i)) {
            if (hasControl) {
                quad(controlX, controlY, x, y)
                hasControl = false
            } else if (x !== cx || y !== cy) {
                line(x, y)
            }
        } else {
            if (hasControl) quad(controlX, controlY, (controlX + x) / 2, (controlY + y) / 2)
            controlX = x
            controlY = y
            hasControl = true
        }
    }
    if (hasControl) quad(controlX, controlY, sx, sy)
    else if (cx !== sx || cy !== sy) line(sx, sy)
    return out
}

function parseCmap(r: Reader, offset: number): (code: number) => number {
    r.seek(offset + 2)
    const count = r.u16()
    let best = -1, bestScore = -1
    for (let i = 0; i < count; i++) {
        const platform = r.u16()
        const encoding = r.u16()
        const sub = r.u32()
        const score = platform === 3 && encoding === 10 ? 4 : platform === 0 && encoding >= 4 ? 3 : platform === 3 && encoding === 1 ? 2 : platform === 0 ? 1 : 0
        if (score > bestScore) {
            bestScore = score
            best = offset + sub
        }
    }
    if (best < 0) return () => 0
    r.seek(best)
    const format = r.u16()
    if (format === 12) {
        r.seek(best + 12)
        const groups = r.u32()
        const table: [number, number, number][] = []
        for (let i = 0; i < groups; i++) table.push([r.u32(), r.u32(), r.u32()])
        return (code) => {
            let lo = 0, hi = table.length - 1
            while (lo <= hi) {
                const mid = (lo + hi) >> 1
                const [start, end, glyph] = table[mid]!
                if (code < start) hi = mid - 1
                else if (code > end) lo = mid + 1
                else return glyph + code - start
            }
            return 0
        }
    }
    if (format === 4) {
        r.seek(best + 6)
        const segX2 = r.u16()
        const segs = segX2 / 2
        const endsAt = best + 14
        const startsAt = endsAt + segX2 + 2
        const deltasAt = startsAt + segX2
        const rangesAt = deltasAt + segX2
        const map = new Map<number, number>()
        for (let i = 0; i < segs; i++) {
            const end = r.seek(endsAt + i * 2).u16()
            const start = r.seek(startsAt + i * 2).u16()
            const delta = r.seek(deltasAt + i * 2).i16()
            const range = r.seek(rangesAt + i * 2).u16()
            for (let c = start; c <= end && c !== 0xffff; c++) {
                let glyph: number
                if (range === 0) glyph = (c + delta) & 0xffff
                else {
                    const raw = r.seek(rangesAt + i * 2 + range + (c - start) * 2).u16()
                    glyph = raw === 0 ? 0 : (raw + delta) & 0xffff
                }
                if (glyph) map.set(c, glyph)
            }
        }
        return (code) => map.get(code) ?? 0
    }
    return () => 0
}

type KernLookup = (left: number, right: number) => number | undefined

/**
 * Pair kerning from GPOS: the `kern` feature, formats 1 and 2, through extension
 * lookups. Class kerning can describe millions of pairs, so values read on demand.
 * In each lookup the first subtable that applies to the pair decides its value.
 */
function parseKerning(r: Reader, gpos: number): (left: number, right: number) => number {
    const lookups: KernLookup[][] = []
    try {
        r.seek(gpos + 6)
        const featureList = gpos + r.u16()
        const lookupList = gpos + r.u16()
        r.seek(featureList)
        const featureCount = r.u16()
        const indices = new Set<number>()
        for (let i = 0; i < featureCount; i++) {
            r.seek(featureList + 2 + i * 6)
            const tag = r.tag()
            const offset = r.u16()
            if (tag !== 'kern') continue
            r.seek(featureList + offset + 2)
            const count = r.u16()
            for (let k = 0; k < count; k++) indices.add(r.u16())
        }
        for (const index of [...indices].sort((a, b) => a - b)) {
            r.seek(lookupList + 2 + index * 2)
            const lookup = lookupList + r.u16()
            r.seek(lookup)
            const lookupType = r.u16()
            r.u16()
            const subCount = r.u16()
            const subs: number[] = []
            for (let i = 0; i < subCount; i++) subs.push(lookup + r.u16())
            const tables: KernLookup[] = []
            for (const first of subs) {
                let sub = first
                let type = lookupType
                if (type === 9) {
                    r.seek(sub + 2)
                    type = r.u16()
                    sub += r.u32()
                }
                if (type === 2) tables.push(readPairs(r, sub))
            }
            lookups.push(tables)
        }
    } catch {
        // Kerning is a refinement. A font with unusual tables still lays out with advances.
    }
    const cache = new Map<number, number>()
    return (left, right) => {
        const key = left * 65536 + right
        const cached = cache.get(key)
        if (cached !== undefined) return cached
        let total = 0
        for (const tables of lookups) {
            for (const table of tables) {
                const value = table(left, right)
                if (value !== undefined) {
                    total += value
                    break
                }
            }
        }
        cache.set(key, total)
        return total
    }
}

function readCoverage(r: Reader, offset: number): Set<number> {
    r.seek(offset)
    const format = r.u16()
    const out = new Set<number>()
    if (format === 1) {
        const count = r.u16()
        for (let i = 0; i < count; i++) out.add(r.u16())
    } else if (format === 2) {
        const count = r.u16()
        for (let i = 0; i < count; i++) {
            const start = r.u16(), end = r.u16()
            r.u16()
            for (let glyph = start; glyph <= end; glyph++) out.add(glyph)
        }
    }
    return out
}

function readClasses(r: Reader, offset: number): (glyph: number) => number {
    r.seek(offset)
    const format = r.u16()
    const classes = new Map<number, number>()
    if (format === 1) {
        const start = r.u16()
        const count = r.u16()
        for (let i = 0; i < count; i++) classes.set(start + i, r.u16())
    } else if (format === 2) {
        const count = r.u16()
        for (let i = 0; i < count; i++) {
            const start = r.u16(), end = r.u16(), value = r.u16()
            for (let glyph = start; glyph <= end; glyph++) classes.set(glyph, value)
        }
    }
    return (glyph) => classes.get(glyph) ?? 0
}

function valueSize(format: number): number {
    let count = 0
    for (let bit = 0; bit < 8; bit++) if (format & (1 << bit)) count++
    return count * 2
}

/** Horizontal advance adjustment from a value record, when it has one. */
function readAdvance(r: Reader, format: number): number {
    let advance = 0
    if (format & 1) r.i16()
    if (format & 2) r.i16()
    if (format & 4) advance = r.i16()
    if (format & 8) r.i16()
    for (let bit = 4; bit < 8; bit++) if (format & (1 << bit)) r.u16()
    return advance
}

function readPairs(r: Reader, sub: number): KernLookup {
    r.seek(sub)
    const format = r.u16()
    const coverageOffset = r.u16()
    const value1 = r.u16()
    const value2 = r.u16()
    const size1 = valueSize(value1)
    const size2 = valueSize(value2)
    if (format === 1) {
        const setCount = r.u16()
        const offsets: number[] = []
        for (let i = 0; i < setCount; i++) offsets.push(r.u16())
        r.seek(sub + coverageOffset)
        const coverageFormat = r.u16()
        const glyphs: number[] = []
        if (coverageFormat === 1) {
            const count = r.u16()
            for (let i = 0; i < count; i++) glyphs.push(r.u16())
        } else if (coverageFormat === 2) {
            const count = r.u16()
            for (let i = 0; i < count; i++) {
                const start = r.u16(), end = r.u16()
                r.u16()
                for (let glyph = start; glyph <= end; glyph++) glyphs.push(glyph)
            }
        }
        const sets = new Map<number, Map<number, number>>()
        for (let i = 0; i < setCount; i++) {
            r.seek(sub + offsets[i]!)
            const count = r.u16()
            const pairs = new Map<number, number>()
            for (let k = 0; k < count; k++) {
                const second = r.u16()
                const advance = readAdvance(r, value1)
                r.seek(r.position + size2)
                pairs.set(second, advance)
            }
            if (glyphs[i] !== undefined) sets.set(glyphs[i]!, pairs)
        }
        // Format 1 lists exceptions. With no entry for this pair, later subtables still apply.
        return (left, right) => sets.get(left)?.get(right)
    }
    if (format === 2) {
        const class1Offset = r.u16()
        const class2Offset = r.u16()
        const class1Count = r.u16()
        const class2Count = r.u16()
        const matrix = r.position
        const coverage = readCoverage(r, sub + coverageOffset)
        const class1 = readClasses(r, sub + class1Offset)
        const class2 = readClasses(r, sub + class2Offset)
        return (left, right) => {
            if (!coverage.has(left)) return undefined
            const c1 = class1(left), c2 = class2(right)
            if (c1 >= class1Count || c2 >= class2Count) return undefined
            r.seek(matrix + c1 * class2Count * (size1 + size2) + c2 * (size1 + size2))
            return readAdvance(r, value1)
        }
    }
    return () => undefined
}

export type FontFamily = 'sans' | 'serif' | 'text-serif' | 'mono' | 'noto'
export type FontWeight = 400 | 600 | 700

type BundledFamily = FontFamily | 'math'

const FILES: Record<BundledFamily, Partial<Record<string, string>>> = {
    sans: { '400': 'Inter-Regular.ttf', '600': 'Inter-SemiBold.ttf', '700': 'Inter-Bold.ttf' },
    serif: { '400': 'InstrumentSerif-Regular.ttf', 'italic': 'InstrumentSerif-Italic.ttf' },
    'text-serif': { '400': 'SourceSerif4-24pt-Regular.ttf', '600': 'SourceSerif4-24pt-SemiBold.ttf', 'italic': 'SourceSerif4-24pt-Italic.ttf' },
    mono: { '400': 'JetBrainsMono-Regular.ttf' },
    noto: { '400': 'NotoSans-Regular.ttf' },
    math: { '400': 'NotoSansMath-Regular.ttf' },
}

/** The fonts to try, in order, for a character that a family does not have. */
const FALLBACKS: Record<FontFamily, readonly BundledFamily[]> = {
    sans: ['noto', 'math'],
    serif: ['text-serif', 'noto', 'math'],
    'text-serif': ['noto', 'math'],
    mono: ['noto', 'math'],
    noto: ['math'],
}

const fonts = new Map<string, LoadedFont>()
const pending = new Map<string, Promise<void>>()

/** Get a font now, or suspend the current compile until it arrives. */
export function fontFor(family: BundledFamily, weight: FontWeight = 400, italic = false): LoadedFont {
    const files = FILES[family]
    const file = (italic ? files['italic'] : undefined) ?? files[String(weight)] ?? files['400']!
    const loaded = fonts.get(file)
    if (loaded) return loaded
    let waiting = pending.get(file)
    if (!waiting) {
        waiting = loadBinaryAsset(`fonts/${file}`).then((bytes) => {
            fonts.set(file, parseFont(bytes))
            pending.delete(file)
        }, (error) => {
            pending.delete(file)
            throw error
        })
        pending.set(file, waiting)
    }
    throw new Suspend(waiting)
}

/** Find a character in the fonts behind a family. These load only when a film needs them. */
export function fallbackGlyph(family: FontFamily, code: number, weight: FontWeight = 400, italic = false): { font: LoadedFont; glyph: number } | null {
    for (const next of FALLBACKS[family]) {
        const font = fontFor(next, weight, italic)
        const glyph = font.glyphFor(code)
        if (glyph !== 0) return { font, glyph }
    }
    return null
}

const glyphPaths = new WeakMap<LoadedFont, Map<number, Map<number, Path>>>()

/** Glyph outline scaled to a pixel size, with y pointing down and the origin on the baseline. */
export function glyphPath(font: LoadedFont, glyph: number, size: number): Path {
    let bySize = glyphPaths.get(font)
    if (!bySize) glyphPaths.set(font, bySize = new Map())
    let byGlyph = bySize.get(size)
    if (!byGlyph) bySize.set(size, byGlyph = new Map())
    const cached = byGlyph.get(glyph)
    if (cached) return cached
    const outline = font.outline(glyph)
    const scale = size / font.unitsPerEm
    const path: Path = outline
        ? outline.contours.map((contour) => {
            const out = new Float64Array(contour.length)
            for (let i = 0; i < contour.length; i += 2) {
                out[i] = contour[i]! * scale
                out[i + 1] = -contour[i + 1]! * scale
            }
            return ring(out, true)
        })
        : []
    byGlyph.set(glyph, path)
    return path
}
