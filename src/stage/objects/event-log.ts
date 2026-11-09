import { Node, ownLabels, type NodeProps, type PropName } from '../node'
import { toPaint, type ColorInput, type Paint } from '../color'
import { circle, dot, line, polyline, rect, svgPath } from '../shapes'
import { filmFont, text, type TextOptions } from '../text'
import { fontFor } from '../font'
import type { Ease } from '../ease'
import type { Key } from '../track'
import type { Anim, AnimContext, AnimOptions } from '../anim'
import { reveal, sampleAt, staggered, stepAt } from './util'

type Id = number | string
type MarkShape = 'dot' | 'ring' | 'check' | 'cross'
/** The calls that change the rows of the list or move its window. */
type Change = 'append' | 'fold' | 'unfold' | 'scrollTo'

/** What a row shows and carries, apart from its identity. */
export interface LogRowFields {
    /** The name of the record, in mono: `ActivityTaskCompleted`. */
    name: string
    /** One short detail, dim: `"ch_1001"`, `attempt 4`. A number is taken as its text. */
    detail?: string | number
    /** A time at the right end of the row, dim and in mono: `+6.01 s`. The list has this column when one of its first rows has a time. */
    time?: string | number
    /** Defaults to the first state of `states`. A row of a fold defaults to the state of the fold. */
    state?: string
    /** A word that the list does not draw. A film reads it in `find()` and `mark()`, to pick the rows of one kind. */
    family?: string
    /** With false, the row has its place in the list from the start and does not show. `show()` brings it in. Defaults to true. */
    shown?: boolean
}

/**
 * One row of the list. A row has an `id`: an event number, a step number. Or it has `ids`, and stands for
 * several records that follow each other, such as the three events of one task. Such a row is a fold. It shows
 * its first and its last id, as "2 to 4", and `unfold()` opens it into its `rows`. An id is in the list once.
 */
export type LogRow = LogRowFields & ({
    id: Id
    ids?: readonly Id[]
} | {
    /** With `ids`, the first of them. */
    id?: Id
    ids: readonly Id[]
    /** The rows of a fold, one for each id, in order. `unfold()` needs them. */
    rows?: readonly LogRow[]
})

export interface LogState {
    color: ColorInput
    /** Draw the row dim, for a record that is old or not reached. */
    dim?: boolean
    /** The shape of the mark at the left of the row, so that a viewer can tell two states with no color. Defaults to dot. */
    mark?: 'dot' | 'ring' | 'check' | 'cross'
}

export interface EventLogOptions {
    /** The width of the list. Defaults to 640. */
    width?: number
    /**
     * How many lines show at once. More rows scroll: the oldest leave at the top, and the first line then
     * says how many are above. Defaults to 10.
     */
    visible?: number
    /** Text size. Defaults to 24. */
    size?: number
    /**
     * The height of a row, as a part of `size`. Defaults to the height that the outline of the focus needs,
     * about 1.9. A list with `focusLook: 'band'`, or with no focus, can take less, such as 1.5.
     */
    leading?: number
    /** The states and their looks. Defaults to LOG_STATES. */
    states?: Record<string, LogState>
    /** A title over the list, such as 'event history'. */
    title?: string
    /** A line under the list that follows the count of the rows that show, such as (count) => `${count} events`. */
    footer?: (count: number) => string
    /** The text size of the title, the footer and the counts of the rows out of the window. Defaults to 0.85 of `size`. */
    titleSize?: number
    /**
     * The room of the names. A longer name is cut with an ellipsis. Defaults to the longest name of the first
     * rows, and to 60% of the width at most. The details have the room that is left. The name of a row with
     * no detail may go on to the end of the details.
     */
    nameWidth?: number
    /** The room of the ids. A longer id is an error. Defaults to the longest id of the first rows, and to two digits at least. */
    idWidth?: number
    /** The room of the times. A longer time is an error. Defaults to the longest time of the first rows. Set it for a list that gets its first time later. */
    timeWidth?: number
    /** With false, a name or a detail that does not fit is an error, and not a text with an ellipsis. Defaults to true. */
    ellipsis?: boolean
    /** What `focus()` draws: an outline around the row, or a band behind it. Defaults to outline. */
    focusLook?: 'outline' | 'band'
    /** The font of the title, the footer and the details. Defaults to the font of the film. The ids, the names and the times are in mono. */
    font?: TextOptions['font']
    /** The font of the details, for a detail that is data, such as the output of a run. Defaults to `font`. */
    detailFont?: TextOptions['font']
}

/** States for a history that is written and then replayed. Each has its own mark, so color is not the only sign. */
export const LOG_STATES = {
    /** Written, and at rest. */
    stored: { color: 'purple', mark: 'dot' },
    /** Written just now. */
    new: { color: 'ink', mark: 'dot' },
    /** It answered the code during a replay. */
    answered: { color: 'green', mark: 'check' },
    /** Scheduled, with no result yet. */
    waiting: { color: 'yellow', mark: 'ring' },
    failed: { color: 'red', mark: 'cross' },
} satisfies Record<string, LogState>

interface Look {
    paint: Paint
    dim: boolean
    mark: MarkShape
}

/** A row as the list keeps it: with its ids, its state, and the rows of a fold. */
interface Entry {
    ids: Id[]
    name: string
    detail: string | undefined
    time: string | undefined
    family: string | undefined
    state: string
    shown: boolean
    /** One entry for each id of a fold. Null for a row with one id, and for a fold that cannot open. */
    rows: Entry[] | null
}

/** One record of the list: one id. */
interface Rec {
    id: Id
    /** The line of the record alone. It is not in the list while the record is in a fold. */
    own: Line
    /** The line that shows the record now: its own line, or a fold. */
    line: Line
    /** The last fold that started at this record, open or closed. `fold()` with no label closes it again. */
    fold: Line | null
}

/** One line of the list: a row, or a fold of two records or more. */
interface Line {
    node: LogRowNode
    recs: Rec[]
    name: string
    detail: string | undefined
    time: string | undefined
    family: string | undefined
    state: string
    /** False for a row that has its place and waits for `show()`. */
    shown: boolean
    /** False for a fold that was made with no `rows`: it has nothing to open into. */
    opens: boolean
    /** The place in the window, 0 at the top, or null for a line that does not show. */
    slot: number | null
    /** The side of the window where a line that is out of it rests: -1 above, 1 under, 0 for none. */
    rests: number
    /** The time from which the line shows: before any time for a row that shows from the start, and no time for a row that waits for `show()`. */
    shownAt: number
    /** The side of the window that the line is on, from each time that it changed: -1 above, 1 under, 0 in the window or out of the list. */
    sides: { time: number; side: number }[]
}

/** A holder that shows one text at a time, for a count that changes. Each text is made once and kept. */
interface Words {
    holder: Node
    made: Map<string, Node>
    /** The text of a count, or null for a count that the holder does not write. */
    say: (count: number) => string | null
    make: (content: string) => Node
    /** The count from each time that it changes, in the order of time, with the text that says it. The first step is the count at the start. */
    steps: { time: number; count: number; node: Node | null }[]
    /** The mark of a count line. It shows while the count is not 0. */
    dots: Node | null
}

/** The window over the lines. */
interface View {
    /** The index of the first line that shows. */
    first: number
    /** How many lines show. */
    rows: number
    /** The place of the first line that shows: 1 when the count of the records above has the first line. */
    top: number
    /** The last place that a row may have: one less when the count of the records under the window has the last line. */
    floor: number
}

/** The times of one change of the list. */
interface Step {
    /** The lines that leave the list fade out in this time. */
    out: [number, number]
    /** The lines that stay move in this time. */
    move: [number, number]
    /** The lines that take a place in the list fade in in this time. */
    into: [number, number]
    ease: Ease
}

// The text of the title, the footer and the counts, as a part of the text size.
const SMALL = 0.85
// The height of the band of the title or of the footer, as a part of its text size.
const BAND = 1.9 / SMALL
// The opacity of the parts of a row in a state that is `dim`.
const DIM = 0.4
// The clear room between the ink of a row and the outline of the focus, and between that outline and the ink of
// the rows next to it, as a part of the text size. The distance from one row to the next follows from it.
const CLEAR = 0.3
// The fewest characters that a detail has room for. With less room, a viewer reads "at…" and learns nothing.
const DETAIL_CHARS = 8
// A row that scrolls is drawn only near the window. It fades over this part of a row past the first or the
// last row of the window. So it is gone before it reaches the text of a count, or the footer.
const EDGE = 0.4
// A new row comes from this part of a row under its place, at least. In a list that scrolls, it comes from further.
const RISE = 0.35
// The opacity of the fill of the band of the focus.
const BAND_FILL = 0.12
// A time that no film reaches, as a power of two. A key from 0 to this time gets each frame time back exactly,
// so the outline can read where its row is at that frame.
const FOREVER = 2 ** 20
// Two times nearer than this are one time: the end of one animation is the start of the next.
const SOON = 1e-9
const ELLIPSIS = '…'

const clamp = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value)
/** A number as an error writes it: three decimals at most. */
const short = (value: number) => String(Math.round(value * 1000) / 1000)
/** Keep the answers of a function of a count, so that a text is written once for each count. */
const kept = <T>(make: (count: number) => T) => {
    const known = new Map<number, T>()
    return (count: number): T => {
        if (!known.has(count)) known.set(count, make(count))
        return known.get(count) as T
    }
}
const show = (id: Id) => (typeof id === 'string' ? JSON.stringify(id) : String(id))
const seconds = (time: number) => `${Math.round(time * 100) / 100} s`
/** What an error calls a row: "row 7", or "the fold from 2 to 4". */
const called = (ids: readonly Id[]) => (ids.length > 1 ? `the fold from ${show(ids[0]!)} to ${show(ids[ids.length - 1]!)}` : `row ${show(ids[0]!)}`)
/** The right end of the ink of a text that starts at its origin. */
const reach = (node: Node) => { const box = node.bounds(); return box.x + box.width }
/** The advance width of a text with its anchor at the right. It includes the side bearings, so digits line up. */
const advance = (node: Node) => node.get('px')
/** A property of a node at a time, with no change of the clock: a key reads it while the clock is at a frame. */
const readAt = <K extends PropName>(node: Node, prop: K, time: number): NodeProps[K] => {
    const track = node.tracks?.get(prop)
    return track ? track.sample(time) as NodeProps[K] : node.base[prop]
}
/** A key whose value at each frame is a function of the time of that frame, from a time on. From 0, the time is exact. */
const always = <T>(read: (time: number) => T, last: T, from = 0): Key<T> => ({ t0: from, t1: from + FOREVER, ease: null, to: last, at: (alpha) => read(from + alpha * FOREVER) })

function oneLine(what: string, value: string): void {
    if (/[\n\r\t]/.test(value)) throw new Error(`eventLog: ${what} has a line break or a tab. A line of the list holds one line of text`)
}

/** A `duration` and a `lag` are numbers, 0 or more. One that is not a number would lose rows with no error. */
function timed(call: string, options: AnimOptions): void {
    for (const key of ['duration', 'lag'] as const) {
        const value = options[key]
        if (value !== undefined && !(Number.isFinite(value) && value >= 0)) throw new Error(`eventLog: the ${key} of ${call} is ${String(value)}. Give a number, 0 or more`)
    }
}

const INK = new Map<string, readonly [number, number]>()
/**
 * How far the ink of a font goes over and under the point that `text()` places, as a part of the text size.
 * It is read from the printable ASCII characters, so the room around a row holds for any such text.
 */
function inkOf(font: TextOptions['font']): readonly [number, number] {
    const key = font ?? 'sans'
    let known = INK.get(key)
    if (!known) {
        const box = text(Array.from({ length: 94 }, (_, index) => String.fromCharCode(33 + index)).join(''), { font, size: 100, anchor: 'left' }).bounds()
        INK.set(key, known = [-box.y / 100, (box.y + box.height) / 100])
    }
    return known
}

/** One line of an `EventLog`: a row, or a fold. */
export class LogRowNode extends Node {
    /** The holder of the parts. `show()` brings it in, for a row that had its place and did not show. */
    readonly content = new Node()

    constructor(
        /** The mark at the left, in the color and the shape of the state. A fold in a state with a dot has three small dots. */
        readonly mark: Node,
        /** The id. For a fold, its first id. */
        readonly idText: Node,
        /** For a fold, the word "to" and its last id. Null for a row. */
        readonly range: Node | null,
        /** The name, in the color of the state. */
        readonly name: Node,
        /** The detail, or null for a row that has none. */
        readonly detail: Node | null,
        /** The time, or null for a row that has none. */
        readonly time: Node | null,
    ) {
        super()
        for (const part of [mark, idText, range, name, detail, time]) if (part) this.content.add(part)
        this.add(this.content)
    }

    /** The parts that the line has, from the left: the mark, the id, the range of a fold, the name, the detail, the time. */
    get parts(): Node[] {
        return this.content.children
    }
}

/**
 * A list of records with an identity, such as the event history of a workflow, the steps of an agent, or
 * the life of a sandbox. A row has an id, a name, one short detail, and a state that sets its color and its
 * mark. `append()` adds rows at the bottom, `mark()` changes the state of rows, `fold()` puts rows that follow
 * each other into one line, `focus()` moves one outline to a row, and `scrollTo()` moves the window to a row.
 * The window shows `visible` lines. When the list has more, the oldest rows leave at the top, and the first
 * line says how many are above. The list changes its rows one change at a time: two changes of the rows whose
 * times overlap are an error. `.at()` places the middle of the panel. The panel has its full height from the start.
 */
export class EventLog extends Node {
    /** The panel: its fill and its border. */
    readonly frame: Node
    /** The line under the title and the line over the footer. */
    readonly rules: Node[] = []
    readonly title: Node | null
    /** The line under the list that follows the count, or null. */
    readonly footer: Node | null
    /** The first line of a window with rows above it: the number of those records. */
    readonly earlier: Node
    /** The last line of a window with rows under it: the number of those records. */
    readonly later: Node
    /** What `focus()` moves: the outline around a row, or the band behind it. */
    readonly outline: Node
    /** The distance from one row to the next. A code block beside the list can take it: `leading: log.pitch / size`. */
    readonly pitch: number
    /** The distance from one row to the next that the outline of the focus needs. */
    private readonly needs: number
    private readonly band: boolean
    /** All that is in the window: the rows, the two counts and the outline. `enter()` fades it. */
    private readonly body = new Node()
    private readonly w: number
    private readonly size: number
    private readonly small: number
    private readonly slots: number
    /** The y of the middle of the first line of the window. */
    private readonly first: number
    /** How far under the middle of its row the middle of the outline is: the ink of a row goes further down than up. */
    private readonly lift: number
    private readonly markX: number
    private readonly lineLeft: number
    private readonly idRight: number
    private readonly idRoom: number
    /** The characters that the room of the ids holds. */
    private readonly idChars: number
    /** The room that a fold takes after its first id, for the word "to" and its last id. Its name starts after it. */
    private readonly tail: number
    private readonly nameLeft: number
    private readonly nameRoom: number
    /** The least room of a name: four characters and the ellipsis. */
    private readonly least: number
    /** What sets the room of the names: the `nameWidth` of the film or null, the longest name of the first rows, and the part of the width that is not for names and details. */
    private readonly given: number | null
    private readonly longest: number
    private readonly fixed: number
    private readonly gap: number
    private readonly detailLeft: number
    private readonly detailEnd: number
    /** The width of one character of a detail. */
    private readonly detailChar: number
    /** The room of the times, or 0 for a list with no time column. */
    private readonly timeRoom: number
    /** The x where the content ends, at the right. */
    private readonly end: number
    private readonly cut: boolean
    private readonly font: TextOptions['font']
    private readonly detailFont: TextOptions['font']
    /** How far under the middle of a row a text goes, to stand on the baseline of the mono text of the row. */
    private readonly detailDrop: number
    private readonly countDrop: number
    private readonly names: string[]
    private readonly looks = new Map<string, Look>()
    /** The bookkeeping. The animations change it when they are scheduled, so two changes in one sequence chain. */
    private recs: Rec[] = []
    private byId = new Map<string, Rec>()
    private lines: Line[] = []
    /** Every line that the list has made, also those that are in a fold or out of the list. The counts read where each was. */
    private every: Line[] = []
    /** The window, and the line that a `scrollTo` made its first row. Null while the window follows the end of the list. */
    private seen: View
    private pinned: Line | null = null
    private above: Words
    private under: Words
    private foot: Words | null
    /** The count of the rows that show at the start, and each change of it with its time. The footer is written from them. */
    private began = 0
    private tallies: { time: number; delta: number }[] = []
    /** The last change of the rows, with its times. The next one starts after it. */
    private last: { call: string; kind: Change; rows: number; t0: number; t1: number } | null = null
    /** The record that has the focus, and the line that the outline is on. */
    private focused: Rec | null = null
    private lit: Line | null = null
    /** The line that the outline is on from a time, in the order of the calls. */
    private spots: { time: number; line: Line }[] = []
    /** The strength of the outline: each entry takes it to a value over a time, from the value that it finds. */
    private glows: { t0: number; t1: number; to: number; ease: Ease }[] = []

    constructor(rows: readonly LogRow[] = [], options: EventLogOptions = {}) {
        super()
        const w = this.w = options.width ?? 640
        const size = this.size = options.size ?? 24
        const slots = this.slots = options.visible ?? 10
        if (!(Number.isFinite(size) && size > 0)) throw new Error('eventLog: size is a text size, more than 0')
        if (!(Number.isFinite(w) && w > 0)) throw new Error('eventLog: width is the width of the panel, more than 0')
        if (!Number.isInteger(slots) || slots < 2) throw new Error('eventLog: visible is the number of lines in the window, a whole number, 2 or more. A full window needs one line for the count of the rows above')
        const small = this.small = options.titleSize ?? size * SMALL
        if (!(Number.isFinite(small) && small > 0)) throw new Error('eventLog: titleSize is the text size of the title and the footer, more than 0')
        if (options.focusLook !== undefined && options.focusLook !== 'outline' && options.focusLook !== 'band') throw new Error(`eventLog: focusLook is ${JSON.stringify(options.focusLook)}. It is 'outline' or 'band'`)
        const states: Record<string, LogState> = options.states ?? LOG_STATES
        this.names = Object.keys(states)
        if (this.names.length === 0) throw new Error('eventLog: give it at least one state')
        for (const name of this.names) {
            const shape = states[name]!.mark ?? 'dot'
            if (!['dot', 'ring', 'check', 'cross'].includes(shape)) throw new Error(`eventLog: the mark of the state ${JSON.stringify(name)} is ${JSON.stringify(shape)}. A mark is 'dot', 'ring', 'check' or 'cross'`)
            this.looks.set(name, { paint: toPaint(states[name]!.color), dim: states[name]!.dim === true, mark: shape })
        }
        this.cut = options.ellipsis !== false
        const given = this.checked(rows)
        // The rows that can show: each row, and each row of a fold.
        const all = given.flatMap((entry) => [entry, ...(entry.rows ?? [])])

        // The font is taken once, where the list is made: the font that the list names, or the font of the film.
        // So a row that arrives later has the font of the first rows, and the heights are measured in it.
        const font = this.font = options.font ?? filmFont() ?? 'sans'
        const detailFont = this.detailFont = options.detailFont ?? font
        const mono = fontFor('mono', 400)
        const drop = (family: TextOptions['font'], own: number) => {
            const words = fontFor(family ?? 'sans', 400)
            return 0.36 * (mono.ascent / mono.unitsPerEm * size - words.ascent / words.unitsPerEm * own)
        }
        const counts = Math.min(small, size)
        this.detailDrop = drop(detailFont, size)
        this.countDrop = drop(font, counts)
        // The outline of the focus has clear room from the ink of its row and from the ink of the rows next
        // to it. So the rows are as far apart as the ink of a row, the room at its two sides, and the line.
        const [monoOver, monoUnder] = inkOf('mono'), [wordOver, wordUnder] = inkOf(detailFont)
        const over = Math.max(monoOver * size, wordOver * size - this.detailDrop), under = Math.max(monoUnder * size, wordUnder * size + this.detailDrop)
        const stroke = Math.max(2, size * 0.085)
        this.needs = over + under + size * CLEAR * 2 + stroke
        this.band = options.focusLook === 'band'
        // With less than this, the ink of one row comes too near the ink of the next.
        const tight = Math.ceil(((over + under) / size + 0.2) * 100) / 100
        if (options.leading !== undefined && !(Number.isFinite(options.leading) && options.leading >= tight)) throw new Error(`eventLog: leading is ${options.leading}. It is the height of a row as a part of the text size, ${tight} or more with these fonts: the ink of a row, and a little room`)
        this.pitch = options.leading !== undefined ? size * options.leading : this.needs
        this.lift = (under - over) / 2
        const pad = size * 0.8, radius = size * 0.17, gap = size * 0.9
        const border = Math.max(1.5, size * 0.075)
        const left = -w / 2 + pad
        this.end = w / 2 - pad
        this.markX = left + radius
        this.lineLeft = left + radius * 2 + size * 0.6

        // The columns are set once, from the first rows, so that they line up over every row that comes later.
        const wide = (content: string) => advance(text(content, { font: 'mono', size, anchor: 'right' }))
        this.idRoom = options.idWidth ?? Math.max(wide('00'), ...all.flatMap((entry) => entry.ids.map((id) => wide(String(id)))))
        if (!(Number.isFinite(this.idRoom) && this.idRoom > 0)) throw new Error('eventLog: idWidth is the room of the ids, more than 0')
        this.idChars = Math.max(1, Math.floor(this.idRoom / wide('0') + 0.01))
        this.tail = wide(`to ${'0'.repeat(this.idChars)}`) + size * 0.7
        this.idRight = this.lineLeft + this.idRoom
        this.nameLeft = this.idRight + size * 0.7
        this.timeRoom = options.timeWidth ?? Math.max(0, ...all.map((entry) => (entry.time ? wide(entry.time) : 0)))
        if (!(Number.isFinite(this.timeRoom) && this.timeRoom >= 0)) throw new Error('eventLog: timeWidth is the room of the times, 0 or more')
        this.detailEnd = this.timeRoom > 0 ? this.end - this.timeRoom - gap : this.end
        this.detailChar = advance(text('n', { font: detailFont, size, anchor: 'right' }))
        const room = this.detailEnd - this.nameLeft
        const least = this.least = wide('0000') + size * 0.6
        this.gap = gap
        this.fixed = w - room
        this.given = options.nameWidth ?? null
        // The name of a fold starts after its last id, so it needs that much more room.
        this.longest = Math.max(0, ...all.map((entry) => wide(entry.name) + (entry.ids.length > 1 ? this.tail : 0)))
        if (options.nameWidth !== undefined) {
            if (!(Number.isFinite(options.nameWidth) && options.nameWidth >= least)) throw new Error(`eventLog: nameWidth is ${options.nameWidth}. It is the room of the names, ${Math.ceil(least)} px or more at this size: four characters and an ellipsis`)
            if (options.nameWidth > room) throw new Error(`eventLog: nameWidth is ${options.nameWidth}, and the panel has ${Math.floor(room)} px after the ids${this.timeRoom > 0 ? ' and before the times' : ''}. Lower \`nameWidth\`, or raise \`width\``)
            this.nameRoom = options.nameWidth
        } else {
            if (room < least) throw new Error(`eventLog: a width of ${w} leaves ${Math.max(0, Math.floor(room))} px for the names, and a name needs ${Math.ceil(least)}. Raise \`width\`, or lower \`size\``)
            // With no first row, the names get the most that they may take.
            const wanted = Math.max(least, Math.min(this.longest > 0 ? this.longest : Infinity, w * 0.6, room))
            // A list with no detail in its first rows, and little room for one, gives the whole room to the names.
            this.nameRoom = !all.some((entry) => entry.detail) && room - wanted - gap < this.detailChar * DETAIL_CHARS ? room : wanted
        }
        this.detailLeft = this.nameLeft + this.nameRoom + gap

        const head = options.title ? small * BAND : 0, foot = options.footer ? small * BAND : 0
        const padY = size * 0.4
        const h = head + foot + padY * 2 + slots * this.pitch
        const top = -h / 2
        this.first = top + head + padY + this.pitch / 2
        this.seen = this.view(0, null)
        this.frame = rect(w, h, { radius: size * 0.45, fill: 'surface', stroke: 'grid', width: border })
        this.add(this.frame)
        // A rule goes from the inside of the border at the left to the inside of the border at the right.
        const rule = (y: number) => {
            const made = line([-w / 2 + border / 2, y], [w / 2 - border / 2, y], { stroke: 'grid', width: border })
            made.set('cap', 'butt')
            this.rules.push(made)
            this.add(made)
        }
        this.title = null
        if (options.title) {
            oneLine('the title', options.title)
            this.title = this.sized('the title', text(options.title, { font, size: small, weight: 600, anchor: 'left' })).at(left, top + head / 2)
            rule(top + head)
            this.add(this.title)
        }
        const footerOf = options.footer ?? null
        this.footer = null
        this.foot = null
        if (footerOf) {
            this.footer = new Node().at(left, -top - foot / 2)
            this.foot = {
                holder: this.footer, made: new Map(), dots: null, steps: [{ time: -Infinity, count: 0, node: null }],
                say: kept((count) => {
                    const content = footerOf(count)
                    if (typeof content !== 'string') throw new Error(`eventLog: the footer for ${count} records is ${String(content)}. \`footer\` returns a text`)
                    oneLine('the footer', content)
                    return content
                }),
                make: (content) => this.sized(`the footer ${JSON.stringify(content)}`, text(content, { font, size: small, color: 'dim', anchor: 'left' })),
            }
            rule(-top - foot)
            this.add(this.footer)
        }

        // The band is under the rows, so it is the first part of the window. The outline has clear room from
        // every text, so its place among the parts changes nothing.
        const band = this.band
        this.outline = rect(w - pad * 0.8, this.pitch, band ? { radius: size * 0.3, fill: 'ink', stroke: null } : { radius: size * 0.3, stroke: 'yellow', width: stroke })
        if (band) this.outline.set('fillOpacity', BAND_FILL)
        this.outline.base.visible = false
        this.earlier = new Node().at(0, this.y(0))
        this.above = this.counter(this.earlier, (count) => (count > 0 ? `${count} earlier` : null))
        this.later = new Node().at(0, this.y(slots - 1))
        this.under = this.counter(this.later, (count) => (count > 0 ? `${count} later` : null))
        this.body.add(this.outline, this.earlier, this.later)
        this.add(this.body)
        // The list places its title, its footer, the two counts, and each row in its panel, between its rules, and in
        // its focus outline. The film check does not judge that room. A row gets the same mark when it is made.
        ownLabels(this, { name: 'event log', labels: [this.title, this.footer, this.earlier, this.later] })

        this.whole(given, true)
        for (const entry of given) this.lines.push(this.admit(entry))
        // The window starts where rows show: at the end of the list, or at the last row that shows when the
        // rows after it wait for `show()`. That row is then the last row of the window.
        const total = this.lines.length
        let last = total - 1
        while (last >= 0 && !this.lines[last]!.shown) last--
        const now = this.seen = this.view(total, last === total - 1 ? null : slots < 3 ? (last <= 0 ? 0 : null) : Math.max(0, last - (slots - 3)))
        this.pinned = total > slots && now.first < total - slots + 1 ? this.lines[now.first]! : null
        this.lines.forEach((entry, index) => {
            const inside = index >= now.first && index < now.first + now.rows
            const side = inside ? 0 : index < now.first ? -1 : 1
            entry.slot = inside ? index - now.first + now.top : null
            entry.rests = side
            entry.node.at(0, this.y(inside ? entry.slot! : side < 0 ? 0 : slots - 1))
            entry.node.base.visible = inside
            if (side !== 0) entry.sides.push({ time: -Infinity, side })
        })
        this.earlier.base.visible = now.top === 1
        this.later.base.visible = now.floor < slots - 1
        this.began = this.count
        this.recount()
    }

    /** The nodes of the lines in the window, from the top, after the changes that are scheduled so far. A fold is one node. */
    get rows(): LogRowNode[] {
        return this.lines.filter((entry) => entry.slot !== null).map((entry) => entry.node)
    }

    /**
     * The number of records that show, after the changes that are scheduled so far. A fold counts each record
     * that it holds. A row that waits for `show()` does not count.
     */
    get count(): number {
        return this.records(this.lines, 0, this.lines.length)
    }

    /** The ids of the records, in order, after the changes that are scheduled so far. */
    get ids(): Id[] {
        return this.recs.map((rec) => rec.id)
    }

    /**
     * The node of the line that shows a record, after the changes that are scheduled so far. For a record in
     * a fold, that is the line of the fold. A row that is out of the window is an error: `scrollTo()` brings it in.
     */
    row(id: Id): LogRowNode {
        return this.shown(this.rec(id)).node
    }

    /**
     * The point where a connector to a row ends: on the left or the right border of the panel, at the middle
     * height of the row, in the coordinates of the list. It is the place after the changes that are scheduled
     * so far, and it does not follow the row. For a fold, any of its ids gives the point. Defaults to the left.
     */
    p(id: Id, side: 'left' | 'right' = 'left'): [number, number] {
        return [side === 'right' ? this.w / 2 : -this.w / 2, this.y(this.shown(this.rec(id)).slot!)]
    }

    /**
     * The ids of the rows that a function picks, in the order of the list, after the changes that are
     * scheduled so far: one id for a row, and each id of a fold. So `mark(find(test), state)` changes the same
     * records as `mark(test, state)`. The function gets a row as the list shows it: with its `id`, its `ids`,
     * its `state` and its `family`. A fold is one row there. A row that waits for `show()` has `shown: false`.
     */
    find(test: (row: LogRow) => boolean): Id[] {
        return this.lines.filter((entry) => test(this.rowOf(entry))).flatMap((entry) => entry.recs.map((rec) => rec.id))
    }

    /** A copy with its own rows and its own bookkeeping, so a change of the copy does not change the list. */
    override clone(): this {
        const copy = super.clone()
        const mine = this.all(), theirs = copy.all()
        const twin = new Map<Node, Node>()
        mine.forEach((node, index) => twin.set(node, theirs[index]!))
        const lines = new Map<Line, Line>()
        // The copy is a still of the list: each line is where it is now, with no change behind it.
        const lineOf = (entry: Line): Line => {
            let made = lines.get(entry)
            if (!made) {
                const side = entry.sides[entry.sides.length - 1]?.side ?? 0
                lines.set(entry, made = { ...entry, node: twin.get(entry.node) as LogRowNode, recs: [], sides: side === 0 ? [] : [{ time: -Infinity, side }] })
            }
            return made
        }
        const recs = new Map<Rec, Rec>()
        for (const rec of this.recs) recs.set(rec, { id: rec.id, own: lineOf(rec.own), line: lineOf(rec.line), fold: rec.fold ? lineOf(rec.fold) : null })
        for (const [from, to] of lines) to.recs = from.recs.map((rec) => recs.get(rec)!)
        // A node of the copy has no key, so each text and each count line of the copy gets its own.
        const wordsOf = (words: Words): Words => {
            const made: Words = {
                ...words, holder: twin.get(words.holder)!, dots: words.dots ? twin.get(words.dots)! : null,
                made: new Map([...words.made].map(([content, node]) => [content, twin.get(node)!])), steps: [{ time: -Infinity, count: 0, node: null }],
            }
            copy.follow(made)
            return made
        }
        copy.recs = this.recs.map((rec) => recs.get(rec)!)
        copy.byId = new Map(copy.recs.map((rec) => [String(rec.id), rec]))
        copy.lines = this.lines.map(lineOf)
        copy.every = [...lines.values()]
        copy.seen = { ...this.seen }
        copy.pinned = this.pinned ? lineOf(this.pinned) : null
        copy.above = wordsOf(this.above)
        copy.under = wordsOf(this.under)
        copy.foot = this.foot ? wordsOf(this.foot) : null
        // The copy starts from the counts that the list has, and it can change its rows at any time.
        copy.began = this.count
        copy.tallies = []
        copy.last = null
        copy.recount()
        copy.focused = this.focused ? recs.get(this.focused)! : null
        copy.lit = this.lit ? lineOf(this.lit) : null
        copy.spots = this.lit ? [{ time: 0, line: lineOf(this.lit) }] : []
        copy.glows = this.lit ? [{ t0: 0, t1: 0, to: 1, ease: (share) => share }] : []
        if (this.lit) copy.wire(0)
        return copy
    }

    /** The panel, the title and the footer arrive, and then the rows of the window. */
    enter(options: AnimOptions = {}): Anim {
        timed('enter()', options)
        return {
            label: 'eventLog.enter', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'enter()')
                reveal(this, t0, ctx.stage)
                // The rows come as one, with the outline of the focus. So an `append` or a `show` in the same
                // play writes the rows, and this fade is over them all.
                for (const part of [this.frame, ...this.rules, this.title, this.footer]) {
                    if (!part) continue
                    stepAt(part, 'opacity', 0, t0)
                    part.tween('opacity', 1, t0, t0 + (t1 - t0) * 0.5, ctx.ease)
                }
                stepAt(this.body, 'opacity', 0, t0)
                this.body.tween('opacity', 1, t0 + (t1 - t0) * 0.2, t1, ctx.ease)
            },
        }
    }

    /**
     * Rows arrive at the bottom, one after another. In a full window, the oldest rows leave at the top as
     * the new ones arrive, and all rows move as one. The first line then says how many records are above.
     * `lag: 0` brings the rows of one call together, as a group. A window that `scrollTo()` moved goes back to
     * the end first. An id that the list has is an error.
     */
    append(rows: LogRow | readonly LogRow[], options: AnimOptions = {}): Anim {
        // Find a wrong row now, where the film names it. The ids are checked again when the rows arrive: an
        // append before this one in the same sequence may bring the same id.
        const given = this.checked(Array.isArray(rows) ? rows as readonly LogRow[] : [rows as LogRow])
        this.whole(given, false)
        for (const entry of given) this.fits(entry)
        const call = `append([${given.map((entry) => show(entry.ids[0]!)).join(', ')}])`
        timed(call, options)
        return {
            label: 'eventLog.append', duration: options.duration ?? (given.length === 0 ? 0 : Math.max(0.5, given.length * 0.4)), ease: options.ease,
            schedule: (ctx) => {
                if (given.length === 0) return
                const [t0, t1] = this.times(ctx, call)
                for (const entry of given) for (const id of entry.ids) this.free(id)
                const lag = options.lag ?? 1
                this.claim(call, 'append', given.length, t0, t1)
                reveal(this, t0, ctx.stage)
                // A window that the film moved goes back to the end in the first part of the time.
                let from = t0
                if (this.pinned) {
                    from = t0 + (t1 - t0) * 0.3
                    this.settle(this.lines, null, 'scroll', { out: [t0, t0], move: [t0, from], into: [t0, from], ease: ctx.ease })
                }
                const groups = lag === 0 ? [given] : given.map((entry) => [entry])
                const windows = staggered(groups.length, lag, from, t1)
                groups.forEach((group, index) => {
                    const [start, end] = windows[index]!
                    const lines = group.map((entry) => this.admit(entry))
                    this.settle([...this.lines, ...lines], null, 'below', { out: [start, start], move: [start, end], into: [start, end], ease: ctx.ease })
                    // The count follows a row when the row is half there.
                    this.tallies.push({ time: (start + end) / 2, delta: this.records(lines, 0, lines.length) })
                })
                this.recount()
            },
        }
    }

    /**
     * Rows that had their place and did not show arrive there, one after another, as the rows of `append`
     * arrive. `which` is an id, a list of ids, or a function of a row, as `mark` takes. No row moves, and the
     * window does not move: a row that is out of it changes the count of its side. The footer and the two
     * counts count the rows that show. A row that shows already does not change. With no argument, the list
     * itself shows, as any node does.
     */
    override show(): this
    override show(which: Id | readonly Id[] | ((row: LogRow) => boolean), options?: AnimOptions): Anim
    override show(which?: Id | readonly Id[] | ((row: LogRow) => boolean), options: AnimOptions = {}): this | Anim {
        if (which === undefined) return super.show()
        timed('show()', options)
        const picked = (): Line[] => {
            if (typeof which === 'function') return this.lines.filter((entry) => !entry.shown && which(this.rowOf(entry)))
            const listed = new Set((Array.isArray(which) ? which as readonly Id[] : [which as Id]).map((id) => this.rec(id, true).line))
            return this.lines.filter((entry) => !entry.shown && listed.has(entry))
        }
        // The length follows the rows that the call names now. A row that comes later in the same sequence is not in it.
        let count = 1
        try { count = Math.max(1, picked().length) } catch { /* An id that is not there yet is checked when the rows arrive. */ }
        return {
            label: 'eventLog.show', duration: options.duration ?? Math.max(0.5, count * 0.4), ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'show()')
                const chosen = picked()
                reveal(this, t0, ctx.stage)
                const windows = staggered(chosen.length, options.lag ?? 1, t0, t1)
                chosen.forEach((entry, order) => {
                    const [start, end] = windows[order]!
                    const content = entry.node.content
                    entry.shown = true
                    // The row counts from the time when it is half there: in the footer, and in the count of its side of the window.
                    entry.shownAt = (start + end) / 2
                    stepAt(content, 'y', this.pitch * RISE, start)
                    stepAt(content, 'visible', true, start)
                    content.tween('y', 0, start, end, ctx.ease)
                    this.fade(content, start, end, ctx.ease, (alpha) => alpha / 0.6)
                    this.tallies.push({ time: (start + end) / 2, delta: entry.recs.length })
                })
                this.recount()
            },
        }
    }

    /**
     * Rows change state: the color of the name cross-fades, and so does the mark at the left. `which` is an
     * id, a list of ids, or a function of a row, which the list calls when the change is scheduled. So a second
     * change in one sequence sees the states that the first one left. An id names one record. In a closed
     * fold, the record takes the state, and the fold shows the look of the record that was marked last. After
     * `unfold()`, each record has its own state. The function gets a row as `find()` gives it. A fold is one
     * row there, and a fold that it picks takes the state with all its records. A row that already has the
     * state does not change. `lag` makes the rows change one after another, in the order of the list.
     */
    mark(which: Id | readonly Id[] | ((row: LogRow) => boolean), state: string, options: AnimOptions = {}): Anim {
        const look = this.look(state)
        timed('mark()', options)
        return {
            label: 'eventLog.mark', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'mark()')
                // The lines to paint, for each line of the list: its own records, and the fold that shows them.
                const jobs = new Map<Line, Set<Line>>()
                const job = (entry: Line) => {
                    let lines = jobs.get(entry)
                    if (!lines) jobs.set(entry, lines = new Set())
                    return lines
                }
                if (typeof which === 'function') {
                    for (const entry of this.lines) {
                        if (!which(this.rowOf(entry))) continue
                        job(entry).add(entry)
                        if (entry.recs.length > 1) for (const rec of entry.recs) job(entry).add(rec.own)
                    }
                } else {
                    for (const id of Array.isArray(which) ? which as readonly Id[] : [which as Id]) {
                        const rec = this.rec(id, true)
                        job(rec.line).add(rec.own).add(rec.line)
                    }
                }
                const chosen = this.lines.flatMap((entry) => {
                    const lines = [...jobs.get(entry) ?? []].filter((part) => part.state !== state)
                    return lines.length > 0 ? [lines] : []
                })
                const windows = staggered(chosen.length, options.lag ?? 0, t0, t1)
                chosen.forEach((lines, order) => {
                    for (const part of lines) this.paint(part, state, look, windows[order]![0], windows[order]![1], ctx.ease)
                })
            },
        }
    }

    /**
     * Rows that follow each other become one line: a fold, with its first id, its last id, and a name, such
     * as "2 to 4 workflow task". The label is the name, or the fields of the row of the fold: a name, a
     * detail, a time, a state, a family. Without a state, the fold has the state of its first row. With no
     * label, a fold that `unfold()` opened closes again as it was. The fold counts as one line of the window,
     * and as its records in `count`. The ids can be in any order. Rows that do not follow each other, and a
     * row that is in a fold, are errors.
     */
    fold(ids: readonly Id[], label?: string | LogRowFields, options: AnimOptions = {}): Anim {
        if (ids.length < 2) throw new Error(`eventLog: a fold takes two rows or more, and got ${ids.length}`)
        const twice = ids.find((id, index) => ids.findIndex((other) => String(other) === String(id)) !== index)
        if (twice !== undefined) throw new Error(`eventLog: the fold names row ${show(twice)} twice`)
        const fields = label === undefined ? null : typeof label === 'string' ? { name: label } : label
        if (fields) {
            if (typeof fields.name !== 'string' || fields.name.trim() === '') throw new Error('eventLog: the fold has no name. Give a label, such as fold([2, 3, 4], \'workflow task\')')
            oneLine('the name of a fold', fields.name)
            if (fields.detail !== undefined) oneLine('the detail of a fold', String(fields.detail))
            if (fields.time !== undefined) oneLine('the time of a fold', String(fields.time))
            if (fields.state !== undefined) this.look(fields.state)
        }
        const call = `fold([${ids.map(show).join(', ')}])`
        timed(call, options)
        return {
            label: 'eventLog.fold', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const chosen = ids.map((id) => this.rec(id, true))
                for (const rec of chosen) {
                    if (rec.line !== rec.own) throw new Error(`eventLog: row ${show(rec.id)} is already in ${called(rec.line.recs.map((other) => other.id))}. Open that fold first, with unfold(${show(rec.line.recs[0]!.id)})`)
                    if (!rec.own.shown) throw new Error(`eventLog: row ${show(rec.id)} does not show yet, so it cannot go into a fold. Bring it in first, with show(${show(rec.id)})`)
                }
                const places = chosen.map((rec) => this.recs.indexOf(rec)).sort((a, b) => a - b)
                const members = this.recs.slice(places[0]!, places[places.length - 1]! + 1)
                const stray = members.find((rec) => !chosen.includes(rec))
                if (stray) throw new Error(`eventLog: the rows of a fold follow each other, and row ${show(stray.id)} is between ${show(members[0]!.id)} and ${show(members[members.length - 1]!.id)} and not in the fold. Add it, or make two folds`)
                const first = members[0]!, name = called(members.map((rec) => rec.id))
                const before = first.fold
                if (!fields && (!before || before.recs.length !== members.length || before.recs.some((rec, index) => rec !== members[index]))) {
                    throw new Error(`eventLog: ${name} needs a label, such as fold([${members.map((rec) => show(rec.id)).join(', ')}], 'workflow task'). Only a fold that unfold() opened closes with no label`)
                }
                const row: Entry | null = fields && {
                    ids: members.map((rec) => rec.id), name: fields.name, detail: fields.detail === undefined || fields.detail === '' ? undefined : String(fields.detail),
                    time: fields.time === undefined || fields.time === '' ? undefined : String(fields.time), family: fields.family, state: fields.state ?? first.own.state, shown: true, rows: null,
                }
                if (row) {
                    this.whole([row], false)
                    this.fits(row)
                }
                this.claim(call, 'fold', 1, t0, t1)
                const entry = row ? this.lineOf(row, members) : before!
                first.fold = entry
                const own = new Set(members.map((rec) => rec.own))
                const next = this.lines.flatMap((other) => (other === first.own ? [entry] : own.has(other) ? [] : [other]))
                for (const rec of members) rec.line = entry
                this.settle(next, this.kept(next), 'place', this.steps(t0, t1, ctx.ease, false))
            },
        }
    }

    /** A fold opens into its rows. `firstId` is the first id of the fold. `fold()` with the same ids closes it again. */
    unfold(firstId: Id, options: AnimOptions = {}): Anim {
        const call = `unfold(${show(firstId)})`
        timed(call, options)
        return {
            label: 'eventLog.unfold', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const entry = this.rec(firstId, true).line
                if (entry.recs.length < 2 || String(entry.recs[0]!.id) !== String(firstId)) {
                    const starts = this.lines.filter((other) => other.recs.length > 1).map((other) => show(other.recs[0]!.id))
                    throw new Error(`eventLog: no fold starts at row ${show(firstId)}. ${starts.length > 0 ? `The folds start at ${starts.join(', ')}` : 'The list has no fold'}`)
                }
                const name = called(entry.recs.map((rec) => rec.id))
                // Rows with the name of the fold would say that the fold holds six records of one kind.
                if (!entry.opens) throw new Error(`eventLog: ${name} has no rows to open into. Give it \`rows\`, one for each id, where the fold is made`)
                if (!entry.shown) throw new Error(`eventLog: ${name} does not show yet, so it cannot open. Bring it in first, with show(${show(firstId)})`)
                this.claim(call, 'unfold', 1, t0, t1)
                const next = this.lines.flatMap((other) => (other === entry ? entry.recs.map((rec) => rec.own) : [other]))
                for (const rec of entry.recs) rec.line = rec.own
                this.settle(next, this.kept(next), 'place', this.steps(t0, t1, ctx.ease, true))
            },
        }
    }

    /**
     * The window moves to a row that is out of it, and the row shows: at the top of the window for a row that
     * was above, and at its end for a row that was under. The first line says how many records are above the
     * window, and the last line says how many are under it. A row that is in the window moves nothing, so
     * such a call can play with any change. `append()` brings the window back to the end.
     */
    scrollTo(id: Id, options: AnimOptions = {}): Anim {
        const call = `scrollTo(${show(id)})`
        timed(call, options)
        return {
            label: 'eventLog.scrollTo', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const entry = this.rec(id, true).line
                // A row that shows moves nothing, so the call takes no time of the list.
                if (entry.slot !== null) return
                if (this.slots < 3) throw new Error(`eventLog: scrollTo needs a window of 3 lines or more: one for each count, and one for the row. This window has ${this.slots}. Raise \`visible\``)
                this.claim(call, 'scrollTo', 1, t0, t1)
                const at = this.lines.indexOf(entry)
                // A row that was above is the first row of the window. A row that was under is its last row,
                // over the count of the rows that are still under it.
                const want = at < this.seen.first ? at : at - (this.slots - 3)
                this.settle(this.lines, Math.max(0, want), 'scroll', { out: [t0, t0], move: [t0, t1], into: [t0, t1], ease: ctx.ease })
            },
        }
    }

    /**
     * The outline goes to a row, and stays there until the next `focus`. `focus(null)` takes it away. The
     * outline is with its row at every frame: it moves with a row that scrolls, arrives with a row that
     * arrives, and leaves with a row that leaves the window. On its way to another row it fades out at the
     * first and comes in at the second, so it does not cross the text of the rows between the two. Each call
     * takes the place of the outline and how much of it shows back from its time on, whatever the film did
     * to the node `outline` before. A `leading` that is too small for the outline is an error here.
     */
    focus(id: Id | null, options: AnimOptions = {}): Anim {
        timed('focus()', options)
        if (id !== null && !this.band && this.pitch < this.needs - 1e-6) {
            throw new Error(`eventLog: a leading of ${short(this.pitch / this.size)} leaves the outline of the focus too little room. The outline needs ${CLEAR} of the text size between its line and the ink of the rows: a leading of ${Math.ceil(this.needs / this.size * 100) / 100} or more. Take that, or \`focusLook: 'band'\``)
        }
        return {
            label: 'eventLog.focus', duration: options.duration ?? 0.4, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'focus()')
                if (id === null) {
                    this.wire(t0)
                    // The outline stays with its row while it fades, so a scroll in the same play takes it along.
                    if (this.lit) this.glows.push({ t0, t1, to: 0, ease: ctx.ease })
                    this.focused = this.lit = null
                    return
                }
                const rec = this.rec(id, true), entry = this.shown(rec, true)
                this.wire(t0)
                if (!this.lit) {
                    // After a `focus(null)` in the same play, the outline comes in at the new row from nothing.
                    this.glows.push({ t0, t1: t0, to: 0, ease: ctx.ease })
                    this.attach(entry, t0)
                    this.glows.push({ t0, t1, to: 1, ease: ctx.ease })
                } else if (entry !== this.lit) {
                    const middle = (t0 + t1) / 2
                    this.glows.push({ t0, t1: middle, to: 0, ease: ctx.ease })
                    this.attach(entry, middle)
                    this.glows.push({ t0: middle, t1, to: 1, ease: ctx.ease })
                }
                this.focused = rec
                this.lit = entry
            },
        }
    }

    /** The y of the middle of a line of the window. */
    private y(slot: number): number {
        return this.first + slot * this.pitch
    }

    /**
     * The window over a number of lines. `first` is the line that the film wants as the first row, or null for
     * a window at the end of the list. A window with lines above it gives its first line to their count, and a
     * window with lines under it gives its last line to theirs.
     */
    private view(lines: number, first: number | null): View {
        const all = this.slots
        if (lines <= all) return { first: 0, rows: lines, top: 0, floor: all - 1 }
        const end = lines - all + 1
        if (first === null || first >= end) return { first: end, rows: all - 1, top: 1, floor: all - 1 }
        const start = Math.max(0, first), top = start > 0 ? 1 : 0
        return { first: start, rows: all - top - 1, top, floor: all - 2 }
    }

    /** The first row that the window keeps after a fold or an unfold: the line that shows the record that was first. */
    private kept(next: readonly Line[]): number | null {
        return this.pinned ? next.indexOf(this.pinned.recs[0]!.line) : null
    }

    /** The records that show in some lines of a list: what a count says. */
    private records(lines: readonly Line[], from: number, to: number): number {
        let sum = 0
        for (let index = from; index < to; index++) if (lines[index]!.shown) sum += lines[index]!.recs.length
        return sum
    }

    /** The times of an animation. A time that is not a number would write keys that no frame finds. */
    private times(ctx: AnimContext, call: string): [number, number] {
        if (!(Number.isFinite(ctx.t0) && Number.isFinite(ctx.t1) && ctx.t1 >= ctx.t0)) throw new Error(`eventLog: ${call} plays from ${String(ctx.t0)} to ${String(ctx.t1)}. Give the play a duration that is a number, 0 or more`)
        return [ctx.t0, ctx.t1]
    }

    /**
     * Take the time of a change of the rows. Each change writes the way of the rows from the places that the
     * change before it left. Two changes at one time would each write a way, and the picture would follow
     * neither. So a change that starts before the last one is over is refused, with the advice that fits the
     * two calls and keeps the pace of the film.
     */
    private claim(call: string, kind: Change, rows: number, t0: number, t1: number): void {
        const last = this.last
        if (last && t0 < last.t1 - SOON) {
            const gap = t0 - last.t0, took = last.t1 - last.t0, appends = kind === 'append' && last.kind === 'append'
            const advice = gap < -SOON
                ? `The list takes the changes of its rows in the order of time, and the film calls ${last.call} first. Call ${call} before it`
                : gap <= SOON
                    ? (appends ? 'Give one `append` all the rows. With `lag: 0`, they arrive together' : 'Play the two in a `seq`: each then has its share of the time of the play')
                    : appends && rows === 1 && last.rows === 1 && Math.abs(t1 - t0 - took) <= SOON
                        ? `Give one \`append\` all the rows, with \`{ lag: ${short(gap / took)}, duration: ${short(took)} + ${short(gap)} * (rows - 1) }\`. Each row then takes ${seconds(took)} and starts ${seconds(gap)} after the row before it, as here`
                        : `${last.call} takes ${seconds(took)}, and ${call} starts ${seconds(gap)} after it. Give ${last.call} a \`duration\` of ${short(gap)} or less, or play the two in a \`seq\``
            throw new Error(`eventLog: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. The list changes its rows one change at a time: a change starts when the change before it is over. ${advice}`)
        }
        this.last = { call, kind, rows, t0, t1 }
    }

    private look(state: string): Look {
        const look = this.looks.get(state)
        if (!look) throw new Error(`eventLog: no state ${JSON.stringify(state)}. The states are ${this.names.join(', ')}`)
        return look
    }

    /**
     * The record of an id. `played` is for a call that the film plays: the list takes the calls of one play
     * in their order, so an `append` that brings the row must come before the call that names it.
     */
    private rec(id: Id, played = false): Rec {
        const rec = this.byId.get(String(id))
        if (rec) return rec
        const count = this.recs.length
        throw new Error(`eventLog: no row has the id ${show(id)}. ${count === 0 ? 'The list is empty' : count === 1 ? `The list has one row, ${show(this.recs[0]!.id)}` : `The list has the ids ${show(this.recs[0]!.id)} to ${show(this.recs[count - 1]!.id)}`}${played ? '. When an `append` in the same play brings the row, name the `append` before this call: the list takes the calls of a play in their order' : ''}`)
    }

    /** The line that shows a record in the window. */
    private shown(rec: Rec, played = false): Line {
        const entry = rec.line
        if (entry.slot !== null) return entry
        const open = this.lines.filter((other) => other.slot !== null)
        const last = open[open.length - 1]?.recs
        const window = last ? `which shows the rows ${show(open[0]!.recs[0]!.id)} to ${show(last[last.length - 1]!.id)}` : 'which has no row'
        throw new Error(`eventLog: row ${show(rec.id)} is out of the window, ${window}. Bring it in with scrollTo(${show(rec.id)})${played ? ', named before this call in the play' : ''}, or raise \`visible\``)
    }

    /** A line as a function of `find()`, `mark()` or `show()` gets it. */
    private rowOf(entry: Line): LogRow {
        return {
            id: entry.recs[0]!.id, ids: entry.recs.map((rec) => rec.id), name: entry.name, state: entry.state,
            ...(entry.detail !== undefined ? { detail: entry.detail } : {}), ...(entry.time !== undefined ? { time: entry.time } : {}), ...(entry.family !== undefined ? { family: entry.family } : {}),
            ...(entry.shown ? {} : { shown: false }),
        }
    }

    /** The rows as the list keeps them: each with its ids and its state, and no id that is there twice. */
    private checked(rows: readonly LogRow[]): Entry[] {
        const seen = new Set<string>()
        const valid = (id: unknown) => (typeof id === 'number' ? Number.isFinite(id) : typeof id === 'string' && id.trim() !== '')
        // A number is taken as its text: a count, an attempt, a time in seconds.
        const worded = (what: string, value: unknown): string | undefined => {
            if (value === undefined || value === null || value === '') return undefined
            if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`eventLog: ${what} is ${JSON.stringify(value) ?? String(value)}. Give a text or a number`)
            const made = String(value)
            oneLine(what, made)
            return made
        }
        const one = (row: LogRow, fold: Entry | null): Entry => {
            const ids = row.ids ? [...row.ids] : row.id !== undefined ? [row.id] : []
            if (ids.length === 0) throw new Error('eventLog: a row has no id. Give it an `id`, or the `ids` that it stands for')
            const wrong = [row.id, ...ids].find((id) => id !== undefined && !valid(id))
            if (wrong !== undefined) throw new Error(`eventLog: the id of a row is ${JSON.stringify(wrong) ?? String(wrong)}. An id is a number or a text`)
            if (row.id !== undefined && String(row.id) !== String(ids[0])) throw new Error(`eventLog: a row has the id ${show(row.id)}, and its ids start at ${show(ids[0]!)}. The id of a fold is the first of its ids`)
            const who = called(ids)
            if (fold && ids.length > 1) throw new Error(`eventLog: ${who} is a row of ${called(fold.ids)}. A row of a fold has one id`)
            for (const id of ids) {
                // An id is known by its text, so 7 and '7' are one id.
                const key = String(id)
                oneLine(`the id ${show(id)}`, key)
                if (fold) continue
                if (seen.has(key)) throw new Error(`eventLog: two rows have the id ${show(id)}. Give each row its own id`)
                seen.add(key)
                this.free(id)
            }
            if (typeof row.name !== 'string' || row.name.trim() === '') throw new Error(`eventLog: ${who} has no name`)
            oneLine(`the name of ${who}`, row.name)
            const state = row.state ?? fold?.state ?? this.names[0]!
            if (!this.looks.has(state)) throw new Error(`eventLog: ${who} has the state ${JSON.stringify(state)}. The states are ${this.names.join(', ')}`)
            const entry: Entry = {
                ids, name: row.name, detail: worded(`the detail of ${who}`, row.detail), time: worded(`the time of ${who}`, row.time),
                family: row.family ?? fold?.family, state, shown: fold ? true : row.shown !== false, rows: null,
            }
            const inner = 'rows' in row ? row.rows : undefined
            if (ids.length === 1) {
                if (inner) throw new Error(`eventLog: ${who} has \`rows\`, and one id. Give it the \`ids\` that it stands for`)
                return entry
            }
            if (inner) {
                const theirs = inner.map((member) => String(member.id ?? member.ids?.[0]))
                if (theirs.length !== ids.length || theirs.some((id, index) => id !== String(ids[index]))) throw new Error(`eventLog: ${who} has the ids ${ids.map(show).join(', ')}, and its rows have the ids ${theirs.join(', ')}. Give one row for each id, in order`)
                entry.rows = inner.map((member) => one(member, entry))
            }
            return entry
        }
        return rows.map((row) => one(row, null))
    }

    private free(id: Id): void {
        if (this.byId.has(String(id))) throw new Error(`eventLog: the list already has a row with the id ${show(id)}. Give each row its own id`)
    }

    /**
     * An id and a time show whole, or the row is refused: a part of an id names another row, and a part of a
     * time is another time. A detail needs room for eight characters: a detail of four tells nothing.
     */
    private fits(entry: Entry): void {
        const wide = (content: string) => advance(text(content, { font: 'mono', size: this.size, anchor: 'right' }))
        for (const row of [entry, ...(entry.rows ?? [])]) {
            for (const id of row.ids) {
                const needs = wide(String(id))
                if (needs > this.idRoom + 0.5) throw new Error(`eventLog: the id ${show(id)} is ${Math.ceil(needs)} px wide, and the ids have ${Math.floor(this.idRoom)} px. Set \`idWidth\` to ${Math.ceil(needs)} or more`)
            }
            if (row.detail !== undefined) {
                const room = this.detailEnd - this.detailLeft, needs = this.detailChar * DETAIL_CHARS
                if (room < needs - 0.5) {
                    const fewer = this.nameRoom - (needs - room)
                    throw new Error(`eventLog: the details have room for ${Math.max(0, Math.floor(room / this.detailChar))} characters, and ${called(row.ids)} has a detail. A detail needs room for ${DETAIL_CHARS}. Raise \`width\` to ${this.widthFor(needs - 0.5)} or more${fewer >= this.least ? `, or set \`nameWidth\` to ${Math.floor(fewer)} or less` : ''}`)
                }
            }
            if (!row.time) continue
            const needs = wide(row.time)
            if (this.timeRoom === 0) throw new Error(`eventLog: ${called(row.ids)} has the time ${JSON.stringify(row.time)}, and the list has no column for times. Give a time to one of the first rows, or set \`timeWidth\` to ${Math.ceil(needs)} or more`)
            if (needs > this.timeRoom + 0.5) throw new Error(`eventLog: the time ${JSON.stringify(row.time)} is ${Math.ceil(needs)} px wide, and the times have ${Math.floor(this.timeRoom)} px. Set \`timeWidth\` to ${Math.ceil(needs)} or more`)
        }
    }

    /**
     * With `ellipsis: false`, every name and every detail shows whole. One error lists each text that does not
     * fit, and names the `nameWidth` and the `width` that fit them all, so a film changes its numbers once.
     * `first` is for the rows that the list is made with: the width is what these rows need. For rows that
     * come later, no column gets smaller, because the rows that the list has must still fit.
     */
    private whole(entries: readonly Entry[], first: boolean): void {
        if (this.cut) return
        const { size } = this
        const wide = (content: string, font: TextOptions['font']) => reach(text(content, { font, size, anchor: 'left' }))
        const column = this.nameRoom, room = this.detailEnd - this.detailLeft, has = this.detailEnd - this.nameLeft, least = this.detailChar * DETAIL_CHARS
        const tight: string[] = []
        let names = 0, alone = 0, details = 0, cramped = false
        for (const row of entries.flatMap((entry) => [entry, ...(entry.rows ?? [])])) {
            const who = called(row.ids), tail = row.ids.length > 1 ? this.tail : 0
            const name = wide(row.name, 'mono')
            if (row.detail === undefined) {
                // A row with no detail has no next column, so its name may go on to the end of the details.
                alone = Math.max(alone, name + tail)
                if (name + tail > has) tight.push(`the name of ${who} (${Math.ceil(name)} px, and it has ${Math.max(0, Math.floor(has - tail))})`)
                continue
            }
            const detail = wide(row.detail, this.detailFont)
            names = Math.max(names, name + tail)
            details = Math.max(details, detail, least)
            if (name + tail > column) tight.push(`the name of ${who} (${Math.ceil(name)} px, and it has ${Math.max(0, Math.floor(column - tail))})`)
            if (detail > room) {
                cramped = true
                tight.push(`the detail of ${who} (${Math.ceil(detail)} px, and the details have ${Math.max(0, Math.floor(room))})`)
            }
        }
        // A detail needs room for eight characters, also when each detail of these rows is shorter.
        const few = details > 0 && !cramped && room < least - 0.5
        if (tight.length === 0 && !few) return
        // The film sets `nameWidth` when a name needs more room, and when the room that the list takes by
        // itself would change with the width.
        const set = names > column || (details > 0 && this.given === null && Math.abs(column - this.longest) > 0.01)
        const nameWidth = set ? Math.ceil(Math.max(column, names)) : column
        const columns = details > 0 ? nameWidth + this.gap + (first ? details : Math.max(details, room)) : 0
        const width = Math.max(Math.ceil(this.fixed + Math.max(columns, alone)), first ? 0 : this.w)
        const listed = tight.length > 6 ? `${tight.slice(0, 6).join(', ')}, and ${tight.length - 6} more` : tight.join(', ')
        const advice = set && width > this.w ? `Set \`nameWidth\` to ${nameWidth} and \`width\` to ${width} or more` : set ? `Set \`nameWidth\` to ${nameWidth}` : `Raise \`width\` to ${width} or more`
        const texts = tight.length === 0 ? '' : `, and ${tight.length === 1 ? 'one text does' : `${tight.length} texts do`} not fit: ${listed}`
        const rule = few ? ` The details have room for ${Math.max(0, Math.floor(room / this.detailChar))} characters, and a detail needs ${DETAIL_CHARS}.` : ''
        throw new Error(`eventLog: with \`ellipsis: false\`, a name and a detail show whole${texts}.${rule} ${advice}`)
    }

    /**
     * The least width of the panel that gives the details a room, with the names as the list sets them. More
     * width also gives more to the names while they are cut, so the answer is not the width plus what is missing.
     */
    private widthFor(needs: number): number {
        for (let width = Math.ceil(this.w); ; width++) {
            const room = width - this.fixed
            const taken = this.given ?? Math.max(this.least, Math.min(this.longest > 0 ? this.longest : Infinity, width * 0.6, room))
            if (room - taken - this.gap >= needs) return width
        }
    }

    /** A text of the title or the footer, which must fit the panel whole: the film wrote it. */
    private sized(what: string, made: Node): Node {
        const room = this.end + this.w / 2 - this.size * 0.8
        if (reach(made) > room + 0.5) throw new Error(`eventLog: ${what} is ${Math.ceil(reach(made))} px wide, and the panel has ${Math.floor(room)} px. Use a shorter text, or raise \`width\``)
        return made
    }

    /** Three small dots, one over the other: this line stands for several records. */
    private dots(color: ColorInput): Node {
        const made = new Node()
        for (const step of [-1, 0, 1]) made.add(dot(this.size * 0.065, color).at(0, step * this.size * 0.23))
        return made
    }

    /** The mark of a state. A dot is the mark of a state that gives none, and a fold with a dot has three small dots. */
    private shape(kind: MarkShape, paint: Paint, folded: boolean): Node {
        const r = this.size * 0.2, width = Math.max(1.5, this.size * 0.085)
        const made = kind === 'ring' ? circle(r - width / 2, { stroke: paint, width })
            : kind === 'check' ? polyline([[-r, r * 0.05], [-r * 0.3, r * 0.75], [r, -r * 0.7]], { stroke: paint, width })
                : kind === 'cross' ? svgPath(`M${-r * 0.85} ${-r * 0.85}L${r * 0.85} ${r * 0.85}M${-r * 0.85} ${r * 0.85}L${r * 0.85} ${-r * 0.85}`, { stroke: paint, width })
                    : folded ? this.dots(paint) : dot(this.size * 0.17, paint)
        made.data['shape'] = kind
        return made
    }

    /**
     * A line takes the look of a state: the color of its name cross-fades, and so does its mark. A mark of
     * another shape comes in as the old one goes.
     */
    private paint(entry: Line, state: string, look: Look, t0: number, t1: number, ease: Ease): void {
        const node = entry.node, was = this.look(entry.state)
        const holder = node.mark
        const tint = (made: Node, time: number | null) => {
            for (const leaf of made.leaves()) {
                const prop = leaf.get('fill') ? 'fill' : 'stroke'
                if (time === null) leaf.tween(prop, look.paint, t0, t1, ease)
                else stepAt(leaf, prop, look.paint, time)
            }
        }
        entry.state = state
        for (const glyph of node.name.children) glyph.tween('fill', look.paint, t0, t1, ease)
        const old = holder.children.find((child) => child.data['shape'] === was.mark)!
        if (look.mark === was.mark) {
            tint(old, null)
        } else {
            let next = holder.children.find((child) => child.data['shape'] === look.mark)
            if (!next) {
                next = this.shape(look.mark, look.paint, entry.recs.length > 1)
                next.base.visible = false
                holder.add(next)
            }
            tint(next, t0)
            stepAt(next, 'opacity', 0, t0)
            stepAt(next, 'visible', true, t0)
            next.tween('opacity', 1, t0, t1, ease)
            old.tween('opacity', 0, t0, t1, ease)
            stepAt(old, 'visible', false, t1)
        }
        if (look.dim !== was.dim) for (const part of node.parts) part.tween('opacity', look.dim ? DIM : 1, t0, t1, ease)
    }

    /** Make the line of a row or of a fold, with a record for each id, and put its nodes in the list. It is not in the window yet. */
    private admit(entry: Entry): Line {
        this.fits(entry)
        for (const id of entry.ids) this.free(id)
        // A fold with no rows of its own still has a record for each id: the list counts them, and `p()` finds them.
        const inner: Entry[] = entry.ids.length === 1 ? [entry] : entry.rows ?? entry.ids.map((id) => ({ ...entry, ids: [id], detail: undefined, time: undefined, shown: true, rows: null }))
        const recs = inner.map((row) => {
            const rec = { id: row.ids[0]!, fold: null } as Rec
            rec.own = rec.line = this.lineOf(row, [rec])
            this.recs.push(rec)
            this.byId.set(String(rec.id), rec)
            return rec
        })
        if (entry.ids.length === 1) return recs[0]!.own
        const fold = this.lineOf(entry, recs)
        fold.opens = entry.rows !== null
        for (const rec of recs) rec.line = fold
        recs[0]!.fold = fold
        return fold
    }

    /** A name or a detail in its room. With `ellipsis: false`, `whole()` has refused each text that does not fit before this. */
    private fit(content: string, room: number, options: TextOptions): Node | null {
        const whole = text(content, { ...options, anchor: 'left' })
        if (reach(whole) <= room) return whole
        // The text is cut, with an ellipsis after the part that stays, so it never runs into the next column.
        // One character at least stays: an ellipsis alone tells nothing.
        const chars = [...content]
        let low = 1, high = chars.length - 1, best: Node | null = null
        while (low <= high) {
            const middle = (low + high) >> 1
            const cut = text(chars.slice(0, middle).join('').trimEnd() + ELLIPSIS, { ...options, anchor: 'left' })
            if (reach(cut) <= room) {
                best = cut
                low = middle + 1
            } else {
                high = middle - 1
            }
        }
        return best
    }

    /** The line of a row with one record, or of a fold over several. */
    private lineOf(row: Entry, recs: Rec[]): Line {
        const { size } = this
        const look = this.look(row.state), folded = recs.length > 1
        const ids = recs.map((rec) => rec.id), who = called(ids)
        const mark = new Node().at(this.markX, 0)
        mark.add(this.shape(look.mark, look.paint, folded))
        const idText = text(String(ids[0]), { font: 'mono', size, color: 'dim', anchor: 'right' }).at(this.idRight, 0)
        // The last id of a fold ends where the longest id would end, so the names of all folds start at one x.
        const range = folded ? text(`to ${String(ids[ids.length - 1]).padStart(this.idChars)}`, { font: 'mono', size, color: 'dim', anchor: 'left' }).at(this.nameLeft, 0) : null
        const start = this.nameLeft + (folded ? this.tail : 0)
        const time = row.time ? text(row.time, { font: 'mono', size, color: 'dim', anchor: 'right' }).at(this.end, 0) : null
        // A row with no detail has no next column, so its name may go on to the end of the details. The name
        // of a fold starts after its last id. In a list of short names, that leaves it no room in the column
        // of the names: then it takes the room that it needs, and its detail comes after it.
        const column = this.nameLeft + this.nameRoom
        const gap = this.detailLeft - column
        const least = this.detailChar * DETAIL_CHARS
        const tight = row.detail !== undefined && column - start < this.least
        const room = (row.detail === undefined ? this.detailEnd : tight ? this.detailEnd - gap - least : column) - start
        const name = this.fit(row.name, room, { font: 'mono', size, color: look.paint })
        if (!name) throw new Error(`eventLog: the panel has no room for the name of ${who}. Raise \`width\`, or lower \`size\``)
        const after = tight ? Math.max(this.detailLeft, start + reach(name) + gap) : this.detailLeft
        const detail = row.detail === undefined ? null : this.fit(row.detail, this.detailEnd - after, { font: this.detailFont, size, color: 'dim' })
        const node = new LogRowNode(mark, idText, range, name.at(start, 0), detail?.at(after, this.detailDrop) ?? null, time)
        if (look.dim) for (const part of node.parts) part.base.opacity = DIM
        // A line is hidden until the window has a place for it. On the stage, a node that is added shows from the time of the call.
        node.base.visible = false
        if (!row.shown) node.content.base.visible = false
        ownLabels(this, { labels: [node] })
        this.body.add(node)
        const made: Line = { node, recs, name: row.name, detail: row.detail, time: row.time, family: row.family, state: row.state, shown: row.shown, opens: true, slot: null, rests: 0, shownAt: row.shown ? -Infinity : Infinity, sides: [] }
        this.every.push(made)
        return made
    }

    /** The words of a count line: three small dots and a text. Both show while the count is not 0. */
    private counter(holder: Node, say: (count: number) => string | null): Words {
        const dots = this.dots('dim').at(this.markX, 0)
        dots.base.visible = false
        holder.base.visible = false
        holder.add(dots)
        const made: Words = {
            holder, made: new Map(), say, dots, steps: [{ time: -Infinity, count: 0, node: null }],
            make: (content) => text(content, { font: this.font, size: Math.min(this.small, this.size), color: 'dim', anchor: 'left' }).at(this.lineLeft, this.countDrop),
        }
        this.follow(made)
        return made
    }

    /** The count of a holder at a time, with its text. */
    private stepOf(words: Words, time: number): Words['steps'][number] {
        const steps = words.steps
        let low = 0, high = steps.length - 1
        while (low < high) {
            const middle = (low + high + 1) >> 1
            if (steps[middle]!.time <= time) low = middle
            else high = middle - 1
        }
        return steps[low]!
    }

    /**
     * Give the texts of a holder keys that read the count at every frame. So a text shows while the count
     * has its value, whatever wrote the count and in whatever order: an `append`, a `show`, a scroll.
     */
    private follow(words: Words): void {
        for (const node of words.made.values()) this.bind(words, node)
        words.dots?.track('visible').add(always((time) => this.stepOf(words, time).count !== 0, false))
    }

    private bind(words: Words, node: Node): void {
        node.track('visible').add(always((time) => this.stepOf(words, time).node === node, false))
    }

    /** Write a count over time from its changes, and make the text of each value that it takes. */
    private write(words: Words, start: number, changes: [number, number][]): void {
        changes.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        const counts = [{ time: -Infinity, count: start }]
        for (const [time, delta] of changes) {
            const last = counts[counts.length - 1]!
            if (time === last.time) last.count += delta
            else counts.push({ time, count: last.count + delta })
        }
        words.steps = counts.map(({ time, count }) => {
            const content = words.say(count)
            if (content === null) return { time, count, node: null }
            let node = words.made.get(content)
            if (!node) {
                node = words.make(content)
                node.base.visible = false
                words.made.set(content, node)
                words.holder.add(node)
                this.bind(words, node)
            }
            return { time, count, node }
        })
    }

    /**
     * Write the three counts over time: the records above the window, the records under it, and the records
     * of the footer. A record counts while it shows. A `show()` may overlap a change of the rows, so each
     * count is written from all its changes in the order of time, and not change by change.
     */
    private recount(): void {
        for (const [words, side] of [[this.above, -1], [this.under, 1]] as const) {
            const changes: [number, number][] = []
            for (const entry of this.every) {
                const sides = entry.sides, records = entry.recs.length
                for (let index = 0; index < sides.length; index++) {
                    if (sides[index]!.side !== side) continue
                    const from = Math.max(sides[index]!.time, entry.shownAt), to = sides[index + 1]?.time ?? Infinity
                    if (from >= to) continue
                    changes.push([from, records])
                    if (to < Infinity) changes.push([to, -records])
                }
            }
            this.write(words, 0, changes)
        }
        if (this.foot) this.write(this.foot, this.began, this.tallies.map((tally): [number, number] => [tally.time, tally.delta]))
    }

    /** A line is on a side of the window from a time: -1 above, 1 under, 0 in the window or out of the list. */
    private turn(entry: Line, side: number, time: number): void {
        const sides = entry.sides
        if ((sides[sides.length - 1]?.side ?? 0) !== side) sides.push({ time, side })
    }

    /**
     * The times of a fold or an unfold: lines go, the others move, and lines come. No two texts share a place
     * at one time. The line of a fold comes where its rows were, as soon as they are gone. The rows of an
     * unfold come where other rows pass, so they wait for those rows.
     */
    private steps(t0: number, t1: number, ease: Ease, opens: boolean): Step {
        const span = t1 - t0
        return { out: [t0, t0 + span * 0.3], move: [t0 + span * 0.15, t0 + span * 0.75], into: opens ? [t0 + span * 0.6, t1] : [t0 + span * 0.3, t0 + span * 0.8], ease }
    }

    /** How much of a line shows at a y: all of it in the window, and none of it a part of a row past the first or the last row. */
    private near(y: number, view: View): number {
        const slot = (y - this.first) / this.pitch
        const past = Math.max(view.top - slot, slot - view.floor)
        return clamp(1 - (past - 0.05) / (EDGE - 0.05))
    }

    /**
     * Move a node to a y, and show it by its place at every frame: a line that leaves the window fades as it
     * goes, and a line that comes fades in as it arrives. `gate` holds it back by the share of the way.
     * Without a gate, a line that is still arriving goes on from the opacity that it has. `side` is the side
     * of the window that the line is out of, at one end of its way: -1 above, 1 under. Its node then goes no
     * further than the line of the count on that side. The line does not show there, so the picture is the
     * same, and a connector to the node ends inside the panel at every frame.
     */
    private slide(node: Node, to: number, view: View, t0: number, t1: number, ease: Ease, gate?: (alpha: number) => number, side = 0, start?: number): void {
        const from = start ?? sampleAt(node, 'y', t0)
        const first = this.near(from, view)
        const held = first > 0 ? clamp(sampleAt(node, 'opacity', t0) / first) : 1
        const open = gate ?? ((alpha: number) => held + (1 - held) * alpha / 0.6)
        const shows = (alpha: number) => this.near(from + (to - from) * alpha, view) * clamp(open(alpha))
        if (side === 0) {
            node.tween('y', to, t0, t1, ease)
        } else {
            const limit = this.y(side < 0 ? 0 : this.slots - 1)
            const place = (alpha: number) => (side < 0 ? Math.max(limit, from + (to - from) * alpha) : Math.min(limit, from + (to - from) * alpha))
            node.track('y').add({ t0, t1, ease, to: place(1), at: place })
        }
        node.track('opacity').add({ t0, t1, ease, to: shows(1), at: shows })
    }

    /**
     * Move a line that stays in the window. A line that is still arriving, from a step of the same `append`,
     * keeps the fade of its place on its new way. Any other line keeps the opacity that it has.
     */
    private carry(node: Node, to: number, view: View, t0: number, t1: number, ease: Ease): void {
        if ((node.tracks?.get('opacity')?.end ?? -Infinity) > t0) this.slide(node, to, view, t0, t1, ease)
        else node.tween('y', to, t0, t1, ease)
    }

    /** Show a node by the share of the way of the rows that move with it, so that it follows their ease. */
    private fade(node: Node, t0: number, t1: number, ease: Ease, shows: (alpha: number) => number): void {
        node.track('opacity').add({ t0, t1, ease, to: clamp(shows(1)), at: (alpha) => clamp(shows(alpha)) })
    }

    /**
     * A line that is out of the window rests on the line of the count that stands for it: the first line for
     * a row above, the last line for a row under. So a connector to its node ends on that count, inside the
     * panel, and not on another row.
     */
    private rest(entry: Line, place: number, view: View, time: number, moved: boolean): void {
        const side = place < view.top ? -1 : 1
        if (!moved && entry.rests === side) return
        entry.rests = side
        stepAt(entry.node, 'y', this.y(side < 0 ? 0 : this.slots - 1), time)
    }

    /**
     * The line of a count comes or goes with the rows that move. It shares its line with no row, with any
     * ease: it comes in the second half of the way of the rows, when the rows that had its line are gone. It
     * goes in the first third, before a row comes back there.
     */
    private tell(words: Words, was: boolean, now: boolean, m0: number, m1: number, ease: Ease): void {
        const holder = words.holder
        if (!was && now) {
            stepAt(holder, 'visible', true, m0)
            this.fade(holder, m0, m1, ease, (alpha) => (alpha - 0.5) / 0.5)
        } else if (was && !now) {
            this.fade(holder, m0, m1, ease, (alpha) => 1 - alpha / 0.35)
            stepAt(holder, 'visible', false, m1)
        }
    }

    /** Put the outline on a line from a time. */
    private attach(entry: Line, time: number): void {
        this.spots.push({ time, line: entry })
    }

    /** The line that the outline is on at a time: the last call that has started wins, so it also wins over what an earlier call planned for later. */
    private spot(time: number): Line | null {
        for (let index = this.spots.length - 1; index >= 0; index--) if (this.spots[index]!.time <= time + SOON) return this.spots[index]!.line
        return null
    }

    /** The strength of the outline at a time, before the row has its say. */
    private strength(time: number, upTo = this.glows.length - 1): number {
        for (let index = upTo; index >= 0; index--) {
            const glow = this.glows[index]!
            if (time < glow.t0 - SOON) continue
            if (time >= glow.t1 - SOON) return glow.to
            const from = this.strength(glow.t0, index - 1)
            return from + (glow.to - from) * glow.ease((time - glow.t0) / (glow.t1 - glow.t0))
        }
        return 0
    }

    /** How much of the outline shows at a time: its own strength, and how much of its row is there. */
    private showing(time: number): number {
        const entry = this.spot(time)
        if (!entry) return 0
        const node = entry.node, content = node.content
        const row = (readAt(node, 'visible', time) ? readAt(node, 'opacity', time) : 0) * (readAt(content, 'visible', time) ? readAt(content, 'opacity', time) : 0)
        return this.strength(time) * row
    }

    /**
     * Give the outline keys that read its row at every frame, from a time on. So the outline is where its
     * row is, and shows as much as its row does, whatever moves the row and whenever that was scheduled:
     * before the focus, in the same play, or after it. Each `focus` writes the keys again from its time, so
     * they win over what the film did to the node before.
     */
    private wire(from: number): void {
        const outline = this.outline
        outline.track('y').add(always((time) => {
            const entry = this.spot(time)
            return entry ? readAt(entry.node, 'y', time) + readAt(entry.node.content, 'y', time) + this.lift : 0
        }, 0, from))
        outline.track('opacity').add(always((time) => this.showing(time), 0, from))
        outline.track('visible').add(always((time) => this.showing(time) > 0, false, from))
    }

    /**
     * Give the list new lines, or move its window, and write the keys that take the picture from the old
     * lines to the new ones. Lines that stay move together, by the same distance in the same time, so no row
     * jumps. `want` is the line that the window starts at, or null for a window at the end. `arrive` says how
     * a new line comes: from below, with the rows that scroll, or in its place. A scroll has no new line.
     */
    private settle(next: Line[], want: number | null, arrive: 'below' | 'place' | 'scroll', step: Step): void {
        const before = this.lines, was = this.seen
        const now = this.view(next.length, want)
        const index = new Map(before.map((entry, at) => [entry, at] as const))
        const stays = new Set(next)
        const [m0, m1] = step.move, ease = step.ease
        // In a scroll, no line goes further than the height of the window. So on a long way the old rows
        // are still leaving by one side when the rows of the new window come by the other, and the window
        // is never empty. The rows between the two do not show.
        const travel = (rows: number) => (arrive === 'scroll' ? Math.max(-this.slots, Math.min(this.slots, rows)) : rows)

        for (const entry of before) {
            if (stays.has(entry)) continue
            if (entry.slot !== null) {
                entry.node.tween('opacity', 0, step.out[0], step.out[1], ease)
                stepAt(entry.node, 'visible', false, step.out[1])
            }
            entry.slot = null
        }
        // How far the last row before the new ones is from its new place when the move starts. A new row
        // comes from that far under its own place, so the old rows and the new ones move as one. The place
        // is read at the time of the move: a row can still be on its way from the step before this one.
        let lead = 0
        next.forEach((entry, at) => {
            const place = at - now.first + now.top
            const inside = at >= now.first && at < now.first + now.rows
            const from = entry.slot, old = index.get(entry)
            const node = entry.node
            entry.slot = inside ? place : null
            if (inside) entry.rests = 0
            if (old !== undefined && from !== null) lead = sampleAt(node, 'y', m0) - this.y(place)
            if (old === undefined) {
                if (arrive === 'place') {
                    // A row of an unfold that has no place in the window stays out.
                    if (!inside) {
                        this.rest(entry, place, now, step.into[0], true)
                        return
                    }
                    stepAt(node, 'y', this.y(place), step.into[0])
                    stepAt(node, 'opacity', 0, step.into[0])
                    stepAt(node, 'visible', true, step.into[0])
                    node.tween('opacity', 1, step.into[0], step.into[1], ease)
                } else {
                    // A row that starts in the window fades in on its way. A row that starts under the window
                    // shows by its place. So does a row of a group that is larger than the window: it goes
                    // through the window with its neighbors, and on above it.
                    const start = this.y(place) + Math.max(lead, this.pitch * RISE)
                    stepAt(node, 'y', start, m0)
                    stepAt(node, 'visible', true, m0)
                    this.slide(node, this.y(place), now, m0, m1, ease, this.near(start, now) > 0 ? (alpha) => alpha / 0.6 : () => 1, inside ? 0 : -1)
                    if (!inside) {
                        stepAt(node, 'visible', false, m1)
                        this.rest(entry, place, now, m1, true)
                    }
                }
            } else if (from !== null && inside) {
                if (from !== place) this.carry(node, this.y(place), now, m0, m1, ease)
            } else if (from !== null) {
                // A row that is in the window goes with the others, and fades as it leaves. A row in the
                // line that a count takes fades where it is: it has no way out inside the panel.
                if (from >= now.top && from <= now.floor) {
                    this.slide(node, this.y(from + travel(place - from)), now, m0, m1, ease, undefined, place < now.top ? -1 : 1)
                } else {
                    this.fade(node, m0, m1, ease, (alpha) => 1 - alpha / 0.35)
                    // The other rows pass the place of this row, and the outline is taller than the text. So
                    // the outline is gone when the next row has used most of the clear room between them.
                    const reached = 0.8 * this.size * CLEAR / this.pitch / Math.max(1, Math.abs(travel(place - from)))
                    if (entry === this.lit) this.glows.push({ t0: m0, t1: m1, to: 0, ease: (share) => clamp(ease(share) / reached) })
                }
                stepAt(node, 'visible', false, m1)
                this.rest(entry, place, now, m1, true)
            } else if (inside) {
                // A row comes into the window from the side where it was. It waits for a count to leave its line.
                const start = this.y(place - travel(place - (old - was.first + was.top)))
                stepAt(node, 'visible', true, m0)
                this.slide(node, this.y(place), now, m0, m1, ease, (alpha) => (alpha - 0.4) / 0.4, start < this.y(place) ? -1 : 1, start)
            } else {
                this.rest(entry, place, now, m1, false)
            }
        })
        this.lines = next
        this.seen = now
        this.pinned = next.length > this.slots && now.first < next.length - this.slots + 1 ? next[now.first]! : null

        const last = this.slots - 1
        this.tell(this.above, was.top === 1, now.top === 1, m0, m1, ease)
        this.tell(this.under, was.floor < last, now.floor < last, m0, m1, ease)
        // A count changes when the row that leaves is nearly gone: at 45% of the way, and not at its end.
        const said = m0 + (m1 - m0) * 0.45
        for (const entry of before) if (!stays.has(entry)) this.turn(entry, 0, said)
        next.forEach((entry, at) => this.turn(entry, at < now.first ? -1 : at >= now.first + now.rows ? 1 : 0, said))
        this.recount()

        // A fold or an unfold gives the record of the focus another line. The outline goes there when the old
        // line is gone. It shows as much as its line does, so it leaves with the one and comes with the other.
        const target = this.focused?.line ?? null
        if (target && target !== this.lit) {
            this.attach(target, step.out[1])
            this.lit = target
        }
        // A row that leaves the window takes the focus with it. The row can come back, and the outline does not.
        if (this.lit && this.lit.slot === null) {
            this.glows.push({ t0: m1, t1: m1, to: 0, ease })
            this.focused = this.lit = null
        }
    }
}

/** A list of records that grows, with states: `eventLog([{ id: 1, name: 'WorkflowExecutionStarted' }, { ids: [2, 3, 4], name: 'workflow task' }], { title: 'event history', visible: 12 })`, then `log.append({ id: 5, name: 'ActivityTaskScheduled', detail: 'chargeCard', state: 'new' })`. */
export function eventLog(rows: readonly LogRow[] = [], options: EventLogOptions = {}): EventLog {
    return new EventLog(rows, options)
}
