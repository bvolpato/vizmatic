import { isGradient, luminance, over, parseColor, sampleStops, type Paint, type Rgba } from './color'
import type { DrawOp, Frame, PathOp } from './display'
import { imageOpBounds } from './display'
import { imageHasVisiblePixels, ImageAssetError } from './image'
import { CURVE_PIECES, encloses, pieces } from './enclose'
import { apply, pathBounds, polyPath, signedArea, type Bounds, type Path } from './geometry'
import type { Node } from './node'
import { isFilm, isSuspend, Stage, type CompiledFilm, type CompileOverrides, type FilmDefinition } from './stage'

export type FilmDiagnosticCode = 'film.off_canvas' | 'film.text_edge' | 'film.text_crowded' | 'film.text_overlap' | 'film.text_crossed' | 'film.text_brief' | 'film.text_small' | 'film.empty_space' | 'film.missing_glyph' | 'film.blank' | 'film.image_asset'

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
     * Text that is nearer is reported as `film.text_crowded`, and so is text that runs over the edge of the
     * shape or the image that it sits on, and text that a later shape covers in part. The rule never asks for
     * more than 2% of the shorter side of the frame, and for half of the distance inside a shape that holds the
     * text. It looks at the moments at rest, and reports a text and a mark that are too near for one second from
     * there. With `motion`, it also looks at a text and a mark that stay too near for one second while things move.
     * With `times`, it judges each time as a picture. It is off unless this is set, because a plot may put a curve
     * beside a label on purpose.
     */
    textGap?: number
    /**
     * The least size of text on the screen, in pixels of a frame that is 1080 high, such as 26. Text that is
     * smaller at a moment at rest is reported as `film.text_small`: one finding for the labels of one object,
     * and one for the texts of one size. The size is what a viewer sees: the font size, with the scale of the
     * node and the zoom of the camera. It is off unless this is set, because a small text can be a texture,
     * such as rows of a log that scroll.
     */
    textSize?: number
    /**
     * The largest part of the frame that may stay empty in one piece, such as 0.5. The rule looks at the film
     * two times in each second, and reports as `film.empty_space` a rectangle of the frame that is larger than
     * this part and has no content for 4 seconds or more: the picture leaves much of the frame with no use,
     * for long enough to see it. A text, an image, and a line or a shape that a viewer can tell from the
     * background count as content. With 0.5 or more, a picture in the middle of the frame is never reported,
     * however small it is: a title card, one formula. It is off unless this is set, because a scene can leave
     * a part of the frame empty on purpose.
     */
    emptySpace?: number
}

interface Glyph {
    box: Bounds
    order: number
    op: PathOp
    /** The canvas y of the base line of the glyph, or null when it is not known. Found when it is first needed. */
    base?: number | null
}

interface TextBlock {
    id: Node
    source: string
    bounds: Bounds
    glyphs: Glyph[]
    /** Font size in canvas pixels, or 0 when the text node does not record one. */
    size: number
}

/** What the rules that have a setting use. 0 turns a rule off. */
interface Limits {
    /** Least distance between text and an edge of the frame, in pixels. */
    margin: number
    /** Least distance between text and another mark, as a part of the font size. */
    gap: number
    /** Least size of text on the screen, in canvas pixels. */
    size?: number
    /**
     * The texts of each dynamic drawing that have a finding, from frame to frame. A dynamic drawing makes new nodes
     * on every frame, so a text of one goes by the node that drew it, and then by its place or its words.
     */
    places: Map<string, { box: Bounds; words: string; look: number }[]>
}

const EDGE_TOLERANCE = 1
// Text this near to an edge, as a fraction of the shorter side of the frame, reads as a layout mistake.
const EDGE_MARGIN = 0.02
// A large title does not need a gap in proportion: this part of the shorter side of the frame is enough for any text.
const TEXT_GAP_CAP = 0.02
// The border of a shape that holds a text is the frame of that text, and a viewer reads the two as one thing: a
// number in a cell of an array, a word in a pill. So the text needs this part of the room there. A reviewer of two
// narrated films judged numbers at 0.2 of their font size from the cell as fine, and a label at 0.03 as too tight.
const FRAME_ROOM = 0.5
// A film places its marks at whole pixels, and the edge of a letter is between two pixels, so a gap can be half a
// pixel under the distance that the film set. A viewer does not see half a pixel. One pixel is too much: the caption
// that a viewer reported was 8.9 px under its figure, and its room was 9.6 px.
const GAP_TOLERANCE = 0.5
// A size comes through a scale, so a room of 9 px can be 9.0000001 px.
const ROUNDING = 1e-6
// A shape this opaque hides the part of a mark that is under it, as the backing of a label does.
const PLATE = 0.8
// A strike is a level filled bar that is thinner than this part of the font size, with its middle line in the middle
// half of the letters that it crosses. A film draws it in front of the letters on purpose. A bar that cuts into the
// top or the bottom of the letters is not a strike.
const STRIKE = 0.25
const STRIKE_BAND = 0.25
// An underline is a level bar or line that is as thin as a strike, under the text or under a part of it. Its middle
// line is under the base line of the letters over it, by this part of the font size at the most. The tails of
// letters may cross it. A film draws it to mark words, so it is not a mark that the text has no room from.
const UNDERLINE_DEPTH = 0.4
// The ends of an underline are in the box of the text, or outside it by this part of the font size at the most.
// A longer line is a rule, as under a row of a table.
const UNDERLINE_MARGIN = 0.25
// A faint line may run behind a label, as the grid of a plane does: through its letters, over their base line.
// A text sits on a line at its base line, so a faint line there, or under it through the tails of the letters, is a
// mark, as a rule under a row is. The lowest part of the letters over the base line counts as the base line: this
// part of their height.
const BEHIND_BAND = 0.25
// A shape that fills this part of its box hides what is under its box. A round shape hides what is in the shape.
const BOX_FILL = 0.9
// An object can put a label in a box of a size that the film sets, as `lanes` puts a label in a bar. The room of
// that label in that box is this part of its font size at the most, with any setting of the film. So the default
// box of the object passes also when a film asks for more room between its own texts and marks.
const FIT_GAP = 0.3
// A text has no room when the text and one mark are too near for this long. What lasts is the pair of the text and
// the mark, and not a place on the screen: the two may move together, as in a pan. A mark that passes a text for a
// moment, such as a curve that grows, is not that. At a moment at rest, the check looks again after this time.
const HELD_SECONDS = 1
// A motion scan looks for such a pair this many times in one second, at the frame that is nearest to each quarter
// of a second. It reports a pair that is too near at each look of one second: 4 looks in a row. So a stretch of
// less than 0.7 s is never reported, and a stretch of 1.1 s or more always is. Between the two, it depends on
// where the looks fall.
const HELD_RATE = 4
const MIN_ALPHA = 0.08
const MIN_TEXT_ALPHA = 0.15
const MIN_OVERLAP = 0.12
const GLYPH_INSET = 0.12
const MIN_RESTING_MOMENTS = 5
const AUTO_SAMPLES = 12
const CUBIC_STEPS = CURVE_PIECES
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
// A font size is a whole number in most films, and a scale of the camera gives it a small error.
const SIZE_TOLERANCE = 0.05
// A finding for small texts names this many of them.
const SMALL_SHOWN = 5
// For `film.empty_space`, the frame is a grid of cells that are square for a frame of 16 by 9.
const SPACE_COLUMNS = 16
// The rule looks at the film this many seconds apart, and reports a part that stays empty for this long. A scene
// that builds its picture in steps has an empty part for 2 or 3 seconds, and that is no defect.
const SPACE_STEP = 0.5
const SPACE_SECONDS = 4
// Faint grid lines may run behind labels. A reader still reads the label.
const MIN_STROKE_CONTRAST = 1.6
// For `film.text_crowded`, a mark counts from this contrast with what a viewer sees behind it. The rule of a table in
// the `grid` color has 1.45 on the background of the midnight look, and 1.24 at least in the five looks. A row name
// that touches such a rule is the defect that this rule is for. The `surface` color has 1.19 at most, so a panel
// with no border is not a mark.
const MARK_CONTRAST = 1.2
const OPAQUE = 0.9

function solid(paint: Paint): Rgba {
    return isGradient(paint) ? sampleStops(paint.stops, 0.5) : paint as Rgba
}

/** Contrast of a translucent mark against the background, as WCAG defines the ratio. */
function contrastOver(color: Rgba, alpha: number, background: Rgba): number {
    const x = luminance(over(color, alpha, background)), y = luminance(background)
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

/** Liang-Barsky: the part of a segment that is in a box, as two fractions of its length. Null when no part is. */
function segmentInBox(x0: number, y0: number, x1: number, y1: number, box: Bounds): [number, number] | null {
    let t0 = 0, t1 = 1
    const dx = x1 - x0, dy = y1 - y0
    const edges: [number, number][] = [
        [-dx, x0 - box.x], [dx, box.x + box.width - x0],
        [-dy, y0 - box.y], [dy, box.y + box.height - y0],
    ]
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return null
        } else {
            const r = q / p
            if (p < 0) {
                if (r > t1) return null
                if (r > t0) t0 = r
            } else {
                if (r < t0) return null
                if (r < t1) t1 = r
            }
        }
    }
    return t0 <= t1 ? [t0, t1] : null
}

/** Does a segment enter a box? */
function segmentHitsBox(x0: number, y0: number, x1: number, y1: number, box: Bounds): boolean {
    return segmentInBox(x0, y0, x1, y1, box) !== null
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

/** A filled shape or an image that hides what is under it. */
interface Plate {
    order: number
    bounds: Bounds
    path: Path
    node: Node | undefined
    image: boolean
    /** The shape fills its box, as a rectangle does. Found when it is first needed. */
    box?: boolean
}

/** A filled shape or an image, for the color that a viewer sees behind a mark. An image has no one color. */
interface Tint {
    order: number
    bounds: Bounds
    path: Path
    color: Rgba | null
    alpha: number
    /** A face of a 3D scene. A scene is one surface of many small faces. */
    face: boolean
    box?: boolean
}

/** A rectangle hides what is under its box. Any other shape hides what is inside the shape. */
function fillsBox(plate: { bounds: Bounds; path: Path; box?: boolean }): boolean {
    if (plate.box === undefined) {
        let area = 0
        for (const r of plate.path) area += signedArea(r)
        plate.box = Math.abs(area) >= plate.bounds.width * plate.bounds.height * BOX_FILL
    }
    return plate.box
}

function covers(plate: { bounds: Bounds; path: Path; box?: boolean }, x: number, y: number): boolean {
    const b = plate.bounds
    if (x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) return false
    return fillsBox(plate) || encloses(plate.path, x, y)
}

/** The parts of a segment that no backing hides, as fractions of its length. */
function visibleParts(x0: number, y0: number, x1: number, y1: number, backings: readonly Plate[]): [number, number][] {
    let parts: [number, number][] = [[0, 1]]
    const hide = (from: number, to: number) => {
        const next: [number, number][] = []
        for (const part of parts) {
            if (from > part[0]) next.push([part[0], Math.min(part[1], from)])
            if (to < part[1]) next.push([Math.max(part[0], to), part[1]])
        }
        parts = next.filter((part) => part[1] > part[0])
    }
    for (const plate of backings) {
        const inBox = segmentInBox(x0, y0, x1, y1, plate.bounds)
        if (!inBox) continue
        if (fillsBox(plate)) {
            hide(inBox[0], inBox[1])
            continue
        }
        // A round or slanted shape: look at short steps of the part that is in its box.
        const steps = 8, span = inBox[1] - inBox[0]
        for (let k = 0; k < steps; k++) {
            const from = inBox[0] + span * k / steps, to = inBox[0] + span * (k + 1) / steps, middle = (from + to) / 2
            if (encloses(plate.path, x0 + (x1 - x0) * middle, y0 + (y1 - y0) * middle)) hide(from, to)
        }
    }
    return parts
}

/**
 * Distance from the outline of a path to a box. 0 when the outline enters the box. Infinity when it is farther
 * than `reach`. The part of the outline that is under a backing does not count: a viewer does not see it.
 */
function outlineGap(path: Path, box: Bounds, reach: number, backings: readonly Plate[] = []): number {
    let least = Infinity
    const visit = (x0: number, y0: number, x1: number, y1: number) => {
        if (backings.length === 0) {
            least = Math.min(least, segmentBoxGap(x0, y0, x1, y1, box))
        } else {
            const dx = x1 - x0, dy = y1 - y0
            for (const [from, to] of visibleParts(x0, y0, x1, y1, backings)) {
                least = Math.min(least, segmentBoxGap(x0 + dx * from, y0 + dy * from, x0 + dx * to, y0 + dy * to, box))
            }
        }
        return least === 0
    }
    for (const r of path) {
        const p = r.p
        for (let o = 0; o + 7 < p.length; o += 6) {
            // A segment's control hull contains its curve, so most segments reject here.
            const left = Math.min(p[o]!, p[o + 2]!, p[o + 4]!, p[o + 6]!), right = Math.max(p[o]!, p[o + 2]!, p[o + 4]!, p[o + 6]!)
            const top = Math.min(p[o + 1]!, p[o + 3]!, p[o + 5]!, p[o + 7]!), bottom = Math.max(p[o + 1]!, p[o + 3]!, p[o + 5]!, p[o + 7]!)
            if (right < box.x - reach || left > box.x + box.width + reach || bottom < box.y - reach || top > box.y + box.height + reach) continue
            if (pieces(r, o, visit)) return 0
        }
    }
    return least <= reach ? least : Infinity
}

/** The point of the part of an outline that shows that is nearest to the middle of a box, for the side of a mark in a message. */
function nearestPoint(path: Path, box: Bounds, backings: readonly Plate[]): [number, number] | null {
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    let best: [number, number] | null = null, least = Infinity
    const visit = (x0: number, y0: number, x1: number, y1: number) => {
        const dx = x1 - x0, dy = y1 - y0, length = dx * dx + dy * dy
        const middle = length === 0 ? 0 : ((cx - x0) * dx + (cy - y0) * dy) / length
        for (const [from, to] of backings.length === 0 ? [[0, 1]] : visibleParts(x0, y0, x1, y1, backings)) {
            const t = Math.max(from!, Math.min(to!, middle))
            const x = x0 + dx * t, y = y0 + dy * t
            // The distance to the box, and then to its middle, so that a point beside the box wins from a point in line with a corner.
            const gap = Math.hypot(Math.max(box.x - x, 0, x - box.x - box.width), Math.max(box.y - y, 0, y - box.y - box.height)) + Math.hypot(x - cx, y - cy) * 1e-3
            if (gap < least) {
                least = gap
                best = [x, y]
            }
        }
        return false
    }
    for (const r of path) for (let o = 0; o + 7 < r.p.length; o += 6) pieces(r, o, visit)
    return best
}

/**
 * How many times larger a path is on the canvas than in its own node. It compares distances between points,
 * because a rotation keeps those. The height of a box changes when the text turns.
 */
function drawnScale(own: Path, drawn: Path): number {
    const from = own[0]?.p, to = drawn[0]?.p
    if (!from || !to || from.length < 2 || to.length < 2) return 0
    let before = 0, after = 0
    for (let r = 0; r < own.length && r < drawn.length; r++) {
        const p = own[r]!.p, q = drawn[r]!.p
        for (let i = 0; i + 1 < p.length && i + 1 < q.length; i += 2) {
            before += (p[i]! - from[0]!) ** 2 + (p[i + 1]! - from[1]!) ** 2
            after += (q[i]! - to[0]!) ** 2 + (q[i + 1]! - to[1]!) ** 2
        }
    }
    return before > 0 ? Math.sqrt(after / before) : 0
}

/** The node above a node: its parent, or the node whose `draw` built it. A dynamic drawing has no parent. */
function above(node: Node): Node | null {
    return node.parent ?? node.drawer ?? null
}

/**
 * The object that placed a text beside its own marks, such as an axes for its numbers. Null for text that the
 * film placed, and for text that a film added to such an object: only a label with the mark of an object counts.
 */
function layoutOwner(block: Node): { node: Node; plot: boolean } | null {
    let own = false
    for (let current: Node | null = block; current; current = above(current)) {
        const kind = current.data['ownLayout']
        if (kind) return own ? { node: current, plot: kind === 'plot' } : null
        if (current.data['ownLabel']) own = true
    }
    return null
}

function within(node: Node, ancestor: Node): boolean {
    for (let current: Node | null = node; current; current = above(current)) {
        if (current === ancestor) return true
    }
    return false
}

/** The nodes that an object is tied to, such as the two ends of a connector: `data.attached` of the object. */
function attachedTo(node: Node): readonly Node[] {
    const list = node.data['attached']
    return Array.isArray(list) ? list as Node[] : []
}

/** True when a node is one of these targets, is in one, or holds one: a brace can stand under a part of a text. */
function touches(node: Node, targets: readonly Node[]): boolean {
    return targets.some((target) => within(node, target) || within(target, node))
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
    /** For `film.text_crowded`: the names of the marks that are too near to the text. Not a part of a report. */
    pairs?: string[]
    /** For `film.text_small`: the size of the text on the screen, and the object that it is a label of. Not a part of a report. */
    small?: { size: number; group: string; object: string }
}

/** What a viewer sees as a line, a shape or a picture: the outline that text must keep away from. */
interface Mark {
    path: Path
    order: number
    /** The line, or null for a filled shape and for an image. */
    line: PathOp | null
    /** Half the width of the line. */
    half: number
    bounds: Bounds
    node: Node | undefined
    closed: boolean
    image: boolean
    /** A filled shape or an image that hides what is under it. */
    opaque: boolean
    /** The color and the opacity of the mark. An image has no one color. */
    paint: Rgba | null
    alpha: number
    /** `film.text_crossed` looks at this line. It does not look at a line that is faint on the background of the frame. */
    crossed: boolean
    /** The line of the same shape, when this mark is its fill. The fill is the mark only when the line does not show. */
    unless?: Mark
    /** The contrast of the mark with what is behind it. Found when a text is near. */
    contrast?: number
    /** A filled mark fills its box, as a rectangle does. Found when it is first needed. */
    box?: boolean
    /** What the nodes say about the mark. Read when a text is near. */
    traits?: Traits
}

/**
 * What the objects of the library tell this rule, in the `data` of a node:
 * - `ownLayout` and `ownLabel`: an object and the labels that it places. See `ownLabels`.
 * - `decoration`: a box or a highlight that an object draws around a text. It is not a mark for any text.
 * - `attached`: the nodes that an object is tied to, such as the two ends of a connector or the target of a
 *   callout. The distance between the object and such a node is the layout of the object.
 * - `line`: a filled shape that draws a line, such as an arrow or a brace. It may pass a label of a plot.
 * - `border`: an open line that is the border of a shape, such as the frame of a zone with a gap for its title.
 * - `object`: the name of an object of the library for a message, such as `card`. See `nameOf`.
 * - `fit`: on a label that an object puts in a box of a size that the film gives, such as the label in a bar of
 *   `lanes`. The rule judges the room between that label and the box, and ends its message with this sentence,
 *   which says what option to change.
 */
interface Traits {
    decoration: boolean
    lineLike: boolean
    border: boolean
    attached: readonly Node[]
    /** The object that drew the mark, for a message: the label that the film gave it, or the name of the object. */
    who: string
}

function traitsOf(node: Node | undefined): Traits {
    let decoration = false, lineLike = false, who = node ? '' : 'a 3D scene'
    const attached: Node[] = []
    for (let current = node ?? null; current; current = above(current)) {
        if (current.data['decoration']) decoration = true
        if (current.data['line']) lineLike = true
        attached.push(...attachedTo(current))
        if (!who) who = nameOf(current)
    }
    return { decoration, lineLike, border: !!node?.data['border'], attached, who }
}

/**
 * The name of an object for a message: the label that the film gave it with `.named()`, or the name that an object
 * of the library gives itself in `data.object`. The name of a class is not read: a minifier changes it to a letter.
 */
function nameOf(node: Node): string {
    // A pictogram of the library has the label `pictogram:` and its name.
    const drawn = /^pictogram:(.+)$/.exec(node.label ?? '')
    if (drawn) return `the pictogram ${JSON.stringify(drawn[1])}`
    if (node.label) return JSON.stringify(node.label)
    const name = node.data['object']
    return typeof name === 'string' && name ? `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}` : ''
}

/**
 * True when a rule of the library placed a text and a mark at this distance, so that the film cannot change it:
 * - the mark is a decoration, such as a box around a text
 * - an object places its own labels beside its own marks. A mark with no node comes from an object that emits its
 *   marks itself, as a 3D scene does
 * - a film draws data on a plot, so a line may pass a label of the plot, as a curve passes the numbers of an axis.
 *   The border of a zone is not such a line, with a gap for its title or without one
 * - an object that is tied to a node ends at that node, and places its labels beside it: a connector at the word
 *   that it connects, a callout with its note beside its target
 * A label of an object is text of the film for every other mark: a legend that a film puts on the axis of a chart.
 */
function byRule(block: Node, owner: { node: Node; plot: boolean } | null, node: Node | undefined, traits: Traits, closed: boolean): boolean {
    if (traits.decoration) return true
    if (traits.attached.length > 0 && touches(block, traits.attached)) return true
    if (!owner) return false
    if (node ? within(node, owner.node) : owner.node.rawOps !== null) return true
    if (owner.plot && ((!closed && !traits.border) || traits.lineLike)) return true
    return node !== undefined && touches(node, attachedTo(owner.node))
}

/** A mark in words: its kind, and the object that drew it. */
function kindOf(mark: Mark, traits: Traits): string {
    const of = traits.who ? ` of ${traits.who}` : ''
    if (mark.image) return `an image${of}`
    if (!mark.line) return `${traits.lineLike ? 'a line' : 'a filled shape'}${of}`
    if (!mark.closed) return traits.border ? `the border${of || ' of a shape'}` : `a line${of}`
    let area = 0
    for (const r of mark.path) area += signedArea(r)
    return `the border of a ${Math.abs(area) >= mark.bounds.width * mark.bounds.height * BOX_FILL ? 'box' : 'shape'}${of}`
}

/** The side of a text where a mark is. */
function sideOf(path: Path, box: Bounds, backings: readonly Plate[]): string {
    const point = nearestPoint(path, box, backings)
    if (!point) return ''
    const [x, y] = point
    let dx = x < box.x ? x - box.x : x > box.x + box.width ? x - box.x - box.width : 0
    let dy = y < box.y ? y - box.y : y > box.y + box.height ? y - box.y - box.height : 0
    if (dx === 0 && dy === 0) {
        // The point is in the box of the text: take the edge of the box that it is nearest to.
        dx = (x - box.x - box.width / 2) / (box.width || 1)
        dy = (y - box.y - box.height / 2) / (box.height || 1)
        if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return 'between its letters'
    }
    return Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'above it' : 'below it') : (dx < 0 ? 'left of it' : 'right of it')
}

/**
 * For each zone, the items whose box is in the zone. A grid finds them, so that the work does not grow with
 * the number of texts times the number of marks.
 */
function nearZones<T extends { bounds: Bounds }>(zones: readonly Bounds[], items: readonly T[], reach: (item: T) => number): T[][] {
    const size = 128, limit = 120
    const cell = (value: number) => Math.max(-limit, Math.min(limit, Math.floor(value / size)))
    const cells = new Map<number, number[]>()
    zones.forEach((zone, index) => {
        for (let cx = cell(zone.x); cx <= cell(zone.x + zone.width); cx++) {
            for (let cy = cell(zone.y); cy <= cell(zone.y + zone.height); cy++) {
                const key = cx * 1024 + cy
                const list = cells.get(key)
                if (list) list.push(index)
                else cells.set(key, [index])
            }
        }
    })
    const out: T[][] = zones.map(() => [])
    const seen = new Int32Array(zones.length).fill(-1)
    items.forEach((item, at) => {
        const extra = reach(item), b = item.bounds
        const x = b.x - extra, y = b.y - extra, right = b.x + b.width + extra, bottom = b.y + b.height + extra
        const test = (index: number) => {
            if (seen[index] === at) return
            seen[index] = at
            const zone = zones[index]!
            if (x < zone.x + zone.width && zone.x < right && y < zone.y + zone.height && zone.y < bottom) out[index]!.push(item)
        }
        const x0 = cell(x), x1 = cell(right), y0 = cell(y), y1 = cell(bottom)
        // A mark as large as the frame is in more cells than there are texts.
        if ((x1 - x0 + 1) * (y1 - y0 + 1) >= zones.length) {
            for (let index = 0; index < zones.length; index++) test(index)
            return
        }
        for (let cx = x0; cx <= x1; cx++) {
            for (let cy = y0; cy <= y1; cy++) {
                const list = cells.get(cx * 1024 + cy)
                if (list) for (const index of list) test(index)
            }
        }
    })
    return out
}

/** The object that drew a node, for a message. */
function whoOf(node: Node | undefined): string {
    for (let current = node ?? null; current; current = above(current)) {
        const name = nameOf(current)
        if (name) return ` of ${name}`
    }
    return ''
}

/** Two boxes are one place when they share more than half of the smaller one. */
function samePlace(a: Bounds, b: Bounds): boolean {
    const shared = intersection(a, b)
    return shared !== null && shared.width * shared.height > Math.min(a.width * a.height, b.width * b.height) / 2
}

// Three points across a letter and three down it: enough to see that a shape covers a part of the letter.
const THIRDS = [1 / 6, 1 / 2, 5 / 6]

/**
 * True for a strike: a level bar that is thin for the text, with its middle line in the middle half of the letters
 * that it crosses. A bar at the top or the bottom of the letters cuts them, and it is not a strike.
 */
function isStrike(bar: Bounds, block: TextBlock, size: number): boolean {
    if (bar.height >= size * STRIKE || bar.width <= bar.height) return false
    let top = Infinity, bottom = -Infinity
    for (const glyph of block.glyphs) {
        if (!intersects(bar, glyph.box)) continue
        top = Math.min(top, glyph.box.y)
        bottom = Math.max(bottom, glyph.box.y + glyph.box.height)
    }
    const middle = bar.y + bar.height / 2
    return middle >= top + (bottom - top) * STRIKE_BAND && middle <= bottom - (bottom - top) * STRIKE_BAND
}

/**
 * The canvas y of the base line of a glyph that stands upright. The node of the glyph records its base line in
 * its own units, in `data.base`. Null for a glyph with no record, and for one that is turned or drawn in part.
 */
function baseLine(glyph: Glyph): number | null {
    if (glyph.base !== undefined) return glyph.base
    const node = glyph.op.node, base = node?.data['base'], own = node?.get('path') ?? []
    const p = own[0]?.p, q = glyph.op.path[0]?.p
    if (typeof base !== 'number' || !p || !q || p.length < 2 || q.length < 2) return glyph.base = null
    const scale = drawnScale(own, glyph.op.path)
    // An upright glyph has each point of its first ring where the scale alone puts it.
    for (let i = 2; i + 1 < p.length && i + 1 < q.length; i += 2) {
        if (Math.abs(q[i]! - q[0]! - (p[i]! - p[0]!) * scale) > 0.5 || Math.abs(q[i + 1]! - q[1]! - (p[i + 1]! - p[1]!) * scale) > 0.5) return glyph.base = null
    }
    return glyph.base = q[1]! + (base - p[1]!) * scale
}

/** The box of the ink of a mark that is a level bar: a straight level line, or a filled rectangle. Null for any other mark. */
function levelBar(mark: Mark): Bounds | null {
    const b = mark.bounds
    if (mark.image) return null
    if (mark.line) return b.height <= 1 ? { x: b.x, y: b.y - mark.half, width: b.width, height: b.height + mark.half * 2 } : null
    return fillsBox(mark) ? b : null
}

/**
 * True for an underline of this text: a level bar that is thin for the text, with its ends in the box of the text,
 * and with its middle line under the base line of the letters over it, by `UNDERLINE_DEPTH` of the font size at the
 * most. A bar over the base line cuts the letters, so it is not an underline.
 */
function isUnderline(bar: Bounds, block: TextBlock, size: number): boolean {
    if (bar.height >= size * STRIKE || bar.width <= bar.height) return false
    const margin = size * UNDERLINE_MARGIN
    if (bar.x < block.bounds.x - margin || bar.x + bar.width > block.bounds.x + block.bounds.width + margin) return false
    const middle = bar.y + bar.height / 2
    // The letters over the bar are on the lowest line of the text whose base line is over the middle line of the bar.
    let base = -Infinity
    for (const glyph of block.glyphs) {
        if (glyph.box.x + glyph.box.width <= bar.x || glyph.box.x >= bar.x + bar.width) continue
        const line = baseLine(glyph)
        if (line === null) return false
        if (line < middle && line > base) base = line
    }
    return middle - base <= size * UNDERLINE_DEPTH
}

/**
 * The name of a mark that stays the same from frame to frame, so that the check can follow a text and a mark that
 * are too near. A node on the stage has an id. A dynamic drawing makes new nodes for each frame, so its marks go by
 * the node that draws them and by their kind. A mark with no node is of a 3D scene.
 */
function markName(node: Node | undefined, kind: string): string {
    if (!node) return `scene:${kind}`
    if (node.mounted) return String(node.id)
    let drawer: Node | null = node
    while (drawer && !drawer.mounted) drawer = above(drawer)
    return `${drawer ? drawer.id : 'dynamic'}:${kind}`
}

/**
 * For each line of a text, the box where a faint line may run behind the letters: from their tops to a little over
 * their base line. The glyphs of one line have one base line. A text with no base line on record is one line, and
 * the bottom of its letters stands for its base line.
 */
function bodies(block: TextBlock, size: number): Bounds[] {
    const known = block.glyphs.every((glyph) => baseLine(glyph) !== null)
    const rows: { base: number; glyphs: Glyph[] }[] = []
    for (const glyph of block.glyphs) {
        const base = known ? baseLine(glyph)! : 0
        const row = rows.find((entry) => Math.abs(entry.base - base) < size * BEHIND_BAND)
        if (row) row.glyphs.push(glyph)
        else rows.push({ base, glyphs: [glyph] })
    }
    return rows.map(({ base, glyphs }) => {
        let first = glyphs[0]!.box, last = first, top = Infinity, bottom = -Infinity
        for (const { box } of glyphs) {
            if (box.x < first.x) first = box
            if (box.x + box.width > last.x + last.width) last = box
            top = Math.min(top, box.y)
            bottom = Math.max(bottom, box.y + box.height)
        }
        const foot = known ? base : bottom
        // The outer part of a letter does not count for a line through text. It does not count here.
        const left = first.x + first.width * GLYPH_INSET, right = last.x + last.width * (1 - GLYPH_INSET)
        return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, (foot - top) * (1 - BEHIND_BAND)) }
    })
}

let looks = 0

interface CrowdedInput {
    time: number
    width: number
    height: number
    background: Rgba
    blocks: readonly TextBlock[]
    outlines: readonly Mark[]
    plates: readonly Plate[]
    faces: readonly { path: Path; bounds: Bounds }[]
    /** Every fill and every image, in the order of drawing. */
    tints: readonly Tint[]
    crossing: (block: TextBlock, op: PathOp, order: number) => Bounds | null
    limits: Limits
}

/**
 * `film.text_crowded`: text with no room beside a mark, text that starts on a shape and leaves it, and text
 * that a shape in front of it covers in part.
 */
function crowdedText({ time, width, height, background, blocks, outlines, plates, faces, tints, crossing, limits }: CrowdedInput): Finding[] {
    const findings: Finding[] = []
    // Each look at a frame has a number, so that two texts of one frame do not take the name of one earlier text.
    const look = ++looks
    /**
     * The contrast of a mark with what a viewer sees behind it: the fills that are drawn before the mark, one over
     * the other, over the background of the frame. A dark rule on a light card is a mark, and a white line on that
     * card is not. For a line, a fill counts when it holds the line, because a long line can leave a small shape.
     * For a filled shape, a fill counts when it is behind the middle of the shape: a plate on a surface of many
     * small faces is on no one face. An image has no one color, so a mark on an image counts, and so does an image.
     */
    const contrastOf = (mark: Mark): number => {
        if (mark.contrast !== undefined) return mark.contrast
        if (!mark.paint) return mark.contrast = Infinity
        const x = mark.bounds.x + mark.bounds.width / 2, y = mark.bounds.y + mark.bounds.height / 2
        let behind: Rgba | null = background
        for (const tint of tints) {
            if (tint.order >= mark.order) break
            if (!(mark.line === null || tint.face || contains(tint.bounds, mark.bounds)) || !covers(tint, x, y)) continue
            if (!tint.color) behind = null
            else if (behind || tint.alpha * tint.color[3] >= PLATE) behind = over(tint.color, tint.alpha, behind ?? background)
        }
        return mark.contrast = behind ? contrastOver(mark.paint, mark.alpha, behind) : Infinity
    }
    /**
     * A mark that a viewer sees. The fill of a shape with a strong line is not a mark: the line is. A line is strong
     * when one of the two rules judges it also where it runs through letters. Behind a faint line, the fill is a mark too.
     */
    const strong = (line: Mark): boolean => line.crossed || contrastOf(line) >= MIN_STROKE_CONTRAST
    const shows = (mark: Mark): boolean => contrastOf(mark) >= MARK_CONTRAST && !(mark.unless && strong(mark.unless))
    const sizes = blocks.map((block) => block.size || Math.max(...block.glyphs.map((glyph) => glyph.box.height)) / 0.7)
    const rooms = sizes.map((size) => Math.min(size * limits.gap, Math.min(width, height) * TEXT_GAP_CAP))
    // Only a mark whose box is within the room of a text can be too near to it.
    const zones = blocks.map((block, index) => pad(block.bounds, rooms[index]!))
    const marksNear = nearZones(zones, outlines, (mark) => mark.half)
    const platesNear = nearZones(zones, plates, () => 0)
    const facesNear = nearZones(zones, faces, () => 0)

    blocks.forEach((block, index) => {
        const size = sizes[index]!, room = rooms[index]!
        const owner = layoutOwner(block.id)
        const count = block.glyphs.length
        let first = Infinity, last = -Infinity
        for (const glyph of block.glyphs) {
            first = Math.min(first, glyph.order)
            last = Math.max(last, glyph.order)
        }
        const middleX = block.bounds.x + block.bounds.width / 2, middleY = block.bounds.y + block.bounds.height / 2
        const right = block.bounds.x + block.bounds.width, bottom = block.bounds.y + block.bounds.height
        // An opaque shape that is drawn after a mark hides the part of the mark that is behind it: the backing of a label does.
        const backings = platesNear[index]!

        // The opaque shapes that are drawn after the text, in front of it. A strike is one that a film draws on purpose.
        const front = backings.filter((plate) => plate.order > last && !byRule(block.id, owner, plate.node, traitsOf(plate.node), true))
        let covered: Plate | null = null
        if (front.length > 0) {
            let points = 0, hidden = 0
            for (const glyph of block.glyphs) {
                for (const down of THIRDS) {
                    for (const across of THIRDS) {
                        const x = glyph.box.x + glyph.box.width * across, y = glyph.box.y + glyph.box.height * down
                        const by = front.filter((plate) => covers(plate, x, y))
                        points++
                        if (by.length > 0) hidden++
                        covered ??= by.find((plate) => !isStrike(plate.bounds, block, size) && !(fillsBox(plate) && isUnderline(plate.bounds, block, size))) ?? null
                    }
                }
            }
            // A viewer does not see text that is all behind shapes, one shape or more, so it has no finding.
            if (hidden === points) return
        }

        // The mark that leaves the least part of the room that the text needs from it. No mark stands for the surface of a 3D scene.
        let nearest: { gap: number; needs: number; mark: Mark | null; hiding: readonly Plate[]; holds: boolean } | null = null
        let over = ''
        // Each mark that is too near, by its name: the finding names one of them, and the check follows each of them.
        const pairs = new Set<string>()
        const nameOfMark = (mark: Mark | null): string => (mark ? markName(mark.node, mark.image ? 'image' : mark.line ? 'line' : 'fill') : 'scene:surface')
        const judge = (gap: number, needs: number, mark: Mark | null, hiding: readonly Plate[] = [], holds = false) => {
            if (gap >= needs - GAP_TOLERANCE) return
            pairs.add(nameOfMark(mark))
            if (!nearest || gap / needs < nearest.gap / nearest.needs) nearest = { gap, needs, mark, hiding, holds }
        }
        // A shape holds the text when the box of each letter is in it: a cell, a pill, a card. A strike through a word
        // holds no letter. The box of the whole text has empty corners, which a round plate cuts.
        const inside = (bounds: Bounds, path: Path): boolean => contains(bounds, block.bounds) && block.glyphs.every(({ box }) =>
            encloses(path, box.x, box.y) && encloses(path, box.x + box.width, box.y) && encloses(path, box.x + box.width, box.y + box.height) && encloses(path, box.x, box.y + box.height))
        const held = new Map<Mark, boolean>()
        // The frame of a zone is open where its title is.
        const holds = (mark: Mark): boolean => {
            let known = held.get(mark)
            if (known === undefined) held.set(mark, known = (mark.closed || mark.traits!.border) && inside(mark.bounds, mark.path))
            return known
        }
        // An object puts this label in a box of a size that the film gives. The room in that box is then a choice of the film.
        const fit = typeof block.id.data['fit'] === 'string' ? block.id.data['fit'] : ''
        const fitted = new Set<Mark>()
        const visible = marksNear[index]!.filter(shows)
        const judged = visible.filter((mark) => {
            if (!byRule(block.id, owner, mark.node, mark.traits ??= traitsOf(mark.node), mark.closed)) return true
            if (!fit || !mark.node || !owner || !within(mark.node, owner.node) || !holds(mark)) return false
            fitted.add(mark)
            return true
        })
        // The shapes that a viewer sees around the text, also the box of the object that placed the text. A mark on the
        // other side of the border of such a shape is not near the text. The room of the text is to the border.
        const frames = visible.filter((mark) => !mark.traits!.decoration && holds(mark))
        const holders = judged.filter(holds)
        let inner: Bounds[] | undefined
        for (const mark of judged) {
            // An underline of this text is not a mark for this text. It excuses no other mark.
            const bar = levelBar(mark)
            if (bar && isUnderline(bar, block, size)) continue
            // A faint line that runs through the letters, over their base line, is behind the label. No rule reports it.
            if (mark.line && !strong(mark) && intersects(mark.bounds, block.bounds) && (inner ??= bodies(block, size)).some((box) => strokeHitsBox(mark.path, box))) continue
            const traits = mark.traits!
            const reach = room + mark.half
            const near = pad(mark.bounds, reach)
            // Only a shape that reaches the box of the mark can hide a part of it. Many small shapes near a text hide nothing of each other.
            const reached = pad(mark.bounds, mark.half)
            const hiding = backings.filter((plate) => plate.order > mark.order && intersects(plate.bounds, reached))
            // The distance is to the letters. The box of a block of two lines has empty corners.
            // `gap` is to the middle of a line, and `clear` is to the part of the mark that a viewer sees.
            let gap = Infinity, clear = Infinity
            for (const glyph of block.glyphs) {
                if (!intersects(near, glyph.box)) continue
                const plain = outlineGap(mark.path, glyph.box, reach)
                if (plain === Infinity) continue
                const to = hiding.length === 0 ? plain : outlineGap(mark.path, glyph.box, reach, hiding)
                if (to === Infinity) continue
                gap = Math.min(gap, to)
                if (to === 0) break
                let seen = to - mark.half
                if (to > plain) {
                    // A backing hides the nearest part of this mark. So it hides the width of the line too, as far as its own edge.
                    for (const plate of hiding) {
                        if (fillsBox(plate) && contains(plate.bounds, glyph.box)) seen = Math.max(seen, Math.min(glyph.box.x - plate.bounds.x, glyph.box.y - plate.bounds.y,
                            plate.bounds.x + plate.bounds.width - glyph.box.x - glyph.box.width, plate.bounds.y + plate.bounds.height - glyph.box.y - glyph.box.height))
                    }
                }
                clear = Math.min(clear, Math.max(seen, 0))
            }
            const under = !mark.line && mark.order < first
            // The letters that are on a shape or a picture under the text.
            let on = 0
            if (under && intersects(mark.bounds, block.bounds)) {
                for (const glyph of block.glyphs) {
                    const x = glyph.box.x + glyph.box.width / 2, y = glyph.box.y + glyph.box.height / 2
                    if (encloses(mark.path, x, y) && !hiding.some((plate) => covers(plate, x, y))) on++
                }
            }
            if (on > 0 && (on < count || gap === 0)) {
                // The text starts on the shape and leaves it, such as a label that is wider than its dot.
                const wider = block.bounds.x < mark.bounds.x && right > mark.bounds.x + mark.bounds.width
                const taller = block.bounds.y < mark.bounds.y && bottom > mark.bounds.y + mark.bounds.height
                const what = `the ${mark.image ? 'image' : 'filled shape'}${traits.who ? ` of ${traits.who}` : ''} behind it`
                over = wider ? `is wider than ${what}` : taller ? `is taller than ${what}` : over || `runs past the edge of ${what}`
                pairs.add(nameOfMark(mark))
            } else if (gap === Infinity) {
                continue
            } else if (gap > 0) {
                const holder = holders.includes(mark)
                // A mark on the other side of the border of a shape that holds the text is not near the text: the border is
                // between the two. The point is taken 1 px farther from the text, for a line that starts on the border.
                if (!holder && frames.length > 0) {
                    const point = nearestPoint(mark.path, block.bounds, hiding)
                    if (point) {
                        const away = Math.hypot(point[0] - middleX, point[1] - middleY) || 1
                        const x = point[0] + (point[0] - middleX) / away, y = point[1] + (point[1] - middleY) / away
                        if (frames.some((frame) => !encloses(frame.path, x, y))) continue
                    }
                }
                judge(clear, fitted.has(mark) ? Math.min(room, size * FIT_GAP) * FRAME_ROOM : holder ? room * FRAME_ROOM : room, mark, hiding, holder)
            } else if (mark.line) {
                // A line that runs through the letters is `film.text_crossed`. A line that only enters them is here.
                // That rule does not look at a line that is faint on the background of the frame. So a faint line
                // that cuts the letters is here, and so is a line that is strong on its card and not on the frame.
                if (!mark.crossed || !crossing(block, mark.line, mark.order)) judge(0, room, mark)
            } else if (under) {
                judge(0, room, mark)
            } else if (mark.opaque && !isStrike(mark.bounds, block, size)) {
                // An opaque shape that is drawn after the text and touches it. A shape that covers a part of a letter is found above.
                judge(0, room, mark)
            }
            // What is left is a strike, or a highlight in front of the letters that they show through.
        }

        // The faces of a 3D scene are one surface. Text on the surface is not near a mark, and text beside it is.
        const surface = facesNear[index]!
        if (surface.length > 0 && !(owner && owner.node.rawOps !== null)) {
            let on = 0
            for (const glyph of block.glyphs) {
                const x = glyph.box.x + glyph.box.width / 2, y = glyph.box.y + glyph.box.height / 2
                if (surface.some((face) => x >= face.bounds.x && x <= face.bounds.x + face.bounds.width && y >= face.bounds.y && y <= face.bounds.y + face.bounds.height && encloses(face.path, x, y))) on++
            }
            if (on === 0) {
                let gap = Infinity
                for (const glyph of block.glyphs) {
                    const zone = pad(glyph.box, room)
                    for (const face of surface) {
                        if (gap > 0 && intersects(face.bounds, zone)) gap = Math.min(gap, outlineGap(face.path, glyph.box, room))
                    }
                }
                if (gap !== Infinity) judge(gap, room, null)
            } else if (on < count) {
                over ||= 'runs past the edge of the surface of a 3D scene behind it'
                pairs.add('scene:surface')
            }
        }

        const found = nearest as { gap: number; needs: number; mark: Mark | null; hiding: readonly Plate[]; holds: boolean } | null
        if (!covered && !over && !found) return
        // A line of code has no words of its own. The code block records them.
        const recorded = block.id.data['source']
        const source = block.source || (typeof recorded === 'string' ? recorded : '')
        const words = JSON.stringify(source)
        let message = `Text ${words} ${over}.`
        if (covered) {
            message = `Text ${words} is partly behind ${covered.image ? 'an image' : 'a filled shape'}${whoOf(covered.node)}.`
        } else if (!over && found) {
            let what = found.mark ? `${kindOf(found.mark, found.mark.traits!)} ${sideOf(found.mark.path, block.bounds, found.hiding)}`.trimEnd() : 'the surface of a 3D scene'
            // A band or a pill behind the text holds the text. It is not below the text: its edge is.
            if (found.mark && found.holds && !found.mark.line && !found.mark.image && found.mark.order < first) {
                const edge = { 'above it': 'upper ', 'below it': 'lower ', 'left of it': 'left ', 'right of it': 'right ' }[sideOf(found.mark.path, block.bounds, found.hiding)] ?? ''
                what = `the ${edge}edge of the filled shape${found.mark.traits!.who ? ` of ${found.mark.traits!.who}` : ''} behind it`
            }
            const px = Math.floor(found.gap + ROUNDING)
            const leave = `Leave ${Math.ceil(found.needs - ROUNDING)} px or more.`
            message = px === 0 ? `Text ${words} touches ${what}. ${leave}` : `Text ${words} is ${px} px from ${what}. ${leave}`
            if (found.mark && fitted.has(found.mark)) message += ` ${fit}`
        }
        // Two texts with the same words are two findings, so the name of a text is its node. A dynamic drawing makes
        // new nodes on every frame, so its text goes by the node that drew it. There, a text at the place of an
        // earlier one is that text with new words, as a number that counts up. A text with the words of an earlier
        // one that is not on this frame is that text at a new place. Any other text is a new one.
        let name = `${block.id.id}:${block.source}`
        if (!block.id.mounted) {
            let drawer: Node | null = block.id
            while (drawer && !drawer.mounted) drawer = above(drawer)
            const from = drawer ? String(drawer.id) : 'dynamic'
            let known = limits.places.get(from)
            if (!known) limits.places.set(from, known = [])
            let slot = known.findIndex((entry) => entry.look !== look && samePlace(entry.box, block.bounds))
            if (slot < 0) slot = known.findIndex((entry) => entry.look !== look && entry.words === block.source)
            if (slot < 0) slot = known.push({ box: block.bounds, words: block.source, look }) - 1
            known[slot] = { box: block.bounds, words: block.source, look }
            name = `${from}#${slot}`
        }
        if (covered) pairs.add(markName(covered.node, covered.image ? 'image' : 'fill'))
        findings.push({
            key: `film.text_crowded:${name}`,
            code: 'film.text_crowded', severity: 'warning', time, box: pad(block.bounds, room), message, text: source, pairs: [...pairs],
        })
    })
    return findings
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
    const outlines: Mark[] = []
    const plates: Plate[] = []
    // The faces of a 3D scene. They are one surface for this rule, and not a mark each.
    const faces: { path: Path; bounds: Bounds }[] = []
    const tints: Tint[] = []
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
            if (limits.gap > 0) {
                // A picture is a mark as a filled shape is. Its outline is the edge of the picture, with the parts that are clear.
                const corners = ([[0, 0], [op.image.width, 0], [op.image.width, op.image.height], [0, op.image.height]] as const).map(([x, y]) => apply(op.matrix, x, y))
                const path = polyPath(corners, true)
                outlines.push({ path, order, line: null, half: 0, bounds: box, node: op.node, closed: true, image: true, opaque: op.alpha >= PLATE, paint: null, alpha: op.alpha, crossed: false })
                if (op.alpha >= PLATE) plates.push({ order, bounds: box, path, node: op.node, image: true })
                tints.push({ order, bounds: box, path, color: null, alpha: op.alpha, face: false })
            }
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
            entry.glyphs.push({ box: shape, order, op })
            if (entry.size === 0 && (limits.gap > 0 || (limits.size ?? 0) > 0)) {
                // The node records its font size in its own units. One glyph gives the scale from those units to the canvas.
                const declared = block.data['size']
                if (typeof declared === 'number') entry.size = declared * drawnScale(op.node!.get('path') ?? [], op.path)
            }
        } else if (!glyph) {
            if (op.fill && op.fillAlpha >= OPAQUE && solid(op.fill)[3] >= OPAQUE && op.path.some((r) => r.closed)) fills.push({ order, bounds: shape })
            const opaque = !!op.fill && op.fillAlpha * solid(op.fill)[3] >= PLATE && op.path.some((r) => r.closed)
            // A face of a 3D scene has no node. A scene sorts its own faces, so a face is not a backing.
            if (opaque && op.node) plates.push({ order, bounds: shape, path: op.path, node: op.node, image: false })
            const stroked = !!op.stroke && op.strokeAlpha >= MIN_ALPHA && op.strokePath.length > 0
            const contrast = stroked ? contrastOver(solid(op.stroke!), op.strokeAlpha, background) : 0
            if (contrast >= MIN_STROKE_CONTRAST) strokes.push({ op, order, contrast })
            if (limits.gap > 0) {
                if (op.fill && op.fillAlpha >= MIN_ALPHA) tints.push({ order, bounds: shape, path: op.path, color: solid(op.fill), alpha: op.fillAlpha, face: !op.node })
                if (!op.node && op.fill) {
                    // A face of a 3D scene, with or without the line of its mesh. A face in the shade has little contrast,
                    // and it is still a part of the surface.
                    faces.push({ path: op.path, bounds: shape })
                } else {
                    // The contrast of a mark is with what is behind it, which is known when a text is near. So each line
                    // and each fill that shows at all is a mark for now.
                    const reach = stroked ? pathBounds(op.strokePath) : null
                    const lined: Mark | undefined = reach ? { path: op.strokePath, order, line: op, half: op.strokeWidth / 2, bounds: reach, node: op.node, closed: op.strokePath.every((r) => r.closed),
                        image: false, opaque: false, paint: solid(op.stroke!), alpha: op.strokeAlpha, crossed: contrast >= MIN_STROKE_CONTRAST } : undefined
                    if (lined) outlines.push(lined)
                    if (op.fill && op.fillAlpha >= MIN_ALPHA) {
                        outlines.push({ path: op.path, order, line: null, half: 0, bounds: shape, node: op.node, closed: true, image: false, opaque, paint: solid(op.fill), alpha: op.fillAlpha, crossed: false, unless: lined })
                    }
                }
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
    // Too small to read. The size is what the screen shows: the font size with the scale of the node and of the camera.
    // The film check puts these together: the labels of one object, and the texts of one size.
    if ((limits.size ?? 0) > 0) {
        for (const block of list) {
            if (block.size <= 0 || block.size >= limits.size! - SIZE_TOLERANCE) continue
            const owner = layoutOwner(block.id)
            const name = owner ? nameOf(owner.node) : ''
            const group = owner && name ? `${owner.node.mounted ? owner.node.id : 'dynamic'}:${name}` : ''
            findings.push({
                key: `film.text_small:${group}:${block.source}`,
                code: 'film.text_small', severity: 'warning', time, box: block.bounds, message: '', text: block.source,
                small: { size: block.size, group, object: group ? name : '' },
            })
        }
    }
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
    /**
     * The letters of a block that a line runs through. The outer part of a letter does not count, and neither does
     * a line under a backing. `film.text_crossed` reports what this returns, and `film.text_crowded` reports a line
     * that enters a letter and is not here, so the two rules meet.
     */
    const crossing = (block: TextBlock, op: PathOp, order: number): Bounds | null => {
        const strokeBox = pathBounds(op.strokePath)
        if (!strokeBox || !intersects(pad(strokeBox, op.strokeWidth), block.bounds)) return null
        let hit: Bounds | null = null
        for (const glyph of block.glyphs) {
            const target = inset(glyph.box, GLYPH_INSET)
            if (!intersects(strokeBox, target)) continue
            if (!strokeHitsBox(op.strokePath, target)) continue
            if (order < glyph.order && occluded(order, glyph.order, glyph.box)) continue
            hit = hit ? union(hit, glyph.box) : glyph.box
        }
        return hit
    }

    if (limits.gap > 0) findings.push(...crowdedText({ time, width, height, background, blocks: list, outlines, plates, faces, tints, crossing, limits }))
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
            const hit = crossing(block, op, order)
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

/** A part of a frame with no content, as a rectangle of cells of a grid. */
interface EmptySpace {
    /** The part of the frame that the rectangle is: from 0 to 1. */
    share: number
    box: Bounds
}

/** The grid of `film.empty_space`: 16 columns, and rows that make its cells square, or near it. */
function spaceGrid(width: number, height: number): { columns: number; rows: number } {
    return { columns: SPACE_COLUMNS, rows: Math.max(1, Math.round((SPACE_COLUMNS * height) / width)) }
}

/**
 * The cells of the grid that have content in a frame, row by row. A cell has content when a text, an image,
 * a line or a filled shape is in it. A line and a shape count from the contrast at which a viewer can tell
 * them from the background, so a faint grid and a panel in the color of the surface are not content.
 */
function occupied(frame: Frame): boolean[] {
    const { width, height } = frame
    const { columns, rows } = spaceGrid(width, height)
    const cellW = width / columns, cellH = height / rows
    const background = frame.background ? parseColor(frame.background) : (frame.dark ? [0, 0, 0, 1] as Rgba : [255, 255, 255, 1] as Rgba)
    const taken = new Array<boolean>(columns * rows).fill(false)
    const markPoint = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return
        taken[Math.min(rows - 1, Math.floor(y / cellH)) * columns + Math.min(columns - 1, Math.floor(x / cellW))] = true
    }
    const markBox = (box: Bounds) => {
        const x0 = Math.max(0, Math.floor(box.x / cellW)), x1 = Math.min(columns - 1, Math.floor((box.x + box.width) / cellW))
        const y0 = Math.max(0, Math.floor(box.y / cellH)), y1 = Math.min(rows - 1, Math.floor((box.y + box.height) / cellH))
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) taken[y * columns + x] = true
    }
    // Each cell that a line passes, by points that are half a cell apart on it.
    const reach = Math.min(cellW, cellH) / 2
    const markLine = (path: Path) => {
        const along = (x0: number, y0: number, x1: number, y1: number) => {
            const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / reach))
            for (let k = 0; k <= steps; k++) markPoint(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps)
            return false
        }
        for (const r of path) for (let o = 0; o + 7 < r.p.length; o += 6) pieces(r, o, along)
    }
    for (const op of frame.ops as DrawOp[]) {
        if (op.kind === 'image') {
            if (op.alpha >= BLANK_ALPHA && imageHasVisiblePixels(op.image.asset, op.image.crop)) markBox(imageOpBounds(op))
            continue
        }
        if (op.kind !== 'path' || op.path.length === 0) continue
        const shape = pathBounds(op.path)
        if (!shape) continue
        if (isGlyph(op)) {
            if (op.fillAlpha >= BLANK_ALPHA) markBox(shape)
            continue
        }
        if (op.fill && op.fillAlpha >= BLANK_ALPHA && contrastOver(solid(op.fill), op.fillAlpha, background) >= MIN_STROKE_CONTRAST) {
            // The edge of the shape, and each cell whose middle is inside it.
            markLine(op.path)
            const x0 = Math.max(0, Math.floor(shape.x / cellW)), x1 = Math.min(columns - 1, Math.floor((shape.x + shape.width) / cellW))
            const y0 = Math.max(0, Math.floor(shape.y / cellH)), y1 = Math.min(rows - 1, Math.floor((shape.y + shape.height) / cellH))
            for (let y = y0; y <= y1; y++) {
                for (let x = x0; x <= x1; x++) if (!taken[y * columns + x] && encloses(op.path, (x + 0.5) * cellW, (y + 0.5) * cellH)) taken[y * columns + x] = true
            }
        }
        if (op.stroke && op.strokeWidth > 0 && op.strokeAlpha >= BLANK_ALPHA && op.strokePath.length > 0 && contrastOver(solid(op.stroke), op.strokeAlpha, background) >= MIN_STROKE_CONTRAST) markLine(op.strokePath)
    }
    return taken
}

/** The largest rectangle of cells with no content: for each row, the empty height of each column, and the widest run of each height. */
function largestEmpty(taken: readonly boolean[], width: number, height: number): EmptySpace {
    const { columns, rows } = spaceGrid(width, height)
    const cellW = width / columns, cellH = height / rows
    const heights = new Array<number>(columns).fill(0)
    let best = { cells: 0, x: 0, y: 0, w: 0, h: 0 }
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) heights[x] = taken[y * columns + x] ? 0 : heights[x]! + 1
        for (let x = 0; x < columns; x++) {
            let least = heights[x]!
            for (let end = x; end < columns && heights[end]! > 0; end++) {
                least = Math.min(least, heights[end]!)
                const cells = least * (end - x + 1)
                if (cells > best.cells) best = { cells, x, y: y - least + 1, w: end - x + 1, h: least }
            }
        }
    }
    return { share: best.cells / (columns * rows), box: { x: best.x * cellW, y: best.y * cellH, width: best.w * cellW, height: best.h * cellH } }
}

/** Where a part of the frame is, in words: at an edge when the part goes from side to side, or at a corner, or in the middle. */
function partOf(box: Bounds, width: number, height: number): string {
    const wide = box.width >= width * 0.999, tall = box.height >= height * 0.999
    const percent = (part: number) => `${Math.round(part * 100)}%`
    if (wide && tall) return 'the whole frame'
    if (wide) return `the ${box.y <= 0 ? 'top' : box.y + box.height >= height * 0.999 ? 'bottom' : 'middle'} ${percent(box.height / height)} of the height`
    if (tall) return `the ${box.x <= 0 ? 'left' : box.x + box.width >= width * 0.999 ? 'right' : 'middle'} ${percent(box.width / width)} of the width`
    const x = (box.x + box.width / 2) / width, y = (box.y + box.height / 2) / height
    const across = x < 0.45 ? 'left' : x > 0.55 ? 'right' : '', down = y < 0.45 ? 'top' : y > 0.55 ? 'bottom' : ''
    const place = down && across ? `at the ${down} ${across}` : down || across ? `at the ${down || across}` : 'in the middle'
    return `a part ${place}, ${Math.round(box.width)} by ${Math.round(box.height)} pixels`
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

/**
 * True when two findings of `film.text_crowded` have a pair in common: the same text, and a mark that is too near
 * in both. The distance and the place of the two may change, and so may the words of a text that counts up.
 */
function samePair(a: Finding, b: Finding): boolean {
    return a.key === b.key && a.code === b.code && !!a.pairs?.some((mark) => b.pairs?.includes(mark))
}

async function inspectFilm(film: FilmDefinition | CompiledFilm, options: FilmCheckOptions): Promise<FilmCheckReport> {
    const compiled = isFilm(film) ? await film.compile(options) : film
    const times = options.times ? [...options.times] : restingMoments(compiled, options.samples ?? 0)
    const { textSize = 0, emptySpace: emptyLimit = 0 } = options
    if (!(Number.isFinite(textSize) && textSize >= 0)) throw new Error('checkFilm: textSize is the least size of text in pixels of a frame that is 1080 high, such as 26. 0 turns the rule off')
    if (!(Number.isFinite(emptyLimit) && emptyLimit >= 0 && emptyLimit < 1)) throw new Error('checkFilm: emptySpace is the largest part of the frame that may stay empty in one piece, from 0 to 1, such as 0.5. 0 turns the rule off')
    const limits: Limits = {
        margin: options.textMargin ?? Math.min(compiled.width, compiled.height) * EDGE_MARGIN,
        gap: options.textGap ?? 0,
        // The size is for a frame that is 1080 high. A film of another size has the same part of its shorter side.
        size: textSize * Math.min(compiled.width, compiled.height) / 1080,
        places: new Map(),
    }
    const merged = new Map<string, FilmDiagnostic>()
    // The small texts, by the object that they are labels of, or by their size on the screen. Each text has its size.
    const smalls = new Map<string, { object: string; texts: Map<string, number>; time: number; until: number; box: Bounds }>()
    // The CLI has its own copy of the engine, and a film can import an older one. An older engine does not mark the
    // labels that its objects place, so this rule would report the layout of every object.
    if (limits.gap > 0 && !('drawer' in compiled.stage.root)) {
        limits.gap = 0
        merged.set('film.text_crowded:engine', {
            code: 'film.text_crowded', severity: 'warning', time: 0, until: 0, box: { x: 0, y: 0, width: 0, height: 0 }, stage: { x: 0, y: 0 },
            message: 'The film imports a version of the engine that does not mark the labels of its objects, so the check for text with no room did not run. Update the vizmatic package that the film imports.',
        })
    }
    for (const time of times) {
        const frame = await frameAt(compiled, time)
        let found = inspect(frame, time, zoomAt(compiled, time) !== 1, compiled.bleed, limits)
        // A film can rest for a part of a second, with a curve or a playhead near a text on its way. Look again one
        // second later: the text has no room when the same mark is too near there too. The last picture of a film
        // stays. With `times`, the caller chose the moments, so each one is judged as a picture.
        const later = Math.min(time + HELD_SECONDS, compiled.duration - 1e-3)
        if (!options.times && later > time && found.some((finding) => finding.code === 'film.text_crowded')) {
            // The names of dynamic texts are kept in `places`. This look must not change them.
            const places = new Map([...limits.places].map(([name, known]) => [name, known.map((entry) => ({ ...entry }))]))
            const again = inspect(await frameAt(compiled, later), later, zoomAt(compiled, later) !== 1, compiled.bleed, { margin: 0, gap: limits.gap, places })
            found = found.filter((finding) => finding.code !== 'film.text_crowded' || again.some((other) => samePair(finding, other)))
        }
        for (const { key, pairs: _, small, ...finding } of found) {
            if (small) {
                // One finding for the labels of one object, and one for the texts of one size: a film sets a size for
                // a kind of text, and an object has one option for the size of its labels.
                const px = Math.round(small.size * 10) / 10
                const name = small.group ? `object:${small.group}` : `size:${px}`
                const group = smalls.get(name)
                if (!group) smalls.set(name, { object: small.object, texts: new Map([[finding.text!, px]]), time, until: time, box: finding.box })
                else {
                    group.until = time
                    if (!group.texts.has(finding.text!)) group.texts.set(finding.text!, px)
                }
                continue
            }
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

    for (const [name, group] of smalls) {
        const texts = [...group.texts.keys()], sizes = [...group.texts.values()]
        const quoted = texts.slice(0, SMALL_SHOWN).map((text) => JSON.stringify(text)).join(', ') + (texts.length > SMALL_SHOWN ? ` and ${texts.length - SMALL_SHOWN} more` : '')
        const least = `${Math.round(limits.size! * 10) / 10} px`, smallest = `${Math.min(...sizes)} px`
        const message = group.object
            ? texts.length === 1
                ? `The label ${quoted} of ${group.object} is ${smallest} on the screen, and the least size is ${least}. Give the object a larger size for its labels.`
                : `${texts.length} labels of ${group.object} are under ${least} on the screen, the smallest at ${smallest}: ${quoted}. Give the object a larger size for its labels.`
            : texts.length === 1
                ? `Text ${quoted} is ${smallest} on the screen, and the least size is ${least}. Give it a larger size.`
                : `${texts.length} texts are ${smallest} on the screen, and the least size is ${least}: ${quoted}. Give them a larger size.`
        merged.set(`film.text_small:${name}`, { code: 'film.text_small', severity: 'warning', message, time: group.time, until: group.until, box: group.box, stage: { x: 0, y: 0 }, text: texts[0]! })
    }

    const frameCount = options.motion ? Math.max(1, Math.round(compiled.duration * compiled.fps)) : 0
    const step = 1 / compiled.fps
    if (options.motion) {
        const top = options.contentTop ?? 0
        const moving = new Map<string, MovingRun[]>()
        // Each pair of a text and a mark that is too near, by the names of the two: each stretch of looks in a row.
        // A run counts looks here, and not frames.
        const held = new Map<string, MovingRun[]>()
        // The look of a frame, or -1: look k is at the frame that is nearest to k quarters of a second.
        const rate = Math.min(HELD_RATE, compiled.fps)
        const lookAt = (index: number): number => {
            const k = Math.round((index * rate) / compiled.fps)
            return Math.round((k * compiled.fps) / rate) === index ? k : -1
        }
        const looksNeeded = Math.max(2, Math.round(HELD_SECONDS * rate))
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
            // Text may pass an edge or a mark on its way in or out, so the rule for an edge looks only at rest. The rule for
            // a mark also looks a few times in one second, for a text and a mark that stay too near while things move.
            const look = limits.gap > 0 ? lookAt(index) : -1
            for (const finding of inspect(frame, time, zoomAt(compiled, time) !== 1, compiled.bleed, { margin: 0, gap: look >= 0 ? limits.gap : 0, places: limits.places })) {
                // A problem that also shows at rest is already reported, with its own severity.
                if (merged.has(finding.key)) continue
                if (finding.code === 'film.text_crowded') {
                    for (const mark of finding.pairs ?? []) {
                        const pair = `${finding.key}|${mark}`
                        let runs = held.get(pair)
                        if (!runs) held.set(pair, runs = [])
                        const last = runs[runs.length - 1]
                        if (last && last.to === look - 1) last.to = look
                        else runs.push({ from: look, to: look, first: finding })
                    }
                    continue
                }
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
            const { key: _, pairs: __, ...finding } = longest.first
            merged.set(key, {
                ...finding,
                severity: 'warning',
                until: longest.to * step,
                stage: { x: 0, y: 0 },
                motion: { spans: runs.length, seconds: seconds(runs.reduce((sum, run) => sum + run.to - run.from + 1, 0)) },
            })
        }
        // One finding for a text: its pair that is too near for the longest time. A pair counts when it is too near
        // at every look of one second.
        const longest = new Map<string, { run: MovingRun; spans: number; looks: number }>()
        for (const runs of held.values()) {
            const long = runs.filter((run) => run.to - run.from + 1 >= looksNeeded)
            if (long.length === 0) continue
            const run = long.reduce((best, next) => (next.to - next.from > best.to - best.from ? next : best))
            const seen = longest.get(run.first.key)
            if (!seen || run.to - run.from > seen.run.to - seen.run.from) longest.set(run.first.key, { run, spans: long.length, looks: long.reduce((sum, next) => sum + next.to - next.from, 0) })
        }
        const timeOfLook = (look: number) => Math.round((look * compiled.fps) / rate) * step
        for (const [key, { run, spans, looks }] of longest) {
            const { key: _, pairs: __, ...finding } = run.first
            // A dynamic text can get another name in the scan than at a moment at rest. The same words at the same
            // place with the same mark are one finding, which the moment at rest has.
            if ([...merged.values()].some((seen) => seen.code === 'film.text_crowded' && seen.message === finding.message && samePlace(seen.box, finding.box))) continue
            merged.set(key, {
                ...finding,
                time: timeOfLook(run.from),
                until: timeOfLook(run.to),
                stage: { x: 0, y: 0 },
                motion: { spans, seconds: Math.round((looks / rate) * 100) / 100 },
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
    if (emptyLimit > 0) {
        // The cells that had no content in every look of a run, and the largest rectangle of them. A picture that
        // moves in the frame uses the frame, so only a part that stays empty counts.
        type Run = { from: number; to: number; taken: boolean[]; space: EmptySpace }
        let run = null as Run | null
        const flush = () => {
            if (run && run.to - run.from >= SPACE_SECONDS - 1e-6) {
                const length = Math.round((run.to - run.from) * 10) / 10
                merged.set(`film.empty_space:${run.from}`, {
                    code: 'film.empty_space', severity: 'warning',
                    message: `For ${length} s, ${Math.round(run.space.share * 100)}% of the frame stays empty in one piece: ${partOf(run.space.box, compiled.width, compiled.height)}. The limit is ${Math.round(emptyLimit * 100)}%. Make the picture larger, or use that part for what the picture explains.`,
                    time: run.from, until: run.to, box: run.space.box, stage: { x: 0, y: 0 },
                    motion: { spans: 1, seconds: length },
                })
            }
            run = null
        }
        // A film may open on an empty stage and close on one, so the looks start and end half a second inside it.
        for (let k = 1; k * SPACE_STEP <= compiled.duration - BLANK_EDGE_SECONDS + 1e-6; k++) {
            const time = k * SPACE_STEP
            const taken = occupied(await frameAt(compiled, time))
            if (run) {
                const both: boolean[] = run.taken.map((cell, index) => cell || taken[index]!)
                const space: EmptySpace = largestEmpty(both, compiled.width, compiled.height)
                if (space.share > emptyLimit + 1e-9) {
                    run = { from: run.from, to: time, taken: both, space }
                    continue
                }
                flush()
            }
            const space = largestEmpty(taken, compiled.width, compiled.height)
            if (space.share > emptyLimit + 1e-9) run = { from: time, to: time, taken, space }
        }
        flush()
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
