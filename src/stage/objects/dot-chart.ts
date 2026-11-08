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
    /**
     * The values at the two ends of the axis. Defaults to a round range that holds every value and interval.
     * On a log axis, the default is the powers of ten around them.
     */
    domain?: readonly [number, number]
    /**
     * About how many ticks to draw, or the values to mark. Defaults to about 5. On a log axis, the default is
     * the powers of ten in the domain, and every second or third one when there are more than 8.
     */
    ticks?: number | readonly number[]
    /** How to write a tick. On a log axis, the default is a short form: 1, 10, 100, 1k, 1M, and 0.01. */
    format?: (value: number) => string
    /**
     * `'log'` gives each power of ten the same room, for values that differ by more than about a hundred
     * times. Every value, interval end, domain end and tick must then be more than 0. Say on screen that the
     * axis is logarithmic, for example in `xLabel`. Defaults to linear.
     */
    scale?: 'linear' | 'log'
    /** A line under the axis that says what the value is and which way is better. */
    xLabel?: string
    /** Draw a faint vertical line at each tick. On by default. */
    grid?: boolean
    font?: TextOptions['font']
}

// The least room, in px, between two lines of the grid inside a power of ten.
const MINOR_GAP = 12
// A line inside a power of ten is this much of a line at a tick, so the ticks still lead the eye.
const MINOR_OPACITY = 0.6

/**
 * A power of ten from its exponent, or `times` that power. It reads a literal, which is exact. The language
 * does not promise an exact `10 ** -5`, and an end of the axis must be the same number in Node and in a browser.
 */
const ten = (power: number, times = 1): number => Number(`${times}e${power}`)

/** The exponent of the power of ten at or under a value. `Math.log10` rounds, so the result is checked. */
function powerUnder(value: number): number {
    let power = Math.floor(Math.log10(value))
    if (ten(power) > value) power--
    else if (ten(power + 1) <= value) power++
    return power
}

/** The exponent of the power of ten at or over a value. */
function powerOver(value: number): number {
    let power = Math.ceil(Math.log10(value))
    if (ten(power) < value) power++
    else if (ten(power - 1) >= value) power--
    return power
}

/** The ticks of a log axis: the powers of ten in the domain, or fewer of them when `count` is less. */
function logTicks(first: number, last: number, count?: number): number[] {
    const from = powerOver(first), to = powerUnder(last)
    const span = to - from
    if (span < 1) {
        // The domain holds one power of ten or none. Mark 1, 2 and 5 times each power. A domain that is
        // narrower still is close to a linear axis, so it gets the round values of one.
        const marks: number[] = []
        for (let power = powerUnder(first); power <= to; power++) {
            for (const times of [1, 2, 5]) {
                const value = ten(power, times)
                if (value >= first && value <= last) marks.push(value)
            }
        }
        return marks.length >= 2 ? marks : niceTicks(first, last, count ?? 5).ticks
    }
    const most = Math.max(2, Math.round(count ?? 8) || 2)
    const powers: number[] = []
    if (span + 1 <= most) {
        for (let power = from; power <= to; power++) powers.push(power)
    } else {
        // There are too many powers to name each one. Name every second one, or every third, and so on,
        // until they are few enough. The last end keeps its tick. A tick one power before it would crowd
        // it, so that one is left out.
        const named = (step: number) => Math.floor((span - 2) / step) + 2
        let step = 2
        while (named(step) > most) step++
        // The next step is better when it ends on the last power and this one does not: every gap is the same.
        if (span % step !== 0 && span % (step + 1) === 0) step++
        for (let power = from; power <= to - 2; power += step) powers.push(power)
        powers.push(to)
    }
    return powers.map((power) => ten(power))
}

/** A number in a short form: 1, 10, 100, 1k, 10k, 1M, 1G, and 0.1, 0.01, 0.001 below one. */
function shortNumber(value: number): string {
    // Six digits remove the noise of a sum such as 0.1 + 0.2, and keep two near ticks apart.
    const round = (number: number) => Number(number.toPrecision(6))
    const size = Math.abs(round(value))
    if (size >= 1e15 || (size > 0 && size < 0.001)) return round(value).toExponential().replace('e+', 'e')
    for (const [unit, amount] of [['T', 1e12], ['G', 1e9], ['M', 1e6], ['k', 1e3]] as const) {
        if (size >= amount) return `${round(value / amount)}${unit}`
    }
    return String(round(value))
}

/**
 * One row per item: its label, a dot at its value on a shared axis, and a line for its interval. It shows
 * many scores with their uncertainty in less room than bars, and its axis does not have to start at zero.
 * The rows keep the order of the data, so sort the data to rank it. `enter()` brings the rows in one by one.
 * `scale: 'log'` gives each power of ten the same room, for values that differ by many powers of ten.
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
    private readonly log: boolean

    constructor(data: readonly DotDatum[], options: DotChartOptions = {}) {
        super()
        if (data.length === 0) throw new Error('dotChart: give it at least one item')
        if (options.scale !== undefined && options.scale !== 'linear' && options.scale !== 'log') throw new Error(`dotChart: scale is 'linear' or 'log', not ${JSON.stringify(options.scale)}`)
        const log = this.log = options.scale === 'log'
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
            if (log) {
                for (const [part, number] of [['value', item.value], ['low end', item.low], ['high end', item.high]] as const) {
                    if (number !== undefined && number <= 0) throw new Error(`dotChart: the ${part} of ${name} is ${number}. A log axis has no zero. Give numbers of more than 0, or use a linear scale`)
                }
            }
            if ((item.low === undefined) !== (item.high === undefined)) throw new Error(`dotChart: ${name} has one end of an interval. Give low and high, or none`)
            if (item.low !== undefined && !(item.low <= item.value && item.value <= item.high!)) throw new Error(`dotChart: the value of ${name} is outside its interval`)
        })

        const numbers = data.flatMap((item) => [item.value, item.low ?? item.value, item.high ?? item.value])
        const least = Math.min(...numbers), most = Math.max(...numbers)
        const about = typeof options.ticks === 'number' ? options.ticks : 5
        if (log && typeof options.ticks === 'object') {
            // This check is before the domain, because the domain may take an end from a tick.
            const wrong = options.ticks.find((tick) => tick <= 0)
            if (wrong !== undefined) throw new Error(`dotChart: the tick ${wrong} is not on a log axis. A log axis has no zero. Give ticks of more than 0`)
        }
        let domain = options.domain
        if (!domain && typeof options.ticks === 'object') {
            // With given ticks and no domain, the axis runs from the first tick to the last, and holds the data.
            domain = [Math.min(least, ...options.ticks), Math.max(most, ...options.ticks)]
        }
        if (!domain && log) {
            // A whole step of a log axis is a power of ten: round the range of the data out to the powers around it.
            const from = powerUnder(least), to = powerOver(most)
            domain = [ten(from), ten(to > from ? to : from + 1)]
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
        if (log && first <= 0) throw new Error(`dotChart: the domain starts at ${first}. A log axis has no zero. Give two ends of more than 0`)
        const outside = numbers.find((value) => value < first || value > last)
        if (outside !== undefined) throw new Error(`dotChart: ${outside} is outside the domain ${first} to ${last}`)
        this.domain = domain
        const slack = (last - first) * 1e-9
        // On a log axis, the same small slack is a share of the length of the axis, not of the values.
        const inside = log
            ? (value: number) => Math.abs(this.along(value) - 0.5) <= 0.5 + 1e-9
            : (value: number) => value >= first - slack && value <= last + slack
        let ticks: readonly number[]
        if (typeof options.ticks === 'object') {
            ticks = options.ticks
            const stray = ticks.find((tick) => !Number.isFinite(tick) || !inside(tick))
            if (stray !== undefined) throw new Error(`dotChart: the tick ${stray} is outside the domain ${first} to ${last}`)
        } else if (log) {
            ticks = logTicks(first, last, typeof options.ticks === 'number' ? options.ticks : undefined).filter(inside)
        } else {
            ticks = niceTicks(first, last, about).ticks.filter(inside)
        }
        // Write every tick with the decimals that the finest one needs, so 0.25 does not read as 0.3.
        const decimals = (value: number) => [0, 1, 2, 3].find((digits) => Math.abs(value * 10 ** digits - Math.round(value * 10 ** digits)) < 1e-9) ?? 4
        const digits = Math.max(0, ...ticks.map(decimals))
        // The ticks of a log axis are powers of ten, which read best in a short form: 10k, not 10,000.
        const format = options.format ?? (log ? shortNumber : ((value: number) => (digits > 0 ? value.toFixed(digits) : formatNumber(value))))

        const left = -this.w / 2, right = this.w / 2, top = -this.h / 2, bottom = this.h / 2
        const axisColor = options.color ?? 'faint'
        const grid = options.grid ?? true
        this.axis = new Node()
        // On a log axis of few powers of ten, fainter lines at 2 to 9 times each power show that the room
        // for a step gets smaller toward the next power. The two closest lines are at 9 and 10 times a power.
        // With less than 12 px between them, or with more than 3 powers, the lines would read as a grey band.
        const powers = log ? Math.log10(last) - Math.log10(first) : 0
        if (log && grid && powers <= 3 + 1e-9 && (this.w / powers) * Math.log10(10 / 9) >= MINOR_GAP) {
            const taken = ticks.map((tick) => this.p(tick, 0)[0])
            for (let power = powerUnder(first); ten(power) < last; power++) {
                for (let times = 2; times <= 9; times++) {
                    const value = ten(power, times)
                    if (!inside(value)) continue
                    const [x] = this.p(value, 0)
                    // A tick draws its own line at this place.
                    if (taken.some((at) => Math.abs(at - x) < 0.5)) continue
                    this.axis.add(line([x, top], [x, bottom], { stroke: 'grid', width: 1.5 }).opacity(MINOR_OPACITY))
                }
            }
        }
        for (const tick of ticks) {
            const [x] = this.p(tick, 0)
            if (grid) this.axis.add(line([x, top], [x, bottom], { stroke: 'grid', width: 1.5 }))
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

    /**
     * The place of a value in a row, in the coordinates of the chart. Row 0 is the first item. On a log axis,
     * the value must be more than 0.
     */
    p(value: number, row: number): [number, number] {
        return [
            -this.w / 2 + this.along(value) * this.w,
            -this.h / 2 + ((row + 0.5) / this.count) * this.h,
        ]
    }

    /** How far along the axis a value is: 0 at the first end of the domain, and 1 at the last. */
    private along(value: number): number {
        const [first, last] = this.domain
        if (!this.log) return (value - first) / (last - first)
        if (!(value > 0)) throw new Error(`dotChart: ${value} has no place on a log axis. A log axis has no zero. Give a value of more than 0`)
        return (Math.log10(value) - Math.log10(first)) / (Math.log10(last) - Math.log10(first))
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
