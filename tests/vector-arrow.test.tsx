import React from 'react'
import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'
import { renderToSvg } from '../src/render'
import { VectorArrow } from '../src/primitives/svg'

type ArrowProps = Parameters<typeof VectorArrow>[0]
type Point = [number, number]

async function renderArrow(props: ArrowProps) {
    const svg = await renderToSvg(
        React.createElement('svg', { width: 160, height: 160, viewBox: '0 0 160 160' }, VectorArrow(props)),
        160,
        160,
    )
    const embedded = svg.match(/href="data:image\/svg\+xml;utf8,([^"]+)"/)
    expect(embedded).not.toBeNull()
    return { svg: decodeURIComponent(embedded![1]), raster: new Resvg(svg).render() }
}

function triangle(svg: string): Point[] {
    const polygon = svg.match(/<polygon\b[^>]*points="([^"]+)"/)
    expect(polygon).not.toBeNull()
    return polygon![1].split(' ').map((point) => point.split(',').map(Number) as Point)
}

describe('VectorArrow', () => {
    it.each([
        [8, 0], [-8, 0], [0, 8], [0, -8],
        [4.8, 6.4], [-4.8, 6.4], [4.8, -6.4], [-4.8, -6.4],
    ])('keeps a short arrow inside its directed segment (%s, %s)', async (dx, dy) => {
        const arrow = { x1: 80, y1: 80, x2: 80 + dx, y2: 80 + dy, color: '#123456', strokeWidth: 3, arrowSize: 8 }
        const { svg, raster } = await renderArrow(arrow)
        const points = triangle(svg)
        const length = Math.hypot(dx, dy)
        const projection = ([x, y]: Point) => ((x - arrow.x1) * dx + (y - arrow.y1) * dy) / length

        expect(points).toHaveLength(3)
        expect(points[0]).toEqual([arrow.x2, arrow.y2])
        for (const point of points.slice(1)) expect(projection(point)).toBeCloseTo(0)
        expect(Math.hypot(points[1][0] - points[2][0], points[1][1] - points[2][1])).toBeGreaterThan(arrow.strokeWidth)
        expect(svg.match(/<line\b/g) ?? []).toHaveLength(0)

        const painted: number[] = []
        const pixels = raster.pixels
        for (let y = 0; y < raster.height; y++) {
            for (let x = 0; x < raster.width; x++) {
                if (pixels[(y * raster.width + x) * 4 + 3] > 0) {
                    painted.push(projection([x + 0.5, y + 0.5]))
                }
            }
        }
        expect(painted.length).toBeGreaterThan(0)
        expect(Math.min(...painted)).toBeGreaterThanOrEqual(-1)
        expect(Math.max(...painted)).toBeLessThanOrEqual(length + 1)
    })

    it('keeps a clipped head wider than the shaft on a very short segment', async () => {
        const { svg } = await renderArrow({ x1: 80, y1: 80, x2: 81, y2: 80, color: '#123456', strokeWidth: 4, arrowSize: 8 })
        const [tip, left, right] = triangle(svg)
        expect(tip).toEqual([81, 80])
        expect(left[0]).toBe(80)
        expect(right[0]).toBe(80)
        expect(Math.abs(left[1] - right[1])).toBeGreaterThan(4)
    })

    it('omits the round-capped shaft when the head exactly fills the segment', async () => {
        const { svg } = await renderArrow({ x1: 80, y1: 80, x2: 104, y2: 80, color: '#123456', strokeWidth: 3, arrowSize: 8 })
        expect(svg.match(/<line\b/g) ?? []).toHaveLength(0)
        expect(triangle(svg)).toEqual([[104, 80], [80, 87.2], [80, 72.8]])
    })

    it('preserves the rendered SVG for long arrows with default and custom heads', async () => {
        const defaultHead = await renderArrow({ x1: 16, y1: 116, x2: 112, y2: 44, color: '#123456' })
        expect(defaultHead.svg).toMatchInlineSnapshot(`"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><g opacity="1" style="min-width:0;min-height:0;flex-shrink:0"><line x1="16" y1="116" x2="108.48" y2="46.64" stroke="#123456" stroke-width="2" stroke-linecap="round" style="min-width:0;min-height:0;flex-shrink:0"/><polygon points="112,44 109.272,47.696 107.688,45.584" fill="#123456" style="min-width:0;min-height:0;flex-shrink:0"/></g></svg>"`)
        const customHead = await renderArrow({ x1: 140, y1: 32, x2: 20, y2: 32, color: '#123456', strokeWidth: 3, arrowSize: 8, opacity: 0.4 })
        expect(customHead.svg).toMatchInlineSnapshot(`"<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><g opacity="0.4" style="min-width:0;min-height:0;flex-shrink:0"><line x1="140" y1="32" x2="44" y2="32" stroke="#123456" stroke-width="3" stroke-linecap="round" style="min-width:0;min-height:0;flex-shrink:0"/><polygon points="20,32 44,24.8 44,39.2" fill="#123456" style="min-width:0;min-height:0;flex-shrink:0"/></g></svg>"`)
    })

    it('keeps zero-length vectors empty', async () => {
        const { svg, raster } = await renderArrow({ x1: 80, y1: 80, x2: 80, y2: 80, color: '#123456' })
        expect(svg.match(/<(?:line|polygon)\b/g) ?? []).toHaveLength(0)
        expect(raster.pixels.every((channel, index) => index % 4 !== 3 || channel === 0)).toBe(true)
    })
})
