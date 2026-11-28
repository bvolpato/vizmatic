/**
 * Outlines of an OpenType font with PostScript curves: the `CFF ` table of an .otf file. A glyph is a small
 * program of Type 2 charstring operators. It moves a pen, and its curves are cubics already.
 */
interface Slice { start: number; end: number }

const MAX_CALLS = 10
/** A glyph has some hundreds of operators. A program with more than this does not end. */
const MAX_OPERATORS = 100_000

/** The arithmetic of Type 2 charstrings that fonts use: how many operands, and what comes back. */
const ARITHMETIC: Record<number, [operands: number, make: (...s: number[]) => number[]]> = {
    9: [1, (a) => [Math.abs(a!)]], 10: [2, (a, b) => [a! + b!]], 11: [2, (a, b) => [a! - b!]], 12: [2, (a, b) => [a! / b!]],
    14: [1, (a) => [-a!]], 18: [1, () => []], 24: [2, (a, b) => [a! * b!]], 27: [1, (a) => [a!, a!]], 28: [2, (a, b) => [b!, a!]],
}

/** Read the glyph programs of a `CFF ` table. The result gives the contours of a glyph, with y pointing up. */
export function cffOutlines(view: DataView, table: number): (glyph: number) => number[][] {
    const u8 = (at: number) => view.getUint8(at)
    const u16 = (at: number) => view.getUint16(at)
    /** An INDEX: a list of byte ranges. Returns them, and the first byte after the list. */
    const readIndex = (at: number): { items: Slice[]; end: number } => {
        const count = u16(at)
        if (count === 0) return { items: [], end: at + 2 }
        const size = u8(at + 2), base = at + 3 + (count + 1) * size - 1
        const offset = (i: number) => {
            let value = 0
            for (let b = 0; b < size; b++) value = value * 256 + u8(at + 3 + i * size + b)
            return base + value
        }
        const items = Array.from({ length: count }, (_, i) => ({ start: offset(i), end: offset(i + 1) }))
        return { items, end: offset(count) }
    }
    /** A DICT: the operands of each operator. A two-byte operator is 1200 plus its second byte. */
    const readDict = ({ start, end }: Slice): Map<number, number[]> => {
        const out = new Map<number, number[]>()
        let operands: number[] = [], at = start
        while (at < end) {
            const b = u8(at++)
            if (b <= 21) {
                out.set(b === 12 ? 1200 + u8(at++) : b, operands)
                operands = []
            } else if (b === 28) { operands.push(view.getInt16(at)); at += 2 }
            else if (b === 29) { operands.push(view.getInt32(at)); at += 4 }
            else if (b === 30) {
                let digits = ''
                for (let done = false; !done && at < end;) {
                    const pair = u8(at++)
                    for (const nibble of [pair >> 4, pair & 15]) {
                        if (nibble === 15) { done = true; break }
                        digits += nibble < 10 ? String(nibble) : nibble === 10 ? '.' : nibble === 11 ? 'e' : nibble === 12 ? 'e-' : nibble === 14 ? '-' : ''
                    }
                }
                operands.push(Number(digits))
            } else if (b >= 32 && b <= 246) operands.push(b - 139)
            else if (b >= 247 && b <= 250) operands.push((b - 247) * 256 + u8(at++) + 108)
            else if (b >= 251 && b <= 254) operands.push(-(b - 251) * 256 - u8(at++) - 108)
        }
        return out
    }

    const names = readIndex(table + u8(table + 2))
    const tops = readIndex(names.end)
    const strings = readIndex(tops.end)
    const globals = readIndex(strings.end).items
    const top = readDict(tops.items[0]!)
    if ((top.get(1206)?.[0] ?? 2) !== 2) throw new Error('This font has Type 1 charstrings, and Vizmatic reads Type 2. Convert it to TrueType')
    const programs = readIndex(table + (top.get(17)?.[0] ?? 0)).items
    const localsOf = (dict: Map<number, number[]>): Slice[] => {
        const where = dict.get(18)
        if (!where) return []
        const start = table + where[1]!, own = readDict({ start, end: start + where[0]! }).get(19)
        return own ? readIndex(start + own[0]!).items : []
    }
    // A CID font has several private dictionaries, and a table that says which one a glyph uses.
    const isCid = top.has(1230)
    const fonts = isCid ? readIndex(table + top.get(1236)![0]!).items.map((item) => localsOf(readDict(item))) : [localsOf(top)]
    const select = isCid ? table + top.get(1237)![0]! : 0
    const fontOf = (glyph: number): number => {
        if (!isCid) return 0
        if (u8(select) === 0) return u8(select + 1 + glyph)
        const ranges = u16(select + 1)
        for (let i = 0; i < ranges; i++) if (glyph < u16(select + 3 + (i + 1) * 3)) return u8(select + 5 + i * 3)
        return 0
    }
    const bias = (list: readonly Slice[]) => (list.length < 1240 ? 107 : list.length < 33900 ? 1131 : 32768)

    return (glyph) => {
        const program = programs[glyph]
        if (!program) return []
        const locals = fonts[fontOf(glyph)] ?? []
        const contours: number[][] = []
        const stack: number[] = []
        let ring: number[] | null = null
        let x = 0, y = 0, stems = 0, widthRead = false, done = false, operators = 0
        const close = () => {
            if (ring && ring.length >= 8) {
                const sx = ring[0]!, sy = ring[1]!
                if (sx !== x || sy !== y) ring.push(x + (sx - x) / 3, y + (sy - y) / 3, x + (sx - x) * 2 / 3, y + (sy - y) * 2 / 3, sx, sy)
                contours.push(ring)
            }
            ring = null
        }
        const move = (dx: number, dy: number) => { close(); x += dx; y += dy; ring = [x, y] }
        const lineBy = (dx: number, dy: number) => {
            const nx = x + dx, ny = y + dy
            ring?.push(x + dx / 3, y + dy / 3, x + dx * 2 / 3, y + dy * 2 / 3, nx, ny)
            x = nx; y = ny
        }
        const curveBy = (a: number, b: number, c: number, d: number, e: number, f: number) => {
            const x1 = x + a, y1 = y + b, x2 = x1 + c, y2 = y1 + d
            x = x2 + e; y = y2 + f
            ring?.push(x1, y1, x2, y2, x, y)
        }
        /** The first operator that takes a fixed count of operands can have the width of the glyph before them. */
        const dropWidth = (extra: boolean) => { if (!widthRead) { widthRead = true; if (extra) stack.shift() } }
        const countStems = () => { dropWidth(stack.length % 2 === 1); stems += stack.length >> 1; stack.length = 0 }

        const run = ({ start, end }: Slice, depth: number): void => {
            let at = start
            while (at < end && !done) {
                const b = u8(at++)
                if (++operators > MAX_OPERATORS) throw new Error('the program of the glyph does not end')
                if (b >= 32 || b === 28) {
                    if (b === 28) { stack.push(view.getInt16(at)); at += 2 }
                    else if (b <= 246) stack.push(b - 139)
                    else if (b <= 250) stack.push((b - 247) * 256 + u8(at++) + 108)
                    else if (b <= 254) stack.push(-(b - 251) * 256 - u8(at++) - 108)
                    else { stack.push(view.getInt32(at) / 65536); at += 4 }
                    continue
                }
                const s = stack
                let i = 0
                switch (b) {
                    case 1: case 3: case 18: case 23: countStems(); break
                    case 19: case 20: countStems(); at += (stems + 7) >> 3; break
                    case 21: dropWidth(s.length > 2); move(s[0] ?? 0, s[1] ?? 0); break
                    case 22: dropWidth(s.length > 1); move(s[0] ?? 0, 0); break
                    case 4: dropWidth(s.length > 1); move(0, s[0] ?? 0); break
                    case 5: for (; i + 1 < s.length; i += 2) lineBy(s[i]!, s[i + 1]!); break
                    case 6: case 7: for (; i < s.length; i++) (b === 6) === (i % 2 === 0) ? lineBy(s[i]!, 0) : lineBy(0, s[i]!); break
                    case 8: for (; i + 5 < s.length; i += 6) curveBy(s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!, s[i + 4]!, s[i + 5]!); break
                    case 24: for (; i + 7 < s.length; i += 6) curveBy(s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!, s[i + 4]!, s[i + 5]!); lineBy(s[i]!, s[i + 1]!); break
                    case 25: for (; i + 7 < s.length; i += 2) lineBy(s[i]!, s[i + 1]!); curveBy(s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!, s[i + 4]!, s[i + 5]!); break
                    case 26: { let dx = s.length % 4 ? s[i++]! : 0; for (; i + 3 < s.length; i += 4) { curveBy(dx, s[i]!, s[i + 1]!, s[i + 2]!, 0, s[i + 3]!); dx = 0 } break }
                    case 27: { let dy = s.length % 4 ? s[i++]! : 0; for (; i + 3 < s.length; i += 4) { curveBy(s[i]!, dy, s[i + 1]!, s[i + 2]!, s[i + 3]!, 0); dy = 0 } break }
                    case 30: case 31: {
                        let flat = b === 31
                        for (; i + 3 < s.length; i += 4) {
                            const last = s.length - i === 5 ? s[i + 4]! : 0
                            if (flat) curveBy(s[i]!, 0, s[i + 1]!, s[i + 2]!, last, s[i + 3]!)
                            else curveBy(0, s[i]!, s[i + 1]!, s[i + 2]!, s[i + 3]!, last)
                            flat = !flat
                        }
                        break
                    }
                    case 10: case 29: {
                        const list = b === 10 ? locals : globals, target = list[(s.pop() ?? 0) + bias(list)]
                        if (target && depth < MAX_CALLS) run(target, depth + 1)
                        continue
                    }
                    case 11: return
                    case 14:
                        dropWidth(s.length === 1 || s.length === 5)
                        if (s.length >= 4) throw new Error('it is made of the parts of two other glyphs, which is an old form of PostScript. Convert the font to TrueType')
                        close(); done = true; return
                    case 12: {
                        const c = u8(at++)
                        // Arithmetic leaves its result for the next operator. A drawing operator empties the stack.
                        if (ARITHMETIC[c]) {
                            const [operands, make] = ARITHMETIC[c]!
                            s.push(...make(...s.splice(Math.max(0, s.length - operands), operands)))
                            continue
                        }
                        if (c < 34 || c > 37) throw new Error(`it uses the operator 12 ${c} of PostScript, which Vizmatic does not read. Convert the font to TrueType`)
                        if (c === 34) { const dy = s[2]!; curveBy(s[0]!, 0, s[1]!, dy, s[3]!, 0); curveBy(s[4]!, 0, s[5]!, -dy, s[6]!, 0) }
                        else if (c === 35) { curveBy(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!); curveBy(s[6]!, s[7]!, s[8]!, s[9]!, s[10]!, s[11]!) }
                        else if (c === 36) { const y0 = y; curveBy(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, 0); curveBy(s[5]!, 0, s[6]!, s[7]!, s[8]!, y0 - (y + s[7]!)) }
                        else if (c === 37) {
                            const x0 = x, y0 = y, dx = s[0]! + s[2]! + s[4]! + s[6]! + s[8]!, dy = s[1]! + s[3]! + s[5]! + s[7]! + s[9]!
                            curveBy(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!)
                            const x4 = x + s[6]! + s[8]!, y4 = y + s[7]! + s[9]!
                            if (Math.abs(dx) > Math.abs(dy)) curveBy(s[6]!, s[7]!, s[8]!, s[9]!, s[10]!, y0 - y4)
                            else curveBy(s[6]!, s[7]!, s[8]!, s[9]!, x0 - x4, s[10]!)
                        }
                        break
                    }
                    default: break
                }
                stack.length = 0
            }
        }
        run(program, 0)
        close()
        return contours
    }
}
