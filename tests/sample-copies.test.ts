import { describe, expect, it } from 'vitest'
import { planSampleCopies } from '../src/sample-copies'

describe('planSampleCopies', () => {
    const sources = [{ id: 'A', x: 2, y: 4 }, { id: 'B', x: 2, y: 8 }]
    const slots = [
        { sourceId: 'B', x: 10, y: 4 },
        { sourceId: 'B', x: 10, y: 8 },
        { sourceId: 'A', x: 10, y: 12 },
    ]

    it('moves each copy from its own source and preserves earlier copies on a backward seek', () => {
        const plan = planSampleCopies(sources, slots)
        expect(plan.at(3).map(copy => [copy.sourceId, copy.x, copy.y])).toEqual([['B', 10, 4], ['B', 10, 8], ['A', 10, 12]])
        expect(plan.at(1.5)).toEqual([
            { sourceId: 'B', drawIndex: 0, occurrence: 1, x: 10, y: 4, progress: 1 },
            { sourceId: 'B', drawIndex: 1, occurrence: 2, x: 6, y: 8, progress: .5 },
        ])
        expect(plan.at(1)).toHaveLength(1)
        expect(plan.at(0)).toEqual([])
    })

    it('rejects ambiguous or missing sources before a frame can be drawn', () => {
        expect(() => planSampleCopies([sources[0], sources[0]], [])).toThrow(/unique/)
        expect(() => planSampleCopies(sources, [{ sourceId: 'C', x: 0, y: 0 }])).toThrow(/Unknown sample source/)
    })
})
