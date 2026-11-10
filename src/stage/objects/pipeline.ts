import { Node, ownLabels, rebindCloneParts } from '../node'
import { rectPath, type Path } from '../geometry'
import { circle, dot, line, polygon, polyline, rect, svgPath } from '../shapes'
import { filmFont, text, type TextOptions } from '../text'
import { toPaint, type ColorInput, type Paint } from '../color'
import { clock, type Key } from '../track'
import type { Ease } from '../ease'
import type { Anim, AnimContext, AnimOptions } from '../anim'
import { Box } from '../layout'
import { reaches, reveal, staggered, stepAt } from './util'

type Id = string | number

/** The name of a stage, or its index. */
export type PipelineStageRef = string | number

export interface PipelineStage {
    /** The name over the stage, on one line. */
    name: string
    /** A gate checks an item, and lets it through or stops it. Its mark is a diamond. Defaults to the `gates` of the pipeline. */
    gate?: boolean
}

export interface PipelineItem {
    /** The identity of the item, written on it: 'R-104', 'call 17', 'row 3'. An id is on the pipeline one time. */
    id: Id
    /** A short text after the id: a value or a stamp that the item carries. */
    badge?: string
    /** The color of the border and of the id. Defaults to the `color` of the pipeline. */
    color?: ColorInput
    /** The stage where the item starts. Defaults to the first stage. */
    at?: PipelineStageRef
    /** The lane of the item, from 0 at the top. Defaults to the first lane that is free. */
    lane?: number
}

/** What an item is and where, after the changes that are scheduled so far. */
export interface PipelineItemState {
    id: Id
    /** The index of the stage where the item is. For an item in the tray: the stage that it left. */
    stage: number
    /** The name of that stage. */
    name: string
    /** The lane of the item, or null for an item in the tray. */
    lane: number | null
    /** `waiting`: at its stage, with no verdict. `passed`: the stage let it through. `stopped`: the stage stopped it. */
    state: 'waiting' | 'passed' | 'stopped'
    where: 'path' | 'tray'
    /** The text after the id, or undefined. After `stop(id, reason)`, it is the reason. */
    badge: string | undefined
}

/** The items of a call: an id, a list of ids, or a function of an item, which the pipeline calls when the change is scheduled. */
export type PipelineWhich = Id | readonly Id[] | ((item: PipelineItemState) => boolean)

export interface PipelineOptions {
    /** The width of the whole object: the path, and the tray under it. Defaults to 1600. */
    width?: number
    /** How many items the path holds at one time. Each one has its own lane. Defaults to 1. */
    lanes?: number
    /** Every stage is a gate, apart from a stage with `gate: false`. */
    gates?: boolean
    /**
     * Show under each name how many items reached the stage so far. With true, the number alone. A function
     * writes the line, such as (count) => `${count} rows`.
     */
    counts?: boolean | ((count: number) => string)
    /** The name of a tray under the path, such as 'rejected'. `eject()` sends an item there. Without it, the pipeline has no tray. */
    tray?: string
    /** Text size. Defaults to 28. */
    size?: number
    /** The color of an item that has none of its own. Defaults to blue. */
    color?: ColorInput
    /** The font of the names, the counts and the name of the tray. Defaults to the font of the film. */
    font?: TextOptions['font']
    /** The font of the ids and the badges, such as 'mono' for request ids. Defaults to `font`. */
    itemFont?: TextOptions['font']
}

type Verdict = PipelineItemState['state']
/**
 * What the mark of a stage shows in one lane. `open`: no item left it yet, a ring or a diamond. `visited`: an
 * item went on from a stage, a dot. `passed`: an item passed, a check. `stopped`: an item was stopped there
 * and left the path, a cross.
 */
export type PipelineTrail = 'open' | 'visited' | 'passed' | 'stopped'
type Trail = PipelineTrail

interface Stage {
    name: string
    gate: boolean
}

interface Rec {
    id: Id
    node: PipelineItemNode
    color: Paint
    stage: number
    lane: number
    state: Verdict
    where: 'path' | 'tray'
    badge: string | undefined
    /** The badge is the reason of a stop. It goes when the stop is over. */
    reason: boolean
    /** The width of the capsule. */
    width: number
    /** The right end of the id, from the left edge of the capsule. */
    idEnd: number
    /** The last change of the item that the film played. */
    last: { call: string; t0: number; t1: number } | null
}

interface Lane {
    /** The item on the path in this lane, or null. */
    owner: Rec | null
    /** The time from which the lane is free, and the call that left it free then. */
    freeAt: number
    left: string
    /** The line and the marks of the lane show: it is the first lane, or it had an item. */
    shown: boolean
    /** What each mark shows. A new item starts from open marks. */
    trail: Trail[]
}

/** One item to put on the path, after its checks. */
interface Spec {
    id: Id
    badge: string | undefined
    color: Paint
    stage: number
    lane: number | undefined
}

// Two times nearer than this are one time: the end of one animation is the start of the next.
const SOON = 1e-9
// A time that no film reaches, as a power of two. A key from 0 to this time gets each frame time back exactly.
const FOREVER = 2 ** 20
// The height of a capsule, as a part of the text size.
const CAPSULE = 1.7
// The room between the border of a capsule and its text, at the left and at the right, as a part of the text size.
const PAD = 0.55
// The side of the box of a check or a cross, as a part of the text size.
const GLYPH = 0.56
// The room between the id and the mark, between the mark and the badge, and between the id and a badge with no mark.
const MARK_GAP = 0.36
const BADGE_GAP = 0.62
// The clear room between a capsule and the next stage, and between two names, as a part of the text size.
const CLEAR = 0.5
// The room at the right end of the path for the arrow head, as a part of the text size.
const TAIL = 0.9

/** A key whose value at each frame is a function of the time of that frame. */
const always = <T>(read: (time: number) => T, last: T): Key<T> => ({ t0: 0, t1: FOREVER, ease: null, to: last, at: (alpha) => read(alpha * FOREVER) })
const shown = (id: Id) => (typeof id === 'string' ? JSON.stringify(id) : String(id))
const seconds = (time: number) => `${Math.round(time * 100) / 100} s`
/** The advance width of a text with its anchor at the left. It includes the side bearings. */
const advance = (node: Node) => (node.layoutBox ? node.layoutBox[2] - node.layoutBox[0] : node.bounds().width)

function oneLine(what: string, value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`pipeline: ${what} is ${typeof value === 'string' ? 'empty' : String(value)}. Give a text of one line`)
    if (/[\n\r\t]/.test(value)) throw new Error(`pipeline: ${what} (${JSON.stringify(value)}) has a line break or a tab. It is one line of text`)
    return value.trim()
}

/** A `duration` and a `lag` are numbers, 0 or more. One that is not a number would write keys that no frame finds. */
function timed(call: string, options: AnimOptions): void {
    for (const key of ['duration', 'lag'] as const) {
        const value = options[key]
        if (value !== undefined && !(Number.isFinite(value) && value >= 0)) throw new Error(`pipeline: the ${key} of ${call} is ${String(value)}. Give a number, 0 or more`)
    }
}

function paintOf(color: ColorInput, what: string): Paint {
    try {
        return toPaint(color)
    } catch {
        throw new Error(`pipeline: ${what} is ${typeof color === 'string' ? JSON.stringify(color) : String(color)}, which is not a color. Use a color of the look, such as 'orange', or a CSS color`)
    }
}

/** One item of a `Pipeline`: a capsule with its id, a check or a cross, and a badge. Its place is the left end of the capsule. */
export class PipelineItemNode extends Node {
    /** The text after the id, or null. A change of the badge puts a new node here. */
    badge: Node | null = null
    /** The holder of the id, the check, the cross and the badge. They come and go as one, over a capsule that hides the path. */
    readonly content = new Node()

    constructor(
        /** The border and the fill around the id and the badge. */
        readonly capsule: Node,
        /** The id of the item. */
        readonly idText: Node,
        /** The check, which shows while the item is passed. */
        readonly check: Node,
        /** The cross, which shows while the item is stopped. */
        readonly cross: Node,
    ) {
        super()
        this.content.add(idText, check, cross)
        this.add(capsule, this.content)
    }
}

/**
 * A path of named stages, and items that go through them. An item has an identity: a request, a record, a
 * tool call. It is a capsule with its id, and it keeps that id while it moves and changes. `put()` brings an
 * item to the path, `move()` takes it to the next stage, `setBadge()` changes the value that it carries,
 * `pass()` and `stop()` give it the verdict of a stage, `eject()` sends it to the tray under the path, and
 * `exit()` takes it away. Each item has its own lane, and each mark of that lane keeps what happened there:
 * a check where the item passed, a cross where it was stopped. With `counts`, each stage shows how many
 * items reached it. `.at()` places the middle of the object, which is `width` wide.
 */
export class Pipeline extends Node {
    /** The name of each stage, over the path. */
    readonly names: Node[] = []
    /** The count line of each stage, under its name. The list is empty without `counts`. */
    readonly counters: Node[] = []
    /** The line of each lane: its pieces between the marks, and its arrow head. */
    readonly rails: Node[] = []
    /** The line and the marks of each lane, as one node. The first lane shows from the start, and each other lane shows from its first item. */
    readonly laneNodes: Node[] = []
    /** The frame of the tray and its name, or null for a pipeline with no tray. */
    readonly tray: Node | null = null
    readonly trayName: Node | null = null
    /** The mark of each stage in each lane: `marks[lane][stage]`. */
    private marks: Node[][] = []
    private readonly stages: Stage[]
    private readonly w: number
    private readonly size: number
    private readonly capsule: number
    private readonly pitch: number
    private readonly origin: number
    private readonly ys: number[] = []
    private readonly trayY: number = 0
    private readonly trayStart: number = 0
    private readonly edges: readonly [top: number, bottom: number]
    private readonly font: TextOptions['font']
    private readonly itemFont: TextOptions['font']
    private readonly ownColor: ColorInput
    private readonly say: ((count: number) => string) | null
    /** The holder of the items. It is over the path and the tray. */
    private readonly holder = new Node()
    private recs: Rec[] = []
    private byId = new Map<string, Rec>()
    private idFreeAt = new Map<string, number>()
    private lanes: Lane[]
    private inTray: Rec[] = []
    /** For each stage: the times at which an item reached it, and the count before the first of them. */
    private arrivals: number[][]
    private before: number[]
    /** For each stage: the items that reached it. An item counts one time at a stage, also after a second run. */
    private seen: Set<Rec>[]
    /** For each stage: the text of each value of its count. */
    private values: Map<number, Node>[]

    constructor(stages: readonly (string | PipelineStage)[], options: PipelineOptions = {}) {
        super()
        if (!Array.isArray(stages) || stages.length < 2) throw new Error('pipeline: give it two stages or more. A path goes from one stage to another')
        const size = this.size = options.size ?? 28
        if (!(Number.isFinite(size) && size > 0)) throw new Error('pipeline: size is a text size, more than 0')
        const w = this.w = options.width ?? 1600
        if (!(Number.isFinite(w) && w > 0)) throw new Error('pipeline: width is the width of the object, more than 0')
        const laneCount = options.lanes ?? 1
        if (!Number.isInteger(laneCount) || laneCount < 1) throw new Error(`pipeline: lanes is ${String(options.lanes)}. It is the number of items that the path holds at one time, a whole number, 1 or more`)
        if (options.counts !== undefined && typeof options.counts !== 'boolean' && typeof options.counts !== 'function') throw new Error('pipeline: counts is true, or a function that writes the line of a count, such as (count) => `${count} rows`')
        this.say = options.counts === true ? (count) => String(count) : typeof options.counts === 'function' ? options.counts : null
        this.stages = stages.map((stage, index) => {
            const spec = typeof stage === 'string' ? { name: stage } : stage
            if (typeof spec !== 'object' || spec === null) throw new Error(`pipeline: stage ${index} is ${String(spec)}. A stage is a name, or { name, gate }`)
            return { name: oneLine(`the name of stage ${index}`, spec.name), gate: spec.gate ?? options.gates === true }
        })
        this.stages.forEach((stage, index) => {
            if (this.stages.findIndex((other) => other.name === stage.name) !== index) throw new Error(`pipeline: two stages have the name ${JSON.stringify(stage.name)}. Give each stage its own name`)
        })
        // The font is taken once, where the pipeline is made. So an item that arrives later has the font of the names.
        const font = this.font = options.font ?? filmFont() ?? 'sans'
        this.itemFont = options.itemFont ?? font
        this.ownColor = options.color ?? 'blue'
        paintOf(this.ownColor, 'color')
        const trayName = options.tray === undefined ? null : oneLine('the name of the tray', options.tray)

        const count = this.stages.length
        const capsule = this.capsule = Math.round(size * CAPSULE)
        const pad = size * PAD
        this.origin = -w / 2
        const pitch = this.pitch = (w - size * TAIL) / count
        const widthFor = (room: number) => Math.ceil(room * count + size * TAIL)
        // A name starts where the id of an item starts, and ends with clear room before the next name.
        const nameRoom = pitch - pad - size * CLEAR
        const names = this.stages.map((stage) => text(stage.name, { size, font, color: 'ink', anchor: 'left' }))
        const widest = Math.max(...names.map(advance))
        if (!(nameRoom > 0) || widest > nameRoom) {
            const name = this.stages[names.findIndex((made) => advance(made) === widest)]!.name
            throw new Error(`pipeline: the name ${JSON.stringify(name)} is ${Math.ceil(widest)} px wide at size ${size}, and a stage of ${Math.max(0, Math.floor(pitch))} px has room for ${Math.max(0, Math.floor(nameRoom))} px. Use a shorter name, a width of ${widthFor(widest + pad + size * CLEAR)} or more, or fewer stages`)
        }

        // From the top: the names, the counts, the lanes, the tray. A row of text is 1.3 of the text size high.
        const line1 = size * 1.3
        const lanePitch = capsule + size * 0.75
        const nameY = line1 / 2
        const countY = nameY + line1
        const firstLane = (this.say ? countY : nameY) + line1 / 2 + size * 0.35 + capsule / 2
        const lastLane = firstLane + (laneCount - 1) * lanePitch
        const trayHeight = capsule + size * 0.9
        const trayMiddle = lastLane + capsule / 2 + size * 0.8 + trayHeight / 2
        const height = trayName === null ? lastLane + capsule / 2 : trayMiddle + trayHeight / 2
        const up = -height / 2
        this.edges = [up, up + height]
        for (let lane = 0; lane < laneCount; lane++) this.ys.push(up + firstLane + lane * lanePitch)

        const header = new Node()
        names.forEach((made, index) => {
            this.names.push(made.at(this.x(index) + pad, up + nameY))
            header.add(made)
        })
        this.arrivals = this.stages.map(() => [])
        this.before = this.stages.map(() => 0)
        this.seen = this.stages.map(() => new Set())
        this.values = this.stages.map(() => new Map())
        if (this.say) {
            this.stages.forEach((_, index) => {
                const holder = new Node().at(this.x(index) + pad, up + countY)
                this.counters.push(holder)
                header.add(holder)
                this.countText(index, 0)
            })
        }
        this.add(header)

        // The line of a lane has a gap at each mark, so a mark needs no patch behind it.
        const weight = Math.max(2, size * 0.085)
        const reach = size * 0.56
        const tip = size * 0.5
        const right = w / 2
        this.lanes = []
        for (let lane = 0; lane < laneCount; lane++) {
            const y = this.ys[lane]!
            const rail = new Node()
            for (let index = 0; index < count; index++) {
                const from = this.mid(index) + reach, to = index + 1 < count ? this.mid(index + 1) - reach : right - tip
                const piece = line([from, y], [to, y], { stroke: 'faint', width: weight })
                piece.set('cap', 'butt')
                rail.add(piece)
            }
            rail.add(polygon([[right - tip, y - tip * 0.42], [right, y], [right - tip, y + tip * 0.42]], { fill: 'faint', stroke: null }))
            this.rails.push(rail)
            const track = new Node().add(rail)
            this.marks.push(this.stages.map((stage, index) => {
                const made = this.markNode(stage.gate).at(this.mid(index), y)
                track.add(made)
                return made
            }))
            // A lane with no item yet says nothing, so it does not show. The first lane is the path itself.
            if (lane > 0) track.base.visible = false
            this.laneNodes.push(track)
            this.add(track)
            this.lanes.push({ owner: null, freeAt: -Infinity, left: '', shown: lane === 0, trail: this.stages.map(() => 'open') })
        }

        if (trayName !== null) {
            const y = this.trayY = up + trayMiddle
            const frame = rect(w - weight, trayHeight - weight, { radius: size * 0.5, stroke: 'faint', width: weight, fill: null }).at(0, y)
            frame.dash([size * 0.3, size * 0.26])
            frame.set('cap', 'butt')
            const name = text(trayName, { size, font, color: 'dim', anchor: 'left' }).at(this.origin + pad, y)
            this.trayStart = this.origin + pad + advance(name) + size * 0.8
            if (this.trayStart > right - pad - capsule) throw new Error(`pipeline: the name of the tray (${JSON.stringify(trayName)}) is ${Math.ceil(advance(name))} px wide, and it leaves no room for an item in a width of ${w}. Use a shorter name, or a wider \`width\``)
            this.tray = new Node().add(frame, name)
            this.trayName = name
            this.add(this.tray)
        }
        this.add(this.holder)
        // The layout measures the frame of the object, whatever its items do: an item that arrives starts a little before its place.
        this.layoutBox = [-w / 2, up, w / 2, up + height]
        // The pipeline places its names, its counts, the name of its tray, and the texts of each item. The film check does not judge that room.
        ownLabels(this, { name: 'pipeline' })
    }

    /** The ids of the items on the path and in the tray, in the order in which they came, after the changes that are scheduled so far. */
    get ids(): Id[] {
        return this.recs.map((rec) => rec.id)
    }

    /** The nodes of those items, in the same order. */
    get items(): PipelineItemNode[] {
        return this.recs.map((rec) => rec.node)
    }

    /** The node of one item: light it, or put a note beside it. */
    item(id: Id): PipelineItemNode {
        return this.rec(id).node
    }

    /** What an item is and where, after the changes that are scheduled so far. */
    stateOf(id: Id): PipelineItemState {
        return this.told(this.rec(id))
    }

    /** The ids of the items that a function picks, in the order in which they came, after the changes that are scheduled so far. */
    find(test: (item: PipelineItemState) => boolean): Id[] {
        if (typeof test !== 'function') throw new Error('pipeline: find takes a function of an item, such as (item) => item.state === \'stopped\'')
        return this.recs.filter((rec) => test(this.told(rec))).map((rec) => rec.id)
    }

    /**
     * The mark of a stage in a lane, the first lane by default: light it, or point at it. It holds a ring or a
     * diamond, a dot, a check and a cross, in this order, and one of them shows.
     */
    mark(stage: PipelineStageRef, lane = 0): Node {
        return this.marks[this.laneAt(lane, 'mark')]![this.stageAt(stage, 'mark')]!
    }

    /** What the mark of a stage shows in a lane, the first lane by default, after the changes that are scheduled so far. */
    trailOf(stage: PipelineStageRef, lane = 0): PipelineTrail {
        return this.lanes[this.laneAt(lane, 'trailOf')]!.trail[this.stageAt(stage, 'trailOf')]!
    }

    /** How many items are at a stage now, on the path. With no stage: how many are on the path. An item in the tray does not count. */
    count(stage?: PipelineStageRef): number {
        const index = stage === undefined ? null : this.stageAt(stage, 'count')
        return this.recs.filter((rec) => rec.where === 'path' && (index === null || rec.stage === index)).length
    }

    /** How many items reached a stage so far: what the count line of the stage shows. An item counts one time at a stage, also when it comes back for a second run. */
    reached(stage: PipelineStageRef): number {
        const index = this.stageAt(stage, 'reached')
        return this.before[index]! + this.arrivals[index]!.length
    }

    /**
     * A point over or under a stage, in the coordinates of the object, for a note or the end of an arrow:
     * on the top edge or the bottom edge of the object, at the x of the marks of the stage. Defaults to the top.
     */
    p(stage: PipelineStageRef, edge: 'top' | 'bottom' = 'top'): [number, number] {
        if (edge !== 'top' && edge !== 'bottom') throw new Error(`pipeline: the edge of p() is 'top' or 'bottom', not ${JSON.stringify(edge)}`)
        return [this.mid(this.stageAt(stage, 'p')), this.edges[edge === 'top' ? 0 : 1]]
    }

    /**
     * The box of a part of the object, in stage pixels, for `place` and `beside` of the layout. Without a part,
     * it is the area of the lanes. `stage` is the column of one stage, and `lane` is the row of one lane. The
     * two together are the place of one item. `tray` is the tray. The box is where the object is now, so ask
     * for it after the object has its place.
     */
    region(part: { stage?: PipelineStageRef; lane?: number; tray?: boolean } = {}): Box {
        const names = ['stage', 'lane', 'tray']
        if (typeof part !== 'object' || part === null) throw new Error(`pipeline: region takes an object such as { stage: 'schema' }, and it got ${part === null ? 'null' : typeof part}`)
        const unknown = Object.keys(part).find((name) => !names.includes(name))
        if (unknown !== undefined) throw new Error(`pipeline: region has no part "${unknown}". Its parts are: ${names.join(', ')}`)
        const half = this.capsule / 2
        let x0 = this.origin, x1 = this.w / 2, y0 = this.ys[0]! - half, y1 = this.ys[this.ys.length - 1]! + half
        if (part.tray) {
            if (part.stage !== undefined || part.lane !== undefined) throw new Error('pipeline: region takes `tray`, or `stage` and `lane`, not both')
            if (!this.tray) throw new Error('pipeline: region: the pipeline has no tray. Give it one with the option `tray`, such as tray: \'rejected\'')
            const tall = this.capsule + this.size * 0.9
            y0 = this.trayY - tall / 2
            y1 = this.trayY + tall / 2
        } else {
            if (part.stage !== undefined) {
                x0 = this.x(this.stageAt(part.stage, 'region'))
                x1 = x0 + this.pitch
            }
            if (part.lane !== undefined) {
                y0 = this.ys[this.laneAt(part.lane, 'region')]! - half
                y1 = y0 + this.capsule
            }
        }
        const corners = [this.toWorld(x0, y0), this.toWorld(x0, y1), this.toWorld(x1, y0), this.toWorld(x1, y1)]
        const xs = corners.map(([x]) => x), ys = corners.map(([, y]) => y)
        return new Box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
    }

    /** A copy with its own items and its own bookkeeping, at rest in the state that the pipeline has now. */
    protected override [rebindCloneParts](copy: this, twin: ReadonlyMap<Node, Node>): void {
        const recs = new Map<Rec, Rec>()
        for (const rec of this.recs) recs.set(rec, { ...rec, node: twin.get(rec.node) as PipelineItemNode, last: null })
        copy.marks = this.marks.map((row) => row.map((mark) => twin.get(mark)!))
        copy.recs = this.recs.map((rec) => recs.get(rec)!)
        copy.byId = new Map(copy.recs.map((rec) => [String(rec.id), rec]))
        copy.idFreeAt = new Map()
        copy.inTray = this.inTray.map((rec) => recs.get(rec)!)
        // The copy can take a change at any time: its lanes are free of the times of this pipeline.
        copy.lanes = this.lanes.map((lane) => ({ owner: lane.owner ? recs.get(lane.owner)! : null, freeAt: -Infinity, left: '', shown: lane.shown, trail: [...lane.trail] }))
        copy.before = this.stages.map((_, index) => this.reached(index))
        copy.arrivals = this.stages.map(() => [])
        copy.seen = this.seen.map((items) => new Set([...items].flatMap((rec) => (recs.has(rec) ? [recs.get(rec)!] : []))))
        // A node of the copy has no key, so each text of a count gets its own.
        copy.values = this.values.map((made, index) => {
            const next = new Map<number, Node>()
            for (const [value, node] of made) {
                const own = twin.get(node)!
                own.base.visible = false
                copy.follow(index, value, own)
                next.set(value, own)
            }
            return next
        })
    }

    /** The names, the line of the path, its marks and the tray arrive, stage by stage from the first. No item shows yet. */
    enter(options: AnimOptions = {}): Anim {
        timed('enter()', options)
        return {
            label: 'pipeline.enter', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'enter()')
                reveal(this, t0, ctx.stage)
                const fade = (node: Node, start: number, end: number) => {
                    stepAt(node, 'opacity', 0, t0)
                    node.tween('opacity', 1, start, end, ctx.ease)
                }
                const windows = staggered(this.stages.length, Math.max(0, options.lag ?? 0.4), t0, t1)
                this.stages.forEach((_, index) => {
                    const [start, end] = windows[index]!
                    fade(this.names[index]!, start, end)
                    if (this.counters[index]) fade(this.counters[index]!, start, end)
                    // A lane with no item yet stays hidden: its line and its marks are ready for its first item.
                    this.rails.forEach((rail, lane) => {
                        fade(this.marks[lane]![index]!, start, end)
                        const piece = rail.children[index]!
                        stepAt(piece, 'trimTo', 0, t0)
                        piece.tween('trimTo', 1, start, end, ctx.ease)
                    })
                })
                const late = t0 + (t1 - t0) * 0.6
                for (const rail of this.rails) fade(rail.children[rail.children.length - 1]!, late, t1)
                if (this.tray) fade(this.tray, late, t1)
            },
        }
    }

    /**
     * Items come to the path: each one at its stage, the first stage by default, in a lane that is free. With
     * a `lag`, they come one after another. An id that the pipeline has, and a path with no free lane, are errors.
     */
    put(items: PipelineItem | readonly PipelineItem[], options: AnimOptions = {}): Anim {
        // Find a wrong item now, where the film names it.
        const specs = (Array.isArray(items) ? items as readonly PipelineItem[] : [items as PipelineItem]).map((item) => this.checked(item))
        const call = `put(${specs.map((spec) => shown(spec.id)).join(', ')})`
        timed(call, options)
        return {
            label: 'pipeline.put', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                reveal(this, t0, ctx.stage)
                const windows = staggered(specs.length, options.lag ?? 0, t0, t1)
                specs.forEach((spec, index) => this.admit(spec, call, null, windows[index]![0], windows[index]![1], ctx.ease))
            },
        }
    }

    /**
     * Items move along the path: to the next stage, or to the stage that `to` names. An item that leaves a
     * stage leaves a mark there: a check at a gate and where it was passed, a dot at a stage. A move over
     * several stages goes through each stage between them, and leaves its mark there too. A move back to an
     * earlier stage takes the marks from that stage on away, for a second run. An item that is stopped does
     * not move on: `pass()` lets it through, and `eject()` takes it off the path.
     */
    move(which: PipelineWhich, to?: PipelineStageRef | AnimOptions, options: AnimOptions = {}): Anim {
        // `move(id, { duration })` has no stage: the options are the second argument.
        if (typeof to === 'object' && to !== null) return this.move(which, undefined, to)
        const target = to === undefined ? null : this.stageAt(to, 'move')
        const call = `move(${this.called(which)}${to === undefined ? '' : `, ${shown(to)}`})`
        timed(call, options)
        return {
            label: 'pipeline.move', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                this.each(which, call, options, ctx, (rec, t0, t1) => {
                    const from = rec.stage, next = target ?? from + 1
                    if (next >= this.stages.length) throw new Error(`pipeline: ${call}: item ${shown(rec.id)} is at the last stage, ${JSON.stringify(this.stages[from]!.name)}. exit() takes it off the path`)
                    if (next === from) return
                    if (next > from && rec.state === 'stopped') {
                        throw new Error(`pipeline: ${call}: item ${shown(rec.id)} is stopped at ${JSON.stringify(this.stages[from]!.name)}, so it does not move on. Let it through first with pass(${shown(rec.id)}), send it to the tray with eject(${shown(rec.id)}), or move it back to an earlier stage`)
                    }
                    const span = t1 - t0, turn = t0 + span * 0.35
                    const step = next > from ? 1 : -1
                    if (step > 0) {
                        this.trail(rec.lane, from, this.behind(rec, true), t0, turn, ctx.ease)
                    } else {
                        // A second run starts from marks that say nothing yet.
                        for (let index = next; index <= from; index++) this.trail(rec.lane, index, 'open', t0, turn, ctx.ease)
                    }
                    // A crossing counts in either direction. Only forward travel leaves a verdict on the path.
                    for (let index = from + step; index !== next; index += step) {
                        const at = t0 + reaches(ctx.ease, (index - from) / (next - from)) * span
                        if (step > 0) this.trail(rec.lane, index, this.stages[index]!.gate ? 'passed' : 'visited', at, Math.min(t1, at + span * 0.1), ctx.ease)
                        this.arrive(rec, index, at)
                    }
                    // The verdict of a stage stays at that stage. The reason of a stop goes with the stop.
                    this.dress(rec, 'waiting', rec.reason ? undefined : rec.badge, false, t0, turn, ctx.ease)
                    rec.node.tween('x', this.x(next), t0, t1, ctx.ease)
                    rec.stage = next
                    this.arrive(rec, next, t1)
                })
            },
        }
    }

    /**
     * The text after the id changes in place: the value that the item carries, or the stamp that it took. The
     * old text fades out, the capsule takes its new width, and the new text fades in. `null` takes the text
     * away. The id does not move. A text that is too wide for the room of a stage is an error.
     */
    setBadge(which: PipelineWhich, badge: string | null, options: AnimOptions = {}): Anim {
        const next = badge === null ? undefined : oneLine('the badge', badge)
        const call = `setBadge(${this.called(which)})`
        timed(call, options)
        // Earlier changes in a sequence can remove the verdict before this badge appears.
        this.early(which, (rec) => this.fits(rec.id, rec.idEnd, 'waiting', next))
        return {
            label: 'pipeline.setBadge', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                this.each(which, call, options, ctx, (rec, t0, t1) => this.dress(rec, rec.state, next, false, t0, t1, ctx.ease))
            },
        }
    }

    /**
     * The stage lets an item through: the item shows a check. With a `badge`, the item also takes that text,
     * such as 'schema ok'. The item stays at its stage, and `move()` takes it on. On an item that is stopped,
     * `pass()` ends the stop, and the reason goes.
     */
    pass(which: PipelineWhich, badge?: string | AnimOptions, options: AnimOptions = {}): Anim {
        if (typeof badge === 'object' && badge !== null) return this.pass(which, undefined, badge)
        const next = badge === undefined ? undefined : oneLine('the badge', badge)
        const call = `pass(${this.called(which)})`
        timed(call, options)
        this.early(which, (rec) => this.fits(rec.id, rec.idEnd, 'passed', next))
        return {
            label: 'pipeline.pass', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                this.each(which, call, options, ctx, (rec, t0, t1) => this.dress(rec, 'passed', next ?? (rec.reason ? undefined : rec.badge), false, t0, t1, ctx.ease))
            },
        }
    }

    /**
     * The stage stops an item: the item shows a cross, its border takes the color red, and the `reason` is
     * the text after its id. The item stays at its stage. `eject()` sends it to the tray with its reason.
     */
    stop(which: PipelineWhich, reason?: string | AnimOptions, options: AnimOptions = {}): Anim {
        if (typeof reason === 'object' && reason !== null) return this.stop(which, undefined, reason)
        const next = reason === undefined ? undefined : oneLine('the reason', reason)
        const call = `stop(${this.called(which)})`
        timed(call, options)
        this.early(which, (rec) => this.fits(rec.id, rec.idEnd, 'stopped', next))
        return {
            label: 'pipeline.stop', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                this.each(which, call, options, ctx, (rec, t0, t1) => {
                    if (rec.state !== 'stopped') {
                        // The item runs into the stage and comes back: a short way on, in the first part of the time.
                        const x = this.x(rec.stage), bump = this.size * 0.4
                        rec.node.track('x').add({ t0, t1: t0 + (t1 - t0) * 0.45, ease: null, to: x, at: (alpha) => x + bump * Math.sin(Math.PI * alpha) })
                    }
                    this.dress(rec, 'stopped', next ?? rec.badge, next !== undefined || rec.reason, t0, t1, ctx.ease)
                })
            },
        }
    }

    /**
     * Items leave the path for the tray, each one as it is: with its cross and its reason. They take the
     * places of the tray from the left, in the order in which they come. The lane of an item is free when
     * the item is in the tray, and its marks stay until the next item takes the lane. An item in the tray
     * takes no other change. A tray with no room for an item is an error.
     */
    eject(which: PipelineWhich, options: AnimOptions = {}): Anim {
        const call = `eject(${this.called(which)})`
        timed(call, options)
        if (!this.tray) throw new Error(`pipeline: ${call}: the pipeline has no tray. Give it one with the option \`tray\`, such as tray: 'rejected'`)
        return {
            label: 'pipeline.eject', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                this.each(which, call, options, ctx, (rec, t0, t1) => {
                    const gap = this.size * 0.5
                    const start = this.inTray.reduce((x, other) => x + other.width + gap, this.trayStart)
                    const room = this.w / 2 - this.size * PAD - start
                    if (rec.width > room + 0.5) {
                        throw new Error(`pipeline: ${call}: the tray has no room for item ${shown(rec.id)}. It holds ${this.inTray.length} item${this.inTray.length === 1 ? '' : 's'}, and ${Math.max(0, Math.floor(room))} px are left for an item of ${Math.ceil(rec.width)} px. Use shorter reasons, a wider \`width\`, or send fewer items to the tray`)
                    }
                    const crossesItems = rec.lane < this.lanes.length - 1 || this.inTray.length > 0
                    this.leave(rec, call, false, t0, t1, ctx.ease)
                    rec.where = 'tray'
                    this.inTray.push(rec)
                    // On its way, the item goes behind the items of the lanes that it passes: they stay readable.
                    stepAt(rec.node, 'z', -1, t0)
                    stepAt(rec.node, 'z', 0, t1)
                    // A lower capsule can cover half a word in transit. Carry the border across and restore the label in the tray.
                    const depart = crossesItems ? t0 + (t1 - t0) * 0.15 : t0
                    const arrive = crossesItems ? t1 - (t1 - t0) * 0.15 : t1
                    if (crossesItems) {
                        rec.node.content.tween('opacity', 0, t0, depart, ctx.ease)
                        rec.node.content.tween('opacity', 1, arrive, t1, ctx.ease)
                    }
                    rec.node.tween('x', start, depart, arrive, ctx.ease)
                    rec.node.tween('y', this.trayY, depart, arrive, ctx.ease)
                })
            },
        }
    }

    /**
     * Items leave the pipeline: each one goes a short way on and fades. Its lane is free then, and its id too.
     * Use it for an item that is done, so that the next item can take its lane.
     */
    exit(which: PipelineWhich, options: AnimOptions = {}): Anim {
        const call = `exit(${this.called(which)})`
        timed(call, options)
        return {
            label: 'pipeline.exit', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                this.each(which, call, options, ctx, (rec, t0, t1) => {
                    // An item that is done goes on, so a gate that it waited at let it through.
                    this.leave(rec, call, true, t0, t1, ctx.ease)
                    this.gone(rec, t0, t1, ctx.ease, this.x(rec.stage) + this.size * 1.2, this.ys[rec.lane]!)
                })
            },
        }
    }

    /**
     * One item becomes two: a new item comes out of the item `from`, at the same stage, and takes a free lane.
     * Use it for a request that goes on as two parts, such as a text and an action. Both then go through the
     * stages that are left.
     */
    fork(from: Id, item: PipelineItem, options: AnimOptions = {}): Anim {
        if (item !== null && typeof item === 'object' && item.at !== undefined) throw new Error('pipeline: fork: the new item starts at the stage of the item that it comes from. Leave `at` out')
        const spec = this.checked(item)
        const call = `fork(${shown(from)}, ${shown(spec.id)})`
        timed(call, options)
        return {
            label: 'pipeline.fork', duration: options.duration ?? 0.7, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const parent = this.onPath(this.rec(from, call), call)
                const before = parent.last
                this.claim(parent, call, t0, t1)
                try {
                    this.admit({ ...spec, stage: parent.stage }, call, parent, t0, t1, ctx.ease)
                } catch (error) {
                    parent.last = before
                    throw error
                }
            },
        }
    }

    /**
     * Two items become one: the item `which` goes to the item `into` and ends there. Its lane is free then,
     * and its id too. The item `into` stays as it is: change its badge to show what it now carries.
     */
    join(which: Id, into: Id, options: AnimOptions = {}): Anim {
        const call = `join(${shown(which)}, ${shown(into)})`
        timed(call, options)
        if (String(which) === String(into)) throw new Error(`pipeline: ${call}: an item joins another item. Give two ids`)
        return {
            label: 'pipeline.join', duration: options.duration ?? 0.7, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const rec = this.onPath(this.rec(which, call), call), target = this.onPath(this.rec(into, call), call)
                const before = rec.last
                this.claim(rec, call, t0, t1)
                try {
                    // The item that is joined stays where it is while the other one comes.
                    this.claim(target, call, t0, t1)
                } catch (error) {
                    rec.last = before
                    throw error
                }
                this.leave(rec, call, false, t0, t1, ctx.ease)
                this.gone(rec, t0, t1, ctx.ease, this.x(target.stage), this.ys[target.lane]!, true)
            },
        }
    }

    /** The x of the left end of an item at a stage. */
    private x(stage: number): number {
        return this.origin + stage * this.pitch
    }

    /** The x of the marks of a stage: the middle of the round end of an item that is there. */
    private mid(stage: number): number {
        return this.x(stage) + this.capsule / 2
    }

    private known(): string {
        return `The stages are ${this.stages.map((stage, index) => `${index} (${JSON.stringify(stage.name)})`).join(', ')}`
    }

    private stageAt(ref: unknown, call: string): number {
        if (typeof ref === 'number' && Number.isInteger(ref) && ref >= 0 && ref < this.stages.length) return ref
        const index = typeof ref === 'string' ? this.stages.findIndex((stage) => stage.name === ref) : -1
        if (index < 0) throw new Error(`pipeline: ${call}: no stage ${typeof ref === 'string' ? JSON.stringify(ref) : String(ref)}. ${this.known()}`)
        return index
    }

    private laneAt(lane: unknown, call: string): number {
        if (typeof lane !== 'number' || !Number.isInteger(lane) || lane < 0 || lane >= this.lanes.length) {
            throw new Error(`pipeline: ${call}: no lane ${String(lane)}. The pipeline has ${this.lanes.length} lane${this.lanes.length === 1 ? '' : 's'}, from 0${this.lanes.length === 1 ? '. Give it more with the option `lanes`' : ` to ${this.lanes.length - 1}`}`)
        }
        return lane
    }

    private rec(id: Id, call = ''): Rec {
        const rec = this.byId.get(String(id))
        if (!rec) {
            const ids = this.recs.map((other) => shown(other.id))
            throw new Error(`pipeline: ${call ? `${call}: ` : ''}no item ${shown(id)}. ${ids.length > 0 ? `The items are ${ids.join(', ')}` : 'The pipeline has no item yet: put() brings one'}`)
        }
        return rec
    }

    private told(rec: Rec): PipelineItemState {
        return { id: rec.id, stage: rec.stage, name: this.stages[rec.stage]!.name, lane: rec.where === 'path' ? rec.lane : null, state: rec.state, where: rec.where, badge: rec.badge }
    }

    /** How a message names the items of a call. */
    private called(which: PipelineWhich): string {
        return typeof which === 'function' ? 'a function' : Array.isArray(which) ? (which as readonly Id[]).map(shown).join(', ') : shown(which as Id)
    }

    /** The times of an animation. A time that is not a number would write keys that no frame finds. */
    private times(ctx: AnimContext, call: string): [number, number] {
        if (!(Number.isFinite(ctx.t0) && Number.isFinite(ctx.t1) && ctx.t1 >= ctx.t0)) throw new Error(`pipeline: ${call} plays from ${String(ctx.t0)} to ${String(ctx.t1)}. Give the play a duration that is a number, 0 or more`)
        return [ctx.t0, ctx.t1]
    }

    private onPath(rec: Rec, call: string): Rec {
        if (rec.where === 'tray') throw new Error(`pipeline: ${call}: item ${shown(rec.id)} is in the tray, and an item in the tray takes no change. Change it before eject() sends it there`)
        return rec
    }

    /**
     * Take the time of a change of an item. Each change starts from what the change before it left. Two
     * changes of one item at one time would each write their own way, and the picture would follow neither.
     */
    private claim(rec: Rec, call: string, t0: number, t1: number): void {
        const last = rec.last
        if (last && t0 < last.t1 - SOON) {
            const gap = t0 - last.t0
            const advice = gap < -SOON
                ? `The pipeline takes the changes of an item in the order of time, and the film calls ${last.call} first. Call ${call} before it`
                : gap <= SOON
                    ? 'Play the two in a `seq`: each then has its share of the time of the play'
                    : `Give ${last.call} a \`duration\` of ${Math.round(gap * 1000) / 1000} or less, or play the two in a \`seq\``
            throw new Error(`pipeline: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. An item takes one change at a time: a change starts when the change before it is over. ${advice}`)
        }
        rec.last = { call, t0, t1 }
    }

    /** Check now what a call can check about the items that it names by id, where the film names them. An id that comes later is checked when the change is scheduled. */
    private early(which: PipelineWhich, check: (rec: Rec) => void): void {
        if (typeof which === 'function') return
        for (const id of Array.isArray(which) ? which as readonly Id[] : [which as Id]) {
            const rec = this.byId.get(String(id))
            if (rec) check(rec)
        }
    }

    /** Run a change for each item of a call, each in its share of the time. */
    private each(which: PipelineWhich, call: string, options: AnimOptions, ctx: AnimContext, run: (rec: Rec, t0: number, t1: number) => void): void {
        const [t0, t1] = this.times(ctx, call)
        reveal(this, t0, ctx.stage)
        const picked = typeof which === 'function'
            ? this.recs.filter((rec) => rec.where === 'path' && which(this.told(rec)))
            : (Array.isArray(which) ? which as readonly Id[] : [which as Id]).map((id) => this.onPath(this.rec(id, call), call))
        const twice = picked.find((rec, index) => picked.indexOf(rec) !== index)
        if (twice) throw new Error(`pipeline: ${call} names item ${shown(twice.id)} two times`)
        const windows = staggered(picked.length, options.lag ?? 0, t0, t1)
        picked.forEach((rec, index) => {
            const [start, end] = windows[index]!
            const before = rec.last
            this.claim(rec, call, start, end)
            try {
                run(rec, start, end)
            } catch (error) {
                // A change that stops with an error took no time of the item.
                rec.last = before
                throw error
            }
        })
    }

    /** One item to put on the path, with what the film got wrong said now. */
    private checked(item: PipelineItem): Spec {
        if (typeof item !== 'object' || item === null) throw new Error(`pipeline: an item is { id, badge, color }, and it got ${item === null ? 'null' : typeof item}`)
        if (typeof item.id !== 'string' && typeof item.id !== 'number') throw new Error(`pipeline: the id of an item is ${String(item.id)}. An id is a text or a number, such as 'R-104'`)
        oneLine(`the id ${shown(item.id)}`, String(item.id))
        const badge = item.badge === undefined ? undefined : oneLine(`the badge of item ${shown(item.id)}`, item.badge)
        const spec: Spec = {
            id: item.id, badge, color: paintOf(item.color ?? this.ownColor, `the color of item ${shown(item.id)}`),
            stage: item.at === undefined ? 0 : this.stageAt(item.at, `item ${shown(item.id)}`),
            lane: item.lane === undefined ? undefined : this.laneAt(item.lane, `item ${shown(item.id)}`),
        }
        this.fits(spec.id, this.size * PAD + advance(this.idNode(spec.id, spec.color)), 'waiting', badge)
        return spec
    }

    private idNode(id: Id, color: Paint): Node {
        return text(String(id), { size: this.size, font: this.itemFont, weight: 600, color, anchor: 'left' })
    }

    private badgeNode(badge: string): Node {
        return text(badge, { size: this.size, font: this.itemFont, color: 'ink', anchor: 'left' })
    }

    /** Where the parts of a capsule are, from its left edge, and how wide it is. */
    private plan(idEnd: number, state: Verdict, badge: number | null): { mark: number; badge: number; width: number } {
        const size = this.size
        const mark = idEnd + size * MARK_GAP + size * GLYPH / 2
        let end = state === 'waiting' ? idEnd : mark + size * GLYPH / 2
        const at = end + size * (state === 'waiting' ? BADGE_GAP : MARK_GAP)
        if (badge !== null) end = at + badge
        return { mark, badge: at, width: Math.max(this.capsule, end + size * PAD) }
    }

    /** A capsule has the room of one stage, less a clear gap before the next one. A wider one is an error that says what fits. */
    private fits(id: Id, idEnd: number, state: Verdict, badge: string | undefined): void {
        const width = this.plan(idEnd, state, badge === undefined ? null : advance(this.badgeNode(badge))).width
        const room = this.pitch - this.size * CLEAR
        if (width <= room + 0.5) return
        const least = Math.ceil((width + this.size * CLEAR) * this.stages.length + this.size * TAIL)
        const what = badge === undefined ? `Item ${shown(id)}` : `Item ${shown(id)} with the text ${JSON.stringify(badge)}`
        throw new Error(`pipeline: ${what} is ${Math.ceil(width)} px wide at size ${this.size}, and a stage has room for ${Math.max(0, Math.floor(room))} px. Use a shorter ${badge === undefined ? 'id' : 'text'}, a width of ${least} or more, a smaller \`size\`, or fewer stages`)
    }

    private capsulePath(width: number): Path {
        return rectPath(0, -this.capsule / 2, width, this.capsule, this.capsule / 2)
    }

    /** The mark of a stage in a lane: a ring or a diamond, and what an item leaves there. One of the four shows. */
    private markNode(gate: boolean): Node {
        const size = this.size, weight = Math.max(2, size * 0.085), glyph = size * GLYPH
        const open = gate
            ? polygon([[0, -size * 0.34], [size * 0.34, 0], [0, size * 0.34], [-size * 0.34, 0]], { stroke: 'dim', width: weight, fill: null })
            : circle(size * 0.25, { stroke: 'dim', width: weight, fill: null })
        const parts = [open, dot(size * 0.25, 'dim'), this.check(glyph), this.cross(glyph)]
        parts.slice(1).forEach((part) => { part.base.visible = false })
        return new Node().add(...parts)
    }

    private check(side: number): Node {
        return polyline([[-0.5 * side, 0.06 * side], [-0.14 * side, 0.42 * side], [0.5 * side, -0.4 * side]], { stroke: 'green', width: Math.max(2.5, this.size * 0.11) })
    }

    private cross(side: number): Node {
        const half = side * 0.42
        return svgPath(`M${-half} ${-half}L${half} ${half}M${half} ${-half}L${-half} ${half}`, { stroke: 'red', width: Math.max(2.5, this.size * 0.11) })
    }

    /** The mark of a stage in a lane takes another look. */
    private trail(lane: number, stage: number, look: Trail, t0: number, t1: number, ease: Ease): void {
        const state = this.lanes[lane]!
        const before = state.trail[stage]!
        if (before === look) return
        state.trail[stage] = look
        const order: Trail[] = ['open', 'visited', 'passed', 'stopped']
        const parts = this.marks[lane]![stage]!.children
        const old = parts[order.indexOf(before)]!, next = parts[order.indexOf(look)]!
        old.tween('opacity', 0, t0, t1, ease)
        stepAt(old, 'visible', false, t1)
        stepAt(next, 'visible', true, t0)
        stepAt(next, 'opacity', 0, t0)
        next.tween('opacity', 1, t0, t1, ease)
    }

    /** What an item leaves at its stage when it goes: its verdict, or a sign that it went on. */
    private behind(rec: Rec, on: boolean): Trail {
        if (rec.state === 'stopped') return 'stopped'
        if (rec.state === 'passed') return 'passed'
        // An item that goes on through a gate passed it.
        return on && this.stages[rec.stage]!.gate ? 'passed' : 'visited'
    }

    /** The text of one value of the count of a stage. It shows while the count has that value. */
    private countText(stage: number, value: number): Node {
        const made = this.values[stage]!
        let node = made.get(value)
        if (node) return node
        const content = this.say!(value)
        if (typeof content !== 'string') throw new Error(`pipeline: the count line for ${value} is ${String(content)}. \`counts\` returns a text`)
        oneLine(`the count line for ${value}`, content)
        node = text(content, { size: this.size, font: this.font, color: 'dim', anchor: 'left' })
        const room = this.pitch - this.size * (PAD + CLEAR)
        if (advance(node) > room + 0.5) throw new Error(`pipeline: the count line ${JSON.stringify(content)} is ${Math.ceil(advance(node))} px wide, and a stage has room for ${Math.floor(room)} px. Write a shorter line in \`counts\`, or use a wider \`width\``)
        node.base.visible = false
        made.set(value, node)
        this.counters[stage]!.add(node)
        ownLabels(this, { labels: [node] })
        this.follow(stage, value, node)
        return node
    }

    /** Give the text of a value a key that reads the count at every frame. So the count is right whatever the order of the calls. */
    private follow(stage: number, value: number, node: Node): void {
        node.track('visible').add(always((time) => this.before[stage]! + this.arrivals[stage]!.filter((at) => at <= time).length === value, false))
    }

    /** An item reaches a stage at a time. It counts there one time. */
    private arrive(rec: Rec, stage: number, time: number): void {
        const items = this.seen[stage]!
        if (items.has(rec)) return
        items.add(rec)
        this.arrivals[stage]!.push(time)
        if (this.say) this.countText(stage, this.reached(stage))
    }

    /** Bring one item to the path. With `from`, it comes out of that item. */
    private admit(spec: Spec, call: string, from: Rec | null, t0: number, t1: number, ease: Ease): void {
        if (this.byId.has(String(spec.id))) throw new Error(`pipeline: ${call}: the pipeline has an item ${shown(spec.id)} already. An id is on the pipeline one time: give the new item another id, or let the first one exit()`)
        const freeAt = this.idFreeAt.get(String(spec.id))
        if (freeAt !== undefined && t0 < freeAt - SOON) throw new Error(`pipeline: ${call} starts at ${seconds(t0)}. The id ${shown(spec.id)} is free from ${seconds(freeAt)}. Wait for the previous item to finish leaving`)
        const available = this.lanes.findIndex((state) => state.owner === null && t0 >= state.freeAt - SOON)
        const lane = spec.lane ?? (available >= 0 ? available : this.lanes.findIndex((state) => state.owner === null))
        if (lane < 0) {
            const holders = this.lanes.map((state) => shown(state.owner!.id)).join(', ')
            throw new Error(`pipeline: ${call}: no lane is free for item ${shown(spec.id)}. The pipeline has ${this.lanes.length} lane${this.lanes.length === 1 ? '' : 's'}, with ${holders}. Give it more with the option \`lanes\`, or take an item off the path first with eject() or exit()`)
        }
        const state = this.lanes[lane]!
        if (state.owner) throw new Error(`pipeline: ${call}: lane ${lane} holds item ${shown(state.owner.id)}. Give item ${shown(spec.id)} another lane, or leave \`lane\` out for the first free one`)
        if (t0 < state.freeAt - SOON) throw new Error(`pipeline: ${call} starts at ${seconds(t0)}, and lane ${lane} is free from ${seconds(state.freeAt)}, when ${state.left} is over. Start it then or later, or give the pipeline more \`lanes\``)

        const size = this.size
        const idText = this.idNode(spec.id, spec.color).at(size * PAD, 0)
        const idEnd = size * PAD + advance(idText)
        const badge = spec.badge === undefined ? null : this.badgeNode(spec.badge)
        const plan = this.plan(idEnd, 'waiting', badge ? advance(badge) : null)
        const capsule = new Node(this.capsulePath(plan.width)).fill('surface').stroke(spec.color, Math.max(2, size * 0.09))
        const check = this.check(size * GLYPH).at(plan.mark, 0), cross = this.cross(size * GLYPH).at(plan.mark, 0)
        check.base.visible = false
        cross.base.visible = false
        const node = new PipelineItemNode(capsule, idText, check, cross)
        if (badge) {
            node.content.add(badge.at(plan.badge, 0))
            node.badge = badge
        }
        const rec: Rec = { id: spec.id, node, color: spec.color, stage: spec.stage, lane, state: 'waiting', where: 'path', badge: spec.badge, reason: false, width: plan.width, idEnd, last: { call, t0, t1 } }
        // The marks of the lane are of the item before. The new item starts from marks that say nothing.
        const turn = t0 + (t1 - t0) * 0.4
        this.stages.forEach((_, index) => this.trail(lane, index, 'open', t0, turn, ease))
        state.owner = rec
        this.recs.push(rec)
        this.byId.set(String(spec.id), rec)

        // A lane shows from its first item: its line and its marks come with it.
        if (!state.shown) {
            state.shown = true
            const track = this.laneNodes[lane]!
            stepAt(track, 'visible', true, t0)
            stepAt(track, 'opacity', 0, t0)
            track.tween('opacity', 1, t0, t1, ease)
        }
        const x = this.x(spec.stage), y = this.ys[lane]!
        node.at(from ? this.x(from.stage) : x - size * 0.5, from ? this.ys[from.lane]! : y)
        // The capsule hides the line of the lane under it. So it comes first, with no text on it, and the text
        // fades in on a capsule that is whole: no line shows through a text that is half there.
        capsule.base.fillOpacity = 0
        capsule.base.strokeOpacity = 0
        node.content.base.opacity = 0
        const saved = clock.now
        clock.now = t0
        this.holder.add(node)
        clock.now = saved
        ownLabels(this, { labels: [idText, badge] })
        const whole = t0 + (t1 - t0) * 0.2
        // An item that comes out of another one shows its text when it is clear of that item.
        const clear = from ? t0 + (t1 - t0) * 0.7 : whole
        capsule.tween('fillOpacity', 1, t0, whole, ease)
        capsule.tween('strokeOpacity', 1, whole, t1, ease)
        node.content.tween('opacity', 1, clear, t1, ease)
        node.tween('x', x, t0, t1, ease)
        if (from) {
            // The new item comes out from under the item that it leaves.
            stepAt(node, 'z', -1, t0)
            stepAt(node, 'z', 0, t1)
            node.tween('y', y, t0, t1, ease)
        }
        this.arrive(rec, spec.stage, (t0 + t1) / 2)
    }

    /**
     * An item takes a verdict and a text. What changes fades out in the first part of the time, the capsule
     * takes its new width, and what is new fades in. So no moment shows two texts at one place.
     */
    private dress(rec: Rec, state: Verdict, badge: string | undefined, reason: boolean, t0: number, t1: number, ease: Ease): void {
        const node = rec.node
        if (rec.state === state && rec.badge === badge) {
            rec.reason = reason && badge !== undefined
            return
        }
        const next = badge === undefined ? null : rec.badge === badge ? node.badge : this.badgeNode(badge)
        this.fits(rec.id, rec.idEnd, state, badge)
        const plan = this.plan(rec.idEnd, state, next ? advance(next) : null)
        const out = t0 + (t1 - t0) * 0.4, back = t0 + (t1 - t0) * 0.6
        const leave = (part: Node) => {
            part.tween('opacity', 0, t0, out, ease)
            stepAt(part, 'visible', false, out)
        }
        const come = (part: Node) => {
            stepAt(part, 'visible', true, back)
            stepAt(part, 'opacity', 0, back)
            part.tween('opacity', 1, back, t1, ease)
        }
        if (rec.state !== state) {
            if (rec.state === 'passed') leave(node.check)
            if (rec.state === 'stopped') leave(node.cross)
            if (state === 'passed') come(node.check)
            if (state === 'stopped') come(node.cross)
            node.capsule.tween('stroke', state === 'stopped' ? toPaint('red') : rec.color, t0, t1, ease)
        }
        if (rec.badge !== badge) {
            if (node.badge) leave(node.badge)
            if (next) {
                next.at(plan.badge, 0)
                next.base.visible = false
                const saved = clock.now
                clock.now = t0
                node.content.add(next)
                clock.now = saved
                ownLabels(this, { labels: [next] })
                come(next)
            }
            node.badge = next
        } else if (next) {
            // The same text has another place when a check or a cross comes or goes before it.
            next.tween('x', plan.badge, out, back, ease)
        }
        if (plan.width !== rec.width) {
            const from = rec.width, to = plan.width
            node.capsule.track('path').add({ t0: out, t1: back, ease, to: this.capsulePath(to), at: (alpha) => this.capsulePath(from + (to - from) * alpha) })
        }
        rec.state = state
        rec.badge = badge
        rec.reason = reason && badge !== undefined
        rec.width = plan.width
    }

    /** An item leaves the path: its stage keeps its mark, and its lane is free when the change is over. */
    private leave(rec: Rec, call: string, on: boolean, t0: number, t1: number, ease: Ease): void {
        this.trail(rec.lane, rec.stage, this.behind(rec, on), t0, t0 + (t1 - t0) * 0.35, ease)
        const state = this.lanes[rec.lane]!
        state.owner = null
        state.freeAt = t1
        state.left = call
    }

    /**
     * An item goes to a place and fades there. It is not an item of the pipeline after that. With `early`, its
     * texts are gone before it leaves its lane, for an item that ends behind another one.
     */
    private gone(rec: Rec, t0: number, t1: number, ease: Ease, x: number, y: number, early = false): void {
        const node = rec.node, span = t1 - t0
        // Under the other items, so an item that joins another one ends behind it.
        stepAt(node, 'z', -1, t0)
        node.tween('x', x, t0, t1, ease)
        node.tween('y', y, t0, t1, ease)
        // The texts go first, on a capsule that is whole. The capsule goes when no text is on it.
        const fades = early ? t0 : t0 + span * 0.3, bare = early ? t0 + span * 0.3 : t0 + span * 0.8
        node.content.tween('opacity', 0, fades, bare, ease)
        node.capsule.tween('strokeOpacity', 0, fades, bare, ease)
        node.capsule.tween('fillOpacity', 0, early ? t0 + span * 0.6 : bare, t1, ease)
        stepAt(node, 'visible', false, t1)
        this.recs.splice(this.recs.indexOf(rec), 1)
        this.byId.delete(String(rec.id))
        this.idFreeAt.set(String(rec.id), t1)
    }
}

/**
 * A path of stages with items that go through them:
 * `pipeline(['complete', 'schema', 'authorization', 'execute'], { gates: true, tray: 'refused' })`. `flow.put({ id: 'call 17' })`
 * brings an item, `flow.move('call 17')` takes it to the next stage, and `flow.stop('call 17', 'no grant')` stops it there.
 */
export function pipeline(stages: readonly (string | PipelineStage)[], options: PipelineOptions = {}): Pipeline {
    return new Pipeline(stages, options)
}
