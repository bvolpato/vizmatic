import React from 'react'
import { stableSoftmax } from '../teaching-math'
import { getReadableColor, getReadableTextColor, withColorAlpha, type ThemeColors } from '../theme'
import { SvgMathText } from './layout'

export interface AttentionOptions {
    /** Top-left causal alignment: key j is visible to query i when j <= i. */
    causal?: boolean
    /** True permits attention; false masks the corresponding query/key pair. */
    mask?: readonly (readonly boolean[])[]
}

export interface AttentionResult {
    scores: (number | null)[][]
    weights: number[][]
    output: number[][]
}

function matrixShape(matrix: readonly (readonly number[])[], name: string): number {
    if (!matrix.length || matrix.length > 128 || !matrix[0]?.length || matrix[0].length > 256) {
        throw new Error(`${name} must contain 1–128 nonempty rows with at most 256 columns`)
    }
    const columns = matrix[0].length
    if (matrix.some(row => row.length !== columns || row.some(value => !Number.isFinite(value)))) {
        throw new Error(`${name} must be rectangular and finite`)
    }
    return columns
}

function validateMask(mask: AttentionOptions['mask'], rows: number, columns: number): void {
    if (mask && (mask.length !== rows || mask.some(row => row.length !== columns || row.some(value => typeof value !== 'boolean')))) {
        throw new Error('Attention mask dimensions must match queries and keys and contain booleans')
    }
}

/** Single-head scaled dot-product attention, without dropout or learned projections. */
export function scaledDotProductAttention(
    queries: readonly (readonly number[])[],
    keys: readonly (readonly number[])[],
    values: readonly (readonly number[])[],
    options: AttentionOptions = {},
): AttentionResult {
    const dimension = matrixShape(queries, 'Queries')
    if (matrixShape(keys, 'Keys') !== dimension) throw new Error('Queries and keys must have the same feature dimension')
    const valueDimension = matrixShape(values, 'Values')
    if (values.length !== keys.length) throw new Error('Values must have one row per key')
    validateMask(options.mask, queries.length, keys.length)
    const scores: AttentionResult['scores'] = []
    const weights: number[][] = []
    const output: number[][] = []
    for (const [i, query] of queries.entries()) {
        const row = keys.map((key, j) => {
            if ((options.causal && j > i) || options.mask?.[i][j] === false) return null
            const score = query.reduce((sum, value, k) => sum + value * key[k], 0) / Math.sqrt(dimension)
            if (!Number.isFinite(score)) throw new Error('Attention score must be finite')
            return score
        })
        const visible = row.filter((value): value is number => value !== null)
        if (!visible.length) throw new Error(`Attention query ${i} is fully masked`)
        const probabilities = stableSoftmax(visible)
        let visibleIndex = 0
        const distribution = row.map(value => value === null ? 0 : probabilities[visibleIndex++])
        const result = Array.from({ length: valueDimension }, (_, column) => distribution.reduce((sum, weight, j) => sum + weight * values[j][column], 0))
        if (result.some(value => !Number.isFinite(value))) throw new Error('Attention output must be finite')
        scores.push(row)
        weights.push(distribution)
        output.push(result)
    }
    return { scores, weights, output }
}

export interface AttentionMatrixProps {
    c: ThemeColors
    weights: readonly (readonly number[])[]
    queryLabels?: readonly string[]
    keyLabels?: readonly string[]
    /** True permits attention. Masked entries must be zero. */
    mask?: readonly (readonly boolean[])[]
    activeQuery?: number
    activeKey?: number
    title?: string
    width?: number
    height?: number
}

/** Inspect normalized attention probabilities; this component does not invent scores. */
export function AttentionMatrix({
    c, weights, queryLabels, keyLabels, mask, activeQuery, activeKey,
    title = 'Attention probabilities', width = 760, height = 420,
}: AttentionMatrixProps): React.ReactElement {
    const columns = matrixShape(weights, 'Attention weights')
    const rows = weights.length
    if (rows > 32 || columns > 32) throw new Error('AttentionMatrix supports at most 32 queries and 32 keys')
    validateMask(mask, rows, columns)
    for (const [i, row] of weights.entries()) {
        if (row.some((value, j) => value < 0 || value > 1 || (mask?.[i][j] === false && value !== 0))) {
            throw new Error('Attention weights must be probabilities with zero at masked entries')
        }
        const total = row.reduce((sum, value) => sum + value, 0)
        const fullyMasked = mask?.[i].every(value => !value) ?? false
        if (Math.abs(total - (fullyMasked ? 0 : 1)) > 1e-6) throw new Error('Each visible attention row must sum to one')
    }
    const labels = (input: readonly string[] | undefined, count: number, prefix: string): string[] => {
        if (input && (input.length !== count || input.some(value => typeof value !== 'string' || value.length > 24))) {
            throw new Error('Attention labels must match the matrix dimensions and contain at most 24 characters')
        }
        return input ? [...input] : Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`)
    }
    const queryNames = labels(queryLabels, rows, 'q')
    const keyNames = labels(keyLabels, columns, 'k')
    for (const [name, value, count] of [['activeQuery', activeQuery, rows], ['activeKey', activeKey, columns]] as const) {
        if (value !== undefined && (!Number.isInteger(value) || value < 0 || value >= count)) throw new Error(`${name} is outside the attention matrix`)
    }
    if (![width, height].every(Number.isFinite) || width < 280 || height < 240) throw new Error('AttentionMatrix requires finite width >= 280 and height >= 240')
    const left = Math.max(70, Math.max(...queryNames.map(value => value.length)) * 9 + 24)
    const top = 106
    const right = 76
    const bottom = 64
    const cellWidth = (width - left - right) / columns
    const cellHeight = (height - top - bottom) / rows
    if (cellWidth < 24 || cellHeight < 20 || keyNames.some(value => value.length * 7 > cellWidth - 6)) {
        throw new Error('AttentionMatrix dimensions must leave room for readable cells and labels')
    }
    const text = (key: string, value: string, x: number, y: number, size = 14, fill = c.textPrimary, anchor: 'start' | 'middle' | 'end' = 'middle') => React.cloneElement(SvgMathText({
        text: value, x, y, fill, fontSize: size, fontFamily: c.fontSans, fontWeight: 500, textAnchor: anchor, dominantBaseline: 'alphabetic',
    }), { key })
    const marks: React.ReactNode[] = [
        React.createElement('title', { key: 'title' }, title),
        React.createElement('desc', { key: 'description' }, 'Rows are queries and columns are keys. Visible rows sum to one. Crosses denote masked keys. Values are attention probabilities, not explanations of model reasoning.'),
        text('heading', title, 22, 30, 20, c.textPrimary, 'start'),
        text('keys', 'KEYS', left + (width - left - right) / 2, 58, 12, c.textSecondary),
        text('query-heading', 'QUERY', 22, 81, 12, c.textSecondary, 'start'),
        text('sum-heading', 'Σ', width - 30, 81, 16, c.textSecondary),
    ]
    keyNames.forEach((label, j) => marks.push(text(`key-${j}`, label, left + (j + 0.5) * cellWidth, top - 13, 14, activeKey === j ? getReadableColor('primary', c) : c.textSecondary)))
    weights.forEach((row, i) => {
        const y = top + i * cellHeight
        marks.push(text(`query-${i}`, queryNames[i], left - 14, y + cellHeight / 2 + 5, 14, activeQuery === i ? getReadableColor('primary', c) : c.textSecondary, 'end'))
        row.forEach((weight, j) => {
            const x = left + j * cellWidth
            const masked = mask?.[i][j] === false
            const selected = activeQuery === i && (activeKey === undefined || activeKey === j)
            const fill = masked ? c.bgCardAlt : withColorAlpha(c.primary, 0.12 + 0.88 * weight)
            marks.push(React.createElement('rect', { key: `cell-${i}-${j}`, x: x + 2, y: y + 2, width: cellWidth - 4, height: cellHeight - 4,
                rx: 4, fill, stroke: selected ? c.primary : c.borderSubtle, strokeWidth: selected ? 2.5 : 1 }))
            if (masked) {
                const centerX = x + cellWidth / 2, centerY = y + cellHeight / 2
                marks.push(React.createElement('path', { key: `mask-${i}-${j}`, d: `M${centerX - 4},${centerY - 4}l8,8m-8,0l8,-8`, stroke: c.textMuted, strokeWidth: 1.4 }))
            } else {
                const label = weight.toFixed(2)
                if (cellWidth >= 38 && cellHeight >= 24) marks.push(text(`value-${i}-${j}`, label, x + cellWidth / 2, y + cellHeight / 2 + 5, 14, getReadableTextColor(fill, c, c.bg)))
            }
        })
        const total = row.reduce((sum, value) => sum + value, 0)
        marks.push(text(`sum-${i}`, total.toFixed(0), width - 30, y + cellHeight / 2 + 5, 14, c.textSecondary))
    })
    marks.push(text('footer', 'Probability per query · × masked · shared color scale 0–1', 22, height - 22, 13, c.textSecondary, 'start'))
    const isLabel = (node: React.ReactNode) => React.isValidElement(node) && node.type === 'div'
    return React.createElement('div', { role: 'img', 'aria-label': title, style: { position: 'relative', display: 'flex', width, height, backgroundColor: c.bg, flexShrink: 0 } },
        React.createElement('svg', { width, height, viewBox: `0 0 ${width} ${height}` }, ...marks.filter(node => !isLabel(node))),
        ...marks.filter(isLabel))
}
