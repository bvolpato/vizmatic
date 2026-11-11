import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildReport, buildSteps, checkOutcome, findingLines, movieName, parseNarratedArgs, planNarrated, stepLine, stillTimes, type NarratedParticulars, type NarratedStep } from '../src/narrated-cli'
import { startPreview, type PreviewHandle } from '../src/stage/preview/server'

// Every step checks the files of the film with a Python tool first, which uv runs.
const hasUv = spawnSync('uv', ['--version'], { encoding: 'utf8' }).status === 0
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0 && spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0
const previews: PreviewHandle[] = []
const tempDirs: string[] = []
afterEach(async () => {
    await Promise.all(previews.splice(0).map((preview) => preview.close()))
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/** A folder that can resolve the vizmatic package, as a project that has it installed. */
async function project(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'vizmatic-narrated-'))
    tempDirs.push(directory)
    await mkdir(join(directory, 'node_modules'))
    await symlink(resolve('.'), join(directory, 'node_modules', 'vizmatic'))
    return directory
}

function cli(args: string[], cwd: string, more: NodeJS.ProcessEnv = {}) {
    const env: NodeJS.ProcessEnv = { ...process.env, VIZMATIC_DISABLE_NETWORK: '1', ...more }
    delete env.NODE_OPTIONS
    for (const key of Object.keys(env)) {
        if (key.startsWith('TSX_') || key.startsWith('VITEST')) delete env[key]
    }
    return spawnSync(process.execPath, ['--import', `file://${resolve('node_modules/tsx/dist/loader.mjs')}`, resolve('src/cli.ts'), ...args], { cwd, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 })
}

async function template(): Promise<string> {
    const directory = await project()
    const created = cli(['new', 'my-film', '--template', 'narrated'], directory)
    expect(created.status, created.stderr).toBe(0)
    // The new folder names the one command that builds it.
    expect(created.stdout).toContain('  vizmatic narrated build my-film --draft\n')
    return directory
}

const self = ['node', 'cli.js']
// The particulars of a film before its first voice: the voice step and the mix step have work to do.
const film = (given: Partial<NarratedParticulars> = {}): NarratedParticulars => ({
    entry: 'film.ts', output: 'film', look: 'midnight', check: [], before: [], render: { workers: 6, draftWorkers: 3 },
    voice: { current: false, why: 'timing.json is a draft: its times are estimates, and there is no voice' }, mix: { current: false, why: 'the voice is made first' }, scenes: [], gap: 0.4, length: 0, ...given,
})
// The same film when its voice and its mix are made: two scenes, from 3 to 14 seconds and from 14.4 to 25.
const current: Partial<NarratedParticulars> = {
    voice: { current: true, why: 'timing.json is the voice of this script, and its 4 takes are on the disk' }, mix: { current: true, why: 'narration.wav is the mix of this timing and of this film.json' },
    scenes: [{ id: 'question', start: 3, end: 14 }, { id: 'answer', start: 14.4, end: 25 }], gap: 0.4, length: 25.9,
}
const words = (steps: readonly NarratedStep[]) => steps.map((step) => step.words.join(' '))
const plan = (argv: string[], given: Partial<NarratedParticulars> = {}, timing?: Parameters<typeof planNarrated>[3]) => planNarrated(parseNarratedArgs(argv), film(given), self, timing)

const word = (text: string, start: number) => ({ text, start, end: start + 0.2 })
const timing = {
    lead: 2, gap: 0.5,
    scenes: [
        { id: 'hook', beats: [{ say: 'One.', duration: 2, hold: 1, words: [word('One', 0.1)] }, { say: 'Two.', duration: 3, words: [word('Two', 0.1)] }] },
        { id: 'close', beats: [{ say: 'Three.', duration: 1.5, hold: 0.5, words: [word('Three', 0.1)] }] },
    ],
}

describe('the steps of vizmatic narrated', () => {
    it('builds a film in one command: the voice, the mix, the beat list, the check with motion, the render, and the record of its timing', () => {
        const steps = plan(['build', '/films/toto'], { entry: 'toto.ts', output: 'Toto-Forecasting', check: ['--text-margin', '30'] })
        expect(words(steps)).toEqual([
            'uv run tools/narration/voice.py .',
            'uv run tools/narration/mix.py .',
            'uv run tools/narration/beats.py .',
            'vizmatic check toto.ts --look midnight --text-margin 30 --motion',
            'vizmatic film toto.ts --name Toto-Forecasting --quality standard --out dist --look midnight --format mp4 --workers 6 --audio narration.wav',
            'uv run tools/narration/record.py . dist/Toto-Forecasting.mp4',
        ])
        // Before the first voice, every step has work to do.
        expect(steps.every((step) => step.skip === undefined)).toBe(true)
        // The tool gets the folder of the film, and the check and the render run this command line again.
        expect(steps[0]).toMatchObject({ command: 'uv', args: ['run', expect.stringMatching(/tools\/narration\/voice\.py$/), '/films/toto'] })
        expect(steps[3]).toMatchObject({ kind: 'check', allowFindings: false, command: 'node', args: ['cli.js', 'check', 'toto.ts', '--look', 'midnight', '--text-margin', '30', '--motion'] })
        expect(plan(['build', '.', '--allow-findings'])[3]).toMatchObject({ kind: 'check', allowFindings: true })
    })

    it('runs the steps that have work to do, and says why it runs or skips each one', () => {
        const lines = (steps: readonly NarratedStep[]) => steps.map(stepLine)
        expect(lines(plan(['build', 'my-film', '--draft']))).toEqual([
            'build: voice runs: timing.json is a draft: its times are estimates, and there is no voice',
            'build: mix runs: the voice was made again',
            'build: beats runs: the times of the beats are new',
            'build: check runs: the picture can change with any file of the film',
            'build: render runs: a draft of the whole film',
            'build: record runs: the movie keeps the timing of its picture, for the resound and sync steps',
        ])
        // After a change of a scene file alone: the voice and the mix are current, and the timing did not change.
        expect(lines(plan(['build', 'my-film'], current))).toEqual([
            'build: voice is skipped: timing.json is the voice of this script, and its 4 takes are on the disk',
            'build: mix is skipped: narration.wav is the mix of this timing and of this film.json',
            'build: beats is skipped: the timing did not change. To print the beats: vizmatic narrated beats my-film',
            'build: check runs: the picture can change with any file of the film',
            'build: render runs: the delivered movie',
            'build: record runs: the movie keeps the timing of its picture, for the resound and sync steps',
        ])
        // After a change of the mix in film.json: the mix runs, and says why.
        const remix = { ...current, mix: { current: false, why: 'the timing or the mix of film.json changed after the last mix' } }
        expect(lines(plan(['build', 'my-film'], remix)).slice(0, 3)).toEqual([
            'build: voice is skipped: timing.json is the voice of this script, and its 4 takes are on the disk',
            'build: mix runs: the timing or the mix of film.json changed after the last mix',
            'build: beats is skipped: the timing did not change. To print the beats: vizmatic narrated beats my-film',
        ])
        // When the voice step ran, the mix and the beat list follow it, whatever the mix was before.
        const after = buildSteps(parseNarratedArgs(['build', 'my-film']), film(current), self, true)
        expect(lines(after).slice(1, 3)).toEqual(['build: mix runs: the voice was made again', 'build: beats runs: the times of the beats are new'])
        expect(lines(plan(['build', 'my-film'], { ...current, before: [['uv', 'run', 'data.py']] }))[0]).toBe('build: before runs: film.json lists it under "before"')
    })

    it('renders a draft straight to its own name, so that no step writes to the path of the delivered movie', () => {
        // Without a name in film.json, the delivered movie is dist/film.mp4, which is also the name of the film file.
        for (const given of [{}, { output: 'My-Film' }]) {
            const delivered = `${film(given).output}.mp4`
            const steps = words(plan(['build', '.', '--draft'], given))
            expect(steps[4]).toBe(`vizmatic film film.ts --name ${film(given).output}-draft --quality draft --out dist --look midnight --format mp4 --workers 3 --audio narration.wav`)
            expect(steps[5]).toBe(`uv run tools/narration/record.py . dist/${film(given).output}-draft.mp4`)
            expect(steps.join('\n')).not.toContain(delivered)
            expect(steps).toHaveLength(6)
            // --quality draft is the same draft.
            expect(words(plan(['build', '.', '--quality', 'draft'], given))).toEqual(steps)
        }
        expect(movieName(film({ output: 'My-Film' }), true)).toBe('My-Film-draft')
        expect(movieName(film({ output: 'My-Film' }), false)).toBe('My-Film')
        expect(movieName(film({ output: 'My-Film' }), true, ['hook', 'the-answer'])).toBe('My-Film-draft-hook-the-answer')
        expect(words(plan(['build', '.', '--draft', '--workers', '2']))[4]).toContain('--workers 2')
        expect(words(plan(['build', '.'], { render: { workers: 10, draftWorkers: 3 } }))[4]).toContain('--workers 10')
        // A draft at another quality keeps the name of a draft.
        expect(words(plan(['build', '.', '--draft', '--quality', 'high']))[4]).toContain('--name film-draft --quality high')
        // The delivered movie at another quality keeps its name: the copy for an upload replaces it.
        expect(words(plan(['build', '.', '--quality', 'high']))[4]).toContain('--name film --quality high')
        // The render gets the dither option of the build, and none when the build has none.
        expect(words(plan(['build', '.']))[4]).not.toContain('dither')
        expect(words(plan(['build', '.', '--dither']))[4]).toMatch(/ --dither$/)
        expect(words(plan(['build', '.', '--quality', 'high', '--no-dither']))[4]).toMatch(/--quality high .* --no-dither$/)
    })

    it('makes a movie of some scenes as a draft only: the delivered movie always holds every scene', () => {
        expect(() => plan(['build', '.', '--scene', 'answer'], current)).toThrow('--scene makes a movie of some scenes, and that is a draft: add --draft. The delivered movie always holds every scene.')
        expect(() => plan(['build', '.', '--scene', 'answer', '--quality', 'high'], current)).toThrow('add --draft')
        expect(() => plan(['build', '.', '--draft', '--scene', 'outro'], current)).toThrow('--scene names the scene "outro", and the film has no scene with that id. Its scenes are: question, answer')
        const steps = plan(['build', 'my-film', '--draft', '--scene', 'answer'], { ...current, output: 'My-Film' })
        // The render builds that scene alone, for the part of the film from its opening to its end, under a name of its own.
        expect(steps[4]).toMatchObject({ env: { VIZMATIC_SCENES: 'answer' }, why: 'a draft of answer alone' })
        expect(words([steps[4]!])).toEqual(['vizmatic film film.ts --name My-Film-draft-answer --quality draft --out dist --look midnight --format mp4 --workers 3 --audio narration.wav --range 13.7:25.9'])
        expect(stepLine(steps[3]!)).toBe('build: check is skipped: a check of some scenes would report the other scenes as empty frames. To check the film: vizmatic narrated check my-film --motion')
        expect(stepLine(steps[5]!)).toBe('build: record is skipped: a movie of some scenes has no timing of its own')
        // Two scenes in the order of the film, whatever the order of the option. The part ends with the film.
        const both = plan(['build', '.', '--draft', '--scene', 'answer,question'], current)
        expect(both[4]).toMatchObject({ env: { VIZMATIC_SCENES: 'question,answer' } })
        expect(words([both[4]!])[0]).toContain('--name film-draft-question-answer ')
        expect(words([both[4]!])[0]).toContain('--range 2.3:25.9')
        // A scene that is not the last one ends where the next scene starts.
        expect(words([plan(['build', '.', '--draft', '--scene', 'question'], current)[4]!])[0]).toContain('--range 2.3:14.4')
        // The whole film has no list of scenes, so a list that was left in the environment does not reach it.
        expect(plan(['build', '.', '--draft'], current)[4]).not.toHaveProperty('env')
    })

    it('says which movie a build wrote and which one it left', () => {
        const given = film({ output: 'My-Film' })
        expect(buildReport(given, true, true)).toBe('build: wrote dist/My-Film-draft.mp4, a draft. The delivered movie dist/My-Film.mp4 is left as it is.')
        expect(buildReport(given, true, false)).toBe('build: wrote dist/My-Film-draft.mp4, a draft. There is no delivered movie yet: a build without --draft writes dist/My-Film.mp4.')
        expect(buildReport(given, false, true)).toBe('build: wrote dist/My-Film.mp4, the delivered movie.')
        expect(buildReport(given, true, true, 'writes')).toContain('build: writes dist/My-Film-draft.mp4')
        expect(buildReport(given, true, true, 'wrote', ['answer'])).toBe('build: wrote dist/My-Film-draft-answer.mp4, a draft of the scene "answer" alone. The delivered movie dist/My-Film.mp4 is left as it is.')
    })

    it('runs the commands of the film before the voice', () => {
        const steps = plan(['build', '.'], { before: [['uv', 'run', 'proofs/run.py']], look: 'paper' })
        expect(words(steps)).toEqual([
            'uv run proofs/run.py',
            'uv run tools/narration/voice.py .',
            'uv run tools/narration/mix.py .',
            'uv run tools/narration/beats.py .',
            'vizmatic check film.ts --look paper --motion',
            'vizmatic film film.ts --name film --quality standard --out dist --look paper --format mp4 --workers 6 --audio narration.wav',
            'uv run tools/narration/record.py . dist/film.mp4',
        ])
        expect(steps[0]).toMatchObject({ command: 'uv', args: ['run', 'proofs/run.py'] })
    })

    it('takes one still for each beat just before its voice ends, and earlier for the last beat of a scene', () => {
        // The hook starts at 2: its beats end at 4 and at 8. The close starts at 8.5, and its beat ends at 10.
        expect(stillTimes(timing)).toEqual([3.95, 7.55, 9.55])
        expect(stillTimes(timing, ['close'])).toEqual([9.55])
        expect(() => stillTimes(timing, ['outro'])).toThrow('no scene "outro"')
    })

    it('renders stills of some scenes alone, at their times in the whole film', () => {
        const [step] = plan(['stills', '.', '--scene', 'close,hook'], {}, timing)
        expect(step).toMatchObject({ env: { VIZMATIC_SCENES: 'close,hook' } })
        expect(words([step!])).toEqual(['vizmatic film film.ts --frame 3.95,7.55,9.55 --width 1920 --out stills/close-hook --look midnight'])
        expect(words(plan(['stills', '.', '--frame', '1,2.5', '--name', 'pick', '--width', '960'], {}, timing))).toEqual(['vizmatic film film.ts --frame 1,2.5 --width 960 --out stills/pick --look midnight'])
        expect(plan(['stills', '.'], {}, timing)[0]).not.toHaveProperty('env')
        expect(words(plan(['stills', '.'], {}, timing))[0]).toContain('--out stills/beats ')
        expect(words(plan(['stills', '.', '--frame', '3'], {}, timing))[0]).toContain('--out stills/frames ')
        expect(words(plan(['sheet', '.', '--every', '3', '--range', '2:8', '--columns', '4']))).toEqual(['vizmatic film film.ts --sheet --every 3 --range 2:8 --columns 4 --out stills/sheet --look midnight'])
        expect(plan(['sheet', '.', '--scene', 'hook'])[0]).toMatchObject({ env: { VIZMATIC_SCENES: 'hook' } })
    })

    it('gives the options and the words of a single step to its tool', () => {
        expect(words(plan(['check', '.', '--motion', '--json', '--content-top', '200'], { check: ['--text-margin', '30'] }))).toEqual(['vizmatic check film.ts --look midnight --text-margin 30 --motion --json --content-top 200'])
        expect(words(plan(['check', '.', '--text-size', '26', '--empty-space', '0.5', '--empty-seconds', '2']))).toEqual(['vizmatic check film.ts --look midnight --text-size 26 --empty-space 0.5 --empty-seconds 2'])
        expect(words(plan(['beats', '.', '--words', 'hook', '1']))).toEqual(['uv run tools/narration/beats.py . hook 1 --words'])
        expect(words(plan(['voice', '.']))).toEqual(['uv run tools/narration/voice.py .'])
        expect(words(plan(['resound', '.', '--draft']))).toEqual(['uv run tools/narration/resound.py . --draft'])
        expect(words(plan(['transcribe', '.', 'hook/1', 'close']))).toEqual(['uv run tools/narration/transcribe.py . hook/1 close'])
        expect(words(plan(['probe', '.', '--draft']))).toEqual(['uv run tools/narration/probe.py . --draft'])
        // The tool runs in the folder of the film, so a path that the person gives is made absolute.
        expect(words(plan(['sync', '.', 'out/movie.mp4']))).toEqual([`uv run tools/narration/sync.py . ${resolve('out/movie.mp4')}`])
        expect(words(plan(['lag', '.']))).toEqual(['uv run tools/narration/lag.py .'])
        // --dry-run is for this command line, and no tool gets it.
        expect(words(plan(['mix', '.', '--dry-run']))).toEqual(['uv run tools/narration/mix.py .'])
    })

    it('refuses an option that the step does not have, and names the options that it has', () => {
        expect(() => parseNarratedArgs(['build', '.', '--drfat'])).toThrow('Unknown option --drfat for vizmatic narrated build. Its options are: --draft, --scene <id,...>, --quality <draft|standard|high|master>, --dither, --no-dither, --workers <n>, --allow-findings, --dry-run')
        expect(() => parseNarratedArgs(['build', '.', '--qualty', 'draft'])).toThrow('Unknown option --qualty for vizmatic narrated build')
        // The film name comes from film.json, and not from an option of the build.
        expect(() => parseNarratedArgs(['build', '.', '--name', 'My-Film'])).toThrow('Unknown option --name for vizmatic narrated build')
        // The voice step makes the voice of the whole film. A movie of some scenes is a draft build.
        expect(() => parseNarratedArgs(['voice', '.', '--scene', 'question'])).toThrow('Unknown option --scene for vizmatic narrated voice. Its options are: --dry-run')
        expect(() => parseNarratedArgs(['mix', '.', '--seed', '3'])).toThrow('Unknown option --seed for vizmatic narrated mix. Its options are: --dry-run')
        expect(() => parseNarratedArgs(['lag', '.', '--draft'])).toThrow('Unknown option --draft for vizmatic narrated lag')
        expect(() => parseNarratedArgs(['check', '.', '--text-gap', '0.3'])).toThrow('Unknown option --text-gap for vizmatic narrated check')
        expect(() => parseNarratedArgs(['stills', '.', '--every', '3'])).toThrow('Unknown option --every for vizmatic narrated stills')
        // A step that takes no word after the folder says so, and a step that takes words keeps them.
        expect(() => parseNarratedArgs(['mix', '.', 'hook'])).toThrow('vizmatic narrated mix takes the folder and no other word, but received "hook"')
        expect(parseNarratedArgs(['beats', '.', 'hook', 'close']).words).toEqual(['hook', 'close'])
    })

    it('refuses a step that it does not have, a missing folder, and a value that is not of its kind', () => {
        expect(() => parseNarratedArgs(['render', '.'])).toThrow(/Unknown step "render" for vizmatic narrated[\s\S]*build[\s\S]*resound/)
        expect(() => parseNarratedArgs(['build'])).toThrow('vizmatic narrated build needs the folder of the film')
        expect(() => parseNarratedArgs(['build', '.', '--quality', 'best'])).toThrow('--quality must be one of draft, standard, high, master, but received best')
        expect(() => parseNarratedArgs(['build', '.', '--workers', 'many'])).toThrow('--workers must be a whole number over 0, but received many')
        expect(() => parseNarratedArgs(['build', '.', '--quality'])).toThrow('--quality needs a value: --quality <draft|standard|high|master>')
        expect(() => parseNarratedArgs(['stills', '.', '--width', '0'])).toThrow('--width must be a whole number over 0')
    })

    it('keeps the stills inside the folder of the film: a name and a scene cannot hold a path', () => {
        expect(() => parseNarratedArgs(['stills', '.', '--name', '../../x'])).toThrow('--name is the name of a folder under stills/')
        expect(() => parseNarratedArgs(['sheet', '.', '--name', 'a/b'])).toThrow('--name is the name of a folder under stills/')
        expect(() => parseNarratedArgs(['stills', '.', '--scene', 'hook,../../x'])).toThrow('--scene takes the ids of scenes, which have letters, digits and hyphens, but received "../../x"')
        expect(parseNarratedArgs(['stills', '.', '--name', 'pick-2', '--scene', 'the-answer']).options.get('--name')).toBe('pick-2')
        expect(() => parseNarratedArgs(['build', '.', '--draft', '--scene', 'a/b'])).toThrow('--scene takes the ids of scenes, which have letters, digits and hyphens, but received "a/b"')
    })

    it('prints each finding of a check in one line, with its time', () => {
        expect(findingLines({ files: [{ source: 'film.ts', diagnostics: [
            { severity: 'warning', code: 'film.blank', message: 'Nothing is visible for 0.38 s.', time: 3.93, until: 4.3 },
            { severity: 'error', code: 'film.text_overlap', message: 'Text "a" overlaps text "b".', time: 5, until: 5 },
        ] }] })).toEqual([
            '  warning film.blank at 3.93s to 4.30s: Nothing is visible for 0.38 s.',
            '  error film.text_overlap at 5.00s: Text "a" overlaps text "b".',
        ])
        expect(findingLines({ files: [{ source: 'film.ts', diagnostics: [] }] })).toEqual([])
    })

    it('stops a build on a finding of the check, a warning too, unless the author allows findings', () => {
        const blank = { files: [{ source: 'film.ts', diagnostics: [{ severity: 'warning', code: 'film.blank', message: 'Nothing is visible for 0.38 s.', time: 3.93, until: 4.3 }] }] }
        const clean = { files: [{ source: 'film.ts', diagnostics: [] }] }
        expect(checkOutcome(clean, false)).toEqual({ lines: ['check: no finding'] })
        expect(checkOutcome(blank, false)).toEqual({
            lines: ['  warning film.blank at 3.93s to 4.30s: Nothing is visible for 0.38 s.'],
            stop: 'the check has 1 finding(s), so the build stops before the render. Fix them, or build with them: add --allow-findings',
        })
        expect(checkOutcome(blank, true)).toEqual({ lines: ['  warning film.blank at 3.93s to 4.30s: Nothing is visible for 0.38 s.', 'check: 1 finding(s), allowed by --allow-findings'] })
    })
})

describe('a narrated film in a folder of films', () => {
    it('is found by the film command when it scans a folder, as a film() file is', async () => {
        const directory = await project()
        await mkdir(join(directory, 'films'))
        await writeFile(join(directory, 'films', 'voice.ts'), `import { circle, fadeIn, narrated } from 'vizmatic/stage'
const timing = { lead: 0.2, gap: 0.2, tail: 0.2, scenes: [{ id: 'one', beats: [{ say: 'One.', duration: 0.6, words: [{ text: 'One.', start: 0.1, end: 0.5 }] }] }] }
export default narrated({ fps: 10, timing, scenes: { one: (s, c) => { c.at(0, () => s.play(fadeIn(circle(80)), { duration: 0.2 })) } } })
`)
        // A helper beside the film is not a film, and the scan leaves it out.
        await writeFile(join(directory, 'films', 'helper.ts'), 'export const size = 80\n')
        const result = cli(['film', 'films', '--frame', '0.5', '--width', '160', '--out', 'out'], directory)
        expect(result.status, result.stderr).toBe(0)
        expect((await readdir(join(directory, 'out'))).filter((name) => name.endsWith('.png'))).toEqual(['voice_t000.500.png'])
    }, 60_000)

    it('writes a film under the name that --name gives, and refuses a name with a folder', async () => {
        const directory = await project()
        await writeFile(join(directory, 'short.ts'), `import { circle, fadeIn, film } from 'vizmatic/stage'
export default film({ fps: 10 }, (s) => { s.play(fadeIn(circle(80)), { duration: 0.4 }) })
`)
        const named = cli(['film', 'short.ts', '--name', 'My-Film-draft', '--frame', '0.2', '--width', '160', '--out', 'out'], directory)
        expect(named.status, named.stderr).toBe(0)
        expect((await readdir(join(directory, 'out'))).filter((name) => name.endsWith('.png'))).toEqual(['My-Film-draft_t000.200.png'])
        const outside = cli(['film', 'short.ts', '--name', '../x', '--frame', '0.2', '--out', 'out'], directory)
        expect(outside.status).not.toBe(0)
        expect(outside.stderr).toContain('--name is the name of the output files')
        expect(cli(['film', 'short.ts', 'short.ts', '--name', 'x', '--out', 'out'], directory).stderr).toContain('--name names the output of one film')
    }, 60_000)

    it('runs the one-file film of the guide with no finding, at rest and in every frame', async () => {
        const directory = await project()
        const guide = await readFile(resolve('docs/guides/narrated-films.md'), 'utf8')
        const films = [...guide.matchAll(/```ts\n([\s\S]*?)```/g)].map((match) => match[1]!).filter((code) => code.includes('export default narrated('))
        expect(films).toHaveLength(1)
        await writeFile(join(directory, 'slow.ts'), films[0]!)
        const check = cli(['check', 'slow.ts', '--motion', '--json'], directory)
        expect(check.status, `${check.stdout}${check.stderr}`).toBe(0)
        const report = JSON.parse(check.stdout)
        expect(report.files[0].diagnostics).toEqual([])
        expect(report.files[0].film.frames).toBeGreaterThan(100)
    }, 60_000)

    it('has no finding when a scene adds its first picture, and an empty frame when the scene fades it in with the slow default fade', async () => {
        const directory = await project()
        const film = (enter: string) => `import { fadeIn, narrated, sceneKit, type SceneClock, type Stage } from 'vizmatic/stage'
const { heading, label } = sceneKit()
const beat = (say: string) => ({ say, duration: 2.4, hold: 1, words: say.split(' ').map((text, i) => ({ text, start: 0.1 + i * 0.4, end: 0.4 + i * 0.4 })) })
const timing = { intro: 0, lead: 0.6, gap: 0.4, tail: 0.5, scenes: [{ id: 'one', title: 'One', beats: [beat('A page takes a long time.')] }, { id: 'two', title: 'Two', beats: [beat('A cache keeps the page.')] }] }
const scene = (name: string) => (s: Stage, c: SceneClock) => {
    const title = heading(name), big = label(name + ': 800 ms', 0, 0, { size: 120 })
    ${enter}
    c.onBeat(0, () => s.play(fadeIn(big, { duration: 0.4 })), 0.5)
}
export default narrated({ timing, scenes: { one: scene('The first heading'), two: scene('The second heading') } })
`
        const codes = async (enter: string) => {
            await writeFile(join(directory, 'two.ts'), film(enter))
            const check = cli(['check', 'two.ts', '--motion', '--json'], directory)
            return (JSON.parse(check.stdout).files[0].diagnostics as { code: string }[]).map((found) => found.code)
        }
        // The film calls the scene when its picture opens, and fades in what the scene adds: no time is typed.
        expect(await codes('s.add(title)')).toEqual([])
        // A fade of the scene itself is left alone. The default fade of 0.8 seconds is too slow for the change of scene.
        expect(await codes('s.play(fadeIn(title))')).toEqual(['film.blank'])
    }, 120_000)

    it.skipIf(!existsSync(resolve('dist/cli.js')))('names the cause when a film of two files loads two copies of the engine', async () => {
        const directory = await project()
        // No "type": "module": the film file is loaded as CommonJS, and the file that it imports as an ES module.
        await writeFile(join(directory, 'package.json'), '{ "name": "plain", "private": true }')
        await writeFile(join(directory, 'helper.ts'), `import { text } from 'vizmatic/stage'\nexport const hello = () => text('hello', { size: 80 })\n`)
        await writeFile(join(directory, 'plain.ts'), `import { fadeIn, film } from 'vizmatic/stage'\nimport { hello } from './helper'\nexport default film({ title: 'plain' }, (s) => { s.play(fadeIn(hello())); s.wait(1) })\n`)
        // The built command line loads a film as a person's project does. From its TypeScript source, one loader reads both files.
        const result = spawnSync(process.execPath, [resolve('dist/cli.js'), 'film', 'plain.ts', '--frame', '0.5', '--width', '160', '--out', 'out'], { cwd: directory, encoding: 'utf8' })
        expect(result.status).not.toBe(0)
        expect(result.stderr).not.toContain('[object Object]')
        expect(result.stderr).toContain('Two copies of vizmatic/stage built this film')
        expect(result.stderr).toContain('Add "type": "module" to the package.json beside the film')
        // On each version of Node the message is the advice, and never "Cannot find module" for a file that exists.
        expect(result.stderr).not.toContain('Cannot find module')
        // A second file that does not import the engine: the film renders in the same folder, on each version of Node.
        await writeFile(join(directory, 'data.ts'), `export const SIZE = 80\nexport const word = (): string => 'hello'\n`)
        await writeFile(join(directory, 'two.ts'), `import { fadeIn, film, text } from 'vizmatic/stage'\nimport { SIZE, word } from './data'\nexport default film({ title: 'two' }, (s) => { s.play(fadeIn(text(word(), { size: SIZE }))); s.wait(1) })\n`)
        const two = spawnSync(process.execPath, [resolve('dist/cli.js'), 'film', 'two.ts', '--frame', '0.5', '--width', '160', '--out', 'out'], { cwd: directory, encoding: 'utf8' })
        expect(two.status, two.stderr).toBe(0)
        expect((await readdir(join(directory, 'out'))).filter((name) => name.endsWith('.png'))).toEqual(['two_t000.500.png'])
        // The copy of the film that the command line loads is gone after the run.
        expect((await readdir(directory)).filter((name) => name.includes('.vizmatic-'))).toEqual([])
    }, 120_000)

    it('gives the advice, and not "Cannot find module", when a film was loaded as CommonJS and asked for the engine by its URL', async () => {
        const { loadFilmDefinition } = await import('../src/film-cli')
        // What require() says of a file URL, on a version of Node that loads the film file as CommonJS.
        const refused = Object.assign(new Error("Cannot find module 'file:///opt/vizmatic/dist/stage.js'\nRequire stack:\n- /films/.intro.vizmatic-1.tsx"), { code: 'MODULE_NOT_FOUND' })
        await expect(loadFilmDefinition(resolve('intro.tsx'), () => Promise.reject(refused))).rejects.toThrow('intro.tsx was loaded as CommonJS, because the package.json beside it has no "type": "module". A film is an ES module. Add "type": "module" to the package.json beside the film.')
        // A module that is truly missing keeps its own message.
        const missing = new Error("Cannot find module './scenes/hook'")
        await expect(loadFilmDefinition(resolve('intro.ts'), () => Promise.reject(missing))).rejects.toBe(missing)
    })
})

describe.skipIf(!hasUv)('the narrated template', () => {
    it('writes a folder with the script, the scenes, the particulars and the notes of a film', async () => {
        const directory = await template()
        const files = (await readdir(join(directory, 'my-film'), { recursive: true })).map(String).sort()
        expect(files).toEqual(expect.arrayContaining([
            '.gitignore', 'README.md', 'film.json', 'film.ts', 'script.json', 'sources.md', 'timing.json',
            join('data', 'numbers.json'), join('scenes', 'answer.ts'), join('scenes', 'kit.ts'), join('scenes', 'question.ts'),
        ]))
        // The film draws the title card, so the template has no file for it.
        expect(files).not.toContain(join('scenes', 'intro.ts'))
        // npm leaves .gitignore out of a package, so the package has the file under another name.
        expect(files).not.toContain('gitignore')
        const readme = await readFile(join(directory, 'my-film', 'README.md'), 'utf8')
        for (const section of ['## Status', '## What it covers', '## How to build', '## Checks', '## What is not checked']) expect(readme).toContain(section)
        const script = JSON.parse(await readFile(join(directory, 'my-film', 'script.json'), 'utf8'))
        expect(script.scenes.map((scene: { id: string }) => scene.id)).toEqual(['question', 'answer'])
        const again = cli(['new', 'my-film', '--template', 'narrated'], directory)
        expect(again.status).not.toBe(0)
        expect(again.stderr).toContain('already exists')
    }, 60_000)

    it('builds as written and passes its check with no finding, at rest and in every frame', async () => {
        const directory = await template()
        const check = cli(['narrated', 'check', 'my-film', '--motion', '--json'], directory)
        expect(check.status, `${check.stdout}${check.stderr}`).toBe(0)
        // The line about the step is on the error stream, so the output is the report and nothing else.
        const report = JSON.parse(check.stdout)
        expect(check.stderr).toContain('> vizmatic check film.ts --look midnight --motion --json')
        expect(report.files[0].film.title).toBe('A cache, in two scenes')
        expect(report.files[0].diagnostics).toEqual([])
        expect(report.files[0].film.frames).toBeGreaterThan(1000)
        // Two scenes, a title card before them, and the gap and the tail after the last word.
        expect(report.files[0].film.duration).toBeGreaterThan(20)
    }, 180_000)

    it('builds for the browser, so that the preview shows the film', async () => {
        const directory = await template()
        const preview = await startPreview({ file: join(directory, 'my-film', 'film.ts'), port: 0 })
        previews.push(preview)
        // A film that imports a part of Node, such as its assert, does not build for the browser, and the preview has no film.
        const built = await fetch(`${preview.url}film.js`)
        expect(built.status).toBe(200)
        const code = await built.text()
        expect(code).toContain('A cache, in two scenes')
        expect(code).not.toContain('node:')
        for (const file of ['film.ts', join('scenes', 'kit.ts'), join('scenes', 'question.ts'), join('scenes', 'answer.ts')]) {
            expect(await readFile(join(directory, 'my-film', file), 'utf8'), file).not.toMatch(/from 'node:|from "node:/)
        }
        // The guide does not tell an author to import it either.
        expect(await readFile(resolve('docs/guides/narrated-films.md'), 'utf8')).not.toContain('node:assert')
    }, 60_000)

    it('prints the steps of a build without running them, why each one runs, and which movie the build writes', async () => {
        const directory = await template()
        const dry = cli(['narrated', 'build', 'my-film', '--draft', '--dry-run'], directory)
        expect(dry.status, dry.stderr).toBe(0)
        expect(dry.stderr.trim().split('\n')).toEqual([
            'build: voice runs: timing.json is a draft: its times are estimates, and there is no voice',
            '> uv run tools/narration/voice.py .',
            'build: mix runs: the voice was made again',
            '> uv run tools/narration/mix.py .',
            'build: beats runs: the times of the beats are new',
            '> uv run tools/narration/beats.py .',
            'build: check runs: the picture can change with any file of the film',
            '> vizmatic check film.ts --look midnight --motion',
            'build: render runs: a draft of the whole film',
            '> vizmatic film film.ts --name A-Cache-in-Two-Scenes-draft --quality draft --out dist --look midnight --format mp4 --workers 3 --audio narration.wav',
            'build: record runs: the movie keeps the timing of its picture, for the resound and sync steps',
            '> uv run tools/narration/record.py . dist/A-Cache-in-Two-Scenes-draft.mp4',
            'build: runs voice, mix, beats, check, render, record. Skipped: none.',
            'build: writes dist/A-Cache-in-Two-Scenes-draft.mp4, a draft. There is no delivered movie yet: a build without --draft writes dist/A-Cache-in-Two-Scenes.mp4.',
        ])
        expect(dry.stdout).toBe('')
        expect(existsSync(join(directory, 'my-film', 'dist'))).toBe(false)
        const stills = cli(['narrated', 'stills', 'my-film', '--scene', 'answer', '--dry-run'], directory)
        expect(stills.stderr).toMatch(/^> VIZMATIC_SCENES=answer vizmatic film film\.ts --frame [\d.]+,[\d.]+ --width 1920 --out stills\/answer --look midnight\n$/)
    }, 60_000)

    it('stops a build at the step that fails, and runs no step after it', async () => {
        const directory = await template()
        const folder = join(directory, 'my-film')
        await writeFile(join(folder, 'film.json'), JSON.stringify({ before: [[process.execPath, '-e', 'process.exit(3)'], [process.execPath, '-e', 'require("fs").writeFileSync("second-ran", "")']] }))
        const build = cli(['narrated', 'build', 'my-film', '--draft'], directory)
        expect(build.status).not.toBe(0)
        expect(build.stderr).toContain('the step "before" failed with exit code 3')
        expect(existsSync(join(folder, 'second-ran'))).toBe(false)
        expect(existsSync(join(folder, 'audio'))).toBe(false)
    }, 60_000)

    it('stops with one line for each mistake in the files of the film, before any step', async () => {
        const directory = await template()
        const folder = join(directory, 'my-film')
        await writeFile(join(folder, 'film.json'), JSON.stringify({ entry: 'missing.ts', quality: 'high', mix: { seed: 'seven' } }))
        const wrong = cli(['narrated', 'check', 'my-film'], directory)
        expect(wrong.status).not.toBe(0)
        expect(wrong.stderr).toContain('verify: film.json: quality: unknown key. The keys are: before, check, entry, look, mix, output, render, voice')
        expect(wrong.stderr).toContain('verify: film.json: entry: missing.ts is missing. Give the film file, such as "film.ts"')
        expect(wrong.stderr).toContain('verify: film.json: mix.seed: "seven" is not a seed. Give a whole number, 0 or more, such as 7')
        expect(wrong.stderr).toContain('vizmatic narrated check did not start: the lines above say what to correct in my-film.')
        await writeFile(join(folder, 'film.json'), '{ "output": ')
        expect(cli(['narrated', 'check', 'my-film'], directory).stderr).toMatch(/verify: film\.json: line 1: is not valid JSON/)
        expect(cli(['narrated', 'check', 'no-such-folder'], directory).stderr).toContain('no-such-folder is not a folder. Give the folder of the film.')
    }, 60_000)

    it('says to make the voice when a step needs the timing and the timing is not there', async () => {
        const directory = await template()
        await rm(join(directory, 'my-film', 'timing.json'))
        const stills = cli(['narrated', 'stills', 'my-film', '--dry-run'], directory)
        expect(stills.status).not.toBe(0)
        expect(stills.stderr).toContain('verify: timing.json: the file: is missing. Run the voice step first: vizmatic narrated voice my-film')
    }, 60_000)

    it('gives the scenes of --scene to the render, and to no other step', async () => {
        const directory = await template()
        const folder = join(directory, 'my-film')
        // The first scene now fails when it is built. With --scene answer, the film builds the second scene alone.
        const question = join(folder, 'scenes', 'question.ts')
        await writeFile(question, (await readFile(question, 'utf8')).replace('export function question(s: Stage, c: SceneClock) {', 'export function question(s: Stage, c: SceneClock) {\n    throw new Error("the question scene was built")'))
        const one = cli(['narrated', 'stills', 'my-film', '--scene', 'answer', '--width', '160'], directory)
        expect(one.status, one.stderr).toBe(0)
        expect(one.stderr).toContain('narrated: only the scene "answer" is built, without the title card, because VIZMATIC_SCENES is set. This is not the whole film.')
        expect((await readdir(join(folder, 'stills', 'answer'))).filter((name) => name.endsWith('.png'))).toHaveLength(2)
        const all = cli(['narrated', 'stills', 'my-film', '--width', '160'], directory)
        expect(all.status).not.toBe(0)
        expect(all.stderr).toContain('narrated: scene "question": the question scene was built')
        // A list of scenes that was left in the environment does not reach a step that builds the whole film.
        const check = cli(['narrated', 'check', 'my-film'], directory, { VIZMATIC_SCENES: 'answer' })
        expect(check.status).not.toBe(0)
        expect(`${check.stdout}${check.stderr}`).toContain('the question scene was built')
    }, 120_000)

    it('lets one run at a time work on a folder, and names the other run', async () => {
        const directory = await template()
        const lock = join(directory, 'my-film', '.narrated.lock')
        // A run that works on the folder now: this test process stands in for it.
        await writeFile(lock, `vizmatic narrated build, process ${process.pid}`)
        const second = cli(['narrated', 'beats', 'my-film'], directory)
        expect(second.status).not.toBe(0)
        expect(second.stderr).toContain(`Another run works on my-film: vizmatic narrated build, process ${process.pid}. Two runs at once on one folder can spoil a movie. Wait for that run to end, then run this command again.`)
        expect(await readFile(lock, 'utf8')).toBe(`vizmatic narrated build, process ${process.pid}`)
        // A dry run changes nothing, so it does not wait.
        expect(cli(['narrated', 'build', 'my-film', '--draft', '--dry-run'], directory).status).toBe(0)
        // A run that was stopped left its lock. Its process is gone, so the next run takes the folder, and gives it back.
        const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' }).stdout.trim()
        await writeFile(lock, `vizmatic narrated build, process ${gone}`)
        const next = cli(['narrated', 'beats', 'my-film'], directory)
        expect(next.status, next.stderr).toBe(0)
        expect(existsSync(lock)).toBe(false)
        // A step that fails gives the folder back too.
        expect(cli(['narrated', 'mix', 'my-film'], directory).status).not.toBe(0)
        expect(existsSync(lock)).toBe(false)
    }, 120_000)

    it('leaves no cache of Python beside the tools of the package', async () => {
        const directory = await template()
        expect(cli(['narrated', 'beats', 'my-film'], directory).status).toBe(0)
        expect(existsSync(resolve('tools/narration/__pycache__'))).toBe(false)
    }, 60_000)
})

describe.skipIf(!hasUv || !hasFfmpeg)('the one command of a film', () => {
    const TOOLS = resolve('tools/narration')
    const script = {
        timeline: { intro: 1, pause: 0.5, gap: 0.5, tail: 0.5 },
        scenes: [
            { id: 'one', title: 'One', beats: [{ say: 'The first page is slow.', hold: 0.6 }] },
            { id: 'two', title: 'Two', beats: [{ say: 'The second page is fast.', hold: 0.6 }] },
        ],
    }
    const filmFile = (more = '') => `import { narrated, sceneKit } from 'vizmatic/stage'
import timing from './timing.json'
const { heading, claimTag } = sceneKit()
export default narrated({
    title: 'Two', fps: 10, timing,${more}
    scenes: {
        one: (s, c) => { s.add(heading('The first heading')); claimTag(c, { word: 'ILLUSTRATION' }) },
        two: (s) => { s.add(heading('The second heading')) },
    },
})
`

    /** A film folder whose voice is made: the takes are tones, and the voice step wrote the timing from them without the voice model. */
    async function spokenFilm(): Promise<{ directory: string; folder: string }> {
        const directory = await project()
        const folder = join(directory, 'film')
        await mkdir(join(folder, 'audio'), { recursive: true })
        await writeFile(join(folder, 'package.json'), '{ "name": "two", "private": true, "type": "module" }')
        await writeFile(join(folder, 'film.ts'), filmFile())
        await writeFile(join(folder, 'film.json'), JSON.stringify({ output: 'Two', render: { workers: 2, draftWorkers: 2 } }))
        await writeFile(join(folder, 'script.json'), JSON.stringify(script))
        for (const scene of script.scenes) {
            const text = scene.beats[0]!.say
            const name = join(folder, 'audio', `${scene.id}-0-${createHash('sha1').update(`af_heart|1.12|${text}`).digest('hex').slice(0, 12)}`)
            const tone = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1.2:sample_rate=24000', `${name}.wav`], { encoding: 'utf8' })
            expect(tone.status, tone.stderr).toBe(0)
            await writeFile(`${name}.json`, JSON.stringify({ duration: 1.2, words: text.split(' ').map((word, index) => ({ text: word, start: 0.05 + index * 0.2, end: 0.2 + index * 0.2 })) }))
        }
        const voice = spawnSync('uv', ['run', '--no-project', '--python', '3.12', 'python', join(TOOLS, 'voice.py'), folder], { encoding: 'utf8', env: { ...process.env, PYTHONPATH: TOOLS, PYTHONDONTWRITEBYTECODE: '1' } })
        expect(voice.status, voice.stderr).toBe(0)
        return { directory, folder }
    }
    const built = (stderr: string) => stderr.split('\n').filter((line) => line.startsWith('build: '))

    it('brings a film up to date from the script to the movie, and runs only the steps that have work to do', async () => {
        const { directory, folder } = await spokenFilm()
        const first = cli(['narrated', 'build', 'film', '--draft'], directory)
        expect(first.status, first.stderr).toBe(0)
        expect(built(first.stderr)).toEqual([
            'build: voice is skipped: timing.json is the voice of this script, and its 2 takes are on the disk',
            'build: mix runs: narration.wav is missing',
            'build: beats is skipped: the timing did not change. To print the beats: vizmatic narrated beats film',
            'build: check runs: the picture can change with any file of the film',
            'build: render runs: a draft of the whole film',
            'build: record runs: the movie keeps the timing of its picture, for the resound and sync steps',
            'build: ran mix, check, render, record. Skipped: voice, beats.',
            'build: wrote dist/Two-draft.mp4, a draft. There is no delivered movie yet: a build without --draft writes dist/Two.mp4.',
        ])
        expect(first.stderr).toContain('check: no finding')
        expect(first.stdout.trim().split('\n').at(-1)).toBe(join('film', 'dist', 'Two-draft.mp4'))
        // A draft writes only files with "draft" in their name: its movie, its captions, its manifest, and the timing of its picture.
        expect((await readdir(join(folder, 'dist'))).sort()).toEqual(['Two-draft.manifest.json', 'Two-draft.mp4', 'Two-draft.timing.json', 'Two-draft.vtt'])
        // A second build makes no voice and no mix again, and says why.
        const second = cli(['narrated', 'build', 'film', '--draft'], directory)
        expect(second.status, second.stderr).toBe(0)
        expect(built(second.stderr).slice(0, 3)).toEqual([
            'build: voice is skipped: timing.json is the voice of this script, and its 2 takes are on the disk',
            'build: mix is skipped: narration.wav is the mix of this timing and of this film.json',
            'build: beats is skipped: the timing did not change. To print the beats: vizmatic narrated beats film',
        ])
        expect(built(second.stderr).at(-2)).toBe('build: ran check, render, record. Skipped: voice, mix, beats.')
        // A change of the mix in film.json: the mix has work again.
        await writeFile(join(folder, 'film.json'), JSON.stringify({ output: 'Two', render: { workers: 2, draftWorkers: 2 }, mix: { seed: 5 } }))
        const dry = cli(['narrated', 'build', 'film', '--draft', '--dry-run'], directory)
        expect(built(dry.stderr)[1]).toBe('build: mix runs: the timing or the mix of film.json changed after the last mix')

        // The delivered movie. The draft and its files stay as they are.
        const draft = await readFile(join(folder, 'dist', 'Two-draft.mp4'))
        const final = cli(['narrated', 'build', 'film'], directory)
        expect(final.status, final.stderr).toBe(0)
        expect(built(final.stderr).at(-1)).toBe('build: wrote dist/Two.mp4, the delivered movie.')
        expect((await readdir(join(folder, 'dist'))).sort()).toEqual([
            'Two-draft.manifest.json', 'Two-draft.mp4', 'Two-draft.timing.json', 'Two-draft.vtt', 'Two.manifest.json', 'Two.mp4', 'Two.timing.json', 'Two.vtt',
        ])
        expect((await readFile(join(folder, 'dist', 'Two-draft.mp4'))).equals(draft)).toBe(true)
        // The movie keeps the timing that its picture was rendered with, and the sync and resound steps find it there.
        const kept = JSON.parse(await readFile(join(folder, 'dist', 'Two.timing.json'), 'utf8'))
        expect(kept.timing).toEqual(JSON.parse(await readFile(join(folder, 'timing.json'), 'utf8')))
        const resound = cli(['narrated', 'resound', 'film'], directory)
        expect(resound.status, resound.stderr).toBe(0)
        expect(resound.stderr).toContain('Its picture was rendered with the timing of timing.json, by the record that the build keeps beside it.')

        // A build that stops in its render leaves no record: the build deletes the old one before the render starts.
        // Here the render stops because its FFmpeg fails. A new picture is then never beside the record of an old one.
        const bin = join(directory, 'bin')
        await mkdir(bin)
        await writeFile(join(bin, 'ffmpeg'), '#!/bin/bash\necho "this ffmpeg fails" >&2\nexit 1\n', { mode: 0o755 })
        expect(existsSync(join(folder, 'dist', 'Two.timing.json'))).toBe(true)
        const stopped = cli(['narrated', 'build', 'film'], directory, { PATH: `${bin}:${process.env['PATH']}` })
        expect(stopped.status).not.toBe(0)
        expect(stopped.stderr).toContain('the step "render" failed')
        expect(existsSync(join(folder, 'dist', 'Two.timing.json'))).toBe(false)
        // The draft has its own record, which this build did not touch.
        expect(existsSync(join(folder, 'dist', 'Two-draft.timing.json'))).toBe(true)
        // The steps that read the movie refuse it, and name the build.
        if (existsSync(join(folder, 'dist', 'Two.mp4'))) {
            const refused = cli(['narrated', 'resound', 'film'], directory)
            expect(refused.status).not.toBe(0)
            expect(refused.stderr).toContain('resound: Two.mp4 has no record of the timing of its picture, so nothing says which timing its picture was rendered with. Build it again, with a full render: vizmatic narrated build film. The movie was not replaced')
        }
        const rebuilt = cli(['narrated', 'build', 'film'], directory)
        expect(rebuilt.status, rebuilt.stderr).toBe(0)
        expect(existsSync(join(folder, 'dist', 'Two.timing.json'))).toBe(true)

        // A draft of one scene: its own file, and that part of the film alone. The film is 6.6 seconds long.
        const delivered = await readFile(join(folder, 'dist', 'Two.mp4'))
        const part = cli(['narrated', 'build', 'film', '--draft', '--scene', 'two'], directory)
        expect(part.status, part.stderr).toBe(0)
        expect(part.stderr).toContain('narrated: only the scene "two" is built, without the title card, because VIZMATIC_SCENES is set. This is not the whole film.')
        expect(built(part.stderr).at(-1)).toBe('build: wrote dist/Two-draft-two.mp4, a draft of the scene "two" alone. The delivered movie dist/Two.mp4 is left as it is.')
        const length = (name: string) => Number(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(folder, 'dist', name)], { encoding: 'utf8' }).stdout)
        expect(length('Two.mp4')).toBeCloseTo(6.6, 1)
        expect(length('Two-draft-two.mp4')).toBeGreaterThan(2.5)
        expect(length('Two-draft-two.mp4')).toBeLessThan(4.5)
        expect(existsSync(join(folder, 'dist', 'Two-draft-two.timing.json'))).toBe(false)
        expect((await readFile(join(folder, 'dist', 'Two.mp4'))).equals(delivered)).toBe(true)
        // The delivered movie is never a part of the film: not with --scene, and not with a list of scenes in the film file.
        const refused = cli(['narrated', 'build', 'film', '--scene', 'two'], directory)
        expect(refused.status).not.toBe(0)
        expect(refused.stderr).toContain('--scene makes a movie of some scenes, and that is a draft: add --draft')
        await writeFile(join(folder, 'film.ts'), filmFile("\n    only: ['one'],"))
        const only = cli(['narrated', 'build', 'film'], directory)
        expect(only.status).not.toBe(0)
        expect(`${only.stdout}${only.stderr}`).toContain('narrated: "only" is not an option. A film file always holds every scene.')
        expect((await readFile(join(folder, 'dist', 'Two.mp4'))).equals(delivered)).toBe(true)
        // A list of scenes that was left in the environment does not make a delivered movie of a part either.
        await writeFile(join(folder, 'film.ts'), filmFile())
        const whole = cli(['narrated', 'build', 'film'], directory, { VIZMATIC_SCENES: 'one' })
        expect(whole.status, whole.stderr).toBe(0)
        expect(whole.stderr).not.toContain('This is not the whole film')
        expect(length('Two.mp4')).toBeCloseTo(6.6, 1)
    }, 600_000)

    it('stops before the render on a finding of the check, and leaves the movies', async () => {
        const { directory, folder } = await spokenFilm()
        // Two headings at one place in one scene.
        await writeFile(join(folder, 'film.ts'), filmFile().replace("s.add(heading('The second heading'))", "s.add(heading('The second heading'), heading('Another heading at its place'))"))
        const build = cli(['narrated', 'build', 'film', '--draft'], directory)
        expect(build.status).not.toBe(0)
        expect(build.stderr).toMatch(/ {2}(error|warning) film\.text_overlap/)
        expect(build.stderr).toContain('so the build stops before the render. Fix them, or build with them: add --allow-findings')
        expect(existsSync(join(folder, 'dist'))).toBe(false)
    }, 300_000)
})
