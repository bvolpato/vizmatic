import { describe, expect, it } from 'vitest'
import {
    mattePlaygroundPixels,
    playgroundAnimationFrames,
    validatePlaygroundTime,
} from '../src/playground-animation'
import { createPlaygroundGif } from '../src/playground-animation-gif'
import { playgroundAnimationTemplate } from '../src/playground-animation-template'
import { preparePlaygroundSource } from '../src/playground-source'

function gifFrames(buffer: ArrayBuffer): Array<{ delay: number; transparent: boolean }> {
    const bytes = new Uint8Array(buffer)
    const frames: Array<{ delay: number; transparent: boolean }> = []
    let offset = 13 + (bytes[10] & 0x80 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0)
    const skipBlocks = () => {
        while (bytes[offset]) offset += bytes[offset] + 1
        offset += 1
    }
    while (bytes[offset] !== 0x3b && offset < bytes.length) {
        const marker = bytes[offset++]
        if (marker === 0x21) {
            const label = bytes[offset++]
            if (label === 0xf9) {
                frames.push({ delay: (bytes[offset + 2] | bytes[offset + 3] << 8) * 10, transparent: Boolean(bytes[offset + 1] & 1) })
            }
            skipBlocks()
        } else if (marker === 0x2c) {
            const packed = bytes[offset + 8]
            offset += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0)
            offset += 1 // LZW code size.
            skipBlocks()
        } else {
            throw new Error(`Unknown GIF block ${marker}`)
        }
    }
    return frames
}

describe('browser animation contract', () => {
    it('strips validated animation metadata and preserves a local t binding', () => {
        const prepared = preparePlaygroundSource(`animationDuration = 2.4
animationFps = 12; // Frames per second.
const t = 1
<Scene title={String(t)} />`)
        expect(prepared.metadata.animation).toEqual({ duration: 2.4, fps: 12 })
        expect(prepared.setup).toContain('const t = 1')
        expect(prepared.setup).not.toContain('animationFps')
        expect(preparePlaygroundSource(playgroundAnimationTemplate.source).metadata.animation).toEqual({ duration: 3, fps: 10 })
        expect(preparePlaygroundSource('animationDuration = 1\n<Scene />').metadata.animation).toEqual({ duration: 1, fps: 10 })
    })

    it('rejects invalid preamble metadata and leaves local names in setup untouched', () => {
        expect(() => preparePlaygroundSource('animationDuration = duration\n<Scene />')).toThrow('must be a numeric literal')
        expect(() => preparePlaygroundSource('animationDuration = 0\n<Scene />')).toThrow('greater than 0')
        expect(() => preparePlaygroundSource('animationDuration = 11\n<Scene />')).toThrow('at most 10 seconds')
        expect(() => preparePlaygroundSource('animationDuration = 1\nanimationFps = 30.5\n<Scene />')).toThrow('integer from 1 to 30')
        expect(() => preparePlaygroundSource('animationFps = 10\n<Scene />')).toThrow('requires animationDuration')
        const prepared = preparePlaygroundSource('const value = 2\nconst animationDuration = value\n<Scene />')
        expect(prepared.metadata.animation).toBeUndefined()
        expect(prepared.setup).toContain('const animationDuration = value')
        expect(validatePlaygroundTime(5, { duration: 3, fps: 10 })).toBe(3)
        expect(() => validatePlaygroundTime(Number.NaN)).toThrow('nonnegative finite')
        expect(() => validatePlaygroundTime(-1)).toThrow('nonnegative finite')
    })

    it('samples a deterministic loop with GIF cadence and rejects excessive work', () => {
        const frames = playgroundAnimationFrames({ duration: 1, fps: 30 }, 100, 100)
        expect(frames).toHaveLength(30)
        expect(frames[0].time).toBe(0)
        expect(frames.at(-1)?.time).toBeLessThan(1)
        expect(frames.reduce((sum, frame) => sum + frame.delay, 0)).toBe(1000)
        expect(frames.every((frame) => frame.delay === 30 || frame.delay === 40)).toBe(true)
        const partial = playgroundAnimationFrames({ duration: 1.001, fps: 20 }, 100, 100)
        expect(partial.reduce((sum, frame) => sum + frame.delay, 0)).toBe(1000)
        expect(partial.every((frame) => frame.delay >= 20)).toBe(true)
        expect(() => playgroundAnimationFrames({ duration: 5, fps: 30 }, 100, 100)).toThrow('at most 120 frames')
        expect(() => playgroundAnimationFrames({ duration: 1, fps: 10 }, 2000, 2000)).toThrow('2 million pixels per frame')
        expect(() => playgroundAnimationFrames({ duration: 10, fps: 10 }, 1000, 1000)).toThrow('60 million pixels in total')
    })

    it('encodes moving GIF frames with opaque matte and correct delays', () => {
        const pixels = new Uint8Array([255, 0, 0, 0, 0, 0, 255, 128])
        expect(Array.from(mattePlaygroundPixels(pixels, '#ffffff'))).toEqual([255, 255, 255, 255, 127, 127, 255, 255])
        expect(pixels[3]).toBe(0)
        const gif = createPlaygroundGif(2, 1, '#ffffff')
        gif.writeFrame(pixels, 100)
        gif.writeFrame(new Uint8Array([0, 255, 0, 255, 255, 0, 0, 255]), 200)
        const buffer = gif.finish()
        expect(new TextDecoder().decode(buffer.slice(0, 6))).toBe('GIF89a')
        const dimensions = new DataView(buffer)
        expect(dimensions.getUint16(6, true)).toBe(2)
        expect(dimensions.getUint16(8, true)).toBe(1)
        expect(gifFrames(buffer)).toEqual([{ delay: 100, transparent: false }, { delay: 200, transparent: false }])
        expect(() => createPlaygroundGif(2, 1, '#ffffff').writeFrame(new Uint8Array(4), 100)).toThrow('do not match')
    })
})
