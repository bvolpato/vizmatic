/** Starter films for `vizmatic new`. Each one renders as written and passes `vizmatic check`. */
export interface FilmTemplate {
    readonly name: string
    readonly description: string
    readonly source: string
}

const explainer = `import { axes, colorAlong, dot, draw, dynamic, fadeIn, film, line, tex, text, to, write } from 'vizmatic/stage'

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
`

const equation = `import { fadeIn, film, indicate, morphMatching, tex, text, write } from 'vizmatic/stage'

// A derivation where each line grows out of the last one.
export default film({ title: 'Completing the square' }, (s) => {
    const label = s.add(text('Completing the square', { font: 'serif', size: 64 }).at(0, -380))
    s.play(fadeIn(label, { shift: [0, 16] }))

    let current = s.add(tex('x^2 + 6x + 5 = 0', { size: 84 }))
    s.play(write(current))
    s.wait(0.6)

    for (const next of [
        'x^2 + 6x = -5',
        'x^2 + 6x + 9 = 4',
        '(x + 3)^2 = 4',
        'x + 3 = \\\\pm 2',
        'x = -3 \\\\pm 2',
    ]) {
        const target = tex(next, { size: 84 })
        s.play(morphMatching(current, target))
        current = target
        s.wait(0.5)
    }

    s.play(indicate(current, { color: 'yellow', scale: 1.08 }))
    s.wait(1.5)
})
`

const architecture = `import { arrow, draw, fadeIn, film, group, lagged, line, pulse, rect, text, write, type Node, type Vec } from 'vizmatic/stage'

// An engineering figure, not a slide: each box carries its role, runtime, and live numbers.
const W = 232, H = 136

function service(name: string, runtime: string, stats: readonly string[], x: number, y: number, color = 'blue'): Node {
    const rows = stats.map((row, i) => text(row, { size: 15, font: 'mono', color: 'dim' }).at(x, y + 6 + i * 20))
    return group(
        rect(W, H, { radius: 6, stroke: color, width: 1.5, fill: 'surface' }).at(x, y),
        text(name, { size: 21, weight: 600 }).at(x, y - 46),
        text(runtime, { size: 15, color }).at(x, y - 21),
        ...rows,
    )
}

function tier(label: string, x: number, width: number): Node {
    const top = -290, bottom = 250
    return group(
        rect(width, bottom - top, { radius: 8, stroke: 'grid', width: 1.25 }).at(x, (top + bottom) / 2),
        text(label, { size: 14, font: 'mono', color: 'faint', uppercase: true, tracking: 0.08 }).at(x, top + 24),
    )
}

export default film({ title: 'The checkout read path' }, (s) => {
    const heading = s.add(text('The checkout read path', { font: 'serif', size: 52 }).alignTo([-830, 0], 'left').shift(0, -410))
    const note = s.add(text('Peak hour, 12.4k requests per second. p99 budget 180 ms.', { size: 20, color: 'dim' }).alignTo([-830, 0], 'left').shift(0, -350))
    s.play(write(heading), fadeIn(note))

    const tiers = [tier('Edge', -690, 280), tier('Services', -210, 620), tier('Stores', 480, 660)]
    s.play(lagged(tiers.map((t) => draw(t, { lag: 0 })), { lag: 0.2 }))

    const nodes = {
        cdn: service('CDN', 'Fastly, 214 POPs', ['hit rate 91%', 'p50 18 ms', '12.4k rps'], -690, -130, 'dim'),
        gateway: service('Gateway', 'Envoy, 24 pods', ['auth, routing', 'p99 9 ms', '1.1k rps'], -690, 120, 'blue'),
        cart: service('Cart', 'Go, 42 pods', ['p99 48 ms', 'cpu 61%', '840 rps'], -360, -130, 'teal'),
        pricing: service('Pricing', 'Rust, 18 pods', ['p99 22 ms', 'cpu 44%', '790 rps'], -60, -130, 'teal'),
        search: service('Search', 'Java, 30 pods', ['p99 96 ms', 'cpu 72%', '310 rps'], -360, 120, 'teal'),
        ranker: service('Ranker', 'Python, 12 GPUs', ['p99 71 ms', 'gpu 83%', '310 rps'], -60, 120, 'purple'),
        orders: service('Orders DB', 'Postgres 16', ['primary + 3', '2.8 TB', 'lag 40 ms'], 310, -130, 'gold'),
        cache: service('Price cache', 'Redis 7', ['hit rate 97%', '64 GB', 'p99 2 ms'], 650, -130, 'gold'),
        index: service('Search index', 'Vespa', ['2.1 B documents', '11 nodes', 'p99 38 ms'], 310, 120, 'gold'),
        features: service('Feature store', 'ScyllaDB', ['900 features', '18 TB', 'p99 6 ms'], 650, 120, 'gold'),
    }
    s.play(lagged(Object.values(nodes).map((node) => fadeIn(node, { shift: [0, 8] })), { lag: 0.08 }))

    const route = (from: Vec, to: Vec, label: string, offset: Vec = [0, -14]) => {
        const edge = arrow(from, to, { stroke: 'dim', width: 1.75, tip: 11, pad: 4 })
        const tag = text(label, { size: 14, font: 'mono', color: 'dim' }).at((from[0] + to[0]) / 2 + offset[0], (from[1] + to[1]) / 2 + offset[1])
        return { edge, tag }
    }
    const routes = [
        route([-690, -62], [-690, 52], '1.1k rps', [54, 0]),
        route([-574, 90], [-476, -100], '840', [30, 0]),
        route([-574, 120], [-476, 120], '310'),
        route([-244, -130], [-176, -130], '790'),
        route([-244, 120], [-176, 120], '310'),
        route([56, -130], [194, -130], 'read 2 ms'),
        route([56, 120], [194, 120], 'ann 38 ms'),
        route([426, -130], [534, -130], 'miss 3%'),
        route([426, 120], [534, 120], 'join 6 ms'),
    ]
    s.play(lagged(routes.map(({ edge }) => draw(edge)), { lag: 0.12 }), fadeIn(routes.map(({ tag }) => tag)))

    const legend = group(
        line([-830, 300], [-790, 300], { stroke: 'yellow', width: 3 }),
        text('Traced request', { size: 16, color: 'dim' }).alignTo([-776, 0], 'left').shift(0, 300),
    )
    s.play(fadeIn(legend))

    const shaft = (index: number) => routes[index]!.edge.data['shaft'] as Node
    s.chapter('A cache hit')
    for (const index of [0, 1, 3, 5]) s.play(pulse(shaft(index), { color: 'yellow', duration: 0.5 }))
    s.chapter('A search')
    for (const index of [0, 2, 4, 6, 8]) s.play(pulse(shaft(index), { color: 'teal', duration: 0.5 }))
    s.wait(1.5)
})
`

const chart = `import { axes, draw, fadeIn, film, grow, lagged, rect, text, write } from 'vizmatic/stage'

// Bars that arrive in order, with the takeaway in the title.
const data = [
    { label: 'Mon', value: 42 },
    { label: 'Tue', value: 58 },
    { label: 'Wed', value: 51 },
    { label: 'Thu', value: 73 },
    { label: 'Fri', value: 96 },
]

export default film({ title: 'Friday doubled Monday' }, (s) => {
    const title = s.add(text('Friday doubled Monday', { font: 'serif', size: 68 }).at(0, -430))
    s.play(write(title))

    const plot = s.add(axes({ x: [0, 6], y: [0, 100], width: 1240, height: 680, yStep: 25, xStep: 7, tips: false, grid: true }).at(0, 70))
    s.play(draw(plot.lines), draw(plot.grid, { lag: 0.02 }), fadeIn(plot.numbers), { duration: 1 })

    const bars = data.map(({ value }, i) => {
        const x = i + 1
        const [left, top] = plot.world(x - 0.32, value)
        const [right, bottom] = plot.world(x + 0.32, 0)
        const color = value === 96 ? 'yellow' : 'blue'
        return { bar: rect(right - left, bottom - top, { fill: color, stroke: null }).at((left + right) / 2, (top + bottom) / 2), base: [(left + right) / 2, bottom] as const }
    })
    s.play(lagged(bars.map(({ bar, base }) => grow(bar, { from: base })), { lag: 0.3 }))

    const labels = data.flatMap(({ label, value }, i) => {
        const [x, base] = plot.world(i + 1, 0)
        const [, top] = plot.world(i + 1, value)
        return [
            text(label, { size: 24, color: 'dim' }).at(x, base + 30),
            text(String(value), { size: 28, weight: 600 }).at(x, top - 26),
        ]
    })
    s.play(fadeIn(labels))
    s.wait(1.5)
})
`

const deck = `import { fadeIn, fadeOut, film, lagged, text, write, type Node } from 'vizmatic/stage'

// A presentation. Each chapter is a step: use \`vizmatic preview\` and press the arrow keys.
function points(items: readonly string[]): Node[] {
    return items.map((item, i) => text(item, { size: 38, color: 'dim', maxWidth: 1200 }).at(0, -60 + i * 90))
}

export default film({ title: 'Quarterly review' }, (s) => {
    const slides = [
        { title: 'What shipped', items: ['Faster checkout, with p95 down 38%', 'A new search index, live in two regions', 'Zero severity-one incidents'] },
        { title: 'What we learned', items: ['Most latency sat in two slow queries', 'Canary traffic caught every regression', 'On-call load tracks deploy size'] },
        { title: 'What comes next', items: ['Move orders to the new storage tier', 'Cut the deploy size in half', 'Publish the latency budget per team'] },
    ]
    for (const slide of slides) {
        s.chapter(slide.title)
        const heading = s.add(text(slide.title, { font: 'serif', size: 88 }).at(0, -280))
        s.play(write(heading))
        const body = points(slide.items)
        s.play(lagged(body.map((item) => fadeIn(item, { shift: [0, 18] })), { lag: 0.35 }))
        s.wait(2)
        s.play(fadeOut([heading, ...body], { shift: [0, -24] }))
    }
})
`

export const FILM_TEMPLATES: readonly FilmTemplate[] = [
    { name: 'explainer', description: 'A graph, a moving value, and an equation, in three chapters.', source: explainer },
    { name: 'equation', description: 'A step-by-step derivation that morphs glyph by glyph.', source: equation },
    { name: 'architecture', description: 'Services with live detail, and packets traveling along the edges.', source: architecture },
    { name: 'chart', description: 'Bars that grow in order, with the takeaway as the title.', source: chart },
    { name: 'deck', description: 'A stepped presentation with one chapter per slide.', source: deck },
]
