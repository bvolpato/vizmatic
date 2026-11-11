import { describe, expect, it } from 'vitest'
import { createTeachingRasterWipe } from '../src/teaching-raster-wipe'

function render(split: number) {
    const tiles: [number, number, number, number, string | undefined][] = []
    const wipe = createTeachingRasterWipe({ rect(x, y, w, h, fill) { tiles.push([x, y, w, h, fill]) } })
    const options = {
        x: 12, y: 20, width: 90, height: 20, rows: 2, columns: 3,
        left: new Uint8Array([1, 2, 3, 4, 5, 6]), right: new Uint8Array([11, 12, 13, 14, 15, 16]),
        split, color: (value: number) => String(value),
    }
    return { ...wipe(options), tiles, wipe, options }
}

describe('raster wipe', () => {
    it('keeps the source index on both sides of a split through a rectangular pixel', () => {
        const { dividerX, tiles } = render(0.5)
        expect(dividerX).toBe(57)
        expect(tiles).toEqual([
            [12, 20, 30, 10, '1'], [42, 20, 15, 10, '2'], [57, 20, 15, 10, '12'], [72, 20, 30, 10, '13'],
            [12, 30, 30, 10, '4'], [42, 30, 15, 10, '5'], [57, 30, 15, 10, '15'], [72, 30, 30, 10, '16'],
        ])
    })

    it('shows exactly one field at each end and draws whole cells at a cell boundary', () => {
        expect(render(0).tiles.map(tile => tile[4])).toEqual(['11', '12', '13', '14', '15', '16'])
        expect(render(1).tiles.map(tile => tile[4])).toEqual(['1', '2', '3', '4', '5', '6'])
        expect(render(1 / 3).tiles.map(tile => tile[4])).toEqual(['1', '12', '13', '4', '15', '16'])
    })

    it('keeps matching colors seamless while the divider travels between pixels', () => {
        const { options, wipe, tiles } = render(0)
        const expected = [...tiles]
        tiles.length = 0
        wipe({ ...options, split: 0.51, left: options.right })
        expect(tiles).toEqual(expected)
    })

    it('rejects mismatched fields and invalid geometry before painting', () => {
        const { options, wipe, tiles } = render(1)
        tiles.length = 0
        expect(() => wipe({ ...options, right: new Uint8Array(3) })).toThrow(/Both rasters/)
        expect(() => wipe({ ...options, rows: -1 })).toThrow(/rows and columns/)
        expect(() => wipe({ ...options, width: 0 })).toThrow(/bounds/)
        expect(() => wipe({ ...options, split: NaN })).toThrow(/split/)
        expect(tiles).toEqual([])
    })
})
