import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdtempSync } from 'fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, afterEach, expect } from 'vitest'

// The sound tools are Python scripts that uv runs. These tests need uv and FFmpeg, and no voice model.
const has = (command: string, flag: string) => spawnSync(command, [flag], { encoding: 'utf8' }).status === 0
export const ready = has('uv', '--version') && has('ffmpeg', '-version') && has('ffprobe', '-version')
export const TOOLS = resolve('tools/narration')
export const QUIET = { PYTHONDONTWRITEBYTECODE: '1' }

const BUILT_CLI = resolve('dist/cli.js')
const USE_BUILT_CLI = process.env['VIZMATIC_TEST_USE_EXISTING_BUILD'] === '1' && existsSync(BUILT_CLI)
const STDLIB_TOOLS = new Set(['beats', 'draft', 'probe', 'record', 'resound', 'verify'])
const AUDIO_TOOLS = new Set(['mix', 'lag', 'soundbed'])

let cachedBarePython: string | null | undefined
let cachedAudioPython: string | null | undefined
let audioVenvDir: string | null = null

export function barePython(): string | null {
    if (cachedBarePython !== undefined) return cachedBarePython
    const override = process.env['VIZMATIC_TEST_BARE_PYTHON']
    if (override && existsSync(override)) {
        cachedBarePython = override
        return cachedBarePython
    }
    const res = spawnSync(
        'uv',
        ['run', '--no-project', '--python', '3.12', 'python', '-c', 'import os, sys; print(os.path.realpath(sys.executable))'],
        { encoding: 'utf8', env: { ...process.env, ...QUIET } },
    )
    const candidate = res.status === 0 ? res.stdout.trim() : ''
    cachedBarePython = candidate && existsSync(candidate) ? candidate : null
    return cachedBarePython
}

export function audioPython(): string | null {
    if (cachedAudioPython !== undefined) return cachedAudioPython
    const override = process.env['VIZMATIC_TEST_AUDIO_PYTHON']
    if (override && existsSync(override)) {
        cachedAudioPython = override
        return cachedAudioPython
    }
    const venvDir = mkdtempSync(join(tmpdir(), 'vizmatic-audio-venv-'))
    audioVenvDir = venvDir
    const created = spawnSync('uv', ['venv', '--python', '3.12', venvDir], {
        encoding: 'utf8', env: { ...process.env, ...QUIET },
    })
    const py = join(venvDir, process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python')
    if (created.status !== 0 || !existsSync(py)) {
        cachedAudioPython = null
        return null
    }
    const installed = spawnSync('uv', ['pip', 'install', '--python', py, 'numpy', 'scipy', 'soundfile'], {
        encoding: 'utf8', env: { ...process.env, ...QUIET },
    })
    cachedAudioPython = installed.status === 0 && existsSync(py) ? py : null
    return cachedAudioPython
}

export const tempDirs: string[] = []
let sharedFixtureDir: string | null = null
let cachedTakeA: string | null = null
let cachedTakeB: string | null = null
let cachedTinyMovie: string | null = null

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

afterAll(async () => {
    const cleanup: string[] = []
    if (sharedFixtureDir) {
        cleanup.push(sharedFixtureDir)
        sharedFixtureDir = null
        cachedTakeA = null
        cachedTakeB = null
        cachedTinyMovie = null
    }
    if (audioVenvDir) {
        cleanup.push(audioVenvDir)
        audioVenvDir = null
        cachedAudioPython = undefined
    }
    await Promise.all(cleanup.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function fixtureDir(): Promise<string> {
    if (!sharedFixtureDir) sharedFixtureDir = await mkdtemp(join(tmpdir(), 'vizmatic-tools-cache-'))
    return sharedFixtureDir
}

export async function filmFolder(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'vizmatic-tools-'))
    tempDirs.push(directory)
    return directory
}

/**
 * The lines that a tool wrote on the error stream: each one starts with the name of the tool. uv writes there
 * too, such as "Installed 27 packages" when it first makes the environment of a tool, and a test must not
 * depend on that.
 */
export const saidBy = (name: string, stderr?: string) => (stderr ?? '').split('\n').filter((line) => line.startsWith(`${name}: `))

export function tool(name: string, folder: string, ...args: string[]) {
    const py = STDLIB_TOOLS.has(name) ? barePython() : (AUDIO_TOOLS.has(name) ? audioPython() : null)
    const script = join(TOOLS, `${name}.py`)
    const result = py
        ? spawnSync(py, ['-B', script, folder, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...QUIET, PYTHONPATH: TOOLS } })
        : spawnSync('uv', ['run', script, folder, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...QUIET } })
    return { ...result, said: saidBy(name, result.stderr) }
}

/** Run the public command with the CLI (built when VIZMATIC_TEST_USE_EXISTING_BUILD=1), exercising real uv run. */
export function narratedMix(folder: string) {
    const cliArgs = USE_BUILT_CLI
        ? [BUILT_CLI, 'narrated', 'mix', folder]
        : ['--import', `file://${resolve('node_modules/tsx/dist/loader.mjs')}`, resolve('src/cli.ts'), 'narrated', 'mix', folder]
    return spawnSync(process.execPath, cliArgs, {
        encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...QUIET },
    })
}

/** Run a tool with the standard library alone: the path of a step that needs no package, and no model. */
export function bare(args: string[], env: NodeJS.ProcessEnv = {}) {
    const py = barePython()
    const mergedEnv = { ...process.env, ...QUIET, PYTHONPATH: TOOLS, ...env }
    if (py) return spawnSync(py, ['-B', ...args], { encoding: 'utf8', env: mergedEnv })
    return spawnSync('uv', ['run', '--no-project', '--python', '3.12', 'python', '-B', ...args], { encoding: 'utf8', env: mergedEnv })
}

/** A tool with the standard library alone, by its name: for the path of a tool that ends before it needs a package. */
export function plain(name: string, folder: string, ...args: string[]) {
    const result = bare([join(TOOLS, `${name}.py`), folder, ...args])
    return { ...result, said: saidBy(name, result.stderr) }
}

export function ffmpeg(...args: string[]) {
    const result = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(result.stderr.toString())
    return result.stdout
}

/** The loudness of one second-range of a sound file, as the root mean square of its samples, from 0 to 1. */
export function loudness(path: string, from: number, to: number): number {
    const raw = ffmpeg('-ss', String(from), '-t', String(to - from), '-i', path, '-ac', '1', '-f', 's16le', '-')
    const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2))
    return Math.sqrt(samples.reduce((sum, sample) => sum + (sample / 32768) ** 2, 0) / Math.max(1, samples.length))
}

/** Read both channels without changing the gain, for comparisons before the loudness pass. */
export function audioSamples(path: string): Float32Array {
    const raw = ffmpeg('-i', path, '-c:a', 'pcm_f32le', '-f', 'f32le', '-')
    return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}

export function differencePeak(a: Float32Array, b: Float32Array, from: number, to: number): number {
    let peak = 0
    for (let i = Math.floor(from * 48000) * 2; i < Math.min(a.length, Math.floor(to * 48000) * 2); i++) peak = Math.max(peak, Math.abs(a[i]! - b[i]!))
    return peak
}

export const word = (text: string, start: number) => ({ text, start, end: start + 0.2 })
export const SCRIPT = {
    timeline: { intro: 1, pause: 0.5, gap: 0.5, tail: 0.5 },
    scenes: [
        { id: 'hook', title: 'Hook', beats: [{ say: 'Will it run? Will it?', hold: 1 }] },
        { id: 'close', title: 'Close', beats: [{ say: 'Have a plan.', hold: 2 }] },
    ],
}
/** The timing that the voice step writes for SCRIPT, with two takes of a tone: 1 second and 1.5 seconds long. */
export const TIMING = {
    voice: 'af_heart', speed: 1.12, intro: 1, lead: 1.5, gap: 0.5, tail: 0.5,
    scenes: [
        { id: 'hook', title: 'Hook', beats: [{ wav: 'a.wav', say: 'Will it run? Will it?', text: 'Will it run? Will it?', duration: 1, hold: 1, words: [word('Will', 0.1), word('it', 0.3), word('run?', 0.5), word('Will', 0.6), word('it?', 0.7)] }] },
        { id: 'close', title: 'Close', beats: [{ wav: 'b.wav', say: 'Have a plan.', text: 'Have a plan.', duration: 1.5, hold: 2, words: [word('Have', 0.1), word('a', 0.4), word('plan', 0.6)] }] },
    ],
}

/** A film folder with a script, its timing, and two takes of a tone. `film` is the content of film.json. */
export async function twoTakes(folder: string, film: unknown = { output: 'Tiny-Film', mix: { seed: 3 } }) {
    await rm(join(folder, 'audio'), { recursive: true, force: true })
    await mkdir(join(folder, 'audio'))
    if (!cachedTakeA || !cachedTakeB) {
        const cache = await fixtureDir()
        cachedTakeA = join(cache, 'a.wav')
        cachedTakeB = join(cache, 'b.wav')
        ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=220:duration=1:sample_rate=24000', cachedTakeA)
        ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=330:duration=1.5:sample_rate=24000', cachedTakeB)
    }
    await Promise.all([
        copyFile(cachedTakeA, join(folder, 'audio', 'a.wav')),
        copyFile(cachedTakeB, join(folder, 'audio', 'b.wav')),
        writeFile(join(folder, 'film.ts'), '// The film file. These tests do not render it.\n'),
        writeFile(join(folder, 'film.json'), JSON.stringify(film)),
        writeFile(join(folder, 'script.json'), JSON.stringify(SCRIPT)),
        writeFile(join(folder, 'timing.json'), JSON.stringify(TIMING)),
    ])
}

/**
 * A tiny movie with a title, two chapters, two captions and a tone at 48 kHz, as dist/Tiny-Film.mp4. Its
 * length and the start of its second chapter are those of TIMING: 8.5 seconds, and the close at 4.
 */
export async function tinyMovie(folder: string, seconds = 8.5, split = 4, name = 'Tiny-Film', picture = 'testsrc'): Promise<string> {
    await mkdir(join(folder, 'dist'), { recursive: true })
    const movie = join(folder, 'dist', `${name}.mp4`)
    const isDefault = seconds === 8.5 && split === 4 && picture === 'testsrc'
    if (isDefault) {
        if (!cachedTinyMovie) {
            const cache = await fixtureDir()
            const chapters = join(cache, 'chapters.txt')
            const captions = join(cache, 'captions.srt')
            const encoded = join(cache, 'encoded-default.mp4')
            cachedTinyMovie = join(cache, 'Tiny-Film.mp4')
            await writeFile(chapters, `;FFMETADATA1\ntitle=A tiny film\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=4000\ntitle=One\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=4000\nEND=8500\ntitle=Two\\\\ and \\= more\n`)
            await writeFile(captions, '1\n00:00:00,100 --> 00:00:00,900\nFirst line\n\n2\n00:00:01,100 --> 00:00:01,900\nSecond line\n')
            ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=8.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8.5:sample_rate=48000', '-i', captions,
                '-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text', encoded)
            ffmpeg('-i', encoded, '-f', 'ffmetadata', '-i', chapters, '-map', '0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movie_timescale', '1000', cachedTinyMovie)
            await rm(encoded)
        }
        await copyFile(cachedTinyMovie, movie)
        return movie
    }
    const ms = (value: number) => Math.round(value * 1000)
    await writeFile(join(folder, 'chapters.txt'), `;FFMETADATA1\ntitle=A tiny film\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=${ms(split)}\ntitle=One\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=${ms(split)}\nEND=${ms(seconds)}\ntitle=Two\\\\ and \\= more\n`)
    await writeFile(join(folder, 'captions.srt'), '1\n00:00:00,100 --> 00:00:00,900\nFirst line\n\n2\n00:00:01,100 --> 00:00:01,900\nSecond line\n')
    const encoded = join(folder, `encoded-${name}.mp4`)
    ffmpeg('-f', 'lavfi', '-i', `${picture}=size=320x180:rate=30:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}:sample_rate=48000`, '-i', join(folder, 'captions.srt'),
        '-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text', encoded)
    ffmpeg('-i', encoded, '-f', 'ffmetadata', '-i', join(folder, 'chapters.txt'), '-map', '0', '-map_metadata', '1', '-map_chapters', '1', '-c', 'copy', '-movie_timescale', '1000', movie)
    await rm(encoded)
    return movie
}

/** The record step, as the build runs it after a render: with the hash of timing.json as it was before the render. */
export async function record(folder: string, movie: string) {
    const sha = createHash('sha256').update(await readFile(join(folder, 'timing.json'))).digest('hex')
    const result = tool('record', folder, movie, '--timing', sha)
    expect(result.status, result.stderr).toBe(0)
}

/** A folder as a build leaves it: the takes, the mix of them, the movie, and the timing of its picture beside it. */
export async function built(folder: string, film?: unknown): Promise<string> {
    await twoTakes(folder, ...(film === undefined ? [] : [film]))
    const mix = tool('mix', folder)
    expect(mix.status, mix.stderr).toBe(0)
    const movie = await tinyMovie(folder)
    await record(folder, movie)
    return movie
}

/** The hash of the video packets of a movie. A new sound must not change it. */
export const pictureHash = (movie: string) => ffmpeg('-i', movie, '-map', '0:v', '-c', 'copy', '-f', 'md5', '-').toString().trim()
export const streamKinds = (movie: string) => spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', movie], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean).sort()
