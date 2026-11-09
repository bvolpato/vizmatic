import { Node, ownLabels } from '../node'
import { toPaint, type ColorInput } from '../color'
import { dot, rect } from '../shapes'
import { text, type TextOptions } from '../text'
import { clock } from '../track'
import type { Anim, AnimOptions } from '../anim'
import { reveal, sampleAt, seededRandom, staggered, stepAt } from './util'

export interface UnitGroup {
    /** How many marks the group has. A whole number, 0 or more. */
    count: number
    /** Defaults to dim. */
    color?: ColorInput
    /** Text over the block of the group. It shows only while the groups are split. */
    label?: string
}

export interface UnitArrangement {
    /** Marks in one column. The chart fills column by column, so the width of a group shows its size. */
    rows?: number
    /** Marks in one row. The chart fills row by row. Give `rows` or `columns`, not both. */
    columns?: number
    /** Draw each group as its own block, with its label over it. Without it, the groups follow each other in one grid. */
    split?: boolean
    /** Put the marks of all groups at mixed places in one grid, to show a few among many. */
    mixed?: boolean
    /** A whole number. The same seed gives the same mixed places. Defaults to 1. */
    seed?: number
}

export interface UnitChartOptions extends UnitArrangement {
    /** Side or diameter of one mark. Defaults to 16. */
    cell?: number
    /** Room between two marks. Defaults to 0.6 of `cell`. */
    gap?: number
    /** Room between two blocks while the groups are split. Defaults to 2.5 marks with their gaps. */
    blockGap?: number
    /** Defaults to dot. */
    shape?: 'dot' | 'square'
    /** Start with every mark and label in `plainColor`. `chart.paint()` then gives each group its color. */
    plain?: boolean
    /** The color before `paint()`, for a chart that starts `plain`. Defaults to dim. */
    plainColor?: ColorInput
    /** Text size of the labels. Defaults to 28. */
    labelSize?: number
    font?: TextOptions['font']
}

type Place = [number, number]

interface Placed {
    places: Place[]
    /** The line of each mark: its column or its row, counted across the blocks. `enter()` reveals line by line. */
    lines: number[]
    /** Where the label of each group goes, or null when it does not show. */
    labels: (Place | null)[]
    /** The line at which the block of each group starts. */
    labelLines: number[]
}

type Arrangement = Required<Pick<UnitArrangement, 'split' | 'mixed' | 'seed'>> & Pick<UnitArrangement, 'rows' | 'columns'>

const LIMIT = 20000
// A move gives each mark this share of its time, at every count. The rest is the delay between marks.
const TRAVEL = 1 / 2.3

/**
 * One mark for each unit: a count that the viewer can see, not only read. Groups share one grid, or stand as
 * blocks side by side, or sit at mixed places to show a few among many. `enter()` brings the marks in line by
 * line, `paint()` gives the groups their colors, and `rearrange()` moves the marks to another arrangement.
 * `.at()` places the middle of the grid, or of the row of blocks. The labels are over the blocks.
 */
export class UnitChart extends Node {
    /** Every mark, group after group. */
    readonly marks: Node[] = []
    /**
     * The label of each group, or null for a group that has none. A label is part of the chart from the
     * first time that the groups are split. Before that it is not drawn, and not a child of the chart.
     */
    readonly labels: (Node | null)[] = []
    /** The number of marks. */
    readonly total: number
    private readonly counts: number[]
    /** The index in `marks` of the first mark of each group. */
    private readonly starts: number[]
    private readonly colors: ColorInput[]
    private readonly pitch: number
    private readonly side: number
    private readonly blockGap: number
    private readonly labelSize: number
    private readonly labelWidths: number[]
    private arrangement: Arrangement
    private placed: Placed

    constructor(groups: readonly UnitGroup[], options: UnitChartOptions = {}) {
        super()
        if (groups.length === 0) throw new Error('unitChart: give it at least one group')
        groups.forEach((group, index) => {
            if (!Number.isInteger(group.count) || group.count < 0) throw new Error(`unitChart: the count of group ${index} is ${group.count}. A count is a whole number, 0 or more`)
        })
        this.counts = groups.map((group) => group.count)
        let before = 0
        this.starts = this.counts.map((count) => (before += count) - count)
        this.total = before
        if (this.total === 0) throw new Error('unitChart: give it at least one mark')
        if (this.total > LIMIT) throw new Error(`unitChart: ${this.total} marks are more than a frame can show. Let one mark stand for more than one unit, and say so in a label`)
        this.side = options.cell ?? 16
        if (!(Number.isFinite(this.side) && this.side > 0)) throw new Error('unitChart: cell is the side of one mark, more than 0')
        const gap = options.gap ?? Math.round(this.side * 0.6)
        if (!(Number.isFinite(gap) && gap >= 0)) throw new Error('unitChart: gap is the room between two marks, 0 or more')
        this.pitch = this.side + gap
        this.blockGap = options.blockGap ?? this.pitch * 2.5
        if (!(Number.isFinite(this.blockGap) && this.blockGap >= 0)) throw new Error('unitChart: blockGap is the room between two blocks, 0 or more')
        this.labelSize = options.labelSize ?? 28
        if (!(Number.isFinite(this.labelSize) && this.labelSize > 0)) throw new Error('unitChart: labelSize is a text size, more than 0')
        this.colors = groups.map((group) => group.color ?? 'dim')
        this.arrangement = this.checked({ split: false, mixed: false, seed: 1 }, options)

        const plain = options.plainColor ?? 'dim'
        groups.forEach((group, index) => {
            const color = options.plain ? plain : this.colors[index]!
            for (let k = 0; k < group.count; k++) {
                const mark = options.shape === 'square'
                    ? rect(this.side, this.side, { radius: this.side * 0.18, fill: color, stroke: null })
                    : dot(this.side / 2, color)
                this.marks.push(mark)
                this.add(mark)
            }
            this.labels.push(group.label ? text(group.label, { size: this.labelSize, font: options.font, color }) : null)
        })
        this.labelWidths = this.labels.map((label) => (label ? label.bounds().width : 0))

        this.placed = this.place(this.arrangement)
        this.marks.forEach((mark, index) => mark.at(this.placed.places[index]!))
        // A label that does not show stays out of the chart. As a hidden child, an animation that shows the
        // children of the chart one by one would show it too.
        this.labels.forEach((label, index) => {
            const at = this.placed.labels[index]
            if (label && at) this.add(label.at(at))
        })
        // A label of a group that is empty or joined is not in the chart yet.
        ownLabels(this, { name: 'unit chart', labels: this.labels })
    }

    /** The marks of each group, in the order of the groups. */
    get groups(): Node[][] {
        return this.counts.map((count, index) => this.marks.slice(this.starts[index]!, this.starts[index]! + count))
    }

    /** The place of a mark in the chart, by its index in `marks`, in the arrangement that the chart has now. */
    p(index: number): [number, number] {
        const place = this.placed.places[index]
        if (!place) throw new Error(`unitChart: no mark ${index}. The chart has ${this.total} marks`)
        return [place[0], place[1]]
    }

    /** A copy with its own marks and labels, in the arrangement that the chart has now. */
    override clone(): this {
        const copy = super.clone()
        this.labels.forEach((label, index) => {
            if (label && label.parent !== this) copy.labels[index] = label.clone()
        })
        return copy
    }

    /** The marks arrive line by line, in the order that the chart fills. The label of a block arrives with its first line. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'unitChart.enter', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { lines, labelLines } = this.placed
                const count = Math.max(...lines) + 1
                const windows = staggered(count, Math.max(0, options.lag ?? 0.25), ctx.t0, ctx.t1)
                this.marks.forEach((mark, index) => {
                    const [start, end] = windows[lines[index]!]!
                    stepAt(mark, 'opacity', 0, ctx.t0)
                    mark.tween('opacity', 1, start, end, ctx.ease)
                })
                this.labels.forEach((label, index) => {
                    if (!label || !this.placed.labels[index]) return
                    // The block of an empty group has no line of its own, so its label comes with the next block.
                    const start = windows[Math.min(labelLines[index]!, count - 1)]![0]
                    stepAt(label, 'opacity', 0, ctx.t0)
                    label.tween('opacity', 1, start, Math.min(ctx.t1, start + (ctx.t1 - ctx.t0) * 0.4), ctx.ease)
                })
            },
        }
    }

    /** Each mark and each label takes the color of its group. Use it on a chart that starts `plain`. */
    paint(options: AnimOptions = {}): Anim {
        return {
            label: 'unitChart.paint', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                this.counts.forEach((count, index) => {
                    const paint = toPaint(this.colors[index]!)
                    for (let k = 0; k < count; k++) this.marks[this.starts[index]! + k]!.tween('fill', paint, ctx.t0, ctx.t1, ctx.ease)
                    for (const part of this.labels[index]?.all() ?? []) {
                        if (part.get('fill')) part.tween('fill', paint, ctx.t0, ctx.t1, ctx.ease)
                    }
                })
            },
        }
    }

    /**
     * The marks move to another arrangement, such as `{ split: true }` to gather mixed marks into blocks. The
     * new arrangement keeps the rows or columns and the seed that it does not name. `split` and `mixed` turn
     * each other off, and `rows` replaces `columns`. Labels leave before the move and arrive after it. Each
     * group moves over the whole time, so a small group does not wait for a large one.
     */
    rearrange(to: UnitArrangement, options: AnimOptions = {}): Anim {
        // Find a wrong arrangement now, where the film names it. Merge again when the move is scheduled, so
        // that a second move in the same sequence starts from the first.
        this.merged(to)
        return {
            label: 'unitChart.rearrange', duration: options.duration ?? 1.4, ease: options.ease,
            schedule: (ctx) => {
                const next = this.merged(to)
                const placed = this.place(next)
                const before = this.placed
                this.arrangement = next
                this.placed = placed
                const same = (a: Place | null, b: Place | null) => (a === null || b === null ? a === b : a[0] === b[0] && a[1] === b[1])
                if (placed.places.every((place, index) => same(place, before.places[index]!)) && placed.labels.every((at, index) => same(at, before.labels[index]!))) return

                const span = ctx.t1 - ctx.t0
                const shown = this.labels.map((label) => !!label && label.parent === this && sampleAt(label, 'visible', ctx.t0))
                // With no label to take away or to bring, the marks have the whole time.
                const leave = shown.some(Boolean) ? ctx.t0 + span * 0.2 : ctx.t0
                const arrive = placed.labels.some((at, index) => at && this.labels[index]) ? ctx.t1 - span * 0.25 : ctx.t1
                this.labels.forEach((label, index) => {
                    if (!label) return
                    const was = shown[index]!, at = placed.labels[index]
                    if (was) {
                        label.tween('opacity', 0, ctx.t0, leave, ctx.ease)
                        if (!at) label.track('visible').step(leave, false)
                    }
                    if (!at) return
                    if (label.parent !== this) {
                        clock.now = ctx.t0
                        this.add(label)
                    }
                    // A label changes place only while nobody sees it.
                    const moved = was ? leave : ctx.t0
                    stepAt(label, 'x', at[0], moved)
                    stepAt(label, 'y', at[1], moved)
                    if (!was) {
                        stepAt(label, 'opacity', 0, ctx.t0)
                        label.track('visible').step(ctx.t0, true)
                    }
                    label.tween('opacity', 1, arrive, ctx.t1, ctx.ease)
                })
                this.counts.forEach((count, group) => {
                    const lag = options.lag ?? (count > 1 ? (1 / TRAVEL - 1) / (count - 1) : 0)
                    const windows = staggered(count, Math.max(0, lag), leave, arrive)
                    for (let k = 0; k < count; k++) {
                        const index = this.starts[group]! + k
                        const [x, y] = placed.places[index]!
                        if (same(placed.places[index]!, before.places[index]!)) continue
                        const [start, end] = windows[k]!
                        this.marks[index]!.tween('x', x, start, end, ctx.ease)
                        this.marks[index]!.tween('y', y, start, end, ctx.ease)
                    }
                })
            },
        }
    }

    /** The arrangement that the chart has now, with a change. A new `rows` replaces `columns`, and the reverse. */
    private merged(change: UnitArrangement): Arrangement {
        const base = { ...this.arrangement }
        if (change.rows !== undefined) delete base.columns
        if (change.columns !== undefined) delete base.rows
        return this.checked(base, change)
    }

    private checked(base: Arrangement, change: UnitArrangement): Arrangement {
        const next = { ...base }
        if (change.rows !== undefined) next.rows = change.rows
        if (change.columns !== undefined) next.columns = change.columns
        if (change.split !== undefined) next.split = change.split
        if (change.mixed !== undefined) next.mixed = change.mixed
        if (change.seed !== undefined) next.seed = change.seed
        // The two exclude each other, so naming one turns the other off: `{ split: true }` gathers mixed marks.
        if (change.split === true && change.mixed === undefined) next.mixed = false
        if (change.mixed === true && change.split === undefined) next.split = false
        if (next.rows !== undefined && next.columns !== undefined) throw new Error('unitChart: give rows or columns, not both')
        for (const [name, value] of [['rows', next.rows], ['columns', next.columns]] as const) {
            if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new Error(`unitChart: ${name} is a whole number, 1 or more`)
        }
        if (!Number.isInteger(next.seed)) throw new Error('unitChart: seed is a whole number')
        if (next.split && next.mixed) throw new Error('unitChart: split puts each group in its own block, and mixed puts all groups in one grid. Use one of them')
        return next
    }

    /** The cells of a grid of `count` marks, in fill order, with the top left cell at 0, 0. */
    private cells(count: number, arrangement: Arrangement): { cells: [number, number][]; columns: number; rows: number; byColumn: boolean } {
        const byColumn = arrangement.columns === undefined
        // Without rows or columns, the grid is about three times as wide as it is tall.
        const rows = arrangement.rows ?? Math.max(1, Math.round(Math.sqrt(this.total / 3)))
        const cells: [number, number][] = []
        if (byColumn) {
            for (let k = 0; k < count; k++) cells.push([Math.floor(k / rows), k % rows])
            return { cells, columns: Math.ceil(count / rows), rows: Math.min(rows, count), byColumn }
        }
        const columns = arrangement.columns!
        for (let k = 0; k < count; k++) cells.push([k % columns, Math.floor(k / columns)])
        return { cells, columns: Math.min(columns, count), rows: Math.ceil(count / columns), byColumn }
    }

    private place(arrangement: Arrangement): Placed {
        const pitch = this.pitch
        // The room that a number of cells takes. Edges of marks land on whole pixels, so squares stay sharp.
        const extent = (cells: number) => (cells > 0 ? (cells - 1) * pitch + this.side : 0)
        const first = (cells: number, middle = 0) => Math.round(middle - extent(cells) / 2) + this.side / 2
        const places: Place[] = [], lines: number[] = []
        if (!arrangement.split) {
            const grid = this.cells(this.total, arrangement)
            const order = grid.cells.map((_, index) => index)
            if (arrangement.mixed) {
                const random = seededRandom(arrangement.seed)
                for (let k = order.length - 1; k > 0; k--) {
                    const j = Math.floor(random() * (k + 1))
                    ;[order[k], order[j]] = [order[j]!, order[k]!]
                }
            }
            const left = first(grid.columns), top = first(grid.rows)
            for (let index = 0; index < this.total; index++) {
                const [column, row] = grid.cells[order[index]!]!
                places.push([left + column * pitch, top + row * pitch])
                lines.push(grid.byColumn ? column : row)
            }
            return { places, lines, labels: this.labels.map(() => null), labelLines: this.labels.map(() => 0) }
        }
        const blocks = this.counts.map((count) => this.cells(count, arrangement))
        // A block is as wide as its marks or its label, so no two labels meet. An empty group keeps the room
        // of its label, such as "0 failed". With no label, it takes no room.
        const slots = blocks.map((block, index) => Math.max(extent(block.columns), this.labelWidths[index]!))
        const takes = this.counts.map((count, index) => count > 0 || this.labels[index] !== null)
        const width = slots.reduce((sum, slot, index) => sum + (takes[index] ? slot : 0), 0) + Math.max(0, takes.filter(Boolean).length - 1) * this.blockGap
        const height = extent(Math.max(...blocks.map((block) => block.rows)))
        const top = first(Math.max(...blocks.map((block) => block.rows)))
        const labels: (Place | null)[] = [], labelLines: number[] = []
        let left = -width / 2, line = 0
        blocks.forEach((block, index) => {
            labelLines.push(line)
            if (!takes[index]) {
                labels.push(null)
                return
            }
            const middle = left + slots[index]! / 2
            const start = first(block.columns, middle)
            for (const [column, row] of block.cells) {
                places.push([start + column * pitch, top + row * pitch])
                lines.push(line + (block.byColumn ? column : row))
            }
            labels.push(this.labels[index] ? [middle, -height / 2 - this.labelSize * 1.05] : null)
            line += block.byColumn ? block.columns : block.rows
            left += slots[index]! + this.blockGap
        })
        return { places, lines, labels, labelLines }
    }
}

/** One mark for each unit, in groups: `unitChart([{ count: 262 }, { count: 39, color: 'green', label: '39 better' }], { rows: 11, split: true })`. */
export function unitChart(groups: readonly UnitGroup[], options: UnitChartOptions = {}): UnitChart {
    return new UnitChart(groups, options)
}
