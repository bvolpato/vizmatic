import { readFile, writeFile } from 'node:fs/promises'
import { glyphPath, parseFont } from '../src/stage/font'
import { pathToD, transformPath } from '../src/stage/geometry'

/**
 * The mark is one drawn curve that ends on a point: a "v" made in a single
 * stroke. The wordmark is outlined from Source Serif 4, so the SVG needs no font.
 */
export const MARK_PATH = 'M5.5 8.2C9.4 8.2 11.2 12.1 13.2 18.2C15.1 24 16.6 29.8 18.4 29.8C20.6 29.8 22.5 22.6 25.2 15.9C26.8 11.9 28.6 9 31 7.6'
export const MARK_POINT = { x: 33.4, y: 6.4, r: 2.9 }

const SCHEME = (ink: string, paperInk: string, accent: string, paperAccent: string) => `<style>.i{stroke:${ink};fill:none}.w{fill:${ink}}.p{fill:${accent}}@media (prefers-color-scheme:light){.i{stroke:${paperInk}}.w{fill:${paperInk}}.p{fill:${paperAccent}}}</style>`

export async function buildLogo(): Promise<void> {
    const bytes = await readFile('assets/fonts/SourceSerif4-24pt-Regular.ttf')
    const font = parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const size = 34
    const scale = size / font.unitsPerEm
    let x = 46
    let previous = 0
    const parts: string[] = []
    for (const char of 'vizmatic') {
        const glyph = font.glyphFor(char.codePointAt(0)!)
        if (previous) x += font.kern(previous, glyph) * scale
        parts.push(pathToD(transformPath(glyphPath(font, glyph, size), [1, 0, 0, 1, x, 28.5])))
        x += font.advance(glyph) * scale
        previous = glyph
    }
    const width = Math.ceil(x + 6)
    const style = SCHEME('#f2efe6', '#1d1b16', '#ffd75e', '#a86f00')
    const mark = `<path class="i" d="${MARK_PATH}" stroke-width="2.6" stroke-linecap="round"/><circle class="p" cx="${MARK_POINT.x}" cy="${MARK_POINT.y}" r="${MARK_POINT.r}"/>`
    await writeFile('docs/assets/icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" role="img" aria-label="Vizmatic">${style}${mark}</svg>\n`)
    await writeFile('docs/assets/logo.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 40" role="img" aria-label="Vizmatic">${style}${mark}<path class="w" d="${parts.join('')}"/></svg>\n`)
}

if (process.argv[1]?.endsWith('build-logo.ts')) await buildLogo()
