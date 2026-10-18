import { describe, expect, it } from 'vitest'
import { arcSwap, pointAlongPath, smoothstep, tracePolyline, type MotionPoint } from '../src/motion'

describe('motion geometry', () => {
    it('clamps smoothstep and eases both ends to exact endpoints', () => {
        expect(smoothstep(-2)).toBe(0)
        expect(smoothstep(0)).toBe(0)
        expect(smoothstep(0.5)).toBe(0.5)
        expect(smoothstep(1)).toBe(1)
        expect(smoothstep(2)).toBe(1)
        expect(() => smoothstep(Number.NaN)).toThrow('Motion progress must be finite')
    })

    it('swaps points along separated mirrored arcs and preserves exact endpoints', () => {
        const from = { x: 10, y: 20 }
        const to = { x: 210, y: 20 }

        expect(arcSwap(from, to, -1)).toEqual([from, to])
        expect(arcSwap(from, to, 2)).toEqual([to, from])

        const middle = arcSwap(from, to, 0.5)
        expect(middle[0].x).toBe(110)
        expect(middle[1].x).toBe(110)
        expect(middle[0].y).toBe(100)
        expect(middle[1].y).toBe(-60)

        for (let step = 1; step < 100; step += 1) {
            const [first, second] = arcSwap(from, to, step / 100)
            expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(0)
        }

        expect(arcSwap(from, to, 0.25, { easing: (progress) => progress })[0]).toEqual({ x: 60, y: 80 })
    })

    it('traces and follows a polyline by its actual arc length', () => {
        const path = [
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 4 },
        ]

        expect(tracePolyline(path, 0.5)).toEqual([
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 0.5 },
        ])
        expect(pointAlongPath(path, 0.5)).toEqual({ x: 3, y: 0.5 })
        expect(pointAlongPath(path, 0)).toEqual(path[0])
        expect(pointAlongPath(path, 1)).toEqual(path[2])
        expect(tracePolyline(path, -1)).toEqual([path[0]])
        expect(tracePolyline(path, 2)).toEqual(path)
    })

    it('skips zero-length segments while keeping complete input at the endpoint', () => {
        const path = [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 4 },
        ]

        expect(tracePolyline(path, 0.5)).toEqual([
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 0.5 },
        ])
        expect(tracePolyline(path, 1)).toEqual(path)
        expect(pointAlongPath(path, 0.5)).toEqual({ x: 3, y: 0.5 })
        expect(pointAlongPath([{ x: 2, y: 5 }, { x: 2, y: 5 }], 0.6)).toEqual({ x: 2, y: 5 })
    })

    it('handles empty and single-point paths without exposing input objects', () => {
        const point = { x: 4, y: -7 }
        const single: readonly MotionPoint[] = [point]

        expect(tracePolyline([], 0.5)).toEqual([])
        expect(tracePolyline(single, 0.5)).toEqual([point])
        expect(tracePolyline(single, 0.5)[0]).not.toBe(point)
        expect(pointAlongPath(single, 0.5)).toEqual(point)
        expect(() => pointAlongPath([], 0.5)).toThrow('Cannot find a point along an empty path')
    })

    it('does not mutate paths or share their point objects with results', () => {
        const path = [{ x: 0, y: 0 }, { x: 8, y: 0 }]
        const original = structuredClone(path)
        const trace = tracePolyline(path, 0.75)
        const followed = pointAlongPath(path, 0.75)

        expect(path).toEqual(original)
        expect(trace[0]).not.toBe(path[0])
        expect(followed).not.toBe(path[1])
        trace[0]!.x = 99
        expect(path).toEqual(original)
    })

    it('rejects non-finite coordinates, progress, lift, and easing results', () => {
        expect(() => arcSwap({ x: Number.NaN, y: 0 }, { x: 1, y: 0 }, 0.5)).toThrow('coordinates must be finite')
        expect(() => arcSwap({ x: 0, y: 0 }, { x: 1, y: 0 }, Infinity)).toThrow('Motion progress must be finite')
        expect(() => arcSwap({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.5, { lift: Infinity })).toThrow('lift must be finite')
        expect(() => arcSwap({ x: 0, y: 0 }, { x: 1, y: 0 }, 0.5, { easing: () => Infinity })).toThrow('finite number')
        expect(() => tracePolyline([{ x: 0, y: 0 }, { x: 1, y: Infinity }], 0.5)).toThrow('coordinates must be finite')
        expect(() => tracePolyline([{ x: 0, y: 0 }], Number.NaN)).toThrow('Motion progress must be finite')
    })
})
