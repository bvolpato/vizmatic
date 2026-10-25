import { describe, expect, it } from 'vitest'
import { renderToSvg } from '../src/render'
import { AttentionMatrix, scaledDotProductAttention } from '../src/primitives/science-ai'
import { compositeColor, getThemeColors } from '../src/theme'
import { analyzeContrast } from '../src/diagnostics'

describe('single-head scaled dot-product attention', () => {
    it('scales scores by feature dimension, normalizes, and computes weighted values', () => {
        const result = scaledDotProductAttention([[2, 0]], [[1, 0], [0, 1]], [[10, 0], [0, 20]])
        const p = Math.exp(Math.sqrt(2)) / (Math.exp(Math.sqrt(2)) + 1)
        expect(result.scores[0][0]).toBeCloseTo(Math.sqrt(2))
        expect(result.scores[0][1]).toBe(0)
        expect(result.weights[0][0]).toBeCloseTo(p)
        expect(result.weights[0][1]).toBeCloseTo(1 - p)
        expect(result.output[0][0]).toBeCloseTo(10 * p)
        expect(result.output[0][1]).toBeCloseTo(20 * (1 - p))
    })

    it('combines explicit and causal masks without leaking future values', () => {
        const result = scaledDotProductAttention([[1], [1], [1]], [[1], [2], [3]], [[5], [10], [1e9]], { causal: true, mask: [[true, true, true], [true, false, true], [true, true, false]] })
        expect(result.scores[0]).toEqual([1, null, null])
        expect(result.weights[0]).toEqual([1, 0, 0])
        expect(result.weights[1]).toEqual([1, 0, 0])
        expect(result.output[0]).toEqual([5])
        expect(result.output[1]).toEqual([5])
        expect(result.output[2][0]).toBeLessThan(10)
        expect(result.weights[2].reduce((a, b) => a + b, 0)).toBeCloseTo(1)
        expect(() => scaledDotProductAttention([[1]], [[1]], [[1]], { mask: [[false]] })).toThrow('fully masked')
    })

    it('is stable at large finite scores, preserves inputs, and rejects invalid tensors', () => {
        const queries = [[1000]], keys = [[1000], [999]], values = [[1], [2]]
        const copy = JSON.stringify({ queries, keys, values })
        expect(scaledDotProductAttention(queries, keys, values).weights[0]).toEqual([1, 0])
        expect(JSON.stringify({ queries, keys, values })).toBe(copy)
        expect(() => scaledDotProductAttention([[1, 2]], [[1]], [[1]])).toThrow('feature dimension')
        expect(() => scaledDotProductAttention([[1]], [[1], [2]], [[1]])).toThrow('one row per key')
        expect(() => scaledDotProductAttention([[NaN]], [[1]], [[1]])).toThrow('finite')
        expect(() => scaledDotProductAttention([[1]], [[1]], [[1]], { mask: [[true, false]] })).toThrow('dimensions')
    })
})

describe('AttentionMatrix', () => {
    const options = { weights: [[1, 0], [0.25, 0.75]], mask: [[true, false], [true, true]], queryLabels: ['a', 'b'], keyLabels: ['a', 'b'] }
    it.each(['dark', 'light'] as const)('renders a normalized causal view through the real renderer in %s theme', async theme => {
        const svg = await renderToSvg(AttentionMatrix({ ...options, c: getThemeColors(theme), activeQuery: 1 }), 760, 420)
        expect(svg).toMatch(/<svg/)
        expect(svg).toMatch(/<path/)
        expect(svg).not.toMatch(/NaN|Infinity/)
        expect(analyzeContrast(AttentionMatrix({ ...options, c: getThemeColors(theme) }), theme)).not.toContainEqual(expect.objectContaining({ code: 'accessibility.low_contrast' }))
    })
    it('composites cell backgrounds before choosing and auditing their label ink', () => {
        expect(compositeColor('rgba(255, 0, 0, 0.5)', '#0000ff')).toBe('rgb(128, 0, 128)')
        expect(compositeColor('transparent', '#ffffff')).toBe('rgb(255, 255, 255)')
        expect(compositeColor('hsl(120, 100%, 50%)', '#000000')).toBe('rgb(0, 255, 0)')
    })
    it('rejects unnormalized, masked, malformed and unreadable probability views', () => {
        const c = getThemeColors('dark')
        expect(() => AttentionMatrix({ c, weights: [[0.5]] })).toThrow('sum to one')
        expect(() => AttentionMatrix({ c, weights: [[1]], mask: [[false]] })).toThrow('masked entries')
        expect(() => AttentionMatrix({ c, weights: [[1]], activeQuery: 2 })).toThrow('outside')
        expect(() => AttentionMatrix({ c, weights: [[1]], keyLabels: [] })).toThrow('labels')
        expect(() => AttentionMatrix({ c, weights: [Array(32).fill(1 / 32)] })).toThrow('readable')
    })
})
