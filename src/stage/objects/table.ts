import { DEFAULT_PROPS, Node, ownLabels, type NodeProps, type PropName } from '../node'
import { rectPath, type Path } from '../geometry'
import { toPaint, type ColorInput, type Paint } from '../color'
import { circle, dot, line, polyline, rect, svgPath } from '../shapes'
import { filmFont, text, type TextNode, type TextOptions } from '../text'
import { fontFor } from '../font'
import type { Ease } from '../ease'
import { Track, type Key } from '../track'
import type { Anim, AnimContext, AnimOptions } from '../anim'
import { Box } from '../layout'
import { reveal, staggered, stepAt } from './util'

type Id = number | string
type Align = 'left' | 'right' | 'center'
type Font = TextOptions['font']

/** The shape that a state draws in a cell, so that a viewer can tell two states with no color. */
export type TableMark = 'check' | 'cross' | 'ring' | 'dot' | 'dash' | 'bang'

/** What a cell holds: a text, a number, or nothing yet. */
export type TableValue = string | number | null

/**
 * A cell as a film gives it: its value, or its value and its state. In `setCell`, a part that is not given
 * stays: `{ state: 'pass' }` keeps the value, and a value alone keeps the state.
 */
export type TableCell = TableValue | { value?: TableValue; state?: string | null }

export interface TableState {
    /** The color of the mark and of the text of the cell. */
    color: ColorInput
    /** The shape before the text. Defaults to dot. */
    mark?: TableMark
}

/** A row as a function of a film gets it, in `find`, `remove`, `sort` and the `total` of a column. */
export interface TableRowView {
    id: Id
    /** The place of the row in the table, 0 at the top. */
    index: number
    /** The value of each cell, by the key of its column. */
    values: Readonly<Record<string, TableValue>>
    /** The state of each cell, by the key of its column, or null. */
    states: Readonly<Record<string, string | null>>
}

export interface TableColumn {
    /** The name of the column in a row: `{ id: 'R1', score: 0.91 }` fills the column with the key `score`. The key `id` shows the ids. */
    key: string
    /** The text of the header. Defaults to the key. */
    label?: string
    /** Defaults to right for a column whose first rows hold numbers, and to left. */
    align?: Align
    /**
     * Set the texts of the column in mono, for an id or code. A number is in mono without it, so digits line
     * up. With false, numbers take the font of the texts. In the total row, only a number is in mono.
     */
    mono?: boolean
    /**
     * A value that the column keeps room for: the longest text or the largest number that it gets later. The
     * columns are set once, from the header and the first rows, so a column that gets a wider value later
     * needs it. It follows the text size, as a width in pixels does not.
     */
    sample?: TableValue
    /**
     * The room of the content of a cell in pixels: its mark and its text. Use it for a column that holds a
     * node of the film, such as a small bar. With it, the column does not measure its rows.
     */
    width?: number
    /** Keep room for the mark of a state in each cell. Defaults to true when a cell of the first rows has a state. */
    marks?: boolean
    /** How to write a number. Defaults to its plain text. */
    format?: (value: number) => string
    /**
     * The cell of this column in the total row, which follows the rows: `'sum'` adds the numbers of the
     * column, and a function writes the cell from the rows that the table has. The table has a total row when
     * a column has a total. A fixed text is a function too: `() => 'passed'`.
     */
    total?: 'sum' | ((rows: readonly TableRowView[]) => TableCell)
}

/** One row: its identity, and a cell for each column by the key of the column. A column that the row does not name is empty. */
export interface TableRow {
    id: Id
    [column: string]: TableCell
}

export interface TableOptions {
    /** The width of the panel. Defaults to the width that the columns need. A larger width spreads the columns. */
    width?: number
    /**
     * The most rows that the table holds at one time. The table keeps room for that many: the layout measures
     * that room, `.at()` places its middle, and one row more is an error. Defaults to the number of the first rows.
     */
    maxRows?: number
    /** Text size. Defaults to 28. */
    size?: number
    /** The height of a row, as a part of `size`. Defaults to 1.9. */
    leading?: number
    /** The states and their looks. Defaults to TABLE_STATES. */
    states?: Record<string, TableState>
    /** The color of the marker of `light()`. Defaults to yellow. */
    lightColor?: ColorInput
    /** The font of the header and the texts. Defaults to the font of the film. Numbers are in mono. */
    font?: Font
}

/** States for results and checks. Each has its own mark, so color is not the only sign. */
export const TABLE_STATES = {
    pass: { color: 'green', mark: 'check' },
    fail: { color: 'red', mark: 'cross' },
    /** True in part, or not supported: a third verdict beside pass and fail. */
    warn: { color: 'yellow', mark: 'bang' },
    /** No result yet. */
    pending: { color: 'dim', mark: 'ring' },
    /** The check did not run. */
    skip: { color: 'dim', mark: 'dash' },
} satisfies Record<string, TableState>

interface Look {
    paint: Paint
    mark: TableMark
}

/** One column as the table keeps it. */
interface Column {
    key: string
    label: string
    align: Align
    mono: boolean | undefined
    format: ((value: number) => string) | undefined
    total: TableColumn['total']
    marks: boolean
    /** The film gave the room of the column in pixels. An error then names a width, and not a sample. */
    fixed: boolean
    /** The two edges of the cells of the column. */
    left: number
    right: number
    /** The two ends of the room of the content, inside the cell. */
    from: number
    to: number
}

/** What a cell holds: the data of the table. */
interface Fact {
    value: TableValue
    state: string | null
}

/** A row as data: the table replays its changes on such rows to write the total over time. */
interface Data {
    id: Id
    cells: Fact[]
}

/** One cell as the table keeps it. */
interface Slot extends Fact {
    node: TableCellNode
    /** The text that the cell shows, and its node. */
    words: string | null
    text: Node | null
    /** The last change of the cell, with its times. The next one starts after it. */
    last: { call: string; t0: number; t1: number } | null
}

interface Entry {
    id: Id
    node: TableRowNode
    cells: Slot[]
    /** The place of the row among all rows that the table made. Of two cards with one `z`, the later one is drawn over the other. */
    made: number
    /** Each `enter()` of the table that brought the row: from `t0` the row is away, and it comes from `start` to `end`. */
    enters: { t0: number; start: number; end: number; ease: Ease }[]
}

/** What the marker of `light()` is on: a row, a column, or the cell of both. */
interface Target {
    row: Entry | null
    column: number | null
}

/** One call of `light()`: the marker goes to a target over a time, from where it is. */
interface Spot {
    t0: number
    t1: number
    ease: Ease
    target: Target | null
}

/** The cell of a total: it shows one text at a time, and each text is made once and kept. */
interface Words {
    column: number
    holder: TableCellNode
    made: Map<string, Node>
    /** The text from each time that the total changes, in the order of time. The first step is the total at the start. */
    steps: { time: number; node: Node | null }[]
}

type Edges = [left: number, top: number, right: number, bottom: number]

// A new row comes from this part of a row under its place. The panel grows first, so the row is inside it.
const RISE = 0.2
// The opacity of the fill of the marker of the light: with a line around it, and alone.
const MARKER_FILL = 0.16
const MARKER_ALONE = 0.26
// The least clear room between the line of the marker and the ink of a row, as a part of the text size. With
// less, the marker has no line.
const MARKER_CLEAR = 0.15
// A time that no film reaches, as a power of two. A key from 0 to this time gets each frame time back exactly,
// so the marker can read where its row is at that frame.
const FOREVER = 2 ** 20
// Two times nearer than this are one time: the end of one animation is the start of the next.
const SOON = 1e-9
const MARKS: readonly TableMark[] = ['check', 'cross', 'ring', 'dot', 'dash', 'bang']
const ALIGNS: readonly Align[] = ['left', 'right', 'center']
const SIDES = ['left', 'right', 'top', 'bottom', 'center'] as const

const clamp = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value)
/** A number as an error writes it: three decimals at most. */
const short = (value: number) => String(Math.round(value * 1000) / 1000)
const show = (id: Id) => (typeof id === 'string' ? JSON.stringify(id) : String(id))
const seconds = (time: number) => `${Math.round(time * 100) / 100} s`
/** The advance width of a text. It includes the side bearings, so digits line up. */
const advance = (node: Node) => (node.layoutBox ? node.layoutBox[2] - node.layoutBox[0] : node.bounds().width)
/** A property of a node at a time, with no change of the clock: a key reads it while the clock is at a frame. */
const readAt = <K extends PropName>(node: Node, prop: K, time: number): NodeProps[K] => {
    const track = node.tracks?.get(prop)
    return track ? track.sample(time) as NodeProps[K] : node.base[prop]
}
/** A key whose value at each frame is a function of the time of that frame. */
const always = <T>(read: (time: number) => T, last: T): Key<T> => ({ t0: 0, t1: FOREVER, ease: null, to: last, at: (alpha) => read(alpha * FOREVER) })

const INK = new Map<string, number>()
/**
 * How far the ink of a font goes over or under the point that `text()` places, as a part of the text size: the
 * larger of the two. It is read from the printable ASCII characters, so the room around a row holds for any
 * such text.
 */
function inkOf(font: Font): number {
    const key = font ?? 'sans'
    let known = INK.get(key)
    if (known === undefined) {
        const box = text(Array.from({ length: 94 }, (_, index) => String.fromCharCode(33 + index)).join(''), { font, size: 100, anchor: 'left' }).bounds()
        INK.set(key, known = Math.max(-box.y, box.y + box.height) / 100)
    }
    return known
}

function oneLine(what: string, value: string): void {
    if (/[\n\r\t]/.test(value)) throw new Error(`table: ${what} has a line break or a tab. A cell holds one line of text`)
}

/** A `duration` and a `lag` are numbers, 0 or more. One that is not a number would lose rows with no error. */
function timed(call: string, options: AnimOptions): void {
    for (const key of ['duration', 'lag'] as const) {
        const value = options[key]
        if (value !== undefined && !(Number.isFinite(value) && value >= 0)) throw new Error(`table: the ${key} of ${call} is ${String(value)}. Give a number, 0 or more`)
    }
}

/** The times of an animation. A time that is not a number would write keys that no frame finds. */
function times(ctx: AnimContext, call: string): [number, number] {
    if (!(Number.isFinite(ctx.t0) && Number.isFinite(ctx.t1) && ctx.t1 >= ctx.t0)) throw new Error(`table: ${call} plays from ${String(ctx.t0)} to ${String(ctx.t1)}. Give the play a duration that is a number, 0 or more`)
    return [ctx.t0, ctx.t1]
}

/**
 * One cell of a `Table`. Its origin is the middle of the cell, and `box` is its room, so a film or another
 * object can add a node of its own to it, such as a small bar: the node then moves and fades with the row.
 */
export class TableCellNode extends Node {
    /** The holder of the mark of the state, at the place of the mark. */
    readonly mark = new Node()
    /** The holder of the text. */
    readonly words = new Node()

    constructor(
        /** The room of the cell, in its own coordinates: left, top, right and bottom. */
        readonly box: readonly [left: number, top: number, right: number, bottom: number],
    ) {
        super()
        this.add(this.mark, this.words)
    }
}

/** One row of a `Table`: a row of the body, or the total row. It keeps its identity while it moves. */
export class TableRowNode extends Node {
    /**
     * The holder of the card and the cells. Its opacity belongs to the table: `enter()` brings it in, and it
     * goes while a row that a sort moves is over it. To fade a row in a film, fade the row itself.
     */
    readonly content = new Node()
    /** One cell for each column, from the left. */
    readonly cells: TableCellNode[] = []

    constructor(
        /** The id of the row, or null for the total row. */
        readonly rowId: Id | null,
        /**
         * A card behind the cells, in the color of the panel. It shows only while a sort moves the row, so
         * that a row which passes another one hides it, and no two texts are read through each other. Null
         * for the total row.
         */
        readonly backing: Node | null = null,
    ) {
        super()
        if (backing) this.content.add(backing)
        this.add(this.content)
    }
}

/**
 * A table with a header, named columns, and rows that have an identity: the cases of an evaluation, the
 * candidates of a choice, the records of a ledger. A cell holds a text or a number, and it can have a state,
 * which gives it a color and a mark. `light()` moves one marker to a row, a column or a cell, `setCell()`
 * changes a cell in place, `append()` and `remove()` change the rows, and `sort()` and `moveRow()` change
 * their order. A row keeps its node through all of it. A column with a `total` gives the table a total row,
 * which follows the rows at every frame. The panel is as high as its rows: its bottom edge follows them when
 * rows arrive or leave, and its header stays where it is. The table keeps room for `maxRows` rows: the layout
 * measures that room, and `.at()` places its middle. The table changes its rows one change at a time, and a
 * cell takes one change at a time: two whose times overlap are an error.
 */
export class Table extends Node {
    /** The panel: its fill and its border. Its bottom edge follows the rows. */
    readonly frame: Node
    /** The line under the header, and the line over the total row when the table has one. */
    readonly rules: Node[] = []
    /** The faint lines between the rows. A line shows while the table has a row under it. */
    readonly lines: Node[] = []
    /** The text of each header, from the left. */
    readonly headers: Node[] = []
    /**
     * What `light()` moves: a faint fill with a line around it, over a row, a column or a cell. With rows that
     * are lower than about 1.75 text sizes it has no line, because the line would be at the ink of the text.
     */
    readonly marker: Node
    /** The total row, or null for a table with no total. */
    readonly totals: TableRowNode | null
    /** The distance from one row to the next. */
    readonly pitch: number
    /**
     * The holder of the rows. A light of the library that stays inside it dims the other rows and nothing
     * else: `spotlight(table.find(test).map((id) => table.row(id)), { within: table.body })`.
     */
    readonly body = new Node()
    /** The holder of the lines between the rows. `enter()` fades it, and each line shows by the rows that the table has. */
    private readonly grid = new Node()
    /** How many rows the panel has room for at each time. It follows the rows that arrive and leave. */
    private readonly filled: Track<number>
    /** The times in which rows move to other places. The lines between the rows are away then. */
    private moves: [number, number][] = []
    private readonly w: number
    private readonly h: number
    private readonly size: number
    private readonly slots: number
    /** The y of the middle of the header, and of the middle of the first row. */
    private readonly head: number
    private readonly first: number
    private readonly font: Font
    /** How far under the middle of a row a text in mono goes, to stand on the base line of the texts. */
    private readonly monoDrop: number
    /** The half width of a mark, the width of its line, and the room that a mark takes before a text. */
    private readonly markR: number
    private readonly markLine: number
    private readonly markGap: number
    private readonly cols: Column[] = []
    private readonly looks = new Map<string, Look>()
    private readonly names: string[]
    /** The options that the table was made with, for a copy. */
    private readonly options: TableOptions
    /** The bookkeeping. The animations change it when they are scheduled, so two changes in one sequence chain. */
    private order: Entry[] = []
    private byId = new Map<string, Entry>()
    /** Every row that the table has made, also those that left. A row that moves reads where the others are. */
    private every: Entry[] = []
    /** The rows at the start, and each change of the data with its time. The total is written from them, in the order of time. */
    private readonly origin: Data[]
    private changes: { time: number; apply: (rows: Data[]) => void }[] = []
    private readonly sums: Words[] = []
    /** The last change of the rows, with its times. The next one starts after it. */
    private last: { call: string; append: boolean; t0: number; t1: number } | null = null
    /** Each call of `light()`, in the order of time, and what the marker is on after the calls so far. */
    private spots: Spot[] = []
    private on: Target | null = null

    constructor(columns: readonly (string | TableColumn)[], rows: readonly TableRow[] = [], options: TableOptions = {}) {
        super()
        this.options = options
        const size = this.size = options.size ?? 28
        if (!(Number.isFinite(size) && size > 0)) throw new Error('table: size is a text size, more than 0')
        const leading = options.leading ?? 1.9
        // With less than this, the ink of one row comes too near the ink of the next.
        if (!(Number.isFinite(leading) && leading >= 1.4)) throw new Error(`table: leading is ${String(options.leading)}. It is the height of a row as a part of the text size, 1.4 or more: the ink of a row, and a little room`)
        this.pitch = size * leading
        if (!Array.isArray(columns) || columns.length === 0) throw new Error("table: give it at least one column, such as table(['case', 'score'], rows)")
        if (!Array.isArray(rows)) throw new Error('table: the second argument is the list of the first rows. Give [] for a table that starts with no row')
        const states: Record<string, TableState> = options.states ?? TABLE_STATES
        this.names = Object.keys(states)
        if (this.names.length === 0) throw new Error('table: give it at least one state')
        for (const name of this.names) {
            const mark = states[name]!.mark ?? 'dot'
            if (!MARKS.includes(mark)) throw new Error(`table: the mark of the state ${JSON.stringify(name)} is ${JSON.stringify(mark)}. A mark is ${MARKS.map((kind) => `'${kind}'`).join(', ')}`)
            this.looks.set(name, { paint: this.paintOf(states[name]!.color, `the color of the state ${JSON.stringify(name)}`), mark })
        }
        const lightColor = this.paintOf(options.lightColor ?? 'yellow', 'lightColor')

        const specs = columns.map((column) => (typeof column === 'string' ? { key: column } : column))
        specs.forEach((spec, index) => {
            if (typeof spec !== 'object' || spec === null || typeof spec.key !== 'string' || spec.key.trim() === '') throw new Error(`table: column ${index} has no key. A column is its key, such as 'score', or { key: 'score', label: 'score (%)' }`)
            if (specs.findIndex((other) => other.key === spec.key) !== index) throw new Error(`table: two columns have the key ${JSON.stringify(spec.key)}. Give each column its own key`)
            if (spec.align !== undefined && !ALIGNS.includes(spec.align)) throw new Error(`table: the align of the column ${JSON.stringify(spec.key)} is ${JSON.stringify(spec.align)}. It is 'left', 'right' or 'center'`)
            if (spec.width !== undefined && !(Number.isFinite(spec.width) && spec.width > 0)) throw new Error(`table: the width of the column ${JSON.stringify(spec.key)} is ${String(spec.width)}. It is the room of the content of a cell, more than 0`)
            if (spec.total !== undefined && spec.total !== 'sum' && typeof spec.total !== 'function') throw new Error(`table: the total of the column ${JSON.stringify(spec.key)} is ${JSON.stringify(spec.total)}. It is 'sum', or a function of the rows, such as (rows) => rows.length`)
            if (spec.label !== undefined) oneLine(`the label of the column ${JSON.stringify(spec.key)}`, spec.label)
            this.cols.push({ key: spec.key, label: spec.label ?? spec.key, align: 'left', mono: spec.mono, format: spec.format, total: spec.total, marks: false, fixed: spec.width !== undefined, left: 0, right: 0, from: 0, to: 0 })
        })
        const given = this.checked(rows)
        const slots = this.slots = options.maxRows ?? given.length
        if (!Number.isInteger(slots) || slots < 1) throw new Error(`table: maxRows is ${String(options.maxRows ?? given.length)}. It is the most rows that the table holds, a whole number, 1 or more. A table that starts with no row needs it`)
        if (given.length > slots) throw new Error(`table: the table starts with ${given.length} rows, and maxRows is ${slots}. Raise \`maxRows\` to ${given.length} or more`)

        // The font is taken once, where the table is made: the font that the table names, or the font of the film.
        // So a row that arrives later has the font of the first rows.
        const font = this.font = options.font ?? filmFont() ?? 'sans'
        const mono = fontFor('mono', 400), words = fontFor(font, 400)
        this.monoDrop = 0.36 * (words.ascent / words.unitsPerEm - mono.ascent / mono.unitsPerEm) * size
        // A mark is about as high as a capital letter, so a cell that holds only a mark reads from a distance.
        this.markR = size * 0.34
        this.markLine = Math.max(2, size * 0.11)
        this.markGap = size * 0.36

        // The columns are set once, from the header and the first rows, so that they line up over every row
        // that comes later.
        this.origin = given.map((row) => ({ id: row.id, cells: row.cells.map((cell) => ({ ...cell })) }))
        const padX = size * 0.7
        const needs = this.cols.map((col, at) => {
            const spec = specs[at]!
            const cells = given.map((row) => row.cells[at]!)
            const filled = cells.filter((cell) => cell.value !== null)
            col.align = spec.align ?? (filled.length > 0 && filled.every((cell) => typeof cell.value === 'number') ? 'right' : 'left')
            col.marks = spec.marks ?? cells.some((cell) => cell.state !== null)
            const header = advance(text(col.label, { font, size, weight: 600 }))
            if (spec.width !== undefined) {
                if (spec.width < header - 0.5) throw new Error(`table: the width of the column ${JSON.stringify(col.key)} is ${spec.width}, and its header ${JSON.stringify(col.label)} is ${Math.ceil(header)} px wide. Give a width of ${Math.ceil(header)} or more, or a shorter label`)
                return spec.width
            }
            const sum = col.total === undefined ? null : this.fact(this.totalOfRows(col, at, this.origin), `the total of the column ${JSON.stringify(col.key)}`)
            // A column gets room for marks when its total has a state too.
            if (spec.marks === undefined && sum?.state) col.marks = true
            const sample = spec.sample === undefined ? null : this.fact(spec.sample, `the sample of the column ${JSON.stringify(col.key)}`)
            if (sample?.state) throw new Error(`table: the sample of the column ${JSON.stringify(col.key)} has a state. A sample is a value: the longest text or the largest number that the column gets`)
            const content = (cell: Fact, bold: boolean) => {
                const said = this.say(col, cell.value)
                return said === null ? (col.marks ? this.markR * 2 : 0) : this.room(col) + this.widest(col, said, cell.value, bold)
            }
            // The sample of a column with a total has the room of the total row too, which is set in bold.
            return Math.max(header, ...cells.map((cell) => content(cell, false)), sum ? content(sum, true) : 0, sample ? Math.max(content(sample, false), col.total === undefined ? 0 : content(sample, true)) : 0)
        })
        const natural = needs.reduce((total, need) => total + need + padX * 2, 0)
        if (options.width !== undefined) {
            if (!(Number.isFinite(options.width) && options.width > 0)) throw new Error('table: width is the width of the panel, more than 0')
            if (options.width < natural - 0.5) throw new Error(`table: the columns need ${Math.ceil(natural)} px, and \`width\` is ${options.width}. Give a width of ${Math.ceil(natural)} or more, a smaller \`size\`, or shorter texts`)
        }
        const w = this.w = options.width ?? natural
        const spare = (w - natural) / this.cols.length
        let x = -w / 2
        this.cols.forEach((col, at) => {
            const need = needs[at]!
            col.left = x
            col.right = x += need + padX * 2 + spare
            // A column that is wider than its content keeps the content at its side: at the left, at the right, or in the middle.
            const [inner, end] = [col.left + padX, col.right - padX]
            col.from = col.align === 'left' ? inner : col.align === 'right' ? end - need : (inner + end - need) / 2
            col.to = col.from + need
        })

        const padY = size * 0.2
        const border = Math.max(1.5, size * 0.075)
        // The header, and the total row when the table has one.
        const fixed = this.cols.some((col) => col.total !== undefined) ? 2 : 1
        const h = this.h = padY * 2 + this.pitch * (fixed + slots)
        const top = -h / 2
        this.head = top + padY + this.pitch / 2
        this.first = this.head + this.pitch
        this.filled = new Track<number>(given.length)
        // The panel ends under its last row. Its top is fixed, so the header does not move when a row arrives or leaves.
        this.frame = new Node().fill('surface').stroke('grid', border)
        this.frame.track('path').add(always<Path | null>((time) => rectPath(-w / 2, top, w, padY * 2 + this.pitch * (fixed + this.filled.sample(time)), size * 0.45), null))
        this.add(this.frame, this.grid)
        // A line goes from the inside of the border at the left to the inside of the border at the right.
        const rule = (y: number, stroke: ColorInput, width: number) => {
            const made = line([-w / 2 + border / 2, 0], [w / 2 - border / 2, 0], { stroke, width }).at(0, y)
            made.set('cap', 'butt')
            return made
        }
        for (let slot = 1; slot < slots; slot++) {
            const made = rule(this.y(slot) - this.pitch / 2, 'grid', Math.max(1, size * 0.04))
            // The line over a row shows when the table has that row, and while the rows are at rest.
            made.track('opacity').add(always((time) => clamp(this.filled.sample(time) - slot) * this.calm(time), 0))
            this.lines.push(made)
            this.grid.add(made)
        }

        // The marker is a faint fill with a line around it, so a text reads through it. It is over the rows: a row
        // that a sort moves has a card behind it, and the marker stays on that card. In a table with low rows,
        // the line would be at the ink of the text. The marker is then a fill with no line, a little stronger.
        const stroke = Math.max(2, size * 0.085)
        const lined = this.pitch / 2 - Math.max(2, size * 0.1) - stroke / 2 - Math.max(inkOf(font), inkOf('mono')) * size >= size * MARKER_CLEAR
        this.marker = new Node().fill(lightColor, lined ? MARKER_FILL : MARKER_ALONE).stroke(lightColor, stroke)
        this.marker.track('path').add(always<Path | null>((time) => this.markerPath(time), null))
        this.marker.track('opacity').add(always((time) => this.beam(time).strength, 0))
        this.marker.track('strokeOpacity').add(always((time) => (lined ? this.beam(time).line : 0), 1))
        this.marker.track('visible').add(always((time) => this.beam(time).strength > 0, false))

        this.rules.push(rule(this.first - this.pitch / 2, 'gridStrong', border))
        this.add(this.rules[0]!)
        this.cols.forEach((col) => {
            const at = col.align === 'left' ? col.from : col.align === 'right' ? col.to : (col.from + col.to) / 2
            const header = text(col.label, { font, size, weight: 600, color: 'dim', anchor: col.align }).at(at, this.head)
            this.headers.push(header)
            this.add(header)
        })
        this.add(this.body)
        // The table places its header and each text of a cell in its panel, between its lines, and in the marker
        // of its light. The film check does not judge that room. A text gets the same mark when it is made.
        ownLabels(this, { name: 'table', labels: this.headers })

        given.forEach((row, slot) => {
            const entry = this.admit(row)
            entry.node.at(0, this.y(slot))
            this.order.push(entry)
        })

        this.totals = null
        if (this.cols.some((col) => col.total !== undefined)) {
            // The total row is under the last row at every frame, with its line over it.
            const over = rule(0, 'gridStrong', border)
            over.track('y').add(always((time) => this.y(this.filled.sample(time)) - this.pitch / 2, 0))
            this.rules.push(over)
            this.add(over)
            const node = this.totals = new TableRowNode(null)
            node.track('y').add(always((time) => this.y(this.filled.sample(time)), 0))
            this.cols.forEach((col, at) => {
                const cell = this.cellNode(col)
                node.cells.push(cell)
                node.content.add(cell)
                if (col.total === undefined) return
                const words: Words = { column: at, holder: cell, made: new Map(), steps: [] }
                this.sums.push(words)
            })
            this.add(node)
            this.retotal()
        }
        this.add(this.marker)
        // The layout measures the room of the table with `maxRows` rows, so a row that arrives or leaves does not change the measure.
        this.layoutBox = [-w / 2, -h / 2, w / 2, h / 2]
    }

    /** The nodes of the rows, from the top, after the changes that are scheduled so far. */
    get rows(): TableRowNode[] {
        return this.order.map((entry) => entry.node)
    }

    /** The number of rows, after the changes that are scheduled so far. */
    get count(): number {
        return this.order.length
    }

    /** The ids of the rows, from the top, after the changes that are scheduled so far. */
    get ids(): Id[] {
        return this.order.map((entry) => entry.id)
    }

    /** What the marker of `light()` is on after the changes that are scheduled so far, or null: a row, a column, or both for a cell. */
    get lit(): { row: Id | null; column: string | null } | null {
        return this.on && { row: this.on.row?.id ?? null, column: this.on.column === null ? null : this.cols[this.on.column]!.key }
    }

    /** The ids of the rows that a function picks, from the top, after the changes that are scheduled so far. */
    find(test: (row: TableRowView) => boolean): Id[] {
        return this.views().filter((row) => test(row)).map((row) => row.id)
    }

    /** The value of a cell, after the changes that are scheduled so far. */
    value(row: Id, column: string): TableValue {
        return this.entry(row).cells[this.col(column)]!.value
    }

    /** The state of a cell, or null, after the changes that are scheduled so far. */
    stateOf(row: Id, column: string): string | null {
        return this.entry(row).cells[this.col(column)]!.state
    }

    /** The value of the total of a column, after the changes that are scheduled so far. */
    totalOf(column: string): TableValue {
        const at = this.col(column), col = this.cols[at]!
        if (col.total === undefined) throw new Error(`table: the column ${JSON.stringify(column)} has no total. Give it one where the table is made, such as { key: ${JSON.stringify(column)}, total: 'sum' }`)
        return this.fact(this.totalOfRows(col, at, this.records()), `the total of the column ${JSON.stringify(column)}`).value
    }

    /** The node of a row. It holds the cells of the row, and it follows the row when the row moves. */
    row(id: Id): TableRowNode {
        return this.entry(id).node
    }

    /** The node of a cell: its mark, its text, and what a film adds to it. */
    cell(row: Id, column: string): TableCellNode {
        return this.entry(row).cells[this.col(column)]!.node
    }

    /** The text of the header of a column. */
    header(column: string): Node {
        return this.headers[this.col(column)]!
    }

    /**
     * A point on the room of a row, a column or a cell, in the coordinates of the table: `p('R3')` is on the
     * left border of the panel at the height of the row, for a connector. Give a row, a column with null as
     * the row, or both for a cell. `side` is `'left'`, `'right'`, `'top'`, `'bottom'` or `'center'`. It is the
     * place after the changes that are scheduled so far, and it does not follow the row.
     */
    p(row: Id | null, column: string | null = null, side: typeof SIDES[number] = 'left'): [number, number] {
        if (!SIDES.includes(side)) throw new Error(`table: the side of p() is ${JSON.stringify(side)}. It is 'left', 'right', 'top', 'bottom' or 'center'`)
        const [left, top, right, bottom] = this.edges(row, column)
        return [side === 'left' ? left : side === 'right' ? right : (left + right) / 2, side === 'top' ? top : side === 'bottom' ? bottom : (top + bottom) / 2]
    }

    /**
     * The box of a part of the table, in stage pixels, for `place` and `beside` of the layout, and for the end
     * of an arrow: `table.region('R3', 'score').point('left')`. With no argument it is the room of the table:
     * its panel with `maxRows` rows. Give a row, a column with null as the row, or both for a cell. A column
     * goes from the top of the room to its bottom. The box is where the table and the row are now, so ask for
     * it after the table has its place.
     */
    region(row: Id | null = null, column: string | null = null): Box {
        const [left, top, right, bottom] = this.edges(row, column)
        const [x0, y0] = this.toWorld(left, top), [x1, y1] = this.toWorld(right, bottom)
        return new Box(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1))
    }

    /**
     * A copy with its own rows and its own bookkeeping, in the state that the table has now, so a change of
     * the copy does not change the table. A node that a film added to a cell is not in the copy.
     */
    override clone(): this {
        const rows = this.order.map((entry): TableRow => {
            const row: TableRow = { id: entry.id }
            this.cols.forEach((col, at) => {
                // The key `id` shows the id of the row, so the copy takes it from the id.
                if (col.key !== 'id') row[col.key] = { value: entry.cells[at]!.value, state: entry.cells[at]!.state }
            })
            return row
        })
        // The copy has the columns of the table as they are: the same widths, also for a text that came later.
        const columns = this.cols.map((col): TableColumn => ({ key: col.key, label: col.label, align: col.align, mono: col.mono, format: col.format, total: col.total, marks: col.marks, width: col.to - col.from }))
        const copy = new Table(columns, rows, { ...this.options, width: this.w, maxRows: this.slots, font: this.font }) as this
        for (const key of Object.keys(DEFAULT_PROPS) as PropName[]) (copy.base as unknown as Record<string, unknown>)[key] = this.get(key)
        copy.label = this.label
        if (this.on) {
            const target: Target = { row: this.on.row ? copy.byId.get(String(this.on.row.id)) ?? null : null, column: this.on.column }
            copy.spots.push({ t0: 0, t1: 0, ease: (share) => share, target })
            copy.on = target
        }
        return copy
    }

    /** The panel and the header arrive, and then the rows, from the top, and the total row. */
    enter(options: AnimOptions = {}): Anim {
        timed('enter()', options)
        return {
            label: 'table.enter', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = times(ctx, 'enter()')
                reveal(this, t0, ctx.stage)
                const span = t1 - t0
                // The lines between the rows come by their holder: each line shows by the rows that the table has.
                for (const part of [this.frame, this.grid, ...this.rules, ...this.headers]) {
                    stepAt(part, 'opacity', 0, t0)
                    part.tween('opacity', 1, t0, t0 + span * 0.4, ctx.ease)
                }
                // Each row comes by the holder of its cells. So an `append` or a `remove` in the same play, which
                // fades the row itself, is not lost.
                const windows = staggered(this.order.length + (this.totals ? 1 : 0), Math.max(0, options.lag ?? 0.35), t0 + span * 0.25, t1)
                this.order.forEach((entry, index) => entry.enters.push({ t0, start: windows[index]![0], end: windows[index]![1], ease: ctx.ease }))
                if (this.totals) {
                    const [start, end] = windows[this.order.length]!
                    stepAt(this.totals.content, 'opacity', 0, t0)
                    this.totals.content.tween('opacity', 1, start, end, ctx.ease)
                }
            },
        }
    }

    /**
     * The marker goes to a row, to a column, or to a cell, and stays there until the next `light`:
     * `light('R3')` is a row, `light(null, 'score')` a column, and `light('R3', 'score')` a cell.
     * `light(null)` takes the marker away. The marker is a faint fill with a line around it, and it glides from
     * one place to the next, with no line on its way. It is with its row at every frame: it moves with a row
     * that a sort moves, arrives with a row that arrives, and leaves with a row that leaves.
     */
    light(row: Id | null, column: string | null = null, options: AnimOptions = {}): Anim {
        timed('light()', options)
        const at = column === null ? null : this.col(column)
        return {
            label: 'table.light', duration: options.duration ?? 0.4, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = times(ctx, 'light()')
                reveal(this, t0, ctx.stage)
                const target: Target | null = row === null && at === null ? null : { row: row === null ? null : this.entry(row, true), column: at }
                this.spot({ t0, t1, ease: ctx.ease, target })
                this.on = target
            },
        }
    }

    /**
     * A cell changes in place: its value, its state, or both. A new text comes when the old one is gone, so no
     * moment shows two texts. A state gives the cell its color and its mark, and null takes the state away. A
     * part that is not given stays: `setCell('R3', 'old', { state: 'pass' })` keeps the value. The total row
     * follows. A text that is too wide for the column, and a state in a column with no room for a mark, are
     * errors where the film makes the change.
     */
    setCell(row: Id, column: string, cell: TableCell, options: AnimOptions = {}): Anim {
        const at = this.col(column), col = this.cols[at]!
        const call = `setCell(${show(row)}, ${JSON.stringify(column)})`
        const who = `row ${show(row)} in the column ${JSON.stringify(column)}`
        const parts = typeof cell === 'object' && cell !== null ? cell : { value: cell }
        // Find a wrong value now, where the film names it.
        const next = this.fact(cell, who)
        if (col.key === 'id' && 'value' in parts) throw new Error(`table: the column "id" shows the id of a row, and an id does not change. Give the table another column for a value that changes`)
        if ('state' in parts && next.state !== null) this.marked(col, next.state, who)
        if ('value' in parts) this.fits(col, next.value, who)
        timed(call, options)
        return {
            label: 'table.setCell', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = times(ctx, call)
                const slot = this.entry(row, true).cells[at]!
                const value = 'value' in parts ? next.value : slot.value, state = 'state' in parts ? next.state : slot.state
                if (value === slot.value && state === slot.state) return
                const last = slot.last
                if (last && t0 < last.t1 - SOON) {
                    throw new Error(`table: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. A cell takes one change at a time: a change starts when the change before it is over. ${t0 < last.t0 - SOON ? `Call ${call} before it` : 'Play the two in a `seq`, or give the first one a shorter `duration`'}`)
                }
                slot.last = { call, t0, t1 }
                reveal(this, t0, ctx.stage)
                this.paint(col, slot, { value, state }, t0, t1, ctx.ease)
                // The total follows the cell when the new text comes.
                const key = String(row)
                this.changed((t0 + t1) / 2, (rows) => {
                    const found = rows.find((other) => String(other.id) === key)
                    if (found) found.cells[at] = { value, state }
                })
            },
        }
    }

    /**
     * Rows arrive under the last row, one after another. `lag: 0` brings the rows of one call together. The
     * panel has room for `maxRows` rows: one more is an error that says so. An id that the table has is an
     * error.
     */
    append(rows: TableRow | readonly TableRow[], options: AnimOptions = {}): Anim {
        // Find a wrong row now, where the film names it. The ids and the room are checked when the rows arrive:
        // a change before this one in the same sequence may bring the same id, or take a row away.
        const given = this.checked(Array.isArray(rows) ? rows as readonly TableRow[] : [rows as TableRow])
        for (const row of given) this.suits(row)
        const call = `append([${given.map((row) => show(row.id)).join(', ')}])`
        timed(call, options)
        return {
            label: 'table.append', duration: options.duration ?? (given.length === 0 ? 0 : Math.max(0.5, given.length * 0.4)), ease: options.ease,
            schedule: (ctx) => {
                if (given.length === 0) return
                const [t0, t1] = times(ctx, call)
                for (const row of given) this.free(row.id)
                if (this.order.length + given.length > this.slots) {
                    throw new Error(`table: ${call} makes ${this.order.length + given.length} rows, and the panel has room for ${this.slots}. Raise \`maxRows\` to ${this.order.length + given.length} or more where the table is made, or remove a row first`)
                }
                this.claim(call, true, t0, t1)
                reveal(this, t0, ctx.stage)
                const lag = options.lag ?? 1
                const groups = lag === 0 ? [given] : given.map((row) => [row])
                const windows = staggered(groups.length, lag, t0, t1)
                groups.forEach((group, index) => {
                    const [start, end] = windows[index]!
                    for (const row of group) {
                        const entry = this.admit(row), node = entry.node
                        const y = this.y(this.order.length)
                        this.order.push(entry)
                        // The panel makes room first, and the row comes into that room. So the row is never outside the panel.
                        this.fillTo(this.order.length, start, start + (end - start) * 0.55, ctx.ease)
                        const from = start + (end - start) * 0.4
                        // A row is hidden until its time. On the stage, a node that is added shows from the time of the call.
                        stepAt(node, 'y', y + this.pitch * RISE, from)
                        stepAt(node, 'opacity', 0, from)
                        stepAt(node, 'visible', true, from)
                        node.tween('y', y, from, end, ctx.ease)
                        node.tween('opacity', 1, from, end, ctx.ease)
                        // The total counts a row when the row is half there.
                        const copy: Data = { id: row.id, cells: row.cells.map((cell) => ({ ...cell })) }
                        this.changed((start + end) / 2, (all) => { all.push({ id: copy.id, cells: copy.cells.map((cell) => ({ ...cell })) }) })
                    }
                })
            },
        }
    }

    /**
     * Rows leave: they fade, and the rows under them move up. `which` is an id, a list of ids, or a function
     * of a row, which the table calls when the change is scheduled. The node of a row that left stays hidden,
     * and its id is free again.
     */
    remove(which: Id | readonly Id[] | ((row: TableRowView) => boolean), options: AnimOptions = {}): Anim {
        const call = typeof which === 'function' ? 'remove()' : `remove([${(Array.isArray(which) ? which as readonly Id[] : [which as Id]).map(show).join(', ')}])`
        timed(call, options)
        return {
            label: 'table.remove', duration: options.duration ?? 0.7, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = times(ctx, call)
                const gone = new Set(typeof which === 'function' ? this.find(which).map((id) => this.entry(id)) : (Array.isArray(which) ? which as readonly Id[] : [which as Id]).map((id) => this.entry(id, true)))
                if (gone.size === 0) return
                this.claim(call, false, t0, t1)
                const next = this.order.filter((entry) => !gone.has(entry))
                const span = t1 - t0
                // The rows that stay start to move when the rows that leave are nearly gone, so no two texts share a
                // place. The panel gets lower with them.
                const out = t0 + span * 0.45, move = t0 + span * 0.35
                for (const entry of gone) {
                    entry.node.tween('opacity', 0, t0, out, ctx.ease)
                    stepAt(entry.node, 'visible', false, out)
                    this.byId.delete(String(entry.id))
                }
                next.forEach((entry, slot) => {
                    if (this.order[slot] !== entry) entry.node.tween('y', this.y(slot), move, t1, ctx.ease)
                })
                if (next.some((entry, slot) => this.order[slot] !== entry)) this.moves.push([move, t1])
                this.fillTo(next.length, move, t1, ctx.ease)
                this.order = next
                // The marker leaves with its row. The row does not come back, and the marker does not stay at an empty place.
                if (this.on?.row && gone.has(this.on.row)) {
                    this.spot({ t0: out, t1: out, ease: ctx.ease, target: null })
                    this.on = null
                }
                const keys = new Set([...gone].map((entry) => String(entry.id)))
                this.changed(out, (rows) => {
                    for (let index = rows.length - 1; index >= 0; index--) if (keys.has(String(rows[index]!.id))) rows.splice(index, 1)
                })
            },
        }
    }

    /**
     * The rows take a new order, and each row moves to its new place with its node. `by` is the key of a
     * column, or a function that compares two rows, as `Array.sort` takes. A column sorts numbers by size and
     * texts by their letters, and an empty cell goes last. `descending: true` turns the order of a column. Rows
     * that compare as equal keep their order.
     */
    sort(by: string | ((a: TableRowView, b: TableRowView) => number), options: AnimOptions & { descending?: boolean } = {}): Anim {
        const at = typeof by === 'string' ? this.col(by) : null
        if (at === null && typeof by !== 'function') throw new Error(`table: sort takes the key of a column, or a function that compares two rows, and it got ${String(by)}`)
        const call = typeof by === 'string' ? `sort(${JSON.stringify(by)})` : 'sort()'
        timed(call, options)
        return {
            label: 'table.sort', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = times(ctx, call)
                const views = this.views()
                const key = typeof by === 'string' ? by : ''
                const way = options.descending ? -1 : 1
                const compare = typeof by === 'function' ? by : (a: TableRowView, b: TableRowView) => {
                    const one = a.values[key] ?? null, other = b.values[key] ?? null
                    if (one === null || other === null) return one === other ? 0 : one === null ? 1 : -1
                    if (typeof one === 'number' && typeof other === 'number') return way * (one - other)
                    // A number goes before a text, so a column that holds both has one order.
                    if (typeof one !== typeof other) return way * (typeof one === 'number' ? -1 : 1)
                    return way * (String(one) < String(other) ? -1 : String(one) > String(other) ? 1 : 0)
                }
                const sorted = [...views].sort((a, b) => {
                    const result = compare(a, b)
                    if (typeof result !== 'number' || Number.isNaN(result)) throw new Error(`table: the function of ${call} returned ${String(result)} for the rows ${show(a.id)} and ${show(b.id)}. It returns a number: under 0 when the first row goes first, over 0 when it goes last, and 0 for two rows that are equal`)
                    return result
                })
                this.settle(call, sorted.map((view) => this.order[view.index]!), t0, t1, ctx)
            },
        }
    }

    /** One row moves to another place, 0 at the top, and the rows between the two places make room. */
    moveRow(id: Id, to: number, options: AnimOptions = {}): Anim {
        const call = `moveRow(${show(id)}, ${String(to)})`
        if (!Number.isInteger(to) || to < 0) throw new Error(`table: ${call}: the place of a row is a whole number, 0 for the first row`)
        timed(call, options)
        return {
            label: 'table.moveRow', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = times(ctx, call)
                const entry = this.entry(id, true)
                if (to >= this.order.length) throw new Error(`table: ${call}: the table has ${this.order.length} rows, so the last place is ${this.order.length - 1}`)
                const next = this.order.filter((other) => other !== entry)
                next.splice(to, 0, entry)
                this.settle(call, next, t0, t1, ctx)
            },
        }
    }

    /** The y of the middle of a row by its place, 0 at the top. */
    private y(slot: number): number {
        return this.first + slot * this.pitch
    }

    /** How much of a row `enter()` has brought at a time: all of it for a row that no `enter()` brought. */
    private arrival(entry: Entry, time: number): number {
        let last: Entry['enters'][number] | null = null
        for (const enter of entry.enters) if (enter.t0 <= time + SOON && (!last || enter.t0 >= last.t0)) last = enter
        if (!last || time >= last.end) return 1
        return time < last.start ? 0 : clamp(last.ease((time - last.start) / (last.end - last.start)))
    }

    /**
     * How much of the cells of a row shows under the rows that a sort moves over it: none of them when the
     * card of such a row is at its text. A row that is partly behind a card would show half letters, and the
     * border of the card would run through them. So the row goes as the card comes, and comes back when the
     * card has left. The card over all the others never goes.
     */
    private clear(entry: Entry, time: number): number {
        const z = readAt(entry.node, 'z', time), y = readAt(entry.node, 'y', time)
        // A card reaches the text of a row when their middles are this near: half of the card, and the ink of a text.
        const reach = this.pitch / 2 + this.size * 0.7
        const room = Math.max(this.size * 0.05, this.pitch - reach)
        let least = 1
        for (const other of this.every) {
            if (other === entry) continue
            const above = readAt(other.node, 'z', time)
            if (above <= 0 || above < z || (above === z && other.made < entry.made)) continue
            const card = readAt(other.node.backing!, 'opacity', time) * (readAt(other.node, 'visible', time) ? readAt(other.node, 'opacity', time) : 0)
            if (card <= 0) continue
            least = Math.min(least, 1 - card * (1 - clamp((Math.abs(readAt(other.node, 'y', time) - y) - reach) / room)))
        }
        return least
    }

    /**
     * How much of the lines between the rows shows at a time. The lines have fixed places, and a row that moves
     * passes them. So the lines go when rows start to move and come back when the rows are at their places:
     * no line passes through a text.
     */
    private calm(time: number): number {
        let least = 1
        for (const [from, to] of this.moves) {
            if (time <= from || time >= to) continue
            const edge = (to - from) * 0.2
            least = Math.min(least, edge > 0 ? clamp(Math.max(from + edge - time, time - (to - edge)) / edge) : 0)
        }
        return least
    }

    /** The panel takes the height of a number of rows over a time, from the height that it has. */
    private fillTo(rows: number, t0: number, t1: number, ease: Ease): void {
        const from = this.filled.sample(t0)
        this.filled.add({ t0, t1, ease, to: rows, at: (alpha) => from + (rows - from) * alpha })
    }

    private paintOf(color: ColorInput, what: string): Paint {
        try {
            return toPaint(color)
        } catch {
            throw new Error(`table: ${what} is ${JSON.stringify(color)}, which is not a color. Use a color of the look, such as 'green', or a CSS color`)
        }
    }

    /** The index of a column by its key. */
    private col(key: string): number {
        const at = this.cols.findIndex((col) => col.key === key)
        if (at < 0) throw new Error(`table: no column ${JSON.stringify(key)}. The columns are ${this.cols.map((col) => JSON.stringify(col.key)).join(', ')}`)
        return at
    }

    /**
     * The row of an id. `played` is for a call that the film plays: the table takes the calls of one play in
     * their order, so an `append` that brings the row must come before the call that names it.
     */
    private entry(id: Id, played = false): Entry {
        const entry = this.byId.get(String(id))
        if (entry) return entry
        const ids = this.order.map((other) => show(other.id))
        const known = ids.length === 0 ? 'The table has no row' : ids.length > 8 ? `The table has the rows ${ids.slice(0, 8).join(', ')}, and ${ids.length - 8} more` : `The table has the rows ${ids.join(', ')}`
        throw new Error(`table: no row has the id ${show(id)}. ${known}${played ? '. When an `append` in the same play brings the row, name the `append` before this call: the table takes the calls of a play in their order' : ''}`)
    }

    private free(id: Id): void {
        if (this.byId.has(String(id))) throw new Error(`table: the table already has a row with the id ${show(id)}. Give each row its own id`)
    }

    /** The look of a state, or an error that names the states. */
    private look(state: string): Look {
        const look = this.looks.get(state)
        if (!look) throw new Error(`table: no state ${JSON.stringify(state)}. The states are ${this.names.join(', ')}`)
        return look
    }

    /** A cell as the table keeps it: a value that is a text, a number or null, and a state that the table has. */
    private fact(cell: TableCell | undefined, who: string): Fact {
        const parts = typeof cell === 'object' && cell !== null ? cell : { value: cell }
        const unknown = Object.keys(parts).find((name) => name !== 'value' && name !== 'state')
        if (unknown !== undefined) throw new Error(`table: the cell of ${who} has the part "${unknown}". A cell is a value, or { value, state }`)
        let value = parts.value ?? null
        if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new Error(`table: the value of ${who} is ${JSON.stringify(value) ?? String(value)}. Give a text, a number, or null for an empty cell`)
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`table: the value of ${who} is ${String(value)}. A number of a cell is finite. Give null for a value that is not known yet`)
        if (typeof value === 'string') {
            oneLine(`the text of ${who}`, value)
            if (value === '') value = null
        }
        const state = parts.state ?? null
        if (state !== null) this.look(state)
        return { value, state }
    }

    /** The rows as the table keeps them: each with its id and a cell for each column, and no id that is there twice. */
    private checked(rows: readonly TableRow[]): { id: Id; cells: Fact[] }[] {
        const seen = new Set<string>()
        return rows.map((row, index) => {
            if (typeof row !== 'object' || row === null) throw new Error(`table: row ${index} is ${String(row)}. A row is an object with an id and its cells, such as { id: 'R1', score: 0.91 }`)
            const id = row.id
            if (!(typeof id === 'number' ? Number.isFinite(id) : typeof id === 'string' && id.trim() !== '')) throw new Error(`table: row ${index} has the id ${JSON.stringify(id) ?? String(id)}. Give each row an \`id\`, a number or a text: the table knows a row by it`)
            // An id is known by its text, so 7 and '7' are one id.
            const key = String(id)
            oneLine(`the id ${show(id)}`, key)
            if (seen.has(key)) throw new Error(`table: two rows have the id ${show(id)}. Give each row its own id`)
            seen.add(key)
            // A field that names no column would not show, and the film would not know.
            const stray = Object.keys(row).find((name) => name !== 'id' && !this.cols.some((col) => col.key === name))
            if (stray !== undefined) throw new Error(`table: row ${show(id)} has the field "${stray}", and the table has no such column. The columns are ${this.cols.map((col) => JSON.stringify(col.key)).join(', ')}`)
            return { id, cells: this.cols.map((col) => this.fact(row[col.key], `row ${show(id)} in the column ${JSON.stringify(col.key)}`)) }
        })
    }

    /** A row that comes later fits the columns as they are: each text in its room, and each state in a column with room for a mark. */
    private suits(row: { id: Id; cells: Fact[] }): void {
        this.cols.forEach((col, at) => {
            const cell = row.cells[at]!, who = `row ${show(row.id)} in the column ${JSON.stringify(col.key)}`
            if (cell.state !== null) this.marked(col, cell.state, who)
            this.fits(col, cell.value, who)
        })
    }

    /** A state needs a column that keeps room for a mark. */
    private marked(col: Column, state: string, who: string): void {
        if (!col.marks) throw new Error(`table: ${who} gets the state ${JSON.stringify(state)}, and the column has no room for the mark of a state. Give the column \`marks: true\` where the table is made, or give one of its first cells a state`)
    }

    /**
     * A text shows whole in the room of its column, or the cell is refused: a part of a value is another value.
     * A text may go a little into the room between two columns, by 0.35 of the text size, so a text that is a
     * few pixels wider than the first rows is not an error. `bold` is for the total row.
     */
    private fits(col: Column, value: TableValue, who: string, bold = false): void {
        const said = this.say(col, value)
        if (said === null) return
        const needs = advance(this.write(col, said, value, 'ink', bold)), has = col.to - col.from - this.room(col)
        if (needs <= has + this.size * 0.35 + 0.5) return
        const advice = col.fixed
            ? `Set the \`width\` of the column to ${Math.ceil(needs + this.room(col))} or more where the table is made`
            : `Give the column a \`sample\` where the table is made, the longest value that it gets, such as sample: ${JSON.stringify(value)}`
        throw new Error(`table: the text ${JSON.stringify(said)} of ${who} is ${Math.ceil(needs)} px wide, and the column has ${Math.floor(has)} px for a text. ${advice}, or use a shorter text`)
    }

    /**
     * The room that a text needs in a column that is set once: its width with each digit as wide as the widest
     * digit of the font. So "1 of 3" keeps room for "2 of 8", which a count becomes later.
     */
    private widest(col: Column, said: string, value: TableValue, bold: boolean): number {
        const made = this.write(col, said, value, 'ink', bold)
        if ((made as TextNode).font === 'mono' || !/\d/.test(said)) return advance(made)
        const digits = '0123456789'.split('').map((digit) => advance(this.write(col, digit, said, 'ink', bold)))
        const widest = String(digits.indexOf(Math.max(...digits)))
        return advance(this.write(col, said.replace(/\d/g, widest), said, 'ink', bold))
    }

    /** The room that a column keeps for a mark, before a text or after a number. */
    private room(col: Column): number {
        return col.marks ? this.markR * 2 + this.markGap : 0
    }

    /** The text of a value, or null for an empty cell. */
    private say(col: Column, value: TableValue): string | null {
        if (value === null) return null
        if (typeof value === 'string') return value
        if (!col.format) return String(value)
        const said = col.format(value)
        if (typeof said !== 'string') throw new Error(`table: the format of the column ${JSON.stringify(col.key)} returned ${String(said)} for ${value}. \`format\` returns a text`)
        oneLine(`the text of ${value} in the column ${JSON.stringify(col.key)}`, said)
        return said === '' ? null : said
    }

    /** The text of a cell, with its anchor at the side of its column. A number is in mono. */
    private write(col: Column, said: string, value: TableValue, color: ColorInput, bold: boolean): TextNode {
        // The total row is a summary: a label there is a text of the film, also in a column of ids or code.
        const mono = bold ? col.mono !== false && typeof value === 'number' : col.mono ?? typeof value === 'number'
        const made = text(said, { font: mono ? 'mono' : this.font, size: this.size, color, weight: bold ? 600 : 400, anchor: col.align })
        made.data['drop'] = mono ? this.monoDrop : 0
        return made
    }

    /**
     * Where the mark and the text of a cell go, as x in the table. The mark is at the outer side of the text:
     * before a text that starts at the left, and after a number that ends at the right. In a centered column,
     * the mark and the text are centered together.
     */
    private place(col: Column, width: number, marked: boolean): { mark: number; text: number } {
        const room = this.room(col)
        if (col.align === 'left') return { mark: col.from + this.markR, text: col.from + room }
        if (col.align === 'right') return { mark: col.to - this.markR, text: col.to - room }
        const middle = (col.from + col.to) / 2
        if (!marked || width === 0) return { mark: middle, text: middle }
        return { mark: middle - (width + this.markGap) / 2, text: middle + room / 2 }
    }

    /** The shape of a mark, around its middle. */
    private shape(kind: TableMark, paint: Paint): Node {
        const r = this.markR, width = this.markLine, reach = r * 0.82
        const made = kind === 'ring' ? circle(r - width / 2, { stroke: paint, width })
            : kind === 'check' ? polyline([[-r, r * 0.05], [-r * 0.3, r * 0.75], [r, -r * 0.7]], { stroke: paint, width })
                : kind === 'cross' ? svgPath(`M${-reach} ${-reach}L${reach} ${reach}M${-reach} ${reach}L${reach} ${-reach}`, { stroke: paint, width })
                    : kind === 'dash' ? line([-r * 0.9, 0], [r * 0.9, 0], { stroke: paint, width })
                        : kind === 'bang' ? new Node().add(line([0, -r], [0, r * 0.2], { stroke: paint, width }), dot(width * 0.62, paint).at(0, r * 0.86))
                            : dot(r * 0.62, paint)
        made.data['shape'] = kind
        return made
    }

    /** An empty cell of a column, with its origin at the middle of the cell. */
    private cellNode(col: Column): TableCellNode {
        const half = (col.right - col.left) / 2
        return new TableCellNode([-half, -this.pitch / 2, half, this.pitch / 2]).at((col.left + col.right) / 2, 0)
    }

    /**
     * The mark and the text of a cell, in the holders of the cell. `middle` is the x of the origin of the cell
     * in the table. `bold` is for the total row.
     */
    private compose(col: Column, cell: TableCellNode, fact: Fact, bold: boolean, middle: number): { words: string | null; text: Node | null } {
        const said = this.say(col, fact.value)
        const look = fact.state === null ? null : this.look(fact.state)
        const made = said === null ? null : this.write(col, said, fact.value, look?.paint ?? 'ink', bold)
        const at = this.place(col, made ? advance(made) : 0, look !== null)
        if (look) {
            cell.mark.at(at.mark - middle, 0)
            cell.mark.add(this.shape(look.mark, look.paint))
        }
        if (made) {
            cell.words.add(made.at(at.text - middle, made.data['drop'] as number))
            ownLabels(this, { labels: [made] })
        }
        return { words: said, text: made }
    }

    /** Make the node of a row with its cells, and put it in the table. It is hidden until the table gives it a place. */
    private admit(row: { id: Id; cells: Fact[] }): Entry {
        this.suits(row)
        this.free(row.id)
        const edge = Math.max(1.5, this.size * 0.075)
        const backing = rect(this.w - edge * 2, this.pitch - edge, { radius: this.size * 0.2, fill: 'surface', stroke: 'gridStrong', width: edge })
        backing.base.opacity = 0
        const node = new TableRowNode(row.id, backing)
        const cells = this.cols.map((col, at): Slot => {
            const cell = this.cellNode(col), fact = row.cells[at]!
            node.cells.push(cell)
            node.content.add(cell)
            return { ...fact, node: cell, ...this.compose(col, cell, fact, false, cell.get('x')), last: null }
        })
        const entry: Entry = { id: row.id, node, cells, made: this.every.length, enters: [] }
        this.every.push(entry)
        // The cells show as much as `enter()` has brought of the row, and not at all under a row that passes over them.
        node.content.track('opacity').add(always((time) => this.arrival(entry, time) * this.clear(entry, time), 1))
        // A row that the table is made with shows from the start. A row that arrives is hidden until its time.
        if (this.mounted) node.base.visible = false
        this.body.add(node)
        this.byId.set(String(row.id), entry)
        return entry
    }

    /**
     * A cell takes a new value and a new state. What leaves goes in the first half of the time, and what comes
     * arrives in the second half: an old text and a new one, and a mark of one shape and a mark of another. So
     * no moment shows two texts, or a ring with a cross in it. A text that stays takes the new color, and a
     * mark that keeps its shape does too. With nothing that leaves, or nothing that comes, the change has the
     * whole time.
     */
    private paint(col: Column, slot: Slot, next: Fact, t0: number, t1: number, ease: Ease): void {
        const cell = slot.node, middle = cell.get('x')
        const said = this.say(col, next.value)
        const was = slot.state === null ? null : this.look(slot.state), look = next.state === null ? null : this.look(next.state)
        const color = look?.paint ?? toPaint('ink')
        const old = slot.text
        const mono = (value: TableValue) => col.mono ?? typeof value === 'number'
        // A text is made again when its words change, and when a number becomes a text with the same words.
        const made = said === null ? null : said === slot.words && old && mono(next.value) === mono(slot.value) ? old : this.write(col, said, next.value, color, false)
        const holder = cell.mark
        const shapeOf = (kind: TableMark) => holder.children.find((child) => child.data['shape'] === kind)
        const before = was ? shapeOf(was.mark) ?? null : null
        const stays = !!(before && look && look.mark === was!.mark)
        const leaves = (old !== null && made !== old) || (before !== null && !stays)
        const comes = (made !== null && made !== old) || (look !== null && !stays)
        const until = leaves && comes ? (t0 + t1) / 2 : t1, from = leaves && comes ? (t0 + t1) / 2 : t0
        const at = this.place(col, made ? advance(made) : 0, look !== null)

        if (old && made !== old) {
            old.tween('opacity', 0, t0, until, ease)
            stepAt(old, 'visible', false, until)
        }
        if (made && made !== old) {
            made.at(at.text - middle, made.data['drop'] as number)
            made.base.visible = false
            cell.words.add(made)
            ownLabels(this, { labels: [made] })
            stepAt(made, 'opacity', 0, from)
            stepAt(made, 'visible', true, from)
            made.tween('opacity', 1, from, t1, ease)
        } else if (made) {
            for (const glyph of made.children) glyph.tween('fill', color, t0, t1, ease)
            // In a centered column, a text makes room for a mark that comes, and takes the middle back when the mark goes.
            if (Math.abs(readAt(made, 'x', t1) - (at.text - middle)) > 1e-6) made.tween('x', at.text - middle, t0, t1, ease)
        }

        const tint = (shape: Node, paint: Paint, time: number | null) => {
            for (const leaf of shape.leaves()) {
                const prop = leaf.get('fill') ? 'fill' : 'stroke'
                if (time === null) leaf.tween(prop, paint, t0, t1, ease)
                else stepAt(leaf, prop, paint, time)
            }
        }
        if (look && stays) {
            // A mark that stays glides to its new place in a centered column.
            if (Math.abs(readAt(holder, 'x', t1) - (at.mark - middle)) > 1e-6) holder.tween('x', at.mark - middle, t0, t1, ease)
            tint(before!, look.paint, null)
        } else if (look) {
            // The holder takes the place of the new mark when the old one is gone.
            stepAt(holder, 'x', at.mark - middle, from)
            let shape = shapeOf(look.mark)
            if (!shape) {
                shape = this.shape(look.mark, look.paint)
                shape.base.visible = false
                holder.add(shape)
            }
            tint(shape, look.paint, from)
            stepAt(shape, 'opacity', 0, from)
            stepAt(shape, 'visible', true, from)
            shape.tween('opacity', 1, from, t1, ease)
        }
        if (before && !stays) {
            before.tween('opacity', 0, t0, until, ease)
            stepAt(before, 'visible', false, until)
        }
        slot.value = next.value
        slot.state = next.state
        slot.words = said
        slot.text = made
    }

    /**
     * Take the time of a change of the rows. Each change writes the way of the rows from the places that the
     * change before it left. Two changes at one time would each write a way, and the picture would follow
     * neither. So a change that starts before the last one is over is refused, with the advice that fits.
     */
    private claim(call: string, append: boolean, t0: number, t1: number): void {
        const last = this.last
        if (last && t0 < last.t1 - SOON) {
            const gap = t0 - last.t0
            const advice = gap < -SOON
                ? `The table takes the changes of its rows in the order of time, and the film calls ${last.call} first. Call ${call} before it`
                : gap <= SOON
                    ? (append && last.append ? 'Give one `append` all the rows. With `lag: 0`, they arrive together' : 'Play the two in a `seq`: each then has its share of the time of the play')
                    : `${last.call} takes ${seconds(last.t1 - last.t0)}, and ${call} starts ${seconds(gap)} after it. Give ${last.call} a \`duration\` of ${short(gap)} or less, or play the two in a \`seq\``
            throw new Error(`table: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. The table changes its rows one change at a time: a change starts when the change before it is over. ${advice}`)
        }
        this.last = { call, append, t0, t1 }
    }

    /** The rows take a new order: each row that has a new place moves there with its node. */
    private settle(call: string, next: Entry[], t0: number, t1: number, ctx: AnimContext): void {
        if (next.every((entry, slot) => this.order[slot] === entry)) return
        this.claim(call, false, t0, t1)
        reveal(this, t0, ctx.stage)
        // The card is there before the row has gone far, so a row under it is hidden when the card reaches it.
        const edge = (t1 - t0) * 0.1
        next.forEach((entry, slot) => {
            if (this.order[slot] === entry) return
            const node = entry.node, card = node.backing!
            node.tween('y', this.y(slot), t0, t1, ctx.ease)
            // A row that moves is a card over the rows that stay: it hides a row that it passes. The row that
            // goes the longest way is the top card, so the eye can follow it. The row with the light is over
            // them all: the marker is on it, and a marker on a row that is hidden would light nothing.
            stepAt(node, 'z', Math.abs(slot - this.order.indexOf(entry)) + (this.on?.row === entry ? next.length : 0), t0)
            stepAt(node, 'z', 0, t1)
            card.tween('opacity', 1, t0, t0 + edge, ctx.ease)
            card.tween('opacity', 0, t1 - edge, t1, ctx.ease)
        })
        this.moves.push([t0, t1])
        this.order = next
        const ids = next.map((entry) => String(entry.id))
        // A total that reads the order follows it when the rows are half way.
        this.changed((t0 + t1) / 2, (rows) => {
            const place = (row: Data) => { const at = ids.indexOf(String(row.id)); return at < 0 ? ids.length : at }
            rows.sort((a, b) => place(a) - place(b))
        })
    }

    /** The rows as data, in the order of the table, after the changes that are scheduled so far. */
    private records(): Data[] {
        return this.order.map((entry) => ({ id: entry.id, cells: entry.cells.map((cell) => ({ value: cell.value, state: cell.state })) }))
    }

    private viewsOf(rows: readonly Data[]): TableRowView[] {
        return rows.map((row, index) => {
            const values: Record<string, TableValue> = {}, states: Record<string, string | null> = {}
            this.cols.forEach((col, at) => {
                values[col.key] = row.cells[at]!.value
                states[col.key] = row.cells[at]!.state
            })
            return { id: row.id, index, values, states }
        })
    }

    /** The rows as a function of a film gets them, after the changes that are scheduled so far. */
    private views(): TableRowView[] {
        return this.viewsOf(this.records())
    }

    /** The cell of the total of a column, for some rows. */
    private totalOfRows(col: Column, at: number, rows: readonly Data[]): TableCell {
        if (col.total === 'sum') {
            let sum = 0
            for (const row of rows) if (typeof row.cells[at]!.value === 'number') sum += row.cells[at]!.value as number
            // The sum of 0.1 and 0.2 is not 0.3 in a computer. Twelve digits are more than a table shows.
            return Number(sum.toPrecision(12))
        }
        return (col.total as (rows: readonly TableRowView[]) => TableCell)(this.viewsOf(rows))
    }

    /** The data of the table changed at a time. The total is written again from all the changes. */
    private changed(time: number, apply: (rows: Data[]) => void): void {
        this.changes.push({ time, apply })
        this.retotal()
    }

    /**
     * Write each total over time. A total is a function of the rows, and changes of the rows may be scheduled
     * in any order and may overlap. So the table replays every change in the order of time on a copy of the
     * first rows, and takes the total after each one. A text shows while the total has its value.
     */
    private retotal(): void {
        if (this.sums.length === 0) return
        const rows = this.origin.map((row) => ({ id: row.id, cells: row.cells.map((cell) => ({ ...cell })) }))
        // Changes at one time keep the order in which the film scheduled them.
        const changes = this.changes.map((change, order) => ({ ...change, order })).sort((a, b) => a.time - b.time || a.order - b.order)
        for (const words of this.sums) words.steps = []
        const take = (time: number) => {
            for (const words of this.sums) {
                const col = this.cols[words.column]!, who = `the total of the column ${JSON.stringify(col.key)}`
                const fact = this.fact(this.totalOfRows(col, words.column, rows), who)
                const said = this.say(col, fact.value)
                let node: Node | null = null
                if (said !== null || fact.state !== null) {
                    if (fact.state !== null) this.marked(col, fact.state, who)
                    this.fits(col, fact.value, who, true)
                    const key = `${fact.state ?? ''}\n${typeof fact.value}\n${said ?? ''}`
                    node = words.made.get(key) ?? null
                    if (!node) {
                        // Each text of a total is a cell of its own in the holder: one shows at a time.
                        const face = new TableCellNode(words.holder.box)
                        this.compose(col, face, fact, true, words.holder.get('x'))
                        face.base.visible = false
                        words.made.set(key, node = face)
                        words.holder.add(face)
                        const own = node
                        own.track('visible').add(always((at) => this.totalAt(words, at) === own, false))
                    }
                }
                const last = words.steps[words.steps.length - 1]
                if (last && last.time === time) last.node = node
                else words.steps.push({ time, node })
            }
        }
        take(-Infinity)
        for (const change of changes) {
            change.apply(rows)
            take(change.time)
        }
    }

    /** The text of a total at a time. */
    private totalAt(words: Words, time: number): Node | null {
        const steps = words.steps
        let low = 0, high = steps.length - 1
        while (low < high) {
            const middle = (low + high + 1) >> 1
            if (steps[middle]!.time <= time) low = middle
            else high = middle - 1
        }
        return steps[low]?.node ?? null
    }

    /** The edges of the room of a row, a column, a cell or the panel, in the coordinates of the table. */
    private edges(row: Id | null, column: string | null): Edges {
        const col = column === null ? null : this.cols[this.col(column)]!
        const left = col ? col.left : -this.w / 2, right = col ? col.right : this.w / 2
        if (row === null) return [left, -this.h / 2, right, this.h / 2]
        const y = this.y(this.order.indexOf(this.entry(row)))
        return [left, y - this.pitch / 2, right, y + this.pitch / 2]
    }

    /** Add a call of `light()` to the list, in the order of time. Calls at one time keep the order of the film. */
    private spot(spot: Spot): void {
        let at = this.spots.length
        while (at > 0 && this.spots[at - 1]!.t0 > spot.t0) at--
        this.spots.splice(at, 0, spot)
    }

    /** The room of a target of the light at a time, and how much of its row is there. A row is read where it is at that time. */
    private target(target: Target, time: number): { box: Edges; shows: number } {
        const inset = this.size * 0.2, gap = Math.max(2, this.size * 0.1)
        const col = target.column === null ? null : this.cols[target.column]!
        const left = (col ? col.left : -this.w / 2) + inset, right = (col ? col.right : this.w / 2) - inset
        // The marker of a column goes from the header to the last row that the table has at that time.
        if (!target.row) return { box: [left, this.head - this.pitch / 2 + gap, right, this.y(this.filled.sample(time)) - this.pitch / 2 - gap], shows: 1 }
        const node = target.row.node
        const y = readAt(node, 'y', time)
        const shows = (readAt(node, 'visible', time) ? readAt(node, 'opacity', time) : 0) * readAt(node.content, 'opacity', time)
        return { box: [left, y - this.pitch / 2 + gap, right, y + this.pitch / 2 - gap], shows }
    }

    /**
     * Where the marker is at a time, and how much of it shows. The last call that has started decides. It takes
     * the marker from where the calls before it left it to its own target, so two calls whose times overlap
     * still give one marker. `upTo` is the last call that counts. `line` is how much of the line around the
     * marker shows: all of it at rest, and none on the way from one place to another. On its way the marker
     * passes the texts of other rows, and a line through a text reads as a strike. The faint fill does not.
     */
    private beam(time: number, upTo = this.spots.length - 1): { box: Edges | null; strength: number; line: number } {
        let at = upTo
        while (at >= 0 && this.spots[at]!.t0 > time + SOON) at--
        if (at < 0) return { box: null, strength: 0, line: 1 }
        const spot = this.spots[at]!
        const to = spot.target ? this.target(spot.target, time) : null
        const share = spot.t1 > spot.t0 ? clamp((time - spot.t0) / (spot.t1 - spot.t0)) : 1
        if (share >= 1) return to ? { box: to.box, strength: to.shows, line: 1 } : { box: null, strength: 0, line: 1 }
        // A marker that was at rest on a row follows that row while it leaves. A marker that was on its way starts from where it was.
        const before = at > 0 ? this.spots[at - 1]! : null
        const rested = before && before.t1 <= spot.t0 + SOON && before.target ? this.target(before.target, time) : null
        const was = rested ? { box: rested.box as Edges | null, strength: rested.shows, line: 1 } : this.beam(spot.t0, at - 1)
        const way = clamp(spot.ease(share))
        if (!to) return { box: was.box, strength: was.strength * (1 - way), line: was.line }
        if (!was.box || was.strength <= 0) return { box: to.box, strength: to.shows * way, line: 1 }
        const mix = (a: number, b: number) => a + (b - a) * way
        const same = was.box.every((edge, index) => Math.abs(edge - to.box[index]!) < 0.5)
        // The line goes in the first fifth of the way and comes back in the last fifth.
        const line = same ? 1 : Math.min(was.line, 1 - share * 5) > 0 ? Math.min(was.line, 1 - share * 5) : clamp((share - 0.8) * 5)
        return { box: [mix(was.box[0], to.box[0]), mix(was.box[1], to.box[1]), mix(was.box[2], to.box[2]), mix(was.box[3], to.box[3])], strength: mix(was.strength, to.shows), line }
    }

    private markerPath(time: number): Path | null {
        const { box } = this.beam(time)
        return box && rectPath(box[0], box[1], box[2] - box[0], box[3] - box[1], this.size * 0.3)
    }
}

/**
 * A table with a header, named columns, rows with an identity, and cells with a state:
 * `table(['case', { key: 'old', label: 'old prompt', align: 'center' }], [{ id: 'overdue', case: 'overdue', old: { state: 'pending' } }])`,
 * then `results.light('overdue', 'old')` and `results.setCell('overdue', 'old', { state: 'pass' })`.
 */
export function table(columns: readonly (string | TableColumn)[], rows: readonly TableRow[] = [], options: TableOptions = {}): Table {
    return new Table(columns, rows, options)
}
