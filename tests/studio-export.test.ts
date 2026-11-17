import { afterEach, describe, expect, it, vi } from 'vitest'
import { compileFilm, film, Suspend } from '../src/stage/stage'
import { exportFilm, FramePainter } from '../src/studio/export'

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

function canvasEnvironment() {
    const fills: string[] = []
    vi.stubGlobal('document', {
        createElement: () => {
            const ctx = {
                fillStyle: '',
                save() {}, restore() {}, setTransform() {}, clearRect() {},
                fillRect() { fills.push(ctx.fillStyle) },
            }
            return { width: 64, height: 64, getBoundingClientRect: () => ({ width: 0 }), getContext: () => ctx }
        },
    })
    return fills
}

async function blankFilm() {
    return compileFilm(film({ width: 64, height: 64, bloom: 0 }, s => { s.wait(4) }))
}

describe('FramePainter evaluation', () => {
    it('evaluates each exported frame once, plus the player initial paint', async () => {
        const fills = canvasEnvironment()
        const compiled = await blankFilm()
        const evaluate = vi.spyOn(compiled, 'frame')
        const painter = new FramePainter(compiled, 64, 64, 1)
        try {
            for (let index = 0; index < 120; index++) await painter.paint(index / 30, 30)
            expect(evaluate.mock.calls.map(([time]) => time)).toEqual([0, ...Array.from({ length: 120 }, (_, i) => i / 30)])
            expect(fills).toHaveLength(121)
        } finally {
            painter.destroy()
        }
    })

    it('waits for successive suspended assets and paints the resulting frame once', async () => {
        const fills = canvasEnvironment()
        const compiled = await blankFilm()
        const prepared = { ...compiled.frame(1), background: '#123456' }
        const painter = new FramePainter(compiled, 64, 64, 1)
        let ready!: () => void
        const asset = new Promise<void>(resolve => { ready = resolve })
        const evaluate = vi.spyOn(compiled, 'frame')
            .mockImplementationOnce(() => { throw new Suspend(asset) })
            .mockImplementationOnce(() => { throw new Suspend(Promise.resolve()) })
            .mockReturnValue(prepared)
        try {
            fills.length = 0
            const painting = painter.paint(1, 30)
            expect(fills).toEqual([])
            ready()
            await painting
            expect(evaluate).toHaveBeenCalledTimes(3)
            expect(fills).toEqual(['#123456'])
        } finally {
            painter.destroy()
        }
    })

    it.each(['evaluation', 'asset'])('propagates an %s failure without painting a stale frame', async source => {
        const fills = canvasEnvironment()
        const compiled = await blankFilm()
        const painter = new FramePainter(compiled, 64, 64, 1)
        const error = new Error('Asset could not be decoded')
        vi.spyOn(compiled, 'frame').mockImplementation(() => {
            if (source === 'asset') throw new Suspend(Promise.reject(error))
            throw error
        })
        try {
            fills.length = 0
            await expect(painter.paint(1, 30)).rejects.toBe(error)
            expect(fills).toEqual([])
        } finally {
            painter.destroy()
        }
    })
})

const AVCC = Uint8Array.of(1, 0x42, 0, 0x1e, 0xff, 0xe1, 0, 0, 1, 0, 0)

function mockEncoder(codec: 'avc1' | 'vp09', colorSpace?: VideoColorSpaceInit) {
    vi.stubGlobal('MessageChannel', class {
        port1 = { onmessage: () => {} }
        port2 = { postMessage: () => queueMicrotask(() => this.port1.onmessage()) }
    })
    vi.stubGlobal('VideoFrame', class {
        timestamp: number
        constructor(_source: unknown, init: VideoFrameInit) { this.timestamp = init.timestamp! }
        close() {}
    })
    vi.stubGlobal('VideoEncoder', class {
        static async isConfigSupported(config: VideoEncoderConfig) { return { supported: config.codec.startsWith(codec) } }
        state = 'configured'
        encodeQueueSize = 0
        constructor(private readonly init: VideoEncoderInit) {}
        configure() {}
        encode(frame: VideoFrame) {
            this.init.output({
                byteLength: 1, timestamp: frame.timestamp, type: 'key',
                copyTo: (data: Uint8Array) => { data[0] = 42 },
            } as unknown as EncodedVideoChunk, frame.timestamp === 0 ? {
                decoderConfig: { codec, description: AVCC, colorSpace },
            } : {})
        }
        async flush() {}
        close() { this.state = 'closed' }
    })
}

function childBox(bytes: Uint8Array, type: string, start = 0): { body: number; end: number } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let at = start; at + 8 <= bytes.length;) {
        const size = view.getUint32(at)
        if (size < 8) break
        if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === type) return { body: at + 8, end: at + size }
        at += size
    }
    throw new Error(`Missing ${type} box`)
}

describe.each(['avc1', 'vp09'] as const)('Studio %s MP4 color signaling', codec => {
    it.each([
        ['SMPTE170M', { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m', fullRange: false }, [6, 6, 6, 0]],
        ['BT709', { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true }, [1, 1, 1, 128]],
        ['PAL', { primaries: 'bt470bg', transfer: 'bt709', matrix: 'bt470bg' }, [5, 1, 5, 0]],
        ['sRGB', { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true }, [1, 13, 0, 128]],
        ['PQ', { primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl' }, [9, 16, 9, 0]],
        ['HLG', { primaries: 'smpte432', transfer: 'hlg', matrix: 'bt2020-ncl' }, [12, 18, 9, 0]],
        ['linear', { primaries: 'bt709', transfer: 'linear', matrix: 'rgb' }, [1, 8, 0, 0]],
        ['absent', undefined, [2, 2, 2, 0]],
        ['null', { primaries: null, transfer: null, matrix: null, fullRange: null }, [2, 2, 2, 0]],
        ['partial', { matrix: 'smpte170m', fullRange: true }, [2, 2, 6, 128]],
        ['unsupported', { primaries: 'unknown', transfer: 'unknown', matrix: 'unknown' }, [2, 2, 2, 0]],
    ] as const)('writes %s decoder metadata into the container without altering samples', async (_name, metadata, expected) => {
        canvasEnvironment()
        mockEncoder(codec, metadata as VideoColorSpaceInit | undefined)
        const result = await exportFilm(await blankFilm(), {
            format: 'mp4', width: 64, fps: 30, quality: 'standard', motionBlur: 1, from: 0, to: 2 / 30, time: 0,
        })
        const bytes = result.bytes
        let body = 0
        for (const type of ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd']) body = childBox(bytes, type, body).body
        const entry = childBox(bytes, codec, body + 8)
        const colr = childBox(bytes, 'colr', entry.body + 78)
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        expect(String.fromCharCode(...bytes.subarray(colr.body, colr.body + 4))).toBe('nclx')
        expect([view.getUint16(colr.body + 4), view.getUint16(colr.body + 6), view.getUint16(colr.body + 8), view.getUint8(colr.body + 10)]).toEqual(expected)
        if (codec === 'vp09') {
            const config = childBox(bytes, 'vpcC', entry.body + 78).body + 4
            expect([...bytes.subarray(config + 3, config + 6), (bytes[config + 2]! & 1) * 128]).toEqual(expected)
        } else {
            const config = childBox(bytes, 'avcC', entry.body + 78)
            expect(bytes.subarray(config.body, config.end)).toEqual(AVCC)
        }
        const media = childBox(bytes, 'mdat')
        expect([...bytes.subarray(media.body, media.end)]).toEqual([42, 42])
    })
})
