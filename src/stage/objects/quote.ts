import { Node, ownLabels } from '../node'
import { rectPath } from '../geometry'
import { text, type TextNode, type TextOptions } from '../text'
import type { ColorInput } from '../color'
import type { Anim, AnimOptions } from '../anim'
import { reveal, staggered, stepAt } from './util'

export interface QuoteOptions {
    /** Who said the words: a person, a company, or a document. */
    by?: string
    /** When, written as the film wants it on screen, such as `'2026-06-02'`. */
    when?: string
    /** Where: the title of the paper, the page, or the talk. */
    where?: string
    /** The width of the object, from the left edge of the rule to the place where the words wrap. Nothing of the object passes it. Defaults to 900. */
    width?: number
    /** Font size of the words. Defaults to 32. */
    size?: number
    /** The color of the rule and of the marked parts. Defaults to blue. */
    color?: ColorInput
    /**
     * Parts of the words to set in `markColor`, such as the phrase that the voice says. A part starts and
     * ends at the borders of words: `'not'` is the word "not", and not the first letters of "nothing". A
     * part that is in the words more than once is marked at all its places. A part with no such place is
     * an error.
     */
    mark?: string | readonly string[]
    /** The color of the marked parts. Defaults to `color`. */
    markColor?: ColorInput
    /**
     * The film left words out. Write `[...]` in the words at each such place: the object adds none. With
     * `cut`, each `[...]` is in dim, so the viewer sees that it is not a word of the source.
     */
    cut?: boolean
    /** Set the words in italic. On by default. */
    italic?: boolean
    /** Font size of the source line. Defaults to 0.78 of `size`, and to 24 at least when `size` is 24 or more. */
    sourceSize?: number
    /** Line height of the words, as a multiple of `size`. Defaults to 1.3. */
    leading?: number
    /** The font of the words and of the source line. Defaults to text-serif. */
    font?: TextOptions['font']
}

// The two curved quotation marks around the words, and the two single ones for a quotation inside them.
const OPEN = '\u201c', CLOSE = '\u201d'
const INNER_OPEN = '\u2018', INNER_CLOSE = '\u2019'
const CUT = '[...]'
const SOURCE_LEADING = 1.25

/** The room that the rule and the space after it take, at the left of the words. */
function inset(size: number): { rule: number; text: number } {
    const rule = Math.max(3, Math.round(size * 0.14))
    return { rule, text: rule + Math.round(size * 0.6) }
}

/**
 * The room that a line of text needs, from its start: its advance width, or its ink when the last letter
 * leans past its advance, as an italic f does.
 */
function reach(content: string, style: TextOptions): number {
    const made = text(content, style)
    const half = made.get('px'), ink = made.bounds()
    return Math.max(half * 2, ink.x + ink.width + half)
}

/**
 * The parts of a paragraph in which no line can break. A line breaks at a space, as in `text()`, and at no
 * other space: a no-break space joins two words into one part. With `slash`, a line can also break after a
 * "/", so a web address is the parts "https://", "example.com/", and "page". `spaced` is true for a part
 * that has a space before it.
 */
function runs(paragraph: string, slash: boolean): { run: string; spaced: boolean }[] {
    return paragraph.split(' ').filter((word) => word !== '').flatMap((word) => (slash ? word.match(/[^/]*\/+|[^/]+/g)! : [word]).map((run, index) => ({ run, spaced: index === 0 })))
}

/** The widest part of a text in which no line can break, and the room that it needs. */
function widestRun(content: string, style: TextOptions, slash = false): { run: string; width: number } {
    let widest = { run: '', width: 0 }
    for (const { run } of content.split('\n').flatMap((paragraph) => runs(paragraph, slash))) {
        const width = reach(run, style)
        if (width > widest.width) widest = { run, width }
    }
    return widest
}

/**
 * The lines of a text in a width. `text()` breaks a line by the advance of its words, and the ink of a last
 * letter can pass that: an italic f leans over the place after it. Here a line has the room of its ink, so
 * no letter passes the width. A part that is wider than the width has a line of its own: the caller refuses
 * it before, with `widestRun`.
 */
function wrap(content: string, style: TextOptions, room: number, slash = false): string[] {
    const lines: string[] = []
    for (const paragraph of content.split('\n')) {
        let line = ''
        for (const { run, spaced } of runs(paragraph, slash)) {
            const longer = line === '' ? run : `${line}${spaced ? ' ' : ''}${run}`
            if (line !== '' && reach(longer, style) > room) {
                lines.push(line)
                line = run
            } else {
                line = longer
            }
        }
        lines.push(line)
    }
    return lines
}

/**
 * The top of the tall letters, the base line, and the bottom of the tails, all from the anchor of a text of
 * one line. They are measured, so the layout holds for any font. The probe has the letters and the bracket
 * that go highest and lowest: an italic f does both.
 */
function metrics(style: TextOptions): { top: number; base: number; bottom: number } {
    const all = text('fjy(', style).bounds(), flat = text('H', style).bounds()
    return { top: all.y, base: flat.y + flat.height, bottom: all.y + all.height }
}

/**
 * The words as the object draws them. The object puts double marks around the words, so a double mark
 * inside them is a quotation inside a quotation, and it is drawn as a single curved mark: the open one at
 * the start of a word, and the closed one at any other place. One character stays one character, so each
 * glyph still has its character in the words that the film gave.
 */
function innerMarks(words: string): string {
    const chars = [...words]
    // How many quotations are open at this place.
    let open = 0
    return chars.map((char, index) => {
        const before = chars[index - 1]
        const starts = char === OPEN || (char === '"' && (before === undefined || /[\s([{\u2013\u2014-]/.test(before)))
        if (starts) {
            open++
            return INNER_OPEN
        }
        if (char !== CLOSE && char !== '"') return char
        // After a digit, with no quotation open, a straight mark is the sign for inches, and it stays.
        if (char === '"' && open === 0 && /\d/.test(before ?? '')) return char
        open = Math.max(0, open - 1)
        return INNER_CLOSE
    }).join('')
}

/** The words of a quote as the film gave them and as the object draws them, both between the quotation marks, and the style of their text. */
function wording(words: string, options: QuoteOptions, owner: string): { given: string; content: string; size: number; style: TextOptions } {
    if (typeof words !== 'string' || words.trim() === '') throw new Error(`${owner}: give it the words of the source`)
    const size = options.size ?? 32
    if (!(Number.isFinite(size) && size > 0)) throw new Error(`${owner}: size is the text size of the words, more than 0`)
    return { given: `${OPEN}${words.trim()}${CLOSE}`, content: `${OPEN}${innerMarks(words.trim())}${CLOSE}`, size, style: { font: options.font ?? 'text-serif', size, italic: options.italic ?? true } }
}

/** A letter or a digit: a character of a word. A match of `mark` does not start or end between two of them. */
const inWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_]/u.test(char)

/** What each timing option of an entrance is, for an error. */
const TIMING = { lag: 'the part of the time of one line that passes before the next line starts: a number, 0 or more', duration: 'a number of seconds, 0 or more' } as const

/** A lag or a duration that is not a number would leave the object hidden, with no error. So the entrance refuses it. */
function checkTiming(owner: string, options: AnimOptions): void {
    for (const name of ['lag', 'duration'] as const) {
        const value: unknown = options[name]
        if (value !== undefined && !(typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error(`${owner}: ${name} is ${typeof value === 'string' ? JSON.stringify(value) : String(value)}. It is ${TIMING[name]}`)
    }
}

/**
 * The exact words of a source between quotation marks, with a rule at their left, and one line under them
 * that says who said them, when, and where. `.at(x, y)` places the top end of the rule, so quotes of
 * different lengths start at one corner. The object is as high as its words need: read `quote.height`.
 */
export class Quote extends Node {
    /** The words with their quotation marks, as one text. The film check reads it as one sentence. */
    readonly words: TextNode
    /** The line under the words: the speaker, the date, and the place. Null when the film gives none of them. */
    readonly source: TextNode | null
    /** The line at the left, from the top of the words to the bottom of the source line. */
    readonly rule: Node
    /** The y of the base line of the first line of the words, in the coordinates of the object. A label beside the quote can stand on it. */
    readonly baseline: number
    /** The line of each glyph of the words, from 0. `enter()` brings the words in line by line. */
    private readonly rows: number[]
    private readonly lineCount: number
    /** The character of each glyph of the words as the film gave it. `find` reads these, and not the single marks that the object draws. */
    private readonly given: string[]
    /** True for a glyph that has a space before it, or that is the first one. */
    private readonly spaced: boolean[]
    /** The x of the end of the ink of each line of the words. */
    private readonly ends: number[]

    /** The third argument is for `quotePair`: it makes an error name the quote and the width of the pair. */
    constructor(words: string, options: QuoteOptions = {}, pair?: { index: number; width: number; gap: number }) {
        super()
        const owner = pair ? 'quotePair' : 'quote'
        const { given, content, size, style } = wording(words, options, pair ? `quotePair: quote ${pair.index}` : 'quote')
        const width = options.width ?? 900
        const sides = inset(size)
        const room = width - sides.text
        if (!pair && !(Number.isFinite(width) && room > 0)) throw new Error(`quote: width is the width of the object. Give more than ${sides.text}, the room of the rule at size ${size}`)
        const of = pair ? ` of quote ${pair.index}` : ''
        // What a part of the text has, and the width that is enough for it. For a pair: the width of the pair.
        const has = (kind: string) => (pair ? `a width of ${pair.width} with a gap of ${pair.gap} leaves ${Math.max(0, Math.floor(room))} px for ${kind} of each quote` : `a width of ${width} leaves ${Math.floor(room)} px for ${kind}`)
        const enough = (needs: number) => (pair ? [`a width of ${Math.ceil((needs + sides.text) * 2 + pair.gap)} or more`, 'a smaller gap'] : [`a width of ${Math.ceil(needs + sides.text)} or more`])
        const give = (...ways: string[]) => `Give ${ways.slice(0, -1).join(', ')}, or ${ways[ways.length - 1]}`
        const longest = widestRun(content, style)
        if (longest.width > room) {
            // A part with a space inside is two words or more that a no-break space joins.
            const joined = /\s/.test(longest.run)
            throw new Error(joined
                ? `${owner}: no line can break in ${JSON.stringify(longest.run)}${of}, because no-break spaces join its words. It is ${Math.ceil(longest.width)} px wide at size ${size}, and ${has('the words')}. ${give(...enough(longest.width), 'a smaller size', 'a plain space where a line may break')}`
                : `${owner}: the word ${JSON.stringify(longest.run)}${of} is ${Math.ceil(longest.width)} px wide at size ${size}, and ${has('the words')}. ${give(...enough(longest.width), 'a smaller size')}`)
        }
        const leading = options.leading ?? 1.3
        if (!(Number.isFinite(leading) && leading > 0)) throw new Error('quote: leading is the line height as a multiple of size, more than 0')
        const color = options.color ?? 'blue'

        this.words = text(wrap(content, style, room).join('\n'), { ...style, color: 'ink', anchor: 'left', leading })
        // The film check reads the words as one sentence, with the breaks that the film wrote and no others.
        this.words.source = content
        // The same glyphs on one line. The difference in y gives the line of each glyph in the wrapped text.
        const flat = text(content.replace(/\n/g, ' '), { ...style, anchor: 'left' })
        const pitch = leading * size
        this.rows = this.words.chars.map((glyph, index) => Math.round((glyph.get('y') - flat.chars[index]!.get('y')) / pitch))
        this.lineCount = Math.max(0, ...this.rows) + 1

        // Walk the words as the film gave them beside the glyphs. A space has no glyph. A drawn character is
        // the given one, but for a double mark inside the words, which is drawn as a single one.
        this.given = []
        this.spaced = []
        const drawn = [...content], written = [...given]
        let space = true
        drawn.forEach((char, index) => {
            if (/\s/.test(char)) {
                space = true
            } else if (this.words.chars[this.given.length]?.data['key'] === char) {
                this.given.push(written[index]!)
                this.spaced.push(space)
                space = false
            }
        })

        if (options.cut) {
            const signs = this.find(CUT)
            if (signs.length === 0) throw new Error(`quote: cut is true, and the words have no ${CUT}. Write ${CUT} at each place where the film left words out. The object adds none`)
            for (const glyph of signs) glyph.color('dim')
        }
        const marks = options.mark === undefined ? [] : typeof options.mark === 'string' ? [options.mark] : options.mark
        for (const part of marks) {
            const { whole, inside } = this.places(part)
            if (whole.length === 0) {
                if (inside.length === 0) throw new Error(`quote: the mark ${JSON.stringify(part)} is not in the words. A mark is a part of the words, letter for letter`)
                throw new Error(`quote: the mark ${JSON.stringify(part)} is not in the words as whole words: it is a part of ${JSON.stringify(this.wordsAt(inside[0]!))}. A mark starts and ends at the borders of words`)
            }
            for (const [from, to] of whole) for (const glyph of this.words.chars.slice(from, to)) glyph.color(options.markColor ?? color)
        }

        const body = metrics(style)
        // The top of the object is the top of the tall letters of the first line.
        const firstBase = this.baseline = body.base - body.top
        const lastBase = firstBase + (this.lineCount - 1) * pitch
        // A text of several lines has its anchor at the middle of its lines.
        this.words.at(sides.text, firstBase - body.base + ((this.lineCount - 1) * pitch) / 2)
        // The words have no parent yet, so the bounds of a glyph are in the coordinates of the object.
        this.ends = Array.from({ length: this.lineCount }, () => 0)
        this.words.chars.forEach((glyph, index) => {
            const box = glyph.bounds(), row = this.rows[index]!
            this.ends[row] = Math.max(this.ends[row]!, box.x + box.width)
        })
        let foot = lastBase + (body.bottom - body.base)

        const parts = (['by', 'when', 'where'] as const).map((name) => ({ name, value: options[name] })).filter((part): part is { name: 'by' | 'when' | 'where'; value: string } => typeof part.value === 'string' && part.value.trim() !== '').map(({ name, value }) => ({ name, value: value.trim() }))
        this.source = null
        if (parts.length > 0) {
            const sourceSize = options.sourceSize ?? (size < 24 ? size : Math.max(24, Math.round(size * 0.78)))
            if (!(Number.isFinite(sourceSize) && sourceSize > 0)) throw new Error('quote: sourceSize is the text size of the source line, more than 0')
            const sourceStyle: TextOptions = { font: style.font, size: sourceSize }
            // A source that is wider than the words breaks into lines, so it never leaves the width of the
            // object. A web address has no space, so a line of the source can also break after a "/".
            for (const { name, value } of parts) {
                const stuck = widestRun(value, sourceStyle, true)
                if (stuck.width > room) throw new Error(`${owner}: the part ${JSON.stringify(stuck.run)} of \`${name}\`${of} is ${Math.ceil(stuck.width)} px wide at size ${sourceSize}, and ${has('the source line')}. A line of the source breaks at a space and after a "/". ${give(`a shorter \`${name}\``, ...enough(stuck.width))}`)
            }
            const line = parts.map((part) => part.value).join(', ')
            const lines = wrap(line, sourceStyle, room, true)
            const placed = text(lines.join('\n'), { ...sourceStyle, color: 'dim', anchor: 'left', leading: SOURCE_LEADING })
            // The film check reads the line as the film gave it, with no break in an address.
            placed.source = line
            const under = metrics(sourceStyle)
            // More room than between two lines of the words, so the source does not read as one more line of them.
            const top = foot + size * 0.6
            const base = top + (under.base - under.top)
            placed.at(sides.text, base - under.base + ((lines.length - 1) * SOURCE_LEADING * sourceSize) / 2)
            foot = base + (lines.length - 1) * SOURCE_LEADING * sourceSize + (under.bottom - under.base)
            this.source = placed
        }

        // A filled shape and not a stroke, so its bounds are the bounds of the object: from 0 to its height.
        this.rule = new Node(rectPath(0, 0, sides.rule, foot, sides.rule / 2)).fill(color)
        this.add(this.rule, this.words)
        if (this.source) this.add(this.source)
        // The quote places its words and its source beside its rule. The film check does not judge that room.
        ownLabels(this, { name: 'quote' })
    }

    /**
     * The glyphs of a part of the words, to color them or to move them. The part is as the film wrote the
     * words. Spaces do not count, and the part may run over the end of a line. Places at the borders of
     * words come first: `find('not')` gives the word "not" at each of its places, and not the letters in
     * "nothing". A part that is only inside longer words gives those places. A part that is not in the
     * words gives an empty list.
     */
    find(part: string): Node[] {
        const { whole, inside } = this.places(part)
        return (whole.length > 0 ? whole : inside).flatMap(([from, to]) => this.words.chars.slice(from, to))
    }

    /**
     * What a viewer reads: the words and the source line, as one text. A quote stays up for
     * `readingSeconds(said.reading)`. The film check gives the words and the source line each its own time,
     * which is less.
     */
    get reading(): string {
        return this.source ? `${this.words.source} ${this.source.source}` : this.words.source
    }

    /** The x of the end of the ink of a line of the words, in the coordinates of the object. Line 0 is the first one. */
    lineEnd(line = 0): number {
        const end = this.ends[line]
        if (end === undefined) throw new Error(`quote: no line ${line}. The words have ${this.lineCount} lines`)
        return end
    }

    /** The rule grows down from the top, the words arrive line by line, and then the source line. */
    enter(options: AnimOptions = {}): Anim {
        checkTiming('quote', options)
        return {
            label: 'quote.enter', duration: options.duration ?? 1.4, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx, span = t1 - t0
                // The origin of the rule is its top end, so it grows down from there.
                stepAt(this.rule, 'sy', 0, t0)
                this.rule.tween('sy', 1, t0, t0 + span * 0.35, ease)
                // The source line takes the last part of the time. Without one, the words take it.
                const windows = staggered(this.lineCount, options.lag ?? 0.5, t0 + span * 0.15, this.source ? t0 + span * 0.8 : t1)
                this.words.chars.forEach((glyph, index) => {
                    const [start, end] = windows[this.rows[index]!]!
                    stepAt(glyph, 'opacity', 0, t0)
                    glyph.tween('opacity', 1, start, end, ease)
                })
                if (this.source) {
                    stepAt(this.source, 'opacity', 0, t0)
                    this.source.tween('opacity', 1, t0 + span * 0.7, t1, ease)
                }
            },
        }
    }

    /**
     * Where a part is in the words, as ranges of glyphs: the places at the borders of words, and the places
     * that start or end inside a word. In each list, a place starts after the one before it ends.
     */
    private places(part: string): { whole: [number, number][]; inside: [number, number][] } {
        const needle = [...String(part)].filter((char) => !/\s/.test(char))
        const whole: [number, number][] = [], inside: [number, number][] = []
        if (needle.length === 0) return { whole, inside }
        const count = this.given.length
        // The place between glyph `at - 1` and glyph `at` is a border when a space is there, or when the two are not both characters of a word.
        const border = (at: number) => at === 0 || at === count || this.spaced[at]! || !(inWord(this.given[at - 1]) && inWord(this.given[at]))
        for (let at = 0; at + needle.length <= count; at++) {
            if (!needle.every((char, offset) => this.given[at + offset] === char)) continue
            const list = border(at) && border(at + needle.length) ? whole : inside
            const last = list[list.length - 1]
            if (!last || last[1] <= at) list.push([at, at + needle.length])
        }
        return { whole, inside }
    }

    /** The words around a place, from the border of a word to the border of a word, for an error that shows where a mark is. */
    private wordsAt([from, to]: [number, number]): string {
        let start = from, end = to
        while (start > 0 && !this.spaced[start] && inWord(this.given[start - 1])) start--
        while (end < this.given.length && !this.spaced[end] && inWord(this.given[end])) end++
        return this.given.slice(start, end).map((char, index) => (index > 0 && this.spaced[start + index] ? ` ${char}` : char)).join('')
    }
}

/** The exact words of a source, with who said them and when: `quote('the agent loop lives in Temporal', { by: 'Cursor', when: '2026-06-02', width: 900, color: 'orange' })`. */
export function quote(words: string, options: QuoteOptions = {}): Quote {
    return new Quote(words, options)
}

/** One quote of a pair: its words and its own options. The pair gives it its width. */
export interface QuoteSpec extends Omit<QuoteOptions, 'width'> {
    words: string
}

export interface QuotePairOptions extends Pick<QuoteOptions, 'size' | 'color' | 'markColor' | 'italic' | 'sourceSize' | 'leading' | 'font'> {
    /** The width of the pair, from the rule of the first quote to the place where the words of the second one wrap. Defaults to 1700. */
    width?: number
    /** The room between the two quotes. Defaults to 3 times the text size, or the larger one of two sizes. */
    gap?: number
    /**
     * A word between the two quotes, such as `'but'` or `'against'`. It has the same room at both sides:
     * from the end of the first line of the first quote, and to the rule of the second quote.
     */
    versus?: string
}

/**
 * Two quotes side by side, for two sources that disagree. They have one width and one top line, and an
 * optional word stands between them. `.at(x, y)` places the top end of the rule of the first quote, and
 * nothing of the pair is over that top line.
 */
export class QuotePair extends Node {
    /** The two quotes, the left one first. */
    readonly quotes: readonly [Quote, Quote]
    /** The word between the two quotes, or null. */
    readonly versus: TextNode | null

    constructor(first: QuoteSpec, second: QuoteSpec, options: QuotePairOptions = {}) {
        super()
        const { width: total = 1700, gap: given, versus, ...shared } = options
        const specs = [first, second].map((spec) => ({ ...shared, ...spec }))
        const sizes = specs.map((spec, index) => wording(spec.words, spec, `quotePair: quote ${index}`).size)
        const gap = given ?? Math.max(...sizes) * 3
        if (!(Number.isFinite(gap) && gap >= 0)) throw new Error('quotePair: gap is the room between the two quotes, 0 or more')
        const each = (total - gap) / 2
        if (!(Number.isFinite(total) && each > 0)) throw new Error(`quotePair: a width of ${total} leaves no room for two quotes with a gap of ${gap}`)
        // Each quote knows that it is in a pair, so its errors name the quote and the width of the pair, which is the width that the film gave.
        const [left, right] = specs.map(({ words, ...own }, index) => new Quote(words, { ...own, width: each }, { index, width: total, gap })) as [Quote, Quote]
        right.at(each + gap, 0)
        this.quotes = [left, right]
        this.versus = null
        if (versus !== undefined && versus.trim() !== '') {
            // The word has the smaller of the two sizes, and stands on the first base line of the quote
            // with that size. So it is never over the top line of the pair, and never larger than a quote.
            const size = Math.min(...sizes), style = { font: shared.font ?? 'text-serif', size } as const
            const made = text(versus.trim(), { ...style, color: 'dim' })
            const ink = made.bounds(), letters = text('H', style).bounds().height
            // Beside a short first quote, a word in the middle of the gap reads as a part of the second
            // quote. So it has equal room at both sides: from the ink of the first line of the first quote,
            // and to the rule of the second quote. The room is the height of its letters at least.
            const from = left.lineEnd(0), to = each + gap
            const beside = (to - from - ink.width) / 2
            // A larger gap moves the second rule by half of what it adds, and the room at each side by a quarter.
            if (beside < letters) {
                throw new Error(`quotePair: the word ${JSON.stringify(versus.trim())} has ${Math.max(0, Math.floor(beside))} px at each side, between the first line of quote 0 and the rule of quote 1. It needs ${Math.ceil(letters)} px, the height of its letters. Give a gap of ${Math.ceil(gap + 4 * (letters - beside))} or more, or a shorter word`)
            }
            const lower = sizes[1]! < sizes[0]! ? right : left
            this.versus = made.at((from + to) / 2 - (ink.x + ink.width / 2), lower.baseline - metrics(style).base)
        }
        this.add(left)
        if (this.versus) this.add(this.versus)
        this.add(right)
        // The pair places its word between the first quote and the rule of the second one.
        ownLabels(this, { name: 'pair of quotes', labels: [this.versus] })
    }

    /** The first quote arrives, then the word, then the second quote. */
    enter(options: AnimOptions = {}): Anim {
        checkTiming('quotePair', options)
        return {
            label: 'quotePair.enter', duration: options.duration ?? 2.6, ease: options.ease,
            schedule: (ctx) => {
                const span = ctx.t1 - ctx.t0, turn = ctx.t0 + span * 0.54
                const [left, right] = this.quotes
                const arrive = (one: Quote, t0: number, t1: number) => one.enter({ lag: options.lag }).schedule({ t0, t1, ease: ctx.ease, stage: ctx.stage })
                // The entrance of the first quote brings the pair to the stage.
                arrive(left, ctx.t0, ctx.t0 + span * 0.46)
                if (this.versus) {
                    stepAt(this.versus, 'opacity', 0, ctx.t0)
                    this.versus.tween('opacity', 1, ctx.t0 + span * 0.42, ctx.t0 + span * 0.58, ctx.ease)
                }
                // The second quote waits while the first one arrives. At its turn, its own entrance starts from nothing.
                stepAt(right, 'opacity', 0, ctx.t0)
                stepAt(right, 'opacity', 1, turn)
                arrive(right, turn, ctx.t1)
            },
        }
    }
}

/** Two quotes side by side with a word between them: `quotePair({ words: 'it is safe', by: 'A' }, { words: 'it is not', by: 'B' }, { width: 1700, versus: 'but' })`. */
export function quotePair(first: QuoteSpec, second: QuoteSpec, options: QuotePairOptions = {}): QuotePair {
    return new QuotePair(first, second, options)
}
