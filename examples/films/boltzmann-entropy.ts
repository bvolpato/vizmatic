/**
 * Exact two-compartment multiplicity for 20 labeled particles.
 * Primary teaching sources:
 * David Tong, Statistical Physics, sections 1.2.1 and 1.2.3:
 * https://www.damtp.cam.ac.uk/user/tong/statphys/statmechhtml/S1.html
 * Feynman Lectures I.6, binomial probabilities:
 * https://www.feynmanlectures.caltech.edu/I_06.html
 *
 * Ω counts only labeled left/right assignments, with equal weights. This is a
 * finite coarse-grained state count, not the full phase-space entropy of a gas.
 * Seeded urn flips and interpolated motion illustrate a realization, not a
 * microscopic trajectory, H-theorem, or monotonically increasing entropy.
 */
import {
    assertEqual, axes, Box, delay, dot, dynamic, fadeIn, fadeOut,
    film, line, linear, place, rect, sceneKit, tex, text,
} from 'vizmatic/stage'
import { LOG_MULTIPLICITIES, MULTIPLICITIES, PARTICLES, STEPS, stateAt } from './_boltzmann-entropy/model'

assertEqual(MULTIPLICITIES.reduce((a, b) => a + b), 2 ** PARTICLES, 'every binary assignment counted once')
assertEqual(MULTIPLICITIES[10], 184756, 'exact balanced multiplicity')
assertEqual(MULTIPLICITIES[20], 1, 'one all-left assignment')

export default film({
    title: 'Entropy counts hidden arrangements',
    description: 'Twenty labeled particles change compartments. Exact binomial counts drive a logarithmic entropy plot, including finite fluctuations. A coarse-grained urn model, with deterministic illustrative motion.',
    look: 'midnight', font: 'text-serif', fps: 60, poster: 18.5, bloom: 0.1,
}, (s) => {
    const kit = sceneKit({ size: 38, area: { left: -850, right: 850, top: -250, bottom: 320 }, heading: { size: 66, y: -466 }, source: { size: 26, y: -401 } })
    const title = kit.heading('Entropy counts hidden arrangements')
    const source = kit.source('Tong, Statistical Physics §1.2 · Feynman Lectures I.6 · exact two-compartment model')
    const [words, main, metrics] = kit.area.rows([1, 7, 2], 34)
    const [tankArea, plotArea] = main.columns([1.3, 1], 95)
    const [tankHead, tankBody, tankFoot] = tankArea.rows([1.3, 7.4, 1.3], 18)
    const [plotHead, plotBody, plotFoot] = plotArea.rows([1.3, 7.4, 1.3], 18)
    const caption = (content: string) => place(kit.label(content), words, 'left')
    const first = caption('Record only which half each labeled particle occupies.')
    const many = caption('The left count hides many different assignments.')
    const balanced = caption('Ten on each side: 184,756 left/right assignments.')
    const fluctuations = caption('Small systems fluctuate. This entropy can decrease.')
    const conclusion = caption('Balanced counts collect far more assignments than all left.')
    const progress = s.value(0), distributionVisible = s.value(0)
    const tankTitle = place(text('20 labeled particles · illustrative urn motion', { size: 28, color: 'dim' }), tankHead, 'left')
    const tank = place(rect(tankBody.width - 8, tankBody.height - 8, { stroke: 'dim', width: 2, radius: 14 }), tankBody)
    const halfWidth = (tankBody.width - 8) / 2, halfHeight = (tankBody.height - 8) / 2
    const divider = line([tankBody.cx, tankBody.cy - halfHeight], [tankBody.cx, tankBody.cy + halfHeight], { stroke: 'dim', width: 2, dash: [7, 10] }).opacity(0.5)
    const particles = dynamic(() => stateAt(progress.value).particles.map((p) =>
        dot(p.moving ? 13 : 10, p.left ? 'blue' : 'teal')
            .at(tankBody.cx + p.x * halfWidth, tankBody.cy + p.y * halfHeight)
            .glow(p.moving ? 18 : 2),
    ))
    const [leftFoot, rightFoot] = tankFoot.columns(2)
    const leftName = place(text('LEFT', { size: 26, color: 'blue', font: 'mono' }), leftFoot)
    const rightName = place(text('RIGHT', { size: 26, color: 'teal', font: 'mono' }), rightFoot)
    const axisName = place(tex('S_{\\rm coarse}/k_B = \\ln\\Omega', { size: 32 }), plotHead, 'left')
    const plot = place(axes({ x: [-0.8, 20.8], y: [-0.7, 14], width: plotBody.width - 40, height: plotBody.height - 40, xTicks: [0, 5, 10, 15, 20], yTicks: [0, 4, 8, 12], labelSize: 26, tips: false, color: 'dim' }), plotBody)
    plot.add(dynamic(() => distributionVisible.value < 0.01 ? [] : LOG_MULTIPLICITIES.map((logOmega, left) =>
        dot(5, 'dim').opacity(distributionVisible.value * 0.65).at(plot.p(left, logOmega)),
    )))
    plot.add(dynamic(() => {
        const state = stateAt(progress.value)
        return [line(plot.p(state.left, 0), plot.p(state.left, state.logOmega), { stroke: 'teal', width: 2, dash: [5, 7] }).opacity(0.6), dot(9, 'teal').glow(12).at(plot.p(state.left, state.logOmega))]
    }))
    const xName = place(text('Particles in the left half', { size: 28, color: 'dim' }), plotFoot)

    const [countsRoom, omegaRoom, logRoom] = metrics.columns([1, 1, 1], 48)
    const countLabel = place(text('LEFT : RIGHT', { size: 26, font: 'mono', color: 'dim' }), countsRoom, 'top')
    const omegaLabel = place(text('Ω: assignments', { size: 28, color: 'dim' }), omegaRoom, 'top')
    const logLabel = place(tex('S_{\\rm coarse}/k_B = \\ln\\Omega', { size: 32 }), logRoom, 'top')
    const countValue = dynamic(() => {
        const st = stateAt(progress.value)
        return place(text(`${String(st.left).padStart(2, ' ')} : ${String(st.right).padStart(2, ' ')}`, { size: 52, font: 'mono', color: 'blue' }), countsRoom, 'bottom')
    })
    const omegaValue = dynamic(() => place(text(stateAt(progress.value).omega.toLocaleString('en-US'), { size: 52, font: 'mono', color: 'teal' }), omegaRoom, 'bottom'))
    const logValue = dynamic(() => place(text(stateAt(progress.value).logOmega.toFixed(3), { size: 52, font: 'mono' }), logRoom, 'bottom'))
    const assumptions = place(text('Equal-weight side assignments only; positions within halves and momenta omitted.', { size: 26, color: 'dim' }), new Box(-850, -377, 850, -337))
    const equation = place(tex('\\Omega(n_L) = \\tbinom{20}{n_L},\\qquad S_{\\rm coarse} = k_B \\ln\\Omega', { size: 32 }), new Box(-850, -326, 850, -270), 'right')

    s.chapter('One left/right assignment')
    s.add(title, source, first, tankTitle, tank, divider, particles, leftName, rightName, axisName, plot, xName, countLabel, omegaLabel, logLabel, countValue, omegaValue, logValue, assumptions, equation)
    s.caption('Twenty labeled particles start on the left. Only their left/right assignments are counted.', 5)
    s.wait(4)

    s.chapter('Count the hidden assignments')
    s.play(fadeOut(first, { duration: 0.2 }), delay(fadeIn(many, { duration: 0.4 }), 0.2))
    s.play(distributionVisible.to(1), { duration: 0.9 })
    s.wait(1)
    s.caption('The multiplicity is twenty choose the number on the left. Its natural logarithm gives the entropy of this coarse description in units of Boltzmann’s constant.', 12)
    s.play(progress.to(18, { ease: linear }), { duration: 9 })
    s.wait(1.5)

    s.chapter('Many ways to balance')
    s.play(fadeOut(many, { duration: 0.2 }), delay(fadeIn(balanced, { duration: 0.4 }), 0.2))
    s.caption('Ten per side: 184,756 assignments, each with equal weight.', 6)
    s.wait(3.5)

    s.chapter('Finite fluctuations')
    s.play(fadeOut(balanced, { duration: 0.2 }), delay(fadeIn(fluctuations, { duration: 0.4 }), 0.2))
    s.caption('This finite urn realization fluctuates. Its coarse-grained entropy can decrease. The illustrated motion is not a microscopic gas trajectory.', 13)
    s.play(progress.to(STEPS, { ease: linear }), { duration: 12 })
    s.play(fadeOut(fluctuations, { duration: 0.2 }), delay(fadeIn(conclusion, { duration: 0.4 }), 0.2))
    s.caption('This model counts left/right assignments only, not the full phase space of a gas.', 40 - s.time)
    s.wait(Math.max(0, 40 - s.time))
})
