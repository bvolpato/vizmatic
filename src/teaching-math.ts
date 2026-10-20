import type { CanvasPoint } from './canvas-components'

function finite(value: number, name: string): void {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
}

function finiteValues(values: readonly number[], name: string): void {
    values.forEach((value) => finite(value, name))
}

/** A reproducible Mulberry32 stream returning values in [0, 1). */
export function seededRandom(seed: number): () => number {
    if (!Number.isSafeInteger(seed)) throw new Error('Random seed must be a safe integer')
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let value = Math.imul(state ^ (state >>> 15), 1 | state)
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

/** Interpolate vectors without mutating either input. Progress may extrapolate. */
export function lerpArray(from: readonly number[], to: readonly number[], progress: number): number[] {
    if (from.length !== to.length) throw new Error('Interpolation vectors must have equal lengths')
    finite(progress, 'Interpolation progress')
    finiteValues(from, 'Interpolation value')
    finiteValues(to, 'Interpolation value')
    const result = from.map((value, index) => {
        const end = to[index]
        const blended = value * (1 - progress) + end * progress
        if (Number.isFinite(blended)) return blended
        const scale = Math.max(Math.abs(value), Math.abs(end))
        return (value / scale + (end / scale - value / scale) * progress) * scale
    })
    finiteValues(result, 'Interpolation result')
    return result
}

export function dotProduct(left: readonly number[], right: readonly number[]): number {
    if (left.length !== right.length) throw new Error('Dot product vectors must have equal lengths')
    finiteValues(left, 'Dot product value')
    finiteValues(right, 'Dot product value')
    const result = left.reduce((sum, value, index) => sum + value * right[index], 0)
    finite(result, 'Dot product result')
    return result
}

function matrixWidth(matrix: readonly (readonly number[])[], name: string): number {
    const width = matrix[0]?.length ?? 0
    for (const row of matrix) {
        if (row.length !== width) throw new Error(`${name} rows must be rectangular`)
        finiteValues(row, `${name} value`)
    }
    return width
}

export function multiplyMatrices(
    left: readonly (readonly number[])[],
    right: readonly (readonly number[])[],
): number[][] {
    const inner = matrixWidth(left, 'Left matrix')
    const columns = matrixWidth(right, 'Right matrix')
    if (inner !== right.length) throw new Error('Matrix inner dimensions must match')
    return left.map((row) => Array.from({ length: columns }, (_, column) => {
        const result = row.reduce((sum, value, index) => sum + value * right[index][column], 0)
        finite(result, 'Matrix product value')
        return result
    }))
}

/** Subtract the largest logit before exponentiation, including at small temperatures. */
export function stableSoftmax(values: readonly number[], temperature = 1): number[] {
    finite(temperature, 'Softmax temperature')
    if (temperature <= 0) throw new Error('Softmax temperature must be positive')
    finiteValues(values, 'Softmax logit')
    if (!values.length) return []
    const maximum = values.reduce((largest, value) => Math.max(largest, value), -Infinity)
    const weights = values.map((value) => Math.exp((value - maximum) / temperature))
    const total = weights.reduce((sum, value) => sum + value, 0)
    return weights.map((value) => value / total)
}

/** Shannon entropy of a normalized probability distribution. Zero terms contribute zero. */
export function entropy(probabilities: readonly number[], base = 2): number {
    finite(base, 'Entropy base')
    if (base <= 0 || base === 1) throw new Error('Entropy base must be positive and different from one')
    finiteValues(probabilities, 'Entropy probability')
    if (!probabilities.length) return 0
    if (probabilities.some((value) => value < 0 || value > 1)) {
        throw new Error('Entropy probabilities must lie between zero and one')
    }
    const total = probabilities.reduce((sum, value) => sum + value, 0)
    if (Math.abs(total - 1) > 1e-9) throw new Error('Entropy probabilities must sum to one')
    return -probabilities.reduce((sum, value) => value === 0 ? sum : sum + value * Math.log(value), 0) / Math.log(base)
}

/** Unit-length vector; the zero vector stays zero. Scaling avoids intermediate overflow. */
export function normalizeVector(values: readonly number[]): number[] {
    finiteValues(values, 'Vector value')
    const scale = values.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0)
    if (scale === 0) return values.map(() => 0)
    const scaled = values.map((value) => value / scale)
    const length = Math.sqrt(scaled.reduce((sum, value) => sum + value * value, 0))
    return scaled.map((value) => value / length)
}

/** Sample both endpoints of a finite domain into a polyline. */
export function sampleFunction(fn: (x: number) => number, low: number, high: number, count = 100): CanvasPoint[] {
    finite(low, 'Sample domain start')
    finite(high, 'Sample domain end')
    if (high <= low) throw new Error('Sample domain must increase')
    if (!Number.isSafeInteger(count) || count < 2) throw new Error('Sample count must be an integer of at least two')
    return Array.from({ length: count }, (_, index) => {
        const amount = index / (count - 1)
        const x = low * (1 - amount) + high * amount
        const y = fn(x)
        finite(y, 'Sampled function value')
        return { x, y }
    })
}

/** Normal probability density at x. */
export function gaussian(mean: number, sigma: number, x: number): number {
    finite(mean, 'Gaussian mean')
    finite(sigma, 'Gaussian standard deviation')
    finite(x, 'Gaussian x')
    if (sigma <= 0) throw new Error('Gaussian standard deviation must be positive')
    const z = (x - mean) / sigma
    const density = Math.exp(-0.5 * z * z) / sigma / Math.sqrt(2 * Math.PI)
    finite(density, 'Gaussian density')
    return density
}

/** One standard normal sample using two draws from a supplied [0, 1) random stream. */
export function sampleGaussian(random: () => number): number {
    const first = random()
    const second = random()
    if (!Number.isFinite(first) || !Number.isFinite(second) || first < 0 || first >= 1 || second < 0 || second >= 1) {
        throw new Error('Gaussian random draws must lie in [0, 1)')
    }
    return Math.sqrt(-2 * Math.log(1 - first)) * Math.cos(2 * Math.PI * second)
}
