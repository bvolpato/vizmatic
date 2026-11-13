import type { CropRegion } from './autocrop'

export interface RegionChangeOptions {
    /** Dimensions of both packed RGBA frames, in pixels. */
    width: number
    height: number
    /** Rectangle in decoded frame coordinates, measured from the top left. */
    region: CropRegion
    /** Ignore differences up to this many levels in each 8-bit channel. Defaults to 12. */
    tolerance?: number
}

/** Count changed pixels in the chosen region and locate their bounds in the frame. */
export function measureRegionChange(
    reference: Uint8Array | Uint8ClampedArray,
    current: Uint8Array | Uint8ClampedArray,
    { width, height, region, tolerance = 12 }: RegionChangeOptions,
): { changedPixels: number; bounds: CropRegion | undefined } {
    const bytes = width * height * 4
    if (![width, height, bytes].every(Number.isSafeInteger) || width < 1 || height < 1
        || reference.length !== bytes || current.length !== bytes) {
        throw new RangeError('Both RGBA frames must match the given positive pixel dimensions')
    }
    const { x, y, width: columns, height: rows } = region
    if (![x, y, columns, rows].every(Number.isSafeInteger) || x < 0 || y < 0
        || columns < 1 || rows < 1 || x + columns > width || y + rows > height) {
        throw new RangeError('The region must be a nonempty integer rectangle inside the frame')
    }
    if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 255) {
        throw new RangeError('Channel tolerance must be an integer from 0 to 255')
    }

    let changedPixels = 0
    let left = x + columns, right = -1, top = y + rows, bottom = -1
    for (let row = y; row < y + rows; row++) {
        let i = (row * width + x) * 4
        for (let col = x; col < x + columns; col++, i += 4) {
            if (Math.abs(reference[i] - current[i]) <= tolerance
                && Math.abs(reference[i + 1] - current[i + 1]) <= tolerance
                && Math.abs(reference[i + 2] - current[i + 2]) <= tolerance
                && Math.abs(reference[i + 3] - current[i + 3]) <= tolerance) continue
            changedPixels++
            left = Math.min(left, col)
            right = Math.max(right, col)
            top = Math.min(top, row)
            bottom = row
        }
    }
    const bounds = changedPixels ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : undefined
    return { changedPixels, bounds }
}
