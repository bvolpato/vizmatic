/** Small number helpers for a scene: a value between two values, a value held in a range, the value of a series, a number as text, and a check of a number. */

/** The value at share `t` of the way from `a` to `b`: `lerp(100, 200, 0.25)` is 125. */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t
}

/** A value held between two limits, 0 and 1 by default: `clamp(1.4)` is 1. */
export function clamp(value: number, low = 0, high = 1): number {
    return Math.min(high, Math.max(low, value))
}

/**
 * A share from 0 to 1 that starts and stops gently: `smoothstep(0.5)` is 0.5, and `smoothstep(0.1)` is 0.028.
 * Use it inside a `dynamic` drawing, on a value that moves at a constant speed. It is not the `smooth` ease.
 */
export function smoothstep(t: number): number {
    const u = clamp(t)
    return u * u * (3 - 2 * u)
}

/**
 * The value of a series at x: on the straight line between its two points around x. The points are `[x, y]`
 * with x in rising order. `valueAt([[0, 2], [2, 6]], 1)` is 4. It is not a number outside the points of the
 * series, where the series has no value.
 */
export function valueAt(points: readonly (readonly [number, number])[], x: number): number {
    const last = points.length - 1
    if (last < 0 || !(x >= points[0]![0] && x <= points[last]![0])) return NaN
    let low = 0, high = last
    while (high - low > 1) {
        const middle = (low + high) >> 1
        if (points[middle]![0] <= x) low = middle
        else high = middle
    }
    const [x0, y0] = points[low]!, [x1, y1] = points[high]!
    // At a point of the series, the value is the value of that point, also when the next point has none.
    if (x <= x0) return y0
    if (x >= x1) return y1
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
}

/** A whole number with its digits in groups of three: `commas(21915584)` is "21,915,584". A fraction is rounded. */
export function commas(value: number | bigint): string {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`commas: ${value} is not a number that a viewer can read. Give it a finite number`)
    const whole = typeof value === 'bigint' ? value : Math.round(value)
    return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** True when two values have the same content: numbers and texts by value, lists and plain objects part by part. */
function sameContent(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameContent((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

/**
 * Stop the build when a value is not the value that the film counts on: `assertEqual(N.clients, 100, 'the clients')`.
 * A scene asserts each number that the voice says before it draws, so the data cannot change under the
 * narration in silence. Lists and plain objects are compared by their content. It needs nothing of Node, so
 * a film with it runs in the preview.
 */
export function assertEqual<T>(actual: T, expected: T, what = 'the value'): void {
    if (sameContent(actual, expected)) return
    throw new Error(`assertEqual: ${what} is ${JSON.stringify(actual)}, and the film counts on ${JSON.stringify(expected)}. Correct the data, or the scene and the words of the voice`)
}
