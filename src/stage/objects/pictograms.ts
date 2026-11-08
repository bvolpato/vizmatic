import { arcPath, circlePath, parseSvgPath, polyPath, rectPath, transformPath, type Path, type Vec } from '../geometry'
import { Node } from '../node'
import type { ColorInput } from '../color'

/**
 * Small pictures for the things that system and data films name: a time series, a forecast, logs,
 * traces, a graph, a database. Every picture is drawn on one 24-unit grid with one stroke weight,
 * so pictures in a row read as one family.
 */

const GRID = 24

interface Mark {
    path: Path
    /** `line` strokes the path. `thin` strokes it lighter. `solid` fills it. `soft` fills it faintly. */
    paint: 'line' | 'thin' | 'solid' | 'soft'
    /** Draw in the accent color, for the part that carries the meaning. */
    accent?: boolean
    dash?: readonly number[]
}

const stroke = (d: string, accent = false): Mark => ({ path: parseSvgPath(d), paint: 'line', accent })
const dashed = (d: string, accent = false): Mark => ({ path: parseSvgPath(d), paint: 'line', accent, dash: [1.5, 2.6] })
const solid = (d: string, accent = false): Mark => ({ path: parseSvgPath(d), paint: 'solid', accent })
const soft = (d: string, accent = false): Mark => ({ path: parseSvgPath(d), paint: 'soft', accent })
const ring = (x: number, y: number, r: number, accent = false): Mark => ({ path: circlePath(x, y, r), paint: 'line', accent })
const disc = (x: number, y: number, r: number, accent = false): Mark => ({ path: circlePath(x, y, r), paint: 'solid', accent })
const box = (x: number, y: number, w: number, h: number, r = 0, accent = false): Mark => ({ path: rectPath(x, y, w, h, r), paint: 'line', accent })
const slab = (x: number, y: number, w: number, h: number, r = 0, accent = false): Mark => ({ path: rectPath(x, y, w, h, r), paint: 'solid', accent })
const curve = (x: number, y: number, rx: number, ry: number, from: number, to: number, accent = false): Mark =>
    ({ path: arcPath(x, y, rx, ry, from, to), paint: 'line', accent })

/** An edge that stops at the rim of the node it points to, with a filled head. */
function arrowTo(from: Vec, to: Vec, gap: number, accent = false): Mark[] {
    const dx = to[0] - from[0], dy = to[1] - from[1]
    const length = Math.hypot(dx, dy) || 1
    const ux = dx / length, uy = dy / length
    const tip: Vec = [to[0] - ux * gap, to[1] - uy * gap]
    const size = 2.2, half = 1.2
    const base: Vec = [tip[0] - ux * size, tip[1] - uy * size]
    return [
        { path: polyPath([[from[0] + ux * gap, from[1] + uy * gap], base]), paint: 'line', accent },
        { path: polyPath([tip, [base[0] - uy * half, base[1] + ux * half], [base[0] + uy * half, base[1] - ux * half]], true), paint: 'solid', accent },
    ]
}

/** A part of a circle with a filled head at its end, for a cycle. Angles grow clockwise on screen. */
function arcArrow(x: number, y: number, r: number, from: number, to: number, accent = false): Mark[] {
    const size = 2.6, half = 1.5
    const end = to - size / r
    const tip: Vec = [x + Math.cos(to) * r, y + Math.sin(to) * r]
    const base: Vec = [x + Math.cos(end) * r, y + Math.sin(end) * r]
    const ox = Math.cos(end), oy = Math.sin(end)
    return [
        { path: arcPath(x, y, r, r, from, end), paint: 'line', accent },
        { path: polyPath([tip, [base[0] + ox * half, base[1] + oy * half], [base[0] - ox * half, base[1] - oy * half]], true), paint: 'solid', accent },
    ]
}

/** Straight edges between node centers. The nodes are drawn after them, so each edge ends at a node. */
function edges(points: readonly Vec[], pairs: readonly (readonly [number, number])[], paint: Mark['paint'] = 'line'): Mark[] {
    return pairs.map(([a, b]) => ({ path: polyPath([points[a]!, points[b]!]), paint }))
}

function gear(): Mark[] {
    const teeth = 8, outer = 9.2, root = 6.9, points: Vec[] = []
    for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2 - Math.PI / 2, w = Math.PI / teeth
        for (const [angle, radius] of [[a - w * 0.5, outer], [a + w * 0.5, outer], [a + w * 0.78, root], [a + w * 1.22, root]] as const) {
            points.push([12 + Math.cos(angle) * radius, 12 + Math.sin(angle) * radius])
        }
    }
    return [{ path: polyPath(points, true), paint: 'line' }, ring(12, 12, 3)]
}

const GRAPH: readonly Vec[] = [[4.5, 6.5], [15.5, 4.5], [10.5, 12.5], [19.5, 13.5], [6.5, 19.5], [16, 20]]
const TREE: readonly Vec[] = [[12, 4.5], [6.5, 12], [17.5, 12], [3.5, 19.5], [9.5, 19.5], [17.5, 19.5]]
const NET_IN: readonly Vec[] = [[4.5, 7.5], [4.5, 16.5]]
const NET_MID: readonly Vec[] = [[12, 4.5], [12, 12], [12, 19.5]]
const NET_OUT: readonly Vec[] = [[19.5, 7.5], [19.5, 16.5]]
const DAG: readonly Vec[] = [[4, 12], [12, 4.5], [12, 19.5], [20, 12]]

const ART = {
    // Telemetry
    series: () => [stroke('M2.5 15 5.5 10.5 8 13.5 11 6.5 14 12 16.5 9 19 13.5 21.5 7')],
    chart: () => [stroke('M3 3V21H21'), stroke('M6.5 16 10 11.5 13.5 14 19.5 6.5', true)],
    forecast: () => [
        soft('M11 11.5 21.5 3.5V15.5Z', true),
        stroke('M2.5 16.5 5 12.5 7.5 15.5 11 11.5'),
        stroke('M11 11.5 21.5 9.5', true),
        disc(11, 11.5, 1.5, true),
    ],
    threshold: () => [dashed('M2.5 8H21.5', true), stroke('M2.5 17 6.5 15 10 16.5 14 11.5 17.5 8.5 21.5 4')],
    anomaly: () => [stroke('M2.5 16 6 14.5 9 16 12 6 15 15.5 18 14 21.5 15.5'), disc(12, 6, 2.1, true)],
    logs: () => [
        disc(3.6, 5.5, 1.15, true), stroke('M7.5 5.5H16'),
        disc(3.6, 10, 1.15), stroke('M7.5 10H21'),
        disc(3.6, 14.5, 1.15), stroke('M7.5 14.5H13.5'),
        disc(3.6, 19, 1.15), stroke('M7.5 19H18.5'),
    ],
    traces: () => [slab(2.5, 3.6, 19, 3.2, 1.6), slab(5, 8.4, 11, 3.2, 1.6, true), slab(8.5, 13.2, 7.5, 3.2, 1.6, true), slab(12.5, 18, 9, 3.2, 1.6)],
    bars: () => [stroke('M2.5 21H21.5'), slab(4, 13, 3.6, 8, 0.9), slab(10.2, 8.5, 3.6, 12.5, 0.9), slab(16.4, 4, 3.6, 17, 0.9, true)],
    table: () => [box(3, 4, 18, 16, 2.2), stroke('M3 9.4H21'), stroke('M3 14.7H21'), stroke('M10 4V20')],
    matrix: () => [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => {
        const lit = (row === 0 && column === 1) || (row === 1 && column === 2) || (row === 2 && column === 0)
        return (lit ? slab : box)(3 + column * 6.5, 3 + row * 6.5, 5, 5, 1.2, lit)
    })),
    event: () => [solid('M12 4 20 12 12 20 4 12Z', true)],
    alert: () => [stroke('M6 16.5V11A6 6 0 0 1 18 11V16.5L19.8 19H4.2Z'), stroke('M12 2.8V5'), stroke('M10 21.6H14', true)],
    // Structure
    graph: () => [
        ...edges(GRAPH, [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [2, 4], [3, 5], [4, 5]]),
        ...GRAPH.map(([x, y], i) => disc(x, y, 2.1, i === 2)),
    ],
    dag: () => [
        ...arrowTo(DAG[0]!, DAG[1]!, 2.7), ...arrowTo(DAG[0]!, DAG[2]!, 2.7), ...arrowTo(DAG[1]!, DAG[3]!, 2.7), ...arrowTo(DAG[2]!, DAG[3]!, 2.7),
        ...DAG.map(([x, y], i) => disc(x, y, 2.1, i === 3)),
    ],
    tree: () => [
        ...edges(TREE, [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5]]),
        ...TREE.map(([x, y], i) => disc(x, y, 2.1, i === 0)),
    ],
    layers: () => [stroke('M12 3 21 7.5 12 12 3 7.5Z', true), stroke('M3 12 12 16.5 21 12'), stroke('M3 16.5 12 21 21 16.5')],
    pipeline: () => [box(2, 9, 5, 6, 1.4), box(9.5, 9, 5, 6, 1.4), box(17, 9, 5, 6, 1.4, true), stroke('M7 12H9.5'), stroke('M14.5 12H17')],
    branch: () => [stroke('M7 7.4V16.6'), stroke('M17 10.4C17 15 7 12.5 7 16.6'), ring(7, 5, 2.4), ring(7, 19, 2.4), ring(17, 8, 2.4, true)],
    // Systems
    service: () => [
        box(3, 3.5, 18, 7, 2), box(3, 13.5, 18, 7, 2),
        disc(7, 7, 1.15, true), disc(7, 17, 1.15, true), stroke('M11 7H17'), stroke('M11 17H17'),
    ],
    database: () => [
        { path: arcPath(12, 6, 8, 3, 0, Math.PI * 2), paint: 'line' },
        stroke('M4 6V18'), stroke('M20 6V18'), curve(12, 12, 8, 3, 0, Math.PI), curve(12, 18, 8, 3, 0, Math.PI),
    ],
    queue: () => [stroke('M2.5 7H21.5'), stroke('M2.5 17H21.5'), slab(4.5, 9.2, 3.6, 5.6, 1), slab(10.2, 9.2, 3.6, 5.6, 1), slab(15.9, 9.2, 3.6, 5.6, 1, true)],
    cloud: () => [stroke('M7 18.5H17.3A4.3 4.3 0 0 0 17.9 10A6.2 6.2 0 0 0 6.2 9.4A4.6 4.6 0 0 0 7 18.5Z')],
    chip: () => [
        box(6, 6, 12, 12, 2), box(9.5, 9.5, 5, 5, 1, true),
        ...[9, 12, 15].flatMap((at) => [stroke(`M${at} 2.8V6`), stroke(`M${at} 18V21.2`), stroke(`M2.8 ${at}H6`), stroke(`M18 ${at}H21.2`)]),
    ],
    // Models
    model: () => [
        ...NET_IN.flatMap((a) => NET_MID.map((b): Mark => ({ path: polyPath([a, b]), paint: 'thin' }))),
        ...NET_MID.flatMap((a) => NET_OUT.map((b): Mark => ({ path: polyPath([a, b]), paint: 'thin' }))),
        ...NET_IN.map(([x, y]) => disc(x, y, 2)), ...NET_MID.map(([x, y]) => disc(x, y, 2, true)), ...NET_OUT.map(([x, y]) => disc(x, y, 2)),
    ],
    tokens: () => [box(2.5, 8.8, 4.6, 6.4, 1.4), slab(8.6, 8.8, 7.4, 6.4, 1.4, true), box(17.5, 8.8, 4, 6.4, 1.4)],
    vector: () => [box(2.5, 8.5, 19, 7, 3.5), ...[6.6, 10.2, 13.8, 17.4].map((x) => disc(x, 12, 1.35, true))],
    agent: () => [
        box(5, 8, 14, 11.5, 2.6), disc(9.5, 13, 1.2, true), disc(14.5, 13, 1.2, true),
        stroke('M12 8V5'), disc(12, 3.8, 1.2), stroke('M2.8 12.5V15.5'), stroke('M21.2 12.5V15.5'),
    ],
    spark: () => [solid('M12 2.5C12.9 8.4 15.6 11.1 21.5 12C15.6 12.9 12.9 15.6 12 21.5C11.1 15.6 8.4 12.9 2.5 12C8.4 11.1 11.1 8.4 12 2.5Z', true)],
    // Work
    dashboard: () => [box(3, 4, 18, 13, 2.2), stroke('M12 17V21'), stroke('M8.5 21H15.5'), stroke('M6.5 12.5 9.5 9.5 12 11.5 15 8 17.5 10', true)],
    terminal: () => [box(2.5, 4.5, 19, 15, 2.2), stroke('M6.5 9.5 10 12.5 6.5 15.5', true), stroke('M12.5 15.5H17')],
    container: () => [stroke('M12 3 20 7.5V16.5L12 21 4 16.5V7.5Z'), stroke('M4 7.5 12 12 20 7.5'), stroke('M12 12V21')],
    experiment: () => [stroke('M9 3H15'), stroke('M10 3V9L4.6 18.8A1.5 1.5 0 0 0 5.9 21H18.1A1.5 1.5 0 0 0 19.4 18.8L14 9V3'), stroke('M7.6 15H16.4', true)],
    target: () => [ring(12, 12, 9.2), ring(12, 12, 5.2), disc(12, 12, 1.8, true)],
    loop: () => [...arcArrow(12, 12, 8, Math.PI * 1.08, Math.PI * 1.86), ...arcArrow(12, 12, 8, Math.PI * 0.08, Math.PI * 0.86, true)],
    eye: () => [stroke('M2.5 12C5 7.6 8.3 5.5 12 5.5S19 7.6 21.5 12C19 16.4 15.7 18.5 12 18.5S5 16.4 2.5 12Z'), ring(12, 12, 3, true)],
    message: () => [stroke('M4.5 4.5H19.5A2 2 0 0 1 21.5 6.5V14.5A2 2 0 0 1 19.5 16.5H10.5L6 20.5V16.5H4.5A2 2 0 0 1 2.5 14.5V6.5A2 2 0 0 1 4.5 4.5Z'), stroke('M7 9H17', true), stroke('M7 12.5H13.5', true)],
    shield: () => [stroke('M12 3 20 6V11.5C20 16.4 16.6 19.8 12 21.5C7.4 19.8 4 16.4 4 11.5V6Z'), stroke('M8.4 12 11 14.6 15.8 9.6', true)],
    // General
    document: () => [stroke('M6 3H14.5L19 7.5V21H6Z'), stroke('M14.5 3V7.5H19'), stroke('M9 12.5H16'), stroke('M9 16.5H16')],
    code: () => [stroke('M8.5 7 3.5 12 8.5 17'), stroke('M15.5 7 20.5 12 15.5 17'), stroke('M13.6 5 10.4 19', true)],
    gear,
    clock: () => [ring(12, 12, 9), stroke('M12 6.8V12L15.6 14.2', true)],
    user: () => [ring(12, 8, 3.7), curve(12, 20.5, 7.6, 7.2, Math.PI, Math.PI * 2)],
    search: () => [ring(10.5, 10.5, 6.6), stroke('M15.3 15.3 21 21', true)],
    lock: () => [box(5, 10.5, 14, 10, 2.2), stroke('M8 10.5V7.5A4 4 0 0 1 16 7.5V10.5'), disc(12, 15.5, 1.3, true)],
    deploy: () => [stroke('M4 15V19.8H20V15'), stroke('M12 15.5V4', true), stroke('M7.5 8.5 12 4 16.5 8.5', true)],
    check: () => [stroke('M4.5 12.5 9.5 17.5 19.5 6.5', true)],
    cross: () => [stroke('M6 6 18 18', true), stroke('M18 6 6 18', true)],
    warning: () => [stroke('M12 3.5 21.5 20H2.5Z'), stroke('M12 9.5V14', true), disc(12, 17, 1, true)],
    question: () => [ring(12, 12, 9.2), stroke('M9.3 9.6A2.8 2.8 0 1 1 13.5 12C12.5 12.6 12 13.2 12 14.4', true), disc(12, 17.3, 1, true)],
} satisfies Record<string, () => Mark[]>

export type PictogramName = keyof typeof ART

/** Every pictogram name, in the order of the catalog. */
export const PICTOGRAMS = Object.keys(ART) as readonly PictogramName[]

export interface PictogramOptions {
    /** The side of the square that holds the picture, in pixels. Defaults to 96. */
    size?: number
    /** The color of the lines. Defaults to ink. */
    color?: ColorInput
    /** The color of the part that carries the meaning, such as the forecast in `forecast`. Defaults to `color`. */
    accent?: ColorInput
    /** Stroke width, in units of the 24-unit grid. Defaults to 1.6. */
    weight?: number
}

/** A small picture of a concept. Its bounds are the whole square, so pictures of one size line up. */
export class Pictogram extends Node {
    constructor(readonly name: PictogramName, options: PictogramOptions = {}) {
        const size = options.size ?? 96, unit = size / GRID
        const place = [unit, 0, 0, unit, -size / 2, -size / 2] as const
        // The square carries no paint. It gives every picture the same bounds.
        super(rectPath(-size / 2, -size / 2, size, size))
        const draw = ART[name]
        if (!draw) throw new Error(`pictogram: unknown name ${JSON.stringify(name)}. Names: ${PICTOGRAMS.join(', ')}`)
        const color = options.color ?? 'ink', accent = options.accent ?? color
        const weight = (options.weight ?? 1.6) * unit
        for (const mark of draw()) {
            const node = new Node(transformPath(mark.path, place))
            const tone = mark.accent ? accent : color
            if (mark.paint === 'solid') node.fill(tone)
            else if (mark.paint === 'soft') node.fill(tone, 0.24)
            else node.stroke(tone, mark.paint === 'thin' ? weight * 0.5 : weight)
            if (mark.dash) node.dash(mark.dash.map((length) => length * unit))
            this.add(node)
        }
        this.named(`pictogram:${name}`)
    }
}

/** A small picture of a concept, such as `pictogram('graph', { size: 120, color: 'dim', accent: 'teal' })`. */
export function pictogram(name: PictogramName, options: PictogramOptions = {}): Pictogram {
    return new Pictogram(name, options)
}
