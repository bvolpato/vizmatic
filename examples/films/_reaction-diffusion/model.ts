/**
 * Gray–Scott, dimensionless: Pearson, Science 261 (1993), 189–192.
 * https://arxiv.org/abs/patt-sol/9304003
 * Five-point finite differences, periodic edges, explicit Euler (dt = dx = 1).
 * Parameters and deterministic initial patches select one illustrative solution.
 */
export const parameters = { du: 0.16, dv: 0.08, feed: 0.0367, kill: 0.0649 } as const
export const GRID_WIDTH = 128, GRID_HEIGHT = 80, STEPS = 7200, STRIDE = 24

export interface Pattern {
    frames: readonly Float32Array[]
    /** Bilinear space and linear time interpolation of the saved V field. */
    sample(x: number, y: number, step: number): number
}

export function simulate(width = GRID_WIDTH, height = GRID_HEIGHT, steps = STEPS, stride = STRIDE): Pattern {
    if (![width, height, steps, stride].every(Number.isInteger) || width < 8 || height < 8 || steps < 1 || stride < 1) throw new Error('Invalid Gray–Scott grid or time range')
    const size = width * height
    let u = new Float32Array(size).fill(1), v = new Float32Array(size)
    let nextU = new Float32Array(size), nextV = new Float32Array(size)
    // A central patch with a slight deterministic asymmetry breaks exact symmetry.
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        if (Math.abs(x - width * 0.5) < width * 0.08 && Math.abs(y - height * 0.5) < height * 0.10) {
            const i = y * width + x
            u[i] = 0.5 + 0.025 * Math.sin(x * 1.7 + y * 0.3)
            v[i] = 0.25 + 0.025 * Math.cos(y * 1.3 - x * 0.4)
        }
    }
    const frames = [v.slice()]
    const { du, dv, feed, kill } = parameters
    for (let step = 1; step <= steps; step++) {
        for (let y = 0; y < height; y++) {
            const above = ((y + height - 1) % height) * width, below = ((y + 1) % height) * width, row = y * width
            for (let x = 0; x < width; x++) {
                const i = row + x, left = row + (x + width - 1) % width, right = row + (x + 1) % width
                const a = u[i], b = v[i], reaction = a * b * b
                nextU[i] = a + du * (u[left] + u[right] + u[above + x] + u[below + x] - 4 * a) - reaction + feed * (1 - a)
                nextV[i] = b + dv * (v[left] + v[right] + v[above + x] + v[below + x] - 4 * b) + reaction - (feed + kill) * b
            }
        }
        ;[u, nextU] = [nextU, u]
        ;[v, nextV] = [nextV, v]
        if (step % stride === 0 || step === steps) frames.push(v.slice())
    }
    const spatial = (frame: Float32Array, x: number, y: number) => {
        const xx = ((x % width) + width) % width, yy = ((y % height) + height) % height
        const ix = Math.floor(xx), iy = Math.floor(yy), fx = xx - ix, fy = yy - iy
        const jx = (ix + 1) % width, jy = (iy + 1) % height
        const a = frame[iy * width + ix] * (1 - fx) + frame[iy * width + jx] * fx
        const b = frame[jy * width + ix] * (1 - fx) + frame[jy * width + jx] * fx
        return a * (1 - fy) + b * fy
    }
    return { frames, sample(x, y, step) {
        const time = Math.max(0, Math.min(steps, step)), index = Math.min(frames.length - 2, Math.floor(time / stride))
        const start = index * stride, end = Math.min(steps, start + stride), fraction = (time - start) / (end - start)
        return spatial(frames[index], x, y) * (1 - fraction) + spatial(frames[index + 1], x, y) * fraction
    } }
}

let cached: Pattern | undefined
export function pattern(): Pattern { return cached ??= simulate() }
