import { execFile } from 'node:child_process'
import { open, realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

/** A half-open range of displayed frames in a local AVC MP4. */
export interface AvcSpliceSegment {
    path: string
    startFrame: number
    endFrame: number
}

export interface AvcSplicePlan {
    /** UTF-8 ffconcat input for FFmpeg with -copyts, -safe 0 and -auto_convert 0. Map only 0:v:0. */
    concatScript: string
    frameCount: number
}

interface Packet {
    pts: number
    dts: number
    duration: number
    pos: string
    size: string
    flags: string
    data_hash: string
    side_data_list?: unknown[]
}

const formatFields = ['extradata_hash', 'profile', 'level', 'width', 'height', 'pix_fmt', 'field_order',
    'sample_aspect_ratio', 'display_aspect_ratio', 'color_range', 'color_space', 'color_transfer', 'color_primaries',
    'chroma_location', 'has_b_frames', 'r_frame_rate', 'avg_frame_rate', 'time_base', 'nal_length_size', 'side_data_list']

function command(binary: string, args: string[], input?: string): Promise<string> {
    return new Promise((accept, reject) => {
        const child = execFile(binary, args, { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, out) => {
            if (err) reject(err)
            else accept(out)
        })
        child.stdin?.on('error', error => {
            if ((error as NodeJS.ErrnoException).code !== 'EPIPE') reject(error)
        })
        child.stdin?.end(input)
    })
}

async function inspect(path: string) {
    if (!(await stat(path)).isFile()) throw new Error('Expected a local MP4 file')
    const base = ['-v', 'error', '-f', 'mov', '-protocol_whitelist', 'file', '-select_streams', 'v']
    const info = JSON.parse(await command('ffprobe', [...base, '-show_streams', '-show_data_hash', 'sha256', '-of', 'json', path]))
    const [v] = info.streams
    if (info.streams.length !== 1 || v.index !== 0 || v.codec_name !== 'h264' || v.codec_tag_string !== 'avc1'
        || v.is_avc !== 'true' || v.start_pts !== 0 || !v.extradata_hash || v.disposition?.attached_pic)
        throw new Error('Expected one zero-based avc1 video track at stream index 0')
    const [baseNum, baseDen] = v.time_base.split('/').map(Number)
    const [fpsNum, fpsDen] = v.r_frame_rate.split('/').map(Number)
    const step = fpsDen * baseDen / (fpsNum * baseNum)
    if (![baseNum, baseDen, fpsNum, fpsDen, step].every(n => Number.isSafeInteger(n) && n > 0))
        throw new Error('Expected constant frame duration in track ticks')
    const packets: Packet[] = JSON.parse(await command('ffprobe', [...base, '-show_packets', '-show_entries',
        'packet=pts,dts,duration,pos,size,flags,data_hash,side_data_list', '-show_data_hash', 'sha256', '-of', 'json', path])).packets
    if (!packets?.length || packets.length !== Number(v.nb_frames) || ![1, 2, 4].includes(Number(v.nal_length_size)))
        throw new Error('Incomplete AVC packet table')
    // A new sample description can change the active SPS/PPS even before the selected range.
    if (packets.some(packet => packet.side_data_list?.length))
        throw new Error('AVC packet side data is unsupported for stream-copy planning')
    return { packets, step, baseNum, baseDen, timeBase: v.time_base as string, nalBytes: Number(v.nal_length_size),
        format: JSON.stringify(formatFields.map(field => v[field])), firstDts: packets[0].dts }
}

async function checkIdr(path: string, packet: Packet, nalBytes: number): Promise<void> {
    if (!packet.flags.includes('K')) throw new Error('Cut must start at an IDR picture')
    const file = await open(path, 'r')
    try {
        const end = Number(packet.pos) + Number(packet.size)
        let at = Number(packet.pos)
        let idr = false
        const header = Buffer.alloc(nalBytes + 1)
        while (at < end) {
            const { bytesRead } = await file.read(header, 0, header.length, at)
            const size = header.readUIntBE(0, nalBytes)
            if (bytesRead !== header.length || size === 0 || at + nalBytes + size > end)
                throw new Error('Invalid AVC NAL length at cut')
            const type = header[nalBytes] & 31
            if ((type >= 1 && type <= 4) || (type >= 19 && type <= 21))
                throw new Error('Cut contains a non-IDR slice')
            if (type === 5) idr = true
            at += nalBytes + size
        }
        if (!idr) throw new Error('Cut must start at an IDR picture')
    } finally {
        await file.close()
    }
}

/** Plan and dry-run a picture-only FFmpeg stream copy across closed GOPs in compatible constant-rate AVC MP4s. */
export async function planAvcSplice(segments: readonly AvcSpliceSegment[]): Promise<AvcSplicePlan> {
    if (!segments.length) throw new Error('Supply at least one frame range')
    const sources = new Map<string, Awaited<ReturnType<typeof inspect>>>()
    const lines = ['ffconcat version 1.0']
    const expected: string[] = []
    let frameCount = 0
    let format: string | undefined
    let firstDts: number | undefined
    let timeBase: string | undefined
    for (const { path, startFrame, endFrame } of segments) {
        if (![startFrame, endFrame].every(Number.isSafeInteger) || startFrame < 0 || endFrame <= startFrame)
            throw new RangeError('Expected a nonempty half-open frame range')
        const absolute = await realpath(resolve(path))
        if (/[\r\n\0]/.test(absolute)) throw new Error('Invalid ffconcat filename')
        const source = sources.get(absolute) ?? await inspect(absolute)
        sources.set(absolute, source)
        const { packets, step, baseNum, baseDen } = source
        if (endFrame > packets.length) throw new RangeError('Frame range exceeds the video track')
        format ??= source.format
        firstDts ??= source.firstDts
        timeBase ??= source.timeBase
        if (source.format !== format || source.firstDts !== firstDts)
            throw new Error('AVC configuration, presentation format or decode clock differs')
        await checkIdr(absolute, packets[startFrame], source.nalBytes)
        if (endFrame < packets.length) await checkIdr(absolute, packets[endFrame], source.nalBytes)
        const displayed = new Set<number>()
        const shift = (frameCount - startFrame) * step
        for (let i = startFrame; i < endFrame; i++) {
            const p = packets[i]
            const frame = p.pts / step
            if (!Number.isSafeInteger(frame) || frame < startFrame || frame >= endFrame || displayed.has(frame)
                || /[CD]/.test(p.flags) || p.dts !== firstDts + i * step || p.duration !== step || !/^SHA256:[a-f0-9]{64}$/.test(p.data_hash))
                throw new Error('Cut crosses a picture dependency or an irregular packet clock')
            displayed.add(frame)
            expected.push([p.dts + shift, p.pts + shift, step, p.size, p.data_hash.slice(7)].join(','))
        }
        if (packets[startFrame].pts !== startFrame * step
            || (endFrame < packets.length && packets[endFrame].pts !== endFrame * step))
            throw new Error('IDR does not start at the requested presentation frame')
        const time = (ticks: number) => (ticks * baseNum / baseDen).toFixed(6)
        lines.push("file 'file:" + absolute.replaceAll("'", "'\\''") + "'")
        if (startFrame) lines.push('inpoint ' + time(startFrame * step))
        if (endFrame < packets.length) lines.push('outpoint ' + time(packets[endFrame].dts))
        lines.push('duration ' + time((endFrame - startFrame) * step))
        frameCount += endFrame - startFrame
    }
    const concatScript = lines.join('\n') + '\n'
    // The concat demuxer seeks in microseconds, and may use an earlier keyframe. Check its actual output.
    const audit = await command('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-copyts', '-f', 'concat', '-safe', '0',
        '-auto_convert', '0', '-protocol_whitelist', 'file,pipe', '-i', 'pipe:0', '-map', '0:v:0', '-c:v', 'copy',
        '-f', 'framehash', '-hash', 'sha256', '-'], concatScript)
    const auditLines = audit.trimEnd().split(/\r?\n/)
    if (!auditLines.includes('#tb 0: ' + timeBase)) throw new Error('FFmpeg changed the video time base')
    const actual = auditLines.filter(line => !line.startsWith('#'))
    if (actual.length !== expected.length || actual.some((row, i) => row.split(',').slice(1).map(s => s.trim()).join(',') !== expected[i]))
        throw new Error('FFmpeg stream copy changed packet clocks or payloads')
    return { concatScript, frameCount }
}
