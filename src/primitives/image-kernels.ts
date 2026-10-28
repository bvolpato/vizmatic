export type NumericImage = readonly (readonly number[])[]

export type KernelPadding = 'valid' | 'same'

export interface CrossCorrelateOptions {
    stride?: number
    padding?: KernelPadding
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
    const result = Array.from({ length: outputRows }, (_, outputRow) =>
        Array.from({ length: outputColumns }, (_, outputColumn) => {
            let sum = 0
            for (let kernelRow = 0; kernelRow < kernelShape.rows; kernelRow += 1) {
                const inputRow = outputRow * stride + kernelRow - topPadding
                if (inputRow < 0 || inputRow >= inputShape.rows) continue
                for (let kernelColumn = 0; kernelColumn < kernelShape.columns; kernelColumn += 1) {
                    const inputColumn = outputColumn * stride + kernelColumn - leftPadding
                    if (inputColumn < 0 || inputColumn >= inputShape.columns) continue
                    sum += input[inputRow][inputColumn] * kernel[kernelRow][kernelColumn]
                }
            }
            if (!Number.isFinite(sum)) {
                throw new Error('Kernel output values must be finite numbers')
            }
            return sum
        }))

    return result
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
