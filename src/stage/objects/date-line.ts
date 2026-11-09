import { Node, type NodeProps, type PropName } from '../node'
import { rectPath, type Vec } from '../geometry'
import { circle, dot, line, polygon } from '../shapes'
import { text, type TextNode, type TextOptions } from '../text'
import { smooth } from '../ease'
import { toPaint, type ColorInput } from '../color'
import type { Track } from '../track'
import type { Anim, AnimContext, AnimOptions } from '../anim'
import { forwardOnly, reaches, reveal, stepAt } from './util'

/** A date: `'YYYY'`, `'YYYY-MM'` or `'YYYY-MM-DD'`, or a number of years such as 2020 or 2023.25. */
export type DateInput = string | number
/** What a tick of the line is: the start of a year, of a month, or of a day. */
export type DateUnit = 'year' | 'month' | 'day'
/** The mark of an event on the line. */
export type DateMark = 'dot' | 'star' | 'ring'

export interface DateEvent {
    /** When the event was. With scale `'order'`, it can also be a version, such as `'5.1'`. */
    at: DateInput
    /** The name of the event, on one line. A number is written as its text. An event with no label is a mark only, with no stem. */
    label?: string | number
    /** A second line under the label, in dim. A number is written as its text. */
    note?: string | number
    /** The color of the mark, the stem and the label. Defaults to ink. */
    color?: ColorInput
    /** Where the label goes. Without it, the labels go over the line and under it by turns, in date order. */
    side?: 'over' | 'under'
    /** The mark on the line: a dot, a star for an event of another kind, or a ring for an event with no sure date. Defaults to a dot. */
    mark?: DateMark
}

export interface DateLineOptions {
    /** The length of the line. Every label is inside it. A text under a tick at an end passes it by half of its width. Defaults to 1600. */
    width?: number
    /**
     * The dates at the two ends of the line, for scale `'time'`, such as `from: '2025-06'`. They default to
     * the whole years, months or days around the events, by the unit of the ticks.
     */
    from?: DateInput
    to?: DateInput
    /**
     * `'time'` puts each event at its date. `'order'` puts the events at equal steps in date order, for
     * events that are crowded in time: each one has its date under the line as the film wrote it, and the
     * line says "not to scale" at its end. Defaults to time.
     */
    scale?: 'time' | 'order'
    /**
     * What a tick is, for scale `'time'`: the start of a year, of a month, or of a day. Without it, the
     * span of the line decides: days up to 45 days, months under 2 years, and years from 2 years.
     */
    unit?: DateUnit
    /** Text size of the labels. The notes and the texts under the line are a little smaller. Defaults to 26. */
    size?: number
    /** How many heights the labels may take at each side of the line. The object uses as few as the labels need. Defaults to 3. */
    levels?: number
    /**
     * The most rows of marks: the line, and the rows over it. A mark that would touch an earlier mark goes
     * one row up, and the object has as many rows as the marks need, up to this number. Defaults to 10.
     */
    rows?: number
    /** Draw the cursor. With false, no cursor is ever drawn, and the events still appear at their dates. On by default. */
    cursor?: boolean
    /** The color of the event that `light()` lights. Defaults to orange. */
    accent?: ColorInput
    font?: TextOptions['font']
}

/** The tracks of visibility that already change the ticks of their event. */
const linked = new WeakSet<object>()

/** One event of a `DateLine` object. It is hidden until the cursor reaches it. */
export class DateEventNode extends Node {
    /** The ticks of the line that are in the clear room of the mark. A tick leaves while the event shows, by any way that the film shows it. */
    readonly covers: Node[] = []

    constructor(
        /** The mark of the event: a dot, a star, or a ring. */
        readonly mark: Node,
        /** The line to the label, or null for an event with no label. */
        readonly stem: Node | null,
        /** The label of the event, or null when the event has none. */
        readonly text: TextNode | null,
        /** The line under the label, or null when the event has none. */
        readonly note: TextNode | null,
        /** The ring around the mark of the event that `light()` lit. It has no opacity when the event is not lit. */
        readonly halo: Node,
    ) {
        super()
    }

    override set<K extends PropName>(prop: K, value: NodeProps[K]): this {
        super.set(prop, value)
        // A node that is not on the stage has no track yet, and the change has no time.
        if (prop === 'visible' && !this.mounted) for (const tick of this.covers) tick.set('visible', !value)
        return this
    }

    override track<K extends PropName>(prop: K): Track<NodeProps[K]> {
        const made = super.track(prop)
        if (prop === 'visible' && !linked.has(made)) {
            linked.add(made)
            // Each change of this track is a change of the ticks, the other way round. `show()`, a fade and the cursor all write here.
            const add = made.add.bind(made)
            made.add = (key) => {
                add(key)
                for (const tick of this.covers) tick.track('visible').add({ t0: key.t0, t1: key.t1, ease: null, to: !key.to, at: null })
            }
        }
        return made
    }
}

type Side = 'over' | 'under'
/** Where a label is at the end of its stem: over or under the end, or beside the stem at its right or its left. */
type Align = 'center' | 'right' | 'left'

interface Box {
    x0: number
    x1: number
    y0: number
    y1: number
}

interface Place {
    side: Side
    level: number
    align: Align
    /** The room of the label and its note. */
    box: Box
    /** The y of the two ends of the stem. Over the line, it starts at the mark. Under the line, it starts under the row of the texts. */
    from: number
    reach: number
}

/** A text under a tick, with its tick x and the room of its ink. */
interface Stamp {
    made: TextNode
    words: string
    x: number
    box: Box
}

/** One start of a unit on the line: its place in years, and its date. */
interface Start {
    u: number
    year: number
    month: number
    day: number
}

/** The ticks of a line and the texts under them, or why a unit has none: no start of the unit is on the line, or its texts have no room. */
type Plan = { strong: number[]; minor: number[]; stamps: Stamp[] } | 'none' | 'room'

/** Seconds for a mark, its stem and its label to arrive. */
const REVEAL = 0.5
/** Seconds for an event to take or to lose the accent color. */
const LIGHT = 0.4
/** The most places that the search for the labels may try with one number of heights. A trial for the advice of an error has a tenth of it. */
const BUDGET = 200000
/** The rows of marks that a line may have when the film gives no number. */
const ROWS = 10
/** A line of this many days or fewer has a tick for each day, when the film gives no unit. */
const DAYS_SPAN = 45
/** A line that is shorter than this many years has a tick for each month, when the film gives no unit. */
const MONTHS_SPAN = 2
/** The most ticks of months or of days that a line may have. */
const MOST_TICKS = 2400
/** More than 0 while the object builds a line to see if a piece of advice works. An error of such a line needs no advice. */
let advising = 0

const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/
const VERSION = /^\d+(?:\.\d+)*$/
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const UNITS: readonly DateUnit[] = ['day', 'month', 'year']

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
const monthLengths = (year: number) => [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** The start of a day as a number of years: 2 July 2026 is about 2026.5. */
function yearsAt(year: number, month: number, day: number): number {
    const lengths = monthLengths(year)
    let before = day - 1
    for (let index = 0; index < month - 1; index++) before += lengths[index]!
    return year + before / (isLeap(year) ? 366 : 365)
}

/** The day that a number of years is in. */
function dayOf(years: number): { year: number; month: number; day: number } {
    let year = Math.floor(years)
    const length = isLeap(year) ? 366 : 365
    // A day start that came from `yearsAt` can be under its day by the last digit of the number.
    let index = Math.floor((years - year) * length + 1e-6)
    if (index >= length) {
        year++
        index = 0
    }
    const lengths = monthLengths(year)
    let month = 0
    while (index >= lengths[month]!) index -= lengths[month++]!
    return { year, month: month + 1, day: index + 1 }
}

/** A date as a number of years. Null for a text that is not a date. */
function yearsOf(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value !== 'string') return null
    const match = DATE.exec(value.trim())
    if (!match) return null
    const year = Number(match[1]), month = match[2] === undefined ? 1 : Number(match[2]), day = match[3] === undefined ? 1 : Number(match[3])
    if (month < 1 || month > 12 || day < 1 || day > monthLengths(year)[month - 1]!) return null
    return yearsAt(year, month, day)
}

const two = (value: number) => String(value).padStart(2, '0')
/** A number of years as a date for an error: 2025, 2025-06, or 2025-06-09. */
function dateText(years: number): string {
    const { year, month, day } = dayOf(years)
    return day > 1 ? `${year}-${two(month)}-${two(day)}` : month > 1 ? `${year}-${two(month)}` : String(year)
}

/** A date as the film wrote it, for an error. A number that is not a number has no JSON form. */
const written = (value: unknown) => (typeof value === 'string' ? JSON.stringify(value) : String(value))

/** The start of the unit that a date is in. */
function startOf(unit: DateUnit, years: number): number {
    const { year, month, day } = dayOf(years)
    return unit === 'year' ? year : unit === 'month' ? yearsAt(year, month, 1) : yearsAt(year, month, day)
}

/** The start of the unit after the one that a date is in. */
function startAfter(unit: DateUnit, years: number): number {
    const { year, month, day } = dayOf(years)
    if (unit === 'year') return year + 1
    if (unit === 'month') return month === 12 ? year + 1 : yearsAt(year, month + 1, 1)
    if (day < monthLengths(year)[month - 1]!) return yearsAt(year, month, day + 1)
    return month === 12 ? year + 1 : yearsAt(year, month + 1, 1)
}

/** Each start of a month or of a day from `first` to `last`. */
function startsOf(unit: 'month' | 'day', first: number, last: number): Start[] {
    const out: Start[] = []
    let u = startOf(unit, first)
    if (u < first - 1e-9) u = startAfter(unit, u)
    for (; u <= last + 1e-9; u = startAfter(unit, u)) out.push({ u, ...dayOf(u) })
    return out
}

/** A value as the film wrote it, for an error about a label or a note. */
function shown(value: unknown): string {
    if (typeof value !== 'object' || value === null) return written(value)
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

/** An event without some of its keys. */
function without(event: DateEvent, ...keys: (keyof DateEvent)[]): DateEvent {
    return Object.fromEntries(Object.entries(event).filter(([key]) => !keys.includes(key as keyof DateEvent))) as unknown as DateEvent
}

/**
 * A line of time with events at their dates: a mark on the line for each event, and a stem to its label. The
 * object places the labels over the line and under it, at more than one height, so that no two of them
 * meet. An event with no label is a mark only. A mark that would touch another one goes to a row over the
 * line. `advance(date)` moves a cursor to a date and stops there, and each event appears when the cursor
 * passes it. `.at()` places the middle of the line. The bounds of the object hold every label from the
 * start: read `extent`.
 */
export class DateLine extends Node {
    /** One node per event, in the order given. */
    readonly events: DateEventNode[] = []
    /** The line, its ticks and the texts under them, and the words "not to scale" of an `'order'` line. */
    readonly axis: Node
    /**
     * A small pointer under the line, at the date that the film has reached. It moves in a room of its own,
     * under the marks and over the texts under the line, so it touches nothing. The first `advance` shows it.
     */
    readonly cursor: Node
    /** The two ends of the line as numbers of years. With scale `'order'`, the ends are counted in events: -0.5 and the number of dates less 0.5. */
    readonly domain: readonly [number, number]
    /** What a tick of the line is. Null with scale `'order'`, where a tick is an event. */
    readonly unit: DateUnit | null
    /**
     * The room of the line with all its events, in the coordinates of the object: how far the labels and the
     * rows of marks go over the line and under it, and how far a text passes each end. The bounds of the
     * object are this room from the start, also while the events are hidden.
     */
    readonly extent: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }
    private readonly w: number
    private readonly ordered: boolean
    /** The place of each event on the line, in the unit of `domain`. */
    private readonly us: number[] = []
    /** The y of the mark of each event: 0 on the line, and less for a mark in a row over the line. */
    private readonly ys: number[] = []
    private readonly kinds: DateMark[] = []
    private readonly colors: ColorInput[] = []
    private readonly accent: ColorInput
    /** With scale `'order'`: the text of each date, in order. Its index is its place on the line. */
    private readonly slots: string[] = []
    /**
     * The x of the two ends of `domain`. They are a little inside the ends of the line: the largest mark at
     * the first date stays inside the width, and an `'order'` line keeps room at its end for the words "not to scale".
     */
    private readonly ends: readonly [number, number]
    /** The two ends of the line as the film wrote them, for an error. */
    private readonly endsText: readonly [string, string]
    private readonly rule: Node
    /** The ticks and the texts of the axis, and the x of each one, for `enter()`. Two lists, so a copy of the object gets its own nodes. */
    private readonly marks: Node[] = []
    private readonly markXs: number[] = []
    private readonly drawCursor: boolean
    private cursorAt: number
    private started = false
    private litIndex: number | null = null

    constructor(events: readonly DateEvent[], options: DateLineOptions = {}) {
        super()
        if (events.length === 0) throw new Error('dateLine: give it at least one event')
        const size = options.size ?? 26
        if (!(Number.isFinite(size) && size > 0)) throw new Error('dateLine: size is the text size of the labels, more than 0')
        const w = this.w = options.width ?? 1600
        if (!(Number.isFinite(w) && w > 0)) throw new Error('dateLine: width is the length of the line, more than 0')
        const scale = options.scale ?? 'time'
        if (scale !== 'time' && scale !== 'order') throw new Error(`dateLine: scale is 'time' or 'order', not ${JSON.stringify(scale)}`)
        const ordered = this.ordered = scale === 'order'
        const levels = options.levels ?? 3
        if (!Number.isInteger(levels) || levels < 1) throw new Error('dateLine: levels is the number of heights at each side of the line, a whole number of 1 or more')
        const rowsMost = options.rows ?? ROWS
        if (!Number.isInteger(rowsMost) || rowsMost < 1) throw new Error('dateLine: rows is the most rows of marks, a whole number of 1 or more')
        if (options.unit !== undefined && !UNITS.includes(options.unit)) throw new Error(`dateLine: unit is 'year', 'month' or 'day', not ${JSON.stringify(options.unit)}`)
        if (ordered && options.unit !== undefined) throw new Error("dateLine: unit is the tick of a line with scale 'time'. With 'order', each event has its own tick")
        this.accent = options.accent ?? 'orange'
        try {
            toPaint(this.accent)
        } catch {
            throw new Error(`dateLine: accent is ${written(this.accent)}, which is not a color. Use a color of the look, such as 'orange', or a CSS color`)
        }
        const font = options.font
        const noteSize = Math.round(size * 0.85), tickSize = Math.round(size * 0.9)
        const left = -w / 2, right = w / 2

        // A label and a note are texts. A number is written as its text.
        const wordsOf = (value: unknown, what: string, index: number): string | null => {
            if (value === undefined) return null
            if (typeof value === 'number' && Number.isFinite(value)) return String(value)
            if (typeof value !== 'string') throw new Error(`dateLine: the ${what} of event ${index} is ${shown(value)}. A ${what} is a text, or a number that the line writes as its text`)
            return value.trim()
        }
        const labels = events.map((event, index) => wordsOf(event.label, 'label', index))
        // A note of spaces only is no note.
        const notes = events.map((event, index) => wordsOf(event.note, 'note', index) || null)
        const named = (index: number) => (labels[index] === null ? `event ${index} (at ${written(events[index]!.at)})` : `event ${index} (${JSON.stringify(labels[index])})`)
        events.forEach((event, index) => {
            if (labels[index] === '') throw new Error(`dateLine: event ${index} has an empty label. Give it a label, or leave \`label\` out for a mark with no label`)
            if (labels[index]?.includes('\n')) throw new Error(`dateLine: the label of ${named(index)} has a line break. A label is one line. Use \`note\` for a second line`)
            if (notes[index]?.includes('\n')) throw new Error(`dateLine: the note of ${named(index)} has a line break. A note is one line`)
            if (labels[index] === null && notes[index] !== null) throw new Error(`dateLine: ${named(index)} has a note and no label. A note is the second line of a label`)
            if (event.side !== undefined && event.side !== 'over' && event.side !== 'under') throw new Error(`dateLine: ${named(index)} has the side ${JSON.stringify(event.side)}. Use 'over' or 'under'`)
            if (event.mark !== undefined && event.mark !== 'dot' && event.mark !== 'star' && event.mark !== 'ring') throw new Error(`dateLine: ${named(index)} has the mark ${JSON.stringify(event.mark)}. Use 'dot', 'star' or 'ring'`)
            this.kinds.push(event.mark ?? 'dot')
            this.colors.push(event.color ?? 'ink')
        })
        const labeled = labels.map((words) => words !== null)

        /** True when the line builds with other events or other options. A thrown value that is not an Error is a font that still loads, and it goes on. */
        const builds = (other: readonly DateEvent[], changed: DateLineOptions): boolean => {
            advising++
            try {
                new DateLine(other, { ...options, ...changed })
                return true
            } catch (error) {
                if (!(error instanceof Error)) throw error
                return false
            } finally {
                advising--
            }
        }
        const withOption = (changed: DateLineOptions, words: string) => () => (builds(events, changed) ? words : null)
        const withEvent = (index: number, change: (event: DateEvent) => DateEvent, words: string) => () => (builds(events.map((event, at) => (at === index ? change(event) : event)), {}) ? words : null)
        /** The first of some wider lines that builds. */
        const wider = (...firsts: number[]) => () => {
            for (const width of [...firsts, ...[1.25, 1.5, 2, 3, 4].map((times) => Math.ceil((w * times) / 10) * 10)]) if (width > w && builds(events, { width })) return `width: ${width}`
            return null
        }
        /**
         * The error that stops the build. Its message ends with the changes that give this line a layout:
         * the object builds the line with each one, and names the first three that work.
         */
        const failure = (message: string, ...ways: (() => string | null)[]): Error => {
            // A line that the object builds for the advice of another error needs no advice.
            if (advising > 0) return new Error(message)
            const found: string[] = []
            for (const way of ways) {
                if (found.length === 3) break
                const words = way()
                if (words) found.push(words)
            }
            if (found.length === 0) return new Error(`${message}. No one change of an option gives this line a layout. Use fewer events, or two lines`)
            return new Error(`${message}. What works for this line: ${found.length > 1 ? `${found.slice(0, -1).join(', ')}, or ${found[found.length - 1]}` : found[0]}`)
        }

        // Sizes are parts of the text size.
        const weight = Math.max(2, size * 0.1)
        const tick = size * 0.3, minor = size * 0.16
        const dotRadius = Math.max(4, size * 0.27)
        const radii = this.kinds.map((kind) => (kind === 'star' ? dotRadius * 1.8 : dotRadius))
        const widest = Math.max(...radii)
        // The clear room of a mark: no other mark, no tick and no cursor is nearer to it. The ring of a lit event is inside this room.
        const clearRoom = size * 0.18
        const haloGap = size * 0.07, haloWeight = Math.max(1.5, size * 0.06)
        // The rows of marks are as far apart as the largest mark needs, and a mark in a row is clear of the ticks under it.
        const rowPitch = Math.max(2 * widest + clearRoom, widest + haloGap + haloWeight / 2 + tick + weight / 2 + size * 0.06)
        // The cursor is a pointer in a room of its own: under the marks of the line and their clear room, and over the texts under the line.
        const laneTop = Math.max(widest + clearRoom, tick + weight / 2 + size * 0.1)
        const pointerHeight = size * 0.32, pointerWidth = size * 0.42
        // `.at()` puts the middle of the capital letters at y, so a digit goes as far over that y as under it.
        const capital = -text('0', { size: tickSize, font }).bounds().y
        const numberY = laneTop + pointerHeight + size * 0.16 + capital
        // The words "not to scale" are at the end of an `'order'` line, in the row of the dates. The steps stop before them.
        const scaleNote = ordered ? text('not to scale', { size: tickSize, font, color: 'dim', italic: true }) : null
        const reserve = scaleNote ? scaleNote.bounds().width + size : 0
        this.ends = ordered ? [left, right - reserve] : [left + widest, right - widest]
        if (!(this.ends[1] - this.ends[0] > size * 2)) throw failure(`dateLine: a width of ${w} has no room for the events${ordered ? ' before the words "not to scale"' : ''}`, wider(Math.ceil(reserve + 2 * widest + size * 2) + 1))
        const [start, end] = this.ends
        /** A text under a tick, in the middle under it. */
        const stamp = (words: string, x: number, color: ColorInput): Stamp => {
            const made = text(words, { size: tickSize, font, color })
            const ink = made.bounds()
            made.at(x - ink.x - ink.width / 2, numberY)
            return { made, words, x, box: { x0: x - ink.width / 2, x1: x + ink.width / 2, y0: numberY + ink.y, y1: numberY + ink.y + ink.height } }
        }
        // The least room between two texts under the line.
        const apart = tickSize * 0.6
        const clear = (a: Stamp, b: Stamp) => a.box.x0 - b.box.x1 >= apart || b.box.x0 - a.box.x1 >= apart
        const inRow = (list: readonly Stamp[]) => list.every((one, index) => index === 0 || one.box.x0 - list[index - 1]!.box.x1 >= apart)

        // The place of each event on the line, in years or in steps, and the ticks with their texts.
        let first: number, last: number, plan: Exclude<Plan, 'none' | 'room'>
        if (!ordered) {
            events.forEach((event, index) => {
                const years = yearsOf(event.at)
                if (years === null) throw new Error(`dateLine: ${named(index)} has the date ${written(event.at)}. A date is 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', or a number of years`)
                this.us.push(years)
            })
            const [from, to] = (['from', 'to'] as const).map((name) => {
                const value = options[name]
                if (value === undefined) return null
                const years = yearsOf(value)
                if (years === null) throw new Error(`dateLine: ${name} is ${written(value)}. A date is 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', or a number of years`)
                return years
            }) as [number | null, number | null]
            const earliest = Math.min(...this.us), latest = Math.max(...this.us)
            /** The two ends of a line with ticks of a unit: the dates of the film, or the whole units around the events. A last event at the start of a unit ends the line, when the line is then one unit long or more. */
            const endsOf = (unit: DateUnit): [number, number] => {
                const low = from ?? startOf(unit, earliest)
                return [low, to ?? (Math.abs(startOf(unit, latest) - latest) < 1e-9 && latest > low ? latest : startAfter(unit, latest))]
            }
            const asWritten = (low: number, high: number): [string, string] => [from === null ? dateText(low) : written(options.from), to === null ? dateText(high) : written(options.to)]
            if (from !== null && to !== null && !(to > from)) throw new Error(`dateLine: the line goes from ${written(options.from)} to ${written(options.to)}. Give a \`from\` that is before \`to\``)

            /** The ticks of a unit on a line from `low` to `high`, with a text under each one, or under every second, third or sixth one: the first of these steps at which no two texts touch. */
            const planOf = (unit: DateUnit, low: number, high: number): Plan => {
                const xAt = (u: number) => start + ((u - low) / (high - low)) * (end - start)
                if (unit === 'year') {
                    const firstYear = Math.ceil(low - 1e-9), lastYear = Math.floor(high + 1e-9)
                    if (lastYear < firstYear) return 'none'
                    const perYear = (end - start) / (high - low)
                    // A number for each year, or for every second, fifth or tenth one, and so on. The numbers
                    // are at round years: 2020 and 2025, not 2021 and 2026. A short line that holds no round
                    // year counts from its first year.
                    for (let power = 1; ; power *= 10) {
                        for (const times of [1, 2, 5]) {
                            const step = times * power
                            // Numbers that are less than a text size apart touch, whatever their digits.
                            if (step * perYear < tickSize && step <= lastYear - firstYear) continue
                            const round = Math.ceil(firstYear / step) * step
                            const origin = round <= lastYear ? round : firstYear
                            const stamps: Stamp[] = []
                            for (let year = origin; year <= lastYear; year += step) stamps.push(stamp(String(year), xAt(year), 'dim'))
                            if (!inRow(stamps)) continue
                            // A small tick for each year between two numbers, so a viewer can count the years. Years that are too narrow for it have none.
                            const others: number[] = []
                            if (perYear >= size * 0.3) for (let year = firstYear; year <= lastYear; year++) if (year < origin || (year - origin) % step !== 0) others.push(xAt(year))
                            return { strong: stamps.map((one) => one.x), minor: others, stamps }
                        }
                    }
                }
                const count = (high - low) * (unit === 'month' ? 12 : 366)
                if (count > MOST_TICKS) return 'room'
                const starts = startsOf(unit, low, high)
                if (starts.length === 0) return 'none'
                const perUnit = (end - start) / count
                // The first tick of a year, or of a month, has the number of the year, or the name of the month, in place of its own text.
                const turns = (one: Start) => (unit === 'month' ? one.month === 1 : one.day === 1)
                const short = (one: Start) => (unit === 'month' ? (one.month === 1 ? String(one.year) : MONTHS[one.month - 1]!) : one.day === 1 ? MONTHS[one.month - 1]! : String(one.day))
                // The first tick of the line says where the line starts: its month and its year, and on a line of days its day too.
                const full = (one: Start) => {
                    const month = MONTHS[one.month - 1]!
                    if (unit === 'month') return one.month === 1 ? String(one.year) : `${month} ${one.year}`
                    return one.day === 1 ? `${month} ${one.year}` : `${month} ${one.day}, ${one.year}`
                }
                const make = (one: Start, words: string) => stamp(words, xAt(one.u), 'dim')
                const fixed = starts.filter(turns).map((one) => make(one, one === starts[0] ? full(one) : short(one)))
                if (!inRow(fixed)) return 'room'
                const opening = turns(starts[0]!) ? null : make(starts[0]!, full(starts[0]!))
                const opens = opening !== null && fixed.every((one) => clear(opening, one))
                for (const step of unit === 'month' ? [1, 2, 3, 6] : [1, 2, 7, 14]) {
                    // The texts of a month count from its first day: 1, 8, 15 and 22 for every seventh day. One that is less than a step before the next month has no text.
                    const counted = (one: Start) => (unit === 'month' ? (one.month - 1) % step === 0 : (one.day - 1) % step === 0 && one.day + step <= monthLengths(one.year)[one.month - 1]! + 1)
                    const regular = starts.filter((one, index) => !turns(one) && counted(one) && !(index === 0 && opens)).map((one) => make(one, short(one)))
                    // A text that would touch the text of the first tick has no room, and its tick stays.
                    const kept = opens ? regular.filter((one) => clear(one, opening!)) : regular
                    const row = [...fixed, ...kept].sort((a, b) => a.x - b.x)
                    if (!inRow(row)) continue
                    const stamps = (opens ? [opening!, ...row] : row).sort((a, b) => a.x - b.x)
                    const strong = new Set(stamps.map((one) => one.x))
                    const others = perUnit >= size * 0.3 ? starts.map((one) => xAt(one.u)).filter((x) => !strong.has(x)) : []
                    return { strong: [...strong], minor: others, stamps }
                }
                return 'room'
            }

            // The unit of the ticks: the one that the film gives, or the one that the span of the line asks for.
            // When the texts of that unit have no room at this width, the next larger unit.
            const span = (to ?? latest) - (from ?? earliest)
            const wanted: DateUnit[] = options.unit ? [options.unit] : span <= 0 ? ['year'] : Math.round(span * 365.25) <= DAYS_SPAN ? ['day', 'month', 'year'] : span < MONTHS_SPAN ? ['month', 'year'] : ['year']
            let found: { unit: DateUnit; low: number; high: number; plan: Exclude<Plan, 'none' | 'room'> } | null = null
            const failed: { unit: DateUnit; low: number; high: number; why: 'none' | 'room' }[] = []
            for (const unit of wanted) {
                const [low, high] = endsOf(unit)
                this.us.forEach((years, index) => {
                    if (years >= low - 1e-9 && years <= high + 1e-9) return
                    const at = events[index]!.at
                    throw failure(`dateLine: ${named(index)} is at ${written(at)}, outside the line from ${asWritten(low, high).join(' to ')}`, years < low ? withOption({ from: at }, `from: ${written(at)}`) : withOption({ to: at }, `to: ${written(at)}`))
                })
                const made = planOf(unit, low, high)
                if (made === 'none' || made === 'room') {
                    failed.push({ unit, low, high, why: made })
                    continue
                }
                found = { unit, low, high, plan: made }
                break
            }
            if (!found) {
                const { unit, low, high, why } = failed[0]!
                const between = `the line from ${asWritten(low, high).join(' to ')}`
                // With a unit from the film: no unit, or the unit next to it. A line with no start of a year has months, and a line with no room for days has months.
                const other: DateUnit = why === 'none' ? (unit === 'year' ? 'month' : 'day') : unit === 'day' ? 'month' : 'year'
                const units = options.unit ? [withOption({ unit: undefined }, 'no unit'), ...(other === unit ? [] : [withOption({ unit: other }, `unit: '${other}'`)])] : []
                if (why === 'none') throw failure(`dateLine: ${between} holds the start of no ${unit}, so it has no tick`, ...units, wider())
                throw failure(`dateLine: ${between} has no room for a tick for each ${unit} at a width of ${w}: their texts touch, also at every ${unit === 'month' ? 'sixth month' : 'fourteenth day'}`, ...units, wider())
            }
            first = found.low
            last = found.high
            plan = found.plan
            this.unit = found.unit
            this.endsText = asWritten(first, last)
        } else {
            if (options.from !== undefined || options.to !== undefined) throw new Error("dateLine: from and to are the ends of a line with scale 'time'. With 'order', the events are at equal steps, and the line has no such ends")
            // Every event has a date, or every event has a version. The two do not mix on one line.
            const dates = events.map((event) => yearsOf(event.at))
            const versions = events.map((event) => (typeof event.at === 'string' && VERSION.test(event.at.trim()) ? event.at.trim().split('.').map(Number) : null))
            let keys: (number | number[])[]
            if (dates.every((years) => years !== null)) keys = dates as number[]
            else if (versions.every((version) => version !== null)) keys = versions as number[][]
            else {
                // Name the event that is neither, or the first one that is not of the kind of the first event.
                const neither = events.findIndex((_, index) => dates[index] === null && versions[index] === null)
                const wrong = neither >= 0 ? neither : events.findIndex((_, index) => (dates[index] === null) !== (dates[0] === null))
                throw new Error(`dateLine: ${named(wrong)} has the date ${written(events[wrong]!.at)}. With scale 'order', give every event a date ('YYYY', 'YYYY-MM' or 'YYYY-MM-DD', or a number of years), or give every event a version such as '5.1'`)
            }
            const compare = (a: number | number[], b: number | number[]): number => {
                if (typeof a === 'number' || typeof b === 'number') return (a as number) - (b as number)
                for (let k = 0; k < Math.max(a.length, b.length); k++) {
                    const difference = (a[k] ?? 0) - (b[k] ?? 0)
                    if (difference !== 0) return difference
                }
                return 0
            }
            // An event is known by its date as the film wrote it. Events with one text have one place. "5.1"
            // and "5.1.0" are two texts, so they have two places, in the order of the list.
            const order = events.map((_, index) => index).sort((a, b) => compare(keys[a]!, keys[b]!) || a - b)
            const places: number[] = events.map(() => 0)
            for (const index of order) {
                const words = String(events[index]!.at).trim()
                if (!this.slots.includes(words)) this.slots.push(words)
                places[index] = this.slots.indexOf(words)
            }
            this.us.push(...places)
            first = -0.5
            last = this.slots.length - 0.5
            const xAt = (u: number) => start + ((u - first) / (last - first)) * (end - start)
            // The date of an event is a part of what the line says, so it is in ink.
            const stamps = this.slots.map((words, slot) => stamp(words, xAt(slot), 'ink'))
            stamps.forEach((one, index) => {
                if (index > 0 && !clear(one, stamps[index - 1]!)) throw failure(`dateLine: the dates ${JSON.stringify(stamps[index - 1]!.words)} and ${JSON.stringify(one.words)} touch under the line`, wider())
            })
            plan = { strong: stamps.map((one) => one.x), minor: [], stamps }
            this.unit = null
            this.endsText = ['', '']
        }
        this.domain = [first, last]
        this.cursorAt = first
        const xs = this.us.map((u) => this.xOf(u))

        // The line, its ticks, and the texts under them.
        this.axis = new Node()
        this.rule = line([left, 0], [right, 0], { stroke: 'gridStrong', width: weight })
        this.axis.add(this.rule)
        const ticks: { x: number; node: Node; half: number }[] = []
        const addTick = (x: number, half: number, strong: boolean) => {
            const width = strong ? weight : Math.max(1.5, weight * 0.6)
            const made = line([x, -half], [x, half], { stroke: 'gridStrong', width })
            this.axis.add(made)
            this.marks.push(made)
            this.markXs.push(x)
            ticks.push({ x, node: made, half: width / 2 })
        }
        for (const x of [...plan.strong.map((at) => ({ at, strong: true })), ...plan.minor.map((at) => ({ at, strong: false }))].sort((a, b) => a.at - b.at)) addTick(x.at, x.strong ? tick : minor, x.strong)
        for (const one of plan.stamps) {
            this.axis.add(one.made)
            this.marks.push(one.made)
            this.markXs.push(one.x)
        }
        const numbers = plan.stamps
        // The bottom of the row of the texts under the line, with the tails of their letters.
        let rowBottom = Math.max(numberY + capital, ...numbers.map((one) => one.box.y1))
        if (scaleNote) {
            const ink = scaleNote.bounds()
            scaleNote.at(right - ink.x - ink.width, numberY)
            rowBottom = Math.max(rowBottom, numberY + ink.y + ink.height)
            this.axis.add(scaleNote)
            this.marks.push(scaleNote)
            this.markXs.push(right)
        }

        // The marks, in date order. A mark takes the line when it touches no other mark there, with the
        // clear room of both. If not, it takes the first row over the line where it touches none. Events
        // with labels at one date have one place.
        const byDate = events.map((_, index) => index).sort((a, b) => this.us[a]! - this.us[b]! || a - b)
        const taken: { x: number; radius: number }[][] = []
        const rowOf: number[] = events.map(() => 0)
        const placed: number[] = []
        for (const index of byDate) {
            const x = xs[index]!, radius = radii[index]!
            const twin = labeled[index] ? placed.find((other) => labeled[other] && Math.abs(xs[other]! - x) < 0.01) : undefined
            placed.push(index)
            if (twin !== undefined) {
                rowOf[index] = rowOf[twin]!
                continue
            }
            let row = 0
            while (taken[row]?.some((other) => Math.abs(other.x - x) < other.radius + radius + clearRoom)) row++
            ;(taken[row] ??= []).push({ x, radius })
            rowOf[index] = row
        }
        if (taken.length > rowsMost) {
            const high = byDate.find((index) => rowOf[index]! >= rowsMost)!
            throw failure(`dateLine: the marks near ${named(high)} need ${taken.length} rows, and \`rows\` is ${rowsMost}`, withOption({ rows: taken.length }, `rows: ${taken.length}`), wider())
        }
        events.forEach((_, index) => this.ys.push(rowOf[index] === 0 ? 0 : -rowOf[index]! * rowPitch))
        const samePlace = (a: number, b: number) => rowOf[a] === rowOf[b] && Math.abs(xs[a]! - xs[b]!) < 0.01
        // A mark is in the way of the labels of the other events, and of their stems.
        const markBoxes: Box[] = events.map((_, index) => ({ x0: xs[index]! - radii[index]!, x1: xs[index]! + radii[index]!, y0: this.ys[index]! - radii[index]!, y1: this.ys[index]! + radii[index]! }))
        // A tick in the clear room of a mark of the line leaves while the event shows, so no mark stands on a tick or beside one.
        const covers = events.map((_, index) => (rowOf[index] === 0 ? ticks.filter((one) => Math.abs(one.x - xs[index]!) < radii[index]! + clearRoom + one.half).map((one) => one.node) : []))

        // The texts of each event, at the origin. Their place comes from the search under this.
        const texts = events.map((event, index) => ({
            label: labels[index] === null ? null : text(labels[index]!, { size, font, color: event.color ?? 'ink' }),
            note: notes[index] === null ? null : text(notes[index]!, { size: noteSize, font, color: 'dim' }),
        }))
        // A line of text has its top at 0.38 of its size over the place that `.at()` gives it, and its bottom at 0.62 under it.
        // The note is a line under the label, with room for the tails of the letters of the label.
        const noteDrop = size * 0.78 + noteSize * 0.38
        const heights = texts.map((one) => (one.note ? noteDrop + noteSize * 0.62 + size * 0.38 : size))
        const widths = texts.map((one) => Math.max(one.label ? one.label.bounds().width : 0, one.note ? one.note.bounds().width : 0))
        // The heights are the same for every event, so the labels of one height stand in one row.
        const pitch = Math.max(...heights) + size * 0.45
        // A label over the line counts its heights from its mark, which can be in a row. A label under the line is under the row of the texts.
        const near = (index: number, side: Side, level: number) => (side === 'over' ? -this.ys[index]! + size * 1.5 : rowBottom + size * 0.7) + (level - 1) * pitch
        const beside = size * 0.35, stemGap = size * 0.14
        const placeOf = (index: number, side: Side, level: number, align: Align): Place | null => {
            const wide = widths[index]!, high = heights[index]!, x = xs[index]!
            const distance = near(index, side, level)
            const y0 = side === 'over' ? -(distance + high) : distance
            let x0: number
            if (align === 'center') x0 = Math.min(Math.max(x - wide / 2, left), right - wide)
            else if (align === 'right') x0 = x + beside
            else x0 = x - beside - wide
            // A place that is not inside the line is no place. A label that is wider than the line has none.
            if (x0 < left - 0.5 || x0 + wide > right + 0.5) return null
            // A label beside its stem: the stem ends at the middle of the label. A label at the end of its stem: the stem ends short of it.
            const labelY = y0 + size * 0.38
            const reach = align === 'center' ? (side === 'over' ? -(distance - stemGap) : distance - stemGap) : labelY
            // A stem over the line starts at its mark. A stem under the line starts under the row of the texts, at the x of its mark:
            // so it passes through no text and beside none, and the room of the cursor stays free.
            return { side, level, align, box: { x0, x1: x0 + wide, y0, y1: y0 + high }, from: side === 'over' ? this.ys[index]! : Math.min(rowBottom + size * 0.14, reach), reach }
        }
        // Two labels in one row are nearly one text size apart, so they do not read as one line.
        const clearX = size * 0.9, clearY = size * 0.1, stemClear = size * 0.3
        const meets = (a: Box, b: Box, room = clearX) => a.x0 < b.x1 + room && b.x0 < a.x1 + room && a.y0 < b.y1 + clearY && b.y0 < a.y1 + clearY
        /** True when a stem at `x`, from `from` to `reach`, passes through a box. */
        const crosses = (x: number, from: number, reach: number, box: Box) => x > box.x0 - stemClear && x < box.x1 + stemClear && Math.min(from, reach) < box.y1 + clearY && Math.max(from, reach) > box.y0 - clearY

        // Each label prefers the lowest height, and at that height a place at the end of its stem before a
        // place beside it, at its own side first. The sides go by turns in date order.
        const order = byDate.filter((index) => labeled[index])
        /** A mark that took a place from a label, for an error. */
        const inWay: (number | null)[] = order.map(() => null)
        const candidates = order.map((index, turn) => {
            const own = events[index]!.side
            const sides: Side[] = own ? [own] : turn % 2 === 0 ? ['over', 'under'] : ['under', 'over']
            const others = events.map((_, other) => other).filter((other) => other !== index && !samePlace(other, index))
            const list: Place[] = []
            for (let level = 1; level <= levels; level++) {
                for (const aligns of [['center'], ['right', 'left']] as const) {
                    for (const side of sides) {
                        // The label of a mark in a row is over the line: under it, the label would be nearer to the marks of the line.
                        if (side === 'under' && rowOf[index]! > 0) continue
                        for (const align of aligns) {
                            const place = placeOf(index, side, level, align)
                            if (!place) continue
                            const mark = others.find((other) => meets(place.box, markBoxes[other]!, stemClear) || crosses(xs[index]!, place.from, place.reach, markBoxes[other]!))
                            if (mark === undefined) list.push(place)
                            else inWay[turn] ??= mark
                        }
                    }
                }
            }
            return list
        })
        const conflict = (a: number, placeA: Place, b: number, placeB: Place) =>
            meets(placeA.box, placeB.box) || crosses(xs[order[a]!]!, placeA.from, placeA.reach, placeB.box) || crosses(xs[order[b]!]!, placeB.from, placeB.reach, placeA.box)
        // Only labels that are near in x can meet.
        const reachOf = (k: number) => widths[order[k]!]! + beside + clearX
        const neighbors = order.map((_, k) => order.map((__, j) => j).filter((j) => j !== k && Math.abs(xs[order[j]!]! - xs[order[k]!]!) <= reachOf(k) + reachOf(j)))
        let dead: { placed: number; event: number; blocker: number | null } = { placed: -1, event: 0, blocker: null }
        const budget = advising > 0 ? BUDGET / 10 : BUDGET
        /**
         * The places of all labels with `limit` heights, or null. The label with the fewest places left
         * takes its place first. Each place that a label takes removes the places of its neighbors that
         * would meet it, so a label with no place left stops a branch at once. So the budget of tries is
         * not what decides for a line that a film draws.
         */
        const solve = (limit: number): Place[] | null => {
            const chosen: (Place | null)[] = order.map(() => null)
            let tried = 0
            dead = { placed: -1, event: 0, blocker: null }
            const all = candidates.map((list) => list.filter((place) => place.level <= limit))
            const none = all.findIndex((list) => list.length === 0)
            if (none >= 0) {
                dead = { placed: 0, event: none, blocker: null }
                return null
            }
            /** Places one more label, and then the others. `domains` has the places that each label has left. */
            const go = (count: number, domains: Place[][]): boolean => {
                let k = -1
                for (let j = 0; j < order.length; j++) if (!chosen[j] && (k < 0 || domains[j]!.length < domains[k]!.length)) k = j
                if (k < 0) return true
                for (const place of domains[k]!) {
                    if (++tried > budget) return false
                    chosen[k] = place
                    const next = domains.slice()
                    let empty = -1
                    for (const j of neighbors[k]!) {
                        if (chosen[j]) continue
                        next[j] = domains[j]!.filter((other) => !conflict(k, place, j, other))
                        if (next[j]!.length === 0) {
                            empty = j
                            break
                        }
                    }
                    if (empty < 0 && go(count + 1, next)) return true
                    // The label that got the furthest before a label had no place left is the one to name.
                    if (empty >= 0 && count + 1 > dead.placed) dead = { placed: count + 1, event: empty, blocker: k }
                    chosen[k] = null
                }
                return false
            }
            return go(0, all) ? (chosen as Place[]) : null
        }
        // A layout with few heights is a layout with more heights too. So the search starts with one height
        // and adds one when it fails, and more `levels` never make a line fail.
        let chosen: Place[] | null = null
        for (let limit = 1; limit <= levels && !chosen; limit++) chosen = solve(limit)
        if (!chosen) {
            const index = order[dead.event]!, blocker = dead.blocker === null ? null : order[dead.blocker]!
            // What can give this label a place, from the nearest change to the furthest. The object tries each one.
            const sides = [index, ...(blocker === null ? [] : [blocker])].flatMap((at) => {
                const side = events[at]!.side
                if (side === undefined) return []
                const turned = side === 'over' ? 'under' : 'over'
                return [withEvent(at, (event) => without(event, 'side'), `no side for event ${at}`), withEvent(at, (event) => ({ ...event, side: turned }), `side: '${turned}' for event ${at}`)]
            })
            const more = () => {
                for (let count = levels + 1; count <= levels + 4; count++) if (builds(events, { levels: count })) return `levels: ${count}`
                return null
            }
            const mark = inWay[dead.event] ?? null
            const twin = blocker ?? mark
            const oneDate = twin === null ? [] : [withEvent(index, (event) => ({ ...event, at: events[twin]!.at }), `at: ${written(events[twin]!.at)} for event ${index}`)]
            const bare = withEvent(index, (event) => without(event, 'label', 'note', 'side'), `no label for event ${index}`)
            const inOrder = ordered ? [] : [withOption({ scale: 'order', from: undefined, to: undefined, unit: undefined }, options.from !== undefined || options.to !== undefined || options.unit !== undefined ? "scale: 'order' without the ends and the unit of the line" : "scale: 'order'")]
            const ways = [...sides, more, ...oneDate, bare, wider(), ...inOrder]
            const label = `dateLine: the label of ${named(index)}`
            if (widths[index]! > w) throw failure(`${label} is ${Math.ceil(widths[index]!)} px wide, and the line is ${w}`, wider(Math.ceil(widths[index]!) + 1), bare)
            if (blocker !== null) throw failure(`${label} has no place. It meets the label of ${named(blocker)} at every height`, ...ways)
            const forced = events[index]!.side
            if (forced === 'under' && rowOf[index]! > 0) throw failure(`${label} has no place under the line. Its mark is in a row over the line, where a label goes over the line`, ...ways)
            if (mark !== null) throw failure(`${label} has no place${forced ? ` ${forced} the line` : ''}. The mark of ${named(mark)} is in its way`, ...ways)
            throw failure(`${label} has no place inside the line`, ...ways)
        }

        let top = -tick, bottom = rowBottom, leftmost = left, rightmost = right
        for (const one of numbers) {
            leftmost = Math.min(leftmost, one.box.x0)
            rightmost = Math.max(rightmost, one.box.x1)
        }
        const places: (Place | null)[] = events.map(() => null)
        order.forEach((index, k) => (places[index] = chosen![k]!))
        events.forEach((event, index) => {
            const place = places[index], x = xs[index]!, y = this.ys[index]!, color = event.color ?? 'ink', radius = radii[index]!
            const { label, note } = texts[index]!
            let mark: Node
            if (this.kinds[index] === 'star') {
                const points: Vec[] = []
                for (let k = 0; k < 10; k++) {
                    const angle = -Math.PI / 2 + (k * Math.PI) / 5, reach = k % 2 === 0 ? radius : radius * 0.45
                    points.push([reach * Math.cos(angle), reach * Math.sin(angle)])
                }
                mark = polygon(points, { fill: color, stroke: null })
            } else if (this.kinds[index] === 'ring') {
                // The fill is the color of the background, so the line does not show inside the ring.
                mark = circle(radius - weight / 2, { fill: 'bg', stroke: color, width: weight })
            } else {
                mark = dot(radius, color)
            }
            mark.at(x, y)
            // The ring of the lit event. A color alone would not say which event is lit, when an event has the accent color as its own.
            const halo = circle(radius + haloGap, { stroke: this.accent, width: haloWeight }).at(x, y).opacity(0)
            let stem: Node | null = null
            if (label && place) {
                const put = (made: TextNode, at: number) => {
                    const ink = made.bounds()
                    const from = place.align === 'right' ? place.box.x0 : place.align === 'left' ? place.box.x1 - ink.width : (place.box.x0 + place.box.x1) / 2 - ink.width / 2
                    made.at(from - ink.x, at)
                }
                const labelY = place.box.y0 + size * 0.38
                put(label, labelY)
                if (note) put(note, labelY + noteDrop)
                stem = line([x, place.from], [x, place.reach], { stroke: color, width: Math.max(1.5, size * 0.08) })
            }
            const node = new DateEventNode(mark, stem, label, note, halo)
            if (stem) node.add(stem)
            node.add(halo, mark)
            if (label) node.add(label)
            if (note) node.add(note)
            node.covers.push(...covers[index]!)
            // The room of the event is the room of its ink, which the object has before it hides the event.
            const ink = node.bounds()
            top = Math.min(top, ink.y)
            bottom = Math.max(bottom, ink.y + ink.height)
            leftmost = Math.min(leftmost, ink.x)
            rightmost = Math.max(rightmost, ink.x + ink.width)
            node.hide()
            this.events.push(node)
        })
        this.extent = { left: leftmost, right: rightmost, top, bottom }
        // A shape with no paint draws nothing and has bounds. It gives the object the room of all its
        // events from the start, so a zone or a group around a line holds the labels that are still hidden.
        this.add(new Node(rectPath(leftmost, top, rightmost - leftmost, bottom - top)), this.axis)

        this.drawCursor = options.cursor !== false
        this.cursor = polygon([[0, laneTop], [pointerWidth / 2, laneTop + pointerHeight], [-pointerWidth / 2, laneTop + pointerHeight]], { fill: 'ink', stroke: null }).at(this.xOf(first), 0).hide()
        this.add(this.cursor, ...this.events)
    }

    /**
     * The place of the cursor after the changes that are scheduled so far, as a number of years. It starts
     * at the first end of the line. With scale `'order'`, it is counted in events: 0 is the first date.
     */
    get date(): number {
        return this.cursorAt
    }

    /** The index of the event that has the accent color, after the changes that are scheduled so far. Null when no event is lit. */
    get lit(): number | null {
        return this.litIndex
    }

    /**
     * The x of a date, in the coordinates of the object. The middle of the line is at 0. With scale
     * `'order'`, the line has a place for the dates of its events only.
     */
    x(date: DateInput): number {
        return this.xOf(this.place(date, 'has no place for'))
    }

    /** The place of the mark of an event, in the coordinates of the object, by its index in the list. */
    p(index: number): [number, number] {
        const u = this.us[index]
        if (u === undefined) throw new Error(`dateLine: no event ${index}. The line has ${this.us.length} events`)
        return [this.xOf(u), this.ys[index]!]
    }

    /** The line draws from its first end, and its ticks and their texts arrive as it passes them. No event shows yet. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'dateLine.enter', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const span = ctx.t1 - ctx.t0, drawn = ctx.t0 + span * 0.7
                stepAt(this.rule, 'trimTo', 0, ctx.t0)
                this.rule.tween('trimTo', 1, ctx.t0, drawn, ctx.ease)
                // A tick and its text arrive when the end of the line that draws reaches them.
                this.marks.forEach((mark, index) => {
                    const start = ctx.t0 + (drawn - ctx.t0) * reaches(ctx.ease, (this.markXs[index]! + this.w / 2) / this.w)
                    stepAt(mark, 'opacity', 0, ctx.t0)
                    mark.tween('opacity', 1, start, Math.min(ctx.t1, start + span * 0.3), ctx.ease)
                })
            },
        }
    }

    /**
     * The cursor moves from its date to `to`, and stops. Each event that it passes appears: its mark, then
     * its stem, then its label. All of it is over when the animation ends: when the last event needs time
     * after the cursor reaches it, the cursor stops early.
     */
    advance(to: DateInput, options: AnimOptions = {}): Anim {
        // Find a wrong date now, where the film names it. Check again when the move is scheduled, because an
        // advance that is earlier in the same sequence moves the cursor first.
        this.checkAdvance(to)
        return {
            label: 'dateLine.advance', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => this.sweep(this.checkAdvance(to), ctx),
        }
    }

    /** The same as `advance` to the last end of the line. It takes 3 seconds when the film gives no duration. */
    showAll(options: AnimOptions = {}): Anim {
        return {
            label: 'dateLine.showAll', duration: options.duration ?? 3, ease: options.ease,
            schedule: (ctx) => this.sweep(this.domain[1], ctx),
        }
    }

    /**
     * One event takes the look of the lit event: the accent color on its mark, its stem and its label, and
     * a ring around its mark. The event that had this look takes its own color back. `light(null)` leaves
     * no event lit. An event that the cursor has not reached stays hidden, and it is lit when it appears.
     */
    light(index: number | null, options: AnimOptions = {}): Anim {
        if (index !== null && !(Number.isInteger(index) && index >= 0 && index < this.events.length)) throw new Error(`dateLine: cannot light event ${written(index)}. The line has the events 0 to ${this.events.length - 1}. Use null for no lit event`)
        return {
            label: 'dateLine.light', duration: options.duration ?? LIGHT, ease: options.ease,
            schedule: (ctx) => {
                const before = this.litIndex
                if (before === index) return
                if (before !== null) this.paint(before, false, ctx)
                if (index !== null) this.paint(index, true, ctx)
                this.litIndex = index
            },
        }
    }

    private xOf(u: number): number {
        const [first, last] = this.domain, [start, end] = this.ends
        return start + ((u - first) / (last - first)) * (end - start)
    }

    /** The place of a date on the line, in the unit of `domain`. */
    private place(date: DateInput, verb: string): number {
        if (this.ordered) {
            const slot = this.slots.indexOf(String(date).trim())
            if (slot < 0) throw new Error(`dateLine: the line ${verb} ${written(date)}. With scale 'order', it has the dates of its events: ${this.slots.map((words) => JSON.stringify(words)).join(', ')}`)
            return slot
        }
        const years = yearsOf(date)
        if (years === null) throw new Error(`dateLine: the line ${verb} ${written(date)}. A date is 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', or a number of years`)
        return years
    }

    private checkAdvance(to: DateInput): number {
        const u = this.place(to, 'cannot advance to')
        const [first, last] = this.domain
        if (u < first || u > last) throw new Error(`dateLine: cannot advance to ${written(to)}. The line goes from ${this.endsText[0]} to ${this.endsText[1]}`)
        if (u < this.cursorAt) throw new Error(`dateLine: cannot advance to ${written(to)}. The cursor is past it, and it does not go back`)
        return u
    }

    /** Write the keys of one advance, from the place of the cursor to `to`, and move the bookkeeping. */
    private sweep(to: number, ctx: AnimContext): void {
        const { t0, t1 } = ctx
        const from = this.cursorAt, first = !this.started, moves = to > from
        reveal(this, t0, ctx.stage)
        // The share of the travel time at which the cursor reaches a place.
        const ease = forwardOnly(ctx.ease)
        const share = (u: number) => (moves ? reaches(ease, (u - from) / (to - from)) : 0)
        // An event is due once: when the cursor reaches it. An event at the first end of the line is due on the first advance.
        const due = this.us.map((u, index) => ({ u, index })).filter(({ u }) => u <= to && (u > from || (u === from && first)))
        // The cursor stops early by the least time that lets every event arrive with the end of the
        // animation. It keeps 0.6 of the time at least. With less time than that, the events arrive faster.
        const whole = t1 - t0
        let tail = 0
        for (const { u } of due) if (share(u) > 0) tail = Math.max(tail, (REVEAL - whole * (1 - share(u))) / share(u))
        const arrive = t1 - Math.min(tail, whole * 0.4)

        if (first && this.drawCursor) {
            stepAt(this.cursor, 'visible', true, t0)
            stepAt(this.cursor, 'opacity', 0, t0)
            this.cursor.tween('opacity', 1, t0, Math.min(t1, t0 + 0.3), smooth)
        }
        if (moves) this.cursor.track('x').add({ t0, t1: arrive, ease, to: this.xOf(to), at: (alpha) => this.xOf(from + (to - from) * alpha) })
        for (const { u, index } of due) {
            const start = t0 + share(u) * (arrive - t0)
            this.showEvent(index, start, Math.min(t1, start + REVEAL))
        }
        this.cursorAt = to
        this.started = true
    }

    /** Write the keys that bring one event, from `start` to `end`. */
    private showEvent(index: number, start: number, end: number): void {
        const node = this.events[index]!
        const grown = start + (end - start) * 0.5
        stepAt(node, 'visible', true, start)
        for (const prop of ['sx', 'sy'] as const) {
            stepAt(node.mark, prop, 0.3, start)
            node.mark.tween(prop, 1, start, grown, smooth)
        }
        stepAt(node.mark, 'opacity', 0, start)
        node.mark.tween('opacity', 1, start, grown, smooth)
        // The stem draws from the line to the label.
        if (node.stem) {
            stepAt(node.stem, 'trimTo', 0, start)
            node.stem.tween('trimTo', 1, start, grown, smooth)
        }
        for (const words of [node.text, node.note]) {
            if (!words) continue
            stepAt(words, 'opacity', 0, start)
            words.tween('opacity', 1, grown, end, smooth)
        }
    }

    /** Write the keys that give one event the look of the lit event, or its own look: the color of its mark, its stem and its label, and the ring around its mark. A note stays in dim. */
    private paint(index: number, lit: boolean, ctx: AnimContext): void {
        const node = this.events[index]!, to = toPaint(lit ? this.accent : this.colors[index]!)
        node.mark.tween(this.kinds[index] === 'ring' ? 'stroke' : 'fill', to, ctx.t0, ctx.t1, ctx.ease)
        node.stem?.tween('stroke', to, ctx.t0, ctx.t1, ctx.ease)
        for (const glyph of node.text?.chars ?? []) glyph.tween('fill', to, ctx.t0, ctx.t1, ctx.ease)
        node.halo.tween('opacity', lit ? 1 : 0, ctx.t0, ctx.t1, ctx.ease)
    }
}

/**
 * A line of time with events at their dates:
 * `dateLine([{ at: '2025-06-10', label: 'the newsletter' }, { at: '2026-03-24', label: 'the report', note: 'names the system' }], { width: 1600, from: 2020, to: 2027 })`.
 */
export function dateLine(events: readonly DateEvent[], options: DateLineOptions = {}): DateLine {
    return new DateLine(events, options)
}
