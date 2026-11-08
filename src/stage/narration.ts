/**
 * A film that follows a recorded voice. The film reads the measured length of every
 * spoken beat and the time of every word, and places each change on a spoken phrase.
 * A phrase that the voice does not say stops the build, so the picture cannot drift
 * from the script without an error.
 */
import { Value, fade } from './anim'
import type { Node } from './node'
import type { Stage } from './stage'

/** One spoken word, timed in seconds from the start of its beat. */
export interface NarrationWord {
    text: string
    start: number
    end: number
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
}

export interface NarrationScene {
    id: string
    /** Chapter title. A scene without one does not start a chapter. */
    title?: string
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

// A period stays only inside a number, such as 3.8, so "model." matches "model".
const tokens = (text: string): string[] => text.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').split(' ').map((token) => token.replace(/^\.+|\.+$/g, '')).filter(Boolean)

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

/** The clock of one scene. Every time is in film seconds. */
export class SceneClock {
    constructor(
        private readonly stage: Stage,
        readonly id: string,
        readonly start: number,
        readonly end: number,
        readonly beats: readonly PlacedBeat[],
    ) {}

    /** When the voice says a phrase. Pass a beat index to search one beat only. Throws if the phrase is not spoken. */
    cue(phrase: string, beat?: number): { start: number; end: number } {
        const want = tokens(phrase)
        if (want.length === 0) throw new Error(`narration: scene "${this.id}": a cue needs at least one word`)
        if (beat !== undefined && !this.beats[beat]) throw new Error(`narration: scene "${this.id}" has no beat ${beat}`)
        const list = beat === undefined ? this.beats : [this.beats[beat]!]
        for (const placed of list) {
            // One timed word can hold several spoken tokens, such as "twenty seven".
            const spoken = placed.words.flatMap((word) => tokens(word.text).map((token) => ({ token, start: word.start, end: word.end })))
            for (let i = 0; i + want.length <= spoken.length; i++) {
                if (want.every((token, j) => spoken[i + j]!.token === token)) {
                    return { start: placed.start + spoken[i]!.start, end: placed.start + spoken[i + want.length - 1]!.end }
                }
            }
        }
        const where = beat === undefined ? '' : ` in beat ${beat}`
        throw new Error(`narration: scene "${this.id}": the voice never says "${phrase}"${where}`)
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
     * Fade nodes out just before the scene ends, so the next picture starts on a clean frame.
     * A value goes to zero in the same time, for a `dynamic` drawing that takes its opacity from one.
     */
    clear(targets: readonly (Node | Value)[], lead = 0.24, duration = 0.26): this {
        if (targets.length === 0) return this
        this.stage.at(this.end - lead, () => this.stage.play(...targets.map((target) => (target instanceof Value ? target.to(0, { duration }) : fade(target, 0, { duration })))))
        return this
    }
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
        const scenes: SceneClock[] = []
        let now = this.lead
        let last = now
        for (const scene of timing.scenes) {
            if (seen.has(scene.id)) throw new Error(`narration: two scenes are named "${scene.id}"`)
            seen.add(scene.id)
            const start = now
            const beats: PlacedBeat[] = []
            for (const beat of scene.beats) {
                if (!(beat.duration > 0)) throw new Error(`narration: scene "${scene.id}" has a beat without a measured duration: "${beat.say}"`)
                const hold = beat.hold ?? 0
                beats.push({ start: now, end: now + beat.duration, until: now + beat.duration + hold, text: beat.say, words: beat.words ?? [] })
                now += beat.duration + hold
            }
            scenes.push(new SceneClock(stage, scene.id, start, now, beats))
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
            last = now
            now += this.gap
        }
        this.scenes = scenes
        this.duration = last
        // The film must last until the voice ends, even if no picture changes there.
        stage.at(last, () => {})
    }

    /** The clock of one scene. */
    scene(id: string): SceneClock {
        const found = this.scenes.find((scene) => scene.id === id)
        if (!found) throw new Error(`narration: no scene "${id}". The scenes are: ${this.scenes.map((scene) => scene.id).join(', ')}`)
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

