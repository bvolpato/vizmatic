import { linearGradient, sampleStops, toPaint, type ColorInput, type Rgba } from './color'
import { rectPath, type Vec } from './geometry'
import { Node, ownLabels } from './node'
import { scaleMapping, formatAxisTick, type AxisScale } from './scales'
import { line } from './shapes'
import { tex } from './tex'
import { text } from './text'

export interface ColorBarOptions {
    /** Fixed value domain. Use the same domain, colors, and scale as the plotted field. */
    domain: readonly [number, number]
    /** Solid colors equally spaced in the transformed domain. */
    colors: readonly ColorInput[]
    scale?: AxisScale
    /** Tick values in data coordinates. Automatic labels are thinned to fit the available space. */
    ticks?: readonly number[]
    /** Tick labels as TeX. The title is plain text. */
    format?: (value: number) => string
    /** Ramp size, excluding ticks and labels. Defaults to 400 by 20, or 20 by 300 when vertical. */
    width?: number
    height?: number
    /** False: values increase to the right. True: values increase upward. */
    vertical?: boolean
    label?: string
    labelSize?: number
}

/** A numeric legend with the same fixed normalization as a scalar field or heatmap. */
export function colorBar(options: ColorBarOptions): Node {
    const scale = scaleMapping(options.domain, options.scale, 'colorBar')
    const vertical = options.vertical ?? false
    const width = options.width ?? (vertical ? 20 : 400), height = options.height ?? (vertical ? 300 : 20)
    const size = options.labelSize ?? 20, gap = size * 0.4, tick = 6
    if (![width, height, size].every((v) => Number.isFinite(v) && v > 0)) throw new Error('colorBar: width, height, and labelSize must be finite and greater than 0')
    if (options.colors.length < 2) throw new Error('colorBar: colors must contain at least two solid colors')
    const colors = options.colors.map((color) => {
        const paint = toPaint(color)
        if (!Array.isArray(paint)) throw new Error('colorBar: colors must be solid colors')
        return paint as Rgba
    })
    if (options.ticks?.some((v) => !Number.isFinite(v))) throw new Error('colorBar: ticks must be finite')
    const [low, high] = scale.domain
    const values = [...new Set(options.ticks ?? [low, ...scale.ticks(), high])].filter((v) => v >= low && v <= high).sort((a, b) => a - b)
    const spacing = Math.min(...values.slice(1).map((v, i) => v - values[i]))
    const format = options.format ?? ((v: number) => formatAxisTick(v, spacing))
    const from: Vec = vertical ? [0, height / 2] : [-width / 2, 0]
    const to: Vec = vertical ? [0, -height / 2] : [width / 2, 0]
    const stops = colors.map((color, i) => [i / (colors.length - 1), color] as const)
    // Native SVG and Canvas gradients interpolate sRGB. Sample the same Oklab
    // palette as scalarField first, leaving only sub-byte interpolation error.
    const palette = Array.from({ length: 1025 }, (_, i) => [i / 1024, sampleStops(stops, i / 1024)] as const)
    const ramp = new Node(rectPath(-width / 2, -height / 2, width, height)).fill(linearGradient(from, to, palette)).stroke('faint', 1)
    const node = new Node().add(ramp)
    const labels = values.map((value) => {
        const along = scale.map(value), label = tex(format(value), { size, color: 'dim', display: false })
        const center = vertical ? (0.5 - along) * height : (along - 0.5) * width
        const half = (vertical ? label.height : label.width) / 2
        label.moveTo(vertical ? [width / 2 + tick + gap + label.width / 2, center] : [center, height / 2 + tick + gap + label.height / 2])
        return { label, center, half }
    })
    const selected: typeof labels = []
    // End labels explain the fixed color domain. Interior auto labels must clear both ends and one another.
    if (!options.ticks && labels.length >= 2 && Math.abs(labels[0].center - labels.at(-1)!.center) < labels[0].half + labels.at(-1)!.half + gap) {
        throw new Error(`colorBar: endpoint labels overlap; increase ${vertical ? 'height' : 'width'}, reduce labelSize, or give a shorter format`)
    }
    const priority = options.ticks ? labels : [labels[0], labels.at(-1), ...labels.slice(1, -1)]
    for (const entry of priority) {
        if (!entry || selected.includes(entry)) continue
        if (options.ticks || selected.every((other) => Math.abs(entry.center - other.center) >= entry.half + other.half + gap)) selected.push(entry)
    }
    selected.sort((a, b) => vertical ? b.center - a.center : a.center - b.center)
    for (const { label, center } of selected) {
        node.add(vertical
            ? line([width / 2, center], [width / 2 + tick, center], { stroke: 'dim', width: 1 })
            : line([center, height / 2], [center, height / 2 + tick], { stroke: 'dim', width: 1 }), label)
    }
    if (options.label) {
        const title = text(options.label, { size, color: 'ink' })
        const top = Math.min(-height / 2, ...selected.map((entry) => entry.label.bounds().y))
        node.add(title.moveTo([0, top - gap - title.height / 2]))
    }
    ownLabels(node, { name: 'color bar', plot: true })
    return node
}
