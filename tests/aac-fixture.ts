import { execFileSync } from 'child_process'
import { writeFile } from 'fs/promises'

/** Voiced harmonics and bursts of filtered noise model alternating vowels and fricatives. */
export function syntheticAacFixture(seconds = 8) {
    const rate = 48000, frames = Math.round(seconds * rate)
    const samples = new Float32Array(frames * 2)
    let seed = 0x481110, phase = 0, rightLow = 0, peak = 0
    // These biquads restrict the noise to approximately 1.8 to 15 kHz at 48 kHz.
    const sections: [number, number, number, number, number, number, number][] = [
        [0.3404479805013085, 0.680895961002617, 0.3404479805013085, 0.40024321101817606, 0.24519467656525418, 0, 0],
        [1, -2, 1, -1.6695513336316972, 0.7242331742893239, 0, 0],
    ]
    const random = () => {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        return (seed >>> 0) / 0x100000000 * 2 - 1
    }
    const edge = (x: number) => Math.sin(Math.PI / 2 * Math.max(0, Math.min(1, x))) ** 2
    for (let i = 0; i < frames; i++) {
        const t = i / rate, u = (t - 0.6) % 0.43
        const active = t >= 0.6 && t < seconds - 0.6
        const vowel = active ? edge(u / 0.018) * edge((0.30 - u) / 0.045) : 0
        const burst = active ? edge((u - 0.19) / 0.003) * edge((0.29 - u) / 0.012) : 0
        const f0 = 142 + 24 * Math.sin(2 * Math.PI * 0.37 * t) + 10 * Math.sin(2 * Math.PI * 1.13 * t)
        phase += 2 * Math.PI * f0 / rate
        let voiced = 0
        for (let h = 1; h <= 48; h++) {
            const f = h * f0
            const formants = 0.12 + 1.6 * Math.exp(-0.5 * ((f - 600) / 150) ** 2)
                + Math.exp(-0.5 * ((f - 1450) / 210) ** 2) + 0.5 * Math.exp(-0.5 * ((f - 2550) / 300) ** 2)
            voiced += formants / h ** 1.05 * Math.sin(h * phase + h * 0.31)
        }
        let filtered = random()
        for (const s of sections) {
            const out = s[0] * filtered + s[5]
            s[5] = s[1] * filtered - s[3] * out + s[6]
            s[6] = s[2] * filtered - s[4] * out
            filtered = out
        }
        rightLow += 0.45 * (random() - rightLow)
        const noise = filtered * burst * 0.12
        samples[2 * i] = 0.32 * voiced * vowel + noise
        samples[2 * i + 1] = 0.31 * voiced * vowel + 0.88 * noise + 0.014 * rightLow * burst
        peak = Math.max(peak, Math.abs(samples[2 * i]!), Math.abs(samples[2 * i + 1]!))
    }
    for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! * (0.55 / peak)
    const wav = Buffer.alloc(44 + samples.byteLength)
    wav.write('RIFF', 0)
    wav.writeUInt32LE(wav.length - 8, 4)
    wav.write('WAVEfmt ', 8)
    wav.writeUInt32LE(16, 16)
    wav.writeUInt16LE(3, 20) // IEEE float
    wav.writeUInt16LE(2, 22)
    wav.writeUInt32LE(rate, 24)
    wav.writeUInt32LE(rate * 8, 28)
    wav.writeUInt16LE(8, 32)
    wav.writeUInt16LE(32, 34)
    wav.write('data', 36)
    wav.writeUInt32LE(samples.byteLength, 40)
    for (let i = 0; i < samples.length; i++) wav.writeFloatLE(samples[i]!, 44 + i * 4)
    return { wav, samples }
}

/** Compare a complete sequential stereo float32 decode against the exact source samples. */
export function aacWaveformError(source: Float32Array, decoded: Buffer) {
    if (decoded.length !== source.byteLength) throw new Error('The decoded audio must have the source sample count')
    let peak = 0, block = 0, maxMillisecondRms = 0
    for (let i = 0; i < source.length; i++) {
        const error = decoded.readFloatLE(i * 4) - source[i]!
        peak = Math.max(peak, Math.abs(error))
        block += error * error
        if ((i + 1) % 96 === 0) {
            maxMillisecondRms = Math.max(maxMillisecondRms, Math.sqrt(block / 96))
            block = 0
        }
    }
    return { peak, maxMillisecondRms }
}

/** Forward commands to the installed FFmpeg, but emulate a build that lacks the AAC PNS option. */
export async function writeFfmpegWithoutPns(path: string) {
    const actual = execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim()
    await writeFile(path, `#!/usr/bin/env node
const { spawnSync } = require('node:child_process')
const args = process.argv.slice(2)
if (args.includes('encoder=aac')) { console.log('Encoder aac'); process.exit(0) }
if (args.includes('-aac_pns')) process.exit(1)
const result = spawnSync(${JSON.stringify(actual)}, args, { stdio: 'inherit' })
process.exit(result.status ?? 1)
`, { mode: 0o755 })
}
