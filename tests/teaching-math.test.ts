import { describe, expect, it } from 'vitest'
import {
    dotProduct, entropy, gaussian, lerpArray, multiplyMatrices, normalizeVector,
    sampleFunction, sampleGaussian, seededRandom, stableSoftmax,
} from '../src/teaching-math'

describe('teaching numerical utilities', () => {
    it('replays seeded samples within the random stream contract', () => {
        const first = seededRandom(104)
        const second = seededRandom(104)
        const values = Array.from({ length: 100 }, first)
        expect(values).toEqual(Array.from({ length: 100 }, second))
        expect(values.every((value) => value >= 0 && value < 1)).toBe(true)
        expect(values).not.toEqual(Array.from({ length: 100 }, seededRandom(105)))
        expect(() => seededRandom(NaN)).toThrow('safe integer')
    })

    it('interpolates vectors and multiplies dimensionally compatible arrays', () => {
        const from = [1, 3]
        expect(lerpArray(from, [5, -1], 0.25)).toEqual([2, 2])
        expect(lerpArray(from, [5, -1], 2)).toEqual([9, -5])
        expect(lerpArray([1e308, -1e308], [1e308, -1e308], 2)).toEqual([1e308, -1e308])
        expect(lerpArray([1e308], [0.9e308], 20)[0] / 1e308).toBeCloseTo(-1, 12)
        expect(lerpArray([1e308], [-1e308], 0.5)).toEqual([0])
        expect(() => lerpArray([1e308], [-1e308], 2)).toThrow('finite')
        expect(from).toEqual([1, 3])
        expect(dotProduct([2, -1, 4], [3, 5, 2])).toBe(9)
        expect(multiplyMatrices([[1, 2, 3], [4, 5, 6]], [[7, 8], [9, 10], [11, 12]])).toEqual([[58, 64], [139, 154]])
        expect(multiplyMatrices([[], []], [])).toEqual([[], []])
        expect(() => lerpArray([1], [1, 2], 0.5)).toThrow('equal lengths')
        expect(() => dotProduct([1], [1, 2])).toThrow('equal lengths')
        expect(() => multiplyMatrices([[1, 2]], [[1, 2]])).toThrow('inner dimensions')
        expect(() => multiplyMatrices([[1], [1, 2]], [[1]])).toThrow('rectangular')
        expect(() => dotProduct([Infinity], [1])).toThrow('finite')
        expect(() => multiplyMatrices([[Number.MAX_VALUE]], [[2]])).toThrow('finite')
    })

    it('computes softmax from large logits and preserves temperature behavior', () => {
        const probabilities = stableSoftmax([10000, 10001, 9999])
        expect(probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 14)
        expect(probabilities[1]).toBeGreaterThan(probabilities[0])
        expect(stableSoftmax([1e308, -1e308])).toEqual([1, 0])
        expect(stableSoftmax([4, 4], Number.MIN_VALUE)).toEqual([0.5, 0.5])
        expect(stableSoftmax([1, 2], 0.1)[1]).toBeGreaterThan(stableSoftmax([1, 2], 2)[1])
        expect(stableSoftmax([])).toEqual([])
        expect(() => stableSoftmax([1, Infinity])).toThrow('finite')
        expect(() => stableSoftmax([1], 0)).toThrow('positive')
    })

    it('measures entropy with zero terms and rejects unnormalized distributions', () => {
        expect(entropy([0.5, 0.5])).toBe(1)
        expect(entropy([0, 1])).toBeCloseTo(0)
        expect(entropy([0.25, 0.25, 0.25, 0.25])).toBe(2)
        expect(entropy([0.5, 0.5], Math.E)).toBeCloseTo(Math.log(2))
        expect(entropy([])).toBe(0)
        expect(() => entropy([0.2, 0.2])).toThrow('sum to one')
        expect(() => entropy([-0.1, 1.1])).toThrow('between zero and one')
        expect(() => entropy([1], 1)).toThrow('different from one')
    })

    it('normalizes large and small vectors without losing their direction', () => {
        expect(normalizeVector([3, 4])).toEqual([0.6, 0.8])
        expect(normalizeVector([0, 0])).toEqual([0, 0])
        expect(normalizeVector([])).toEqual([])
        expect(normalizeVector([1e308, 1e308])[0]).toBeCloseTo(Math.SQRT1_2)
        expect(normalizeVector([1e-308, 1e-308])[1]).toBeCloseTo(Math.SQRT1_2)
        expect(() => normalizeVector([NaN])).toThrow('finite')
    })

    it('samples both function endpoints and checks finite results', () => {
        expect(sampleFunction((x) => x * x, -1, 1, 3)).toEqual([{ x: -1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 1 }])
        expect(() => sampleFunction(() => Infinity, 0, 1)).toThrow('finite')
        expect(() => sampleFunction((x) => x, 1, 0)).toThrow('increase')
        expect(() => sampleFunction((x) => x, 0, 1, 1)).toThrow('at least two')
    })

    it('evaluates and samples a normal distribution using bounded random draws', () => {
        expect(gaussian(0, 1, 0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI))
        expect(gaussian(2, 3, -1)).toBeCloseTo(gaussian(2, 3, 5))
        expect(gaussian(0, 1, 1e300)).toBe(0)
        expect(() => gaussian(0, 0, 0)).toThrow('positive')
        const random = seededRandom(42)
        const samples = Array.from({ length: 10000 }, () => sampleGaussian(random))
        const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length
        const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length
        expect(Math.abs(mean)).toBeLessThan(0.04)
        expect(variance).toBeGreaterThan(0.94)
        expect(variance).toBeLessThan(1.06)
        expect(sampleGaussian(() => 0)).toBeCloseTo(0)
        expect(() => sampleGaussian(() => 1)).toThrow('[0, 1)')
    })
})
