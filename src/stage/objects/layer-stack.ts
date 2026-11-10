import { Node, ownLabels, rebindCloneParts } from '../node'
import { apply, circlePath, invert, linePath, parseSvgPath, pathLength, pointAt, polyPath, rectPath, type Path } from '../geometry'
import { rect } from '../shapes'
import { filmFont, text, TextNode, type TextOptions } from '../text'
import { toPaint, type ColorInput, type Paint } from '../color'
import { smooth, type Ease } from '../ease'
import type { Anim, AnimContext, AnimOptions } from '../anim'
import { Box, boxOf, nodesFor, type Block } from '../layout'
import { reaches, reveal, sampleAt, staggered, stepAt } from './util'

/** The id of a block, or its index. The blocks count from the foot of the stream up, and a branch counts from its first block. */
export type StackBlockRef = string | number

/** The mark at the right end of a block in a state, so that a viewer can tell two states with no color. */
export type StackMark = 'lock' | 'check' | 'cross' | 'dot'

export interface StackBlock {
    /** The name on the block, on one line. */
    label: string
    /** The name that the film uses for the block, in `light()`, `pass()` and `p()`. Defaults to the label. */
    id?: string
    /** Defaults to the `color` of the stack. */
    color?: ColorInput
    /** Defaults to the first state of `states`. */
    state?: string
    /** The shape of the data on the stream after this block, such as '(T, 768)'. Only a block on the stream can have one. */
    shape?: string
}

/**
 * Blocks beside the stream. The branch reads the stream under its first block and adds its result to the
 * stream over its last block, so the stream passes it as a plain line: a residual connection.
 */
export interface StackBranch {
    /** The blocks of the branch, from the first one, which is the lowest. */
    branch: readonly (string | StackBlock)[]
    /** A block on the stream beside the branch, for a branch around a weight, such as LoRA beside a frozen matrix. */
    around?: string | StackBlock
    /** With false, the branch has its place from the start and does not show. `show()` brings it in. Defaults to true. */
    shown?: boolean
}

/** Layers in one frame, such as the layers of a block that repeats. */
export interface StackGroup {
    layers: readonly (string | StackBlock | StackBranch)[]
    /** How many times the group repeats: a count, 2 or more, or a name such as 'N'. The frame then says "× 12". */
    repeat?: number | string
    /** The name of the group, on the top line of its frame. */
    label?: string
}

export type StackLayer = string | StackBlock | StackBranch | StackGroup

export interface StackPassOptions extends AnimOptions {
    /** The output of the block on the main path before a visible branch adds its contribution. Defaults to the incoming values. */
    aroundValues?: readonly number[]
}

export interface StackState {
    /** The color of a block in this state. Without it, the block keeps its own color. */
    color?: ColorInput
    /** Draw the block dim, for a part that does not train or does not run. */
    dim?: boolean
    /** A border of dashes, for a block that is skipped or is not there. */
    dash?: boolean
    /** A small mark at the right end of the block. A state that differs from the others only by its color needs one. */
    mark?: StackMark
}

/** States for the parts of a model that train and the parts that do not. The frozen state has a lock, so color is not its only sign. */
export const STACK_STATES = {
    /** The block as it is. */
    live: {},
    /** Weights that do not train. */
    frozen: { dim: true, mark: 'lock' },
} satisfies Record<string, StackState>

export interface LayerStackOptions {
    /** The width of the whole object, with its frames and its shapes. Defaults to the width that the labels need. A label that does not fit is an error. */
    width?: number
    /** Text size of the labels, the shapes and the numbers. Defaults to 28. */
    size?: number
    /** The height of a block. Defaults to 1.9 of `size`. */
    blockHeight?: number
    /** The room on the stream between two layers, where the vector rests. Defaults to the room that the vector needs. */
    gap?: number
    /** The color of a block that has none. Defaults to blue. */
    color?: ColorInput
    /** The states and their looks. Defaults to STACK_STATES. */
    states?: Record<string, StackState>
    /** The number of cells of the vector that travels on the stream. Defaults to 4. */
    cells?: number
    /** With a number, each cell of the vector shows its value with that many decimals, and a cell is as wide as a value under 10 needs. */
    digits?: number
    /** The shape of the data at the foot of the stream, before the first layer, such as '(T)'. */
    shape?: string
    /** The color behind the blocks, which hides the stream and the vector there. Defaults to the background of the look. On a panel of another color, give that color. */
    backing?: ColorInput
    font?: TextOptions['font']
}

/** A block as `find()` and `mark()` give it to a function. */
export interface StackBlockInfo {
    index: number
    id: string
    label: string
    state: string
    /** The place of its layer on the stream, 0 for the first one. The blocks of a branch have one layer. */
    layer: number
    /** False for a block of a branch that waits for `show()`. */
    shown: boolean
}

type Role = 'stream' | 'side' | 'around'

/** What a block is, and where. It does not change. */
interface BlockPlan {
    id: string
    layer: number
    role: Role
    x: number
    y: number
    width: number
    /** The place of its shape in the list of shapes, or -1. */
    shape: number
}

/** One layer on the stream: a block, or a branch with its add. It does not change. */
interface LayerPlan {
    branch: boolean
    /** The block of a plain layer, or the blocks of the branch, from the first one. */
    blocks: readonly number[]
    /** The block on the stream beside a branch, or -1. */
    around: number
    /** The place of its group in `frames`, or -1. */
    group: number
    /** The y of the point where a branch leaves the stream, and of its add. */
    tapY: number
    plusY: number
    /** The place of the parts of a branch in `taps`, `adds`, `reads` and `writes`, or -1. */
    part: number
    /** The lines between the blocks of a branch, as places in `chains`. */
    chains: readonly number[]
    /** The ways of the copy: from the stream into the first block, and from the last block to the add. */
    readWay: Path
    writeWay: Path
}

/** The time of the last change of a part that does one thing at a time. */
interface Claim {
    call: string
    t0: number
    t1: number
}

/** A static clone starts with its own timeline and no claims from its source. */
interface StackTiming {
    light?: Claim
    selection?: Claim
    marks: Map<number, Claim & { ease: Ease }>
    stateReads: Map<number, Claim>
    opens: Map<number, Claim>
    reveals: Map<number, Claim>
    hiddenPasses: Map<number, Claim>
}
const stackTimings = new WeakMap<LayerStack, StackTiming>()

function timingOf(stack: LayerStack): StackTiming {
    let timing = stackTimings.get(stack)
    if (!timing) {
        timing = { marks: new Map(), stateReads: new Map(), opens: new Map(), reveals: new Map(), hiddenPasses: new Map() }
        stackTimings.set(stack, timing)
    }
    return timing
}

/** A light may interrupt another light. A pass through a branch needs its reveal to finish first. */
function checkTime(call: string, start: number, previous: Claim | null | undefined, boundary: 't0' | 't1', part: string): void {
    if (!previous || start >= previous[boundary]) return
    const limit = boundary === 't0' ? 'starts' : 'ends'
    throw new Error(`layerStack: ${call} at ${seconds(start)} needs ${part} before ${previous.call} ${limit} at ${seconds(previous[boundary])}. Schedule the calls in timeline order, or play them one after the other in a \`seq\``)
}

interface Look {
    paint: Paint
    line: number
    fill: number
    label: ColorInput
    dash: boolean
    mark: StackMark | null
}

const MARKS: readonly StackMark[] = ['lock', 'check', 'cross', 'dot']
// The opacity of the fill of a block. An ink label reads on it in a dark look and in a light one.
const FILL = 0.16
// The opacity of the line and of the fill of a block in a state that is `dim`.
const DIM_LINE = 0.45
const DIM_FILL = 0.06
// The most that a pulse adds to the fill of a block while the data is in it.
const PULSE = 0.4
// The opacity of the fill of a cell of the vector, from a value of 0 to a value of 1 or more. With numbers,
// the fill stays under a half, so a number in ink reads on it in every look.
const CELL = [0.14, 0.95] as const
const CELL_NUMBERED = [0.1, 0.5] as const
// Seconds for the vector to pass one block on the stream, and one branch with its add.
const BLOCK_TIME = 1
const BRANCH_TIME = 2.6
// Two times nearer than this are one time: the end of one animation is the start of the next.
const SOON = 1e-9

/** A value as the film wrote it, for an error. */
function shown(value: unknown): string {
    if (typeof value === 'string') return JSON.stringify(value)
    if (typeof value !== 'object' || value === null) return String(value)
    if (value instanceof Node) return 'a node'
    try {
        return JSON.stringify(value)
    } catch {
        // A value that holds itself has no text.
        return 'an object'
    }
}
const seconds = (time: number) => `${Math.round(time * 100) / 100} s`
const clamp = (value: number) => (value <= 0 ? 0 : value >= 1 ? 1 : value)
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The mark of a state, in a square of a side around the origin. */
function markOf(kind: StackMark, side: number): Node {
    const made = new Node(), weight = Math.max(2, side * 0.14), at = (value: number) => Math.round(value * side * 100) / 100
    if (kind === 'lock') {
        made.add(
            new Node(parseSvgPath(`M${at(-0.2)} ${at(-0.02)}V${at(-0.2)}A${at(0.2)} ${at(0.2)} 0 0 1 ${at(0.2)} ${at(-0.2)}V${at(-0.02)}`)).stroke('dim', weight),
            new Node(rectPath(at(-0.34), at(-0.04), at(0.68), at(0.48), at(0.08))).fill('dim'),
        )
    } else if (kind === 'check') {
        made.add(new Node(polyPath([[at(-0.34), at(0.02)], [at(-0.1), at(0.26)], [at(0.36), at(-0.26)]])).stroke('dim', weight))
    } else if (kind === 'cross') {
        made.add(new Node(linePath([at(-0.28), at(-0.28)], [at(0.28), at(0.28)])).stroke('dim', weight), new Node(linePath([at(-0.28), at(0.28)], [at(0.28), at(-0.28)])).stroke('dim', weight))
    } else {
        made.add(new Node(circlePath(0, 0, at(0.22))).fill('dim'))
    }
    return made
}

/**
 * A model as a stack of named layers on one stream, with the data flowing up: the block diagram of a
 * transformer, of a vision model, or of a residual network. A block on the stream changes the data. A branch
 * is beside the stream: it reads the stream, and an add puts its result back, so the stream is the line
 * that every layer adds to. A group puts layers in one frame, for a block that repeats.
 *
 * `feed()` puts a vector at the foot of the stream, and `pass()` sends it through a layer, where it changes.
 * `light()` lights the block that a scene is about, `mark()` changes the state of blocks, such as frozen,
 * `replace()` swaps a block for another, `show()` brings in a branch that had its place, and `open()` joins
 * a block to a close-up of its inside. `.at()` places the middle of the object.
 */
export class LayerStack extends Node {
    /** One node per block, with its box, its label and its marks. The blocks count from the foot of the stream up, and a branch counts from its first block. */
    readonly blocks: Node[] = []
    /** The box of each block. */
    readonly boxes: Node[] = []
    /** The label of each block. `replace()` puts the new label here. */
    readonly labels: Node[] = []
    /** The line of the stream, from its foot to its head, and the arrow head at its top. */
    readonly stream: Node
    /** The add of each branch: a ring with a plus, on the stream. */
    readonly adds: Node[] = []
    /** The point of each branch where it leaves the stream. */
    readonly taps: Node[] = []
    /** The line of each branch from the stream into its first block, and from its last block to its add. */
    readonly reads: Node[] = []
    readonly writes: Node[] = []
    /** The lines between two blocks of a branch. */
    readonly chains: Node[] = []
    /** The frame of each group, with its label. */
    readonly frames: Node[] = []
    /** The vector on the stream. It does not show before `feed()`. Its parts are a plate, one node for each cell, and the holder of the numbers. */
    readonly vector: Node
    /** The copy of the vector that goes through a branch, with the same parts. It shows only while the vector passes a branch. */
    readonly copy: Node
    /** The shape beside the vector, or null for a stack with no shape. */
    readonly tag: Node | null
    /** The lines from an open block to its close-up, and the frame around the close-up. */
    readonly zoom: Node
    /** All of each block but its backing: the box, the label and the marks. */
    private readonly bodies: Node[] = []
    /** The fill of each block that lights for a moment while the data is in it. */
    private readonly washes: Node[] = []
    /** The thick border of each block, which shows while the block is lit. */
    private readonly halos: Node[] = []
    /** The mark of each block in each state, block by block. Null for a state with no mark. */
    private readonly icons: (Node | null)[] = []
    private readonly vectorCells: Node[] = []
    private readonly copyCells: Node[] = []
    /** The holders of the numbers of the vector and of the copy, and the numbers that show now, when the stack has `digits`. */
    private readonly vectorDigits: Node
    private readonly copyDigits: Node
    private vectorNumbers: Node[] = []
    private copyNumbers: Node[] = []
    /** One text for each shape, at the place of the tag. */
    private readonly tagTexts: Node[] = []
    private readonly plans: readonly BlockPlan[]
    private readonly layers: readonly LayerPlan[]
    /** The y of the bottom line of the frame of each group. */
    private readonly frameFeet: number[] = []
    /** The y where the vector rests: at the foot, and after each layer. */
    private readonly stops: readonly number[]
    private readonly streamX: number
    private readonly footY: number
    private readonly headY: number
    private readonly size: number
    private readonly blockHeight: number
    private readonly font: TextOptions['font']
    private readonly stateNames: readonly string[]
    private readonly looks: ReadonlyMap<string, StackState>
    private readonly shapes: readonly string[]
    /** The shape at the foot of the stream, as a place in the list of shapes, or -1 when the film gave none. */
    private readonly startShape: number
    private readonly cellCount: number
    private readonly digits: number | null
    private readonly cellWidth: number
    /** With `digits`, a number that is as wide as a cell has room for. */
    private readonly widest: string
    private readonly cellHeight: number
    /** The height of the vector, and the least room between two layers that holds it. */
    private readonly vectorHeight: number
    private readonly leastGap: number
    private readonly gap: number
    /** The room of a label in each block. */
    private readonly rooms: readonly number[]
    /** The width at which every label fits. */
    private readonly tight: number
    /** The left and the right edge of what the stack draws, without the shapes. */
    private readonly drawn: readonly [number, number]
    private readonly ringRadius: number
    /**
     * The bookkeeping. A change replaces a list and never edits it, so a copy of the stack keeps the state
     * that it was made with. The animations change it when they are scheduled, so two changes in one
     * sequence chain.
     */
    private names: readonly string[]
    private paints: readonly Paint[]
    private states: readonly string[]
    /** For each layer: false for a branch that waits for `show()`. */
    private showing: readonly boolean[]
    private lit: number | null = null
    /** The number of layers that the vector passed, or null with no vector. */
    private where: number | null = null
    private now: readonly number[] | null = null
    private shapeNow = -1
    private openAt: number | null = null
    private inside: readonly Node[] = []
    private vectorBusy: Claim | null = null
    private zoomBusy: Claim | null = null
    private replacing: readonly (Claim | null)[]

    constructor(layers: readonly StackLayer[], options: LayerStackOptions = {}) {
        super()
        if (!Array.isArray(layers) || layers.length === 0) throw new Error("layerStack: give it at least one layer, such as ['embed', { branch: ['attention'] }, 'unembed']")
        if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new Error('layerStack: give the options as an object, such as { size: 28 }')
        const size = this.size = options.size ?? 28
        if (!(Number.isFinite(size) && size > 0)) throw new Error('layerStack: size is a text size, more than 0')
        const font = this.font = options.font ?? filmFont() ?? 'sans'
        const cells = this.cellCount = options.cells ?? 4
        if (!Number.isInteger(cells) || cells < 1 || cells > 16) throw new Error(`layerStack: cells is ${shown(options.cells)}. Give the number of cells of the vector, a whole number from 1 to 16`)
        const digits = this.digits = options.digits ?? null
        if (digits !== null && (!Number.isInteger(digits) || digits < 0 || digits > 3)) throw new Error(`layerStack: digits is ${shown(options.digits)}. Give the number of decimals of a value in a cell, a whole number from 0 to 3`)
        const states: Record<string, StackState> = options.states ?? STACK_STATES
        if (!isObject(states)) throw new Error('layerStack: give states as a record of names and their looks, such as { live: {}, frozen: { dim: true } }')
        this.stateNames = Object.keys(states)
        if (this.stateNames.length === 0) throw new Error('layerStack: give it at least one state')
        for (const name of this.stateNames) {
            const state = states[name]!
            if (state === null || typeof state !== 'object' || Array.isArray(state)) throw new Error(`layerStack: give the state ${shown(name)} a look, such as { dim: true }`)
            if (state.mark !== undefined && !MARKS.includes(state.mark)) throw new Error(`layerStack: the mark of the state ${shown(name)} is ${shown(state.mark)}. A mark is ${MARKS.map((mark) => `'${mark}'`).join(', ')}`)
            if (state.color !== undefined) this.paintOf(state.color, `the color of the state ${shown(name)}`)
        }
        this.looks = new Map(Object.entries(states))
        const base = this.paintOf(options.color ?? 'blue', 'color')
        const backing = this.paintOf(options.backing ?? 'bg', 'backing')
        const wide = (content: string) => text(content, { size, font }).get('px') * 2

        // Read the layers before anything is drawn, so that a wrong layer is named and not a wrong place.
        const specs: { label: string; id: string; paint: Paint; state: string; shape: string | undefined; role: Role; layer: number }[] = []
        const layerSpecs: { branch: boolean; blocks: number[]; around: number; group: number; shown: boolean }[] = []
        const groupSpecs: { text: string | null }[] = []
        const blockOf = (value: unknown, where: string, role: Role, layer: number): number => {
            const spec = typeof value === 'string' ? { label: value } : value
            if (!isObject(spec) || typeof spec['label'] !== 'string') throw new Error(`layerStack: ${where} is ${shown(value)}. A block is a label, or { label, id, color, state, shape }`)
            const label = spec['label'].trim()
            if (label === '') throw new Error(`layerStack: ${where} has no label. Give each block a label`)
            if (/[\n\r\t]/.test(label)) throw new Error(`layerStack: the label of ${where} (${shown(label)}) has a line break or a tab. A label is one line`)
            const id = spec['id'] === undefined ? label : spec['id']
            if (typeof id !== 'string' || id.trim() === '') throw new Error(`layerStack: the id of ${where} (${shown(label)}) is ${shown(id)}. An id is a text, such as 'norm 2'`)
            const state = spec['state'] === undefined ? this.stateNames[0]! : spec['state']
            if (typeof state !== 'string' || !this.looks.has(state)) throw new Error(`layerStack: ${where} (${shown(label)}) has the state ${shown(state)}. The states are ${this.stateNames.join(', ')}`)
            const shape = spec['shape']
            if (shape !== undefined) {
                if (typeof shape !== 'string' || shape.trim() === '' || /[\n\r\t]/.test(shape)) throw new Error(`layerStack: the shape of ${where} (${shown(label)}) is ${shown(shape)}. A shape is one line of text, such as '(T, 768)'`)
                // An add needs two values of one shape, so the stream has the same shape before a branch and after it.
                if (role !== 'stream') throw new Error(`layerStack: ${where} (${shown(label)}) has a shape, and it is ${role === 'side' ? 'in a branch' : 'beside a branch'}. The add of a branch keeps the shape of the stream. Give the shape to a block on the stream`)
            }
            specs.push({ label, id: id.trim(), paint: spec['color'] === undefined ? base : this.paintOf(spec['color'] as ColorInput, `the color of ${where} (${shown(label)})`), state, shape: shape === undefined ? undefined : (shape as string).trim(), role, layer })
            return specs.length - 1
        }
        const layerOf = (value: unknown, where: string, group: number): void => {
            const layer = layerSpecs.length
            if (isObject(value) && 'branch' in value) {
                const list = value['branch']
                if (!Array.isArray(list) || list.length === 0) throw new Error(`layerStack: ${where} has the branch ${shown(list)}. A branch is a list of one block or more, such as { branch: ['norm', 'attention'] }`)
                const around = value['around'] === undefined ? -1 : blockOf(value['around'], `the block that ${where} goes around`, 'around', layer)
                if (value['shown'] !== undefined && typeof value['shown'] !== 'boolean') throw new Error(`layerStack: set shown to true or false for ${where}`)
                const blocks = Array.from(list, (item, index) => blockOf(item, `block ${index} of ${where}`, 'side', layer))
                layerSpecs.push({ branch: true, blocks, around, group, shown: value['shown'] !== false })
                return
            }
            if (isObject(value) && 'layers' in value) throw new Error(`layerStack: ${where} is a group inside a group. A group holds blocks and branches. Give the two groups one after the other`)
            layerSpecs.push({ branch: false, blocks: [blockOf(value, where, 'stream', layer)], around: -1, group, shown: true })
        }
        Array.from(layers).forEach((value, index) => {
            if (!(isObject(value) && 'layers' in value)) return layerOf(value, `layer ${index}`, -1)
            const list = value['layers'], repeat = value['repeat'], label = value['label']
            if (!Array.isArray(list) || list.length === 0) throw new Error(`layerStack: layer ${index} is a group with no layers. Give it a list, such as { repeat: 12, layers: [{ branch: ['attention'] }, { branch: ['MLP'] }] }`)
            if (repeat !== undefined && !(typeof repeat === 'string' ? repeat.trim() !== '' && !/[\n\r\t]/.test(repeat) : Number.isInteger(repeat) && (repeat as number) >= 2)) throw new Error(`layerStack: the repeat of layer ${index} is ${shown(repeat)}. Give a count, 2 or more, or a name such as 'N'`)
            if (label !== undefined && (typeof label !== 'string' || /[\n\r\t]/.test(label))) throw new Error(`layerStack: the label of the group of layer ${index} is ${shown(label)}. A label is one line of text`)
            const name = typeof label === 'string' && label.trim() !== '' ? label.trim() : null, times = repeat === undefined ? null : `× ${typeof repeat === 'string' ? repeat.trim() : repeat}`
            groupSpecs.push({ text: name && times ? `${name} ${times}` : name ?? times })
            Array.from(list).forEach((item, at) => layerOf(item, `layer ${at} of the group of layer ${index}`, groupSpecs.length - 1))
        })
        const named = (index: number) => `block ${index} (${shown(specs[index]!.label)})`
        if (options.shape !== undefined && (typeof options.shape !== 'string' || options.shape.trim() === '' || /[\n\r\t]/.test(options.shape))) throw new Error(`layerStack: shape is ${shown(options.shape)}. It is the shape of the data at the foot of the stream, one line of text, such as '(T)'`)
        const shapes: string[] = []
        const shapeAt = (shape: string | undefined): number => {
            if (shape === undefined) return -1
            if (!shapes.includes(shape)) shapes.push(shape)
            return shapes.indexOf(shape)
        }
        this.startShape = shapeAt(options.shape?.trim())
        const shapeOf = specs.map((spec) => shapeAt(spec.shape))
        this.shapes = shapes

        // The sizes. Each one follows the text size, so a stack of another size has the same picture.
        const height = this.blockHeight = options.blockHeight ?? Math.round(size * 1.9)
        const line = Math.max(2, size * 0.075), haloLine = Math.max(4, size * 0.16)
        // A label is in the middle of its block. The block holds the highest and the lowest letters of the
        // font and the wide border of a lit block. The letters are measured, so the limit is right for each font.
        const letters = text('\u00c1fjy(', { size, font }).bounds()
        const leastHeight = Math.ceil(2 * (Math.max(-letters.y, letters.y + letters.height) + haloLine / 2 + size * 0.08))
        if (!(Number.isFinite(height) && height >= leastHeight)) throw new Error(`layerStack: a blockHeight of ${shown(height)} has no room for a label of size ${size}: a letter with a tail would touch the border. Give a blockHeight of ${leastHeight} or more`)
        const corner = Math.min(height * 0.2, size * 0.4)
        const marked = this.stateNames.some((name) => states[name]!.mark !== undefined)
        const iconSide = Math.round(size * 0.62), edge = size * 0.7
        // A mark has its room at the right end of a block. The label keeps the same room at the left, so it stays in the middle.
        const beside = edge + (marked ? iconSide + size * 0.3 : 0)
        const stroke = Math.max(4, Math.round(size * 0.2)), wire = Math.max(2, size * 0.09)
        const link = Math.round(size * 0.6), ring = this.ringRadius = Math.round(size * 0.45), tip = Math.round(size * 0.36)
        const cellGap = Math.max(2, Math.round(size * 0.1))
        this.cellHeight = digits === null ? Math.round(size * 0.7) : Math.round(size * 1.5)
        // With numbers, a cell holds a value under 10 with its sign, such as -8.8, and a little room at its two sides.
        this.widest = digits === null ? '' : `-8${digits > 0 ? `.${'8'.repeat(digits)}` : ''}`
        this.cellWidth = digits === null ? this.cellHeight : Math.ceil(wide(this.widest) + size * 0.5)
        const vectorWidth = cells * this.cellWidth + (cells + 1) * cellGap
        this.vectorHeight = this.cellHeight + 2 * cellGap
        // A line of a branch is this far from the blocks of the branch, so that the copy of the vector on the line is clear of them.
        const rise = Math.max(Math.round(size * 0.75), Math.ceil(this.vectorHeight / 2) + Math.round(size * 0.2))
        this.leastGap = this.vectorHeight + 2 * Math.round(size * 0.2)
        const gap = this.gap = options.gap ?? this.vectorHeight + 2 * Math.round(size * 0.4)
        if (!(Number.isFinite(gap) && gap >= 0)) throw new Error('layerStack: gap is the room on the stream between two layers, 0 or more')

        // The widths. A stack with a branch has the stream at the left, in a free way that is as wide as the
        // vector, and the blocks of the branches at the right. A block on the stream is as wide as both. A
        // stack with no branch has its blocks around the stream.
        const branched = layerSpecs.some((layer) => layer.branch), grouped = groupSpecs.length > 0
        const sidePad = grouped ? Math.round(size * 0.6) : 0
        const shapeRoom = shapes.length > 0 ? Math.ceil(Math.max(...shapes.map(wide)) + size * 0.6) : 0
        const longestOf = (role: Role) => specs.filter((spec) => spec.role === role).reduce<string | null>((best, spec) => (best === null || wide(spec.label) > wide(best) ? spec.label : best), null)
        const need = (role: Role) => { const label = longestOf(role); return label === null ? 0 : wide(label) + 2 * beside }
        // A block hides the vector while the vector is in it, so no block is narrower than the vector.
        const cover = vectorWidth + Math.round(size * 0.5)
        const inset = Math.round(size * 0.5)
        const way = branched ? Math.max(Math.ceil(vectorWidth / 2) + Math.round(size * 0.7), specs.some((spec) => spec.role === 'around') ? Math.ceil(need('around') / 2) + inset : 0) : 0
        // The least width of the blocks of the branches, or of all the blocks in a stack with no branch. A block
        // on the stream of a stack with a branch is wider, by the way of the vector at its two sides.
        const streamNeed = need('stream') - 2 * way, sideNeed = branched ? need('side') : 0
        const tightBlocks = Math.ceil(Math.max(sideNeed, streamNeed, cover))
        const tight = this.tight = shapeRoom + 2 * sidePad + 2 * way + tightBlocks
        if (options.width !== undefined) {
            if (!(Number.isFinite(options.width) && options.width > 0)) throw new Error('layerStack: width is the width of the whole object, more than 0')
            if (options.width < tight - 0.5) {
                // Name what sets the least width: the longest label of the blocks that are the narrowest for their labels, or the vector.
                const label = cover >= Math.max(sideNeed, streamNeed) ? null : longestOf(sideNeed >= streamNeed ? 'side' : 'stream')
                const what = label === null ? `the vector of ${cells} cells, which is ${vectorWidth} px wide and must fit behind a block` : `the label ${shown(label)}, which is ${Math.ceil(wide(label))} px wide at size ${size}`
                throw new Error(`layerStack: a width of ${options.width} has no room for ${what}. Give a width of ${tight} or more, ${label === null ? 'fewer cells' : 'shorter labels'}, or a smaller size`)
            }
        }
        // Without a width, a block is not narrower than 7.5 text sizes, so a stack of short names is not a thin pole.
        const blocksWide = options.width !== undefined ? Math.floor(options.width - shapeRoom - 2 * sidePad - 2 * way) : Math.max(tightBlocks, Math.round(size * 7.5))
        const left = -(shapeRoom + sidePad + way), right = left + shapeRoom + 2 * sidePad + 2 * way + blocksWide
        // In a stack with no branch, the stream is in the middle of the blocks.
        const streamAt = branched ? 0 : (blocksWide - 2 * way) / 2 + way

        // The heights, from the foot of the stream up. Between two layers the stream is free for the length
        // of `gap`: the vector rests there. The frame of a group is around its layers, and the vector rests
        // outside it, so the border never passes through the vector.
        const padUnder = Math.round(size * 0.6), tapPad = Math.round(size * 0.2), headTip = Math.round(stroke * 2.6)
        // A short piece of the stream shows under the vector at the foot, and over it at the head.
        const stub = Math.round(size * 0.2)
        const padOver = (group: number) => (groupSpecs[group]!.text ? Math.round(size * 0.9) : padUnder)
        let up = stub
        const stopsUp: number[] = [], spans: [number, number][] = groupSpecs.map(() => [0, 0])
        const placed: { x: number; up: number; width: number }[] = specs.map(() => ({ x: 0, up: 0, width: 0 }))
        const levels: { tap: number; plus: number }[] = []
        let within = -1
        layerSpecs.forEach((layer) => {
            if (within >= 0 && layer.group !== within) {
                up += padOver(within)
                spans[within]![1] = up
                within = -1
            }
            stopsUp.push(up + gap / 2)
            up += gap
            if (layer.group >= 0 && within < 0) {
                spans[layer.group]![0] = up
                up += padUnder
                within = layer.group
            }
            if (!layer.branch) {
                placed[layer.blocks[0]!] = { x: branched ? way + (blocksWide - 2 * way) / 2 : streamAt, up: up + height / 2, width: branched ? blocksWide + 2 * way : blocksWide }
                levels.push({ tap: 0, plus: 0 })
                up += height
                return
            }
            const tap = up + tapPad
            layer.blocks.forEach((block, index) => {
                placed[block] = { x: way + blocksWide / 2, up: tap + rise + index * (height + link) + height / 2, width: blocksWide }
            })
            const plus = tap + 2 * rise + layer.blocks.length * height + (layer.blocks.length - 1) * link
            // A block on the stream beside a branch is at the middle height of the blocks of the branch.
            if (layer.around >= 0) placed[layer.around] = { x: 0, up: (tap + plus) / 2, width: 2 * (way - inset) }
            levels.push({ tap, plus })
            up = plus + ring
        })
        if (within >= 0) {
            up += padOver(within)
            spans[within]![1] = up
        }
        stopsUp.push(up + gap / 2)
        up += gap + stub + headTip
        // The middle of the object is on whole pixels, so the edges of the blocks are sharp.
        const middleX = Math.round((left + right) / 2), middleY = Math.round(up / 2)
        const x = (value: number) => value - middleX, y = (value: number) => middleY - value
        this.streamX = x(streamAt)
        this.footY = y(0)
        this.headY = y(up)
        this.stops = stopsUp.map(y)
        this.drawn = [x(left + shapeRoom), x(right)]
        this.layoutBox = [x(left), y(up), x(right), y(0)]

        // The frames of the groups are under all the rest.
        groupSpecs.forEach((group, index) => {
            const frame = new Node(), [from, to] = spans[index]!
            const x0 = x(left + shapeRoom), x1 = x(right), y0 = y(to), y1 = y(from), radius = Math.round(size * 0.55), weight = Math.max(1.5, size * 0.07)
            if (group.text === null) {
                frame.add(new Node(rectPath(x0, y0, x1 - x0, y1 - y0, radius)).stroke('faint', weight))
            } else {
                // The label is on the top line of the frame, at its right end, and the line has a gap for it. It
                // ends over the right edge of the blocks, so a line from a block to its close-up starts after it.
                const label = text(group.text, { size, font, color: 'dim', anchor: 'right' })
                const width = label.get('px'), end = x1 - sidePad - Math.round(size * 0.9), room = size * 0.4
                if (width + 2 * room > end - x0 - radius) throw new Error(`layerStack: the label ${shown(group.text)} of a group is ${Math.ceil(width)} px wide, and the top line of its frame has ${Math.max(0, Math.floor(end - x0 - radius - 2 * room))} px for it. Use a shorter label, or a wider stack`)
                frame.add(
                    new Node(parseSvgPath(`M${end + room} ${y0}H${x1 - radius}A${radius} ${radius} 0 0 1 ${x1} ${y0 + radius}V${y1 - radius}A${radius} ${radius} 0 0 1 ${x1 - radius} ${y1}`
                        + `H${x0 + radius}A${radius} ${radius} 0 0 1 ${x0} ${y1 - radius}V${y0 + radius}A${radius} ${radius} 0 0 1 ${x0 + radius} ${y0}H${end - width - room}`)).stroke('faint', weight),
                    label.at(end, y0),
                )
            }
            this.frames.push(frame)
            this.frameFeet.push(y1)
            this.add(frame)
        })

        // The stream is one line from its foot to its head. A block and an add are drawn over it, with the
        // color of the backing under them, so the line shows only where the stream is free.
        const lineOfStream = new Node(linePath([this.streamX, this.footY], [this.streamX, this.headY + headTip])).stroke('ink', stroke)
        lineOfStream.set('cap', 'butt')
        const half = Math.round(stroke * 1.5)
        this.stream = new Node().add(lineOfStream, new Node(polyPath([[this.streamX, this.headY], [this.streamX - half, this.headY + headTip], [this.streamX + half, this.headY + headTip]], true)).fill('ink'))
        this.add(this.stream)

        // The lines of the branches. A line ends in a small arrow head, at the block or the add that it goes into.
        const headOf = (tipX: number, tipY: number, dx: number, dy: number): Node =>
            new Node(polyPath([[tipX, tipY], [tipX - dx * tip - dy * tip * 0.42, tipY - dy * tip - dx * tip * 0.42], [tipX - dx * tip + dy * tip * 0.42, tipY - dy * tip + dx * tip * 0.42]], true)).fill('dim')
        const wireOf = (path: Path, head: Node): Node => {
            const drawnLine = new Node(path).stroke('dim', wire)
            drawnLine.set('cap', 'butt')
            return new Node().add(drawnLine, head)
        }
        const plans: BlockPlan[] = specs.map((spec, index) => ({ id: spec.id, layer: spec.layer, role: spec.role, x: x(placed[index]!.x), y: y(placed[index]!.up), width: placed[index]!.width, shape: shapeOf[index]! }))
        const wires = new Node(), points = new Node(), rings = new Node()
        const layerPlans: LayerPlan[] = layerSpecs.map((layer, index) => {
            const empty: LayerPlan = { branch: false, blocks: layer.blocks, around: -1, group: layer.group, tapY: 0, plusY: 0, part: -1, chains: [], readWay: [], writeWay: [] }
            if (!layer.branch) return empty
            const tapY = y(levels[index]!.tap), plusY = y(levels[index]!.plus), sx = this.streamX, bx = plans[layer.blocks[0]!]!.x
            const first = plans[layer.blocks[0]!]!, last = plans[layer.blocks[layer.blocks.length - 1]!]!
            const bottom = first.y + height / 2, top = last.y - height / 2
            // The corner of a line is round. Its radius leaves a straight piece before the arrow head.
            const bend = Math.max(2, Math.min(Math.round(size * 0.45), rise - tip - 2))
            const read = wireOf(parseSvgPath(`M${sx} ${tapY}H${bx - bend}Q${bx} ${tapY} ${bx} ${tapY - bend}V${bottom + tip}`), headOf(bx, bottom, 0, -1))
            const write = wireOf(parseSvgPath(`M${bx} ${top}V${plusY + bend}Q${bx} ${plusY} ${bx - bend} ${plusY}H${sx + ring + tip}`), headOf(sx + ring, plusY, -1, 0))
            const chains: number[] = []
            for (let k = 1; k < layer.blocks.length; k++) {
                const lower = plans[layer.blocks[k - 1]!]!, upper = plans[layer.blocks[k]!]!
                chains.push(this.chains.length)
                this.chains.push(wireOf(linePath([bx, lower.y - height / 2], [bx, upper.y + height / 2 + tip]), headOf(bx, upper.y + height / 2, 0, -1)))
            }
            const tap = new Node(circlePath(sx, tapY, Math.round(stroke * 0.95))).fill('ink')
            // The add is a ring with a plus. Its fill hides the stream under it.
            const arm = ring * 0.5
            const add = new Node().add(
                new Node(circlePath(0, 0, ring)).fill(backing).stroke('ink', Math.max(2, size * 0.1)),
                new Node(linePath([-arm, 0], [arm, 0])).stroke('ink', Math.max(2, size * 0.1)),
                new Node(linePath([0, -arm], [0, arm])).stroke('ink', Math.max(2, size * 0.1)),
            ).at(sx, plusY)
            const part = this.adds.length
            this.reads.push(read)
            this.writes.push(write)
            this.taps.push(tap)
            this.adds.push(add)
            const parts = [read, write, tap, add, ...chains.map((at) => this.chains[at]!)]
            if (!layer.shown) for (const each of parts) each.base.visible = false
            wires.add(read, write, ...chains.map((at) => this.chains[at]!))
            points.add(tap)
            rings.add(add)
            return {
                branch: true, blocks: layer.blocks, around: layer.around, group: layer.group, tapY, plusY, part, chains,
                // The copy of the vector goes from the stream to the middle of the first block, where the block
                // hides it, and from the middle of the last block to the ring of the add.
                readWay: parseSvgPath(`M${sx} ${tapY}H${bx - bend}Q${bx} ${tapY} ${bx} ${tapY - bend}V${first.y}`),
                writeWay: parseSvgPath(`M${bx} ${last.y}V${plusY + bend}Q${bx} ${plusY} ${bx - bend} ${plusY}H${sx + ring + vectorWidth / 2}`),
            }
        })
        this.plans = plans
        this.layers = layerPlans

        // The vector and its copy are under the blocks: a block hides the vector that is in it.
        const vectorOf = (into: Node[]): Node => {
            const made = new Node()
            made.add(new Node(rectPath(-vectorWidth / 2, -this.vectorHeight / 2, vectorWidth, this.vectorHeight, Math.min(6, size * 0.2))).fill(backing).stroke('dim', Math.max(1.5, size * 0.055)))
            for (let k = 0; k < cells; k++) {
                const cell = rect(this.cellWidth, this.cellHeight, { radius: Math.min(4, size * 0.12), fill: 'dim', stroke: null }).at(-vectorWidth / 2 + cellGap + this.cellWidth / 2 + k * (this.cellWidth + cellGap), 0)
                cell.set('fillOpacity', this.cellLook(0).fill)
                into.push(cell)
                made.add(cell)
            }
            // The numbers of the cells are in one holder, which is the last part: they fade as one.
            made.add(new Node())
            made.base.visible = false
            return made
        }
        // The copy is under the adds too: an add takes the copy, and its ring shows while it does.
        this.copy = vectorOf(this.copyCells)
        this.vector = vectorOf(this.vectorCells).at(this.streamX, this.stops[0]!)
        this.copyDigits = this.copy.children[cells + 1]!
        this.vectorDigits = this.vector.children[cells + 1]!
        this.add(wires, points, this.copy, rings, this.vector)

        const rooms: number[] = []
        specs.forEach((spec, index) => {
            const plan = plans[index]!, look = this.lookOf(spec.state, spec.paint)
            const shape = () => rectPath(-plan.width / 2, -height / 2, plan.width, height, corner)
            const box = new Node(shape()).fill(look.paint, look.fill).stroke(look.paint, line, look.line)
            // The ends of a dash are flat, because a round end makes a dash longer than its pattern says.
            box.set('cap', 'butt')
            if (look.dash) box.set('dash', this.dashes())
            const wash = new Node(shape()).fill(look.paint)
            wash.set('opacity', 0)
            const halo = new Node(shape()).fill(look.paint, FILL).stroke(look.paint, haloLine)
            halo.set('opacity', 0)
            const label = text(spec.label, { size, font, color: look.label })
            // The backing is apart from the rest. It shows while the rest fades in, so the stream never shows through a label.
            const body = new Node().add(box, wash, halo, label)
            const block = new Node().add(new Node(shape()).fill(backing), body).at(plan.x, plan.y)
            block.layoutBox = [-plan.width / 2, -height / 2, plan.width / 2, height / 2]
            for (const name of this.stateNames) {
                const kind = states[name]!.mark
                const icon = kind === undefined ? null : markOf(kind, iconSide).at(plan.width / 2 - edge - iconSide / 2, 0)
                if (icon) {
                    if (name !== spec.state) icon.base.visible = false
                    body.add(icon)
                }
                this.icons.push(icon)
            }
            if (spec.role === 'side' && !layerSpecs[spec.layer]!.shown) block.base.visible = false
            rooms.push(plan.width - 2 * beside)
            this.blocks.push(block)
            this.bodies.push(body)
            this.boxes.push(box)
            this.washes.push(wash)
            this.halos.push(halo)
            this.labels.push(label)
            this.add(block)
        })
        this.rooms = rooms
        // The widths above give each label its room. This stays as a guard for a change of them.
        specs.forEach((spec, index) => {
            if (wide(spec.label) > rooms[index]! + 0.5) throw new Error(`layerStack: the label of ${named(index)} is ${Math.ceil(wide(spec.label))} px wide at size ${size}, and its block has ${Math.max(0, Math.floor(rooms[index]!))} px for it. Give a width of ${tight} or more, shorter labels, or a smaller size`)
        })

        // The shape is beside the vector, outside the frames, and goes up with it. So no block is ever behind it.
        this.tag = null
        if (shapes.length > 0) {
            this.tag = new Node().at(x(left + shapeRoom - size * 0.6), this.stops[0]!)
            for (const shape of shapes) {
                const made = text(shape, { size, font, color: 'dim', anchor: 'right' })
                made.base.visible = false
                this.tagTexts.push(made)
                this.tag.add(made)
            }
            this.tag.base.visible = false
            this.add(this.tag)
        }

        // The lines to a close-up are over all the rest. A film puts them around its own picture on purpose, so
        // the film check does not judge the text of that picture against them.
        this.zoom = new Node().add(new Node([]).fill(base, 0.1), new Node([]).stroke(base, Math.max(1.5, size * 0.07), 0.7), new Node([]).stroke(base, Math.max(1.5, size * 0.07), 0.7), new Node([]).stroke(base, line))
        this.zoom.data['decoration'] = true
        this.zoom.base.visible = false
        this.add(this.zoom)

        this.names = specs.map((spec) => spec.label)
        this.paints = specs.map((spec) => spec.paint)
        this.states = specs.map((spec) => spec.state)
        this.showing = layerSpecs.map((layer) => layer.shown)
        this.replacing = specs.map(() => null)
        // The stack places each label in its block, the label of a group on its frame, and the shape beside the
        // vector. The film check does not judge that room.
        ownLabels(this, { name: 'layer stack' })
    }

    /** A copy keeps the stack state, but starts a new timeline. A close-up uses film nodes outside the stack, so the copy starts closed and leaves those nodes to the original stack. */
    protected override [rebindCloneParts](copy: this): void {
        copy.openAt = null
        copy.inside = []
        copy.zoom.base.visible = false
        copy.vectorBusy = null
        copy.zoomBusy = null
        copy.replacing = this.replacing.map(() => null)
    }

    /** The number of blocks. */
    get count(): number {
        return this.plans.length
    }

    /** The ids of the blocks, from the foot of the stream up. A branch counts from its first block. */
    get ids(): string[] {
        return this.plans.map((plan) => plan.id)
    }

    /** The number of layers on the stream. A branch is one layer, with all its blocks. */
    get depth(): number {
        return this.layers.length
    }

    /** The index of the lit block after the changes that are scheduled so far, or null when no block is lit. */
    get current(): number | null {
        return this.lit
    }

    /** The number of layers that the vector passed, after the changes that are scheduled so far: 0 at the foot of the stream. Null with no vector. */
    get passed(): number | null {
        return this.where
    }

    /** The values of the vector after the changes that are scheduled so far, or null with no vector. */
    get values(): number[] | null {
        return this.now === null ? null : [...this.now]
    }

    /** The shape beside the vector after the changes that are scheduled so far, or null. */
    get shape(): string | null {
        return this.where === null || this.shapeNow < 0 ? null : this.shapes[this.shapeNow]!
    }

    /** The index of the block that is open after the changes that are scheduled so far, or null. */
    get opened(): number | null {
        return this.openAt
    }

    /** The node of a block, by its id or its index: its box, its label and its marks. For `beside(note, stack, 'right', 'wide', stack.block('MLP'))`. */
    block(ref: StackBlockRef): Node {
        return this.blocks[this.index(ref)]!
    }

    /** The state of a block after the changes that are scheduled so far. */
    stateOf(ref: StackBlockRef): string {
        return this.states[this.index(ref)]!
    }

    /** The label of a block after the changes that are scheduled so far. */
    labelOf(ref: StackBlockRef): string {
        return this.names[this.index(ref)]!
    }

    /** The place of the layer of a block on the stream, 0 for the first one. The blocks of a branch have one layer. */
    layerOf(ref: StackBlockRef): number {
        return this.plans[this.index(ref)]!.layer
    }

    /**
     * The indexes of the blocks that a function picks, after the changes that are scheduled so far:
     * `stack.find((block) => block.state === 'frozen')`.
     */
    find(test: (block: StackBlockInfo) => boolean): number[] {
        if (typeof test !== 'function') throw new Error(`layerStack: find takes a function of a block, such as (block) => block.state === 'frozen', and it got ${shown(test)}`)
        return this.plans.map((_, index) => index).filter((index) => test(this.info(index)))
    }

    /**
     * The middle of an edge of a block, in the coordinates of the object, for a line or a note: 'left',
     * 'right', 'top' or 'bottom'. Defaults to the right edge. `stack.toWorld(...stack.p('MLP'))` gives the
     * place on the stage.
     */
    p(ref: StackBlockRef, edge: 'left' | 'right' | 'top' | 'bottom' = 'right'): [number, number] {
        const plan = this.plans[this.index(ref)]!
        if (edge === 'left') return [plan.x - plan.width / 2, plan.y]
        if (edge === 'right') return [plan.x + plan.width / 2, plan.y]
        if (edge === 'top') return [plan.x, plan.y - this.blockHeight / 2]
        if (edge === 'bottom') return [plan.x, plan.y + this.blockHeight / 2]
        throw new Error(`layerStack: edge is 'left', 'right', 'top' or 'bottom', not ${shown(edge)}`)
    }

    /** The foot of the stream, where the data comes in, in the coordinates of the object. A row of tokens goes under it. */
    get foot(): [number, number] {
        return [this.streamX, this.footY]
    }

    /** The head of the stream, where the data leaves, in the coordinates of the object: the tip of its arrow. */
    get head(): [number, number] {
        return [this.streamX, this.headY]
    }

    /**
     * The box of the object or of one block, in stage pixels, for `place` and `beside` of the layout. Without
     * a block, it is the box that the layout measures: all the layers, the frames, and the room of the shapes.
     * The box is where the object is now, so ask for it after the object has its place.
     */
    region(ref?: StackBlockRef): Box {
        return boxOf(ref === undefined ? this : this.block(ref))
    }

    /** The label of a block belongs to its box, so a light on the box keeps the label bright. */
    override labelsOf(part: Node): readonly Node[] {
        const index = this.boxes.indexOf(part)
        return index < 0 ? [] : [this.labels[index]!]
    }

    /** The stack builds from the foot of the stream up: the stream grows, and each part arrives when the stream reaches its height. A branch that waits for `show()` and the vector do not show. */
    enter(options: AnimOptions = {}): Anim {
        this.timed('enter()', options)
        return {
            label: 'layerStack.enter', duration: options.duration ?? 1.6, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'enter()')
                reveal(this, t0, ctx.stage)
                const [lineOfStream, head] = this.stream.children as [Node, Node]
                stepAt(lineOfStream, 'trimTo', 0, t0)
                lineOfStream.tween('trimTo', 1, t0, t1, ctx.ease)
                stepAt(head, 'opacity', 0, t0)
                head.tween('opacity', 1, t0 + (t1 - t0) * 0.85, t1, ctx.ease)
                // A part arrives when the growing end of the stream is at its height, with the ease of the play. It
                // starts a little before that, and takes a quarter of the whole time.
                const span = t1 - t0, length = this.footY - this.headY
                const arrive = (node: Node, y: number) => {
                    const start = Math.max(t0, t0 + reaches(ctx.ease, clamp((this.footY - y) / length)) * span - span * 0.08)
                    stepAt(node, 'opacity', 0, t0)
                    node.tween('opacity', 1, start, Math.min(t1, start + span * 0.25), ctx.ease)
                }
                const foot = (block: number) => this.plans[block]!.y + this.blockHeight / 2
                this.layers.forEach((layer) => {
                    for (const block of [...layer.blocks, ...(layer.around >= 0 ? [layer.around] : [])]) arrive(this.bodies[block]!, foot(block))
                    if (!layer.branch) return
                    arrive(this.taps[layer.part]!, layer.tapY)
                    arrive(this.reads[layer.part]!, layer.tapY)
                    layer.chains.forEach((chain, order) => arrive(this.chains[chain]!, foot(layer.blocks[order + 1]!)))
                    arrive(this.writes[layer.part]!, layer.plusY)
                    arrive(this.adds[layer.part]!, layer.plusY)
                })
                this.frames.forEach((frame, group) => arrive(frame, this.frameFeet[group]!))
            },
        }
    }

    /**
     * A vector arrives at the foot of the stream: one value for each cell, from -1 to 1 for the full range
     * of the colors. A vector that is on the stream leaves first, where it is. Then `pass()` sends the new one up.
     */
    feed(values: readonly number[], options: AnimOptions = {}): Anim {
        const next = this.checkedValues(values, 'feed()')
        this.timed('feed()', options)
        if (this.gap < this.leastGap) throw new Error(`layerStack: a gap of ${this.gap} has no room for the vector, which is ${this.vectorHeight} px high and rests on the stream between two layers. Give a gap of ${this.leastGap} or more, or leave the gap out`)
        return {
            label: 'layerStack.feed', duration: options.duration ?? 0.6, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'feed()')
                this.claim('feed()', t0, t1)
                reveal(this, t0, ctx.stage)
                const there = this.where !== null && sampleAt(this.vector, 'visible', t0) && sampleAt(this.vector, 'opacity', t0) > 0.01
                // A vector that is there leaves in the first part of the time, and the new one comes in the rest.
                const start = there ? t0 + (t1 - t0) * 0.4 : t0
                const riders = [this.vector, ...(this.tag ? [this.tag] : [])]
                for (const rider of riders) {
                    if (there) rider.tween('opacity', 0, t0, start, ctx.ease)
                    stepAt(rider, 'visible', true, start)
                    stepAt(rider, 'opacity', 0, start)
                    stepAt(rider, 'y', this.stops[0]! + this.size * 0.5, start)
                    rider.tween('opacity', 1, start, t1, ctx.ease)
                    rider.tween('y', this.stops[0]!, start, t1, ctx.ease)
                }
                stepAt(this.vector, 'x', this.streamX, start)
                this.paintCells(this.vectorCells, next, start, start)
                this.vectorNumbers = this.number(this.vectorDigits, this.vectorCells, this.vectorNumbers, next, start)
                // The stream can show through the plate while it fades. Reveal the numbers once the plate covers it.
                stepAt(this.vectorDigits, 'opacity', 0, t0)
                stepAt(this.vectorDigits, 'opacity', 1, t1)
                this.shapeNow = this.startShape
                this.tagTexts.forEach((made, index) => stepAt(made, 'visible', index === this.shapeNow, start))
                this.where = 0
                this.now = next
            },
        }
    }

    /**
     * The vector goes up the stream through the layer of a block, and stops over it. On its way it passes
     * each layer that is before that one. It leaves the last layer with `values`: one value for each cell.
     * Without them, it keeps its values.
     *
     * In a block on the stream, the vector is behind the block when it changes. At a branch, the vector stays
     * on the stream and a copy of it goes through the blocks of the branch. The copy comes back with what the
     * branch adds, which is the new values less the old ones, and the add puts it on the stream. So the film
     * shows the stream as the line that every layer adds to.
     */
    pass(through: StackBlockRef, values?: readonly number[] | null, options: StackPassOptions = {}): Anim {
        const target = this.plans[this.index(through)]!.layer
        const call = `pass(${shown(through)})`
        const next = values === undefined || values === null ? null : this.checkedValues(values, call)
        const around = options.aroundValues === undefined ? null : this.checkedValues(options.aroundValues, `aroundValues of ${call}`)
        if (around && (next === null || this.layers[target]!.around < 0)) throw new Error(`layerStack: ${call} needs final values and a branch around a block to use aroundValues`)
        this.timed(call, options)
        // Each layer on the way has a share of the time: a branch takes longer than a block.
        const own = (at: number) => (this.layers[at]!.branch && this.showing[at] ? BRANCH_TIME : BLOCK_TIME)
        return {
            // Without a duration, a pass takes the time of its last layer. The stack does not know here where the vector will be.
            label: 'layerStack.pass', duration: options.duration ?? own(target), ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const from = this.where
                if (from === null || this.now === null) throw new Error(`layerStack: ${call} has no vector to send. Call feed() first: it puts a vector at the foot of the stream`)
                if (target < from) throw new Error(`layerStack: ${call}: the vector passed ${this.called(this.layers[target]!.blocks[0]!)} already. It does not go back. feed() starts again at the foot of the stream`)
                const last = this.layers[target]!
                if (next !== null && last.branch && !this.showing[target] && last.around < 0) throw new Error(`layerStack: ${call} has values, and the branch of ${this.called(last.blocks[0]!)} does not show, so nothing changes the vector there. Call show() first, or give no values`)
                if (around && !this.showing[target]) throw new Error(`layerStack: show the branch before using aroundValues in ${call}`)
                // Validate the derived values before writing any tracks. A difference can exceed the cell width even when both inputs fit.
                const main = around ?? this.now
                const residual = last.branch && this.showing[target] && next
                    ? this.checkedValues(next.map((value, i) => value - main[i]!), `residual of ${call}`) : null
                const timing = timingOf(this)
                let natural = 0
                for (let at = from; at <= target; at++) natural += own(at)
                let start = t0
                const windows: Claim[] = []
                for (let at = from; at <= target; at++) {
                    const end = at === target ? t1 : start + (t1 - t0) * (own(at) / natural)
                    checkTime(call, start, timing.reveals.get(at), 't1', 'the visible branch')
                    windows.push({ call, t0: start, t1: end })
                    start = end
                }
                this.claim(call, t0, t1)
                reveal(this, t0, ctx.stage)
                for (let at = from; at <= target; at++) {
                    const layer = this.layers[at]!, window = windows[at - from]!
                    if (layer.branch && !this.showing[at]) timing.hiddenPasses.set(at, window)
                    const to = at === target ? next : null
                    if (layer.branch && this.showing[at]) this.throughBranch(at, to, at === target ? around : null, at === target ? residual : null, window.t0, window.t1)
                    else this.throughBlock(at, to, window.t0, window.t1, ctx.ease)
                }
                this.where = target + 1
                if (next !== null) this.now = next
            },
        }
    }

    /**
     * The light goes to a block, or off with null: the block that the scene is about. A lit block has a
     * thick border and a stronger fill. One block is lit at a time.
     */
    light(ref: StackBlockRef | null, options: AnimOptions = {}): Anim {
        const next = ref === null ? null : this.index(ref)
        this.timed('light()', options)
        return {
            label: 'layerStack.light', duration: options.duration ?? 0.4, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'light()')
                if (next !== null && !this.visibleAt(next)) throw new Error(`layerStack: light: ${this.called(next)} is in a branch that does not show. Call show() first`)
                const timing = timingOf(this), call = `light(${shown(ref)})`
                checkTime(call, t0, timing.light, 't0', 'the light')
                if (next !== null) this.checkReveal(next, call, t0, 't0')
                timing.light = { call, t0, t1 }
                reveal(this, t0, ctx.stage)
                const before = this.lit
                this.lit = next
                if (before !== null && before !== next) this.halos[before]!.tween('opacity', 0, t0, t1, ctx.ease)
                if (next !== null) this.halos[next]!.tween('opacity', 1, t0, t1, ctx.ease)
            },
        }
    }

    /**
     * Blocks go to another state, such as `stack.mark(['embed', 'attention'], 'frozen')`. `which` is a block,
     * a list of blocks, or a function of a block, which the stack calls when the change is scheduled. So a
     * second change in one sequence sees the states that the first one left.
     */
    mark(which: StackBlockRef | readonly StackBlockRef[] | ((block: StackBlockInfo) => boolean), state: string, options: AnimOptions = {}): Anim {
        // Find a wrong name or a wrong block now, where the film names it.
        if (!this.looks.has(state)) throw new Error(`layerStack: no state ${shown(state)}. The states are ${this.stateNames.join(', ')}`)
        const listed = typeof which === 'function' ? null : (Array.isArray(which) ? which as readonly StackBlockRef[] : [which as StackBlockRef]).map((ref) => this.index(ref))
        this.timed('mark()', options)
        return {
            label: 'layerStack.mark', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'mark()')
                const timing = timingOf(this), call = `mark(..., ${shown(state)})`
                const candidates = listed === null ? this.plans.map((_, index) => index) : [...new Set(listed)]
                for (const index of candidates) {
                    checkTime(call, t0, timing.marks.get(index), 't0', this.called(index))
                    if (listed === null) {
                        checkTime(call, t0, this.replacing[index], 't0', 'the block label for the predicate')
                        this.checkReveal(index, call, t0, 't0')
                    }
                }
                const chosen = (listed === null ? this.find(which as (block: StackBlockInfo) => boolean) : candidates).filter((index) => this.states[index] !== state)
                const windows = staggered(chosen.length, Math.max(0, options.lag ?? 0), t0, t1)
                chosen.forEach((index, order) => {
                    const [start] = windows[order]!
                    checkTime(call, start, timing.marks.get(index), 't1', this.called(index))
                    checkTime(call, start, timing.stateReads.get(index), 't0', 'the requested state of the block')
                    checkTime(call, start, this.replacing[index], 't0', this.called(index))
                    checkTime(call, start, timing.opens.get(index), 't0', 'the color of the open block')
                    checkTime(call, start, timing.selection, 't0', 'the block state read by a predicate')
                })
                if (listed === null && (!timing.selection || timing.selection.t0 < t0)) timing.selection = { call, t0, t1: t0 }
                // A later request for the current state can skip its animation only if an earlier mark keeps that state.
                if (listed !== null) for (const index of candidates) {
                    if (this.states[index] === state && t0 > (timing.stateReads.get(index)?.t0 ?? -Infinity)) timing.stateReads.set(index, { call, t0, t1: t0 })
                }
                if (chosen.length === 0) return
                const before = this.states, next = [...before]
                for (const index of chosen) next[index] = state
                this.states = next
                chosen.forEach((index, order) => {
                    const [start, finish] = windows[order]!, end = Math.min(finish, t1)
                    timing.marks.set(index, { call, t0: start, t1: end, ease: ctx.ease })
                    this.paint(index, state, this.paints[index]!, start, end, ctx.ease)
                    // The mark of the old state leaves, and the mark of the new one comes.
                    const from = this.icons[index * this.stateNames.length + this.stateNames.indexOf(before[index]!)], to = this.icons[index * this.stateNames.length + this.stateNames.indexOf(state)]
                    if (from && from !== to) {
                        from.tween('opacity', 0, start, end, ctx.ease)
                        stepAt(from, 'visible', false, end)
                    }
                    if (to && from !== to) {
                        stepAt(to, 'visible', true, start)
                        stepAt(to, 'opacity', 0, start)
                        to.tween('opacity', 1, start, end, ctx.ease)
                    }
                })
            },
        }
    }

    /**
     * Another block takes the place of a block, such as `stack.replace('norm', 'RMSNorm')`: the label fades
     * out and the new one fades in, so no moment shows two labels. The block keeps its id, its place and its
     * state. Give `{ label, color }` for a new color too.
     */
    replace(ref: StackBlockRef, next: string | { label: string; color?: ColorInput }, options: AnimOptions = {}): Anim {
        const index = this.index(ref)
        const spec = typeof next === 'string' ? { label: next } : next
        if (!isObject(spec) || typeof spec.label !== 'string' || spec.label.trim() === '') throw new Error(`layerStack: replace: the new block of ${this.called(index)} is ${shown(next)}. Give a label, or { label, color }`)
        const label = spec.label.trim()
        if (/[\n\r\t]/.test(label)) throw new Error(`layerStack: replace: the label ${shown(label)} has a line break or a tab. A label is one line`)
        const width = text(label, { size: this.size, font: this.font }).get('px') * 2
        if (width > this.rooms[index]! + 0.5) throw new Error(`layerStack: replace: the label ${shown(label)} is ${Math.ceil(width)} px wide at size ${this.size}, and ${this.called(index)} has ${Math.floor(this.rooms[index]!)} px for it. Use a shorter label, or build the stack with a width of ${Math.ceil(this.tight + width - this.rooms[index]!)} or more`)
        const paint = spec.color === undefined ? null : this.paintOf(spec.color, `the color of the new block of ${this.called(index)}`)
        const call = `replace(${shown(ref)})`
        this.timed(call, options)
        return {
            label: 'layerStack.replace', duration: options.duration ?? 0.8, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                const last = this.replacing[index]
                const timing = timingOf(this)
                checkTime(call, t0, timing.marks.get(index), 't0', this.called(index))
                checkTime(call, t0, timing.selection, 't0', 'the block label read by a predicate')
                if (paint) checkTime(call, t0, timing.opens.get(index), 't0', 'the color of the open block')
                if (last && t0 < last.t1 - SOON) throw new Error(`layerStack: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. A block has one label at a time. Play the two in a \`seq\`, or give the first a shorter duration`)
                this.replacing = this.replacing.map((claim, at) => (at === index ? { call, t0, t1 } : claim))
                reveal(this, t0, ctx.stage)
                const old = this.labels[index] as TextNode, middle = (t0 + t1) / 2
                const color = this.lookOf(this.states[index]!, paint ?? this.paints[index]!).label
                const made = text(label, { size: this.size, font: this.font, color })
                const mark = timing.marks.get(index)
                if (mark && t0 < mark.t1 && old.chars[0]) {
                    const initial = sampleAt(old.chars[0], 'fill', mark.t0)
                    for (const glyph of made.chars) {
                        glyph.base.fill = initial
                        glyph.tween('fill', toPaint(color), mark.t0, mark.t1, mark.ease)
                    }
                }
                made.base.visible = false
                this.bodies[index]!.add(made)
                ownLabels(this, { labels: [made] })
                old.tween('opacity', 0, t0, t0 + (t1 - t0) * 0.45, ctx.ease)
                stepAt(old, 'visible', false, middle)
                stepAt(made, 'visible', true, middle)
                stepAt(made, 'opacity', 0, middle)
                made.tween('opacity', 1, t0 + (t1 - t0) * 0.55, t1, ctx.ease)
                this.labels[index] = made
                this.names = this.names.map((name, at) => (at === index ? label : name))
                if (paint) {
                    this.paints = this.paints.map((own, at) => (at === index ? paint : own))
                    this.paintColor(index, this.lookOf(this.states[index]!, paint).paint, t0, t1, ctx.ease)
                }
                this.pulse(index, t0, t1)
            },
        }
    }

    /**
     * A branch that was made with `shown: false` comes in at its place: its line leaves the stream, its
     * blocks arrive, and its add lands on the stream. Name the branch by one of its blocks. A branch that
     * shows already does not change.
     */
    override show(): this
    override show(ref: StackBlockRef, options?: AnimOptions): Anim
    override show(ref?: StackBlockRef, options: AnimOptions = {}): this | Anim {
        // With no block, it is the `show()` of a node: the whole stack shows.
        if (ref === undefined) return super.show()
        const index = this.index(ref), plan = this.plans[index]!
        if (plan.role !== 'side') throw new Error(`layerStack: show: ${this.called(index)} is not in a branch. show() brings in a branch that was made with shown: false`)
        this.timed('show()', options)
        return {
            label: 'layerStack.show', duration: options.duration ?? 1, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'show()')
                const timing = timingOf(this), call = `show(${shown(ref)})`
                checkTime(call, t0, timing.reveals.get(plan.layer), 't0', 'the branch')
                if (!this.showing[plan.layer]) {
                    checkTime(call, t0, timing.hiddenPasses.get(plan.layer), 't1', 'the branch while the vector passes it')
                    checkTime(call, t0, timing.selection, 't0', 'the branch visibility read by a predicate')
                }
                reveal(this, t0, ctx.stage)
                if (this.showing[plan.layer]) return
                timing.reveals.set(plan.layer, { call, t0, t1 })
                this.showing = this.showing.map((flag, at) => (at === plan.layer ? true : flag))
                const layer = this.layers[plan.layer]!, span = t1 - t0
                const fadeIn = (node: Node, start: number, end: number) => {
                    stepAt(node, 'visible', true, t0)
                    stepAt(node, 'opacity', 0, t0)
                    node.tween('opacity', 1, start, end, ctx.ease)
                }
                const trace = (wire: Node, start: number, end: number) => {
                    const [drawnLine, head] = wire.children as [Node, Node]
                    stepAt(wire, 'visible', true, t0)
                    stepAt(drawnLine, 'trimTo', 0, t0)
                    drawnLine.tween('trimTo', 1, start, end, ctx.ease)
                    stepAt(head, 'opacity', 0, t0)
                    head.tween('opacity', 1, start + (end - start) * 0.7, end, ctx.ease)
                }
                // In the order of the data: the point on the stream, the line in, the blocks, the line out, the add.
                fadeIn(this.taps[layer.part]!, t0, t0 + span * 0.2)
                trace(this.reads[layer.part]!, t0, t0 + span * 0.4)
                const windows = staggered(layer.blocks.length, 0.5, t0 + span * 0.25, t0 + span * 0.75)
                layer.blocks.forEach((block, order) => fadeIn(this.blocks[block]!, windows[order]![0], windows[order]![1]))
                layer.chains.forEach((chain, order) => trace(this.chains[chain]!, windows[order]![1], windows[order + 1]![1]))
                trace(this.writes[layer.part]!, t0 + span * 0.6, t1)
                fadeIn(this.adds[layer.part]!, t0 + span * 0.8, t1)
            },
        }
    }

    /**
     * A block opens to a close-up of its inside: two lines go from the block to a frame around `inside`,
     * and `inside` fades in. `inside` is a node of the film, a block of the layout, or a list: another
     * stack, a grid of numbers, a formula. Place it at the right or at the left of the stack first. The lines
     * are for the places that the stack and the close-up have when this plays, and they do not follow a
     * later move. One block is open at a time: an open block closes when another one opens.
     */
    open(ref: StackBlockRef, inside: Node | Block | readonly (Node | Block)[], options: AnimOptions = {}): Anim {
        const index = this.index(ref)
        const nodes = nodesFor('layerStack.open', inside, 'the inside')
        if (nodes.length === 0) throw new Error('layerStack: open: give the inside at least one node')
        if (nodes.some((node) => node === this || this.all().includes(node))) throw new Error('layerStack: open: the inside is the stack or a part of it. Give a node of the film, such as a second stack or a grid of numbers')
        const call = `open(${shown(ref)})`
        this.timed(call, options)
        return {
            label: 'layerStack.open', duration: options.duration ?? 0.9, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, call)
                if (!this.visibleAt(index)) throw new Error(`layerStack: open: ${this.called(index)} is in a branch that does not show. Call show() first`)
                const timing = timingOf(this)
                this.checkReveal(index, call, t0, 't1')
                checkTime(call, t0, timing.marks.get(index), 't0', 'the color of the open block')
                checkTime(call, t0, this.replacing[index], 't0', 'the appearance of the open block')
                // The box of the close-up, in the coordinates of the stack.
                const box = boxOf(nodes), inverse = invert(this.worldMatrix())
                const corners = (['top left', 'top right', 'bottom left', 'bottom right'] as const).map(side => apply(inverse, ...box.point(side)))
                const xs = corners.map(([x]) => x), ys = corners.map(([, y]) => y)
                const pad = Math.round(this.size * 0.6)
                const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad
                const plan = this.plans[index]!, half = this.blockHeight / 2
                const atRight = x0 + pad >= this.drawn[1] - 0.5, atLeft = x1 - pad <= this.drawn[0] + 0.5
                if (!atRight && !atLeft) throw new Error(`layerStack: ${call}: the inside is over the stack or under it. Place it at the right or at the left of the stack, such as place(inside, area.columns(2)[1]), and then play open()`)
                // A line from a block must not pass another part of the stack.
                if (atRight && plan.role === 'around') throw new Error(`layerStack: ${call}: ${this.called(index)} has a branch at its right, and the lines to the inside would cross it. Place the inside at the left of the stack, or open a block of the branch`)
                if (atLeft && plan.role === 'side') throw new Error(`layerStack: ${call}: ${this.called(index)} is at the right of the stream, and the lines to the inside would cross the stream. Place the inside at the right of the stack`)
                // A call that is refused above does not take the time of the lines.
                this.claimZoom(call, t0, t1)
                timing.opens.set(index, { call, t0, t1: t0 })
                reveal(this, t0, ctx.stage)
                const edge = plan.x + (atRight ? plan.width / 2 : -plan.width / 2), near = atRight ? x0 : x1
                const [wedge, upper, lower, frame] = this.zoom.children as [Node, Node, Node, Node]
                const was = this.openAt !== null && sampleAt(this.zoom, 'visible', t0)
                // An open block closes in the first part of the time, and the new one opens in the rest.
                const start = was ? t0 + (t1 - t0) * 0.35 : t0
                if (was) {
                    this.zoom.tween('opacity', 0, t0, start, ctx.ease)
                    this.leave(this.inside.filter((node) => !nodes.includes(node)), t0, start, ctx.ease)
                }
                const paint = this.lookOf(this.states[index]!, this.paints[index]!).paint
                stepAt(wedge, 'path', polyPath([[edge, plan.y - half], [near, y0], [near, y1], [edge, plan.y + half]], true), start)
                stepAt(upper, 'path', linePath([edge, plan.y - half], [near, y0]), start)
                stepAt(lower, 'path', linePath([edge, plan.y + half], [near, y1]), start)
                stepAt(frame, 'path', rectPath(x0, y0, x1 - x0, y1 - y0, Math.round(this.size * 0.5)), start)
                stepAt(wedge, 'fill', paint, start)
                for (const part of [upper, lower, frame]) stepAt(part, 'stroke', paint, start)
                stepAt(this.zoom, 'visible', true, start)
                stepAt(this.zoom, 'opacity', 0, start)
                this.zoom.tween('opacity', 1, start, start + (t1 - start) * 0.6, ctx.ease)
                // The close-up comes after its frame. A node of it that shows already stays as it is.
                const from = start + (t1 - start) * 0.4
                for (const node of nodes) {
                    if (node.mounted && sampleAt(node, 'visible', from) && this.shownAt(node, from)) continue
                    const opacity = node.get('opacity')
                    reveal(node, from, ctx.stage)
                    stepAt(node, 'opacity', 0, from)
                    node.tween('opacity', opacity, from, t1, ctx.ease)
                }
                this.openAt = index
                this.inside = nodes
            },
        }
    }

    /** The open block closes: the lines, the frame and the close-up fade out. With no open block, nothing changes. */
    close(options: AnimOptions = {}): Anim {
        this.timed('close()', options)
        return {
            label: 'layerStack.close', duration: options.duration ?? 0.5, ease: options.ease,
            schedule: (ctx) => {
                const [t0, t1] = this.times(ctx, 'close()')
                if (this.openAt === null) {
                    checkTime('close()', t0, this.zoomBusy, 't0', 'the close-up')
                    if (!this.zoomBusy || t0 >= this.zoomBusy.t1) this.zoomBusy = { call: 'close()', t0, t1: t0 }
                    return
                }
                this.claimZoom('close()', t0, t1)
                this.zoom.tween('opacity', 0, t0, t1, ctx.ease)
                stepAt(this.zoom, 'visible', false, t1)
                this.leave(this.inside, t0, t1, ctx.ease)
                this.openAt = null
                this.inside = []
            },
        }
    }

    private info(index: number): StackBlockInfo {
        const plan = this.plans[index]!
        return { index, id: plan.id, label: this.names[index]!, state: this.states[index]!, layer: plan.layer, shown: this.visibleAt(index) }
    }

    /** False for a block of a branch that waits for `show()`. */
    private visibleAt(index: number): boolean {
        const plan = this.plans[index]!
        return plan.role !== 'side' || this.showing[plan.layer]!
    }

    private checkReveal(index: number, call: string, time: number, boundary: 't0' | 't1'): void {
        const plan = this.plans[index]!
        if (plan.role === 'side') checkTime(call, time, timingOf(this).reveals.get(plan.layer), boundary, 'the branch visibility')
    }

    /** What an error calls a block: block 2 ("attention"). */
    private called(index: number): string {
        return `block ${index} (${shown(this.names[index]!)})`
    }

    private known(): string {
        return `The blocks are ${this.plans.map((plan, index) => `${index} (${shown(plan.id)})`).join(', ')}`
    }

    /** The index of a block that the stack has, or an error that names the blocks. */
    private index(ref: unknown): number {
        if (typeof ref === 'number') {
            if (!Number.isInteger(ref) || ref < 0 || ref >= this.plans.length) throw new Error(`layerStack: no block ${ref}. ${this.known()}`)
            return ref
        }
        if (typeof ref !== 'string') throw new Error(`layerStack: a block is named by its id or by its index, and ${shown(ref)} is neither. ${this.known()}`)
        const found = this.plans.flatMap((plan, index) => (plan.id === ref ? [index] : []))
        if (found.length === 0) throw new Error(`layerStack: no block ${shown(ref)}. ${this.known()}`)
        if (found.length > 1) throw new Error(`layerStack: ${shown(ref)} names the blocks ${found.join(', ')}. Name one by its index, or give each block its own id, such as { label: ${shown(ref)}, id: ${shown(`${ref} 2`)} }`)
        return found[0]!
    }

    private paintOf(color: ColorInput, what: string): Paint {
        try {
            return toPaint(color)
        } catch {
            throw new Error(`layerStack: ${what} is ${shown(color)}, which is not a color. Use a color of the look, such as 'orange', or a CSS color`)
        }
    }

    private lookOf(state: string, own: Paint): Look {
        const look = this.looks.get(state)!
        return {
            paint: look.color === undefined ? own : toPaint(look.color), line: look.dim ? DIM_LINE : 1, fill: look.dim ? DIM_FILL : FILL,
            label: look.dim ? 'dim' : 'ink', dash: look.dash === true, mark: look.mark ?? null,
        }
    }

    /** The dashes of the border of a block. */
    private dashes(): readonly number[] {
        return [this.size * 0.32, this.size * 0.26]
    }

    /** A block takes the look of a state and a color. */
    private paint(index: number, state: string, own: Paint, t0: number, t1: number, ease: Ease): void {
        const look = this.lookOf(state, own), box = this.boxes[index]!
        this.paintColor(index, look.paint, t0, t1, ease)
        box.tween('strokeOpacity', look.line, t0, t1, ease)
        box.tween('fillOpacity', look.fill, t0, t1, ease)
        // Dashes cannot fade to a line, so they switch when the colors are half way.
        stepAt(box, 'dash', look.dash ? this.dashes() : null, (t0 + t1) / 2)
        for (const label of this.bodies[index]!.children) {
            if (!(label instanceof TextNode) || (label !== this.labels[index] && !sampleAt(label, 'visible', t0))) continue
            for (const glyph of label.chars) glyph.tween('fill', toPaint(look.label), t0, t1, ease)
        }
    }

    /** A replacement can change color while a state change controls the dashes, opacity, and label. */
    private paintColor(index: number, paint: Paint, t0: number, t1: number, ease: Ease): void {
        for (const part of [this.boxes[index]!, this.washes[index]!, this.halos[index]!]) {
            part.tween('fill', paint, t0, t1, ease)
            if (part.get('stroke')) part.tween('stroke', paint, t0, t1, ease)
        }
    }

    /** The fill of a block lights and goes back, while the data is in it. It ends where it began, so two pulses that overlap leave no trace. */
    private pulse(index: number, t0: number, t1: number): void {
        if (!(t1 > t0)) return
        this.washes[index]!.track('opacity').add({ t0, t1, ease: null, to: 0, at: (alpha) => PULSE * Math.sin(Math.PI * clamp(alpha)) })
    }

    /** The color and the opacity of a cell for a value. */
    private cellLook(value: number): { paint: Paint; fill: number } {
        const [low, high] = this.digits === null ? CELL : CELL_NUMBERED, share = Math.min(1, Math.abs(value))
        return { paint: toPaint(share < 0.005 ? 'dim' : value > 0 ? 'teal' : 'orange'), fill: low + (high - low) * share }
    }

    private paintCells(cellsOf: readonly Node[], values: readonly number[], t0: number, t1: number): void {
        cellsOf.forEach((cell, index) => {
            const look = this.cellLook(values[index]!)
            cell.tween('fill', look.paint, t0, t1, smooth)
            cell.tween('fillOpacity', look.fill, t0, t1, smooth)
        })
    }

    /** The text of a value in a cell. */
    private written(value: number): string {
        // A value that rounds to zero has no sign.
        const out = value.toFixed(this.digits ?? 0)
        return Number(out) === 0 ? (0).toFixed(this.digits ?? 0) : out
    }

    /** The numbers of a vector change at a time: the old ones leave, and new ones take their place. Returns the new ones. */
    private number(holder: Node, cellsOf: readonly Node[], old: readonly Node[], values: readonly number[], at: number): Node[] {
        if (this.digits === null) return []
        for (const made of old) stepAt(made, 'visible', false, at)
        const next = values.map((value, index) => {
            const made = text(this.written(value), { size: this.size, font: this.font, color: 'ink' }).at(cellsOf[index]!.get('x'), 0)
            made.base.visible = false
            holder.add(made)
            stepAt(made, 'visible', true, at)
            return made
        })
        ownLabels(this, { labels: next })
        return next
    }

    private checkedValues(values: unknown, call: string): number[] {
        if (!Array.isArray(values) || values.length !== this.cellCount) throw new Error(`layerStack: ${call} has ${Array.isArray(values) ? `${values.length} values` : shown(values)}, and the vector has ${this.cellCount} cells. Give one value for each cell, or build the stack with \`cells: ${Array.isArray(values) && values.length > 0 ? values.length : this.cellCount}\``)
        for (const [index, value] of values.entries()) {
            if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`layerStack: value ${index} of ${call} is ${shown(value)}. A value is a number`)
            // A number has a fifth of the text size of room at each side of its cell, at the least.
            if (this.digits !== null && text(this.written(value), { size: this.size, font: this.font }).get('px') * 2 > this.cellWidth - this.size * 0.4) throw new Error(`layerStack: value ${index} of ${call} is ${value}, which a cell writes as ${shown(this.written(value))}. A cell has room for a number as wide as ${shown(this.widest)}. Give smaller values, such as a tenth of each, or fewer digits`)
        }
        return [...values] as number[]
    }

    /** A `duration` and a `lag` are numbers, 0 or more. One that is not a number would write keys that no frame finds. */
    private timed(call: string, options: AnimOptions): void {
        for (const key of ['duration', 'lag'] as const) {
            const value = options[key]
            if (value !== undefined && !(Number.isFinite(value) && value >= 0)) throw new Error(`layerStack: the ${key} of ${call} is ${String(value)}. Give a number, 0 or more`)
        }
    }

    private times(ctx: AnimContext, call: string): [number, number] {
        if (!(Number.isFinite(ctx.t0) && Number.isFinite(ctx.t1) && ctx.t1 >= ctx.t0)) throw new Error(`layerStack: ${call} plays from ${String(ctx.t0)} to ${String(ctx.t1)}. Give the play a duration that is a number, 0 or more`)
        return [ctx.t0, ctx.t1]
    }

    /**
     * Take the time of a change of the vector. Each change writes the way of the vector from the place that
     * the change before it left. Two changes at one time would each write a way, and the picture would
     * follow neither. So a change that starts before the last one is over is refused.
     */
    private claim(call: string, t0: number, t1: number): void {
        const last = this.vectorBusy
        if (last && t0 < last.t1 - SOON) throw new Error(`layerStack: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. The vector does one thing at a time. Play the two in a \`seq\`, or give ${last.call} a duration of ${Math.max(0, Math.floor((t0 - last.t0) * 100) / 100)} or less`)
        this.vectorBusy = { call, t0, t1 }
    }

    private claimZoom(call: string, t0: number, t1: number): void {
        const last = this.zoomBusy
        if (last && t0 < last.t1 - SOON) throw new Error(`layerStack: ${call} plays from ${seconds(t0)} to ${seconds(t1)}, and ${last.call} plays from ${seconds(last.t0)} to ${seconds(last.t1)}. One block is open at a time. Play the two in a \`seq\`, or give ${last.call} a shorter duration`)
        this.zoomBusy = { call, t0, t1 }
    }

    /** True when a node and the groups that hold it show at a time. */
    private shownAt(node: Node, time: number): boolean {
        for (let up = node.parent; up; up = up.parent) if (!sampleAt(up, 'visible', time)) return false
        return sampleAt(node, 'opacity', time) > 0.01
    }

    /** Nodes of a close-up fade out, and keep their opacity for the next time that they show. */
    private leave(nodes: readonly Node[], t0: number, t1: number, ease: Ease): void {
        for (const node of nodes) {
            const opacity = sampleAt(node, 'opacity', t0)
            node.tween('opacity', 0, t0, t1, ease)
            stepAt(node, 'visible', false, t1)
            stepAt(node, 'opacity', opacity, t1)
        }
    }

    /** The vector and the shape beside it go to a height. */
    private ride(y: number, t0: number, t1: number, ease: Ease): void {
        this.vector.tween('y', y, t0, t1, ease)
        this.tag?.tween('y', y, t0, t1, ease)
    }

    /** The shape beside the vector changes at a time, when the block has one. */
    private reshape(block: number, at: number): void {
        const next = this.plans[block]!.shape
        if (next < 0 || next === this.shapeNow) return
        this.tagTexts.forEach((made, index) => stepAt(made, 'visible', index === next, at))
        this.shapeNow = next
    }

    /** The vector passes a block on the stream, or a branch that does not show. It changes while the block hides it. */
    private throughBlock(at: number, values: readonly number[] | null, t0: number, t1: number, ease: Ease): void {
        const layer = this.layers[at]!, from = this.stops[at]!, to = this.stops[at + 1]!
        this.ride(to, t0, t1, ease)
        const block = layer.branch ? layer.around : layer.blocks[0]!
        if (block < 0) return
        // The time at which the middle of the vector is at a height, with the ease of the play.
        const when = (y: number) => t0 + reaches(ease, clamp((y - from) / (to - from))) * (t1 - t0)
        const middle = when(this.plans[block]!.y)
        this.hideNumbers(block, t0, when, t1)
        if (values) {
            this.paintCells(this.vectorCells, values, middle, middle)
            this.vectorNumbers = this.number(this.vectorDigits, this.vectorCells, this.vectorNumbers, values, middle)
        }
        this.reshape(block, middle)
        const reach = Math.min(0.3, (t1 - t0) * 0.3)
        this.pulse(block, middle - reach, middle + reach)
    }

    /**
     * The numbers of the vector fade before the vector goes behind a block, and come back when it is clear
     * of the block. So the edge of a block never cuts a number. `when` gives the time at which the middle
     * of the vector is at a height.
     */
    private hideNumbers(block: number, from: number, when: (y: number) => number, until: number): void {
        if (this.digits === null) return
        const y = this.plans[block]!.y, reach = (this.blockHeight + this.vectorHeight) / 2
        this.vectorDigits.tween('opacity', 0, from, Math.max(from, when(y + reach)), smooth)
        this.vectorDigits.tween('opacity', 1, Math.min(until, when(y - reach)), until, smooth)
    }

    /**
     * The vector passes a branch. It goes to the point where the branch leaves the stream, and a copy of it
     * goes through the blocks of the branch. The vector goes on up the stream. The copy comes back with what
     * the branch adds and stops at the add, where a viewer can read it. Then the add takes it, and the vector
     * goes through the add and takes its new values.
     */
    private throughBranch(at: number, values: readonly number[] | null, around: readonly number[] | null, residual: readonly number[] | null, t0: number, t1: number): void {
        const layer = this.layers[at]!, span = t1 - t0, moment = (share: number) => t0 + span * share
        const before = this.now!
        const added = residual ?? before.map(() => 0)
        const last = this.plans[layer.blocks[layer.blocks.length - 1]!]!
        // Under the add and under the copy that comes to it, with a little room. With a block on the stream
        // beside the branch, the vector waits behind that block.
        const wait = layer.around >= 0 ? this.plans[layer.around]!.y : layer.plusY + Math.max(this.ringRadius, this.vectorHeight / 2) + this.vectorHeight / 2 + Math.round(this.size * 0.15)
        const stop = this.stops[at + 1]!
        this.ride(layer.tapY, t0, moment(0.12), smooth)
        this.ride(wait, moment(0.12), moment(0.78), smooth)
        this.ride(stop, moment(0.86), t1, smooth)
        if (layer.around >= 0) {
            if (around) {
                this.paintCells(this.vectorCells, around, moment(0.78), moment(0.78))
                this.vectorNumbers = this.number(this.vectorDigits, this.vectorCells, this.vectorNumbers, around, moment(0.78))
            }
            // The vector goes behind the block on the stream on its way from the point of the branch, and leaves it on its way to its next place.
            const rise = (from: number, to: number, start: number, end: number) => (y: number) => start + reaches(smooth, clamp((y - from) / (to - from))) * (end - start)
            this.hideNumbers(layer.around, moment(0.12), rise(layer.tapY, wait, moment(0.12), moment(0.78)), moment(0.78))
            // That call brings the numbers back at its end, where the block still hides the vector. They come back after the block.
            stepAt(this.vectorDigits, 'opacity', 0, moment(0.78))
            this.vectorDigits.tween('opacity', 1, rise(wait, stop, moment(0.86), t1)(this.plans[layer.around]!.y - (this.blockHeight + this.vectorHeight) / 2), t1, smooth)
        }

        const copy = this.copy
        const along = (way: Path, start: number, end: number) => {
            const [endX, endY] = pointAt(way, 1)
            copy.track('x').add({ t0: start, t1: end, ease: smooth, to: endX, at: (alpha) => pointAt(way, alpha)[0] })
            copy.track('y').add({ t0: start, t1: end, ease: smooth, to: endY, at: (alpha) => pointAt(way, alpha)[1] })
        }
        // In: from the stream to the middle of the first block, which hides it. The copy has no numbers
        // here: they are the numbers of the vector, which shows them.
        stepAt(copy, 'visible', true, moment(0.12))
        stepAt(copy, 'opacity', 1, moment(0.12))
        stepAt(this.copyDigits, 'opacity', 0, moment(0.12))
        stepAt(copy, 'x', pointAt(layer.readWay, 0)[0], moment(0.12))
        stepAt(copy, 'y', pointAt(layer.readWay, 0)[1], moment(0.12))
        this.paintCells(this.copyCells, before, moment(0.12), moment(0.12))
        along(layer.readWay, moment(0.12), moment(0.4))
        // The blocks work, one after another. The copy changes while the last block hides it.
        const windows = staggered(layer.blocks.length, 0.6, moment(0.36), moment(0.6))
        layer.blocks.forEach((block, order) => this.pulse(block, windows[order]![0], windows[order]![1]))
        if (layer.around >= 0) this.pulse(layer.around, moment(0.36), moment(0.6))
        stepAt(copy, 'x', last.x, moment(0.48))
        stepAt(copy, 'y', last.y, moment(0.48))
        this.paintCells(this.copyCells, added, moment(0.48), moment(0.48))
        this.copyNumbers = this.number(this.copyDigits, this.copyCells, this.copyNumbers, added, moment(0.48))
        // Out: from the middle of the last block to the ring of the add, where it stops. Its numbers come
        // when it is clear of the block, and say what the branch adds.
        along(layer.writeWay, moment(0.56), moment(0.72))
        const clear = moment(0.56) + reaches(smooth, clamp((this.blockHeight + this.vectorHeight) / 2 / pathLength(layer.writeWay))) * span * 0.16
        this.copyDigits.tween('opacity', 1, clear, Math.min(moment(0.76), clear + span * 0.04), smooth)
        this.copyDigits.tween('opacity', 0, moment(0.8), moment(0.84), smooth)
        // Then it gets small and goes into the ring, so the ring shows while it takes the copy.
        copy.tween('x', this.streamX, moment(0.84), moment(0.9), smooth)
        for (const prop of ['sx', 'sy'] as const) {
            copy.tween(prop, 0.1, moment(0.84), moment(0.9), smooth)
            stepAt(copy, prop, 1, moment(0.9))
        }
        copy.tween('opacity', 0, moment(0.86), moment(0.9), smooth)
        stepAt(copy, 'visible', false, moment(0.9))
        if (values) {
            this.paintCells(this.vectorCells, values, moment(0.88), moment(0.96))
            this.vectorNumbers = this.number(this.vectorDigits, this.vectorCells, this.vectorNumbers, values, moment(0.92))
        }
        // The add swells for a moment when the two meet.
        const add = this.adds[layer.part]!
        for (const prop of ['sx', 'sy'] as const) add.track(prop).add({ t0: moment(0.82), t1: moment(0.98), ease: null, to: 1, at: (alpha) => 1 + 0.3 * Math.sin(Math.PI * clamp(alpha)) })
    }
}

/**
 * A model as a stack of layers on one stream, with the data flowing up:
 * `layerStack(['embed', { repeat: 12, layers: [{ branch: ['norm', 'attention'] }, { branch: ['norm', 'MLP'] }] }, 'unembed'])`.
 * `stack.feed([0.2, -0.5, 0.8, 0.1])` puts a vector on the stream, and `stack.pass('attention', values)` sends it through a layer.
 */
export function layerStack(layers: readonly StackLayer[], options: LayerStackOptions = {}): LayerStack {
    return new LayerStack(layers, options)
}
