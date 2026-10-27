export type NumericMatrix = readonly (readonly number[])[]

export { multiplyMatrices } from '../teaching-math'

function validateMatrix(matrix: NumericMatrix, name: string): number {
    if (!Array.isArray(matrix)) {
        throw new Error(`${name} must be a rectangular matrix`)
    }

    const columns = matrix[0]?.length ?? 0
    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
        const row = matrix[rowIndex]
        if (!Array.isArray(row) || row.length !== columns) {
            throw new Error(`${name} must be rectangular`)
        }
        for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
            if (!Number.isFinite(row[columnIndex])) {
                throw new Error(`${name} values must be finite numbers`)
            }
        }
    }

    return columns
}

/** Return a new matrix with rows and columns exchanged. */
export function transposeMatrix(matrix: NumericMatrix): number[][] {
    const columns = validateMatrix(matrix, 'Matrix')
    return Array.from({ length: columns }, (_, columnIndex) =>
        matrix.map(row => row[columnIndex])
    )
}
