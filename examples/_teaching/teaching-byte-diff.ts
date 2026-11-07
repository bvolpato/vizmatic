import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createTeachingByteDifference } from 'vizmatic'
import type { CanvasBounds, CanvasPainter } from 'vizmatic'

const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const bytes = (value: string) => new TextEncoder().encode(value)
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex').slice(0, 12)

/** Run: npx tsx examples/_teaching/teaching-byte-diff.ts [--reveal] > /tmp/byte-diff.svg */
export function renderByteDifferenceExample(revealVerdict = false, scanProgress = 1): string {
    const content: string[] = []
    const painter: CanvasPainter<CanvasBounds> = {
        rect(x, y, width, height, fill = 'none', stroke = 'none', radius = 0) {
            content.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`)
            return { x, y, width, height }
        },
        text(value, x, y, size, color = '#E9EFFF', align = 'left', font = 'sans') {
            const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
            content.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}" font-family="${font === 'mono' ? 'JetBrains Mono, monospace' : 'Inter, sans-serif'}">${xml(value)}</text>`)
        },
        container(_bounds, draw) { draw() },
        labelScope(bounds, draw) {
            if (bounds.width <= 0 || bounds.height <= 0) throw new Error('Invalid example label bounds')
            draw()
        },
        opacity(alpha, draw) { content.push(`<g opacity="${alpha}">`); draw(); content.push('</g>') },
        circle(x, y, radius, fill = 'none') { content.push(`<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}"/>`) },
    }
    painter.rect(0, 0, 1920, 1080, '#0A1018')
    painter.text('The filename stays. The bytes change.', 960, 65, 42, '#E9EFFF', 'center')
    const draw = createTeachingByteDifference(painter)
    for (const [index, [name, before, after]] of [
        ['EOF deletion', '4,0,82\n', '4,0,'],
        ['Replacement', 'ID=7\n', 'ID=9\n'],
        ['Insertion', 'ab\n', 'abX\n'],
    ].entries()) {
        const original = bytes(before), current = bytes(after), top = 95 + index * 325
        painter.text(`${name} · SHA-256 ${digest(original)}… → ${digest(current)}…`, 110, top + 25, 25, '#63DEEC')
        draw({ x: 110, y: top + 40, width: 1700, height: 270, fontSize: 25, maxColumns: 10,
            before: original, after: current, scanProgress, revealVerdict })
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">${content.join('')}</svg>`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.stdout.write(renderByteDifferenceExample(process.argv.includes('--reveal')))
}
