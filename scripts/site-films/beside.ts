import { axes, dot, draw, dynamic, fadeIn, film, line, morphMatching, tex, write } from 'vizmatic/stage'

export default film({ title: 'The derivative, in a page of code' }, (s) => {
    const graph = s.add(axes({ x: [-1, 3.5], y: [-1, 9], width: 1120, height: 780, grid: true }))
    graph.at(-300, 20)
    s.play(draw(graph.grid), draw(graph.lines), fadeIn(graph.numbers))

    const parabola = graph.plot((x) => x * x, { stroke: 'blue', width: 5 })
    s.play(draw(parabola))

    const h = s.value(1.8)
    const secant = dynamic(() => {
        const y = (x: number) => 1 + (2 + h.value) * (x - 1)
        const moving = 1 + h.value
        return [
            line(graph.world(0, y(0)), graph.world(3, y(3)), { stroke: 'yellow', width: 4 }),
            dot(9, 'teal').at(graph.world(1, 1)),
            dot(9, 'yellow').at(graph.world(moving, moving ** 2)),
        ]
    })
    s.play(fadeIn(secant))

    const ratio = s.add(tex('\\frac{(1+h)^2 - 1}{h}', { size: 72 }).at(590, -160))
    s.play(write(ratio))

    const result = tex('2 + h', { size: 88, color: 'yellow' }).at(590, -160)
    s.play(morphMatching(ratio, result))

    s.play(h.to(0.02, { duration: 3.5 }))
    s.wait(1.5)
})
