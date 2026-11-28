import { spawnSync } from "child_process"
import { existsSync } from "fs"
import { mkdir, readFile, utimes, writeFile } from "fs/promises"
import { join } from "path"
import { describe, expect, it } from "vitest"
import { audioSamples, differencePeak, ffmpeg, filmFolder, loudness, narratedMix, plain, ready, tool, twoTakes } from "./narrated-tools-support"

describe.skipIf(!ready)("narration tools: effects", () => {
    it('mixes only the selected named effects through the public CLI, in author order and at quiet gains', async () => {
        const folder = await filmFolder()
        await twoTakes(folder, { mix: { seed: 3, swells: [], effects: [] } })
        const raw = join(folder, 'stills', 'mix-raw.wav')
        const empty = narratedMix(folder)
        expect(empty.status, empty.stderr).toBe(0)
        expect(empty.stdout).toContain('effects at ;')
        const baseline = audioSamples(raw)
        // Both empty lists leave the same voice and pad, including the existing peak scaling.
        const emptySound = await readFile(raw)
        await writeFile(join(folder, 'film.json'), JSON.stringify({ mix: { seed: 3, swells: [], chimes: [] } }))
        const noChimes = tool('mix', folder)
        expect(noChimes.status, noChimes.stderr).toBe(0)
        expect((await readFile(raw)).equals(emptySound)).toBe(true)
        await writeFile(join(folder, 'film.json'), JSON.stringify({ mix: { seed: 3, swells: [], effects: [
            { sound: 'resolve', at: -2 },
            { sound: 'tap', intro: 0.2 },
            { sound: 'slide', scene: 'hook', word: 'run', offset: 0.7 },
            { sound: 'latch', scene: -1, beat: -1, edge: 'end', offset: 0.5 },
            { sound: 'bell', at: 3.2, until: { at: 3.6 } },
        ] } }))
        const named = narratedMix(folder)
        expect(named.status, named.stderr).toBe(0)
        expect(named.stdout).toContain('effects at 6.50s, 0.20s, 2.70s, 6.00s, 3.20s;')
        expect(named.stdout).not.toContain('chimes at')
        const selected = audioSamples(raw)
        for (const [from, to] of [[0.2, 0.5], [2.7, 3.1], [3.2, 3.6], [6, 6.3], [6.5, 7.3]]) {
            const peak = differencePeak(selected, baseline, from!, to!)
            expect(peak).toBeGreaterThan(0.025)
            expect(peak).toBeLessThan(0.055)
        }
        for (const [from, to] of [[0, 0.2], [0.5, 2.7], [3.1, 3.2], [3.6, 6], [7.3, 8.5]]) expect(differencePeak(selected, baseline, from!, to!)).toBe(0)
    }, 180_000)

    it('places the authored WAV after speech and invalidates the mix when its samples change', async () => {
        const folder = await filmFolder()
        const settings = { seed: 3, swells: [], levels: { under: -40, pause: -40 } }
        await twoTakes(folder, { mix: { ...settings, effects: [] } })
        const raw = join(folder, 'stills', 'mix-raw.wav')
        const mix = () => {
            const result = narratedMix(folder)
            expect(result.status, result.stderr).toBe(0)
            return audioSamples(raw)
        }
        const baseline = mix()
        const wav = 'assets/click.wav'
        await mkdir(join(folder, 'assets'))
        await writeFile(join(folder, 'film.json'), JSON.stringify({ mix: { ...settings, effects: [
            { wav, scene: 'hook', beat: 0, edge: 'end' },
        ] } }))
        const source = join(folder, wav)
        const current = () => JSON.parse(plain('verify', folder, '--step', 'build', '--json').stdout).mix.current
        for (const frequency of [660, 990]) {
            ffmpeg('-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=0.125:sample_rate=48000`, source)
            await utimes(source, 1000000000, 1000000000)
            if (frequency === 990) expect(current()).toBe(false)
            const selected = mix()
            expect(current()).toBe(true)
            expect(differencePeak(selected, baseline, 0, 2.5)).toBe(0)
            expect(differencePeak(selected, baseline, 2.625, 8.5)).toBe(0)
            const clip = audioSamples(source)
            let error = 0
            for (let i = 0; i < clip.length; i++) {
                const left = 2 * (2.5 * 48000 + i)
                error = Math.max(error, Math.abs(selected[left]! - baseline[left]! - clip[i]!))
            }
            expect(error).toBeLessThan(0.000001)
        }
    }, 180_000)

    it('plays the score of a film at its level, makes room for the voice in the band of the voice only, and makes the mix again when the score changes', async () => {
        const folder = await filmFolder()
        await mkdir(join(folder, 'assets'), { recursive: true })
        const score = join(folder, 'assets', 'score.wav'), bed = join(folder, 'stills', 'bed-only.wav')
        // A bass, a tone in the band of the voice, and air: in the middle, and one more tone in the sides.
        const tones = (middle: string, seconds = 12) => ffmpeg('-f', 'lavfi', '-i', `aevalsrc=${middle}+0.1*sin(2*PI*1200*t)|${middle}-0.1*sin(2*PI*1200*t):s=44100:d=${seconds}`, score)
        tones('0.1*sin(2*PI*70*t)+0.1*sin(2*PI*800*t)+0.1*sin(2*PI*11000*t)')
        await twoTakes(folder, { mix: { music: { wav: 'assets/score.wav', level: -12, carve: 10, duck: 2, attack: 0.1, release: 0.3 }, effects: [] } })
        const current = () => JSON.parse(plain('verify', folder, '--step', 'build', '--json').stdout).mix.current
        const first = narratedMix(folder)
        expect(first.status, first.stderr).toBe(0)
        expect(first.stdout).toContain('in the band of the voice: voice')
        expect(current()).toBe(true)
        // The level of one tone in the middle or in the sides, in decibels, in a part of the bed.
        const samples = audioSamples(bed)
        const level = (frequency: number, from: number, to: number, side = false) => {
            let c = 0, s = 0
            const a = Math.round(from * 48000), n = Math.round((to - from) * 48000)
            for (let i = a; i < a + n; i++) { const value = (samples[2 * i]! + (side ? -1 : 1) * samples[2 * i + 1]!) / 2, angle = 2 * Math.PI * frequency * i / 48000; c += value * Math.cos(angle); s += value * Math.sin(angle) }
            return 20 * Math.log10(2 * Math.hypot(c, s) / n)
        }
        // The hook speaks from 1.5 to 2.5, and the next words come at 4.
        const moved = (frequency: number, side = false) => level(frequency, 3.2, 3.6, side) - level(frequency, 1.7, 2.1, side)
        expect(moved(800)).toBeCloseTo(12, 0)
        for (const frequency of [70, 11000]) expect(Math.abs(moved(frequency) - 2)).toBeLessThan(0.9)
        expect(moved(1200, true)).toBeCloseTo(2, 1)
        // The room is there by the first word.
        expect(level(800, 1.46, 1.5) - level(800, 1.7, 2.1)).toBeLessThan(1.2)
        // The film is 8.5 seconds long. A longer score ends with it, at no level.
        expect(samples.length).toBe(8.5 * 48000 * 2)
        expect(Math.abs(samples.at(-1)!)).toBeLessThan(0.001)
        // The mix for the render has one gain, so a pause and a sentence keep their difference, and no sample moves.
        const raw = join(folder, 'stills', 'mix-raw.wav'), done = join(folder, 'narration.wav')
        const apartBy = (path: string) => 20 * Math.log10(loudness(path, 1.7, 2.3) / loudness(path, 3, 3.6))
        expect(Math.abs(apartBy(done) - apartBy(raw))).toBeLessThan(0.3)
        const before = audioSamples(raw), after = audioSamples(done)
        expect(after.length).toBe(before.length)
        const same = (shift: number) => { let sum = 0; for (let i = 1.7 * 48000; i < 2.2 * 48000; i++) sum += before[2 * i]! * after[2 * (i + shift)]!; return sum }
        expect(Array.from({ length: 481 }, (_, i) => i - 240).reduce((a, b) => (same(b) > same(a) ? b : a))).toBe(0)
        // A score that was made to the length of the film keeps its own end, also when it is some samples longer.
        tones('0.1*sin(2*PI*500*t)', 8.51)
        expect(narratedMix(folder).status).toBe(0)
        expect(loudness(bed, 8.3, 8.48) / loudness(bed, 7.6, 7.9)).toBeGreaterThan(0.9)
        tones('0.1*sin(2*PI*700*t)')
        await utimes(score, 1000000000, 1000000000)
        expect(current()).toBe(false)
    }, 240_000)

    it('leaves a score as it is when the film asks for no room', async () => {
        const folder = await filmFolder()
        await mkdir(join(folder, 'assets'), { recursive: true })
        ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=800:duration=8.5:sample_rate=48000', join(folder, 'assets', 'score.wav'))
        const apart = async (carve: number) => {
            await twoTakes(folder, { mix: { music: { wav: 'assets/score.wav', carve, duck: 0 }, effects: [] } })
            const result = narratedMix(folder)
            expect(result.status, result.stderr).toBe(0)
            const bed = join(folder, 'stills', 'bed-only.wav')
            return 20 * Math.log10(loudness(bed, 0.2, 0.8) / loudness(bed, 1.8, 2.3))
        }
        expect(Math.abs(await apart(0))).toBeLessThan(0.2)
        expect(await apart(12)).toBeGreaterThan(11)
    }, 240_000)

    it('polishes a voice without a change of its level or of its time, and brings a mix to the loudness that the film asks for', async () => {
        const folder = await filmFolder()
        const run = async (mix: object) => {
            await twoTakes(folder, { mix: { seed: 3, effects: [], ...mix } })
            const result = narratedMix(folder)
            expect(result.status, result.stderr).toBe(0)
        }
        await run({})
        const plainVoice = audioSamples(join(folder, 'stills', 'voice-only.wav'))
        await run({ polish: true, loudness: -20 })
        const polished = audioSamples(join(folder, 'stills', 'voice-only.wav'))
        expect(polished.length).toBe(plainVoice.length * 2)
        const rms = (samples: Float32Array, from: number, to: number, stride: number) => { let sum = 0, n = 0; for (let i = Math.round(from * 48000) * stride; i < Math.round(to * 48000) * stride; i++) { sum += samples[i]! ** 2; n++ } return Math.sqrt(sum / n) }
        expect(Math.abs(20 * Math.log10(rms(polished, 1.7, 2.3, 2) / rms(plainVoice, 1.7, 2.3, 1)))).toBeLessThan(3)
        // Before the first word there is nothing, and after the last one there is a room that dies away.
        expect(rms(polished, 0.2, 1.3, 2)).toBeLessThan(0.0005)
        expect(rms(polished, 2.55, 2.65, 2)).toBeGreaterThan(rms(polished, 3.2, 3.4, 2) * 3)
        const said = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', join(folder, 'narration.wav'), '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
        expect(Math.abs(Number(/I:\s+(-[\d.]+) LUFS/.exec(said.slice(said.lastIndexOf('Summary')))![1]) + 20)).toBeLessThan(1.5)
    }, 240_000)

    it('measures a score where it sounds and on its louder side, and adds no bell that the film did not ask for', async () => {
        const folder = await filmFolder()
        await mkdir(join(folder, 'assets'), { recursive: true })
        const score = join(folder, 'assets', 'score.wav'), bed = join(folder, 'stills', 'bed-only.wav')
        const run = async (music: object, ...filter: string[]) => {
            ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=800:duration=8.5:sample_rate=48000', '-af', filter.join(','), score)
            await twoTakes(folder, { mix: { music: { wav: 'assets/score.wav', ...music } } })
            const result = narratedMix(folder)
            expect(result.status, result.stderr).toBe(0)
            return { said: result.stdout + result.stderr, level: loudness(bed, 1.7, 2.3) }
        }
        const whole = await run({ level: -20 }, 'pan=stereo|c0=c0|c1=c0')
        expect(whole.said).toContain('chimes at ;')
        expect(whole.said).not.toContain('covers the voice')
        // The same music with silence after it is as loud where it sounds.
        const short = await run({ level: -20 }, "volume='if(lt(t,3),1,0)':eval=frame", 'pan=stereo|c0=c0|c1=c0')
        expect(Math.abs(20 * Math.log10(short.level / whole.level))).toBeLessThan(0.6)
        // Music on the right side only is measured there, and is too near to the voice.
        const right = await run({ level: -3, carve: 0, duck: 0 }, 'pan=stereo|c0=0*c0|c1=c0')
        expect(right.said).toContain('the music covers the voice')
    }, 240_000)

    it('rejects a score that it cannot play, and the settings of the pad beside it', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        await mkdir(join(folder, 'assets'), { recursive: true })
        ffmpeg('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', join(folder, 'assets', 'quiet.wav'))
        ffmpeg('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=5.1', '-t', '2', join(folder, 'assets', 'surround.wav'))
        const invalid: [Record<string, unknown>, string][] = [
            [{ music: { level: -20 } }, 'mix.music.wav: is missing'],
            [{ music: { wav: 'assets/none.wav' } }, 'mix.music.wav: assets/none.wav is missing'],
            [{ music: { wav: 'assets/quiet.wav' } }, 'the WAV is silent'],
            [{ music: { wav: 'assets/surround.wav' } }, 'give a nonempty mono or stereo WAV'],
            [{ music: { wav: 'assets/quiet.wav', level: 3 } }, 'mix.music.level'],
            [{ music: { wav: 'assets/quiet.wav', carve: -2 } }, 'mix.music.carve'],
            [{ music: { wav: 'assets/quiet.wav', duck: 40 } }, 'mix.music.duck'],
            [{ music: { wav: 'assets/quiet.wav', attack: 0 } }, 'mix.music.attack'],
            [{ music: { wav: 'assets/quiet.wav', loop: true } }, 'mix.music.loop'],
            [{ music: { wav: 'assets/quiet.wav' }, seed: 3 }, 'mix.seed: shapes the pad'],
            [{ music: { wav: 'assets/quiet.wav' }, swells: [] }, 'mix.swells: shapes the pad'],
            [{ polish: 'yes' }, 'mix.polish'],
            [{ loudness: 3 }, 'mix.loudness'],
        ]
        for (const [mix, message] of invalid) {
            await writeFile(join(folder, 'film.json'), JSON.stringify({ mix }))
            const result = tool('mix', folder)
            expect(result.status, message).not.toBe(0)
            expect(result.said.join('\n') + result.stderr).toContain(message)
        }
    }, 180_000)

    it('keeps named gains, short cutoffs, and film-end fades local to each clip', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        const mixWith = async (effects: unknown[]) => {
            await writeFile(join(folder, 'film.json'), JSON.stringify({ mix: { seed: 3, swells: [], effects } }))
            const result = tool('mix', folder)
            expect(result.status, result.stderr).toBe(0)
            return audioSamples(join(folder, 'stills', 'mix-raw.wav'))
        }
        const baseline = await mixWith([])
        const resolve = { sound: 'resolve', at: 2.7, gain: 0.04, until: { scene: 'close', offset: -0.75 } }
        const one = await mixWith([resolve])
        const overlap = await mixWith([resolve, { sound: 'slide', at: 2.8, gain: 0.03, until: { at: 2.84 } }])
        expect(differencePeak(overlap, one, 2.8, 2.84)).toBeGreaterThan(0.0001)
        expect(differencePeak(overlap, one, 2.84, 8.5)).toBe(0)
        expect(differencePeak(one, baseline, 0, 2.7)).toBe(0)
        expect(differencePeak(one, baseline, 3.25, 8.5)).toBe(0)
        const soft = await mixWith([{ sound: 'tap', scene: 'hook', word: 'It', last: true, offset: 3.8, gain: 0.02 }])
        const louder = await mixWith([{ sound: 'tap', at: 6, gain: 0.04 }])
        expect(differencePeak(louder, baseline, 6, 6.2) / differencePeak(soft, baseline, 6, 6.2)).toBeCloseTo(2, 4)
        const shifted = await mixWith([{ sound: 'tap', at: 7, gain: 0.02 }])
        let localError = 0
        for (let i = 0; i < 0.2 * 48000 * 2; i++) {
            const a = 6 * 48000 * 2 + i, b = 7 * 48000 * 2 + i
            localError = Math.max(localError, Math.abs((soft[a]! - baseline[a]!) - (shifted[b]! - baseline[b]!)))
        }
        expect(localError).toBeLessThan(0.000001)
        const clipped = await mixWith([{ sound: 'resolve', at: 8.45, until: { at: 9 } }])
        expect(clipped.length).toBe(baseline.length)
        expect(differencePeak(clipped, baseline, 8.45, 8.49)).toBeGreaterThan(0.005)
        expect(Math.abs(clipped.at(-2)! - baseline.at(-2)!)).toBeLessThan(0.000001)
        expect(await mixWith([{ sound: 'tap', at: 6, until: { at: 6 + 1 / 96000 } }])).toEqual(baseline)
    }, 240_000)

    it('rejects invalid clips and unresolved or out-of-film anchors through the public CLI', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        await writeFile(join(folder, 'broken.wav'), 'not a sound file')
        const invalid: [Record<string, unknown>, string][] = [
            [{ wav: 'broken.wav', at: 1 }, 'mix.effects[0].wav (broken.wav)'],
            [{ sound: 'unknown', at: 1 }, 'mix.effects[0].sound'],
            [{ sound: 'tap', at: 8.5 }, 'Give a time inside the film'],
            [{ sound: 'tap', scene: 'missing' }, 'the film has no scene "missing"'],
            [{ sound: 'tap', scene: 'hook', word: 'never' }, 'the voice does not say "never"'],
            [{ sound: 'tap', at: 1, until: { at: 0.5 } }, 'Give an until time after the start'],
        ]
        for (const [effect, message] of invalid) {
            await writeFile(join(folder, 'film.json'), JSON.stringify({ mix: { effects: [effect] } }))
            const result = narratedMix(folder)
            expect(result.status, result.stderr).not.toBe(0)
            expect(result.stderr).toContain(message)
            expect(result.stderr).not.toContain('Traceback')
            expect(existsSync(join(folder, 'narration.wav'))).toBe(false)
            expect(existsSync(join(folder, 'audio', 'mix.json'))).toBe(false)
        }
    }, 240_000)
})
