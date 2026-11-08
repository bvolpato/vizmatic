import { Node } from '../node'
import { circle, dot, line } from '../shapes'
import { text, type TextOptions } from '../text'
import type { ColorInput } from '../color'
import { formatNumber, niceTicks } from './util'

export interface DotDatum {
    label: string
    value: number
    /** The two ends of an interval around the value, such as a 95% confidence interval. Give both or none. */
    low?: number
    high?: number
    /** Defaults to the `color` of the chart. */
    color?: ColorInput
    /** Draw a ring in place of a filled dot, to tell a second group apart. */
    hollow?: boolean
}

export interface DotChartOptions {
    /** The width of the whole chart, with its labels. Defaults to 1200. */
    width?: number
    /** The height of one row. Defaults to 1.65 of `labelSize`. */
    rowHeight?: number
    /** Text size of the labels and the ticks. Defaults to 28. */
    labelSize?: number
    /** The color of a dot that has none of its own. Defaults to blue. */
    color?: ColorInput
    /** The values at the two ends of the axis. Defaults to a round range that holds every value and interval. */
    domain?: readonly [number, number]
    /** The values to mark on the axis. Defaults to round steps over the domain. */
    ticks?: readonly number[]
    /** How to write a tick. */
    format?: (value: number) => string
    /** A line under the axis that says what the value is and which way is better. */
    axisLabel?: string
    /** Draw a faint vertical line at each tick. On by default. */
    grid?: boolean
    font?: TextOptions['font']
}

/**
 * One row per item: its label, a dot at its value on a shared axis, and a line for its interval. It shows
 * many scores with their uncertainty in less room than bars, and it does not force the axis to start at zero.
 * The rows keep the order of the data, so sort the data to rank it.
 */
export class DotChart extends Node {
    /** One node per item, which holds its label, its interval and its dot. Reveal them in order to build the chart. */
    readonly rows: Node[] = []
    readonly labels: Node[] = []
    readonly dots: Node[] = []
    /** The interval of each item, or null for an item that has none. */
    readonly intervals: (Node | null)[] = []
    /** The axis line, the grid, the ticks and their numbers, and the axis label. */
    readonly axis: Node
    private readonly plotLeft: number
    private readonly plotRight: number
    private readonly plotTop: number
    private readonly rowHeight: number
    private readonly domain: readonly [number, number]

    constructor(data: readonly DotDatum[], options: DotChartOptions = {}) {
        super()
        if (data.length === 0) throw new Error('dotChart: give it at least one item')
        const size = options.labelSize ?? 28
        const width = options.width ?? 1200
        const rowHeight = options.rowHeight ?? size * 1.65
        const font = options.font
        const gap = size * 0.9
        data.forEach((item, index) => {
            if ((item.low === undefined) !== (item.high === undefined)) throw new Error(`dotChart: item ${index} (${JSON.stringify(item.label)}) has one end of an interval. Give low and high, or none`)
            if (item.low !== undefined && !(item.low <= item.value && item.value <= item.high!)) throw new Error(`dotChart: the value of item ${index} (${JSON.stringify(item.label)}) is outside its interval`)
        })

        const numbers = data.flatMap((item) => [item.value, item.low ?? item.value, item.high ?? item.value])
        const least = Math.min(...numbers), most = Math.max(...numbers)
        const auto = niceTicks(least, most === least ? least + 1 : most)
        const ticks = options.ticks ?? auto.ticks
        const domain = options.domain ?? [Math.min(least, ...ticks), Math.max(most, ...ticks)] as const
        if (!(domain[1] > domain[0])) throw new Error('dotChart: the domain needs two different ends, the smaller one first')
        const outside = numbers.find((value) => value < domain[0] || value > domain[1])
        if (outside !== undefined) throw new Error(`dotChart: ${outside} is outside the domain ${domain[0]} to ${domain[1]}`)
        // Write every tick with the decimals that the finest one needs, so 0.25 does not read as 0.3.
        const decimals = (value: number) => [0, 1, 2, 3].find((digits) => Math.abs(value * 10 ** digits - Math.round(value * 10 ** digits)) < 1e-9) ?? 4
        const digits = Math.max(...ticks.map(decimals))
        const format = options.format ?? ((value: number) => (digits > 0 ? value.toFixed(digits) : formatNumber(value)))

        const labels = data.map((item) => text(item.label, { size, font, color: 'ink', anchor: 'right' }))
        const labelWidth = Math.max(...labels.map((label) => label.bounds().width))
        if (labelWidth + gap > width * 0.6) throw new Error('dotChart: the labels take more than 0.6 of the width. Shorten them, or widen the chart')
        // The chart is centered on the origin: labels at the left, the axis in the rest.
        const left = -width / 2 + labelWidth + gap, right = width / 2
        const rows = data.length
        const axisLabelRoom = options.axisLabel ? size * 1.5 : 0
        const below = size * 0.5 + size * 1.3 + axisLabelRoom
        const top = -(rows * rowHeight + below) / 2
        const bottom = top + rows * rowHeight
        this.plotLeft = left
        this.plotRight = right
        this.plotTop = top
        this.rowHeight = rowHeight
        this.domain = domain

        this.axis = new Node()
        for (const tick of ticks) {
            const x = this.x(tick)
            if (options.grid ?? true) this.axis.add(line([x, top], [x, bottom], { stroke: 'grid', width: 1.5 }))
            this.axis.add(line([x, bottom], [x, bottom + size * 0.3], { stroke: 'faint', width: 2 }))
            this.axis.add(text(format(tick), { size, font, color: 'dim' }).at(x, bottom + size * 0.5 + size * 0.65))
        }
        this.axis.add(line([left, bottom], [right, bottom], { stroke: 'faint', width: 2 }))
        if (options.axisLabel) this.axis.add(text(options.axisLabel, { size, font, color: 'dim', anchor: 'right' }).at(right, bottom + size * 0.5 + size * 1.3 + size * 0.75))
        this.add(this.axis)

        const radius = size * 0.32
        data.forEach((item, index) => {
            const y = this.y(index), color = item.color ?? options.color ?? 'blue'
            const label = labels[index]!.at(left - gap, y)
            let interval: Node | null = null
            if (item.low !== undefined) {
                const from = this.x(item.low), to = this.x(item.high!), cap = radius * 0.8
                interval = new Node().add(
                    line([from, y], [to, y], { stroke: color, width: 3 }),
                    line([from, y - cap], [from, y + cap], { stroke: color, width: 3 }),
                    line([to, y - cap], [to, y + cap], { stroke: color, width: 3 }),
                )
            }
            // A ring has the background inside it, so the line of its interval does not show through.
            const mark = (item.hollow ? circle(radius, { stroke: color, width: 3, fill: 'bg' }) : dot(radius, color)).at(this.x(item.value), y)
            const row = new Node().add(label, ...(interval ? [interval] : []), mark)
            this.labels.push(label)
            this.intervals.push(interval)
            this.dots.push(mark)
            this.rows.push(row)
            this.add(row)
        })
    }

    /** The x of a value on the axis, in the coordinates of the chart. */
    x(value: number): number {
        return this.plotLeft + ((value - this.domain[0]) / (this.domain[1] - this.domain[0])) * (this.plotRight - this.plotLeft)
    }

    /** The y of the middle of a row, in the coordinates of the chart. Row 0 is the first item. */
    y(row: number): number {
        return this.plotTop + (row + 0.5) * this.rowHeight
    }
}

/** Dots on a shared axis, one row per item, with a line for each interval: `dotChart([{ label: 'blocks', value: 0.89, low: 0.87, high: 0.91 }])`. */
export function dotChart(data: readonly DotDatum[], options: DotChartOptions = {}): DotChart {
    return new DotChart(data, options)
}
