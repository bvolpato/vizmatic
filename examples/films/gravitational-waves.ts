import {
    Box, axes, circle, column, curve, curve3d, dot, dynamic, fadeIn, fadeOut,
    film, line, line3d, place, point3d, scene3d, sceneKit, text, tex, vector3d,
    type Node, type Vec,
} from 'vizmatic/stage'
import { displayGain, ringPoint, separation, strain, strainAmplitude, type Polarization } from './_gravitational-waves/model'

const DURATION = 42
const RADIUS = 192
const modeAt = (t: number): Polarization => t < 10 ? 'plus' : t < 20 ? 'cross' : 'circular'
const visibility = (t: number): number => Math.min(1, ...[10, 20, 29].map((cut) => Math.abs(t - cut) / 0.22))

export default film({
    title: 'Gravitational waves: a changing separation',
    description: 'Linearized transverse-traceless strain, plus and cross polarizations, circular superposition, and a plane wave propagating at c. Test-mass separations are magnified 600 times. The rings are local measuring arrangements, not material space.',
    look: 'midnight', font: 'text-serif', fps: 60, poster: 35,
}, (s) => {
    const kit = sceneKit({ heading: { size: 64, y: -466 }, area: { left: -875, right: 875, top: -286, bottom: 300 } })
    s.add(kit.heading('Gravitational waves'))
    s.add(place(column([
        text('Tong · Cambridge', { size: 26, color: 'dim' }),
        text('General Relativity §5.2', { size: 26, color: 'dim' }),
    ], { gap: 4 }), new Box(390, -507, 875, -432), 'right'))
    s.add(place(text('Linearized TT strain · A = 0.001 · displacement ×600 · schematic units, c = 1', { size: 30, color: 'dim' }),
        new Box(-875, -416, 875, -370), 'left'))
    const chapterBox = new Box(-875, -357, 875, -310)
    const footerBox = new Box(-875, 349, 875, 441)
    const [ringBox, detailBox] = kit.area.columns([1.5, 1], 70)
    const center: Vec = ringBox.point()
    const at = (x: number, y: number): Vec => [center[0] + RADIUS * x, center[1] - RADIUS * y]

    const ring = dynamic((t) => {
        if (t >= 29 || visibility(t) < 0.001) return []
        const mode = modeAt(t), color = mode === 'cross' ? 'orange' : 'teal'
        const { plus, cross } = strain(0, t, mode)
        const point = (angle: number) => at(...separation(Math.cos(angle), Math.sin(angle), plus, cross, displayGain))
        const nodes = [
            circle(RADIUS, { stroke: 'dim', width: 1.7, dash: [5, 8], opacity: 0.6 }).at(center),
            line(at(-1.48, 0), at(1.48, 0), { stroke: 'grid', width: 1.5 }),
            line(at(0, -1.2), at(0, 1.2), { stroke: 'grid', width: 1.5 }),
            curve(Array.from({ length: 97 }, (_, i) => point(i * Math.PI / 48)), { stroke: color, width: 3.5, glow: 3 }),
        ]
        // The short strokes connect each unperturbed position to its local
        // separation vector, not to neighboring particles as a material mesh.
        for (let i = 0; i < 24; i++) {
            const angle = i * Math.PI / 12
            nodes.push(line(at(Math.cos(angle), Math.sin(angle)), point(angle), { stroke: color, width: 2, opacity: 0.4 }))
            nodes.push(dot(i % 6 === 0 ? 8 : 5.5, i % 6 === 0 ? 'ink' : color).at(point(angle)))
        }
        if (t >= 20) {
            const angle = Math.atan2(cross, plus) / 2
            nodes.push(line(point(angle), point(angle + Math.PI), { stroke: 'teal', width: 2, dash: [7, 8], opacity: 0.7 }))
            nodes.push(line(point(angle + Math.PI / 2), point(angle + Math.PI * 1.5), { stroke: 'orange', width: 2, dash: [7, 8], opacity: 0.7 }))
        }
        nodes.push(dot(5, 'ink').at(center))
        return nodes.map((node) => node.opacity(node.get('opacity') * visibility(t)))
    })
    s.add(ring)
    const axisNames = [
        place(text('x', { size: 30, color: 'dim' }), new Box(center[0] + 294, center[1] - 24, center[0] + 344, center[1] + 24)),
        place(text('y', { size: 30, color: 'dim' }), new Box(center[0] - 24, ringBox.top - 12, center[0] + 24, ringBox.top + 32)),
        place(text('Local separations in the x–y plane', { size: 28, color: 'dim' }), new Box(ringBox.left, 305, ringBox.right, 342)),
    ]
    s.add(axisNames)
    s.at(28.7, () => s.play(fadeOut(axisNames), { duration: 0.22 }))

    const [equationBox, responseBox] = detailBox.rows([0.49, 0.51], 30)
    const matrix = place(column([
        tex('h^{\\mathrm{TT}}_{ab}=\\begin{pmatrix}h_+&h_\\times\\\\h_\\times&-h_+\\end{pmatrix}', { size: 42 }),
        tex('\\Delta\\mathbf r=\\tfrac12 h^{\\mathrm{TT}}\\mathbf r_0', { size: 42 }),
        text('a, b = x, y   ·   first order in h', { size: 28, color: 'dim' }),
    ], { gap: 26 }), equationBox)
    s.add(matrix)
    s.at(28.7, () => s.play(fadeOut(matrix), { duration: 0.22 }))

    const gauges = dynamic((t) => {
        if (t >= 20 || visibility(t) < 0.001) return []
        const mode = modeAt(t), h = strain(0, t, mode)
        const normalized = (mode === 'plus' ? h.plus : h.cross) / strainAmplitude
        const boxes = responseBox.rows([0.2, 0.4, 0.4], 12)
        const nodes: Node[] = [place(text('Relative length change / A', { size: 29 }), boxes[0])]
        for (let i = 0; i < 2; i++) {
            const box = boxes[i + 1]
            const [nameBox, gaugeBox, numberBox] = box.columns([0.22, 0.46, 0.32], 14)
            nodes.push(place(text(mode === 'plus' ? (i ? 'y axis' : 'x axis') : (i ? '−45°' : '+45°'), { size: 28 }), nameBox))
            const start: Vec = gaugeBox.point(), end: Vec = [start[0] + normalized * (i ? -1 : 1) * gaugeBox.width * 0.45, start[1]]
            nodes.push(line([gaugeBox.left, start[1]], [gaugeBox.right, start[1]], { stroke: 'grid', width: 2 }))
            nodes.push(line([start[0], start[1] - 13], [start[0], start[1] + 13], { stroke: 'dim', width: 2 }))
            nodes.push(line(start, end, { stroke: i ? 'orange' : 'teal', width: 9 }))
            nodes.push(dot(6, i ? 'orange' : 'teal').at(end))
            nodes.push(place(text(`${normalized * (i ? -0.5 : 0.5) >= 0 ? '+' : '−'}${Math.abs(normalized * 0.5).toFixed(3)}`, { size: 28, font: 'mono', color: i ? 'orange' : 'teal' }), numberBox))
        }
        return nodes.map((node) => node.opacity(visibility(t)))
    })
    s.add(gauges)
    const [phaseTitleBox, phasePlotBox] = responseBox.rows([0.2, 0.8], 14)
    const phaseTitle = place(text('Equal amplitudes, a quarter-cycle apart', { size: 29 }), phaseTitleBox)
    const phasePlot = place(axes({ x: [-1.4, 1.4], y: [-1.4, 1.4], width: 200, height: 200,
        xTicks: [-1, 0, 1], yTicks: [-1, 0, 1], labels: false, tips: false, color: 'dim' }), phasePlotBox)
    phasePlot.add(circle(200 / 2.8, { stroke: 'dim', width: 2, dash: [5, 7] }))
    phasePlot.add(dynamic((t) => {
        if (t < 20 || t >= 29) return []
        const { plus, cross } = strain(0, t, 'circular')
        const tip = phasePlot.p(plus / strainAmplitude, cross / strainAmplitude)
        return [line(phasePlot.p(0, 0), tip, { stroke: 'teal', width: 3 }), dot(8, 'teal').at(tip)]
    }))
    const phaseLabels = [
        place(tex('h_+/A', { size: 29 }), new Box(phasePlotBox.cx + 118, phasePlotBox.cy - 26, phasePlotBox.right, phasePlotBox.cy + 26), 'left'),
        place(tex('h_\\times/A', { size: 29 }), new Box(phasePlotBox.left, phasePlotBox.top, phasePlotBox.cx - 115, phasePlotBox.top + 50), 'right'),
    ]
    s.at(20.1, () => s.play(fadeIn([phaseTitle, phasePlot, ...phaseLabels]), { duration: 0.25 }))
    s.at(28.7, () => s.play(fadeOut([phaseTitle, phasePlot, ...phaseLabels]), { duration: 0.22 }))

    const [propagationBox, propagationMath] = kit.area.rows([0.73, 0.27], 25)
    const wave = dynamic((t) => {
        if (t < 29 || visibility(t) < 0.001) return []
        // A row of independent transverse measuring rings. No connecting
        // sheet or tube: the geometry represents separations, not a substance.
        const view = scene3d({ theta: -1.18, phi: 1.5, unit: 121, perspective: false, fog: 0.12 })
            .at(propagationBox.cx, propagationBox.cy).opacity(visibility(t))
        // Rotate model z onto world x only for a wide, legible projection.
        const projected = (angle: number, z: number) => {
            const p = ringPoint(angle, z, t, 'circular')
            return [p[2], p[0], p[1]] as const
        }
        view.add(line3d([-5.3, 0, 0], [5.3, 0, 0], { color: 'dim', width: 1.5 }))
        view.add(vector3d([4.9, 0, 0], [5.8, 0, 0], { color: 'yellow', width: 4, tip: 16, halo: false }))
        for (let index = 0; index < 9; index++) {
            const z = -4.8 + index * 1.2, color = index === 4 ? 'yellow' : 'teal'
            view.add(curve3d((angle) => [z, Math.cos(angle), Math.sin(angle)], 0, 2 * Math.PI,
                { color: 'dim', width: 1, opacity: 0.3, samples: 64 }))
            view.add(curve3d((angle) => projected(angle, z), 0, 2 * Math.PI,
                { color, width: index === 4 ? 3.7 : 2.5, opacity: index === 4 ? 1 : 0.72, samples: 80 }))
            for (let i = 0; i < 16; i++) view.add(point3d(projected(i * Math.PI / 8, z),
                { color, radius: index === 4 ? 4.5 : 3, halo: 0 }))
        }
        return view
    })
    s.add(wave)
    const propagationLabel = place(text('Propagation +z at c', { size: 30, color: 'yellow' }),
        new Box(510, 112, 875, 157), 'right')
    const [equations, explanation] = propagationMath.columns([1.3, 1], 60)
    const travelingEquations = place(column([
        tex('h_+=A\\cos(kz-\\omega t)', { size: 36, color: 'teal' }),
        tex('h_\\times=A\\sin(kz-\\omega t),\\quad\\omega=ck', { size: 36, color: 'orange' }),
    ], { gap: 18 }), equations)
    const travelingExplanation = place(column([
        text('Each ring stays at its own z.', { size: 30 }),
        text('The strain pattern travels onward.', { size: 30, color: 'dim' }),
    ], { gap: 20 }), explanation)
    s.at(29.1, () => s.play(fadeIn([propagationLabel, ...travelingEquations.nodes, ...travelingExplanation.nodes]), { duration: 0.3 }))

    const chapters = [
        { start: 0, end: 10, title: '01  /  Plus: stretch one way, squeeze the other',
            footer: ['A ring of freely falling test particles.', 'Dots show local separations; the dashed circle is the unperturbed reference.'],
            captions: ['A gravitational wave changes the separation between freely falling particles.', 'Plus polarization alternates stretching along x and squeezing along y. The displacement is magnified 600 times.'] },
        { start: 10, end: 20, title: '02  /  Cross: the same pattern, turned 45°',
            footer: ['A second independent polarization.', 'Its stretch and squeeze axes lie along the diagonals.'],
            captions: ['Now compare a pure cross-polarized wave.', 'The pattern is rotated forty-five degrees. Both polarizations are transverse and traceless.'] },
        { start: 20, end: 29, title: '03  /  Combine the two polarizations',
            footer: ['Equal amplitudes, with a 90° phase offset.', 'The ellipse’s axes turn; each particle follows a small local orbit.'],
            captions: ['Combine plus and cross with equal amplitudes and a quarter-cycle phase difference.', 'The principal axes rotate. The small plot tracks the two strain components.'] },
        { start: 29, end: 42, title: '04  /  The pattern travels; the motion is transverse',
            footer: ['Local x–y separations respond as the wave passes.', 'These are measuring rings, not a material sheet. Strain stays first order.'],
            captions: ['Now see the same circularly polarized wave at several positions along z.', 'Its phase travels at the speed of light, perpendicular to every ring.', 'The rings represent local separations of test particles, not space as a material.'] },
    ]
    for (const chapter of chapters) {
        const title = place(text(chapter.title, { size: 38, weight: 600 }), chapterBox, 'left')
        const footer = place(column(chapter.footer.map((words, i) => text(words, { size: i ? 28 : 34, color: i ? 'dim' : 'ink' })), { gap: 13 }), footerBox)
        const nodes = [title, ...footer.nodes]
        s.at(chapter.start, () => { s.chapter(chapter.title.slice(6).trim()); s.play(fadeIn(nodes), { duration: 0.28 }) })
        chapter.captions.forEach((caption, i) => {
            const length = (chapter.end - chapter.start) / chapter.captions.length
            s.at(chapter.start + i * length, () => s.caption(caption, length))
        })
        if (chapter.end < DURATION) s.at(chapter.end - 0.3, () => s.play(fadeOut(nodes), { duration: 0.22 }))
    }
    s.wait(Math.max(0, DURATION - s.time))
})
