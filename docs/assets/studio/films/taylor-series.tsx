/**
 * Polynomials that know only the derivatives of sine at zero. Each new term bends
 * the curve to agree further out. The trust interval is measured numerically: the
 * widest |x| where the partial sum stays within 0.01 of sin x.
 */
import {
    Node, axes, curveThrough, draw, dynamic, fadeIn, film, line, morphMatching, parametricPath, rect, smoother, text, tex, write,
    type Vec,
} from 'vizmatic/stage'

const LIMIT = 15
const WIDTH = 1880, HEIGHT = 1080
const X_RANGE: Vec = [-12, 12]
const Y_RANGE: Vec = [-HEIGHT / 2 / 150, HEIGHT / 2 / 150]

function partial(x: number, order: number): number {
    let term = x, sum = x
    for (let n = 3; n <= order; n += 2) {
        term *= -(x * x) / (n * (n - 1))
        sum += term
    }
    return sum
}

/** Widest |x| where the order-n partial sum stays within 0.01 of sin x. */
function trustRadius(order: number): number {
    let x = 0
    while (x < 12 && Math.abs(partial(x, order) - Math.sin(x)) < 0.01) x += 0.002
    return x
}

export default film({
    title: 'Taylor series of sine',
    description: 'Partial sums hug the sine curve further and further out as each term morphs into the formula.',
    fps: 60,
    bleed: true,
}, (s) => {
    const plot = axes({ x: X_RANGE, y: Y_RANGE, width: WIDTH, height: HEIGHT, xStep: 2, yStep: 1, labels: false, tips: false, color: 'faint' }).at(0, 96)
    const view = plot.world.bind(plot)

    const sine = new Node(parametricPath((t) => plot.p(t, Math.sin(t)), X_RANGE[0], X_RANGE[1], 500)).stroke('blue', 5).glow(9, 'blue')
    // Terms grow in smoothly, so every in-between curve is itself a polynomial.
    const orders = [1, 3, 5, 7, 9, 11, 13, LIMIT]
    const level = s.value(0)
    const evaluate = (x: number): number => {
        const k = level.value
        let term = x, sum = x
        for (let i = 1; i < orders.length; i++) {
            const n = orders[i]!
            term *= -(x * x) / (n * (n - 1))
            const weight = Math.max(0, Math.min(1, k - i + 1))
            if (weight <= 0) break
            sum += weight * term
        }
        return sum
    }
    const approx = dynamic(() => {
        const points: Vec[] = []
        for (let i = 0; i <= 720; i++) {
            const x = X_RANGE[0] + ((X_RANGE[1] - X_RANGE[0]) * i) / 720
            const y = evaluate(x)
            points.push(Math.abs(y) < 5.5 ? plot.p(x, y) : [NaN, NaN])
        }
        return new Node(curveThrough(points)).stroke('yellow', 4).glow(7, 'yellow')
    })

    const xTicks = new Node(), yTicks = new Node()
    // Curves sweep across the whole plot, so each number sits on its own opaque chip above them.
    const tick = (value: number, at: Vec): Node => {
        const label = tex(String(value), { size: 21, color: 'dim', display: false }).moveTo(at)
        const b = label.bounds()
        const back = rect(b.width + 10, b.height + 8, { fill: 'bg', stroke: null, radius: 3 }).at(b.x + b.width / 2, b.y + b.height / 2)
        return new Node().add(back, label)
    }
    for (const x of [-10, -8, -6, -4, -2, 2, 4, 6, 8, 10]) xTicks.add(tick(x, [view(x, 0)[0], view(x, 0)[1] + 26]))
    for (const y of [-2, 2]) yTicks.add(tick(y, [view(0, y)[0] - 24, view(0, y)[1]]))
    xTicks.zIndex(3)
    yTicks.zIndex(3)

    // The range where the sum can be trusted, marked on the x axis.
    const trust = s.value(trustRadius(1))
    const band = dynamic(() => {
        const r = trust.value
        const [x0, y0] = view(-r, 0), [x1] = view(r, 0)
        return [
            line([x0, y0], [x1, y0], { stroke: 'yellow', width: 7 }),
            line([x0, y0 - 11], [x0, y0 + 11], { stroke: 'yellow', width: 3 }),
            line([x1, y0 - 11], [x1, y0 + 11], { stroke: 'yellow', width: 3 }),
        ]
    })

    const source = (order: number): string => {
        const parts = ['x']
        for (let n = 3; n <= order; n += 2) parts.push(`${(n - 1) % 4 === 2 ? '-' : '+'} \\frac{x^{${n}}}{${n}!}`)
        return parts.join(' ')
    }
    const BAND_Y = -402
    const plate = rect(1920, 208, { fill: 'bg', stroke: null }).at(0, -436).zIndex(4)
    const plateEdge = line([-960, -332], [960, -332], { stroke: 'grid', width: 1.2 }).zIndex(4)
    const title = text('Sine, from what it does at zero.', { font: 'text-serif', size: 60 }).zIndex(5)
    title.alignTo([-888, 0], 'left').alignTo([0, -522], 'top')
    const eqAt = (order: number) => {
        const eq = tex(source(order), { size: 42 })
        eq.alignTo([-888, 0], 'left')
        const b = eq.bounds()
        eq.shift(0, BAND_Y - (b.y + b.height / 2))
        eq.zIndex(5)
        return eq
    }
    const lhs = new Map(orders.map((order) => [order, eqAt(order)]))

    const readLabel = text('Within 0.01 of sine for', { size: 19, color: 'dim', uppercase: true, tracking: 0.08, weight: 600 }).zIndex(5)
    readLabel.alignTo([880, 0], 'right').alignTo([0, -504], 'top')
    const readValue = dynamic(() => {
        const node = text(`|x| < ${trust.value.toFixed(2)}`, { font: 'mono', size: 46, color: 'yellow' })
        node.alignTo([880, 0], 'right').alignTo([0, -474], 'top')
        return node
    }).zIndex(5)
    const orderValue = dynamic(() => {
        const node = text(`degree ${orders[Math.round(level.value)]}`, { font: 'mono', size: 26, color: 'dim' })
        node.alignTo([880, 0], 'right').alignTo([0, -416], 'top')
        return node
    }).zIndex(5)

    const closing = text('The polynomial only ever looked at one point. It learned the whole wave.', { font: 'text-serif', italic: true, size: 44, color: 'ink' }).zIndex(5)
    closing.moveTo([0, 470])
    const closingPlate = rect(1340, 84, { fill: 'bg', stroke: null, radius: 6 }).at(0, 470).zIndex(4)

    s.add(plot)
    plot.grid.hide()
    s.add(plate, plateEdge)
    s.chapter('The target')
    s.play(write(title), draw(plot.lines), fadeIn(xTicks), fadeIn(yTicks), { duration: 1.6 })
    plot.add(sine)
    s.play(draw(sine), { duration: 1.8 })
    s.wait(0.4)

    s.chapter('Degree one')
    plot.add(approx)
    s.play(fadeIn(approx), write(lhs.get(1)!), fadeIn(band), fadeIn([readLabel, readValue, orderValue]), { duration: 1.5 })
    s.wait(0.9)

    s.chapter('Add terms')
    for (let i = 1; i < orders.length; i++) {
        const order = orders[i]!
        const seconds = i < 4 ? 1.7 : 1.3
        s.play(
            morphMatching(lhs.get(orders[i - 1]!)!, lhs.get(order)!),
            level.to(i, { ease: smoother }),
            trust.to(trustRadius(order), { ease: smoother }),
            { duration: seconds },
        )
        s.wait(i < 4 ? 0.7 : 0.35)
    }

    s.chapter('The whole wave')
    s.play(fadeIn(closingPlate), fadeIn(closing, { shift: [0, 12] }), { duration: 1.2 })
    s.wait(3.2)
})
