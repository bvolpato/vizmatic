import { Node, ownLabels, rebindCloneParts } from '../node'
import { apply, invert, mul, transformPath, parseSvgPath, pathBounds, pathLength, pointAt, polyPath, ring, trimPath, circlePath, type Path, type Ring, type Vec } from '../geometry'
import { text, TextNode, type TextOptions } from '../text'
import { toPaint, type ColorInput } from '../color'
import { Value, type Anim, type AnimContext, type AnimOptions } from '../anim'
import { Box, boxOf } from '../layout'
import { matchSequence, pathMixer } from '../morph'
import { clock, Track } from '../track'
import type { Ease } from '../ease'
import { lerpSame, reveal, sampleAt, staggered, stepAt, tweenValue } from './util'

/** The shape that marks the words of a span beside its color. */
export type PassageSign = 'band' | 'box' | 'underline' | 'double' | 'dashed' | 'wavy' | 'hatch' | 'strike'

const SIGNS: readonly PassageSign[] = ['band', 'box', 'underline', 'double', 'dashed', 'wavy', 'hatch', 'strike']

export interface PassageKind {
    /** The color of the band behind the words and of the sign. A color has one job in a passage. */
    color: ColorInput
    /**
     * The second sign of the kind, so that color is not the only one: a plain band, a frame around the band,
     * a line under the words (one line, two lines, dashes, or a wave), diagonal lines over the band, or a line
     * through the words. Defaults to 'band'. Each kind of a passage has its own sign.
     */
    sign?: PassageSign
    /** Set the words of the span in dim, for words that are gone. */
    dim?: boolean
}

/** The kinds of a span for a text that a film marks, checks against a source, and changes. Each has its own sign. */
export const PASSAGE_KINDS = {
    /** A part that the film points at: a clause, a name, a number. */
    mark: { color: 'blue', sign: 'band' },
    /** A statement of an answer that is not checked yet. */
    claim: { color: 'purple', sign: 'box' },
    /** A source says the same. */
    supported: { color: 'green', sign: 'underline' },
    /** No source says it. */
    unsupported: { color: 'yellow', sign: 'dashed' },
    /** A source says another thing. */
    contradicted: { color: 'red', sign: 'wavy' },
    /** Text that came from outside, such as a web page in a prompt. */
    external: { color: 'orange', sign: 'hatch' },
    /** Words that the next version does not have. `diff()` gives it. */
    removed: { color: 'dim', sign: 'strike', dim: true },
    /** Words that the next version brings. `diff()` gives it. */
    added: { color: 'teal', sign: 'double' },
} satisfies Record<string, PassageKind>

/** What a count is in: the words between spaces, the characters with their spaces, or the tokens of a model. */
export type PassageUnit = 'words' | 'characters' | 'tokens'

/** The size of a part of the text. `tokens` is there when the passage has a `tokens` function. */
export interface PassageMeasure {
    words: number
    characters: number
    tokens?: number
}

/**
 * A part of a passage: its words, the words at one of several places, a chunk by its index, or the node of
 * a span or a chunk.
 */
export type PassageRef = string | { words: string; occurrence?: number } | { chunk: number } | PassageSpan

/**
 * Cut a passage by word count, token budget, sentence, paragraph, or an explicit list of excerpts.
 * A token budget uses the tokenizer supplied to the passage.
 */
export type PassageCut = { size: number; overlap?: number } | { tokens: number } | { by: 'sentence' | 'paragraph' } | readonly string[]

export interface PassageOptions {
    /**
     * The width of the object: of its frame, or of the room of its text with `panel: false`. The words wrap in
     * it, and nothing of the object passes it. Defaults to the width that the text needs on one line, and to 900
     * at the most.
     */
    width?: number
    /** Text size of the words. Defaults to 32. */
    size?: number
    /** The height of a line as a multiple of `size`. Defaults to 1.6, which leaves room for a link between two lines. */
    leading?: number
    /** The font of the words and of the title. Defaults to the font of the film. */
    font?: TextOptions['font']
    /** One line over the words that names the text: a file, a role such as 'user', or 'answer'. */
    title?: string
    /** Text size of the title. Defaults to 0.8 of `size`, and to 26 at least when `size` is 26 or more. */
    titleSize?: number
    /** Draw a quiet frame behind the text, as a page. On by default. */
    panel?: boolean
    /** The color of the border of the frame and of the title. Defaults to a quiet border and a dim title. */
    color?: ColorInput
    /** The kinds that a span can have, each with a color and a sign. Defaults to `PASSAGE_KINDS`. */
    kinds?: Readonly<Record<string, PassageKind>>
    /**
     * The least number of lines that the frame holds. With it, the frame has one height from the start, and a
     * `diff()` that needs more lines is an error. Without it, the frame is as high as its text, and it follows
     * a `diff()`.
     */
    lines?: number
    /**
     * How many tokens a text has, for `measure()` and `counter('tokens')`: the tokenizer of the film, or an
     * estimate such as `(text) => Math.ceil(text.length / 4)`. The passage has no tokenizer of its own.
     */
    tokens?: (text: string) => number
}

// All of these are parts of the text size.
/** The room between the frame and the text, at the sides and at the top and the bottom. */
const PAD_X = 0.7, PAD_Y = 0.5
/** The room at the sides of the text with no frame: a band and the frame of the selection pass the ink of a word. */
const EDGE = 0.2
/** A band passes the ink of its words by this at each side. The band of a chunk passes it by less, so two chunks on one line have a gap between them. */
const BAND_SIDE = 0.1, CHUNK_SIDE = 0.03
/** A band goes over the tall letters by this, and under the tails by this. The lines under the words are in that room. */
const BAND_OVER = 0.08, BAND_UNDER = 0.2
/** The thickness of a line under or through the words. */
const LINE = 0.085
/** The room between the tails of the letters and a line under the words. */
const UNDER = 0.03
/** An empty line in the text adds this part of a line. */
const PARA = 0.5
/** The opacity of the band of a span, of a chunk, and of the selection. Words in ink read on each in a dark look and in a light one. */
const MARK_FILL = 0.34, CHUNK_FILL = 0.2, PICK_FILL = 0.1
/** The opacity of the band of the words of a change. It is lower than for a span, because a change can be inside a span. */
const EDIT_FILL = 0.2
/** The opacity of the diagonal lines of a hatch. They are behind the words. */
const HATCH_FILL = 0.4
const KAPPA = 0.5522847498307936
/** Two times nearer than this are one time. */
const SOON = 1e-6

type Gap = 'start' | 'space' | 'line' | 'para'

interface Glyph {
    node: Node
    char: string
    token: Token
    /** The place of the node from the start of its word and from the base line. */
    ox: number
    oy: number
    /** Half of the width of the ink. */
    half: number
    /** The glyph is drawn in dim now. */
    dim: boolean
}

interface Token {
    text: string
    glyphs: Glyph[]
    /** The advance width, and the reach of the ink when the last letter leans past it. */
    width: number
    ink: number
    /** What is before the word: nothing, a space, a line break, or an empty line. */
    gap: Gap
    /** The gap that the word takes when the words that are struck before it leave. */
    later: Gap | null
    state: 'plain' | 'struck' | 'added'
    /** The start of the word from the left edge of the text, and its line. */
    x: number
    line: number
}

interface Look {
    color: ColorInput
    sign: PassageSign
    /** The opacity of the band. */
    fill: number
    /**
     * The band is around the words, or it is as high as the line, so the bands of two lines meet: a chunk. A
     * chunk has the upper half of the line over the words that it shares with the next chunk, and the lower
     * half over the words that it shares with the chunk before it.
     */
    shape: 'band' | 'line' | 'upper' | 'lower'
    dim: boolean
}

/** One line of a range: the ends of the ink of its words, the ends of its band, and the top of the line. */
interface Ends {
    line: number
    x0: number
    x1: number
    b0: number
    b1: number
    top: number
}

/** What is drawn for one line of a range, with the ends that it was drawn with last. */
interface Part extends Ends {
    group: Node
    band: Node
    sign: Node | null
}

/** Some words in a row, with what is drawn for them: a span, a chunk or one of its strips, a change, or the selection. */
interface Range {
    node: PassageSpan
    /** What is drawn over the words: the line of a strike. */
    over: Node
    first: Glyph
    last: Glyph
    look: Look
    /** The kind of a span that a film marked. Null for the others. */
    kind: string | null
    parts: Part[]
    /**
     * The band meets the band of the words before it, and of the words after it, with no gap: two strips of
     * one chunk are one band.
     */
    joins: readonly [before: boolean, after: boolean]
}

interface Flow {
    at: Map<Token, readonly [x: number, line: number]>
    /** The top of each line, from the top of the text. */
    tops: number[]
    height: number
}

/** Where a line leaves a part of the text by each side: the x of the end of the ink there, and the base line of that line of text. */
type Anchors = readonly [leftX: number, leftBase: number, rightX: number, rightBase: number]

/** A part of the text that a link ends at, with its place over the time of the film: a diff() moves it. */
interface Tie {
    range: { first: Glyph; last: Glyph }
    places: Track<Anchors | null>
}

type LinkAnchor = (side: 'left' | 'right') => readonly [Vec, Vec, Vec] | null
const COPY_ANCHOR = new WeakMap<LinkAnchor, (page: Passage) => LinkAnchor>()

const SPANS = new WeakMap<PassageSpan, { range: Range; words: () => string }>()

/**
 * The node of a span or a chunk of a passage: the bands behind its words. Give it to `connector`, to `beside`
 * as the part of an object, to a light, or to `link()` of another passage as the target.
 */
export class PassageSpan extends Node {
    constructor(
        /** The passage that the span is a part of. */
        readonly passage: Passage,
    ) {
        super()
    }

    /** The words of the span, as the passage has them now. */
    get words(): string {
        return SPANS.get(this)?.words() ?? ''
    }

    /** The kind of a span that a film marked. Null for a chunk. */
    get kind(): string | null {
        return SPANS.get(this)?.range.kind ?? null
    }
}

/** A box with round corners. It has the same points at each size, also at a width of 0, so one box changes into another. */
function bar(x0: number, x1: number, top: number, bottom: number, radius: number): Path {
    const r = Math.max(0, Math.min(radius, Math.abs(x1 - x0) / 2, Math.abs(bottom - top) / 2)), k = r * (1 - KAPPA)
    const line = (out: number[], ax: number, ay: number, bx: number, by: number) => out.push(ax + (bx - ax) / 3, ay + (by - ay) / 3, ax + ((bx - ax) * 2) / 3, ay + ((by - ay) * 2) / 3, bx, by)
    const out = [x0 + r, top]
    line(out, x0 + r, top, x1 - r, top)
    out.push(x1 - k, top, x1, top + k, x1, top + r)
    line(out, x1, top + r, x1, bottom - r)
    out.push(x1, bottom - k, x1 - k, bottom, x1 - r, bottom)
    line(out, x1 - r, bottom, x0 + r, bottom)
    out.push(x0 + k, bottom, x0, bottom - k, x0, bottom - r)
    line(out, x0, bottom - r, x0, top + r)
    out.push(x0, top + k, x0 + k, top, x0 + r, top)
    return [ring(out, true)]
}

/** Short bars in a row from `x0` to `x1`. The last one ends at `x1`. */
function dashes(x0: number, x1: number, top: number, thick: number, dash: number, gap: number): Path {
    const rings: Ring[] = []
    for (let x = x0; x < x1 - thick; x += dash + gap) rings.push(...bar(x, Math.min(x + dash, x1), top, top + thick, thick / 2))
    return rings
}

/** A wave from `x0` to `x1` as a filled band, so it is a shape and not a line through the tails of letters. */
function wave(x0: number, x1: number, middle: number, height: number, length: number, thick: number): Path {
    const count = Math.max(2, Math.ceil(((x1 - x0) / length) * 8))
    const over: Vec[] = [], under: Vec[] = []
    for (let k = 0; k <= count; k++) {
        const x = x0 + ((x1 - x0) * k) / count, y = middle + height * Math.sin(((x - x0) / length) * Math.PI * 2)
        over.push([x, y - thick / 2])
        under.push([x, y + thick / 2])
    }
    return polyPath([...over, ...under.reverse()], true)
}

/** The part of a shape between two x. */
function between(points: readonly Vec[], left: number, right: number): Vec[] {
    let shape = [...points]
    for (const [limit, side] of [[left, 1], [right, -1]] as const) {
        const next: Vec[] = []
        shape.forEach((point, index) => {
            const before = shape[(index + shape.length - 1) % shape.length]!
            const inside = (point[0] - limit) * side >= 0, was = (before[0] - limit) * side >= 0
            if (inside !== was) next.push([limit, before[1] + ((point[1] - before[1]) * (limit - before[0])) / (point[0] - before[0])])
            if (inside) next.push(point)
        })
        shape = next
    }
    return shape
}

/**
 * Diagonal lines over a box, as filled strips. A line holds the points where x + y is one sum, and the sums
 * are multiples of the step, so the lines of two boxes are parts of one pattern. A strip is a shape and not
 * a line, because it is behind the words.
 */
function hatch(left: number, right: number, top: number, bottom: number, step: number, thick: number): Path {
    const rings: Ring[] = []
    for (let sum = Math.ceil((left + top) / step) * step; sum < right + bottom; sum += step) {
        const strip = between([[sum - top, top], [sum + thick - top, top], [sum + thick - bottom, bottom], [sum - bottom, bottom]], left, right)
        if (strip.length >= 3) rings.push(...polyPath(strip, true))
    }
    return rings
}

/** A line through points with round corners. */
function rounded(points: readonly Vec[], radius: number): Path {
    let d = `M${points[0]![0]} ${points[0]![1]}`
    for (let i = 1; i < points.length - 1; i++) {
        const before = points[i - 1]!, at = points[i]!, next = points[i + 1]!
        const first = Math.hypot(at[0] - before[0], at[1] - before[1]), second = Math.hypot(next[0] - at[0], next[1] - at[1])
        const r = Math.min(radius, first / 2, second / 2)
        if (r < 0.5) {
            d += `L${at[0]} ${at[1]}`
            continue
        }
        d += `L${at[0] - ((at[0] - before[0]) / first) * r} ${at[1] - ((at[1] - before[1]) / first) * r}Q${at[0]} ${at[1]} ${at[0] + ((next[0] - at[0]) / second) * r} ${at[1] + ((next[1] - at[1]) / second) * r}`
    }
    const last = points[points.length - 1]!
    return parseSvgPath(`${d}L${last[0]} ${last[1]}`)
}

/** Change the shape of a node from the one that it has to another. Two shapes with the same points change point by point. */
function slide(node: Node, to: Path, t0: number, t1: number, ease: Ease): void {
    const from = sampleAt(node, 'path', t0)
    if (t1 > t0 && from && from.length === to.length && from.every((own, index) => own.p.length === to[index]!.p.length)) node.track('path').add({ t0, t1, ease, to, at: lerpSame(from, to) })
    else stepAt(node, 'path', to, t0)
}

/** Add a node to a parent at a time of the film, so that it shows from that time on. */
function attach(parent: Node, child: Node, time: number): void {
    const saved = clock.now
    clock.now = time
    parent.add(child)
    clock.now = saved
}

/** The words of a text, each with what is before it. A tab is a space. An empty line starts a paragraph. */
function wordsOf(content: string): { text: string; gap: Gap }[] {
    const out: { text: string; gap: Gap }[] = []
    let next: Gap = 'start'
    for (const row of content.split('\n')) {
        const words = row.split(/[ \t\r]+/).filter((word) => word !== '')
        if (words.length === 0) {
            if (out.length > 0) next = 'para'
            continue
        }
        words.forEach((word, index) => out.push({ text: word, gap: index > 0 ? 'space' : next }))
        next = 'line'
    }
    return out
}

/** A letter or a digit: a character of a word. A part of the text does not start or end between two of them. */
const inWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_]/u.test(char)

/** A word that ends a sentence, with the marks that may follow the period. */
const endsSentence = (word: string) => /[.!?]["')\]”’]*$/.test(word)

const seconds = (time: number) => `${Math.round(time * 100) / 100} s`
const short = (words: string) => JSON.stringify(words.length > 40 ? `${words.slice(0, 37)}...` : words)
const shown = (value: unknown) => (typeof value === 'string' ? JSON.stringify(value) : String(value))

/** A lag or a duration that is not a number would leave the object as it is, with no error. So each verb refuses it. */
function checkTiming(call: string, options: AnimOptions): void {
    if (typeof options !== 'object' || options === null) throw new Error(`passage: the options of ${call} are ${shown(options)}. Give an object, such as { duration: 0.8 }`)
    for (const name of ['lag', 'duration'] as const) {
        const value: unknown = options[name]
        if (value !== undefined && !(typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new Error(`passage: the ${name} of ${call} is ${shown(value)}. It is a number, 0 or more`)
    }
}

/**
 * A passage of real text: a source page, a prompt, one turn of a chat, or the sentences of an answer. The
 * words wrap at `width` and retain their line and paragraph breaks. A film marks parts of the
 * text by their words (`mark`), cuts the text into chunks (`cut`), moves one selection with a count that
 * follows it (`select`, `counter`), lifts a part out as a passage of its own (`slip`, `lift`), ties a part to
 * a node or to a span of another passage (`link`), and changes the text to its next version (`diff`,
 * `accept`). `.at(x, y)` places the top left corner, so passages of different lengths start at one corner.
 */
export class Passage extends Node {
    /** The frame behind the text, or null with `panel: false`. */
    readonly frame: Node | null
    /** The line over the words, or null when the film gives none. */
    readonly title: TextNode | null
    /** The words, as one text. The film check reads it as one text. `words.chars` holds the glyphs that show now. */
    readonly words: TextNode
    private readonly chunkLayer = new Node()
    private readonly markLayer = new Node()
    private readonly pickLayer = new Node()
    private readonly overLayer = new Node()
    /** The glyphs of a slip on their way from the passage that they come from. */
    private readonly flight = new Node()
    private readonly w: number
    private readonly size: number
    private readonly pitch: number
    private readonly padX: number
    private readonly padY: number
    private readonly textTop: number
    private readonly room: number
    private readonly space: number
    /** From the top of a line to its base line. */
    private readonly rise: number
    /** From the base line: the top and the bottom of a band, the top of a line under the words, and the middle of the small letters. */
    private readonly bandTop: number
    private readonly bandBottom: number
    private readonly under: number
    private readonly middle: number
    private readonly style: TextOptions
    private readonly given: PassageOptions
    private readonly kinds: Readonly<Record<string, PassageKind>>
    private readonly least: number | null
    private readonly counted: ((text: string) => number) | null
    private tokens: Token[] = []
    /** All glyphs in the order of the text, with those of words that are struck. */
    private glyphs: Glyph[] = []
    private order = new Map<Glyph, number>()
    /** The glyphs of the text as it is now: without those of words that are struck. */
    private live: Glyph[] = []
    private tops: number[] = [0]
    private marks: Range[] = []
    /** The chunks. The node of a chunk holds its strips, which are drawn: the words of its own, and the words that it shares. */
    private pieces: Range[] = []
    private strips: Range[] = []
    private edits: Range[] = []
    private picked: Range | null = null
    private counters = new Map<PassageUnit, Value>()
    /** The last change that moves words. A second one starts when it is over. */
    private changesOnPaper: { call: string; t0: number; t1: number }[] = []
    private moving: { call: string; t0: number; t1: number } | null = null
    /** For a slip: the passage that it comes from, and the glyphs of that passage that its glyphs stand for. */
    private origin: { from: Passage; glyphs: Glyph[] } | null = null
    private ties: Tie[] = []

    constructor(content: string, options: PassageOptions = {}) {
        super()
        if (typeof content !== 'string' || content.trim() === '') throw new Error('passage: give it the text, such as passage(\'Refunds are accepted within 14 days.\')')
        if (typeof options !== 'object' || options === null) throw new Error(`passage: the options are ${shown(options)}. Give an object, such as { width: 800 }`)
        this.given = options
        const size = this.size = options.size ?? 32
        if (!(Number.isFinite(size) && size > 0)) throw new Error('passage: size is the text size of the words, more than 0')
        const leading = options.leading ?? 1.6
        const style: TextOptions = this.style = { font: options.font, size }
        // The top of the tall letters, the bottom of the tails, and the middle of the small letters, from the
        // base line. They are measured, so the layout holds for any font.
        const all = text('fjy(', style).bounds(), flat = text('H', style).bounds(), small = text('x', style).bounds()
        const base = flat.y + flat.height
        this.bandTop = all.y - base - size * BAND_OVER
        this.bandBottom = all.y + all.height - base + size * BAND_UNDER
        this.under = all.y + all.height - base + size * UNDER
        this.middle = (small.y - base) / 2
        const least = (this.bandBottom - this.bandTop) / size
        if (!(Number.isFinite(leading) && leading >= least)) throw new Error(`passage: leading is the height of a line as a multiple of size. The band of a span is ${least.toFixed(2)} of the size high, so give ${(Math.ceil(least * 20) / 20).toFixed(2)} or more`)
        const pitch = this.pitch = leading * size
        // The band of a line is in the middle of the height of the line, so the room between the bands of two lines is even.
        this.rise = pitch / 2 - (this.bandTop + this.bandBottom) / 2
        this.space = text('n n', { ...style, anchor: 'left' }).layoutBox![2] - 2 * text('n', { ...style, anchor: 'left' }).layoutBox![2]
        const panel = options.panel ?? true
        if (typeof panel !== 'boolean') throw new Error(`passage: panel is true or false, not ${shown(panel)}`)
        const padX = this.padX = size * (panel ? PAD_X : EDGE)
        this.padY = panel ? size * PAD_Y : 0
        this.kinds = this.checkKinds(options.kinds)
        if (options.lines !== undefined && !(Number.isInteger(options.lines) && options.lines >= 1)) throw new Error(`passage: lines is the least number of lines of the frame, a whole number, 1 or more, not ${shown(options.lines)}`)
        this.least = options.lines ?? null
        if (options.tokens !== undefined && typeof options.tokens !== 'function') throw new Error('passage: tokens is a function that counts the tokens of a text, such as (text) => Math.ceil(text.length / 4)')
        this.counted = options.tokens ?? null
        // A readout may first request its counter while rendering an earlier frame.
        for (const unit of ['words', 'characters'] as const) this.counters.set(unit, new Value(0))
        if (this.counted) this.counters.set('tokens', new Value(0))

        this.tokens = this.makeTokens(wordsOf(content))
        if (this.tokens.length === 0) throw new Error(`passage: the text ${short(content)} has no character that a font of the library can draw`)
        let title: TextNode | null = null, titleRoom = 0, titleWidth = 0
        if (options.title !== undefined) {
            if (typeof options.title !== 'string' || options.title.trim() === '' || /[\r\n]/.test(options.title)) throw new Error(`passage: title is one line of text, not ${shown(options.title)}`)
            const titleSize = options.titleSize ?? (size < 26 ? size : Math.max(26, Math.round(size * 0.8)))
            if (!(Number.isFinite(titleSize) && titleSize > 0)) throw new Error('passage: titleSize is the text size of the title, more than 0')
            title = text(options.title.trim(), { font: options.font, size: titleSize, color: options.color ?? 'dim', anchor: 'left' })
            const ink = title.bounds()
            titleWidth = ink.x + ink.width
            titleRoom = titleSize * 1.5
            // The top of the tall letters of the title is at the top of the room of the text.
            const tall = text('fjy(', { font: options.font, size: titleSize, anchor: 'left' }).bounds()
            title.at(padX, this.padY - tall.y)
        }
        this.title = title
        this.textTop = this.padY + titleRoom

        // With no width, the text is on one line for each line that the film wrote, up to 900.
        let width = options.width
        if (width === undefined) {
            let longest = titleWidth, x = 0
            for (const token of this.tokens) {
                const start = token.gap === 'space' ? x + this.space : 0
                // A line has the room of the ink of its last word. The next word starts after the advance.
                longest = Math.max(longest, start + token.ink)
                x = start + token.width
            }
            width = Math.min(900, Math.ceil(longest + padX * 2))
        }
        if (!(Number.isFinite(width) && width > padX * 2)) throw new Error(`passage: width is the width of the object. Give more than ${Math.ceil(padX * 2)}, the room at the two sides of the text at size ${size}`)
        this.w = width
        this.room = width - padX * 2
        const wide = this.tokens.find((token) => token.ink > this.room)
        if (wide) throw new Error(`passage: the word ${JSON.stringify(wide.text)} is ${Math.ceil(wide.ink)} px wide at size ${size}, and a width of ${width} leaves ${Math.floor(this.room)} px for the text. Give a width of ${Math.ceil(wide.ink + padX * 2)} or more, or a smaller size`)
        if (titleWidth > this.room) throw new Error(`passage: the title ${JSON.stringify(options.title)} is ${Math.ceil(titleWidth)} px wide, and a width of ${width} leaves ${Math.floor(this.room)} px for it. Give a shorter title, or a width of ${Math.ceil(titleWidth + padX * 2)} or more`)

        const words = this.words = new TextNode()
        words.font = text('x', style).font
        words.size = size
        // The film check reads the font size and the words of a text here. `text()` records the size in the same way.
        words.data['size'] = size
        this.reindex()
        const flow = this.flow(this.tokens)
        const needed = Math.ceil(flow.height / this.pitch - SOON)
        if (this.least !== null && needed > this.least) throw new Error(`passage: the text needs ${needed} lines. Give lines: ${needed} or more, or a larger width`)
        this.place(flow)
        for (const glyph of this.glyphs) {
            const [x, y] = this.home(glyph)
            words.add(glyph.node.at(x, y))
        }
        const height = this.heightFor(flow.height)
        this.frame = panel ? new Node(bar(0, width, 0, height, size * 0.3)).fill('surface').stroke(options.color ?? 'gridStrong', Math.max(1.5, size * 0.05)) : null
        if (this.frame) this.add(this.frame)
        if (title) this.add(title)
        this.add(this.chunkLayer, this.markLayer, this.pickLayer, words, this.overLayer, this.flight)
        // The layout measures the object as its width and its height, with or without a frame.
        this.layoutBox = [0, 0, width, height]
        // The passage places its words on its bands and its lines. The film check does not judge that room.
        ownLabels(this, { name: 'passage', labels: [words, title] })
    }

    /** Copy the current text and its annotations so that each passage can change independently. */
    protected override [rebindCloneParts](copy: this, nodes: ReadonlyMap<Node, Node>): void | (() => void) {
        const glyphs = new Map<Glyph, Glyph>()
        copy.tokens = this.tokens.map((original) => {
            const token: Token = { ...original, glyphs: [] }
            for (const source of original.glyphs) {
                const glyph = { ...source, token, node: nodes.get(source.node)! }
                token.glyphs.push(glyph)
                glyphs.set(source, glyph)
            }
            return token
        })
        copy.tops = [...this.tops]
        copy.reindex()

        const cloneRange = (range: Range): Range => {
            const node = nodes.get(range.node) as PassageSpan
            const result: Range = {
                ...range, node, over: nodes.get(range.over)!,
                first: glyphs.get(range.first)!, last: glyphs.get(range.last)!,
                look: { ...range.look }, joins: [...range.joins],
                parts: range.parts.map((part) => ({
                    ...part, group: nodes.get(part.group)!, band: nodes.get(part.band)!,
                    sign: part.sign ? nodes.get(part.sign)! : null,
                })),
            }
            SPANS.set(node, { range: result, words: () => copy.wordsIn(result) })
            return result
        }
        copy.marks = this.marks.map(cloneRange)
        copy.pieces = this.pieces.map(cloneRange)
        copy.strips = this.strips.map(cloneRange)
        copy.edits = this.edits.map(cloneRange)
        copy.picked = this.picked ? cloneRange(this.picked) : null
        copy.counters = new Map([...this.counters].map(([unit, value]) => [unit, new Value(value.value)]))
        copy.moving = null
        copy.changesOnPaper = []
        // Each copied link registers its ends after both passages have copied their glyphs.
        copy.ties = []
        const origin = this.origin
        if (!origin) return
        const parent = nodes.get(origin.from) as Passage | undefined
        if (!parent) {
            copy.origin = { from: origin.from, glyphs: [...origin.glyphs] }
            return
        }
        return () => {
            const source = origin.glyphs.map((glyph) => {
                const index = origin.from.order.get(glyph)
                return index === undefined ? undefined : parent.glyphs[index]
            })
            copy.origin = source.every((glyph): glyph is Glyph => glyph !== undefined) ? { from: parent, glyphs: source } : null
        }
    }

    // ── State ─────────────────────────────────────────────────────────────

    /** The text as it is now, after the changes that the film has played so far: without the words that a `diff()` struck. */
    get text(): string {
        return this.join(this.tokens.filter((token) => token.state !== 'struck').map((token) => ({ text: token.text, gap: token.later ?? token.gap })))
    }

    /** How many lines the text has now. */
    get lineCount(): number {
        return this.tops.length
    }

    /** The spans that the film marked, in the order of the text: the words and the kind of each. */
    get spans(): { words: string; kind: string }[] {
        return this.marks.map((range) => ({ words: this.wordsIn(range), kind: range.kind! }))
    }

    /** The words of each chunk of the last `cut()`. Empty for a passage that is not cut. */
    get chunks(): string[] {
        return this.pieces.map((range) => this.wordsIn(range))
    }

    /** The size of the selection, or null with no selection. */
    get selection(): PassageMeasure | null {
        return this.picked ? this.sizeOf(this.wordsIn(this.picked)) : null
    }

    /** How many places of the text show a change that waits for `accept()`: words that are struck, new words, or both. */
    get changes(): number {
        let count = 0, open = false
        for (const token of this.tokens) {
            if (token.state !== 'plain' && !open) count++
            open = token.state !== 'plain'
        }
        return count
    }

    /** The kind of the span at some words, or null when no span is there. */
    kindOf(which: PassageRef): string | null {
        const [first, last] = this.locate('kindOf', which)
        return this.spanAt(first, last)?.kind ?? null
    }

    /** How many spans the passage has, or how many of one kind: `answer.count('supported')`. */
    count(kind?: string): number {
        if (kind === undefined) return this.marks.length
        this.kind(kind)
        return this.marks.filter((range) => range.kind === kind).length
    }

    /**
     * The size of a part of the text, or of the whole text: its words, its characters with the spaces between
     * its words, and its tokens when the passage has a `tokens` function.
     */
    measure(which?: PassageRef): PassageMeasure {
        if (which === undefined) return this.sizeOf(this.text)
        const [first, last] = this.locate('measure', which)
        return this.sizeOf(this.wordsIn({ first, last }))
    }

    /**
     * A number that follows the selection: its words, its characters, or its tokens. It is 0 with no
     * selection, and it runs to the new count while `select()` moves the selection. Read it in a `decimal`:
     * `decimal(() => page.counter('words').value, { digits: 0 })`.
     */
    counter(unit: PassageUnit = 'words'): Value {
        if (unit !== 'words' && unit !== 'characters' && unit !== 'tokens') throw new Error(`passage: a counter counts 'words', 'characters' or 'tokens', not ${shown(unit)}`)
        if (unit === 'tokens' && !this.counted) throw new Error(this.noTokens('counter(\'tokens\')'))
        return this.counters.get(unit)!
    }

    // ── Places ────────────────────────────────────────────────────────────

    /**
     * The glyphs of a part of the text, to color them or to move them. Spaces do not count, and the part may
     * run over the end of a line. Places at the borders of words come first: `find('not')` gives the word "not"
     * at each of its places, and not the letters in "nothing". A part that is not in the text gives an empty list.
     */
    find(part: string): Node[] {
        const { whole, inside } = this.places(part)
        return (whole.length > 0 ? whole : inside).flatMap(([from, to]) => this.live.slice(from, to).map((glyph) => glyph.node))
    }

    /** The node of the span at some words: the bands behind them. The words must be marked. */
    span(which: PassageRef): PassageSpan {
        if (which instanceof PassageSpan) return this.rangeOf('span', which).node
        const [first, last] = this.locate('span', which)
        const range = this.spanAt(first, last)
        if (!range) throw new Error(`passage: span: no span is at ${short(this.wordsIn({ first, last }))}. ${this.marks.length === 0 ? 'The passage has no span' : `The spans are ${this.marks.map((own) => short(this.wordsIn(own))).join(', ')}`}. Mark the words first, with mark()`)
        return range.node
    }

    /** The node of a chunk of the last `cut()`. Chunk 0 is the first. */
    chunk(index: number): PassageSpan {
        return this.piece('chunk', index).node
    }

    /**
     * The box of a part of the text, in stage pixels, for `place` and `beside` of the layout. Without a part it
     * is the room of the text. `{ line: 2 }` is the row of one line. The box is where the object is now, so ask
     * for it after the object has its place.
     */
    region(which?: PassageRef | { line: number }): Box {
        let left = this.padX, right = this.w - this.padX, top = this.textTop, bottom = this.textTop + this.tops[this.tops.length - 1]! + this.pitch
        if (which !== null && typeof which === 'object' && !(which instanceof PassageSpan) && 'line' in which) {
            const line = which.line
            if (!Number.isInteger(line) || line < 0 || line >= this.tops.length) throw new Error(`passage: region: no line ${shown(line)}. The text has ${this.tops.length} lines, and the first is line 0`)
            top = this.textTop + this.tops[line]! + this.rise + this.bandTop
            bottom = this.textTop + this.tops[line]! + this.rise + this.bandBottom
        } else if (which !== undefined) {
            const boxes = this.boxes(this.locate('region', which))
            left = Math.min(...boxes.map((box) => box[0]))
            right = Math.max(...boxes.map((box) => box[2]))
            top = boxes[0]![1]
            bottom = boxes[boxes.length - 1]![3]
        }
        const corners = [this.toWorld(left, top), this.toWorld(right, top), this.toWorld(right, bottom), this.toWorld(left, bottom)]
        const xs = corners.map(([x]) => x), ys = corners.map(([, y]) => y)
        return new Box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
    }

    /**
     * A point on the band of a part of the text, in the coordinates of the object: the middle of the top of
     * its first line, the middle of the bottom of its last line, the left end of its first line, or the right
     * end of its last line. Defaults to the bottom. The point does not follow the object.
     */
    p(which: PassageRef, edge: 'top' | 'bottom' | 'left' | 'right' = 'bottom'): [number, number] {
        const boxes = this.boxes(this.locate('p', which)), first = boxes[0]!, last = boxes[boxes.length - 1]!
        if (edge === 'top') return [(first[0] + first[2]) / 2, first[1]]
        if (edge === 'bottom') return [(last[0] + last[2]) / 2, last[3]]
        if (edge === 'left') return [first[0], (first[1] + first[3]) / 2]
        if (edge === 'right') return [last[2], (last[1] + last[3]) / 2]
        throw new Error(`passage: the edge of p() is 'top', 'bottom', 'left' or 'right', not ${shown(edge)}`)
    }

    /**
     * The way of a line from a part of the text out of the passage, in the coordinates of the object: where it
     * starts under the last word of the part (or under the first one, at the left), where it reaches the room
     * between two lines of text, and where it passes the side of the object. A line on these points crosses no
     * word. `link()` draws it. The points are for the text as it is after the changes that the film has played
     * so far. They do not follow a later `diff()`: a link does.
     */
    leader(which: PassageRef, side: 'left' | 'right' = 'right'): [start: Vec, turn: Vec, edge: Vec] {
        if (side !== 'left' && side !== 'right') throw new Error(`passage: the side of leader() is 'left' or 'right', not ${shown(side)}`)
        const [first, last] = this.locate('leader', which)
        return this.way(this.anchors({ first, last }), side)
    }

    // ── Verbs ─────────────────────────────────────────────────────────────

    /** The frame and the title arrive, and then the words in the order of the text. */
    enter(options: AnimOptions = {}): Anim {
        checkTiming('enter()', options)
        return {
            label: 'passage.enter', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx, span = t1 - t0
                for (const part of [this.frame, this.title]) {
                    if (!part) continue
                    stepAt(part, 'opacity', 0, t0)
                    part.tween('opacity', 1, t0, t0 + span * 0.35, ease)
                }
                // What a film marked before the entrance comes with the last words.
                for (const layer of [this.chunkLayer, this.markLayer, this.pickLayer, this.overLayer]) {
                    stepAt(layer, 'opacity', 0, t0)
                    layer.tween('opacity', 1, t0 + span * 0.6, t1, ease)
                }
                const windows = staggered(this.tokens.length, options.lag ?? 0.5, t0 + span * 0.15, t1)
                this.tokens.forEach((token, index) => {
                    const [start, end] = windows[index]!
                    for (const glyph of token.glyphs) {
                        stepAt(glyph.node, 'opacity', 0, t0)
                        glyph.node.tween('opacity', 1, start, end, ease)
                    }
                })
            },
        }
    }

    /**
     * Give a part of the text a kind: `page.mark('within 14 days', 'supported')`. The band of the kind grows
     * under the words in the order of the text, with its sign. A part that has a span already takes the new
     * kind: the color changes, and the old sign gives way to the new one. `null` takes the span away. Without
     * a kind, the part takes the first kind of the passage. A word is in one span: words that share a word
     * with another span are an error.
     */
    mark(which: PassageRef, kind?: string | null, options: AnimOptions = {}): Anim {
        checkTiming('mark()', options)
        const name = kind === null ? null : this.kind(kind ?? Object.keys(this.kinds)[0]!)
        return {
            label: 'passage.mark', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const record = this.free('mark()', ctx)
                const { t0, t1, ease } = ctx
                const [first, last] = this.locate('mark', which)
                const found = this.spanAt(first, last)
                if (name === null) {
                    if (!found) throw new Error(`passage: mark: no span is at ${short(this.wordsIn({ first, last }))}, so there is none to take away`)
                    this.dismiss(found, t0, t1, ease)
                    this.marks = this.marks.filter((range) => range !== found)
                } else if (found) {
                    // A film may play one mark twice. The span has this kind already, so nothing changes.
                    if (found.kind === name) return
                    this.restyle(found, this.look(name), t0, t1, ease)
                    found.kind = name
                } else {
                    const from = this.order.get(first)!, to = this.order.get(last)!
                    const other = this.marks.find((range) => this.order.get(range.first)! <= to && this.order.get(range.last)! >= from)
                    if (other) throw new Error(`passage: mark: the words ${short(this.wordsIn({ first, last }))} share words with the span ${short(this.wordsIn(other))}. A word is in one span. Mark words that the other span does not hold, or take it away first with mark(${short(this.wordsIn(other))}, null)`)
                    const range = this.range(this.markLayer, first, last, this.look(name), name)
                    this.marks.push(range)
                    this.marks.sort((a, b) => this.order.get(a.first)! - this.order.get(b.first)!)
                    this.settle(range, t0, t1, ease, true)
                }
                this.tint(t0, t1, ease)
                record()
            },
        }
    }

    /**
     * Cut the text into chunks: `page.cut({ size: 12, overlap: 3 })` makes windows of 12 words that share 3,
     * `page.cut({ by: 'sentence' })` makes one chunk for each sentence, and a list gives the words of each
     * chunk. The chunks arrive one after another, as bands of two colors in turn with a gap between two of
     * them. Over the words that two chunks share, the first chunk has the upper half of the line and the next
     * one has the lower half, so the overlap shows both. A new cut takes the place of the old one, and `null`
     * takes the chunks away. A word is in two chunks at the most.
     */
    cut(how: PassageCut | null, options: AnimOptions & { colors?: readonly [ColorInput, ColorInput] } = {}): Anim {
        checkTiming('cut()', options)
        const colors = options.colors ?? ['purple', 'orange']
        if (!Array.isArray(colors) || colors.length !== 2) throw new Error('passage: the colors of cut() are two colors, for the chunks in turn, such as [\'purple\', \'orange\']')
        return {
            label: 'passage.cut', duration: options.duration ?? (how === null ? 0.5 : 1.4), ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const record = this.free('cut()', ctx)
                const { t0, t1, ease } = ctx, span = t1 - t0
                const next = how === null ? [] : this.plan(how)
                // The old chunks leave before the new ones arrive.
                const start = this.strips.length > 0 && next.length > 0 ? t0 + span * 0.25 : t0
                for (const range of this.strips) this.dismiss(range, t0, next.length > 0 ? start : t1, ease)
                const windows = staggered(next.length, options.lag ?? 0.7, start, t1)
                const at = (glyph: Glyph) => this.order.get(glyph)!
                this.strips = []
                this.pieces = next.map(([first, last], index) => {
                    const look = (shape: Look['shape']): Look => ({ color: colors[index % 2]!, sign: 'band', fill: CHUNK_FILL, shape, dim: false })
                    const whole = this.range(this.chunkLayer, first, last, look('line'), null)
                    const before = next[index - 1], after = next[index + 1]
                    // The last word that the chunk shares with the chunk before it, and the first one that it shares with the next.
                    const low = before && at(before[1]) >= at(first) ? at(before[1]) : at(first) - 1
                    const high = after && at(after[0]) <= at(last) ? at(after[0]) : at(last) + 1
                    // Over the words that two chunks share, each has one half of the line: both are seen.
                    for (const [from, to, shape] of [[at(first), low, 'lower'], [low + 1, high - 1, 'line'], [high, at(last), 'upper']] as const) {
                        if (to < from) continue
                        const strip = this.range(whole.node, this.glyphs[from]!, this.glyphs[to]!, look(shape), null)
                        // The strips of one chunk are one band: no gap where one ends and the next starts.
                        strip.joins = [from > at(first), to < at(last)]
                        this.settle(strip, windows[index]![0], windows[index]![1], ease, true)
                        this.strips.push(strip)
                    }
                    return whole
                })
                record()
            },
        }
    }

    /**
     * Move the selection to a part of the text: `page.select('within 14 days')`, or `page.select({ chunk: 1 })`.
     * The passage has one selection, a frame around the words. It grows and shrinks line by line, as a
     * selection in an editor does, and each `counter()` runs to the new count. `null` takes it away.
     */
    select(which: PassageRef | null, options: AnimOptions = {}): Anim {
        checkTiming('select()', options)
        return {
            label: 'passage.select', duration: options.duration ?? 0.7, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const record = this.free('select()', ctx)
                const { t0, t1, ease } = ctx
                if (which === null) {
                    if (this.picked) this.dismiss(this.picked, t0, t1, ease)
                    this.picked = null
                } else {
                    const [first, last] = this.locate('select', which)
                    if (this.picked) {
                        this.picked.first = first
                        this.picked.last = last
                        this.settle(this.picked, t0, t1, ease, false)
                    } else {
                        this.picked = this.range(this.pickLayer, first, last, { color: 'yellow', sign: 'box', fill: PICK_FILL, shape: 'band', dim: false }, null)
                        this.settle(this.picked, t0, t1, ease, true)
                    }
                }
                this.recount(t0, t1, ease)
                record()
            },
        }
    }

    /**
     * A part of the text as a passage of its own, with the same size and font: a span, a chunk, or any words.
     * It is not on the stage yet. Give it its place, and then play `page.lift(part)`: its words leave this
     * passage and land in it. The options are those of `passage()`, such as a `title` and a `width`. Without a
     * width, the slip is as wide as its words need, and as wide as this passage at the most.
     */
    slip(which: PassageRef, options: PassageOptions = {}): Passage {
        if (typeof options !== 'object' || options === null) throw new Error(`passage: the options of slip() are ${shown(options)}. Give an object, such as { title: 'chunk 2' }`)
        const [first, last] = this.locate('slip', which)
        const glyphs = this.glyphs.slice(this.order.get(first)!, this.order.get(last)! + 1).filter((glyph) => glyph.token.state !== 'struck')
        const content = this.wordsIn({ first, last })
        const own = { size: this.size, leading: this.pitch / this.size, font: this.given.font, kinds: this.given.kinds, tokens: this.given.tokens, ...options }
        let made = new Passage(content, own)
        if (options.width === undefined && made.w > this.w) made = new Passage(content, { ...own, width: this.w })
        made.origin = { from: this, glyphs }
        return made
    }

    /**
     * The words of a slip leave this passage and land in the slip, which arrives at the place that the film
     * gave it. The words stay in this passage too: the slip is a copy that has their place of origin.
     */
    lift(slip: Passage, options: AnimOptions = {}): Anim {
        checkTiming('lift()', options)
        if (!(slip instanceof Passage) || slip.origin?.from !== this) throw new Error('passage: lift takes a slip of this passage. Make one with slip(), such as `const part = page.slip(\'the words\')`, give it its place, and then play page.lift(part)')
        return {
            label: 'passage.lift', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const record = this.free('lift()', ctx)
                const from = slip.origin!.glyphs
                if (from.some((glyph) => !this.order.has(glyph))) throw new Error(`passage: lift: the words ${short(slip.text)} of the slip are no longer in the passage, after a diff() and an accept(). Make the slip again from the text of now`)
                if (from.length !== slip.glyphs.length || from.some((glyph, i) => glyph.char !== slip.glyphs[i]!.char)) throw new Error('passage: the slip text changed before lift(). Lift the original slip or make a new slip from the passage')
                reveal(slip, ctx.t0, ctx.stage)
                const { t0, t1, ease } = ctx, span = t1 - t0, land = t0 + span * 0.8
                for (const part of [slip.frame, slip.title]) {
                    if (!part) continue
                    stepAt(part, 'opacity', 0, t0)
                    part.tween('opacity', 1, t0 + span * 0.3, t1, ease)
                }
                const saved = clock.now
                clock.now = t0
                const target = invert(slip.flight.worldMatrix())
                slip.glyphs.forEach((glyph, index) => {
                    const start = from[index]!
                    // Interpolate the outlines in flight coordinates. A parent can rotate or stretch either page.
                    const outline = (node: Node) => transformPath(node.get('path')!, mul(target, node.worldMatrix()))
                    const startPath = outline(start.node), endPath = outline(glyph.node)
                    const ghost = new Node(startPath).fill(start.node.get('fill'))
                    slip.flight.add(ghost)
                    const sameShape = startPath.length === endPath.length && startPath.every((ring, i) => ring.p.length === endPath[i]!.p.length)
                    ghost.track('path').add({ t0, t1: land, ease, to: endPath, at: sameShape ? lerpSame(startPath, endPath) : pathMixer(startPath, endPath) })
                    ghost.track('visible').step(land, false)
                    stepAt(glyph.node, 'opacity', 0, t0)
                    stepAt(glyph.node, 'opacity', 1, land)
                })
                clock.now = saved
                record()
            },
        }
    }

    /**
     * A line from a part of this passage to a node, such as from a claim of an answer to the span of a source
     * that supports it: `answer.link('opens on Sunday', source.span('Closed on Sunday'))`. The target is the
     * span of another passage, a slip, or any node. The line leaves under the last word of the part, runs in
     * the room between two lines of text to the side of the passage, and reaches the target the same way, so
     * it crosses no word. It is drawn on each frame, so it follows the two when they move. Add it to the stage
     * with `link.enter()`.
     */
    link(which: PassageRef, to: Node, options: PassageLinkOptions = {}): PassageLink {
        if (!(to instanceof Node)) throw new Error(`passage: link: the target is ${shown(to)}. Give a node: the span of another passage (source.span('the words')), a slip, or any node of the film`)
        const [first, last] = this.locate('link', which)
        // A link from a span follows the span, also when a diff() gives it new words.
        const range = this.spanAt(first, last) ?? (which instanceof PassageSpan ? this.rangeOf('link', which) : { first, last })
        // The other end is a span of a passage: that passage gives the way in, and keeps it when its words move.
        const back = to instanceof PassageSpan ? to.passage.tie(to.passage.rangeOf('link', to)) : null
        return new PassageLink(this, this.tie(range), to, back, { size: this.size, ...options })
    }

    /**
     * Change the text to its next version: `page.diff(next)`. The passage finds the words that differ. The
     * words that go get a line through them, the rest of the text moves, and the words that come arrive beside
     * the words that they replace, with two lines under them. Both versions are then on the screen, and
     * `page.text` is the next version. `accept()` takes the old words away. A span keeps its words: new words
     * that replace the last word of a span are a part of the span.
     */
    diff(next: string, options: AnimOptions = {}): Anim {
        checkTiming('diff()', options)
        if (typeof next !== 'string' || next.trim() === '') throw new Error('passage: diff takes the text of the next version')
        // Make the words of the next version now, so a word that is too wide stops the film at the line that names it.
        const nextWords = wordsOf(next)
        let prepared: Token[] | null = this.makeTokens(nextWords)
        if (prepared.length === 0) throw new Error(`passage: diff: the next version ${short(next)} has no character that a font of the library can draw`)
        const wide = prepared.find((token) => token.ink > this.room)
        if (wide) throw new Error(`passage: diff: the word ${JSON.stringify(wide.text)} of the next version is ${Math.ceil(wide.ink)} px wide at size ${this.size}, and a width of ${this.w} leaves ${Math.floor(this.room)} px for the text. Give the passage a width of ${Math.ceil(wide.ink + this.padX * 2)} or more, or a smaller size`)
        const wanted = prepared.map((token) => ({ text: token.text, gap: token.gap }))
        return {
            label: 'passage.diff', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                this.steady('diff')
                const { t0, t1, ease } = ctx, span = t1 - t0
                // Replaying an animation needs fresh glyphs with no visibility keys from its first play.
                const made = prepared ?? this.makeTokens(nextWords)
                prepared = null
                const old = this.tokens
                const pairs = matchSequence(old.map((token) => token.text), wanted.map((word) => word.text))
                const same = pairs.length === old.length && pairs.length === wanted.length
                if (same && old.every((token, index) => token.gap === wanted[index]!.gap)) return
                const gaps = new Map<Token, Gap>(), later = new Map<Token, Gap>()
                const replacements: [Token[], Glyph][] = []
                const merged: Token[] = [], struck: Token[][] = [], added: Token[][] = []
                let i = 0, j = 0
                for (const [pi, pj] of [...pairs, [old.length, wanted.length] as const]) {
                    const gone = old.slice(i, pi), come = made.slice(j, pj)
                    const kept = pi < old.length ? old[pi]! : null
                    if (kept) gaps.set(kept, wanted[pj]!.gap)
                    // The new words stand beside the old ones. So the first word after words that are struck does
                    // not start a line where they started one: it takes its own gap when they leave.
                    const follower = come[0] ?? kept
                    if (gone.length > 0 && follower) {
                        const own = gaps.get(follower) ?? follower.gap, before = gone[0]!.gap
                        if (own === 'start' || (own !== 'space' && before !== 'space')) {
                            gaps.set(follower, 'space')
                            later.set(follower, own)
                        }
                    }
                    if (gone.length > 0) struck.push(gone)
                    if (come.length > 0) added.push(come)
                    // New words that take the place of the last word of a span are a part of the span.
                    const end = come[come.length - 1]?.glyphs.at(-1)
                    if (end && gone.length > 0) replacements.push([gone, end])
                    merged.push(...gone, ...come)
                    if (kept) merged.push(kept)
                    i = pi + 1
                    j = pj + 1
                }
                const flow = this.flow(merged, gaps)
                const needed = Math.ceil(flow.height / this.pitch - SOON)
                if (this.least !== null && needed > this.least) throw new Error(`passage: diff: the two versions take ${needed} lines side by side, and the passage has lines: ${this.least}. Give lines: ${needed} or more, or a larger width`)
                this.claim('diff()', ctx)
                for (const [token, gap] of gaps) token.gap = gap
                for (const [token, gap] of later) token.later = gap
                for (const run of struck) for (const token of run) token.state = 'struck'
                for (const run of added) for (const token of run) token.state = 'added'
                const ranges = new Set([...this.marks, ...(this.picked ? [this.picked] : []), ...this.ties.map((tie) => tie.range)])
                for (const [gone, end] of replacements) {
                    // A replacement that crosses two annotations belongs to neither one.
                    const start = this.order.get(gone[0]!.glyphs[0]!)!
                    for (const range of ranges) {
                        if (gone.at(-1) === range.last.token && this.order.get(range.first)! <= start) range.last = end
                    }
                }
                // The line through the old words comes first, where the words are. Then the text moves, and the new words arrive.
                const strike = t0 + span * 0.3, move = [t0 + span * 0.2, t0 + span * 0.7] as const, arrive = t0 + span * 0.6
                const removed = struck.map((run) => this.range(this.markLayer, run[0]!.glyphs[0]!, run[run.length - 1]!.glyphs.at(-1)!, { ...this.look('removed'), fill: EDIT_FILL }, null))
                for (const range of removed) this.settle(range, t0, strike, ease, true)
                this.edits.push(...removed)
                this.tokens = merged
                this.reindex()
                const fresh = new Set(added.flat().flatMap((token) => token.glyphs))
                for (const glyph of fresh) {
                    attach(this.words, glyph.node, t0)
                    stepAt(glyph.node, 'opacity', 0, t0)
                    glyph.node.tween('opacity', 1, arrive, t1, ease)
                }
                this.reflow(flow, move[0], move[1], ease, fresh)
                const arrived = added.map((run) => this.range(this.markLayer, run[0]!.glyphs[0]!, run[run.length - 1]!.glyphs.at(-1)!, { ...this.look('added'), fill: EDIT_FILL }, null))
                for (const range of arrived) this.settle(range, arrive, t1, ease, true)
                this.edits.push(...arrived)
                this.tint(t0, strike, ease)
                this.recount(move[0], move[1], ease)
                this.retie(move[0], move[1], ease)
            },
        }
    }

    /**
     * The words that a `diff()` struck leave, the new words become plain text, and the text closes up: the
     * passage then shows its next version only. A span that has no word left goes with its words.
     */
    accept(options: AnimOptions = {}): Anim {
        checkTiming('accept()', options)
        return {
            label: 'passage.accept', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                // A film may play accept() with no change to take. Nothing moves.
                if (this.edits.length === 0) return
                this.claim('accept()', ctx)
                const { t0, t1, ease } = ctx, span = t1 - t0, gone = t0 + span * 0.35
                for (const range of this.edits) this.dismiss(range, t0, gone, ease)
                this.edits = []
                for (const token of this.tokens) {
                    if (token.state !== 'struck') continue
                    for (const glyph of token.glyphs) {
                        glyph.node.tween('opacity', 0, t0, gone, ease)
                        glyph.node.track('visible').step(gone, false)
                    }
                }
                // A range keeps the words that stay. One with no word left goes.
                const shrinks = (range: { first: Glyph; last: Glyph }): boolean => {
                    const from = this.order.get(range.first), to = this.order.get(range.last)
                    const left = from === undefined || to === undefined ? [] : this.glyphs.slice(from, to + 1).filter((glyph) => glyph.token.state !== 'struck')
                    if (left.length === 0) return false
                    range.first = left[0]!
                    range.last = left[left.length - 1]!
                    return true
                }
                const keeps = (range: Range): boolean => {
                    if (shrinks(range)) return true
                    this.dismiss(range, t0, gone, ease)
                    return false
                }
                this.marks = this.marks.filter(keeps)
                if (this.picked && !keeps(this.picked)) this.picked = null
                // The end of a link that is at words with no span keeps the words that stay too.
                for (const tie of this.ties) shrinks(tie.range)
                this.tokens = this.tokens.filter((token) => token.state !== 'struck')
                for (const token of this.tokens) {
                    token.state = 'plain'
                    if (token.later) token.gap = token.later
                    token.later = null
                }
                // The first word of the text has nothing before it.
                if (this.tokens[0]) this.tokens[0].gap = 'start'
                this.reindex()
                this.reflow(this.flow(this.tokens), t0 + span * 0.25, t1, ease)
                this.tint(t0, gone, ease)
                this.recount(t0, t1, ease)
                this.retie(t0 + span * 0.25, t1, ease)
            },
        }
    }

    // ── The text ──────────────────────────────────────────────────────────

    /** The words of a text as the passage keeps them. A word with no glyph, such as a lone no-break space, is left out. */
    private makeTokens(words: readonly { text: string; gap: Gap }[]): Token[] {
        const out: Token[] = []
        // The word after one that is left out keeps the break that was before it.
        let waits: Gap | null = null
        for (const word of words) {
            const token = this.makeToken(word.text, waits !== null && word.gap === 'space' ? waits : word.gap)
            if (token.glyphs.length === 0) {
                waits = token.gap
                continue
            }
            waits = null
            out.push(token)
        }
        return out
    }

    private makeToken(word: string, gap: Gap): Token {
        const made = text(word, { ...this.style, color: 'ink', anchor: 'left' })
        const token: Token = { text: word, glyphs: [], width: made.layoutBox![2], ink: 0, gap, later: null, state: 'plain', x: 0, line: 0 }
        for (const node of made.chars) {
            const ox = node.get('x'), half = (pathBounds(node.get('path') ?? [])?.width ?? 0) / 2
            token.glyphs.push({ node, char: node.data['key'] as string, token, ox, oy: node.get('y'), half, dim: false })
            // The glyph leaves the text that made it. It is a part of the words of the passage when it shows.
            made.drop(node)
        }
        token.ink = Math.max(token.width, ...token.glyphs.map((glyph) => glyph.ox + glyph.half))
        return token
    }

    /** The lists of glyphs follow the list of words. The film check reads the words of now. */
    private reindex(): void {
        this.glyphs = this.tokens.flatMap((token) => token.glyphs)
        this.order = new Map(this.glyphs.map((glyph, index) => [glyph, index]))
        this.live = this.glyphs.filter((glyph) => glyph.token.state !== 'struck')
        this.words.chars.length = 0
        this.words.chars.push(...this.glyphs.map((glyph) => glyph.node))
        this.words.source = this.text
    }

    /** Words with what is before each, as one text. */
    private join(words: readonly { text: string; gap: Gap }[]): string {
        return words.map((word, index) => `${index === 0 ? '' : word.gap === 'para' ? '\n\n' : word.gap === 'line' ? '\n' : ' '}${word.text}`).join('')
    }

    /** The place of each word in the width of the text. A line breaks at a space, where the film wrote a break, and at no other place. */
    private flow(tokens: readonly Token[], gaps?: ReadonlyMap<Token, Gap>): Flow {
        const at = new Map<Token, readonly [number, number]>(), tops = [0]
        let x = 0
        tokens.forEach((token, index) => {
            const gap = gaps?.get(token) ?? token.gap
            const breaks = index > 0 && (gap === 'line' || gap === 'para')
            // A line has the room of the ink of its last word, so no letter passes the width.
            if (breaks || (x > 0 && x + this.space + token.ink > this.room + SOON)) {
                tops.push(tops[tops.length - 1]! + this.pitch * (breaks && gap === 'para' ? 1 + PARA : 1))
                x = 0
            }
            const start = x > 0 ? x + this.space : 0
            at.set(token, [start, tops.length - 1])
            x = start + token.width
        })
        return { at, tops, height: tops[tops.length - 1]! + this.pitch }
    }

    private place(flow: Flow): void {
        for (const [token, [x, line]] of flow.at) {
            token.x = x
            token.line = line
        }
        this.tops = flow.tops
    }

    /** The height of the object for a height of its text. With `lines`, the frame holds that many lines at the least. */
    private heightFor(textHeight: number): number {
        return this.textTop + Math.max(textHeight, (this.least ?? 0) * this.pitch) + this.padY
    }

    /** The place of a glyph in the layout of now, in the coordinates of the object. */
    private home(glyph: Glyph): [number, number] {
        return [this.padX + glyph.token.x + glyph.ox, this.textTop + this.tops[glyph.token.line]! + this.rise + glyph.oy]
    }

    /**
     * The words take a new layout: the frame takes its height, and each range follows its words. A glyph that
     * stays on its line slides to its place. A glyph that goes to another line fades out where it is and comes
     * back at its place, so that no word flies across the lines between the two. `fresh` holds the glyphs of
     * new words, which have no place yet: they start at their place.
     */
    private reflow(flow: Flow, t0: number, t1: number, ease: Ease, fresh?: ReadonlySet<Glyph>): void {
        this.place(flow)
        this.layoutBox = [0, 0, this.w, this.heightFor(flow.height)]
        const span = t1 - t0, turn = (t0 + t1) / 2
        for (const glyph of this.glyphs) {
            const [x, y] = this.home(glyph), node = glyph.node
            if (fresh?.has(glyph)) {
                stepAt(node, 'x', x, t0)
                stepAt(node, 'y', y, t0)
            } else if (sampleAt(node, 'y', t1) !== y) {
                node.tween('opacity', 0, t0, t0 + span * 0.4, ease)
                stepAt(node, 'x', x, turn)
                stepAt(node, 'y', y, turn)
                node.tween('opacity', 1, t0 + span * 0.6, t1, ease)
            } else if (sampleAt(node, 'x', t1) !== x) {
                node.tween('x', x, t0, t1, ease)
            }
        }
        if (this.frame) slide(this.frame, bar(0, this.w, 0, this.heightFor(flow.height), this.size * 0.3), t0, t1, ease)
        for (const range of [...this.marks, ...this.edits, ...(this.picked ? [this.picked] : [])]) this.settle(range, t0, t1, ease, false)
    }

    /** A glyph is dim while a range that holds it has a dim look: words that are struck. */
    private tint(t0: number, t1: number, ease: Ease): void {
        const dim = new Set<Glyph>()
        for (const range of [...this.marks, ...this.edits]) {
            if (!range.look.dim) continue
            for (let index = this.order.get(range.first)!; index <= this.order.get(range.last)!; index++) dim.add(this.glyphs[index]!)
        }
        for (const glyph of this.glyphs) {
            if (glyph.dim === dim.has(glyph)) continue
            glyph.dim = !glyph.dim
            glyph.node.tween('fill', toPaint(glyph.dim ? 'dim' : 'ink'), t0, t1, ease)
        }
    }

    /** Each counter runs to the size of the selection of now. */
    private recount(t0: number, t1: number, ease: Ease): void {
        const size = this.selection
        for (const [unit, value] of this.counters) tweenValue(value, size?.[unit] ?? 0, t0, t1, ease)
    }

    // ── Parts of the text ─────────────────────────────────────────────────

    /**
     * Where a part is in the text of now, as ranges of its glyphs: the places at the borders of words, and the
     * places that start or end inside a word. In each list, a place starts after the one before it ends.
     */
    private places(part: string): { whole: [number, number][]; inside: [number, number][] } {
        const needle = [...String(part)].filter((char) => !/\s/.test(char))
        const whole: [number, number][] = [], inside: [number, number][] = []
        if (needle.length === 0) return { whole, inside }
        const glyphs = this.live, count = glyphs.length
        // The place between two glyphs is a border when a space is there, or when the two are not both characters of a word.
        const border = (at: number) => at === 0 || at === count || glyphs[at]!.token !== glyphs[at - 1]!.token || !(inWord(glyphs[at - 1]!.char) && inWord(glyphs[at]!.char))
        for (let at = 0; at + needle.length <= count; at++) {
            if (!needle.every((char, offset) => glyphs[at + offset]!.char === char)) continue
            const list = border(at) && border(at + needle.length) ? whole : inside
            const last = list[list.length - 1]
            if (!last || last[1] <= at) list.push([at, at + needle.length])
        }
        return { whole, inside }
    }

    /** The first and the last glyph of a part that a film names. */
    private locate(call: string, which: PassageRef): [Glyph, Glyph] {
        if (which instanceof PassageSpan) {
            const range = this.rangeOf(call, which)
            return [range.first, range.last]
        }
        if (typeof which === 'object' && which !== null && 'chunk' in which) {
            const range = this.piece(call, which.chunk)
            return [range.first, range.last]
        }
        const words = typeof which === 'string' ? which : typeof which === 'object' && which !== null ? which.words : undefined
        const occurrence = typeof which === 'object' && which !== null ? (which as { occurrence?: number }).occurrence : undefined
        if (typeof words !== 'string' || words.trim() === '') throw new Error(`passage: ${call}: a part of the text is its words, { words, occurrence }, { chunk: 0 }, or the node of a span, not ${shown(which)}`)
        const { whole, inside } = this.places(words)
        if (whole.length === 0) {
            if (inside.length > 0) throw new Error(`passage: ${call}: ${short(words)} is in the text only as a part of ${JSON.stringify(this.around(inside[0]!))}. A part starts and ends at the borders of words`)
            throw new Error(`passage: ${call}: the words ${short(words)} are not in the text. A part is words of the text, letter for letter. The text starts with ${short(this.text)}`)
        }
        if (occurrence !== undefined && !(Number.isInteger(occurrence) && occurrence >= 0 && occurrence < whole.length)) throw new Error(`passage: ${call}: the words ${short(words)} are at ${whole.length} ${whole.length === 1 ? 'place' : 'places'} of the text, and the first is occurrence 0. There is no occurrence ${shown(occurrence)}`)
        if (occurrence === undefined && whole.length > 1) throw new Error(`passage: ${call}: the words ${short(words)} are at ${whole.length} places of the text. Give more of the words around the place, or { words: ${short(words)}, occurrence: 0 } for the first place`)
        const [from, to] = whole[occurrence ?? 0]!
        return [this.live[from]!, this.live[to - 1]!]
    }

    /** The words around a place, from the border of a word to the border of a word, for an error that shows where a part is. */
    private around([from, to]: [number, number]): string {
        const glyphs = this.live
        let start = from, end = to
        while (start > 0 && glyphs[start]!.token === glyphs[start - 1]!.token && inWord(glyphs[start - 1]!.char)) start--
        while (end < glyphs.length && glyphs[end]!.token === glyphs[end - 1]!.token && inWord(glyphs[end]!.char)) end++
        return this.wordsIn({ first: glyphs[start]!, last: glyphs[end - 1]! })
    }

    /** The words between two glyphs, as the text has them now: without words that are struck, and with one space between two words. */
    private wordsIn(range: { first: Glyph; last: Glyph }): string {
        const from = this.order.get(range.first), to = this.order.get(range.last)
        if (from === undefined || to === undefined) return ''
        const words: { text: string; gap: Gap; token: Token; glyphs: number }[] = []
        for (let index = from; index <= to; index++) {
            const glyph = this.glyphs[index]!, token = glyph.token
            if (token.state === 'struck') continue
            if (words[words.length - 1]?.token !== token) {
                const gap = token.later ?? token.gap
                words.push({ text: '', gap: gap === 'start' ? 'space' : gap, token, glyphs: 0 })
            }
            const last = words[words.length - 1]!
            last.text += glyph.char
            last.glyphs++
        }
        // A word that is whole in the range has its own text, which can hold a no-break space: that has no glyph.
        for (const word of words) if (word.glyphs === word.token.glyphs.length) word.text = word.token.text
        return this.join(words)
    }

    private sizeOf(words: string): PassageMeasure {
        const size: PassageMeasure = { words: words.split(/\s+/).filter(Boolean).length, characters: words.length }
        if (this.counted) {
            const tokens = this.counted(words)
            if (!(typeof tokens === 'number' && Number.isFinite(tokens) && tokens >= 0)) throw new Error(`passage: the tokens function returned ${shown(tokens)} for ${short(words)}. It returns the number of tokens, 0 or more`)
            size.tokens = tokens
        }
        return size
    }

    private noTokens(call: string): string {
        return `passage: ${call} needs the tokens function of the passage. Give passage(text, { tokens }) the tokenizer of the film, or an estimate such as (text) => Math.ceil(text.length / 4), and say on the screen that it is an estimate`
    }

    // ── Kinds ─────────────────────────────────────────────────────────────

    private checkKinds(kinds: unknown): Readonly<Record<string, PassageKind>> {
        if (kinds === undefined) return PASSAGE_KINDS
        if (typeof kinds !== 'object' || kinds === null || Object.keys(kinds).length === 0) throw new Error('passage: kinds is a record of the kinds of a span, such as { rule: { color: \'teal\', sign: \'underline\' } }')
        const signs = new Map<PassageSign, string>()
        for (const [name, kind] of Object.entries(kinds as Record<string, PassageKind>)) {
            if (typeof kind !== 'object' || kind === null || kind.color === undefined) throw new Error(`passage: the kind ${JSON.stringify(name)} needs a color, such as { color: 'teal', sign: 'underline' }`)
            const sign = kind.sign ?? 'band'
            if (!SIGNS.includes(sign)) throw new Error(`passage: the sign of the kind ${JSON.stringify(name)} is ${shown(sign)}. A sign is ${SIGNS.map((own) => `'${own}'`).join(', ')}`)
            // Two kinds with one sign would differ by their color only, which some viewers cannot see.
            const other = signs.get(sign)
            if (other !== undefined) throw new Error(`passage: the kinds ${JSON.stringify(other)} and ${JSON.stringify(name)} have the sign '${sign}' both, so only their color tells them apart. Give each kind its own sign. The signs that are free: ${SIGNS.filter((own) => !signs.has(own)).map((own) => `'${own}'`).join(', ')}`)
            signs.set(sign, name)
        }
        return kinds as Record<string, PassageKind>
    }

    private kind(name: string): string {
        if (typeof name !== 'string' || !Object.hasOwn(this.kinds, name)) throw new Error(`passage: no kind ${shown(name)}. The kinds are ${Object.keys(this.kinds).join(', ')}`)
        return name
    }

    /** The look of a kind. A passage with kinds of its own has the two kinds of `diff()` from `PASSAGE_KINDS`, unless it names them. */
    private look(name: string): Look {
        const kind: PassageKind = this.kinds[name] ?? (PASSAGE_KINDS as Record<string, PassageKind>)[name]!
        return { color: kind.color, sign: kind.sign ?? 'band', fill: MARK_FILL, shape: 'band', dim: kind.dim ?? false }
    }

    // ── Ranges ────────────────────────────────────────────────────────────

    private range(layer: Node, first: Glyph, last: Glyph, look: Look, kind: string | null): Range {
        const node = new PassageSpan(this), over = new Node()
        const range: Range = { node, over, first, last, look, kind, parts: [], joins: [false, false] }
        SPANS.set(node, { range, words: () => this.wordsIn(range) })
        layer.add(node)
        this.overLayer.add(over)
        return range
    }

    private rangeOf(call: string, node: PassageSpan): Range {
        const range = SPANS.get(node)?.range
        if (!range || node.passage !== this) throw new Error(`passage: ${call}: the span is of another passage. Give a span or a chunk of this one, or its words`)
        if (!this.order.has(range.first) || !this.order.has(range.last) || ![...this.marks, ...this.pieces, ...this.strips, ...this.edits, this.picked].includes(range)) throw new Error(`passage: ${call}: the span is no longer in the passage. Ask for it again, with span() or chunk()`)
        return range
    }

    private piece(call: string, index: number): Range {
        if (this.pieces.length === 0) throw new Error(`passage: ${call}: the passage is not cut, so it has no chunk. Play cut() first`)
        const range = Number.isInteger(index) ? this.pieces[index] : undefined
        if (!range) throw new Error(`passage: ${call}: no chunk ${shown(index)}. The passage has ${this.pieces.length} chunks, and the first is chunk 0`)
        return range
    }

    /** The span of a film that holds these words. Words that are struck at an end of a span do not count. */
    private spanAt(first: Glyph, last: Glyph): Range | undefined {
        return this.marks.find((range) => {
            const left = this.glyphs.slice(this.order.get(range.first)!, this.order.get(range.last)! + 1).filter((glyph) => glyph.token.state !== 'struck')
            return left[0] === first && left[left.length - 1] === last
        })
    }

    /**
     * A range on each of its lines: the ends of the ink of its words, the ends of its band, and the top of the
     * line. A band passes the ink of its words by `side`, and by half of the room to the glyph beside it at the
     * most, so a band that ends before a period does not reach the period.
     */
    private segments(range: { first: Glyph; last: Glyph; joins?: readonly [boolean, boolean] }, side = this.size * BAND_SIDE): Ends[] {
        const from = this.order.get(range.first), to = this.order.get(range.last)
        const out: Ends[] = []
        if (from === undefined || to === undefined) return out
        const ink = (glyph: Glyph): [number, number] => {
            const x = this.padX + glyph.token.x + glyph.ox
            return [x - glyph.half, x + glyph.half]
        }
        for (let index = from; index <= to; index++) {
            const glyph = this.glyphs[index]!, line = glyph.token.line, [left, right] = ink(glyph), last = out[out.length - 1]
            if (last && last.line === line) {
                last.x0 = Math.min(last.x0, left)
                last.x1 = Math.max(last.x1, right)
            } else {
                out.push({ line, x0: left, x1: right, b0: 0, b1: 0, top: this.textTop + this.tops[line]! })
            }
        }
        // The glyph before the range is beside its first line, and the glyph after it is beside its last line.
        const beside = (index: number, line: number) => {
            const glyph = this.glyphs[index]
            return glyph && glyph.token.line === line ? ink(glyph) : null
        }
        out.forEach((part, index) => {
            const before = index === 0 ? beside(from - 1, part.line) : null, after = index === out.length - 1 ? beside(to + 1, part.line) : null
            // A band that joins the band beside it ends in the middle of the room between the two.
            part.b0 = part.x0 - (before ? Math.min(range.joins?.[0] ? Infinity : side, Math.max(0, part.x0 - before[1]) / 2) : side)
            part.b1 = part.x1 + (after ? Math.min(range.joins?.[1] ? Infinity : side, Math.max(0, after[0] - part.x1) / 2) : side)
        })
        return out
    }

    /** The box of the band of a part on each of its lines, in the coordinates of the object: left, top, right, bottom. */
    private boxes(ends: readonly [Glyph, Glyph]): [number, number, number, number][] {
        return this.segments({ first: ends[0], last: ends[1] }).map((part) => {
            const base = part.top + this.rise
            return [part.b0, base + this.bandTop, part.b1, base + this.bandBottom]
        })
    }

    /**
     * Where a line leaves a part of the text by each side. A part on two lines has an end on each: the line
     * takes the end that is nearest to its side of the object, so it does not run under a whole line of
     * words to reach the other one.
     */
    private anchors(range: { first: Glyph; last: Glyph }): Anchors {
        let left: [number, number] | null = null, right: [number, number] | null = null
        for (let index = this.order.get(range.first)!; index <= this.order.get(range.last)!; index++) {
            const glyph = this.glyphs[index]!, x = this.padX + glyph.token.x + glyph.ox, base = this.textTop + this.tops[glyph.token.line]! + this.rise
            if (!left || x - glyph.half < left[0] - 0.5) left = [x - glyph.half, base]
            if (!right || x + glyph.half > right[0] + 0.5) right = [x + glyph.half, base]
        }
        return [left![0], left![1], right![0], right![1]]
    }

    /** The three points of the way out by one side: under the end of the words, in the room between two lines, and at the side of the object. */
    private way(at: Anchors, side: 'left' | 'right'): [Vec, Vec, Vec] {
        const [x, base] = side === 'right' ? [at[2], at[3]] : [at[0], at[1]]
        const between = base - this.rise + this.pitch
        return [[x, base + this.bandBottom], [x, between], [side === 'right' ? this.w : 0, between]]
    }

    /**
     * The way out of a part of the text for a link, at each time of the film. A link is drawn on every frame,
     * and the lists of the passage hold the text after all its changes. So the place of the part is kept over
     * time: each `diff()` and each `accept()` adds the way from the old place to the new one.
     */
    private tie(range: { first: Glyph; last: Glyph }, initial: Anchors | null = this.anchors(range)): LinkAnchor {
        const places = new Track<Anchors | null>(initial)
        this.ties.push({ range, places })
        const read: LinkAnchor = (side) => {
            const at = places.sample(clock.now)
            return at ? this.way(at, side) : null
        }
        COPY_ANCHOR.set(read, (page) => {
            const first = this.order.get(range.first), last = this.order.get(range.last)
            if (first === undefined || last === undefined) return () => null
            return page.tie({ first: page.glyphs[first]!, last: page.glyphs[last]! }, places.sample(clock.now))
        })
        return read
    }

    /** The ends of the links follow the words to their places of now. A part with no word left has no place. */
    private retie(t0: number, t1: number, ease: Ease): void {
        for (const { range, places } of this.ties) {
            const next = this.order.has(range.first) && this.order.has(range.last) ? this.anchors(range) : null
            const from = places.sample(t0)
            if (!next || !from) places.step(t0, next)
            else if (next.some((value, index) => value !== from[index])) places.add({ t0, t1, ease, to: next, at: (alpha) => next.map((value, index) => from[index]! + (value - from[index]!) * alpha) as unknown as Anchors })
        }
    }

    /** The band of a look on one line: around the words, or the whole height of the line, or one half of it for a chunk. */
    private bandPath(look: Look, at: Pick<Ends, 'b0' | 'b1' | 'top'>): Path {
        const size = this.size
        if (look.shape === 'band') {
            const base = at.top + this.rise
            return bar(at.b0, at.b1, base + this.bandTop, base + this.bandBottom, size * 0.16)
        }
        const half = this.pitch / 2
        return bar(at.b0, at.b1, at.top + (look.shape === 'lower' ? half : 0), at.top + (look.shape === 'upper' ? half : this.pitch), size * 0.14)
    }

    /** The shape of the sign of a look on one line, or null for a look whose sign is its band or the frame of its band. */
    private signPath(look: Look, at: Ends): Path | null {
        const size = this.size, base = at.top + this.rise, thick = Math.max(2, size * LINE), { x0, x1 } = at
        if (look.sign === 'underline') return bar(x0, x1, base + this.under, base + this.under + thick, thick / 2)
        if (look.sign === 'double') {
            const thin = Math.max(1.5, size * 0.055), y = base + this.under - thin / 2
            return [...bar(x0, x1, y, y + thin, thin / 2), ...bar(x0, x1, y + thin * 2, y + thin * 3, thin / 2)]
        }
        if (look.sign === 'strike') return bar(x0 - size * 0.04, x1 + size * 0.04, base + this.middle - thick / 2, base + this.middle + thick / 2, thick / 2)
        if (look.sign === 'dashed') return dashes(x0, x1, base + this.under, thick, size * 0.42, size * 0.3)
        if (look.sign === 'wavy') return wave(x0, x1, base + this.under + size * 0.06 + thick / 2, size * 0.05, size * 0.5, thick)
        if (look.sign === 'hatch') return hatch(at.b0, at.b1, base + this.bandTop, base + this.bandBottom, size * 0.42, size * 0.06)
        return null
    }

    /** A sign whose shape has the same points at each width changes point by point. The others change while they do not show. */
    private steadySign(sign: PassageSign): boolean {
        return sign === 'underline' || sign === 'double' || sign === 'strike'
    }

    /**
     * Bring what is drawn for a range to the layout of now. A new range grows along its words, line after line.
     * A range that changes grows and shrinks line by line: a line that it reaches comes from the side where
     * the range was, and a line that it leaves fades.
     */
    private settle(range: Range, t0: number, t1: number, ease: Ease, grow: boolean): void {
        const look = range.look, span = t1 - t0
        const next = this.segments(range, this.size * (look.shape === 'band' ? BAND_SIDE : CHUNK_SIDE))
        const lines = new Set(next.map((part) => part.line))
        const kept = new Map(range.parts.map((part) => [part.line, part] as const))
        const had = range.parts.map((part) => part.line)
        const lowest = Math.min(...had)
        for (const part of range.parts) {
            if (lines.has(part.line)) continue
            for (const node of [part.group, part.sign]) this.fadeAway(node, t0, t0 + span * 0.4, ease)
        }
        const windows = grow ? staggered(next.length, 0.6, t0, t1) : null
        range.parts = next.map((ends, index) => {
            const part = kept.get(ends.line)
            if (!part) {
                const [start, end] = windows ? windows[index]! : [t0, t1]
                return this.addPart(range, ends, start, end, ease, !grow && had.length > 0 && ends.line < lowest)
            }
            if (part.x0 !== ends.x0 || part.x1 !== ends.x1 || part.b0 !== ends.b0 || part.b1 !== ends.b1 || part.top !== ends.top) {
                // The line of a frame does not show while its end moves over letters: it leaves first, the
                // band moves, and the line comes back where the band stops.
                const boxed = look.sign === 'box' && span > 0
                const [from, to] = boxed ? [t0 + span * 0.15, t1 - span * 0.2] : [t0, t1]
                slide(part.band, this.bandPath(look, ends), from, to, ease)
                if (boxed) {
                    part.band.tween('strokeOpacity', 0, t0, from, ease)
                    part.band.tween('strokeOpacity', 1, to, t1, ease)
                }
                const path = part.sign ? this.signPath(look, ends) : null
                if (part.sign && path) {
                    if (this.steadySign(look.sign)) {
                        slide(part.sign, path, t0, t1, ease)
                    } else {
                        // A row of dashes has other points at another width. It changes while it does not show.
                        part.sign.tween('opacity', 0, t0, t0 + span * 0.35, ease)
                        stepAt(part.sign, 'path', path, t0 + span * 0.5)
                        part.sign.tween('opacity', 1, t0 + span * 0.65, t1, ease)
                    }
                }
                Object.assign(part, ends)
            }
            return part
        })
    }

    /** One line of a range arrives: its band grows from one end, and its sign with it. */
    private addPart(range: Range, at: Ends, t0: number, t1: number, ease: Ease, fromRight: boolean): Part {
        const look = range.look, start = fromRight ? at.b1 : at.b0
        const band = new Node(this.bandPath(look, { ...at, b0: start, b1: start })).fill(look.color, look.fill).stroke(look.color, Math.max(2, this.size * 0.07), 0)
        // The band is the highlight of its words. The film check does not read it as a mark.
        band.data['decoration'] = true
        const group = new Node().add(band)
        attach(range.node, group, t0)
        stepAt(group, 'opacity', 0, t0)
        group.tween('opacity', 1, t0, t0 + (t1 - t0) * 0.3, ease)
        // The line of a frame arrives when the band is around its words: an end that grows would cross the letters.
        const grown = look.sign === 'box' ? t0 + (t1 - t0) * 0.75 : t1
        slide(band, this.bandPath(look, at), t0, grown, ease)
        if (look.sign === 'box') band.tween('strokeOpacity', 1, grown, t1, ease)
        const part: Part = { ...at, group, band, sign: null }
        this.addSign(range, part, look, t0, t1, ease, fromRight ? at.x1 : at.x0)
        return part
    }

    /** The sign of a look arrives on one line: a line grows with the band, and a pattern fades in. */
    private addSign(range: Range, part: Part, look: Look, t0: number, t1: number, ease: Ease, from: number | null): void {
        const path = this.signPath(look, part)
        if (!path) {
            part.sign = null
            return
        }
        const grows = from !== null && this.steadySign(look.sign)
        const sign = new Node(grows ? this.signPath(look, { ...part, x0: from, x1: from })! : path).fill(look.color, look.sign === 'hatch' ? HATCH_FILL : 1)
        // A hatch is a part of the highlight behind the words. The film check does not read it as a mark.
        if (look.sign === 'hatch') sign.data['decoration'] = true
        // The line of a strike is over the words. Every other sign is behind them.
        attach(look.sign === 'strike' ? range.over : part.group, sign, t0)
        if (grows) {
            slide(sign, path, t0, t1, ease)
        } else {
            stepAt(sign, 'opacity', 0, t0)
            sign.tween('opacity', 1, t0 + (t1 - t0) * 0.4, t1, ease)
        }
        part.sign = sign
    }

    /** A range takes another look: its color changes, and the old sign gives way to the new one. */
    private restyle(range: Range, look: Look, t0: number, t1: number, ease: Ease): void {
        const old = range.look, turn = (t0 + t1) / 2
        range.look = look
        for (const part of range.parts) {
            part.band.tween('fill', toPaint(look.color), t0, t1, ease)
            part.band.tween('stroke', toPaint(look.color), t0, t1, ease)
            part.band.tween('strokeOpacity', look.sign === 'box' ? 1 : 0, t0, t1, ease)
            if (old.sign === look.sign) {
                part.sign?.tween('fill', toPaint(look.color), t0, t1, ease)
                continue
            }
            this.fadeAway(part.sign, t0, turn, ease)
            this.addSign(range, part, look, turn, t1, ease, null)
        }
    }

    private fadeAway(node: Node | null, t0: number, t1: number, ease: Ease): void {
        if (!node) return
        node.tween('opacity', 0, t0, t1, ease)
        node.track('visible').step(t1, false)
    }

    /** All that is drawn for a range fades out. */
    private dismiss(range: Range, t0: number, t1: number, ease: Ease): void {
        for (const part of range.parts) for (const node of [part.group, part.sign]) this.fadeAway(node, t0, t1, ease)
        range.parts = []
    }

    // ── Chunks ────────────────────────────────────────────────────────────

    /** The first and the last glyph of each chunk of a cut. */
    private plan(how: PassageCut): [Glyph, Glyph][] {
        this.steady('cut')
        const tokens = this.tokens
        const ends = (from: number, to: number): [Glyph, Glyph] => [tokens[from]!.glyphs[0]!, tokens[to]!.glyphs.at(-1)!]
        let chunks: [Glyph, Glyph][]
        if (Array.isArray(how)) {
            if (how.length === 0) throw new Error('passage: cut: the list of chunks is empty. Give the words of each chunk, or null for no chunks')
            chunks = (how as readonly string[]).map((words, index) => {
                if (typeof words !== 'string') throw new Error(`passage: cut: chunk ${index} is ${shown(words)}. A chunk of the list is its words`)
                return this.locate(`cut: chunk ${index}`, words)
            })
        } else if (typeof how === 'object' && how !== null && 'by' in how) {
            if (how.by !== 'sentence' && how.by !== 'paragraph') throw new Error(`passage: cut: by is 'sentence' or 'paragraph', not ${shown(how.by)}`)
            chunks = []
            let from = 0
            tokens.forEach((token, index) => {
                const next = tokens[index + 1]
                if (next && !(next.gap === 'para' || (how.by === 'sentence' && endsSentence(token.text)))) return
                chunks.push(ends(from, index))
                from = index + 1
            })
        } else if (typeof how === 'object' && how !== null && 'tokens' in how) {
            const budget = how.tokens
            if (!Number.isSafeInteger(budget) || budget < 1) throw new Error('passage: cut: give a token budget of at least one whole token')
            if (!this.counted) throw new Error(this.noTokens('cut({ tokens })'))
            chunks = []
            let start = 0
            for (let index = 0; index < tokens.length; index++) {
                const [first, last] = ends(start, index)
                // Tokenization can change across a word boundary. Count the candidate as a whole.
                if (this.sizeOf(this.wordsIn({ first, last })).tokens! <= budget) continue
                if (start < index) chunks.push(ends(start, index - 1))
                const word = tokens[index]!.text
                if (this.sizeOf(word).tokens! > budget) throw new Error(`passage: cut: the word ${short(word)} exceeds the budget of ${budget} tokens. Increase the budget or split the word in the source text`)
                start = index
            }
            chunks.push(ends(start, tokens.length - 1))
        } else if (typeof how === 'object' && how !== null && 'size' in how) {
            const size = how.size, overlap = how.overlap ?? 0
            if (!(Number.isInteger(size) && size >= 1)) throw new Error(`passage: cut: size is the number of words of a chunk, a whole number, 1 or more, not ${shown(size)}`)
            // With more, a word would be in three chunks, and the picture could not show whose it is.
            if (!(Number.isInteger(overlap) && overlap >= 0 && overlap * 2 <= size)) throw new Error(`passage: cut: overlap is the number of words that two chunks share, a whole number from 0 to half of size (${Math.floor(size / 2)}), not ${shown(overlap)}`)
            chunks = []
            for (let from = 0; from < tokens.length; from += size - overlap) {
                chunks.push(ends(from, Math.min(from + size, tokens.length) - 1))
                if (from + size >= tokens.length) break
            }
        } else {
            throw new Error(`passage: cut takes { size, overlap }, { tokens: budget }, { by: 'sentence' } or { by: 'paragraph' }, the words of each chunk, or null, not ${shown(how)}`)
        }
        chunks.forEach(([first, last], index) => {
            const before = chunks[index - 1], far = chunks[index - 2]
            if (before && this.order.get(first)! <= this.order.get(before[0])!) throw new Error(`passage: cut: chunk ${index} (${short(this.wordsIn({ first, last }))}) starts before chunk ${index - 1} or with it. Give the chunks in the order of the text`)
            if (before && this.order.get(last)! <= this.order.get(before[1])!) throw new Error(`passage: cut: chunk ${index} (${short(this.wordsIn({ first, last }))}) is inside chunk ${index - 1}. A chunk ends after the one before it`)
            if (far && this.order.get(first)! <= this.order.get(far[1])!) throw new Error(`passage: cut: chunks ${index - 2}, ${index - 1} and ${index} share the word ${JSON.stringify(first.token.text)}. A word is in two chunks at the most: give a smaller overlap`)
        })
        return chunks
    }

    // ── Times ─────────────────────────────────────────────────────────────

    /** A change of the words of a passage with chunks, or a second change before the first is taken, has no right picture. */
    private steady(call: 'diff' | 'cut'): void {
        if (this.edits.length > 0) throw new Error(`passage: ${call}: the passage shows a change that waits. Play accept() first: it takes the old words away, and the text is then one version`)
        if (call === 'diff' && this.pieces.length > 0) throw new Error('passage: diff: the passage is cut into chunks, and a chunk is a part of one version. Take the chunks away first with cut(null), and cut the next version again')
    }

    private times(call: string, ctx: AnimContext): [number, number] {
        if (!(Number.isFinite(ctx.t0) && Number.isFinite(ctx.t1) && ctx.t1 >= ctx.t0)) throw new Error(`passage: ${call} plays from ${String(ctx.t0)} to ${String(ctx.t1)}. Give the play a duration that is a number, 0 or more`)
        return [ctx.t0, ctx.t1]
    }

    /** Take the time of a change that moves words. Two at one time would each write a way for the words. */
    private claim(call: string, ctx: AnimContext): void {
        const [t0, t1] = this.times(call, ctx), last = this.moving
        if (last && t0 < last.t1 - SOON) throw new Error(`passage: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. The words move in one change at a time. Play the two in a \`seq\`, or start ${call} at ${seconds(last.t1)} or later`)
        const busy = this.changesOnPaper.find((change) => t0 < change.t1 - SOON && t1 > change.t0 + SOON)
        if (busy) throw new Error(`passage: ${call} moves the words while ${busy.call} plays from ${seconds(busy.t0)} to ${seconds(busy.t1)}. Play the two in a \`seq\``)
        this.moving = { call, t0, t1 }
    }

    /** A band that arrives while the words move would be at the place where the words are not yet. */
    private free(call: string, ctx: AnimContext): () => void {
        const [t0, t1] = this.times(call, ctx), last = this.moving
        if (last && t0 < last.t1 - SOON && t1 > last.t0 + SOON) throw new Error(`passage: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, while ${last.call} moves the words from ${seconds(last.t0)} to ${seconds(last.t1)}. Play ${call} after it, or the two in a \`seq\``)
        return () => { this.changesOnPaper.push({ call, t0, t1 }) }
    }
}

/** A passage of real text whose parts a film marks, cuts and links: `passage('Refunds are accepted within 14 days of delivery.', { width: 800, title: 'policy.md' })`. */
export function passage(content: string, options: PassageOptions = {}): Passage {
    return new Passage(content, options)
}

export interface PassageLinkOptions {
    /** The color of the line. Defaults to dim. */
    color?: ColorInput
    /** The width of the line. Defaults to 0.08 of the text size of the passage, and to 2 at the least. */
    width?: number
    /** The side by which the line leaves when the target is over or under the passage. Defaults to right. */
    side?: 'left' | 'right'
    /**
     * The line goes up or down in the middle of the room between the passage and the target. `shift` moves
     * that part sideways by so many pixels, so that the lines of two links do not share it. Defaults to 0.
     */
    shift?: number
    /** The text size that the line takes its measures from. Defaults to the size of the passage. */
    size?: number
}

/**
 * A line from a part of a passage to a node. It is routed on every frame, so it follows the two. `enter()`
 * draws it, and `break()` opens a gap with a cross in it, for a tie that does not hold. Make one with
 * `passage.link()`.
 */
export class PassageLink extends Node {
    private gap = new Value(0)
    private cut = false
    private readonly size: number
    private readonly side: 'left' | 'right'
    /** How far the part of the line that goes up or down is from the middle of the room between the two. */
    private readonly aside: number

    constructor(
        private readonly from: Passage,
        /** The three points of the way out of the passage, by one side, in its coordinates. Null when the words are gone. */
        private leader: LinkAnchor,
        private readonly to: Node,
        /** The same for the span of a passage that the line ends at, in the coordinates of that passage. Null for any other node. */
        private entry: LinkAnchor | null = null,
        options: PassageLinkOptions = {},
    ) {
        // An empty path lets the standard draw verb animate trimTo here.
        super([])
        if (!(from instanceof Passage) || typeof leader !== 'function' || !(to instanceof Node) || (to instanceof PassageSpan) !== (typeof entry === 'function')) throw new Error('passageLink: make a link with passage.link(words, target)')
        if (options.side !== undefined && options.side !== 'left' && options.side !== 'right') throw new Error(`passage: the side of a link is 'left' or 'right', not ${shown(options.side)}`)
        this.size = options.size ?? 32
        if (!(Number.isFinite(this.size) && this.size > 0)) throw new Error('passage: the size of a link must be a positive text size in pixels')
        this.side = options.side ?? 'right'
        this.aside = options.shift ?? 0
        if (!Number.isFinite(this.aside)) throw new Error(`passage: the shift of a link is a number of pixels, not ${shown(options.shift)}`)
        const width = options.width ?? Math.max(2, this.size * 0.08)
        if (!(Number.isFinite(width) && width > 0)) throw new Error('passage: the width of a link is the width of its line, more than 0')
        this.base.stroke = toPaint(options.color ?? 'dim')
        this.base.strokeWidth = width
        this.draw = () => this.build()
        ownLabels(this, { name: 'passage link', labels: [] })
        // The line ends at the two on purpose, so the film check does not judge their text against it.
        this.data['attached'] = [from, to instanceof PassageSpan ? to.passage : to]
        this.data['line'] = true
    }

    protected override [rebindCloneParts](copy: this): () => void {
        copy.gap = new Value(this.gap.value)
        copy.draw = () => copy.build()
        copy.data['attached'] = [copy.from, copy.to instanceof PassageSpan ? copy.to.passage : copy.to]
        return () => {
            if (copy.from !== this.from) copy.leader = COPY_ANCHOR.get(this.leader)?.(copy.from) ?? this.leader
            if (this.entry && this.to instanceof PassageSpan && copy.to instanceof PassageSpan && copy.to.passage !== this.to.passage) {
                copy.entry = COPY_ANCHOR.get(this.entry)?.(copy.to.passage) ?? this.entry
            }
        }
    }

    /** True after `break()`, for the changes that the film has played so far. */
    get broken(): boolean {
        return this.cut
    }

    /** The points of the line on this frame, on the stage, or null when one of its ends has no place. */
    routeNow(): Vec[] | null {
        return this.route()?.points ?? null
    }

    /** The points of the line, and the middle of its part between the passage and the target: the place of the cross of a tie that does not hold. */
    private route(): { points: Vec[]; middle: Vec } | null {
        const own = boxOf(this.from), target = this.to
        const there = target instanceof PassageSpan ? boxOf(target.passage) : (() => {
            const box = target.bounds()
            return new Box(box.x, box.y, box.x + box.width, box.y + box.height)
        })()
        let exit = this.side, entry = this.side, channel: number
        if (there.left >= own.right) {
            exit = 'right'
            entry = 'left'
            channel = (own.right + there.left) / 2
        } else if (there.right <= own.left) {
            exit = 'left'
            entry = 'right'
            channel = (own.left + there.right) / 2
        } else {
            // One is over the other: the line goes around both by one side.
            channel = exit === 'right' ? Math.max(own.right, there.right) + this.size * 0.9 : Math.min(own.left, there.left) - this.size * 0.9
        }
        channel += this.aside
        const out = this.leader(exit)
        if (!out) return null
        const [start, turn] = [this.from.toWorld(...out[0]), this.from.toWorld(...out[1])]
        const points: Vec[] = [start, turn, [channel, turn[1]]]
        if (target instanceof PassageSpan) {
            const back = this.entry?.(entry)
            // The words of the span are gone. A frame draws no line.
            if (!back) return null
            const [end, bend] = [target.passage.toWorld(...back[0]), target.passage.toWorld(...back[1])]
            points.push([channel, bend[1]], bend, end)
        } else {
            // The line stops before a node, so its dot does not touch what the node draws.
            const gap = this.size * 0.9
            const end: Vec = [entry === 'left' ? there.left - gap : there.right + gap, there.cy]
            points.push([channel, end[1]], end)
        }
        const middle: Vec = [channel, (points[2]![1] + points[3]![1]) / 2]
        // Two points at one place make no corner.
        return { points: points.filter((point, index) => index === 0 || Math.hypot(point[0] - points[index - 1]![0], point[1] - points[index - 1]![1]) > 0.5), middle }
    }

    private build(): Node[] {
        const route = this.route()
        if (!route || route.points.length < 2) return []
        const inverse = invert(this.worldMatrix())
        const local = route.points.map(([x, y]) => apply(inverse, x, y) as Vec), middle = apply(inverse, ...route.middle)
        const whole = rounded(local, this.size * 0.3), length = pathLength(whole)
        if (length < 1) return []
        // How far along the line its middle is: the part of the way to the point between the passage and the target.
        let before = 0, total = 0, found = false
        for (let index = 1; index < local.length; index++) {
            const a = local[index - 1]!, b = local[index]!, piece = Math.hypot(b[0] - a[0], b[1] - a[1])
            const to = Math.hypot(middle[0] - a[0], middle[1] - a[1])
            if (!found && Math.abs(to + Math.hypot(b[0] - middle[0], b[1] - middle[1]) - piece) < 0.5) {
                before = total + to
                found = true
            }
            total += piece
        }
        const centre = found && total > 0 ? before / total : 0.5
        const progress = this.get('trimTo'), stroke = this.get('stroke') ?? toPaint('dim'), width = this.get('strokeWidth'), opacity = this.get('strokeOpacity')
        const open = this.gap.value, half = (open * this.size * 0.45) / length
        const out: Node[] = []
        const piece = (from: number, to: number) => {
            const path = trimPath(whole, Math.max(0, from), Math.min(progress, to))
            if (to <= from || path.length === 0) return
            const node = new Node(path).stroke(stroke, width, opacity)
            // A tie that does not hold is a line of dashes.
            if (open > 0.5) node.dash([this.size * 0.32, this.size * 0.24])
            out.push(node)
        }
        if (open > 0) {
            piece(0, centre - half)
            piece(centre + half, 1)
            if (progress > centre) {
                const [x, y] = pointAt(whole, centre), arm = open * this.size * 0.22
                for (const sign of [1, -1]) out.push(new Node(polyPath([[x - arm, y - arm * sign], [x + arm, y + arm * sign]])).stroke(stroke, width * 1.2, opacity))
            }
        } else {
            piece(0, 1)
        }
        const dot = Math.max(width * 1.6, this.size * 0.13)
        if (progress > 0.02) out.push(new Node(circlePath(local[0]![0], local[0]![1], dot)).fill(stroke, opacity))
        if (progress > 0.98) out.push(new Node(circlePath(local[local.length - 1]![0], local[local.length - 1]![1], dot)).fill(stroke, opacity))
        return out
    }

    /** The line draws from the part of the passage to the target. */
    enter(options: AnimOptions = {}): Anim {
        checkTiming('link.enter()', options)
        return {
            label: 'passageLink.enter', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                stepAt(this, 'trimTo', 0, ctx.t0)
                this.tween('trimTo', 1, ctx.t0, ctx.t1, ctx.ease)
            },
        }
    }

    /**
     * The tie does not hold: a gap opens in the middle of the line with a cross in it, the line becomes
     * dashes, and it takes the color, red by default.
     */
    break(options: AnimOptions & { color?: ColorInput } = {}): Anim {
        checkTiming('link.break()', options)
        return {
            label: 'passageLink.break', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                this.cut = true
                tweenValue(this.gap, 1, ctx.t0, ctx.t1, ctx.ease)
                this.tween('stroke', toPaint(options.color ?? 'red'), ctx.t0, ctx.t1, ctx.ease)
            },
        }
    }
}
