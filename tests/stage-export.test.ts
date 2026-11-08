import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { decode } from 'fast-png'
import { card, dot, film, group, labeledDot, line, rect, shift, text, to, write, type Node } from '../src/stage/index'
import { filmEncoderSettings, planRender, posterTime, renderFilmFrame, renderFilmGif, renderFilmSvg, renderFilmVideo, captionsToVtt } from '../src/stage/export'
import { checkFilm } from '../src/stage/check'
import { compileFilm } from '../src/stage/stage'
import { renderRgbaVideo } from '../src/video'
import { rasterMemoBytes } from '../src/stage/raster'

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0
const tempDirs: string[] = []

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function tempDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'vizmatic-stage-export-'))
    tempDirs.push(directory)
    return directory
}

const simple = film({ title: 'Simple', fps: 12 }, (s) => {
    const label = s.add(text('Simple', { size: 120 }))
    s.play(write(label), { duration: 0.5 })
    s.wait(0.5)
})

describe('render planning', () => {
    it('holds a bounded number of frames at 4K', () => {
        const budget = 2 * 1024 ** 3
        for (const blur of [1, 4, 8]) {
            const plan = planRender(3840, 2160, blur, { workers: 12, memoryBudget: budget })
            const frameBytes = 3840 * 2160 * 4
            expect(plan.workers).toBeGreaterThanOrEqual(1)
            expect(plan.readAhead).toBeGreaterThan(plan.workers)
            // Workers plus finished frames waiting for the encoder must fit the budget.
            const perWorker = frameBytes * (blur > 1 ? blur + 4 : 3) + rasterMemoBytes(3840, 2160)
            expect(plan.workers * perWorker + (plan.readAhead - plan.workers) * frameBytes).toBeLessThanOrEqual(budget * 1.05)
        }
    })

    it('uses every requested worker at HD', () => {
        expect(planRender(1920, 1080, 1, { workers: 8, memoryBudget: 2 * 1024 ** 3 }).workers).toBe(8)
    })
})

describe('film export', () => {
    it('writes a PNG of the requested size, in the film\'s colors', async () => {
        const directory = await tempDirectory()
        const output = await renderFilmFrame(simple, 1, join(directory, 'frame.png'), { width: 320 })
        expect(output).toMatchObject({ width: 320, height: 180 })
        const png = decode(await readFile(output.outputPath))
        expect([png.width, png.height]).toEqual([320, 180])
        expect(Array.from(png.data.subarray(0, 3))).toEqual([11, 12, 16])
    })

    it('honors a look at compile time', async () => {
        const directory = await tempDirectory()
        const output = await renderFilmFrame(simple, 1, join(directory, 'frame.png'), { width: 320, look: 'paper' })
        const png = decode(await readFile(output.outputPath))
        expect(Array.from(png.data.subarray(0, 3))).toEqual([247, 243, 234])
    })

    it('writes standalone SVG without fonts', async () => {
        const directory = await tempDirectory()
        const output = await renderFilmSvg(simple, 1, join(directory, 'frame.svg'))
        const svg = await readFile(output.outputPath, 'utf8')
        expect(svg.startsWith('<svg')).toBe(true)
        expect(svg).not.toContain('<text')
    })

    it('encodes a GIF that stores only changed regions', async () => {
        const directory = await tempDirectory()
        const output = await renderFilmGif(simple, join(directory, 'film.gif'), { width: 240, fps: 10, workers: 2 })
        expect(output).toMatchObject({ width: 240, frameCount: 10 })
        const bytes = await readFile(output.outputPath)
        expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a')
        // A static hold at the end costs nothing, so far fewer bytes than ten full frames.
        expect(bytes.length).toBeLessThan(240 * 135 * 2)
    })

    it.skipIf(!hasFfmpeg)('stays at H.264 level 4.2 at 1080p60, and a clip with the film settings shares its decoder settings', async () => {
        const directory = await tempDirectory()
        const clip = film({ fps: 60 }, (s) => {
            s.add(text('Same settings', { size: 120 }))
            s.wait(0.2)
        })
        const movie = await renderFilmVideo(clip, join(directory, 'film.mp4'), { quality: 'high', workers: 2, motionBlur: 1 })
        const other = await renderRgbaVideo(() => Buffer.alloc(1920 * 1080 * 4, 40), {
            width: 1920, height: 1080, fps: 60, duration: 200, outputPath: join(directory, 'other.mp4'), ...filmEncoderSettings('high'),
        })
        const level = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=level,profile', '-of', 'json', movie.outputPath], { encoding: 'utf8' })
        expect(JSON.parse(level.stdout).streams[0].level).toBeLessThanOrEqual(42)
        // QuickTime reads one set of these from the start of a file and stops at a clip that differs.
        const settings = (path: string) => spawnSync('ffmpeg', ['-hide_banner', '-i', path, '-map', '0:v:0', '-c', 'copy', '-bsf:v', 'trace_headers', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
            .split('\n')
            .filter((row) => /level_idc|max_num_ref_frames|log2_max_frame_num|pic_init_qp|max_dec_frame_buffering/.test(row))
            .map((row) => row.replace(/^.*\] +\d+ +/, '').replace(/\s+/g, ' '))
        const expected = settings(movie.outputPath)
        expect(expected.length).toBeGreaterThan(0)
        expect(settings(other.outputPath)).toEqual(expected)
    }, 120_000)

    it.skipIf(!hasFfmpeg)('tags MP4 output BT.709 and keeps colors after decoding', async () => {
        const directory = await tempDirectory()
        const output = await renderFilmVideo(simple, join(directory, 'film.mp4'), { width: 320, quality: 'standard', workers: 2 })
        const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_space,color_transfer,color_primaries,color_range', '-of', 'json', output.outputPath], { encoding: 'utf8' })
        expect(JSON.parse(probe.stdout).streams[0]).toEqual({ color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709' })
        const decoded = spawnSync('ffmpeg', ['-v', 'error', '-ss', '0.9', '-i', output.outputPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 24 })
        const [r, g, b] = decoded.stdout
        expect(Math.abs(r! - 11)).toBeLessThanOrEqual(2)
        expect(Math.abs(g! - 12)).toBeLessThanOrEqual(2)
        expect(Math.abs(b! - 16)).toBeLessThanOrEqual(2)
    }, 60_000)

    it('chooses a poster at rest and honors the author\'s choice', async () => {
        const compiled = await compileFilm(simple)
        const time = await posterTime(compiled)
        expect(compiled.clips.some((clip) => clip.t0 < time && time < clip.t1)).toBe(false)
        const chosen = await compileFilm(film({ poster: 0.25 }, (s) => { s.wait(1) }))
        expect(await posterTime(chosen)).toBe(0.25)
    })

    it('writes captions as WebVTT', async () => {
        const compiled = await compileFilm(film((s) => {
            s.caption('Hello there', 1.5)
            s.wait(2)
        }))
        expect(captionsToVtt(compiled)).toBe('WEBVTT\n\n00:00.000 --> 00:01.500\nHello there\n')
    })
})

describe('film check', () => {
    it('passes a clean film', async () => {
        const report = await checkFilm(film((s) => {
            s.add(text('Clean', { size: 80 }))
            s.wait(1)
        }))
        expect(report.ok).toBe(true)
        expect(report.diagnostics).toEqual([])
        expect(report.sampled.length).toBeGreaterThan(0)
    })

    it('ignores text that only crosses while moving', async () => {
        const report = await checkFilm(film(async (s) => {
            const { to } = await import('../src/stage/anim')
            const a = s.add(text('Moving', { size: 80 }).at(-400, 0))
            s.add(text('Still', { size: 80 }).at(400, 0))
            s.play(to(a, (n) => n.at(400, 0)), { duration: 1 })
            s.play(to(a, (n) => n.at(-400, 200)), { duration: 1 })
        }))
        expect(report.diagnostics).toEqual([])
    })

    it('reports text that crosses only while moving as a warning in a motion scan', async () => {
        const { fadeIn, fadeOut } = await import('../src/stage/anim')
        const crossfade = film({ fps: 30 }, (s) => {
            const before = s.add(text('Old sentence here', { size: 80 }))
            s.wait(1)
            s.play(fadeOut(before), fadeIn(text('New sentence here', { size: 80 })), { duration: 1 })
            s.wait(1)
        })
        expect((await checkFilm(crossfade)).diagnostics).toEqual([])
        const report = await checkFilm(crossfade, { motion: true })
        expect(report.ok).toBe(true)
        expect(report.frames).toBe(90)
        expect(report.diagnostics).toHaveLength(1)
        expect(report.diagnostics[0]).toMatchObject({ code: 'film.text_overlap', severity: 'warning', motion: { spans: 1 } })
        expect(report.diagnostics[0]!.time).toBeGreaterThan(1)
        expect(report.diagnostics[0]!.until).toBeLessThan(2)
    })

    it('reports a blank gap between two pictures, and not a quick change', async () => {
        const { delay, fadeIn, fadeOut } = await import('../src/stage/anim')
        const lesson = (gap: number) => film({ fps: 30 }, (s) => {
            s.add(text('Heading', { size: 60 }).at(0, -460))
            const before = s.add(text('Old', { size: 80 }))
            s.wait(1)
            if (gap > 0) {
                s.play(fadeOut(before, { duration: 0.2 }))
                s.wait(gap)
                s.play(fadeIn(text('New', { size: 80 }), { duration: 0.2 }))
            } else {
                s.play(fadeOut(before, { duration: 0.15 }), delay(fadeIn(text('New', { size: 80 }), { duration: 0.25 }), 0.1))
            }
            s.wait(1)
        })
        // The heading stays up, so the whole frame is never blank.
        expect((await checkFilm(lesson(0.6), { motion: true })).diagnostics).toEqual([])
        const report = await checkFilm(lesson(0.6), { motion: true, contentTop: 200 })
        expect(report.diagnostics).toHaveLength(1)
        expect(report.diagnostics[0]).toMatchObject({ code: 'film.blank', severity: 'warning' })
        expect(report.diagnostics[0]!.time).toBeGreaterThan(1)
        expect(report.diagnostics[0]!.until).toBeLessThan(2.1)
        expect((await checkFilm(lesson(0), { motion: true, contentTop: 200 })).diagnostics).toEqual([])
    })

    it('keeps a problem at rest as an error in a motion scan', async () => {
        const report = await checkFilm(film({ fps: 30 }, (s) => {
            s.add(text('First', { size: 80 }))
            s.add(text('Second', { size: 80 }))
            s.wait(1)
        }), { motion: true })
        expect(report.ok).toBe(false)
        expect(report.diagnostics).toHaveLength(1)
        expect(report.diagnostics[0]).toMatchObject({ code: 'film.text_overlap', severity: 'error' })
        expect(report.diagnostics[0]!.motion).toBeUndefined()
    })

    it('does not flag a label with an opaque backing over a line', async () => {
        const { line, rect } = await import('../src/stage/shapes')
        const report = await checkFilm(film((s) => {
            s.add(line([-300, 0], [300, 0], { stroke: 'ink', width: 3 }))
            s.add(rect(240, 90, { fill: 'bg', stroke: null }))
            s.add(text('Label', { size: 50 }))
            s.wait(1)
        }))
        expect(report.diagnostics).toEqual([])
    })

    it('reports a clipped title as an error and a crossing stroke with its location', async () => {
        const { line } = await import('../src/stage/shapes')
        const report = await checkFilm(film((s) => {
            s.add(text('Way off the side of the frame', { size: 90 }).at(900, -300))
            s.add(text('Crossed', { size: 70 }).at(0, 100))
            s.add(line([-200, 100], [200, 100], { stroke: 'ink', width: 3 }))
            s.wait(1)
        }))
        expect(report.ok).toBe(false)
        const off = report.diagnostics.find((entry) => entry.code === 'film.off_canvas')!
        expect(off).toMatchObject({ severity: 'error', text: 'Way off the side of the frame' })
        const crossed = report.diagnostics.find((entry) => entry.code === 'film.text_crossed')!
        expect(crossed.text).toBe('Crossed')
        expect(Math.abs(crossed.stage.y - 100)).toBeLessThan(30)
    })

    it('does not flag a grid line that spans the whole frame', async () => {
        const { line } = await import('../src/stage/shapes')
        const report = await checkFilm(film((s) => {
            s.add(line([-1000, -400], [1000, -400], { stroke: 'blue', width: 2 }))
            s.wait(1)
        }))
        expect(report.diagnostics).toEqual([])
    })

    it('warns about a mark that leaves the frame', async () => {
        const { circle } = await import('../src/stage/shapes')
        const report = await checkFilm(film((s) => {
            s.add(circle(100, { stroke: 'blue' }).at(960, 0))
            s.wait(1)
        }))
        expect(report.ok).toBe(true)
        expect(report.diagnostics).toMatchObject([{ code: 'film.off_canvas', severity: 'warning' }])
    })

    it('warns about text that sits against an edge of the frame', async () => {
        const check = (gap: number, options = {}) => checkFilm(film((s) => {
            s.add(text('Against the edge', { size: 40 }).alignTo([-960 + gap, 300], 'left'))
            s.wait(1)
        }), options)
        const near = await check(6)
        expect(near.ok).toBe(true)
        expect(near.diagnostics).toMatchObject([{ code: 'film.text_edge', severity: 'warning', text: 'Against the edge' }])
        expect(near.diagnostics[0]!.message).toContain('6 px from the left edge')
        expect((await check(40)).diagnostics).toEqual([])
        expect((await check(40, { textMargin: 60 })).diagnostics).toMatchObject([{ code: 'film.text_edge' }])
        expect((await check(6, { textMargin: 0 })).diagnostics).toEqual([])
        const low = await checkFilm(film((s) => {
            s.add(text('Near the bottom', { size: 40 }).alignTo([0, 540 - 5], 'bottom'))
            s.wait(1)
        }))
        expect(low.diagnostics[0]!.message).toContain('from the bottom edge')
    })

    it('checks the edges for pinned text under a zoom, and for all text in a film that bleeds', async () => {
        const zoomed = (pin: boolean) => checkFilm(film((s) => {
            const label = s.add(text('Corner tag', { size: 40 }).alignTo([-960 + 4, 0], 'left'))
            if (pin) label.pin()
            s.play(to(s.camera, (camera) => camera.set('sx', 1.2).set('sy', 1.2), { duration: 0.2 }))
            s.wait(0.5)
        }), { times: [0.6] })
        expect((await zoomed(true)).diagnostics).toMatchObject([{ code: 'film.text_edge' }])
        expect((await zoomed(false)).diagnostics.filter((entry) => entry.code === 'film.text_edge')).toEqual([])
        const bleeding = await checkFilm(film({ bleed: true }, (s) => {
            s.add(text('Against the edge', { size: 40 }).alignTo([-960 + 6, 300], 'left'))
            s.wait(1)
        }))
        expect(bleeding.diagnostics).toMatchObject([{ code: 'film.text_edge' }])
    })

    it('warns about text with no room beside a mark, when the rule is on', async () => {
        const check = (gap: number, options: { textGap?: number } = { textGap: 0.3 }) => checkFilm(film((s) => {
            s.add(rect(300, 60, { fill: 'blue', stroke: null }))
            s.add(text('caption', { size: 40 }).alignTo([0, 30 + gap], 'top'))
            s.wait(1)
        }), options)
        const near = await check(3)
        expect(near.ok).toBe(true)
        expect(near.diagnostics).toMatchObject([{ code: 'film.text_crowded', severity: 'warning', text: 'caption' }])
        // The room is 0.3 of the font size of 40.
        expect(near.diagnostics[0]!.message).toContain('3 px from a mark. Leave 12 px or more')
        expect((await check(40)).diagnostics).toEqual([])
        expect((await check(3, {})).diagnostics).toEqual([])
        // A large factor asks for no more than 2% of the shorter side of the frame, which is 21.6 px.
        expect((await check(20, { textGap: 1 })).diagnostics).toMatchObject([{ code: 'film.text_crowded' }])
        expect((await check(24, { textGap: 1 })).diagnostics).toEqual([])

        const label = (radius: number) => checkFilm(film((s) => {
            s.add(dot(radius, 'blue'))
            s.add(text('22M', { size: 40 }))
            s.wait(1)
        }), { textGap: 0.3 })
        expect((await label(22)).diagnostics).toMatchObject([{ code: 'film.text_crowded', text: '22M' }])
        expect((await label(22)).diagnostics[0]!.message).toContain('larger than the shape')
        expect((await label(90)).diagnostics).toEqual([])
    })

    it('measures the room from the font size and to the letters, and reports each text apart', async () => {
        // Words of one size get one room, whatever letters they have.
        const words = await checkFilm(film((s) => {
            for (const [word, x] of [['acme', -300], ['Apply', 300]] as const) {
                const made = s.add(text(word, { size: 40 }).at(x, 0))
                const box = made.bounds()
                s.add(line([box.x, box.y + box.height + 8], [box.x + box.width, box.y + box.height + 8], { stroke: 'ink', width: 2 }))
            }
            s.wait(1)
        }), { textGap: 0.3 })
        expect(words.diagnostics.map((entry) => entry.text).sort()).toEqual(['Apply', 'acme'])
        for (const entry of words.diagnostics) expect(entry.message).toContain('Leave 12 px or more')

        // A block of two lines has an empty corner. A line that ends there is far from every letter.
        const block = (between: boolean) => checkFilm(film((s) => {
            const made = s.add(text('a long first line of words\nshort', { size: 40 }))
            const box = made.bounds(), short = made.find('short').map((glyph) => glyph.bounds())
            const top = Math.min(...short.map((glyph) => glyph.y))
            // Between the two lines of text: inside the box of the block, and 4 px above the letters of the second line.
            if (between) s.add(line([box.x, top - 4], [box.x + box.width, top - 4], { stroke: 'ink', width: 2 }))
            else s.add(line([box.x + box.width + 80, box.y + box.height + 80], [box.x + box.width - 10, box.y + box.height - 6], { stroke: 'ink', width: 2 }))
            s.wait(1)
        }), { textGap: 0.3 })
        expect((await block(false)).diagnostics).toEqual([])
        expect((await block(true)).diagnostics).toMatchObject([{ code: 'film.text_crowded' }])

        // The same word at two places is two findings.
        const twice = await checkFilm(film((s) => {
            for (const x of [-400, 400]) {
                s.add(rect(200, 60, { fill: 'blue', stroke: null }).at(x, 0))
                s.add(text('0', { size: 40 }).at(x, 0).alignTo([x, 33], 'top'))
            }
            s.wait(1)
        }), { textGap: 0.3 })
        expect(twice.diagnostics).toHaveLength(2)
    })

    it('leaves alone a label that an object places beside its own mark, and judges text in a group, a card, and on a small backing', async () => {
        const on = { textGap: 0.3 }
        const single = (build: () => Node) => checkFilm(film((s) => { s.add(build()); s.wait(1) }), on)
        // A labeled dot puts its label beside its dot. The control is the same object without its mark of ownership.
        expect((await single(() => labeledDot('P'))).diagnostics).toEqual([])
        expect((await single(() => { const made = labeledDot('P'); delete made.data['ownLayout']; return made })).diagnostics).toMatchObject([{ code: 'film.text_crowded' }])
        // A group and a card only hold what the film gives them.
        const pair = () => group(rect(300, 60, { fill: 'blue', stroke: null }), text('caption', { size: 40 }).alignTo([0, 33], 'top'))
        expect((await single(pair)).diagnostics).toMatchObject([{ code: 'film.text_crowded' }])
        expect((await single(() => card({ figure: pair(), width: 500, height: 400 }))).diagnostics).toMatchObject([{ code: 'film.text_crowded' }])

        // A backing hides a line only when it covers the text and its room.
        const backed = (width: number, height: number) => checkFilm(film((s) => {
            s.add(line([-300, 22], [300, 22], { stroke: 'ink', width: 3 }))
            if (width > 0) s.add(rect(width, height, { fill: 'surface', stroke: null }))
            s.add(text('Label', { size: 40 }))
            s.wait(1)
        }), on)
        expect((await backed(0, 0)).diagnostics).toMatchObject([{ code: 'film.text_crowded' }])
        expect((await backed(260, 90)).diagnostics).toEqual([])
        expect((await backed(120, 36)).diagnostics).toMatchObject([{ code: 'film.text_crowded' }])

        const passing = await checkFilm(film({ fps: 12 }, (s) => {
            s.add(rect(300, 60, { fill: 'blue', stroke: null }))
            const label = s.add(text('caption', { size: 40 }).alignTo([0, 33], 'top'))
            s.play(shift(label, 0, 200), { duration: 0.5 })
            s.wait(0.5)
        }), { ...on, motion: true, times: [0.9] })
        expect(passing.diagnostics).toEqual([])
    })

    it('does not report text that crosses the margin only while it moves', async () => {
        const report = await checkFilm(film({ fps: 12 }, (s) => {
            const label = s.add(text('Sliding in', { size: 40 }).alignTo([-960 + 4, 0], 'left'))
            s.play(shift(label, 400, 0), { duration: 0.5 })
            s.wait(0.5)
        }), { motion: true, times: [0.9] })
        expect(report.diagnostics).toEqual([])
    })
})

// These run against the package build, because the point is the shipped module formats.
describe.skipIf(!existsSync(resolve('dist/stage.cjs')))('built modules', () => {
    const script = `const f = stage.film({ title: 'x' }, (s) => { s.add(stage.text('Built', { size: 80 })); s.add(stage.tex('x^2').at(0, 120)); s.wait(0.2) })
Promise.resolve(exporter.renderFilmFrame(f, 0.1, OUT, { width: 320 })).then((r) => console.log(JSON.stringify(r))).catch((e) => { console.error(e); process.exit(1) })`

    it('renders through the CommonJS build, with fonts and the worker found from dist', async () => {
        const directory = await tempDirectory()
        const out = join(directory, 'cjs.png')
        const file = join(directory, 'run.cjs')
        await writeFile(file, `const stage = require(${JSON.stringify(resolve('dist/stage.cjs'))})
const exporter = require(${JSON.stringify(resolve('dist/stage-export.cjs'))})
const OUT = ${JSON.stringify(out)}
${script}`)
        const result = spawnSync(process.execPath, [file], { encoding: 'utf8', env: { PATH: process.env.PATH } })
        expect(result.status, result.stderr).toBe(0)
        expect(decode(await readFile(out)).width).toBe(320)
    }, 60_000)

    it('renders through the ESM build', async () => {
        const directory = await tempDirectory()
        const out = join(directory, 'esm.png')
        const file = join(directory, 'run.mjs')
        await writeFile(file, `import * as stage from ${JSON.stringify(`file://${resolve('dist/stage.js')}`)}
import * as exporter from ${JSON.stringify(`file://${resolve('dist/stage-export.js')}`)}
const OUT = ${JSON.stringify(out)}
${script}`)
        const result = spawnSync(process.execPath, [file], { encoding: 'utf8', env: { PATH: process.env.PATH } })
        expect(result.status, result.stderr).toBe(0)
        expect(decode(await readFile(out)).width).toBe(320)
    }, 60_000)
})

describe('film check and bleed', () => {
    const overscan = (bleed: boolean) => film({ bleed }, (s) => {
        s.add(line([-2000, -300], [200, -300], { stroke: 'blue' }))
        s.wait(1)
    })

    it('reports a line past the frame edge unless the film declares that it bleeds', async () => {
        const codes = async (bleed: boolean) => (await checkFilm(overscan(bleed))).diagnostics.map((finding) => finding.code)
        expect(await codes(false)).toContain('film.off_canvas')
        expect(await codes(true)).not.toContain('film.off_canvas')
    })

    it('still reports text that runs off the frame in a film that bleeds', async () => {
        const report = await checkFilm(film({ bleed: true }, (s) => {
            s.add(text('Off the edge', { size: 60 }).at(960, 0))
            s.wait(1)
        }))
        expect(report.diagnostics.map((finding) => finding.code)).toContain('film.off_canvas')
    })
})
