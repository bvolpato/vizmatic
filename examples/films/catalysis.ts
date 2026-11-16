/**
 * A catalyst changes the route. Sources for the scientific claims:
 * IUPAC Gold Book, catalyst: https://doi.org/10.1351/goldbook.C00876
 * IUPAC, Gibbs energy of activation: https://doi.org/10.1351/goldbook.G02631
 * Horiuti & Miyahara, Hydrogenation of ethylene on metallic catalysts (1968):
 * https://doi.org/10.6028/NBS.NSRDS.13
 *
 * The energy profiles are schematic, with a shared scale and fixed endpoints.
 * The atom/bond illustration shows net ethene hydrogenation and a symbolic Ni
 * surface. It does not assign molecular intermediates to the two drawn peaks.
 * All coordinates are author supplied, with illustrative display radii.
 * Neither the geometry nor the energy curves come from a force-field calculation.
 */
import {
    assertEqual, axes, beside, Box, column, delay, dot, draw, dynamic, fade,
    fadeIn, fadeOut, film, line, linear, molecule3d, place, row, sceneKit, tex, text,
} from 'vizmatic/stage'
import { catalyzed, direct, energy, products, reactants } from './_catalysis/model'

assertEqual(energy(direct, 0), energy(catalyzed, 0), 'same reactant energy')
assertEqual(energy(direct, 1), energy(catalyzed, 1), 'same product energy')
assertEqual(Math.max(...catalyzed.map(([, y]) => y)) < Math.max(...direct.map(([, y]) => y)), true, 'lower schematic barriers')
for (const element of ['C', 'H', 'Ni']) {
    assertEqual(reactants.atoms.filter((a) => a.element === element).length, products.atoms.filter((a) => a.element === element).length, `conserve ${element}`)
}

export default film({
    title: 'A catalyst changes the route',
    description: 'Two energy paths share their endpoints. A lower route appears, net hydrogenation changes bonds, and the catalyst remains. Schematic energies and author-supplied geometry.',
    look: 'midnight', font: 'text-serif', fps: 60, poster: 33, bloom: 0.12,
}, (s) => {
    const kit = sceneKit({ size: 40, area: { left: -850, right: 850, top: -300, bottom: 320 }, heading: { size: 68, y: -466 }, source: { size: 26, y: -401 } })
    const title = kit.heading('A catalyst changes the route')
    const source = kit.source('IUPAC Gold Book C00876 / G02631 · Horiuti & Miyahara, NBS 13 (1968)')
    const [words, main, verdict] = kit.area.rows([1, 7, 1.1], 32)
    const [plotArea, atomArea] = main.columns([1.7, 1], 80)
    const [plotTitle, chartArea, plotFoot] = plotArea.rows([1, 8, 1], 18)
    const [atomTitle, atomRoom, atomFoot] = atomArea.rows([1, 7, 2], 18)
    const caption = (content: string) => place(kit.label(content), words, 'left')
    const first = caption('The same reaction can take a different path.')
    const second = caption('A catalyst opens a route with lower barriers.')
    const third = caption('Bonds change. The catalyst is regenerated.')
    const last = caption('The route changes. The overall energy change stays the same.')
    const energyTitle = place(kit.note('Gibbs energy · schematic'), plotTitle, 'left')
    const axisTitle = place(kit.note('Reaction coordinate'), plotFoot, 'center')
    const atomTitleText = place(kit.note('Ethene + hydrogen → ethane'), atomTitle, 'center')

    const chart = place(axes({ x: [-0.06, 1.06], y: [-40, 105], width: chartArea.width - 8, height: chartArea.height - 8, labels: false, xTicks: [], yTicks: [], tips: false, color: 'grid' }), chartArea)
    // Keep the horizontal reference at the bottom of the energy profile.
    chart.lines.hide()
    chart.add(line(chart.p(-0.06, -40), chart.p(1.06, -40), { stroke: 'dim', width: 1.5 }))
    chart.add(line(chart.p(-0.06, -40), chart.p(-0.06, 105), { stroke: 'dim', width: 1.5 }))
    const highProgress = s.value(0), lowProgress = s.value(0), cursorVisible = s.value(0)
    const high = chart.plot((x) => energy(direct, x), { from: 0, to: () => highProgress.value, stroke: 'blue', width: 4.5 })
    chart.plot((x) => energy(catalyzed, x), { from: 0, to: () => lowProgress.value, stroke: 'teal', width: 6, glow: 9 })
    const start = dot(8, 'ink').at(chart.p(0, 0)), end = dot(8, 'ink').at(chart.p(1, -25))
    chart.add(start, end)
    const rLabel = place(text('Reactants', { size: 28 }), plotFoot, 'left')
    const pLabel = place(text('Products', { size: 28 }), plotFoot, 'right')
    const highLabel = beside(text('Without catalyst', { size: 30, color: 'blue' }), chart.world(0.45, 85), 'above', 20)
    const lowLabel = beside(text('With catalyst', { size: 30, color: 'teal' }), chart.world(0.5, -5), 'under', 20)
    chart.add(dynamic(() => cursorVisible.value < 0.01 ? [] : dot(10, 'teal').glow(16).opacity(cursorVisible.value).at(chart.p(lowProgress.value, energy(catalyzed, lowProgress.value)))))

    const moleculeOptions = { unit: 55, theta: -Math.PI / 2 + 0.15, phi: 1.25, perspective: false, atomRadius: 0.28, atomColors: { C: 'blue', H: 'ink', Ni: 'teal' }, bondWidth: 6, bondColor: 'ink', shine: 0.35, brightness: 0.95 } as const
    const before = molecule3d(reactants, moleculeOptions)
    const after = molecule3d(products, moleculeOptions)
    // Align the same authoring origin so that the catalyst patch stays fixed.
    place(before, atomRoom)
    after.at(before.get('x'), before.get('y'))
    const key = place(column([
        row([text('C', { size: 28, color: 'blue' }), text('H', { size: 28 }), text('Ni catalyst', { size: 28, color: 'teal' })], { gap: 30 }),
        text('Author-supplied geometry', { size: 26, color: 'dim' }),
    ], { gap: 12 }), atomFoot)

    const breakBonds = [...before.bond('h5', 'h6'), ...before.bond('c1', 'c2')]
    const formBonds = [...after.bond('c1', 'h5'), ...after.bond('c2', 'h6')]
    formBonds.forEach((bond) => bond.stroke('teal').opacity(0))
    const equation = place(tex('\\ce{C2H4 + H2 ->[Ni] C2H6}', { size: 42 }), verdict)
    const conclusion = place(row([
        text('Lower barriers', { size: 42, color: 'teal' }),
        text('·', { size: 36, color: 'dim' }),
        tex('\\Delta_r G^\\circ \\;\\text{unchanged}', { size: 42 }),
    ], { gap: 30 }), verdict)
    const limits = place(text('Schematic energy profile and net bond changes', { size: 26, color: 'dim' }), new Box(-850, -371, 850, -321))

    const guides = [
        line(chart.world(0, 0), chart.world(1.04, 0), { stroke: 'dim', width: 1.5, dash: [6, 8] }),
        line(chart.world(1, -25), chart.world(1.04, -25), { stroke: 'dim', width: 1.5, dash: [6, 8] }),
    ].map((guide) => guide.opacity(0.65))
    const difference = line(chart.world(1.04, 0), chart.world(1.04, -25), { stroke: 'yellow', width: 5 })

    s.chapter('One reaction')
    s.add(title, source, first, energyTitle, axisTitle, atomTitleText, chart, rLabel, pLabel, before, key, equation, limits)
    s.caption('A catalyst changes the route. The reactants and products keep the same energies.', 7)
    s.wait(1)
    s.play(highProgress.to(1, { ease: linear }), { duration: 4 })
    s.play(fadeIn(highLabel), { duration: 0.6 })
    s.wait(1.4)

    s.chapter('A lower route')
    s.caption('The teal route has lower schematic barriers. The energy scale and endpoints stay fixed.', 11)
    s.play(fadeOut(first, { duration: 0.2 }), delay(fadeIn(second, { duration: 0.4 }), 0.2))
    s.play(fade(high, 0.6), cursorVisible.to(1), { duration: 0.5 })
    s.play(lowProgress.to(0.26, { ease: linear }), { duration: 2.6 })
    s.wait(1.2)
    s.play(lowProgress.to(0.5, { ease: linear }), { duration: 2.4 })
    s.play(fadeIn(lowLabel), { duration: 0.5 })
    s.wait(1.6)

    s.chapter('Bonds change')
    s.caption('This atom illustration tracks net hydrogenation, not molecular intermediates: hydrogen is added across the carbon double bond.', 11)
    s.play(fadeOut(second, { duration: 0.2 }), delay(fadeIn(third, { duration: 0.4 }), 0.2))
    s.play(...breakBonds.map((bond) => fade(bond, 0.2)), { duration: 1.2 })
    s.play(lowProgress.to(0.73, { ease: linear }), { duration: 2.3 })
    s.wait(1)
    s.play(fadeOut(before, { duration: 0.25 }), delay(fadeIn(after, { duration: 0.55 }), 0.25))
    s.play(...formBonds.map((bond) => fade(bond, 1)), lowProgress.to(1, { ease: linear }), { duration: 2.7 })
    s.play(cursorVisible.to(0), { duration: 0.5 })
    s.wait(1.5)

    s.chapter('The endpoints stay')
    s.caption('The catalyst is regenerated. Lower barriers change the rate; the overall standard Gibbs energy change is unchanged.', 10)
    s.play(fadeOut(third, { duration: 0.2 }), delay(fadeIn(last, { duration: 0.4 }), 0.2))
    s.play(...guides.map((guide) => draw(guide)), draw(difference), { duration: 1.1 })
    s.play(fadeOut(equation, { duration: 0.2 }), delay(fadeIn(conclusion, { duration: 0.5 }), 0.2))
    s.play(after.orbit({ theta: -Math.PI / 2 - 0.2 }), { duration: 2.3 })
    s.wait(Math.max(0, 40 - s.time))
})
