import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decode, encode } from 'fast-png'
import { build } from 'esbuild'
import {
    angleMark, arrayCells, arrow, axes, axes3d, barChart, bitField, boundary, braceLabel, callout, card, circle, circumscribe, codeBlock, complexPlane, connector, countUp, counter,
    crossThrough, dateLine, decimal, donut, dot, dotChart, dynamic, eventLog, film, fromSvg, graph, group, heatmap, highlightSweep, histogram, image, infoBox, label3d, labeledDot, lanes, legend, line,
    lineChart, linear, matrix, morphMatching, neuralNet, Node, numberLine, pictogram, pie, point3d, polygon, polyline, quote, quotePair, rect, resolveImageAsset, ringBuffer, scatter, scene3d, seq, shift, sphere, spin,
    segmentedBar, stateGrid, steps, surface,
    surroundingBox, svgPath, tag, tagTrack, terminal, tex, text, to, tokens, tree, typewriter, unitChart, vectorField, write, zone,
} from '../src/stage/index'
import { filmEncoderSettings, planRender, posterTime, renderFilmFrame, renderFilmGif, renderFilmSvg, renderFilmVideo, captionsToVtt } from '../src/stage/export'
import { checkFilm, readingSeconds } from '../src/stage/check'
import { compileFilm } from '../src/stage/stage'
import { RasterPool, framesToJob, sameRasterJob } from '../src/stage/raster'
import { renderRgbaVideo } from '../src/video'

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
            const perWorker = frameBytes * (blur > 1 ? blur + 4 : 3)
            expect(plan.workers * perWorker + (plan.readAhead - plan.workers) * frameBytes).toBeLessThanOrEqual(budget * 1.05)
        }
    })

    it('uses every requested worker at HD', () => {
        expect(planRender(1920, 1080, 1, { workers: 8, memoryBudget: 2 * 1024 ** 3 }).workers).toBe(8)
    })
})

type Build = (s: Parameters<Parameters<typeof film>[1]>[0]) => void

describe('film export', () => {
    it('honors a required hardware encoder in a range export', async () => {
        const directory = await tempDirectory()
        const output = join(directory, 'existing.mp4')
        await writeFile(output, 'previous delivery')
        await expect(renderFilmVideo(simple, output, {
            from: 0, to: 0.2, width: 319, workers: 1,
            ffmpegPath: join(directory, 'unavailable-ffmpeg'), h264Encoder: 'videotoolbox', requireH264Encoder: true,
        })).rejects.toThrow('unavailable')
        expect(await readFile(output, 'utf8')).toBe('previous delivery')
    }, 30_000)

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

    describe.skipIf(process.platform === 'win32')('the dither of the bloom', () => {
        const width = 320, height = 180, bytes = width * height * 4
        const page = () => [11, 12, 16] as const
        // A ring of light on the dark page of the default look, or on paper, which has no bloom. Nothing moves.
        const ring = (look?: 'paper') => compileFilm(film({ fps: 10, bloom: 0.6 }, (s) => {
            s.add(circle(200, { stroke: 'yellow', width: 10 }))
            s.wait(0.5)
        }), look ? { look } : {})
        type Ring = Awaited<ReturnType<typeof ring>>

        /** The frame of the ring with the plain bloom and with the dithered bloom. */
        async function expectedFrames(dark: Ring): Promise<{ plain: Uint8Array; dithered: Uint8Array }> {
            const pool = new RasterPool(1)
            try {
                const frame = await dark.frame(0.1)
                const plain = await pool.run(framesToJob([frame], width, page, height, false))
                const dithered = await pool.run(framesToJob([frame], width, page, height))
                expect(Buffer.compare(plain, dithered)).not.toBe(0)
                return { plain, dithered }
            } finally {
                await pool.close()
            }
        }

        /** Render a movie with a stand-in for FFmpeg that keeps its arguments and copies the raw frames to the output path. */
        async function movie(directory: string, name: string, compiled: Ring, options: Parameters<typeof renderFilmVideo>[2]) {
            const encoder = join(directory, 'keep-frames.sh')
            await writeFile(encoder, '#!/bin/sh\ncase "$1" in -h) exit 0;; esac\nfor last; do :; done\nprintf \'%s\\n\' "$@" > "$last.args"\nexec cat > "$last"\n', { mode: 0o755 })
            const output = await renderFilmVideo(compiled, join(directory, name), { width, workers: 1, ffmpegPath: encoder, ...options })
            // The encoder gets a temporary path, so find its arguments beside the frames by name.
            const kept = (await readdir(directory, { recursive: true })).find((file) => file.includes(name) && file.endsWith('.args'))
            const args = (await readFile(join(directory, kept!), 'utf8')).split('\n')
            const at = args.indexOf('-x264-params')
            return { frames: await readFile(output.outputPath), settings: at < 0 ? undefined : args[at + 1] }
        }

        // The defaults: a quality for work on a film has no dither, and a quality for a copy to publish has it.
        // The settings are what the H.264 encoder gets with the dither, so that it keeps the grain.
        it.each([
            ['draft', false, 'aq-strength=2.0'],
            ['standard', false, 'aq-strength=1.0:subme=6:trellis=0'],
            ['high', true, 'subme=6:trellis=0'],
            ['master', true, 'subme=6:trellis=0'],
        ] as const)('at %s, a movie has the dither by default: %s, and the option turns it on with %s and off with no settings', async (quality, byDefault, settings) => {
            const directory = await tempDirectory()
            const dark = await ring(), { plain, dithered } = await expectedFrames(dark)
            // The first frame and a later frame: a still picture has the same grain in each. The motion blur is
            // that of the quality, so at high and master each frame is an average of shutter samples.
            const shows = (frames: Buffer, expected: Uint8Array) => frames.length === 5 * bytes
                && Buffer.compare(frames.subarray(0, bytes), expected) === 0 && Buffer.compare(frames.subarray(3 * bytes, 4 * bytes), expected) === 0
            const unset = await movie(directory, `${quality}.raw`, dark, { quality })
            expect(shows(unset.frames, byDefault ? dithered : plain)).toBe(true)
            expect(unset.settings).toBe(byDefault ? settings : undefined)
            const on = await movie(directory, `${quality}-on.raw`, dark, { quality, dither: true })
            expect(shows(on.frames, dithered)).toBe(true)
            expect(on.settings).toBe(settings)
            const off = await movie(directory, `${quality}-off.raw`, dark, { quality, dither: false })
            expect(shows(off.frames, plain)).toBe(true)
            expect(off.settings).toBeUndefined()
        }, 120_000)

        it('gives the settings of the grain to H.264 only, and only for a film with bloom', async () => {
            const directory = await tempDirectory()
            const dark = await ring(), { dithered } = await expectedFrames(dark)
            // VP9 takes no x264 settings. Its frames have the dither all the same.
            const webm = await movie(directory, 'high.webm.raw', dark, { quality: 'high', codec: 'vp9' })
            expect(webm.settings).toBeUndefined()
            expect(Buffer.compare(webm.frames.subarray(0, bytes), dithered)).toBe(0)
            // A look with no bloom has no grain to keep, with the dither by default or by the option.
            expect((await movie(directory, 'paper.raw', await ring('paper'), { quality: 'high' })).settings).toBeUndefined()
            expect((await movie(directory, 'paper-on.raw', await ring('paper'), { quality: 'standard', dither: true })).settings).toBeUndefined()
        }, 120_000)

        it('dithers a PNG unless the option turns it off, and never a GIF', async () => {
            const directory = await tempDirectory()
            const dark = await ring(), { plain, dithered } = await expectedFrames(dark)
            const still = async (name: string, options: Parameters<typeof renderFilmFrame>[3]) => {
                await renderFilmFrame(dark, 0.1, join(directory, name), { width, ...options })
                return decode(await readFile(join(directory, name))).data as Uint8Array
            }
            // A still is for a look at the picture, at any quality.
            expect(Buffer.compare(await still('ring.png', {}), dithered)).toBe(0)
            expect(Buffer.compare(await still('ring-draft.png', { quality: 'draft' }), dithered)).toBe(0)
            expect(Buffer.compare(await still('ring-off.png', { dither: false }), plain)).toBe(0)
            // A palette of 256 colors cannot hold the grain, so each frame of a GIF asks for the plain write.
            const run = vi.spyOn(RasterPool.prototype, 'run')
            try {
                await renderFilmGif(dark, join(directory, 'ring.gif'), { width, fps: 10, workers: 1, quality: 'high', dither: true })
                expect(run.mock.calls.length).toBeGreaterThan(0)
                expect(run.mock.calls.every(([job]) => job.dither === false)).toBe(true)
            } finally {
                run.mockRestore()
            }
        }, 120_000)

        it('keeps a still picture one job with the same bytes at two times, and has nothing to switch in a look with no bloom', async () => {
            const dark = await ring(), pool = new RasterPool(1)
            try {
                const [first, later] = [await dark.frame(0.1), await dark.frame(0.4)]
                // The grain does not move: the frame reuse of the export takes the pixels of the frame before.
                expect(sameRasterJob(framesToJob([first], width, page, height), framesToJob([later], width, page, height))).toBe(true)
                expect(Buffer.compare(await pool.run(framesToJob([first], width, page, height)), await pool.run(framesToJob([later], width, page, height)))).toBe(0)
                const paper = await (await ring('paper')).frame(0.1)
                expect(Buffer.compare(await pool.run(framesToJob([paper], width, page, height)), await pool.run(framesToJob([paper], width, page, height, false)))).toBe(0)
            } finally {
                await pool.close()
            }
        })
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

    it.skipIf(!hasFfmpeg)('stops when the signal aborts in the middle of a film, and leaves no file', async () => {
        const directory = await tempDirectory()
        const moving = film({ fps: 30 }, (s) => {
            const label = s.add(text('Abort', { size: 120 }))
            s.play(shift(label, 400, 0), { duration: 2, ease: linear })
            s.wait(1)
        })
        const controller = new AbortController()
        const seen: number[] = []
        const path = join(directory, 'aborted.mp4')
        await expect(renderFilmVideo(moving, path, {
            width: 320, workers: 3, signal: controller.signal,
            onProgress: (frame) => {
                seen.push(frame.index)
                if (frame.index === 20) controller.abort()
            },
        })).rejects.toMatchObject({ name: 'AbortError' })
        expect(seen[seen.length - 1]).toBe(20)
        expect(existsSync(path)).toBe(false)
    }, 60_000)

    it.skipIf(!hasFfmpeg)('renders every frame with one worker', async () => {
        const directory = await tempDirectory()
        const output = await renderFilmVideo(simple, join(directory, 'one.mp4'), { width: 320, workers: 1 })
        expect(output).toMatchObject({ frameCount: 12, workers: 1 })
        const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', output.outputPath], { encoding: 'utf8' })
        expect(Number(probe.stdout.trim())).toBe(12)
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

    it('reports text that leaves before a viewer can read it, in a motion scan only', async () => {
        const { fadeIn, fadeOut } = await import('../src/stage/anim')
        const words = 'one forecast drifts, and the law breaks'
        const lesson = (seconds: number, fade = 0.2) => film({ fps: 30 }, (s) => {
            s.add(text('Heading', { size: 60 }).at(0, -460))
            const note = text(words, { size: 40 })
            s.wait(1)
            s.play(fadeIn(note, { duration: fade, ease: linear }))
            s.wait(seconds)
            s.play(fadeOut(note, { duration: 0.2, ease: linear }))
            s.wait(1)
        })
        // 39 characters need 1.95 s at 20 characters in one second. Three quarters of each fade count.
        const report = await checkFilm(lesson(0.5), { motion: true })
        expect(report.diagnostics).toMatchObject([{ code: 'film.text_brief', severity: 'warning', text: words, motion: { spans: 1 } }])
        expect(report.diagnostics[0]!.message).toBe(`Text ${JSON.stringify(words)} is up for 0.8 s. A viewer needs about 1.95 s for its 39 characters.`)
        expect(report.diagnostics[0]!.time).toBeGreaterThan(0.9)
        expect(report.diagnostics[0]!.until).toBeLessThan(2)
        // The box is the place of the whole text, which is about 700 px wide and in the middle of the frame.
        expect(report.diagnostics[0]!.box.width).toBeGreaterThan(500)
        expect(Math.abs(report.diagnostics[0]!.stage.x)).toBeLessThan(5)
        expect(report.ok).toBe(true)
        expect((await checkFilm(lesson(2), { motion: true })).diagnostics).toEqual([])
        expect((await checkFilm(lesson(0.5))).diagnostics).toEqual([])
        // A tenth less than the time is not reported, at any frame rate.
        expect((await checkFilm(lesson(1.5), { motion: true })).diagnostics).toEqual([])
        // The time of a fade under an opacity of 0.25 does not count: a fade of 2 s gives 1.5 s, and 0.15 s of the way out.
        expect((await checkFilm(lesson(0, 2), { motion: true })).diagnostics).toMatchObject([{ code: 'film.text_brief' }])
        expect((await checkFilm(lesson(0.3, 2), { motion: true })).diagnostics).toEqual([])
        // A slower reader needs more time, and 0 turns the rule off.
        expect((await checkFilm(lesson(2), { motion: true, readingSpeed: 10 })).diagnostics).toMatchObject([{ code: 'film.text_brief' }])
        expect((await checkFilm(lesson(0.5), { motion: true, readingSpeed: 0 })).diagnostics).toEqual([])
        await expect(checkFilm(lesson(0.5), { motion: true, readingSpeed: Number.NaN })).rejects.toThrow(/readingSpeed/)
        // `readingSeconds` gives the time that the rule asks for, and half a second at least.
        expect(readingSeconds(words)).toBeCloseTo(1.95, 6)
        expect(readingSeconds('  two\n words ')).toBe(0.5)
        expect(readingSeconds(words, 10)).toBeCloseTo(3.9, 6)
        expect(() => readingSeconds(words, 0)).toThrow(/more than 0/)
        expect((await checkFilm(lesson(readingSeconds(words)), { motion: true })).diagnostics).toEqual([])
    })

    it('does not report text that a viewer has time for, or does not have to read', async () => {
        const { fadeIn, fadeOut } = await import('../src/stage/anim')
        type Build = (s: Parameters<Parameters<typeof film>[1]>[0]) => void
        const heading: Build = (s) => { s.add(text('Heading', { size: 60 }).at(0, -460)) }
        const quiet: Record<string, Build> = {
            // A dynamic drawing makes a new text on every frame, and the number of digits changes on the way.
            'a number that counts': (s) => {
                const count = s.value(0)
                s.add(dynamic(() => text(`${Math.round(count.value).toLocaleString('en-US')} tokens of the prompt`, { size: 40 })))
                s.play(count.to(12000, { duration: 1.2 }))
                s.wait(1)
                s.play(count.to(-0.5, { duration: 0.01 }))
                s.wait(0.2)
            },
            'a text that is typed': (s) => {
                const typed = 'this line is typed one letter at a time', letters = s.value(1)
                s.add(dynamic(() => text(typed.slice(0, Math.round(letters.value)), { size: 40, anchor: 'left' }).at(-400, 0)))
                s.play(letters.to(typed.length, { duration: 1, ease: linear }))
                s.wait(1.5)
            },
            // A text that the film dims after its turn is still there to read.
            'a text that is dimmed after its turn': (s) => {
                const dimmed = s.add(text('a text that is dimmed after its turn', { size: 40 }))
                s.play(to(dimmed, (node) => node.opacity(0.4), { duration: 0.3 }))
                s.wait(1.5)
                s.remove(dimmed)
                s.wait(0.5)
            },
            // A number takes no time to read, also with a unit or an exponent of one letter.
            'a number alone': (s) => {
                const flash = s.add(text('7.04 e-3', { size: 40 }))
                s.wait(0.2)
                s.remove(flash)
                s.wait(0.5)
            },
            // A text that gets more words in place is one text, also when it is away for a moment on the way.
            'a text that grows in place': (s) => {
                const state = s.value(0)
                s.add(dynamic(() => (state.value > 1.5 ? text('The fix helps only a patched fleet', { size: 40, anchor: 'left' }).at(-400, 0)
                    : state.value < 0.5 ? text('The fix', { size: 40, anchor: 'left' }).at(-400, 0) : null)))
                s.wait(0.5)
                s.play(state.to(1, { duration: 0.01 }))
                s.wait(0.5)
                s.play(state.to(2, { duration: 0.01 }))
                s.wait(2)
                s.play(state.to(1, { duration: 0.01 }))
                s.wait(0.5)
            },
            // A formula has far fewer signs than its source has characters: 12 signs here, from 35 characters.
            // Two of them at two places are still 12 signs to read.
            'a formula, at two places': (s) => {
                const source = '\\frac{x^{3}}{3!} + \\frac{x^{5}}{5!}'
                const pair = [tex(source, { size: 60 }).at(-400, 0), tex(source, { size: 60 }).at(400, 0)]
                s.play(fadeIn(pair, { duration: 0.1 }))
                s.wait(0.7)
                s.play(fadeOut(pair, { duration: 0.1 }))
                s.wait(0.5)
            },
            // The first words of a sentence stay for a moment after the sentence. The viewer has read them.
            'what stays of a sentence that was read': (s) => {
                const state = s.value(0)
                s.add(dynamic(() => (state.value > 1.5 ? null : text(state.value > 0.5 ? 'The fix' : 'The fix helps only a patched fleet', { size: 40, anchor: 'left' }).at(-400, 0))))
                s.wait(3)
                s.play(state.to(1, { duration: 0.01 }))
                s.wait(0.3)
                s.play(state.to(2, { duration: 0.01 }))
                s.wait(1)
            },
            // A still, or a film that loops, gives a text all its time: it is up from the first frame to the last.
            'a text that is up for the whole of a short film': (s) => {
                s.add(text('The polynomial only ever looked at one point.', { size: 40 }))
                s.wait(0.3)
            },
            // A faint mark in the background is not there to be read.
            'a text that stays faint': (s) => {
                const faint = s.add(text('a watermark behind the picture', { size: 40 }).opacity(0.2))
                s.wait(0.4)
                s.remove(faint)
                s.wait(0.5)
            },
        }
        for (const [name, build] of Object.entries(quiet)) {
            const report = await checkFilm(film({ fps: 30 }, (s) => { heading(s); build(s) }), { motion: true })
            expect({ name, diagnostics: report.diagnostics }).toEqual({ name, diagnostics: [] })
        }
    })

    it('reports a text that flashes and comes back longer, shrinks, is typed and cut, or arrives as the film ends', async () => {
        type Build = (s: Parameters<Parameters<typeof film>[1]>[0]) => void
        const sentence = 'The fix helps only a fleet that is patched', other = 'The fix is to restart every node at once'
        // Texts at one place, each for a time. An empty text is a time with nothing there.
        const sequence = (...steps: [string, number][]): Build => (s) => {
            const state = s.value(0)
            s.add(dynamic(() => {
                const words = steps[Math.round(state.value)]?.[0]
                return words ? text(words, { size: 40, anchor: 'left' }).at(-400, 0) : null
            }))
            steps.forEach(([, seconds], index) => {
                s.wait(seconds)
                s.play(state.to(index + 1, { duration: 0.01 }))
            })
            s.wait(1)
        }
        const loud: Record<string, [Build, string]> = {
            // The time between the two texts is not time to read.
            'a flash, a gap, and a longer text for a moment': [sequence(['The fix', 0.1], ['', 1.5], [sentence, 0.3]), sentence],
            // The reader has read the short text, and then has too little time for the rest.
            'a short text for long, then a longer one for a moment': [sequence(['The fix', 3], [sentence, 0.5]), sentence],
            // A text that shrinks is the long text, cut short. What stays of it is not reported again.
            'a sentence for a moment, then its first word for long': [sequence([sentence, 0.3], ['The', 4]), sentence],
            // The first words of a sentence that was read do not pay for another sentence.
            'a sentence, then its first words, then another sentence for a moment': [sequence([sentence, 3], ['The fix', 0.3], [other, 0.2]), other],
            'a text that is typed fast and cut': [(s) => {
                const letters = s.value(1)
                s.add(dynamic(() => (letters.value > sentence.length + 0.5 ? null : text(sentence.slice(0, Math.round(letters.value)), { size: 40, anchor: 'left' }).at(-400, 0))))
                s.play(letters.to(sentence.length, { duration: 0.3, ease: linear }))
                s.wait(0.2)
                s.play(letters.to(sentence.length + 1, { duration: 0.01 }))
                s.wait(1)
            }, sentence],
            // A film that ends is not a reason: a text that comes as the film ends is the defect, at the end.
            'a text that arrives as the film ends': [(s) => {
                s.wait(1)
                s.add(text(sentence, { size: 40 }))
                s.wait(0.2)
            }, sentence],
        }
        for (const [name, [build, words]] of Object.entries(loud)) {
            const report = await checkFilm(film({ fps: 30 }, (s) => { s.add(text('Heading', { size: 60 }).at(0, -460)); build(s) }), { motion: true })
            expect({ name, found: report.diagnostics.map((entry) => [entry.code, entry.text]) }).toEqual({ name, found: [['film.text_brief', words]] })
            // The box is the place of the whole sentence, not of its first letters.
            expect(report.diagnostics[0]!.box.width).toBeGreaterThan(500)
            expect(report.diagnostics[0]!.message.endsWith('The film ends here.')).toBe(name === 'a text that arrives as the film ends')
        }
    })

    it('reports once a text that comes several times, a label that changes in place, and rows that scroll', async () => {
        type Build = (s: Parameters<Parameters<typeof film>[1]>[0]) => void
        const scan = (build: Build) => checkFilm(film({ fps: 30 }, (s) => { s.add(text('Heading', { size: 60 }).at(0, -460)); build(s) }), { motion: true })
        const blink = await scan((s) => {
            const on = s.value(0)
            s.add(dynamic(() => (on.value > 0.5 ? text('a note that comes and goes', { size: 40 }) : null)))
            for (let k = 0; k < 3; k++) {
                s.play(on.to(1, { duration: 0.1 }))
                s.wait(0.3)
                s.play(on.to(0, { duration: 0.1 }))
                s.wait(0.2)
            }
            s.wait(1)
        })
        expect(blink.diagnostics).toMatchObject([{ code: 'film.text_brief', text: 'a note that comes and goes', motion: { spans: 3 } }])
        expect(blink.diagnostics[0]!.message).toMatch(/^Text "a note that comes and goes" is up for 0\.\d+ s\..* It comes 3 times, each time too briefly\.$/)

        // One text takes the place of another, at one place.
        const months = ['January of that year', 'February of that year', 'March of that year', 'April of that year', 'May of that year']
        const ticker = await scan((s) => {
            const month = s.value(0)
            s.add(dynamic(() => (month.value >= 4.5 ? null : text(months[Math.round(month.value)]!, { size: 40 }))))
            s.play(month.to(5, { duration: 2, ease: linear }))
            s.wait(1)
        })
        expect(ticker.diagnostics).toMatchObject([{ code: 'film.text_brief', text: months[0], motion: { spans: 5 } }])
        expect(ticker.diagnostics[0]!.message).toBe('5 texts follow each other here, and each leaves before a viewer can read it: "January of that year", "February of that year", "March of that year", and 2 more.')

        // Rows move through one window. Several are up at one time.
        const rows = ['cache-16 has the first row', 'cache-2 has the second row', 'cache-6 has the third row', 'cache-9 has the fourth row', 'cache-4 has the fifth row', 'cache-7 has the last row']
        const scroll = await scan((s) => {
            const offset = s.value(-200)
            s.add(dynamic(() => rows.flatMap((row, index) => {
                const y = index * 80 - offset.value
                return Math.abs(y) < 130 ? [text(row, { size: 40 }).at(0, y)] : []
            })))
            s.play(offset.to(rows.length * 80 + 200, { duration: 2, ease: linear }))
            s.wait(1)
        })
        expect(scroll.diagnostics).toMatchObject([{ code: 'film.text_brief', text: rows[0], motion: { spans: 6 } }])

        // Two labels side by side, up at one time, are two texts. So are two notes at one place with a pause between them.
        const beside = await scan((s) => {
            const pair = [s.add(text('the label on the left side', { size: 40 }).at(-450, 0)), s.add(text('the label on the right side', { size: 40 }).at(450, 0))]
            s.wait(0.3)
            s.remove(...pair)
            s.wait(1)
        })
        expect(beside.diagnostics.map((entry) => entry.text).sort()).toEqual(['the label on the left side', 'the label on the right side'])
        const apart = await scan((s) => {
            for (const words of ['the first note of the scene', 'another note, much later on']) {
                const note = s.add(text(words, { size: 40 }))
                s.wait(0.3)
                s.remove(note)
                s.wait(1.5)
            }
        })
        expect(apart.diagnostics.map((entry) => entry.text)).toEqual(['the first note of the scene', 'another note, much later on'])
        // So are two notes at two places, where the second comes as the first leaves.
        const elsewhere = await scan((s) => {
            const first = s.add(text('a note at the top of the frame', { size: 40 }).at(0, -250))
            s.wait(0.3)
            s.remove(first)
            const second = s.add(text('a note at the bottom, right after', { size: 40 }).at(0, 250))
            s.wait(0.3)
            s.remove(second)
            s.wait(1)
        })
        expect(elsewhere.diagnostics.map((entry) => entry.text)).toEqual(['a note at the top of the frame', 'a note at the bottom, right after'])
    })

    it('does not report text that is up where a stepped film stops', async () => {
        const deck = film({ fps: 30 }, (s) => {
            s.chapter('One')
            s.add(text('Heading', { size: 60 }).at(0, -460))
            s.wait(1)
            const point = s.add(text('the last point of the first slide', { size: 40 }))
            s.wait(0.3)
            // A stepped player waits on the first frame of a chapter, and that frame still shows the point.
            s.chapter('Two')
            s.wait(0.2)
            s.remove(point)
            s.wait(1)
        })
        expect((await checkFilm(deck, { motion: true })).diagnostics).toMatchObject([{ code: 'film.text_brief', text: 'the last point of the first slide' }])
        expect((await checkFilm(deck, { motion: true, stepped: true })).diagnostics).toEqual([])
        // A point that leaves as the chapter starts is not on the frame where the player waits.
        const gone = film({ fps: 30 }, (s) => {
            s.chapter('One')
            s.add(text('Heading', { size: 60 }).at(0, -460))
            s.wait(1)
            const point = s.add(text('the last point of the first slide', { size: 40 }))
            s.wait(0.3)
            s.remove(point)
            s.chapter('Two')
            s.wait(1)
        })
        expect((await checkFilm(gone, { motion: true, stepped: true })).diagnostics).toMatchObject([{ code: 'film.text_brief' }])
        // A deck also waits on its last frame, so the last point of the last slide has time.
        const last = film({ fps: 30 }, (s) => {
            s.chapter('One')
            s.add(text('Heading', { size: 60 }).at(0, -460))
            s.wait(1)
            s.add(text('the last point of the last slide', { size: 40 }))
            s.wait(0.3)
        })
        expect((await checkFilm(last, { motion: true })).diagnostics).toMatchObject([{ code: 'film.text_brief' }])
        expect((await checkFilm(last, { motion: true, stepped: true })).diagnostics).toEqual([])
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
        expect(near.diagnostics[0]!.message).toBe('Text "caption" is 3 px from a filled shape above it. Leave 12 px or more.')
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
        expect((await label(22)).diagnostics[0]!.message).toBe('Text "22M" is wider than the filled shape behind it.')
        // The finding starts at the first moment of the film, and not at its last picture: the text and the dot are a pair that lasts.
        expect((await label(22)).diagnostics[0]!.time).toBeLessThan(0.5)
        expect((await label(90)).diagnostics).toEqual([])
    })

    it('reports the caption that a viewer saw 8.9 px under its figure, and lets half a pixel pass', async () => {
        // The room of a text of size 32 is 9.6 px.
        const caption = (gap: number) => checkFilm(film((s) => {
            s.add(rect(300, 60, { fill: 'blue', stroke: null }))
            s.add(text('every type of telemetry', { size: 32 }).alignTo([0, 30 + gap], 'top'))
            s.wait(1)
        }), { textGap: 0.3 })
        expect((await caption(8.9)).diagnostics).toMatchObject([{ code: 'film.text_crowded', message: 'Text "every type of telemetry" is 8 px from a filled shape above it. Leave 10 px or more.' }])
        // A film places its marks at whole pixels, so a gap can be half a pixel under the room.
        expect((await caption(9.2)).diagnostics).toEqual([])
        expect((await caption(9.6)).diagnostics).toEqual([])
    })

    it('measures the room from the font size and to the letters, and reports each text apart', async () => {
        // Words of one size get one room, whatever letters they have.
        const words = await checkFilm(film((s) => {
            for (const [word, x] of [['acme', -300], ['Apply', 300]] as const) {
                const made = s.add(text(word, { size: 40 }).at(x, 0))
                const box = made.bounds()
                s.add(line([box.x - 30, box.y + box.height + 8], [box.x + box.width + 30, box.y + box.height + 8], { stroke: 'ink', width: 2 }))
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
        // A labeled dot puts its label beside its dot. A film that builds the same picture from a dot and a label is judged.
        expect((await single(() => labeledDot('P'))).diagnostics).toEqual([])
        const byHand = () => {
            const made = labeledDot('P'), [x, y] = made.caption.center
            return group(dot(9, 'yellow'), tex('P', { size: 30, color: 'yellow', display: false }).moveTo([x, y]))
        }
        expect((await single(byHand)).diagnostics).toMatchObject([{ code: 'film.text_crowded', text: 'P' }])
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

        // A backing counts from 80% opacity. A line shows through a weaker one.
        const veiled = (opacity: number) => checkFilm(film((s) => {
            s.add(line([-300, 22], [300, 22], { stroke: 'ink', width: 3 }))
            s.add(rect(260, 90, { fill: 'bg', stroke: null }).opacity(opacity))
            s.add(text('Label', { size: 40 }))
            s.wait(1)
        }), on)
        expect((await veiled(0.85)).diagnostics).toEqual([])
        expect((await veiled(0.7)).diagnostics).toMatchObject([{ code: 'film.text_crowded' }])

        // A line runs under the letters, and the backing hides it for 4 px around them. The distance is to the part that shows.
        const tight = await checkFilm(film((s) => {
            const label = text('Label', { size: 40 }), box = label.bounds()
            s.add(line([-300, 0], [300, 0], { stroke: 'ink', width: 3 }))
            s.add(rect(box.width + 8, box.height + 8, { fill: 'bg', stroke: null }).at(box.x + box.width / 2, box.y + box.height / 2))
            s.add(label)
            s.wait(1)
        }), on)
        expect(tight.diagnostics).toMatchObject([{ code: 'film.text_crowded', message: 'Text "Label" is 4 px from a line left of it. Leave 12 px or more.' }])

        // A line that starts on the edge of a backing is not under the backing. Its distance is to its middle, less half its width.
        const beside = await checkFilm(film((s) => {
            const label = text('Label', { size: 40 }), box = label.bounds(), right = box.x + box.width + 12
            s.add(line([right, 0], [right + 200, 0], { stroke: 'ink', width: 2 }))
            s.add(rect(box.width + 24, box.height + 24, { fill: 'bg', stroke: null }).at(box.x + box.width / 2, box.y + box.height / 2))
            s.add(label)
            s.wait(1)
        }), on)
        expect(beside.diagnostics).toMatchObject([{ code: 'film.text_crowded', message: 'Text "Label" is 11 px from a line right of it. Leave 12 px or more.' }])

        // A patch that the film draws after the text hides a line too. A patch under the line hides nothing.
        const patched = (after: boolean) => checkFilm(film((s) => {
            const patch = rect(700, 30, { fill: 'bg', stroke: null }).at(0, 37)
            if (!after) s.add(patch)
            s.add(line([-300, 26], [300, 26], { stroke: 'ink', width: 3 }))
            s.add(text('Label', { size: 40 }))
            if (after) s.add(patch)
            s.wait(1)
        }), on)
        expect((await patched(true)).diagnostics).toEqual([])
        expect((await patched(false)).diagnostics).toMatchObject([{ code: 'film.text_crowded' }])

        const passing = await checkFilm(film({ fps: 12 }, (s) => {
            s.add(rect(300, 60, { fill: 'blue', stroke: null }))
            const label = s.add(text('caption', { size: 40 }).alignTo([0, 33], 'top'))
            s.play(shift(label, 0, 200), { duration: 0.5 })
            s.wait(0.5)
        }), { ...on, motion: true, times: [0.9] })
        expect(passing.diagnostics).toEqual([])
    })

    it('reports a line at the letters by one rule, from a line through them to a line at the end of the room', async () => {
        // A 2 px line at a distance from the bottom of the letters. Less than 0 is inside the letters.
        const codes = async (distance: number) => (await checkFilm(film((s) => {
            const word = s.add(text('acme', { size: 40 })), box = word.bounds()
            s.add(line([box.x - 40, box.y + box.height + distance], [box.x + box.width + 40, box.y + box.height + distance], { stroke: 'ink', width: 2 }))
            s.wait(1)
        }), { textGap: 0.3 })).diagnostics.map((entry) => `${entry.code}: ${entry.message}`)
        // The room is 12 px, the line is 1 px to each side of its middle, and half a pixel passes.
        const seen: string[] = []
        for (let distance = -8; distance <= 12; distance += 0.5) {
            const found = await codes(distance)
            expect(found, `at ${distance} px`).toHaveLength(1)
            seen.push(found[0]!.split(':')[0]!)
        }
        // The two rules meet: one change from the one to the other, and no place with none.
        expect(seen.filter((code, index) => index > 0 && code !== seen[index - 1])).toEqual(['film.text_crowded'])
        expect(seen[0]).toBe('film.text_crossed')
        for (const distance of [-2, -1, -0.5, 0, 1]) expect(await codes(distance)).toEqual(['film.text_crowded: Text "acme" touches a line below it. Leave 12 px or more.'])
        expect(await codes(4)).toEqual(['film.text_crowded: Text "acme" is 3 px from a line below it. Leave 12 px or more.'])
        expect(await codes(13)).toEqual([])

        // A line that goes up through the first letter, 1 px inside it.
        const upright = await checkFilm(film((s) => {
            const word = s.add(text('H', { size: 40 })), box = word.bounds()
            s.add(line([box.x + 1, box.y - 40], [box.x + 1, box.y + box.height + 40], { stroke: 'ink', width: 2 }))
            s.wait(1)
        }), { textGap: 0.3 })
        expect(upright.diagnostics).toMatchObject([{ code: 'film.text_crowded', message: 'Text "H" touches a line left of it. Leave 12 px or more.' }])
    })

    it('reports text that starts on a filled shape and leaves it, with a message for each case', async () => {
        const on = { textGap: 0.3 }
        const messages = async (build: Build) => (await checkFilm(film((s) => { build(s); s.wait(1) }), on)).diagnostics.map((entry) => `${entry.code}: ${entry.message}`)
        // Over one edge of a wide shape. The middle of the text is off the shape.
        expect(await messages((s) => {
            s.add(rect(300, 60, { fill: 'blue', stroke: null }))
            s.add(text('caption', { size: 40 }).at(170, 0))
        })).toEqual(['film.text_crowded: Text "caption" runs past the edge of the filled shape behind it.'])
        // A low bar behind a word.
        expect(await messages((s) => {
            const word = text('marked', { size: 40 }), box = word.bounds()
            s.add(rect(box.width + 12, 14, { fill: 'blue', stroke: null }).at(box.x + box.width / 2, box.y + box.height / 2))
            s.add(word)
        })).toEqual(['film.text_crowded: Text "marked" is taller than the filled shape behind it.'])
        // The edge of the shape is between two letters.
        expect(await messages((s) => {
            const word = s.add(text('i i', { size: 40 })), box = word.bounds()
            s.add(rect(200, 80, { fill: 'blue', stroke: null }).at(box.x + box.width / 2 - 100, 0)).zIndex(-1)
        })).toEqual(['film.text_crowded: Text "i i" runs past the edge of the filled shape behind it.'])
        // All of the text is on the shape, with room.
        expect(await messages((s) => {
            s.add(rect(300, 80, { fill: 'blue', stroke: null }))
            s.add(text('caption', { size: 40 }))
        })).toEqual([])
        // A filled bar over the letters is a strike. No rule reports it, and this pins that limit.
        expect(await messages((s) => {
            const word = s.add(text('struck', { size: 40 })), box = word.bounds()
            s.add(rect(box.width + 12, 3, { fill: 'red', stroke: null }).at(box.x + box.width / 2, box.y + box.height / 2))
        })).toEqual([])
    })

    it('takes a thin bar in the middle of the letters as a strike, and a strike excuses no other mark', async () => {
        const on = { textGap: 0.3 }
        const messages = async (build: Build) => (await checkFilm(film((s) => { build(s); s.wait(1) }), on)).diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message)
        const strike = (box: { x: number; y: number; width: number; height: number }) => rect(box.width + 12, 3, { fill: 'red', stroke: null }).at(box.x + box.width / 2, box.y + box.height / 2)
        // A word with a strike, 3 px over a line: the strike holds no letter, so it is not the shape that holds the word.
        for (const struck of [false, true]) {
            expect(await messages((s) => {
                const box = s.add(text('UPDATE', { size: 30, font: 'mono' })).bounds()
                if (struck) s.add(strike(box))
                s.add(line([box.x - 30, box.y + box.height + 4], [box.x + box.width + 30, box.y + box.height + 4], { stroke: 'ink', width: 2 }))
            }), `struck: ${struck}`).toEqual(['Text "UPDATE" is 3 px from a line below it. Leave 9 px or more.'])
            // The same word 3 px under a filled bar.
            expect(await messages((s) => {
                const box = s.add(text('DELETE', { size: 30, font: 'mono' })).bounds()
                if (struck) s.add(strike(box))
                s.add(rect(300, 60, { fill: 'blue', stroke: null }).at(0, box.y - 3 - 30))
            }), `struck: ${struck}`).toEqual(['Text "DELETE" is 3 px from a filled shape above it. Leave 9 px or more.'])
        }

        // A bar of 3 px that the film draws after a word of size 30, with its top at a distance from the lowest letter.
        const bar = (down: number, thick = 3) => messages((s) => {
            const box = s.add(text('gypsy pool', { size: 30 })).bounds()
            s.add(rect(box.width + 60, thick, { fill: 'ink', stroke: null }).at(box.x + box.width / 2, box.y + box.height + down + thick / 2))
        })
        expect(await bar(3)).toEqual(['Text "gypsy pool" is 3 px from a filled shape below it. Leave 9 px or more.'])
        expect(await bar(0)).toEqual(['Text "gypsy pool" touches a filled shape below it. Leave 9 px or more.'])
        // A bar that cuts into the bottom of the letters is worse than a bar under them. It is not a strike.
        expect(await bar(-2)).toEqual(['Text "gypsy pool" touches a filled shape below it. Leave 9 px or more.'])
        expect(await bar(-5)).toEqual(['Text "gypsy pool" is partly behind a filled shape.'])

        // The band of a strike is the middle half of the letters that the bar crosses: from 0.25 to 0.75 of their height.
        const across = (part: number, thick: number) => messages((s) => {
            const box = s.add(text('HIM', { size: 40 })).bounds()
            s.add(rect(box.width + 12, thick, { fill: 'red', stroke: null }).at(box.x + box.width / 2, box.y + box.height * part))
        })
        expect(await across(0.5, 3)).toEqual([])
        expect(await across(0.3, 3)).toEqual([])
        expect(await across(0.7, 3)).toEqual([])
        expect(await across(0.2, 3)).toEqual(['Text "HIM" is partly behind a filled shape.'])
        expect(await across(0.8, 3)).toEqual(['Text "HIM" is partly behind a filled shape.'])
        // A strike is thinner than 0.25 of the font size: under 10 px for a size of 40.
        expect(await across(0.5, 9)).toEqual([])
        expect(await across(0.5, 11)).toEqual(['Text "HIM" is partly behind a filled shape.'])
        // A strike is level. A thin upright bar through one letter covers a part of it.
        expect(await messages((s) => {
            const box = s.add(text('HIM', { size: 40 })).bounds()
            s.add(rect(3, box.height + 12, { fill: 'red', stroke: null }).at(box.x + box.width / 2, box.y + box.height / 2))
        })).toEqual([expect.stringMatching(/^Text "HIM" (is partly behind|touches) a filled shape/)])
    })

    it('judges text that a film puts in its own class, in imported markup, and in an object that places its own labels', async () => {
        const on = { textGap: 0.3 }
        const found = async (build: Build) => (await checkFilm(film((s) => { build(s); s.wait(1) }), on)).diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.text)
        const pair = () => [rect(300, 60, { fill: 'blue', stroke: null }), text('caption', { size: 40 }).alignTo([0, 33], 'top')]
        class Pair extends Node {
            constructor() {
                super()
                this.add(...pair())
            }
        }
        expect(await found((s) => { s.add(new Pair()) })).toEqual(['caption'])
        expect(await found((s) => {
            s.add(fromSvg('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect x="50" y="20" width="300" height="60" fill="#3b82f6"/><text x="200" y="113" font-size="40" text-anchor="middle" fill="#fff">caption</text></svg>'))
        })).toEqual(['caption'])
        // The film adds a figure with a caption to an info box, and a label on the line of an axis.
        expect(await found((s) => { s.add(infoBox({ title: 'Service', size: 30, width: 600 })).add(...pair().map((node) => node.shift(0, 200))) })).toEqual(['caption'])
        expect(await found((s) => { s.add(axes({ x: [0, 4], y: [0, 4], labels: false })).add(text('origin', { size: 30 }).alignTo([200, 323], 'top')) })).toEqual(['origin'])
        // The labels of the two objects are still theirs.
        expect(await found((s) => { s.add(infoBox({ title: 'Service', badge: 'p99', rows: [{ label: 'k', value: 'v', meter: 0.5 }], tags: ['one'], size: 30 })) })).toEqual([])
        expect(await found((s) => { s.add(axes({ x: [-10, 10], y: [-10, 10], width: 500, height: 300, xStep: 1, yStep: 1, labelSize: 26 })) })).toEqual([])
    })

    it('lets a line of the film pass a label of a plot, and no other label of an object', async () => {
        const on = { textGap: 0.3 }
        // A line of the film, 2 px under a text of the object.
        const under = async (build: () => Node, pick: (made: any) => Node) => (await checkFilm(film((s) => {
            const made = s.add(build()), box = pick(made).bounds()
            s.add(line([box.x - 30, box.y + box.height + 3], [box.x + box.width + 30, box.y + box.height + 3], { stroke: 'ink', width: 2 }))
            s.wait(1)
        }), on)).diagnostics.filter((entry) => entry.code === 'film.text_crowded').length
        expect(await under(() => labeledDot('P'), (made) => made.caption)).toBe(1)
        expect(await under(() => callout([0, 0], 'A note', { size: 30 }), (made) => made.body)).toBe(1)
        expect(await under(() => legend([{ label: 'read', color: 'blue' }], { size: 30 }), (made) => made.children[0].children[1])).toBe(1)
        expect(await under(() => codeBlock('return mid', { size: 30, panel: false }), (made) => made.lines[0])).toBe(1)
        expect(await under(() => matrix([[1], [3]], { size: 40 }), (made) => made.cell(1, 0))).toBe(1)
        // A plot: a curve of the film goes over the numbers of an axis. A number line stays a plot when it gets a marker.
        const plots: Record<string, () => Node> = {
            axes: () => axes({ x: [0, 4], y: [0, 4] }),
            numberLine: () => numberLine({ range: [0, 4], length: 600 }),
            'numberLine with a marker': () => { const made = numberLine({ range: [0, 4], length: 600 }); made.marker(4, { label: 'a' }); return made },
            complexPlane: () => complexPlane({ unit: 100, x: [-2, 2], y: [-2, 2], labelRange: 1 }),
            barChart: () => barChart([{ label: 'alpha', value: 2 }, { label: 'beta', value: 3 }]),
            histogram: () => histogram([1, 2, 2, 3, 3, 3, 4], { bins: 4, range: [0, 4] }),
            scatter: () => scatter([{ x: 0, y: 0 }, { x: 1, y: 1 }]),
            lineChart: () => lineChart([{ name: 'p95', values: [1, 2, 3] }]),
            dotChart: () => dotChart([{ label: 'a', value: 0.5 }], { domain: [0, 1] }),
        }
        const firstText = (made: Node) => made.all().find((node) => typeof (node as { source?: unknown }).source === 'string')!
        for (const [name, build] of Object.entries(plots)) expect(await under(build, firstText), name).toBe(0)
        // A filled shape of the film is judged there too.
        const shape = await checkFilm(film((s) => {
            const made = s.add(axes({ x: [0, 4], y: [0, 4] })), box = made.numbers.children[0]!.bounds()
            s.add(rect(60, 20, { fill: 'blue', stroke: null }).at(box.x + box.width / 2, box.y + box.height + 12))
            s.wait(1)
        }), on)
        expect(shape.diagnostics).toMatchObject([{ code: 'film.text_crowded' }])
    })

    it('takes a thin bar under the base line of a text as an underline, which excuses no other mark', async () => {
        const on = { textGap: 0.3 }
        // The base line of a text of size 40 in the middle of the frame is the bottom of a capital letter. A film measures it.
        let base = 0
        const messages = async (build: Build) => (await checkFilm(film((s) => {
            const flat = text('H', { size: 40 }).bounds()
            base = flat.y + flat.height
            build(s)
            s.wait(1)
        }), on)).diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message)
        // A bar under a word: how far its middle line is under the base line, its thickness, and how far its ends are past the word.
        const under = (word: string, depth: number, options: { thick?: number; past?: number; left?: number; to?: number; filled?: boolean; slant?: number } = {}) => messages((s) => {
            const box = s.add(text(word, { size: 40 })).bounds(), thick = options.thick ?? 3, past = options.past ?? 0
            const from = box.x - past - (options.left ?? 0), to = box.x + box.width * (options.to ?? 1) + past
            if (options.filled) s.add(rect(to - from, thick, { fill: 'blue', stroke: null }).at((from + to) / 2, base + depth))
            else s.add(line([from, base + depth], [to, base + depth + (options.slant ?? 0)], { stroke: 'blue', width: thick }))
        })
        // A film marks words with a line under them, or under a part of them. The tails of the letters may cross it.
        expect(await under('gypsy pool', 6)).toEqual([])
        expect(await under('gypsy pool', 6, { filled: true })).toEqual([])
        // A thick one, which a film draws after the word, covers a part of the tails. It is still an underline.
        expect(await under('gypsy pool', 6, { filled: true, thick: 9 })).toEqual([])
        expect(await under('gypsy pool', 6, { to: 0.45 })).toEqual([])
        expect(await under('acme', 1)).toEqual([])
        // The middle line is under the base line by 0.4 of the font size at the most: 16 px for a size of 40.
        expect(await under('gypsy pool', 15)).toEqual([])
        expect(await under('gypsy pool', 18)).toEqual([expect.stringMatching(/^Text "gypsy pool" is \d px from a line below it\. Leave 12 px or more\.$/)])
        // A bar over the base line cuts the letters. Under the middle half of the letters, it is not a strike.
        expect(await under('acme', -2)).toEqual(['Text "acme" touches a line below it. Leave 12 px or more.'])
        // The ends are in the box of the text, or past it by 0.25 of the font size at the most. A longer line is a rule.
        expect(await under('acme', 6, { past: 8 })).toEqual([])
        expect(await under('acme', 6, { past: 14 })).toEqual(['Text "acme" is 3 px from a line below it. Leave 12 px or more.'])
        // Each end counts: a line that goes past the left end only, or past the right end only, is a rule too.
        expect(await under('acme', 6, { left: 14 })).toEqual(['Text "acme" is 3 px from a line below it. Leave 12 px or more.'])
        expect(await under('acme', 6, { to: 1.2 })).toEqual(['Text "acme" is 3 px from a line below it. Leave 12 px or more.'])
        // An underline is as thin as a strike, and level.
        expect(await under('acme', 8, { filled: true, thick: 9 })).toEqual([])
        expect(await under('acme', 8, { filled: true, thick: 11 })).toEqual([expect.stringMatching(/^Text "acme" is \d px from a filled shape below it\. Leave 12 px or more\.$/)])
        expect(await under('acme', 6, { slant: 4 })).toEqual([expect.stringMatching(/^Text "acme" is \d px from a line below it\. Leave 12 px or more\.$/)])
        // A bar is a rectangle. A thin wedge under a word is a mark.
        expect(await messages((s) => {
            const box = s.add(text('acme', { size: 40 })).bounds()
            s.add(polygon([[box.x, base + 4], [box.x + box.width, base + 4], [box.x + box.width, base + 9]], { fill: 'blue', stroke: null }))
        })).toEqual([expect.stringMatching(/^Text "acme" is \d px from a filled shape below it\. Leave 12 px or more\.$/)])
        // An underline is wider than it is high. A small tick under a word is a mark.
        expect(await messages((s) => {
            const box = s.add(text('acme', { size: 40 })).bounds()
            s.add(rect(3, 8, { fill: 'blue', stroke: null }).at(box.x + box.width / 2, base + 6))
        })).toEqual([expect.stringMatching(/^Text "acme" is \d px from a filled shape below it\. Leave 12 px or more\.$/)])
        // The base line of a text that is turned is not known, so a level line near it is a mark.
        expect(await messages((s) => {
            const box = s.add(text('acme', { size: 40 }).rotate(0.06)).bounds()
            s.add(line([box.x + 4, base + 9], [box.x + box.width - 4, base + 9], { stroke: 'blue', width: 3 }))
        })).toEqual([expect.stringMatching(/^Text "acme" is \d px from a line below it\. Leave 12 px or more\.$/)])
        // An underline excuses only itself: a rule 3 px under it is too near to the word.
        expect(await messages((s) => {
            const box = s.add(text('acme', { size: 40 })).bounds()
            s.add(line([box.x, base + 5], [box.x + box.width, base + 5], { stroke: 'blue', width: 3 }))
            s.add(line([box.x - 60, base + 10.5], [box.x + box.width + 60, base + 10.5], { stroke: 'ink', width: 2 }))
        })).toEqual([expect.stringMatching(/^Text "acme" is \d px from a line below it\. Leave 12 px or more\.$/)])
        // The underline of one text is a mark for the text under it.
        expect(await messages((s) => {
            const box = s.add(text('acme', { size: 40 })).bounds()
            s.add(line([box.x, base + 5], [box.x + box.width, base + 5], { stroke: 'blue', width: 3 }))
            s.add(text('acme', { size: 40, color: 'dim' }).named('lower').alignTo([0, base + 6.5 + 3], 'top'))
        })).toEqual([expect.stringMatching(/^Text "acme" is \d px from a line above it\. Leave 12 px or more\.$/)])
        // Math, a line of code, and a line of a terminal record their base line too.
        const marked = (make: () => Node, pick: (made: any) => Node) => messages((s) => {
            const box = pick(s.add(make())).bounds()
            s.add(line([box.x, box.y + box.height + 5], [box.x + box.width, box.y + box.height + 5], { stroke: 'blue', width: 3 }))
        })
        expect(await marked(() => tex('acme', { size: 40 }), (made) => made)).toEqual([])
        expect(await marked(() => codeBlock('return a', { size: 40, panel: false }), (made) => made.lines[0])).toEqual([])
        expect(await marked(() => terminal(['total'], { size: 40 }), (made) => made.lines[0])).toEqual([])
        // Letters that a film makes itself record no base line, so a line under them is a mark.
        expect(await messages((s) => {
            const word = s.add(new Node())
            for (const x of [0, 24]) {
                const letter = rect(20, 28, { fill: 'ink', stroke: null }).at(x, 0)
                letter.data['key'] = 'x'
                word.add(letter)
            }
            s.add(line([-10, 19], [34, 19], { stroke: 'blue', width: 3 }))
        })).toEqual([expect.stringMatching(/^Text "" is \d px from a line below it\. Leave 12 px or more\.$/)])
    })

    it('judges a label that an object places against the marks of every other object', async () => {
        const on = { textGap: 0.3 }
        const found = async (build: Build) => (await checkFilm(film((s) => { build(s); s.wait(1) }), on)).diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message)
        // A legend that a film puts 3 px over the x axis of a chart is reported, as text of the film is.
        const onAxis = (own: boolean) => found((s) => {
            const plot = s.add(axes({ x: [0, 4], y: [0, 4], width: 500, height: 300, labels: false }))
            const [x, y] = plot.world(2, 0)
            const made = own ? legend([{ label: 'better', color: 'green' }], { size: 26 }) : text('better', { size: 26 })
            const box = made.bounds()
            s.add(made.shift(x - (box.x + box.width / 2), y - 1 - 3 - (box.y + box.height)))
        })
        const expected = [expect.stringMatching(/^Text "better" (touches|is \d px from) a line of a pair of axes below it\. Leave 8 px or more\.$/)]
        expect(await onAxis(false)).toEqual(expected)
        expect(await onAxis(true)).toEqual(expected)
        // A labeled dot on a tick of an axis: the film chose the place, so the label is judged against the axis.
        expect(await found((s) => { const made = s.add(axes({ x: [-1, 4], y: [0, 9] })); s.add(labeledDot('A').at(...made.world(2, 0))) })).toEqual([expect.stringMatching(/^Text "A" is 7 px from a line of .* below it\. Leave 9 px or more\.$/)])
        // The note of a callout on the line of an axis.
        expect(await found((s) => { const made = s.add(axes({ x: [-1, 4], y: [0, 9] })); s.add(callout(made.world(2, 0), 'a root')) })).toEqual([expect.stringMatching(/^Text "a root" touches a line of a pair of axes/)])
        // A chart in a zone with a padding of 3 px. The border of a zone with a title is an open line, and it is still a border.
        const inZone = (title: boolean) => found((s) => {
            const chart = barChart([{ label: 'search', value: 12 }, { label: 'wiki', value: 30 }, { label: 'both together', value: 48 }], { width: 420, height: 260 })
            s.add(zone([chart], { ...(title ? { title: 'results' } : {}), padding: 3, radius: 0 }))
        })
        expect((await inZone(false)).filter((message) => message.includes('"both together"'))).toEqual(['Text "both together" is 1 px from the border of a box of a zone below it. Leave 3 px or more.'])
        expect((await inZone(true)).filter((message) => message.includes('"both together"'))).toEqual(['Text "both together" is 1 px from the border of a zone below it. Leave 3 px or more.'])
    })

    it('does not report the layout of an object, with its defaults and with tight options', async () => {
        const scores = [{ label: 'blocks', value: 0.89, low: 0.87, high: 0.91 }, { label: 'a longer label', value: 0.4, low: 0.3, high: 0.5 }, { label: 'c', value: 0.6 }]
        const groups = [{ count: 20, label: 'no effect' }, { count: 2, color: 'green', label: 'a label much wider than two marks' }, { count: 3, color: 'red', label: 'worse' }]
        const bars = [{ label: 'alpha', value: 2 }, { label: 'beta', value: 3 }]
        const series = [{ name: 'p95', values: [1, 2, 3, 2, 4] }, { name: 'p50', values: [1, 1.2, 1.1, 1.3, 1.2] }]
        // The least width of a pair of quotes, found by the first film that builds one.
        let tightest = 240
        const cases: Record<string, Build> = {
            'axes': (s) => { s.add(axes({ x: [-10, 10], y: [-10, 10], width: 500, height: 300, xStep: 1, yStep: 1, labelSize: 26, xLabel: 'x', yLabel: 'y' })) },
            'numberLine with a marker': (s) => { s.add(numberLine({ range: [0, 20], length: 500, labelSize: 30 })).marker(3, { label: 'a' }) },
            'numberLine with a marker that moves': (s) => { const at = s.value(3); s.add(numberLine({ range: [0, 10], length: 900 })).marker(() => at.value, { label: 'x_0', labelSize: 40, radius: 14 }) },
            'complexPlane': (s) => { s.add(complexPlane({ unit: 100, x: [-2, 2], y: [-2, 2], labelRange: 1 })) },
            'angleMark': (s) => { s.add(angleMark([0, 0], [200, 0], [150, -150], { label: '\\theta' })) },
            'braceLabel': (s) => { s.add(braceLabel(s.add(rect(300, 80, { stroke: 'blue' })), 'width', { plain: true, side: 'top' })) },
            'labeledDot': (s) => { s.add(labeledDot('Point', { gap: 1, size: 44, plain: true, side: 'right' })) },
            'barChart': (s) => { s.add(barChart(bars, { labelSize: 44, width: 500, height: 200, horizontal: true })) },
            'histogram': (s) => { s.add(histogram(Array.from({ length: 200 }, (_, i) => (i * 7919 % 100) / 10), { bins: 10, range: [0, 10], labelSize: 44 })) },
            'scatter': (s) => { s.add(scatter([{ x: 0, y: 0, group: 'g' }, { x: 1, y: 1, group: 'g' }, { x: 2, y: 0.5, group: 'h' }], { labelSize: 44, xLabel: 'x', yLabel: 'y' })) },
            'lineChart': (s) => { s.add(lineChart(series, { labelSize: 44, xLabel: 'x', yLabel: 'y' })) },
            'pie': (s) => { s.add(pie([{ label: 'a', value: 3 }, { label: 'b', value: 1 }, { label: 'c', value: 0.2 }], { labelSize: 44, radius: 80 })) },
            'donut': (s) => { s.add(donut([{ label: 'alpha', value: 3 }, { label: 'beta', value: 1 }], { radius: 60, centerLabel: 'total', centerSize: 40 })) },
            'heatmap': (s) => { s.add(heatmap([[0.25, 1.5], [2.75, 3.125]], { cell: 30, gap: 0, values: true, rowLabels: ['a', 'b'], columnLabels: ['c', 'd'], labelSize: 44 })) },
            'infoBox': (s) => { s.add(infoBox({ title: 'Service', subtitle: 'us1.prod', badge: 'p99', rows: [{ label: 'k', value: 'v', meter: 0.5, spark: [1, 2, 3] }], tags: ['one', 'two'], accent: 'blue' })) },
            'infoBox, large': (s) => { s.add(infoBox({ title: 'Service', subtitle: 'us1.prod', badge: 'p99', rows: [{ label: 'k', value: 'v', meter: 0.5, spark: [1, 2, 3] }], tags: ['one', 'two'], accent: 'blue', size: 40 })) },
            'infoBox with a new value': (s) => { const box = s.add(infoBox({ title: 'Service', rows: [{ label: 'k', value: '1', meter: 0.5 }] })); s.play(box.setValue(0, '250'), { duration: 0.2 }) },
            'connector': (s) => { s.add(connector(s.add(rect(100, 60, { stroke: 'blue' }).at(-300, 0)), s.add(rect(100, 60, { stroke: 'blue' }).at(300, 0)), { label: 'publish', labelSize: 26 })) },
            'legend': (s) => { s.add(legend([{ label: 'read', color: 'blue', kind: 'line' }, { label: 'write', color: 'red', kind: 'line' }], { size: 30, gap: 2 })) },
            'callout': (s) => { s.add(callout([0, 0], 'A note', { title: 'Note', size: 60, distance: 20 })) },
            'graph': (s) => { s.add(graph([{ id: 'a', label: 'alpha' }, { id: 'b', label: 'beta' }], [{ from: 'a', to: 'b', label: '3' }])) },
            'tree': (s) => { s.add(tree({ id: 'r', label: 'root', children: [{ id: 'a', label: 'a' }, { id: 'b', label: 'bbb' }] })) },
            'arrayCells': (s) => { s.add(arrayCells([31, 1415], { cell: 60, size: 30 })) },
            'codeBlock': (s) => { s.add(codeBlock('const mid = (lo + hi) >> 1\nreturn mid', { padding: 2, size: 40, lineNumbers: true })) },
            'neuralNet': (s) => { s.add(neuralNet([2, 3, 2], { layerLabels: ['in', 'hidden', 'out'], height: 60 })) },
            'tokens': (s) => { s.add(tokens(['The', { text: 'cat', sub: '12' }, 'sat'], { maxWidth: 400 })) },
            'a 3D scene': (s) => { const view = s.add(scene3d({})); view.add(axes3d({ numbers: true }), point3d([1, 1, 1]), label3d('P', [1, 1, 1], { offset: [14, -14] })) },
            // The objects that came after the rule: with their defaults, then tight.
            'zone': (s) => { s.add(zone([rect(200, 80, { stroke: 'blue' })], { title: 'jail', color: 'yellow', dash: true })) },
            'zone, tight': (s) => { s.add(zone([rect(200, 80, { stroke: 'blue' })], { title: 'jail', titleSize: 44, padding: 2, radius: 0, titleAlign: 'center' })) },
            'tag': (s) => { s.add(tag('MEASURED', { note: 'the study of June 2026', color: 'green' })) },
            'tag, tight': (s) => { s.add(tag('Agjy', { note: 'note', size: 60, fill: null, font: 'serif' })) },
            'tagTrack': (s) => { s.add(tagTrack([{ at: 0, word: 'PLAN', note: 'by us' }], { until: 3 }).at(-600, 0)) },
            'dotChart': (s) => { s.add(dotChart(scores, { domain: [0, 1], xLabel: 'score, higher is better' })) },
            'dotChart, tight': (s) => { s.add(dotChart(scores, { domain: [0, 1], width: 300, height: 60, labelSize: 26, xLabel: 'score' })) },
            'unitChart': (s) => { s.add(unitChart(groups, { rows: 5, split: true })) },
            'unitChart, tight': (s) => { s.add(unitChart(groups, { rows: 5, split: true, cell: 10, gap: 2, labelSize: 30 })) },
            'card': (s) => { s.add(card({ title: 'Logs', figure: pictogram('logs'), caption: 'one line per event', width: 420, height: 360, captionLines: 2 })) },
            'card, tight': (s) => { s.add(card({ title: 'Logs', figure: pictogram('logs', { size: 200 }), caption: 'one line per event', width: 300, padding: 3, titleSize: 44, borderWidth: 6 })) },
            'pictogram': (s) => { s.add(pictogram('graph', { size: 96, accent: 'teal' })) },
            'lanes': (s) => { const flow = s.add(lanes(['guest', 'KVM', 'host'], [{ lane: 'guest', start: 0, end: 30, label: 'runs' }, { from: 'guest', to: 'KVM', at: 30, label: 'VM exit' }, { lane: 'KVM', start: 30, end: 42, label: 'handles' }, { from: 'KVM', to: 'host', at: 42, label: 'ioctl returns' }, { lane: 'host', start: 42, end: 80, label: 'emulates the device' }], { axisLabel: 'time, in microseconds', ticks: 5 })); s.play(flow.showAll(), { duration: 0.2 }) },
            'lanes, tight': (s) => { const flow = s.add(lanes(['user', 'kernel'], [{ lane: 'user', start: 0, end: 50, label: 'runs' }, { from: 'user', to: 'kernel', at: 50, label: 'page fault' }, { lane: 'kernel', start: 50, end: 100, label: 'maps a page' }], { barHeight: 34, size: 22 })); s.play(flow.showAll(), { duration: 0.2 }) },
            'stateGrid with its legend': (s) => { const grid = s.add(stateGrid({ columns: 16, rows: 8, cell: 56, initial: 'present' })); s.add(grid.legend(['absent', 'present']).nextTo(grid, 'down')) },
            'stateGrid, tight': (s) => { const grid = s.add(stateGrid({ columns: 32, rows: 8, cell: 28, initial: 'absent' }).at(0, -40)); s.add(grid.legend(['absent', 'zero', 'present', 'dirty'], { size: 22, gap: 4 }).at(grid.left[0], 140)) },
            'bitField': (s) => { s.add(bitField([{ bits: 8, label: 'type' }, { bits: 8, label: 'code' }, { bits: 16, label: 'checksum', color: 'purple' }], { width: 1200, numbers: 'offsets' })) },
            'bitField, tight, with a value that changes': (s) => { const made = s.add(bitField([{ bits: 1, label: 'P', value: '0' }, { bits: 1, label: 'RW', value: '1' }, { bits: 30, label: 'frame', value: '0x1a2b', color: 'blue' }], { width: 1100, minWidth: 60, height: 46, size: 30 })); s.play(made.setValue('P', 'yes'), { duration: 0.2 }) },
            // The new value of an unused field is in a hole of the hatch of that field.
            'bitField with a new value in an unused field': (s) => { const made = s.add(bitField([{ bits: 4, label: 'kind', value: '7' }, { bits: 12, unused: true, value: 'old' }, { bits: 16, label: 'length', value: '512' }], { width: 1000 })); s.play(made.setValue(1, 'reserved'), { duration: 0.2 }) },
            'terminal': (s) => { s.add(terminal([{ text: './one-byte', kind: 'command' }, 'minor faults:              1'], { title: 'runs/01-one-byte.txt', note: 'Linux 7.0' })) },
            'steps with notes': (s) => { s.add(steps([{ label: 'trap', note: 'price: none' }, 'handle', { label: 'return', note: 'two\nlines gjpqy' }], { current: 0 })) },
            'steps, tight: a label and a note that shrank': (s) => { s.add(steps([{ label: 'a very long label here', note: 'a note longer than its box' }, 'b'], { width: 560, size: 30, height: 52 })) },
            'steps, a numbered column': (s) => { const strip = s.add(steps([{ label: 'fault', note: 'first line\nfinal' }, { label: 'map', note: 'one' }, 'retry'], { direction: 'column', numbered: true, width: 300, gap: 20, height: 60, size: 30, current: 1 })); s.play(strip.go(2), { duration: 0.2 }) },
            'boundary with its names and its tally': (s) => { s.add(boundary({ label: 'system call line', above: 'user space', below: 'kernel', width: 1400, size: 40, weight: 8, tally: ['system call', 'system calls'] })) },
            'boundary with ticks, a tally that counts, and a tally over the line': (s) => {
                const wall = s.add(boundary({ label: 'system call line', above: 'user space', below: 'kernel', width: 1000, tally: 'system calls' }).at(0, -200))
                const over = s.add(boundary({ label: 'VM wall', below: 'host', width: 1000, dash: true, tally: 'exits', tallySide: 'over' }).at(0, 200))
                s.play(wall.cross(wall.x(0)), wall.cross(wall.x(0.5), { direction: 'up' }), over.addCrossings(99999), { duration: 0.2 })
            },
            'boundary, full of ticks, with the note of what a tick is': (s) => { const wall = s.add(boundary({ label: 'system call line', above: 'user space', below: 'kernel', width: 1000, tally: 'system calls' })); s.play(wall.addCrossings(999999), { duration: 0.2 }) },
            'boundary, small, with the note under its line': (s) => { const wall = s.add(boundary({ label: 'VM wall', below: 'host', width: 900, size: 20, tally: 'exits' })); s.play(wall.addCrossings(99999), { duration: 0.2 }) },
            'quote with its rule and its source': (s) => { s.add(quote('the agent loop lives in a workflow, and the harness runs inside the sandbox', { by: 'Cursor', when: '2026-06-02', where: 'a post', width: 900, size: 30 })) },
            'quotePair with a word between': (s) => { s.add(quotePair({ words: 'yes, always' }, { words: 'no, never' }, { width: 900, size: 30, gap: 120, versus: 'or' }).at(-450, -50)) },
            // The least width that the pair takes: its word has the least room between the first quote and the rule of the second.
            'quotePair, tight': (s) => {
                const pair = (width: number) => quotePair({ words: 'yes' }, { words: 'no' }, { width, size: 30, gap: 60, versus: 'or' })
                while (true) {
                    try {
                        s.add(pair(tightest).at(-200, 0))
                        return
                    } catch {
                        // Too narrow for the word between the two quotes.
                        tightest += 2
                    }
                }
            },
            'ringBuffer with numbers, names, counts and a caption': (s) => { s.add(ringBuffer(16, { radius: 220, thickness: 60, counts: true, label: 'submission queue' })) },
            'ringBuffer with labels of entries that fill their slots': (s) => { const ring = s.add(ringBuffer(8, { radius: 200, thickness: 60, label: 'ring' })); s.play(seq(ring.push({ label: 'read' }), ring.push({ label: 'write 7', pending: true })), { duration: 0.4 }) },
            'dateLine with years, labels, a note, and its cursor': (s) => { const made = s.add(dateLine([{ at: 2020, label: 'the first paper' }, { at: '2025-06-10', label: 'the newsletter', color: 'orange' }, { at: '2026-03-24', label: 'the technical report', color: 'orange', note: 'names the system' }], { width: 1700, from: 2020, to: 2027, size: 40, font: 'text-serif' })); s.play(made.showAll(), { duration: 0.3 }) },
            'dateLine, not to scale, with marks in rows': (s) => { const made = s.add(dateLine([{ at: '5.1', label: 'eight operations' }, { at: '5.6', label: 'open, close, statx' }, { at: '5.19', label: 'passthrough commands', side: 'under' }, { at: '6.0', label: 'a block device in user space', color: 'orange', mark: 'star' }], { width: 1500, scale: 'order' })); s.play(made.showAll(), { duration: 0.3 }) },
            'dateLine, months, two near events': (s) => { const made = s.add(dateLine([{ at: '2025-06-03', label: 'post one gjpqy' }, { at: '2025-06-10', label: 'post two gjpqy', note: 'a week later' }, { at: '2025-11-20', label: 'report', side: 'under' }], { width: 1500, from: '2025-05-01', to: '2025-12-31' })); s.play(made.showAll(), { duration: 0.3 }) },
            'eventLog with a title, a footer, a fold, and a focus outline': (s) => {
                const log = s.add(eventLog([{ id: 1, name: 'openat gjpqy', detail: 'a file (gjpqy)' }, { ids: [2, 3, 4], name: 'workflow task', detail: 'worker 71293' }, { id: 5, name: 'close' }], { title: 'event history', footer: (count) => `${count} events`, visible: 4, width: 1000, size: 30 }))
                s.play(log.focus(1), { duration: 0.3 })
            },
            'eventLog with a focus band, times, and rows that arrive': (s) => {
                const log = s.add(eventLog([{ id: 1, name: 'submit', detail: 'a request', time: '0 ms' }, { id: 2, name: 'gjpqy wait', detail: 'in the queue', time: '12 ms' }], { visible: 3, width: 1200, size: 40, focusLook: 'band' }))
                s.play(log.append([{ id: 3, name: 'complete', time: '13 ms' }, { id: 4, name: 'closed' }]), { duration: 0.4 })
                s.play(log.focus(4), { duration: 0.2 })
            },
            'terminal, tight, with a part that find() selects': (s) => { const run = s.add(terminal([{ text: 'perf stat ./one-byte', kind: 'command' }, '          1      page-faults', { text: '...', kind: 'note' }], { title: 'runs/02.txt', note: 'Linux 7.0', size: 40 })); run.find('page-faults').set('opacity', 0.9) },
            'segmentedBar with a title, a readout, the free room, and labels that push each other': (s) => { s.add(segmentedBar([{ name: 'system', value: 1200 }, { name: 'trace export', value: 8200 }, { name: 'note gjpqy', value: 186 }, { name: 'question', value: 450 }], { capacity: 16000, title: 'context window', free: 'free', width: 1700 })) },
            'segmentedBar, tight, over its capacity': (s) => { s.add(segmentedBar([{ name: 'weights', value: 7.6 }, { name: 'gjpqy', value: 0.4 }, { name: 'KV cache', value: 22.5 }], { capacity: 24, max: 34, width: 900, height: 30, size: 26, title: 'GPU', format: (value) => `${value.toFixed(1)} GB` })) },
        }
        // With 0.3 and 0.7, and with the most room that the rule asks for: 2% of the shorter side of the frame, for a text of any size.
        for (const textGap of [0.3, 0.7, 3]) {
            for (const [name, build] of Object.entries(cases)) {
                const report = await checkFilm(film({ fps: 12 }, (s) => { build(s); s.wait(0.5) }), { textGap })
                expect(report.diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message), `${name} at ${textGap}`).toEqual([])
            }
        }
        // Each object gives itself a name for the messages, in words. The check does not read the name of a class.
        for (const [name, build] of Object.entries(cases)) {
            const compiled = await film({ fps: 12 }, (s) => { build(s); s.wait(0.5) }).compile({})
            const names = compiled.stage.root.all().map((node) => node.data['object']).filter((value) => value !== undefined)
            expect(names.length, name).toBeGreaterThan(0)
            // Words of three letters or more in all: a name of one or two letters is what a minifier leaves of a class.
            for (const value of names) expect(value, name).toMatch(/^(?=.{3,}$)[A-Za-z0-9]+( [A-Za-z0-9]+)*$/)
        }
    }, 30_000)

    it('judges a label in a box of a size that the film sets, and says what to change', async () => {
        const flow = (barHeight: number | undefined, textGap = 0.3) => checkFilm(film({ fps: 12 }, (s) => {
            const made = s.add(lanes(['user', 'kernel'], [{ lane: 'user', start: 0, end: 50, label: 'runs' }, { from: 'user', to: 'kernel', at: 50, label: 'page fault' }, { lane: 'kernel', start: 50, end: 100, label: 'maps a page' }], barHeight ? { barHeight, size: 22 } : {}))
            s.play(made.showAll(), { duration: 0.2 })
            s.wait(0.5)
        }), { textGap })
        // In a bar of 30 px, the tails of the letters of size 22 are 1 px from the border of the bar.
        const tight = ['Text "maps a page" is 1 px from the border of a box of a set of lanes below it. Leave 4 px or more. Give the lanes a taller bar (`barHeight`) or a smaller text (`size`).']
        expect((await flow(30)).diagnostics.map((entry) => entry.message)).toEqual(tight)
        expect((await flow(36)).diagnostics).toEqual([])
        // The room in a bar is half of 0.3 of the font size at the most. So a film that asks for more room between its own
        // texts and marks gets the same verdict, and the default bar passes.
        expect((await flow(30, 0.7)).diagnostics.map((entry) => entry.message)).toEqual(tight)
        for (const textGap of [0.3, 0.7, 1]) expect((await flow(undefined, textGap)).diagnostics, `at ${textGap}`).toEqual([])
    })

    it('does not report the text of a crossing beside its mark, while the mark moves', async () => {
        // The text of a crossing shows only while its mark is on its way, so the times are moments of the crossing.
        const during = async (build: Build, textGap: number) => (await checkFilm(film({ fps: 20 }, (s) => { build(s); s.wait(0.2) }), { textGap, times: [0.1, 0.2, 0.3, 0.6, 1, 1.4, 1.7, 1.8, 1.9] })).diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message)
        const names = { label: 'system call line', above: 'user space', below: 'kernel' }
        for (const textGap of [0.3, 0.7]) {
            expect(await during((s) => { const wall = s.add(boundary({ ...names, width: 1000, tally: 'system calls' })); s.play(wall.cross(wall.x(0.4), { label: 'read()' }), { duration: 2 }) }, textGap), `one line at ${textGap}`).toEqual([])
            expect(await during((s) => { const wall = s.add(boundary({ ...names, width: 1400, size: 40, tally: 'system calls' })); s.play(wall.cross(wall.x(0.3), { label: 'write()', direction: 'round' }), { duration: 2 }) }, textGap), `a round trip at ${textGap}`).toEqual([])
            // One mark through two lines is on the stage, and not a part of one line. The top line places its text.
            expect(await during((s) => {
                const calls = s.add(boundary({ label: 'system call line', width: 1000, tally: 'calls' }).at(0, -150)), wall = s.add(boundary({ label: 'VM wall', width: 1000, tally: 'exits' }).at(0, 150))
                s.play(crossThrough([calls, wall], calls.x(0.5), { label: 'an exit', direction: 'round' }), { duration: 2 })
            }, textGap), `two lines at ${textGap}`).toEqual([])
        }
    })

    it('judges text of the film beside an object, in a zone, and in the figure of a card', async () => {
        const on = { textGap: 0.3 }
        const found = async (build: Build) => (await checkFilm(film((s) => { build(s); s.wait(0.5) }), on)).diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.text)
        // A note of the film, 3 px under the lowest mark of the object.
        const beside = (build: () => Node) => found((s) => {
            const box = s.add(build()).bounds()
            s.add(text('note', { size: 30 }).alignTo([box.x + box.width / 2, box.y + box.height + 3], 'top'))
        })
        expect(await beside(() => zone([rect(200, 80, { stroke: 'blue' })], { title: 'jail' }))).toEqual(['note'])
        expect(await beside(() => tag('MEASURED', { color: 'green' }))).toEqual(['note'])
        expect(await beside(() => dotChart([{ label: 'a', value: 0.5 }], { domain: [0, 1], grid: false, ticks: [] }))).toEqual(['note'])
        expect(await beside(() => unitChart([{ count: 20 }], { rows: 5 }))).toEqual(['note'])
        expect(await beside(() => card({ title: 'Logs', figure: pictogram('logs'), width: 300 }))).toEqual(['note'])
        expect(await beside(() => pictogram('database', { size: 96 }))).toEqual(['note'])
        expect(await found((s) => {
            s.add(tagTrack([{ at: 0, word: 'PLAN' }], { until: 3 }).at(-600, 0))
            s.add(text('note', { size: 30 }).at(-560, 0).alignTo([0, 27], 'top'))
        })).toEqual(['note'])
        // Text in a zone is judged against the border of the zone. The title of the zone is not.
        const held = (padding: number) => found((s) => { s.add(zone([text('guest', { size: 40 })], { title: 'jail', padding })) })
        expect(await held(4)).toEqual(['guest'])
        expect(await held(32)).toEqual([])
        // The figure of a card is of the film: its text is judged against the border of the card and against its own marks.
        expect(await found((s) => { s.add(card({ title: 'Logs', figure: text('a figure as wide as the card', { size: 40 }), width: 300, padding: 2 })) })).toEqual(['a figure as wide as the card'])
    })

    it('takes the room from the size that the text was made with, when it turns, for math, and for code', async () => {
        const on = { textGap: 0.3 }
        const messages = async (build: Build) => (await checkFilm(film((s) => { build(s); s.wait(1) }), on)).diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message)
        // Text of size 40 with a line 8 px away. The room is 12 px for every word, upright or turned.
        for (const word of ['Illicit', 'mmmm', '-x']) {
            for (const turn of [0, Math.PI / 2, 0.5]) {
                const found = await messages((s) => {
                    const made = text(word, { size: 40 }), box = made.bounds()
                    const both = s.add(group(made, line([box.x - 20, box.y + box.height + 9], [box.x + box.width + 20, box.y + box.height + 9], { stroke: 'ink', width: 2 })))
                    both.rotate(turn, [0, 0])
                })
                expect(found, `${word} turned by ${turn}`).toHaveLength(1)
                expect(found[0], `${word} turned by ${turn}`).toMatch(/Leave 12 px or more\.$/)
            }
        }
        // A text that is scaled needs room for the size that shows.
        expect(await messages((s) => {
            const made = s.add(text('caption', { size: 20 }).scale(2)), box = made.bounds()
            s.add(line([box.x - 30, box.y + box.height + 9], [box.x + box.width + 30, box.y + box.height + 9], { stroke: 'ink', width: 2 }))
        })).toEqual(['Text "caption" is 8 px from a line below it. Leave 12 px or more.'])
        // Math records its size too, so the letters of a formula do not set its room.
        for (const source of ['acme', 'Apply', '\\int_0^1 x\\,dx']) {
            expect(await messages((s) => {
                const made = s.add(tex(source, { size: 40 })), box = made.bounds()
                s.add(line([box.x - 30, box.y + box.height + 9], [box.x + box.width + 30, box.y + box.height + 9], { stroke: 'ink', width: 2 }))
            }), source).toEqual([`Text ${JSON.stringify(source)} is 8 px from a line below it. Leave 12 px or more.`])
        }
        // A line of code has the size of the block, and a finding names it by its words.
        expect(await messages((s) => {
            const made = s.add(codeBlock('const a = 1\n    return mid', { size: 40, panel: false })), box = made.lines[1]!.bounds()
            s.add(line([box.x - 30, box.y + box.height + 9], [box.x + box.width + 30, box.y + box.height + 9], { stroke: 'ink', width: 2 }))
        })).toEqual(['Text "return mid" is 8 px from a line below it. Leave 12 px or more.'])
        // So does a line of a terminal: the letters of its glyphs do not set its room.
        expect(await messages((s) => {
            const made = s.add(terminal(['page-faults', 'total'], { size: 40 })), box = made.lines[1]!.bounds()
            s.add(line([box.x - 30, box.y + box.height + 9], [box.x + box.width + 30, box.y + box.height + 9], { stroke: 'ink', width: 2 }))
        })).toEqual(['Text "total" is 8 px from a line below it. Leave 12 px or more.'])
    })

    it('does not report a box or a highlight that the library draws around a text', async () => {
        const on = { textGap: 0.3 }
        const found = async (build: Build) => (await checkFilm(film({ fps: 12 }, (s) => { build(s); s.wait(1) }), on)).diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.text)
        expect(await found((s) => { s.add(surroundingBox(s.add(text('boxed words', { size: 70 })))) })).toEqual([])
        expect(await found((s) => { s.play(highlightSweep(s.add(text('marked words', { size: 70 }))), { duration: 0.5 }) })).toEqual([])
        // The same with less room, and around a part of a text.
        expect(await found((s) => { s.add(surroundingBox(s.add(text('boxed words', { size: 40 })), { pad: 2 })) })).toEqual([])
        expect(await found((s) => { s.add(surroundingBox(s.add(tex('a^2 + b^2 = c^2')).part('b^2'))) })).toEqual([])
        expect(await found((s) => { s.play(highlightSweep(s.add(text('marked words here', { size: 40 })).find('words')), { duration: 0.5 }) })).toEqual([])
        // A box that the film draws itself, with the same 2 px, is judged.
        expect(await found((s) => {
            const box = s.add(text('boxed words', { size: 40 })).bounds()
            s.add(rect(box.width + 4, box.height + 4, { radius: 8, stroke: 'yellow', width: 2.5 }).at(box.x + box.width / 2, box.y + box.height / 2))
        })).toEqual(['boxed words'])
        // The box is a decoration of its text, so no other text is judged against it: a box on one token of a row
        // comes near the two tokens beside it.
        expect(await found((s) => { s.add(surroundingBox(s.add(tokens(['The', 'cat', 'sat'])).token(1))) })).toEqual([])
        expect(await found((s) => {
            const frame = s.add(surroundingBox(s.add(text('boxed words', { size: 40 })))).bounds()
            s.add(text('a neighbor', { size: 40 }).alignTo([0, frame.y + frame.height + 3], 'top'))
        })).toEqual([])
        // A box of the library is not a border between its text and a mark outside it: a line 3 px under the box is near the text.
        expect(await found((s) => {
            const frame = s.add(surroundingBox(s.add(text('boxed words', { size: 40 })), { pad: 6 })).bounds()
            s.add(line([frame.x - 30, frame.y + frame.height + 3], [frame.x + frame.width + 30, frame.y + frame.height + 3], { stroke: 'ink', width: 2 }))
        })).toEqual(['boxed words'])
        // The line of circumscribe and the cursor of a typewriter are decorations too. The times are in the middle of each.
        const during = async (build: Build) => (await checkFilm(film({ fps: 12 }, build), { ...on, times: [0.5] })).diagnostics.filter((entry) => entry.code === 'film.text_crowded')
        expect(await during((s) => { s.play(circumscribe(s.add(text('look here', { size: 64 }))), { duration: 1 }) })).toEqual([])
        expect(await during((s) => { s.play(typewriter(s.add(text('typed words', { size: 48 })), { cursor: true }), { duration: 1 }) })).toEqual([])
    })

    it('reports two dynamic texts with the same words as two findings, and one that moves as one', async () => {
        const on = { textGap: 0.3 }
        const bar = (x: number, y = 0) => rect(200, 60, { fill: 'blue', stroke: null }).at(x, y)
        const caption = (x: number, y = 0) => text('caption', { size: 40 }).alignTo([x, y + 33], 'top').shift(x, 0)
        // Two drawings, and one drawing with two texts.
        const two = await checkFilm(film((s) => {
            for (const x of [-400, 400]) s.add(dynamic(() => [bar(x), caption(x)]))
            s.wait(1)
        }), on)
        expect(two.diagnostics.map((entry) => Math.sign(entry.stage.x))).toEqual([-1, 1])
        const one = await checkFilm(film((s) => {
            s.add(dynamic(() => [-400, 400].flatMap((x) => [bar(x), caption(x)])))
            s.wait(1)
        }), on)
        expect(one.diagnostics).toHaveLength(2)
        // Two counters that show one value, each 2 px over a line.
        const counters = await checkFilm(film((s) => {
            for (const x of [-400, 400]) {
                const box = s.add(counter(7, { size: 40 }).at(x, 0)).bounds()
                s.add(line([box.x - 20, box.y + box.height + 3], [box.x + box.width + 20, box.y + box.height + 3], { stroke: 'ink', width: 2 }))
            }
            s.wait(1)
        }), on)
        expect(counters.diagnostics).toMatchObject([{ code: 'film.text_crowded', text: '7' }, { code: 'film.text_crowded', text: '7' }])
        // One text that follows a value is one finding for the two places where it rests.
        const moving = await checkFilm(film({ fps: 12 }, (s) => {
            const at = s.value(-400)
            s.add(dynamic(() => [bar(at.value), caption(at.value)]))
            s.wait(1.5)
            s.play(at.to(400, { duration: 0.5 }))
            s.wait(1.5)
        }), on)
        expect(moving.diagnostics).toHaveLength(1)
        expect(moving.diagnostics[0]!.time).toBeLessThan(0.5)
        expect(moving.diagnostics[0]!.until).toBeGreaterThan(2)
        // The second of two drawings keeps its name when the first one leaves.
        const leaving = await checkFilm(film({ fps: 12 }, (s) => {
            const first = s.add(dynamic(() => [bar(-400), caption(-400)]))
            s.add(dynamic(() => [bar(400), caption(400)]))
            s.wait(1.5)
            s.remove(first)
            s.wait(1.5)
        }), on)
        expect(leaving.diagnostics.map((entry) => [Math.sign(entry.stage.x), entry.until > 0.6])).toEqual([[-1, false], [1, true]])
    })

    it('takes an image as a mark', async () => {
        const on = { textGap: 0.3 }
        const png = `data:image/png;base64,${Buffer.from(encode({ width: 2, height: 1, depth: 8, channels: 4, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]) })).toString('base64')}`
        const caption = (y: number) => checkFilm(film((s) => {
            s.add(image(png, { width: 300, height: 100 }))
            s.add(text('caption', { size: 40 }).alignTo([0, y], 'top'))
            s.wait(1)
        }), on)
        // The image is 100 px high, so its lower edge is at 50.
        expect((await caption(53)).diagnostics).toMatchObject([{ code: 'film.text_crowded', message: 'Text "caption" is 3 px from an image above it. Leave 12 px or more.' }])
        expect((await caption(49)).diagnostics).toMatchObject([{ code: 'film.text_crowded', message: 'Text "caption" touches an image above it. Leave 12 px or more.' }])
        expect((await caption(30)).diagnostics).toMatchObject([{ code: 'film.text_crowded', message: 'Text "caption" runs past the edge of the image behind it.' }])
        expect((await caption(70)).diagnostics).toEqual([])
        expect((await caption(-15)).diagnostics).toEqual([])
        // The edge of an image is its rectangle, also where the picture is clear. This pins that limit.
        const clear = `data:image/png;base64,${Buffer.from(encode({ width: 2, height: 1, depth: 8, channels: 4, data: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]) })).toString('base64')}`
        const beside = await checkFilm(film((s) => {
            s.add(image(clear, { width: 300, height: 100 }))
            s.add(text('note', { size: 40 }).alignTo([153, 0], 'left'))
            s.wait(1)
        }), on)
        expect(beside.diagnostics).toMatchObject([{ code: 'film.text_crowded', message: 'Text "note" is 3 px from an image left of it. Leave 12 px or more.' }])
        // An image has no one color, so a mark on an image counts: a line in the color of the background, 3 px under a word.
        const onImage = await checkFilm(film((s) => {
            s.add(image(png, { width: 600, height: 300 }))
            const box = s.add(text('note', { size: 40 })).bounds()
            s.add(line([box.x - 30, box.y + box.height + 4], [box.x + box.width + 30, box.y + box.height + 4], { stroke: 'bg', width: 2 }))
            s.wait(1)
        }), on)
        expect(onImage.diagnostics).toMatchObject([{ code: 'film.text_crowded', message: 'Text "note" is 3 px from a line below it. Leave 12 px or more.' }])
    })

    it('asks for half the room inside a shape that holds the text', async () => {
        const on = { textGap: 0.3 }
        // A cell of an array that the film draws, with a number of two digits. The room is 9 px for size 30, and 4.5 px in the cell.
        const cell = (width: number) => checkFilm(film((s) => {
            const number = s.add(text('81', { size: 30 })), box = number.bounds()
            s.add(rect(box.width + width * 2 + 2, 64, { radius: 8, stroke: 'blue', width: 2 }).at(box.x + box.width / 2, box.y + box.height / 2))
            s.wait(1)
        }), on)
        expect((await cell(6)).diagnostics).toEqual([])
        expect((await cell(3)).diagnostics).toMatchObject([{ code: 'film.text_crowded', message: expect.stringMatching(/^Text "81" is 3 px from the border of a box (left|right) of it\. Leave 5 px or more\.$/) }])
        // The same 6 px beside a shape, and not in it, is too near.
        const beside = await checkFilm(film((s) => {
            const number = s.add(text('81', { size: 30 })), box = number.bounds()
            s.add(rect(40, 64, { radius: 8, stroke: 'blue', width: 2 }).at(box.x + box.width + 6 + 21, box.y + box.height / 2))
            s.wait(1)
        }), on)
        expect(beside.diagnostics).toMatchObject([{ code: 'film.text_crowded', message: 'Text "81" is 6 px from the border of a box right of it. Leave 9 px or more.' }])
        // A word in a filled pill, and a label in a circle.
        const pill = (pad: number) => checkFilm(film((s) => {
            const word = text('step 2', { size: 30 }), box = word.bounds()
            s.add(rect(box.width + 60, box.height + pad * 2, { radius: 20, fill: 'blue', stroke: null }).at(box.x + box.width / 2, box.y + box.height / 2))
            s.add(word)
            s.wait(1)
        }), on)
        expect((await pill(8)).diagnostics).toEqual([])
        expect((await pill(2)).diagnostics).toMatchObject([{ code: 'film.text_crowded' }])
        const ring = await checkFilm(film((s) => {
            const word = s.add(text('has the lock', { size: 40 })), box = word.bounds()
            s.add(circle(box.width / 2 + 2, { stroke: 'blue', width: 2 }))
            s.wait(1)
        }), on)
        expect(ring.diagnostics).toMatchObject([{ code: 'film.text_crowded', text: 'has the lock' }])
    })

    it('does not report what a connector, a callout, a brace, or a field of arrows draws by its own rule', async () => {
        const on = { textGap: 0.3 }
        const found = async (build: Build) => (await checkFilm(film({ fps: 12, bleed: true }, (s) => { build(s); s.wait(0.5) }), on)).diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message)
        // A connector ends 3 px from each node that it connects, a callout ends at its target, and a brace stands 12 px from its target.
        for (const size of [30, 64]) {
            expect(await found((s) => { s.add(connector(s.add(text('client', { size }).at(-300, 0)), s.add(text('server', { size }).at(300, 0)))) }), `connector, size ${size}`).toEqual([])
            expect(await found((s) => { s.add(callout(s.add(text('service', { size })), 'Why this matters')) }), `callout, size ${size}`).toEqual([])
            expect(await found((s) => { s.add(braceLabel(s.add(text('some words', { size })), 'n')) }), `brace, size ${size}`).toEqual([])
        }
        expect(await found((s) => { s.add(braceLabel(s.add(tex('a^2 + b^2 = c^2')).part('a^2 + b^2'), 'legs')) })).toEqual([])
        expect(await found((s) => { s.add(connector(s.add(text('client', { size: 40 }).at(-400, 0)), s.add(infoBox({ title: 'Service', rows: [{ label: 'rps', value: '1.2k' }] }).at(300, 0)))) })).toEqual([])
        // The note of a callout stands beside the target by the rule of the callout.
        expect(await found((s) => { s.add(callout(s.add(rect(200, 100, { fill: 'blue', stroke: null })), 'A note', { size: 40, distance: 2, side: 'bottom' })) })).toEqual([])
        // A line that the film ends 3 px from a word is judged. So is a word that a connector passes and does not connect.
        expect(await found((s) => {
            const box = s.add(text('client', { size: 40 }).at(-300, 0)).bounds()
            s.add(line([box.x + box.width + 4, 0], [300, 0], { stroke: 'dim', width: 2 }))
        })).toEqual(['Text "client" is 3 px from a line right of it. Leave 12 px or more.'])
        expect(await found((s) => {
            s.add(connector(s.add(rect(100, 60, { stroke: 'blue' }).at(-400, 0)), s.add(rect(100, 60, { stroke: 'blue' }).at(400, 0)), { route: 'straight', width: 2 }))
            s.add(text('note', { size: 40 }).alignTo([0, 4], 'top'))
        })).toEqual(['Text "note" is 3 px from a line of a connector above it. Leave 12 px or more.'])

        // A field of arrows over the numbers of a plane: each arrow is a filled shape, and a line on a plot.
        expect(await found((s) => { s.add(complexPlane({ unit: 120 })); s.add(vectorField((x, y) => [-y, x], { unit: 120 })) })).toEqual([])
        // An arrow of the film with its head on a number of an axis, and a brace of the film under a span of a number line.
        expect(await found((s) => {
            const box = s.add(axes({ x: [0, 4], y: [0, 4] })).numbers.children[0]!.bounds()
            s.add(arrow([box.x - 200, box.y - 100], [box.x + box.width / 2, box.y - 2], { stroke: 'yellow' }))
        })).toEqual([])
        expect(await found((s) => {
            const made = s.add(numberLine({ range: [-4, 4] }))
            s.add(braceLabel(s.add(line(made.p(0), made.p(2), { stroke: 'yellow', width: 4 })), '2'))
        })).toEqual([])
        // The same arrow at a label that is not of a plot is judged: its head is a filled shape there.
        expect(await found((s) => {
            const box = s.add(text('a label', { size: 40 })).bounds()
            s.add(arrow([box.x - 200, box.y - 100], [box.x + box.width / 2, box.y - 2], { stroke: 'yellow' }))
        })).toEqual([expect.stringMatching(/^Text "a label" is \d px from a line of an arrow above it\. Leave 12 px or more\.$/)])
        // The head of a connector is a filled shape that draws a line, so it may point at a number of an axis.
        expect(await found((s) => {
            const box = s.add(axes({ x: [0, 4], y: [0, 4] })).numbers.children[0]!.bounds()
            s.add(connector(s.add(rect(100, 60, { stroke: 'blue' }).at(box.x - 300, box.y - 200)), [box.x + box.width / 2, box.y - 2], { route: 'straight' }))
        })).toEqual([])
        // The label of an angle stands between the two rays, which the film draws. A narrow angle brings them near.
        expect(await found((s) => {
            s.add(line([0, 0], [300, 0], { stroke: 'ink', width: 2 }), line([0, 0], [290, -75], { stroke: 'ink', width: 2 }))
            s.add(angleMark([0, 0], [300, 0], [290, -75], { label: '\\theta', radius: 150 }))
        })).toEqual([])
    })

    it('takes a 3D scene as one surface', async () => {
        const on = { textGap: 0.3 }
        // A sphere of radius 180 px, seen with no perspective. A word at a distance from its right edge.
        const beside = async (x: number) => (await checkFilm(film({ fps: 12 }, (s) => {
            s.add(scene3d({ perspective: false })).add(sphere(1.5))
            s.add(text('sphere', { size: 40, anchor: 'left' }).at(x, 0))
            s.wait(0.5)
        }), on)).diagnostics.map((entry) => entry.message)
        // On the sphere, the faces under the word are not marks.
        expect(await beside(-60)).toEqual([])
        expect(await beside(184)).toEqual([expect.stringMatching(/^Text "sphere" is [3-6] px from the surface of a 3D scene\. Leave 12 px or more\.$/)])
        expect(await beside(120)).toEqual(['Text "sphere" runs past the edge of the surface of a 3D scene behind it.'])
        // A text and the surface are a pair that lasts, from the first moment of the film.
        const lasting = await checkFilm(film({ fps: 12 }, (s) => {
            s.add(scene3d({ perspective: false })).add(sphere(1.5))
            s.add(text('sphere', { size: 40, anchor: 'left' }).at(120, 0))
            s.wait(1.5)
        }), on)
        expect(lasting.diagnostics.map((entry) => entry.time < 0.5)).toEqual([true])
        expect(await beside(260)).toEqual([])
        // The faces are what a viewer sees behind a mark on the sphere: a line in the color of the background is a mark there.
        const onSphere = await checkFilm(film({ fps: 12 }, (s) => {
            s.add(scene3d({ perspective: false })).add(sphere(1.5))
            const box = s.add(text('pole', { size: 40 })).bounds()
            s.add(line([box.x - 20, box.y + box.height + 4], [box.x + box.width + 20, box.y + box.height + 4], { stroke: 'bg', width: 2 }))
            s.wait(0.5)
        }), on)
        expect(onSphere.diagnostics.map((entry) => entry.message)).toEqual(['Text "pole" is 3 px from a line below it. Leave 12 px or more.'])

    })

    it('keeps the cost of a dense 3D surface low', async () => {
        const on = { textGap: 0.3 }
        // A paragraph over a surface of 3,600 faces. The check with the rule costs about as much as the check without it.
        const compiled = await film({ fps: 12 }, (s) => {
            s.add(scene3d({})).add(surface((x, y) => Math.sin(x) * Math.cos(y), { x: [-3, 3], y: [-3, 3], resolution: 60 }))
            s.add(text('A paragraph of words that a film puts over a surface,\nwith a second line of words to read as well.', { size: 36 }))
            s.wait(0.5)
        }).compile({})
        const time = async (options: { textGap?: number }) => {
            const runs: number[] = []
            for (let k = 0; k < 5; k++) {
                const start = performance.now()
                await checkFilm(compiled, { times: [0.25], ...options })
                runs.push(performance.now() - start)
            }
            return runs.sort((a, b) => a - b)[2]!
        }
        await time(on)
        // Before the faces were one surface, the rule made this check 40 times slower.
        expect(await time(on)).toBeLessThan(Math.max(await time({}), 5) * 8)
    })

    it('names the mark of a finding: its kind, the object that drew it, and its side of the text', async () => {
        const on = { textGap: 0.3 }
        const message = async (build: (s: Parameters<Build>[0], box: { x: number; y: number; width: number; height: number }) => void) => (await checkFilm(film((s) => {
            build(s, s.add(text('acme', { size: 40 })).bounds())
            s.wait(1)
        }), on)).diagnostics.map((entry) => entry.message)
        const leave = 'Leave 12 px or more.'
        // A line on each side.
        expect(await message((s, b) => { s.add(line([b.x, b.y - 5], [b.x + b.width, b.y - 5], { stroke: 'ink', width: 2 })) })).toEqual([`Text "acme" is 4 px from a line above it. ${leave}`])
        expect(await message((s, b) => { s.add(line([b.x - 5, b.y], [b.x - 5, b.y + b.height], { stroke: 'ink', width: 2 })) })).toEqual([`Text "acme" is 4 px from a line left of it. ${leave}`])
        expect(await message((s, b) => { s.add(line([b.x + b.width + 5, b.y], [b.x + b.width + 5, b.y + b.height], { stroke: 'ink', width: 2 })) })).toEqual([`Text "acme" is 4 px from a line right of it. ${leave}`])
        // The border of a box and of a round shape, a filled shape, and a line that the film gave a name.
        expect(await message((s, b) => { s.add(rect(100, 60, { stroke: 'blue', width: 2 }).at(b.x + b.width / 2, b.y + b.height + 35)) })).toEqual([`Text "acme" is 4 px from the border of a box below it. ${leave}`])
        expect(await message((s, b) => { s.add(circle(30, { stroke: 'blue', width: 2 }).at(b.x + b.width / 2, b.y + b.height + 35)) })).toEqual([`Text "acme" is 4 px from the border of a shape below it. ${leave}`])
        expect(await message((s, b) => { s.add(dot(30, 'blue').at(b.x + b.width / 2, b.y + b.height + 34)) })).toEqual([`Text "acme" is 4 px from a filled shape below it. ${leave}`])
        expect(await message((s, b) => { s.add(line([b.x, b.y - 5], [b.x + b.width, b.y - 5], { stroke: 'ink', width: 2 }).named('the rule')) })).toEqual([`Text "acme" is 4 px from a line of "the rule" above it. ${leave}`])
        // A mark of an object of the library, and of a class of the film.
        expect(await message((s, b) => { s.add(infoBox({ title: 'Service', accent: 'blue', size: 30 }).alignTo([0, b.y + b.height + 4], 'top')) })).toEqual([`Text "acme" is 3 px from the border of a box of an info box below it. ${leave}`])
        class Ruler extends Node {
            constructor(y: number) {
                super()
                this.add(line([-100, y], [100, y], { stroke: 'ink', width: 2 }))
            }
        }
        // A pictogram of the library has its name in the message.
        expect(await message((s, b) => { s.add(pictogram('database', { size: 96 }).alignTo([0, b.y + b.height + 4], 'top')) })).toEqual([expect.stringMatching(/^Text "acme" is \d px from .* of the pictogram "database" below it\. Leave 12 px or more\.$/)])
        // The name of a class is not read: a minified build changes it. A film names a node with `.named()`.
        expect(await message((s, b) => { s.add(new Ruler(b.y + b.height + 5)) })).toEqual([`Text "acme" is 4 px from a line below it. ${leave}`])
        expect(await message((s, b) => { s.add(new Ruler(b.y + b.height + 5).named('ruler')) })).toEqual([`Text "acme" is 4 px from a line of "ruler" below it. ${leave}`])
        // Two marks: the finding names the one that leaves the least part of the room that it needs. The other is drawn first here.
        expect(await message((s, b) => {
            s.add(rect(40, 40, { fill: 'blue', stroke: null }).at(b.x + b.width + 28, b.y + b.height / 2))
            s.add(line([b.x - 30, b.y + b.height + 3], [b.x + b.width + 30, b.y + b.height + 3], { stroke: 'ink', width: 2 }))
        })).toEqual([`Text "acme" is 2 px from a line below it. ${leave}`])
        // In a cell at 5 px, which needs 6, with a line in the cell at 7 px, which needs 12: the line is named.
        expect(await message((s, b) => {
            s.add(rect(b.width + 12, b.height + 60, { stroke: 'blue', width: 2 }).at(b.x + b.width / 2, b.y + b.height / 2))
            s.add(line([b.x, b.y - 8], [b.x + b.width, b.y - 8], { stroke: 'ink', width: 2 }))
        })).toEqual([`Text "acme" is 7 px from a line above it. ${leave}`])

        // One live number at one place is one finding, for all its values.
        for (const readout of [(v: () => number) => decimal(v, { digits: 1, prefix: 'k = ', size: 40 }), () => counter(1, { size: 40 })]) {
            const live = await checkFilm(film({ fps: 12 }, (s) => {
                const value = s.value(1)
                const made = s.add(readout(() => value.value)), box = made.bounds()
                s.add(line([box.x - 20, box.y + box.height + 4], [box.x + box.width + 20, box.y + box.height + 4], { stroke: 'ink', width: 2 }))
                for (let k = 2; k <= 4; k++) {
                    s.wait(0.3)
                    s.play(made instanceof Node && 'value' in made ? countUp(made as ReturnType<typeof counter>, k) : value.to(k), { duration: 0.2 })
                }
                s.wait(0.3)
            }), on)
            expect(live.diagnostics).toHaveLength(1)
            // The finding starts at the first rest: the number is one text while its words change.
            expect(live.diagnostics[0]!.time).toBeLessThan(0.6)
            expect(live.diagnostics[0]!.until).toBeGreaterThan(1.5)
        }
    })

    it('reports text that an opaque shape or an image covers in part, and leaves a strike and a highlight', async () => {
        const on = { textGap: 0.3 }
        const png = `data:image/png;base64,${Buffer.from(encode({ width: 2, height: 1, depth: 8, channels: 4, data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]) })).toString('base64')}`
        // A shape that is drawn after the caption. Its lower edge is at a distance from the top of the letters.
        const after = async (make: () => Node, over: number) => (await checkFilm(film((s) => {
            const box = s.add(text('caption', { size: 40 })).bounds()
            s.add(make().at(0, box.y + over - 30))
            s.wait(1)
        }), on)).diagnostics.map((entry) => `${entry.code}: ${entry.message}`)
        const bar = () => rect(300, 60, { fill: 'blue', stroke: null })
        expect(await after(bar, -3)).toEqual(['film.text_crowded: Text "caption" is 3 px from a filled shape above it. Leave 12 px or more.'])
        expect(await after(bar, 0)).toEqual(['film.text_crowded: Text "caption" touches a filled shape above it. Leave 12 px or more.'])
        expect(await after(bar, 12)).toEqual(['film.text_crowded: Text "caption" is partly behind a filled shape.'])
        // A text and the shape that covers it are a pair that lasts, from the first moment of the film.
        // The panel is no mark here: it has the `surface` fill and no border.
        const lasting = await checkFilm(film((s) => {
            const box = s.add(text('caption', { size: 40 })).bounds()
            s.add(rect(300, 60, { fill: 'surface', stroke: null }).at(0, box.y + 12 - 30))
            s.wait(1)
        }), on)
        expect(lasting.diagnostics.map((entry) => [entry.message, entry.time < 0.5])).toEqual([['Text "caption" is partly behind a filled shape.', true]])
        // A panel with a faint fill and a faint border is no mark, and it still covers the letters.
        expect(await after(() => rect(300, 60, { fill: 'surface', stroke: 'grid' }), 12)).toEqual(['film.text_crowded: Text "caption" is partly behind a filled shape.'])
        expect(await after(() => group(image(png, { width: 300, height: 60 })), 12)).toEqual(['film.text_crowded: Text "caption" is partly behind an image.'])
        // A viewer does not see text that is all under a shape. The letters show through a shape at 50%.
        expect(await after(() => rect(300, 60, { fill: 'blue', stroke: null }).shift(0, 0), 60)).toEqual([])
        // Two shapes that hide a text together hide all of it. Two shapes that leave its middle letter hide a part.
        const two = async (apart: number) => (await checkFilm(film((s) => {
            const box = s.add(text('hidden words', { size: 40 })).bounds(), middle = box.x + box.width / 2
            for (const side of [-1, 1]) s.add(rect(box.width / 2 + 20, 120, { fill: side < 0 ? 'blue' : 'teal', stroke: null }).at(middle + side * (box.width / 4 + 10 + apart), 0))
            s.wait(1)
        }), on)).diagnostics.map((entry) => entry.message)
        expect(await two(0)).toEqual([])
        expect(await two(20)).toEqual(['Text "hidden words" is partly behind a filled shape.'])
        expect(await after(() => bar().opacity(0.5), 12)).toEqual([])
        // A round shape covers what is in the shape, and not what is in its box: the corner of the box of this dot is on the word.
        const round = await checkFilm(film((s) => {
            const box = s.add(text('caption', { size: 40 })).bounds()
            s.add(dot(100, 'blue').at(box.x + box.width + 90, box.y + box.height + 70))
            s.wait(1)
        }), on)
        expect(round.diagnostics).toEqual([])
    })

    it('gives one verdict for one picture, at any opacity of a card', async () => {
        // A label in a card ends 7 px over the border, and a line of the film starts on the border, outside the card.
        // The room of the label is 7.8 px. At 30% the fill of the card is no backing, and at 100% it is one.
        const boxed = (opacity: number) => checkFilm(film((s) => {
            const label = text('logs', { size: 26, color: 'ink' }), box = label.bounds()
            label.shift(0, 62 - 1.25 - 7 - (box.y + box.height))
            s.add(group(line([10, 62], [-60, 160], { stroke: 'ink', width: 2 }), rect(164, 124, { radius: 12, fill: 'surface', stroke: 'blue', width: 2.5 }), label).opacity(opacity))
            s.wait(1)
        }), { textGap: 0.3 })
        const messages = async (opacity: number) => (await boxed(opacity)).diagnostics.map((entry) => entry.message)
        // The border of the card is between the label and the line, so the line is not near the label.
        expect(await messages(1)).toEqual([])
        expect(await messages(0.6)).toEqual([])
        // This pins that limit: a line that goes behind a card, and comes out 5 px from a word of the card, is not judged.
        // The word is judged against the border, where it needs half of its room of 7.8 px. At 3 px it is reported.
        const behind = async (gap: number, border: boolean) => (await checkFilm(film((s) => {
            s.add(line([0, 0], [220, 0], { stroke: 'ink', width: 2 }))
            s.add(rect(300, 120, { fill: border ? 'surface' : 'blue', stroke: border ? 'blue' : null, width: 2.5 }))
            const word = text('logs', { size: 26 }), box = word.bounds()
            s.add(word.shift(150 - (border ? 1.25 : 0) - gap - (box.x + box.width), 0))
            s.wait(1)
        }), { textGap: 0.3 })).diagnostics.map((entry) => entry.message)
        expect(await behind(5, true)).toEqual([])
        expect(await behind(5, false)).toEqual([])
        expect(await behind(3, true)).toEqual(['Text "logs" is 3 px from the border of a box right of it. Leave 4 px or more.'])
        expect(await behind(3, false)).toEqual(['Text "logs" is 3 px from the right edge of the filled shape behind it. Leave 4 px or more.'])
        // The box of an object holds the labels of the object in the same way. A line of the film that ends on the border
        // of a card, 3 px under the caption that the card placed, is on the other side of that border.
        const ends = async (inside: boolean) => (await checkFilm(film((s) => {
            const made = s.add(card({ title: 'Logs', figure: pictogram('logs'), caption: 'one line per event', width: 300, padding: 3 })), box = made.bounds()
            const from = box.y + box.height - (inside ? 4 : 0)
            s.add(line([0, from], [0, from + 80], { stroke: 'ink', width: 2 }))
            s.wait(1)
        }), { textGap: 0.3 })).diagnostics.map((entry) => entry.message)
        expect(await ends(false)).toEqual([])
        expect(await ends(true)).toEqual([expect.stringMatching(/^Text "one line per event" (touches|is \d px from) a line below it\. Leave \d px or more\.$/)])
        // The same line in the card, 7 px under the label, is.
        const inside = await checkFilm(film((s) => {
            const label = s.add(text('logs', { size: 26, color: 'ink' })), box = label.bounds()
            s.add(rect(164, 124, { radius: 12, stroke: 'blue', width: 2.5 }))
            s.add(line([-40, box.y + box.height + 8], [40, box.y + box.height + 8], { stroke: 'ink', width: 2 }))
            s.wait(1)
        }), { textGap: 0.3 })
        expect(inside.diagnostics.map((entry) => entry.message)).toEqual(['Text "logs" is 7 px from a line below it. Leave 8 px or more.'])
    })

    it('lets a backing hide a mark only inside its shape', async () => {
        const on = { textGap: 0.3 }
        // A line 3 px under a word, and a patch that the film draws after the line. The box of the patch holds the line.
        const patched = async (patch: (right: number, y: number, left: number) => Node) => (await checkFilm(film((s) => {
            const word = text('acme', { size: 40 }), b = word.bounds(), y = b.y + b.height + 4
            s.add(line([b.x - 40, y], [b.x + b.width + 40, y], { stroke: 'ink', width: 2 }))
            s.add(patch(b.x + b.width + 60, y, b.x - 60))
            s.add(word)
            s.wait(1)
        }), on)).diagnostics.map((entry) => entry.message)
        // A triangle whose slanted side is far under the line: the line is in its box and not in its shape.
        expect(await patched((right, y, left) => polygon([[right, y - 60], [right, y + 200], [left, y + 200]], { fill: 'surface', stroke: null }))).toEqual(['Text "acme" is 3 px from a line below it. Leave 12 px or more.'])
        // A rectangle with the same box hides the line.
        expect(await patched((right, y, left) => polygon([[right, y - 60], [right, y + 200], [left, y + 200], [left, y - 60]], { fill: 'surface', stroke: null }))).toEqual([])
        // A path that is not closed is not a backing, also when it has a fill. This pins that limit.
        expect(await patched((right, y, left) => polyline([[right, y - 60], [right, y + 200], [left, y + 200], [left, y - 60]], { fill: 'surface', stroke: null }))).toEqual(['Text "acme" is 3 px from a line below it. Leave 12 px or more.'])

        // A label with a backing that covers its room, across the edge of a panel: the letters are on the backing, and not on the panel.
        const across = await checkFilm(film((s) => {
            const label = text('Label', { size: 40 }), b = label.bounds()
            s.add(rect(300, 200, { fill: 'blue', stroke: null }).at(-150, 0))
            s.add(rect(b.width + 40, b.height + 40, { fill: 'bg', stroke: null }).at(b.x + b.width / 2, b.y + b.height / 2))
            s.add(label)
            s.wait(1)
        }), on)
        expect(across.diagnostics).toEqual([])
    })

    it('judges, in a motion scan, a text and a mark that stay too near for a second, also when the two move', async () => {
        // A caption 3 px under a bar, while a square turns all the time: the film never comes to rest.
        const turning = (seconds: number) => film({ fps: 30 }, (s) => {
            const square = s.add(rect(40, 40, { stroke: 'blue' }).at(-700, -300))
            const bar = s.add(rect(300, 60, { fill: 'blue', stroke: null })), caption = s.add(text('caption', { size: 40 }).alignTo([0, 33], 'top'))
            s.play(spin(square, 1, { duration: seconds }))
            s.remove(bar, caption)
            s.play(spin(square, 1, { duration: 1 }))
        })
        const crowded = async (seconds: number, motion: boolean) => (await checkFilm(turning(seconds), { textGap: 0.3, motion, times: [] })).diagnostics.filter((entry) => entry.code === 'film.text_crowded')
        expect(await crowded(3, false)).toEqual([])
        const held = await crowded(3, true)
        expect(held).toMatchObject([{ message: 'Text "caption" is 3 px from a filled shape above it. Leave 12 px or more.', time: 0, motion: { spans: 1 } }])
        expect(held[0]!.until).toBeGreaterThan(2.5)
        // Half a second is not long enough.
        expect(await crowded(0.5, true)).toEqual([])
        // A caption that slides along under a bar is 3 px from that bar all the time. What lasts is the pair, and not a place.
        const sliding = await checkFilm(film({ fps: 30 }, (s) => {
            s.add(rect(900, 60, { fill: 'blue', stroke: null }))
            const label = s.add(text('caption', { size: 40 }).alignTo([0, 33], 'top').shift(-300, 0))
            s.play(shift(label, 600, 0, { ease: linear }), { duration: 3 })
        }), { textGap: 0.3, motion: true, times: [] })
        expect(sliding.diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message)).toEqual(['Text "caption" is 3 px from a filled shape above it. Leave 12 px or more.'])
        // A word and a box that move together, as in a pan, at any speed: 1, 20 and 100 px in one second.
        for (const speed of [1, 20, 100]) {
            const pan = await checkFilm(film({ fps: 30 }, (s) => {
                s.add(text('a title that stays', { size: 30 }).at(0, -400))
                const word = text('Hello world', { size: 40 }), box = word.bounds()
                const pair = s.add(group(word, rect(120, 90, { stroke: 'ink', fill: null, width: 2 }).at(box.x + box.width + 4 + 60, 0)).at(-300, 0))
                s.play(shift(pair, speed * 3, 0, { ease: linear }), { duration: 3 })
                pair.hide()
                s.wait(1)
            }), { textGap: 0.3, motion: true })
            expect(pan.diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message), `at ${speed} px/s`).toEqual(['Text "Hello world" is 3 px from the border of a box right of it. Leave 12 px or more.'])
        }
        // A formula that changes into a longer one, 6 px under a heading that keeps its place. The letters on their way are not marks.
        const morphing = await checkFilm(film({ fps: 30 }, (s) => {
            const box = s.add(text('HEAD', { size: 60 })).bounds()
            const short = s.add(tex('b', { size: 60 })), long = tex('b + c', { size: 60 })
            for (const formula of [short, long]) formula.alignTo([0, box.y + box.height + 6], 'top')
            s.play(morphMatching(short, long), { duration: 2 })
        }), { textGap: 0.3, motion: true, times: [] })
        expect(morphing.diagnostics.filter((entry) => entry.code === 'film.text_crowded')).toEqual([])
    })

    it('follows the pair of a text and a mark: the same mark must be too near for one second', async () => {
        const on = { textGap: 0.3 }
        // A rule comes to 3 px under a caption, stays for a time, and goes away. The film rests while it stays.
        const passing = (seconds: number, options: { textGap: number; times?: number[]; motion?: boolean } = on) => checkFilm(film({ fps: 20 }, (s) => {
            const box = s.add(text('caption', { size: 40 })).bounds()
            const rule = s.add(line([box.x - 60, box.y + box.height + 204], [box.x + box.width + 60, box.y + box.height + 204], { stroke: 'ink', width: 2 }))
            s.play(shift(rule, 0, -200), { duration: 0.4 })
            s.wait(seconds)
            s.play(shift(rule, 0, 200), { duration: 0.4 })
            s.wait(1.5)
        }), options)
        const found = async (seconds: number, options?: { textGap: number; times?: number[]; motion?: boolean }) => (await passing(seconds, options)).diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message)
        const near = ['Text "caption" is 3 px from a line below it. Leave 12 px or more.']
        expect(await found(1.2)).toEqual(near)
        expect(await found(1.1)).toEqual(near)
        // A rest of half a second is a moment: one second later the rule is not there.
        expect(await found(0.5)).toEqual([])
        expect(await found(0.5, { ...on, motion: true })).toEqual([])
        // With `times`, each time is a picture.
        expect(await found(0.5, { ...on, times: [0.6] })).toEqual(near)
        // A rule that rests 3 px under the caption for half a second, and then stays 8 px under it, is one mark that is
        // too near all the time. The distance of the pair may change. The message has the first one.
        const steps2 = await checkFilm(film({ fps: 20 }, (s) => {
            const box = s.add(text('caption', { size: 40 })).bounds()
            const rule = s.add(line([box.x - 60, box.y + box.height + 204], [box.x + box.width + 60, box.y + box.height + 204], { stroke: 'ink', width: 2 }))
            s.play(shift(rule, 0, -200), { duration: 0.4 })
            s.wait(0.5)
            s.play(shift(rule, 0, 5), { duration: 0.2 })
            s.wait(1.5)
        }), on)
        expect(steps2.diagnostics.map((entry) => entry.message)).toEqual(near)
        // Two rules, one after the other at the same place, each for 0.6 s: two marks are two pairs, and no pair lasts.
        // One rule for the same 1.2 s is a finding. A square turns, so the film does not rest.
        const two = async (rules: number) => (await checkFilm(film({ fps: 20 }, (s) => {
            const box = s.add(text('caption', { size: 40 })).bounds()
            const rule = () => line([box.x - 60, box.y + box.height + 4], [box.x + box.width + 60, box.y + box.height + 4], { stroke: 'ink', width: 2 })
            const first = s.add(rule()), second = rules === 2 ? s.add(rule()).hide() : first
            s.at(0.6, () => { if (rules === 2) { first.hide(); second.show() } })
            s.at(1.2, () => second.hide())
            s.play(spin(s.add(rect(40, 40, { stroke: 'blue' }).at(-700, -300)), 1, { duration: 3 }))
        }), { ...on, motion: true, times: [] })).diagnostics.map((entry) => entry.message)
        expect(await two(1)).toEqual(near)
        expect(await two(2)).toEqual([])
        // The same at moments at rest: one second after a rest with the first rule, the second rule is another mark.
        const resting = async (rules: number) => (await checkFilm(film({ fps: 20 }, (s) => {
            const box = s.add(text('caption', { size: 40 })).bounds()
            const rule = () => line([box.x - 60, box.y + box.height + 4], [box.x + box.width + 60, box.y + box.height + 4], { stroke: 'ink', width: 2 })
            const first = s.add(rule()), second = rules === 2 ? s.add(rule()).hide() : first
            s.at(0.7, () => { if (rules === 2) { first.hide(); second.show() } })
            s.at(1.3, () => second.hide())
            s.wait(2.5)
        }), on)).diagnostics.map((entry) => entry.message)
        expect(await resting(1)).toEqual(near)
        expect(await resting(2)).toEqual([])
        // Each mark that is too near is a pair, and not only the one that the message names. A rule stays 8 px under the
        // caption for 1.4 s. A second rule is 3 px over the caption from 0.4 s to 1.0 s, and it is the nearer one then.
        const second = await checkFilm(film({ fps: 20 }, (s) => {
            const box = s.add(text('acme', { size: 40 })).bounds()
            const under = s.add(line([box.x - 60, box.y + box.height + 9], [box.x + box.width + 60, box.y + box.height + 9], { stroke: 'ink', width: 2 }))
            const over = s.add(line([box.x - 60, box.y - 4], [box.x + box.width + 60, box.y - 4], { stroke: 'ink', width: 2 })).hide()
            s.at(0.4, () => over.show())
            s.at(1.0, () => over.hide())
            s.at(1.4, () => under.hide())
            s.play(spin(s.add(rect(40, 40, { stroke: 'blue' }).at(-700, -300)), 1, { duration: 3 }))
        }), { ...on, motion: true, times: [] })
        expect(second.diagnostics.map((entry) => entry.message)).toEqual(['Text "acme" is 8 px from a line below it. Leave 12 px or more.'])
        // A rule that is there for 0.6 s, away for 0.4 s, and there again for 0.6 s: a pause ends a stretch.
        const paused = await checkFilm(film({ fps: 20 }, (s) => {
            const box = s.add(text('caption', { size: 40 })).bounds()
            const rule = s.add(line([box.x - 60, box.y + box.height + 4], [box.x + box.width + 60, box.y + box.height + 4], { stroke: 'ink', width: 2 }))
            s.at(0.6, () => rule.hide())
            s.at(1.0, () => rule.show())
            s.at(1.6, () => rule.hide())
            s.play(spin(s.add(rect(40, 40, { stroke: 'blue' }).at(-700, -300)), 1, { duration: 3 }))
        }), { ...on, motion: true, times: [] })
        expect(paused.diagnostics).toEqual([])
        // A rule that slides along itself under the caption is as near as before, so it is a finding.
        const sliding = await checkFilm(film({ fps: 20 }, (s) => {
            const box = s.add(text('caption', { size: 40 })).bounds()
            const rule = s.add(line([box.x - 400, box.y + box.height + 4], [box.x + box.width + 400, box.y + box.height + 4], { stroke: 'ink', width: 2 }))
            s.play(shift(rule, 200, 0, { ease: linear }), { duration: 2 })
        }), { ...on, motion: true, times: [] })
        expect(sliding.diagnostics.map((entry) => entry.message)).toEqual(near)
        // The last picture of a film stays, so a rest at the end of a film counts.
        const last = await checkFilm(film({ fps: 20 }, (s) => {
            const box = s.add(text('caption', { size: 40 })).bounds()
            const rule = s.add(line([box.x - 60, box.y + box.height + 204], [box.x + box.width + 60, box.y + box.height + 204], { stroke: 'ink', width: 2 }))
            s.play(shift(rule, 0, -200), { duration: 0.4 })
            s.wait(0.3)
        }), on)
        expect(last.diagnostics.map((entry) => entry.message)).toEqual(near)

        // A playhead that goes across a label in half a second passes it. It is not a text with no room.
        const playhead = await checkFilm(film({ fps: 20 }, (s) => {
            const box = s.add(text('x position', { size: 40 })).bounds()
            const head = s.add(line([box.x - 40, box.y - 30], [box.x - 40, box.y + box.height + 30], { stroke: 'ink', width: 2 }))
            s.play(shift(head, box.width + 80, 0, { ease: linear }), { duration: 0.5 })
            s.remove(head)
            s.play(spin(s.add(rect(40, 40, { stroke: 'blue' }).at(-700, -300)), 1, { duration: 2 }))
        }), { ...on, motion: true })
        expect(playhead.diagnostics.filter((entry) => entry.code === 'film.text_crowded')).toEqual([])
        // The same line that stops beside the label, and stays there, is a finding.
        const stopped = await checkFilm(film({ fps: 20 }, (s) => {
            const box = s.add(text('x position', { size: 40 })).bounds()
            const head = s.add(line([box.x - 3, box.y - 30], [box.x - 3, box.y + box.height + 30], { stroke: 'ink', width: 2 }))
            s.play(spin(s.add(rect(40, 40, { stroke: 'blue' }).at(-700, -300)), 1, { duration: 2 }))
            void head
        }), { ...on, motion: true, times: [] })
        expect(stopped.diagnostics.map((entry) => entry.message)).toEqual([expect.stringMatching(/^Text "x position" is 2 px from a line left of it\. Leave 12 px or more\.$/)])

        // One drawing with two texts. The first one starts on the place of the second and moves away slowly, so the scan
        // gives the second text another name than the moment at rest does. It is still one finding.
        const renamed = await checkFilm(film({ fps: 20 }, (s) => {
            const at = s.value(0)
            const fixed = text('fixed', { size: 40 }), box = fixed.bounds()
            s.add(line([box.x - 60, box.y + box.height + 4], [box.x + box.width + 60, box.y + box.height + 4], { stroke: 'ink', width: 2 }))
            s.add(dynamic(() => [text('fixes', { size: 40, color: 'dim' }).at(at.value, 0), text('fixed', { size: 40 })]))
            s.play(at.to(240, { ease: linear }), { duration: 1.6 })
            s.play(spin(s.add(rect(40, 40, { stroke: 'blue' }).at(-700, -300)), 1, { duration: 2 }))
        }), { ...on, motion: true })
        expect(renamed.diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message)).toEqual(['Text "fixed" is 3 px from a line below it. Leave 12 px or more.'])
    })

    it('reports a stretch of 1.1 s at every phase of the scan, and a stretch of 0.6 s at none', async () => {
        // The border of a box is 3 px right of a word for a number of frames, from a frame on. A square turns, so the
        // film does not rest. At 30 frames in one second, the scan looks at the frames 0, 8, 15 and 23 of each second.
        const stretch = async (from: number, frames: number) => (await checkFilm(film({ fps: 30 }, (s) => {
            const box = s.add(text('Hello world', { size: 40 })).bounds()
            const near = s.add(rect(120, 90, { stroke: 'ink', fill: null, width: 2 }).at(box.x + box.width + 4 + 60, 0)).hide()
            s.at(from / 30, () => near.show())
            s.at((from + frames) / 30, () => near.hide())
            s.play(spin(s.add(rect(40, 40, { stroke: 'blue' }).at(-700, -300)), 1, { duration: 3 }))
        }), { textGap: 0.3, motion: true, times: [] })).diagnostics.length
        for (let phase = 0; phase < 15; phase += 2) {
            expect(await stretch(10 + phase, 18), `0.6 s from frame ${10 + phase}`).toBe(0)
            expect(await stretch(10 + phase, 33), `1.1 s from frame ${10 + phase}`).toBe(1)
        }
        // At 10 frames in one second, a quarter of a second is between two frames: the looks are at the frames 0, 3, 5 and 8.
        const slow = async (from: number, frames: number) => (await checkFilm(film({ fps: 10 }, (s) => {
            const box = s.add(text('Hello world', { size: 40 })).bounds()
            const near = s.add(rect(120, 90, { stroke: 'ink', fill: null, width: 2 }).at(box.x + box.width + 4 + 60, 0)).hide()
            s.at(from / 10, () => near.show())
            s.at((from + frames) / 10, () => near.hide())
            s.play(spin(s.add(rect(40, 40, { stroke: 'blue' }).at(-700, -300)), 1, { duration: 3 }))
        }), { textGap: 0.3, motion: true, times: [] })).diagnostics.length
        for (let phase = 0; phase < 10; phase++) {
            expect(await slow(3 + phase, 6), `0.6 s from frame ${3 + phase}`).toBe(0)
            expect(await slow(3 + phase, 11), `1.1 s from frame ${3 + phase}`).toBe(1)
        }
    }, 30_000)

    it('asks for the same room in a zone with a title and in a zone without one', async () => {
        const on = { textGap: 0.3 }
        const messages = async (title: string | undefined, padding: number) => (await checkFilm(film((s) => {
            s.add(zone([text('guest', { size: 40 })], { ...(title ? { title } : {}), padding, radius: 0 }))
            s.wait(1)
        }), on)).diagnostics.map((entry) => entry.message.replace(/ (left of|right of|above|below) it/, ''))
        // With a padding of 10 the border is 8.75 px from the letters, and the room in a shape is 6 px.
        expect(await messages(undefined, 10)).toEqual([])
        expect(await messages('jail', 10)).toEqual([])
        expect(await messages(undefined, 5)).toEqual(['Text "guest" is 3 px from the border of a box of a zone. Leave 6 px or more.'])
        expect(await messages('jail', 5)).toEqual(['Text "guest" is 3 px from the border of a zone. Leave 6 px or more.'])
        // A line of the film that goes around a word on three sides does not hold it: the room is the full 12 px.
        const open = await checkFilm(film((s) => {
            const b = s.add(text('acme', { size: 40 })).bounds()
            s.add(polyline([[b.x - 9, b.y - 30], [b.x - 9, b.y + b.height + 9], [b.x + b.width + 9, b.y + b.height + 9], [b.x + b.width + 9, b.y - 30]], { stroke: 'blue', width: 2 }))
            s.wait(1)
        }), on)
        expect(open.diagnostics).toMatchObject([{ message: expect.stringMatching(/^Text "acme" is 8 px from a line .* Leave 12 px or more\.$/) }])
    })

    it('takes as a mark what has a contrast of 1.2 with what a viewer sees behind it', async () => {
        const found = async (build: Build, look?: 'midnight' | 'paper' | 'blueprint' | 'chalk' | 'neon') => (await checkFilm(film((s) => { build(s); s.wait(1) }), { textGap: 0.3, ...(look ? { look } : {}) })).diagnostics.map((entry) => entry.message)
        // A row of a table: its name is 2 px over a rule of the `grid` color. A reviewer saw this in a narrated film.
        const row: Build = (s) => {
            const box = s.add(text('csv_tall', { size: 26, font: 'mono', color: 'dim' })).bounds()
            s.add(line([box.x - 2, box.y + box.height + 2.75], [box.x + 600, box.y + box.height + 2.75], { stroke: 'grid', width: 1.5 }))
        }
        // A caption 3 px under a panel: with the `surface` fill and no border, and with a border of the `grid` color.
        const panel = (stroke: string | null): Build => (s) => {
            s.add(rect(300, 60, { fill: 'surface', stroke }))
            s.add(text('caption', { size: 40 }).alignTo([0, stroke ? 34 : 33], 'top'))
        }
        // The limit holds in every look: a line of the `grid` color is a mark, and a fill of the `surface` color is not.
        for (const look of ['midnight', 'paper', 'blueprint', 'chalk', 'neon'] as const) {
            expect(await found(row, look), look).toEqual(['Text "csv_tall" is 2 px from a line below it. Leave 8 px or more.'])
            expect(await found(panel(null), look), look).toEqual([])
            expect(await found(panel('grid'), look), look).toEqual(['Text "caption" is 2 px from the border of a box above it. Leave 12 px or more.'])
        }

        // On a card, the card is behind the mark. A dark rule on a light card is the strongest line of the picture.
        const onCard = (kind: 'dark rule' | 'dark box' | 'white line'): Build => (s) => {
            s.add(rect(500, 200, { fill: kind === 'dark box' ? 'blue' : 'ink', stroke: null, radius: 12 }))
            const box = s.add(text('payments', { size: 40, color: 'bg' })).bounds()
            if (kind === 'dark box') s.add(rect(80, 60, { fill: 'bg', stroke: null }).at(box.x + box.width + 3 + 40, 0))
            else s.add(line([box.x - 30, box.y + box.height + 4], [box.x + box.width + 30, box.y + box.height + 4], { stroke: kind === 'dark rule' ? 'bg' : 'ink', width: 2 }))
        }
        expect(await found(onCard('dark rule'))).toEqual(['Text "payments" is 3 px from a line below it. Leave 12 px or more.'])
        expect(await found(onCard('dark box'))).toEqual(['Text "payments" is 3 px from a filled shape right of it. Leave 12 px or more.'])
        // No viewer sees a white line on a white card.
        expect(await found(onCard('white line'))).toEqual([])
        // A long line can leave a small shape. A chip in the color of the line, behind the middle of the line, does not hide
        // the line from the rule: a word 3 px over the line, beside the chip, is reported.
        expect(await found((s) => {
            const box = s.add(text('beside', { size: 40 }).at(-200, 0)).bounds(), y = box.y + box.height + 4
            s.add(rect(40, 40, { fill: 'ink', stroke: null }).at(0, y))
            s.add(line([-300, y], [300, y], { stroke: 'ink', width: 2 }))
        })).toEqual(['Text "beside" is 3 px from a line below it. Leave 12 px or more.'])
        // A line through the letters. A faint line may run behind a label: no rule reports a line of the `grid` color there.
        // The rule for a line through text does not look at a dark line on a light card, so this rule reports it.
        const through = (card: boolean) => found((s) => {
            if (card) s.add(rect(500, 200, { fill: 'ink', stroke: null, radius: 12 }))
            const box = s.add(text('payments', { size: 40, color: card ? 'bg' : 'ink' })).bounds(), y = box.y + box.height * 0.55
            s.add(line([box.x - 30, y], [box.x + box.width + 30, y], { stroke: card ? 'bg' : 'grid', width: 2 }).zIndex(card ? 0 : -1))
        })
        expect(await through(false)).toEqual([])
        expect(await through(true)).toEqual([expect.stringMatching(/^Text "payments" touches a line .*\. Leave 12 px or more\.$/)])
        // A faint line is behind a label where it runs through the letters over their base line. A text sits on a line at
        // its base line: a faint rule there, or through the tails of a row name, is worse than a rule 2 px under the tails.
        // All three are findings.
        const rule = (depth: number) => found((s) => {
            const flat = text('H', { size: 26, font: 'mono' }).bounds(), base = flat.y + flat.height
            const box = s.add(text('json_datadog', { size: 26, font: 'mono', color: 'dim' })).bounds()
            s.add(line([box.x - 200, base + depth], [box.x + box.width + 400, base + depth], { stroke: 'grid', width: 1.5 }).zIndex(-1))
        })
        expect(await rule(-8)).toEqual([])
        expect(await rule(0)).toEqual(['Text "json_datadog" touches a line below it. Leave 8 px or more.'])
        expect(await rule(3)).toEqual(['Text "json_datadog" touches a line below it. Leave 8 px or more.'])
        expect(await rule(8)).toEqual(['Text "json_datadog" is 2 px from a line below it. Leave 8 px or more.'])
        // The base line counts, and not the bottom of the tails: a rule 2 px over the base line of a word with tails is at its foot.
        expect(await found((s) => {
            const flat = text('H', { size: 40 }).bounds(), base = flat.y + flat.height
            const box = s.add(text('gypsy', { size: 40 })).bounds()
            s.add(line([box.x - 200, base - 2], [box.x + box.width + 200, base - 2], { stroke: 'grid', width: 1.5 }).zIndex(-1))
        })).toEqual([expect.stringMatching(/^Text "gypsy" touches a line (below it|between its letters)\. Leave 12 px or more\.$/)])
        // Over the base line, a faint line is behind the label, also at the top of the letters: the grid of a chart behind a mark.
        expect(await found((s) => {
            const box = s.add(text('?', { size: 66 })).bounds()
            s.add(line([box.x - 300, box.y + 8], [box.x + 300, box.y + 8], { stroke: 'grid', width: 1.5 }).zIndex(-1))
        })).toEqual([])
        // A faint line that goes up through a label, between two of its words, is behind the label. At the end of the
        // label, it is a mark.
        const upright = (at: 'between' | 'end') => found((s) => {
            const box = s.add(text('1,437 cycles', { size: 40, anchor: 'left' })).bounds()
            const x = at === 'between' ? box.x + text('1,437', { size: 40 }).bounds().width + 5 : box.x + 0.5
            s.add(line([x, box.y - 100], [x, box.y + box.height + 100], { stroke: 'grid', width: 1.5 }).zIndex(-1))
        })
        expect(await upright('between')).toEqual([])
        expect(await upright('end')).toEqual([expect.stringMatching(/^Text "1,437 cycles" (touches|is \d px from) a line left of it\. Leave 12 px or more\.$/)])

        // A row in a band of a faint color on a card, with the tails of its letters 1 px from the lower edge of the band.
        // A viewer sees the edge of the band, so the band is a mark, and the row needs half of its room in it.
        const band = (below: number): Build => (s) => {
            s.add(rect(700, 300, { fill: 'surface', stroke: 'purple', radius: 12 }))
            const row = text('payments, checkout, latency', { size: 28 }), box = row.bounds()
            const top = box.y - 10, bottom = box.y + box.height + below
            s.add(rect(600, bottom - top, { fill: 'yellow', stroke: null, radius: 6 }).at(0, (top + bottom) / 2).set('fillOpacity', 0.2))
            s.add(row)
        }
        expect(await found(band(1))).toEqual(['Text "payments, checkout, latency" is 1 px from the lower edge of the filled shape behind it. Leave 5 px or more.'])
        expect(await found(band(6))).toEqual([])

        // A label on a plate in the color of the background, with a line that goes behind the plate. On a tinted area or
        // on a surface of small tiles, a viewer sees the plate, so the line is on the other side of its border. On the
        // background, no viewer sees the plate: the line ends 6 px from the letters.
        const plate = (ground: 'tint' | 'tiles' | 'none'): Build => (s) => {
            s.add(line([-300, 0], [300, 0], { stroke: 'ink', width: 2 }))
            if (ground === 'tint') s.add(rect(500, 300, { fill: 'yellow', stroke: null }).set('fillOpacity', 0.4))
            if (ground === 'tiles') for (let k = -5; k < 5; k++) s.add(rect(50, 300, { fill: 'green', stroke: null }).at(k * 50 + 25, 0).set('fillOpacity', 0.5))
            const word = text('2.50', { size: 40 }), box = word.bounds()
            s.add(rect(box.width + 12, box.height + 12, { fill: 'bg', stroke: null, radius: 6 }).at(box.x + box.width / 2, box.y + box.height / 2))
            s.add(word)
        }
        expect(await found(plate('tint'))).toEqual([])
        expect(await found(plate('tiles'))).toEqual([])
        expect(await found(plate('none'))).toEqual([expect.stringMatching(/^Text "2\.50" is 6 px from a line (left|right) of it\. Leave 12 px or more\.$/)])
    })

    it('says so when the film was built by an engine that does not mark its labels, and does not run the rule', async () => {
        const compiled = await film((s) => {
            s.add(rect(300, 60, { fill: 'blue', stroke: null }))
            s.add(text('caption', { size: 40 }).alignTo([0, 33], 'top'))
            s.wait(1)
        }).compile({})
        expect((await checkFilm(compiled, { textGap: 0.3 })).diagnostics).toMatchObject([{ code: 'film.text_crowded', text: 'caption' }])
        // An engine before this rule has no `drawer` on its nodes. The CLI can load a film that imports such an engine.
        delete (compiled.stage.root as { drawer?: unknown }).drawer
        const report = await checkFilm(compiled, { textGap: 0.3 })
        expect(report.diagnostics).toMatchObject([{ code: 'film.text_crowded', severity: 'warning', time: 0 }])
        expect(report.diagnostics[0]!.message).toMatch(/^The film imports a version of the engine that does not mark the labels of its objects, so the check for text with no room did not run\./)
        expect((await checkFilm(compiled, {})).diagnostics).toEqual([])
    })

    it('holds the edges of the rule: a face of a scene, a letter with no size, two rings, and a copy', async () => {
        const on = { textGap: 0.3 }
        const messages = async (build: Build) => (await checkFilm(film({ fps: 12 }, (s) => { build(s); s.wait(0.5) }), on)).diagnostics.filter((entry) => entry.code === 'film.text_crowded').map((entry) => entry.message)
        // A label of an object that is not a scene is judged against a line of a 3D scene.
        expect(await messages((s) => {
            s.add(scene3d({ perspective: false, phi: 0 })).add(axes3d({ labels: false, ticks: false }))
            s.add(labeledDot('P', { plain: true, side: 'right', gap: 20 }).at(0, -30))
        })).toEqual([expect.stringMatching(/^Text "P" is \d px from a line of a 3D scene/)])
        // A line of the film passes a label of a 3D scene, as on any plot.
        expect(await messages((s) => {
            const view = s.add(scene3d({ perspective: false }))
            view.add(label3d('P', [1, 1, 1], { math: false, size: 40 }))
            s.add(line([-600, 0], [600, 0], { stroke: 'ink', width: 2 }).at(0, view.bounds().y))
        })).toEqual([])
        // Letters that a film makes itself record no size. The size is then the tallest letter over 0.7: 28 px gives 40.
        expect(await messages((s) => {
            const word = s.add(new Node())
            for (const x of [0, 24]) {
                const letter = rect(20, 28, { fill: 'ink', stroke: null }).at(x, 0)
                letter.data['key'] = 'x'
                word.add(letter)
            }
            s.add(line([-20, 23], [50, 23], { stroke: 'ink', width: 2 }))
        })).toEqual(['Text "" is 8 px from a line below it. Leave 12 px or more.'])
        // A label that is wider than a circle with a fill and a border is one finding, of the rule for a line through text.
        const circled = await checkFilm(film((s) => { s.add(circle(24, { stroke: 'teal', fill: 'blue' })); s.add(text('22M', { size: 40 })); s.wait(1) }), on)
        expect(circled.diagnostics.map((entry) => entry.code)).toEqual(['film.text_crossed'])
        // With a faint border, that rule does not look at the line. The fill is then the mark of this rule.
        expect(await messages((s) => { s.add(circle(24, { stroke: 'grid', fill: 'blue' })); s.add(text('22M', { size: 40 })) })).toEqual(['Text "22M" is wider than the filled shape behind it.'])
        // A path of the film with a closed ring far away and an open line: the line passes a number of an axis.
        expect(await messages((s) => {
            const b = s.add(axes({ x: [0, 4], y: [0, 4] })).numbers.children[0]!.bounds()
            s.add(svgPath(`M${b.x - 30} ${b.y + b.height + 3}H${b.x + b.width + 30}M-700 -400h40v40h-40Z`, { stroke: 'yellow', width: 2 }))
        })).toEqual([])
        // A copy of one label of an object is text of the film. A copy of the whole object keeps its labels.
        expect(await messages((s) => {
            const made = s.add(axes({ x: [0, 4], y: [0, 4], width: 400, height: 300 }).at(-400, 0))
            const copy = made.add(made.numbers.children[0]!.clone().at(60, -80)).children.at(-1)!
            const b = copy.bounds()
            made.add(rect(60, 20, { fill: 'blue', stroke: null }).at(60, -80 + b.height / 2 + 13))
            s.add(made.clone().at(400, 0))
        })).toEqual([0, 1].map(() => expect.stringMatching(/^Text "\S+" is 3 px from a filled shape of a pair of axes below it\. Leave 6 px or more\.$/)))
        // A copy of a node that a dynamic drawing made is not a part of that drawing.
        const built = rect(10, 10, { fill: 'blue', stroke: null })
        const drawn = await film((s) => { s.add(dynamic(() => built)); s.wait(1) }).compile({})
        drawn.frame(0.5)
        expect(built.drawer).not.toBeNull()
        expect(built.clone().drawer).toBeNull()
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

// The CLI has its own copy of the engine, and a film imports the copy of the package. So what the check
// needs from a frame must be on the nodes, and not in a variable of a module.
describe.skipIf(!existsSync(resolve('dist/cli.js')))('built CLI', () => {
    it('knows the object that drew a dynamic label, in a film that imports another copy of the engine', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'film.ts'), `import { axes3d, connector, film, numberLine, rect, scene3d } from 'vizmatic/stage'
export default film({ title: 'Two copies' }, (s) => {
    s.add(scene3d({}).at(-500, 0)).add(axes3d({ numbers: true }))
    const at = s.value(3)
    s.add(numberLine({ range: [0, 10], length: 700 }).at(400, 300)).marker(() => at.value, { label: 'x_0', labelSize: 40, radius: 14 })
    const from = s.add(rect(100, 60, { stroke: 'blue' }).at(100, -300)), to = s.add(rect(100, 60, { stroke: 'blue' }).at(700, -300))
    s.add(connector(from, to, { label: 'publish', labelSize: 26 }))
    s.wait(1)
})
`)
        const result = spawnSync(process.execPath, [resolve('dist/cli.js'), 'check', 'film.ts', '--text-gap', '0.3', '--json'], { cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH } })
        expect(result.status, result.stderr).toBe(0)
        expect(JSON.parse(result.stdout).files[0].diagnostics).toEqual([])
    }, 60_000)

    it('names an object of the library in a message when the engine is minified', async () => {
        // A minifier changes the name of each class to one or two letters. The browser build is minified.
        const directory = await tempDirectory()
        await mkdir(join(directory, 'dist'))
        await symlink(resolve('assets'), join(directory, 'assets'))
        const engine = join(directory, 'dist', 'stage.min.mjs')
        await build({
            entryPoints: [resolve('dist/stage.js')], bundle: true, minify: true, format: 'esm', platform: 'node', target: 'node20', outfile: engine, logLevel: 'silent',
            banner: { js: "import { createRequire as vizmaticRequire } from 'node:module'; const require = vizmaticRequire(import.meta.url);" },
        })
        const file = join(directory, 'run.mjs')
        await writeFile(file, `import * as v from ${JSON.stringify(`file://${engine}`)}
const made = v.film({ fps: 12 }, (s) => {
    const box = s.add(v.card({ title: 'Logs', figure: v.pictogram('logs'), caption: 'one line', width: 300 }).at(-500, 0))
    s.add(v.text('under a card', { size: 28 }).nextTo(box, 'down', 3))
    s.add(v.zone([v.text('guest', { size: 34 })], { title: 'jail', padding: 3 }).at(500, 300))
    s.add(v.connector(s.add(v.rect(100, 60, { stroke: 'blue' }).at(100, -300)), s.add(v.rect(100, 60, { stroke: 'blue' }).at(700, -300)), { route: 'straight' }))
    s.add(v.text('note', { size: 30 }).at(400, 0).alignTo([400, -296], 'top'))
    s.wait(0.5)
})
const report = await v.checkFilm(made, { textGap: 0.3 })
console.log(JSON.stringify(report.diagnostics.map((entry) => entry.message)))
`)
        const result = spawnSync(process.execPath, [file], { encoding: 'utf8', env: { PATH: process.env.PATH } })
        expect(result.status, result.stderr).toBe(0)
        const messages = JSON.parse(result.stdout) as string[]
        expect(messages.map((message) => / of (an? [a-z]+) (above|below|left of|right of) it/.exec(message)?.[1]).sort()).toEqual(['a card', 'a connector', 'a zone'])
    }, 60_000)
})

describe('film check: small text', () => {
    const messages = async (build: (s: Parameters<Parameters<typeof film>[1]>[0]) => void, options: { textSize?: number; times?: number[] } = { textSize: 26 }, size: { width?: number; height?: number } = {}) =>
        (await checkFilm(film({ fps: 10, ...size }, (s) => { build(s); s.wait(1) }), options)).diagnostics.map((entry) => `${entry.code}: ${entry.message}`)

    it('reports text under a size on the screen, when the rule is on', async () => {
        const caption = (size: number, options?: { textSize?: number }) => checkFilm(film({ fps: 10 }, (s) => { s.add(text('caption', { size })); s.wait(1) }), options ?? { textSize: 26 })
        const small = await caption(20)
        expect(small.ok).toBe(true)
        expect(small.diagnostics).toMatchObject([{ code: 'film.text_small', severity: 'warning', text: 'caption', message: 'Text "caption" is 20 px on the screen, and the least size is 26 px. Give it a larger size.' }])
        expect((await caption(25.9)).diagnostics).toMatchObject([{ code: 'film.text_small' }])
        expect((await caption(26)).diagnostics).toEqual([])
        // The rule is off by default, and 0 turns it off.
        expect((await caption(20, {})).diagnostics).toEqual([])
        expect((await caption(20, { textSize: 0 })).diagnostics).toEqual([])
        expect((await caption(30, { textSize: 32 })).diagnostics).toMatchObject([{ message: 'Text "caption" is 30 px on the screen, and the least size is 32 px. Give it a larger size.' }])
        await expect(caption(20, { textSize: -1 })).rejects.toThrow('checkFilm: textSize is the least size of text in pixels of a frame that is 1080 high, such as 26. 0 turns the rule off')
        await expect(caption(20, { textSize: Number.NaN })).rejects.toThrow('checkFilm: textSize is the least size of text')
    })

    it('measures the size that a viewer sees: with the scale of the node, the zoom of the camera, and the size of the frame', async () => {
        // A text of 40 at half its size is a text of 20.
        expect(await messages((s) => { s.add(text('half', { size: 40 }).scale(0.5)) })).toEqual(['film.text_small: Text "half" is 20 px on the screen, and the least size is 26 px. Give it a larger size.'])
        expect(await messages((s) => { s.add(text('grown', { size: 20 }).scale(1.3)) })).toEqual([])
        // A group that is smaller makes its text smaller.
        expect(await messages((s) => { s.add(group(text('in a group', { size: 30 })).scale(0.8)) })).toEqual(['film.text_small: Text "in a group" is 24 px on the screen, and the least size is 26 px. Give it a larger size.'])
        // The camera comes nearer: the text of 20 is 30 on the screen.
        const zoomed = (factor: number) => messages((s) => {
            s.add(text('far', { size: 20 }))
            s.play(to(s.camera, (camera) => camera.set('sx', factor).set('sy', factor), { duration: 0.2 }))
        }, { textSize: 26, times: [0.6] })
        expect(await zoomed(1.5)).toEqual([])
        expect(await zoomed(1)).toEqual(['film.text_small: Text "far" is 20 px on the screen, and the least size is 26 px. Give it a larger size.'])
        // The size is for a frame that is 1080 high. In a frame of 1280 by 720, it is 17.3 px.
        expect(await messages((s) => { s.add(text('small frame', { size: 18 })) }, { textSize: 26 }, { width: 1280, height: 720 })).toEqual([])
        expect(await messages((s) => { s.add(text('small frame', { size: 17 })) }, { textSize: 26 }, { width: 1280, height: 720 })).toEqual(['film.text_small: Text "small frame" is 17 px on the screen, and the least size is 17.3 px. Give it a larger size.'])
        // A formula has the size of its letters. An index is smaller on purpose.
        expect(await messages((s) => { s.add(tex('x_1^2', { size: 30 })) })).toEqual([])
        expect(await messages((s) => { s.add(tex('x_1^2', { size: 24 })) })).toEqual(['film.text_small: Text "x_1^2" is 24 px on the screen, and the least size is 26 px. Give it a larger size.'])
    })

    it('puts the texts of one size in one finding, with the time of the first one and of the last one', async () => {
        const report = await checkFilm(film({ fps: 10 }, (s) => {
            'abcdefg'.split('').forEach((letter, index) => s.add(text(`word ${letter}`, { size: 22 }).at(-750 + index * 250, -200)))
            s.add(text('note', { size: 18 }).at(0, 200))
            s.wait(1)
            s.add(text('late', { size: 22 }).at(0, 0))
            s.wait(1)
        }), { textSize: 26, times: [0.5, 1.5] })
        expect(report.diagnostics.map((entry) => [entry.message, entry.time, entry.until, entry.text])).toEqual([
            ['8 texts are 22 px on the screen, and the least size is 26 px: "word a", "word b", "word c", "word d", "word e" and 3 more. Give them a larger size.', 0.5, 1.5, 'word a'],
            ['Text "note" is 18 px on the screen, and the least size is 26 px. Give it a larger size.', 0.5, 1.5, 'note'],
        ])
        expect(report.summary).toEqual({ errors: 0, warnings: 2 })
    })

    it('ignores a scale entrance at automatic samples, but checks an explicit picture', async () => {
        const entrance = film((s) => {
            const label = s.add(group(tex('x_1^2', { size: 40 })).scale(0.1))
            s.play(to(label, (node) => node.scale(10), { duration: 1, ease: linear }))
            s.wait(1)
        })
        const small = (report: Awaited<ReturnType<typeof checkFilm>>) => report.diagnostics.filter((entry) => entry.code === 'film.text_small')
        expect(small(await checkFilm(entrance, { textSize: 26, samples: 12 }))).toEqual([])
        expect(small(await checkFilm(entrance, { textSize: 26, times: [0.25] }))).toMatchObject([{ text: 'x_1^2', message: expect.stringContaining('13 px') }])
        expect(await messages((s) => { s.add(group(tex('x_1^2', { size: 40 })).scale(0.5)) })).toEqual(['film.text_small: Text "x_1^2" is 20 px on the screen, and the least size is 26 px. Give it a larger size.'])
    })

    it('ignores small text hidden by a later opaque shape', async () => {
        const covered = (opacity: number, partial = false) => messages((s) => {
            s.add(group(tex('x_1^2', { size: 40 }), text('hidden', { size: 40 }).at(0, 100)).scale(0.5))
            s.add(rect(partial ? 4 : 1920, 1080, { fill: 'blue', stroke: null }).opacity(opacity))
        })
        expect(await covered(1)).toEqual([])
        expect((await covered(0.5)).filter((message) => message.startsWith('film.text_small'))).toHaveLength(1)
        expect((await covered(1, true)).filter((message) => message.startsWith('film.text_small'))).toHaveLength(1)
        expect(await messages((s) => {
            s.add(text('x', { size: 20 }).at(-90, -90))
            s.add(rect(200, 200, { radius: 40, fill: 'blue', stroke: null }))
        })).toEqual(['film.text_small: Text "x" is 20 px on the screen, and the least size is 26 px. Give it a larger size.'])
    })

    it('sees the labels of an object, and puts the labels of one object in one finding with the name of the object', async () => {
        const bars = [{ label: 'alpha', value: 2 }, { label: 'beta', value: 3 }]
        // The labels of a bar chart are 20 px by default.
        expect(await messages((s) => { s.add(barChart(bars)) })).toEqual(['film.text_small: 4 labels of a bar chart are under 26 px on the screen, the smallest at 20 px: "alpha", "beta", "2", "3". Give the object a larger size for its labels.'])
        expect(await messages((s) => { s.add(barChart(bars, { labelSize: 26 })) })).toEqual([])
        // Two objects are two findings.
        expect(await messages((s) => { s.add(barChart(bars).at(-500, 0)); s.add(barChart(bars).at(500, 0)) })).toHaveLength(2)
        expect(await messages((s) => { s.add(connector(s.add(rect(100, 60, { stroke: 'blue' }).at(-300, 0)), s.add(rect(100, 60, { stroke: 'blue' }).at(300, 0)), { label: 'publish' })) }))
            .toEqual(['film.text_small: The label "publish" of a connector is 12 px on the screen, and the least size is 26 px. Give the object a larger size for its labels.'])
        expect(await messages((s) => { s.add(legend([{ label: 'read', color: 'blue', kind: 'line' }, { label: 'write', color: 'red', kind: 'line' }])) }))
            .toEqual(['film.text_small: 2 labels of a legend are under 26 px on the screen, the smallest at 13 px: "read", "write". Give the object a larger size for its labels.'])
        // The title and the note of a terminal are 0.8 of the size of its lines.
        expect(await messages((s) => { s.add(terminal(['one line'], { title: 'runs/one.txt', note: 'Linux 7.0' })) }))
            .toEqual(['film.text_small: 2 labels of a terminal are under 26 px on the screen, the smallest at 20.8 px: "runs/one.txt", "Linux 7.0". Give the object a larger size for its labels.'])
        // A text that the film puts on an object is a text of the film.
        expect(await messages((s) => { s.add(barChart(bars, { labelSize: 30 })); s.add(text('n = 5', { size: 20 }).at(0, -300)) })).toEqual(['film.text_small: Text "n = 5" is 20 px on the screen, and the least size is 26 px. Give it a larger size.'])
    })
})

describe('film check: empty space', () => {
    // A frame of 1920 by 1080 is a grid of 16 by 9 cells of 120 px. This picture is in 4 by 2 cells at the top left.
    const corner = () => rect(400, 180, { fill: 'blue', stroke: null }).at(-700, -420)
    const found = async (build: (s: Parameters<Parameters<typeof film>[1]>[0]) => void, emptySpace = 0.5) =>
        (await checkFilm(film({ fps: 10 }, build), { emptySpace })).diagnostics.map((entry) => `${entry.code} ${entry.time}-${entry.until}: ${entry.message}`)

    it('reports a part of the frame that stays empty for 4 seconds or more, when the rule is on', async () => {
        const report = await checkFilm(film({ fps: 10 }, (s) => { s.add(corner()); s.wait(6) }), { emptySpace: 0.5 })
        expect(report.ok).toBe(true)
        expect(report.diagnostics).toEqual([{
            code: 'film.empty_space', severity: 'warning', time: 0.5, until: 5.5,
            message: 'For 5 s, 78% of the frame stays empty in one piece: the bottom 78% of the height. The limit is 50%. Make the picture larger, or use that part for what the picture explains.',
            box: { x: 0, y: 240, width: 1920, height: 840 }, stage: { x: 0, y: 120 }, motion: { spans: 1, seconds: 5 },
        }])
        // The rule is off by default, and 0 turns it off.
        expect((await checkFilm(film({ fps: 10 }, (s) => { s.add(corner()); s.wait(6) }))).diagnostics).toEqual([])
        expect(await found((s) => { s.add(corner()); s.wait(6) }, 0)).toEqual([])
        // A limit above the part that is empty reports nothing.
        expect(await found((s) => { s.add(corner()); s.wait(6) }, 0.8)).toEqual([])
        // The looks are half a second apart, from 0.5 to 4.5 in a film of 5 seconds: that is 4 seconds.
        expect(await found((s) => { s.add(corner()); s.wait(5) })).toHaveLength(1)
        expect(await found((s) => { s.add(corner()); s.wait(4.5) })).toEqual([])
        await expect(found((s) => { s.add(corner()); s.wait(6) }, 1)).rejects.toThrow('checkFilm: emptySpace is the largest part of the frame that may stay empty in one piece, from 0 to 1, such as 0.5. 0 turns the rule off')
        await expect(found((s) => { s.add(corner()); s.wait(6) }, -0.1)).rejects.toThrow('checkFilm: emptySpace is the largest part of the frame')
    })

    it('does not report a picture in the middle of the frame at one half, however small it is', async () => {
        const title = (s: Parameters<Parameters<typeof film>[1]>[0]) => { s.add(text('One sentence.', { size: 60 })); s.wait(8) }
        expect(await found(title)).toEqual([])
        expect(await found((s) => { s.add(tex('e^{i\\pi} + 1 = 0', { size: 90 })); s.wait(8) })).toEqual([])
        expect(await found((s) => { s.add(circle(20, { fill: 'blue' })); s.wait(8) })).toEqual([])
        // A lower limit reports it: 4 of the 9 rows above the sentence are empty.
        expect(await found(title, 0.4)).toEqual(['film.empty_space 0.5-7.5: For 7 s, 44% of the frame stays empty in one piece: the top 44% of the height. The limit is 40%. Make the picture larger, or use that part for what the picture explains.'])
    })

    it('treats a solid full-frame fill as a backdrop, including overscan and later covers', async () => {
        const plain = await found((s) => { s.add(corner()); s.wait(6) })
        for (const size of [[1920, 1080], [2200, 1300]]) {
            expect(await found((s) => {
                s.add(rect(size[0], size[1], { fill: '#ffffff', stroke: null }))
                s.add(corner())
                s.wait(6)
            })).toEqual(plain)
        }
        expect(await found((s) => {
            s.add(text('A centered title', { size: 60 }))
            s.add(rect(1920, 1080, { fill: '#ffffff', stroke: null }))
            s.add(corner())
            s.wait(6)
        })).toEqual(plain)
        expect(await found((s) => {
            s.add(rect(1920, 1080, { fill: '#ffffff', stroke: null }))
            s.add(text('A centered title', { size: 60 }))
            s.wait(6)
        })).toEqual([])
    })

    it('counts the visible part of a transparent PNG, with crop and rotation', async () => {
        const width = 160, height = 90, data = new Uint8Array(width * height * 4)
        for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) {
            data.set([70, 130, 255, 255], (y * width + x) * 4)
        }
        const png = `data:image/png;base64,${Buffer.from(encode({ width, height, depth: 8, channels: 4, data })).toString('base64')}`
        const asset = await resolveImageAsset(png)
        expect(await found((s) => { s.add(image(png, { width: 1920, height: 1080 })); s.wait(6) })).toMatchObject([expect.stringContaining('film.empty_space')])
        expect(await found((s) => { s.add(image(png, { width: 1920, height: 1080 }).rotate(Math.PI)); s.wait(6) })).toMatchObject([expect.stringContaining('film.empty_space')])
        expect(await found((s) => {
            s.add(image(asset, { width: 1920, height: 1080, crop: { x: 80, y: 0, width: 80, height: 90 } }))
            s.wait(6)
        })).toMatchObject([expect.stringContaining('100% of the frame')])
        expect(await found((s) => {
            s.add(image(asset, { width: 1920, height: 1080, crop: { x: 0, y: 0, width: 40, height: 20 }, fit: 'cover' }))
            s.wait(6)
        })).toEqual([])
    })

    it('finds a sustained empty rectangle after earlier content leaves it', async () => {
        const report = await checkFilm(film((s) => {
            const top = s.add(rect(1920, 220, { fill: 'blue', stroke: null }).at(0, -430))
            s.wait(1)
            s.remove(top)
            const left = s.add(rect(340, 1080, { fill: 'blue', stroke: null }).at(-790, 0))
            s.wait(3)
            s.remove(left)
            s.add(rect(1920, 220, { fill: 'blue', stroke: null }).at(0, 430))
            s.wait(3)
        }), { emptySpace: 0.5 })
        expect(report.diagnostics.filter((entry) => entry.code === 'film.empty_space')).toMatchObject([
            { time: 1, until: 6.5, box: { x: 360, y: 0, width: 1560, height: 840 } },
        ])
    })

    it('supports a shorter window and includes the final fractional sample', async () => {
        const short = film((s) => { s.add(corner()); s.wait(3.4) })
        const spaces = (report: Awaited<ReturnType<typeof checkFilm>>) => report.diagnostics.filter((entry) => entry.code === 'film.empty_space')
        expect(spaces(await checkFilm(short, { emptySpace: 0.5 }))).toEqual([])
        expect(spaces(await checkFilm(short, { emptySpace: 0.5, emptySeconds: 2 }))).toMatchObject([{ time: 0.5, until: 2.9 }])
        expect(spaces(await checkFilm(short, { emptySpace: 0.5, emptySeconds: 2.2 }))).toMatchObject([{ time: 0.5, until: 2.9 }])
        expect(spaces(await checkFilm(short, { emptySpace: 0.5, emptySeconds: 2.5 }))).toEqual([])
        for (const emptySeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            await expect(checkFilm(short, { emptySpace: 0.5, emptySeconds })).rejects.toThrow('checkFilm: emptySeconds')
        }
    })

    it('does not report a picture that a scene builds in steps of under 4 seconds', async () => {
        const rows = (pause: number) => found((s) => {
            for (let row = 0; row < 4; row++) {
                s.add(rect(1600, 150, { fill: 'blue', stroke: null }).at(0, -390 + row * 260))
                s.wait(pause)
            }
        })
        // The first row is alone for 3 seconds, then the second row comes: more than a half is empty for 3 seconds.
        expect(await rows(3)).toEqual([])
        // With a row every 5 seconds, the first row is alone for too long.
        expect(await rows(5)).toEqual(['film.empty_space 0.5-4.5: For 4 s, 78% of the frame stays empty in one piece: the bottom 78% of the height. The limit is 50%. Make the picture larger, or use that part for what the picture explains.'])
    })

    it('reports the part that stays empty, and not a picture that uses two parts of the frame in turn', async () => {
        const side = (x: number) => rect(700, 900, { fill: 'blue', stroke: null }).at(x, 0)
        // The left half for 3 seconds, then the right half for 3 seconds: a half is empty at each moment, and no part stays empty.
        expect(await found((s) => {
            const left = s.add(side(-480))
            s.wait(3)
            s.remove(left)
            s.add(side(480))
            s.wait(3)
        }, 0.4)).toEqual([])
        // The same picture for 6 seconds on one side.
        expect(await found((s) => { s.add(side(-480)); s.wait(6) }, 0.4)).toEqual(['film.empty_space 0.5-5.5: For 5 s, 56% of the frame stays empty in one piece: the right 56% of the width. The limit is 40%. Make the picture larger, or use that part for what the picture explains.'])
        // The part that the message names is empty for the whole time: here the corner that neither picture uses.
        expect(await found((s) => {
            const first = s.add(rect(1800, 300, { fill: 'blue', stroke: null }).at(0, -380))
            s.wait(3)
            s.remove(first)
            s.add(rect(500, 1000, { fill: 'blue', stroke: null }).at(-700, 0))
            s.wait(3)
        }, 0.3)).toEqual(['film.empty_space 0.5-5.5: For 5 s, 46% of the frame stays empty in one piece: a part at the bottom right, 1320 by 720 pixels. The limit is 30%. Make the picture larger, or use that part for what the picture explains.'])
    })

    it('counts what a viewer can tell from the background: a text, an image, a line and a shape, and not a faint mark', async () => {
        const withMark = (mark: () => Node) => found((s) => { s.add(corner()); s.add(mark()); s.wait(6) })
        // Each of these is in the middle of the frame, so no part of more than a half stays empty.
        expect(await withMark(() => text('a caption', { size: 40 }).at(0, 30))).toEqual([])
        expect(await withMark(() => line([-100, 30], [100, 30], { stroke: 'ink', width: 4 }))).toEqual([])
        expect(await withMark(() => rect(200, 100, { stroke: 'blue', fill: null }).at(0, 30))).toEqual([])
        expect(await withMark(() => circle(60, { fill: 'red', stroke: null }).at(0, 30))).toEqual([])
        // A panel in the color of the surface, a text that is nearly gone, and a faint line are not content.
        expect(await withMark(() => rect(1800, 700, { fill: 'surface', stroke: null }).at(0, 150))).toHaveLength(1)
        expect(await withMark(() => text('a caption', { size: 40 }).at(0, 30).opacity(0.1))).toHaveLength(1)
        expect(await withMark(() => line([-100, 30], [100, 30], { stroke: 'ink', width: 4 }).opacity(0.1))).toHaveLength(1)
        // A large outline is content where its line is, and not inside it: a frame around an empty stage is an empty stage.
        expect(await found((s) => { s.add(rect(1800, 1000, { stroke: 'blue', fill: null })); s.wait(6) })).toEqual(['film.empty_space 0.5-5.5: For 5 s, 68% of the frame stays empty in one piece: a part in the middle, 1680 by 840 pixels. The limit is 50%. Make the picture larger, or use that part for what the picture explains.'])
        // A filled shape is content inside too.
        expect(await found((s) => { s.add(rect(1800, 1000, { fill: 'blue', stroke: null })); s.wait(6) })).toEqual([])
    })
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
