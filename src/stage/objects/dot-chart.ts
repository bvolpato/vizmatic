import { Node } from '../node'
import { circle, dot, line } from '../shapes'
import { text, type TextOptions } from '../text'
import type { ColorInput } from '../color'
import type { Anim, AnimOptions } from '../anim'
import { formatNumber, niceTicks, reveal, staggered, stepAt } from './util'

export interface DotDatum {
    label: string
    value: number
    /** The two ends of an interval around the value, such as a 95% confidence interval. Give both or none. */
    low?: number
    high?: number
    /** Defaults to the `dotColor` of the chart. */
    color?: ColorInput
    /** Draw a ring in place of a filled dot, to tell a second group apart. */
    hollow?: boolean
}

export interface DotChartOptions {
    /** The length of the axis. The labels are outside it, at the left. Defaults to 900. */
    width?: number
    /** The height of all rows together. Defaults to 1.65 of `labelSize` for each row. */
    height?: number
    /** Text size of the labels and the ticks. Defaults to 20. */
    labelSize?: number
    /** The color of the axis. Defaults to faint. */
    color?: ColorInput
    /** The color of a dot that has none of its own. Defaults to blue. */
    dotColor?: ColorInput
    /** The values at the two ends of the axis. Defaults to a round range that holds every value and interval. */
    domain?: readonly [number, number]
    /** About how many ticks to draw, or the values to mark. Defaults to about 5. */
    ticks?: number | readonly number[]
    /** How to write a tick. */
    format?: (value: number) => string
    /** A line under the axis that says what the value is and which way is better. */
    xLabel?: string
    /** Draw a faint vertical line at each tick. On by default. */
    grid?: boolean
    font?: TextOptions['font']
}

/**
 * One row per item: its label, a dot at its value on a shared axis, and a line for its interval. It shows
 * many scores with their uncertainty in less room than bars, and its axis does not have to start at zero.
 * The rows keep the order of the data, so sort the data to rank it. `enter()` brings the rows in one by one.
 */
export class DotChart extends Node {
    /** One node per item, which holds its label, its interval and its dot. */
    readonly rows: Node[] = []
    readonly labels: Node[] = []
    readonly dots: Node[] = []
    /** The interval of each item, or null for an item that has none. */
    readonly intervals: (Node | null)[] = []
    /** The axis line, the grid, the ticks and their numbers, and the axis label. */
    readonly axis: Node
    /** The two ends of the axis, as values. */
    readonly domain: readonly [number, number]
    private readonly w: number
    private readonly h: number
    private readonly count: number

    constructor(data: readonly DotDatum[], options: DotChartOptions = {}) {
        super()
        if (data.length === 0) throw new Error('dotChart: give it at least one item')
        const size = options.labelSize ?? 20
        const font = options.font
        this.count = data.length
        this.w = options.width ?? 900
        this.h = options.height ?? data.length * size * 1.65
        data.forEach((item, index) => {
            const name = `item ${index} (${JSON.stringify(item.label)})`
            for (const number of [item.value, item.low, item.high]) {
                if (number !== undefined && !Number.isFinite(number)) throw new Error(`dotChart: ${name} has a value that is not a number`)
            }
            if ((item.low === undefined) !== (item.high === undefined)) throw new Error(`dotChart: ${name} has one end of an interval. Give low and high, or none`)
            if (item.low !== undefined && !(item.low <= item.value && item.value <= item.high!)) throw new Error(`dotChart: the value of ${name} is outside its interval`)
        })

        const numbers = data.flatMap((item) => [item.value, item.low ?? item.value, item.high ?? item.value])
        const least = Math.min(...numbers), most = Math.max(...numbers)
        const about = typeof options.ticks === 'number' ? options.ticks : 5
        let domain = options.domain
        if (!domain && typeof options.ticks === 'object') {
            // With given ticks and no domain, the axis runs from the first tick to the last, and holds the data.
            domain = [Math.min(least, ...options.ticks), Math.max(most, ...options.ticks)]
        }
        if (!domain) {
            // Round the range of the data out to whole steps, so that no dot sits on an end of the axis by chance.
            const { step } = niceTicks(least, most > least ? most : least + 1, about)
            const from = Math.floor(least / step + 1e-9) * step
            const to = Math.ceil(most / step - 1e-9) * step
            domain = [from, to > from ? to : from + step]
        }
        if (!(Number.isFinite(domain[0]) && Number.isFinite(domain[1]) && domain[1] > domain[0])) throw new Error('dotChart: the domain needs two different ends, the smaller one first')
        const [first, last] = domain
        const outside = numbers.find((value) => value < first || value > last)
        if (outside !== undefined) throw new Error(`dotChart: ${outside} is outside the domain ${first} to ${last}`)
        this.domain = domain
        const slack = (last - first) * 1e-9
        const inside = (value: number) => value >= first - slack && value <= last + slack
        let ticks: readonly number[]
        if (typeof options.ticks === 'object') {
            ticks = options.ticks
            const stray = ticks.find((tick) => !Number.isFinite(tick) || !inside(tick))
            if (stray !== undefined) throw new Error(`dotChart: the tick ${stray} is outside the domain ${first} to ${last}`)
        } else {
            ticks = niceTicks(first, last, about).ticks.filter(inside)
        }
        // Write every tick with the decimals that the finest one needs, so 0.25 does not read as 0.3.
        const decimals = (value: number) => [0, 1, 2, 3].find((digits) => Math.abs(value * 10 ** digits - Math.round(value * 10 ** digits)) < 1e-9) ?? 4
        const digits = Math.max(0, ...ticks.map(decimals))
        const format = options.format ?? ((value: number) => (digits > 0 ? value.toFixed(digits) : formatNumber(value)))

        const left = -this.w / 2, right = this.w / 2, top = -this.h / 2, bottom = this.h / 2
        const axisColor = options.color ?? 'faint'
        this.axis = new Node()
        for (const tick of ticks) {
            const [x] = this.p(tick, 0)
            if (options.grid ?? true) this.axis.add(line([x, top], [x, bottom], { stroke: 'grid', width: 1.5 }))
            this.axis.add(line([x, bottom], [x, bottom + size * 0.3], { stroke: axisColor, width: 1.5 }))
            this.axis.add(text(format(tick), { size, font, color: 'dim' }).at(x, bottom + size * 1.15))
        }
        this.axis.add(line([left, bottom], [right, bottom], { stroke: axisColor, width: 1.5 }))
        if (options.xLabel) this.axis.add(text(options.xLabel, { size, font, color: 'ink', anchor: 'right' }).at(right, bottom + size * 2.6))
        this.add(this.axis)

        const radius = size * 0.32, cap = radius * 1.6, weight = Math.max(2, size * 0.11)
        data.forEach((item, index) => {
            const color = item.color ?? options.dotColor ?? 'blue'
            const [x, y] = this.p(item.value, index)
            const label = text(item.label, { size, font, color: 'ink', anchor: 'right' }).at(left - size * 0.9, y)
            let interval: Node | null = null
            if (item.low !== undefined) {
                // The caps are taller than the dot, so an interval that is narrower than the dot still shows.
                const from = this.p(item.low, index)[0], to = this.p(item.high!, index)[0]
                interval = new Node().add(
                    line([from, y], [to, y], { stroke: color, width: weight }),
                    line([from, y - cap], [from, y + cap], { stroke: color, width: weight }),
                    line([to, y - cap], [to, y + cap], { stroke: color, width: weight }),
                )
            }
            // A ring has the background inside it, so the line of its interval does not show through.
            const mark = (item.hollow ? circle(radius, { stroke: color, width: weight, fill: 'bg' }) : dot(radius, color)).at(x, y)
            const row = new Node().add(label, ...(interval ? [interval] : []), mark)
            this.labels.push(label)
            this.intervals.push(interval)
            this.dots.push(mark)
            this.rows.push(row)
            this.add(row)
        })
    }

    /** The place of a value in a row, in the coordinates of the chart. Row 0 is the first item. */
    p(value: number, row: number): [number, number] {
        return [
            -this.w / 2 + ((value - this.domain[0]) / (this.domain[1] - this.domain[0])) * this.w,
            -this.h / 2 + ((row + 0.5) / this.count) * this.h,
        ]
    }

    /** The axis fades in, then the rows arrive one after another, from the first to the last. */
    enter(options: AnimOptions = {}): Anim {
        const lag = options.lag ?? 0.35
        return {
            label: 'dotChart.enter', duration: options.duration ?? 1.8, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0
                stepAt(this.axis, 'opacity', 0, ctx.t0)
                this.axis.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.3, ctx.ease)
                const windows = staggered(this.rows.length, lag, ctx.t0 + span * 0.15, ctx.t1)
                this.rows.forEach((row, index) => {
                    const [start, end] = windows[index]!
                    stepAt(row, 'opacity', 0, ctx.t0)
                    row.tween('opacity', 1, start, end, ctx.ease)
                })
            },
        }
    }
}

/** Dots on a shared axis, one row per item, with a line for each interval: `dotChart([{ label: 'blocks', value: 0.89, low: 0.87, high: 0.91 }])`. */
export function dotChart(data: readonly DotDatum[], options: DotChartOptions = {}): DotChart {
    return new DotChart(data, options)
}
