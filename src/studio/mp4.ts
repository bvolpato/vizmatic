/**
 * A small MP4 writer for one video track. It takes encoded samples in decode
 * order and writes a progressive file with the index before the media data, so
 * the result plays while it downloads.
 */

export type VideoCodec = 'avc1' | 'vp09'

export interface Mp4Sample {
    data: Uint8Array
    /** Presentation time, in microseconds. */
    timestamp: number
    keyframe: boolean
}

export interface Mp4Options {
    codec: VideoCodec
    width: number
    height: number
    fps: number
    /** avcC or vpcC box contents. */
    description: Uint8Array
    samples: readonly Mp4Sample[]
    /** Color signaling for the bitstream. Defaults to BT.709. */
    color?: { primaries: number; transfer: number; matrix: number; fullRange: boolean }
}

class ByteWriter {
    private chunks: Uint8Array[] = []
    length = 0

    bytes(data: Uint8Array): this {
        this.chunks.push(data)
        this.length += data.length
        return this
    }

    u8(value: number): this {
        return this.bytes(Uint8Array.of(value & 255))
    }

    u16(value: number): this {
        return this.bytes(Uint8Array.of((value >>> 8) & 255, value & 255))
    }

    u24(value: number): this {
        return this.bytes(Uint8Array.of((value >>> 16) & 255, (value >>> 8) & 255, value & 255))
    }

    u32(value: number): this {
        return this.bytes(Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255))
    }

    zero(count: number): this {
        return this.bytes(new Uint8Array(count))
    }

    ascii(text: string): this {
        const out = new Uint8Array(text.length)
        for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255
        return this.bytes(out)
    }

    finish(): Uint8Array {
        const out = new Uint8Array(this.length)
        let offset = 0
        for (const chunk of this.chunks) {
            out.set(chunk, offset)
            offset += chunk.length
        }
        return out
    }
}

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
    const size = 8 + parts.reduce((sum, part) => sum + part.length, 0)
    const out = new ByteWriter().u32(size).ascii(type)
    for (const part of parts) out.bytes(part)
    return out.finish()
}

function fullBox(type: string, version: number, flags: number, ...parts: Uint8Array[]): Uint8Array {
    return box(type, new ByteWriter().u8(version).u24(flags).finish(), ...parts)
}

const write = (fn: (w: ByteWriter) => unknown): Uint8Array => {
    const w = new ByteWriter()
    fn(w)
    return w.finish()
}

const IDENTITY_MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]

/** Run-length table: [count, value] pairs. */
function runs(values: readonly number[]): [number, number][] {
    const out: [number, number][] = []
    for (const value of values) {
        const last = out[out.length - 1]
        if (last && last[1] === value) last[0]++
        else out.push([1, value])
    }
    return out
}

function sampleEntry(options: Mp4Options): Uint8Array {
    const color = options.color ?? { primaries: 1, transfer: 1, matrix: 1, fullRange: false }
    const fields = write((w) => {
        w.zero(6).u16(1) // reserved, data reference index
        w.u16(0).u16(0).zero(12) // version, revision, predefined
        w.u16(options.width).u16(options.height)
        w.u32(0x00480000).u32(0x00480000) // 72 dpi
        w.u32(0).u16(1) // reserved, frame count
        w.zero(32) // compressor name
        w.u16(0x0018).u16(0xffff) // depth, predefined
    })
    const colr = box('colr', write((w) => {
        w.ascii('nclx').u16(color.primaries).u16(color.transfer).u16(color.matrix).u8(color.fullRange ? 0x80 : 0)
    }))
    if (options.codec === 'avc1') return box('avc1', fields, box('avcC', options.description), colr)
    return box('vp09', fields, fullBox('vpcC', 1, 0, options.description), colr)
}

function planMoov(options: Mp4Options, chunkOffset: number): Uint8Array {
    const { samples, width, height, fps } = options
    const timescale = fps * 1000
    const tick = 1000 // One frame, in track units.
    const count = samples.length
    const microsToTicks = timescale / 1_000_000
    // Decode times step evenly. Presentation times can differ when the encoder reorders.
    const sortedPts = samples.map((sample) => Math.round(sample.timestamp * microsToTicks)).sort((a, b) => a - b)
    const firstPts = sortedPts[0] ?? 0
    const offsets = samples.map((sample, index) => Math.round(sample.timestamp * microsToTicks) - firstPts - index * tick)
    const reorders = offsets.some((offset) => offset !== 0)
    // With reordering, shift so that all offsets are non-negative.
    const minOffset = reorders ? Math.min(...offsets) : 0
    const duration = count * tick

    const mvhd = fullBox('mvhd', 0, 0, write((w) => {
        w.u32(0).u32(0).u32(timescale).u32(duration)
        w.u32(0x00010000).u16(0x0100).zero(10)
        for (const value of IDENTITY_MATRIX) w.u32(value)
        w.zero(24).u32(2)
    }))
    const tkhd = fullBox('tkhd', 0, 3, write((w) => {
        w.u32(0).u32(0).u32(1).u32(0).u32(duration)
        w.zero(8).u16(0).u16(0).u16(0).u16(0)
        for (const value of IDENTITY_MATRIX) w.u32(value)
        w.u32(width * 65536).u32(height * 65536)
    }))
    const mdhd = fullBox('mdhd', 0, 0, write((w) => {
        // Language code "und".
        w.u32(0).u32(0).u32(timescale).u32(duration).u16(0x55c4).u16(0)
    }))
    const hdlr = fullBox('hdlr', 0, 0, write((w) => {
        w.u32(0).ascii('vide').zero(12).ascii('Vizmatic video').u8(0)
    }))
    const vmhd = fullBox('vmhd', 0, 1, new Uint8Array(8))
    const dinf = box('dinf', fullBox('dref', 0, 0, write((w) => w.u32(1)), fullBox('url ', 0, 1)))
    const stsd = fullBox('stsd', 0, 0, write((w) => w.u32(1)), sampleEntry(options))
    const stts = fullBox('stts', 0, 0, write((w) => {
        w.u32(1).u32(count).u32(tick)
    }))
    const ctts = reorders
        ? fullBox('ctts', 0, 0, write((w) => {
            const table = runs(offsets.map((offset) => offset - minOffset))
            w.u32(table.length)
            for (const [run, value] of table) w.u32(run).u32(value)
        }))
        : new Uint8Array(0)
    const keyframes = samples.flatMap((sample, index) => sample.keyframe ? [index + 1] : [])
    const stss = keyframes.length === count
        ? new Uint8Array(0)
        : fullBox('stss', 0, 0, write((w) => {
            w.u32(keyframes.length)
            for (const index of keyframes) w.u32(index)
        }))
    const stsc = fullBox('stsc', 0, 0, write((w) => {
        w.u32(1).u32(1).u32(count).u32(1)
    }))
    const stsz = fullBox('stsz', 0, 0, write((w) => {
        w.u32(0).u32(count)
        for (const sample of samples) w.u32(sample.data.length)
    }))
    const stco = fullBox('stco', 0, 0, write((w) => {
        w.u32(1).u32(chunkOffset)
    }))
    const stbl = box('stbl', stsd, stts, ...(reorders ? [ctts] : []), ...(stss.length ? [stss] : []), stsc, stsz, stco)
    const minf = box('minf', vmhd, dinf, stbl)
    const mdia = box('mdia', mdhd, hdlr, minf)
    const edts = reorders
        ? box('edts', fullBox('elst', 0, 0, write((w) => {
            w.u32(1).u32(duration).u32(-minOffset).u16(1).u16(0)
        })))
        : new Uint8Array(0)
    const trak = box('trak', tkhd, ...(edts.length ? [edts] : []), mdia)
    return box('moov', mvhd, trak)
}

/** Write a complete, faststart MP4 file. */
export function muxMp4(options: Mp4Options): Uint8Array {
    if (options.samples.length === 0) throw new Error('A video needs at least one frame.')
    if (options.description.length === 0) throw new Error('The encoder did not supply a decoder configuration.')
    const brands: Record<VideoCodec, string> = { avc1: 'avc1', vp09: 'vp09' }
    const ftyp = box('ftyp', write((w) => {
        w.ascii('isom').u32(0x200).ascii('isom').ascii('iso2').ascii(brands[options.codec]).ascii('mp41')
    }))
    const mediaBytes = options.samples.reduce((sum, sample) => sum + sample.data.length, 0)
    if (mediaBytes + 1_000_000 > 0xffffffff) throw new Error('This video is too large for a 32-bit MP4 file. Lower the quality or the resolution.')
    // The index size does not depend on the offset value, so plan once to measure and again to place.
    const measured = planMoov(options, 0).length
    const mdatStart = ftyp.length + measured + 8
    const moov = planMoov(options, mdatStart)
    const out = new Uint8Array(mdatStart + mediaBytes)
    let offset = 0
    out.set(ftyp, offset)
    offset += ftyp.length
    out.set(moov, offset)
    offset += moov.length
    const view = new DataView(out.buffer)
    view.setUint32(offset, 8 + mediaBytes)
    out.set([0x6d, 0x64, 0x61, 0x74], offset + 4)
    offset += 8
    for (const sample of options.samples) {
        out.set(sample.data, offset)
        offset += sample.data.length
    }
    return out
}

/** Contents of a vpcC box for 8-bit 4:2:0 VP9, from its codec string such as vp09.00.40.08. */
export function vp9Config(codec: string, color: { primaries: number; transfer: number; matrix: number; fullRange: boolean }): Uint8Array {
    const parts = codec.split('.')
    const profile = Number(parts[1] ?? 0)
    const level = Number(parts[2] ?? 40)
    const depth = Number(parts[3] ?? 8)
    const chroma = 1
    return write((w) => {
        w.u8(profile).u8(level).u8((depth << 4) | (chroma << 1) | (color.fullRange ? 1 : 0))
        w.u8(color.primaries).u8(color.transfer).u8(color.matrix).u16(0)
    })
}

// ── WebM ────────────────────────────────────────────────────────────────────

function vint(value: number): Uint8Array {
    for (let length = 1; length <= 8; length++) {
        if (value < 2 ** (7 * length) - 1) {
            const out = new Uint8Array(length)
            let rest = value
            for (let i = length - 1; i >= 0; i--) {
                out[i] = rest % 256
                rest = Math.floor(rest / 256)
            }
            out[0]! |= 1 << (8 - length)
            return out
        }
    }
    throw new Error('EBML size is too large.')
}

function idBytes(id: number): Uint8Array {
    const out: number[] = []
    for (let rest = id; rest > 0; rest = Math.floor(rest / 256)) out.unshift(rest % 256)
    return Uint8Array.from(out)
}

function ebml(id: number, ...parts: Uint8Array[]): Uint8Array {
    const size = parts.reduce((sum, part) => sum + part.length, 0)
    const w = new ByteWriter().bytes(idBytes(id)).bytes(vint(size))
    for (const part of parts) w.bytes(part)
    return w.finish()
}

function ebmlUint(id: number, value: number): Uint8Array {
    const out: number[] = []
    let rest = value
    do {
        out.unshift(rest % 256)
        rest = Math.floor(rest / 256)
    } while (rest > 0)
    return ebml(id, Uint8Array.from(out))
}

function ebmlString(id: number, value: string): Uint8Array {
    return ebml(id, write((w) => w.ascii(value)))
}

function ebmlFloat(id: number, value: number): Uint8Array {
    const data = new Uint8Array(8)
    new DataView(data.buffer).setFloat64(0, value)
    return ebml(id, data)
}

export interface WebmOptions {
    width: number
    height: number
    fps: number
    /** Codec id such as V_VP9. */
    codecId: string
    samples: readonly Mp4Sample[]
}

/** Write a simple WebM file with one video track and one cluster every few seconds. */
export function muxWebm(options: WebmOptions): Uint8Array {
    const { samples, width, height, fps } = options
    if (samples.length === 0) throw new Error('A video needs at least one frame.')
    const header = ebml(0x1a45dfa3,
        ebmlUint(0x4286, 1), ebmlUint(0x42f7, 1), ebmlUint(0x42f2, 4), ebmlUint(0x42f3, 8),
        ebmlString(0x4282, 'webm'), ebmlUint(0x4287, 4), ebmlUint(0x4285, 2))
    const durationMs = (samples[samples.length - 1]!.timestamp / 1000) + 1000 / fps
    const info = ebml(0x1549a966, ebmlUint(0x2ad7b1, 1_000_000), ebmlString(0x4d80, 'Vizmatic Studio'), ebmlString(0x5741, 'Vizmatic Studio'), ebmlFloat(0x4489, durationMs))
    const track = ebml(0x1654ae6b, ebml(0xae,
        ebmlUint(0xd7, 1), ebmlUint(0x73c5, 1), ebmlUint(0x83, 1), ebmlString(0x86, options.codecId),
        ebmlUint(0x23e383, Math.round(1e9 / fps)),
        ebml(0xe0, ebmlUint(0xb0, width), ebmlUint(0xba, height))))
    const clusters: Uint8Array[] = []
    let start = 0
    while (start < samples.length) {
        const clusterStart = samples[start]!.timestamp / 1000
        const blocks: Uint8Array[] = [ebmlUint(0xe7, Math.round(clusterStart))]
        let index = start
        while (index < samples.length) {
            const sample = samples[index]!
            const relative = Math.round(sample.timestamp / 1000 - clusterStart)
            // Relative block times are 16-bit, and each cluster opens on a keyframe when it can.
            if (index > start && (relative > 30000 || (sample.keyframe && relative > 2000))) break
            const head = new Uint8Array(4)
            head[0] = 0x81
            head[1] = (relative >> 8) & 255
            head[2] = relative & 255
            head[3] = sample.keyframe ? 0x80 : 0
            blocks.push(ebml(0xa3, head, sample.data))
            index++
        }
        clusters.push(ebml(0x1f43b675, ...blocks))
        start = index
    }
    const segment = ebml(0x18538067, info, track, ...clusters)
    return write((w) => w.bytes(header).bytes(segment))
}
