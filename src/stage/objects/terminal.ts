import { parseSvgPath, pathBounds, transformPath, type Path } from '../geometry'
import { Node } from '../node'
import { rect } from '../shapes'
import { text } from '../text'
import { fallbackGlyph, fontFor, glyphPath } from '../font'
import { mixColor, parseColor, toPaint, type ColorInput } from '../color'
import { linear } from '../ease'
import type { Anim, AnimContext, AnimOptions } from '../anim'
import { luminance, reveal, solidColor, stepAt } from './util'

export interface TerminalLine {
    text: string
    /** 'command' draws the prompt before the text. 'output' is what the program printed. 'note' is a dim line that the film adds, such as '[...]' for lines that it left out. Defaults to output. */
    kind?: 'command' | 'output' | 'note'
    /** The color of the text. Defaults to ink, and to dim for a note. */
    color?: ColorInput
}

export interface TerminalOptions {
    /** Text in the bar at the top, at the left: a file path or a host name. */
    title?: string
    /** Dim text in the bar, at the right: where and when it ran, such as 'Linux 7.0, arm64, 2026-11-08'. */
    note?: string
    /**
     * Characters in one line. Defaults to the longest line, or to more when the title and the note need
     * more room. A longer line is an error, or is cut with an ellipsis when `clip` is true. The spaces at the
     * end of a line do not count: they are not drawn.
     */
    columns?: number
    clip?: boolean
    /**
     * Start with every line on screen. Defaults to true, for a picture that does not move. Give false to a
     * terminal that a film types and prints, so that its panel starts empty wherever the film adds it.
     */
    shown?: boolean
    /** Text size. Defaults to 26. */
    size?: number
    /** Drawn before a command. Defaults to '$ '. */
    prompt?: string
    /** The border and the bar. Defaults to grid. */
    color?: ColorInput
}

type Kind = NonNullable<TerminalLine['kind']>

// A frame cannot show more lines at a size that a viewer can read.
const LIMIT = 40
// The distance between two baselines, as a part of the text size. `codeBlock` has the same.
const LEADING = 1.5
// The text of the bar, as a part of the text size.
const BAR_TEXT = 0.8
const ELLIPSIS = '…'
// A glyph of another font is drawn smaller when its ink is wider than this part of a column. The widest
// letters of the mono font take as much.
const FIT = 0.92
// A glyph with ink wider than this many columns cannot go into one column and stay readable.
const WIDEST = 1.2

/** A node that holds glyphs. The film check names a text by the `source` of that node, as it does for `text()`. */
class Glyphs extends Node {
    constructor(readonly source: string) {
        super()
    }
}

/** One line. Its text is `chars`, one character for each column after the prompt. */
class Row extends Glyphs {
    /** The glyph of each character, or null for a character that draws nothing, such as a space. */
    cells: (Node | null)[] = []
    /**
     * `length` is the number of columns from the start of the line to its last character, with the prompt.
     * `whole` is the text before `clip` cut it, or null for a line that is not cut.
     */
    constructor(readonly chars: readonly string[], readonly kind: Kind, readonly length: number, readonly whole: readonly string[] | null) {
        super(chars.join(''))
    }
}

/** The glyphs that `find()` selected, as one node inside their line. `from` and `to` are places in `chars`. */
class Span extends Glyphs {
    constructor(source: string, readonly from: number, readonly to: number) {
        super(source)
    }
}

/** The text without the spaces at its end. They are not content, and a terminal does not draw them. */
const trimmed = (value: string): string => value.replace(/ +$/, '')

function printable(what: string, value: string): void {
    if (value.includes('\t')) throw new Error(`terminal: ${what} has a tab. Expand each tab to spaces, so that the columns are where the program put them`)
    if (/[\n\r]/.test(value)) throw new Error(`terminal: ${what} has a line break. Give each line as its own item, such as output.split('\\n')`)
    const control = /[\u0000-\u001f\u007f]/.exec(value)
    if (control) throw new Error(`terminal: ${what} has a control character (U+${control[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}), such as a part of a color code. Remove it`)
}

/**
 * The output of a real program, as a terminal shows it: a panel with a bar that says where and when it ran,
 * a command after its prompt, and the lines that the program printed, with the exact characters. It shows
 * all its lines, unless it starts with `shown: false`. `enter()` brings the empty panel, `type()` types a
 * command, and `print()` brings the next block of lines, up to the next command. `find()` selects one
 * number, to color it or to point at it. `.at()` places the middle of the panel.
 */
export class Terminal extends Node {
    /** The panel: its fill and its border. */
    readonly frame: Node
    /** The band at the top, behind the title and the note. */
    readonly bar: Node
    readonly title: Node | null
    readonly note: Node | null
    /** One node per line. The node of a command holds its prompt. */
    readonly lines: Node[] = []
    /** The prompt of each command line, or null for another line. */
    readonly prompts: (Node | null)[] = []
    private readonly rows: Row[] = []
    /**
     * The time from which each line is on screen, or null for a line that is not shown. `type()`, `print()`
     * and `showLines()` read it, and the animations change it when they are scheduled.
     */
    private since: (number | null)[]
    /** Where every line starts, and the baseline of the first line. */
    private readonly start: number
    private readonly baseline: number
    private readonly advance: number
    private readonly rowHeight: number
    /** The middle of a capital letter, above the baseline. */
    private readonly rise: number

    constructor(lines: readonly (string | TerminalLine)[], options: TerminalOptions = {}) {
        super()
        if (lines.length === 0) throw new Error('terminal: give it at least one line')
        if (lines.length > LIMIT) throw new Error(`terminal: ${lines.length} lines are more than a frame can show at a size that a viewer can read. Show ${LIMIT} lines or fewer. Leave lines out, and put a note line such as { text: '[...]', kind: 'note' } in their place`)
        const size = options.size ?? 26
        if (!(Number.isFinite(size) && size > 0)) throw new Error('terminal: size is a text size, more than 0')
        if (options.columns !== undefined && (!Number.isInteger(options.columns) || options.columns < 1)) throw new Error('terminal: columns is a whole number of characters, 1 or more')
        const prompt = [...(options.prompt ?? '$ ')]
        printable('the prompt', prompt.join(''))
        if (options.title) printable('the title', options.title)
        if (options.note) printable('the note', options.note)
        const given = lines.map((line, index) => {
            const { text: content, kind = 'output', color } = typeof line === 'string' ? { text: line } : line
            printable(`line ${index}`, content)
            const chars = [...trimmed(content)], before = kind === 'command' ? prompt.length : 0
            // A command with no text ends where the characters of its prompt end.
            const length = chars.length > 0 ? before + chars.length : kind === 'command' ? [...trimmed(prompt.join(''))].length : 0
            return { chars, kind, color, before, length }
        })

        const font = fontFor('mono', 400)
        const advance = this.advance = font.advance(font.glyphFor(48)) * size / font.unitsPerEm
        const cap = pathBounds(glyphPath(font, font.glyphFor(72), size))?.height ?? size * 0.73
        const pad = size * 0.9
        const barSize = size * BAR_TEXT, barHeight = barSize * 2.1
        const border = Math.max(1.5, size * 0.075)
        const color = options.color ?? 'grid'

        // The text of the bar must read on the color of the bar, which the film can set. Take ink or the
        // background, the one that differs more from the bar. The note is the same color, nearer to the bar.
        const barColor = solidColor(color)
        const contrast = (name: string) => {
            const a = luminance(parseColor(name)), b = luminance(barColor)
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        }
        const onBar = parseColor(contrast('ink') >= contrast('bg') ? 'ink' : 'bg')
        const title = options.title ? text(options.title, { font: 'mono', size: barSize, color: onBar, anchor: 'left' }) : null
        const note = options.note ? text(options.note, { font: 'mono', size: barSize, color: mixColor(onBar, barColor, 0.3), anchor: 'right' }) : null
        // The title and the note must not meet: keep the room of four characters between them.
        const needs = (title?.bounds().width ?? 0) + (note?.bounds().width ?? 0) + (title && note ? barSize * 2.4 : 0)
        const least = Math.ceil(needs / advance - 1e-9)
        const longest = Math.max(...given.map((line) => line.length))
        const columns = options.columns ?? Math.max(1, longest, least)
        if (least > columns) {
            const both = title && note
            throw new Error(`terminal: ${both ? 'the title and the note need' : `the ${title ? 'title' : 'note'} needs`} ${least} columns in the bar, and \`columns\` is ${columns}. Shorten ${both ? 'the title or the note' : `the ${title ? 'title' : 'note'}`}, or raise \`columns\``)
        }

        const width = columns * advance + pad * 2
        // The lines have the same room on all four sides: from the top of a capital letter of the first
        // line to the bar, and from the baseline of the last line to the border.
        const height = barHeight + pad * 2 + cap + (given.length - 1) * size * LEADING
        const left = this.start = -width / 2 + pad
        const top = -height / 2
        this.baseline = top + barHeight + pad + cap
        this.rowHeight = size * LEADING
        this.rise = cap / 2
        const radius = Math.min(size * 0.45, barHeight / 2)
        this.frame = rect(width, height, { radius, fill: 'surface', stroke: color, width: border })
        // The bar is inside the border, so it does not cover the half of the border that is inside the panel.
        const half = border / 2, round = Math.max(0, radius - half)
        const x0 = -width / 2 + half, x1 = width / 2 - half, y0 = top + half, y1 = top + barHeight
        this.bar = new Node(parseSvgPath(`M${x0} ${y1}V${y0 + round}A${round} ${round} 0 0 1 ${x0 + round} ${y0}H${x1 - round}A${round} ${round} 0 0 1 ${x1} ${y0 + round}V${y1}Z`)).fill(color)
        this.title = title?.at(left, top + barHeight / 2) ?? null
        this.note = note?.at(-left, top + barHeight / 2) ?? null
        this.add(this.frame, this.bar)
        if (this.title) this.add(this.title)
        if (this.note) this.add(this.note)

        // The shape of each character and its place in a column. A line of output repeats its characters.
        const shapes = new Map<string, { path: Path; x: number; missing: boolean } | null>()
        const shape = (char: string, where: string) => {
            const known = shapes.get(char)
            if (known !== undefined) return known
            const code = char.codePointAt(0)!
            let owner = font, index = font.glyphFor(code)
            if (index === 0) {
                const found = fallbackGlyph('mono', code)
                if (found) [owner, index] = [found.font, found.glyph]
            }
            let path = glyphPath(owner, index, size), x = 0
            const ink = pathBounds(path)
            if (ink) {
                const wide = ink.width / advance
                if (wide > WIDEST) {
                    throw new Error(`terminal: ${where} has the character ${JSON.stringify(char)} (U+${code.toString(16).toUpperCase().padStart(4, '0')}). Its glyph is ${wide.toFixed(1)} columns wide, so it would cover the next character. Replace it with a character that takes one column`)
                }
                if (owner !== font) {
                    // A glyph of another font has its own width. Put its ink in the middle of the column, and
                    // draw a glyph that is too wide smaller, on the same baseline, so that it covers no
                    // neighbor. The glyphs of the mono font keep their places: its box drawing lines go past
                    // the column to join the next one.
                    const scale = Math.min(1, FIT / wide)
                    if (scale < 1) path = transformPath(path, [scale, 0, 0, scale, 0, 0])
                    x = advance / 2 - (ink.x + ink.width / 2) * scale
                }
            }
            const made = ink ? { path, x, missing: index === 0 } : null
            shapes.set(char, made)
            return made
        }
        const glyph = (char: string, column: number, paint: ColorInput, where: string): Node | null => {
            const made = shape(char, where)
            if (!made) return null
            const leaf = new Node(made.path).at(column * advance + made.x, 0)
            leaf.base.fill = toPaint(paint)
            leaf.base.trimEach = true
            leaf.data['key'] = char
            // Glyph 0 draws the empty box of the font. The film check reports it.
            if (made.missing) leaf.data['missingGlyph'] = true
            return leaf
        }
        const shown = options.shown ?? true
        given.forEach((line, index) => {
            let chars = line.chars
            const cut = line.length > columns
            if (cut) {
                const room = columns - line.before - 1
                if (!options.clip || room < 0) {
                    throw new Error(`terminal: line ${index} has ${line.length} characters${line.before ? ' with its prompt' : ''}, and \`columns\` is ${columns}. ${room < 0 ? 'Raise `columns`' : 'Raise `columns`, or set `clip` to cut the line with an ellipsis'}`)
                }
                chars = [...chars.slice(0, room), ELLIPSIS]
            }
            const row = new Row(chars, line.kind, cut ? columns : line.length, cut ? line.chars : null).at(left, this.baseline + index * this.rowHeight)
            let before: Node | null = null
            if (line.kind === 'command') {
                before = new Glyphs(prompt.join(''))
                prompt.forEach((char, column) => {
                    const leaf = glyph(char, column, 'dim', 'the prompt')
                    if (leaf) before!.add(leaf)
                })
                row.add(before)
            }
            const paint = line.color ?? (line.kind === 'note' ? 'dim' : 'ink')
            chars.forEach((char, column) => {
                // The ellipsis is not a character of the program, so it is dim, as a note is.
                const leaf = glyph(char, line.before + column, cut && column === chars.length - 1 ? 'dim' : paint, `line ${index}`)
                row.cells.push(leaf)
                if (leaf) row.add(leaf)
            })
            if (!shown) row.base.visible = false
            this.rows.push(row)
            this.lines.push(row)
            this.prompts.push(before)
            this.add(row)
        })
        this.since = given.map(() => (shown ? -Infinity : null))
    }

    /**
     * One part of the text of a line, as one node: to color a number, to `indicate` it, or to point a
     * callout at it. It matches the exact characters, spaces included, in the commands, the output and the
     * notes, from the first line to the last. `occurrence` counts the matches from 0. `codeBlock.find` is
     * different: it returns the glyphs of every match as a list, spaces do not count there, and its second
     * argument is a line.
     */
    find(text: string, occurrence = 0): Node {
        const needle = [...text]
        if (!Number.isInteger(occurrence) || occurrence < 0) throw new Error('terminal: occurrence is a whole number, 0 for the first match')
        // Where the text starts in a line. The next match starts after this one, as in `codeBlock.find`.
        const starts = (chars: readonly string[]): number[] => {
            const found: number[] = []
            for (let at = 0; at + needle.length <= chars.length; at++) {
                if (!needle.every((char, offset) => chars[at + offset] === char)) continue
                found.push(at)
                at += Math.max(0, needle.length - 1)
            }
            return found
        }
        let seen = 0
        for (const row of this.rows) {
            for (const at of starts(row.chars)) {
                if (seen++ !== occurrence) continue
                // A space at an end draws nothing, so it is not a part of the node.
                let from = at, to = at + needle.length
                while (from < to && !row.cells[from]) from++
                while (to > from && !row.cells[to - 1]) to--
                if (from === to) throw new Error(`terminal: find() needs a text with a character to draw, and got ${JSON.stringify(text)}`)
                return this.span(row, from, to)
            }
        }
        // Say why a text that the film gave to the terminal is not there.
        const cut = this.rows.findIndex((row) => row.whole !== null && starts(row.whole).length > starts(row.chars).length)
        const why = cut >= 0 ? `. Line ${cut} has it in the part that \`clip\` cut off`
            : text.endsWith(' ') ? '. The spaces at the end of a line are not a part of the line' : ''
        if (seen === 0) throw new Error(`terminal: no line has the text ${JSON.stringify(text)}. find() matches the exact characters, spaces included${why}`)
        throw new Error(`terminal: the text ${JSON.stringify(text)} is there ${seen} ${seen === 1 ? 'time' : 'times'}, so it has no occurrence ${occurrence}. Occurrences count from 0${why}`)
    }

    /** The start or the end of a line, in the coordinates of the panel, at the middle height of its letters. The start of a command is the start of its prompt. Defaults to the start. */
    p(line: number, side: 'left' | 'right' = 'left'): [number, number] {
        const row = this.row(line)
        return [
            this.start + (side === 'right' ? row.length * this.advance : 0),
            this.baseline + line * this.rowHeight - this.rise,
        ]
    }

    /** A copy with its own record of the lines that are shown. */
    override clone(): this {
        const copy = super.clone()
        copy.since = [...this.since]
        return copy
    }

    /**
     * The panel and the bar arrive, with no line. `type()`, `print()` and `showLines()` bring the lines. A
     * line that one of them shows in the same `play` stays, whatever the order of the two.
     */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'terminal.enter', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                this.clear(ctx.t0)
                for (const part of [this.frame, this.bar, this.title, this.note]) {
                    if (!part) continue
                    stepAt(part, 'opacity', 0, ctx.t0)
                    part.tween('opacity', 1, ctx.t0, ctx.t1, ctx.ease)
                }
            },
        }
    }

    /**
     * A command arrives character by character, at a steady rate, after its prompt. Lines count from 0. A
     * command that is already shown is an error: start the terminal with `shown: false`, or play `enter()`.
     */
    type(line: number, options: AnimOptions = {}): Anim {
        const row = this.row(line)
        if (row.kind !== 'command') throw new Error(`terminal: line ${line} is ${row.kind === 'note' ? 'a note' : 'output'}, not a command. type() types a command, and print() brings the other lines`)
        const glyphs = row.cells.filter((cell): cell is Node => cell !== null)
        return {
            label: 'terminal.type', duration: options.duration ?? Math.max(0.4, glyphs.length * 0.06), ease: options.ease ?? linear,
            schedule: (ctx) => {
                this.arrive(ctx)
                // The film knows which lines are shown only when it plays, so this check is here.
                if (this.since[line] !== null) throw new Error(`terminal: line ${line} is already shown, so type() cannot type it. Start the terminal with { shown: false }, or play enter() before type()`)
                stepAt(row, 'visible', true, ctx.t0)
                this.since[line] = ctx.t0
                // The prompt stands alone for the time of one character, and so does the whole command
                // at the end, before the output comes.
                const span = ctx.t1 - ctx.t0
                glyphs.forEach((glyph, index) => {
                    stepAt(glyph, 'opacity', 0, ctx.t0)
                    stepAt(glyph, 'opacity', 1, ctx.t0 + span * ctx.ease((index + 1) / (glyphs.length + 1)))
                })
            },
        }
    }

    /**
     * Lines arrive one after another, in order, each at once, as a terminal prints them. Without `from` and
     * `to`, it prints the next block: from the first line that is not yet shown, to the line before the next
     * command that is not yet shown. A command at the start of the block arrives whole. So `type()` then
     * `print()` types a command and prints its output, `print()` alone shows the command and its output, and
     * a second `print()` goes on with the next block. With a range, such as `{ from: 1, to: 3 }` for lines 1,
     * 2 and 3, it prints every line of the range that is not yet shown.
     */
    print(options: AnimOptions & { from?: number; to?: number } = {}): Anim {
        const last = this.rows.length - 1
        const ranged = options.from !== undefined || options.to !== undefined
        const from = options.from ?? 0, to = options.to ?? last
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > last || from > to) {
            throw new Error(`terminal: print from ${from} to ${to}. \`from\` and \`to\` are lines from 0 to ${last}, and \`from\` is not after \`to\``)
        }
        // The default time follows the lines: those of the range, or those of the longest block.
        let count = to - from + 1
        if (!ranged) {
            count = 1
            for (let index = 0, run = 0; index <= last; index++) {
                run = this.rows[index]!.kind === 'command' ? 1 : run + 1
                count = Math.max(count, run)
            }
        }
        return {
            label: 'terminal.print', duration: options.duration ?? Math.min(3, Math.max(0.3, count * 0.12)), ease: options.ease ?? linear,
            schedule: (ctx) => {
                this.arrive(ctx)
                const next: number[] = []
                for (let index = from; index <= to; index++) {
                    if (this.since[index] !== null) continue
                    // With no range, the block ends before the next command. A command that starts the
                    // block is part of it: the film did not type it.
                    if (!ranged && next.length > 0 && this.rows[index]!.kind === 'command') break
                    next.push(index)
                }
                next.forEach((index, order) => {
                    const time = ctx.t0 + (ctx.t1 - ctx.t0) * ctx.ease(order / next.length)
                    stepAt(this.rows[index]!, 'visible', true, time)
                    this.since[index] = time
                })
            },
        }
    }

    /** Every line that is not yet shown fades in, all together: for a film that does not want the typing. */
    showLines(options: AnimOptions = {}): Anim {
        return {
            label: 'terminal.showLines', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                this.arrive(ctx)
                this.rows.forEach((row, index) => {
                    if (this.since[index] !== null) return
                    stepAt(row, 'visible', true, ctx.t0)
                    stepAt(row, 'opacity', 0, ctx.t0)
                    row.tween('opacity', 1, ctx.t0, ctx.t1, ctx.ease)
                    this.since[index] = ctx.t0
                })
            },
        }
    }

    private row(line: number): Row {
        const row = this.rows[line]
        if (!row) throw new Error(`terminal: no line ${line}. The terminal has ${this.rows.length} ${this.rows.length === 1 ? 'line' : 'lines'}, and the first is line 0`)
        return row
    }

    /**
     * Hide every line from a time on. A line that an animation shows at that time or after it stays: the
     * animation is in the same `play`, and it was scheduled first.
     */
    private clear(time: number): void {
        this.rows.forEach((row, index) => {
            const since = this.since[index] ?? null
            if (since !== null && since >= time) return
            stepAt(row, 'visible', false, time)
            this.since[index] = null
        })
    }

    /** Put the terminal on the stage. A terminal that was not on the stage shows no line yet, so its panel comes empty. */
    private arrive(ctx: AnimContext): void {
        const fresh = !this.mounted
        reveal(this, ctx.t0, ctx.stage)
        if (fresh) this.clear(ctx.t0)
    }

    /** The node that holds the glyphs of the characters `from` to `to` of a line, and nothing else. Both ends have a glyph. */
    private span(row: Row, from: number, to: number): Node {
        // Go up from the first glyph to the node that holds the whole part: the line, or a part from before.
        let holder = row.cells[from]!.parent!
        while (holder instanceof Span && (holder.from > from || holder.to < to)) holder = holder.parent!
        if (holder instanceof Span && holder.from === from && holder.to === to) return holder
        const made = new Span(row.chars.slice(from, to).join(''), from, to)
        const inside: Node[] = []
        for (const child of holder.children) {
            const start = child instanceof Span ? child.from : row.cells.indexOf(child)
            const end = child instanceof Span ? child.to : start + 1
            if (end <= from || start >= to) continue
            if (start < from || end > to) {
                throw new Error(`terminal: ${JSON.stringify(made.source)} shares characters with ${JSON.stringify((child as Span).source)}, which find() selected before, and neither holds the other. Select parts that do not share characters`)
            }
            inside.push(child)
        }
        // Take the place of the glyphs in the line, so that the order of drawing stays. `add()` is not used:
        // on a terminal that is on the stage, it starts the visibility of a node at the time of the call.
        holder.children.splice(holder.children.indexOf(inside[0]!), inside.length, made)
        made.parent = holder
        made.mounted = holder.mounted
        made.children = inside
        for (const child of inside) child.parent = made
        return made
    }
}

/** The output of a program in a panel, with the exact characters: `terminal([{ text: './one-byte', kind: 'command' }, 'minor faults:              1'], { title: 'runs/01-one-byte.txt', note: 'Linux 7.0, arm64, 2026-11-08' })`. */
export function terminal(lines: readonly (string | TerminalLine)[], options: TerminalOptions = {}): Terminal {
    return new Terminal(lines, options)
}
