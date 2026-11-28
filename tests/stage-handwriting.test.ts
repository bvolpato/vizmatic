import { describe, expect, it } from 'vitest'
import { compileFilm, dipPen, film, glyphPath, handwriting, parseFont, pathBounds, rectPath, ring, text, type Handwriting, type Path } from '../src/stage'
import { penStrokes } from '../src/stage/centerline'

/** The area of the union of the rings, from a grid: the rings of ink overlap. */
function covered(path: Path, step = 2): { count: number; has: (x: number, y: number) => boolean } {
    const polygons = path.map(({ p }) => { const out: number[] = []; for (let i = 0; i + 1 < p.length; i += 2) if (i % 6 === 0) out.push(p[i]!, p[i + 1]!); return out })
    const has = (x: number, y: number) => {
        let winding = 0
        for (const g of polygons) for (let i = 0; i < g.length; i += 2) {
            const j = (i + 2) % g.length, ya = g[i + 1]!, yb = g[j + 1]!
            if ((ya <= y) !== (yb <= y) && g[i]! + (y - ya) / (yb - ya) * (g[j]! - g[i]!) > x) winding += yb > ya ? 1 : -1
        }
        return winding !== 0
    }
    const box = pathBounds(path)
    let count = 0
    if (box) for (let y = box.y + step / 2; y < box.y + box.height; y += step) for (let x = box.x + step / 2; x < box.x + box.width; x += step) if (has(x, y)) count++
    return { count, has }
}

const make = async (build: () => Handwriting): Promise<Handwriting> => {
    let made: Handwriting | undefined
    await compileFilm(film((s) => { made = build(); s.wait(1) }))
    return made!
}

describe('the way of a pen through a shape', () => {
    it('finds one line through a bar, with the half width of the bar', () => {
        const strokes = penStrokes(rectPath(10, 20, 200, 16), 100)
        expect(strokes).toHaveLength(1)
        const points = strokes[0]!
        for (const [, y, r] of points.slice(4, -4)) { expect(Math.abs(y - 28)).toBeLessThan(1); expect(Math.abs(r - 8)).toBeLessThan(1.2) }
        expect(points[0]![0]).toBeLessThan(points.at(-1)![0])
        expect(points[0]![0]).toBeLessThan(24)
        expect(points.at(-1)![0]).toBeGreaterThan(196)
    })

    it('goes around a ring, and draws a dot that is apart after the body', () => {
        const circle = (x: number, y: number, r: number, back = false) => { const n = 24, out: number[] = []; for (let i = 0; i <= n; i++) { const a = (back ? -1 : 1) * i / n * Math.PI * 2, p = [x + Math.cos(a) * r, y + Math.sin(a) * r] as const; if (i === 0) out.push(...p); else { const px = out.at(-2)!, py = out.at(-1)!; out.push(px + (p[0] - px) / 3, py + (p[1] - py) / 3, px + (p[0] - px) * 2 / 3, py + (p[1] - py) * 2 / 3, ...p) } } return ring(new Float64Array(out), true) }
        const around = penStrokes([circle(100, 100, 50), circle(100, 100, 38, true)], 100)
        expect(around).toHaveLength(1)
        for (const [x, y, r] of around[0]!) { expect(Math.abs(Math.hypot(x - 100, y - 100) - 44)).toBeLessThan(1.6); expect(Math.abs(r - 6)).toBeLessThan(1.2) }
        const letter = penStrokes([...rectPath(0, 40, 10, 80), circle(5, 10, 8)], 100)
        expect(letter).toHaveLength(2)
        expect(letter[0]!.length).toBeGreaterThan(letter[1]!.length)
        expect(Math.abs(letter[1]![0]![1] - 10)).toBeLessThan(3)
    })

    it('writes a letter with a loop from the side from which a hand does, and keeps the bars of a heavy sign', async () => {
        const { readFile } = await import('node:fs/promises')
        const bytes = await readFile('assets/fonts/InstrumentSerif-Italic.ttf'), font = parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
        const ends = (char: string) => { const [stroke] = penStrokes(glyphPath(font, font.glyphFor(char.codePointAt(0)!), 200), 200); return [stroke![0]!, stroke!.at(-1)!] as const }
        const e = ends('e'), six = ends('6')
        expect(e[0][0]).toBeLessThan(e[1][0])
        expect(six[0][1]).toBeLessThan(six[1][1] - 30)
        // Two bars across two bars, with short arms.
        const bar = (x: number, y: number, w: number, h: number) => rectPath(x, y, w, h)
        const sign = penStrokes([...bar(0, 30, 130, 24), ...bar(0, 76, 130, 24), ...bar(30, 0, 24, 130), ...bar(76, 0, 24, 130)], 130)
        expect(sign).toHaveLength(4)
        for (const stroke of sign) expect(Math.hypot(stroke.at(-1)![0] - stroke[0]![0], stroke.at(-1)![1] - stroke[0]![1])).toBeGreaterThan(95)
    })
})

describe('handwriting', () => {
    it('gives the letters back when it is all written, and grows from the left until then', async () => {
        const words = await make(() => handwriting('Dear Sirs', { size: 200, anchor: 'left' }))
        let plain: Path = []
        await compileFilm(film(() => { const node = text('Dear Sirs', { font: 'serif', italic: true, size: 200, anchor: 'left' }); plain = node.chars.flatMap((leaf) => [...leaf.base.path!]) }))
        expect(words.ink(0)).toEqual([])
        expect(words.ink(1).length).toBe(plain.length)
        let before = 0
        const full = covered(words.ink(1)), right = (part: number) => { const box = pathBounds(words.ink(part))!; return box.x + box.width }
        for (const part of [0.15, 0.4, 0.7, 0.95]) {
            const { count } = covered(words.ink(part))
            expect(count).toBeGreaterThan(before)
            before = count
        }
        expect(before).toBeLessThan(full.count * 1.02)
        expect(right(0.2)).toBeLessThan(right(0.5))
        // The ink of the strokes fills the letters, and does not leave them by more than a pixel or two.
        const almost = covered(words.ink(0.99999), 2)
        expect(Math.abs(almost.count - full.count) / full.count).toBeLessThan(0.05)
    })

    it('has the point of the pen on the ink that it draws, and lifts it between two words', async () => {
        const words = await make(() => handwriting('it is', { size: 200 }))
        let down = 0, up = 0
        for (let part = 0.02; part < 1; part += 0.02) {
            const tip = words.tip(part)
            if (!tip.down) { up++; continue }
            down++
            const { has } = covered(words.ink(part))
            const near = [0, 1, 2, 3].some((d) => [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d]].some(([dx, dy]) => has(tip.x + dx!, tip.y + dy!)))
            expect(near, `the pen at ${part}`).toBe(true)
        }
        expect(down).toBeGreaterThan(10)
        expect(up).toBeGreaterThan(1)
        const it = words.part('it'), is = words.part('is')
        expect(it.from).toBe(0)
        expect(it.to).toBeLessThan(is.from)
        expect(is.to).toBeCloseTo(1, 9)
        expect(() => words.part('was')).toThrow('does not have the words "was"')
    })

    it('writes on the timeline at the pace of a hand, with a pen', async () => {
        let seconds = 0
        const compiled = await compileFilm(film({ fps: 10, bloom: 0 }, (s) => {
            const note = handwriting('A note', { size: 100, color: '#112233' }).at(0, 100).hold(dipPen())
            seconds = note.seconds
            s.play(note.write())
            s.wait(1)
        }))
        expect(seconds).toBeGreaterThan(1)
        expect(seconds).toBeLessThan(8)
        expect(compiled.duration).toBeCloseTo(seconds + 1, 6)
        const ops = (time: number) => compiled.frame(time).ops.length
        expect(ops(seconds / 2)).toBeGreaterThan(4)
        // At the end there is one path of ink, and no pen.
        expect(ops(seconds + 0.5)).toBe(1)
    })

    it('says what is wrong', async () => {
        await expect(make(() => handwriting('  '))).rejects.toThrow('give the words to write')
        await expect(make(() => handwriting('a', { written: 2 }))).rejects.toThrow('written is 2')
        await expect(make(() => handwriting('\u200b'))).rejects.toThrow('has no letter that draws something')
        await expect(make(() => handwriting('a \u{10FFFD}'))).rejects.toThrow('no font has a letter for')
        const same = await make(() => handwriting('a', { size: 100, font: undefined })), usual = await make(() => handwriting('a', { size: 100 }))
        expect(same.ink(1)).toEqual(usual.ink(1))
    })
})
