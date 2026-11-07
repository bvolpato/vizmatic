import { describe, expect, it } from 'vitest'
import { captionLines, circle, compileFilm, fadeIn, film, image, narration, point3d, scene3d, surface, trail3d, vector3d, type ImageOp, type NarrationTiming, type PathOp } from '../src/stage/index'
import { captionsToSrt, chapterMetadata } from '../src/video'

const timing: NarrationTiming = {
    scenes: [
        {
            id: 'intro', title: 'The problem', beats: [
                { say: 'Latency climbs. Should we page?', duration: 3, hold: 1, words: [{ text: 'Latency', start: 0.2, end: 0.7 }, { text: 'climbs.', start: 0.7, end: 1.2 }, { text: 'Should', start: 1.8, end: 2.1 }, { text: 'we', start: 2.1, end: 2.2 }, { text: 'page?', start: 2.2, end: 2.8 }] },
                { say: 'Qwen 27B decides.', duration: 2, words: [{ text: 'Qwen', start: 0.1, end: 0.5 }, { text: 'twenty seven B', start: 0.5, end: 1.3 }, { text: 'decides.', start: 1.3, end: 1.9 }] },
            ],
        },
        { id: 'model', title: 'The model', beats: [{ say: 'One pass.', duration: 1.5, hold: 0.5, words: [{ text: 'One', start: 0.1, end: 0.4 }, { text: 'pass.', start: 0.4, end: 1 }] }] },
    ],
}

describe('narration', () => {
    it('places beats after the lead, with holds inside a scene and a gap between scenes', async () => {
        let scenes: { id: string; start: number; end: number }[] = []
        let duration = 0
        const compiled = await compileFilm(film({ fps: 10 }, (s) => {
            const voice = narration(s, timing, { lead: 2, gap: 0.5 })
            scenes = voice.scenes.map((scene) => ({ id: scene.id, start: scene.start, end: scene.end }))
            duration = voice.duration
            expect(voice.scene('intro').beats[1]).toMatchObject({ start: 6, end: 8, until: 8 })
            expect(voice.placements().map((placed) => placed.start)).toEqual([2, 6, 8.5])
        }))
        expect(scenes).toEqual([{ id: 'intro', start: 2, end: 8 }, { id: 'model', start: 8.5, end: 10.5 }])
        expect(duration).toBe(10.5)
        // The film lasts until the voice ends, even with nothing on screen.
        expect(compiled.duration).toBeCloseTo(10.5, 6)
    })

    it('finds a spoken phrase, ignores case and punctuation, and reads a word that holds several tokens', async () => {
        await compileFilm(film({ fps: 10 }, (s) => {
            const scene = narration(s, timing, { lead: 2 }).scene('intro')
            expect(scene.cue('should we PAGE')).toEqual({ start: 3.8, end: 4.8 })
            expect(scene.cue('twenty seven')).toEqual({ start: 6.5, end: 7.3 })
            expect(scene.cue('decides', 1).start).toBeCloseTo(7.3, 6)
        }))
    })

    it('stops the build when the voice does not say the phrase', async () => {
        await expect(compileFilm(film({ fps: 10 }, (s) => {
            narration(s, timing).scene('intro').on('we roll back', () => {})
        }))).rejects.toThrow('scene "intro": the voice never says "we roll back"')
        await expect(compileFilm(film({ fps: 10 }, (s) => {
            narration(s, timing).scene('intro').cue('page', 1)
        }))).rejects.toThrow('never says "page" in beat 1')
        await expect(compileFilm(film({ fps: 10 }, (s) => {
            narration(s, timing).scene('outro')
        }))).rejects.toThrow('no scene "outro". The scenes are: intro, model')
    })

    it('builds on a phrase at the time the voice reaches it', async () => {
        const compiled = await compileFilm(film({ fps: 10 }, (s) => {
            const scene = narration(s, timing, { lead: 2 }).scene('intro')
            scene.on('page', () => s.play(fadeIn(circle(50)), { duration: 0.5 }), -0.2)
        }))
        expect(compiled.clips.some((clip) => Math.abs(clip.t0 - 4) < 1e-9 && Math.abs(clip.t1 - 4.5) < 1e-9)).toBe(true)
    })

    it('adds a chapter for each titled scene and a caption for each spoken line', async () => {
        const compiled = await compileFilm(film({ fps: 10 }, (s) => {
            narration(s, timing, { lead: 2, gap: 0.5 })
        }))
        // The first chapter covers the opening, so a player's timeline has no gap.
        expect(compiled.chapters).toEqual([{ title: 'The problem', time: 0 }, { title: 'The model', time: 8.5 }])
        expect(compiled.captions.map((cue) => cue.text)).toEqual(['Latency climbs.', 'Should we page?', 'Qwen 27B decides.', 'One pass.'])
        expect(compiled.captions[0]!.t0).toBe(2)
        expect(compiled.captions[1]!.t1).toBeCloseTo(5, 6)
        const quiet = await compileFilm(film({ fps: 10 }, (s) => {
            narration(s, timing, { captions: false, chapters: false })
        }))
        expect(quiet.chapters).toEqual([])
        expect(quiet.captions).toEqual([])
    })

    it('splits captions by sentence and by length, and keeps a decimal number whole', () => {
        expect(captionLines('The network is Qwen 3.8. It runs once.')).toEqual(['The network is Qwen 3.8.', 'It runs once.'])
        expect(captionLines('one two three four five six', 12)).toEqual(['one two', 'three four', 'five six'])
    })
})

describe('chapters and captions in an MP4', () => {
    it('writes chapters that start at zero and end where the next one starts', () => {
        const meta = chapterMetadata('A = B; a film', [{ title: 'Second', time: 4 }, { title: 'First', time: 0.3 }, { title: 'Too late', time: 12 }], 10)
        expect(meta).toContain('title=A \\= B\\; a film')
        expect(meta).toContain('START=0\nEND=4000\ntitle=First')
        expect(meta).toContain('START=4000\nEND=10000\ntitle=Second')
        expect(meta).not.toContain('Too late')
    })

    it('writes captions as SubRip, clipped to the video', () => {
        expect(captionsToSrt([{ t0: 3661.5, t1: 3663, text: 'late' }, { t0: -1, t1: 1.25, text: ' first ' }, { t0: 2, t1: 2, text: 'empty span' }], 3662)).toBe(
            '1\n00:00:00,000 --> 00:00:01,250\nfirst\n\n2\n01:01:01,500 --> 01:01:02,000\nlate\n',
        )
        expect(captionsToSrt([], 10)).toBe('')
    })
})

// A 3 by 2 PNG, enough to carry a size.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP4z8DwH4YZkDkAm34L9XKwuTwAAAAASUVORK5CYII='

describe('image', () => {
    it('reads the size of a PNG data URL and centers the picture', async () => {
        const compiled = await compileFilm(film({ fps: 10 }, (s) => {
            s.add(image(PNG, { width: 300 }).at(100, 50))
            s.wait(1)
        }))
        const op = compiled.frame(0.5).ops.find((entry) => entry.kind === 'image') as ImageOp
        expect(op.image).toMatchObject({ width: 300, height: 200 })
        // The top left corner sits half a picture away from the node's position, in canvas pixels.
        expect(op.matrix[4]).toBeCloseTo(compiled.width / 2 + 100 - 150, 6)
        expect(op.matrix[5]).toBeCloseTo(compiled.height / 2 + 50 - 100, 6)
    })

    it('uses the natural size without options, and asks for a size it cannot read', () => {
        expect(image(PNG)).toMatchObject({ width: 3, height: 2 })
        expect(() => image('https://example.com/logo.webp', { width: 200 })).toThrow('needs both width and height')
        expect(image('https://example.com/logo.webp', { width: 200, height: 80 })).toMatchObject({ width: 200, height: 80 })
    })
})

describe('3D marks on a surface', () => {
    const fills = (ops: readonly unknown[], rgb: readonly [number, number, number]) => (ops as PathOp[]).map((op, index) => ({ op, index })).filter(({ op }) => {
        const fill = op.fill as readonly number[] | null
        return op.kind === 'path' && Array.isArray(fill) && Math.abs(fill[0]! - rgb[0]) < 2 && Math.abs(fill[1]! - rgb[1]) < 2 && Math.abs(fill[2]! - rgb[2]) < 2
    })

    it('draws a biased point and the head of an arrow on top after the surface they rest on', async () => {
        const compiled = await compileFilm(film({ fps: 10 }, (s) => {
            const scene = s.add(scene3d({ fog: 0 }))
            scene.add(surface(() => 0, { resolution: 6, color: '#202020', shaded: false }))
            // Just under the surface: without a bias, the faces would cover both marks.
            scene.add(point3d([0, 0, -0.2], { color: '#ff0000', bias: 100 }))
            scene.add(vector3d([0, 0, -0.2], [1, 0, -0.2], { color: '#00ff00', onTop: true }))
            s.wait(1)
        }))
        const ops = compiled.frame(0.5).ops
        const faces = fills(ops, [32, 32, 32])
        const lastFace = Math.max(...faces.map((entry) => entry.index))
        expect(faces.length).toBe(36)
        expect(fills(ops, [255, 0, 0])[0]!.index).toBeGreaterThan(lastFace)
        expect(fills(ops, [0, 255, 0])[0]!.index).toBeGreaterThan(lastFace)
    })

    it('cuts a trail into pieces along the part where the point moved', async () => {
        const compiled = await compileFilm(film({ fps: 10 }, (s) => {
            const x = s.value(0)
            const scene = s.add(scene3d())
            scene.add(trail3d(() => [x.value, 0, 0], 0, 100, { color: '#ff0000' }))
            // The point waits for most of the trail's life, then moves.
            s.wait(60)
            s.play(x.to(3, { duration: 2, ease: (t: number) => t }))
        }))
        const pieces = (compiled.frame(62).ops as PathOp[]).filter((op) => op.kind === 'path' && op.strokeAlpha > 0)
        // Sixty samples of movement give thirty pieces. Before, the wait took nearly all of them.
        expect(pieces.length).toBeGreaterThanOrEqual(30)
    })
})
