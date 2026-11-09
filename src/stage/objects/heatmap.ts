import { Node, ownLabels } from '../node'
import { linePath, pathBounds, polyPath, rectPath, unionBounds, type Bounds, type Path, type Ring } from '../geometry'
import { brace } from '../shapes'
import { text, type TextOptions } from '../text'
import { sampleStops, toPaint, type ColorInput, type Paint, type Rgba } from '../color'
import type { Ease } from '../ease'
import type { Anim, AnimOptions } from '../anim'
import { Box } from '../layout'
import { lerpSame, luminance, reveal, sampleAt, solidColor, staggered, stepAt } from './util'

/** The sign that a state draws over its cell: an empty outline, a cross, diagonal lines, or an outline of dashes. */
export type CellMark = 'none' | 'cross' | 'hatch' | 'dash'

export interface CellState {
    /** The sign over the cell. It is the second sign of the state beside its color, and the cell hides its number under it. */
    mark: CellMark
    /** The color of the sign. Defaults to faint. */
    color?: ColorInput
}

/** The states of a cell that holds no value to read. A cell with its value is in the state `open`, which every grid has. */
export const CELL_STATES = {
    /** A value that is not there yet, such as a result before its sum: an empty outline. */
    empty: { mark: 'none' },
    /** A cell that a mask takes out, such as a label that the loss ignores: a cross. */
    masked: { mark: 'cross', color: 'dim' },
    /** A position that comes later, which a causal mask hides: diagonal lines. */
    future: { mark: 'hatch' },
    /** A padding position, which holds no token: an outline of dashes. */
    padding: { mark: 'dash', color: 'dim' },
} satisfies Record<string, CellState>

/** A part of a grid: a row, a column, one cell, a block, or a patch. Rows and columns count from 0. */
export interface GridSlice {
    /** One row, or the first and the last row of a block. Without it, every row. */
    row?: number | readonly [number, number]
    /** One column, or the first and the last column of a block. Without it, every column. */
    col?: number | readonly [number, number]
    /** One patch of a grid that `cut()` cut, counted row by row from 0. */
    patch?: number
}

/** The cells that a change is for: a slice, or a function that picks cells by their row, column, value and state. */
export type GridCells = GridSlice | ((row: number, col: number, value: number, state: string) => boolean)

export interface HeatmapOptions {
    /** Cell edge in stage pixels. */
    cell?: number
    cellWidth?: number
    cellHeight?: number
    gap?: number
    colors?: readonly ColorInput[]
    /** Value range for the color ramp. */
    domain?: readonly [number, number]
    /** Print values in cells. `'lit'` prints the numbers of the lit slice only: see `light()`. */
    values?: boolean | 'lit'
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
    /**
     * The text size of the names, the numbers and the shape. With it, a cell is made wide enough for its
     * number, and a text that does not fit is an error. Defaults to 28 when the grid has `width` or an option
     * of a tensor (`axes`, `name`, `depth`, `states`, `initial`, `shown`, or `values: 'lit'`).
     */
    size?: number
    /** The width of all columns together, so the layout can size the grid: `fitted(region, (width) => heatmap(rows, { width }))`. It sets the cell. */
    width?: number
    /**
     * The names of the axes, the outer one first: `['seq', 'd']`, or `['batch', 'seq', 'd']` with `depth`. The
     * grid then draws a brace with the name and the size of each axis, and its shape under them, such as `[2, 3, 4]`.
     */
    axes?: readonly string[]
    /** The name of the tensor. The grid writes it before the shape, under the cells: `x [3, 4]`. */
    name?: string
    /** The size of a third axis, such as a batch. The grid draws sheets behind the cells, four at most. */
    depth?: number
    /** The states that a cell can have beside `open`, and their signs. Defaults to CELL_STATES. */
    states?: Record<string, CellState>
    /** The state of each cell at the start: one name, or a function of the row and the column. Defaults to `open`. */
    initial?: string | ((row: number, col: number) => string)
    /** How many rows and columns show at the start. The rest have their room and wait for `grow()`. Defaults to all. */
    shown?: { rows?: number; columns?: number }
}

/** The options that make a grid a tensor grid, with text of one size that a viewer can read. */
const SIZED = ['size', 'width', 'axes', 'name', 'depth', 'states', 'initial', 'shown'] as const
/** The text size of a grid that has one of the options of `SIZED` and no `size`. */
const TEXT_SIZE = 28
/** The most sheets that a grid draws for its third axis. The label gives the true size. */
const SHEETS = 4
/** Two times that are nearer than this are one time. */
const SOON = 1e-6
/** The fill of a cell under the sign of its state, as an opacity of the surface color. */
const COVER: Record<CellMark, number> = { none: 0.4, cross: 0.4, hatch: 0.4, dash: 0 }

/** A block of cells by its first and last row and column, or one patch. */
interface Span {
    r0: number
    r1: number
    c0: number
    c1: number
    patch: number | null
    /** True when the film named the rows, or the columns. A slice with no rows takes the rows that show. */
    rows: boolean
    cols: boolean
}

interface Look {
    mark: CellMark
    paint: Paint
}

interface Patches {
    rows: number
    cols: number
    gap: number
    unrolled: boolean
}

interface AxisPart {
    name: string
    kind: 'rows' | 'cols' | 'depth'
    /** The brace, or the short line of the third axis. */
    mark: Node
    /** The name and the size. `grow()` replaces the node. */
    label: Node
    group: Node
}

interface Placed {
    path: Path
    label: string
    at: [number, number]
}

interface Furniture {
    slabs: Path[]
    rows: Placed | null
    cols: Placed | null
    depth: Placed | null
    caption: { label: string; at: [number, number] } | null
}

/** The time of each item of a change. With no lag, each one has the whole time, with its exact ends. */
const spread = (count: number, lag: number, t0: number, t1: number): [number, number][] => (lag > 0 ? staggered(count, lag, t0, t1) : Array.from({ length: count }, () => [t0, t1] as [number, number]))

const shown = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : typeof value === 'function' ? 'a function' : Array.isArray(value) ? `[${value.join(', ')}]` : String(value))
const seconds = (time: number): string => `${Math.round(time * 1000) / 1000} s`

/** Diagonal lines over a box around the origin. The sums of x and y are multiples of the step, so the lines of two cells are parts of one pattern. */
function hatchPath(w: number, h: number, step: number): Path {
    const rings: Ring[] = []
    for (let sum = -Math.floor((w + h) / 2 / step) * step; sum < (w + h) / 2; sum += step) {
        const from = Math.max(-w / 2, sum - h / 2), to = Math.min(w / 2, sum + h / 2)
        if (to - from > 1) rings.push(...linePath([from, sum - from], [to, sum - to]))
    }
    return rings
}

/**
 * The outline of a box around the origin, in dashes. Each side has a whole number of dashes around its middle,
 * so the four sides look the same and the dashes of two neighbors are in line. The corners are open.
 */
function dashedBox(w: number, h: number, about: number): Path {
    const rings: Ring[] = []
    const side = (from: [number, number], to: [number, number]) => {
        const length = Math.hypot(to[0] - from[0], to[1] - from[1])
        const count = Math.max(2, Math.round(length / about)), period = length / count, dash = period * 0.6
        for (let k = 0; k < count; k++) {
            const a = (k * period + (period - dash) / 2) / length, b = a + dash / length
            rings.push(...linePath([from[0] + (to[0] - from[0]) * a, from[1] + (to[1] - from[1]) * a], [from[0] + (to[0] - from[0]) * b, from[1] + (to[1] - from[1]) * b]))
        }
    }
    side([-w / 2, -h / 2], [w / 2, -h / 2])
    side([w / 2, -h / 2], [w / 2, h / 2])
    side([w / 2, h / 2], [-w / 2, h / 2])
    side([-w / 2, h / 2], [-w / 2, -h / 2])
    return rings
}

/**
 * A grid of cells, each with a number and a shade for it: a chart of values, a matrix, a tensor, an image, or
 * the weights of attention. `light()` puts an outline on a row, a column or a block and moves it as a window,
 * `setValue()` changes numbers in place, `mark()` covers cells with the sign of a state, `grow()` shows more rows and
 * columns, and `cut()` cuts the grid into patches. `value()`, `stateOf()`, `count()` and `lit` read what the
 * grid holds after the changes that are scheduled so far. `.at()` places the middle of the cells: the names,
 * the braces and the shape are outside them.
 */
export class Heatmap extends Node {
    readonly cells: Node[][] = []
    readonly rowLabels: Node[] = []
    readonly columnLabels: Node[] = []
    /** The number that each cell shows now. `setValue()` and `update()` replace the node. A grid that prints no numbers has empty rows. */
    readonly numbers: Node[][] = []
    readonly rowCount: number
    readonly colCount: number
    /** The sheets behind the cells, for a third axis. The nearest one is the last. */
    readonly slabs: Node[] = []
    /** The outline of the lit slice. Null before the first `light()`. */
    frame: Node | null = null
    /** The shape under the cells, such as `x [2, 3, 4]`, or null. `grow()` replaces the node. */
    caption: Node | null = null
    private readonly stops: readonly (readonly [number, Rgba])[]
    private readonly domain: readonly [number, number]
    /** True when the film gave the range of the colors. Then a value outside it takes the color of the nearest end. */
    private readonly fixedDomain: boolean
    /** True for a grid with text of one size that a viewer can read. False for a grid as `heatmap` drew it before it had `size`. */
    private readonly sized: boolean
    private readonly w: number
    private readonly h: number
    private readonly gap: number
    /** The left edge of the first column and the top edge of the first row, in a grid that is whole. */
    private readonly x0: number
    private readonly y0: number
    private readonly corner: number
    /** The text size of the names of the axes and of the shape. */
    private readonly size: number
    private readonly valueSize: number
    private readonly format: (value: number) => string
    private readonly printed: boolean | 'lit'
    private readonly font: TextOptions['font']
    private readonly depth: number | null
    private readonly tensor: string | null
    private readonly looks = new Map<string, Look>()
    private readonly axisParts: AxisPart[] = []
    /** The name of each axis, or null for an axis that the film did not name. */
    private readonly axisNames: { rows: string | null; cols: string | null; depth: string | null }
    /** The value of each cell, after the changes that are scheduled so far. */
    private held: number[][]
    private states: string[][]
    /** The sign of each state that a cell had, by the name of the state. */
    private overlays: Map<string, Node>[][]
    /** Every number that a cell had. A light on the cell keeps each of them bright. */
    private history: Node[][][]
    /** The time at which the last change of the number of each cell is over. */
    private busy: number[][]
    private rowsShown: number
    private colsShown: number
    private litNow: Span | null = null
    private patches: Patches | null = null

    constructor(values: readonly (readonly number[])[], options: HeatmapOptions = {}) {
        super()
        this.rowCount = values.length
        this.colCount = Math.max(0, ...values.map((row) => row.length))
        const sized = this.sized = SIZED.some((name) => options[name] !== undefined) || options.values === 'lit'
        if (sized) this.checkInput(values, options)
        const size = this.size = sized ? options.size ?? TEXT_SIZE : options.labelSize ?? 16
        const gap = this.gap = options.gap ?? (sized ? Math.max(2, Math.round(size * 0.12)) : 2)
        const format = this.format = options.format ?? ((v: number) => (Math.round(v * 100) / 100).toString())
        this.printed = options.values ?? false
        this.font = options.font
        this.depth = options.depth ?? null
        this.tensor = options.name ?? null
        const axes = options.axes ?? []
        this.axisNames = { depth: axes.length === 3 ? axes[0]! : null, rows: axes[axes.length - 2] ?? null, cols: axes[axes.length - 1] ?? null }
        this.rowsShown = options.shown?.rows ?? this.rowCount
        this.colsShown = options.shown?.columns ?? this.colCount

        let w = options.cellWidth ?? options.cell ?? 44
        let h = options.cellHeight ?? options.cell ?? 44
        let valueSize = options.valueSize ?? Math.min(h * 0.38, w * 0.36)
        if (sized) {
            valueSize = options.valueSize ?? size
            // The widest number sets the width of a cell. A cell that the grid sizes has 0.45 of the text size at
            // each side of that number, and a cell that the film sizes needs 0.25 at the least.
            const widest = this.printed ? Math.max(...values.flat().map((value) => this.inkWidth(format(value), valueSize))) : 0
            const need = this.printed ? Math.ceil(widest + valueSize * 0.5) : 0
            // A grid often starts with short numbers, such as 0 and 1, and gets a share such as 0.25 later. So a
            // cell that the grid sizes holds a number of four characters at the least.
            const roomy = this.printed ? Math.ceil(Math.max(widest, this.inkWidth('0.00', valueSize)) + valueSize * 0.9) : 0
            if (options.width !== undefined) {
                w = (options.width - (this.colCount - 1) * gap) / this.colCount
                // A cell with no number still needs a few pixels to be a cell.
                const least = Math.max(need, 4)
                if (w < least) throw new Error(`heatmap: a width of ${Math.round(options.width * 10) / 10} gives each of the ${this.colCount} columns ${Math.max(0, Math.floor(w))} px${this.printed ? `, and the widest number needs ${need}` : ''}. Give a width of ${least * this.colCount + (this.colCount - 1) * gap} or more${this.printed ? ', a smaller size, or a format with fewer digits' : ', or a smaller gap'}`)
            } else {
                w = options.cellWidth ?? options.cell ?? Math.max(Math.round(size * 2.6), roomy)
                if (w < need) throw new Error(`heatmap: a cell is ${w} px wide, and the widest number needs ${need} at size ${valueSize}. Give a cell of ${need} or more, a smaller size, or a format with fewer digits`)
            }
            h = options.cellHeight ?? options.cell ?? w
            // A lower cell has no room over and under a number of this size.
            const least = Math.ceil(valueSize * 1.5)
            if (this.printed && h < least) throw new Error(`heatmap: a cell is ${Math.floor(h)} px high, and a number of size ${valueSize} needs ${least}. Give a cellHeight of ${least} or more, or a smaller size`)
        }
        this.w = w
        this.h = h
        this.valueSize = valueSize
        const flat = values.flat()
        this.fixedDomain = options.domain !== undefined
        this.domain = options.domain ?? [Math.min(...flat), Math.max(...flat)]
        const palette = (options.colors ?? ['surface', 'blue', 'yellow']).map((c) => solidColor(c))
        this.stops = palette.map((c, i) => [palette.length === 1 ? 0 : i / (palette.length - 1), c] as const)
        const totalW = this.colCount * w + (this.colCount - 1) * gap
        const totalH = this.rowCount * h + (this.rowCount - 1) * gap
        // A grid with a size starts on a whole pixel, so the edges of whole cells are sharp.
        this.x0 = sized ? Math.round(-totalW / 2) : -totalW / 2
        this.y0 = sized ? Math.round(-totalH / 2) : -totalH / 2
        this.corner = options.radius ?? (sized ? Math.round(Math.min(size * 0.15, w / 4, h / 4)) : 0)
        const labelSize = options.labelSize ?? size

        const states = options.states ?? CELL_STATES
        for (const [name, state] of Object.entries(states)) this.looks.set(name, { mark: state.mark, paint: toPaint((state as CellState).color ?? 'faint') })
        const initial = options.initial ?? 'open'
        this.held = values.map((row) => [...row])
        this.states = values.map((row, i) => row.map((_, j) => (typeof initial === 'function' ? initial(i, j) : initial)))
        this.overlays = values.map((row) => row.map(() => new Map<string, Node>()))
        this.history = values.map((row) => row.map(() => []))
        this.busy = values.map((row) => row.map(() => -Infinity))
        this.states.forEach((row, i) => row.forEach((state, j) => {
            if (state !== 'open' && !this.looks.has(state)) throw new Error(`heatmap: initial gives cell (${i}, ${j}) the state ${shown(state)}. ${this.known()}`)
        }))

        // The sheets of the third axis are behind the cells, so they come first.
        const furniture = sized ? this.furnitureAt(this.rowsShown, this.colsShown) : null
        for (const path of furniture?.slabs ?? []) {
            const slab = new Node(path).stroke('dim', Math.max(1.5, size * 0.06))
            this.slabs.push(slab)
            this.add(slab)
        }

        values.forEach((row, i) => {
            const cells: Node[] = []
            const numbers: Node[] = []
            row.forEach((value, j) => {
                const cx = this.x0 + j * (w + gap) + w / 2
                const cy = this.y0 + i * (h + gap) + h / 2
                const color = this.colorFor(value)
                const cell = new Node(rectPath(-w / 2, -h / 2, w, h, this.corner)).fill(color).at(cx, cy)
                cells.push(cell)
                this.add(cell)
                const look = this.looks.get(this.states[i]![j]!)
                if (look) cell.fill('surface', COVER[look.mark])
                if (this.printed) {
                    const label = this.numberNode(value, cx, cy)
                    if (!this.showsNumber(i, j)) label.opacity(0)
                    numbers.push(label)
                    this.history[i]![j]!.push(label)
                    this.add(label)
                }
                if (look) this.add(this.signOf(i, j, this.states[i]![j]!).opacity(1))
            })
            this.cells.push(cells)
            this.numbers.push(numbers)
        })
        const labelGap = sized ? size * 0.6 : 10
        options.rowLabels?.forEach((name, i) => {
            const label = text(name, { size: labelSize, color: 'dim', font: options.font })
            const y = this.y0 + i * (h + gap) + h / 2
            label.at(this.x0 - labelGap - label.width / 2, y)
            this.rowLabels.push(label)
            this.add(label)
        })
        const angle = options.columnLabelAngle ?? 0
        options.columnLabels?.forEach((name, j) => {
            const label = text(name, { size: labelSize, color: 'dim', font: options.font })
            const x = this.x0 + j * (w + gap) + w / 2
            if (angle !== 0) {
                // Tilted labels end at their column, reading up and to the right.
                const length = label.width
                label.at(x + Math.cos(angle) * length / 2, this.y0 - (sized ? size * 0.7 : 12) + Math.sin(angle) * length / 2)
                label.set('rotation', angle)
            } else {
                if (sized && label.width > w + gap - labelSize * 0.3) throw new Error(`heatmap: the column label ${JSON.stringify(name)} is ${Math.ceil(label.width)} px wide at size ${labelSize}, and a column is ${Math.floor(w + gap)} px wide. Give a cell of ${Math.ceil(label.width + labelSize * 0.3 - gap)} or more, a shorter label, a smaller labelSize, or columnLabelAngle: -Math.PI / 4 to tilt the labels`)
                label.at(x, this.y0 - labelGap - labelSize / 2)
            }
            this.columnLabels.push(label)
            this.add(label)
        })
        // Two tilted labels are apart by the width of a column, seen across the lines of the text.
        if (sized && angle !== 0 && this.columnLabels.length > 1 && (w + gap) * Math.abs(Math.sin(angle)) < labelSize * 1.1) {
            throw new Error(`heatmap: the tilted column labels of size ${labelSize} meet, because a column is ${Math.floor(w + gap)} px wide. Give a cell of ${Math.ceil(labelSize * 1.1 / Math.abs(Math.sin(angle)) - gap)} or more, or a smaller labelSize`)
        }

        if (furniture) {
            const kinds = (axes.length === 3 ? ['depth', 'rows', 'cols'] : ['rows', 'cols']) as AxisPart['kind'][]
            axes.forEach((name, index) => {
                const kind = kinds[index]!, placed = furniture[kind]!
                // The line of the third axis is thin, and a brace is a filled shape.
                const mark = kind === 'depth' ? new Node(placed.path).stroke('dim', Math.max(1.5, size * 0.07)) : new Node(placed.path).fill('dim')
                mark.data['line'] = true
                const label = this.axisLabel(kind, placed)
                const group = new Node().add(mark, label)
                this.axisParts.push({ name, kind, mark, label, group })
                this.add(group)
            })
            if (furniture.caption) {
                this.caption = this.captionNode(furniture.caption)
                this.add(this.caption)
            }
            // The braces and the shape move out when the grid grows. An empty box keeps their last room from
            // the start, so the layout measures the grid as it will be.
            if (this.rowsShown < this.rowCount || this.colsShown < this.colCount) {
                const room = this.roomOf(this.furnitureAt(this.rowCount, this.colCount))
                if (room) this.add(new Node(rectPath(room.x, room.y, room.width, room.height)).hide())
            }
        }
        for (let i = 0; i < this.rowCount; i++) {
            for (let j = 0; j < this.colCount; j++) {
                if (i < this.rowsShown && j < this.colsShown) continue
                for (const part of this.partsOf(i, j)) part.hide()
            }
        }
        this.rowLabels.forEach((label, i) => { if (i >= this.rowsShown) label.hide() })
        this.columnLabels.forEach((label, j) => { if (j >= this.colsShown) label.hide() })
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

    /** The value of a cell, after the changes that are scheduled so far. */
    value(row: number, col: number): number {
        this.cell(row, col)
        return this.held[row]![col]!
    }

    /** The values of a slice, row by row, after the changes that are scheduled so far. Without a slice, the values of the rows and columns that show. */
    values(slice: GridSlice = {}): number[][] {
        const span = this.resolve(this.span(slice, 'values'), 'values')
        const out: number[][] = []
        for (let i = span.r0; i <= span.r1; i++) out.push(this.held[i]!.slice(span.c0, span.c1 + 1))
        return out
    }

    /** The state of a cell, after the changes that are scheduled so far. A cell that shows its value is `open`. */
    stateOf(row: number, col: number): string {
        this.cell(row, col)
        return this.states[row]![col]!
    }

    /** The number of cells in a state among the rows and columns that show, after the changes that are scheduled so far. */
    count(state: string): number {
        this.look(state)
        return this.find((_row, _col, _value, own) => own === state).length
    }

    /** The cells that a function picks among the rows and columns that show, as `[row, col]` pairs, row by row. */
    find(test: (row: number, col: number, value: number, state: string) => boolean): [number, number][] {
        if (typeof test !== 'function') throw new Error(`heatmap: find takes a function of the row, the column, the value and the state of a cell, and it got ${shown(test)}`)
        const out: [number, number][] = []
        for (let i = 0; i < this.rowsShown; i++) {
            for (let j = 0; j < this.colsShown; j++) if (test(i, j, this.held[i]![j]!, this.states[i]![j]!)) out.push([i, j])
        }
        return out
    }

    /** The slice that is lit after the changes that are scheduled so far, or null. */
    get lit(): GridSlice | null {
        const span = this.litNow
        if (!span) return null
        return span.patch !== null ? { patch: span.patch } : { row: [span.r0, span.r1], col: [span.c0, span.c1] }
    }

    /** The number of rows that show, after the changes that are scheduled so far. */
    get shownRows(): number {
        return this.rowsShown
    }

    /** The number of columns that show, after the changes that are scheduled so far. */
    get shownCols(): number {
        return this.colsShown
    }

    /** The shape of what shows: the rows and the columns, after the size of the third axis when the grid has a `depth`. */
    get shape(): number[] {
        return [...(this.depth === null ? [] : [this.depth]), this.rowsShown, this.colsShown]
    }

    /** The rows and the columns of one patch after a `cut()`, or null for a grid that is whole. */
    get patchShape(): [number, number] | null {
        return this.patches ? [this.patches.rows, this.patches.cols] : null
    }

    /**
     * The places that a window visits on the rows and columns that show, as slices: `grid.windows(3)[0][1]` is
     * the second place of the first row of places. The list has one row for each row of the output and one
     * entry for each of its columns, so its size is the size of the output of a convolution or of a pooling.
     */
    windows(size: number | readonly [number, number], options: { stride?: number | readonly [number, number] } = {}): GridSlice[][] {
        const pair = (value: number | readonly [number, number], what: string): [number, number] => {
            const [a, b] = typeof value === 'number' ? [value, value] : value
            if (!Number.isInteger(a) || !Number.isInteger(b) || a! < 1 || b! < 1) throw new Error(`heatmap: the ${what} of windows is ${shown(value)}. Give a whole number, 1 or more, or one for the rows and one for the columns`)
            return [a!, b!]
        }
        const [rows, cols] = pair(size, 'size'), [down, across] = pair(options.stride ?? 1, 'stride')
        if (rows > this.rowsShown || cols > this.colsShown) throw new Error(`heatmap: a window of ${rows} by ${cols} is larger than the grid, which shows ${this.rowsShown} by ${this.colsShown}. Give a smaller window`)
        const out: GridSlice[][] = []
        for (let i = 0; i + rows <= this.rowsShown; i += down) {
            const line: GridSlice[] = []
            for (let j = 0; j + cols <= this.colsShown; j += across) line.push({ row: [i, i + rows - 1], col: [j, j + cols - 1] })
            out.push(line)
        }
        return out
    }

    /**
     * The middle of a cell, or of one of its edges, in the coordinates of the grid: the point where an arrow
     * or a note starts. It is the place after the changes that are scheduled so far, and it does not follow
     * the cell.
     */
    p(row: number, col: number, edge?: 'top' | 'bottom' | 'left' | 'right'): [number, number] {
        this.cell(row, col)
        const [x, y] = this.place(row, col)
        if (edge === undefined) return [x, y]
        if (edge === 'top') return [x, y - this.h / 2]
        if (edge === 'bottom') return [x, y + this.h / 2]
        if (edge === 'left') return [x - this.w / 2, y]
        if (edge === 'right') return [x + this.w / 2, y]
        throw new Error(`heatmap: the edge of p() is 'top', 'bottom', 'left' or 'right', not ${shown(edge)}`)
    }

    /**
     * The box of a slice, in stage pixels, for `place` and `beside` of the layout: `beside(note, grid.region({ row: 1 }), 'right')`.
     * Without a slice, the box of the cells that show. The box is where the grid is now, so ask for it after the grid has its place.
     */
    region(slice: GridSlice = {}): Box {
        const [x0, y0, x1, y1] = this.edges(this.resolve(this.span(slice, 'region'), 'region'))
        const [ax, ay] = this.toWorld(x0, y0), [bx, by] = this.toWorld(x1, y1)
        return new Box(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by))
    }

    /** The brace and the label of an axis, by its name, to light it or to point at it. */
    axis(name: string): Node {
        const part = this.axisParts.find((own) => own.name === name)
        if (!part) throw new Error(`heatmap: no axis ${shown(name)}. ${this.axisParts.length > 0 ? `The axes are ${this.axisParts.map((own) => JSON.stringify(own.name)).join(', ')}` : 'The grid has no `axes`'}`)
        return part.group
    }

    /** The numbers and the signs of a cell belong to it, so a light on the cell keeps them bright. */
    override labelsOf(part: Node): readonly Node[] {
        for (let i = 0; i < this.rowCount; i++) {
            const j = this.cells[i]!.indexOf(part)
            if (j >= 0) return [...this.history[i]![j]!, ...this.overlays[i]![j]!.values()]
        }
        return []
    }

    /** A copy with its own cells and its own record of values and states, so a change of the copy does not change the grid. */
    override clone(): this {
        const mine = this.all()
        const copy = super.clone()
        const theirs = copy.all()
        const twin = new Map<Node, Node>()
        mine.forEach((node, index) => twin.set(node, theirs[index]!))
        const of = (node: Node): Node => twin.get(node) ?? node
        const own = copy as unknown as {
            cells: Node[][]; numbers: Node[][]; held: number[][]; states: string[][]; overlays: Map<string, Node>[][]; history: Node[][][]; busy: number[][]
            axisParts: AxisPart[]; litNow: Span | null; patches: Patches | null
        }
        own.cells = this.cells.map((row) => row.map(of))
        own.numbers = this.numbers.map((row) => row.map(of))
        own.held = this.held.map((row) => [...row])
        own.states = this.states.map((row) => [...row])
        own.overlays = this.overlays.map((row) => row.map((signs) => new Map([...signs].map(([state, node]) => [state, of(node)]))))
        own.history = this.history.map((row) => row.map((list) => list.map(of)))
        // The copy is a still of the grid, so it can change its numbers at any time.
        own.busy = this.busy.map((row) => row.map(() => -Infinity))
        own.axisParts = this.axisParts.map((part) => ({ ...part, mark: of(part.mark), label: of(part.label), group: of(part.group) }))
        own.litNow = this.litNow ? { ...this.litNow } : null
        own.patches = this.patches ? { ...this.patches } : null
        return copy
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
                        if (this.showsNumber(i, j)) number.tween('opacity', 1, start, start + each, ctx.ease)
                    }
                    const sign = this.overlays[i]![j]!.get(this.states[i]![j]!)
                    if (sign) {
                        stepAt(sign, 'opacity', 0, ctx.t0)
                        sign.tween('opacity', 1, start, start + each, ctx.ease)
                    }
                }))
                const around = this.patches ? [] : [...this.rowLabels, ...this.columnLabels, ...this.slabs, ...this.axisParts.map((part) => part.group), ...(this.caption ? [this.caption] : [])]
                for (const label of around) {
                    stepAt(label, 'opacity', 0, ctx.t0)
                    label.tween('opacity', 1, ctx.t0, ctx.t0 + span * 0.4, ctx.ease)
                }
            },
        }
    }

    /**
     * Give every cell a new value. The shade of each cell changes, and a grid that prints its numbers prints
     * the new ones. A cell with no value in `values` keeps its own. `lag` makes the cells change one after
     * another, row by row.
     */
    update(values: readonly (readonly number[])[], options: AnimOptions = {}): Anim {
        if (this.sized) values.forEach((row, i) => row.forEach((value, j) => { if (this.cells[i]?.[j]) this.checkValue(value, i, j, 'update') }))
        return {
            label: 'heatmap.update', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                const changes: [number, number, number][] = []
                values.forEach((row, i) => row.forEach((value, j) => { if (this.cells[i]?.[j]) changes.push([i, j, value]) }))
                const windows = spread(changes.length, options.lag ?? 0, ctx.t0, ctx.t1)
                changes.forEach(([i, j, value], index) => this.paint(i, j, windows[index]![0], windows[index]![1], ctx.ease, 'update', { value }))
            },
        }
    }

    /**
     * Change numbers in place: `grid.setValue({ row: 1, col: 2 }, 0.5)`, or a whole row with `grid.setValue({ row: 1 }, [0.1, 0.6, 0.3])`.
     * The old number fades out, then the new one fades in, and the shade follows. `values` is one number for every
     * cell, a list with one number for each cell row by row, the rows of a block, or a function of the row, the
     * column and the old value. `lag` makes the cells change one after another, as a sweep. `state` also moves the
     * cells to a state: `{ state: 'open' }` fills cells that were `empty`.
     */
    setValue(cells: GridCells, values: number | readonly number[] | readonly (readonly number[])[] | ((row: number, col: number, old: number) => number), options: AnimOptions & { state?: string } = {}): Anim {
        const pick = this.picker(cells, 'setValue')
        if (options.state !== undefined) this.look(options.state)
        if (typeof values !== 'function' && typeof values !== 'number' && !Array.isArray(values)) throw new Error(`heatmap: the values of setValue are ${shown(values)}. Give one number, a list of numbers, or a function of the row, the column and the old value`)
        const given = typeof values === 'function' || typeof values === 'number' ? null : (values as readonly (number | readonly number[])[]).flat()
        // Find a wrong list now, where the film names it. A function picks its cells when the change plays.
        if (given && typeof cells !== 'function') {
            const count = pick().length
            if (given.length !== count) throw new Error(`heatmap: setValue got ${given.length} value${given.length === 1 ? '' : 's'} for ${count} cell${count === 1 ? '' : 's'}. Give one number for each cell of the slice, row by row, or one number for all of them`)
        }
        if (typeof values === 'number') this.checkValue(values, -1, -1, 'setValue')
        for (const value of given ?? []) this.checkValue(value, -1, -1, 'setValue')
        return {
            label: 'heatmap.setValue', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const chosen = pick()
                if (given && given.length !== chosen.length) throw new Error(`heatmap: setValue got ${given.length} values, and its function picked ${chosen.length} cells. Give one number for each cell that the function picks, row by row`)
                const windows = spread(chosen.length, options.lag ?? 0, ctx.t0, ctx.t1)
                chosen.forEach(([i, j], index) => {
                    const value = typeof values === 'function' ? values(i, j, this.held[i]![j]!) : given ? given[index]! : values as number
                    if (typeof values === 'function') this.checkValue(value, i, j, 'setValue')
                    this.paint(i, j, windows[index]![0], windows[index]![1], ctx.ease, 'setValue', { value, state: options.state })
                })
            },
        }
    }

    /**
     * Cells go to a state: `grid.mark({ col: 0 }, 'padding')`, or `grid.mark((row, col) => col > row, 'future')` for
     * a causal mask. The sign of the state covers each cell and its number. `'open'` takes the sign away, and the
     * cell shows its value again. The grid calls a function when the change plays, so a second change in one
     * sequence sees the states that the first one left. A cell that has the state already does not change.
     */
    mark(cells: GridCells, state: string, options: AnimOptions = {}): Anim {
        const pick = this.picker(cells, 'mark')
        this.look(state)
        return {
            label: 'heatmap.mark', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const chosen = pick().filter(([i, j]) => this.states[i]![j] !== state)
                const windows = spread(chosen.length, options.lag ?? 0, ctx.t0, ctx.t1)
                chosen.forEach(([i, j], index) => this.paint(i, j, windows[index]![0], windows[index]![1], ctx.ease, 'mark', { state }))
            },
        }
    }

    /**
     * Put the outline on a slice: a row, a column, one cell, or a block. It stays until the next `light`, and
     * `light(null)` takes it away. A second `light` moves the outline, so a block that goes one column on is a
     * window that slides. In a grid that prints every number, the outline does not slide over the numbers: it
     * leaves the first slice and comes in at the second. The names of the lit rows and columns go bright. With
     * `values: 'lit'`, only the lit cells print their numbers.
     */
    light(slice: GridSlice | null, options: AnimOptions & { color?: ColorInput } = {}): Anim {
        const span = slice === null ? null : this.span(slice, 'light')
        const paint = toPaint(options.color ?? 'ink')
        const frame = this.frame ?? this.makeFrame()
        return {
            label: 'heatmap.light', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx
                const before = this.litNow
                const next = span ? this.resolve(span, 'light', true) : null
                const told = this.printed === 'lit' ? this.shownNumbers() : null
                const [rowsBefore, colsBefore] = this.brightNames(before)
                this.litNow = next
                if (next) {
                    const path = this.framePath(next)
                    if (sampleAt(frame, 'opacity', t0) <= 0.002) {
                        // The outline comes in at its slice. It does not fly in from the place of the last light.
                        stepAt(frame, 'path', path, t0)
                        stepAt(frame, 'stroke', paint, t0)
                        frame.tween('opacity', 1, t0, t1, ease)
                    } else if (this.printed === true) {
                        // In a grid that prints every number, a line that slides would cross the numbers. So the
                        // outline leaves the first slice, and then comes in at the second.
                        const turn = (t0 + t1) / 2
                        frame.tween('opacity', 0, t0, turn, ease)
                        stepAt(frame, 'path', path, turn)
                        stepAt(frame, 'stroke', paint, turn)
                        frame.tween('opacity', 1, turn, t1, ease)
                    } else {
                        frame.track('path').add({ t0, t1, ease, to: path, at: lerpSame(sampleAt(frame, 'path', t0)!, path) })
                        frame.tween('stroke', paint, t0, t1, ease)
                        frame.tween('opacity', 1, t0, t1, ease)
                    }
                } else {
                    frame.tween('opacity', 0, t0, t1, ease)
                }
                const [rowsAfter, colsAfter] = this.brightNames(next)
                this.rowLabels.forEach((label, i) => { if (rowsBefore.has(i) !== rowsAfter.has(i)) this.tint(label, rowsAfter.has(i) ? 'ink' : 'dim', t0, t1, ease) })
                this.columnLabels.forEach((label, j) => { if (colsBefore.has(j) !== colsAfter.has(j)) this.tint(label, colsAfter.has(j) ? 'ink' : 'dim', t0, t1, ease) })
                if (told) this.retell(told, t0, t1, ease)
            },
        }
    }

    /**
     * Show more rows and columns: `grid.grow({ columns: 1 })` for a new token of a cache, or `grid.grow({ rows: 1, columns: 1 })`
     * for a square of attention that gains a token. The grid is made with all its rows and columns, and `shown`
     * says how many are there at the start, so nothing moves when it grows. The new cells arrive one after
     * another, and the braces and the shape follow.
     */
    grow(by: { rows?: number; columns?: number }, options: AnimOptions = {}): Anim {
        if (typeof by !== 'object' || by === null) throw new Error(`heatmap: grow takes the rows and the columns to add, such as { columns: 1 }, and it got ${shown(by)}`)
        const rows = by.rows ?? 0, cols = by.columns ?? 0
        for (const [name, count] of [['rows', rows], ['columns', cols]] as const) {
            if (!Number.isInteger(count) || count < 0) throw new Error(`heatmap: grow adds ${shown(count)} ${name}. Give a whole number, 0 or more`)
        }
        if (rows + cols === 0) throw new Error('heatmap: grow adds no row and no column. Give a count, such as { columns: 1 }')
        return {
            label: 'heatmap.grow', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx
                const rows0 = this.rowsShown, cols0 = this.colsShown, rows1 = rows0 + rows, cols1 = cols0 + cols
                if (rows1 > this.rowCount || cols1 > this.colCount) throw new Error(`heatmap: grow would show ${rows1} rows and ${cols1} columns, and the grid has ${this.rowCount} by ${this.colCount}. Make the grid with every row and column that it will have, and give \`shown\` for the ones that are there at the start`)
                if (this.patches) throw new Error('heatmap: grow needs a grid that is whole, and this one is cut into patches. Play join() first')
                const told = this.printed === 'lit' ? this.shownNumbers() : null
                this.rowsShown = rows1
                this.colsShown = cols1
                // The new columns arrive from the top, and then the new rows from the left.
                const fresh: [number, number][] = []
                for (let j = cols0; j < cols1; j++) for (let i = 0; i < rows1; i++) fresh.push([i, j])
                for (let i = rows0; i < rows1; i++) for (let j = 0; j < cols0; j++) fresh.push([i, j])
                // The braces move out in the first part of the time, and the cells arrive after them, so no brace crosses a cell.
                const moved = t0 + (t1 - t0) * 0.35
                const windows = spread(fresh.length, options.lag ?? 0.3, t0 + (t1 - t0) * 0.25, t1)
                fresh.forEach(([i, j], index) => {
                    const [start, end] = windows[index]!
                    for (const part of this.partsOf(i, j)) part.track('visible').step(start, true)
                    stepAt(this.cells[i]![j]!, 'opacity', 0, start)
                    this.cells[i]![j]!.tween('opacity', 1, start, end, ease)
                    const sign = this.overlays[i]![j]!.get(this.states[i]![j]!)
                    if (sign) {
                        stepAt(sign, 'opacity', 0, start)
                        sign.tween('opacity', 1, start, end, ease)
                    }
                    const number = this.numbers[i]?.[j]
                    if (number) {
                        stepAt(number, 'opacity', 0, start)
                        if (this.showsNumber(i, j)) number.tween('opacity', 1, start, end, ease)
                    }
                })
                const arrive = (label: Node | undefined) => {
                    if (!label) return
                    label.track('visible').step(t0, true)
                    stepAt(label, 'opacity', 0, t0)
                    label.tween('opacity', 1, t0, t1, ease)
                }
                for (let i = rows0; i < rows1; i++) arrive(this.rowLabels[i])
                for (let j = cols0; j < cols1; j++) arrive(this.columnLabels[j])
                this.refurnish(t0, moved, ease)
                // The lit slice does not change. A light on every row is on the rows that show now.
                if (this.litNow && this.frame) {
                    const lit = this.litNow
                    if (!lit.rows) lit.r1 = rows1 - 1
                    if (!lit.cols) lit.c1 = cols1 - 1
                    const path = this.framePath(lit)
                    this.frame.track('path').add({ t0, t1, ease, to: path, at: lerpSame(sampleAt(this.frame, 'path', t0)!, path) })
                }
                if (told) this.retell(told, t0, t1, ease)
            },
        }
    }

    /**
     * Cut the grid into patches of `rows` by `cols` cells: the cells of a patch stay together and the patches
     * move apart, as an image that a vision model splits. `unroll: true` then lays each patch out as one row of
     * cells, one patch under the other: the sequence of tokens that the patches become. The names, the braces
     * and the shape leave, because they name the whole grid. `join()` brings the grid back.
     */
    cut(rows: number, cols: number, options: AnimOptions & { gap?: number; unroll?: boolean } = {}): Anim {
        for (const [name, count, all] of [['rows', rows, this.rowCount], ['columns', cols, this.colCount]] as const) {
            if (!Number.isInteger(count) || count < 1) throw new Error(`heatmap: a patch of cut has ${shown(count)} ${name}. Give a whole number, 1 or more`)
            if (all % count !== 0) throw new Error(`heatmap: the grid has ${all} ${name}, which do not cut into patches of ${count}. Give a count that divides ${all}`)
        }
        const gap = options.gap ?? Math.round(Math.max(this.w, this.h) * 0.3)
        if (!(Number.isFinite(gap) && gap >= 0)) throw new Error(`heatmap: the gap of cut is ${shown(gap)}. It is the room between two patches, 0 or more`)
        return this.rearrange({ rows, cols, gap, unrolled: options.unroll ?? false }, 'cut', options)
    }

    /** The patches of a `cut()` come back together, and the names, the braces and the shape come back. */
    join(options: AnimOptions = {}): Anim {
        return this.rearrange(null, 'join', options)
    }

    // ── What the film gave ──────────────────────────────────────────────────

    private checkInput(values: readonly (readonly number[])[], options: HeatmapOptions): void {
        if (!Array.isArray(values) || values.length === 0 || !values.every((row) => Array.isArray(row))) throw new Error('heatmap: give the values as a list of rows, with one row at least, such as [[1, 2], [3, 4]]')
        values.forEach((row, i) => {
            if (row.length === 0 || row.length !== values[0]!.length) throw new Error(`heatmap: row ${i} has ${row.length} values, and row 0 has ${values[0]!.length}. Give every row the same number of values, one at least`)
            row.forEach((value, j) => {
                if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`heatmap: the value of cell (${i}, ${j}) is ${shown(value)}. A value is a number. For a cell with no value yet, give a number and the state 'empty'`)
            })
        })
        for (const name of ['size', 'width', 'cell', 'cellWidth', 'cellHeight', 'valueSize', 'labelSize'] as const) {
            const value = options[name]
            if (value !== undefined && !(Number.isFinite(value) && value > 0)) throw new Error(`heatmap: ${name} is ${shown(value)}. Give a number of stage pixels, more than 0`)
        }
        if (options.gap !== undefined && !(Number.isFinite(options.gap) && options.gap >= 0)) throw new Error(`heatmap: gap is ${shown(options.gap)}. It is the room between two cells, 0 or more`)
        if (options.width !== undefined && (options.cell !== undefined || options.cellWidth !== undefined)) throw new Error('heatmap: width sets the width of a cell, and so does cell. Give one of them')
        if (options.values !== undefined && options.values !== true && options.values !== false && options.values !== 'lit') throw new Error(`heatmap: values is true, false or 'lit', not ${shown(options.values)}`)
        const rows = values.length, cols = values[0]!.length
        for (const [name, list, count, what] of [['rowLabels', options.rowLabels, rows, 'rows'], ['columnLabels', options.columnLabels, cols, 'columns']] as const) {
            if (list !== undefined && list.length !== count) throw new Error(`heatmap: ${name} has ${list.length} names, and the grid has ${count} ${what}. Give one name for each`)
        }
        const depth = options.depth
        if (depth !== undefined && (!Number.isInteger(depth) || depth < 1)) throw new Error(`heatmap: depth is ${shown(depth)}. It is the size of the third axis, a whole number, 1 or more`)
        const axes = options.axes
        if (axes !== undefined) {
            if (!Array.isArray(axes) || axes.some((name) => typeof name !== 'string' || name.trim() === '' || /[\r\n]/.test(name))) throw new Error(`heatmap: axes is ${shown(axes)}. Give the names of the axes, each on one line, such as ['seq', 'd']`)
            if (new Set(axes).size !== axes.length) throw new Error(`heatmap: two axes have one name in ${shown(axes)}. Give each axis its own name, so that axis(name) finds one`)
            if (axes.length === 3 && depth === undefined) throw new Error(`heatmap: axes has 3 names, and a grid has 2 axes. Give \`depth\` for the size of ${JSON.stringify(axes[0])}, such as depth: 2, or 2 names`)
            if (axes.length !== (depth === undefined ? 2 : 3)) throw new Error(`heatmap: axes has ${axes.length} name${axes.length === 1 ? '' : 's'}, and the grid has ${depth === undefined ? '2 axes: its rows and its columns' : '3 axes: its depth, its rows and its columns'}. Give one name for each, the outer one first`)
        }
        if (options.name !== undefined && (typeof options.name !== 'string' || options.name.trim() === '' || /[\r\n]/.test(options.name))) throw new Error(`heatmap: name is ${shown(options.name)}. Give the name of the tensor on one line, such as 'x'`)
        for (const [state, look] of Object.entries(options.states ?? {})) {
            if (state === 'open') throw new Error("heatmap: states names the state 'open'. Every grid has it: it is a cell that shows its value, and it has no sign")
            if (!['none', 'cross', 'hatch', 'dash'].includes(String(look?.mark))) throw new Error(`heatmap: the mark of the state ${JSON.stringify(state)} is ${shown(look?.mark)}. A mark is 'none', 'cross', 'hatch' or 'dash'`)
        }
        const initial = options.initial
        if (initial !== undefined && typeof initial !== 'string' && typeof initial !== 'function') throw new Error(`heatmap: initial is ${shown(initial)}. Give the name of a state, or a function of the row and the column`)
        for (const [name, count, all] of [['rows', options.shown?.rows, rows], ['columns', options.shown?.columns, cols]] as const) {
            if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > all)) throw new Error(`heatmap: shown.${name} is ${shown(count)}. Give a whole number from 1 to ${all}, the number of ${name} of the grid`)
        }
    }

    /** A value that a change gives a cell: a number in the range of the colors, with a text that fits its cell. */
    private checkValue(value: number, row: number, col: number, call: string): void {
        const where = row < 0 ? '' : ` for cell (${row}, ${col})`
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`heatmap: ${call} got the value ${shown(value)}${where}. A value is a number`)
        const [low, high] = this.domain
        // A range that comes from the first values knows nothing of the next ones. A range that the film gave is its choice.
        if (!this.fixedDomain && (value < low || value > high)) throw new Error(`heatmap: ${call} got the value ${value}${where}, outside the range of the colors, ${low} to ${high}, which comes from the first values. Give the grid a \`domain\` that holds every value of the film, such as domain: [${Math.min(low, value)}, ${Math.max(high, value)}]`)
        if (!this.sized || !this.printed) return
        const need = Math.ceil(this.inkWidth(this.format(value), this.valueSize) + this.valueSize * 0.5)
        if (need > this.w) throw new Error(`heatmap: ${call} got the value ${value}${where}, and its text ${JSON.stringify(this.format(value))} needs ${need} px in a cell of ${Math.floor(this.w)}. Give a cell of ${need} or more, a smaller size, or a format with fewer digits`)
    }

    private known(): string {
        return `The states are ${['open', ...this.looks.keys()].join(', ')}`
    }

    /** The look of a state, or null for `open`. */
    private look(state: string): Look | null {
        if (state === 'open') return null
        const look = this.looks.get(state)
        if (!look) throw new Error(`heatmap: no state ${shown(state)}. ${this.known()}`)
        return look
    }

    /** A slice as the film wrote it, with every index in the grid. A slice with no rows has every row. */
    private span(slice: GridSlice, call: string): Span {
        const parts = ['row', 'col', 'patch']
        if (typeof slice !== 'object' || slice === null || Array.isArray(slice)) throw new Error(`heatmap: ${call} takes a slice such as { row: 1 } or { row: [0, 1], col: [2, 3] }, and it got ${shown(slice)}`)
        const unknown = Object.keys(slice).find((name) => !parts.includes(name))
        if (unknown !== undefined) throw new Error(`heatmap: a slice has no part "${unknown}". Its parts are: ${parts.join(', ')}`)
        if (slice.patch !== undefined) {
            if (slice.row !== undefined || slice.col !== undefined) throw new Error('heatmap: a slice takes `patch`, or `row` and `col`, not both')
            if (!Number.isInteger(slice.patch) || slice.patch < 0) throw new Error(`heatmap: the patch of a slice is ${shown(slice.patch)}. Give a whole number, 0 or more`)
            return { r0: 0, r1: 0, c0: 0, c1: 0, patch: slice.patch, rows: true, cols: true }
        }
        const range = (value: number | readonly [number, number] | undefined, name: string, count: number): [number, number] => {
            if (value === undefined) return [0, count - 1]
            const [from, to] = typeof value === 'number' ? [value, value] : value
            if (!Number.isInteger(from) || !Number.isInteger(to) || from! < 0 || to! >= count || from! > to!) throw new Error(`heatmap: the ${name} of a slice is ${shown(value)}. Give one ${name}, or the first and the last one, from 0 to ${count - 1}`)
            return [from!, to!]
        }
        const [r0, r1] = range(slice.row, 'row', this.rowCount), [c0, c1] = range(slice.col, 'col', this.colCount)
        return { r0, r1, c0, c1, patch: null, rows: slice.row !== undefined, cols: slice.col !== undefined }
    }

    /**
     * The cells of a slice as the grid is now: a patch becomes its rows and columns, and a slice with no rows
     * takes the rows that show. `visible` is for a slice that the viewer must see: a row that waits for `grow()` is an error.
     */
    private resolve(span: Span, call: string, visible = false): Span {
        if (span.patch !== null) {
            const cut = this.patches
            if (!cut) throw new Error(`heatmap: ${call} names patch ${span.patch}, and the grid is whole. Play cut() first`)
            const across = this.colCount / cut.cols, count = across * (this.rowCount / cut.rows)
            if (span.patch >= count) throw new Error(`heatmap: no patch ${span.patch}. The grid has ${count} patches, 0 to ${count - 1}`)
            const r0 = Math.floor(span.patch / across) * cut.rows, c0 = (span.patch % across) * cut.cols
            return { ...span, r0, r1: r0 + cut.rows - 1, c0, c1: c0 + cut.cols - 1 }
        }
        if (visible && this.patches?.unrolled) throw new Error(`heatmap: ${call} names rows and columns, and the grid is unrolled: each of its rows is a patch now. Name a patch, such as { patch: 0 }, or play join() first`)
        const next = { ...span }
        if (!span.rows) next.r1 = this.rowsShown - 1
        if (!span.cols) next.c1 = this.colsShown - 1
        if (visible && (next.r1 >= this.rowsShown || next.c1 >= this.colsShown)) throw new Error(`heatmap: ${call} names a cell that does not show yet: the grid shows ${this.rowsShown} rows and ${this.colsShown} columns of its ${this.rowCount} by ${this.colCount}. Play grow() first`)
        return next
    }

    /** The cells that a change is for, row by row. The list is made when the change plays, from the grid as it is then. */
    private picker(cells: GridCells, call: string): () => [number, number][] {
        if (typeof cells === 'function') {
            return () => {
                const out: [number, number][] = []
                for (let i = 0; i < this.rowCount; i++) {
                    for (let j = 0; j < this.colCount; j++) if (cells(i, j, this.held[i]![j]!, this.states[i]![j]!)) out.push([i, j])
                }
                return out
            }
        }
        const span = this.span(cells, call)
        // A patch has its cells only after the cut, and a film may name it before the cut plays.
        if (span.patch === null || this.patches) this.resolve(span, call)
        return () => {
            // A change is for the hidden cells of its rows too, so a column that is padding is padding in a row that comes later.
            const { r0, r1, c0, c1 } = span.patch === null ? span : this.resolve(span, call)
            const out: [number, number][] = []
            for (let i = r0; i <= r1; i++) for (let j = c0; j <= c1; j++) out.push([i, j])
            return out
        }
    }

    // ── Places ──────────────────────────────────────────────────────────────

    /** The middle of a cell, in the arrangement that the grid has now. */
    private place(row: number, col: number, patches: Patches | null = this.patches): [number, number] {
        const px = this.w + this.gap, py = this.h + this.gap
        if (!patches) return [this.x0 + col * px + this.w / 2, this.y0 + row * py + this.h / 2]
        const down = this.rowCount / patches.rows, across = this.colCount / patches.cols
        const R = Math.floor(row / patches.rows), C = Math.floor(col / patches.cols)
        if (!patches.unrolled) {
            // The patches move apart around the middle of the grid, so the grid stays where the film put it.
            return [this.x0 + col * px + this.w / 2 + (C - (across - 1) / 2) * patches.gap, this.y0 + row * py + this.h / 2 + (R - (down - 1) / 2) * patches.gap]
        }
        // One patch is one row: its cells row by row, from the left. The rows are apart by the gap of the cut.
        const count = down * across, length = patches.rows * patches.cols
        const k = R * across + C, q = (row % patches.rows) * patches.cols + (col % patches.cols)
        const wide = length * px - this.gap, high = count * this.h + (count - 1) * patches.gap
        return [Math.round(-wide / 2) + q * px + this.w / 2, Math.round(-high / 2) + k * (this.h + patches.gap) + this.h / 2]
    }

    /** The left, top, right and bottom edge of the cells of a slice, where they are now. */
    private edges(span: Span, patches: Patches | null = this.patches): [number, number, number, number] {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
        for (const [i, j] of [[span.r0, span.c0], [span.r0, span.c1], [span.r1, span.c0], [span.r1, span.c1]] as const) {
            const [x, y] = this.place(i, j, patches)
            x0 = Math.min(x0, x - this.w / 2)
            y0 = Math.min(y0, y - this.h / 2)
            x1 = Math.max(x1, x + this.w / 2)
            y1 = Math.max(y1, y + this.h / 2)
        }
        return [x0, y0, x1, y1]
    }

    /** The cell, its number and its signs: the nodes that are at the place of a cell. */
    private partsOf(row: number, col: number): Node[] {
        return [this.cells[row]![col]!, ...this.history[row]![col]!, ...this.overlays[row]![col]!.values()]
    }

    // ── Numbers and states ──────────────────────────────────────────────────

    private inkWidth(content: string, size: number): number {
        return text(content, { size, font: 'mono' }).bounds().width
    }

    private numberNode(value: number, x: number, y: number): Node {
        const color = this.colorFor(value)
        // A number is dark on a light cell and light on a dark one. At a luminance of 0.18, the two have the same
        // contrast with the cell, a little over 4. A grid from before `size` keeps its limit, and so its frames.
        return text(this.format(value), { size: this.valueSize, font: 'mono', color: luminance(color) > (this.sized ? 0.18 : 0.32) ? '#101114' : '#f2efe6' }).at(x, y)
    }

    /** True when a cell shows its number: it prints one, no sign covers it, and with `values: 'lit'` it is in the lit slice. */
    private showsNumber(row: number, col: number): boolean {
        if (!this.printed || this.states[row]![col] !== 'open') return false
        if (this.printed !== 'lit') return true
        const lit = this.litNow
        return !!lit && row >= lit.r0 && row <= lit.r1 && col >= lit.c0 && col <= lit.c1
    }

    /** The cells that show their number now, for a change that moves the light. */
    private shownNumbers(): boolean[][] {
        return this.held.map((row, i) => row.map((_, j) => this.showsNumber(i, j)))
    }

    /**
     * After the light moved: the numbers that show now come in, and the others leave. A number leaves in the
     * first part of the time and comes in the last part, so the outline that slides over its cell does not cross it.
     */
    private retell(before: boolean[][], t0: number, t1: number, ease: Ease): void {
        const span = t1 - t0
        before.forEach((row, i) => row.forEach((was, j) => {
            const shows = this.showsNumber(i, j), number = this.numbers[i]?.[j]
            if (!number || shows === was) return
            if (shows) number.tween('opacity', 1, t0 + span * 0.6, t1, ease)
            else number.tween('opacity', 0, t0, t0 + span * 0.4, ease)
        }))
    }

    /** The sign of a state over a cell: an outline, and the lines of the mark. It is made the first time that the cell has the state. */
    private signOf(row: number, col: number, state: string): Node {
        const signs = this.overlays[row]![col]!
        let made = signs.get(state)
        if (made) return made
        const look = this.looks.get(state)!
        const { w, h } = this, weight = Math.max(1.5, Math.min(w, h) * 0.035)
        // The outline is inside the cell by half of its line, so the sign is as large as the cell.
        const outline = rectPath(-w / 2 + weight / 2, -h / 2 + weight / 2, w - weight, h - weight, Math.max(0, this.corner - weight / 2))
        const reach = Math.min(w, h) * 0.22
        const lines: Path = look.mark === 'cross' ? [...outline, ...linePath([-reach, -reach], [reach, reach]), ...linePath([-reach, reach], [reach, -reach])]
            : look.mark === 'hatch' ? [...outline, ...hatchPath(w - weight * 2, h - weight * 2, Math.max(8, Math.min(w, h) * 0.24))]
                : look.mark === 'dash' ? dashedBox(w - weight, h - weight, Math.max(6, Math.min(w, h) * 0.2)) : outline
        made = new Node(lines).stroke(look.paint, weight).at(this.place(row, col)).opacity(0)
        // Flat ends: a round end makes a dash longer than its share of the side.
        if (look.mark === 'dash') made.set('cap', 'butt')
        signs.set(state, made)
        return made
    }

    /**
     * Write the look of a cell over a time: its shade, the sign of its state, and its number. `change` gives
     * the new value, the new state, or both. The record of the grid changes here, when the change plays.
     */
    private paint(row: number, col: number, t0: number, t1: number, ease: Ease, call: string, change: { value?: number; state?: string }): void {
        const cell = this.cells[row]![col]!
        const before = this.states[row]![col]!, after = change.state ?? before
        const old = this.numbers[row]?.[col]
        const was = this.showsNumber(row, col)
        if (change.value !== undefined) this.held[row]![col] = change.value
        this.states[row]![col] = after
        const look = this.looks.get(after)
        if (!look) {
            cell.tween('fill', this.colorFor(this.held[row]![col]!), t0, t1, ease)
            if (before !== after) cell.tween('fillOpacity', 1, t0, t1, ease)
        } else if (before !== after) {
            cell.tween('fill', toPaint('surface'), t0, t1, ease)
            cell.tween('fillOpacity', COVER[look.mark], t0, t1, ease)
        }
        // A cell that waits for `grow()` keeps what is new hidden. `grow()` shows it.
        const waits = row >= this.rowsShown || col >= this.colsShown
        // What leaves a cell goes in the first half of the time, and what comes arrives in the second half. So
        // no moment shows a number under a sign, two signs, or two numbers.
        const turn = (t0 + t1) / 2
        if (before !== after) {
            this.overlays[row]![col]!.get(before)?.tween('opacity', 0, t0, turn, ease)
            if (look) {
                const sign = this.signOf(row, col, after)
                if (sign.parent !== this) this.add(waits ? sign.hide() : sign)
                sign.tween('opacity', 1, turn, t1, ease)
            }
        }
        if (!old) return
        const shows = this.showsNumber(row, col)
        const next = change.value !== undefined && this.format(change.value) !== (old as Node & { source?: string }).source ? this.numberNode(change.value, ...this.place(row, col)).opacity(0) : null
        if (!next) {
            if (shows && !was) old.tween('opacity', 1, turn, t1, ease)
            if (was && !shows) old.tween('opacity', 0, t0, turn, ease)
            return
        }
        // Each change of a number writes two fades. Two changes at one time would leave both of their numbers in the cell.
        if (t0 < this.busy[row]![col]! - SOON) throw new Error(`heatmap: ${call} changes the number of cell (${row}, ${col}) from ${seconds(t0)} to ${seconds(t1)}, and the change before it ends at ${seconds(this.busy[row]![col]!)}. A cell changes its number one change at a time. Play the two in a \`seq\`, or give one change the last value`)
        this.busy[row]![col] = t1
        this.add(waits ? next.hide() : next)
        ownLabels(this, { labels: [next] })
        old.tween('opacity', 0, t0, turn, ease)
        if (shows) next.tween('opacity', 1, turn, t1, ease)
        this.numbers[row]![col] = next
        this.history[row]![col]!.push(next)
    }

    // ── The light ───────────────────────────────────────────────────────────

    private makeFrame(): Node {
        const weight = this.sized ? Math.max(3, Math.round(this.size * 0.14)) : Math.max(2.5, Math.min(this.w, this.h) * 0.07)
        // The outline is over the cells, their numbers and their signs, whenever those were made.
        const frame = new Node(this.framePath({ r0: 0, r1: 0, c0: 0, c1: 0, patch: null, rows: true, cols: true })).stroke('ink', weight).opacity(0).zIndex(1)
        this.frame = frame
        this.add(frame)
        return frame
    }

    /** The outline of a slice: around its cells, in the room between them and their neighbors. */
    private framePath(span: Span): Path {
        const [x0, y0, x1, y1] = this.edges(span)
        const out = this.gap / 2 + (this.frame?.get('strokeWidth') ?? 0) / 2
        return rectPath(x0 - out, y0 - out, x1 - x0 + out * 2, y1 - y0 + out * 2, this.corner + out)
    }

    /** The rows and the columns whose names a light makes bright: those of the slice, on an axis that the slice does not take whole. */
    private brightNames(span: Span | null): [Set<number>, Set<number>] {
        const rows = new Set<number>(), cols = new Set<number>()
        if (!span || this.patches) return [rows, cols]
        if (span.r1 - span.r0 + 1 < this.rowsShown) for (let i = span.r0; i <= span.r1; i++) rows.add(i)
        if (span.c1 - span.c0 + 1 < this.colsShown) for (let j = span.c0; j <= span.c1; j++) cols.add(j)
        return [rows, cols]
    }

    private tint(label: Node, color: ColorInput, t0: number, t1: number, ease: Ease): void {
        const paint = toPaint(color)
        for (const part of label.all()) if (part.get('fill')) part.tween('fill', paint, t0, t1, ease)
    }

    // ── The braces, the sheets and the shape ───────────────────────────────

    /** Where the sheets, the braces, their labels and the shape are for a number of rows and columns that show. */
    private furnitureAt(rows: number, cols: number): Furniture {
        const s = this.size, left = this.x0, top = this.y0
        const right = left + cols * (this.w + this.gap) - this.gap, bottom = top + rows * (this.h + this.gap) - this.gap
        const sheets = this.depth === null ? 1 : Math.min(this.depth, SHEETS), step = Math.round(s * 0.4)
        const slabs: Path[] = []
        // The sheets go down and to the right, so the names at the left and over the cells stay beside the first
        // sheet. A sheet shows the three edges that the sheet before it does not hide.
        for (let k = sheets - 1; k >= 1; k--) {
            const near = (k - 1) * step, away = k * step
            slabs.push(polyPath([[right + near, top + away], [right + away, top + away], [right + away, bottom + away], [left + away, bottom + away], [left + away, bottom + near]]))
        }
        const far = right + (sheets - 1) * step, low = bottom + (sheets - 1) * step
        const off = s * 0.45, deep = s * 0.5, room = s * 0.3
        const named = this.axisNames
        const line = low + off + deep + room + s * 0.5
        const of = (from: [number, number], to: [number, number]): Path => brace(from, to, { depth: deep }).get('path')!
        const reach = s * 1.2
        return {
            slabs,
            // The tip of a brace points away from the cells: to the right of the rows, and down from the columns.
            rows: named.rows === null ? null : { path: of([far + off, bottom], [far + off, top]), label: `${named.rows} = ${rows}`, at: [far + off + deep + room, (top + bottom) / 2] },
            cols: named.cols === null ? null : { path: of([left, low + off], [right, low + off]), label: `${named.cols} = ${cols}`, at: [(left + right) / 2, line] },
            // The third axis runs along the corners of the sheets. A short line goes on from the last corner to its label.
            depth: named.depth === null ? null : { path: linePath([far + s * 0.2, low + s * 0.2], [far + reach, low + reach]), label: `${named.depth} = ${this.depth}`, at: [far + reach + room, line] },
            caption: this.tensor === null && named.rows === null ? null : {
                label: `${this.tensor === null ? '' : `${this.tensor} `}[${[...(this.depth === null ? [] : [this.depth]), rows, cols].join(', ')}]`,
                at: [(left + right) / 2, named.rows === null ? low + off + s * 0.5 : line + s * 1.45],
            },
        }
    }

    private axisLabel(kind: AxisPart['kind'], placed: Placed): Node {
        return text(placed.label, { size: this.size, font: this.font, color: 'dim', anchor: kind === 'cols' ? 'center' : 'left' }).at(placed.at)
    }

    private captionNode(placed: { label: string; at: [number, number] }): Node {
        return text(placed.label, { size: this.size, font: 'mono', color: 'ink' }).at(placed.at)
    }

    /** The box of the braces, their labels and the shape, for a grid that shows a number of rows and columns. */
    private roomOf(furniture: Furniture): Bounds | null {
        let box: Bounds | null = null
        for (const path of furniture.slabs) box = unionBounds(box, pathBounds(path))
        for (const kind of ['rows', 'cols', 'depth'] as const) {
            const placed = furniture[kind]
            if (!placed) continue
            box = unionBounds(unionBounds(box, pathBounds(placed.path)), this.axisLabel(kind, placed).bounds())
        }
        if (furniture.caption) box = unionBounds(box, this.captionNode(furniture.caption).bounds())
        return box
    }

    /** One text takes the place of another: the old one fades out, then the new one fades in at its place. */
    private retext(old: Node, next: Node, holder: Node, t0: number, t1: number, ease: Ease): void {
        const turn = (t0 + t1) / 2
        next.opacity(0)
        holder.add(next)
        ownLabels(this, { labels: [next] })
        old.tween('opacity', 0, t0, turn, ease)
        next.tween('opacity', 1, turn, t1, ease)
    }

    /** The sheets, the braces, their labels and the shape go to the places of the rows and columns that show now. */
    private refurnish(t0: number, t1: number, ease: Ease): void {
        if (!this.sized) return
        const furniture = this.furnitureAt(this.rowsShown, this.colsShown)
        const move = (node: Node, path: Path) => node.track('path').add({ t0, t1, ease, to: path, at: lerpSame(sampleAt(node, 'path', t0)!, path) })
        this.slabs.forEach((slab, index) => move(slab, furniture.slabs[index]!))
        for (const part of this.axisParts) {
            const placed = furniture[part.kind]!
            move(part.mark, placed.path)
            const next = this.axisLabel(part.kind, placed)
            // A label with the same words moves to its new place. A label with a new size is a new text.
            if ((part.label as Node & { source?: string }).source === placed.label) {
                part.label.tween('x', next.get('x'), t0, t1, ease)
                part.label.tween('y', next.get('y'), t0, t1, ease)
            } else {
                this.retext(part.label, next, part.group, t0, t1, ease)
                part.label = next
            }
        }
        if (this.caption && furniture.caption) {
            const next = this.captionNode(furniture.caption)
            this.retext(this.caption, next, this, t0, t1, ease)
            this.caption = next
        }
    }

    // ── Patches ─────────────────────────────────────────────────────────────

    /** The cells go to the places of another arrangement: cut into patches, unrolled, or whole. */
    private rearrange(to: Patches | null, call: string, options: AnimOptions): Anim {
        return {
            label: `heatmap.${call}`, duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx
                if (to && (this.rowsShown < this.rowCount || this.colsShown < this.colCount)) throw new Error(`heatmap: cut needs every row and column on the stage, and the grid shows ${this.rowsShown} by ${this.colsShown} of its ${this.rowCount} by ${this.colCount}. Play grow() first`)
                const from = this.patches
                if (!from && !to) return
                const told = this.printed === 'lit' ? this.shownNumbers() : null
                // The names and the braces are for the whole grid, so they leave before the cells move and come back after.
                const span = t1 - t0
                const around = [...this.rowLabels, ...this.columnLabels, ...this.slabs, ...this.axisParts.map((part) => part.group), ...(this.caption ? [this.caption] : [])]
                const lit = this.litNow
                // The outline leaves too, and comes back at the new place of its cells: a line that moves with
                // the cells would cross the numbers of the cells that pass it.
                const leave = (!from && around.length > 0) || lit ? t0 + span * 0.2 : t0, arrive = (!to && around.length > 0) || lit ? t1 - span * 0.2 : t1
                if (!from) for (const node of around) node.tween('opacity', 0, t0, leave, ease)
                if (!to) for (const node of around) node.tween('opacity', 1, arrive, t1, ease)
                if (lit && this.frame) this.frame.tween('opacity', 0, t0, leave, ease)
                if (lit && lit.patch === null && to?.unrolled) {
                    // A light on rows and columns has no place in a grid that is unrolled, so it goes off.
                    this.litNow = null
                } else if (lit && lit.patch !== null && !to) {
                    // A whole grid has no patch. The light stays on the cells that the patch had.
                    this.litNow = { ...lit, patch: null }
                }
                // The patches move one after another, row by row. A plain cut moves them together.
                const groups = to ?? from!
                const across = this.colCount / groups.cols, count = across * (this.rowCount / groups.rows)
                const unrolls = (to?.unrolled ?? false) !== (from?.unrolled ?? false)
                const windows = spread(count, options.lag ?? (unrolls ? 0.25 : 0), leave, arrive)
                this.patches = to
                for (let i = 0; i < this.rowCount; i++) {
                    for (let j = 0; j < this.colCount; j++) {
                        const [start, end] = windows[Math.floor(i / groups.rows) * across + Math.floor(j / groups.cols)]!
                        const [x, y] = this.place(i, j)
                        for (const part of this.partsOf(i, j)) {
                            part.tween('x', x, start, end, ease)
                            part.tween('y', y, start, end, ease)
                        }
                    }
                }
                if (this.litNow && this.frame) {
                    // A lit patch is the patch with the same number in the new cut.
                    if (this.litNow.patch !== null) this.litNow = this.resolve(this.litNow, call)
                    stepAt(this.frame, 'path', this.framePath(this.litNow), arrive)
                    this.frame.tween('opacity', 1, arrive, t1, ease)
                }
                if (told) this.retell(told, t0, t1, ease)
            },
        }
    }
}

/** A grid of cells shaded by value: `heatmap([[0.2, 0.8], [0.6, 0.4]], { size: 30, values: true, rowLabels: ['cat', 'sat'], axes: ['seq', 'd'] })`. `grid.light({ row: 1 })` lights a row, and `grid.setValue({ row: 1, col: 0 }, 0.9)` changes a number in place. */
export function heatmap(values: readonly (readonly number[])[], options: HeatmapOptions = {}): Heatmap {
    return new Heatmap(values, options)
}
