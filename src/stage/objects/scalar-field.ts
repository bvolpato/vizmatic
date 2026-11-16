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
    // dense palette so a live field does not convert Oklab for every pixel.
    const palette = Array.from({ length: 1025 }, (_, i) => sampleStops(stops, i / 1024))
    const node = new Node(rectPath(-width / 2, -height / 2, width, height))
    node.layoutBox = [-width / 2, -height / 2, width / 2, height / 2]
    let lastTime = NaN, lastPixels: PixelImage | undefined, visible = false
    node.rawOps = function (matrix, alpha, ops) {
        const time = clock.now
        if (!lastPixels || time !== lastTime) {
            const data = new Uint8ClampedArray(nx * ny * 4)
            visible = false
            for (let row = 0; row < ny; row++) for (let col = 0; col < nx; col++) {
                const value = sample(x[0] + (x[1] - x[0]) * (col / (nx - 1)), y[1] - (y[1] - y[0]) * (row / (ny - 1)), time)
                if (!Number.isFinite(value)) continue
                const normalized = normalization.map(value)
                if (!Number.isFinite(normalized)) continue
                const position = Math.max(0, Math.min(1, normalized)) * 1024
                const low = Math.floor(position), fraction = position - low
                const a = palette[low], b = palette[Math.min(1024, low + 1)]
                const i = (row * nx + col) * 4
                for (let c = 0; c < 4; c++) data[i + c] = (a[c] + (b[c] - a[c]) * fraction) * (c === 3 ? 255 : 1)
                visible ||= data[i + 3] > 0
            }
            lastPixels = { width: nx, height: ny, data }
            lastTime = time
        }
        if (!visible) return
        const [a, b, c, d, e, f] = matrix
        ops.push({ kind: 'image', image: { src: '', width, height, pixels: lastPixels },
            matrix: [a, b, c, d, e - a * width / 2 - c * height / 2, f - b * width / 2 - d * height / 2],
            alpha, blend: this.get('blend'), node: this })
    }
    ownLabels(node, { name: 'scalar field', plot: true })
    return node
}
