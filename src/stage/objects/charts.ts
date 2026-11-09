import { arcPath, polyPath, rectPath, ring, smoothPath, type Path, type Vec } from '../geometry'
import { dynamic, Node, ownLabels } from '../node'
import { dot, line } from '../shapes'
import { text, type TextOptions } from '../text'
import { sampleStops, type ColorInput, type Rgba } from '../color'
import { type Anim, type AnimOptions, Value } from '../anim'
import { formatNumber, luminance, niceTicks, reveal, solidColor, staggered, stepAt, tweenValue } from './util'

const DEFAULT_SERIES: readonly string[] = ['blue', 'yellow', 'teal', 'orange', 'purple', 'green', 'pink', 'red']

export interface ChartOptions {
    width?: number
    height?: number
    /** Text size for direct labels and ticks. */
    labelSize?: number
    color?: ColorInput
    /** The font of the labels and the ticks. Defaults to the font of the film. A value that the chart prints is in mono. */
    font?: TextOptions['font']
}

/** A label or a tick. With no `font`, it is in the font of the film. */
function small(content: string, size: number, color: ColorInput = 'dim', font?: TextOptions['font']): Node {
    return text(content, { size, color, font })
}

// ── Bars ────────────────────────────────────────────────────────────────────

export interface BarDatum {
    label: string
    value: number
    color?: ColorInput
}

export interface BarChartOptions extends ChartOptions {
    /** Fraction of each band left empty between bars. */
    gap?: number
    /** Fixes the top of the scale. Defaults to the largest value. */
    max?: number
    min?: number
    showValues?: boolean
    format?: (value: number) => string
    horizontal?: boolean
    radius?: number
}

/**
 * Bars with direct labels and a single hairline baseline. `enter()` grows them
 * from zero and `update(values)` animates to new data, with readouts that count.
 */
export class BarChart extends Node {
    readonly bars: Node[] = []
    readonly labels: Node[] = []
    readonly readouts: Node[] = []
    readonly baseline: Node
    readonly values: Value[]
    private readonly maxValue: Value
    private readonly minValue: Value
    private readonly w: number
    private readonly h: number
    private readonly horizontal: boolean
    private readonly band: number
    private readonly gap: number
    private readonly fixedMax?: number
    private readonly fixedMin?: number

    constructor(data: readonly BarDatum[], options: BarChartOptions = {}) {
        super()
        this.w = options.width ?? 900
        this.h = options.height ?? 520
        this.horizontal = options.horizontal ?? false
        this.gap = options.gap ?? 0.28
        this.fixedMax = options.max
        this.fixedMin = options.min
        const labelSize = options.labelSize ?? 20
        const count = Math.max(1, data.length)
        this.band = (this.horizontal ? this.h : this.w) / count
        const numbers = data.map((d) => d.value)
        this.maxValue = new Value(options.max ?? Math.max(0, ...numbers))
        this.minValue = new Value(options.min ?? Math.min(0, ...numbers))
        this.values = data.map((d) => new Value(d.value))
        const format = options.format ?? ((v: number) => formatNumber(Math.round(v * 100) / 100))
        const baseColor = options.color ?? 'faint'
        const [ax, ay] = this.place(0, 0, 'start'), [bx, by] = this.place(count - 1, 0, 'end')
        this.baseline = line([ax, ay], [bx, by], { stroke: baseColor, width: 1.5 })
        data.forEach((datum, i) => {
            const color = datum.color ?? DEFAULT_SERIES[i % DEFAULT_SERIES.length]!
            // Slightly translucent: large solid areas bloom too hard and read as blocks of light.
            const bar = new Node(this.barPath(i, datum.value)).fill(color, 0.84)
            this.bars.push(bar)
            const label = small(datum.label, labelSize, 'dim', options.font)
            this.labels.push(label)
            const [px, py] = this.place(i, 0, 'mid')
            if (this.horizontal) label.at(px - 12 - label.width / 2, py)
            else label.at(px, py + 12 + labelSize / 2)
            if (options.showValues ?? true) {
                const readout = dynamic(() => {
                    const value = this.values[i]!.value
                    const [px, py] = this.tip(i, value)
                    const node = small(format(value), labelSize, 'ink', 'mono')
                    if (this.horizontal) return node.at(px + 12 + node.width / 2, py)
                    return node.at(px, py + (value >= 0 ? -1 : 1) * (10 + labelSize * 0.6))
                })
                this.readouts.push(readout)
            }
        })
        this.add(...this.bars, this.baseline, ...this.labels, ...this.readouts)
        ownLabels(this, { name: 'bar chart', plot: true })
    }

    private lengthOf(value: number): number {
        const span = (this.maxValue.value - this.minValue.value) || 1
        return (value / span) * (this.horizontal ? this.w : this.h)
    }

    /** Baseline position for bar i. */
    private place(i: number, _unused: number, at: 'start' | 'mid' | 'end'): [number, number] {
        const center = (i + 0.5) * this.band
        const half = this.band / 2
        const along = at === 'mid' ? center : at === 'start' ? center - half : center + half
        const span = (this.maxValue.value - this.minValue.value) || 1
        if (this.horizontal) {
            const zero = (-this.minValue.value / span) * this.w - this.w / 2
            return [zero, along - this.h / 2]
        }
        const zero = this.h / 2 - (-this.minValue.value / span) * this.h
        return [along - this.w / 2, zero]
    }

    private tip(i: number, value: number): [number, number] {
        const [px, py] = this.place(i, 0, 'mid')
        const length = this.lengthOf(value)
        return this.horizontal ? [px + length, py] : [px, py - length]
    }

    private barPath(i: number, value: number): Path {
        const [px, py] = this.place(i, 0, 'mid')
        const thick = this.band * (1 - this.gap)
        const length = this.lengthOf(value)
        if (this.horizontal) return rectPath(px, py - thick / 2, length, thick)
        return rectPath(px - thick / 2, py - length, thick, length)
    }

    bar(i: number): Node {
        return this.bars[i]!
    }

    /** The name and the readout of a bar belong to it, so a light on the bar keeps them bright. */
    override labelsOf(part: Node): readonly Node[] {
        const index = this.bars.indexOf(part)
        return index < 0 ? [] : [this.labels[index], this.readouts[index]].filter((node): node is Node => node !== undefined)
    }

    /** Baseline and labels appear, then bars rise one after another while readouts count up. */
    enter(options: AnimOptions = {}): Anim {
        const lag = options.lag ?? 0.12
        return {
            label: 'barChart.enter', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                stepAt(this.baseline, 'trimTo', 0, ctx.t0)
                this.baseline.tween('trimTo', 1, ctx.t0, ctx.t0 + span * 0.4, ctx.ease)
                const windows = staggered(this.bars.length, lag, ctx.t0 + span * 0.1, ctx.t1)
                this.bars.forEach((bar, i) => {
                    const [start, end] = windows[i]!
                    const target = this.values[i]!.track.sample(ctx.t0)
                    this.values[i]!.track.step(ctx.t0, 0)
                    tweenValue(this.values[i]!, target, start, end, ctx.ease)
                    bar.track('path').step(ctx.t0, this.barPath(i, 0))
                    bar.track('path').add({
                        t0: start, t1: end, ease: ctx.ease,
                        to: this.barPath(i, target),
                        at: (a) => this.barPath(i, target * a),
                    })
                    const label = this.labels[i]!
                    stepAt(label, 'opacity', 0, ctx.t0)
                    label.tween('opacity', 1, start, start + (end - start) * 0.6, ctx.ease)
                    const readout = this.readouts[i]
                    if (readout) {
                        stepAt(readout, 'opacity', 0, ctx.t0)
                        readout.tween('opacity', 1, start, start + (end - start) * 0.5, ctx.ease)
                    }
                })
            },
        }
    }

    /** Animate to new values. The scale follows unless it was fixed at creation. */
    update(values: readonly number[], options: AnimOptions = {}): Anim {
        return {
            label: 'barChart.update', duration: options.duration ?? 1.1, ease: options.ease,
            schedule: (ctx) => {
                const from = this.values.map((v) => v.track.sample(ctx.t0))
                const fromMax = this.maxValue.track.sample(ctx.t0), fromMin = this.minValue.track.sample(ctx.t0)
                const toMax = this.fixedMax ?? Math.max(0, ...values), toMin = this.fixedMin ?? Math.min(0, ...values)
                tweenValue(this.maxValue, toMax, ctx.t0, ctx.t1, ctx.ease)
                tweenValue(this.minValue, toMin, ctx.t0, ctx.t1, ctx.ease)
                values.forEach((value, i) => {
                    tweenValue(this.values[i]!, value, ctx.t0, ctx.t1, ctx.ease)
                    const bar = this.bars[i]
                    if (!bar) return
                    const at = (a: number) => this.barPathAt(i, from[i]! + (value - from[i]!) * a, fromMax + (toMax - fromMax) * a, fromMin + (toMin - fromMin) * a)
                    bar.track('path').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: at(1), at })
                })
            },
        }
    }

    private barPathAt(i: number, value: number, max: number, min: number): Path {
        const span = (max - min) || 1
        const center = (i + 0.5) * this.band
        const thick = this.band * (1 - this.gap)
        if (this.horizontal) {
            const zero = (-min / span) * this.w - this.w / 2
            return rectPath(zero, center - this.h / 2 - thick / 2, (value / span) * this.w, thick)
        }
        const zero = this.h / 2 - (-min / span) * this.h
        const length = (value / span) * this.h
        return rectPath(center - this.w / 2 - thick / 2, zero - length, thick, length)
    }
}

export function barChart(data: readonly BarDatum[], options: BarChartOptions = {}): BarChart {
    return new BarChart(data, options)
}

// ── Histogram ───────────────────────────────────────────────────────────────

export interface HistogramOptions extends ChartOptions {
    bins?: number
    range?: readonly [number, number]
    /** Fixes the top of the scale, for a stable axis while samples arrive. */
    max?: number
    gap?: number
    /** Number of x tick labels. */
    ticks?: number
    colors?: readonly ColorInput[]
}

/**
 * A distribution that can fill up over time. `fillUp()` drops the samples in, in
 * order, so bars rise exactly as the data accumulates.
 */
export class Histogram extends Node {
    readonly shown: Value
    readonly bins: number
    readonly range: readonly [number, number]
    readonly chartWidth: number
    readonly chartHeight: number
    readonly axis = new Node()
    readonly total: number
    private readonly assigned: Int32Array
    readonly peak: number

    constructor(samples: readonly number[], options: HistogramOptions = {}) {
        super()
        this.chartWidth = options.width ?? 900
        this.chartHeight = options.height ?? 480
        this.bins = options.bins ?? 24
        const low = options.range?.[0] ?? Math.min(...samples)
        const high = options.range?.[1] ?? Math.max(...samples)
        this.range = [low, high]
        this.total = samples.length
        this.assigned = new Int32Array(samples.length)
        const counts = new Int32Array(this.bins)
        samples.forEach((sample, i) => {
            const bin = Math.min(this.bins - 1, Math.floor(((sample - low) / ((high - low) || 1)) * this.bins))
            this.assigned[i] = sample < low || sample > high ? -1 : bin
            if (this.assigned[i]! >= 0) counts[bin]!++
        })
        this.peak = options.max ?? Math.max(1, ...counts)
        this.shown = new Value(samples.length)
        const labelSize = options.labelSize ?? 20
        const w = this.chartWidth, h = this.chartHeight
        const baseline = line([-w / 2, h / 2], [w / 2, h / 2], { stroke: options.color ?? 'faint', width: 1.5 })
        this.axis.add(baseline)
        const { ticks, step } = niceTicks(low, high, options.ticks ?? 6)
        for (const tick of ticks) {
            const x = this.xAt(tick)
            this.axis.add(line([x, h / 2], [x, h / 2 + 6], { stroke: 'faint', width: 1.5 }))
            this.axis.add(small(formatNumber(tick, step), labelSize, 'dim', options.font).at(x, h / 2 + 12 + labelSize * 0.6))
        }
        const palette = (options.colors ?? ['blue']).map((c) => solidColor(c))
        const stops = palette.map((c, i) => [palette.length === 1 ? 0 : i / (palette.length - 1), c] as const)
        const gap = options.gap ?? 0.12
        const bars = dynamic(() => {
            const n = Math.max(0, Math.min(this.total, Math.round(this.shown.value)))
            const current = new Int32Array(this.bins)
            for (let i = 0; i < n; i++) {
                const bin = this.assigned[i]!
                if (bin >= 0) current[bin]!++
            }
            const width = w / this.bins
            const rings = []
            const out: Node[] = []
            for (let b = 0; b < this.bins; b++) {
                const height = (current[b]! / this.peak) * h
                if (height <= 0) continue
                const shape = rectPath(-w / 2 + b * width + width * gap / 2, h / 2 - height, width * (1 - gap), height)
                if (palette.length === 1) rings.push(...shape)
                else out.push(new Node(shape).fill(sampleStops(stops, b / Math.max(1, this.bins - 1))))
            }
            if (rings.length) out.push(new Node(rings).fill(palette[0]!))
            return out
        })
        this.add(bars, this.axis)
        ownLabels(this, { name: 'histogram', plot: true })
    }

    private xAt(value: number): number {
        const [low, high] = this.range
        return ((value - low) / ((high - low) || 1) - 0.5) * this.chartWidth
    }

    /** Local stage point for a value and a count. */
    p(value: number, count: number): [number, number] {
        return [this.xAt(value), this.chartHeight / 2 - (count / this.peak) * this.chartHeight]
    }

    /** Samples arrive in order, from none to `count` (all of them by default). */
    fillUp(options: AnimOptions & { count?: number } = {}): Anim {
        const shown = this.shown
        const target = options.count ?? this.total
        return {
            label: 'histogram.fill', duration: options.duration ?? 3, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                if (shown.track.keys.length === 0) shown.track.initial = 0
                tweenValue(shown, target, ctx.t0, ctx.t1, ctx.ease)
            },
        }
    }

    /** Overlay a curve, such as the fitted density, on the same axes. f returns a count. */
    curve(f: (x: number) => number, options: { color?: ColorInput; width?: number; samples?: number } = {}): Node {
        const [low, high] = this.range
        const samples = options.samples ?? 120
        const points: Vec[] = []
        for (let i = 0; i <= samples; i++) {
            const x = low + (high - low) * i / samples
            points.push(this.p(x, f(x)))
        }
        const node = new Node(smoothPath(points)).stroke(options.color ?? 'yellow', options.width ?? 4)
        this.add(node)
        return node
    }
}

export function histogram(samples: readonly number[], options: HistogramOptions = {}): Histogram {
    return new Histogram(samples, options)
}

// ── Shared XY frame ─────────────────────────────────────────────────────────

interface XYFrame {
    xRange: readonly [number, number]
    yRange: readonly [number, number]
    w: number
    h: number
}

function xyPoint(frame: XYFrame, x: number, y: number): [number, number] {
    const { xRange, yRange, w, h } = frame
    return [
        ((x - xRange[0]) / ((xRange[1] - xRange[0]) || 1) - 0.5) * w,
        (0.5 - (y - yRange[0]) / ((yRange[1] - yRange[0]) || 1)) * h,
    ]
}

function xyAxes(frame: XYFrame, options: { labelSize: number; color?: ColorInput; font?: TextOptions['font']; xLabel?: string; yLabel?: string; gridY?: boolean; xTicks?: number; yTicks?: number; xFormat?: (x: number) => string; yFormat?: (y: number) => string }): Node {
    const axis = new Node()
    const size = options.labelSize
    const color = options.color ?? 'faint'
    const font = options.font
    const { w, h } = frame
    const x = niceTicks(frame.xRange[0], frame.xRange[1], options.xTicks ?? 6)
    const y = niceTicks(frame.yRange[0], frame.yRange[1], options.yTicks ?? 5)
    for (const value of y.ticks) {
        const [, py] = xyPoint(frame, frame.xRange[0], value)
        if (options.gridY !== false) axis.add(line([-w / 2, py], [w / 2, py], { stroke: 'grid', width: 1.25 }))
        const label = small(options.yFormat ? options.yFormat(value) : formatNumber(value, y.step), size, 'dim', font)
        axis.add(label.at(-w / 2 - 12 - label.width / 2, py))
    }
    axis.add(line([-w / 2, h / 2], [w / 2, h / 2], { stroke: color, width: 1.5 }))
    for (const value of x.ticks) {
        const [px] = xyPoint(frame, value, frame.yRange[0])
        axis.add(line([px, h / 2], [px, h / 2 + 6], { stroke: color, width: 1.5 }))
        axis.add(small(options.xFormat ? options.xFormat(value) : formatNumber(value, x.step), size, 'dim', font).at(px, h / 2 + 12 + size * 0.6))
    }
    if (options.xLabel) {
        const label = small(options.xLabel, size, 'ink', font)
        axis.add(label.at(w / 2 - label.width / 2, h / 2 + 18 + size * 1.6))
    }
    if (options.yLabel) {
        const label = small(options.yLabel, size, 'ink', font)
        axis.add(label.at(-w / 2 + label.width / 2, -h / 2 - 12 - size / 2))
    }
    return axis
}

// ── Scatter ─────────────────────────────────────────────────────────────────

export interface ScatterPoint {
    x: number
    y: number
    color?: ColorInput
    radius?: number
    /** Points with the same group share a color and one direct label. */
    group?: string
}

export interface ScatterOptions extends ChartOptions {
    x?: readonly [number, number]
    y?: readonly [number, number]
    radius?: number
    xLabel?: string
    yLabel?: string
    /** Label each group near its center, instead of using a legend. */
    groupLabels?: boolean
}

export class Scatter extends Node {
    readonly dots: Node[] = []
    readonly axis: Node
    readonly groupLabels: Node[] = []
    private readonly frame: XYFrame

    constructor(points: readonly ScatterPoint[], options: ScatterOptions = {}) {
        super()
        const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
        const pad = (lo: number, hi: number) => (hi - lo || 1) * 0.06
        const xRange = options.x ?? [Math.min(...xs) - pad(Math.min(...xs), Math.max(...xs)), Math.max(...xs) + pad(Math.min(...xs), Math.max(...xs))]
        const yRange = options.y ?? [Math.min(...ys) - pad(Math.min(...ys), Math.max(...ys)), Math.max(...ys) + pad(Math.min(...ys), Math.max(...ys))]
        this.frame = { xRange, yRange, w: options.width ?? 900, h: options.height ?? 520 }
        const labelSize = options.labelSize ?? 18
        this.axis = xyAxes(this.frame, { labelSize, color: options.color, font: options.font, xLabel: options.xLabel, yLabel: options.yLabel })
        const groups = new Map<string, { color: ColorInput; sumX: number; top: number; count: number }>()
        const dots = points.map((point) => {
            let color = point.color
            if (point.group !== undefined) {
                let entry = groups.get(point.group)
                if (!entry) {
                    entry = { color: color ?? DEFAULT_SERIES[groups.size % DEFAULT_SERIES.length]!, sumX: 0, top: -Infinity, count: 0 }
                    groups.set(point.group, entry)
                }
                color ??= entry.color
                entry.sumX += point.x
                entry.top = Math.max(entry.top, point.y)
                entry.count++
            }
            const made = dot(point.radius ?? options.radius ?? 6, color ?? 'blue').at(xyPoint(this.frame, point.x, point.y))
            made.set('fillOpacity', 0.92)
            return made
        })
        this.dots.push(...dots)
        this.add(this.axis, ...dots)
        if (options.groupLabels ?? true) {
            for (const [name, entry] of groups) {
                const label = small(name, labelSize + 2, entry.color, options.font)
                // Above the cluster, so the label never sits on top of its own points.
                const [px, py] = xyPoint(this.frame, entry.sumX / entry.count, entry.top)
                label.at(px, py - labelSize * 1.2)
                this.groupLabels.push(label)
                this.add(label)
            }
        }
        ownLabels(this, { name: 'scatter chart', plot: true })
    }

    p(x: number, y: number): [number, number] {
        return xyPoint(this.frame, x, y)
    }

    /** Axes draw, then points land from left to right. */
    enter(options: AnimOptions = {}): Anim {
        const lag = options.lag ?? Math.min(0.2, 8 / Math.max(1, this.dots.length))
        return {
            label: 'scatter.enter', duration: options.duration ?? 2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                stepAt(this.axis, 'opacity', 0, ctx.t0)
                this.axis.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.3, ctx.ease)
                const order = [...this.dots].sort((a, b) => a.get('x') - b.get('x'))
                const windows = staggered(order.length, lag, ctx.t0 + span * 0.15, ctx.t1)
                order.forEach((point, i) => {
                    const [start, end] = windows[i]!
                    const sx = point.get('sx')
                    stepAt(point, 'sx', 0.001, ctx.t0)
                    stepAt(point, 'sy', 0.001, ctx.t0)
                    point.tween('sx', sx, start, end, ctx.ease)
                    point.tween('sy', sx, start, end, ctx.ease)
                })
                for (const label of this.groupLabels) {
                    stepAt(label, 'opacity', 0, ctx.t0)
                    label.tween('opacity', 1, ctx.t0 + span * 0.7, ctx.t1, ctx.ease)
                }
            },
        }
    }

    /** A straight or curved fit through the data, drawn on the same axes. */
    fit(f: (x: number) => number, options: { color?: ColorInput; width?: number; samples?: number } = {}): Node {
        const [x0, x1] = this.frame.xRange
        const samples = options.samples ?? 60
        const points: Vec[] = []
        for (let i = 0; i <= samples; i++) {
            const x = x0 + (x1 - x0) * i / samples
            points.push(this.p(x, f(x)))
        }
        const node = new Node(smoothPath(points)).stroke(options.color ?? 'yellow', options.width ?? 3.5)
        this.add(node)
        return node
    }
}

export function scatter(points: readonly ScatterPoint[], options: ScatterOptions = {}): Scatter {
    return new Scatter(points, options)
}

// ── Lines ───────────────────────────────────────────────────────────────────

export interface LineSeries {
    name?: string
    /** Y values at x = 0, 1, 2, ... */
    values?: readonly number[]
    points?: readonly Vec[]
    color?: ColorInput
    width?: number
    dash?: readonly number[]
    /** Soft fill under the line. */
    area?: number
    smooth?: boolean
}

export interface LineChartOptions extends ChartOptions {
    x?: readonly [number, number]
    y?: readonly [number, number]
    xLabel?: string
    yLabel?: string
    xFormat?: (x: number) => string
    yFormat?: (y: number) => string
    xTicks?: number
    yTicks?: number
}

export class LineChart extends Node {
    readonly lines: Node[] = []
    readonly areas: Node[] = []
    readonly names: Node[] = []
    readonly axis: Node
    private readonly byName = new Map<string, Node>()
    private readonly frame: XYFrame

    constructor(series: readonly LineSeries[], options: LineChartOptions = {}) {
        super()
        const resolved = series.map((entry) => entry.points ?? (entry.values ?? []).map((value, i) => [i, value] as Vec))
        const xs = resolved.flat().map((p) => p[0]), ys = resolved.flat().map((p) => p[1])
        const yLow = Math.min(...ys), yHigh = Math.max(...ys)
        const yPad = (yHigh - yLow || 1) * 0.08
        const xRange = options.x ?? [Math.min(...xs), Math.max(...xs)]
        const yRange = options.y ?? [yLow >= 0 && yLow < (yHigh - yLow) * 0.4 ? 0 : yLow - yPad, yHigh + yPad]
        const w = options.width ?? 900, h = options.height ?? 480
        this.frame = { xRange, yRange, w, h }
        const labelSize = options.labelSize ?? 18
        this.axis = xyAxes(this.frame, { labelSize, color: options.color, font: options.font, xLabel: options.xLabel, yLabel: options.yLabel, xFormat: options.xFormat, yFormat: options.yFormat, xTicks: options.xTicks, yTicks: options.yTicks })
        this.add(this.axis)
        const ends: { label: Node; y: number }[] = []
        series.forEach((entry, i) => {
            const color = entry.color ?? DEFAULT_SERIES[i % DEFAULT_SERIES.length]!
            const points = resolved[i]!.map(([x, y]) => xyPoint(this.frame, x, y) as Vec)
            if (entry.area) {
                const base = xyPoint(this.frame, xRange[0], Math.max(yRange[0], 0))[1]
                const shape = polyPath([...points, [points[points.length - 1]![0], base], [points[0]![0], base]], true)
                const area = new Node(shape).fill(color, entry.area)
                this.areas.push(area)
                this.add(area)
            }
            const path = entry.smooth === false ? polyPath(points) : smoothPath(points)
            const stroke = new Node(path).stroke(color, entry.width ?? 3.5)
            if (entry.dash) stroke.dash(entry.dash)
            this.lines.push(stroke)
            this.add(stroke)
            if (entry.name) {
                this.byName.set(entry.name, stroke)
                const label = small(entry.name, labelSize + 1, color, options.font)
                const last = points[points.length - 1]!
                ends.push({ label, y: last[1] })
                label.at(last[0] + 12 + label.width / 2, last[1])
                this.names.push(label)
                this.add(label)
            }
        })
        // Direct labels at line ends, nudged apart when lines finish close together.
        ends.sort((a, b) => a.y - b.y)
        const spacing = labelSize * 1.25
        for (let pass = 0; pass < 8; pass++) {
            for (let i = 1; i < ends.length; i++) {
                const overlap = spacing - (ends[i]!.y - ends[i - 1]!.y)
                if (overlap > 0) {
                    ends[i - 1]!.y -= overlap / 2
                    ends[i]!.y += overlap / 2
                }
            }
        }
        for (const end of ends) end.label.at(end.label.get('x'), end.y)
        ownLabels(this, { name: 'line chart', plot: true })
    }

    p(x: number, y: number): [number, number] {
        return xyPoint(this.frame, x, y)
    }

    series(name: string): Node {
        const found = this.byName.get(name)
        if (!found) throw new Error(`No series named ${JSON.stringify(name)}.`)
        return found
    }

    /** Axes fade in, lines draw left to right, and their labels arrive as each line lands. */
    enter(options: AnimOptions = {}): Anim {
        const lag = options.lag ?? 0.1
        return {
            label: 'lineChart.enter', duration: options.duration ?? 2.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                stepAt(this.axis, 'opacity', 0, ctx.t0)
                this.axis.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.3, ctx.ease)
                const windows = staggered(this.lines.length, lag, ctx.t0 + span * 0.15, ctx.t1)
                this.lines.forEach((stroke, i) => {
                    const [start, end] = windows[i]!
                    stepAt(stroke, 'trimTo', 0, ctx.t0)
                    stroke.tween('trimTo', 1, start, end, ctx.ease)
                    const name = this.names[i]
                    if (name) {
                        stepAt(name, 'opacity', 0, ctx.t0)
                        name.tween('opacity', 1, end - (end - start) * 0.2, Math.min(ctx.t1, end + span * 0.1), ctx.ease)
                    }
                })
                for (const area of this.areas) {
                    const target = area.get('fillOpacity')
                    stepAt(area, 'fillOpacity', 0, ctx.t0)
                    area.tween('fillOpacity', target, ctx.t0 + span * 0.5, ctx.t1, ctx.ease)
                }
            },
        }
    }
}

export function lineChart(series: readonly LineSeries[], options: LineChartOptions = {}): LineChart {
    return new LineChart(series, options)
}

// ── Pie and donut ───────────────────────────────────────────────────────────

export interface PieDatum {
    label: string
    value: number
    color?: ColorInput
}

export interface PieOptions {
    radius?: number
    /** Inner radius as a fraction of the outer radius. 0 makes a pie. */
    hole?: number
    /** Angular gap between wedges, in radians. */
    gap?: number
    labelSize?: number
    /** Show each share as a percentage beside its label. */
    percent?: boolean
    labels?: boolean
    centerLabel?: string
    centerSize?: number
    /** The font of the labels. Defaults to the font of the film. The center label is in the display serif. */
    font?: TextOptions['font']
}

function wedgePath(a0: number, a1: number, inner: number, outer: number): Path {
    if (a1 - a0 < 1e-4) return []
    const outerArc = arcPath(0, 0, outer, outer, a0, a1)[0]!.p
    const points: number[] = Array.from(outerArc)
    const cx = points[points.length - 2]!, cy = points[points.length - 1]!
    const hop = (x: number, y: number, tx: number, ty: number) => {
        points.push(x + (tx - x) / 3, y + (ty - y) / 3, x + (tx - x) * 2 / 3, y + (ty - y) * 2 / 3, tx, ty)
    }
    if (inner > 0.01) {
        const innerArc = arcPath(0, 0, inner, inner, a1, a0)[0]!.p
        hop(cx, cy, innerArc[0]!, innerArc[1]!)
        for (let i = 2; i < innerArc.length; i++) points.push(innerArc[i]!)
        hop(innerArc[innerArc.length - 2]!, innerArc[innerArc.length - 1]!, outerArc[0]!, outerArc[1]!)
    } else {
        hop(cx, cy, 0, 0)
        hop(0, 0, outerArc[0]!, outerArc[1]!)
    }
    return [ring(points, true)]
}

/** Share of a whole, labeled directly. `enter()` sweeps around, and `update()` re-divides it. */
export class PieChart extends Node {
    readonly wedges: Node[] = []
    readonly labels: Node[] = []
    readonly leaders: Node[] = []
    readonly centerText: Node | null = null
    private readonly shares: number[]
    private readonly inner: number
    private readonly outer: number
    private readonly gap: number

    constructor(data: readonly PieDatum[], options: PieOptions = {}) {
        super()
        this.outer = options.radius ?? 240
        this.inner = this.outer * (options.hole ?? 0)
        this.gap = options.gap ?? (this.inner > 0 ? 0.018 : 0.008)
        const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0) || 1
        this.shares = data.map((d) => Math.max(0, d.value) / total)
        const size = options.labelSize ?? 20
        const angles = this.angles(this.shares)
        data.forEach((datum, i) => {
            const color = datum.color ?? DEFAULT_SERIES[i % DEFAULT_SERIES.length]!
            const [a0, a1] = angles[i]!
            const wedge = new Node(wedgePath(a0, a1, this.inner, this.outer)).fill(color, 0.86)
            this.wedges.push(wedge)
            this.add(wedge)
        })
        if (options.labels ?? true) {
            data.forEach((datum, i) => {
                const [a0, a1] = angles[i]!
                const mid = (a0 + a1) / 2
                const cos = Math.cos(mid), sin = Math.sin(mid)
                const r0 = this.outer + 6, r1 = this.outer + 30
                const elbowX = cos * r1, elbowY = sin * r1
                const endX = elbowX + (cos >= 0 ? 18 : -18)
                const leader = new Node(polyPath([[cos * r0, sin * r0], [elbowX, elbowY], [endX, elbowY]])).stroke('faint', 1.25)
                const percent = options.percent ?? true
                const body = percent ? `${datum.label}  ${Math.round(this.shares[i]! * 100)}%` : datum.label
                const label = small(body, size, 'ink', options.font)
                label.at(endX + (cos >= 0 ? 8 + label.width / 2 : -8 - label.width / 2), elbowY)
                this.leaders.push(leader)
                this.labels.push(label)
                this.add(leader, label)
            })
        }
        if (options.centerLabel) {
            const center = text(options.centerLabel, { size: options.centerSize ?? Math.max(24, this.inner * 0.34), font: 'serif', color: 'ink' }).at(0, 0)
            ;(this as { centerText: Node | null }).centerText = center
            this.add(center)
        }
        ownLabels(this, { name: 'pie chart' })
    }

    private angles(shares: readonly number[], sweep = 1): [number, number][] {
        let cursor = -Math.PI / 2
        return shares.map((share) => {
            const span = share * Math.PI * 2 * sweep
            const gap = Math.min(this.gap * sweep, span * 0.45)
            const out: [number, number] = [cursor + gap / 2, cursor + span - gap / 2]
            cursor += span
            return out
        })
    }

    /** Wedges sweep open around the circle, then the labels arrive. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'pie.enter', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                const sweepEnd = ctx.t0 + span * 0.78
                this.wedges.forEach((wedge, i) => {
                    const at = (a: number): Path => {
                        const [x, y] = this.angles(this.shares, a)[i]!
                        return wedgePath(x, y, this.inner, this.outer)
                    }
                    wedge.track('path').step(ctx.t0, [])
                    wedge.track('path').add({ t0: ctx.t0, t1: sweepEnd, ease: ctx.ease, to: at(1), at })
                })
                for (const node of [...this.labels, ...this.leaders, ...(this.centerText ? [this.centerText] : [])]) {
                    stepAt(node, 'opacity', 0, ctx.t0)
                    node.tween('opacity', 1, ctx.t0 + span * 0.62, ctx.t1, ctx.ease)
                }
            },
        }
    }

    /** Re-divide the circle. Geometry animates, and labels follow their wedges. */
    update(values: readonly number[], options: AnimOptions = {}): Anim {
        return {
            label: 'pie.update', duration: options.duration ?? 1.1, ease: options.ease,
            schedule: (ctx) => {
                const total = values.reduce((sum, v) => sum + Math.max(0, v), 0) || 1
                const next = values.map((v) => Math.max(0, v) / total)
                const previous = [...this.shares]
                this.wedges.forEach((wedge, i) => {
                    const at = (a: number): Path => {
                        const shares = previous.map((share, k) => share + ((next[k] ?? 0) - share) * a)
                        const [x, y] = this.angles(shares)[i]!
                        return wedgePath(x, y, this.inner, this.outer)
                    }
                    wedge.track('path').add({ t0: ctx.t0, t1: ctx.t1, ease: ctx.ease, to: at(1), at })
                })
                for (const node of [...this.labels, ...this.leaders]) {
                    node.tween('opacity', 0, ctx.t0, ctx.t0 + (ctx.t1 - ctx.t0) * 0.3, ctx.ease)
                }
                next.forEach((share, i) => { this.shares[i] = share })
            },
        }
    }
}

export function pie(data: readonly PieDatum[], options: PieOptions = {}): PieChart {
    return new PieChart(data, options)
}

export function donut(data: readonly PieDatum[], options: PieOptions = {}): PieChart {
    return new PieChart(data, { hole: 0.62, ...options })
}

// ── Heatmap ─────────────────────────────────────────────────────────────────

export interface HeatmapOptions {
    /** Cell edge in stage pixels. */
    cell?: number
    cellWidth?: number
    cellHeight?: number
    gap?: number
    colors?: readonly ColorInput[]
    /** Value range for the color ramp. */
    domain?: readonly [number, number]
    /** Print values in cells. */
    values?: boolean
    format?: (value: number) => string
    valueSize?: number
    rowLabels?: readonly string[]
    columnLabels?: readonly string[]
    labelSize?: number
    /** Tilt column labels so long names fit, in radians. */
    columnLabelAngle?: number
    radius?: number
    /** The font of the row and the column labels. Defaults to the font of the film. The values in the cells are in mono. */
    font?: TextOptions['font']
}

export class Heatmap extends Node {
    readonly cells: Node[][] = []
    readonly rowLabels: Node[] = []
    readonly columnLabels: Node[] = []
    readonly numbers: Node[][] = []
    readonly rowCount: number
    readonly colCount: number
    private readonly stops: readonly (readonly [number, Rgba])[]
    private readonly domain: readonly [number, number]

    constructor(values: readonly (readonly number[])[], options: HeatmapOptions = {}) {
        super()
        this.rowCount = values.length
        this.colCount = Math.max(0, ...values.map((row) => row.length))
        const w = options.cellWidth ?? options.cell ?? 44
        const h = options.cellHeight ?? options.cell ?? 44
        const gap = options.gap ?? 2
        const flat = values.flat()
        this.domain = options.domain ?? [Math.min(...flat), Math.max(...flat)]
        const palette = (options.colors ?? ['surface', 'blue', 'yellow']).map((c) => solidColor(c))
        this.stops = palette.map((c, i) => [palette.length === 1 ? 0 : i / (palette.length - 1), c] as const)
        const totalW = this.colCount * w + (this.colCount - 1) * gap
        const totalH = this.rowCount * h + (this.rowCount - 1) * gap
        const labelSize = options.labelSize ?? 16
        const valueSize = options.valueSize ?? Math.min(h * 0.38, w * 0.36)
        const format = options.format ?? ((v: number) => (Math.round(v * 100) / 100).toString())
        values.forEach((row, i) => {
            const cells: Node[] = []
            const numbers: Node[] = []
            row.forEach((value, j) => {
                const cx = -totalW / 2 + j * (w + gap) + w / 2
                const cy = -totalH / 2 + i * (h + gap) + h / 2
                const color = this.colorFor(value)
                const cell = new Node(rectPath(-w / 2, -h / 2, w, h, options.radius ?? 0)).fill(color).at(cx, cy)
                cells.push(cell)
                this.add(cell)
                if (options.values) {
                    const label = text(format(value), { size: valueSize, font: 'mono', color: luminance(color) > 0.32 ? '#101114' : '#f2efe6' }).at(cx, cy)
                    numbers.push(label)
                    this.add(label)
                }
            })
            this.cells.push(cells)
            this.numbers.push(numbers)
        })
        options.rowLabels?.forEach((name, i) => {
            const label = small(name, labelSize, 'dim', options.font)
            const y = -totalH / 2 + i * (h + gap) + h / 2
            label.at(-totalW / 2 - 10 - label.width / 2, y)
            this.rowLabels.push(label)
            this.add(label)
        })
        options.columnLabels?.forEach((name, j) => {
            const label = small(name, labelSize, 'dim', options.font)
            const x = -totalW / 2 + j * (w + gap) + w / 2
            const angle = options.columnLabelAngle ?? 0
            if (angle !== 0) {
                // Tilted labels end at their column, reading up and to the right.
                const length = label.width
                label.at(x + Math.cos(angle) * length / 2, -totalH / 2 - 12 + Math.sin(angle) * length / 2)
                label.set('rotation', angle)
            } else {
                label.at(x, -totalH / 2 - 10 - labelSize / 2)
            }
            this.columnLabels.push(label)
            this.add(label)
        })
        ownLabels(this, { name: 'heatmap' })
    }

    colorFor(value: number): Rgba {
        const [low, high] = this.domain
        return sampleStops(this.stops, Math.max(0, Math.min(1, (value - low) / ((high - low) || 1))))
    }

    cell(row: number, column: number): Node {
        const found = this.cells[row]?.[column]
        if (!found) throw new Error(`Heatmap has no cell (${row}, ${column}). It is ${this.rowCount} by ${this.colCount}.`)
        return found
    }

    row(index: number): Node[] {
        return [...(this.cells[index] ?? [])]
    }

    col(index: number): Node[] {
        return this.cells.map((row) => row[index]!).filter(Boolean)
    }

    /** Cells fade in along the diagonal. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'heatmap.enter', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                const diagonals = this.rowCount + this.colCount - 1
                const each = span * 0.5
                const stagger = diagonals > 1 ? (span - each) / (diagonals - 1) : 0
                this.cells.forEach((row, i) => row.forEach((cell, j) => {
                    const start = ctx.t0 + (i + j) * stagger
                    stepAt(cell, 'opacity', 0, ctx.t0)
                    cell.tween('opacity', 1, start, start + each, ctx.ease)
                    const number = this.numbers[i]?.[j]
                    if (number) {
                        stepAt(number, 'opacity', 0, ctx.t0)
                        number.tween('opacity', 1, start, start + each, ctx.ease)
                    }
                }))
                for (const label of [...this.rowLabels, ...this.columnLabels]) {
                    stepAt(label, 'opacity', 0, ctx.t0)
                    label.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.4, ctx.ease)
                }
            },
        }
    }

    /** Recolor every cell to new values. */
    update(values: readonly (readonly number[])[], options: AnimOptions = {}): Anim {
        return {
            label: 'heatmap.update', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                values.forEach((row, i) => row.forEach((value, j) => {
                    const cell = this.cells[i]?.[j]
                    if (cell) cell.tween('fill', this.colorFor(value), ctx.t0, ctx.t1, ctx.ease)
                }))
            },
        }
    }
}

export function heatmap(values: readonly (readonly number[])[], options: HeatmapOptions = {}): Heatmap {
    return new Heatmap(values, options)
}

