import { describe, expect, it } from 'vitest'
import { measureRegionChange } from '../src/region-change'

const width = 8, height = 6
const region = { x: 2, y: 1, width: 4, height: 3 }
const options = { width, height, region }
const reference = new Uint8ClampedArray(width * height * 4).fill(128)
const offset = (x: number, y: number) => 4 * (y * width + x)

describe('measureRegionChange', () => {
    it('ignores caption changes and inclusive channel noise during a reading hold', () => {
        const held = Uint8Array.from(reference, v => v + 12)
        held.fill(255, offset(0, 4))
        held[offset(6, 2)] = 0
        expect(measureRegionChange(reference, held, options)).toEqual({ changedPixels: 0, bounds: undefined })

        held[offset(2, 1) + 2] = 141
        held[offset(5, 3)] = 112
        expect(measureRegionChange(reference, held, options)).toEqual({ changedPixels: 2, bounds: region })
    })

    it('finds a gradual reveal from its starting frame and permits a new hold after it settles', () => {
        const frames = [0, 6, 12, 18, 18].map(delta => {
            const pixels = reference.slice()
            pixels[offset(4, 2) + 1] += delta
            return pixels
        })
        expect(frames.findIndex(frame => measureRegionChange(frames[0], frame, options).changedPixels > 0)).toBe(3)
        expect(measureRegionChange(frames[3], frames[4], options).changedPixels).toBe(0)
    })

    it('keeps a one-level alpha-only difference for exact GIF crops', () => {
        const current = reference.slice()
        current[offset(5, 3) + 3]--
        expect(measureRegionChange(reference, current, { ...options, tolerance: 0 }))
            .toEqual({ changedPixels: 1, bounds: { x: 5, y: 3, width: 1, height: 1 } })
    })

    it('rejects truncated frames, fractional or clipped regions, and invalid tolerances', () => {
        expect(() => measureRegionChange(reference.subarray(4), reference, options)).toThrow(/dimensions/)
        for (const box of [{ ...region, x: -1 }, { ...region, y: 1.5 }, { ...region, width: 0 }, { ...region, height }]) {
            expect(() => measureRegionChange(reference, reference, { ...options, region: box })).toThrow(/region/)
        }
        for (const tolerance of [-1, 0.5, 256, NaN]) {
            expect(() => measureRegionChange(reference, reference, { ...options, tolerance })).toThrow(/tolerance/)
        }
    })
})
