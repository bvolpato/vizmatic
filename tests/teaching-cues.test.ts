import { describe, expect, it } from 'vitest'
import { assertCueReveal, createCueTrack } from '../src/teaching-cues'

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

describe('a result held for a spoken cue', () => {
    // Body frames from the 30 fps estimated preview of CUDA c15-b12.
    const mean = { result: 'Mean loss ≈ 0.693', phrase: 'point six nine three', fromFrame: 37664, cueFrame: 37791 }

    it('rejects the rounded mean on “Together the tickets” and locates the corrected cut', () => {
        // Sample the headline state. The two ticket fractions and the weight can already be on screen.
        const visibleAt = (reveal: number) => (frame: number) => {
            const headline = 'Full-batch weight    0 + 1 = 1' + (frame >= reveal ? '      Mean loss ≈ ' + Math.log(2).toFixed(3) : '')
            return headline.includes(mean.result)
        }
        expect(() => assertCueReveal({ ...mean, visibleAt: visibleAt(37635) }))
            .toThrow(/Mean loss ≈ 0.693.*37664.*point six nine three.*37791/)
        expect(assertCueReveal({ ...mean, visibleAt: visibleAt(37791) }))
            .toEqual({ lastHiddenFrame: 37790, firstVisibleFrame: 37791 })
    })

    it('finds an early flash even if the last prediction frame is clear', () => {
        expect(() => assertCueReveal({ ...mean, visibleAt: frame => frame === 37701 || frame >= mean.cueFrame }))
            .toThrow(/37701/)
    })

    it('allows a declared fade and reports a result still missing at its deadline', () => {
        const fade = { ...mean, byFrame: 37796 }
        expect(assertCueReveal({ ...fade, visibleAt: frame => frame === fade.byFrame }))
            .toEqual({ lastHiddenFrame: 37795, firstVisibleFrame: 37796 })
        expect(() => assertCueReveal({ ...fade, visibleAt: () => false })).toThrow(/Mean loss ≈ 0.693.*37796/)
    })

    it('requires a prediction frame, an ordered window, and a definite observation', () => {
        const visibleAt = () => false
        for (const invalid of [{ fromFrame: -1 }, { cueFrame: 0.5 }, { fromFrame: mean.cueFrame }, { byFrame: mean.cueFrame - 1 }]) {
            expect(() => assertCueReveal({ ...mean, ...invalid, visibleAt })).toThrow(/frame/i)
        }
        expect(() => assertCueReveal({ ...mean, visibleAt: () => undefined as unknown as boolean })).toThrow(/boolean/)
    })
})
