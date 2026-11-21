import { spawnSync } from "child_process"
import { createHash } from "crypto"
import { existsSync } from "fs"
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "fs/promises"
import { dirname, join } from "path"
import { describe, expect, it } from "vitest"
import { QUIET, SCRIPT, TOOLS, bare, filmFolder, narratedMix, plain, ready, saidBy, tool, twoTakes, word } from "./narrated-tools-support"

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

describe.skipIf(!ready)('local speech acceleration', () => {
    it('restarts a partial Metal transcript on CPU and reuses the CPU model on later takes', () => {
        const result = bare(['-c', `
import speech
from unittest.mock import patch

loaded = []
class Engine:
    def __init__(self, device):
        self.device = device
        loaded.append(device)
    def transcribe(self, audio, **options):
        def stream():
            yield self.device
            if self.device == "mps":
                raise RuntimeError("MPS does not support this operation")
        return stream(), None

with patch.object(speech.sys, "platform", "darwin"), patch.object(speech.platform, "machine", return_value="arm64"):
    model = speech.SpeechModel(Engine, lambda: True, "cpu")
    assert speech.segments(model, []) == ["cpu"]
    assert speech.segments(model, []) == ["cpu"]
    assert loaded == ["mps", "cpu"]
`], { VIZMATIC_NARRATION_DEVICE: 'auto' })
        expect(result.status, result.stderr).toBe(0)
    })

    it('honors an explicit device and preserves the existing device on other hosts', () => {
        const result = bare(['-c', `
import os, speech
from unittest.mock import patch
with patch.object(speech.sys, "platform", "linux"):
    assert speech.SpeechModel(str, lambda: True, "cuda").device == "cuda"
    os.environ["VIZMATIC_NARRATION_DEVICE"] = "cpu"
    assert speech.SpeechModel(str, lambda: True, "cuda").device == "cpu"
    os.environ["VIZMATIC_NARRATION_DEVICE"] = "mps"
    try:
        speech.SpeechModel(str, lambda: False, "cpu")
    except RuntimeError as error:
        assert "unavailable" in str(error)
    else:
        raise AssertionError("explicit MPS was ignored")
`], { VIZMATIC_NARRATION_DEVICE: 'auto' })
        expect(result.status, result.stderr).toBe(0)
    })
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

