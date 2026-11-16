import {
    Box, axes, column, dot, dynamic, fadeIn, fadeOut, film, line, linear, morphMatching,
    place, rect, row, scalarField, sceneKit, tex, text,
} from 'vizmatic/stage'
import { ENERGY, norm2, scattering, verifyScattering, WIDTHS } from './_quantum-tunneling/model'

export default film({
    title: 'A barrier is not a wall',
    description: 'Exact stationary scattering below a rectangular barrier: complex phase rotates, probability density holds still, and thicker barriers transmit less current.',
    look: 'midnight', font: 'text-serif', fps: 60, poster: 23, bloom: 0,
}, (s) => {
    verifyScattering()
    const models = WIDTHS.map((width) => scattering(width))
    const experiment = s.value(0), phaseTime = s.value(0)
    const model = () => models[experiment.value]!
    const kit = sceneKit({ size: 40, area: { left: -860, right: 860, top: -320, bottom: 380 }, heading: { size: 68, y: -466 }, source: { size: 27, y: -401 } })
    s.add(kit.heading('A barrier is not a wall.'))
    s.add(kit.source(`Exact stationary scattering · D. Tong, Quantum Mechanics §2.4.2 · E / V₀ = ${ENERGY}`))
    const [left, right] = kit.area.columns([2.1, 1], 80)
    const waveRegion = new Box(left.left + 30, -240, left.right - 10, -10)
    const densityRegion = new Box(left.left + 30, 164, left.right - 10, 344)
    const x: readonly [number, number] = [-9, 9]
    const waves = axes({ x, y: [-2.1, 2.1], width: waveRegion.width, height: waveRegion.height, xTicks: [], yTicks: [], labelSize: 27, tips: false })
    const density = axes({ x, y: [0, 4.2], width: densityRegion.width, height: densityRegion.height, xTicks: [-8, -4, 0, 4, 8], yTicks: [], labelSize: 27, tips: false })
    // Center the plotting rectangles, rather than the tick labels that extend outside them.
    waves.at(waveRegion.cx, waveRegion.cy)
    density.at(densityRegion.cx, densityRegion.cy)
    // Put scale labels outside the plotted waves, where no phase can cross them.
    for (const [plot, values] of [[waves, [-1, 1]], [density, [2, 4]]] as const) for (const value of values) {
        const [px, py] = plot.world(x[0], value)
        s.add(text(String(value), { size: 27, color: 'dim' }).moveTo([px - 32, py]))
    }
    const shade = (plot: typeof waves) => dynamic(() => {
        const a = plot.p(0, 0), b = plot.p(model().width, 0)
        return rect(b[0] - a[0], plot.plotHeight, { fill: 'yellow', opacity: 0.12 }).at((a[0] + b[0]) / 2, 0)
    })
    waves.add(shade(waves))
    density.add(shade(density))
    waves.plot((x) => model().psi(x, phaseTime.value)[0], { from: () => x[0], to: () => x[1], stroke: 'blue', width: 3.5, samples: 400 })
    waves.plot((x) => model().psi(x, phaseTime.value)[1], { from: () => x[0], to: () => x[1], stroke: 'pink', width: 3.5, samples: 400 })
    density.plot((x) => norm2(model().stationary(x)), { from: () => x[0], to: () => x[1], stroke: 'teal', width: 4, samples: 400 })
    s.add(waves, density)
    const waveLegend = row([
        text('Complex amplitude', { size: 32 }), text('real', { size: 30, color: 'blue' }), text('imaginary', { size: 30, color: 'pink' }),
    ], { gap: 28 })
    s.add(place(waveLegend, new Box(left.left, -320, left.right, -274), 'left'))
    const phaseRegion = new Box(waveRegion.left, 56, waveRegion.right, 86)
    const phaseColors = ['teal', 'blue', 'purple', 'pink', 'orange', 'yellow', 'teal'] as const
    const phaseField = scalarField((x) => {
        const z = model().psi(x, phaseTime.value)
        return Math.atan2(z[1], z[0])
    }, { x, y: [0, 1], domain: [-Math.PI, Math.PI], colors: phaseColors, width: phaseRegion.width, height: phaseRegion.height, resolution: [400, 2] })
    s.add(place(text('Phase angle (hue)', { size: 27, color: 'dim' }), new Box(left.left, 12, left.right, 48), 'left'))
    s.add(place(phaseField, phaseRegion))
    s.add(place(row([tex('|\\Psi|^2', { size: 32, color: 'teal' }), text('relative probability density', { size: 30, color: 'teal' })], { gap: 16 }), new Box(left.left, 106, left.right, 150), 'left'))
    s.add(place(text('position x', { size: 27, color: 'dim' }), new Box(left.left, 394, left.right, 432)))

    const [chapterRegion, equationRegion, bodyRegion, currentRegion, chartRegion] = right.rows([0.6, 1, 1.9, 1.1, 2], 20)
    const words = [
        ['Below the barrier', 'The wave and its slope join at both edges. An oscillating transmitted wave survives where a classical particle cannot pass.'],
        ['Phase moves. Density holds.', 'A common phase rotates the complex wave. Its squared magnitude stays fixed. This is a stationary state, with no launched wave packet.'],
        ['Twice the width', 'A second stationary experiment, at the same energy. More barrier means less transmitted probability current.'],
        ['Three times the width', 'The transmitted current falls again. Reflection and transmission still sum to one. The particle does not lose energy crossing the barrier.'],
    ]
    const headings = words.map(([heading]) => place(text(heading, { size: 33, color: 'yellow', maxWidth: right.width }), chapterRegion, 'left'))
    const bodies = words.map(([, body]) => place(text(body, { size: 31, color: 'dim', maxWidth: right.width, leading: 1.24 }), bodyRegion, 'left'))
    const equations = [
        tex('-\\psi^{\\prime\\prime}+V\\psi=E\\psi', { size: 34 }),
        tex('\\Psi=\\psi(x)e^{-iEt}', { size: 36 }),
        tex('R+T=1', { size: 44 }),
    ].map((eq) => place(eq, equationRegion, 'left'))
    s.add(headings[0], bodies[0], equations[0])
    s.add(dynamic(() => place(column([
        text(`L = ${model().width.toFixed(1)}     T = ${(100 * model().T).toFixed(1)}%`, { size: 34, font: 'mono', color: 'teal' }),
        text(`Reflected: ${(100 * model().R).toFixed(1)}%`, { size: 29, color: 'dim' }),
    ], { gap: 12, align: 'left' }), currentRegion, 'left').nodes))
    const curve = axes({ x: [0, 4], y: [0, 1], width: right.width - 72, height: chartRegion.height - 91, xTicks: [0, 2, 4], yTicks: [0, 1], labelSize: 27, tips: false })
    curve.at(chartRegion.cx + 16, chartRegion.cy + 2)
    curve.plot((width) => scattering(width).T, { stroke: 'teal', width: 3 })
    curve.add(dynamic(() => [
        line(curve.p(model().width, 0), curve.p(model().width, model().T), { stroke: 'yellow', width: 2, dash: [5, 5] }),
        dot(7, 'yellow').at(curve.p(model().width, model().T)),
    ]))
    s.add(curve)
    s.add(place(text('Transmission T vs width L', { size: 27, color: 'dim' }), new Box(right.left, chartRegion.top - 12, right.right, chartRegion.top + 24), 'left'))
    const phaseKey = scalarField((angle) => angle, { x: [-Math.PI, Math.PI], y: [0, 1], domain: [-Math.PI, Math.PI], colors: phaseColors, width: right.width, height: 12, resolution: [160, 2] })
    s.add(place(phaseKey, new Box(right.left, 395, right.right, 407)))
    for (const [px, label] of [[right.left + 14, '-\\pi'], [right.cx, '0'], [right.right - 14, '\\pi']] as const) {
        s.add(tex(label, { size: 27, color: 'dim' }).moveTo([px, 429]))
    }
    const footer = new Box(-860, 454, 860, 500)
    s.add(place(text('Yellow band: V₀ = 1.  Outside: V = 0.  Units: ℏ = 2m = V₀ = 1.  Incident amplitude = 1.', { size: 27, color: 'dim' }), footer, 'left'))

    const change = (index: number, equationFrom?: number, equationTo?: number, nextExperiment?: number) => {
        s.play(fadeOut([headings[index - 1]!, bodies[index - 1]!]), { duration: 0.25 })
        if (nextExperiment !== undefined) experiment.set(nextExperiment)
        if (equationFrom !== undefined && equationTo !== undefined) {
            s.play(morphMatching(equations[equationFrom]!, equations[equationTo]!), fadeIn([headings[index]!, bodies[index]!]), { duration: 0.75 })
        } else s.play(fadeIn([headings[index]!, bodies[index]!]), { duration: 0.75 })
    }
    s.at(0, () => s.play(phaseTime.to(120, { ease: linear }), { duration: 40 }))
    s.chapter('Below the barrier')
    s.caption('Energy is below the barrier. The wave and its slope match at both boundaries, leaving nonzero transmission.', 9)
    s.wait(9)
    s.chapter('Phase and probability')
    change(1, 0, 1)
    s.caption('The phase rotates, but probability density stays still. This is stationary scattering, not a traveling wave packet.', 8)
    s.wait(8)
    s.chapter('Double the width')
    change(2, 1, 2, 1)
    s.caption('Compare a separate stationary solution at twice the barrier width. The energy stays fixed; transmission falls.', 10)
    s.wait(9)
    s.chapter('Triple the width')
    change(3, undefined, undefined, 2)
    s.caption('At triple width, transmission is smaller still. The transmitted and reflected probability currents sum to the incoming current.', 11)
    s.wait(11)
})
