import { isGradient, parseColor, sampleStops, type Paint, type Rgba } from './color'
import type { DrawOp, Frame, PathOp } from './display'
import { pathBounds, type Bounds, type Path } from './geometry'
import type { Node } from './node'
import { isFilm, isSuspend, type CompiledFilm, type CompileOverrides, type FilmDefinition } from './stage'

export type FilmDiagnosticCode = 'film.off_canvas' | 'film.text_overlap' | 'film.text_crossed'

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
}

export interface FilmCheckReport {
    ok: boolean
    width: number
    height: number
    duration: number
    /** The times that were inspected, in seconds. */
    sampled: number[]
    diagnostics: FilmDiagnostic[]
    summary: { errors: number; warnings: number }
}

export interface FilmCheckOptions extends CompileOverrides {
    /** Inspect exactly these times, in seconds, in place of the automatic sampling. */
    times?: readonly number[]
    /** Add this many evenly spaced samples to the moments at rest. */
    samples?: number
}

interface TextBlock {
    id: Node
    source: string
    bounds: Bounds
    glyphs: { box: Bounds; order: number }[]
}

const EDGE_TOLERANCE = 1
const MIN_ALPHA = 0.08
const MIN_TEXT_ALPHA = 0.15
const MIN_OVERLAP = 0.12
const GLYPH_INSET = 0.12
const MIN_RESTING_MOMENTS = 5
const AUTO_SAMPLES = 12
const CUBIC_STEPS = 6
const CROSSING_ERROR_WIDTH = 2
const CROSSING_ERROR_CONTRAST = 2
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

function inspect(frame: Frame, time: number, zoomed: boolean, bleed: boolean): Finding[] {
    const findings: Finding[] = []
    const { width, height, ops } = frame
    const background = frame.background ? parseColor(frame.background) : (frame.dark ? [0, 0, 0, 1] as Rgba : [255, 255, 255, 1] as Rgba)
    const canvas: Bounds = { x: 0, y: 0, width, height }
    const blocks = new Map<Node, TextBlock>()
    const fills: { order: number; bounds: Bounds }[] = []
    const strokes: { op: PathOp; order: number; contrast: number }[] = []
    const off = new Map<string, Finding>()
    let outsideMarks = 0

    ops.forEach((op: DrawOp, order) => {
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

        if (glyph && block && op.fillAlpha >= MIN_TEXT_ALPHA) {
            let entry = blocks.get(block)
            if (!entry) blocks.set(block, entry = { id: block, source: sourceOf(block), bounds: shape, glyphs: [] })
            entry.bounds = union(entry.bounds, shape)
            entry.glyphs.push({ box: shape, order })
        } else if (!glyph) {
            if (op.fill && op.fillAlpha >= OPAQUE && solid(op.fill)[3] >= OPAQUE && op.path.some((r) => r.closed)) fills.push({ order, bounds: shape })
            if (op.stroke && op.strokeAlpha >= MIN_ALPHA && op.strokePath.length > 0) {
                const contrast = contrastOver(solid(op.stroke), op.strokeAlpha, background)
                if (contrast >= MIN_STROKE_CONTRAST) strokes.push({ op, order, contrast })
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

/**
 * Inspect a film for layout defects: marks off the canvas, text on text, and
 * strokes through text. It looks where the film comes to rest, because objects may
 * cross each other while moving. Runs anywhere, with no rendering.
 */
export async function checkFilm(film: FilmDefinition | CompiledFilm, options: FilmCheckOptions = {}): Promise<FilmCheckReport> {
    const compiled = isFilm(film) ? await film.compile(options) : film
    const times = options.times ? [...options.times] : restingMoments(compiled, options.samples ?? 0)
    const merged = new Map<string, FilmDiagnostic>()
    for (const time of times) {
        const frame = await frameAt(compiled, time)
        for (const { key, ...finding } of inspect(frame, time, zoomAt(compiled, time) !== 1, compiled.bleed)) {
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
        diagnostics,
        summary: { errors, warnings: diagnostics.length - errors },
    }
}
