import { describe, expect, it } from 'vitest'
import { crossCorrelate2d, gaussianKernel } from '../src/primitives/image-kernels'

describe('2D image kernels', () => {
    it('uses the unflipped kernel orientation used by deep-learning cross-correlation', () => {
        const input = [[1, 2, 0], [3, 4, 5]]
        const kernel = [[1, 2], [4, 8]]
        const inputBefore = JSON.stringify(input)
        const kernelBefore = JSON.stringify(kernel)

        expect(crossCorrelate2d(input, kernel)).toEqual([[49, 58]])
        expect(JSON.stringify(input)).toBe(inputBefore)
        expect(JSON.stringify(kernel)).toBe(kernelBefore)
    })

    it('steps valid windows by the requested stride', () => {
        const input = [
            [1, 2, 3, 4],
            [5, 6, 7, 8],
            [9, 10, 11, 12],
            [13, 14, 15, 16],
        ]

        expect(crossCorrelate2d(input, [[1]], { stride: 2 })).toEqual([[1, 3], [9, 11]])
    })

    it('uses SAME_UPPER zero padding and ceil-sized outputs for same mode', () => {
        expect(crossCorrelate2d([[1, 2], [3, 4]], [
            [1, 1, 1],
            [1, 1, 1],
            [1, 1, 1],
        ], { padding: 'same' })).toEqual([[10, 10], [10, 10]])
        expect(crossCorrelate2d([[1, 2, 3]], [[1, 1]], { padding: 'same' })).toEqual([[3, 5, 3]])
        expect(crossCorrelate2d([[1, 2, 3], [4, 5, 6], [7, 8, 9]], [[1]], {
            padding: 'same',
            stride: 2,
        })).toEqual([[1, 3], [7, 9]])
    })

    it('preserves constant values in valid blur interiors and applies impulse weights', () => {
        const blur = [
            [1 / 16, 2 / 16, 1 / 16],
            [2 / 16, 4 / 16, 2 / 16],
            [1 / 16, 2 / 16, 1 / 16],
        ]
        const constant = Array.from({ length: 5 }, () => Array(5).fill(7))
        const impulse = Array.from({ length: 5 }, (_, row) =>
            Array.from({ length: 5 }, (_, column) => Number(row === 2 && column === 2)))

        expect(crossCorrelate2d(constant, blur)).toEqual(Array.from({ length: 3 }, () => Array(3).fill(7)))
        expect(crossCorrelate2d(impulse, blur)).toEqual([
            [1 / 16, 2 / 16, 1 / 16],
            [2 / 16, 4 / 16, 2 / 16],
            [1 / 16, 2 / 16, 1 / 16],
        ])
    })

    it('rejects malformed matrices, invalid options, and non-finite results', () => {
        expect(() => crossCorrelate2d([], [[1]])).toThrow('nonempty rectangular matrix')
        expect(() => crossCorrelate2d([[1, 2], [3]], [[1]])).toThrow('rectangular')
        expect(() => crossCorrelate2d([[1]], [[Number.NaN]])).toThrow('finite numbers')
        expect(() => crossCorrelate2d([[1]], [[1, 2]])).toThrow("must fit inside the input image")
        expect(() => crossCorrelate2d([[1]], [[1]], { stride: 0 })).toThrow('positive integer')
        expect(() => crossCorrelate2d([[1]], [[1]], { padding: 'reflect' as 'valid' })).toThrow("'valid' or 'same'")
        expect(() => crossCorrelate2d([[Number.MAX_VALUE]], [[2]])).toThrow('output values must be finite')
    })
})

describe('sampled Gaussian kernels', () => {
    it('returns symmetric normalized weights and keeps a constant valid image unchanged', () => {
        const kernel = gaussianKernel(3, 1)
        const total = kernel.flat().reduce((sum, value) => sum + value, 0)

        expect(total).toBeCloseTo(1, 14)
        expect(kernel).toEqual(kernel.map(row => [...row].reverse()))
        expect(kernel).toEqual(kernel.map((_, row) => kernel[kernel.length - 1 - row]))
        expect(kernel[1][1]).toBeGreaterThan(kernel[0][0])
        expect(crossCorrelate2d(Array.from({ length: 3 }, () => Array(3).fill(12)), kernel)[0][0]).toBeCloseTo(12, 12)
    })

    it('normalizes safely for very small and large finite sigma values', () => {
        expect(gaussianKernel(3, 1e-200)).toEqual([[0, 0, 0], [0, 1, 0], [0, 0, 0]])
        const broad = gaussianKernel(3, 1e200)
        expect(broad.flat().reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 14)
        expect(broad.flat().every(Number.isFinite)).toBe(true)
    })

    it('requires a positive odd size and positive finite sigma', () => {
        expect(() => gaussianKernel(0, 1)).toThrow('positive odd integer')
        expect(() => gaussianKernel(4, 1)).toThrow('positive odd integer')
        expect(() => gaussianKernel(3, 0)).toThrow('positive finite number')
        expect(() => gaussianKernel(3, Number.POSITIVE_INFINITY)).toThrow('positive finite number')
    })
})
