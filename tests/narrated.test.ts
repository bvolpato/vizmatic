import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    assertEqual, capHeight, card, checkFilm, chip, chipRow, circle, clamp, commas, compileFilm, fade, fadeIn, fadeOut, film, fitSize, lerp, namedBox, narrated, narration, rect, sceneArea, sceneKit, seededRandom, smoothstep, tag, text, textWidth, valueAt,
    type FilmClock, type NarratedOptions, type Node, type PathOp, type SceneClock, type Stage, type TimingFile,
} from '../src/stage/index'
import { clock } from '../src/stage/track'

const word = (text: string, start: number) => ({ text, start, end: start + 0.3 })
const timing: TimingFile = {
    intro: 1.5, lead: 2, gap: 0.5, tail: 0.75,
    scenes: [
        { id: 'hook', title: 'The question', beats: [{ say: 'Will it run out?', duration: 2, hold: 1, words: [word('Will', 0.1), word('it', 0.5), word('run', 0.9), word('out?', 1.3)] }] },
        { id: 'answer', title: 'The answer', beats: [{ say: 'Not today.', duration: 1.5, words: [word('Not', 0.2), word('today.', 0.7)] }] },
        { id: 'close', beats: [{ say: 'Have a plan.', duration: 1, hold: 0.5, words: [word('Have', 0.1), word('a', 0.4), word('plan.', 0.6)] }] },
    ],
}
const nothing = () => {}
const compile = (options: Omit<NarratedOptions, 'timing'> & { timing?: TimingFile }) => compileFilm(narrated({ fps: 10, timing, ...options }))
/** A property of a node at a time of the film. */
const at = <T>(time: number, read: () => T): T => { const saved = clock.now; clock.now = time; try { return read() } finally { clock.now = saved } }
const opacityAt = (node: Node, time: number) => at(time, () => (node.get('visible') ? node.get('opacity') : 0))
const visiblePaths = (film: Awaited<ReturnType<typeof compile>>, time: number) => film.frame(time).ops.filter((op) => op.kind === 'path' && Math.max((op as PathOp).fillAlpha, (op as PathOp).strokeAlpha) > 0.01).length

afterEach(() => {
    delete process.env['VIZMATIC_SCENES']
    vi.restoreAllMocks()
})

describe('narrated film shell', () => {
    it('runs the title card and then each scene in the order of the script, each with the clock of its id', async () => {
        const calls: string[] = []
        const scene = (name: string) => (_s: Stage, c: SceneClock) => { calls.push(`${name}:${c.id}@${c.start}`) }
        // The film lists its scenes in another order than the script.
        await compile({ intro: () => { calls.push('intro') }, scenes: { close: scene('close'), hook: scene('hook'), answer: scene('answer') } })
        // The hook starts after the lead, and each next scene one gap after the last one ends.
        expect(calls).toEqual(['intro', 'hook:hook@2', 'answer:answer@5.5', 'close:close@7.5'])
    })

    it('stops when the script has a scene that the film does not define', () => {
        expect(() => narrated({ timing, scenes: { hook: nothing, close: nothing } })).toThrow('the script has the scene "answer", and the film does not define it')
    })

    it('stops when the film defines a scene that the script does not have', () => {
        expect(() => narrated({ timing, scenes: { hook: nothing, answer: nothing, close: nothing, outro: nothing } }))
            .toThrow('the film defines the scene "outro", and the timing has no scene with that id. The scenes of the script are: hook, answer, close')
    })

    it('lasts one gap and the tail past the last word, and gives that end to the scenes', async () => {
        let seen: FilmClock | undefined, card: FilmClock | undefined
        const film = await compile({ intro: (_s, clock) => { card = clock }, scenes: { hook: nothing, answer: nothing, close: (_s, _c, clock) => { seen = clock } } })
        // The last word ends at 9 seconds: 7.5 for the start of the last scene, 1 of voice and 0.5 of hold.
        expect(film.duration).toBeCloseTo(9 + 0.5 + 0.75, 6)
        expect(seen).toEqual({ intro: 1.5, gap: 0.5, tail: 0.75, end: 10.25 })
        // The title card gets the same clock, so it knows how long it has.
        expect(card).toEqual(seen)
        // Without a tail in the timing, the film still keeps the gap after the last word.
        const { tail: _tail, ...noTail } = timing
        expect((await compile({ timing: noTail, scenes: { hook: nothing, answer: nothing, close: nothing } })).duration).toBeCloseTo(9.5, 6)
    })

    it('adds the chapters and the captions of the narration, and takes its options', async () => {
        const scenes = { hook: nothing, answer: nothing, close: nothing }
        const film = await compile({ title: 'Capacity', scenes })
        expect(film.title).toBe('Capacity')
        expect(film.chapters).toEqual([{ title: 'The question', time: 0 }, { title: 'The answer', time: 5.5 }])
        expect(film.captions.map((caption) => caption.text)).toEqual(['Will it run out?', 'Not today.', 'Have a plan.'])
        const plain = await compile({ scenes, narration: { chapters: false, captions: false } })
        expect(plain.chapters).toEqual([])
        expect(plain.captions).toEqual([])
    })

    it('passes the options of film() through: the bloom, the bleed, the frame rate and the description', async () => {
        const scenes = { hook: nothing, answer: nothing, close: nothing }
        const film = await compileFilm(narrated({ timing, scenes, title: 'Capacity', description: 'Will it run out?', bloom: 0.5, bleed: true, fps: 24, poster: 3 }))
        expect(film).toMatchObject({ title: 'Capacity', description: 'Will it run out?', bloom: 0.5, bleed: true, fps: 24, posterTime: 3 })
        const plain = await compileFilm(narrated({ timing, scenes }))
        expect(plain.bloom).not.toBe(0.5)
        expect(plain.bleed).toBe(false)
    })

    it('names the scene in the error of a scene that throws', async () => {
        const scenes = { hook: nothing, answer: () => { throw new TypeError('the bar has no length') }, close: nothing }
        await expect(compile({ scenes })).rejects.toThrow('narrated: scene "answer": the bar has no length')
        await expect(compile({ scenes })).rejects.toBeInstanceOf(TypeError)
        // A cue that the voice does not say names its scene already, one time.
        const cue = compile({ scenes: { hook: (_s, c) => { c.on('never said', nothing) }, answer: nothing, close: nothing } })
        await expect(cue).rejects.toThrow(/^narration: scene "hook": the voice never says "never said"$/)
    })

    it('refuses a timing with no scene, a scene with no beat, and a scene that is not a function', () => {
        const scenes = { hook: nothing, answer: nothing, close: nothing }
        expect(() => narrated({ timing: { scenes: [] }, scenes: {} })).toThrow('narrated: the timing has no scene, so the film has no voice to follow')
        expect(() => narrated({ timing: {} as TimingFile, scenes: {} })).toThrow('narrated: the timing has no scene')
        expect(() => narrated({ timing: { ...timing, scenes: [timing.scenes[0]!, { id: 'answer', beats: [] }, timing.scenes[2]!] }, scenes })).toThrow('narrated: the scene "answer" of the timing has no beat')
        expect(() => narrated({ timing, scenes: { ...scenes, answer: 5 as never } })).toThrow('narrated: the scene "answer" of the film is not a function')
    })

    it('does not take a name that every object has for a scene of the film', () => {
        // The script has a scene named as a method of every object. The film must still define it.
        const odd: TimingFile = { ...timing, scenes: [{ ...timing.scenes[0]!, id: 'toString' }] }
        expect(() => narrated({ timing: odd, scenes: {} })).toThrow('the script has the scene "toString", and the film does not define it')
    })

    it('builds only the scenes that a draft asks for, at their times in the whole film, without the title card', async () => {
        vi.spyOn(console, 'warn').mockImplementation(nothing)
        const calls: string[] = []
        const scene = (s: Stage, c: SceneClock) => { calls.push(`${c.id}@${c.start}, opens at ${s.time.toFixed(2)}`) }
        const scenes = { hook: scene, answer: scene, close: scene }
        process.env['VIZMATIC_SCENES'] = 'close,answer'
        const film = await compile({ intro: () => { calls.push('intro') }, scenes })
        expect(calls).toEqual(['answer@5.5, opens at 4.95', 'close@7.5, opens at 6.95'])
        expect(film.duration).toBeCloseTo(10.25, 6)
        // The first scene alone opens where it opens in the whole film: when the title card is gone.
        calls.length = 0
        process.env['VIZMATIC_SCENES'] = 'hook'
        await compile({ title: 'Capacity', scenes })
        expect(calls).toEqual(['hook@2, opens at 1.45'])
        process.env['VIZMATIC_SCENES'] = 'clsoe'
        expect(() => narrated({ timing, scenes })).toThrow('VIZMATIC_SCENES names the scene "clsoe", and the script has no scene with that id')
    })

    it('has no way to ask for a part of the film in the film file, so a film that is built without a draft is whole', async () => {
        const said = vi.spyOn(console, 'warn').mockImplementation(nothing)
        const scenes = { hook: nothing, answer: nothing, close: nothing }
        expect(() => narrated({ timing, scenes, only: ['close'] } as never)).toThrow('narrated: "only" is not an option. A film file always holds every scene. For a movie of some scenes, build a draft: vizmatic narrated build <folder> --draft --scene <id>')
        expect(() => narrated({ timing, scenes, only: [] } as never)).toThrow('"only" is not an option')
        narrated({ timing, scenes })
        expect(said).not.toHaveBeenCalled()
        // A partial film says so in one line, so that it never passes for the whole film.
        process.env['VIZMATIC_SCENES'] = 'close, answer'
        narrated({ timing, scenes })
        expect(said).toHaveBeenCalledTimes(1)
        expect(said).toHaveBeenLastCalledWith('narrated: only the scene "answer", "close" is built, without the title card, because VIZMATIC_SCENES is set. This is not the whole film.')
    })

    it('stops when the title card is longer than the silence before the first word', async () => {
        await expect(compile({ timing: { ...timing, intro: 2.5 }, scenes: { hook: nothing, answer: nothing, close: nothing } }))
            .rejects.toThrow('the intro is 2.5 seconds and the first word starts at 2 seconds')
        expect(() => narrated({ timing: { ...timing, tail: -1 }, scenes: { hook: nothing, answer: nothing, close: nothing } })).toThrow('intro and tail must be zero or more seconds')
        expect(() => narrated({ timing: { ...timing, intro: -1 }, scenes: { hook: nothing, answer: nothing, close: nothing } })).toThrow('intro and tail must be zero or more seconds')
    })
})

describe('what the shell does for every film', () => {
    const scenes = { hook: nothing, answer: nothing, close: nothing }
    const glyphs = (film: Awaited<ReturnType<typeof compile>>, time: number) => visiblePaths(film, time)

    it('draws the title card from the title of the film, and takes it away before the first scene', async () => {
        // The title card has the first 1.5 seconds, and the first word is at 2.
        const film = await compile({ title: 'Capacity', scenes })
        expect(glyphs(film, 0)).toBe(0)
        expect(glyphs(film, 0.8)).toBe('Capacity'.length)
        expect(glyphs(film, 1.52)).toBe(0)
        // The card comes in and goes out with a fade.
        const alpha = (time: number) => Math.max(...film.frame(time).ops.map((op) => (op as PathOp).fillAlpha ?? 0))
        expect(alpha(0.3)).toBeGreaterThan(0)
        expect(alpha(0.3)).toBeLessThan(1)
        expect(alpha(0.8)).toBe(1)
        expect(alpha(1.4)).toBeLessThan(1)
        // Without a title there is no card, and a timing with no time for a card has none: a card of the film is not called.
        expect(glyphs(await compile({ scenes }), 0.8)).toBe(0)
        expect(glyphs(await compile({ title: 'Capacity', scenes, timing: { ...timing, intro: 0 } }), 0.8)).toBe(0)
        let called = false
        await compile({ intro: () => { called = true }, scenes, timing: { ...timing, intro: 0 } })
        expect(called).toBe(false)
    })

    it('takes other words for the card, a card of the film, or no card', async () => {
        const words = await compile({ title: 'Will the disks run out? A study of capacity', intro: { title: 'Capacity', subtitle: 'in three scenes' }, scenes })
        expect(glyphs(words, 0.8)).toBe('Capacityinthreescenes'.length)
        const none = await compile({ title: 'Capacity', intro: false, scenes })
        expect(glyphs(none, 0.8)).toBe(0)
        // A card of the film: what it adds comes in at the start, and leaves before the story starts, as the card of the shell does.
        const ring = circle(40)
        let seen: FilmClock | undefined
        const own = await compile({ title: 'Capacity', intro: (s, film) => { seen = film; s.add(ring) }, scenes })
        expect(seen).toMatchObject({ intro: 1.5 })
        expect(glyphs(own, 0.8)).toBe(1)
        expect(opacityAt(ring, 0.8)).toBe(1)
        expect(opacityAt(ring, 1.4)).toBeLessThan(1)
        expect(opacityAt(ring, 1.5)).toBe(0)
        // A long title is set smaller, and then wraps, so that it stays inside the frame.
        const long = await compile({ title: 'A title that is much longer than the frame is wide at the size of a short title, and then longer', scenes })
        expect(glyphs(long, 0.8)).toBeGreaterThan(60)
        expect((await checkFilm(long, { times: [0.8] })).diagnostics).toEqual([])
    })

    it('calls each scene at the moment that its picture opens, and fades in what the scene adds there', async () => {
        const opened: Record<string, number> = {}
        const rings = { hook: circle(40), answer: circle(40) }
        await compile({ title: 'Capacity', scenes: {
            hook: (s) => { opened['hook'] = s.time; s.add(rings.hook) },
            answer: (s) => { opened['answer'] = s.time; s.add(rings.answer) },
            close: (s) => { opened['close'] = s.time },
        } })
        // The first scene opens when the title card is gone, at 1.5. The answer starts at 5.5 after a gap of 0.5, so
        // the hook is gone at 5. Each picture opens 0.05 seconds before that, with a fade of a quarter of a second.
        expect(opened['hook']).toBeCloseTo(1.45, 6)
        expect(opened['answer']).toBeCloseTo(4.95, 6)
        expect(opened['close']).toBeCloseTo(6.95, 6)
        expect(opacityAt(rings.answer, 4.9)).toBe(0)
        expect(opacityAt(rings.answer, 5.05)).toBeGreaterThan(0)
        expect(opacityAt(rings.answer, 5.05)).toBeLessThan(1)
        expect(opacityAt(rings.answer, 5.2)).toBe(1)
        // Without a title card, the first scene opens with the film.
        await compile({ scenes: { ...scenes, hook: (s) => { opened['hook'] = s.time } } })
        expect(opened['hook']).toBe(0)
    })

    it('leaves alone a node that the scene fades in itself, and a node that comes on a later word', async () => {
        const own = circle(40), later = circle(40)
        await compile({ scenes: { ...scenes, answer: (s, c) => {
            s.play(fadeIn(own, { duration: 1 }))
            c.on('today', () => s.play(fadeIn(later, { duration: 0.2 })))
        } } })
        // The scene opens at 4.95. Its own fade takes one second, and the shell adds no shorter one.
        expect(opacityAt(own, 5.2)).toBeLessThan(0.5)
        expect(opacityAt(own, 5.95)).toBe(1)
        // "today" is said at 5.5 + 0.7.
        expect(opacityAt(later, 6.1)).toBe(0)
        expect(opacityAt(later, 6.45)).toBe(1)
    })

    it('fades out at the end of a scene every node that the scene put on the stage, at its opening or on a word', async () => {
        const first = circle(40), second = circle(40), last = circle(40)
        const film = await compile({ scenes: {
            hook: (s, c) => { s.add(first); c.on('run out', () => s.play(fadeIn(second, { duration: 0.2 }))) },
            answer: nothing,
            close: (s) => { s.add(last) },
        } })
        // The hook ends at 5. Its nodes leave in its last quarter of a second.
        for (const node of [first, second]) {
            expect(opacityAt(node, 4.7)).toBe(1)
            expect(opacityAt(node, 4.9)).toBeLessThan(0.9)
            expect(opacityAt(node, 5.03)).toBe(0)
        }
        // The last picture stays while the sound fades, and leaves in the last moments of the film, which ends at 10.25.
        expect(opacityAt(last, 9.8)).toBe(1)
        expect(opacityAt(last, 10)).toBeLessThan(1)
        expect(opacityAt(last, 10.21)).toBe(0)
        expect(visiblePaths(film, 9.8)).toBe(1)
    })

    it('holds a node that the scene keeps for the next scene, which takes its own copy with no fade', async () => {
        const old = circle(40), next = circle(40), other = circle(40)
        const film = await compile({ scenes: {
            hook: (s, c) => { s.add(old, other); c.keep(old) },
            answer: (_s, c) => { c.take(next) },
            close: nothing,
        } })
        // The hook ends at 5, and the answer starts at 5.5. The rest of the hook is gone at 5.03, and the copy that it keeps is not.
        expect(opacityAt(other, 5.03)).toBe(0)
        expect(opacityAt(old, 5.03)).toBe(1)
        expect(opacityAt(old, 5.15)).toBe(1)
        // The two copies change places 0.3 seconds before the first word of the answer, and the new one does not fade in.
        expect(opacityAt(old, 5.25)).toBe(0)
        expect(opacityAt(next, 5.15)).toBe(0)
        expect(opacityAt(next, 5.25)).toBe(1)
        expect(visiblePaths(film, 5.15)).toBe(1)
        expect(visiblePaths(film, 5.25)).toBe(1)
        // The answer did not keep it, so it leaves with the answer, which ends at 7.
        expect(opacityAt(next, 7.03)).toBe(0)
        // With a short gap, a scene opens after the moment at which it takes a picture. The picture that it took does not fade in again.
        const taken = circle(40)
        await compile({ timing: { ...timing, gap: 0.1 }, scenes: { hook: nothing, answer: (_s, c) => { c.take(taken) }, close: nothing } })
        // The answer starts at 5.1, takes the picture at 4.8, and opens at 4.95.
        expect(opacityAt(taken, 4.9)).toBe(1)
        expect(opacityAt(taken, 4.97)).toBe(1)
        // The last scene has no scene to keep a picture for.
        await expect(compile({ scenes: { ...scenes, close: (_s, c) => { c.keep(circle(40)) } } })).rejects.toThrow('narrated: scene "close": keep holds a picture for the next scene, and this is the last scene')
    })

    it('sets the text font of the film once: text-serif, or the font that the film names, and the kit follows it', async () => {
        const seen = async (font?: 'sans') => {
            const fonts: Record<string, string> = {}
            await compile({ ...(font ? { font } : {}), scenes: { ...scenes, hook: () => {
                const kit = sceneKit()
                Object.assign(fonts, { text: text('Toto').font, kit: kit.font, label: kit.label('Toto', 0, 0).font, heading: kit.heading('Toto').font, own: sceneKit({ font: 'mono' }).label('Toto', 0, 0).font })
                // A measure of the kit is in the font of the film too.
                expect(kit.textWidth('Toto', 40)).toBe(textWidth('Toto', 40, { font: font ?? 'text-serif' }))
            } } })
            return fonts
        }
        // A text of the scene that names no font has the font of the film, as the labels of the kit have.
        expect(await seen()).toEqual({ text: 'text-serif', kit: 'text-serif', label: 'text-serif', heading: 'text-serif', own: 'mono' })
        expect(await seen('sans')).toEqual({ text: 'sans', kit: 'sans', label: 'sans', heading: 'sans', own: 'mono' })
        // In a film that names no font, the kit is in text-serif, and a text with no font is in the font of the library.
        await compileFilm(film(() => {
            expect([sceneKit().font, sceneKit().label('Toto', 0, 0).font, text('Toto').font]).toEqual(['text-serif', 'text-serif', 'sans'])
        }))
        await compileFilm(film({ font: 'serif' }, () => {
            expect([sceneKit().font, sceneKit().label('Toto', 0, 0).font]).toEqual(['serif', 'serif'])
        }))
    })

    it('does not bring back at the close a node that the scene hid or removed, and fades a node from the opacity that it has', async () => {
        const make = () => ({ faded: circle(40), removed: circle(40), half: circle(40).opacity(0.5), toZero: circle(40), plain: circle(40) })
        const first = make(), last = make()
        const scene = (nodes: ReturnType<typeof make>, phrases: [string, string, string]) => (s: Stage, c: SceneClock) => {
            s.add(nodes.faded, nodes.removed, nodes.half, nodes.toZero, nodes.plain)
            c.on(phrases[0], () => s.play(fadeOut(nodes.faded, { duration: 0.2 })))
            c.on(phrases[1], () => s.remove(nodes.removed))
            c.on(phrases[2], () => s.play(fade(nodes.toZero, 0, { duration: 0.2 })))
        }
        const film = await compile({ scenes: { hook: scene(first, ['Will', 'it', 'run']), answer: nothing, close: scene(last, ['Have', 'a', 'plan']) } })
        // The hook ends at 5: its close is from 4.76 to 5.02. The last scene closes from 9.85 to 10.2.
        for (const [nodes, times, after] of [[first, [4.6, 4.76, 4.8, 4.9, 5, 5.01], 5.03], [last, [9.7, 9.85, 9.9, 10, 10.1, 10.19], 10.21]] as const) {
            for (const time of times) {
                // A node that the scene faded out, removed, or brought to zero stays away.
                expect([opacityAt(nodes.faded, time), opacityAt(nodes.removed, time), opacityAt(nodes.toZero, time)], `at ${time}`).toEqual([0, 0, 0])
                // A node at half opacity never gets more than half on its way out.
                expect(opacityAt(nodes.half, time), `at ${time}`).toBeLessThanOrEqual(0.5)
            }
            expect(opacityAt(nodes.half, times[0])).toBe(0.5)
            expect(opacityAt(nodes.half, times[3])).toBeLessThan(0.5)
            expect(opacityAt(nodes.half, times[3])).toBeGreaterThan(0)
            expect(opacityAt(nodes.plain, times[0])).toBe(1)
            expect([opacityAt(nodes.half, after), opacityAt(nodes.plain, after)]).toEqual([0, 0])
            // The frame shows the two nodes that are still there, and no third one.
            expect(visiblePaths(film, times[3])).toBe(2)
        }
        // The title card of a film that hides a part of it: the part stays hidden when the card leaves.
        const part = circle(40)
        await compile({ intro: (s) => { s.add(part); s.at(0.6, () => s.remove(part)) }, scenes })
        for (const time of [0.7, 1.2, 1.3, 1.45]) expect(opacityAt(part, time)).toBe(0)
    })

    it('stops when a scene keeps a node that the next scene does not take at its place', async () => {
        const keeps = (node: () => Node, take?: () => Node) => compile({ scenes: {
            hook: (s, c) => { const kept = node(); s.add(kept); c.keep(kept) },
            answer: (_s, c) => { if (take) c.take(take()) },
            close: nothing,
        } })
        const ring = () => circle(40).at(100, 50)
        await expect(keeps(ring)).rejects.toThrow(/^narrated: scene "hook": keep holds the node at \(100, 50\), \d+ wide and \d+ high for the next scene, and scene "answer" takes no node at that place\. Take a copy of it there with c\.take, or do not keep it: it then fades out with its scene$/)
        // A copy at another place does not take its place, and the picture would jump.
        await expect(keeps(ring, () => circle(40).at(300, 50))).rejects.toThrow('takes no node at that place')
        await expect(keeps(ring, () => circle(90).at(100, 50))).rejects.toThrow('takes no node at that place')
        // A copy that starts at the same corner and is wider, or higher, is not a copy of it either.
        const box = () => rect(80, 80).at(100, 50)
        await expect(keeps(box, () => rect(200, 80).at(160, 50))).rejects.toThrow('takes no node at that place')
        await expect(keeps(box, () => rect(80, 200).at(100, 110))).rejects.toThrow('takes no node at that place')
        await expect(keeps(box, box)).resolves.toBeDefined()
        // The message names the node by its name or by its text.
        await expect(keeps(() => ring().named('the axis'))).rejects.toThrow('keep holds the node "the axis" for the next scene')
        await expect(keeps(() => text('server', { size: 40 }))).rejects.toThrow('keep holds the text "server" for the next scene')
        // A copy at its place is the hand-over that keep is for.
        await expect(keeps(ring, ring)).resolves.toBeDefined()
        // In a draft of one scene, the next scene is not built, so there is nothing to compare.
        vi.spyOn(console, 'warn').mockImplementation(nothing)
        process.env['VIZMATIC_SCENES'] = 'hook'
        await expect(keeps(ring)).resolves.toBeDefined()
    })

    it('makes a film with no typed time that passes the layout check in every frame', async () => {
        const { heading, label, claimTag, source } = sceneKit()
        const beat = (say: string) => ({ say, duration: 2.4, hold: 1, words: say.split(' ').map((text, i) => ({ text, start: 0.1 + i * 0.4, end: 0.4 + i * 0.4 })) })
        const voice: TimingFile = { intro: 2, lead: 2.6, gap: 0.4, tail: 0.5, scenes: [{ id: 'one', title: 'One', beats: [beat('A page takes a long time.')] }, { id: 'two', title: 'Two', beats: [beat('A cache keeps the page.')] }] }
        const scene = (name: string) => (s: Stage, c: SceneClock) => {
            // Two headings at one place, two source lines at one place, and a tag at the right end of the source line.
            s.add(heading(name), source('Numbers: an invented example'))
            claimTag(c, { word: 'ILLUSTRATION', note: 'invented numbers' })
            const big = label(`${name}: 800 ms`, 0, 0, { size: 120 })
            c.onBeat(0, () => s.play(fadeIn(big, { duration: 0.4 })), 0.5)
        }
        const film = await compileFilm(narrated({ title: 'A cache', timing: voice, scenes: { one: scene('The first heading'), two: scene('The second heading') } }))
        const report = await checkFilm(film, { motion: true })
        expect(report.diagnostics).toEqual([])
        expect(report.frames).toBeGreaterThan(400)
    })
})

describe('cues that the script declares', () => {
    // The hook says "Will it run out?" from 2 to 4, and the answer says "Not today." from 5.5 to 7.
    const declared: TimingFile = {
        ...timing,
        scenes: [
            { ...timing.scenes[0]!, beats: [{ ...timing.scenes[0]!.beats[0]!, cues: [{ id: 'question', phrase: 'Will it' }, { id: 'out', phrase: 'run out', data: { color: 'red', parts: ['disk'] } }] }] },
            { ...timing.scenes[1]!, beats: [{ ...timing.scenes[1]!.beats[0]!, cues: [{ id: 'today', phrase: 'today' }] }] },
            timing.scenes[2]!,
        ],
    }
    const useAll = { hook: (_s: Stage, c: SceneClock) => { c.cue('question'); c.cue('out') }, answer: (_s: Stage, c: SceneClock) => { c.cue('today') }, close: nothing }

    it('lets a scene name the id of a cue where it can name a phrase: on, after, show, hide, swap and cue', async () => {
        const marks = { on: circle(40), after: circle(40), show: circle(40), swapped: circle(40) }
        const times: Record<string, number> = {}
        let found: unknown
        await compile({ timing: declared, scenes: {
            hook: (s, c) => {
                c.on('question', () => { times['on'] = s.time; s.add(marks.on) })
                c.after('out', () => { times['after'] = s.time; s.add(marks.after) })
                c.show('question', marks.show)
                c.swap('out', marks.show, marks.swapped)
                c.hide(0, marks.on, { after: true })
                found = c.cue('out')
                // The clock lists the cues of the scene, each with its beat.
                expect(c.cues).toEqual([{ id: 'question', phrase: 'Will it', beat: 0 }, { id: 'out', phrase: 'run out', beat: 0, data: { color: 'red', parts: ['disk'] } }])
            },
            answer: (_s, c) => { c.cue('today') },
            close: nothing,
        } })
        // "Will" starts at 2.1, "run" at 2.9, and "out?" ends at 3.6.
        expect(times['on']).toBeCloseTo(2.1, 6)
        expect(times['after']).toBeCloseTo(3.6, 6)
        // A declared cue gives its times, and what the script says of it.
        expect(found).toEqual({ start: expect.closeTo(2.9, 6), end: expect.closeTo(3.6, 6), id: 'out', phrase: 'run out', beat: 0, data: { color: 'red', parts: ['disk'] } })
        // show starts 0.1 seconds before the cue, as with a phrase.
        expect(opacityAt(marks.show, 1.95)).toBe(0)
        expect(opacityAt(marks.show, 2.4)).toBe(1)
        expect(opacityAt(marks.swapped, 2.7)).toBe(0)
        expect(opacityAt(marks.swapped, 3.4)).toBe(1)
    })

    it('stops at the end of the build on declared cues that drive nothing, in one error that lists them by scene', async () => {
        const unused = compile({ timing: declared, scenes: { hook: (_s, c) => { c.cue('question') }, answer: nothing, close: nothing } })
        await expect(unused).rejects.toThrow(`narration: 2 cues that the script declares drive nothing in the film: scene "hook": out; scene "answer": today. Use each one in its scene, such as c.show('out', nodes), or remove it from the script`)
        await expect(compile({ timing: declared, scenes: { ...useAll, answer: nothing } })).rejects.toThrow('narration: 1 cue that the script declares drives nothing in the film: scene "answer": today.')
        // Each cue drives something: the film builds.
        await expect(compile({ timing: declared, scenes: useAll })).resolves.toBeDefined()
        // A phrase that a scene types is no use of a cue, also when it is the phrase of that cue.
        await expect(compile({ timing: declared, scenes: { ...useAll, answer: (_s, c) => { c.cue('today.') } } })).rejects.toThrow('scene "answer": today')
        // A film with no declared cue works as before, and so does a typed phrase beside declared cues.
        await expect(compile({ scenes: { hook: (_s, c) => { c.cue('run out') }, answer: nothing, close: nothing } })).resolves.toBeDefined()
        await expect(compile({ timing: declared, scenes: { ...useAll, close: (_s, c) => { c.cue('a plan') } } })).resolves.toBeDefined()
    })

    it('does not count the cues of a scene that a draft does not build', async () => {
        vi.spyOn(console, 'warn').mockImplementation(nothing)
        process.env['VIZMATIC_SCENES'] = 'answer'
        await expect(compile({ timing: declared, scenes: { hook: nothing, answer: (_s, c) => { c.cue('today') }, close: nothing } })).resolves.toBeDefined()
        await expect(compile({ timing: declared, scenes: { hook: nothing, answer: nothing, close: nothing } })).rejects.toThrow('1 cue that the script declares drives nothing in the film: scene "answer": today')
    })

    it('stops on a declared cue that the script got wrong, with the name of its scene, its beat and its id', async () => {
        const withCues = (cues: unknown, scene = 0) => ({ ...timing, scenes: timing.scenes.map((each, index) => (index === scene ? { ...each, beats: [{ ...each.beats[0]!, cues: cues as never }] } : each)) })
        const fails = (cues: unknown) => compile({ timing: withCues(cues), scenes: { hook: nothing, answer: nothing, close: nothing } })
        await expect(fails([{ id: 'never', phrase: 'never said' }])).rejects.toThrow('narration: scene "hook": the cue "never" that the script declares for beat 0: the voice never says "never said" in beat 0')
        await expect(fails([{ id: 'a', phrase: 'Will it' }, { id: 'a', phrase: 'run' }])).rejects.toThrow('narration: scene "hook": two cues have the id "a", in beat 0 and in beat 0. An id names one cue of its scene')
        await expect(fails([{ phrase: 'Will it' }])).rejects.toThrow(`narration: scene "hook": beat 0: cue 0 needs an id, the name that a scene uses for it, such as { id: 'result', phrase: "Will it" }`)
        await expect(fails([{ id: 'a' }])).rejects.toThrow('narration: scene "hook": beat 0: the cue "a" needs a phrase, the words of the beat that it stands for')
        await expect(fails('Will it')).rejects.toThrow('narration: scene "hook": beat 0: cues is "Will it", and it is a list such as')
        await expect(fails(['Will it'])).rejects.toThrow('narration: scene "hook": beat 0: cue 0 is "Will it", and a cue is an object such as')
        // A declared cue has its beat, so a scene does not name another one.
        const other = compile({ timing: declared, scenes: { ...useAll, hook: (_s, c) => { c.cue('question'); c.on('out', nothing, 0, 1) } } })
        await expect(other).rejects.toThrow('narration: scene "hook": the script declares the cue "out" for beat 0, and the call names beat 1. A declared cue has its beat: leave the beat out')
    })

    it('takes the id of a cue before the words of the voice, so an id can be a word of its phrase', async () => {
        // The id "run" is a word that the voice says at 2.9. The cue stands for "Will it", at 2.1.
        const named: TimingFile = { ...timing, scenes: [{ ...timing.scenes[0]!, beats: [{ ...timing.scenes[0]!.beats[0]!, cues: [{ id: 'run', phrase: 'Will it' }] }] }, timing.scenes[1]!, timing.scenes[2]!] }
        let start = 0
        await compile({ timing: named, scenes: { hook: (_s, c) => { start = c.cue('run').start }, answer: nothing, close: nothing } })
        expect(start).toBeCloseTo(2.1, 6)
    })
})

describe('a film that runs past its narration', () => {
    const scenes = { hook: nothing, answer: nothing, close: nothing }

    it('stops on a play that ends after its scene, and names the scene, the play and by how much', async () => {
        // The hook ends at 5 seconds, with the hold of its beat.
        const late = compile({ scenes: { ...scenes, hook: (s, c) => { c.on('run', () => s.play(fadeIn(circle(40)), { duration: 20 })) } } })
        await expect(late).rejects.toThrow('narrated: scene "hook": the play of fadeIn that starts at 2.9 seconds ends at 22.9, and the scene ends at 5 seconds, with the hold of its last beat. That is 17.9 seconds too late, so the film would run past its narration. Give the play a shorter duration, start it on an earlier cue, or give the last beat of the scene a longer hold in the script')
        // A play of two animations has both names, and a play with a label has its label.
        const two = compile({ scenes: { ...scenes, hook: (s, c) => { c.on('run', () => s.play(fadeIn(circle(40)), fadeOut(circle(40)), { duration: 3 })) } } })
        await expect(two).rejects.toThrow('the play of fadeIn and fadeOut that starts at 2.9 seconds ends at 5.9')
        // A play that ends with the scene is in time, and so is the fade of clear, which ends 0.02 seconds after it.
        const ring = circle(40)
        const film = await compile({ scenes: { ...scenes, hook: (s, c) => { s.add(ring); c.on('run', () => s.play(fadeIn(circle(40)), { duration: 2.1 })); c.clear([ring]) } } })
        expect(film.duration).toBeCloseTo(10.25, 6)
        await expect(compile({ scenes: { ...scenes, hook: (s, c) => { c.on('run', () => s.play(fadeIn(circle(40)), { duration: 2.2 })) } } })).rejects.toThrow('That is 0.1 seconds too late')
    })

    it('lets the last scene hold its picture for the gap and the tail, and no longer', async () => {
        // The close ends at 9, and the film at 10.25: one gap of 0.5 and the tail of 0.75 after the last word.
        const held = await compile({ scenes: { ...scenes, close: (s, c) => { c.on('plan', () => s.play(fadeIn(circle(40)), { duration: 2.1 })) } } })
        expect(held.duration).toBeCloseTo(10.25, 6)
        const late = compile({ scenes: { ...scenes, close: (s, c) => { c.on('plan', () => s.play(fadeIn(circle(40)), { duration: 4 })) } } })
        await expect(late).rejects.toThrow('narrated: scene "close": the play of fadeIn that starts at 8.1 seconds ends at 12.1, and the film ends at 10.25 seconds, one gap and the tail after its last word. That is 1.85 seconds too late')
        // A wait has no play to name. The film is still not longer than its narration.
        const waits = compile({ scenes: { ...scenes, close: (s, c) => { c.on('plan', () => s.wait(30)) } } })
        await expect(waits).rejects.toThrow('narrated: the film is 38.1 seconds long, and its narration ends at 10.25 seconds, one gap and the tail after the last word. A scene waits or holds a caption past that time')
    })
})

describe('a result at the end of its clause', () => {
    const scenes = { hook: nothing, answer: nothing, close: nothing }

    it('starts a change when the voice has said the phrase, with the option after', async () => {
        const named = circle(40), result = circle(40), out = circle(40), next = circle(40), beat = circle(40)
        await compile({ scenes: { ...scenes, hook: (s, c) => {
            s.add(out)
            // "it run" is said from 2.5 to 3.2.
            c.show('it run', named)
            c.show('it run', result, { after: true })
            c.swap('Will', out, next, { after: true })
            c.show(0, beat, { after: true })
        } } })
        // A thing that the voice names is there as the voice says it: 0.1 seconds before the phrase.
        expect(opacityAt(named, 2.39)).toBe(0)
        expect(opacityAt(named, 2.45)).toBeGreaterThan(0)
        expect(opacityAt(named, 2.71)).toBe(1)
        // A result comes when the voice has said it: at the end of the phrase, with no lead.
        expect(opacityAt(result, 3.19)).toBe(0)
        expect(opacityAt(result, 3.3)).toBeGreaterThan(0)
        expect(opacityAt(result, 3.51)).toBe(1)
        // "Will" ends at 2.4: the old node leaves then, and the new one comes 0.2 seconds later.
        expect(opacityAt(out, 2.39)).toBe(1)
        expect(opacityAt(out, 2.71)).toBe(0)
        expect(opacityAt(next, 2.59)).toBe(0)
        expect(opacityAt(next, 2.91)).toBe(1)
        // With the index of a beat, the change waits for the end of the voice of the beat, at 4.
        expect(opacityAt(beat, 3.99)).toBe(0)
        expect(opacityAt(beat, 4.31)).toBe(1)
    })

    it('counts a lead from the end of the phrase, and stops on a value of after that is not true or false', async () => {
        const early = circle(40)
        await compile({ scenes: { ...scenes, hook: (_s, c) => { c.show('it run', early, { after: true, lead: 0.2 }) } } })
        expect(opacityAt(early, 2.99)).toBe(0)
        expect(opacityAt(early, 3.31)).toBe(1)
        await expect(compile({ scenes: { ...scenes, hook: (_s, c) => { c.show('it run', circle(40), { after: 'yes' as never }) } } })).rejects.toThrow('scene "hook": show: after is "yes", and it is true, for a change that starts when the voice has said the phrase')
        // A result at the end of the last words of a scene needs a hold for its fade: the message says so.
        const noRoom = compile({ timing: { ...timing, scenes: [{ ...timing.scenes[0]!, beats: [{ ...timing.scenes[0]!.beats[0]!, hold: 0.1 }] }, timing.scenes[1]!, timing.scenes[2]!] }, scenes: { ...scenes, hook: (_s, c) => { c.show('run out', circle(40), { after: true }) } } })
        await expect(noRoom).rejects.toThrow('or give the last beat of the scene a hold')
    })
})

describe('a timing that another tool writes', () => {
    // A course lays out its own sound: each scene has its start, 0.4 seconds of silence before its first word,
    // and the film ends 0.3 seconds after the last hold.
    const own: TimingFile = {
        intro: 0, lead: 0.4, gap: 0, tail: 0.3,
        scenes: [
            { id: 'hook', title: 'The question', start: 0.4, beats: [{ say: 'Will it run out?', duration: 2, hold: 0.6, words: [word('Will', 0.1), word('it', 0.5), word('run', 0.9), word('out?', 1.3)] }] },
            { id: 'answer', title: 'The answer', start: 3.7, beats: [{ say: 'Not today.', duration: 1.5, hold: 0.5, words: [word('Not', 0.2), word('today.', 0.7)] }] },
            { id: 'close', start: 6.3, beats: [{ say: 'Have a plan.', duration: 1, hold: 0.5, words: [word('Have', 0.1), word('a', 0.4), word('plan.', 0.6)] }] },
        ],
    }
    const scenes = { hook: nothing, answer: nothing, close: nothing }

    it('places each scene at its own start, and ends the film one tail after the last hold', async () => {
        const seen: Record<string, number[]> = {}
        const scene = (s: Stage, c: SceneClock) => { seen[c.id] = [s.time, c.start, c.end, c.next] }
        const film = await compile({ timing: own, intro: false, scenes: { hook: scene, answer: scene, close: scene } })
        // The hook ends at 3, and the answer starts at 3.7: its picture opens 0.05 seconds before the hook is gone.
        expect(seen['hook']!.map((time) => Math.round(time * 100) / 100)).toEqual([0, 0.4, 3, 3.7])
        expect(seen['answer']!.map((time) => Math.round(time * 100) / 100)).toEqual([2.95, 3.7, 5.7, 6.3])
        expect(seen['close']!.map((time) => Math.round(time * 100) / 100)).toEqual([5.65, 6.3, 7.8, 7.8])
        expect(film.duration).toBeCloseTo(8.1, 6)
        expect(film.chapters).toEqual([{ title: 'The question', time: 0 }, { title: 'The answer', time: 3.7 }])
        // The captions are at the words of each scene.
        expect(film.captions.map((caption) => [caption.text, Math.round(caption.t0 * 100) / 100])).toEqual([['Will it run out?', 0.4], ['Not today.', 3.7], ['Have a plan.', 6.3]])
    })

    it('opens, closes and hands over a picture with the times of such a timing', async () => {
        const first = circle(40), kept = circle(40), taken = circle(40), second = circle(40), last = circle(40)
        await compile({ timing: own, intro: false, scenes: {
            hook: (s, c) => { s.add(first, kept); c.keep(kept) },
            answer: (s, c) => { s.add(second); c.take(taken) },
            close: (s) => { s.add(last) },
        } })
        // The hook leaves in its last quarter of a second, which ends at 3.
        expect(opacityAt(first, 2.7)).toBeCloseTo(1, 6)
        expect(opacityAt(first, 3.03)).toBe(0)
        // The picture of the answer opens when the hook is gone, long before its first word at 3.7.
        expect(opacityAt(second, 2.94)).toBe(0)
        expect(opacityAt(second, 3.21)).toBeCloseTo(1, 6)
        // The two copies change places 0.3 seconds before the first word of the answer.
        expect(opacityAt(kept, 3.39)).toBe(1)
        expect(opacityAt(kept, 3.41)).toBe(0)
        expect(opacityAt(taken, 3.39)).toBe(0)
        expect(opacityAt(taken, 3.41)).toBe(1)
        // The last picture stays to the end of the film, 0.3 seconds after its hold, and leaves in its last moments.
        expect(opacityAt(last, 7.7)).toBeCloseTo(1, 6)
        expect(opacityAt(last, 8.06)).toBe(0)
    })

    it('stops when a scene starts before the scene before it has ended, and on a start that is not a time', async () => {
        const early = { ...own, scenes: [own.scenes[0]!, { ...own.scenes[1]!, start: 2.9 }, own.scenes[2]!] }
        await expect(compile({ timing: early, intro: false, scenes })).rejects.toThrow('narration: scene "answer" starts at 2.9 s, and the scene before it, "hook", ends at 3 s with the hold of its last beat. A scene starts when the scene before it has ended: give it a later start, or give the last beat of "hook" a shorter hold')
        const wrong = { ...own, scenes: [{ ...own.scenes[0]!, start: 'soon' as never }, own.scenes[1]!, own.scenes[2]!] }
        await expect(compile({ timing: wrong, intro: false, scenes })).rejects.toThrow('narration: scene "hook": start is "soon", and it is the time of the first word of the scene, in film seconds, 0 or more')
        // A scene with no start follows the scene before it by one gap, as before.
        const mixed = { ...own, gap: 0.5, scenes: [own.scenes[0]!, { ...own.scenes[1]!, start: undefined }, own.scenes[2]!] }
        let start = 0
        await compile({ timing: mixed, intro: false, scenes: { ...scenes, answer: (_s, c) => { start = c.start } } })
        expect(start).toBeCloseTo(3.5, 6)
    })
})

describe('a cue with no ASCII letter', () => {
    const spoken = (words: string[]): TimingFile => ({ lead: 0.5, gap: 0.5, tail: 0.5, scenes: [{ id: 'one', beats: [{ say: words.join(' '), duration: words.length * 0.4, hold: 1, words: words.map((text, index) => ({ text, start: index * 0.4, end: index * 0.4 + 0.3 })) }] }] })

    it('finds a word of another script, a word with an accent, and a number', async () => {
        const starts: number[] = []
        await compileFilm(narrated({ fps: 10, timing: spoken(['Tokyo', 'is', '東京', 'and', 'café', 'has', '42', 'seats', 'at', '3.5', 'stars.']), scenes: { one: (_s, c) => {
            for (const phrase of ['東京', 'café', '42 seats', '3.5 stars', 'CAFÉ has']) starts.push(Math.round(c.cue(phrase).start * 10) / 10)
        } } }))
        expect(starts).toEqual([1.3, 2.1, 2.9, 4.1, 2.1])
    })

    it('says what to write for a cue that is a symbol', async () => {
        const film = (phrase: string) => compileFilm(narrated({ fps: 10, timing: spoken(['It', 'grows', 'by', '5', 'percent.']), scenes: { one: (_s, c) => { c.cue(phrase) } } }))
        await expect(film('%')).rejects.toThrow('narration: scene "one": the cue "%" has no letter and no digit, so it names no word of the voice. A cue is a word or a number that the voice says: write the words that the voice says for a symbol, such as "percent" for "%".')
        await expect(film('→ …')).rejects.toThrow('the cue "→ …" has no letter and no digit')
        // The number and the word that the voice says for the sign work.
        await expect(film('5 percent')).resolves.toBeDefined()
    })
})

describe('a picture that two scenes share', () => {
    // A film without the shell: the clocks of narration() alone.
    const build = (gap: number, onStage: (s: Stage, hook: SceneClock, answer: SceneClock) => void) => compileFilm(film({ fps: 20 }, (s) => {
        const voice = narration(s, { ...timing, gap }, { captions: false, chapters: false })
        onStage(s, voice.scene('hook'), voice.scene('answer'))
        s.at(10, () => {})
    }))

    it('gives each scene the time at which the next one starts', async () => {
        await build(0.5, (_s, hook, answer) => {
            expect(hook.next).toBe(5.5)
            expect(hook.next).toBe(answer.start)
            expect(answer.next).toBe(answer.end + 0.5)
        })
    })

    it('swaps the two copies at one moment, 0.3 seconds before the first word of the next scene, and runs the setup then', async () => {
        const old = circle(40), next = circle(40)
        let ready = -1
        const film = await build(0.5, (s, hook, answer) => {
            s.add(old)
            hook.keep([old])
            answer.take([next], () => { ready = s.time })
        })
        // The hook ends at 5, and the answer starts at 5.5. One copy is on screen on both sides of 5.2.
        expect(ready).toBeCloseTo(5.2, 6)
        expect(at(5.15, () => old.get('visible'))).toBe(true)
        expect(at(5.25, () => old.get('visible'))).toBe(false)
        expect(visiblePaths(film, 5.15)).toBe(1)
        expect(visiblePaths(film, 5.25)).toBe(1)
        expect(visiblePaths(film, 1)).toBe(1)
    })

    it('refuses a hand-over in a gap that is shorter than the clear of the scene', async () => {
        await expect(build(0.2, (_s, hook) => { hook.keep([circle(40)]) })).rejects.toThrow('scene "hook": keep needs a gap of 0.32 seconds or more between scenes, and the gap is 0.2')
        await expect(build(0.31, (_s, hook) => { hook.keep(circle(40)) })).rejects.toThrow('the gap is 0.31')
    })

    it('accepts a gap of exactly 0.32 seconds, at any place in the film', async () => {
        // The gap is a difference of two times, which is not exact: 5.32 minus 5 is a little less than 0.32.
        await build(0.32, (_s, hook, answer) => {
            expect(hook.next - hook.end).not.toBe(0.32)
            hook.keep([circle(40)])
            answer.keep(circle(40))
        })
    })

    it('clears a scene in its last quarter of a second, and not over its last words', async () => {
        const ring = circle(40)
        await build(0.5, (s, hook) => {
            s.add(ring)
            hook.clear([ring])
        })
        const opacity = (time: number) => { const saved = clock.now; clock.now = time; try { return ring.get('opacity') } finally { clock.now = saved } }
        // The hook ends at 5. The clear starts 0.24 seconds before, and takes 0.26 seconds.
        expect(opacity(4.7)).toBe(1)
        expect(opacity(4.75)).toBe(1)
        expect(opacity(4.9)).toBeLessThan(0.9)
        expect(opacity(4.9)).toBeGreaterThan(0.1)
        expect(opacity(5.03)).toBe(0)
    })
})

describe('number and text helpers', () => {
    it('lerp, clamp and smoothstep give the values that a drawing counts on', () => {
        expect(lerp(100, 200, 0.25)).toBe(125)
        expect(clamp(1.4)).toBe(1)
        expect(clamp(-3)).toBe(0)
        expect(clamp(7, 2, 5)).toBe(5)
        expect(smoothstep(0.5)).toBe(0.5)
        expect(smoothstep(0.1)).toBeCloseTo(0.028, 6)
        expect(smoothstep(-1)).toBe(0)
        expect(smoothstep(2)).toBe(1)
    })

    it('valueAt reads a series on the straight line between its two points around x', () => {
        const points = [[0, 2], [2, 6], [3, 6], [7, -2]] as const
        expect(valueAt(points, 1)).toBe(4)
        expect(valueAt(points, 0)).toBe(2)
        expect(valueAt(points, 2)).toBe(6)
        expect(valueAt(points, 2.5)).toBe(6)
        expect(valueAt(points, 6)).toBe(0)
        expect(valueAt(points, 7)).toBe(-2)
        // Outside its points, a series has no value. An empty series has none at all.
        expect(valueAt(points, -0.1)).toBeNaN()
        expect(valueAt(points, 7.1)).toBeNaN()
        expect(valueAt([], 1)).toBeNaN()
        expect(valueAt([[3, 5]], 3)).toBe(5)
        // A point with no value: the series has its own value at the points beside it, and none between them.
        const gap = [[0, 1], [1, NaN], [2, 3]] as const
        expect(valueAt(gap, 0)).toBe(1)
        expect(valueAt(gap, 2)).toBe(3)
        expect(valueAt(gap, 0.5)).toBeNaN()
        expect(valueAt(gap, 1)).toBeNaN()
    })

    it('commas groups the digits of a whole number in threes and rounds a fraction', () => {
        expect(commas(21915584)).toBe('21,915,584')
        expect(commas(999)).toBe('999')
        expect(commas(1000)).toBe('1,000')
        expect(commas(-46792.6)).toBe('-46,793')
        expect(commas(1999.6)).toBe('2,000')
        expect(commas(5040000000000n)).toBe('5,040,000,000,000')
        expect(() => commas(Number.POSITIVE_INFINITY)).toThrow('commas: Infinity is not a number that a viewer can read')
        expect(() => commas(Number.NaN)).toThrow('commas: NaN is not a number that a viewer can read')
    })

    it('assertEqual stops the build when a number is not the number that the voice says', () => {
        expect(() => assertEqual(100, 100)).not.toThrow()
        expect(() => assertEqual([1, 2, 4, 8], [1, 2, 4, 8])).not.toThrow()
        expect(() => assertEqual({ ms: 800, name: 'database' }, { name: 'database', ms: 800 })).not.toThrow()
        expect(() => assertEqual(99, 100, 'the clients')).toThrow('assertEqual: the clients is 99, and the film counts on 100. Correct the data, or the scene and the words of the voice')
        expect(() => assertEqual([1, 2, 4], [1, 2, 4, 8])).toThrow('assertEqual: the value is [1,2,4], and the film counts on [1,2,4,8]')
        expect(() => assertEqual([1, 2, 4, 9], [1, 2, 4, 8])).toThrow('[1,2,4,9]')
        expect(() => assertEqual({ ms: 800 }, { ms: 800, name: 'database' } as never)).toThrow('{"ms":800}')
        expect(() => assertEqual<unknown>('100', 100)).toThrow('"100"')
        expect(() => assertEqual<unknown>([], {})).toThrow('[]')
        expect(() => assertEqual<unknown>(null, {})).toThrow('null')
        expect(() => assertEqual(Number.NaN, Number.NaN)).not.toThrow()
    })

    it('seededRandom repeats for a seed, differs between seeds, and stays in [0, 1)', () => {
        const first = seededRandom(7), again = seededRandom(7), other = seededRandom(8)
        const draws = Array.from({ length: 200 }, () => first())
        expect(Array.from({ length: 200 }, () => again())).toEqual(draws)
        expect(Array.from({ length: 200 }, () => other())).not.toEqual(draws)
        expect(draws.every((value) => value >= 0 && value < 1)).toBe(true)
    })

    it('textWidth is the advance width of a line, and it grows with the size', async () => {
        await compileFilm(narrated({ timing, scenes: { hook: () => {
            const ink = text('p99 latency', { font: 'sans', size: 40 }).bounds().width
            const advance = textWidth('p99 latency', 40, { font: 'sans' })
            // The advance has the space at both sides of the letters, so it is a little wider than the ink.
            expect(advance).toBeGreaterThan(ink)
            expect(advance - ink).toBeLessThan(8)
            expect(textWidth('p99 latency', 80, { font: 'sans' })).toBeCloseTo(advance * 2, 6)
            expect(textWidth('p99 latency', 40, { font: 'mono' })).not.toBeCloseTo(advance, 0)
        }, answer: nothing, close: nothing } }))
    })

    it('a measure outside a kit needs its font, so that a width is never in another font than the text', async () => {
        await compileFilm(narrated({ timing, scenes: { hook: () => {
            expect(() => textWidth('p99 latency', 40, undefined as never)).toThrow("textWidth: give the font of the text, such as { font: 'text-serif' }")
            expect(() => fitSize('p99 latency', 100, 40, {} as never)).toThrow("fitSize: give the font of the text")
            // In the two fonts, the same text has two widths. Each function measures in the font that it is given.
            expect(textWidth('one process for each microVM', 40, { font: 'sans' })).not.toBeCloseTo(textWidth('one process for each microVM', 40, { font: 'text-serif' }), 0)
        }, answer: nothing, close: nothing } }))
    })

    it('fitSize keeps a text that fits, and shrinks one that does not until it fits', async () => {
        await compileFilm(narrated({ timing, scenes: { hook: () => {
            const font = { font: 'text-serif' } as const
            expect(fitSize('Toto', 400, 40, font)).toBe(40)
            const fitted = fitSize('Toto-2.0-2.5b, the largest checkpoint', 220, 40, font)
            expect(fitted).toBeLessThan(40)
            expect(textWidth('Toto-2.0-2.5b, the largest checkpoint', fitted, font)).toBeLessThanOrEqual(220)
            // One size larger does not fit, so the result is the largest size that does.
            expect(textWidth('Toto-2.0-2.5b, the largest checkpoint', fitted + 1, font)).toBeGreaterThan(220)
            expect(() => fitSize('Toto', 0, 40, font)).toThrow('fitSize: the width must be more than 0')
            expect(capHeight(40)).toBeCloseTo(27.2, 6)
        }, answer: nothing, close: nothing } }))
    })
})

describe('scene kit', () => {
/** Run a check inside the first scene of a film, with its stage and its clock. The hook opens at 1.45, when the title card is gone, starts at 2, and ends at 5. */
    const inFilm = (check: (s: Stage, c: SceneClock) => void) => compileFilm(narrated({ title: 'Capacity', timing, scenes: { hook: check, answer: nothing, close: nothing } }))
    const height = (node: { bounds(): { height: number } }) => node.bounds().height
    const serif = (size: number, content = 'Toto') => height(text(content, { font: 'text-serif', size }))

    it('places a label by its middle, its left edge, or its right edge, on one baseline', async () => {
        await inFilm(() => {
            const { label, left, right } = sceneKit()
            const middle = label('requests', 300, 50).bounds(), fromLeft = left('requests', 300, 50).bounds(), fromRight = right('requests', 300, 50).bounds()
            expect(Math.abs(middle.x + middle.width / 2 - 300)).toBeLessThan(2)
            // The edge of the text block is on x. The ink starts a side bearing after it.
            expect(fromLeft.x).toBeGreaterThanOrEqual(300)
            expect(fromLeft.x - 300).toBeLessThan(4)
            expect(300 - (fromRight.x + fromRight.width)).toBeGreaterThanOrEqual(0)
            expect(300 - (fromRight.x + fromRight.width)).toBeLessThan(4)
            expect(fromLeft.y).toBeCloseTo(middle.y, 6)
            expect(fromRight.y).toBeCloseTo(middle.y, 6)
        })
    })

    it('uses the font and the size of the film, and an option of one label wins', async () => {
        await inFilm(() => {
            const small = sceneKit({ size: 30 }), large = sceneKit({ size: 60 })
            expect(large.label('Toto', 0, 0).bounds().height).toBeCloseTo(small.label('Toto', 0, 0).bounds().height * 2, 6)
            expect(small.label('Toto', 0, 0, { size: 60 }).bounds().height).toBeCloseTo(large.label('Toto', 0, 0).bounds().height, 6)
            // The default font of the kit is not the default font of text().
            expect(sceneKit().label('Toto', 0, 0, { size: 40 }).bounds().width).toBeCloseTo(text('Toto', { font: 'text-serif', size: 40 }).bounds().width, 6)
            expect(sceneKit({ font: 'sans' }).label('Toto', 0, 0, { size: 40 }).bounds().width).toBeCloseTo(text('Toto', { font: 'sans', size: 40 }).bounds().width, 6)
            expect(sceneKit().fitSize('Toto', 60, 40)).toBe(fitSize('Toto', 60, 40, { font: 'text-serif' }))
        })
    })

    it('sets every size from the one size of the film: the heading, the source line, the tag, the chips and the boxes', async () => {
        await inFilm((_s, c) => {
            // With the default of 36, the sizes are those that fit a frame of 1920 by 1080: 52, 32, 28 and 26.
            const kit = sceneKit()
            expect(height(kit.label('Toto', 0, 0))).toBeCloseTo(serif(36), 6)
            expect(height(kit.heading('Toto'))).toBeCloseTo(serif(52), 6)
            expect(height(kit.para('Toto', 0, 0, 400))).toBeCloseTo(serif(32), 6)
            expect(height(kit.source('Toto'))).toBeCloseTo(serif(26), 6)
            expect(height(kit.namedBox('Toto', { width: 400, height: 120 }).name)).toBeCloseTo(serif(32), 6)
            expect(kit.chip('Toto').box.height).toBe(chip('Toto', { size: 28 }).box.height)
            // A film for a phone raises one number, and every size follows it.
            const large = sceneKit({ size: 72 })
            expect(height(large.label('Toto', 0, 0))).toBeCloseTo(serif(72), 6)
            expect(height(large.heading('Toto'))).toBeCloseTo(serif(104), 6)
            expect(height(large.para('Toto', 0, 0, 400))).toBeCloseTo(serif(64), 6)
            expect(height(large.source('Toto'))).toBeCloseTo(serif(52), 6)
            expect(height(large.namedBox('Toto', { width: 400, height: 160 }).name)).toBeCloseTo(serif(64), 6)
            expect(large.chip('Toto').box.height).toBe(chip('Toto', { size: 56 }).box.height)
            expect(large.chipRow(['Toto']).box.height).toBe(chip('Toto', { size: 56 }).box.height)
            // The claim tag has the size of the source line, which is beside it.
            const shown = (made: Node) => made.draw!(3) as unknown as { word: { bounds(): { height: number } } }
            expect(height(shown(large.claimTag(c, { word: 'PLAN' })).word)).toBeCloseTo(height(tag('PLAN', { size: 52 }).word), 6)
            expect(height(shown(kit.claimTag(c, { word: 'PLAN' })).word)).toBeCloseTo(height(tag('PLAN', { size: 26 }).word), 6)
            // A size that the film gives for one part wins over the scale, and an option of one object wins over both.
            const own = sceneKit({ size: 72, paraSize: 50, heading: { size: 70 }, source: { size: 40 }, chip: { size: 30 } })
            expect(height(own.heading('Toto'))).toBeCloseTo(serif(70), 6)
            expect(height(own.source('Toto'))).toBeCloseTo(serif(40), 6)
            expect(height(own.para('Toto', 0, 0, 400))).toBeCloseTo(serif(50), 6)
            expect(own.chip('Toto').box.height).toBe(chip('Toto', { size: 30 }).box.height)
            expect(height(own.heading('Toto', { size: 30 }))).toBeCloseTo(serif(30), 6)
            expect(height(own.namedBox('Toto', { width: 400, height: 160, size: 40 }).name)).toBeCloseTo(serif(40), 6)
        })
    })

    it('wraps a block of text at its width, keeps its left edge, and sets its lines 1.3 sizes apart', async () => {
        await inFilm(() => {
            const long = 'A block of text that is longer than one line breaks at the width that the scene gives.'
            const block = sceneKit().para(long, -400, 0, 500).bounds()
            expect(block.x).toBeGreaterThanOrEqual(-400)
            expect(block.x + block.width).toBeLessThanOrEqual(100)
            expect(block.height).toBeGreaterThan(32 * 2)
            // The lines are farther apart than in a block of text() with its default, and as far as with a leading of 1.3.
            const lines = (leading?: number) => text(long, { font: 'text-serif', size: 32, anchor: 'left', align: 'left', maxWidth: 500, ...(leading === undefined ? {} : { leading }) }).bounds().height
            expect(block.height).toBeCloseTo(lines(1.3), 6)
            expect(block.height).not.toBeCloseTo(lines(1.1), 0)
            expect(block.height).not.toBeCloseTo(lines(1.5), 0)
        })
    })

    it('gives the area and puts the heading over it and the source line under it', async () => {
        await inFilm(() => {
            const { area, heading, source } = sceneKit()
            expect(area).toEqual({ left: -900, right: 900, top: -400, bottom: 440, cx: 0, cy: 20, width: 1800, height: 840 })
            const head = heading('One microVM').bounds(), foot = source('Firecracker docs, 2026').bounds()
            expect(head.x - area.left).toBeLessThan(5)
            expect(head.x).toBeGreaterThanOrEqual(area.left)
            expect(head.y + head.height).toBeLessThan(area.top)
            expect(foot.x).toBeGreaterThanOrEqual(area.left)
            expect(foot.y).toBeGreaterThan(area.bottom)
            // Both are inside a frame of 1920 by 1080.
            expect(head.y).toBeGreaterThan(-540)
            expect(foot.y + foot.height).toBeLessThan(540)
        })
    })

    it('takes the area, the heading and the source line of the film', async () => {
        await inFilm(() => {
            const kit = sceneKit({ area: { bottom: 430, left: -800 }, heading: { align: 'center', y: -462, size: 58 }, source: { y: 486, size: 28 } })
            expect(kit.area).toMatchObject({ left: -800, bottom: 430, cx: 50, cy: 15, width: 1700, height: 830 })
            const head = kit.heading('Inside the model').bounds()
            // The middle of the ink is within a side bearing of the middle of the area.
            expect(Math.abs(head.x + head.width / 2 - 50)).toBeLessThan(2)
            expect(kit.source('a note').bounds().x - -800).toBeLessThan(4)
            expect(kit.source('a note').bounds().height).toBeCloseTo(sceneKit({ source: { size: 14 } }).source('a note').bounds().height * 2, 6)
            expect(() => sceneKit({ area: { left: 900 } })).toThrow('the area must have its right edge after its left edge')
        })
    })

    it('puts a claim tag on the stage at the right end of the source line, where the source line does not reach it', async () => {
        await inFilm((s, c) => {
            const { area, claimTag, source } = sceneKit({ area: { right: 800 } })
            const track = claimTag(c, { word: 'ILLUSTRATION', note: 'invented numbers' })
            // The scene did not add it: the tag is on the stage when the call returns.
            expect(track.mounted).toBe(true)
            expect(s.root.children).toContain(track)
            expect(track.get('x')).toBe(area.right)
            expect(track.get('y')).toBe(492)
            // The first state starts with the picture of the scene, which is when the film calls the scene: not with the film.
            expect(s.time).toBeCloseTo(1.45, 6)
            expect(track.draw!(s.time - 0.01)).toBeNull()
            expect(track.draw!(s.time + 0.3)).not.toBeNull()
            const shown = track.draw!(3) as unknown as Node
            const ink = shown.bounds()
            expect(track.get('x') + ink.x + ink.width).toBeCloseTo(area.right, 0)
            // The source line starts at the left edge of the area, on the same line, and ends before the tag starts.
            const foot = source('Numbers: data/numbers.json, an invented example for this film').bounds()
            expect(foot.x + foot.width).toBeLessThan(track.get('x') + ink.x)
            expect(Math.abs(foot.y + foot.height / 2 - 492)).toBeLessThan(foot.height)
            // In the top right corner, at the height of the heading.
            expect(claimTag(c, { word: 'OUR RUN' }, { place: 'top' }).get('y')).toBe(-474)
            expect(claimTag(c, { word: 'OUR RUN' }, { place: 'top' }).get('x')).toBe(area.right)
        })
    })

    it('ends each state of a claim tag at the right edge of the area, and changes the state at its time', async () => {
        await inFilm((_s, c) => {
            const { area, claimTag } = sceneKit()
            const track = claimTag(c, [{ word: 'JUDGMENT', note: 'the summary of this film, and not a quote' }, { at: 3, word: 'OUR RUN', color: 'blue' }])
            const shown = (time: number) => { const made = (track.draw!(time) as unknown as Node).bounds(); return { left: track.get('x') + made.x, right: track.get('x') + made.x + made.width } }
            expect(shown(2.5).right).toBeCloseTo(area.right, 0)
            expect(shown(3.5).right).toBeCloseTo(area.right, 0)
            // The short state is not as wide, so it starts farther to the right.
            expect(shown(3.5).left).toBeGreaterThan(shown(2.5).left + 200)
        })
    })

    it('keeps a claim tag for as long as the picture of its scene, and takes it away with the scene', async () => {
        const tags: Record<string, Node> = {}
        const { claimTag } = sceneKit()
        await compile({ scenes: {
            hook: (_s, c) => { tags['hook'] = claimTag(c, { word: 'MEASURED' }) },
            answer: (_s, c) => { tags['own'] = claimTag(c, { word: 'PLAN' }, { until: 6 }) },
            close: (_s, c) => { tags['close'] = claimTag(c, { word: 'JUDGMENT' }) },
        } })
        // The tag has no end of its own: just before the hook ends at 5, it still draws, and the scene fades it out.
        expect(tags['hook']!.draw!(4.99)).not.toBeNull()
        expect(opacityAt(tags['hook']!, 4.7)).toBe(1)
        expect(opacityAt(tags['hook']!, 5.03)).toBe(0)
        // In the last scene, the tag stays with the picture while the sound fades: the film ends at 10.25.
        expect(tags['close']!.draw!(9.8)).not.toBeNull()
        expect(opacityAt(tags['close']!, 9.8)).toBe(1)
        expect(opacityAt(tags['close']!, 10.21)).toBe(0)
        // A tag with an end of its own leaves then.
        expect(tags['own']!.draw!(5.7)).not.toBeNull()
        expect(tags['own']!.draw!(6.1)).toBeNull()
    })

    it('names the scene, the state and the field of a claim tag that is wrong', async () => {
        await inFilm((_s, c) => {
            const { claimTag } = sceneKit({ area: { left: -200, right: 200 } })
            const tagOf = (states: unknown) => () => claimTag(c, states as never)
            expect(tagOf({ label: 'MEASURED' })).toThrow('sceneKit: the claim tag of scene "hook": state 0 has the field "label", and a state has no such field. Its fields are: at, word, note, color, noteColor, size, font, noteFont, fill, anchor')
            expect(tagOf({ note: 'our run' })).toThrow(`sceneKit: the claim tag of scene "hook": state 0 needs the field "word", the word in the pill, such as { word: 'MEASURED', note: 'our run' }`)
            expect(tagOf({ word: '  ' })).toThrow('state 0 needs the field "word"')
            expect(tagOf([{ word: 'PLAN' }, { word: 'MEASURED' }])).toThrow(`sceneKit: the claim tag of scene "hook": state 1 needs the field "at", the time when it takes the place of the state before it, such as c.cue('a phrase').start`)
            expect(tagOf({ word: 'PLAN', at: 'now' })).toThrow('the field "at" of state 0 is "now", and it is a time in film seconds')
            expect(tagOf({ word: 'PLAN', note: 7 })).toThrow('the field "note" of state 0 is 7, and a note is a text')
            expect(tagOf(['MEASURED'])).toThrow('state 0 is "MEASURED", and a state is an object such as')
            expect(tagOf([])).toThrow('sceneKit: the claim tag of scene "hook" needs at least one state')
            expect(tagOf({ word: 'MEASURED', note: 'a note that is much longer than the area of this film' })).toThrow(/the claim tag of scene "hook" is \d+ wide with the word "MEASURED", and the area is 400 wide. Shorten its note/)
        })
    })

    it('gives every chip the look of the film, and one chip can differ', async () => {
        await inFilm(() => {
            const kit = sceneKit({ chip: { height: 2.6, size: 30 } })
            expect(kit.chip('virtio').box.height).toBe(78)
            expect(kit.chip('virtio', { height: 2 }).box.height).toBe(60)
            expect(kit.chipRow(['a', 'b']).chips[0]!.box.height).toBe(78)
            // The chips are in the font of the film.
            expect(kit.chip('virtio').box.width).not.toBe(sceneKit({ font: 'mono', chip: { size: 30 } }).chip('virtio').box.width)
        })
    })

    it('makes the card, the named box, the note of a tag and the measures in the font of the film', async () => {
        await inFilm((_s, c) => {
            const serifKit = sceneKit(), sans = sceneKit({ font: 'sans' })
            const width = (node: { bounds(): { width: number } } | null) => node!.bounds().width
            const plain = text('Logs and traces', { font: 'text-serif', size: 40 })
            expect(width(serifKit.card({ title: 'Logs and traces', titleSize: 40 }).title)).toBeCloseTo(width(plain), 6)
            expect(width(sans.card({ title: 'Logs and traces', titleSize: 40 }).title)).not.toBeCloseTo(width(plain), 0)
            expect(width(serifKit.namedBox('Logs and traces', { width: 600, height: 120, size: 40 }).name)).toBeCloseTo(width(plain), 6)
            expect(width(sans.namedBox('Logs and traces', { width: 600, height: 120, size: 40 }).name)).not.toBeCloseTo(width(plain), 0)
            expect(serifKit.textWidth('Logs and traces', 40)).toBe(textWidth('Logs and traces', 40, { font: 'text-serif' }))
            expect(sans.textWidth('Logs and traces', 40)).toBe(textWidth('Logs and traces', 40, { font: 'sans' }))
            // The note beside the pill of a claim tag is in the font of the film. The word in the pill stays in the mono font.
            const shown = (kit: typeof serifKit) => (kit.claimTag(c, { word: 'MEASURED', note: 'Logs and traces', size: 40 }).draw!(3) as unknown as { note: { bounds(): { width: number } }; word: { bounds(): { width: number } } })
            expect(width(shown(serifKit).note)).toBeCloseTo(width(plain), 6)
            expect(width(shown(sans).note)).not.toBeCloseTo(width(plain), 0)
            expect(width(shown(serifKit).word)).toBeCloseTo(width(shown(sans).word), 6)
        })
    })

    it('gives the library functions of the same names the font of the film, and runs the same code', async () => {
        await inFilm(() => {
            const kit = sceneKit({ font: 'text-serif' }), font = { font: 'text-serif' } as const
            const long = 'one process for each microVM'
            // With the font and the size given, the function of the library and the function of the kit agree to the last digit.
            expect(kit.textWidth(long, 40)).toBe(textWidth(long, 40, font))
            expect(kit.fitSize(long, 300, 40)).toBe(fitSize(long, 300, 40, font))
            expect(kit.chip(long).box).toEqual(chip(long, { ...font, size: 28 }).box)
            expect(kit.chipRow([long, 'KVM'], { maxWidth: 500 }).box).toEqual(chipRow([long, 'KVM'], { maxWidth: 500, ...font, size: 28 }).box)
            expect(kit.namedBox(long, { width: 400, height: 100 }).name.bounds()).toEqual(namedBox(long, { width: 400, height: 100, ...font }).name.bounds())
            expect(kit.card({ title: long, width: 700 }).title!.bounds()).toEqual(card({ title: long, width: 700, ...font }).title!.bounds())
            // In another font the same text has another width, so a measure and its text must be in one font.
            expect(kit.chip(long).box.width).not.toBe(chip(long, { font: 'sans' }).box.width)
            expect(kit.font).toBe('text-serif')
            expect(sceneKit().font).toBe('text-serif')
        })
    })

    it('draws the source line dim, and a label and a heading in ink', async () => {
        await inFilm(() => {
            const kit = sceneKit()
            const ink = (node: { children: { get(prop: 'fill'): unknown }[] }) => JSON.stringify(node.children[0]!.get('fill'))
            const dim = ink(text('x', { color: 'dim' })), full = ink(text('x', { color: 'ink' }))
            expect(dim).not.toBe(full)
            expect(ink(kit.source('x'))).toBe(dim)
            expect(ink(kit.label('x', 0, 0))).toBe(full)
            expect(ink(kit.heading('x'))).toBe(full)
            expect(ink(kit.source('x', { color: 'ink' }))).toBe(full)
        })
    })

    it('starts the source line at the left edge of the area of the film', async () => {
        await inFilm(() => {
            const kit = sceneKit({ area: { left: -700 } })
            const note = kit.source('a note').bounds()
            expect(note.x).toBeGreaterThanOrEqual(-700)
            expect(note.x - -700).toBeLessThan(4)
        })
    })

    it('gives a row of chips the font and the look of the chips of the film', async () => {
        await inFilm(() => {
            const kit = sceneKit({ chip: { minWidth: 300, size: 30 } })
            // The least width of the chips of the film is the least width of each chip of a row too.
            expect(kit.chipRow(['a', 'b']).chips.map((made) => made.box.width)).toEqual([300, 300])
            expect(kit.chip('a').box.width).toBe(300)
            const serifRow = sceneKit().chipRow(['one process for each microVM']), sans = sceneKit({ font: 'sans' }).chipRow(['one process for each microVM'])
            expect(serifRow.box.width).not.toBe(sans.box.width)
            expect(serifRow.box.width).toBe(chipRow(['one process for each microVM'], { font: 'text-serif' }).box.width)
        })
    })

    it('has no helper that a film can make in one line from the library: no mono label, and no panel', () => {
        // `note` and `display` are here because they hold a size of the kit, which a film would type as a number.
        expect(Object.keys(sceneKit()).sort()).toEqual(['area', 'card', 'chip', 'chipRow', 'claimTag', 'display', 'fitSize', 'font', 'heading', 'label', 'left', 'namedBox', 'note', 'para', 'right', 'source', 'textWidth'])
    })

    it('makes a text with no place, for the layout: a label, a block, a note and a display line in the sizes of the kit', async () => {
        await inFilm(() => {
            const kit = sceneKit({ size: 50 })
            // With no x and no y, the text is at the origin, and it has the look that it has with a place.
            const free = kit.label('requests', { color: 'blue' }), placed = kit.label('requests', 120, 80, { color: 'blue' })
            expect([free.get('x'), free.get('y'), placed.get('x'), placed.get('y')]).toEqual([0, 0, 120, 80])
            expect(free.bounds().width).toBeCloseTo(placed.bounds().width, 6)
            // A text with no place takes the options of a text, as a text with a place does.
            expect([kit.label('requests', { size: 80 }).data['size'], kit.label('requests', 0, 0, { size: 80 }).data['size'], free.data['size']]).toEqual([80, 80, 50])
            expect(kit.left('requests').get('px')).toBe(0)
            expect(kit.right('requests').get('px')).toBeGreaterThan(0)
            // A block wraps at its width, with a place or with none.
            const long = 'one process for each microVM, and one thread for each virtual CPU'
            expect(kit.para(long, 400).bounds().width).toBeLessThanOrEqual(400)
            expect(kit.para(long, 400).bounds().height).toBeCloseTo(kit.para(long, -300, 0, 400).bounds().height, 6)
            // The note has the size of the source line, and the display line is 1.78 of the label: both follow the one size.
            expect(kit.note('our run').data['size']).toBe(kit.source('our run').data['size'])
            expect(kit.note('our run').data['size']).toBe(36)
            // A note is dim, as the source line is, and it takes a color of its own.
            const paint = (node: { chars: readonly { get(prop: 'fill'): unknown }[] }) => node.chars[0]!.get('fill')
            expect(paint(kit.note('our run'))).toEqual(paint(kit.source('our run')))
            expect(paint(kit.note('our run'))).not.toEqual(paint(kit.label('our run')))
            expect(paint(kit.note('our run', { color: 'ink' }))).toEqual(paint(kit.label('our run')))
            expect(kit.display('160 times faster').data['size']).toBe(89)
            expect(sceneKit().display('160 times faster').data['size']).toBe(64)
            expect(() => (kit.label as (content: string, x: number) => unknown)('requests', 120)).toThrow('the text "requests" has an x and no y')
            expect(() => kit.para(long, 0)).toThrow('para wraps at a width, more than 0, and it is 0')
        })
    })

    it('gives the area as a region that cuts into columns and rows, and the same region to a film with no kit', async () => {
        await inFilm(() => {
            const { area } = sceneKit({ area: { left: -800, right: 800 } })
            expect(area.columns(2).map((part) => [part.left, part.right])).toEqual([[-800, -24], [24, 800]])
            expect(area.rows([3, 1], 'none').map((part) => [part.top, part.bottom])).toEqual([[-400, 230], [230, 440]])
            expect(sceneArea()).toEqual(sceneKit().area)
            expect(sceneArea({ bottom: 300 }).height).toBe(700)
        })
    })
})
