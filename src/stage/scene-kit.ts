/**
 * The kit of a film with many scenes: the frame that every scene shares, and labels, chips and boxes in
 * the font and the sizes of the film. A film makes its kit once, in `scenes/kit.ts`, and each scene
 * imports the helpers that it needs:
 *
 *     export const { area, heading, source, label, left, right, chip, claimTag } = sceneKit({ size: 44 })
 *
 * One number sets every size: the heading, the source line, the claim tag, the chips and the names of the
 * boxes follow `size`, so a film for a phone raises one number.
 *
 * A scene types no place: it makes each text with no x and no y, and the layout places it, such as
 * `place(column([label('requests'), chip('virtio')]), area, 'top left')`. See `row`, `column`, `grid`, `place`
 * and `beside`. A text helper also takes the place of its text, as `left('requests', area.left, 80)`, and
 * an object such as a chip takes `.at(x, y)`, for a film that types its places.
 */
import type { FontFamily } from './font'
import { Box } from './layout'
import type { SceneClock } from './narration'
import type { Node } from './node'
import { card, type Card, type CardOptions } from './objects/card'
import { chip, chipRow, type Chip, type ChipOptions, type ChipRow, type ChipRowItem, type ChipRowOptions } from './objects/chip'
import { namedBox, type NamedBox, type NamedBoxOptions } from './objects/named-box'
import { tag, tagTrack, type TagState } from './objects/tag'
import { filmFont, text, type TextNode, type TextOptions } from './text'
import { advanceWidth, fittedSize, type TextMeasureOptions } from './text-fit'

/**
 * The area that the content of a scene may fill, between the heading and the source line. It is a `Box`: it has
 * `left`, `right`, `top`, `bottom`, `cx`, `cy`, `width` and `height`, and it cuts into regions with `columns`,
 * `rows`, `inset` and `beside`.
 */
export type SceneArea = Box

export interface SceneKitOptions {
    /**
     * The font of labels, headings, chips, boxes and cards, when it is not the font of the film. A film names
     * its font once: `narrated({ font })`, or `film({ font })`. In a film that names none, the kit is in text-serif.
     */
    font?: FontFamily
    /**
     * Font size of `label`, `left` and `right`. Defaults to 36. The other sizes follow it: a display line is 1.78
     * of it, the heading 1.44, a block of text and the name of a box 0.89, a chip 0.78, and a note, the source
     * line and the claim tag 0.72.
     */
    size?: number
    /** Font size of `para`, when it is not 0.89 of `size`. */
    paraSize?: number
    /** The edges of the area for content. The defaults fit a stage of 1920 by 1080: x from -900 to 900, and y from -400 to 440. */
    area?: Partial<Pick<SceneArea, 'left' | 'right' | 'top' | 'bottom'>>
    /** The heading of a scene. It starts at the left edge of the area, at y -474. Its size is 1.44 of `size`. */
    heading?: { size?: number; y?: number; align?: 'left' | 'center' }
    /** The source line, under the area. It starts at the left edge of the area, at y 492. Its size is 0.72 of `size`, and the claim tag has the same size. */
    source?: { size?: number; y?: number }
    /** The look of every chip of the film. An option of one chip wins over it. The size of a chip is 0.78 of `size`. */
    chip?: ChipOptions
}

/** One state of a claim tag: the word in the pill, a note beside it, and the time when the state starts. */
export type ClaimState = Omit<TagState, 'at'> & {
    /** When this state starts, in film seconds. The first state can leave it out: it then starts with the picture of the scene. */
    at?: number
}

export interface ClaimTagOptions {
    /**
     * `'bottom'` is the right end of the source line, and `'top'` is the top right corner, at the height of the
     * heading. Defaults to bottom. The source line starts at the left, so the two do not meet.
     */
    place?: 'bottom' | 'top'
    /** When the last state leaves, in film seconds. Without it, the tag stays as long as the picture of its scene. */
    until?: number
    /** Font size. Defaults to the size of the source line. */
    size?: number
}

/**
 * The helpers of one film. `textWidth`, `fitSize`, `chip`, `chipRow`, `namedBox` and `card` are the functions
 * of the library with the same names: the kit gives them the font and the look of the film as defaults, and
 * runs the same code. So a film takes these from its kit, and every measure is in the font that it draws.
 */
export interface SceneKit {
    /** The font of the kit: its own, or the font of the film that is built now. */
    readonly font: FontFamily
    /** The area that the content of a scene may fill. */
    readonly area: SceneArea
    /**
     * A label for the layout to place: `label('p99 latency', { color: 'blue' })`. With a place, its middle is at
     * (x, y): `label('p99 latency', 0, -120)`.
     */
    label(content: string, options?: TextOptions): TextNode
    label(content: string, x: number, y: number, options?: TextOptions): TextNode
    /** A label with its left edge at x: `left('requests', area.left, 80)`. With no place, it is a label that scales from its left edge. */
    left(content: string, options?: TextOptions): TextNode
    left(content: string, x: number, y: number, options?: TextOptions): TextNode
    /** A label with its right edge at x: `right('128 GPUs', plot.left - 20, 40)`. With no place, it is a label that scales from its right edge. */
    right(content: string, options?: TextOptions): TextNode
    right(content: string, x: number, y: number, options?: TextOptions): TextNode
    /**
     * A block of text that wraps at `width`, for the layout to place: `para(quote, side.width)`. With a place, its
     * left edge is at x and its middle at y: `para(quote, area.left, 0, 640)`.
     */
    para(content: string, width: number, options?: TextOptions): TextNode
    para(content: string, x: number, y: number, width: number, options?: TextOptions): TextNode
    /** A note for the layout to place, small and dim, in the size of the source line: `note('our run of June')`. */
    note(content: string, options?: TextOptions): TextNode
    /** The one large line of a picture, for the layout to place: `display('160 times faster', { color: 'green' })`. */
    display(content: string, options?: TextOptions): TextNode
    /** The heading of a scene, at its place in the frame: `heading('One microVM')`. */
    heading(content: string, options?: TextOptions): TextNode
    /** The source line of a scene, small and dim, under the area: `source('Firecracker docs/design.md, 2026')`. */
    source(content: string, options?: TextOptions): TextNode
    /**
     * A tag for the kind of the claim that is on screen: `claimTag(c, { word: 'MEASURED', note: 'our run' })`.
     * It puts the tag on the stage, at the right end of the source line, and the tag leaves with the picture
     * of its scene. For a tag that changes, give a list of states, each with the time when it starts:
     * `claimTag(c, [{ word: 'PLAN' }, { at: c.cue('we measured').start, word: 'MEASURED', color: 'green' }])`.
     * In a film without `narrated()`, clear the tag with the scene.
     */
    claimTag(clock: SceneClock, states: ClaimState | readonly ClaimState[], options?: ClaimTagOptions): Node
    /** The width of a line of text in the font of the film: `textWidth('Toto', 40)`. */
    textWidth(content: string, size: number, options?: TextMeasureOptions): number
    /** The largest size, not over `size`, at which a line of text fits `width`: `fitSize(name, box.width - 40, 36)`. */
    fitSize(content: string, width: number, size: number, options?: TextMeasureOptions): number
    /** A short label in a box that fits it: `chip('virtio', { stroke: 'green' })`. The layout places it, or `.at(120, 40)` puts its left end at x. */
    chip(content: string, options?: ChipOptions): Chip
    /** Chips in a row. It wraps only with `maxWidth`, and `.at` places its left end: `chipRow(['KVM', 'seccomp'], { maxWidth: 600 }).at(area.left, 300)`. */
    chipRow(items: readonly ChipRowItem[], options?: ChipRowOptions): ChipRow
    /** A box of a given size with a name that fits it: `namedBox('guest', { width: 300, height: 120, color: 'red' }).at(0, 0)`. */
    namedBox(name: string, options: NamedBoxOptions): NamedBox
    /** A card with a title, a figure and a caption, in the font of the film: `card({ title: 'Logs', figure, caption })`. */
    card(options: CardOptions): Card
}

// Each size of the kit, as a part of the size of a label. With the default of 36, they are 64, 52, 32, 32, 28 and 26.
const SCALE = { display: 64 / 36, heading: 52 / 36, para: 32 / 36, box: 32 / 36, chip: 28 / 36, source: 26 / 36 }
// A tag with no end of its own leaves when the scene fades it, so its last state has no last moment: 30 years.
const NEVER = 1e9
// What a state of a claim tag can hold. A field with another name is a mistake that must not pass in silence.
const STATE_FIELDS = ['at', 'word', 'note', 'color', 'noteColor', 'size', 'font', 'noteFont', 'fill', 'anchor']

/**
 * The area for the content of a scene, as a region of the layout: `sceneArea().columns([2, 1])`. It is the
 * `area` of a kit, for a film that has none. The defaults fit a stage of 1920 by 1080, under a heading and
 * over a source line: x from -900 to 900, and y from -400 to 440. Give the edges that differ.
 */
export function sceneArea(edges: SceneKitOptions['area'] = {}): Box {
    const left = edges.left ?? -900, right = edges.right ?? 900, top = edges.top ?? -400, bottom = edges.bottom ?? 440
    if (!(right > left && bottom > top)) throw new Error(`sceneKit: the area must have its right edge after its left edge and its bottom under its top, and it is x ${left} to ${right}, y ${top} to ${bottom}`)
    return new Box(left, top, right, bottom)
}

/** The states of a claim tag, checked. A wrong field is an error that names the scene, the state and the field. */
function claimStates(clock: SceneClock, given: ClaimState | readonly ClaimState[]): TagState[] {
    const where = `sceneKit: the claim tag of scene "${clock.id}"`
    const example = "{ word: 'MEASURED', note: 'our run' }"
    const states: readonly ClaimState[] = Array.isArray(given) ? given : [given as ClaimState]
    if (states.length === 0) throw new Error(`${where} needs at least one state, such as ${example}`)
    return states.map((state, index) => {
        if (typeof state !== 'object' || state === null) throw new Error(`${where}: state ${index} is ${JSON.stringify(state)}, and a state is an object such as ${example}`)
        const unknown = Object.keys(state).filter((field) => !STATE_FIELDS.includes(field))
        if (unknown.length > 0) throw new Error(`${where}: state ${index} has the field "${unknown[0]}", and a state has no such field. Its fields are: ${STATE_FIELDS.join(', ')}`)
        if (typeof state.word !== 'string' || state.word.trim() === '') throw new Error(`${where}: state ${index} needs the field "word", the word in the pill, such as ${example}`)
        if (state.note !== undefined && typeof state.note !== 'string') throw new Error(`${where}: the field "note" of state ${index} is ${JSON.stringify(state.note)}, and a note is a text`)
        if (state.at !== undefined && !Number.isFinite(state.at)) throw new Error(`${where}: the field "at" of state ${index} is ${JSON.stringify(state.at)}, and it is a time in film seconds, such as c.cue('a phrase').start`)
        // The first state starts with the picture of the scene: the scene function runs at that moment.
        if (state.at === undefined && index > 0) throw new Error(`${where}: state ${index} needs the field "at", the time when it takes the place of the state before it, such as c.cue('a phrase').start`)
        return { ...state, at: state.at ?? clock.stage.time }
    })
}

/**
 * Make the kit of a film, such as `sceneKit({ size: 40, heading: { align: 'center' } })`. The options are the
 * choices that every scene of the film shares. Each helper also takes the options of the object that it
 * makes, for the one place that differs.
 */
export function sceneKit(options: SceneKitOptions = {}): SceneKit {
    // The film that is built now names the font. The kit is made before the film, so it asks at each call.
    const fontOf = (): FontFamily => options.font ?? filmFont() ?? 'text-serif'
    const size = options.size ?? 36
    const scaled = (part: number) => Math.round(size * part)
    const area = sceneArea(options.area)
    const head = { size: scaled(SCALE.heading), y: -474, align: 'left' as const, ...options.heading }
    const foot = { size: scaled(SCALE.source), y: 492, ...options.source }
    const plain = (of: number): TextOptions => ({ font: fontOf(), size: of, color: 'ink' })
    // The look of the chips of the film: its font and its size first, so that the film can choose others for its chips.
    const chipLook = (): ChipOptions => ({ font: fontOf(), size: scaled(SCALE.chip), ...options.chip })

    // A text helper takes a place, or none: without x and y, the layout places the text.
    type Rest = [options?: TextOptions] | [x: number, y: number, options?: TextOptions]
    const placed = (base: TextOptions) => (content: string, ...rest: Rest): TextNode => {
        if (typeof rest[0] !== 'number') return text(content, { ...base, ...rest[0] })
        if (typeof rest[1] !== 'number') throw new Error(`sceneKit: the text ${JSON.stringify(content)} has an x and no y. Give both, or none: the layout then places the text`)
        return text(content, { ...base, ...rest[2] }).at(rest[0], rest[1])
    }
    const label = (content: string, ...rest: Rest) => placed(plain(size))(content, ...rest)
    const left = (content: string, ...rest: Rest) => placed({ ...plain(size), anchor: 'left' })(content, ...rest)
    const right = (content: string, ...rest: Rest) => placed({ ...plain(size), anchor: 'right' })(content, ...rest)
    const para = (content: string, ...rest: [width: number, options?: TextOptions] | [x: number, y: number, width: number, options?: TextOptions]): TextNode => {
        const block = (width: number, own?: TextOptions): TextNode => {
            if (!(Number.isFinite(width) && width > 0)) throw new Error(`sceneKit: para wraps at a width, more than 0, and it is ${width}. Give the width of its region, such as side.width`)
            return text(content, { ...plain(options.paraSize ?? scaled(SCALE.para)), anchor: 'left', align: 'left', maxWidth: width, leading: 1.3, ...own })
        }
        if (typeof rest[1] !== 'number') return block(rest[0], rest[1])
        return block(rest[2] as number, rest[3]).at(rest[0], rest[1])
    }

    return {
        get font() { return fontOf() },
        area,
        label,
        left,
        right,
        para,
        note: (content, own) => text(content, { ...plain(foot.size), color: 'dim', anchor: 'left', ...own }),
        display: (content, own) => text(content, { ...plain(scaled(SCALE.display)), ...own }),
        heading: (content, own) => (head.align === 'center' ? label(content, area.cx, head.y, { size: head.size, ...own }) : left(content, area.left, head.y, { size: head.size, ...own })),
        source: (content, own) => left(content, area.left, foot.y, { size: foot.size, color: 'dim', ...own }),
        claimTag(clock, given, own = {}) {
            // The note is in the font of the film, as the source line is. Each state ends at the right edge of
            // the area, so the tag is clear of the source line and of the heading, which start at the left.
            const styled = claimStates(clock, given).map((state) => ({ size: own.size ?? foot.size, noteFont: fontOf(), anchor: 'right' as const, ...state }))
            for (const { at: _at, word, ...look } of styled) {
                const wide = tag(word, look).bounds().width
                if (wide > area.width) throw new Error(`sceneKit: the claim tag of scene "${clock.id}" is ${Math.ceil(wide)} wide with the word ${JSON.stringify(word)}, and the area is ${area.width} wide. Shorten its note`)
            }
            const track = tagTrack(styled, { until: own.until ?? NEVER }).at(area.right, own.place === 'top' ? head.y : foot.y)
            return clock.stage.add(track)
        },
        textWidth: (content, of, own) => advanceWidth(content, of, { font: fontOf(), ...own }),
        fitSize: (content, width, of, own) => fittedSize(content, width, of, { font: fontOf(), ...own }),
        chip: (content, own) => chip(content, { ...chipLook(), ...own }),
        chipRow: (items, own) => chipRow(items, { ...chipLook(), ...own }),
        namedBox: (name, own) => namedBox(name, { font: fontOf(), size: scaled(SCALE.box), ...own }),
        card: (own) => card({ font: fontOf(), ...own }),
    }
}
