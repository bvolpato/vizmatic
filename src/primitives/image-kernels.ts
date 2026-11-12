export type NumericImage = readonly (readonly number[])[]

export type KernelPadding = 'valid' | 'same'

export interface CrossCorrelateOptions {
    stride?: number
    padding?: KernelPadding
}

export interface CrossCorrelationTerm {
    inputRow: number
    inputColumn: number
    inputValue: number
    weight: number
    product: number
    padded: boolean
}

function validateMatrix(matrix: NumericImage, name: string): { rows: number; columns: number } {
    if (!Array.isArray(matrix) || matrix.length === 0 || !Array.isArray(matrix[0]) || matrix[0].length === 0) {
        throw new Error(`${name} must be a nonempty rectangular matrix`)
    }

    const columns = matrix[0].length
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

    return { rows: matrix.length, columns }
}

function prepareCorrelation(input: NumericImage, kernel: NumericImage, options: CrossCorrelateOptions) {
    const inputShape = validateMatrix(input, 'Input image')
    const kernelShape = validateMatrix(kernel, 'Kernel')
    const stride = options.stride ?? 1
    const padding = options.padding ?? 'valid'

    if (!Number.isSafeInteger(stride) || stride < 1) {
        throw new Error('Kernel stride must be a positive integer')
    }
    if (padding !== 'valid' && padding !== 'same') {
        throw new Error("Kernel padding must be 'valid' or 'same'")
    }

    const outputRows = padding === 'same'
        ? Math.ceil(inputShape.rows / stride)
        : Math.floor((inputShape.rows - kernelShape.rows) / stride) + 1
    const outputColumns = padding === 'same'
        ? Math.ceil(inputShape.columns / stride)
        : Math.floor((inputShape.columns - kernelShape.columns) / stride) + 1

    if (outputRows < 1 || outputColumns < 1) {
        throw new Error("Kernel must fit inside the input image when padding is 'valid'")
    }

    const totalPaddingRows = Math.max((outputRows - 1) * stride + kernelShape.rows - inputShape.rows, 0)
    const totalPaddingColumns = Math.max((outputColumns - 1) * stride + kernelShape.columns - inputShape.columns, 0)
    const topPadding = Math.floor(totalPaddingRows / 2)
    const leftPadding = Math.floor(totalPaddingColumns / 2)

    function sumAt(outputRow: number, outputColumn: number, terms?: CrossCorrelationTerm[][]): number {
        const top = outputRow * stride - topPadding
        const left = outputColumn * stride - leftPadding
        let sum = 0
        for (let r = 0; r < kernelShape.rows; r += 1) {
            const inputRow = top + r
            const outsideRow = inputRow < 0 || inputRow >= inputShape.rows
            if (outsideRow && !terms) continue
            const pixels = input[inputRow]
            const weights = kernel[r]
            const rowTerms = terms?.[r]
            for (let c = 0; c < weights.length; c += 1) {
                const inputColumn = left + c
                const padded = outsideRow || inputColumn < 0 || inputColumn >= inputShape.columns
                const inputValue = padded ? 0 : pixels[inputColumn]
                const weight = weights[c]
                const product = padded ? 0 : inputValue * weight
                sum += product
                rowTerms?.push({ inputRow, inputColumn, inputValue, weight, product, padded })
            }
        }
        if (!Number.isFinite(sum)) throw new Error('Kernel output values must be finite numbers')
        return sum
    }

    return { outputRows, outputColumns, sumAt }
}

/**
 * Slide a kernel over an image and sum elementwise products without flipping
 * the kernel. This is cross-correlation, the operation commonly called
 * convolution by deep-learning libraries. `same` returns ceil(input / stride)
 * cells and uses SAME_UPPER padding, placing any odd extra zero padding at the
 * bottom or right.
 */
export function crossCorrelate2d(
    input: NumericImage,
    kernel: NumericImage,
    options: CrossCorrelateOptions = {},
): number[][] {
    const { outputRows, outputColumns, sumAt } = prepareCorrelation(input, kernel, options)
    const result: number[][] = []
    for (let r = 0; r < outputRows; r += 1) {
        const row = new Array<number>(outputColumns)
        for (let c = 0; c < outputColumns; c += 1) row[c] = sumAt(r, c)
        result.push(row)
    }
    return result
}

/**
 * Explain one zero-based output cell of crossCorrelate2d. Each terms[r][c]
 * describes kernel[r][c] and its aligned input coordinate. A tap outside the
 * image keeps that coordinate and has padded = true, inputValue = 0 and product = 0.
 */
export function traceCrossCorrelation2d(
    input: NumericImage,
    kernel: NumericImage,
    outputRow: number,
    outputColumn: number,
    options: CrossCorrelateOptions = {},
) {
    const { outputRows, outputColumns, sumAt } = prepareCorrelation(input, kernel, options)
    if (!Number.isInteger(outputRow) || outputRow < 0 || outputRow >= outputRows
        || !Number.isInteger(outputColumn) || outputColumn < 0 || outputColumn >= outputColumns) {
        throw new RangeError(`Kernel output cell (${outputRow}, ${outputColumn}) is outside the ${outputRows} by ${outputColumns} grid`)
    }
    const terms: CrossCorrelationTerm[][] = kernel.map(() => [])
    const sum = sumAt(outputRow, outputColumn, terms)
    return { outputRow, outputColumn, terms, sum }
}

/** Return a normalized, sampled square Gaussian kernel with odd dimensions. */
export function gaussianKernel(size: number, sigma: number): number[][] {
    if (!Number.isSafeInteger(size) || size < 1 || size % 2 === 0) {
        throw new Error('Gaussian kernel size must be a positive odd integer')
    }
    if (!Number.isFinite(sigma) || sigma <= 0) {
        throw new Error('Gaussian sigma must be a positive finite number')
    }

    const radius = Math.floor(size / 2)
    const weights = Array.from({ length: size }, (_, row) =>
        Array.from({ length: size }, (_, column) => {
            const x = column - radius
            const y = row - radius
            const normalizedX = x / sigma
            const normalizedY = y / sigma
            return Math.exp(-(normalizedX * normalizedX + normalizedY * normalizedY) / 2)
        }))
    const total = weights.flat().reduce((sum, value) => sum + value, 0)

    return weights.map(row => row.map(value => value / total))
}
