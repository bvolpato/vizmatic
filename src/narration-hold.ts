import { execFile } from 'node:child_process'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const outputRate = 48000

export interface NarrationHoldOptions {
    /** Narration take in a format that FFmpeg can read. */
    narration: string
    /** Number of 48 kHz frames reserved for speech and for its subsequent hold. */
    speechFrames: number
    holdFrames: number
    /** One channel of normalized PCM. Playback starts at the first frame of the hold. */
    sound: { sampleRate: number; samples: Float32Array }
    /** Destination for the 48 kHz stereo FLAC segment. */
    output: string
    ffmpegPath?: string
}

/** Fit a take to its speech window, append a mono demonstration, and pad the rest of the hold with silence. */
export async function renderNarrationHold(options: NarrationHoldOptions): Promise<void> {
    const { narration, speechFrames, holdFrames, sound, output, ffmpegPath = 'ffmpeg' } = options
    if (![speechFrames, holdFrames].every(n => Number.isSafeInteger(n) && n > 0))
        throw new RangeError('Speech and hold lengths must be positive 48 kHz frame counts')
    const { sampleRate, samples } = sound
    if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || !(samples instanceof Float32Array) || !samples.length)
        throw new RangeError('Expected nonempty mono PCM and a positive integer sample rate')
    if (samples.length * outputRate > holdFrames * sampleRate)
        throw new RangeError('Sound exceeds the narration hold')
    const bytes = Buffer.alloc(samples.length * 4)
    for (let i = 0; i < samples.length; i++) {
        if (!Number.isFinite(samples[i]) || Math.abs(samples[i]) > 1)
            throw new RangeError('PCM samples must be finite and between -1 and 1')
        bytes.writeFloatLE(samples[i], i * 4)
    }
    const directory = await mkdtemp(join(dirname(output), '.narration-hold-'))
    try {
        const pcm = join(directory, 'sound.f32le')
        const result = join(directory, 'segment.flac')
        await writeFile(pcm, bytes)
        const filters = [
            `[0:a]aformat=sample_rates=${outputRate}:channel_layouts=stereo,apad,atrim=end_sample=${speechFrames}[speech]`,
            `[1:a]aformat=sample_rates=${outputRate},pan=stereo|c0=c0|c1=c0,apad,atrim=end_sample=${holdFrames}[hold]`,
            '[speech][hold]concat=n=2:v=0:a=1[out]',
        ]
        await execute(ffmpegPath, [
            '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', narration,
            '-f', 'f32le', '-ar', String(sampleRate), '-ac', '1', '-i', pcm,
            '-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'flac',
            '-compression_level', '1', '-sample_fmt', 's16', result,
        ])
        await rename(result, output)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
}
