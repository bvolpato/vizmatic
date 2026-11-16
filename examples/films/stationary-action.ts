import {
    Box, axes, circle, column, curve, dot, draw, dynamic, fadeIn, fadeOut,
    film, line, place, rect, row, sceneKit, smoother, text, tex,
} from 'vizmatic/stage'
import { action, actionIntegral, flightTime, lagrangian, path } from './_stationary-action/model'

const DURATION = 42

export default film({
    title: 'Stationary action: a path among neighbors',
    description: 'A ballistic path in uniform gravity, compared with fixed-endpoint sine variations. Actual integrals converge quadratically to stationary action. This example is a minimum; the general principle is stationarity.',
    look: 'midnight', font: 'text-serif', fps: 60, poster: 30,
}, (s) => {
    const kit = sceneKit({ heading: { size: 64, y: -466 }, area: { left: -875, right: 875, top: -290, bottom: 200 } })
    s.add(kit.heading('Stationary action'))
    s.add(place(column([
        text('Tong · Cambridge', { size: 26, color: 'dim' }),
        text('Classical Dynamics §2.1', { size: 26, color: 'dim' }),
    ], { gap: 4 }), new Box(390, -507, 875, -432), 'right'))
    s.add(place(text('Uniform gravity · no drag · 1 kg · 12 m in 2 s · g = 9.81 m/s²', { size: 30, color: 'dim' }),
        new Box(-875, -416, 875, -370), 'left'))

    const chapterBox = new Box(-875, -357, 875, -310)
    const footerBox = new Box(-875, 252, 875, 344)
    const [geometry, information] = kit.area.columns([1.5, 1], 70)
    const plot = place(axes({
        x: [-0.65, 12.65], y: [-0.55, 7.45], width: 760, height: 760 * 8 / 13.3,
        xTicks: [0, 3, 6, 9, 12], yTicks: [2, 4, 6], labelSize: 28,
        grid: true, tips: false, color: 'dim',
    }), geometry)
    s.add(plot)
    const heightLabel = place(text('height / m', { size: 27, color: 'dim' }), geometry, 'top left')
    const heightBounds = heightLabel.bounds()
    s.add(rect(heightBounds.width + 24, heightBounds.height + 24, { fill: 'bg', stroke: null })
        .at(heightBounds.x + heightBounds.width / 2, heightBounds.y + heightBounds.height / 2).zIndex(8))
    s.add(heightLabel.zIndex(9))
    s.add(place(text('horizontal distance / m', { size: 27, color: 'dim' }), new Box(geometry.left, 208, geometry.right, 244)))
    const elapsed = s.value(0), family = s.value(0), epsilon = s.value(1.6), sweep = s.value(0)
    const physical = plot.plot((x) => path(x / 6)[1], { from: 0, to: () => 6 * elapsed.value, stroke: 'teal', width: 6, glow: 3 })
    plot.add(dynamic(() => {
        if (family.value < 0.001) return []
        return [-1, -0.5, 0.5, 1].map((multiple) => curve(
            Array.from({ length: 121 }, (_, i) => plot.p(...path(i * flightTime / 120, multiple * epsilon.value))),
            { stroke: multiple > 0 ? 'blue' : 'orange', width: Math.abs(multiple) === 1 ? 3.5 : 2,
                opacity: family.value * (Math.abs(multiple) === 1 ? 0.9 : 0.3) },
        ))
    }))
    // The physical curve stays visible above the converging comparison family.
    physical.zIndex(2)
    for (const t of [0, flightTime]) plot.add(circle(11, { fill: 'bg', stroke: 'ink', width: 3 }).at(plot.p(...path(t))).zIndex(4))
    plot.add(dynamic((t) => {
        if (t >= 8) return []
        return dot(10, 'teal').at(plot.p(...path(elapsed.value))).glow(8, 'teal')
    }).zIndex(5))
    plot.add(dynamic((t) => {
        if (t < 16 || t >= 25) return []
        return [-1, 0, 1].map((multiple) => dot(8, multiple === 0 ? 'teal' : multiple > 0 ? 'blue' : 'orange')
            .at(plot.p(...path(sweep.value, multiple * epsilon.value))))
    }).zIndex(5))
    s.at(0.6, () => s.play(elapsed.to(2), { duration: 6.6, ease: smoother }))
    s.at(8, () => s.play(family.to(1), { duration: 1.8, ease: smoother }))
    s.at(16.3, () => s.play(sweep.to(2), { duration: 7.7, ease: (t) => t }))
    s.at(26, () => s.play(epsilon.to(0.08), { duration: 8, ease: smoother }))
    s.at(34, () => s.play(epsilon.to(0), { duration: 3, ease: smoother }))

    const intro = place(column([
        tex('S[\\mathbf r]=\\int_0^T (K-V)\\,dt', { size: 43 }),
        text('One number for an entire path.', { size: 31 }),
        tex('x_*(t)=6t', { size: 42, color: 'teal' }),
        tex('y_*(t)=\\tfrac12 g\\,t(2-t)', { size: 42, color: 'teal' }),
        text('The teal path obeys Newton’s law.', { size: 30, color: 'dim' }),
    ], { gap: 28 }), information)
    const trials = place(column([
        tex('y_\\varepsilon(t)=y_*(t)+\\varepsilon\\sin(\\pi t/T)', { size: 35 }),
        text('Same endpoints. Same travel time.', { size: 30 }),
        row([text('Upper trial', { size: 30, color: 'blue' }), tex('\\varepsilon=+1.6\\,\\mathrm m', { size: 32, color: 'blue' })], { gap: 24 }),
        row([text('Physical', { size: 30, color: 'teal' }), tex('\\varepsilon=0', { size: 32, color: 'teal' })], { gap: 24 }),
        row([text('Lower trial', { size: 30, color: 'orange' }), tex('\\varepsilon=-1.6\\,\\mathrm m', { size: 32, color: 'orange' })], { gap: 24 }),
        text('Only teal solves the force law.', { size: 30, color: 'dim' }),
    ], { gap: 27 }), information)

    const [integrandTitleBox, integrandBox, valuesBox] = information.rows([0.10, 0.44, 0.46], 20)
    const integrandTitle = place(text('Accumulate K − V along each path', { size: 30 }), integrandTitleBox)
    const integrand = place(axes({ x: [0, 2.1], y: [-55, 90], width: 535, height: 156,
        xTicks: [0, 1, 2], yTicks: [-40, 40, 80], labels: false, labelSize: 26, tips: false }), integrandBox)
    // Time labels sit below the negative-L region, so no curve crosses them.
    for (const t of [0, 1, 2]) {
        const p = integrand.p(t, -55)
        integrand.add(tex(String(t), { size: 26, color: 'dim' }).moveTo([p[0], p[1] + 27]))
    }
    for (const energy of [-40, 40, 80]) {
        const p = integrand.p(0, energy)
        const label = tex(String(energy), { size: 26, color: 'dim' })
        integrand.add(label.moveTo([p[0] - label.width / 2 - 22, p[1]]))
    }
    for (const [e, color] of [[1.6, 'blue'], [0, 'teal'], [-1.6, 'orange']] as const) {
        integrand.plot((t) => lagrangian(t, e), { from: 0, to: 2, stroke: color, width: 2, dash: [5, 6] }).opacity(0.35)
        integrand.plot((t) => lagrangian(t, e), { from: 0, to: () => sweep.value, stroke: color, width: 4 })
    }
    const integralValues = dynamic((t) => {
        if (t < 16 || t >= 25) return []
        return place(column([
            text(`Time ${sweep.value.toFixed(2)} s  ·  L in joules`, { size: 28, color: 'dim', font: 'mono' }),
            ...([1.6, 0, -1.6] as const).map((e) => text(
                `${e > 0 ? 'Upper   ' : e < 0 ? 'Lower   ' : 'Physical'} ${actionIntegral(e, sweep.value).toFixed(4)} J·s`,
                { size: 31, font: 'mono', color: e > 0 ? 'blue' : e < 0 ? 'orange' : 'teal' })),
        ], { gap: 16 }), valuesBox).nodes
    })

    const [actionTitleBox, actionPlotBox, actionReadoutBox] = information.rows([0.10, 0.48, 0.42], 22)
    const actionTitle = place(text('Action S / J·s vs variation ε / m', { size: 30 }), actionTitleBox)
    const actionPlot = place(axes({ x: [-1.9, 1.9], y: [3.5, 8.8], width: 530, height: 176,
        xTicks: [-1.6, 0, 1.6], yTicks: [6, 8], labelSize: 26, tips: false }), actionPlotBox)
    actionPlot.plot(action, { from: -1.8, to: 1.8, stroke: 'dim', width: 3 })
    actionPlot.add(line(actionPlot.p(-0.68, action()), actionPlot.p(0.68, action()), { stroke: 'teal', width: 4 }))
    actionPlot.dotAt(0, action(), 'teal', 8)
    actionPlot.add(dynamic((t) => {
        if (t < 25) return []
        return [-1, 1].map((sign) => dot(9, sign > 0 ? 'blue' : 'orange')
            .at(actionPlot.p(sign * epsilon.value, action(epsilon.value))).opacity(Math.min(1, epsilon.value / 0.04)))
    }))
    const convergingValues = dynamic((t) => {
        if (t < 25) return []
        return place(column([
            text(`|ε| = ${epsilon.value.toFixed(3)} m`, { size: 30, color: 'dim', font: 'mono' }),
            text(`Trials   ${action(epsilon.value).toFixed(4)} J·s`, { size: 31, color: 'blue', font: 'mono' }),
            text(`Physical ${action().toFixed(4)} J·s`, { size: 31, color: 'teal', font: 'mono' }),
            text(`ΔS = ${(action(epsilon.value) - action()).toFixed(5)} J·s`, { size: 30, font: 'mono' }),
        ], { gap: 12 }), actionReadoutBox).nodes
    })

    const chapters = [
        { start: 0, end: 8, title: '01  /  A familiar flight', nodes: intro.nodes,
            footer: ['Fix the start, the finish, and the clock.', 'Compare the whole journey.'],
            caption: 'A one-kilogram projectile flies twelve metres in two seconds. Its action is the integral of kinetic minus potential energy.' },
        { start: 8, end: 16, title: '02  /  Vary the path, hold the endpoints', nodes: trials.nodes,
            footer: ['Blue and orange are trial paths.', 'They need not obey the force law.'],
            caption: 'Vary the height with a sine that vanishes at both endpoints. These are comparison paths, not other unforced flights.' },
        { start: 16, end: 25, title: '03  /  Integrate each journey', nodes: [integrandTitle, integrand, integralValues],
            footer: ['Action has units of energy × time.', 'K − V may be negative along part of the flight.'],
            caption: 'Accumulate kinetic minus potential energy. The two trials end at the same action, 7.0796 joule seconds; the physical path gives 3.9213.' },
        { start: 25, end: 34, title: '04  /  Neighbors converge', nodes: [actionTitle, actionPlot, convergingValues],
            footer: ['Halve the variation. The action difference falls by four.', 'The slope at ε = 0 is zero.'],
            caption: 'Bring both neighbors toward the physical path. Their action difference shrinks quadratically, so the first variation vanishes.' },
        { start: 34, end: 42, title: '05  /  Stationary is the principle', nodes: [],
            footer: ['This family has a minimum. The general rule is δS = 0.', 'Stationary action does not promise a global minimum.'],
            caption: 'For this example the action is a minimum. Hamilton’s principle says stationary action; it does not assert a global minimum in every system.' },
    ]
    for (const chapter of chapters) {
        const title = place(text(chapter.title, { size: 38, weight: 600 }), chapterBox, 'left')
        const footer = place(column(chapter.footer.map((words, i) => text(words, { size: i ? 29 : 34, color: i ? 'dim' : 'ink' })), { gap: 12 }), footerBox)
        const nodes = [title, ...footer.nodes, ...chapter.nodes]
        s.at(chapter.start, () => {
            s.chapter(chapter.title.slice(6).trim())
            s.caption(chapter.caption, chapter.end - chapter.start)
            s.play(fadeIn(nodes), { duration: 0.28 })
        })
        // The action graph and readout carry into the last chapter.
        const outgoing = chapter.start === 25 ? [title, ...footer.nodes] : nodes
        if (chapter.end < DURATION) s.at(chapter.end - 0.3, () => s.play(fadeOut(outgoing), { duration: 0.22 }))
    }
    // A measured formula band earns the remaining space in the final scene.
    const finalEquation = place(tex('\\delta S=0\\quad\\Longleftrightarrow\\quad\\ddot y=-g', { size: 40, color: 'teal' }),
        new Box(geometry.left + 130, -231, geometry.right - 30, -165))
    const finalBounds = finalEquation.bounds()
    const equationBacking = rect(finalBounds.width + 32, finalBounds.height + 28, { fill: 'bg', stroke: null, radius: 8 })
        .at(finalBounds.x + finalBounds.width / 2, finalBounds.y + finalBounds.height / 2)
    s.at(35, () => s.play(fadeIn(equationBacking), draw(finalEquation), { duration: 1.2 }))
    s.wait(Math.max(0, DURATION - s.time))
})
