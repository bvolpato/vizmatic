import { isGradient, parseColor, sampleStops, type Paint, type Rgba } from './color'
import type { DrawOp, Frame, PathOp } from './display'
import { imageOpBounds } from './display'
import { imageHasVisiblePixels, ImageAssetError } from './image'
import { pathBounds, type Bounds, type Path } from './geometry'
import type { Node } from './node'
import { isFilm, isSuspend, Stage, type CompiledFilm, type CompileOverrides, type FilmDefinition } from './stage'

export type FilmDiagnosticCode = 'film.off_canvas' | 'film.text_edge' | 'film.text_crowded' | 'film.text_overlap' | 'film.text_crossed' | 'film.text_brief' | 'film.missing_glyph' | 'film.blank' | 'film.image_asset'

export interface FilmDiagnostic {
    code: FilmDiagnosticCode
    severity: 'error' | 'warning'
    message: string
    /** First sampled time with this problem, in seconds. */
    time: number
    /** Last sampled time with this problem, in seconds. */
    until: number
    /** Where to look, in canvas pixels with the origin at the top left. */
    box: Bounds
    /** The center of the box in authoring coordinates, with (0, 0) at mid-frame. */
    stage: { x: number; y: number }
    /** The text involved, when there is any. */
    text?: string
    /** The second text involved in an overlap. */
    other?: string
    /**
     * Set when a motion scan finds the problem only while something moves. `time` and `until` then
     * bound the longest stretch. `spans` counts the separate stretches, and `seconds` is their total length.
     * For `film.text_brief`, `time` and `until` bound the first stretch, or a whole row of texts that follow
     * each other. `spans` counts the stretches or the texts, and `seconds` is the time that they were readable.
     */
    motion?: { spans: number; seconds: number }
}

export interface FilmCheckReport {
    ok: boolean
    width: number
    height: number
    duration: number
    /** The moments at rest that were inspected, in seconds. */
    sampled: number[]
    /** The number of frames that a motion scan inspected. */
    frames?: number
    diagnostics: FilmDiagnostic[]
    summary: { errors: number; warnings: number }
}

export interface FilmCheckOptions extends CompileOverrides {
    /** Inspect exactly these times, in seconds, in place of the automatic sampling. */
    times?: readonly number[]
    /** Add this many evenly spaced samples to the moments at rest. */
    samples?: number
    /**
     * Also inspect every frame. A problem that appears only while something moves is a warning, because
     * the check cannot tell a collision from one picture that replaces another. A stretch of 0.2 seconds
     * or more with nothing visible is reported as `film.blank`. Text that leaves before a viewer can read
     * it is reported as `film.text_brief`.
     */
    motion?: boolean
    /**
     * For a motion scan, the characters that a viewer reads in one second. Text that leaves before a
     * reader at this speed gets to its end is reported as `film.text_brief`. Defaults to 20, the fastest
     * speed that subtitle guides allow for an adult viewer. 0 turns the rule off.
     */
    readingSpeed?: number
    /**
     * The film plays one chapter at a time, as a deck does: the player waits for the viewer on the first
     * frame of each chapter after the start. Text that is up at such a stop has all the time that the
     * viewer gives it, so `film.text_brief` does not report it.
     */
    stepped?: boolean
    /**
     * For a motion scan, the canvas y where the content starts. Marks above it, such as a heading that
     * stays up, do not count as content when the scan looks for blank frames.
     */
    contentTop?: number
    /**
     * The least distance between text and an edge of the frame, in canvas pixels. Text that is nearer is
     * reported as `film.text_edge`. Defaults to 2% of the shorter side of the frame. 0 turns the rule off.
     */
    textMargin?: number
    /**
     * The least distance between text and another mark, as a part of the font size of the text, such as 0.3.
     * Text that is nearer is reported as `film.text_crowded`. The rule never asks for more than 2% of the shorter
     * side of the frame. It is off unless this is set, because a plot may put a curve beside a label on purpose.
     */
    textGap?: number
}

interface TextBlock {
    id: Node
    source: string
    bounds: Bounds
    glyphs: { box: Bounds; order: number }[]
    /** Font size in canvas pixels, or 0 when the text node does not record one. */
    size: number
}

/** What the rules that have a setting use. 0 turns a rule off. */
interface Limits {
    /** Least distance between text and an edge of the frame, in pixels. */
    margin: number
    /** Least distance between text and another mark, as a part of the font size. */
    gap: number
}

const EDGE_TOLERANCE = 1
// Text this near to an edge, as a fraction of the shorter side of the frame, reads as a layout mistake.
const EDGE_MARGIN = 0.02
// A large title does not need a gap in proportion: this part of the shorter side of the frame is enough for any text.
const TEXT_GAP_CAP = 0.02
// A shape this opaque behind a text is its backing, and hides what is under it.
const PLATE = 0.8
const MIN_ALPHA = 0.08
const MIN_TEXT_ALPHA = 0.15
const MIN_OVERLAP = 0.12
const GLYPH_INSET = 0.12
const MIN_RESTING_MOMENTS = 5
const AUTO_SAMPLES = 12
const CUBIC_STEPS = 6
const CROSSING_ERROR_WIDTH = 2
// A mark under this opacity is still fading in or out, so a viewer cannot read it.
const BLANK_ALPHA = 0.25
// A film may open on an empty stage and close on one.
const BLANK_EDGE_SECONDS = 0.5
// A quick change from one picture to the next dips for a few frames, and reads as a cut.
const BLANK_MIN_SECONDS = 0.2
const CROSSING_ERROR_CONTRAST = 2
// The fastest speed that subtitle guides allow for an adult viewer: 20 characters in one second.
const READING_SPEED = 20
// A short label still needs half a second, the time of 10 characters.
const READING_MIN_SECONDS = 0.5
// A viewer does not notice a tenth less time, and a report must not depend on the frame rate.
const READING_TOLERANCE = 0.9
// A text that gets more words in place may be away for this long on the way, such as a formula that morphs into a longer one.
const READING_GAP_SECONDS = 2
// Brief texts that follow each other at one place within this time are one finding, such as rows that scroll.
const READING_CHAIN_SECONDS = 0.5
// Faint grid lines may run behind labels. A reader still reads the label.
const MIN_STROKE_CONTRAST = 1.6
const OPAQUE = 0.9

function solid(paint: Paint): Rgba {
    return isGradient(paint) ? sampleStops(paint.stops, 0.5) : paint as Rgba
}

function luminance(color: Rgba): number {
    const channel = (value: number) => {
        const x = value / 255
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2])
}

/** Contrast of a translucent mark against the background, as WCAG defines the ratio. */
function contrastOver(color: Rgba, alpha: number, background: Rgba): number {
    const a = color[3] * alpha
    const mixed: Rgba = [
        color[0] * a + background[0] * (1 - a),
        color[1] * a + background[1] * (1 - a),
        color[2] * a + background[2] * (1 - a),
        1,
    ]
    const x = luminance(mixed), y = luminance(background)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

function pad(bounds: Bounds, amount: number): Bounds {
    return { x: bounds.x - amount, y: bounds.y - amount, width: bounds.width + amount * 2, height: bounds.height + amount * 2 }
}

function inset(bounds: Bounds, fraction: number): Bounds {
    const dx = bounds.width * fraction, dy = bounds.height * fraction
    return { x: bounds.x + dx, y: bounds.y + dy, width: bounds.width - dx * 2, height: bounds.height - dy * 2 }
}

function intersects(a: Bounds, b: Bounds): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function intersection(a: Bounds, b: Bounds): Bounds | null {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
    const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height)
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}

function contains(outer: Bounds, inner: Bounds): boolean {
    return outer.x <= inner.x && outer.y <= inner.y
        && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height
}

function union(a: Bounds, b: Bounds): Bounds {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

/** Liang-Barsky: does a segment enter a box? */
function segmentHitsBox(x0: number, y0: number, x1: number, y1: number, box: Bounds): boolean {
    let t0 = 0, t1 = 1
    const dx = x1 - x0, dy = y1 - y0
    const edges: [number, number][] = [
        [-dx, x0 - box.x], [dx, box.x + box.width - x0],
        [-dy, y0 - box.y], [dy, box.y + box.height - y0],
    ]
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return false
        } else {
            const r = q / p
            if (p < 0) {
                if (r > t1) return false
                if (r > t0) t0 = r
            } else {
                if (r < t0) return false
                if (r < t1) t1 = r
            }
        }
    }
    return t0 <= t1
}

function strokeHitsBox(path: Path, box: Bounds): boolean {
    for (const r of path) {
        const p = r.p
        for (let o = 0; o + 7 < p.length; o += 6) {
            const x0 = p[o]!, y0 = p[o + 1]!, x1 = p[o + 2]!, y1 = p[o + 3]!
            const x2 = p[o + 4]!, y2 = p[o + 5]!, x3 = p[o + 6]!, y3 = p[o + 7]!
            // A segment's control hull contains its curve, so most segments reject here.
            const left = Math.min(x0, x1, x2, x3), right = Math.max(x0, x1, x2, x3)
            const top = Math.min(y0, y1, y2, y3), bottom = Math.max(y0, y1, y2, y3)
            if (right < box.x || left > box.x + box.width || bottom < box.y || top > box.y + box.height) continue
            let lastX = x0, lastY = y0
            for (let k = 1; k <= CUBIC_STEPS; k++) {
                const t = k / CUBIC_STEPS, u = 1 - t
                const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
                const x = a * x0 + b * x1 + c * x2 + d * x3
                const y = a * y0 + b * y1 + c * y2 + d * y3
                if (segmentHitsBox(lastX, lastY, x, y, box)) return true
                lastX = x
                lastY = y
            }
        }
    }
    return false
}

/** True when a node ignores the camera, so a zoom does not move or crop it. */
function pinned(node: Node): boolean {
    for (let current: Node | null = node; current; current = current.parent) {
        if (current.get('fixed')) return true
    }
    return false
}

/** Distance from a point to a segment. */
function pointSegmentGap(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
    const dx = x1 - x0, dy = y1 - y0
    const length = dx * dx + dy * dy
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / length))
    return Math.hypot(px - x0 - dx * t, py - y0 - dy * t)
}

/** Distance from a segment to a box. 0 when they touch. */
function segmentBoxGap(x0: number, y0: number, x1: number, y1: number, box: Bounds): number {
    if (segmentHitsBox(x0, y0, x1, y1, box)) return 0
    const right = box.x + box.width, bottom = box.y + box.height
    const toBox = (x: number, y: number) => Math.hypot(Math.max(box.x - x, 0, x - right), Math.max(box.y - y, 0, y - bottom))
    return Math.min(
        toBox(x0, y0), toBox(x1, y1),
        pointSegmentGap(box.x, box.y, x0, y0, x1, y1), pointSegmentGap(right, box.y, x0, y0, x1, y1),
        pointSegmentGap(box.x, bottom, x0, y0, x1, y1), pointSegmentGap(right, bottom, x0, y0, x1, y1),
    )
}

/** Distance from the outline of a path to a box. 0 when the outline enters the box. Infinity when it is farther than `reach`. */
function outlineGap(path: Path, box: Bounds, reach: number): number {
    let least = Infinity
    for (const r of path) {
        const p = r.p
        for (let o = 0; o + 7 < p.length; o += 6) {
            const x0 = p[o]!, y0 = p[o + 1]!, x1 = p[o + 2]!, y1 = p[o + 3]!
            const x2 = p[o + 4]!, y2 = p[o + 5]!, x3 = p[o + 6]!, y3 = p[o + 7]!
            // A segment's control hull contains its curve, so most segments reject here.
            const left = Math.min(x0, x1, x2, x3), right = Math.max(x0, x1, x2, x3)
            const top = Math.min(y0, y1, y2, y3), bottom = Math.max(y0, y1, y2, y3)
            if (right < box.x - reach || left > box.x + box.width + reach || bottom < box.y - reach || top > box.y + box.height + reach) continue
            let lastX = x0, lastY = y0
            for (let k = 1; k <= CUBIC_STEPS; k++) {
                const t = k / CUBIC_STEPS, u = 1 - t
                const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
                const x = a * x0 + b * x1 + c * x2 + d * x3
                const y = a * y0 + b * y1 + c * y2 + d * y3
                least = Math.min(least, segmentBoxGap(lastX, lastY, x, y, box))
                if (least === 0) return 0
                lastX = x
                lastY = y
            }
        }
    }
    return least <= reach ? least : Infinity
}

/** The object that placed a text beside its own marks, such as an axes for its numbers. Null for text that the film placed. */
function layoutOwner(block: Node): Node | null {
    for (let current = block.parent; current; current = current.parent) {
        if (current.data['ownLayout']) return current
    }
    return null
}

function within(node: Node | undefined, ancestor: Node): boolean {
    for (let current: Node | null | undefined = node; current; current = current.parent) {
        if (current === ancestor) return true
    }
    return false
}

function textBlockOf(node: Node): Node | null {
    return node.data['key'] !== undefined ? node.parent : null
}

function isGlyph(op: PathOp): boolean {
    return !!op.node && op.node.data['key'] !== undefined
}

function sourceOf(node: Node): string {
    const source = (node as Node & { source?: unknown }).source
    return typeof source === 'string' ? source : ''
}

/** A stable name for what drew a mark. A dynamic drawing makes new nodes on every frame, so they share one name. */
function ownerKey(node: Node | undefined): string {
    if (!node) return 'unknown'
    let current = node
    while (current.parent && current.parent.parent) current = current.parent
    return current.mounted ? String(current.id) : 'dynamic'
}

/** Times to inspect. Things cross each other while moving, so check where the film comes to rest. */
function restingMoments(film: CompiledFilm, samples: number): number[] {
    const times = new Set<number>()
    const clips = film.clips
    const active = (t: number) => clips.some((clip) => clip.t0 < t && t < clip.t1)
    const nudge = 1e-3
    for (const clip of clips) {
        const t = clip.t1 + nudge
        if (t < film.duration && !active(t)) times.add(t)
    }
    times.add(Math.max(0, film.duration - nudge))
    for (let i = 0; i < samples; i++) times.add(((i + 0.5) / samples) * film.duration)
    if (times.size < MIN_RESTING_MOMENTS) {
        // A film with few pauses still has holds worth checking. Keep to moments at rest.
        for (let i = 0; i < AUTO_SAMPLES; i++) {
            const t = ((i + 0.5) / AUTO_SAMPLES) * film.duration
            if (!active(t)) times.add(t)
        }
    }
    return [...times].sort((a, b) => a - b)
}

function frameAt(film: CompiledFilm, time: number): Frame | Promise<Frame> {
    try {
        return film.frame(time)
    } catch (error) {
        if (!isSuspend(error)) throw error
        return error.promise.then(() => frameAt(film, time))
    }
}

function zoomAt(film: CompiledFilm, time: number): number {
    const camera = film.stage.camera
    const track = camera.tracks?.get('sx')
    return track ? track.sample(time) as number : camera.base.sx
}

interface Finding extends Omit<FilmDiagnostic, 'until' | 'stage'> {
    key: string
}

function inspect(frame: Frame, time: number, zoomed: boolean, bleed: boolean, limits: Limits): Finding[] {
    const { margin } = limits
    const findings: Finding[] = []
    const { width, height, ops } = frame
    const background = frame.background ? parseColor(frame.background) : (frame.dark ? [0, 0, 0, 1] as Rgba : [255, 255, 255, 1] as Rgba)
    const canvas: Bounds = { x: 0, y: 0, width, height }
    const blocks = new Map<Node, TextBlock>()
    const fills: { order: number; bounds: Bounds }[] = []
    const strokes: { op: PathOp; order: number; contrast: number }[] = []
    // What a viewer sees as a shape or a line: the outline that text must keep away from.
    const outlines: { path: Path; order: number; half: number; bounds: Bounds; node: Node | undefined; closed: boolean }[] = []
    const plates: { order: number; bounds: Bounds }[] = []
    const off = new Map<string, Finding>()
    let outsideMarks = 0

    ops.forEach((op: DrawOp, order) => {
        if (op.kind === 'image') {
            if (op.alpha < MIN_ALPHA || !imageHasVisiblePixels(op.image.asset, op.image.crop)) return
            const box = imageOpBounds(op)
            const outside = box.x < -EDGE_TOLERANCE || box.y < -EDGE_TOLERANCE
                || box.x + box.width > width + EDGE_TOLERANCE || box.y + box.height > height + EDGE_TOLERANCE
            if (outside && !zoomed && !bleed) findings.push({
                key: `film.off_canvas:image:${ownerKey(op.node)}`,
                code: 'film.off_canvas', severity: 'warning', time, box,
                message: `Image ${JSON.stringify(op.image.asset?.id ?? op.node?.label ?? 'image')} runs off the canvas.`,
            })
            return
        }
        if (op.kind !== 'path' || op.path.length === 0) return
        const glyph = isGlyph(op)
        const alpha = Math.max(op.fillAlpha, op.strokeAlpha)
        if (alpha < MIN_ALPHA) return
        const shape = pathBounds(op.path)
        if (!shape) return
        const box = op.stroke ? pad(shape, op.strokeWidth / 2) : shape
        const block = glyph ? textBlockOf(op.node!) : null

        // Off the canvas. A mark that spans the whole frame is deliberate overscan, such as a grid line.
        const outside = box.x < -EDGE_TOLERANCE || box.y < -EDGE_TOLERANCE
            || box.x + box.width > width + EDGE_TOLERANCE || box.y + box.height > height + EDGE_TOLERANCE
        const spansFrame = (box.x <= 0 && box.x + box.width >= width) || (box.y <= 0 && box.y + box.height >= height)
        if (outside && (glyph || (!spansFrame && !zoomed && !bleed))) {
            const visible = intersects(box, canvas)
            const text = block ? sourceOf(block) : undefined
            // Text is reported by name. Other marks merge, because a bent grid can produce hundreds.
            const key = glyph ? `text:${text}` : 'marks'
            const existing = off.get(key)
            const severity = glyph && visible && !zoomed ? 'error' : 'warning'
            if (existing) {
                existing.box = union(existing.box, box)
                if (!glyph) outsideMarks += 1
            } else {
                if (!glyph) outsideMarks = 1
                off.set(key, {
                    key: `film.off_canvas:${key}`, code: 'film.off_canvas', severity, time, box,
                    message: glyph ? `Text ${JSON.stringify(text ?? '')} runs off the canvas${visible ? ' and is clipped' : ''}.` : '',
                    ...(text ? { text } : {}),
                })
            }
        }

        if (glyph && op.node!.data['missingGlyph'] && op.fillAlpha >= MIN_TEXT_ALPHA) {
            const char = String(op.node!.data['key'])
            const code = `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
            const text = block ? sourceOf(block) : ''
            findings.push({
                key: `film.missing_glyph:${text}:${code}`,
                code: 'film.missing_glyph', severity: 'error', time, box: shape,
                message: `Text ${JSON.stringify(text)} has a character that no bundled font can draw (${code}). It renders as an empty box.`,
                text,
            })
        }

        if (glyph && block && op.fillAlpha >= MIN_TEXT_ALPHA) {
            let entry = blocks.get(block)
            if (!entry) blocks.set(block, entry = { id: block, source: sourceOf(block), bounds: shape, glyphs: [], size: 0 })
            entry.bounds = union(entry.bounds, shape)
            entry.glyphs.push({ box: shape, order })
            if (entry.size === 0 && shape.height > 0) {
                // The node records its font size in its own units. One glyph gives the scale from those units to the canvas.
                const declared = block.data['size'], own = pathBounds(op.node!.get('path') ?? [])
                if (typeof declared === 'number' && own && own.height > 0) entry.size = declared * shape.height / own.height
            }
        } else if (!glyph) {
            if (op.fill && op.fillAlpha >= OPAQUE && solid(op.fill)[3] >= OPAQUE && op.path.some((r) => r.closed)) fills.push({ order, bounds: shape })
            if (op.fill && op.fillAlpha * solid(op.fill)[3] >= PLATE && op.path.some((r) => r.closed)) plates.push({ order, bounds: shape })
            let drawn = false
            if (op.stroke && op.strokeAlpha >= MIN_ALPHA && op.strokePath.length > 0) {
                const contrast = contrastOver(solid(op.stroke), op.strokeAlpha, background)
                if (contrast >= MIN_STROKE_CONTRAST) {
                    strokes.push({ op, order, contrast })
                    const reach = pathBounds(op.strokePath)
                    if (reach) outlines.push({ path: op.strokePath, order, half: op.strokeWidth / 2, bounds: reach, node: op.node, closed: op.strokePath.every((r) => r.closed) })
                    drawn = true
                }
            }
            if (!drawn && op.fill && op.fillAlpha >= MIN_ALPHA && contrastOver(solid(op.fill), op.fillAlpha, background) >= MIN_STROKE_CONTRAST) {
                outlines.push({ path: op.path, order, half: 0, bounds: shape, node: op.node, closed: true })
            }
        }
    })
    const marks = off.get('marks')
    if (marks) marks.message = `${outsideMarks === 1 ? 'A mark extends' : `${outsideMarks} marks extend`} past the ${width}x${height} canvas.`
    findings.push(...off.values())

    /** Something opaque drawn between two marks hides the lower one, such as a label's backing. */
    const occluded = (lower: number, upper: number, box: Bounds): boolean =>
        fills.some((fill) => fill.order > lower && fill.order < upper && contains(fill.bounds, box))

    const list = [...blocks.values()]
    // Near an edge. A zoom crops what moves with the camera on purpose, so it leaves only pinned text to judge.
    if (margin > 0) {
        for (const block of list) {
            if (zoomed && !pinned(block.id)) continue
            const { x, y, width: w, height: h } = block.bounds
            const gaps: [string, number][] = [['left', x], ['top', y], ['right', width - x - w], ['bottom', height - y - h]]
            const [edge, gap] = gaps.reduce((least, entry) => (entry[1] < least[1] ? entry : least))
            // Text past the edge is already `film.off_canvas`.
            if (gap < -EDGE_TOLERANCE || gap >= margin) continue
            findings.push({
                key: `film.text_edge:${block.source}`,
                code: 'film.text_edge', severity: 'warning', time, box: block.bounds,
                message: `Text ${JSON.stringify(block.source)} is ${Math.max(0, Math.floor(gap))} px from the ${edge} edge of the frame. Leave ${Math.ceil(margin)} px or more.`,
                text: block.source,
            })
        }
    }
    // Too near to a mark. A mark that enters a letter is `film.text_crossed`, or a highlight that is there on purpose.
    if (limits.gap > 0) {
        for (const block of list) {
            const size = block.size || Math.max(...block.glyphs.map((glyph) => glyph.box.height)) / 0.7
            const room = Math.min(size * limits.gap, Math.min(width, height) * TEXT_GAP_CAP)
            const owner = layoutOwner(block.id)
            const first = Math.min(...block.glyphs.map((glyph) => glyph.order))
            const middleX = block.bounds.x + block.bounds.width / 2, middleY = block.bounds.y + block.bounds.height / 2
            let least = Infinity, spills = false
            for (const mark of outlines) {
                const reach = room + mark.half
                const near = pad(mark.bounds, reach)
                if (!intersects(near, block.bounds)) continue
                // An object places its own labels beside its own marks. A line of the film may pass such a label, as a
                // curve passes the numbers of an axes. A shape of the film that bounds it, such as a panel, is judged.
                if (owner && (within(mark.node, owner) || !mark.closed)) continue
                // The distance is to the letters. The box of a block of two lines has empty corners.
                let gap = Infinity
                for (const glyph of block.glyphs) {
                    if (!intersects(near, glyph.box)) continue
                    gap = Math.min(gap, outlineGap(mark.path, glyph.box, reach))
                    if (gap === 0) break
                }
                if (gap === Infinity) continue
                // A backing that covers the text and its room hides the mark there.
                if (mark.order < first && plates.some((plate) => plate.order > mark.order && plate.order < first && contains(plate.bounds, pad(block.bounds, room)))) continue
                if (gap > 0) {
                    least = Math.min(least, Math.max(0, gap - mark.half))
                } else if (mark.half === 0 && mark.order < first
                    && middleX > mark.bounds.x && middleX < mark.bounds.x + mark.bounds.width
                    && middleY > mark.bounds.y && middleY < mark.bounds.y + mark.bounds.height) {
                    // The text sits on a filled shape and runs over its edge, such as a label that is wider than its dot.
                    spills = true
                }
            }
            if (!spills && least >= room) continue
            const name = JSON.stringify(block.source)
            findings.push({
                // Two texts with the same words are two findings, so the key is the node.
                key: `film.text_crowded:${block.id.mounted ? block.id.id : 'dynamic'}:${block.source}`,
                code: 'film.text_crowded', severity: 'warning', time, box: pad(block.bounds, room),
                message: spills
                    ? `Text ${name} is larger than the shape that it sits on.`
                    : `Text ${name} is ${Math.floor(least + 1e-6)} px from a mark. Leave ${Math.ceil(room)} px or more.`,
                text: block.source,
            })
        }
    }
    for (let i = 0; i < list.length; i++) {
        const a = list[i]!
        for (let j = i + 1; j < list.length; j++) {
            const b = list[j]!
            if (!intersects(a.bounds, b.bounds)) continue
            let hit: Bounds | null = null
            for (const ga of a.glyphs) {
                if (!intersects(ga.box, b.bounds)) continue
                for (const gb of b.glyphs) {
                    const shared = intersection(ga.box, gb.box)
                    if (!shared) continue
                    const smaller = Math.min(ga.box.width * ga.box.height, gb.box.width * gb.box.height)
                    if (smaller <= 0 || (shared.width * shared.height) / smaller < MIN_OVERLAP) continue
                    if (occluded(Math.min(ga.order, gb.order), Math.max(ga.order, gb.order), ga.order < gb.order ? ga.box : gb.box)) continue
                    hit = hit ? union(hit, shared) : shared
                }
            }
            if (hit) {
                findings.push({
                    key: `film.text_overlap:${a.source}|${b.source}`,
                    code: 'film.text_overlap', severity: 'error', time, box: hit,
                    message: `Text ${JSON.stringify(a.source)} overlaps text ${JSON.stringify(b.source)}.`,
                    text: a.source, other: b.source,
                })
            }
        }
    }

    for (const block of list) {
        for (const { op, order, contrast } of strokes) {
            const strokeBox = pathBounds(op.strokePath)
            if (!strokeBox || !intersects(pad(strokeBox, op.strokeWidth), block.bounds)) continue
            let hit: Bounds | null = null
            for (const glyph of block.glyphs) {
                const target = inset(glyph.box, GLYPH_INSET)
                if (!intersects(strokeBox, target)) continue
                if (!strokeHitsBox(op.strokePath, target)) continue
                if (order < glyph.order && occluded(order, glyph.order, glyph.box)) continue
                hit = hit ? union(hit, glyph.box) : glyph.box
            }
            if (hit) {
                const strong = op.strokeWidth >= CROSSING_ERROR_WIDTH && contrast >= CROSSING_ERROR_CONTRAST
                findings.push({
                    key: `film.text_crossed:${block.source}:${ownerKey(op.node)}`,
                    code: 'film.text_crossed', severity: strong ? 'error' : 'warning', time, box: hit,
                    message: `A stroke crosses text ${JSON.stringify(block.source)}.`,
                    text: block.source,
                })
            }
        }
    }
    return findings
}

/** True when a frame holds something a viewer can see at or below `top`. */
function hasContent(frame: Frame, top: number): boolean {
    return frame.ops.some((op: DrawOp) => {
        if (op.kind === 'image') {
            const box = imageOpBounds(op)
            return op.alpha >= BLANK_ALPHA && imageHasVisiblePixels(op.image.asset, op.image.crop)
                && box.y + box.height > top && box.y < frame.height && box.x + box.width > 0 && box.x < frame.width
        }
        const filled = op.fill !== null && op.fillAlpha >= BLANK_ALPHA
        const stroked = op.stroke !== null && op.strokeAlpha >= BLANK_ALPHA && op.strokeWidth > 0
        if (!filled && !stroked) return false
        const box = pathBounds(filled ? op.path : op.strokePath)
        return box !== null && box.y + box.height > top && box.y < frame.height && box.x + box.width > 0 && box.x < frame.width
    })
}

/** One text in one frame, for the scan that measures how long a text stays up. */
interface ShownText {
    source: string
    words: string
    alpha: number
    box: Bounds
    /** The glyphs that the frame drew. */
    glyphs: number
    /** The glyphs that a viewer can read: those that are not still fading in or out. */
    bright: number
}

/** The time that one text stays up, as frame numbers, with what a reader took in. */
interface TextRun {
    from: number
    to: number
    source: string
    /** The name of the text from frame to frame: its words, with each number as one sign. */
    words: string
    /** Where the text was when it showed the most. */
    box: Bounds
    /** The readable glyphs and the opacity of the frame that `box` comes from. */
    best: [number, number]
    /** Every place that the text was at. */
    area: Bounds
    /** The most glyphs that one frame drew. */
    glyphs: number
    /** The frames in which a viewer could read some of it. */
    up: number
    /** The last of those frames. */
    lastUp: number
    /** The characters that a reader has taken in so far. */
    read: number
    /** The reader knew every word when the text came: it is what stays of a longer text. */
    known: boolean
    /** A viewer could read it on a frame where a stepped film waits. */
    held: boolean
}

/**
 * The seconds that a viewer needs to read a plain text on screen: 20 characters in one second, and half a
 * second at least. The motion scan of `checkFilm` uses the same limit for `film.text_brief`. Use it for the
 * time that a text stays up, such as `s.wait(readingSeconds('one forecast drifts, and the law breaks'))`.
 * For a formula, the scan counts the signs that it draws, which are fewer than the characters of its source.
 */
export function readingSeconds(text: string, speed = READING_SPEED): number {
    if (!(speed > 0)) throw new Error('readingSeconds: speed is a number of characters in one second, more than 0')
    return Math.max(READING_MIN_SECONDS, text.replace(/\s+/g, ' ').trim().length / speed)
}

// A word has two letters or more. "12 s", "7.04 e-3" and "x" are a number or a sign, and take no time to read.
const hasWord = /\p{L}{2}/u
// One number, with its sign, its separators and its decimals: "1,000", "-0.25", "12.5".
const aNumber = /[-+−]?\d+(?:[.,]\d+)*/g

const spacesIn = (source: string) => source.match(/ /g)?.length ?? 0

/** The characters of a text, as a subtitle counts them. A formula draws fewer signs than its source has characters. */
function charactersOf(source: string, glyphs: number): number {
    return Math.min(source.length, glyphs + spacesIn(source))
}

/**
 * The texts that a viewer can see in a frame, by a name that lasts from frame to frame. A dynamic drawing
 * makes new nodes on every frame, and a counter can make a node for each value, so a text goes by its words,
 * with each number as one sign: a number that counts up is one text, not a new text on every frame.
 * Two equal texts at two places are one text. The one that shows the most stands for both.
 */
function shownTexts(frame: Frame, names: WeakMap<Node, { source: string; words: string } | null>): Map<string, ShownText> {
    const blocks = new Map<Node, ShownText>()
    const canvas: Bounds = { x: 0, y: 0, width: frame.width, height: frame.height }
    for (const op of frame.ops) {
        if (op.kind !== 'path' || op.path.length === 0 || !isGlyph(op)) continue
        const alpha = Math.max(op.fillAlpha, op.strokeAlpha)
        if (alpha < MIN_ALPHA) continue
        const block = textBlockOf(op.node!)
        if (!block) continue
        let name = names.get(block)
        if (name === undefined) {
            const source = sourceOf(block).replace(/\s+/g, ' ').trim()
            name = hasWord.test(source) ? { source, words: source.replace(aNumber, '#') } : null
            names.set(block, name)
        }
        if (!name) continue
        const box = pathBounds(op.path)
        if (!box || !intersects(box, canvas)) continue
        const bright = alpha >= BLANK_ALPHA ? 1 : 0
        const seen = blocks.get(block)
        if (seen) {
            seen.alpha = Math.max(seen.alpha, alpha)
            seen.box = union(seen.box, box)
            seen.glyphs++
            seen.bright += bright
        } else {
            blocks.set(block, { source: name.source, words: name.words, alpha, box, glyphs: 1, bright })
        }
    }
    const shown = new Map<string, ShownText>()
    for (const text of blocks.values()) {
        const seen = shown.get(text.words)
        if (!seen || text.bright > seen.bright || (text.bright === seen.bright && text.glyphs > seen.glyphs)) shown.set(text.words, text)
    }
    return shown
}

/**
 * The run that a new text is related to, if any: a text that ended a moment before at the same place, where
 * one of the two starts with the other. A text that is typed out, or a formula that morphs into a longer one,
 * goes on as one text.
 */
function related(closed: readonly TextRun[], text: ShownText, index: number, gap: number): TextRun | null {
    for (let k = closed.length - 1; k >= 0; k--) {
        const last = closed[k]!
        if (last.to < index - 1 - gap) break
        if (last.words === text.words || !intersects(last.area, text.box)) continue
        if (text.words.startsWith(last.words) || last.words.startsWith(text.words)) return last
    }
    return null
}

/** A stretch of consecutive frames, as frame numbers, with the finding from its first frame. */
interface MovingRun {
    from: number
    to: number
    first: Finding
}

/**
 * Inspect a film for layout defects: marks off the canvas, text against an edge of the frame, text with no
 * room beside a mark, text on text, strokes through text, and characters that no font can draw. It looks where the film comes to rest, because objects may
 * cross each other while moving. With `motion`, it also looks at every frame. Runs anywhere, with no rendering.
 */
export async function checkFilm(film: FilmDefinition | CompiledFilm, options: FilmCheckOptions = {}): Promise<FilmCheckReport> {
    try {
        return await inspectFilm(film, options)
    } catch (error) {
        if (!(error instanceof ImageAssetError) && (error as Error)?.name !== 'ImageAssetError') throw error
        const dimensions = isFilm(film) ? new Stage(film.options) : film
        return {
            ok: false, width: dimensions.width, height: dimensions.height,
            duration: isFilm(film) ? 0 : film.duration, sampled: [],
            diagnostics: [{ code: 'film.image_asset', severity: 'error', message: (error as Error).message,
                time: 0, until: 0, box: { x: 0, y: 0, width: 0, height: 0 }, stage: { x: 0, y: 0 } }],
            summary: { errors: 1, warnings: 0 },
        }
    }
}

async function inspectFilm(film: FilmDefinition | CompiledFilm, options: FilmCheckOptions): Promise<FilmCheckReport> {
    const compiled = isFilm(film) ? await film.compile(options) : film
    const times = options.times ? [...options.times] : restingMoments(compiled, options.samples ?? 0)
    const limits: Limits = {
        margin: options.textMargin ?? Math.min(compiled.width, compiled.height) * EDGE_MARGIN,
        gap: options.textGap ?? 0,
    }
    const merged = new Map<string, FilmDiagnostic>()
    for (const time of times) {
        const frame = await frameAt(compiled, time)
        for (const { key, ...finding } of inspect(frame, time, zoomAt(compiled, time) !== 1, compiled.bleed, limits)) {
            const seen = merged.get(key)
            if (seen) {
                seen.until = time
                if (finding.severity === 'error') seen.severity = 'error'
            } else {
                merged.set(key, {
                    ...finding,
                    until: time,
                    stage: { x: 0, y: 0 },
                })
            }
        }
    }

    const frameCount = options.motion ? Math.max(1, Math.round(compiled.duration * compiled.fps)) : 0
    const step = 1 / compiled.fps
    if (options.motion) {
        const top = options.contentTop ?? 0
        const moving = new Map<string, MovingRun[]>()
        const blanks: { from: number; to: number }[] = []
        const speed = options.readingSpeed ?? READING_SPEED
        if (!(Number.isFinite(speed) && speed >= 0)) throw new Error('checkFilm: readingSpeed is a number of characters in one second. 0 turns the rule off')
        const open = new Map<string, TextRun>()
        const closed: TextRun[] = []
        const names = new WeakMap<Node, { source: string; words: string } | null>()
        const gapFrames = Math.round(READING_GAP_SECONDS * compiled.fps)
        // A stepped film waits on the first frame of each chapter after the start, and on its last frame.
        // The player shows those frames.
        const stops = new Set(options.stepped ? [...compiled.chapters.filter((chapter) => chapter.time > 0).map((chapter) => Math.round(chapter.time * compiled.fps)), frameCount - 1] : [])
        for (let index = 0; index < frameCount; index++) {
            const time = index * step
            const frame = await frameAt(compiled, time)
            // Text may pass an edge or a mark on its way in or out, so these two rules look only at rest.
            for (const finding of inspect(frame, time, zoomAt(compiled, time) !== 1, compiled.bleed, { margin: 0, gap: 0 })) {
                // A problem that also shows at rest is already reported, with its own severity.
                if (merged.has(finding.key)) continue
                let runs = moving.get(finding.key)
                if (!runs) moving.set(finding.key, runs = [])
                const last = runs[runs.length - 1]
                if (last && last.to === index - 1) last.to = index
                else runs.push({ from: index, to: index, first: finding })
            }
            if (speed > 0) {
                const shown = shownTexts(frame, names)
                for (const [words, run] of open) {
                    if (shown.has(words)) continue
                    open.delete(words)
                    closed.push(run)
                }
                for (const [words, text] of shown) {
                    let run = open.get(words)
                    if (!run) {
                        const before = related(closed, text, index, gapFrames)
                        if (before && words.length > before.words.length) {
                            // The text grew, so it goes on as one text. The reader keeps what it has read,
                            // and gets no time for the frames between the two.
                            closed.splice(closed.indexOf(before), 1)
                            run = before
                            run.source = text.source
                            run.words = words
                            run.known = false
                        } else {
                            // What stays of a longer text is a new text. The longer one ended, and is judged
                            // as it was. The reader knows the words that stay.
                            const read = before ? Math.min(before.read, charactersOf(text.source, text.glyphs)) : 0
                            run = { from: index, to: index, source: text.source, words, box: text.box, best: [0, 0], area: text.box, glyphs: 0,
                                up: 0, lastUp: -1, read, known: read >= charactersOf(text.source, text.glyphs) * READING_TOLERANCE, held: false }
                        }
                        open.set(words, run)
                    }
                    run.to = index
                    run.area = union(run.area, text.box)
                    run.glyphs = Math.max(run.glyphs, text.glyphs)
                    if (text.bright === 0) continue
                    run.up++
                    run.lastUp = index
                    if (stops.has(index)) run.held = true
                    if (text.bright > run.best[0] || (text.bright === run.best[0] && text.alpha > run.best[1])) {
                        run.best = [text.bright, text.alpha]
                        run.box = text.box
                    }
                    // A reader takes in `speed` characters in one second, of those that are on screen, and
                    // does not go back. So a text that flashes and comes back longer is not read by its flash.
                    const visible = charactersOf(text.source, text.glyphs) * (text.bright / text.glyphs)
                    if (visible > run.read) run.read = Math.min(visible, run.read + speed * step)
                }
            }
            const edge = time < BLANK_EDGE_SECONDS || time > compiled.duration - BLANK_EDGE_SECONDS
            if (!edge && !hasContent(frame, top)) {
                const last = blanks[blanks.length - 1]
                if (last && last.to === index - 1) last.to = index
                else blanks.push({ from: index, to: index })
            }
        }
        const seconds = (frames: number) => Math.round(frames * step * 100) / 100
        for (const [key, runs] of moving) {
            const longest = runs.reduce((best, run) => (run.to - run.from > best.to - best.from ? run : best))
            const { key: _, ...finding } = longest.first
            merged.set(key, {
                ...finding,
                severity: 'warning',
                until: longest.to * step,
                stage: { x: 0, y: 0 },
                motion: { spans: runs.length, seconds: seconds(runs.reduce((sum, run) => sum + run.to - run.from + 1, 0)) },
            })
        }
        interface Brief { run: TextRun; up: number; needs: number; characters: number }
        const brief: Brief[] = []
        for (const run of [...closed, ...open.values()].sort((a, b) => a.from - b.from)) {
            // Text that never leaves its fade, such as a faint mark in the background, is not there to be
            // read. A stepped film waits where `held` is set. And the reader knew what stays of a longer text.
            if (run.up === 0 || run.held || run.known) continue
            // A still, or a film that loops: the text is up from the first frame to the last.
            if (run.from === 0 && run.lastUp >= frameCount - 1) continue
            const characters = charactersOf(run.source, run.glyphs)
            const needs = Math.max(READING_MIN_SECONDS, characters / speed)
            const up = run.up * step
            if (up >= needs * READING_TOLERANCE && run.read >= characters * READING_TOLERANCE) continue
            brief.push({ run, up, needs, characters })
        }
        // Brief texts that belong together are one finding: a label that changes in place, or rows that scroll.
        const chainFrames = Math.round(READING_CHAIN_SECONDS * compiled.fps)
        const moved = (run: TextRun) => run.area.width > run.box.width * 1.5 || run.area.height > run.box.height * 1.5
        const chains: { items: Brief[]; area: Bounds; to: number; moving: boolean }[] = []
        for (const item of brief) {
            const run = item.run
            const chain = chains.find((entry) => {
                // The same words again are the same text, up one more time. That is not a row of texts.
                if (entry.items.some((other) => other.run.words === run.words)) return false
                const last = entry.items[entry.items.length - 1]!.run
                // One text takes the place of another: it starts when the other has left, at the same place.
                const replaces = run.from > last.lastUp && run.from <= last.lastUp + chainFrames && intersects(last.box, run.box)
                // Texts move through one area, one after the other.
                const scrolls = entry.moving && moved(run) && run.from <= entry.to + chainFrames && intersects(entry.area, run.area)
                return replaces || scrolls
            })
            if (chain) {
                chain.items.push(item)
                chain.area = union(chain.area, run.area)
                chain.to = Math.max(chain.to, run.lastUp)
                chain.moving &&= moved(run)
            } else {
                chains.push({ items: [item], area: run.area, to: run.lastUp, moving: moved(run) })
            }
        }
        const quote = (source: string) => JSON.stringify(source.length > 60 ? `${source.slice(0, 57)}...` : source)
        const two = (value: number) => Math.round(value * 100) / 100
        // The same words, up too briefly at several times of the film, are one finding too.
        const repeats = new Map<string, Brief[]>()
        for (const chain of chains) {
            const first = chain.items[0]!
            if (chain.items.length === 1) {
                const seen = repeats.get(first.run.words)
                if (seen) seen.push(first)
                else repeats.set(first.run.words, [first])
                continue
            }
            const names = chain.items.slice(0, 3).map((item) => quote(item.run.source)).join(', ')
            const more = chain.items.length > 3 ? `, and ${chain.items.length - 3} more` : ''
            merged.set(`film.text_brief:row:${first.run.from}`, {
                code: 'film.text_brief', severity: 'warning',
                message: `${chain.items.length} texts follow each other here, and each leaves before a viewer can read it: ${names}${more}.`,
                time: first.run.from * step, until: chain.to * step,
                box: chain.area, stage: { x: 0, y: 0 }, text: first.run.source,
                motion: { spans: chain.items.length, seconds: two(chain.items.reduce((sum, item) => sum + item.up, 0)) },
            })
        }
        for (const [words, items] of repeats) {
            const { run, up, needs, characters } = items[0]!
            const times = items.length > 1 ? ` It comes ${items.length} times, each time too briefly.` : ''
            const ends = run.lastUp >= frameCount - 1 ? ' The film ends here.' : ''
            merged.set(`film.text_brief:${words}`, {
                code: 'film.text_brief', severity: 'warning',
                message: up < needs * READING_TOLERANCE
                    ? `Text ${quote(run.source)} is up for ${two(up)} s. A viewer needs about ${two(needs)} s for its ${characters} characters.${times}${ends}`
                    : `Text ${quote(run.source)} arrives or changes too fast: a viewer reads about ${Math.floor(run.read)} of its ${characters} characters before it leaves.${times}${ends}`,
                time: run.from * step, until: run.lastUp * step,
                box: run.box, stage: { x: 0, y: 0 }, text: run.source,
                motion: { spans: items.length, seconds: two(items.reduce((sum, item) => sum + item.up, 0)) },
            })
        }
        for (const run of blanks) {
            const length = seconds(run.to - run.from + 1)
            if (length < BLANK_MIN_SECONDS) continue
            merged.set(`film.blank:${run.from}`, {
                code: 'film.blank', severity: 'warning',
                message: `Nothing is visible${top > 0 ? ` below y=${top}` : ''} for ${length} s.`,
                time: run.from * step, until: run.to * step,
                box: { x: 0, y: top, width: compiled.width, height: compiled.height - top },
                stage: { x: 0, y: 0 },
                motion: { spans: 1, seconds: length },
            })
        }
    }
    const round = (value: number) => Math.round(value * 100) / 100
    const diagnostics = [...merged.values()].map((entry) => ({
        ...entry,
        time: Math.round(entry.time * 1000) / 1000,
        until: Math.round(entry.until * 1000) / 1000,
        box: { x: round(entry.box.x), y: round(entry.box.y), width: round(entry.box.width), height: round(entry.box.height) },
        stage: {
            x: round(entry.box.x + entry.box.width / 2 - compiled.width / 2),
            y: round(entry.box.y + entry.box.height / 2 - compiled.height / 2),
        },
    })).sort((a, b) => (a.severity === b.severity ? a.time - b.time : a.severity === 'error' ? -1 : 1))
    const errors = diagnostics.filter((entry) => entry.severity === 'error').length
    return {
        ok: errors === 0,
        width: compiled.width,
        height: compiled.height,
        duration: compiled.duration,
        sampled: times.map((time) => Math.round(time * 1000) / 1000),
        ...(options.motion ? { frames: frameCount } : {}),
        diagnostics,
        summary: { errors, warnings: diagnostics.length - errors },
    }
}
