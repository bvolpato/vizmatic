/**
 * A film that follows a recorded voice. The film reads the measured length of every
 * spoken beat and the time of every word, and places each change on a spoken phrase.
 * A phrase that the voice does not say stops the build, so the picture cannot drift
 * from the script without an error.
 */
import { Value, delay, fade, fadeIn, fadeOut, type Anim } from './anim'
import { Block, describe } from './layout'
import { Node } from './node'
import type { Stage } from './stage'

/** One spoken word, timed in seconds from the start of its beat. */
export interface NarrationWord {
    text: string
    start: number
    end: number
}

/**
 * A cue that the script declares for a beat: a name for a moment of the voice. A scene names the id where
 * it can name a phrase, such as `c.show('brier-result', nodes)`. A declared cue that no scene uses stops
 * the build, so the script and the film cannot drift apart.
 */
export interface NarrationCue {
    /** The name that a scene uses. It is unique in its scene. */
    id: string
    /** The words of the beat that the cue stands for. The voice says them one time in the beat. */
    phrase: string
    /** What the script wants the film to know about the cue, such as a color or the name of a part. `c.cue(id).data` gives it. */
    data?: unknown
}

/** One take of the voice: a sentence or a short paragraph. */
export interface NarrationBeat {
    /** The text that the voice speaks. Captions use it. */
    say: string
    /** Measured length of the recording, in seconds. */
    duration: number
    /** Silence after the beat, in seconds, for the viewer to think. */
    hold?: number
    /** Word times, from the speech engine or from a transcription. Cues need them. */
    words?: readonly NarrationWord[]
    /** The cues that the script declares for this beat. */
    cues?: readonly NarrationCue[]
}

export interface NarrationScene {
    id: string
    /** Chapter title. A scene without one does not start a chapter. */
    title?: string
    /**
     * When the voice says the first word of the scene, in film seconds. Without it, the scene starts one gap
     * after the end of the scene before it, and the first scene starts at the lead. A tool that lays out its
     * own sound gives each scene its start. A scene cannot start before the scene before it ends.
     */
    start?: number
    beats: readonly NarrationBeat[]
}

export interface NarrationTiming {
    scenes: readonly NarrationScene[]
    /** Seconds before the first word. `NarrationOptions.lead` overrides it. */
    lead?: number
    /** Seconds of silence between scenes. `NarrationOptions.gap` overrides it. */
    gap?: number
}

export interface NarrationOptions {
    /** Seconds before the first word, for a logo or an opening picture. Defaults to 0.6. */
    lead?: number
    /** Seconds of silence between scenes, for the picture to change. Defaults to 0.4. */
    gap?: number
    /** Write a caption for each spoken line. On by default. */
    captions?: boolean
    /** Longest caption line, in characters. Defaults to 74. */
    captionLength?: number
    /** Start a chapter at each scene that has a title. On by default. */
    chapters?: boolean
}

/** Where one beat falls on the film's timeline, in seconds. */
export interface PlacedBeat {
    /** The first moment of the recording. */
    start: number
    /** The last moment of the recording. */
    end: number
    /** The end of the silence after it. */
    until: number
    text: string
    words: readonly NarrationWord[]
}

// The words of a text: its letters and its digits, of any script, without case and punctuation.
// A period stays only inside a number, such as 3.8, so "model." matches "model".
const tokens = (text: string): string[] => text.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, ' ').split(' ').map((token) => token.replace(/^\.+|\.+$/g, '')).filter(Boolean)

/** Split spoken text into caption lines: by sentence, then by length. */
export function captionLines(text: string, length = 74): string[] {
    const lines: string[] = []
    // A period inside a number, such as 3.8, does not end a sentence.
    for (const sentence of text.match(/[^.?!]+(?:[.?!]+(?=\s|$)|\.\d[^.?!]*[.?!]?|$)/g) ?? []) {
        let line = ''
        for (const word of sentence.split(/\s+/).filter(Boolean)) {
            if (line && line.length + word.length + 1 > length) {
                lines.push(line)
                line = word
            } else {
                line = line ? `${line} ${word}` : word
            }
        }
        if (line) lines.push(line)
    }
    return lines
}

/** Seconds before the first word of a scene at which a picture changes hands. See `SceneClock.keep`. */
export const HANDOVER = 0.3
// `clear` ends this long after the last word of a scene, with its default times.
const CLEAR_OVERRUN = 0.02

// The defaults of `show`, `hide` and `swap`. In eleven narrated films, the offset that a scene typed most for a
// cue was -0.1 seconds, and the length that it typed most for a fade was 0.3 seconds.
/** Seconds before a spoken phrase at which a change starts, so that the picture is there as the word is. */
const CUE_LEAD = 0.1
/** Seconds of a fade in and of a fade out. */
const CUE_FADE = 0.3
/** Seconds from one item of a staggered list to the next. */
const CUE_STAGGER = 0.3
/** The least seconds from one item of a staggered list to the next. Under it, a viewer does not see an order. */
const STAGGER_LEAST = 0.1
/** Seconds that the last item of a staggered list is up after its fade, before its scene starts to leave: the least time that the film check gives a text. */
const CUE_SEEN = 0.5
// In `swap`, the new picture starts this long after the old one starts to leave. The old one is under a
// quarter of its strength then, so two texts at one place are never both readable, and the frame is not empty.
const SWAP_WAIT = 0.2
/** The picture of a scene starts to leave this long before the end of the scene: `clear` starts its fade then, and so does the shell of `narrated()`. */
const LEAVE_LEAD = 0.24
const CUE_OPTIONS = ['beat', 'lead', 'fade', 'stagger', 'skipShown', 'after']
/** A node with less opacity than this is not on the screen for a viewer. */
const SEEN_LEAST = 0.01
/** Two times that are nearer than this are one time. */
const SAME_TIME = 1e-6

/** A spoken phrase, the id of a cue that the script declares, or the index of a beat for the moment that the beat starts. */
export type Cue = string | number

/** When the voice says a cue. A cue that the script declares also has its id, its phrase, its beat and its data. */
export interface CueTime {
    start: number
    end: number
    id?: string
    phrase?: string
    beat?: number
    data?: unknown
}

/** A cue that the script declares for a scene, with the beat that it is in. */
export interface DeclaredCue extends NarrationCue {
    beat: number
}

export interface CueOptions {
    /** Search the phrase in this beat only. Use it when the voice says the phrase in two beats. */
    beat?: number
    /**
     * Start when the voice has said the phrase, and not as it starts to say it: for a result that the voice
     * computes, which must not be on the screen before the voice gets there. The lead is then 0. With the
     * index of a beat as the cue, the change starts when the voice of the beat ends.
     */
    after?: boolean
    /** Seconds before the phrase. Defaults to 0.1, and to 0 with `after`. A negative lead is later. */
    lead?: number
    /** Seconds of the fade. Defaults to 0.3. */
    fade?: number
    /**
     * Bring the items one after another. `true` is 0.3 seconds between two items, and less when the list would
     * not fit before the scene starts to leave. A number is the seconds as typed. A list inside the list is one item.
     */
    stagger?: boolean | number
    /**
     * For `show` and `swap`: leave a node that shows already as it is, and bring the rest. Without it, a node
     * that shows already stops the build, because a second fade in would make it blink.
     */
    skipShown?: boolean
}

/** What `show`, `hide` and `swap` take: a node, a block of the layout, an animation to play as it is, or a list of these. */
export type Showable = Node | Block | Anim | readonly Showable[]

const isAnim = (item: unknown): item is Anim => typeof item === 'object' && item !== null && typeof (item as Anim).schedule === 'function'
/** A time for a message, in seconds. */
const stamp = (time: number): string => `${Math.round(time * 100) / 100} s`
const hundredths = (time: number): number => Math.round(time * 100) / 100

/** What a viewer sees of a node at a time, by the timeline as it is now: 0 when the node is not on the stage or hidden, or its opacity. */
function seenAt(node: Node, time: number): number {
    if (!node.mounted) return 0
    for (let up: Node | null = node; up; up = up.parent) {
        const visible = up.tracks?.get('visible')
        if (!(visible ? visible.sample(time) : up.base.visible)) return 0
    }
    const opacity = node.tracks?.get('opacity')
    return opacity ? opacity.sample(time) as number : node.base.opacity
}

/** One change that `show`, `hide` or `swap` made to a node: when it starts, when its fade ends, and the cue. */
interface Change {
    kind: 'show' | 'hide'
    at: number
    end: number
    /** The cue as a message names it: a phrase in quotes, or a beat. */
    cue: string
    what: string
}

/** The nodes of what `keep` and `take` get. A block of the layout stands for its nodes. */
function nodesOf(what: string, nodes: Node | Block | readonly (Node | Block)[]): Node[] {
    const list = nodes instanceof Node || nodes instanceof Block ? [nodes] : nodes
    if (!Array.isArray(list) || list.some((item) => !(item instanceof Node || item instanceof Block))) throw new Error(`narration: ${what} takes a node, a block of the layout, or a list of them`)
    return list.flatMap((item) => (item instanceof Block ? item.nodes : [item]))
}

/** The clock of one scene. Every time is in film seconds. */
export class SceneClock {
    /** When the next scene starts: the last word of this scene plus the gap. After the last scene, no scene starts then, and the film ends one tail later. */
    readonly next: number
    /** The nodes that `keep` holds for the next scene. `narrated()` reads them: it does not fade them at the end of the scene. */
    readonly kept = new Set<Node>()
    /** The nodes that `take` got from the scene before. `narrated()` reads them: it does not fade them in. */
    readonly taken = new Set<Node>()
    /**
     * The time that the picture of the scene has: from the moment that the scene before it is gone, to the
     * moment that this scene starts to leave, 0.24 seconds before its end. `show` and `swap` bring a node
     * inside this time, so a node never arrives over another scene. `narrated()` sets it to the times of its shell.
     */
    window: { from: number; to: number }
    /** What `show`, `hide` and `swap` did to each node, in the order of the calls. A second change of a node is checked against it. */
    private readonly changes = new Map<Node, Change[]>()
    /** The cues that the script declares for this scene, in the order of the script. A scene names one by its id. */
    readonly cues: readonly DeclaredCue[]
    /** The ids of the declared cues that the scene used. The narration reads them when the film is built. */
    readonly usedCues = new Set<string>()
    /** True when the film asked for this clock: the scene is built. The cues of a scene that is not built are not counted as unused. */
    asked = false

    constructor(
        /** The stage of the film. A helper that takes the clock, such as the claim tag of a kit, adds its node there. */
        readonly stage: Stage,
        readonly id: string,
        readonly start: number,
        readonly end: number,
        readonly beats: readonly PlacedBeat[],
        next: number = end,
        /** When the scene before this one is gone. 0 for the first scene. */
        opens = 0,
        cues: readonly DeclaredCue[] = [],
    ) {
        this.next = next
        this.window = { from: opens, to: Math.max(opens, end - LEAVE_LEAD) }
        this.cues = cues
    }

    /**
     * When the voice says a phrase, or a cue that the script declares: `c.cue('brier-result')`. Pass a beat
     * index to search one beat only. Throws if the phrase is not spoken, and if it is spoken two times: the
     * message names the beats, and says how to pick one. A declared cue also gives its phrase, its beat and
     * its data. In a scene that declares cues, a string that is the id of a cue is that cue, also when the
     * voice says the same words.
     */
    cue(phrase: string, beat?: number): CueTime {
        if (typeof phrase !== 'string') throw new Error(`narration: scene "${this.id}": a cue is a spoken phrase, and it is ${phrase === null ? 'null' : typeof phrase === 'object' ? 'an object' : String(phrase)}`)
        const declared = this.cues.find((cue) => cue.id === phrase)
        if (declared) {
            if (beat !== undefined && beat !== declared.beat) throw new Error(`narration: scene "${this.id}": the script declares the cue "${phrase}" for beat ${declared.beat}, and the call names beat ${beat}. A declared cue has its beat: leave the beat out`)
            this.usedCues.add(declared.id)
            return { ...this.spoken(declared.phrase, declared.beat), id: declared.id, phrase: declared.phrase, beat: declared.beat, ...(declared.data === undefined ? {} : { data: declared.data }) }
        }
        return this.spoken(phrase, beat)
    }

    /** When the voice says a phrase, in film seconds. */
    private spoken(phrase: string, beat?: number): { start: number; end: number } {
        const want = tokens(phrase)
        if (want.length === 0) {
            const ids = this.cues.length > 0 ? ` The cues that the script declares for this scene are: ${this.cues.map((cue) => cue.id).join(', ')}` : ''
            throw new Error(`narration: scene "${this.id}": the cue ${JSON.stringify(phrase)} has no letter and no digit, so it names no word of the voice. A cue is a word or a number that the voice says: write the words that the voice says for a symbol, such as "percent" for "%".${ids}`)
        }
        if (beat !== undefined && !this.beats[beat]) throw new Error(`narration: scene "${this.id}" has no beat ${beat}`)
        // One timed word can hold several spoken tokens, such as "twenty seven".
        const spoken = this.beats.map((placed) => placed.words.flatMap((word) => tokens(word.text).map((token) => ({ token, start: word.start, end: word.end }))))
        /** Each place where the voice says a list of words, in the beats that the call searches. */
        const places = (words: readonly string[]): { beat: number; at: number }[] => spoken.flatMap((said, index) => {
            if (beat !== undefined && index !== beat) return []
            const found: { beat: number; at: number }[] = []
            for (let i = 0; i + words.length <= said.length; i++) if (words.every((token, j) => said[i + j]!.token === token)) found.push({ beat: index, at: i })
            return found
        })
        const found = places(want)
        const where = beat === undefined ? '' : ` in beat ${beat}`
        if (found.length === 0) throw new Error(`narration: scene "${this.id}": the voice never says "${phrase}"${where}`)
        const time = (one: { beat: number; at: number }) => ({ start: this.beats[one.beat]!.start + spoken[one.beat]![one.at]!.start, end: this.beats[one.beat]!.start + spoken[one.beat]![one.at + want.length - 1]!.end })
        if (found.length > 1) {
            const said = found.map((one) => `in beat ${one.beat} at ${stamp(time(one).start)}`)
            // A longer phrase picks one place. With more words after it, the phrase starts at the same word, so the
            // cue keeps its time. With words before it, the phrase starts earlier: the message says by how much.
            const MORE = 5
            const longer = found.map((one) => {
                const words = spoken[one.beat]!.map((item) => item.token), from = time(one).start, last = one.at + want.length
                for (let to = last + 1; to <= Math.min(words.length, last + MORE); to++) {
                    const list = words.slice(one.at, to)
                    if (places(list).length === 1) return `"${list.join(' ')}" for the one at ${stamp(from)}`
                }
                for (let first = one.at - 1; first >= Math.max(0, one.at - MORE); first--) {
                    const list = words.slice(first, last)
                    if (places(list).length !== 1) continue
                    const earlier = from - (this.beats[one.beat]!.start + spoken[one.beat]![first]!.start)
                    return `"${list.join(' ')}" for the one at ${stamp(from)}, which starts ${hundredths(earlier)} s earlier`
                }
                return null
            })
            const picks = longer.filter((words): words is string => words !== null)
            const alone = found.filter((_, index) => longer[index] === null).map((one) => stamp(time(one).start))
            const byBeat = beat === undefined && new Set(found.map((one) => one.beat)).size === found.length
            const ways = [
                picks.length > 0 ? `Use a longer phrase: ${picks.join('; ')}` : 'No longer phrase picks one of them',
                picks.length > 0 && alone.length > 0 ? `No longer phrase picks the one at ${alone.join(' or at ')}` : '',
                byBeat ? `${picks.length > 0 ? 'Or name' : 'Name'} the beat: the option \`beat\` of show, hide and swap, and the last argument of on and after` : '',
                picks.length === 0 && !byBeat ? 'Use the index of the beat as the cue, with a lead, or change the words of the script' : '',
            ].filter(Boolean)
            throw new Error(`narration: scene "${this.id}": the voice says "${phrase}" ${found.length} times: ${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}. ${ways.join('. ')}`)
        }
        return time(found[0]!)
    }

    /** Build when the voice starts a phrase. `offset` moves it, in seconds. */
    on(phrase: string, build: () => void, offset = 0, beat?: number): this {
        this.stage.at(Math.max(0, this.cue(phrase, beat).start + offset), build)
        return this
    }

    /** Build when the voice finishes a phrase. */
    after(phrase: string, build: () => void, offset = 0, beat?: number): this {
        this.stage.at(Math.max(0, this.cue(phrase, beat).end + offset), build)
        return this
    }

    /** Build when a beat starts. */
    onBeat(index: number, build: () => void, offset = 0): this {
        const beat = this.beats[index]
        if (!beat) throw new Error(`narration: scene "${this.id}" has no beat ${index}`)
        this.stage.at(Math.max(0, beat.start + offset), build)
        return this
    }

    /** Build at a time counted from the start of the scene. */
    at(seconds: number, build: () => void): this {
        this.stage.at(Math.max(0, this.start + seconds), build)
        return this
    }

    /**
     * Fade nodes in when the voice says a phrase: `c.show('a network card', [icon, name])`. The change starts
     * 0.1 seconds before the phrase, and the fade takes 0.3 seconds, so a scene types no time. A cue is a
     * spoken phrase, or the index of a beat for the start of that beat. An animation in the list plays as it
     * is, at the same moment: `c.show('one host', [draw(frame), title])`. `stagger: true` brings the items one
     * after another, and a list inside the list arrives as one item. For a play of the scene's own, use `on`.
     *
     * A node shows one time. A node that shows already at the cue stops the build: the scene added it, another
     * cue brings it, or it is in two lists. `skipShown: true` leaves such a node as it is and brings the rest.
     */
    show(cue: Cue, items: Showable, options: CueOptions = {}): this {
        const { time, fade: length, name } = this.cueTime('show', cue, options)
        const units = this.arriving('show', name, this.units('show', items), time, options.skipShown === true)
        const times = this.arrivals('show', name, units.length, time, length, options.stagger)
        units.forEach((unit, index) => { for (const part of unit) if (part instanceof Node) this.bring('show', name, part, times[index]!, length) })
        this.stage.at(time, () => this.stage.play(...units.flatMap((unit, index) => unit.map((part) => delay(part instanceof Node ? fadeIn(part, { duration: length }) : part, times[index]! - time)))))
        return this
    }

    /**
     * Fade nodes out when the voice says a phrase: `c.hide('So there is a second line', recap)`. It has the
     * lead, the fade and the stagger of `show`. A node that is not on the screen at the cue stops the build.
     */
    hide(cue: Cue, items: Showable, options: CueOptions = {}): this {
        const { time, fade: length, name } = this.cueTime('hide', cue, options)
        const units = this.units('hide', items)
        const step = options.stagger === true ? CUE_STAGGER : typeof options.stagger === 'number' ? options.stagger : 0
        units.forEach((unit, index) => { for (const part of unit) if (part instanceof Node) this.leave('hide', name, part, time + index * step, length) })
        this.stage.at(time, () => this.stage.play(...units.flatMap((unit, index) => unit.map((part) => delay(part instanceof Node ? fadeOut(part, { duration: length }) : part, index * step)))))
        return this
    }

    /**
     * One picture leaves and the next one arrives at its place: `c.swap(1, firstList, secondList)`. The old
     * nodes fade out, and the new ones start to fade in 0.2 seconds later, so two texts at one place are
     * never both readable. It has the defaults and the options of `show`, and `stagger` is for the new items.
     */
    swap(cue: Cue, out: Showable, into: Showable, options: CueOptions = {}): this {
        const { time, fade: length, name } = this.cueTime('swap', cue, options)
        const leaving = this.units('swap', out).flat()
        const units = this.arriving('swap', name, this.units('swap', into), time + SWAP_WAIT, options.skipShown === true)
        const times = this.arrivals('swap', name, units.length, time + SWAP_WAIT, length, options.stagger)
        for (const part of leaving) if (part instanceof Node) this.leave('swap', name, part, time, length)
        units.forEach((unit, index) => { for (const part of unit) if (part instanceof Node) this.bring('swap', name, part, times[index]!, length) })
        this.stage.at(time, () => this.stage.play(
            ...leaving.map((part) => (part instanceof Node ? fadeOut(part, { duration: length }) : part)),
            ...units.flatMap((unit, index) => unit.map((part) => delay(part instanceof Node ? fadeIn(part, { duration: length }) : part, times[index]! - time))),
        ))
        return this
    }

    /** The time of a cue with its lead, the fade of its options, and the name of the cue for a message. All are checked. */
    private cueTime(what: string, cue: Cue, options: CueOptions): { time: number; fade: number; name: string } {
        const where = `narration: scene "${this.id}": ${what}`
        if (typeof cue !== 'string' && typeof cue !== 'number') {
            const given: unknown = cue
            const got = given instanceof Node || given instanceof Block || Array.isArray(given) ? 'a node or a list' : given === null ? 'null' : typeof given
            throw new Error(`${where}: the cue is ${got}. The cue comes first: a spoken phrase, or the index of a beat, such as c.${what}('a phrase', nodes)`)
        }
        if (typeof options !== 'object' || options === null || Array.isArray(options)) throw new Error(`${where}: the options are ${JSON.stringify(options)}, and they are an object such as { stagger: true }`)
        const names = what === 'hide' ? CUE_OPTIONS.filter((name) => name !== 'skipShown') : CUE_OPTIONS
        const unknown = Object.keys(options).filter((name) => !names.includes(name))
        if (unknown.length > 0) throw new Error(`${where} has no option "${unknown[0]}". Its options are: ${names.join(', ')}. For another change at a phrase, use on`)
        const lead = options.lead ?? (options.after === true ? 0 : CUE_LEAD), length = options.fade ?? CUE_FADE
        if (!Number.isFinite(lead)) throw new Error(`${where}: lead is ${JSON.stringify(options.lead)}, and it is the seconds before the phrase, such as 0.4`)
        if (!(Number.isFinite(length) && length > 0)) throw new Error(`${where}: fade is ${JSON.stringify(options.fade)}, and it is the seconds of the fade, more than 0`)
        const { stagger } = options
        if (!(stagger === undefined || typeof stagger === 'boolean' || (Number.isFinite(stagger) && stagger >= 0))) throw new Error(`${where}: stagger is ${JSON.stringify(stagger)}, and it is true, or the seconds between two items`)
        if (options.skipShown !== undefined && typeof options.skipShown !== 'boolean') throw new Error(`${where}: skipShown is ${JSON.stringify(options.skipShown)}, and it is true or false`)
        if (options.after !== undefined && typeof options.after !== 'boolean') throw new Error(`${where}: after is ${JSON.stringify(options.after)}, and it is true, for a change that starts when the voice has said the phrase`)
        // With `after`, the change waits for the end of the phrase, or for the end of the voice of the beat.
        const after = options.after === true
        let start: number
        if (typeof cue === 'number') {
            const beat = this.beats[cue]
            if (!beat) throw new Error(`narration: scene "${this.id}" has no beat ${cue}. A cue is a spoken phrase, or the index of a beat from 0 to ${this.beats.length - 1}`)
            if (options.beat !== undefined) throw new Error(`${where}: the cue is the beat ${cue}, so the option \`beat\` has no job. It picks the beat of a spoken phrase`)
            start = after ? beat.end : beat.start
        } else {
            const said = this.cue(cue, options.beat)
            start = after ? said.end : said.start
        }
        const name = typeof cue === 'number' ? `beat ${cue}` : `"${cue}"`
        // A change with the lead of the library starts when the picture of the scene opens, at the earliest.
        // A lead that the scene typed is exact, so it stops the build when it does not fit.
        const from = this.window.from
        if (start - lead < from - SAME_TIME && options.lead !== undefined) {
            throw new Error(`${where}: with a lead of ${lead}, the change at ${name} starts at ${stamp(start - lead)}, and the picture of the scene opens at ${stamp(from)}. The most lead that fits is ${Math.floor((start - from) * 100 + SAME_TIME) / 100}`)
        }
        return { time: Math.max(from, start - lead), fade: length, name }
    }

    /** The items of a cue as a list of units, each with its nodes and its animations. A unit arrives at one moment. */
    private units(what: string, items: Showable): (Node | Anim)[][] {
        const where = `narration: scene "${this.id}": ${what}`
        const flat = (item: Showable, path: string): (Node | Anim)[] => {
            if (item instanceof Node || isAnim(item)) return [item]
            if (item instanceof Block) return item.nodes
            if (Array.isArray(item)) return item.flatMap((part, index) => flat(part, `${path}[${index}]`))
            throw new Error(`${where}: ${path} is ${item === undefined ? 'undefined' : JSON.stringify(item)}. Give a node, a block of the layout, an animation, or a list of them`)
        }
        const units = Array.isArray(items) ? items.map((item, index) => flat(item, `item ${index}`)) : [flat(items, 'the item')]
        if (units.flat().length === 0) throw new Error(`${where} has nothing to change. Give it at least one node`)
        return units
    }

    /** The last change of a node at a time or before it, and the first change after it. */
    private around(node: Node, time: number): { before: Change | undefined; after: Change | undefined } {
        let before: Change | undefined, after: Change | undefined
        for (const change of this.changes.get(node) ?? []) {
            if (change.at <= time + SAME_TIME) { if (!before || change.at >= before.at) before = change }
            else if (!after || change.at < after.at) after = change
        }
        return { before, after }
    }

    /** Record a change of a node. The first change of this clock adds the check that runs when the timeline is complete. */
    private record(node: Node, change: Change): void {
        if (this.changes.size === 0) this.stage.checks.push(() => this.settle())
        const list = this.changes.get(node)
        if (list) list.push(change)
        else this.changes.set(node, [change])
    }

    /**
     * The units that arrive at a cue. With `skipShown`, a node that shows already at the cue is left out, and
     * so is a unit that has no node left.
     */
    private arriving(what: string, name: string, units: (Node | Anim)[][], time: number, skipShown: boolean): (Node | Anim)[][] {
        if (!skipShown) return units
        const shows = (node: Node): boolean => {
            const { before } = this.around(node, time)
            return before ? before.kind === 'show' : seenAt(node, time) > SEEN_LEAST
        }
        const left = units.map((unit) => unit.filter((part) => !(part instanceof Node && shows(part)))).filter((unit) => unit.length > 0)
        if (left.length === 0) throw new Error(`narration: scene "${this.id}": ${what}: every node of the list shows already at ${name}, so the call has nothing to bring. Remove the call, or use an earlier phrase`)
        return left
    }

    /**
     * When each unit of a list arrives. Without `stagger`, all arrive at `time`, and the fade ends before the
     * picture of the scene starts to leave. With it, they arrive one after another, and the last one has its
     * fade and half a second on the screen before that. `stagger: true` makes the step shorter for that, down
     * to 0.1 seconds. A step that the scene typed is exact. What does not fit stops the build.
     */
    private arrivals(what: string, name: string, count: number, time: number, length: number, stagger: boolean | number | undefined): number[] {
        const where = `narration: scene "${this.id}": ${what}`
        const leaves = this.window.to
        const steps = count - 1
        if (steps < 1 || stagger === undefined || stagger === false || stagger === 0) {
            // One item, or all at one moment: the fade ends before the picture of the scene starts to leave.
            if (time + length > leaves + SAME_TIME) {
                const shorter = leaves - time >= 0.1 ? `, a fade of ${Math.floor((leaves - time) * 100 + SAME_TIME) / 100} or less` : ''
                throw new Error(`${where}: the change at ${name} starts at ${stamp(time)}, and its fade of ${length} seconds ends at ${stamp(time + length)}. The picture of the scene starts to leave at ${stamp(leaves)}, so what arrives would never be there in full. Use an earlier phrase${shorter}, or give the last beat of the scene a hold`)
            }
            return Array.from({ length: count }, () => time)
        }
        // The seconds that the steps can take: what is left after the fade of the last item and the time to see it.
        const there = leaves - time, room = there - length - CUE_SEEN
        let step: number
        if (stagger === true) {
            step = Math.min(CUE_STAGGER, room / steps)
            if (step < STAGGER_LEAST - SAME_TIME) {
                const most = Math.floor(room / STAGGER_LEAST + SAME_TIME) + 1
                const fewer = most >= 2 ? `Show ${most} items or fewer, use` : 'Use'
                throw new Error(`${where}: ${count} items one after another do not fit between ${name} and the end of the scene. The picture of the scene starts to leave ${hundredths(there)} seconds after the cue, and the list needs ${hundredths(steps * STAGGER_LEAST + length + CUE_SEEN)} at least: ${STAGGER_LEAST} for each step, ${length} for the fade of the last item, and ${CUE_SEEN} to see it. ${fewer} an earlier phrase, or use stagger: false`)
            }
        } else {
            step = stagger
            if (steps * step > room + SAME_TIME) {
                const largest = Math.floor(room / steps * 100 + SAME_TIME) / 100
                const fits = largest > 0 ? `The largest stagger that fits is ${largest}. Or use` : 'Use'
                throw new Error(`${where}: a stagger of ${step} needs ${hundredths(steps * step + length + CUE_SEEN)} seconds for ${count} items, with the fade of the last item and ${CUE_SEEN} to see it, and the picture of the scene starts to leave ${hundredths(there)} seconds after ${name}. ${fits} stagger: true, which fits the list to the time, or an earlier phrase`)
            }
        }
        return Array.from({ length: count }, (_, index) => time + index * step)
    }

    /** Check and record that a node fades in at a time. A node shows one time: a second fade in would make it blink, or leave it at no opacity. */
    private bring(what: string, name: string, node: Node, time: number, length: number): void {
        const where = `narration: scene "${this.id}": ${what}`, { before, after } = this.around(node, time)
        const skip = 'To bring the rest of a list and skip the nodes that show already, pass { skipShown: true }'
        const twice = (other: Change) => new Error(`${where}: ${describe(node)} comes with ${other.cue} and with ${name}. A node shows one time. Leave it out of one of the two lists, or hide it between the two cues with c.hide. ${skip}`)
        if (before?.kind === 'show') throw twice(before)
        if (after?.kind === 'show') throw twice(after)
        if (before && before.end > time + SAME_TIME) {
            throw new Error(`${where}: ${describe(node)} comes back with ${name} at ${stamp(time)}, and it fades out until ${stamp(before.end)}: ${before.cue} hides it. A viewer would see it blink. Use a later phrase for ${name}`)
        }
        if (after && after.at < time + length - SAME_TIME) {
            throw new Error(`${where}: ${describe(node)} comes with ${name} at ${stamp(time)}, and ${after.cue} hides it at ${stamp(after.at)}, before its fade ends. A viewer would see it blink. Use a later phrase for the hide, or leave the node out of ${name}`)
        }
        if (!before && seenAt(node, time) > SEEN_LEAST) {
            throw new Error(`${where}: ${describe(node)} shows already at ${name}: the scene put it on the stage before, with s.add or with a play of its own. A node shows one time. Leave it out of the list. ${skip}`)
        }
        this.record(node, { kind: 'show', at: time, end: time + length, cue: name, what })
    }

    /** Check and record that a node fades out at a time. */
    private leave(what: string, name: string, node: Node, time: number, length: number): void {
        const where = `narration: scene "${this.id}": ${what}`, { before, after } = this.around(node, time)
        if (before?.kind === 'hide') throw new Error(`${where}: ${describe(node)} is not on the screen at ${name}: ${before.cue} hides it before. Leave it out of one of the two lists`)
        if (after?.kind === 'hide') throw new Error(`${where}: ${describe(node)} leaves with ${name}, and ${after.cue} hides it again later. Leave it out of one of the two lists`)
        if (before && before.end > time + SAME_TIME) {
            throw new Error(`${where}: ${describe(node)} leaves with ${name} at ${stamp(time)}, and it fades in until ${stamp(before.end)}: ${before.cue} brings it. A viewer would see it blink. Use a later phrase for ${name}, or leave the node out of ${before.cue}`)
        }
        if (after && after.at < time + length - SAME_TIME) {
            throw new Error(`${where}: ${describe(node)} leaves with ${name} at ${stamp(time)}, and ${after.cue} brings it back at ${stamp(after.at)}, before its fade ends. A viewer would see it blink. Use a later phrase for ${after.cue}`)
        }
        this.record(node, { kind: 'hide', at: time, end: time + length, cue: name, what })
    }

    /**
     * The check that runs when the timeline is complete. A call of `show` or `hide` sees only what the scene
     * built before the call. Here the whole scene is built: the first change of each node is checked against
     * what the scene put on the stage at any line of its function.
     */
    private settle(): void {
        for (const [node, changes] of this.changes) {
            const first = changes.reduce((one, other) => (other.at < one.at ? other : one))
            const where = `narration: scene "${this.id}": ${first.what}`
            if (first.kind === 'show' && seenAt(node, first.at - 1e-4) > SEEN_LEAST) {
                throw new Error(`${where}: ${describe(node)} shows already at ${first.cue}: the scene puts it on the stage, with s.add or with a play of its own. A node shows one time. Leave it out of the list, or out of s.add. With { skipShown: true }, call s.add before the cue`)
            }
            if (first.kind === 'hide' && seenAt(node, first.at + 1e-4) <= SEEN_LEAST) {
                throw new Error(`${where}: ${describe(node)} is not on the screen at ${first.cue}. Put it on the stage before the cue, with s.add or with c.show, or leave it out of the list`)
            }
        }
    }

    /**
     * Fade nodes out just before the scene ends, so the next picture starts on a clean frame.
     * A value goes to zero in the same time, for a `dynamic` drawing that takes its opacity from one.
     */
    clear(targets: readonly (Node | Value | Block)[], lead = LEAVE_LEAD, duration = 0.26): this {
        if (!Array.isArray(targets)) throw new Error(`narration: scene "${this.id}": clear takes one list of nodes and values, such as c.clear([title, alpha])`)
        // A block of the layout stands for its nodes.
        const list = targets.flatMap((target: Node | Value | Block) => (target instanceof Block ? target.nodes : [target]))
        list.forEach((target, index) => {
            if (!(target instanceof Node || target instanceof Value)) throw new Error(`narration: scene "${this.id}": clear: item ${index} is ${target === null ? 'null' : typeof target}. Give nodes, blocks of the layout, and values`)
        })
        if (list.length === 0) return this
        this.stage.at(this.end - lead, () => this.stage.play(...list.map((target) => (target instanceof Value ? target.to(0, { duration }) : fade(target, 0, { duration })))))
        return this
    }

    /**
     * Hold a picture on screen for the next scene, with no fade between them: `c.keep(machine)`, or a list.
     * Both scenes show the picture at one place, and each scene builds its own copy. The next scene calls
     * `take` on its copy. The two copies change places 0.3 seconds before the first word of the next scene,
     * so they must look the same then: this scene first undoes what it changed on its copy. In a film
     * without `narrated()`, also leave the nodes out of `clear`.
     */
    keep(nodes: Node | Block | readonly (Node | Block)[]): this {
        const gap = Math.round((this.next - this.end) * 1000) / 1000
        // In a shorter gap the copies would change places while the rest of this scene still fades.
        if (gap < HANDOVER + CLEAR_OVERRUN) {
            throw new Error(`narration: scene "${this.id}": keep needs a gap of ${HANDOVER + CLEAR_OVERRUN} seconds or more between scenes, and the gap is ${gap}. Raise the gap, or let the picture fade with the scene`)
        }
        const list = nodesOf('keep', nodes)
        for (const node of list) this.kept.add(node)
        this.stage.at(Math.max(0, this.next - HANDOVER), () => this.stage.remove(...list))
        return this
    }

    /**
     * Take a picture from the scene before this one, such as `c.take(machine, () => machine.color('dim'))`.
     * The nodes arrive at the moment that the copy of the last scene goes, and `setup` runs on them then.
     */
    take(nodes: Node | Block | readonly (Node | Block)[], setup?: () => void): this {
        const list = nodesOf('take', nodes)
        for (const node of list) this.taken.add(node)
        this.stage.at(Math.max(0, this.start - HANDOVER), () => {
            for (const node of list) this.stage.add(node)
            setup?.()
        })
        return this
    }
}

/** The cues that the script declares for a scene, each with its beat. A cue that is not whole stops with the name of its scene and its beat. */
function declaredCues(scene: NarrationScene): DeclaredCue[] {
    const found: DeclaredCue[] = []
    scene.beats.forEach((beat, index) => {
        if (beat.cues === undefined) return
        const where = `narration: scene "${scene.id}": beat ${index}`
        if (!Array.isArray(beat.cues)) throw new Error(`${where}: cues is ${JSON.stringify(beat.cues)}, and it is a list such as [{ id: 'result', phrase: 'one hundred and sixty times' }]`)
        beat.cues.forEach((cue: NarrationCue, at: number) => {
            if (typeof cue !== 'object' || cue === null) throw new Error(`${where}: cue ${at} is ${JSON.stringify(cue)}, and a cue is an object such as { id: 'result', phrase: 'one hundred and sixty times' }`)
            if (typeof cue.id !== 'string' || cue.id.trim() === '') throw new Error(`${where}: cue ${at} needs an id, the name that a scene uses for it, such as { id: 'result', phrase: ${JSON.stringify(cue.phrase ?? 'the words')} }`)
            if (typeof cue.phrase !== 'string' || cue.phrase.trim() === '') throw new Error(`${where}: the cue "${cue.id}" needs a phrase, the words of the beat that it stands for`)
            const twice = found.find((other) => other.id === cue.id)
            if (twice) throw new Error(`narration: scene "${scene.id}": two cues have the id "${cue.id}", in beat ${twice.beat} and in beat ${index}. An id names one cue of its scene`)
            found.push({ ...cue, beat: index })
        })
    })
    return found
}

/** Stop when the voice does not say the phrase of a declared cue one time in its beat. The script is wrong then, whatever the film does. */
function checkCues(clock: SceneClock): void {
    for (const cue of clock.cues) {
        try {
            clock.cue(cue.id)
        } catch (error) {
            if (!(error instanceof Error)) throw error
            throw new Error(`${error.message.replace(`narration: scene "${clock.id}": `, `narration: scene "${clock.id}": the cue "${cue.id}" that the script declares for beat ${cue.beat}: `)}`)
        }
    }
    // The check asked for each cue. Only what the scene asks for counts as a use.
    clock.usedCues.clear()
}

/** The timeline of a whole narration. */
export class Narration {
    readonly scenes: readonly SceneClock[]
    /** The end of the last scene, in seconds. Hold the film at least this long, or the voice is cut. */
    readonly duration: number
    readonly lead: number
    readonly gap: number

    constructor(stage: Stage, timing: NarrationTiming, options: NarrationOptions = {}) {
        this.lead = options.lead ?? timing.lead ?? 0.6
        this.gap = options.gap ?? timing.gap ?? 0.4
        if (!(this.lead >= 0) || !(this.gap >= 0)) throw new Error('narration: lead and gap must be zero or more seconds')
        const seen = new Set<string>()
        // First the place of each scene: its first word, the place of each beat, and the end of its last hold.
        const placed: { scene: NarrationScene; start: number; end: number; beats: PlacedBeat[] }[] = []
        let now = this.lead
        for (const scene of timing.scenes) {
            if (seen.has(scene.id)) throw new Error(`narration: two scenes are named "${scene.id}"`)
            seen.add(scene.id)
            if (scene.start !== undefined) {
                // A tool that lays out its own sound says when each scene starts.
                const before = placed[placed.length - 1]
                if (!(Number.isFinite(scene.start) && scene.start >= 0)) throw new Error(`narration: scene "${scene.id}": start is ${JSON.stringify(scene.start)}, and it is the time of the first word of the scene, in film seconds, 0 or more`)
                if (before && scene.start < before.end - SAME_TIME) {
                    throw new Error(`narration: scene "${scene.id}" starts at ${stamp(scene.start)}, and the scene before it, "${before.scene.id}", ends at ${stamp(before.end)} with the hold of its last beat. A scene starts when the scene before it has ended: give it a later start, or give the last beat of "${before.scene.id}" a shorter hold`)
                }
                now = scene.start
            }
            const start = now
            const beats: PlacedBeat[] = []
            for (const beat of scene.beats) {
                if (!(beat.duration > 0)) throw new Error(`narration: scene "${scene.id}" has a beat without a measured duration: "${beat.say}"`)
                const hold = beat.hold ?? 0
                beats.push({ start: now, end: now + beat.duration, until: now + beat.duration + hold, text: beat.say, words: beat.words ?? [] })
                now += beat.duration + hold
            }
            placed.push({ scene, start, end: now, beats })
            now += this.gap
        }
        const scenes: SceneClock[] = []
        placed.forEach(({ scene, start, end, beats }, index) => {
            const before = placed[index - 1], after = placed[index + 1]
            // The scene before this one is gone at its end, which is one gap before the first word of this one
            // in a timing with no start of its own. The next scene starts at its first word.
            const gone = !before ? 0 : scene.start === undefined ? start - this.gap : before.end
            const clock = new SceneClock(stage, scene.id, start, end, beats, after ? after.start : end + this.gap, gone, declaredCues(scene))
            scenes.push(clock)
            checkCues(clock)
            if (options.chapters !== false && scene.title) stage.chapters.push({ title: scene.title, time: scenes.length === 1 ? 0 : start })
            if (options.captions !== false) {
                for (const beat of beats) {
                    const lines = captionLines(beat.text, options.captionLength)
                    const total = lines.reduce((sum, line) => sum + line.length, 0)
                    let t0 = beat.start
                    for (const line of lines) {
                        // Each line gets a share of the spoken time that matches its length.
                        const t1 = t0 + (beat.end - beat.start) * line.length / total
                        stage.captions.push({ t0, t1, text: line })
                        t0 = t1
                    }
                }
            }
        })
        const last = placed.length > 0 ? placed[placed.length - 1]!.end : this.lead
        this.scenes = scenes
        this.duration = last
        // The film must last until the voice ends, even if no picture changes there.
        stage.at(last, () => {})
        // When the film is built, each cue that the script declares must drive something.
        if (scenes.some((scene) => scene.cues.length > 0)) stage.checks.push(() => this.checkUsed())
    }

    /**
     * Stop when a cue that the script declares drives nothing in the film: the script and the film have
     * drifted apart. One error lists every such cue, by scene. A scene that the film did not ask a clock for
     * is not built, so its cues are not counted.
     */
    private checkUsed(): void {
        const unused = this.scenes.filter((scene) => scene.asked).map((scene) => ({ id: scene.id, cues: scene.cues.filter((cue) => !scene.usedCues.has(cue.id)).map((cue) => cue.id) })).filter((scene) => scene.cues.length > 0)
        if (unused.length === 0) return
        const count = unused.reduce((sum, scene) => sum + scene.cues.length, 0)
        const list = unused.map((scene) => `scene "${scene.id}": ${scene.cues.join(', ')}`).join('; ')
        throw new Error(`narration: ${count} ${count === 1 ? 'cue that the script declares drives' : 'cues that the script declares drive'} nothing in the film: ${list}. Use each one in its scene, such as c.show('${unused[0]!.cues[0]}', nodes), or remove it from the script`)
    }

    /** The clock of one scene. */
    scene(id: string): SceneClock {
        const found = this.scenes.find((scene) => scene.id === id)
        if (!found) throw new Error(`narration: no scene "${id}". The scenes are: ${this.scenes.map((scene) => scene.id).join(', ')}`)
        found.asked = true
        return found
    }

    /** Where every beat's recording starts, in order, for the script that mixes the sound. */
    placements(): { scene: string; beat: number; start: number; end: number }[] {
        return this.scenes.flatMap((scene) => scene.beats.map((beat, index) => ({ scene: scene.id, beat: index, start: beat.start, end: beat.end })))
    }
}

/**
 * Lay a measured narration on the stage. Each scene gets a clock with phrase cues.
 * Captions and chapters are added to the film, so the MP4 carries them.
 */
export function narration(stage: Stage, timing: NarrationTiming, options: NarrationOptions = {}): Narration {
    return new Narration(stage, timing, options)
}

