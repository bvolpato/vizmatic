/**
 * A matrix moves the whole plane. Follow the two basis arrows, watch the unit
 * square's area scale by the determinant, and find the two directions that stay
 * on their own lines. For A = [2 1; 0.5 1.5]: det A = 2.5, and the eigenvalues
 * are 2.5 on (2, 1) and 1 on (1, -1), so their product is the determinant.
 */
import {
    Node, applyMatrix, arrow, draw, dynamic, fade, fadeIn, film, flash, grow, indicate, line, plane, polyPath, ramp, rect, shape, text, tex, write,
    type Rgba, type Vec,
} from 'vizmatic/stage'

const A = [[2, 1], [0.5, 1.5]] as const
const INVERSE = [[0.6, -0.4], [-0.2, 0.8]] as const
const UNIT = 104
const ORIGIN_X = -250
const COLUMN = 480

export default film({
    title: 'What a matrix does',
    description: 'A grid under a matrix: basis arrows, the determinant as area, and eigenvectors that keep their lines.',
    fps: 60,
}, (s) => {
    const k = s.value(0)
    const moved = (x: number, y: number): Vec => {
        const a = k.value
        return [x + a * (A[0][0] * x + A[0][1] * y - x), y + a * (A[1][0] * x + A[1][1] * y - y)]
    }
    const P = (x: number, y: number): Vec => [ORIGIN_X + x * UNIT, -y * UNIT]
    const Pm = (x: number, y: number): Vec => {
        const [mx, my] = moved(x, y)
        return P(mx, my)
    }
    const determinant = () => {
        const a = k.value
        const m00 = 1 + a * (A[0][0] - 1), m01 = a * A[0][1], m10 = a * A[1][0], m11 = 1 + a * (A[1][1] - 1)
        return m00 * m11 - m01 * m10
    }

    // ── The plane ───────────────────────────────────────────────────────────

    const still = plane({ unit: UNIT, x: [-14, 14], y: [-11, 11], color: 'grid', axisColor: 'gridStrong', width: 1.2 }).at(ORIGIN_X, 0)
    const grid = plane({ unit: UNIT, x: [-14, 14], y: [-11, 11], color: 'blue', axisColor: 'ink', width: 1.5 }).at(ORIGIN_X, 0)
    grid.major.opacity(0.62)
    grid.axes.opacity(0.85)

    const chip = (label: Node, at: Vec, pad = 8): Node[] => {
        label.moveTo(at)
        const b = label.bounds()
        const back = rect(b.width + pad * 2, b.height + pad * 2, { fill: 'bg', stroke: null, radius: 6 })
            .at(b.x + b.width / 2, b.y + b.height / 2).opacity(0.88)
        return [back, label]
    }
    /** Label beside an arrow tip, not past it, so the chip never breaks the axis the arrow lies on. */
    const tipLabel = (x: number, y: number, source: string, color: string, side: 1 | -1): Node[] => {
        const [tx, ty] = Pm(x, y)
        const length = Math.hypot(tx - ORIGIN_X, ty) || 1
        const dx = (tx - ORIGIN_X) / length, dy = ty / length
        const normalX = -dy * side, normalY = dx * side
        return chip(tex(source, { size: 34, color, display: false }), [tx - dx * 10 + normalX * 34, ty - dy * 10 + normalY * 34])
    }

    const basis = dynamic(() => [
        arrow(P(0, 0), Pm(1, 0), { stroke: 'green', width: 5, tip: 22 }),
        arrow(P(0, 0), Pm(0, 1), { stroke: 'red', width: 5, tip: 22 }),
        ...tipLabel(1, 0, '\\hat{\\imath}', 'green', 1),
        ...tipLabel(0, 1, '\\hat{\\jmath}', 'red', -1),
    ])

    const square = dynamic(() => {
        const corners = [Pm(0, 0), Pm(1, 0), Pm(1, 1), Pm(0, 1)]
        const cx = corners.reduce((sum, c) => sum + c[0], 0) / 4, cy = corners.reduce((sum, c) => sum + c[1], 0) / 4
        return [
            shape(polyPath(corners, true), { fill: 'yellow', stroke: 'yellow', width: 2.5 }).set('fillOpacity', 0.32),
            ...chip(tex(determinant().toFixed(2), { size: 30, color: 'yellow', display: false }), [cx, cy], 6),
        ]
    })

    // The fan: one short arrow per direction, tinted by direction, all from the origin.
    const FAN = 56
    const fanColors: readonly Rgba[] = ramp(FAN + 1, 'teal', 'blue', 'purple', 'pink', 'orange', 'gold', 'teal')
    const eigenAngles = [Math.atan2(1, 2), Math.atan2(1, 2) + Math.PI, Math.atan2(-1, 1), Math.atan2(-1, 1) + Math.PI]
    const fan = dynamic(() => {
        const out: Node[] = []
        for (let i = 0; i < FAN; i++) {
            const angle = (i / FAN) * Math.PI * 2
            if (eigenAngles.some((e) => Math.abs(Math.atan2(Math.sin(angle - e), Math.cos(angle - e))) < 0.06)) continue
            const x = Math.cos(angle) * 1.15, y = Math.sin(angle) * 1.15
            out.push(arrow(P(0, 0), Pm(x, y), { stroke: fanColors[i]!, width: 2.4, tip: 11 }))
        }
        return out
    })
    const lineStretch = line(P(-5.4, -2.7), P(5.4, 2.7), { stroke: 'yellow', width: 2, dash: [10, 9] })
    const lineFixed = line(P(-5, 5), P(5, -5), { stroke: 'teal', width: 2, dash: [10, 9] })
    const eigen = dynamic(() => [
        arrow(P(0, 0), Pm(2 * 0.8, 0.8), { stroke: 'yellow', width: 6, tip: 24, glow: 8 }),
        arrow(P(0, 0), Pm(-2 * 0.8, -0.8), { stroke: 'yellow', width: 6, tip: 24, glow: 8 }),
        arrow(P(0, 0), Pm(1.1, -1.1), { stroke: 'teal', width: 6, tip: 24, glow: 8 }),
        arrow(P(0, 0), Pm(-1.1, 1.1), { stroke: 'teal', width: 6, tip: 24, glow: 8 }),
    ])

    // ── The column ──────────────────────────────────────────────────────────

    const column = rect(960 - COLUMN + 70, 1080, { fill: 'bg', stroke: null }).at((COLUMN - 70 + 960) / 2, 0).zIndex(5)
    const rule = line([COLUMN - 70, -540], [COLUMN - 70, 540], { stroke: 'grid', width: 1.2 }).zIndex(5)
    const place = <T extends Node>(node: T, top: number): T => {
        node.alignTo([COLUMN, 0], 'left').alignTo([0, top], 'top')
        node.zIndex(6)
        return node
    }
    const title = place(text('A matrix moves the whole plane.', { font: 'text-serif', size: 46, maxWidth: 440, leading: 1.08 }), -490)
    const matrix = place(tex('A = \\begin{bmatrix} 2 & 1 \\\\ 0.5 & 1.5 \\end{bmatrix}', { size: 44 }), -340)
    // Column one is where the first arrow lands. Column two is where the second lands.
    for (const i of [3, 5, 6, 7]) matrix.glyphs[i]!.fill('green')
    for (const i of [4, 8, 9, 10]) matrix.glyphs[i]!.fill('red')

    const label = (content: string, top: number) => place(text(content, { size: 19, color: 'dim', uppercase: true, tracking: 0.08, weight: 600 }), top)
    const tracksLabel = label('Where the arrows land', -196)
    const reads = dynamic(() => {
        const [ix, iy] = moved(1, 0), [jx, jy] = moved(0, 1)
        const row = (name: string, x: number, y: number, color: string, top: number) =>
            place(text(`${name} (${x.toFixed(2)}, ${y.toFixed(2)})`, { font: 'mono', size: 30, color }), top)
        return [row('i', ix, iy, 'green', -162), row('j', jx, jy, 'red', -116)]
    }).zIndex(6)
    const areaLabel = label('Area of the unit square', -42)
    const areaRead = dynamic(() => place(text(determinant().toFixed(2), { font: 'mono', size: 72, color: 'yellow' }), -12)).zIndex(6)
    const detEq = place(tex('\\det A = 2 \\cdot 1.5 - 1 \\cdot 0.5 = 2.5', { size: 30 }), 96)

    const eigenLabel = label('Arrows that keep their line', 180)
    const eqA = place(tex('A \\vec{v} = \\lambda \\vec{v}', { size: 48, color: 'ink' }), 214)
    const stretchRow = place(tex('\\vec{v} = (2, 1), \\quad \\lambda = 2.5', { size: 30, color: 'yellow' }), 296)
    const fixedRow = place(tex('\\vec{v} = (1, -1), \\quad \\lambda = 1', { size: 30, color: 'teal' }), 346)
    const closing = place(tex('\\lambda_1 \\lambda_2 = 2.5 \\cdot 1 = \\det A', { size: 34, color: 'ink' }), 416)

    // ── Timeline ────────────────────────────────────────────────────────────

    s.add(still, grid)
    s.add(column, rule)
    s.chapter('Two arrows')
    s.play(write(title), draw(grid.major, { lag: 0.015 }), draw(grid.axes), { duration: 2.4 })
    s.play(grow(basis, { from: P(0, 0) }), write(matrix), { duration: 1.4 })
    s.play(fadeIn([tracksLabel, reads], { shift: [0, 8] }), { duration: 0.8 })
    s.wait(1.2)

    s.chapter('The move')
    s.play(applyMatrix(grid, A, { origin: [ORIGIN_X, 0] }), k.to(1), { duration: 3.4 })
    s.wait(0.4)
    s.play(indicate(matrix.glyphs.filter((_, i) => [3, 5, 6, 7].includes(i)), { color: 'green', scale: 1.16 }), { duration: 0.9 })
    s.play(indicate(matrix.glyphs.filter((_, i) => [4, 8, 9, 10].includes(i)), { color: 'red', scale: 1.16 }), { duration: 0.9 })
    s.wait(0.8)

    s.chapter('Area')
    s.play(applyMatrix(grid, INVERSE, { origin: [ORIGIN_X, 0] }), k.to(0), { duration: 1.8 })
    s.add(square)
    s.play(fadeIn(square), fadeIn([areaLabel, areaRead], { shift: [0, 8] }), { duration: 0.8 })
    s.wait(0.5)
    s.play(applyMatrix(grid, A, { origin: [ORIGIN_X, 0] }), k.to(1), { duration: 3.2 })
    s.play(write(detEq), { duration: 1.4 })
    s.wait(1)

    s.chapter('Lines that stay')
    s.play(applyMatrix(grid, INVERSE, { origin: [ORIGIN_X, 0] }), k.to(0), fade(square, 0), fade(basis, 0), { duration: 1.8 })
    s.add(fan)
    s.play(grow(fan, { from: P(0, 0) }), draw(lineStretch), draw(lineFixed), { duration: 1.4 })
    s.add(eigen)
    s.play(fadeIn(eigen), { duration: 0.6 })
    s.play(fadeIn(eigenLabel), write(eqA), { duration: 1.2 })
    s.wait(0.6)
    s.play(applyMatrix(grid, A, { origin: [ORIGIN_X, 0] }), k.to(1), { duration: 4 })
    s.wait(0.5)
    s.play(flash(Pm(1.6, 0.8), { color: 'yellow' }), write(stretchRow), { duration: 1.2 })
    s.play(flash(Pm(1.1, -1.1), { color: 'teal' }), write(fixedRow), { duration: 1.2 })
    s.wait(0.8)
    s.play(write(closing), { duration: 1.4 })
    s.wait(2)
})
