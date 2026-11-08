import { Node, dynamic } from '../node'
import { rect } from '../shapes'
import { text, type TextOptions } from '../text'
import type { ColorInput } from '../color'

export interface TagOptions {
    /** Plain text beside the pill, such as the source of a claim and its date. */
    note?: string
    /** The color of the pill and its word. Defaults to dim. */
    color?: ColorInput
    /** The color of the note. Defaults to dim. */
    noteColor?: ColorInput
    /** Font size of the word and the note. Defaults to 26. */
    size?: number
    /** The font of the word. Defaults to mono. */
    font?: TextOptions['font']
    /** The font of the note. Defaults to the font of `text()`. */
    noteFont?: TextOptions['font']
    /** The fill of the pill. Pass null for none. Defaults to the surface color. */
    fill?: ColorInput | null
}

/**
 * A word in a pill, with a note beside it: the kind of claim that is on the screen, and where it comes
 * from. `.at(x, y)` places the left end of the pill, so tags with words of different lengths start at one x.
 */
export class Tag extends Node {
    readonly pill: Node
    readonly word: Node
    readonly note: Node | null

    constructor(word: string, options: TagOptions = {}) {
        super()
        const size = options.size ?? 26
        const color = options.color ?? 'dim'
        const height = size * 1.8
        this.word = text(word, { font: options.font ?? 'mono', size, color, anchor: 'left' })
        // The pill is as wide as the advance of the word, with the same room on both sides.
        const inner = this.word.bounds().width
        const width = inner + size * 1.4
        this.pill = rect(width, height, { radius: height / 2, fill: options.fill === undefined ? 'surface' : options.fill, stroke: color, width: Math.max(2, size * 0.095) }).at(width / 2, 0)
        const ink = this.word.bounds()
        this.word.shift(width / 2 - (ink.x + ink.width / 2), 0)
        this.note = options.note ? text(options.note, { font: options.noteFont, size, color: options.noteColor ?? 'dim', anchor: 'left' }).at(width + size * 0.7, 0) : null
        this.add(this.pill, this.word)
        if (this.note) this.add(this.note)
    }
}

/** A word in a pill with a note, such as `tag('MEASURED', { note: 'the study of June 2026', color: 'green' }).at(-912, -490)`. */
export function tag(word: string, options: TagOptions = {}): Tag {
    return new Tag(word, options)
}

export interface TagState extends TagOptions {
    /** When this state starts, in seconds of the film. */
    at: number
    word: string
}

export interface TagTrackOptions extends TagOptions {
    /** When the last state leaves, in seconds of the film. */
    until: number
    /** The left end of the pill. Defaults to the top left of a 1920 by 1080 frame: (-912, -490). */
    x?: number
    y?: number
    /** Seconds to fade a state in and out. Defaults to 0.25 and 0.18. */
    fadeIn?: number
    fadeOut?: number
}

/**
 * A tag that changes with time, at one place. It takes the states in order. One state is on screen at a
 * time: a state fades out before the next one fades in. States that start out of order, or less than the
 * two fades apart, are an error, so no moment shows two tags.
 */
export function tagTrack(states: readonly TagState[], options: TagTrackOptions): Node {
    const fadeIn = options.fadeIn ?? 0.25, fadeOut = options.fadeOut ?? 0.18
    const least = fadeIn + fadeOut
    if (states.length === 0) throw new Error('tagTrack: give it at least one state')
    states.forEach((state, index) => {
        const end = index + 1 < states.length ? states[index + 1]!.at : options.until
        if (end - state.at < least) {
            const next = index + 1 < states.length ? `state ${index + 1} (${JSON.stringify(states[index + 1]!.word)}) starts at ${end}` : `the tag leaves at ${end}`
            throw new Error(`tagTrack: state ${index} (${JSON.stringify(state.word)}) starts at ${state.at} and ${next}. A state needs ${least} s to fade in and out`)
        }
    })
    const x = options.x ?? -912, y = options.y ?? -490
    const made = dynamic((time) => {
        let index = -1
        for (let k = 0; k < states.length; k++) if (time >= states[k]!.at) index = k
        if (index < 0 || time >= options.until) return null
        const state = states[index]!
        const end = index + 1 < states.length ? states[index + 1]!.at : options.until
        const alpha = Math.max(0, Math.min(1, (time - state.at) / fadeIn, (end - time) / fadeOut))
        if (alpha < 0.01) return null
        const { at: _, word, ...own } = state
        return tag(word, { ...options, ...own }).at(x, y).opacity(alpha)
    })
    return made
}
