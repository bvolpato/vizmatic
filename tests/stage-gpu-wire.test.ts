import { describe, expect, it } from 'vitest'
import { decodeGpuJob, encodeGpuJob, type GpuFrameJob } from '../src/stage/gpu-wire'
import { matchingBloom, matchingGpuPixels, matchingHalfFloats } from '../src/stage/gpu-selection'
import { Node } from '../src/stage/node'
import type { Frame, ImageOp, PathOp } from '../src/stage/display'

const align = (size: number) => Math.ceil(size / 8) * 8

function fixture(): GpuFrameJob {
    const coordinates = new Float64Array([999, -0, 0.25, 1 / 3, -2.5, Math.PI, 4.25, 8.5, 9.75, 999]).subarray(1, 9)
    const clip = [{ p: new Float64Array([0, 0, 0, 0, 16, 0, 16, 12]), closed: true, straight: true }]
    const path = [{ p: coordinates, closed: false }]
    const pixels = new Uint8ClampedArray([99, 255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 99]).subarray(1, 13)
    const node = new Node(path)
    new Node().add(node) // A real parent/child cycle must never enter the packet.
    const mark: PathOp = {
        kind: 'path', path, strokePath: path, clips: [clip], node,
        fill: { type: 'linear', from: [0, 0], to: [12, 8], stops: [[0, [10, 20, 30, 1]], [1, [40, 50, 60, 0.5]]] },
        fillAlpha: 0.6, stroke: [255, 128, 0, 1], strokeAlpha: 0.8, strokeWidth: 1.25,
        cap: 'round', join: 'bevel', dash: [1, 2], dashOffset: 0.5, glow: 2, glowColor: [10, 30, 50, 1], blend: 'screen',
    }
    const picture: ImageOp = {
        kind: 'image', clips: [clip], node, matrix: [1, 0.25, -0.5, 1, 4, 6], alpha: 0.5,
        blend: 'multiply', dim: 0.75, backdrop: [10, 20, 30, 1],
        image: { src: '', width: 6, height: 2, crop: { x: 1, y: 0, width: 2, height: 1 }, pixels: { width: 3, height: 1, data: pixels } },
    }
    const frame: Frame = { width: 16, height: 12, background: '#0b0c10', bloom: 0.6, dark: true, ops: [mark, picture] }
    return { frames: [frame, { ...frame, ops: [picture, mark] }], width: 32, height: 24, dither: true }
}

/** Construct corrupt envelopes independently of the encoder. */
function packet(metadata: unknown, count = 0, payloadBytes = 0): ArrayBuffer {
    const json = new TextEncoder().encode(JSON.stringify(metadata))
    const buffer = new ArrayBuffer(align(8 + json.length) + payloadBytes)
    const view = new DataView(buffer)
    view.setUint32(0, json.length, true)
    view.setUint32(4, count, true)
    new Uint8Array(buffer).set(json, 8)
    return buffer
}

describe('GPU binary frame transport', () => {
    it('round-trips clipped paths and pixel subarrays without serializing scene nodes', () => {
        const job = fixture()
        const encoded = encodeGpuJob(job)
        const decoded = decodeGpuJob(encoded.buffer as ArrayBuffer)
        if (!('frames' in decoded)) throw new Error('Expected a frame job')
        const expected = { ...job, frames: job.frames.map(frame => ({ ...frame, ops: frame.ops.map(({ node: _node, ...op }) => op) })) }
        expect(decoded).toEqual(expected)
        const mark = decoded.frames[0].ops[0] as PathOp
        const picture = decoded.frames[0].ops[1] as ImageOp
        expect(mark.path[0].p).toBeInstanceOf(Float64Array)
        expect(Object.is(mark.path[0].p[0], -0)).toBe(true)
        expect(picture.image.pixels!.data).toBeInstanceOf(Uint8ClampedArray)
        expect([...picture.image.pixels!.data]).toEqual([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0])
        // Encoding snapshots only the view, including views with a nonzero byte offset.
        const originalMark = job.frames[0].ops[0] as PathOp, originalPicture = job.frames[0].ops[1] as ImageOp
        originalMark.path[0].p.fill(99)
        originalPicture.image.pixels!.data.fill(99)
        expect(mark.path[0].p[2]).toBe(1 / 3)
        expect(picture.image.pixels!.data[0]).toBe(255)
    })

    it('stores shared arrays once and restores their identity across paths, clips and frames', () => {
        const encoded = encodeGpuJob(fixture())
        const view = new DataView(encoded.buffer)
        expect(view.getUint32(4, true)).toBe(3)
        expect(encoded.byteLength).toBe(align(8 + view.getUint32(0, true)) + 64 + 64 + 16)
        const decoded = decodeGpuJob(encoded.buffer as ArrayBuffer) as GpuFrameJob
        const mark = decoded.frames[0].ops[0] as PathOp
        const picture = decoded.frames[0].ops[1] as ImageOp
        expect(mark.path[0].p).toBe(mark.strokePath[0].p)
        expect(mark.clips![0][0].p).toBe(picture.clips![0][0].p)
        expect((decoded.frames[1].ops[1] as PathOp).path[0].p).toBe(mark.path[0].p)
        expect((decoded.frames[1].ops[0] as ImageOp).image.pixels!.data).toBe(picture.image.pixels!.data)
    })

    it('does not alias distinct arrays merely because their contents match', () => {
        const job = fixture(), mark = job.frames[0].ops[0] as PathOp
        const independent: PathOp = { ...mark, strokePath: [{ ...mark.path[0], p: mark.path[0].p.slice() }] }
        const encoded = encodeGpuJob({ ...job, frames: [{ ...job.frames[0], ops: [independent] }] })
        const decoded = decodeGpuJob(encoded.buffer as ArrayBuffer) as GpuFrameJob
        const result = decoded.frames[0].ops[0] as PathOp
        expect(result.path[0].p).toEqual(result.strokePath[0].p)
        expect(result.path[0].p).not.toBe(result.strokePath[0].p)
        result.path[0].p[2] = 42
        expect(result.strokePath[0].p[2]).toBe(1 / 3)
    })

    it('round-trips source-film sample times with no binary arrays', () => {
        const job = { times: [0, 1 / 60, Math.PI], width: 1920, height: 1080, dither: false }
        const encoded = encodeGpuJob(job)
        expect(decodeGpuJob(encoded.buffer as ArrayBuffer)).toEqual(job)
        expect(new DataView(encoded.buffer).getUint32(4, true)).toBe(0)
    })

    it.each([0, 1, 7])('rejects a truncated %i-byte header', length => {
        expect(() => decodeGpuJob(new ArrayBuffer(length))).toThrow('Truncated GPU frame packet')
    })

    it('rejects truncated metadata and invalid JSON', () => {
        const truncated = new ArrayBuffer(8)
        new DataView(truncated).setUint32(0, 8, true)
        expect(() => decodeGpuJob(truncated)).toThrow('Truncated GPU frame metadata')
        const invalidJson = packet({})
        new Uint8Array(invalidJson)[8] = '!'.charCodeAt(0)
        expect(() => decodeGpuJob(invalidJson)).toThrow(SyntaxError)
    })

    it.each([
        { $array: -1, type: 'f64', length: 1 },
        { $array: 1, type: 'f64', length: 1 },
        { $array: 0.5, type: 'f64', length: 1 },
        { $array: '0', type: 'f64', length: 1 },
        { $array: 0, type: 'f32', length: 1 },
        { $array: 0, type: 'u8', length: -1 },
        { $array: 0, type: 'u8', length: 0.5 },
        { $array: 0, type: 'u8', length: '1' },
        { $array: 0, type: 'f64', length: Number.MAX_SAFE_INTEGER + 1 },
    ])('rejects an invalid binary array descriptor: %j', descriptor => {
        expect(() => decodeGpuJob(packet({ data: descriptor }, 1, 8))).toThrow('Invalid GPU frame array')
    })

    it('rejects out-of-order arrays, truncated payloads and missing alignment padding', () => {
        expect(() => decodeGpuJob(packet({ data: { $array: 1, type: 'f64', length: 1 } }, 2, 16))).toThrow('Truncated GPU frame array')
        const encoded = encodeGpuJob(fixture()).buffer as ArrayBuffer
        expect(() => decodeGpuJob(encoded.slice(0, -8))).toThrow('Truncated GPU frame array')
        expect(() => decodeGpuJob(encoded.slice(0, -1))).toThrow('Invalid GPU frame packet length')
    })

    it('rejects undeclared arrays and trailing payload bytes', () => {
        expect(() => decodeGpuJob(packet({ times: [0] }, 1))).toThrow('Invalid GPU frame packet length')
        expect(() => decodeGpuJob(packet({ times: [0] }, 0, 8))).toThrow('Invalid GPU frame packet length')
    })

    it.each([{ type: 'u8', length: 8 }, { type: 'f64', length: 2 }])
        ('rejects a repeated array ID whose descriptor disagrees: %j', other => {
            const bytes = packet({ first: { $array: 0, type: 'f64', length: 1 }, second: { $array: 0, ...other } }, 1, 8)
            expect(() => decodeGpuJob(bytes)).toThrow('Invalid GPU frame array')
        })
})

function rgba(width: number, height: number, color: readonly number[] = [0, 0, 0, 255]): Uint8Array {
    const pixels = new Uint8Array(width * height * 4)
    for (let i = 0; i < pixels.length; i += 4) pixels.set(color, i)
    return pixels
}

function line(pixels: Uint8Array, width: number, x: number, from: number, to: number): void {
    for (let y = from; y < to; y++) pixels.set([255, 255, 255, 255], (y * width + x) * 4)
}

describe('GPU pixel parity safeguard', () => {
    it('accepts identical pixels and small unbiased antialiasing differences', () => {
        const cpu = rgba(100, 80, [100, 120, 140, 255]), gpu = cpu.slice()
        expect(matchingGpuPixels(cpu, gpu, 100)).toBe(true)
        for (let i = 0; i < gpu.length; i += 4) {
            const delta = (i / 4) % 2 ? 2 : -2
            for (let channel = 0; channel < 3; channel++) gpu[i + channel] += delta
        }
        expect(matchingGpuPixels(cpu, gpu, 100)).toBe(true)
        expect(matchingGpuPixels(cpu, cpu)).toBe(true)
    })

    it('lets a picture in half floats have a smooth offset, and no other picture', () => {
        const size = 128, cpu = new Uint8Array(size * size * 4)
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const i = (y * size + x) * 4, on = x > 30 && x < 90 && y > 20 && y < 100; cpu.set(on ? [180, 150, 90, 255] : [40, 44, 60, 255], i) }
        const shifted = (by: (x: number, y: number) => number) => { const out = Uint8Array.from(cpu); for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let k = 0; k < 3; k++) out[(y * size + x) * 4 + k] = cpu[(y * size + x) * 4 + k]! + by(x, y); return out }
        expect(matchingHalfFloats(cpu, cpu, size)).toBe(true)
        expect(matchingHalfFloats(cpu, shifted(() => 9), size)).toBe(true)
        expect(matchingGpuPixels(cpu, shifted(() => 9), size)).toBe(false)
        expect(matchingHalfFloats(cpu, shifted(() => 20), size)).toBe(false)
        // A shape that is not there, or a part of the picture that is noise, is another picture.
        const lost = Uint8Array.from(cpu)
        for (let y = 40; y < 70; y++) for (let x = 40; x < 70; x++) lost.set([40, 44, 60, 255], (y * size + x) * 4)
        expect(matchingHalfFloats(cpu, lost, size)).toBe(false)
        expect(matchingHalfFloats(cpu, shifted((x, y) => ((x + y) % 2 ? 6 : -6)), size)).toBe(false)
        expect(matchingHalfFloats(new Uint8Array(), new Uint8Array(), 1)).toBe(false)
        // The bloom is the difference of two frames, so an offset of the picture is not in it.
        const glow = (x: number, y: number) => Math.round(14 * Math.exp(-((x - 64) ** 2 + (y - 64) ** 2) / 1800))
        const lit = shifted(glow), offset = shifted(() => 5), offsetLit = shifted((x, y) => 5 + glow(x, y))
        expect(matchingBloom(lit, cpu, offsetLit, offset, size)).toBe(true)
        expect(matchingBloom(lit, cpu, offset, offset, size)).toBe(false)
        expect(matchingBloom(lit, cpu, shifted((x, y) => 5 + 2 * glow(x, y)), offset, size)).toBe(false)
    })

    it('rejects empty, truncated and mismatched RGBA buffers or invalid row widths', () => {
        expect(matchingGpuPixels(new Uint8Array(), new Uint8Array())).toBe(false)
        expect(matchingGpuPixels(new Uint8Array(3), new Uint8Array(3))).toBe(false)
        expect(matchingGpuPixels(new Uint8Array(4), new Uint8Array(8))).toBe(false)
        const pixels = rgba(8, 8)
        for (const width of [0, -1, 1.5, 7, Infinity, NaN]) expect(matchingGpuPixels(pixels, pixels, width)).toBe(false)
    })

    it('rejects widespread color shifts, missing regions and opaque transparent pixels', () => {
        const cpu = rgba(128, 128, [100, 120, 140, 255])
        expect(matchingGpuPixels(cpu, rgba(128, 128, [103, 123, 143, 255]), 128)).toBe(false)
        const missing = cpu.slice()
        for (let y = 32; y < 64; y++) for (let x = 32; x < 64; x++) missing.set([0, 0, 0, 255], (y * 128 + x) * 4)
        expect(matchingGpuPixels(cpu, missing, 128)).toBe(false)
        expect(matchingGpuPixels(rgba(128, 128, [0, 0, 0, 0]), rgba(128, 128), 128)).toBe(false)
    })

    it('rejects a missing one-pixel line that passes the frame-wide error limits', () => {
        const cpu = rgba(256, 256), gpu = cpu.slice()
        line(cpu, 256, 96, 0, 256)
        expect(matchingGpuPixels(cpu, gpu, 256)).toBe(false)
        expect(matchingGpuPixels(gpu, cpu, 256)).toBe(false)
    })

    it('accepts a sparse one-pixel line translation when signed tile errors cancel', () => {
        const cpu = rgba(256, 256), gpu = cpu.slice()
        line(cpu, 256, 96, 64, 192)
        line(gpu, 256, 97, 64, 192)
        expect(matchingGpuPixels(cpu, gpu, 256)).toBe(true)
        expect(matchingGpuPixels(gpu, cpu, 256)).toBe(true)
    })

    it('checks each tile and color channel independently, including partial edge tiles', () => {
        const cpu = rgba(128, 64, [100, 100, 100, 255]), gpu = cpu.slice()
        for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) gpu[(y * 128 + x) * 4] += x < 64 ? 3 : -3
        // Global signed error is zero and global mean absolute RGB error is only one.
        expect(matchingGpuPixels(cpu, gpu, 128)).toBe(false)
        const edge = rgba(100, 100), missing = edge.slice()
        line(edge, 100, 96, 68, 100)
        expect(matchingGpuPixels(edge, missing, 100)).toBe(false)
    })

    it('retains the global absolute-error check when local signed errors cancel', () => {
        const cpu = rgba(64, 64, [100, 100, 100, 255]), gpu = cpu.slice()
        for (let i = 0; i < gpu.length; i += 4) for (let channel = 0; channel < 3; channel++) gpu[i + channel] += (i / 4) % 2 ? 3 : -3
        expect(matchingGpuPixels(cpu, gpu, 64)).toBe(false)
    })

    it('accepts a tile mean of exactly 2.5 but rejects a larger bias', () => {
        const cpu = rgba(64, 64, [100, 100, 100, 255]), gpu = cpu.slice()
        for (let i = 0; i < gpu.length; i += 4) gpu[i] += (i / 4) % 2 ? 2 : 3
        expect(matchingGpuPixels(cpu, gpu, 64)).toBe(true)
        gpu[0]++
        expect(matchingGpuPixels(cpu, gpu, 64)).toBe(false)
    })

    it('retains the high-error pixel limit even when signed color errors cancel', () => {
        const cpu = rgba(64, 64, [100, 100, 100, 255]), gpu = cpu.slice()
        for (let pixel = 0; pixel < 16; pixel++) gpu[pixel * 4] += pixel % 2 ? 60 : -60
        expect(matchingGpuPixels(cpu, gpu, 64)).toBe(true)
        gpu[16 * 4] += 60
        gpu[17 * 4] -= 60
        expect(matchingGpuPixels(cpu, gpu, 64)).toBe(false)
    })

    it('retains the alpha-error limit independently of RGB parity', () => {
        const cpu = rgba(100, 10, [100, 100, 100, 128]), gpu = cpu.slice()
        gpu[3] += 9
        expect(matchingGpuPixels(cpu, gpu, 100)).toBe(true)
        gpu[7] += 9
        expect(matchingGpuPixels(cpu, gpu, 100)).toBe(false)
    })
})
