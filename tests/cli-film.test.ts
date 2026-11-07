import { spawnSync } from 'child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { FILM_TEMPLATES } from '../src/stage/templates'

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

function cli(args: string[], cwd = process.cwd()) {
    const env: NodeJS.ProcessEnv = { ...process.env, VIZMATIC_DISABLE_NETWORK: '1' }
    delete env.NODE_OPTIONS
    for (const key of Object.keys(env)) {
        if (key.startsWith('TSX_') || key.startsWith('VITEST')) delete env[key]
    }
    return spawnSync(process.execPath, ['--import', `file://${resolve('node_modules/tsx/dist/loader.mjs')}`, resolve('src/cli.ts'), ...args], {
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
    it.skipIf(!hasFfmpeg)('renders every format with a manifest, captions, and a look suffix for several looks', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'short.ts'), shortFilm)
        const out = join(directory, 'out')
        const result = cli(['film', 'short.ts', '--out', out, '--look', 'midnight,paper', '--format', 'mp4,webm,gif,png,svg', '--width', '160', '--quality', 'draft', '--workers', '2', '--json'], directory)
        expect(result.status, result.stderr).toBe(0)
        const report = JSON.parse(result.stdout)
        expect(report).toMatchObject({ schemaVersion: 1, command: 'film', ok: true })
        const entry = report.films[0]
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

describe('vizmatic new, looks, and objects', () => {
    it('scaffolds every template into a film that passes its own check', async () => {
        const directory = await tempDirectory()
        for (const template of FILM_TEMPLATES) {
            const created = cli(['new', template.name, '--template', template.name], directory)
            expect(created.status, created.stderr).toBe(0)
            const check = cli(['check', `${template.name}.ts`, '--json'], directory)
            expect(check.status, `${template.name}: ${check.stdout}${check.stderr}`).toBe(0)
            const report = JSON.parse(check.stdout)
            expect(report.files[0].film.title).toBeTruthy()
            expect(report.files[0].diagnostics, template.name).toEqual([])
        }
        const again = cli(['new', 'deck', '--template', 'deck'], directory)
        expect(again.status).not.toBe(0)
        expect(again.stderr).toContain('already exists')
    }, 180_000)

    it('lists looks and objects for agents as JSON', () => {
        const looks = JSON.parse(cli(['looks', '--json']).stdout).looks
        expect(looks.map((look: { name: string }) => look.name)).toContain('midnight')
        const catalog = JSON.parse(cli(['objects', '--json']).stdout)
        expect(catalog.objects.map((entry: { name: string }) => entry.name)).toEqual(expect.arrayContaining(['text', 'tex', 'axes', 'write', 'morph']))
        expect(catalog.objects.every((entry: { usage: string }) => entry.usage.length > 0)).toBe(true)
    }, 60_000)
})

describe('vizmatic check for films', () => {
    it('reports off-canvas text and overlapping text with times and boxes', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'bad.ts'), `import { film, line, text } from 'vizmatic/stage'
export default film({ title: 'Bad' }, (s) => {
    s.add(text('Falls off the edge of the frame', { size: 60 }).at(880, 0))
    s.add(text('Stacked', { size: 60 }).at(0, -200))
    s.add(text('Stacked', { size: 60 }).at(8, -198))
    s.add(text('Crossed', { size: 60 }).at(0, 200))
    s.add(line([-300, 200], [300, 200], { stroke: 'ink', width: 3 }))
    s.wait(1)
})
`)
        const result = cli(['check', 'bad.ts', '--json'], directory)
        expect(result.status).toBe(1)
        const report = JSON.parse(result.stdout)
        expect(report.ok).toBe(false)
        const codes = report.files[0].diagnostics.map((entry: { code: string }) => entry.code)
        expect(codes).toEqual(expect.arrayContaining(['film.off_canvas', 'film.text_overlap', 'film.text_crossed']))
        const overlap = report.files[0].diagnostics.find((entry: { code: string }) => entry.code === 'film.text_overlap')
        expect(overlap).toMatchObject({ severity: 'error', text: 'Stacked', other: 'Stacked' })
        expect(overlap.box.width).toBeGreaterThan(0)
        expect(overlap.time).toBeGreaterThanOrEqual(0)
        expect(overlap.stage.y).toBeLessThan(0)
    }, 60_000)
})
