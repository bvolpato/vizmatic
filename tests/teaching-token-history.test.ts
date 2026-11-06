import { describe, expect, it } from 'vitest'
import { assertTokenHistoryTransition, createTeachingTokenHistory, tokenHistoryState, type TokenHistoryOptions } from '../src/teaching-token-history'
import type { CanvasPainter } from '../src/canvas-components'

const prompt = [101, 102, 103].map((token, i) => ({ id: `prompt-${i}`, token }))
const accepted = [201, 202].map((token, i) => ({ id: `answer-${i}`, token }))
const history = { prompt, accepted, processed: [...prompt, accepted[0]], emitted: accepted }

function sample(progress: number) { return tokenHistoryState({ ...history, phase: 'replay', replayProgress: progress }) }

describe('token occurrence history and replay', () => {
    it('reconstructs the exact processed prefix without resampling or redelivering accepted output', () => {
        const original = tokenHistoryState(history), dropped = tokenHistoryState({ ...history, phase: 'dropped' })
        expect(original.kv.map(t => t.token)).toEqual([101, 102, 103, 201])
        expect(dropped.kv).toEqual([])
        for (const progress of [0, 0.125, 0.5, 0.875, 1]) {
            const state = sample(progress)
            expect(state.kv).toEqual(history.processed.slice(0, Math.floor(progress * 4)))
            expect(state.accepted).toEqual(accepted)
            expect(state.emitted).toEqual(accepted)
            expect(state.pendingAccepted.map(t => t.token)).toEqual([202])
            assertTokenHistoryTransition(dropped, state)
        }
        expect(sample(0.125).moving).toMatchObject({ token: prompt[0], position: 0, progress: 0.5 })
        expect(sample(1).moving).toBeNull()
        expect(sample(0.5)).toEqual(sample(0.5))
    })

    it('distinguishes repeated vocabulary IDs by occurrence and rejects changed identity or reordered prefixes', () => {
        const sameVocabulary = { ...history, prompt: prompt.map(t => ({ ...t, token: 101 })),
            processed: [...prompt.map(t => ({ ...t, token: 101 })), accepted[0]] }
        expect(tokenHistoryState(sameVocabulary).prompt.map(t => t.token)).toEqual([101, 101, 101])
        expect(() => tokenHistoryState({ ...history, processed: [prompt[1], prompt[0]] })).toThrow('ordered occurrence prefix')
        expect(() => tokenHistoryState({ ...history, processed: [{ ...prompt[0], token: 999 }] })).toThrow('ordered occurrence prefix')
        expect(() => tokenHistoryState({ ...history, emitted: [accepted[1]] })).toThrow('ordered occurrence prefix')
        expect(() => tokenHistoryState({ ...history, accepted: [{ ...accepted[0], id: prompt[0].id }] })).toThrow('distinct occurrence IDs')
    })

    it('rejects accepted or delivered growth across a drop or replay boundary', () => {
        const before = tokenHistoryState(history), next = { id: 'answer-2', token: 203 }
        const changed = tokenHistoryState({ ...history, accepted: [...accepted, next], processed: [...prompt, ...accepted], phase: 'replay', replayProgress: 0 })
        expect(() => assertTokenHistoryTransition(before, changed)).toThrow('cannot sample or emit')
        const partialDelivery = tokenHistoryState({ ...history, emitted: accepted.slice(0, 1), phase: 'dropped' })
        expect(() => assertTokenHistoryTransition(partialDelivery, sample(1))).toThrow('cannot sample or emit')
        const restored = tokenHistoryState(history)
        assertTokenHistoryTransition(sample(1), restored)
        const ordinaryNext = tokenHistoryState({ ...history, accepted: [...accepted, next], processed: [...prompt, ...accepted], emitted: [...accepted, next] })
        assertTokenHistoryTransition(restored, ordinaryNext)
        expect(() => assertTokenHistoryTransition(ordinaryNext, restored)).toThrow('ordered occurrence prefix')
    })

    it('requires prompt completion and consumption of pending input before another ordinary sample', () => {
        const p = { id: 'prompt', token: 10 }, a = { id: 'a', token: 20 }, b = { id: 'b', token: 21 }
        expect(() => tokenHistoryState({ prompt: [p], accepted: [a], processed: [], emitted: [a] })).toThrow('complete processed prompt')
        const before = tokenHistoryState({ prompt: [p], accepted: [a], processed: [p], emitted: [a] })
        expect(before.pendingAccepted).toEqual([a])
        expect(() => tokenHistoryState({ prompt: [p], accepted: [a, b], processed: [p], emitted: [a, b] })).toThrow('at most one')
        expect(() => assertTokenHistoryTransition(before, { ...before, accepted: [a, b], emitted: [a, b] })).toThrow('at most one')
        const after = tokenHistoryState({ prompt: [p], accepted: [a, b], processed: [p, a], emitted: [a, b] })
        assertTokenHistoryTransition(before, after)
        expect(after.pendingAccepted).toEqual([b])
    })

    it('uses detached immutable ledgers and explicit finite replay progress at any frame order', () => {
        const input = { ...history, accepted: accepted.map(t => ({ ...t })), emitted: accepted.map(t => ({ ...t })) }
        const before = tokenHistoryState(input)
        input.accepted[0].token = 999
        expect(before.accepted[0].token).toBe(201)
        expect(Object.isFrozen(before.emitted[0])).toBe(true)
        const middle = sample(0.375)
        sample(0.9)
        sample(0.1)
        expect(sample(0.375)).toEqual(middle)
        expect(() => tokenHistoryState({ ...history, phase: 'replay' })).toThrow('explicit progress')
        for (const replayProgress of [NaN, Infinity, -0.1, 1.1]) expect(() => sample(replayProgress)).toThrow('between zero and one')
    })

    it('paints a moving copy into KV while the delivered lane remains unchanged through checked scopes', () => {
        const texts: { text: string, x: number, y: number }[] = [], targets: string[] = []
        const painter: CanvasPainter = {
            rect() {}, circle() {}, opacity(_alpha, draw) { draw() },
            text(text, x, y) { texts.push({ text, x, y }) },
            container(_bounds, draw) { draw() },
            labelScope(_bounds, draw) { draw() },
            target(id, draw) { targets.push(id); return draw() },
        }
        const draw = createTeachingTokenHistory(painter)
        const state = draw({ ...history, phase: 'replay', replayProgress: 0.125,
            x: 100, y: 100, width: 1600, height: 650, focusPrefix: 'request-B' })
        expect(state.moving?.token.token).toBe(101)
        expect(state.kv).toEqual([])
        expect(state.emitted.map(t => t.token)).toEqual([201, 202])
        expect(targets).toContain('request-B-replay')
        expect(targets).toContain('request-B-pending')
        const copying = texts.filter(t => t.text === '101')
        expect(copying).toHaveLength(3) // Prompt, retained processed prefix, moving copy.
        expect(copying[2].y).toBeGreaterThan(copying[1].y)
        const guarded: CanvasPainter = { ...painter, labelScope() { throw new Error('host containment') } }
        expect(() => createTeachingTokenHistory(guarded)({ ...history, x: 0, y: 0, width: 1600, height: 650 })).toThrow('host containment')
    })

    it('keeps stroked occurrence cells inside the checked outer container', () => {
        let active: { x: number, y: number, width: number, height: number } | undefined
        const painter: CanvasPainter = {
            rect(x, y, width, height) {
                if (active && (x - 1 < active.x || y - 1 < active.y || x + width + 1 > active.x + active.width || y + height + 1 > active.y + active.height)) {
                    throw new Error('stroked cell escaped the outer bounds')
                }
            },
            text() {}, circle() {}, opacity(_a, draw) { draw() }, labelScope(_b, draw) { draw() },
            container(bounds, draw) { active = bounds; try { draw() } finally { active = undefined } },
        }
        expect(() => createTeachingTokenHistory(painter)({ ...history, x: 100, y: 310, width: 1700, height: 620, fontSize: 30 })).not.toThrow()
    })

    it('rejects unreadable geometry and malformed vocabulary values before drawing', () => {
        const painter: CanvasPainter = { rect() {}, text() {}, circle() {}, container(_b, draw) { draw() }, labelScope(_b, draw) { draw() }, opacity(_a, draw) { draw() } }
        expect(() => createTeachingTokenHistory(painter)({ ...history, x: 0, y: 0, width: 350, height: 100 })).toThrow('five readable lanes')
        const malformed = { ...history, prompt: [{ id: 'bad', token: NaN }], processed: [] }
        expect(() => tokenHistoryState(malformed)).toThrow('vocabulary ID')
        expect(() => tokenHistoryState({ ...history, phase: 'unknown' } as unknown as TokenHistoryOptions)).toThrow('Unknown')
    })

    it('keeps replay copies inside narrow occurrence columns throughout their motion', () => {
        let active: { x: number, y: number, width: number, height: number } | undefined
        const painter: CanvasPainter = {
            rect(x, y, width, height) {
                if (active) {
                    expect(x - 1).toBeGreaterThanOrEqual(active.x)
                    expect(y - 1).toBeGreaterThanOrEqual(active.y)
                    expect(x + width + 1).toBeLessThanOrEqual(active.x + active.width)
                    expect(y + height + 1).toBeLessThanOrEqual(active.y + active.height)
                }
            },
            text() {}, circle() {}, opacity(_alpha, draw) { draw() }, labelScope(_bounds, draw) { draw() },
            container(bounds, draw) { active = bounds; try { draw() } finally { active = undefined } },
        }
        const token = { id: 'only-prompt', token: 101 }
        for (const width of [311, 319, 333, 340, 400]) {
            for (const replayProgress of [0.01, 0.1, 0.5, 0.65, 0.8, 0.9, 0.99]) {
                createTeachingTokenHistory(painter)({ prompt: [token], accepted: [], processed: [token], emitted: [],
                    phase: 'replay', replayProgress, x: 0, y: 0, width, height: 650 })
            }
        }
    })
})
