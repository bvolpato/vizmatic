/**
 * Layout with no typed coordinate. A scene cuts its area into regions, lays nodes out in rows, columns and
 * grids that measure them, and puts a node in a region or beside another node.
 *
 * Nothing here is a node. A container moves the nodes that it gets, and leaves each one where it is in the
 * tree. So a film still fades each node by itself, and the shell of a narrated film still fades each node
 * of a scene.
 *
 * A call gives a right picture, or an error that says what to do.
 */
import { apply, invert, mul, pathBounds, transformPath, unionBounds, IDENTITY, type Bounds, type Mat, type Vec } from './geometry'
import { Node } from './node'
import { TextNode } from './text'
import { clock } from './track'

/**
 * A distance by name, or in stage pixels. `tight`, `normal`, `wide` and `loose` beside a text are at least
 * 0.3 of the size of the text, the room that the film check asks for. `none` and a number are exact.
 */
export type Gap = 'none' | 'tight' | 'normal' | 'wide' | 'loose' | number
/**
 * The named distances, in stage pixels: tight inside one thing (a mark and its name), normal between the
 * items of a list, wide between two groups, and loose between two parts of a picture.
 */
export const GAP = { none: 0, tight: 12, normal: 24, wide: 48, loose: 72 } as const

/** The middle, an edge or a corner of a region. */
export type Where = 'center' | 'left' | 'right' | 'top' | 'bottom' | 'top left' | 'top right' | 'bottom left' | 'bottom right'
/** The side of a thing where another thing goes. */
export type BesideSide = 'left' | 'right' | 'above' | 'under'
/** A thing that a container lays out: a node, a block, or a list of things that keep their places and move as one. */
export type LayoutItem = Node | Block | readonly LayoutItem[]
/** A thing with a measure: an item, a region, a point of the stage, or a list of items and regions. */
export type Measured = LayoutItem | Box | Vec | readonly (LayoutItem | Box)[]

const GAP_NAMES = 'none, tight, normal, wide or loose'
const round = (value: number): number => Math.round(value * 10) / 10
/** An item may be this many pixels larger than its region: the rounding of a measure is not an overflow. */
const FIT = 0.5

/** A value that a call cannot take, in a few words for a message. */
function kindOf(value: unknown): string {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (value instanceof Node) return 'a node'
    if (value instanceof Block) return 'a block'
    if (value instanceof Box) return 'a region'
    if (typeof value === 'string') return `the string ${JSON.stringify(value.length > 48 ? `${value.slice(0, 48)}...` : value)}`
    if (typeof value === 'number' || typeof value === 'boolean') return `the value ${value}`
    if (typeof value === 'function') return 'a function'
    if (Array.isArray(value)) return 'a list'
    return 'an object that is not a node'
}

const isPoint = (thing: unknown): thing is Vec => Array.isArray(thing) && thing.length === 2 && typeof thing[0] === 'number' && typeof thing[1] === 'number'

/** One of a list for a message: "a", "a or b", "a, b or c". */
const oneOf = (words: readonly string[]): string => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`)

function px(gap: Gap, what: string): number {
    if (typeof gap === 'number') {
        if (!Number.isFinite(gap)) throw new Error(`${what}: a gap is ${GAP_NAMES}, or a number of pixels, and it is ${gap}`)
        return gap
    }
    if (typeof gap !== 'string' || !Object.hasOwn(GAP, gap)) throw new Error(`${what}: no gap ${typeof gap === 'string' ? JSON.stringify(gap) : kindOf(gap)}. A gap is ${GAP_NAMES}, or a number of pixels`)
    return GAP[gap]
}

/** The options of a call, checked: an object, with no name that the call does not have. */
function optionsOf<T extends object>(what: string, options: unknown, names: readonly string[], example: string): T {
    if (options === undefined) return {} as T
    if (typeof options !== 'object' || options === null || Array.isArray(options) || options instanceof Node || options instanceof Block || options instanceof Box) {
        const list = options instanceof Node || options instanceof Block ? `. The items are one list: ${what}([a, b])` : ''
        throw new Error(`${what}: the options are an object such as ${example}, and the second argument is ${kindOf(options)}${list}`)
    }
    const unknown = Object.keys(options).find((name) => !names.includes(name))
    if (unknown !== undefined) throw new Error(`${what} has no option "${unknown}". Its options are: ${names.join(', ')}`)
    return options as T
}

/**
 * A rectangle of the stage: a region that a scene fills, or the measure of a node. It has its edges, its
 * middle and its size, and it cuts into smaller regions with no pixel numbers: `area.columns([2, 1])`.
 */
export class Box {
    /** The middle. */
    readonly cx: number
    readonly cy: number
    readonly width: number
    readonly height: number

    constructor(readonly left: number, readonly top: number, readonly right: number, readonly bottom: number) {
        if (!(Number.isFinite(left) && Number.isFinite(top) && Number.isFinite(right) && Number.isFinite(bottom))) {
            throw new Error(`Box: the edges are left ${left}, top ${top}, right ${right} and bottom ${bottom}. Each edge is a finite number of stage pixels. A value that is not a number comes from a division by 0, or from a value that is missing`)
        }
        if (right < left || bottom < top) {
            throw new Error(`Box: the edges are left ${left}, top ${top}, right ${right} and bottom ${bottom}. A box has its right edge at or after its left edge, and its bottom edge at or under its top edge`)
        }
        this.cx = (left + right) / 2
        this.cy = (top + bottom) / 2
        this.width = right - left
        this.height = bottom - top
    }

    /** The middle, the middle of an edge, or a corner, as `[x, y]`: `box.point('top right')`. For the end of a line or an arrow. */
    point(where: Where = 'center'): [number, number] {
        const [h, v] = sides(where, 'point')
        return [h < 0 ? this.left : h > 0 ? this.right : this.cx, v < 0 ? this.top : v > 0 ? this.bottom : this.cy]
    }

    /**
     * Cut into columns, from left to right. Give a count for equal columns, or the share of each one:
     * `area.columns(2)`, `area.columns([2, 1])`. The gap between two columns is wide by default.
     */
    columns(shares: number | readonly number[], gap: Gap = 'wide'): Box[] {
        return cut(shares, this.left, this.right, px(gap, 'columns'), 'columns', 'wider').map(([from, to]) => new Box(from, this.top, to, this.bottom))
    }

    /** Cut into rows, from top to bottom: `area.rows(3)`, `area.rows([3, 1])`. The gap between two rows is wide by default. */
    rows(shares: number | readonly number[], gap: Gap = 'wide'): Box[] {
        return cut(shares, this.top, this.bottom, px(gap, 'rows'), 'rows', 'higher').map(([from, to]) => new Box(this.left, from, this.right, to))
    }

    /** The region with a margin inside each edge: `panel.inset('normal')`. A second gap is for the top and the bottom. */
    inset(x: Gap, y: Gap = x): Box {
        return this.margin('inset', px(x, 'inset'), px(y, 'inset'))
    }

    /** The region with a margin outside each edge: `boxOf(queue).grow('tight')`. A second gap is for the top and the bottom. */
    grow(x: Gap, y: Gap = x): Box {
        return this.margin('grow', -px(x, 'grow'), -px(y, 'grow'))
    }

    private margin(what: string, dx: number, dy: number): Box {
        if (2 * dx >= this.width && dx > 0 || 2 * dy >= this.height && dy > 0) {
            throw new Error(`${what}: a margin of ${Math.abs(dx)} by ${Math.abs(dy)} leaves nothing of a region that is ${round(this.width)} wide and ${round(this.height)} high. Use a smaller gap, or a larger region`)
        }
        return new Box(this.left + dx, this.top + dy, this.right - dx, this.bottom - dy)
    }

    /**
     * The part of this region on one side of a thing: `area.beside(lanes, 'under')` is the room under the
     * lanes. The gap is between the thing and the new region, and it is normal by default. The new region
     * stays inside this one: a thing that is outside it cuts nothing off.
     */
    beside(other: Measured, side: BesideSide, gap: Gap = 'normal'): Box {
        checkSide(side, 'beside')
        const b = measure(other, 'beside', 'the thing'), g = px(gap, 'beside')
        const left = side === 'right' ? Math.max(this.left, b.right + g) : this.left, right = side === 'left' ? Math.min(this.right, b.left - g) : this.right
        const top = side === 'under' ? Math.max(this.top, b.bottom + g) : this.top, bottom = side === 'above' ? Math.min(this.bottom, b.top - g) : this.bottom
        if (right - left <= 0 || bottom - top <= 0) {
            const where = side === 'under' || side === 'above' ? side : `at the ${side} of`
            const missing = -Math.min(right - left, bottom - top)
            // A smaller gap works when the thing itself leaves room.
            const smaller = g > missing ? `Use a gap under ${round(g - missing)}, make` : 'Make'
            throw new Error(`beside: the region has no room ${where} ${describe(other)}: with a gap of ${g}, ${round(missing)} pixels are missing. ${smaller} the thing smaller, or move it away from that edge`)
        }
        return new Box(left, top, right, bottom)
    }
}

function cut(shares: number | readonly number[], from: number, to: number, gap: number, what: 'columns' | 'rows', larger: string): [number, number][] {
    const list = typeof shares === 'number' ? Array.from({ length: Number.isInteger(shares) && shares > 0 ? shares : 0 }, () => 1) : Array.isArray(shares) ? [...shares] : []
    if (list.length === 0 || !list.every((share) => Number.isFinite(share) && share > 0)) {
        throw new Error(`${what}: give a count such as 2, or the share of each part such as [2, 1], and it is ${typeof shares === 'number' || Array.isArray(shares) ? JSON.stringify(shares) : kindOf(shares)}`)
    }
    const room = to - from - gap * (list.length - 1)
    if (room <= 0) throw new Error(`${what}: ${list.length} ${what} with a gap of ${gap} need more than ${round(gap * (list.length - 1))} pixels, and the region has ${round(to - from)}. Use fewer ${what}, a smaller gap, or a ${larger} region`)
    const total = list.reduce((sum, share) => sum + share, 0)
    const out: [number, number][] = []
    let at = from
    for (const share of list) {
        const size = room * share / total
        out.push([at, at + size])
        at += size + gap
    }
    return out
}

function sides(where: Where, what: string): [number, number] {
    const words = typeof where === 'string' ? where.split(' ') : []
    const known = ['center', 'left', 'right', 'top', 'bottom']
    const twice = (words.includes('left') && words.includes('right')) || (words.includes('top') && words.includes('bottom')) || words[0] === words[1]
    if (words.length === 0 || words.length > 2 || words.some((word) => !known.includes(word)) || twice) {
        throw new Error(`${what}: no place ${typeof where === 'string' ? JSON.stringify(where) : kindOf(where)}. A place is center, an edge such as top, or a corner such as top left`)
    }
    return [words.includes('left') ? -1 : words.includes('right') ? 1 : 0, words.includes('top') ? -1 : words.includes('bottom') ? 1 : 0]
}

function checkSide(side: BesideSide, what: string): void {
    if (!['left', 'right', 'above', 'under'].includes(side)) throw new Error(`${what}: the side is left, right, above or under, and it is ${typeof side === 'string' ? JSON.stringify(side) : kindOf(side)}`)
}

/** What a container knows about the block that it made, for the message of an item that does not fit. */
interface Made {
    /** The pixels of the gaps between the items, from left to right and from top to bottom. */
    gapsX: number
    gapsY: number
    /** For a grid: its cells in order, and how it was made. */
    grid?: { cells: readonly (LayoutItem | null)[]; columns: number; gx: number; gy: number; even: boolean }
}
const MADE = new WeakMap<Block, Made>()

/**
 * Nodes that a container laid out. It is a value, not a node: the container moved its nodes, and the block
 * gives their measure. Put it in another container, in `place` or in `beside`, and give it to `s.add` and
 * to `c.show`: there it stands for its nodes.
 */
export class Block {
    constructor(
        readonly items: readonly LayoutItem[],
        /** The container that made the block. A message about a block that does not fit names it. */
        readonly kind: 'row' | 'column' | 'grid' = 'row',
    ) {
        if (!Array.isArray(items)) throw new Error(`Block: the items are a list, and the first argument is ${kindOf(items)}`)
        items.forEach((item, index) => checkItem('Block', item, `item ${index}`))
    }

    /** Every node of the block, in order. */
    get nodes(): Node[] {
        return nodesOf(this.items)
    }

    /** The measure of the block now. */
    get box(): Box {
        return boxOf(this.items)
    }
}

/** Stop when a value is not an item of the layout. A list may hold a value that is not there, such as `tag && chip(tag)`. */
function checkItem(what: string, item: unknown, name: string): void {
    if (item instanceof Node || item instanceof Block) return
    if (Array.isArray(item) && !isPoint(item)) {
        item.forEach((part, index) => { if (part) checkItem(what, part, `${name}[${index}]`) })
        return
    }
    const hint = typeof item === 'string' ? '. Make a node from the words, with `label` of the kit or with `text`'
        : item instanceof Box || isPoint(item) ? '. A region and a point have no place to change: put a node there with `place` or `beside`'
        : ''
    throw new Error(`${what}: ${name} is ${isPoint(item) ? `the point [${item[0]}, ${item[1]}]` : kindOf(item)}. An item is a node, a block that a container returned, or a list of them${hint}`)
}

function nodesOf(item: LayoutItem): Node[] {
    if (item instanceof Node) return [item]
    if (item instanceof Block) return item.nodes
    return item.flatMap((part) => (part ? nodesOf(part) : []))
}

/**
 * The nodes of what a call of the library takes as a node or as a list of nodes. A block of the layout
 * stands for its nodes there. A value of another kind stops with the name of the call and of the argument.
 */
export function nodesFor(what: string, target: unknown, name = 'the target'): Node[] {
    if (target instanceof Node) return [target]
    if (target instanceof Block) return target.nodes
    if (Array.isArray(target) && !isPoint(target)) return target.flatMap((item, index) => nodesFor(what, item, `${name}[${index}]`))
    throw new Error(`${what}: ${name} is ${isPoint(target) ? `the point [${target[0]}, ${target[1]}]` : kindOf(target)}. Give a node, a block of the layout, or a list of them`)
}

/**
 * The node of a call that takes one node, such as the two ends of a connector. A block is many nodes, so
 * the message says what to give in its place.
 */
export function oneNode(what: string, value: unknown, name = 'the node'): Node {
    if (value instanceof Node) return value
    if (value instanceof Block) throw new Error(`${what}: ${name} is a block of the layout, and here ${what} takes one node. Give one node of the block, such as block.nodes[0], or the block as one group: group(block)`)
    throw new Error(`${what}: ${name} is ${isPoint(value) ? `the point [${value[0]}, ${value[1]}]` : kindOf(value)}. Give a node`)
}

/** Stop when a call that takes a node or a point of the stage gets a block, or a value that is neither. */
export function nodeOrPoint(what: string, value: unknown, name: string): Node | Vec {
    if (value instanceof Node || (isPoint(value) && Number.isFinite(value[0]) && Number.isFinite(value[1]))) return value
    if (value instanceof Block) throw new Error(`${what}: ${name} is a block of the layout, and here ${what} takes one node or a point. Give one node of the block, such as block.nodes[0], or a point of its box, such as boxOf(block).point('right')`)
    throw new Error(`${what}: ${name} is ${isPoint(value) ? `the point [${value[0]}, ${value[1]}]` : kindOf(value)}. Give a node, or a point [x, y] of the stage`)
}

/** Stop when a call that takes one object of a kind, such as a pair of axes, gets a block or another value. */
export function oneObject<T extends Node>(what: string, value: unknown, name: string, kind: abstract new (...args: never[]) => T, words: string): T {
    if (value instanceof kind) return value
    throw new Error(`${what}: ${name} is ${value instanceof Block ? 'a block of the layout' : value instanceof Node ? 'a node of another kind' : kindOf(value)}. Give ${words}`)
}

/**
 * Stop when one node is in a layout two times: as two items, or as a group and a part of that group. The
 * layout would move it two times, off its place.
 */
function distinct(what: string, item: LayoutItem, holder: string): void {
    const nodes = nodesOf(item), seen = new Set<Node>()
    for (const node of nodes) {
        if (seen.has(node)) throw new Error(`${what}: ${describe(node)} is in ${holder} two times. A node has one place. Give it one time, or give a copy of it: node.clone()`)
        seen.add(node)
    }
    for (const node of nodes) {
        for (let up = node.parent; up; up = up.parent) {
            if (seen.has(up)) throw new Error(`${what}: ${describe(node)} is a part of ${describe(up)}, and ${holder} has both. A group moves its parts, so the part would move two times. Give the group, or the part`)
        }
    }
}

/**
 * The measure of a thing, in stage pixels: `boxOf(chip).right`. A text measures as its line box: its advance
 * width, and 1.2 text sizes for each line, around the middle of its capital letters. So a column of lines
 * has an even pitch, whatever letters they hold. A pictogram measures as the square of its grid. Every other
 * node measures as its bounds, with the parts that are hidden now: a scene lays a picture out before its
 * parts arrive. So `boxOf(group(rect(100, 60), rect(300, 300).hide()))` is 300 by 300, where `bounds()`
 * gives 100 by 60.
 */
export function boxOf(thing: Measured): Box {
    return measure(thing, 'boxOf', 'the thing')
}

/** `boxOf`, with the name of the call and of the argument in the message of a value that has no measure. */
function measure(thing: Measured, what: string, name: string): Box {
    if (thing instanceof Box) return thing
    if (thing instanceof Block) return thing.box
    if (thing instanceof Node) return nodeBox(thing, what)
    if (!Array.isArray(thing)) throw new Error(`${what}: ${name} is ${kindOf(thing)}, which has no measure. Give a node, a block, a region, a point [x, y], or a list of them`)
    if (isPoint(thing)) {
        if (!(Number.isFinite(thing[0]) && Number.isFinite(thing[1]))) throw new Error(`${what}: ${name} is the point [${thing[0]}, ${thing[1]}], which is not a place. Each number of a point is finite. A value that is not a number comes from a division by 0, or from a value that is missing`)
        return new Box(thing[0], thing[1], thing[0], thing[1])
    }
    const boxes = (thing as readonly (LayoutItem | Box)[]).filter(Boolean).map((part, index) => measure(part, what, `${name}[${index}]`))
    if (boxes.length === 0) throw new Error(`${what}: ${name} is an empty list, which has no measure. Give it at least one node`)
    return new Box(Math.min(...boxes.map((b) => b.left)), Math.min(...boxes.map((b) => b.top)), Math.max(...boxes.map((b) => b.right)), Math.max(...boxes.map((b) => b.bottom)))
}

function nodeBox(node: Node, what: string): Box {
    let edges: [number, number, number, number]
    // A node gives the box that the layout measures, in its own coordinates: a text gives its line box, and
    // a pictogram gives the square of its grid.
    const own = node.layoutBox
    if (own) {
        const m = node.worldMatrix()
        const corners = [apply(m, own[0], own[1]), apply(m, own[2], own[1]), apply(m, own[2], own[3]), apply(m, own[0], own[3])]
        const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1])
        edges = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    } else {
        const b = everyBounds(node, node.parent ? node.parent.worldMatrix() : IDENTITY) ?? { x: 0, y: 0, width: 0, height: 0 }
        edges = [b.x, b.y, b.x + b.width, b.y + b.height]
    }
    if (!edges.every((edge) => Number.isFinite(edge))) {
        throw new Error(`${what}: ${describe(node, false)} has a place or a size that is not a number, so it has no measure. Look at the values of its .at(), .shift() and .scale(): one comes from a division by 0, or from a value that is missing`)
    }
    return new Box(...edges)
}

/**
 * The bounds of a node and of all that is under it, shown or hidden. A scene builds a picture and hides
 * parts of it until the voice names them, and an object such as `lanes` hides its events until its cursor
 * reaches them. The layout gives each part its place before that, so it measures the hidden parts too.
 * `Node.bounds()` leaves them out. With `lines`, each outline has half of the width of its line around it, as
 * it is drawn.
 */
function everyBounds(node: Node, parent: Mat, lines = false): Bounds | null {
    const m = mul(parent, node.localMatrix())
    let result: Bounds | null = null
    const path = node.get('path')
    if (path) {
        result = pathBounds(transformPath(path, m))
        const out = lines && node.get('stroke') ? node.get('strokeWidth') / 2 * Math.hypot(m[0], m[1]) : 0
        if (result && out > 0) result = { x: result.x - out, y: result.y - out, width: result.width + 2 * out, height: result.height + 2 * out }
    }
    const image = node.get('image')
    if (image) {
        const corners = [apply(m, 0, 0), apply(m, image.width, 0), apply(m, image.width, image.height), apply(m, 0, image.height)]
        const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1])
        result = unionBounds(result, { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) })
    }
    // A drawing that is rebuilt on each frame measures as it is now, as `bounds()` measures it.
    if (node.draw) {
        const b = node.bounds()
        if (b.width > 0 || b.height > 0) result = unionBounds(result, b)
    }
    for (const child of node.children) result = unionBounds(result, everyBounds(child, m, lines))
    return result
}

/** The name that an object has for a message of the film check, such as "event log". */
const objectOf = (node: Node): string | undefined => node.data['object'] as string | undefined

/**
 * A few words that tell an author which thing a message is about: its container or its kind, and its first
 * text, its name, or its place and its size. `c.show` names a node with it too.
 */
export function describe(thing: Measured, measured = true): string {
    if (thing instanceof Box) return 'the region'
    if (isPoint(thing)) return `the point [${thing[0]}, ${thing[1]}]`
    const nodes = (thing instanceof Node || thing instanceof Block ? [thing] : (thing as readonly (LayoutItem | Box)[]).filter((part): part is LayoutItem => Boolean(part) && !(part instanceof Box))).flatMap((part) => nodesOf(part))
    const one = nodes.length === 1 ? nodes[0]! : null
    const kind = thing instanceof Block ? `the ${thing.kind}` : !one ? `the list of ${nodes.length} nodes` : one instanceof TextNode ? 'the text' : objectOf(one) ? `the ${objectOf(one)}` : 'the item'
    for (const node of nodes) {
        for (const part of node.all()) {
            const source = (part as { source?: unknown }).source
            if (typeof source !== 'string' || !source.trim()) continue
            const words = JSON.stringify(source.length > 48 ? `${source.slice(0, 48)}...` : source)
            return kind === 'the text' ? `the text ${words}` : `${kind} with the text ${words}`
        }
    }
    const name = nodes.map((node) => node.label).find(Boolean)
    if (name) return `${kind} "${name}"`
    if (!measured || nodes.length === 0) return kind
    const b = measure(nodes, 'describe', 'the thing')
    return `${kind} at (${Math.round(b.cx)}, ${Math.round(b.cy)}), ${round(b.width)} wide and ${round(b.height)} high`
}

function move(item: LayoutItem, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return
    if (item instanceof Block) return move(item.items, dx, dy)
    if (!(item instanceof Node)) {
        for (const part of item) if (part) move(part, dx, dy)
        return
    }
    // A stage distance, in the coordinates of the parent of the node.
    const inverse = item.parent ? invert(item.parent.worldMatrix()) : IDENTITY
    const [x0, y0] = apply(inverse, 0, 0), [x1, y1] = apply(inverse, dx, dy)
    item.shift(x1 - x0, y1 - y0)
}

/**
 * The room between two things that do not overlap: `between(guestBoxes, hostBoxes)`. For two things one over
 * the other, it is as wide as both. For two things side by side, it is as high as both.
 */
export function between(a: Measured, b: Measured): Box {
    const one = measure(a, 'between', 'the first thing'), other = measure(b, 'between', 'the second thing')
    const left = Math.min(one.left, other.left), right = Math.max(one.right, other.right), top = Math.min(one.top, other.top), bottom = Math.max(one.bottom, other.bottom)
    if (one.bottom <= other.top) return new Box(left, one.bottom, right, other.top)
    if (other.bottom <= one.top) return new Box(left, other.bottom, right, one.top)
    if (one.right <= other.left) return new Box(one.right, top, other.left, bottom)
    if (other.right <= one.left) return new Box(other.right, top, one.left, bottom)
    throw new Error(`between: ${describe(a)} and ${describe(b)} overlap, so there is no room between them. Lay them out first, with a gap, and then ask for the room`)
}

/**
 * Build an object so that all of it is as wide as a region: `fitted(band, (width) => lanes(names, events, { width }))`.
 * An object such as `lanes` takes the width of its plot, and draws names and labels beside the plot. This
 * builds the object one time to measure what is beside the plot, and again with the width that is left.
 */
export function fitted<T extends Node>(region: Measured | number, build: (width: number) => T): T {
    const target = typeof region === 'number' ? region : measure(region, 'fitted', 'the region').width
    if (!(Number.isFinite(target) && target > 0)) throw new Error(`fitted: the region is ${target} wide. Give a region, or a width that is more than 0`)
    if (typeof build !== 'function') throw new Error(`fitted: the second argument is a function that builds the object from a width, such as (width) => lanes(names, events, { width }), and it is ${kindOf(build)}`)
    const made = (width: number): T => {
        const object = build(width)
        if (!(object instanceof Node)) throw new Error(`fitted: the function returned ${kindOf(object)}. It returns the object that it builds, which is a node`)
        return object
    }
    let width = target, object = made(width)
    // The parts beside the plot can change a little with the width, so more passes settle it.
    for (let pass = 0; pass < 3; pass++) {
        const over = boxOf(object).width - target
        if (Math.abs(over) < FIT) return object
        width -= over
        if (width <= 0) {
            // An object that is as wide at half of the width does not take its width from the function.
            if (Math.abs(boxOf(made(target / 2)).width - boxOf(object).width) < FIT) {
                throw new Error(`fitted: the object is ${round(boxOf(object).width)} wide for each width that the function gets, and the region is ${round(target)} wide. Give the width to the object, as in (width) => lanes(names, events, { width }), or place an object that has one size with \`place\``)
            }
            throw new Error(`fitted: the parts beside the plot are ${round(target - width)} wide, and the region is ${round(target)} wide, so no width is left for the plot. Give a region that is wider than ${round(target - width)}, or make the parts beside the plot narrower, such as shorter names`)
        }
        object = made(width)
    }
    return object
}

/** The room that a text needs beside a mark, as a part of its size: the room that `vizmatic check --text-gap 0.3` asks for. */
const TEXT_ROOM = 0.3
/** Pixels over that room, so that the rounding of a measure does not put a text under it. */
const TEXT_SPARE = 0.5

/** The texts among the nodes of a thing, at any depth of blocks and lists. A text inside an object is a label of that object. */
function textsOf(thing: Measured): TextNode[] {
    if (thing instanceof Box || isPoint(thing)) return []
    return (thing instanceof Node || thing instanceof Block ? [thing] : (thing as readonly (LayoutItem | Box)[]).filter((part): part is LayoutItem => Boolean(part) && !(part instanceof Box)))
        .flatMap((part) => nodesOf(part)).filter((node): node is TextNode => node instanceof TextNode)
}

/**
 * The box of a text for the room beside it. From left to right it is the line box of the text. From top to
 * bottom it goes from the top of the highest letter of the font to the bottom of the lowest one, at the size
 * of the text. So two texts of one font and one size have the same room on each side, whatever their letters,
 * and a named gap is even from row to row. The box always holds the ink, which is what the film check
 * measures: a sign that passes those lines, such as a capital with an accent, moves the edge to itself.
 */
function roomBox(node: TextNode): Box {
    const line = boxOf(node), ink = everyBounds(node, node.parent ? node.parent.worldMatrix() : IDENTITY)
    const m = node.worldMatrix()
    // A text that is turned has no line over and under it: its line box is the measure.
    const upright = Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[3] > 0
    const top = upright ? apply(m, 0, node.letters[0])[1] : line.top, bottom = upright ? apply(m, 0, node.letters[1])[1] : line.bottom
    if (!ink) return new Box(line.left, Math.min(top, bottom), line.right, Math.max(top, bottom))
    return new Box(Math.min(line.left, ink.x), Math.min(top, ink.y), Math.max(line.right, ink.x + ink.width), Math.max(bottom, ink.y + ink.height))
}

/** The box that a mark draws: its outlines, each with half of the width of its line around it. */
function drawnBox(node: Node): Box {
    const b = everyBounds(node, node.parent ? node.parent.worldMatrix() : IDENTITY, true)
    return b ? new Box(b.x, b.y, b.x + b.width, b.y + b.height) : boxOf(node)
}

/** The boxes of the marks of a thing: its nodes that are not a text, as they are drawn. A region and a point are a mark at their edge. */
function marksOf(thing: Measured): Box[] {
    if (thing instanceof Box || isPoint(thing)) return [measure(thing, 'gap', 'the thing')]
    return (thing instanceof Node || thing instanceof Block ? [thing] : (thing as readonly (LayoutItem | Box)[]).filter(Boolean))
        .flatMap((part) => (part instanceof Box ? [part] : nodesOf(part).filter((node) => !(node instanceof TextNode)).map((node) => drawnBox(node))))
}

/**
 * The gap between two things, in pixels. `first` is at the left of `second`, or over it. A named gap from
 * tight to loose is never under the room that a text needs: each text that faces the gap, at any depth of
 * blocks and lists, gets 0.3 of its size to the nearest mark of the other thing. The room is from the box of
 * the letters of its font, so it is the same for every text of that font and size, and it is never less than
 * the room from the ink, which the film check measures. Two texts with no mark between them are words of one
 * line, and get the gap as named. `none` and a number are exact.
 */
function gapBetween(gap: Gap, what: string, first: Measured, second: Measured, axis: 'x' | 'y'): number {
    const base = px(gap, what)
    if (typeof gap === 'number' || gap === 'none') return base
    const far = (b: Box) => (axis === 'x' ? b.right : b.bottom), near = (b: Box) => (axis === 'x' ? b.left : b.top)
    const one = measure(first, what, 'the thing'), other = measure(second, what, 'the thing')
    const room = (node: TextNode) => { const m = node.worldMatrix(); return TEXT_ROOM * node.size * Math.hypot(m[0], m[1]) + TEXT_SPARE }
    // How far inside each thing its nearest mark is, from the edge that faces the gap. A wide line is a little outside.
    const markInFirst = Math.min(Infinity, ...marksOf(first).map((b) => far(one) - far(b))), markInSecond = Math.min(Infinity, ...marksOf(second).map((b) => near(b) - near(other)))
    let least = base
    for (const node of textsOf(first)) least = Math.max(least, room(node) - (far(one) - far(roomBox(node))) - markInSecond)
    for (const node of textsOf(second)) least = Math.max(least, room(node) - (near(roomBox(node)) - near(other)) - markInFirst)
    return least
}

/** An item that a scene may leave out: `extra && chip(extra)`. A container skips each value that is not an item. */
export type Maybe<T> = T | null | undefined | false | '' | 0

export interface RowOptions {
    /** Between two items. Defaults to normal. */
    gap?: Gap
    /**
     * Where the items are from top to bottom. `baseline`, the default: the middles are on one line, and the
     * texts stand on one base line, as type does. `center`: the middles of the boxes. `top` and `bottom`: one edge.
     */
    align?: 'baseline' | 'top' | 'center' | 'bottom'
}

export interface ColumnOptions {
    /** Between two items. Defaults to normal. */
    gap?: Gap
    /** The edge that the items share, or `center` for their middles. Defaults to left. */
    align?: 'left' | 'center' | 'right'
}

/** The items of a container, checked, without the values that are not there. */
function itemsOf(what: string, items: unknown): LayoutItem[] {
    if (!Array.isArray(items)) throw new Error(`${what}: the items are one list, such as ${what}([a, b]), and the first argument is ${kindOf(items)}`)
    items.forEach((item, index) => { if (item) checkItem(what, item, `item ${index}`) })
    return items.filter(Boolean) as LayoutItem[]
}

/**
 * The y of the base line of an item, in stage pixels: of a text, or of the first text of a row. An item with
 * no base line, or with a text that is turned, lines up by its box.
 */
function baseOf(item: LayoutItem): number | null {
    if (item instanceof TextNode) {
        const m = item.worldMatrix()
        return Math.abs(m[1]) > 1e-9 ? null : apply(m, 0, item.baseline)[1]
    }
    if (item instanceof Block && item.kind === 'row') {
        for (const part of item.items) {
            const base = baseOf(part)
            if (base !== null) return base
        }
    }
    return null
}

/**
 * Where each item of one line goes from top to bottom: the distance from the top of the line to the top of
 * each item, and the height of the line. With `baseline`, the texts stand on one base line, and that group
 * of texts has its middle on the line of the middles of the other items.
 */
function lineUp(items: readonly LayoutItem[], boxes: readonly Box[], align: 'baseline' | 'top' | 'center' | 'bottom'): { tops: number[]; height: number } {
    const heights = boxes.map((b) => b.height), height = Math.max(...heights)
    if (align === 'top') return { tops: heights.map(() => 0), height }
    if (align === 'bottom') return { tops: heights.map((h) => height - h), height }
    const middles = heights.map((h) => (height - h) / 2)
    if (align === 'center') return { tops: middles, height }
    const bases = items.map((item) => baseOf(item))
    const texts = bases.flatMap((base, index) => (base === null ? [] : [index]))
    if (texts.length < 2) return { tops: middles, height }
    const up = Math.max(...texts.map((i) => bases[i]! - boxes[i]!.top)), down = Math.max(...texts.map((i) => boxes[i]!.bottom - bases[i]!))
    const all = Math.max(height, up + down), line = (all - (up + down)) / 2 + up
    return { tops: heights.map((h, i) => (bases[i] === null ? (all - h) / 2 : line - (bases[i]! - boxes[i]!.top))), height: all }
}

/**
 * Lay items out from left to right, such as `row([icon, name, chip('virtio')], { gap: 'tight' })`. It measures
 * each item. The middles are on one line, and texts of any size stand on one base line. It returns a block
 * around the middle of the stage: `place` and `beside` move it.
 */
export function row(items: readonly Maybe<LayoutItem>[], options: RowOptions = {}): Block {
    const list = itemsOf('row', items)
    const { gap = 'normal', align = 'baseline' } = optionsOf<RowOptions>('row', options, ['gap', 'align'], "{ gap: 'tight' }")
    if (list.length === 0) throw new Error('row: give it at least one item')
    if (!['baseline', 'top', 'center', 'bottom'].includes(align)) throw new Error(`row: align is baseline, top, center or bottom, and it is ${JSON.stringify(align)}`)
    // The gap is checked with one item too: a wrong name must not pass until the list grows.
    px(gap, 'row')
    distinct('row', list, 'the row')
    const boxes = list.map((item, index) => measure(item, 'row', `item ${index}`))
    const gaps = list.slice(1).map((item, index) => gapBetween(gap, 'row', list[index]!, item, 'x'))
    const { tops, height } = lineUp(list, boxes, align)
    // The block is made around the middle of the stage. `place` and `beside` move it from there.
    let at = -(boxes.reduce((sum, b) => sum + b.width, 0) + gaps.reduce((sum, g) => sum + g, 0)) / 2
    list.forEach((item, index) => {
        const b = boxes[index]!
        move(item, at - b.left, -height / 2 + tops[index]! - b.top)
        at += b.width + (gaps[index] ?? 0)
    })
    const made = new Block(list, 'row')
    MADE.set(made, { gapsX: gaps.reduce((sum, g) => sum + g, 0), gapsY: 0 })
    return made
}

/**
 * Lay items out from top to bottom, such as `column([title, rows, note], { gap: 'wide' })`. The left edges are
 * on one line by default. A row, a column and a grid nest: an item can be a block.
 */
export function column(items: readonly Maybe<LayoutItem>[], options: ColumnOptions = {}): Block {
    const list = itemsOf('column', items)
    const { gap = 'normal', align = 'left' } = optionsOf<ColumnOptions>('column', options, ['gap', 'align'], "{ gap: 'tight' }")
    if (list.length === 0) throw new Error('column: give it at least one item')
    if (!['left', 'center', 'right'].includes(align)) throw new Error(`column: align is left, center or right, and it is ${JSON.stringify(align)}`)
    px(gap, 'column')
    distinct('column', list, 'the column')
    const boxes = list.map((item, index) => measure(item, 'column', `item ${index}`))
    const gaps = list.slice(1).map((item, index) => gapBetween(gap, 'column', list[index]!, item, 'y'))
    const width = Math.max(...boxes.map((b) => b.width))
    let at = -(boxes.reduce((sum, b) => sum + b.height, 0) + gaps.reduce((sum, g) => sum + g, 0)) / 2
    list.forEach((item, index) => {
        const b = boxes[index]!
        const start = align === 'left' ? -width / 2 : align === 'right' ? width / 2 - b.width : -b.width / 2
        move(item, start - b.left, at - b.top)
        at += b.height + (gaps[index] ?? 0)
    })
    const made = new Block(list, 'column')
    MADE.set(made, { gapsX: 0, gapsY: gaps.reduce((sum, g) => sum + g, 0) })
    return made
}

export interface GridOptions {
    /** The count of columns. The items fill the grid row by row. */
    columns: number
    /** Between two cells. One gap, or the gap between columns and the gap between rows. Defaults to normal. */
    gap?: Gap | readonly [Gap, Gap]
    /** Where an item sits in its cell, from left to right. One value, or one for each column. Defaults to left. */
    align?: 'left' | 'center' | 'right' | readonly ('left' | 'center' | 'right')[]
    /** Give every row the height of the highest one, so that the rows have one pitch. Without it, a row is as high as its own items. */
    even?: boolean
}

/** The widths of the columns and the heights of the rows of a grid, and its size, from the boxes of its cells. */
function gridSize(cells: readonly (Box | null)[], columns: number, gx: number, gy: number, even: boolean): { widths: number[]; heights: number[]; width: number; height: number } {
    const rows = Math.ceil(cells.length / columns)
    const widths = Array.from({ length: columns }, (_, c) => Math.max(0, ...cells.filter((cell, i) => cell && i % columns === c).map((cell) => cell!.width)))
    const own = Array.from({ length: rows }, (_, r) => Math.max(0, ...cells.slice(r * columns, (r + 1) * columns).map((cell) => (cell ? cell.height : 0))))
    const heights = even ? own.map(() => Math.max(...own)) : own
    return { widths, heights, width: widths.reduce((sum, w) => sum + w, 0) + gx * (columns - 1), height: heights.reduce((sum, h) => sum + h, 0) + gy * (rows - 1) }
}

/**
 * Lay items out in a table, such as `grid([icon, name, null, note], { columns: 2 })`. A column is as wide as
 * its widest item, and a row is as high as its highest. An empty cell is null. In one row, the middles are
 * on one line, and texts of any size stand on one base line.
 */
export function grid(items: readonly Maybe<LayoutItem>[], options: GridOptions): Block {
    if (!Array.isArray(items)) throw new Error(`grid: the items are one list, such as grid([a, b, c, d], { columns: 2 }), and the first argument is ${kindOf(items)}`)
    const given = optionsOf<GridOptions>('grid', options ?? {}, ['columns', 'gap', 'align', 'even'], '{ columns: 2 }')
    const columns = given.columns
    if (!(Number.isInteger(columns) && columns > 0)) throw new Error(`grid: columns is the count of columns, a whole number of 1 or more, and it is ${typeof columns === 'number' || columns === undefined ? String(columns) : kindOf(columns)}`)
    items.forEach((item, index) => { if (item) checkItem('grid', item, `item ${index}`) })
    if (items.length === 0 || !items.some(Boolean)) throw new Error('grid: give it at least one item')
    const one = (given.gap ?? 'normal') as Gap
    const [nameX, nameY] = Array.isArray(given.gap) ? given.gap as readonly [Gap, Gap] : [one, one]
    px(nameX, 'grid')
    px(nameY, 'grid')
    const aligns = Array.isArray(given.align) ? given.align as readonly string[] : Array.from({ length: columns }, () => (given.align ?? 'left') as string)
    if (aligns.length !== columns) throw new Error(`grid: align is a list of ${aligns.length}, and the grid has ${columns} columns. Give one value for all columns, or a list with one value for each column`)
    for (const align of aligns) {
        if (!['left', 'center', 'right'].includes(align)) throw new Error(`grid: align is left, center or right, and it is ${JSON.stringify(align)}`)
    }
    const cells = items.map((item) => (item ? item : null))
    distinct('grid', cells.filter((cell): cell is LayoutItem => cell !== null), 'the grid')
    const boxes = cells.map((cell, index) => (cell ? measure(cell, 'grid', `item ${index}`) : null))
    const rows = Math.ceil(cells.length / columns)
    // One gap for all columns and one for all rows: the largest that two cells that are neighbors need.
    const across = cells.map((cell, i) => (cell && cells[i + 1] && (i + 1) % columns !== 0 ? gapBetween(nameX, 'grid', cell, cells[i + 1]!, 'x') : px(nameX, 'grid')))
    const down = cells.map((cell, i) => (cell && cells[i + columns] ? gapBetween(nameY, 'grid', cell, cells[i + columns]!, 'y') : px(nameY, 'grid')))
    const gx = Math.max(...across), gy = Math.max(...down)
    // Each row lines its items up as a row does. Texts of two sizes on one base line can need a little more height.
    const lines = Array.from({ length: rows }, (_, r) => {
        const at = cells.map((_, i) => i).slice(r * columns, (r + 1) * columns).filter((i) => cells[i])
        return at.length === 0 ? { at, tops: [] as number[], height: 0 } : { at, ...lineUp(at.map((i) => cells[i]!), at.map((i) => boxes[i]!), 'baseline') }
    })
    const { widths } = gridSize(boxes, columns, gx, gy, false)
    const highest = Math.max(...lines.map((line) => line.height))
    const heights = lines.map((line) => (given.even ? highest : line.height))
    const lefts: number[] = [], tops: number[] = []
    let at = -(widths.reduce((sum, w) => sum + w, 0) + gx * (columns - 1)) / 2
    for (const width of widths) { lefts.push(at); at += width + gx }
    at = -(heights.reduce((sum, h) => sum + h, 0) + gy * (rows - 1)) / 2
    for (const height of heights) { tops.push(at); at += height + gy }
    lines.forEach((line, r) => line.at.forEach((index, k) => {
        const c = index % columns, box = boxes[index]!, align = aligns[c]!
        const x = align === 'left' ? lefts[c]! : align === 'right' ? lefts[c]! + widths[c]! - box.width : lefts[c]! + (widths[c]! - box.width) / 2
        move(cells[index]!, x - box.left, tops[r]! + (heights[r]! - line.height) / 2 + line.tops[k]! - box.top)
    }))
    const made = new Block(cells.filter((cell): cell is LayoutItem => cell !== null), 'grid')
    MADE.set(made, { gapsX: gx * (columns - 1), gapsY: gy * (rows - 1), grid: { cells, columns, gx, gy, even: given.even === true } })
    return made
}

/**
 * The changes that make an item fit its region in one direction, for the message of `place`. Each change is
 * checked against the measures of this call, so the message names only the changes that work. `why` gets a
 * sentence about the measure of a text.
 */
function waysToFit(item: LayoutItem, region: Box, axis: 'x' | 'y', why: string[]): string[] {
    const along = (b: Box) => (axis === 'x' ? b.width : b.height)
    const word = axis === 'x' ? 'wide' : 'high'
    const room = along(region), own = along(boxOf(item)), over = own - room
    if (item instanceof Block) {
        const ways: string[] = []
        const made = MADE.get(item), sizes = item.items.map((part) => along(boxOf(part)))
        const largest = Math.max(...sizes), which = item.items[sizes.indexOf(largest)]!
        const gaps = made ? (axis === 'x' ? made.gapsX : made.gapsY) : 0
        if (gaps > 0 && gaps >= over) ways.push(`a smaller gap (the gaps take ${round(gaps)} of the ${round(own)})`)
        if (made?.grid) {
            const g = made.grid, boxes = g.cells.map((cell) => (cell ? boxOf(cell) : null))
            // Fewer columns for a grid that is too wide, and more columns for a grid that is too high.
            const counts = axis === 'x' ? Array.from({ length: g.columns - 1 }, (_, i) => g.columns - 1 - i) : Array.from({ length: Math.max(0, g.cells.length - g.columns) }, (_, i) => g.columns + 1 + i)
            const found = counts.find((columns) => {
                const size = gridSize(boxes, columns, g.gx, g.gy, g.even)
                return size.width <= region.width + FIT && size.height <= region.height + FIT
            })
            if (found !== undefined) ways.push(`${axis === 'x' ? 'fewer' : 'more'} columns (\`columns: ${found}\` fits)`)
        } else if ((item.kind === 'row') === (axis === 'x') && item.items.length > 1) {
            ways.push(`fewer items in the ${item.kind}`)
        }
        // One item that is too large alone: no change of the container helps, and the item has its own changes.
        if (largest > room + FIT) {
            why.push(`${describe(which).replace(/^t/, 'T')} alone is ${round(largest)} ${word}`)
            return waysToFit(which, region, axis, why)
        }
        return ways
    }
    if (item instanceof TextNode) {
        const ways: string[] = []
        const m = item.worldMatrix(), scale = Math.hypot(m[0], m[1]) || 1
        const lineBox = item.layoutBox ? (item.layoutBox[3] - item.layoutBox[1]) * scale : own, oneLine = LINE_BOX * item.size * scale
        const lines = lineBox - oneLine > 1 ? 'more' : 'one'
        if (axis === 'y') {
            why.push(`A text measures ${LINE_BOX} of its size for each line: one line of size ${round(item.size)} is ${round(oneLine)} high`)
            if (lines === 'more' && oneLine <= room + FIT) ways.push('fewer lines (fewer words, or a larger `maxWidth`)')
        } else {
            // A text that wraps at the width of the region gets higher. Name it when the region has the height.
            const words = item.source.trim().split(/\s+/)
            const longest = Math.max(...words.map((part) => part.length)) / Math.max(1, item.source.trim().length) * own
            const wrapped = Math.ceil(own / room) * LEADING * item.size * scale + oneLine
            if (lines === 'one' && words.length > 1 && longest <= room && wrapped <= region.height + FIT) ways.push(`lines that wrap at ${Math.floor(room)} or less (\`maxWidth\` of \`text\`, or the width of \`para\`)`)
            if (words.length > 1) ways.push('fewer words')
        }
        ways.push(`a text size of ${Math.floor(item.size * room / own)} or less (it is ${round(item.size)})`)
        return ways
    }
    return [`a ${axis === 'x' ? 'width' : 'height'} of ${round(room)} or less`]
}
/** The height of the line box of one line, and the default distance between two base lines, in text sizes. */
const LINE_BOX = 1.2, LEADING = 1.3

/** What works for an item that does not fit, as the end of the message of `place`. */
function advice(item: LayoutItem, region: Box, wide: boolean, high: boolean): string {
    const own = boxOf(item), why: string[] = []
    const say = (axis: 'x' | 'y') => {
        const larger = axis === 'x' ? `a region that is ${round(own.width)} wide or more` : `a region that is ${round(own.height)} high or more`
        const ways = [...new Set([...waysToFit(item, region, axis, why), larger])]
        return `${ways.slice(0, -1).join(', ')}${ways.length > 1 ? ', or ' : ''}${ways[ways.length - 1]}`
    }
    const works = wide && high ? `What works for the width: ${say('x')}. What works for the height: ${say('y')}` : `What works: ${say(wide ? 'x' : 'y')}`
    return [...new Set(why), works].join('. ')
}

/** What the layout knows about a node that it placed, for the check of the frame at the end of the build. */
interface Placed {
    what: string
    /** The time of the film at which the layout placed the node. */
    time: number
    advice: (edges: readonly string[]) => string
}
const PLACED = new WeakMap<object, Map<Node, Placed>>()

/** The edges of the frame that a box passes, each with the distance. Half a pixel is not off the frame. */
function offFrame(box: Box, width: number, height: number): [string, number][] {
    const all: [string, number][] = [['left', -width / 2 - box.left], ['right', box.right - width / 2], ['top', -height / 2 - box.top], ['bottom', box.bottom - height / 2]]
    return all.filter(([, by]) => by > FIT)
}

/** When a node is on the stage for the first time: the latest first time of the node and of each group that holds it. */
function shownFrom(node: Node): number {
    let time = 0
    for (let up: Node | null = node; up; up = up.parent) {
        const visible = up.tracks?.get('visible')
        if (!visible) continue
        const first = visible.initial === true ? 0 : visible.keys.find((key) => key.to === true)?.t0 ?? Infinity
        time = Math.max(time, first)
    }
    return time
}

/**
 * Keep the frame of the film: a node that `place` or `beside` puts off the frame stops the build, and the
 * message says by how much. A scene builds a picture in steps: a block is around the middle of the stage until
 * the scene places it, and a part can be off the frame for that time. So the check is for the end of the
 * build, where each node has its last place, and for the nodes that the film shows. Inside `to`, the node is
 * on the stage, and the check is at once. `from` is the region or the thing that the item goes to: when all
 * of it is off the frame, the film works there on purpose, as a film whose camera moves does, and nothing is
 * checked. Outside the callback of a film, no frame is known.
 */
function inFrame(what: string, item: LayoutItem, box: Box, from: Box, advice: (edges: readonly string[]) => string): void {
    const canvas = clock.canvas
    if (!canvas || clock.mode !== 'compile') return
    const w = canvas.width / 2, h = canvas.height / 2
    const away = from.right < -w || from.left > w || from.bottom < -h || from.top > h
    const message = (thing: Measured, off: [string, number][], when: string) => `${what}: ${describe(thing)} ${when} ${off.map(([edge, by]) => `${round(by)} off the frame at the ${edge}`).join(' and ')}. The frame is ${canvas.width} by ${canvas.height}, with its middle at [0, 0]. ${advice(off.map(([edge]) => edge))}`
    if (clock.capture) {
        const off = away ? [] : offFrame(box, canvas.width, canvas.height)
        if (off.length > 0) throw new Error(message(item, off, 'would be'))
        return
    }
    let placed = PLACED.get(canvas)
    if (!placed) {
        const made = new Map<Node, Placed>()
        PLACED.set(canvas, placed = made)
        canvas.checks.push(() => {
            const now = clock.now
            try {
                for (const [node, record] of made) {
                    // A node that the film does not put on the stage is not in the picture.
                    if (!node.mounted) continue
                    const time = Math.max(record.time, shownFrom(node))
                    if (!Number.isFinite(time)) continue
                    clock.now = time
                    const off = offFrame(boxOf(node), canvas.width, canvas.height)
                    if (off.length > 0) throw new Error(`${record.what}: ${describe(node)} is ${off.map(([edge, by]) => `${round(by)} off the frame at the ${edge}`).join(' and ')}. The frame is ${canvas.width} by ${canvas.height}, with its middle at [0, 0]. ${record.advice(off.map(([edge]) => edge))}`)
                }
            } finally {
                clock.now = now
            }
        })
    }
    // The last call that places a node decides.
    for (const node of nodesOf(item)) {
        if (away) placed.delete(node)
        else placed.set(node, { what, time: clock.now, advice })
    }
}

/**
 * Put an item in a region, at its middle, at an edge or in a corner: `place(notes, right, 'top left')`. The
 * region is a `Box`, or a thing whose measure is the region. An item that is larger than the region stops
 * the build: the message names the item, says by how much it does not fit, and names the changes that work.
 */
export function place<T extends LayoutItem>(item: T, region: Measured, where: Where = 'center'): T {
    checkItem('place', item, 'the item')
    if (region === undefined || region === null) throw new Error(`place: the region is ${region}. A region is a \`Box\` such as the \`area\` of the kit, or a thing whose measure is the region: a node, a block or a list`)
    if (isPoint(region)) throw new Error(`place: the region is the point [${region[0]}, ${region[1]}], and a point has no room for an item. To put an item at a point, use beside(item, [x, y], side), or give a region`)
    const target = measure(region, 'place', 'the region')
    const [h, v] = sides(where, 'place')
    if (nodesOf(item).length === 0) throw new Error('place: the item is an empty list. Give it at least one node')
    distinct('place', item, 'the list')
    const own = measure(item, 'place', 'the item')
    const wide = own.width - target.width > FIT, high = own.height - target.height > FIT
    if (wide || high) {
        const parts = [wide ? `${round(own.width - target.width)} too wide (${round(own.width)} in ${round(target.width)})` : '', high ? `${round(own.height - target.height)} too high (${round(own.height)} in ${round(target.height)})` : ''].filter(Boolean)
        throw new Error(`place: ${describe(item)} is ${parts.join(' and ')} for its region. ${advice(item, target, wide, high)}`)
    }
    const x = h < 0 ? target.left - own.left : h > 0 ? target.right - own.right : target.cx - own.cx
    const y = v < 0 ? target.top - own.top : v > 0 ? target.bottom - own.bottom : target.cy - own.cy
    inFrame('place', item, new Box(own.left + x, own.top + y, own.right + x, own.bottom + y), target, () => 'The region reaches over the frame there: use a region that is inside the frame')
    move(item, x, y)
    return item
}

/** The object that a node is a part of, when that object places its own parts: an event log, a set of lanes, a card. A plot is not one. */
function ownerOf(node: Node): Node | null {
    for (let up = node.parent; up; up = up.parent) if (up.data['ownLayout'] === true && objectOf(up)) return up
    return null
}

/**
 * Put an item beside another thing, by their measures: `beside(source, chip, 'right', 'tight')`. The other
 * thing is a node, a block, a region, or a point of the stage. `align` lines up an edge across the
 * direction: top or bottom for left and right, left or right for above and under. The middles line up by
 * default.
 *
 * For a note on a part of an object, give the object and then the part: `beside(note, log, 'right', 'wide', log.row(1))`
 * puts the note beside the whole log, at the height of the row. For above and under, it is at the x of the part.
 */
export function beside<T extends LayoutItem>(item: T, other: Measured, side: BesideSide, gap: Gap = 'normal', align: 'center' | 'top' | 'bottom' | 'left' | 'right' | Measured = 'center'): T {
    checkItem('beside', item, 'the item')
    checkSide(side, 'beside')
    const horizontal = side === 'left' || side === 'right'
    const allowed = horizontal ? ['center', 'top', 'bottom'] : ['center', 'left', 'right']
    if (typeof align === 'string' && !allowed.includes(align)) {
        throw new Error(`beside: for the side ${side}, align is ${oneOf(allowed)}, or a part of the other thing that the item lines up with, and it is ${JSON.stringify(align)}`)
    }
    const part = typeof align === 'string' ? null : measure(align, 'beside', 'the part that the item lines up with')
    if (other === undefined || other === null) throw new Error(`beside: the other thing is ${other}. Give a node, a block, a region, or a point [x, y]`)
    if (nodesOf(item).length === 0) throw new Error('beside: the item is an empty list. Give it at least one node')
    distinct('beside', item, 'the list')
    const b = measure(other, 'beside', 'the other thing'), own = measure(item, 'beside', 'the item'), axis = horizontal ? 'x' : 'y'
    const g = side === 'left' || side === 'above' ? gapBetween(gap, 'beside', item, other, axis) : gapBetween(gap, 'beside', other, item, axis)
    const across = (from: number, to: number, a: number, z: number, middle: number | null) => (middle !== null ? middle - (from + to) / 2 : align === 'center' ? (a + z) / 2 - (from + to) / 2 : align === 'top' || align === 'left' ? a - from : z - to)
    const dx = horizontal ? (side === 'right' ? b.right + g - own.left : b.left - g - own.right) : across(own.left, own.right, b.left, b.right, part ? part.cx : null)
    const dy = horizontal ? across(own.top, own.bottom, b.top, b.bottom, part ? part.cy : null) : side === 'under' ? b.bottom + g - own.top : b.top - g - own.bottom
    // An item beside a part of an object, such as a row of an event log, lands on the object. Stop, and name the way.
    const owner = other instanceof Node ? ownerOf(other) : null
    if (owner && !nodesOf(item).some((node) => owner.all().includes(node))) {
        const whole = boxOf(owner)
        const on = Math.min(own.right + dx, whole.right) - Math.max(own.left + dx, whole.left) > 1 && Math.min(own.bottom + dy, whole.bottom) - Math.max(own.top + dy, whole.top) > 1
        if (on) {
            throw new Error(`beside: ${describe(item)} would lie on the ${objectOf(owner)} that the other thing is a part of. To put it beside the whole ${objectOf(owner)}, at the ${horizontal ? 'height' : 'x'} of the part, give the object and then the part: beside(item, object, '${side}', gap, part). To put it on the object on purpose, give boxOf(part)`)
        }
    }
    inFrame('beside', item, new Box(own.left + dx, own.top + dy, own.right + dx, own.bottom + dy), b, (edges) => {
        // Off the frame in the direction of the side, or across it: the changes that work are not the same.
        const along = edges.some((edge) => (horizontal ? edge === 'left' || edge === 'right' : edge === 'top' || edge === 'bottom'))
        if (along) return 'Put it at another side of the other thing, use a smaller gap, or move the other thing away from that edge of the frame'
        return `Line up an edge in place of the middle, with ${horizontal ? "'top' or 'bottom'" : "'left' or 'right'"} as the last argument, make the item smaller, or move the other thing away from that edge of the frame`
    })
    move(item, dx, dy)
    return item
}
