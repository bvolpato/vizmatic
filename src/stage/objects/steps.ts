import { Node, ownLabels } from '../node'
import { rect } from '../shapes'
import { text, type TextNode, type TextOptions } from '../text'
import { mixColor, parseColor, toPaint, type ColorInput } from '../color'
import type { Ease } from '../ease'
import type { Anim, AnimOptions } from '../anim'
import { reveal, staggered, stepAt } from './util'

export interface Step {
    /** The name of the step, on one line. */
    label: string
    /** A short text under the box, such as the price of the step. It has one line, or two with a line break. */
    note?: string
}

/** Where a step is: the lit one, one before it, or one after it. */
export type StepState = 'current' | 'done' | 'ahead'

export type StepEdge = 'top' | 'bottom' | 'left' | 'right'

export interface StepsOptions {
    /** In a row: the width of the whole row. In a column: the width of each box. Defaults to 1600 for a row and to 360 for a column. */
    width?: number
    /** The height of one box. Defaults to 2.2 of `size`. A height with no room for a letter with a tail is an error. */
    height?: number
    /** The room between two boxes. Defaults to 0.6 of `size`. */
    gap?: number
    /** Text size of the labels. A label that is too wide for its box makes all labels smaller, down to 0.7 of this size. Defaults to 28. */
    size?: number
    /** Text size of the notes. Defaults to 0.9 of `size`. */
    noteSize?: number
    /** Write the number of each step before its label: "1 batching", "2 SQPOLL". */
    numbered?: boolean
    /** The index of the lit step, or null for none. Defaults to null. */
    current?: number | null
    /** `'row'` puts the boxes side by side. `'column'` puts them one under the other, with the labels at the left. Defaults to row. */
    direction?: 'row' | 'column'
    /** The color of the border of the lit step. Defaults to ink. */
    color?: ColorInput
    font?: TextOptions['font']
}

// The smallest text, as a part of its size. A longer text is an error, because a strip with one small label reads badly.
const FLOOR = 0.7
// The height of a line of a note of two lines, as a multiple of its text size.
const NOTE_LEADING = 1.25
// How much of dim is in the text of a step that is ahead. The rest is faint. Faint alone is too weak on a
// box: a viewer must be able to read the steps to come. With this share, the contrast of the text on its
// box is over 3 in every look, and a done step is still clearly stronger.
const AHEAD_DIM = 0.4

/** The advance width of a line of text. It includes the side bearings, which the bounds of the ink do not. */
const advance = (node: Node) => node.get('px') * 2

/** A value as the film wrote it, for an error. */
const shown = (value: unknown) => (typeof value === 'string' ? JSON.stringify(value) : String(value))

/**
 * A row of named steps with one of them lit: the chapters of an argument, the stages of a process, or a
 * list of options that the film goes through one by one. The steps before the lit one are dim, and the
 * steps after it are weaker, and still readable. `go(index)` moves the light. `.at()` places the middle of
 * the boxes. The notes are outside them: under the row, or between the boxes of a column.
 */
export class Steps extends Node {
    /** One node per step, which holds its box, its label and its note. */
    readonly items: Node[] = []
    readonly boxes: Node[] = []
    readonly labels: TextNode[] = []
    /** The note of each step, or null for a step that has none. */
    readonly notes: (TextNode | null)[] = []
    private readonly names: string[]
    private readonly column: boolean
    private readonly boxWidth: number
    private readonly boxHeight: number
    /** The middle of each box. */
    private readonly middles: [number, number][] = []
    /** How far under the bottom of its box the room of the note of each step ends. 0 for a step with no note. */
    private readonly drops: number[]
    private readonly litColor: ColorInput
    /** The color of the label and the note of a step that is ahead. */
    private readonly aheadColor: ColorInput
    private readonly weights: { lit: number; rest: number }
    private lit: number | null

    constructor(steps: readonly (string | Step)[], options: StepsOptions = {}) {
        super()
        if (steps.length === 0) throw new Error('steps: give it at least one step')
        const specs = steps.map((step) => (typeof step === 'string' ? { label: step } : step))
        specs.forEach((step, index) => {
            if (typeof step.label !== 'string' || step.label.trim() === '') throw new Error(`steps: step ${index} has no label. Give each step a label`)
            // A second line would leave the box. A step has a note for that.
            if (/[\n\r]/.test(step.label.trim())) throw new Error(`steps: the label of step ${index} (${JSON.stringify(step.label)}) has a line break. A label is one line. Give the step a note for a second line`)
        })
        const direction = options.direction ?? 'row'
        if (direction !== 'row' && direction !== 'column') throw new Error(`steps: direction is 'row' or 'column', not ${JSON.stringify(direction)}`)
        const column = this.column = direction === 'column'
        const size = options.size ?? 28
        if (!(Number.isFinite(size) && size > 0)) throw new Error('steps: size is the text size of the labels, more than 0')
        const noteSize = options.noteSize ?? Math.round(size * 0.9)
        if (!(Number.isFinite(noteSize) && noteSize > 0)) throw new Error('steps: noteSize is the text size of the notes, more than 0')
        const width = options.width ?? (column ? 360 : 1600)
        const height = this.boxHeight = options.height ?? Math.round(size * 2.2)
        const gap = options.gap ?? Math.round(size * 0.6)
        if (!(Number.isFinite(gap) && gap >= 0)) throw new Error('steps: gap is the room between two boxes, 0 or more')
        const count = specs.length
        // The room between the border of a box and its label, at each side.
        const pad = size * 0.75
        const boxWidth = this.boxWidth = column ? width : (width - (count - 1) * gap) / count
        // The width that gives each box a width, for an error that says what to do.
        const widthFor = (box: number) => Math.ceil(column ? box : box * count + (count - 1) * gap)
        if (!(Number.isFinite(width) && boxWidth > pad * 2)) {
            throw new Error(`steps: a width of ${width} gives ${column ? 'the boxes' : `each of the ${count} boxes`} ${Number.isFinite(boxWidth) ? Math.max(0, Math.floor(boxWidth)) : 0} px, with no room for a label. Give a width of more than ${widthFor(pad * 2)}${column ? '' : ', a smaller gap, or fewer steps'}`)
        }
        const font = options.font
        this.weights = { lit: Math.max(2.5, size * 0.11), rest: Math.max(1.5, size * 0.075) }
        // A label is in the middle of its box. The box holds the highest and the lowest letters of the
        // font, the wide border of the lit step, and a little room. The letters are measured, so the
        // limit is right for each font.
        const letters = text('\u00c1fjy(', { size, font }).bounds()
        const least = Math.ceil(2 * (Math.max(-letters.y, letters.y + letters.height) + this.weights.lit / 2 + size * 0.08))
        if (!(Number.isFinite(height) && height >= least)) throw new Error(`steps: a height of ${shown(height)} has no room for a label of size ${size}: a letter with a tail would touch the border. Give a height of ${least} or more`)
        // A color that the look does not have is an error here, where the film names it, and not at the
        // first move of the light.
        this.litColor = options.color ?? 'ink'
        try {
            toPaint(this.litColor)
        } catch {
            throw new Error(`steps: color is ${shown(this.litColor)}, which is not a color. Use a color of the look, such as 'orange', or a CSS color`)
        }
        this.aheadColor = mixColor(parseColor('faint'), parseColor('dim'), AHEAD_DIM)
        const start = options.current === undefined ? null : options.current
        this.names = specs.map((step, index) => (options.numbered ? `${index + 1} ${step.label.trim()}` : step.label.trim()))
        this.lit = this.lightAt(start)

        // In a numbered column, the numbers are a column of their own: they end at one x, and so the
        // names start at one x, also from "9" to "10". A label keeps its number and its name in one text,
        // and starts further right when its number is narrower than the widest one.
        const numberWidths = specs.map((_, index) => (column && options.numbered ? advance(text(String(index + 1), { size, font })) : 0))
        const widestNumber = Math.max(...numberWidths)
        const indents = numberWidths.map((wide) => widestNumber - wide)
        // The labels of a strip have one size: the size at which the widest one is in its box.
        const room = boxWidth - pad * 2
        const widths = this.names.map((name, index) => advance(text(name, { size, font })) + indents[index]!)
        const widest = Math.max(...widths)
        const scale = Math.min(1, room / widest)
        if (scale < FLOOR) {
            const name = this.names[widths.indexOf(widest)]!
            throw new Error(`steps: the label ${JSON.stringify(name)} is ${Math.ceil(widest)} px wide at size ${size}, and a box is ${Math.floor(boxWidth)} px wide, with ${Math.floor(room)} px for its label. A label can be ${FLOOR} of the size at the least. Use a shorter label, or a width of ${widthFor(widest * FLOOR + pad * 2)} or more${column ? '' : ', or fewer steps'}`)
        }
        const labelSize = size * scale

        // A note has one line, or two. In a row, it is narrower than its box, so the notes of two steps
        // that are neighbors read as two texts. In a column, it starts where the labels start, and ends
        // inside the width of the box.
        const noted = specs.map((step, index) => {
            if (step.note === undefined || step.note.trim() === '') return null
            const lines = step.note.trim().split(/\r?\n/).map((line) => line.trim())
            if (lines.length > 2) throw new Error(`steps: the note of step ${index} has ${lines.length} lines. A note has two lines at the most`)
            return lines
        })
        const noteRoom = boxWidth - (column ? pad : size * 0.5)
        const noteWidths = noted.map((lines) => (lines === null ? 0 : Math.max(...lines.map((line) => advance(text(line, { size: noteSize, font }))))))
        const widestNote = Math.max(...noteWidths)
        const noteScale = widestNote > 0 ? Math.min(1, noteRoom / widestNote) : 1
        if (noteScale < FLOOR) {
            const lines = noted[noteWidths.indexOf(widestNote)]!
            throw new Error(`steps: the note ${JSON.stringify(lines.join('\n'))} is ${Math.ceil(widestNote)} px wide at size ${noteSize}, and a box is ${Math.floor(boxWidth)} px wide, with ${Math.floor(noteRoom)} px for its note. A note can be ${FLOOR} of the size at the least. Use a shorter note, or a width of ${widthFor(widestNote * FLOOR + boxWidth - noteRoom)} or more${column ? '' : ', or fewer steps'}`)
        }
        const noteText = noteSize * noteScale
        // The base line of a note and the bottom of its tails, from the place that `.at()` gives a text of
        // one line. They are measured, so the room under a note is right for each font.
        const flat = text('H', { size: noteText, font }).bounds(), tails = text('gjpqy(', { size: noteText, font }).bounds()
        const noteBase = flat.y + flat.height
        const noteTail = tails.y + tails.height - noteBase
        // From the bottom of a box to the base line of the first line of its note.
        const noteRise = noteSize * 1.25
        const noteLine = NOTE_LEADING * noteText
        // The room of a note ends 0.3 of the note size under the tails of its last line. A line from the
        // bottom point of the step starts there, clear of the letters.
        this.drops = noted.map((lines) => (lines === null ? 0 : noteRise + (lines.length - 1) * noteLine + noteTail + noteSize * 0.3))
        // In a column, a note is between its box and the next one, so the boxes are further apart, by the room of the longest note.
        const pitch = column ? height + gap + Math.max(...this.drops) : boxWidth + gap
        const first = -((count - 1) * pitch) / 2

        specs.forEach((_, index) => {
            const x = column ? 0 : first + index * pitch, y = column ? first + index * pitch : 0
            const look = this.look(this.stateAt(index, this.lit))
            const box = rect(boxWidth, height, { radius: Math.min(height * 0.2, size * 0.45), fill: 'surface', stroke: look.stroke, width: look.width }).at(x, y)
            // In a row, the label is in the middle of its box, with its number.
            const label = column
                ? text(this.names[index]!, { size: labelSize, font, color: look.label, anchor: 'left' }).at(x - boxWidth / 2 + pad + indents[index]! * scale, y)
                : text(this.names[index]!, { size: labelSize, font, color: look.label }).at(x, y)
            const item = new Node().add(box, label)
            let note: TextNode | null = null
            const lines = noted[index] ?? null
            if (lines !== null) {
                // A text of two lines has its place at the middle of its lines.
                const at = y + height / 2 + noteRise - noteBase + ((lines.length - 1) * noteLine) / 2
                note = column
                    ? text(lines.join('\n'), { size: noteText, font, color: look.note, anchor: 'left', align: 'left', leading: NOTE_LEADING }).at(x - boxWidth / 2 + pad, at)
                    : text(lines.join('\n'), { size: noteText, font, color: look.note, align: 'center', leading: NOTE_LEADING }).at(x, at)
                item.add(note)
            }
            this.middles.push([x, y])
            this.boxes.push(box)
            this.labels.push(label)
            this.notes.push(note)
            this.items.push(item)
            this.add(item)
        })
        // The strip places each label in its box and each note under its box. The film check does not judge that room.
        ownLabels(this, { name: 'strip of steps' })
    }

    /** The index of the lit step after the changes that are scheduled so far, or null when no step is lit. */
    get current(): number | null {
        return this.lit
    }

    /** The state of a step after the changes that are scheduled so far. With no lit step, every step is `'done'`: dim, and readable. */
    stateOf(index: number): StepState {
        return this.stateAt(this.checked(index), this.lit)
    }

    /**
     * A point on an edge of the box of a step, in the coordinates of the object, for a connector to the
     * picture of the step. Without an edge: the bottom in a row, and the right side in a column. The
     * bottom point of a step that has a note is under the note, with clear room under the tails of its
     * letters, so a line from it does not touch the note.
     */
    p(index: number, edge?: StepEdge): [number, number] {
        const [x, y] = this.middles[this.checked(index)]!
        const side = edge ?? (this.column ? 'right' : 'bottom')
        if (side === 'top') return [x, y - this.boxHeight / 2]
        if (side === 'bottom') return [x, y + this.boxHeight / 2 + this.drops[index]!]
        if (side === 'left') return [x - this.boxWidth / 2, y]
        if (side === 'right') return [x + this.boxWidth / 2, y]
        throw new Error(`steps: edge is 'top', 'bottom', 'left' or 'right', not ${JSON.stringify(edge)}`)
    }

    /** The steps arrive one after another, from the first to the last, each one with the look of its state. */
    enter(options: AnimOptions = {}): Anim {
        return {
            label: 'steps.enter', duration: options.duration ?? 1.2, ease: options.ease,
            schedule: (ctx) => {
                reveal(this, ctx.t0, ctx.stage)
                const windows = staggered(this.items.length, Math.max(0, options.lag ?? 0.5), ctx.t0, ctx.t1)
                this.items.forEach((item, index) => {
                    const [start, end] = windows[index]!
                    stepAt(item, 'opacity', 0, ctx.t0)
                    item.tween('opacity', 1, start, end, ctx.ease)
                })
            },
        }
    }

    /**
     * The light moves to another step, or goes off with null. Each step whose state changes takes its new
     * look: the lit one, a done one before it, or one that is ahead after it. A strip that is not on the
     * stage comes to it at the start of the move, in the state before the move.
     */
    go(index: number | null, options: AnimOptions = {}): Anim {
        // Find a wrong index now, where the film names it. The states change when the move is scheduled, so
        // that a second move in the same sequence starts from the first.
        const next = this.lightAt(index)
        return {
            label: 'steps.go', duration: options.duration ?? 0.4, ease: options.ease,
            schedule: (ctx) => {
                // An animation of an object brings it to the stage. Without this, a move on a strip that
                // the film did not add would draw nothing, and say nothing.
                reveal(this, ctx.t0, ctx.stage)
                const before = this.lit
                this.lit = next
                this.items.forEach((_, at) => {
                    const state = this.stateAt(at, next)
                    if (state !== this.stateAt(at, before)) this.paint(at, state, ctx.t0, ctx.t1, ctx.ease)
                })
            },
        }
    }

    private stateAt(index: number, lit: number | null): StepState {
        return lit === null || index < lit ? 'done' : index === lit ? 'current' : 'ahead'
    }

    private known(): string {
        return `The steps are ${this.names.map((name, index) => `${index} (${JSON.stringify(name)})`).join(', ')}`
    }

    /** The index of a step that the strip has, or an error that names the steps. */
    private checked(index: unknown, more = ''): number {
        if (typeof index !== 'number' || Number.isNaN(index)) throw new Error(`steps: the index of a step is a whole number, and ${shown(index)} is not a number. ${this.known()}${more}`)
        if (!Number.isInteger(index) || index < 0 || index >= this.names.length) throw new Error(`steps: no step ${index}. ${this.known()}${more}`)
        return index
    }

    /** The index of the step to light, or null for no light. */
    private lightAt(index: unknown): number | null {
        return index === null ? null : this.checked(index, '. Use null for no lit step')
    }

    private look(state: StepState): { stroke: ColorInput; width: number; label: ColorInput; note: ColorInput } {
        // A note has the state of its step: the note of the lit step is in ink, as its label is.
        if (state === 'current') return { stroke: this.litColor, width: this.weights.lit, label: 'ink', note: 'ink' }
        if (state === 'done') return { stroke: 'gridStrong', width: this.weights.rest, label: 'dim', note: 'dim' }
        return { stroke: 'grid', width: this.weights.rest, label: this.aheadColor, note: this.aheadColor }
    }

    private paint(index: number, state: StepState, t0: number, t1: number, ease: Ease): void {
        const look = this.look(state), box = this.boxes[index]!
        box.tween('stroke', toPaint(look.stroke), t0, t1, ease)
        box.tween('strokeWidth', look.width, t0, t1, ease)
        for (const glyph of this.labels[index]!.chars) glyph.tween('fill', toPaint(look.label), t0, t1, ease)
        for (const glyph of this.notes[index]?.chars ?? []) glyph.tween('fill', toPaint(look.note), t0, t1, ease)
    }
}

/** A row of named steps with one of them lit: `steps(['batching', 'SQPOLL', 'register', 'I/O polling'], { width: 1800, numbered: true, current: 0 })`. `strip.go(1)` moves the light. */
export function steps(list: readonly (string | Step)[], options: StepsOptions = {}): Steps {
    return new Steps(list, options)
}
