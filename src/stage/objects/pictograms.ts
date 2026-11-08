import { arcPath, circlePath, parseSvgPath, polyPath, rectPath, transformPath, type Path, type Vec } from '../geometry'
import { Node } from '../node'
import type { ColorInput } from '../color'

/**
 * Small pictures for the things that system and data films name: a time series, a forecast, logs,
 * traces, a graph, a database. Every picture is drawn on one 24-unit grid in one line style,
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
    return [{ path: polyPath(points, true), paint: 'line' }, ring(12, 12, 3, true)]
}

/** The legs of a square chip, at each place in `at` on its four sides. The body ends `half` units from the middle. */
function legs(half: number, at: readonly number[]): Mark[] {
    const near = 12 - half, far = 12 + half
    return at.flatMap((place) => [stroke(`M${place} 2.8V${near}`), stroke(`M${place} ${far}V21.2`), stroke(`M2.8 ${place}H${near}`), stroke(`M${far} ${place}H21.2`)])
}

/** A ring buffer: a band of eight slots around a hole. A pointer outside the band marks the tail, where the filled slots end. */
function ringBuffer(): Mark[] {
    const inner = 4.6, outer = 8.6, slot = Math.PI / 4, top = -Math.PI / 2, filled = 3
    // A point at a radius and an angle from the middle, `side` units to the right of that direction.
    const at = (radius: number, angle: number, side = 0) => {
        const x = 12 + Math.cos(angle) * radius - Math.sin(angle) * side, y = 12 + Math.sin(angle) * radius + Math.cos(angle) * side
        return `${+x.toFixed(3)} ${+y.toFixed(3)}`
    }
    const end = top + filled * slot, turn = top + Math.PI * 2
    return [
        // The two rims are each in two parts, so the filled slots are all in the accent at each weight. The parts meet under a divider.
        curve(12, 12, outer, outer, end, turn), curve(12, 12, inner, inner, end, turn),
        solid(`M${at(outer, top)}A${outer} ${outer} 0 0 1 ${at(outer, end)}L${at(inner, end)}A${inner} ${inner} 0 0 0 ${at(inner, top)}Z`, true),
        curve(12, 12, outer, outer, top, end, true), curve(12, 12, inner, inner, top, end, true),
        ...Array.from({ length: 8 }, (_, i) => stroke(`M${at(inner, top + i * slot)}L${at(outer, top + i * slot)}`)),
        solid(`M${at(10.2, end)}L${at(13.2, end, 1.8)}L${at(13.2, end, -1.8)}Z`),
    ]
}

/** A whole cut in six equal pieces, with one piece pulled out along its middle line. */
function shard(): Mark[] {
    const x = 11.8, y = 13.4, radius = 7.2, piece = Math.PI / 3, top = -Math.PI / 2
    const at = (ox: number, oy: number, r: number, angle: number) => `${+(ox + Math.cos(angle) * r).toFixed(2)} ${+(oy + Math.sin(angle) * r).toFixed(2)}`
    const px = +(x + Math.cos(top + piece / 2) * 3.8).toFixed(2), py = +(y + Math.sin(top + piece / 2) * 3.8).toFixed(2)
    return [
        stroke(`M${x} ${y}L${at(x, y, radius, top + piece)}A${radius} ${radius} 0 1 1 ${at(x, y, radius, top)}Z`),
        ...[2, 3, 4, 5].map((i) => stroke(`M${x} ${y}L${at(x, y, radius, top + i * piece)}`)),
        solid(`M${px} ${py}L${at(px, py, 7.4, top)}A7.4 7.4 0 0 1 ${at(px, py, 7.4, top + piece)}Z`, true),
    ]
}

const GRAPH: readonly Vec[] = [[4.5, 6.5], [15.5, 4.5], [10.5, 12.5], [19.5, 13.5], [6.5, 19.5], [16, 20]]
const TREE: readonly Vec[] = [[12, 4.5], [6.5, 12], [17.5, 12], [3.5, 19.5], [9.5, 19.5], [17.5, 19.5]]
const NET_IN: readonly Vec[] = [[4.5, 7.5], [4.5, 16.5]]
const NET_MID: readonly Vec[] = [[12, 4.5], [12, 12], [12, 19.5]]
const NET_OUT: readonly Vec[] = [[19.5, 7.5], [19.5, 16.5]]
const DAG: readonly Vec[] = [[4, 12], [12, 4.5], [12, 19.5], [20, 12]]

const ART = {
    // Telemetry
    series: () => [stroke('M2.5 15 5.5 10.5 8 13.5 11 6.5 14 12 16.5 9 19 13.5 21.5 7', true)],
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
    table: () => [box(3, 4, 18, 16, 2.2), stroke('M3 14.7H21'), stroke('M10 4V20'), stroke('M3 9.4H21', true)],
    matrix: () => [0, 1, 2].flatMap((row) => [0, 1, 2].map((column) => {
        const lit = (row === 0 && column === 1) || (row === 1 && column === 2) || (row === 2 && column === 0)
        return (lit ? slab : box)(3.2 + column * 6.6, 3.2 + row * 6.6, 4.4, 4.4, 1.1, lit)
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
    pipeline: () => [box(1.6, 9, 4.2, 6, 1.3), box(9.9, 9, 4.2, 6, 1.3), box(18.2, 9, 4.2, 6, 1.3, true), solid('M6.9 10.4 8.9 12 6.9 13.6Z'), solid('M15.2 10.4 17.2 12 15.2 13.6Z')],
    branch: () => [stroke('M7 7.4V16.6'), stroke('M17 10.4C17 15 7 12.5 7 16.6'), ring(7, 5, 2.4), ring(7, 19, 2.4), ring(17, 8, 2.4, true)],
    // Systems
    service: () => [
        box(3, 3.5, 18, 7, 2), box(3, 13.5, 18, 7, 2),
        disc(7, 7, 1.15, true), disc(7, 17, 1.15, true), stroke('M11 7H17'), stroke('M11 17H17'),
    ],
    database: () => [
        stroke('M4 6V18'), stroke('M20 6V18'), curve(12, 12, 8, 3, 0, Math.PI), curve(12, 18, 8, 3, 0, Math.PI),
        { path: arcPath(12, 6, 8, 3, 0, Math.PI * 2), paint: 'line', accent: true },
    ],
    queue: () => [stroke('M2.5 7H21.5'), stroke('M2.5 17H21.5'), slab(4.5, 9.2, 3.6, 5.6, 1), slab(10.2, 9.2, 3.6, 5.6, 1), slab(15.9, 9.2, 3.6, 5.6, 1, true)],
    cloud: () => [stroke('M7 18.5H17.3A4.3 4.3 0 0 0 17.9 10A6.2 6.2 0 0 0 6.2 9.4A4.6 4.6 0 0 0 7 18.5Z', true)],
    chip: () => [box(6, 6, 12, 12, 2), box(9.5, 9.5, 5, 5, 1, true), ...legs(6, [9, 12, 15])],
    // Machines
    vm: () => [
        { path: rectPath(3, 3, 18, 18, 3.2), paint: 'line', dash: [1.6, 2.4] },
        box(7, 7.3, 10, 4, 1.2), box(7, 12.7, 10, 4, 1.2), disc(9.3, 9.3, 0.85, true), disc(9.3, 14.7, 0.85, true),
    ],
    process: () => [box(3, 4.5, 18, 15, 2.2), stroke('M3 9.2H21'), disc(6.2, 6.9, 0.9, true), disc(9, 6.9, 0.9, true), stroke('M7 13H13'), stroke('M7 16H16')],
    kernel: () => [stroke('M12 3 19.8 7.5V16.5L12 21 4.2 16.5V7.5Z'), disc(12, 12, 3, true)],
    memory: () => [
        box(2.5, 6.5, 19, 9.5, 1.6), ...[5.4, 9.5, 13.6, 17.7].map((x) => slab(x - 1.2, 9, 2.4, 4.4, 0.6, true)),
        ...[5, 8.5, 12, 15.5, 19].map((x) => stroke(`M${x} 16V18.8`)),
    ],
    disk: () => [box(3, 3.5, 18, 17, 2.4), ring(12, 10, 4.2), disc(12, 10, 1.1, true), stroke('M6.5 17H11.5'), disc(17, 17, 1, true)],
    nic: () => [box(3, 5, 18, 14, 2.2), stroke('M7.5 15V10.5H10V8.5H14V10.5H16.5V15Z', true)],
    network: () => [ring(12, 12, 9), { path: arcPath(12, 12, 4, 9, 0, Math.PI * 2), paint: 'line' }, stroke('M3 12H21', true)],
    snapshot: () => [stroke('M5.5 7H8L9.6 4.5H14.4L16 7H18.5A2.5 2.5 0 0 1 21 9.5V17A2.5 2.5 0 0 1 18.5 19.5H5.5A2.5 2.5 0 0 1 3 17V9.5A2.5 2.5 0 0 1 5.5 7Z'), ring(12, 13, 3.6, true)],
    clone: () => [box(8.5, 3, 12.5, 12.5, 2.4), box(3, 8.5, 12.5, 12.5, 2.4, true)],
    jail: () => [box(4, 3.5, 16, 17, 2.2), stroke('M8 3.5V20.5', true), stroke('M12 3.5V20.5', true), stroke('M16 3.5V20.5', true)],
    wall: () => [
        box(3, 5, 18, 14, 1.4), stroke('M3 9.7H21'), stroke('M3 14.3H21'),
        ...['M9 5V9.7', 'M15 5V9.7', 'M6 9.7V14.3', 'M12 9.7V14.3', 'M18 9.7V14.3', 'M9 14.3V19', 'M15 14.3V19'].map((d) => stroke(d, true)),
    ],
    key: () => [ring(7.5, 12, 3.8), stroke('M11.3 12H21'), stroke('M17 12V15', true), stroke('M20.2 12V14.2', true)],
    stopwatch: () => [ring(12, 13.5, 7.6), stroke('M10 2.8H14'), stroke('M12 2.8V5.9'), stroke('M12 13.5V9.4', true), stroke('M12 13.5 14.6 15.2', true)],
    bolt: () => [solid('M13.2 2.5 5.5 13.6H11L9.9 21.5 18.5 10H12.6Z', true)],
    // The gate comes last, so the line that leaves it starts under its edge.
    proxy: () => [...arrowTo([3.3, 12], [7.7, 12], 0), ...arrowTo([16.3, 12], [21.5, 12], 0), box(8.5, 4.5, 7, 15, 1.8, true)],
    // The seal sits on the corner of the sheet, so the border stops short of it. The ring comes last, so the ribbon ends under it.
    certificate: () => [
        stroke('M11.5 15.5H4.5A2 2 0 0 1 2.5 13.5V5.5A2 2 0 0 1 4.5 3.5H19.5A2 2 0 0 1 21.5 5.5V8.4'), stroke('M6 7.5H14'), stroke('M6 11.5H11.5'),
        solid('M14.8 16.4V21.4L17 19.6 19.2 21.4V16.4Z', true), ring(17, 14, 3, true),
    ],
    // The box of `server` with its lights off, and a moon where the vents are.
    sleep: () => [box(2.5, 7, 19, 10, 2), disc(6, 12, 1.15), disc(9.4, 12, 1.15), solid('M15.29 8.71A3.3 3.3 0 1 0 18.83 12.69A2.7 2.7 0 0 1 15.29 8.71Z', true)],
    shard,
    // Hardware
    core: () => [box(6, 6, 12, 12, 2), slab(8.3, 8.4, 3, 7.2, 1), slab(12.7, 8.4, 3, 7.2, 1, true), ...legs(6, [9, 12, 15])],
    timer: () => [box(5, 5, 14, 14, 2.2), ring(12, 12, 4.2, true), stroke('M12 10.1V12L13.6 12.9', true), ...legs(7, [8.5, 12, 15.5])],
    firmware: () => [
        stroke('M5.1 7.5H18.9A1.6 1.6 0 0 1 20.5 9.1V14.9A1.6 1.6 0 0 1 18.9 16.5H5.1A1.6 1.6 0 0 1 3.5 14.9V13.8A1.8 1.8 0 0 0 3.5 10.2V9.1A1.6 1.6 0 0 1 5.1 7.5Z'),
        slab(7.8, 10.4, 10.2, 3.2, 0.8, true),
        ...[6, 9, 12, 15, 18].flatMap((x) => [stroke(`M${x} 4.3V7.5`), stroke(`M${x} 16.5V19.7`)]),
    ],
    irqchip: () => [
        stroke('M2.5 8H4.4'), stroke('M2.5 12H4.4'), stroke('M2.5 16H4.4'), ...arrowTo([10.4, 12], [14.4, 12], 0), box(5.2, 4.5, 4.4, 15, 1.6, true),
        box(15.2, 9, 6, 6, 1.4), stroke('M16.7 9V7.2'), stroke('M19.7 9V7.2'), stroke('M16.7 15V16.8'), stroke('M19.7 15V16.8'),
    ],
    // The bar comes last, so the taps end under it.
    bus: () => [
        stroke('M6.5 10.5V7.6'), box(4, 2.8, 5, 4.8, 1.2), stroke('M17.5 10.5V7.6'), box(15, 2.8, 5, 4.8, 1.2),
        stroke('M12 13.5V16.4'), box(9.5, 16.4, 5, 4.8, 1.2), slab(2.5, 10.5, 19, 3, 1.5, true),
    ],
    drive: () => [
        stroke('M19.8 8.2H5.4V15.8H19.8A1.2 1.2 0 0 0 21 14.6V13.8A1.8 1.8 0 0 1 21 10.2V9.4A1.2 1.2 0 0 0 19.8 8.2Z'),
        slab(7.8, 10.6, 5.2, 2.8, 0.6, true), slab(14.2, 10.6, 2.8, 2.8, 0.6, true), slab(2.4, 7.4, 3.8, 2.7, 0.5), slab(2.4, 11.3, 3.8, 5.3, 0.5),
    ],
    // The shutter comes first, so the outline stays whole where the shutter meets it.
    floppy: () => [
        stroke('M7.5 3.4V9.2H15.5V3.4', true), stroke('M12.9 5.6V6.6', true),
        stroke('M4.6 3H17L21 7V19.4A1.6 1.6 0 0 1 19.4 21H4.6A1.6 1.6 0 0 1 3 19.4V4.6A1.6 1.6 0 0 1 4.6 3Z'), stroke('M7 21V14.2H17V21'),
    ],
    serial: () => [
        stroke('M5.6 6.5H18.4Q21.9 6.5 21 9.6L19.4 15.2Q18.7 17.5 16.3 17.5H7.7Q5.3 17.5 4.6 15.2L3 9.6Q2.1 6.5 5.6 6.5Z'),
        ...[6, 9, 12, 15, 18].map((x) => disc(x, 10.2, 1, true)), ...[7.5, 10.5, 13.5, 16.5].map((x) => disc(x, 13.9, 1, true)),
    ],
    keyboard: () => [
        box(2.5, 5.5, 19, 13, 2.2), ...[7.7, 11].flatMap((y) => [4.4, 7.7, 11, 14.3, 17.6].map((x) => slab(x, y, 2, 2, 0.5, true))),
        slab(4.4, 14.3, 2, 2, 0.5, true), slab(7.7, 14.3, 8.6, 2, 0.5, true), slab(17.6, 14.3, 2, 2, 0.5, true),
    ],
    server: () => [box(2.5, 7, 19, 10, 2), disc(6, 12, 1.15, true), disc(9.4, 12, 1.15, true), ...[12.6, 15.5, 18.4].map((x) => stroke(`M${x} 10.2V13.8`))],
    // The deck comes last, so the sides of the screen end under it.
    laptop: () => [stroke('M5 17.8V7A1.8 1.8 0 0 1 6.8 5.2H17.2A1.8 1.8 0 0 1 19 7V17.8'), slab(2, 17, 20, 2.6, 1.3, true)],
    // Kernel
    thread: () => [
        stroke('M12 2.8C13.3 3.2 15 3.8 15 4.9C15 6.7 9 6.7 9 8.5C9 10.3 15 10.3 15 12.1C15 14.1 12 14.1 12 16.1V19', true),
        solid('M12 21.6 10.5 19H13.5Z', true),
    ],
    interrupt: () => [
        stroke('M2.5 17.5H8.2'), ...arrowTo([14.8, 17.5], [21.5, 17.5], 0),
        stroke('M16.2 3.6 10.4 9.6H15.2', true), ...arrowTo([15.2, 9.6], [10.2, 20.4], 0, true),
    ],
    syscall: () => [stroke('M2.5 10H21.5'), stroke('M7.5 3.4V15.5A4.5 4.5 0 0 0 16.5 15.5', true), ...arrowTo([16.5, 15.5], [16.5, 2.6], 0, true)],
    ring: ringBuffer,
    page: () => [
        stroke('M3.5 3.5H16L20.5 8V20.5H3.5Z'), stroke('M16 3.5V8H20.5'), ...[6.2, 10.4].map((x) => slab(x, 7.2, 3.2, 2.4, 0.6, true)),
        ...[11.2, 15.2].flatMap((y) => [6.2, 10.4, 14.6].map((x) => slab(x, y, 3.2, 2.4, 0.6, true))),
    ],
    // The arrow and the fill come first, so the lines of the column stay whole over them.
    pagetable: () => [
        ...arrowTo([13, 9.75], [21.3, 9.75], 0, true), slab(4, 7.5, 9, 4.5, 0, true),
        box(4, 3, 9, 18, 1.8), stroke('M4 7.5H13'), stroke('M4 12H13'), stroke('M4 16.5H13'),
    ],
    pin: () => [
        box(3.5, 13.2, 17, 7.8, 2),
        solid('M8.6 2.2H15.4A1 1 0 0 1 15.4 4.2H14.4V6.6L16.9 9.4A1 1 0 0 1 16.2 11H7.8A1 1 0 0 1 7.1 9.4L9.6 6.6V4.2H8.6A1 1 0 0 1 8.6 2.2Z', true),
        stroke('M12 11V16.8', true),
    ],
    // Workflows
    // The arrow comes first, so it starts under the edge of the box. It ends on the edge.
    worker: () => [...arcArrow(15.5, 8.5, 5, Math.PI, Math.PI * 2.5 - 0.16, true), box(3, 8.5, 12.5, 12, 2.2)],
    workflow: () => [
        stroke('M8 4.6H17'), stroke('M11.5 9.6H21.5'), stroke('M11.5 14.4H18.5'), stroke('M8 19.4H13'),
        solid('M2.5 7H7.4V12.4L4.95 10.6 2.5 12.4Z', true),
    ],
    activity: () => [box(3, 5, 13, 14, 2.2), ...arrowTo([7.5, 12], [21.5, 12], 0, true)],
    // signal, query, and update share one box. An arrow to the box is a write. An arrow back is an answer, and it is dashed for a read.
    // The box comes last, so an arrow back starts under its edge.
    signal: () => [...arrowTo([2.5, 12], [12.7, 12], 0, true), box(13.5, 4.5, 8, 15, 2)],
    query: () => [...arrowTo([2.5, 8.6], [12.7, 8.6], 0), dashed('M11.6 15.4H5.4', true), solid('M2.5 15.4 4.7 14.2V16.6Z', true), box(13.5, 4.5, 8, 15, 2)],
    update: () => [...arrowTo([2.5, 8.6], [12.7, 8.6], 0, true), ...arrowTo([12.7, 15.4], [2.5, 15.4], 0), box(13.5, 4.5, 8, 15, 2)],
    // Code review
    issue: () => [box(2.5, 4, 19, 16, 2.2), ring(8, 10.2, 2.6, true), disc(8, 10.2, 0.9, true), stroke('M13.6 10.2H18.6'), stroke('M5.6 16.2H18.6')],
    pullRequest: () => [
        ring(6.5, 5.5, 2.4), stroke('M6.5 7.9V16.1'), ring(6.5, 18.5, 2.4),
        ring(17.5, 18.5, 2.4, true), stroke('M17.5 16.1V8.7A3.2 3.2 0 0 0 14.3 5.5H13.2', true), solid('M10.8 5.5 13.2 4V7Z', true),
    ],
    repository: () => [
        stroke('M3 7A1.8 1.8 0 0 1 4.8 5.2H9.2L11.4 7.8H19.2A1.8 1.8 0 0 1 21 9.6V17.7A1.8 1.8 0 0 1 19.2 19.5H4.8A1.8 1.8 0 0 1 3 17.7Z'),
        stroke('M9 11.3V16.1', true), stroke('M14.8 11.9C14.8 14.4 9 13.6 9 16.1', true), disc(9, 11.3, 1.5, true), disc(9, 16.1, 1.5, true), disc(14.8, 11.9, 1.5, true),
    ],
    // The checks come last: each one is larger than its box.
    checklist: () => [
        ...[5.5, 12, 18.5].flatMap((y, i) => [box(3.4, y - 1.8, 3.6, 3.6, 0.9), stroke(`M11 ${y}H${i === 1 ? 18 : 20.5}`)]),
        stroke('M3.9 5.4 5.3 6.8 8.4 3.3', true), stroke('M3.9 11.9 5.3 13.3 8.4 9.8', true),
    ],
    approval: () => [ring(8.4, 8.2, 3.3), curve(8.4, 20.5, 5.9, 6.4, Math.PI, Math.PI * 2), stroke('M14.8 8.4 17 10.6 21.2 5.8', true)],
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
    container: () => [stroke('M20 7.5V16.5L12 21 4 16.5V7.5'), stroke('M12 12V21'), stroke('M12 3 20 7.5 12 12 4 7.5Z', true)],
    experiment: () => [stroke('M9 3H15'), stroke('M10 3V9L4.6 18.8A1.5 1.5 0 0 0 5.9 21H18.1A1.5 1.5 0 0 0 19.4 18.8L14 9V3'), stroke('M7.6 15H16.4', true)],
    target: () => [ring(12, 12, 9.2), ring(12, 12, 5.2), disc(12, 12, 1.8, true)],
    loop: () => [...arcArrow(12, 12, 8, Math.PI * 1.08, Math.PI * 1.86), ...arcArrow(12, 12, 8, Math.PI * 0.08, Math.PI * 0.86, true)],
    eye: () => [stroke('M2.5 12C5 7.6 8.3 5.5 12 5.5S19 7.6 21.5 12C19 16.4 15.7 18.5 12 18.5S5 16.4 2.5 12Z'), ring(12, 12, 3, true)],
    message: () => [stroke('M4.5 4.5H19.5A2 2 0 0 1 21.5 6.5V14.5A2 2 0 0 1 19.5 16.5H10.5L6 20.5V16.5H4.5A2 2 0 0 1 2.5 14.5V6.5A2 2 0 0 1 4.5 4.5Z'), stroke('M7 9H17', true), stroke('M7 12.5H13.5', true)],
    shield: () => [stroke('M12 3 20 6V11.5C20 16.4 16.6 19.8 12 21.5C7.4 19.8 4 16.4 4 11.5V6Z'), stroke('M8.4 12 11 14.6 15.8 9.6', true)],
    browser: () => [box(2.5, 3.5, 19, 17, 2.2), stroke('M2.5 9.6H21.5'), disc(5.9, 6.6, 0.95), slab(8.4, 5.4, 10.6, 2.4, 1.2, true)],
    desktop: () => [box(3, 4, 18, 13, 2.2), stroke('M12 17V21'), stroke('M8.5 21H15.5'), solid('M9 6.2V14.2L11 12.4 12.4 15.2 13.9 14.5 12.5 11.7H15.2Z', true)],
    recording: () => [
        stroke('M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8'), stroke('M16 3H18.5A2.5 2.5 0 0 1 21 5.5V8'), stroke('M21 16V18.5A2.5 2.5 0 0 1 18.5 21H16'), stroke('M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16'),
        disc(12, 12, 3.6, true),
    ],
    // World
    // The stripe comes first, so the outline stays whole over its ends.
    creditCard: () => [slab(2.5, 8.6, 19, 3, 0, true), box(2.5, 5.5, 19, 13, 2.2), slab(5.6, 13.6, 3.8, 2.6, 0.6), stroke('M13.4 14.9H18')],
    warehouse: () => [
        stroke('M3 19.7V9.4L12 3.6 21 9.4V19.7'), stroke('M6.5 19.7V12H17.5V19.7'),
        slab(8.6, 17.9, 2.6, 2.6, 0.5, true), slab(12.8, 17.9, 2.6, 2.6, 0.5, true), slab(10.7, 14.3, 2.6, 2.6, 0.5, true),
    ],
    // The load comes after the cab, so its line stays whole where the cab meets it. The wheels come last and hide the lines behind them.
    truck: () => [stroke('M13.5 9H17.6L21.5 12.6V16.5H13.5'), stroke('M2.5 5.5H13.5V16.5H2.5Z', true), disc(6.6, 17.7, 2.3), disc(17.4, 17.7, 2.3)],
    microphone: () => [box(8.8, 2.8, 6.4, 11, 3.2, true), stroke('M5.5 10.5V11.3A6.5 6.5 0 0 0 18.5 11.3V10.5'), stroke('M12 17.8V21.2'), stroke('M8.5 21.2H15.5')],
    // The badge sits on the corner of the speech mark, so the outline stops short of it.
    forum: () => [
        stroke('M11.8 6.5H4.5A2 2 0 0 0 2.5 8.5V15.5A2 2 0 0 0 4.5 17.5H6V21L10.5 17.5H16.5A2 2 0 0 0 18.5 15.5V12'),
        solid('M17.6 2.8 18.66 5.34 21.4 5.56 19.31 7.36 19.95 10.04 17.6 8.6 15.25 10.04 15.89 7.36 13.8 5.56 16.54 5.34Z', true),
    ],
    // The lock comes last and hides the lower half of the document.
    paywall: () => [
        stroke('M5.5 15V2.8H14.7L18.5 6.6V15'), stroke('M14.7 2.8V6.6H18.5'),
        stroke('M9.3 14.6V12.4A2.7 2.7 0 0 1 14.7 12.4V14.6', true), slab(4.4, 14.6, 15.2, 6.9, 1.8, true),
    ],
    // General
    document: () => [stroke('M6 3H14.5L19 7.5V21H6Z'), stroke('M14.5 3V7.5H19'), stroke('M9 12.5H16', true), stroke('M9 16.5H16', true)],
    code: () => [stroke('M8.5 7 3.5 12 8.5 17'), stroke('M15.5 7 20.5 12 15.5 17'), stroke('M13.6 5 10.4 19', true)],
    gear,
    clock: () => [ring(12, 12, 9), stroke('M12 6.8V12L15.6 14.2', true)],
    user: () => [curve(12, 20.5, 7.6, 7.2, Math.PI, Math.PI * 2), ring(12, 8, 3.7, true)],
    search: () => [ring(10.5, 10.5, 6.6), stroke('M15.3 15.3 21 21', true)],
    filter: () => [disc(7, 3.7, 1.15), disc(12, 3.7, 1.15), disc(17, 3.7, 1.15), stroke('M3.5 7.6H20.5L14 14V17.4H10V14Z'), disc(12, 20.8, 1.15, true)],
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
    /**
     * The color of the part that carries the meaning, such as the forecast in `forecast`. A picture with one
     * part, such as `series` or `check`, is all in this color. Defaults to `color`.
     */
    accent?: ColorInput
    /** Stroke width, in units of the 24-unit grid. Defaults to 1.6. */
    weight?: number
}

/** A small picture of a concept. `.at(x, y)` places the middle of its grid, so pictures of one size line up. */
export class Pictogram extends Node {
    /** The side of the square that holds the picture, in pixels. */
    readonly size: number

    constructor(readonly name: PictogramName, options: PictogramOptions = {}) {
        super()
        if (!Object.hasOwn(ART, name)) throw new Error(`pictogram: unknown name ${JSON.stringify(name)}. Names: ${PICTOGRAMS.join(', ')}`)
        const size = options.size ?? 96, unit = size / GRID
        const place = [unit, 0, 0, unit, -size / 2, -size / 2] as const
        this.size = size
        const draw = ART[name]
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
