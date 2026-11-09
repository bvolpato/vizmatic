import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { decode } from 'fast-png'
import { dynamic, film, line, linear, shift, tex, text, to, write } from '../src/stage/index'
import { filmEncoderSettings, planRender, posterTime, renderFilmFrame, renderFilmGif, renderFilmSvg, renderFilmVideo, captionsToVtt } from '../src/stage/export'
import { checkFilm, readingSeconds } from '../src/stage/check'
import { compileFilm } from '../src/stage/stage'
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
