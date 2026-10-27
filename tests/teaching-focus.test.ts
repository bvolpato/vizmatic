import { describe, expect, it } from 'vitest'
import { createFocusDirector, createTeachingFocus, mergeFocusRegions, type TeachingFocusCue } from '../src/teaching-focus'

function painter() {
    let alpha = 0.6
    const marks: { value: string, alpha: number }[] = []
    return { marks, alpha: () => alpha, paint: (value: string) => { marks.push({ value, alpha }); return value },
        rect() {}, text() {}, container() {}, labelScope() {}, circle() {},
        opacity(amount: number, draw: () => void) { const previous = alpha; alpha *= amount; try { draw() } finally { alpha = previous } },
        path() {},
    }
}
const current: TeachingFocusCue = { id: 'spoken', start: 1, targets: ['weight'], color: '#63deec', active: true,
    strength: 1, progress: 0.4, reveal: 1, phase: 'during' }

describe('semantic focus director', () => {
    it('dims unrelated marks while preserving frame alpha and callback return values for nested targets', () => {
        const p = painter(), focus = createFocusDirector(p, { cues: { spoken: current }, contextOpacity: 0.5 })
        focus.paint(() => p.paint('context'))
        const value = focus.target('parent', () => focus.target('weight', () => focus.paint(() => p.paint('weight'))))
        expect(value).toBe('weight')
        expect(p.marks).toEqual([{ value: 'context', alpha: 0.3 }, { value: 'weight', alpha: 0.6 }])
        expect(p.alpha()).toBe(0.6)
        expect(() => focus.target('weight', () => { throw new Error('failure') })).toThrow('failure')
        focus.paint(() => p.paint('after failure'))
        expect(p.marks.at(-1)?.alpha).toBe(0.3)
    })
    it('reveals keep geometry available at zero alpha and preserve completed results', () => {
        const p = painter(), before = { ...current, phase: 'before' as const, progress: 0, reveal: 0, active: false, strength: 0 }
        const focus = createFocusDirector(p, { cues: { spoken: before } })
        expect(focus.reveal('spoken', () => p.paint('future'))).toBe('future')
        expect(p.marks[0].alpha).toBe(0)
        expect(focus.visible('spoken')).toBe(false)
        const after = createFocusDirector(p, { cues: { spoken: { ...current, phase: 'after', active: false, progress: 1, reveal: 1 } } })
        expect(after.reveal('spoken', () => p.paint('result'))).toBe('result')
        expect(p.marks[1].alpha).toBe(0.6)
    })
    it('supports old unmeasured painters while rejecting unknown cues in measured production frames', () => {
        const p = painter(), plain = createFocusDirector(p)
        expect(plain.progress('unknown', 0.7)).toBe(0.7)
        expect(plain.reveal('unknown', () => 42)).toBe(42)
        expect(plain.visible('unknown')).toBe(true)
        expect(() => createFocusDirector(p, { strict: true, cues: {} }).progress('typo')).toThrow('Unknown narration cue')
        const latest = createFocusDirector(p, { cues: { spoken: current, next: { ...current, id: 'next', start: 2 } } })
        expect(latest.active?.id).toBe('next')
    })
    it('rejects inherited cue names in strict mode while accepting explicitly authored names', () => {
        const p = painter(), strict = createFocusDirector(p, { strict: true, cues: {} })
        for (const id of ['toString', 'constructor', '__proto__']) {
            expect(() => strict.progress(id, 0.75)).toThrow('Unknown narration cue')
        }
        const authored = createFocusDirector(p, { strict: true, cues: { toString: { ...current, id: 'toString' } } })
        expect(authored.progress('toString')).toBe(current.progress)
    })
    it('paints four external corner paths and restores opacity', () => {
        const p = painter(), paths: unknown[] = []
        p.path = (...args: unknown[]) => { paths.push(args) }
        createTeachingFocus(p).focusFrame({ bounds: { x: 100, y: 100, width: 200, height: 80 }, strength: 1 })
        expect(paths).toHaveLength(4)
        expect(p.alpha()).toBe(0.6)
    })
    it('moves focus annotation away from a neighboring label and omits it when crowded', () => {
        const p = painter(), paths: { x: number, y: number }[][] = []
        p.path = (...args: unknown[]) => { paths.push(args[0] as { x: number, y: number }[]) }
        const focus = createTeachingFocus(p), bounds = { x: 100, y: 100, width: 200, height: 80 }
        focus.focusFrame({ bounds, strength: 1, avoid: [{ x: 87, y: 87, width: 8, height: 8 }] })
        expect(paths).toHaveLength(4)
        expect(paths.every(points => points[1].x !== 92)).toBe(true)
        paths.length = 0
        focus.focusFrame({ bounds, strength: 1, avoid: [{ x: 0, y: 0, width: 400, height: 400 }] })
        expect(paths).toHaveLength(0)
        expect(p.alpha()).toBe(0.6)
    })
    it('keeps context visible without brightening marks above their authored alpha', () => {
        const p = painter(), focus = createFocusDirector(p, { cues: { spoken: current }, contextOpacity: 0.5, minimumContextAlpha: 0.26 })
        p.opacity(0.5, () => focus.paint(() => p.paint('fading endpoint'), 0.3))
        expect(p.marks[0].alpha).toBeCloseTo(0.26)
        p.opacity(0.2, () => focus.paint(() => p.paint('authored faint mark'), 0.12))
        expect(p.marks[1].alpha).toBeCloseTo(0.12)
        expect(p.alpha()).toBe(0.6)
    })
    it('merges adjacent cells of one subject while retaining distant plots separately', () => {
        expect(mergeFocusRegions([{ x: 0, y: 0, width: 100, height: 50 }, { x: 100, y: 0, width: 100, height: 50 },
            { x: 0, y: 200, width: 200, height: 50 }])).toEqual([
            { x: 0, y: 0, width: 200, height: 50 }, { x: 0, y: 200, width: 200, height: 50 },
        ])
    })
})
