import { existsSync } from "fs"
import { mkdir, readFile, utimes, writeFile } from "fs/promises"
import { join } from "path"
import { describe, expect, it } from "vitest"
import { audioSamples, differencePeak, ffmpeg, filmFolder, narratedMix, plain, ready, tool, twoTakes } from "./narrated-tools-support"

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
