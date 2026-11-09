import { Node, ownLabels } from '../node'
import { rectPath } from '../geometry'
import { text, type TextOptions } from '../text'
import { mixColor, parseColor, toPaint, type ColorInput, type Paint } from '../color'
import type { Ease } from '../ease'
import type { Anim, AnimContext, AnimOptions } from '../anim'
import { Heatmap } from './heatmap'
import { lerpSame, reveal, solidColor, staggered, stepAt } from './util'

export interface MatrixProductOptions {
    /** The text size of the numbers, the names, the shapes and the sum. Defaults to 30. */
    size?: number
    /** The side of one cell. The three grids have one cell, so a viewer compares their shapes. Defaults to the room of the widest number. */
    cell?: number
    /** The names of the two operands and of the result. Defaults to A, B and C. */
    names?: readonly [string, string, string]
    /** The color of the lit row of the first operand, and of the lit column of the second. Defaults to blue and orange. */
    colors?: readonly [ColorInput, ColorInput]
    /** How to write a number. Defaults to two decimals at most. */
    format?: (value: number) => string
    /** Start with every cell of the result filled. Defaults to false: the result is empty, and `store()` fills a cell. */
    filled?: boolean
    /** The font of the names. The numbers, the shapes and the sum are in mono. */
    font?: TextOptions['font']
}

/** Two times that are nearer than this are one time. */
const SOON = 1e-6

const shown = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.join(', ')}]` : String(value))
const seconds = (time: number): string => `${Math.round(time * 1000) / 1000} s`

/** The advance width of a text: the room that it takes in a line. */
const advance = (node: Node): number => (node.layoutBox ? node.layoutBox[2] - node.layoutBox[0] : node.bounds().width)

/** One term of the sum: the two numbers that a pair multiplies. */
interface Term {
    left: Node
    times: Node
    right: Node
    /** The plus before the term, or null for the first one. */
    plus: Node | null
    /** The sum after this term. */
    total: Node
}

/** The line under the grids for one cell of the result: its terms, the equals sign, and the sum so far. */
interface Line {
    row: number
    col: number
    holder: Node
    terms: Term[]
    equals: Node
    /** True when `store()` took the sum to its cell. */
    stored: boolean
}

/**
 * A matrix product with its two operands and its result, as three grids of numbers to one scale: `A × B = C`.
 * `pair(i, j)` lights row i of the first operand and column j of the second, and writes their terms under
 * the grids. `addTerm()` takes the next term into the running sum, and `store()` drops the sum into its cell of the
 * result. `compute(i, j)` plays the three, and `complete()` fills the cells that are left. `.at()` places the
 * middle of the row of grids. The names and the shapes are over it, and the sum is under it.
 */
export class MatrixProduct extends Node {
    /** The first operand, the second one, and the result. Each is a `heatmap`, with its `cell`, `p` and `region`. */
    readonly a: Heatmap
    readonly b: Heatmap
    readonly c: Heatmap
    /** The sign between the operands and the equals sign. */
    readonly signs: Node[] = []
    /** The name and the shape of each grid, over it: `A [2, 3]`. */
    readonly captions: Node[] = []
    /** The terms and the sum of the pair that is lit, or null before the first `pair()`. */
    line: Node | null = null
    private readonly first: readonly (readonly number[])[]
    private readonly second: readonly (readonly number[])[]
    private readonly out: number[][]
    private readonly size: number
    private readonly format: (value: number) => string
    private readonly paints: [Paint, Paint]
    /** The fill of a cell whose number is in the sum, for each operand. */
    private readonly tints: [Paint, Paint]
    private readonly plain: Paint
    /** The color of a term that is not in the sum yet: weaker than dim, and a viewer can still read it. */
    private readonly ahead: ColorInput
    private readonly lineY: number
    private now: Line | null = null
    private taken = 0
    /** The call that plays last, and the time at which it is over. */
    private last: { call: string; t0: number; t1: number } | null = null

    constructor(a: readonly (readonly number[])[], b: readonly (readonly number[])[], options: MatrixProductOptions = {}) {
        super()
        const operands: [string, readonly (readonly number[])[]][] = [['first', a], ['second', b]]
        for (const [name, rows] of operands) {
            if (!Array.isArray(rows) || rows.length === 0 || !rows.every((row) => Array.isArray(row) && row.length === rows[0]!.length && row.length > 0)) throw new Error(`matrixProduct: the ${name} operand is not a matrix. Give a list of rows with the same number of values, such as [[1, 2], [3, 4]]. A vector is one row, [[1, 2, 3]], or one column, [[1], [2], [3]]`)
            rows.forEach((row: readonly number[], i: number) => row.forEach((value: number, j: number) => {
                if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`matrixProduct: the value (${i}, ${j}) of the ${name} operand is ${shown(value)}. A value is a number`)
            }))
        }
        const m = a.length, n = a[0]!.length, p = b[0]!.length
        // The picture of a product that does not exist would teach a wrong rule.
        if (b.length !== n) throw new Error(`matrixProduct: the first operand is ${m} by ${n} and the second is ${b.length} by ${p}. The columns of the first (${n}) must be as many as the rows of the second (${b.length}). ${n === p ? 'The transpose of the second operand fits' : 'Give operands whose inner sizes are equal'}`)
        const size = this.size = options.size ?? 30
        if (!(Number.isFinite(size) && size > 0)) throw new Error(`matrixProduct: size is ${shown(size)}. It is a text size, more than 0`)
        const names = options.names ?? ['A', 'B', 'C']
        if (!Array.isArray(names) || names.length !== 3 || names.some((name) => typeof name !== 'string' || name.trim() === '')) throw new Error(`matrixProduct: names is ${shown(names)}. Give three names: the two operands and the result, such as ['Q', 'K', 'scores']`)
        const format = this.format = options.format ?? ((value: number) => (Math.round(value * 100) / 100).toString())
        this.first = a.map((row) => [...row])
        this.second = b.map((row) => [...row])
        this.out = a.map((row) => Array.from({ length: p }, (_, j) => row.reduce((sum, value, k) => sum + value * b[k]![j]!, 0)))
        const colors = options.colors ?? ['blue', 'orange']
        this.paints = [toPaint(colors[0]), toPaint(colors[1])]
        const surface = parseColor('surface')
        this.plain = surface
        this.ahead = mixColor(parseColor('faint'), parseColor('dim'), 0.4)
        this.tints = [mixColor(surface, solidColor(colors[0]), 0.4), mixColor(surface, solidColor(colors[1]), 0.4)]

        // One cell for the three grids: the room of the widest number of all of them.
        const every = [...a.flat(), ...b.flat(), ...this.out.flat()]
        const widest = Math.max(...every.map((value) => text(format(value), { size, font: 'mono' }).bounds().width))
        // The room of a short number, as a grid gives it: 2.6 of the size. A longer number has 0.45 of the size at each side.
        const cell = options.cell ?? Math.max(Math.round(size * 2.6), Math.ceil(widest + size * 0.9))
        // The cells are plain: the picture is about which numbers meet, and not about how large they are.
        const grid = (rows: readonly (readonly number[])[], empty: boolean) => new Heatmap(rows, {
            size, cell, values: true, format, colors: ['surface'], domain: [Math.min(...every), Math.max(...every)], initial: empty ? 'empty' : 'open', font: options.font,
        })
        this.a = grid(a, false)
        this.b = grid(b, false)
        this.c = grid(this.out, !(options.filled ?? false))
        // The film check takes the three grids and what is between them as one object.
        for (const part of [this.a, this.b, this.c]) delete part.data['ownLayout']

        // The shapes are on one line, over the highest grid. The two inner sizes are equal, and in one color.
        const shapes: [number, number][] = [[m, n], [n, p], [m, p]]
        const captions = shapes.map(([rows, cols], index) => {
            // Each text, its color, its font, and the room after it.
            const parts: [string, ColorInput, TextOptions['font'], number][] = [
                [names[index]!, 'ink', options.font, size * 0.45], ['[', 'dim', 'mono', 0], [String(rows), index === 1 ? 'yellow' : 'dim', 'mono', 0], [',', 'dim', 'mono', size * 0.3], [String(cols), index === 0 ? 'yellow' : 'dim', 'mono', 0], [']', 'dim', 'mono', 0],
            ]
            const nodes = parts.map(([content, color, font]) => text(content, { size, font, color, anchor: 'left' }))
            const steps = nodes.map((node, at) => advance(node) + parts[at]![3])
            return { nodes, steps, width: steps.reduce((sum, step) => sum + step, 0) }
        })
        const grids = [this.a, this.b, this.c]
        const widths = grids.map((part) => part.bounds().width)
        // A grid has the room of its cells or of its shape, so the shapes of two narrow grids do not meet.
        const slots = widths.map((width, index) => Math.max(width, captions[index]!.width))
        const room = size * 2.4
        const total = slots[0]! + slots[1]! + slots[2]! + room * 2
        const middles = [-total / 2 + slots[0]! / 2, -total / 2 + slots[0]! + room + slots[1]! / 2, total / 2 - slots[2]! / 2].map(Math.round)
        grids.forEach((part, index) => part.at(middles[index]!, 0))
        // A sign is in the middle of the room between two grids, and not between their shapes.
        const sign = (content: string, index: number) => text(content, { size: size * 1.3, font: 'mono', color: 'dim' }).at((middles[index]! + widths[index]! / 2 + middles[index + 1]! - widths[index + 1]! / 2) / 2, 0)
        this.signs.push(sign('×', 0), sign('=', 1))
        const half = Math.max(...grids.map((part) => part.bounds().height)) / 2
        captions.forEach(({ nodes, steps, width }, index) => {
            let x = middles[index]! - width / 2
            const caption = new Node()
            nodes.forEach((node, at) => {
                caption.add(node.at(x, -half - size * 1.05))
                x += steps[at]!
            })
            this.captions.push(caption)
        })
        // The line of the sum is under the grids. The sum goes up from it into its cell, and the cells under
        // that cell are empty when a film fills the result row by row.
        this.lineY = half + size * 1.35

        this.add(this.a, this.b, this.c, ...this.signs, ...this.captions)
        // The sum has its room from the start, so the layout measures the object with it.
        const longest = Math.max(...this.out.flatMap((row, i) => row.map((_, j) => this.lineWidth(i, j))))
        // The room holds the plate that carries the sum away, which is a little larger than the sum.
        this.add(new Node(rectPath(-longest / 2 - size * 0.35, this.lineY - size * 0.75, longest + size * 0.7, size * 1.5)).hide())
        ownLabels(this, { name: 'matrix product', labels: [...this.signs, ...this.captions.flatMap((caption) => caption.children)] })
    }

    /** The rows and the columns of the two operands and of the result: `[[2, 3], [3, 2], [2, 2]]`. */
    get shape(): [[number, number], [number, number], [number, number]] {
        const m = this.first.length, n = this.second.length, p = this.second[0]!.length
        return [[m, n], [n, p], [m, p]]
    }

    /** The cell of the result that is lit, as `[row, col]`, after the changes that are scheduled so far. Null before the first `pair()` and after `complete()`. */
    get lit(): [number, number] | null {
        return this.now ? [this.now.row, this.now.col] : null
    }

    /** How many terms of the lit pair are in the sum, after the changes that are scheduled so far. */
    get terms(): number {
        return this.taken
    }

    /** The running sum of the lit pair, after the changes that are scheduled so far. */
    get sum(): number {
        const line = this.now
        if (!line) return 0
        let sum = 0
        for (let k = 0; k < this.taken; k++) sum += this.first[line.row]![k]! * this.second[k]![line.col]!
        return sum
    }

    /** How many cells of the result are filled, after the changes that are scheduled so far. */
    get filled(): number {
        return this.c.count('open')
    }

    /** The value of a cell of the result, whether the film filled it or not. */
    result(row: number, col: number): number {
        this.cellOf(row, col, 'result')
        return this.out[row]![col]!
    }

    /** The three grids arrive from the left, with the signs and the shapes. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'matrixProduct.enter', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const windows = staggered(3, Math.max(0, options.lag ?? 0.5), ctx.t0, ctx.t1)
                ;[this.a, this.b, this.c].forEach((part, index) => {
                    const [start, end] = windows[index]!
                    part.enter().schedule({ ...ctx, t0: start, t1: end })
                    for (const node of [this.captions[index]!, ...(index > 0 ? [this.signs[index - 1]!] : [])]) {
                        stepAt(node, 'opacity', 0, ctx.t0)
                        node.tween('opacity', 1, start, end, ctx.ease)
                    }
                })
            },
        }
    }

    /**
     * Light row `row` of the first operand, column `col` of the second, and their cell of the result. The
     * terms of the pair come in under the grids, dim: none is in the sum yet. The pair before it leaves.
     */
    pair(row: number, col: number, options: AnimOptions = {}): Anim {
        this.cellOf(row, col, 'pair')
        const call = `pair(${row}, ${col})`
        const next = this.lineOf(row, col)
        return {
            label: 'matrixProduct.pair', duration: options.duration ?? 0.7, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.claim(call, ctx)
                reveal(this, t0, ctx.stage)
                const turn = (t0 + t1) / 2
                const before = this.now
                this.unpaint(before, t0, turn, ctx.ease)
                // The old terms leave before the new ones come, so no moment shows two sums.
                before?.holder.tween('opacity', 0, t0, turn, ctx.ease)
                next.holder.opacity(0)
                this.add(next.holder)
                ownLabels(this, { labels: next.holder.children })
                next.holder.tween('opacity', 1, before ? turn : t0, t1, ctx.ease)
                this.now = next
                this.line = next.holder
                this.taken = 0
                const lights = [this.a.light({ row }, { color: this.paints[0] }), this.b.light({ col }, { color: this.paints[1] }), this.c.light({ row, col })]
                for (const light of lights) light.schedule(ctx)
            },
        }
    }

    /**
     * Take the next term of the lit pair into the sum: its two numbers take the colors of their operands, their
     * cells take a tint, and the sum after the equals sign changes. `add(3)` takes three terms, one after another.
     */
    addTerm(count = 1, options: AnimOptions = {}): Anim {
        if (!Number.isInteger(count) || count < 1) throw new Error(`matrixProduct: addTerm takes the number of terms to add, a whole number, 1 or more, and it got ${shown(count)}`)
        const call = `addTerm(${count === 1 ? '' : count})`
        return {
            label: 'matrixProduct.addTerm', duration: options.duration ?? 0.6 * count, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.claim(call, ctx)
                const line = this.now
                if (!line) throw new Error(`matrixProduct: ${call} has no pair to take a term of. Play pair(row, col) first`)
                const length = line.terms.length
                if (this.taken + count > length) throw new Error(`matrixProduct: ${call} would take ${this.taken + count} terms, and the pair (${line.row}, ${line.col}) has ${length}${this.taken === length ? ', all in the sum. Play store() to write the sum, or pair() for the next cell' : `, with ${this.taken} in the sum. Give addTerm(${length - this.taken}) at the most`}`)
                const windows = staggered(count, 1, t0, t1)
                for (let step = 0; step < count; step++) {
                    const k = this.taken + step, term = line.terms[k]!, [start, end] = windows[step]!
                    const turn = (start + end) / 2
                    this.tint(term.left, this.paints[0], start, turn, ctx.ease)
                    this.tint(term.right, this.paints[1], start, turn, ctx.ease)
                    for (const part of [term.times, term.plus]) if (part) this.tint(part, toPaint('ink'), start, turn, ctx.ease)
                    this.a.cell(line.row, k).tween('fill', this.tints[0], start, turn, ctx.ease)
                    this.b.cell(k, line.col).tween('fill', this.tints[1], start, turn, ctx.ease)
                    // The sum so far leaves, then the sum with this term comes, so no moment shows two sums.
                    if (k === 0) line.equals.tween('opacity', 1, start, turn, ctx.ease)
                    else line.terms[k - 1]!.total.tween('opacity', 0, start, turn, ctx.ease)
                    term.total.tween('opacity', 1, turn, end, ctx.ease)
                }
                this.taken += count
            },
        }
    }

    /**
     * Store the sum of the lit pair in its cell of the result: the number leaves the line of the sum, goes to
     * the cell, and the cell fills. Every term must be in the sum.
     */
    store(options: AnimOptions = {}): Anim {
        return {
            label: 'matrixProduct.store', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.claim('store()', ctx)
                const line = this.now
                if (!line) throw new Error('matrixProduct: store() has no pair to write the sum of. Play pair(row, col) first')
                const length = line.terms.length
                if (this.taken < length) throw new Error(`matrixProduct: store() writes a sum, and the sum of the pair (${line.row}, ${line.col}) has ${this.taken} of its ${length} terms. Play addTerm(${length - this.taken}) first, or compute(${line.row}, ${line.col}) for the whole cell`)
                if (line.stored) throw new Error(`matrixProduct: the sum of the pair (${line.row}, ${line.col}) is in its cell already. Play pair(row, col) for the next cell`)
                line.stored = true
                const span = t1 - t0, lands = t0 + span * 0.8
                // The outline of the cell leaves first, so the number does not cross a line on its way in.
                this.c.light(null).schedule({ ...ctx, t1: t0 + span * 0.3 })
                // The sum itself goes to the cell. It lands on the place of the number of the cell, and the cell
                // takes over at that instant: the two texts are the same, so the viewer sees one number arrive.
                const total = line.terms[length - 1]!.total
                const wide = advance(total), from: [number, number] = [total.get('x') + wide / 2, total.get('y')]
                const [x, y] = this.c.p(line.row, line.col)
                const to: [number, number] = [this.c.get('x') + x, this.c.get('y') + y]
                total.tween('x', to[0] - wide / 2, t0, lands, ctx.ease)
                total.tween('y', to[1], t0, lands, ctx.ease)
                stepAt(total, 'opacity', 0, lands)
                // The sum travels on a plate, which grows from the size of the number to the size of the cell. So
                // the number is never over a line or over another number on its way: the plate hides them.
                const box = this.c.cell(line.row, line.col).bounds()
                const radius = Math.round(this.size * 0.15)
                const start = rectPath(from[0] - wide / 2 - this.size * 0.35, from[1] - this.size * 0.75, wide + this.size * 0.7, this.size * 1.5, radius)
                const end = rectPath(to[0] - box.width / 2, to[1] - box.height / 2, box.width, box.height, radius)
                const plate = new Node(start).fill(this.plain).opacity(0).zIndex(-1)
                plate.data['decoration'] = true
                line.holder.add(plate)
                plate.tween('opacity', 1, t0, t0 + span * 0.12, ctx.ease)
                plate.track('path').add({ t0, t1: lands, ease: ctx.ease, to: end, at: lerpSame(start, end) })
                stepAt(plate, 'opacity', 0, lands)
                this.c.mark({ row: line.row, col: line.col }, 'open').schedule({ ...ctx, t0: lands, t1: lands })
                // The cell is lit once more, as full, for the rest of the time.
                this.c.light({ row: line.row, col: line.col }).schedule({ ...ctx, t0: lands, t1 })
            },
        }
    }

    /** One cell of the result, from its pair to its sum: `pair(row, col)`, then `addTerm()` for each term, then `store()`. */
    compute(row: number, col: number, options: AnimOptions = {}): Anim {
        this.cellOf(row, col, 'compute')
        const length = this.second.length
        const parts = [this.pair(row, col), this.addTerm(length), this.store()]
        const duration = parts.reduce((sum, part) => sum + part.duration, 0)
        return {
            label: 'matrixProduct.compute', duration: options.duration ?? duration, ease: options.ease,
            schedule: (ctx) => {
                let t = ctx.t0
                const k = duration > 0 ? (ctx.t1 - ctx.t0) / duration : 1
                for (const part of parts) {
                    const next = t + part.duration * k
                    part.schedule({ ...ctx, t0: t, t1: next })
                    t = next
                }
            },
        }
    }

    /** Fill every cell of the result that is still empty, row by row. The lights go off, and the line of the sum leaves. */
    complete(options: AnimOptions = {}): Anim {
        return {
            label: 'matrixProduct.complete', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.claim('complete()', ctx)
                reveal(this, t0, ctx.stage)
                const early = t0 + (t1 - t0) * 0.3
                this.unpaint(this.now, t0, early, ctx.ease)
                this.now?.holder.tween('opacity', 0, t0, early, ctx.ease)
                this.now = null
                this.taken = 0
                for (const part of [this.a, this.b, this.c]) part.light(null).schedule({ ...ctx, t1: early })
                this.c.mark((_row, _col, _value, state) => state === 'empty', 'open', { lag: options.lag ?? 0.4 }).schedule(ctx)
            },
        }
    }

    private cellOf(row: number, col: number, call: string): void {
        const m = this.first.length, p = this.second[0]!.length
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= m || col < 0 || col >= p) throw new Error(`matrixProduct: ${call} names the cell (${shown(row)}, ${shown(col)}) of the result, which is ${m} by ${p}. Give a row from 0 to ${m - 1} and a column from 0 to ${p - 1}`)
    }

    /**
     * Take the time of a step. The steps of a product follow each other: a pair, its terms, its sum. Two steps
     * at one time would each write the line of the sum, and the picture would follow neither.
     */
    private claim(call: string, ctx: AnimContext): [number, number] {
        const last = this.last
        if (last && ctx.t0 < last.t1 - SOON) throw new Error(`matrixProduct: ${call} plays from ${seconds(ctx.t0)} to ${seconds(ctx.t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. A product takes one step at a time. Play the two in a \`seq\`, or one after the other`)
        this.last = { call, t0: ctx.t0, t1: ctx.t1 }
        return [ctx.t0, ctx.t1]
    }

    /** A number as a term shows it: a negative number in brackets, so that no sign follows another. */
    private operand(value: number): string {
        const content = this.format(value)
        return content.startsWith('-') ? `(${content})` : content
    }

    /** The texts of a line and the room between them, from the left: the terms, the equals sign, and the sum. */
    private pieces(row: number, col: number): { content: string; after: number }[] {
        const tight = this.size * 0.14, loose = this.size * 0.45
        const out: { content: string; after: number }[] = []
        for (let k = 0; k < this.second.length; k++) {
            if (k > 0) out.push({ content: '+', after: loose })
            out.push({ content: this.operand(this.first[row]![k]!), after: tight }, { content: '×', after: tight }, { content: this.operand(this.second[k]![col]!), after: loose })
        }
        out.push({ content: '=', after: loose })
        return out
    }

    /** The widest sum of a pair: one of its sums after each term. */
    private totals(row: number, col: number): string[] {
        let sum = 0
        return this.second.map((line, k) => this.format(sum += this.first[row]![k]! * line[col]!))
    }

    private measure(content: string): number {
        return advance(text(content, { size: this.size, font: 'mono' }))
    }

    private lineWidth(row: number, col: number): number {
        return this.pieces(row, col).reduce((sum, piece) => sum + this.measure(piece.content) + piece.after, 0) + Math.max(...this.totals(row, col).map((total) => this.measure(total)))
    }

    /** The line of a pair, with its middle under the middle of the object. Every text is dim, and the sums do not show. */
    private lineOf(row: number, col: number): Line {
        const holder = new Node()
        const size = this.size, y = this.lineY
        let x = -this.lineWidth(row, col) / 2
        const nodes = this.pieces(row, col).map((piece) => {
            const node = text(piece.content, { size, font: 'mono', color: piece.content === '=' ? 'ink' : this.ahead, anchor: 'left' }).at(x, y)
            x += this.measure(piece.content) + piece.after
            holder.add(node)
            return node
        })
        const equals = nodes[nodes.length - 1]!.opacity(0)
        const totals = this.totals(row, col).map((total) => {
            const node = text(total, { size, font: 'mono', color: 'ink', anchor: 'left' }).at(x, y).opacity(0)
            holder.add(node)
            return node
        })
        const terms: Term[] = totals.map((total, k) => {
            // A term is three texts, and each one after the first has a plus before it.
            const first = k === 0 ? 0 : k * 4 - 1
            return k === 0 ? { left: nodes[0]!, times: nodes[1]!, right: nodes[2]!, plus: null, total } : { plus: nodes[first]!, left: nodes[first + 1]!, times: nodes[first + 2]!, right: nodes[first + 3]!, total }
        })
        return { row, col, holder, terms, equals, stored: false }
    }

    private tint(label: Node, paint: Paint, t0: number, t1: number, ease: Ease): void {
        for (const part of label.all()) if (part.get('fill')) part.tween('fill', paint, t0, t1, ease)
    }

    /** The cells of a pair that took a tint go back to their own fill. */
    private unpaint(line: Line | null, t0: number, t1: number, ease: Ease): void {
        if (!line) return
        for (let k = 0; k < this.taken; k++) {
            this.a.cell(line.row, k).tween('fill', this.plain, t0, t1, ease)
            this.b.cell(k, line.col).tween('fill', this.plain, t0, t1, ease)
        }
    }
}

/** A matrix product as three grids of numbers: `matrixProduct([[1, 2, 3], [4, 5, 6]], [[7, 8], [9, 10], [11, 12]])`. `product.compute(0, 1)` pairs a row with a column, adds the terms, and fills the cell of the result. */
export function matrixProduct(a: readonly (readonly number[])[], b: readonly (readonly number[])[], options: MatrixProductOptions = {}): MatrixProduct {
    return new MatrixProduct(a, b, options)
}
