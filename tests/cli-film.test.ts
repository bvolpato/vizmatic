import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { decode as decodePng } from 'fast-png'
import { afterEach, describe, expect, it } from 'vitest'
import { parseFilmArgs } from '../src/film-cli'

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0
const hasFfprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0
const tempDirs: string[] = []

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function tempDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'vizmatic-cli-film-'))
    tempDirs.push(directory)
    return directory
}

const BUILT_CLI = resolve('dist/cli.js')
const USE_BUILT_CLI = process.env['VIZMATIC_TEST_USE_EXISTING_BUILD'] === '1' && existsSync(BUILT_CLI)

function cli(args: string[], cwd = process.cwd()) {
    const env: NodeJS.ProcessEnv = { ...process.env, VIZMATIC_DISABLE_NETWORK: '1' }
    delete env.NODE_OPTIONS
    for (const key of Object.keys(env)) {
        if (key.startsWith('TSX_') || key.startsWith('VITEST')) delete env[key]
    }
    const cliArgs = USE_BUILT_CLI
        ? [BUILT_CLI, ...args]
        : ['--import', `file://${resolve('node_modules/tsx/dist/loader.mjs')}`, resolve('src/cli.ts'), ...args]
    return spawnSync(process.execPath, cliArgs, {
        cwd, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024,
    })
}

const shortFilm = `import { film, text, write, circle, fadeIn } from 'vizmatic/stage'
export default film({ title: 'Short', fps: 10 }, (s) => {
    s.chapter('Opening')
    const label = s.add(text('Short film', { font: 'serif', size: 96 }))
    s.play(write(label), { duration: 0.4 })
    s.caption('A short caption', 0.4)
    s.play(fadeIn(circle(80, { stroke: 'blue' }).at(0, 260)), { duration: 0.2 })
    s.wait(0.2)
})
`

describe('vizmatic film', () => {
    it('validates renderer and encoder choices before starting an export', () => {
        expect(parseFilmArgs(['intro.ts', '--backend', 'gpu', '--encoder', 'nvenc'])).toMatchObject({ backend: 'gpu', encoder: 'nvenc' })
        expect(parseFilmArgs(['intro.ts', '--encoder', 'vaapi'])).toMatchObject({ encoder: 'vaapi' })
        expect(parseFilmArgs(['intro.ts', '--encoder', 'qsv'])).toMatchObject({ encoder: 'qsv' })
        expect(parseFilmArgs(['intro.ts', '--encoder', 'amf'])).toMatchObject({ encoder: 'amf' })
        expect(() => parseFilmArgs(['intro.ts', '--backend', 'cuda'])).toThrow('--backend must be auto, cpu or gpu')
        expect(() => parseFilmArgs(['intro.ts', '--encoder', 'cuda'])).toThrow('--encoder must be auto, libx264, nvenc, videotoolbox, vaapi, qsv or amf')
    })

    it('reports local accelerator diagnostics via vizmatic doctor --json', () => {
        const result = cli(['doctor', '--json'])
        expect(result.status, result.stderr).toBe(0)
        const report = JSON.parse(result.stdout)
        expect(report).toMatchObject({
            platform: process.platform,
            arch: process.arch,
            h264: {
                supported: expect.arrayContaining(['libx264', 'videotoolbox', 'nvenc', 'vaapi', 'qsv', 'amf']),
            },
        })
        expect(report.cpuCores).toBeGreaterThan(0)
        // Missing --ffmpeg value and unknown flags must fail cleanly rather than consuming adjacent flags.
        const badDoctor = cli(['doctor', '--ffmpeg', '--json'])
        expect(badDoctor.status).toBe(1)
        expect(badDoctor.stderr).toContain('--ffmpeg requires a path')
        const version = cli(['--version'])
        expect(version.status, version.stderr).toBe(0)
        expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
        const narratedHelp = cli(['narrated', '--help'])
        expect(narratedHelp.status, narratedHelp.stderr).toBe(0)
        expect(narratedHelp.stdout).toContain('vizmatic narrated')
    }, 30_000)
    it.skipIf(!hasFfmpeg).each(['narration', 'narrated'])('renders intact synthetic %s captions into WebVTT and MP4', async (caller) => {
        const directory = await tempDirectory()
        const samples = [
            'Acme.io ships Nova.js 22.23.4 with OrbitDB 1.25.0.',
            'Values: 3.8, 0.17, and .5! Northstar.dev starts Comet.js.',
            "In the '80s... Keep 0.17 and 4.6 intact.",
        ]
        const timing = { lead: 0, gap: 0, scenes: [{ id: 'captions', beats: samples.map((say) => ({ say, duration: 1 })) }] }
        const definition = caller === 'narration'
            ? `film({ fps: 10 }, (s) => { narration(s, timing) })`
            : `narrated({ fps: 10, timing, scenes: { captions: () => {} } })`
        await writeFile(join(directory, 'captions.ts'), `import { film, narration, narrated } from 'vizmatic/stage'\nconst timing = ${JSON.stringify(timing)}\nexport default ${definition}\n`)
        const out = join(directory, 'out')
        const result = cli(['film', 'captions.ts', '--out', out, '--width', '160', '--quality', 'draft', '--workers', '1', '--json'], directory)
        expect(result.status, result.stderr).toBe(0)
        // Read the subtitles from the encoded movie, as well as the sidecar that the CLI writes.
        const embedded = spawnSync('ffmpeg', ['-v', 'error', '-i', join(out, 'captions.mp4'), '-map', '0:s:0', '-f', 'srt', '-'], { encoding: 'utf8' })
        expect(embedded.status, embedded.stderr).toBe(0)
        for (const subtitles of [await readFile(join(out, 'captions.vtt'), 'utf8'), embedded.stdout]) {
            const text = subtitles.split(/\r?\n/).filter((line) => line && line !== 'WEBVTT' && !/^\d+$/.test(line) && !line.includes(' --> ')).join(' ')
            expect(text.split(' ')).toEqual(samples.flatMap((sample) => sample.split(' ')))
        }
    }, 60_000)

    it.skipIf(!hasFfmpeg)('renders every format with a manifest, captions, and a look suffix for several looks', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'short.ts'), shortFilm)
        const out = join(directory, 'out')
        const result = cli(['film', 'short.ts', '--out', out, '--look', 'midnight,paper', '--format', 'mp4,webm,gif,png,svg', '--width', '160', '--quality', 'draft', '--workers', '2', '--json'], directory)
        expect(result.status, result.stderr).toBe(0)
        const report = JSON.parse(result.stdout)
        expect(report).toMatchObject({ schemaVersion: 1, command: 'film', ok: true })
        const entry = report.films[0]
        expect(entry.outputs.find((output: { format: string }) => output.format === 'mp4')).toMatchObject({ backend: 'cpu', encoder: 'libx264' })
        expect(entry).toMatchObject({ name: 'short', title: 'Short', width: 1920, height: 1080, fps: 10, chapters: [{ title: 'Opening', time: 0 }] })
        expect(entry.outputs.map((output: { format: string; look: string }) => `${output.look}.${output.format}`).sort()).toEqual([
            'midnight.gif', 'midnight.mp4', 'midnight.png', 'midnight.svg', 'midnight.webm',
            'paper.gif', 'paper.mp4', 'paper.png', 'paper.svg', 'paper.webm',
        ])
        const files = await readdir(out)
        for (const name of ['short_midnight.mp4', 'short_paper.webm', 'short_paper.gif', 'short_midnight.png', 'short_paper.svg', 'short.vtt', 'film-manifest.json']) {
            expect(files).toContain(name)
        }
        expect(await readFile(join(out, 'short.vtt'), 'utf8')).toContain('A short caption')
        const manifest = JSON.parse(await readFile(join(out, 'film-manifest.json'), 'utf8'))
        expect(manifest.films[0].name).toBe('short')
        expect((await readFile(join(out, 'short_midnight.gif'))).subarray(0, 3).toString('ascii')).toBe('GIF')
        // A finished video should not keep the private mode of its temp file.
        expect((await stat(join(out, 'short_midnight.mp4'))).mode & 0o777).toBe(0o644)
        if (hasFfprobe) {
            const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', join(out, 'short_midnight.mp4')], { encoding: 'utf8' })
            const [video] = JSON.parse(probe.stdout).streams
            expect(video).toMatchObject({ codec_name: 'h264', width: 160, height: 90, color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709', color_range: 'tv' })
            expect(Number(video.nb_read_frames)).toBe(entry.outputs.find((output: { format: string }) => output.format === 'mp4').frameCount)
            // The MP4 carries the title, the chapter, and the caption, so no second pass is needed.
            const inside = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_chapters', '-show_format', '-of', 'json', join(out, 'short_midnight.mp4')], { encoding: 'utf8' }).stdout)
            expect(inside.format.tags.title).toBe('Short')
            expect(inside.chapters.map((chapter: { tags: { title: string } }) => chapter.tags.title)).toEqual(['Opening'])
            expect(inside.streams.some((stream: { codec_name: string }) => stream.codec_name === 'mov_text')).toBe(true)
            const caption = spawnSync('ffmpeg', ['-v', 'error', '-i', join(out, 'short_midnight.mp4'), '-map', '0:s:0', '-f', 'srt', '-'], { encoding: 'utf8' })
            expect(caption.stdout).toContain('A short caption')
            const webm = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', join(out, 'short_paper.webm')], { encoding: 'utf8' })
            expect(JSON.parse(webm.stdout).streams[0]).toMatchObject({ codec_name: 'vp9', color_space: 'bt709' })
        }
    }, 120_000)

    it.skipIf(process.platform === 'win32')('turns the dither of the bloom on with --dither and off with --no-dither, at any quality', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'short.ts'), shortFilm)
        // A stand-in for FFmpeg: it keeps its arguments beside the output, and copies the raw frames to the output path.
        const encoder = join(directory, 'keep-frames.sh')
        await writeFile(encoder, '#!/bin/sh\ncase "$1" in -h) exit 0;; esac\nfor last; do :; done\nprintf \'%s\\n\' "$@" > "$last.args"\nexec cat > "$last"\n', { mode: 0o755 })
        const render = async (name: string, flags: string[]) => {
            const out = join(directory, name)
            const result = cli(['film', 'short.ts', '--out', out, '--format', 'mp4,png', '--width', '160', '--workers', '1', '--ffmpeg', encoder, '--json', ...flags], directory)
            expect(result.status, result.stderr).toBe(0)
            const args = (await readFile(join(out, (await readdir(out)).find((file) => file.endsWith('.args'))!), 'utf8')).split('\n')
            const at = args.indexOf('-x264-params')
            return { frames: await readFile(join(out, 'short.mp4')), still: await readFile(join(out, 'short.png')), settings: at < 0 ? undefined : args[at + 1] }
        }
        // At standard, the default is the plain bloom and the encoder settings of a film alone.
        const standard = await render('standard', [])
        expect(standard.settings).toBeUndefined()
        const on = await render('standard-on', ['--dither'])
        expect(on.settings).toBe('aq-strength=1.0:subme=6:trellis=0')
        expect(Buffer.compare(on.frames, standard.frames)).not.toBe(0)
        const off = await render('standard-off', ['--no-dither'])
        expect(off.settings).toBeUndefined()
        expect(Buffer.compare(off.frames, standard.frames)).toBe(0)
        // A still has the dither unless --no-dither turns it off.
        expect(Buffer.compare(on.still, standard.still)).toBe(0)
        expect(Buffer.compare(off.still, standard.still)).not.toBe(0)
        // At high, the default is the dither, with the settings that keep its grain.
        const high = await render('high', ['--quality', 'high'])
        expect(high.settings).toBe('subme=6:trellis=0')
        const highOff = await render('high-off', ['--quality', 'high', '--no-dither'])
        expect(highOff.settings).toBeUndefined()
        expect(Buffer.compare(highOff.frames, high.frames)).not.toBe(0)
        expect((await render('draft-on', ['--quality', 'draft', '--dither'])).settings).toBe('aq-strength=2.0')
    }, 240_000)

    it('writes only stills for --frame', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'short.ts'), shortFilm)
        const out = join(directory, 'out')
        const result = cli(['film', 'short.ts', '--out', out, '--frame', '0.1,0.5', '--width', '320'], directory)
        expect(result.status, result.stderr).toBe(0)
        expect((await readdir(out)).sort()).toEqual(['film-manifest.json', 'short_t000.100.png', 'short_t000.500.png'])
        const png = await readFile(join(out, 'short_t000.500.png'))
        expect(png.readUInt32BE(16)).toBe(320)
        expect(png.readUInt32BE(20)).toBe(180)
    }, 60_000)

    it('joins stills into a contact sheet, with a tile for each time', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'short.ts'), shortFilm)
        const out = join(directory, 'out')
        const result = cli(['film', 'short.ts', '--out', out, '--frame', '0.1,0.3,0.5,0.7', '--sheet', '--columns', '2', '--width', '160', '--json'], directory)
        expect(result.status, result.stderr).toBe(0)
        expect((await readdir(out)).sort()).toEqual(['film-manifest.json', 'short_sheet.png'])
        const [output] = JSON.parse(result.stdout).films[0].outputs
        // Two columns and two rows of 160x90 tiles, a 4 pixel gap around each, and a 20 pixel band for the time under each.
        expect(output).toMatchObject({ format: 'png', columns: 2, rows: 2, times: [0.1, 0.3, 0.5, 0.7], width: 2 * 160 + 3 * 4, height: 2 * (90 + 20) + 3 * 4 })
        const png = decodePng(await readFile(join(out, 'short_sheet.png')))
        expect([png.width, png.height]).toEqual([output.width, output.height])
        const pixel = (x: number, y: number) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3)]
        // The gap has the surface color of the look, and a tile starts with the film's background.
        expect(pixel(1, 1)).not.toEqual(pixel(4 + 2, 4 + 2))
        // The circle has arrived in the last tile and not in the first: the tiles are different frames, in order.
        const tile = (index: number) => png.data.subarray(((4 + (index >> 1) * (90 + 20 + 4) + 76) * png.width + 4 + (index & 1) * (160 + 4)) * 4, ((4 + (index >> 1) * (90 + 20 + 4) + 76) * png.width + 4 + (index & 1) * (160 + 4) + 160) * 4)
        expect(Buffer.from(tile(0)).equals(Buffer.from(tile(3)))).toBe(false)
        // The band under a tile holds its time, so it is not empty.
        const band = png.data.subarray(((4 + 90 + 10) * png.width + 4) * 4, ((4 + 90 + 10) * png.width + 4 + 160) * 4)
        expect(new Set(band).size).toBeGreaterThan(4)
    }, 60_000)

    it('samples the film with --every, and continues a long list of times on a second sheet', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'short.ts'), shortFilm)
        const out = join(directory, 'out')
        // The film is 0.8 seconds long: 0, 0.2, 0.4 and 0.6.
        const stills = cli(['film', 'short.ts', '--out', out, '--every', '0.2', '--width', '160'], directory)
        expect(stills.status, stills.stderr).toBe(0)
        expect((await readdir(out)).sort()).toEqual(['film-manifest.json', 'short_t000.000.png', 'short_t000.200.png', 'short_t000.400.png', 'short_t000.600.png'])
        // One column gives six tiles to a sheet, so eight times need two sheets.
        const sheets = cli(['film', 'short.ts', '--out', join(directory, 'sheets'), '--every', '0.1', '--sheet', '--columns', '1', '--width', '160', '--json'], directory)
        expect(sheets.status, sheets.stderr).toBe(0)
        expect(JSON.parse(sheets.stdout).films[0].outputs.map((output: { path: string; times: number[] }) => [output.path.split('/').pop(), output.times.length])).toEqual([['short_sheet_1.png', 6], ['short_sheet_2.png', 2]])
        // With no times, a sheet shows twelve moments spread over the film.
        const spread = cli(['film', 'short.ts', '--out', join(directory, 'spread'), '--sheet', '--width', '160', '--json'], directory)
        expect(spread.status, spread.stderr).toBe(0)
        expect(JSON.parse(spread.stdout).films[0].outputs[0]).toMatchObject({ columns: 4, rows: 3 })
        expect(cli(['film', 'short.ts', '--frame', '0.1', '--every', '0.2'], directory).stderr).toContain('Use --frame or --every, not both')
        expect(cli(['film', 'short.ts', '--columns', '2'], directory).stderr).toContain('--columns sets the width of a contact sheet')
    }, 120_000)

    it.skipIf(!hasFfmpeg)('honors --range and rounds odd sizes to even', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'short.ts'), shortFilm)
        const out = join(directory, 'out')
        const result = cli(['film', 'short.ts', '--out', out, '--range', '0.2:0.6', '--width', '161', '--quality', 'draft', '--workers', '1', '--json'], directory)
        expect(result.status, result.stderr).toBe(0)
        const [output] = JSON.parse(result.stdout).films[0].outputs
        expect(output).toMatchObject({ frameCount: 4, width: 162, height: 92 })
    }, 60_000)

    it('explains invalid input', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'short.ts'), shortFilm)
        await writeFile(join(directory, 'plain.ts'), 'export const value = 1\n')
        expect(cli(['film', 'short.ts', '--look', 'sepia'], directory).stderr).toContain('Unknown look "sepia"')
        expect(cli(['film', 'short.ts', '--range', '5:1'], directory).stderr).toContain('--range must end after it starts')
        expect(cli(['film', 'plain.ts', '--out', 'o'], directory).stderr).toContain('must export a film as its default export')
    }, 60_000)

    it('says to move a text into the callback when a film file makes it at its top', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'top.ts'), `import { film, text } from 'vizmatic/stage'
const title = text('made at the top of the file')
export default film((s) => {
    s.add(title)
    s.wait(1)
})
`)
        const result = cli(['film', 'top.ts', '--frame', '0.5', '--out', 'o'], directory)
        expect(result.status).toBe(1)
        // The font is not loaded when the file loads, so the text throws what the compiler waits for inside a callback.
        expect(result.stderr).toContain('Make each text, equation and graph inside the callback of film(), not at the top of a file')
        expect(result.stderr).not.toContain('[object Object]')
    }, 60_000)

    it.skipIf(!hasFfmpeg)('routes films through the render and video commands', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'short.ts'), shortFilm)
        const rendered = cli(['render', 'short.ts', '--out', 'still', '--theme', 'light'], directory)
        expect(rendered.status, rendered.stderr).toBe(0)
        expect(await readdir(join(directory, 'still'))).toContain('short.png')
        const video = cli(['video', 'short.ts', '--out', 'movie', '--theme', 'dark,light'], directory)
        expect(video.status, video.stderr).toBe(0)
        expect(await readdir(join(directory, 'movie'))).toEqual(expect.arrayContaining(['short_midnight.mp4', 'short_paper.mp4']))
    }, 120_000)
})
