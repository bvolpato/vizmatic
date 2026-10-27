import React from 'react'
import { describe, expect, it } from 'vitest'
import { Matrix } from '../src/primitives/data'
import { multiplyMatrices, transposeMatrix } from '../src/primitives/matrix-math'
import { getThemeColors, heatColor } from '../src/theme'

type ElementWithProps = React.ReactElement<any>

function renderedMatrixCells(element: ElementWithProps): ElementWithProps[][] {
    const rootChildren = React.Children.toArray(element.props.children) as ElementWithProps[]
    const grid = rootChildren[rootChildren.length - 1]
    const rows = React.Children.toArray(grid.props.children) as ElementWithProps[]
    return rows.map(row => React.Children.toArray(row.props.children).filter(React.isValidElement) as ElementWithProps[])
}

describe('numeric matrix operations', () => {
    it('multiplies compatible rectangular matrices without mutating the inputs', () => {
        const left = [[1, 2, 0], [-1, 3, 2]]
        const right = [[2, 1], [0, 4], [3, -2]]
        const before = JSON.stringify({ left, right })

        const product = multiplyMatrices(left, right)

        expect(product).toEqual([[2, 9], [4, 7]])
        expect(JSON.stringify({ left, right })).toBe(before)
        product[0][0] = 99
        expect(left[0][0]).toBe(1)
        expect(right[0][0]).toBe(2)
    })

    it('transposes non-square matrices into a fresh matrix', () => {
        const source = [[1, 2, 3], [4, 5, 6]]
        const before = JSON.stringify(source)

        const transposed = transposeMatrix(source)

        expect(transposed).toEqual([[1, 4], [2, 5], [3, 6]])
        expect(transposed).not.toBe(source)
        expect(transposed[0]).not.toBe(source[0])
        expect(JSON.stringify(source)).toBe(before)
    })

    it('preserves the existing multiplication behavior for empty matrix dimensions', () => {
        expect(multiplyMatrices([], [])).toEqual([])
        expect(multiplyMatrices([[], []], [])).toEqual([[], []])
        expect(transposeMatrix([])).toEqual([])
        expect(transposeMatrix([[], []])).toEqual([])
    })

    it('rejects ragged and non-finite transposes plus incompatible and overflowing products', () => {
        expect(() => transposeMatrix([[1, 2], [3]])).toThrow('rectangular')
        expect(() => transposeMatrix([[1, Number.NaN]])).toThrow('finite numbers')
        const sparseRow: number[] = new Array(2)
        sparseRow[1] = 1
        expect(() => transposeMatrix([sparseRow])).toThrow('finite numbers')
        expect(() => multiplyMatrices([[1, 2]], [[1], [2], [3]])).toThrow('Matrix inner dimensions must match')
        expect(() => multiplyMatrices([[Number.MAX_VALUE]], [[2]])).toThrow('Matrix product value must be finite')
    })
})

describe('Matrix numeric emphasis', () => {
    const c = getThemeColors('dark')

    it('normalizes colors while preserving displayed numbers and highlighting the chosen row, column, and cell', () => {
        const cells = renderedMatrixCells(Matrix({
            data: [[-10, 0], [10, 20]],
            c,
            format: 'decimal',
            fontSize: 22,
            colorDomain: [-10, 10],
            highlightRow: 1,
            highlightCol: 1,
            highlightCell: { row: 1, col: 1 },
            highlightColor: '#ef4444',
        }))

        expect(cells[0][0].props.children).toBe('-10.00')
        expect(cells[1][1].props.children).toBe('20.00')
        expect(cells[0][0].props.style.fontSize).toBe(22)
        expect(cells[0][0].props.style.backgroundColor).toBe(heatColor(0))
        expect(cells[0][1].props.style.backgroundColor).not.toBe(heatColor(0.5))
        expect(cells[1][0].props.style.boxShadow).toContain('#ef4444')
        expect(cells[1][1].props.style.boxShadow).toContain('#ef4444')
    })

    it('keeps legacy default value size, color range, and decimal labels', () => {
        const cells = renderedMatrixCells(Matrix({ data: [[0.5]], c }))
        expect(cells[0][0].props.style.fontSize).toBe(11)
        expect(cells[0][0].props.style.backgroundColor).toBe(heatColor(0.5))
        expect(cells[0][0].props.children).toBe('0.50')
    })

    it('rejects invalid new style and normalization options', () => {
        const base = { data: [[1, 2]], c }
        expect(() => Matrix({ ...base, fontSize: Number.POSITIVE_INFINITY })).toThrow('fontSize must be a positive finite number')
        expect(() => Matrix({ ...base, highlightRow: 1 })).toThrow('highlightRow')
        expect(() => Matrix({ ...base, highlightCell: { row: 0, col: 2 } })).toThrow('highlightCell')
        expect(() => Matrix({ ...base, highlightColor: 'not-a-color', highlightCol: 0 })).toThrow('valid CSS color')
        expect(() => Matrix({ ...base, colorDomain: [2, 2] })).toThrow('colorDomain')
        const sparseRow: number[] = new Array(2)
        sparseRow[1] = 1
        expect(() => Matrix({ data: [sparseRow], c, highlightCol: 0 })).toThrow('highlightCol')
        expect(() => Matrix({ data: [sparseRow], c, colorDomain: [0, 2] })).toThrow('finite values')
    })
})
