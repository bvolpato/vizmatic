import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { muxMp4, muxWebm, vp9Config, type Mp4Sample } from '../src/studio/mp4'

interface Box {
    type: string
    start: number
    size: number
    body: number
}

function readBoxes(data: Uint8Array, start = 0, end = data.length): Box[] {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const boxes: Box[] = []
    for (let at = start; at < end;) {
        const size = view.getUint32(at)
        const type = String.fromCharCode(data[at + 4]!, data[at + 5]!, data[at + 6]!, data[at + 7]!)
        boxes.push({ type, start: at, size, body: at + 8 })
        expect(size).toBeGreaterThanOrEqual(8)
        at += size
    }
    return boxes
}

function find(data: Uint8Array, path: readonly string[]): Box {
    let boxes = readBoxes(data)
    let found: Box | undefined
    path.forEach((type, index) => {
        found = boxes.find((box) => box.type === type)
        if (!found) throw new Error(`Missing ${type} in ${boxes.map((box) => box.type).join(',')}`)
        // Only containers hold boxes. The last entry can be a full box with a binary body.
        if (index < path.length - 1) boxes = readBoxes(data, found.body, found.start + found.size)
    })
    return found!
}

function samples(count = 4): Mp4Sample[] {
    return Array.from({ length: count }, (_, i) => ({
        data: Uint8Array.from({ length: 10 + i }, (_, k) => (i * 16 + k) & 255),
        timestamp: Math.round(i * 1e6 / 30),
        keyframe: i === 0,
    }))
}

const AVCC = Uint8Array.of(1, 0x42, 0, 0x1e, 0xff, 0xe1, 0, 0, 1, 0, 0)

describe('muxMp4', () => {
    it('places the index before the media and points at the first sample', () => {
        const list = samples()
        const file = muxMp4({ codec: 'avc1', width: 640, height: 360, fps: 30, description: AVCC, samples: list })
        const top = readBoxes(file)
        expect(top.map((box) => box.type)).toEqual(['ftyp', 'moov', 'mdat'])
        const stco = find(file, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stco'])
        const view = new DataView(file.buffer)
        const offset = view.getUint32(stco.body + 8)
        expect(offset).toBe(top[2]!.body)
        expect([...file.subarray(offset, offset + 10)]).toEqual([...list[0]!.data])
    })

    it('records sizes, sync samples, and duration', () => {
        const list = samples(5)
        const file = muxMp4({ codec: 'avc1', width: 640, height: 360, fps: 30, description: AVCC, samples: list })
        const view = new DataView(file.buffer)
        const stsz = find(file, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsz'])
        expect(view.getUint32(stsz.body + 8)).toBe(5)
        expect(view.getUint32(stsz.body + 12)).toBe(10)
        expect(view.getUint32(stsz.body + 28)).toBe(14)
        const stss = find(file, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stss'])
        expect(view.getUint32(stss.body + 4)).toBe(1)
        expect(view.getUint32(stss.body + 8)).toBe(1)
        const mdhd = find(file, ['moov', 'trak', 'mdia', 'mdhd'])
        const timescale = view.getUint32(mdhd.body + 12)
        const duration = view.getUint32(mdhd.body + 16)
        expect(duration / timescale).toBeCloseTo(5 / 30, 6)
    })

    it('writes composition offsets when the encoder reorders frames', () => {
        const list: Mp4Sample[] = [0, 2, 1, 3].map((frame, i) => ({ data: Uint8Array.of(i), timestamp: Math.round(frame * 1e6 / 30), keyframe: i === 0 }))
        const file = muxMp4({ codec: 'avc1', width: 64, height: 64, fps: 30, description: AVCC, samples: list })
        expect(() => find(file, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'ctts'])).not.toThrow()
        expect(() => find(file, ['moov', 'trak', 'edts', 'elst'])).not.toThrow()
    })

    it('refuses an empty video', () => {
        expect(() => muxMp4({ codec: 'avc1', width: 64, height: 64, fps: 30, description: AVCC, samples: [] })).toThrow(/at least one/)
    })

    it('writes a vpcC configuration from a codec string', () => {
        const config = vp9Config('vp09.00.40.08', { primaries: 1, transfer: 1, matrix: 1, fullRange: false })
        expect([...config]).toEqual([0, 40, (8 << 4) | (1 << 1), 1, 1, 1, 0, 0])
    })
})

describe('muxWebm', () => {
    it('writes an EBML header and a segment', () => {
        const file = muxWebm({ codecId: 'V_VP9', width: 64, height: 64, fps: 30, samples: samples() })
        expect([...file.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
        expect(Buffer.from(file).includes(Buffer.from('webm'))).toBe(true)
        expect(Buffer.from(file).includes(Buffer.from('V_VP9'))).toBe(true)
    })

    it('splits long runs into clusters at keyframes', () => {
        const list: Mp4Sample[] = Array.from({ length: 300 }, (_, i) => ({ data: Uint8Array.of(i & 255), timestamp: Math.round(i * 1e6 / 30), keyframe: i % 90 === 0 }))
        const file = muxWebm({ codecId: 'V_VP9', width: 64, height: 64, fps: 30, samples: list })
        let clusters = 0
        for (let at = 0; at + 4 < file.length; at++) {
            if (file[at] === 0x1f && file[at + 1] === 0x43 && file[at + 2] === 0xb6 && file[at + 3] === 0x75) clusters++
        }
        expect(clusters).toBeGreaterThanOrEqual(3)
    })
})

// A real decoder is the honest check for container output.
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0

describe.runIf(hasFfmpeg)('files that real tools can read', () => {
    function encodeRaw(codec: string, args: string[], extension: string): Buffer {
        const directory = mkdtempSync(join(tmpdir(), 'viz-studio-mp4-'))
        try {
            const output = join(directory, `clip.${extension}`)
            const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=30:d=0.4', '-c:v', codec, ...args, output])
            if (run.status !== 0) throw new Error(run.stderr.toString())
            return spawnSync('cat', [output], { maxBuffer: 1 << 26 }).stdout
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    }

    it('ffprobe accepts a muxed H.264 track', () => {
        const raw = encodeRaw('libx264', ['-bf', '0', '-g', '6', '-pix_fmt', 'yuv420p', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264'], 'h264')
        const units = splitAnnexB(raw)
        const sps = units.find((unit) => (unit[0]! & 31) === 7)!
        const pps = units.find((unit) => (unit[0]! & 31) === 8)!
        const avcc = Buffer.concat([Buffer.from([1, sps[1]!, sps[2]!, sps[3]!, 0xff, 0xe1, sps.length >> 8, sps.length & 255]), sps, Buffer.from([1, pps.length >> 8, pps.length & 255]), pps])
        const frames = groupFrames(units)
        const list: Mp4Sample[] = frames.map((frame, i) => ({
            data: frame.data, timestamp: Math.round(i * 1e6 / 30), keyframe: frame.key,
        }))
        const file = muxMp4({ codec: 'avc1', width: 64, height: 64, fps: 30, description: avcc, samples: list })
        const directory = mkdtempSync(join(tmpdir(), 'viz-studio-mp4-'))
        try {
            const path = join(directory, 'out.mp4')
            writeFileSync(path, file)
            const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames,r_frame_rate', '-of', 'json', path])
            expect(probe.stderr.toString()).toBe('')
            const stream = JSON.parse(probe.stdout.toString()).streams[0]
            expect(stream.codec_name).toBe('h264')
            expect(stream.width).toBe(64)
            expect(Number(stream.nb_read_frames)).toBe(list.length)
            expect(stream.r_frame_rate).toBe('30/1')
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
})

function splitAnnexB(data: Buffer): Buffer[] {
    const units: Buffer[] = []
    let start = -1
    for (let i = 0; i + 3 <= data.length; i++) {
        if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
            if (start >= 0) units.push(trim(data.subarray(start, i)))
            start = i + 3
            i += 2
        }
    }
    if (start >= 0) units.push(data.subarray(start))
    return units
}

function trim(unit: Buffer): Buffer {
    let end = unit.length
    while (end > 0 && unit[end - 1] === 0) end--
    return unit.subarray(0, end)
}

function groupFrames(units: Buffer[]): { data: Uint8Array; key: boolean }[] {
    const frames: { data: Uint8Array; key: boolean }[] = []
    for (const unit of units) {
        const type = unit[0]! & 31
        if (type !== 1 && type !== 5) continue
        const head = Buffer.alloc(4)
        head.writeUInt32BE(unit.length)
        frames.push({ data: Buffer.concat([head, unit]), key: type === 5 })
    }
    return frames
}
