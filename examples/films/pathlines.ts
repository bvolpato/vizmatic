/**
 * A time-dependent uniform flow has straight instantaneous streamlines and curved
 * particle histories. Definitions: MIT Unified Engineering, Fluids Lecture 8.
 * https://web.mit.edu/16.unified/www/FALL/fluids/Lectures/f08.pdf
 */
import {
    Node, arrow, assertEqual, axes, beside, column, dot, dynamic, film, integrateTrajectory,
    linear, parametric, place, sceneKit, tex, text,
} from 'vizmatic/stage'

const END = 2 * Math.PI
const STEP = 0.01
const velocity = (time: number, _state: readonly number[]) => [1, Math.sin(time)]
const orbit = integrateTrajectory(velocity, { initial: [-3, 0], to: END, step: STEP })
for (const time of [0, 0.83, Math.PI, END]) {
    const [x, y] = orbit.sample(time)
    assertEqual(Math.hypot(x - (-3 + time), y - (1 - Math.cos(time))) < 1e-8, true, 'the pathline agrees with its exact solution')
}

export default film({
    title: 'A flow changes. A particle remembers.',
    description: 'A particle follows the time-dependent velocity (1, sin t). Its curved pathline differs from a straight instantaneous streamline. The RK4 trajectory is checked against the exact solution.',
    font: 'text-serif', fps: 60, poster: 14, bloom: 0.08,
}, (s) => {
    const kit = sceneKit({ size: 36, heading: { size: 64, y: -465 }, source: { size: 27, y: -405 }, area: { left: -860, right: 860, top: -325, bottom: 350 } })
    s.add(kit.heading('A flow changes. A particle remembers.'))
    s.add(kit.source('Illustrative flow · dimensionless time · MIT Unified Engineering, Fluids Lecture 8'))
    const [picture, side] = kit.area.columns([2.25, 1], 80)
    const [plotBox, legendBox] = picture.rows([0.85, 0.15], 28)
    const [equationBox, definitionBox, readoutBox] = side.rows([0.3, 0.48, 0.22], 30)
    const ax = axes({ x: [-3.5, 3.5], y: [-1, 3], width: plotBox.width - 80, height: plotBox.height - 70, xStep: 1, yStep: 1, grid: true, labels: false, tips: false })
    place(ax, plotBox)
    const now = s.value(0)
    const diagram = new Node().add(ax,
        beside(tex('x', { size: 28, color: 'dim' }), ax.world(3.5, 0), 'right', 16),
        beside(tex('y', { size: 28, color: 'dim' }), ax.world(0, 3), 'above', 16))
    ax.add(dynamic(() => {
        const time = now.value, state = orbit.sample(time)
        const [x, y] = state, slope = velocity(time, state)[1]
        const out: Node[] = []
        // The field arrows show velocity now; they do not slide along frozen streamlines.
        for (let gx = -3; gx <= 3; gx++) for (let gy = -0.5; gy <= 2.5; gy += 0.75) {
            out.push(arrow(ax.p(gx, gy), ax.p(gx + 0.35, gy + slope * 0.35), { stroke: 'dim', width: 1.8, tip: 8 }).opacity(0.38))
        }
        const frozen = ax.plotPath((sx) => y + slope * (sx - x), { adaptive: true, samples: 2 })
        out.push(new Node(frozen).stroke('blue', 3).dash([10, 8]))
        if (time > 0) out.push(parametric((t) => {
            const [px, py] = orbit.sample(t)
            return ax.p(px, py)
        }, 0, time, { adaptive: { tolerance: 0.5, maxSamples: 1024 }, stroke: 'yellow', width: 5 }))
        out.push(dot(9, 'yellow').at(ax.p(x, y)).glow(7))
        return out
    }))
    s.add(diagram)
    s.add(place(column([
        text('Dashed blue: a streamline now', { size: 30, color: 'blue' }),
        text('Solid yellow: the particle’s pathline', { size: 30, color: 'yellow' }),
    ], { gap: 12, align: 'left' }), legendBox, 'left'))
    s.add(place(column([
        tex('\\mathbf u(x,y,t)=(1,\\sin t)', { size: 38 }),
        text('The velocity turns with time.', { size: 30, color: 'dim' }),
    ], { gap: 22, align: 'left' }), equationBox, 'left'))
    s.add(place(column([
        text('One instant', { size: 36, color: 'blue', weight: 600 }),
        text('A streamline is tangent to the velocity field at one fixed time.', { size: 30, maxWidth: side.width, leading: 1.25 }),
        text('One particle', { size: 36, color: 'yellow', weight: 600 }),
        text('A pathline records its motion as the velocity changes.', { size: 30, maxWidth: side.width, leading: 1.25 }),
    ], { gap: 18, align: 'left' }), definitionBox, 'left'))
    s.add(dynamic(() => place(column([
        text(`t = ${now.value.toFixed(2)}`, { size: 36, font: 'mono' }),
        tex('x=-3+t,\\quad y=1-\\cos t', { size: 29, color: 'dim' }),
    ], { gap: 16, align: 'left' }), readoutBox, 'left').nodes))

    s.chapter('One instant')
    s.caption('The dashed line is tangent to the velocity at this instant. The yellow dot is one particle.', 6)
    s.wait(2)
    s.chapter('A changing field')
    s.caption('The velocity changes with time. The particle integrates that changing velocity and leaves a curved path.', 10)
    s.play(now.to(Math.PI, { ease: linear }), { duration: 10 })
    s.wait(1)
    s.chapter('A particle history')
    s.caption('The streamline turns again. The pathline keeps the history of where this particle has been.', 12)
    s.play(now.to(END, { ease: linear }), { duration: 10 })
    s.wait(3)
})
