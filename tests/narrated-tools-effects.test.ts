import { existsSync } from "fs"
import { mkdir, readFile, writeFile } from "fs/promises"
import { join } from "path"
import { utimes } from "fs/promises"
import { describe, expect, it } from "vitest"
import { audioSamples, differencePeak, ffmpeg, filmFolder, loudness, narratedMix, plain, ready, tool, twoTakes } from "./narrated-tools-support"

describe.skipIf(!ready)("narration tools: effects and chimes", () => {
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

    it('preserves legacy bell timing and gain at recorded reference samples from the public mix', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        // Stereo samples from the original mixer, with default bells and then custom notes, gain, cutoff, and a full bell.
        const indices = [24617, 36011, 319999, 407900]
        const fixtures: [unknown, number[]][] = [
            [undefined, [0.048476577, 0.027265668, -0.067071676, 0.008448839, 0.109981775, -0.158115149, -0.003480792, -0.003030419]],
            [[{ at: 0.5, gain: 0.083, notes: [392, 587.33], until: { at: 2 } }, { at: 6.2, gain: 0.09, full: true }], [0.015309334, -0.003594160, 0.032766581, 0.101699948, 0.068225265, -0.201705217, -0.022892356, -0.020885706]],
        ]
        for (const [chimes, expected] of fixtures) {
            await writeFile(join(folder, 'film.json'), JSON.stringify({ mix: { seed: 3, chimes } }))
            const result = narratedMix(folder)
            expect(result.status, result.stderr).toBe(0)
            const samples = audioSamples(join(folder, 'stills', 'mix-raw.wav'))
            indices.flatMap((i) => [samples[i * 2], samples[i * 2 + 1]]).forEach((sample, i) => expect(sample).toBeCloseTo(expected[i]!, 5))
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

    it('rings a chime at the first or the last time that a beat says a word, with its gain and its second bell', async () => {
        const folder = await filmFolder()
        const raw = join(folder, 'stills', 'mix-raw.wav')
        const mixWith = async (chime: Record<string, unknown>) => {
            await twoTakes(folder, { mix: { seed: 3, swells: [], chimes: [chime] } })
            const result = tool('mix', folder)
            expect(result.status, result.stderr).toBe(0)
            return { times: /chimes at ([^;]*);/.exec(result.stdout)![1], ring: loudness(raw, 6.05, 6.9) }
        }
        // The hook starts at 1.5, and it says "it" at 0.3 and again at 0.7.
        expect((await mixWith({ scene: 'hook', beat: 0, word: 'it' })).times).toBe('1.80s')
        expect((await mixWith({ scene: 'hook', beat: 0, word: 'It', last: true })).times).toBe('2.20s')
        expect((await mixWith({ scene: 0, beat: -1, edge: 'end', offset: 0.5 })).times).toBe('3.00s')
        expect((await mixWith({ scene: 'close', offset: -0.25 })).times).toBe('3.75s')
        // A bell in the silence after the last word: a higher gain is louder, and so is the second, lower bell.
        const soft = await mixWith({ at: 6, gain: 0.05 }), loud = await mixWith({ at: 6, gain: 0.2 }), full = await mixWith({ at: 6, gain: 0.05, full: true })
        expect(soft.times).toBe('6.00s')
        expect(loud.ring).toBeGreaterThan(soft.ring * 2)
        expect(full.ring).toBeGreaterThan(soft.ring * 1.1)
        expect((await mixWith({ at: -2.5, gain: 0.05 })).ring).toBeCloseTo(soft.ring, 6)
    }, 240_000)

    it('places a chime on a spoken word, and keeps it silent from the time that the film gives', async () => {
        const folder = await filmFolder()
        await twoTakes(folder, { mix: { seed: 3, swells: [], chimes: [{ scene: 'hook', beat: 0, word: 'run', offset: 0.5, until: { scene: 'close', beat: 0, offset: -0.2 } }] } })
        const raw = join(folder, 'stills', 'mix-raw.wav'), bed = join(folder, 'stills', 'bed-only.wav')
        const mix = tool('mix', folder)
        expect(mix.status, mix.stderr).toBe(0)
        // "run" starts 0.5 seconds into the hook, which starts at 1.5, and the bell rings 0.5 seconds after it.
        expect(mix.stdout).toContain('chimes at 2.50s')
        expect(mix.stdout).toContain('the bell of 2.50s is silent from 3.80s')
        expect(mix.stdout).toMatch(/bell peak 0\.0000/)
        // The bell rings in the pause after the hook, and from 3.8 the mix is the pad alone.
        expect(loudness(raw, 2.6, 3.2)).toBeGreaterThan(loudness(bed, 2.6, 3.2) * 1.5)
        // The mix can be scaled as a whole to keep its peak under 0.97, so the two are compared as a ratio.
        const rest = loudness(raw, 3.82, 3.98) / loudness(bed, 3.82, 3.98)
        expect(rest).toBeGreaterThan(0.85)
        expect(rest).toBeLessThan(1.02)
    }, 180_000)
})
