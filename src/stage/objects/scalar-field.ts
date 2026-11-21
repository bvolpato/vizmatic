import { Node, ownLabels } from '../node'
import { sampleStops, toPaint, type ColorInput, type Rgba } from '../color'
import { clock } from '../track'
import type { PixelImage } from '../pixels'
import { rectPath } from '../geometry'
import { scaleMapping, type AxisScale } from '../scales'

export interface ScalarFieldOptions {
    x: readonly [number, number]
    y: readonly [number, number]
    /** Fixed value domain, shared with any legend. Never renormalized per frame. */
    domain: readonly [number, number]
    /** Value normalization, shared with colorBar. Nonpositive log samples are holes. */
    scale?: AxisScale
    colors: readonly ColorInput[]
    width?: number
    height?: number
    /** Samples in each dimension. The displayed image is smoothly interpolated. */
    resolution?: number | readonly [number, number]
}

/** A sampled scalar field. Nonfinite values leave holes; positive y points up. */
export function scalarField(sample: (x: number, y: number, time: number) => number, options: ScalarFieldOptions): Node {
    const { x, y, domain } = options
    for (const [name, range] of [['x', x], ['y', y], ['domain', domain]] as const) {
        if (range.length !== 2 || !range.every(Number.isFinite) || range[1] <= range[0] || !Number.isFinite(range[1] - range[0])) throw new Error(`scalarField ${name} must be a finite increasing pair with a finite span.`)
    }
    const width = options.width ?? 640, height = options.height ?? 480
    const normalization = scaleMapping(domain, options.scale, 'scalarField')
    const res = options.resolution ?? 96
    const [nx, ny] = typeof res === 'number' ? [res, res] : res
    if (![nx, ny].every(n => Number.isInteger(n) && n >= 2 && n <= 512)) throw new Error('scalarField resolution must be between 2 and 512 samples per dimension.')
    if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error('scalarField dimensions must be positive and finite.')
    if (options.colors.length < 2) throw new Error('scalarField needs at least two colors.')
    const stops = options.colors.map((color, i) => {
        const paint = toPaint(color)
        if (!Array.isArray(paint)) throw new Error('scalarField colors must be solid colors.')
        return [i / (options.colors.length - 1), paint as Rgba] as const
    })
    // Color conversion is independent of the sample and clock. Interpolate a
    // dense flat palette so a live field does not convert Oklab or allocate per pixel.
    const palette = new Float32Array(1025 * 4)
    for (let i = 0; i <= 1024; i++) {
        const rgba = sampleStops(stops, i / 1024)
        const o = i * 4
        palette[o] = rgba[0]
        palette[o + 1] = rgba[1]
        palette[o + 2] = rgba[2]
        palette[o + 3] = rgba[3] * 255
    }
    const node = new Node(rectPath(-width / 2, -height / 2, width, height))
    node.layoutBox = [-width / 2, -height / 2, width / 2, height / 2]
    const x0 = x[0], dx = (x[1] - x[0]) / (nx - 1), y1 = y[1], dy = (y[1] - y[0]) / (ny - 1)
    let lastTime = NaN, lastPixels: PixelImage | undefined, visible = false
    node.rawOps = function (matrix, alpha, ops, blend) {
        const time = clock.now
        if (!lastPixels || time !== lastTime) {
            const data = new Uint8ClampedArray(nx * ny * 4)
            visible = false
            for (let row = 0; row < ny; row++) {
                const wy = y1 - dy * row
                const rowOff = row * nx * 4
                for (let col = 0; col < nx; col++) {
                    const value = sample(x0 + dx * col, wy, time)
                    if (!Number.isFinite(value)) continue
                    const normalized = normalization.map(value)
                    if (!Number.isFinite(normalized)) continue
                    const clamped = normalized <= 0 ? 0 : normalized >= 1 ? 1024 : normalized * 1024
                    const low = clamped | 0
                    const fraction = clamped - low
                    const a = low * 4
                    const b = low < 1024 ? a + 4 : a
                    const i = rowOff + col * 4
                    data[i] = palette[a]! + (palette[b]! - palette[a]!) * fraction
                    data[i + 1] = palette[a + 1]! + (palette[b + 1]! - palette[a + 1]!) * fraction
                    data[i + 2] = palette[a + 2]! + (palette[b + 2]! - palette[a + 2]!) * fraction
                    const alphaByte = palette[a + 3]! + (palette[b + 3]! - palette[a + 3]!) * fraction
                    data[i + 3] = alphaByte
                    if (alphaByte >= 0.5) visible = true
                }
            }
            lastPixels = { width: nx, height: ny, data }
            lastTime = time
        }
        if (!visible) return
        const [a, b, c, d, e, f] = matrix
        const ownBlend = this.get('blend')
        ops.push({ kind: 'image', image: { src: '', width, height, pixels: lastPixels },
            matrix: [a, b, c, d, e - a * width / 2 - c * height / 2, f - b * width / 2 - d * height / 2],
            alpha, blend: ownBlend !== 'normal' ? ownBlend : (blend ?? 'normal'), node: this })
    }
    ownLabels(node, { name: 'scalar field', plot: true })
    return node
}
