import { axes, colorAlong, dot, draw, dynamic, fadeIn, film, line, tex, text, to, write } from 'vizmatic/stage'

// One idea, shown as it changes: a secant line becomes a tangent.
export default film({ title: 'A limit you can see' }, (s) => {
    s.chapter('The curve')
    const title = s.add(text('A limit you can see', { font: 'serif', size: 72 }).at(0, -440))
    s.play(write(title))

    const plot = s.add(axes({ x: [-1, 4], y: [-1, 9], width: 1080, height: 660, grid: true, xLabel: 'x' }).at(-340, 60))
    s.play(draw(plot.grid, { lag: 0.02 }), draw(plot.lines), fadeIn(plot.numbers), { duration: 1.4 })
    const parabola = plot.plot((x) => x * x, { stroke: colorAlong('blue', 'teal', 'yellow'), width: 5, glow: 6 })
    s.play(draw(parabola))

    s.chapter('The secant')
    const h = s.value(2)
    const secant = s.add(dynamic(() => {
        const x = 1 + h.value
        const slope = 2 + h.value
        const y = (at: number) => 1 + slope * (at - 1)
        return [
            line(plot.world(0.2, y(0.2)), plot.world(3.2, y(3.2)), { stroke: 'yellow', width: 3.5 }),
            dot(9, 'teal').at(plot.world(1, 1)),
            dot(9, 'yellow').at(plot.world(x, x * x)),
        ]
    }))
    s.play(fadeIn(secant))

    const equation = s.add(tex('m = 2 + h', { size: 64 }).at(600, -120))
    s.play(write(equation))

    s.chapter('The limit')
    s.play(h.to(0.02, { duration: 4 }))
    s.play(to(equation, (e) => e.color('yellow').scale(1.15)))
    s.wait(1.5)
})
