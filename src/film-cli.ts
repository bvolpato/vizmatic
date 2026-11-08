import { existsSync } from 'fs'
import { mkdir, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join, relative, resolve } from 'path'
import { captionsToVtt, posterTime, renderFilmFrame, renderFilmGif, renderFilmSheet, renderFilmSvg, renderFilmVideo, type Quality } from './stage/export'
import { checkFilm, type FilmCheckOptions, type FilmCheckReport } from './stage/check'
import { LOOKS, type LookName } from './stage/look'
import { FILM_TEMPLATES } from './stage/templates'
import { FILM_OBJECTS } from './stage/catalog'
import { isFilm, type CompiledFilm, type FilmDefinition } from './stage/stage'
import * as stageApi from './stage/index'
import type { VideoFrameInfo } from './video'

export type FilmFormat = 'mp4' | 'webm' | 'gif' | 'png' | 'svg'

const FORMATS: readonly FilmFormat[] = ['mp4', 'webm', 'gif', 'png', 'svg']
const QUALITIES: readonly Quality[] = ['draft', 'standard', 'high', 'master']

export interface FilmArgs {
    inputs: string[]
    outDir: string
    looks: LookName[]
    fps?: number
    width?: number
    quality: Quality
    motionBlur?: number
    shutter?: number
    from?: number
    to?: number
    frames: number[]
    /** Write stills at this interval, in seconds, across the film or its range. */
    every?: number
    /** Join the stills into contact sheets, in place of one file for each. */
    sheet: boolean
    /** Tiles in a row of a contact sheet. */
    columns?: number
    poster: boolean
    formats: FilmFormat[]
    workers?: number
    audioPath?: string
    ffmpegPath?: string
    background?: string | null
    json: boolean
}

export interface FilmOutputRecord {
    format: FilmFormat
    path: string
    look: string
    width: number
    height: number
    bytes: number
    time?: number
    /** For a contact sheet: the time of each tile, in reading order. */
    times?: number[]
    columns?: number
    rows?: number
    frameCount?: number
    fps?: number
    duration?: number
    codec?: string
    quality?: Quality
    motionBlur?: number
    workers?: number
    renderSeconds?: number
    renderFps?: number
}

export interface FilmManifestEntry {
    name: string
    source: string
    title: string
    duration: number
    fps: number
    width: number
    height: number
    chapters: readonly { title: string; time: number }[]
    captions?: string
    outputs: FilmOutputRecord[]
}

export type FilmLoader = (file: string) => Promise<unknown>

export function isLookName(value: string): value is LookName {
    return Object.hasOwn(LOOKS, value)
}

function requireValue(args: readonly string[], index: number, name: string): string {
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
    return value
}

function positiveNumber(value: string, name: string): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number, but received ${value}`)
    return parsed
}

function positiveInteger(value: string, name: string): number {
    const parsed = positiveNumber(value, name)
    if (!Number.isInteger(parsed)) throw new Error(`${name} must be a whole number, but received ${value}`)
    return parsed
}

function parseLooks(value: string): LookName[] {
    const looks = value.split(',').map((item) => item.trim()).filter(Boolean)
    for (const look of looks) {
        if (!isLookName(look)) throw new Error(`Unknown look ${JSON.stringify(look)}. Run "vizmatic looks" to see all looks: ${Object.keys(LOOKS).join(', ')}.`)
    }
    if (looks.length === 0) throw new Error('--look requires at least one look')
    return looks as LookName[]
}

function parseRange(value: string): { from?: number; to?: number } {
    const match = /^([\d.]*):([\d.]*)$/.exec(value)
    if (!match || (!match[1] && !match[2])) throw new Error(`--range needs start:end in seconds, such as 3:8 or 3: or :8, but received ${value}`)
    const from = match[1] ? Number(match[1]) : undefined
    const to = match[2] ? Number(match[2]) : undefined
    if ((from !== undefined && !Number.isFinite(from)) || (to !== undefined && !Number.isFinite(to))) throw new Error(`--range has an invalid number: ${value}`)
    if (from !== undefined && to !== undefined && to <= from) throw new Error(`--range must end after it starts, but received ${value}`)
    return { from, to }
}

export function parseFilmArgs(argv: readonly string[]): FilmArgs {
    const args: FilmArgs = {
        inputs: [], outDir: 'dist/films', looks: [], quality: 'standard', frames: [], sheet: false, poster: false, formats: [], json: false,
    }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!
        switch (arg) {
            case '--out': args.outDir = requireValue(argv, i++, arg); break
            case '--look': args.looks = parseLooks(requireValue(argv, i++, arg)); break
            case '--fps': args.fps = positiveInteger(requireValue(argv, i++, arg), arg); break
            case '--width': args.width = positiveInteger(requireValue(argv, i++, arg), arg); break
            case '--motion-blur': args.motionBlur = positiveInteger(requireValue(argv, i++, arg), arg); break
            case '--shutter': args.shutter = positiveNumber(requireValue(argv, i++, arg), arg); break
            case '--workers': args.workers = positiveInteger(requireValue(argv, i++, arg), arg); break
            case '--audio': args.audioPath = requireValue(argv, i++, arg); break
            case '--ffmpeg': args.ffmpegPath = requireValue(argv, i++, arg); break
            case '--background': {
                const value = requireValue(argv, i++, arg)
                args.background = value === 'none' || value === 'transparent' ? null : value
                break
            }
            case '--poster': args.poster = true; break
            case '--json': args.json = true; break
            case '--quality': {
                const value = requireValue(argv, i++, arg) as Quality
                if (!QUALITIES.includes(value)) throw new Error(`--quality must be one of ${QUALITIES.join(', ')}, but received ${value}`)
                args.quality = value
                break
            }
            case '--range': Object.assign(args, parseRange(requireValue(argv, i++, arg))); break
            case '--frame': {
                for (const part of requireValue(argv, i++, arg).split(',')) {
                    const time = Number(part)
                    if (!Number.isFinite(time) || time < 0) throw new Error(`--frame needs times in seconds, but received ${part}`)
                    args.frames.push(time)
                }
                break
            }
            case '--every': args.every = positiveNumber(requireValue(argv, i++, arg), arg); break
            case '--sheet': args.sheet = true; break
            case '--columns': args.columns = positiveInteger(requireValue(argv, i++, arg), arg); break
            case '--format': {
                for (const part of requireValue(argv, i++, arg).split(',')) {
                    const format = part.trim() as FilmFormat
                    if (!FORMATS.includes(format)) throw new Error(`--format must list ${FORMATS.join(', ')}, but received ${part}`)
                    if (!args.formats.includes(format)) args.formats.push(format)
                }
                break
            }
            default:
                if (arg.startsWith('--')) throw new Error(`Unknown option for vizmatic film: ${arg}`)
                args.inputs.push(arg)
        }
    }
    if (args.inputs.length === 0) throw new Error('vizmatic film needs a film file, such as: vizmatic film ./intro.ts --out dist/films')
    if (args.every !== undefined && args.frames.length > 0) throw new Error('Use --frame or --every, not both: --frame lists times, and --every samples the film at an interval.')
    if (args.columns !== undefined && !args.sheet) throw new Error('--columns sets the width of a contact sheet, so it needs --sheet.')
    return args
}

/** The film a module exports, if any. A CommonJS-loaded module nests its default one level down. */
export function filmFromModule(mod: unknown): FilmDefinition | undefined {
    const top = mod as { default?: { default?: unknown }; film?: unknown } | undefined
    for (const candidate of [top?.default, top?.default?.default, top?.film]) {
        if (isFilm(candidate)) return candidate
    }
    return undefined
}

/** Load a module and return its film, with a clear message for the common mistakes. */
export async function loadFilmDefinition(file: string, load: FilmLoader): Promise<FilmDefinition> {
    const candidate = filmFromModule(await load(file))
    if (candidate) return candidate
    const shown = relative(process.cwd(), file)
    throw new Error(`${shown} must export a film as its default export: export default film({ title: 'Intro' }, (s) => { ... })`)
}

function formatClock(seconds: number): string {
    const whole = Math.max(0, Math.round(seconds))
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

/** One live line on a terminal. Plain periodic lines for logs, so CI output stays readable. */
function progressReporter(label: string, quiet: boolean): { update: (frame: VideoFrameInfo) => void; done: () => number } {
    const started = performance.now()
    const live = process.stderr.isTTY === true
    let lastPrint = 0
    let lastDecile = -1
    return {
        update(frame) {
            if (quiet) return
            const now = performance.now()
            const completed = frame.index + 1
            const finished = completed === frame.count
            if (live && !finished && now - lastPrint < 80) return
            lastPrint = now
            const elapsed = (now - started) / 1000
            const fps = completed / Math.max(elapsed, 1e-3)
            const remaining = (frame.count - completed) / Math.max(fps, 1e-3)
            const percent = Math.floor((completed / frame.count) * 100)
            const line = `${label}  frame ${completed}/${frame.count}  ${percent}%  ${fps.toFixed(1)} fps  ETA ${formatClock(remaining)}`
            if (live) {
                process.stderr.write(`\r\x1b[2K${line}`)
            } else {
                const decile = Math.floor(percent / 10)
                if (decile !== lastDecile) {
                    lastDecile = decile
                    process.stderr.write(`${line}\n`)
                }
            }
        },
        done() {
            if (!quiet && live) process.stderr.write('\r\x1b[2K')
            return (performance.now() - started) / 1000
        },
    }
}

function frameStamp(time: number): string {
    return `t${time.toFixed(3).padStart(7, '0')}`
}

/** Rows of one contact sheet. A longer list of times continues on the next sheet. */
const SHEET_ROWS = 6
/** Tiles of a contact sheet when no times and no interval are given. */
const SHEET_DEFAULT_TILES = 12

/** The times of the stills: the ones listed, or samples of the film or its range. */
function stillTimes(compiled: CompiledFilm, args: FilmArgs): number[] {
    if (args.frames.length > 0) return args.frames
    if (args.every === undefined && !args.sheet) return []
    const from = Math.max(0, args.from ?? 0), to = Math.min(compiled.duration, args.to ?? compiled.duration)
    if (!(to > from)) throw new Error(`The range ${from}:${to} is empty. The film is ${compiled.duration.toFixed(2)} seconds long.`)
    const times: number[] = []
    if (args.every !== undefined) {
        // The first still is at the start of the range. The last moment of the film is often a fade, so it is not sampled.
        for (let index = 0; from + index * args.every < to - 1e-9; index++) times.push(Math.round((from + index * args.every) * 1000) / 1000)
        return times
    }
    // A sheet with no times: evenly spaced moments, each in the middle of its share of the film.
    for (let index = 0; index < SHEET_DEFAULT_TILES; index++) times.push(Math.round((from + (index + 0.5) * (to - from) / SHEET_DEFAULT_TILES) * 1000) / 1000)
    return times
}

async function renderOneLook(
    compiled: CompiledFilm,
    name: string,
    lookLabel: string,
    args: FilmArgs,
    signal: AbortSignal,
    say: (line: string) => void,
): Promise<FilmOutputRecord[]> {
    const outputs: FilmOutputRecord[] = []
    const stem = lookLabel ? `${name}_${lookLabel}` : name
    const shown = (path: string) => relative(process.cwd(), path)
    const common = {
        quality: args.quality, motionBlur: args.motionBlur, shutter: args.shutter, workers: args.workers,
        from: args.from, to: args.to, audioPath: args.audioPath, ffmpegPath: args.ffmpegPath, signal, width: args.width,
    }
    const look = compiled.look.name
    const stillFormats = args.formats.filter((format): format is 'png' | 'svg' => format === 'png' || format === 'svg')
    const movieFormats = args.formats.filter((format): format is 'mp4' | 'webm' | 'gif' => format === 'mp4' || format === 'webm' || format === 'gif')

    const stills: { time: number; suffix: string; formats: readonly ('png' | 'svg')[] }[] = []
    const times = stillTimes(compiled, args)
    if (args.sheet) {
        const columns = args.columns ?? (times.length <= 9 ? 3 : 4), perSheet = columns * SHEET_ROWS
        const pages = Math.ceil(times.length / perSheet)
        for (let page = 0; page < pages; page++) {
            const suffix = pages > 1 ? `_sheet_${String(page + 1).padStart(String(pages).length, '0')}` : '_sheet'
            const written = await renderFilmSheet(compiled, times.slice(page * perSheet, (page + 1) * perSheet), join(args.outDir, `${stem}${suffix}.png`), { width: args.width, columns, workers: args.workers })
            const bytes = (await stat(written.outputPath)).size
            outputs.push({ format: 'png', path: shown(written.outputPath), look, width: written.width, height: written.height, bytes, times: written.times, columns: written.columns, rows: written.rows })
            say(`rendered ${shown(written.outputPath)} (${written.times.length} frames from ${written.times[0]!.toFixed(2)}s to ${written.times[written.times.length - 1]!.toFixed(2)}s, ${written.width}x${written.height}, ${formatBytes(bytes)})`)
        }
    } else {
        for (const time of times) stills.push({ time, suffix: `_${frameStamp(time)}`, formats: stillFormats.length ? stillFormats : ['png'] })
    }
    if (times.length === 0 && (args.poster || stillFormats.length > 0)) {
        stills.push({ time: await posterTime(compiled), suffix: '', formats: stillFormats.length ? stillFormats : ['png'] })
    } else if (args.poster) {
        stills.push({ time: await posterTime(compiled), suffix: '', formats: ['png'] })
    }
    for (const still of stills) {
        for (const format of still.formats) {
            const path = join(args.outDir, `${stem}${still.suffix}.${format}`)
            const written = format === 'png'
                ? await renderFilmFrame(compiled, still.time, path, { width: args.width })
                : await renderFilmSvg(compiled, still.time, path, { width: args.width })
            const bytes = (await stat(written.outputPath)).size
            outputs.push({ format, path: shown(written.outputPath), look, width: written.width, height: written.height, bytes, time: Math.round(still.time * 1000) / 1000 })
            say(`rendered ${shown(written.outputPath)} at ${still.time.toFixed(2)}s (${written.width}x${written.height}, ${formatBytes(bytes)})`)
        }
    }

    for (const format of movieFormats) {
        const path = join(args.outDir, `${stem}.${format}`)
        const progress = progressReporter(`${basename(path)}`, args.json)
        const onProgress = (frame: VideoFrameInfo) => progress.update(frame)
        if (format === 'gif') {
            const gif = await renderFilmGif(compiled, path, { ...common, fps: args.fps, onProgress })
            const seconds = progress.done()
            outputs.push({
                format, path: shown(gif.outputPath), look, width: gif.width, height: gif.height, bytes: gif.bytes,
                frameCount: gif.frameCount, fps: gif.fps, duration: gif.duration / 1000,
                renderSeconds: Math.round(seconds * 100) / 100, renderFps: Math.round((gif.frameCount / seconds) * 10) / 10,
            })
            say(`rendered ${shown(gif.outputPath)} (${gif.frameCount} frames at ${gif.width}x${gif.height}, ${formatBytes(gif.bytes)}, ${seconds.toFixed(1)}s)`)
            continue
        }
        const video = await renderFilmVideo(compiled, path, { ...common, codec: format === 'webm' ? 'vp9' : 'h264', onProgress })
        const seconds = progress.done()
        outputs.push({
            format, path: shown(video.outputPath), look, width: video.width, height: video.height, bytes: video.bytes,
            frameCount: video.frameCount, fps: video.fps, duration: video.duration / 1000, codec: video.codec,
            quality: args.quality, motionBlur: video.motionBlur, workers: video.workers,
            renderSeconds: Math.round(seconds * 100) / 100, renderFps: Math.round((video.frameCount / seconds) * 10) / 10,
        })
        say(`rendered ${shown(video.outputPath)} (${video.frameCount} frames at ${video.width}x${video.height}, ${formatBytes(video.bytes)}, ${(video.frameCount / seconds).toFixed(1)} render fps)`)
    }
    return outputs
}

/** Render films for every requested look and format, then write a manifest. */
export async function runFilmCommand(args: FilmArgs, files: readonly string[], stems: Map<string, string>, load: FilmLoader): Promise<void> {
    if (files.length === 0) throw new Error('No film files were found.')
    if (args.formats.length === 0 && args.frames.length === 0 && args.every === undefined && !args.sheet) args.formats = ['mp4']
    const say = (line: string) => {
        if (!args.json) console.log(line)
    }
    const controller = new AbortController()
    const abort = () => controller.abort()
    process.once('SIGINT', abort)
    process.once('SIGTERM', abort)
    const manifest: FilmManifestEntry[] = []
    const started = performance.now()
    try {
        await mkdir(args.outDir, { recursive: true })
        for (const file of files) {
            const definition = await loadFilmDefinition(file, load)
            const name = stems.get(file) ?? basename(file, extname(file))
            const looks: (LookName | undefined)[] = args.looks.length > 0 ? args.looks : [undefined]
            const outputs: FilmOutputRecord[] = []
            let first: CompiledFilm | undefined
            let captionsPath: string | undefined
            for (const look of looks) {
                const compiled = await definition.compile({
                    ...(look ? { look } : {}),
                    ...(args.fps ? { fps: args.fps } : {}),
                    ...(args.background !== undefined ? { background: args.background } : {}),
                })
                first ??= compiled
                outputs.push(...await renderOneLook(compiled, name, args.looks.length > 1 ? look! : '', args, controller.signal, say))
                if (compiled.captions.length > 0 && !captionsPath && args.formats.some((format) => format === 'mp4' || format === 'webm')) {
                    captionsPath = join(args.outDir, `${name}.vtt`)
                    await writeFile(captionsPath, captionsToVtt(compiled))
                    say(`wrote captions ${relative(process.cwd(), captionsPath)}`)
                }
            }
            manifest.push({
                name,
                source: relative(process.cwd(), file),
                title: first!.title,
                duration: first!.duration,
                fps: first!.fps,
                width: first!.width,
                height: first!.height,
                chapters: first!.chapters,
                ...(captionsPath ? { captions: relative(process.cwd(), captionsPath) } : {}),
                outputs,
            })
        }
        const report = { schemaVersion: 1, command: 'film', ok: true, elapsedSeconds: Math.round((performance.now() - started) / 10) / 100, films: manifest }
        const text = `${JSON.stringify(report, null, 2)}\n`
        await writeFile(join(args.outDir, 'film-manifest.json'), text)
        if (args.json) process.stdout.write(text)
    } finally {
        process.removeListener('SIGINT', abort)
        process.removeListener('SIGTERM', abort)
    }
}

export interface FilmCheckFileReport extends FilmCheckReport {
    source: string
    title: string
}

/** Check a loaded film and return a report in the shape agents read. */
export async function checkFilmFile(
    file: string,
    load: FilmLoader,
    looks: readonly LookName[],
    options: Pick<FilmCheckOptions, 'motion' | 'contentTop' | 'textMargin' | 'readingSpeed' | 'stepped'> = {},
): Promise<FilmCheckFileReport[]> {
    const definition = await loadFilmDefinition(file, load)
    const source = relative(process.cwd(), file)
    const reports: FilmCheckFileReport[] = []
    for (const look of looks.length > 0 ? looks : [undefined]) {
        const compiled = await definition.compile(look ? { look } : {})
        reports.push({ source, title: compiled.title, ...await checkFilm(compiled, options) })
    }
    return reports
}

/** Print a film check the way a person reads it. */
export function printFilmCheck(report: FilmCheckFileReport): void {
    const status = report.ok ? 'ok' : 'failed'
    const frames = report.frames === undefined ? '' : ` and ${report.frames} frames`
    console.log(`${report.source}: ${status}, ${report.diagnostics.length} finding(s) in ${report.sampled.length} sampled moments${frames} over ${report.duration.toFixed(1)}s`)
    for (const entry of report.diagnostics) {
        const span = entry.time === entry.until ? `${entry.time.toFixed(2)}s` : `${entry.time.toFixed(2)}s to ${entry.until.toFixed(2)}s`
        const repeats = entry.motion && entry.motion.spans > 1 ? `, ${entry.motion.spans} times, ${entry.motion.seconds}s in total` : ''
        // A text that leaves too soon is not a problem of two things that cross while they move, and its
        // message says how many times it comes.
        const when = entry.code === 'film.text_brief' ? span : entry.motion ? `${span} (in motion${repeats})` : span
        const { x, y, width, height } = entry.box
        console.log(`  ${entry.severity} ${entry.code} at ${when}: ${entry.message} Box x=${x} y=${y} w=${width} h=${height}. Stage (${entry.stage.x}, ${entry.stage.y}).`)
    }
}

/** Scaffold a starter film. */
export async function runNewCommand(argv: readonly string[]): Promise<void> {
    let templateName = 'explainer'
    let force = false
    let target: string | undefined
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!
        if (arg === '--template') templateName = requireValue(argv, i++, arg)
        else if (arg === '--force') force = true
        else if (arg === '--list') {
            for (const template of FILM_TEMPLATES) console.log(`${template.name.padEnd(14)}${template.description}`)
            return
        } else if (arg.startsWith('--')) throw new Error(`Unknown option for vizmatic new: ${arg}`)
        else target = arg
    }
    const template = FILM_TEMPLATES.find((entry) => entry.name === templateName)
    if (!template) throw new Error(`Unknown template ${JSON.stringify(templateName)}. Use one of: ${FILM_TEMPLATES.map((entry) => entry.name).join(', ')}.`)
    if (!target) throw new Error(`vizmatic new needs a name, such as: vizmatic new intro --template ${template.name}`)
    const path = resolve(extname(target) ? target : `${target}.ts`)
    if (existsSync(path) && !force) throw new Error(`${relative(process.cwd(), path)} already exists. Pass --force to replace it.`)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, template.source)
    const shown = relative(process.cwd(), path)
    console.log(`created ${shown} from the ${template.name} template

Next:
  vizmatic preview ${shown}
  vizmatic check ${shown}
  vizmatic film ${shown} --out dist/films`)
}

const LOOK_NOTES: Record<LookName, string> = {
    midnight: 'Deep neutral black with luminous pigments. The default.',
    paper: 'Warm paper and printed ink, for articles and print.',
    blueprint: 'Drafting-table navy with cool cyan linework.',
    chalk: 'Near-black green with warm chalk, for classroom-style lessons.',
    neon: 'Saturated light on pure black, for trailers and hero loops.',
}

export function runLooksCommand(argv: readonly string[]): void {
    const json = argv.includes('--json')
    const looks = Object.values(LOOKS).map((look) => ({
        name: look.name, dark: look.dark, background: look.background, bloom: look.bloom,
        note: LOOK_NOTES[look.name as LookName] ?? '', colors: look.colors,
    }))
    if (json) {
        process.stdout.write(`${JSON.stringify({ looks }, null, 2)}\n`)
        return
    }
    for (const look of looks) console.log(`${look.name.padEnd(11)}${look.dark ? 'dark ' : 'light'}  ${look.background}  bloom ${look.bloom.toFixed(2)}  ${look.note}`)
    console.log(`\nUse a look: film({ look: 'paper' }, ...), or vizmatic film ./intro.ts --look midnight,paper
Named colors work in every look: ${Object.keys(midnightColors()).join(', ')}.`)
}

function midnightColors(): Record<string, string> {
    return LOOKS.midnight.colors
}

export function runObjectsCommand(argv: readonly string[]): void {
    const json = argv.includes('--json')
    const known = new Set(FILM_OBJECTS.map((entry) => entry.name))
    // fromComponent lives in the Node-only export module, because it needs the layout engine.
    const exported = [...Object.keys(stageApi), 'fromComponent']
    const present = new Set(exported)
    const objects = FILM_OBJECTS.filter((entry) => present.has(entry.name))
    if (json) {
        process.stdout.write(`${JSON.stringify({ objects, otherExports: exported.filter((name) => !known.has(name)).sort() }, null, 2)}\n`)
        return
    }
    const groups = new Map<string, typeof objects>()
    for (const entry of objects) groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry])
    for (const [name, entries] of groups) {
        console.log(`${name}`)
        for (const entry of entries) console.log(`  ${entry.name.padEnd(18)}${entry.usage}`)
        console.log('')
    }
    console.log(`Import everything from 'vizmatic/stage'. Add --json for a machine-readable list.`)
}
