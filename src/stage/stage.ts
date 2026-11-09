import { parseColor, setColorTokens, type Rgba } from './color'
import { smooth, type Ease } from './ease'
import { buildOps, frameToSvg, type Frame } from './display'
import { resolveLook, type Look, type LookName } from './look'
import { Node, mountTree, type StageImage } from './node'
import { isImageAsset, resolveLegacyImage, validateStageImage, ImageAssetError, type ImageAsset } from './image'
import { STEADY, changesAt, changesNow, clock } from './track'
import { Value, type Anim } from './anim'
import type { FontFamily } from './font'
import { settleLights, type Light, type MorphRecord } from './light'

export type Aspect = '16:9' | '9:16' | '1:1' | '4:3' | '21:9'

export interface FilmOptions {
    /** Legacy URL images are allowed by default. Prepared image assets never use the network. */
    imageNetwork?: 'allow' | 'deny'
    /** Lines and shapes run past the frame edges on purpose, as a warped grid does. Text is still checked. */
    bleed?: boolean
    title?: string
    description?: string
    /** Logical stage size. 16:9 is 1920x1080. Everything is authored in these units. */
    aspect?: Aspect
    width?: number
    height?: number
    fps?: number
    look?: LookName | Look
    /**
     * The font of every text of the film that names none: a `text()` with no `font`, and each label of an
     * object that got no `font`. A text or an object that names a font keeps it, and so do the code and the
     * values that an object sets in mono. Without it, such a text is sans.
     */
    font?: FontFamily
    background?: string | null
    /** Light that spills from bright marks. Defaults to the look's value. */
    bloom?: number
    /** Time in seconds of the frame to use as a poster. Defaults to the richest frame. */
    poster?: number
}

export interface Chapter {
    title: string
    time: number
}

export interface Clip {
    t0: number
    t1: number
    labels: string[]
}

export interface Caption {
    t0: number
    t1: number
    text: string
}

export interface PlayOptions {
    duration?: number
    ease?: Ease
    /** Name shown in timelines. */
    label?: string
}

/** The background of a film as a color. A look token is valid, and a value that is not a color gives the `bg` of the look. */
function backdropOf(background: string, look: Look): Rgba {
    const colors = look.colors as Record<string, string>
    try {
        return parseColor(colors[background] ?? background)
    } catch {
        return parseColor(colors['bg']!)
    }
}

const ASPECTS: Record<Aspect, [number, number]> = {
    '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '21:9': [2520, 1080],
}

// A film is not type-checked when it runs, so any value can arrive as its font. The record makes the compiler ask for each family.
const FONTS = Object.keys({ sans: true, serif: true, 'text-serif': true, mono: true, noto: true } satisfies Record<FontFamily, true>)

interface Updater {
    node: Node
    fn: (node: Node, time: number) => void
    from: number
    to: number
}

/** The timeline a film is authored on. All coordinates are centered: (0, 0) is mid-frame and y points down. */
export class Stage {
    readonly root = new Node()
    /** Move, zoom, and rotate the view with to(s.camera, ...). `sx` is the zoom. */
    readonly camera = new Node()
    readonly width: number
    readonly height: number
    readonly fps: number
    readonly look: Look
    /** The font that the film names for its texts, or null when it names none. A text with no font is then sans. */
    readonly font: FontFamily | null
    readonly chapters: Chapter[] = []
    readonly clips: Clip[] = []
    readonly captions: Caption[] = []
    readonly updaters: Updater[] = []
    /** The lights that `spotlight` added. `settleLights` turns them into the `dim` of each node, in time order. */
    readonly lights: Light[] = []
    /**
     * Three records for the lights, of facts that the timeline does not hold. Only a film with a light reads
     * them, so they change nothing in a film with none.
     * `arrivals` is the time at which a verb brought a node to the stage: a node that arrives at the very
     * time of a light enters with it, and at time 0 the timeline cannot tell it from a node of `s.add`.
     * `marks` is the node that a mark of a verb belongs to, such as the line of `circumscribe` and its
     * target: the mark is as bright as that node.
     * `morphs` is each morph with its nodes: a light must not dim a node while it changes its shape.
     */
    readonly arrivals = new WeakMap<Node, number>()
    readonly marks = new Map<Node, Node>()
    readonly morphs: MorphRecord[] = []
    /** The color that a dim node goes toward: the background of the film, or of its look when the film has none. */
    readonly backdrop: Rgba
    time = 0
    private ending = 0

    constructor(options: FilmOptions) {
        const [w, h] = ASPECTS[options.aspect ?? '16:9']
        this.width = options.width ?? w
        this.height = options.height ?? h
        this.fps = options.fps ?? 60
        this.look = resolveLook(options.look)
        if (options.font !== undefined && !FONTS.includes(options.font)) {
            throw new Error(`film: font is ${FONTS.map((name) => `'${name}'`).join(', ').replace(/, ([^,]*)$/, ' or $1')}, not ${JSON.stringify(options.font)}`)
        }
        this.font = options.font ?? null
        this.backdrop = backdropOf(options.background ?? this.look.background, this.look)
        this.root.mounted = true
        this.camera.mounted = true
    }

    /** Half of the frame in each direction. */
    get right(): number {
        return this.width / 2
    }
    get left(): number {
        return -this.width / 2
    }
    get top(): number {
        return -this.height / 2
    }
    get bottom(): number {
        return this.height / 2
    }

    /**
     * Take the clock for this film. Each call that the callback makes on its stage starts here. When the
     * callbacks of two films await, they take turns, and the other film has put its own font on the clock
     * since the last call. A stage whose callback does not run leaves the clock alone.
     */
    private claim(): void {
        if (building(this)) clock.font = this.font
    }

    /** Put nodes on stage now. Returns the first, so setup reads as one line. */
    add<T extends Node>(first: T, ...rest: Node[]): T {
        this.claim()
        clock.now = this.time
        for (const node of [first, ...rest]) {
            if (!node.mounted) {
                node.parent?.drop(node)
                node.parent = this.root
                this.root.children.push(node)
                mountTree(node, this.time)
            } else if (!node.get('visible')) {
                node.track('visible').step(this.time, true)
            }
        }
        return first
    }

    /** Put a node on stage so it first shows at `time`, which may differ from the cursor. */
    mountAt(node: Node, time: number): void {
        this.claim()
        if (node.mounted) return
        node.parent?.drop(node)
        node.parent = this.root
        this.root.children.push(node)
        mountTree(node, time)
        // At time 0 the timeline does not say that a verb brought this node, so keep the time for the lights.
        this.arrivals.set(node, time)
    }

    remove(...nodes: Node[]): void {
        this.claim()
        for (const node of nodes) node.track('visible').step(this.time, false)
    }

    /** Run animations together and advance the timeline past them. */
    play(...items: (Anim | PlayOptions)[]): this {
        this.claim()
        const anims = items.filter((item): item is Anim => 'schedule' in item)
        const options = (items.find((item) => !('schedule' in item)) ?? {}) as PlayOptions
        if (anims.length === 0) return this
        // With an explicit duration every animation fills it. Otherwise each keeps its own length.
        const natural = Math.max(...anims.map((anim) => anim.duration))
        const duration = options.duration ?? natural
        const t0 = this.time
        const t1 = t0 + duration
        for (const anim of anims) {
            clock.now = t0
            const end = options.duration !== undefined ? t1 : t0 + anim.duration
            anim.schedule({ t0, t1: end, ease: options.ease ?? anim.ease ?? smooth, stage: this })
        }
        this.clips.push({ t0, t1, labels: options.label ? [options.label] : anims.map((anim) => anim.label) })
        this.time = t1
        this.ending = Math.max(this.ending, t1)
        clock.now = t1
        return this
    }

    /** Hold on the current picture. */
    wait(seconds = 1): this {
        this.claim()
        this.time += seconds
        this.ending = Math.max(this.ending, this.time)
        clock.now = this.time
        return this
    }

    /** Author something at another time, then return to where you were. */
    at(time: number, build: () => void): this {
        this.claim()
        const saved = this.time
        this.time = time
        clock.now = time
        build()
        this.ending = Math.max(this.ending, this.time)
        this.time = saved
        clock.now = saved
        return this
    }

    /** Mark a chapter for the player, presentation steps, and the timeline. */
    chapter(title: string): this {
        this.claim()
        this.chapters.push({ title, time: this.time })
        return this
    }

    /** Show a caption for a span of time. Captions also export as a VTT sidecar. */
    caption(text: string, duration = 3): this {
        this.claim()
        this.captions.push({ t0: this.time, t1: this.time + duration, text })
        this.ending = Math.max(this.ending, this.time + duration)
        return this
    }

    /** A number that animates, for driving dynamic drawings. */
    value(initial = 0): Value {
        this.claim()
        return new Value(initial)
    }

    /** Re-run a function each frame while the node shows. It can set any property on the node. */
    update<T extends Node>(node: T, fn: (node: T, time: number) => void, window: { from?: number; to?: number } = {}): T {
        this.claim()
        this.updaters.push({
            node, fn: fn as (node: Node, time: number) => void,
            from: window.from ?? this.time, to: window.to ?? Infinity,
        })
        return node
    }

    get duration(): number {
        return Math.max(this.ending, this.time)
    }
}

export interface FilmDefinition {
    readonly kind: 'vizmatic.film'
    readonly options: FilmOptions
    readonly build: (stage: Stage) => void | Promise<void>
    /**
     * Compile with the engine that authored this film. The clock is module state,
     * so a tool with its own bundled engine must call this and not its own compileFilm.
     */
    readonly compile: (overrides?: CompileOverrides) => Promise<CompiledFilm>
}

/** Define a film: a function that authors a timeline on a stage. */
export function film(build: (stage: Stage) => void | Promise<void>): FilmDefinition
export function film(options: FilmOptions, build: (stage: Stage) => void | Promise<void>): FilmDefinition
export function film(a: FilmOptions | ((stage: Stage) => void | Promise<void>), b?: (stage: Stage) => void | Promise<void>): FilmDefinition {
    const options = typeof a === 'function' ? {} : a
    const build = typeof a === 'function' ? a : b
    if (!build) throw new Error('film(options, build) needs a build function.')
    const definition: FilmDefinition = {
        kind: 'vizmatic.film', options, build,
        compile: (overrides) => compileFilm(definition, overrides),
    }
    return definition
}

export function isFilm(value: unknown): value is FilmDefinition {
    return !!value && typeof value === 'object' && (value as FilmDefinition).kind === 'vizmatic.film'
}

/** Thrown while an asset loads. The compiler waits and runs the build function again. */
export class Suspend {
    /** Lets a second copy of the engine recognize this without instanceof. */
    readonly isVizmaticSuspend = true
    /**
     * What a tool prints when this leaves the compiler: a text at the top of a film file throws it when the
     * file loads, and a second copy of the engine throws one that this copy does not know.
     */
    readonly message = 'vizmatic needs a font, the math engine or another asset that is not loaded yet. A film loads them while its callback runs, '
        + 'and then runs the callback again. Make each text, equation and graph inside the callback of film(), not at the top of a file. '
        + 'If they are inside the callback, the film file and a file that it imports use two copies of vizmatic: '
        + 'give the folder of the film a package.json with "type": "module".'
    constructor(readonly promise: Promise<unknown>) {}

    toString(): string {
        return this.message
    }
}

/** True for a Suspend thrown by any copy of the engine. */
export function isSuspend(error: unknown): error is Suspend {
    return typeof error === 'object' && error !== null && (error as Suspend).isVizmaticSuspend === true
}

export interface CompileOverrides {
    imageNetwork?: 'allow' | 'deny'
    look?: LookName | Look
    fps?: number
    bloom?: number
    background?: string | null
}

/** A film ready to sample. `frame(t)` is pure: seek to any time, in any order. */
export class CompiledFilm {
    private readonly allowImageNetwork: boolean
    private readonly imageAssets = new Map<string, ImageAsset>()
    private readonly imageLoads = new Map<string, Promise<ImageAsset>>()
    readonly width: number
    readonly height: number
    readonly fps: number
    readonly duration: number
    readonly title: string
    readonly description: string
    readonly look: Look
    readonly bloom: number
    readonly background: string | null
    /** The author's chosen poster time, when set. */
    readonly posterTime: number | undefined
    readonly bleed: boolean
    readonly chapters: readonly Chapter[]
    readonly clips: readonly Clip[]
    readonly captions: readonly Caption[]
    readonly stage: Stage

    constructor(stage: Stage, options: FilmOptions, overrides: CompileOverrides) {
        this.allowImageNetwork = (overrides.imageNetwork ?? options.imageNetwork ?? 'allow') === 'allow'
        this.stage = stage
        this.width = stage.width
        this.height = stage.height
        this.fps = overrides.fps ?? stage.fps
        this.duration = Math.max(stage.duration, 1 / this.fps)
        this.title = options.title ?? ''
        this.description = options.description ?? ''
        this.look = stage.look
        this.bloom = overrides.bloom ?? options.bloom ?? stage.look.bloom
        const background = overrides.background !== undefined ? overrides.background
            : options.background !== undefined ? options.background : stage.look.background
        // A look token is valid here too, but SVG and canvas need the real color.
        this.background = background === null ? null : (stage.look.colors as Record<string, string>)[background] ?? background
        this.posterTime = options.poster
        this.bleed = options.bleed === true
        this.chapters = stage.chapters
        this.clips = stage.clips
        this.captions = stage.captions
    }

    get frameCount(): number {
        return Math.max(1, Math.round(this.duration * this.fps))
    }

    private async prepareImage(image: StageImage): Promise<ImageAsset> {
        if (image.asset) {
            if (!isImageAsset(image.asset)) throw new ImageAssetError('Image asset was not prepared by resolveImageAsset.')
            validateStageImage(image, image.asset)
            return image.asset
        }
        let pending = this.imageLoads.get(image.src)
        if (!pending) {
            pending = resolveLegacyImage(image.src, this.allowImageNetwork).then(asset => {
                this.imageAssets.set(image.src, asset)
                return asset
            })
            this.imageLoads.set(image.src, pending)
        }
        const asset = await pending
        validateStageImage(image, asset)
        return asset
    }

    /** Preload static and keyed images, including those not visible in the first frame. */
    async preloadImages(): Promise<void> {
        for (const node of this.stage.root.all()) {
            const track = node.tracks?.get('image')
            const images = [node.base.image, track?.initial, ...(track?.keys.map(key => key.to) ?? [])] as (StageImage | null | undefined)[]
            for (const image of images) if (image) await this.prepareImage(image)
        }
    }

    /** The draw list at a time in seconds. May throw Suspend if a drawing needs a new asset. */
    frame(time: number): Frame {
        const t = Math.max(0, Math.min(this.duration, time))
        const stage = this.stage
        const previous = { mode: clock.mode, now: clock.now, font: clock.font, at: clock.at, steady: clock.steady }
        setColorTokens(stage.look.colors)
        clock.mode = 'render'
        clock.now = t
        clock.at = t
        clock.steady = Infinity
        // A drawing that is rebuilt on each frame makes its texts now, so they need the font of the film here too.
        clock.font = stage.font
        clock.frame++
        try {
            for (const updater of stage.updaters) {
                if (t >= updater.from && t <= updater.to) {
                    // An updater gets the time, so no one can tell when its picture changes.
                    changesNow()
                    updater.fn(updater.node, t)
                } else if (updater.from > t) {
                    changesAt(updater.from)
                }
            }
            const camera = stage.camera
            const ops = buildOps(stage.root, {
                x: camera.get('x'), y: camera.get('y'), zoom: camera.get('sx'), rotation: camera.get('rotation'),
            }, stage.width, stage.height, stage.backdrop, stage.lights.length > 0 ? stage.marks : null)
            const preparedOps = ops.map(op => {
                if (op.kind !== 'image') return op
                const asset = op.image.asset ?? this.imageAssets.get(op.image.src)
                if (!asset) throw new Suspend(this.prepareImage(op.image))
                if (!isImageAsset(asset)) throw new ImageAssetError('Image asset was not prepared by resolveImageAsset.')
                validateStageImage(op.image, asset)
                return { ...op, image: { ...op.image, src: asset.src, asset } }
            })
            const frame: Frame = { width: stage.width, height: stage.height, background: this.background, bloom: this.bloom, dark: stage.look.dark, ops: preparedOps }
            // The frame keeps the time before which it is proven to stay the same. A copy of the frame does not take it.
            Object.defineProperty(frame, STEADY, { value: clock.steady })
            return frame
        } finally {
            clock.mode = previous.mode
            clock.now = previous.now
            clock.font = previous.font
            clock.at = previous.at
            // A frame that is drawn inside another frame used a time that the outer frame did not prove.
            clock.steady = previous.mode === 'render' ? -Infinity : previous.steady
        }
    }

    /** Standalone SVG for a time. */
    svg(time: number, options: { transparent?: boolean; scale?: number } = {}): string {
        return frameToSvg(this.frame(time), options)
    }
}

/** A film whose callback runs now, and the clock that it found when it started. */
interface Build {
    readonly stage: Stage
    found: { mode: typeof clock.mode; now: number; font: FontFamily | null }
}

/**
 * The films whose callbacks run now, in the order of their starts. There is more than one when a callback
 * awaits and another film starts, and when a callback compiles a film.
 */
const builds: Build[] = []

function building(stage: Stage): boolean {
    return builds.some((build) => build.stage === stage)
}

/** The callback of a film starts: the film takes the clock, and keeps what it found. */
function begin(stage: Stage): Build {
    const build: Build = { stage, found: { mode: clock.mode, now: clock.now, font: clock.font } }
    builds.push(build)
    clock.mode = 'compile'
    clock.now = 0
    clock.font = stage.font
    return build
}

/** The callback of a film is done, or it threw. A second call for one film does nothing. */
function end(build: Build): void {
    const index = builds.indexOf(build)
    if (index < 0) return
    builds.splice(index, 1)
    const later = builds[index]
    if (!later) {
        // No film that started after this one still builds: put back the clock that this film found.
        clock.mode = build.found.mode
        clock.now = build.found.now
        clock.font = build.found.font
        return
    }
    // A film that started later still builds, because the two callbacks await. It found the clock of this
    // film, which is of no use now. It takes what this film found, so the last film to end puts back the
    // clock from before them all. Until its next call, the clock has the font of the newest film.
    later.found = build.found
    clock.font = builds[builds.length - 1]!.stage.font
}

const TWO_ENGINES = 'Two copies of vizmatic/stage built this film, so a part of it is on another timeline. '
    + 'The usual cause is a film of several files in a folder with no "type": "module" in its package.json: '
    + 'one file then loads the package as CommonJS and another as an ES module. Add "type": "module" to the package.json beside the film.'

/** Run the build function, waiting for fonts and math when it asks for them, and return a seekable film. */
export async function compileFilm(definition: FilmDefinition, overrides: CompileOverrides = {}): Promise<CompiledFilm> {
    const options: FilmOptions = {
        ...definition.options, ...(overrides.look ? { look: overrides.look } : {}), ...(overrides.fps ? { fps: overrides.fps } : {}),
        // The stage needs the background too: a light dims a node toward it.
        ...(overrides.background !== undefined ? { background: overrides.background } : {}),
    }
    for (let attempt = 0; attempt < 64; attempt++) {
        const stage = new Stage(options)
        setColorTokens(stage.look.colors)
        const build = begin(stage)
        try {
            // A callback that is not async is done when it returns. Do not await it: the clock then goes
            // back before any other film can start, so two such films never have the clock of each other.
            const pending = definition.build(stage) as unknown
            if (pending !== null && typeof pending === 'object' && typeof (pending as PromiseLike<void>).then === 'function') await pending
            // The timeline is complete, so each light can ask what was on the stage at its start.
            settleLights(stage)
            end(build)
            const compiled = new CompiledFilm(stage, options, overrides)
            await compiled.preloadImages()
            // Drawings can ask for assets too, so sample across the timeline before returning.
            await probe(compiled)
            return compiled
        } catch (error) {
            end(build)
            clock.capture = null
            if (error instanceof Suspend) {
                await error.promise
                continue
            }
            // A wait for an asset that this engine does not know as its own comes from a second copy of the
            // engine. That copy has its own timeline, so the part of the film that it built cannot be right.
            if (isSuspend(error)) throw new Error(TWO_ENGINES)
            throw error
        }
    }
    throw new Error('The film kept requesting new assets while compiling.')
}

async function probe(film: CompiledFilm): Promise<void> {
    const samples = [0, 0.25, 0.5, 0.75, 1]
    for (const fraction of samples) {
        for (let attempt = 0; attempt < 16; attempt++) {
            try {
                film.frame(film.duration * fraction)
                break
            } catch (error) {
                if (!(error instanceof Suspend)) throw error
                await error.promise
            }
        }
    }
}

export type { Frame } from './display'
