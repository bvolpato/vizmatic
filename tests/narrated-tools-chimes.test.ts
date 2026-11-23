import { writeFile } from "fs/promises"
import { join } from "path"
import { describe, expect, it } from "vitest"
import { audioSamples, filmFolder, loudness, narratedMix, ready, tool, twoTakes } from "./narrated-tools-support"

describe.skipIf(!ready)("narration tools: chimes", () => {
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
        // Full bells must also stop cleanly by `until`, including the lower octave bell.
        await twoTakes(folder, { mix: { seed: 3, swells: [], chimes: [{ at: 2.5, full: true, until: { at: 3.8 } }] } })
        const fullCut = tool('mix', folder)
        expect(fullCut.status, fullCut.stderr).toBe(0)
        const afterCut = loudness(raw, 3.82, 3.98) / loudness(bed, 3.82, 3.98)
        expect(afterCut).toBeGreaterThan(0.85)
        expect(afterCut).toBeLessThan(1.02)
    }, 180_000)
})
