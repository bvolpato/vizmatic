import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { compileFilm, film, narrated, parseFont, registerFont, sceneKit, text, textWidth } from '../src/stage'

const file = (name: string) => new URL(`./fixtures/fonts/${name}`, import.meta.url)
const bytes = async (name: string) => { const data = await readFile(file(name)); return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer }

describe('fonts of a film', () => {
    it('reads the Type 2 operators of an OpenType font with PostScript curves as fontTools does', async () => {
        const font = parseFont(await bytes('operators.otf'))
        const expected = JSON.parse(await readFile(file('operators.json'), 'utf8')) as Record<string, { advance: number; contours: number[][] }>
        for (const [name, { advance, contours }] of Object.entries(expected)) {
            const glyph = font.glyphFor(name.codePointAt(0)!)
            expect(font.advance(glyph), name).toBe(advance)
            const read = font.outline(glyph)!.contours
            expect(read.length, name).toBe(contours.length)
            read.forEach((contour, i) => contours[i]!.forEach((value, at) => expect(contour[at], `${name} ${at}`).toBeCloseTo(value, 6)))
            // Each contour is closed, as a ring of cubics.
            for (const contour of read) { expect((contour.length - 2) % 6).toBe(0); expect(contour.slice(0, 2)).toEqual(contour.slice(-2)) }
        }
    })

    it('gives a registered font to a text, to a measure, to a film and to its kit, and takes the rest from the library', async () => {
        registerFont('square', file('square.ttf'))
        registerFont('operators', { 400: await bytes('operators.otf'), 700: file('square.ttf') })
        let seen: Record<string, unknown> = {}
        await compileFilm(film({ font: 'square' }, (s) => {
            const plain = s.add(text('AB', { size: 100 })), bold = text('AB', { size: 100, font: 'operators', weight: 700 }), other = text('AB', { size: 100, font: 'operators' })
            const far = text('é', { size: 100 })
            seen = { font: plain.font, width: plain.chars[0]!.bounds().width, bold: bold.chars[0]!.bounds().width, other: Math.round(other.chars[0]!.bounds().width), kit: sceneKit().font, measure: textWidth('AA', 100, { font: 'square' }), fallback: far.chars.length, missing: far.chars[0]!.data['missingGlyph'] }
        }))
        expect(seen).toMatchObject({ font: 'square', width: 70, bold: 70, other: 30, kit: 'square', measure: 102, fallback: 1, missing: undefined })
    })

    it('takes a registered font for a narrated film', async () => {
        registerFont('square', file('square.ttf'))
        const timing = { lead: 1, gap: 0.4, scenes: [{ id: 'one', beats: [{ say: 'A.', duration: 1, words: [{ text: 'A.', start: 0.1, end: 0.5 }] }] }] }
        let font = ''
        await compileFilm(narrated({ title: 'A', font: 'square', intro: false, timing, scenes: { one: (s) => { font = s.add(text('A')).font } } }))
        expect(font).toBe('square')
    })

    it('says what is wrong with a font, and what to do', async () => {
        const build = (make: () => void) => compileFilm(film((s) => { make(); s.wait(1) }))
        await expect(build(() => text('A', { font: 'poster' }))).rejects.toThrow(`Unknown font "poster". The fonts are: sans, serif, text-serif, mono, noto`)
        await expect(build(() => text('A', { font: 'toString' }))).rejects.toThrow('Unknown font "toString"')
        await expect(compileFilm(film({ font: 'poster' }, (s) => { s.wait(1) }))).rejects.toThrow('film: font is')
        expect(() => registerFont('sans', file('square.ttf'))).toThrow("'sans' is a font of the library")
        expect(() => registerFont('my font', file('square.ttf'))).toThrow('Give letters, digits')
        expect(() => registerFont('poster', { 700: file('square.ttf') } as never)).toThrow('needs a file')
        expect(() => registerFont('poster', { 400: file('square.ttf'), 900: file('square.ttf') } as never)).toThrow('has the key "900"')
        registerFont('gone', file('gone.ttf'))
        await expect(build(() => text('A', { font: 'gone' }))).rejects.toThrow("The font 'gone' cannot be loaded")
        registerFont('zip', new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 0, 0, 0, 0, 0]))
        await expect(build(() => text('A', { font: 'zip' }))).rejects.toThrow("The font 'zip' cannot be read: Stage text needs a TrueType (.ttf) or OpenType (.otf) font, and this is a WOFF2 file")
    })

    it('reads another file when a name is registered again', async () => {
        const width = async () => { let out = 0; await compileFilm(film(() => { out = Math.round(text('A', { size: 100, font: 'swap' }).chars[0]!.bounds().width) })); return out }
        registerFont('swap', file('square.ttf'))
        expect(await width()).toBe(70)
        registerFont('swap', file('operators.otf'))
        expect(await width()).toBe(30)
    })
})
