import { describe, expect, it } from 'vitest'
import { createCueTrack } from '../src/teaching-cues'

describe('semantic discrete cue tracks', () => {
    it('holds one complete snapshot across beats and commits exactly at its authored cue', () => {
        const initial = { cutoff: 540, age: 8, eligible: ['H1'] }
        const noon = { cutoff: 720, age: 3.5, eligible: ['H1', 'H2'] }
        const afternoon = { cutoff: 960, age: 4, eligible: ['H1', 'H2', 'H3'] }
        const track = createCueTrack({
            initial: { id: '09:00', snapshot: initial },
            cues: [
                { id: '12:00', beat: 3, at: 0.2, snapshot: noon },
                { id: '16:00', beat: 4, at: 0, snapshot: afternoon },
            ],
        })
        const first = track.sample({ beat: 0, beatP: 0 })
        expect(first).toEqual({ id: '09:00', snapshot: initial })
        expect(track.sample({ beat: 2, beatP: 1 })).toBe(first)
        expect(track.sample({ beat: 3, beatP: 0.199999 })).toBe(first)
        expect(track.sample({ beat: 3, beatP: 0.2 }).snapshot).toBe(noon)
        expect(track.sample({ beat: 3, beatP: 0.9 }).snapshot).toBe(noon)
        expect(track.sample({ beat: 3, beatP: 1 }).snapshot).toBe(afternoon)
        expect(track.sample({ beat: 10, beatP: 0.5 }).snapshot).toBe(afternoon)
        expect(Object.isFrozen(first)).toBe(true)
    })

    it('captures cue definitions without mutating or interpolating the supplied model snapshots', () => {
        const values = { bars: [0, 1], reward: 0 }
        const cue = { id: 'pass', beat: 0, at: 0.5, snapshot: { bars: [1, 0], reward: 1 } }
        const track = createCueTrack({ initial: { id: 'fail', snapshot: values }, cues: [cue] })
        cue.at = 0.1
        cue.id = 'changed'
        expect(track.sample({ beat: 0, beatP: 0.49 }).snapshot).toBe(values)
        expect(track.sample({ beat: 0, beatP: 0.5 })).toEqual({ id: 'pass', snapshot: cue.snapshot })
        expect(Object.isFrozen(values)).toBe(false)
        expect(createCueTrack({ initial: { id: 'constant', snapshot: 42 }, cues: [] }).sample({ beat: 99, beatP: 1 }).snapshot).toBe(42)
        expect(createCueTrack({ initial: { id: 'before', snapshot: 0 }, cues: [
            { id: 'at-start', beat: 0, at: 0, snapshot: 1 },
        ] }).sample({ beat: 0, beatP: 0 }).id).toBe('at-start')
    })

    it('rejects ambiguous order, equivalent boundaries, repeated identities and invalid positions', () => {
        const initial = { id: 'initial', snapshot: 0 }
        const cue = { id: 'next', beat: 1, at: 0.5, snapshot: 1 }
        expect(() => createCueTrack({ initial, cues: [cue, { ...cue, id: 'earlier', beat: 0 }] })).toThrow('strictly increasing')
        expect(() => createCueTrack({ initial, cues: [{ ...cue, at: 1 }, { ...cue, id: 'same', beat: 2, at: 0 }] })).toThrow('strictly increasing')
        expect(() => createCueTrack({ initial, cues: [{ ...cue, id: 'initial' }] })).toThrow('unique')
        for (const invalid of [{ beat: -1 }, { beat: 0.5 }, { at: NaN }, { at: 1.1 }]) {
            expect(() => createCueTrack({ initial, cues: [{ ...cue, ...invalid }] })).toThrow()
        }
        const track = createCueTrack({ initial, cues: [] })
        expect(() => track.sample({ beat: 1, beatP: Infinity })).toThrow('progress')
        expect(() => track.sample({ beat: -1, beatP: 0 })).toThrow('nonnegative')
        expect(() => track.sample({ beat: Number.MAX_SAFE_INTEGER, beatP: 1 })).toThrow('safe integer range')
    })
})
