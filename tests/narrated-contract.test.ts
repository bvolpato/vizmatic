import { describe, expect, it } from 'vitest'
import { circle, compileFilm, fadeIn, film, narrated, narration, type TimingFile, type SceneFunction } from '../src/stage/index'

const timing: TimingFile = {
    intro: 0, lead: 0.5, gap: 0.4,
    scenes: ['one', 'two', 'three'].map((id) => ({ id, beats: [{ say: id, duration: 1, hold: 1, words: [{ text: id, start: 0, end: 0.8 }] }] })),
}
const build = async (voice = timing, scenes: Record<string, SceneFunction> = { one: () => {}, two: () => {}, three: () => {} }) =>
    compileFilm(narrated({ timing: voice, scenes, fps: 10 }))

describe('external narrated timing', () => {
    it('checks cue use when a film reads its clock from the scene list', async () => {
        const voice = { scenes: [{ id: 'one', title: 'First step', beats: [{ ...timing.scenes[0].beats[0], cues: [{ id: 'start', phrase: 'one' }] }] }] }
        await compileFilm(film((s) => {
            const scene = narration(s, voice).scenes[0]
            expect(scene.title).toBe('First step')
            scene.cue('start')
        }))
        voice.scenes[0].beats[0].cues.push({ id: 'other', phrase: 'one' })
        await expect(compileFilm(film((s) => { narration(s, voice).scenes[0].cue('start') }))).rejects.toThrow('scene "one": other')
    })
    it('checks the actual first scene start against the title card', async () => {
        const voice = { ...timing, intro: 2, lead: 3, scenes: [{ ...timing.scenes[0], start: 0.5 }, ...timing.scenes.slice(1)] }
        await expect(build(voice)).rejects.toThrow('the first word starts at 0.5 seconds')
        expect((await build({ ...voice, intro: 0 })).duration).toBeCloseTo(7.7)
    })

    it.each<[string, unknown, string]>([
        ['duration', '1', 'duration'],
        ['duration', Infinity, 'duration'],
        ['hold', '1', 'hold'],
        ['hold', -0.1, 'hold'],
        ['words', [{ text: 'one', start: 0, end: 1.1 }], 'words[0].end'],
        ['words', [{ text: 'one', start: 0.5, end: 0.1 }], 'words[0].end'],
        ['words', [{ text: 'one', start: '0', end: 0.8 }], 'words[0].start'],
        ['words', [{ text: 'red', start: 0.8, end: 1 }, { text: 'blue', start: 0.2, end: 0.4 }], 'words[1].start'],
        ['words', null, 'words'],
        ['say', undefined, 'say'],
    ])('rejects malformed %s before constructing the timeline', async (key, value, field) => {
        const voice = structuredClone(timing)
        Object.assign(voice.scenes[0].beats[0], { [key]: value })
        await expect(build(voice)).rejects.toThrow(`scene "one": beats[0].${field}`)
    })

    it.each(['lead', 'gap', 'intro', 'tail'])('requires a finite numeric %s', async (field) => {
        await expect(build({ ...timing, [field]: '1' } as never)).rejects.toThrow(field)
        await expect(build({ ...timing, [field]: Infinity })).rejects.toThrow(field)
    })
})

describe('scene play boundaries', () => {
    it.each(['one', 'two', 'three'])('rejects a play one millisecond past %s', async (id) => {
        const scenes: Record<string, SceneFunction> = { one: () => {}, two: () => {}, three: () => {} }
        scenes[id] = (s, c, clock) => c.at(0, () => {
            const limit = id === 'three' ? clock.end : c.end
            s.play(fadeIn(circle(40), { duration: limit - c.start + 0.001 }))
        })
        await expect(build(timing, scenes)).rejects.toThrow(`scene "${id}": the play of fadeIn`)
    })

    it('keeps the built-in clear fade that ends just after a scene', async () => {
        await expect(build(timing, { one: (s, c) => { const node = circle(40); s.add(node); c.clear([node]) }, two: () => {}, three: () => {} })).resolves.toBeDefined()
    })
})
