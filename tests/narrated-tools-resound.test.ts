import { spawn, spawnSync } from "child_process"
import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises"
import { basename, dirname, join } from "path"
import { describe, expect, it } from "vitest"
import { aacWaveformError, syntheticAacFixture, writeFfmpegWithoutPns } from "./aac-fixture"
import { QUIET, SCRIPT, TIMING, TOOLS, bare, built, ffmpeg, filmFolder, pictureHash, plain, ready, record, saidBy, streamKinds, tempDirs, tinyMovie, tool, twoTakes } from "./narrated-tools-support"

describe.skipIf(!ready)("narration tools: resound and sync", () => {
    it('puts a new sound into a movie without a change of the picture, the title, the captions and the chapters', async () => {
        const folder = await filmFolder()
        const movie = await built(folder)
        const before = JSON.parse(tool('probe', folder).stdout)
        const picture = pictureHash(movie)
        // The movie has a tone of 440 Hz. The mix has the takes: tones of 220 and 330 Hz, and silence between them.
        const resound = tool('resound', folder)
        expect(resound.status, resound.stderr).toBe(0)
        expect(resound.said).toEqual([`resound: Tiny-Film.mp4 has the new sound. The new file was checked before it took the place of the old one: its picture, its captions, its 2 chapters and its length are as they were. Its picture was rendered with the timing of timing.json, by the record that the build keeps beside it. Next: vizmatic narrated sync ${folder}`])
        const after = JSON.parse(tool('probe', folder).stdout)
        expect(pictureHash(movie)).toBe(picture)
        // The first take is a tone of 220 Hz from 1.5 to 2.5 seconds: about 440 changes of sign in one second, and not 880.
        const sound = ffmpeg('-ss', '1.6', '-t', '0.8', '-i', movie, '-ac', '1', '-ar', '48000', '-f', 's16le', '-')
        const samples = new Int16Array(sound.buffer, sound.byteOffset, Math.floor(sound.byteLength / 2))
        const crossings = samples.reduce((count, sample, index) => count + (index > 0 && (sample >= 0) !== (samples[index - 1]! >= 0) ? 1 : 0), 0)
        expect(crossings).toBeGreaterThan(300)
        expect(crossings).toBeLessThan(500)
        expect(after.sha256).not.toBe(before.sha256)
        expect(after).toMatchObject({ title: 'A tiny film', duration_seconds: 8.5, video: before.video, audio: { codec_name: 'aac', channels: 2, sample_rate: '48000' }, captions: { cues: 2 }, chapters: before.chapters })
        // No file of the step is left beside the movie.
        expect((await readdir(join(folder, 'dist'))).sort()).toEqual(['Tiny-Film.mp4', 'Tiny-Film.timing.json'])
        // The record is still valid for the movie with the new sound: its picture did not change.
        expect(JSON.parse(tool('probe', folder).stdout).timing).toEqual({ record: 'valid', differs: [] })
    }, 240_000)

    it('preserves synthetic speech-like transients through normal resound', async () => {
        const folder = await filmFolder()
        const movie = await built(folder)
        const { wav, samples } = syntheticAacFixture(8.5)
        await writeFile(join(folder, 'narration.wav'), wav)
        // Record this synthetic mix as current, so the public step also checks the picture timing.
        const record = bare(['-c', 'import sys, pathlib, film; film.write_mix_record(film.open_film(pathlib.Path(sys.argv[1]), "resound"))', folder])
        expect(record.status, record.stderr).toBe(0)
        const result = tool('resound', folder)
        expect(result.status, result.stderr).toBe(0)
        const error = aacWaveformError(samples, ffmpeg('-i', movie, '-map', '0:a:0', '-t', '8.5', '-f', 'f32le', '-'))
        expect(error.peak).toBeLessThan(0.06)
        expect(error.maxMillisecondRms).toBeLessThan(0.025)
    }, 240_000)

    it.skipIf(process.platform === 'win32')('resounds with an encoder that has no PNS control', async () => {
        const folder = await filmFolder()
        const movie = await built(folder)
        const picture = pictureHash(movie)
        const bin = join(folder, 'bin')
        await mkdir(bin)
        await writeFfmpegWithoutPns(join(bin, 'ffmpeg'))
        const result = spawnSync('uv', ['run', join(TOOLS, 'resound.py'), folder], {
            encoding: 'utf8', env: { ...process.env, ...QUIET, PATH: `${bin}:${process.env['PATH']}` },
        })
        expect(result.status, result.stderr).toBe(0)
        expect(pictureHash(movie)).toBe(picture)
        expect(JSON.parse(tool('probe', folder).stdout)).toMatchObject({ audio: { codec_name: 'aac', sample_rate: '48000', channels: 2 }, timing: { record: 'valid', differs: [] } })
    }, 240_000)

    it('gives each run of resound its own files, so that a run for the draft and one for the delivered movie do not meet', async () => {
        const folder = await filmFolder()
        const movie = await built(folder)
        const draft = await tinyMovie(folder, 8.5, 4, 'Tiny-Film-draft')
        await record(folder, draft)
        // The file that a run writes has a name of its own, beside the movie that it is for.
        const names = bare(['-c', 'import sys, pathlib, resound\nmovie = pathlib.Path(sys.argv[1])\na, b = resound.temporary(movie, ".resound.mp4"), resound.temporary(movie, ".resound.mp4")\nprint(a.name != b.name, a.parent == movie.parent, a.name.startswith(".Tiny-Film."), a.name.endswith(".resound.mp4"))\na.unlink(); b.unlink()', movie])
        expect(names.stdout.trim()).toBe('True True True True')
        // Both runs at once, as two terminals would start them.
        const run = (...args: string[]) => new Promise<{ status: number | null; stderr: string }>((done) => {
            const child = spawn('uv', ['run', join(TOOLS, 'resound.py'), folder, ...args], { env: { ...process.env, ...QUIET } })
            let stderr = ''
            child.stderr.on('data', (chunk) => { stderr += chunk })
            child.on('close', (status) => done({ status, stderr }))
        })
        const [delivered, drafted] = await Promise.all([run(), run('--draft')])
        expect(delivered.status, delivered.stderr).toBe(0)
        expect(drafted.status, drafted.stderr).toBe(0)
        // Each movie has its picture, its sound and its captions, and each run said so of the file that it checked.
        for (const [file, said] of [[movie, delivered.stderr], [draft, drafted.stderr]] as const) {
            expect(streamKinds(file)).toEqual(['audio', 'data', 'subtitle', 'video'])
            expect(JSON.parse(tool('probe', folder, file).stdout).duration_seconds).toBe(8.5)
            expect(saidBy('resound', said).at(-1)).toContain(`${basename(file)} has the new sound`)
        }
        expect((await readdir(join(folder, 'dist'))).filter((name) => name.startsWith('.'))).toEqual([])
    }, 240_000)

    it('refuses a sound of a timing that the picture was not rendered with, also when the film is as long as before', async () => {
        const folder = await filmFolder()
        const movie = await built(folder)
        const before = await readFile(movie)
        // Half a second of silence moves from after the close to after the hook: the film is as long, and the close starts later.
        const moved = structuredClone(TIMING)
        moved.scenes[0]!.beats[0]!.hold = 1.5
        moved.scenes[1]!.beats[0]!.hold = 1.5
        const script = structuredClone(SCRIPT)
        script.scenes[0]!.beats[0]!.hold = 1.5
        script.scenes[1]!.beats[0]!.hold = 1.5
        await writeFile(join(folder, 'timing.json'), JSON.stringify(moved))
        await writeFile(join(folder, 'script.json'), JSON.stringify(script))
        expect(tool('mix', folder).status).toBe(0)
        const length = (file: string) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout)
        expect(length(join(folder, 'narration.wav'))).toBeCloseTo(length(movie), 1)
        const refused = `the picture of Tiny-Film.mp4 was rendered with another timing than timing.json has now: close (starts at 4.00 s in the picture, and at 4.50 s in timing.json)`
        const resound = tool('resound', folder)
        expect(resound.status).not.toBe(0)
        expect(resound.said).toEqual([`resound: ${refused}. The voice moved, and the picture and the captions follow the voice, so the picture needs a new render: vizmatic narrated build ${folder}. The movie was not replaced`])
        expect((await readFile(movie)).equals(before)).toBe(true)
        // The sync step fails on this movie before it listens to it: the sound can be right when the picture is not.
        const sync = plain('sync', folder)
        expect(sync.status).not.toBe(0)
        expect(sync.said).toEqual([`sync: ${refused}. Its picture and its captions are not in step with the voice of this timing. Build it again: vizmatic narrated build ${folder}`])
        const probe = tool('probe', folder)
        expect(probe.status).not.toBe(0)
        expect(probe.said.join('\n')).toContain('Not as a narrated film is built: its picture was rendered with another timing than timing.json has now (close (starts at 4.00 s')
        expect((await readFile(movie)).equals(before)).toBe(true)
    }, 240_000)

    it('refuses a movie with no record that is valid for its picture: after a stop between the render and the record, and after the record is deleted', async () => {
        const folder = await filmFolder()
        // The hook has two beats. Half a second of silence can move from its second beat to its first, and no scene starts at another time.
        const [hook, close] = TIMING.scenes
        const two = { ...TIMING, scenes: [{ ...hook!, beats: [{ ...hook!.beats[0]!, hold: 0.5 }, { ...hook!.beats[0]!, wav: 'b.wav', duration: 1.5, hold: 0.5 }] }, close!] }
        const script = { ...SCRIPT, scenes: [{ ...SCRIPT.scenes[0]!, beats: [{ say: 'Will it run? Will it?', hold: 0.5 }, { say: 'Will it run? Will it?', hold: 0.5 }] }, SCRIPT.scenes[1]!] }
        const write = async (first: number, second: number) => {
            two.scenes[0]!.beats[0]!.hold = script.scenes[0]!.beats[0]!.hold = first
            two.scenes[0]!.beats[1]!.hold = script.scenes[0]!.beats[1]!.hold = second
            await writeFile(join(folder, 'timing.json'), JSON.stringify(two))
            await writeFile(join(folder, 'script.json'), JSON.stringify(script))
        }
        await twoTakes(folder)
        await write(0.5, 0.5)
        // The hook: 1.5 to 2.5, a hold, 3 to 4.5, a hold. The close starts at 5.5, and the film is 10 seconds long.
        expect(tool('mix', folder).status).toBe(0)
        const movie = await tinyMovie(folder, 10, 5.5)
        await record(folder, movie)
        expect(tool('resound', folder).status).toBe(0)

        // A new render that stops before its record: the new picture is beside the record of the old one.
        await tinyMovie(folder, 10, 5.5, 'Tiny-Film', 'smptebars')
        const before = await readFile(movie)
        // Then a hold moves by half a second inside the hook, and the voice and the mix are made again.
        // The scenes start where they started, so the chapters of the movie say nothing of the change.
        await write(1, 0)
        expect(tool('mix', folder).status).toBe(0)
        const stale = `Tiny-Film.mp4 has the record of another picture beside it, Tiny-Film.timing.json, so nothing says which timing its picture was rendered with. Build it again, with a full render: vizmatic narrated build ${folder}`
        const resound = tool('resound', folder)
        expect(resound.status).not.toBe(0)
        expect(resound.said).toEqual([`resound: ${stale}. The movie was not replaced`])
        const sync = plain('sync', folder)
        expect(sync.status).not.toBe(0)
        expect(sync.said).toEqual([`sync: ${stale}`])
        const probe = tool('probe', folder)
        expect(probe.status).not.toBe(0)
        expect(probe.said).toEqual([`probe: Tiny-Film.mp4: 320x180, 10.0 s, 2 chapters, 2 caption cues. ${stale}`])
        expect(JSON.parse(probe.stdout).timing).toEqual({ record: 'has the record of another picture beside it, Tiny-Film.timing.json', differs: [] })

        // The build deletes the old record before it renders, so a stop leaves no record. The same holds for a record that a person deleted.
        await rm(join(folder, 'dist', 'Tiny-Film.timing.json'))
        const none = `Tiny-Film.mp4 has no record of the timing of its picture, so nothing says which timing its picture was rendered with. Build it again, with a full render: vizmatic narrated build ${folder}`
        expect(tool('resound', folder).said).toEqual([`resound: ${none}. The movie was not replaced`])
        expect(plain('sync', folder).said).toEqual([`sync: ${none}`])
        expect(tool('probe', folder).said).toEqual([`probe: Tiny-Film.mp4: 320x180, 10.0 s, 2 chapters, 2 caption cues. ${none}`])
        // A record that is not whole is no record.
        await writeFile(join(folder, 'dist', 'Tiny-Film.timing.json'), '{ "picture": ')
        expect(tool('resound', folder).said.join('\n')).toContain('Tiny-Film.mp4 has a record of the timing of its picture, Tiny-Film.timing.json, that is not whole, so nothing says')
        // A record with the hash of this picture and a timing that is not a timing is not whole either, and no step shows a stack.
        await writeFile(join(folder, 'dist', 'Tiny-Film.timing.json'), JSON.stringify({ picture: pictureHash(movie).replace('MD5=', ''), timing: { scenes: [] } }))
        const broken = tool('resound', folder)
        expect(broken.stderr).not.toContain('Traceback')
        expect(broken.said).toEqual([`resound: Tiny-Film.mp4 has a record of the timing of its picture, Tiny-Film.timing.json, that is not whole, so nothing says which timing its picture was rendered with. Build it again, with a full render: vizmatic narrated build ${folder}. The movie was not replaced`])
        expect((await readFile(movie)).equals(before)).toBe(true)
        // The draft names the draft build.
        await writeFile(join(folder, 'dist', 'Tiny-Film-draft.mp4'), before)
        expect(tool('resound', folder, '--draft').said.join('\n')).toMatch(/Tiny-Film-draft\.mp4 has no record of the timing of its picture, .* vizmatic narrated build \S+ --draft\. The movie was not replaced$/)
    }, 300_000)

    it('names a change inside a scene, which the starts of the scenes do not show', () => {
        // The hook has two beats here: from 1.5 to 2.5 and from 3.5 to 4.5. The close starts at 5, and the film ends at 9.5.
        const [hook, close] = TIMING.scenes
        const picture = { ...TIMING, scenes: [{ ...hook!, beats: [hook!.beats[0]!, { ...hook!.beats[0]!, hold: 0 }] }, close!] }
        const changes = (change: (timing: typeof picture) => void) => {
            const sound = structuredClone(picture)
            change(sound)
            const result = bare(['-c', 'import json, sys, film; a, b = json.loads(sys.argv[1]); print(json.dumps(film.timeline_changes(a, b)))', JSON.stringify([picture, sound])])
            expect(result.status, result.stderr).toBe(0)
            return JSON.parse(result.stdout) as string[]
        }
        expect(changes(() => {})).toEqual([])
        expect(changes((timing) => { Object.assign(timing.scenes[0].beats[0], { cues: [{ id: 'result', phrase: 'it' }] }) })).toEqual(['hook/0 (the declared cues changed)'])
        // The first beat of the hook holds half a second longer: its second beat moves, and so does every scene after it.
        expect(changes((timing) => { timing.scenes[0]!.beats[0]!.hold = 1.5 })).toEqual([
            'hook/1 (from 3.50 to 4.50 s in the picture, from 4.00 to 5.00 s in timing.json)',
            'close (starts at 5.00 s in the picture, and at 5.50 s in timing.json)',
        ])
        // A take with the same length and other times of its words: a cue of the picture is on another word.
        expect(changes((timing) => { timing.scenes[1]!.beats[0]!.words[1]!.start = 0.5 })).toEqual(['close/0 (other words, or other times of its words)'])
        expect(changes((timing) => { timing.tail = 1 })).toEqual(['the end of the film (9.50 s in the picture, 10.00 s in timing.json)'])
        expect(changes((timing) => { timing.scenes[1]!.id = 'end' })).toEqual(['the scenes (hook, close in the picture, hook, end in timing.json)'])
    }, 60_000)

    it('stops when the new sound is not the mix of this timing, or not as long as the movie, and leaves the movie', async () => {
        const folder = await filmFolder()
        const movie = await built(folder)
        const before = await readFile(movie)
        const mixed = await readFile(join(folder, 'narration.wav'))
        // A sound that the mix step did not write: nothing says that it is the sound of this timing.
        ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=880:duration=8.5:sample_rate=48000', '-ac', '2', join(folder, 'narration.wav'))
        const unknown = tool('resound', folder)
        expect(unknown.status).not.toBe(0)
        expect(unknown.said).toEqual([`resound: narration.wav is not the file that the last mix wrote, so the sound is not known to be the sound of timing.json. Run the mix step first: vizmatic narrated mix ${folder}. The movie was not replaced`])
        await writeFile(join(folder, 'narration.wav'), mixed)
        // A movie of another length than the sound.
        await tinyMovie(folder, 6, 4, 'Tiny-Film-draft')
        const longer = tool('resound', folder, '--draft')
        expect(longer.status).not.toBe(0)
        expect(longer.said).toEqual([`resound: the movie is 6.00 s long and narration.wav is 8.50 s long. The timing of the voice changed, so the picture needs a new render: vizmatic narrated build ${folder}. The movie was not replaced`])
        expect((await readFile(movie)).equals(before)).toBe(true)
        await rm(join(folder, 'narration.wav'))
        expect(tool('resound', folder).said.join('\n')).toMatch(/^resound: narration\.wav is missing\. Run the mix step first: vizmatic narrated mix /)
    }, 240_000)

    it('replaces a movie inside the folder of the film only', async () => {
        const folder = await filmFolder()
        const movie = await built(folder)
        const outside = join(dirname(folder), `outside-${process.pid}.mp4`)
        tempDirs.push(outside)
        await writeFile(outside, await readFile(movie))
        const before = await readFile(outside)
        const resound = tool('resound', folder, outside)
        expect(resound.status).not.toBe(0)
        expect(resound.said.join('\n')).toMatch(/^resound: .*outside-\d+\.mp4 is outside the folder of the film, and a step writes only inside that folder\. Copy the movie into .*\/dist, or run the step in the folder of that movie$/)
        expect((await readFile(outside)).equals(before)).toBe(true)
        // A step that only reads a movie takes one from any place: the probe prints what that movie is, and says that it has no record.
        const probe = tool('probe', folder, outside)
        expect(JSON.parse(probe.stdout)).toMatchObject({ duration_seconds: 8.5, timing: { record: 'has no record of the timing of its picture' } })
        expect(probe.status).not.toBe(0)
    }, 240_000)

    it('keeps a chapter of more than 44 seconds, which a copy of the picture alone would break', async () => {
        const folder = await filmFolder()
        // The hook holds for 43 seconds, so the close starts at 46, and the film is 50 seconds long.
        const long = structuredClone(TIMING), script = structuredClone(SCRIPT)
        long.scenes[0]!.beats[0]!.hold = script.scenes[0]!.beats[0]!.hold = 43
        long.scenes[1]!.beats[0]!.hold = script.scenes[1]!.beats[0]!.hold = 1.5
        await twoTakes(folder)
        await writeFile(join(folder, 'timing.json'), JSON.stringify(long))
        await writeFile(join(folder, 'script.json'), JSON.stringify(script))
        expect(tool('mix', folder).status).toBe(0)
        const movie = await tinyMovie(folder, 50, 46)
        await record(folder, movie)
        const resound = tool('resound', folder)
        expect(resound.status, resound.stderr).toBe(0)
        const chapters = JSON.parse(tool('probe', folder).stdout).chapters
        expect(chapters).toEqual([{ start: 0, title: 'One' }, { start: 46, title: 'Two\\ and = more' }])
        // The chapter track, which a player reads, has both entries too.
        const track = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'd:0', '-show_entries', 'stream=nb_frames', '-of', 'csv=p=0', movie], { encoding: 'utf8' }).stdout.trim()
        expect(track).toBe('2')
    }, 240_000)

    it('sets the time scale of the movie to one millisecond, with an option that an old FFmpeg does not have and does not need', async () => {
        const folder = await filmFolder()
        const option = (path?: string) => {
            const result = bare(['-c', 'import json, resound; print(json.dumps(resound.millisecond_scale()))'], path ? { PATH: path } : {})
            expect(result.status, result.stderr).toBe(0)
            return JSON.parse(result.stdout) as string[]
        }
        // The FFmpeg of this machine has the option. Without it, FFmpeg 7 and later break a chapter of more than 44 seconds.
        expect(option()).toEqual(['-movie_timescale', '1000'])
        // An FFmpeg whose MP4 muxer lists no such option: version 4, which writes one millisecond always.
        const bin = join(folder, 'bin')
        await mkdir(bin)
        await writeFile(join(bin, 'ffmpeg'), '#!/bin/bash\necho "Muxer mp4 [MP4 (MPEG-4 Part 14)]:"\necho "  -movflags          <flags>      E.......... MOV muxer flags (default 0)"\n', { mode: 0o755 })
        expect(option(`${bin}:${process.env['PATH']}`)).toEqual([])
    }, 60_000)

    it('checks the new movie against the old one before the rename: its streams, its length, its chapters and its picture', () => {
        const movie = (change: Record<string, unknown> = {}) => ({
            streams: [{ codec_type: 'video' }, { codec_type: 'audio' }, { codec_type: 'subtitle' }, { codec_type: 'data' }],
            format: { duration: '8.500000' },
            chapters: [{ start_time: '0.000000', tags: { title: 'One' } }, { start_time: '4.000000', tags: { title: 'Two' } }],
            ...change,
        })
        const defects = (after: unknown, picture = 'same', track = 2) => {
            const result = bare(['-c', 'import json, sys, resound; before, after, picture, track = json.loads(sys.argv[1]); print(json.dumps(resound.defects(before, after, "same", picture, track)))', JSON.stringify([movie(), after, picture, track])])
            expect(result.status, result.stderr).toBe(0)
            return JSON.parse(result.stdout) as string[]
        }
        expect(defects(movie())).toEqual([])
        // What two runs in one file left behind: a movie with no stream at all.
        expect(defects({ streams: [], format: {}, chapters: [] })).toEqual([
            'it has 0 video streams, and the movie has 1', 'it has 0 subtitle streams, and the movie has 1', 'it has 0 sound streams, and a movie has 1',
            'it is 0.00 s long, and the movie is 8.50 s long', 'it has 0 chapters, and the movie has 2',
        ])
        expect(defects(movie({ chapters: [{ start_time: '0.000000', tags: { title: 'One' } }] }))).toEqual(['it has 1 chapters, and the movie has 2'])
        expect(defects(movie({ chapters: [{ start_time: '0.000000', tags: { title: 'One' } }, { start_time: '4.500000', tags: { title: 'Two' } }] }))).toEqual(['it has 2 chapters, and the movie has 2'])
        // The chapter track of the file, which a player reads, can have fewer entries than the list of chapters.
        expect(defects(movie(), 'same', 1)).toEqual(['it has 1 chapters, and the movie has 2'])
        expect(defects(movie({ format: { duration: '8.300000' } }))).toEqual(['it is 8.30 s long, and the movie is 8.50 s long'])
        expect(defects(movie({ streams: [{ codec_type: 'video' }, { codec_type: 'subtitle' }] }))).toEqual(['it has 0 sound streams, and a movie has 1'])
        expect(defects(movie(), 'other')).toEqual(['its picture is not the picture of the movie'])
    }, 60_000)

    it('leaves the movie when the new movie is not right, and does not say that it has the new sound', async () => {
        const folder = await filmFolder()
        const movie = await built(folder)
        const before = await readFile(movie)
        // An FFmpeg that writes the new movie without its chapters, as a broken build of FFmpeg could. Every other call is the real one.
        const bin = join(folder, 'bin')
        await mkdir(bin)
        const real = spawnSync('which', ['ffmpeg'], { encoding: 'utf8' }).stdout.trim()
        await writeFile(join(bin, 'ffmpeg'), `#!/bin/bash\nargs=("$@")\nfor i in "\${!args[@]}"; do if [[ "\${args[$i]}" == "-map_chapters" ]]; then args[$((i+1))]="-1"; fi; done\nexec "${real}" "\${args[@]}"\n`, { mode: 0o755 })
        const result = spawnSync('uv', ['run', join(TOOLS, 'resound.py'), folder], { encoding: 'utf8', env: { ...process.env, ...QUIET, PATH: `${bin}:${process.env['PATH']}` } })
        expect(result.status).not.toBe(0)
        expect(saidBy('resound', result.stderr)).toEqual(['resound: the movie with the new sound is not right: it has 0 chapters, and the movie has 2. Tiny-Film.mp4 was not replaced'])
        expect((await readFile(movie)).equals(before)).toBe(true)
        // The file of the run is gone too.
        expect((await readdir(join(folder, 'dist'))).sort()).toEqual(['Tiny-Film.mp4', 'Tiny-Film.timing.json'])
    }, 240_000)

    it('counts a beat as away when it is heard more than two seconds from its place, or not at all', () => {
        const away = (offsets: Record<string, number | null>) => {
            const result = bare(['-c', 'import json, sys, sync; print(json.dumps(sync.away(json.loads(sys.argv[1]))))', JSON.stringify(offsets)])
            expect(result.status, result.stderr).toBe(0)
            return JSON.parse(result.stdout) as string[]
        }
        // A transcript gives the time of a word to about a second. Two seconds is the limit, on both sides.
        expect(away({ 'hook/0': 0.4, 'hook/1': -1.9, 'close/0': 2.1, 'close/1': -2.5, 'close/2': null })).toEqual(['close/0', 'close/1', 'close/2'])
        expect(away({ 'hook/0': 2 })).toEqual([])
        // Where each beat is heard: the first word of the beat, within three seconds of its place.
        const offsets = bare(['-c', 'import json, sys, film, sync; timing, heard = json.loads(sys.argv[1]); print(json.dumps(sync.offsets(film.place(timing), [tuple(word) for word in heard])))', JSON.stringify([TIMING, [['will', 1.6], ['it', 1.8], ['have', 6.5]]])])
        expect(offsets.status, offsets.stderr).toBe(0)
        // The hook starts at 1.5 and its first word 0.1 later. The close starts at 4, and its first word is heard 2.4 seconds late.
        const found = JSON.parse(offsets.stdout)
        expect(found['hook/0']).toBeCloseTo(0, 6)
        expect(found['close/0']).toBeCloseTo(2.4, 6)
        expect(away(found)).toEqual(['close/0'])
    }, 60_000)
})

