import { describe, expect, it } from 'vitest'
import { createPolylineMorph, morphPolyline } from '../src/path-morph'
import type { MotionPoint } from '../src/motion'

describe('polyline morphing', () => {
    it('prepares a geometry snapshot and returns independent samples for repeated frames', () => {
        const from = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
        const to = [{ x: 0, y: 10 }, { x: 10, y: 10 }]
        const sample = createPolylineMorph(from, to, { samples: 3 })
        from[1].x = 100
        to[0].y = 100
        const frame = sample(0.5)
        expect(frame).toEqual([{ x: 0, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 5 }])
        frame[0].x = 999
        expect(sample(0.5)[0]).toEqual({ x: 0, y: 5 })
        expect(sample(0)[2]).toEqual({ x: 10, y: 0 })
        expect(sample(1)[0]).toEqual({ x: 0, y: 10 })
    })

    it('rejects finite vertices whose total arc length overflows', () => {
        expect(() => createPolylineMorph([{ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }], [{ x: 0, y: 0 }]))
            .toThrow('Polyline morph arc length must be finite')
    })

    it('resamples different vertex counts by arc length and interpolates the matching positions', () => {
        const from: readonly MotionPoint[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
        const to: readonly MotionPoint[] = [
            { x: 0, y: 10 },
            { x: 10, y: 10 },
            { x: 10, y: 0 },
        ]

        expect(morphPolyline(from, to, 0.5, { samples: 3 })).toEqual([
            { x: 0, y: 5 },
            { x: 7.5, y: 5 },
            { x: 10, y: 0 },
        ])
    })

    it('uses smoothstep by default and supports caller easing', () => {
        const from = [{ x: 0, y: 0 }]
        const to = [{ x: 8, y: 4 }]

        expect(morphPolyline(from, to, 0.5, { samples: 2 })).toEqual([
            { x: 4, y: 2 },
            { x: 4, y: 2 },
        ])
        expect(morphPolyline(from, to, 0.5, { samples: 2, easing: (value) => value * value })).toEqual([
            { x: 2, y: 1 },
            { x: 2, y: 1 },
        ])
    })

    it('clamps finite progress and preserves resampled endpoint geometry', () => {
        const from = [{ x: 0, y: 1 }, { x: 4, y: 1 }]
        const to = [{ x: 2, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 7 }]

        expect(morphPolyline(from, to, -5, { samples: 3 })).toEqual([
            { x: 0, y: 1 },
            { x: 2, y: 1 },
            { x: 4, y: 1 },
        ])
        expect(morphPolyline(from, to, 5, { samples: 3 })).toEqual([
            { x: 2, y: 3 },
            { x: 2, y: 5 },
            { x: 2, y: 7 },
        ])
    })

    it('handles zero-length paths and duplicate vertices', () => {
        const from = [{ x: 1, y: 1 }, { x: 1, y: 1 }]
        const to = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }]

        expect(morphPolyline(from, to, 0.5, { samples: 3 })).toEqual([
            { x: 0.5, y: 0.5 },
            { x: 1.5, y: 0.5 },
            { x: 2.5, y: 0.5 },
        ])
        expect(morphPolyline(from, from, 0.5, { samples: 4 })).toEqual([
            { x: 1, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: 1 },
            { x: 1, y: 1 },
        ])
    })

    it('returns independent points without mutating frozen inputs', () => {
        const from = Object.freeze([Object.freeze({ x: 0, y: 0 }), Object.freeze({ x: 6, y: 0 })])
        const to = Object.freeze([Object.freeze({ x: 0, y: 6 }), Object.freeze({ x: 6, y: 6 })])
        const result = morphPolyline(from, to, 0.5, { samples: 3 })

        expect(result).toEqual([{ x: 0, y: 3 }, { x: 3, y: 3 }, { x: 6, y: 3 }])
        expect(result[0]).not.toBe(from[0])
        expect(result[0]).not.toBe(to[0])
        result[0]!.x = 99
        expect(from[0]).toEqual({ x: 0, y: 0 })
        expect(to[0]).toEqual({ x: 0, y: 6 })
    })

    it('rejects empty paths, invalid coordinates, bad samples, non-finite progress, and bad easing', () => {
        const point = { x: 0, y: 0 }

        expect(() => morphPolyline([], [point], 0.5)).toThrow('Start polyline must be a non-empty array')
        expect(() => morphPolyline([point], [], 0.5)).toThrow('End polyline must be a non-empty array')
        expect(() => morphPolyline([{ x: Number.NaN, y: 0 }], [point], 0.5)).toThrow(
            'Start point 0 coordinates must be finite',
        )
        expect(() => morphPolyline([point], [{ x: 0, y: Infinity }], 0.5)).toThrow(
            'End point 0 coordinates must be finite',
        )
        expect(() => morphPolyline([point], [point], Number.NaN)).toThrow(
            'Polyline morph progress must be finite',
        )
        expect(() => morphPolyline([point], [point], 0.5, { samples: 1 })).toThrow(
            'samples must be an integer of at least 2',
        )
        expect(() => morphPolyline([point], [point], 0.5, { samples: 2.5 })).toThrow(
            'samples must be an integer of at least 2',
        )
        expect(() => morphPolyline([point], [point], 0.5, { samples: 4097 })).toThrow(
            'cannot exceed 4096',
        )
        expect(() => morphPolyline([point], [{ x: 1, y: 0 }], 0.5, { easing: () => Number.NaN })).toThrow(
            'easing must return a finite number',
        )
    })
})
