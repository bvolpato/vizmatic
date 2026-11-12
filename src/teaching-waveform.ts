import type { CanvasBounds, CanvasPoint } from './canvas-components'
import type { TeachingPainter } from './teaching-canvas'

export interface PcmEnvelope {
    sampleRate: number
    startTime: number
    bins: readonly { startSample: number, endSample: number, min: number, max: number }[]
}

/** Group consecutive mono PCM samples and retain both signed extremes. */
export function pcmEnvelope(samples: ArrayLike<number>, options: { sampleRate: number, bins: number, startTime?: number }): PcmEnvelope {
    const { sampleRate, bins, startTime = 0 } = options
    if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new Error('PCM sample rate must be a positive integer')
    if (!Number.isSafeInteger(bins) || bins <= 0) throw new Error('PCM bin count must be a positive integer')
    if (!Number.isFinite(startTime)) throw new Error('PCM start time must be finite')
    const count = Math.min(samples.length, bins)
    const result: PcmEnvelope['bins'][number][] = []
    for (let bin = 0; bin < count; bin++) {
        const startSample = Math.floor(bin * samples.length / count)
        const endSample = Math.floor((bin + 1) * samples.length / count)
        let min = Infinity, max = -Infinity
        for (let i = startSample; i < endSample; i++) {
            const sample = samples[i]!
            if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new Error('PCM samples must be finite and between -1 and 1')
            min = Math.min(min, sample)
            max = Math.max(max, sample)
        }
        result.push({ startSample, endSample, min, max })
    }
    return { sampleRate, startTime, bins: result }
}

export interface TeachingWaveformOptions extends CanvasBounds {
    envelope: PcmEnvelope
    domain: readonly [number, number]
    color?: string
    cursorTime?: number
    reveal?: boolean
    cursorColor?: string
}

export function createTeachingWaveform<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>) {
    return function waveform({ x, y, width, height, envelope, domain, color = '#63DEEC', cursorTime, reveal = false, cursorColor = '#FFFFFF' }: TeachingWaveformOptions) {
        const [from, to] = domain
        if (![x, y, width, height, from, to].every(Number.isFinite) || width <= 0 || height <= 0 || to <= from)
            throw new Error('Waveform requires finite positive bounds and an increasing time domain')
        if (cursorTime !== undefined && !Number.isFinite(cursorTime)) throw new Error('Waveform cursor time must be finite')
        if (reveal && cursorTime === undefined) throw new Error('A waveform reveal requires a cursor time')
        const project = (t: number) => x + (t - from) / (to - from) * width
        const amplitude = (a: number) => y + height * (1 - a) / 2
        const upper: CanvasPoint[] = [], lower: CanvasPoint[] = []
        for (const bin of envelope.bins) {
            const start = envelope.startTime + bin.startSample / envelope.sampleRate
            const end = envelope.startTime + bin.endSample / envelope.sampleRate
            if (start >= to || (reveal && end > cursorTime!)) break
            if (end <= from) continue
            const left = project(Math.max(from, start)), right = project(Math.min(to, end))
            upper.push({ x: left, y: amplitude(bin.max) }, { x: right, y: amplitude(bin.max) })
            lower.push({ x: left, y: amplitude(bin.min) }, { x: right, y: amplitude(bin.min) })
        }
        if (upper.length) painter.path([...upper, ...lower.reverse()], {
            clip: { x, y, width, height }, color, width: 1, fill: color, closed: true,
        })
        const cursorX = cursorTime !== undefined && cursorTime >= from && cursorTime <= to ? project(cursorTime) : null
        if (cursorX !== null) painter.line(cursorX, y, cursorX, y + height, cursorColor, 1)
        return { cursorX }
    }
}
