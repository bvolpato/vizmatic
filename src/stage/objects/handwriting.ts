import { Node, dynamic } from '../node'
import { Value, appear, par, type Anim, type AnimOptions } from '../anim'
import { penStrokes, type PenStroke } from '../centerline'
import { circlePath, polyPath, reverseRing, signedArea, transformPath, type Path, type Ring } from '../geometry'
import { linearGradient, toPaint, type ColorInput } from '../color'
import { glyphOf, text, type TextOptions } from '../text'
import { glyphPath, type LoadedFont } from '../font'
import { linear } from '../ease'

export interface HandwritingOptions {
    /** A script font, such as one that the film brings with `registerFont`. Defaults to the italic of `serif`. */
    font?: TextOptions['font']
    weight?: TextOptions['weight']
    italic?: boolean
    size?: number
    color?: ColorInput
    align?: TextOptions['align']
    anchor?: TextOptions['anchor']
    /** Wrap to this width, in stage pixels. */
    maxWidth?: number
    /** Line height as a multiple of size. Defaults to 1.5. */
    leading?: number
    tracking?: number
    /** How much is written when the text comes to the stage, from 0 to 1. Defaults to 0. */
    written?: number
}

/** Where the pen is: its point, if it touches the paper, and the way that it goes, as an angle. */
export interface PenPoint {
    x: number
    y: number
    down: boolean
    angle: number
}

interface Step {
    /** The glyph whose stroke this is, or the glyph to which the pen goes through the air. */
    glyph: number
    stroke: PenStroke | null
    /** The points of the way, in the coordinates of the object. */
    points: readonly (readonly [number, number])[]
    /** How long the way is up to each point. */
    reach: number[]
    from: number
    to: number
}

// A hand needs some time to start a stroke and to move the pen through the air, and it rests between words.
// These are in the time that a pen needs for a line as long as the size of the text.
const STROKE_START = 0.16, AIR_START = 0.1, AIR_SPEED = 0.4, WORD_REST = 0.25, LINE_REST = 0.7
/** Seconds for a line as long as the size of the text, at an unhurried pace. */
const PACE = 0.17

/** The size at which the strokes of a letter are found. They are then the same for each size of a text. */
const STROKE_SIZE = 200
const strokeCache = new WeakMap<LoadedFont, Map<number, readonly PenStroke[]>>()

/** The strokes of one glyph, for a size of 1, from the origin of the glyph. */
function strokesOf(font: LoadedFont, glyph: number): readonly PenStroke[] {
    let own = strokeCache.get(font)
    if (!own) strokeCache.set(font, own = new Map())
    let found = own.get(glyph)
    if (!found) {
        found = penStrokes(glyphPath(font, glyph, STROKE_SIZE), STROKE_SIZE).map((stroke) => stroke.map(([x, y, r]) => [x / STROKE_SIZE, y / STROKE_SIZE, r / STROKE_SIZE] as const))
        own.set(glyph, found)
    }
    return found
}

/**
 * A text that a pen writes. Each letter of the font gives the way of a pen through its middle, so the ink
 * appears where the pen is, and not as an outline. `write()` writes it, `progress` is the part that is
 * written, and `part('some words')` is the part of the writing that these words are, to follow a voice.
 */
export class Handwriting extends Node {
    /** The part of the text that is written, from 0 to 1. */
    readonly progress: Value
    /** The seconds that an unhurried hand needs for the text. */
    readonly seconds: number
    /** The font size of the text. */
    readonly size: number
    private readonly steps: Step[] = []
    private readonly rings: Ring[] = []
    /** How many rings are done when each glyph is done. */
    private readonly ringEnds: number[] = []
    private readonly words: { glyphs: number[]; text: string }[] = []

    constructor(readonly content: string, options: HandwritingOptions = {}) {
        super()
        if (typeof content !== 'string' || content.trim() === '') throw new Error('handwriting: give the words to write')
        const written = options.written ?? 0
        if (!(written >= 0 && written <= 1)) throw new Error(`handwriting: written is ${JSON.stringify(options.written)}, and it is a part from 0 to 1`)
        const { color, written: _written, ...look } = options
        void _written
        const node = text(content, { ...look, font: options.font ?? 'serif', italic: options.italic ?? options.font === undefined, leading: options.leading ?? 1.5 })
        const lost = node.chars.find((leaf) => leaf.data['missingGlyph'])
        if (lost) throw new Error(`handwriting: no font has a letter for ${JSON.stringify(String(lost.data['key']))}. Give the words in letters that the font ${JSON.stringify(node.font)} has`)
        this.size = node.size
        this.progress = new Value(written)
        const paint = toPaint(color ?? 'ink')

        const [left, top] = [node.base.px, node.base.py]
        const placed = node.chars.map((leaf) => {
            const m = leaf.localMatrix()
            return { key: String(leaf.data['key']), path: leaf.base.path!, dx: m[4], dy: m[5], source: glyphOf(leaf)! }
        })
        placed.forEach(({ path, dx, dy }) => {
            const rings = transformPath(path, [1, 0, 0, 1, dx - left, dy - top])
            const largest = rings.reduce((most, ring) => { const area = signedArea(ring); return Math.abs(area) > Math.abs(most) ? area : most }, 0)
            // Rings of two directions cancel where they overlap. Some letters of a font can run against the others,
            // so each letter is turned to run forward, and so is the ink of the pen.
            this.rings.push(...(largest < 0 ? rings.map(reverseRing) : rings))
            this.ringEnds.push(this.rings.length)
        })

        // The words, with the glyphs of each. A character that draws nothing has no glyph.
        let cursor = 0
        for (const word of content.split(/\s+/).filter(Boolean)) {
            const glyphs: number[] = []
            for (const char of word) if (placed[cursor]?.key === char) glyphs.push(cursor++)
            this.words.push({ glyphs, text: word })
        }
        const firstOf = new Set(this.words.map((word) => word.glyphs[0]))

        let now = 0, pen: readonly [number, number] | null = null, line = 0
        placed.forEach(({ source, dx, dy }, glyph) => {
            const ox = dx - left - source.x, oy = dy - top - source.y
            strokesOf(source.font, source.glyph).forEach((unit, index) => {
                const points = unit.map(([x, y]) => [x * this.size + ox, y * this.size + oy] as const)
                const start = points[0]!
                if (pen) {
                    const rest = index > 0 || !firstOf.has(glyph) ? 0 : Math.abs(oy - line) > this.size * 0.7 ? LINE_REST : WORD_REST
                    const far = Math.hypot(start[0] - pen[0], start[1] - pen[1]) / this.size
                    // The pen stays down when the next stroke starts where the last one ended.
                    if (far > 0.05 || rest > 0) now = this.step(glyph, null, [pen, start], now, AIR_START + far * AIR_SPEED + rest)
                }
                const stroke = unit.map(([x, y, r]) => [x * this.size + ox, y * this.size + oy, r * this.size] as const)
                const length = points.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p[0] - points[i - 1]![0], p[1] - points[i - 1]![1])), 0)
                now = this.step(glyph, stroke, points, now, STROKE_START + length / this.size)
                pen = points[points.length - 1]!
            })
            line = oy
        })
        if (this.steps.length === 0) throw new Error(`handwriting: give the words to write. ${JSON.stringify(content)} has no letter that draws something`)
        this.seconds = now * PACE
        for (const step of this.steps) { step.from /= now; step.to /= now }

        this.layoutBox = node.layoutBox && [node.layoutBox[0] - left, node.layoutBox[1] - top, node.layoutBox[2] - left, node.layoutBox[3] - top]
        this.add(dynamic(() => {
            const part = this.progress.value
            if (part <= 0) return []
            const ink = new Node(this.ink(part))
            ink.base.fill = paint
            return [ink]
        }))
    }

    private step(glyph: number, stroke: PenStroke | null, points: readonly (readonly [number, number])[], from: number, length: number): number {
        const reach = [0]
        for (let i = 1; i < points.length; i++) reach.push(reach[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]))
        this.steps.push({ glyph, stroke, points, reach, from, to: from + length })
        return from + length
    }

    /** The step that a part of the writing is in. */
    private stepAt(part: number): { step: Step; index: number; share: number } {
        let low = 0, high = this.steps.length - 1
        while (low < high) { const mid = (low + high) >> 1; if (this.steps[mid]!.to < part) low = mid + 1; else high = mid }
        const step = this.steps[low]!
        return { step, index: low, share: Math.max(0, Math.min(1, (part - step.from) / (step.to - step.from))) }
    }

    /** The ink of a part of the writing, as one path in the coordinates of the object. */
    ink(part: number): Path {
        if (part <= 0) return []
        if (part >= 1) return this.rings
        const { step, index, share } = this.stepAt(part)
        const done = step.glyph === 0 ? 0 : this.ringEnds[step.glyph - 1]!
        const out: Ring[] = this.rings.slice(0, done)
        for (let i = index; i >= 0 && this.steps[i]!.glyph === step.glyph; i--) {
            const own = this.steps[i]!
            if (own.stroke) this.drawStroke(out, own, i === index ? share : 1)
        }
        return out
    }

    /** The ink of one stroke: a disc at each point, and the room between two discs. */
    private drawStroke(out: Ring[], step: Step, share: number): void {
        const stroke = step.stroke!, end = step.reach[step.reach.length - 1]! * share
        const turn = (ring: Ring) => (signedArea(ring) >= 0 ? ring : reverseRing(ring))
        let before: readonly [number, number, number] | null = null
        for (let i = 0; i < stroke.length; i++) {
            let point = stroke[i]!, last = false
            if (step.reach[i]! > end) {
                const a = stroke[i - 1]!, u = (end - step.reach[i - 1]!) / (step.reach[i]! - step.reach[i - 1]!)
                point = [a[0] + (point[0] - a[0]) * u, a[1] + (point[1] - a[1]) * u, a[2] + (point[2] - a[2]) * u]
                last = true
            }
            out.push(turn(circlePath(point[0], point[1], point[2])[0]!))
            if (before) {
                const dx = point[0] - before[0], dy = point[1] - before[1], d = Math.hypot(dx, dy)
                if (d > 1e-6) {
                    const nx = -dy / d, ny = dx / d
                    out.push(turn(polyPath([[before[0] + nx * before[2], before[1] + ny * before[2]], [point[0] + nx * point[2], point[1] + ny * point[2]], [point[0] - nx * point[2], point[1] - ny * point[2]], [before[0] - nx * before[2], before[1] - ny * before[2]]], true)[0]!))
                }
            }
            before = point
            if (last) break
        }
    }

    /** Where the pen is at a part of the writing, in the coordinates of the object. */
    tip(part: number): PenPoint {
        const { step, share } = this.stepAt(part)
        const { points, reach } = step, end = reach[reach.length - 1]!
        // Through the air, a hand starts and stops softly.
        const way = step.stroke ? share * end : end * share * share * (3 - 2 * share)
        let i = 1
        while (i < points.length - 1 && reach[i]! < way) i++
        const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i)]!, room = (reach[i] ?? 0) - (reach[i - 1] ?? 0), u = room > 0 ? (way - reach[i - 1]!) / room : 0
        return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, down: step.stroke !== null, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) }
    }

    /**
     * The part of the writing that some words are: `progress` when the pen starts them and when it has written
     * them. With it, a film moves `progress` as a voice says the words.
     */
    part(words: string): { from: number; to: number } {
        const want = words.split(/\s+/).filter(Boolean), found: number[] = []
        for (let i = 0; i + want.length <= this.words.length; i++) if (want.every((word, j) => this.words[i + j]!.text === word)) found.push(i)
        if (want.length === 0 || found.length !== 1) throw new Error(`handwriting: the text ${found.length === 0 ? 'does not have' : `has ${found.length} times`} the words ${JSON.stringify(words)}. Give words of the text as they are written, which it has one time`)
        const glyphs = this.words.slice(found[0]!, found[0]! + want.length).flatMap((word) => word.glyphs)
        const own = this.steps.filter((step) => step.stroke && glyphs.includes(step.glyph))
        if (own.length === 0) throw new Error(`handwriting: the words ${JSON.stringify(words)} have no letter that draws something`)
        return { from: own[0]!.from, to: own[own.length - 1]!.to }
    }

    /** Write the rest of the text. The default length is the seconds that an unhurried hand needs for it. */
    write(options: AnimOptions = {}): Anim {
        return par(appear(this), this.progress.to(1, { ease: linear, ...options, duration: options.duration ?? Math.max(0.1, this.seconds * (1 - this.progress.value)) }))
    }

    /** Put a pen at the point of the writing. Its origin is the point of its nib, as in `dipPen()`. */
    hold(pen: Node): this {
        const lift = this.size * 0.14
        this.add(dynamic(() => {
            const part = this.progress.value
            if (part <= 0 || part >= 1) return []
            const tip = this.tip(part), up = tip.down ? 0 : Math.sin(Math.PI * this.stepAt(part).share) * lift
            return [pen.clone().at(tip.x, tip.y - up)]
        }))
        return this
    }
}

/** A text that a pen writes, letter by letter, along the middle of each stroke. See `Handwriting`. */
export function handwriting(content: string, options: HandwritingOptions = {}): Handwriting {
    return new Handwriting(content, options)
}

export interface DipPenOptions {
    /** The length of the pen, from the point of its nib to the end of its holder. Defaults to 420. */
    length?: number
    /** The way that the pen leans, as the angle of its holder from the nib, in radians. Defaults to up and to the right. */
    angle?: number
    /** The color of the holder. */
    color?: string
    /** The color of the nib. */
    nib?: string
}

/** A pen with a steel nib and a wooden holder. Its origin is the point of the nib, so it can write. */
export function dipPen(options: DipPenOptions = {}): Node {
    const length = options.length ?? 420, angle = options.angle ?? -0.95, wood = options.color ?? '#5a3217', steel = options.nib ?? '#c9ccd6'
    const k = length / 420, c = Math.cos(angle), s = Math.sin(angle)
    const P = (along: number, side: number): [number, number] => [(along * c - side * s) * k, (along * s + side * c) * k]
    const across = (along: number, half: number, stops: readonly (readonly [number, string])[]) => linearGradient(P(along, -half), P(along, half), stops.map(([u, color]) => [u, color] as [number, string]))
    const shape = (points: readonly (readonly [number, number])[], paint: ReturnType<typeof linearGradient> | string) => {
        const node = new Node(polyPath(points.map(([a, b]) => P(a, b)), true))
        return node.fill(paint as ColorInput)
    }
    const taper = (from: number, to: number, half: (u: number) => number, n = 18): [number, number][] => [
        ...Array.from({ length: n + 1 }, (_, i) => { const u = i / n; return [from + (to - from) * u, half(u)] as [number, number] }),
        ...Array.from({ length: n + 1 }, (_, i) => { const u = 1 - i / n; return [from + (to - from) * u, -half(u)] as [number, number] }),
    ]
    const pen = new Node()
    // The shadow on the paper is under the pen and gives its height.
    const shade = new Node(polyPath(taper(6, 400, (u) => 3 + u * 8).map(([a, b]) => { const [x, y] = P(a, b); return [x * 0.96 + 10 * k + a * 0.05 * k, y * 0.62 + 12 * k] as [number, number] }), true)).fill('#000000', 0.16)
    pen.add(shade)
    pen.add(shape(taper(0, 64, (u) => 0.5 + 8.5 * Math.pow(Math.sin(Math.min(1, u * 1.02) * Math.PI / 2), 1.25)), across(40, 9, [[0, '#6d707c'], [0.3, '#ffffff'], [0.55, steel], [1, '#5b5e69']])))
    pen.add(new Node(polyPath([P(3, 0), P(36, 0)])).stroke('#3b3d46', 1.3 * k), new Node(circlePath(...P(38, 0), 2.6 * k)).fill('#2c2e36'))
    pen.add(shape(taper(58, 92, (u) => 9.6 + 1.2 * Math.sin(u * Math.PI)), across(74, 11, [[0, '#7a5a1e'], [0.28, '#f7dc94'], [0.6, '#c79a3f'], [1, '#6a4a14']])))
    pen.add(shape(taper(90, 420, (u) => 10.5 - 2.4 * Math.sin(u * 1.2) + (u > 0.94 ? -(u - 0.94) * 90 : 0)), across(240, 11, [[0, '#24130a'], [0.22, wood], [0.36, '#b98455'], [0.5, wood], [1, '#1b0e07']])))
    return pen
}
