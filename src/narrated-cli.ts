/**
 * `vizmatic narrated <step> <folder>`: the build of a narrated film, and its single steps.
 *
 * A film folder holds the script, the scenes and `film.json`. The steps for the sound are Python tools
 * under `tools/narration/` of the package, which `uv` runs. The steps for the picture are the `check`
 * and `film` commands of this command line. Each command here is a plan: a list of steps that run in
 * the folder, in order, and stop at the first failure.
 *
 * `build` is the one command of a film: it brings the voice, the mix, the check and the movie up to date,
 * runs only the steps that have work to do, and says why it ran or skipped each one.
 *
 * The files of the film are checked in one place, the `verify` tool, before any step runs.
 */
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { join, relative, resolve } from 'path'
import { fileURLToPath } from 'url'
import type { Quality } from './stage/export'
import { LOOKS, type LookName } from './stage/look'
import { narration, type NarrationTiming } from './stage/narration'
import { Stage } from './stage/stage'

/** What `film.json` gives the command line, with a default for each key. The `verify` tool checks and fills it. */
export interface NarratedParticulars {
    /** The film file, in the folder. Defaults to film.ts. */
    entry: string
    /** The name of the movie in dist/, without its extension. Defaults to the name of the film file. */
    output: string
    /** Defaults to midnight. */
    look: LookName
    /** More options for the check, such as ["--text-margin", "30"]. */
    check: string[]
    /** Render threads: for a build, and for a draft. Defaults to 6 and 3. */
    render: { workers: number; draftWorkers: number }
    /** Commands that run in the folder before the voice, such as one that computes the data of the film. */
    before: string[][]
    /** For a build: is timing.json the voice of this script, with its takes on the disk, and why. */
    voice: { current: boolean; why: string }
    /** For a build: is narration.wav the mix of this timing and of the mix of film.json, and why. */
    mix: { current: boolean; why: string }
    /** Where each scene is in the film, in seconds, when the timing is current: its first word, and the end of its last hold. */
    scenes: { id: string; start: number; end: number }[]
    /** The silence between two scenes, and the length of the film, in seconds. */
    gap: number
    length: number
}

interface StepSpec {
    /** One line for the list of the steps. */
    note: string
    /** The options of the step. A value names what an option takes, and an empty value is a flag. */
    options: Readonly<Record<string, string>>
    /** What the words after the folder are, for a step that takes some. */
    words?: string
}

const DRY_RUN = { '--dry-run': '' }
const MOVIE = { '--draft': '', ...DRY_RUN }

export const NARRATED_STEPS = {
    build: { note: 'Bring the film up to date, from the script to the movie: the voice of each beat that changed, the mix, the beat list, the check, and the render. It says why it runs or skips each step. With --draft, the movie is <name>-draft.mp4.', options: { '--draft': '', '--scene': 'id,...', '--quality': 'draft|standard|high|master', '--workers': 'n', '--allow-findings': '', ...DRY_RUN } },
    voice: { note: 'Speak script.json on this machine. Writes audio/ and timing.json.', options: DRY_RUN },
    draft: { note: 'Write a timing with estimated times and no sound, for a first look at the scenes.', options: DRY_RUN },
    mix: { note: 'Lay the voice on the timeline with the pad and the chimes. Writes narration.wav.', options: DRY_RUN },
    check: { note: 'Check the layout of the film, at rest and with --motion in every frame.', options: { '--motion': '', '--json': '', '--content-top': 'px', '--text-margin': 'px', '--reading-speed': 'n', '--stepped': '', ...DRY_RUN } },
    stills: { note: 'One full-size still for each beat, or for the times of --frame.', options: { '--scene': 'id,...', '--frame': 't,...', '--name': 'name', '--width': 'n', ...DRY_RUN } },
    sheet: { note: 'Contact sheets of the film.', options: { '--scene': 'id,...', '--name': 'name', '--every': 'seconds', '--range': 'a:b', '--frame': 't,...', '--columns': 'n', '--width': 'n', ...DRY_RUN } },
    beats: { note: 'Print where each beat starts and ends. With --words, the spoken words of a scene, to choose a cue.', options: { '--words': '', ...DRY_RUN }, words: 'scene ...' },
    transcribe: { note: 'Transcribe each take, and show the words that differ from the script.', options: DRY_RUN, words: 'scene or scene/beat ...' },
    sync: { note: 'Transcribe the rendered movie, and compare the voice with the timeline.', options: MOVIE, words: 'movie.mp4' },
    lag: { note: 'The lag of each take in the movie that sync read, to a sample.', options: DRY_RUN },
    probe: { note: 'The streams, the chapters, the captions and the hash of the rendered movie.', options: MOVIE, words: 'movie.mp4' },
    resound: { note: 'Put a new narration.wav into the rendered movie, without a new render of the picture.', options: MOVIE, words: 'movie.mp4' },
} as const satisfies Record<string, StepSpec>

export type NarratedCommand = keyof typeof NARRATED_STEPS

export interface NarratedRequest {
    command: NarratedCommand
    /** The folder of the film, as an absolute path. */
    folder: string
    /** The folder as the person named it, for the commands that a step suggests. */
    shown: string
    /** The options of the step that were given. A flag has the value true. */
    options: ReadonlyMap<string, string | true>
    /** The words after the folder: scenes, beats, or a movie. */
    words: readonly string[]
}

export type NarratedStep = (
    /** A command that runs in the folder. `words` is the short form that a person reads. */
    | { kind: 'run'; label: string; command: string; args: string[]; words: string[]; env?: Record<string, string> }
    /** The layout check of a build. A finding stops the build, unless the author allows findings. */
    | { kind: 'check'; label: string; command: string; args: string[]; words: string[]; allowFindings: boolean }
) & {
    /** For a step of a build: why it runs. */
    why?: string
    /** For a step of a build: why it does not run. A step with this is not run. */
    skip?: string
}

const QUALITIES: readonly Quality[] = ['draft', 'standard', 'high', 'master']
// A name that goes into a path under the folder of the film: no folder, and no way up.
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SCENE_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/
// The Python tools sit beside dist/ in the package, and beside src/ in the repository.
const TOOLS = fileURLToPath(new URL('../tools/narration/', import.meta.url))

function optionList(command: NarratedCommand): string {
    return Object.entries(NARRATED_STEPS[command].options).map(([name, takes]) => (takes ? `${name} <${takes}>` : name)).join(', ')
}

function usageText(): string {
    const steps = Object.entries(NARRATED_STEPS).map(([name, step]) => `  ${name.padEnd(12)}${step.note}\n${' '.repeat(14)}${optionList(name as NarratedCommand)}`).join('\n')
    return `vizmatic narrated <step> <folder> [options]\n\nSteps, each with its options:\n${steps}\n\n--dry-run checks the files of the film, prints the steps, and runs none.`
}

/** Read a command line. An option that the step does not have is an error, so a mistyped option never runs the step with its defaults. */
export function parseNarratedArgs(argv: readonly string[]): NarratedRequest {
    const [command, folder] = argv
    if (!command || !Object.hasOwn(NARRATED_STEPS, command)) throw new Error(`${command ? `Unknown step ${JSON.stringify(command)} for vizmatic narrated.\n\n` : ''}${usageText()}`)
    if (!folder || folder.startsWith('--')) throw new Error(`vizmatic narrated ${command} needs the folder of the film, such as: vizmatic narrated ${command} .`)
    const step: StepSpec = NARRATED_STEPS[command as NarratedCommand]
    const options = new Map<string, string | true>(), words: string[] = []
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i]!
        if (!arg.startsWith('--')) {
            if (!step.words) throw new Error(`vizmatic narrated ${command} takes the folder and no other word, but received ${JSON.stringify(arg)}. Its options are: ${optionList(command as NarratedCommand)}`)
            words.push(arg)
        } else if (!Object.hasOwn(step.options, arg)) {
            throw new Error(`Unknown option ${arg} for vizmatic narrated ${command}. Its options are: ${optionList(command as NarratedCommand)}`)
        } else if (step.options[arg]) {
            const value = argv[++i]
            if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value: ${arg} <${step.options[arg]}>`)
            options.set(arg, value)
        } else {
            options.set(arg, true)
        }
    }
    const request: NarratedRequest = { command: command as NarratedCommand, folder: resolve(folder), shown: folder, options, words }
    checkValues(request)
    return request
}

function value(request: NarratedRequest, name: string): string | undefined {
    const found = request.options.get(name)
    return typeof found === 'string' ? found : undefined
}

function scenesOf(request: NarratedRequest): string[] {
    return (value(request, '--scene') ?? '').split(',').map((id) => id.trim()).filter(Boolean)
}

/** Stop on a value that is not of its kind, before any step runs. A name and a scene go into paths under the folder. */
function checkValues(request: NarratedRequest): void {
    const quality = value(request, '--quality')
    if (quality !== undefined && !QUALITIES.includes(quality as Quality)) throw new Error(`--quality must be one of ${QUALITIES.join(', ')}, but received ${quality}`)
    for (const name of ['--workers', '--width', '--columns']) {
        const given = value(request, name)
        if (given !== undefined && !(Number.isInteger(Number(given)) && Number(given) > 0)) throw new Error(`${name} must be a whole number over 0, but received ${given}`)
    }
    const name = value(request, '--name')
    if (name !== undefined && !FILE_NAME.test(name)) throw new Error(`--name is the name of a folder under stills/, with letters, digits, dots, hyphens and underscores, but received ${JSON.stringify(name)}`)
    for (const id of scenesOf(request)) {
        if (!SCENE_ID.test(id)) throw new Error(`--scene takes the ids of scenes, which have letters, digits and hyphens, but received ${JSON.stringify(id)}`)
    }
}

/**
 * One time for each beat, for a full-size still of each: just before its voice ends, when its picture is
 * complete. The last beat of a scene is taken earlier, before the scene starts to clear.
 */
export function stillTimes(timing: NarrationTiming, scenes: readonly string[] = []): number[] {
    const voice = narration(new Stage({}), timing, { captions: false, chapters: false })
    for (const id of scenes) voice.scene(id)
    return voice.scenes.filter((scene) => scenes.length === 0 || scenes.includes(scene.id)).flatMap((scene) => scene.beats.map((beat, index) => {
        const last = index === scene.beats.length - 1
        return Math.round((beat.end - (last ? 0.45 : 0.05)) * 100) / 100
    }))
}

/** The options of a request as words, for the tool or the command that takes them as they are. */
function optionWords(request: NarratedRequest, names?: readonly string[]): string[] {
    return [...request.options].filter(([name]) => name !== '--dry-run' && (!names || names.includes(name))).flatMap(([name, given]) => (given === true ? [name] : [name, given]))
}

/** A step that runs one of the Python tools on the folder. */
function tool(name: string, folder: string, args: readonly string[] = []): NarratedStep {
    return { kind: 'run', label: name, command: 'uv', args: ['run', join(TOOLS, `${name}.py`), folder, ...args], words: ['uv', 'run', `tools/narration/${name}.py`, '.', ...args] }
}

/** A step that runs this command line again in the folder: the check, the render, the stills. */
function vizmatic(self: readonly string[], label: string, args: readonly string[], env?: Record<string, string>): NarratedStep {
    const [node, ...script] = self
    return { kind: 'run', label, command: node!, args: [...script, ...args], words: ['vizmatic', ...args], ...(env ? { env } : {}) }
}

function checkArgs(film: NarratedParticulars, more: readonly string[] = []): string[] {
    return ['check', film.entry, '--look', film.look, ...film.check, ...more]
}

/** What a build makes: the delivered movie, a draft of the whole film, or a draft of some scenes. */
interface BuildTarget {
    draft: boolean
    quality: Quality
    /** The scenes of a draft of a part of the film, in the order of the film. Empty for the whole film. */
    scenes: string[]
    /** The name of the movie in dist/, without its extension. */
    name: string
}

/**
 * The name of the movie that a build writes. A draft has "draft" in the name of every file that it writes,
 * so it never replaces a file of the delivered film.
 */
export function movieName(film: Pick<NarratedParticulars, 'output'>, draft: boolean, scenes: readonly string[] = []): string {
    return `${film.output}${draft ? '-draft' : ''}${scenes.map((id) => `-${id}`).join('')}`
}

function buildTarget(request: NarratedRequest, film: NarratedParticulars): BuildTarget {
    const asked = value(request, '--quality') as Quality | undefined
    const draft = request.options.has('--draft') || asked === 'draft'
    const wanted = scenesOf(request)
    if (wanted.length > 0 && !draft) throw new Error('--scene makes a movie of some scenes, and that is a draft: add --draft. The delivered movie always holds every scene.')
    // The scenes are known when the timing is current. Before the first voice, the render step checks them.
    const known = film.scenes.map((scene) => scene.id)
    const unknown = known.length > 0 ? wanted.filter((id) => !known.includes(id)) : []
    if (unknown.length > 0) throw new Error(`--scene names the scene ${unknown.map((id) => JSON.stringify(id)).join(', ')}, and the film has no scene with that id. Its scenes are: ${known.join(', ')}`)
    const scenes = known.length > 0 ? known.filter((id) => wanted.includes(id)) : wanted
    return { draft, quality: asked ?? (draft ? 'draft' : 'high'), scenes, name: movieName(film, draft, scenes) }
}

/** The part of the film that a draft of some scenes shows: from just before its first scene opens to the start of the scene after its last one. */
function sceneRange(film: NarratedParticulars, scenes: readonly string[]): [number, number] | undefined {
    const chosen = film.scenes.filter((scene) => scenes.includes(scene.id))
    if (chosen.length === 0) return undefined
    const round = (seconds: number) => Math.round(seconds * 100) / 100
    const last = chosen[chosen.length - 1]!
    // The picture of the last scene of the film stays to the end of the film.
    const end = last.id === film.scenes[film.scenes.length - 1]!.id ? film.length : last.end + film.gap
    return [round(Math.max(0, chosen[0]!.start - film.gap - 0.3)), round(end)]
}

/**
 * The steps of a build, in order: the commands of the film, the voice, the mix, the beat list, the check
 * with motion, the render, and the record of the timing of the picture. A step with `skip` has no work to
 * do, and says why. `voiceRan` is true when the voice step ran, or runs: the mix and the beat list follow it.
 */
export function buildSteps(request: NarratedRequest, film: NarratedParticulars, self: readonly string[], voiceRan = !film.voice.current): NarratedStep[] {
    const target = buildTarget(request, film)
    const workers = value(request, '--workers') ?? String(target.draft ? film.render.draftWorkers : film.render.workers)
    const [node, ...script] = self
    const partial = target.scenes.length > 0
    const check = checkArgs(film, ['--motion'])
    const range = partial ? sceneRange(film, target.scenes) : undefined
    const movie = join('dist', `${target.name}.mp4`)
    const render = vizmatic(self, 'render', [
        'film', film.entry, '--name', target.name, '--quality', target.quality, '--out', 'dist', '--look', film.look, '--format', 'mp4', '--workers', workers, '--audio', 'narration.wav',
        ...(range ? ['--range', `${range[0]}:${range[1]}`] : []),
    ], partial ? { VIZMATIC_SCENES: target.scenes.join(',') } : undefined)
    const again = `vizmatic narrated beats ${request.shown}`
    return [
        ...film.before.map(([command, ...args]): NarratedStep => ({ kind: 'run', label: 'before', command: command!, args, words: [command!, ...args], why: 'film.json lists it under "before"' })),
        { ...tool('voice', request.folder), ...(film.voice.current ? { skip: film.voice.why } : { why: film.voice.why }) },
        { ...tool('mix', request.folder), ...(voiceRan ? { why: 'the voice was made again' } : film.mix.current ? { skip: film.mix.why } : { why: film.mix.why }) },
        { ...tool('beats', request.folder), ...(voiceRan ? { why: 'the times of the beats are new' } : { skip: `the timing did not change. To print the beats: ${again}` }) },
        partial
            ? { kind: 'check', label: 'check', command: node!, args: [...script, ...check], words: ['vizmatic', ...check], allowFindings: true, skip: `a check of some scenes would report the other scenes as empty frames. To check the film: vizmatic narrated check ${request.shown} --motion` }
            : { kind: 'check', label: 'check', command: node!, args: [...script, ...check], words: ['vizmatic', ...check], allowFindings: request.options.has('--allow-findings'), why: 'the picture can change with any file of the film' },
        // The render writes the movie under its own name. No step writes to the path of another movie.
        { ...render, why: partial ? `a draft of ${target.scenes.join(', ')} alone` : target.draft ? 'a draft of the whole film' : 'the delivered movie' },
        { ...tool('record', request.folder, [movie]), ...(partial ? { skip: 'a movie of some scenes has no timing of its own' } : { why: 'the movie keeps the timing of its picture, for the resound and sync steps' }) },
    ]
}

/** The folder under stills/ for the stills of a command. Without a name, it says what they are. */
function stillsFolder(request: NarratedRequest): string {
    const name = value(request, '--name'), scenes = scenesOf(request)
    if (name) return join('stills', name)
    if (scenes.length > 0) return join('stills', scenes.join('-'))
    if (request.command === 'sheet') return join('stills', 'sheet')
    return join('stills', request.options.has('--frame') ? 'frames' : 'beats')
}

/** Stills or contact sheets of the film. With scenes, `narrated()` builds only those, at their times in the whole film. */
function picturesStep(request: NarratedRequest, film: NarratedParticulars, self: readonly string[], which: readonly string[]): NarratedStep {
    const scenes = scenesOf(request)
    return vizmatic(self, request.command, ['film', film.entry, ...which, '--out', stillsFolder(request), '--look', film.look], scenes.length > 0 ? { VIZMATIC_SCENES: scenes.join(',') } : undefined)
}

/** The steps of one command, in order. `self` is how to run this command line again, for the check and the render. */
export function planNarrated(request: NarratedRequest, film: NarratedParticulars, self: readonly string[], timing?: NarrationTiming): NarratedStep[] {
    switch (request.command) {
        case 'build':
            return buildSteps(request, film, self)
        case 'resound':
            // A draft and the delivered movie are named by the option. A path of a movie is made absolute from where the person is.
            return [tool('resound', request.folder, [...request.words.map((word) => resolve(word)), ...optionWords(request)])]
        case 'check':
            return [vizmatic(self, 'check', checkArgs(film, optionWords(request)))]
        case 'stills': {
            const times = value(request, '--frame') ?? stillTimes(timing ?? { scenes: [] }, scenesOf(request)).join(',')
            if (times === '') throw new Error('vizmatic narrated stills found no beat. Give the times with --frame.')
            return [picturesStep(request, film, self, ['--frame', times, '--width', value(request, '--width') ?? '1920'])]
        }
        case 'sheet':
            return [picturesStep(request, film, self, ['--sheet', ...optionWords(request, ['--every', '--range', '--frame', '--columns', '--width'])])]
        case 'sync':
        case 'probe':
            // The tool runs in the folder of the film, so the path of a movie is made absolute from where the person is.
            return [tool(request.command, request.folder, [...request.words.map((word) => resolve(word)), ...optionWords(request)])]
        default:
            return [tool(request.command, request.folder, [...request.words, ...optionWords(request)])]
    }
}

/** What a build writes, and which movie it leaves alone. `verb` is "wrote" after a build, and "writes" for a dry run. */
export function buildReport(film: NarratedParticulars, draft: boolean, deliveredExists: boolean, verb: 'wrote' | 'writes' = 'wrote', scenes: readonly string[] = []): string {
    const written = join('dist', `${movieName(film, draft, scenes)}.mp4`), delivered = join('dist', `${film.output}.mp4`)
    if (!draft) return `build: ${verb} ${written}, the delivered movie.`
    const left = deliveredExists ? `The delivered movie ${delivered} is left as it is.` : `There is no delivered movie yet: a build without --draft writes ${delivered}.`
    const what = scenes.length > 0 ? `a draft of the scene ${scenes.map((id) => JSON.stringify(id)).join(', ')} alone` : 'a draft'
    return `build: ${verb} ${written}, ${what}. ${left}`
}

/** One line for a step of a build: that it runs and why, or that it is skipped and why. */
export function stepLine(step: NarratedStep): string {
    return step.skip !== undefined ? `build: ${step.label} is skipped: ${step.skip}` : `build: ${step.label} runs: ${step.why ?? 'it is a step of the build'}`
}

function shown(step: NarratedStep): string {
    const env = step.kind === 'run' ? Object.entries(step.env ?? {}).map(([name, given]) => `${name}=${given} `).join('') : ''
    return `${env}${step.words.join(' ')}`
}

/** What every step gets: the folder as the person named it, the looks, and no cache of Python beside the tools. */
function stepEnvironment(request: NarratedRequest, own: Record<string, string> = {}): NodeJS.ProcessEnv {
    return {
        ...process.env,
        // Python must not write its cache beside the tools, which are inside the installed package.
        PYTHONDONTWRITEBYTECODE: '1',
        VIZMATIC_FOLDER: request.shown,
        VIZMATIC_LOOKS: Object.keys(LOOKS).join(','),
        // A list of scenes that was left in the environment must not make a partial movie. A step that wants scenes sets them.
        VIZMATIC_SCENES: '',
        ...own,
    }
}

function failure(step: NarratedStep, result: ReturnType<typeof spawnSync>): Error | undefined {
    if (result.error) {
        const missing = (result.error as NodeJS.ErrnoException).code === 'ENOENT'
        const hint = step.command === 'uv' ? ' The sound tools and the check of the files run with uv: https://docs.astral.sh/uv/' : ''
        return new Error(missing ? `${step.command} is not installed, and the step "${step.label}" needs it.${hint}` : `the step "${step.label}" did not start: ${result.error.message}`)
    }
    if (result.status !== 0) return new Error(`the step "${step.label}" failed${result.status === null ? '' : ` with exit code ${result.status}`}`)
    return undefined
}

export interface CheckReport {
    files: { source: string; diagnostics: { severity: string; code: string; message: string; time?: number; until?: number }[] }[]
}

/** The findings of a check, one line each, for the error stream. */
export function findingLines(report: CheckReport): string[] {
    return report.files.flatMap((file) => file.diagnostics.map((found) => {
        const when = found.time === undefined ? '' : found.until !== undefined && found.until !== found.time ? ` at ${found.time.toFixed(2)}s to ${found.until.toFixed(2)}s` : ` at ${found.time.toFixed(2)}s`
        return `  ${found.severity} ${found.code}${when}: ${found.message}`
    }))
}

/**
 * What the check of a build says, and if the build stops. A build with a finding stops before the render,
 * because a render takes minutes and a finding is cheaper to fix first. The author can allow findings.
 */
export function checkOutcome(report: CheckReport, allowFindings: boolean): { lines: string[]; stop?: string } {
    const lines = findingLines(report)
    if (lines.length === 0) return { lines: ['check: no finding'] }
    if (allowFindings) return { lines: [...lines, `check: ${lines.length} finding(s), allowed by --allow-findings`] }
    return { lines, stop: `the check has ${lines.length} finding(s), so the build stops before the render. Fix them, or build with them: add --allow-findings` }
}

/** Run the layout check of a build, and stop the build on a finding. */
function runCheck(step: Extract<NarratedStep, { kind: 'check' }>, request: NarratedRequest): void {
    const result = spawnSync(step.command, [...step.args, '--json'], { cwd: request.folder, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: stepEnvironment(request) })
    let report: CheckReport | undefined
    try {
        report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))) as CheckReport
    } catch {
        // The check did not get as far as its report: its own message is on the error stream.
    }
    if (!report) throw failure(step, result) ?? new Error('the check printed no report')
    const outcome = checkOutcome(report, step.allowFindings)
    for (const line of outcome.lines) console.error(line)
    if (outcome.stop) throw new Error(outcome.stop)
}

function runStep(step: NarratedStep, request: NarratedRequest): void {
    if (step.kind === 'check') return runCheck(step, request)
    const result = spawnSync(step.command, step.args, { cwd: request.folder, stdio: 'inherit', env: stepEnvironment(request, step.env) })
    const failed = failure(step, result)
    if (failed) throw failed
}

/** Check the files of the film with the `verify` tool, and read the particulars that it prints. Its problems go to the error stream. */
function readParticulars(request: NarratedRequest, step: string = request.command): NarratedParticulars {
    const verify = tool('verify', request.folder, ['--step', step, '--json'])
    if (verify.kind !== 'run') throw new Error('verify is a tool')
    const result = spawnSync(verify.command, verify.args, { cwd: request.folder, stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', env: stepEnvironment(request) })
    if (result.error) throw failure(verify, result)!
    if (result.status !== 0) throw new Error(`vizmatic narrated ${request.command} did not start: the lines above say what to correct in ${request.shown}.`)
    return JSON.parse(result.stdout) as NarratedParticulars
}

/**
 * Run a build: each step that has work to do, in order. The voice step can change the timing, so the steps
 * after it are planned again when it ran. Returns the names of the steps that ran and of those that did not.
 */
function runBuild(request: NarratedRequest, self: readonly string[], dryRun: boolean): { film: NarratedParticulars; ran: string[]; skipped: string[] } {
    let film = readParticulars(request)
    let steps = buildSteps(request, film, self)
    const ran: string[] = [], skipped: string[] = []
    let timingHash: string | undefined
    for (let index = 0; index < steps.length; index++) {
        let step = steps[index]!
        console.error(stepLine(step))
        if (step.skip !== undefined) {
            skipped.push(step.label)
        } else {
            if (step.label === 'render' && !dryRun) {
                // The record gets the timing as it was before the render, so a timing that changed in between is not taken for the timing of the picture.
                timingHash = createHash('sha256').update(readFileSync(join(request.folder, 'timing.json'))).digest('hex')
                // The old record goes before the render starts. A build that stops at any point then leaves a movie
                // with no record, which the resound and sync steps refuse, and never a new picture beside an old record.
                rmSync(join(request.folder, 'dist', `${step.args[step.args.indexOf('--name') + 1]}.timing.json`), { force: true })
            }
            if (step.label === 'record' && timingHash) step = { ...step, args: [...step.args, '--timing', timingHash] }
            console.error(`> ${shown(step)}`)
            if (!dryRun) runStep(step, request)
            ran.push(step.label)
        }
        // After the voice, the timing and its takes are current: read what the mix and the render need.
        if (step.label === 'voice' && !dryRun) {
            film = readParticulars(request, 'render')
            steps = buildSteps(request, film, self, step.skip === undefined)
        }
    }
    return { film, ran, skipped }
}

/**
 * Take the folder for one run, and return how to give it back. Two runs at once on one folder can spoil a
 * movie: a resound that started before a build ends puts the old picture over the new one. The lock names
 * the run that holds it. A lock of a run that is gone, such as one that was stopped, is taken over.
 */
export function lockFolder(request: NarratedRequest): () => void {
    const path = join(request.folder, '.narrated.lock')
    for (;;) {
        try {
            writeFileSync(path, `vizmatic narrated ${request.command}, process ${process.pid}`, { flag: 'wx' })
            return () => rmSync(path, { force: true })
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            const other = existsSync(path) ? readFileSync(path, 'utf8') : ''
            const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
            if (alive(Number(/process (\d+)$/.exec(other)?.[1]))) {
                throw new Error(`Another run works on ${request.shown}: ${other}. Two runs at once on one folder can spoil a movie. Wait for that run to end, then run this command again.`)
            }
            rmSync(path, { force: true })
        }
    }
}

/** Run one command of `vizmatic narrated`. The lines about the steps go to the error stream, so the output of a step that prints data stays data. */
export async function runNarratedCommand(argv: readonly string[]): Promise<void> {
    if (argv.length === 0) {
        console.log(usageText())
        return
    }
    const request = parseNarratedArgs(argv)
    if (!existsSync(request.folder)) throw new Error(`${relative(process.cwd(), request.folder) || request.folder} is not a folder. Give the folder of the film.`)
    const dryRun = request.options.has('--dry-run')
    const unlock = dryRun ? () => {} : lockFolder(request)
    try {
        await runLocked(request, dryRun)
    } finally {
        unlock()
    }
}

async function runLocked(request: NarratedRequest, dryRun: boolean): Promise<void> {
    const self = [process.execPath, ...process.execArgv, process.argv[1]!]
    if (request.command === 'build') {
        const { film, ran, skipped } = runBuild(request, self, dryRun)
        const draft = request.options.has('--draft') || value(request, '--quality') === 'draft'
        const scenes = film.scenes.map((scene) => scene.id).filter((id) => scenesOf(request).includes(id))
        const list = (names: readonly string[]) => (names.length > 0 ? [...new Set(names)].join(', ') : 'none')
        console.error(`build: ${dryRun ? 'runs' : 'ran'} ${list(ran)}. Skipped: ${list(skipped)}.`)
        console.error(buildReport(film, draft, existsSync(join(request.folder, 'dist', `${film.output}.mp4`)), dryRun ? 'writes' : 'wrote', scenes))
        if (!dryRun) console.log(join(relative(process.cwd(), request.folder), 'dist', `${movieName(film, draft, scenes)}.mp4`))
        return
    }
    const film = readParticulars(request)
    const needsTiming = request.command === 'stills' && !request.options.has('--frame')
    const timing = needsTiming ? JSON.parse(await readFile(join(request.folder, 'timing.json'), 'utf8')) as NarrationTiming : undefined
    for (const step of planNarrated(request, film, self, timing)) {
        console.error(`> ${shown(step)}`)
        if (!dryRun) runStep(step, request)
    }
}
