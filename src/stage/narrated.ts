/**
 * The shell of a narrated film. One call lays the measured voice on the stage, draws the title card, and runs
 * each scene at the moment that its picture opens. A scene says what is on the screen and what changes on
 * which word. The shell brings the picture in and takes it away, so no scene types a time for that.
 * It is a layer on `film()` and `narration()`. A film that needs another order of work calls those two.
 */
import { fade, fadeIn } from './anim'
import type { FontFamily } from './font'
import { HANDOVER, narration, type NarrationOptions, type NarrationTiming, type SceneClock } from './narration'
import type { Node } from './node'
import { film, type FilmDefinition, type FilmOptions, type Stage } from './stage'
import { text } from './text'
import { fittedSize } from './text-fit'

/** The content of `timing.json`, as the voice step of `vizmatic narrated` writes it. */
export interface TimingFile extends NarrationTiming {
    /** Seconds of the title card, before the story starts. `lead`, the time of the first word, holds them and the pause after them. */
    intro?: number
    /** Seconds of picture after the gap that follows the last scene, while the sound fades. */
    tail?: number
}

/** The clock of the whole film: the times that do not belong to one scene, in seconds. A scene gets it beside its own clock. */
export interface FilmClock {
    /** How long the title card has before the story starts. */
    readonly intro: number
    /** The silence between two scenes. */
    readonly gap: number
    /** The picture after the gap that follows the last scene. */
    readonly tail: number
    /** The last moment of the film. */
    readonly end: number
}

/**
 * One scene of the film. The shell calls it at the moment that the picture of the scene opens, so what the
 * function adds with `s.add` is the first picture of the scene, and it fades in there.
 */
export type SceneFunction = (s: Stage, c: SceneClock, film: FilmClock) => void

/** A title card of the film's own. The shell calls it at the start of the film, and its picture leaves before the first scene. */
export type IntroFunction = (s: Stage, film: FilmClock) => void

/** The words of the title card that the shell draws. */
export interface TitleCard {
    /** Defaults to the title of the film. */
    title?: string
    /** A second, smaller line under the title. */
    subtitle?: string
    /** Defaults to serif. */
    font?: FontFamily
}

export interface NarratedOptions extends FilmOptions {
    /**
     * The font of every text of the film that names none: the labels of the kit, a `text()` with no `font`, and
     * the labels that an object draws. Defaults to text-serif, which stays readable at the size of a phone.
     */
    font?: FontFamily
    /** The measured voice: the content of `timing.json`. */
    timing: TimingFile
    /** One function for each scene of the script, by the id of the scene. The order of the script decides the order of the film. */
    scenes: Readonly<Record<string, SceneFunction>>
    /**
     * The title card, which is up for the `intro` seconds of the timing. Without this option, the shell draws
     * the title of the film. Give other words as `{ title, subtitle }`, a function that draws the card of the
     * film, or `false` for no card.
     */
    intro?: TitleCard | IntroFunction | false
    /** The captions and the chapters. The lead and the gap come from the timing, because the sound mix uses the same numbers. */
    narration?: Pick<NarrationOptions, 'captions' | 'captionLength' | 'chapters'>
}

// A picture opens this long before the picture before it is gone, with a fade of this length. With these two
// numbers, the layout check finds no moment with two pictures in one place, and no empty frame.
const OPEN_BEFORE = 0.05
const OPEN_FADE = 0.25
// A scene starts to leave this long before its end, with a fade of this length, as `SceneClock.clear` does.
const CLOSE_LEAD = 0.24
const CLOSE_FADE = 0.26
// The last picture stays while the sound fades. It starts to leave this long before the film ends.
const LAST_LEAVE = 0.4
const LAST_FADE = 0.35
// The title card comes in after this time, and it leaves in the last moments of its time.
const CARD_IN = 0.15
const CARD_FADE_IN = 0.5
const CARD_FADE_OUT = 0.3

/**
 * The scenes that a draft build asks for, in the environment variable `VIZMATIC_SCENES`. The film file cannot
 * ask for a part of the film, so a film that is built without that variable is always whole. A browser has
 * no environment, so the preview builds every scene.
 */
function scenesFromEnvironment(): string[] {
    const value = typeof process === 'undefined' ? undefined : process.env?.['VIZMATIC_SCENES']
    return (value ?? '').split(',').map((id) => id.trim()).filter(Boolean)
}

const quoted = (ids: readonly string[]) => ids.map((id) => `"${id}"`).join(', ')

/** Stop when the timing has nothing to follow: no scene, or a scene with no beat. */
function checkTiming(timing: TimingFile): void {
    if (!Array.isArray(timing?.scenes) || timing.scenes.length === 0) {
        throw new Error('narrated: the timing has no scene, so the film has no voice to follow. Give the content of timing.json, which the voice step writes')
    }
    const silent = timing.scenes.filter((scene) => !Array.isArray(scene.beats) || scene.beats.length === 0).map((scene) => scene.id)
    if (silent.length > 0) throw new Error(`narrated: the scene ${quoted(silent)} of the timing has no beat, so it has no length. Give it a beat in the script, and make the voice again`)
}

/** Stop when the script and the film do not have the same scenes. Returns the scenes to build, in the order of the script. */
function scenesToBuild(options: NarratedOptions): string[] {
    if ('only' in options) {
        throw new Error('narrated: "only" is not an option. A film file always holds every scene. For a movie of some scenes, build a draft: vizmatic narrated build <folder> --draft --scene <id>')
    }
    const spoken = options.timing.scenes.map((scene) => scene.id)
    const defined = Object.keys(options.scenes)
    const silent = spoken.filter((id) => !Object.hasOwn(options.scenes, id))
    if (silent.length > 0) {
        throw new Error(`narrated: the script has the scene ${quoted(silent)}, and the film does not define it. Add it to scenes, or remove it from the script and make the voice again`)
    }
    const unspoken = defined.filter((id) => !spoken.includes(id))
    if (unspoken.length > 0) {
        throw new Error(`narrated: the film defines the scene ${quoted(unspoken)}, and the timing has no scene with that id. The scenes of the script are: ${spoken.join(', ')}`)
    }
    const broken = defined.filter((id) => typeof options.scenes[id] !== 'function')
    if (broken.length > 0) throw new Error(`narrated: the scene ${quoted(broken)} of the film is not a function. Give each scene a function (s, c) => { ... }`)
    const asked = scenesFromEnvironment()
    const unknown = asked.filter((id) => !spoken.includes(id))
    if (unknown.length > 0) {
        throw new Error(`narrated: VIZMATIC_SCENES names the scene ${quoted(unknown)}, and the script has no scene with that id. The scenes of the script are: ${spoken.join(', ')}`)
    }
    return asked.length > 0 ? spoken.filter((id) => asked.includes(id)) : spoken
}

/** Run a builder at one time. Returns the nodes that it put on the stage, at any time. */
function addedBy(s: Stage, time: number, build: () => void): Node[] {
    const before = new Set(s.root.children)
    s.at(time, build)
    return s.root.children.filter((node) => !before.has(node))
}

/** True when a node is on the stage at a time: it is there, and its builder did not hide it or remove it before. */
function shownAt(node: Node, time: number): boolean {
    const visible = node.tracks?.get('visible')
    return visible ? visible.sample(time) === true : node.base.visible
}

/**
 * Fade in the picture that a builder put on the stage at its start. A node that the builder fades itself keeps
 * its own fade, and a node that comes on a later word is not here yet.
 */
function fadeInOpening(s: Stage, nodes: readonly Node[], time: number, duration: number): void {
    const opening = nodes.filter((node) => {
        const faded = node.tracks?.get('opacity')?.keys.some((key) => key.t0 < time + duration) ?? false
        return shownAt(node, time) && !faded
    })
    if (opening.length > 0) s.at(time, () => s.play(fadeIn(opening, { duration })))
}

/**
 * Fade out what is on the stage, over a time that ends at `end`. A node fades from the opacity that it has
 * then. A node that its builder hid or removed before is left as it is: a fade would show it again first.
 */
function fadeOutBy(s: Stage, nodes: readonly Node[], end: number, duration: number): void {
    const leaving = nodes.filter((node) => shownAt(node, end - duration))
    if (leaving.length > 0) s.at(end - duration, () => s.play(...leaving.map((node) => fade(node, 0, { duration }))))
}

type Box = ReturnType<Node['bounds']>

/** A node for a message: its name, its text, or its place and its size. */
function describe(node: Node, box: Box): string {
    const words = (node as Node & { source?: string }).source
    if (node.label) return `the node "${node.label}"`
    if (words) return `the text "${words}"`
    return `the node at (${Math.round(box.x + box.width / 2)}, ${Math.round(box.y + box.height / 2)}), ${Math.round(box.width)} wide and ${Math.round(box.height)} high`
}

/** Where each node is at a time of the film. */
function boxesAt(s: Stage, nodes: Iterable<Node>, time: number): { node: Node; box: Box }[] {
    let found: { node: Node; box: Box }[] = []
    s.at(time, () => { found = [...nodes].map((node) => ({ node, box: node.bounds() })) })
    return found
}

/**
 * Stop when a scene keeps a node that the next scene does not take. The kept copy leaves 0.3 seconds before
 * the first word of the next scene with no fade, so without a copy at its place it disappears at once.
 */
function checkHandover(s: Stage, from: SceneClock, to: SceneClock): void {
    const time = to.start - HANDOVER
    const taken = boxesAt(s, to.taken, time + 0.001)
    const near = (a: number, b: number) => Math.abs(a - b) < 1
    for (const { node, box } of boxesAt(s, from.kept, time - 0.001)) {
        if (taken.some((other) => near(other.box.x, box.x) && near(other.box.y, box.y) && near(other.box.width, box.width) && near(other.box.height, box.height))) continue
        throw new Error(`narrated: scene "${from.id}": keep holds ${describe(node, box)} for the next scene, and scene "${to.id}" takes no node at that place. Take a copy of it there with c.take, or do not keep it: it then fades out with its scene`)
    }
}

/** The card that the shell draws: the title in the middle of the frame, and a smaller line under it. */
function titleCard(s: Stage, card: TitleCard & { title: string }): void {
    const font = card.font ?? 'serif'
    const width = s.width * 0.82
    // A short title is large. A long one is set smaller to stay on one line, and wraps when it would be too small to read.
    const size = Math.max(84, fittedSize(card.title, width, 150, { font }))
    const title = text(card.title, { font, size, maxWidth: width, align: 'center' })
    if (!card.subtitle) {
        s.add(title)
        return
    }
    const sub = text(card.subtitle, { font, size: 52, color: 'dim', maxWidth: width, align: 'center' })
    const gap = 44, tall = title.bounds().height, low = sub.bounds().height
    title.at(0, -(low + gap) / 2)
    sub.at(0, (tall + gap) / 2)
    s.add(title, sub)
}

/** The builder of the title card, or none: with no time for it, with no words for it, or when the film turns it off. */
function introBuilder(options: NarratedOptions, s: Stage, clock: FilmClock): (() => void) | undefined {
    const { intro } = options
    if (intro === false || !(clock.intro > 0)) return undefined
    if (typeof intro === 'function') return () => intro(s, clock)
    const title = intro?.title ?? options.title
    if (!title) return undefined
    return () => titleCard(s, { ...intro, title })
}

/** Run a builder of the film. A mistake inside it gets the name of its scene, because a film has many and the stack does not say which. */
function named<T>(what: string, build: () => T): T {
    try {
        return build()
    } catch (error) {
        // An asset that loads is thrown as a value that is not an error: the compiler waits for it and builds the
        // film again. An error that names the scene already, such as a cue that the voice does not say, stays as it is.
        if (!(error instanceof Error) || error.message.includes(what)) throw error
        error.message = `narrated: ${what}: ${error.message}`
        throw error
    }
}

/**
 * Define a film that follows a recorded voice:
 * `export default narrated({ title: 'Toto', timing, scenes: { hook, why, close } })`.
 *
 * The shell draws the title card from the title. It calls each scene at the moment that its picture opens,
 * with the clock of the scene with the same id in the timing. What the scene adds there with `s.add` fades
 * in as the scene before it leaves. At the end of the scene, every node that the scene put on the stage
 * fades out, and `c.keep(node)` holds one for the next scene. The last picture stays while the sound fades.
 *
 * A scene of the script that the film does not define stops the build, and so does a scene of the film that
 * the script does not have. The film lasts one gap and the tail past the last word.
 */
export function narrated(options: NarratedOptions): FilmDefinition {
    const { timing, scenes, intro: _intro, narration: voiceOptions, ...filmOptions } = options
    checkTiming(timing)
    const building = scenesToBuild(options)
    const whole = building.length === timing.scenes.length
    const introSeconds = timing.intro ?? 0, tail = timing.tail ?? 0
    if (!(introSeconds >= 0) || !(tail >= 0)) throw new Error('narrated: intro and tail must be zero or more seconds')
    // A partial film is for a fast look at some scenes. It must never pass for the whole film in silence.
    if (!whole) console.warn(`narrated: only the scene ${quoted(building)} is built, without the title card, because VIZMATIC_SCENES is set. This is not the whole film.`)

    return film({ font: 'text-serif', ...filmOptions }, (s) => {
        const voice = narration(s, timing, voiceOptions)
        if (introSeconds > voice.lead) {
            throw new Error(`narrated: the intro is ${introSeconds} seconds and the first word starts at ${voice.lead} seconds, so the voice would start over the title card. In the timing, lead is the time of the first word: the intro and the pause after it`)
        }
        const clock: FilmClock = { intro: introSeconds, gap: voice.gap, tail, end: voice.duration + voice.gap + tail }
        // A film of some scenes has no title card, and its scenes keep the times that they have in the whole film.
        const card = introBuilder(options, s, clock)
        if (card && whole) {
            const start = Math.min(CARD_IN, introSeconds * 0.1)
            const nodes = named('the title card', () => addedBy(s, start, card))
            fadeInOpening(s, nodes, start, Math.min(CARD_FADE_IN, introSeconds * 0.3))
            fadeOutBy(s, nodes, introSeconds, Math.min(CARD_FADE_OUT, introSeconds * 0.25))
        }
        const first = timing.scenes[0]!.id, last = timing.scenes[timing.scenes.length - 1]!.id
        let before: SceneClock | undefined
        for (const id of building) {
            const scene = voice.scene(id)
            // What is on the screen before this scene is gone at this time: the title card, or the scene before.
            const cleared = id === first ? (card ? introSeconds : 0) : scene.start - voice.gap
            const opens = Math.max(0, cleared - OPEN_BEFORE)
            const nodes = named(`scene "${id}"`, () => addedBy(s, opens, () => scenes[id]!(s, scene, clock)))
            fadeInOpening(s, nodes.filter((node) => !scene.taken.has(node)), opens, OPEN_FADE)
            // The scene before this one is built too when its end is one gap before the start of this one.
            if (before && Math.abs(before.next - scene.start) < 1e-6) checkHandover(s, before, scene)
            before = scene
            const leaving = nodes.filter((node) => !scene.kept.has(node))
            if (id !== last) {
                fadeOutBy(s, leaving, scene.end - CLOSE_LEAD + CLOSE_FADE, CLOSE_FADE)
                continue
            }
            if (scene.kept.size > 0) throw new Error(`narrated: scene "${id}": keep holds a picture for the next scene, and this is the last scene. Without keep, its picture stays to the end of the film`)
            fadeOutBy(s, leaving, clock.end - LAST_LEAVE + LAST_FADE, LAST_FADE)
        }
        // The sound runs past the last word while the pad fades, and the film must not end before the sound.
        s.at(clock.end, () => {})
    })
}
