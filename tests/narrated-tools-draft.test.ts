import { createHash } from "crypto"
import { existsSync } from "fs"
import { mkdir, readFile, rm, writeFile } from "fs/promises"
import { dirname, join } from "path"
import { describe, expect, it } from "vitest"
import { SCRIPT, TIMING, TOOLS, bare, ffmpeg, filmFolder, narratedMix, pictureHash, plain, ready, record, tempDirs, tinyMovie, tool, twoTakes } from "./narrated-tools-support"

describe.skipIf(!ready)("narration tools: draft, probe, and record", () => {
    it('drafts the timing of a script with the spoken form of each word, so that a cue works before the voice exists', async () => {
        const folder = await filmFolder()
        await writeFile(join(folder, 'film.ts'), '')
        await writeFile(join(folder, 'script.json'), JSON.stringify({
            timeline: { intro: 2, pause: 0.6, gap: 0.4, tail: 0.5 },
            scenes: [{ id: 'hook', title: 'Hook', beats: [{ say: 'Toto 2.0 reads 128 points. Then it stops.', hold: 1.5, cues: [{ id: 'read', phrase: 'Toto two reads' }] }, { say: 'It is fast.' }, { say: 'GIFT-Eval is a benchmark, and 12 is not 128.' }] }],
            pronounce: { '2.0': 'two', '128': 'one hundred and twenty eight', Toto: '[Toto](/tˈOtO/)', GIFT: 'present', 'GIFT-Eval': 'gift eval', '12': 'twelve' },
        }))
        const draft = tool('draft', folder)
        expect(draft.status, draft.stderr).toBe(0)
        expect(draft.said.join('\n')).toMatch(new RegExp(`^draft: timing\\.json is written: a draft of 1 scenes, about [\\d.]+ s of voice\\. The voice step replaces it\\. Next: vizmatic narrated check ${folder}$`))
        const timing = JSON.parse(await readFile(join(folder, 'timing.json'), 'utf8'))
        // The lead holds the title card, as the voice step writes it.
        expect(timing).toMatchObject({ draft: true, intro: 2, lead: 2.6, gap: 0.4, tail: 0.5, voice: 'af_heart', speed: 1.12 })
        expect(timing.fingerprint).toMatch(/^[0-9a-f]{16}$/)
        const [first, second, third] = timing.scenes[0].beats
        // A longer entry of the pronounce map goes first, and an entry does not replace a part of a longer number.
        expect(third.words.map((spoken: { text: string }) => spoken.text)).toEqual(['gift', 'eval', 'is', 'a', 'benchmark,', 'and', 'twelve', 'is', 'not', 'one', 'hundred', 'and', 'twenty', 'eight.'])
        expect(first.words.map((spoken: { text: string }) => spoken.text)).toEqual(['Toto', 'two', 'reads', 'one', 'hundred', 'and', 'twenty', 'eight', 'points.', 'Then', 'it', 'stops.'])
        expect(first).toMatchObject({ say: 'Toto 2.0 reads 128 points. Then it stops.', hold: 1.5 })
        expect(second.hold).toBe(0.25)
        // The words are in order, inside the beat, and a longer beat takes longer.
        const starts = first.words.map((spoken: { start: number }) => spoken.start)
        expect([...starts].sort((a: number, b: number) => a - b)).toEqual(starts)
        expect(first.words[first.words.length - 1].end).toBeLessThanOrEqual(first.duration + 1e-6)
        expect(first.duration).toBeGreaterThan(second.duration * 2)
        // A draft is current for its script, and a second draft replaces the first.
        expect(tool('verify', folder, '--step', 'check').status).toBe(0)
        expect(tool('draft', folder).status).toBe(0)
        expect(existsSync(join(folder, 'timing.draft.json'))).toBe(false)
    }, 120_000)

    it('never replaces a measured timing with a draft: the draft goes to its own file', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        const measured = await readFile(join(folder, 'timing.json'), 'utf8')
        const draft = tool('draft', folder)
        expect(draft.status, draft.stderr).toBe(0)
        expect(await readFile(join(folder, 'timing.json'), 'utf8')).toBe(measured)
        expect(JSON.parse(await readFile(join(folder, 'timing.draft.json'), 'utf8'))).toMatchObject({ draft: true, lead: 1.5 })
        expect(draft.said.join('\n')).toMatch(/^draft: timing\.draft\.json is written: a draft of 2 scenes, about [\d.]+ s of voice\. timing\.json holds the measured voice and was left as it is\. To lay out scenes on the draft, import \.\/timing\.draft\.json in the film file, and check it with: vizmatic check <film file>$/)
    }, 120_000)

    it('preserves malformed existing timing when drafting', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        const path = join(folder, 'timing.json')
        for (const raw of ['{"scenes":[', 'null', '{"draft":true}']) {
            await writeFile(path, raw)
            expect(tool('draft', folder).status).not.toBe(0)
            expect(await readFile(path, 'utf8')).toBe(raw)
        }
    }, 120_000)

    it('keeps the draft timing of the narrated template equal to what the draft step writes for its script', async () => {
        const folder = await filmFolder()
        for (const name of ['script.json', 'film.json', 'film.ts']) await writeFile(join(folder, name), await readFile(join('templates', 'narrated', name)))
        expect(tool('draft', folder).status).toBe(0)
        expect(await readFile(join(folder, 'timing.json'), 'utf8')).toBe(await readFile(join('templates', 'narrated', 'timing.json'), 'utf8'))
    }, 120_000)

    it('takes a written form in a transcript for its spoken form, and reports a word that is another word', () => {
        const differences = (said: string, heard: string, pronounce: Record<string, string>) => {
            const result = bare(['-c', 'import json, sys, transcribe; said, heard, pronounce = json.loads(sys.argv[1]); print(json.dumps(transcribe.differences(said, heard, transcribe.spoken_forms(pronounce))))', JSON.stringify([said, heard, pronounce])])
            expect(result.status, result.stderr).toBe(0)
            return JSON.parse(result.stdout) as string[]
        }
        const pronounce = { '1000000': 'one million', '800': 'eight hundred', Toto: '[Toto](/tˈOtO/)' }
        // The script writes a number, the voice says it in words, and a transcript may write either one.
        expect(differences('It has 1000000 rows, and 800 pages.', ' It has one million rows and eight hundred pages.', pronounce)).toEqual([])
        expect(differences('It has 1000000 rows, and 800 pages.', ' It has 1,000,000 rows, and 800 pages.', pronounce)).toEqual([])
        expect(differences('This is Toto.', ' This is Toto.', pronounce)).toEqual([])
        // A word that is heard as another word is a difference, and so is a number that is heard as another number.
        expect(differences('The quantiles of Toto.', ' The quantals of Toto.', pronounce)).toEqual(["'quantiles' -> 'quantals'"])
        expect(differences('It has 1000000 rows.', ' It has one billion rows.', pronounce)).toEqual(["'1000000' -> 'one billion'"])
        expect(differences('The page.', ' The page', {})).toEqual([])
    }, 60_000)

    it('probes a tiny movie, and says where a movie is when the one that it reads is not there', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        const movie = await tinyMovie(folder)
        await record(folder, movie)
        const probe = tool('probe', folder)
        expect(probe.status, probe.stderr).toBe(0)
        // The output is the data and nothing else. The last line for a person is on the error stream.
        const found = JSON.parse(probe.stdout)
        expect(probe.said).toEqual([`probe: Tiny-Film.mp4: 320x180, 8.5 s, 2 chapters, 2 caption cues. It has a picture, sound, captions and chapters. Next: vizmatic narrated sync ${folder}`])
        // The default movie is the delivered film in dist/, by the name that film.json gives.
        expect(found.path.endsWith(join('dist', 'Tiny-Film.mp4'))).toBe(true)
        expect(found).toMatchObject({
            title: 'A tiny film', duration_seconds: 8.5,
            video: { codec_name: 'h264', pix_fmt: 'yuv420p', width: 320, height: 180, r_frame_rate: '30/1', nb_frames: '255' },
            audio: { codec_name: 'aac', channels: 1 },
            captions: { codec_name: 'mov_text', cues: 2 },
            chapters: [{ start: 0, title: 'One' }, { start: 4, title: 'Two\\ and = more' }],
            // The record beside the movie is of this picture, and its timing is the timing of the folder.
            timing: { record: 'valid', differs: [] },
        })
        expect(found.sha256).toMatch(/^[0-9a-f]{64}$/)
        // A movie without sound, captions and chapters is not as a narrated film is built, and the step fails.
        const silent = join(folder, 'silent.mp4')
        ffmpeg('-i', movie, '-map', '0:v', '-map_chapters', '-1', '-c', 'copy', silent)
        const lacks = tool('probe', folder, silent)
        expect(lacks.status).not.toBe(0)
        expect(lacks.said).toEqual([`probe: silent.mp4: 320x180, 8.5 s, 0 chapters, 0 caption cues. Not as a narrated film is built: it has no sound; it has no captions; it has no chapters; it has no record of the timing of its picture. Build it again: vizmatic narrated build ${folder}`])
        // After a draft build, the delivered movie is not there: the message names the draft and the option.
        await writeFile(join(folder, 'dist', 'Tiny-Film-draft.mp4'), await readFile(movie))
        await record(folder, join(folder, 'dist', 'Tiny-Film-draft.mp4'))
        await rm(movie)
        const missing = tool('probe', folder)
        expect(missing.status).not.toBe(0)
        expect(missing.said).toEqual(['probe: dist/Tiny-Film.mp4 is missing, and a draft is there. Add --draft to read dist/Tiny-Film-draft.mp4'])
        const draft = tool('probe', folder, '--draft')
        expect(draft.status, draft.stderr).toBe(0)
        expect(draft.said.join('\n')).toMatch(/Next: vizmatic narrated sync .* --draft$/)
        await rm(join(folder, 'dist', 'Tiny-Film-draft.mp4'))
        expect(tool('probe', folder).said.join('\n')).toMatch(/^probe: .*Tiny-Film\.mp4 is missing\. Build the film first: vizmatic narrated build /)
        expect(tool('probe', folder, '--draft').said.join('\n')).toMatch(/Tiny-Film-draft\.mp4 is missing\. Build the film first: vizmatic narrated build .* --draft$/)
    }, 180_000)

    it('keeps with a movie the timing that its picture was rendered with, and not a timing that changed during the render', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        const movie = await tinyMovie(folder)
        const sha = createHash('sha256').update(await readFile(join(folder, 'timing.json'))).digest('hex')
        const record = tool('record', folder, movie, '--timing', sha)
        expect(record.status, record.stderr).toBe(0)
        expect(record.said).toEqual(['record: Tiny-Film.timing.json is written beside Tiny-Film.mp4: the timing that its picture was rendered with.'])
        const kept = JSON.parse(await readFile(join(folder, 'dist', 'Tiny-Film.timing.json'), 'utf8'))
        expect(kept.timing).toEqual(TIMING)
        // The record names the picture by the hash of its video packets, so it does not count beside another render.
        expect(kept.picture).toBe(pictureHash(movie).replace('MD5=', ''))
        expect(JSON.parse(tool('probe', folder).stdout).timing).toEqual({ record: 'valid', differs: [] })
        await rm(join(folder, 'dist', 'Tiny-Film.timing.json'))
        // The hash is what says that the timing of the record is the timing that the render read: the step does not go on without it.
        const without = tool('record', folder, movie)
        expect(without.status).not.toBe(0)
        expect(without.said).toEqual(['record: give the hash of timing.json as it was before the render: --timing <sha256>. Without it, nothing says that this timing is the timing of the picture'])
        expect(existsSync(join(folder, 'dist', 'Tiny-Film.timing.json'))).toBe(false)
        const changed = tool('record', folder, movie, '--timing', '0'.repeat(64))
        expect(changed.status).not.toBe(0)
        expect(changed.said).toEqual([`record: timing.json changed while the film was rendered, so nothing says which timing the picture of Tiny-Film.mp4 has. Build again: vizmatic narrated build ${folder}`])
        expect(existsSync(join(folder, 'dist', 'Tiny-Film.timing.json'))).toBe(false)
        // A step writes inside the folder of the film only.
        const outside = join(dirname(folder), `outside-${process.pid}.mp4`)
        tempDirs.push(outside)
        await writeFile(outside, await readFile(movie))
        expect(tool('record', folder, outside).said.join('\n')).toMatch(/^record: .*outside-\d+\.mp4 is outside the folder of the film, and a step writes only inside that folder\./)
        expect(existsSync(outside.replace(/\.mp4$/, '.timing.json'))).toBe(false)
    }, 180_000)

    it('invalidates a named mix when its list or shared acoustic defaults change', async () => {
        const folder = await filmFolder()
        const effects = [{ sound: 'tap', at: 0.2 }, { sound: 'resolve', at: 6, until: { at: 6.4 } }]
        const mix = { seed: 3, effects }
        await twoTakes(folder, { mix })
        const result = narratedMix(folder)
        expect(result.status, result.stderr).toBe(0)
        const current = () => JSON.parse(plain('verify', folder, '--step', 'build', '--json').stdout).mix.current
        expect(current()).toBe(true)
        for (const changed of [
            { ...mix, effects: [{ sound: 'latch', at: 0.2 }, effects[1]] },
            { ...mix, effects: [{ ...effects[0], gain: 0.08 }, effects[1]] },
            { ...mix, effects: [{ ...effects[0], at: 0.3 }, effects[1]] },
            { ...mix, effects: [effects[0], { ...effects[1], until: { at: 6.5 } }] },
            { ...mix, effects: [...effects].reverse() },
            { ...mix, effects: [] },
            { seed: 3 },
        ]) {
            await writeFile(join(folder, 'film.json'), JSON.stringify({ mix: changed }))
            expect(current()).toBe(false)
        }
        await writeFile(join(folder, 'film.json'), JSON.stringify({ mix }))
        expect(current()).toBe(true)
        // Change only the metadata in an isolated tool copy, as a new package version could do.
        const copiedTools = join(folder, 'tools')
        await mkdir(copiedTools)
        for (const name of ['verify.py', 'film.py', 'checks.py', 'mix.py', 'soundbed.py']) await writeFile(join(copiedTools, name), await readFile(join(TOOLS, name)))
        const copiedState = () => JSON.parse(bare([join(copiedTools, 'verify.py'), folder, '--step', 'build', '--json']).stdout).mix.current
        expect(copiedState()).toBe(true)
        const metadata = await readFile(join(copiedTools, 'checks.py'), 'utf8')
        await writeFile(join(copiedTools, 'checks.py'), metadata.replace('"gain": 0.045', '"gain": 0.046'))
        expect(copiedState()).toBe(false)
    }, 180_000)

    it('says for a build if the voice and the mix are current, and why', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        const work = () => { const { voice, mix, scenes, gap, length } = JSON.parse(tool('verify', folder, '--step', 'build', '--json').stdout); return { voice, mix, scenes, gap, length } }
        // The takes are there and the mix is not: the voice step has no work, and the mix step has.
        expect(work()).toEqual({
            voice: { current: true, why: 'timing.json is the voice of this script, and its 2 takes are on the disk' },
            mix: { current: false, why: 'narration.wav is missing' },
            // Where each scene is in the film: its first word, and the end of its last hold.
            scenes: [{ id: 'hook', start: 1.5, end: 3.5 }, { id: 'close', start: 4, end: 7.5 }], gap: 0.5, length: 8.5,
        })
        expect(tool('mix', folder).status).toBe(0)
        expect(work().mix).toEqual({ current: true, why: 'narration.wav is the mix of this timing and of this film.json' })
        // Another mix in film.json, another timing, or another file in the place of narration.wav: the mix has work again.
        await writeFile(join(folder, 'film.json'), JSON.stringify({ output: 'Tiny-Film', mix: { seed: 4 } }))
        expect(work().mix).toEqual({ current: false, why: 'the timing or the mix of film.json changed after the last mix' })
        await writeFile(join(folder, 'film.json'), JSON.stringify({ output: 'Tiny-Film', mix: { seed: 3 } }))
        expect(work().mix.current).toBe(true)
        const sound = await readFile(join(folder, 'narration.wav'))
        ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=880:duration=8.5:sample_rate=48000', '-ac', '2', join(folder, 'narration.wav'))
        expect(work().mix).toEqual({ current: false, why: 'narration.wav is not the file that the last mix wrote' })
        await writeFile(join(folder, 'narration.wav'), sound)
        await rm(join(folder, 'audio', 'mix.json'))
        expect(work().mix).toEqual({ current: false, why: 'no record says what narration.wav was made from' })
        // The voice has work when the script changed, when the timing is a draft, and when a take is not on the disk.
        await rm(join(folder, 'audio', 'b.wav'))
        expect(work()).toMatchObject({ voice: { current: false, why: '1 takes of timing.json are missing or empty on the disk' }, mix: { current: false, why: 'the voice is made first' }, scenes: [] })
        await twoTakes(folder)
        await writeFile(join(folder, 'timing.json'), JSON.stringify({ ...TIMING, draft: true }))
        expect(work().voice).toEqual({ current: false, why: 'timing.json is a draft: its times are estimates, and there is no voice' })
        await rm(join(folder, 'timing.json'))
        expect(work().voice).toEqual({ current: false, why: 'timing.json is missing' })
        await twoTakes(folder)
        await writeFile(join(folder, 'script.json'), JSON.stringify({ ...SCRIPT, scenes: [SCRIPT.scenes[0]!, { ...SCRIPT.scenes[1]!, beats: [{ say: 'Have a plan.', hold: 3 }] }] }))
        expect(work().voice).toEqual({ current: false, why: 'the script changed after the voice was made: close/0 (the hold)' })
    }, 240_000)

    it('names in one line a timing that is broken by hand, and a take with no sound', async () => {
        const folder = await filmFolder()
        const broken = async (change: (timing: Record<string, unknown> & { scenes: { beats: Record<string, unknown>[] }[] }) => void) => {
            await twoTakes(folder)
            const timing = structuredClone(TIMING) as never
            change(timing)
            await writeFile(join(folder, 'timing.json'), JSON.stringify(timing))
            const result = tool('beats', folder)
            expect(result.status).not.toBe(0)
            expect(result.stderr).not.toContain('Traceback')
            expect(result.said).toHaveLength(1)
            return result.said[0]!.replace(`. Run: vizmatic narrated voice ${folder}`, '')
        }
        expect(await broken((timing) => { delete timing.scenes[0]!.beats[0]!['duration'] })).toBe('beats: timing.json: scenes[0].beats[0].duration: is missing, so the file is not a timing')
        expect(await broken((timing) => { timing.scenes[1]!.beats[0]!['hold'] = 'long' })).toBe('beats: timing.json: scenes[1].beats[0].hold: "long" is not a time, so the file is not a timing')
        expect(await broken((timing) => { timing.scenes[1]!.beats[0]!['words'] = [{ text: 'Have' }] })).toBe('beats: timing.json: scenes[1].beats[0].words: is not a list of words with their times, so the file is not a timing')
        expect(await broken((timing) => { delete timing['gap'] })).toBe('beats: timing.json: gap: is missing, so the file is not a timing')
        expect(await broken((timing) => { timing.scenes = [] })).toBe('beats: timing.json: scenes: is missing or empty, so the file is not a timing')
        // Every step that reads the timing says the same line, and none shows a stack.
        await twoTakes(folder)
        await writeFile(join(folder, 'timing.json'), JSON.stringify({ ...TIMING, scenes: [{ id: 'hook', title: 'Hook', beats: [{ say: 'Will it run? Will it?' }] }] }))
        for (const step of ['mix', 'lag', 'transcribe', 'sync', 'resound']) {
            const result = (step === 'mix' ? tool : plain)(step, folder)
            expect(result.stderr, step).not.toContain('Traceback')
            expect(result.said, step).toEqual([`${step}: timing.json: scenes[0].beats[0].duration: is missing, so the file is not a timing. Run: vizmatic narrated voice ${folder}`])
        }
        await writeFile(join(folder, 'timing.json'), '{ "scenes": [')
        expect(tool('beats', folder).said.join('\n')).toMatch(new RegExp(`^beats: timing\\.json: line 1: is not valid JSON \\(.*\\)\\. Run: vizmatic narrated voice ${folder}$`))
        // A take with no sound in it: the mix names the take and the step that makes it again.
        await twoTakes(folder)
        await writeFile(join(folder, 'audio', 'a.wav'), '')
        const empty = tool('mix', folder)
        expect(empty.stderr).not.toContain('Traceback')
        expect(empty.said).toEqual([`mix: timing.json: hook/0: the take audio/a.wav is empty. Run: vizmatic narrated voice ${folder}`])
    }, 240_000)

    it('gives each film its own default seed, from the name of its movie', async () => {
        const folder = await filmFolder()
        const seed = async (film: unknown) => {
            await twoTakes(folder, film)
            const result = bare(['-c', 'import sys, pathlib, film; print(film.open_film(pathlib.Path(sys.argv[1]), "mix").mix["seed"])', folder])
            expect(result.status, result.stderr).toBe(0)
            return Number(result.stdout.trim())
        }
        const toto = await seed({ output: 'Toto' }), sirius = await seed({ output: 'Sirius' })
        // Two films must not share their chords. The same film keeps its seed, and film.json can give one.
        expect(toto).not.toBe(sirius)
        expect(await seed({ output: 'Toto' })).toBe(toto)
        expect(Number.isInteger(toto) && toto >= 0 && toto < 1000).toBe(true)
        expect(await seed({ output: 'Toto', mix: { seed: 23 } })).toBe(23)
    }, 120_000)

})
