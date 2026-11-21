import { spawnSync } from "child_process"
import { closeSync, existsSync, openSync } from "fs"
import { mkdir, readFile, rm, utimes, writeFile } from "fs/promises"
import { join } from "path"
import { describe, expect, it } from "vitest"
import { QUIET, TIMING, TOOLS, audioSamples, differencePeak, ffmpeg, filmFolder, loudness, narratedMix, plain, ready, tool, twoTakes } from "./narrated-tools-support"

describe.skipIf(!ready)("narration tools: mix and effects", () => {
    it('lists each beat with its start and the end of its voice, on the timeline of the film', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        const beats = tool('beats', folder)
        expect(beats.status, beats.stderr).toBe(0)
        // The lead is 1.5. The hook has 1 second of voice and 1 of hold, then a gap of 0.5: the close starts at 4.
        expect(beats.stdout.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)).toEqual([
            'hook 0 1.50 2.50 Will it run? Will it?',
            'close 0 4.00 5.50 Have a plan.',
            'end 7.50',
        ])
        expect(tool('beats', folder, 'close').stdout).not.toContain('hook')
        const closeWords = tool('beats', folder, '--words', 'close').stdout
        expect(closeWords).toContain('Have@0.1 a@0.4 plan@0.6')
        expect(closeWords).not.toContain('Will@')
        expect(tool('beats', folder, '--words', 'hook', '0').stdout).toContain('Will@0.1 it@0.3')
        expect(tool('beats', folder, '--words', 'hook', '1').stdout.trim()).toBe('')
        const unknown = tool('beats', folder, 'outro')
        expect(unknown.status).not.toBe(0)
        expect(unknown.stderr).toContain('beats: the film has no scene "outro". The scenes are: hook, close')
    }, 120_000)

    it('places a scene at its own start, for a timing that another tool wrote', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        // A tool that lays out its own sound gives each scene the time of its first word.
        const own = { ...TIMING, scenes: [{ ...TIMING.scenes[0]!, start: 2 }, { ...TIMING.scenes[1]!, start: 6.25 }] }
        await writeFile(join(folder, 'timing.json'), JSON.stringify(own))
        const beats = tool('beats', folder)
        expect(beats.status, beats.stderr).toBe(0)
        expect(beats.stdout.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)).toEqual([
            'hook 0 2.00 3.00 Will it run? Will it?',
            'close 0 6.25 7.75 Have a plan.',
            'end 9.75',
        ])
        await writeFile(join(folder, 'timing.json'), JSON.stringify({ ...own, scenes: [own.scenes[0]!, { ...own.scenes[1]!, start: 'late' }] }))
        const wrong = tool('beats', folder)
        expect(wrong.status).not.toBe(0)
        expect(wrong.said.join('\n')).toContain('scenes[1].start: "late" is not a time')
        // The hook ends at 4: one second of voice from 2, and one second of hold.
        await writeFile(join(folder, 'timing.json'), JSON.stringify({ ...own, scenes: [own.scenes[0]!, { ...own.scenes[1]!, start: 3.5 }] }))
        expect(tool('beats', folder).said.join('\n')).toContain('scenes[1].start: 3.5 is before the end of the scene before it, at 4 s')
        await writeFile(join(folder, 'timing.json'), JSON.stringify({ ...own, scenes: [own.scenes[0]!, { ...own.scenes[1]!, start: 4 }] }))
        expect(tool('beats', folder).status).toBe(0)
    }, 120_000)

    it('writes a deterministic bed aligned to an existing voice and lifts it in long pauses', async () => {
        const dir = await filmFolder()
        const voice = join(dir, 'voice.wav'), bed = join(dir, 'bed.wav'), timing = join(dir, 'marks.json')
        await writeFile(timing, JSON.stringify({ beats: [0, 9], scenes: [0, 9] }))
        ffmpeg('-f', 'lavfi', '-i', 'aevalsrc=if(between(t\\,5\\,10)\\,0\\,0.2*sin(2*PI*180*t)):s=24000:d=19.0003', voice)
        const render = (palette: string) => {
            const take = tool('soundbed', 'bed', '--voice', voice, '--out', bed, '--seed', '17', '--palette', palette, '--timing', timing)
            expect(take.status, take.stderr).toBe(0)
        }
        render('low')
        const original = await readFile(bed)
        expect(audioSamples(bed).length).toBe(2 * audioSamples(voice).length)
        const active = loudness(bed, 2, 4), pause = loudness(bed, 7, 9)
        expect(active).toBeGreaterThan(0)
        expect(active).toBeLessThan(0.12 * loudness(voice, 2, 4))
        expect(pause).toBeGreaterThan(1.3 * active)
        render('low')
        expect((await readFile(bed)).equals(original)).toBe(true)
        // A late excerpt crosses the chord transition and then the return of speech.
        const start = 7 * 24000 + 37, end = 12 * 24000 + 13
        const pcm = audioSamples(bed)
        const excerpt = join(dir, 'excerpt.wav')
        const stream = ffmpeg('-i', voice, '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1')
        const excerptArgs = ['run', join(TOOLS, 'soundbed.py'), 'bed', '--voice', '-', '--palette', 'low',
            '--seed', '17', '--timing', timing, '--out', excerpt, '--start-sample', String(start), '--end-sample', String(end)]
        const partial = spawnSync('uv', excerptArgs, { input: stream, env: { ...process.env, ...QUIET } })
        expect(partial.status, partial.stderr.toString()).toBe(0)
        const streamArgs = ['run', join(TOOLS, 'soundbed.py'), 'bed', '--voice', '-', '--out', '-',
            '--palette', 'low', '--seed', '17', '--timing', timing]
        const streamed = spawnSync('uv', streamArgs, { input: stream, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...QUIET } })
        expect(streamed.status, streamed.stderr.toString()).toBe(0)
        expect(streamed.stdout.readUInt32LE(4)).toBe(streamed.stdout.length - 8)
        expect(streamed.stdout.readUInt32LE(40)).toBe(streamed.stdout.length - 44)
        const redirectedPath = join(dir, 'redirected.wav')
        const fd = openSync(redirectedPath, 'w')
        try {
            const redirected = spawnSync('uv', streamArgs, { input: stream, stdio: ['pipe', fd, 'pipe'], env: { ...process.env, ...QUIET } })
            expect(redirected.status, redirected.stderr.toString()).toBe(0)
        } finally {
            closeSync(fd)
        }
        expect((await readFile(redirectedPath)).equals(streamed.stdout)).toBe(true)
        const unpack = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-c:a', 'pcm_s24le', '-f', 's24le', '-'],
            { input: streamed.stdout, maxBuffer: 4 * 1024 * 1024 })
        expect(unpack.status, unpack.stderr.toString()).toBe(0)
        const expected = ffmpeg('-i', bed, '-c:a', 'pcm_s24le', '-f', 's24le', '-')
        expect(unpack.stdout.equals(expected)).toBe(true)
        const header = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,bits_per_raw_sample',
            '-of', 'json', 'pipe:0'], { input: streamed.stdout })
        expect(header.status, header.stderr.toString()).toBe(0)
        expect(JSON.parse(header.stdout.toString()).streams).toEqual([{ sample_rate: '24000', channels: 2, bits_per_raw_sample: '24' }])
        const got = audioSamples(excerpt)
        expect(Buffer.from(got.buffer, got.byteOffset, got.byteLength).equals(
            Buffer.from(pcm.buffer, pcm.byteOffset + start * 8, (end - start) * 8))).toBe(true)
        expect(tool('soundbed', 'bed', '--voice', voice, '--out', bed, '--start-sample', String(end),
            '--end-sample', String(start)).status).not.toBe(0)
        expect((await readFile(bed)).equals(original)).toBe(true)
        render('open')
        expect((await readFile(bed)).equals(original)).toBe(false)
    }, 120_000)

    it('mixes two takes at their places, with the pad under the voice and above silence', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        const mix = tool('mix', folder)
        expect(mix.status, mix.stderr).toBe(0)
        // The film is the last word at 7.5, one gap, and the tail.
        expect(mix.stdout).toContain('film 8.50s  beats 2')
        // Without a list in film.json: a bell on the title card and one after the last word, which ends at 5.5.
        // The pad rises in the middle of the title card, and 2.4 seconds before the end of the film.
        expect(mix.stdout).toContain('chimes at 0.15s, 5.70s; swells at 0.50s, 6.10s')
        // The last line says what was written, how far the pad is under the voice, and the next step.
        expect(mix.said.at(-1)).toMatch(new RegExp(`^mix: narration\\.wav is written: 8\\.50 s, 2 takes, the pad 2\\d\\.\\d dB under the voice\\. Next: vizmatic narrated check ${folder} --motion$`))
        const probe = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-of', 'json', '-show_streams', '-show_format', join(folder, 'narration.wav')], { encoding: 'utf8' }).stdout)
        expect(probe.streams[0]).toMatchObject({ sample_rate: '48000', channels: 2 })
        expect(Number(probe.format.duration)).toBeCloseTo(8.5, 2)
        // The voice alone: each take is at its place, and there is silence between the takes and after them.
        const voice = join(folder, 'stills', 'voice-only.wav')
        expect(loudness(voice, 1.6, 2.4)).toBeGreaterThan(0.3)
        expect(loudness(voice, 4.1, 5.4)).toBeGreaterThan(0.3)
        expect(loudness(voice, 0.2, 1.4)).toBe(0)
        expect(loudness(voice, 2.7, 3.9)).toBe(0)
        expect(loudness(voice, 5.7, 8.3)).toBe(0)
        // The pad alone: it sounds through the film, far under the voice, and it is louder in a long pause than under a take.
        const bed = join(folder, 'stills', 'bed-only.wav')
        const under = loudness(bed, 4.3, 5.3), pause = loudness(bed, 6.6, 7.2)
        expect(under).toBeGreaterThan(0)
        expect(under).toBeLessThan(loudness(voice, 4.3, 5.3) * 0.2)
        expect(pause).toBeGreaterThan(under * 1.5)
        // The mix has the voice, and a bell on the title card before the first word.
        expect(loudness(join(folder, 'stills', 'mix-raw.wav'), 0.2, 1.2)).toBeGreaterThan(loudness(bed, 0.2, 1.2))
    }, 180_000)

    it('says that the pad is too near the voice, and does not name a next step then', async () => {
        const folder = await filmFolder()
        await twoTakes(folder, { mix: { seed: 3, swells: [], levels: { under: -6 } } })
        const mix = tool('mix', folder)
        expect(mix.status, mix.stderr).toBe(0)
        expect(mix.said.at(-1)).toMatch(/^mix: narration\.wav is written: 8\.50 s, 2 takes, the pad \d\.\d dB under the voice\. That is too near: under 18\.0 dB the pad covers the voice\. Lower mix\.levels\.under, or move a swell away from the voice, and mix again\.$/)
    }, 180_000)

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

    it('takes the levels, the seed and the swells of the film', async () => {
        const folder = await filmFolder()
        const bed = join(folder, 'stills', 'bed-only.wav'), voice = join(folder, 'stills', 'voice-only.wav')
        const mixWith = async (mix: unknown) => {
            await twoTakes(folder, { mix })
            const result = tool('mix', folder)
            expect(result.status, result.stderr).toBe(0)
            return { underVoice: loudness(bed, 4.3, 5.3) / loudness(voice, 4.3, 5.3), bedUnderVoice: loudness(bed, 4.3, 5.3), afterVoice: loudness(bed, 6.0, 7.0), pad: await readFile(bed) }
        }
        // With no swell, the pad under a take is at the level that the film gives: about 22 dB under the voice, or 30.
        const usual = await mixWith({ seed: 3, swells: [] }), quiet = await mixWith({ seed: 3, swells: [], levels: { under: -30 } })
        expect(usual.underVoice).toBeGreaterThan(0.04)
        expect(usual.underVoice).toBeLessThan(0.14)
        expect(quiet.underVoice).toBeLessThan(usual.underVoice * 0.6)
        // In the long pause after the last word, the pad rises: 15 dB under the voice and not 22.
        expect(usual.afterVoice).toBeGreaterThan(usual.bedUnderVoice * 1.5)
        // Without a list of swells, the pad rises after the last word only: under the last take it is as with no swell.
        const defaults = await mixWith({ seed: 3 })
        expect(defaults.underVoice).toBeCloseTo(usual.underVoice, 6)
        expect(defaults.afterVoice).toBeGreaterThan(usual.afterVoice * 1.2)
        // One seed gives one pad, and another seed gives another.
        expect((await mixWith({ seed: 3, swells: [] })).pad.equals(usual.pad)).toBe(true)
        const others: boolean[] = []
        for (const seed of [4, 5, 6]) others.push((await mixWith({ seed, swells: [] })).pad.equals(usual.pad))
        expect(others).toContain(false)
        // A wide swell near the end would rise under the last take. With `after`, it starts after the last word.
        const wide = { at: -2.4, width: 3, db: -3 }
        const under = await mixWith({ seed: 3, swells: [wide] }), cut = await mixWith({ seed: 3, swells: [{ ...wide, after: { scene: 'close', beat: -1, edge: 'end', offset: 0.25 } }] })
        expect(under.underVoice).toBeGreaterThan(usual.underVoice * 3)
        expect(cut.underVoice).toBeCloseTo(usual.underVoice, 6)
        expect(cut.afterVoice).toBeGreaterThan(usual.afterVoice * 2)
        expect(cut.afterVoice).toBeCloseTo(under.afterVoice, 6)
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

    it('finds the lag of each take in the sound of a movie, to a sample', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        expect(tool('mix', folder).status).toBe(0)
        // The sound of a movie, as the sync step writes it: mono at 16 kHz. Here it is the voice of the mix.
        const voice = join(folder, 'stills', 'voice-only.wav'), movie = join(folder, 'stills', 'movie.wav')
        ffmpeg('-i', voice, '-ac', '1', '-ar', '16000', movie)
        const onTime = tool('lag', folder)
        expect(onTime.status, onTime.stderr).toBe(0)
        expect(onTime.stdout).toContain("takes 2 largest lags (s): [('hook/0', 0.0), ('close/0', 0.0)] mean abs 0.0")
        expect(onTime.said).toEqual([`lag: all 2 takes are within 0.02 s of their planned time in the movie that sync read. Next: vizmatic narrated probe ${folder}`])
        // The same sound, a quarter of a second late.
        ffmpeg('-i', voice, '-af', 'adelay=250:all=1', '-ac', '1', '-ar', '16000', movie)
        const late = tool('lag', folder)
        // A check that did not pass ends with a failure, for a script or an agent that reads the exit code.
        expect(late.status).not.toBe(0)
        expect(late.stdout).toMatch(/\('hook\/0', 0\.25\)/)
        expect(late.stdout).toMatch(/\('close\/0', 0\.25\)/)
        expect(late.stdout).toContain('mean abs 0.25')
        expect(late.said.join('\n')).toMatch(/^lag: 2 of 2 takes are not at their planned time in the movie that sync read: (hook\/0 \(\+0\.250 s\), close\/0 \(\+0\.250 s\)|close\/0 \(\+0\.250 s\), hook\/0 \(\+0\.250 s\))\. The movie has another sound than this timing: run vizmatic narrated mix .*, then build again or run vizmatic narrated resound /)
        await rm(movie)
        expect(tool('lag', folder).stderr).toContain('stills/movie.wav is missing. Run the sync step first, which writes the sound of the movie there: vizmatic narrated sync')
    }, 180_000)

    it('names the mistake in a chime or in the timing, in one line', async () => {
        const folder = await filmFolder()
        await twoTakes(folder, { mix: { chimes: [{ scene: 'hook', beat: 0, word: 'never' }] } })
        expect(tool('mix', folder).said).toEqual(['mix: film.json: mix.chimes[0].word: the voice does not say "never" in beat 0 of scene "hook". It says: Will it run? Will it?'])
        await twoTakes(folder, { mix: { chimes: [{ scene: 'hook', beat: 3 }] } })
        expect(tool('mix', folder).said).toEqual(['mix: the scene "hook" has 1 beats, and there is no beat 3'])
        await twoTakes(folder, { mix: { chimes: [{ at: 1, until: { at: 1.5 } }] } })
        expect(tool('mix', folder).said).toEqual(['mix: film.json: mix.chimes[0]: the chime starts at 1.00 s and must be silent from 1.50 s. A bell needs one second to ring'])
        await twoTakes(folder, { mix: { chimes: [{ at: 60 }] } })
        expect(tool('mix', folder).said).toEqual(['mix: film.json: mix.chimes[0]: the chime is at 60.00 s, and the film is 8.50 s long. Give a time inside the film'])
        // A take that the timing names and the disk does not have.
        await twoTakes(folder)
        await rm(join(folder, 'audio', 'b.wav'))
        expect(tool('mix', folder).said).toEqual([`mix: timing.json: close/0: the take audio/b.wav is missing. Run: vizmatic narrated voice ${folder}`])
        // A draft has times and no takes, so the mix says what to run first.
        await twoTakes(folder)
        await writeFile(join(folder, 'timing.json'), JSON.stringify({ ...TIMING, draft: true }))
        expect(tool('mix', folder).said).toEqual([`mix: timing.json: the file: is a draft: its times are estimates, and there is no voice. Run the voice step first: vizmatic narrated voice ${folder}`])
        expect(tool('beats', folder).status).toBe(0)
    }, 180_000)

})
