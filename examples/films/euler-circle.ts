/**
 * A point on the unit circle, read two ways. Its height traces sine and its
 * horizontal position traces cosine, against the angle. Stop at theta = pi and the
 * general formula collapses to Euler's identity, one substitution at a time.
 */
import {
    Node, arc, arrow, circle, curveThrough, draw, dot, dynamic, fadeIn, fadeOut, film, flash, line, linear, morphMatching, rect, smoother, text, tex, to, write,
    type Vec,
} from 'vizmatic/stage'

const TAU = Math.PI * 2
const R = 185
const CX = -650, CY = -208
const PLOT_X = -366, PLOT_W = 1210
const SIN_Y = CY, COS_Y = 176

export default film({
    title: "Euler's identity from a circle",
    description: 'A point sweeps the unit circle, sine and cosine trace themselves, and the formula collapses at theta equals pi.',
    fps: 60,
    bleed: true,
}, (s) => {
    const theta = s.value(0)
    const handAlpha = s.value(0)
    const unitAlpha = s.value(0)
    const P = (): Vec => [CX + Math.cos(theta.value) * R, CY - Math.sin(theta.value) * R]
    const plotX = (t: number) => PLOT_X + (t / TAU) * PLOT_W

    // ── The circle ──────────────────────────────────────────────────────────

    const axisH = line([CX - R - 34, CY], [CX + R + 34, CY], { stroke: 'faint', width: 1.6 })
    const axisV = line([CX, CY - R - 34], [CX, CY + R + 34], { stroke: 'faint', width: 1.6 })
    const ring = circle(R, { stroke: 'dim', width: 2.4 }).at(CX, CY)
    const unit = dynamic(() => {
        const a = unitAlpha.value
        if (a <= 0.001) return null
        const tag = tex('1', { size: 28, color: 'dim', display: false }).moveTo([CX + R + 28, CY + 34]).opacity(a)
        const ub = tag.bounds()
        return [
            rect(ub.width + 24, ub.height + 22, { fill: 'bg', stroke: null, radius: 5 }).at(ub.x + ub.width / 2, ub.y + ub.height / 2),
            tag,
        ]
    }).zIndex(3)

    const hand = dynamic(() => {
        const a = handAlpha.value
        if (a <= 0.001) return null
        const [px, py] = P()
        const t = theta.value
        const c = Math.cos(t), sn = Math.sin(t)
        const items: Node[] = []
        if (t > 0.02) {
            items.push(arc(46, 0, -t, { stroke: 'yellow', width: 3 }).at(CX, CY).opacity(a))
        }
        items.push(
            line([CX, CY], [CX + c * R, CY], { stroke: 'blue', width: 7 }).opacity(a),
            line([CX + c * R, CY], [CX + c * R, CY - sn * R], { stroke: 'pink', width: 7 }).opacity(a),
            arrow([CX, CY], [px, py], { stroke: 'ink', width: 3.2, tip: 16 }).opacity(a),
            dot(9.5, 'yellow').at(px, py).glow(14).opacity(a),
        )
        return items
    }).zIndex(2)

    const thetaTag = dynamic(() => {
        const a = handAlpha.value
        const t = theta.value
        if (a <= 0.001 || t <= 0.45) return null
        const mid = t / 2
        const label = tex('\\theta', { size: 30, color: 'yellow', display: false }).moveTo([CX + Math.cos(mid) * 86, CY - Math.sin(mid) * 86]).opacity(a)
        const b = label.bounds()
        return [
            rect(b.width + 24, b.height + 22, { fill: 'bg', stroke: null, radius: 6 }).at(b.x + b.width / 2, b.y + b.height / 2),
            label,
        ]
    }).zIndex(3)

    // ── The two traces ──────────────────────────────────────────────────────

    const tickMarks: Node[] = []
    const frame = (y: number, label: string, color: string): Node => {
        const parts: Node[] = [
            line([PLOT_X, y], [PLOT_X + PLOT_W + 10, y], { stroke: 'faint', width: 1.6 }),
            line([PLOT_X, y - R - 14], [PLOT_X, y + R + 14], { stroke: 'faint', width: 1.6 }),
            line([PLOT_X - 6, y - R], [PLOT_X + 6, y - R], { stroke: 'faint', width: 1.6 }),
            line([PLOT_X - 6, y + R], [PLOT_X + 6, y + R], { stroke: 'faint', width: 1.6 }),
            // Top middle stays clear: at theta = pi, sine is at 0 and cosine is at its lowest.
            tex(label, { size: 36, color, display: false }).moveTo([PLOT_X + PLOT_W * 0.5, y - R + 6]),
        ]
        for (const [mark, at] of [['\\pi/2', 0.25], ['\\pi', 0.5], ['3\\pi/2', 0.75], ['2\\pi', 1]] as const) {
            const x = PLOT_X + at * PLOT_W
            parts.push(line([x, y - 6], [x, y + 6], { stroke: 'faint', width: 1.6 }))
            const tick = tex(mark, { size: 28, color: 'dim', display: false }).moveTo([x + (at === 1 ? -8 : 0), y + 36])
            const tb = tick.bounds()
            tickMarks.push(
                rect(tb.width + 24, tb.height + 22, { fill: 'bg', stroke: null, radius: 5 }).at(tb.x + tb.width / 2, tb.y + tb.height / 2),
                tick,
            )
        }
        return new Node().add(...parts)
    }
    const sinFrame = frame(SIN_Y, '\\sin\\theta', 'pink')
    const cosFrame = frame(COS_Y, '\\cos\\theta', 'blue')
    const waveTicks = new Node().add(...tickMarks).zIndex(3)

    const traces = dynamic(() => {
        const end = theta.value
        const steps = Math.max(2, Math.ceil(end * 44))
        const sinPoints: Vec[] = [], cosPoints: Vec[] = []
        for (let i = 0; i <= steps; i++) {
            const t = (end * i) / steps
            sinPoints.push([plotX(t), SIN_Y - Math.sin(t) * R])
            cosPoints.push([plotX(t), COS_Y - Math.cos(t) * R])
        }
        const x = plotX(end)
        const sy = SIN_Y - Math.sin(end) * R, cy = COS_Y - Math.cos(end) * R
        return [
            // Same height on both sides: the point's height is the graph's value.
            line(P(), [x, sy], { stroke: 'pink', width: 1.5, dash: [3, 8], opacity: 0.7 }),
            new Node(curveThrough(sinPoints)).stroke('pink', 4).glow(6),
            new Node(curveThrough(cosPoints)).stroke('blue', 4).glow(6),
            dot(8, 'pink').at(x, sy),
            dot(8, 'blue').at(x, cy),
        ]
    }).zIndex(1)

    // ── Readouts, under the circle ──────────────────────────────────────────

    const LEFT = -864
    const readLabel = (content: string, y: number, color: string) => text(content, { font: 'mono', size: 28, color }).alignTo([LEFT, 0], 'left').alignTo([0, y], 'top')
    const reads = dynamic(() => {
        const t = theta.value
        const clean = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(3).padStart(6, ' ')
        return [
            readLabel(`θ   ${clean(t)}`, 36, 'yellow'),
            readLabel(`cos ${clean(Math.cos(t))}`, 80, 'blue'),
            readLabel(`sin ${clean(Math.sin(t))}`, 124, 'pink'),
        ]
    })
    const note = text('A complex number with length one is a point on this circle. Its angle is the exponent.', {
        size: 26, color: 'dim', maxWidth: 420, leading: 1.36,
    }).alignTo([LEFT, 0], 'left').alignTo([0, 196], 'top')

    // ── Words and equations ─────────────────────────────────────────────────

    const title = text('One point, two shadows.', { font: 'text-serif', size: 66 })
    title.alignTo([LEFT, 0], 'left').alignTo([0, -504], 'top')

    const EQ_Y = 452
    const at = (source: string, size = 62) => tex(source, { size }).moveTo([0, EQ_Y])
    const paint = (eq: ReturnType<typeof tex>, fragment: string, color: string) => {
        for (const glyph of eq.part(fragment)) glyph.fill(color)
    }
    const general = at('e^{i\\theta} = \\cos\\theta + i\\sin\\theta')
    paint(general, '\\cos\\theta', 'blue')
    paint(general, '\\sin\\theta', 'pink')
    paint(general, 'e^{i\\theta}', 'yellow')
    const atPi = at('e^{i\\pi} = \\cos\\pi + i\\sin\\pi')
    paint(atPi, '\\cos\\pi', 'blue')
    paint(atPi, '\\sin\\pi', 'pink')
    paint(atPi, 'e^{i\\pi}', 'yellow')
    const values = at('e^{i\\pi} = -1 + i \\cdot 0')
    paint(values, '-1', 'blue')
    paint(values, '0', 'pink')
    paint(values, 'e^{i\\pi}', 'yellow')
    const reduced = at('e^{i\\pi} = -1')
    paint(reduced, 'e^{i\\pi}', 'yellow')
    const identity = tex('e^{i\\pi} + 1 = 0', { size: 170 }).moveTo([0, 10])
    paint(identity, 'e^{i\\pi}', 'yellow')
    const caption = text('Half a turn, and you land on minus one.', { font: 'text-serif', italic: true, size: 50, color: 'dim' }).moveTo([0, 210])

    // ── Timeline ────────────────────────────────────────────────────────────

    s.chapter('The point')
    s.add(unit, hand, thetaTag)
    s.play(write(title), draw(axisH), draw(axisV), draw(ring), { duration: 1.8 })
    s.play(unitAlpha.to(1), handAlpha.to(1), { duration: 0.8 })
    s.play(write(general), fadeIn(note, { shift: [0, 8] }), { duration: 1.8 })
    s.play(theta.to(0.85), fadeIn(reads), { duration: 1.8 })
    s.wait(0.6)

    s.chapter('Two shadows')
    s.play(draw(sinFrame, { lag: 0.03 }), draw(cosFrame, { lag: 0.03 }), fadeIn(waveTicks), { duration: 1.6 })
    s.add(traces)
    s.play(fadeIn(traces), { duration: 0.4 })
    s.play(theta.to(TAU, { ease: linear }), { duration: 8 })
    s.wait(0.8)

    s.chapter('Stop at pi')
    s.play(theta.to(Math.PI, { ease: smoother }), { duration: 3.2 })
    s.play(flash(P(), { color: 'yellow', radius: 56 }), { duration: 0.7 })
    s.wait(0.5)
    s.play(morphMatching(general, atPi), { duration: 1.4 })
    s.wait(0.9)
    s.play(morphMatching(atPi, values), { duration: 1.4 })
    s.wait(0.9)
    s.play(morphMatching(values, reduced), { duration: 1.2 })
    s.wait(0.7)

    s.chapter('The identity')
    s.play(unitAlpha.to(0), handAlpha.to(0), fadeOut([title, note, reads, traces, sinFrame, cosFrame, waveTicks, axisH, axisV]), { duration: 0.85 })
    s.play(
        morphMatching(reduced, identity),
        to(ring, (r) => r.moveTo([0, 10]).scale(3.15).opacity(0.14)),
        { duration: 1.7 },
    )
    s.play(fadeIn(caption, { shift: [0, 14] }), { duration: 1.2 })
    s.wait(3.2)
})
