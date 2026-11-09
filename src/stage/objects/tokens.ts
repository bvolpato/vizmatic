import { Node, mountTree, ownLabels } from '../node'
import { apply, circlePath, invert, linePath, parseSvgPath, pathBounds, polyPath, rectPath, unionBounds, type Bounds, type Path, type Ring, type Vec } from '../geometry'
import { text, type TextNode, type TextOptions } from '../text'
import { ramp, toPaint, type ColorInput } from '../color'
import { clock } from '../track'
import type { Ease } from '../ease'
import type { Anim, AnimOptions } from '../anim'
import { Box } from '../layout'
import { lerpSame, reveal, sampleAt, staggered, stepAt } from './util'

/** The second sign of a state, beside its color. */
export type TokenMark = 'hatch' | 'strike' | 'bar' | 'dot' | 'check' | 'cross'

export interface TokenState {
    /** The color of the cell. Without it, the cell keeps its own color. */
    color?: ColorInput
    /** Opacity of the fill, 0 to 1. Defaults to 0.18. */
    fill?: number
    /** A dashed outline, for a token that is not there. */
    dash?: boolean
    /**
     * A sign that does not depend on color. `'hatch'` draws lines over the cell, `'strike'` a line through
     * the text, and `'bar'` a thick line along the bottom of the cell. `'dot'`, `'check'` and `'cross'` draw a
     * small disc on the top right corner.
     */
    mark?: TokenMark
    /** Draw the text dim. */
    dim?: boolean
}

/** States for the tokens of a language model. The first one is the state of a token that names none. */
export const TOKEN_STATES = {
    /** A token as it is: the color of the strip, and no sign. */
    kept: {},
    /** Hidden from the model, or left out of the loss. */
    masked: { color: 'dim', fill: 0.05, mark: 'hatch', dim: true },
    /** Written by the model. */
    generated: { color: 'green', fill: 0.3, mark: 'bar' },
    /** Read from a cache, and not computed again. */
    cached: { color: 'yellow', fill: 0.24, mark: 'dot' },
    /** Cut from the input. */
    dropped: { color: 'red', fill: 0.04, dash: true, mark: 'strike', dim: true },
} satisfies Record<string, TokenState>

export interface TokenSpec {
    text: string
    /** Small line under the chip, such as an id or a probability. A strip with `rows` has its values there. */
    sub?: string
    color?: ColorInput
    /** The name of a state of the strip, such as 'masked'. Defaults to the first state. */
    state?: string
    /** The value of this token in rows of the strip, by the name of the row: `{ id: 2103 }`. */
    values?: Record<string, string | number | null>
}

export interface TokenSpan {
    /** The first and the last token under the bracket. */
    from: number
    to: number
    /** One line over the bracket, such as 'system prompt'. */
    label?: string
    /** Defaults to dim. */
    color?: ColorInput
    /** The name that `strip.span(id, ...)` moves the bracket by. Defaults to the label. */
    id?: string
}

export interface TokensOptions {
    size?: number
    /** Wrap to this width. A strip that wraps is a plain row of chips: it takes states, and no rows, spans, window, or change of its tokens. */
    maxWidth?: number
    gap?: number
    color?: ColorInput
    /** Ramp of colors across the row. */
    colors?: readonly ColorInput[]
    /** The font of the tokens. Defaults to mono. The line under a chip and the values of the rows are in mono. */
    font?: TextOptions['font']
    subSize?: number
    radius?: number
    /**
     * The room of the strip, on one line. The first token is at the left end of the room, so the tokens keep
     * their places while `append` and `split` fill it. `.at()` places the middle of the room. Tokens that do
     * not fit are an error. Without it, the strip is as wide as its tokens, and `.at()` places their middle.
     */
    width?: number
    /** Give every cell the width of the widest one, so that the columns are a grid. */
    even?: boolean
    /** The least width of a cell. */
    minWidth?: number
    /** Rows of values under the cells, by name: `{ id: [464, 3797], position: [0, 1] }`. A name is drawn at the left of its row. */
    rows?: Record<string, readonly (string | number | null | undefined)[]>
    /** The name of the line of cells, drawn at its left as the names of the rows are, such as 'input'. */
    label?: string
    /** Text size of the values, the names of the rows, and the labels of the spans. Defaults to 0.82 of `size`. */
    rowSize?: number
    /** Brackets over runs of tokens: a word of three tokens, a chunk, a part of a prompt. */
    spans?: readonly TokenSpan[]
    /** The states and their looks. Defaults to TOKEN_STATES. */
    states?: Record<string, TokenState>
}

/** What a function that picks tokens gets for each one. */
export interface TokenInfo {
    text: string
    state: string
}

export type TokenPick = number | readonly number[] | ((token: TokenInfo, index: number) => boolean)

interface Spec {
    text: string
    sub?: string
    color?: ColorInput
    state?: string
    values: Record<string, string | null>
}

interface Look {
    color: ColorInput | null
    fill: number
    dash: boolean
    mark: TokenMark | null
    dim: boolean
}

// The look of a cell with no state of its own, as the row of chips always drew it.
const FILL = 0.18
const BORDER = 1.5
// The text size of the values, the names and the labels of the spans, as a part of `size`.
const ROW_SIZE = 0.82
// The middle of the first row under the cells, and the distance from a row to the next, in text sizes of the rows.
const ROW_FIRST = 0.95
const ROW_PITCH = 1.45
// The room between a value and each side of its cell, as a part of the text size of the rows.
const VALUE_PAD = 0.3
// How far over the cells the line of a bracket is, and how long its two ends are, as parts of `size`.
const SPAN_RISE = 0.6
const SPAN_TICK = 0.25
// A time after every change of a film: the value that a property comes to rest at.
const AT_REST = Number.MAX_VALUE

/** A value as the film wrote it, for an error. */
const shown = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : Array.isArray(value) ? 'a list' : value === null ? 'null' : typeof value === 'object' ? 'an object' : String(value))

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

const seconds = (time: number): string => `${Math.round(time * 100) / 100} s`

/** Diagonal lines over a box. They stop around `clear`, so that no line crosses the text of the cell. */
function hatch(box: Bounds, step: number, clear: Bounds | null): Path {
    const right = box.x + box.width, bottom = box.y + box.height
    const rings: Ring[] = []
    // A line holds the points where x + y is one sum.
    for (let sum = Math.ceil((box.x + box.y) / step) * step; sum < right + bottom; sum += step) {
        const from = Math.max(box.x, sum - bottom), to = Math.min(right, sum - box.y)
        const cut = clear ? [Math.max(clear.x, sum - clear.y - clear.height), Math.min(clear.x + clear.width, sum - clear.y)] as const : null
        const runs = cut && cut[0] < cut[1] ? [[from, Math.min(to, cut[0])], [Math.max(from, cut[1]), to]] as const : [[from, to]] as const
        for (const [a, b] of runs) {
            if (b - a > 1) rings.push(...linePath([a, sum - a], [b, sum - b]))
        }
    }
    return rings
}

/** The bounds of the ink of a text, in the coordinates of the node that holds the text at its own origin. */
function inkOf(label: TextNode): Bounds | null {
    let ink: Bounds | null = null
    const px = label.get('px'), py = label.get('py')
    for (const glyph of label.chars) {
        const own = pathBounds(glyph.get('path') ?? [])
        if (own) ink = unionBounds(ink, { x: own.x + glyph.get('x') - px, y: own.y + glyph.get('y') - py, width: own.width, height: own.height })
    }
    return ink
}

/** One token of a strip: its box, its text, and the line under it. `strip.token(index)` gives it. */
export class TokenCell extends Node {
    box!: Node
    text!: TextNode
    /** The small line under the chip, or null. */
    sub: Node | null = null
    /** The marks of the state of the token, such as the lines of a masked one. */
    signs: Node[] = []
    /** The token as the film wrote it. */
    source = ''
    state = ''
    /** The color of the cell in a state that has no color of its own. */
    tint: ColorInput = 'blue'
    /** The width of the box. */
    wide = 0
    /** The middle of the box in the coordinates of the strip, after the changes that are scheduled so far. */
    cx = 0
    cy = 0
    /** The bounds of the ink of the text, around the middle of the box. Null for an empty text. */
    ink: Bounds | null = null
    /** The time at which the change that made this cell ends. A split or a merge of the cell waits for it. */
    settles = -Infinity
}

/** One row of values under the cells of a strip. `strip.row(name)` gives it. */
export class TokenValueRow extends Node {
    /** The name at the left of the row. */
    name: Node | null = null
    /** The value under each token, or null where the row has none. It follows the changes that are scheduled so far. */
    values: (TextNode | null)[] = []
    key = ''
    /** The y of the middle of the row, in the coordinates of the strip. */
    line = 0
}

/** A bracket over a run of tokens, with its label. */
export class TokenSpanNode extends Node {
    bracket!: Node
    text: TextNode | null = null
    first!: TokenCell
    last!: TokenCell
    key = ''
    /** 0 for a bracket next to the cells. A bracket that would meet another one is a level higher. */
    level = 0
    tint: ColorInput = 'dim'
    /** The two ends of the bracket, after the changes that are scheduled so far. */
    from = 0
    to = 0
}

/**
 * A strip of tokens, words, characters or bytes, as in the output of a tokenizer. Each token is a cell with
 * its text. The strip can hold rows of values under the cells, brackets over runs of cells, and one window
 * that slides. A token has a state with its own look, and `mark()` changes it. `append()` adds tokens at
 * the end, `split()` cuts one token into pieces, and `merge()` joins tokens into one. The tokens after a
 * change move to their new places, and the rows, the brackets and the window follow their tokens. Small
 * type by default: give `size` for a film.
 */
export class TokenRow extends Node {
    /** The cell of each token, from the left. It follows the changes that are scheduled so far. */
    readonly chips: TokenCell[] = []
    /** The rows of values under the cells, from the top. */
    readonly rows: TokenValueRow[] = []
    /** The brackets over the cells that show now. */
    readonly spans: TokenSpanNode[] = []
    /** The outline of the window, or null before the first `window()`. Set its stroke for another color. */
    frame: Node | null = null
    /** The name of the line of cells, or null for a strip with no `label`. */
    readonly caption: Node | null = null
    private readonly size: number
    private readonly gap: number
    private readonly subSize: number
    private readonly rowSize: number
    private readonly padX: number
    private readonly high: number
    private readonly radius: number
    private readonly font: TextOptions['font']
    private readonly tint: ColorInput
    private readonly wraps: number | null
    private readonly room: number | null
    private readonly even: number | null
    private readonly least: number
    private readonly looks = new Map<string, Look>()
    private readonly stateNames: string[]
    /** The x and the y of the left end of the first line, from the origin of the strip: the strip is centered on its origin. */
    private readonly originX: number
    private readonly originY: number
    /** The number of children at the start of the list that are the room and the cells. A new cell goes after them, under the rows and the brackets. */
    private head = 0
    private windowFirst: TokenCell | null = null
    private windowLast: TokenCell | null = null
    /** The two ends of the window, after the changes that are scheduled so far. */
    private windowEnds: [number, number] = [0, 0]

    constructor(items: readonly (string | number | TokenSpec)[], options: TokensOptions = {}) {
        super()
        if (!Array.isArray(items)) throw new Error(`tokens: the first argument is ${shown(items)}. Give the list of the tokens, such as ['The', 'cat']`)
        if (typeof options !== 'object' || options === null) throw new Error(`tokens: the second argument is ${shown(options)}. Give the options, such as { size: 40 }`)
        const number = (name: 'size' | 'gap' | 'subSize' | 'rowSize' | 'radius' | 'maxWidth' | 'width' | 'minWidth', least: 'more than 0' | '0 or more', what: string) => {
            const value = options[name]
            if (value !== undefined && !(typeof value === 'number' && Number.isFinite(value) && (least === '0 or more' ? value >= 0 : value > 0))) throw new Error(`tokens: ${name} is ${shown(value)}. It is ${what}, ${least}`)
        }
        number('size', 'more than 0', 'the text size of the tokens')
        number('gap', '0 or more', 'the room between two cells')
        number('subSize', 'more than 0', 'the text size of the line under a chip')
        number('rowSize', 'more than 0', 'the text size of the values of the rows')
        number('radius', '0 or more', 'the radius of the corners of a cell')
        number('maxWidth', 'more than 0', 'the width at which the strip starts a new line')
        number('width', 'more than 0', 'the room of the strip')
        number('minWidth', '0 or more', 'the least width of a cell')
        const size = this.size = options.size ?? 22
        const gap = this.gap = options.gap ?? size * 0.28
        const subSize = this.subSize = options.subSize ?? size * 0.62
        this.rowSize = options.rowSize ?? size * ROW_SIZE
        const padX = this.padX = size * 0.42, padY = size * 0.3
        this.high = size + padY * 2
        this.radius = options.radius ?? 4
        this.font = options.font
        this.tint = options.color ?? 'blue'
        this.wraps = options.maxWidth ?? null
        this.room = options.width ?? null
        this.least = options.minWidth ?? 0

        // A strip that wraps keeps the places of its chips. The parts that follow the tokens need one line.
        for (const name of ['width', 'even', 'rows', 'spans', 'label'] as const) {
            if (this.wraps !== null && options[name] !== undefined && options[name] !== false) throw new Error(`tokens: ${name} is for a strip of one line, and maxWidth starts new lines. Leave out maxWidth${name === 'width' ? '' : ', or give width for the room of one line'}`)
        }

        const states: Record<string, TokenState> = options.states ?? TOKEN_STATES
        if (typeof states !== 'object' || states === null) throw new Error(`tokens: states is ${shown(states)}. Give a record of states, such as { ...TOKEN_STATES, accepted: { color: 'green', mark: 'check' } }`)
        this.stateNames = Object.keys(states)
        if (this.stateNames.length === 0) throw new Error('tokens: states has no state. Give it at least one, such as { kept: {} }')
        for (const name of this.stateNames) {
            const { color = null, fill = FILL, dash = false, mark = null, dim = false } = states[name] ?? {}
            if (!(typeof fill === 'number' && fill >= 0 && fill <= 1)) throw new Error(`tokens: the fill of the state ${JSON.stringify(name)} is ${shown(fill)}. A fill is an opacity, 0 to 1`)
            if (mark !== null && !['hatch', 'strike', 'bar', 'dot', 'check', 'cross'].includes(mark)) throw new Error(`tokens: the mark of the state ${JSON.stringify(name)} is ${shown(mark)}. A mark is 'hatch', 'strike', 'bar', 'dot', 'check' or 'cross'`)
            // A color that the look does not have is an error here, where the film names it.
            if (color !== null) this.paintOf(color, `the color of the state ${JSON.stringify(name)}`)
            this.looks.set(name, { color, fill, dash, mark, dim })
        }

        const rows = options.rows ?? {}
        if (typeof rows !== 'object' || rows === null || Array.isArray(rows)) throw new Error(`tokens: rows is ${shown(rows)}. Give the rows by name, such as { id: [464, 3797], position: [0, 1] }`)
        const rowNames = Object.keys(rows)
        for (const name of rowNames) {
            const list = rows[name]
            if (!Array.isArray(list)) throw new Error(`tokens: the row ${JSON.stringify(name)} is ${shown(list)}. A row is the list of its values, one for each token, such as [464, 3797]`)
            if (list.length > items.length) throw new Error(`tokens: the row ${JSON.stringify(name)} has ${plural(list.length, 'value')}, and the strip has ${plural(items.length, 'token')}. Give one value for each token, or fewer`)
            const row = new TokenValueRow()
            row.key = name
            row.line = this.high / 2 + this.rowSize * (ROW_FIRST + ROW_PITCH * this.rows.length)
            this.rows.push(row)
        }

        const specs = items.map((item, index) => this.spec(item, `token ${index}`))
        specs.forEach((spec, index) => {
            for (const name of rowNames) if (!(name in spec.values)) spec.values[name] = this.valueText(rows[name]![index], `value ${index} of the row ${JSON.stringify(name)}`)
        })
        const palette = options.colors ? ramp(specs.length, ...options.colors) : null
        // With `even`, every cell has the width that the widest token and its values need.
        this.even = options.even ? Math.max(this.least, size * 0.5 + padX * 2, ...specs.map((spec) => this.need(spec))) : null

        let x = 0, y = 0
        const placed: { cell: TokenCell; x: number; y: number }[] = []
        const rowHeight = size + padY * 2 + (specs.some((s) => s.sub) ? subSize * 1.4 : 0)
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i]!
            const cell = this.make(spec, spec.color ?? (palette ? palette[i]! : this.tint), `token ${i}`)
            const w = cell.wide
            if (this.wraps !== null && x > 0 && x + w > this.wraps) {
                x = 0
                y += rowHeight + gap
            }
            placed.push({ cell, x: x + w / 2, y })
            x += w + gap
        }
        const maxX = Math.max(...placed.map((p) => p.x + p.cell.wide / 2), 0)
        const maxY = Math.max(...placed.map((p) => p.y), 0)
        if (this.room !== null && maxX > this.room + 0.5) {
            throw new Error(`tokens: the ${plural(specs.length, 'token')} are ${Math.ceil(maxX)} px wide at size ${size}, and the width is ${this.room}. Give a width of ${Math.ceil(maxX)} or more, a smaller size, or fewer tokens`)
        }
        this.originX = (this.room ?? maxX) / 2
        this.originY = maxY / 2
        if (this.room !== null) {
            // A shape with no paint. It gives the strip the bounds of its room, so the layout measures the room.
            this.add(new Node(rectPath(-this.room / 2, -this.high / 2, this.room, this.high)))
        }
        for (const entry of placed) {
            entry.cell.cx = entry.x - this.originX
            entry.cell.cy = entry.y - this.originY
            entry.cell.at(entry.cell.cx, entry.cell.cy)
            this.chips.push(entry.cell)
            this.add(entry.cell)
        }
        this.head = this.children.length

        // The names end at one x, at the left of the first cell.
        const nameAt = -this.originX - size * 0.7
        const named = (name: string, line: number) => text(name, { size: this.rowSize, color: 'dim', anchor: 'right' }).at(nameAt, line)
        if (options.label !== undefined) {
            if (typeof options.label !== 'string' || /[\r\n]/.test(options.label)) throw new Error(`tokens: label is ${shown(options.label)}. It is the name of the line of cells, one line of text, such as 'input'`)
            this.caption = named(options.label, 0)
            this.add(this.caption)
        }
        this.rows.forEach((row) => {
            row.name = named(row.key, row.line)
            row.add(row.name)
            row.values = this.chips.map((cell, index) => this.valueNode(specs[index]!.values[row.key] ?? null, cell, row))
            for (const value of row.values) if (value) row.add(value)
            this.add(row)
        })

        const spans = options.spans ?? []
        if (!Array.isArray(spans)) throw new Error(`tokens: spans is ${shown(spans)}. Give a list, such as [{ from: 0, to: 2, label: 'system prompt' }]`)
        const made = spans.map((span: TokenSpan, index) => {
            if (typeof span !== 'object' || span === null) throw new Error(`tokens: span ${index} is ${shown(span)}. A span is an object, such as { from: 0, to: 2, label: 'system prompt' }`)
            const [from, to] = this.run(span.from, span.to, `span ${index}`)
            const id = span.id ?? span.label ?? String(index)
            if (spans.findIndex((other, at) => at < index && (other.id ?? other.label ?? String(at)) === id) >= 0) throw new Error(`tokens: two spans have the id ${JSON.stringify(id)}. Give each span its own id, or its own label`)
            return this.bracket(id, this.chips[from]!, this.chips[to]!, span.label, span.color ?? 'dim')
        })
        // A short bracket is next to the cells, and a longer one that holds it is over it.
        const leveled: TokenSpanNode[] = []
        for (const span of [...made].sort((a, b) => (a.to - a.from) - (b.to - b.from))) {
            this.raise(span, this.freeLevel(span, leveled))
            leveled.push(span)
        }
        this.spans.push(...made)
        for (const span of made) this.add(span)
        // The strip places each text in or beside its own cells. The film check does not judge that room.
        ownLabels(this, { name: 'row of tokens' })
    }

    /** The number of tokens, after the changes that are scheduled so far. */
    get count(): number {
        return this.chips.length
    }

    /** The text of each token, from the left, after the changes that are scheduled so far. */
    get texts(): string[] {
        return this.chips.map((cell) => cell.source)
    }

    /** The first and the last token in the window, after the changes that are scheduled so far. Null while no window shows. */
    get windowRange(): [number, number] | null {
        return this.windowFirst && this.windowLast ? [this.chips.indexOf(this.windowFirst), this.chips.indexOf(this.windowLast)] : null
    }

    /** The cell of a token. It holds the box, the text, and the marks of the state, so fade it or light it as one node. */
    token(index: number): TokenCell {
        return this.chips[this.index(index, '')]!
    }

    /** The state of a token, after the changes that are scheduled so far. */
    stateOf(index: number): string {
        return this.chips[this.index(index, 'stateOf')]!.state
    }

    /**
     * The indexes of the tokens that a function picks, or of the tokens with one text, after the changes
     * that are scheduled so far: `strip.find('the')`, `strip.find((token) => token.state === 'masked')`.
     */
    find(test: string | ((token: TokenInfo, index: number) => boolean)): number[] {
        if (typeof test !== 'string' && typeof test !== 'function') throw new Error(`tokens: find takes the text of a token, or a function of a token and its index, and it got ${shown(test)}`)
        return this.chips.flatMap((cell, index) => ((typeof test === 'string' ? cell.source === test : test({ text: cell.source, state: cell.state }, index)) ? [index] : []))
    }

    /** A row of values, by its name. It holds the name at its left and the values, as `row.name` and `row.values`. */
    row(name: string): TokenValueRow {
        const found = this.rows.find((row) => row.key === name)
        if (!found) throw new Error(`tokens: no row ${shown(name)}. ${this.rows.length > 0 ? `The rows are ${this.rows.map((row) => JSON.stringify(row.key)).join(', ')}` : 'The strip has no rows. Give them when you make it, such as rows: { id: [464, 3797] }'}`)
        return found
    }

    /** The value that a row shows under a token, after the changes that are scheduled so far. Null where it shows none. */
    value(row: string, index: number): string | null {
        return this.row(row).values[this.index(index, 'value')]?.source ?? null
    }

    /** The cell of a token and its value in each row: one column of the strip, to light it as one. */
    column(index: number): Node[] {
        const at = this.index(index, 'column')
        return [this.chips[at]!, ...this.rows.flatMap((row) => (row.values[at] ? [row.values[at]!] : []))]
    }

    /** The first and the last token under a bracket, after the changes that are scheduled so far. Null for a bracket that does not show. */
    spanRange(id: string): [number, number] | null {
        const span = this.spans.find((own) => own.key === id)
        return span ? [this.chips.indexOf(span.first), this.chips.indexOf(span.last)] : null
    }

    /**
     * The middle of an edge of the cell of a token, in the coordinates of the strip: the point where a line
     * to the token ends. Defaults to the bottom. The bottom point is under the rows of values, and the top
     * point is over the brackets, so a line from it crosses no text of the strip. The point does not follow
     * the token: read it again after a change moves the token.
     */
    p(index: number, edge: 'top' | 'bottom' | 'left' | 'right' = 'bottom'): [number, number] {
        const at = this.index(index, 'p'), cell = this.chips[at]!, half = this.high / 2
        if (edge === 'left') return [cell.cx - cell.wide / 2, cell.cy]
        if (edge === 'right') return [cell.cx + cell.wide / 2, cell.cy]
        if (edge === 'bottom') {
            const last = this.rows[this.rows.length - 1]
            return [cell.cx, last ? last.line + this.rowSize * 0.75 : cell.cy + half + (cell.sub ? this.subSize * 1.4 : 0)]
        }
        if (edge === 'top') {
            const over = this.spans.filter((span) => this.chips.indexOf(span.first) <= at && at <= this.chips.indexOf(span.last))
            const highest = over.reduce<TokenSpanNode | null>((top, span) => (!top || span.level > top.level ? span : top), null)
            return [cell.cx, highest ? this.spanLine(highest.level) - (highest.text ? this.rowSize * 1.45 : this.size * 0.2) : cell.cy - half]
        }
        throw new Error(`tokens: the edge of p() is 'top', 'bottom', 'left' or 'right', not ${shown(edge)}`)
    }

    /**
     * The box of a part of the strip, in stage pixels, for `place` and `beside` of the layout: such as
     * `beside(note, strip.region({ from: 2, to: 4 }), 'above')`. Without a part it is the box of all cells.
     * `from` and `to` are the first and the last token. `row` is the name of a row of values: the box is
     * then the part of that row under these tokens. The box is where the strip is now, so ask for it after
     * the strip has its place.
     */
    region(part: { from?: number; to?: number; row?: string } = {}): Box {
        const names = ['from', 'to', 'row']
        if (typeof part !== 'object' || part === null) throw new Error(`tokens: region takes an object such as { from: 0, to: 2 }, and it got ${shown(part)}`)
        const unknown = Object.keys(part).find((name) => !names.includes(name))
        if (unknown !== undefined) throw new Error(`tokens: region has no part "${unknown}". Its parts are: ${names.join(', ')}`)
        if (this.chips.length === 0) throw new Error('tokens: region: the strip has no token, so it has no cell to measure. Append a token first')
        const [from, to] = this.run(part.from ?? 0, part.to ?? this.chips.length - 1, 'region')
        const cells = this.chips.slice(from, to + 1), half = this.high / 2
        const left = Math.min(...cells.map((cell) => cell.cx - cell.wide / 2)), right = Math.max(...cells.map((cell) => cell.cx + cell.wide / 2))
        let top = Math.min(...cells.map((cell) => cell.cy - half)), bottom = Math.max(...cells.map((cell) => cell.cy + half))
        if (part.row !== undefined) {
            const line = this.row(part.row).line
            top = line - this.rowSize * 0.7
            bottom = line + this.rowSize * 0.7
        }
        const [x0, y0] = this.toWorld(left, top), [x1, y1] = this.toWorld(right, bottom)
        return new Box(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1))
    }

    /** A copy with its own tokens, rows and brackets, at rest in the state that the strip has now. */
    override clone(): this {
        const copy = super.clone()
        // A list with no node in it is not copied with the tree, so give the copy lists of its own.
        const own = copy as unknown as { chips: TokenCell[]; rows: TokenValueRow[]; spans: TokenSpanNode[]; windowEnds: [number, number] }
        own.chips = [...copy.chips]
        own.rows = [...copy.rows]
        own.spans = [...copy.spans]
        own.windowEnds = [...copy.windowEnds]
        for (const cell of copy.chips) {
            cell.signs = [...cell.signs]
            cell.settles = -Infinity
        }
        for (const row of copy.rows) row.values = [...row.values]
        return copy
    }

    /** Chips arrive from left to right, each with its values. The names, the brackets and the window come with them. */
    enter(options: AnimOptions = {}): Anim {
        const lag = options.lag ?? 0.16
        return {
            label: 'tokens.enter', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const windows = staggered(this.chips.length, lag, ctx.t0, ctx.t1)
                this.chips.forEach((chip, i) => {
                    const [start, end] = windows[i]!
                    const y = chip.get('y')
                    stepAt(chip, 'opacity', 0, ctx.t0)
                    stepAt(chip, 'y', y + 16, ctx.t0)
                    chip.tween('opacity', 1, start, end, ctx.ease)
                    chip.tween('y', y, start, end, ctx.ease)
                })
                const fade = (node: Node | null, start: number, end: number) => {
                    if (!node) return
                    const opacity = sampleAt(node, 'opacity', ctx.t0)
                    if (opacity === 0) return
                    stepAt(node, 'opacity', 0, ctx.t0)
                    node.tween('opacity', opacity, start, end, ctx.ease)
                }
                const all: [number, number] = [ctx.t0, ctx.t1]
                fade(this.caption, ctx.t0, ctx.t0 + (ctx.t1 - ctx.t0) * 0.4)
                for (const row of this.rows) {
                    fade(row.name, ctx.t0, ctx.t0 + (ctx.t1 - ctx.t0) * 0.4)
                    row.values.forEach((value, i) => fade(value, ...(windows[i] ?? all)))
                }
                // A bracket comes while its tokens arrive, and the window comes last.
                for (const span of this.spans) fade(span, (windows[this.chips.indexOf(span.first)] ?? all)[0], (windows[this.chips.indexOf(span.last)] ?? all)[1])
                if (this.windowFirst) fade(this.frame, ctx.t0 + (ctx.t1 - ctx.t0) * 0.7, ctx.t1)
            },
        }
    }

    /**
     * Curved links from one token to others, brighter for stronger weights.
     * Add the result to the stage after this row is in place.
     */
    arcs(from: number, weights: readonly number[], options: { color?: ColorInput; maxWidth?: number; lift?: number } = {}): Node {
        // The mark of a state is on a corner of its cell, so a cell that has one is measured by its box.
        const around = (index: number) => {
            const cell = this.token(index)
            return cell.signs.length > 0 ? cell.box.bounds() : cell.bounds()
        }
        const source = around(from)
        const made = new Node()
        const startX = source.x + source.width / 2, startY = source.y - 3
        weights.forEach((weight, j) => {
            if (j === from || weight <= 0.01) return
            const target = around(j)
            const endX = target.x + target.width / 2, endY = target.y - 3
            const lift = options.lift ?? 40 + Math.abs(endX - startX) * 0.22
            const path = parseSvgPath(`M${startX} ${startY}C${startX} ${startY - lift} ${endX} ${endY - lift} ${endX} ${endY}`)
            const node = new Node(path).stroke(options.color ?? 'yellow', 0.8 + weight * (options.maxWidth ?? 6))
            node.set('strokeOpacity', 0.2 + weight * 0.8)
            made.add(node)
        })
        return made
    }

    /**
     * Lines from tokens of this strip to tokens of another one: a source and its translation, a question and
     * the words of a passage. A pair is `[index here, index there]`, or `[here, there, weight]` for a line
     * that is wider and brighter for a weight near 1. Each line is a child of the result, in the order of
     * the pairs, so draw them one by one. The two strips are one over the other, with a room of 1.5 of `size`
     * or more from under the values of the upper one to over the brackets of the lower one. Add the result
     * to the stage after both strips are in place: a line does not follow a token that moves later.
     */
    links(other: TokenRow, pairs: readonly (readonly [number, number] | readonly [number, number, number])[], options: { color?: ColorInput; width?: number } = {}): Node {
        if (!(other instanceof TokenRow)) throw new Error(`tokens: links: the first argument is ${shown(other)}. Give the other strip of tokens`)
        if (other === this) throw new Error('tokens: links joins two strips, and it got the same strip two times. For lines inside one strip, use arcs()')
        if (!Array.isArray(pairs)) throw new Error(`tokens: links: the second argument is ${shown(pairs)}. Give the pairs, such as [[0, 0], [1, 2]]`)
        const width = options.width ?? Math.max(2.5, this.size * 0.09)
        const made = new Node()
        pairs.forEach((pair, at) => {
            if (!Array.isArray(pair) || pair.length < 2) throw new Error(`tokens: links: pair ${at} is ${shown(pair)}. A pair is [index here, index there], such as [0, 2]`)
            const here = this.index(pair[0], 'links'), there = other.index(pair[1], 'links')
            const given = (pair as readonly number[])[2]
            const weight = given ?? 1
            if (!(typeof weight === 'number' && weight >= 0 && weight <= 1)) throw new Error(`tokens: links: the weight of pair ${at} is ${shown(weight)}. A weight is a number from 0 to 1`)
            const down = this.toWorld(...this.p(here, 'bottom')), up = this.toWorld(...this.p(here, 'top'))
            const below = other.toWorld(...other.p(there, 'bottom')), above = other.toWorld(...other.p(there, 'top'))
            let start: [number, number], end: [number, number]
            if (down[1] < above[1]) [start, end] = [down, above]
            else if (below[1] < up[1]) [start, end] = [up, below]
            else throw new Error('tokens: links: the two strips are at one height, so a line between them has no room. Put one strip over the other')
            // A line that has to go far to the side in a low room is flat, and it reads as a rule under the values.
            const matrix = this.worldMatrix(), least = this.size * 1.5 * Math.hypot(matrix[0], matrix[1])
            const room = Math.abs(end[1] - start[1])
            if (room < least) throw new Error(`tokens: links: the room between the two strips is ${Math.floor(room)} px, from under the values of the upper one to over the brackets of the lower one. A line needs ${Math.ceil(least)} px or more. Move the strips apart`)
            // The line leaves and arrives straight up or down, so it reads as a link of two cells.
            const middle = (start[1] + end[1]) / 2
            const line = new Node(parseSvgPath(`M${start[0]} ${start[1]}C${start[0]} ${middle} ${end[0]} ${middle} ${end[0]} ${end[1]}`)).stroke(options.color ?? 'yellow', given === undefined ? width : 0.8 + weight * width * 1.6)
            if (given !== undefined) line.set('strokeOpacity', 0.2 + weight * 0.8)
            made.add(line)
        })
        return made
    }

    /**
     * Tokens go to another state. `which` is an index, a list of indexes, or a function of a token and its
     * index, which the strip calls when the change is scheduled. So a second change in one sequence sees the
     * states that the first one left. The tokens change from the left, one after another, and the whole
     * change takes `duration`. A token that already has the state does not change.
     */
    mark(which: TokenPick, state: string, options: AnimOptions = {}): Anim {
        // Find a wrong name now, where the film names it.
        this.look(state)
        if (typeof which !== 'number' && typeof which !== 'function' && !Array.isArray(which)) throw new Error(`tokens: mark takes an index, a list of indexes, or a function of a token and its index, and it got ${shown(which)}`)
        return {
            label: 'tokens.mark', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const chosen = this.pick(which, 'mark').map((index) => this.chips[index]!).filter((cell) => cell.state !== state)
                // Each cell takes three tenths of the time, so the change reads as a sweep.
                const lag = options.lag ?? Math.min(1, (1 / 0.3 - 1) / Math.max(1, chosen.length - 1))
                const windows = staggered(chosen.length, Math.max(0, lag), ctx.t0, ctx.t1)
                chosen.forEach((cell, order) => this.restyle(cell, state, windows[order]![0], windows[order]![1], ctx.ease))
            },
        }
    }

    /**
     * Tokens arrive at the end of the strip, one after another, as a model writes them. Give one token or a
     * list. `from` is a node or a point of the stage: the token then starts there and flies to its place,
     * such as the bar of the candidate that won. The tokens that are there do not move.
     */
    append(items: string | number | TokenSpec | readonly (string | number | TokenSpec)[], options: AnimOptions & { from?: Node | Vec } = {}): Anim {
        this.oneLine('append')
        const list = Array.isArray(items) ? items as readonly (string | number | TokenSpec)[] : [items as string | number | TokenSpec]
        if (list.length === 0) throw new Error('tokens: append got an empty list. Give it a token, or a list of them')
        const specs = list.map((item, index) => this.spec(item, list.length === 1 ? 'the token of append' : `token ${index} of append`))
        const from = options.from
        if (from !== undefined && !(from instanceof Node) && !(Array.isArray(from) && from.length === 2 && Number.isFinite(from[0]) && Number.isFinite(from[1]))) throw new Error(`tokens: append: from is ${shown(from)}. Give a node, or a point [x, y] of the stage`)
        return {
            label: 'tokens.append', duration: options.duration ?? Math.max(0.6, 0.45 * specs.length), ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const cells = specs.map((spec, index) => this.make(spec, spec.color ?? this.tint, specs.length === 1 ? 'the token of append' : `token ${index} of append`))
                this.fits('append', cells.reduce((sum, cell) => sum + cell.wide + this.gap, this.chips.length === 0 ? -this.gap : 0))
                const windows = staggered(cells.length, Math.max(0, options.lag ?? 0.5), ctx.t0, ctx.t1)
                cells.forEach((cell, order) => {
                    const [start, end] = windows[order]!, at = this.chips.length
                    this.chips.push(cell)
                    cell.cx = this.middles()[at]! - this.originX
                    cell.cy = this.chips[0]!.cy
                    cell.settles = end
                    let x = cell.cx, y = cell.cy + 16
                    if (from !== undefined) {
                        // The place of the source when this token leaves it, in the coordinates of the strip.
                        clock.now = start
                        const [fx, fy] = from instanceof Node ? from.center : from as Vec
                        ;[x, y] = apply(invert(this.worldMatrix()), fx, fy)
                    }
                    cell.at(x, y).opacity(0)
                    clock.now = ctx.t0
                    this.insert(cell)
                    cell.tween('opacity', 1, start, from === undefined ? end : start + (end - start) * 0.35, ctx.ease)
                    cell.tween('x', cell.cx, start, end, ctx.ease)
                    cell.tween('y', cell.cy, start, end, ctx.ease)
                    this.rows.forEach((row) => {
                        const value = this.valueNode(specs[order]!.values[row.key] ?? null, cell, row)
                        row.values.push(value)
                        if (value) this.arrive(row, value, start + (end - start) * 0.5, end, ctx.ease)
                    })
                })
            },
        }
    }

    /**
     * One token becomes its pieces: a word its sub-words, a character its bytes. The box is cut, and the
     * pieces pull apart. When the pieces spell the token, each letter moves to its piece. The tokens after
     * it move to make room. A piece has the state and the color of the token, unless it names its own.
     */
    split(index: number, pieces: readonly (string | number | TokenSpec)[], options: AnimOptions = {}): Anim {
        this.oneLine('split')
        if (!Array.isArray(pieces) || pieces.length < 2) throw new Error(`tokens: split takes the pieces of the token, two or more, such as strip.split(1, ['un', 'believ', 'able']), and it got ${Array.isArray(pieces) ? plural(pieces.length, 'piece') : shown(pieces)}`)
        const specs = pieces.map((piece, at) => this.spec(piece, `piece ${at} of split`))
        return {
            label: 'tokens.split', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const at = this.index(index, 'split', true), old = this.chips[at]!
                this.free(old, at, 'split', ctx.t0)
                const { t0, t1, ease } = ctx, time = (share: number) => t0 + (t1 - t0) * share
                const made = specs.map((spec, order) => this.make({ ...spec, state: spec.state ?? old.state }, spec.color ?? old.tint, `piece ${order} of split`))
                this.fits('split', made.reduce((sum, cell) => sum + cell.wide + this.gap, -this.gap) - old.wide)
                this.chips.splice(at, 1, ...made)
                const middles = this.middles()
                made.forEach((cell, order) => {
                    cell.cx = middles[at + order]! - this.originX
                    cell.cy = old.cy
                    cell.settles = t1
                })
                const exact = this.spells([old], made)
                // With the letters of the token in the pieces, the box is cut at the start and the letters move.
                // With other texts, the old text leaves first, so the lines of the cut do not cross it.
                const [cutFrom, cutTo] = exact ? [t0, time(0.3)] : [time(0.3), time(0.55)]
                // The token may still be on its way to a new place, after another change of the same play. The
                // pieces start where it is now, and it stops there.
                const here = sampleAt(old, 'x', t0)
                stepAt(old, 'x', here, t0)
                // Each piece starts as its part of the box of the token.
                const letters = exact ? this.between(old.text, made.map((cell) => cell.text.chars.length), (glyph) => here + sampleAt(glyph, 'x', t0) - old.text.get('px')) : null
                const edges = this.parts(made.map((cell) => cell.wide), here - old.wide / 2, old.wide, letters)
                let glyph = 0
                clock.now = t0
                made.forEach((cell, order) => {
                    const whole = cell.box.get('path')!, slice = this.boxPath(edges[order]! - cell.cx, edges[order + 1]! - edges[order]!)
                    cell.at(cell.cx, cell.cy)
                    cell.box.opacity(0)
                    // A letter starts where it is in the token, and moves to its place in the piece.
                    const moves = exact ? cell.text.chars.map((char) => {
                        const before = old.text.chars[glyph++]!, x = char.get('x')
                        char.set('x', here - cell.cx + sampleAt(before, 'x', t0) - old.text.get('px') + cell.text.get('px'))
                        return [char, x] as const
                    }) : []
                    if (!exact) cell.text.opacity(0)
                    for (const sign of [cell.sub, ...cell.signs]) sign?.opacity(0)
                    // The cell is on the stage from here on, so what follows are changes on the timeline.
                    this.insert(cell)
                    for (const [char, x] of moves) char.tween('x', x, t0, t1, ease)
                    cell.box.track('path').add({ t0, t1, ease, to: whole, at: lerpSame(slice, whole) })
                    cell.box.tween('opacity', 1, cutFrom, cutTo, ease)
                    if (!exact) cell.text.tween('opacity', 1, time(0.6), t1, ease)
                    for (const sign of [cell.sub, ...cell.signs]) sign?.tween('opacity', 1, time(0.6), t1, ease)
                })
                // The box of the token leaves while the boxes of the pieces come, so the cut fades in.
                old.box.tween('opacity', 0, cutFrom, cutTo, ease)
                if (exact) stepAt(old.text, 'visible', false, t0)
                else old.text.tween('opacity', 0, t0, time(0.3), ease)
                for (const sign of [old.sub, ...old.signs]) sign?.tween('opacity', 0, t0, time(0.3), ease)
                this.bury(old, cutTo, made[0]!.cx)
                for (const row of this.rows) {
                    const gone = row.values[at]
                    const values = made.map((cell, order) => this.valueNode(specs[order]!.values[row.key] ?? null, cell, row))
                    row.values.splice(at, 1, ...values)
                    if (gone) this.leave(gone, t0, time(0.3), ease, made[0]!.cx)
                    for (const value of values) if (value) this.arrive(row, value, time(0.6), t1, ease)
                }
                this.follow([old], made[0]!, made[made.length - 1]!)
                this.settle(t0, t1, ease)
            },
        }
    }

    /**
     * The tokens from `from` to `to` become one token, as in a merge of byte pair encoding. The boxes come
     * together into one box. When the new token spells the old ones, each letter moves to its place in it.
     * The tokens after it move to close the room. `token` is the new token: without it, the text is the
     * texts of the old ones, joined. The new token has the color of the first one, and their state when they
     * share one.
     */
    merge(from: number, to: number, token?: string | number | Partial<TokenSpec>, options: AnimOptions = {}): Anim {
        this.oneLine('merge')
        if (!Number.isInteger(from) || !Number.isInteger(to) || from >= to) throw new Error(`tokens: merge takes the first and the last token of a run of two or more, such as strip.merge(0, 1), and it got ${shown(from)} and ${shown(to)}`)
        if (typeof token === 'object' && token !== null && !['text', 'sub', 'color', 'state', 'values'].some((name) => name in token) && ['duration', 'ease', 'lag'].some((name) => name in token)) {
            throw new Error('tokens: the third argument of merge is the new token, and the options are the fourth: strip.merge(0, 1, undefined, { duration: 1 })')
        }
        const given = token === undefined ? null : this.spec(typeof token === 'object' && token !== null && !('text' in token) ? { ...token, text: '' } : token, 'the token of merge')
        const named = token !== undefined && (typeof token !== 'object' || token === null || 'text' in token)
        return {
            label: 'tokens.merge', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const first = this.index(from, 'merge', true), last = this.index(to, 'merge', true)
                const olds = this.chips.slice(first, last + 1)
                olds.forEach((old, order) => this.free(old, first + order, 'merge', ctx.t0))
                const { t0, t1, ease } = ctx, time = (share: number) => t0 + (t1 - t0) * share
                const state = given?.state ?? (olds.every((old) => old.state === olds[0]!.state) ? olds[0]!.state : this.stateNames[0]!)
                const spec: Spec = { ...(given ?? { values: {} }), text: named ? given!.text : olds.map((old) => old.source).join(''), state }
                const cell = this.make(spec, spec.color ?? olds[0]!.tint, 'the token of merge')
                this.chips.splice(first, olds.length, cell)
                cell.cx = this.middles()[first]! - this.originX
                cell.cy = olds[0]!.cy
                cell.settles = t1
                const exact = this.spells(olds, [cell])
                // With the letters of the old tokens in the new one, the letters move, and the lines between the
                // old boxes leave last. With another text, the old texts leave first, and the lines are gone
                // before the new text comes, so no line crosses a text.
                const [joinFrom, joinTo] = exact ? [time(0.7), t1] : [time(0.55), time(0.8)]
                // The new cell holds the moving parts: a copy of each old box, which goes to its part of the new
                // box, and its own letters, which start at the places of the old ones. So the parts go with the
                // new cell when another change of the same play moves it.
                const letters = exact ? this.between(cell.text, olds.map((old) => old.text.chars.length), (char) => cell.cx + char.get('x') - cell.text.get('px')) : null
                const edges = this.parts(olds.map((old) => old.wide), cell.cx - cell.wide / 2, cell.wide, letters)
                let glyph = 0
                const copies: [Node, Path, Path][] = [], moves: [Node, number][] = []
                olds.forEach((old, order) => {
                    // An old cell may still be on its way to a new place, after another change of the same play.
                    const here = sampleAt(old, 'x', t0)
                    const own = this.boxPath(here - old.wide / 2 - cell.cx, old.wide), slice = this.boxPath(edges[order]! - cell.cx, edges[order + 1]! - edges[order]!)
                    const copy = new Node(own)
                    for (const prop of ['fill', 'fillOpacity', 'stroke', 'strokeOpacity', 'strokeWidth', 'dash'] as const) copy.set(prop, sampleAt(old.box, prop, t0) as never)
                    copies.push([copy, own, slice])
                    if (exact) {
                        for (const char of old.text.chars) {
                            const after = cell.text.chars[glyph++]!
                            moves.push([after, after.get('x')])
                            after.set('x', here - cell.cx + sampleAt(char, 'x', t0) - old.text.get('px') + cell.text.get('px'))
                        }
                    }
                    // The old cell gives its box and its letters to the new one at the start. Its marks fade where they are.
                    stepAt(old.box, 'visible', false, t0)
                    if (exact) stepAt(old.text, 'visible', false, t0)
                    else old.text.tween('opacity', 0, t0, time(0.4), ease)
                    for (const sign of [old.sub, ...old.signs]) sign?.tween('opacity', 0, t0, time(0.3), ease)
                    stepAt(old, 'x', here, t0)
                    this.bury(old, time(exact ? 0.3 : 0.4), cell.cx)
                })
                cell.at(cell.cx, cell.cy)
                cell.box.opacity(0)
                if (!exact) cell.text.opacity(0)
                for (const sign of [cell.sub, ...cell.signs]) sign?.opacity(0)
                // The copies are under the new box and its text.
                for (const [copy] of copies) copy.parent = cell
                cell.children = [...copies.map(([copy]) => copy), ...cell.children]
                clock.now = t0
                this.insert(cell)
                // The new box comes while the copies leave, so the lines between the old boxes fade out.
                for (const [copy, own, slice] of copies) {
                    copy.track('path').add({ t0, t1: joinTo, ease, to: slice, at: lerpSame(own, slice) })
                    copy.tween('opacity', 0, joinFrom, joinTo, ease)
                    stepAt(copy, 'visible', false, joinTo)
                }
                for (const [char, x] of moves) char.tween('x', x, t0, t1, ease)
                cell.box.tween('opacity', 1, joinFrom, joinTo, ease)
                if (!exact) cell.text.tween('opacity', 1, time(0.8), t1, ease)
                for (const sign of [cell.sub, ...cell.signs]) sign?.tween('opacity', 1, time(0.7), t1, ease)
                for (const row of this.rows) {
                    const gone = row.values.slice(first, last + 1)
                    const value = this.valueNode(spec.values[row.key] ?? null, cell, row)
                    row.values.splice(first, olds.length, value)
                    for (const old of gone) if (old) this.leave(old, t0, time(0.4), ease, cell.cx)
                    if (value) this.arrive(row, value, time(0.6), t1, ease)
                }
                this.follow(olds, cell, cell)
                this.settle(t0, t1, ease)
            },
        }
    }

    /**
     * The values of a row move `by` cells: -1 puts each value under the token before its own, as the
     * targets of a language model are under its inputs. A value that leaves the strip fades out. A value
     * that is too wide for its new cell is an error.
     */
    shiftRow(row: string, by: number, options: AnimOptions = {}): Anim {
        this.oneLine('shiftRow')
        const line = this.row(row)
        if (!Number.isInteger(by) || by === 0) throw new Error(`tokens: shiftRow moves the values of a row by a whole number of cells, such as -1, and it got ${shown(by)}`)
        return {
            label: 'tokens.shiftRow', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx, count = this.chips.length
                line.values.forEach((value, index) => {
                    const target = this.chips[index + by]
                    if (value && target) this.fitValue(value, target, index + by, 'shiftRow', row)
                })
                const next: (TextNode | null)[] = this.chips.map(() => null)
                line.values.forEach((value, index) => {
                    if (!value) return
                    const to = index + by
                    if (to >= 0 && to < count) {
                        value.tween('x', this.chips[to]!.cx, t0, t1, ease)
                        next[to] = value
                        return
                    }
                    // The value starts on its way out of the strip and fades. It is gone before it is half a
                    // cell from the end cell, so it does not reach the name of the row.
                    const end = this.chips[to < 0 ? 0 : count - 1]!
                    value.tween('x', sampleAt(value, 'x', t0) + Math.sign(by) * (end.wide + this.gap) / 2, t0, t1, ease)
                    this.leave(value, t0, t0 + (t1 - t0) * 0.5, ease, end.cx, t1)
                })
                line.values = next
            },
        }
    }

    /**
     * The value of a row under one token changes in place: the old text fades out, then the new one fades
     * in. Null or an empty text takes the value away. A text that is too wide for the cell is an error.
     */
    setValue(row: string, index: number, value: string | number | null, options: AnimOptions = {}): Anim {
        this.oneLine('setValue')
        const line = this.row(row)
        const content = this.valueText(value, `the new value of the row ${JSON.stringify(row)}`)
        return {
            label: 'tokens.setValue', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const at = this.index(index, 'setValue', true), cell = this.chips[at]!, old = line.values[at] ?? null
                if ((old?.source ?? null) === content) return
                const next = this.valueNode(content, cell, line)
                if (next) this.fitValue(next, cell, at, 'setValue', row)
                const turn = old && next ? (ctx.t0 + ctx.t1) / 2 : old ? ctx.t1 : ctx.t0
                if (old) this.leave(old, ctx.t0, turn, ctx.ease, cell.cx)
                if (next) this.arrive(line, next, turn, ctx.t1, ctx.ease)
                line.values[at] = next
            },
        }
    }

    /**
     * One window over a run of tokens: an outline around the cells from `from` to `to`. The first call
     * brings it in. A later call slides it and changes its size, so the viewer sees it move. `window(null)`
     * takes it away. The window follows its tokens when a change moves them.
     */
    window(from: number | null, to?: number, options: AnimOptions & { color?: ColorInput } = {}): Anim {
        this.oneLine('window')
        if (from !== null && (!Number.isInteger(from) || (to !== undefined && !Number.isInteger(to)))) throw new Error(`tokens: window takes the first and the last token under it, such as strip.window(0, 3), or null for no window, and it got ${shown(from)} and ${shown(to)}`)
        const paint = options.color === undefined ? null : this.paintOf(options.color, 'the color of the window')
        return {
            label: 'tokens.window', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx
                if (from === null) {
                    if (this.windowFirst) this.frame!.tween('opacity', 0, t0, t1, ease)
                    this.windowFirst = this.windowLast = null
                    return
                }
                const [a, b] = this.run(from, to ?? from, 'window', true)
                const first = this.chips[a]!, last = this.chips[b]!
                const ends: [number, number] = [first.cx - first.wide / 2, last.cx + last.wide / 2], path = this.framePath(ends)
                if (!this.frame) {
                    clock.now = t0
                    this.frame = new Node(path).stroke(options.color ?? 'yellow', Math.max(2.5, this.size * 0.07)).opacity(0)
                    this.add(this.frame)
                }
                const frame = this.frame
                if (paint) frame.tween('stroke', paint, t0, t1, ease)
                if (this.windowFirst) {
                    frame.track('path').add({ t0, t1, ease, to: path, at: lerpSame(sampleAt(frame, 'path', t0)!, path) })
                } else {
                    // A window that was away comes in at its new place: it does not slide from the old one.
                    stepAt(frame, 'path', path, t0)
                    frame.tween('opacity', 1, t0, t1, ease)
                }
                this.windowFirst = first
                this.windowLast = last
                this.windowEnds = ends
            },
        }
    }

    /**
     * A bracket over the tokens from `from` to `to`, by its id. The first call with an id draws the bracket
     * and brings its label. A later call with the same id slides it to other tokens, and a new `label`
     * takes the place of the old one. `span(id, null)` takes it away. A bracket that would meet another one
     * goes a level higher when it arrives. A bracket follows its tokens when a change moves them.
     */
    span(id: string, from: number | null, to?: number, options: AnimOptions & { label?: string; color?: ColorInput } = {}): Anim {
        this.oneLine('span')
        if (typeof id !== 'string' || id === '') throw new Error(`tokens: span takes the id of the bracket first, such as strip.span('prompt', 0, 3), and it got ${shown(id)}`)
        if (from !== null && (!Number.isInteger(from) || (to !== undefined && !Number.isInteger(to)))) throw new Error(`tokens: span takes the first and the last token under the bracket, such as strip.span(${JSON.stringify(id)}, 0, 3), or null to take it away, and it got ${shown(from)} and ${shown(to)}`)
        if (options.label !== undefined && (typeof options.label !== 'string' || /[\r\n]/.test(options.label))) throw new Error(`tokens: the label of the span ${JSON.stringify(id)} is ${shown(options.label)}. A label is one line of text`)
        if (options.color !== undefined) this.paintOf(options.color, `the color of the span ${JSON.stringify(id)}`)
        return {
            label: 'tokens.span', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx
                const old = this.spans.find((span) => span.key === id) ?? null
                if (from === null) {
                    if (!old) return
                    old.tween('opacity', 0, t0, t1, ease)
                    this.bury(old, t1, (old.from + old.to) / 2)
                    this.spans.splice(this.spans.indexOf(old), 1)
                    return
                }
                const [a, b] = this.run(from, to ?? from, 'span', true)
                const first = this.chips[a]!, last = this.chips[b]!
                if (!old) {
                    const span = this.bracket(id, first, last, options.label ?? id, options.color ?? 'dim')
                    this.raise(span, this.freeLevel(span))
                    span.bracket.set('trimTo', 0)
                    span.text?.opacity(0)
                    clock.now = t0
                    this.add(span)
                    if (span.text) ownLabels(this, { labels: [span.text] })
                    span.bracket.tween('trimTo', 1, t0, t1, ease)
                    span.text?.tween('opacity', 1, t0 + (t1 - t0) * 0.4, t1, ease)
                    this.spans.push(span)
                    return
                }
                if (options.label !== undefined && options.label !== (old.text?.source ?? '')) {
                    // The new label comes when the old one is gone, so no moment shows two texts at one place.
                    const turn = old.text && options.label ? (t0 + t1) / 2 : old.text ? t1 : t0
                    const next = options.label ? text(options.label, { size: this.rowSize, color: old.tint }).opacity(0) : null
                    // The new label starts where the bracket is now, and moves with it.
                    next?.at((old.from + old.to) / 2, this.spanLine(old.level) - this.rowSize * 0.85)
                    if (old.text) {
                        old.text.tween('opacity', 0, t0, turn, ease)
                        stepAt(old.text, 'visible', false, turn)
                    }
                    if (next) {
                        clock.now = t0
                        old.add(next)
                        ownLabels(this, { labels: [next] })
                        next.tween('opacity', 1, turn, t1, ease)
                    }
                    old.text = next
                }
                if (options.color !== undefined) {
                    const paint = toPaint(options.color)
                    old.tint = options.color
                    old.bracket.tween('stroke', paint, t0, t1, ease)
                    for (const glyph of old.text?.chars ?? []) glyph.tween('fill', paint, t0, t1, ease)
                }
                old.first = first
                old.last = last
                this.lay(old, t0, t1, ease)
                this.clear(old, 'span')
            },
        }
    }

    // ── Checks of what a film gives ─────────────────────────────────────────

    private known(): string {
        const count = this.chips.length
        return count === 0 ? 'The strip has no token' : `The strip has ${plural(count, 'token')}, ${count === 1 ? '0' : `0 to ${count - 1}`}`
    }

    /**
     * The index of a token that the strip has now, or an error that names the call and the tokens. A change
     * reads its index when the film plays it, so its error says that the changes before it count.
     */
    private index(index: unknown, what: string, played = false): number {
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= this.chips.length) {
            throw new Error(`tokens: ${what ? `${what}: ` : ''}no token ${shown(index)}. ${this.known()}${played ? ' now. A change reads its index when the film plays it, after the changes before it in the same play' : ''}`)
        }
        return index
    }

    /** The first and the last token of a run, in order. */
    private run(from: unknown, to: unknown, what: string, played = false): [number, number] {
        const a = this.index(from, what, played), b = this.index(to, what, played)
        if (a > b) throw new Error(`tokens: ${what}: the run starts at token ${a} and ends at token ${b}. Give the first token, and then the last`)
        return [a, b]
    }

    private pick(which: TokenPick, what: string): number[] {
        if (typeof which === 'function') return this.chips.flatMap((cell, index) => (which({ text: cell.source, state: cell.state }, index) ? [index] : []))
        const list = typeof which === 'number' ? [which] : which
        return [...new Set(list.map((index) => this.index(index, what, true)))].sort((a, b) => a - b)
    }

    private look(state: unknown): Look {
        const look = typeof state === 'string' ? this.looks.get(state) : undefined
        if (!look) throw new Error(`tokens: no state ${shown(state)}. The states are ${this.stateNames.join(', ')}`)
        return look
    }

    private paintOf(color: ColorInput, what: string) {
        try {
            return toPaint(color)
        } catch {
            throw new Error(`tokens: ${what} is ${shown(color)}, which is not a color. Use a color of the look, such as 'orange', or a CSS color`)
        }
    }

    /** The parts that follow the tokens need one line: a chip that goes to another line would leave its values and its bracket. */
    private oneLine(what: string): void {
        if (this.wraps !== null) throw new Error(`tokens: ${what} works on a strip of one line, and this strip starts new lines at maxWidth ${this.wraps}. Leave out maxWidth, or give width for the room of one line`)
    }

    /** A token as the strip keeps it, from what the film gave. */
    private spec(item: unknown, what: string): Spec {
        if (typeof item === 'string' || typeof item === 'number') item = { text: item }
        if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`tokens: ${what} is ${shown(item)}. A token is a text, such as 'cat', or an object, such as { text: 'cat', state: 'masked' }`)
        const given = item as { text?: unknown; sub?: unknown; color?: ColorInput; state?: unknown; values?: unknown }
        if (typeof given.text !== 'string' && typeof given.text !== 'number') throw new Error(`tokens: the text of ${what} is ${shown(given.text)}. Give a text, such as { text: 'cat' }`)
        const content = String(given.text)
        // A second line would leave the cell.
        if (/[\r\n]/.test(content)) throw new Error(`tokens: ${what} (${JSON.stringify(content)}) has a line break. A token is one line. Write the line break as the two characters that a tokenizer shows: '\\\\n'`)
        if (given.sub !== undefined && typeof given.sub !== 'string' && typeof given.sub !== 'number') throw new Error(`tokens: the sub of ${what} is ${shown(given.sub)}. It is the small line under the chip, such as '9246'`)
        if (given.sub !== undefined && given.sub !== '' && this.rows.length > 0) throw new Error(`tokens: ${what} has a sub, and a strip with rows has no line under a chip. Give the text as a value of a row, such as values: { ${this.rows[0]!.key}: ${JSON.stringify(String(given.sub))} }`)
        if (given.state !== undefined) this.look(given.state)
        if (given.color !== undefined) this.paintOf(given.color, `the color of ${what}`)
        const values: Record<string, string | null> = {}
        if (given.values !== undefined) {
            if (typeof given.values !== 'object' || given.values === null || Array.isArray(given.values)) throw new Error(`tokens: the values of ${what} are ${shown(given.values)}. Give them by the name of the row, such as { id: 2103 }`)
            for (const [name, value] of Object.entries(given.values)) {
                this.row(name)
                values[name] = this.valueText(value, `the value of ${what} in the row ${JSON.stringify(name)}`)
            }
        }
        return { text: content, sub: given.sub === undefined || given.sub === '' ? undefined : String(given.sub), color: given.color, state: given.state as string | undefined, values }
    }

    /** A value of a row as its text. Null and an empty text are no value. */
    private valueText(value: unknown, what: string): string | null {
        if (value === undefined || value === null || value === '') return null
        if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`tokens: ${what} is ${shown(value)}. A value is a text or a number, such as '0.62', or null for none`)
        const content = String(value)
        if (/[\r\n]/.test(content)) throw new Error(`tokens: ${what} (${JSON.stringify(content)}) has a line break. A value is one line`)
        return content
    }

    /** A split or a merge starts from a cell at rest: its box and its letters are still on their way while the change that made it runs. */
    private free(cell: TokenCell, index: number, what: string, start: number): void {
        if (cell.settles > start + 1e-9) throw new Error(`tokens: ${what} at ${seconds(start)} takes token ${index} (${JSON.stringify(cell.source)}), which the change before it still brings in until ${seconds(cell.settles)}. Play the two one after the other: seq(first, second), or two calls of s.play`)
    }

    /** The cells of a strip with a `width` stay in its room. */
    private fits(what: string, more: number): void {
        if (this.room === null) return
        const wide = this.chips.reduce((sum, cell) => sum + cell.wide + this.gap, -this.gap) + (this.chips.length === 0 ? this.gap : 0) + more
        if (wide > this.room + 0.5) throw new Error(`tokens: ${what}: the tokens would be ${Math.ceil(wide)} px wide, and the width of the strip is ${this.room}. Give the strip a width of ${Math.ceil(wide)} or more, a smaller size, or fewer tokens`)
    }

    private fitValue(value: TextNode, cell: TokenCell, index: number, what: string, row: string): void {
        const need = (value.data['ink'] as number) + this.rowSize * VALUE_PAD * 2
        if (need <= cell.wide + 1e-6) return
        throw new Error(`tokens: ${what}: the value ${JSON.stringify(value.source)} of the row ${JSON.stringify(row)} needs ${Math.ceil(need)} px, and the cell of token ${index} (${JSON.stringify(cell.source)}) is ${Math.floor(cell.wide)} px wide. Give the strip ${this.even === null ? 'even: true, or ' : ''}minWidth: ${Math.ceil(need)}, or a shorter value`)
    }

    // ── The parts ───────────────────────────────────────────────────────────

    /** The width that a token and its values need: the cell holds its text, and each value under it. */
    private need(spec: Spec): number {
        const label = text(spec.text.replace(/ /g, '·'), { size: this.size, font: this.font ?? 'mono' })
        const values = Object.values(spec.values).map((value) => (value === null ? 0 : text(value, { size: this.rowSize, font: 'mono' }).width + this.rowSize * VALUE_PAD * 2))
        return Math.max(Math.max(label.width, this.size * 0.5) + this.padX * 2, this.least, ...values)
    }

    /** A cell with its box, its text and the marks of its state, around its own origin. */
    private make(spec: Spec, color: ColorInput, what: string): TokenCell {
        const size = this.size, h = this.high
        const label = text(spec.text.replace(/ /g, '·'), { size, font: this.font ?? 'mono', color: 'ink' })
        let w = Math.max(label.width, size * 0.5) + this.padX * 2
        // The widths of the old row of chips come from this line alone. The rest is for a strip that asks for more.
        const least = Math.max(this.least, ...Object.values(spec.values).map((value) => (value === null ? 0 : text(value, { size: this.rowSize, font: 'mono' }).width + this.rowSize * VALUE_PAD * 2)))
        if (least > w) w = least
        if (this.even !== null) {
            if (w > this.even + 1e-6) throw new Error(`tokens: ${what} (${JSON.stringify(spec.text)}) needs a cell of ${Math.ceil(w)} px, and the cells of this even strip are ${Math.floor(this.even)} px wide. Give the strip minWidth: ${Math.ceil(w)}, or leave out even`)
            w = this.even
        }
        const cell = new TokenCell()
        const box = new Node(rectPath(-w / 2, -h / 2, w, h, this.radius)).fill(color, FILL).stroke(color, BORDER)
        cell.add(box, label.at(0, 0))
        if (spec.sub) {
            cell.sub = text(spec.sub, { size: this.subSize, font: 'mono', color: 'dim' }).at(0, h / 2 + this.subSize * 0.82)
            cell.add(cell.sub)
        }
        cell.data['box'] = box
        cell.box = box
        cell.text = label
        cell.source = spec.text
        cell.tint = color
        cell.wide = w
        cell.ink = inkOf(label)
        cell.state = spec.state ?? this.stateNames[0]!
        const look = this.look(cell.state)
        // A state with no look of its own leaves the cell as the row of chips always drew it.
        if (look.color !== null) box.fill(look.color).stroke(look.color)
        if (look.fill !== FILL) box.set('fillOpacity', look.fill)
        if (look.dash) box.set('dash', this.dashes())
        if (look.dim) for (const glyph of label.chars) glyph.set('fill', toPaint('dim'))
        cell.signs = this.signsOf(cell, look)
        if (cell.signs.length > 0) cell.add(...cell.signs)
        return cell
    }

    private dashes(): readonly number[] {
        return [this.size * 0.3, this.size * 0.22]
    }

    /** The outline of a cell that is `wide`, with its left edge at `left` from the middle of the cell that owns it. */
    private boxPath(left: number, wide: number): Path {
        return rectPath(left, -this.high / 2, wide, this.high, this.radius)
    }

    /** The marks of a state on a cell, in the coordinates of the cell. Color is not the only sign of a state. */
    private signsOf(cell: TokenCell, look: Look): Node[] {
        if (look.mark === null) return []
        const size = this.size, w = cell.wide, h = this.high, color = look.color ?? cell.tint, ink = cell.ink
        if (look.mark === 'hatch') {
            // The lines stop a little inside the border, and around the text.
            const inset = Math.min(this.radius * 0.3 + 1, w / 4)
            const clear = ink ? { x: ink.x - size * 0.2, y: ink.y - size * 0.14, width: ink.width + size * 0.4, height: ink.height + size * 0.28 } : null
            return [new Node(hatch({ x: -w / 2 + inset, y: -h / 2 + inset, width: w - inset * 2, height: h - inset * 2 }, size * 0.42, clear)).stroke(color, Math.max(1, size * 0.05), 0.6)]
        }
        if (look.mark === 'strike') {
            // A thin filled bar through the middle of the letters, a little longer than the text. The film
            // check knows a strike by this shape: a line that is a stroke would be a line that crosses a text.
            const reach = Math.min(w / 2 - 1, (ink ? ink.width / 2 : w * 0.25) + size * 0.16), middle = ink ? ink.x + ink.width / 2 : 0
            const y = ink ? ink.y + ink.height / 2 : 0, thick = Math.max(2, size * 0.085)
            const from = Math.max(-w / 2 + 1, middle - reach), to = Math.min(w / 2 - 1, middle + reach)
            return [new Node(rectPath(from, y - thick / 2, to - from, thick, thick / 2)).fill(color)]
        }
        if (look.mark === 'bar') {
            // On the bottom edge of the box, between its two corners: clear of the tails of the letters.
            const thick = Math.max(3, size * 0.11), side = Math.min(Math.max(this.radius, thick / 2), w / 4)
            return [new Node(rectPath(-w / 2 + side, h / 2 - thick / 2, w - side * 2, thick, thick / 2)).fill(color)]
        }
        // A disc on the top right corner. It is over the room between two cells, and it does not reach the next cell.
        const x = w / 2 - size * 0.1, y = -h / 2 + size * 0.1
        if (look.mark === 'dot') return [new Node(circlePath(x, y, size * 0.2)).fill(color).stroke('bg', Math.max(1.5, size * 0.06))]
        const r = size * 0.3, line = Math.max(2, size * 0.085)
        const sign = look.mark === 'check'
            ? polyPath([[x - r * 0.48, y + r * 0.04], [x - r * 0.14, y + r * 0.38], [x + r * 0.5, y - r * 0.34]])
            : [...linePath([x - r * 0.38, y - r * 0.38], [x + r * 0.38, y + r * 0.38]), ...linePath([x - r * 0.38, y + r * 0.38], [x + r * 0.38, y - r * 0.38])]
        return [new Node().add(new Node(circlePath(x, y, r)).fill(color), new Node(sign).stroke('bg', line))]
    }

    /** The text of a value under a cell, at its place in its row. Null for no value. */
    private valueNode(content: string | null, cell: TokenCell, row: TokenValueRow): TextNode | null {
        if (content === null) return null
        const made = text(content, { size: this.rowSize, font: 'mono', color: 'dim' })
        made.data['ink'] = made.width
        return made.at(cell.cx, row.line)
    }

    /** A bracket over a run of cells, with its label. It has no level yet. */
    private bracket(id: string, first: TokenCell, last: TokenCell, label: string | undefined, color: ColorInput): TokenSpanNode {
        if (label !== undefined && (typeof label !== 'string' || /[\r\n]/.test(label))) throw new Error(`tokens: the label of the span ${JSON.stringify(id)} is ${shown(label)}. A label is one line of text`)
        const span = new TokenSpanNode()
        span.key = id
        span.first = first
        span.last = last
        span.tint = color
        span.from = first.cx - first.wide / 2
        span.to = last.cx + last.wide / 2
        span.bracket = new Node(this.bracketPath(span.from, span.to, 0)).stroke(color, Math.max(2, this.size * 0.075))
        span.add(span.bracket)
        if (label) {
            span.text = text(label, { size: this.rowSize, color })
            span.add(span.text)
        }
        return span
    }

    /** The y of the line of the brackets of a level. */
    private spanLine(level: number): number {
        return -this.high / 2 - this.size * SPAN_RISE - level * (this.rowSize * 1.8 + this.size * SPAN_TICK)
    }

    private bracketPath(from: number, to: number, level: number): Path {
        const y = this.spanLine(level), tick = this.size * SPAN_TICK
        return polyPath([[from, y + tick], [from, y], [to, y], [to, y + tick]])
    }

    /**
     * True when two brackets cannot be on one level: their lines would cross, or their labels would meet. A
     * label is over the line of its bracket, so a label that is wider than its bracket may go over the end
     * of the line of the next one.
     */
    private meets(a: TokenSpanNode, b: TokenSpanNode): boolean {
        if (a.from < b.to && b.from < a.to) return true
        if (!a.text || !b.text) return false
        const room = ((inkOf(a.text)?.width ?? 0) + (inkOf(b.text)?.width ?? 0)) / 2 + this.rowSize * 0.6
        return Math.abs((a.from + a.to) / 2 - (b.from + b.to) / 2) < room
    }

    /** The lowest level at which a bracket meets none of the brackets that have a level. */
    private freeLevel(span: TokenSpanNode, among: readonly TokenSpanNode[] = this.spans): number {
        let level = 0
        while (among.some((other) => other !== span && other.level === level && this.meets(span, other))) level += 1
        return level
    }

    /** Put a bracket that is not on the stage yet at a level. */
    private raise(span: TokenSpanNode, level: number): void {
        span.level = level
        span.bracket.set('path', this.bracketPath(span.from, span.to, level))
        span.text?.at((span.from + span.to) / 2, this.spanLine(level) - this.rowSize * 0.85)
    }

    /** A bracket that moved must not be on another one of its level. */
    private clear(span: TokenSpanNode, what: string): void {
        const other = this.spans.find((own) => own !== span && own.level === span.level && this.meets(span, own))
        if (other) throw new Error(`tokens: ${what}: the span ${JSON.stringify(span.key)} would be on the span ${JSON.stringify(other.key)}, with its label. Take one of the two away first, such as strip.span(${JSON.stringify(other.key)}, null), or give shorter labels`)
    }

    private framePath(ends: readonly [number, number]): Path {
        // The outline is in the room between two cells, nearer to its own cells than to the next ones.
        const side = this.gap * 0.4, over = this.size * 0.2
        return rectPath(ends[0] - side, -this.high / 2 - over, ends[1] - ends[0] + side * 2, this.high + over * 2, this.radius + side)
    }

    // ── Changes ─────────────────────────────────────────────────────────────

    /** The middle of each cell from the left end of the line, in the order of the cells. */
    private middles(): number[] {
        let x = 0
        return this.chips.map((cell) => {
            const middle = x + cell.wide / 2
            x += cell.wide + this.gap
            return middle
        })
    }

    /** Put a new cell in the tree after the other cells, so the rows, the brackets and the window stay over it. */
    private insert(cell: TokenCell): void {
        cell.parent?.drop(cell)
        cell.parent = this
        this.children.splice(this.head, 0, cell)
        this.head += 1
        if (this.mounted) mountTree(cell, clock.now)
        ownLabels(this, { labels: [cell.text, cell.sub] })
    }

    /** Hide a part that left, and put it at a point inside the strip, so the layout does not measure the place that it had. */
    private bury(node: Node, time: number, x: number): void {
        stepAt(node, 'visible', false, time)
        stepAt(node, 'x', x, time)
        stepAt(node, 'sx', 0, time)
        stepAt(node, 'sy', 0, time)
    }

    private leave(value: Node, t0: number, t1: number, ease: Ease, x: number, gone = t1): void {
        value.tween('opacity', 0, t0, t1, ease)
        this.bury(value, gone, x)
    }

    private arrive(row: TokenValueRow, value: TextNode, t0: number, t1: number, ease: Ease): void {
        value.opacity(0)
        const saved = clock.now
        clock.now = Math.min(saved, t0)
        row.add(value)
        clock.now = saved
        ownLabels(this, { labels: [value] })
        value.tween('opacity', 1, t0, t1, ease)
    }

    /** The brackets and the window that ended on cells that left now end on the cells that took their place. */
    private follow(olds: readonly TokenCell[], first: TokenCell, last: TokenCell): void {
        for (const span of this.spans) {
            if (olds.includes(span.first)) span.first = first
            if (olds.includes(span.last)) span.last = last
        }
        if (this.windowFirst && olds.includes(this.windowFirst)) this.windowFirst = first
        if (this.windowLast && olds.includes(this.windowLast)) this.windowLast = last
    }

    /** Move a bracket to the ends of its cells. */
    private lay(span: TokenSpanNode, t0: number, t1: number, ease: Ease): void {
        const from = span.first.cx - span.first.wide / 2, to = span.last.cx + span.last.wide / 2
        if (Math.abs(from - span.from) < 1e-9 && Math.abs(to - span.to) < 1e-9) return
        span.from = from
        span.to = to
        const path = this.bracketPath(from, to, span.level)
        span.bracket.track('path').add({ t0, t1, ease, to: path, at: lerpSame(sampleAt(span.bracket, 'path', t0)!, path) })
        span.text?.tween('x', (from + to) / 2, t0, t1, ease)
    }

    /**
     * After a change of the tokens: each cell moves to its place in the line, and its values, the brackets
     * and the window go with it.
     */
    private settle(t0: number, t1: number, ease: Ease): void {
        const middles = this.middles()
        this.chips.forEach((cell, index) => {
            const x = middles[index]! - this.originX
            if (Math.abs(x - cell.cx) > 1e-9) {
                cell.cx = x
                cell.tween('x', x, t0, t1, ease)
            }
            for (const row of this.rows) {
                const value = row.values[index]
                if (value && Math.abs(sampleAt(value, 'x', AT_REST) - x) > 1e-9) value.tween('x', x, t0, t1, ease)
            }
        })
        for (const span of this.spans) this.lay(span, t0, t1, ease)
        for (const span of this.spans) this.clear(span, 'the change of the tokens')
        if (this.windowFirst && this.windowLast && this.frame) {
            const ends: [number, number] = [this.windowFirst.cx - this.windowFirst.wide / 2, this.windowLast.cx + this.windowLast.wide / 2]
            if (Math.abs(ends[0] - this.windowEnds[0]) > 1e-9 || Math.abs(ends[1] - this.windowEnds[1]) > 1e-9) {
                const path = this.framePath(ends)
                this.frame.track('path').add({ t0, t1, ease, to: path, at: lerpSame(sampleAt(this.frame, 'path', t0)!, path) })
                this.windowEnds = ends
            }
        }
    }

    /**
     * The edges of the parts of a box that is cut for several cells, from the left: one more edge than cells.
     * With `cuts`, the cuts are given. Without, each cell has a part in proportion to its width.
     */
    private parts(wides: readonly number[], left: number, wide: number, cuts: readonly number[] | null): number[] {
        if (cuts) return [left, ...cuts, left + wide]
        const total = wides.reduce((sum, own) => sum + own, 0)
        let at = left
        return [left, ...wides.map((own) => (at += (wide * own) / total))]
    }

    /**
     * Where to cut the box of a text that holds the letters of several cells: in the middle of the room
     * between the last letter of a cell and the first letter of the next, so no cut crosses a letter.
     * `counts` is the number of letters of each cell, and `x` gives the place of a letter. Null when a cell
     * has no letter.
     */
    private between(label: TextNode, counts: readonly number[], x: (glyph: Node) => number): number[] | null {
        if (counts.some((count) => count === 0)) return null
        const half = (glyph: Node) => (pathBounds(glyph.get('path') ?? [])?.width ?? 0) / 2
        const cuts: number[] = []
        let at = 0
        for (const count of counts.slice(0, -1)) {
            at += count
            const last = label.chars[at - 1]!, next = label.chars[at]!
            cuts.push((x(last) + half(last) + x(next) - half(next)) / 2)
        }
        return cuts
    }

    /** True when the letters of the old cells, in order, are the letters of the new cells, so each letter can move to its new place. */
    private spells(olds: readonly TokenCell[], news: readonly TokenCell[]): boolean {
        const keys = (cells: readonly TokenCell[]) => cells.flatMap((cell) => cell.text.chars.map((glyph) => glyph.data['key'] as string)).join('\u0000')
        return olds.map((cell) => cell.source).join('') === news.map((cell) => cell.source).join('') && keys(olds) === keys(news)
    }

    /** A cell takes the look of a state: its colors fade, its outline changes half way, and its marks change. */
    private restyle(cell: TokenCell, state: string, t0: number, t1: number, ease: Ease): void {
        const look = this.look(state), paint = toPaint(look.color ?? cell.tint), turn = (t0 + t1) / 2
        cell.box.tween('fill', paint, t0, t1, ease)
        cell.box.tween('stroke', paint, t0, t1, ease)
        cell.box.tween('fillOpacity', look.fill, t0, t1, ease)
        // Dashes cannot fade to a line, so they switch when the colors are half way.
        stepAt(cell.box, 'dash', look.dash ? this.dashes() : null, turn)
        const ink = toPaint(look.dim ? 'dim' : 'ink')
        for (const glyph of cell.text.chars) glyph.tween('fill', ink, t0, t1, ease)
        // The old marks leave in the first half, and the new ones come in the second half.
        for (const sign of cell.signs) {
            sign.tween('opacity', 0, t0, turn, ease)
            this.bury(sign, turn, 0)
        }
        const signs = this.signsOf(cell, look)
        const saved = clock.now
        clock.now = t0
        for (const sign of signs) {
            sign.opacity(0)
            cell.add(sign)
            sign.tween('opacity', 1, turn, t1, ease)
        }
        clock.now = saved
        cell.signs = signs
        cell.state = state
    }
}

/**
 * A strip of token cells: `tokens(['The', 'cat', 'sat'], { size: 40, rows: { id: [464, 3797, 3332] } })`.
 * `strip.mark(1, 'masked')` changes a state, `strip.append('on')` adds a token, and `strip.merge(0, 1)` joins two.
 */
export function tokens(items: readonly (string | number | TokenSpec)[], options: TokensOptions = {}): TokenRow {
    return new TokenRow(items, options)
}
