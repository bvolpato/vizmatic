import { Node, dynamic, objectName, ownLabels, reportsTime } from '../node'
import { changesAt, changesNow } from '../track'
import { rect } from '../shapes'
import { text, type TextOptions } from '../text'
import type { ColorInput } from '../color'

export interface TagOptions {
    /** Plain text beside the pill, such as the source of a claim and its date. It stays on one line. */
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
    /**
     * The point that `.at(x, y)` places: the left end of the pill, the middle of the pill and its note, or the
     * right end of the note. Defaults to left, as for a chip and a row of chips.
     */
    anchor?: 'left' | 'center' | 'right'
}

/**
 * A word in a pill, with a note beside it: the kind of claim that is on the screen, and where it comes
 * from. `.at(x, y)` places the left end of the pill, so tags with words of different lengths start at one x.
 * With `anchor: 'right'`, it places the right end, for a tag at the right edge of the frame.
 */
export class Tag extends Node {
    readonly pill: Node
    readonly word: Node
    readonly note: Node | null

    constructor(word: string, options: TagOptions = {}) {
        super()
        if (word.trim() === '') throw new Error('tag: give it a word')
        const size = options.size ?? 26
        const color = options.color ?? 'dim'
        const height = size * 1.8
        this.word = text(word, { font: options.font ?? 'mono', size, color, anchor: 'left' })
        // The pill is as wide as the ink of the word, with the same room on both sides.
        const ink = this.word.bounds()
        const width = ink.width + size * 1.4
        this.pill = rect(width, height, { radius: height / 2, fill: options.fill === undefined ? 'surface' : options.fill, stroke: color, width: Math.max(2, size * 0.095) }).at(width / 2, 0)
        this.word.shift(width / 2 - (ink.x + ink.width / 2), 0)
        this.note = options.note ? text(options.note, { font: options.noteFont, size, color: options.noteColor ?? 'dim', anchor: 'left' }).at(width + size * 0.7, 0) : null
        this.add(this.pill, this.word)
        if (this.note) this.add(this.note)
        if (options.anchor === 'center' || options.anchor === 'right') {
            // The right end is the end of the ink of the note, or the border of the pill without a note.
            const ink = this.note?.bounds()
            const length = ink ? ink.x + ink.width : width
            for (const part of this.children) part.shift(options.anchor === 'right' ? -length : -length / 2, 0)
        }
        ownLabels(this, { name: 'tag' })
    }

    /** Recolor the border of the pill and the word. The fill of the pill and the note keep their colors. */
    override color(color: ColorInput): this {
        const fill = this.pill.get('fill')
        this.pill.color(color)
        this.pill.set('fill', fill)
        this.word.color(color)
        return this
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
    /** Seconds to fade a state in and out. Defaults to 0.25 and 0.18. */
    fadeIn?: number
    fadeOut?: number
}

/**
 * A tag that changes with time, at one place. It takes the states in order. One state is on screen at a
 * time: a state fades out before the next one fades in. States that start out of order, or less than the
 * two fades apart, are an error, so no moment shows two tags.
 *
 * Place it as any node: `tagTrack(states, { until }).at(-912, -490)` is the top left of a 1920 by 1080 frame.
 * It is pinned, so a move or a zoom of the camera does not move it.
 */
export function tagTrack(states: readonly TagState[], options: TagTrackOptions): Node {
    const fadeIn = options.fadeIn ?? 0.25, fadeOut = options.fadeOut ?? 0.18
    if (!(fadeIn >= 0 && fadeOut >= 0)) throw new Error('tagTrack: fadeIn and fadeOut are seconds, 0 or more')
    if (states.length === 0) throw new Error('tagTrack: give it at least one state')
    if (!Number.isFinite(options.until)) throw new Error('tagTrack: until is the time when the last state leaves, in seconds')
    const least = Math.round((fadeIn + fadeOut) * 1000) / 1000
    states.forEach((state, index) => {
        if (!Number.isFinite(state.at)) throw new Error(`tagTrack: state ${index} (${JSON.stringify(state.word)}) needs a time in seconds`)
        const end = index + 1 < states.length ? states[index + 1]!.at : options.until
        // A sum such as 1 + 0.43 is not exact, so allow a millionth of a second.
        if (end - state.at < least - 1e-6) {
            const next = index + 1 < states.length ? `state ${index + 1} (${JSON.stringify(states[index + 1]!.word)}) starts at ${end}` : `the tag leaves at ${end}`
            throw new Error(`tagTrack: state ${index} (${JSON.stringify(state.word)}) starts at ${state.at} and ${next}. A state needs ${least} s to fade in and out`)
        }
    })
    // Build each state once, now. A text needs its font, and the film loads fonts while it is built.
    const { until, fadeIn: _in, fadeOut: _out, ...shared } = options
    const tags = states.map(({ at: _at, word, ...own }) => tag(word, { ...shared, ...own }))
    // The track uses the time for its states and their fades, and it reports each of them.
    const made = dynamic(reportsTime((time) => {
        let index = -1
        for (let k = 0; k < states.length; k++) if (time >= states[k]!.at) index = k
        // Nothing shows before the first state, and nothing after the last one leaves.
        if (index < 0) changesAt(states[0]!.at)
        if (index < 0 || time >= until) return null
        const start = states[index]!.at
        const end = index + 1 < states.length ? states[index + 1]!.at : until
        const rise = fadeIn > 0 ? (time - start) / fadeIn : 1
        const fall = fadeOut > 0 ? (end - time) / fadeOut : 1
        // Between its two fades a state is whole. It stays so until its fade out starts.
        if (rise >= 1 && fall >= 1) changesAt(fadeOut > 0 ? end - fadeOut : end)
        else changesNow()
        const alpha = Math.max(0, Math.min(1, rise, fall))
        return alpha < 0.01 ? null : tags[index]!.opacity(alpha)
    }))
    return objectName(made.pin(), 'tag track')
}
