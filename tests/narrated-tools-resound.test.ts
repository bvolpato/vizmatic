import { spawn, spawnSync } from "child_process"
import { mkdir, readFile, readdir, writeFile } from "fs/promises"
import { basename, join } from "path"
import { describe, expect, it } from "vitest"
import { aacWaveformError, syntheticAacFixture, writeFfmpegWithoutPns } from "./aac-fixture"
import { QUIET, SCRIPT, TIMING, TOOLS, bare, barePython, built, ffmpeg, filmFolder, pictureHash, plain, ready, record, saidBy, streamKinds, tinyMovie, tool } from "./narrated-tools-support"

describe.skipIf(!ready)("narration tools: resound", () => {
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
        const rec = bare(['-c', 'import sys, pathlib, film; film.write_mix_record(film.open_film(pathlib.Path(sys.argv[1]), "resound"))', folder])
        expect(rec.status, rec.stderr).toBe(0)
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
        const py = barePython()
        const result = py
            ? spawnSync(py, ['-B', join(TOOLS, 'resound.py'), folder], {
                encoding: 'utf8', env: { ...process.env, ...QUIET, PYTHONPATH: TOOLS, PATH: `${bin}:${process.env['PATH']}` },
            })
            : spawnSync('uv', ['run', join(TOOLS, 'resound.py'), folder], {
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
        const py = barePython()
        const run = (...args: string[]) => new Promise<{ status: number | null; stderr: string }>((done) => {
            const child = py
                ? spawn(py, ['-B', join(TOOLS, 'resound.py'), folder, ...args], { env: { ...process.env, ...QUIET, PYTHONPATH: TOOLS } })
                : spawn('uv', ['run', join(TOOLS, 'resound.py'), folder, ...args], { env: { ...process.env, ...QUIET } })
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
})
