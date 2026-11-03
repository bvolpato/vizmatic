/**
 * Complex functions bend a grid and keep its right angles. Both acts move through
 * a family of maps that are conformal at every instant: z^p as p runs from 1 to
 * 2, then Mobius maps from the identity to (z - i) / (z + i). The angle readout
 * is measured from the drawn geometry, not assumed.
 */
import {
    Node, dot, dynamic, fade, fadeIn, film, flash, line, morphMatching, polyPath, rect, shape, smooth, smoother, smoothPath, text, tex, write,
    type Vec,
} from 'vizmatic/stage'

type C = readonly [number, number]
const ORIGIN_X = -250
const COLUMN = 480
const SAMPLES = 72

const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const div = (a: C, b: C): C => {
    const d = b[0] * b[0] + b[1] * b[1]
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]
}
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]]
const abs = (a: C) => Math.hypot(a[0], a[1])

function power(z: C, p: number): C {
    const r = abs(z)
    if (r === 0) return [0, 0]
    const angle = Math.atan2(z[1], z[0]) * p, size = Math.pow(r, p)
    return [size * Math.cos(angle), size * Math.sin(angle)]
}

/** Mobius family from the identity (k = 0) to the Cayley map (k = 1). The pole stays below the real axis. */
function mobius(z: C, k: number): C {
    const b: C = [0, -k], c: C = [k, 0], d: C = [1 - k, k]
    return div(add(z, b), add(mul(c, z), d))
}

interface Strand { points: C[]; color: 'blue' | 'pink' | 'ink'; major: boolean }

function rightHalfGrid(): Strand[] {
    const out: Strand[] = []
    for (let i = 1; i <= 22; i++) {
        const x = i * 0.25
        const points: C[] = []
        for (let j = 0; j <= SAMPLES; j++) points.push([x, -5 + (10 * j) / SAMPLES])
        out.push({ points, color: 'blue', major: i % 4 === 0 })
    }
    for (let i = -20; i <= 20; i++) {
        if (i === 0) continue
        const y = i * 0.25
        const points: C[] = []
        for (let j = 0; j <= SAMPLES; j++) points.push([(5.5 * j) / SAMPLES, y])
        out.push({ points, color: 'pink', major: i % 4 === 0 })
    }
    const axisReal: C[] = [], axisImag: C[] = []
    for (let j = 0; j <= SAMPLES; j++) {
        axisReal.push([(5.5 * j) / SAMPLES, 0])
        axisImag.push([0, -5 + (10 * j) / SAMPLES])
    }
    out.push({ points: axisReal, color: 'ink', major: true }, { points: axisImag, color: 'ink', major: true })
    return out
}

function upperHalfGrid(): Strand[] {
    const out: Strand[] = []
    const reach = Math.atan(600)
    for (let i = -14; i <= 14; i++) {
        const x = i * 0.5
        const points: C[] = []
        for (let j = 0; j <= SAMPLES * 2; j++) points.push([x, Math.tan((reach * j) / (SAMPLES * 2))])
        out.push({ points, color: 'blue', major: i % 2 === 0 })
    }
    for (const y of [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 9]) {
        const points: C[] = []
        for (let j = -SAMPLES; j <= SAMPLES; j++) points.push([y * 0 + Math.tan(reach * (j / SAMPLES)), y])
        out.push({ points, color: 'pink', major: y === 1 || y === 2 || y === 4 })
    }
    const boundary: C[] = []
    for (let j = -SAMPLES * 2; j <= SAMPLES * 2; j++) boundary.push([Math.tan(reach * (j / (SAMPLES * 2))), 0])
    out.push({ points: boundary, color: 'ink', major: true })
    return out
}

export default film({
    title: 'Complex maps keep right angles',
    description: 'A grid unfolds under z squared and curls into a disk under a Mobius map, with every crossing staying square.',
    fps: 60,
    bleed: true,
}, (s) => {
    const firstGrid = rightHalfGrid()
    const secondGrid = upperHalfGrid()
    const p = s.value(1)
    const k = s.value(0)
    const reveal = s.value(0)
    const reveal2 = s.value(0)
    const zoom = s.value(1)
    const firstAlpha = s.value(1)
    const secondAlpha = s.value(0)
    const focusX = s.value(0), focusY = s.value(0)

    const UNIT = 150
    const toStageA = (w: C): Vec => [ORIGIN_X + w[0] * UNIT, -w[1] * UNIT]
    const toStageB = (w: C): Vec => {
        const t = k.value
        const unit = 92 + (410 - 92) * t
        const oy = 410 * (1 - t)
        return [ORIGIN_X + w[0] * unit, oy - w[1] * unit]
    }

    const Z0: C = [1.25, 0.75]
    const Z1: C = [1, 1]

    const strokes = (grid: Strand[], map: (z: C) => Vec, amount: number, alpha: number): Node[] => {
        const z = zoom.value
        const scale = 1 / Math.pow(z, 0.75)
        return grid.map((strand) => {
            const count = Math.max(2, Math.ceil(strand.points.length * amount))
            const pts: Vec[] = []
            for (let i = 0; i < count; i++) pts.push(map(strand.points[i]!))
            const width = (strand.color === 'ink' ? 2.6 : strand.major ? 2 : 1.1) * scale
            return new Node(smoothPath(pts)).stroke(strand.color, width, (strand.major ? 0.95 : 0.6) * alpha)
        })
    }

    const firstField = dynamic(() => {
        if (firstAlpha.value <= 0) return null
        return strokes(firstGrid, (z) => toStageA(power(z, p.value)), reveal.value, firstAlpha.value)
    })
    const secondField = dynamic(() => {
        if (secondAlpha.value <= 0) return null
        return strokes(secondGrid, (z) => toStageB(mobius(z, k.value)), reveal2.value, secondAlpha.value)
    })

    /** A right-angle marker built from the images of two short steps along the grid directions. */
    const marker = (map: (z: C) => Vec, at: C, color: string, label: string): Node[] => {
        const z = zoom.value
        const scale = 1 / Math.pow(z, 0.85)
        const h = 1e-4
        const o = map(at), a = map(add(at, [h, 0])), b = map(add(at, [0, h]))
        const length = (d: Vec) => Math.hypot(d[0], d[1]) || 1
        const u: Vec = [(a[0] - o[0]) / length([a[0] - o[0], a[1] - o[1]]), (a[1] - o[1]) / length([a[0] - o[0], a[1] - o[1]])]
        const v: Vec = [(b[0] - o[0]) / length([b[0] - o[0], b[1] - o[1]]), (b[1] - o[1]) / length([b[0] - o[0], b[1] - o[1]])]
        const size = 38 * scale
        const corner = polyPath([
            [o[0], o[1]], [o[0] + u[0] * size, o[1] + u[1] * size],
            [o[0] + (u[0] + v[0]) * size, o[1] + (u[1] + v[1]) * size], [o[0] + v[0] * size, o[1] + v[1] * size],
        ], true)
        const tag = tex(label, { size: 30 * scale, color, display: false })
        tag.moveTo([o[0] - (u[0] + v[0]) * 30 * scale, o[1] - (u[1] + v[1]) * 30 * scale])
        const b2 = tag.bounds()
        return [
            shape(corner, { fill: color, stroke: color, width: 2.6 * scale }).set('fillOpacity', 0.28),
            dot(6.5 * scale, color).at(o),
            rect(b2.width + 10 * scale, b2.height + 8 * scale, { fill: 'bg', stroke: null, radius: 5 * scale })
                .at(b2.x + b2.width / 2, b2.y + b2.height / 2).opacity(0.94),
            tag,
        ]
    }

    const markerA = dynamic(() => firstAlpha.value <= 0 ? null : marker((z) => toStageA(power(z, p.value)), Z0, 'yellow', 'z_0'))
    const markerB = dynamic(() => secondAlpha.value <= 0 ? null : marker((z) => toStageB(mobius(z, k.value)), Z1, 'yellow', 'z_0'))

    // Four landmarks of the second map.
    const landmarks: readonly [C, string][] = [[[0, 1], 'i'], [[0, 0], '0'], [[1, 0], '1'], [[-1, 0], '-1']]
    const pointsB = dynamic(() => landmarks.flatMap(([z, label]) => {
        const at = toStageB(mobius(z, k.value))
        const tag = tex(label, { size: 30, color: 'ink', display: false })
        tag.moveTo([at[0] + 26, at[1] - 22])
        const b = tag.bounds()
        return [
            dot(7, 'teal').at(at),
            rect(b.width + 10, b.height + 8, { fill: 'bg', stroke: null, radius: 5 }).at(b.x + b.width / 2, b.y + b.height / 2).opacity(0.94),
            tag,
        ]
    }))

    const infinityMark = tex('\\infty', { size: 38, color: 'teal', display: false }).moveTo([ORIGIN_X + 410 + 34, -32])

    // ── Column ──────────────────────────────────────────────────────────────

    const backing = rect(960 - COLUMN + 70, 1080, { fill: 'bg', stroke: null }).at((COLUMN - 70 + 960) / 2, 0).pin().zIndex(5)
    const rule = line([COLUMN - 70, -540], [COLUMN - 70, 540], { stroke: 'grid', width: 1.2 }).pin().zIndex(5)
    const place = <T extends Node>(node: T, top: number): T => {
        node.alignTo([COLUMN, 0], 'left').alignTo([0, top], 'top')
        node.pin().zIndex(6)
        return node
    }
    const label = (content: string, top: number) => place(text(content, { size: 19, color: 'dim', uppercase: true, tracking: 0.08, weight: 600 }), top)

    const title = place(text('The grid bends. Its right angles survive.', { font: 'serif', size: 58, maxWidth: 410, leading: 1.08 }), -490)
    const eqIdentity = place(tex('w = z', { size: 54 }), -296)
    const eqPower = place(tex('w = z^{p}', { size: 54 }), -296)
    const eqSquare = place(tex('w = z^{2}', { size: 54, color: 'ink' }), -296)
    const eqMobius = place(tex('w = \\frac{z - i}{z + i}', { size: 46 }), -356)

    const pLabel = label('Exponent', -196)
    const pRead = dynamic(() => place(text(`p = ${p.value.toFixed(2)}`, { font: 'mono', size: 44, color: 'ink' }), -168)).pin().zIndex(6)
    const kLabel = label('Along the Mobius family', -196)
    const kRead = dynamic(() => place(text(`k = ${k.value.toFixed(2)}`, { font: 'mono', size: 44, color: 'ink' }), -168)).pin().zIndex(6)

    const derivative = (): { size: number; angle: number; crossing: number } => {
        const act = secondAlpha.value > 0.5
        const at = act ? Z1 : Z0
        const map = (z: C): C => act ? mobius(z, k.value) : power(z, p.value)
        const h = 1e-5
        const o = map(at), a = map(add(at, [h, 0])), b = map(add(at, [0, h]))
        const dx: C = [(a[0] - o[0]) / h, (a[1] - o[1]) / h], dy: C = [(b[0] - o[0]) / h, (b[1] - o[1]) / h]
        const crossing = Math.abs(Math.atan2(dx[0] * dy[1] - dx[1] * dy[0], dx[0] * dy[0] + dx[1] * dy[1])) * 180 / Math.PI
        return { size: abs(dx), angle: Math.atan2(dx[1], dx[0]) * 180 / Math.PI, crossing }
    }
    const angleLabel = label('Angle between grid lines at z0', -92)
    const angleRead = dynamic(() => place(text(`${derivative().crossing.toFixed(2)} deg`, { font: 'mono', size: 44, color: 'yellow' }), -64)).pin().zIndex(6)
    const scaleLabel = label('Local stretch', 20)
    const scaleRead = dynamic(() => place(text(derivative().size.toFixed(2), { font: 'mono', size: 36, color: 'ink' }), 48)).pin().zIndex(6)
    const turnLabel = label('Local turn', 20)
    turnLabel.alignTo([COLUMN + 200, 0], 'left')
    const turnRead = dynamic(() => {
        const node = place(text(`${derivative().angle.toFixed(1)} deg`, { font: 'mono', size: 36, color: 'ink' }), 48)
        node.alignTo([COLUMN + 200, 0], 'left')
        return node
    }).pin().zIndex(6)
    const note = place(text('Near any point, a complex derivative is one rotation and one scale. A small square can only come out as another square.', {
        size: 24, color: 'dim', maxWidth: 400, leading: 1.42,
    }), 130)
    const deriv = place(tex("f(z_0 + h) \\approx f(z_0) + f'(z_0)\\, h", { size: 30 }), 316)
    const note2 = place(text('A map of this kind sends lines to circles. The whole upper half-plane lands inside the unit disk.', {
        size: 24, color: 'dim', maxWidth: 400, leading: 1.42,
    }), 130)
    const landing = place(tex('i \\mapsto 0, \\quad 0 \\mapsto -1', { size: 32, color: 'teal' }), 300)
    const landing2 = place(tex('1 \\mapsto -i, \\quad -1 \\mapsto i', { size: 32, color: 'teal' }), 354)

    // ── Timeline ────────────────────────────────────────────────────────────

    s.add(firstField, markerA)
    markerA.opacity(0)
    s.add(backing, rule)
    s.chapter('The grid')
    s.play(reveal.to(1, { ease: smooth }), write(title), { duration: 2.4 })
    s.play(write(eqIdentity), fade(markerA, 1), fadeIn([angleLabel, angleRead, scaleLabel, scaleRead, turnLabel, turnRead]), { duration: 1.2 })
    s.play(fadeIn(note, { shift: [0, 8] }), write(deriv), { duration: 1.2 })
    s.wait(0.8)

    s.chapter('Square it')
    s.play(morphMatching(eqIdentity, eqPower), fadeIn([pLabel, pRead]), { duration: 1 })
    s.play(p.to(2, { ease: smoother }), { duration: 7 })
    s.play(morphMatching(eqPower, eqSquare), { duration: 0.9 })
    s.wait(0.6)

    s.chapter('Look closer')
    const w0 = power(Z0, 2)
    const target = toStageA(w0)
    s.update(s.camera, (camera) => {
        camera.at(focusX.value, focusY.value)
        camera.set('sx', zoom.value)
    })
    const offset = 240
    s.play(zoom.to(3.4, { ease: smoother }), focusX.to(target[0] + offset / 3.4, { ease: smoother }), focusY.to(target[1], { ease: smoother }), fade(title, 0.25), { duration: 3 })
    s.play(flash([-240, 0], { color: 'yellow', radius: 74 }), { duration: 0.8 })
    s.wait(2)
    s.play(zoom.to(1, { ease: smoother }), focusX.to(0, { ease: smoother }), focusY.to(0, { ease: smoother }), fade(title, 1), { duration: 2.4 })

    s.chapter('A different map')
    s.add(secondField, markerB)
    markerB.opacity(0)
    backing.zIndex(5)
    s.play(firstAlpha.to(0), fade(markerA, 0), fadeIn(eqMobius), fade(eqSquare, 0), fade(pLabel, 0), fade(pRead, 0), fade(note, 0), fade(deriv, 0), { duration: 1 })
    s.play(reveal2.to(1), secondAlpha.to(1, { ease: smoother }), fadeIn([kLabel, kRead]), fadeIn(note2, { shift: [0, 8] }), { duration: 2.2 })
    s.play(fade(markerB, 1), fadeIn(pointsB), { duration: 0.8 })
    s.wait(0.6)
    s.play(k.to(1, { ease: smoother }), { duration: 8 })
    s.play(write(landing), write(landing2), write(infinityMark), { duration: 1.6 })
    s.wait(3)
})
