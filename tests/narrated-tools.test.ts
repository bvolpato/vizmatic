import { spawn, spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { aacWaveformError, syntheticAacFixture, writeFfmpegWithoutPns } from './aac-fixture'

// The sound tools are Python scripts that uv runs. These tests need uv and FFmpeg, and no voice model.
const has = (command: string, flag: string) => spawnSync(command, [flag], { encoding: 'utf8' }).status === 0
const ready = has('uv', '--version') && has('ffmpeg', '-version') && has('ffprobe', '-version')
const TOOLS = resolve('tools/narration')
const QUIET = { PYTHONDONTWRITEBYTECODE: '1' }
const tempDirs: string[] = []

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function filmFolder(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'vizmatic-tools-'))
    tempDirs.push(directory)
    return directory
}

/**
 * The lines that a tool wrote on the error stream: each one starts with the name of the tool. uv writes there
 * too, such as "Installed 27 packages" when it first makes the environment of a tool, and a test must not
 * depend on that.
 */
const saidBy = (name: string, stderr: string) => stderr.split('\n').filter((line) => line.startsWith(`${name}: `))

function tool(name: string, folder: string, ...args: string[]) {
    const result = spawnSync('uv', ['run', join(TOOLS, `${name}.py`), folder, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...QUIET } })
    return { ...result, said: saidBy(name, result.stderr) }
}

/** Run the public command with the source CLI, without building or rendering a film. */
function narratedMix(folder: string) {
    return spawnSync(process.execPath, ['--import', `file://${resolve('node_modules/tsx/dist/loader.mjs')}`, resolve('src/cli.ts'), 'narrated', 'mix', folder], {
        encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...QUIET },
    })
}

/** Run a tool with the standard library alone: the path of a step that needs no package, and no model. */
function bare(args: string[], env: NodeJS.ProcessEnv = {}) {
    return spawnSync('uv', ['run', '--no-project', '--python', '3.12', 'python', ...args], { encoding: 'utf8', env: { ...process.env, ...QUIET, PYTHONPATH: TOOLS, ...env } })
}

/** A tool with the standard library alone, by its name: for the path of a tool that ends before it needs a package. */
function plain(name: string, folder: string, ...args: string[]) {
    const result = bare([join(TOOLS, `${name}.py`), folder, ...args])
    return { ...result, said: saidBy(name, result.stderr) }
}

function ffmpeg(...args: string[]) {
    const result = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(result.stderr.toString())
    return result.stdout
}

/** The loudness of one second-range of a sound file, as the root mean square of its samples, from 0 to 1. */
function loudness(path: string, from: number, to: number): number {
    const raw = ffmpeg('-ss', String(from), '-t', String(to - from), '-i', path, '-ac', '1', '-f', 's16le', '-')
    const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2))
    return Math.sqrt(samples.reduce((sum, sample) => sum + (sample / 32768) ** 2, 0) / Math.max(1, samples.length))
}

/** Read both channels without changing the gain, for comparisons before the loudness pass. */
function audioSamples(path: string): Float32Array {
    const raw = ffmpeg('-i', path, '-c:a', 'pcm_f32le', '-f', 'f32le', '-')
    return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}

function differencePeak(a: Float32Array, b: Float32Array, from: number, to: number): number {
    let peak = 0
    for (let i = Math.floor(from * 48000) * 2; i < Math.min(a.length, Math.floor(to * 48000) * 2); i++) peak = Math.max(peak, Math.abs(a[i]! - b[i]!))
    return peak
}

const word = (text: string, start: number) => ({ text, start, end: start + 0.2 })
const SCRIPT = {
    timeline: { intro: 1, pause: 0.5, gap: 0.5, tail: 0.5 },
    scenes: [
        { id: 'hook', title: 'Hook', beats: [{ say: 'Will it run? Will it?', hold: 1 }] },
        { id: 'close', title: 'Close', beats: [{ say: 'Have a plan.', hold: 2 }] },
    ],
}
/** The timing that the voice step writes for SCRIPT, with two takes of a tone: 1 second and 1.5 seconds long. */
const TIMING = {
    voice: 'af_heart', speed: 1.12, intro: 1, lead: 1.5, gap: 0.5, tail: 0.5,
    scenes: [
        { id: 'hook', title: 'Hook', beats: [{ wav: 'a.wav', say: 'Will it run? Will it?', text: 'Will it run? Will it?', duration: 1, hold: 1, words: [word('Will', 0.1), word('it', 0.3), word('run?', 0.5), word('Will', 0.6), word('it?', 0.7)] }] },
        { id: 'close', title: 'Close', beats: [{ wav: 'b.wav', say: 'Have a plan.', text: 'Have a plan.', duration: 1.5, hold: 2, words: [word('Have', 0.1), word('a', 0.4), word('plan', 0.6)] }] },
    ],
}

/** A film folder with a script, its timing, and two takes of a tone. `film` is the content of film.json. */
async function twoTakes(folder: string, film: unknown = { output: 'Tiny-Film', mix: { seed: 3 } }) {
    await rm(join(folder, 'audio'), { recursive: true, force: true })
    await mkdir(join(folder, 'audio'))
    ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=220:duration=1:sample_rate=24000', join(folder, 'audio', 'a.wav'))
    ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=330:duration=1.5:sample_rate=24000', join(folder, 'audio', 'b.wav'))
    await writeFile(join(folder, 'film.ts'), '// The film file. These tests do not render it.\n')
    await writeFile(join(folder, 'film.json'), JSON.stringify(film))
    await writeFile(join(folder, 'script.json'), JSON.stringify(SCRIPT))
    await writeFile(join(folder, 'timing.json'), JSON.stringify(TIMING))
}

/**
 * A tiny movie with a title, two chapters, two captions and a tone at 48 kHz, as dist/Tiny-Film.mp4. Its
 * length and the start of its second chapter are those of TIMING: 8.5 seconds, and the close at 4. FFmpeg
 * 7 and later break the chapter track of an MP4 with captions and a chapter of more than 44 seconds, because
 * the chapter track counts in a time scale of 48,000,000. So the movie gets its chapters in a second pass
 * that sets the time scale of the movie to one millisecond, which every FFmpeg from version 5 has.
 */
async function tinyMovie(folder: string, seconds = 8.5, split = 4, name = 'Tiny-Film', picture = 'testsrc'): Promise<string> {
    await mkdir(join(folder, 'dist'), { recursive: true })
    const ms = (value: number) => Math.round(value * 1000)
    await writeFile(join(folder, 'chapters.txt'), `;FFMETADATA1\ntitle=A tiny film\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=${ms(split)}\ntitle=One\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${ms(split)}\nEND=${ms(seconds)}\ntitle=Two\\\\ and \\= more\n`)
    await writeFile(join(folder, 'captions.srt'), '1\n00:00:00,100 --> 00:00:00,900\nFirst line\n\n2\n00:00:01,100 --> 00:00:01,900\nSecond line\n')
    const encoded = join(folder, `encoded-${name}.mp4`), movie = join(folder, 'dist', `${name}.mp4`)
    ffmpeg('-f', 'lavfi', '-i', `${picture}=size=320x180:rate=30:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}:sample_rate=48000`, '-i', join(folder, 'captions.srt'),
        '-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text', encoded)
    ffmpeg('-i', encoded, '-f', 'ffmetadata', '-i', join(folder, 'chapters.txt'), '-map', '0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movie_timescale', '1000', movie)
    await rm(encoded)
    return movie
}

/** The record step, as the build runs it after a render: with the hash of timing.json as it was before the render. */
async function record(folder: string, movie: string) {
    const sha = createHash('sha256').update(await readFile(join(folder, 'timing.json'))).digest('hex')
    const result = tool('record', folder, movie, '--timing', sha)
    expect(result.status, result.stderr).toBe(0)
}

/** A folder as a build leaves it: the takes, the mix of them, the movie, and the timing of its picture beside it. */
async function built(folder: string, film?: unknown): Promise<string> {
    await twoTakes(folder, ...(film === undefined ? [] : [film]))
    const mix = tool('mix', folder)
    expect(mix.status, mix.stderr).toBe(0)
    const movie = await tinyMovie(folder)
    await record(folder, movie)
    return movie
}

/** The hash of the video packets of a movie. A new sound must not change it. */
const pictureHash = (movie: string) => ffmpeg('-i', movie, '-map', '0:v', '-c', 'copy', '-f', 'md5', '-').toString().trim()
const streamKinds = (movie: string) => spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', movie], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).sort()

describe.skipIf(!ready)('the checks of the files of a film', () => {
    it('prints one line for each mistake in script.json: the file, the field, what is wrong, what is allowed', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        await writeFile(join(folder, 'script.json'), JSON.stringify({
            title: 'A tiny film', timeline: { intro: -1, lead: 0.6 }, pronouce: {},
            scenes: [{ id: 'hook', beats: [{ hold: 'long' }, { say: 'Fine.', hlod: 1 }] }, { id: '../../x', title: 'Out', beats: [] }, { id: 'hook', title: 'Again', beats: [{ say: 'Twice.' }] }, { id: 'a/b', title: 'Inside', beats: [{ say: 'A folder.' }] }],
        }))
        const result = tool('verify', folder, '--step', 'voice')
        expect(result.status).not.toBe(0)
        expect(result.said).toEqual([
            'verify: script.json: title: no step reads this key. Remove it: the title of the film is in the film file, narrated({ title })',
            'verify: script.json: pronouce: unknown key. The keys are: pronounce, scenes, timeline',
            'verify: script.json: timeline.lead: this key has the name "pause" now. Rename it: "pause" is the silence between the title card and the first word, and "lead" is the time of the first word in timing.json',
            'verify: script.json: timeline.intro: -1 is not a time. Give seconds, 0 or more',
            'verify: script.json: scenes[0].title: is missing. Give the chapter title of the scene, such as "The slow page"',
            'verify: script.json: scenes[0].beats[0].say: is missing. Give the words that the voice says',
            'verify: script.json: scenes[0].beats[0].hold: "long" is not a time. Give the silence after the beat in seconds, 0 or more',
            'verify: script.json: scenes[0].beats[1].hlod: unknown key. The keys are: cues, hold, say',
            'verify: script.json: scenes[1].id: "../../x" is not an id. Give letters, digits and hyphens, such as "the-answer": the id goes into the names of files',
            'verify: script.json: scenes[1].beats: is missing or empty. Give a list with one beat or more, such as [{ "say": "One sentence." }]',
            'verify: script.json: scenes[2].id: "hook" is the id of two scenes. Give each scene its own id',
            // An id with a slash inside it would name a file in another folder.
            'verify: script.json: scenes[3].id: "a/b" is not an id. Give letters, digits and hyphens, such as "the-answer": the id goes into the names of files',
        ])
        // No stack of Python, for this script or for one that is not JSON, in any step.
        for (const step of ['voice', 'mix', 'beats', 'draft']) expect((step === 'mix' ? tool : plain)(step, folder).stderr).not.toContain('Traceback')
        await writeFile(join(folder, 'script.json'), '{ "scenes": [')
        expect(tool('beats', folder).said.join('\n')).toMatch(/^beats: script\.json: line 1: is not valid JSON \(.*\)\. Correct the file$/)
        await rm(join(folder, 'script.json'))
        expect(tool('beats', folder).said).toEqual(['beats: script.json: the file: is missing. It holds what the voice says, one entry for each scene and beat'])
    }, 180_000)

    it('prints one line for each mistake in a cue that script.json declares for a beat', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        // The hook says "Will it run? Will it?", and the close says "Have a plan."
        const said = async (hook: unknown, close?: unknown, more: object = {}) => {
            const scenes = [{ ...SCRIPT.scenes[0]!, beats: [{ ...SCRIPT.scenes[0]!.beats[0]!, cues: hook }] }, close === undefined ? SCRIPT.scenes[1]! : { ...SCRIPT.scenes[1]!, beats: [{ ...SCRIPT.scenes[1]!.beats[0]!, cues: close }] }]
            await writeFile(join(folder, 'script.json'), JSON.stringify({ ...SCRIPT, ...more, scenes }))
            return tool('verify', folder, '--step', 'voice').said.map((line) => line.replace('verify: script.json: scenes[0].beats[0].', ''))
        }
        const example = '[{ "id": "result", "phrase": "one hundred and sixty times" }]'
        // A cue has an id, a phrase of its beat, and data that the film may read. The same id in another scene is another cue.
        expect(await said([{ id: 'run', phrase: 'run', data: { color: 'red', targets: ['disk'] } }, { id: 'again', phrase: 'it run' }], [{ id: 'run', phrase: 'a plan' }])).toEqual(['verify: film.json and script.json are right.'])
        expect(await said('run')).toEqual([`cues: "run" is not a list. Give a list of cues, such as ${example}`])
        expect(await said(['run', { id: 'ok', phrase: 'run', color: 'red' }])).toEqual([
            `cues[0]: "run" is not an object. Give an id and a phrase, such as ${example}`,
            'cues[1].color: unknown key. The keys are: data, id, phrase',
        ])
        expect(await said([{ phrase: 'run' }, { id: 'a b', phrase: 'run' }, { id: 'ok' }, { id: 'sign', phrase: '%' }])).toEqual([
            'cues[0].id: is missing. Give the name that a scene uses for the cue, with letters, digits, hyphens and underscores, such as "result"',
            'cues[1].id: "a b" is not an id. Give the name that a scene uses for the cue, with letters, digits, hyphens and underscores, such as "result"',
            'cues[2].phrase: is missing. Give words of the beat that the voice says',
            'cues[3].phrase: "%" has no word. Give words of the beat that the voice says',
        ])
        // An id names one cue of its scene, a phrase is in its beat, and the beat says it one time.
        expect(await said([{ id: 'run', phrase: 'run' }, { id: 'run', phrase: 'it run' }, { id: 'out', phrase: 'run out' }, { id: 'twice', phrase: 'Will it' }])).toEqual([
            'cues[1].id: "run" is the id of two cues of the scene. Give each cue of a scene its own id',
            'cues[2].phrase: the beat does not say "run out". Give words of the beat, one after another. The beat is "Will it run? Will it?"',
            'cues[3].phrase: the beat says "Will it" 2 times. Give a longer phrase, which the beat says one time. The beat is "Will it run? Will it?"',
        ])
        // The film finds a cue in what the voice says, so a phrase is in the spoken form of the beat.
        expect(await said([{ id: 'run', phrase: 'run' }], undefined, { pronounce: { run: 'last' } })).toEqual(['cues[0].phrase: the beat does not say "run". Give words of the beat, one after another. The beat is "Will it run? Will it?", which the voice says as "Will it last? Will it?"'])
        expect(await said([{ id: 'run', phrase: 'it LAST' }], undefined, { pronounce: { run: 'last' } })).toEqual(['verify: film.json and script.json are right.'])
    }, 180_000)

    it('asks for a new voice when the cues of a beat changed, and drafts a timing with the cues of each beat', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        const cues = [{ id: 'run', phrase: 'run', data: { color: 'red' } }]
        const withCues = (list: unknown) => JSON.stringify({ ...SCRIPT, scenes: [{ ...SCRIPT.scenes[0]!, beats: [{ ...SCRIPT.scenes[0]!.beats[0]!, cues: list }] }, SCRIPT.scenes[1]!] })
        // The timing of the two takes is from a script with no cue.
        await writeFile(join(folder, 'script.json'), withCues(cues))
        expect(tool('verify', folder, '--step', 'beats').said).toEqual([`verify: timing.json: the script: changed after the voice was made: hook/0 (the cues). Run: vizmatic narrated voice ${folder}`])
        // An empty list of cues is a beat with no cue: the timing stays current.
        await writeFile(join(folder, 'script.json'), withCues([]))
        expect(tool('verify', folder, '--step', 'beats').status).toBe(0)
        // The draft step writes the cues of each beat beside the words of the beat.
        await writeFile(join(folder, 'script.json'), withCues(cues))
        await rm(join(folder, 'timing.json'))
        expect(tool('draft', folder).status).toBe(0)
        const timing = JSON.parse(await readFile(join(folder, 'timing.json'), 'utf8'))
        expect(timing.scenes[0].beats[0].cues).toEqual(cues)
        expect('cues' in timing.scenes[1].beats[0]).toBe(false)
        expect(tool('verify', folder, '--step', 'check').status).toBe(0)
        // Another phrase for a cue is another timing.
        await writeFile(join(folder, 'script.json'), withCues([{ id: 'run', phrase: 'it run' }]))
        expect(tool('verify', folder, '--step', 'check').said.join('\n')).toContain('hook/0 (the cues)')
        await writeFile(join(folder, 'script.json'), withCues([{ id: 'run', phrase: 'run', data: false }]))
        expect(tool('draft', folder).status).toBe(0)
        await writeFile(join(folder, 'script.json'), withCues([{ id: 'run', phrase: 'run', data: 0 }]))
        expect(tool('verify', folder, '--step', 'check').said.join('\n')).toContain('hook/0 (the cues)')
    }, 180_000)

    it('prints one line for each mistake in film.json, and no step writes outside the folder', async () => {
        const folder = await filmFolder()
        await twoTakes(folder, {
            entry: '../film.ts', output: 'dist/My Film', look: 'sepia', outptu: 'x', voice: { name: 'nobody', speed: 9, pitch: 1 }, check: '--motion', render: { workers: 0 }, before: ['uv run x'],
            mix: { seed: 'seven', levels: { under: 3 }, swells: [{ width: -1 }], chimes: [{ at: 1, scene: 'hook', gain: 'loud', gian: 1 }, 'bell'] },
        })
        const result = spawnSync('uv', ['run', join(TOOLS, 'verify.py'), folder], { encoding: 'utf8', env: { ...process.env, ...QUIET, VIZMATIC_LOOKS: 'midnight,paper' } })
        expect(result.status).not.toBe(0)
        expect(saidBy('verify', result.stderr)).toEqual([
            'verify: film.json: outptu: unknown key. The keys are: before, check, entry, look, mix, output, render, voice',
            'verify: film.json: entry: "../film.ts" is not a file of the folder. Give the film file, such as "film.ts"',
            'verify: film.json: output: "dist/My Film" is not a name for a movie. Give letters, digits, hyphens, dots and underscores, without a folder and without .mp4, such as "My-Film"',
            'verify: film.json: look: "sepia" is not a look. The looks are: midnight, paper',
            'verify: film.json: voice.pitch: unknown key. The keys are: name, speed',
            'verify: film.json: voice.name: "nobody" is not a voice of the voice step. Give a Kokoro voice of American English: its name starts with "af_" or "am_", such as "af_heart"',
            'verify: film.json: voice.speed: 9 is not a speed. Give a number from 0.5 to 2, such as 1.12',
            'verify: film.json: check: is not a list of words. Give options of the check, such as ["--text-margin", "30"]',
            'verify: film.json: render.workers: 0 is not a number of threads. Give a whole number over 0',
            'verify: film.json: before: is not a list of commands. Give each command as a list of words, such as [["uv", "run", "data/make_numbers.py"]]',
            'verify: film.json: mix.seed: "seven" is not a seed. Give a whole number, 0 or more, such as 7',
            'verify: film.json: mix.levels.under: 3 is not a level. Give decibels under the voice, 0 or less, such as -22',
            'verify: film.json: mix.swells[0]: has no time. Give one of "at", "intro" and "scene"',
            'verify: film.json: mix.swells[0].width: -1 is not allowed. Give seconds, more than 0',
            'verify: film.json: mix.chimes[0].gian: unknown key. The keys are: at, beat, edge, full, gain, intro, last, notes, offset, scene, until, word',
            'verify: film.json: mix.chimes[0]: has at and scene. Give one of "at", "intro" and "scene"',
            'verify: film.json: mix.chimes[0].gain: "loud" is not allowed. Give a number over 0, such as 0.11',
            'verify: film.json: mix.chimes[1]: "bell" is not an object. Give a time, such as { "scene": "hook", "beat": 0 }',
        ])
        expect(tool('mix', folder).stderr).not.toContain('Traceback')
        expect(existsSync(join(dirname(folder), 'film.ts'))).toBe(false)
        // A name with a folder in it, and nothing else wrong: a movie would be written into that folder.
        await twoTakes(folder, { output: 'sub/My-Film' })
        expect(tool('verify', folder).said).toEqual(['verify: film.json: output: "sub/My-Film" is not a name for a movie. Give letters, digits, hyphens, dots and underscores, without a folder and without .mp4, such as "My-Film"'])
        // The draft of a film has its name and "-draft". A film with that name would deliver a movie that passes for a draft.
        await twoTakes(folder, { output: 'My-Film-draft' })
        expect(tool('verify', folder).said).toEqual(['verify: film.json: output: "My-Film-draft" ends in "-draft", which is the name of the draft of a film. Give the name of the delivered movie, such as "My-Film"'])
        await twoTakes(folder, { output: 'My-Film-drafts' })
        expect(tool('verify', folder).status).toBe(0)
    }, 180_000)

    it('gives the particulars of a film with their defaults, for the command line', async () => {
        const folder = await filmFolder()
        await twoTakes(folder, {})
        expect(JSON.parse(tool('verify', folder, '--step', 'check', '--json').stdout)).toMatchObject({ entry: 'film.ts', output: 'film', look: 'midnight', check: [], render: { workers: 6, draftWorkers: 3 }, before: [] })
        await writeFile(join(folder, 'toto.ts'), '')
        await writeFile(join(folder, 'film.json'), JSON.stringify({ entry: 'toto.ts', look: 'paper', check: ['--text-margin', '30'], render: { workers: 10 }, before: [['uv', 'run', 'x.py']] }))
        expect(JSON.parse(tool('verify', folder, '--step', 'check', '--json').stdout)).toMatchObject({ entry: 'toto.ts', output: 'toto', look: 'paper', check: ['--text-margin', '30'], render: { workers: 10, draftWorkers: 3 }, before: [['uv', 'run', 'x.py']] })
        // A folder with no film.json is a film with every default.
        await rm(join(folder, 'film.json'))
        expect(JSON.parse(tool('verify', folder, '--step', 'check', '--json').stdout).output).toBe('film')
    }, 120_000)

    it('checks effect sources and their anchors with bare Python before any audio work', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        const tone = await readFile(join(folder, 'audio', 'a.wav'))
        await writeFile(join(folder, 'tone.wav'), tone)
        const outside = join(await filmFolder(), 'voice.wav')
        await writeFile(outside, tone)
        await symlink(outside, join(folder, 'linked.wav'))
        await writeFile(join(folder, 'asset.wav'), tone)
        await mkdir(join(folder, 'stills'))
        await symlink('../asset.wav', join(folder, 'stills', 'mix-raw.wav'))
        const invalid: [unknown, string][] = [
            [null, 'mix.effects'],
            [[{ sound: 'gong', at: 0 }], 'mix.effects[0].sound'],
            [[{ at: 0 }], 'mix.effects[0]'],
            [[{ sound: 'tap', wav: 'tone.wav', at: 0 }], 'mix.effects[0]'],
            [[{ wav: outside, at: 0 }], 'mix.effects[0].wav'],
            [[{ wav: 'linked.wav', at: 0 }], 'mix.effects[0].wav'],
            [[{ wav: 'asset.wav', at: 0 }], 'is also the mix output stills/mix-raw.wav'],
            [[{ wav: '../outside.wav', at: 0 }], 'mix.effects[0].wav'],
            [[{ wav: 'missing.wav', at: 0 }], 'mix.effects[0].wav'],
            [[{ sound: 'tap' }], 'mix.effects[0]: has no time'],
            [[{ sound: 'tap', at: 0, intro: 0.5 }], 'mix.effects[0]: has at and intro'],
            [[{ sound: 'tap', at: 0, gain: 0 }], 'mix.effects[0].gain'],
            [[{ sound: 'tap', at: 0, beat: 1 }], 'mix.effects[0].beat: needs "scene"'],
            [[{ sound: 'tap', at: 0, until: { at: 1, word: 'run' } }], 'mix.effects[0].until.word: needs "scene"'],
            [[{ sound: 'tap', at: 0, notes: [440] }], 'mix.effects[0].notes: unknown key'],
        ]
        for (const [effects, field] of invalid) {
            await writeFile(join(folder, 'film.json'), JSON.stringify({ mix: { effects } }))
            const result = plain('verify', folder, '--step', 'mix')
            expect(result.status, result.stderr).not.toBe(0)
            expect(result.stderr).toContain(field)
            expect(result.stderr).not.toContain('Traceback')
        }
        await writeFile(join(folder, 'film.json'), JSON.stringify({ mix: { chimes: [], effects: [] } }))
        const conflict = narratedMix(folder)
        expect(conflict.status, conflict.stderr).not.toBe(0)
        expect(conflict.stderr).toContain('mix: has both "chimes" and "effects"')
        expect(existsSync(join(folder, 'narration.wav'))).toBe(false)
        expect((await readFile(join(folder, 'asset.wav'))).equals(tone)).toBe(true)
        expect(existsSync(join(folder, 'audio', 'mix.json'))).toBe(false)
    }, 180_000)

    it('stops every step that reads the timing when the script changed after the voice was made', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        expect(tool('verify', folder, '--step', 'mix').said).toEqual(['verify: film.json and script.json are right, and the timing is current.'])
        const changed = structuredClone(SCRIPT) as typeof SCRIPT & { pronounce?: Record<string, string> }
        changed.scenes[0]!.beats[0]!.say = 'Will it run out? Will it?'
        changed.scenes[1]!.beats[0]!.hold = 3
        await writeFile(join(folder, 'script.json'), JSON.stringify(changed))
        const stale = 'timing.json: the script: changed after the voice was made: hook/0 (the text), close/0 (the hold). Run: vizmatic narrated voice'
        for (const step of ['mix', 'beats', 'transcribe', 'sync', 'lag', 'resound']) {
            // The mix needs its packages to start. The other steps check the files before they need one.
            const result = (step === 'mix' ? tool : plain)(step, folder)
            expect(result.status, step).not.toBe(0)
            expect(result.said, step).toEqual([`${step}: ${stale} ${folder}`])
        }
        for (const step of ['check', 'stills', 'sheet']) expect(tool('verify', folder, '--step', step).said).toEqual([`verify: ${stale} ${folder}`])
        // The steps that make the voice again, and the build that starts with them, go on.
        for (const step of ['voice', 'draft', 'build']) expect(tool('verify', folder, '--step', step).status, step).toBe(0)
        expect(existsSync(join(folder, 'narration.wav'))).toBe(false)
    }, 240_000)

    it('names each other change of what the voice was made from: the voice, the times, a title, a scene, the spoken form', async () => {
        const folder = await filmFolder()
        const stale = async (script: unknown, film: unknown = {}) => {
            await twoTakes(folder, film)
            await writeFile(join(folder, 'script.json'), JSON.stringify(script))
            return tool('verify', folder, '--step', 'beats').said.join('\n').replace(/^verify: timing\.json: the script: changed after the voice was made: /, '').replace(/\. Run: .*$/, '')
        }
        expect(await stale(SCRIPT, { voice: { name: 'am_adam', speed: 1 } })).toBe('voice (am_adam now, af_heart in the timing), speed (1.0 now, 1.12 in the timing)')
        expect(await stale({ ...SCRIPT, timeline: { ...SCRIPT.timeline, pause: 1, gap: 0.4 } })).toBe('lead (2 now, 1.5 in the timing), gap (0.4 now, 0.5 in the timing)')
        expect(await stale({ ...SCRIPT, scenes: [{ ...SCRIPT.scenes[0]!, title: 'The question' }, SCRIPT.scenes[1]!] })).toBe('hook (the title)')
        expect(await stale({ ...SCRIPT, scenes: [...SCRIPT.scenes, { id: 'after', title: 'After', beats: [{ say: 'More.' }] }] })).toBe('the scenes (hook, close, after now, hook, close in the timing)')
        expect(await stale({ ...SCRIPT, scenes: [{ ...SCRIPT.scenes[0]!, beats: [...SCRIPT.scenes[0]!.beats, { say: 'One more.' }] }, SCRIPT.scenes[1]!] })).toBe('hook (2 beats now, 1 in the timing)')
        // The pronounce map changes what the voice says, and not what the script writes.
        expect(await stale({ ...SCRIPT, pronounce: { plan: 'plane' } })).toBe('close/0 (the spoken form)')
        // A pronounce entry that no beat uses changes nothing, and the timing stays current.
        expect(await stale({ ...SCRIPT, pronounce: { GPU: 'G P U' } })).toBe('verify: film.json and script.json are right, and the timing is current.')
    }, 240_000)

    it('names a program that is not installed, in one line', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        // A path with uv and nothing else: no ffmpeg and no ffprobe.
        const bin = join(folder, 'bin')
        await mkdir(bin)
        const uv = spawnSync('which', ['uv'], { encoding: 'utf8' }).stdout.trim()
        await symlink(uv, join(bin, 'uv'))
        const run = (name: string) => {
            const result = spawnSync(join(bin, 'uv'), ['run', join(TOOLS, `${name}.py`), folder], { encoding: 'utf8', env: { ...process.env, ...QUIET, PATH: bin } })
            return { ...result, said: saidBy(name, result.stderr) }
        }
        expect(run('probe').said).toEqual([
            'probe: this machine: ffprobe: is not installed. The probe step needs it. It comes with FFmpeg',
            'probe: this machine: ffmpeg: is not installed. The probe step needs it. It comes with FFmpeg',
        ])
        expect(run('mix').said).toEqual(['mix: this machine: ffmpeg: is not installed. The mix step needs it. It comes with FFmpeg'])
        expect(run('beats').status).toBe(0)
    }, 120_000)

    it('refuses an option that a tool does not have, and a word that it does not take', async () => {
        const folder = await filmFolder()
        await twoTakes(folder)
        expect(tool('beats', folder, '--wrods', 'hook').said).toEqual(['beats: unknown option --wrods. The options of this step are: --words'])
        // The voice step makes the whole film: a voice of one scene had a file that no step read.
        expect(plain('voice', folder, '--scene', 'hook').said).toEqual(['voice: unknown option --scene. The options of this step are: none'])
        expect(tool('record', folder, 'dist/x.mp4', '--timing').said).toEqual(['record: --timing needs a value'])
        expect(tool('mix', folder, '--seed', '3').said).toEqual(['mix: unknown option --seed. The options of this step are: none'])
        expect(tool('mix', folder, 'hook').said).toEqual(['mix: "hook" is one word too many: this step takes the folder and no other word. Its options are: none'])
    }, 120_000)
})

describe.skipIf(!ready)('the voice step, without the voice model', () => {
    const takeKey = (text: string, voice = 'af_heart', speed = '1.12') => createHash('sha1').update(`${voice}|${speed}|${text}`).digest('hex').slice(0, 12)
    const script = {
        timeline: { intro: 2, pause: 0.6, gap: 0.4, tail: 0.5 },
        scenes: [
            { id: 'hook', title: 'Hook', beats: [{ say: 'A page takes 800 milliseconds.' }, { say: 'Why build it again?', hold: 1.5 }] },
            { id: 'close', title: 'Close', beats: [{ say: 'Keep the answer.' }] },
        ],
        pronounce: { '800': 'eight hundred' },
    }
    const spoken = ['A page takes eight hundred milliseconds.', 'Why build it again?', 'Keep the answer.']
    const places = ['hook-0', 'hook-1', 'close-0']
    const aligned = (text: string) => text.split(/\s+/).map((token, at) => word(token, 0.1 + at * 0.25))

    /** A folder with the script and the three takes on the disk, as a run of the voice step left them. */
    async function withTakes(folder: string, film: unknown = {}) {
        await mkdir(join(folder, 'audio'), { recursive: true })
        await writeFile(join(folder, 'film.ts'), '')
        await writeFile(join(folder, 'film.json'), JSON.stringify(film))
        await writeFile(join(folder, 'script.json'), JSON.stringify(script))
        for (const [index, text] of spoken.entries()) {
            const name = join(folder, 'audio', `${places[index]}-${takeKey(text)}`)
            // A take with sound is longer than the header of a WAV file.
            await writeFile(`${name}.wav`, 'a take of the voice'.padEnd(200, '.'))
            await writeFile(`${name}.json`, JSON.stringify({ words: aligned(text), duration: 2 + index }))
        }
    }
    const voice = (folder: string, ...args: string[]) => plain('voice', folder, ...args)

    it('names a take by its voice, its speed and its spoken text, and writes the timing from the takes on the disk', async () => {
        const folder = await filmFolder()
        await withTakes(folder)
        const result = voice(folder)
        expect(result.status, result.stderr).toBe(0)
        // No take was made, so the model was not loaded.
        // The takes are 2, 3 and 4 seconds long, and their holds are 0.25, 1.5 and 0.25 seconds.
        expect(result.said).toEqual([`voice: 3 takes, 0 new, 11.0 s of voice. timing.json is written. Next: vizmatic narrated mix ${folder}`])
        const timing = JSON.parse(await readFile(join(folder, 'timing.json'), 'utf8'))
        // The lead is the time of the first word: the title card and the pause after it.
        expect(timing).toMatchObject({ voice: 'af_heart', speed: 1.12, intro: 2, lead: 2.6, gap: 0.4, tail: 0.5 })
        expect(timing.fingerprint).toMatch(/^[0-9a-f]{16}$/)
        expect(timing.scenes.map((scene: { id: string; title: string }) => [scene.id, scene.title])).toEqual([['hook', 'Hook'], ['close', 'Close']])
        const beats = timing.scenes.flatMap((scene: { beats: unknown[] }) => scene.beats)
        expect(beats).toEqual([
            { wav: `hook-0-${takeKey(spoken[0]!)}.wav`, say: 'A page takes 800 milliseconds.', text: spoken[0], duration: 2, hold: 0.25, words: aligned(spoken[0]!) },
            { wav: `hook-1-${takeKey(spoken[1]!)}.wav`, say: 'Why build it again?', text: spoken[1], duration: 3, hold: 1.5, words: aligned(spoken[1]!) },
            { wav: `close-0-${takeKey(spoken[2]!)}.wav`, say: 'Keep the answer.', text: spoken[2], duration: 4, hold: 0.25, words: aligned(spoken[2]!) },
        ])
        // The timing that it wrote is current, and a second run writes the same file.
        expect(tool('verify', folder, '--step', 'beats').status).toBe(0)
        const first = await readFile(join(folder, 'timing.json'), 'utf8')
        expect(voice(folder).status).toBe(0)
        expect(await readFile(join(folder, 'timing.json'), 'utf8')).toBe(first)
    }, 180_000)

    it('writes the cues that the script declares for a beat into the timing, with the words of the beat', async () => {
        const folder = await filmFolder()
        await withTakes(folder)
        const without = voice(folder)
        expect(without.status, without.stderr).toBe(0)
        const fingerprint = JSON.parse(await readFile(join(folder, 'timing.json'), 'utf8')).fingerprint
        // The takes are named by what the voice says, so a cue asks for no new take.
        const cues = [{ id: 'cost', phrase: 'eight hundred milliseconds', data: { value: 800 } }]
        await writeFile(join(folder, 'script.json'), JSON.stringify({ ...script, scenes: [{ ...script.scenes[0]!, beats: [{ ...script.scenes[0]!.beats[0]!, cues }, script.scenes[0]!.beats[1]!] }, script.scenes[1]!] }))
        const result = voice(folder)
        expect(result.status, result.stderr).toBe(0)
        expect(result.said).toEqual([`voice: 3 takes, 0 new, 11.0 s of voice. timing.json is written. Next: vizmatic narrated mix ${folder}`])
        const timing = JSON.parse(await readFile(join(folder, 'timing.json'), 'utf8'))
        expect(timing.scenes[0].beats[0]).toEqual({ wav: `hook-0-${takeKey(spoken[0]!)}.wav`, say: 'A page takes 800 milliseconds.', text: spoken[0], duration: 2, hold: 0.25, words: aligned(spoken[0]!), cues })
        expect(Object.keys(timing.scenes[0].beats[1])).not.toContain('cues')
        // The cues are a part of what the film was made from.
        expect(timing.fingerprint).not.toBe(fingerprint)
        expect(tool('verify', folder, '--step', 'beats').status).toBe(0)
    }, 180_000)

    it('rejects invalid timed words before replacing timing and when reading edited timing', async () => {
        const folder = await filmFolder()
        await withTakes(folder)
        const cue = { id: 'cost', phrase: 'eight hundred milliseconds' }
        const declared = structuredClone(script)
        Object.assign(declared.scenes[0]!.beats[0]!, { cues: [cue] })
        await writeFile(join(folder, 'script.json'), JSON.stringify(declared))
        const side = join(folder, 'audio', `hook-0-${takeKey(spoken[0]!)}.json`)
        const path = join(folder, 'timing.json')
        // Two aligned entries may share their times, and one entry may contain several words.
        const good = [word('eight hundred', 0.1), word('milliseconds', 0.1)]
        await writeFile(side, JSON.stringify({ words: good, duration: 2 }))
        expect(voice(folder).status).toBe(0)
        const original = await readFile(path, 'utf8')
        expect(tool('verify', folder, '--step', 'beats').status).toBe(0)
        for (const [words, error] of [
            [[word('first', 0.1)], 'matches the timed words 0 times'],
            [[...good, ...good], 'matches the timed words 2 times'],
            [[word('eight hundred', 0.2), { text: 'milliseconds', start: 0.1, end: 0.5 }], 'words[1].start'],
            [[{ text: 'eight hundred', start: 0.1, end: 0.9 }, word('milliseconds', 0.2)], 'words[1].end'],
        ] as const) {
            await writeFile(path, original)
            await writeFile(side, JSON.stringify({ words, duration: 2 }))
            const written = voice(folder)
            expect(written.status).not.toBe(0)
            expect(written.stderr).toContain(error)
            expect(await readFile(path, 'utf8')).toBe(original)
            const edited = JSON.parse(original)
            edited.scenes[0].beats[0].words = words
            await writeFile(path, JSON.stringify(edited))
            const read = tool('verify', folder, '--step', 'beats')
            expect(read.status).not.toBe(0)
            expect(read.stderr).toContain(error)
        }
    }, 180_000)

    it('gives a script that changed another fingerprint, and asks for a new take of the beat that changed only', async () => {
        const folder = await filmFolder()
        await withTakes(folder)
        expect(voice(folder).status).toBe(0)
        const before = JSON.parse(await readFile(join(folder, 'timing.json'), 'utf8')).fingerprint
        // The timing has the fingerprint of the script that it was made from. After a change of the script, it is not current.
        await writeFile(join(folder, 'script.json'), JSON.stringify({ ...script, pronounce: { '800': 'eight hundred', answer: 'reply' } }))
        expect(tool('verify', folder, '--step', 'beats').said).toEqual([`verify: timing.json: the script: changed after the voice was made: close/0 (the spoken form). Run: vizmatic narrated voice ${folder}`])
        // A change of a hold needs no new take, and it changes the fingerprint.
        await writeFile(join(folder, 'script.json'), JSON.stringify({ ...script, scenes: [{ ...script.scenes[0]!, beats: [script.scenes[0]!.beats[0]!, { say: 'Why build it again?', hold: 3 }] }, script.scenes[1]!] }))
        expect(voice(folder).stderr).toContain('3 takes, 0 new')
        const held = JSON.parse(await readFile(join(folder, 'timing.json'), 'utf8'))
        expect(held.fingerprint).not.toBe(before)
        expect(held.scenes[0].beats[1].hold).toBe(3)
        // A change of the text of one beat asks for that take. This test has no voice model, so the take cannot be made.
        await writeFile(join(folder, 'script.json'), JSON.stringify({ ...script, scenes: [script.scenes[0]!, { ...script.scenes[1]!, beats: [{ say: 'Keep the answer for later.' }] }] }))
        const changed = voice(folder)
        expect(changed.status).not.toBe(0)
        expect(changed.stdout).toContain('hook 0 2\nhook 1 3\n')
        expect(changed.said.at(-1)).toMatch(/^voice: the voice "af_heart" could not speak close\/0: \w+: .*\. Check voice\.name in film\.json\. Offline, the model files must be on the disk$/)
        expect(changed.stderr).not.toContain('Traceback')
        // The same text in another voice or at another speed is another take too.
        await withTakes(folder, { voice: { speed: 1 } })
        expect(voice(folder).said.at(-1)).toMatch(/could not speak hook\/0/)
    }, 180_000)

    it('makes a take again when a run left it empty or half written, and never reads it as a take', async () => {
        const folder = await filmFolder()
        await withTakes(folder)
        expect(voice(folder).status).toBe(0)
        const name = join(folder, 'audio', `${places[1]}-${takeKey(spoken[1]!)}`)
        // An empty file in the place of the word times, then an empty sound, then word times that are not whole.
        for (const [file, content] of [[`${name}.json`, ''], [`${name}.wav`, ''], [`${name}.json`, '{"words": []}']] as const) {
            await withTakes(folder)
            await writeFile(file, content)
            const again = voice(folder)
            // The take is asked for again. This test has no voice model, so the take cannot be made: one line says so.
            expect(again.status, file).not.toBe(0)
            expect(again.stderr, file).not.toContain('Traceback')
            expect(again.said.at(-1), file).toMatch(/^voice: the voice "af_heart" could not speak hook\/1: /)
        }
    }, 180_000)

    it('never takes a scene id into a path outside the folder', async () => {
        const folder = await filmFolder()
        await withTakes(folder)
        await writeFile(join(folder, 'script.json'), JSON.stringify({ scenes: [{ id: '../../x', title: 'Out', beats: [{ say: 'Out.' }] }] }))
        const result = voice(folder)
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain('script.json: scenes[0].id: "../../x" is not an id')
        expect((await readdir(dirname(dirname(folder)))).filter((name) => name.startsWith('x-0-'))).toEqual([])
    }, 120_000)
})

describe.skipIf(!ready)('narration tools', () => {
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
        const voice = join(dir, 'voice.wav'), bed = join(dir, 'bed.wav')
        ffmpeg('-f', 'lavfi', '-i', 'aevalsrc=if(between(t\\,5\\,10)\\,0\\,0.2*sin(2*PI*180*t)):s=24000:d=15.0003', voice)
        const render = (palette: string) => {
            const take = tool('soundbed', 'bed', '--voice', voice, '--out', bed, '--seed', '17', '--palette', palette)
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
