import { Node } from '../node'
import { toPaint, type ColorInput, type Paint } from '../color'
import { rect } from '../shapes'
import { text, type TextOptions } from '../text'
import type { Anim, AnimOptions } from '../anim'
import { reveal, staggered, stepAt } from './util'

export interface GridState {
    color: ColorInput
    /** Opacity of the fill, 0 to 1. 0 draws the outline only. Defaults to 0.7. */
    fill?: number
    /** A dashed outline, for a thing that is not there. */
    dash?: boolean
}

export interface StateGridOptions {
    columns: number
    rows: number
    /** Side of one cell. Defaults to 28. */
    cell?: number
    /** Room between two cells. Defaults to 0.18 of `cell`, at least 3. */
    gap?: number
    /** The states and their looks. Defaults to PAGE_STATES. */
    states?: Record<string, GridState>
    /** The state of each cell at the start: one name, one name per cell, or a function of the index. Defaults to the first state. */
    initial?: string | readonly string[] | ((index: number) => string)
}

export interface GridLegendOptions {
    /** Text size of the names. The sample cells are a little smaller. Defaults to 26. */
    size?: number
    /** Room between a name and the next sample cell. Defaults to 1.3 of `size`. */
    gap?: number
    font?: TextOptions['font']
}

/** States for pages of memory. */
export const PAGE_STATES = {
    /** No page behind the address. */
    absent: { color: 'faint', fill: 0, dash: true },
    /** Reads as zeros, and has no page of its own yet. */
    zero: { color: 'dim', fill: 0.25 },
    /** In memory. The same color as `file`, and stronger: the same content, now in memory. */
    present: { color: 'purple', fill: 0.7 },
    /** Changed since it was last written out. */
    dirty: { color: 'orange', fill: 0.8 },
    /** One copy that several owners read. */
    shared: { color: 'teal', fill: 0.6 },
    /** A private copy after a write. */
    copied: { color: 'green', fill: 0.8 },
    /** In a file, not in memory. */
    file: { color: 'purple', fill: 0.3 },
    /** In swap. */
    swapped: { color: 'red', fill: 0.3 },
} satisfies Record<string, GridState>

interface CellLook {
    paint: Paint
    fill: number
    dash: boolean
}

const LIMIT = 5000
// A change gives each cell this share of its time, at every count. The rest is the delay between cells.
const SHARE = 0.3

const cornerOf = (side: number) => Math.min(side / 2, Math.max(1, side * 0.16))

/**
 * The dashes of the outline of a cell. Four dashes fit each quarter of the outline, and one dash is centered
 * on each corner. So the four corners look the same, and a dashed cell still reads as a square.
 */
function dashesOf(side: number): { pattern: readonly number[]; offset: number } {
    const radius = cornerOf(side)
    const period = (side - 2 * radius + (Math.PI / 2) * radius) / 4
    // A dash is longer than the room after it, and that room is narrower than the default room between two cells.
    // With equal parts, the dashes of two neighbours read as pairs, and the grid reads as a lattice.
    const dash = period * 0.6
    // The outline starts after the top left corner, so the middle of that corner is an eighth of a circle before the start.
    return { pattern: [dash, period - dash], offset: (Math.PI / 4) * radius + dash / 2 }
}

/** A rounded square with the look of a state. The grid and its legend draw the same cell at two sizes. */
function cellOf(side: number, look: CellLook): Node {
    const dashes = dashesOf(side)
    const made = rect(side, side, { radius: cornerOf(side), fill: look.paint, stroke: look.paint, width: Math.max(1, Math.min(3, side * 0.055)) })
    made.set('fillOpacity', look.fill)
    // The ends are flat, because a round end makes a dash longer than its pattern says. The offset stays when
    // the dashes go, so a later state can bring them back.
    made.set('cap', 'butt')
    made.set('dashOffset', dashes.offset)
    if (look.dash) made.set('dash', dashes.pattern)
    return made
}

/**
 * A grid of cells, each in a named state: pages of memory, blocks of a disk, the bits of a bitmap, the hosts
 * of a fleet. The state sets the look of the cell. `change()` moves cells to another state as a sweep, and
 * `count()`, `stateOf()` and `indexes()` read the states, so a number beside the grid can follow it. `enter()`
 * brings the cells in row by row, and `legend()` makes the key. `.at()` places the middle of the grid.
 */
export class StateGrid extends Node {
    /** One rounded square per cell, row by row. The cell of a row and a column has the index `row * columns + column`. */
    readonly cells: Node[] = []
    readonly columns: number
    readonly rows: number
    /** The number of cells. */
    readonly size: number
    private readonly side: number
    private readonly pitch: number
    private readonly names: string[]
    private readonly looks = new Map<string, CellLook>()
    /** The state of each cell. A change replaces the list, so a clone keeps the states that it was made with. */
    private now: readonly string[]

    constructor(options: StateGridOptions) {
        super()
        for (const name of ['columns', 'rows'] as const) {
            if (!Number.isInteger(options[name]) || options[name] < 1) throw new Error(`stateGrid: ${name} is ${options[name]}. Give a whole number, 1 or more`)
        }
        this.columns = options.columns
        this.rows = options.rows
        this.size = this.columns * this.rows
        if (this.size > LIMIT) throw new Error(`stateGrid: ${this.columns} by ${this.rows} is ${this.size} cells, and a grid draws ${LIMIT} at most. Let one cell stand for more than one unit, and say so in a label`)
        this.side = options.cell ?? 28
        if (!(Number.isFinite(this.side) && this.side > 0)) throw new Error('stateGrid: cell is the side of one cell, more than 0')
        const gap = options.gap ?? Math.max(3, Math.round(this.side * 0.18))
        if (!(Number.isFinite(gap) && gap >= 0)) throw new Error('stateGrid: gap is the room between two cells, 0 or more')
        this.pitch = this.side + gap

        const states: Record<string, GridState> = options.states ?? PAGE_STATES
        this.names = Object.keys(states)
        if (this.names.length === 0) throw new Error('stateGrid: give it at least one state')
        for (const name of this.names) {
            const { color, fill = 0.7, dash = false } = states[name]!
            if (!(fill >= 0 && fill <= 1)) throw new Error(`stateGrid: the fill of the state ${JSON.stringify(name)} is ${fill}. A fill is an opacity, 0 to 1`)
            this.looks.set(name, { paint: toPaint(color), fill, dash })
        }

        const initial = options.initial ?? this.names[0]!
        if (typeof initial === 'object' && initial.length !== this.size) throw new Error(`stateGrid: the initial list has a length of ${initial.length}, and the number of cells is ${this.size}. Give one name for each cell`)
        const now: string[] = []
        for (let index = 0; index < this.size; index++) {
            const state = typeof initial === 'string' ? initial : typeof initial === 'function' ? initial(index) : initial[index]!
            const cell = cellOf(this.side, this.look(state)).at(this.p(index))
            now.push(state)
            this.cells.push(cell)
            this.add(cell)
        }
        this.now = now
    }

    /** The middle of a cell, in the coordinates of the grid. */
    p(index: number): [number, number] {
        this.checked(index)
        const extent = (cells: number) => (cells - 1) * this.pitch + this.side
        // The grid starts on a whole pixel. With a `cell` and a `gap` that are whole numbers, every edge is sharp.
        const first = (cells: number) => Math.round(-extent(cells) / 2) + this.side / 2
        return [first(this.columns) + (index % this.columns) * this.pitch, first(this.rows) + Math.floor(index / this.columns) * this.pitch]
    }

    /** The state of a cell, after the changes that are scheduled so far. */
    stateOf(index: number): string {
        return this.now[this.checked(index)]!
    }

    /** The number of cells in a state, after the changes that are scheduled so far. */
    count(state: string): number {
        return this.indexes(state).length
    }

    /** The cells in a state, by index, after the changes that are scheduled so far. */
    indexes(state: string): number[] {
        this.look(state)
        const out: number[] = []
        this.now.forEach((own, index) => {
            if (own === state) out.push(index)
        })
        return out
    }

    /** The cells arrive row by row, from the top. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'stateGrid.enter', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                // A grid in a group or a zone that is not on stage brings it, and keeps its place there. The
                // grid shows from the start of its own time. In a sequence, that is later than the start of the play.
                let top: Node = this
                while (top.parent && top.parent !== ctx.stage.root) top = top.parent
                ctx.stage.mountAt(top, ctx.t0)
                reveal(this, ctx.t0, ctx.stage)
                const windows = staggered(this.rows, Math.max(0, options.lag ?? 0.25), ctx.t0, ctx.t1)
                this.cells.forEach((cell, index) => {
                    const [start, end] = windows[Math.floor(index / this.columns)]!
                    stepAt(cell, 'opacity', 0, ctx.t0)
                    cell.tween('opacity', 1, start, end, ctx.ease)
                })
            },
        }
    }

    /**
     * Cells go to another state. `which` is an index, a list of indexes, or a function of the index and the
     * state of a cell, which the grid calls when the change is scheduled. So a second change in one sequence
     * sees the states that the first one left. The cells change in index order, one after another, and the
     * whole change takes `duration`. A cell that already has the state does not change and takes no time.
     */
    change(which: number | readonly number[] | ((index: number, state: string) => boolean), state: string, options: AnimOptions = {}): Anim {
        // Find a wrong name or index now, where the film names it.
        const look = this.look(state)
        let test: (index: number, state: string) => boolean
        if (typeof which === 'function') {
            test = which
        } else {
            const listed = new Set(typeof which === 'number' ? [which] : which)
            for (const index of listed) this.checked(index)
            test = (index) => listed.has(index)
        }
        const pattern = look.dash ? dashesOf(this.side).pattern : null
        return {
            label: 'stateGrid.change', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                const chosen = this.now.flatMap((own, index) => (own !== state && test(index, own) ? [index] : []))
                if (chosen.length === 0) return
                const next = [...this.now]
                for (const index of chosen) next[index] = state
                this.now = next
                const lag = options.lag ?? Math.min(1, (1 / SHARE - 1) / Math.max(1, chosen.length - 1))
                const windows = staggered(chosen.length, Math.max(0, lag), ctx.t0, ctx.t1)
                chosen.forEach((index, order) => {
                    const cell = this.cells[index]!, [start, end] = windows[order]!
                    cell.tween('fill', look.paint, start, end, ctx.ease)
                    cell.tween('fillOpacity', look.fill, start, end, ctx.ease)
                    cell.tween('stroke', look.paint, start, end, ctx.ease)
                    // Dashes cannot fade to a line, so they switch when the colors are half way.
                    stepAt(cell, 'dash', pattern, (start + end) / 2)
                })
            },
        }
    }

    /**
     * A key for the states, in one row: a sample cell and a name for each. It is a new node, and not a child
     * of the grid. `.at(x, y)` places the left end of the row, and `y` is the middle line of the cells and
     * the names. `items` lists the states to show, each as a name or as a `[state, label]` pair. Without
     * `items`, the key shows the states that the grid has now, in the order of `states`.
     */
    legend(items?: readonly (string | readonly [state: string, label: string])[], options: GridLegendOptions = {}): Node {
        const size = options.size ?? 26
        if (!(Number.isFinite(size) && size > 0)) throw new Error('stateGrid: the size of the legend is a text size, more than 0')
        const gap = options.gap ?? size * 1.3
        if (!(Number.isFinite(gap) && gap >= 0)) throw new Error('stateGrid: the gap of the legend is the room between a name and the next cell, 0 or more')
        const list = items ?? this.names.filter((name) => this.now.includes(name))
        if (list.length === 0) throw new Error('stateGrid: give the legend at least one state')
        // An even side puts the top and the bottom of a sample cell on whole pixels.
        const side = 2 * Math.round(size * 0.425), room = size * 0.45
        const made = new Node()
        let left = 0
        for (const item of list) {
            const [state, label] = typeof item === 'string' ? [item, item] : item
            const sample = cellOf(side, this.look(state)).at(left + side / 2, 0)
            const name = text(label, { size, font: options.font, color: 'dim', anchor: 'left' })
            // Place the ink of the name, not its box, so the room on each side of a name is the same for every name.
            const ink = name.bounds()
            name.at(left + side + room - ink.x, 0)
            made.add(new Node().add(sample, name))
            left += side + room + ink.width + gap
        }
        return made
    }

    private checked(index: number): number {
        if (!Number.isInteger(index) || index < 0 || index >= this.size) throw new Error(`stateGrid: no cell ${index}. The cells of this grid are 0 to ${this.size - 1}`)
        return index
    }

    private look(state: string): CellLook {
        const look = this.looks.get(state)
        if (!look) throw new Error(`stateGrid: no state ${JSON.stringify(state)}. The states are ${this.names.join(', ')}`)
        return look
    }
}

/** A grid of cells in named states: `stateGrid({ columns: 16, rows: 8, initial: 'absent' })`, then `grid.change([3, 4, 5], 'present')`. */
export function stateGrid(options: StateGridOptions): StateGrid {
    return new StateGrid(options)
}
