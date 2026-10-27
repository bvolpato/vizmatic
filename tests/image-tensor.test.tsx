import React from 'react'
import { describe, expect, it } from 'vitest'
import { PixelGrid, cropRgbImage, flattenRgbImage, rgbChannel, type RgbPixel } from '../src/primitives/image-tensor'
import { renderToSvg } from '../src/render'
import { getThemeColors } from '../src/theme'

const pixels: RgbPixel[][] = [
    [[255, 0, 16], [32, 64, 128]],
    [[10, 20, 30], [200, 150, 100]],
]

function collectRects(node: React.ReactNode): React.ReactElement[] {
    const rects: React.ReactElement[] = []
    React.Children.forEach(node, child => {
        if (!React.isValidElement(child)) return
        const element = child as React.ReactElement
        if (element.type === 'rect') rects.push(element)
        rects.push(...collectRects((element.props as { children?: React.ReactNode }).children))
    })
    return rects
}

describe('RGB image tensor helpers', () => {
    it('extracts byte-valued red, green, and blue matrices without changing the source', () => {
        const before = JSON.stringify(pixels)
        expect(rgbChannel(pixels, 'red')).toEqual([[255, 32], [10, 200]])
        expect(rgbChannel(pixels, 'green')).toEqual([[0, 64], [20, 150]])
        expect(rgbChannel(pixels, 'blue')).toEqual([[16, 128], [30, 100]])
        expect(JSON.stringify(pixels)).toBe(before)
    })

    it('crops rectangular regions in row-major order as copied RGB tuples', () => {
        const before = JSON.stringify(pixels)
        const crop = cropRgbImage(pixels, { row: 0, column: 1, rows: 2, columns: 1 })
        expect(crop).toEqual([[[32, 64, 128]], [[200, 150, 100]]])
        expect(crop[0][0]).not.toBe(pixels[0][1])
        crop[0][0] = [1, 2, 3]
        expect(JSON.stringify(pixels)).toBe(before)
    })

    it('flattens HWC and CHW layouts exactly and normalizes bytes by 255', () => {
        const hwc = [255, 0, 16, 32, 64, 128, 10, 20, 30, 200, 150, 100]
        const chw = [255, 32, 10, 200, 0, 64, 20, 150, 16, 128, 30, 100]
        expect(flattenRgbImage(pixels)).toEqual(hwc)
        expect(flattenRgbImage(pixels, 'CHW')).toEqual(chw)
        expect(flattenRgbImage(pixels, 'HWC', true)).toEqual(hwc.map(value => value / 255))
        expect(flattenRgbImage(pixels, 'CHW', true)).toEqual(chw.map(value => value / 255))
    })

    it('rejects invalid images, tensor layouts, and crop bounds', () => {
        expect(() => rgbChannel([], 'red')).toThrow('at least one nonempty row')
        expect(() => rgbChannel(pixels, 'rgb' as 'red')).toThrow("must be 'red', 'green', or 'blue'")
        expect(() => flattenRgbImage([[]])).toThrow('at least one nonempty row')
        expect(() => flattenRgbImage([[[1, 2, 3]], [[4, 5, 6], [7, 8, 9]]] as RgbPixel[][])).toThrow('rectangular')
        expect(() => flattenRgbImage([[[1, 2]]] as unknown as RgbPixel[][])).toThrow('exactly three channels')
        expect(() => flattenRgbImage([[[1, 2, 3, 4]]] as unknown as RgbPixel[][])).toThrow('exactly three channels')
        expect(() => flattenRgbImage([[[-1, 2, 3]]] as RgbPixel[][])).toThrow('integer from 0 to 255')
        expect(() => flattenRgbImage([[[1, 2.5, 3]]] as RgbPixel[][])).toThrow('integer from 0 to 255')
        expect(() => flattenRgbImage([[[1, 256, 3]]] as RgbPixel[][])).toThrow('integer from 0 to 255')
        expect(() => flattenRgbImage(pixels, 'WHC' as 'HWC')).toThrow("'HWC' or 'CHW'")
        expect(() => flattenRgbImage(pixels, 'HWC', 1 as unknown as boolean)).toThrow('must be a boolean')
        expect(() => cropRgbImage(pixels, { row: 1, column: 1, rows: 2, columns: 1 })).toThrow('within the RGB image bounds')
        expect(() => cropRgbImage(pixels, { row: 0, column: 0, rows: 1.5, columns: 1 })).toThrow('positive integer rows')
        expect(() => rgbChannel(Array.from({ length: 129 }, () => [[0, 0, 0] as const]), 'red')).toThrow('at most 128 rows')
        expect(() => rgbChannel(Array.from({ length: 33 }, () => Array.from({ length: 32 }, () => [0, 0, 0] as const)), 'red')).toThrow('at most 1024 pixels')
    })
})

describe('PixelGrid', () => {
    it('renders square channel cells centered in non-square bounds and layers overlays without changing pixels', async () => {
        const source = [[[12, 34, 56]], [[78, 90, 123]]] as RgbPixel[][]
        const before = JSON.stringify(source)
        const grid = PixelGrid({
            pixels: source,
            c: getThemeColors('dark'),
            width: 120,
            height: 60,
            channel: 'red',
            region: { row: 0, column: 0, rows: 2, columns: 1 },
            activeCell: { row: 1, column: 0 },
            highlightColor: '#00ff00',
        })
        const rects = collectRects(grid)
        const props = rects.map(rect => rect.props as Record<string, unknown>)
        expect(props.slice(0, 2)).toEqual([
            expect.objectContaining({ x: 45, y: 0, width: 30, height: 30, fill: 'rgb(12, 0, 0)' }),
            expect.objectContaining({ x: 45, y: 30, width: 30, height: 30, fill: 'rgb(78, 0, 0)' }),
        ])
        const region = props.find(value => value.stroke === '#00ff00')
        expect(region).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number), fill: 'none' }))
        expect(Number(region?.width)).toBeCloseTo(30 - 30 * 0.16)
        expect(Number(region?.height)).toBeCloseTo(60 - 30 * 0.16)
        expect(props.at(-1)).toEqual(expect.objectContaining({ x: 45 + 30 * 0.16 / 2, y: 30 + 30 * 0.16 / 2, width: 30 - 30 * 0.16, height: 30 - 30 * 0.16 }))
        expect(JSON.stringify(source)).toBe(before)

        const svg = await renderToSvg(grid, 120, 60)
        expect(svg).toContain('rgb(12, 0, 0)')
        expect(svg).toContain('rgb(78, 0, 0)')
        expect(svg).toContain('viewBox="0 0 120 60"')
        expect(svg).not.toMatch(/NaN|Infinity/)
    })

    it('renders RGB colors by default and rejects invalid sizes, selections, and channel modes', () => {
        const onePixel: RgbPixel[][] = [[[10, 20, 30]]]
        const defaultGrid = PixelGrid({ pixels: onePixel })
        const defaultGridProps = defaultGrid.props as { style: React.CSSProperties }
        expect(defaultGridProps.style.width).toBe(320)
        expect(defaultGridProps.style.height).toBe(320)
        expect(collectRects(defaultGrid)[0].props).toEqual(expect.objectContaining({ fill: 'rgb(10, 20, 30)' }))

        const c = getThemeColors('light')
        expect(() => PixelGrid({ pixels: onePixel, c, width: 0 })).toThrow('finite values greater than 0')
        expect(() => PixelGrid({ pixels: onePixel, c, height: Number.POSITIVE_INFINITY })).toThrow('finite values greater than 0')
        expect(() => PixelGrid({ pixels: onePixel, c, width: 32769 })).toThrow('at most 32768')
        expect(() => PixelGrid({ pixels: onePixel, c, channel: 'infrared' as 'rgb' })).toThrow("'rgb', 'red', 'green', or 'blue'")
        expect(() => PixelGrid({ pixels: onePixel, c, activeCell: { row: 0, column: 1 } })).toThrow('Active pixel cell')
        expect(() => PixelGrid({ pixels: onePixel, c, region: { row: 0, column: 0, rows: 1, columns: 2 } })).toThrow('within the RGB image bounds')
        expect(() => PixelGrid({ pixels: onePixel, c, region: null as never })).toThrow('Pixel region must be an object')
        expect(() => PixelGrid({ pixels: onePixel, c, highlightColor: ' ' })).toThrow('nonempty color string')
    })
})
