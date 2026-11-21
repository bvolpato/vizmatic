import { spawnSync } from "child_process"
import { closeSync, openSync } from "fs"
import { readFile, rm, writeFile } from "fs/promises"
import { join } from "path"
import { describe, expect, it } from "vitest"
import { QUIET, TIMING, TOOLS, audioSamples, ffmpeg, filmFolder, loudness, ready, tool, twoTakes } from "./narrated-tools-support"

describe.skipIf(!ready)("narration tools: mix and bed", () => {
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
